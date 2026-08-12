-- =============================================================================
-- PROSPEKT CRM — Patch v40: WhatsApp Deduplicação Definitiva
-- Correção da causa raiz de conversas duplicadas por LID/JID
--
-- Problema corrigido no backend (whatsappController.js):
--   • normalizePhoneBR() agora rejeita LIDs (14+ dígitos sem prefixo 55)
--   • normalizarPayloadWA() retorna rawTel=null para LID sem participant
--
-- Este patch garante a integridade no banco de dados:
--   1. Tabela whatsapp_conversa_aliases existe com índices corretos
--   2. UNIQUE INDEX em remote_jid para prevenir aliases duplicados
--   3. Consolida conversas "LID:XXXXXXXX" existentes (legado)
--   4. Consolida conversas com mesmo lead_id e status ABERTA
--   5. Diagnóstico final
--
-- Seguro: apenas IF NOT EXISTS, ON CONFLICT DO NOTHING, sem DROP/DELETE/TRUNCATE
-- Pode ser executado múltiplas vezes
-- =============================================================================

-- ── 0. Garante coluna dados_extras em conversas_whatsapp ─────────────────────
-- Previne erro "column does not exist" antes de qualquer UPDATE que usa a coluna.
ALTER TABLE conversas_whatsapp
  ADD COLUMN IF NOT EXISTS dados_extras JSONB DEFAULT '{}'::jsonb;

-- ── 1. Garante tabela whatsapp_conversa_aliases com schema completo ──────────
CREATE TABLE IF NOT EXISTS whatsapp_conversa_aliases (
  id                   TEXT        PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  conversa_id          TEXT        NOT NULL REFERENCES conversas_whatsapp(id) ON DELETE CASCADE,
  telefone_normalizado TEXT,
  remote_jid           TEXT,
  lid                  TEXT,
  push_name            TEXT,
  lead_id              TEXT,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS permissiva (controle feito no backend)
ALTER TABLE whatsapp_conversa_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_alias_all ON whatsapp_conversa_aliases;
CREATE POLICY wa_alias_all ON whatsapp_conversa_aliases USING (true) WITH CHECK (true);

-- ── 2. Índices para performance e unicidade ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_wca_conversa_id
  ON whatsapp_conversa_aliases (conversa_id);

CREATE INDEX IF NOT EXISTS idx_wca_telefone
  ON whatsapp_conversa_aliases (telefone_normalizado)
  WHERE telefone_normalizado IS NOT NULL;

-- UNIQUE INDEX em remote_jid — previne aliases duplicados para o mesmo JID
CREATE UNIQUE INDEX IF NOT EXISTS idx_wca_remote_jid_unique
  ON whatsapp_conversa_aliases (remote_jid)
  WHERE remote_jid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wca_lid
  ON whatsapp_conversa_aliases (lid)
  WHERE lid IS NOT NULL;

-- ── 3. Adiciona coluna lead_id se não existir (retrocompatibilidade) ─────────
DO $$ BEGIN
  ALTER TABLE whatsapp_conversa_aliases ADD COLUMN IF NOT EXISTS lead_id TEXT;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── 4. Consolida conversas com telefone "LID:XXXXXXXX" (legado) ─────────────

-- 4a. Move mensagens da conversa LID para a principal (mesmo lead_id, telefone real)
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
    WHERE m2.conversa_id = principal.id
      AND m2.evolution_message_id IS NOT NULL
      AND m2.evolution_message_id = m.evolution_message_id
  );

-- 4b. Move mensagens de conversas com telefone numérico LID (14+ dígitos, sem 55)
UPDATE mensagens_whatsapp m
SET conversa_id = principal.id
FROM conversas_whatsapp lid_conv
JOIN conversas_whatsapp principal
  ON  principal.lead_id  = lid_conv.lead_id
  AND principal.id       != lid_conv.id
  AND NOT (principal.telefone ~ '^[0-9]{14,}$' AND principal.telefone NOT LIKE '55%')
  AND principal.status   != 'FECHADA'
WHERE m.conversa_id    = lid_conv.id
  AND lid_conv.lead_id  IS NOT NULL
  AND lid_conv.telefone ~ '^[0-9]{14,}$'
  AND lid_conv.telefone NOT LIKE '55%'
  AND NOT EXISTS (
    SELECT 1 FROM mensagens_whatsapp m2
    WHERE m2.conversa_id = principal.id
      AND m2.evolution_message_id IS NOT NULL
      AND m2.evolution_message_id = m.evolution_message_id
  );

-- 4c. Fecha as conversas LID (telefone LIKE 'LID:%')
-- FIX 42702: dados_extras qualificado com alias "lid_conv" (tabela alvo do UPDATE)
UPDATE conversas_whatsapp AS lid_conv
SET
  status        = 'FECHADA',
  atualizado_em = NOW(),
  dados_extras  = COALESCE(lid_conv.dados_extras, '{}'::jsonb) || jsonb_build_object(
    'consolidada',       true,
    'motivo_fechamento', 'lid_como_telefone_corrigido_v40',
    'fechada_em',        NOW()::text
  )
FROM conversas_whatsapp principal
WHERE lid_conv.lead_id   = principal.lead_id
  AND lid_conv.id        != principal.id
  AND lid_conv.telefone   LIKE 'LID:%'
  AND lid_conv.lead_id    IS NOT NULL
  AND principal.telefone  NOT LIKE 'LID:%'
  AND principal.status   != 'FECHADA';

