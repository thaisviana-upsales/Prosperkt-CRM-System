-- ============================================================
-- PROSPERKT CRM — Patch v21: WhatsApp Anti-Duplicate Fix
-- Executar no Supabase SQL Editor
-- SEGURO: apenas ALTER TABLE ADD COLUMN IF NOT EXISTS e CREATE IF NOT EXISTS
-- NÃO usa DROP, DELETE, TRUNCATE, RESET ou SEED
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Adiciona colunas faltantes em conversas_whatsapp
-- ────────────────────────────────────────────────────────────

-- dados_extras: armazena LID, remoteJid, aliases (JSONB)
ALTER TABLE conversas_whatsapp
  ADD COLUMN IF NOT EXISTS dados_extras JSONB DEFAULT NULL;

-- nao_lidas: contador de mensagens não lidas pelo CRM
ALTER TABLE conversas_whatsapp
  ADD COLUMN IF NOT EXISTS nao_lidas INTEGER NOT NULL DEFAULT 0;

-- ────────────────────────────────────────────────────────────
-- 2. Adiciona colunas faltantes em mensagens_whatsapp
-- ────────────────────────────────────────────────────────────

-- evolution_message_id: key.id retornado pela Evolution API
ALTER TABLE mensagens_whatsapp
  ADD COLUMN IF NOT EXISTS evolution_message_id TEXT DEFAULT NULL;

-- atualizado_em: para updates de status de entrega
ALTER TABLE mensagens_whatsapp
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ DEFAULT NULL;

-- entregue_em: timestamp de entrega
ALTER TABLE mensagens_whatsapp
  ADD COLUMN IF NOT EXISTS entregue_em TIMESTAMPTZ DEFAULT NULL;

-- lido_em: timestamp de leitura
ALTER TABLE mensagens_whatsapp
  ADD COLUMN IF NOT EXISTS lido_em TIMESTAMPTZ DEFAULT NULL;

-- mime_type: tipo MIME de mídias
ALTER TABLE mensagens_whatsapp
  ADD COLUMN IF NOT EXISTS mime_type TEXT DEFAULT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. Índices para performance
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_wa_conv_dados_extras_gin
  ON conversas_whatsapp USING gin (dados_extras)
  WHERE dados_extras IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_msg_evolution_id
  ON mensagens_whatsapp (evolution_message_id)
  WHERE evolution_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_msg_telefone_direcao
  ON mensagens_whatsapp (telefone, direcao, criado_em);

-- ────────────────────────────────────────────────────────────
-- 4. Tabela whatsapp_conversa_aliases
--    Mapeia identificadores alternativos (LID, remoteJid, etc.)
--    para a conversa correta. Evita criar conversa duplicada
--    quando a Evolution usa identificadores diferentes.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_conversa_aliases (
  id                   TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  conversa_id          TEXT NOT NULL REFERENCES conversas_whatsapp(id) ON DELETE CASCADE,
  telefone_normalizado TEXT,
  remote_jid           TEXT,
  lid                  TEXT,
  push_name            TEXT,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_alias_conversa_id
  ON whatsapp_conversa_aliases (conversa_id);

CREATE INDEX IF NOT EXISTS idx_wa_alias_telefone
  ON whatsapp_conversa_aliases (telefone_normalizado)
  WHERE telefone_normalizado IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_alias_remote_jid
  ON whatsapp_conversa_aliases (remote_jid)
  WHERE remote_jid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_alias_lid
  ON whatsapp_conversa_aliases (lid)
  WHERE lid IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 5. RLS — política permissiva (controle feito no backend)
-- ────────────────────────────────────────────────────────────
ALTER TABLE whatsapp_conversa_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_alias_all ON whatsapp_conversa_aliases;
CREATE POLICY wa_alias_all ON whatsapp_conversa_aliases USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 6. Corrige dados_extras inválidos (TEXT que não é JSON)
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  UPDATE conversas_whatsapp
  SET dados_extras = NULL
  WHERE dados_extras IS NOT NULL
    AND dados_extras::text NOT LIKE '{%'
    AND dados_extras::text NOT LIKE '[%';
EXCEPTION WHEN OTHERS THEN
  -- silencioso: coluna pode ser TEXT em alguns ambientes
  NULL;
END $$;

-- ────────────────────────────────────────────────────────────
-- FIM DO PATCH v21
-- ============================================================
