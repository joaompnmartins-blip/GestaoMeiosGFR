'use strict';
const express  = require('express');
const { Pool } = require('pg');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const path     = require('path');

const app  = express();
// SSL é exigido por qualquer Postgres remoto. O Railway usa certificado
// self-signed, daí rejectUnauthorized:false. Localhost liga sem SSL.
// PGSSL=false força a desactivar em qualquer caso.
const _conn  = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const _local = /@(localhost|127\.0\.0\.1)[:/]/.test(_conn || '');
const pool = new Pool({
  connectionString: _conn,
  ssl: process.env.PGSSL === 'false' ? false
     : (process.env.NODE_ENV === 'production' || !_local) ? { rejectUnauthorized: false } : false,
});

const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret-CHANGE-IN-PRODUCTION';
const JWT_EXPIRES = '12h';
const PORT        = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'Gestao_Meios_v17.html')));

// ─── Role ordering ────────────────────────────────────────────────
const ROLE_ORDER   = ['visualizador', 'operacional', 'ofligacao', 'ofligacao_ccon', 'admin'];
const MODULE_ROLES = ['gestor_sf', 'gestor_fsbf', 'gestor_icnf', 'chefe_grupo_fsbf'];

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
  // Quem cria fica PCO, mas só se estiver livre. Registar uma ocorrência nunca
  // pode ser bloqueado — é o acto mais urgente da aplicação — por isso, se o
  // autor já está atribuído noutro lugar, a ocorrência nasce sem PCO e fica à
  // espera de atribuição explícita, em vez de duplicar a pessoa em silêncio.
  const autorOcupado = await ofligOcupadoEm(req.user.id);
  const ofId   = autorOcupado ? null : req.user.id;
  const ofNome = autorOcupado ? null : req.user.nome;
  try {
    const { rows } = await pool.query(
      `INSERT INTO ocorrencias
         (local_ignicao, codigo_ocorrencia, subregiao, concelho, obs, inicio, status, created_by, oficial_ligacao_id, oficial_ligacao_nome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.local_ignicao, b.codigo_ocorrencia || null, b.subregiao || null, b.concelho || null,
       b.obs || null, b.inicio || null, b.status || 'active', req.user.id, ofId, ofNome]
    );
    res.json(rows[0]);
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: `Já existe uma ocorrência com o código "${b.codigo_ocorrencia}".` });
    throw e;
  }
}));

// Um meio só está resolvido quando foi desmobilizado E chegou à base. Enquanto
// não chegar, continua a contar como ocupado (ver findRecursoConflict), pelo que
// fechar a ocorrência nesse estado prende o recurso numa ocorrência arquivada
// sem que nada o indique.
const MEIO_RESOLVIDO = `(estado='desmobilizado' AND data_chegada_entidade IS NOT NULL)`;

async function meiosPendentes(ocorrenciaId) {
  const { rows } = await pool.query(
    `SELECT eq, tipo, estado, (data_chegada_entidade IS NULL) AS sem_chegada_base
       FROM meios
      WHERE ocorrencia_id = $1 AND NOT ${MEIO_RESOLVIDO}
      ORDER BY estado, eq`, [ocorrenciaId]);
  return rows;
}

app.patch('/api/ocorrencias/:id', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;

  if ('oficial_ligacao_id' in b) {
    const ondeOF = await ofligOcupadoEm(b.oficial_ligacao_id, { ocorrenciaId: req.params.id });
    if (ondeOF) return res.status(409).json({ error: `Oficial de ligação já atribuído a: ${ondeOF}.` });
  }

  // Reabrir é reverter o arquivo: reservado ao admin e ao Oficial de Ligação
  // CCON. O oficial de ligação regional fecha a sua ocorrência, mas não a
  // reabre. Só se verifica quando o estado muda de facto — regravar uma
  // ocorrência já activa não é uma reabertura.
  if (b.status === 'active' && !['admin','ofligacao_ccon'].includes(req.user.role)) {
    const { rows: [antes] } = await pool.query(
      'SELECT status FROM ocorrencias WHERE id=$1', [req.params.id]);
    if (antes && antes.status !== 'active')
      return res.status(403).json({
        error: 'Reabrir uma ocorrência é acção do administrador ou do Oficial de Ligação CCON.' });
  }

  // Fechar exige que todos os meios estejam desmobilizados e com chegada à base.
  if (b.status === 'closed') {
    const pendentes = await meiosPendentes(req.params.id);
    if (pendentes.length) {
      return res.status(409).json({
        error: `Não é possível fechar: ${pendentes.length} meio(s) sem desmobilização completa.`,
        meios_pendentes: pendentes,
      });
    }
  }

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
    await client.query('UPDATE ocorrencia_timeline  SET ocorrencia_id = $1 WHERE ocorrencia_id = ANY($2)', [nova.id, ids]);
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
// Um pedido pendente sobre um meio-pai protege também os seus filhos: como
// meio_pai_id é ON DELETE CASCADE, aprovar o pedido remove-os, e não faz sentido
// deixá-los editar ou mudar de estado enquanto estão à espera de desaparecer.
async function hasPendingDeleteRequest(meioId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM meio_delete_requests dr
      WHERE dr.status = 'pending'
        AND (dr.meio_id = $1
             OR dr.meio_id = (SELECT meio_pai_id FROM meios WHERE id = $1))
      LIMIT 1`,
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

// Meios nacionais. O FSBF é empenhado pelo Oficial de Ligação CCON a partir da
// Carta de Meios — deploy/fsbf-bsbf, deploy/fsbf-emr e deploy/fsbf-gruata, todos
// requireCCON. Sem esta verificação, o POST genérico de meios era uma porta
// paralela para um ofligacao local empenhar meios nacionais sem passar pelo CCON.
// TFSBF não entra na lista: não tem via CCON própria e ficaria sem forma de ser
// empenhado.
const TIPOS_NACIONAIS       = ['EFSBF','EMR'];
const COMPOSICOES_NACIONAIS = ['BSBF'];
const VIA_CCON = 'Empenhamento a partir da Carta de Meios, pelo Oficial de Ligação CCON.';

// OLN é outra coisa: não é um meio que se empenhe, é a escala nacional de
// oficiais de ligação (oln_escala) que alimenta o campo Oficial de Ligação
// CCON. Por isso é recusado a todos os perfis, e não só aos locais.
const TIPOS_NAO_EMPENHAVEIS = ['OLN'];

async function erroMeioNacional(recursoId, composicaoId, role) {
  const podeNacional = role === 'admin' || role === 'ofligacao_ccon';
  if (recursoId) {
    const { rows } = await pool.query('SELECT tipo FROM recursos WHERE id=$1', [recursoId]);
    const tipo = rows[0]?.tipo;
    if (TIPOS_NAO_EMPENHAVEIS.includes(tipo))
      return `${tipo} não é um meio empenhável: é a escala nacional de oficiais de ligação, apresentada no campo Oficial de Ligação CCON.`;
    if (!podeNacional && TIPOS_NACIONAIS.includes(tipo))
      return `${tipo} é um meio nacional. ${VIA_CCON}`;
  }
  if (composicaoId && !podeNacional) {
    const { rows } = await pool.query('SELECT tipo FROM composicoes WHERE id=$1', [composicaoId]);
    if (rows[0] && COMPOSICOES_NACIONAIS.includes(rows[0].tipo))
      return `${rows[0].tipo} é uma brigada nacional. ${VIA_CCON}`;
  }
  return null;
}

// Um meio inoperacional não se empenha. Verifica-se apenas quando a atribuição
// muda: um recurso pode ser marcado INOP depois de já estar empenhado (existe
// um caso assim em produção) e isso não pode trancar o meio que já lá está.
async function erroProntidao(recursoId, viaturaId) {
  const inop = (cod, motivo) => `${cod} está inoperacional${motivo ? `: ${motivo}` : ''} e não pode ser empenhado.`;
  if (recursoId) {
    const { rows } = await pool.query(
      `SELECT codigo, prontidao_motivo FROM recursos
        WHERE id=$1 AND prontidao='inoperacional'`, [recursoId]);
    if (rows[0]) return inop(rows[0].codigo, rows[0].prontidao_motivo);
  }
  if (viaturaId) {
    const { rows } = await pool.query(
      `SELECT viatura_cod, prontidao_motivo FROM viaturas
        WHERE id=$1 AND prontidao='inoperacional'`, [viaturaId]);
    if (rows[0]) return inop(rows[0].viatura_cod, rows[0].prontidao_motivo);
  }
  return null;
}

app.post('/api/meios', requireAuth('ofligacao'), wrap(async (req, res) => {
  const b = req.body;
  const errNac = await erroMeioNacional(b.recurso_id, b.composicao_id, req.user.role);
  if (errNac) return res.status(403).json({ error: errNac });
  const errPr = await erroProntidao(b.recurso_id, b.viatura_id);
  if (errPr) return res.status(409).json({ error: errPr });
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

  // Trocar o recurso de um meio existente é outra via para o mesmo desvio. Só
  // se verifica quando o valor muda de facto: já existem meios nacionais
  // empenhados e reenviar o mesmo recurso_id ao gravar não pode trancá-los.
  if ('recurso_id' in b || 'composicao_id' in b || 'viatura_id' in b) {
    const { rows: [antes] } = await pool.query(
      'SELECT recurso_id, composicao_id, viatura_id FROM meios WHERE id=$1', [req.params.id]);
    const igual = (k) => String(b[k] ?? '') === String(antes?.[k] ?? '');
    const recNovo  = 'recurso_id'    in b && !igual('recurso_id');
    const compNovo = 'composicao_id' in b && !igual('composicao_id');
    const viatNovo = 'viatura_id'    in b && !igual('viatura_id');
    if (recNovo || compNovo) {
      const errNac = await erroMeioNacional(
        recNovo ? b.recurso_id : null, compNovo ? b.composicao_id : null, req.user.role);
      if (errNac) return res.status(403).json({ error: errNac });
    }
    if (recNovo || viatNovo) {
      const errPr = await erroProntidao(
        recNovo ? b.recurso_id : null, viatNovo ? b.viatura_id : null);
      if (errPr) return res.status(409).json({ error: errPr });
    }
  }

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
  const ondeOF = await ofligOcupadoEm(b.oficial_ligacao_id);
  if (ondeOF) return res.status(409).json({ error: `Oficial de ligação já atribuído a: ${ondeOF}.` });
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
  if ('oficial_ligacao_id' in b) {
    const ondeOF = await ofligOcupadoEm(b.oficial_ligacao_id, { postoId: req.params.id });
    if (ondeOF) return res.status(409).json({ error: `Oficial de ligação já atribuído a: ${ondeOF}.` });
  }
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
// Um oficial de ligação ocupa um só posto de cada vez: PCO de uma ocorrência ou
// oficial de um PCF/AIM. Só contam lugares vivos — ocorrência activa e, no caso
// dos postos, posto activo. Sem isto, ocorrências fechadas e postos encerrados
// iam retendo pessoas e a lista de escolha esgotava-se com o tempo.
const OFLIG_OCUPACAO_SQL = `
  SELECT o.oficial_ligacao_id AS user_id,
         'Ocorrência ' || o.local_ignicao AS onde
    FROM ocorrencias o
   WHERE o.oficial_ligacao_id IS NOT NULL AND o.status = 'active'
  UNION ALL
  SELECT p.oficial_ligacao_id AS user_id,
         p.tipo || ' ' || p.nome || ' (' || o.local_ignicao || ')' AS onde
    FROM postos_comando p
    JOIN ocorrencias o ON o.id = p.ocorrencia_id
   WHERE p.oficial_ligacao_id IS NOT NULL AND p.ativo AND o.status = 'active'
`;

app.get('/api/utilizadores/ofligacao', requireAuth('ofligacao'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.nome, u.subregiao,
            (SELECT string_agg(oc.onde, ' · ' ORDER BY oc.onde)
               FROM (${OFLIG_OCUPACAO_SQL}) oc WHERE oc.user_id = u.id) AS ocupado_em
       FROM utilizadores u
      WHERE u.role IN ('ofligacao','ofligacao_ccon','admin') AND u.ativo = true
      ORDER BY u.nome`
  );
  res.json(rows);
}));

// Onde é que este oficial já está, ignorando o lugar que se está a editar.
async function ofligOcupadoEm(userId, { ocorrenciaId, postoId } = {}) {
  if (!userId) return null;
  const { rows } = await pool.query(
    `SELECT onde FROM (${OFLIG_OCUPACAO_SQL}) oc
      WHERE oc.user_id = $1 LIMIT 1`, [userId]);
  if (!rows[0]) return null;
  // O lugar em edição não conta como conflito consigo mesmo.
  if (ocorrenciaId) {
    const { rows: [r] } = await pool.query(
      `SELECT 1 FROM ocorrencias WHERE id=$1 AND oficial_ligacao_id=$2`, [ocorrenciaId, userId]);
    if (r) return null;
  }
  if (postoId) {
    const { rows: [r] } = await pool.query(
      `SELECT 1 FROM postos_comando WHERE id=$1 AND oficial_ligacao_id=$2`, [postoId, userId]);
    if (r) return null;
  }
  return rows[0].onde;
}

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
app.patch('/api/composicoes/:id', requireAuth('visualizador'), requireModule('gestor_sf', 'ofligacao', 'ofligacao_ccon'), wrap(async (req, res) => {
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
app.delete('/api/composicoes/:id', requireAuth('visualizador'), requireModule('gestor_sf', 'ofligacao', 'ofligacao_ccon'), wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE composicoes SET ativo=false WHERE id=$1`, [req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Composição não encontrada.' });
  res.json({ ok: true });
}));

// ── Prontidão de composição (todos os membros) ──────────────────
app.post('/api/composicoes/:id/prontidao', requireAuth('visualizador'), requireModule('gestor_sf', 'ofligacao', 'ofligacao_ccon', 'admin'), wrap(async (req, res) => {
  const { prontidao, motivo } = req.body;
  if (!['operacional','inoperacional'].includes(prontidao))
    return res.status(400).json({ error: 'prontidao deve ser operacional ou inoperacional.' });

  const { rows: members } = await pool.query(
    `SELECT cm.recurso_id, cm.viatura_id, r.prontidao AS r_pront, v.prontidao AS v_pront
     FROM composicao_membros cm
     LEFT JOIN recursos r ON r.id = cm.recurso_id
     LEFT JOIN viaturas v ON v.id = cm.viatura_id
     WHERE cm.composicao_id = $1`, [req.params.id]
  );
  if (!members.length) return res.status(404).json({ error: 'Composição sem membros.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of members) {
      if (m.recurso_id) {
        await client.query(`
          UPDATE recursos SET prontidao=$2, prontidao_motivo=$3,
            prontidao_by=$4, prontidao_at=now(), updated_at=now()
          WHERE id=$1`, [m.recurso_id, prontidao, motivo||null, req.user.id]);
        await client.query(`
          INSERT INTO recursos_prontidao_eventos (recurso_id, de, para, motivo, user_id)
          VALUES ($1,$2,$3,$4,$5)`,
          [m.recurso_id, m.r_pront, prontidao, motivo||null, req.user.id]);
      }
      if (m.viatura_id) {
        await client.query(`
          UPDATE viaturas SET prontidao=$2, prontidao_motivo=$3,
            prontidao_by=$4, prontidao_at=now(), updated_at=now()
          WHERE id=$1`, [m.viatura_id, prontidao, motivo||null, req.user.id]);
      }
    }
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true, updated: members.length });
}));

// §5.4 — Instanciar composição numa ocorrência
app.post('/api/ocorrencias/:id/meios/composicao', requireAuth('ofligacao'), wrap(async (req, res) => {
  const { composicao_id, estado = 'previsto', ...camposDespacho } = req.body;
  if (!composicao_id) return res.status(400).json({ error: 'composicao_id obrigatório.' });
  const errNac = await erroMeioNacional(null, composicao_id, req.user.role);
  if (errNac) return res.status(403).json({ error: errNac });

  const { rows: [comp] } = await pool.query(
    `SELECT c.*, json_agg(json_build_object(
       'id', cm.id, 'papel', cm.papel, 'recurso_id', cm.recurso_id, 'viatura_id', cm.viatura_id,
       'codigo', COALESCE(r.codigo, v.viatura_cod),
       'tipo',   COALESCE(r.tipo,   v.classe),
       'num_elementos', COALESCE(r.num_elementos, 1),
       'matricula', v.matricula, 'contacto', r.contacto,
       'prontidao', CASE WHEN r.prontidao='inoperacional' OR v.prontidao='inoperacional'
                         THEN 'inoperacional' ELSE 'operacional' END
     ) ORDER BY cm.ordem) AS membros
     FROM composicoes c
     JOIN composicao_membros cm ON cm.composicao_id = c.id
     LEFT JOIN recursos r ON r.id = cm.recurso_id
     LEFT JOIN viaturas v ON v.id = cm.viatura_id
     WHERE c.id = $1 AND c.ativo GROUP BY c.id`,
    [composicao_id]
  );
  if (!comp) return res.status(404).json({ error: 'Composição não encontrada.' });

  // Uma composição não se empenha com membros inoperacionais: seria empenhar
  // pela porta lateral aquilo que é recusado membro a membro.
  const inops = (comp.membros || []).filter(m => m.prontidao === 'inoperacional');
  if (inops.length) {
    return res.status(409).json({
      error: `Composição com ${inops.length} membro(s) inoperacional(is): ${inops.map(m => m.codigo || '?').join(', ')}.`,
    });
  }

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

const ROLE_FONTE = { gestor_sf: 'SF', gestor_fsbf: 'FSBF', gestor_icnf: 'ICNF', chefe_grupo_fsbf: 'FSBF' };

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

const ALL_GESTORES      = requireModule('gestor_sf', 'gestor_fsbf', 'gestor_icnf');
const ALL_GESTORES_READ = requireModule('gestor_sf', 'gestor_fsbf', 'gestor_icnf', 'chefe_grupo_fsbf');

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
  // Devolver com categoria e fonte, como o GET: fonte não é coluna de recursos,
  // vem do tipo, e a ficha usa-a para decidir o que mostrar. Sem ela, um recurso
  // acabado de criar abria sem os filtros de viaturas e rádios.
  const { rows: [completo] } = await pool.query(`
    SELECT r.*, rt.categoria, f.codigo AS fonte,
           0::int AS viaturas_count, 0::int AS radios_count
    FROM recursos r
    JOIN recurso_tipos rt ON rt.codigo = r.tipo
    JOIN fontes f ON f.id = rt.fonte_id
    WHERE r.id = $1`, [r.id]);
  res.json(completo || r);
}));

app.patch('/api/gestao/recursos/:id', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  await assertFonteAccess(pool, req.params.id, req.user.role);
  const b = req.body;
  const ALLOWED = ['codigo','regime','num_elementos','entidade','local_base','lat_base','long_base',
                   'contacto','email','concelho','subregiao','agfr','notas','ativo',
                   'fogo_controlado','fogo_supressao'];
  // Capacidades EGFR: só admin e gestor_icnf, e só em recursos TGFR
  if ('fogo_controlado' in b || 'fogo_supressao' in b) {
    if (!['admin','gestor_icnf'].includes(req.user.role))
      return res.status(403).json({ error: 'Sem permissão para alterar capacidades EGFR.' });
    const { rows: [alvo] } = await pool.query(`SELECT tipo FROM recursos WHERE id=$1`, [req.params.id]);
    if (!alvo) return res.status(404).json({ error: 'Recurso não encontrado.' });
    if (alvo.tipo !== 'TGFR')
      return res.status(400).json({ error: 'Capacidades EGFR só se aplicam a recursos TGFR.' });
  }
  if ('codigo' in b && !String(b.codigo || '').trim())
    return res.status(400).json({ error: 'Código obrigatório.' });
  const sets = [], vals = [];
  for (const k of ALLOWED) {
    if (k in b) { sets.push(`${k}=$${vals.length+2}`); vals.push(k === 'codigo' ? String(b[k]).trim() : b[k]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  sets.push('updated_at=now()');
  let r;
  try {
    ({ rows: [r] } = await pool.query(
      `UPDATE recursos SET ${sets.join(',')} WHERE id=$1 RETURNING *`, [req.params.id, ...vals]
    ));
  } catch (e) {
    // codigo é UNIQUE: renomear para um já existente devolve 409, não 500
    if (e.code === '23505')
      return res.status(409).json({ error: `Já existe um recurso com o código "${String(b.codigo).trim()}".` });
    throw e;
  }
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

app.get('/api/gestao/viaturas', requireAuth('visualizador'), ALL_GESTORES_READ, wrap(async (req, res) => {
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
    WHERE ($1::text    IS NULL OR f.codigo = $1 OR v.megfr = $1)
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
  const ALLOWED = ['recurso_id','viatura_id','alias','indicativo','estado','subregiao','entidade','ativo'];
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

const FSBF_GESTORES = requireModule('gestor_fsbf', 'chefe_grupo_fsbf');

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

  // GRUATA do dia — meio nacional despachável como um todo
  const { rows: [gru] } = await pool.query(`
    SELECT g.*,
      (SELECT count(*)::int FROM fsbf_gruata_linha l WHERE l.gruata_id = g.id) AS n_veiculos,
      (SELECT COALESCE(sum(l.guarnicao),0)::int FROM fsbf_gruata_linha l WHERE l.gruata_id = g.id) AS n_op,
      m.id AS deployed_meio_id, o.local_ignicao AS deployed_occ_nome
    FROM fsbf_gruata g
    LEFT JOIN meios m ON m.fsbf_gruata_id = g.id AND m.estado <> 'desmobilizado' AND m.meio_pai_id IS NULL
    LEFT JOIN ocorrencias o ON o.id = m.ocorrencia_id
    WHERE g.data = $1`, [data]);

  res.json({
    data,
    bsbf: bsbfRes.rows.map(addDeployed),
    emr:  emrRes.rows.map(addDeployed),
    gruata: gru ? addDeployed(gru) : null,
  });
}));

// Despacha a GRUATA inteira: um meio-pai + um filho por viatura da ficha.
app.post('/api/ocorrencias/:occId/deploy/fsbf-gruata', requireCCON, wrap(async (req, res) => {
  const { data, setor, missao } = req.body;
  if (!data) return res.status(400).json({ error: 'data obrigatória.' });

  const { rows: [g] } = await pool.query(`SELECT * FROM fsbf_gruata WHERE data=$1`, [data]);
  if (!g) return res.status(404).json({ error: `Sem Gruata constituída para ${data}.` });
  const { rows: linhas } = await pool.query(
    `SELECT * FROM fsbf_gruata_linha WHERE gruata_id=$1 ORDER BY ordem`, [g.id]);
  if (!linhas.length) return res.status(404).json({ error: 'Gruata sem viaturas.' });

  const { rows: ex } = await pool.query(
    `SELECT m.id, o.local_ignicao FROM meios m JOIN ocorrencias o ON o.id=m.ocorrencia_id
     WHERE m.fsbf_gruata_id=$1 AND m.estado<>'desmobilizado' AND m.meio_pai_id IS NULL LIMIT 1`, [g.id]);
  if (ex.length) return res.status(409).json({ error: `Gruata já despachada para "${ex[0].local_ignicao}".` });

  const today = new Date().toISOString().slice(0, 10);
  const nome  = `GRUATA ${String(g.numero).padStart(2, '0')}`;
  const totalOp = linhas.reduce((s, l) => s + (l.guarnicao || 0), 0) + (g.emr_total_op || 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [parent] } = await client.query(
      `INSERT INTO meios (ocorrencia_id, eq, tipo, operacionais, responsavel, contacto,
                          setor, missao, estado, data_chegada, fsbf_gruata_id, created_by)
       VALUES ($1,$2,'GRUATA',$3,$4,$5,$6,$7,'previsto',$8,$9,$10) RETURNING *`,
      [req.params.occId, nome, totalOp, g.cmdt_nome || null, g.cmdt_contacto || null,
       setor || null, missao || null, today, g.id, req.user.id]);

    for (const l of linhas) {
      await client.query(
        `INSERT INTO meios (ocorrencia_id, meio_pai_id, eq, tipo, matricula, operacionais,
                            responsavel, contacto, setor, missao, estado, data_chegada,
                            fsbf_bsbf_id, fsbf_gruata_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'previsto',$11,$12,$13,$14)`,
        [req.params.occId, parent.id, l.veiculo || nome,
         (l.veiculo || '').split(' ')[0] || 'VLCI', l.matricula || null, l.guarnicao || 0,
         l.chefe_equipa || null, l.contacto || null, setor || null, missao || null,
         today, l.fsbf_bsbf_id || null, g.id, req.user.id]);
    }
    if (g.emr_mr) {
      await client.query(
        `INSERT INTO meios (ocorrencia_id, meio_pai_id, eq, tipo, operacionais, responsavel,
                            contacto, setor, missao, estado, data_chegada, fsbf_emr_id,
                            fsbf_gruata_id, created_by)
         VALUES ($1,$2,$3,'MR',$4,$5,$6,$7,$8,'previsto',$9,$10,$11,$12)`,
        [req.params.occId, parent.id, g.emr_mr, g.emr_total_op || 0, g.emr_chefe || null,
         g.emr_contacto || null, setor || null, missao || null, today,
         g.emr_id || null, g.id, req.user.id]);
    }
    await client.query('COMMIT');
    res.status(201).json({ ok: true, meio: parent, filhos: linhas.length + (g.emr_mr ? 1 : 0) });
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}));

// ══════════════════════════════════════════════════════════════════
//  EMPENHAMENTO por companhia
// ══════════════════════════════════════════════════════════════════
// Empenhado = pertence a uma equipa com nº de ocorrência preenchido.
// A companhia de uma viatura vem da sua base (base→companhia é 1:1 nos
// operacionais); viaturas sem base mapeável ficam de fora, tal como o
// denominador, que conta apenas viaturas no dispositivo.

const EMPENHAMENTO_SQL = `
WITH mapa AS (
  SELECT DISTINCT base, companhia FROM operacionais_fsbf
  WHERE ativo AND base IS NOT NULL AND companhia IS NOT NULL
),
comps AS (
  SELECT DISTINCT companhia FROM operacionais_fsbf WHERE ativo AND companhia IS NOT NULL
),
op_ef AS (
  SELECT companhia, count(*)::int n FROM operacionais_fsbf
  WHERE ativo AND companhia IS NOT NULL GROUP BY companhia
),
vi_ef AS (
  SELECT m.companhia, count(*)::int n
  FROM viaturas v JOIN mapa m ON m.base = v.base
  WHERE v.megfr = 'FSBF' AND v.dispositivo AND v.ativo
  GROUP BY m.companhia
),
op_emp AS (
  SELECT o.companhia, count(DISTINCT mm.operacional_id)::int n
  FROM fsbf_equipa_membros mm
  JOIN operacionais_fsbf o ON o.id = mm.operacional_id
  LEFT JOIN fsbf_bsbf_equipa b ON b.id = mm.fsbf_bsbf_id
  LEFT JOIN fsbf_emr_equipa  e ON e.id = mm.fsbf_emr_id
  WHERE mm.data = $1
    AND COALESCE(NULLIF(btrim(b.ocorrencia_num),''), NULLIF(btrim(e.ocorrencia_num),'')) IS NOT NULL
    AND o.companhia IS NOT NULL
  GROUP BY o.companhia
),
vsrc AS (
  SELECT veiculo_id       AS vid, ocorrencia_num FROM fsbf_bsbf_equipa WHERE data = $1
  UNION ALL SELECT mr_viatura_id,      ocorrencia_num FROM fsbf_emr_equipa WHERE data = $1
  UNION ALL SELECT vaop_viatura_id,    ocorrencia_num FROM fsbf_emr_equipa WHERE data = $1
  UNION ALL SELECT vpiloto_viatura_id, ocorrencia_num FROM fsbf_emr_equipa WHERE data = $1
  UNION ALL SELECT vlci_viatura_id,    ocorrencia_num FROM fsbf_emr_equipa WHERE data = $1
),
vi_emp AS (
  SELECT m.companhia, count(DISTINCT v.id)::int n
  FROM vsrc x
  JOIN viaturas v ON v.id = x.vid
  JOIN mapa m ON m.base = v.base
  WHERE x.vid IS NOT NULL
    AND COALESCE(btrim(x.ocorrencia_num),'') <> ''
    AND v.dispositivo AND v.ativo
  GROUP BY m.companhia
)
SELECT c.companhia,
       COALESCE(oe.n,0) AS op_empenhados, COALESCE(oef.n,0) AS op_efetivo,
       COALESCE(ve.n,0) AS vi_empenhadas, COALESCE(vef.n,0) AS vi_efetivo
FROM comps c
LEFT JOIN op_emp oe  ON oe.companhia  = c.companhia
LEFT JOIN op_ef  oef ON oef.companhia = c.companhia
LEFT JOIN vi_emp ve  ON ve.companhia  = c.companhia
LEFT JOIN vi_ef  vef ON vef.companhia = c.companhia
ORDER BY CASE c.companhia WHEN 'Norte' THEN 1 WHEN 'Centro' THEN 2 WHEN 'Sul' THEN 3 ELSE 4 END`;

const pct = (n, d) => d ? Math.round((n / d) * 1000) / 10 : 0;

// pg devolve DATE como Date à meia-noite local; usar toISOString aqui recuaria
// um dia no horário de verão.
const diaISO = d => d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  : String(d).slice(0, 10);

// Corrigir a ocorrência de uma equipa muda o empenhamento desse dia. Refrescar
// aqui evita ter de carregar em "Recalcular dia" depois de cada correcção.
async function refrescarEmpenhamento(data) {
  try { await gravarEmpenhamento(diaISO(data)); }
  catch (e) { console.warn('empenhamento não refrescado:', e.message); }
}

async function calcularEmpenhamento(data) {
  const { rows } = await pool.query(EMPENHAMENTO_SQL, [data]);
  return rows;
}

async function gravarEmpenhamento(data) {
  const rows = await calcularEmpenhamento(data);
  for (const r of rows) {
    await pool.query(
      `INSERT INTO fsbf_empenhamento_diario
         (data, companhia, op_empenhados, op_efetivo, vi_empenhadas, vi_efetivo, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (data, companhia) DO UPDATE SET
         op_empenhados=EXCLUDED.op_empenhados, op_efetivo=EXCLUDED.op_efetivo,
         vi_empenhadas=EXCLUDED.vi_empenhadas, vi_efetivo=EXCLUDED.vi_efetivo,
         atualizado_em=now()`,
      [data, r.companhia, r.op_empenhados, r.op_efetivo, r.vi_empenhadas, r.vi_efetivo]);
  }
  return rows;
}

// Série do período. O dia corrente é sempre recalculado (ainda está a mudar);
// os dias passados vêm do instantâneo, para que editar uma carta antiga não
// reescreva a série já registada.
app.get('/api/fsbf/empenhamento', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const hoje = new Date().toISOString().slice(0, 10);
  const ate  = req.query.ate || hoje;
  const de   = req.query.de  ||
    new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  if (de > ate) return res.status(400).json({ error: 'Intervalo inválido.' });

  if (ate >= hoje && de <= hoje) await gravarEmpenhamento(hoje);

  // Preencher os dias que têm carta mas ainda não têm instantâneo. Sem isto,
  // um dia só entrava na série se alguém abrisse esta página nesse próprio dia
  // ou carregasse em "Recalcular dia" — e ficava invisível para sempre.
  // Um dia com carta e sem empenhamento fica a zeros, que é um facto, não um vazio.
  const { rows: emFalta } = await pool.query(`
    SELECT DISTINCT x.d::text AS d FROM (
      SELECT data AS d FROM fsbf_bsbf_equipa WHERE data BETWEEN $1 AND $2
      UNION SELECT data FROM fsbf_emr_equipa WHERE data BETWEEN $1 AND $2
    ) x
    WHERE NOT EXISTS (SELECT 1 FROM fsbf_empenhamento_diario e WHERE e.data = x.d)
    ORDER BY 1`, [de, ate]);
  for (const r of emFalta) await gravarEmpenhamento(r.d);

  const { rows } = await pool.query(
    `SELECT data::text, companhia, op_empenhados, op_efetivo, vi_empenhadas, vi_efetivo
     FROM fsbf_empenhamento_diario
     WHERE data BETWEEN $1 AND $2
     ORDER BY data, CASE companhia WHEN 'Norte' THEN 1 WHEN 'Centro' THEN 2 WHEN 'Sul' THEN 3 ELSE 4 END`,
    [de, ate]);
  res.json({
    de, ate, hoje,
    series: rows.map(r => ({ ...r,
      op_pct: pct(r.op_empenhados, r.op_efetivo),
      vi_pct: pct(r.vi_empenhadas, r.vi_efetivo) })),
  });
}));

// Recalcular um dia — necessário depois de corrigir uma carta antiga.
app.post('/api/fsbf/empenhamento/snapshot', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'data obrigatória.' });
  const rows = await gravarEmpenhamento(data);
  res.json({ ok: true, data, companhias: rows.length });
}));

// ══════════════════════════════════════════════════════════════════
//  GRUATA — força especial constituída a partir do GSBF da carta
// ══════════════════════════════════════════════════════════════════

const gruataEmrSnapshot = e => ({
  emr_mr: e?.mr_cod || null,
  emr_vaop: e?.vaop_cod || null,           emr_vaop_matricula: e?.vaop_matricula || null,
  emr_piloto: e?.vpil_cod || null,         emr_piloto_matricula: e?.vpil_matricula || null,
  emr_chefe: e?.chefe_nome || null,        emr_contacto: e?.contacto || null,
  emr_total_op: e?.total_op ?? null,       emr_obs: e?.observacoes || null,
});

async function loadGruata(data) {
  const { rows: [g] } = await pool.query(`SELECT * FROM fsbf_gruata WHERE data=$1`, [data]);
  const [linhasRes, emrsRes] = await Promise.all([
    g ? pool.query(`SELECT * FROM fsbf_gruata_linha WHERE gruata_id=$1 ORDER BY ordem`, [g.id])
      : Promise.resolve({ rows: [] }),
    pool.query(`
      SELECT e.id, e.base, e.chefe_nome, e.contacto, e.total_op, e.observacoes,
             mr.viatura_cod AS mr_cod,
             vaop.viatura_cod AS vaop_cod, vaop.matricula AS vaop_matricula,
             vpil.viatura_cod AS vpil_cod, vpil.matricula AS vpil_matricula
      FROM fsbf_emr_equipa e
      LEFT JOIN viaturas mr   ON mr.id   = e.mr_viatura_id
      LEFT JOIN viaturas vaop ON vaop.id = e.vaop_viatura_id
      LEFT JOIN viaturas vpil ON vpil.id = e.vpiloto_viatura_id
      WHERE e.data = $1 ORDER BY e.ordem, e.created_at`, [data]),
  ]);
  return { data, gruata: g || null, linhas: linhasRes.rows, emrs: emrsRes.rows };
}

app.get('/api/fsbf/gruata', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const data = req.query.data || new Date().toISOString().slice(0, 10);
  res.json(await loadGruata(data));
}));

