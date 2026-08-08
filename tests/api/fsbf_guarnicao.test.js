'use strict';
// Guarnições e totais de operacionais são de um só dígito. O cliente limita o
// campo, mas foi por esta via que entrou um guarnicao=50 que rendeu 49
// dropdowns de membro na Carta de Meios e inflacionou o Total de Operacionais.
const request = require('supertest');
const { app, pool } = require('../../server');
const { setupSchema, truncateAll, createTestUsers, makeToken, authHeader, testPool } = require('../helpers/testdb');

const DIA = '2031-03-04';
let gestorToken;

beforeAll(async () => {
  await setupSchema();
  await truncateAll();
  const users = await createTestUsers();
  gestorToken = makeToken(users.admin);
});

afterAll(async () => {
  await testPool.query('DELETE FROM fsbf_carta WHERE data=$1', [DIA]);
  await pool.end();
});

beforeEach(async () => {
  await testPool.query('DELETE FROM fsbf_bsbf_equipa WHERE data=$1', [DIA]);
  await testPool.query('DELETE FROM fsbf_emr_equipa  WHERE data=$1', [DIA]);
  await testPool.query('DELETE FROM fsbf_carta       WHERE data=$1', [DIA]);
});

const criarBsbf = (guarnicao) => request(app)
  .post('/api/fsbf/bsbf')
  .set(authHeader(gestorToken))
  .send({ data: DIA, brigada: 'Norte', guarnicao });

describe('limite de 9 na guarnição (POST /api/fsbf/bsbf)', () => {
  test.each([5, 9])('guarnicao=%i é aceite e guardada → 200', async (v) => {
    const res = await criarBsbf(v);
    expect(res.status).toBe(200);
    expect(res.body.guarnicao).toBe(v);
  });

  // Comportamento actual, não desejado: o handler faz `b.guarnicao||null`, logo
  // 0 cai em NULL. Fica registado aqui porque hoje "sem guarnição" e "não
  // preenchido" são indistinguíveis na base. Corrigir é trocar || por ?? — mas
  // é uma mudança de semântica dos dados, decidida à parte do limite de 9.
  test('guarnicao=0 passa a validação mas é guardada como NULL (conhecido)', async () => {
    const res = await criarBsbf(0);
    expect(res.status).toBe(200);
    expect(res.body.guarnicao).toBeNull();
  });

  test.each([10, 50, -1, 4.5, 'abc'])('guarnicao=%p é recusada → 400', async (v) => {
    const res = await criarBsbf(v);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/entre 0 e 9/);
  });

  test('guarnicao ausente ou nula é aceite — significa "não preenchido"', async () => {
    expect((await criarBsbf(null)).status).toBe(200);
    const res = await request(app).post('/api/fsbf/bsbf')
      .set(authHeader(gestorToken)).send({ data: DIA, brigada: 'Sul' });
    expect(res.status).toBe(200);
  });
});

describe('limite de 9 na guarnição (PATCH /api/fsbf/bsbf/:id)', () => {
  test('50 é recusado com 400 e o valor guardado não muda', async () => {
    const { body: linha } = await criarBsbf(5);
    const res = await request(app)
      .patch(`/api/fsbf/bsbf/${linha.id}`)
      .set(authHeader(gestorToken))
      .send({ guarnicao: 50 });
    expect(res.status).toBe(400);
    const { rows } = await testPool.query(
      'SELECT guarnicao FROM fsbf_bsbf_equipa WHERE id=$1', [linha.id]);
    expect(rows[0].guarnicao).toBe(5);
  });
});

describe('limite de 9 no total_op do EMR e no chefe_guarnicao da carta', () => {
  test('POST /api/fsbf/emr recusa total_op=12 → 400', async () => {
    const res = await request(app).post('/api/fsbf/emr')
      .set(authHeader(gestorToken)).send({ data: DIA, total_op: 12 });
    expect(res.status).toBe(400);
  });

  test('PUT /api/fsbf/carta recusa chefe_guarnicao=10 → 400', async () => {
    const res = await request(app).put('/api/fsbf/carta')
      .set(authHeader(gestorToken)).send({ data: DIA, chefe_guarnicao: 10 });
    expect(res.status).toBe(400);
  });

  test('PUT /api/fsbf/carta aceita chefe_guarnicao=9 → 200', async () => {
    const res = await request(app).put('/api/fsbf/carta')
      .set(authHeader(gestorToken)).send({ data: DIA, chefe_guarnicao: 9 });
    expect(res.status).toBe(200);
    expect(res.body.chefe_guarnicao).toBe(9);
  });
});

describe('a base de dados é a última rede', () => {
  test('um UPDATE directo com 10 viola o CHECK (23514)', async () => {
    const { body: linha } = await criarBsbf(4);
    await expect(
      testPool.query('UPDATE fsbf_bsbf_equipa SET guarnicao=10 WHERE id=$1', [linha.id])
    ).rejects.toMatchObject({ code: '23514' });
  });
});
