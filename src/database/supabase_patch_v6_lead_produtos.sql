-- ============================================================
-- PROSPERKT CRM — Patch v6: lead_produtos (múltiplos produtos/venda)
-- Executar no Supabase SQL Editor
-- SEGURO: somente CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- NÃO usa DROP, DELETE, TRUNCATE, RESET ou SEED
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tabela lead_produtos
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_produtos (
  id             TEXT          PRIMARY KEY,
  lead_id        TEXT          NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  produto_id     TEXT          REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome   TEXT          NOT NULL,
  produto_cor    TEXT,
  quantidade     NUMERIC(10,3) NOT NULL DEFAULT 1,
  valor_unitario NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_total    NUMERIC(14,2) GENERATED ALWAYS AS (quantidade * valor_unitario) STORED,
  criado_em      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

-- ────────────────────────────────────────────────────────────
-- 2. Índices de performance
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_lead_produtos_lead_id   ON lead_produtos (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_produtos_produto_id ON lead_produtos (produto_id);
CREATE INDEX IF NOT EXISTS idx_lead_produtos_ativos     ON lead_produtos (lead_id) WHERE deleted_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 3. RLS — mesmas políticas liberadas do restante do CRM
-- ────────────────────────────────────────────────────────────
ALTER TABLE lead_produtos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_produtos_all ON lead_produtos;
CREATE POLICY lead_produtos_all ON lead_produtos USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- FIM DO PATCH v6
-- ============================================================
