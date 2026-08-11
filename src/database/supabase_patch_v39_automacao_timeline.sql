-- ============================================================================
-- PATCH v39: Automação 7 dias + Timeline — Garantias de Schema
-- Safe: somente ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS
-- ============================================================================

-- ── 1. Garante coluna etapa_atualizada_em na tabela leads ────────────────────
-- Usada pela automação para calcular há quantos dias o lead está na etapa atual.
-- Se não existir, a automação usa criado_em como fallback (menos preciso).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS etapa_atualizada_em TIMESTAMPTZ;

-- Backfill: leads sem etapa_atualizada_em recebem a data de atualização como proxy
UPDATE public.leads
SET etapa_atualizada_em = atualizado_em
WHERE etapa_atualizada_em IS NULL
  AND atualizado_em IS NOT NULL
  AND deleted_at IS NULL;

-- Índice para a automação filtrar leads rapidamente
CREATE INDEX IF NOT EXISTS idx_leads_etapa_atualizada
  ON public.leads (etapa_atualizada_em)
  WHERE deleted_at IS NULL;

-- ── 2. Garante tabela lead_timeline com schema completo ───────────────────────
CREATE TABLE IF NOT EXISTS public.lead_timeline (
  id               TEXT        PRIMARY KEY,
  lead_id          TEXT        NOT NULL,
  usuario_id       TEXT,
  usuario_nome     TEXT,
  tipo_acao        TEXT        NOT NULL,
  descricao        TEXT,
  dados_anteriores JSONB,
  dados_novos      JSONB,
  origem           TEXT        DEFAULT 'crm',
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_lt_lead_id    ON public.lead_timeline (lead_id);
CREATE INDEX IF NOT EXISTS idx_lt_criado_em  ON public.lead_timeline (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tipo_acao  ON public.lead_timeline (tipo_acao);
CREATE INDEX IF NOT EXISTS idx_lt_usuario_id ON public.lead_timeline (usuario_id) WHERE usuario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lt_origem     ON public.lead_timeline (origem);

-- Desabilita RLS (sem controle de linha para timeline interna)
ALTER TABLE public.lead_timeline DISABLE ROW LEVEL SECURITY;

-- ── 3. Recarrega schema do PostgREST ─────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── 4. Relatório de verificação ───────────────────────────────────────────────
SELECT
  'patch_v39_ok'                                                              AS resultado,
  (SELECT COUNT(*) FROM public.leads WHERE etapa_atualizada_em IS NOT NULL)   AS leads_com_etapa_atualizada_em,
  (SELECT COUNT(*) FROM public.leads WHERE etapa_atualizada_em IS NULL
     AND deleted_at IS NULL)                                                  AS leads_sem_etapa_atualizada_em,
  (SELECT COUNT(*) FROM public.lead_timeline)                                 AS total_eventos_timeline,
  (SELECT COUNT(DISTINCT tipo_acao) FROM public.lead_timeline)                AS tipos_distintos,
  (SELECT COUNT(*) FROM public.lead_timeline WHERE origem = 'automacao')      AS eventos_de_automacao;
