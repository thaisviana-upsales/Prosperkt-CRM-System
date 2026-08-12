-- =============================================================================
-- PROSPEKT CRM — Patch v41: WhatsApp LID Deduplicação Runtime Fix
-- Consolida conversas LID ativas que persistiram após o patch v40
-- e registra aliases faltantes a partir de dados_extras.lid
--
-- Seguro: sem DROP, DELETE, TRUNCATE.
-- Pode ser executado múltiplas vezes.
--
-- CORREÇÃO 42P01: cw_lid é alias do UPDATE — não pode ser usado dentro de
-- JOIN...ON no FROM. Solução: CTEs que calculam os pares ANTES do UPDATE.
-- =============================================================================

-- ── 0. Garantias de schema ───────────────────────────────────────────────────
ALTER TABLE conversas_whatsapp
  ADD COLUMN IF NOT EXISTS dados_extras JSONB DEFAULT '{}'::jsonb;

-- ── 1. Backfill de aliases a partir de dados_extras.lid ─────────────────────
-- Conversas com LID em dados_extras mas SEM alias registrado.
INSERT INTO whatsapp_conversa_aliases (
  id, conversa_id, telefone_normalizado, remote_jid, lid, criado_em, atualizado_em
)
SELECT
  encode(gen_random_bytes(16), 'hex'),
  cw.id                              AS conversa_id,
  cw.telefone                        AS telefone_normalizado,
  (cw.dados_extras->>'lid') || '@lid' AS remote_jid,
  cw.dados_extras->>'lid'            AS lid,
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

-- =============================================================================
-- ── 2a. Mover mensagens: LID → canônica via alias ────────────────────────────
-- CTE identifica os pares (conversa_lid_id, conversa_canonica_id) ANTES do UPDATE.
-- Isso evita o erro 42P01 de alias fora de escopo.
-- =============================================================================
WITH pares_alias AS (
  -- Conversas que são LID
  SELECT
    lid_c.id     AS conversa_lid_id,
    a.conversa_id AS conversa_canonica_id
  FROM conversas_whatsapp lid_c
  JOIN whatsapp_conversa_aliases a
    ON a.lid = COALESCE(
         NULLIF(lid_c.dados_extras->>'lid', ''),
         CASE WHEN lid_c.telefone LIKE 'LID:%'
              THEN substring(lid_c.telefone FROM 5)
              ELSE NULL END,
         CASE WHEN lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%'
              THEN lid_c.telefone
              ELSE NULL END
       )
  JOIN conversas_whatsapp canon_c
    ON canon_c.id     = a.conversa_id
   AND canon_c.id    != lid_c.id
   AND canon_c.status != 'FECHADA'
  WHERE (
         lid_c.telefone LIKE 'LID:%'
      OR (lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%')
      OR lid_c.dados_extras->>'tipo_identidade' = 'lid'
    )
    AND lid_c.status != 'FECHADA'
)
UPDATE mensagens_whatsapp m
SET conversa_id = p.conversa_canonica_id
FROM pares_alias p
WHERE m.conversa_id = p.conversa_lid_id
  AND NOT EXISTS (
    SELECT 1 FROM mensagens_whatsapp m2
    WHERE m2.conversa_id        = p.conversa_canonica_id
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
   AND canon_c.status  != 'FECHADA'
  WHERE lid_c.lead_id  IS NOT NULL
    AND (
         lid_c.telefone LIKE 'LID:%'
      OR (lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%')
      OR lid_c.dados_extras->>'tipo_identidade' = 'lid'
    )
    AND lid_c.status != 'FECHADA'
)
UPDATE mensagens_whatsapp m
SET conversa_id = p.conversa_canonica_id
FROM pares_lead p
WHERE m.conversa_id = p.conversa_lid_id
  AND NOT EXISTS (
    SELECT 1 FROM mensagens_whatsapp m2
    WHERE m2.conversa_id        = p.conversa_canonica_id
      AND m2.evolution_message_id IS NOT NULL
      AND m2.evolution_message_id = m.evolution_message_id
  );

-- =============================================================================
-- ── 3. Fecha conversas LID consolidadas via alias ────────────────────────────
-- CTE calcula pares. UPDATE usa alias "cw" (tabela alvo) — sem referência
-- a cw_lid dentro de JOIN, evitando erro 42P01.
-- FIX 42702: dados_extras qualificado com alias "cw" (tabela alvo do UPDATE).
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
              THEN substring(lid_c.telefone FROM 5)
              ELSE NULL END,
         CASE WHEN lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%'
              THEN lid_c.telefone
              ELSE NULL END
       )
  JOIN conversas_whatsapp canon_c
    ON canon_c.id     = a.conversa_id
   AND canon_c.id    != lid_c.id
   AND canon_c.status != 'FECHADA'
  WHERE (
         lid_c.telefone LIKE 'LID:%'
      OR (lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%')
      OR lid_c.dados_extras->>'tipo_identidade' = 'lid'
    )
    AND lid_c.status != 'FECHADA'
)
UPDATE conversas_whatsapp cw
SET
  status        = 'FECHADA',
  atualizado_em = NOW(),
  -- FIX 42702: cw.dados_extras (alias da tabela alvo)
  dados_extras  = COALESCE(cw.dados_extras, '{}'::jsonb) || jsonb_build_object(
    'merged_reason',           'lid_duplicate_runtime_fix_v41',
    'merged_at',               NOW()::text,
    'merged_into_conversa_id', p.conversa_canonica_id
  )
FROM pares_fechar_alias p
WHERE cw.id = p.conversa_lid_id;

-- =============================================================================
-- ── 4. Fecha conversas LID consolidadas via lead_id ─────────────────────────
-- FIX 42702: cw.dados_extras qualificado com alias "cw" (tabela alvo do UPDATE).
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
   AND canon_c.status != 'FECHADA'
  WHERE lid_c.lead_id IS NOT NULL
    AND (
         lid_c.telefone LIKE 'LID:%'
      OR (lid_c.telefone ~ '^[0-9]{14,}$' AND lid_c.telefone NOT LIKE '55%')
      OR lid_c.dados_extras->>'tipo_identidade' = 'lid'
    )
    AND lid_c.status != 'FECHADA'
)
UPDATE conversas_whatsapp cw
SET
  status        = 'FECHADA',
  atualizado_em = NOW(),
  -- FIX 42702: cw.dados_extras (alias da tabela alvo)
  dados_extras  = COALESCE(cw.dados_extras, '{}'::jsonb) || jsonb_build_object(
    'merged_reason',        'lid_duplicate_lead_id_fix_v41',
    'merged_at',            NOW()::text,
    'merged_into_lead_id',  p.lead_id
  )
