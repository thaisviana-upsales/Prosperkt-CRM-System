/**
 * PROSPERKT CRM — Funis Controller
 * Supabase JS nativo ou SQLite conforme DATABASE_PROVIDER.
 * IMPORTANTE: No Supabase, etapas têm funil_id direto (sem pipeline_id intermediário).
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

const ETAPAS_PADRAO = [
  { nome:'Lead Recebido',                 ordem:1, cor:'#6CFF4E', probabilidade:10,  is_ganho:0, is_perdido:0 },
  { nome:'Contato Realizado',             ordem:2, cor:'#3B8BFF', probabilidade:25,  is_ganho:0, is_perdido:0 },
  { nome:'Lead Desqualificado',           ordem:3, cor:'#FF3B5C', probabilidade:5,   is_ganho:0, is_perdido:1 },
  { nome:'Em Tratativa',                  ordem:4, cor:'#FFB627', probabilidade:40,  is_ganho:0, is_perdido:0 },
  { nome:'Orçamento Enviado',             ordem:5, cor:'#6C47FF', probabilidade:60,  is_ganho:0, is_perdido:0 },
  { nome:'Vendas',                        ordem:6, cor:'#6CFF4E', probabilidade:100, is_ganho:1, is_perdido:0 },
  { nome:'Perdidos',                      ordem:7, cor:'#FF3B5C', probabilidade:0,   is_ganho:0, is_perdido:1 },
];

const FUNIS_SEED = [
  { nome:'Indicação',           cor:'#6CFF4E' },
  { nome:'Instagram',           cor:'#E10098' },
  { nome:'Carteira Recorrente', cor:'#3B8BFF' },
  { nome:'Parcerias',           cor:'#FFB627' },
  { nome:'Tráfego Pago',        cor:'#FF3B5C' },
  { nome:'WhatsApp',            cor:'#25D366' },
  { nome:'Site',                cor:'#6C47FF' },
  { nome:'Evento',              cor:'#FF6B35' },
  { nome:'LinkedIn',            cor:'#0077B5' },
];

async function seedFunis() {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      const { data: existing } = await sb.from('funis').select('id').limit(1);
      if (existing?.length) return;
      const { data: admin } = await sb.from('usuarios').select('id').eq('role','SUPER_ADMIN').single();
      const adminId = admin?.id || null;
      for (const [idx, f] of FUNIS_SEED.entries()) {
        const funilId = crypto.randomBytes(16).toString('hex');
        await sb.from('funis').insert({ id:funilId, nome:f.nome, cor:f.cor, ativo:1, ordem:idx });
        for (const e of ETAPAS_PADRAO) {
          await sb.from('etapas').insert({ id:crypto.randomBytes(16).toString('hex'), funil_id:funilId, nome:e.nome, cor:e.cor, ordem:e.ordem, is_ganho:e.is_ganho, is_perdido:e.is_perdido, probabilidade:e.probabilidade });
        }
      }
      console.log('[Seed] Funis criados no Supabase.');
      return;
    }
    // SQLite
    const { getDb } = require('../database/db');
    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) as c FROM funis").get().c;
    if (count > 0) return;
    const adminId = db.prepare("SELECT id FROM usuarios WHERE role='SUPER_ADMIN' LIMIT 1").get()?.id;
    FUNIS_SEED.forEach((f, idx) => {
      const funilId = crypto.randomBytes(16).toString('hex');
      const pipelineId = crypto.randomBytes(16).toString('hex');
      db.prepare(`INSERT INTO funis (id,nome,cor,ativo,criado_por) VALUES (?,?,?,1,?)`).run(funilId,f.nome,f.cor,adminId);
      db.prepare(`INSERT INTO pipelines (id,funil_id,nome,ordem,ativo,criado_por) VALUES (?,?,?,?,1,?)`).run(pipelineId,funilId,`Pipeline - ${f.nome}`,idx,adminId);
      ETAPAS_PADRAO.forEach(e => {
        db.prepare(`INSERT INTO etapas (id,pipeline_id,nome,cor,ordem,is_ganho,is_perdido,probabilidade,criado_por) VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomBytes(16).toString('hex'),pipelineId,e.nome,e.cor,e.ordem,e.is_ganho,e.is_perdido,e.probabilidade,adminId);
      });
    });
  } catch(e) { console.error('[seedFunis]', e.message); }
}

// GET /api/funis
async function listar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      const { data, error } = await sb.from('funis').select('*').order('criado_em');
      if (error) throw error;
      return res.json({ sucesso:true, dados:data||[], total:(data||[]).length });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const funis = db.prepare(`SELECT f.*, p.id as pipeline_id FROM funis f LEFT JOIN pipelines p ON p.funil_id=f.id ORDER BY f.criado_em`).all();
    return res.json({ sucesso:true, dados:funis, total:funis.length });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// GET /api/funis/:id  — retorna funil + etapas (usado pela pipeline)
async function buscarPorId(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      const { data: funil, error } = await sb.from('funis').select('*').eq('id', req.params.id).single();
      if (error || !funil) return res.status(404).json({ sucesso:false, erro:'Funil não encontrado.' });
      const { data: etapas } = await sb.from('etapas').select('*').eq('funil_id', req.params.id).order('ordem');
      // pipeline_id: usa o funil_id como identificador de pipeline (Supabase não tem tabela pipelines)
      return res.json({ sucesso:true, dados:{ ...funil, pipeline_id: funil.id, etapas: etapas||[] } });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const funil = db.prepare(`SELECT f.*, p.id as pipeline_id FROM funis f LEFT JOIN pipelines p ON p.funil_id=f.id WHERE f.id=?`).get(req.params.id);
    if (!funil) return res.status(404).json({ sucesso:false, erro:'Funil não encontrado.' });
    const etapas = db.prepare(`SELECT e.* FROM etapas e JOIN pipelines p ON e.pipeline_id=p.id WHERE p.funil_id=? ORDER BY e.ordem`).all(req.params.id);
    return res.json({ sucesso:true, dados:{ ...funil, etapas } });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// POST /api/funis
async function criar(req, res) {
  const { sb, isSupa } = getProvider();
  const { nome, cor='#6CFF4E', descricao } = req.body;
  if (!nome) return res.status(400).json({ sucesso:false, erro:'Nome é obrigatório.' });
  const funilId = crypto.randomBytes(16).toString('hex');
  try {
    if (isSupa) {
      const { data, error } = await sb.from('funis').insert({ id:funilId, nome:nome.trim(), cor, descricao:descricao||null, ativo:1 }).select().single();
      if (error) throw error;
      for (const e of ETAPAS_PADRAO) {
        await sb.from('etapas').insert({ id:crypto.randomBytes(16).toString('hex'), funil_id:funilId, nome:e.nome, cor:e.cor, ordem:e.ordem, is_ganho:e.is_ganho, is_perdido:e.is_perdido, probabilidade:e.probabilidade });
      }
      req.log({ acao:'CREATE', entidade:'funis', entidade_id:funilId, depois:{ nome, cor } });
      return res.status(201).json({ sucesso:true, dados:data });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const pipelineId = crypto.randomBytes(16).toString('hex');
    db.prepare(`INSERT INTO funis (id,nome,cor,descricao,ativo,criado_por) VALUES (?,?,?,?,1,?)`).run(funilId,nome.trim(),cor,descricao||null,req.usuario.id);
    db.prepare(`INSERT INTO pipelines (id,funil_id,nome,ordem,ativo,criado_por) VALUES (?,?,?,0,1,?)`).run(pipelineId,funilId,`Pipeline - ${nome.trim()}`,req.usuario.id);
    ETAPAS_PADRAO.forEach(e => { db.prepare(`INSERT INTO etapas (id,pipeline_id,nome,cor,ordem,is_ganho,is_perdido,probabilidade,criado_por) VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomBytes(16).toString('hex'),pipelineId,e.nome,e.cor,e.ordem,e.is_ganho,e.is_perdido,e.probabilidade,req.usuario.id); });
    req.log({ acao:'CREATE', entidade:'funis', entidade_id:funilId, depois:{ nome, cor } });
    return res.status(201).json({ sucesso:true, dados: db.prepare(`SELECT f.*, p.id as pipeline_id FROM funis f LEFT JOIN pipelines p ON p.funil_id=f.id WHERE f.id=?`).get(funilId) });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// PATCH /api/funis/:id
async function atualizar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  try {
    if (isSupa) {
      const upd = { atualizado_em: new Date().toISOString() };
      if (req.body.nome !== undefined)  upd.nome  = req.body.nome.trim();
      if (req.body.cor  !== undefined)  upd.cor   = req.body.cor;
      if (req.body.ativo !== undefined) upd.ativo = req.body.ativo ? 1 : 0;
      if (req.body.descricao !== undefined) upd.descricao = req.body.descricao;
      const { data, error } = await sb.from('funis').update(upd).eq('id', id).select().single();
      if (error) throw error;
      return res.json({ sucesso:true, dados:data });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const atual = db.prepare('SELECT * FROM funis WHERE id=?').get(id);
    if (!atual) return res.status(404).json({ sucesso:false, erro:'Funil não encontrado.' });
    const campos = { atualizado_em: new Date().toISOString() };
    if (req.body.nome !== undefined)  campos.nome  = req.body.nome.trim();
    if (req.body.cor  !== undefined)  campos.cor   = req.body.cor;
    if (req.body.ativo !== undefined) campos.ativo = req.body.ativo ? 1 : 0;
    if (req.body.descricao !== undefined) campos.descricao = req.body.descricao;
    const sets = Object.keys(campos).map(k=>`${k}=?`).join(',');
    db.prepare(`UPDATE funis SET ${sets} WHERE id=?`).run(...Object.values(campos), id);
    return res.json({ sucesso:true, dados: db.prepare('SELECT * FROM funis WHERE id=?').get(id) });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// DELETE /api/funis/:id
async function deletar(req, res) {
  const { sb, isSupa } = getProvider();
  try {
    if (isSupa) {
      await sb.from('funis').update({ ativo:0, atualizado_em: new Date().toISOString() }).eq('id', req.params.id);
      return res.json({ sucesso:true, mensagem:'Funil desativado.' });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    db.prepare("UPDATE funis SET ativo=0, atualizado_em=? WHERE id=?").run(new Date().toISOString(), req.params.id);
    return res.json({ sucesso:true, mensagem:'Funil desativado.' });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

module.exports = { listar, buscarPorId, criar, atualizar, deletar, seedFunis };
