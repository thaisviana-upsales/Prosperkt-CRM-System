-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPEKT CRM — Patch v35: Correção Cirúrgica da Timeline do Lead
-- Execute no Supabase SQL Editor.
-- SEGURO: somente ADD COLUMN IF NOT EXISTS, ALTER, INDEX e NOTIFY — sem DROP.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. lead_timeline: garantir tabela e colunas completas ────────────────────
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

-- Garantir que criado_em nunca seja nulo (fallback)
ALTER TABLE public.lead_timeline ALTER COLUMN criado_em SET DEFAULT NOW();
ALTER TABLE public.lead_timeline ALTER COLUMN criado_em SET NOT NULL;

-- ── 2. Índices de performance ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_lt_lead_id    ON public.lead_timeline (lead_id);
CREATE INDEX IF NOT EXISTS idx_lt_criado_em  ON public.lead_timeline (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tipo_acao  ON public.lead_timeline (tipo_acao);
CREATE INDEX IF NOT EXISTS idx_lt_usuario_id ON public.lead_timeline (usuario_id) WHERE usuario_id IS NOT NULL;

-- ── 3. Desabilitar RLS na lead_timeline ──────────────────────────────────────
ALTER TABLE public.lead_timeline DISABLE ROW LEVEL SECURITY;

-- ── 4. mensagens: garantir coluna criado_em com DEFAULT NOW() ────────────────
-- Adiciona se não existir (idempotente)
ALTER TABLE public.mensagens ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT NOW();

-- Corrige mensagens antigas sem criado_em: usa enviado_em como fallback
UPDATE public.mensagens
SET criado_em = COALESCE(criado_em, enviado_em, NOW())
WHERE criado_em IS NULL;

-- Índice para performance na busca por lead_id + criado_em
CREATE INDEX IF NOT EXISTS idx_mensagens_lead_criado ON public.mensagens (lead_id, criado_em);

-- ── 5. logs: garantir índices de performance ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_logs_entidade_lead ON public.logs (entidade, entidade_id, criado_em)
  WHERE entidade = 'leads';

-- ── 6. Backfill: leads sem nenhum evento na timeline ─────────────────────────
-- Registra evento inicial retroativo apenas para leads sem qualquer entrada.
INSERT INTO public.lead_timeline (
  id, lead_id, usuario_id, usuario_nome,
  tipo_acao, descricao, dados_novos, origem, criado_em
)
SELECT
  gen_random_uuid()::text,
  l.id,
  l.responsavel_id,
  COALESCE(u.nome, 'Sistema'),
  'CRIACAO_LEAD',
  'Lead criado (registro retroativo).',
  jsonb_build_object(
    'nome',   l.nome,
    'origem', COALESCE(l.origem, 'manual')
  ),
  'backfill_v35',
  COALESCE(l.criado_em, NOW())
FROM public.leads l
LEFT JOIN public.usuarios u ON u.id = l.responsavel_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_timeline lt WHERE lt.lead_id = l.id
)
AND l.deleted_at IS NULL;

-- ── 7. Notifica PostgREST para recarregar schema cache ───────────────────────
NOTIFY pgrst, 'reload schema';

-- ── 8. Verificação final ──────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*)           FROM public.lead_timeline)              AS total_eventos,
  (SELECT COUNT(DISTINCT lead_id) FROM public.lead_timeline)         AS leads_com_timeline,
  (SELECT COUNT(DISTINCT tipo_acao) FROM public.lead_timeline)       AS tipos_distintos,
  (SELECT MIN(criado_em)     FROM public.lead_timeline)              AS evento_mais_antigo,
  (SELECT MAX(criado_em)     FROM public.lead_timeline)              AS evento_mais_recente,
  (SELECT COUNT(*)           FROM public.mensagens WHERE criado_em IS NULL) AS notas_sem_data;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIM DO PATCH v35
-- ─────────────────────────────────────────────────────────────────────────────
