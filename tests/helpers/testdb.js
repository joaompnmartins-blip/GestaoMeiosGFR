'use strict';
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/gestao_meios_test';
const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret-CHANGE-IN-PRODUCTION';

const testPool = new Pool({ connectionString: TEST_DB_URL,
  ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(TEST_DB_URL) ? false : { rejectUnauthorized: false } });

// Guarda: testdb.js faz TRUNCATE. Uma URL de produção aqui destruiria dados.
if (/railway/i.test(TEST_DB_URL) && !/_test/i.test(TEST_DB_URL)) {
  throw new Error(
    'TEST_DATABASE_URL parece ser de produção (contém "railway" sem "_test"). ' +
    'Os testes fazem TRUNCATE — aponte para uma base de dados de teste.');
}

// schema.sql sozinho não basta: depende de colunas que preSchemaAlters cria
// antes dele (por exemplo meios.fsbf_bsbf_id). Corre-se a mesma migração da
// aplicação, para que a BD de teste tenha exactamente o schema de produção.
// Numa BD vazia há uma dependência circular: preSchemaAlters precisa de tabelas
// que schema.sql cria (ex. ocorrencias, para a FK de postos_comando), e schema.sql
// tem índices sobre colunas que preSchemaAlters acrescenta (ex. meios.fsbf_bsbf_id).
// Como schema.sql corre numa transacção implícita, falha por inteiro em qualquer
// das ordens. Resolve-se com uma 1.ª passagem sem índices.
// NOTA: isto é um defeito da aplicação — runMigrations() não arranca uma BD nova.
async function setupSchema() {
  // Cada suite chama isto no beforeAll. Migrar de novo numa BD remota levaria
  // mais do que o timeout do hook, por isso é uma verificação e não uma migração:
  // se o schema já existe, sai de imediato. Force com FORCE_SCHEMA=1.
  if (!process.env.FORCE_SCHEMA) {
    const { rows } = await testPool.query(
      "select count(*)::int n from information_schema.tables where table_schema='public' and table_name='utilizadores'");
    if (rows[0].n === 1) return;
  }
  const raw = fs.readFileSync(path.join(__dirname, '../../schema.sql'), 'utf8');
  const semIndices = raw.replace(/^CREATE (?:UNIQUE )?INDEX[\s\S]*?;\s*$/gm, '');
  await testPool.query(semIndices);            // 1.ª passagem: tabelas

  process.env.DATABASE_URL = TEST_DB_URL;      // antes de carregar o server
  const { runMigrations } = require('../../server');
  await runMigrations();                       // colunas + schema completo + seed
}

async function truncateAll() {
  // A lista é resolvida contra as tabelas que existem: o schema evoluiu desde
  // que estes testes foram escritos (equipas passou a recursos) e uma tabela
  // inexistente fazia falhar o TRUNCATE inteiro.
  // CASCADE trata meios, meios_eventos, meios_operativos, ocorrencias_eventos.
  const desejadas = ['utilizadores','ocorrencias','recursos','operacionais_predefinidos'];
  const { rows } = await testPool.query(
    `select table_name from information_schema.tables
      where table_schema='public' and table_name = ANY($1)`, [desejadas]);
  const existentes = rows.map(r => r.table_name);
  if (existentes.length) {
    await testPool.query(`TRUNCATE ${existentes.join(', ')} CASCADE`);
  }
}

// Cost 1 for speed in tests — never use in production
let _hash;
async function testHash() {
  if (!_hash) _hash = await bcrypt.hash('test123', 1);
  return _hash;
}

async function createTestUsers() {
  const hash = await testHash();
  const [a, g, gs, o, v] = await Promise.all([
    testPool.query(
      `INSERT INTO utilizadores (email, nome, password_hash, role, ativo)
       VALUES ($1,$2,$3,'admin',true) RETURNING *`,
      ['admin@test.pt', 'Admin Teste', hash]
    ),
    testPool.query(
      `INSERT INTO utilizadores (email, nome, password_hash, role, ativo)
       VALUES ($1,$2,$3,'ofligacao',true) RETURNING *`,
      ['ofligacao@test.pt', 'OfLigacao Teste', hash]
    ),
    testPool.query(
      `INSERT INTO utilizadores (email, nome, password_hash, role, subregiao, ativo)
       VALUES ($1,$2,$3,'ofligacao',$4,true) RETURNING *`,
      ['ofligacao.sr@test.pt', 'OfLigacao Sub-Região', hash, 'Sub-Região Norte']
    ),
    testPool.query(
      `INSERT INTO utilizadores (email, nome, password_hash, role, ativo)
       VALUES ($1,$2,$3,'operacional',true) RETURNING *`,
      ['op@test.pt', 'Operacional Teste', hash]
    ),
    testPool.query(
      `INSERT INTO utilizadores (email, nome, password_hash, role, ativo)
       VALUES ($1,$2,$3,'visualizador',true) RETURNING *`,
      ['viz@test.pt', 'Visualizador Teste', hash]
    ),
  ]);

  return {
    admin:      a.rows[0],
    ofligacao:     g.rows[0],
    ofligacaoSR:   gs.rows[0],
    operacional: o.rows[0],
    visualizador: v.rows[0],
  };
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, nome: user.nome, subregiao: user.subregiao || null },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function makeTokenFor(role, extraFields = {}) {
  return jwt.sign(
    { id: 'test-id', role, nome: 'Teste', subregiao: null, ...extraFields },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = {
  testPool,
  setupSchema,
  truncateAll,
  createTestUsers,
  makeToken,
  makeTokenFor,
  authHeader,
  TEST_DB_URL,
  JWT_SECRET,
};
