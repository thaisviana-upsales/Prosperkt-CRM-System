/**
 * PROSPEKT CRM — Produtos Controller
 * CRUD de produtos (vinculados a vendas/leads)
 * Supabase quando DATABASE_PROVIDER=supabase, SQLite caso contrário.
 *
 * REGRAS:
 *   - Vendedores NÃO podem criar/editar/deletar produtos (exigirRole GESTOR+ na rota)
 *   - Apenas produtos ativos aparecem no select de venda
 *   - GET /api/produtos retorna por ordem/nome
 *   - Seed automático dos produtos oficiais ao iniciar servidor
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

// Cor padrão gerada por hash do nome (garante consistência)
function corPorNome(nome) {
  const cores = [
    '#6CFF4E','#3B8BFF','#FF6B6B','#FFD93D','#C77DFF',
    '#06D6A0','#FF9F1C','#2EC4B6','#E71D36','#FF4D6D',
    '#4CC9F0','#F72585','#7209B7','#3A0CA3','#4361EE',
  ];
  let hash = 0;
  for (let i = 0; i < nome.length; i++) hash = (hash * 31 + nome.charCodeAt(i)) & 0xffffffff;
  return cores[Math.abs(hash) % cores.length];
}

// GET /api/produtos — retorna apenas ativos, ordenados por ordem/nome
async function listar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      // Tenta com campos extras; fallback sem eles se coluna não existir ainda
      let { data, error } = await sb.from('produtos')
        .select('id, nome, categoria, descricao, cor, ordem, ativo, criado_em, atualizado_em')
        .eq('ativo', true)
        .order('ordem', { ascending: true, nullsFirst: false })
        .order('nome', { ascending: true });
      if (error) {
        // Fallback sem colunas extras (patch v10 não rodou ainda)
        const r2 = await sb.from('produtos').select('*').eq('ativo', true).order('nome');
        if (r2.error) throw r2.error;
        data = r2.data;
      }
      return res.json({ sucesso: true, dados: data || [] });
    }
    // SQLite fallback
    ensureTable(sqlite);
    let rows;
    try {
      rows = sqlite.prepare('SELECT * FROM produtos WHERE ativo=1 ORDER BY ordem ASC, nome ASC').all();
    } catch {
      rows = sqlite.prepare('SELECT * FROM produtos WHERE ativo=1 ORDER BY nome ASC').all();
    }
    return res.json({ sucesso: true, dados: rows });
  } catch (e) {
    console.error('[produtos.listar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// GET /api/produtos/todos — GESTOR+ vê todos incluindo inativos
async function listarTodos(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      const { data, error } = await sb.from('produtos')
        .select('id, nome, categoria, descricao, cor, ordem, ativo, criado_em, atualizado_em')
        .order('ordem', { ascending: true, nullsFirst: false })
        .order('nome', { ascending: true });
      if (error) throw error;
      return res.json({ sucesso: true, dados: data || [] });
    }
    ensureTable(sqlite);
    const rows = sqlite.prepare('SELECT * FROM produtos ORDER BY ordem ASC, nome ASC').all();
    return res.json({ sucesso: true, dados: rows });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// POST /api/produtos — cria ou retorna existente (upsert por nome)
async function criar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { nome, cor, categoria, descricao, ordem } = req.body;
  if (!nome?.trim()) return res.status(400).json({ sucesso: false, erro: 'Nome é obrigatório.' });

  const nomeNorm = nome.trim();
  const corFinal = cor || corPorNome(nomeNorm);
  const id = crypto.randomBytes(16).toString('hex');
  const agora = new Date().toISOString();

  try {
    if (isSupa) {
      // Tenta buscar existente pelo nome (case-insensitive)
      const { data: exist } = await sb.from('produtos')
        .select('*').ilike('nome', nomeNorm).eq('ativo', true).maybeSingle();
      if (exist) return res.json({ sucesso: true, dados: exist, existente: true });

      const row = { id, nome: nomeNorm, cor: corFinal, ativo: true, criado_em: agora, atualizado_em: agora };
      if (categoria !== undefined) row.categoria = categoria || null;
      if (descricao !== undefined) row.descricao = descricao || null;
      if (ordem !== undefined)     row.ordem = Number(ordem) || 0;

      const { data, error } = await sb.from('produtos').insert(row).select().single();
      if (error) throw error;
      return res.status(201).json({ sucesso: true, dados: data });
    }
    // SQLite
    ensureTable(sqlite);
    const exist = sqlite.prepare('SELECT * FROM produtos WHERE LOWER(nome)=LOWER(?) AND ativo=1').get(nomeNorm);
    if (exist) return res.json({ sucesso: true, dados: exist, existente: true });

    try {
      sqlite.prepare(`
        INSERT INTO produtos (id,nome,categoria,descricao,cor,ordem,ativo,criado_em,atualizado_em)
        VALUES (?,?,?,?,?,?,1,?,?)
      `).run(id, nomeNorm, categoria||null, descricao||null, corFinal, Number(ordem)||0, agora, agora);
    } catch {
      // Fallback sem colunas extras
      sqlite.prepare('INSERT INTO produtos (id,nome,cor,ativo,criado_em,atualizado_em) VALUES (?,?,?,1,?,?)')
        .run(id, nomeNorm, corFinal, agora, agora);
    }
    return res.status(201).json({ sucesso: true, dados: sqlite.prepare('SELECT * FROM produtos WHERE id=?').get(id) });
  } catch (e) {
    console.error('[produtos.criar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// PATCH /api/produtos/:id — somente GESTOR+ (controlado na rota)
async function atualizar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { nome, cor, ativo, categoria, descricao, ordem } = req.body;
  try {
    if (isSupa) {
      const upd = { atualizado_em: new Date().toISOString() };
      if (nome      !== undefined) upd.nome      = nome.trim();
      if (cor       !== undefined) upd.cor        = cor;
      if (ativo     !== undefined) upd.ativo      = ativo;
      if (categoria !== undefined) upd.categoria  = categoria || null;
      if (descricao !== undefined) upd.descricao  = descricao || null;
      if (ordem     !== undefined) upd.ordem      = Number(ordem) || 0;
      const { data, error } = await sb.from('produtos').update(upd).eq('id', req.params.id).select().single();
      if (error) throw error;
      return res.json({ sucesso: true, dados: data });
    }
    ensureTable(sqlite);
    const sets = [];
    const vals = [];
    if (nome      !== undefined) { sets.push('nome=?');      vals.push(nome.trim()); }
    if (cor       !== undefined) { sets.push('cor=?');       vals.push(cor); }
    if (ativo     !== undefined) { sets.push('ativo=?');     vals.push(ativo ? 1 : 0); }
    if (categoria !== undefined) { sets.push('categoria=?'); vals.push(categoria||null); }
    if (descricao !== undefined) { sets.push('descricao=?'); vals.push(descricao||null); }
    if (ordem     !== undefined) { sets.push('ordem=?');     vals.push(Number(ordem)||0); }
    sets.push('atualizado_em=?'); vals.push(new Date().toISOString());
    sqlite.prepare(`UPDATE produtos SET ${sets.join(',')} WHERE id=?`).run(...vals, req.params.id);
    return res.json({ sucesso: true, dados: sqlite.prepare('SELECT * FROM produtos WHERE id=?').get(req.params.id) });
  } catch (e) {
    console.error('[produtos.atualizar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// DELETE /api/produtos/:id (soft delete — nunca apaga de verdade)
async function deletar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      const { error } = await sb.from('produtos').update({ ativo: false, atualizado_em: new Date().toISOString() }).eq('id', req.params.id);
      if (error) throw error;
      return res.json({ sucesso: true });
    }
    ensureTable(sqlite);
    sqlite.prepare('UPDATE produtos SET ativo=0, atualizado_em=? WHERE id=?').run(new Date().toISOString(), req.params.id);
    return res.json({ sucesso: true });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// Garante tabela produtos no SQLite (caso não exista)
function ensureTable(sqlite) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS produtos (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL UNIQUE,
    categoria TEXT,
    descricao TEXT,
    cor TEXT DEFAULT '#6CFF4E',
    ordem INTEGER DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    criado_em TEXT,
    atualizado_em TEXT
  )`);
}

// ── Seed automático dos produtos oficiais ────────────────────────────────────
// Roda na inicialização do servidor — idempotente, não duplica
let _seedRodou = false;
async function rodarSeedProdutos() {
  if (_seedRodou) return;
  _seedRodou = true;
  try {
    const { seedProdutos } = require('../seeds/seed-produtos-oficiais');
    const { getProvider: gp } = require('../database/dbProvider');
    const provider = gp();
    await seedProdutos(provider);
  } catch (e) {
    console.warn('[SEED_PRODUTOS] Seed de produtos oficiais não executado:', e.message);
  }
}

module.exports = { listar, listarTodos, criar, atualizar, deletar, rodarSeedProdutos };
