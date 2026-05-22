/**
 * PROSPERKT CRM — Auth Service
 * JWT access token + refresh token com rotação automática
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../database/db');
require('dotenv').config();

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES  = process.env.JWT_ACCESS_EXPIRES  || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

// ─────────────────────────────────────────────────────────────────────────────
// Token generation
// ─────────────────────────────────────────────────────────────────────────────

function gerarAccessToken(usuario) {
  return jwt.sign(
    {
      sub:  usuario.id,
      nome: usuario.nome,
      role: usuario.role,
      type: 'access',
    },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  );
}

function gerarRefreshToken(usuario) {
  const token = jwt.sign(
    {
      sub:  usuario.id,
      type: 'refresh',
      jti:  crypto.randomBytes(16).toString('hex'), // único por emissão
    },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  );
  return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresh token persistence
// ─────────────────────────────────────────────────────────────────────────────

function salvarRefreshToken(usuarioId, token, ip, ua) {
  const db = getDb();
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  // Decode para pegar expiry
  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000).toISOString();
  const id = crypto.randomBytes(16).toString('hex');

  db.prepare(`
    INSERT INTO refresh_tokens (id, usuario_id, token_hash, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, usuarioId, hash, expiresAt, ip || null, ua || null);
}

function validarRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET);
    if (decoded.type !== 'refresh') return null;

    const db = getDb();
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const registro = db.prepare(`
      SELECT * FROM refresh_tokens
      WHERE token_hash = ?
      AND datetime(expires_at) > datetime('now')
    `).get(hash);

    if (!registro) return null;

    // Rotação: invalida o token atual
    db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(hash);

    return decoded;
  } catch {
    return null;
  }
}

function revogarTodosTokens(usuarioId) {
  const db = getDb();
  db.prepare('DELETE FROM refresh_tokens WHERE usuario_id = ?').run(usuarioId);
}

function limparTokensExpirados() {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM refresh_tokens WHERE datetime(expires_at) <= datetime('now')
  `).run();
  return result.changes;
}

// ─────────────────────────────────────────────────────────────────────────────
// User operations
// ─────────────────────────────────────────────────────────────────────────────

function buscarUsuarioPorEmail(email) {
  const db = getDb();
  return db.prepare('SELECT * FROM usuarios WHERE email = ? AND ativo = 1').get(email);
}

function buscarUsuarioPorId(id) {
  const db = getDb();
  return db.prepare('SELECT id, nome, email, role, ativo, avatar_url, criado_em FROM usuarios WHERE id = ? AND ativo = 1').get(id);
}

async function verificarSenha(senhaPlain, hash) {
  return bcrypt.compare(senhaPlain, hash);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie helpers
// ─────────────────────────────────────────────────────────────────────────────

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias em ms
  path: '/',
};

function setRefreshCookie(res, token) {
  res.cookie('pkt_refresh', token, COOKIE_OPTIONS);
}

function clearRefreshCookie(res) {
  res.clearCookie('pkt_refresh', { path: '/' });
}

module.exports = {
  gerarAccessToken,
  gerarRefreshToken,
  salvarRefreshToken,
  validarRefreshToken,
  revogarTodosTokens,
  limparTokensExpirados,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  verificarSenha,
  setRefreshCookie,
  clearRefreshCookie,
};
