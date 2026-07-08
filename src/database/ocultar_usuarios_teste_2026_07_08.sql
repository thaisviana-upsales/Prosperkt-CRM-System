-- ============================================================
-- PROSPEKT CRM — Ocultar usuários de teste
-- Data: 2026-07-08
-- Mantém ATIVOS apenas:
--   Diego Siqueira, Lais Basilio, Erica Fernandes da Silva,
--   Marcos Vinicius, Super Admin
-- Todos os outros recebem ativo = false (ocultados do CRM)
-- NÃO exclui nenhum registro.
-- ============================================================

UPDATE usuarios
SET ativo = false,
    atualizado_em = NOW()
WHERE nome NOT IN (
  'Diego Siqueira',
  'Lais Basilio',
  'Erica Fernandes da Silva',
  'Marcos Vinicius',
  'Super Admin'
);
