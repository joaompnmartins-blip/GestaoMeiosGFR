'use strict';

// Rotas da demonstração de empreitadas FSBF (só no beta3).
//
// Lê das fontes externas simuladas (esquema ext) e escreve no esquema demo.
// O acesso é o do módulo FSBF: gestores e chefes de grupo, mais o admin.

const { areaHa, comprimentoKm, distanciaKm } = require('./dados_demo');

const ESTADOS = ['seleccionada', 'planeada', 'em_execucao', 'concluida', 'cancelada'];

function erro(status, msg) { return Object.assign(new Error(msg), { status }); }

// Portugal continental com folga. Uma geometria fora disto é engano de
// coordenadas (lat/lon trocadas, PT-TM06 em vez de WGS84) e não se aceita.
const DENTRO = ([lon, lat]) => lon > -9.8 && lon < -6.0 && lat > 36.8 && lat < 42.3;

// Valida a geometria e mede-a. Aceita o que o mapa desenha: um polígono
// simples (só o anel exterior) ou uma linha.
function medirGeometria(geom) {
  if (!geom || typeof geom !== 'object') throw erro(400, 'Falta a geometria.');
  const ok = c => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && DENTRO(c);
  if (geom.type === 'Polygon') {
    const anel = geom.coordinates?.[0];
    if (!Array.isArray(anel) || anel.length < 4 || !anel.every(ok))
      throw erro(400, 'O polígono precisa de pelo menos três vértices, dentro de Portugal continental.');
    const [a, z] = [anel[0], anel[anel.length - 1]];
    if (a[0] !== z[0] || a[1] !== z[1]) throw erro(400, 'O polígono tem de fechar no primeiro vértice.');
    const ha = areaHa({ coordinates: [anel] });
    if (ha < 0.01) throw erro(400, 'O polígono tem área quase nula.');
    return { geometria: 'poligono', geom: { type: 'Polygon', coordinates: [anel] },
             area_ha: +ha.toFixed(2), comprimento_km: null, centro: centroide(anel.slice(0, -1)) };
  }
  if (geom.type === 'LineString') {
    const c = geom.coordinates;
    if (!Array.isArray(c) || c.length < 2 || !c.every(ok))
      throw erro(400, 'A linha precisa de pelo menos dois vértices, dentro de Portugal continental.');
    return { geometria: 'linha', geom: { type: 'LineString', coordinates: c },
             area_ha: null, comprimento_km: +comprimentoKm({ coordinates: c }).toFixed(2),
             centro: centroide(c) };
  }
  throw erro(400, 'A geometria tem de ser um polígono ou uma linha.');
}

