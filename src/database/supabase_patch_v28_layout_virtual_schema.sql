-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPEKT CRM — Patch v28
-- Objetivo: garantir coluna layout_virtual_aprovado_em em public.leads
--           e notificar PostgREST para recarregar schema cache.
-- SEGURO: usa ADD COLUMN IF NOT EXISTS — não usa DROP, DELETE ou TRUNCATE.
-- Executar no Supabase SQL Editor antes do deploy.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Garante coluna de data de aprovação do layout virtual
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS layout_virtual_aprovado_em TIMESTAMPTZ;

-- 2. Garante coluna de data de entrada no layout virtual (se não existir)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS layout_virtual_entrada_em TIMESTAMPTZ;

-- 3. Força PostgREST a recarregar o schema cache imediatamente
--    (sem isso, a coluna nova não é reconhecida até o próximo restart automático)
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação: deve retornar as duas colunas com data_type = 'timestamp with time zone'
-- ─────────────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'leads'
  AND column_name  IN ('layout_virtual_aprovado_em', 'layout_virtual_entrada_em')
ORDER BY column_name;
