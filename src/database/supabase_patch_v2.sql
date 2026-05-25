-- ============================================================================
-- PROSPERKT CRM — Patch de migração Supabase v2
-- Execute este script no SQL Editor do Supabase Dashboard:
-- https://supabase.com/dashboard/project/wtuhaoyqojzelaqteclx/sql/new
-- ============================================================================

-- Garante que etapas têm is_ganho e is_perdido
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS is_ganho    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS is_perdido  INTEGER NOT NULL DEFAULT 0;

-- Garante colunas de leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS funil_id       TEXT REFERENCES funis(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS observacoes    TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS motivo_perda   TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ganho_em       TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS perdido_em     TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS perdido_motivo TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS data_fechamento DATE;

-- Garante colunas de mensagens (histórico)
ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS conteudo TEXT;
-- Sincroniza conteudo com texto para compatibilidade
UPDATE mensagens SET conteudo = texto WHERE conteudo IS NULL AND texto IS NOT NULL;

-- Índices adicionais
CREATE INDEX IF NOT EXISTS idx_leads_funil       ON leads(funil_id);
CREATE INDEX IF NOT EXISTS idx_etapas_is_ganho   ON etapas(is_ganho);
CREATE INDEX IF NOT EXISTS idx_etapas_is_perdido ON etapas(is_perdido);

-- Marca etapas de Ganho como is_ganho=1
UPDATE etapas SET is_ganho = 1
WHERE LOWER(nome) IN ('vendas','ganho','venda','won','sale','sales','fechado','venda realizada')
   OR probabilidade >= 100;

-- Marca etapas de Perda como is_perdido=1
UPDATE etapas SET is_perdido = 1
WHERE LOWER(nome) LIKE '%perdid%'
   OR LOWER(nome) LIKE '%desqualif%'
   OR LOWER(nome) LIKE '%lost%'
   OR probabilidade = 0;

-- ============================================================================
-- TABELA: motivos_perda (lista configurável)
-- ============================================================================
CREATE TABLE IF NOT EXISTS motivos_perda (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  nome        TEXT NOT NULL,
  ativo       INTEGER NOT NULL DEFAULT 1,
  ordem       INTEGER DEFAULT 0,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE motivos_perda DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_motivos_perda_ativo ON motivos_perda(ativo, ordem);

-- Popula motivos padrão (UPSERT seguro — não duplica)
INSERT INTO motivos_perda (id, nome, ordem) VALUES
  ('mp-sem-orcamento',         'Sem orçamento no momento',    1),
  ('mp-nao-respondeu',         'Não respondeu',               2),
  ('mp-concorrente',           'Comprou com concorrente',     3),
  ('mp-preco',                 'Preço fora da expectativa',   4),
  ('mp-sem-perfil',            'Sem perfil',                  5),
  ('mp-duplicado',             'Lead duplicado',              6),
  ('mp-sem-interesse',         'Não tem interesse',           7),
  ('mp-prazo',                 'Prazo incompatível',          8),
  ('mp-outro',                 'Outro',                       9)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- TABELA: logs (auditoria Supabase)
-- ============================================================================
CREATE TABLE IF NOT EXISTS logs (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  usuario_id  TEXT REFERENCES usuarios(id),
  acao        TEXT NOT NULL,
  entidade    TEXT,
  entidade_id TEXT,
  antes       JSONB,
  depois      JSONB,
  ip          TEXT,
  user_agent  TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE logs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_logs_usuario    ON logs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_logs_entidade   ON logs(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_logs_criado_em  ON logs(criado_em);

SELECT 'Patch v2 aplicado com sucesso!' as resultado;
