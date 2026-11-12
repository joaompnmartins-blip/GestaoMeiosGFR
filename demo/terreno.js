'use strict';

// Execução no terreno (demonstração, só no beta3): o que ficou feito, com
// geometria.
//
// A empreitada divide-se em parcelas — grelha automática ou à mão — para
// se marcar o feito com um toque. Mas um registo nunca guarda números de
// parcelas: guarda a geometria do que se fez (ou, nas faixas e linhas, os
// troços do eixo em km). Assim, mudar a divisão não estraga nada.
//
// O executado de uma operação é a UNIÃO dos seus registos, recortada pela
// área da empreitada: marcar duas vezes o mesmo sítio conta uma vez, e o
// que se desenha fora não conta. Os registos declarados (sem geometria)
// somam-se à parte e ficam assinalados.
//
// Contas de geometria com o Turf.js, em WGS84: áreas geodésicas (m²) e
// comprimentos ao longo do eixo (km). Não há PostGIS no Postgres do Railway.

const turf = require('@turf/turf');
const { erro } = require('./planeamento');
const { diaLisboa, somarDias, diasUteisEntre } = require('./execucao');

// Tamanho por omissão das parcelas: 0,5 ha nos polígonos, 100 m nas faixas
// e na rede viária.
const PADRAO = { poligono: 0.5, faixa: 100, linha: 100 };
const LIMITES = { poligono: [0.05, 10], faixa: [20, 1000], linha: [20, 1000] };
const FEITO = 0.95, PARCIAL = 0.05;        // fracção de uma parcela já coberta
const KM = { units: 'kilometers' };
const arred = (x, c = 4) => Math.round(x * 10 ** c) / 10 ** c;
const DENTRO = ([lon, lat]) => lon > -9.8 && lon < -6.0 && lat > 36.8 && lat < 42.3;

const eLinear = e => e.geometria !== 'poligono';          // faixa ou linha: conta-se ao longo do eixo
const haM2 = m2 => m2 / 10000;
// Quantidade de um troço do eixo: ha na faixa (comprimento × largura), km na linha.
const qTroco = (e, km) => (e.geometria === 'faixa' ? km * Number(e.largura_m) / 10 : km);

// ── Geometria ─────────────────────────────────────────────────────

function uniao(polys) {
  const fs = polys.filter(Boolean);
  if (!fs.length) return null;
  if (fs.length === 1) return fs[0];
  return turf.union(turf.featureCollection(fs));
}
const recortar = (a, b) => (a && b ? turf.intersect(turf.featureCollection([a, b])) : null);
const tirar = (a, b) => (a && b ? turf.difference(turf.featureCollection([a, b])) : a);
const areaHa = f => (f ? haM2(turf.area(f)) : 0);

// Polígonos de um Polygon ou MultiPolygon, um a um.
const pedacos = f => (!f ? [] : f.geometry.type === 'Polygon' ? [f]
  : f.geometry.coordinates.map(c => turf.polygon(c)));

// Intervalos [a, b] em km: junta os que se tocam ou sobrepõem.
function juntarIntervalos(lista) {
  const v = lista.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]).filter(([a, b]) => b - a > 1e-6)
                 .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of v) {
    const u = out[out.length - 1];
    if (u && a <= u[1] + 1e-6) u[1] = Math.max(u[1], b); else out.push([a, b]);
  }
  return out;
}
const somaIntervalos = l => l.reduce((s, [a, b]) => s + (b - a), 0);
function sobreposicao(lista, a, b) {
  return lista.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
}

// Valida um polígono vindo do mapa: anel fechado, dentro de Portugal, sem se cruzar.
function poligonoValido(geom) {
  const anel = geom?.type === 'Polygon' ? geom.coordinates?.[0] : null;
  const ok = c => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && DENTRO(c);
  if (!Array.isArray(anel) || anel.length < 4 || !anel.every(ok))
    throw erro(400, 'O polígono precisa de pelo menos três vértices, dentro de Portugal continental.');
  const [a, z] = [anel[0], anel[anel.length - 1]];
  if (a[0] !== z[0] || a[1] !== z[1]) throw erro(400, 'O polígono tem de fechar no primeiro vértice.');
  const f = turf.polygon([anel]);
  if (turf.kinks(f).features.length) throw erro(400, 'O polígono cruza-se a si próprio. Desenhe-o sem cruzar as linhas.');
  return f;
}

