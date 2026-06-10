-- ============================================================
-- PROSPEKT CRM — Migração: Atividades, Produção, Arquivos
-- ============================================================

-- 1. ATIVIDADES DE LEAD
CREATE TABLE IF NOT EXISTS public.atividades (
  id               TEXT        PRIMARY KEY,
  lead_id          TEXT        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  usuario_id       TEXT        REFERENCES public.usuarios(id),
  tipo             TEXT        NOT NULL DEFAULT 'Outra',
  -- Tipos: Ligar, Mandar mensagem, Visitar, Enviar amostra, Outra
  observacao       TEXT,
  data_limite      DATE,
  hora_limite      TIME,
  status           TEXT        NOT NULL DEFAULT 'pendente',
  -- pendente | concluida | adiada | atrasada
  concluida_em     TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atividades_lead    ON public.atividades(lead_id);
CREATE INDEX IF NOT EXISTS idx_atividades_usuario ON public.atividades(usuario_id);
CREATE INDEX IF NOT EXISTS idx_atividades_status  ON public.atividades(status);

-- 2. PRODUÇÃO DO LEAD
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

-- 3. ARQUIVOS DO LEAD
CREATE TABLE IF NOT EXISTS public.lead_arquivos (
  id            TEXT        PRIMARY KEY,
  lead_id       TEXT        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  venda_id      TEXT        NULL,
  conversa_id   TEXT        NULL,
  mensagem_id   TEXT        NULL,   -- evolution_message_id para deduplication
  nome_original TEXT        NOT NULL,
  nome_storage  TEXT        NOT NULL,
  url           TEXT        NOT NULL,
  tamanho       BIGINT,
  mime_type     TEXT,
  enviado_por   TEXT        REFERENCES public.usuarios(id),
  origem        TEXT        NOT NULL DEFAULT 'upload', -- upload | whatsapp
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_arquivos_lead      ON public.lead_arquivos(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_venda     ON public.lead_arquivos(venda_id);
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_conversa  ON public.lead_arquivos(conversa_id);
CREATE INDEX IF NOT EXISTS idx_lead_arquivos_mensagem  ON public.lead_arquivos(mensagem_id);

-- Se a tabela já existir, adiciona colunas faltantes:
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS origem       TEXT DEFAULT 'upload';
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS mensagem_id  TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS conversa_id  TEXT;
ALTER TABLE public.lead_arquivos ADD COLUMN IF NOT EXISTS venda_id     TEXT;

-- 4. Colunas extras em leads para produção automática
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS proxima_compra DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS quantidade_pecas INTEGER;