// Constituir/repopular: copia as linhas GSBF da carta desse dia.
app.post('/api/fsbf/gruata/constituir', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'data obrigatória.' });
  const { rows: gsbf } = await pool.query(`
    SELECT e.*, v.viatura_cod, v.matricula
    FROM fsbf_bsbf_equipa e
    LEFT JOIN viaturas v ON v.id = e.veiculo_id
    WHERE e.data=$1 AND e.brigada='GSBF' ORDER BY e.ordem, e.created_at`, [data]);
  if (!gsbf.length)
    return res.status(404).json({ error: `Sem linhas GSBF na Carta de Meios de ${data}.` });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [g] } = await client.query(
      `INSERT INTO fsbf_gruata (data, created_by) VALUES ($1,$2)
       ON CONFLICT (data) DO UPDATE SET updated_at=now() RETURNING *`, [data, req.user.id]);
    // Repopular preserva o ISSI já escrito, que não existe na carta
    const { rows: prev } = await client.query(
      `SELECT fsbf_bsbf_id, issi FROM fsbf_gruata_linha WHERE gruata_id=$1`, [g.id]);
    const issiPor = Object.fromEntries(prev.filter(p => p.fsbf_bsbf_id).map(p => [p.fsbf_bsbf_id, p.issi]));
    await client.query(`DELETE FROM fsbf_gruata_linha WHERE gruata_id=$1`, [g.id]);
    for (let i = 0; i < gsbf.length; i++) {
      const v = gsbf[i];
      await client.query(
        `INSERT INTO fsbf_gruata_linha
           (gruata_id, fsbf_bsbf_id, ordem, veiculo, matricula, chefe_equipa, contacto, issi, guarnicao, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [g.id, v.id, i, v.viatura_cod || null, v.matricula || null, v.chefe_nome || null,
         v.contacto || null, issiPor[v.id] || null, v.guarnicao ?? null, v.observacoes || null]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  res.json(await loadGruata(data));
}));

app.put('/api/fsbf/gruata', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  if (!b.data) return res.status(400).json({ error: 'data obrigatória.' });
  const F = ['ocorrencia_num','cmdt_nome','cmdt_contacto','cmdt_indicativo','cmdt_issi',
             'previsao_saida','local_destino','previsao_chegada_pp','emr_issi'];
  const { rows: [g] } = await pool.query(
    `INSERT INTO fsbf_gruata (data, ${F.join(',')}, created_by)
     VALUES ($1,${F.map((_, i) => `$${i + 2}`).join(',')},$${F.length + 2})
     ON CONFLICT (data) DO UPDATE SET
       ${F.map((f, i) => `${f}=$${i + 2}`).join(', ')}, updated_at=now()
     RETURNING *`,
    [b.data, ...F.map(f => b[f] ?? null), req.user.id]);

  // A ocorrência da Gruata desce às equipas GSBF de origem: uma Gruata
  // constituída para uma ocorrência empenha as suas guarnições.
  const ocor = (b.ocorrencia_num || '').trim() || null;
  await pool.query(
    `UPDATE fsbf_bsbf_equipa SET ocorrencia_num=$2, updated_at=now()
     WHERE id IN (SELECT fsbf_bsbf_id FROM fsbf_gruata_linha
                  WHERE gruata_id=$1 AND fsbf_bsbf_id IS NOT NULL)`, [g.id, ocor]);
  if (g.emr_id) await pool.query(
    `UPDATE fsbf_emr_equipa SET ocorrencia_num=$2, updated_at=now() WHERE id=$1`, [g.emr_id, ocor]);

  res.json(await loadGruata(b.data));
}));

// Escolher a EMR: guarda o instantâneo e marca a base da EMR na carta.
app.put('/api/fsbf/gruata/emr', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const { data, emr_id } = req.body;
  if (!data) return res.status(400).json({ error: 'data obrigatória.' });
  const { rows: [g] } = await pool.query(`SELECT * FROM fsbf_gruata WHERE data=$1`, [data]);
  if (!g) return res.status(404).json({ error: 'Gruata ainda não constituída.' });

  // Trocar ou retirar a EMR devolve a base anterior à EMR que sai
  if (g.emr_id && g.emr_id !== emr_id) {
    await pool.query(
      `UPDATE fsbf_emr_equipa SET base=$2, updated_at=now() WHERE id=$1`,
      [g.emr_id, g.emr_base_anterior ?? null]);
  }

  let snap = gruataEmrSnapshot(null);
  let baseAnterior = null;
  if (emr_id) {
    const { rows: [e] } = await pool.query(`
      SELECT e.*, mr.viatura_cod AS mr_cod,
             vaop.viatura_cod AS vaop_cod, vaop.matricula AS vaop_matricula,
             vpil.viatura_cod AS vpil_cod, vpil.matricula AS vpil_matricula
      FROM fsbf_emr_equipa e
      LEFT JOIN viaturas mr   ON mr.id   = e.mr_viatura_id
      LEFT JOIN viaturas vaop ON vaop.id = e.vaop_viatura_id
      LEFT JOIN viaturas vpil ON vpil.id = e.vpiloto_viatura_id
      WHERE e.id=$1`, [emr_id]);
    if (!e) return res.status(404).json({ error: 'EMR não encontrada.' });
    snap = gruataEmrSnapshot(e);
    // Guardar a base original antes de a substituir, para poder ser reposta
    baseAnterior = (g.emr_id === emr_id) ? (g.emr_base_anterior ?? null) : (e.base ?? null);
    // A EMR integrada na Gruata passa a ter GSBF01 como base na carta
    await pool.query(
      `UPDATE fsbf_emr_equipa SET base='GSBF01', ocorrencia_num=COALESCE($2, ocorrencia_num), updated_at=now()
       WHERE id=$1`, [emr_id, (g.ocorrencia_num || '').trim() || null]);
  }
  const K = Object.keys(snap);
  await pool.query(
    `UPDATE fsbf_gruata SET emr_id=$2, emr_base_anterior=$3,
       ${K.map((k, i) => `${k}=$${i + 4}`).join(', ')}, updated_at=now()
     WHERE id=$1`, [g.id, emr_id || null, baseAnterior, ...K.map(k => snap[k])]);
  res.json(await loadGruata(data));
}));

app.patch('/api/fsbf/gruata/linha/:id', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const ALLOWED = ['issi','veiculo','matricula','chefe_equipa','contacto','guarnicao','observacoes'];
  const sets = [], vals = [req.params.id];
  for (const k of ALLOWED)
    if (k in req.body) { sets.push(`${k}=$${vals.length + 1}`); vals.push(req.body[k] ?? null); }
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para actualizar.' });
  const { rows: [l] } = await pool.query(
    `UPDATE fsbf_gruata_linha SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals);
  if (!l) return res.status(404).json({ error: 'Linha não encontrada.' });
  res.json(l);
}));