// Posição de um ponto ao longo do eixo, em km desde o início.
function posicaoNoEixo(eixo, ponto) {
  if (!Array.isArray(ponto) || ponto.length !== 2 || !ponto.every(Number.isFinite) || !DENTRO(ponto))
    throw erro(400, 'Ponto inválido.');
  const p = turf.nearestPointOnLine(eixo, turf.point(ponto), KM);
  if (p.properties.dist > 0.2) throw erro(400, 'O ponto está a mais de 200 m do eixo da empreitada.');
  return p.properties.location;
}

// ── Leitura ───────────────────────────────────────────────────────

async function lerEmpreitada(c, id) {
  const { rows: [e] } = await c.query(
    `SELECT e.id, e.codigo, e.estado, e.geometria, e.geom, e.largura_m, e.area_ha, e.comprimento_km, e.divisao,
            COALESCE((SELECT json_agg(json_build_object('operacao', eo.operacao, 'quantidade', eo.quantidade,
                                       'designacao', o.designacao, 'unidade', o.unidade, 'modo', o.modo) ORDER BY eo.operacao)
                        FROM demo.empreitada_operacoes eo JOIN demo.operacoes o ON o.codigo = eo.operacao
                       WHERE eo.empreitada_id = e.id), '[]') AS operacoes
       FROM demo.empreitadas e WHERE e.id = $1`, [id]);
  if (!e) throw erro(404, 'Empreitada não encontrada.');
  e.feature = turf.feature(e.geom);
  if (eLinear(e)) e.eixo_km = turf.length(e.feature, KM);
  return e;
}

// ── Divisão ───────────────────────────────────────────────────────

// Grelha de quadrados de `ha` hectares, recortada pela área. Os retalhos
// pequenos da borda (menos de um quarto de célula) juntam-se ao vizinho
// mais próximo, para não ficarem parcelas de meia dúzia de metros.
function grelhaPoligono(area, ha) {
  const lado = Math.sqrt(ha * 10000) / 1000;
  // O squareGrid só faz células que cabem inteiras no rectângulo: alarga-se
  // uma célula para cada lado, senão a orla da área ficava de fora.
  const [x0, y0, x1, y1] = turf.bbox(area);
  const dy = lado / 110.54, dx = lado / (111.32 * Math.cos((y0 + y1) / 2 * Math.PI / 180));
  const celulas = turf.squareGrid([x0 - dx, y0 - dy, x1 + dx, y1 + dy], lado, KM).features
    .flatMap(q => pedacos(recortar(q, area)))
    .map(f => ({ f, ha: areaHa(f), c: turf.centroid(f).geometry.coordinates }))
    .filter(x => x.ha > 0.0005);
  const grandes = celulas.filter(x => x.ha >= ha / 4), pequenas = celulas.filter(x => x.ha < ha / 4);
  if (!grandes.length) return [area];
  for (const p of pequenas) {
    const alvo = grandes.reduce((m, g) => (turf.distance(p.c, g.c) < turf.distance(p.c, m.c) ? g : m));
    alvo.f = uniao([alvo.f, p.f]);
  }
  // Por filas, de norte para sul e de poente para nascente.
  const passo = lado / 111;
  return grandes.sort((a, b) => Math.round((b.c[1] - a.c[1]) / passo) || a.c[0] - b.c[0]).map(x => x.f);
}

// Troços do eixo com `m` metros; o último, se ficar curto, junta-se ao anterior.
function trocos(total, m) {
  const passo = m / 1000, cortes = [0];
  for (let x = passo; x < total - passo * 0.3; x += passo) cortes.push(x);
  cortes.push(total);
  return cortes.slice(1).map((b, i) => [cortes[i], b]);
}

