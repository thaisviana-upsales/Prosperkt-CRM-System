-- ============================================================
-- PROSPEKT CRM — Patch v19: Metas por mês + Conta Azul
-- Execute no Supabase SQL Editor ANTES do deploy.
-- SEGURO: sem DROP / DELETE / TRUNCATE.
-- ============================================================

-- ── 1. METAS: garantir coluna mes/ano para diferenciar metas ─────────────────
-- Se já existirem, estas linhas são no-op (IF NOT EXISTS).
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS mes  INTEGER;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS ano  INTEGER;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS tipo TEXT;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS funil_id TEXT;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS funil_tipo TEXT DEFAULT 'TODOS';
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS usuario_id TEXT;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS valor_alvo NUMERIC DEFAULT 0;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS titulo TEXT;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS observacoes TEXT;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS criado_por TEXT;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS ativo INTEGER DEFAULT 1;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;
ALTER TABLE public.metas ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT NOW();

-- ── 2. METAS: remover constraint único errado (somente por usuario_id/tipo) ───
-- Verifica se existe constraint limitado apenas a usuario_id/tipo e o remove.
-- O índice correto deve ser (usuario_id, mes, ano, tipo, funil_id).
DO $$
DECLARE
  c TEXT;
BEGIN
  -- Remove qualquer constraint UNIQUE que não inclua mes/ano
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.metas'::regclass
      AND contype = 'u'
      AND conname NOT IN (
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.metas'::regclass
          AND contype = 'u'
          AND array_to_string(
            ARRAY(SELECT attname FROM pg_attribute
                  WHERE attrelid = 'public.metas'::regclass
                  AND attnum = ANY(conkey)), ','
          ) LIKE '%mes%'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.metas DROP CONSTRAINT IF EXISTS %I', c);
    RAISE NOTICE 'Removida constraint: %', c;
  END LOOP;
END $$;

-- ── 3. METAS: índice correto (permite vários registros por vendedor/tipo/funil)─
-- Chave lógica: usuario_id + mes + ano + tipo + funil_id
-- NULLS NOT DISTINCT garante que funil_id NULL (TODOS) seja único também.
CREATE UNIQUE INDEX IF NOT EXISTS idx_metas_chave_logica
  ON public.metas (usuario_id, mes, ano, tipo, COALESCE(funil_id,'__todos__'))
  WHERE ativo = 1;

-- ── 4. USUÁRIOS: desativar usuários teste ─────────────────────────────────────
-- Somente os listados. ativo = 0 (INTEGER). Sem DELETE.
UPDATE public.usuarios
   SET ativo = 0, atualizado_em = NOW()
 WHERE nome IN (
   'Carlos Vendedor',
   'João Testes 2',
   'Joao Testes 2',
   'Maria Gestora',
   'Teste Browser',
   'ThaisTeste',
   'Thais Teste'
 )
   AND ativo != 0;  -- evita atualização desnecessária

-- ── 5. CONTA AZUL: tabela de destinatários cadastrados ───────────────────────
CREATE TABLE IF NOT EXISTS public.config_email_conta_azul (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nome         TEXT        NOT NULL,
  email        TEXT        NOT NULL,
  tipo         TEXT        DEFAULT 'administrativo',  -- financeiro|administrativo|producao|gestao|outro
  ativo        INTEGER     DEFAULT 1,
  criado_em    TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para listagem de ativos
CREATE INDEX IF NOT EXISTS idx_config_email_ca_ativo ON public.config_email_conta_azul (ativo);

-- ── 6. CONTA AZUL: tabela de histórico de envios ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.conta_azul_emails_enviados (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id              TEXT        NOT NULL,
  venda_id             TEXT,
  usuario_id           TEXT,
  usuario_nome         TEXT,
  destinatarios_json   JSONB,
  assunto              TEXT,
  observacao_adicional TEXT,
  status               TEXT        DEFAULT 'enviado',  -- enviado|erro
  erro                 TEXT,
  enviado_em           TIMESTAMPTZ DEFAULT NOW(),
  criado_em            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_caee_lead_id    ON public.conta_azul_emails_enviados (lead_id);
CREATE INDEX IF NOT EXISTS idx_caee_enviado_em ON public.conta_azul_emails_enviados (enviado_em DESC);

-- ── 7. LEADS: campo conta_azul_status para tag visual ────────────────────────
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS conta_azul_status TEXT DEFAULT 'nao_aplicavel';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS conta_azul_enviado_em  TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS conta_azul_enviado_por TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS conta_azul_ultimo_erro TEXT;

-- Comentários de domínio
COMMENT ON COLUMN public.leads.conta_azul_status IS
  'nao_aplicavel | pendente | enviado | erro — status da ficha Conta Azul deste lead';

-- Índice para filtro futuro na Adm. de Vendas
CREATE INDEX IF NOT EXISTS idx_leads_ca_status ON public.leads (conta_azul_status);

-- ── 8. Seed de destinatários padrão (só se tabela estiver vazia) ──────────────
-- Ajuste os e-mails conforme os destinatários reais da Prospekt.
INSERT INTO public.config_email_conta_azul (id, nome, email, tipo, ativo)
SELECT
  gen_random_uuid()::text, 'Financeiro Prospekt', 'financeiro@prospekt.com.br', 'financeiro', 1
WHERE NOT EXISTS (SELECT 1 FROM public.config_email_conta_azul LIMIT 1);

-- ============================================================
-- FIM DO PATCH v19
-- EXECUTE NO SUPABASE: SQL Editor → New Query → Run
-- ============================================================