// Eliminar a Gruata desfaz também o que ela escreveu na carta: a ocorrência
// que desceu às equipas GSBF e a base GSBF01 da EMR. Só limpa a ocorrência
// nas equipas que ainda têm exactamente o número da Gruata, para não apagar
// um valor entretanto posto à mão noutra ocorrência.
app.delete('/api/fsbf/gruata', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const data = req.query.data;
  if (!data) return res.status(400).json({ error: 'data obrigatória.' });
  const { rows: [g] } = await pool.query(`SELECT * FROM fsbf_gruata WHERE data=$1`, [data]);
  if (!g) return res.status(404).json({ error: `Sem Gruata em ${data}.` });

  const { rows: [dep] } = await pool.query(
    `SELECT m.id, o.local_ignicao FROM meios m JOIN ocorrencias o ON o.id=m.ocorrencia_id
     WHERE m.fsbf_gruata_id=$1 AND m.estado<>'desmobilizado' LIMIT 1`, [g.id]);
  if (dep) return res.status(409).json({
    error: `Gruata despachada para "${dep.local_ignicao}". Desmobilize-a antes de eliminar.` });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ocor = (g.ocorrencia_num || '').trim() || null;
    if (ocor) {
      await client.query(
        `UPDATE fsbf_bsbf_equipa SET ocorrencia_num=NULL, updated_at=now()
         WHERE ocorrencia_num=$2
           AND id IN (SELECT fsbf_bsbf_id FROM fsbf_gruata_linha
                      WHERE gruata_id=$1 AND fsbf_bsbf_id IS NOT NULL)`, [g.id, ocor]);
      if (g.emr_id) await client.query(
        `UPDATE fsbf_emr_equipa SET ocorrencia_num=NULL, updated_at=now()
         WHERE id=$1 AND ocorrencia_num=$2`, [g.emr_id, ocor]);
    }
    if (g.emr_id) await client.query(
      `UPDATE fsbf_emr_equipa SET base=$2, updated_at=now() WHERE id=$1 AND base='GSBF01'`,
      [g.emr_id, g.emr_base_anterior ?? null]);
    await client.query(`DELETE FROM fsbf_gruata WHERE id=$1`, [g.id]);   // linhas por CASCADE
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  res.json({ ok: true });
}));

