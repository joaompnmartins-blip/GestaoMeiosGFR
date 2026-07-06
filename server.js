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
const ROLE_ORDER   = ['visualizador', 'operacional', 'ofligacao', 'ofligacao_ccon', 'admin'];
const MODULE_ROLES = ['gestor_sf', 'gestor_fsbf', 'gestor_icnf'];

function requireAuth(minRole = 'visualizador') {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      return res.status(401).json({ error: 'Não autenticado.' });
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
      const role = req.user.role;
      if (role === 'admin') return next();
      // Roles de módulo têm acesso de leitura (visualizador) na app principal
      if (MODULE_ROLES.includes(role)) {
        if (minRole === 'visualizador') return next();
        return res.status(403).json({ error: 'Sem permissão.' });
      }
      if (ROLE_ORDER.indexOf(role) < ROLE_ORDER.indexOf(minRole))
        return res.status(403).json({ error: 'Sem permissão.' });
      next();
    } catch {
      res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    }
  };
}

// Middleware para rotas dos módulos de gestão
function requireModule(...moduleRoles) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ error: 'Não autenticado.' });
    if (role === 'admin' || moduleRoles.includes(role)) return next();
    return res.status(403).json({ error: 'Sem permissão para este módulo.' });
  };
}

// Middleware para rotas exclusivas do CCON (OL nacional)
function requireCCON(req, res, next) {
  const role = req.user?.role;
  if (!role) return res.status(401).json({ error: 'Não autenticado.' });
  if (role === 'admin' || role === 'ofligacao_ccon') return next();
  return res.status(403).json({ error: 'Reservado ao Oficial de Ligação CCON.' });
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
  'ocorrencia_id','recurso_id','viatura_id','composicao_id','meio_pai_id',
  'eq','tipo','matricula','concelho','setor',
  'operacionais','responsavel','contacto',
  'data_despacho','hora_despacho','data_saida_entidade','hora_saida_entidade',
  'data_chegada','hora_chegada','horas_max','limite_op','limite_op_date',
  'data_demob','hora_demob','data_chegada_entidade','hora_chegada_entidade',
  'km','missao','estado','obs',
  'previsto_data','previsto_hora',
];

const ACTIVE_ESTADOS  = ['transito','operacao','descanso'];
const OCUPADO_ESTADOS = ['previsto','transito','operacao','descanso'];

async function findRecursoConflict(recursoId, estado, excludeId) {
  if (!recursoId || !ACTIVE_ESTADOS.includes(estado)) return null;
  const { rows } = await pool.query(
    `SELECT o.local_ignicao FROM meios m
     JOIN ocorrencias o ON o.id = m.ocorrencia_id
     WHERE m.recurso_id = $1 AND m.estado = ANY($2) AND m.id <> $3
     LIMIT 1`,
    [recursoId, ACTIVE_ESTADOS, excludeId || '00000000-0000-0000-0000-000000000000']
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
  const conflict = await findRecursoConflict(b.recurso_id, b.estado, null);
  if (conflict) {
    return res.status(409).json({ error: `Este recurso já está activo na ocorrência "${conflict.local_ignicao}".` });
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
    let recursoId = b.recurso_id;
    if (recursoId === undefined) {
      const { rows } = await pool.query('SELECT recurso_id FROM meios WHERE id=$1', [req.params.id]);
      recursoId = rows[0]?.recurso_id;
    }
    const conflict = await findRecursoConflict(recursoId, b.estado, req.params.id);
    if (conflict) {
      return res.status(409).json({ error: `Este recurso já está activo na ocorrência "${conflict.local_ignicao}".` });
    }
  }

  const sets = cols.map((c, i) => `${c}=$${i + 1}`).join(',');
  const vals = [...cols.map(c => b[c] ?? null), req.params.id];
  await pool.query(`UPDATE meios SET ${sets} WHERE id=$${cols.length + 1}`, vals);

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
//  EQUIPAS (compatibilidade — mapeado para recursos)
// ══════════════════════════════════════════════════════════════════
app.get('/api/equipas', requireAuth('visualizador'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM equipas_compat ORDER BY nome');
  res.json(rows);
}));

app.post('/api/equipas', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  const tipo = b.tipo || 'ESF';
  const { rows } = await pool.query(
    `INSERT INTO recursos (codigo, tipo, num_elementos, subregiao, concelho, notas, ativo)
     VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id, codigo AS nome, tipo, subregiao, concelho`,
    [b.nome, tipo, b.capacidade || 1, b.subregiao || null, b.concelho || null, b.notas || null]
  );
  res.json(rows[0]);
}));

