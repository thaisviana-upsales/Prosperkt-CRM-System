-- =============================================================================
-- PROSPEKT CRM — Patch: lead_arquivos + bucket lead-arquivos
-- Data: 2026-08-14
-- SEGURO: usa IF NOT EXISTS. Sem DROP, TRUNCATE ou DELETE.
-- Execute no Supabase SQL Editor antes do deploy.
-- =============================================================================

-- 1. Garante tabela lead_arquivos com todos os campos necessários
CREATE TABLE IF NOT EXISTS public.lead_arquivos (
  id            TEXT        PRIMARY KEY,
  lead_id       TEXT        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  venda_id      TEXT        NULL,
  conversa_id   TEXT        NULL,
  mensagem_id   TEXT        NULL,
  nome_original TEXT        NOT NULL,
  nome_storage  TEXT        NOT NULL,
  url           TEXT        NOT NULL DEFAULT '',
  tamanho       BIGINT,
  mime_type     TEXT,
  enviado_por   TEXT        REFERENCES public.usuarios(id),
  origem        TEXT        NOT NULL DEFAULT 'upload',
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Garante colunas opcionais (caso tabela já exista com schema antigo)
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS venda_id    TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS conversa_id TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS mensagem_id TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS origem      TEXT DEFAULT 'upload';

-- 3. Índices para performance
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_lead     ON public.lead_arquivos (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_criado   ON public.lead_arquivos (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_origem   ON public.lead_arquivos (origem);

-- 4. Reload schema PostgREST (garante que novas colunas são reconhecidas imediatamente)
NOTIFY pgrst, 'reload schema';

-- 5. Verificação (deve retornar todas as colunas criadas)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'lead_arquivos'
ORDER BY ordinal_position;

-- =============================================================================
-- BUCKET: lead-arquivos
-- O backend cria automaticamente no primeiro upload se não existir.
-- Mas você pode criá-lo manualmente:
--   Supabase Dashboard → Storage → New bucket
--   Nome: lead-arquivos
--   Público: SIM
-- =============================================================================