// ── Membros de guarnição ───────────────────────────────────────

// Reflecte o chefe_nome de uma equipa numa linha de membro (is_chefe).
// chefe_nome é texto livre; operacionais_fsbf.nome tem índice único, por isso
// a resolução por nome é fiável — um nome que não resolva fica simplesmente
// sem linha e aparece como não identificado nas estatísticas.
async function syncChefeMembro(db, { data, bsbfId = null, emrId = null, chefeNome }) {
  const col = bsbfId ? 'fsbf_bsbf_id' : 'fsbf_emr_id';
  const id  = bsbfId || emrId;
  await db.query(`DELETE FROM fsbf_equipa_membros WHERE ${col}=$1 AND is_chefe`, [id]);
  if (!chefeNome) return { ok: true };
  const { rows: [op] } = await db.query(
    `SELECT id, nome FROM operacionais_fsbf WHERE nome = $1 AND ativo`, [chefeNome]);
  if (!op) return { ok: true, unresolved: chefeNome };
  try {
    await db.query(
      `INSERT INTO fsbf_equipa_membros (data, ${col}, operacional_id, is_chefe, ordem)
       VALUES ($1,$2,$3,true,-1)`, [data, id, op.id]);
  } catch (e) {
    if (e.code === '23505') return { ok: false, conflito: op.nome };
    throw e;
  }
  return { ok: true };
}

// Empenhamento por companhia. "Empenhado" = pertence a uma equipa com nº de
// ocorrência preenchido; estar na carta sem ocorrência é prontidão, não
// empenhamento. Percentagem sobre o efetivo total de cada companhia.
async function companhiaStats(data) {
  const { rows } = await pool.query(`
    WITH empenhados AS (
      SELECT m.operacional_id AS op
      FROM fsbf_equipa_membros m
      LEFT JOIN fsbf_bsbf_equipa b ON b.id = m.fsbf_bsbf_id
      LEFT JOIN fsbf_emr_equipa  e ON e.id = m.fsbf_emr_id
      WHERE m.data = $1
        AND COALESCE(NULLIF(btrim(b.ocorrencia_num), ''),
                     NULLIF(btrim(e.ocorrencia_num), '')) IS NOT NULL
    ),
    efetivo AS (
      SELECT companhia, count(*)::int AS total
      FROM operacionais_fsbf WHERE ativo AND companhia IS NOT NULL GROUP BY companhia
    ),
    destacados AS (
      SELECT o.companhia, count(*)::int AS n
      FROM empenhados e JOIN operacionais_fsbf o ON o.id = e.op
      WHERE o.companhia IS NOT NULL GROUP BY o.companhia
    )
    SELECT ef.companhia, COALESCE(d.n,0) AS n, ef.total AS efetivo
    FROM efetivo ef LEFT JOIN destacados d ON d.companhia = ef.companhia
    ORDER BY CASE ef.companhia WHEN 'Norte' THEN 1 WHEN 'Centro' THEN 2 WHEN 'Sul' THEN 3 ELSE 4 END
  `, [data]);
  return rows.map(r => ({
    companhia: r.companhia, n: r.n, efetivo: r.efetivo,
    pct: r.efetivo ? Math.round((r.n / r.efetivo) * 1000) / 10 : 0,
  }));
}

// Substitui os membros não-chefe de uma equipa (operação atómica).
app.put('/api/fsbf/membros', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const { data, fsbf_bsbf_id = null, fsbf_emr_id = null, operacional_ids = [] } = req.body;
  if (!data) return res.status(400).json({ error: 'data obrigatória.' });
  if (!!fsbf_bsbf_id === !!fsbf_emr_id)
    return res.status(400).json({ error: 'Indique exactamente uma equipa.' });
  const col = fsbf_bsbf_id ? 'fsbf_bsbf_id' : 'fsbf_emr_id';
  const id  = fsbf_bsbf_id || fsbf_emr_id;
  const ids = [...new Set(operacional_ids.filter(Boolean))];

  // A base da linha é a referência contra a qual se verifica a base de cada
  // operacional. Sem ela não há nada a comparar, pelo que identificar a
  // guarnição não faz sentido. Esvaziar continua permitido: se uma linha ficar
  // sem base depois de ter guarnição, é preciso poder corrigi-la.
  if (ids.length) {
    const tabela = fsbf_bsbf_id ? 'fsbf_bsbf_equipa' : 'fsbf_emr_equipa';
    const { rows: [linha] } = await pool.query(
      `SELECT base FROM ${tabela} WHERE id=$1`, [id]);
    if (!linha) return res.status(404).json({ error: 'Equipa não encontrada.' });
    if (!(linha.base || '').trim())
      return res.status(409).json({
        error: 'Selecione a base da linha antes de identificar a guarnição.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM fsbf_equipa_membros WHERE ${col}=$1 AND NOT is_chefe`, [id]);
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        `INSERT INTO fsbf_equipa_membros (data, ${col}, operacional_id, ordem, created_by)
         VALUES ($1,$2,$3,$4,$5)`, [data, id, ids[i], i, req.user.id]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      const { rows: [o] } = await pool.query(
        `SELECT m.operacional_id, o.nome FROM fsbf_equipa_membros m
         JOIN operacionais_fsbf o ON o.id = m.operacional_id
         WHERE m.data=$1 AND m.operacional_id = ANY($2::uuid[]) AND m.${col} IS DISTINCT FROM $3
         LIMIT 1`, [data, ids, id]);
      return res.status(409).json({
        error: o ? `${o.nome} já está noutra guarnição neste dia.`
                 : 'Operacional já atribuído a outra guarnição neste dia.' });
    }
    throw e;
  } finally { client.release(); }
  res.json({ ok: true, membros: ids.length });
}));

// ── GET /api/fsbf/carta?data= ──────────────────────────────────
app.get('/api/fsbf/carta', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const data = req.query.data || new Date().toISOString().slice(0, 10);

  const [cartaRes, bsbfRes, emrRes, membrosRes] = await Promise.all([
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
    pool.query(`
      SELECT m.id, m.fsbf_bsbf_id, m.fsbf_emr_id, m.operacional_id, m.is_chefe, m.ordem,
             o.nome, o.companhia, o.base
      FROM fsbf_equipa_membros m
      JOIN operacionais_fsbf o ON o.id = m.operacional_id
      WHERE m.data = $1
      ORDER BY m.ordem, o.nome
    `, [data]),
  ]);

  const membros = membrosRes.rows;
  const forCrew = (key, id) => membros.filter(m => m[key] === id);

  res.json({
    data,
    carta: cartaRes.rows[0] || null,
    bsbf:  bsbfRes.rows.map(r => ({ ...r, membros: forCrew('fsbf_bsbf_id', r.id) })),
    emr:   emrRes.rows.map(r => ({ ...r, membros: forCrew('fsbf_emr_id',  r.id) })),
    companhias: await companhiaStats(data),
  });
}));

