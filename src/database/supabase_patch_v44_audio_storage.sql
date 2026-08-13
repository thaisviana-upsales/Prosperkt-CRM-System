-- ============================================================
-- PROSPERKT CRM — Patch v44: Suporte a Áudio no Supabase Storage
-- Execute no Supabase SQL Editor ANTES do deploy.
-- SEGURO: ADD/CREATE IF NOT EXISTS — sem DROP, DELETE ou TRUNCATE.
-- ============================================================

-- 1. Colunas de Storage em mensagens_whatsapp
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS storage_bucket        TEXT;
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS storage_path          TEXT;
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS mime_type             TEXT;
ALTER TABLE public.mensagens_whatsapp ADD COLUMN IF NOT EXISTS evolution_message_id  TEXT;

-- 2. Índices
CREATE INDEX IF NOT EXISTS idx_mw_tipo_audio
  ON public.mensagens_whatsapp (tipo) WHERE tipo = 'audio';

CREATE INDEX IF NOT EXISTS idx_mw_storage_path
  ON public.mensagens_whatsapp (storage_path) WHERE storage_path IS NOT NULL;

-- 3. Garantir tabela mensagens_whatsapp_arquivos (patch v15 compat)
CREATE TABLE IF NOT EXISTS public.mensagens_whatsapp_arquivos (
  id               TEXT PRIMARY KEY,
  mensagem_id      TEXT,
  conversa_id      TEXT NOT NULL,
  lead_id          TEXT,
  usuario_id       TEXT,
  nome_original    TEXT NOT NULL DEFAULT 'audio',
  nome_armazenado  TEXT,
  mime_type        TEXT,
  tamanho_bytes    BIGINT,
  storage_path     TEXT,
  storage_bucket   TEXT,
  public_url       TEXT,
  direcao          TEXT DEFAULT 'recebida',
  tipo_arquivo     TEXT DEFAULT 'audio',
  origem           TEXT DEFAULT 'whatsapp_recebido',
  criado_em        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.mensagens_whatsapp_arquivos ADD COLUMN IF NOT EXISTS storage_bucket TEXT;
ALTER TABLE public.mensagens_whatsapp_arquivos ADD COLUMN IF NOT EXISTS direcao       TEXT DEFAULT 'recebida';
ALTER TABLE public.mensagens_whatsapp_arquivos ADD COLUMN IF NOT EXISTS tipo_arquivo  TEXT DEFAULT 'audio';

CREATE INDEX IF NOT EXISTS idx_mwa_conversa_id ON public.mensagens_whatsapp_arquivos (conversa_id);
CREATE INDEX IF NOT EXISTS idx_mwa_mensagem_id ON public.mensagens_whatsapp_arquivos (mensagem_id) WHERE mensagem_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mwa_tipo        ON public.mensagens_whatsapp_arquivos (tipo_arquivo);

-- 4. Diagnóstico final
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'mensagens_whatsapp'
  AND column_name IN ('storage_bucket','storage_path','arquivo_url','mime_type')
ORDER BY column_name;

-- ============================================================
-- NOTA: Criar bucket 'whatsapp-midias' no Supabase Dashboard
-- Storage > New bucket > Nome: whatsapp-midias > Tipo: Privado
-- ============================================================
