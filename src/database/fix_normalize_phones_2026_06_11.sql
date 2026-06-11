-- ============================================================
-- PROSPEKT CRM — Normalização de Telefones no Banco
-- Arquivo: fix_normalize_phones_2026_06_11.sql
-- Executar NO SUPABASE SQL EDITOR
--
-- OBJETIVO: Padronizar todos os telefones em conversas_whatsapp
-- e leads para o formato canônico 55XXXXXXXXXXX (13 dígitos mobile BR)
-- Isso garante que o webhook da Evolution API consiga fazer match
-- com o que está salvo no banco.
-- ============================================================

-- ── PASSO 0: Diagnóstico (execute antes para ver o que vai mudar) ──
SELECT
  id,
  telefone AS telefone_atual,
  CASE
    WHEN LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) IN (10, 11)
      THEN '55' || REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
    -- Remove DDI duplo 5555XX → 55XX
    WHEN REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') LIKE '5555%'
      AND LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) >= 14
      THEN SUBSTRING(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') FROM 3)
    ELSE REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
  END AS telefone_normalizado
FROM public.conversas_whatsapp
WHERE telefone IS NOT NULL
  AND telefone != CASE
    WHEN LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) IN (10, 11)
      THEN '55' || REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
    WHEN REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') LIKE '5555%'
      AND LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) >= 14
      THEN SUBSTRING(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') FROM 3)
    ELSE REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
  END
ORDER BY criado_em DESC;

-- ── PASSO 1: Normaliza telefones em conversas_whatsapp ────────────
UPDATE public.conversas_whatsapp
SET
  telefone = CASE
    -- Sem DDI (10-11 dígitos): adiciona 55
    WHEN LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) IN (10, 11)
      THEN '55' || REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
    -- DDI duplo 5555XX: remove os primeiros 55
    WHEN REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') LIKE '5555%'
      AND LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) >= 14
      THEN SUBSTRING(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') FROM 3)
    -- Caso geral: remove não-dígitos
    ELSE REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
  END,
  atualizado_em = NOW()
WHERE telefone IS NOT NULL
  AND telefone != CASE
    WHEN LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) IN (10, 11)
      THEN '55' || REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
    WHEN REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') LIKE '5555%'
      AND LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) >= 14
      THEN SUBSTRING(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') FROM 3)
    ELSE REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
  END;

-- ── PASSO 2: Normaliza telefones em mensagens_whatsapp ───────────
UPDATE public.mensagens_whatsapp
SET telefone = CASE
    WHEN LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) IN (10, 11)
      THEN '55' || REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
    WHEN REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') LIKE '5555%'
      AND LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) >= 14
      THEN SUBSTRING(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') FROM 3)
    ELSE REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
  END
WHERE telefone IS NOT NULL
  AND telefone != CASE
    WHEN LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) IN (10, 11)
      THEN '55' || REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
    WHEN REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') LIKE '5555%'
      AND LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) >= 14
      THEN SUBSTRING(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') FROM 3)
    ELSE REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
  END;

-- ── PASSO 3: Normaliza telefones em leads ────────────────────────
UPDATE public.leads
SET telefone = CASE
    WHEN LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) IN (10, 11)
      THEN '55' || REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
    WHEN REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') LIKE '5555%'
      AND LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) >= 14
      THEN SUBSTRING(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') FROM 3)
    ELSE REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
  END
WHERE telefone IS NOT NULL
  AND telefone != CASE
    WHEN LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) IN (10, 11)
      THEN '55' || REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
    WHEN REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') LIKE '5555%'
      AND LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) >= 14
      THEN SUBSTRING(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') FROM 3)
    ELSE REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')
  END;

-- ── VALIDAÇÃO FINAL ──────────────────────────────────────────────
SELECT 'conversas_whatsapp' AS tabela, COUNT(*) AS total,
  SUM(CASE WHEN telefone ~ '^55[0-9]{10,11}$' THEN 1 ELSE 0 END) AS normalizados_br,
  SUM(CASE WHEN telefone NOT LIKE '55%' THEN 1 ELSE 0 END) AS sem_ddi
FROM public.conversas_whatsapp WHERE telefone IS NOT NULL
UNION ALL
SELECT 'leads', COUNT(*),
  SUM(CASE WHEN telefone ~ '^55[0-9]{10,11}$' THEN 1 ELSE 0 END),
  SUM(CASE WHEN telefone IS NOT NULL AND telefone NOT LIKE '55%' THEN 1 ELSE 0 END)
FROM public.leads WHERE telefone IS NOT NULL;
