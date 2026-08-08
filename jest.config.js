'use strict';
module.exports = {
  testEnvironment: 'node',
  // A BD de teste é remota: hooks e testes precisam de mais do que os 15s
  // anteriores — o setupSchema de arranque não cabia neles.
  testTimeout: 30000,
  // Restringe ao jest: tests/e2e são especificações Playwright e o testMatch
  // por omissão apanhava-as, fazendo-as falhar fora do seu runner.
  testMatch: ['**/tests/(api|unit)/**/*.test.js'],
  // Todos os ficheiros partilham a mesma base de dados: em paralelo, os
  // TRUNCATE de um suite apagam as fixtures do outro e o createTestUsers
  // colide no email único. Serializar é obrigatório, não uma preferência.
  maxWorkers: 1,
};
