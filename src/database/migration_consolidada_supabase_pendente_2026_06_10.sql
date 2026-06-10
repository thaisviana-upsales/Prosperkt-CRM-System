-- ============================================================
-- PROSPEKT CRM — MIGRATION CONSOLIDADA
-- Arquivo: migration_consolidada_supabase_pendente_2026_06_10.sql
-- 
-- OBJETIVO: Criar tabelas ausentes e garantir colunas pendentes
-- SEGURO: usa IF NOT EXISTS em todos os comandos
-- SEM: DROP, DELETE, TRUNCATE ou alteração de dados existentes
-- 
-- COMO EXECUTAR:
--   1. Abra: https://supabase.com/dashboard/project/wtuhaoyqojzelaqteclx/sql/new
--   2. Cole TODO o conteúdo deste arquivo
--   3. Clique em "Run"
--   4. Verifique a mensagem final: "Migration consolidada aplicada com sucesso!"
--
-- STATUS DAS TABELAS VERIFICADO EM: 2026-06-10
--   EXISTEM:    usuarios, funis, etapas, leads, lead_produtos, metas, comissoes,
--               mensagens_padrao, motivos_perda, produtos, audit_logs,
--               conversas_whatsapp, mensagens_whatsapp, whatsapp_mensagens,
--               planilha_importacoes
--   NÃO EXISTEM: atividades, lead_producao, lead_arquivos
--   OBS: automacoes_msg e whatsapp_integracoes não são usadas pelo backend Supabase
--        (automações rodam em SQLite; integrações ficam no .env)
-- ============================================================

-- ============================================================
-- BLOCO 1 — COLUNAS PENDENTES EM TABELAS JÁ EXISTENTES
-- (Patches v8, v9, force_password_change)
-- ============================================================

-- Patch v8: avatar e salário fixo
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS avatar_url      TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS salario_fixo    NUMERIC DEFAULT 0;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS ativo           BOOLEAN NOT NULL DEFAULT true;

-- Patch v9: ordem em mensagens_padrao
ALTER TABLE public.mensagens_padrao ADD COLUMN IF NOT EXISTS ordem   INTEGER DEFAULT 0;

-- Patch v2/v3: campos extras em leads (vendas, datas, produto)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS valor_venda        NUMERIC;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS forma_pagamento    TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS produto_id         TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS produto_nome       TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS data_fechamento    DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ganho_em           TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS perdido_em         TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS motivo_perda       TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS tags               JSONB;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS dados_extras       JSONB;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS pipeline_id        TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS criado_por         TEXT;

-- Novos campos de Produção (Prompt 3)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS proxima_compra     DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS quantidade_pecas   INTEGER;

-- Índices de performance para leads
CREATE INDEX IF NOT EXISTS idx_leads_responsavel  ON public.leads (responsavel_id);
CREATE INDEX IF NOT EXISTS idx_leads_funil        ON public.leads (funil_id);
CREATE INDEX IF NOT EXISTS idx_leads_etapa        ON public.leads (etapa_id);
CREATE INDEX IF NOT EXISTS idx_leads_status       ON public.leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_perdido_em   ON public.leads (perdido_em);
CREATE INDEX IF NOT EXISTS idx_leads_ganho_em     ON public.leads (ganho_em);
CREATE INDEX IF NOT EXISTS idx_leads_criado_em    ON public.leads (criado_em DESC);

-- Índice em mensagens_padrao
CREATE INDEX IF NOT EXISTS idx_msgs_padrao_cat    ON public.mensagens_padrao (categoria, ordem);

