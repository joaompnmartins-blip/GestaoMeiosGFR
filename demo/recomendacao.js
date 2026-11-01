'use strict';

// Recomendação de meios para uma empreitada (demonstração, só no beta3).
//
// Não há aqui nada de estatístico: é aritmética que se pode conferir à mão.
// Para cada operação experimentam-se as combinações de meios que a sabem
// fazer — 1 a 3 máquinas de um tipo, ou uma equipa de 4 a 10 operacionais —
// com os meios FSBF reais mais próximos que estão livres. Cada combinação
// dá um custo e uma duração; as três alternativas escolhem de maneiras
// diferentes:
//
//   mais barata   — o menor custo, demore o que demorar
//   mais rápida   — a menor duração, e entre iguais a mais barata
//   equilibrada   — o melhor compromisso, com o peso escolhido no ecrã
//
// As operações tratam-se uma a uma, da maior para a menor, e um meio usado
// numa já não serve a seguinte: correm em paralelo, cada uma com os seus.
//
// Os rendimentos e os custos são SIMULADOS (demo.rendimentos, demo.tipos_meio).

const { distanciaKm } = require('./dados_demo');

const HORAS_DIA      = 7;    // trabalho efectivo por dia (jornada 8h–17h, 1 h de almoço, 1 h de deslocações e pausas)
const FACTOR_ESTRADA = 1.3;  // a estrada não é a linha recta
const VEL_TRATOR     = 30;   // km/h de um trator de rodas na estrada, pelos próprios meios
const VEL_PM         = 50;   // km/h de um porta-máquinas carregado
const POR_VIATURA    = 5;    // operacionais por viatura de transporte
const MAX_MAQUINAS   = 3;
const EQUIPAS        = [4, 6, 8, 10];
const MIN_FOGO       = 6;    // fogo controlado não se faz com menos

const CLASSES_LIGEIRAS = ['VLCI', 'VTTP', 'VCOT', 'VFCI'];

const arred = (x, c = 2) => Math.round(x * 10 ** c) / 10 ** c;
const eur = x => `${Math.round(x).toLocaleString('pt-PT')} €`;
const num = (x, c = 1) => x.toLocaleString('pt-PT', { minimumFractionDigits: c, maximumFractionDigits: c });