app.patch('/api/equipas/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  await pool.query(
    `UPDATE recursos SET codigo=$1, tipo=$2, subregiao=$3, concelho=$4, num_elementos=$5, updated_at=now()
     WHERE id=$6`,
    [b.nome, b.tipo || 'ESF', b.subregiao || null, b.concelho || null, b.capacidade || 1, req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/equipas/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  await pool.query('UPDATE recursos SET ativo=false WHERE id=$1', [req.params.id]);
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
     WHERE role IN ('ofligacao','ofligacao_ccon','admin') AND ativo = true ORDER BY nome`
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

// ══════════════════════════════════════════════════════════════════
//  CATÁLOGO — RECURSOS
// ══════════════════════════════════════════════════════════════════

// §5.2 — Lista recursos para despacho (com prontidão e disponibilidade)
app.get('/api/recursos', requireAuth('visualizador'), wrap(async (req, res) => {
  const { tipo, subregiao, categoria } = req.query;
  const { rows } = await pool.query(`
    SELECT r.id, r.codigo, r.tipo, rt.categoria, r.subregiao, r.concelho,
           r.num_elementos, r.entidade, r.contacto,
           r.prontidao, r.prontidao_motivo, r.prontidao_ate,
           r.ativo,
           (m.id IS NOT NULL) AS em_uso,
           m.ocorrencia_id    AS ocorrencia_em_uso,
           o.local_ignicao    AS ocorrencia_nome
    FROM recursos r
    JOIN recurso_tipos rt ON rt.codigo = r.tipo
    LEFT JOIN meios m ON m.recurso_id = r.id
                     AND m.estado = ANY($4)
    LEFT JOIN ocorrencias o ON o.id = m.ocorrencia_id
    WHERE r.ativo
      AND ($1::text IS NULL OR r.tipo      = $1)
      AND ($2::text IS NULL OR r.subregiao = $2)
      AND ($3::text IS NULL OR rt.categoria = $3)
    ORDER BY r.tipo, r.codigo
  `, [tipo || null, subregiao || null, categoria || null, OCUPADO_ESTADOS]);
  res.json(rows);
}));

// §5.1 — Recurso com viaturas e rádios (payload de despacho)
app.get('/api/recursos/tipos', requireAuth('visualizador'), wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT rt.codigo, rt.categoria, f.codigo AS fonte
    FROM recurso_tipos rt JOIN fontes f ON f.id = rt.fonte_id
    ORDER BY f.codigo, rt.codigo
  `);
  res.json(rows);
}));

app.get('/api/recursos/:id', requireAuth('visualizador'), wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*,
           COALESCE(v.viaturas, '[]') AS viaturas,
           COALESCE(rd.radios,  '[]') AS radios
    FROM recursos r
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'id', v.id, 'viatura_cod', v.viatura_cod, 'classe', v.classe,
               'matricula', v.matricula, 'tipo_decir', v.tipo_decir,
               'prontidao', v.prontidao,
               'radios', (SELECT COALESCE(json_agg(json_build_object(
                            'ddi', x.ddi, 'tipo', x.tipo, 'indicativo', x.indicativo)), '[]')
                          FROM radios x WHERE x.viatura_id = v.id AND x.ativo)
             )) AS viaturas
      FROM viaturas v WHERE v.recurso_id = r.id AND v.ativo
    ) v ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('ddi', x.ddi, 'tipo', x.tipo,
               'indicativo', x.indicativo, 'alias', x.alias)) AS radios
      FROM radios x WHERE x.recurso_id = r.id AND x.ativo
    ) rd ON true
    WHERE r.id = $1
  `, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Recurso não encontrado.' });
  res.json(rows[0]);
}));

// ══════════════════════════════════════════════════════════════════
//  CATÁLOGO — COMPOSIÇÕES
// ══════════════════════════════════════════════════════════════════

// §5.3 — Lista composições com prontidão derivada
app.get('/api/composicoes', requireAuth('visualizador'), wrap(async (req, res) => {
  const { tipo } = req.query;
  const { rows } = await pool.query(`
    SELECT c.id, c.codigo, c.tipo, c.subregiao, c.concelho,
           c.predefinida, c.notas, c.ativo,
           json_agg(json_build_object(
             'id', cm.id, 'papel', cm.papel, 'ordem', cm.ordem,
             'recurso', CASE WHEN r.id IS NOT NULL THEN json_build_object(
               'id', r.id, 'codigo', r.codigo, 'tipo', r.tipo, 'prontidao', r.prontidao) END,
             'viatura', CASE WHEN v.id IS NOT NULL THEN json_build_object(
               'id', v.id, 'viatura_cod', v.viatura_cod, 'prontidao', v.prontidao) END,
             'em_uso', (mr.id IS NOT NULL OR mv.id IS NOT NULL)
           ) ORDER BY cm.ordem) AS membros,
           CASE
             WHEN bool_or(mr.id IS NOT NULL OR mv.id IS NOT NULL
                          OR r.prontidao = 'inoperacional' OR v.prontidao = 'inoperacional')
               THEN 'inoperacional'
             ELSE 'operacional'
           END AS prontidao_derivada
    FROM composicoes c
    JOIN composicao_membros cm ON cm.composicao_id = c.id
    LEFT JOIN recursos  r  ON r.id  = cm.recurso_id
    LEFT JOIN viaturas  v  ON v.id  = cm.viatura_id
    LEFT JOIN meios     mr ON mr.recurso_id = r.id AND mr.estado = ANY($2)
    LEFT JOIN meios     mv ON mv.viatura_id = v.id AND mv.estado = ANY($2)
    WHERE c.ativo
      AND ($1::text IS NULL OR c.tipo = $1)
    GROUP BY c.id
    ORDER BY c.tipo, c.codigo
  `, [tipo || null, OCUPADO_ESTADOS]);
  res.json(rows);
}));

// Criar composição (valida regras §3.2 na camada de aplicação)
app.post('/api/composicoes', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.codigo || !b.tipo) return res.status(400).json({ error: 'codigo e tipo obrigatórios.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [comp] } = await client.query(
      `INSERT INTO composicoes (codigo, tipo, subregiao, concelho, predefinida, notas, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.codigo, b.tipo, b.subregiao || null, b.concelho || null,
       b.predefinida ?? false, b.notas || null, req.user.id]
    );
    const membros = b.membros || [];
    for (let i = 0; i < membros.length; i++) {
      const m = membros[i];
      await client.query(
        `INSERT INTO composicao_membros (composicao_id, recurso_id, viatura_id, papel, ordem)
         VALUES ($1,$2,$3,$4,$5)`,
        [comp.id, m.recurso_id || null, m.viatura_id || null, m.papel, i]
      );
    }
    await client.query('COMMIT');
    res.json(comp);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// §5.4 — Instanciar composição numa ocorrência
