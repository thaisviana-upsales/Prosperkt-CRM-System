-- ============================================================
-- PROSPERKT CRM — Patch v51: adm_vendas schema fix completo
-- Corrige erro 500 em /api/adm-vendas?status=ativo
--
-- CAUSA RAIZ: tabela adm_vendas criada no Supabase sem FK constraint
--   em responsavel_id → usuarios.id, fazendo o PostgREST falhar
--   ao tentar resolver o join por nome de coluna.
--
-- SEGURO: usa apenas ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS
--   e ALTER TABLE ADD CONSTRAINT IF NOT EXISTS.
-- NÃO usa DROP, DELETE, TRUNCATE ou ALTER TYPE destrutivo.
-- ============================================================

-- 1. Garante que a tabela adm_vendas existe com estrutura mínima
-- (idempotente — não recria se já existir)
CREATE TABLE IF NOT EXISTS public.adm_vendas (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_original_id     TEXT,
  nome                 TEXT NOT NULL,
  empresa              TEXT,
  email                TEXT,
  telefone             TEXT,
  responsavel_id       TEXT,
  funil_id             TEXT,
  valor_venda          NUMERIC DEFAULT 0,
  forma_pagamento      TEXT,
  quantidade_parcelas  INTEGER DEFAULT 1,
  parcelas_json        JSONB,
  produto_id           TEXT,
  produto_nome         TEXT,
  produto_cor          TEXT,
  origem               TEXT,
  tags                 JSONB,
  dados_extras         JSONB,
  observacoes          TEXT,
  data_venda           DATE,
  data_entrega_prevista DATE,
  etapa                TEXT NOT NULL DEFAULT 'acompanhamento'
                       CHECK(etapa IN ('acompanhamento','compras','producao','manuseio','transporte','concluido')),
  status               TEXT NOT NULL DEFAULT 'ativo'
                       CHECK(status IN ('ativo','concluido','cancelado')),
  criado_em            TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em        TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela de histórico/timeline (idempotente)
CREATE TABLE IF NOT EXISTS public.adm_vendas_historico (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  adm_venda_id   TEXT NOT NULL REFERENCES public.adm_vendas(id) ON DELETE CASCADE,
  usuario_id     TEXT,
  tipo           TEXT NOT NULL DEFAULT 'NOTA'
                 CHECK(tipo IN ('NOTA','SISTEMA','ETAPA','ARQUIVO')),
  conteudo       TEXT NOT NULL,
  criado_em      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Colunas extras que podem não existir (todos os patches anteriores)
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS lead_produtos_json     JSONB;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS previsao_proxima_compra TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS data_prevista_proxima_compra DATE;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS etapa_atualizada_em    TIMESTAMPTZ;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS endereco_entrega        TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS cep_entrega             TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS numero_entrega          TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS complemento_entrega     TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS referencia_entrega      TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS bairro_entrega          TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS cidade_entrega          TEXT;
ALTER TABLE public.adm_vendas ADD COLUMN IF NOT EXISTS uf_entrega              TEXT;

-- 4. FK constraints (necessário para PostgREST resolver joins por nome)
-- Usa DO $$ para suprimir erro se constraint já existir
DO $$
BEGIN
  -- FK responsavel_id → usuarios
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'adm_vendas_responsavel_id_fkey'
      AND table_name = 'adm_vendas'
  ) THEN
    BEGIN
      ALTER TABLE public.adm_vendas
        ADD CONSTRAINT adm_vendas_responsavel_id_fkey
        FOREIGN KEY (responsavel_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'FK adm_vendas_responsavel_id_fkey: %', SQLERRM;
    END;
  END IF;

  -- FK lead_original_id → leads
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'adm_vendas_lead_original_id_fkey'
      AND table_name = 'adm_vendas'
  ) THEN
    BEGIN
      ALTER TABLE public.adm_vendas
        ADD CONSTRAINT adm_vendas_lead_original_id_fkey
        FOREIGN KEY (lead_original_id) REFERENCES public.leads(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'FK adm_vendas_lead_original_id_fkey: %', SQLERRM;
    END;
  END IF;
END $$;

-- 5. Índices de performance
CREATE INDEX IF NOT EXISTS idx_admv_lead_orig         ON public.adm_vendas(lead_original_id);
CREATE INDEX IF NOT EXISTS idx_admv_responsavel        ON public.adm_vendas(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_admv_etapa              ON public.adm_vendas(etapa);
CREATE INDEX IF NOT EXISTS idx_admv_status             ON public.adm_vendas(status);
CREATE INDEX IF NOT EXISTS idx_admv_etapa_atualizada   ON public.adm_vendas(etapa_atualizada_em);
CREATE INDEX IF NOT EXISTS idx_admv_criado_em          ON public.adm_vendas(criado_em);
CREATE INDEX IF NOT EXISTS idx_admvh_venda             ON public.adm_vendas_historico(adm_venda_id);

-- 6. RLS — habilita mas com política permissiva para service_role
ALTER TABLE public.adm_vendas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adm_vendas_historico ENABLE ROW LEVEL SECURITY;

-- Permite acesso total via service_role (backend usa service_role key)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'adm_vendas' AND policyname = 'adm_vendas_service_role'
  ) THEN
    EXECUTE 'CREATE POLICY adm_vendas_service_role ON public.adm_vendas FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'adm_vendas_historico' AND policyname = 'adm_vendas_historico_service_role'
  ) THEN
    EXECUTE 'CREATE POLICY adm_vendas_historico_service_role ON public.adm_vendas_historico FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'RLS policy: %', SQLERRM;
END $$;

-- 7. Diagnóstico final — confirma colunas existentes
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'adm_vendas'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- ============================================================
-- FIM DO PATCH v51
-- Execute no Supabase SQL Editor antes do próximo deploy.
-- ============================================================
