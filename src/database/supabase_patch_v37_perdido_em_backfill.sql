-- ============================================================
-- PROSPERKT CRM — Patch v37: Backfill perdido_em para leads antigos
-- Executar no Supabase SQL Editor
-- SEGURO: apenas UPDATE — sem DROP, DELETE, TRUNCATE
-- ============================================================

-- ── Contexto ──────────────────────────────────────────────────────────────────
-- Bug identificado: perdido_em ficava NULL quando lead era marcado como perdido
-- sem preencher motivo_perda (condicional errada no leadsController.js).
-- Este patch corrige os dados históricos já existentes no banco.
--
-- Estratégia de backfill (da mais precisa para a menos precisa):
--   1. Tenta usar o evento mais recente de "perdido" na tabela lead_timeline.
--   2. Fallback: usa atualizado_em (melhor aproximação disponível).
--
-- NÃO inventa datas para leads sem nenhum histórico.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Diagnóstico antes do backfill ─────────────────────────────────────────
SELECT
  COUNT(*) AS total_perdidos_sem_data,
  MIN(atualizado_em) AS mais_antigo,
  MAX(atualizado_em) AS mais_recente
FROM public.leads
WHERE (status = 'PERDIDO' OR motivo_perda IS NOT NULL OR perdido_motivo IS NOT NULL)
  AND perdido_em IS NULL;

-- ── 2. Backfill usando data do evento na timeline (mais preciso) ──────────────
-- Lead_timeline registra tipo_acao='PERDA' ou similar quando o lead foi perdido.
UPDATE public.leads l
   SET perdido_em = (
     SELECT t.criado_em
       FROM public.lead_timeline t
      WHERE t.lead_id = l.id
        AND (
          t.tipo_acao ILIKE '%perd%'
          OR t.tipo_acao ILIKE '%perda%'
          OR t.tipo_acao ILIKE '%PERDA%'
          OR t.descricao ILIKE '%perdido%'
        )
      ORDER BY t.criado_em DESC
      LIMIT 1
   )
 WHERE (l.status = 'PERDIDO' OR l.motivo_perda IS NOT NULL OR l.perdido_motivo IS NOT NULL)
   AND l.perdido_em IS NULL
   AND EXISTS (
     SELECT 1 FROM public.lead_timeline t2
      WHERE t2.lead_id = l.id
        AND (
          t2.tipo_acao ILIKE '%perd%'
          OR t2.descricao ILIKE '%perdido%'
        )
   );

-- ── 3. Backfill usando atualizado_em para o restante (sem evento na timeline) ─
-- Usa atualizado_em como melhor aproximação disponível para leads sem histórico.
UPDATE public.leads
   SET perdido_em = atualizado_em
 WHERE (status = 'PERDIDO' OR motivo_perda IS NOT NULL OR perdido_motivo IS NOT NULL)
   AND perdido_em IS NULL
   AND atualizado_em IS NOT NULL;

-- ── 4. Diagnóstico após backfill ──────────────────────────────────────────────
SELECT
  COUNT(*) AS total_perdidos,
  COUNT(perdido_em) AS com_perdido_em_preenchido,
  COUNT(*) - COUNT(perdido_em) AS ainda_sem_data
FROM public.leads
WHERE status = 'PERDIDO' OR motivo_perda IS NOT NULL OR perdido_motivo IS NOT NULL;

-- ── 5. Amostra dos registros atualizados ──────────────────────────────────────
SELECT id, nome, status, motivo_perda, perdido_em, atualizado_em
  FROM public.leads
 WHERE (status = 'PERDIDO' OR motivo_perda IS NOT NULL)
 ORDER BY perdido_em DESC NULLS LAST
 LIMIT 20;

-- ============================================================
-- FIM DO PATCH v37
-- EXECUTE NO SUPABASE: SQL Editor → New Query → Run
-- ============================================================
