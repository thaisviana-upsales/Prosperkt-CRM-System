/**
 * PROSPERKT CRM — Audit Logger Service
 * Registra toda ação: quem, quando, o que mudou (antes e depois)
 */

const { getDb } = require('../database/db');
const crypto = require('crypto');

/**
 * Registra uma entrada de auditoria no banco
 * @param {Object} params
 * @param {string} params.acao       - CREATE | UPDATE | DELETE | LOGIN | LOGOUT | VIEW | ERRO
 * @param {string} params.entidade   - nome da tabela/recurso afetado
 * @param {string} [params.entidade_id]
 * @param {Object} [params.antes]    - estado anterior do registro
 * @param {Object} [params.depois]   - estado novo do registro
 * @param {Object} [params.usuario]  - { id, nome, role }
 * @param {string} [params.ip]
 * @param {string} [params.ua]       - user agent
 */
function registrarLog({ acao, entidade, entidade_id, antes, depois, usuario, ip, ua }) {
  try {
    const db = getDb();
    const id = crypto.randomBytes(16).toString('hex');

    db.prepare(`
      INSERT INTO logs (
        id, usuario_id, usuario_nome, usuario_role,
        acao, entidade, entidade_id,
        dados_antes, dados_depois,
        ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      usuario?.id   || null,
      usuario?.nome || null,
      usuario?.role || null,
      acao,
      entidade,
      entidade_id   || null,
      antes  ? JSON.stringify(antes)  : null,
      depois ? JSON.stringify(depois) : null,
      ip  || null,
      ua  || null
    );
  } catch (err) {
    // Log não pode derrubar a aplicação — apenas logar no console
    console.error('[AuditLog] Falha ao registrar log:', err.message);
  }
}

/**
 * Middleware Express: injeta função log no req para usar em controllers
 */
function auditMiddleware(req, res, next) {
  req.log = ({ acao, entidade, entidade_id, antes, depois }) => {
    registrarLog({
      acao,
      entidade,
      entidade_id,
      antes,
      depois,
      usuario: req.usuario ? {
        id:   req.usuario.id,
        nome: req.usuario.nome,
        role: req.usuario.role,
      } : null,
      ip: req.ip,
      ua: req.get('user-agent'),
    });
  };
  next();
}

/**
 * Busca logs com filtros opcionais
 */
function buscarLogs({ entidade, entidade_id, usuario_id, acao, limite = 100, offset = 0 } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM logs WHERE 1=1';
  const params = [];

  if (entidade)    { sql += ' AND entidade = ?';    params.push(entidade); }
  if (entidade_id) { sql += ' AND entidade_id = ?'; params.push(entidade_id); }
  if (usuario_id)  { sql += ' AND usuario_id = ?';  params.push(usuario_id); }
  if (acao)        { sql += ' AND acao = ?';         params.push(acao); }

  sql += ' ORDER BY criado_em DESC LIMIT ? OFFSET ?';
  params.push(limite, offset);

  return db.prepare(sql).all(...params);
}

module.exports = { registrarLog, auditMiddleware, buscarLogs };