app.post('/api/ocorrencias/:id/meios/composicao', requireAuth('ofligacao'), wrap(async (req, res) => {
  const { composicao_id, estado = 'previsto', ...camposDespacho } = req.body;
  if (!composicao_id) return res.status(400).json({ error: 'composicao_id obrigatório.' });

  const { rows: [comp] } = await pool.query(
    `SELECT c.*, json_agg(json_build_object(
       'id', cm.id, 'papel', cm.papel, 'recurso_id', cm.recurso_id, 'viatura_id', cm.viatura_id,
       'codigo', COALESCE(r.codigo, v.viatura_cod),
       'tipo',   COALESCE(r.tipo,   v.classe),
       'num_elementos', COALESCE(r.num_elementos, 1),
       'matricula', v.matricula, 'contacto', r.contacto
     ) ORDER BY cm.ordem) AS membros
     FROM composicoes c
     JOIN composicao_membros cm ON cm.composicao_id = c.id
     LEFT JOIN recursos r ON r.id = cm.recurso_id
     LEFT JOIN viaturas v ON v.id = cm.viatura_id
     WHERE c.id = $1 AND c.ativo GROUP BY c.id`,
    [composicao_id]
  );
  if (!comp) return res.status(404).json({ error: 'Composição não encontrada.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const totalOps = comp.membros.reduce((s, m) => s + (m.num_elementos || 1), 0);
    const { rows: [pai] } = await client.query(
      `INSERT INTO meios (ocorrencia_id, composicao_id, eq, tipo, estado, operacionais, created_by,
         data_despacho, hora_despacho, setor, missao, obs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.params.id, comp.id, comp.codigo, comp.tipo, estado, totalOps, req.user.id,
       camposDespacho.data_despacho || null, camposDespacho.hora_despacho || null,
       camposDespacho.setor || null, camposDespacho.missao || null, camposDespacho.obs || null]
    );

    const filhos = [];
    for (const m of comp.membros) {
      const { rows: [filho] } = await client.query(
        `INSERT INTO meios (ocorrencia_id, meio_pai_id, recurso_id, viatura_id,
           eq, tipo, matricula, contacto, estado, operacionais, created_by,
           data_despacho, hora_despacho, setor, missao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [req.params.id, pai.id, m.recurso_id || null, m.viatura_id || null,
         m.codigo, m.tipo, m.matricula || null, m.contacto || null,
         estado, m.num_elementos || 1, req.user.id,
         camposDespacho.data_despacho || null, camposDespacho.hora_despacho || null,
         camposDespacho.setor || null, camposDespacho.missao || null]
      );
      filhos.push(filho);
    }

    await client.query(
      `INSERT INTO ocorrencias_eventos (ocorrencia_id, tag, msg, user_id)
       VALUES ($1,'occ',$2,$3)`,
      [req.params.id, `Composição "${comp.codigo}" despachada (${filhos.length} membros).`, req.user.id]
    );

    await client.query('COMMIT');
    res.json({ meio_pai: pai, filhos });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Um ou mais membros já estão activos noutra ocorrência.' });
    }
    throw e;
  } finally {
    client.release();
  }
}));

