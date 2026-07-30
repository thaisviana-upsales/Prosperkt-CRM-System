-- ============================================================
-- PROSPERKT CRM — Patch v22: Conta Azul — Destinatários Reais
-- Executar no Supabase SQL Editor
-- SEGURO: sem DROP, DELETE, TRUNCATE, RESET
-- ============================================================

-- ── 1. Garante coluna UNIQUE em email (seguro com IF NOT EXISTS) ──────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_config_email_conta_azul_email'
  ) THEN
    ALTER TABLE public.config_email_conta_azul
      ADD CONSTRAINT uq_config_email_conta_azul_email UNIQUE (email);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ── 2. Desativa placeholder antigo (se existir) ───────────────────────────────
UPDATE public.config_email_conta_azul
   SET ativo = 0, atualizado_em = NOW()
 WHERE email IN ('financeiro@prospekt.com.br')
   AND ativo != 0;

-- ── 3. Insere destinatários reais (idempotente — ON CONFLICT DO NOTHING) ──────
INSERT INTO public.config_email_conta_azul (id, nome, email, tipo, ativo, criado_em, atualizado_em)
VALUES
  (gen_random_uuid()::text, 'Tuane Picharelli',  'tuane@prospektpersonalizados.com.br',   'financeiro',    1, NOW(), NOW()),
  (gen_random_uuid()::text, 'Ramiro Furlani',    'ramiro@prospektpersonalizados.com.br',   'gestao',        1, NOW(), NOW()),
  (gen_random_uuid()::text, 'Priscila Oliveira', 'priscila@prospektpersonalizados.com.br', 'administrativo',1, NOW(), NOW()),
  (gen_random_uuid()::text, 'Caique Oliveira',   'caique@prospektpersonalizados.com.br',   'producao',      1, NOW(), NOW()),
  (gen_random_uuid()::text, 'Felipe Chammas',    'felipe@prospektpersonalizados.com.br',   'gestao',        1, NOW(), NOW())
ON CONFLICT (email) DO UPDATE
  SET nome          = EXCLUDED.nome,
      tipo          = EXCLUDED.tipo,
      ativo         = 1,
      atualizado_em = NOW();

-- ── 4. Garante colunas do lead (caso patch v19 nao tenha sido executado) ──────
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS conta_azul_status      TEXT        DEFAULT 'nao_aplicavel';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS conta_azul_enviado_em  TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS conta_azul_enviado_por TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS conta_azul_ultimo_erro TEXT;

-- ── 5. Garante tabela de historico (idempotente) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.conta_azul_emails_enviados (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id              TEXT        NOT NULL,
  venda_id             TEXT,
  usuario_id           TEXT,
  usuario_nome         TEXT,
  destinatarios_json   JSONB,
  assunto              TEXT,
  observacao_adicional TEXT,
  status               TEXT        DEFAULT 'enviado',
  erro                 TEXT,
  enviado_em           TIMESTAMPTZ DEFAULT NOW(),
  criado_em            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_caee_lead_id    ON public.conta_azul_emails_enviados (lead_id);
CREATE INDEX IF NOT EXISTS idx_caee_enviado_em ON public.conta_azul_emails_enviados (enviado_em DESC);
CREATE INDEX IF NOT EXISTS idx_leads_ca_status ON public.leads (conta_azul_status);

-- ── 6. Auditoria: confirma destinatarios inseridos ────────────────────────────
SELECT nome, email, tipo,
       CASE WHEN ativo = 1 THEN 'Ativo' ELSE 'Inativo' END AS situacao
  FROM public.config_email_conta_azul
 ORDER BY ativo DESC, nome;

-- ============================================================
-- FIM DO PATCH v22
-- ============================================================
