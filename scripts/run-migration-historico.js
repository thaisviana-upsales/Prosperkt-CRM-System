/**
 * MIGRATION DIRETA: Cria tabela lead_etapa_historico no Supabase
 * Usa conexão pg direta (porta 5432/6543 do Supabase)
 *
 * Como rodar:
 *   node scripts/run-migration-historico.js
 *
 * Requer DATABASE_URL ou SUPABASE_DB_PASSWORD no .env
 */

require('dotenv').config();
const crypto = require('crypto');

// ─── Detecta string de conexão ───────────────────────────────────────────────
const PROJECT_REF = 'wtuhaoyqojzelaqteclx';
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_PASSWORD || '';
const DATABASE_URL = process.env.DATABASE_URL ||
  (DB_PASSWORD ? `postgresql://postgres.${PROJECT_REF}:${DB_PASSWORD}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres` : null);

async function runViaDirectPg() {
  if (!DATABASE_URL) {
    console.log('[PG_DIRETO] DATABASE_URL não configurada — pulando.');
    return false;
  }
  try {
    const { Client } = require('pg');
    const client = new Client({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });
    await client.connect();
    console.log('[PG_DIRETO] Conectado ao Supabase via pg!');
    await executarSQL(client);
    await client.end();
    return true;
  } catch (e) {
    console.log('[PG_DIRETO] Falhou:', e.message.slice(0, 100));
    return false;
  }
}

async function executarSQL(client) {
  console.log('\n[1/5] Criando tabela lead_etapa_historico...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS lead_etapa_historico (
      id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      lead_id        TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      etapa_id       TEXT NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
      funil_id       TEXT REFERENCES funis(id),
      pipeline_id    TEXT REFERENCES pipelines(id),
      responsavel_id TEXT REFERENCES usuarios(id),
      entrou_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      origem         TEXT DEFAULT 'manual',
      UNIQUE(lead_id, etapa_id)
    );
  `);
  console.log('   ✅ Tabela criada (ou já existia).');

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_leh_lead      ON lead_etapa_historico(lead_id);
    CREATE INDEX IF NOT EXISTS idx_leh_etapa     ON lead_etapa_historico(etapa_id);
    CREATE INDEX IF NOT EXISTS idx_leh_funil     ON lead_etapa_historico(funil_id);
    CREATE INDEX IF NOT EXISTS idx_leh_resp      ON lead_etapa_historico(responsavel_id);
    CREATE INDEX IF NOT EXISTS idx_leh_entrou_em ON lead_etapa_historico(entrou_em);
  `);
  console.log('   ✅ Índices criados.');

  await client.query(`ALTER TABLE lead_etapa_historico DISABLE ROW LEVEL SECURITY;`);
  console.log('   ✅ RLS desabilitado.');

  console.log('\n[2/5] Backfill etapa atual...');
  const r2 = await client.query(`
    INSERT INTO lead_etapa_historico (id, lead_id, etapa_id, funil_id, pipeline_id, responsavel_id, entrou_em, criado_em, origem)
    SELECT gen_random_uuid()::text, l.id, l.etapa_id, l.funil_id, l.pipeline_id, l.responsavel_id,
      COALESCE(l.atualizado_em, l.criado_em, NOW()), NOW(), 'migration_etapa_atual'
    FROM leads l WHERE l.etapa_id IS NOT NULL AND (l.deleted_at IS NULL OR l.deleted_at::text = '')
    ON CONFLICT (lead_id, etapa_id) DO NOTHING
  `);
  console.log(`   ✅ Etapa atual: ${r2.rowCount} inseridos`);

  console.log('\n[3/5] Backfill primeira etapa da pipeline...');
  const r3 = await client.query(`
    INSERT INTO lead_etapa_historico (id, lead_id, etapa_id, funil_id, pipeline_id, responsavel_id, entrou_em, criado_em, origem)
    SELECT gen_random_uuid()::text, l.id, e_first.id, l.funil_id, l.pipeline_id, l.responsavel_id,
      COALESCE(l.criado_em, NOW()), NOW(), 'migration_primeira_etapa'
    FROM leads l
    JOIN pipelines p ON p.id = l.pipeline_id
    JOIN LATERAL (SELECT id FROM etapas WHERE pipeline_id = p.id ORDER BY ordem ASC LIMIT 1) e_first ON TRUE
    WHERE l.pipeline_id IS NOT NULL AND (l.deleted_at IS NULL OR l.deleted_at::text = '')
    ON CONFLICT (lead_id, etapa_id) DO NOTHING
  `);
  console.log(`   ✅ Primeira etapa: ${r3.rowCount} inseridos`);

  const r5 = await client.query(`
    SELECT COUNT(*) AS total, COUNT(DISTINCT lead_id) AS leads, COUNT(DISTINCT etapa_id) AS etapas
    FROM lead_etapa_historico
  `);
  const stats = r5.rows[0];
  console.log('\n📊 RESULTADO FINAL:');
  console.log('   Total de registros:', stats.total);
  console.log('   Leads únicos:      ', stats.leads);
  console.log('   Etapas únicas:     ', stats.etapas);
  console.log('\n✅ MIGRATION CONCLUÍDA COM SUCESSO!\n');
}

