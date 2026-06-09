/**
 * PROSPEKT CRM — Restore: Categorias de Agências (Follow Up)
 * Restaura APENAS as categorias apagadas hoje:
 *   - 🏢 Agências|Follow Up - Carteira
 *   - 🏢 Agências|Follow Up - Lead Novo
 *
 * MODO ADITIVO — nunca apaga dados existentes.
 * Uso: node scripts/restore-agencias-followup.js
 */

const crypto = require('crypto');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Scripts originais (conforme seed-scripts-comerciais.js) ──────────────────
const SCRIPTS = [

  /* ═══════════════════════════════════════════════════════════════
   * 🏢 AGÊNCIAS — Follow Up - Carteira
   * ═══════════════════════════════════════════════════════════════ */
  {
    titulo:    'D+6 Meses',
    categoria: '🏢 Agências|Follow Up - Carteira',
    texto: `Oi, [Nome]! Tudo bem? 👋

Já faz um tempo da nossa última entrega, e da última vez vocês estavam com algumas ações/campanhas ativas 🚀

Se fizer sentido, eu te mando uma seleção rápida por aqui, mostrando o que a Prospekt continua desenvolvendo para agências que precisam de agilidade, escala e diferenciação nas entregas ✨`,
  },
  {
    titulo:    'D+8 Meses',
    categoria: '🏢 Agências|Follow Up - Carteira',
    texto: `Oi, [Nome]! Tudo bem? 👋

Nós estamos com um foco muito forte em apoiar agências com soluções mais rápidas, personalizadas e com mais impacto para campanhas, ativações e kits ✨

Voltei a lembrar da sua agência porque acredito que algumas dessas possibilidades poderiam fazer MUITO sentido para vocês hoje 🚀

Posso te enviar algumas referências rápidas? 👀`,
  },
  {
    titulo:    'D+12 Meses',
    categoria: '🏢 Agências|Follow Up - Carteira',
    texto: `Oi, [Nome]! Tudo bem? 👋

Já faz um tempo da nossa última parceria… e nesse período a Prospekt ampliou bastante a estrutura e também melhoramos MUITO o atendimento para demandas de agência 🚀

Estamos trabalhando com novas apresentações comerciais e possibilidades que podem fazer sentido para futuras campanhas, ações e ativações ✨

Posso te enviar uma apresentação rápida por aqui? 📲`,
  },
  {
    titulo:    'D+18 Meses',
    categoria: '🏢 Agências|Follow Up - Carteira',
    texto: `Oi, [Nome]! Tudo bem por aí? 👋

Resolvi passar por aqui um dia e retomar nosso contato 😊

Desde a última vez que tivemos a oportunidade de atender vocês, a Prospekt evoluiu bastante e trouxemos muitas novidades em opções de produtos, ativações e experiências ✨

Estou te encaminhando nossa apresentação atualizada para você dar uma olhadinha. Tem várias ideias bacanas que podem fazer todo sentido para as futuras campanhas, ações e demandas promocionais da agência 🚀`,
  },
  {
    titulo:    'D+24 Meses',
    categoria: '🏢 Agências|Follow Up - Carteira',
    texto: `Oi, [Nome]! Tudo bem por aí? 👋

Já faz um tempinho desde a nossa última parceria, então achei que valia muito a pena retomar nosso contato 😊

De lá pra cá, a Prospekt evoluiu bastante 🚀

Trouxemos muitas novidades para o nosso portfólio de brindes personalizados e estruturamos ainda melhor o nosso atendimento.

Vou deixar aqui anexada nossa apresentação comercial atualizada para vocês conhecerem melhor tudo o que fazemos hoje ✨

Tem várias possibilidades incríveis para apoiar campanhas, ativações e entregas especiais para agências 👊`,
  },

  /* ═══════════════════════════════════════════════════════════════
   * 🏢 AGÊNCIAS — Follow Up - Lead Novo
   * ═══════════════════════════════════════════════════════════════ */
  {
    titulo:    'D+2',
    categoria: '🏢 Agências|Follow Up - Lead Novo',
    texto: `Oi, [Nome]! Tudo certo com a entrega? 😊

Se tiver qualquer próximo job entrando, me chama que te ajudo a ganhar mais agilidade nisso ✨`,
  },
  {
    titulo:    'D+15',
    categoria: '🏢 Agências|Follow Up - Lead Novo',
    texto: `Oi, [Nome]! 😊

Passando de forma bem objetiva pra entender se surgiu alguma nova demanda nesses dias 👀

Se tiver alguma ação entrando, estamos prontos por aqui pra te apoiar com ideia + execução rápida ✨`,
  },
  {
    titulo:    'D+60',
    categoria: '🏢 Agências|Follow Up - Lead Novo',
    texto: `Oi, [Nome], passei aqui porque lembrei daquela ação de [tipo/cliente/produto] que fizemos juntos.

Como vocês costumam ter campanhas que entram com prazos mais curtos, quis me antecipar caso tenha alguma frente nova vindo por aí.

Tem algo entrando nas próximas semanas?`,
  },
  {
    titulo:    'D+3M',
    categoria: '🏢 Agências|Follow Up - Lead Novo',
    texto: `Tem alguma conta entrando em campanha nas próximas semanas?`,
  },
];

async function restore() {
  console.log('\n🔄 PROSPEKT — Restaurando categorias de Agências...\n');

  // Busca o que já existe para não duplicar
  const { data: existentes, error: errBusca } = await sb
    .from('mensagens_padrao')
    .select('categoria, titulo')
    .in('categoria', ['🏢 Agências|Follow Up - Carteira', '🏢 Agências|Follow Up - Lead Novo']);

  if (errBusca) {
    console.error('❌ Erro ao buscar existentes:', errBusca.message);
    process.exit(1);
  }

  const jaExistem = new Set(
    (existentes || []).map(r => `${r.categoria}||${r.titulo}`)
  );

  const agora = new Date().toISOString();
  const novos = SCRIPTS.filter(s => !jaExistem.has(`${s.categoria}||${s.titulo}`));

  if (novos.length === 0) {
    console.log('✅ Todos os scripts já existem no banco. Nada alterado.\n');
    return;
  }

  const rows = novos.map(s => ({
    id:            crypto.randomBytes(16).toString('hex'),
    titulo:        s.titulo,
    categoria:     s.categoria,
    texto:         s.texto,
    funil_id:      null,
    etapa_id:      null,
    ativo:         1,
    criado_por:    null,
    criado_em:     agora,
    atualizado_em: agora,
  }));

  const { error } = await sb.from('mensagens_padrao').insert(rows);
  if (error) {
    console.error('❌ Erro ao inserir:', error.message);
    process.exit(1);
  }

  console.log(`✅ ${rows.length} scripts restaurados:\n`);
  rows.forEach(r => console.log(`   ✔ [${r.categoria}] ${r.titulo}`));
  if (jaExistem.size > 0) {
    console.log(`\nℹ️  ${jaExistem.size} já existiam — preservados sem alteração.`);
  }
  console.log('\n✔ Restauração concluída!\n');
}

restore().catch(e => { console.error('❌', e.message); process.exit(1); });
