/**
 * PROSPEKT CRM — Auth Middleware
 * Verifica JWT e injeta req.usuario; implementa RBAC hierárquico
 */

const jwt = require('jsonwebtoken');
const { buscarUsuarioPorId } = require('../services/authService');
require('dotenv').config();

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;

// ─────────────────────────────────────────────────────────────────────────────
// Hierarquia de permissões
// ─────────────────────────────────────────────────────────────────────────────
const ROLE_HIERARCHY = {
  SUPER_ADMIN: 3,
  GESTOR:      2,
  VENDEDOR:    1,
};

/**
 * Middleware: autentica o token JWT do header Authorization
 * Popula req.usuario = { id, nome, role, ... }
 */
async function autenticar(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ sucesso:false, erro:'Token de autenticação ausente.', codigo:'NO_TOKEN' });

  try {
    const decoded = jwt.verify(token, ACCESS_SECRET);
    if (decoded.type !== 'access') return res.status(401).json({ sucesso:false, erro:'Tipo de token inválido.', codigo:'INVALID_TOKEN_TYPE' });

    const usuario = await buscarUsuarioPorId(decoded.sub);
    if (!usuario) return res.status(401).json({ sucesso:false, erro:'Usuário não encontrado ou desativado.', codigo:'USER_NOT_FOUND' });

    req.usuario = usuario;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ sucesso:false, erro:'Token expirado.', codigo:'TOKEN_EXPIRED' });
    return res.status(401).json({ sucesso:false, erro:'Token inválido.', codigo:'INVALID_TOKEN' });
  }
}

/**
 * Factory: exige role mínima para acessar a rota
 * Uso: router.get('/rota', autenticar, exigirRole('GESTOR'), handler)
 * Um SUPER_ADMIN pode tudo; GESTOR pode o que VENDEDOR pode, etc.
 */
function exigirRole(...rolesPermitidas) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({
        sucesso: false,
        erro: 'Não autenticado.',
        codigo: 'NOT_AUTHENTICATED',
      });
    }

    const nivelUsuario = ROLE_HIERARCHY[req.usuario.role] || 0;
    const nivelMinimo  = Math.min(...rolesPermitidas.map(r => ROLE_HIERARCHY[r] || 99));

    if (nivelUsuario < nivelMinimo) {
      return res.status(403).json({
        sucesso: false,
        erro: `Acesso negado. Role necessária: ${rolesPermitidas.join(' ou ')}.`,
        codigo: 'FORBIDDEN',
        role_atual: req.usuario.role,
        roles_necessarias: rolesPermitidas,
      });
    }

    next();
  };
}

/**
 * Exige ser SUPER_ADMIN exatamente (sem herança)
 */
function exigirSuperAdmin(req, res, next) {
  if (!req.usuario || req.usuario.role !== 'SUPER_ADMIN') {
    return res.status(403).json({
      sucesso: false,
      erro: 'Acesso restrito a Super Administradores.',
      codigo: 'SUPER_ADMIN_REQUIRED',
    });
  }
  next();
}

/**
 * Verifica se o usuário é dono do recurso ou tem role superior
 * Uso: exigirDonoOuRole(req.params.id, 'GESTOR')
 */
function exigirDonoOuRole(campoId, roleMinima = 'GESTOR') {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ sucesso: false, erro: 'Não autenticado.' });
    }

    const nivelUsuario = ROLE_HIERARCHY[req.usuario.role] || 0;
    const nivelMinimo  = ROLE_HIERARCHY[roleMinima] || 99;
    const ehDono       = req.params[campoId] === req.usuario.id
                      || req.body[campoId] === req.usuario.id;

    if (!ehDono && nivelUsuario < nivelMinimo) {
      return res.status(403).json({
        sucesso: false,
        erro: 'Acesso negado. Você só pode acessar seus próprios recursos.',
        codigo: 'NOT_OWNER',
      });
    }

    next();
  };
}

module.exports = {
  autenticar,
  exigirRole,
  exigirSuperAdmin,
  exigirDonoOuRole,
  ROLE_HIERARCHY,
};
