'use strict';

// Cenários da demonstração (só no beta3): empreitadas já com história, para
// a execução ter alguma coisa a mostrar no dia da apresentação.
//
//   concluída     começou há ~7 semanas; registos completos, as máquinas
//                 trabalharam mais horas do que o previsto e há uma viagem
//                 registada em duplicado
//   em execução   começou há 6 dias úteis e acaba daqui a uns dias; as
//                 máquinas vão abaixo do ritmo, o último registo de uma
//                 ficou por fechar, e estão por registar as horas dos dois
//                 últimos dias e as do último dia da equipa — é isso que se
//                 mostra a preencher
//   planeada      começa daqui a uma semana; meios afectos, nada feito
//   seleccionada  uma faixa ao longo de uma estrada, ainda sem meios
//
// Todas partem de um pedido. As que têm meios ficam com responsável: o
// primeiro operacional afecto.
//
// Os meios saem da própria recomendação, e os registos externos desses
// meios nesses dias são reescritos para baterem com a afectação. Tudo
// sintético, como o resto da demonstração.

const { proximoCodigo, contexto, calcular, aplicarAlternativa } = require('./planeamento');
const { diasUteis, CLASSES_LIGEIRAS } = require('./recomendacao');
const { diaLisboa, somarDias, diasUteisEntre } = require('./execucao');

const doisDig = n => String(n).padStart(2, '0');
// Arredonda primeiro: 959,6 min são 16:00, não 15:60.
const hhmm = m => { const t = Math.round(m); return `${doisDig(Math.floor(t / 60) % 24)}:${doisDig(t % 60)}`; };
const arred = (x, c = 1) => Math.round(x * 10 ** c) / 10 ** c;

function diaUtilAntes(dia, n) {
  let d = dia;
  while (n > 0) {
    d = somarDias(d, -1);
    const s = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (s !== 0 && s !== 6) n--;
  }
  return d;
}

const CENARIOS = [
  { estado: 'concluida',   recuo: 34,  alt: 'equilibrada', dias: [4, 14], op: 'MAO', extra: 'CAO', ritmo: 1.15 },
  { estado: 'em_execucao', recuo: 6,   alt: 'barata',      dias: [9, 18], op: 'MAO', extra: 'CAO', ritmo: 0.90 },
  { estado: 'planeada',    recuo: -6,  alt: 'equilibrada', dias: [2, 15], op: 'MAO', extra: 'CAO' },
  { estado: 'seleccionada', camada: 'linhas', op: 'CAO' },
];

// Serve para o cenário? Polígonos de 6 a 35 ha, ou faixas ao longo de estradas.
const serve = (p, cen) => (cen.camada || 'poligonos') === p.camada &&
  (p.camada === 'linhas' ? p.tiporede === 'RSFGC' : Number(p.area_ha) >= 6 && Number(p.area_ha) <= 35);

