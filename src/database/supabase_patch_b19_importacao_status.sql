-- ============================================================
-- PROSPERKT CRM — Patch B19: status final de importações
-- Execute no Supabase SQL Editor.
-- SEGURO: só amplia o CHECK de status + UPDATE restrito a importações
-- que NUNCA terão fase 2. SEM DROP de tabela, SEM DELETE, SEM TRUNCATE.
-- Idempotente: pode ser executado mais de uma vez.
-- ============================================================

-- 1) Amplia o CHECK de status para os novos estados finais
ALTER TABLE public.importacoes_leads
  DROP CONSTRAINT IF EXISTS importacoes_leads_status_check;

ALTER TABLE public.importacoes_leads
  ADD CONSTRAINT importacoes_leads_status_check
  CHECK (status IN (
    'pendente','validando','aguardando_confirmacao','importando',
    'concluido','concluido_com_erros','com_erros',
    'cancelado','erro'
  ));

-- 2) Corrige importações presas em "Aguardando" sem nenhuma linha importável
--    (100% inválidas/duplicadas — o botão Importar nunca fica disponível)
UPDATE public.importacoes_leads
   SET status = 'com_erros',
       finalizado_em = COALESCE(finalizado_em, criado_em)
 WHERE status = 'aguardando_confirmacao'
   AND COALESCE(total_validas, 0) = 0;

-- 3) Reclassifica importações "concluido" que tiveram falhas
UPDATE public.importacoes_leads
   SET status = CASE WHEN COALESCE(total_importados,0) = 0 THEN 'com_erros'
                     ELSE 'concluido_com_erros' END
 WHERE status = 'concluido'
   AND COALESCE(total_linhas,0) > COALESCE(total_importados,0);

-- ============================================================
-- FIM DO PATCH B19
-- ============================================================
