/**
 * PROSPEKT CRM — migrate-usuarios-supabase.js
 * Migra todos os usuários do SQLite para o Supabase usando UPSERT.
 * Mantém os IDs originais e os hashes de senha para que os logins continuem funcionando.
 *
 * Uso: node scripts/migrate-usuarios-supabase.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[ERRO] SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Usuários a migrar ─────────────────────────────────────────────────────────
// Extraídos do SQLite local: data/prosperkt.db tabela usuarios
// Hashes bcrypt originais mantidos para não invalidar senhas existentes.
const USUARIOS = [
  {
    id:         'd8232d8cb99ea2858d2985e68474f434',
    nome:       'Carlos Vendedor',
    email:      'carlos@prosperkt.com',
    role:       'VENDEDOR',
    ativo:      1,
    senha_hash: '$2b$12$mT3WDJvpVmgE2wpEzldXU.fRdoICoz9Kl7uKVoBtvjwCGF42lPgwi',
  },
  {
    id:         '552a63b057bc578a4e2328cb6a839454',
    nome:       'Maria Gestora',
    email:      'maria@prosperkt.com',
    role:       'GESTOR',
    ativo:      1,
    senha_hash: '$2b$12$tJgFSsCfOh2CVbUzHTNQCe6ON70IoKcoxIB/2msaYLcLiD54bbfI2',
  },
  {
    id:         '17084f31bd07a5abe9df63a66af9e449',
    nome:       'Super Admin',
    email:      'admin@prosperkt.com',
    role:       'SUPER_ADMIN',
    ativo:      1,
    senha_hash: '$2b$12$nj48lIsQiku.J6S42w5S5O1Dr29LiyEgiYKPZL4mUl5YiMKHkx5B6',
  },
  {
    id:         'b7c09462f2575b1c910fe26d1cd578f1',
    nome:       'Teste Browser',
    email:      'teste@browser.com',
    role:       'VENDEDOR',
    ativo:      1,
    senha_hash: '$2b$12$6gDBUyxiR2ILsNnsbum2ZOrIqamaMHWbm/vsY9l61TaR0ydP4LXIi',
  },
  {
    id:         'aa7d16892ce5a009777735071d24928b',
    nome:       'ThaisTeste',
    email:      'admin2@prosperkt.com',
    role:       'VENDEDOR',
    ativo:      1,
    senha_hash: '$2b$12$BHJ7KZZNBCEz9KiMxoRsXeCIoBgdMZmb/Xk4NrMGPbUFGfYkRQnm.',
  },
];

async function run() {
  console.log('\n🚀 Iniciando migração de usuários para o Supabase...\n');

  // Verifica quais já existem por email (case-insensitive via lowercase no JavaScript)
  const { data: existentes, error: errList } = await sb
    .from('usuarios')
    .select('id, email');

  if (errList) {
    console.error('[ERRO] Não foi possível consultar tabela usuarios:', errList.message);
    process.exit(1);
  }

  // Mapeia emails existentes para IDs
  const emailToIdMap = new Map((existentes || []).map(u => [u.email.toLowerCase(), u.id]));
  console.log(`📋 Usuários já no Supabase: ${emailToIdMap.size}`);

  let inseridos = 0;
  let atualizados = 0;

  for (const u of USUARIOS) {
    const emailNorm = u.email.toLowerCase();
    const idExistente = emailToIdMap.get(emailNorm);

    const payload = {
      nome:          u.nome,
      email:         emailNorm,
      role:          u.role,
      ativo:         u.ativo,
      atualizado_em: new Date().toISOString(),
    };

    if (idExistente) {
      // UPDATE — se o usuário já existe por email, atualizamos seus dados
      const updatePayload = { ...payload };
      // Se for o Super Admin, garantimos que o senha_hash seja atualizado para a credencial correta
      if (u.role === 'SUPER_ADMIN') {
        updatePayload.senha_hash = u.senha_hash;
      }

      const { error } = await sb
        .from('usuarios')
        .update(updatePayload)
        .eq('id', idExistente);

      if (error) {
        console.error(`  ❌ Erro ao atualizar ${u.nome} (${idExistente}):`, error.message);
      } else {
        console.log(`  ✏️  Atualizado: ${u.nome} <${u.email}> [${u.role}]`);
        atualizados++;
      }
    } else {
      // INSERT — inclui senha_hash e o ID do script
      const { error } = await sb.from('usuarios').insert({
        id: u.id,
        senha_hash: u.senha_hash,
        ...payload
      });

      if (error) {
        console.error(`  ❌ Erro ao inserir ${u.nome} (${u.id}):`, error.message);
      } else {
        console.log(`  ✅ Inserido:  ${u.nome} <${u.email}> [${u.role}]`);
        inseridos++;
      }
    }
  }

  console.log(`\n📊 Resultado:`);
  console.log(`   Inseridos:  ${inseridos}`);
  console.log(`   Atualizados: ${atualizados}`);
  console.log(`   Total:      ${inseridos + atualizados} de ${USUARIOS.length}\n`);

  // Confirmação final
  const { data: final } = await sb.from('usuarios').select('id, nome, email, role, ativo').order('nome');
  console.log('📋 Usuários no Supabase após migração:');
  (final || []).forEach(u => {
    console.log(`   [${u.ativo ? '✓' : '✗'}] ${u.nome.padEnd(20)} | ${u.email.padEnd(30)} | ${u.role}`);
  });

  console.log('\n✅ Migração concluída!\n');
  process.exit(0);
}

run().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