// Cria uma empreitada a partir de um pedido, com a alternativa pedida.
// Se o pedido não servir (faltam meios, duração fora do intervalo),
// desfaz e devolve null.
async function tentar(c, p, cen, hoje) {
  const inicio = cen.recuo === undefined ? null
               : cen.recuo > 0 ? diaUtilAntes(hoje, cen.recuo) : diasUteis(somarDias(hoje, 1), -cen.recuo).pop();
  const faixa = p.camada === 'linhas';
  const area = faixa ? arred(Number(p.areacalc) / 10000, 2) : Number(p.area_ha);
  await c.query('SAVEPOINT cenario');
  const { rows: [e] } = await c.query(
    `INSERT INTO demo.empreitadas (codigo, origem, pedido_id, nome, geometria, geom, area_ha, comprimento_km,
                                   largura_m, tipo_pov, base, inicio_previsto, observacoes)
     VALUES ($1, 'pedido', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, codigo, nome`,
    [await proximoCodigo(c, inicio, null), p.id, `${p.localtrab} — ${p.codpedido}`, faixa ? 'faixa' : 'poligono',
     JSON.stringify(p.geom), area, faixa ? arred(Number(p.comprim_m) / 1000, 2) : null,
     faixa ? p.largura_m : null, p.tiporede === 'RPFGC' ? 1 : 4, p.base_proxima, inicio, 'Cenário da demonstração.']);
  const ops = [{ operacao: cen.op, quantidade: area }];
  if (cen.extra) ops.push({ operacao: cen.extra, quantidade: arred(area * 0.2, 2) });
  for (const o of ops)
    await c.query('INSERT INTO demo.empreitada_operacoes (empreitada_id, operacao, quantidade) VALUES ($1,$2,$3)',
                  [e.id, o.operacao, o.quantidade]);
  if (!inicio) return e;

  const ctx = await contexto(c, e.id);
  const alt = calcular(ctx, 0.5).alternativas.find(a => a.chave === cen.alt);
  if (!alt || alt.faltas.length || alt.partes.length !== ops.length ||
      alt.dias < cen.dias[0] || alt.dias > cen.dias[1]) {
    await c.query('ROLLBACK TO SAVEPOINT cenario');
    return null;
  }
  const fim = await aplicarAlternativa(c, e.id, inicio, alt);
  await c.query(`UPDATE demo.empreitadas SET fim_previsto = $2, estado = $3,
                        responsavel_id = (SELECT operacional_id FROM demo.empreitada_meios
                                           WHERE empreitada_id = $1 AND operacional_id IS NOT NULL
                                           ORDER BY inicio, operacional_id LIMIT 1)
                  WHERE id = $1`, [e.id, fim, cen.estado]);
  return { ...e, inicio, fim };
}

async function criarCenarios(c, r, referencia = new Date()) {
  const hoje = diaLisboa(referencia);
  const { rows: pedidos } = await c.query('SELECT * FROM ext.pedidos_fsbf ORDER BY id');
  const usadas = new Set(), bases = new Set(), feitas = [];
  for (const cen of CENARIOS) {
    for (const p of pedidos) {
      if (usadas.has(p.id) || bases.has(p.base_proxima) || !serve(p, cen)) continue;
      const e = await tentar(c, p, cen, hoje);
      if (!e) continue;
      usadas.add(p.id); bases.add(p.base_proxima);
      feitas.push({ ...e, cen });
      break;
    }
  }
  const ids = { maquinas: 0, frota: 0 };
  for (const t of Object.keys(ids))
    ids[t] = (await c.query(`SELECT COALESCE(max(id), 0) n FROM ext.fsbf_${t}_utilizacao`)).rows[0].n;
  for (const e of feitas.filter(x => x.cen.ritmo)) await historia(c, r, e, hoje, ids);
  return feitas.map(e => `${e.codigo} (${e.cen.estado})`);
}