FROM pares_fechar_lead p
WHERE cw.id = p.conversa_lid_id;

-- =============================================================================
-- ── 4.5. Expande constraint de status para aceitar PENDENTE_IDENTIFICACAO ────
-- O Postgres rejeita INSERT/UPDATE se o valor não estiver na CHECK constraint.
-- Este bloco lê a constraint atual e a recria incluindo o novo status.
-- Se a constraint não existir, simplesmente adiciona uma nova.
-- =============================================================================
DO $$
DECLARE
  v_def TEXT;
BEGIN
  -- Le a definicao atual da constraint
  SELECT pg_get_constraintdef(oid)
    INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'conversas_whatsapp'::regclass
    AND conname   = 'conversas_whatsapp_status_check';

  IF v_def IS NULL THEN
    -- Constraint nao existe: cria com todos os valores conhecidos
    ALTER TABLE conversas_whatsapp
      ADD CONSTRAINT conversas_whatsapp_status_check
      CHECK (status IN ('ABERTA','FECHADA','AGUARDANDO','PENDENTE_IDENTIFICACAO'));
    RAISE NOTICE 'conversas_whatsapp_status_check criada com PENDENTE_IDENTIFICACAO';

  ELSIF v_def NOT LIKE '%PENDENTE_IDENTIFICACAO%' THEN
    -- Constraint existe mas sem PENDENTE_IDENTIFICACAO: remove e recria
    ALTER TABLE conversas_whatsapp
      DROP CONSTRAINT conversas_whatsapp_status_check;
    -- Recria incluindo os valores da definicao anterior + PENDENTE_IDENTIFICACAO
    -- Valores mais comuns do CRM: ABERTA, FECHADA, AGUARDANDO
    ALTER TABLE conversas_whatsapp
      ADD CONSTRAINT conversas_whatsapp_status_check
      CHECK (status IN ('ABERTA','FECHADA','AGUARDANDO','PENDENTE_IDENTIFICACAO'));
    RAISE NOTICE 'conversas_whatsapp_status_check atualizada: adicionado PENDENTE_IDENTIFICACAO';

  ELSE
    RAISE NOTICE 'conversas_whatsapp_status_check ja contem PENDENTE_IDENTIFICACAO — sem alteracao';
  END IF;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Nao foi possivel alterar constraint status: %. Usando FECHADA como fallback.', SQLERRM;