function centroide(pts) {
  const n = pts.length;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

async function baseMaisProxima(c, centro) {
  const { rows } = await c.query('SELECT nome, lat, lon FROM demo.bases');
  let melhor = null;
  for (const b of rows) {
    const d = distanciaKm(centro, [b.lon, b.lat]);
    if (!melhor || d < melhor.d) melhor = { nome: b.nome, d };
  }
  return melhor?.nome || null;
}

// EMP-2027-007: o ano é o do início previsto; sem ele, o do plano de
// actividades da proposta; sem nenhum, o corrente.
async function proximoCodigo(c, data, anoPlano) {
  const ano = data ? +String(data).slice(0, 4) : (anoPlano || new Date().getFullYear());
  const { rows } = await c.query(
    `SELECT COALESCE(max(substring(codigo from '\\d+$')::int), 0) + 1 n
       FROM demo.empreitadas WHERE codigo LIKE $1`, [`EMP-${ano}-%`]);
  return `EMP-${ano}-${String(rows[0].n).padStart(3, '0')}`;
}

// Valida as operações contra o catálogo e a geometria: numa linha só cabem
// operações em km, num polígono só em ha.
async function validarOperacoes(c, operacoes, geometria) {
  if (!Array.isArray(operacoes) || !operacoes.length)
    throw erro(400, 'Indique pelo menos uma operação.');
  const { rows } = await c.query('SELECT codigo, geometria FROM demo.operacoes');
  const cat = Object.fromEntries(rows.map(r => [r.codigo, r.geometria]));
  const vistos = new Set();
  return operacoes.map(o => {
    const q = Number(o.quantidade);
    if (!cat[o.operacao]) throw erro(400, `Operação desconhecida: ${o.operacao}.`);
    if (cat[o.operacao] !== geometria)
      throw erro(400, `A operação ${o.operacao} aplica-se a ${cat[o.operacao] === 'linha' ? 'linhas' : 'polígonos'}.`);
    if (!(q > 0)) throw erro(400, `A quantidade de ${o.operacao} tem de ser positiva.`);
    if (vistos.has(o.operacao)) throw erro(400, `A operação ${o.operacao} está repetida.`);
    vistos.add(o.operacao);
    return { operacao: o.operacao, quantidade: +q.toFixed(2) };
  });
}

function validarDatas(ini, fim) {
  if (ini && fim && fim < ini) throw erro(400, 'O fim previsto é anterior ao início.');
}

const SQL_EMPREITADAS = `
  SELECT e.*,
         -- As datas em texto: um DATE passado a Date do JavaScript e depois
         -- a JSON sai em UTC, e em Lisboa isso pode recuar um dia.
         to_char(e.inicio_previsto, 'YYYY-MM-DD') AS inicio_previsto,
         to_char(e.fim_previsto,    'YYYY-MM-DD') AS fim_previsto,
         p.interv AS proposta_interv, p.cod_equipa AS proposta_equipa,
         COALESCE((SELECT json_agg(json_build_object('operacao', eo.operacao, 'quantidade', eo.quantidade,
                                    'designacao', o.designacao, 'unidade', o.unidade, 'modo', o.modo)
                                   ORDER BY eo.operacao)
                     FROM demo.empreitada_operacoes eo JOIN demo.operacoes o ON o.codigo = eo.operacao
                    WHERE eo.empreitada_id = e.id), '[]') AS operacoes,
         (SELECT count(*)::int FROM demo.empreitada_meios m WHERE m.empreitada_id = e.id) AS n_meios
    FROM demo.empreitadas e
    LEFT JOIN ext.propostas_empreitada p ON p.id = e.proposta_id`;

module.exports = function montarRotasEmpreitadas(app, { pool, requireAuth, FSBF_GESTORES, wrap }) {
  const leitura = [requireAuth('visualizador'), FSBF_GESTORES];

  // Catálogos de uma vez: o ecrã precisa de todos para desenhar e filtrar.
  app.get('/api/demo/catalogos', ...leitura, wrap(async (req, res) => {
    const [ops, tipos, bases] = await Promise.all([
      pool.query('SELECT * FROM demo.operacoes ORDER BY geometria DESC, tipo_interv NULLS LAST, codigo'),
      pool.query('SELECT * FROM demo.tipos_meio ORDER BY codigo'),
      pool.query('SELECT * FROM demo.bases ORDER BY companhia, nome'),
    ]);
    res.json({ operacoes: ops.rows, tipos_meio: tipos.rows, bases: bases.rows });
  }));

  // Propostas recebidas, com a empreitada em que se tornaram (se for o caso).
  app.get('/api/demo/propostas', ...leitura, wrap(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT p.*, e.id AS empreitada_id, e.codigo AS empreitada_codigo, e.estado AS empreitada_estado
        FROM ext.propostas_empreitada p
        LEFT JOIN demo.empreitadas e ON e.proposta_id = p.id
       ORDER BY p.base_proxima, p.id`);
    res.json(rows);
  }));

  app.get('/api/demo/empreitadas', ...leitura, wrap(async (req, res) => {
    const { rows } = await pool.query(`${SQL_EMPREITADAS} ORDER BY e.codigo`);
    res.json(rows);
  }));

  app.get('/api/demo/empreitadas/:id', ...leitura, wrap(async (req, res) => {
    const { rows } = await pool.query(`${SQL_EMPREITADAS} WHERE e.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Empreitada não encontrada.' });
    res.json(rows[0]);
  }));

  // Cria uma empreitada: a partir de uma proposta (só `proposta_id`) ou de
  // raiz (geometria desenhada no mapa e operações escolhidas à mão).
  app.post('/api/demo/empreitadas', ...leitura, wrap(async (req, res) => {
    const b = req.body || {};
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      let emp, operacoes;
      if (b.proposta_id) {
        const { rows } = await c.query('SELECT * FROM ext.propostas_empreitada WHERE id = $1', [b.proposta_id]);
        const p = rows[0];
        if (!p) throw erro(404, 'Proposta não encontrada.');
        emp = { origem: 'proposta', proposta_id: p.id, nome: p.nome || `Proposta ${p.id}`,
                geometria: p.geometria, geom: p.geom, area_ha: p.area_ha, comprimento_km: p.comprimento_km,
                tipo_pov: p.tipo_pov, base: p.base_proxima, ano: p.ano,
                observacoes: p.observ };
        operacoes = [{ operacao: p.interv, quantidade: p.area_ha ?? p.comprimento_km }];
      } else {
        const g = medirGeometria(b.geom);
        if (!String(b.nome || '').trim()) throw erro(400, 'Dê um nome à empreitada.');
        const pov = Number(b.tipo_pov);
        if (![1, 2, 3, 4].includes(pov)) throw erro(400, 'Indique o tipo de povoamento.');
        emp = { origem: 'manual', proposta_id: null, nome: String(b.nome).trim().slice(0, 120),
                geometria: g.geometria, geom: g.geom, area_ha: g.area_ha, comprimento_km: g.comprimento_km,
                tipo_pov: pov, base: await baseMaisProxima(c, g.centro),
                observacoes: b.observacoes ? String(b.observacoes).slice(0, 500) : null };
        operacoes = await validarOperacoes(c, b.operacoes, g.geometria);
      }
      validarDatas(b.inicio_previsto, b.fim_previsto);
      const codigo = await proximoCodigo(c, b.inicio_previsto, emp.ano);
      const { rows: [nova] } = await c.query(
        `INSERT INTO demo.empreitadas (codigo, origem, proposta_id, nome, geometria, geom, area_ha,
                                       comprimento_km, tipo_pov, base, inicio_previsto, fim_previsto,
                                       observacoes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [codigo, emp.origem, emp.proposta_id, emp.nome, emp.geometria, JSON.stringify(emp.geom),
         emp.area_ha, emp.comprimento_km, emp.tipo_pov, emp.base,
         b.inicio_previsto || null, b.fim_previsto || null, emp.observacoes, req.user.id]);
      for (const o of operacoes)
        await c.query('INSERT INTO demo.empreitada_operacoes (empreitada_id, operacao, quantidade) VALUES ($1,$2,$3)',
                      [nova.id, o.operacao, o.quantidade]);
      await c.query('COMMIT');
      const { rows } = await pool.query(`${SQL_EMPREITADAS} WHERE e.id = $1`, [nova.id]);
      res.status(201).json(rows[0]);
    } catch (e) {
      await c.query('ROLLBACK');
      if (e.code === '23505' && b.proposta_id) throw erro(409, 'Esta proposta já foi seleccionada.');
      throw e;
    } finally {
      c.release();
    }
  }));

  // Altera o que se decide depois de criar: estado, datas, nome, povoamento,
  // observações, operações. A geometria não muda — para isso, nova empreitada.
  app.put('/api/demo/empreitadas/:id', ...leitura, wrap(async (req, res) => {
    const b = req.body || {};
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query(
        `SELECT id, geometria, to_char(inicio_previsto, 'YYYY-MM-DD') ini, to_char(fim_previsto, 'YYYY-MM-DD') fim
           FROM demo.empreitadas WHERE id = $1 FOR UPDATE`, [req.params.id]);
      const e = rows[0];
      if (!e) throw erro(404, 'Empreitada não encontrada.');
      if (b.estado !== undefined && !ESTADOS.includes(b.estado)) throw erro(400, 'Estado inválido.');
      if (b.tipo_pov !== undefined && ![1, 2, 3, 4].includes(Number(b.tipo_pov))) throw erro(400, 'Tipo de povoamento inválido.');
      if (b.nome !== undefined && !String(b.nome).trim()) throw erro(400, 'O nome não pode ficar vazio.');
      const ini = b.inicio_previsto !== undefined ? (b.inicio_previsto || null) : e.ini;
      const fim = b.fim_previsto    !== undefined ? (b.fim_previsto    || null) : e.fim;
      validarDatas(ini, fim);
      await c.query(
        `UPDATE demo.empreitadas SET
            nome = COALESCE($2, nome), estado = COALESCE($3, estado), tipo_pov = COALESCE($4, tipo_pov),
            inicio_previsto = $5, fim_previsto = $6,
            observacoes = CASE WHEN $7::boolean THEN $8 ELSE observacoes END, updated_at = now()
          WHERE id = $1`,
        [e.id, b.nome !== undefined ? String(b.nome).trim().slice(0, 120) : null, b.estado ?? null,
         b.tipo_pov !== undefined ? Number(b.tipo_pov) : null, ini, fim,
         b.observacoes !== undefined, b.observacoes ? String(b.observacoes).slice(0, 500) : null]);
      if (b.operacoes !== undefined) {
        const ops = await validarOperacoes(c, b.operacoes, e.geometria);
        await c.query('DELETE FROM demo.empreitada_operacoes WHERE empreitada_id = $1', [e.id]);
        for (const o of ops)
          await c.query('INSERT INTO demo.empreitada_operacoes (empreitada_id, operacao, quantidade) VALUES ($1,$2,$3)',
                        [e.id, o.operacao, o.quantidade]);
      }
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
    const { rows } = await pool.query(`${SQL_EMPREITADAS} WHERE e.id = $1`, [req.params.id]);
    res.json(rows[0]);
  }));

  // Apagar devolve a proposta à lista. Os meios e as horas vão com ela.
  app.delete('/api/demo/empreitadas/:id', ...leitura, wrap(async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM demo.empreitadas WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Empreitada não encontrada.' });
    res.json({ ok: true });
  }));
};