// Guarnições e totais de operacionais são de um só dígito. O cliente já limita
// o campo, mas a API tem de impor o mesmo limite: um valor absurdo aqui chega à
// carta (que rende `guarnicao - 1` dropdowns de membro) e às estatísticas de
// empenhamento. O CHECK na base é a última rede; isto devolve 400 em vez de 500.
const MAX_GUARNICAO = 9;
function erroGuarnicao(body, campos) {
  for (const k of campos) {
    if (!(k in body) || body[k] == null || body[k] === '') continue;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < 0 || n > MAX_GUARNICAO)
      return `${k}: só são aceites números inteiros entre 0 e ${MAX_GUARNICAO}.`;
  }
  return null;
}

// ── PUT /api/fsbf/carta (upsert header) ───────────────────────
app.put('/api/fsbf/carta', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  if (!b.data) return res.status(400).json({ error: 'data obrigatória.' });
  const errG = erroGuarnicao(b, ['chefe_guarnicao']);
  if (errG) return res.status(400).json({ error: errG });
  // Cada bloco do cabeçalho valida-se por si: editar o Coordenador não pode
  // anular a confirmação do Chefe de Grupo, e vice-versa.
  const CAMPOS = {
    coord: ['coord_nome','coord_contacto'],
    chefe: ['chefe_nome','chefe_contacto','chefe_guarnicao','chefe_veiculo_id','chefe_veiculo_texto'],
  };
  const { rows: [antes] } = await pool.query(`SELECT * FROM fsbf_carta WHERE data=$1`, [b.data]);
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

  // Mesma regra do resto da carta: confirmar é explícito, alterar anula
  const sets = [], vals = [carta.data];
  for (const g of ['coord','chefe']) {
    const chave = `${g}_validado`;
    if (chave in b) {
      if (b[chave]) {
        vals.push(req.user.id);
        sets.push(`${chave}=true`, `${g}_validado_por=$${vals.length}`, `${g}_validado_em=now()`);
      } else {
        sets.push(`${chave}=false`, `${g}_validado_por=NULL`, `${g}_validado_em=NULL`);
      }
    } else if (antes?.[chave]) {
      const mudou = CAMPOS[g].some(k => k in b && String(b[k] ?? '') !== String(antes[k] ?? ''));
      if (mudou) sets.push(`${chave}=false`, `${g}_validado_por=NULL`, `${g}_validado_em=NULL`);
    }
  }
  if (sets.length) {
    const { rows: [upd] } = await pool.query(
      `UPDATE fsbf_carta SET ${sets.join(',')} WHERE data=$1 RETURNING *`, vals);
    return res.json(upd);
  }
  res.json(carta);
}));

// ── POST /api/fsbf/carta/copy — replicate a day's carta to another day ──
app.post('/api/fsbf/carta/copy', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from e to são obrigatórios.' });
  if (from === to)  return res.status(400).json({ error: 'from e to devem ser datas diferentes.' });

  const [cartaRes, bsbfRes, emrRes] = await Promise.all([
    pool.query(`SELECT * FROM fsbf_carta WHERE data=$1`, [from]),
    pool.query(`SELECT * FROM fsbf_bsbf_equipa WHERE data=$1 ORDER BY brigada, ordem, created_at`, [from]),
    pool.query(`SELECT * FROM fsbf_emr_equipa   WHERE data=$1 ORDER BY ordem, created_at`, [from]),
  ]);

  const carta = cartaRes.rows[0];
  const bsbf  = bsbfRes.rows;
  const emr   = emrRes.rows;

  if (!carta && !bsbf.length && !emr.length)
    return res.status(404).json({ error: `Sem dados registados para ${from}.` });

  // Replace target day
  await pool.query(`DELETE FROM fsbf_bsbf_equipa WHERE data=$1`, [to]);
  await pool.query(`DELETE FROM fsbf_emr_equipa   WHERE data=$1`, [to]);

  if (carta) {
    await pool.query(`
      INSERT INTO fsbf_carta
        (data,coord_nome,coord_contacto,chefe_nome,chefe_contacto,chefe_guarnicao,
         chefe_veiculo_id,chefe_veiculo_texto,notas_outros_meios,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (data) DO UPDATE SET
        coord_nome=$2,coord_contacto=$3,chefe_nome=$4,chefe_contacto=$5,
        chefe_guarnicao=$6,chefe_veiculo_id=$7,chefe_veiculo_texto=$8,
        notas_outros_meios=$9,updated_by=$10,updated_at=now()
    `, [to, carta.coord_nome||null, carta.coord_contacto||null,
        carta.chefe_nome||null, carta.chefe_contacto||null, carta.chefe_guarnicao||null,
        carta.chefe_veiculo_id||null, carta.chefe_veiculo_texto||null,
        carta.notas_outros_meios||null, req.user.id]);
  }

  // Guarda o mapa antigo→novo id: as linhas são recriadas com ids novos e os
  // membros de guarnição têm de ser reapontados (o DELETE acima já removeu os
  // membros do dia de destino por CASCADE).
  const idMap = { bsbf: {}, emr: {} };

  for (const e of bsbf) {
    const { rows: [n] } = await pool.query(`
      INSERT INTO fsbf_bsbf_equipa
        (data,brigada,base,veiculo_id,guarnicao,chefe_nome,contacto,observacoes,ordem,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
    `, [to, e.brigada, e.base||null, e.veiculo_id||null, e.guarnicao||null,
        e.chefe_nome||null, e.contacto||null, e.observacoes||null, e.ordem, req.user.id]);
    idMap.bsbf[e.id] = n.id;
  }

  for (const e of emr) {
    const { rows: [n] } = await pool.query(`
      INSERT INTO fsbf_emr_equipa
        (data,base,mr_viatura_id,vaop_viatura_id,vpiloto_viatura_id,vlci_viatura_id,
         chefe_nome,contacto,total_op,observacoes,ordem,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
    `, [to, e.base||null, e.mr_viatura_id||null, e.vaop_viatura_id||null,
        e.vpiloto_viatura_id||null, e.vlci_viatura_id||null,
        e.chefe_nome||null, e.contacto||null, e.total_op||null, e.observacoes||null,
        e.ordem, req.user.id]);
    idMap.emr[e.id] = n.id;
  }

  // Replicar membros de guarnição para as novas linhas
  const { rows: membros } = await pool.query(
    `SELECT * FROM fsbf_equipa_membros WHERE data=$1`, [from]);
  let copiados = 0;
  for (const m of membros) {
    const novoB = m.fsbf_bsbf_id ? idMap.bsbf[m.fsbf_bsbf_id] : null;
    const novoE = m.fsbf_emr_id  ? idMap.emr[m.fsbf_emr_id]   : null;
    if (!novoB && !novoE) continue;
    await pool.query(
      `INSERT INTO fsbf_equipa_membros
         (data, fsbf_bsbf_id, fsbf_emr_id, operacional_id, is_chefe, ordem, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (data, operacional_id) DO NOTHING`,
      [to, novoB, novoE, m.operacional_id, m.is_chefe, m.ordem, req.user.id]);
    copiados++;
  }

  res.json({ ok: true, copied: { carta: !!carta, bsbf: bsbf.length, emr: emr.length, membros: copiados } });
}));

