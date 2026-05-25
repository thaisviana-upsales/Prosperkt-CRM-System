-- ============================================================
-- PROSPERKT CRM — Patch v7: whatsapp_mensagens (Supabase)
-- Executar no Supabase SQL Editor
-- SEGURO: somente CREATE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
-- NÃO usa DROP, DELETE, TRUNCATE, RESET ou SEED
-- NÃO altera tabela mensagens antiga
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tabela whatsapp_mensagens
--    Armazena mensagens trocadas via WhatsApp Light.
--    Independente das tabelas legadas mensagens_whatsapp /
--    conversas_whatsapp (que permanecem intactas no SQLite).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_mensagens (
  id                    TEXT          PRIMARY KEY,
  lead_id               TEXT          REFERENCES leads(id) ON DELETE SET NULL,
  telefone              TEXT          NOT NULL,
  nome_contato          TEXT,
  direcao               TEXT          NOT NULL CHECK (direcao IN ('recebida','enviada')),
  tipo                  TEXT          NOT NULL DEFAULT 'texto'
                                      CHECK (tipo IN ('texto','audio','imagem','video','documento','sticker','localizacao','contato')),
  conteudo              TEXT,
  midia_url             TEXT,
  arquivo_nome          TEXT,
  mime_type             TEXT,
  whatsapp_message_id   TEXT,
  status_envio          TEXT          NOT NULL DEFAULT 'pendente'
                                      CHECK (status_envio IN ('pendente','enviado','entregue','lido','erro','recebido')),
  erro_envio            TEXT,
  enviado_por           TEXT          REFERENCES usuarios(id) ON DELETE SET NULL,
  recebido_em           TIMESTAMPTZ,
  enviado_em            TIMESTAMPTZ,
  criado_em             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

-- ────────────────────────────────────────────────────────────
-- 2. Índices de performance
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wamsg_telefone      ON whatsapp_mensagens (telefone);
CREATE INDEX IF NOT EXISTS idx_wamsg_lead_id       ON whatsapp_mensagens (lead_id);
CREATE INDEX IF NOT EXISTS idx_wamsg_criado_em     ON whatsapp_mensagens (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_wamsg_message_id    ON whatsapp_mensagens (whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wamsg_status        ON whatsapp_mensagens (status_envio);
CREATE INDEX IF NOT EXISTS idx_wamsg_ativos        ON whatsapp_mensagens (lead_id, criado_em) WHERE deleted_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 3. RLS — política permissiva (controle feito no backend)
-- ────────────────────────────────────────────────────────────
ALTER TABLE whatsapp_mensagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wamsg_all ON whatsapp_mensagens;
CREATE POLICY wamsg_all ON whatsapp_mensagens USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- FIM DO PATCH v7
-- ============================================================
