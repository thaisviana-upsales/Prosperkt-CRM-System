-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPEKT CRM — Patch v33
-- Objetivo: garantir estrutura completa de lead_arquivos para upload funcional
-- SEGURO: sem DROP TABLE, sem DELETE, sem TRUNCATE — idempotente
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Garantir tabela lead_arquivos com todos os campos necessários
CREATE TABLE IF NOT EXISTS public.lead_arquivos (
  id             TEXT PRIMARY KEY,
  lead_id        TEXT NOT NULL,
  nome_original  TEXT NOT NULL,
  nome_storage   TEXT,
  url            TEXT,
  tamanho        BIGINT,
  mime_type      TEXT,
  enviado_por    TEXT,
  origem         TEXT DEFAULT 'lead',
  -- origem: lead | producao | whatsapp | whatsapp_recebido | whatsapp_enviado
  criado_em      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Garantir colunas extras (idempotente via IF NOT EXISTS)
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS conversa_id    TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS mensagem_id    TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS descricao      TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS production_id  TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS venda_id       TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS timeline_id    TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS atualizado_em  TIMESTAMPTZ DEFAULT NOW();

-- 3. Índices para queries do CRM
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_lead_id     ON public.lead_arquivos (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_origem      ON public.lead_arquivos (origem);
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_conversa    ON public.lead_arquivos (conversa_id)   WHERE conversa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_mensagem    ON public.lead_arquivos (mensagem_id)   WHERE mensagem_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_producao    ON public.lead_arquivos (production_id) WHERE production_id IS NOT NULL;
-- Índice composto: lead + origem (usado pelo filtro ?origem=producao)
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_lead_origem ON public.lead_arquivos (lead_id, origem);

-- 4. Garantir tabela mensagens_whatsapp_arquivos
CREATE TABLE IF NOT EXISTS public.mensagens_whatsapp_arquivos (
  id               TEXT PRIMARY KEY,
  mensagem_id      TEXT,
  conversa_id      TEXT NOT NULL,
  lead_id          TEXT,
  usuario_id       TEXT,
  nome_original    TEXT NOT NULL,
  nome_armazenado  TEXT,
  mime_type        TEXT,
  tamanho_bytes    BIGINT,
  storage_path     TEXT,
  public_url       TEXT,
  origem           TEXT DEFAULT 'whatsapp_recebido',
  criado_em        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mwa_conversa_id ON public.mensagens_whatsapp_arquivos (conversa_id);
CREATE INDEX IF NOT EXISTS idx_mwa_lead_id     ON public.mensagens_whatsapp_arquivos (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mwa_mensagem_id ON public.mensagens_whatsapp_arquivos (mensagem_id) WHERE mensagem_id IS NOT NULL;

-- 6. Normalizar registros antigos sem origem definida
-- Arquivos sem origem explícita são da aba do lead (origem='lead')
UPDATE public.lead_arquivos
SET origem = 'lead'
WHERE origem IS NULL;

-- Arquivos vinculados a conversa_id mas sem origem explícita são de WhatsApp recebido
UPDATE public.lead_arquivos
SET origem = 'whatsapp'
WHERE origem = 'lead'
  AND conversa_id IS NOT NULL
  AND mensagem_id IS NOT NULL;

-- 7. Confirma estrutura final
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'lead_arquivos'
  AND table_schema = 'public'
ORDER BY ordinal_position;
