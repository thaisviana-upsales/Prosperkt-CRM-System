-- ============================================================
-- MIGRATION: lead_etapa_historico — Funil de Conversão correto
-- PROSPEKT CRM
--
-- Execute este script no painel Supabase:
-- Dashboard → SQL Editor → New Query → Cole e Execute
--
-- IDEMPOTENTE: pode ser executado múltiplas vezes sem risco
-- ============================================================

-- 1. Criar tabela
CREATE TABLE IF NOT EXISTS lead_etapa_historico (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id        TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  etapa_id       TEXT NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  funil_id       TEXT REFERENCES funis(id),
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

-- 3. Row Level Security (RLS) — desabilita para esta tabela (lida pelo backend com service role)
ALTER TABLE lead_etapa_historico DISABLE ROW LEVEL SECURITY;

-- 4. Migration de dados existentes (leads já na plataforma)
--    Registra a etapa ATUAL de cada lead como "etapa já alcançada"
--    UNIQUE constraint garante que não duplica
INSERT INTO lead_etapa_historico (id, lead_id, etapa_id, funil_id, responsavel_id, entrou_em, criado_em, origem)
SELECT
  gen_random_uuid()::text,
  l.id,
  l.etapa_id,
  l.funil_id,
  l.responsavel_id,
  COALESCE(l.etapa_atualizada_em, l.criado_em, NOW()),
  NOW(),
  'migration'
FROM leads l
WHERE l.etapa_id IS NOT NULL
ON CONFLICT (lead_id, etapa_id) DO NOTHING;

-- 5. Verificação: contar registros
SELECT 
  COUNT(*) as total_registros,
  COUNT(DISTINCT lead_id) as leads_unicos,
  COUNT(DISTINCT etapa_id) as etapas_unicas
FROM lead_etapa_historico;

-- ============================================================
-- Resultado esperado:
-- total_registros: um número próximo ao total de leads ativos
-- leads_unicos: igual ao total de leads com etapa_id
-- etapas_unicas: número de etapas distintas nos leads
-- ============================================================
