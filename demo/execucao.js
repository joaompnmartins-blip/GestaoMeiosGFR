'use strict';

// Execução de uma empreitada (demonstração, só no beta3): o previsto contra
// o real.
//
// O real das máquinas e das viaturas vem dos registos externos da frota e
// das máquinas (esquema ext), ligados à GOGFR por demo.correspondencia_veiculos.
// Um registo conta para a empreitada se cair num dia em que o meio lhe está
// afecto — os registos não dizem a que empreitada servem. O dos operacionais
// regista-se na aplicação, numa folha diária (demo.horas_operacionais).
//
// Custos reais:
//   máquina      horas do conta-horas × €/h, mais a parte fixa prevista
//                (mobilização, deslocação), que não muda com o trabalho
//   porta-máq.   km registados × €/km
//   viatura      km registados × €/km
//   operacional  horas da folha × €/h

const { erro } = require('./planeamento');
const { CLASSES_LIGEIRAS } = require('./recomendacao');

const arred = (x, c = 2) => Math.round(x * 10 ** c) / 10 ** c;

// Datas de calendário em Lisboa, em texto: é assim que se comparam.
const diaLisboa = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
function somarDias(dia, n) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diasUteisEntre(de, ate) {
  const out = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    const s = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (s !== 0 && s !== 6) out.push(d);
  }
  return out;
}

const papelDe = classe => classe === 'PM' ? 'transporte' : CLASSES_LIGEIRAS.includes(classe) ? 'viatura' : 'maquina';
const minutos = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const minutosDe = t => minutos(t.slice(11, 16));          // 'YYYY-MM-DD HH:MI'

// Os meios afectos, um por viatura ou operacional, com os períodos (pode
// haver mais de um: o porta-máquinas leva no primeiro dia e traz no último).
async function lerAfectacoes(c, id) {
  const { rows } = await c.query(`
    SELECT m.viatura_id, m.operacional_id, m.operacao, m.horas_previstas, m.custo_previsto,
           to_char(m.inicio AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD') d0,
           to_char(m.fim    AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD') d1,
           v.viatura_cod, v.classe, v.tipologia, o.nome, o.cargo,
           COALESCE(vb.base, o.base) base, t.custo_hora_eur, t.custo_km_eur
      FROM demo.empreitada_meios m
      LEFT JOIN viaturas v ON v.id = m.viatura_id
      LEFT JOIN demo.viatura_base vb ON vb.viatura_id = m.viatura_id
      LEFT JOIN operacionais_fsbf o ON o.id = m.operacional_id
      LEFT JOIN demo.tipos_meio t ON t.codigo = CASE WHEN m.operacional_id IS NOT NULL THEN 'OP'
                                                     WHEN v.classe = ANY($2) THEN 'VLCI' ELSE v.classe END
     WHERE m.empreitada_id = $1
     ORDER BY m.inicio`, [id, CLASSES_LIGEIRAS]);
  const porMeio = new Map();
  for (const r of rows) {
    const chave = r.viatura_id || r.operacional_id;
    let x = porMeio.get(chave);
    if (!x) {
      x = { chave, viatura_id: r.viatura_id, operacional_id: r.operacional_id,
            papel: r.operacional_id ? 'operacional' : papelDe(r.classe),
            rotulo: r.operacional_id ? r.nome : r.viatura_cod,
            detalhe: r.operacional_id ? (r.cargo || 'Operacional') : (r.tipologia || r.classe),
            classe: r.classe, base: r.base, operacoes: [], periodos: [],
            custo_hora: r.custo_hora_eur == null ? null : Number(r.custo_hora_eur),
            custo_km: r.custo_km_eur == null ? null : Number(r.custo_km_eur) };
      porMeio.set(chave, x);
    }
    if (r.operacao && !x.operacoes.includes(r.operacao)) x.operacoes.push(r.operacao);
    x.periodos.push({ d0: r.d0, d1: r.d1, operacao: r.operacao,
                      horas: Number(r.horas_previstas || 0), custo: Number(r.custo_previsto || 0) });
  }
  return [...porMeio.values()];
}

