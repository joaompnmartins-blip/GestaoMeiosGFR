-- MEGFR — Schema completo (beta1)
-- Executado automaticamente no arranque via runMigrations() em server.js
-- Todos os CREATE usam IF NOT EXISTS — seguro em DB existente.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ══════════════════════════════════════════════════════════════════
--  UTILIZADORES
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS utilizadores (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    nome          TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'visualizador'
                                CHECK (role IN (
                                    'admin',
                                    'ofligacao_ccon',
                                    'ofligacao',
                                    'operacional',
                                    'visualizador',
                                    'gestor_sf',
                                    'gestor_fsbf',
                                    'gestor_icnf'
                                )),
    subregiao     TEXT,
    ativo         BOOLEAN     DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════
--  CATÁLOGO — FONTES
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fontes (
    id       SERIAL PRIMARY KEY,
    codigo   TEXT NOT NULL UNIQUE,   -- 'SF', 'ICNF', 'FSBF'
    nome     TEXT NOT NULL,
    conn_ref TEXT
);
INSERT INTO fontes (codigo, nome) VALUES
    ('SF',   'Sapadores Florestais'),
    ('ICNF', 'ICNF'),
    ('FSBF', 'Força de Sapadores Bombeiros Florestais')
ON CONFLICT (codigo) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
--  CATÁLOGO — TIPOS DE RECURSO
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS recurso_tipos (
    codigo    TEXT PRIMARY KEY,
    nome      TEXT NOT NULL,
    fonte_id  INT  NOT NULL REFERENCES fontes(id),
    categoria TEXT NOT NULL CHECK (categoria IN ('equipa','pessoa','componente'))
);
INSERT INTO recurso_tipos (codigo, nome, fonte_id, categoria) VALUES
    ('ESF',  'Equipa de Sapadores Florestais',           (SELECT id FROM fontes WHERE codigo='SF'),   'equipa'),
    ('ECNAF','Equipa CNAF',                              (SELECT id FROM fontes WHERE codigo='ICNF'), 'equipa'),
    ('EVN',  'Equipa de Vigilantes da Natureza',         (SELECT id FROM fontes WHERE codigo='ICNF'), 'equipa'),
    ('EFSBF','Equipa FSBF',                              (SELECT id FROM fontes WHERE codigo='FSBF'), 'equipa'),
    ('TGFR', 'Técnico GFR',                              (SELECT id FROM fontes WHERE codigo='ICNF'), 'pessoa'),
    ('DIR',  'Dirigente',                                (SELECT id FROM fontes WHERE codigo='ICNF'), 'pessoa'),
    ('OLN',  'Oficial de Ligação Nacional',              (SELECT id FROM fontes WHERE codigo='ICNF'), 'pessoa'),
    ('TFSBF','Técnico FSBF',                             (SELECT id FROM fontes WHERE codigo='FSBF'), 'pessoa'),
    ('EMR',  'Componente de Máquinas de Rastos (FSBF)',  (SELECT id FROM fontes WHERE codigo='FSBF'), 'componente')
ON CONFLICT (codigo) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
--  CATÁLOGO — RECURSOS
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS recursos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          TEXT NOT NULL UNIQUE,       -- Meios_v1.Meio
    tipo            TEXT NOT NULL REFERENCES recurso_tipos(codigo),
    regime          TEXT CHECK (regime IN ('CNT','PRP')),
    num_elementos   INT  DEFAULT 1,
    entidade        TEXT,
    local_base      TEXT,
    lat_base        DOUBLE PRECISION,
    long_base       DOUBLE PRECISION,
    contacto        TEXT,
    email           TEXT,
    concelho        TEXT,
    subregiao       TEXT,
    agfr            TEXT,
    -- Prontidão (gerida pelos módulos de gestão, só para categorias equipa/componente)
    prontidao       TEXT NOT NULL DEFAULT 'operacional'
                    CHECK (prontidao IN ('operacional','inoperacional')),
    prontidao_motivo TEXT,
    prontidao_ate   DATE,
    prontidao_by    UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
    prontidao_at    TIMESTAMPTZ,
    notas           TEXT,
    -- Capacidades EGFR (TGFR)
    fogo_controlado BOOLEAN NOT NULL DEFAULT false,
    fogo_supressao  BOOLEAN NOT NULL DEFAULT false,
    -- Campos auxiliares de ligação do xlsx
    ddi_portatil    TEXT,
    ddi_viatura     TEXT,
    viatura_cod     TEXT,
    brigada_codigo  TEXT,
    -- Sincronização
    external_id     TEXT,
    sync_hash       TEXT,
    synced_at       TIMESTAMPTZ,
    ativo           BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recursos_tipo      ON recursos(tipo);
CREATE INDEX IF NOT EXISTS idx_recursos_subregiao ON recursos(subregiao);
CREATE INDEX IF NOT EXISTS idx_recursos_ativo     ON recursos(ativo) WHERE ativo;

-- Histórico de prontidão
CREATE TABLE IF NOT EXISTS recursos_prontidao_eventos (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recurso_id UUID NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
    ts         TIMESTAMPTZ DEFAULT now(),
    de         TEXT,
    para       TEXT NOT NULL,
    motivo     TEXT,
    user_id    UUID REFERENCES utilizadores(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_prontidao_ev_recurso ON recursos_prontidao_eventos(recurso_id, ts DESC);

-- ══════════════════════════════════════════════════════════════════
--  CATÁLOGO — VIATURAS
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS viaturas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    viatura_cod     TEXT NOT NULL UNIQUE,
    recurso_id      UUID REFERENCES recursos(id) ON DELETE SET NULL,
    megfr           TEXT,
    tipo_decir      TEXT,
    classe          TEXT,           -- primeiro token do código: VLCI, VCOT, MR, PM, TR…
    codigo_icnf     TEXT,
    tipologia       TEXT,
    marca           TEXT,
    modelo          TEXT,
    chassis         TEXT,
    matricula       TEXT,
    entidade        TEXT,
    base            TEXT,
    estado          TEXT,
    agfr            TEXT,
    lat_base        DOUBLE PRECISION,
    long_base       DOUBLE PRECISION,
    ddi_viatura     TEXT,
    prontidao       TEXT NOT NULL DEFAULT 'operacional'
                    CHECK (prontidao IN ('operacional','inoperacional')),
    prontidao_motivo TEXT,
    prontidao_by    UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
    prontidao_at    TIMESTAMPTZ,
    manual_override BOOLEAN DEFAULT false,
    external_cod_equipa TEXT,
    sync_hash       TEXT,
    synced_at       TIMESTAMPTZ,
    ativo           BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_viaturas_recurso ON viaturas(recurso_id);
CREATE INDEX IF NOT EXISTS idx_viaturas_classe  ON viaturas(classe);

-- ══════════════════════════════════════════════════════════════════
--  CATÁLOGO — RÁDIOS
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS radios (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ddi         TEXT NOT NULL UNIQUE,
    tipo        TEXT NOT NULL CHECK (tipo IN ('Portatil','Viatura')),
    recurso_id  UUID REFERENCES recursos(id) ON DELETE SET NULL,
    viatura_id  UUID REFERENCES viaturas(id) ON DELETE SET NULL,
    megfr       TEXT,
    entidade    TEXT,
    alias       TEXT,
    indicativo  TEXT,
    estado      TEXT,
    subregiao   TEXT,
    manual_override     BOOLEAN DEFAULT false,
    external_cod_equipa TEXT,
    sync_hash   TEXT,
    synced_at   TIMESTAMPTZ,
    ativo       BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    CHECK (recurso_id IS NULL OR viatura_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_radios_recurso ON radios(recurso_id);
CREATE INDEX IF NOT EXISTS idx_radios_viatura ON radios(viatura_id);

-- ══════════════════════════════════════════════════════════════════
--  CATÁLOGO — COMPOSIÇÕES
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS composicoes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo      TEXT NOT NULL UNIQUE,
    tipo        TEXT NOT NULL CHECK (tipo IN ('BSF','EGFR_NACIONAL','EGFR_LOCAL','EMR')),
    subregiao   TEXT,
    concelho    TEXT,
    predefinida BOOLEAN DEFAULT true,
    notas       TEXT,
    created_by  UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
    ativo       BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS composicao_membros (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    composicao_id UUID NOT NULL REFERENCES composicoes(id) ON DELETE CASCADE,
    recurso_id    UUID REFERENCES recursos(id) ON DELETE CASCADE,
    viatura_id    UUID REFERENCES viaturas(id) ON DELETE CASCADE,
    papel         TEXT NOT NULL,
    ordem         INT  DEFAULT 0,
    CHECK (num_nonnulls(recurso_id, viatura_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comp_membro_recurso
    ON composicao_membros(composicao_id, recurso_id) WHERE recurso_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_comp_membro_viatura
    ON composicao_membros(composicao_id, viatura_id) WHERE viatura_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════
--  ESCALA OLN (nacional)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS oln_escala (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recurso_id UUID NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
    inicio     TIMESTAMPTZ NOT NULL,
    fim        TIMESTAMPTZ NOT NULL,
    notas      TEXT,
    created_by UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CHECK (fim > inicio)
);
ALTER TABLE oln_escala DROP CONSTRAINT IF EXISTS oln_escala_sem_sobreposicao;
ALTER TABLE oln_escala ADD CONSTRAINT oln_escala_sem_sobreposicao
    EXCLUDE USING gist (tstzrange(inicio, fim) WITH &&);

CREATE TABLE IF NOT EXISTS egfr_escala (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data                 DATE        NOT NULL,
    semana_ano           INT,
    semana_escala        INT,
    turno                TEXT        NOT NULL,
    equipa               TEXT        NOT NULL,
    posicao              TEXT        NOT NULL,
    nome                 TEXT        NOT NULL,
    recurso_id           UUID        REFERENCES recursos(id) ON DELETE SET NULL,
    capacidade_supressao BOOLEAN     NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ DEFAULT now(),
    UNIQUE (data, equipa, posicao)
);
CREATE INDEX IF NOT EXISTS idx_egfr_escala_data     ON egfr_escala(data);
CREATE INDEX IF NOT EXISTS idx_egfr_escala_equipa   ON egfr_escala(equipa);
CREATE INDEX IF NOT EXISTS idx_egfr_escala_recurso  ON egfr_escala(recurso_id);

-- Viatura pré-atribuída a cada equipa EGFR por dia
CREATE TABLE IF NOT EXISTS egfr_viatura (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data       DATE NOT NULL,
    equipa     TEXT NOT NULL,
    viatura_id UUID REFERENCES viaturas(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (data, equipa)
);
CREATE INDEX IF NOT EXISTS idx_egfr_viatura_data ON egfr_viatura(data);

-- ══════════════════════════════════════════════════════════════════
--  CARTA DE MEIOS FSBF (plano diário)
-- ══════════════════════════════════════════════════════════════════

-- Cabeçalho diário (coordenador + chefe de grupo)
CREATE TABLE IF NOT EXISTS fsbf_carta (
    data                  DATE        PRIMARY KEY,
    coord_nome            TEXT,
    coord_contacto        TEXT,
    chefe_nome            TEXT,
    chefe_contacto        TEXT,
    chefe_guarnicao       INT,
    chefe_veiculo_id      UUID        REFERENCES viaturas(id) ON DELETE SET NULL,
    chefe_veiculo_texto   TEXT,         -- fallback se veículo não está no catálogo
    notas_outros_meios    TEXT,
    updated_by            UUID        REFERENCES utilizadores(id) ON DELETE SET NULL,
    updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Equipas BSBF (Norte / Sul / GSBF) — uma linha por veículo/equipa
CREATE TABLE IF NOT EXISTS fsbf_bsbf_equipa (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    data        DATE        NOT NULL,
    brigada     TEXT        NOT NULL CHECK (brigada IN ('Norte','Sul','GSBF')),
    veiculo_id  UUID        REFERENCES viaturas(id) ON DELETE SET NULL,
    guarnicao   INT,
    chefe_nome  TEXT,
    contacto    TEXT,
    observacoes TEXT,
    ordem       INT         DEFAULT 0,
    created_by  UUID        REFERENCES utilizadores(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fsbf_bsbf_data ON fsbf_bsbf_equipa(data);

-- Equipas EMR (Máquinas de Rasto) — uma linha por máquina
CREATE TABLE IF NOT EXISTS fsbf_emr_equipa (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    data               DATE        NOT NULL,
    base               TEXT,
    mr_viatura_id      UUID        REFERENCES viaturas(id) ON DELETE SET NULL,
    vaop_viatura_id    UUID        REFERENCES viaturas(id) ON DELETE SET NULL,
    vpiloto_viatura_id UUID        REFERENCES viaturas(id) ON DELETE SET NULL,
    vlci_viatura_id    UUID        REFERENCES viaturas(id) ON DELETE SET NULL,
    chefe_nome         TEXT,
    contacto           TEXT,
    total_op           INT,
    observacoes        TEXT,
    ordem              INT         DEFAULT 0,
    created_by         UUID        REFERENCES utilizadores(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fsbf_emr_data ON fsbf_emr_equipa(data);

-- ══════════════════════════════════════════════════════════════════
--  OCORRÊNCIAS
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ocorrencias (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    local_ignicao        TEXT        NOT NULL,
    codigo_ocorrencia    TEXT,
    subregiao            TEXT,
    concelho             TEXT,
    obs                  TEXT,
    inicio               TIMESTAMPTZ,
    status               TEXT        DEFAULT 'active' CHECK (status IN ('active','closed')),
    created_by           UUID        REFERENCES utilizadores(id) ON DELETE SET NULL,
    oficial_ligacao_id   UUID        REFERENCES utilizadores(id) ON DELETE SET NULL,
    oficial_ligacao_nome TEXT,
    created_at           TIMESTAMPTZ DEFAULT now(),
    updated_at           TIMESTAMPTZ DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════
--  MEIOS (registo operacional)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS meios (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ocorrencia_id         UUID        NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
    -- Ligações ao catálogo
    recurso_id            UUID        REFERENCES recursos(id)    ON DELETE SET NULL,
    viatura_id            UUID        REFERENCES viaturas(id)    ON DELETE SET NULL,
    composicao_id         UUID        REFERENCES composicoes(id) ON DELETE SET NULL,
    meio_pai_id           UUID        REFERENCES meios(id)       ON DELETE CASCADE,
    -- Snapshot descritivo (independente do catálogo)
    eq                    TEXT        NOT NULL,
    tipo                  TEXT,
    matricula             TEXT,
    concelho              TEXT,
    setor                 TEXT,
    operacionais          INT         DEFAULT 0,
    responsavel           TEXT,
    contacto              TEXT,
    data_despacho         DATE,
    hora_despacho         TIME,
    data_saida_entidade   DATE,
    hora_saida_entidade   TIME,
    data_chegada          DATE,
    hora_chegada          TIME,
    horas_max             INT,
    limite_op             TIME,
    limite_op_date        DATE,
    data_demob            DATE,
    hora_demob            TIME,
    data_chegada_entidade DATE,
    hora_chegada_entidade TIME,
    km                    INT,
    missao                TEXT,
    obs                   TEXT,
    estado                TEXT        DEFAULT 'previsto'
                                      CHECK (estado IN ('transito','operacao','descanso','desmobilizado','previsto')),
    previsto_data         DATE,
    previsto_hora         TIME,
    created_by            UUID        REFERENCES utilizadores(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Exclusividade: um recurso não pode estar ativo em mais de uma ocorrência
CREATE UNIQUE INDEX IF NOT EXISTS idx_meios_recurso_active
    ON meios(recurso_id)
    WHERE recurso_id IS NOT NULL AND estado IN ('transito','operacao','descanso');

CREATE UNIQUE INDEX IF NOT EXISTS idx_meios_viatura_active
    ON meios(viatura_id)
    WHERE viatura_id IS NOT NULL AND estado IN ('transito','operacao','descanso');

CREATE INDEX IF NOT EXISTS idx_meios_pai        ON meios(meio_pai_id);
CREATE INDEX IF NOT EXISTS idx_meios_ocorrencia ON meios(ocorrencia_id);
CREATE INDEX IF NOT EXISTS idx_meios_estado     ON meios(estado);

-- Exclusividade: equipas nacionais FSBF/EGFR só podem estar activas numa ocorrência
CREATE UNIQUE INDEX IF NOT EXISTS idx_meios_fsbf_bsbf_active
    ON meios(fsbf_bsbf_id)
    WHERE fsbf_bsbf_id IS NOT NULL AND estado <> 'desmobilizado' AND meio_pai_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meios_fsbf_emr_active
    ON meios(fsbf_emr_id)
    WHERE fsbf_emr_id IS NOT NULL AND estado <> 'desmobilizado' AND meio_pai_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meios_egfr_active
    ON meios(egfr_data, egfr_equipa)
    WHERE egfr_equipa IS NOT NULL AND estado <> 'desmobilizado' AND meio_pai_id IS NULL;

-- ══════════════════════════════════════════════════════════════════
--  MEIOS OPERATIVOS, EVENTOS, PEDIDOS DE REMOÇÃO
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS meios_operativos (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meio_id UUID NOT NULL REFERENCES meios(id) ON DELETE CASCADE,
    nome    TEXT NOT NULL,
    ordem   INT  DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_meios_operativos ON meios_operativos(meio_id);

CREATE TABLE IF NOT EXISTS meios_eventos (
    id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    meio_id UUID        NOT NULL REFERENCES meios(id) ON DELETE CASCADE,
    ts      TIMESTAMPTZ DEFAULT now(),
    msg     TEXT        NOT NULL,
    user_id UUID        REFERENCES utilizadores(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_meios_eventos_meio ON meios_eventos(meio_id);

CREATE TABLE IF NOT EXISTS ocorrencias_eventos (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ocorrencia_id UUID        NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
    ts            TIMESTAMPTZ DEFAULT now(),
    tag           TEXT        DEFAULT 'occ',
    meio_label    TEXT,
    msg           TEXT        NOT NULL,
    user_id       UUID        REFERENCES utilizadores(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_occ_eventos_occ ON ocorrencias_eventos(ocorrencia_id);
CREATE INDEX IF NOT EXISTS idx_occ_eventos_ts  ON ocorrencias_eventos(ts);

CREATE TABLE IF NOT EXISTS meio_delete_requests (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    meio_id        UUID        NOT NULL REFERENCES meios(id)       ON DELETE CASCADE,
    ocorrencia_id  UUID        NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
    meio_eq        TEXT        NOT NULL,
    meio_tipo      TEXT,
    motivo         TEXT,
    status         TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','approved','rejected')),
    requested_by   UUID        REFERENCES utilizadores(id) ON DELETE SET NULL,
    requested_nome TEXT,
    resolved_by    UUID        REFERENCES utilizadores(id) ON DELETE SET NULL,
    resolved_nome  TEXT,
    resolved_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meio_delete_requests_pending
    ON meio_delete_requests(meio_id) WHERE status = 'pending';

-- ══════════════════════════════════════════════════════════════════
--  OPERACIONAIS PREDEFINIDOS
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS operacionais_predefinidos (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome      TEXT NOT NULL,
    categoria TEXT,
    contacto  TEXT,
    notas     TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════
--  FITA DO TEMPO
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ocorrencia_timeline (
    id            SERIAL PRIMARY KEY,
    ocorrencia_id UUID        NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    categoria     TEXT        NOT NULL,
    titulo        TEXT,
    descricao     TEXT,
    dados         JSONB,
    autor_nome    TEXT,
    autor_id      UUID        REFERENCES utilizadores(id),
    meio_id       UUID        REFERENCES meios(id)
);
CREATE INDEX IF NOT EXISTS idx_timeline_occ ON ocorrencia_timeline(ocorrencia_id, ts DESC);

-- ══════════════════════════════════════════════════════════════════
--  SECTORES PREDEFINIDOS
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sectores (
    id         SERIAL PRIMARY KEY,
    designacao TEXT NOT NULL UNIQUE
);
INSERT INTO sectores (designacao) VALUES
    ('PC'),('ALFA'),('BRAVO'),('CHARLIE'),('DELTA'),
    ('FOXTROT'),('GOLF'),('HOTEL'),('INDIA')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
--  TRIGGERS updated_at
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_utilizadores_upd') THEN
        CREATE TRIGGER trg_utilizadores_upd
            BEFORE UPDATE ON utilizadores FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_ocorrencias_upd') THEN
        CREATE TRIGGER trg_ocorrencias_upd
            BEFORE UPDATE ON ocorrencias  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_meios_upd') THEN
        CREATE TRIGGER trg_meios_upd
            BEFORE UPDATE ON meios        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_recursos_upd') THEN
        CREATE TRIGGER trg_recursos_upd
            BEFORE UPDATE ON recursos     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_viaturas_upd') THEN
        CREATE TRIGGER trg_viaturas_upd
            BEFORE UPDATE ON viaturas     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════
--  VIEW DE COMPATIBILIDADE (transição)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW equipas_compat AS
SELECT r.id,
       r.codigo        AS nome,
       r.tipo,
       rt.categoria    AS tipo_equipa,
       r.subregiao,
       r.concelho,
       r.num_elementos AS capacidade,
       f.codigo        AS origem,
       NULL::TEXT      AS notas,
       r.created_at,
       r.updated_at
FROM recursos r
JOIN recurso_tipos rt ON rt.codigo = r.tipo
JOIN fontes f         ON f.id = rt.fonte_id
WHERE r.ativo;
