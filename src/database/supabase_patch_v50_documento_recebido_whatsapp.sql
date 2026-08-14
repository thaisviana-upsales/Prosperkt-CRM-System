-- =============================================================================
-- PROSPEKT CRM — Patch v50: Recebimento de documentos/arquivos via WhatsApp
-- Data: 2026-08-14
-- CAUSA RAIZ: tipo='documento' não estava na CHECK constraint de mensagens_whatsapp
--             → INSERT falhava → mensagem nunca salva → nunca aparecia no CRM
-- SEGURO: sem DROP, TRUNCATE ou DELETE. Apenas ADD COLUMN IF NOT EXISTS + CONSTRAINT.
-- Execute no Supabase SQL Editor antes do próximo deploy.
-- =============================================================================

-- ============================================================
-- 1. Garante colunas necessárias em mensagens_whatsapp
-- ============================================================

-- Colunas para mídia recebida
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS mime_type            TEXT;
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS evolution_message_id TEXT;
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS storage_bucket       TEXT;
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS storage_path         TEXT;

-- ============================================================
-- 2. Corrige CHECK constraint do campo tipo
--    PROBLEMA: 'documento' estava faltando na lista permitida
--    SOLUÇÃO: Drop + re-create com lista completa
-- ============================================================

-- Remove constraint antiga (se existir com nome padrão Postgres)
ALTER TABLE public.mensagens_whatsapp DROP CONSTRAINT IF EXISTS mensagens_whatsapp_tipo_check;

-- Adiciona com lista completa — inclui todos os tipos que o parser pode gerar:
--   texto, audio, imagem, video, arquivo, documento, sticker, localizacao, contato, sistema
ALTER TABLE public.mensagens_whatsapp
  ADD CONSTRAINT mensagens_whatsapp_tipo_check
  CHECK (tipo IN ('texto','audio','imagem','video','arquivo','documento','sticker','localizacao','contato','sistema'));

-- ============================================================
-- 3. Índices para performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_wa_msg_tipo            ON public.mensagens_whatsapp (tipo);
CREATE INDEX IF NOT EXISTS idx_wa_msg_evolution_id    ON public.mensagens_whatsapp (evolution_message_id)
  WHERE evolution_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_msg_arquivo         ON public.mensagens_whatsapp (conversa_id, tipo)
  WHERE tipo IN ('arquivo','documento','imagem','video');

-- ============================================================
-- 4. Reload PostgREST schema para reconhecer novas colunas
-- ============================================================

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 5. Verificação rápida
-- ============================================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'mensagens_whatsapp'
ORDER BY ordinal_position;

-- ============================================================
-- BUCKET: whatsapp-midias
-- Já deve existir para áudio. Documentos podem usar subpasta docs/
-- Não é necessário criar bucket separado.
-- ============================================================
