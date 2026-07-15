-- ============================================================
-- MIGRATION: lead_etapa_historico — Funil de Conversão
-- PROSPEKT CRM
--
-- ⚡ EXECUTE ESTE SQL NO SUPABASE:
-- https://supabase.com/dashboard/project/wtuhaoyqojzelaqteclx/sql/new
--
-- IDEMPOTENTE: pode ser executado múltiplas vezes sem risco.
-- Não apaga dados existentes.
-- ============================================================

-- 1. Criar tabela
CREATE TABLE IF NOT EXISTS lead_etapa_historico (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id        TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  etapa_id       TEXT NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  funil_id       TEXT REFERENCES funis(id),
  pipeline_id    TEXT REFERENCES pipelines(id),
  responsavel_id TEXT REFERENCES usuarios(id),
  entrou_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origem         TEXT DEFAULT 'manual',
  UNIQUE(lead_id, etapa_id)
);

-- 2. Índices para performance
CREATE INDEX IF NOT EXISTS idx_leh_lead      ON lead_etapa_historico(lead_id);
CREATE INDEX IF NOT EXISTS idx_leh_etapa     ON lead_etapa_historico(etapa_id);
CREATE INDEX IF NOT EXISTS idx_leh_funil     ON lead_etapa_historico(funil_id);
CREATE INDEX IF NOT EXISTS idx_leh_resp      ON lead_etapa_historico(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_leh_entrou_em ON lead_etapa_historico(entrou_em);

-- 3. Desabilitar RLS (lida pelo backend com service role)
ALTER TABLE lead_etapa_historico DISABLE ROW LEVEL SECURITY;

-- 4a. Backfill: etapa ATUAL de cada lead
INSERT INTO lead_etapa_historico
  (id, lead_id, etapa_id, funil_id, pipeline_id, responsavel_id, entrou_em, criado_em, origem)
SELECT
  gen_random_uuid()::text,
  l.id,
  l.etapa_id,
  l.funil_id,
  l.pipeline_id,
  l.responsavel_id,
  COALESCE(l.atualizado_em, l.criado_em, NOW()),
  NOW(),
  'migration_etapa_atual'
FROM leads l
WHERE l.etapa_id IS NOT NULL
  AND l.deleted_at IS NULL
ON CONFLICT (lead_id, etapa_id) DO NOTHING;

-- 4b. Backfill: PRIMEIRA ETAPA da pipeline de cada lead
--     Garante que "Lead Recebido" apareça mesmo que o lead já tenha avançado
INSERT INTO lead_etapa_historico
  (id, lead_id, etapa_id, funil_id, pipeline_id, responsavel_id, entrou_em, criado_em, origem)
SELECT
  gen_random_uuid()::text,
  l.id,
  e_first.id,
  l.funil_id,
  l.pipeline_id,
  l.responsavel_id,
  COALESCE(l.criado_em, NOW()),
  NOW(),
  'migration_primeira_etapa'
FROM leads l
JOIN pipelines p ON p.id = l.pipeline_id
JOIN LATERAL (
  SELECT id FROM etapas
  WHERE pipeline_id = p.id
  ORDER BY ordem ASC
  LIMIT 1
) e_first ON TRUE
WHERE l.pipeline_id IS NOT NULL
  AND l.deleted_at IS NULL
ON CONFLICT (lead_id, etapa_id) DO NOTHING;

-- 5. Verificação: mostra o resultado
SELECT
  COUNT(*)                                                          AS total_registros,
  COUNT(DISTINCT lead_id)                                           AS leads_unicos,
  COUNT(DISTINCT etapa_id)                                          AS etapas_unicas,
  COUNT(*) FILTER (WHERE origem = 'migration_etapa_atual')          AS backfill_etapa_atual,
  COUNT(*) FILTER (WHERE origem = 'migration_primeira_etapa')       AS backfill_primeira_etapa
FROM lead_etapa_historico;

-- ============================================================
-- RESULTADO ESPERADO após execução:
--   total_registros ≥ leads_unicos  (pelo menos 1 por lead)
--   leads_unicos ≈ total de leads ativos no CRM
--   backfill_etapa_atual ≈ leads com etapa_id preenchida
--   backfill_primeira_etapa ≈ leads com pipeline_id preenchida
-- ============================================================
