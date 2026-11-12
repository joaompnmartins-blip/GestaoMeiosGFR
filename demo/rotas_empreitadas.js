'use strict';

// Rotas da demonstração de empreitadas FSBF (só no beta3).
//
// Lê das fontes externas simuladas (esquema ext) e escreve no esquema demo.
// O acesso é o do módulo FSBF: gestores e chefes de grupo, mais o admin.

const { areaHa, comprimentoKm, distanciaKm, reporDadosDemo, DOMINIOS } = require('./dados_demo');
const { CLASSES_LIGEIRAS, HORAS_DIA } = require('./recomendacao');
const { erro, proximoCodigo, contexto, calcular, aplicarAlternativa } = require('./planeamento');
const execucao = require('./execucao');
const terreno = require('./terreno');

const ESTADOS = ['seleccionada', 'planeada', 'em_execucao', 'concluida', 'cancelada'];

// Operação sugerida ao seleccionar um pedido, pelo tipo de rede. Só uma
// sugestão: quem selecciona confirma ou muda.
const SUGESTAO_REDE = { MGC: 'MAO', RPFGC: 'MAO', RSFGC: 'CAO' };

// Numa faixa (linha com largura) entram as operações medidas em ha, como
// num polígono; numa linha simples (rede viária), as medidas em km.
const geometriaDasOperacoes = g => (g === 'linha' ? 'linha' : 'poligono');

// Portugal continental com folga. Uma geometria fora disto é engano de
// coordenadas (lat/lon trocadas, PT-TM06 em vez de WGS84) e não se aceita.
const DENTRO = ([lon, lat]) => lon > -9.8 && lon < -6.0 && lat > 36.8 && lat < 42.3;

