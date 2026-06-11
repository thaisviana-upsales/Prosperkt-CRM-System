-- Verifica se a mensagem da Thais foi salva na tabela de mensagens
-- Execute no Supabase SQL Editor

SELECT 
  id,
  conversa_id,
  telefone,
  mensagem,
  direcao,
  status,
  criado_em
FROM public.mensagens_whatsapp
ORDER BY criado_em DESC
LIMIT 8;
