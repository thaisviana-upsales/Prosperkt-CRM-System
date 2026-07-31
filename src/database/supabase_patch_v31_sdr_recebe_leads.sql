-- ─────────────────────────────────────────────────────────────────────────────
-- PROSPEKT CRM — Patch v31
-- Objetivo: coluna recebe_leads_automaticos em usuarios + aceitar SDR na constraint
-- SEGURO: sem DROP TABLE, sem DELETE, sem TRUNCATE
-- Idempotente: pode re-executar sem danos
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Garante coluna recebe_leads_automaticos
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS recebe_leads_automaticos BOOLEAN DEFAULT FALSE;

-- 2. Garante coluna sdr_padrao (já existe no v26, mas protege aqui)
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS sdr_padrao BOOLEAN DEFAULT FALSE;

-- 3. Remove constraint de role antiga (se existir) e recria aceitando SDR
ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_role_check;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_role_check
  CHECK (role IN ('SUPER_ADMIN', 'GESTOR', 'VENDEDOR', 'SDR'));

-- 4. Marca SDRs ativos com recebe_leads_automaticos = true automaticamente
--    (só marca se ainda não estiver marcado)
UPDATE public.usuarios
SET    recebe_leads_automaticos = TRUE,
       atualizado_em = NOW()
WHERE  role = 'SDR'
  AND  ativo = 1
  AND  (recebe_leads_automaticos IS NULL OR recebe_leads_automaticos = FALSE);

-- 5. Verifica resultado
SELECT
  id,
  nome,
  email,
  role,
  ativo,
  sdr_padrao,
  recebe_leads_automaticos,
  criado_em
FROM public.usuarios
WHERE role = 'SDR'
ORDER BY criado_em;

-- 6. Confirma constraint
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'usuarios_role_check';

-- 7. Confirma colunas
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'usuarios'
  AND column_name IN ('role', 'sdr_padrao', 'recebe_leads_automaticos')
ORDER BY column_name;