// Registos externos das viaturas e máquinas afectas, entre o primeiro e o
// último dia de cada uma; o filtro fino (só os dias afectos) faz-se depois.
async function lerRegistos(c, id) {
  const { rows } = await c.query(`
    WITH a AS (
      SELECT viatura_id, min(inicio AT TIME ZONE 'Europe/Lisbon')::date d0,
                         max(fim    AT TIME ZONE 'Europe/Lisbon')::date d1
        FROM demo.empreitada_meios WHERE empreitada_id = $1 AND viatura_id IS NOT NULL
       GROUP BY viatura_id)
    SELECT a.viatura_id, 'maquinas' fonte, r.id,
           to_char(r.data_hora_inicio, 'YYYY-MM-DD HH24:MI') ini,
           to_char(r.data_hora_fim,    'YYYY-MM-DD HH24:MI') fim,
           EXTRACT(epoch FROM r.data_hora_fim - r.data_hora_inicio) / 3600 duracao,
           r.horas_final - r.horas_inicial horas, NULL::int km,
           r.origem, r.destino, r.nome_operador pessoa, r.servico_afetacao servico, r.observacoes_fim obs
      FROM a JOIN demo.correspondencia_veiculos cv ON cv.viatura_id = a.viatura_id AND cv.origem = 'maquinas'
             JOIN ext.fsbf_maquinas_utilizacao r ON r.maquina_id = cv.id_externo
     WHERE r.data_hora_inicio < a.d1 + 1 AND COALESCE(r.data_hora_fim, r.data_hora_inicio) >= a.d0
    UNION ALL
    SELECT a.viatura_id, 'frota', r.id,
           to_char(r.data_hora_saida,   'YYYY-MM-DD HH24:MI'),
           to_char(r.data_hora_chegada, 'YYYY-MM-DD HH24:MI'),
           EXTRACT(epoch FROM r.data_hora_chegada - r.data_hora_saida) / 3600,
           NULL, r.km_final - r.km_inicial,
           r.origem, r.destino, r.nome_condutor, r.servico_afetacao, r.observacoes_fim
      FROM a JOIN demo.correspondencia_veiculos cv ON cv.viatura_id = a.viatura_id AND cv.origem = 'frota'
             JOIN ext.fsbf_frota_utilizacao r ON r.veiculo_id = cv.id_externo
     WHERE r.data_hora_saida < a.d1 + 1 AND COALESCE(r.data_hora_chegada, r.data_hora_saida) >= a.d0
     ORDER BY 1, 4`, [id]);
  return rows.map(r => ({ ...r, duracao: r.duracao == null ? null : Number(r.duracao),
                          horas: r.horas == null ? null : Number(r.horas) }));
}

// O que um registo tem de errado, se tiver. Um registo com anomalia não
// entra nas contas: mostra-se para alguém o corrigir na origem.
function anomalia(reg, anterior) {
  if (!reg.fim) return 'Sem hora de fim: o registo ficou por fechar.';
  if (reg.duracao < 0) return 'A chegada é anterior à saída.';
  if (reg.duracao > 24) return `Um só registo de ${Math.round(reg.duracao / 24)} dias seguidos: não se sabe que parte é desta empreitada.`;
  if (anterior && anterior.fim && reg.ini < anterior.fim) return `Sobrepõe-se ao registo n.º ${anterior.id} — duplicado?`;
  if (anterior && reg.origem === anterior.origem && reg.destino === anterior.destino &&
      reg.ini.slice(0, 10) === anterior.ini.slice(0, 10) && minutosDe(reg.ini) - minutosDe(anterior.ini) < 60)
    return `Repete o registo n.º ${anterior.id} (mesmo trajecto, ${minutosDe(reg.ini) - minutosDe(anterior.ini)} min depois) — duplicado?`;
  if (reg.fonte === 'maquinas' && (reg.horas == null || reg.horas < 0 || reg.horas > reg.duracao + 0.1))
    return 'O conta-horas não bate com a duração do registo.';
  if (reg.fonte === 'frota' && (reg.km == null || reg.km < 0)) return 'Quilómetros em falta ou negativos.';
  return null;
}

