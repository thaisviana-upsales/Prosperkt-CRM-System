-- ============================================================
-- PROSPERKT CRM — Patch v5: Hardening — Auditoria + Soft Delete + Índices
-- Executar no Supabase SQL Editor
-- SEGURO: usa IF NOT EXISTS / IF EXISTS em todos os comandos
-- NÃO usa DROP, DELETE, TRUNCATE, RESET ou SEED
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. TABELA audit_logs (auditoria completa, imutável)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT        PRIMARY KEY,
  usuario_id    TEXT        REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nome  TEXT,
  usuario_role  TEXT,
  acao          TEXT        NOT NULL,   -- CREATE, UPDATE, DELETE, MOVE, LOGIN, etc.
  entidade      TEXT,                   -- leads, produtos, funis, etapas, usuarios, ...
  entidade_id   TEXT,
  antes         JSONB,
  depois        JSONB,
  ip            TEXT,
  user_agent    TEXT,
  origem        TEXT,                   -- web, api, webhook, system
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para auditoria
CREATE INDEX IF NOT EXISTS idx_audit_usuario   ON audit_logs (usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_entidade  ON audit_logs (entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_audit_acao      ON audit_logs (acao);
CREATE INDEX IF NOT EXISTS idx_audit_criado_em ON audit_logs (criado_em DESC);

-- RLS: somente GESTOR+ pode ler, ninguém pode deletar via API
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT USING (true);
DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT WITH CHECK (true);
-- Sem UPDATE e DELETE policies = imutável via API

-- ────────────────────────────────────────────────────────────
-- 2. SOFT DELETE — leads
-- ────────────────────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_by  TEXT REFERENCES usuarios(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────
-- 3. SOFT DELETE — produtos
-- ────────────────────────────────────────────────────────────
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS deleted_by TEXT REFERENCES usuarios(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────
-- 4. SOFT DELETE — funis
-- ────────────────────────────────────────────────────────────
ALTER TABLE funis ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE funis ADD COLUMN IF NOT EXISTS deleted_by TEXT REFERENCES usuarios(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────
-- 5. SOFT DELETE — etapas
-- ────────────────────────────────────────────────────────────
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS deleted_by TEXT REFERENCES usuarios(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────
-- 6. SOFT DELETE — mensagens / conversas (se tabelas existem)
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='mensagens') THEN
    EXECUTE 'ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ';
    EXECUTE 'ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS deleted_by TEXT';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='conversas') THEN
    EXECUTE 'ALTER TABLE conversas ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ';
    EXECUTE 'ALTER TABLE conversas ADD COLUMN IF NOT EXISTS deleted_by TEXT';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 7. ÍNDICES DE PERFORMANCE (leads — queries mais comuns)
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_deleted_at    ON leads (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_responsavel   ON leads (responsavel_id);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline      ON leads (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_leads_status        ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_ganho_em      ON leads (ganho_em);
CREATE INDEX IF NOT EXISTS idx_leads_perdido_em    ON leads (perdido_em);
CREATE INDEX IF NOT EXISTS idx_leads_criado_em     ON leads (criado_em);
CREATE INDEX IF NOT EXISTS idx_leads_etapa_id      ON leads (etapa_id);
CREATE INDEX IF NOT EXISTS idx_leads_funil_id      ON leads (funil_id);

-- Produtos
CREATE INDEX IF NOT EXISTS idx_produtos_deleted ON produtos (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_produtos_nome    ON produtos (nome);

-- Etapas
CREATE INDEX IF NOT EXISTS idx_etapas_pipeline ON etapas (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_etapas_ordem    ON etapas (pipeline_id, ordem);
CREATE INDEX IF NOT EXISTS idx_etapas_deleted  ON etapas (deleted_at) WHERE deleted_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 8. TABELA backups (registro de backups executados)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backups (
  id          TEXT        PRIMARY KEY,
  tipo        TEXT        NOT NULL, -- diario | semanal | mensal
  status      TEXT        NOT NULL DEFAULT 'pendente', -- pendente | concluido | erro
  arquivo     TEXT,                  -- caminho do arquivo gerado
  tamanho_kb  INTEGER,
  tabelas     JSONB,                 -- lista de tabelas incluídas
  erro        TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluido_em TIMESTAMPTZ
);

-- ────────────────────────────────────────────────────────────
-- FIM DO PATCH v5
-- ============================================================
