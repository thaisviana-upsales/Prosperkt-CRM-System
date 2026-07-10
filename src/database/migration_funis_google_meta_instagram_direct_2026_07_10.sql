-- ============================================================
-- PROSPEKT CRM — Ajuste de Funis de Origem de Tráfego
-- Arquivo: migration_funis_google_meta_instagram_direct_2026_07_10.sql
-- Executar NO SUPABASE SQL EDITOR (cole e execute)
--
-- OBJETIVO:
--   1. Criar funil "Google Ads" se não existir
--   2. Criar funil "Meta Ads" se não existir
--   3. Renomear "Instagram" para "Instagram - Direct" (preserva leads)
--   4. Inativar "Tráfego Pago" (sem deletar, sem mover leads)
--
-- SEGURANÇA:
--   - NÃO usa DROP, DELETE ou TRUNCATE
--   - Idempotente: pode ser executado mais de uma vez sem duplicar
--   - Leads existentes NÃO são movidos/deletados
--   - Histórico/vendas/mensagens são preservados integralmente
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- PASSO 1: Renomear "Instagram" → "Instagram - Direct"
-- (apenas se o nome exato "Instagram" existir e o novo nome
--  ainda não existir, para não criar duplicata)
-- ══════════════════════════════════════════════════════════════
UPDATE public.funis
SET nome = 'Instagram - Direct',
    atualizado_em = NOW()
WHERE nome = 'Instagram'
  AND NOT EXISTS (
    SELECT 1 FROM public.funis WHERE nome = 'Instagram - Direct'
  );

-- Atualiza também pipeline vinculada (nome da pipeline reflete o funil)
UPDATE public.pipelines
SET nome = 'Pipeline - Instagram - Direct',
    atualizado_em = NOW()
WHERE nome = 'Pipeline - Instagram'
  AND NOT EXISTS (
    SELECT 1 FROM public.pipelines WHERE nome = 'Pipeline - Instagram - Direct'
  );

-- ══════════════════════════════════════════════════════════════
-- PASSO 2: Inativar "Tráfego Pago" (sem deletar)
-- ══════════════════════════════════════════════════════════════
UPDATE public.funis
SET ativo = false,
    atualizado_em = NOW()
WHERE nome = 'Tráfego Pago';

-- ══════════════════════════════════════════════════════════════
-- PASSO 3: Criar "Google Ads" se não existir
-- (inclui pipeline e etapas padrão)
-- ══════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_funil_id    TEXT;
  v_pipeline_id TEXT;
  v_exists      BOOLEAN;
BEGIN
  -- Verifica se já existe
  SELECT EXISTS(SELECT 1 FROM public.funis WHERE nome = 'Google Ads') INTO v_exists;

  IF NOT v_exists THEN
    v_funil_id    := encode(gen_random_bytes(16), 'hex');
    v_pipeline_id := encode(gen_random_bytes(16), 'hex');

    -- Cria funil
    INSERT INTO public.funis (id, nome, cor, ativo, criado_em, atualizado_em)
    VALUES (v_funil_id, 'Google Ads', '#EA4335', true, NOW(), NOW());

    -- Cria pipeline vinculada
    INSERT INTO public.pipelines (id, funil_id, nome, ordem, ativo, criado_em, atualizado_em)
    VALUES (v_pipeline_id, v_funil_id, 'Pipeline - Google Ads', 0, true, NOW(), NOW());

    -- Cria etapas padrão
    INSERT INTO public.etapas (id, pipeline_id, funil_id, nome, cor, ordem, is_ganho, is_perdido, probabilidade, criado_em, atualizado_em) VALUES
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Lead Recebido',       '#6CFF4E', 1,  false, false, 10,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Contato Realizado',   '#3B8BFF', 2,  false, false, 25,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Lead Desqualificado', '#FF3B5C', 3,  false, true,  5,   NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Em Tratativa',        '#FFB627', 4,  false, false, 40,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Orçamento Enviado',   '#6C47FF', 5,  false, false, 55,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Orçamento Aprovado',  '#5BE89E', 6,  false, false, 70,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Layout Virtual',      '#9B59B6', 7,  false, false, 75,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Amostra Física',      '#FFB627', 8,  false, false, 80,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Amostra Aprovada',    '#F5A623', 9,  false, false, 90,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Follow-Up',           '#FF8C00', 10, false, false, 50,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Vendas',              '#6CFF4E', 11, true,  false, 100, NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Perdidos',            '#FF3B5C', 12, false, true,  0,   NOW(), NOW());

    RAISE NOTICE 'Funil "Google Ads" criado com pipeline e 12 etapas.';
  ELSE
    RAISE NOTICE 'Funil "Google Ads" já existe — nenhuma ação necessária.';
    -- Garante que está ativo
    UPDATE public.funis SET ativo = true, atualizado_em = NOW() WHERE nome = 'Google Ads';
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- PASSO 4: Criar "Meta Ads" se não existir
-- (inclui pipeline e etapas padrão)
-- ══════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_funil_id    TEXT;
  v_pipeline_id TEXT;
  v_exists      BOOLEAN;
