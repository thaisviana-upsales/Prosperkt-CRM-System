-- ============================================================
-- PROSPEKT CRM — Patch v27: Constraint Metas + Metas col ganho_em
-- Arquivo: supabase_patch_v27_metas_constraint.sql
-- Executar no Supabase SQL Editor
--
-- SEGURO: sem DROP de dados, sem DELETE, sem TRUNCATE
-- Idempotente: pode re-executar sem danos
-- ============================================================

-- FASE 1: Remover constraints antigas de metas (qualquer nome)
ALTER TABLE public.metas DROP CONSTRAINT IF EXISTS metas_uq_vendedor_mes_ano_tipo;
ALTER TABLE public.metas DROP CONSTRAINT IF EXISTS metas_usuario_id_mes_ano_tipo_funil_id_key;
ALTER TABLE public.metas DROP CONSTRAINT IF EXISTS metas_uq_usuario_mes_ano_tipo_funil;
ALTER TABLE public.metas DROP CONSTRAINT IF EXISTS metas_uq_usuario_mes_ano_tipo;

-- FASE 2: Recriar com os 5 campos corretos
-- NULLS NOT DISTINCT: NULL == NULL para fins de unicidade (ex: funil_id NULL é único por vendedor)
-- Isso permite: Erica|Jul|2026|FAT|null e Erica|Ago|2026|FAT|null (diferentes meses)
-- Mas bloqueia: Erica|Ago|2026|FAT|null duplicado
ALTER TABLE public.metas
  ADD CONSTRAINT metas_uq_usuario_mes_ano_tipo_funil
  UNIQUE NULLS NOT DISTINCT (usuario_id, mes, ano, tipo, funil_id);

-- FASE 3: Garantir que a coluna ganho_em existe na tabela leads
-- (usada pelo enriquecerMetaSupa para calcular realizado de FATURAMENTO corretamente)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS ganho_em DATE;

-- Preencher ganho_em para leads que já estão GANHO (baseado em data_fechamento se existir)
UPDATE public.leads
SET ganho_em = data_fechamento::date
WHERE ganho_em IS NULL
  AND status IN ('GANHO','VENDIDO','VENDA')
  AND data_fechamento IS NOT NULL;

-- FASE 4: Verificação
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.metas'::regclass
  AND contype = 'u';

-- Deve mostrar: metas_uq_usuario_mes_ano_tipo_funil com os 5 campos