// ─── Fallback: via Supabase JS (backfill apenas, sem CREATE TABLE) ────────────
async function runViaSupabaseJS() {
  console.log('\n[FALLBACK] Usando Supabase JS Client para backfill...');
  const { getProvider } = require('../src/database/dbProvider');
  const { sb } = getProvider();

  // Verifica se tabela existe
  const { error: testErr } = await sb.from('lead_etapa_historico').select('id').limit(1);
  if (testErr) {
    console.log('\n❌ Tabela lead_etapa_historico NÃO existe no Supabase.');
    console.log('\n📋 AÇÃO NECESSÁRIA: Execute o SQL abaixo no Supabase SQL Editor:');
    console.log('   https://supabase.com/dashboard/project/' + PROJECT_REF + '/sql/new\n');
    printSQL();
    return false;
  }

  console.log('   Tabela existe! Fazendo backfill via JS...');
  const { data: leads } = await sb
    .from('leads')
    .select('id, etapa_id, funil_id, pipeline_id, responsavel_id, criado_em, atualizado_em')
    .is('deleted_at', null);

  console.log(`   Leads encontrados: ${leads?.length || 0}`);

  // Busca primeiras etapas por pipeline
  const pipeIds = [...new Set((leads||[]).map(l=>l.pipeline_id).filter(Boolean))];
  const primeiraMap = {};
  for (const pid of pipeIds) {
    const { data: e } = await sb.from('etapas').select('id,pipeline_id').eq('pipeline_id', pid).order('ordem',{ascending:true}).limit(1);
    if (e?.[0]) primeiraMap[pid] = e[0].id;
  }

  let ok = 0, skip = 0;
  for (const l of (leads||[])) {
    if (l.etapa_id) {
      await sb.from('lead_etapa_historico').upsert({
        id: crypto.randomBytes(16).toString('hex'), lead_id: l.id, etapa_id: l.etapa_id,
        funil_id: l.funil_id||null, pipeline_id: l.pipeline_id||null, responsavel_id: l.responsavel_id||null,
        entrou_em: l.atualizado_em||l.criado_em, criado_em: new Date().toISOString(), origem: 'migration_etapa_atual'
      }, { onConflict: 'lead_id,etapa_id', ignoreDuplicates: true });
      ok++;
    }
    const primeiraEtapaId = primeiraMap[l.pipeline_id];
    if (primeiraEtapaId && primeiraEtapaId !== l.etapa_id) {
      await sb.from('lead_etapa_historico').upsert({
        id: crypto.randomBytes(16).toString('hex'), lead_id: l.id, etapa_id: primeiraEtapaId,
        funil_id: l.funil_id||null, pipeline_id: l.pipeline_id||null, responsavel_id: l.responsavel_id||null,
        entrou_em: l.criado_em, criado_em: new Date().toISOString(), origem: 'migration_primeira_etapa'
      }, { onConflict: 'lead_id,etapa_id', ignoreDuplicates: true });
    }
  }

  const { count } = await sb.from('lead_etapa_historico').select('*', {count:'exact', head:true});
  console.log(`\n✅ Backfill concluído! Total na tabela: ${count}`);
  return true;
}

