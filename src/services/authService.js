/**
 * PROSPEKT CRM — Auth Service
 * JWT access token + refresh token com rotação automática.
 * Suporta Supabase e SQLite via getProvider().
 *
 * CORREÇÃO v4 (2026-06-26) — FIX DEFINITIVO:
 *  - buscarUsuarioPorEmail/Id: .eq('ativo',1) funciona (campo INTEGER no Supabase)
 *  - salvarRefreshToken: coluna Supabase é 'expires_at', não 'expira_em' — CAUSA DO BUG
 *  - validarRefreshToken: mesma correção de coluna
 *  - Sem refresh token salvo = sessão não renovável ao fechar/abrir CRM
 *  - Logs AUTH_ seguros sem expor credenciais, hash ou token
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
  const { sb, isSupa, sqlite, mode } = getProvider();
  const emailNorm = (email || '').toLowerCase().trim();
  console.log('[AUTH_LOGIN_START] buscarUsuarioPorEmail chamado');
  console.log('[AUTH_DB_PROVIDER]', mode || (isSupa ? 'supabase' : 'sqlite'));
  console.log('[AUTH_SUPABASE_ENABLED]', isSupa ? 'true' : 'false');
  console.log('[AUTH_SQLITE_FALLBACK_USED]', isSupa ? 'false' : 'true');
  if (isSupa) {
    // ativo é INTEGER no Supabase — .eq('ativo', 1) funciona corretamente
    const { data, error } = await sb
      .from('usuarios')
      .select('*')
      .eq('email', emailNorm)
      .eq('ativo', 1)
      .limit(1)
      .single();
    if (error && error.code !== 'PGRST116') {
      // PGRST116 = zero rows — não é erro crítico
      console.warn('[AUTH_USER_NOT_FOUND] Erro ao buscar usuário no Supabase:', error.code);
    }
    if (data) {
      console.log('[AUTH_USER_FOUND] Usuário localizado no Supabase | role:', data.role);
      console.log('[AUTH_DB_SOURCE] supabase | ativo_valor_no_banco:', typeof data.ativo, JSON.stringify(data.ativo));
    } else {
      console.warn('[AUTH_USER_NOT_FOUND] Usuário não encontrado ou inativo no Supabase | email verificado:', emailNorm);
    }
    return data || null;
  }
  const usuario = sqlite.prepare('SELECT * FROM usuarios WHERE email=? AND ativo=1').get(emailNorm);
  if (usuario) {
    console.log('[AUTH_USER_FOUND] Usuário localizado no SQLite');
  } else {
    console.warn('[AUTH_USER_NOT_FOUND] Usuário não encontrado ou inativo no SQLite');
  }
  return usuario || null;
}

async function buscarUsuarioPorId(id) {
  const { getProvider } = require('../database/dbProvider');
  const { sb, isSupa, sqlite } = getProvider();
  if (isSupa) {
    // ativo é INTEGER no Supabase — .eq('ativo', 1) funciona corretamente
    const { data, error } = await sb
      .from('usuarios')
      .select('id,nome,email,role,ativo,avatar_url,criado_em')
      .eq('id', id)
      .eq('ativo', 1)
      .limit(1)
      .single();
    if (error && error.code !== 'PGRST116') {
      console.warn('[AUTH_USER_NOT_FOUND] Erro ao buscar usuário por ID no Supabase:', error.code);
    }
    return data || null;
  }
  return sqlite.prepare('SELECT id,nome,email,role,ativo,avatar_url,criado_em FROM usuarios WHERE id=? AND ativo=1').get(id);
}

async function verificarSenha(senhaPlain, hash) {
  if (!hash || !hash.startsWith('$2')) {
    console.warn('[AUTH_PASSWORD_INVALID] senha_hash ausente ou formato inválido no banco');
    return false;
  }
  const ok = await bcrypt.compare(senhaPlain, hash);
  if (ok) {
    console.log('[AUTH_PASSWORD_MATCH] Senha verificada com sucesso');
  } else {
    console.warn('[AUTH_PASSWORD_INVALID] Senha não corresponde ao hash salvo');
  }
  return ok;
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
    // CORREÇÃO v4: coluna no Supabase é 'expires_at' (não 'expira_em')
    // Bug anterior: inserir em coluna inexistente = falha silenciosa = sem refresh token = sessão não renovável
    const { error } = await sb.from('refresh_tokens').insert({ id, usuario_id:usuarioId, token_hash:hash, expires_at:expiresAt });
    if (error) {
      console.warn('[AUTH_LOGIN_ERROR] Falha ao salvar refresh_token no Supabase:', error.message, '| code:', error.code);
    } else {
      console.log('[AUTH_LOGIN_SUCCESS] refresh_token salvo no Supabase (expires_at ok)');
    }
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
      // CORREÇÃO v4: coluna 'expires_at' (não 'expira_em')
      const { data } = await sb.from('refresh_tokens').select('id').eq('token_hash', hash).gt('expires_at', new Date().toISOString()).single();
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
