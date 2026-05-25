-- ============================================================
-- PROSPERKT CRM — Patch v3: Campos Comerciais da Venda
-- Executar manualmente no Supabase SQL Editor
-- SEGURO: usa ADD COLUMN IF NOT EXISTS e CREATE TABLE IF NOT EXISTS
-- ============================================================

-- 1. Tabela de Produtos
CREATE TABLE IF NOT EXISTS produtos (
  id           TEXT PRIMARY KEY,
  nome         TEXT NOT NULL,
  cor          TEXT DEFAULT '#6CFF4E',
  ativo        BOOLEAN DEFAULT TRUE,
  criado_em    TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Índice por nome para buscas rápidas e unicidade
CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_nome_lower
  ON produtos (LOWER(nome));

-- 2. Campos comerciais na tabela leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS valor_venda         NUMERIC        DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS forma_pagamento     TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS quantidade_parcelas INTEGER        DEFAULT 1;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS parcelas_json       JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS produto_id          TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS produto_nome        TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS produto_cor         TEXT;

-- Campos que podem não existir ainda
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ganho_em       TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS atualizado_em  TIMESTAMPTZ DEFAULT NOW();

-- FK produto_id → produtos (opcional, só se a tabela já existe)
-- Comentado para evitar erro caso algum lead tenha produto_id legado
-- ALTER TABLE leads ADD CONSTRAINT fk_lead_produto
--   FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL;

-- ============================================================
-- FIM DO PATCH v3
-- ============================================================
