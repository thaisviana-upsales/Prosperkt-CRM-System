/**
 * PROSPEKT CRM — Auth Controller
 * Login, logout, refresh, me
 */

const fs   = require('fs');
const path = require('path');

// Arquivo de controle de primeiro acesso (sem DDL)
const PRIMEIRO_ACESSO_FILE = path.join(__dirname, '..', '..', 'data', 'primeiro_acesso.json');

function lerPrimeiroAcesso() {
  try {
    if (fs.existsSync(PRIMEIRO_ACESSO_FILE)) {
      return JSON.parse(fs.readFileSync(PRIMEIRO_ACESSO_FILE, 'utf8'));
    }
  } catch(_) {}
  return {};
}

function salvarPrimeiroAcesso(dados) {
  try {
    const dir = path.dirname(PRIMEIRO_ACESSO_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PRIMEIRO_ACESSO_FILE, JSON.stringify(dados, null, 2));
  } catch(e) {
    console.error('[Auth] Erro ao salvar primeiro_acesso.json:', e.message);
  }
}

const {
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  verificarSenha,
  gerarAccessToken,
  gerarRefreshToken,
  salvarRefreshToken,
  validarRefreshToken,
  revogarTodosTokens,
  setRefreshCookie,
  clearRefreshCookie,
} = require('../services/authService');