-- ============================================================
-- BLOCO 2 — TABELA: atividades
-- Atividades de lead: ligar, visitar, enviar amostra, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.atividades (
  id               TEXT        PRIMARY KEY,
  lead_id          TEXT        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  usuario_id       TEXT        REFERENCES public.usuarios(id),
  tipo             TEXT        NOT NULL DEFAULT 'Outra',
  -- Tipos: Ligar | Mandar mensagem | Visitar | Enviar amostra | Outra
  observacao       TEXT,
  data_limite      DATE,
  hora_limite      TIME,
  status           TEXT        NOT NULL DEFAULT 'pendente',
  -- Status: pendente | concluida | adiada | atrasada
  concluida_em     TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atividades_lead    ON public.atividades (lead_id);
CREATE INDEX IF NOT EXISTS idx_atividades_usuario ON public.atividades (usuario_id);
CREATE INDEX IF NOT EXISTS idx_atividades_status  ON public.atividades (status);
CREATE INDEX IF NOT EXISTS idx_atividades_data    ON public.atividades (data_limite) WHERE data_limite IS NOT NULL;

-- ============================================================
-- BLOCO 3 — TABELA: lead_producao
-- Dados de produção por lead: datas de orçamento, amostra, entrega
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_producao (
  id                          TEXT        PRIMARY KEY,
  lead_id                     TEXT        NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  data_solicitacao_orcamento  DATE,
  data_envio_orcamento        DATE,
  data_envio_amostra          DATE,
  data_aprovacao_amostra      DATE,
  data_entrega                DATE,
  quantidade                  INTEGER,
  anotacoes                   TEXT,
  criado_em                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_producao_lead ON public.lead_producao (lead_id);

-- ============================================================
-- BLOCO 4 — TABELA: lead_arquivos
-- Metadados de arquivos vinculados ao lead (Storage externo)
-- NÃO armazena arquivos em base64 ou binário
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_arquivos (
  id            TEXT        PRIMARY KEY,
  lead_id       TEXT        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  venda_id      TEXT        NULL,     -- vínculo à venda/pedido, quando existir
  conversa_id   TEXT        NULL,     -- vínculo à conversa WhatsApp
  mensagem_id   TEXT        NULL,     -- evolution_message_id (deduplicação)
  nome_original TEXT        NOT NULL,
  nome_storage  TEXT        NOT NULL, -- path no Supabase Storage
  url           TEXT        NOT NULL, -- URL pública ou assinada
  tamanho       BIGINT,               -- tamanho em bytes
  mime_type     TEXT,
  enviado_por   TEXT        REFERENCES public.usuarios(id),
  origem        TEXT        NOT NULL DEFAULT 'upload', -- upload | whatsapp
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_arquivos_lead      ON public.lead_arquivos (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_venda     ON public.lead_arquivos (venda_id)     WHERE venda_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_conversa  ON public.lead_arquivos (conversa_id)  WHERE conversa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_mensagem  ON public.lead_arquivos (mensagem_id)  WHERE mensagem_id IS NOT NULL;

-- Se a tabela lead_arquivos já existir de execução anterior, garante colunas novas:
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS venda_id     TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS conversa_id  TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS mensagem_id  TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS origem       TEXT DEFAULT 'upload';

-- ============================================================
-- BLOCO 5 — SUPABASE STORAGE: Bucket lead-arquivos
-- O bucket é criado automaticamente pelo backend no primeiro upload,
-- mas você pode criá-lo manualmente com visibilidade pública:
--
--   Supabase Dashboard → Storage → New bucket
--   Nome: lead-arquivos
--   Público: SIM (para URLs públicas funcionarem)
--
-- ============================================================

-- ============================================================
-- BLOCO 6 — VERIFICAÇÃO FINAL (SELECT de confirmação)
-- ============================================================

SELECT
  table_name,
  CASE
    WHEN table_name IN ('atividades','lead_producao','lead_arquivos') THEN '✅ CRIADA AGORA'
    ELSE '✅ JÁ EXISTIA'
  END AS status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'usuarios','funis','etapas','leads','lead_produtos','metas','comissoes',
    'mensagens_padrao','motivos_perda','produtos','audit_logs',
    'conversas_whatsapp','mensagens_whatsapp','whatsapp_mensagens',
    'planilha_importacoes','atividades','lead_producao','lead_arquivos'
  )
ORDER BY table_name;

SELECT 'Migration consolidada aplicada com sucesso! 🚀' AS resultado,
       NOW() AS executada_em;
