-- ============================================================================
-- PATCH v38 (v5): Correção definitiva — Conversas duplicadas por LID/JID
-- Safe: pode rodar múltiplas vezes (IF NOT EXISTS / ON CONFLICT DO NOTHING)
-- Schema real: dados_extras = JSONB, atualizado_em/criado_em = TIMESTAMPTZ
-- ============================================================================

-- ── 1. Corrige conversas cujo telefone foi gravado como "LID:XXXXXXXX" ────────
-- Substitui pelo telefone real do lead vinculado.
UPDATE conversas_whatsapp AS cw
SET
  telefone      = l.telefone,
  dados_extras  = jsonb_build_object(
                    'lid_original',    split_part(cw.telefone, ':', 2),
                    'lid_corrigido_em', now()
                  ),
  atualizado_em = now()
FROM leads l
WHERE cw.lead_id  = l.id
  AND cw.telefone LIKE 'LID:%'
  AND l.telefone  IS NOT NULL
  AND l.telefone  ~ '^[0-9]{10,15}$';

-- ── 2. Registra aliases para as conversas corrigidas ─────────────────────────
INSERT INTO whatsapp_conversa_aliases (
  id, conversa_id, telefone_normalizado, lid, remote_jid, criado_em, atualizado_em
)
SELECT
  gen_random_uuid()::text,
  c.id                                           AS conversa_id,
  c.telefone                                     AS telefone_normalizado,
  c.dados_extras ->> 'lid_original'              AS lid,
  (c.dados_extras ->> 'lid_original') || '@lid'  AS remote_jid,
  now(),
  now()
FROM conversas_whatsapp c
WHERE c.dados_extras::text LIKE '%lid_original%'
  AND c.telefone IS NOT NULL
  AND c.telefone NOT LIKE 'LID:%'
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_conversa_aliases a
    WHERE a.conversa_id = c.id
      AND a.lid = c.dados_extras ->> 'lid_original'
  )
ON CONFLICT DO NOTHING;

-- ── 3a. Move mensagens de conversas LID para a conversa principal do mesmo lead
UPDATE mensagens_whatsapp m
SET conversa_id = principal.id
FROM conversas_whatsapp lid_conv
JOIN conversas_whatsapp principal
  ON  principal.lead_id  = lid_conv.lead_id
  AND principal.id       != lid_conv.id
  AND principal.telefone NOT LIKE 'LID:%'
  AND principal.status   != 'FECHADA'
WHERE m.conversa_id    = lid_conv.id
  AND lid_conv.telefone LIKE 'LID:%'
  AND lid_conv.lead_id  IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM mensagens_whatsapp m2
    WHERE m2.conversa_id          = principal.id
      AND m2.evolution_message_id IS NOT NULL
      AND m2.evolution_message_id = m.evolution_message_id
  );

-- ── 3b. Fecha as conversas LID consolidadas ────────────────────────────────────
UPDATE conversas_whatsapp AS lid_conv
SET
  status        = 'FECHADA',
  atualizado_em = now(),
  dados_extras  = jsonb_build_object('consolidada', true)
FROM conversas_whatsapp principal
WHERE lid_conv.lead_id   = principal.lead_id
  AND lid_conv.id         != principal.id
  AND lid_conv.telefone   LIKE 'LID:%'
  AND lid_conv.lead_id    IS NOT NULL
  AND principal.telefone  NOT LIKE 'LID:%'
  AND principal.status    != 'FECHADA';

-- ── 4. Índice parcial de diagnóstico ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cw_lead_ativa
  ON conversas_whatsapp (lead_id)
  WHERE lead_id IS NOT NULL AND status != 'FECHADA';

-- ── 5. Relatório final ────────────────────────────────────────────────────────
SELECT
  'patch_v38_ok'                                                              AS resultado,
  (SELECT count(*) FROM conversas_whatsapp
   WHERE telefone NOT LIKE 'LID:%' AND status != 'FECHADA')                  AS conversas_ativas_tel_real,
  (SELECT count(*) FROM conversas_whatsapp
   WHERE telefone LIKE 'LID:%' AND status != 'FECHADA')                      AS conversas_lid_ainda_abertas,
  (SELECT count(*) FROM conversas_whatsapp
   WHERE status = 'FECHADA'
     AND dados_extras::text LIKE '%consolidada%')                             AS conversas_lid_fechadas,
  (SELECT count(*) FROM whatsapp_conversa_aliases)                            AS total_aliases;