// ── BSBF entries CRUD ──────────────────────────────────────────
app.post('/api/fsbf/bsbf', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  if (!b.data || !b.brigada) return res.status(400).json({ error: 'data e brigada obrigatórios.' });
  const errG = erroGuarnicao(b, ['guarnicao']);
  if (errG) return res.status(400).json({ error: errG });
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

// Decide o que fazer ao estado de validação num PATCH.
//  - validado:true explícito  -> confirma (guardar-e-validar é uma só acção)
//  - validado:false explícito -> anula
//  - alteração real de um campo -> anula, porque a confirmação deixou de descrever
//    a linha. Compara-se com o valor actual: gravar sem alterar nada (o que
//    acontece ao adicionar uma linha, que grava todas as outras) não deve anular.
function validacaoSets(body, atual, campos, userId, vals) {
  if ('validado' in body) {
    if (body.validado) {
      vals.push(userId);
      return [`validado=true`, `validado_por=$${vals.length}`, `validado_em=now()`];
    }
    return [`validado=false`, `validado_por=NULL`, `validado_em=NULL`];
  }
  if (!atual?.validado) return [];
  const mudou = campos.some(k => k in body &&
    String(body[k] ?? '') !== String(atual[k] ?? ''));
  return mudou ? [`validado=false`, `validado_por=NULL`, `validado_em=NULL`] : [];
}

app.patch('/api/fsbf/bsbf/:id', requireAuth('visualizador'), FSBF_GESTORES, wrap(async (req, res) => {
  const b = req.body;
  const ALLOWED = ['base','veiculo_id','guarnicao','chefe_nome','contacto','observacoes','ocorrencia_num','ordem'];
  const SUBST  = ALLOWED.filter(k => k !== 'ordem');
  const errG = erroGuarnicao(b, ['guarnicao']);
  if (errG) return res.status(400).json({ error: errG });
  const { rows: [atual] } = await pool.query(`SELECT * FROM fsbf_bsbf_equipa WHERE id=$1`, [req.params.id]);
  if (!atual) return res.status(404).json({ error: 'Entrada não encontrada.' });
  const sets = [], vals = [req.params.id];
  for (const k of ALLOWED) {
    if (k in b) { sets.push(`${k}=$${vals.length+1}`); vals.push(b[k] ?? null); }
  }
  sets.push(...validacaoSets(b, atual, SUBST, req.user.id, vals));
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para actualizar.' });
  sets.push(`updated_at=now()`);
  const { rows: [e] } = await pool.query(
    `UPDATE fsbf_bsbf_equipa SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals
  );
  if (!e) return res.status(404).json({ error: 'Entrada não encontrada.' });
  if ('chefe_nome' in b) {
    const r = await syncChefeMembro(pool, { data: e.data, bsbfId: e.id, chefeNome: e.chefe_nome });
    if (!r.ok) return res.status(409).json({ error: `${r.conflito} já está noutra guarnição neste dia.` });
  }
  if ('ocorrencia_num' in b && String(b.ocorrencia_num ?? '') !== String(atual.ocorrencia_num ?? ''))
    await refrescarEmpenhamento(e.data);
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
  const errG = erroGuarnicao(b, ['total_op']);
  if (errG) return res.status(400).json({ error: errG });
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
                   'vlci_viatura_id','chefe_nome','contacto','total_op','observacoes',
                   'ocorrencia_num','ordem'];
  const SUBST  = ALLOWED.filter(k => k !== 'ordem');
  const errG = erroGuarnicao(b, ['total_op']);
  if (errG) return res.status(400).json({ error: errG });
  const { rows: [atual] } = await pool.query(`SELECT * FROM fsbf_emr_equipa WHERE id=$1`, [req.params.id]);
  if (!atual) return res.status(404).json({ error: 'Entrada não encontrada.' });
  const sets = [], vals = [req.params.id];
  for (const k of ALLOWED) {
    if (k in b) { sets.push(`${k}=$${vals.length+1}`); vals.push(b[k] ?? null); }
  }
  sets.push(...validacaoSets(b, atual, SUBST, req.user.id, vals));
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para actualizar.' });
  sets.push(`updated_at=now()`);
  const { rows: [e] } = await pool.query(
    `UPDATE fsbf_emr_equipa SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals
  );
  if (!e) return res.status(404).json({ error: 'Entrada não encontrada.' });
  if ('chefe_nome' in b) {
    const r = await syncChefeMembro(pool, { data: e.data, emrId: e.id, chefeNome: e.chefe_nome });
    if (!r.ok) return res.status(409).json({ error: `${r.conflito} já está noutra guarnição neste dia.` });
  }
  if ('ocorrencia_num' in b && String(b.ocorrencia_num ?? '') !== String(atual.ocorrencia_num ?? ''))
    await refrescarEmpenhamento(e.data);
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

app.post('/api/fsbf/operacionais', requireAuth('visualizador'), requireModule('gestor_fsbf'), wrap(async (req, res) => {
  const { nome, n_trab, cargo, contacto, base, companhia, grupo } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome obrigatório.' });
  const { rows: [row] } = await pool.query(
    `INSERT INTO operacionais_fsbf (nome, n_trab, cargo, contacto, base, companhia, grupo, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [nome, n_trab||null, cargo||null, contacto||null,
     base||null, companhia||null, grupo||null, req.user.id]
  );
  res.status(201).json(row);
}));

app.patch('/api/fsbf/operacionais/:id', requireAuth('visualizador'), requireModule('gestor_fsbf'), wrap(async (req, res) => {
  const ALLOWED = ['nome','n_trab','cargo','contacto','base','companhia','grupo','ativo'];
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

app.delete('/api/fsbf/operacionais/:id', requireAuth('visualizador'), requireModule('gestor_fsbf'), wrap(async (req, res) => {
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

// ── Importação de escalas a partir de CSV enviado pelo utilizador ──────
// Substitui a leitura de ficheiros em disco: o CSV chega no corpo do pedido.
// Com dry_run devolve o que aconteceria, sem escrever nada.

// Excel em pt-PT grava frequentemente UTF-8 relido como Latin-1 ("SantarÃ©m").
// Detecta-se pelo padrão Ã seguido do byte alto e repara-se, porque um nome
// corrompido nunca casa com recursos.codigo e a linha perder-se-ia em silêncio.
function repararMojibake(txt) {
  if (!/Ã[-¿]/.test(txt)) return { txt, reparado: false };
  try {
    const fix = Buffer.from(txt, 'latin1').toString('utf8');
    if (fix.includes('�')) return { txt, reparado: false };
    return { txt: fix, reparado: true };
  } catch { return { txt, reparado: false }; }
}

function lerEscalaCsv(csvRaw) {
  const { parse } = require('csv-parse/sync');
  const { txt, reparado } = repararMojibake(String(csvRaw || ''));
  const rows = parse(txt, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const tipo = (cols.includes('equipa') && cols.includes('posicao')) ? 'egfr'
             : (cols.includes('nome') && cols.includes('data')) ? 'oln' : null;
  return { rows, cols, tipo, reparado };
}

app.post('/api/gestao/escalas/import', requireAuth('visualizador'), ALL_GESTORES, wrap(async (req, res) => {
  const { csv, dry_run } = req.body;
  if (!csv || !String(csv).trim()) return res.status(400).json({ error: 'CSV vazio.' });

  let parsed;
  try { parsed = lerEscalaCsv(csv); }
  catch (e) { return res.status(400).json({ error: `CSV ilegível: ${e.message}` }); }

  const { rows, cols, reparado } = parsed;
  const tipo = req.body.tipo || parsed.tipo;
  if (!rows.length) return res.status(400).json({ error: 'CSV sem linhas de dados.' });
  if (!tipo) return res.status(400).json({
    error: `Não foi possível identificar o tipo de escala. Colunas encontradas: ${cols.join(', ')}.` });

  const OBRIG = tipo === 'oln' ? ['data','nome'] : ['data','turno','equipa','posicao','nome'];
  const faltam = OBRIG.filter(k => !cols.includes(k));
  if (faltam.length) return res.status(400).json({
    error: `Faltam colunas obrigatórias (${tipo.toUpperCase()}): ${faltam.join(', ')}.` });

  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());
  const maus = rows.map((r, i) => ({ i: i + 2, r }))
    .filter(x => !isDate(x.r.data) || !String(x.r.nome || '').trim());
  if (maus.length) return res.status(400).json({
    error: `${maus.length} linha(s) sem data válida (AAAA-MM-DD) ou sem nome. Primeira: linha ${maus[0].i}.` });

  const tipoRecurso = tipo === 'oln' ? 'OLN' : 'TGFR';
  const { rows: recursos } = await pool.query(
    `SELECT id, codigo FROM recursos WHERE tipo=$1 AND ativo=true`, [tipoRecurso]);
  const nameMap = Object.fromEntries(recursos.map(r => [r.codigo.toLowerCase(), r.id]));

  const datas = rows.map(r => r.data.trim()).sort();
  const de = datas[0], ate = datas[datas.length - 1];
  const semRecurso = [...new Set(rows.filter(r => !nameMap[r.nome.trim().toLowerCase()])
                                     .map(r => r.nome.trim()))];

  const resumo = { tipo, linhas: rows.length, de, ate, reparado,
                   nomes_sem_recurso: semRecurso, dias: new Set(datas).size };

  if (tipo === 'oln') {
    const { rows: [c] } = await pool.query(
      `SELECT count(*)::int n FROM oln_escala WHERE inicio::date >= $1 AND inicio::date <= $2`, [de, ate]);
    resumo.a_remover = c.n;          // OLN limpa o intervalo antes de inserir
    resumo.a_inserir = rows.length - rows.filter(r => !nameMap[r.nome.trim().toLowerCase()]).length;
  } else {
    const { rows: [c] } = await pool.query(
      `SELECT count(*)::int n FROM egfr_escala WHERE data >= $1 AND data <= $2`, [de, ate]);
    resumo.existentes_no_intervalo = c.n;
    resumo.a_gravar = rows.length;   // EGFR faz upsert, não remove
  }

  if (dry_run) return res.json({ ok: true, dry_run: true, ...resumo });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (tipo === 'oln') {
      await client.query(
        `DELETE FROM oln_escala WHERE inicio::date >= $1 AND inicio::date <= $2`, [de, ate]);
      let ins = 0;
      for (const r of rows) {
        const rid = nameMap[r.nome.trim().toLowerCase()];
        if (!rid) continue;
        await client.query(
          `INSERT INTO oln_escala (recurso_id, inicio, fim, notas, created_by)
           VALUES ($1, $2::date::timestamptz, $2::date::timestamptz + interval '1 day', $3, $4)`,
          [rid, r.data.trim(), (r.uo || '').trim() || null, req.user.id]);
        ins++;
      }
      resumo.inseridos = ins;
      resumo.ignorados = rows.length - ins;
    } else {
      let up = 0;
      for (const r of rows) {
        await client.query(
          `INSERT INTO egfr_escala
             (data, semana_ano, semana_escala, turno, equipa, posicao, nome, recurso_id, capacidade_supressao)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (data, equipa, posicao) DO UPDATE SET
             nome=EXCLUDED.nome, recurso_id=EXCLUDED.recurso_id, turno=EXCLUDED.turno,
             semana_ano=EXCLUDED.semana_ano, semana_escala=EXCLUDED.semana_escala,
             capacidade_supressao=EXCLUDED.capacidade_supressao`,
          [r.data.trim(), parseInt(r.semana_ano) || null, parseInt(r.semana_escala) || null,
           (r.turno || '').trim(), (r.equipa || '').trim(), (r.posicao || '').trim(),
           r.nome.trim(), nameMap[r.nome.trim().toLowerCase()] || null,
           String(r.capacidade_supressao || '').trim().toLowerCase() === 'sim']);
        up++;
      }
      resumo.gravados = up;
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  res.json({ ok: true, ...resumo });
}));

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
    // Base efetiva / Companhia / Grupo — do roster oficial SBF
    `ALTER TABLE IF EXISTS operacionais_fsbf ADD COLUMN IF NOT EXISTS base      TEXT`,
    `ALTER TABLE IF EXISTS operacionais_fsbf ADD COLUMN IF NOT EXISTS companhia TEXT`,
    `ALTER TABLE IF EXISTS operacionais_fsbf ADD COLUMN IF NOT EXISTS grupo     TEXT`,
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
    // Expand role CHECK to include chefe_grupo_fsbf (drop + recreate — safe on existing DBs)
    `DO $$ BEGIN
       ALTER TABLE utilizadores DROP CONSTRAINT IF EXISTS utilizadores_role_check;
       ALTER TABLE utilizadores ADD CONSTRAINT utilizadores_role_check
         CHECK (role IN ('admin','ofligacao_ccon','ofligacao','operacional','visualizador',
                         'gestor_sf','gestor_fsbf','chefe_grupo_fsbf','gestor_icnf'));
     EXCEPTION WHEN OTHERS THEN NULL; END $$`,
    // Empenhamento diário por companhia — instantâneo. O cálculo depende de
    // ocorrencia_num, que é estado corrente e mutável: apagar um número reescreve
    // o passado. Guardar os números do dia torna a série histórica confiável.
    `CREATE TABLE IF NOT EXISTS fsbf_empenhamento_diario (
        data          DATE NOT NULL,
        companhia     TEXT NOT NULL,
        op_empenhados INT  NOT NULL DEFAULT 0,
        op_efetivo    INT  NOT NULL DEFAULT 0,
        vi_empenhadas INT  NOT NULL DEFAULT 0,
        vi_efetivo    INT  NOT NULL DEFAULT 0,
        atualizado_em TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (data, companhia)
    )`,
    // Validação de linhas da Carta de Meios: confirmação humana de que a linha
    // está correcta. Distinta de "gravada" — gravar acontece implicitamente em
    // vários fluxos, pelo que só um acto explícito marca validado.
    // O cabeçalho tem dois blocos independentes (Coordenador e Chefe de Grupo),
    // cada um com o seu botão, logo cada um com o seu estado de validação.
    ...['coord','chefe'].flatMap(g => [
      `ALTER TABLE IF EXISTS fsbf_carta ADD COLUMN IF NOT EXISTS ${g}_validado     BOOLEAN NOT NULL DEFAULT false`,
      `ALTER TABLE IF EXISTS fsbf_carta ADD COLUMN IF NOT EXISTS ${g}_validado_por UUID REFERENCES utilizadores(id) ON DELETE SET NULL`,
      `ALTER TABLE IF EXISTS fsbf_carta ADD COLUMN IF NOT EXISTS ${g}_validado_em  TIMESTAMPTZ`,
    ]),
    ...['fsbf_bsbf_equipa','fsbf_emr_equipa','fsbf_carta'].flatMap(t => [
      `ALTER TABLE IF EXISTS ${t} ADD COLUMN IF NOT EXISTS validado     BOOLEAN NOT NULL DEFAULT false`,
      `ALTER TABLE IF EXISTS ${t} ADD COLUMN IF NOT EXISTS validado_por UUID REFERENCES utilizadores(id) ON DELETE SET NULL`,
      `ALTER TABLE IF EXISTS ${t} ADD COLUMN IF NOT EXISTS validado_em  TIMESTAMPTZ`,
    ]),
    // GRUATA — força especial constituída a partir do GSBF da Carta de Meios.
    // É um instantâneo: as linhas são copiadas no momento da constituição para
    // que a ficha entregue ao Comandante da Força não mude se a carta mudar.
    `CREATE TABLE IF NOT EXISTS fsbf_gruata (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        data                DATE NOT NULL UNIQUE,
        numero              INT  NOT NULL DEFAULT 1,
        ocorrencia_num      TEXT,
        cmdt_nome           TEXT,
        cmdt_contacto       TEXT,
        cmdt_indicativo     TEXT,
        cmdt_issi           TEXT,
        previsao_saida      TEXT,
        local_destino       TEXT,
        previsao_chegada_pp TEXT,
        emr_id              UUID REFERENCES fsbf_emr_equipa(id) ON DELETE SET NULL,
        emr_mr              TEXT, emr_vaop            TEXT, emr_vaop_matricula   TEXT,
        emr_piloto          TEXT, emr_piloto_matricula TEXT,
        emr_chefe           TEXT, emr_contacto        TEXT, emr_issi TEXT,
        emr_total_op        INT,  emr_obs             TEXT,
        emr_base_anterior   TEXT,
        created_at          TIMESTAMPTZ DEFAULT now(),
        updated_at          TIMESTAMPTZ DEFAULT now(),
        created_by          UUID REFERENCES utilizadores(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS fsbf_gruata_linha (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        gruata_id    UUID NOT NULL REFERENCES fsbf_gruata(id) ON DELETE CASCADE,
        fsbf_bsbf_id UUID REFERENCES fsbf_bsbf_equipa(id) ON DELETE SET NULL,
        ordem        INT DEFAULT 0,
        veiculo      TEXT, matricula TEXT, chefe_equipa TEXT, contacto TEXT,
        issi         TEXT, guarnicao INT,  observacoes  TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS fsbf_gruata_linha_idx ON fsbf_gruata_linha (gruata_id, ordem)`,
    `ALTER TABLE IF EXISTS fsbf_gruata ADD COLUMN IF NOT EXISTS emr_base_anterior TEXT`,
    `ALTER TABLE IF EXISTS meios ADD COLUMN IF NOT EXISTS fsbf_gruata_id UUID REFERENCES fsbf_gruata(id) ON DELETE SET NULL`,
    // Nº da ocorrência em que a equipa está empenhada (texto livre por agora).
    // É este campo que define "empenhado": uma equipa sem ocorrência está de
    // prontidão, não empenhada.
    `ALTER TABLE IF EXISTS fsbf_bsbf_equipa ADD COLUMN IF NOT EXISTS ocorrencia_num TEXT`,
    `ALTER TABLE IF EXISTS fsbf_emr_equipa  ADD COLUMN IF NOT EXISTS ocorrencia_num TEXT`,
    // Membros de guarnição da Carta de Meios. Uma linha por operacional por
    // equipa; o chefe é materializado aqui (is_chefe) para que o índice único
    // (data, operacional_id) impeça a mesma pessoa em duas equipas no mesmo dia.
    `CREATE TABLE IF NOT EXISTS fsbf_equipa_membros (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        data           DATE NOT NULL,
        fsbf_bsbf_id   UUID REFERENCES fsbf_bsbf_equipa(id) ON DELETE CASCADE,
        fsbf_emr_id    UUID REFERENCES fsbf_emr_equipa(id)  ON DELETE CASCADE,
        operacional_id UUID NOT NULL REFERENCES operacionais_fsbf(id) ON DELETE RESTRICT,
        is_chefe       BOOLEAN NOT NULL DEFAULT false,
        ordem          INT DEFAULT 0,
        created_at     TIMESTAMPTZ DEFAULT now(),
        created_by     UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
        CHECK (num_nonnulls(fsbf_bsbf_id, fsbf_emr_id) = 1)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS fsbf_membros_dia_op_idx  ON fsbf_equipa_membros (data, operacional_id)`,
    `CREATE INDEX        IF NOT EXISTS fsbf_membros_bsbf_idx    ON fsbf_equipa_membros (fsbf_bsbf_id)`,
    `CREATE INDEX        IF NOT EXISTS fsbf_membros_emr_idx     ON fsbf_equipa_membros (fsbf_emr_id)`,
    // Materializa o chefe de cada equipa como membro. Idempotente: DO NOTHING
    // deixa intacto quem já esteja registado, e um chefe já noutra guarnição
    // nesse dia é ignorado em vez de violar o índice único.
    `INSERT INTO fsbf_equipa_membros (data, fsbf_bsbf_id, operacional_id, is_chefe, ordem)
     SELECT e.data, e.id, o.id, true, -1
       FROM fsbf_bsbf_equipa e
       JOIN operacionais_fsbf o ON o.nome = e.chefe_nome AND o.ativo
      WHERE e.chefe_nome IS NOT NULL
     ON CONFLICT (data, operacional_id) DO NOTHING`,
    `INSERT INTO fsbf_equipa_membros (data, fsbf_emr_id, operacional_id, is_chefe, ordem)
     SELECT e.data, e.id, o.id, true, -1
       FROM fsbf_emr_equipa e
       JOIN operacionais_fsbf o ON o.nome = e.chefe_nome AND o.ativo
      WHERE e.chefe_nome IS NOT NULL
     ON CONFLICT (data, operacional_id) DO NOTHING`,
    // Expand brigada CHECK on fsbf_bsbf_equipa to include 'Outros'
    `DO $$ BEGIN
       ALTER TABLE fsbf_bsbf_equipa DROP CONSTRAINT IF EXISTS fsbf_bsbf_equipa_brigada_check;
       ALTER TABLE fsbf_bsbf_equipa ADD CONSTRAINT fsbf_bsbf_equipa_brigada_check
         CHECK (brigada IN ('Norte','Sul','GSBF','Outros'));
     EXCEPTION WHEN OTHERS THEN NULL; END $$`,
    // Guarnições/totais de operacionais são de um só dígito (ver erroGuarnicao).
    // Rede final: a API valida primeiro e devolve 400, isto impede escritas por
    // outras vias. NULL continua permitido — significa "não preenchido".
    `DO $$ BEGIN
       ALTER TABLE fsbf_bsbf_equipa  DROP CONSTRAINT IF EXISTS fsbf_bsbf_equipa_guarnicao_check;
       ALTER TABLE fsbf_bsbf_equipa  ADD CONSTRAINT fsbf_bsbf_equipa_guarnicao_check
         CHECK (guarnicao IS NULL OR guarnicao BETWEEN 0 AND 9);
       ALTER TABLE fsbf_emr_equipa   DROP CONSTRAINT IF EXISTS fsbf_emr_equipa_total_op_check;
       ALTER TABLE fsbf_emr_equipa   ADD CONSTRAINT fsbf_emr_equipa_total_op_check
         CHECK (total_op IS NULL OR total_op BETWEEN 0 AND 9);
       ALTER TABLE fsbf_carta        DROP CONSTRAINT IF EXISTS fsbf_carta_chefe_guarnicao_check;
       ALTER TABLE fsbf_carta        ADD CONSTRAINT fsbf_carta_chefe_guarnicao_check
         CHECK (chefe_guarnicao IS NULL OR chefe_guarnicao BETWEEN 0 AND 9);
       ALTER TABLE fsbf_gruata_linha DROP CONSTRAINT IF EXISTS fsbf_gruata_linha_guarnicao_check;
       ALTER TABLE fsbf_gruata_linha ADD CONSTRAINT fsbf_gruata_linha_guarnicao_check
         CHECK (guarnicao IS NULL OR guarnicao BETWEEN 0 AND 9);
       ALTER TABLE fsbf_gruata       DROP CONSTRAINT IF EXISTS fsbf_gruata_emr_total_op_check;
       ALTER TABLE fsbf_gruata       ADD CONSTRAINT fsbf_gruata_emr_total_op_check
         CHECK (emr_total_op IS NULL OR emr_total_op BETWEEN 0 AND 9);
     EXCEPTION WHEN OTHERS THEN NULL; END $$`,
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
  // columns: [n_trab, nome, cargo, contacto]
  const SBF = 'Sapador Bombeiro Florestal';
  const EST = 'Sapador Bombeiro Florestal Estagiário';
  const CHF = 'Chefe de Grupo';
  const FSBF_OP_SEED = [
    [6261,'Abel Mota',SBF,'932039817','Cabeceiras de Basto','Norte','Litoral'],
    [6342,'Afonso Costa',SBF,'935741210','Vila Pouca de Aguiar','Norte','Interior'],
    [5760,'Albino Reboredo',SBF,'933568650','Vila Pouca de Aguiar','Norte','Interior'],
    [6613,'Alex Alves',EST,'930523699','Vila Pouca de Aguiar','Norte','Interior'],
    [6264,'Alexandre Abreu',SBF,'927759499','Cabeceiras de Basto','Norte','Litoral'],
    [6588,'Alexandre Quadrado',EST,'939020707','Portalegre','Sul','Interior'],
    [6566,'Ana Simões',EST,'913410700','Arganil','Centro','Litoral'],
    [6590,'André António',EST,'935461961','Portalegre','Sul','Interior'],
    [6589,'André Basso',EST,'936239646','Portalegre','Sul','Interior'],
    [6139,'André Mendes',SBF,'913864202','Santarém','Sul','Litoral'],
    [6096,'André Pinto',CHF,'910847102','Santarém','Sul','Litoral'],
    [493,'Antero Sousa',SBF,'933653989','Macedo de Cavaleiros','Norte','Interior'],
    [6614,'António Bairrada',EST,'960238387','Proença-a-Nova','Centro','Litoral'],
    [6123,'Bernardo Clara',SBF,'961942589','Guarda','Centro','Interior'],
    [5621,'Bruno Branco',SBF,'964915281','Guarda','Centro','Interior'],
    [6558,'Bruno Costa',EST,'967357852','Guarda','Centro','Interior'],
    [6275,'Bruno Ferreira',SBF,'961242964','Santarém','Sul','Litoral'],
    [6569,'Bruno Martins',EST,'938601451','Macedo de Cavaleiros','Norte','Interior'],
    [6127,'Bruno Oliveira',CHF,'910846963','Cabeceiras de Basto','Norte','Litoral'],
    [6108,'Bruno Pais',SBF,'919505991','Santarém','Sul','Litoral'],
    [5878,'Bruno Pina',SBF,'964139050','Guarda','Centro','Interior'],
    [6344,'Bruno Silva',SBF,'929052308','Macedo de Cavaleiros','Norte','Interior'],
    [6568,'Bruno Simões',EST,'910894990','Macedo de Cavaleiros','Norte','Interior'],
    [5611,'Carlos Gomes',CHF,'910920730','Macedo de Cavaleiros','Norte','Interior'],
    [6105,'Carlos Nunes',SBF,'926180036','Guarda','Centro','Interior'],
    [5613,'Cristiano Macieira',SBF,'936287134','Macedo de Cavaleiros','Norte','Interior'],
    [6570,'Daniel Teixeira',EST,'962713058','Cabeceiras de Basto','Norte','Litoral'],
    [6346,'Daniel Vaz',SBF,'932276251','Macedo de Cavaleiros','Norte','Interior'],
    [6247,'David Bento',SBF,'928042392','Santarém','Sul','Litoral'],
    [6133,'David Cardoso',CHF,'910846921','Proença-a-Nova','Centro','Litoral'],
    [6253,'David Lourenço',SBF,'927660176','Guarda','Centro','Interior'],
    [6605,'Dinis Panarra',EST,'917898387','Portalegre','Sul','Interior'],
    [6611,'Diogo Alves',EST,'915679620','Cabeceiras de Basto','Norte','Litoral'],
    [6560,'Diogo Fernandes',EST,'933676178','Macedo de Cavaleiros','Norte','Interior'],
    [6348,'Diogo Marques',SBF,'924404580','Arganil','Centro','Litoral'],
    [6349,'Diogo Mesquita',SBF,'939792366','Macedo de Cavaleiros','Norte','Interior'],
    [6379,'Diogo Policarpo',SBF,'962352878','Macedo de Cavaleiros','Norte','Interior'],
    [6373,'Duarte Batista',SBF,'968387432','Portalegre','Sul','Interior'],
    [6128,'Duarte Pinto',SBF,'935951641','Cabeceiras de Basto','Norte','Litoral'],
    [6571,'Eduardo Camejo',EST,'965370442','Portalegre','Sul','Interior'],
    [6351,'Eduardo Pité',SBF,'913353739','Olhão','Sul','Litoral'],
    [6255,'Eduardo Serra',SBF,'933896112','Portalegre','Sul','Interior'],
    [6124,'Fernando Horto',SBF,'966251416','Cabeceiras de Basto','Norte','Litoral'],
    [6120,'Filipe Bambulo',SBF,'961091803','Portalegre','Sul','Interior'],
    [5810,'Filipe Monteiro',SBF,'918300544','Marinha Grande','Centro','Litoral'],
    [6355,'Francisco Baião',SBF,'960014741','Santarém','Sul','Litoral'],
    [6352,'Francisco Nascimento',SBF,'917632899','Santarém','Sul','Litoral'],
    [6375,'Francisco Pires',SBF,'964177750','Portalegre','Sul','Interior'],
    [6592,'Francisco Ribeiro',EST,'966339655','Portalegre','Sul','Interior'],
    [6574,'Gonçalo Abreu',EST,'929475275','Portalegre','Sul','Interior'],
    [6257,'Gonçalo Ambrósio',SBF,'966538284','Santarém','Sul','Litoral'],
    [6573,'Gonçalo Lameiras',EST,'934468337','Vila Pouca de Aguiar','Norte','Interior'],
    [6607,'Gonçalo Macedo',EST,'939579916','Vila Pouca de Aguiar','Norte','Interior'],
    [6262,'Gonçalo Menino',SBF,'936721310','Cabeceiras de Basto','Norte','Litoral'],
    [6122,'Guilherme Ruano',SBF,'962925801','Guarda','Centro','Interior'],
    [6132,'Guilherme Tavares',SBF,'922089130','Guarda','Centro','Interior'],
    [6372,'Guilherme Triguinho',SBF,'936490889','Marinha Grande','Centro','Litoral'],
    [6138,'Hélder Barroso',SBF,'913006548','Cabeceiras de Basto','Norte','Litoral'],
    [6358,'Hélder Magalhães',SBF,'964086320','Cabeceiras de Basto','Norte','Litoral'],
    [5615,'Hélder Pinelo',SBF,'912159327','Macedo de Cavaleiros','Norte','Interior'],
    [6359,'Hérmino Borges',SBF,'933608711','Macedo de Cavaleiros','Norte','Interior'],
    [6575,'Hilário Furtado',EST,'939220822','Vila Pouca de Aguiar','Norte','Interior'],
    [6576,'Hugo Vieira',EST,'967170069','Cabeceiras de Basto','Norte','Litoral'],
    [6361,'João Alves',SBF,'920265622','Macedo de Cavaleiros','Norte','Interior'],
    [6100,'João Baptista',SBF,'962560434','Portalegre','Sul','Interior'],
    [6578,'João Cabaço',EST,'968868153','Portalegre','Sul','Interior'],
    [5801,'João Direito',SBF,'926039835','Guarda','Centro','Interior'],
    [6115,'João Leite',SBF,'961754414','Cabeceiras de Basto','Norte','Litoral'],
    [6615,'João M. Ferreira',EST,'925631187','Macedo de Cavaleiros','Norte','Interior'],
    [6384,'João Magalhães',SBF,'933741450','Cabeceiras de Basto','Norte','Litoral'],
    [6363,'João Monteiro',SBF,'911747479','Marinha Grande','Centro','Litoral'],
    [6610,'João Pimenta',EST,'924027805','Cabeceiras de Basto','Norte','Litoral'],
    [6258,'João Póvoas',SBF,'926796212','Portalegre','Sul','Interior'],
    [6140,'João Reis',SBF,'960151187','Vila Pouca de Aguiar','Norte','Interior'],
    [6617,'João Silva',EST,'969082676','Cabeceiras de Basto','Norte','Litoral'],
    [6593,'João T. Ferreira',EST,'934799993','Macedo de Cavaleiros','Norte','Interior'],
    [6577,'João P. Vaz',EST,'934003216','Macedo de Cavaleiros','Norte','Interior'],
    [6370,'João R. Vaz',SBF,'933118923','Macedo de Cavaleiros','Norte','Interior'],
    [6279,'Jorge Pereira',SBF,'935027414','Olhão','Sul','Litoral'],
    [6561,'Jorge Simões',EST,'913973260','Arganil','Centro','Litoral'],
    [6273,'José C. Alves',SBF,'937024052','Proença-a-Nova','Centro','Litoral'],
    [6366,'José P. Alves',SBF,'910635579','Macedo de Cavaleiros','Norte','Interior'],
    [6619,'José Reis',EST,'936415258','Cabeceiras de Basto','Norte','Litoral'],
    [6125,'José Santos',SBF,'964481795','Guarda','Centro','Interior'],
    [6620,'José Senra',EST,'930532106','Cabeceiras de Basto','Norte','Litoral'],
    [6579,'José Silva',EST,'934888082','Macedo de Cavaleiros','Norte','Interior'],
    [6099,'Júlio Abreu',SBF,'928140260','Cabeceiras de Basto','Norte','Litoral'],
    [6102,'Leandro Fernandes',SBF,'961870209','Guarda','Centro','Interior'],
    [6103,'Leandro Ferreira',SBF,'914366270','Santarém','Sul','Litoral'],
    [6596,'Leandro Moura',EST,'968472166','Vila Pouca de Aguiar','Norte','Interior'],
    [6114,'Leonardo Fundo',SBF,'932079377','Vila Pouca de Aguiar','Norte','Interior'],
    [6616,'Leonardo Pires',EST,'934549058','Cabeceiras de Basto','Norte','Litoral'],
    [6580,'Lúcia Cardoso',EST,'933430482','Vila Pouca de Aguiar','Norte','Interior'],
    [6562,'Luís Carrasco',EST,'931934529','Macedo de Cavaleiros','Norte','Interior'],
    [6276,'Luis Cordeiro',SBF,'936405997','Portalegre','Sul','Interior'],
    [6121,'Luís Dias',SBF,'910395594','Vila Pouca de Aguiar','Norte','Interior'],
    [6582,'Luís Escobar',EST,'938634204','Macedo de Cavaleiros','Norte','Interior'],
    [6131,'Luís Francisco',SBF,'969385138','Proença-a-Nova','Centro','Litoral'],
    [6134,'Luís Lameira',SBF,'968499156','Portalegre','Sul','Interior'],
    [6371,'Luís Lameiras',SBF,'936030277','Vila Pouca de Aguiar','Norte','Interior'],
    [6581,'Luís Moura',EST,'924368398','Cabeceiras de Basto','Norte','Litoral'],
    [6116,'Luís Pereira',SBF,'939643607','Macedo de Cavaleiros','Norte','Interior'],
    [6378,'Marcelo Diogo',SBF,'910250346','Olhão','Sul','Litoral'],
    [6365,'Marcelo Ferradosa',SBF,'938642500','Macedo de Cavaleiros','Norte','Interior'],
    [6263,'Marcelo Ferraz',SBF,'961587917','Macedo de Cavaleiros','Norte','Interior'],
    [6583,'Marcelo Monteiro',EST,'930496360','Vila Pouca de Aguiar','Norte','Interior'],
    [6364,'Marco Silva',SBF,'926279405','Guarda','Centro','Interior'],
    [5812,'Marco Tacanho',SBF,'963779719','Guarda','Centro','Interior'],
    [6256,'Miguel Alves',SBF,'961416325','Portalegre','Sul','Interior'],
    [6126,'Miguel Rosa',SBF,'965161744','Santarém','Sul','Litoral'],
    [6362,'Miguel Salgueiro',SBF,'912193037','Portalegre','Sul','Interior'],
    [6585,'Mónica Pinto',EST,'919785866','Cabeceiras de Basto','Norte','Litoral'],
    [6360,'Natacha Querales',SBF,'910779836','Olhão','Sul','Litoral'],
    [6587,'Natálio Serafim',EST,'968107995','Olhão','Sul','Litoral'],
    [6248,'Nuno Gandum',SBF,'967684314','Portalegre','Sul','Interior'],
    [6277,'Nuno Garcia',SBF,'967849961','Portalegre','Sul','Interior'],
    [6357,'Paulo Gonçalves',SBF,'936276271','Macedo de Cavaleiros','Norte','Interior'],
    [6280,'Paulo Inácio',SBF,'936034109','Viseu','Centro','Interior'],
    [6130,'Paulo Silva',SBF,'926388502','Cabeceiras de Basto','Norte','Litoral'],
    [5969,'Pedro Beguilhas',CHF,'911109847','Portalegre','Sul','Interior'],
    [6599,'Pedro Belém',EST,'933940490','Portalegre','Sul','Interior'],
    [6595,'Pedro Caetano',EST,'963218902','Arganil','Centro','Litoral'],
    [6113,'Pedro Capela',SBF,'934003079','Vila Pouca de Aguiar','Norte','Interior'],
    [6600,'Pedro Carvalho',EST,'939341331','Vila Pouca de Aguiar','Norte','Interior'],
    [6597,'Pedro Duarte',EST,'919149748','Marinha Grande','Centro','Litoral'],
    [6274,'Pedro Ferreira',SBF,'967447337','Cabeceiras de Basto','Norte','Litoral'],
    [6062,'Pedro Figueiredo',SBF,'966102030','Guarda','Centro','Interior'],
    [6618,'Pedro Marques',EST,'968642695','Santarém','Sul','Litoral'],
    [6563,'Pedro Mendes',EST,'915628843','Santarém','Sul','Litoral'],
    [6376,'Pedro Oliveira',SBF,'931700479','Cabeceiras de Basto','Norte','Litoral'],
    [6594,'Pedro G. Pereira',EST,'960467634','Guarda','Centro','Interior'],
    [6602,'Pedro R. Pereira',EST,'937592480','Macedo de Cavaleiros','Norte','Interior'],
    [6129,'Rafael Justino',SBF,'967906241','Guarda','Centro','Interior'],
    [6254,'Rafael Pinto',SBF,'960252127','Guarda','Centro','Interior'],
    [6374,'Rafael Santos',SBF,'913769786','Marinha Grande','Centro','Litoral'],
    [6603,'Rafael Silva',EST,'910819114','Portalegre','Sul','Interior'],
    [5817,'Ricardo Firmino',SBF,'967354936','Guarda','Centro','Interior'],
    [6367,'Ricardo Mendes',SBF,'919601122','Santarém','Sul','Litoral'],
    [6354,'Ricardo Paçó',SBF,'933967821','Macedo de Cavaleiros','Norte','Interior'],
    [6282,'Ricardo Paulino',SBF,'913355148','Olhão','Sul','Litoral'],
    [6135,'Ricardo Pinheiro',SBF,'925767998','Proença-a-Nova','Centro','Litoral'],
    [6260,'Ricardo Pinto',SBF,'914082335','Arganil','Centro','Litoral'],
    [5722,'Roberto Santos',SBF,'966244152','Marinha Grande','Centro','Litoral'],
    [6606,'Rodrigo Castro',EST,'910181737','Macedo de Cavaleiros','Norte','Interior'],
    [6609,'Rodrigo Dias',EST,'911873245','Portalegre','Sul','Interior'],
    [6601,'Rodrigo Ferreira',EST,'910745631','Marinha Grande','Centro','Litoral'],
    [6368,'Rodrigo Pereira',SBF,'966802718','Portalegre','Sul','Interior'],
    [5709,'Rodrigo Rodrigues',SBF,'934790617','Olhão','Sul','Litoral'],
    [6377,'Rúben Almeida',SBF,'912429434','Marinha Grande','Centro','Litoral'],
    [6281,'Rui Espanhol',SBF,'963981904','Portalegre','Sul','Interior'],
    [6353,'Rui Venâncio',SBF,'926014826','Guarda','Centro','Interior'],
    [6252,'Samuel Nicolau',SBF,'963780999','Portalegre','Sul','Interior'],
    [6564,'Sandro Amaro',EST,'938712940','Macedo de Cavaleiros','Norte','Interior'],
    [6350,'Sérgio Soares',SBF,'938832158','Portalegre','Sul','Interior'],
    [6109,'Telmo Dias',CHF,'910846946','Guarda','Centro','Interior'],
    [6565,'Tiago Alves',EST,'910095058','Macedo de Cavaleiros','Norte','Interior'],
    [6118,'Tiago E. Costa',SBF,'924132386','Cabeceiras de Basto','Norte','Litoral'],
    [6612,'Tiago T. Costa',EST,'927384332','Macedo de Cavaleiros','Norte','Interior'],
    [6347,'Tiago Jorge',SBF,'936265977','Olhão','Sul','Litoral'],
    [6250,'Tiago Machado',SBF,'969333486','Cabeceiras de Basto','Norte','Litoral'],
    [6608,'Tiago Martins',EST,'968925095','Viseu','Centro','Interior'],
    [6604,'Tiago Tavares',EST,'966079987','Guarda','Centro','Interior'],
    [6064,'Tomás Martins',SBF,'963327771','Olhão','Sul','Litoral'],
    [5987,'Vasco Pereira',SBF,'965485592','Guarda','Centro','Interior'],
    [6278,'Vitor Sabino',SBF,'961250890','Olhão','Sul','Litoral'],
    // Novos do roster oficial de 31/07/2026 — cargo/contacto por preencher
    [6356,'Gonçalo Martins',null,null,'Olhão','Sul','Litoral'],
    [9001,'Pedro Corrula',null,null,'Portalegre','Sul','Interior'],
    [9002,'Nuno Martinho',null,null,'Portalegre','Sul','Interior'],
    [9003,'Tiago Baptista',null,null,'Portalegre','Sul','Interior'],
    [9004,'António Figueiredo',null,null,'Santarém','Sul','Litoral'],
    [9005,'Aurélio Varatojo',null,null,'Santarém','Sul','Litoral'],
    [9006,'Pedro Arcanjo',null,null,'Santarém','Sul','Litoral'],
    [9007,'Manuel Dinis',null,null,'Cabeceiras de Basto','Norte','Litoral'],
    [9008,'OMR Norte',null,null,'Cabeceiras de Basto','Norte','Litoral'],
    [9009,'Nuno Coelho',null,null,'Santarém','Sul','Litoral'],
  ];
  // COALESCE: uma coluna a null no seed preserva o valor já existente na BD,
  // para que dados introduzidos pela aplicação não sejam apagados a cada deploy.
  await pool.query(
    `INSERT INTO operacionais_fsbf (n_trab, nome, cargo, contacto, base, companhia, grupo)
     SELECT unnest($1::int[]), unnest($2::text[]), unnest($3::text[]), unnest($4::text[]),
            unnest($5::text[]), unnest($6::text[]), unnest($7::text[])
     ON CONFLICT (nome) DO UPDATE SET
       n_trab    = COALESCE(EXCLUDED.n_trab,    operacionais_fsbf.n_trab),
       cargo     = COALESCE(EXCLUDED.cargo,     operacionais_fsbf.cargo),
       contacto  = COALESCE(EXCLUDED.contacto,  operacionais_fsbf.contacto),
       base      = COALESCE(EXCLUDED.base,      operacionais_fsbf.base),
       companhia = COALESCE(EXCLUDED.companhia, operacionais_fsbf.companhia),
       grupo     = COALESCE(EXCLUDED.grupo,     operacionais_fsbf.grupo)`,
    [FSBF_OP_SEED.map(r=>r[0]), FSBF_OP_SEED.map(r=>r[1]),
     FSBF_OP_SEED.map(r=>r[2]), FSBF_OP_SEED.map(r=>r[3]),
     FSBF_OP_SEED.map(r=>r[4]), FSBF_OP_SEED.map(r=>r[5]), FSBF_OP_SEED.map(r=>r[6])]
  );
  console.log(`Upsert de ${FSBF_OP_SEED.length} operacionais FSBF.`);
}

// ─── Start ────────────────────────────────────────────────────────
if (require.main === module) {
  runMigrations()
    .then(() => app.listen(PORT, () => console.log(`Gestão Meios a correr na porta ${PORT}`)))
    .catch(err => { console.error('Erro na migração:', err.message); process.exit(1); });
}

module.exports = { app, pool, runMigrations };