function parcelasDeTrocos(e, intervalos) {
  return intervalos.map(([a, b], i) => ({
    n: i + 1, ini_km: arred(a), fim_km: arred(b), quantidade: arred(qTroco(e, b - a)),
    geom: turf.lineSliceAlong(e.feature, a, b, KM).geometry,
  }));
}

async function gravarParcelas(c, e, parcelas, divisao) {
  await c.query('DELETE FROM demo.empreitada_parcelas WHERE empreitada_id = $1', [e.id]);
  await c.query(
    `INSERT INTO demo.empreitada_parcelas (empreitada_id, n, geom, ini_km, fim_km, quantidade)
     SELECT $1, x.n, x.geom, x.ini_km, x.fim_km, x.quantidade
       FROM json_to_recordset($2) AS x(n int, geom jsonb, ini_km numeric, fim_km numeric, quantidade numeric)`,
    [e.id, JSON.stringify(parcelas)]);
  await c.query('UPDATE demo.empreitadas SET divisao = $2 WHERE id = $1', [e.id, JSON.stringify(divisao)]);
}

async function gerarGrelha(c, e, tamanho) {
  const [min, max] = LIMITES[e.geometria];
  const t = Number(tamanho ?? PADRAO[e.geometria]);
  if (!(t >= min && t <= max))
    throw erro(400, e.geometria === 'poligono' ? `As células têm de ter entre ${min} e ${max} ha.`
                                               : `Os troços têm de ter entre ${min} e ${max} m.`);
  const parcelas = eLinear(e)
    ? parcelasDeTrocos(e, trocos(e.eixo_km, t))
    : grelhaPoligono(e.feature, t).map((f, i) => ({ n: i + 1, geom: f.geometry, quantidade: arred(areaHa(f)) }));
  await gravarParcelas(c, e, parcelas, { modo: 'grelha', tamanho: t });
}

// À mão. Nos polígonos, as partes desenhadas por ordem: cada uma fica com
// o que lhe cabe da área e ainda não é de outra; o que sobra é uma parcela
// «resto». Nas faixas e linhas, pontos de corte ao longo do eixo.
async function divisaoManual(c, e, b) {
  let parcelas;
  if (eLinear(e)) {
    if (!Array.isArray(b.cortes) || !b.cortes.length) throw erro(400, 'Marque pelo menos um ponto de corte no eixo.');
    const km = [...new Set(b.cortes.map(p => arred(posicaoNoEixo(e.feature, p), 3)))]
      .filter(x => x > 0.005 && x < e.eixo_km - 0.005).sort((x, y) => x - y);
    if (!km.length) throw erro(400, 'Os cortes têm de ficar entre o início e o fim do eixo.');
    const pts = [0, ...km, e.eixo_km];
    parcelas = parcelasDeTrocos(e, pts.slice(1).map((x, i) => [pts[i], x]));
  } else {
    if (!Array.isArray(b.partes) || !b.partes.length) throw erro(400, 'Desenhe pelo menos uma parte.');
    let livre = e.feature;
    const partes = [];
    for (const [i, g] of b.partes.entries()) {
      const p = recortar(poligonoValido(g), livre);
      if (!p || areaHa(p) < 0.001) throw erro(400, `A parte ${i + 1} fica fora da área ou sobre partes anteriores.`);
      partes.push(p);
      livre = tirar(livre, p);
    }
    if (livre && areaHa(livre) > 0.01) partes.push(...pedacos(livre).filter(f => areaHa(f) > 0.001));
    parcelas = partes.map((f, i) => ({ n: i + 1, geom: f.geometry, quantidade: arred(areaHa(f)) }));
  }
  await gravarParcelas(c, e, parcelas, { modo: 'manual' });
}

async function garantirParcelas(c, e) {
  const { rows } = await c.query('SELECT count(*)::int n FROM demo.empreitada_parcelas WHERE empreitada_id = $1', [e.id]);
  if (!rows[0].n) await gerarGrelha(c, e, e.divisao?.tamanho);
}

