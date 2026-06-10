-- ============================================================
-- PROSPEKT CRM — Renomear Etapa da Pipeline
-- Arquivo: rename_etapa_tratativa_2026_06_10.sql
-- Executar manualmente no Supabase SQL Editor
--
-- OBJETIVO: Renomear etapa sem perder dados, leads ou vínculos.
-- ============================================================

-- Atualiza o nome da etapa (preserva id, cor, funil, ordem, leads)
UPDATE public.etapas
SET
  nome         = 'Tratativa em andamento',
  atualizado_em = NOW()
WHERE nome = 'Contato Realizado - Tratativa';

-- Validação: confirma o novo nome
SELECT id, nome, funil_id, ordem, cor
FROM public.etapas
WHERE nome = 'Tratativa em andamento';
