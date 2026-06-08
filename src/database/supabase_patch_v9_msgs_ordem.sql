-- PROSPERKT CRM — Patch v9: Campo 'ordem' em mensagens_padrao
-- Execute este SQL no Supabase Dashboard > SQL Editor
-- Permite reordenação manual de scripts dentro de cada subcategoria

ALTER TABLE mensagens_padrao
  ADD COLUMN IF NOT EXISTS ordem INTEGER DEFAULT 0;

UPDATE mensagens_padrao SET ordem = 0 WHERE ordem IS NULL;

-- Confirma
SELECT categoria, titulo, ordem
FROM mensagens_padrao
ORDER BY categoria, ordem, titulo
LIMIT 20;
