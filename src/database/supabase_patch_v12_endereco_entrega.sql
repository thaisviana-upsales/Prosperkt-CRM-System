-- ============================================================
-- PROSPERKT CRM — Patch v12: Endereço de Entrega no Lead
-- Execute no Supabase SQL Editor ANTES do deploy
-- SEGURO: ADD COLUMN IF NOT EXISTS — não usa DROP, DELETE, TRUNCATE
-- ============================================================

-- 1. Adiciona coluna endereco_entrega na tabela leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS endereco_entrega TEXT;

-- 2. Índice para buscas (opcional, bom para filtros futuros)
CREATE INDEX IF NOT EXISTS idx_leads_endereco ON leads ((endereco_entrega IS NOT NULL));

-- 3. Adiciona coluna em adm_vendas para exibição ao time operacional
ALTER TABLE adm_vendas ADD COLUMN IF NOT EXISTS endereco_entrega TEXT;

-- ============================================================
-- FIM DO PATCH v12
-- ============================================================