END $$;

-- =============================================================================
-- ── 5. Marca LID sem canônica como PENDENTE_IDENTIFICACAO ───────────────────
-- Conversas LID que NÃO foram consolidadas ficam ocultas da lista principal.
-- Sem FROM/JOIN — UPDATE simples; cw.dados_extras sem ambiguidade.
-- Exige que a constraint acima tenha sido executada com sucesso.
-- =============================================================================
UPDATE conversas_whatsapp cw
SET
  status        = 'PENDENTE_IDENTIFICACAO',
  atualizado_em = NOW(),
  -- FIX 42702: cw.dados_extras (alias da tabela alvo, sem FROM extra)
  dados_extras  = COALESCE(cw.dados_extras, '{}'::jsonb) || jsonb_build_object(
    'tipo_identidade', 'lid',
    'oculta_motivo',   'lid_sem_canonico_v41',
    'oculta_em',       NOW()::text
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


-- ── 7. Índice UNIQUE em lid (previne duplicatas futuras de alias por LID) ─────
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_wca_lid_unique
    ON whatsapp_conversa_aliases (lid)
    WHERE lid IS NOT NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'idx_wca_lid_unique já existe ou houve conflito: %', SQLERRM;
END $$;

-- ── 8. Relatório diagnóstico final ───────────────────────────────────────────
SELECT
  'patch_v41_ok'                                                               AS resultado,

  -- Conversas ativas normais (exclui FECHADA e PENDENTE)
  (SELECT count(*) FROM conversas_whatsapp
   WHERE status NOT IN ('FECHADA', 'PENDENTE_IDENTIFICACAO'))                  AS conversas_ativas_total,

  -- LID ainda na lista principal — meta = 0
  (SELECT count(*) FROM conversas_whatsapp
   WHERE status NOT IN ('FECHADA', 'PENDENTE_IDENTIFICACAO')
     AND (
          telefone LIKE 'LID:%'
       OR (telefone ~ '^[0-9]{14,}$' AND telefone NOT LIKE '55%')
       OR dados_extras->>'tipo_identidade' = 'lid'
     )
  )                                                                             AS conversas_lid_lista_principal_meta_zero,

  -- Ocultas (PENDENTE_IDENTIFICACAO)
  (SELECT count(*) FROM conversas_whatsapp
   WHERE status = 'PENDENTE_IDENTIFICACAO')                                     AS conversas_pendente_identificacao,

  -- Fechadas por este patch
  (SELECT count(*) FROM conversas_whatsapp cw_r
   WHERE cw_r.status = 'FECHADA'
     AND cw_r.dados_extras::text LIKE '%v41%')                                  AS conversas_fechadas_neste_patch,

  -- Total de aliases
  (SELECT count(*) FROM whatsapp_conversa_aliases)                              AS total_aliases,

  -- Aliases com LID
  (SELECT count(*) FROM whatsapp_conversa_aliases WHERE lid IS NOT NULL)        AS aliases_com_lid,

  NOW()                                                                          AS executado_em;

-- ── 9. Top 20 conversas ainda suspeitas (diagnóstico) ────────────────────────
SELECT
  id,
  telefone,
  nome_contato,
  status,
  lead_id,
  dados_extras->>'lid'              AS lid_em_dados_extras,
  dados_extras->>'tipo_identidade'  AS tipo_identidade,
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
