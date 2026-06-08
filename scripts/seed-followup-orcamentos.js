/**
 * PROSPERKT CRM — Seed: Follow Up Orçamentos Sem Resposta (v2)
 * Usa dbProvider.js do projeto (já inicializado corretamente com .env)
 * Executa: node scripts/seed-followup-orcamentos.js
 */
const crypto = require('crypto');

const CATEGORIA = '💰 Lead Novo|Follow Up - Orçamento sem Resposta';


const SCRIPTS = [
  { titulo: 'Sem Resposta +2 Horas',  texto: `Oi, [Nome]! 😊\nSó passando pra confirmar se recebeu o orçamento certinho por aí 👋\nQualquer dúvida me chama que te explico tudo.` },
  { titulo: 'Sem Resposta +8 Horas',  texto: `Oi, [Nome]! 👋\nQueria entender se ficou alguma dúvida sobre o orçamento ou proposta enviada 😊\nSe precisar ajustar algo ou pensar em outra alternativa, podemos conversar.` },
  { titulo: 'Sem Resposta +24 Horas', texto: `Oi, [Nome]! ✨\nPassei aqui porque queria entender se esse projeto continua acontecendo ou se ficou para outro momento.\nAssim consigo te apoiar melhor 🚀` },
  { titulo: 'Sem Resposta +48 Horas', texto: `Oi, [Nome]! 👋\nSei que às vezes aprovação interna demora ou prioridades mudam 😊\nQueria entender só em qual cenário esse projeto está hoje:\n1️⃣ Seguindo\n2️⃣ Pausado\n3️⃣ Outro momento` },
  { titulo: 'Sem Resposta +3 Dias',   texto: `Oi, [Nome]! 🚀\nPassando pela última vez sobre esse projeto para não ficar insistindo sem necessidade 😊\nMas deixo registrado: quando fizer sentido retomar, vou adorar apoiar vocês.` },
  { titulo: 'Sem Resposta +7 Dias',   texto: `Oi, [Nome]! 👋\nLembrei do projeto que conversamos anteriormente e resolvi passar aqui 😊\nAinda existe demanda para isso por aí?` },
];


async function seed() {
  const { getProvider } = require('../src/database/dbProvider');
  const { sb, isSupa } = getProvider();
  const agora = new Date().toISOString();

  if (isSupa) {
    console.log('🔵 Usando Supabase (modo ADITIVO)...');

    // MODO ADITIVO — verifica títulos já existentes, nunca apaga
    const { data: existentes } = await sb.from('mensagens_padrao')
      .select('titulo').eq('categoria', CATEGORIA);
    const jaExistem = new Set((existentes || []).map(m => m.titulo));
    const novos = SCRIPTS.filter(s => !jaExistem.has(s.titulo));

    if (novos.length === 0) {
      console.log(`✅ Todos os ${SCRIPTS.length} scripts já existem. Nada alterado.`);
      return;
    }

    const rows = novos.map(s => ({
      id:            crypto.randomBytes(16).toString('hex'),
      titulo:        s.titulo,
      categoria:     CATEGORIA,
      texto:         s.texto,
      funil_id:      null,
      etapa_id:      null,
      ativo:         1,
      criado_por:    null,
      criado_em:     agora,
      atualizado_em: agora,
    }));

    const { error } = await sb.from('mensagens_padrao').insert(rows);
    if (error) { console.error('❌ Erro Supabase:', error.message); process.exit(1); }

    console.log(`✅ ${rows.length} mensagens inseridas no Supabase!`);
    rows.forEach(r => console.log(`   • ${r.titulo}`));
    if (jaExistem.size > 0) console.log(`ℹ️  ${jaExistem.size} já existiam e foram preservadas.`);

  } else {
    console.log('🟡 Usando SQLite...');
    const { getDb } = require('../src/database/db');
    const db = getDb();

    const existentes = db.prepare('SELECT COUNT(*) as n FROM mensagens_padrao WHERE categoria = ?').get(CATEGORIA);
    if (existentes.n > 0) {
      db.prepare('DELETE FROM mensagens_padrao WHERE categoria = ?').run(CATEGORIA);
      console.log(`🗑️  ${existentes.n} mensagem(ns) anterior(es) removida(s).`);
    }

    const stmt = db.prepare(`
      INSERT INTO mensagens_padrao (id, titulo, categoria, texto, funil_id, etapa_id, ativo, criado_por, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, NULL, NULL, 1, NULL, ?, ?)
    `);

    db.transaction(() => {
      SCRIPTS.forEach(s => {
        stmt.run(crypto.randomBytes(16).toString('hex'), s.titulo, CATEGORIA, s.texto, agora, agora);
        console.log(`   • ${s.titulo}`);
      });
    })();

    console.log(`✅ ${SCRIPTS.length} mensagens inseridas no SQLite!`);
  }
}

seed().catch(e => { console.error('❌', e.message); process.exit(1); });