async function resumoExecucao(c, id) {
  const { rows: [e] } = await c.query(
    `SELECT id, codigo, estado, to_char(inicio_previsto, 'YYYY-MM-DD') ini, to_char(fim_previsto, 'YYYY-MM-DD') fim
       FROM demo.empreitadas WHERE id = $1`, [id]);
  if (!e) throw erro(404, 'Empreitada não encontrada.');
  const meios = await lerAfectacoes(c, id);
  const hoje = diaLisboa();
  const d0 = meios.length ? meios.flatMap(m => m.periodos.map(p => p.d0)).sort()[0] : e.ini;
  const d1 = meios.length ? meios.flatMap(m => m.periodos.map(p => p.d1)).sort().pop() : e.fim;
  // O previsto compara-se com o que já devia estar feito: até ontem, que o
  // dia de hoje ainda não acabou; ou tudo, se a empreitada está concluída.
  const corte = e.estado === 'concluida' ? d1 : [d1, somarDias(hoje, -1)].sort()[0];

  const registos = await lerRegistos(c, id);
  const { rows: horas } = await c.query(
    `SELECT h.id, h.operacional_id, to_char(h.data, 'YYYY-MM-DD') data, to_char(h.hora_inicio, 'HH24:MI') hora_inicio,
            to_char(h.hora_fim, 'HH24:MI') hora_fim, h.pausa_min, h.operacao, h.observacoes
       FROM demo.horas_operacionais h WHERE h.empreitada_id = $1 ORDER BY h.data, h.hora_inicio`, [id]);

  const saida = [];
  for (const m of meios) {
    const previsto = { horas: 0, custo: 0 }, ate = { horas: 0, custo: 0 };
    for (const p of m.periodos) {
      previsto.horas += p.horas; previsto.custo += p.custo;
      const todos = diasUteisEntre(p.d0, p.d1).length || 1;
      const feitos = d0 && corte >= p.d0 ? diasUteisEntre(p.d0, [p.d1, corte].sort()[0]).length : 0;
      ate.horas += p.horas * feitos / todos; ate.custo += p.custo * feitos / todos;
    }
    const real = { horas: 0, km: 0, custo: 0, dias: new Set(), registos: 0 };
    const regs = [];
    if (m.operacional_id) {
      for (const h of horas.filter(h => h.operacional_id === m.operacional_id)) {
        const hh = (minutos(h.hora_fim) - minutos(h.hora_inicio) - h.pausa_min) / 60;
        real.horas += hh; real.dias.add(h.data); real.registos++;
        regs.push({ fonte: 'folha', id: h.id, ini: `${h.data} ${h.hora_inicio}`, fim: `${h.data} ${h.hora_fim}`,
                    horas: arred(hh, 1), operacao: h.operacao, obs: h.observacoes, conta: true, anomalia: null });
      }
      real.custo = real.horas * (m.custo_hora || 0);
    } else {
      let anterior = null;
      for (const r of registos.filter(r => r.viatura_id === m.viatura_id)) {
        const dIni = r.ini.slice(0, 10), dFim = (r.fim || r.ini).slice(0, 10);
        if (!m.periodos.some(p => dIni <= p.d1 && dFim >= p.d0)) continue;   // dia em que não está afecto
        const a = anomalia(r, anterior);
        regs.push({ fonte: r.fonte, id: r.id, ini: r.ini, fim: r.fim, horas: r.horas == null ? null : arred(r.horas, 1),
                    km: r.km, duracao: r.duracao == null ? null : arred(r.duracao, 1), origem: r.origem, destino: r.destino,
                    pessoa: r.pessoa, obs: r.obs, conta: !a, anomalia: a,
                    aviso: !a && r.servico !== 'FSBF' ? 'Sem serviço de afectação FSBF.' : null });
        if (a) continue;
        anterior = r;
        real.registos++; real.dias.add(dIni);
        if (r.fonte === 'maquinas') real.horas += r.horas; else { real.km += r.km; real.horas += r.duracao; }
      }
      if (m.papel === 'maquina') {
        const fixo = Math.max(0, previsto.custo - previsto.horas * (m.custo_hora || 0));
        real.custo = real.registos ? real.horas * (m.custo_hora || 0) + fixo : 0;
      } else {
        real.custo = real.km * (m.custo_km || 0);
      }
    }
    const kmDe = custo => m.papel !== 'maquina' && m.custo_km ? Math.round(custo / m.custo_km) : null;
    saida.push({
      chave: m.chave, papel: m.papel, rotulo: m.rotulo, detalhe: m.detalhe, classe: m.classe, base: m.base,
      operacoes: m.operacoes, periodos: m.periodos.map(({ d0, d1 }) => ({ d0, d1 })),
      // Nas viaturas, o previsto em km sai do custo: foi assim que se calculou.
      previsto: { horas: arred(previsto.horas, 1), custo: arred(previsto.custo), km: kmDe(previsto.custo) },
      previsto_ate: { horas: arred(ate.horas, 1), custo: arred(ate.custo), km: kmDe(ate.custo) },
      real: { horas: arred(real.horas, 1), km: real.km, custo: arred(real.custo), dias: real.dias.size, registos: real.registos },
      anomalias: regs.filter(x => x.anomalia).length, registos: regs,
      // Dias afectos já passados sem nada registado.
      dias_sem_registo: m.papel === 'transporte' ? [] :
        [...new Set(m.periodos.flatMap(p => p.d0 <= corte ? diasUteisEntre(p.d0, [p.d1, corte].sort()[0]) : []))]
          .filter(d => !regs.some(x => x.conta && x.ini.slice(0, 10) === d)),
    });
  }

  const soma = (f, filtro = () => true) => arred(saida.filter(filtro).reduce((s, m) => s + f(m), 0));
  const eMaq = m => m.papel === 'maquina', ePes = m => m.papel === 'operacional';
  return {
    codigo: e.codigo, estado: e.estado, hoje, inicio: d0, fim: d1, corte,
    dias_uteis: d0 && d1 ? diasUteisEntre(d0, d1).length : 0,
    dias_decorridos: d0 && corte >= d0 ? diasUteisEntre(d0, corte).length : 0,
    totais: {
      previsto: soma(m => m.previsto.custo), previsto_ate: soma(m => m.previsto_ate.custo), real: soma(m => m.real.custo),
      horas_maquina: { previsto: soma(m => m.previsto.horas, eMaq), previsto_ate: soma(m => m.previsto_ate.horas, eMaq),
                       real: soma(m => m.real.horas, eMaq) },
      horas_pessoas: { previsto: soma(m => m.previsto.horas, ePes), previsto_ate: soma(m => m.previsto_ate.horas, ePes),
                       real: soma(m => m.real.horas, ePes) },
      km: soma(m => m.real.km),
      anomalias: saida.reduce((s, m) => s + m.anomalias, 0),
      dias_sem_registo: saida.reduce((s, m) => s + m.dias_sem_registo.length, 0),
    },
    meios: saida,
  };
}