// ── Progresso ─────────────────────────────────────────────────────

async function lerRegistos(c, id) {
  const { rows } = await c.query(
    `SELECT r.id, r.operacao, to_char(r.data, 'YYYY-MM-DD') data, r.origem, r.geom, r.intervalos,
            r.quantidade::float quantidade, r.observacoes, r.created_by, u.nome autor,
            to_char(r.created_at AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD HH24:MI') criado,
            to_char(r.anulado_em AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD HH24:MI') anulado, ua.nome anulado_por
       FROM demo.execucao_registos r
       LEFT JOIN utilizadores u ON u.id = r.created_by
       LEFT JOIN utilizadores ua ON ua.id = r.anulado_por
      WHERE r.empreitada_id = $1 ORDER BY r.data DESC, r.created_at DESC`, [id]);
  return rows;
}

// Por operação: o planeado, o executado georreferenciado (união dos
// registos), o declarado e a geometria do executado para o mapa.
function progresso(e, registos) {
  const validos = registos.filter(r => !r.anulado);
  return e.operacoes.map(o => {
    const regs = validos.filter(r => r.operacao === o.operacao);
    const declarado = regs.filter(r => r.origem === 'declarado').reduce((s, r) => s + r.quantidade, 0);
    let geo = 0, geom = null, intervalos = null;
    if (eLinear(e)) {
      intervalos = juntarIntervalos(regs.flatMap(r => r.intervalos || []));
      geo = qTroco(e, somaIntervalos(intervalos));
      if (intervalos.length)
        geom = { type: 'MultiLineString', coordinates: intervalos.map(([a, b]) =>
          turf.lineSliceAlong(e.feature, a, b, KM).geometry.coordinates) };
    } else {
      const u = recortar(uniao(regs.filter(r => r.geom).map(r => turf.feature(r.geom))), e.feature);
      geo = areaHa(u);
      geom = u?.geometry || null;
    }
    const planeado = Number(o.quantidade), total = geo + declarado;
    return { operacao: o.operacao, designacao: o.designacao, unidade: o.unidade, modo: o.modo,
             planeado, geo: arred(geo, 3), declarado: arred(declarado, 3), total: arred(total, 3),
             pct: planeado ? arred(Math.min(total / planeado, 9.99) * 100, 1) : 0,
             registos: regs.length, geom, intervalos, _feito: geom };
  });
}

// Quanto de cada parcela já está feito, por operação (0 a 1).
function estadoParcelas(e, parcelas, prog) {
  return parcelas.map(p => {
    const feito = {};
    for (const o of prog) {
      if (eLinear(e)) {
        const a = Number(p.ini_km), b = Number(p.fim_km);
        feito[o.operacao] = b > a && o.intervalos ? arred(sobreposicao(o.intervalos, a, b) / (b - a), 3) : 0;
      } else {
        const tot = Number(p.quantidade);
        feito[o.operacao] = tot && o._feito ? arred(Math.min(1, areaHa(recortar(turf.feature(p.geom), turf.feature(o._feito))) / tot), 3) : 0;
      }
    }
    return { id: p.id, n: p.n, geom: p.geom, ini_km: p.ini_km == null ? null : Number(p.ini_km),
             fim_km: p.fim_km == null ? null : Number(p.fim_km), quantidade: Number(p.quantidade), feito };
  });
}

// Pode anular: quem registou, até ao fim do dia seguinte; depois, só o
// gestor FSBF (e o administrador).
function podeAnular(r, user) {
  if (r.anulado) return false;
  if (['admin', 'gestor_fsbf'].includes(user.role)) return true;
  return r.created_by === user.id && r.criado.slice(0, 10) >= somarDias(diaLisboa(), -1);
}

