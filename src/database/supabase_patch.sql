-- ============================================================================
-- PROSPERKT CRM — Patch de migração Supabase
-- Execute este script no SQL Editor do Supabase Dashboard:
-- https://supabase.com/dashboard/project/wtuhaoyqojzelaqteclx/sql/new
-- ============================================================================

-- Adiciona is_ganho e is_perdido na tabela etapas (se não existirem)
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS is_ganho INTEGER NOT NULL DEFAULT 0;
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS is_perdido INTEGER NOT NULL DEFAULT 0;

-- Adiciona funil_id na tabela leads (se não existir)
-- No Supabase não há tabela pipelines — funil_id vai direto
ALTER TABLE leads ADD COLUMN IF NOT EXISTS funil_id TEXT REFERENCES funis(id);

-- Adiciona ganho_em / perdido_em / perdido_motivo se não existirem
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ganho_em TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS perdido_em TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS perdido_motivo TEXT;

-- Corrige o CHECK de status: CRM usa 'ativo','ganho','perdido','arquivado'
-- Se a constraint não existir ainda, o DEFAULT 'ativo' já garante o padrão correto.

-- Marca etapas de Vendas como is_ganho=1
UPDATE etapas SET is_ganho = 1
WHERE LOWER(nome) IN ('vendas','ganho','venda','won','sale','sales')
   OR probabilidade >= 100;

-- Marca etapas de Perdido como is_perdido=1
UPDATE etapas SET is_perdido = 1
WHERE LOWER(nome) LIKE '%perdid%'
   OR LOWER(nome) LIKE '%desqualif%'
   OR LOWER(nome) LIKE '%lost%';

-- Índices adicionais
CREATE INDEX IF NOT EXISTS idx_leads_funil ON leads(funil_id);
CREATE INDEX IF NOT EXISTS idx_etapas_is_ganho   ON etapas(is_ganho);
CREATE INDEX IF NOT EXISTS idx_etapas_is_perdido ON etapas(is_perdido);

-- Confirma alterações
SELECT 'Patch aplicado com sucesso!' as resultado;
