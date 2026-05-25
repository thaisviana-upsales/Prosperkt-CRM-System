-- ============================================================
-- PROSPERKT CRM — Patch v4: Colunas para Dashboard
-- Executar manualmente no Supabase SQL Editor
-- SEGURO: usa ADD COLUMN IF NOT EXISTS
-- ============================================================

-- Garante que perdido_em existe (ganho_em já foi criado no patch v3)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS perdido_em      TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS perdido_motivo  TEXT;

-- Índices para queries do dashboard (opcionais, melhoram performance)
CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_ganho_em    ON leads (ganho_em);
CREATE INDEX IF NOT EXISTS idx_leads_perdido_em  ON leads (perdido_em);
CREATE INDEX IF NOT EXISTS idx_leads_criado_em   ON leads (criado_em);
CREATE INDEX IF NOT EXISTS idx_leads_funil_id    ON leads (funil_id);
CREATE INDEX IF NOT EXISTS idx_leads_etapa_id    ON leads (etapa_id);

-- ============================================================
-- FIM DO PATCH v4
-- ============================================================
