#!/usr/bin/env node
/**
 * PROSPEKT CRM — scripts/test-import-planilha.js
 * Teste local de importação de leads via endpoint /api/leads/importar-planilha
 *
 * Uso:
 *   node scripts/test-import-planilha.js
 *
 * Pré-requisitos:
 *   - npm run dev (servidor rodando em :3000)
 *   - Fazer login e pegar JWT, ou usar variável TOKEN=...
 *     TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
 *       -H "Content-Type: application/json" \
 *       -d '{"email":"admin@prosperkt.com","senha":"sua_senha"}' | \
 *       node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).dados?.token)")
 */

const https = require('https');
const http  = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TOKEN    = process.env.TOKEN    || '';

// ── 5 leads de teste ──────────────────────────────────────────────────────────
const LEADS_TESTE = [
  {
    data_entrada:     '2026-05-25 09:00',
    nome:             'Ana Lima',
    telefone:         '11999990001',
    email:            'ana.lima@teste.com',
    empresa:          'Empresa A',
    funil:            'Tráfego Pago',
    produto_interesse:'Brindes personalizados',
    status:           'ABERTO',
  },
  {
    data_entrada:     '2026-05-25 09:15',
    nome:             'Bruno Santos',
    telefone:         '21988880002',
    email:            'bruno.santos@teste.com',
    empresa:          'Empresa B',
    funil:            'Tráfego Pago',
    produto_interesse:'Canecas personalizadas',
    status:           'ABERTO',
  },
  {
    data_entrada:     '2026-05-25 09:30',
    nome:             'Carla Mendes',
    telefone:         '31977770003',
    email:            'carla.mendes@teste.com',
    empresa:          '',
    funil:            '',
    produto_interesse:'Camisetas bordadas',
    status:           'ABERTO',
  },
  {
    data_entrada:     '2026-05-25 09:45',
    nome:             'Diego Costa',
    telefone:         '51966660004',
    email:            'diego.costa@teste.com',
    empresa:          'Empresa D',
    funil:            'outro funil', // deve ser ignorado — sempre vai para Tráfego Pago
    produto_interesse:'',
    status:           'ABERTO',
  },
  {
    data_entrada:     '2026-05-25 10:00',
    nome:             'Eduarda Ferreira',
    telefone:         '85955550005',
    email:            'eduarda@teste.com',
    empresa:          'Empresa E',
    funil:            'Tráfego Pago',
    produto_interesse:'Squeezes personalizados',
    status:           'ABERTO',
  },
  // 6º: duplicata proposital — mesmo telefone de Ana Lima
  {
    data_entrada:     '2026-05-25 10:30',
    nome:             'Ana Lima (duplicado)',
    telefone:         '11999990001', // mesmo telefone — deve ser bloqueado
    email:            'ana.duplicada@teste.com',
    empresa:          'Empresa A',
    funil:            'Tráfego Pago',
    produto_interesse:'Brindes',
    status:           'ABERTO',
  },
];

// ── Helper fetch ──────────────────────────────────────────────────────────────
function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const mod      = parsed.protocol === 'https:' ? https : http;
    const body     = opts.body ? Buffer.from(opts.body, 'utf8') : null;
    const headers  = {
      'Content-Type': 'application/json',
      ...(TOKEN ? { 'Authorization': `Bearer ${TOKEN}` } : {}),
      ...(body ? { 'Content-Length': body.length } : {}),
      ...(opts.headers || {}),
    };
    const req = mod.request({
      hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search, method: opts.method || 'GET', headers,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, body: text }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Login automático ──────────────────────────────────────────────────────────
async function login() {
  if (TOKEN) return TOKEN;
  // Tenta login com credenciais padrão (ajuste conforme necessário)
  const email = process.env.ADMIN_EMAIL || 'admin@prosperkt.com';
  const senha = process.env.ADMIN_SENHA || 'prosperkt123';
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
  });
  return r.body?.dados?.token || r.body?.token || null;
}

// ── Executa teste ─────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  TESTE — Importação via Planilha     ║');
  console.log('╚══════════════════════════════════════╝\n');

  // 1. Login
  const token = TOKEN || await login();
  if (!token) {
    console.error('❌ Não foi possível obter token. Defina TOKEN=... ou ADMIN_EMAIL/ADMIN_SENHA.\n');
    process.exit(1);
  }
  console.log('✅ Token obtido.\n');

  // 2. POST /api/leads/importar-planilha
  console.log(`📤 Enviando ${LEADS_TESTE.length} leads para importação...`);
  const r = await fetch(`${BASE_URL}/api/leads/importar-planilha`, {
    method: 'POST',
    body: JSON.stringify(LEADS_TESTE),
    headers: { Authorization: `Bearer ${token}` },
  });

  if (r.status >= 500) {
    console.error('❌ Erro do servidor:', r.body);
    process.exit(1);
  }

  console.log('\n📊 Resumo:');
  const res = r.body;
  if (res.resumo) {
    console.log(`   Total enviados : ${res.resumo.total}`);
    console.log(`   ✅ Criados      : ${res.resumo.criados}`);
    console.log(`   ⚠️  Duplicados   : ${res.resumo.duplicados}`);
    console.log(`   🚫 Ignorados    : ${res.resumo.ignorados}`);
    console.log(`   ❌ Erros        : ${res.resumo.erros}`);
  }

  console.log('\n📋 Detalhes por linha:');
  (res.resultados || []).forEach((r, i) => {
    const icon = r.status === 'criado' ? '✅' : r.status === 'duplicado' ? '⚠️ ' : r.status === 'ignorado' ? '🚫' : '❌';
    const extra = r.lead_id ? ` → lead_id: ${r.lead_id.slice(0,12)}...` : '';
    const erro  = r.motivo  ? ` [${r.motivo}]` : '';
    console.log(`   ${icon} #${i+1} ${r.nome || '—'} (${r.telefone || '—'}): ${r.status}${extra}${erro}`);
  });

  // 3. Verifica histórico
  console.log('\n🔍 Consultando histórico de importações...');
  const hist = await fetch(`${BASE_URL}/api/leads/importacoes?limite=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`   Registros retornados: ${hist.body?.dados?.length ?? '?'}`);

  // 4. Verificações
  const criados = (res.resumo?.criados || 0);
  const duplicados = (res.resumo?.duplicados || 0);

  console.log('\n✅ Verificações:');
  console.log(`   Leads criados            : ${criados >= 5 ? '✅' : '❌'} (esperado ≥5, obtido ${criados})`);
  console.log(`   Duplicata bloqueada      : ${duplicados >= 1 ? '✅' : '❌'} (esperado ≥1, obtido ${duplicados})`);
  console.log(`   Nenhum erro fatal        : ${r.status < 500 ? '✅' : '❌'}`);

  console.log('\n🏁 Teste concluído.\n');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ Erro fatal:', e.message); process.exit(1); });
