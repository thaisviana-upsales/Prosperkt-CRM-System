/**
 * PROSPERKT CRM — Logs Controller
 * Consulta de auditoria — somente GESTOR e SUPER_ADMIN
 */

const { buscarLogs } = require('../services/auditService');

function listar(req, res) {
  const {
    entidade,
    entidade_id,
    usuario_id,
    acao,
    limite  = 100,
    offset  = 0,
  } = req.query;

  // GESTOR só pode ver logs de sua própria equipe (não implementa filtro por ora)
  // SUPER_ADMIN vê tudo
  const logs = buscarLogs({
    entidade,
    entidade_id,
    usuario_id,
    acao,
    limite:  parseInt(limite),
    offset:  parseInt(offset),
  });

  return res.json({ sucesso: true, dados: logs, total: logs.length });
}

module.exports = { listar };
