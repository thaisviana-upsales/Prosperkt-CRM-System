#!/usr/bin/env node
/**
 * PROSPEKT CRM — Script de Ativação de Acesso (Senha Temporária)
 * =============================================================
 * Objetivo: Definir senha temporária "Sucesso2026" para todos os
 *           usuários ATIVOS que NÃO sejam SUPER_ADMIN.
 *
 * Regra crítica:
 *   - SUPER_ADMIN NUNCA é alterado.
 *   - Usuários inativos NÃO são alterados.
 *   - Senha salva com bcrypt (hash seguro), nunca em plain text.
 *   - Script IDEMPOTENTE: pode rodar mais de uma vez com segurança.
 *   - NÃO executar no startup do servidor.
 *
 * Como rodar:
 *   node scripts/ativar-acesso-usuarios-ativos.js
 *
 * Pré-requisito: variáveis de ambiente configuradas (.env)
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const fs     = require('fs');
const path   = require('path');

// ── Configurações ─────────────────────────────────────────────────────────────
const SENHA_TEMPORARIA = 'Sucesso2026';
const SALT_ROUNDS      = 12;
const PRIMEIRO_ACESSO_FILE = path.join(__dirname, '..', 'data', 'primeiro_acesso.json');

// ── Helpers ───────────────────────────────────────────────────────────────────
function lerPrimeiroAcesso() {
  try {
    if (fs.existsSync(PRIMEIRO_ACESSO_FILE)) {
      return JSON.parse(fs.readFileSync(PRIMEIRO_ACESSO_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function salvarPrimeiroAcesso(dados) {
  const dir = path.dirname(PRIMEIRO_ACESSO_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PRIMEIRO_ACESSO_FILE, JSON.stringify(dados, null, 2));
}

function emailValido(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  PROSPEKT CRM — Ativação de Acesso (Senha Temporária)');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Data/Hora: ${new Date().toLocaleString('pt-BR')}`);
  console.log('  REGRA: Super Admin NÃO será alterado em hipótese alguma.\n');

  const { getProvider } = require('../src/database/dbProvider');
  const { sb, isSupa, sqlite } = getProvider();

  // ── 1. Buscar usuários ─────────────────────────────────────────────────────
  let usuarios = [];

  if (isSupa) {
    console.log('  Banco: Supabase');
    const { data, error } = await sb
      .from('usuarios')
      .select('id, nome, email, role, ativo')
      .eq('ativo', 1); // apenas ativos

    if (error) {
      console.error('\n[ERRO] Falha ao buscar usuários no Supabase:', error.message);
      process.exit(1);
    }
    usuarios = data || [];
  } else {
    console.log('  Banco: SQLite');
    usuarios = sqlite
      .prepare("SELECT id, nome, email, role, ativo FROM usuarios WHERE ativo = 1")
      .all();
  }

  console.log(`  Total de usuários ativos encontrados: ${usuarios.length}\n`);

  // ── 2. Gerar hash da senha temporária UMA VEZ (performance) ───────────────
  console.log('  Gerando hash da senha temporária...');
  const hashSenhaTemporaria = await bcrypt.hash(SENHA_TEMPORARIA, SALT_ROUNDS);
  console.log('  Hash gerado com sucesso (bcryptjs, 12 rounds).\n');

  // ── 3. Carregar estado atual de primeiro acesso ────────────────────────────
  const primeiroAcesso = lerPrimeiroAcesso();

  // ── 4. Contadores ─────────────────────────────────────────────────────────
  let totalAtualizados   = 0;
  let totalSuperAdmin    = 0;
  let totalEmailInvalido = 0;
  let totalErro          = 0;
  const emailsAtualizados = [];

  // ── 5. Processar cada usuário ─────────────────────────────────────────────
  const agora = new Date().toISOString();

  for (const u of usuarios) {
    // PROTEÇÃO EXPLÍCITA: SUPER_ADMIN NUNCA É ALTERADO
    if ((u.role || '').toUpperCase() === 'SUPER_ADMIN') {
      console.log(`  ⏭  [IGNORADO] Super Admin: ${u.email || u.id} — NÃO ALTERADO.`);
      totalSuperAdmin++;
      continue;
    }

    // Validar e-mail
    if (!emailValido(u.email)) {
      console.log(`  ⚠  [E-MAIL INVÁLIDO] id=${u.id} nome="${u.nome}" — ignorado.`);
      totalEmailInvalido++;
      continue;
    }

    try {
      // Atualiza senha_hash no banco
      if (isSupa) {
        const { error } = await sb
          .from('usuarios')
          .update({ senha_hash: hashSenhaTemporaria, atualizado_em: agora })
          .eq('id', u.id)
          .neq('role', 'SUPER_ADMIN'); // dupla proteção no WHERE

        if (error) throw new Error(error.message);
      } else {
        sqlite
          .prepare(
            "UPDATE usuarios SET senha_hash = ?, atualizado_em = ? WHERE id = ? AND role != 'SUPER_ADMIN'"
          )
          .run(hashSenhaTemporaria, agora, u.id);
      }

      // Marca troca obrigatória no primeiro acesso (arquivo JSON)
      primeiroAcesso[u.id] = {
        deve_trocar: true,
        email:       u.email.toLowerCase().trim(),
        criado_em:   agora,
      };

      emailsAtualizados.push(u.email.toLowerCase().trim());
      totalAtualizados++;
      console.log(`  ✅ [ATUALIZADO] ${u.email.toLowerCase().trim()} (${u.role})`);

    } catch (e) {
      console.error(`  ❌ [ERRO] ${u.email} — ${e.message}`);
      totalErro++;
    }
  }

  // ── 6. Salvar arquivo de primeiro acesso ──────────────────────────────────
  salvarPrimeiroAcesso(primeiroAcesso);
  console.log('\n  Arquivo primeiro_acesso.json atualizado.');

  // ── 7. Relatório final ────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  RELATÓRIO FINAL');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Usuários ativos encontrados:      ${usuarios.length}`);
  console.log(`  ✅ Atualizados com sucesso:       ${totalAtualizados}`);
  console.log(`  ⏭  Ignorados (Super Admin):       ${totalSuperAdmin}`);
  console.log(`  ⚠  Ignorados (e-mail inválido):   ${totalEmailInvalido}`);
  console.log(`  ❌ Erros durante atualização:      ${totalErro}`);
  console.log('');
  console.log('  E-mails com acesso ativado:');
  emailsAtualizados.forEach(e => console.log(`    → ${e}`));
  console.log('');
  console.log('  Senha temporária: [OCULTA POR SEGURANÇA]');
  console.log('  Instrução: Usuários devem trocar a senha no primeiro acesso.');
  console.log('  Bloqueio: Acesso ao CRM bloqueado até troca de senha.');
  console.log('══════════════════════════════════════════════════════════════\n');

  if (totalErro > 0) {
    console.warn(`  ⚠ Atenção: ${totalErro} usuário(s) não foram atualizados por erro. Verifique acima.\n`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('\n[ERRO FATAL]', e.message);
  process.exit(1);
});
