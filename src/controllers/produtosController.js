/**
 * PROSPEKT CRM — Produtos Controller
 * CRUD de produtos (vinculados a vendas/leads)
 * Supabase quando DATABASE_PROVIDER=supabase, SQLite caso contrário.
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

// GET /api/produtos
async function listar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      const { data, error } = await sb.from('produtos').select('*').eq('ativo', true).order('nome');
      if (error) throw error;
      return res.json({ sucesso: true, dados: data || [] });
    }
    // SQLite fallback
    ensureTable(sqlite);
    const rows = sqlite.prepare("SELECT * FROM produtos WHERE ativo=1 ORDER BY nome").all();
    return res.json({ sucesso: true, dados: rows });
  } catch (e) {
    console.error('[produtos.listar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// POST /api/produtos — cria ou retorna existente (upsert por nome)
async function criar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { nome, cor } = req.body;
  if (!nome?.trim()) return res.status(400).json({ sucesso: false, erro: 'Nome é obrigatório.' });

  const nomeNorm = nome.trim();
  const corFinal = cor || corPorNome(nomeNorm);
  const id = crypto.randomBytes(16).toString('hex');

  try {
    if (isSupa) {
      // Tenta buscar existente pelo nome (case-insensitive)
      const { data: exist } = await sb.from('produtos')
        .select('*').ilike('nome', nomeNorm).eq('ativo', true).maybeSingle();
      if (exist) return res.json({ sucesso: true, dados: exist, existente: true });

      const { data, error } = await sb.from('produtos')
        .insert({ id, nome: nomeNorm, cor: corFinal, ativo: true, criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
        .select().single();
      if (error) throw error;
      return res.status(201).json({ sucesso: true, dados: data });
    }
    // SQLite
    ensureTable(sqlite);
    const exist = sqlite.prepare("SELECT * FROM produtos WHERE LOWER(nome)=LOWER(?) AND ativo=1").get(nomeNorm);
    if (exist) return res.json({ sucesso: true, dados: exist, existente: true });
    sqlite.prepare("INSERT INTO produtos (id,nome,cor,ativo,criado_em,atualizado_em) VALUES (?,?,?,1,?,?)")
      .run(id, nomeNorm, corFinal, new Date().toISOString(), new Date().toISOString());
    return res.status(201).json({ sucesso: true, dados: sqlite.prepare("SELECT * FROM produtos WHERE id=?").get(id) });
  } catch (e) {
    console.error('[produtos.criar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// PATCH /api/produtos/:id
async function atualizar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { nome, cor, ativo } = req.body;
  try {
    if (isSupa) {
      const upd = { atualizado_em: new Date().toISOString() };
      if (nome !== undefined) upd.nome = nome.trim();
      if (cor !== undefined) upd.cor = cor;
      if (ativo !== undefined) upd.ativo = ativo;
      const { data, error } = await sb.from('produtos').update(upd).eq('id', req.params.id).select().single();
      if (error) throw error;
      return res.json({ sucesso: true, dados: data });
    }
    ensureTable(sqlite);
    const sets = [];
    const vals = [];
    if (nome !== undefined) { sets.push('nome=?'); vals.push(nome.trim()); }
    if (cor !== undefined) { sets.push('cor=?'); vals.push(cor); }
    if (ativo !== undefined) { sets.push('ativo=?'); vals.push(ativo ? 1 : 0); }
    sets.push('atualizado_em=?'); vals.push(new Date().toISOString());
    sqlite.prepare(`UPDATE produtos SET ${sets.join(',')} WHERE id=?`).run(...vals, req.params.id);
    return res.json({ sucesso: true, dados: sqlite.prepare("SELECT * FROM produtos WHERE id=?").get(req.params.id) });
  } catch (e) {
    console.error('[produtos.atualizar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// DELETE /api/produtos/:id (soft delete)
async function deletar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      const { error } = await sb.from('produtos').update({ ativo: false, atualizado_em: new Date().toISOString() }).eq('id', req.params.id);
      if (error) throw error;
      return res.json({ sucesso: true });
    }
    ensureTable(sqlite);
    sqlite.prepare("UPDATE produtos SET ativo=0, atualizado_em=? WHERE id=?").run(new Date().toISOString(), req.params.id);
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
    cor TEXT DEFAULT '#6CFF4E',
    ativo INTEGER DEFAULT 1,
    criado_em TEXT,
    atualizado_em TEXT
  )`);
}

module.exports = { listar, criar, atualizar, deletar };
