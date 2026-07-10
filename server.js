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
  // Parse JWT if requireAuth hasn't run yet on this route
  if (!req.user) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      return res.status(401).json({ error: 'Não autenticado.' });
    try { req.user = jwt.verify(header.slice(7), JWT_SECRET); }
    catch { return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' }); }
  }
  const role = req.user.role;
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
  try {
    const { rows } = await pool.query(
      `INSERT INTO ocorrencias
         (local_ignicao, codigo_ocorrencia, subregiao, concelho, obs, inicio, status, created_by, oficial_ligacao_id, oficial_ligacao_nome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING *`,
      [b.local_ignicao, b.codigo_ocorrencia || null, b.subregiao || null, b.concelho || null,
       b.obs || null, b.inicio || null, b.status || 'active', req.user.id, req.user.nome]
    );
    res.json(rows[0]);
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: `Já existe uma ocorrência com o código "${b.codigo_ocorrencia}".` });
    throw e;
  }
}));

app.patch('/api/ocorrencias/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  try {
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
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: `Já existe uma ocorrência com o código "${b.codigo_ocorrencia}".` });
    throw e;
  }
}));

app.delete('/api/ocorrencias/:id', requireAuth('admin'), wrap(async (req, res) => {
  await pool.query('DELETE FROM ocorrencias WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/ocorrencias/merge', requireAuth('ofligacao'), wrap(async (req, res) => {
  const { ids, local_ignicao, codigo_ocorrencia, subregiao, concelho, inicio } = req.body;
  if (!Array.isArray(ids) || ids.length < 2)
    return res.status(400).json({ error: 'São necessárias pelo menos 2 ocorrências para fundir.' });
  if (!local_ignicao)
    return res.status(400).json({ error: 'Nome da nova ocorrência obrigatório.' });

  const { rows: sources } = await pool.query(
    'SELECT id, local_ignicao, status FROM ocorrencias WHERE id = ANY($1)', [ids]
  );
  if (sources.length !== ids.length)
    return res.status(404).json({ error: 'Uma ou mais ocorrências não encontradas.' });
  const nonActive = sources.filter(s => s.status !== 'active');
  if (nonActive.length)
    return res.status(409).json({ error: 'Todas as ocorrências devem estar ativas para serem fundidas.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [nova] } = await client.query(
      `INSERT INTO ocorrencias (local_ignicao, codigo_ocorrencia, subregiao, concelho, inicio, status, created_by, oficial_ligacao_id, oficial_ligacao_nome)
       VALUES ($1,$2,$3,$4,$5,'active',$6,$6,$7) RETURNING *`,
      [local_ignicao, codigo_ocorrencia || null, subregiao || null, concelho || null,
       inicio || null, req.user.id, req.user.nome]
    );
    await client.query('UPDATE meios               SET ocorrencia_id = $1 WHERE ocorrencia_id = ANY($2)', [nova.id, ids]);
    await client.query('UPDATE postos_comando       SET ocorrencia_id = $1 WHERE ocorrencia_id = ANY($2)', [nova.id, ids]);
    await client.query('UPDATE ocorrencias_eventos  SET ocorrencia_id = $1 WHERE ocorrencia_id = ANY($2)', [nova.id, ids]);
    await client.query('UPDATE meio_delete_requests SET ocorrencia_id = $1 WHERE ocorrencia_id = ANY($2)', [nova.id, ids]);
    await client.query(`UPDATE ocorrencias SET status = 'merged', merged_into = $1 WHERE id = ANY($2)`, [nova.id, ids]);
    await client.query(
      `INSERT INTO ocorrencias_eventos (ocorrencia_id, tag, msg, user_id) VALUES ($1,'occ',$2,$3)`,
      [nova.id, `Fundida a partir de: ${sources.map(s => s.local_ignicao).join(', ')}.`, req.user.id]
    );
    await client.query('COMMIT');
    res.json(nova);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: `Já existe uma ocorrência com o código "${codigo_ocorrencia}".` });
    throw e;
  } finally {
    client.release();
  }
}));

// ══════════════════════════════════════════════════════════════════
//  MEIOS
// ══════════════════════════════════════════════════════════════════
const MEIO_COLS = [
  'ocorrencia_id','recurso_id','recurso_adicional_id','viatura_id','composicao_id','meio_pai_id',
  'eq','tipo','matricula','concelho','setor','posto_comando_id',
  'operacionais','responsavel','contacto',
  'data_despacho','hora_despacho','data_saida_entidade','hora_saida_entidade',
  'data_chegada','hora_chegada','horas_max','limite_op','limite_op_date',
  'data_demob','hora_demob','data_chegada_entidade','hora_chegada_entidade',
  'km','missao','estado','obs',
  'previsto_data','previsto_hora',
  'fsbf_bsbf_id','fsbf_emr_id','egfr_data','egfr_equipa',
];

const OCUPADO_ESTADOS = ['previsto','transito','operacao','descanso'];

async function findRecursoConflict(recursoId, estado, excludeId) {
  if (!recursoId) return null;
  // Occupied = active state OR desmobilizado still "em regresso" (no chegada_entidade)
  if (!OCUPADO_ESTADOS.includes(estado) && estado !== 'desmobilizado') return null;
  const { rows } = await pool.query(
    `SELECT o.local_ignicao FROM meios m
     JOIN ocorrencias o ON o.id = m.ocorrencia_id
     WHERE m.recurso_id = $1
     AND (m.estado = ANY($2) OR (m.estado = 'desmobilizado' AND m.data_chegada_entidade IS NULL))
     AND m.id <> $3
     LIMIT 1`,
    [recursoId, OCUPADO_ESTADOS, excludeId || '00000000-0000-0000-0000-000000000000']
  );
  return rows[0] || null;
}

async function findRecursoAdicionalConflict(recursoAdicionalId, estado, excludeId) {
  if (!recursoAdicionalId) return null;
  if (!OCUPADO_ESTADOS.includes(estado) && estado !== 'desmobilizado') return null;
  const { rows } = await pool.query(
    `SELECT o.local_ignicao FROM meios m
     JOIN ocorrencias o ON o.id = m.ocorrencia_id
     WHERE m.recurso_adicional_id = $1
     AND (m.estado = ANY($2) OR (m.estado = 'desmobilizado' AND m.data_chegada_entidade IS NULL))
     AND m.id <> $3
     LIMIT 1`,
    [recursoAdicionalId, OCUPADO_ESTADOS, excludeId || '00000000-0000-0000-0000-000000000000']
  );
  return rows[0] || null;
}

async function findViaturaConflict(viaturaId, estado, excludeId) {
  if (!viaturaId) return null;
  if (!OCUPADO_ESTADOS.includes(estado) && estado !== 'desmobilizado') return null;
  const { rows } = await pool.query(
    `SELECT o.local_ignicao FROM meios m
     JOIN ocorrencias o ON o.id = m.ocorrencia_id
     WHERE m.viatura_id = $1
     AND (m.estado = ANY($2) OR (m.estado = 'desmobilizado' AND m.data_chegada_entidade IS NULL))
     AND m.id <> $3
     LIMIT 1`,
    [viaturaId, OCUPADO_ESTADOS, excludeId || '00000000-0000-0000-0000-000000000000']
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
  const raConflict = await findRecursoAdicionalConflict(b.recurso_adicional_id, b.estado, null);
  if (raConflict) {
    return res.status(409).json({ error: `Este recurso já está activo na ocorrência "${raConflict.local_ignicao}".` });
  }
  const vConflict = await findViaturaConflict(b.viatura_id, b.estado, null);
  if (vConflict) {
    return res.status(409).json({ error: `Esta viatura já está em uso na ocorrência "${vConflict.local_ignicao}".` });
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

  // State machine: validate transitions (operacional role is strictly enforced; ofligacao/admin may correct)
  if ('estado' in b && req.user.role === 'operacional') {
    const { rows: curr } = await pool.query('SELECT estado FROM meios WHERE id=$1', [req.params.id]);
    if (curr.length) {
      const oldEstado = curr[0].estado;
      const newEstado = b.estado;
      if (oldEstado !== newEstado) {
        const VALID = {
          previsto:      new Set(['transito']),
          transito:      new Set(['operacao']),
          operacao:      new Set(['descanso','desmobilizado']),
          descanso:      new Set(['operacao','desmobilizado']),
          desmobilizado: new Set([]),
        };
        if (!(VALID[oldEstado] || new Set()).has(newEstado)) {
          return res.status(422).json({ error: `Transição de estado inválida: ${oldEstado} → ${newEstado}.` });
        }
      }
    }
  }

  if ('estado' in b && OCUPADO_ESTADOS.includes(b.estado)) {
    let recursoId = b.recurso_id;
    let recursoAdicionalId = b.recurso_adicional_id;
    let viaturaId = b.viatura_id;
    if (recursoId === undefined || recursoAdicionalId === undefined || viaturaId === undefined) {
      const { rows } = await pool.query('SELECT recurso_id, recurso_adicional_id, viatura_id FROM meios WHERE id=$1', [req.params.id]);
      if (recursoId === undefined)          recursoId          = rows[0]?.recurso_id;
      if (recursoAdicionalId === undefined) recursoAdicionalId = rows[0]?.recurso_adicional_id;
      if (viaturaId === undefined)          viaturaId          = rows[0]?.viatura_id;
    }
    const conflict = await findRecursoConflict(recursoId, b.estado, req.params.id);
    if (conflict) {
      return res.status(409).json({ error: `Este recurso já está activo na ocorrência "${conflict.local_ignicao}".` });
    }
    const raConflict = await findRecursoAdicionalConflict(recursoAdicionalId, b.estado, req.params.id);
    if (raConflict) {
      return res.status(409).json({ error: `Este recurso já está activo na ocorrência "${raConflict.local_ignicao}".` });
    }
    const vConflict = await findViaturaConflict(viaturaId, b.estado, req.params.id);
    if (vConflict) {
      return res.status(409).json({ error: `Esta viatura já está em uso na ocorrência "${vConflict.local_ignicao}".` });
    }
  }

  // Datetime ordering validation: merge incoming fields with current DB values
  const DT_FIELDS = ['data_despacho','hora_despacho','data_saida_entidade','hora_saida_entidade',
                     'data_chegada','hora_chegada','data_demob','hora_demob',
                     'data_chegada_entidade','hora_chegada_entidade'];
  if (DT_FIELDS.some(f => f in b)) {
    const { rows: cur } = await pool.query(
      `SELECT ${DT_FIELDS.join(',')}, o.inicio FROM meios m
       JOIN ocorrencias o ON o.id = m.ocorrencia_id
       WHERE m.id=$1`, [req.params.id]
    );
    if (cur.length) {
      const m = { ...cur[0], ...Object.fromEntries(DT_FIELDS.filter(f => f in b).map(f => [f, b[f]])) };
      const parseDT = (d, t) => (d ? new Date(`${d}T${t || '00:00'}`) : null);
      const inicio   = m.inicio ? new Date(m.inicio) : null;
      const despacho = parseDT(m.data_despacho,         m.hora_despacho);
      const saida    = parseDT(m.data_saida_entidade,    m.hora_saida_entidade);
      const chegada  = parseDT(m.data_chegada,           m.hora_chegada);
      const demob    = parseDT(m.data_demob,             m.hora_demob);
      const chegadaE = parseDT(m.data_chegada_entidade,  m.hora_chegada_entidade);
      if (inicio && despacho && despacho < inicio)
        return res.status(422).json({ error: 'Despacho deve ser igual ou posterior ao início da ocorrência.' });
      if (despacho && saida && saida < despacho)
        return res.status(422).json({ error: 'Saída Entidade deve ser igual ou posterior ao Despacho.' });
      if (saida && chegada && chegada < saida)
        return res.status(422).json({ error: 'Chegada TO deve ser igual ou posterior à Saída Entidade.' });
      if (chegada && demob && demob < chegada)
        return res.status(422).json({ error: 'Saída TO deve ser igual ou posterior à Chegada TO.' });
      if (demob && chegadaE && chegadaE < demob)
        return res.status(422).json({ error: 'Chegada Entidade deve ser igual ou posterior à Saída TO.' });
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

// ══════════════════════════════════════════════════════════════════
//  RECURSOS ADICIONAIS (ad-hoc, por ocorrência)
// ══════════════════════════════════════════════════════════════════

app.get('/api/recursos-adicionais', requireAuth('visualizador'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM recursos_adicionais ORDER BY created_at DESC');
  res.json(rows);
}));

app.post('/api/recursos-adicionais', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.nome) return res.status(400).json({ error: 'Nome obrigatório.' });
  const { rows: [r] } = await pool.query(
    `INSERT INTO recursos_adicionais
       (nome, tipo, matricula, subregiao, concelho, responsavel, contacto, obs, criado_em_ocorrencia_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.nome, b.tipo||null, b.matricula||null, b.subregiao||null, b.concelho||null,
     b.responsavel||null, b.contacto||null, b.obs||null, b.criado_em_ocorrencia_id||null, req.user.id]
  );
  res.json(r);
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
//  POSTOS DE COMANDO (PCF / AIM)
// ══════════════════════════════════════════════════════════════════

// All active postos (for global list rendering)
app.get('/api/postos', requireAuth('visualizador'), wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT p.*, o.subregiao AS occ_subregiao
    FROM postos_comando p
    JOIN ocorrencias o ON o.id = p.ocorrencia_id
    WHERE p.ativo AND o.status = 'active'
    ORDER BY o.created_at, p.created_at
  `);
  res.json(rows);
}));

app.get('/api/ocorrencias/:id/postos', requireAuth('visualizador'), wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.*,
           COUNT(m.id) FILTER (WHERE m.estado <> 'desmobilizado') AS meios_count
    FROM postos_comando p
    LEFT JOIN meios m ON m.posto_comando_id = p.id
    WHERE p.ocorrencia_id = $1 AND p.ativo
    GROUP BY p.id
    ORDER BY p.created_at
  `, [req.params.id]);
  res.json(rows);
}));

app.post('/api/ocorrencias/:id/postos', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.nome || !b.tipo) return res.status(400).json({ error: 'nome e tipo obrigatórios.' });
  const { rows } = await pool.query(
    `INSERT INTO postos_comando (ocorrencia_id, nome, tipo, oficial_ligacao_id, oficial_ligacao_nome, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.id, b.nome, b.tipo, b.oficial_ligacao_id || null, b.oficial_ligacao_nome || null, req.user.id]
  );
  await pool.query(
    `INSERT INTO ocorrencias_eventos (ocorrencia_id, tag, msg, user_id)
     VALUES ($1,'occ',$2,$3)`,
    [req.params.id, `Criado posto de comando: ${b.tipo} "${b.nome}"${b.oficial_ligacao_nome ? ' — OL: ' + b.oficial_ligacao_nome : ''}.`, req.user.id]
  );
  res.json(rows[0]);
}));

