-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPEKT CRM — Patch v29
-- Objetivo: adicionar campo responsavel_id em atividades + status em_andamento
-- SEGURO: ADD COLUMN IF NOT EXISTS — sem DROP, DELETE, TRUNCATE
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Campo responsavel_id (quem deve executar a atividade)
ALTER TABLE public.atividades
  ADD COLUMN IF NOT EXISTS responsavel_id TEXT REFERENCES public.usuarios(id) ON DELETE SET NULL;

-- 2. Índice para busca rápida por responsável
CREATE INDEX IF NOT EXISTS idx_atividades_responsavel
  ON public.atividades(responsavel_id)
  WHERE responsavel_id IS NOT NULL;

-- 3. Notifica PostgREST para recarregar schema cache
NOTIFY pgrst, 'reload schema';

-- Verificação
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'atividades'
  AND column_name  IN ('responsavel_id', 'status', 'usuario_id')
ORDER BY column_name;
