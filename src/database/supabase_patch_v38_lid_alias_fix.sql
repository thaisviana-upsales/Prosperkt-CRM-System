-- ============================================================================
-- PATCH v38: Correção definitiva — Conversas duplicadas por LID/JID WhatsApp
-- Safe: usa IF EXISTS / ON CONFLICT DO NOTHING — pode rodar múltiplas vezes
-- ============================================================================

-- ── 1. Corrige conversas cujo telefone foi gravado como "LID:XXXXXXXX" ────────
-- Substitui pelo telefone do lead vinculado quando disponível.
-- Guarda o LID original em dados_extras para rastreio.
UPDATE conversas_whatsapp
SET
  telefone = leads.telefone,
  dados_extras = COALESCE(
    (
      CASE
        WHEN dados_extras IS NULL OR dados_extras = '' THEN '{}'::jsonb
        ELSE dados_extras::jsonb
      END
    )::jsonb || jsonb_build_object(
      'lid_original',    split_part(conversas_whatsapp.telefone, ':', 2),
      'lid_corrigido_em', now()::text
    ),
    jsonb_build_object(
      'lid_original',    split_part(conversas_whatsapp.telefone, ':', 2),
      'lid_corrigido_em', now()::text
    )
  )::text,
  atualizado_em = now()::text
FROM leads
WHERE conversas_whatsapp.lead_id = leads.id
  AND conversas_whatsapp.telefone LIKE 'LID:%'
  AND leads.telefone IS NOT NULL
  AND leads.telefone ~ '^[0-9]{10,15}$';

-- ── 2. Registra aliases para as conversas corrigidas ─────────────────────────
-- Garante que o LID e o telefone real estejam na tabela de aliases,
-- prevenindo futuras duplicatas para esses contatos.
INSERT INTO whatsapp_conversa_aliases (
  id, conversa_id, telefone_normalizado, lid, remote_jid, criado_em, atualizado_em
)
SELECT
  gen_random_uuid()::text,
  c.id                                   AS conversa_id,
  c.telefone                             AS telefone_normalizado,
  (c.dados_extras::jsonb ->> 'lid_original')                        AS lid,
  (c.dados_extras::jsonb ->> 'lid_original') || '@lid'              AS remote_jid,
  now()::text,
  now()::text
FROM conversas_whatsapp c
WHERE c.dados_extras IS NOT NULL
  AND c.dados_extras LIKE '%lid_original%'
  AND c.telefone IS NOT NULL
  AND c.telefone NOT LIKE 'LID:%'
  AND (c.dados_extras::jsonb ->> 'lid_original') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_conversa_aliases a
    WHERE a.conversa_id = c.id
      AND a.lid = (c.dados_extras::jsonb ->> 'lid_original')
  )
ON CONFLICT DO NOTHING;

-- ── 3. Consolida mensagens de conversas LID duplicadas ───────────────────────
-- Para cada conversa com telefone LID:... que AINDA tenha lead_id vinculado
-- e uma conversa principal com telefone real do mesmo lead:
-- move as mensagens para a conversa principal e marca a LID como FECHADA.

-- 3a. Move mensagens da conversa LID para a conversa principal (mesmo lead)
UPDATE mensagens_whatsapp m
SET conversa_id = principal.id
FROM conversas_whatsapp lid_conv
JOIN conversas_whatsapp principal
  ON principal.lead_id = lid_conv.lead_id
  AND principal.id      != lid_conv.id
  AND principal.telefone NOT LIKE 'LID:%'
  AND principal.status   != 'FECHADA'
WHERE m.conversa_id = lid_conv.id
  AND lid_conv.telefone LIKE 'LID:%'
  AND lid_conv.lead_id IS NOT NULL
  -- Evita duplicar mensagens já presentes na conversa principal (por evolution_message_id)
  AND NOT EXISTS (
    SELECT 1 FROM mensagens_whatsapp m2
    WHERE m2.conversa_id = principal.id
      AND m2.evolution_message_id IS NOT NULL
      AND m2.evolution_message_id = m.evolution_message_id
  );

-- 3b. Fecha as conversas LID que foram consolidadas
UPDATE conversas_whatsapp lid_conv
SET
  status        = 'FECHADA',
  atualizado_em = now()::text,
  dados_extras  = COALESCE(
    (lid_conv.dados_extras::jsonb || '{"consolidada": true}'::jsonb)::text,
    '{"consolidada": true}'
  )
FROM conversas_whatsapp principal
WHERE lid_conv.lead_id   = principal.lead_id
  AND lid_conv.id         != principal.id
  AND lid_conv.telefone   LIKE 'LID:%'
  AND lid_conv.lead_id    IS NOT NULL
  AND principal.telefone  NOT LIKE 'LID:%'
  AND principal.status    != 'FECHADA';

-- ── 4. Garante índice único suave: 1 conversa ativa por lead ─────────────────
-- (não constraint rígida — apenas índice parcial para diagnóstico)
CREATE INDEX IF NOT EXISTS idx_cw_lead_ativa
  ON conversas_whatsapp (lead_id)
  WHERE lead_id IS NOT NULL AND status != 'FECHADA';

-- ── 5. Relatório de resultado ─────────────────────────────────────────────────
SELECT
  'patch_v38_resultado' AS resultado,
  (SELECT count(*) FROM conversas_whatsapp WHERE telefone NOT LIKE 'LID:%' AND status != 'FECHADA') AS conversas_ativas_com_tel_real,
  (SELECT count(*) FROM conversas_whatsapp WHERE telefone LIKE 'LID:%' AND status != 'FECHADA')     AS conversas_lid_ainda_abertas,
  (SELECT count(*) FROM conversas_whatsapp WHERE telefone LIKE 'LID:%' AND status = 'FECHADA')      AS conversas_lid_fechadas,
  (SELECT count(*) FROM whatsapp_conversa_aliases)                                                   AS total_aliases;
