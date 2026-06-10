-- ============================================================
-- PROSPEKT CRM — Ocultar Funis Antigos (Não Oficiais)
-- Arquivo: migration_funis_oficiais_2026_06_10.sql
-- Executar manualmente no Supabase SQL Editor
--
-- OBJETIVO: Marcar ativo=false nos funis que NÃO estão
-- na lista oficial, sem apagar nenhum dado.
--
-- FUNIS OFICIAIS (devem ter ativo=true):
--   Tráfego Pago, Linkedin, Instagram, Indicação,
--   Carteira Recorrente, Carteira Reativação, Google
--
-- SEGURANÇA:
--   - NÃO usa DROP, DELETE ou TRUNCATE
--   - Apenas UPDATE ativo=false nos não-oficiais
--   - Garante ativo=true nos oficiais
-- ============================================================

-- PASSO 1: Garante que os funis oficiais estão ativos
UPDATE public.funis
SET ativo = true, atualizado_em = NOW()
WHERE nome IN (
  'Tráfego Pago',
  'Linkedin',
  'Instagram',
  'Indicação',
  'Carteira Recorrente',
  'Carteira Reativação',
  'Google'
);

-- PASSO 2: Desativa todos os funis que NÃO são oficiais
UPDATE public.funis
SET ativo = false, atualizado_em = NOW()
WHERE nome NOT IN (
  'Tráfego Pago',
  'Linkedin',
  'Instagram',
  'Indicação',
  'Carteira Recorrente',
  'Carteira Reativação',
  'Google'
);

-- VALIDAÇÃO: Confirma estado final
SELECT nome, ativo
FROM public.funis
ORDER BY ativo DESC, nome ASC;
