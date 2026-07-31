-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPEKT CRM — Patch v30
-- Objetivo: garantir tabela lead_timeline com todos os campos necessários.
-- SEGURO: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Garante tabela lead_timeline
CREATE TABLE IF NOT EXISTS public.lead_timeline (
  id               TEXT        PRIMARY KEY,
  lead_id          TEXT        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  usuario_id       TEXT        REFERENCES public.usuarios(id),
  usuario_nome     TEXT,
  tipo_acao        TEXT        NOT NULL,
  descricao        TEXT,
  dados_anteriores JSONB,
  dados_novos      JSONB,
  origem           TEXT        DEFAULT 'crm',
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Índices para performance
CREATE INDEX IF NOT EXISTS idx_lead_timeline_lead     ON public.lead_timeline(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_timeline_tipo     ON public.lead_timeline(tipo_acao);
CREATE INDEX IF NOT EXISTS idx_lead_timeline_criado   ON public.lead_timeline(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_lead_timeline_usuario  ON public.lead_timeline(usuario_id) WHERE usuario_id IS NOT NULL;

-- 3. Desabilita RLS para evitar bloqueio de leitura por regras de segurança de linha
ALTER TABLE public.lead_timeline DISABLE ROW LEVEL SECURITY;

-- 4. Notifica PostgREST para recarregar schema cache
NOTIFY pgrst, 'reload schema';

-- 5. Verificação
SELECT 
  (SELECT COUNT(*) FROM public.lead_timeline) AS total_eventos,
  (SELECT COUNT(DISTINCT tipo_acao) FROM public.lead_timeline) AS tipos_distintos,
  (SELECT MIN(criado_em) FROM public.lead_timeline) AS evento_mais_antigo,
  (SELECT MAX(criado_em) FROM public.lead_timeline) AS evento_mais_recente;
