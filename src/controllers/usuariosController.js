/**
 * PROSPERKT CRM — Users Controller
 * CRUD de usuários com permissões RBAC reais.
 * Supabase JS nativo ou SQLite conforme DATABASE_PROVIDER.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');
const { registrarLog } = require('../services/auditService');

const CAMPOS_PUBLICOS_SUPA = 'id, nome, email, role, ativo, avatar_url, criado_em, atualizado_em';


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usuarios
// SUPER_ADMIN / GESTOR: todos; VENDEDOR: apenas ele mesmo
// ─────────────────────────────────────────────────────────────────────────────
async function listar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      let q = sb.from('usuarios').select(CAMPOS_PUBLICOS_SUPA).order('nome');
      if (req.usuario.role === 'VENDEDOR') q = q.eq('id', req.usuario.id);
      const { data, error } = await q;
      if (error) throw error;
      return res.json({ sucesso: true, dados: data || [], total: (data || []).length });
    }
    // SQLite
    const { getDb } = require('../database/db');
    const db = getDb();
    const campos = 'id, nome, email, role, ativo, avatar_url, criado_em, atualizado_em';
    let usuarios;
    if (req.usuario.role === 'VENDEDOR') {
      usuarios = db.prepare(`SELECT ${campos} FROM usuarios WHERE id = ?`).all(req.usuario.id);
    } else {
      usuarios = db.prepare(`SELECT ${campos} FROM usuarios ORDER BY nome`).all();
    }
    return res.json({ sucesso: true, dados: usuarios, total: usuarios.length });
  } catch (e) {
    console.error('[usuarios.listar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usuarios/:id
// ─────────────────────────────────────────────────────────────────────────────
async function buscarPorId(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  if (req.usuario.role === 'VENDEDOR' && id !== req.usuario.id) {
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
  }
  try {
    if (isSupa) {
      const { data, error } = await sb.from('usuarios').select(CAMPOS_PUBLICOS_SUPA).eq('id', id).single();
      if (error || !data) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
      return res.json({ sucesso: true, dados: data });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const usuario = db.prepare('SELECT id,nome,email,role,ativo,avatar_url,criado_em,atualizado_em FROM usuarios WHERE id = ?').get(id);
    if (!usuario) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
    return res.json({ sucesso: true, dados: usuario });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/usuarios — Somente SUPER_ADMIN e GESTOR
// ─────────────────────────────────────────────────────────────────────────────
async function criar(req, res) {
  const { sb, isSupa } = getProvider();
  const { nome, email, senha, role = 'VENDEDOR' } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ sucesso: false, erro: 'nome, email e senha são obrigatórios.' });
  }
  if (req.usuario.role === 'GESTOR' && role === 'SUPER_ADMIN') {
    return res.status(403).json({ sucesso: false, erro: 'GESTOR não pode criar SUPER_ADMIN.' });
  }
  const roles = ['SUPER_ADMIN', 'GESTOR', 'VENDEDOR'];
  if (!roles.includes(role)) {
    return res.status(400).json({ sucesso: false, erro: `Role inválida. Use: ${roles.join(', ')}` });
  }

  const emailNorm = email.toLowerCase().trim();
  const id = crypto.randomBytes(16).toString('hex');
  const hash = await bcrypt.hash(senha, 12);

  try {
    if (isSupa) {
      // Verifica email duplicado
      const { data: dup } = await sb.from('usuarios').select('id').eq('email', emailNorm).limit(1);
      if (dup?.length) return res.status(409).json({ sucesso: false, erro: 'Email já está em uso.' });

      const { data, error } = await sb.from('usuarios').insert({
        id, nome: nome.trim(), email: emailNorm, senha_hash: hash, role, ativo: 1,
        criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
      }).select(CAMPOS_PUBLICOS_SUPA).single();
      if (error) throw error;
      req.log({ acao: 'CREATE', entidade: 'usuarios', entidade_id: id, depois: { nome, email: emailNorm, role } });
      return res.status(201).json({ sucesso: true, dados: data });
    }

    // SQLite
    const { getDb } = require('../database/db');
    const db = getDb();
    const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(emailNorm);
    if (existente) return res.status(409).json({ sucesso: false, erro: 'Email já está em uso.' });
    db.prepare('INSERT INTO usuarios (id, nome, email, senha_hash, role) VALUES (?, ?, ?, ?, ?)').run(id, nome.trim(), emailNorm, hash, role);
    const criado = db.prepare('SELECT id,nome,email,role,ativo,avatar_url,criado_em,atualizado_em FROM usuarios WHERE id = ?').get(id);
    req.log({ acao: 'CREATE', entidade: 'usuarios', entidade_id: id, depois: { nome, email: emailNorm, role } });
    return res.status(201).json({ sucesso: true, dados: criado });
  } catch (e) {
    console.error('[usuarios.criar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/usuarios/:id
// ─────────────────────────────────────────────────────────────────────────────
async function atualizar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  const { role: roleAtual, id: meId } = req.usuario;

  if (roleAtual === 'VENDEDOR' && id !== meId) {
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
  }

  try {
    if (isSupa) {
      const { data: atual, error: e0 } = await sb.from('usuarios').select('*').eq('id', id).single();
      if (e0 || !atual) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });

      const upd = { atualizado_em: new Date().toISOString() };
      if (req.body.nome)  upd.nome  = req.body.nome.trim();
      if (req.body.email) upd.email = req.body.email.toLowerCase().trim();
      if (req.body.avatar_url !== undefined) upd.avatar_url = req.body.avatar_url;
      if (req.body.role && roleAtual === 'SUPER_ADMIN') upd.role = req.body.role;
      if (req.body.ativo !== undefined && roleAtual !== 'VENDEDOR') upd.ativo = req.body.ativo ? 1 : 0;
      if (req.body.senha) upd.senha_hash = await bcrypt.hash(req.body.senha, 12);

      if (Object.keys(upd).length === 1) {
        return res.status(400).json({ sucesso: false, erro: 'Nenhum campo para atualizar.' });
      }

      const { data, error } = await sb.from('usuarios').update(upd).eq('id', id).select(CAMPOS_PUBLICOS_SUPA).single();
      if (error) throw error;
      req.log({ acao: 'UPDATE', entidade: 'usuarios', entidade_id: id, depois: upd });
      return res.json({ sucesso: true, dados: data });
    }

    // SQLite
    const { getDb } = require('../database/db');
    const db = getDb();
    const atual = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });

    const campos = {};
    if (req.body.nome)  campos.nome  = req.body.nome.trim();
    if (req.body.email) campos.email = req.body.email.toLowerCase().trim();
    if (req.body.avatar_url !== undefined) campos.avatar_url = req.body.avatar_url;
    if (req.body.role && roleAtual === 'SUPER_ADMIN') campos.role = req.body.role;
    if (req.body.ativo !== undefined && roleAtual !== 'VENDEDOR') campos.ativo = req.body.ativo ? 1 : 0;
    if (req.body.senha) campos.senha_hash = await bcrypt.hash(req.body.senha, 12);
    if (Object.keys(campos).length === 0) return res.status(400).json({ sucesso: false, erro: 'Nenhum campo para atualizar.' });

    campos.atualizado_em = new Date().toISOString();
    const sets = Object.keys(campos).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE usuarios SET ${sets} WHERE id = ?`).run(...Object.values(campos), id);
    const atualizado = db.prepare('SELECT id,nome,email,role,ativo,avatar_url,criado_em,atualizado_em FROM usuarios WHERE id = ?').get(id);
    req.log({ acao: 'UPDATE', entidade: 'usuarios', entidade_id: id, depois: atualizado });
    return res.json({ sucesso: true, dados: atualizado });
  } catch (e) {
    console.error('[usuarios.atualizar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/usuarios/:id — Somente SUPER_ADMIN (soft delete)
// ─────────────────────────────────────────────────────────────────────────────
async function deletar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  if (id === req.usuario.id) {
    return res.status(400).json({ sucesso: false, erro: 'Você não pode desativar sua própria conta.' });
  }
  try {
    if (isSupa) {
      const { data: u, error: e0 } = await sb.from('usuarios').select('id,nome').eq('id', id).single();
      if (e0 || !u) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
      await sb.from('usuarios').update({ ativo: 0, atualizado_em: new Date().toISOString() }).eq('id', id);
      req.log({ acao: 'DELETE', entidade: 'usuarios', entidade_id: id, antes: u });
      return res.json({ sucesso: true, mensagem: 'Usuário desativado com sucesso.' });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const usuario = db.prepare('SELECT id,nome FROM usuarios WHERE id = ?').get(id);
    if (!usuario) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
    db.prepare('UPDATE usuarios SET ativo = 0, atualizado_em = ? WHERE id = ?').run(new Date().toISOString(), id);
    req.log({ acao: 'DELETE', entidade: 'usuarios', entidade_id: id, antes: usuario });
    return res.json({ sucesso: true, mensagem: 'Usuário desativado com sucesso.' });
  } catch (e) {
    console.error('[usuarios.deletar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/usuarios/:id/avatar — salva avatar como data URL
// ─────────────────────────────────────────────────────────────────────────────
async function uploadAvatar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  const { role: roleAtual, id: meId } = req.usuario;

  // Vendedor só pode atualizar o próprio avatar
  if (roleAtual === 'VENDEDOR' && id !== meId) {
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
  }

  const { avatar_url } = req.body;
  if (!avatar_url) {
    return res.status(400).json({ sucesso: false, erro: 'Campo avatar_url é obrigatório.' });
  }

  // Valida formato: aceita data:image/... ou URL externa
  const isDataUrl = avatar_url.startsWith('data:image/');
  const isUrl = avatar_url.startsWith('http://') || avatar_url.startsWith('https://');
  const isEmpty = avatar_url === '';
  if (!isDataUrl && !isUrl && !isEmpty) {
    return res.status(400).json({ sucesso: false, erro: 'Formato de imagem inválido. Use JPG, PNG ou WEBP.' });
  }

  // Limita tamanho: data URL de 2MB ≈ ~2.7MB em base64
  if (avatar_url.length > 3_000_000) {
    return res.status(413).json({ sucesso: false, erro: 'Imagem muito grande. Máximo 2MB.' });
  }

  try {
    if (isSupa) {
      const { data, error } = await sb.from('usuarios')
        .update({ avatar_url: avatar_url || null, atualizado_em: new Date().toISOString() })
        .eq('id', id)
        .select(CAMPOS_PUBLICOS_SUPA)
        .single();
      if (error) throw error;
      return res.json({ sucesso: true, dados: data });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    db.prepare('UPDATE usuarios SET avatar_url = ?, atualizado_em = ? WHERE id = ?')
      .run(avatar_url || null, new Date().toISOString(), id);
    const atualizado = db.prepare('SELECT id,nome,email,role,ativo,avatar_url,criado_em,atualizado_em FROM usuarios WHERE id = ?').get(id);
    return res.json({ sucesso: true, dados: atualizado });
  } catch (e) {
    console.error('[usuarios.uploadAvatar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { listar, buscarPorId, criar, atualizar, deletar, uploadAvatar };

