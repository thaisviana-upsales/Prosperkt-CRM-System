-- =============================================================================
-- PROSPEKT CRM — Patch v41: WhatsApp LID Deduplicação Runtime Fix
-- Consolida conversas LID ativas que persistiram após o patch v40
-- e registra aliases faltantes a partir de dados_extras.lid
--
-- Seguro: sem DROP, DELETE, TRUNCATE.
-- Pode ser executado múltiplas vezes.
-- =============================================================================

-- ── 0. Garantias de schema ───────────────────────────────────────────────────
ALTER TABLE conversas_whatsapp
  ADD COLUMN IF NOT EXISTS dados_extras JSONB DEFAULT '{}'::jsonb;

-- ── 1. Backfill de aliases a partir de dados_extras.lid ─────────────────────
-- Conversas que têm LID em dados_extras mas NÃO têm alias registrado.
-- Isso resolve o caso de envios feitos ANTES da correção do race condition.
INSERT INTO whatsapp_conversa_aliases (
  id, conversa_id, telefone_normalizado, remote_jid, lid, criado_em, atualizado_em
)
SELECT
  encode(gen_random_bytes(16), 'hex'),
  cw.id                                                                AS conversa_id,
  cw.telefone                                                          AS telefone_normalizado,
  (cw.dados_extras->>'lid') || '@lid'                                  AS remote_jid,
  cw.dados_extras->>'lid'                                              AS lid,
  NOW(),
  NOW()
FROM conversas_whatsapp cw
WHERE cw.dados_extras IS NOT NULL
  AND cw.dados_extras->>'lid' IS NOT NULL
  AND cw.dados_extras->>'lid' <> ''
  AND cw.status != 'FECHADA'
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_conversa_aliases a
    WHERE a.conversa_id = cw.id
      AND a.lid = cw.dados_extras->>'lid'
  )
ON CONFLICT DO NOTHING;

-- ── 2. Identifica conversas LID ativas (alvo de consolidação) ────────────────
-- São conversas com telefone que parece LID:
--   a) telefone LIKE 'LID:%'
--   b) telefone numérico com 14+ dígitos sem prefixo 55
--   c) dados_extras.tipo_identidade = 'lid'
-- E que têm status diferente de FECHADA.

-- ── 2a. Move mensagens: LID → canônica via alias ─────────────────────────────
-- Para cada conversa LID que tem alias apontando para uma conversa canônica.
UPDATE mensagens_whatsapp m
SET conversa_id = a.conversa_id
FROM conversas_whatsapp cw_lid
JOIN whatsapp_conversa_aliases a
  ON a.lid = COALESCE(
       NULLIF(cw_lid.dados_extras->>'lid', ''),
       CASE WHEN cw_lid.telefone LIKE 'LID:%'
            THEN substring(cw_lid.telefone FROM 5)
            ELSE NULL END,
       CASE WHEN cw_lid.telefone ~ '^[0-9]{14,}$' AND cw_lid.telefone NOT LIKE '55%'
            THEN cw_lid.telefone
            ELSE NULL END
     )
JOIN conversas_whatsapp cw_canon
  ON cw_canon.id = a.conversa_id
 AND cw_canon.id != cw_lid.id
 AND cw_canon.status != 'FECHADA'
WHERE m.conversa_id = cw_lid.id
  AND (
       cw_lid.telefone LIKE 'LID:%'
    OR (cw_lid.telefone ~ '^[0-9]{14,}$' AND cw_lid.telefone NOT LIKE '55%')
    OR cw_lid.dados_extras->>'tipo_identidade' = 'lid'
  )
  AND cw_lid.status != 'FECHADA'
  AND NOT EXISTS (
    SELECT 1 FROM mensagens_whatsapp m2
    WHERE m2.conversa_id = a.conversa_id
      AND m2.evolution_message_id IS NOT NULL
      AND m2.evolution_message_id = m.evolution_message_id
  );

-- ── 2b. Move mensagens: LID → canônica via lead_id ───────────────────────────
-- Para conversas LID que compartilham lead_id com uma conversa canônica.
UPDATE mensagens_whatsapp m
SET conversa_id = cw_canon.id
FROM conversas_whatsapp cw_lid
JOIN conversas_whatsapp cw_canon
  ON cw_canon.lead_id = cw_lid.lead_id
 AND cw_canon.id     != cw_lid.id
 AND NOT (cw_canon.telefone LIKE 'LID:%')
 AND NOT (cw_canon.telefone ~ '^[0-9]{14,}$' AND cw_canon.telefone NOT LIKE '55%')
 AND cw_canon.status != 'FECHADA'
