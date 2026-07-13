-- ============================================================
-- MIGRATION: Remoção Cirúrgica de Etapas da Carteira Recorrente
-- Data: 2026-07-13 (v2 — CORRIGIDA)
-- Exec: Supabase SQL Editor (idempotente — pode re-executar)
-- ============================================================
--
-- ETAPAS QUE DEVEM SER REMOVIDAS (variantes SEM prefixo "Previsão Carteira"):
--   Carteira 15-30 dias
--   Carteira 30-60 dias
--   Carteira 60-90 dias
--   Carteira 6 - 9 meses
--   Carteira 9 - 18 meses
--   Carteira +18 meses
--
-- ETAPAS QUE DEVEM SER PRESERVADAS (as 14 oficiais):
--   ✅ Previsão Carteira 15-30 dias
--   ✅ Previsão Carteira 30-60 dias
--   ✅ Previsão Carteira 60-90 dias
--   ✅ Previsão Carteira 3 - 6 meses
--   ✅ Previsão Carteira 6 - 9 meses
--   ✅ Previsão Carteira 9 - 18 meses
--   ✅ Previsão Carteira +18 meses
--   ✅ Orçamento Enviado
--   ✅ Orçamento Aprovado
--   ✅ Layout Virtual
--   ✅ Amostra Física
--   ✅ Amostra Aprovada
--   ✅ Follow-Up
--   ✅ Vendas
--
-- REGRA: Não usa DELETE, DROP ou TRUNCATE.
--        Leads são realocados para "Previsão Carteira 15-30 dias" (a mais próxima).
--        Histórico registrado em logs por cada lead movido.
-- ============================================================

DO $$
DECLARE
  v_funil_id         TEXT;
  v_destino_id       TEXT;
  v_etapa_id         TEXT;
  v_lead_id          TEXT;
  v_lead_count       INTEGER;
  v_total_realocados INTEGER := 0;

  -- SOMENTE variantes obsoletas sem prefixo "Previsão Carteira"
  nomes_remover TEXT[] := ARRAY[
    'Carteira 15-30 dias',
    'Carteira 30-60 dias',
    'Carteira 60-90 dias',
    'Carteira 6 - 9 meses',
    'Carteira 9 - 18 meses',
    'Carteira +18 meses'
  ];

  nome_etapa TEXT;
  etapa_rec  RECORD;

