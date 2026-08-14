-- =============================================================================
-- BACKFILL: layout_virtual_aprovado_em
-- Data: 2026-08-14
-- Motivo: bug onde o sistema limpava layout_virtual_aprovado_em=null ao entrar
--         na etapa "Layout Virtual Aprovado" (regex genérico capturava ambas).
-- =============================================================================
-- SEGURANÇA: apenas UPDATE em leads com campo NULL. Sem DROP/DELETE/TRUNCATE.
-- =============================================================================

-- SEÇÃO 1 — DIAGNÓSTICO (sem efeito colateral)
SELECT
  l.id, l.nome, e.nome AS etapa_atual,
  l.layout_virtual_aprovado_em, l.atualizado_em,
  (SELECT MIN(h.criado_em) FROM lead_etapa_historico h
   WHERE h.lead_id = l.id AND h.etapa_id = l.etapa_id) AS data_entrada_historico
FROM leads l JOIN etapas e ON e.id = l.etapa_id
WHERE e.nome ILIKE '%layout%virtual%aprovado%'
  AND (l.layout_virtual_aprovado_em IS NULL OR l.layout_virtual_aprovado_em::text = '')
ORDER BY l.atualizado_em DESC;

-- SEÇÃO 2A — BACKFILL com histórico real (mais confiável)
UPDATE leads SET layout_virtual_aprovado_em = sub.data_entrada
FROM (
  SELECT l.id AS lead_id, MIN(h.criado_em) AS data_entrada
  FROM leads l
  JOIN etapas e ON e.id = l.etapa_id
  JOIN lead_etapa_historico h ON h.lead_id = l.id AND h.etapa_id = l.etapa_id
  WHERE e.nome ILIKE '%layout%virtual%aprovado%'
    AND (l.layout_virtual_aprovado_em IS NULL OR l.layout_virtual_aprovado_em::text = '')
  GROUP BY l.id
) sub
WHERE leads.id = sub.lead_id
  AND (leads.layout_virtual_aprovado_em IS NULL OR leads.layout_virtual_aprovado_em::text = '');

-- SEÇÃO 2B — Fallback com atualizado_em (descomente se necessário)
-- UPDATE leads SET layout_virtual_aprovado_em = l2.atualizado_em
-- FROM leads l2 JOIN etapas e ON e.id = l2.etapa_id
-- WHERE leads.id = l2.id
--   AND e.nome ILIKE '%layout%virtual%aprovado%'
--   AND (leads.layout_virtual_aprovado_em IS NULL OR leads.layout_virtual_aprovado_em::text = '')
--   AND NOT EXISTS (SELECT 1 FROM lead_etapa_historico h
--     WHERE h.lead_id = l2.id AND h.etapa_id = l2.etapa_id);

-- SEÇÃO 3 — VALIDAÇÃO PÓS-BACKFILL (deve retornar 0)
SELECT COUNT(*) AS leads_sem_data_apos_backfill
FROM leads l JOIN etapas e ON e.id = l.etapa_id
WHERE e.nome ILIKE '%layout%virtual%aprovado%'
  AND (l.layout_virtual_aprovado_em IS NULL OR l.layout_virtual_aprovado_em::text = '');
