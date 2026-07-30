-- ============================================================================
-- PATCH v24 (v2 CORRIGIDA): whatsapp_conversa_aliases — garante tabela e índices
-- Corrige: conversas duplicadas ao receber resposta do cliente
-- Safe: usa IF NOT EXISTS — pode rodar múltiplas vezes
-- ============================================================================

-- 1. Cria tabela se não existir
CREATE TABLE IF NOT EXISTS whatsapp_conversa_aliases (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversa_id          TEXT NOT NULL REFERENCES conversas_whatsapp(id) ON DELETE CASCADE,
  telefone_normalizado TEXT,
  remote_jid           TEXT,
  lid                  TEXT,
  push_name            TEXT,
  lead_id              TEXT,
  criado_em            TEXT DEFAULT now()::text,
  atualizado_em        TEXT DEFAULT now()::text
);

-- 2. Índices para busca rápida (Passo 0 do resolver)
CREATE INDEX IF NOT EXISTS idx_wca_conversa_id  ON whatsapp_conversa_aliases(conversa_id);
CREATE INDEX IF NOT EXISTS idx_wca_telefone     ON whatsapp_conversa_aliases(telefone_normalizado);
CREATE INDEX IF NOT EXISTS idx_wca_remote_jid   ON whatsapp_conversa_aliases(remote_jid);
CREATE INDEX IF NOT EXISTS idx_wca_lid          ON whatsapp_conversa_aliases(lid);
CREATE INDEX IF NOT EXISTS idx_wca_lead_id      ON whatsapp_conversa_aliases(lead_id);

-- 3. Retroativamente popula aliases para conversas com telefone real
-- NOTA: não referencia c.lead_id aqui pois o schema pode variar.
-- O lead_id nos aliases será preenchido automaticamente pelo Node nas próximas mensagens.
INSERT INTO whatsapp_conversa_aliases (id, conversa_id, telefone_normalizado, criado_em, atualizado_em)
SELECT
  gen_random_uuid()::text,
  c.id,
  c.telefone,
  now()::text,
  now()::text
FROM conversas_whatsapp c
WHERE c.telefone IS NOT NULL
  AND c.telefone NOT LIKE 'LID:%'
  AND c.telefone ~ '^[0-9]{10,15}$'
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_conversa_aliases a
    WHERE a.conversa_id = c.id AND a.telefone_normalizado = c.telefone
  )
ON CONFLICT DO NOTHING;

-- Confirma resultado
SELECT 'patch_v24_ok' AS resultado, count(*) AS total_aliases FROM whatsapp_conversa_aliases;
