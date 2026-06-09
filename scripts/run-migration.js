#!/usr/bin/env node
/**
 * PROSPEKT CRM — Script de Migration para Supabase
 * Executa o schema SQL completo no Supabase via API direta.
 * 
 * Usage: node scripts/run-migration.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env');
  process.exit(1);
}

const PROJECT_REF = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

async function runQuery(sql) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_raw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  }).catch(() => null);

  // Tenta via Management API
  const resp2 = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await resp2.text();
  if (!resp2.ok) {
    return { ok: false, error: `${resp2.status}: ${text.slice(0, 300)}` };
  }
  return { ok: true, data: text };
}

async function main() {
  console.log('🚀 PROSPEKT CRM — Supabase Migration');
  console.log('📡 URL:', SUPABASE_URL);
  console.log('📁 Project:', PROJECT_REF);

  const sqlFile = path.join(__dirname, '../src/database/supabase_migration.sql');
  const sql = fs.readFileSync(sqlFile, 'utf-8');

  // Divide em statements (por ; no final de linha)
  const statements = sql
    .replace(/--[^\n]*/g, '') // Remove comentários de linha
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  console.log(`\n📋 ${statements.length} statements para executar...\n`);

  let ok = 0, errs = 0;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.slice(0, 60).replace(/\n/g, ' ');
    process.stdout.write(`[${i+1}/${statements.length}] ${preview}... `);

    const res = await runQuery(stmt);
    if (res.ok) {
      ok++;
      console.log('✅');
    } else {
      errs++;
      // Erros esperados (idempotência)
      if (res.error?.includes('already exists') || res.error?.includes('duplicate')) {
        console.log('⚠️ (já existe)');
      } else {
        console.log('❌', res.error?.slice(0, 100));
      }
    }
  }

  console.log(`\n✅ Migration concluída: ${ok} ok, ${errs} erros`);
  
  // Verifica conexão com Supabase
  console.log('\n🔍 Verificando tabelas criadas...');
  const checkRes = await runQuery(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name
  `);
  if (checkRes.ok) {
    try {
      const tables = JSON.parse(checkRes.data);
      console.log('📊 Tabelas no Supabase:', tables.map(t => t.table_name).join(', '));
    } catch { console.log('📊 Response:', checkRes.data?.slice(0, 200)); }
  }
}

main().catch(console.error);
