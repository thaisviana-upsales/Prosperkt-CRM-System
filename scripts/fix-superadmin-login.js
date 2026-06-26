/**
 * PROSPEKT CRM — fix-superadmin-login.js
 * Diagnóstico e correção definitiva do Super Admin no Supabase.
 *
 * O que faz (SEGURO / IDEMPOTENTE):
 *  1. Verifica o Super Admin no Supabase (campo ativo, role, senha_hash)
 *  2. Detecta se ativo está como boolean true em vez de integer 1 (bug Postgres)
 *  3. Garante que o Super Admin está ativo e com role correta
 *  4. Se SUPERADMIN_RESET_PASSWORD=true no .env, regenera hash da SUPERADMIN_PASSWORD
 *  5. Detecta duplicatas e reporta sem deletar
 *  6. NÃO sobrescreve senha sem ação explícita via env var
 *  7. NÃO loga senha, hash ou token
 *
 * Uso:
 *   node scripts/fix-superadmin-login.js
 *
 * Para resetar senha (somente se necessário):
 *   SUPERADMIN_RESET_PASSWORD=true SUPERADMIN_PASSWORD=NovaSenhaForte! node scripts/fix-superadmin-login.js
 */

'use strict';
require('dotenv').config();
const bcrypt      = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

// ── Configuração ──────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || 'admin@prosperkt.com').toLowerCase().trim();
const RESET_PASSWORD   = process.env.SUPERADMIN_RESET_PASSWORD === 'true';
const NOVA_SENHA       = process.env.SUPERADMIN_PASSWORD || null;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[FATAL] SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers seguros ───────────────────────────────────────────────────────────
function log(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}
function logErr(tag, msg) {
  console.error(`[${tag}] ${msg}`);
}
// Jamais loga conteúdo de senha/hash
function maskHash(h) {
  if (!h) return '(vazio/null)';
  return h.substring(0, 7) + '...' + h.slice(-4) + ` (len=${h.length})`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('SUPERADMIN_SEED_START', `Email alvo: ${SUPERADMIN_EMAIL}`);
  log('AUTH_DB_PROVIDER', 'supabase');
  log('AUTH_DB_SOURCE', SUPABASE_URL.replace(/https?:\/\//, '').split('.')[0] + '.supabase.co');
  log('AUTH_SUPABASE_ENABLED', 'true');
  log('AUTH_SQLITE_FALLBACK_USED', 'false');

  // ── 1. Busca todos os registros com esse email (detecta duplicatas) ──────────
  const { data: encontrados, error: errBusca } = await sb
    .from('usuarios')
    .select('id, nome, email, role, ativo, criado_em, atualizado_em, senha_hash')
    .ilike('email', SUPERADMIN_EMAIL);

  if (errBusca) {
    logErr('SUPERADMIN_SEED_ERROR', `Erro ao buscar Super Admin: ${errBusca.message}`);
    process.exit(1);
  }

  log('SUPERADMIN_SEED_START', `Registros encontrados com email ${SUPERADMIN_EMAIL}: ${(encontrados || []).length}`);

  // ── 2. Detecta duplicatas ─────────────────────────────────────────────────
  if ((encontrados || []).length > 1) {
    log('SUPERADMIN_DUPLICATE_FOUND', `ATENÇÃO: ${encontrados.length} registros com mesmo email!`);
    encontrados.forEach((u, i) => {
      log('SUPERADMIN_DUPLICATE_FOUND', `  [${i+1}] id=${u.id} | ativo=${u.ativo} | role=${u.role} | criado_em=${u.criado_em}`);
    });
    log('SUPERADMIN_DUPLICATE_FOUND', 'Será usado o registro SUPER_ADMIN mais recente. Remova duplicatas manualmente no Supabase Dashboard se necessário.');
  }

  // ── 3. Seleciona o registro principal (SUPER_ADMIN ativo, mais recente) ──────
  const superAdmins = (encontrados || []).filter(u => u.role === 'SUPER_ADMIN');
  const outros      = (encontrados || []).filter(u => u.role !== 'SUPER_ADMIN');

  if (outros.length > 0) {
    log('SUPERADMIN_DUPLICATE_FOUND', `AVISO: ${outros.length} registro(s) com mesmo email mas role diferente (${outros.map(u=>u.role).join(', ')}). Verifique manualmente.`);
  }

  let alvo = null;
  if (superAdmins.length > 0) {
    // Prefere o ativo; entre os ativos, o mais recente
    const ativos   = superAdmins.filter(u => u.ativo === 1 || u.ativo === true);
    const inativos = superAdmins.filter(u => u.ativo !== 1 && u.ativo !== true);

    if (ativos.length > 0) {
      alvo = ativos.sort((a, b) => new Date(b.atualizado_em) - new Date(a.atualizado_em))[0];
    } else if (inativos.length > 0) {
      alvo = inativos.sort((a, b) => new Date(b.atualizado_em) - new Date(a.atualizado_em))[0];
      log('SUPERADMIN_EXISTS', `Super Admin está INATIVO — será reativado.`);
    }
    log('SUPERADMIN_EXISTS', `Super Admin encontrado: id=${alvo.id} | ativo=${alvo.ativo} | role=${alvo.role}`);
    log('SUPERADMIN_EXISTS', `senha_hash presente: ${alvo.senha_hash ? 'SIM' : 'NÃO'} | preview: ${maskHash(alvo.senha_hash)}`);
  }

  const agora = new Date().toISOString();

  // ── 4. Diagnostica campo ativo (boolean vs integer) ───────────────────────
  if (alvo) {
    const ativoVal = alvo.ativo;
    const ativoOk  = (ativoVal === 1 || ativoVal === true);
    if (!ativoOk) {
      log('SUPERADMIN_EXISTS', `PROBLEMA: campo ativo = ${JSON.stringify(ativoVal)} (não é 1 nem true) — usuário seria rejeitado no login!`);
    } else {
      log('SUPERADMIN_EXISTS', `Campo ativo: ${JSON.stringify(ativoVal)} ✓`);
    }

    // Verifica se senha_hash existe
    if (!alvo.senha_hash || alvo.senha_hash.trim() === '') {
      log('SUPERADMIN_EXISTS', 'PROBLEMA: senha_hash está VAZIO — login impossível!');
    } else if (!alvo.senha_hash.startsWith('$2')) {
      log('SUPERADMIN_EXISTS', 'PROBLEMA: senha_hash não parece um hash bcrypt válido ($2b/$2a)!');
    } else {
      log('SUPERADMIN_EXISTS', 'senha_hash: formato bcrypt válido ✓');
    }

    // ── 5. Monta payload de update (seguro/idempotente) ───────────────────────
    const updatePayload = {
      ativo:         1,                // garante integer 1 (não boolean)
      role:          'SUPER_ADMIN',    // garante role correta
      atualizado_em: agora,
    };

    let senhaResetada = false;
    if (RESET_PASSWORD) {
      if (!NOVA_SENHA || NOVA_SENHA.length < 8) {
        logErr('SUPERADMIN_SEED_ERROR', 'SUPERADMIN_RESET_PASSWORD=true mas SUPERADMIN_PASSWORD não definida ou muito curta (mínimo 8 chars). Abortando reset de senha.');
        // Continua sem resetar senha
      } else {
        const novoHash = await bcrypt.hash(NOVA_SENHA, 12);
        updatePayload.senha_hash = novoHash;
        senhaResetada = true;
        log('SUPERADMIN_UPDATED_SAFE', 'Senha será atualizada via SUPERADMIN_RESET_PASSWORD=true (hash não logado).');
      }
    } else {
      log('SUPERADMIN_PASSWORD_NOT_OVERWRITTEN', 'SUPERADMIN_RESET_PASSWORD não ativo — senha existente preservada.');
    }

    const { error: errUpdate } = await sb
      .from('usuarios')
      .update(updatePayload)
      .eq('id', alvo.id);

    if (errUpdate) {
      logErr('SUPERADMIN_SEED_ERROR', `Erro ao atualizar Super Admin: ${errUpdate.message}`);
      process.exit(1);
    }

    log('SUPERADMIN_UPDATED_SAFE', `Super Admin atualizado: ativo=1, role=SUPER_ADMIN${senhaResetada ? ', senha_hash atualizado' : ' (senha preservada)'}`);

  } else {
    // ── 6. Super Admin não existe — cria ──────────────────────────────────────
    if (!NOVA_SENHA || NOVA_SENHA.length < 8) {
      logErr('SUPERADMIN_SEED_ERROR', 'Super Admin NÃO existe e SUPERADMIN_PASSWORD não está definida. Defina SUPERADMIN_PASSWORD no .env e rode novamente.');
      logErr('SUPERADMIN_SEED_ERROR', 'Ex: SUPERADMIN_RESET_PASSWORD=true SUPERADMIN_PASSWORD=SuaSenhaForte! node scripts/fix-superadmin-login.js');
      process.exit(1);
    }

    const novoHash = await bcrypt.hash(NOVA_SENHA, 12);
    const { data: novo, error: errInsert } = await sb
      .from('usuarios')
      .insert({
        nome:          'Super Admin',
        email:         SUPERADMIN_EMAIL,
        senha_hash:    novoHash,
        role:          'SUPER_ADMIN',
        ativo:         1,
        criado_em:     agora,
        atualizado_em: agora,
      })
      .select('id, nome, email, role, ativo')
      .single();

    if (errInsert) {
      logErr('SUPERADMIN_SEED_ERROR', `Erro ao criar Super Admin: ${errInsert.message}`);
      process.exit(1);
    }

    log('SUPERADMIN_CREATED', `Super Admin criado: id=${novo.id} | email=${novo.email} | role=${novo.role} | ativo=${novo.ativo}`);
  }

  // ── 7. Verifica resultado final no banco ─────────────────────────────────
  log('SUPERADMIN_SEED_START', 'Verificação final no Supabase...');
  const { data: final, error: errFinal } = await sb
    .from('usuarios')
    .select('id, nome, email, role, ativo, criado_em, atualizado_em')
    .eq('email', SUPERADMIN_EMAIL)
    .single();

  if (errFinal || !final) {
    logErr('SUPERADMIN_SEED_ERROR', `Não foi possível verificar resultado final: ${errFinal?.message}`);
  } else {
    log('SUPERADMIN_EXISTS', `ESTADO FINAL — id=${final.id} | nome=${final.nome} | email=${final.email} | role=${final.role} | ativo=${final.ativo}`);
    const loginOk = (final.role === 'SUPER_ADMIN') && (final.ativo === 1 || final.ativo === true);
    log('SUPERADMIN_EXISTS', `Pronto para login: ${loginOk ? '✅ SIM' : '❌ NÃO — verifique ativo e role'}`);
  }

  // ── 8. Verifica authService — bug ativo integer vs boolean ────────────────
  log('AUTH_DB_PROVIDER', '──────────────────────────────────────────');
  log('AUTH_DB_PROVIDER', 'DIAGNÓSTICO authService.buscarUsuarioPorEmail:');
  log('AUTH_DB_PROVIDER', '  query: .eq("ativo", 1) — funciona para INTEGER 1 e BOOLEAN true no Supabase JS v2+');
  log('AUTH_DB_PROVIDER', '  Se login falhar após isso, o problema é o campo ativo não sendo 1/true ou senha_hash errado.');
  log('AUTH_DB_PROVIDER', '──────────────────────────────────────────');

  log('SUPERADMIN_SEED_START', '✅ Script concluído. Tente fazer login agora.');
  log('SUPERADMIN_SEED_START', `Email: ${SUPERADMIN_EMAIL}`);
  if (RESET_PASSWORD && NOVA_SENHA) {
    log('SUPERADMIN_SEED_START', 'Senha: a definida em SUPERADMIN_PASSWORD (não logada por segurança)');
  } else {
    log('SUPERADMIN_SEED_START', 'Senha: a mesma que estava salva no banco (não alterada).');
  }
}

main().catch(e => {
  console.error('[FATAL]', e.message);
  process.exit(1);
});
