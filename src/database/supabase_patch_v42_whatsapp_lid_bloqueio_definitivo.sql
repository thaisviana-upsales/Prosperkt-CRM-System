-- =============================================================================
-- PROSPEKT CRM — Patch v42: WhatsApp Bloqueio Definitivo de LID Ativo
-- Consolida conversas LID ativas existentes + adiciona coluna visivel
-- Complementa patch v41 com regras de runtime já implementadas no código.
--
-- Seguro: sem DROP, DELETE, TRUNCATE.
-- Pode ser executado múltiplas vezes.
-- =============================================================================

-- ── 0. Garantias de schema ───────────────────────────────────────────────────
ALTER TABLE conversas_whatsapp
  ADD COLUMN IF NOT EXISTS dados_extras JSONB DEFAULT '{}'::jsonb;

-- Coluna visivel: false oculta a conversa da lista principal (defense in depth)
ALTER TABLE conversas_whatsapp
  ADD COLUMN IF NOT EXISTS visivel BOOLEAN DEFAULT true;

-- ── 0b. Expande constraint de status (necessário para PENDENTE_IDENTIFICACAO) ─
DO $$
DECLARE v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'conversas_whatsapp'::regclass
    AND conname   = 'conversas_whatsapp_status_check';

  IF v_def IS NULL THEN
    ALTER TABLE conversas_whatsapp
      ADD CONSTRAINT conversas_whatsapp_status_check
      CHECK (status IN ('ABERTA','FECHADA','AGUARDANDO','PENDENTE_IDENTIFICACAO'));
    RAISE NOTICE 'Constraint criada com PENDENTE_IDENTIFICACAO';
  ELSIF v_def NOT LIKE '%PENDENTE_IDENTIFICACAO%' THEN
    ALTER TABLE conversas_whatsapp DROP CONSTRAINT conversas_whatsapp_status_check;
    ALTER TABLE conversas_whatsapp
      ADD CONSTRAINT conversas_whatsapp_status_check
      CHECK (status IN ('ABERTA','FECHADA','AGUARDANDO','PENDENTE_IDENTIFICACAO'));
    RAISE NOTICE 'Constraint atualizada com PENDENTE_IDENTIFICACAO';
  ELSE
    RAISE NOTICE 'Constraint já contém PENDENTE_IDENTIFICACAO — sem alteração';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Não foi possível alterar constraint: %', SQLERRM;
END $$;

-- =============================================================================
-- ── 1. Backfill de aliases a partir de dados_extras.lid ─────────────────────
-- =============================================================================
INSERT INTO whatsapp_conversa_aliases (
  id, conversa_id, telefone_normalizado, remote_jid, lid, criado_em, atualizado_em
)
SELECT
  encode(gen_random_bytes(16), 'hex'),
  cw.id,
  cw.telefone,
  (cw.dados_extras->>'lid') || '@lid',
  cw.dados_extras->>'lid',
  NOW(), NOW()
FROM conversas_whatsapp cw
WHERE cw.dados_extras IS NOT NULL
  AND cw.dados_extras->>'lid' IS NOT NULL
  AND cw.dados_extras->>'lid' <> ''
  AND cw.status NOT IN ('FECHADA')
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_conversa_aliases a
    WHERE a.conversa_id = cw.id AND a.lid = cw.dados_extras->>'lid'
  )
ON CONFLICT DO NOTHING;

