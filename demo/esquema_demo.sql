-- ══════════════════════════════════════════════════════════════════
--  DEMONSTRAÇÃO — EMPREITADAS FSBF  (só no beta3)
-- ══════════════════════════════════════════════════════════════════
--
-- Dois esquemas, com papéis diferentes:
--
--   ext   faz de conta que é uma fonte externa. A aplicação só LÊ daqui,
--         como fará um dia das tabelas verdadeiras (propostas do SISF,
--         registos da frota e das máquinas). Enche-se com o gerador de
--         dados sintéticos — nada aqui é real.
--
--   demo  é onde a aplicação ESCREVE: empreitadas, meios afectos, horas
--         dos operacionais. Mais os catálogos de que a recomendação
--         precisa (operações, tipos de meio, rendimentos).
--
-- Tudo é idempotente: corre a cada arranque, depois do schema.sql.
-- Nenhuma tabela do esquema public é alterada.

CREATE SCHEMA IF NOT EXISTS ext;
CREATE SCHEMA IF NOT EXISTS demo;

-- ── Catálogos ─────────────────────────────────────────────────────

-- Os códigos INTERV do Guia Técnico de Cartografia do Programa de
-- Sapadores Florestais (ICNF/SISF, pp. 11–13). O modo de execução não
-- vem do guia: é a classificação que decide que meios se recomendam.
CREATE TABLE IF NOT EXISTS demo.operacoes (
    codigo            TEXT PRIMARY KEY,                 -- INTERV
    designacao        TEXT NOT NULL,
    tipo_interv       SMALLINT,                         -- TIPO_INTERV do guia; a camada linha não o tem
    tipo_interv_desc  TEXT NOT NULL,
    geometria         TEXT NOT NULL CHECK (geometria IN ('poligono','linha')),
    unidade           TEXT NOT NULL CHECK (unidade IN ('ha','km')),
    modo              TEXT NOT NULL CHECK (modo IN
                      ('moto-manual','mecanico','rede-viaria','fogo','quimico','manual'))
);

-- Tipos de meio que a recomendação sabe combinar. O código é a classe
-- da viatura (viaturas.classe), excepto OP, que é um operacional.
CREATE TABLE IF NOT EXISTS demo.tipos_meio (
    codigo             TEXT PRIMARY KEY,
    designacao         TEXT NOT NULL,
    custo_hora_eur     NUMERIC(8,2),                    -- a trabalhar
    custo_km_eur       NUMERIC(6,2),                    -- a deslocar-se (só os meios de transporte)
    operadores         SMALLINT NOT NULL DEFAULT 0,     -- operacionais que o meio ocupa
    precisa_transporte BOOLEAN NOT NULL DEFAULT false,  -- vai em porta-máquinas
    simulado           BOOLEAN NOT NULL DEFAULT true
);
-- Preparar, levar e montar uma máquina na obra custa o mesmo quer ela
-- trabalhe um dia quer vinte. É o que faz duas máquinas custarem mais do
-- que uma, para o mesmo trabalho.
ALTER TABLE demo.tipos_meio ADD COLUMN IF NOT EXISTS mobilizacao_eur NUMERIC(8,2) NOT NULL DEFAULT 0;

-- Rendimento de um tipo de meio numa operação, por tipo de povoamento
-- (TIPO_POV do guia: 1 resinosas, 2 folhosas, 3 mistos, 4 matos/incultos).
-- Unidades da operação por hora. Simulado até haver valores da FSBF.
CREATE TABLE IF NOT EXISTS demo.rendimentos (
    operacao    TEXT     NOT NULL REFERENCES demo.operacoes(codigo),
    tipo_meio   TEXT     NOT NULL REFERENCES demo.tipos_meio(codigo),
    tipo_pov    SMALLINT NOT NULL CHECK (tipo_pov BETWEEN 1 AND 4),
    por_hora    NUMERIC(8,4) NOT NULL CHECK (por_hora > 0),
    simulado    BOOLEAN  NOT NULL DEFAULT true,
    PRIMARY KEY (operacao, tipo_meio, tipo_pov)
);

-- As bases FSBF, com coordenadas, para medir deslocações.
CREATE TABLE IF NOT EXISTS demo.bases (
    nome       TEXT PRIMARY KEY,
    companhia  TEXT NOT NULL,
    lat        DOUBLE PRECISION NOT NULL,
    lon        DOUBLE PRECISION NOT NULL
);

