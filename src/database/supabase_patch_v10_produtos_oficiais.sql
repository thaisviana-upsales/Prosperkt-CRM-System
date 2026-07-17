-- ============================================================
-- PROSPERKT CRM — Patch v10: Campos Extras + Produtos Oficiais
-- Executar no Supabase SQL Editor
-- SEGURO: ADD COLUMN IF NOT EXISTS — não usa DROP, DELETE, TRUNCATE
-- ============================================================

-- 1. Adiciona colunas extras à tabela produtos
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria  TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descricao  TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ordem      INTEGER DEFAULT 0;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS origem     TEXT DEFAULT 'lista_oficial_prospekt';

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_produtos_ordem    ON produtos (ordem);
CREATE INDEX IF NOT EXISTS idx_produtos_ativo    ON produtos (ativo);
CREATE INDEX IF NOT EXISTS idx_produtos_origem   ON produtos (origem);

-- 2. Adiciona coluna lead_produtos_json em adm_vendas (guarda lista de produtos da venda)
ALTER TABLE adm_vendas ADD COLUMN IF NOT EXISTS lead_produtos_json JSONB;

-- 3. Marca produtos com origem correta (os já inseridos pelo seed JS)
UPDATE produtos
SET origem = 'lista_oficial_prospekt'
WHERE origem IS NULL;

-- 4. Garante índice na tabela lead_produtos (já criado no patch v6, mas idempotente)
CREATE INDEX IF NOT EXISTS idx_lead_produtos_lead_id    ON lead_produtos (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_produtos_produto_id ON lead_produtos (produto_id);

-- ============================================================
-- FIM DO PATCH v10
-- ============================================================