WHERE m.conversa_id = cw_lid.id
  AND cw_lid.lead_id IS NOT NULL
  AND (
       cw_lid.telefone LIKE 'LID:%'
    OR (cw_lid.telefone ~ '^[0-9]{14,}$' AND cw_lid.telefone NOT LIKE '55%')
    OR cw_lid.dados_extras->>'tipo_identidade' = 'lid'
  )
  AND cw_lid.status != 'FECHADA'
  AND NOT EXISTS (
    SELECT 1 FROM mensagens_whatsapp m2
    WHERE m2.conversa_id = cw_canon.id
      AND m2.evolution_message_id IS NOT NULL
      AND m2.evolution_message_id = m.evolution_message_id
  );

-- ── 3. Fecha conversas LID consolidadas via alias ────────────────────────────
-- FIX 42702: cw_lid.dados_extras qualificado com alias "cw_lid"
UPDATE conversas_whatsapp cw_lid
SET
  status        = 'FECHADA',
  atualizado_em = NOW(),
  dados_extras  = COALESCE(cw_lid.dados_extras, '{}'::jsonb) || jsonb_build_object(
    'merged_reason',          'lid_duplicate_runtime_fix_v41',
    'merged_at',              NOW()::text,
    'merged_into_conversa_id', a.conversa_id
  )
FROM whatsapp_conversa_aliases a
JOIN conversas_whatsapp cw_canon
  ON cw_canon.id = a.conversa_id
 AND cw_canon.id != cw_lid.id
 AND cw_canon.status != 'FECHADA'
WHERE a.lid = COALESCE(
       NULLIF(cw_lid.dados_extras->>'lid', ''),
       CASE WHEN cw_lid.telefone LIKE 'LID:%'
            THEN substring(cw_lid.telefone FROM 5)
            ELSE NULL END,
       CASE WHEN cw_lid.telefone ~ '^[0-9]{14,}$' AND cw_lid.telefone NOT LIKE '55%'
            THEN cw_lid.telefone
            ELSE NULL END
     )
  AND (
       cw_lid.telefone LIKE 'LID:%'
    OR (cw_lid.telefone ~ '^[0-9]{14,}$' AND cw_lid.telefone NOT LIKE '55%')
    OR cw_lid.dados_extras->>'tipo_identidade' = 'lid'
  )
  AND cw_lid.status != 'FECHADA';

-- ── 4. Fecha conversas LID consolidadas via lead_id ─────────────────────────
-- FIX 42702: cw_lid.dados_extras qualificado com alias "cw_lid"
UPDATE conversas_whatsapp cw_lid
SET
  status        = 'FECHADA',
  atualizado_em = NOW(),
  dados_extras  = COALESCE(cw_lid.dados_extras, '{}'::jsonb) || jsonb_build_object(
    'merged_reason',          'lid_duplicate_lead_id_fix_v41',
    'merged_at',              NOW()::text,
    'merged_into_lead_id',    cw_lid.lead_id
  )
FROM conversas_whatsapp cw_canon
WHERE cw_canon.lead_id = cw_lid.lead_id
  AND cw_canon.id     != cw_lid.id
  AND NOT (cw_canon.telefone LIKE 'LID:%')
  AND NOT (cw_canon.telefone ~ '^[0-9]{14,}$' AND cw_canon.telefone NOT LIKE '55%')
  AND cw_canon.status != 'FECHADA'
  AND cw_lid.lead_id  IS NOT NULL
  AND (
       cw_lid.telefone LIKE 'LID:%'
    OR (cw_lid.telefone ~ '^[0-9]{14,}$' AND cw_lid.telefone NOT LIKE '55%')
    OR cw_lid.dados_extras->>'tipo_identidade' = 'lid'
  )
  AND cw_lid.status != 'FECHADA';