// Os registos externos e as horas dos operacionais de uma empreitada que
// já começou, até ontem.
async function historia(c, r, e, hoje, ids) {
  const concluida = e.cen.estado === 'concluida';
  const ate = concluida ? e.fim : somarDias(hoje, -1);
  // Na em execução, os dois últimos dias úteis ficam por registar.
  const ateFolha = concluida ? e.fim : diaUtilAntes(hoje, 3);
  const { rows: afect } = await c.query(`
    SELECT m.viatura_id, m.operacional_id, m.operacao, m.horas_previstas, m.custo_previsto,
           to_char(m.inicio AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD') d0,
           to_char(m.fim    AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD') d1,
           v.classe, cv.origem fonte, cv.id_externo, vb.base
      FROM demo.empreitada_meios m
      LEFT JOIN viaturas v ON v.id = m.viatura_id
      LEFT JOIN demo.correspondencia_veiculos cv ON cv.viatura_id = m.viatura_id
      LEFT JOIN demo.viatura_base vb ON vb.viatura_id = m.viatura_id
     WHERE m.empreitada_id = $1 ORDER BY m.inicio`, [e.id]);

  // Fora as linhas inventadas que caíam nestes dias: aqui manda a empreitada.
  for (const a of afect.filter(x => x.fonte)) {
    const [tab, col, data] = a.fonte === 'maquinas' ? ['maquinas', 'maquina_id', 'data_hora_inicio']
                                                     : ['frota', 'veiculo_id', 'data_hora_saida'];
    await c.query(`DELETE FROM ext.fsbf_${tab}_utilizacao WHERE ${col} = $1 AND ${data}::date BETWEEN $2 AND $3`,
                  [a.id_externo, a.d0, a.d1]);
  }

  const maq = [], frota = [], folha = [];
  const contador = async (tab, col, campo, id, antes) => {
    const { rows: [x] } = await c.query(
      `SELECT ${campo} v FROM ext.fsbf_${tab}_utilizacao WHERE ${col} = $1 AND ${campo} IS NOT NULL
         AND ${tab === 'maquinas' ? 'data_hora_inicio' : 'data_hora_saida'} < $2::date
       ORDER BY ${tab === 'maquinas' ? 'data_hora_inicio' : 'data_hora_saida'} DESC LIMIT 1`, [id, antes]);
    return x ? Number(x.v) : null;
  };
  const viagem = (a, dia, ini, km, orig, dest, condutor) => {
    const dur = Math.round(km * r.entre(1.1, 1.5));
    const reg = { id: ++ids.frota, veiculo_id: a.id_externo, data_hora_saida: `${dia} ${hhmm(ini)}:00`,
                  data_hora_chegada: `${dia} ${hhmm(ini + dur)}:00`, origem: orig, destino: dest,
                  km_inicial: a.km, km_final: a.km + km, utilizador_registo_id: r.inteiro(1, 46),
                  servico_afetacao: 'FSBF', nome_condutor: condutor };
    a.km += km;
    frota.push(reg);
    return reg;
  };

  for (const a of afect) {
    const dias = diasUteisEntre(a.d0, [a.d1, ate].sort()[0]);
    const nDias = diasUteisEntre(a.d0, a.d1).length || 1;
    if (a.operacional_id) {
      // Dias inteiros de 7 h; no último, só o que falta (à meia hora).
      const resto = Number(a.horas_previstas) - 7 * (nDias - 1);
      // Na em execução fica também por registar o último dia de cada equipa.
      for (const dia of dias.filter(d => d <= ateFolha && (concluida || d < a.d1))) {
        if (r() < 0.05) continue;                                  // falta
        let h = dia === a.d1 && resto < 7 ? Math.max(1, Math.round(resto * 2) / 2) : 7;
        if (concluida && r() < 0.15) h += 1;                       // uma hora a mais, de vez em quando
        folha.push({ empreitada_id: e.id, operacional_id: a.operacional_id, data: dia,
                     hora_inicio: '08:00', hora_fim: hhmm(8 * 60 + 60 + h * 60), pausa_min: 60, operacao: a.operacao });
      }
      continue;
    }
    if (!a.fonte) continue;
    if (a.fonte === 'maquinas') {
      let horas = (await contador('maquinas', 'maquina_id', 'horas_final', a.id_externo, a.d0)) ?? arred(r.entre(1500, 9000));
      const operador = `Operador ${doisDig(r.inteiro(1, 40))}`;
      let desdeAbastecer = 0;
      for (const [k, dia] of dias.entries()) {
        if (concluida && r() < 0.06) continue;                     // avaria, chuva
        // O previsto por dia, ao ritmo do cenário: acima na concluída, abaixo na em execução.
        const trab = Math.min(9.5, Math.max(2, Number(a.horas_previstas) / nDias * e.cen.ritmo * r.entre(0.88, 1.12)));
        const ini = r.inteiro(8 * 60, 8 * 60 + 30);
        const reg = { id: ++ids.maquinas, maquina_id: a.id_externo, data_hora_inicio: `${dia} ${hhmm(ini)}:00`,
                      data_hora_fim: `${dia} ${hhmm(ini + trab * 60 + 60)}:00`,
                      origem: k === 0 ? a.base : e.nome, destino: e.nome,
                      horas_inicial: horas, horas_final: arred(horas + trab),
                      utilizador_registo_id: r.inteiro(1, 46), servico_afetacao: 'FSBF', nome_operador: operador };
        if (++desdeAbastecer >= 3) { reg.abastecimento_lts = arred(r.entre(80, 220), 2); desdeAbastecer = 0; }
        horas = reg.horas_final;
        maq.push(reg);
      }
      continue;
    }
    // Frota: o porta-máquinas leva ou traz (ida carregado, volta vazio); as
    // ligeiras levam a equipa de manhã e trazem-na à tarde.
    a.km = (await contador('frota', 'veiculo_id', 'km_final', a.id_externo, a.d0)) ?? r.inteiro(15000, 160000);
    const condutor = `Condutor ${doisDig(r.inteiro(1, 60))}`;
    if (a.classe === 'PM') {
      if (a.d0 > ate) continue;
      const km = Math.max(5, Math.round(Number(a.custo_previsto) / 2.2 / 2 * r.entre(0.95, 1.1)));
      const ida = viagem(a, a.d0, r.inteiro(7 * 60, 7 * 60 + 20), km, a.base, e.nome, condutor);
      const chegou = +ida.data_hora_chegada.slice(11, 13) * 60 + +ida.data_hora_chegada.slice(14, 16);
      viagem(a, a.d0, chegou + 40, km, e.nome, a.base, condutor);
    } else if (CLASSES_LIGEIRAS.includes(a.classe)) {
      const n = diasUteisEntre(a.d0, a.d1).length || 1;
      const km = Math.max(5, Math.round(Number(a.custo_previsto) / 0.45 / n / 2));
      for (const dia of dias) {
        viagem(a, dia, r.inteiro(7 * 60 + 15, 7 * 60 + 40), Math.round(km * r.entre(0.97, 1.06)), a.base, e.nome, condutor);
        viagem(a, dia, r.inteiro(16 * 60 + 10, 16 * 60 + 40), Math.round(km * r.entre(0.97, 1.06)), e.nome, a.base, condutor);
      }
    }
  }

  // As anomalias de cada cenário.
  if (concluida) {
    const v = frota.find(x => x.origem !== e.nome && frota.filter(y => y.veiculo_id === x.veiculo_id).length > 4);
    if (v) {                                                       // a mesma ida registada duas vezes
      const mais20 = t => `${t.slice(0, 11)}${hhmm(+t.slice(11, 13) * 60 + +t.slice(14, 16) + 20)}:00`;
      frota.push({ ...v, id: ++ids.frota, data_hora_saida: mais20(v.data_hora_saida), data_hora_chegada: mais20(v.data_hora_chegada) });
    }
  } else {
    const ultimo = maq.reduce((a, b) => (!a || b.data_hora_inicio > a.data_hora_inicio ? b : a), null);
    if (ultimo) Object.assign(ultimo, { data_hora_fim: null, horas_final: null });   // ficou por fechar
  }

  const inserir = async (tabela, linhas) => {
    if (linhas.length)
      await c.query(`INSERT INTO ${tabela} SELECT * FROM json_populate_recordset(null::${tabela}, $1)`,
                    [JSON.stringify(linhas)]);
  };
  await inserir('ext.fsbf_maquinas_utilizacao', maq);
  await inserir('ext.fsbf_frota_utilizacao', frota);
  // Aqui não vale o SELECT *: o id e as datas de criação têm valor por omissão.
  if (folha.length)
    await c.query(`INSERT INTO demo.horas_operacionais (empreitada_id, operacional_id, data, hora_inicio, hora_fim,
                                                        pausa_min, operacao)
                   SELECT empreitada_id, operacional_id, data, hora_inicio, hora_fim, pausa_min, operacao
                     FROM json_populate_recordset(null::demo.horas_operacionais, $1)`, [JSON.stringify(folha)]);
}

module.exports = { criarCenarios };