-- Base de cada meio FSBF, para a demonstração. Muitas máquinas não têm
-- base em viaturas.base; aqui atribui-se uma sem mexer no catálogo.
CREATE TABLE IF NOT EXISTS demo.viatura_base (
    viatura_id  UUID PRIMARY KEY REFERENCES viaturas(id) ON DELETE CASCADE,
    base        TEXT NOT NULL REFERENCES demo.bases(nome)
);

-- O registo da frota identifica a viatura pelo número da aplicação da
-- frota, não pelo id da GOGFR. Esta tabela faz a ponte.
CREATE TABLE IF NOT EXISTS demo.correspondencia_veiculos (
    origem      TEXT    NOT NULL CHECK (origem IN ('frota','maquinas')),
    id_externo  INTEGER NOT NULL,
    viatura_id  UUID    NOT NULL REFERENCES viaturas(id) ON DELETE CASCADE,
    PRIMARY KEY (origem, id_externo),
    UNIQUE (origem, viatura_id)
);

-- ── Fontes externas simuladas ─────────────────────────────────────

-- Propostas de empreitada: os atributos da camada PA (Plano de
-- Actividades) do guia SISF. Polígonos e linhas na mesma tabela; o guia
-- separa-os em duas camadas, mas os campos são quase os mesmos
-- (TIPO_FGC só existe nos polígonos, TIPO_ELEM só nas linhas).
-- A geometria é GeoJSON em WGS84; a quantidade sai dela.
CREATE TABLE IF NOT EXISTS ext.propostas_empreitada (
    id              SERIAL PRIMARY KEY,
    cod_equipa      TEXT NOT NULL,
    ano             SMALLINT NOT NULL,
    fase            TEXT NOT NULL DEFAULT 'PA',
    trim            TEXT NOT NULL CHECK (trim IN ('1T','2T','3T','4T')),
    n_dias          SMALLINT,
    tipo_pov        SMALLINT NOT NULL CHECK (tipo_pov BETWEEN 1 AND 4),
    nome            TEXT,
    tipo_interv     SMALLINT,
    interv          TEXT NOT NULL,
    tipo_fgc        TEXT CHECK (tipo_fgc IN ('FIC','FRC')),
    tipo_elem       TEXT CHECK (tipo_elem IN ('RVF','LA','OUI')),
    fin             TEXT NOT NULL CHECK (fin IN ('SP','SN')),
    observ          TEXT,
    geometria       TEXT NOT NULL CHECK (geometria IN ('poligono','linha')),
    geom            JSONB NOT NULL,
    area_ha         NUMERIC(10,2),
    comprimento_km  NUMERIC(10,2),
    base_proxima    TEXT,
    recebida_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registo de utilização da frota: as colunas exactamente como na
-- exportação da aplicação da frota FSBF (registo_utilizacao_frota_FSBF).
CREATE TABLE IF NOT EXISTS ext.fsbf_frota_utilizacao (
    id                        INTEGER PRIMARY KEY,
    veiculo_id                INTEGER NOT NULL,
    motorista_id              INTEGER,
    data_hora_saida           TIMESTAMP NOT NULL,
    data_hora_chegada         TIMESTAMP,
    origem                    TEXT,
    destino                   TEXT,
    km_inicial                INTEGER,
    km_final                  INTEGER,
    utilizador_registo_id     INTEGER,
    servico_afetacao          TEXT,
    nome_condutor             TEXT,
    abastecimento_lts         NUMERIC(8,2),
    abastecimento_eur         NUMERIC(8,2),
    portagens_eur             NUMERIC(8,2),
    adblue_lts                NUMERIC(8,2),
    acessorio_id              INTEGER,
    acessorio_km_inicial      INTEGER,
    acessorio_km_final        INTEGER,
    acessorio_horas_inicial   NUMERIC(10,1),
    acessorio_horas_final     NUMERIC(10,1),
    acessorio_horas_trabalho  NUMERIC(10,1),
    observacoes_fim           TEXT,
    lembrete_2h_enviado       BOOLEAN,
    ultimo_lembrete_em        TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ext_frota_veiculo ON ext.fsbf_frota_utilizacao(veiculo_id, data_hora_saida);

-- Registo de trabalho das máquinas. Ainda não há exemplo real: segue a
-- estrutura da frota, com o conta-horas no lugar do conta-quilómetros.
CREATE TABLE IF NOT EXISTS ext.fsbf_maquinas_utilizacao (
    id                        INTEGER PRIMARY KEY,
    maquina_id                INTEGER NOT NULL,
    operador_id               INTEGER,
    data_hora_inicio          TIMESTAMP NOT NULL,
    data_hora_fim             TIMESTAMP,
    origem                    TEXT,
    destino                   TEXT,
    horas_inicial             NUMERIC(10,1),
    horas_final               NUMERIC(10,1),
    utilizador_registo_id     INTEGER,
    servico_afetacao          TEXT,
    nome_operador             TEXT,
    abastecimento_lts         NUMERIC(8,2),
    abastecimento_eur         NUMERIC(8,2),
    adblue_lts                NUMERIC(8,2),
    acessorio_id              INTEGER,
    observacoes_fim           TEXT
);
CREATE INDEX IF NOT EXISTS idx_ext_maq_maquina ON ext.fsbf_maquinas_utilizacao(maquina_id, data_hora_inicio);

-- ── O que a aplicação escreve ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS demo.empreitadas (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo           TEXT NOT NULL UNIQUE,
    origem           TEXT NOT NULL CHECK (origem IN ('proposta','manual')),
    proposta_id      INTEGER REFERENCES ext.propostas_empreitada(id) ON DELETE SET NULL,
    nome             TEXT NOT NULL,
    geometria        TEXT NOT NULL CHECK (geometria IN ('poligono','linha')),
    geom             JSONB NOT NULL,
    area_ha          NUMERIC(10,2),
    comprimento_km   NUMERIC(10,2),
    tipo_pov         SMALLINT NOT NULL CHECK (tipo_pov BETWEEN 1 AND 4),
    base             TEXT REFERENCES demo.bases(nome),
    estado           TEXT NOT NULL DEFAULT 'seleccionada' CHECK (estado IN
                     ('seleccionada','planeada','em_execucao','concluida','cancelada')),
    inicio_previsto  DATE,
    fim_previsto     DATE,
    observacoes      TEXT,
    created_by       UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);
-- Uma proposta só dá uma empreitada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_empreitada_proposta
    ON demo.empreitadas(proposta_id) WHERE proposta_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS demo.empreitada_operacoes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empreitada_id  UUID NOT NULL REFERENCES demo.empreitadas(id) ON DELETE CASCADE,
    operacao       TEXT NOT NULL REFERENCES demo.operacoes(codigo),
    quantidade     NUMERIC(10,2) NOT NULL CHECK (quantidade > 0),
    UNIQUE (empreitada_id, operacao)
);

-- Um meio afecto a uma empreitada, num período. É uma viatura (máquina
-- incluída) ou um operacional — nunca as duas coisas.
CREATE TABLE IF NOT EXISTS demo.empreitada_meios (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empreitada_id    UUID NOT NULL REFERENCES demo.empreitadas(id) ON DELETE CASCADE,
    viatura_id       UUID REFERENCES viaturas(id) ON DELETE CASCADE,
    operacional_id   UUID REFERENCES operacionais_fsbf(id) ON DELETE CASCADE,
    operacao         TEXT REFERENCES demo.operacoes(codigo),
    inicio           TIMESTAMPTZ NOT NULL,
    fim              TIMESTAMPTZ NOT NULL,
    horas_previstas  NUMERIC(8,1),
    custo_previsto   NUMERIC(10,2),
    origem           TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('recomendacao','manual')),
    created_at       TIMESTAMPTZ DEFAULT now(),
    CHECK ((viatura_id IS NULL) <> (operacional_id IS NULL)),
    CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS idx_emp_meios_viatura     ON demo.empreitada_meios(viatura_id, inicio);
CREATE INDEX IF NOT EXISTS idx_emp_meios_operacional ON demo.empreitada_meios(operacional_id, inicio);

-- Horas dos operacionais: não há fonte externa, registam-se na aplicação.
CREATE TABLE IF NOT EXISTS demo.horas_operacionais (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empreitada_id   UUID NOT NULL REFERENCES demo.empreitadas(id) ON DELETE CASCADE,
    operacional_id  UUID NOT NULL REFERENCES operacionais_fsbf(id) ON DELETE CASCADE,
    data            DATE NOT NULL,
    hora_inicio     TIME NOT NULL,
    hora_fim        TIME NOT NULL,
    operacao        TEXT REFERENCES demo.operacoes(codigo),
    observacoes     TEXT,
    created_by      UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    CHECK (hora_fim > hora_inicio),
    UNIQUE (operacional_id, data, hora_inicio)
);
-- Pausa de almoço, descontada às horas do dia.
ALTER TABLE demo.horas_operacionais ADD COLUMN IF NOT EXISTS pausa_min SMALLINT NOT NULL DEFAULT 60;
CREATE INDEX IF NOT EXISTS idx_horas_op_empreitada ON demo.horas_operacionais(empreitada_id, data);
