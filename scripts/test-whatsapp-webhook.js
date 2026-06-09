#!/usr/bin/env node
/**
 * PROSPEKT CRM — scripts/test-whatsapp-webhook.js
 * Testa o endpoint POST /api/whatsapp/webhook (recebimento de mensagens WA Light)
 *
 * Uso:
 *   node scripts/test-whatsapp-webhook.js
 *
 * Variáveis:
 *   BASE_URL=http://localhost:3000
 *   WHATSAPP_WEBHOOK_SECRET=seu_secret  (opcional)
 */

const http  = require('http');
const https = require('https');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SECRET   = process.env.WHATSAPP_WEBHOOK_SECRET || '';

// Telefone único por execução
const TEL_TESTE = '55119' + String(Date.now()).slice(-7);
const MSG_ID_1  = `wa-msg-${Date.now()}-1`;
const MSG_ID_2  = `wa-msg-${Date.now()}-2`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function request(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url  = new URL(BASE_URL + path);
    const mod  = url.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const req  = mod.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(SECRET ? { 'x-webhook-secret': SECRET } : {}),
        ...extraHeaders,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ code: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { resolve({ code: res.statusCode, body: Buffer.concat(chunks).toString() }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let erros = 0;
function ok(msg)   { console.log(`   ✅ ${msg}`); }
function fail(msg) { console.log(`   ❌ ${msg}`); erros++; }
function check(cond, msg) { cond ? ok(msg) : fail(msg); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  TESTE — WhatsApp Webhook (Recebimento)         ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`  Alvo    : ${BASE_URL}/api/whatsapp/webhook`);
  console.log(`  Telefone: ${TEL_TESTE}`);
  console.log(`  Secret  : ${SECRET ? '***configurado***' : '(não configurado)'}\n`);

  const payload1 = {
    phone:     TEL_TESTE,
    pushName:  'Lead WhatsApp Teste',
    message:   'Olá, quero saber mais sobre brindes personalizados',
    messageId: MSG_ID_1,
  };

  // ── Teste 1: Mensagem nova ─────────────────────────────────────────────────
  console.log('📨 Teste 1 — Mensagem nova (lead inexistente)...');
  const r1 = await request('POST', '/api/whatsapp/webhook', payload1);
  console.log(`   HTTP ${r1.code} | sucesso: ${r1.body?.sucesso}`);

  // Detecta tabela whatsapp_mensagens ausente
  const tabelaAusente = r1.body?.erro?.includes('whatsapp_mensagens') ||
                        r1.body?.aviso?.includes('whatsapp_mensagens');
  if (tabelaAusente) {
    console.log('\n   ⚠️  ATENÇÃO: tabela whatsapp_mensagens não existe no Supabase.');
    console.log('   ➜  Execute supabase_patch_v7_whatsapp_conversas.sql no SQL Editor.');
    console.log('   ➜  Após executar, rode este script novamente.\n');
    check(r1.code === 200, `Graceful degradation — HTTP ${r1.code} (não quebra o CRM)`);
    check(!!r1.body?.aviso, 'Retorna aviso descritivo');
    console.log('\n⏭️  Testes 2–5 pulados (dependem de whatsapp_mensagens).');
  } else {
    console.log(`   lead_id: ${r1.body?.lead_id?.slice(0,12) || 'N/A'}... | mensagem_id: ${r1.body?.mensagem_id?.slice(0,12) || 'N/A'}...`);
    check(r1.code === 201,           `HTTP 201 (obtido: ${r1.code})`);
    check(!!r1.body?.lead_id,        `lead_id retornado`);
    check(!!r1.body?.mensagem_id,    `mensagem_id retornado`);
    check(r1.body?.sucesso === true, `sucesso === true`);

    const leadIdCriado = r1.body?.lead_id || null;

    // ── Teste 2: Idempotência ─────────────────────────────────────────────
    console.log('\n🔁 Teste 2 — Reenviar mesma mensagem (idempotência)...');
    const r2 = await request('POST', '/api/whatsapp/webhook', payload1);
    console.log(`   HTTP ${r2.code} | ignorado: ${r2.body?.ignorado} | motivo: ${r2.body?.motivo}`);
    check(r2.code === 200,              `HTTP 200 (obtido: ${r2.code})`);
    check(r2.body?.ignorado === true,   `ignorado === true`);
    check(r2.body?.motivo === 'mensagem_ja_salva', `motivo === "mensagem_ja_salva"`);

    // ── Teste 3: Nova mensagem, mesmo lead ────────────────────────────────
    console.log('\n💬 Teste 3 — Nova mensagem, mesmo telefone (messageId diferente)...');
    const payload3 = { ...payload1, message: 'Qual o prazo de entrega?', messageId: MSG_ID_2 };
    const r3 = await request('POST', '/api/whatsapp/webhook', payload3);
    console.log(`   HTTP ${r3.code} | lead_id: ${r3.body?.lead_id?.slice(0,12) || 'N/A'}...`);
    check(r3.code === 201,                    `HTTP 201 (obtido: ${r3.code})`);
    check(r3.body?.lead_id === leadIdCriado,  `lead_id igual ao Teste 1 (não cria novo lead)`);
    check(!!r3.body?.mensagem_id,             `nova mensagem_id retornado`);

    // ── Teste 5: GET conversas ─────────────────────────────────────────────
    if (leadIdCriado) {
      console.log(`\n🔍 Teste 5 — Consultar conversas (GET /api/leads/${leadIdCriado.slice(0,12)}...)...`);
      const r5 = await request('GET', `/api/leads/${leadIdCriado}/conversas`, null);
      console.log(`   HTTP ${r5.code} | mensagens: ${r5.body?.dados?.length ?? '?'}`);
      check(r5.code === 401 || r5.code === 200, `Endpoint /leads/:id/conversas responde (${r5.code})`);
      if (r5.code === 200) {
        check(Array.isArray(r5.body?.dados), `dados é array`);
        check((r5.body?.dados?.length || 0) >= 2, `≥2 mensagens (obtido: ${r5.body?.dados?.length})`);
      }
    }

    // ── Resultado OK ──────────────────────────────────────────────────────
    console.log('\n🚫 Teste 4 — Payload sem telefone...');
    const r4 = await request('POST', '/api/whatsapp/webhook', { message: 'sem telefone' });
    console.log(`   HTTP ${r4.code}`);
    check(r4.code === 400, `HTTP 400 (obtido: ${r4.code})`);
    check(!!r4.body?.erro, `Mensagem de erro presente`);

    console.log('\n─────────────────────────────────────────────────────');
    if (erros === 0) {
      console.log('🏆 Todos os testes passaram!\n');
      console.log(`📋 Lead criado: ${leadIdCriado}`);
      console.log(`   Pipeline: http://localhost:3000/pipeline.html`);
      console.log('   ➜ Funil Tráfego Pago — etapa Lead Recebido\n');
      console.log(`📱 2 mensagens salvas em whatsapp_mensagens`);
      console.log(`   ➜ GET /api/leads/${leadIdCriado}/conversas (com JWT)\n`);
    } else {
      console.log(`⚠️  ${erros} teste(s) falhou/falharam.\n`);
    }
    process.exit(erros > 0 ? 1 : 0);
    return;
  }

  // ── Teste 4 (fora do bloco else — sempre executa) ────────────────────────
  console.log('\n🚫 Teste 4 — Payload sem telefone...');
  const r4 = await request('POST', '/api/whatsapp/webhook', { message: 'sem telefone' });
  console.log(`   HTTP ${r4.code}`);
  check(r4.code === 400, `HTTP 400 (obtido: ${r4.code})`);
  check(!!r4.body?.erro, `Mensagem de erro presente`);

  console.log('\n─────────────────────────────────────────────────────');
  console.log(`⚠️  ${erros} teste(s) com atenção.\n`);
  process.exit(erros > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\n❌ Erro fatal:', e.message);
  console.error('   Verifique se o servidor está rodando em', BASE_URL);
  process.exit(1);
});
