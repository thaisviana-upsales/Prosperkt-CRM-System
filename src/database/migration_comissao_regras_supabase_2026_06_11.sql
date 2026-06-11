-- Cria tabela comissao_regras no Supabase (não existe ainda)
-- Execute no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.comissao_regras (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  nome TEXT NOT NULL,
  usuario_id TEXT REFERENCES public.usuarios(id) ON DELETE SET NULL,
  funil_id TEXT REFERENCES public.funis(id) ON DELETE SET NULL,
  tipo_calculo TEXT NOT NULL DEFAULT 'PERCENTUAL' CHECK (tipo_calculo IN ('PERCENTUAL', 'FIXO')),
  percentual NUMERIC DEFAULT 0,
  valor_fixo NUMERIC DEFAULT 0,
  valor_min NUMERIC DEFAULT 0,
  valor_max NUMERIC,
  bonus_meta_pct NUMERIC DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_por TEXT REFERENCES public.usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Adiciona coluna salario_fixo em usuarios se não existir
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS salario_fixo NUMERIC DEFAULT 0;

-- Desabilita RLS para acesso via service role (mesmo padrão das outras tabelas)
ALTER TABLE public.comissao_regras DISABLE ROW LEVEL SECURITY;
