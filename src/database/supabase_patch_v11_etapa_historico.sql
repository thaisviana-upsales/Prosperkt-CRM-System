/**
 * PROSPEKT CRM — Patch v11: lead_etapa_historico
 * Garante estrutura correta da tabela de histórico de etapas para o Funil de Conversão.
 *
 * SEGURO: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS
 * Não usa DROP, DELETE ou TRUNCATE.
 *
 * Execute no Supabase SQL Editor se a tabela ainda não existir.
 */

-- 1. Cria tabela de histórico de passagem por etapas (idempotente)
CREATE TABLE IF NOT EXISTS lead_etapa_historico (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id        TEXT        NOT NULL,
  etapa_id       TEXT        NOT NULL,
  funil_id       TEXT,
  pipeline_id    TEXT,
  responsavel_id TEXT,
  entrou_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origem         TEXT        DEFAULT 'manual',
  UNIQUE (lead_id, etapa_id)
);

-- 2. Índices para performance
CREATE INDEX IF NOT EXISTS idx_leh_lead_id     ON lead_etapa_historico (lead_id);
CREATE INDEX IF NOT EXISTS idx_leh_etapa_id    ON lead_etapa_historico (etapa_id);
CREATE INDEX IF NOT EXISTS idx_leh_funil_id    ON lead_etapa_historico (funil_id);
CREATE INDEX IF NOT EXISTS idx_leh_entrou_em   ON lead_etapa_historico (entrou_em);

-- 3. Backfill: registra etapa atual de todos os leads que ainda não têm registro
-- (idempotente — ON CONFLICT DO NOTHING)
INSERT INTO lead_etapa_historico
  (id, lead_id, etapa_id, funil_id, responsavel_id, entrou_em, criado_em, origem)
SELECT
  gen_random_uuid()::text,
  l.id,
  l.etapa_id,
  l.funil_id,
  l.responsavel_id,
  COALESCE(l.etapa_atualizada_em, l.atualizado_em, l.criado_em, NOW()),
  NOW(),
  'migration_etapa_atual'
FROM leads l
WHERE l.etapa_id IS NOT NULL
ON CONFLICT (lead_id, etapa_id) DO NOTHING;

-- 4. Backfill: registra a PRIMEIRA etapa de cada pipeline para todos os leads
-- Garante que Lead Recebido = total_leads no Funil de Conversão (sem filtro de data)
INSERT INTO lead_etapa_historico
  (id, lead_id, etapa_id, funil_id, pipeline_id, responsavel_id, entrou_em, criado_em, origem)
SELECT
  gen_random_uuid()::text,
  l.id,
  e_first.id       AS etapa_id,
  l.funil_id,
  p.id             AS pipeline_id,
  l.responsavel_id,
  COALESCE(l.criado_em, NOW()) AS entrou_em,
  NOW()            AS criado_em,
  'migration_backfill_primeira_etapa'
FROM leads l
JOIN pipelines p
  ON p.funil_id = l.funil_id
JOIN LATERAL (
  SELECT e.id
  FROM etapas e
  WHERE e.pipeline_id = p.id
  ORDER BY e.ordem ASC
  LIMIT 1
) e_first ON TRUE
WHERE l.funil_id IS NOT NULL
ON CONFLICT (lead_id, etapa_id) DO NOTHING;

-- Fim do Patch v11
