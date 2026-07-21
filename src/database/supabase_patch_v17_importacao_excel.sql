-- ============================================================
-- PROSPERKT CRM — Patch v17: Importação de Leads via Excel
-- Execute no Supabase SQL Editor ANTES do deploy.
-- SEGURO: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS
-- SEM DROP, SEM DELETE, SEM TRUNCATE.
-- ============================================================

-- ── Tabela: importacoes_leads ────────────────────────────────────────────────
-- Registra cada sessão de importação de planilha Excel
CREATE TABLE IF NOT EXISTS public.importacoes_leads (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  usuario_id       TEXT,
  usuario_nome     TEXT,
  nome_arquivo     TEXT NOT NULL,
  total_linhas     INTEGER DEFAULT 0,
  total_validas    INTEGER DEFAULT 0,
  total_erros      INTEGER DEFAULT 0,
  total_duplicados INTEGER DEFAULT 0,
  total_importados INTEGER DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pendente'
                   CHECK(status IN ('pendente','validando','aguardando_confirmacao','importando','concluido','cancelado','erro')),
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  finalizado_em    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_impleads_usuario   ON public.importacoes_leads (usuario_id);
CREATE INDEX IF NOT EXISTS idx_impleads_status    ON public.importacoes_leads (status);
CREATE INDEX IF NOT EXISTS idx_impleads_criado_em ON public.importacoes_leads (criado_em DESC);

-- ── Tabela: importacao_lead_linhas ───────────────────────────────────────────
-- Registra cada linha da planilha com resultado de validação e importação
CREATE TABLE IF NOT EXISTS public.importacao_lead_linhas (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  importacao_id   TEXT NOT NULL REFERENCES public.importacoes_leads(id) ON DELETE CASCADE,
  numero_linha    INTEGER NOT NULL,
  dados_json      JSONB,
  status          TEXT NOT NULL DEFAULT 'pendente'
                  CHECK(status IN ('pendente','valido','invalido','duplicado','importado','erro')),
  erro            TEXT,
  lead_id         TEXT,
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_impleads_linhas_imp  ON public.importacao_lead_linhas (importacao_id);
CREATE INDEX IF NOT EXISTS idx_impleads_linhas_stat ON public.importacao_lead_linhas (status);
CREATE INDEX IF NOT EXISTS idx_impleads_linhas_lead ON public.importacao_lead_linhas (lead_id);

-- ============================================================
-- FIM DO PATCH v17
-- ============================================================
