-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPEKT CRM — Patch v32
-- Objetivo: colunas de rastreamento SDR em leads para métricas do painel SDR
-- SEGURO: sem DROP TABLE, sem DELETE, sem TRUNCATE — idempotente
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colunas de rastreamento da qualificação SDR em leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lead_qualificado_sdr_em  TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lead_qualificado_sdr_por  TEXT; -- usuario_id do SDR que qualificou
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS vendedor_destino_id       TEXT; -- usuario_id do vendedor destino
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS sdr_id                    TEXT; -- usuario_id do SDR responsável

-- 2. Índices para performance nas queries do painel SDR
CREATE INDEX IF NOT EXISTS idx_leads_sdr_id              ON public.leads(sdr_id)              WHERE sdr_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_vendedor_destino    ON public.leads(vendedor_destino_id)  WHERE vendedor_destino_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_qualificado_sdr_em  ON public.leads(lead_qualificado_sdr_em) WHERE lead_qualificado_sdr_em IS NOT NULL;

-- 3. Backfill: marca sdr_id nos leads cujo responsavel é SDR
UPDATE public.leads l
SET    sdr_id = l.responsavel_id
WHERE  l.sdr_id IS NULL
  AND  EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = l.responsavel_id
      AND u.role = 'SDR'
  );

-- 4. Backfill: para leads já em "Lead Qualificado SDR" sem timestamp,
--    usa etapa_atualizada_em ou atualizado_em como data estimada
UPDATE public.leads l
SET    lead_qualificado_sdr_em  = COALESCE(l.etapa_atualizada_em, l.atualizado_em),
       lead_qualificado_sdr_por = l.responsavel_id
WHERE  l.lead_qualificado_sdr_em IS NULL
  AND  EXISTS (
    SELECT 1 FROM public.etapas e
    WHERE e.id = l.etapa_id
      AND e.nome ILIKE '%Lead Qualificado SDR%'
  );

-- 5. Verifica resultado
SELECT
  COUNT(*)                    AS total_leads,
  COUNT(sdr_id)               AS com_sdr_id,
  COUNT(lead_qualificado_sdr_em) AS com_data_qualificacao,
  COUNT(vendedor_destino_id)  AS com_vendedor_destino
FROM public.leads;

-- 6. Confirma colunas criadas
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'leads'
  AND column_name IN ('lead_qualificado_sdr_em', 'lead_qualificado_sdr_por', 'vendedor_destino_id', 'sdr_id')
ORDER BY column_name;
