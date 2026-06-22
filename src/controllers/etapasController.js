/**
 * PROSPEKT CRM — Etapas Controller
 * Supabase JS nativo ou SQLite conforme DATABASE_PROVIDER.
 * ARQUITETURA Supabase: etapas.pipeline_id → pipelines.id → pipelines.funil_id → funis.id
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

// GET /api/etapas?funil_id=xxx  ou  ?pipeline_id=xxx
async function listar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { pipeline_id, funil_id } = req.query;
  try {
    if (isSupa) {
      let pId = pipeline_id;
      if (!pId && funil_id) {
        const { data: pipes } = await sb.from('pipelines').select('id').eq('funil_id', funil_id).order('criado_em').limit(1);
        pId = pipes?.[0]?.id || null;
      }
      // Inclui nome do funil para que o frontend possa filtrar Carteira Recorrente
      let q = sb.from('etapas').select('*, pipeline:pipelines!pipeline_id(id, funil:funis!funil_id(id,nome))');
      if (pId) q = q.eq('pipeline_id', pId);
      q = q.order('ordem');
      const { data, error } = await q;
      if (error) throw error;
      const dados = (data||[]).map(e => ({
        ...e,
        funil_nome: e.pipeline?.funil?.nome || null,
        pipeline: undefined,
      }));
      return res.json({ sucesso:true, dados, total:dados.length });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    let etapas;
    if (funil_id) {
      etapas = db.prepare(`
        SELECT e.*, f.nome as funil_nome
        FROM etapas e
        JOIN pipelines p ON e.pipeline_id=p.id
        JOIN funis f ON p.funil_id=f.id
        WHERE p.funil_id=? ORDER BY e.ordem`).all(funil_id);
    } else if (pipeline_id) {
      etapas = db.prepare(`
        SELECT e.*, f.nome as funil_nome
        FROM etapas e
        JOIN pipelines p ON e.pipeline_id=p.id
        JOIN funis f ON p.funil_id=f.id
        WHERE e.pipeline_id=? ORDER BY e.ordem`).all(pipeline_id);
    } else {
      etapas = db.prepare(`
        SELECT e.*, f.nome as funil_nome
        FROM etapas e
        JOIN pipelines p ON e.pipeline_id=p.id
        JOIN funis f ON p.funil_id=f.id
        ORDER BY e.ordem`).all();
    }
    return res.json({ sucesso:true, dados:etapas, total:etapas.length });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// POST /api/etapas
async function criar(req, res) {
  const { sb, isSupa } = getProvider();
  const { pipeline_id, funil_id, nome, cor='#6CFF4E', ordem=0, is_ganho=0, is_perdido=0, probabilidade=50 } = req.body;
  const fId = funil_id || pipeline_id; // no Supabase pipeline_id == funil_id
  if (!fId || !nome) return res.status(400).json({ sucesso:false, erro:'funil_id e nome são obrigatórios.' });
  const id = crypto.randomBytes(16).toString('hex');
  try {
    if (isSupa) {
      const { data, error } = await sb.from('etapas').insert({ id, funil_id:fId, nome:nome.trim(), cor, ordem, is_ganho:is_ganho?1:0, is_perdido:is_perdido?1:0, probabilidade }).select().single();
      if (error) throw error;
      return res.status(201).json({ sucesso:true, dados:data });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    db.prepare(`INSERT INTO etapas (id,pipeline_id,nome,cor,ordem,is_ganho,is_perdido,probabilidade,criado_por) VALUES (?,?,?,?,?,?,?,?,?)`).run(id,pipeline_id,nome.trim(),cor,ordem,is_ganho?1:0,is_perdido?1:0,probabilidade,req.usuario.id);
    return res.status(201).json({ sucesso:true, dados: db.prepare('SELECT * FROM etapas WHERE id=?').get(id) });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// PATCH /api/etapas/:id
async function atualizar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  try {
    if (isSupa) {
      const upd = { atualizado_em: new Date().toISOString() };
      ['nome','cor','ordem','is_ganho','is_perdido','probabilidade','sla_horas'].forEach(k => { if (req.body[k] !== undefined) upd[k] = req.body[k]; });
      const { data, error } = await sb.from('etapas').update(upd).eq('id', id).select().single();
      if (error) throw error;
      return res.json({ sucesso:true, dados:data });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const atual = db.prepare('SELECT * FROM etapas WHERE id=?').get(id);
    if (!atual) return res.status(404).json({ sucesso:false, erro:'Etapa não encontrada.' });
    const campos = { atualizado_em: new Date().toISOString() };
    ['nome','cor','ordem','is_ganho','is_perdido','probabilidade','sla_horas'].forEach(k => { if (req.body[k] !== undefined) campos[k] = req.body[k]; });
    const sets = Object.keys(campos).map(k=>`${k}=?`).join(',');
    db.prepare(`UPDATE etapas SET ${sets} WHERE id=?`).run(...Object.values(campos), id);
    return res.json({ sucesso:true, dados: db.prepare('SELECT * FROM etapas WHERE id=?').get(id) });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// DELETE /api/etapas/:id
async function deletar(req, res) {
  const { sb, isSupa } = getProvider();
  try {
    if (isSupa) {
      const { count } = await sb.from('leads').select('*', { count:'exact', head:true }).eq('etapa_id', req.params.id);
      if (count > 0) return res.status(400).json({ sucesso:false, erro:`Existem ${count} leads nesta etapa. Mova-os antes de excluir.` });
      await sb.from('etapas').delete().eq('id', req.params.id);
      return res.json({ sucesso:true, mensagem:'Etapa excluída.' });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const etapa = db.prepare('SELECT * FROM etapas WHERE id=?').get(req.params.id);
    if (!etapa) return res.status(404).json({ sucesso:false, erro:'Etapa não encontrada.' });
    const cnt = db.prepare("SELECT COUNT(*) as c FROM leads WHERE etapa_id=?").get(req.params.id).c;
    if (cnt > 0) return res.status(400).json({ sucesso:false, erro:`Existem ${cnt} leads nesta etapa. Mova-os antes de excluir.` });
    db.prepare('DELETE FROM etapas WHERE id=?').run(req.params.id);
    return res.json({ sucesso:true, mensagem:'Etapa excluída.' });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// POST /api/etapas/reordenar
async function reordenar(req, res) {
  const { sb, isSupa } = getProvider();
  const { ordem } = req.body;
  if (!Array.isArray(ordem)) return res.status(400).json({ sucesso:false, erro:'Formato inválido.' });
  try {
    if (isSupa) {
      await Promise.all(ordem.map(o => sb.from('etapas').update({ ordem:o.ordem }).eq('id', o.id)));
      return res.json({ sucesso:true });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const update = db.prepare('UPDATE etapas SET ordem=? WHERE id=?');
    db.transaction(() => ordem.forEach(o => update.run(o.ordem, o.id)))();
    return res.json({ sucesso:true });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

module.exports = { listar, criar, atualizar, deletar, reordenar };
