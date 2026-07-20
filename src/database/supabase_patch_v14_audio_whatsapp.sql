-- ============================================================
-- PROSPERKT CRM — Patch v14: Suporte a Áudio no WhatsApp
-- Execute no Supabase SQL Editor ANTES do deploy.
-- SEGURO: ADD COLUMN IF NOT EXISTS — sem DROP/DELETE/TRUNCATE.
-- ============================================================

-- Colunas adicionais na tabela mensagens_whatsapp
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS mime_type              TEXT;
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS media_duration         INTEGER;
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS evolution_message_id   TEXT;
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS atualizado_em          TIMESTAMPTZ;
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS entregue_em            TIMESTAMPTZ;
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS lido_em                TIMESTAMPTZ;

-- Índice para busca por evolution_message_id (dedup e status update)
CREATE INDEX IF NOT EXISTS idx_mensagens_whatsapp_evo_msg_id
  ON public.mensagens_whatsapp (evolution_message_id)
  WHERE evolution_message_id IS NOT NULL;

-- ============================================================
-- FIM DO PATCH v14
-- ============================================================