-- =============================================================================
-- ── 2a. Mover mensagens: LID → canônica via alias ────────────────────────────
-- =============================================================================
WITH pares_alias AS (
  SELECT
    lid_c.id      AS conversa_lid_id,
    a.conversa_id AS conversa_canonica_id
  FROM conversas_whatsapp lid_c
  JOIN whatsapp_conversa_aliases a
    ON a.lid = COALESCE(
         NULLIF(lid_c.dados_extras->>'lid', ''),
         CASE WHEN lid_c.telefone LIKE 'LID:%'
              THEN substring(lid_c.telefone FROM 5) ELSE NULL END,
         CASE WHEN lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%'
              THEN lid_c.telefone ELSE NULL END
       )
  JOIN conversas_whatsapp canon_c
    ON canon_c.id    = a.conversa_id
   AND canon_c.id   != lid_c.id
   AND canon_c.status NOT IN ('FECHADA','PENDENTE_IDENTIFICACAO')
  WHERE (
         lid_c.telefone LIKE 'LID:%'
      OR (lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%')
      OR lid_c.dados_extras->>'tipo_identidade' IN ('lid','lid_nao_resolvido')
    )
    AND lid_c.status NOT IN ('FECHADA')
)
UPDATE mensagens_whatsapp m
SET conversa_id = p.conversa_canonica_id
FROM pares_alias p
WHERE m.conversa_id = p.conversa_lid_id
  AND NOT EXISTS (
    SELECT 1 FROM mensagens_whatsapp m2
    WHERE m2.conversa_id         = p.conversa_canonica_id
      AND m2.evolution_message_id IS NOT NULL
      AND m2.evolution_message_id = m.evolution_message_id
  );

-- =============================================================================
-- ── 2b. Mover mensagens: LID → canônica via lead_id ─────────────────────────
-- =============================================================================
WITH pares_lead AS (
  SELECT
    lid_c.id   AS conversa_lid_id,
    canon_c.id AS conversa_canonica_id
  FROM conversas_whatsapp lid_c
  JOIN conversas_whatsapp canon_c
    ON canon_c.lead_id = lid_c.lead_id
   AND canon_c.id     != lid_c.id
   AND NOT (canon_c.telefone LIKE 'LID:%')
   AND NOT (canon_c.telefone ~ '^[0-9]{14,}$' AND canon_c.telefone NOT LIKE '55%')
   AND canon_c.status NOT IN ('FECHADA','PENDENTE_IDENTIFICACAO')
  WHERE lid_c.lead_id IS NOT NULL
    AND (
         lid_c.telefone LIKE 'LID:%'
      OR (lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%')
      OR lid_c.dados_extras->>'tipo_identidade' IN ('lid','lid_nao_resolvido')
    )
    AND lid_c.status NOT IN ('FECHADA')
)
UPDATE mensagens_whatsapp m
SET conversa_id = p.conversa_canonica_id
FROM pares_lead p
WHERE m.conversa_id = p.conversa_lid_id
  AND NOT EXISTS (
    SELECT 1 FROM mensagens_whatsapp m2
    WHERE m2.conversa_id         = p.conversa_canonica_id
      AND m2.evolution_message_id IS NOT NULL
      AND m2.evolution_message_id = m.evolution_message_id
  );

-- =============================================================================
-- ── 3. Fecha conversas LID consolidadas via alias ────────────────────────────
-- =============================================================================
WITH pares_fechar_alias AS (
  SELECT
    lid_c.id      AS conversa_lid_id,
    a.conversa_id AS conversa_canonica_id
  FROM conversas_whatsapp lid_c
  JOIN whatsapp_conversa_aliases a
    ON a.lid = COALESCE(
         NULLIF(lid_c.dados_extras->>'lid', ''),
         CASE WHEN lid_c.telefone LIKE 'LID:%'
              THEN substring(lid_c.telefone FROM 5) ELSE NULL END,
         CASE WHEN lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%'
              THEN lid_c.telefone ELSE NULL END
       )
  JOIN conversas_whatsapp canon_c
    ON canon_c.id    = a.conversa_id
   AND canon_c.id   != lid_c.id
   AND canon_c.status NOT IN ('FECHADA','PENDENTE_IDENTIFICACAO')
  WHERE (
         lid_c.telefone LIKE 'LID:%'
      OR (lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%')
      OR lid_c.dados_extras->>'tipo_identidade' IN ('lid','lid_nao_resolvido')
    )
    AND lid_c.status NOT IN ('FECHADA')
)
UPDATE conversas_whatsapp cw
SET
  status        = 'FECHADA',
  visivel       = false,
  atualizado_em = NOW(),
  dados_extras  = COALESCE(cw.dados_extras, '{}'::jsonb) || jsonb_build_object(
    'merged_reason',           'lid_duplicate_fix_v42',
    'merged_at',               NOW()::text,
    'merged_into_conversa_id', p.conversa_canonica_id
  )
FROM pares_fechar_alias p
WHERE cw.id = p.conversa_lid_id;

-- =============================================================================
-- ── 4. Fecha conversas LID consolidadas via lead_id ─────────────────────────
-- =============================================================================
WITH pares_fechar_lead AS (
  SELECT
    lid_c.id   AS conversa_lid_id,
    canon_c.id AS conversa_canonica_id,
    lid_c.lead_id
  FROM conversas_whatsapp lid_c
  JOIN conversas_whatsapp canon_c
    ON canon_c.lead_id = lid_c.lead_id
   AND canon_c.id     != lid_c.id
   AND NOT (canon_c.telefone LIKE 'LID:%')
   AND NOT (canon_c.telefone ~ '^[0-9]{14,}$' AND canon_c.telefone NOT LIKE '55%')
   AND canon_c.status NOT IN ('FECHADA','PENDENTE_IDENTIFICACAO')
  WHERE lid_c.lead_id IS NOT NULL
    AND (
         lid_c.telefone LIKE 'LID:%'
      OR (lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%')
      OR lid_c.dados_extras->>'tipo_identidade' IN ('lid','lid_nao_resolvido')
    )
    AND lid_c.status NOT IN ('FECHADA')
)
UPDATE conversas_whatsapp cw
SET
  status        = 'FECHADA',
  visivel       = false,
  atualizado_em = NOW(),
  dados_extras  = COALESCE(cw.dados_extras, '{}'::jsonb) || jsonb_build_object(
    'merged_reason',        'lid_duplicate_lead_id_fix_v42',
    'merged_at',            NOW()::text,
    'merged_into_lead_id',  p.lead_id
  )
FROM pares_fechar_lead p
WHERE cw.id = p.conversa_lid_id;

-- =============================================================================
-- ── 5. Marca LID sem canônica como PENDENTE + visivel=false ─────────────────
-- =============================================================================
UPDATE conversas_whatsapp cw
SET
  status        = 'PENDENTE_IDENTIFICACAO',
  visivel       = false,
  atualizado_em = NOW(),
  dados_extras  = COALESCE(cw.dados_extras, '{}'::jsonb) || jsonb_build_object(
    'tipo_identidade', 'lid_nao_resolvido',
    'oculta_motivo',   'lid_sem_canonico_v42',
    'oculta_em',       NOW()::text
  )
WHERE (
       cw.telefone LIKE 'LID:%'
    OR (cw.telefone ~ '^[0-9]{14,}$' AND cw.telefone NOT LIKE '55%')
    OR cw.dados_extras->>'tipo_identidade' IN ('lid','lid_nao_resolvido')
  )
  AND cw.status NOT IN ('FECHADA','PENDENTE_IDENTIFICACAO');

-- =============================================================================
-- ── 6. Backfill visivel=false para conversas PENDENTE já existentes ──────────
-- =============================================================================
UPDATE conversas_whatsapp
SET visivel = false, atualizado_em = NOW()
WHERE status = 'PENDENTE_IDENTIFICACAO'
  AND (visivel IS NULL OR visivel = true);

-- =============================================================================
-- ── 7. Backfill aliases de conversas ativas com telefone real ────────────────
-- =============================================================================
INSERT INTO whatsapp_conversa_aliases (id, conversa_id, telefone_normalizado, criado_em, atualizado_em)
SELECT
  encode(gen_random_bytes(16), 'hex'), c.id, c.telefone, NOW(), NOW()
FROM conversas_whatsapp c
WHERE c.telefone IS NOT NULL
  AND c.telefone NOT LIKE 'LID:%'
  AND c.telefone ~ '^[0-9]{10,13}$'
  AND c.status NOT IN ('FECHADA','PENDENTE_IDENTIFICACAO')
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_conversa_aliases a
    WHERE a.conversa_id = c.id AND a.telefone_normalizado = c.telefone
  )
ON CONFLICT DO NOTHING;

-- ── 8. Índice UNIQUE em lid ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_wca_lid_unique
    ON whatsapp_conversa_aliases (lid)
    WHERE lid IS NOT NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'idx_wca_lid_unique: %', SQLERRM;
END $$;

-- =============================================================================
-- ── 9. CONSULTA DIAGNÓSTICO FINAL — meta: conversas_lid_ativas_visiveis = 0 ─
-- =============================================================================
SELECT
  COUNT(*) FILTER (
    WHERE status NOT IN ('FECHADA','PENDENTE_IDENTIFICACAO')
  )                                                                   AS conversas_ativas,

  COUNT(*) FILTER (
    WHERE status NOT IN ('FECHADA','PENDENTE_IDENTIFICACAO')
      AND (
           telefone LIKE 'LID:%'
        OR (telefone ~ '^[0-9]{14,}$' AND telefone NOT LIKE '55%')
        OR dados_extras->>'tipo_identidade' IN ('lid','lid_nao_resolvido')
      )
  )                                                                   AS conversas_lid_ativas_visiveis,

  COUNT(*) FILTER (
    WHERE status = 'PENDENTE_IDENTIFICACAO'
  )                                                                   AS pendentes_identificacao,

  COUNT(*) FILTER (
    WHERE status = 'FECHADA' AND dados_extras::text LIKE '%v42%'
  )                                                                   AS fechadas_por_este_patch,

  NOW()                                                               AS executado_em
FROM conversas_whatsapp;

-- Top 20 suspeitas restantes (deve estar vazio após patch)
SELECT id, telefone, nome_contato, status, visivel,
       dados_extras->>'tipo_identidade' AS tipo_id, ultima_msg_em
FROM conversas_whatsapp
WHERE status NOT IN ('FECHADA','PENDENTE_IDENTIFICACAO')
  AND (
       telefone LIKE 'LID:%'
    OR (telefone ~ '^[0-9]{14,}$' AND telefone NOT LIKE '55%')
    OR dados_extras->>'tipo_identidade' IN ('lid','lid_nao_resolvido')
  )
ORDER BY ultima_msg_em DESC NULLS LAST
LIMIT 20;