-- ── 5. Marca conversas LID sem canônica como PENDENTE_IDENTIFICACAO ──────────
-- Conversas LID que NÃO têm uma canônica correspondente ficam ocultas da lista.
-- FIX 42702: cw.dados_extras qualificado com alias "cw"
UPDATE conversas_whatsapp cw
SET
  status        = 'PENDENTE_IDENTIFICACAO',
  atualizado_em = NOW(),
  dados_extras  = COALESCE(cw.dados_extras, '{}'::jsonb) || jsonb_build_object(
    'tipo_identidade',  'lid',
    'oculta_motivo',    'lid_sem_canonico_v41',
    'oculta_em',        NOW()::text
  )
WHERE (
       cw.telefone LIKE 'LID:%'
    OR (cw.telefone ~ '^[0-9]{14,}$' AND cw.telefone NOT LIKE '55%')
    OR cw.dados_extras->>'tipo_identidade' = 'lid'
  )
  AND cw.status NOT IN ('FECHADA', 'PENDENTE_IDENTIFICACAO');

-- ── 6. Backfill geral: aliases de conversas ativas com telefone real ─────────
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
  AND c.status NOT IN ('FECHADA', 'PENDENTE_IDENTIFICACAO')
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_conversa_aliases a
    WHERE a.conversa_id          = c.id
      AND a.telefone_normalizado = c.telefone
  )
ON CONFLICT DO NOTHING;

-- ── 7. Índice UNIQUE em lid (previne aliases duplicados por LID) ─────────────
-- Nota: pode falhar se já houver duplicatas — nesse caso executa primeiro o
-- DELETE de duplicatas abaixo e re-execute o CREATE.
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_wca_lid_unique
    ON whatsapp_conversa_aliases (lid)
    WHERE lid IS NOT NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'idx_wca_lid_unique: %', SQLERRM;
END $$;

-- ── 8. Relatório diagnóstico final ───────────────────────────────────────────
SELECT
  'patch_v41_ok'                                                                AS resultado,

  -- Conversas ativas normais (exclui LID e PENDENTE)
  (SELECT count(*) FROM conversas_whatsapp
   WHERE status NOT IN ('FECHADA', 'PENDENTE_IDENTIFICACAO'))                   AS conversas_ativas_total,

  -- LID ainda ativas na lista principal (meta = 0)
  (SELECT count(*) FROM conversas_whatsapp
   WHERE status NOT IN ('FECHADA', 'PENDENTE_IDENTIFICACAO')
     AND (
          telefone LIKE 'LID:%'
       OR (telefone ~ '^[0-9]{14,}$' AND telefone NOT LIKE '55%')
       OR dados_extras->>'tipo_identidade' = 'lid'
     )
  )                                                                              AS conversas_lid_na_lista_principal_meta_zero,

  -- Conversas marcadas como PENDENTE (ocultas)
  (SELECT count(*) FROM conversas_whatsapp
   WHERE status = 'PENDENTE_IDENTIFICACAO')                                      AS conversas_pendente_identificacao,

  -- Conversas fechadas por este patch
  (SELECT count(*) FROM conversas_whatsapp cw_r
   WHERE cw_r.status = 'FECHADA'
     AND cw_r.dados_extras::text LIKE '%v41%')                                   AS conversas_fechadas_neste_patch,

  -- Total de aliases
  (SELECT count(*) FROM whatsapp_conversa_aliases)                               AS total_aliases,

  -- Aliases com LID mapeado
  (SELECT count(*) FROM whatsapp_conversa_aliases WHERE lid IS NOT NULL)         AS aliases_com_lid,

  -- Top 20 conversas suspeitas ainda abertas (telefone parece LID mas não foi fechado)
  NOW()                                                                           AS executado_em;

-- Top 20 conversas suspeitas
SELECT
  id,
  telefone,
  nome_contato,
  status,
  lead_id,
  dados_extras->>'lid'                         AS lid_em_dados_extras,
  dados_extras->>'tipo_identidade'             AS tipo_identidade,
  ultima_msg_em
FROM conversas_whatsapp
WHERE status NOT IN ('FECHADA', 'PENDENTE_IDENTIFICACAO')
  AND (
       telefone LIKE 'LID:%'
    OR (telefone ~ '^[0-9]{14,}$' AND telefone NOT LIKE '55%')
    OR dados_extras->>'tipo_identidade' = 'lid'
  )
ORDER BY ultima_msg_em DESC NULLS LAST
LIMIT 20;
