/**
 * PROSPERKT CRM — Etapas Controller
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');

// GET /api/etapas?pipeline_id=xxx
function listar(req, res) {
  const db = getDb();
  const { pipeline_id, funil_id } = req.query;
  let etapas;
  if (funil_id) {
    etapas = db.prepare(`SELECT e.* FROM etapas e
      JOIN pipelines p ON e.pipeline_id=p.id WHERE p.funil_id=? ORDER BY e.ordem`).all(funil_id);
  } else if (pipeline_id) {
    etapas = db.prepare(`SELECT * FROM etapas WHERE pipeline_id=? ORDER BY ordem`).all(pipeline_id);
  } else {
    etapas = db.prepare(`SELECT * FROM etapas ORDER BY ordem`).all();
  }
  return res.json({ sucesso:true, dados:etapas, total:etapas.length });
}

// POST /api/etapas
function criar(req, res) {
  const db = getDb();
  const { pipeline_id, nome, cor='#6CFF4E', ordem=0, is_ganho=0, is_perdido=0, probabilidade=50 } = req.body;
  if (!pipeline_id || !nome) return res.status(400).json({ sucesso:false, erro:'pipeline_id e nome são obrigatórios.' });

  const id = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO etapas (id,pipeline_id,nome,cor,ordem,is_ganho,is_perdido,probabilidade,criado_por) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, pipeline_id, nome.trim(), cor, ordem, is_ganho?1:0, is_perdido?1:0, probabilidade, req.usuario.id);

  req.log({ acao:'CREATE', entidade:'etapas', entidade_id:id, depois:{ pipeline_id, nome } });
  return res.status(201).json({ sucesso:true, dados: db.prepare('SELECT * FROM etapas WHERE id=?').get(id) });
}

// PATCH /api/etapas/:id
function atualizar(req, res) {
  const db = getDb();
  const { id } = req.params;
  const atual = db.prepare('SELECT * FROM etapas WHERE id=?').get(id);
  if (!atual) return res.status(404).json({ sucesso:false, erro:'Etapa não encontrada.' });

  const campos = {};
  ['nome','cor','ordem','is_ganho','is_perdido','probabilidade','sla_horas'].forEach(k => {
    if (req.body[k] !== undefined) campos[k] = req.body[k];
  });
  campos.atualizado_em = new Date().toISOString();

  const sets = Object.keys(campos).map(k=>`${k}=?`).join(',');
  db.prepare(`UPDATE etapas SET ${sets} WHERE id=?`).run(...Object.values(campos), id);
  req.log({ acao:'UPDATE', entidade:'etapas', entidade_id:id, antes:atual, depois:campos });
  return res.json({ sucesso:true, dados: db.prepare('SELECT * FROM etapas WHERE id=?').get(id) });
}

// DELETE /api/etapas/:id
function deletar(req, res) {
  const db = getDb();
  const etapa = db.prepare('SELECT * FROM etapas WHERE id=?').get(req.params.id);
  if (!etapa) return res.status(404).json({ sucesso:false, erro:'Etapa não encontrada.' });
  const count = db.prepare("SELECT COUNT(*) as c FROM leads WHERE etapa_id=?").get(req.params.id).c;
  if (count > 0) return res.status(400).json({ sucesso:false, erro:`Existem ${count} leads nesta etapa. Mova-os antes de excluir.` });
  db.prepare('DELETE FROM etapas WHERE id=?').run(req.params.id);
  req.log({ acao:'DELETE', entidade:'etapas', entidade_id:req.params.id, antes:etapa });
  return res.json({ sucesso:true, mensagem:'Etapa excluída.' });
}

// POST /api/etapas/reordenar
function reordenar(req, res) {
  const db = getDb();
  const { ordem } = req.body; // [{ id, ordem }]
  if (!Array.isArray(ordem)) return res.status(400).json({ sucesso:false, erro:'Formato inválido.' });
  const update = db.prepare('UPDATE etapas SET ordem=? WHERE id=?');
  const updateMany = db.transaction(() => ordem.forEach(o => update.run(o.ordem, o.id)));
  updateMany();
  return res.json({ sucesso:true });
}

module.exports = { listar, criar, atualizar, deletar, reordenar };
