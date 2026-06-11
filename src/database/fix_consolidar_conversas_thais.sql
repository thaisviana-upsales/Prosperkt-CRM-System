-- CONSOLIDAR CONVERSAS DA THAIS + MAPEAR LID CORRETO
-- Execute no Supabase SQL Editor

-- 1. Ver TODAS as conversas da Thais (5511964634949)
SELECT id, telefone, nome_contato, origem, status, criado_em, ultima_msg_em, dados_extras
FROM public.conversas_whatsapp
WHERE telefone = '5511964634949'
   OR telefone = '62972877619405'
ORDER BY ultima_msg_em DESC NULLS LAST;

-- 2. Após ver o resultado acima, mapa o LID na conversa mais ativa (a com ultimo_msg_em mais recente)
-- Substitua 'ID_DA_CONVERSA_ATIVA' pelo id correto da conversa que aparece no CRM
-- UPDATE public.conversas_whatsapp
-- SET dados_extras = '{"lid":"62972877619405"}'
-- WHERE id = 'ID_DA_CONVERSA_ATIVA';
