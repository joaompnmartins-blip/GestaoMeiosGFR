# Esquema Técnico — Gestão de Meios GFR

## Visão geral da arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENTE (Browser)                                            │
│  Gestao_Meios_v17.html — aplicação de página única (SPA)      │
│   • JavaScript puro (sem framework, sem build)                │
│   • CSS simples (sistema de design próprio, tema escuro)      │
│   • IndexedDB — cache offline + fila de escrita               │
│   • fetch() → API REST (JWT no cabeçalho Authorization)       │
└───────────────────────────┬───────────────────────────────────┘
                             │ HTTPS / JSON
┌───────────────────────────▼───────────────────────────────────┐
│  BACKEND — server.js (Node.js + Express)                       │
│   • API REST em /api/*                                          │
│   • Autenticação JWT (jsonwebtoken) + bcrypt para passwords      │
│   • Controlo de acessos por perfil (middleware ROLE_ORDER)      │
│   • Serve o frontend estático (express.static + "/")           │
│   • Faz proxy ao feed externo de incêndios (fogos.pt)          │
└───────────────────────────┬───────────────────────────────────┘
                             │ pg (node-postgres)
┌───────────────────────────▼───────────────────────────────────┐
│  BASE DE DADOS — PostgreSQL (gerida na Railway)                 │
│   • schema.sql — fonte de verdade, migrações idempotentes      │
│   • Tabelas: utilizadores, ocorrencias, meios, meios_operativos,│
│     meios_eventos, ocorrencias_eventos, equipas,                │
│     operacionais_predefinidos, meio_delete_requests, sectores   │
└─────────────────────────────────────────────────────────────────┘

Integração externa: api.fogos.pt (incêndios ativos, apenas leitura)
Alojamento/CI: Railway (build Nixpacks, deploy automático a partir de `main`)
```

## Frontend
- **Stack**: ficheiro HTML único (`Gestao_Meios_v17.html`), JavaScript puro e CSS escrito à mão — sem React/Vue nem pipeline de build.
- **Estrutura**: navegação tipo SPA entre páginas (`navTo()`), formulários em modais (`openModal`/`closeModal`), padrão reutilizável de modal de "ação rápida".
- **Camada de dados**: `apiFetch()` envolve todas as chamadas REST, anexa o JWT e trata erros 401 (força novo login).
- **Suporte offline**: IndexedDB (`idb_cache`, `idb_queue`) guarda em cache o conjunto de dados completo e enfileira escritas (`supaWriteOrQueue`) para repetição quando a ligação volta — herança do desenho original baseado em Supabase, agora adaptado à API própria.
- **Vistas principais**: Ocorrências (incidentes ativos, agrupáveis/filtráveis por sub-região), Arquivo (ocorrências fechadas), Meios (catálogo de meios predefinidos), Pedidos (aprovação de pedidos de remoção, admin), Utilizadores (gestão de contas, admin).
- **Documentação associada**: `manual_utilizador.html` — manual do utilizador integrado na aplicação.

## Backend
- **Stack**: Node.js ≥18, Express 4.
- **Autenticação**: `POST /api/login` emite um JWT válido por 12h (jsonwebtoken) com `id`, `role`, `nome`, `subregiao`; passwords com hash bcrypt.
- **Autorização**: o middleware `requireAuth(minRole)` aplica uma hierarquia de perfis — `visualizador < operacional < ofligacao < admin` — com restrição por sub-região para oficiais de ligação.
- **API exposta** (`/api/*`): ocorrências, meios (+ operativos, eventos, pedidos de remoção), equipas (catálogo), operacionais predefinidos, eventos de ocorrência / "Fita do Tempo", utilizadores, e proxy de leitura para `api.fogos.pt`.
- **Tratamento de erros**: o auxiliar `wrap()` normaliza try/catch → respostas JSON de erro.

## Base de dados
- **PostgreSQL**, esquema definido em `schema.sql` e aplicado de forma idempotente via `runMigrations()` no arranque do servidor (`CREATE TABLE/INDEX IF NOT EXISTS`, blocos `DO $$...$$` para alterações de constraints).
- **Tabelas principais**: `utilizadores` (perfis/sub-região), `ocorrencias` (incidentes ativos/fechados), `meios` (recursos mobilizados, ligação MR/PM via `transporte_id`), `meios_operativos`, `meios_eventos`, `ocorrencias_eventos` (registo da Fita do Tempo), `equipas` (catálogo de meios predefinidos), `operacionais_predefinidos`, `meio_delete_requests`, `sectores`.
- **Restrições**: índices únicos parciais garantem regras de negócio (ex.: apenas uma mobilização ativa por equipa do catálogo, apenas um pedido de remoção pendente por meio).

## Testes e CI
- **Jest** para testes de API (`tests/api/*`, com supertest contra uma base de dados PostgreSQL de teste) e testes unitários (`tests/unit/*`).
- **Playwright** para testes end-to-end no browser (`tests/e2e/*`).
- `tests/helpers/testdb.js` cria o esquema e semeia utilizadores de teste para cada perfil.

## Implantação / Infraestrutura
- **Alojamento**: Railway (builder Nixpacks, comando de arranque `node server.js`, health check em `/`, reinício automático em caso de falha).
- **Ambiente**: `DATABASE_URL` (Postgres), `JWT_SECRET`, `PORT`.
- **Origem**: migração de um protótipo assente em Supabase para esta stack própria Express + Postgres (ver `implement_local_server.md` / `migration_v2_equipas.sql` para o histórico da migração).