// §5.5 — Alterar estado do meio pai propagando aos filhos
app.patch('/api/meios/:id/estado', requireAuth('operacional'), wrap(async (req, res) => {
  const { estado, data_despacho, hora_despacho, data_chegada, hora_chegada,
          data_demob, hora_demob, setor, missao, obs } = req.body;
  if (!estado) return res.status(400).json({ error: 'estado obrigatório.' });

  if (await hasPendingDeleteRequest(req.params.id)) {
    return res.status(409).json({ error: 'Este meio tem um pedido de remoção pendente.' });
  }

  await pool.query(
    `UPDATE meios SET estado=$2,
       data_despacho   = COALESCE($3, data_despacho),
       hora_despacho   = COALESCE($4, hora_despacho),
       data_chegada    = COALESCE($5, data_chegada),
       hora_chegada    = COALESCE($6, hora_chegada),
       data_demob      = COALESCE($7, data_demob),
       hora_demob      = COALESCE($8, hora_demob),
       setor           = COALESCE($9, setor),
       missao          = COALESCE($10, missao),
       obs             = COALESCE($11, obs),
       updated_at      = now()
     WHERE id=$1 OR meio_pai_id=$1`,
    [req.params.id, estado,
     data_despacho || null, hora_despacho || null,
     data_chegada  || null, hora_chegada  || null,
     data_demob    || null, hora_demob    || null,
     setor || null, missao || null, obs || null]
  );
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  OLN DE SERVIÇO
// ══════════════════════════════════════════════════════════════════

// §5.6 — OLN nacional actualmente de serviço
app.get('/api/oln/servico', requireAuth('visualizador'), wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.id, r.codigo AS nome, r.contacto, r.email,
           e.inicio, e.fim, e.notas
    FROM oln_escala e
    JOIN recursos r ON r.id = e.recurso_id
    WHERE now() BETWEEN e.inicio AND e.fim
    ORDER BY e.inicio
  `);
  res.json(rows);
}));

// ══════════════════════════════════════════════════════════════════
//  MÓDULOS DE GESTÃO — helpers
// ══════════════════════════════════════════════════════════════════

const ROLE_FONTE = { gestor_sf: 'SF', gestor_fsbf: 'FSBF', gestor_icnf: 'ICNF' };

// Garante que o gestor só altera recursos/viaturas da sua fonte
async function assertFonteAccess(client, recursoId, userRole) {
  if (userRole === 'admin' || userRole === 'gestor_icnf') return;
  const fonteEsperada = ROLE_FONTE[userRole];
  if (!fonteEsperada) throw Object.assign(new Error('Sem permissão.'), { status: 403 });
  const { rows } = await client.query(
    `SELECT f.codigo FROM recursos r
     JOIN recurso_tipos rt ON rt.codigo = r.tipo
     JOIN fontes f ON f.id = rt.fonte_id
     WHERE r.id = $1`, [recursoId]
  );
  if (!rows[0]) throw Object.assign(new Error('Recurso não encontrado.'), { status: 404 });
  if (rows[0].codigo !== fonteEsperada)
    throw Object.assign(new Error('Recurso pertence a outra fonte.'), { status: 403 });
}

// ══════════════════════════════════════════════════════════════════
//  MÓDULOS DE GESTÃO — RECURSOS
// ══════════════════════════════════════════════════════════════════

const ALL_GESTORES = requireModule('gestor_sf', 'gestor_fsbf', 'gestor_icnf');

app.get('/api/gestao/recursos', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const { tipo, subregiao, ativo, fonte } = req.query;
  const atvFilter = ativo === undefined ? null : ativo === 'true';

  // gestor_icnf e admin vêem todas as fontes; outros gestores só a sua
  const fullAccess = req.user.role === 'admin' || req.user.role === 'gestor_icnf';
  const fonteEfetiva = fullAccess ? (fonte || null) : ROLE_FONTE[req.user.role];

  const { rows } = await pool.query(`
    SELECT r.*, rt.categoria, f.codigo AS fonte,
           COALESCE(v.viaturas_count, 0) AS viaturas_count,
           COALESCE(rd.radios_count, 0)  AS radios_count
    FROM recursos r
    JOIN recurso_tipos rt ON rt.codigo = r.tipo
    JOIN fontes f ON f.id = rt.fonte_id
    LEFT JOIN (SELECT recurso_id, COUNT(*) AS viaturas_count FROM viaturas WHERE ativo GROUP BY recurso_id) v
           ON v.recurso_id = r.id
    LEFT JOIN (SELECT recurso_id, COUNT(*) AS radios_count FROM radios WHERE ativo GROUP BY recurso_id) rd
           ON rd.recurso_id = r.id
    WHERE ($1::text   IS NULL OR f.codigo    = $1)
      AND ($2::text   IS NULL OR r.tipo      = $2)
      AND ($3::text   IS NULL OR r.subregiao = $3)
      AND ($4::boolean IS NULL OR r.ativo    = $4)
    ORDER BY r.tipo, r.codigo
  `, [fonteEfetiva, tipo || null, subregiao || null, atvFilter]);
  res.json(rows);
}));

app.post('/api/gestao/recursos', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  if (!b.codigo || !b.tipo) return res.status(400).json({ error: 'codigo e tipo obrigatórios.' });

  // Valida que o tipo pertence à fonte do gestor
  if (req.user.role !== 'admin') {
    const { rows } = await pool.query(
      `SELECT f.codigo FROM recurso_tipos rt JOIN fontes f ON f.id = rt.fonte_id WHERE rt.codigo=$1`,
      [b.tipo]
    );
    if (!rows[0]) return res.status(400).json({ error: 'tipo inválido.' });
    if (rows[0].codigo !== ROLE_FONTE[req.user.role])
      return res.status(403).json({ error: 'Tipo pertence a outra fonte.' });
  }

  const { rows: [r] } = await pool.query(`
    INSERT INTO recursos (codigo, tipo, regime, num_elementos, entidade, local_base,
      lat_base, long_base, contacto, email, concelho, subregiao, agfr, notas, ativo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true) RETURNING *`,
    [b.codigo, b.tipo, b.regime||null, b.num_elementos||1, b.entidade||null,
     b.local_base||null, b.lat_base||null, b.long_base||null,
     b.contacto||null, b.email||null, b.concelho||null, b.subregiao||null,
     b.agfr||null, b.notas||null]
  );
  res.json(r);
}));

app.patch('/api/gestao/recursos/:id', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  await assertFonteAccess(pool, req.params.id, req.user.role);
  const b = req.body;
  const ALLOWED = ['regime','num_elementos','entidade','local_base','lat_base','long_base',
                   'contacto','email','concelho','subregiao','agfr','notas','ativo'];
  const sets = [], vals = [];
  for (const k of ALLOWED) {
    if (k in b) { sets.push(`${k}=$${vals.length+2}`); vals.push(b[k]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  sets.push('updated_at=now()');
  const { rows: [r] } = await pool.query(
    `UPDATE recursos SET ${sets.join(',')} WHERE id=$1 RETURNING *`, [req.params.id, ...vals]
  );
  res.json(r);
}));

app.delete('/api/gestao/recursos/:id', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  await assertFonteAccess(pool, req.params.id, req.user.role);
  await pool.query(`UPDATE recursos SET ativo=false, updated_at=now() WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

// ── Prontidão de recursos ───────────────────────────────────────

app.post('/api/gestao/recursos/:id/prontidao', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  await assertFonteAccess(pool, req.params.id, req.user.role);
  const { prontidao, motivo, prontidao_ate } = req.body;
  if (!['operacional','inoperacional'].includes(prontidao))
    return res.status(400).json({ error: 'prontidao deve ser operacional ou inoperacional.' });

  const { rows: [cur] } = await pool.query(
    `SELECT prontidao FROM recursos WHERE id=$1`, [req.params.id]
  );
  if (!cur) return res.status(404).json({ error: 'Recurso não encontrado.' });

  await pool.query(`
    UPDATE recursos SET prontidao=$2, prontidao_motivo=$3, prontidao_ate=$4,
      prontidao_by=$5, prontidao_at=now(), updated_at=now()
    WHERE id=$1`,
    [req.params.id, prontidao, motivo||null, prontidao_ate||null, req.user.id]
  );
  await pool.query(`
    INSERT INTO recursos_prontidao_eventos (recurso_id, de, para, motivo, user_id)
    VALUES ($1,$2,$3,$4,$5)`,
    [req.params.id, cur.prontidao, prontidao, motivo||null, req.user.id]
  );
  res.json({ ok: true });
}));

// ── Prontidão de viaturas ───────────────────────────────────────

app.post('/api/gestao/viaturas/:id/prontidao', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const { prontidao, motivo } = req.body;
  if (!['operacional','inoperacional'].includes(prontidao))
    return res.status(400).json({ error: 'prontidao deve ser operacional ou inoperacional.' });

  // Verifica fonte via recurso ligado à viatura
  if (req.user.role !== 'admin') {
    const { rows } = await pool.query(
      `SELECT f.codigo FROM viaturas v
       JOIN recursos r ON r.id = v.recurso_id
       JOIN recurso_tipos rt ON rt.codigo = r.tipo
       JOIN fontes f ON f.id = rt.fonte_id
       WHERE v.id=$1`, [req.params.id]
    );
    if (rows[0] && rows[0].codigo !== ROLE_FONTE[req.user.role])
      return res.status(403).json({ error: 'Viatura pertence a outra fonte.' });
  }

  const { rows: [v] } = await pool.query(
    `UPDATE viaturas SET prontidao=$2, prontidao_motivo=$3,
       prontidao_by=$4, prontidao_at=now(), updated_at=now()
     WHERE id=$1 RETURNING id`,
    [req.params.id, prontidao, motivo||null, req.user.id]
  );
  if (!v) return res.status(404).json({ error: 'Viatura não encontrada.' });
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  MÓDULOS DE GESTÃO — VIATURAS
// ══════════════════════════════════════════════════════════════════

app.get('/api/gestao/viaturas', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const { recurso_id, classe, megfr, ativo, disponivel } = req.query;
  const atvFilter  = ativo      === undefined ? null : ativo      === 'true';
  const dispFilter = disponivel === undefined ? null : disponivel === 'true';
  const fonteEfetiva = (req.user.role === 'admin' || req.user.role === 'gestor_icnf') ? null : ROLE_FONTE[req.user.role];

  const { rows } = await pool.query(`
    SELECT v.*, r.codigo AS recurso_codigo, f.codigo AS fonte
    FROM viaturas v
    LEFT JOIN recursos r ON r.id = v.recurso_id
    LEFT JOIN recurso_tipos rt ON rt.codigo = r.tipo
    LEFT JOIN fontes f ON f.id = rt.fonte_id
    WHERE ($1::text    IS NULL OR f.codigo     = $1)
      AND ($2::uuid    IS NULL OR v.recurso_id = $2)
      AND ($3::text    IS NULL OR v.classe     = $3)
      AND ($4::boolean IS NULL OR v.ativo      = $4)
      AND ($5::boolean IS NOT TRUE OR v.recurso_id IS NULL)
      AND ($6::text    IS NULL OR v.megfr      = $6)
    ORDER BY v.viatura_cod
  `, [fonteEfetiva, recurso_id||null, classe||null, atvFilter, dispFilter, megfr||null]);
  res.json(rows);
}));

app.patch('/api/gestao/viaturas/:id', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  const ALLOWED = ['recurso_id','matricula','marca','modelo','base','estado','agfr',
                   'lat_base','long_base','ddi_viatura','ativo'];
  const sets = [], vals = [];
  for (const k of ALLOWED) {
    if (k in b) { sets.push(`${k}=$${vals.length+2}`); vals.push(b[k]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  // Mudar recurso_id manualmente activa override
  if ('recurso_id' in b) { sets.push('manual_override=true'); }
  sets.push('updated_at=now()');
  const { rows: [v] } = await pool.query(
    `UPDATE viaturas SET ${sets.join(',')} WHERE id=$1 RETURNING *`, [req.params.id, ...vals]
  );
  if (!v) return res.status(404).json({ error: 'Viatura não encontrada.' });
  res.json(v);
}));

// ══════════════════════════════════════════════════════════════════
//  MÓDULOS DE GESTÃO — RÁDIOS
// ══════════════════════════════════════════════════════════════════

app.get('/api/gestao/radios', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const { recurso_id, viatura_id, tipo, ativo, disponivel } = req.query;
  const atvFilter  = ativo      === undefined ? null : ativo      === 'true';
  const dispFilter = disponivel === undefined ? null : disponivel === 'true';
  const fonteEfetiva = (req.user.role === 'admin' || req.user.role === 'gestor_icnf') ? null : ROLE_FONTE[req.user.role];

  const { rows } = await pool.query(`
    SELECT rd.*,
           r.codigo  AS recurso_codigo,
           v.viatura_cod,
           f.codigo  AS fonte
    FROM radios rd
    LEFT JOIN recursos r  ON r.id  = rd.recurso_id
    LEFT JOIN viaturas v  ON v.id  = rd.viatura_id
    LEFT JOIN recurso_tipos rt ON rt.codigo = r.tipo
    LEFT JOIN fontes f ON f.id = rt.fonte_id
    WHERE ($1::text    IS NULL OR f.codigo      = $1)
      AND ($2::uuid    IS NULL OR rd.recurso_id = $2)
      AND ($3::uuid    IS NULL OR rd.viatura_id = $3)
      AND ($4::text    IS NULL OR rd.tipo        = $4)
      AND ($5::boolean IS NULL OR rd.ativo       = $5)
      AND ($6::boolean IS NOT TRUE OR (rd.recurso_id IS NULL AND rd.viatura_id IS NULL))
    ORDER BY rd.ddi
  `, [fonteEfetiva, recurso_id||null, viatura_id||null, tipo||null, atvFilter, dispFilter]);
  res.json(rows);
}));

