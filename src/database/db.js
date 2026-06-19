/**
 * PROSPEKT CRM — Database Schema & Initialization
 * Banco de dados SQLite com melhor-sqlite3 (síncrono, persistente)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './data/prosperkt.db';
const dbDir = path.dirname(path.resolve(DB_PATH));

// Garante que o diretório existe
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(path.resolve(DB_PATH), {
      verbose: process.env.NODE_ENV === 'development' ? console.log : null,
    });
    db.pragma('journal_mode = WAL');       // Write-Ahead Logging para performance
    db.pragma('foreign_keys = ON');         // FK constraints ativos
    db.pragma('synchronous = NORMAL');      // Balanço entre segurança e velocidade
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    -- ================================================================
    -- TABELA: usuarios
    -- ================================================================
    CREATE TABLE IF NOT EXISTS usuarios (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nome        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      senha_hash  TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'VENDEDOR'
                  CHECK(role IN ('SUPER_ADMIN','GESTOR','VENDEDOR')),
      ativo       INTEGER NOT NULL DEFAULT 1,
      avatar_url  TEXT,
      criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: refresh_tokens (sessões persistentes)
    -- ================================================================
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL UNIQUE,
      expires_at  TEXT NOT NULL,
      ip_address  TEXT,
      user_agent  TEXT,
      criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: funis
    -- ================================================================
    CREATE TABLE IF NOT EXISTS funis (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nome        TEXT NOT NULL,
      descricao   TEXT,
      cor         TEXT DEFAULT '#6CFF4E',
      ativo       INTEGER NOT NULL DEFAULT 1,
      criado_por  TEXT REFERENCES usuarios(id),
      criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: pipelines
    -- ================================================================
    CREATE TABLE IF NOT EXISTS pipelines (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      funil_id    TEXT NOT NULL REFERENCES funis(id) ON DELETE CASCADE,
      nome        TEXT NOT NULL,
      descricao   TEXT,
      ordem       INTEGER NOT NULL DEFAULT 0,
      ativo       INTEGER NOT NULL DEFAULT 1,
      criado_por  TEXT REFERENCES usuarios(id),
      criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: etapas (kanban columns dentro do pipeline)
    -- ================================================================
    CREATE TABLE IF NOT EXISTS etapas (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      nome        TEXT NOT NULL,
      cor         TEXT DEFAULT '#6CFF4E',
      ordem       INTEGER NOT NULL DEFAULT 0,
      is_ganho    INTEGER NOT NULL DEFAULT 0,
      is_perdido  INTEGER NOT NULL DEFAULT 0,
      probabilidade INTEGER DEFAULT 50 CHECK(probabilidade BETWEEN 0 AND 100),
      criado_por  TEXT REFERENCES usuarios(id),
      criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: leads
    -- ================================================================
    CREATE TABLE IF NOT EXISTS leads (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nome          TEXT NOT NULL,
      email         TEXT,
      telefone      TEXT,
      empresa       TEXT,
      cargo         TEXT,
      valor         REAL DEFAULT 0,
      pipeline_id   TEXT REFERENCES pipelines(id),
      etapa_id      TEXT REFERENCES etapas(id),
      responsavel_id TEXT REFERENCES usuarios(id),
      origem        TEXT,
      tags          TEXT,                    -- JSON array serializado
      dados_extras  TEXT,                    -- JSON livre para campos customizados
      status        TEXT NOT NULL DEFAULT 'ABERTO'
                    CHECK(status IN ('ABERTO','GANHO','PERDIDO','ARQUIVADO')),
      data_fechamento TEXT,
      motivo_perda  TEXT,
      criado_por    TEXT REFERENCES usuarios(id),
      criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: mensagens (histórico de contato com lead)
    -- ================================================================
    CREATE TABLE IF NOT EXISTS mensagens (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      lead_id     TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      usuario_id  TEXT REFERENCES usuarios(id),
      tipo        TEXT NOT NULL DEFAULT 'NOTA'
                  CHECK(tipo IN ('NOTA','EMAIL','WHATSAPP','LIGACAO','REUNIAO','SISTEMA')),
      conteudo    TEXT NOT NULL,
      anexos      TEXT,                      -- JSON array de URLs
      enviado_em  TEXT NOT NULL DEFAULT (datetime('now')),
      criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: logs (auditoria completa)
    -- ================================================================
    CREATE TABLE IF NOT EXISTS logs (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      usuario_id    TEXT REFERENCES usuarios(id),
      usuario_nome  TEXT,
      usuario_role  TEXT,
      acao          TEXT NOT NULL,           -- CREATE, UPDATE, DELETE, LOGIN, LOGOUT, etc.
      entidade      TEXT NOT NULL,           -- nome da tabela afetada
      entidade_id   TEXT,                    -- id do registro afetado
      dados_antes   TEXT,                    -- JSON do estado anterior
      dados_depois  TEXT,                    -- JSON do estado novo
      ip_address    TEXT,
      user_agent    TEXT,
      criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: notificacoes
    -- ================================================================
    CREATE TABLE IF NOT EXISTS notificacoes (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      titulo      TEXT NOT NULL,
      mensagem    TEXT NOT NULL,
      tipo        TEXT NOT NULL DEFAULT 'INFO'
                  CHECK(tipo IN ('INFO','SUCESSO','AVISO','ERRO')),
      lida        INTEGER NOT NULL DEFAULT 0,
      link        TEXT,
      criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: automacoes
    -- ================================================================
    CREATE TABLE IF NOT EXISTS automacoes (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nome        TEXT NOT NULL,
      descricao   TEXT,
      trigger_tipo TEXT NOT NULL,            -- ETAPA_MUDOU, TEMPO, WEBHOOK, etc.
      trigger_config TEXT,                   -- JSON
      acao_tipo   TEXT NOT NULL,             -- ENVIAR_EMAIL, MOVER_ETAPA, NOTIFICAR, etc.
      acao_config TEXT,                      -- JSON
      ativo       INTEGER NOT NULL DEFAULT 1,
      criado_por  TEXT REFERENCES usuarios(id),
      criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: metas
    -- ================================================================
    CREATE TABLE IF NOT EXISTS metas (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      usuario_id  TEXT REFERENCES usuarios(id),
      funil_id    TEXT REFERENCES funis(id),
      funil_tipo  TEXT DEFAULT 'TODOS',
      mes         INTEGER,
      ano         INTEGER,
      titulo      TEXT NOT NULL DEFAULT '',
      tipo        TEXT NOT NULL DEFAULT 'FATURAMENTO'
                  CHECK(tipo IN ('FATURAMENTO','QUANTIDADE_VENDAS','LEADS_RECEBIDOS','ORCAMENTOS_ENVIADOS','CONVERSAO','TICKET_MEDIO')),
      valor_alvo  REAL NOT NULL DEFAULT 0,
      observacoes TEXT,
      ativo       INTEGER NOT NULL DEFAULT 1,
      criado_por  TEXT REFERENCES usuarios(id),
      criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: comissoes
    -- ================================================================
    CREATE TABLE IF NOT EXISTS comissoes (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      usuario_id    TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      lead_id       TEXT REFERENCES leads(id),
      valor_venda   REAL NOT NULL DEFAULT 0,
      percentual    REAL NOT NULL DEFAULT 0,
      valor_comissao REAL NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'PENDENTE'
                    CHECK(status IN ('PENDENTE','APROVADA','PAGA','CANCELADA')),
      periodo_ref   TEXT NOT NULL,           -- ex: "2026-05"
      observacoes   TEXT,
      aprovado_por  TEXT REFERENCES usuarios(id),
      aprovado_em   TEXT,
      criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: conversas_whatsapp
    -- ================================================================
    CREATE TABLE IF NOT EXISTS conversas_whatsapp (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      lead_id       TEXT REFERENCES leads(id) ON DELETE SET NULL,
      telefone      TEXT NOT NULL,
      nome_contato  TEXT,
      vendedor_id   TEXT REFERENCES usuarios(id),
      status        TEXT NOT NULL DEFAULT 'ABERTA'
                    CHECK(status IN ('ABERTA','FECHADA','AGUARDANDO')),
      ultima_msg_em TEXT,
      tempo_resposta_med INTEGER DEFAULT 0,
      origem        TEXT DEFAULT 'MANUAL',
      criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- TABELA: mensagens_whatsapp
    -- ================================================================
    CREATE TABLE IF NOT EXISTS mensagens_whatsapp (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      conversa_id   TEXT NOT NULL REFERENCES conversas_whatsapp(id) ON DELETE CASCADE,
      lead_id       TEXT REFERENCES leads(id),
      telefone      TEXT,
      mensagem      TEXT,
      tipo          TEXT NOT NULL DEFAULT 'texto'
                    CHECK(tipo IN ('texto','audio','imagem','video','arquivo','sistema')),
      direcao       TEXT NOT NULL DEFAULT 'recebida'
                    CHECK(direcao IN ('recebida','enviada')),
      status        TEXT NOT NULL DEFAULT 'enviado'
                    CHECK(status IN ('enviado','entregue','lido','erro')),
      vendedor_id   TEXT REFERENCES usuarios(id),
      arquivo_url   TEXT,
      arquivo_nome  TEXT,
      criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- ÍNDICES para performance
    -- ================================================================
    CREATE INDEX IF NOT EXISTS idx_leads_etapa       ON leads(etapa_id);
    CREATE INDEX IF NOT EXISTS idx_leads_pipeline    ON leads(pipeline_id);
    CREATE INDEX IF NOT EXISTS idx_leads_responsavel ON leads(responsavel_id);
    CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_mensagens_lead    ON mensagens(lead_id);
    CREATE INDEX IF NOT EXISTS idx_logs_usuario      ON logs(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_logs_entidade     ON logs(entidade, entidade_id);
    CREATE INDEX IF NOT EXISTS idx_logs_criado_em    ON logs(criado_em);
    CREATE INDEX IF NOT EXISTS idx_notif_usuario     ON notificacoes(usuario_id, lida);
    CREATE INDEX IF NOT EXISTS idx_refresh_usuario   ON refresh_tokens(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_comissoes_usuario ON comissoes(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_metas_usuario     ON metas(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_wa_conversa       ON mensagens_whatsapp(conversa_id);
    CREATE INDEX IF NOT EXISTS idx_wa_lead           ON conversas_whatsapp(lead_id);
    CREATE INDEX IF NOT EXISTS idx_wa_vendedor       ON conversas_whatsapp(vendedor_id);

    -- ================================================================
    -- TABELA: mensagens_padrao
    -- Biblioteca de scripts de mensagem reutilizáveis pelos vendedores
    -- ================================================================
    CREATE TABLE IF NOT EXISTS mensagens_padrao (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      titulo      TEXT NOT NULL,
      categoria   TEXT NOT NULL DEFAULT 'Geral',
      texto       TEXT NOT NULL,
      funil_id    TEXT REFERENCES funis(id) ON DELETE SET NULL,
      etapa_id    TEXT REFERENCES etapas(id) ON DELETE SET NULL,
      ativo       INTEGER NOT NULL DEFAULT 1,
      criado_por  TEXT REFERENCES usuarios(id),
      criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_msg_padrao_cat    ON mensagens_padrao(categoria);
    CREATE INDEX IF NOT EXISTS idx_msg_padrao_funil  ON mensagens_padrao(funil_id);
    CREATE INDEX IF NOT EXISTS idx_msg_padrao_ativo  ON mensagens_padrao(ativo);
  `);

  // Migrations seguras (ADD COLUMN se nao existir)
  const migrations = [
    `ALTER TABLE etapas ADD COLUMN sla_horas INTEGER DEFAULT NULL`,
    `ALTER TABLE metas ADD COLUMN funil_id TEXT REFERENCES funis(id)`,
    `ALTER TABLE metas ADD COLUMN funil_tipo TEXT DEFAULT 'TODOS'`,
    `ALTER TABLE metas ADD COLUMN mes INTEGER`,
    `ALTER TABLE metas ADD COLUMN ano INTEGER`,
    `ALTER TABLE metas ADD COLUMN observacoes TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_metas_mes_ano ON metas(mes, ano)`,
    `CREATE TABLE IF NOT EXISTS comissao_regras (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nome TEXT NOT NULL,
      usuario_id TEXT REFERENCES usuarios(id),
      funil_id TEXT REFERENCES funis(id),
      tipo_calculo TEXT NOT NULL DEFAULT 'PERCENTUAL' CHECK(tipo_calculo IN ('PERCENTUAL','FIXO')),
      percentual REAL DEFAULT 0,
      valor_fixo REAL DEFAULT 0,
      valor_min REAL DEFAULT 0,
      valor_max REAL,
      bonus_meta_pct REAL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_por TEXT REFERENCES usuarios(id),
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // Salário fixo por vendedor
    `ALTER TABLE usuarios ADD COLUMN salario_fixo REAL DEFAULT 0`,

    // ── Administração de Vendas ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS adm_vendas (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      lead_original_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
      nome            TEXT NOT NULL,
      empresa         TEXT,
      email           TEXT,
      telefone        TEXT,
      responsavel_id  TEXT REFERENCES usuarios(id),
      funil_id        TEXT REFERENCES funis(id),
      valor_venda     REAL DEFAULT 0,
      forma_pagamento TEXT,
      quantidade_parcelas INTEGER DEFAULT 1,
      parcelas_json   TEXT,
      produto_id      TEXT,
      produto_nome    TEXT,
      produto_cor     TEXT,
      origem          TEXT,
      tags            TEXT,
      dados_extras    TEXT,
      observacoes     TEXT,
      data_venda      TEXT,
      data_entrega_prevista TEXT,
      etapa           TEXT NOT NULL DEFAULT 'acompanhamento'
                      CHECK(etapa IN ('acompanhamento','compras','producao','manuseio','transporte','concluido')),
      status          TEXT NOT NULL DEFAULT 'ativo'
                      CHECK(status IN ('ativo','concluido','cancelado')),
      criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em   TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_admv_lead_orig  ON adm_vendas(lead_original_id)`,
    `CREATE INDEX IF NOT EXISTS idx_admv_responsavel ON adm_vendas(responsavel_id)`,
    `CREATE INDEX IF NOT EXISTS idx_admv_etapa       ON adm_vendas(etapa)`,
    `CREATE INDEX IF NOT EXISTS idx_admv_status      ON adm_vendas(status)`,
    `CREATE TABLE IF NOT EXISTS adm_vendas_historico (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      adm_venda_id TEXT NOT NULL REFERENCES adm_vendas(id) ON DELETE CASCADE,
      usuario_id TEXT REFERENCES usuarios(id),
      tipo       TEXT NOT NULL DEFAULT 'NOTA'
                 CHECK(tipo IN ('NOTA','SISTEMA','ETAPA','ARQUIVO')),
      conteudo   TEXT NOT NULL,
      criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_admvh_venda ON adm_vendas_historico(adm_venda_id)`,

    // ── Carteira Recorrente — campos em leads ────────────────────────────────
    `ALTER TABLE leads ADD COLUMN previsao_proxima_compra TEXT`,
    `ALTER TABLE leads ADD COLUMN data_prevista_proxima_compra TEXT`,
    `ALTER TABLE leads ADD COLUMN alerta_recompra_em TEXT`,
    `ALTER TABLE leads ADD COLUMN alerta_recompra_enviado INTEGER DEFAULT 0`,
    `ALTER TABLE leads ADD COLUMN tipo_clone TEXT`,
    `ALTER TABLE leads ADD COLUMN lead_original_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_leads_clone ON leads(tipo_clone, lead_original_id)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_alerta ON leads(alerta_recompra_em, alerta_recompra_enviado)`,

    // ── Layout Virtual — campo de aprovação ──────────────────────────────────
    `ALTER TABLE leads ADD COLUMN layout_virtual_aprovado_em TEXT`,
    `ALTER TABLE leads ADD COLUMN layout_virtual_entrada_em TEXT`,
  ];
  migrations.forEach(sql => { try { db.exec(sql); } catch(_){} });

  // Seed
  seedSuperAdmin(db);

  // Rebuild metas se schema antigo (CHECK constraint errado)
  rebuildMetasTableIfNeeded(db);
}

function seedSuperAdmin(db) {
  const bcrypt = require('bcryptjs');
  const existing = db.prepare("SELECT id FROM usuarios WHERE role = 'SUPER_ADMIN' LIMIT 1").get();
  if (!existing) {
    const hash = bcrypt.hashSync('Admin@2026!', 12);
    const id = require('crypto').randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO usuarios (id, nome, email, senha_hash, role)
      VALUES (?, ?, ?, ?, 'SUPER_ADMIN')
    `).run(id, 'Super Admin', 'admin@prosperkt.com', hash);

    console.log('\n✅ SUPER_ADMIN criado:');
    console.log('   Email: admin@prosperkt.com');
    console.log('   Senha: Admin@2026!\n');
  }
}

/**
 * SQLite nao suporta ALTER COLUMN. Detecta o schema antigo da tabela metas
 * (CHECK com VALOR/QUANTIDADE/TAXA) e reconstroi preservando todos os dados.
 */
