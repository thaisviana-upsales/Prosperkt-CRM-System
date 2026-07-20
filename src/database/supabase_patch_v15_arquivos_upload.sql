-- ============================================================
-- PROSPERKT CRM — Patch v15: Upload/Download de Arquivos
-- Execute no Supabase SQL Editor ANTES do deploy.
-- SEGURO: CREATE/ADD IF NOT EXISTS — sem DROP/DELETE/TRUNCATE.
-- ============================================================

-- ── 1. lead_arquivos: garantir colunas extras ─────────────────
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS conversa_id    TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS mensagem_id    TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS descricao      TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS publico        BOOLEAN DEFAULT false;

-- ── 2. Tabela de anexos de mensagens WhatsApp ─────────────────
-- (arquivos recebidos/enviados no chat — separada de lead_arquivos
--  para não poluir o contexto do lead com cada mensagem de mídia)
CREATE TABLE IF NOT EXISTS public.mensagens_whatsapp_arquivos (
  id               TEXT PRIMARY KEY,
  mensagem_id      TEXT,              -- FK mensagens_whatsapp.id
  conversa_id      TEXT NOT NULL,
  lead_id          TEXT,
  usuario_id       TEXT,              -- NULL se recebido do cliente
  nome_original    TEXT NOT NULL,
  nome_armazenado  TEXT,
  mime_type        TEXT,
  tamanho_bytes    BIGINT,
  storage_path     TEXT,
  public_url       TEXT,
  origem           TEXT DEFAULT 'whatsapp_recebido',
  -- origem: whatsapp_recebido | whatsapp_enviado
  criado_em        TIMESTAMPTZ DEFAULT NOW()
);

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_mwa_conversa_id ON public.mensagens_whatsapp_arquivos (conversa_id);
CREATE INDEX IF NOT EXISTS idx_mwa_mensagem_id ON public.mensagens_whatsapp_arquivos (mensagem_id)
  WHERE mensagem_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mwa_lead_id     ON public.mensagens_whatsapp_arquivos (lead_id)
  WHERE lead_id IS NOT NULL;

-- ── 3. Bucket no Supabase Storage ────────────────────────────
-- O bucket 'whatsapp-arquivos' deve ser criado manualmente no
-- Supabase Dashboard > Storage > New bucket
-- Nome: whatsapp-arquivos  | Público: SIM (ou privado + policy)
-- O bucket 'lead-arquivos' já deve existir (criado pelo controller).

-- ============================================================
-- FIM DO PATCH v15
-- ============================================================
