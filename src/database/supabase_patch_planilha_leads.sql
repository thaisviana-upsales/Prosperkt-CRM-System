-- ============================================================
-- PROSPERKT CRM — Patch: planilha_importacoes
-- Tabela de controle para impedir reimportação de linhas
-- SEGURO: somente CREATE IF NOT EXISTS
-- NÃO usa DROP, DELETE, TRUNCATE, RESET ou SEED
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tabela planilha_importacoes
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planilha_importacoes (
  id                TEXT        PRIMARY KEY,
  fonte             TEXT        NOT NULL DEFAULT 'planilha_teste', -- planilha_teste | webhook | ...
  linha_origem      INTEGER,       -- número da linha na planilha (1-based header = linha 1)
  telefone          TEXT,          -- normalizado (só dígitos)
  email             TEXT,
  nome              TEXT,
  lead_id           TEXT,          -- ID do lead criado (null se ignorado)
  status_importacao TEXT        NOT NULL DEFAULT 'pendente'
                                   CHECK (status_importacao IN ('criado','duplicado','erro','ignorado','pendente')),
  erro              TEXT,          -- mensagem de erro se falhou
  hash_linha        TEXT,          -- sha256 do conteudo da linha para idempotência
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 2. Índices
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_planilha_telefone ON planilha_importacoes (telefone) WHERE telefone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planilha_email    ON planilha_importacoes (email)    WHERE email    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planilha_hash     ON planilha_importacoes (hash_linha) WHERE hash_linha IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planilha_fonte    ON planilha_importacoes (fonte, status_importacao);
CREATE INDEX IF NOT EXISTS idx_planilha_criado   ON planilha_importacoes (criado_em DESC);

-- ────────────────────────────────────────────────────────────
-- 3. RLS permissiva (controle feito no backend)
-- ────────────────────────────────────────────────────────────
ALTER TABLE planilha_importacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS planilha_imp_all ON planilha_importacoes;
CREATE POLICY planilha_imp_all ON planilha_importacoes USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- FIM DO PATCH planilha_leads
-- ============================================================