app.patch('/api/gestao/radios/:id', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  const ALLOWED = ['recurso_id','viatura_id','alias','indicativo','estado','subregiao','ativo'];
  const sets = [], vals = [];
  for (const k of ALLOWED) {
    if (k in b) { sets.push(`${k}=$${vals.length+2}`); vals.push(b[k]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  // Qualquer reatribuição de dono activa override
  if ('recurso_id' in b || 'viatura_id' in b) { sets.push('manual_override=true'); }
  sets.push('updated_at=now()');
  const { rows: [rd] } = await pool.query(
    `UPDATE radios SET ${sets.join(',')} WHERE id=$1 RETURNING *`, [req.params.id, ...vals]
  );
  if (!rd) return res.status(404).json({ error: 'Rádio não encontrado.' });
  res.json(rd);
}));

// ══════════════════════════════════════════════════════════════════
//  MÓDULOS DE GESTÃO — OLN ESCALA (só gestor_icnf / admin)
// ══════════════════════════════════════════════════════════════════

const OLN_GESTORES = requireModule('gestor_icnf');

app.get('/api/gestao/oln', requireAuth('visualizador'), OLN_GESTORES, wrap(async (req, res) => {
  const { de, ate } = req.query;
  const { rows } = await pool.query(`
    SELECT e.*, r.codigo AS recurso_codigo, r.contacto
    FROM oln_escala e
    JOIN recursos r ON r.id = e.recurso_id
    WHERE ($1::timestamptz IS NULL OR e.fim   >= $1)
      AND ($2::timestamptz IS NULL OR e.inicio <= $2)
    ORDER BY e.inicio
  `, [de||null, ate||null]);
  res.json(rows);
}));

app.post('/api/gestao/oln', requireAuth('visualizador'), OLN_GESTORES, wrap(async (req, res) => {
  const { recurso_id, inicio, fim, notas } = req.body;
  if (!recurso_id || !inicio || !fim)
    return res.status(400).json({ error: 'recurso_id, inicio e fim obrigatórios.' });
  try {
    const { rows: [slot] } = await pool.query(`
      INSERT INTO oln_escala (recurso_id, inicio, fim, notas, created_by)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [recurso_id, inicio, fim, notas||null, req.user.id]
    );
    res.json(slot);
  } catch (e) {
    if (e.code === '23P01')
      return res.status(409).json({ error: 'Sobreposição com escala existente.' });
    throw e;
  }
}));

app.delete('/api/gestao/oln/:id', requireAuth('visualizador'), OLN_GESTORES, wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM oln_escala WHERE id=$1`, [req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Slot não encontrado.' });
  res.json({ ok: true });
}));

// ── PATCH OLN slot ─────────────────────────────────────────────────
app.patch('/api/gestao/oln/:id', requireAuth('visualizador'), OLN_GESTORES, wrap(async (req, res) => {
  const { recurso_id, inicio, fim, notas } = req.body;
  const sets = [], vals = [];
  if (recurso_id !== undefined) { sets.push(`recurso_id=$${vals.length+2}`); vals.push(recurso_id); }
  if (inicio     !== undefined) { sets.push(`inicio=$${vals.length+2}`);     vals.push(inicio); }
  if (fim        !== undefined) { sets.push(`fim=$${vals.length+2}`);        vals.push(fim); }
  if (notas      !== undefined) { sets.push(`notas=$${vals.length+2}`);      vals.push(notas); }
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  try {
    const { rows: [slot] } = await pool.query(
      `UPDATE oln_escala SET ${sets.join(',')} WHERE id=$1 RETURNING *`,
      [req.params.id, ...vals]
    );
    if (!slot) return res.status(404).json({ error: 'Slot não encontrado.' });
    res.json(slot);
  } catch (e) {
    if (e.code === '23P01')
      return res.status(409).json({ error: 'Sobreposição com escala existente.' });
    throw e;
  }
}));

// ══════════════════════════════════════════════════════════════════
//  MÓDULOS DE GESTÃO — VIATURAS CREATE/DELETE
// ══════════════════════════════════════════════════════════════════

app.post('/api/gestao/viaturas', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  if (!b.viatura_cod) return res.status(400).json({ error: 'viatura_cod obrigatório.' });
  if (!b.tipo) return res.status(400).json({ error: 'tipo obrigatório (Portatil ou Viatura).' });
  const { rows: [v] } = await pool.query(`
    INSERT INTO viaturas (viatura_cod, recurso_id, megfr, tipo_decir, classe, codigo_icnf,
      tipologia, marca, modelo, chassis, matricula, entidade, base, estado, agfr,
      lat_base, long_base, ddi_viatura, ativo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true) RETURNING *`,
    [b.viatura_cod, b.recurso_id||null, b.megfr||null, b.tipo_decir||null,
     b.classe||null, b.codigo_icnf||null, b.tipologia||null, b.marca||null,
     b.modelo||null, b.chassis||null, b.matricula||null, b.entidade||null,
     b.base||null, b.estado||null, b.agfr||null,
     b.lat_base||null, b.long_base||null, b.ddi_viatura||null]
  );
  res.json(v);
}));

app.delete('/api/gestao/viaturas/:id', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const { rows: active } = await pool.query(
    `SELECT id FROM meios WHERE viatura_id=$1 AND estado NOT IN ('desmobilizado','cancelado') LIMIT 1`,
    [req.params.id]
  );
  if (active.length)
    return res.status(409).json({ error: 'Viatura em uso numa ocorrência activa. Desmobilize primeiro.' });
  const { rowCount } = await pool.query(`DELETE FROM viaturas WHERE id=$1`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Viatura não encontrada.' });
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  MÓDULOS DE GESTÃO — RÁDIOS CREATE/DELETE
// ══════════════════════════════════════════════════════════════════

app.post('/api/gestao/radios', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  if (!b.ddi)  return res.status(400).json({ error: 'ddi obrigatório.' });
  if (!b.tipo || !['Portatil','Viatura'].includes(b.tipo))
    return res.status(400).json({ error: 'tipo obrigatório: Portatil ou Viatura.' });
  const { rows: [rd] } = await pool.query(`
    INSERT INTO radios (ddi, tipo, recurso_id, viatura_id, megfr, entidade,
      alias, indicativo, estado, subregiao, ativo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING *`,
    [b.ddi, b.tipo, b.recurso_id||null, b.viatura_id||null, b.megfr||null,
     b.entidade||null, b.alias||null, b.indicativo||null, b.estado||null, b.subregiao||null]
  );
  res.json(rd);
}));

app.delete('/api/gestao/radios/:id', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM radios WHERE id=$1`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Rádio não encontrado.' });
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  MÓDULOS DE GESTÃO — EGFR ESCALA
// ══════════════════════════════════════════════════════════════════

const EGFR_GESTORES = requireModule('gestor_icnf');

app.get('/api/gestao/egfr-escala', requireAuth('visualizador'), EGFR_GESTORES, wrap(async (req, res) => {
  const { de, ate, equipa, turno } = req.query;
  const { rows } = await pool.query(`
    SELECT * FROM egfr_escala
    WHERE ($1::date IS NULL OR data >= $1)
      AND ($2::date IS NULL OR data <= $2)
      AND ($3::text IS NULL OR equipa = $3)
      AND ($4::text IS NULL OR turno  = $4)
    ORDER BY data, equipa, posicao
  `, [de||null, ate||null, equipa||null, turno||null]);
  res.json(rows);
}));

app.patch('/api/gestao/egfr-escala/:id', requireAuth('visualizador'), EGFR_GESTORES, wrap(async (req, res) => {
  const { nome, capacidade_supressao, turno } = req.body;
  const sets = [], vals = [];
  if (nome                 !== undefined) { sets.push(`nome=$${vals.length+2}`);                 vals.push(nome); }
  if (capacidade_supressao !== undefined) { sets.push(`capacidade_supressao=$${vals.length+2}`); vals.push(capacidade_supressao); }
  if (turno                !== undefined) { sets.push(`turno=$${vals.length+2}`);                vals.push(turno); }
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  const { rows: [e] } = await pool.query(
    `UPDATE egfr_escala SET ${sets.join(',')} WHERE id=$1 RETURNING *`,
    [req.params.id, ...vals]
  );
  if (!e) return res.status(404).json({ error: 'Registo não encontrado.' });
  res.json(e);
}));

// ── EGFR viatura assignment ─────────────────────────────────────

app.get('/api/gestao/egfr-viatura', requireAuth('visualizador'), EGFR_GESTORES, wrap(async (req, res) => {
  const { de, ate } = req.query;
  const { rows } = await pool.query(`
    SELECT ev.*, v.viatura_cod, v.matricula, v.classe, v.megfr
    FROM egfr_viatura ev
    LEFT JOIN viaturas v ON v.id = ev.viatura_id
    WHERE ($1::date IS NULL OR ev.data >= $1)
      AND ($2::date IS NULL OR ev.data <= $2)
    ORDER BY ev.data, ev.equipa
  `, [de||null, ate||null]);
  res.json(rows);
}));

app.put('/api/gestao/egfr-viatura', requireAuth('visualizador'), EGFR_GESTORES, wrap(async (req, res) => {
  const { data, equipa, viatura_id } = req.body;
  if (!data || !equipa) return res.status(400).json({ error: 'data e equipa obrigatórios.' });
  const { rows: [ev] } = await pool.query(`
    INSERT INTO egfr_viatura (data, equipa, viatura_id, updated_by)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (data, equipa) DO UPDATE SET
      viatura_id = EXCLUDED.viatura_id,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    RETURNING *
  `, [data, equipa, viatura_id||null, req.user.id]);
  res.json(ev);
}));

// ══════════════════════════════════════════════════════════════════
//  EGFR DE HOJE (público — para dispatch em ocorrências)
// ══════════════════════════════════════════════════════════════════

app.get('/api/egfr/hoje', requireAuth('visualizador'), wrap(async (req, res) => {
  const { turno, data } = req.query;
  const { rows } = await pool.query(`
    SELECT e.id, e.data, e.turno, e.equipa, e.posicao, e.nome, e.recurso_id, e.capacidade_supressao,
           ev.viatura_id, v.viatura_cod, v.matricula, v.classe, v.megfr
    FROM egfr_escala e
    LEFT JOIN egfr_viatura ev ON ev.data = e.data AND ev.equipa = e.equipa
    LEFT JOIN viaturas v ON v.id = ev.viatura_id
    WHERE e.data = $1::date
      AND ($2::text IS NULL OR e.turno = $2)
    ORDER BY e.equipa, e.posicao
  `, [data || new Date().toISOString().slice(0,10), turno||null]);

  // Group by equipa
  const equipas = {};
  for (const r of rows) {
    if (!equipas[r.equipa]) {
      equipas[r.equipa] = {
        equipa: r.equipa, turno: r.turno, data: r.data,
        viatura_id: r.viatura_id, viatura_cod: r.viatura_cod,
        matricula: r.matricula, classe: r.classe, megfr: r.megfr,
        elementos: []
      };
    }
    equipas[r.equipa].elementos.push({
      id: r.id, posicao: r.posicao, nome: r.nome,
      recurso_id: r.recurso_id, capacidade_supressao: r.capacidade_supressao
    });
  }
  res.json(Object.values(equipas));
}));

// ══════════════════════════════════════════════════════════════════
//  MÓDULOS DE GESTÃO — ETL SYNC
// ══════════════════════════════════════════════════════════════════

app.post('/api/gestao/sync', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const { execFile } = require('child_process');
  const path = require('path');
  const scriptPath = path.join(__dirname, 'scripts', 'sync_catalogo.js');
  execFile('node', [scriptPath], { env: process.env, timeout: 120_000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('ETL sync error:', stderr || err.message);
      return res.status(500).json({ error: 'ETL falhou.', detail: stderr || err.message });
    }
    res.json({ ok: true, output: stdout });
  });
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

  // Incremental column additions must run BEFORE schema.sql so that
  // CREATE INDEX statements in schema.sql find the columns on existing tables.
  // ALTER TABLE IF EXISTS is a no-op on fresh databases where the table doesn't exist yet.
  const preSchemaAlters = [
    `ALTER TABLE IF EXISTS egfr_escala ADD COLUMN IF NOT EXISTS recurso_id UUID REFERENCES recursos(id) ON DELETE SET NULL`,
    `ALTER TABLE IF EXISTS recursos    ADD COLUMN IF NOT EXISTS notas TEXT`,
  ];
  for (const sql of preSchemaAlters) {
    await pool.query(sql);
  }

  // Aplicar schema base (idempotente — usa CREATE TABLE/INDEX IF NOT EXISTS)
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);
  console.log('Schema e migrações aplicados.');
}

// ─── Start ────────────────────────────────────────────────────────
if (require.main === module) {
  runMigrations()
    .then(() => app.listen(PORT, () => console.log(`Gestão Meios a correr na porta ${PORT}`)))
    .catch(err => { console.error('Erro na migração:', err.message); process.exit(1); });
}

module.exports = { app, pool };
