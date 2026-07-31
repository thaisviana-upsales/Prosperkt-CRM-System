-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPEKT CRM — Patch v34
-- Objetivo: garantir campo atualizado_em na tabela usuarios (necessário para
--           o script de ativação de acesso)
-- SEGURO: sem DROP TABLE, sem DELETE, sem TRUNCATE — idempotente
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Garantir coluna atualizado_em na tabela usuarios
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ DEFAULT NOW();

-- 2. Índice para performance em queries de login
CREATE INDEX IF NOT EXISTS idx_usuarios_email_ativo ON public.usuarios (email, ativo);
CREATE INDEX IF NOT EXISTS idx_usuarios_ativo        ON public.usuarios (ativo);
CREATE INDEX IF NOT EXISTS idx_usuarios_role         ON public.usuarios (role);

-- 3. Confirma colunas da tabela usuarios
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'usuarios'
  AND table_schema = 'public'
ORDER BY ordinal_position;
