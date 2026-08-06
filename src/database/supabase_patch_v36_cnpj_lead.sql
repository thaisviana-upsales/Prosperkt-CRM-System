-- ============================================================
-- PROSPERKT CRM — Patch v36: Campo CNPJ no Lead
-- Executar no Supabase SQL Editor
-- SEGURO: apenas ADD COLUMN IF NOT EXISTS — sem DROP, DELETE, TRUNCATE
-- ============================================================

-- ── 1. Adiciona coluna cnpj na tabela leads ───────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS cnpj TEXT DEFAULT NULL;

-- ── 2. Comentário de domínio ──────────────────────────────────────────────────
COMMENT ON COLUMN public.leads.cnpj IS
  'CNPJ ou CPF do cliente — obrigatório para envio da ficha Conta Azul';

-- ── 3. Índice para busca futura ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_cnpj ON public.leads (cnpj)
  WHERE cnpj IS NOT NULL;

-- ── 4. Verificação ───────────────────────────────────────────────────────────
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'leads'
   AND column_name  = 'cnpj';

-- ============================================================
-- FIM DO PATCH v36
-- EXECUTE NO SUPABASE: SQL Editor → New Query → Run
-- ============================================================
