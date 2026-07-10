-- ============================================================
-- MIGRATION: Carteira Recorrente — Loop Infinito de Recompra
-- Data: 2026-07-10
-- Exec: Supabase SQL Editor (idempotente — pode re-executar)
-- ============================================================

-- ─── 1. CAMPOS NOVOS NA TABELA leads ──────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS data_prevista_proxima_compra DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS venda_origem_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tipo_clone TEXT DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_original_id TEXT DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS alerta_recompra_em DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS alerta_recompra_enviado BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS valor_venda NUMERIC DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS produto_id TEXT DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS produto_nome TEXT DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS produto_cor TEXT DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS forma_pagamento TEXT DEFAULT NULL;

-- ─── 2. CAMPOS NOVOS NA TABELA adm_vendas ─────────────────────
ALTER TABLE adm_vendas ADD COLUMN IF NOT EXISTS previsao_proxima_compra TEXT DEFAULT NULL;
ALTER TABLE adm_vendas ADD COLUMN IF NOT EXISTS data_prevista_proxima_compra DATE DEFAULT NULL;
ALTER TABLE adm_vendas ADD COLUMN IF NOT EXISTS etapa_atualizada_em TIMESTAMPTZ DEFAULT NULL;

-- ─── 3. ÍNDICES para performance ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_lead_original_id ON leads(lead_original_id);
CREATE INDEX IF NOT EXISTS idx_leads_tipo_clone ON leads(tipo_clone);
CREATE INDEX IF NOT EXISTS idx_leads_venda_origem_id ON leads(venda_origem_id);
CREATE INDEX IF NOT EXISTS idx_leads_alerta_recompra_em ON leads(alerta_recompra_em);
CREATE INDEX IF NOT EXISTS idx_adm_vendas_lead_original_id ON adm_vendas(lead_original_id);

-- ─── 4. FUNIL CARTEIRA RECORRENTE — garantir que existe e está ativo ───
INSERT INTO funis (id, nome, cor, ativo, criado_em, atualizado_em)
VALUES (
  gen_random_uuid()::text,
  'Carteira Recorrente',
  '#6CFF4E',
  true,
  now(), now()
)
ON CONFLICT (nome) DO UPDATE SET ativo = true;

-- ─── 5. ETAPAS OFICIAIS DA CARTEIRA RECORRENTE ────────────────
-- Busca o funil_id da Carteira Recorrente e insere/atualiza etapas
DO $$
DECLARE
  v_funil_id TEXT;
  etapa_record RECORD;
  etapas_oficiais TEXT[][] := ARRAY[
    ARRAY['Previsão Carteira 15-30 dias',  '1',  '#1a3a52'],
    ARRAY['Previsão Carteira 30-60 dias',  '2',  '#1e4460'],
    ARRAY['Previsão Carteira 60-90 dias',  '3',  '#234f6e'],
    ARRAY['Previsão Carteira 3 - 6 meses', '4',  '#285a7c'],
    ARRAY['Previsão Carteira 6 - 9 meses', '5',  '#2d658a'],
    ARRAY['Previsão Carteira 9 - 18 meses','6',  '#327098'],
    ARRAY['Previsão Carteira +18 meses',   '7',  '#377ba6'],
    ARRAY['Orçamento Enviado',             '8',  '#3d87b4'],
    ARRAY['Orçamento Aprovado',            '9',  '#4293c2'],
    ARRAY['Layout Virtual',                '10', '#479fd0'],
    ARRAY['Amostra Física',               '11', '#4caadd'],
    ARRAY['Amostra Aprovada',             '12', '#51b6eb'],
    ARRAY['Follow-Up',                    '13', '#56c2f9'],
    ARRAY['Vendas',                       '14', '#1f5c2e']
  ];
  i INTEGER;
  v_nome TEXT;
  v_ordem INTEGER;
  v_cor TEXT;
  v_existing_id TEXT;
BEGIN
  -- Pega o ID do funil Carteira Recorrente
  SELECT id INTO v_funil_id
  FROM funis
  WHERE nome ILIKE '%Carteira Recorrente%' AND ativo = true
  LIMIT 1;

  IF v_funil_id IS NULL THEN
    RAISE NOTICE 'Funil Carteira Recorrente não encontrado — abortando seed de etapas.';
    RETURN;
  END IF;

  -- Insere ou padroniza cada etapa oficial
  FOR i IN 1..array_length(etapas_oficiais, 1) LOOP
    v_nome  := etapas_oficiais[i][1];
    v_ordem := etapas_oficiais[i][2]::INTEGER;
    v_cor   := etapas_oficiais[i][3];

    -- Verifica se já existe etapa com este nome neste funil
    SELECT id INTO v_existing_id
    FROM etapas
    WHERE funil_id = v_funil_id AND LOWER(TRIM(nome)) = LOWER(TRIM(v_nome))
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- Atualiza ordem e cor para padronizar
      UPDATE etapas SET ordem = v_ordem, cor = v_cor WHERE id = v_existing_id;
    ELSE
      -- Cria a etapa
      INSERT INTO etapas (id, nome, cor, ordem, funil_id, is_ganho, is_perdido, probabilidade, criado_em, atualizado_em)
      VALUES (
        gen_random_uuid()::text,
        v_nome, v_cor, v_ordem, v_funil_id,
        CASE WHEN v_nome = 'Vendas' THEN true ELSE false END,
        false,
        CASE WHEN v_nome = 'Vendas' THEN 100 ELSE (v_ordem * 6) END,
        now(), now()
      );
    END IF;
  END LOOP;

  RAISE NOTICE 'Etapas da Carteira Recorrente configuradas para funil %', v_funil_id;
END $$;

-- ─── 6. VERIFICAÇÃO FINAL ─────────────────────────────────────
SELECT e.nome, e.ordem, e.cor, e.is_ganho
FROM etapas e
JOIN funis f ON e.funil_id = f.id
WHERE f.nome ILIKE '%Carteira Recorrente%'
ORDER BY e.ordem;