// ── Folha de horas dos operacionais ───────────────────────────────

// Os dias da empreitada até hoje, cada um com quantos operacionais estão
// afectos e quantos já têm horas; e a folha do dia pedido.
async function lerFolha(c, id, data) {
  const meios = (await lerAfectacoes(c, id)).filter(m => m.operacional_id);
  if (!meios.length) throw erro(409, 'Esta empreitada não tem operacionais afectos.');
  const hoje = diaLisboa();
  const de = meios.flatMap(m => m.periodos.map(p => p.d0)).sort()[0];
  const ate = [meios.flatMap(m => m.periodos.map(p => p.d1)).sort().pop(), hoje].sort()[0];
  const { rows: horas } = await c.query(
    `SELECT h.id, h.operacional_id, to_char(h.data, 'YYYY-MM-DD') data, to_char(h.hora_inicio, 'HH24:MI') hora_inicio,
            to_char(h.hora_fim, 'HH24:MI') hora_fim, h.pausa_min, h.operacao, h.observacoes
       FROM demo.horas_operacionais h WHERE h.empreitada_id = $1 ORDER BY h.hora_inicio`, [id]);
  const afectos = dia => meios.filter(m => m.periodos.some(p => p.d0 <= dia && dia <= p.d1));
  const dias = de <= ate ? diasUteisEntre(de, ate).map(d => ({
    data: d, afectos: afectos(d).length,
    registados: new Set(horas.filter(h => h.data === d).map(h => h.operacional_id)).size,
  })) : [];
  // Sem data pedida: o dia mais antigo com menos de metade registada (uma
  // falta não conta como dia por preencher), ou o último.
  if (!data) data = (dias.find(d => d.registados * 2 < d.afectos) || dias[dias.length - 1] || {}).data || de;
  const doDia = horas.filter(h => h.data === data);
  const linhas = afectos(data).map(m => ({
    operacional_id: m.operacional_id, nome: m.rotulo, cargo: m.detalhe, base: m.base,
    operacao: m.periodos.find(p => p.d0 <= data && data <= p.d1)?.operacao || m.operacoes[0] || null,
    registos: doDia.filter(h => h.operacional_id === m.operacional_id),
  }));
  // Quem tem horas nesse dia sem estar afecto (afectação retirada depois).
  for (const h of doDia.filter(h => !linhas.some(l => l.operacional_id === h.operacional_id))) {
    const m = meios.find(x => x.operacional_id === h.operacional_id);
    linhas.push({ operacional_id: h.operacional_id, nome: m?.rotulo || '—', cargo: m?.detalhe || '', base: m?.base,
                  operacao: h.operacao, registos: [h], fora_do_periodo: true });
  }
  return { data, hoje, dias, linhas, operacoes: [...new Set(meios.flatMap(m => m.operacoes))] };
}