function centro(geom) {
  const pts = geom.type === 'Polygon' ? geom.coordinates[0].slice(0, -1) : geom.coordinates;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

// Os n mais próximos de `alvo` que ainda não foram usados.
function maisProximos(lista, n, usados, alvo, filtro = () => true) {
  return lista.filter(x => !usados.has(x.id) && filtro(x))
              .map(x => ({ ...x, dist_km: arred(distanciaKm(alvo, [x.lon, x.lat]) * FACTOR_ESTRADA, 1) }))
              .sort((a, b) => a.dist_km - b.dist_km)
              .slice(0, n);
}

// Avalia uma combinação (tipo de meio × quantidade) para uma operação.
// Devolve null se não houver meios livres que cheguem.
function avaliar({ op, quantidade, rend, tipo, k, ctx, usados }) {
  const { tipos, alvo, maquinas, ligeiras, operacionais } = ctx;
  const T = tipos[tipo], OP = tipos.OP, LIG = tipos.VLCI, PM = tipos.PM;
  const ritmo = k * rend;                            // unidades por hora, no conjunto
  const horas = quantidade / ritmo;                  // horas que cada meio trabalha
  const dias = Math.max(1, Math.ceil(horas / HORAS_DIA));
  const usar = new Set(usados);
  const meios = [];
  const conta = [];
  let custo = { trabalho: 0, operadores: 0, mobilizacao: 0, transporte: 0, deslocacoes: 0 };
  const un = op.unidade;

  let pessoas;
  if (tipo === 'OP') {
    pessoas = maisProximos(operacionais, k, usar, alvo);
    if (pessoas.length < k) return null;
    pessoas.forEach(p => usar.add(p.id));
    custo.trabalho = k * horas * OP.custo_hora_eur;
    conta.push(`Equipa de ${k} × ${num(rend, 3)} ${un}/h = ${num(ritmo, 2)} ${un}/h → ${num(horas)} h, ${dias} dia${dias > 1 ? 's' : ''}.`);
    conta.push(`Mão de obra: ${k} × ${num(horas)} h × ${eur(OP.custo_hora_eur)}/h = ${eur(custo.trabalho)}.`);
    for (const p of pessoas)
      meios.push({ papel: 'equipa', operacional_id: p.id, rotulo: p.nome, detalhe: p.cargo, base: p.base,
                   dist_km: p.dist_km, horas: arred(horas, 1), custo: arred(horas * OP.custo_hora_eur) });
  } else {
    const maq = maisProximos(maquinas, k, usar, alvo, m => m.classe === tipo);
    if (maq.length < k) return null;
    maq.forEach(m => usar.add(m.id));
    // Cada máquina leva um operador; primeiro os da base da máquina.
    pessoas = [];
    for (const m of maq) {
      const [p] = maisProximos(operacionais, 1, usar, [m.lon, m.lat]);
      if (!p) return null;
      usar.add(p.id);
      pessoas.push({ ...p, dist_km: arred(distanciaKm(alvo, [p.lon, p.lat]) * FACTOR_ESTRADA, 1) });
    }
    custo.trabalho = k * horas * T.custo_hora_eur;
    custo.operadores = k * horas * OP.custo_hora_eur;
    custo.mobilizacao = k * T.mobilizacao_eur;
    conta.push(`${k} × ${tipo} × ${num(rend, 3)} ${un}/h = ${num(ritmo, 2)} ${un}/h → ${num(horas)} h, ${dias} dia${dias > 1 ? 's' : ''}.`);
    conta.push(`Máquinas: ${k} × ${num(horas)} h × ${eur(T.custo_hora_eur)}/h = ${eur(custo.trabalho)}; ` +
               `operadores: ${k} × ${num(horas)} h × ${eur(OP.custo_hora_eur)}/h = ${eur(custo.operadores)}.`);
    conta.push(`Mobilização: ${k} × ${eur(T.mobilizacao_eur)} = ${eur(custo.mobilizacao)}.`);
    maq.forEach((m, i) => {
      meios.push({ papel: 'maquina', viatura_id: m.id, rotulo: m.viatura_cod, detalhe: m.tipologia || T.designacao,
                   base: m.base, dist_km: m.dist_km, horas: arred(horas, 1),
                   custo: arred(horas * T.custo_hora_eur + T.mobilizacao_eur) });
      meios.push({ papel: 'operador', operacional_id: pessoas[i].id, rotulo: pessoas[i].nome, detalhe: `operador de ${m.viatura_cod}`,
                   base: pessoas[i].base, dist_km: pessoas[i].dist_km, horas: arred(horas, 1),
                   custo: arred(horas * OP.custo_hora_eur) });
    });

    // Levar as máquinas ao terreno e trazê-las: as de rastos em porta-máquinas
    // (um por base de origem), os tratores de rodas pelos próprios meios.
    if (T.precisa_transporte) {
      const porBase = {};
      for (const m of maq) (porBase[m.base] ||= []).push(m);
      for (const [base, ms] of Object.entries(porBase)) {
        const [pm] = maisProximos(maquinas, 1, usar, [ms[0].lon, ms[0].lat], x => x.classe === 'PM');
        if (!pm) return null;
        usar.add(pm.id);
        // Um porta-máquinas leva uma máquina de cada vez: ida e volta por máquina.
        const km = ms.reduce((s, m) => s + 2 * m.dist_km, 0);
        const c = km * PM.custo_km_eur;
        custo.transporte += c;
        meios.push({ papel: 'transporte', viatura_id: pm.id, rotulo: pm.viatura_cod, detalhe: `porta-máquinas, de ${base}`,
                     base: pm.base, dist_km: ms[0].dist_km, horas: arred(km / VEL_PM, 1), custo: arred(c) });
      }
      conta.push(`Porta-máquinas: ida e volta de cada máquina, ${num(maq.reduce((s, m) => s + 2 * m.dist_km, 0), 0)} km × ` +
                 `${num(PM.custo_km_eur, 2)} €/km = ${eur(custo.transporte)}.`);
    } else {
      const km = maq.reduce((s, m) => s + 2 * m.dist_km, 0);
      custo.transporte = (km / VEL_TRATOR) * T.custo_hora_eur;
      // Sem porta-máquinas, a ida e volta fica no custo de cada trator —
      // senão a soma das afectações não daria o total da alternativa.
      for (const r of meios.filter(x => x.papel === 'maquina'))
        r.custo = arred(r.custo + (2 * r.dist_km / VEL_TRATOR) * T.custo_hora_eur);
      conta.push(`Deslocação pelos próprios meios: ${num(km, 0)} km a ${VEL_TRATOR} km/h × ${eur(T.custo_hora_eur)}/h = ${eur(custo.transporte)}.`);
    }
  }

  // Os operacionais vão e vêm todos os dias em viaturas ligeiras.
  const nv = Math.ceil(pessoas.length / POR_VIATURA);
  const vs = maisProximos(ligeiras, nv, usar, alvo);
  if (vs.length < nv) return null;
  vs.forEach(v => usar.add(v.id));
  const distMedia = pessoas.reduce((s, p) => s + p.dist_km, 0) / pessoas.length;
  custo.deslocacoes = nv * dias * 2 * distMedia * LIG.custo_km_eur;
  conta.push(`Transporte diário: ${nv} viatura${nv > 1 ? 's' : ''} × ${dias} dia${dias > 1 ? 's' : ''} × 2 × ${num(distMedia, 0)} km × ` +
             `${num(LIG.custo_km_eur, 2)} €/km = ${eur(custo.deslocacoes)}.`);
  for (const v of vs)
    meios.push({ papel: 'viatura', viatura_id: v.id, rotulo: v.viatura_cod, detalhe: v.tipologia || 'viatura ligeira',
                 base: v.base, dist_km: v.dist_km, horas: arred(dias * 2 * distMedia / 60, 1),
                 custo: arred(dias * 2 * distMedia * LIG.custo_km_eur) });

  custo = Object.fromEntries(Object.entries(custo).map(([a, b]) => [a, arred(b)]));
  const total = arred(Object.values(custo).reduce((s, x) => s + x, 0));
  return {
    operacao: op.codigo, designacao: op.designacao, quantidade, unidade: un,
    tipo, k, rendimento: rend, horas: arred(horas, 1), dias, custo, total,
    n_maquinas: tipo === 'OP' ? 0 : k, n_operacionais: pessoas.length,
    meios, conta, usados: usar,
  };
}

// Todas as combinações possíveis para uma operação, já avaliadas.
function candidatas(op, quantidade, pov, ctx, usados) {
  const out = [];
  for (const r of ctx.rendimentos.filter(x => x.operacao === op.codigo && x.tipo_pov === pov)) {
    const ks = r.tipo_meio === 'OP'
      ? EQUIPAS.filter(n => op.codigo !== 'QQQ' || n >= MIN_FOGO)
      : Array.from({ length: MAX_MAQUINAS }, (_, i) => i + 1);
    for (const k of ks) {
      const a = avaliar({ op, quantidade, rend: Number(r.por_hora), tipo: r.tipo_meio, k, ctx, usados });
      if (a) out.push(a);
    }
  }
  return out;
}

const CRITERIOS = {
  barata:      { nome: 'Mais barata',  escolher: cs => cs.reduce((a, b) => (b.total < a.total ? b : a)) },
  rapida:      { nome: 'Mais rápida',  escolher: cs => cs.reduce((a, b) => (b.dias < a.dias || (b.dias === a.dias && b.total < a.total) ? b : a)) },
  // Só entre as combinações eficientes — as que nenhuma outra bate ao mesmo
  // tempo no custo e no prazo; uma máquina cara e lenta não deve esticar a
  // escala. Custo e duração vão de 0 (a melhor) a 1 (a pior), e pesam-se.
  // Com peso 0,5 nenhum dos dois manda sozinho.
  equilibrada: { nome: 'Equilibrada',  escolher: (todas, peso) => {
    const cs = todas.filter(c => !todas.some(o => o.total <= c.total && o.dias <= c.dias &&
                                                 (o.total < c.total || o.dias < c.dias)));
    const esc = f => { const v = cs.map(f), a = Math.min(...v), b = Math.max(...v);
                       return x => (b > a ? (f(x) - a) / (b - a) : 0); };
    const nc = esc(c => c.total), nd = esc(c => c.dias);
    const nota = c => peso * nc(c) + (1 - peso) * nd(c);
    return cs.reduce((a, b) => (nota(b) < nota(a) - 1e-9 || (Math.abs(nota(b) - nota(a)) < 1e-9 && b.total < a.total) ? b : a));
  } },
};

// ctx: { empreitada, operacoes (catálogo), tipos_meio, rendimentos, meios, operacionais }
// `meios` e `operacionais` já vêm sem os que estão ocupados noutra empreitada.
function recomendar(ctx0, peso = 0.5) {
  const e = ctx0.empreitada;
  const catalogo = Object.fromEntries(ctx0.operacoes.map(o => [o.codigo, o]));
  const ctx = {
    alvo: centro(e.geom),
    tipos: Object.fromEntries(ctx0.tipos_meio.map(t => [t.codigo, {
      ...t, custo_hora_eur: Number(t.custo_hora_eur), custo_km_eur: Number(t.custo_km_eur),
      mobilizacao_eur: Number(t.mobilizacao_eur) }])),
    rendimentos: ctx0.rendimentos,
    maquinas: ctx0.meios.filter(m => !CLASSES_LIGEIRAS.includes(m.classe)),
    ligeiras: ctx0.meios.filter(m => CLASSES_LIGEIRAS.includes(m.classe)),
    operacionais: ctx0.operacionais,
  };
  const ops = [...e.operacoes].sort((a, b) => b.quantidade - a.quantidade);

  const alternativas = Object.entries(CRITERIOS).map(([chave, cr]) => {
    let usados = new Set();
    const partes = [], faltas = [];
    for (const o of ops) {
      const op = catalogo[o.operacao];
      const cs = candidatas(op, Number(o.quantidade), e.tipo_pov, ctx, usados);
      if (!cs.length) {
        faltas.push(`${o.operacao}: não há meios livres que saibam fazer esta operação` +
                    (ctx.rendimentos.some(r => r.operacao === o.operacao) ? '.' : ' — sem rendimentos no catálogo.'));
        continue;
      }
      const esc = cr.escolher(cs, peso);
      usados = esc.usados;
      const { usados: _, ...parte } = esc;
      partes.push(parte);
    }
    const total = arred(partes.reduce((s, p) => s + p.total, 0));
    return {
      chave, nome: cr.nome, partes, faltas,
      total, dias: partes.length ? Math.max(...partes.map(p => p.dias)) : 0,
      n_maquinas: partes.reduce((s, p) => s + p.n_maquinas, 0),
      n_operacionais: partes.reduce((s, p) => s + p.n_operacionais, 0),
      assinatura: partes.map(p => `${p.operacao}:${p.tipo}×${p.k}`).join('|'),
    };
  });
  // Duas alternativas iguais dizem-no, em vez de parecerem escolhas diferentes.
  for (let i = 1; i < alternativas.length; i++) {
    const igual = alternativas.slice(0, i).find(a => a.assinatura === alternativas[i].assinatura);
    if (igual) alternativas[i].igual_a = igual.nome;
  }
  return { peso, horas_dia: HORAS_DIA, factor_estrada: FACTOR_ESTRADA, alternativas };
}

// Dias úteis a partir de `inicio` (YYYY-MM-DD), contando o próprio.
function diasUteis(inicio, n) {
  const d = new Date(`${inicio}T12:00:00Z`);
  const out = [];
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function proximoDiaUtil(apos = new Date()) {
  const d = new Date(Date.UTC(apos.getFullYear(), apos.getMonth(), apos.getDate() + 1, 12));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = { recomendar, diasUteis, proximoDiaUtil, CLASSES_LIGEIRAS, HORAS_DIA };
