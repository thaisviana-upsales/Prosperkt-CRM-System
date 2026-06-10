-- ============================================================
-- PROSPEKT CRM — Migration: Tabelas Pendentes
-- Arquivo: migration_tabelas_pendentes_automacoes_whatsapp.sql
-- Data: 2026-06-10
-- Executar manualmente no Supabase SQL Editor
--
-- CONTEXTO:
--   Cria apenas as tabelas que ainda NÃO existem:
--   1. automacoes_msg  → espelho da tabela 'automacoes' do SQLite,
--      usada pelo automacoesMsgController.js para armazenar
--      automações de primeira mensagem WhatsApp (trigger LEAD_CRIADO).
--   2. whatsapp_integracoes → configurações da instância Evolution API,
--      hoje armazenadas no .env. A tabela permite edição via UI
--      futura sem precisar reiniciar o servidor.
--
-- SEGURANÇA:
--   - Usa CREATE TABLE IF NOT EXISTS
--   - Usa ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   - Usa CREATE INDEX IF NOT EXISTS
--   - NÃO usa DROP, DELETE ou TRUNCATE
--   - NÃO recria: atividades, lead_producao, lead_arquivos
-- ============================================================

-- ============================================================
-- BLOCO 1 — TABELA: automacoes_msg
-- Espelho da tabela 'automacoes' do SQLite para o Supabase.
-- Armazena automações de mensagem WhatsApp configuradas pelo
-- Super Admin. Compatível com automacoesMsgController.js.
--
-- Colunas mapeadas do código:
--   id            → TEXT PRIMARY KEY
--   nome          → TEXT NOT NULL                  (obrigatório)
--   descricao     → TEXT                           (opcional)
--   trigger_tipo  → TEXT NOT NULL                  (ex: 'LEAD_CRIADO', 'DISTRIBUICAO')
--   trigger_config→ JSONB                          (ex: {"funil_id": null, "etapa_id": null})
--   acao_tipo     → TEXT NOT NULL                  (ex: 'PRIMEIRA_MSG_WA', 'DISTRIBUIR')
--   acao_config   → JSONB                          (ex: {"mensagem_texto": "...", "delay_segundos": 0})
--   ativo         → BOOLEAN NOT NULL DEFAULT true
--   criado_por    → TEXT REFERENCES usuarios(id)   (nullable)
--   criado_em     → TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   atualizado_em → TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- ============================================================

CREATE TABLE IF NOT EXISTS public.automacoes_msg (
  id             TEXT        PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  nome           TEXT        NOT NULL,
  descricao      TEXT,
  trigger_tipo   TEXT        NOT NULL,
  trigger_config JSONB,
  acao_tipo      TEXT        NOT NULL,
  acao_config    JSONB,
  ativo          BOOLEAN     NOT NULL DEFAULT true,
  criado_por     TEXT        REFERENCES public.usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para buscas frequentes do controller
CREATE INDEX IF NOT EXISTS idx_automacoes_msg_trigger
  ON public.automacoes_msg (trigger_tipo, ativo);

CREATE INDEX IF NOT EXISTS idx_automacoes_msg_acao
  ON public.automacoes_msg (acao_tipo);

CREATE INDEX IF NOT EXISTS idx_automacoes_msg_criado_em
  ON public.automacoes_msg (criado_em DESC);

-- Comentário na tabela
COMMENT ON TABLE public.automacoes_msg IS
  'Automações de mensagem WhatsApp configuradas pelo Super Admin. '
  'Equivalente Supabase da tabela automacoes do SQLite. '
  'trigger_tipo=LEAD_CRIADO dispara mensagem ao criar lead.';

SELECT 'Bloco 1 (automacoes_msg) criado com sucesso.' AS resultado;


-- ============================================================
-- BLOCO 2 — TABELA: whatsapp_integracoes
-- Armazena configurações da instância Evolution API editáveis
-- via interface (alternativa ao .env).
-- A tabela é consultada pelo whatsappController.js quando
-- DATABASE_PROVIDER=supabase e as envs não estiverem preenchidas.
--
-- Colunas derivadas do uso em evolutionApiService.js e
-- whatsappController.js:
--   id               → TEXT PRIMARY KEY
--   nome             → TEXT NOT NULL           (identificador amigável)
--   instance_name    → TEXT NOT NULL           (= EVOLUTION_INSTANCE)
--   api_url          → TEXT NOT NULL           (= EVOLUTION_API_URL)
--   api_key          → TEXT NOT NULL           (= EVOLUTION_API_KEY)
--   webhook_url      → TEXT                    (URL de recebimento de webhooks)
--   status           → TEXT DEFAULT 'desconectado'
--                      valores: 'conectado' | 'desconectado' | 'aguardando_qr'
--   conectado_em     → TIMESTAMPTZ             (última vez que conectou)
--   qr_code          → TEXT                    (base64 temporário para scan)
--   qr_atualizado_em → TIMESTAMPTZ
--   ativo            → BOOLEAN NOT NULL DEFAULT true
--   criado_por       → TEXT REFERENCES usuarios(id)
--   criado_em        → TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   atualizado_em    → TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_integracoes (
  id               TEXT        PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  nome             TEXT        NOT NULL DEFAULT 'Principal',
  instance_name    TEXT        NOT NULL,
  api_url          TEXT        NOT NULL,
  api_key          TEXT        NOT NULL,
  webhook_url      TEXT,
  status           TEXT        NOT NULL DEFAULT 'desconectado'
                               CHECK (status IN ('conectado','desconectado','aguardando_qr','erro')),
  conectado_em     TIMESTAMPTZ,
  qr_code          TEXT,
  qr_atualizado_em TIMESTAMPTZ,
  ativo            BOOLEAN     NOT NULL DEFAULT true,
  criado_por       TEXT        REFERENCES public.usuarios(id) ON DELETE SET NULL,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Somente uma instância ativa por vez (regra de negócio PROSPEKT)
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_integracoes_ativa
  ON public.whatsapp_integracoes (ativo)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_whatsapp_integracoes_status
  ON public.whatsapp_integracoes (status);

-- Comentário na tabela
COMMENT ON TABLE public.whatsapp_integracoes IS
  'Configurações da instância Evolution API para integração WhatsApp. '
  'Complementa as variáveis de ambiente EVOLUTION_API_URL, '
  'EVOLUTION_API_KEY e EVOLUTION_INSTANCE, permitindo edição via UI.';

SELECT 'Bloco 2 (whatsapp_integracoes) criado com sucesso.' AS resultado;


-- ============================================================
-- VALIDAÇÃO FINAL
-- Confirma que as tabelas foram criadas no schema public
-- ============================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('automacoes_msg', 'whatsapp_integracoes')
ORDER BY table_name;
