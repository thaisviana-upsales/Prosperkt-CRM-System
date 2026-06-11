-- ============================================================
-- PROSPEKT CRM — CORREÇÃO URGENTE: Reativar Funis Indevidamente Ocultos
-- Arquivo: fix_funis_reativar_linkedin_reativacao_2026_06_10.sql
-- Executar NO SUPABASE SQL EDITOR
--
-- PROBLEMA: LinkedIn e Carteira Reativação foram desativados por
-- divergência de case/acento entre o SQL e o nome real no banco.
--
-- SOLUÇÃO: Usar ILIKE (case-insensitive) + unaccent para reativar
-- todos os funis oficiais, independente de como estão grafados.
-- ============================================================

-- PASSO 1: Reativa TODOS os 7 funis oficiais com ILIKE
-- (case-insensitive, garante LinkedIn, Linkedin, LINKEDIN etc.)
UPDATE public.funis
SET ativo = true, atualizado_em = NOW()
WHERE
  nome ILIKE '%linkedin%'
  OR nome ILIKE '%tráfego pago%'
  OR nome ILIKE '%trafego pago%'
  OR nome ILIKE '%instagram%'
  OR nome ILIKE '%indica%'
  OR nome ILIKE '%carteira recorrente%'
  OR nome ILIKE '%carteira reativa%'
  OR nome ILIKE '%google%';

-- PASSO 2: Confirma os funis agora ativos
SELECT id, nome, ativo
FROM public.funis
WHERE ativo = true
ORDER BY nome ASC;

-- PASSO 3 (OPCIONAL — execute só se quiser ver todos):
-- SELECT id, nome, ativo FROM public.funis ORDER BY ativo DESC, nome ASC;
