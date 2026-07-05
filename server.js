'use strict';
const express  = require('express');
const { Pool } = require('pg');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const path     = require('path');

const app  = express();
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
});

const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret-CHANGE-IN-PRODUCTION';
const JWT_EXPIRES = '12h';
const PORT        = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'Gestao_Meios_v17.html')));

// ─── Role ordering ────────────────────────────────────────────────
const ROLE_ORDER = ['visualizador', 'operacional', 'ofligacao', 'admin'];

function requireAuth(minRole = 'visualizador') {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      return res.status(401).json({ error: 'Não autenticado.' });
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
      if (ROLE_ORDER.indexOf(req.user.role) < ROLE_ORDER.indexOf(minRole))
        return res.status(403).json({ error: 'Sem permissão.' });
      next();
    } catch {
      res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    }
  };
}

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
  };
}

// ══════════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════════
app.post('/api/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email e password obrigatórios.' });

  const { rows } = await pool.query(
    'SELECT * FROM utilizadores WHERE email = $1',
    [email.trim().toLowerCase()]
  );
  const user = rows[0];

  if (!user || !await bcrypt.compare(password, user.password_hash))
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  if (!user.ativo)
    return res.status(401).json({ error: 'Conta inativa. Contacte o administrador.' });

  const token = jwt.sign(
    { id: user.id, role: user.role, nome: user.nome, subregiao: user.subregiao },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
  res.json({ token, id: user.id, role: user.role, nome: user.nome, subregiao: user.subregiao });
}));

// ══════════════════════════════════════════════════════════════════
//  OCORRÊNCIAS
// ══════════════════════════════════════════════════════════════════
app.get('/api/ocorrencias', requireAuth('visualizador'), wrap(async (req, res) => {
  let q = 'SELECT * FROM ocorrencias ORDER BY created_at DESC';
  let params = [];
  if (req.user.role === 'ofligacao' && req.user.subregiao) {
    q = 'SELECT * FROM ocorrencias WHERE subregiao = $1 ORDER BY created_at DESC';
    params = [req.user.subregiao];
  }
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

app.post('/api/ocorrencias', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    `INSERT INTO ocorrencias
       (local_ignicao, codigo_ocorrencia, subregiao, concelho, obs, inicio, status, created_by, oficial_ligacao_id, oficial_ligacao_nome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING *`,
    [b.local_ignicao, b.codigo_ocorrencia || null, b.subregiao || null, b.concelho || null,
     b.obs || null, b.inicio || null, b.status || 'active', req.user.id, req.user.nome]
  );
  res.json(rows[0]);
}));

