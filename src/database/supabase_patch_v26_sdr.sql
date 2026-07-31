-- ============================================================
-- PROSPEKT CRM — Patch v26: Perfil SDR + Lead Qualificado SDR
-- Arquivo: supabase_patch_v26_sdr.sql
-- Executar manualmente no Supabase SQL Editor
--
-- SEGURO: sem DROP, sem DELETE, sem TRUNCATE
-- Idempotente: pode re-executar sem danos
-- ============================================================

-- FASE 1: Adicionar coluna sdr_padrao
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS sdr_padrao BOOLEAN DEFAULT FALSE;

-- FASE 2: Remover constraint de role e recriar aceitando SDR
ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_role_check;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_role_check
  CHECK (role IN ('SUPER_ADMIN', 'GESTOR', 'VENDEDOR', 'SDR'));

-- FASE 3: Renomear "Em Tratativa" → "Lead Qualificado SDR"
UPDATE public.etapas
SET
  nome          = 'Lead Qualificado SDR',
  atualizado_em = NOW()
WHERE nome IN (
  'Em Tratativa',
  'Tratativa em andamento',
  'Tratativa em Andamento',
  'Tratativa',
  'Contato em Tratativa'
);

-- FASE 4: Garantir que etapa está visível (não oculta)
ALTER TABLE public.etapas
  ADD COLUMN IF NOT EXISTS oculta BOOLEAN DEFAULT FALSE;

UPDATE public.etapas
SET
  oculta        = FALSE,
  atualizado_em = NOW()
WHERE nome = 'Lead Qualificado SDR';

-- FASE 5: Verificação final
SELECT
  e.id,
  e.nome,
  e.ordem,
  e.cor,
  e.oculta,
  f.nome AS funil_nome,
  (SELECT COUNT(*) FROM public.leads l WHERE l.etapa_id = e.id) AS total_leads
FROM public.etapas e
LEFT JOIN public.pipelines p ON e.pipeline_id = p.id
LEFT JOIN public.funis f ON p.funil_id = f.id
WHERE e.nome = 'Lead Qualificado SDR'
ORDER BY f.nome;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'usuarios'
  AND column_name IN ('role', 'sdr_padrao');
