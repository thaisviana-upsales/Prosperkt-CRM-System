/**
 * PROSPERKT CRM — Logs Controller
 * Consulta de auditoria — somente GESTOR e SUPER_ADMIN
 */

const { buscarLogs } = require('../services/auditService');

async function listar(req, res) {
  const {
    entidade,
    entidade_id,
    usuario_id,
    acao,
    limite  = 100,
    offset  = 0,
  } = req.query;

  try {
    const logs = await buscarLogs({
      entidade,
      entidade_id,
      usuario_id,
      acao,
      limite:  parseInt(limite),
      offset:  parseInt(offset),
    });
    return res.json({ sucesso: true, dados: logs, total: logs.length });
  } catch(e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { listar };