app.patch('/api/postos/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  const ALLOWED = ['nome', 'tipo', 'oficial_ligacao_id', 'oficial_ligacao_nome', 'ativo'];
  const b = req.body;
  const cols = ALLOWED.filter(c => c in b);
  if (!cols.length) return res.json({ ok: true });
  const sets = cols.map((c, i) => `${c}=$${i + 1}`).join(',');
  const vals = [...cols.map(c => b[c] ?? null), req.params.id];
  const { rows } = await pool.query(`UPDATE postos_comando SET ${sets} WHERE id=$${cols.length + 1} RETURNING *`, vals);
  res.json(rows[0] || { ok: true });
}));

app.delete('/api/postos/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  // Soft-delete: return meios to main PCO (posto_comando_id = NULL)
  await pool.query(`UPDATE meios SET posto_comando_id = NULL WHERE posto_comando_id = $1`, [req.params.id]);
  const { rows } = await pool.query(`UPDATE postos_comando SET ativo = false WHERE id = $1 RETURNING ocorrencia_id, nome, tipo`, [req.params.id]);
  if (rows[0]) {
    await pool.query(
      `INSERT INTO ocorrencias_eventos (ocorrencia_id, tag, msg, user_id) VALUES ($1,'occ',$2,$3)`,
      [rows[0].ocorrencia_id, `Posto de comando encerrado: ${rows[0].tipo} "${rows[0].nome}". Meios devolvidos ao PCO principal.`, req.user.id]
    );
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
    'INSERT INTO ocorrencias_eventos (ocorrencia_id, ts, tag, meio_label, msg, user_id, posto_comando_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [b.ocorrencia_id, b.ts || new Date().toISOString(), b.tag || 'occ', b.meio_label || null, b.msg, req.user.id, b.posto_comando_id || null]
  );
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  FITA DO TEMPO
// ══════════════════════════════════════════════════════════════════
app.get('/api/ocorrencias/:id/timeline', requireAuth('visualizador'), wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT ts, categoria, titulo, descricao, dados, autor_nome, meio_eq, posto_comando_id FROM (
      SELECT ot.ts, ot.categoria, ot.titulo, ot.descricao, ot.dados, ot.autor_nome,
             m.eq AS meio_eq, ot.posto_comando_id
      FROM ocorrencia_timeline ot
      LEFT JOIN meios m ON m.id = ot.meio_id
      WHERE ot.ocorrencia_id = $1

      UNION ALL

      SELECT oe.ts, 'ocorrencia', oe.msg, NULL, NULL::JSONB, NULL, NULL, oe.posto_comando_id
      FROM ocorrencias_eventos oe
      WHERE oe.ocorrencia_id = $1

      UNION ALL

      SELECT me.ts, 'meios_icnf', me.msg, NULL,
             jsonb_build_object('missao', m.missao, 'estado', m.estado),
             NULL, m.eq, m.posto_comando_id
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

// §5.3b — Editar composição
app.patch('/api/composicoes/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  const ALLOWED = ['codigo','subregiao','concelho','notas','ativo'];
  const sets = [], vals = [req.params.id];
  for (const k of ALLOWED) {
    if (k in b) { sets.push(`${k}=$${vals.length+1}`); vals.push(b[k] ?? null); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para actualizar.' });
  const { rows: [c] } = await pool.query(
    `UPDATE composicoes SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals
  );
  if (!c) return res.status(404).json({ error: 'Composição não encontrada.' });
  res.json(c);
}));

// §5.3c — Eliminar (desactivar) composição
app.delete('/api/composicoes/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE composicoes SET ativo=false WHERE id=$1`, [req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Composição não encontrada.' });
  res.json({ ok: true });
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
    const postoId = camposDespacho.posto_comando_id || null;
    const { rows: [pai] } = await client.query(
      `INSERT INTO meios (ocorrencia_id, composicao_id, eq, tipo, estado, operacionais, created_by,
         data_despacho, hora_despacho, setor, missao, obs, posto_comando_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.params.id, comp.id, comp.codigo, comp.tipo, estado, totalOps, req.user.id,
       camposDespacho.data_despacho || null, camposDespacho.hora_despacho || null,
       camposDespacho.setor || null, camposDespacho.missao || null, camposDespacho.obs || null,
       postoId]
    );

    const filhos = [];
    for (const m of comp.membros) {
      const { rows: [filho] } = await client.query(
        `INSERT INTO meios (ocorrencia_id, meio_pai_id, recurso_id, viatura_id,
           eq, tipo, matricula, contacto, estado, operacionais, created_by,
           data_despacho, hora_despacho, setor, missao, posto_comando_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [req.params.id, pai.id, m.recurso_id || null, m.viatura_id || null,
         m.codigo, m.tipo, m.matricula || null, m.contacto || null,
         estado, m.num_elementos || 1, req.user.id,
         camposDespacho.data_despacho || null, camposDespacho.hora_despacho || null,
         camposDespacho.setor || null, camposDespacho.missao || null, postoId]
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
    SELECT v.*, r.codigo AS recurso_codigo, f.codigo AS fonte,
      EXISTS (
        SELECT 1 FROM meios m_u
        WHERE m_u.viatura_id = v.id
          AND m_u.estado = ANY(ARRAY['previsto','transito','operacao','descanso'])
      ) AS em_uso
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
  const ALLOWED = ['viatura_cod','recurso_id','matricula','marca','modelo','classe','megfr','tipologia','entidade',
                   'base','estado','agfr','lat_base','long_base','ddi_viatura','ativo','dispositivo'];
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

app.post('/api/gestao/egfr-escala/batch', requireAuth('visualizador'), EGFR_GESTORES, wrap(async (req, res) => {
  const { data, rows } = req.body;
  if (!data) return res.status(400).json({ error: 'data obrigatória.' });
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows deve ser um array.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM egfr_escala WHERE data = $1', [data]);
    for (const r of rows) {
      await client.query(
        `INSERT INTO egfr_escala (data, turno, equipa, posicao, nome, capacidade_supressao)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [data, r.turno || null, r.equipa || null, r.posicao || null, r.nome || null, !!r.capacidade_supressao]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
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
  const d = data || new Date().toISOString().slice(0,10);
  const { rows } = await pool.query(`
    SELECT e.id, e.data, e.turno, e.equipa, e.posicao, e.nome, e.recurso_id,
           CASE WHEN r.id IS NOT NULL THEN r.fogo_supressao  ELSE e.capacidade_supressao END AS fogo_supressao,
           CASE WHEN r.id IS NOT NULL THEN r.fogo_controlado ELSE false END                 AS fogo_controlado,
           ev.viatura_id, v.viatura_cod, v.matricula, v.classe, v.megfr
    FROM egfr_escala e
    LEFT JOIN recursos r ON r.id = e.recurso_id
    LEFT JOIN egfr_viatura ev ON ev.data = e.data AND ev.equipa = e.equipa
    LEFT JOIN viaturas v ON v.id = ev.viatura_id
    WHERE e.data = $1::date
      AND ($2::text IS NULL OR e.turno = $2)
    ORDER BY
      CASE e.turno WHEN 'Prontidão (A)' THEN 0 ELSE 1 END,
      e.equipa, e.posicao
  `, [d, turno||null]);

  // Deployed status per equipa
  const { rows: deployed } = await pool.query(`
    SELECT m.egfr_equipa, m.id AS meio_id, o.id AS occ_id, o.local_ignicao AS occ_nome
    FROM meios m JOIN ocorrencias o ON o.id = m.ocorrencia_id
    WHERE m.egfr_data = $1 AND m.egfr_equipa IS NOT NULL
      AND m.estado <> 'desmobilizado' AND m.meio_pai_id IS NULL
  `, [d]);
  const deployedMap = {};
  for (const d2 of deployed) deployedMap[d2.egfr_equipa] = d2;

  const equipas = {};
  for (const r of rows) {
    const key = `${r.turno}::${r.equipa}`;
    if (!equipas[key]) {
      const dep = deployedMap[r.equipa];
      equipas[key] = {
        key, equipa: r.equipa, turno: r.turno, data: r.data,
        viatura_id: r.viatura_id, viatura_cod: r.viatura_cod,
        matricula: r.matricula, classe: r.classe, megfr: r.megfr,
        elementos: [],
        deployed: !!dep, deployed_meio_id: dep?.meio_id||null,
        deployed_occ_id: dep?.occ_id||null, deployed_occ_nome: dep?.occ_nome||null,
      };
    }
    equipas[key].elementos.push({
      id: r.id, posicao: r.posicao, nome: r.nome,
      recurso_id: r.recurso_id,
      fogo_supressao: r.fogo_supressao,
      fogo_controlado: r.fogo_controlado,
    });
  }
  const result = Object.values(equipas);
  for (const g of result) g.equipa_supressao = g.elementos.some(el => el.fogo_supressao);
  res.json(result);
}));

// ══════════════════════════════════════════════════════════════════
//  CARTA DE MEIOS FSBF
// ══════════════════════════════════════════════════════════════════

const FSBF_GESTORES = requireModule('gestor_fsbf');

// ── GET /api/fsbf/disponivel?data= — ofligacao_ccon only ───────
app.get('/api/fsbf/disponivel', requireAuth('ofligacao_ccon'), wrap(async (req, res) => {
  const data = req.query.data || new Date().toISOString().slice(0, 10);
  const [bsbfRes, emrRes] = await Promise.all([
    pool.query(`
      SELECT e.*, v.viatura_cod, v.matricula, v.classe,
        (SELECT m.id FROM meios m
           JOIN fsbf_bsbf_equipa e2 ON m.fsbf_bsbf_id = e2.id
           WHERE e2.brigada = e.brigada AND e2.data = e.data
             AND m.estado <> 'desmobilizado' AND m.meio_pai_id IS NULL LIMIT 1
        ) AS deployed_meio_id,
        (SELECT o2.local_ignicao FROM meios m
           JOIN fsbf_bsbf_equipa e2 ON m.fsbf_bsbf_id = e2.id
           JOIN ocorrencias o2 ON o2.id = m.ocorrencia_id
           WHERE e2.brigada = e.brigada AND e2.data = e.data
             AND m.estado <> 'desmobilizado' AND m.meio_pai_id IS NULL LIMIT 1
        ) AS deployed_occ_nome
      FROM fsbf_bsbf_equipa e
      LEFT JOIN viaturas v ON v.id = e.veiculo_id
      WHERE e.data = $1
      ORDER BY e.brigada, e.ordem, e.created_at
    `, [data]),
    pool.query(`
      SELECT e.*,
        mr.viatura_cod   AS mr_cod,   mr.matricula   AS mr_matricula,
        vaop.viatura_cod AS vaop_cod, vaop.matricula AS vaop_matricula,
        vpil.viatura_cod AS vpil_cod, vpil.matricula AS vpil_matricula,
        vlci.viatura_cod AS vlci_cod, vlci.matricula AS vlci_matricula,
        m.id AS deployed_meio_id, o.id AS deployed_occ_id, o.local_ignicao AS deployed_occ_nome
      FROM fsbf_emr_equipa e
      LEFT JOIN viaturas mr   ON mr.id   = e.mr_viatura_id
      LEFT JOIN viaturas vaop ON vaop.id = e.vaop_viatura_id
      LEFT JOIN viaturas vpil ON vpil.id = e.vpiloto_viatura_id
      LEFT JOIN viaturas vlci ON vlci.id = e.vlci_viatura_id
      LEFT JOIN meios m ON m.fsbf_emr_id = e.id AND m.estado <> 'desmobilizado' AND m.meio_pai_id IS NULL
      LEFT JOIN ocorrencias o ON o.id = m.ocorrencia_id
      WHERE e.data = $1
      ORDER BY e.ordem, e.created_at
    `, [data]),
  ]);
  const addDeployed = r => ({ ...r, deployed: !!r.deployed_meio_id });
  res.json({ data, bsbf: bsbfRes.rows.map(addDeployed), emr: emrRes.rows.map(addDeployed) });
}));

// ── GET /api/fsbf/carta?data= ──────────────────────────────────
app.get('/api/fsbf/carta', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const data = req.query.data || new Date().toISOString().slice(0, 10);

  const [cartaRes, bsbfRes, emrRes] = await Promise.all([
    pool.query(`
      SELECT c.*, v.viatura_cod AS chefe_veiculo_cod, v.matricula AS chefe_veiculo_matricula
      FROM fsbf_carta c
      LEFT JOIN viaturas v ON v.id = c.chefe_veiculo_id
      WHERE c.data = $1
    `, [data]),
    pool.query(`
      SELECT e.*, v.viatura_cod, v.matricula, v.classe
      FROM fsbf_bsbf_equipa e
      LEFT JOIN viaturas v ON v.id = e.veiculo_id
      WHERE e.data = $1
      ORDER BY e.brigada, e.ordem, e.created_at
    `, [data]),
    pool.query(`
      SELECT e.*,
        mr.viatura_cod    AS mr_cod,    mr.matricula    AS mr_matricula,
        vaop.viatura_cod  AS vaop_cod,  vaop.matricula  AS vaop_matricula,
        vpil.viatura_cod  AS vpil_cod,  vpil.matricula  AS vpil_matricula,
        vlci.viatura_cod  AS vlci_cod,  vlci.matricula  AS vlci_matricula
      FROM fsbf_emr_equipa e
      LEFT JOIN viaturas mr   ON mr.id   = e.mr_viatura_id
      LEFT JOIN viaturas vaop ON vaop.id = e.vaop_viatura_id
      LEFT JOIN viaturas vpil ON vpil.id = e.vpiloto_viatura_id
      LEFT JOIN viaturas vlci ON vlci.id = e.vlci_viatura_id
      WHERE e.data = $1
      ORDER BY e.ordem, e.created_at
    `, [data]),
  ]);

  res.json({
    data,
    carta: cartaRes.rows[0] || null,
    bsbf:  bsbfRes.rows,
    emr:   emrRes.rows,
  });
}));

// ── PUT /api/fsbf/carta (upsert header) ───────────────────────
app.put('/api/fsbf/carta', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  if (!b.data) return res.status(400).json({ error: 'data obrigatória.' });
  const { rows: [carta] } = await pool.query(`
    INSERT INTO fsbf_carta
      (data, coord_nome, coord_contacto,
       chefe_nome, chefe_contacto, chefe_guarnicao,
       chefe_veiculo_id, chefe_veiculo_texto, notas_outros_meios, updated_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (data) DO UPDATE SET
      coord_nome           = EXCLUDED.coord_nome,
      coord_contacto       = EXCLUDED.coord_contacto,
      chefe_nome           = EXCLUDED.chefe_nome,
      chefe_contacto       = EXCLUDED.chefe_contacto,
      chefe_guarnicao      = EXCLUDED.chefe_guarnicao,
      chefe_veiculo_id     = EXCLUDED.chefe_veiculo_id,
      chefe_veiculo_texto  = EXCLUDED.chefe_veiculo_texto,
      notas_outros_meios   = EXCLUDED.notas_outros_meios,
      updated_by           = EXCLUDED.updated_by,
      updated_at           = now()
    RETURNING *
  `, [b.data, b.coord_nome||null, b.coord_contacto||null,
      b.chefe_nome||null, b.chefe_contacto||null, b.chefe_guarnicao||null,
      b.chefe_veiculo_id||null, b.chefe_veiculo_texto||null,
      b.notas_outros_meios||null, req.user.id]);
  res.json(carta);
}));

// ── BSBF entries CRUD ──────────────────────────────────────────
app.post('/api/fsbf/bsbf', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  if (!b.data || !b.brigada) return res.status(400).json({ error: 'data e brigada obrigatórios.' });
  const { rows: [e] } = await pool.query(`
    INSERT INTO fsbf_bsbf_equipa
      (data, brigada, veiculo_id, guarnicao, chefe_nome, contacto, observacoes, ordem, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,
      COALESCE($8,(SELECT COALESCE(MAX(ordem)+1,0) FROM fsbf_bsbf_equipa WHERE data=$1 AND brigada=$2)),
      $9)
    RETURNING *
  `, [b.data, b.brigada, b.veiculo_id||null, b.guarnicao||null,
      b.chefe_nome||null, b.contacto||null, b.observacoes||null,
      b.ordem != null ? b.ordem : null, req.user.id]);
  res.json(e);
}));

app.patch('/api/fsbf/bsbf/:id', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  const ALLOWED = ['base','veiculo_id','guarnicao','chefe_nome','contacto','observacoes','ordem'];
  const sets = [], vals = [req.params.id];
  for (const k of ALLOWED) {
    if (k in b) { sets.push(`${k}=$${vals.length+1}`); vals.push(b[k] ?? null); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para actualizar.' });
  sets.push(`updated_at=now()`);
  const { rows: [e] } = await pool.query(
    `UPDATE fsbf_bsbf_equipa SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals
  );
  if (!e) return res.status(404).json({ error: 'Entrada não encontrada.' });
  res.json(e);
}));

app.delete('/api/fsbf/bsbf/:id', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM fsbf_bsbf_equipa WHERE id=$1`, [req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Entrada não encontrada.' });
  res.json({ ok: true });
}));

// ── EMR entries CRUD ───────────────────────────────────────────
app.post('/api/fsbf/emr', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  if (!b.data) return res.status(400).json({ error: 'data obrigatória.' });
  const { rows: [e] } = await pool.query(`
    INSERT INTO fsbf_emr_equipa
      (data, base, mr_viatura_id, vaop_viatura_id, vpiloto_viatura_id, vlci_viatura_id,
       chefe_nome, contacto, total_op, observacoes, ordem, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      COALESCE($11,(SELECT COALESCE(MAX(ordem)+1,0) FROM fsbf_emr_equipa WHERE data=$1)),
      $12)
    RETURNING *
  `, [b.data, b.base||null, b.mr_viatura_id||null, b.vaop_viatura_id||null,
      b.vpiloto_viatura_id||null, b.vlci_viatura_id||null,
      b.chefe_nome||null, b.contacto||null, b.total_op||null, b.observacoes||null,
      b.ordem != null ? b.ordem : null, req.user.id]);
  res.json(e);
}));

app.patch('/api/fsbf/emr/:id', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  const ALLOWED = ['base','mr_viatura_id','vaop_viatura_id','vpiloto_viatura_id',
                   'vlci_viatura_id','chefe_nome','contacto','total_op','observacoes','ordem'];
  const sets = [], vals = [req.params.id];
  for (const k of ALLOWED) {
    if (k in b) { sets.push(`${k}=$${vals.length+1}`); vals.push(b[k] ?? null); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para actualizar.' });
  sets.push(`updated_at=now()`);
  const { rows: [e] } = await pool.query(
    `UPDATE fsbf_emr_equipa SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals
  );
  if (!e) return res.status(404).json({ error: 'Entrada não encontrada.' });
  res.json(e);
}));

app.delete('/api/fsbf/emr/:id', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM fsbf_emr_equipa WHERE id=$1`, [req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Entrada não encontrada.' });
  res.json({ ok: true });
}));

// ── FSBF Operacionais ─────────────────────────────────────────────
app.get('/api/fsbf/operacionais', requireAuth('visualizador'), wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM operacionais_fsbf WHERE ativo = true ORDER BY nome`
  );
  res.json(rows);
}));

app.post('/api/fsbf/operacionais', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const { nome, n_trab, cargo, contacto } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome obrigatório.' });
  const { rows: [row] } = await pool.query(
    `INSERT INTO operacionais_fsbf (nome, n_trab, cargo, contacto, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [nome, n_trab||null, cargo||null, contacto||null, req.user.id]
  );
  res.status(201).json(row);
}));

app.patch('/api/fsbf/operacionais/:id', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const ALLOWED = ['nome','n_trab','cargo','contacto','ativo'];
  const sets = [], vals = [];
  for (const k of ALLOWED) {
    if (k in req.body) { sets.push(`${k}=$${vals.length+1}`); vals.push(req.body[k]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Sem campos.' });
  vals.push(req.params.id);
  const { rows: [row] } = await pool.query(
    `UPDATE operacionais_fsbf SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals
  );
  if (!row) return res.status(404).json({ error: 'Não encontrado.' });
  res.json(row);
}));

app.delete('/api/fsbf/operacionais/:id', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  await pool.query(`UPDATE operacionais_fsbf SET ativo=false WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

// ── POST /api/ocorrencias/:occId/deploy/fsbf-emr ───────────────
// Creates MR as primary meio (fsbf_emr_id), secondary vehicles as children (meio_pai_id).
// No container card — each vehicle appears as its own card, grouped by colour in the UI.
app.post('/api/ocorrencias/:occId/deploy/fsbf-emr', requireCCON, wrap(async (req, res) => {
  const { team_id, setor, missao } = req.body;
  if (!team_id) return res.status(400).json({ error: 'team_id obrigatório.' });

  const { rows: [emr] } = await pool.query(`
    SELECT e.*,
      mr.viatura_cod AS mr_cod,   mr.matricula AS mr_mat,   mr.classe AS mr_cls,
      vaop.viatura_cod AS vaop_cod, vaop.matricula AS vaop_mat, vaop.classe AS vaop_cls,
      vpil.viatura_cod AS vpil_cod, vpil.matricula AS vpil_mat, vpil.classe AS vpil_cls,
      vlci.viatura_cod AS vlci_cod, vlci.matricula AS vlci_mat, vlci.classe AS vlci_cls
    FROM fsbf_emr_equipa e
    LEFT JOIN viaturas mr   ON mr.id   = e.mr_viatura_id
    LEFT JOIN viaturas vaop ON vaop.id = e.vaop_viatura_id
    LEFT JOIN viaturas vpil ON vpil.id = e.vpiloto_viatura_id
    LEFT JOIN viaturas vlci ON vlci.id = e.vlci_viatura_id
    WHERE e.id = $1
  `, [team_id]);
  if (!emr) return res.status(404).json({ error: 'Equipa EMR não encontrada.' });

  // Exclusivity check on the primary meio (MR)
  const { rows: ex } = await pool.query(
    `SELECT m.id, o.local_ignicao FROM meios m JOIN ocorrencias o ON o.id=m.ocorrencia_id
     WHERE m.fsbf_emr_id=$1 AND m.estado<>'desmobilizado' AND m.meio_pai_id IS NULL LIMIT 1`,
    [team_id]
  );
  if (ex.length) return res.status(409).json({ error: `Já despachado para "${ex[0].local_ignicao}".` });

  // Per-vehicle exclusivity across all EMR vehicles
  const emrViatIds = [emr.mr_viatura_id, emr.vaop_viatura_id, emr.vpiloto_viatura_id, emr.vlci_viatura_id].filter(Boolean);
  if (emrViatIds.length) {
    const { rows: vConf } = await pool.query(
      `SELECT v.viatura_cod, o.local_ignicao FROM meios m
       JOIN viaturas v ON v.id = m.viatura_id
       JOIN ocorrencias o ON o.id = m.ocorrencia_id
       WHERE m.viatura_id = ANY($1) AND m.estado = ANY($2) LIMIT 1`,
      [emrViatIds, OCUPADO_ESTADOS]
    );
    if (vConf.length) return res.status(409).json({
      error: `Viatura "${vConf[0].viatura_cod}" já está em uso na ocorrência "${vConf[0].local_ignicao}".`
    });
  }

  const secondary = [
    emr.vaop_viatura_id   ? { id: emr.vaop_viatura_id,   eq: emr.vaop_cod, tipo: emr.vaop_cls||'VAOP', mat: emr.vaop_mat } : null,
    emr.vpiloto_viatura_id? { id: emr.vpiloto_viatura_id, eq: emr.vpil_cod, tipo: emr.vpil_cls||'VTTP', mat: emr.vpil_mat } : null,
    emr.vlci_viatura_id   ? { id: emr.vlci_viatura_id,   eq: emr.vlci_cod, tipo: emr.vlci_cls||'VLCI', mat: emr.vlci_mat } : null,
  ].filter(Boolean);

  const today = new Date().toISOString().slice(0, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Primary: MR meio with fsbf_emr_id for exclusivity tracking
    const { rows: [mrMeio] } = await client.query(
      `INSERT INTO meios
         (ocorrencia_id, viatura_id, eq, tipo, matricula,
          operacionais, responsavel, contacto, setor, missao, estado, data_chegada, fsbf_emr_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'previsto',$11,$12,$13) RETURNING *`,
      [
        req.params.occId,
        emr.mr_viatura_id || null,
        emr.mr_cod || `MR ${emr.base || emr.id.slice(0,8)}`,
        emr.mr_cls || 'MR',
        emr.mr_mat || null,
        emr.total_op || 0,
        emr.chefe_nome || null,
        emr.contacto || null,
        setor || null, missao || null,
        today, team_id, req.user.id,
      ]
    );

    // Chefe as operative on MR
    if (emr.chefe_nome) {
      const nomeOp = emr.contacto ? `${emr.chefe_nome} (${emr.contacto})` : emr.chefe_nome;
      await client.query(
        `INSERT INTO meios_operativos (meio_id, nome, ordem) VALUES ($1,$2,0)`, [mrMeio.id, nomeOp]
      );
    }

    // Secondary vehicles as children of MR (no fsbf_emr_id — tracked via meio_pai_id)
    const meios = [mrMeio];
    for (const v of secondary) {
      const { rows: [child] } = await client.query(
        `INSERT INTO meios
           (ocorrencia_id, viatura_id, meio_pai_id, eq, tipo, matricula,
            setor, missao, estado, data_chegada, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'previsto',$9,$10) RETURNING *`,
        [req.params.occId, v.id, mrMeio.id, v.eq, v.tipo, v.mat||null,
         setor||null, missao||null, today, req.user.id]
      );
      meios.push(child);
    }

    await client.query('COMMIT');
    res.json({ meios });
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}));

// ── POST /api/ocorrencias/:occId/deploy/fsbf-bsbf ──────────────
// Deploys an entire brigade (Norte/Sul/GSBF) at once.
// Creates a brigade parent meio (fsbf_bsbf_id = first vehicle row ID),
// one child meio per vehicle, each with its chefe+contact as operative.
app.post('/api/ocorrencias/:occId/deploy/fsbf-bsbf', requireCCON, wrap(async (req, res) => {
  const { brigada, data, setor, missao } = req.body;
  if (!brigada || !data) return res.status(400).json({ error: 'brigada e data obrigatórios.' });

  const { rows: vehicles } = await pool.query(`
    SELECT e.*, v.viatura_cod, v.matricula, v.classe
    FROM fsbf_bsbf_equipa e
    LEFT JOIN viaturas v ON v.id = e.veiculo_id
    WHERE e.data = $1 AND e.brigada = $2
    ORDER BY e.ordem, e.created_at
  `, [data, brigada]);
  if (!vehicles.length) return res.status(404).json({ error: 'Brigada não encontrada para essa data.' });

  // Exclusivity: check if any vehicle row in this brigade is already a parent meio
  const vehicleIds = vehicles.map(v => v.id);
  const { rows: ex } = await pool.query(
    `SELECT m.id, o.local_ignicao FROM meios m JOIN ocorrencias o ON o.id=m.ocorrencia_id
     WHERE m.fsbf_bsbf_id = ANY($1) AND m.estado<>'desmobilizado' AND m.meio_pai_id IS NULL LIMIT 1`,
    [vehicleIds]
  );
  if (ex.length) return res.status(409).json({ error: `Já despachado para "${ex[0].local_ignicao}".` });

  // Per-vehicle exclusivity: prevent same physical vehicle appearing in two active incidents
  const viaturaIds = vehicles.map(v => v.veiculo_id).filter(Boolean);
  if (viaturaIds.length) {
    const { rows: vConf } = await pool.query(
      `SELECT v.viatura_cod, o.local_ignicao FROM meios m
       JOIN viaturas v ON v.id = m.viatura_id
       JOIN ocorrencias o ON o.id = m.ocorrencia_id
       WHERE m.viatura_id = ANY($1) AND m.estado = ANY($2) LIMIT 1`,
      [viaturaIds, OCUPADO_ESTADOS]
    );
    if (vConf.length) return res.status(409).json({
      error: `Viatura "${vConf[0].viatura_cod}" já está em uso na ocorrência "${vConf[0].local_ignicao}".`
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Parent brigade container (fsbf_bsbf_id = first vehicle row, for exclusivity index)
    const { rows: [parent] } = await client.query(
      `INSERT INTO meios
         (ocorrencia_id, eq, tipo, operacionais, setor, missao, estado, data_chegada, fsbf_bsbf_id, created_by)
       VALUES ($1,$2,'BSBF',$3,$4,$5,'previsto',$6,$7,$8) RETURNING *`,
      [
        req.params.occId,
        `BSBF ${brigada}`,
        vehicles.reduce((s, v) => s + (v.guarnicao || 0), 0),
        setor || null, missao || null,
        today, vehicles[0].id, req.user.id,
      ]
    );

    // One child per vehicle
    const meios = [parent];
    for (const v of vehicles) {
      const { rows: [child] } = await client.query(
        `INSERT INTO meios
           (ocorrencia_id, viatura_id, meio_pai_id, eq, tipo, matricula,
            operacionais, responsavel, contacto, setor, missao, estado, data_chegada, fsbf_bsbf_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'previsto',$12,$13,$14) RETURNING *`,
        [
          req.params.occId,
          v.veiculo_id || null,
          parent.id,
          v.viatura_cod || `BSBF ${brigada}`,
          v.classe || 'VLCI',
          v.matricula || null,
          v.guarnicao || 0,
          v.chefe_nome || null,
          v.contacto || null,
          setor || null, missao || null,
          today, v.id, req.user.id,
        ]
      );
      // Chefe as operative chip (with contact)
      if (v.chefe_nome) {
        const nomeOp = v.contacto ? `${v.chefe_nome} (${v.contacto})` : v.chefe_nome;
        await client.query(
          `INSERT INTO meios_operativos (meio_id, nome, ordem) VALUES ($1,$2,0)`, [child.id, nomeOp]
        );
      }
      meios.push(child);
    }

    await client.query('COMMIT');
    res.json({ meios });
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}));

// ── POST /api/ocorrencias/:occId/deploy/egfr ───────────────────
app.post('/api/ocorrencias/:occId/deploy/egfr', requireCCON, wrap(async (req, res) => {
  const { data, equipa, setor, missao } = req.body;
  if (!data || !equipa) return res.status(400).json({ error: 'data e equipa obrigatórios.' });

  const [escalaRes, viatRes] = await Promise.all([
    pool.query(`
      SELECT e.nome, e.posicao
      FROM egfr_escala e
      WHERE e.data=$1 AND e.equipa=$2 ORDER BY e.posicao
    `, [data, equipa]),
    pool.query(`
      SELECT ev.viatura_id, v.viatura_cod, v.matricula, v.classe
      FROM egfr_viatura ev LEFT JOIN viaturas v ON v.id = ev.viatura_id
      WHERE ev.data=$1 AND ev.equipa=$2
    `, [data, equipa]),
  ]);
  if (!escalaRes.rows.length) return res.status(404).json({ error: 'Equipa EGFR não encontrada na escala.' });

  // Exclusivity check
  const { rows: ex } = await pool.query(
    `SELECT m.id, o.local_ignicao FROM meios m JOIN ocorrencias o ON o.id=m.ocorrencia_id
     WHERE m.egfr_data=$1 AND m.egfr_equipa=$2 AND m.estado<>'desmobilizado' AND m.meio_pai_id IS NULL LIMIT 1`,
    [data, equipa]
  );
  if (ex.length) return res.status(409).json({ error: `Já despachado para "${ex[0].local_ignicao}".` });

  const viat = viatRes.rows[0];
  const today = new Date().toISOString().slice(0,10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create or reuse composição for traceability
    const compCodigo = `EGFR-${equipa.replace(/\s+/g,'-')}-${data}`;
    let { rows: [comp] } = await client.query(`SELECT id FROM composicoes WHERE codigo=$1`, [compCodigo]);
    if (!comp) {
      ({ rows: [comp] } = await client.query(
        `INSERT INTO composicoes (codigo, tipo, notas, created_by) VALUES ($1,'EGFR_NACIONAL',$2,$3) RETURNING id`,
        [compCodigo, `${equipa} | ${data}`, req.user.id]
      ));
    }

    // Single meio — use the assigned vehicle if available, otherwise a generic EGFR entry
    const { rows: [meio] } = await client.query(
      `INSERT INTO meios
         (ocorrencia_id, composicao_id, viatura_id, eq, tipo, matricula,
          operacionais, setor, missao, estado, data_chegada, egfr_data, egfr_equipa, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'previsto',$10,$11,$12,$13) RETURNING *`,
      [
        req.params.occId, comp.id,
        viat?.viatura_id || null,
        viat?.viatura_cod || equipa,
        viat?.classe     || 'EGFR',
        viat?.matricula  || null,
        escalaRes.rows.length,
        setor || null, missao || null,
        today, data, equipa, req.user.id,
      ]
    );

    // Individual TGFR members as meios_operativos
    for (let i = 0; i < escalaRes.rows.length; i++) {
      await client.query(
        `INSERT INTO meios_operativos (meio_id, nome, ordem) VALUES ($1,$2,$3)`,
        [meio.id, escalaRes.rows[i].nome, i]
      );
    }

    await client.query('COMMIT');
    res.json({ meio, operativos: escalaRes.rows.map(r => r.nome) });
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
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
    `ALTER TABLE IF EXISTS recursos    ADD COLUMN IF NOT EXISTS fogo_controlado BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE IF EXISTS recursos    ADD COLUMN IF NOT EXISTS fogo_supressao  BOOLEAN NOT NULL DEFAULT false`,
    // National team source columns on meios
    `ALTER TABLE IF EXISTS fsbf_bsbf_equipa ADD COLUMN IF NOT EXISTS base TEXT`,
    `ALTER TABLE IF EXISTS meios ADD COLUMN IF NOT EXISTS fsbf_bsbf_id UUID REFERENCES fsbf_bsbf_equipa(id) ON DELETE SET NULL`,
    `ALTER TABLE IF EXISTS meios ADD COLUMN IF NOT EXISTS fsbf_emr_id  UUID REFERENCES fsbf_emr_equipa(id)  ON DELETE SET NULL`,
    `ALTER TABLE IF EXISTS meios ADD COLUMN IF NOT EXISTS egfr_data    DATE`,
    `ALTER TABLE IF EXISTS meios ADD COLUMN IF NOT EXISTS egfr_equipa  TEXT`,
    // Add BSBF to composicoes tipo CHECK
    `ALTER TABLE IF EXISTS composicoes DROP CONSTRAINT IF EXISTS composicoes_tipo_check`,
    `ALTER TABLE IF EXISTS composicoes ADD CONSTRAINT  composicoes_tipo_check CHECK (tipo IN ('BSF','BSBF','EGFR_NACIONAL','EGFR_LOCAL','EMR'))`,
    // Postos de Comando — create table first so FK references below succeed
    `CREATE TABLE IF NOT EXISTS postos_comando (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ocorrencia_id        UUID NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
        nome                 TEXT NOT NULL,
        tipo                 TEXT NOT NULL CHECK (tipo IN ('PCF','AIM')),
        oficial_ligacao_id   UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
        oficial_ligacao_nome TEXT,
        ativo                BOOLEAN DEFAULT true,
        created_at           TIMESTAMPTZ DEFAULT now(),
        created_by           UUID REFERENCES utilizadores(id) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_postos_ocorrencia ON postos_comando(ocorrencia_id)`,
    `ALTER TABLE IF EXISTS meios              ADD COLUMN IF NOT EXISTS posto_comando_id UUID REFERENCES postos_comando(id) ON DELETE SET NULL`,
    `ALTER TABLE IF EXISTS ocorrencias_eventos ADD COLUMN IF NOT EXISTS posto_comando_id UUID REFERENCES postos_comando(id) ON DELETE SET NULL`,
    `ALTER TABLE IF EXISTS ocorrencia_timeline ADD COLUMN IF NOT EXISTS posto_comando_id UUID REFERENCES postos_comando(id) ON DELETE SET NULL`,
    `ALTER TABLE IF EXISTS viaturas ADD COLUMN IF NOT EXISTS dispositivo BOOLEAN DEFAULT false`,
    // FSBF operacionais — independent roster table
    `CREATE TABLE IF NOT EXISTS operacionais_fsbf (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome       TEXT NOT NULL,
        n_trab     INTEGER,
        cargo      TEXT,
        contacto   TEXT,
        ativo      BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now(),
        created_by UUID REFERENCES utilizadores(id) ON DELETE SET NULL
    )`,
    `ALTER TABLE IF EXISTS operacionais_fsbf ADD COLUMN IF NOT EXISTS n_trab INTEGER`,
    `CREATE UNIQUE INDEX IF NOT EXISTS operacionais_fsbf_nome_idx ON operacionais_fsbf (nome)`,
    // Nullify duplicate codigo_ocorrencia before creating unique index (keep newest per code)
    `UPDATE ocorrencias SET codigo_ocorrencia = NULL
     WHERE codigo_ocorrencia IS NOT NULL
       AND id NOT IN (
         SELECT DISTINCT ON (codigo_ocorrencia) id
         FROM ocorrencias
         WHERE codigo_ocorrencia IS NOT NULL
         ORDER BY codigo_ocorrencia, created_at DESC NULLS LAST
       )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ocorrencias_codigo_idx ON ocorrencias (codigo_ocorrencia) WHERE codigo_ocorrencia IS NOT NULL`,
    `ALTER TABLE IF EXISTS ocorrencias ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES ocorrencias(id) ON DELETE SET NULL`,
    `DO $$ BEGIN
       ALTER TABLE ocorrencias DROP CONSTRAINT IF EXISTS ocorrencias_status_check;
       ALTER TABLE ocorrencias ADD CONSTRAINT ocorrencias_status_check
         CHECK (status IN ('active','closed','merged'));
     EXCEPTION WHEN OTHERS THEN NULL; END $$`,
    `CREATE TABLE IF NOT EXISTS recursos_adicionais (
       id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       nome                    TEXT NOT NULL,
       tipo                    TEXT,
       matricula               TEXT,
       subregiao               TEXT,
       concelho                TEXT,
       responsavel             TEXT,
       contacto                TEXT,
       obs                     TEXT,
       criado_em_ocorrencia_id UUID REFERENCES ocorrencias(id) ON DELETE SET NULL,
       created_by              UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
       created_at              TIMESTAMPTZ DEFAULT now()
     )`,
    `ALTER TABLE IF EXISTS meios ADD COLUMN IF NOT EXISTS recurso_adicional_id UUID REFERENCES recursos_adicionais(id) ON DELETE SET NULL`,
  ];
  for (const sql of preSchemaAlters) {
    await pool.query(sql);
  }

  // Aplicar schema base (idempotente — usa CREATE TABLE/INDEX IF NOT EXISTS)
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);
  console.log('Schema e migrações aplicados.');

  // Upsert operacionais_fsbf roster (runs on every deploy — safe, idempotent)
  const FSBF_OP_SEED = [
    [6261,'Abel Mota'],[6342,'Afonso Costa'],[5760,'Albino Reboredo'],[6613,'Alex Alves'],
    [6264,'Alexandre Abreu'],[6588,'Alexandre Quadrado'],[6566,'Ana Simões'],[6590,'André António'],
    [6589,'André Basso'],[6139,'André Mendes'],[6096,'André Pinto'],[493,'Antero Sousa'],
    [6614,'António Bairrada'],[6123,'Bernardo Clara'],[5621,'Bruno Branco'],[6558,'Bruno Costa'],
    [6275,'Bruno Ferreira'],[6569,'Bruno Martins'],[6127,'Bruno Oliveira'],[6108,'Bruno Pais'],
    [5878,'Bruno Pina'],[6344,'Bruno Silva'],[6568,'Bruno Simões'],[5611,'Carlos Gomes'],
    [6105,'Carlos Nunes'],[5613,'Cristiano Macieira'],[6570,'Daniel Teixeira'],[6346,'Daniel Vaz'],
    [6247,'David Bento'],[6133,'David Cardoso'],[6253,'David Lourenço'],[6605,'Dinis Panarra'],
    [6611,'Diogo Alves'],[6560,'Diogo Fernandes'],[6348,'Diogo Marques'],[6349,'Diogo Mesquita'],
    [6379,'Diogo Policarpo'],[6373,'Duarte Batista'],[6128,'Duarte Pinto'],[6571,'Eduardo Camejo'],
    [6351,'Eduardo Pité'],[6255,'Eduardo Serra'],[6124,'Fernando Horto'],[6120,'Filipe Bambulo'],
    [5810,'Filipe Monteiro'],[6355,'Francisco Baião'],[6352,'Francisco Nascimento'],
    [6375,'Francisco Pires'],[6592,'Francisco Ribeiro'],[6574,'Gonçalo Abreu'],
    [6257,'Gonçalo Ambrósio'],[6573,'Gonçalo Lameiras'],[6607,'Gonçalo Macedo'],
    [6262,'Gonçalo Menino'],[6122,'Guilherme Ruano'],[6132,'Guilherme Tavares'],
    [6372,'Guilherme Triguinho'],[6138,'Hélder Barroso'],[6358,'Hélder Magalhães'],
    [5615,'Hélder Pinelo'],[6359,'Hérmino Borges'],[6575,'Hilário Furtado'],[6576,'Hugo Vieira'],
    [6361,'João Alves'],[6100,'João Baptista'],[6578,'João Cabaço'],[5801,'João Direito'],
    [6115,'João Leite'],[6615,'João M. Ferreira'],[6384,'João Magalhães'],[6363,'João Monteiro'],
    [6610,'João Pimenta'],[6258,'João Póvoas'],[6140,'João Reis'],[6617,'João Silva'],
    [6593,'João T. Ferreira'],[6577,'João P. Vaz'],[6370,'João R. Vaz'],[6279,'Jorge Pereira'],
    [6561,'Jorge Simões'],[6273,'José C. Alves'],[6366,'José P. Alves'],[6619,'José Reis'],
    [6125,'José Santos'],[6620,'José Senra'],[6579,'José Silva'],[6099,'Júlio Abreu'],
    [6102,'Leandro Fernandes'],[6103,'Leandro Ferreira'],[6596,'Leandro Moura'],
    [6114,'Leonardo Fundo'],[6616,'Leonardo Pires'],[6580,'Lúcia Cardoso'],[6562,'Luís Carrasco'],
    [6276,'Luis Cordeiro'],[6121,'Luís Dias'],[6582,'Luís Escobar'],[6131,'Luís Francisco'],
    [6134,'Luís Lameira'],[6371,'Luís Lameiras'],[6581,'Luís Moura'],[6116,'Luís Pereira'],
    [6378,'Marcelo Diogo'],[6365,'Marcelo Ferradosa'],[6263,'Marcelo Ferraz'],
    [6583,'Marcelo Monteiro'],[6364,'Marco Silva'],[5812,'Marco Tacanho'],[6256,'Miguel Alves'],
    [6126,'Miguel Rosa'],[6362,'Miguel Salgueiro'],[6585,'Mónica Pinto'],[6360,'Natacha Querales'],
    [6587,'Natálio Serafim'],[6248,'Nuno Gandum'],[6277,'Nuno Garcia'],[6357,'Paulo Gonçalves'],
    [6280,'Paulo Inácio'],[6130,'Paulo Silva'],[5969,'Pedro Beguilhas'],[6599,'Pedro Belém'],
    [6595,'Pedro Caetano'],[6113,'Pedro Capela'],[6600,'Pedro Carvalho'],[6597,'Pedro Duarte'],
    [6274,'Pedro Ferreira'],[6062,'Pedro Figueiredo'],[6618,'Pedro Marques'],[6563,'Pedro Mendes'],
    [6376,'Pedro Oliveira'],[6594,'Pedro G. Pereira'],[6602,'Pedro R. Pereira'],
    [6129,'Rafael Justino'],[6254,'Rafael Pinto'],[6374,'Rafael Santos'],[6603,'Rafael Silva'],
    [5817,'Ricardo Firmino'],[6367,'Ricardo Mendes'],[6354,'Ricardo Paçó'],[6282,'Ricardo Paulino'],
    [6135,'Ricardo Pinheiro'],[6260,'Ricardo Pinto'],[5722,'Roberto Santos'],[6606,'Rodrigo Castro'],
    [6609,'Rodrigo Dias'],[6601,'Rodrigo Ferreira'],[6368,'Rodrigo Pereira'],[5709,'Rodrigo Rodrigues'],
    [6377,'Rúben Almeida'],[6281,'Rui Espanhol'],[6353,'Rui Venâncio'],[6252,'Samuel Nicolau'],
    [6564,'Sandro Amaro'],[6350,'Sérgio Soares'],[6109,'Telmo Dias'],[6565,'Tiago Alves'],
    [6118,'Tiago E. Costa'],[6612,'Tiago T. Costa'],[6347,'Tiago Jorge'],[6250,'Tiago Machado'],
    [6608,'Tiago Martins'],[6604,'Tiago Tavares'],[6064,'Tomás Martins'],[5987,'Vasco Pereira'],
    [6278,'Vitor Sabino'],
  ];
  await pool.query(
    `INSERT INTO operacionais_fsbf (n_trab, nome)
     SELECT unnest($1::int[]), unnest($2::text[])
     ON CONFLICT (nome) DO UPDATE SET n_trab = EXCLUDED.n_trab`,
    [FSBF_OP_SEED.map(r=>r[0]), FSBF_OP_SEED.map(r=>r[1])]
  );
  console.log(`Upsert de ${FSBF_OP_SEED.length} operacionais FSBF.`);
}

// ─── Start ────────────────────────────────────────────────────────
if (require.main === module) {
  runMigrations()
    .then(() => app.listen(PORT, () => console.log(`Gestão Meios a correr na porta ${PORT}`)))
    .catch(err => { console.error('Erro na migração:', err.message); process.exit(1); });
}

module.exports = { app, pool };