app.patch('/api/ocorrencias/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  await pool.query(
    `UPDATE ocorrencias
     SET local_ignicao        = COALESCE($1, local_ignicao),
         codigo_ocorrencia    = COALESCE($2, codigo_ocorrencia),
         subregiao            = COALESCE($3, subregiao),
         concelho             = COALESCE($4, concelho),
         obs                  = COALESCE($5, obs),
         inicio               = COALESCE($6, inicio),
         status               = COALESCE($7, status),
         oficial_ligacao_id   = COALESCE($8, oficial_ligacao_id),
         oficial_ligacao_nome = COALESCE($9, oficial_ligacao_nome)
     WHERE id=$10`,
    [b.local_ignicao || null, b.codigo_ocorrencia || null, b.subregiao || null, b.concelho || null,
     b.obs || null, b.inicio || null, b.status || null, b.oficial_ligacao_id || null, b.oficial_ligacao_nome || null, req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/ocorrencias/:id', requireAuth('admin'), wrap(async (req, res) => {
  await pool.query('DELETE FROM ocorrencias WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  MEIOS
// ══════════════════════════════════════════════════════════════════
const MEIO_COLS = [
  'ocorrencia_id','eq','tipo','matricula','concelho','setor',
  'operacionais','responsavel','contacto',
  'data_despacho','hora_despacho','data_saida_entidade','hora_saida_entidade',
  'data_chegada','hora_chegada','horas_max','limite_op','limite_op_date',
  'data_demob','hora_demob','data_chegada_entidade','hora_chegada_entidade',
  'km','missao','estado','obs',
  'previsto_data','previsto_hora',
  'equipa_id','transporte_id',
];

// Estados que tornam um meio "indisponível" para outras ocorrências
const ACTIVE_ESTADOS = ['transito','operacao','descanso'];

// Devolve a ocorrência onde `equipaId` já está activo (se houver), excluindo `excludeId`
async function findEquipaConflict(equipaId, estado, excludeId) {
  if (!equipaId || !ACTIVE_ESTADOS.includes(estado)) return null;
  const { rows } = await pool.query(
    `SELECT o.local_ignicao FROM meios m
     JOIN ocorrencias o ON o.id = m.ocorrencia_id
     WHERE m.equipa_id = $1 AND m.estado = ANY($2) AND m.id <> $3
     LIMIT 1`,
    [equipaId, ACTIVE_ESTADOS, excludeId || '00000000-0000-0000-0000-000000000000']
  );
  return rows[0] || null;
}

// Indica se existe um pedido de remoção pendente para este meio
async function hasPendingDeleteRequest(meioId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM meio_delete_requests WHERE meio_id = $1 AND status = 'pending'`,
    [meioId]
  );
  return rows.length > 0;
}

app.get('/api/meios', requireAuth('visualizador'), wrap(async (req, res) => {
  const [{ rows: meios }, { rows: operativos }, { rows: eventos }] = await Promise.all([
    pool.query('SELECT * FROM meios ORDER BY created_at'),
    pool.query('SELECT * FROM meios_operativos ORDER BY meio_id, ordem'),
    pool.query('SELECT * FROM meios_eventos ORDER BY ts DESC'),
  ]);
  const result = meios.map(m => ({
    ...m,
    meios_operativos: operativos.filter(o => o.meio_id === m.id),
    meios_eventos:    eventos.filter(e => e.meio_id === m.id),
  }));
  res.json(result);
}));

app.post('/api/meios', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  if (b.tipo === 'MR' && !b.transporte_id) {
    return res.status(400).json({ error: 'Um meio do tipo MR tem de ter um PM (transporte) associado.' });
  }
  const conflict = await findEquipaConflict(b.equipa_id, b.estado, null);
  if (conflict) {
    return res.status(409).json({ error: `Este meio já está activo na ocorrência "${conflict.local_ignicao}".` });
  }
  const cols = [...MEIO_COLS, 'created_by'];
  const vals = [...MEIO_COLS.map(c => b[c] ?? null), req.user.id];
  const ph   = cols.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(
    `INSERT INTO meios (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals
  );
  res.json(rows[0]);
}));

app.patch('/api/meios/:id', requireAuth('operacional'), wrap(async (req, res) => {
  const b = req.body;
  // Only update columns present in the body — partial rows from quick actions
  // must not null out NOT NULL columns like ocorrencia_id or eq.
  const cols = MEIO_COLS.filter(c => c in b);
  if (!cols.length) return res.json({ ok: true });

  if (await hasPendingDeleteRequest(req.params.id)) {
    return res.status(409).json({ error: 'Este meio tem um pedido de remoção pendente e não pode ser editado.' });
  }

  if ('estado' in b && ACTIVE_ESTADOS.includes(b.estado)) {
    let equipaId = b.equipa_id;
    if (equipaId === undefined) {
      const { rows } = await pool.query('SELECT equipa_id FROM meios WHERE id=$1', [req.params.id]);
      equipaId = rows[0]?.equipa_id;
    }
    const conflict = await findEquipaConflict(equipaId, b.estado, req.params.id);
    if (conflict) {
      return res.status(409).json({ error: `Este meio já está activo na ocorrência "${conflict.local_ignicao}".` });
    }
  }

  const sets = cols.map((c, i) => `${c}=$${i + 1}`).join(',');
  const vals = [...cols.map(c => b[c] ?? null), req.params.id];
  await pool.query(`UPDATE meios SET ${sets} WHERE id=$${cols.length + 1}`, vals);

  // PM desmobilizado: liberta o transporte para que possa ser reatribuído a outro MR/ocorrência
  if (b.estado === 'desmobilizado') {
    await pool.query('UPDATE meios SET transporte_id = NULL WHERE transporte_id = $1', [req.params.id]);
  }

  res.json({ ok: true });
}));

// Remoção directa — apenas admin. Oficiais de ligação têm de submeter um pedido (ver /delete-request).
app.delete('/api/meios/:id', requireAuth('admin'), wrap(async (req, res) => {
  await pool.query('DELETE FROM meios WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Replace all operativos for a meio in one shot
app.put('/api/meios/:id/operativos', requireAuth('operacional'), wrap(async (req, res) => {
  if (await hasPendingDeleteRequest(req.params.id)) {
    return res.status(409).json({ error: 'Este meio tem um pedido de remoção pendente e não pode ser editado.' });
  }
  const rows = req.body.rows || [];
  await pool.query('DELETE FROM meios_operativos WHERE meio_id = $1', [req.params.id]);
  if (rows.length) {
    const vals = rows.flatMap((r, i) => [req.params.id, r.nome, i]);
    const ph   = rows.map((_, i) => `($${i * 3 + 1},$${i * 3 + 2},$${i * 3 + 3})`).join(',');
    await pool.query(`INSERT INTO meios_operativos (meio_id,nome,ordem) VALUES ${ph}`, vals);
  }
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  PEDIDOS DE REMOÇÃO DE MEIOS
// ══════════════════════════════════════════════════════════════════

// Oficial de ligação solicita a remoção de um meio — fica pendente até um admin decidir
app.post('/api/meios/:id/delete-request', requireAuth('ofligacao'), wrap(async (req, res) => {
  const { rows: meioRows } = await pool.query('SELECT id, eq, tipo, ocorrencia_id FROM meios WHERE id=$1', [req.params.id]);
  const meio = meioRows[0];
  if (!meio) return res.status(404).json({ error: 'Meio não encontrado.' });
  if (await hasPendingDeleteRequest(meio.id)) {
    return res.status(409).json({ error: 'Já existe um pedido de remoção pendente para este meio.' });
  }
  const { rows } = await pool.query(
    `INSERT INTO meio_delete_requests (meio_id, ocorrencia_id, meio_eq, meio_tipo, motivo, requested_by, requested_nome)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [meio.id, meio.ocorrencia_id, meio.eq, meio.tipo, req.body.motivo || null, req.user.id, req.user.nome]
  );
  res.json(rows[0]);
}));

// Lista pedidos: admin vê todos; restantes vêem os pendentes (para saber o que está bloqueado) + os próprios
app.get('/api/delete-requests', requireAuth('visualizador'), wrap(async (req, res) => {
  let query, params;
  if (req.user.role === 'admin') {
    query = `SELECT dr.*, o.local_ignicao FROM meio_delete_requests dr JOIN ocorrencias o ON o.id = dr.ocorrencia_id ORDER BY dr.created_at DESC`;
    params = [];
  } else {
    query = `SELECT dr.*, o.local_ignicao FROM meio_delete_requests dr JOIN ocorrencias o ON o.id = dr.ocorrencia_id WHERE dr.status = 'pending' OR dr.requested_by = $1 ORDER BY dr.created_at DESC`;
    params = [req.user.id];
  }
  const { rows } = await pool.query(query, params);
  res.json(rows);
}));

// Admin aprova: remove o meio definitivamente
app.post('/api/delete-requests/:id/approve', requireAuth('admin'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM meio_delete_requests WHERE id=$1', [req.params.id]);
  const dr = rows[0];
  if (!dr) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (dr.status !== 'pending') return res.status(409).json({ error: 'Este pedido já foi resolvido.' });
  await pool.query('DELETE FROM meios WHERE id=$1', [dr.meio_id]);
  await pool.query(
    `UPDATE meio_delete_requests SET status='approved', resolved_by=$1, resolved_nome=$2, resolved_at=NOW() WHERE id=$3`,
    [req.user.id, req.user.nome, dr.id]
  );
  res.json({ ok: true });
}));

// Admin rejeita: o meio mantém-se e fica novamente editável
app.post('/api/delete-requests/:id/reject', requireAuth('admin'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM meio_delete_requests WHERE id=$1', [req.params.id]);
  const dr = rows[0];
  if (!dr) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (dr.status !== 'pending') return res.status(409).json({ error: 'Este pedido já foi resolvido.' });
  await pool.query(
    `UPDATE meio_delete_requests SET status='rejected', resolved_by=$1, resolved_nome=$2, resolved_at=NOW() WHERE id=$3`,
    [req.user.id, req.user.nome, dr.id]
  );
  res.json({ ok: true });
}));

app.post('/api/meios_eventos', requireAuth('operacional'), wrap(async (req, res) => {
  const b = req.body;
  await pool.query(
    'INSERT INTO meios_eventos (meio_id, ts, msg, user_id) VALUES ($1,$2,$3,$4)',
    [b.meio_id, b.ts || new Date().toISOString(), b.msg, req.user.id]
  );
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  OCORRÊNCIAS EVENTOS
// ══════════════════════════════════════════════════════════════════
app.get('/api/ocorrencias_eventos', requireAuth('visualizador'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM ocorrencias_eventos ORDER BY ts DESC');
  res.json(rows);
}));

app.post('/api/ocorrencias_eventos', requireAuth('operacional'), wrap(async (req, res) => {
  const b = req.body;
  await pool.query(
    'INSERT INTO ocorrencias_eventos (ocorrencia_id, ts, tag, meio_label, msg, user_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [b.ocorrencia_id, b.ts || new Date().toISOString(), b.tag || 'occ', b.meio_label || null, b.msg, req.user.id]
  );
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  FITA DO TEMPO
// ══════════════════════════════════════════════════════════════════
app.get('/api/ocorrencias/:id/timeline', requireAuth('visualizador'), wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT ts, categoria, titulo, descricao, dados, autor_nome, meio_eq FROM (
      SELECT ot.ts, ot.categoria, ot.titulo, ot.descricao, ot.dados, ot.autor_nome,
             m.eq AS meio_eq
      FROM ocorrencia_timeline ot
      LEFT JOIN meios m ON m.id = ot.meio_id
      WHERE ot.ocorrencia_id = $1

      UNION ALL

      SELECT oe.ts, 'ocorrencia', oe.msg, NULL, NULL::JSONB, NULL, NULL
      FROM ocorrencias_eventos oe
      WHERE oe.ocorrencia_id = $1

      UNION ALL

      SELECT me.ts, 'meios_icnf', me.msg, NULL,
             jsonb_build_object('missao', m.missao, 'estado', m.estado),
             NULL, m.eq
      FROM meios_eventos me
      JOIN meios m ON m.id = me.meio_id
      WHERE m.ocorrencia_id = $1
    ) sub
    ORDER BY ts DESC
  `, [req.params.id]);
  res.json(rows);
}));

app.post('/api/ocorrencias/:id/timeline', requireAuth('operacional'), wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    `INSERT INTO ocorrencia_timeline
       (ocorrencia_id, ts, categoria, titulo, descricao, dados, autor_nome, autor_id, meio_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.params.id, b.ts || new Date().toISOString(), b.categoria, b.titulo || null,
     b.descricao || null, b.dados ? JSON.stringify(b.dados) : null,
     req.user.nome, req.user.id, b.meio_id || null]
  );
  res.json(rows[0]);
}));

// ══════════════════════════════════════════════════════════════════
//  EQUIPAS
// ══════════════════════════════════════════════════════════════════
app.get('/api/equipas', requireAuth('visualizador'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM equipas ORDER BY nome');
  res.json(rows);
}));

app.post('/api/equipas', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    'INSERT INTO equipas (nome, tipo, tipo_equipa, subregiao, concelho, capacidade, origem, notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [b.nome, b.tipo || null, b.tipo_equipa || null, b.subregiao || null, b.concelho || null,
     b.capacidade || 0, b.origem || null, b.notas || null]
  );
  res.json(rows[0]);
}));

app.patch('/api/equipas/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  await pool.query(
    `UPDATE equipas SET nome=$1, tipo=$2, tipo_equipa=$3, subregiao=$4, concelho=$5,
     capacidade=$6, origem=$7, notas=$8 WHERE id=$9`,
    [b.nome, b.tipo || null, b.tipo_equipa || null, b.subregiao || null, b.concelho || null,
     b.capacidade || 0, b.origem || null, b.notas || null, req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/equipas/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  await pool.query('DELETE FROM equipas WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  OPERACIONAIS PREDEFINIDOS
// ══════════════════════════════════════════════════════════════════
app.get('/api/operacionais', requireAuth('visualizador'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM operacionais_predefinidos ORDER BY nome');
  res.json(rows);
}));

app.post('/api/operacionais', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    'INSERT INTO operacionais_predefinidos (nome, categoria, contacto, notas) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.nome, b.categoria || null, b.contacto || null, b.notas || null]
  );
  res.json(rows[0]);
}));

app.patch('/api/operacionais/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  await pool.query(
    'UPDATE operacionais_predefinidos SET nome=$1, categoria=$2, contacto=$3, notas=$4 WHERE id=$5',
    [b.nome, b.categoria || null, b.contacto || null, b.notas || null, req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/operacionais/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  await pool.query('DELETE FROM operacionais_predefinidos WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Lista de candidatos a Oficial de Ligação (para transferir o papel numa ocorrência)
app.get('/api/utilizadores/ofligacao', requireAuth('ofligacao'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, nome, subregiao FROM utilizadores
     WHERE role IN ('ofligacao','admin') AND ativo = true ORDER BY nome`
  );
  res.json(rows);
}));

// ══════════════════════════════════════════════════════════════════
//  UTILIZADORES (admin only)
// ══════════════════════════════════════════════════════════════════
app.get('/api/utilizadores', requireAuth('admin'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, nome, role, subregiao, ativo, created_at FROM utilizadores ORDER BY created_at'
  );
  res.json(rows);
}));

app.post('/api/utilizadores', requireAuth('admin'), wrap(async (req, res) => {
  const { email, nome, password, role, subregiao } = req.body || {};
  if (!email || !nome || !password)
    return res.status(400).json({ error: 'Email, nome e password obrigatórios.' });
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO utilizadores (email, nome, password_hash, role, subregiao, ativo)
     VALUES ($1,$2,$3,$4,$5,true)
     RETURNING id, email, nome, role, subregiao, ativo, created_at`,
    [email.trim().toLowerCase(), nome.trim(), hash, role || 'visualizador', subregiao || null]
  );
  res.json(rows[0]);
}));

app.patch('/api/utilizadores/:id', requireAuth('admin'), wrap(async (req, res) => {
  const { role, subregiao, ativo, password } = req.body || {};
  if (password !== undefined) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE utilizadores SET password_hash=$1 WHERE id=$2', [hash, req.params.id]);
  }
  if (role !== undefined)
    await pool.query('UPDATE utilizadores SET role=$1 WHERE id=$2', [role, req.params.id]);
  if (subregiao !== undefined)
    await pool.query('UPDATE utilizadores SET subregiao=$1 WHERE id=$2', [subregiao || null, req.params.id]);
  if (ativo !== undefined)
    await pool.query('UPDATE utilizadores SET ativo=$1 WHERE id=$2', [ativo, req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/utilizadores/:id', requireAuth('admin'), wrap(async (req, res) => {
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: 'Não pode eliminar a sua própria conta.' });
  await pool.query('DELETE FROM utilizadores WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ─── Proxy fogos.pt (browser directo é bloqueado por Cloudflare) ─
app.get('/api/fogos/active', requireAuth('visualizador'), wrap(async (req, res) => {
  const r = await fetch('https://api.fogos.pt/v2/incidents/active', {
    headers: { 'User-Agent': 'GestaoMeiosGFR/1.0' },
  });
  if (!r.ok) return res.status(502).json({ success: false, error: 'fogos.pt indisponível' });
  const data = await r.json();
  res.json(data);
}));

// ─── Startup migrations ──────────────────────────────────────────
async function runMigrations() {
  const fs = require('fs');

  // Aplicar schema base (idempotente — usa CREATE TABLE/INDEX IF NOT EXISTS)
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);
  console.log('Schema aplicado.');
}

// ─── Start ────────────────────────────────────────────────────────
if (require.main === module) {
  runMigrations()
    .then(() => app.listen(PORT, () => console.log(`Gestão Meios a correr na porta ${PORT}`)))
    .catch(err => { console.error('Erro na migração:', err.message); process.exit(1); });
}

module.exports = { app, pool };