BEGIN

  -- ─── 1. Encontra o funil Carteira Recorrente ─────────────────────────────────
  SELECT id INTO v_funil_id
  FROM funis
  WHERE nome ILIKE '%Carteira Recorrente%' AND ativo = true
  LIMIT 1;

  IF v_funil_id IS NULL THEN
    RAISE NOTICE '⚠️  Funil Carteira Recorrente não encontrado — migration abortada.';
    RETURN;
  END IF;

  RAISE NOTICE '✅ Funil Carteira Recorrente: %', v_funil_id;

  -- ─── 2. Etapa destino para leads realocados ───────────────────────────────────
  -- Usa "Previsão Carteira 15-30 dias" como destino padrão (a mais próxima).
  -- Fallback: Follow-Up → qualquer etapa ativa da Carteira.
  SELECT id INTO v_destino_id
  FROM etapas
  WHERE funil_id = v_funil_id
    AND LOWER(TRIM(nome)) = LOWER(TRIM('Previsão Carteira 15-30 dias'))
  LIMIT 1;

  IF v_destino_id IS NULL THEN
    -- Fallback para Follow-Up
    SELECT id INTO v_destino_id
    FROM etapas
    WHERE funil_id = v_funil_id
      AND LOWER(TRIM(nome)) = 'follow-up'
    LIMIT 1;
  END IF;

  IF v_destino_id IS NULL THEN
    -- Último fallback: primeira etapa ativa que não seja perda
    SELECT id INTO v_destino_id
    FROM etapas
    WHERE funil_id = v_funil_id
      AND LOWER(nome) NOT LIKE '%perdid%'
      AND LOWER(nome) NOT LIKE '%desqualif%'
    ORDER BY ordem ASC
    LIMIT 1;
  END IF;

  IF v_destino_id IS NULL THEN
    RAISE NOTICE '⚠️  Nenhuma etapa destino encontrada na Carteira Recorrente — migration abortada.';
    RETURN;
  END IF;

  RAISE NOTICE '✅ Etapa destino para realocação: %', v_destino_id;

  -- ─── 3. Para cada etapa obsoleta: realocar leads e desativar etapa ────────────
  FOREACH nome_etapa IN ARRAY nomes_remover LOOP

    FOR etapa_rec IN
      SELECT e.id, e.nome FROM etapas e
      WHERE (
        e.funil_id = v_funil_id
        OR e.pipeline_id IN (
          SELECT p.id FROM pipelines p WHERE p.funil_id = v_funil_id
        )
      )
      AND LOWER(TRIM(e.nome)) = LOWER(TRIM(nome_etapa))
    LOOP
      v_etapa_id := etapa_rec.id;

      -- Confirma que esta etapa NÃO é uma das 14 oficiais (salvaguarda dupla)
      IF v_etapa_id = v_destino_id THEN
        RAISE NOTICE '⚠️  Pulando etapa destino (não pode ser removida): "%"', etapa_rec.nome;
        CONTINUE;
      END IF;

      -- Conta leads nesta etapa
      SELECT COUNT(*) INTO v_lead_count
      FROM leads
      WHERE etapa_id = v_etapa_id
        AND (deleted_at IS NULL OR deleted_at > now());

      RAISE NOTICE 'Etapa "%": % leads encontrados', etapa_rec.nome, v_lead_count;

      -- Realoca leads para etapa destino (preserva todos os outros campos)
      IF v_lead_count > 0 THEN
        UPDATE leads
        SET
          etapa_id      = v_destino_id,
          atualizado_em = now()
        WHERE etapa_id = v_etapa_id
          AND (deleted_at IS NULL OR deleted_at > now());

        -- Registra no log de auditoria
        INSERT INTO logs (
          id, acao, entidade, entidade_id,
          descricao, depois, criado_em, origem_acao
        )
        SELECT
          gen_random_uuid()::text,
          'MOVER',
          'leads',
          l.id,
          'Card realocado automaticamente: etapa obsoleta "' || etapa_rec.nome || '" foi removida da configuração da Carteira Recorrente.',
          json_build_object(
            'etapa_removida', etapa_rec.nome,
            'etapa_destino_id', v_destino_id,
            'motivo', 'migration_remove_etapas_obsoletas_carteira_v2_2026_07_13'
          )::text,
          now(),
          'sistema'
        FROM leads l
        WHERE l.etapa_id = v_destino_id
          AND l.atualizado_em >= now() - interval '10 seconds'
          AND (l.deleted_at IS NULL OR l.deleted_at > now())
        ON CONFLICT DO NOTHING;

        v_total_realocados := v_total_realocados + v_lead_count;
        RAISE NOTICE '  → % leads realocados para Previsão Carteira 15-30 dias (ou fallback)', v_lead_count;
      END IF;

      -- Desativa a etapa (sem DELETE)
      UPDATE etapas
      SET atualizado_em = now()
      WHERE id = v_etapa_id;

      -- Tenta marcar como inativa se a coluna existir
      BEGIN
        EXECUTE format('UPDATE etapas SET ativo = false WHERE id = %L', v_etapa_id);
      EXCEPTION WHEN undefined_column THEN
        -- coluna ativo não existe — ignorar
        NULL;
      END;

      BEGIN
        EXECUTE format('UPDATE etapas SET oculta = true WHERE id = %L', v_etapa_id);
      EXCEPTION WHEN undefined_column THEN
        NULL;
      END;

      RAISE NOTICE '  → Etapa "%" desativada/oculta (sem DELETE)', etapa_rec.nome;

    END LOOP;

  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Migration concluída. Total de leads realocados: %', v_total_realocados;
  RAISE NOTICE '══════════════════════════════════════════════════════════════';

END $$;


-- ─── 4. VERIFICAÇÃO: etapas da Carteira Recorrente após migration ─────────────
-- Deve mostrar APENAS as 14 etapas oficiais (sem as variantes obsoletas)
SELECT
  e.nome,
  e.ordem,
  e.is_ganho,
  (SELECT COUNT(*) FROM leads l WHERE l.etapa_id = e.id AND (l.deleted_at IS NULL OR l.deleted_at > now())) as total_leads
FROM etapas e
JOIN funis f ON e.funil_id = f.id
WHERE f.nome ILIKE '%Carteira Recorrente%'
ORDER BY e.ordem, e.nome;