function printSQL() {
  console.log(`-- =====================================================
-- COLE ESTE SQL NO SUPABASE SQL EDITOR E EXECUTE:
-- =====================================================

CREATE TABLE IF NOT EXISTS lead_etapa_historico (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id        TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  etapa_id       TEXT NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  funil_id       TEXT REFERENCES funis(id),
  pipeline_id    TEXT REFERENCES pipelines(id),
  responsavel_id TEXT REFERENCES usuarios(id),
  entrou_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origem         TEXT DEFAULT 'manual',
  UNIQUE(lead_id, etapa_id)
);

CREATE INDEX IF NOT EXISTS idx_leh_lead      ON lead_etapa_historico(lead_id);
CREATE INDEX IF NOT EXISTS idx_leh_etapa     ON lead_etapa_historico(etapa_id);
CREATE INDEX IF NOT EXISTS idx_leh_funil     ON lead_etapa_historico(funil_id);
CREATE INDEX IF NOT EXISTS idx_leh_resp      ON lead_etapa_historico(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_leh_entrou_em ON lead_etapa_historico(entrou_em);

ALTER TABLE lead_etapa_historico DISABLE ROW LEVEL SECURITY;

INSERT INTO lead_etapa_historico (id, lead_id, etapa_id, funil_id, pipeline_id, responsavel_id, entrou_em, criado_em, origem)
SELECT gen_random_uuid()::text, l.id, l.etapa_id, l.funil_id, l.pipeline_id, l.responsavel_id,
  COALESCE(l.atualizado_em, l.criado_em, NOW()), NOW(), 'migration_etapa_atual'
FROM leads l WHERE l.etapa_id IS NOT NULL AND l.deleted_at IS NULL
ON CONFLICT (lead_id, etapa_id) DO NOTHING;

INSERT INTO lead_etapa_historico (id, lead_id, etapa_id, funil_id, pipeline_id, responsavel_id, entrou_em, criado_em, origem)
SELECT gen_random_uuid()::text, l.id, e_first.id, l.funil_id, l.pipeline_id, l.responsavel_id,
  COALESCE(l.criado_em, NOW()), NOW(), 'migration_primeira_etapa'
FROM leads l
JOIN pipelines p ON p.id = l.pipeline_id
JOIN LATERAL (SELECT id FROM etapas WHERE pipeline_id = p.id ORDER BY ordem ASC LIMIT 1) e_first ON TRUE
WHERE l.pipeline_id IS NOT NULL AND l.deleted_at IS NULL
ON CONFLICT (lead_id, etapa_id) DO NOTHING;

SELECT COUNT(*) AS total, COUNT(DISTINCT lead_id) AS leads, COUNT(DISTINCT etapa_id) AS etapas
FROM lead_etapa_historico;

-- =====================================================
`);
}

async function main() {
  console.log('\n========================================');
  console.log('  MIGRATION: lead_etapa_historico');
  console.log('  Projeto:', PROJECT_REF);
  console.log('========================================\n');

  // Tenta via pg direto primeiro
  const pgOk = await runViaDirectPg();
  if (pgOk) return;

  // Fallback: via Supabase JS (funciona se tabela já existe)
  await runViaSupabaseJS();
}

main().catch(e => {
  console.error('\n❌ FATAL:', e.message);
  process.exit(1);
});
