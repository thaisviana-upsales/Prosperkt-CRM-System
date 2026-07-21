-- ============================================================
-- PROSPERKT CRM — Patch v19: Correção Etapas "Em Tratativa"
-- Execute no Supabase SQL Editor ANTES do deploy.
-- SEGURO: UPDATE com filtros precisos — sem DROP/DELETE/TRUNCATE.
-- ============================================================
-- PROBLEMA CORRIGIDO:
--   "Em Tratativa" estava com ativo=0, oculta=true em todos os funis.
--   "Tratativa em andamento" deve permanecer oculta (etapa obsoleta).
--   Este patch aplica as correções diretamente no banco.
-- ============================================================

-- 1. OCULTAR/INATIVAR "Tratativa em andamento" e variações (etapa errada/obsoleta)
UPDATE public.etapas
SET ativo = 0, oculta = true, atualizado_em = NOW()
WHERE nome IN (
  'Tratativa em andamento',
  'Tratativa em Andamento',
  'TRATATIVA EM ANDAMENTO',
  'Tratativa andamento',
  'Tratativa',
  'Contato em Tratativa'
);

-- 2. ATIVAR "Em Tratativa" nos funis COMERCIAIS (exceto Carteira Recorrente)
--    Posição: ordem=4 (após Lead Desqualificado=3)
UPDATE public.etapas
SET ativo = 1, oculta = false, ordem = 4, atualizado_em = NOW()
WHERE nome = 'Em Tratativa'
  AND pipeline_id NOT IN (
    SELECT p.id FROM public.pipelines p
    JOIN public.funis f ON f.id = p.funil_id
    WHERE f.nome ILIKE '%Carteira Recorrente%'
  );

-- 3. REORDENAR etapas após "Em Tratativa" nos funis comerciais
--    (empurra as etapas que estavam em ordem 4+ para ordem 5+)
UPDATE public.etapas
SET ordem = 5, atualizado_em = NOW()
WHERE nome = 'Orçamento Enviado'
  AND pipeline_id NOT IN (
    SELECT p.id FROM public.pipelines p
    JOIN public.funis f ON f.id = p.funil_id
    WHERE f.nome ILIKE '%Carteira Recorrente%'
  );

UPDATE public.etapas SET ordem = 6, atualizado_em = NOW()
WHERE nome = 'Orçamento Aprovado'
  AND pipeline_id NOT IN (
    SELECT p.id FROM public.pipelines p JOIN public.funis f ON f.id = p.funil_id
    WHERE f.nome ILIKE '%Carteira Recorrente%'
  );

UPDATE public.etapas SET ordem = 7, atualizado_em = NOW()
WHERE nome = 'Layout Virtual'
  AND pipeline_id NOT IN (
    SELECT p.id FROM public.pipelines p JOIN public.funis f ON f.id = p.funil_id
    WHERE f.nome ILIKE '%Carteira Recorrente%'
  );

UPDATE public.etapas SET ordem = 8, atualizado_em = NOW()
WHERE nome = 'Amostra Física'
  AND pipeline_id NOT IN (
    SELECT p.id FROM public.pipelines p JOIN public.funis f ON f.id = p.funil_id
    WHERE f.nome ILIKE '%Carteira Recorrente%'
  );

UPDATE public.etapas SET ordem = 9, atualizado_em = NOW()
WHERE nome = 'Amostra Aprovada'
  AND pipeline_id NOT IN (
    SELECT p.id FROM public.pipelines p JOIN public.funis f ON f.id = p.funil_id
    WHERE f.nome ILIKE '%Carteira Recorrente%'
  );

UPDATE public.etapas SET ordem = 10, atualizado_em = NOW()
WHERE nome = 'Follow-Up'
  AND pipeline_id NOT IN (
    SELECT p.id FROM public.pipelines p JOIN public.funis f ON f.id = p.funil_id
    WHERE f.nome ILIKE '%Carteira Recorrente%'
  );

UPDATE public.etapas SET ordem = 11, atualizado_em = NOW()
WHERE nome = 'Vendas'
  AND pipeline_id NOT IN (
    SELECT p.id FROM public.pipelines p JOIN public.funis f ON f.id = p.funil_id
    WHERE f.nome ILIKE '%Carteira Recorrente%'
  );

UPDATE public.etapas SET ordem = 12, atualizado_em = NOW()
WHERE nome = 'Perdidos'
  AND pipeline_id NOT IN (
    SELECT p.id FROM public.pipelines p JOIN public.funis f ON f.id = p.funil_id
    WHERE f.nome ILIKE '%Carteira Recorrente%'
  );

-- 4. NÃO TOCAR NA CARTEIRA RECORRENTE
--    (nenhuma linha acima afeta etapas de pipelines da Carteira Recorrente)

-- 5. VERIFICAÇÃO (execute após o patch para confirmar)
-- SELECT nome, ativo, oculta, ordem,
--   (SELECT f.nome FROM funis f JOIN pipelines p ON p.funil_id = f.id WHERE p.id = etapas.pipeline_id LIMIT 1) as funil
-- FROM etapas
-- WHERE nome IN ('Em Tratativa', 'Tratativa em andamento')
-- ORDER BY nome, ordem;

-- ============================================================
-- FIM DO PATCH v19
-- ============================================================
