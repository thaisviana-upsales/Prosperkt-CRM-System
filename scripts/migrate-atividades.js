/**
 * Executa migração: cria tabelas atividades, lead_producao, lead_arquivos
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Erro: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const agora = new Date().toISOString();

  // 1. Atividades
  console.log('Criando tabela atividades...');
  const { error: e1 } = await sb.rpc('exec_sql', {
    sql: `CREATE TABLE IF NOT EXISTS public.atividades (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      usuario_id TEXT,
      tipo TEXT NOT NULL DEFAULT 'Outra',
      observacao TEXT,
      data_limite DATE,
      hora_limite TIME,
      status TEXT NOT NULL DEFAULT 'pendente',
      concluida_em TIMESTAMPTZ,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`
  }).catch(() => null);

  // Tenta via insert para verificar se já existe
  const { error: testAt } = await sb.from('atividades').select('id').limit(1);
  if (testAt && testAt.code === 'PGRST116') {
    console.log('Tabela atividades não pôde ser criada via RPC — use o painel SQL do Supabase');
  } else {
    console.log('✅ Tabela atividades OK');
  }

  // 2. lead_producao
  const { error: testProd } = await sb.from('lead_producao').select('id').limit(1);
  if (testProd) console.log('Tabela lead_producao não existe — crie via SQL');
  else console.log('✅ Tabela lead_producao OK');

  // 3. lead_arquivos
  const { error: testArq } = await sb.from('lead_arquivos').select('id').limit(1);
  if (testArq) console.log('Tabela lead_arquivos não existe — crie via SQL');
  else console.log('✅ Tabela lead_arquivos OK');

  console.log('\n⚠️  Se alguma tabela não existir, execute o SQL abaixo no painel do Supabase:');
  const sql = fs.readFileSync(path.join(__dirname, '../src/database/migration_atividades_producao.sql'), 'utf8');
  console.log('\n' + sql);
}

main().catch(console.error);
