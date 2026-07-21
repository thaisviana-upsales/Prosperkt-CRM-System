-- ============================================================
-- PROSPERKT CRM — Patch v16: Timeline Completa do Lead
-- Execute no Supabase SQL Editor ANTES do deploy.
-- SEGURO: ADD COLUMN IF NOT EXISTS — sem DROP/DELETE/TRUNCATE.
-- ============================================================

-- ── 1. Corrigir tabela logs: garantir colunas necessárias ────────────────────
-- (a tabela já existe mas pode ter colunas faltando)
ALTER TABLE public.logs ADD COLUMN IF NOT EXISTS usuario_nome  TEXT;
ALTER TABLE public.logs ADD COLUMN IF NOT EXISTS usuario_role  TEXT;
ALTER TABLE public.logs ADD COLUMN IF NOT EXISTS descricao     TEXT;
ALTER TABLE public.logs ADD COLUMN IF NOT EXISTS ip_address    TEXT;
ALTER TABLE public.logs ADD COLUMN IF NOT EXISTS user_agent    TEXT;

-- Índices para performance na busca por lead
CREATE INDEX IF NOT EXISTS idx_logs_entidade_id   ON public.logs (entidade_id);
CREATE INDEX IF NOT EXISTS idx_logs_entidade      ON public.logs (entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_logs_usuario_id    ON public.logs (usuario_id);
CREATE INDEX IF NOT EXISTS idx_logs_criado_em     ON public.logs (criado_em);
CREATE INDEX IF NOT EXISTS idx_logs_acao          ON public.logs (acao);

-- ── 2. Tabela lead_timeline (eventos ricos com antes/depois) ─────────────────
-- Esta tabela armazena cada evento da timeline do lead com metadados completos.
-- Complementa a tabela logs para eventos que precisam de mais detalhe.
CREATE TABLE IF NOT EXISTS public.lead_timeline (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id         TEXT NOT NULL,
  usuario_id      TEXT,
  usuario_nome    TEXT,
  tipo_acao       TEXT NOT NULL,
  descricao       TEXT NOT NULL,
  dados_anteriores JSONB,
  dados_novos     JSONB,
  origem          TEXT DEFAULT 'crm',
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_lead_id    ON public.lead_timeline (lead_id);
CREATE INDEX IF NOT EXISTS idx_lt_criado_em  ON public.lead_timeline (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tipo_acao  ON public.lead_timeline (tipo_acao);
CREATE INDEX IF NOT EXISTS idx_lt_usuario_id ON public.lead_timeline (usuario_id);

-- ── 3. Backfill de leads existentes (idempotente via origem = 'backfill') ────
-- Registra evento inicial para leads que ainda não têm entrada na lead_timeline.
INSERT INTO public.lead_timeline (id, lead_id, usuario_id, usuario_nome, tipo_acao, descricao, dados_novos, origem, criado_em)
SELECT
  gen_random_uuid()::text,
  l.id,
  l.responsavel_id,
  u.nome,
  'CRIACAO_LEAD',
  'Registro histórico criado para lead existente.',
  jsonb_build_object(
    'nome',   l.nome,
    'etapa',  e.nome,
    'funil',  f.nome,
    'status', l.status
  ),
  'backfill_timeline',
  COALESCE(l.criado_em, NOW())
FROM public.leads l
LEFT JOIN public.usuarios u   ON u.id  = l.responsavel_id
LEFT JOIN public.etapas   e   ON e.id  = l.etapa_id
LEFT JOIN public.funis    f   ON f.id  = l.funil_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_timeline lt
  WHERE lt.lead_id = l.id
    AND lt.origem IN ('backfill_timeline', 'crm', 'sistema')
)
AND l.deleted_at IS NULL;

-- ============================================================
-- FIM DO PATCH v16
-- ============================================================
