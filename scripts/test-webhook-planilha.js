#!/usr/bin/env node
/**
 * PROSPEKT CRM — scripts/test-webhook-planilha.js
 * Teste do endpoint POST /api/leads/webhook-planilha
 *
 * Uso:
 *   node scripts/test-webhook-planilha.js
 *
 * Variáveis de ambiente opcionais:
 *   BASE_URL=http://localhost:3000
 *   WEBHOOK_PLANILHA_TOKEN=seu_token  (se configurado no .env)
 *
 * O script executa 4 verificações:
 *   1. Lead novo válido         → deve retornar status: criado (201)
 *   2. Mesmo lead novamente     → deve retornar status: duplicado (200)
 *   3. Lead sem telefone/email  → deve retornar 400
 *   4. Token inválido           → deve retornar 401 (só se token configurado)
 */

const http  = require('http');
const https = require('https');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TOKEN    = process.env.WEBHOOK_PLANILHA_TOKEN || '';

// ── Payload de teste ──────────────────────────────────────────────────────────
// Telefone dinâmico para evitar duplicata entre execuções distintas do script
const TEL_TESTE = '119' + String(Date.now()).slice(-8); // ex: 11920463012345

const LEAD_TESTE = {
  data_entrada:     new Date().toISOString(),
  nome:             'Webhook Teste ' + Date.now(),
  telefone:         TEL_TESTE,
  email:            `webhook.${Date.now()}@planilha.com`,
  empresa:          'Empresa Webhook',
  funil:            'Tráfego Pago',    // ignorado — sempre forçado pelo serviço
  produto_interesse:'Canecas personalizadas',
  status:           'ABERTO',
  fonte:            'google_sheets',
};

// ── Helper: fetch simples ─────────────────────────────────────────────────────
function post(path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url    = new URL(BASE_URL + path);
    const mod    = url.protocol === 'https:' ? https : http;
    const data   = JSON.stringify(body);
    const headers = {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(data),
      ...(TOKEN ? { 'x-webhook-token': TOKEN } : {}),
      ...extraHeaders,
    };
    const req = mod.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ code: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { resolve({ code: res.statusCode, body: Buffer.concat(chunks).toString() }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Helpers de output ─────────────────────────────────────────────────────────
let erros = 0;
function ok(msg) { console.log(`   ✅ ${msg}`); }
function fail(msg) { console.log(`   ❌ ${msg}`); erros++; }
function check(cond, msg) { cond ? ok(msg) : fail(msg); }

// ── Execução dos testes ───────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  TESTE — Webhook Planilha de Leads          ║');
  console.log('╚══════════════════════════════════════════════╝\n');
  console.log(`  Alvo  : ${BASE_URL}/api/leads/webhook-planilha`);
  console.log(`  Token : ${TOKEN ? '***configurado***' : '(não configurado — modo dev)'}\n`);

  // ── Teste 1: Lead novo válido ─────────────────────────────────────────────
  console.log('📤 Teste 1 — Enviar lead novo válido...');
  const r1 = await post('/api/leads/webhook-planilha', LEAD_TESTE);
  console.log(`   HTTP ${r1.code} | status: ${r1.body?.status}`);
  check(r1.code === 201,              `HTTP 201 (obtido: ${r1.code})`);
  check(r1.body?.status === 'criado', `status === "criado" (obtido: "${r1.body?.status}")`);
  check(!!r1.body?.lead_id,           `lead_id retornado: ${r1.body?.lead_id?.slice(0,12) || 'N/A'}...`);
  check(r1.body?.mensagem?.includes('Tráfego Pago'), `Mensagem menciona "Tráfego Pago"`);
  const leadId = r1.body?.lead_id;

  // ── Teste 2: Mesmo lead — deve detectar duplicata ─────────────────────────
  console.log('\n🔁 Teste 2 — Reenviar o mesmo lead (duplicata)...');
  const r2 = await post('/api/leads/webhook-planilha', LEAD_TESTE);
  console.log(`   HTTP ${r2.code} | status: ${r2.body?.status}`);
  const isDupOrIgn = r2.body?.status === 'duplicado' || r2.body?.status === 'ignorado';
  check(r2.code === 200,   `HTTP 200 (obtido: ${r2.code})`);
  check(isDupOrIgn,        `status === "duplicado" ou "ignorado" (obtido: "${r2.body?.status}") — ambos bloqueiam duplicata ✓`);
  check(r2.body?.sucesso === true, `sucesso === true (não retorna 4xx/5xx)`);

  // ── Teste 3: Payload inválido — sem contato ───────────────────────────────
  console.log('\n🚫 Teste 3 — Lead sem telefone, email e nome...');
  const r3 = await post('/api/leads/webhook-planilha', { produto_interesse: 'Teste' });
  console.log(`   HTTP ${r3.code}`);
  check(r3.code === 400, `HTTP 400 (obtido: ${r3.code})`);
  check(!!r3.body?.erro, `Mensagem de erro presente`);

  // ── Teste 4: Token inválido (só se token configurado) ─────────────────────
  if (TOKEN) {
    console.log('\n🔐 Teste 4 — Token inválido...');
    const r4 = await post('/api/leads/webhook-planilha', LEAD_TESTE, { 'x-webhook-token': 'token-errado' });
    console.log(`   HTTP ${r4.code}`);
    check(r4.code === 401, `HTTP 401 (obtido: ${r4.code})`);
    check(r4.body?.erro?.toLowerCase().includes('inv'), `Mensagem menciona token inválido`);
  } else {
    console.log('\n⏭️  Teste 4 — pulado (WEBHOOK_PLANILHA_TOKEN não configurado)');
  }

  // ── Resultado final ───────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────');
  if (erros === 0) {
    console.log('🏆 Todos os testes passaram!');
    if (leadId) {
      console.log(`\n📋 Lead criado: ${leadId}`);
      console.log(`   Verifique em: ${BASE_URL}/pipeline.html`);
      console.log('   Deve aparecer no funil Tráfego Pago — etapa Lead Recebido.\n');
    }
  } else {
    console.log(`⚠️  ${erros} teste(s) falhou/falharam.`);
    console.log('   Verifique se npm run dev está rodando e o funil "Tráfego Pago" existe.\n');
  }

  process.exit(erros > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\n❌ Erro fatal:', e.message);
  console.error('   Verifique se o servidor está rodando em', BASE_URL);
  process.exit(1);
});
