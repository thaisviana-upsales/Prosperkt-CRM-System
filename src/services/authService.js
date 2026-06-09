/**
 * PROSPEKT CRM — Auth Service
 * JWT access token + refresh token com rotação automática.
 * Suporta Supabase e SQLite via getProvider().
 */

const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

const ACCESS_SECRET   = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET  = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES  = process.env.JWT_ACCESS_EXPIRES  || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

function gerarAccessToken(usuario) {
  return jwt.sign({ sub:usuario.id, nome:usuario.nome, role:usuario.role, type:'access' }, ACCESS_SECRET, { expiresIn:ACCESS_EXPIRES });
}

function gerarRefreshToken(usuario) {
  return jwt.sign({ sub:usuario.id, type:'refresh', jti:crypto.randomBytes(16).toString('hex') }, REFRESH_SECRET, { expiresIn:REFRESH_EXPIRES });
}

// ── User operations — async para suportar Supabase ────────────────────────────

async function buscarUsuarioPorEmail(email) {
  const { getProvider } = require('../database/dbProvider');
  const { sb, isSupa, sqlite } = getProvider();
  if (isSupa) {
    const { data } = await sb.from('usuarios').select('*').eq('email', email).eq('ativo', 1).single();
    return data || null;
  }
  return sqlite.prepare('SELECT * FROM usuarios WHERE email=? AND ativo=1').get(email);
}

async function buscarUsuarioPorId(id) {
  const { getProvider } = require('../database/dbProvider');
  const { sb, isSupa, sqlite } = getProvider();
  if (isSupa) {
    const { data } = await sb.from('usuarios').select('id,nome,email,role,ativo,criado_em').eq('id', id).eq('ativo', 1).single();
    return data || null;
  }
  return sqlite.prepare('SELECT id,nome,email,role,ativo,avatar_url,criado_em FROM usuarios WHERE id=? AND ativo=1').get(id);
}

async function verificarSenha(senhaPlain, hash) {
  return bcrypt.compare(senhaPlain, hash);
}

// ── Refresh token persistence ─────────────────────────────────────────────────

async function salvarRefreshToken(usuarioId, token, ip, ua) {
  const { getProvider } = require('../database/dbProvider');
  const { sb, isSupa, sqlite } = getProvider();
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000).toISOString();
  const id = crypto.randomBytes(16).toString('hex');
  if (isSupa) {
    await sb.from('refresh_tokens').insert({ id, usuario_id:usuarioId, token_hash:hash, expira_em:expiresAt });
  } else {
    sqlite.prepare(`INSERT INTO refresh_tokens (id,usuario_id,token_hash,expires_at,ip_address,user_agent) VALUES (?,?,?,?,?,?)`).run(id,usuarioId,hash,expiresAt,ip||null,ua||null);
  }
}

async function validarRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET);
    if (decoded.type !== 'refresh') return null;
    const { getProvider } = require('../database/dbProvider');
    const { sb, isSupa, sqlite } = getProvider();
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    if (isSupa) {
      const { data } = await sb.from('refresh_tokens').select('id').eq('token_hash', hash).gt('expira_em', new Date().toISOString()).single();
      if (!data) return null;
      await sb.from('refresh_tokens').delete().eq('token_hash', hash);
    } else {
      const reg = sqlite.prepare(`SELECT * FROM refresh_tokens WHERE token_hash=? AND datetime(expires_at)>datetime('now')`).get(hash);
      if (!reg) return null;
      sqlite.prepare('DELETE FROM refresh_tokens WHERE token_hash=?').run(hash);
    }
    return decoded;
  } catch { return null; }
}

async function revogarTodosTokens(usuarioId) {
  const { getProvider } = require('../database/dbProvider');
  const { sb, isSupa, sqlite } = getProvider();
  if (isSupa) await sb.from('refresh_tokens').delete().eq('usuario_id', usuarioId);
  else sqlite.prepare('DELETE FROM refresh_tokens WHERE usuario_id=?').run(usuarioId);
}

// ── Cookie helpers ────────────────────────────────────────────────────────────
const COOKIE_OPTIONS = { httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:'strict', maxAge:7*24*60*60*1000, path:'/' };
function setRefreshCookie(res, token) { res.cookie('pkt_refresh', token, COOKIE_OPTIONS); }
function clearRefreshCookie(res) { res.clearCookie('pkt_refresh', { path:'/' }); }

module.exports = { gerarAccessToken, gerarRefreshToken, salvarRefreshToken, validarRefreshToken, revogarTodosTokens, buscarUsuarioPorEmail, buscarUsuarioPorId, verificarSenha, setRefreshCookie, clearRefreshCookie };
