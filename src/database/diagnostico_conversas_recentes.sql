-- Diagnóstico: ver as últimas conversas criadas e seus telefones
-- Execute no Supabase SQL Editor

SELECT 
  id,
  telefone,
  nome_contato,
  origem,
  status,
  criado_em,
  dados_extras
FROM public.conversas_whatsapp
ORDER BY criado_em DESC
LIMIT 10;
