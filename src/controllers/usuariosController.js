/**
 * PROSPERKT CRM — Users Controller
 * CRUD de usuários com permissões RBAC reais
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../database/db');
const { registrarLog } = require('../services/auditService');

// Campos públicos (sem senha_hash)
const CAMPOS_PUBLICOS = 'id, nome, email, role, ativo, avatar_url, criado_em, atualizado_em';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usuarios
// SUPER_ADMIN: todos; GESTOR: todos; VENDEDOR: apenas ele mesmo
// ─────────────────────────────────────────────────────────────────────────────
function listar(req, res) {
  const db = getDb();
  const { role } = req.usuario;
  let usuarios;

  if (role === 'VENDEDOR') {
    usuarios = db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = ?`).all(req.usuario.id);
  } else {
    usuarios = db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios ORDER BY nome`).all();
  }

  return res.json({ sucesso: true, dados: usuarios, total: usuarios.length });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usuarios/:id
// ─────────────────────────────────────────────────────────────────────────────
function buscarPorId(req, res) {
  const db = getDb();
  const { id } = req.params;
  const { role, id: meId } = req.usuario;

  // VENDEDOR só pode ver a si mesmo
  if (role === 'VENDEDOR' && id !== meId) {
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
  }

  const usuario = db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = ?`).get(id);
  if (!usuario) {
    return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
  }

  return res.json({ sucesso: true, dados: usuario });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/usuarios — Somente SUPER_ADMIN e GESTOR
// ─────────────────────────────────────────────────────────────────────────────
async function criar(req, res) {
  const db = getDb();
  const { nome, email, senha, role = 'VENDEDOR' } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ sucesso: false, erro: 'nome, email e senha são obrigatórios.' });
  }

  // GESTOR não pode criar SUPER_ADMIN
  if (req.usuario.role === 'GESTOR' && role === 'SUPER_ADMIN') {
    return res.status(403).json({ sucesso: false, erro: 'GESTOR não pode criar SUPER_ADMIN.' });
  }

  const roles = ['SUPER_ADMIN', 'GESTOR', 'VENDEDOR'];
  if (!roles.includes(role)) {
    return res.status(400).json({ sucesso: false, erro: `Role inválida. Use: ${roles.join(', ')}` });
  }

  const emailNorm = email.toLowerCase().trim();
  const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(emailNorm);
  if (existente) {
    return res.status(409).json({ sucesso: false, erro: 'Email já está em uso.' });
  }

  const id   = crypto.randomBytes(16).toString('hex');
  const hash = await bcrypt.hash(senha, 12);

  db.prepare(`
    INSERT INTO usuarios (id, nome, email, senha_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, nome.trim(), emailNorm, hash, role);

  const criado = db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = ?`).get(id);

  req.log({
    acao: 'CREATE',
    entidade: 'usuarios',
    entidade_id: id,
    depois: { nome, email: emailNorm, role },
  });

  return res.status(201).json({ sucesso: true, dados: criado });
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/usuarios/:id
// ─────────────────────────────────────────────────────────────────────────────
async function atualizar(req, res) {
  const db = getDb();
  const { id } = req.params;
  const { role: roleAtual, id: meId } = req.usuario;

  // VENDEDOR só pode editar a si mesmo e não pode mudar role
  if (roleAtual === 'VENDEDOR' && id !== meId) {
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
  }

  const atual = db.prepare(`SELECT * FROM usuarios WHERE id = ?`).get(id);
  if (!atual) {
    return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
  }

  const campos = {};
  if (req.body.nome)  campos.nome  = req.body.nome.trim();
  if (req.body.email) campos.email = req.body.email.toLowerCase().trim();
  if (req.body.avatar_url !== undefined) campos.avatar_url = req.body.avatar_url;

  // Mudança de role — somente SUPER_ADMIN
  if (req.body.role) {
    if (roleAtual !== 'SUPER_ADMIN') {
      return res.status(403).json({ sucesso: false, erro: 'Apenas SUPER_ADMIN pode mudar roles.' });
    }
    campos.role = req.body.role;
  }

  // Mudança de status ativo — GESTOR e SUPER_ADMIN
  if (req.body.ativo !== undefined) {
    if (roleAtual === 'VENDEDOR') {
      return res.status(403).json({ sucesso: false, erro: 'Sem permissão para alterar status.' });
    }
    campos.ativo = req.body.ativo ? 1 : 0;
  }

  // Mudança de senha
  if (req.body.senha) {
    campos.senha_hash = await bcrypt.hash(req.body.senha, 12);
  }

  if (Object.keys(campos).length === 0) {
    return res.status(400).json({ sucesso: false, erro: 'Nenhum campo para atualizar.' });
  }

  campos.atualizado_em = new Date().toISOString();

  const sets  = Object.keys(campos).map(k => `${k} = ?`).join(', ');
  const vals  = [...Object.values(campos), id];
  db.prepare(`UPDATE usuarios SET ${sets} WHERE id = ?`).run(...vals);

  const atualizado = db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = ?`).get(id);

  const antes = { ...atual };
  delete antes.senha_hash;

  req.log({
    acao: 'UPDATE',
    entidade: 'usuarios',
    entidade_id: id,
    antes,
    depois: atualizado,
  });

  return res.json({ sucesso: true, dados: atualizado });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/usuarios/:id — Somente SUPER_ADMIN
// ─────────────────────────────────────────────────────────────────────────────
function deletar(req, res) {
  const db = getDb();
  const { id } = req.params;

  if (id === req.usuario.id) {
    return res.status(400).json({ sucesso: false, erro: 'Você não pode deletar sua própria conta.' });
  }

  const usuario = db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = ?`).get(id);
  if (!usuario) {
    return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
  }

  // Soft delete (desativa) em vez de deletar permanentemente
  db.prepare('UPDATE usuarios SET ativo = 0, atualizado_em = ? WHERE id = ?')
    .run(new Date().toISOString(), id);

  req.log({
    acao: 'DELETE',
    entidade: 'usuarios',
    entidade_id: id,
    antes: usuario,
  });

  return res.json({ sucesso: true, mensagem: 'Usuário desativado com sucesso.' });
}

module.exports = { listar, buscarPorId, criar, atualizar, deletar };
