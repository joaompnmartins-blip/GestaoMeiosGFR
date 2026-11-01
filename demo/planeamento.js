'use strict';

// Planeamento de uma empreitada (demonstração, só no beta3): o que está
// livre, a recomendação e a passagem de uma alternativa a meios afectos.
// Serve as rotas e os cenários que a demonstração já traz carregados.

const { recomendar, diasUteis, proximoDiaUtil } = require('./recomendacao');

function erro(status, msg) { return Object.assign(new Error(msg), { status }); }

// EMP-2027-007: o ano é o do início previsto; sem ele, o do plano de
// actividades da proposta; sem nenhum, o corrente.
async function proximoCodigo(c, data, anoPlano) {
  const ano = data ? +String(data).slice(0, 4) : (anoPlano || new Date().getFullYear());
  const { rows } = await c.query(
    `SELECT COALESCE(max(substring(codigo from '\\d+$')::int), 0) + 1 n
       FROM demo.empreitadas WHERE codigo LIKE $1`, [`EMP-${ano}-%`]);
  return `EMP-${ano}-${String(rows[0].n).padStart(3, '0')}`;
}

// Tudo o que a FSBF pode pôr numa empreitada, com a empreitada em que cada
// meio já está ocupado no período, se for o caso.
async function contexto(c, id) {
  const { rows: [e] } = await c.query(
    `SELECT e.id, e.geom, e.tipo_pov, e.estado, to_char(e.inicio_previsto, 'YYYY-MM-DD') ini,
            to_char(e.fim_previsto, 'YYYY-MM-DD') fim,
            COALESCE((SELECT json_agg(json_build_object('operacao', operacao, 'quantidade', quantidade))
                        FROM demo.empreitada_operacoes WHERE empreitada_id = e.id), '[]') AS operacoes
       FROM demo.empreitadas e WHERE e.id = $1`, [id]);
  if (!e) throw erro(404, 'Empreitada não encontrada.');
  const inicio = e.ini || proximoDiaUtil();
  const fim = e.fim && e.fim >= inicio ? e.fim : diasUteis(inicio, 30).pop();
  // Uma a uma: `c` pode ser um cliente numa transacção, e esse não aceita
  // consultas em paralelo.
  const consultas = [
    () => c.query('SELECT * FROM demo.operacoes'),
    () => c.query('SELECT * FROM demo.tipos_meio'),
    () => c.query('SELECT operacao, tipo_meio, tipo_pov, por_hora FROM demo.rendimentos'),
    () => c.query(`SELECT v.id, v.viatura_cod, v.classe, v.tipologia, v.prontidao, vb.base, b.lat, b.lon
               FROM viaturas v
               JOIN demo.viatura_base vb ON vb.viatura_id = v.id
               JOIN demo.bases b ON b.nome = vb.base
              WHERE v.megfr = 'FSBF' AND COALESCE(v.ativo, true)`),
    () => c.query(`SELECT o.id, o.nome, o.cargo, o.base, b.lat, b.lon
               FROM operacionais_fsbf o JOIN demo.bases b ON b.nome = o.base
              WHERE o.ativo AND COALESCE(o.cargo, '') NOT ILIKE '%comandante%'`),
    () => c.query(`SELECT m.viatura_id, m.operacional_id, e.codigo
               FROM demo.empreitada_meios m JOIN demo.empreitadas e ON e.id = m.empreitada_id
              WHERE m.empreitada_id <> $1 AND e.estado NOT IN ('cancelada', 'concluida')
                AND m.inicio < ($3::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon'
                AND m.fim    >  $2::date::timestamp AT TIME ZONE 'Europe/Lisbon'`, [id, inicio, fim]),
  ];
  const res = [];
  for (const q of consultas) res.push(await q());
  const [ops, tipos, rend, meios, pessoas, ocup] = res;
  const ocupado = new Map();
  for (const o of ocup.rows) ocupado.set(o.viatura_id || o.operacional_id, o.codigo);
  return { e, inicio, fim, ocupado,
           operacoes: ops.rows, tipos_meio: tipos.rows,
           rendimentos: rend.rows.map(r => ({ ...r, por_hora: Number(r.por_hora) })),
           meios: meios.rows, operacionais: pessoas.rows };
}

// A recomendação só conta com o que está livre e operacional.
function calcular(ctx, peso) {
  return recomendar({
    empreitada: { geom: ctx.e.geom, tipo_pov: ctx.e.tipo_pov, operacoes: ctx.e.operacoes },
    operacoes: ctx.operacoes, tipos_meio: ctx.tipos_meio, rendimentos: ctx.rendimentos,
    meios: ctx.meios.filter(m => !ctx.ocupado.has(m.id) && m.prontidao !== 'inoperacional'),
    operacionais: ctx.operacionais.filter(o => !ctx.ocupado.has(o.id)),
  }, peso);
}

// Substitui os meios afectos pelos da alternativa. Cada operação começa no
// início e ocupa os seus dias úteis; o porta-máquinas só conta no primeiro
// dia (levar) e no último (trazer). Devolve o último dia de trabalho.
async function aplicarAlternativa(c, id, inicio, alt) {
  await c.query('DELETE FROM demo.empreitada_meios WHERE empreitada_id = $1', [id]);
  let ultimo = inicio;
  const ins = (m, operacao, ini, fim, horas, custo) => c.query(
    `INSERT INTO demo.empreitada_meios (empreitada_id, viatura_id, operacional_id, operacao, inicio, fim,
                                        horas_previstas, custo_previsto, origem)
     VALUES ($1, $2, $3, $4, $5::timestamp AT TIME ZONE 'Europe/Lisbon', $6::timestamp AT TIME ZONE 'Europe/Lisbon',
             $7, $8, 'recomendacao')`,
    [id, m.viatura_id || null, m.operacional_id || null, operacao, ini, fim, horas, custo]);
  for (const p of alt.partes) {
    const dias = diasUteis(inicio, p.dias);
    const d0 = dias[0], d1 = dias[dias.length - 1];
    if (d1 > ultimo) ultimo = d1;
    for (const m of p.meios) {
      if (m.papel === 'transporte') {
        await ins(m, p.operacao, `${d0} 07:00`, `${d0} 12:00`, m.horas / 2, m.custo / 2);
        await ins(m, p.operacao, `${d1} 13:00`, `${d1} 18:00`, m.horas / 2, m.custo / 2);
      } else {
        await ins(m, p.operacao, `${d0} 08:00`, `${d1} 17:00`, m.horas, m.custo);
      }
    }
  }
  return ultimo;
}

module.exports = { erro, proximoCodigo, contexto, calcular, aplicarAlternativa };