BEGIN
  -- Verifica se já existe
  SELECT EXISTS(SELECT 1 FROM public.funis WHERE nome = 'Meta Ads') INTO v_exists;

  IF NOT v_exists THEN
    v_funil_id    := encode(gen_random_bytes(16), 'hex');
    v_pipeline_id := encode(gen_random_bytes(16), 'hex');

    -- Cria funil
    INSERT INTO public.funis (id, nome, cor, ativo, criado_em, atualizado_em)
    VALUES (v_funil_id, 'Meta Ads', '#1877F2', true, NOW(), NOW());

    -- Cria pipeline vinculada
    INSERT INTO public.pipelines (id, funil_id, nome, ordem, ativo, criado_em, atualizado_em)
    VALUES (v_pipeline_id, v_funil_id, 'Pipeline - Meta Ads', 0, true, NOW(), NOW());

    -- Cria etapas padrão
    INSERT INTO public.etapas (id, pipeline_id, funil_id, nome, cor, ordem, is_ganho, is_perdido, probabilidade, criado_em, atualizado_em) VALUES
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Lead Recebido',       '#6CFF4E', 1,  false, false, 10,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Contato Realizado',   '#3B8BFF', 2,  false, false, 25,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Lead Desqualificado', '#FF3B5C', 3,  false, true,  5,   NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Em Tratativa',        '#FFB627', 4,  false, false, 40,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Orçamento Enviado',   '#6C47FF', 5,  false, false, 55,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Orçamento Aprovado',  '#5BE89E', 6,  false, false, 70,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Layout Virtual',      '#9B59B6', 7,  false, false, 75,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Amostra Física',      '#FFB627', 8,  false, false, 80,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Amostra Aprovada',    '#F5A623', 9,  false, false, 90,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Follow-Up',           '#FF8C00', 10, false, false, 50,  NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Vendas',              '#6CFF4E', 11, true,  false, 100, NOW(), NOW()),
      (encode(gen_random_bytes(16),'hex'), v_pipeline_id, v_funil_id, 'Perdidos',            '#FF3B5C', 12, false, true,  0,   NOW(), NOW());

    RAISE NOTICE 'Funil "Meta Ads" criado com pipeline e 12 etapas.';
  ELSE
    RAISE NOTICE 'Funil "Meta Ads" já existe — nenhuma ação necessária.';
    -- Garante que está ativo
    UPDATE public.funis SET ativo = true, atualizado_em = NOW() WHERE nome = 'Meta Ads';
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- VALIDAÇÃO FINAL: Confirma estado dos funis
-- ══════════════════════════════════════════════════════════════
SELECT
  nome,
  ativo,
  cor,
  CASE
    WHEN nome = 'Google Ads'        THEN '✅ NOVO'
    WHEN nome = 'Meta Ads'          THEN '✅ NOVO'
    WHEN nome = 'Instagram - Direct' THEN '✅ RENOMEADO'
    WHEN nome = 'Tráfego Pago'      THEN '🔴 INATIVO (preservado)'
    WHEN nome = 'Instagram'         THEN '⚠️  AINDA COM NOME ANTIGO (verificar)'
    ELSE '—'
  END AS status_acao
FROM public.funis
WHERE nome IN ('Google Ads','Meta Ads','Instagram - Direct','Instagram','Tráfego Pago','LinkedIn','Indicação','Carteira Recorrente','Carteira Reativação')
ORDER BY ativo DESC, nome ASC;