function rebuildMetasTableIfNeeded(db) {
  try {
    const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='metas'").get();
    if (!info) return;
    const isOld = info.sql.includes("'VALOR'") ||
                  info.sql.includes("'QUANTIDADE'") ||
                  info.sql.includes('data_inicio TEXT NOT NULL');
    if (!isOld) return;

    console.log('[DB] Reconstruindo tabela metas (schema antigo detectado)...');
    db.exec('PRAGMA foreign_keys = OFF');

    db.transaction(() => {
      // Garante colunas extras existam antes de renomear
      ['funil_id TEXT','funil_tipo TEXT','mes INTEGER','ano INTEGER','observacoes TEXT'].forEach(col => {
        try { db.exec('ALTER TABLE metas ADD COLUMN ' + col); } catch(_) {}
      });

      db.exec('ALTER TABLE metas RENAME TO metas_old');

      db.exec(`CREATE TABLE metas (
        id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        usuario_id    TEXT REFERENCES usuarios(id),
        funil_id      TEXT REFERENCES funis(id),
        funil_tipo    TEXT DEFAULT 'TODOS',
        mes           INTEGER,
        ano           INTEGER,
        titulo        TEXT NOT NULL DEFAULT '',
        tipo          TEXT NOT NULL DEFAULT 'FATURAMENTO'
                      CHECK(tipo IN ('FATURAMENTO','QUANTIDADE_VENDAS','LEADS_RECEBIDOS','ORCAMENTOS_ENVIADOS','CONVERSAO','TICKET_MEDIO')),
        valor_alvo    REAL NOT NULL DEFAULT 0,
        observacoes   TEXT,
        ativo         INTEGER NOT NULL DEFAULT 1,
        criado_por    TEXT REFERENCES usuarios(id),
        criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
        atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.exec(`INSERT INTO metas
        (id,usuario_id,funil_id,funil_tipo,mes,ano,titulo,tipo,valor_alvo,observacoes,ativo,criado_por,criado_em,atualizado_em)
        SELECT
          id, usuario_id, funil_id,
          COALESCE(funil_tipo,'TODOS'),
          COALESCE(mes, CAST(strftime('%m', criado_em) AS INTEGER)),
          COALESCE(ano, CAST(strftime('%Y', criado_em) AS INTEGER)),
          COALESCE(titulo,''),
          CASE
            WHEN tipo IN ('FATURAMENTO','QUANTIDADE_VENDAS','LEADS_RECEBIDOS','ORCAMENTOS_ENVIADOS','CONVERSAO','TICKET_MEDIO') THEN tipo
            WHEN tipo='VALOR'      THEN 'FATURAMENTO'
            WHEN tipo='QUANTIDADE' THEN 'QUANTIDADE_VENDAS'
            WHEN tipo='TAXA'       THEN 'CONVERSAO'
            ELSE 'FATURAMENTO'
          END,
          COALESCE(valor_alvo,0), observacoes, COALESCE(ativo,1),
          criado_por, criado_em, atualizado_em
        FROM metas_old`);

      db.exec('DROP TABLE metas_old');
      db.exec('CREATE INDEX IF NOT EXISTS idx_metas_usuario ON metas(usuario_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_metas_mes_ano ON metas(mes, ano)');
    })();

    db.exec('PRAGMA foreign_keys = ON');
    console.log('[DB] Tabela metas reconstruida com sucesso.');
  } catch (e) {
    console.error('[DB] Erro ao reconstruir tabela metas:', e.message);
    try {
      const hasOld = db.prepare("SELECT name FROM sqlite_master WHERE name='metas_old'").get();
      if (hasOld) {
        try { db.exec('DROP TABLE IF EXISTS metas'); } catch(_) {}
        db.exec('ALTER TABLE metas_old RENAME TO metas');
        console.log('[DB] Rollback: tabela antiga restaurada.');
      }
    } catch(_) {}
    try { db.exec('PRAGMA foreign_keys = ON'); } catch(_) {}
  }
}

module.exports = { getDb };
