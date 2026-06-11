-- Migration: tabela automacoes no Supabase
-- Execute no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.automacoes (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  nome TEXT NOT NULL,
  descricao TEXT,
  trigger_tipo TEXT NOT NULL DEFAULT 'LEAD_CRIADO',
  trigger_config JSONB,
  acao_tipo TEXT NOT NULL DEFAULT 'PRIMEIRA_MSG_WA',
  acao_config JSONB,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_por TEXT REFERENCES public.usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_automacoes_trigger ON public.automacoes (trigger_tipo, acao_tipo);
CREATE INDEX IF NOT EXISTS idx_automacoes_ativo   ON public.automacoes (ativo);

-- Sem RLS (padrão do projeto)
ALTER TABLE public.automacoes DISABLE ROW LEVEL SECURITY;
