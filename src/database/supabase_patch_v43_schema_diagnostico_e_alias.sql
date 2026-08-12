-- =============================================================================
-- PROSPEKT CRM — Patch v43: Garantia de Schema Real WhatsApp
-- Garante que todas as tabelas e colunas usadas pelo webhook existem.
-- Cria whatsapp_conversa_aliases se não existir.
-- Popula aliases retroativos para conversas com telefone real.
--
-- EXECUTAR OBRIGATORIAMENTE antes de testar recebimento de mensagens.
-- Seguro: IF NOT EXISTS — pode executar múltiplas vezes.
-- =============================================================================

-- ── 1. Diagnóstico de tabelas existentes ─────────────────────────────────────
SELECT
  table_name,
  'EXISTS' AS situacao
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'conversas_whatsapp',
    'mensagens_whatsapp',
    'whatsapp_conversa_aliases',
    'whatsapp_mensagens',
    'leads'
  )
ORDER BY table_name;

-- ── 2. Diagnóstico de colunas de conversas_whatsapp ─────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'conversas_whatsapp'
ORDER BY ordinal_position;

-- ── 3. Garante tabela whatsapp_conversa_aliases ───────────────────────────────
-- Esta é a tabela usada pelo runtime do webhook para resolver LIDs para conversas.
CREATE TABLE IF NOT EXISTS whatsapp_conversa_aliases (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversa_id          TEXT NOT NULL REFERENCES conversas_whatsapp(id) ON DELETE CASCADE,
  telefone_normalizado TEXT,
  remote_jid           TEXT,
  lid                  TEXT,
  push_name            TEXT,
  lead_id              TEXT,
  criado_em            TIMESTAMPTZ DEFAULT now(),
  atualizado_em        TIMESTAMPTZ DEFAULT now()
);

-- ── 4. Índices obrigatórios ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wca_conversa_id  ON whatsapp_conversa_aliases(conversa_id);
CREATE INDEX IF NOT EXISTS idx_wca_telefone     ON whatsapp_conversa_aliases(telefone_normalizado);
CREATE INDEX IF NOT EXISTS idx_wca_remote_jid   ON whatsapp_conversa_aliases(remote_jid);
CREATE INDEX IF NOT EXISTS idx_wca_lid          ON whatsapp_conversa_aliases(lid);
CREATE INDEX IF NOT EXISTS idx_wca_lead_id      ON whatsapp_conversa_aliases(lead_id);

-- ── 5. Garante colunas em conversas_whatsapp ─────────────────────────────────
ALTER TABLE conversas_whatsapp
  ADD COLUMN IF NOT EXISTS visivel      BOOLEAN DEFAULT true;

ALTER TABLE conversas_whatsapp
  ADD COLUMN IF NOT EXISTS dados_extras JSONB DEFAULT '{}'::jsonb;

ALTER TABLE conversas_whatsapp
  ADD COLUMN IF NOT EXISTS nao_lidas    INTEGER DEFAULT 0;

-- ── 6. Popula aliases retroativos ────────────────────────────────────────────
-- Para cada conversa com telefone real, garante que existe um alias por telefone.
-- Isso permite que o resolver encontre a conversa por telefone mesmo sem LID.
INSERT INTO whatsapp_conversa_aliases (
  id, conversa_id, telefone_normalizado, lead_id, criado_em, atualizado_em
)
SELECT
  gen_random_uuid()::text,
  c.id,
  regexp_replace(c.telefone, '\D', '', 'g'),  -- normaliza: só dígitos
  c.lead_id,
  now(),
  now()
FROM conversas_whatsapp c
WHERE c.telefone IS NOT NULL
  AND c.telefone NOT LIKE 'LID:%'
  AND regexp_replace(c.telefone, '\D', '', 'g') ~ '^55[0-9]{10,11}$'  -- só telefones BR reais
  AND c.status NOT IN ('FECHADA', 'PENDENTE_IDENTIFICACAO')
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_conversa_aliases a
    WHERE a.conversa_id = c.id
      AND a.telefone_normalizado = regexp_replace(c.telefone, '\D', '', 'g')
  )
ON CONFLICT DO NOTHING;

-- ── 7. Popula lead_id nos aliases existentes sem lead_id ─────────────────────
UPDATE whatsapp_conversa_aliases a
SET
  lead_id       = c.lead_id,
  atualizado_em = now()
FROM conversas_whatsapp c
WHERE a.conversa_id = c.id
  AND a.lead_id IS NULL
  AND c.lead_id IS NOT NULL;

-- ── 8. Relatório final ───────────────────────────────────────────────────────
SELECT
  'whatsapp_conversa_aliases' AS tabela,
  COUNT(*)                    AS total_aliases,
  COUNT(DISTINCT conversa_id) AS conversas_com_alias,
  COUNT(DISTINCT lead_id)     AS leads_com_alias,
  COUNT(lid)                  AS aliases_com_lid,
  COUNT(remote_jid)           AS aliases_com_remote_jid
FROM whatsapp_conversa_aliases;

SELECT
  'conversas_whatsapp' AS tabela,
  COUNT(*)             AS total,
  COUNT(CASE WHEN status = 'ABERTA'                  THEN 1 END) AS abertas,
  COUNT(CASE WHEN status = 'PENDENTE_IDENTIFICACAO'  THEN 1 END) AS pendentes,
  COUNT(CASE WHEN status = 'FECHADA'                 THEN 1 END) AS fechadas,
  COUNT(CASE WHEN COALESCE(visivel,true) = false     THEN 1 END) AS ocultas
FROM conversas_whatsapp;