async function lerTerreno(c, id, user) {
  const e = await lerEmpreitada(c, id);
  await garantirParcelas(c, e);
  const { rows: parcelas } = await c.query(
    'SELECT id, n, geom, ini_km, fim_km, quantidade FROM demo.empreitada_parcelas WHERE empreitada_id = $1 ORDER BY n', [id]);
  const registos = await lerRegistos(c, id);
  const prog = progresso(e, registos);
  const divisao = e.divisao || { modo: 'grelha', tamanho: PADRAO[e.geometria] };
  return {
    codigo: e.codigo, estado: e.estado, geometria: e.geometria, largura_m: e.largura_m == null ? null : Number(e.largura_m),
    unidade: e.geometria === 'linha' ? 'km' : 'ha', eixo_km: e.eixo_km == null ? null : arred(e.eixo_km, 3),
    divisao, padrao: PADRAO[e.geometria], limites: LIMITES[e.geometria],
    parcelas: estadoParcelas(e, parcelas, prog),
    operacoes: prog.map(({ _feito, ...o }) => o),
    registos: registos.map(({ created_by, ...r }) => ({ ...r, pode_anular: podeAnular({ ...r, created_by }, user) })),
  };
}

// Resumo para a barra «Área executada» da execução: total feito (até ao
// fim do corte) contra o previsto, pró-rata dos dias úteis.
async function resumoArea(c, id, ex) {
  const e = await lerEmpreitada(c, id);
  const prog = progresso(e, await lerRegistos(c, id));
  const previsto = prog.reduce((s, o) => s + o.planeado, 0);
  const todos = ex.inicio && ex.fim ? diasUteisEntre(ex.inicio, ex.fim).length : 0;
  const ate = !todos ? 0 : ex.estado === 'concluida' ? previsto : previsto * (ex.dias_decorridos || 0) / todos;
  // Cada operação conta até ao seu planeado: fazer a mais numa não tapa a falta noutra.
  const real = prog.reduce((s, o) => s + Math.min(o.total, o.planeado), 0);
  const declarado = prog.reduce((s, o) => s + Math.min(o.declarado, o.planeado), 0);
  return { unidade: e.geometria === 'linha' ? 'km' : 'ha', previsto: arred(previsto, 2), previsto_ate: arred(ate, 2),
           real: arred(real, 2), declarado: arred(declarado, 2), registos: prog.reduce((s, o) => s + o.registos, 0) };
}

// ── Registar ──────────────────────────────────────────────────────

const ESTADOS_COM_REGISTO = ['planeada', 'em_execucao', 'concluida'];

