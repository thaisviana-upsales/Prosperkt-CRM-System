/**
 * PROSPEKT CRM — Seed: Lista Oficial de Produtos
 * 267 produtos oficiais da Prospekt.
 *
 * SEGURO:
 *   - Nunca usa DELETE / DROP / TRUNCATE
 *   - Supabase: INSERT apenas se nome não existir (case-insensitive)
 *   - SQLite: INSERT OR IGNORE
 *   - Idempotente: pode rodar quantas vezes quiser
 *
 * Uso standalone: node src/seeds/seed-produtos-oficiais.js
 * Uso programático: require('./seed-produtos-oficiais').seedProdutos(provider)
 */

const crypto = require('crypto');

// ── Lista oficial de 267 produtos da Prospekt ─────────────────────────────────
// Ordenada alfabeticamente, sem categoria (campo livre para uso futuro)
// origem = 'lista_oficial_prospekt'
const PRODUTOS_OFICIAIS = [
  'Abadá',
  'Abridor Metal',
  'Adaptador De Tomada',
  'Adesivo',
  'Água',
  'Almofada',
  'Amostra',
  'Apito',
  'Avental',
  'Backdrop',
  'Bala Personalizada',
  'Balde',
  'Baleiro',
  'Banco Retrátil',
  'Banda Elástica',
  'Bandana',
  'Bandeira',
  'Bandeirinha',
  'Bandeja Amostra',
  'Bar Flutuante',
  'Basquete De Mesa',
  'Bateco Com Led',
  'Berço',
  'Bloco',
  'Bloco De Notas',
  'Body',
  'Boina',
  'Bola',
  'Bola Antiestresse',
  'Bolacha',
  'Bolsa',
  'Bolsa Esportiva',
  'Bolsa Organizadora',
  'Bolsa Térmica',
  'Boné',
  'Bottons',
  'Bracelete Bonfim',
  'Bucha Para Banho',
  'Bucket',
  'Cadeado',
  'Caderneta',
  'Caderno',
  'Caixa',
  'Caixa De Som',
  'Calça',
  'Camera Digital',
  'Camera Instax',
  'Camisa',
  'Camiseta',
  'Caneca',
  'Caneca com Tirante',
  'Caneca Termica',
  'Caneta',
  'Caneta Ecológica',
  'Caneta Marca Texto',
  'Canga',
  'Cantil',
  'Capa Airtag',
  'Capa De Cadeira',
  'Capa De Cd',
  'Capa De Celular',
  'Capa De Chuva',
  'Capa De Sofa',
  'Capacete De Obra',
  'Card',
  'Carimbo',
  'Carregador',
  'Carta',
  'Carta De Baralho',
  'Cartão',
  'Cartão Com Envelope',
  'Cartão Postal',
  'Cartucheira',
  'Case óculos',
  'Cenografia',
  'Cesta',
  'Chá',
  'Chaleira',
  'Champagne',
  'Champanheira',
  'Chapéu',
  'Charm Bag',
  'Chaveiro',
  'Chinelo',
  'Colar',
  'Colete',
  'Cooler',
  'Copo',
  'Copo de café',
  'Copo de Papel',
  'Copo de plástico',
  'Copo de shot',
  'Copo de vidro',
  'Copo Stanley',
  'Copo Térmico',
  'Coqueteleira',
  'Corda',
  'Cordão',
  'Cordão de crachá',
  'Corrente',
  'Corta Vento',
  'Crachá PVC',
  'Credencial',
  'Cubos',
  'Difusor',
  'Display De Mesa',
  'Ecobag',
  'Embalagem',
  'Enfeite De Natal',
  'Envelope',
  'Esfera De Aço Inox',
  'Espelho',
  'Estojo',
  'Etiqueta',
  'Etiqueta Emborrachada',
  'Ficha De Palco',
  'Filete',
  'Filipeta',
  'Fita De Cetim',
  'Fita De Gorgurão',
  'Flanela De Oculos',
  'Flyer',
  'Folder A4',
  'Fone',
  'Fone De Ouvido',
  'Fone Jbl',
  'Frasquinho Perfume',
  'Gameboy',
  'Gancho Para Bolsa',
  'Garfos',
  'Garrafa',
  'Garrafa De Plastico',
  'Garrafa Pacco',
  'Garrafa Térmica',
  'Gift Card',
  'Guarda Chuva',
  'Guardanapo',
  'Hub',
  'Imã',
  'Jaleco',
  'Jaqueta',
  'Jaqueta Puffer',
  'Johnnie Waler Gold Label',
  'Kit',
  'Kit Bar',
  'Kit Caderno',
  'Lâmpada Inteligente',
  'Lanterna',
  'Lápis',
  'Lata',
  'Lata De Chá',
  'Lenço',
  'Leque',
  'Livreto',
  'Livros',
  'Lixo carro',
  'Lousa Magica',
  'Luva Boxe',
  'Luva Golf',
  'Mala',
  'Mala De Mão',
  'Manguito',
  'Manifesto',
  'Manta',
  'Marcador de Página',
  'Marmiteira',
  'Martelo',
  'Máscara',
  'Máscara de Dormir',
  'Massageador',
  'Meias',
  'Menu - A4',
  'Mexedor',
  'Miçangas',
  'Microfone',
  'Mini Bolinha',
  'Mini Geladeira',
  'Mini Prancha',
  'Mochila',
  'Mochila Pirulito',
  'Mochila Térmica',
  'Moleskine',
  'Moletom',
  'Mouse',
  'Mouse Pad',
  'Munhequeira',
  'Necessaire',
  'Óculos',
  'Papel Celofane',
  'Papel De Presente',
  'Papper Wrap',
  'Pasta',
  'Patch Bordado',
  'Patch Flocado',
  'Patch Pvc',
  'Pen Drive',
  'Personalização',
  'Petisqueira',
  'Pin',
  'Pin Brinco',
  'Pin Metal',
  'Pin Resinado',
  'Pins Esmaltado',
  'Pins Resinado',
  'Pirulito Para Mochila',
  'Placa',
  'Placa De Gelo',
  'Placa de Identificação',
  'Planner',
  'Pochete',
  'Porta Cartão',
  'Porta Copo',
  'Porta Documento',
  'Porta Relógio',
  'Porta Retrato',
  'Pote De Sorvete',
  'Power Bank',
  'Projetor',
  'Protetor de Webcam',
  'Pulseira',
  'Qr Code Plastificado',
  'Ralador',
  'Raquete',
  'Redinha Para Chinelo',
  'Regata',
  'Relógio',
  'Ring Light',
  'Roleta',
  'Roll Up',
  'Roupão',
  'Saco De Pancada',
  'Saco De Veludo',
  'Sacochila',
  'Sacola',
  'Sacola de algodão',
  'Sacola Kraft',
  'Sacola Tnt',
  'Salva Fone',
  'Saquinho algodão cru',
  'Selos',
  'Shorts',
  'Shorts Infantil',
  'Shoulder Bag',
  'Sino',
  'Squeeze',
  'Table Tent',
  'Tábua De Madeira',
  'Taças',
  'Tag De Mala',
  'Talher',
  'Tapete',
  'Tapete De Yoga',
  'Tatuagem Temporária',
  'Tênis',
  'Tiara',
  'Tirante',
  'Toalha',
  'Touca',
  'Trofeu',
  'Uniforme',
  'Urna De Madeira',
  'Velas',
  'Ventarola',
  'Ventilador',
  'Viseira',
  'Wind Banner',
  'Xícara',
];

