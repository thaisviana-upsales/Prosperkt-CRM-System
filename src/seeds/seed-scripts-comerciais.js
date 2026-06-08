/**
 * PROSPERKT CRM — Seed: Scripts Comerciais Oficiais
 * Insere as mensagens reais da PROSPERKT na tabela mensagens_padrao.
 * Idempotente: verifica por (categoria + titulo) antes de inserir.
 *
 * Uso: node src/seeds/seed-scripts-comerciais.js
 */

const path   = require('path');
const crypto = require('crypto');

// Carrega variáveis de ambiente
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { getDb } = require('../database/db');

// ── Mensagens oficiais PROSPERKT ─────────────────────────────────────────────
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

  /* ═══════════════════════════════════════════════════════════════
   * 🏭 MARCA DIRETA — Follow Up - Carteira
   * ═══════════════════════════════════════════════════════════════ */
  {
    titulo:    'D+6 Meses',
    categoria: '🏭 Marca Direta|Follow Up - Carteira',
    texto: `Oi, [Nome] 👋

Passando aqui porque lembrei da sua marca.

Como estão as ações e campanhas de vocês por aí? ✨

Estamos desenvolvendo alguns projetos e ativações para marcas que querem gerar mais percepção de valor, presença e experiência com clientes.

Faz sentido eu mostrar algumas ideias novas? 🚀`,
  },
  {
    titulo:    'D+8 Meses',
    categoria: '🏭 Marca Direta|Follow Up - Carteira',
    texto: `Oi, [Nome]! ✨

Esses dias entraram algumas soluções novas aqui na Prospekt e na verdade MUITO a sua marca.

Estamos criando experiências personalizadas que ajudam empresas a:

✔ aumentar percepção de valor
✔ fortalecer relacionamento com clientes
✔ gerar mais impacto nas campanhas

Posso te enviar algumas inspirações que acredito que combinam com o posicionamento de vocês? 👀`,
  },
  {
    titulo:    'D+12 Meses',
    categoria: '🏭 Marca Direta|Follow Up - Carteira',
    texto: `[Nome], tudo bem? 👋

Já faz um tempo desde nosso último projeto juntos… e muita coisa mudou por aqui 🚀

Hoje estamos elevando marcas com estratégias ainda mais personalizadas para:

✨ ações de relacionamento
✨ kits corporativos
✨ campanhas sazonais
✨ experiências premium para clientes e equipes

Acredito que faz muito sentido retomarmos essa conversa 🤝

Posso te apresentar algumas ideias novas?`,
  },
  {
    titulo:    'D+18 Meses',
    categoria: '🏭 Marca Direta|Follow Up - Carteira',
    texto: `Oi, [Nome] 👋

Passando aqui porque estamos abrindo alguns projetos especiais para marcas que querem fortalecer presença e relacionamento nesse semestre 🚀

E sinceramente?

Sua marca foi uma das que lembrei na hora 👀

Temos algumas soluções bem diferentes do mercado hoje e acredito que vocês poderiam aproveitar MUITO isso.

Quer que eu te envie algumas referências rápidas? 📲`,
  },
  {
    titulo:    'D+24 Meses',
    categoria: '🏭 Marca Direta|Follow Up - Carteira',
    texto: `Oi, [Nome] 👋

Faz bastante tempo desde nosso último contato, mas acompanhei alguns movimentos da sua marca e resolvi te chamar novamente ✨👀

Hoje a Prospekt está desenvolvendo projetos muito mais estratégicos, voltados para empresas que querem:

✔ gerar experiência
✔ fortalecer posicionamento
✔ criar relacionamento com clientes de forma memorável

Acredito que conseguimos construir algo MUITO legal juntos novamente 🤝✨

Se fizer sentido, posso te mostrar algumas ideias rápidas por aqui 👌`,
  },

  /* ═══════════════════════════════════════════════════════════════
   * 🏭 MARCA DIRETA — Follow Up - Lead Novo
   * ═══════════════════════════════════════════════════════════════ */
  {
    titulo:    'D+2',
    categoria: '🏭 Marca Direta|Follow Up - Lead Novo',
    texto: `Oi, [Nome]! Tudo certo com a entrega? 😊

Se tiver qualquer próximo job entrando, me chama que te ajudo a ganhar mais agilidade nisso ✨`,
  },
  {
    titulo:    'D+15',
    categoria: '🏭 Marca Direta|Follow Up - Lead Novo',
    texto: `Oi, [Nome]! 😊

Passando de forma bem objetiva pra entender se surgiu alguma nova demanda nesses dias 👀

Se tiver alguma ação entrando, estamos prontos por aqui pra te apoiar com ideia + execução rápida ✨`,
  },
  {
    titulo:    'D+60',
    categoria: '🏭 Marca Direta|Follow Up - Lead Novo',
    texto: `Oi, [Nome]. Passei aqui porque lembrei daquela ação de [tipo/cliente/produto] que fizemos juntos.

Como vocês costumam ter campanhas que entram com prazos mais curtos, quis me antecipar caso tenha alguma frente nova vindo por aí.

Tem algo entrando nas próximas semanas?`,
  },
  {
    titulo:    'D+3M',
    categoria: '🏭 Marca Direta|Follow Up - Lead Novo',
    texto: `Tem alguma campanha entrando nas próximas semanas?`,
  },
];

// ── Executa o seed ────────────────────────────────────────────────────────────
function run() {
  const db    = getDb();
  const agora = new Date().toISOString();

  let inseridos = 0;
  let pulados   = 0;

  const checkStmt  = db.prepare('SELECT id FROM mensagens_padrao WHERE categoria = ? AND titulo = ?');
  const insertStmt = db.prepare(`
    INSERT INTO mensagens_padrao
      (id, titulo, categoria, texto, funil_id, etapa_id, ativo, criado_por, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, NULL, NULL, 1, NULL, ?, ?)
  `);

  const seedMany = db.transaction(() => {
    for (const s of SCRIPTS) {
      const exists = checkStmt.get(s.categoria, s.titulo);
      if (exists) {
        console.log(`  ⏭  Já existe: [${s.categoria}] ${s.titulo}`);
        pulados++;
        continue;
      }
      const id = crypto.randomBytes(16).toString('hex');
      insertStmt.run(id, s.titulo, s.categoria, s.texto, agora, agora);
      console.log(`  ✅ Inserido:  [${s.categoria}] ${s.titulo}`);
      inseridos++;
    }
  });

  console.log('\n🚀 PROSPERKT — Seed: Scripts Comerciais\n');
  seedMany();
  console.log(`\n✔ Concluído: ${inseridos} inserido(s), ${pulados} já existia(m).\n`);
}

run();