const { registrarLog } = require('../services/auditService');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────
async function login(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Email e senha são obrigatórios.',
    });
  }

  const usuario = await buscarUsuarioPorEmail(email.toLowerCase().trim());

  if (!usuario) {
    return res.status(401).json({ sucesso:false, erro:'Credenciais inválidas.' });
  }

  const senhaCorreta = await verificarSenha(senha, usuario.senha_hash);
  if (!senhaCorreta) {
    return res.status(401).json({ sucesso:false, erro:'Credenciais inválidas.' });
  }

  const accessToken  = gerarAccessToken(usuario);
  const refreshToken = gerarRefreshToken(usuario);

  await salvarRefreshToken(usuario.id, refreshToken, req.ip, req.get('user-agent'));
  setRefreshCookie(res, refreshToken);

  registrarLog({
    acao: 'LOGIN',
    entidade: 'usuarios',
    entidade_id: usuario.id,
    ip: req.ip,
    ua: req.get('user-agent'),
    usuario: { id: usuario.id, nome: usuario.nome, role: usuario.role },
  });

  // Verifica se deve trocar a senha (primeiro acesso)
  const primeiroAcesso = lerPrimeiroAcesso();
  const deveTrocar = !!(primeiroAcesso[usuario.id]?.deve_trocar);
  const isSuperAdmin = usuario.role === 'SUPER_ADMIN';

  // Super Admin nunca é obrigado a trocar senha
  const deveTrocarSenha = deveTrocar && !isSuperAdmin;

  return res.json({
    sucesso: true,
    accessToken,
    deve_trocar_senha: deveTrocarSenha,
    usuario: {
      id:         usuario.id,
      nome:       usuario.nome,
      email:      usuario.email,
      role:       usuario.role,
      avatar_url: usuario.avatar_url,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────────────
async function logout(req, res) {
  if (req.usuario) await revogarTodosTokens(req.usuario.id).catch(()=>{});
  clearRefreshCookie(res);
  return res.json({ sucesso:true, mensagem:'Logout realizado com sucesso.' });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// Gera novo access token via refresh token do cookie
// ─────────────────────────────────────────────────────────────────────────────
async function refresh(req, res) {
  const token = req.cookies?.pkt_refresh;
  if (!token) return res.status(401).json({ sucesso:false, erro:'Refresh token ausente.', codigo:'NO_REFRESH_TOKEN' });

  const decoded = await validarRefreshToken(token);
  if (!decoded) { clearRefreshCookie(res); return res.status(401).json({ sucesso:false, erro:'Refresh token inválido ou expirado.', codigo:'INVALID_REFRESH_TOKEN' }); }

  const usuario = await buscarUsuarioPorId(decoded.sub);
  if (!usuario) { clearRefreshCookie(res); return res.status(401).json({ sucesso:false, erro:'Usuário não encontrado.', codigo:'USER_NOT_FOUND' }); }

  const novoAccessToken  = gerarAccessToken(usuario);
  const novoRefreshToken = gerarRefreshToken(usuario);
  await salvarRefreshToken(usuario.id, novoRefreshToken, req.ip, req.get('user-agent'));
  setRefreshCookie(res, novoRefreshToken);

  return res.json({ sucesso:true, accessToken:novoAccessToken, usuario:{ id:usuario.id, nome:usuario.nome, email:usuario.email, role:usuario.role, avatar_url:usuario.avatar_url } });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me
// ─────────────────────────────────────────────────────────────────────────────
function me(req, res) {
  return res.json({
    sucesso: true,
    usuario: {
      id:        req.usuario.id,
      nome:      req.usuario.nome,
      email:     req.usuario.email,
      role:      req.usuario.role,
      avatar_url: req.usuario.avatar_url,
      criado_em: req.usuario.criado_em,
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/auth/trocar-senha
// Troca senha no primeiro acesso obrigatório
// ────────────────────────────────────────────────────────────────────────────────
async function trocarSenha(req, res) {
  const { email, senha_atual, nova_senha } = req.body;

  if (!email || !senha_atual || !nova_senha) {
    return res.status(400).json({ sucesso: false, erro: 'email, senha_atual e nova_senha são obrigatórios.' });
  }
  if (nova_senha.length < 8) {
    return res.status(400).json({ sucesso: false, erro: 'A nova senha deve ter no mínimo 8 caracteres.' });
  }
  if (nova_senha === senha_atual) {
    return res.status(400).json({ sucesso: false, erro: 'A nova senha não pode ser igual à senha temporária.' });
  }

  const usuario = await buscarUsuarioPorEmail(email.toLowerCase().trim());
  if (!usuario) {
    return res.status(401).json({ sucesso: false, erro: 'Usuário não encontrado.' });
  }

  const senhaAtualCorreta = await verificarSenha(senha_atual, usuario.senha_hash);
  if (!senhaAtualCorreta) {
    return res.status(401).json({ sucesso: false, erro: 'Senha atual incorreta.' });
  }

  // Atualiza senha no banco
  const bcrypt = require('bcryptjs');
  const novoHash = await bcrypt.hash(nova_senha, 12);

  const { getProvider } = require('../database/dbProvider');
  const { sb, isSupa } = getProvider();
  const agora = new Date().toISOString();

  if (isSupa) {
    const { error } = await sb.from('usuarios')
      .update({ senha_hash: novoHash, atualizado_em: agora })
      .eq('id', usuario.id);
    if (error) return res.status(500).json({ sucesso: false, erro: 'Erro ao atualizar senha.' });
  } else {
    const { getDb } = require('../database/db');
    const db = getDb();
    db.prepare('UPDATE usuarios SET senha_hash = ?, atualizado_em = ? WHERE id = ?')
      .run(novoHash, agora, usuario.id);
  }

  // Remove flag de primeiro acesso
  const primeiroAcesso = lerPrimeiroAcesso();
  delete primeiroAcesso[usuario.id];
  salvarPrimeiroAcesso(primeiroAcesso);

  // Gera tokens de acesso normal
  const accessToken  = gerarAccessToken(usuario);
  const refreshToken = gerarRefreshToken(usuario);
  await salvarRefreshToken(usuario.id, refreshToken, req.ip, req.get('user-agent'));
  setRefreshCookie(res, refreshToken);

  registrarLog({
    acao: 'TROCAR_SENHA',
    entidade: 'usuarios',
    entidade_id: usuario.id,
    ip: req.ip,
    ua: req.get('user-agent'),
    usuario: { id: usuario.id, nome: usuario.nome, role: usuario.role },
  });

  return res.json({
    sucesso: true,
    mensagem: 'Senha alterada com sucesso.',
    accessToken,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role, avatar_url: usuario.avatar_url },
  });
}

module.exports = { login, logout, refresh, me, trocarSenha };
