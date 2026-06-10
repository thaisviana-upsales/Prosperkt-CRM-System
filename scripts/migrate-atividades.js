/**
 * Verifica se as tabelas de atividades, lead_producao e lead_arquivos existem no Supabase.
 * Não executa DDL (o DDL fica no arquivo SQL consolidado).
 * Serve apenas para validar se a migration foi aplicada.
 *
 * Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-atividades.js
 */
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Erro: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('\n=== Verificando tabelas no Supabase ===\n');

  const tabelas = ['atividades', 'lead_producao', 'lead_arquivos'];
  let todasOk = true;

  for (const tabela of tabelas) {
    const { error } = await supabase.from(tabela).select('id').limit(1);
    if (error) {
      console.log(`❌ NÃO EXISTE: ${tabela}`);
      todasOk = false;
    } else {
      console.log(`✅ EXISTE: ${tabela}`);
    }
  }

  console.log('');
  if (todasOk) {
    console.log('✅ Todas as tabelas existem. CRM pronto para usar.');
  } else {
    console.log('⚠️  Execute a migration consolidada no Supabase SQL Editor antes de usar o CRM.');
    console.log('   Arquivo: src/database/migration_consolidada_supabase_pendente_2026_06_10.sql');
    console.log('   Link: https://supabase.com/dashboard/project/wtuhaoyqojzelaqteclx/sql/new');
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
