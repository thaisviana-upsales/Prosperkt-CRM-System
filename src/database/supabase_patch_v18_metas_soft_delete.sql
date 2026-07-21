-- ============================================================
-- PROSPERKT CRM — Patch v18: Metas Soft Delete (audit columns)
-- Execute no Supabase SQL Editor ANTES do deploy.
-- SEGURO: ADD COLUMN IF NOT EXISTS — sem DROP/DELETE/TRUNCATE.
-- ============================================================

-- 1. Colunas de auditoria do soft delete
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS removido_em  TIMESTAMPTZ;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS removido_por TEXT;

-- 2. Garante que 'ativo' seja INTEGER (compatibilidade com 0/1)
--    Se já for INTEGER, este comando é no-op seguro.
--    (Supabase Postgres: BOOLEAN e INTEGER são incompatíveis com 0/1)
--    Se precisar converter, rode: ALTER TABLE public.metas ALTER COLUMN ativo TYPE INTEGER USING CASE WHEN ativo THEN 1 ELSE 0 END;
--    Verificar tipo atual: SELECT column_name, data_type FROM information_schema.columns WHERE table_name='metas';

-- 3. Índice para listagem de metas ativas (performance)
CREATE INDEX IF NOT EXISTS idx_metas_ativo ON public.metas (ativo);
CREATE INDEX IF NOT EXISTS idx_metas_removido_em ON public.metas (removido_em);

-- ============================================================
-- FIM DO PATCH v18
-- ============================================================