// Valida a geometria e mede-a. Aceita o que o mapa desenha: um polígono
// simples (só o anel exterior), uma linha, ou uma faixa (linha com largura).
function medirGeometria(geom, largura) {
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
    const km = comprimentoKm({ coordinates: c });
    if (largura != null) {
      const l = Number(largura);
      if (!(l >= 1 && l <= 500)) throw erro(400, 'A largura da faixa tem de estar entre 1 e 500 m.');
      return { geometria: 'faixa', geom: { type: 'LineString', coordinates: c }, largura_m: l,
               area_ha: +(km * l / 10).toFixed(2), comprimento_km: +km.toFixed(2), centro: centroide(c) };
    }
    return { geometria: 'linha', geom: { type: 'LineString', coordinates: c },
             area_ha: null, comprimento_km: +km.toFixed(2), centro: centroide(c) };
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

// Valida as operações contra o catálogo e a geometria: numa linha só cabem
// operações em km, num polígono ou numa faixa só em ha.
async function validarOperacoes(c, operacoes, geometriaEmpreitada) {
  const geometria = geometriaDasOperacoes(geometriaEmpreitada);
  if (!Array.isArray(operacoes) || !operacoes.length)
    throw erro(400, 'Indique pelo menos uma operação.');
  const { rows } = await c.query('SELECT codigo, geometria FROM demo.operacoes');
  const cat = Object.fromEntries(rows.map(r => [r.codigo, r.geometria]));
  const vistos = new Set();
  return operacoes.map(o => {
    const q = Number(o.quantidade);
    if (!cat[o.operacao]) throw erro(400, `Operação desconhecida: ${o.operacao}.`);
    if (cat[o.operacao] !== geometria)
      throw erro(400, `A operação ${o.operacao} mede-se em ${cat[o.operacao] === 'linha' ? 'km (rede viária)' : 'ha'}.`);
    if (!(q > 0)) throw erro(400, `A quantidade de ${o.operacao} tem de ser positiva.`);
    if (vistos.has(o.operacao)) throw erro(400, `A operação ${o.operacao} está repetida.`);
    vistos.add(o.operacao);
    return { operacao: o.operacao, quantidade: +q.toFixed(2) };
  });
}

// O responsável é um operacional FSBF activo (ou nenhum).
async function validarResponsavel(c, id) {
  if (!id) return;
  const ok = /^[0-9a-f-]{36}$/i.test(String(id)) &&
    (await c.query('SELECT 1 FROM operacionais_fsbf WHERE id = $1 AND ativo', [id])).rowCount;
  if (!ok) throw erro(400, 'O responsável tem de ser um operacional FSBF activo.');
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
         p.codpedido AS pedido_codigo, p.tiporede AS pedido_tiporede, r.nome AS responsavel_nome,
         COALESCE((SELECT json_agg(json_build_object('operacao', eo.operacao, 'quantidade', eo.quantidade,
                                    'designacao', o.designacao, 'unidade', o.unidade, 'modo', o.modo)
                                   ORDER BY eo.operacao)
                     FROM demo.empreitada_operacoes eo JOIN demo.operacoes o ON o.codigo = eo.operacao
                    WHERE eo.empreitada_id = e.id), '[]') AS operacoes,
         (SELECT count(*)::int FROM demo.empreitada_meios m WHERE m.empreitada_id = e.id) AS n_meios,
         (SELECT sum(custo_previsto) FROM demo.empreitada_meios m WHERE m.empreitada_id = e.id) AS custo_previsto
    FROM demo.empreitadas e
    LEFT JOIN ext.pedidos_fsbf p ON p.id = e.pedido_id
    LEFT JOIN operacionais_fsbf r ON r.id = e.responsavel_id`;

module.exports = function montarRotasEmpreitadas(app, { pool, requireAuth, FSBF_GESTORES, wrap }) {
  const leitura = [requireAuth('visualizador'), FSBF_GESTORES];

  // Catálogos de uma vez: o ecrã precisa de todos para desenhar e filtrar.
  app.get('/api/demo/catalogos', ...leitura, wrap(async (req, res) => {
    const [ops, tipos, bases, pessoas] = await Promise.all([
      pool.query('SELECT * FROM demo.operacoes ORDER BY ordem, codigo'),
      pool.query('SELECT * FROM demo.tipos_meio ORDER BY codigo'),
      pool.query('SELECT * FROM demo.bases ORDER BY companhia, nome'),
      // Para escolher o responsável: todos os operacionais FSBF activos.
      pool.query(`SELECT id, nome, cargo, base FROM operacionais_fsbf WHERE ativo ORDER BY nome`),
    ]);
    res.json({ operacoes: ops.rows, tipos_meio: tipos.rows, bases: bases.rows, operacionais: pessoas.rows,
               dominios: DOMINIOS, sugestao_rede: SUGESTAO_REDE });
  }));

  // Pedidos em vigor, com a empreitada em que se tornaram (se for o caso).
  app.get('/api/demo/pedidos', ...leitura, wrap(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT p.*, to_char(p.datainicio, 'YYYY-MM-DD') AS datainicio, to_char(p.datafim, 'YYYY-MM-DD') AS datafim,
             to_char(p.datasub, 'YYYY-MM-DD HH24:MI') AS datasub,
             e.id AS empreitada_id, e.codigo AS empreitada_codigo, e.estado AS empreitada_estado
        FROM ext.pedidos_fsbf p
        LEFT JOIN demo.empreitadas e ON e.pedido_id = p.id
       ORDER BY p.drcnf, p.codpedido`);
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

  // Cria uma empreitada: a partir de um pedido (`pedido_id`; a geometria vem
  // dele) ou de raiz (geometria desenhada no mapa). Nos dois casos as
  // operações, o povoamento e o responsável escolhem-se à mão: o pedido não
  // diz que intervenção fazer.
  app.post('/api/demo/empreitadas', ...leitura, wrap(async (req, res) => {
    const b = req.body || {};
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      if (!String(b.nome || '').trim()) throw erro(400, 'Dê um nome à empreitada.');
      const pov = Number(b.tipo_pov);
      if (![1, 2, 3, 4].includes(pov)) throw erro(400, 'Indique o tipo de povoamento.');
      const comum = { nome: String(b.nome).trim().slice(0, 120), tipo_pov: pov,
                      responsavel_id: b.responsavel_id || null,
                      observacoes: b.observacoes ? String(b.observacoes).slice(0, 500) : null };
      let emp;
      if (b.pedido_id) {
        const { rows } = await c.query('SELECT * FROM ext.pedidos_fsbf WHERE id = $1', [b.pedido_id]);
        const p = rows[0];
        if (!p) throw erro(404, 'Pedido não encontrado.');
        const faixa = p.camada === 'linhas';
        emp = { ...comum, origem: 'pedido', pedido_id: p.id, geometria: faixa ? 'faixa' : 'poligono', geom: p.geom,
                largura_m: faixa ? Number(p.largura_m) : null,
                area_ha: faixa ? +(Number(p.areacalc) / 10000).toFixed(2) : Number(p.area_ha),
                comprimento_km: faixa ? +(Number(p.comprim_m) / 1000).toFixed(2) : null,
                base: p.base_proxima, ano: p.datainicio ? new Date(p.datainicio).getFullYear() : null };
      } else {
        const g = medirGeometria(b.geom, b.largura_m ?? null);
        emp = { ...comum, origem: 'manual', pedido_id: null, geometria: g.geometria, geom: g.geom,
                largura_m: g.largura_m ?? null, area_ha: g.area_ha, comprimento_km: g.comprimento_km,
                base: await baseMaisProxima(c, g.centro) };
      }
      const operacoes = await validarOperacoes(c, b.operacoes, emp.geometria);
      validarDatas(b.inicio_previsto, b.fim_previsto);
      await validarResponsavel(c, comum.responsavel_id);
      const codigo = await proximoCodigo(c, b.inicio_previsto, emp.ano);
      const { rows: [nova] } = await c.query(
        `INSERT INTO demo.empreitadas (codigo, origem, pedido_id, nome, geometria, geom, area_ha,
                                       comprimento_km, largura_m, tipo_pov, base, inicio_previsto, fim_previsto,
                                       observacoes, responsavel_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [codigo, emp.origem, emp.pedido_id, emp.nome, emp.geometria, JSON.stringify(emp.geom),
         emp.area_ha, emp.comprimento_km, emp.largura_m, emp.tipo_pov, emp.base,
         b.inicio_previsto || null, b.fim_previsto || null, emp.observacoes, emp.responsavel_id, req.user.id]);
      for (const o of operacoes)
        await c.query('INSERT INTO demo.empreitada_operacoes (empreitada_id, operacao, quantidade) VALUES ($1,$2,$3)',
                      [nova.id, o.operacao, o.quantidade]);
      await c.query('COMMIT');
      const { rows } = await pool.query(`${SQL_EMPREITADAS} WHERE e.id = $1`, [nova.id]);
      res.status(201).json(rows[0]);
    } catch (e) {
      await c.query('ROLLBACK');
      if (e.code === '23505' && b.pedido_id) throw erro(409, 'Este pedido já foi seleccionado.');
      throw e;
    } finally {
      c.release();
    }
  }));

  // Altera o que se decide depois de criar: estado, datas, nome, povoamento,
  // responsável, observações, operações. A geometria não muda — para isso, nova empreitada.
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
      if (b.responsavel_id !== undefined) await validarResponsavel(c, b.responsavel_id);
      await c.query(
        `UPDATE demo.empreitadas SET
            nome = COALESCE($2, nome), estado = COALESCE($3, estado), tipo_pov = COALESCE($4, tipo_pov),
            inicio_previsto = $5, fim_previsto = $6,
            observacoes = CASE WHEN $7::boolean THEN $8 ELSE observacoes END,
            responsavel_id = CASE WHEN $9::boolean THEN $10::uuid ELSE responsavel_id END, updated_at = now()
          WHERE id = $1`,
        [e.id, b.nome !== undefined ? String(b.nome).trim().slice(0, 120) : null, b.estado ?? null,
         b.tipo_pov !== undefined ? Number(b.tipo_pov) : null, ini, fim,
         b.observacoes !== undefined, b.observacoes ? String(b.observacoes).slice(0, 500) : null,
         b.responsavel_id !== undefined, b.responsavel_id || null]);
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

  // Apagar devolve o pedido à lista. Os meios e as horas vão com ela.
  app.delete('/api/demo/empreitadas/:id', ...leitura, wrap(async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM demo.empreitadas WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Empreitada não encontrada.' });
    res.json({ ok: true });
  }));

  // ── Meios ──────────────────────────────────────────────────────

  // Os meios afectos, com o que é preciso para os mostrar. As horas saem na
  // hora de Lisboa, que é a de quem planeia.
  app.get('/api/demo/empreitadas/:id/meios', ...leitura, wrap(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT m.id, m.operacao, m.horas_previstas, m.custo_previsto, m.origem,
             to_char(m.inicio AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD HH24:MI') AS inicio,
             to_char(m.fim    AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD HH24:MI') AS fim,
             m.viatura_id, v.viatura_cod, v.classe, v.tipologia,
             m.operacional_id, o.nome AS operacional_nome, o.cargo,
             COALESCE(vb.base, o.base) AS base
        FROM demo.empreitada_meios m
        LEFT JOIN viaturas v ON v.id = m.viatura_id
        LEFT JOIN demo.viatura_base vb ON vb.viatura_id = m.viatura_id
        LEFT JOIN operacionais_fsbf o ON o.id = m.operacional_id
       WHERE m.empreitada_id = $1
       ORDER BY m.operacao NULLS LAST, (m.viatura_id IS NULL), v.classe, o.nome, m.inicio`, [req.params.id]);
    res.json(rows);
  }));

  app.get('/api/demo/empreitadas/:id/meios-disponiveis', ...leitura, wrap(async (req, res) => {
    const ctx = await contexto(pool, req.params.id);
    const alvo = centroide(ctx.e.geom.type === 'Polygon' ? ctx.e.geom.coordinates[0].slice(0, -1) : ctx.e.geom.coordinates);
    const dist = x => Math.round(distanciaKm(alvo, [x.lon, x.lat]) * 1.3);
    res.json({
      inicio: ctx.inicio, fim: ctx.fim,
      viaturas: ctx.meios.map(v => ({ id: v.id, rotulo: v.viatura_cod, classe: v.classe, detalhe: v.tipologia,
        base: v.base, dist_km: dist(v), inoperacional: v.prontidao === 'inoperacional',
        ocupado_em: ctx.ocupado.get(v.id) || null })).sort((a, b) => a.dist_km - b.dist_km),
      operacionais: ctx.operacionais.map(o => ({ id: o.id, rotulo: o.nome, detalhe: o.cargo, base: o.base,
        dist_km: dist(o), ocupado_em: ctx.ocupado.get(o.id) || null })).sort((a, b) => a.dist_km - b.dist_km),
    });
  }));

  const lerPeso = v => Math.min(1, Math.max(0, v === undefined || v === '' ? 0.5 : Number(v) || 0));

  app.get('/api/demo/empreitadas/:id/recomendacao', ...leitura, wrap(async (req, res) => {
    const ctx = await contexto(pool, req.params.id);
    res.json({ inicio: ctx.inicio, fim_janela: ctx.fim, ...calcular(ctx, lerPeso(req.query.peso)) });
  }));

  // Aceitar volta a calcular no servidor — não se confia no que o browser
  // mandaria — e substitui os meios afectos pelos da alternativa escolhida.
  app.post('/api/demo/empreitadas/:id/recomendacao/aceitar', ...leitura, wrap(async (req, res) => {
    const b = req.body || {};
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT 1 FROM demo.empreitadas WHERE id = $1 FOR UPDATE', [req.params.id]);
      const ctx = await contexto(c, req.params.id);
      const alt = calcular(ctx, lerPeso(b.peso)).alternativas.find(a => a.chave === b.chave);
      if (!alt) throw erro(400, 'Alternativa desconhecida.');
      if (!alt.partes.length) throw erro(409, 'Esta alternativa não tem meios para afectar.');
      const ultimo = await aplicarAlternativa(c, req.params.id, ctx.inicio, alt);
      await c.query(
        `UPDATE demo.empreitadas SET inicio_previsto = $2, fim_previsto = $3, updated_at = now(),
                estado = CASE WHEN estado = 'seleccionada' THEN 'planeada' ELSE estado END
          WHERE id = $1`, [req.params.id, ctx.inicio, ultimo]);
      await c.query('COMMIT');
      res.json({ ok: true, alternativa: alt.nome, meios: alt.partes.reduce((s, p) => s + p.meios.length, 0) });
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }));

  // Afectar um meio à mão: uma viatura ou um operacional, entre duas datas.
  // Recusa-se se já estiver noutra empreitada no mesmo período.
  app.post('/api/demo/empreitadas/:id/meios', ...leitura, wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.viatura_id === !b.operacional_id) throw erro(400, 'Escolha uma viatura ou um operacional.');
    const dia = /^\d{4}-\d{2}-\d{2}$/;
    if (!dia.test(b.inicio || '') || !dia.test(b.fim || '')) throw erro(400, 'Indique as datas de início e de fim.');
    if (b.fim < b.inicio) throw erro(400, 'O fim é anterior ao início.');
    const id = b.viatura_id || b.operacional_id;
    const { rows: conflito } = await pool.query(`
      SELECT e.codigo FROM demo.empreitada_meios m JOIN demo.empreitadas e ON e.id = m.empreitada_id
       WHERE (m.viatura_id = $1 OR m.operacional_id = $1) AND e.estado NOT IN ('cancelada', 'concluida')
         AND m.inicio < ($3::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon'
         AND m.fim    >  $2::date::timestamp AT TIME ZONE 'Europe/Lisbon'
       LIMIT 1`, [id, b.inicio, b.fim]);
    if (conflito[0]) throw erro(409, `Este meio já está afecto a ${conflito[0].codigo} nesse período.`);

    // Custo previsto: dias úteis × horas de trabalho × custo/hora do tipo.
    let n = 0;
    for (const d = new Date(`${b.inicio}T12:00:00Z`); d.toISOString().slice(0, 10) <= b.fim; d.setUTCDate(d.getUTCDate() + 1))
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
    const horas = n * HORAS_DIA;
    let custoHora = null;
    if (b.operacional_id) {
      custoHora = (await pool.query(`SELECT custo_hora_eur FROM demo.tipos_meio WHERE codigo = 'OP'`)).rows[0]?.custo_hora_eur;
    } else {
      const { rows } = await pool.query(
        `SELECT v.classe, t.custo_hora_eur FROM viaturas v LEFT JOIN demo.tipos_meio t ON t.codigo = v.classe WHERE v.id = $1`, [b.viatura_id]);
      if (!rows[0]) throw erro(404, 'Viatura não encontrada.');
      custoHora = CLASSES_LIGEIRAS.includes(rows[0].classe) ? null : rows[0].custo_hora_eur;
    }
    // Ter meios afectos é estar planeada, venham eles da recomendação ou
    // daqui: a primeira afectação passa a empreitada de seleccionada a
    // planeada, e as datas previstas alargam-se para cobrir o meio (as que
    // já lá estavam não encolhem). Tudo numa só instrução, logo atómico.
    const { rows } = await pool.query(
      `WITH ins AS (
         INSERT INTO demo.empreitada_meios (empreitada_id, viatura_id, operacional_id, operacao, inicio, fim,
                                            horas_previstas, custo_previsto, origem)
         VALUES ($1, $2, $3, $4, ($5 || ' 08:00')::timestamp AT TIME ZONE 'Europe/Lisbon',
                 ($6 || ' 17:00')::timestamp AT TIME ZONE 'Europe/Lisbon', $7, $8, 'manual') RETURNING id),
       upd AS (
         UPDATE demo.empreitadas SET
                estado = CASE WHEN estado = 'seleccionada' THEN 'planeada' ELSE estado END,
                inicio_previsto = LEAST(inicio_previsto, $5::date),
                fim_previsto    = GREATEST(fim_previsto, $6::date), updated_at = now()
          WHERE id = $1 RETURNING estado)
       SELECT (SELECT id FROM ins) AS id, (SELECT estado FROM upd) AS estado`,
      [req.params.id, b.viatura_id || null, b.operacional_id || null, b.operacao || null, b.inicio, b.fim,
       horas, custoHora == null ? null : Math.round(horas * custoHora * 100) / 100]);
    res.status(201).json(rows[0]);
  }));

  app.delete('/api/demo/empreitadas/:id/meios/:meio', ...leitura, wrap(async (req, res) => {
    // Sem meios, uma empreitada planeada volta a seleccionada; as datas
    // ficam. (Na mesma instrução, o SELECT ainda vê o meio apagado: daí o
    // id <> $1.)
    const { rows: [r] } = await pool.query(
      `WITH del AS (DELETE FROM demo.empreitada_meios WHERE id = $1 AND empreitada_id = $2 RETURNING id),
       upd AS (
         UPDATE demo.empreitadas SET estado = 'seleccionada', updated_at = now()
          WHERE id = $2 AND estado = 'planeada' AND EXISTS (SELECT 1 FROM del)
            AND NOT EXISTS (SELECT 1 FROM demo.empreitada_meios WHERE empreitada_id = $2 AND id <> $1)
          RETURNING estado)
       SELECT (SELECT count(*) FROM del)::int AS n, (SELECT estado FROM upd) AS estado`,
      [req.params.meio, req.params.id]);
    if (!r.n) return res.status(404).json({ error: 'Afectação não encontrada.' });
    res.json({ ok: true, estado: r.estado });
  }));

  // ── Execução ───────────────────────────────────────────────────

  app.get('/api/demo/empreitadas/:id/execucao', ...leitura, wrap(async (req, res) => {
    const ex = await execucao.resumoExecucao(pool, req.params.id);
    res.json({ ...ex, area: await terreno.resumoArea(pool, req.params.id, ex) });
  }));

  // ── Execução no terreno ────────────────────────────────────────

  // Numa transacção: a primeira leitura gera a grelha por omissão.
  const emTransaccao = async fn => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  };

  app.get('/api/demo/empreitadas/:id/terreno', ...leitura, wrap(async (req, res) => {
    res.json(await emTransaccao(c => terreno.lerTerreno(c, req.params.id, req.user)));
  }));

  // Muda a divisão: { modo: 'grelha', tamanho } ou { modo: 'manual', partes | cortes }.
  // Os registos ficam como estão: guardam a própria geometria.
  app.put('/api/demo/empreitadas/:id/divisao', ...leitura, wrap(async (req, res) => {
    const b = req.body || {};
    res.json(await emTransaccao(async c => {
      const e = await terreno.lerEmpreitada(c, req.params.id);
      if (b.modo === 'grelha') await terreno.gerarGrelha(c, e, b.tamanho);
      else if (b.modo === 'manual') await terreno.divisaoManual(c, e, b);
      else throw erro(400, 'Modo de divisão inválido.');
      return terreno.lerTerreno(c, req.params.id, req.user);
    }));
  }));

  app.post('/api/demo/empreitadas/:id/registos', ...leitura, wrap(async (req, res) => {
    res.status(201).json(await emTransaccao(c => terreno.registar(c, req.params.id, req.body || {}, req.user)));
  }));

  app.delete('/api/demo/empreitadas/:id/registos/:rid', ...leitura, wrap(async (req, res) => {
    await emTransaccao(c => terreno.anular(c, req.params.id, req.params.rid, req.user));
    res.json({ ok: true });
  }));

  app.get('/api/demo/empreitadas/:id/horas', ...leitura, wrap(async (req, res) => {
    const data = /^\d{4}-\d{2}-\d{2}$/.test(req.query.data || '') ? req.query.data : null;
    res.json(await execucao.lerFolha(pool, req.params.id, data));
  }));

  app.put('/api/demo/empreitadas/:id/horas', ...leitura, wrap(async (req, res) => {
    const b = req.body || {};
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await execucao.gravarFolha(c, req.params.id, b.data, b.registos, req.user.id);
      await c.query('COMMIT');
      res.json(r);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }));

  // Repor a demonstração: apaga tudo o que se fez e volta a gerar as fontes
  // externas e os cenários com a data de hoje. Só o administrador.
  app.post('/api/demo/repor', requireAuth('admin'), wrap(async (req, res) => {
    res.json(await reporDadosDemo(pool));
  }));
};
