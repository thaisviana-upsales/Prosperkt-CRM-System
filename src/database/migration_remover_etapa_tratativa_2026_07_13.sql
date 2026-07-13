-- ============================================================
-- MIGRATION: Remover Etapa "Tratativa em andamento" de Todos os Funis
-- Data: 2026-07-13
-- Exec: Supabase SQL Editor (idempotente — pode re-executar)
-- ============================================================
--
-- ETAPAS QUE SERÃO OCULTADAS (variações de "Tratativa"):
--   Em Tratativa
--   Tratativa em andamento
--   Tratativa em Andamento
--   Tratativa
--   Contato em Tratativa
--
-- NÃO REMOVE dados de leads.
-- NÃO REMOVE histórico.
-- Realoca leads para a primeira etapa segura do mesmo funil.
-- ============================================================

-- ── PASSO 1: Adiciona coluna 'oculta' na tabela etapas (se não existir) ────────
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS oculta BOOLEAN DEFAULT FALSE;

-- ── PASSO 2: Identifica as etapas de Tratativa ─────────────────────────────────
-- (apenas para diagnóstico — comente este bloco se não precisar)
SELECT e.id, e.nome, e.pipeline_id, f.nome AS funil_nome,
       (SELECT COUNT(*) FROM leads l WHERE l.etapa_id = e.id) AS total_leads
FROM etapas e
JOIN pipelines p ON e.pipeline_id = p.id
JOIN funis f ON p.funil_id = f.id
WHERE e.nome IN (
  'Em Tratativa',
  'Tratativa em andamento',
  'Tratativa em Andamento',
  'Tratativa',
  'Contato em Tratativa'
);

-- ── PASSO 3: Realoca leads da etapa Tratativa para etapa segura ────────────────
-- Realoca para "Contato Realizado" do mesmo funil, se existir.
-- Fallback: "Lead Recebido". Fallback final: primeira etapa (não-perdida/não-venda).
-- COUNT DISTINCT garante que cada lead seja realocado apenas uma vez.

DO $$
DECLARE
  rec RECORD;
  etapa_destino_id TEXT;
  funil_nome_txt TEXT;
  log_id TEXT;
  total_realocados INT := 0;
BEGIN
  FOR rec IN
    SELECT DISTINCT e.id AS etapa_trat_id, p.funil_id, f.nome AS funil_nome
    FROM etapas e
    JOIN pipelines p ON e.pipeline_id = p.id
    JOIN funis f ON p.funil_id = f.id
    WHERE e.nome IN (
      'Em Tratativa',
      'Tratativa em andamento',
      'Tratativa em Andamento',
      'Tratativa',
      'Contato em Tratativa'
    )
  LOOP
    funil_nome_txt := rec.funil_nome;

    -- Tenta "Contato Realizado"
    SELECT e2.id INTO etapa_destino_id
    FROM etapas e2
    JOIN pipelines p2 ON e2.pipeline_id = p2.id
    WHERE p2.funil_id = rec.funil_id
      AND e2.nome = 'Contato Realizado'
    LIMIT 1;

    -- Fallback: "Lead Recebido"
    IF etapa_destino_id IS NULL THEN
      SELECT e2.id INTO etapa_destino_id
      FROM etapas e2
      JOIN pipelines p2 ON e2.pipeline_id = p2.id
      WHERE p2.funil_id = rec.funil_id
        AND e2.nome = 'Lead Recebido'
      LIMIT 1;
    END IF;

    -- Fallback final: primeira etapa ativa, não-perdida, não-venda
    IF etapa_destino_id IS NULL THEN
      SELECT e2.id INTO etapa_destino_id
      FROM etapas e2
      JOIN pipelines p2 ON e2.pipeline_id = p2.id
      WHERE p2.funil_id = rec.funil_id
        AND COALESCE(e2.is_perdido, 0) = 0
        AND COALESCE(e2.is_ganho, 0) = 0
        AND e2.id <> rec.etapa_trat_id
      ORDER BY e2.ordem ASC
      LIMIT 1;
    END IF;

    -- Só realoca se encontrou destino seguro
    IF etapa_destino_id IS NOT NULL THEN
      UPDATE leads
      SET etapa_id = etapa_destino_id,
          atualizado_em = NOW()
      WHERE etapa_id = rec.etapa_trat_id;

      GET DIAGNOSTICS total_realocados = ROW_COUNT;

      -- Registra no log de auditoria para cada lead realocado (via INSERT nos logs)
      IF total_realocados > 0 THEN
        INSERT INTO logs (id, acao, entidade, entidade_id, depois, criado_em)
        SELECT
          gen_random_uuid()::TEXT,
          'SISTEMA_REALOCACAO',
          'leads',
          l.id,
          jsonb_build_object(
            'mensagem', 'Card realocado automaticamente porque a etapa Tratativa em andamento foi removida da pipeline.',
            'etapa_origem_nome', 'Em Tratativa / Tratativa em andamento',
            'etapa_destino_id', etapa_destino_id,
            'funil', funil_nome_txt
          )::TEXT,
          NOW()
        FROM leads l
        WHERE l.etapa_id = etapa_destino_id
          AND l.funil_id = rec.funil_id;

        RAISE NOTICE 'Funil %: % leads realocados para etapa %', funil_nome_txt, total_realocados, etapa_destino_id;
      END IF;
    ELSE
      RAISE NOTICE 'Funil %: nenhuma etapa de destino encontrada — nenhum lead realocado.', funil_nome_txt;
    END IF;
  END LOOP;
END $$;

-- ── PASSO 4: Marca as etapas Tratativa como ocultas ───────────────────────────
UPDATE etapas
SET oculta = TRUE,
    atualizado_em = NOW()
WHERE nome IN (
  'Em Tratativa',
  'Tratativa em andamento',
  'Tratativa em Andamento',
  'Tratativa',
  'Contato em Tratativa'
);

-- ── PASSO 5: Verificação final ─────────────────────────────────────────────────
SELECT e.id, e.nome, e.oculta,
       (SELECT COUNT(*) FROM leads l WHERE l.etapa_id = e.id) AS leads_restantes
FROM etapas e
WHERE e.nome IN (
  'Em Tratativa',
  'Tratativa em andamento',
  'Tratativa em Andamento',
  'Tratativa',
  'Contato em Tratativa'
);
-- Resultado esperado: oculta=TRUE, leads_restantes=0
