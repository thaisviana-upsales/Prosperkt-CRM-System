/**
 * PROSPEKT CRM — Seed: Usuários Reais + Metas Base
 *
 * O que faz:
 *  1. Desativa usuários de TESTE (preserva Super Admin)
 *  2. Upsert dos 4 vendedores reais com senha temporária prospekt123
 *  3. Cria metas de faturamento para o mês atual (sem duplicar)
 *  4. Marca usuários para trocar senha no arquivo data/primeiro_acesso.json
 *
 * Uso: node scripts/seed-usuarios-reais.js
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const fs = require('fs');
const path = require('path');
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
              || process.env.SUPABASE_ANON_KEY
              || process.env.SUPABASE_KEY;

// Arquivo JSON para controle de primeiro acesso (sem DDL)
const PRIMEIRO_ACESSO_FILE = path.join(__dirname, '..', 'data', 'primeiro_acesso.json');

if (!SUPA_URL || !SUPA_KEY) {
  console.error('❌ SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env');
  process.exit(1);
}

const sb = createClient(SUPA_URL, SUPA_KEY);
const agora = new Date().toISOString();
const mes   = new Date().getMonth() + 1;
const ano   = new Date().getFullYear();

// ─── Usuários reais ──────────────────────────────────────────────────────────
const VENDEDORES_REAIS = [
  { nome: 'Lais Basilio',            email: 'lais@prospektpersonalizados.com.br',   role: 'VENDEDOR', meta_faturamento: 1100000 },
  { nome: 'Marcos Vinicius',         email: 'marcos@prospektpersonalizados.com.br',  role: 'VENDEDOR', meta_faturamento: 350000  },
  { nome: 'Diego Siqueira',          email: 'diego@prospektpersonalizados.com.br',   role: 'VENDEDOR', meta_faturamento: 350000  },
  { nome: 'Erica Fernandes da Silva',email: 'erica@prospektpersonalizados.com.br',   role: 'VENDEDOR', meta_faturamento: 350000  },
];

const SENHA_TEMPORARIA = 'prospekt123';

// Emails que NÃO devem ser desativados (sistema/admin)
const EMAILS_PRESERVAR = [
  'admin@prosperkt.com',
  'admin@prospekt.com',
  'thais@prospekt.com',
  'thais@upsales.com.br',
  ...VENDEDORES_REAIS.map(v => v.email),
];

async function main() {
  console.log('='.repeat(60));
  console.log(' PROSPEKT CRM — Seed Usuários Reais');
  console.log('='.repeat(60));

  // ── Carrega / inicializa arquivo de primeiro acesso ──────────────────────────
  let primeiroAcesso = {};
  try {
    if (fs.existsSync(PRIMEIRO_ACESSO_FILE)) {
      primeiroAcesso = JSON.parse(fs.readFileSync(PRIMEIRO_ACESSO_FILE, 'utf8'));
    }
  } catch(_) {}

  // ── PASSO 1: Desativar usuários de teste ─────────────────────────────────────
  console.log('\n[2/4] Desativando usuários de teste...');
  const { data: todosUsuarios } = await sb.from('usuarios').select('id,nome,email,role,ativo');

  let desativados = 0;
  for (const u of (todosUsuarios || [])) {
    const emailNorm = u.email?.toLowerCase();
    const isSuperAdmin = u.role === 'SUPER_ADMIN';
    const isReal = EMAILS_PRESERVAR.includes(emailNorm);

    if (isSuperAdmin || isReal) {
      console.log(`  ✓ Preservando: ${u.email} (${u.role})`);
      continue;
    }

    if (u.ativo) {
      const { error } = await sb.from('usuarios')
        .update({ ativo: 0, atualizado_em: agora })
        .eq('id', u.id);
      if (error) {
        console.error(`  ❌ Erro ao desativar ${u.email}:`, error.message);
      } else {
        console.log(`  ✗ Desativado: ${u.email} (${u.role})`);
        desativados++;
      }
    } else {
      console.log(`  - Já inativo: ${u.email}`);
    }
  }
  console.log(`  Total desativados: ${desativados}`);

  // ── PASSO 2: Upsert dos vendedores reais ────────────────────────────────────
  console.log('\n[2/4] Cadastrando vendedores reais...');
  const hashSenha = await bcrypt.hash(SENHA_TEMPORARIA, 12);

  for (const v of VENDEDORES_REAIS) {
    const emailNorm = v.email.toLowerCase();

    // Verifica se já existe
    const { data: existente } = await sb.from('usuarios')
      .select('id,nome,email,ativo')
      .eq('email', emailNorm).limit(1);

    let userId;
    if (existente?.[0]) {
      // Atualiza: reativa, atualiza nome, role, senha
      const upd = {
        nome:          v.nome,
        role:          v.role,
        ativo:         1,
        senha_hash:    hashSenha,
        atualizado_em: agora,
      };
      const { error } = await sb.from('usuarios').update(upd).eq('id', existente[0].id);
      if (error) {
        console.error(`  ❌ Erro ao atualizar ${emailNorm}:`, error.message);
      } else {
        console.log(`  ✓ Atualizado: ${v.nome} <${emailNorm}>`);
        userId = existente[0].id;
      }
    } else {
      // Insere novo
      const id = crypto.randomBytes(16).toString('hex');
      const { error } = await sb.from('usuarios').insert({
        id, nome: v.nome, email: emailNorm, senha_hash: hashSenha,
        role: v.role, ativo: 1, criado_em: agora, atualizado_em: agora,
      });
      if (error) {
        console.error(`  ❌ Erro ao inserir ${emailNorm}:`, error.message);
      } else {
        console.log(`  ✓ Criado: ${v.nome} <${emailNorm}>`);
        userId = id;
      }
    }

    // Marca para troca de senha (via arquivo local)
    if (userId) {
      primeiroAcesso[userId] = { deve_trocar: true, email: emailNorm, criado_em: agora };
    }
  }

  // Salva arquivo de primeiro acesso
  try {
    const dir = path.dirname(PRIMEIRO_ACESSO_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PRIMEIRO_ACESSO_FILE, JSON.stringify(primeiroAcesso, null, 2));
    console.log(`  ✓ Arquivo de primeiro acesso salvo: ${PRIMEIRO_ACESSO_FILE}`);
  } catch(e) {
    console.error('  ❌ Erro ao salvar arquivo de primeiro acesso:', e.message);
  }

  // ── PASSO 3: Criar metas de faturamento ──────────────────────────────────────
  console.log(`\n[3/4] Criando metas de faturamento para ${mes}/${ano}...`);

  // Busca IDs atualizados
  const { data: vendedoresAtuais } = await sb.from('usuarios')
    .select('id,nome,email')
    .in('email', VENDEDORES_REAIS.map(v => v.email.toLowerCase()));

  for (const v of VENDEDORES_REAIS) {
    const emailNorm = v.email.toLowerCase();
    const usuario = vendedoresAtuais?.find(u => u.email === emailNorm);
    if (!usuario) {
      console.log(`  ⚠️  Usuário ${emailNorm} não encontrado para criar meta`);
      continue;
    }

    // Verifica se já existe meta para esse vendedor, mês, ano e tipo
    const { data: metaExistente } = await sb.from('metas')
      .select('id,valor_alvo')
      .eq('usuario_id', usuario.id)
      .eq('tipo', 'FATURAMENTO')
      .eq('mes', mes)
      .eq('ano', ano)
      .limit(1);

    if (metaExistente?.[0]) {
      // Atualiza valor
      const { error } = await sb.from('metas')
        .update({ valor_alvo: v.meta_faturamento, atualizado_em: agora })
        .eq('id', metaExistente[0].id);
      if (error) {
        console.error(`  ❌ Erro ao atualizar meta de ${usuario.nome}:`, error.message);
      } else {
        console.log(`  ✓ Meta atualizada: ${usuario.nome} → R$ ${v.meta_faturamento.toLocaleString('pt-BR')}`);
      }
    } else {
      // Cria nova meta
      const metaId = crypto.randomBytes(16).toString('hex');
      const { error } = await sb.from('metas').insert({
        id:           metaId,
        usuario_id:   usuario.id,
        tipo:         'FATURAMENTO',
        valor_alvo:   v.meta_faturamento,
        valor_atual:  0,
        mes,
        ano,
        ativo:        1,
        criado_em:    agora,
        atualizado_em: agora,
      });
      if (error) {
        console.error(`  ❌ Erro ao criar meta de ${usuario.nome}:`, error.message);
      } else {
        console.log(`  ✓ Meta criada: ${usuario.nome} → R$ ${v.meta_faturamento.toLocaleString('pt-BR')}`);
      }
    }
  }

  // ── Resumo final ─────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log(' RESUMO FINAL');
  console.log('='.repeat(60));
  const { data: resultado } = await sb.from('usuarios')
    .select('nome,email,role,ativo')
    .order('role').order('nome');
  (resultado || []).forEach(u => {
    const icon = u.ativo ? '✓' : '✗';
    console.log(` ${icon} [${u.role.padEnd(11)}] ${u.nome} <${u.email}>`);
  });
  console.log('\n✅ Seed concluído.');
  console.log(`\n⚠️  AÇÃO MANUAL NECESSÁRIA:`);
  console.log(`   Execute no Supabase SQL Editor a migration:`);
  console.log(`   → scripts/migration-force-password-change.sql`);
}

main().catch(e => {
  console.error('\n❌ FATAL:', e.message);
  process.exit(1);
});
