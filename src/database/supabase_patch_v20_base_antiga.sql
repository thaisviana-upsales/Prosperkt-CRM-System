-- ============================================================
-- PROSPERKT CRM — Patch v20: Etapa BASE-Antiga na Carteira Recorrente
-- Execute no Supabase SQL Editor se necessário (já aplicado via script).
-- IDEMPOTENTE: INSERT apenas se não existir. Sem DROP/DELETE/TRUNCATE.
-- ============================================================
-- OBJETIVO:
--   Adicionar "BASE-Antiga" como primeira etapa da Carteira Recorrente (ordem=0).
--   Não aparece no Dashboard nem no Funil de Conversão (filtrada via código).
--   Não altera automações existentes (continuam apontando para Previsão Carteira).
-- ============================================================

-- 1. Cria BASE-Antiga SOMENTE se não existir na pipeline Carteira Recorrente
INSERT INTO public.etapas (id, pipeline_id, nome, cor, ordem, is_ganho, is_perdido, probabilidade, ativo, oculta)
SELECT
  gen_random_uuid()::text,
  'funil-carteira-recorrente',   -- pipeline_id da Carteira Recorrente
  'BASE-Antiga',
  '#4A4A6A',
  0,     -- primeira posição
  0,     -- is_ganho = false
  0,     -- is_perdido = false
  0,     -- probabilidade = 0%
  1,     -- ativo = true
  false  -- oculta = false (aparece na pipeline)
WHERE NOT EXISTS (
  SELECT 1 FROM public.etapas
  WHERE pipeline_id = 'funil-carteira-recorrente'
    AND nome = 'BASE-Antiga'
);

-- 2. Verificação (execute após o patch):
-- SELECT nome, ordem, ativo, oculta
-- FROM public.etapas
-- WHERE pipeline_id = 'funil-carteira-recorrente'
-- ORDER BY ordem;

-- ============================================================
-- FIM DO PATCH v20
-- ============================================================
