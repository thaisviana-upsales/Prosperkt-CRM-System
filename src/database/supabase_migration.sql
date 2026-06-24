-- ============================================================================
-- PROSPERKT CRM — Supabase Migration
-- Execute este script no SQL Editor do Supabase Dashboard:
-- https://supabase.com/dashboard/project/wtuhaoyqojzelaqteclx/sql/new
-- ============================================================================

-- Habilita extensões necessárias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- FUNÇÃO AUXILIAR: exec_sql
-- Permite o backend executar SQL arbitrário via RPC (service_role only)
-- ============================================================================
CREATE OR REPLACE FUNCTION exec_sql(query text, params jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  final_query text;
  i integer;
  param_val text;
BEGIN
  -- Substitui $1, $2... pelos valores do array params
  final_query := query;
  FOR i IN 0..jsonb_array_length(params)-1 LOOP
    param_val := params->>i;
    IF param_val IS NULL THEN
      final_query := regexp_replace(final_query, '\$' || (i+1) || '\b', 'NULL', 'g');
    ELSE
      -- Escapa aspas simples para evitar SQL injection
      param_val := replace(param_val, '''', '''''');
      final_query := regexp_replace(final_query, '\$' || (i+1) || '\b', '''' || param_val || '''', 'g');
    END IF;
  END LOOP;

  EXECUTE 'SELECT COALESCE(json_agg(t), ''[]''::json) FROM (' || final_query || ') t'
  INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'exec_sql error: % | Query: %', SQLERRM, final_query;
END;
$$;

-- Restringe exec_sql apenas ao service_role
REVOKE ALL ON FUNCTION exec_sql(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION exec_sql(text, jsonb) TO service_role;

-- ============================================================================
-- TABELA: usuarios
-- ============================================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id            TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'VENDEDOR'
                CHECK(role IN ('SUPER_ADMIN','GESTOR','VENDEDOR')),
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_role  ON usuarios(role);

-- ============================================================================
-- TABELA: refresh_tokens
-- ============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expira_em   TIMESTAMPTZ NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_usuario ON refresh_tokens(usuario_id);

-- ============================================================================
-- TABELA: funis
-- ============================================================================
CREATE TABLE IF NOT EXISTS funis (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  nome        TEXT NOT NULL,
  descricao   TEXT,
  cor         TEXT DEFAULT '#6CFF4E',
  ativo       INTEGER NOT NULL DEFAULT 1,
  ordem       INTEGER DEFAULT 0,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TABELA: etapas
-- ============================================================================
CREATE TABLE IF NOT EXISTS etapas (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  funil_id    TEXT NOT NULL REFERENCES funis(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  cor         TEXT DEFAULT '#6CFF4E',
  ordem       INTEGER DEFAULT 0,
  probabilidade INTEGER DEFAULT 0,
  sla_horas   INTEGER DEFAULT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_etapas_funil ON etapas(funil_id);

-- ============================================================================
-- TABELA: leads
-- ============================================================================
CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  nome            TEXT NOT NULL,
  email           TEXT,
  telefone        TEXT,
  empresa         TEXT,
  cargo           TEXT,
  origem          TEXT DEFAULT 'manual',
  valor           NUMERIC(14,2) DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'ativo'
                  CHECK(status IN ('ativo','ganho','perdido','arquivado')),
  pipeline_id     TEXT REFERENCES funis(id),
  etapa_id        TEXT REFERENCES etapas(id),
  responsavel_id  TEXT REFERENCES usuarios(id),
  observacoes     TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ganho_em        TIMESTAMPTZ,
  perdido_em      TIMESTAMPTZ,
  perdido_motivo  TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_etapa       ON leads(etapa_id);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline    ON leads(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_leads_responsavel ON leads(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads(status);

-- ============================================================================
-- TABELA: mensagens (notas/atividades do lead)
-- ============================================================================
CREATE TABLE IF NOT EXISTS mensagens (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  lead_id     TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  usuario_id  TEXT REFERENCES usuarios(id),
  texto       TEXT NOT NULL,
  tipo        TEXT DEFAULT 'nota',
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mensagens_lead ON mensagens(lead_id);

-- ============================================================================
-- TABELA: tarefas
-- ============================================================================
CREATE TABLE IF NOT EXISTS tarefas (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  lead_id     TEXT REFERENCES leads(id) ON DELETE CASCADE,
  usuario_id  TEXT REFERENCES usuarios(id),
  titulo      TEXT NOT NULL,
  descricao   TEXT,
  prazo       TIMESTAMPTZ,
  concluida   INTEGER DEFAULT 0,
  prioridade  TEXT DEFAULT 'media',
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TABELA: notificacoes
-- ============================================================================
CREATE TABLE IF NOT EXISTS notificacoes (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  usuario_id  TEXT REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo      TEXT NOT NULL,
  mensagem    TEXT,
  tipo        TEXT DEFAULT 'info',
  lida        INTEGER DEFAULT 0,
  link        TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_usuario ON notificacoes(usuario_id, lida);

-- ============================================================================
-- TABELA: logs (auditoria)
-- ============================================================================
CREATE TABLE IF NOT EXISTS logs (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  usuario_id  TEXT REFERENCES usuarios(id),
  acao        TEXT NOT NULL,
  entidade    TEXT,
  entidade_id TEXT,
  antes       JSONB,
  depois      JSONB,
  ip          TEXT,
  user_agent  TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_logs_usuario    ON logs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_logs_entidade   ON logs(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_logs_criado_em  ON logs(criado_em);

-- ============================================================================
-- TABELA: metas
-- ============================================================================
CREATE TABLE IF NOT EXISTS metas (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  usuario_id  TEXT REFERENCES usuarios(id),
  nome        TEXT NOT NULL DEFAULT 'Meta',
  tipo        TEXT NOT NULL DEFAULT 'FATURAMENTO'
              CHECK(tipo IN ('FATURAMENTO','QUANTIDADE_VENDAS','CONVERSAO')),
  valor_alvo  NUMERIC(14,2) DEFAULT 0,
  funil_id    TEXT REFERENCES funis(id),
  funil_tipo  TEXT DEFAULT 'TODOS',
  mes         INTEGER,
  ano         INTEGER,
  observacoes TEXT,
  ativo       INTEGER DEFAULT 1,
  criado_por  TEXT REFERENCES usuarios(id),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_metas_usuario  ON metas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_metas_mes_ano  ON metas(mes, ano);

-- ============================================================================
-- TABELA: comissoes
-- ============================================================================
CREATE TABLE IF NOT EXISTS comissoes (
  id              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  usuario_id      TEXT REFERENCES usuarios(id),
  lead_id         TEXT REFERENCES leads(id),
  funil_id        TEXT REFERENCES funis(id),
  valor_venda     NUMERIC(14,2) DEFAULT 0,
  percentual      NUMERIC(6,4) DEFAULT 0,
  valor_comissao  NUMERIC(14,2) DEFAULT 0,
  status          TEXT DEFAULT 'pendente',
  mes             INTEGER,
  ano             INTEGER,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comissoes_usuario ON comissoes(usuario_id);

-- ============================================================================
-- TABELA: conversas_whatsapp
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversas_whatsapp (
  id              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  lead_id         TEXT REFERENCES leads(id) ON DELETE SET NULL,
  telefone        TEXT NOT NULL,
  nome_contato    TEXT,
  vendedor_id     TEXT REFERENCES usuarios(id),
  status          TEXT NOT NULL DEFAULT 'ABERTA'
                  CHECK(status IN ('ABERTA','FECHADA','AGUARDANDO')),
  ultima_msg_em   TIMESTAMPTZ,
  tempo_resposta_med INTEGER DEFAULT 0,
  origem          TEXT DEFAULT 'MANUAL',
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_lead      ON conversas_whatsapp(lead_id);
CREATE INDEX IF NOT EXISTS idx_wa_vendedor  ON conversas_whatsapp(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_wa_telefone  ON conversas_whatsapp(telefone);

-- ============================================================================
-- TABELA: mensagens_whatsapp
-- ============================================================================
CREATE TABLE IF NOT EXISTS mensagens_whatsapp (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  conversa_id TEXT NOT NULL REFERENCES conversas_whatsapp(id) ON DELETE CASCADE,
  lead_id     TEXT REFERENCES leads(id),
  telefone    TEXT,
  mensagem    TEXT,
  tipo        TEXT NOT NULL DEFAULT 'texto'
              CHECK(tipo IN ('texto','audio','imagem','video','arquivo','sistema')),
  direcao     TEXT NOT NULL DEFAULT 'recebida'
              CHECK(direcao IN ('recebida','enviada')),
  status      TEXT NOT NULL DEFAULT 'enviado'
              CHECK(status IN ('enviado','entregue','lido','erro')),
  vendedor_id TEXT REFERENCES usuarios(id),
  arquivo_url  TEXT,
  arquivo_nome TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_conversa ON mensagens_whatsapp(conversa_id);

-- ============================================================================
-- TABELA: automacoes_mensagens
-- ============================================================================
CREATE TABLE IF NOT EXISTS automacoes_mensagens (
  id              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  nome            TEXT NOT NULL,
  ativo           INTEGER DEFAULT 1,
  funil_id        TEXT REFERENCES funis(id),
  etapa_id        TEXT REFERENCES etapas(id),
  tempo_envio     TEXT DEFAULT 'imediato',
  texto_mensagem  TEXT NOT NULL,
  criado_por      TEXT REFERENCES usuarios(id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TABELA: mensagens_padrao
-- ============================================================================
CREATE TABLE IF NOT EXISTS mensagens_padrao (
  id          TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  titulo      TEXT NOT NULL,
  categoria   TEXT NOT NULL DEFAULT 'Geral',
  texto       TEXT NOT NULL,
  funil_id    TEXT REFERENCES funis(id) ON DELETE SET NULL,
  etapa_id    TEXT REFERENCES etapas(id) ON DELETE SET NULL,
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_por  TEXT REFERENCES usuarios(id),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_msg_padrao_cat   ON mensagens_padrao(categoria);
CREATE INDEX IF NOT EXISTS idx_msg_padrao_funil ON mensagens_padrao(funil_id);

-- ============================================================================
-- ROW LEVEL SECURITY — desabilitado para todas as tabelas (acesso via service_role)
-- ============================================================================
ALTER TABLE usuarios              DISABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens        DISABLE ROW LEVEL SECURITY;
ALTER TABLE funis                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE etapas                DISABLE ROW LEVEL SECURITY;
ALTER TABLE leads                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens             DISABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas               DISABLE ROW LEVEL SECURITY;
ALTER TABLE notificacoes          DISABLE ROW LEVEL SECURITY;
ALTER TABLE logs                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE metas                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE comissoes             DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversas_whatsapp    DISABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens_whatsapp    DISABLE ROW LEVEL SECURITY;
ALTER TABLE automacoes_mensagens  DISABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens_padrao      DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SEED: Super Admin inicial (senha: Admin@2026!)
-- Hash bcrypt de Admin@2026! com salt 12
-- ============================================================================
INSERT INTO usuarios (id, nome, email, senha_hash, role, ativo)
VALUES (
  encode(gen_random_bytes(16), 'hex'),
  'Super Admin',
  'admin@prosperkt.com',
  '$2b$12$nj48lIsQiku.J6S42w5S5O1Dr29LiyEgiYKPZL4mUl5YiMKHkx5B6',
  'SUPER_ADMIN',
  1
)
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- SEED: Funil inicial "Tráfego Pago"
-- ============================================================================
INSERT INTO funis (id, nome, descricao, cor, ativo, ordem)
VALUES (
  'f1-trafego-pago-seed-prosperkt',
  'Tráfego Pago',
  'Leads vindos de anúncios pagos',
  '#6CFF4E',
  1,
  0
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO etapas (id, funil_id, nome, cor, ordem, probabilidade)
VALUES
  ('e1-lead-recebido',    'f1-trafego-pago-seed-prosperkt', 'Lead Recebido',         '#6CFF4E', 0, 10),
  ('e2-contato-realiz',   'f1-trafego-pago-seed-prosperkt', 'Contato Realizado',     '#3B8BFF', 1, 30),
  ('e3-proposta-envia',   'f1-trafego-pago-seed-prosperkt', 'Proposta Enviada',      '#F7B731', 2, 60),
  ('e4-negociacao',       'f1-trafego-pago-seed-prosperkt', 'Negociação',            '#FF8C00', 3, 75),
  ('e5-ganho',            'f1-trafego-pago-seed-prosperkt', 'Vendas',                '#6CFF4E', 4, 100),
  ('e6-perdido',          'f1-trafego-pago-seed-prosperkt', 'Lead Desqualificado',   '#E10098', 5, 0)
ON CONFLICT (id) DO NOTHING;