// b: { operacao, data, origem: 'parcelas'|'desenho'|'declarado',
//      parcelas: [id…] | geom (polígono) | pontos: [[lon,lat],[lon,lat]] (eixo) | quantidade,
//      observacoes }
async function registar(c, id, b, user) {
  const e = await lerEmpreitada(c, id);
  if (!ESTADOS_COM_REGISTO.includes(e.estado))
    throw erro(409, 'Só se regista o executado de empreitadas planeadas, em execução ou concluídas.');
  if (!e.operacoes.some(o => o.operacao === b.operacao)) throw erro(400, 'Escolha uma das operações da empreitada.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data || '')) throw erro(400, 'Indique o dia.');
  if (b.data > diaLisboa()) throw erro(400, 'Não se regista trabalho de dias que ainda não chegaram.');
  const obs = b.observacoes ? String(b.observacoes).trim().slice(0, 500) || null : null;

  let geom = null, intervalos = null, quantidade;
  if (b.origem === 'declarado') {
    quantidade = Number(b.quantidade);
    if (!(quantidade > 0)) throw erro(400, 'Indique a quantidade feita.');
    if (!obs) throw erro(400, 'Num registo sem geometria, diga nas observações onde foi feito.');
  } else if (b.origem === 'parcelas') {
    const ids = Array.isArray(b.parcelas) ? b.parcelas.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) throw erro(400, 'Escolha pelo menos uma parcela.');
    const { rows } = await c.query(
      'SELECT geom, ini_km, fim_km FROM demo.empreitada_parcelas WHERE empreitada_id = $1 AND id = ANY($2)', [id, ids]);
    if (rows.length !== new Set(ids).size) throw erro(400, 'Há parcelas que não são desta empreitada. Recarregue a página.');
    if (eLinear(e)) intervalos = juntarIntervalos(rows.map(p => [Number(p.ini_km), Number(p.fim_km)]));
    else geom = uniao(rows.map(p => turf.feature(p.geom)));
  } else if (b.origem === 'desenho') {
    if (eLinear(e)) {
      if (!Array.isArray(b.pontos) || b.pontos.length !== 2) throw erro(400, 'Marque o início e o fim do troço feito.');
      const [x, y] = b.pontos.map(p => posicaoNoEixo(e.feature, p));
      if (Math.abs(y - x) < 0.005) throw erro(400, 'O troço tem menos de 5 m.');
      intervalos = juntarIntervalos([[x, y]]);
    } else {
      geom = recortar(poligonoValido(b.geom), e.feature);
      if (!geom || areaHa(geom) < 0.001) throw erro(400, 'O desenho fica fora da área da empreitada.');
    }
  } else throw erro(400, 'Origem do registo inválida.');

  if (intervalos) {
    quantidade = qTroco(e, somaIntervalos(intervalos));
    geom = { type: 'MultiLineString', coordinates: intervalos.map(([a, z]) =>
      turf.lineSliceAlong(e.feature, a, z, KM).geometry.coordinates) };
    intervalos = intervalos.map(([a, z]) => [arred(a), arred(z)]);
  } else if (geom && geom.type === 'Feature') {
    quantidade = areaHa(geom);
    geom = geom.geometry;
  }

  const antes = progresso(e, await lerRegistos(c, id)).find(o => o.operacao === b.operacao);
  const { rows: [r] } = await c.query(
    `INSERT INTO demo.execucao_registos (empreitada_id, operacao, data, origem, geom, intervalos, quantidade, observacoes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [id, b.operacao, b.data, b.origem, geom ? JSON.stringify(geom) : null,
     intervalos ? JSON.stringify(intervalos) : null, arred(quantidade), obs, user?.id || null]);
  // O primeiro trabalho registado põe a empreitada em execução.
  if (e.estado === 'planeada')
    await c.query(`UPDATE demo.empreitadas SET estado = 'em_execucao', updated_at = now() WHERE id = $1`, [id]);
  const depois = progresso(e, await lerRegistos(c, id)).find(o => o.operacao === b.operacao);
  return { id: r.id, quantidade: arred(quantidade, 3), novo: arred(depois.total - antes.total, 3),
           total: depois.total, pct: depois.pct, estado: e.estado === 'planeada' ? 'em_execucao' : e.estado };
}

async function anular(c, id, rid, user) {
  const { rows: [r] } = await c.query(
    `SELECT id, created_by, to_char(created_at AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD HH24:MI') criado, anulado_em anulado
       FROM demo.execucao_registos WHERE id = $1 AND empreitada_id = $2 FOR UPDATE`, [rid, id]);
  if (!r) throw erro(404, 'Registo não encontrado.');
  if (r.anulado) throw erro(409, 'Este registo já está anulado.');
  if (!podeAnular(r, user))
    throw erro(403, 'Só quem registou o pode anular, até ao fim do dia seguinte. Depois disso, peça ao gestor FSBF.');
  await c.query('UPDATE demo.execucao_registos SET anulado_em = now(), anulado_por = $2 WHERE id = $1', [rid, user.id]);
}

// ── Cenários da demonstração ──────────────────────────────────────

// Avanços sintéticos de uma empreitada com história. A operação principal
// avança por parcelas, dia a dia, ao ritmo do cenário; a secundária fecha
// no fim (concluída) ou tem só um registo declarado (em execução). Na em
// execução há ainda um registo desenhado: parte de uma parcela.
async function simularAvancos(c, empreitadaId, { inicio, fim, ate, concluida, principal }) {
  const e = await lerEmpreitada(c, empreitadaId);
  await garantirParcelas(c, e);
  const { rows: parcelas } = await c.query(
    'SELECT id, geom, ini_km, fim_km, quantidade::float q FROM demo.empreitada_parcelas WHERE empreitada_id = $1 ORDER BY n', [e.id]);
  const dias = diasUteisEntre(inicio, ate), total = diasUteisEntre(inicio, fim).length || 1;
  if (!dias.length || !parcelas.length) return;
  const geometriaDe = ps => eLinear(e)
    ? { intervalos: juntarIntervalos(ps.map(p => [Number(p.ini_km), Number(p.fim_km)])) }
    : { geom: uniao(ps.map(p => turf.feature(p.geom))).geometry };
  const inserir = (op, data, origem, g, q, obs) => c.query(
    `INSERT INTO demo.execucao_registos (empreitada_id, operacao, data, origem, geom, intervalos, quantidade, observacoes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [e.id, op, data, origem,
     g?.geom ? JSON.stringify(g.geom) : g?.intervalos ? JSON.stringify({ type: 'MultiLineString', coordinates:
       g.intervalos.map(([a, b]) => turf.lineSliceAlong(e.feature, a, b, KM).geometry.coordinates) }) : null,
     g?.intervalos ? JSON.stringify(g.intervalos.map(([a, b]) => [arred(a), arred(b)])) : null, arred(q), obs || null]);
  const soma = ps => ps.reduce((s, p) => s + p.q, 0);

  for (const o of e.operacoes) {
    const planeado = Number(o.quantidade);
    if (o.operacao === principal) {
      // Concluída: tudo. Em execução: um pouco atrás do previsto até ao dia.
      const alvo = concluida ? 1 : 0.85 * dias.length / total;
      let i = 0;
      for (const [k, dia] of dias.entries()) {
        const meta = planeado * alvo * (k + 1) / dias.length;
        const doDia = [];
        while (i < parcelas.length && soma(parcelas.slice(0, i)) + 1e-9 < meta) doDia.push(parcelas[i++]);
        if (concluida && k === dias.length - 1) while (i < parcelas.length) doDia.push(parcelas[i++]);
        if (doDia.length) await inserir(o.operacao, dia, 'parcelas', geometriaDe(doDia), soma(doDia));
      }
      if (!concluida && i < parcelas.length) {                 // um registo desenhado: parte da parcela seguinte
        const p = parcelas[i];
        const g = eLinear(e)
          ? { intervalos: [[Number(p.ini_km), Number(p.ini_km) + (Number(p.fim_km) - Number(p.ini_km)) * 0.6]] }
          : { geom: turf.transformScale(turf.feature(p.geom), 0.6).geometry };
        const q = g.intervalos ? qTroco(e, somaIntervalos(g.intervalos)) : areaHa(recortar(turf.feature(g.geom), e.feature));
        await inserir(o.operacao, dias[dias.length - 1], 'desenho', g, q, 'Desenhado no mapa: só parte da parcela.');
      }
    } else if (concluida) {                                   // secundária: nas parcelas do fim, nos dois últimos dias
      const ps = [];
      for (let j = parcelas.length - 1; j >= 0 && soma(ps) < planeado; j--) ps.push(parcelas[j]);
      const meio = Math.ceil(ps.length / 2), ult = dias.slice(-2);
      if (ps.slice(0, meio).length) await inserir(o.operacao, ult[0], 'parcelas', geometriaDe(ps.slice(0, meio)), soma(ps.slice(0, meio)));
      if (ps.slice(meio).length) await inserir(o.operacao, ult[ult.length - 1], 'parcelas', geometriaDe(ps.slice(meio)), soma(ps.slice(meio)));
    } else {
      await inserir(o.operacao, dias[dias.length - 1], 'declarado', null, arred(planeado * 0.3, 2),
                    'Junto ao caminho de acesso; sem GPS no local.');
    }
  }
}

module.exports = {
  simularAvancos,
  lerEmpreitada, lerTerreno, resumoArea, registar, anular, gerarGrelha, divisaoManual, garantirParcelas,
  progresso, lerRegistos, PADRAO,
};
