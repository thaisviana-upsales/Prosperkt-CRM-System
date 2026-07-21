/**
 * PROSPEKT CRM — Funis Controller
 * Supabase JS nativo ou SQLite conforme DATABASE_PROVIDER.
 * ARQUITETURA: funis → pipelines (funil_id) → etapas (pipeline_id)
 * No Supabase a tabela pipelines existe e etapas usam pipeline_id.
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

const ETAPAS_PADRAO = [
  { nome:'Lead Recebido',       ordem:1,  cor:'#6CFF4E', probabilidade:10,  is_ganho:0, is_perdido:0 },
  { nome:'Contato Realizado',   ordem:2,  cor:'#3B8BFF', probabilidade:25,  is_ganho:0, is_perdido:0 },
  { nome:'Lead Desqualificado', ordem:3,  cor:'#FF3B5C', probabilidade:5,   is_ganho:0, is_perdido:1 },
  // ── Em Tratativa: posicionada APÓS Lead Desqualificado em todos os funis comerciais ──
  { nome:'Em Tratativa',        ordem:4,  cor:'#7B61FF', probabilidade:30,  is_ganho:0, is_perdido:0 },
  { nome:'Orçamento Enviado',   ordem:5,  cor:'#6C47FF', probabilidade:55,  is_ganho:0, is_perdido:0 },
  { nome:'Orçamento Aprovado',  ordem:6,  cor:'#5BE89E', probabilidade:70,  is_ganho:0, is_perdido:0 },
  { nome:'Layout Virtual',      ordem:7,  cor:'#9B59B6', probabilidade:75,  is_ganho:0, is_perdido:0 },
  { nome:'Amostra Física',      ordem:8,  cor:'#FFB627', probabilidade:80,  is_ganho:0, is_perdido:0 },
  { nome:'Amostra Aprovada',    ordem:9,  cor:'#F5A623', probabilidade:90,  is_ganho:0, is_perdido:0 },
  { nome:'Follow-Up',           ordem:10, cor:'#FF8C00', probabilidade:50,  is_ganho:0, is_perdido:0 },
  { nome:'Vendas',              ordem:11, cor:'#6CFF4E', probabilidade:100, is_ganho:1, is_perdido:0 },
  { nome:'Perdidos',            ordem:12, cor:'#FF3B5C', probabilidade:0,   is_ganho:0, is_perdido:1 },
];

// Etapas da Carteira Recorrente (14 oficiais — preserva as "Previsão Carteira X")
const ETAPAS_CARTEIRA_RECORRENTE = [
  { nome:'Previsão Carteira 15-30 dias',  ordem:1,  cor:'#1a3a52', probabilidade:10,  is_ganho:0, is_perdido:0 },
  { nome:'Previsão Carteira 30-60 dias',  ordem:2,  cor:'#1e4460', probabilidade:10,  is_ganho:0, is_perdido:0 },
  { nome:'Previsão Carteira 60-90 dias',  ordem:3,  cor:'#234f6e', probabilidade:15,  is_ganho:0, is_perdido:0 },
  { nome:'Previsão Carteira 3 - 6 meses', ordem:4,  cor:'#285a7c', probabilidade:20,  is_ganho:0, is_perdido:0 },
  { nome:'Previsão Carteira 6 - 9 meses', ordem:5,  cor:'#2d658a', probabilidade:20,  is_ganho:0, is_perdido:0 },
  { nome:'Previsão Carteira 9 - 18 meses',ordem:6,  cor:'#327098', probabilidade:25,  is_ganho:0, is_perdido:0 },
  { nome:'Previsão Carteira +18 meses',   ordem:7,  cor:'#377ba6', probabilidade:25,  is_ganho:0, is_perdido:0 },
  { nome:'Orçamento Enviado',             ordem:8,  cor:'#3B8BFF', probabilidade:55,  is_ganho:0, is_perdido:0 },
  { nome:'Orçamento Aprovado',            ordem:9,  cor:'#5BE89E', probabilidade:70,  is_ganho:0, is_perdido:0 },
  { nome:'Layout Virtual',                ordem:10, cor:'#6CFF4E', probabilidade:75,  is_ganho:0, is_perdido:0 },
  { nome:'Amostra Física',                ordem:11, cor:'#FFB627', probabilidade:80,  is_ganho:0, is_perdido:0 },
  { nome:'Amostra Aprovada',              ordem:12, cor:'#F5A623', probabilidade:90,  is_ganho:0, is_perdido:0 },
  { nome:'Follow-Up',                     ordem:13, cor:'#FF8C00', probabilidade:50,  is_ganho:0, is_perdido:0 },
  { nome:'Vendas',                        ordem:14, cor:'#6CFF4E', probabilidade:100, is_ganho:1, is_perdido:0 },
];

const FUNIS_SEED = [
  { nome:'Indicação',           cor:'#6CFF4E' },
  { nome:'Instagram - Direct',  cor:'#E10098' },  // era 'Instagram'
  { nome:'Google Ads',          cor:'#EA4335' },  // novo
  { nome:'Meta Ads',            cor:'#1877F2' },  // novo
  { nome:'Carteira Recorrente', cor:'#3B8BFF' },
  { nome:'Parcerias',           cor:'#FFB627' },
  // 'Tráfego Pago' inativo — não constar na seed de novos
  { nome:'WhatsApp',            cor:'#25D366' },
  { nome:'Site',                cor:'#6C47FF' },
  { nome:'Evento',              cor:'#FF6B35' },
  { nome:'LinkedIn',            cor:'#0077B5' },
];

async function seedFunis() {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      const { data: existing } = await sb.from('funis').select('id,nome').limit(100);
      if (!existing?.length) {
        // Instância vazia: cria todos os funis iniciais
        for (const [idx, f] of FUNIS_SEED.entries()) {
          const funilId    = crypto.randomBytes(16).toString('hex');
          const pipelineId = crypto.randomBytes(16).toString('hex');
          await sb.from('funis').insert({ id:funilId, nome:f.nome, cor:f.cor, ativo:1, ordem:idx });
          await sb.from('pipelines').insert({ id:pipelineId, funil_id:funilId, nome:`Pipeline - ${f.nome}`, ordem:idx, ativo:1 });
          const etapas = f.nome === 'Carteira Recorrente' ? ETAPAS_CARTEIRA_RECORRENTE : ETAPAS_PADRAO;
          for (const e of etapas) {
            await sb.from('etapas').insert({ id:crypto.randomBytes(16).toString('hex'), pipeline_id:pipelineId, funil_id:funilId, nome:e.nome, cor:e.cor, ordem:e.ordem, is_ganho:e.is_ganho, is_perdido:e.is_perdido, probabilidade:e.probabilidade });
          }
        }
        console.log('[Seed] Funis criados no Supabase.');
      } else {
        // ── Instância existente: aplica ajustes cirúrgicos ──────────────────
        const nomesExistentes = new Set((existing||[]).map(f => f.nome));

        // 1. Renomear Instagram → Instagram - Direct (se necessário)
        if (nomesExistentes.has('Instagram') && !nomesExistentes.has('Instagram - Direct')) {
          await sb.from('funis')
            .update({ nome: 'Instagram - Direct', atualizado_em: new Date().toISOString() })
            .eq('nome', 'Instagram');
          // Renomeia pipeline vinculada
          await sb.from('pipelines')
            .update({ nome: 'Pipeline - Instagram - Direct', atualizado_em: new Date().toISOString() })
            .eq('nome', 'Pipeline - Instagram');
          console.log('[Seed] Funil "Instagram" renomeado para "Instagram - Direct".');
        }

        // 2. Inativar Tráfego Pago (sem deletar)
        if (nomesExistentes.has('Tráfego Pago')) {
          await sb.from('funis')
            .update({ ativo: false, atualizado_em: new Date().toISOString() })
            .eq('nome', 'Tráfego Pago');
          console.log('[Seed] Funil "Tráfego Pago" marcado como inativo.');
        }

        // 3. Criar Google Ads se não existir
        if (!nomesExistentes.has('Google Ads')) {
          const gId = crypto.randomBytes(16).toString('hex');
          const gPipeId = crypto.randomBytes(16).toString('hex');
          await sb.from('funis').insert({ id:gId, nome:'Google Ads', cor:'#EA4335', ativo:true });
          await sb.from('pipelines').insert({ id:gPipeId, funil_id:gId, nome:'Pipeline - Google Ads', ordem:0, ativo:true });
          for (const e of ETAPAS_PADRAO) {
            await sb.from('etapas').insert({ id:crypto.randomBytes(16).toString('hex'), pipeline_id:gPipeId, funil_id:gId, nome:e.nome, cor:e.cor, ordem:e.ordem, is_ganho:e.is_ganho, is_perdido:e.is_perdido, probabilidade:e.probabilidade });
          }
          console.log('[Seed] Funil "Google Ads" criado com pipeline e etapas.');
        } else {
          // Garante que está ativo
          await sb.from('funis').update({ ativo: true }).eq('nome', 'Google Ads');
        }

        // 4. Criar Meta Ads se não existir
        if (!nomesExistentes.has('Meta Ads')) {
          const mId = crypto.randomBytes(16).toString('hex');
          const mPipeId = crypto.randomBytes(16).toString('hex');
          await sb.from('funis').insert({ id:mId, nome:'Meta Ads', cor:'#1877F2', ativo:true });
          await sb.from('pipelines').insert({ id:mPipeId, funil_id:mId, nome:'Pipeline - Meta Ads', ordem:0, ativo:true });
          for (const e of ETAPAS_PADRAO) {
            await sb.from('etapas').insert({ id:crypto.randomBytes(16).toString('hex'), pipeline_id:mPipeId, funil_id:mId, nome:e.nome, cor:e.cor, ordem:e.ordem, is_ganho:e.is_ganho, is_perdido:e.is_perdido, probabilidade:e.probabilidade });
          }
          console.log('[Seed] Funil "Meta Ads" criado com pipeline e etapas.');
        } else {
          // Garante que está ativo
          await sb.from('funis').update({ ativo: true }).eq('nome', 'Meta Ads');
        }
      }
      // Garante etapas corretas da Carteira Recorrente em instâncias existentes
      await _seedEtapasCarteiraRecorrente_Supa(sb).catch(e => console.warn('[seedEtapas Supa]', e.message));
      // Garante etapas padrão (incl. Layout Virtual) em todos os funis comerciais ativos
      await _seedEtapasPadrao_Supa(sb).catch(e => console.warn('[seedEtapasPadrao Supa]', e.message));
      return;
    }
    // SQLite
    const { getDb } = require('../database/db');
    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) as c FROM funis").get().c;
    if (count === 0) {
      const adminId = db.prepare("SELECT id FROM usuarios WHERE role='SUPER_ADMIN' LIMIT 1").get()?.id;
      FUNIS_SEED.forEach((f, idx) => {
        const funilId = crypto.randomBytes(16).toString('hex');
        const pipelineId = crypto.randomBytes(16).toString('hex');
        db.prepare(`INSERT INTO funis (id,nome,cor,ativo,criado_por) VALUES (?,?,?,1,?)`).run(funilId,f.nome,f.cor,adminId);
        db.prepare(`INSERT INTO pipelines (id,funil_id,nome,ordem,ativo,criado_por) VALUES (?,?,?,?,1,?)`).run(pipelineId,funilId,`Pipeline - ${f.nome}`,idx,adminId);
        const etapas = f.nome === 'Carteira Recorrente' ? ETAPAS_CARTEIRA_RECORRENTE : ETAPAS_PADRAO;
        etapas.forEach(e => {
          db.prepare(`INSERT INTO etapas (id,pipeline_id,nome,cor,ordem,is_ganho,is_perdido,probabilidade,criado_por) VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomBytes(16).toString('hex'),pipelineId,e.nome,e.cor,e.ordem,e.is_ganho,e.is_perdido,e.probabilidade,adminId);
        });
      });
    } else {
      // SQLite — ajustes cirúrgicos em instância existente
      const instNomes = new Set(db.prepare('SELECT nome FROM funis').all().map(f => f.nome));
      if (instNomes.has('Instagram') && !instNomes.has('Instagram - Direct')) {
        db.prepare(`UPDATE funis SET nome='Instagram - Direct', atualizado_em=? WHERE nome='Instagram'`).run(new Date().toISOString());
        db.prepare(`UPDATE pipelines SET nome='Pipeline - Instagram - Direct', atualizado_em=? WHERE nome='Pipeline - Instagram'`).run(new Date().toISOString());
        console.log('[Seed SQLite] Funil "Instagram" renomeado para "Instagram - Direct".');
      }
      if (instNomes.has('Tráfego Pago')) {
        db.prepare(`UPDATE funis SET ativo=0, atualizado_em=? WHERE nome='Tráfego Pago'`).run(new Date().toISOString());
        console.log('[Seed SQLite] Funil "Tráfego Pago" inativado.');
      }
    }
    // Garante etapas corretas da Carteira Recorrente em instâncias existentes
    try { _seedEtapasCarteiraRecorrente_SQLite(db); } catch(e) { console.warn('[seedEtapas SQLite]', e.message); }
    // Garante etapas padrão (incl. Layout Virtual) em todos os funis comerciais
    try { _seedEtapasPadrao_SQLite(db); } catch(e) { console.warn('[seedEtapasPadrao SQLite]', e.message); }
  } catch(e) { console.error('[seedFunis]', e.message); }
}

// Etapas obsoletas da Carteira Recorrente — sem prefixo "Previsão Carteira"
// Essas variantes de nome existiam antes da padronização e devem ser ocultadas.
const ETAPAS_CARTEIRA_REMOVIDAS = [
  'Carteira 15-30 dias',
  'Carteira 30-60 dias',
  'Carteira 60-90 dias',
  'Carteira 6 - 9 meses',
  'Carteira 9 - 18 meses',
  'Carteira +18 meses',
];

// Etapas globalmente removidas de TODOS os funis (variações INCORRETAS de "Tratativa em andamento").
// IMPORTANTE: "Em Tratativa" é a etapa CORRETA e NÃO deve estar nesta lista.
// Apenas as variações erradas/obsoletas são bloqueadas.
const ETAPAS_GLOBAIS_REMOVIDAS = [
  'Tratativa em andamento',   // etapa errada/obsoleta — nunca exibir
  'Tratativa em Andamento',   // variação de caixa
  'TRATATIVA EM ANDAMENTO',   // variação maiúscula
  'Tratativa andamento',      // variação incompleta
  'Tratativa',                // variação genérica
  'Contato em Tratativa',     // variação antiga
  // NOTA: 'Em Tratativa' é a etapa CORRETA — exibir nos funis comerciais
];

// Garante as 14 etapas oficiais da Carteira Recorrente — sem duplicar (SQLite)
function _seedEtapasCarteiraRecorrente_SQLite(db) {
  const funilCart = db.prepare(`SELECT id FROM funis WHERE nome LIKE '%Carteira Recorrente%' AND ativo=1 LIMIT 1`).get();
  if (!funilCart) return;
  let pipe = db.prepare(`SELECT id FROM pipelines WHERE funil_id=? LIMIT 1`).get(funilCart.id);
  if (!pipe) {
    const pipeId = crypto.randomBytes(16).toString('hex');
    const adminId = db.prepare("SELECT id FROM usuarios WHERE role='SUPER_ADMIN' LIMIT 1").get()?.id;
    db.prepare(`INSERT INTO pipelines (id,funil_id,nome,ordem,ativo,criado_por) VALUES (?,?,'Pipeline - Carteira Recorrente',0,1,?)`).run(pipeId, funilCart.id, adminId);
    pipe = { id: pipeId };
  }
  for (const e of ETAPAS_CARTEIRA_RECORRENTE) {
    const existe = db.prepare(`SELECT id FROM etapas WHERE pipeline_id=? AND nome=? LIMIT 1`).get(pipe.id, e.nome);
    if (!existe) {
      db.prepare(`INSERT INTO etapas (id,pipeline_id,nome,cor,ordem,is_ganho,is_perdido,probabilidade) VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomBytes(16).toString('hex'),pipe.id,e.nome,e.cor,e.ordem,e.is_ganho,e.is_perdido,e.probabilidade);
    }
  }
  console.log('[Seed] Etapas Carteira Recorrente verificadas (SQLite).');
}

// Garante as 14 etapas oficiais da Carteira Recorrente — sem duplicar (Supabase)
async function _seedEtapasCarteiraRecorrente_Supa(sb) {
  const { data: funisCart } = await sb.from('funis').select('id').ilike('nome','%Carteira Recorrente%').eq('ativo',1).limit(1);
  if (!funisCart?.length) return;
  const funilId = funisCart[0].id;
  const { data: pipes } = await sb.from('pipelines').select('id').eq('funil_id', funilId).limit(1);
  let pipeId;
  if (!pipes?.length) {
    pipeId = crypto.randomBytes(16).toString('hex');
    await sb.from('pipelines').insert({ id:pipeId, funil_id:funilId, nome:'Pipeline - Carteira Recorrente', ordem:0, ativo:1 });
  } else {
    pipeId = pipes[0].id;
  }
  const { data: etapasExist } = await sb.from('etapas').select('nome').eq('pipeline_id', pipeId);
  const nomesExist = new Set((etapasExist||[]).map(e => e.nome));
  for (const e of ETAPAS_CARTEIRA_RECORRENTE) {
    if (!nomesExist.has(e.nome)) {
      await sb.from('etapas').insert({ id:crypto.randomBytes(16).toString('hex'), pipeline_id:pipeId, nome:e.nome, cor:e.cor, ordem:e.ordem, is_ganho:e.is_ganho, is_perdido:e.is_perdido, probabilidade:e.probabilidade });
    }
  }
  console.log('[Seed] Etapas Carteira Recorrente verificadas (Supabase).');
}

// Garante as 12 etapas padrão (incl. Layout Virtual) em todos os funis comerciais — sem duplicar (SQLite)
function _seedEtapasPadrao_SQLite(db) {
  // Obtém todos os pipelines de funis que NÃO são Carteira Recorrente
  const pipes = db.prepare(
    `SELECT p.id FROM pipelines p JOIN funis f ON p.funil_id=f.id WHERE f.nome NOT LIKE '%Carteira Recorrente%' AND f.ativo=1`
  ).all();
  for (const pipe of pipes) {
    const existentes = db.prepare(`SELECT nome FROM etapas WHERE pipeline_id=?`).all(pipe.id);
    const nomesExist = new Set(existentes.map(e => e.nome));
    for (const e of ETAPAS_PADRAO) {
      if (!nomesExist.has(e.nome)) {
        db.prepare(`INSERT INTO etapas (id,pipeline_id,nome,cor,ordem,is_ganho,is_perdido,probabilidade) VALUES (?,?,?,?,?,?,?,?)`)
          .run(crypto.randomBytes(16).toString('hex'), pipe.id, e.nome, e.cor, e.ordem, e.is_ganho, e.is_perdido, e.probabilidade);
        console.log(`[Seed] Etapa "${e.nome}" adicionada ao pipeline ${pipe.id}`);
      }
    }
    // Corrige ordem das etapas existentes para respeitar a nova sequência
    for (const e of ETAPAS_PADRAO) {
      if (nomesExist.has(e.nome)) {
        db.prepare(`UPDATE etapas SET ordem=?, cor=? WHERE pipeline_id=? AND nome=?`)
          .run(e.ordem, e.cor, pipe.id, e.nome);
      }
    }
  }
  console.log('[Seed] Etapas padrão verificadas em todos os funis comerciais (SQLite).');
}

// Garante as etapas padrão (incl. Em Tratativa) em todos os funis comerciais — sem duplicar (Supabase)
async function _seedEtapasPadrao_Supa(sb) {
  const { data: funisComerciais } = await sb.from('funis')
    .select('id,nome').eq('ativo', 1);
  const funisAlvo = (funisComerciais||[]).filter(f => !f.nome.includes('Carteira Recorrente'));
  const agora = new Date().toISOString();
  for (const funil of funisAlvo) {
    const { data: pipes } = await sb.from('pipelines').select('id').eq('funil_id', funil.id).limit(1);
    if (!pipes?.length) continue;
    const pipeId = pipes[0].id;
    const { data: etapasExist } = await sb.from('etapas').select('id,nome,ordem,cor,ativo,oculta').eq('pipeline_id', pipeId);
    const nomesExist = new Set((etapasExist||[]).map(e => e.nome));
    for (const e of ETAPAS_PADRAO) {
      if (!nomesExist.has(e.nome)) {
        // Etapa não existe — cria
        await sb.from('etapas').insert({
          id: crypto.randomBytes(16).toString('hex'),
          pipeline_id: pipeId,
          nome: e.nome, cor: e.cor, ordem: e.ordem,
          is_ganho: e.is_ganho, is_perdido: e.is_perdido, probabilidade: e.probabilidade,
          ativo: 1, oculta: false,
        });
        console.log(`[Seed Supa] Etapa "${e.nome}" adicionada ao pipeline ${pipeId}`);
      } else {
        // Etapa existe — corrige ordem/cor e garante que está visível
        const existente = (etapasExist||[]).find(et => et.nome === e.nome);
        if (existente) {
          const precisaAtualizar =
            existente.ordem !== e.ordem ||
            existente.cor   !== e.cor   ||
            existente.ativo == 0        ||  // estava inativa
            existente.oculta === true;      // estava oculta
          if (precisaAtualizar) {
            await sb.from('etapas')
              .update({ ordem: e.ordem, cor: e.cor, ativo: 1, oculta: false, atualizado_em: agora })
              .eq('id', existente.id);
            if (existente.ativo == 0 || existente.oculta) {
              console.log(`[Seed Supa] Etapa "${e.nome}" reativada no pipeline ${pipeId}`);
            }
          }
        }
      }
    }
  }
  console.log('[Seed Supa] Etapas padrão verificadas em todos os funis comerciais.');
}

// GET /api/funis  (?somente_ativos=true para áreas operacionais)
async function listar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const somenteAtivos = req.query.somente_ativos === 'true';
  try {
    if (isSupa) {
      let q = sb.from('funis').select('*').order('criado_em');
      if (somenteAtivos) q = q.eq('ativo', 1);
      const { data, error } = await q;
      if (error) throw error;
      return res.json({ sucesso:true, dados:data||[], total:(data||[]).length });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const filtroAtivo = somenteAtivos ? ' WHERE f.ativo=1' : '';
    const funis = db.prepare(`SELECT f.*, p.id as pipeline_id FROM funis f LEFT JOIN pipelines p ON p.funil_id=f.id${filtroAtivo} ORDER BY f.criado_em`).all();
    return res.json({ sucesso:true, dados:funis, total:funis.length });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}


// GET /api/funis/:id  — retorna funil + pipeline_id + etapas (usado pela pipeline)
async function buscarPorId(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      const { data: funil, error } = await sb.from('funis').select('*').eq('id', req.params.id).single();
      if (error || !funil) return res.status(404).json({ sucesso:false, erro:'Funil não encontrado.' });
      // Busca pipeline vinculada ao funil (sem .single() para evitar erro se não existir)
      const { data: pipes } = await sb.from('pipelines').select('id').eq('funil_id', req.params.id).order('criado_em').limit(1);
      const pipelineId = pipes?.[0]?.id || null;
      // Busca etapas da pipeline
      let etapas = [];
      if (pipelineId) {
        const { data: etapasData } = await sb.from('etapas').select('*')
          .eq('pipeline_id', pipelineId)
          .eq('ativo', 1)
          .eq('oculta', false)
          .order('ordem');
        etapas = etapasData || [];
      }
      // Filtra etapas removidas: Carteira Recorrente e globais (Tratativa)
      const isCarteira = /carteira\s*recorrente/i.test(funil.nome || '');
      if (isCarteira) {
        etapas = etapas.filter(e => !ETAPAS_CARTEIRA_REMOVIDAS.includes(e.nome));
      }
      etapas = etapas.filter(e => !ETAPAS_GLOBAIS_REMOVIDAS.includes(e.nome));
      return res.json({ sucesso:true, dados:{ ...funil, pipeline_id: pipelineId, etapas } });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const funil = db.prepare(`SELECT f.*, p.id as pipeline_id FROM funis f LEFT JOIN pipelines p ON p.funil_id=f.id WHERE f.id=?`).get(req.params.id);
    if (!funil) return res.status(404).json({ sucesso:false, erro:'Funil não encontrado.' });
    let etapas = db.prepare(`SELECT e.* FROM etapas e JOIN pipelines p ON e.pipeline_id=p.id WHERE p.funil_id=? AND e.ativo=1 AND (e.oculta IS NULL OR e.oculta=0) ORDER BY e.ordem`).all(req.params.id);
    // Filtra etapas removidas: Carteira Recorrente e globais (Tratativa)
    const isCarteira = /carteira\s*recorrente/i.test(funil.nome || '');
    if (isCarteira) {
      etapas = etapas.filter(e => !ETAPAS_CARTEIRA_REMOVIDAS.includes(e.nome));
    }
    etapas = etapas.filter(e => !ETAPAS_GLOBAIS_REMOVIDAS.includes(e.nome));
    return res.json({ sucesso:true, dados:{ ...funil, etapas } });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// POST /api/funis
async function criar(req, res) {
  const { sb, isSupa } = getProvider();
  const { nome, cor='#6CFF4E', descricao } = req.body;
  if (!nome) return res.status(400).json({ sucesso:false, erro:'Nome é obrigatório.' });
  const funilId    = crypto.randomBytes(16).toString('hex');
  const pipelineId = crypto.randomBytes(16).toString('hex');
  try {
    if (isSupa) {
      const { data, error } = await sb.from('funis').insert({ id:funilId, nome:nome.trim(), cor, descricao:descricao||null, ativo:1 }).select().single();
      if (error) throw error;
      // Cria pipeline vinculada ao funil
      await sb.from('pipelines').insert({ id:pipelineId, funil_id:funilId, nome:`Pipeline - ${nome.trim()}`, ordem:0, ativo:1 });
      // Cria etapas vinculadas à pipeline (pipeline_id), NÃO ao funil
      for (const e of ETAPAS_PADRAO) {
        await sb.from('etapas').insert({ id:crypto.randomBytes(16).toString('hex'), pipeline_id:pipelineId, nome:e.nome, cor:e.cor, ordem:e.ordem, is_ganho:e.is_ganho, is_perdido:e.is_perdido, probabilidade:e.probabilidade });
      }
      req.log({ acao:'CREATE', entidade:'funis', entidade_id:funilId, depois:{ nome, cor } });
      return res.status(201).json({ sucesso:true, dados:data });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    // pipelineId already declared above, reuse it
    db.prepare(`INSERT INTO funis (id,nome,cor,descricao,ativo,criado_por) VALUES (?,?,?,?,1,?)`).run(funilId,nome.trim(),cor,descricao||null,req.usuario.id);
    db.prepare(`INSERT INTO pipelines (id,funil_id,nome,ordem,ativo,criado_por) VALUES (?,?,?,0,1,?)`).run(pipelineId,funilId,`Pipeline - ${nome.trim()}`,req.usuario.id);
    ETAPAS_PADRAO.forEach(e => { db.prepare(`INSERT INTO etapas (id,pipeline_id,nome,cor,ordem,is_ganho,is_perdido,probabilidade,criado_por) VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomBytes(16).toString('hex'),pipelineId,e.nome,e.cor,e.ordem,e.is_ganho,e.is_perdido,e.probabilidade,req.usuario.id); });
    req.log({ acao:'CREATE', entidade:'funis', entidade_id:funilId, depois:{ nome, cor } });
    return res.status(201).json({ sucesso:true, dados: db.prepare(`SELECT f.*, p.id as pipeline_id FROM funis f LEFT JOIN pipelines p ON p.funil_id=f.id WHERE f.id=?`).get(funilId) });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// PATCH /api/funis/:id
async function atualizar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  try {
    if (isSupa) {
      const upd = { atualizado_em: new Date().toISOString() };
      if (req.body.nome !== undefined)  upd.nome  = req.body.nome.trim();
      if (req.body.cor  !== undefined)  upd.cor   = req.body.cor;
      if (req.body.ativo !== undefined) upd.ativo = req.body.ativo ? 1 : 0;
      if (req.body.descricao !== undefined) upd.descricao = req.body.descricao;
      const { data, error } = await sb.from('funis').update(upd).eq('id', id).select().single();
      if (error) throw error;
      return res.json({ sucesso:true, dados:data });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const atual = db.prepare('SELECT * FROM funis WHERE id=?').get(id);
    if (!atual) return res.status(404).json({ sucesso:false, erro:'Funil não encontrado.' });
    const campos = { atualizado_em: new Date().toISOString() };
    if (req.body.nome !== undefined)  campos.nome  = req.body.nome.trim();
    if (req.body.cor  !== undefined)  campos.cor   = req.body.cor;
    if (req.body.ativo !== undefined) campos.ativo = req.body.ativo ? 1 : 0;
    if (req.body.descricao !== undefined) campos.descricao = req.body.descricao;
    const sets = Object.keys(campos).map(k=>`${k}=?`).join(',');
    db.prepare(`UPDATE funis SET ${sets} WHERE id=?`).run(...Object.values(campos), id);
    return res.json({ sucesso:true, dados: db.prepare('SELECT * FROM funis WHERE id=?').get(id) });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// DELETE /api/funis/:id
async function deletar(req, res) {
  const { sb, isSupa } = getProvider();
  try {
    if (isSupa) {
      await sb.from('funis').update({ ativo:0, atualizado_em: new Date().toISOString() }).eq('id', req.params.id);
      return res.json({ sucesso:true, mensagem:'Funil desativado.' });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    db.prepare("UPDATE funis SET ativo=0, atualizado_em=? WHERE id=?").run(new Date().toISOString(), req.params.id);
    return res.json({ sucesso:true, mensagem:'Funil desativado.' });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

module.exports = { listar, buscarPorId, criar, atualizar, deletar, seedFunis, ETAPAS_CARTEIRA_REMOVIDAS, ETAPAS_GLOBAIS_REMOVIDAS };


