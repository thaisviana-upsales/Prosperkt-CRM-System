/**
 * PROSPERKT CRM — Auth Controller
 * Login, logout, refresh, me
 */

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

  const usuario = buscarUsuarioPorEmail(email.toLowerCase().trim());

  if (!usuario) {
    // Segurança: mesma mensagem para email e senha inválidos
    return res.status(401).json({
      sucesso: false,
      erro: 'Credenciais inválidas.',
    });
  }

  const senhaCorreta = await verificarSenha(senha, usuario.senha_hash);
  if (!senhaCorreta) {
    registrarLog({
      acao: 'LOGIN_FALHOU',
      entidade: 'usuarios',
      entidade_id: usuario.id,
      ip: req.ip,
      ua: req.get('user-agent'),
      usuario: { id: usuario.id, nome: usuario.nome, role: usuario.role },
    });
    return res.status(401).json({
      sucesso: false,
      erro: 'Credenciais inválidas.',
    });
  }

  const accessToken  = gerarAccessToken(usuario);
  const refreshToken = gerarRefreshToken(usuario);

  salvarRefreshToken(usuario.id, refreshToken, req.ip, req.get('user-agent'));
  setRefreshCookie(res, refreshToken);

  registrarLog({
    acao: 'LOGIN',
    entidade: 'usuarios',
    entidade_id: usuario.id,
    ip: req.ip,
    ua: req.get('user-agent'),
    usuario: { id: usuario.id, nome: usuario.nome, role: usuario.role },
  });

  return res.json({
    sucesso: true,
    accessToken,
    usuario: {
      id:        usuario.id,
      nome:      usuario.nome,
      email:     usuario.email,
      role:      usuario.role,
      avatar_url: usuario.avatar_url,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────────────
function logout(req, res) {
  const token = req.cookies?.pkt_refresh;

  if (token && req.usuario) {
    revogarTodosTokens(req.usuario.id);

    registrarLog({
      acao: 'LOGOUT',
      entidade: 'usuarios',
      entidade_id: req.usuario.id,
      ip: req.ip,
      ua: req.get('user-agent'),
      usuario: { id: req.usuario.id, nome: req.usuario.nome, role: req.usuario.role },
    });
  }

  clearRefreshCookie(res);
  return res.json({ sucesso: true, mensagem: 'Logout realizado com sucesso.' });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// Gera novo access token via refresh token do cookie
// ─────────────────────────────────────────────────────────────────────────────
function refresh(req, res) {
  const token = req.cookies?.pkt_refresh;

  if (!token) {
    return res.status(401).json({
      sucesso: false,
      erro: 'Refresh token ausente.',
      codigo: 'NO_REFRESH_TOKEN',
    });
  }

  const decoded = validarRefreshToken(token);
  if (!decoded) {
    clearRefreshCookie(res);
    return res.status(401).json({
      sucesso: false,
      erro: 'Refresh token inválido ou expirado.',
      codigo: 'INVALID_REFRESH_TOKEN',
    });
  }

  const usuario = buscarUsuarioPorId(decoded.sub);
  if (!usuario) {
    clearRefreshCookie(res);
    return res.status(401).json({
      sucesso: false,
      erro: 'Usuário não encontrado.',
      codigo: 'USER_NOT_FOUND',
    });
  }

  // Rotação: emite novo par de tokens
  const novoAccessToken  = gerarAccessToken(usuario);
  const novoRefreshToken = gerarRefreshToken(usuario);

  salvarRefreshToken(usuario.id, novoRefreshToken, req.ip, req.get('user-agent'));
  setRefreshCookie(res, novoRefreshToken);

  return res.json({
    sucesso: true,
    accessToken: novoAccessToken,
    usuario: {
      id:        usuario.id,
      nome:      usuario.nome,
      email:     usuario.email,
      role:      usuario.role,
      avatar_url: usuario.avatar_url,
    },
  });
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

module.exports = { login, logout, refresh, me };
