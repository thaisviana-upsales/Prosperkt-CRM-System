/**
 * PROSPEKT — Sincroniza mensagens_padrao do SQLite → Supabase
 * Modo ADITIVO: nunca apaga registros existentes no Supabase.
 * Apenas insere mensagens que ainda não existem (baseado no par categoria+titulo+texto).
 * Executa: node scripts/sync-msgs-sqlite-para-supabase.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
  // ── Lê dados do SQLite ────────────────────────────────────────────────────
  const { getDb } = require('../src/database/db');
  const db = getDb();
  const locais = db.prepare(
    'SELECT * FROM mensagens_padrao ORDER BY categoria, titulo'
  ).all();
  console.log(`\n📦 SQLite: ${locais.length} mensagens encontradas`);
  const cats = {};
  locais.forEach(m => { cats[m.categoria] = (cats[m.categoria] || 0) + 1; });
  Object.entries(cats).forEach(([c, n]) => console.log(`   ${n}x  ${c}`));

  // ── Conecta Supabase ──────────────────────────────────────────────────────
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  console.log('\n🔵 Supabase:', process.env.SUPABASE_URL);

  // ── Lê o que já existe no Supabase ───────────────────────────────────────
  const { data: existentes, error: errE } = await sb
    .from('mensagens_padrao')
    .select('id, categoria, titulo, texto');
  if (errE) { console.error('❌ Erro ao ler Supabase:', errE.message); process.exit(1); }
  console.log(`\n☁️  Supabase: ${existentes.length} mensagens já existentes`);

  // ── Constrói set de chaves existentes (categoria|titulo) ──────────────────
  const chaves = new Set(existentes.map(m => `${m.categoria}|||${m.titulo}`));

  // ── Filtra apenas as que NÃO estão no Supabase ────────────────────────────
  const paraInserir = locais.filter(m => !chaves.has(`${m.categoria}|||${m.titulo}`));
  console.log(`\n➕ Mensagens a inserir: ${paraInserir.length}`);

  if (paraInserir.length === 0) {
    console.log('✅ Tudo já sincronizado. Nenhuma alteração necessária.');
    return;
  }

  // ── Insere em lotes de 20 ─────────────────────────────────────────────────
  const agora = new Date().toISOString();
  const LOTE = 20;
  let inseridas = 0;
  let erros = 0;

  for (let i = 0; i < paraInserir.length; i += LOTE) {
    const lote = paraInserir.slice(i, i + LOTE).map(m => ({
      id:            m.id,
      titulo:        m.titulo,
      categoria:     m.categoria,
      texto:         m.texto,
      funil_id:      m.funil_id  || null,
      etapa_id:      m.etapa_id  || null,
      ativo:         m.ativo ?? 1,
      criado_por:    m.criado_por || null,
      criado_em:     m.criado_em  || agora,
      atualizado_em: m.atualizado_em || agora,
    }));

    const { error } = await sb.from('mensagens_padrao').insert(lote);
    if (error) {
      // Se conflito de ID, tenta com novo ID
      if (error.code === '23505') {
        const crypto = require('crypto');
        const loteNovo = lote.map(m => ({ ...m, id: crypto.randomBytes(16).toString('hex') }));
        const { error: err2 } = await sb.from('mensagens_padrao').insert(loteNovo);
        if (err2) { console.error(`❌ Lote ${i}-${i+LOTE}:`, err2.message); erros += lote.length; }
        else { inseridas += loteNovo.length; }
      } else {
        console.error(`❌ Lote ${i}-${i+LOTE}:`, error.message);
        erros += lote.length;
      }
    } else {
      inseridas += lote.length;
      process.stdout.write('.');
    }
  }

  console.log(`\n\n✅ Inseridas: ${inseridas} | Erros: ${erros}`);

  // ── Resumo final ──────────────────────────────────────────────────────────
  const { data: final } = await sb.from('mensagens_padrao').select('categoria').order('categoria');
  const catsFinal = {};
  (final || []).forEach(m => { catsFinal[m.categoria] = (catsFinal[m.categoria] || 0) + 1; });
  console.log(`\n📊 Estado final do Supabase (${final?.length} mensagens):`);
  Object.entries(catsFinal).forEach(([c, n]) => console.log(`   ✓ ${n}x  ${c}`));
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