// Cor gerada por hash do nome (consistente, sem random)
function corPorNome(nome) {
  const cores = [
    '#6CFF4E','#3B8BFF','#FF6B6B','#FFD93D','#C77DFF',
    '#06D6A0','#FF9F1C','#2EC4B6','#E71D36','#FF4D6D',
    '#4CC9F0','#F72585','#7209B7','#3A0CA3','#4361EE',
    '#2EC4B6','#06D6A0','#FFD93D','#FF9F1C','#C77DFF',
  ];
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) & 0xffffffff;
  return cores[Math.abs(h) % cores.length];
}

/**
 * Executa o seed.
 * @param {object|undefined} options - { sb, isSupa, sqlite } ou undefined (standalone)
 */
async function seedProdutos(options) {
  let sb, isSupa, sqlite;

  if (options && (options.sb || options.sqlite)) {
    ({ sb, isSupa, sqlite } = options);
  } else {
    const path = require('path');
    require('dotenv').config({ path: path.join(__dirname, '../../.env') });
    const { getProvider } = require('../database/dbProvider');
    ({ sb, isSupa, sqlite } = getProvider());
  }

  const agora = new Date().toISOString();
  let inseridos = 0;
  let pulados   = 0;
  let erros     = 0;

  console.log('\n🌱 PROSPEKT — Seed: Lista Oficial de Produtos (267)\n');

  // ── Supabase ────────────────────────────────────────────────────────────────
  if (isSupa && sb) {
    // Busca todos os nomes existentes (lowercase) de uma vez
    const { data: existentes, error: errList } = await sb
      .from('produtos')
      .select('nome')
      .order('nome');

    if (errList) {
      console.error('Erro ao listar produtos existentes:', errList.message);
      return { inseridos: 0, pulados: 0, erros: 1 };
    }

    const nomesExistentes = new Set(
      (existentes || []).map(p => p.nome.trim().toLowerCase())
    );

    // Filtra apenas os que precisam ser inseridos
    const novos = PRODUTOS_OFICIAIS.filter(
      nome => !nomesExistentes.has(nome.trim().toLowerCase())
    );

    console.log(`  📦 Já existem: ${existentes.length} produtos`);
    console.log(`  🆕 Novos a inserir: ${novos.length}\n`);

    if (novos.length === 0) {
      console.log('✔ Todos os produtos já estão cadastrados.\n');
      return { inseridos: 0, pulados: PRODUTOS_OFICIAIS.length, erros: 0 };
    }

    // Insere em lotes de 50 para evitar timeout
    const LOTE = 50;
    for (let i = 0; i < novos.length; i += LOTE) {
      const lote = novos.slice(i, i + LOTE).map((nome, j) => ({
        id:           crypto.randomBytes(16).toString('hex'),
        nome:         nome.trim(),
        categoria:    null,
        cor:          corPorNome(nome),
        ordem:        (i + j + 1) * 10,
        ativo:        true,
        origem:       'lista_oficial_prospekt',
        criado_em:    agora,
        atualizado_em: agora,
      }));

      const { error: errIns } = await sb.from('produtos').insert(lote);
      if (errIns) {
        // Tenta sem campos extras (caso patch v10 não tenha rodado)
        const loteLegado = lote.map(({ categoria, ordem, origem, ...resto }) => resto);
        const { error: errIns2 } = await sb.from('produtos').insert(loteLegado);
        if (errIns2) {
          console.error(`  ❌ Erro no lote ${Math.floor(i/LOTE)+1}:`, errIns2.message);
          erros += lote.length;
          continue;
        }
      }

      lote.forEach(p => {
        console.log(`  ✅ ${p.nome}`);
        inseridos++;
      });
    }

    pulados = nomesExistentes.size;

  // ── SQLite ──────────────────────────────────────────────────────────────────
  } else if (sqlite) {
    // Garante colunas extras
    for (const col of [
      'ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria TEXT',
      'ALTER TABLE produtos ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT \'lista_oficial_prospekt\'',
      'ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ordem INTEGER DEFAULT 0',
    ]) {
      try { sqlite.exec(col); } catch { /* já existe */ }
    }

    const checkStmt  = sqlite.prepare(`SELECT id FROM produtos WHERE LOWER(nome)=LOWER(?) LIMIT 1`);
    const insertStmt = sqlite.prepare(`
      INSERT OR IGNORE INTO produtos (id,nome,categoria,cor,ordem,ativo,origem,criado_em,atualizado_em)
      VALUES (?,?,NULL,?,?,1,'lista_oficial_prospekt',?,?)
    `);

    const doSeed = sqlite.transaction(() => {
      PRODUTOS_OFICIAIS.forEach((nome, idx) => {
        const exists = checkStmt.get(nome.trim());
        if (exists) {
          console.log(`  ⏭  Já existe: ${nome}`);
          pulados++;
          return;
        }
        const id = crypto.randomBytes(16).toString('hex');
        insertStmt.run(id, nome.trim(), corPorNome(nome), (idx + 1) * 10, agora, agora);
        console.log(`  ✅ ${nome}`);
        inseridos++;
      });
    });
    doSeed();

  } else {
    console.error('❌ Provider de banco não disponível.');
    return { inseridos: 0, pulados: 0, erros: 1 };
  }

  console.log(`\n✔ Concluído: ${inseridos} inserido(s), ${pulados} já existia(m)${erros ? `, ${erros} erro(s)` : ''}.\n`);
  return { inseridos, pulados, erros };
}

// Standalone
if (require.main === module) {
  seedProdutos()
    .then(r => process.exit(r.erros > 0 ? 1 : 0))
    .catch(e => { console.error('Erro crítico no seed:', e.message); process.exit(1); });
}

module.exports = { seedProdutos, PRODUTOS_OFICIAIS };