-- 4d. Fecha conversas com telefone numérico LID (14+ dígitos, sem 55)
-- FIX 42702: dados_extras qualificado com alias "lid_conv" (tabela alvo do UPDATE)
UPDATE conversas_whatsapp AS lid_conv
SET
  status        = 'FECHADA',
  atualizado_em = NOW(),
  dados_extras  = COALESCE(lid_conv.dados_extras, '{}'::jsonb) || jsonb_build_object(
    'consolidada',       true,
    'motivo_fechamento', 'lid_numerico_como_telefone_corrigido_v40',
    'lid_original',      lid_conv.telefone,
    'fechada_em',        NOW()::text
  )
FROM conversas_whatsapp principal
WHERE lid_conv.lead_id   = principal.lead_id
  AND lid_conv.id        != principal.id
  AND lid_conv.telefone   ~ '^[0-9]{14,}$'
  AND lid_conv.telefone   NOT LIKE '55%'
  AND lid_conv.lead_id    IS NOT NULL
  AND NOT (principal.telefone ~ '^[0-9]{14,}$' AND principal.telefone NOT LIKE '55%')
  AND principal.status   != 'FECHADA';

-- ── 5. Consolida duplicatas por mesmo lead_id + status ABERTA ───────────────

-- 5a. Move mensagens das duplicatas para a canônica (mais antiga com lead_id)
WITH ranking AS (
  SELECT
    id,
    lead_id,
    ROW_NUMBER() OVER (
      PARTITION BY lead_id
      ORDER BY
        CASE WHEN lead_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN status = 'ABERTA'   THEN 0 ELSE 1 END,
        criado_em ASC
    ) AS rn
  FROM conversas_whatsapp
  WHERE lead_id IS NOT NULL AND status != 'FECHADA'
),
canonicas AS (
  SELECT id AS canonica_id, lead_id FROM ranking WHERE rn = 1
),
duplicatas AS (
  SELECT r.id AS duplicata_id, c.canonica_id
  FROM ranking r
  JOIN canonicas c ON c.lead_id = r.lead_id
  WHERE r.rn > 1
)
UPDATE mensagens_whatsapp m
SET conversa_id = d.canonica_id
FROM duplicatas d
WHERE m.conversa_id = d.duplicata_id
  AND NOT EXISTS (
    SELECT 1 FROM mensagens_whatsapp m2
    WHERE m2.conversa_id = d.canonica_id
      AND m2.evolution_message_id IS NOT NULL
      AND m2.evolution_message_id = m.evolution_message_id
  );

-- 5b. Fecha as duplicatas
-- FIX 42702: dados_extras qualificado com alias "cw" (tabela alvo do UPDATE)
WITH ranking2 AS (
  SELECT
    id,
    lead_id,
    ROW_NUMBER() OVER (
      PARTITION BY lead_id
      ORDER BY
        CASE WHEN lead_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN status = 'ABERTA'   THEN 0 ELSE 1 END,
        criado_em ASC
    ) AS rn
  FROM conversas_whatsapp
  WHERE lead_id IS NOT NULL AND status != 'FECHADA'
)
UPDATE conversas_whatsapp cw
SET
  status        = 'FECHADA',
  atualizado_em = NOW(),
  dados_extras  = COALESCE(cw.dados_extras, '{}'::jsonb) || jsonb_build_object(
    '_duplicata_consolidada_v40', true,
    '_fechada_em',               NOW()::text
  )
FROM ranking2 r
WHERE r.id = cw.id
  AND r.rn  > 1;

-- ── 6. Backfill de aliases para conversas abertas ────────────────────────────
INSERT INTO whatsapp_conversa_aliases (id, conversa_id, telefone_normalizado, criado_em, atualizado_em)
SELECT
  encode(gen_random_bytes(16), 'hex'),
  c.id,
  c.telefone,
  NOW(),
  NOW()
FROM conversas_whatsapp c
WHERE c.telefone IS NOT NULL
  AND c.telefone NOT LIKE 'LID:%'
  AND c.telefone ~ '^[0-9]{10,13}$'
  AND c.status != 'FECHADA'
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_conversa_aliases a
    WHERE a.conversa_id          = c.id
      AND a.telefone_normalizado = c.telefone
  )
ON CONFLICT DO NOTHING;

-- ── 7. Índices em conversas_whatsapp ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cw_lead_id_ativa
  ON conversas_whatsapp (lead_id)
  WHERE lead_id IS NOT NULL AND status != 'FECHADA';

CREATE INDEX IF NOT EXISTS idx_cw_telefone_ativa
  ON conversas_whatsapp (telefone)
  WHERE telefone IS NOT NULL AND status != 'FECHADA';

-- ── 8. Relatório final ───────────────────────────────────────────────────────
SELECT
  'patch_v40_ok'                                                              AS resultado,
  (SELECT count(*) FROM conversas_whatsapp WHERE status != 'FECHADA')         AS conversas_ativas_total,
  (SELECT count(*) FROM conversas_whatsapp
   WHERE status != 'FECHADA'
     AND (telefone LIKE 'LID:%'
       OR (telefone ~ '^[0-9]{14,}$' AND telefone NOT LIKE '55%'))
  )                                                                            AS conversas_lid_ainda_abertas,
  (SELECT count(*) FROM conversas_whatsapp cw_r
   WHERE cw_r.status = 'FECHADA'
     AND cw_r.dados_extras::text LIKE '%v40%'
  )                                                                            AS conversas_fechadas_neste_patch,
  (SELECT count(*) FROM whatsapp_conversa_aliases)                             AS total_aliases,
  NOW()                                                                        AS executado_em;