// Substitui as horas desta empreitada nesse dia. Só para quem está afecto
// à empreitada, nunca no futuro, sem sobrepor horas noutra empreitada.
async function gravarFolha(c, id, data, registos, utilizador) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) throw erro(400, 'Indique o dia.');
  if (data > diaLisboa()) throw erro(400, 'Não se registam horas de dias que ainda não chegaram.');
  if (!Array.isArray(registos)) throw erro(400, 'Faltam os registos.');
  const { rows: [e] } = await c.query('SELECT id, estado FROM demo.empreitadas WHERE id = $1 FOR UPDATE', [id]);
  if (!e) throw erro(404, 'Empreitada não encontrada.');
  if (e.estado === 'cancelada') throw erro(409, 'A empreitada está cancelada.');
  const { rows: afectos } = await c.query(
    `SELECT DISTINCT m.operacional_id, o.nome FROM demo.empreitada_meios m JOIN operacionais_fsbf o ON o.id = m.operacional_id
      WHERE m.empreitada_id = $1`, [id]);
  const nomes = Object.fromEntries(afectos.map(a => [a.operacional_id, a.nome]));
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  const limpos = registos.map(r => {
    const nome = nomes[r.operacional_id];
    if (!nome) throw erro(400, 'Só se registam horas de operacionais afectos a esta empreitada.');
    if (!hora.test(r.hora_inicio || '') || !hora.test(r.hora_fim || '')) throw erro(400, `${nome}: horas no formato HH:MM.`);
    const pausa = r.pausa_min === undefined || r.pausa_min === '' ? 60 : Number(r.pausa_min);
    if (!Number.isInteger(pausa) || pausa < 0 || pausa > 180) throw erro(400, `${nome}: a pausa vai de 0 a 180 minutos.`);
    const trab = minutos(r.hora_fim) - minutos(r.hora_inicio) - pausa;
    if (minutos(r.hora_fim) <= minutos(r.hora_inicio)) throw erro(400, `${nome}: o fim é anterior ao início.`);
    if (trab <= 0) throw erro(400, `${nome}: a pausa é maior do que o tempo de trabalho.`);
    if (trab > 12 * 60) throw erro(400, `${nome}: mais de 12 horas de trabalho num dia.`);
    return { operacional_id: r.operacional_id, nome, hora_inicio: r.hora_inicio, hora_fim: r.hora_fim, pausa,
             operacao: r.operacao || null, observacoes: r.observacoes ? String(r.observacoes).slice(0, 300) : null };
  });
  for (let i = 0; i < limpos.length; i++)
    for (let j = i + 1; j < limpos.length; j++) {
      const [a, b] = [limpos[i], limpos[j]];
      if (a.operacional_id === b.operacional_id && a.hora_inicio < b.hora_fim && b.hora_inicio < a.hora_fim)
        throw erro(400, `${a.nome}: dois períodos sobrepostos no mesmo dia.`);
    }
  // Sobreposições com outras empreitadas e escrita, cada uma numa só consulta.
  const json = JSON.stringify(limpos.map(r => ({ ...r, data })));
  const { rows: [x] } = await c.query(
    `SELECT r.nome, e.codigo
       FROM json_to_recordset($1) AS r(operacional_id uuid, nome text, hora_inicio time, hora_fim time)
       JOIN demo.horas_operacionais h ON h.operacional_id = r.operacional_id AND h.data = $2 AND h.empreitada_id <> $3
                                     AND h.hora_inicio < r.hora_fim AND h.hora_fim > r.hora_inicio
       JOIN demo.empreitadas e ON e.id = h.empreitada_id
      LIMIT 1`, [json, data, id]);
  if (x) throw erro(409, `${x.nome} já tem horas em ${x.codigo} nesse período.`);
  await c.query('DELETE FROM demo.horas_operacionais WHERE empreitada_id = $1 AND data = $2', [id, data]);
  await c.query(
    `INSERT INTO demo.horas_operacionais (empreitada_id, operacional_id, data, hora_inicio, hora_fim, pausa_min,
                                          operacao, observacoes, created_by)
     SELECT $2, r.operacional_id, $3, r.hora_inicio, r.hora_fim, r.pausa, r.operacao, r.observacoes, $4
       FROM json_to_recordset($1) AS r(operacional_id uuid, hora_inicio time, hora_fim time, pausa smallint,
                                       operacao text, observacoes text)`,
    [json, id, data, utilizador]);
  // As primeiras horas registadas põem a empreitada em execução.
  if (limpos.length && e.estado === 'planeada')
    await c.query(`UPDATE demo.empreitadas SET estado = 'em_execucao', updated_at = now() WHERE id = $1`, [id]);
  return { registos: limpos.length, estado: limpos.length && e.estado === 'planeada' ? 'em_execucao' : e.estado };
}

module.exports = { resumoExecucao, lerFolha, gravarFolha, diaLisboa, somarDias, diasUteisEntre };
