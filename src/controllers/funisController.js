/**
 * PROSPERKT CRM — Funis Controller
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');

const FUNIS_SEED = [
  { nome:'Indicação',          cor:'#6CFF4E' },
  { nome:'Instagram',          cor:'#E10098' },
  { nome:'Carteira Recorrente',cor:'#3B8BFF' },
  { nome:'Parcerias',          cor:'#FFB627' },
  { nome:'Tráfego Pago',       cor:'#FF3B5C' },
  { nome:'WhatsApp',           cor:'#25D366' },
  { nome:'Site',               cor:'#6C47FF' },
  { nome:'Evento',             cor:'#FF6B35' },
  { nome:'LinkedIn',           cor:'#0077B5' },
];

const ETAPAS_PADRAO = [
  { nome:'Lead Recebido',                 ordem:1, cor:'#6CFF4E', probabilidade:10 },
  { nome:'Contato Realizado',             ordem:2, cor:'#3B8BFF', probabilidade:25 },
  { nome:'Lead Desqualificado',           ordem:3, cor:'#FF3B5C', probabilidade:5,  is_perdido:1 },
  { nome:'Contato Realizado - Tratativa', ordem:4, cor:'#FFB627', probabilidade:40 },
  { nome:'Orçamento Enviado',             ordem:5, cor:'#6C47FF', probabilidade:60 },
  { nome:'Vendas',                        ordem:6, cor:'#6CFF4E', probabilidade:100, is_ganho:1 },
  { nome:'Perdidos',                      ordem:7, cor:'#FF3B5C', probabilidade:0,  is_perdido:1 },
];

function seedFunis() {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) as c FROM funis").get().c;
  if (count > 0) return;

  const adminId = db.prepare("SELECT id FROM usuarios WHERE role='SUPER_ADMIN' LIMIT 1").get()?.id;

  FUNIS_SEED.forEach((f, idx) => {
    const funilId = crypto.randomBytes(16).toString('hex');
    const pipelineId = crypto.randomBytes(16).toString('hex');

    db.prepare(`INSERT INTO funis (id,nome,cor,ativo,criado_por) VALUES (?,?,?,1,?)`).run(funilId,f.nome,f.cor,adminId);
    db.prepare(`INSERT INTO pipelines (id,funil_id,nome,ordem,ativo,criado_por) VALUES (?,?,?,?,1,?)`)
      .run(pipelineId, funilId, `Pipeline - ${f.nome}`, idx, adminId);

    ETAPAS_PADRAO.forEach(e => {
      const etapaId = crypto.randomBytes(16).toString('hex');
      db.prepare(`INSERT INTO etapas (id,pipeline_id,nome,cor,ordem,is_ganho,is_perdido,probabilidade,criado_por) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(etapaId, pipelineId, e.nome, e.cor, e.ordem, e.is_ganho||0, e.is_perdido||0, e.probabilidade, adminId);
    });
  });
}

// GET /api/funis
function listar(req, res) {
  const db = getDb();
  const funis = db.prepare(`SELECT f.*, p.id as pipeline_id FROM funis f
    LEFT JOIN pipelines p ON p.funil_id = f.id
    ORDER BY f.criado_em`).all();
  return res.json({ sucesso:true, dados:funis, total:funis.length });
}

// GET /api/funis/:id
function buscarPorId(req, res) {
  const db = getDb();
  const funil = db.prepare(`SELECT f.*, p.id as pipeline_id FROM funis f
    LEFT JOIN pipelines p ON p.funil_id = f.id WHERE f.id=?`).get(req.params.id);
  if (!funil) return res.status(404).json({ sucesso:false, erro:'Funil não encontrado.' });

  const etapas = db.prepare(`SELECT e.* FROM etapas e
    JOIN pipelines p ON e.pipeline_id=p.id WHERE p.funil_id=? ORDER BY e.ordem`).all(req.params.id);

  return res.json({ sucesso:true, dados:{ ...funil, etapas } });
}

// POST /api/funis
function criar(req, res) {
  const db = getDb();
  const { nome, cor='#6CFF4E', descricao } = req.body;
  if (!nome) return res.status(400).json({ sucesso:false, erro:'Nome é obrigatório.' });

  const funilId = crypto.randomBytes(16).toString('hex');
  const pipelineId = crypto.randomBytes(16).toString('hex');
  const userId = req.usuario.id;

  db.prepare(`INSERT INTO funis (id,nome,cor,descricao,ativo,criado_por) VALUES (?,?,?,?,1,?)`)
    .run(funilId, nome.trim(), cor, descricao||null, userId);
  db.prepare(`INSERT INTO pipelines (id,funil_id,nome,ordem,ativo,criado_por) VALUES (?,?,?,0,1,?)`)
    .run(pipelineId, funilId, `Pipeline - ${nome.trim()}`, userId);

  ETAPAS_PADRAO.forEach(e => {
    db.prepare(`INSERT INTO etapas (id,pipeline_id,nome,cor,ordem,is_ganho,is_perdido,probabilidade,criado_por) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(crypto.randomBytes(16).toString('hex'), pipelineId, e.nome, e.cor, e.ordem, e.is_ganho||0, e.is_perdido||0, e.probabilidade, userId);
  });

  req.log({ acao:'CREATE', entidade:'funis', entidade_id:funilId, depois:{ nome, cor } });
  const criado = db.prepare(`SELECT f.*, p.id as pipeline_id FROM funis f LEFT JOIN pipelines p ON p.funil_id=f.id WHERE f.id=?`).get(funilId);
  return res.status(201).json({ sucesso:true, dados:criado });
}

// PATCH /api/funis/:id
function atualizar(req, res) {
  const db = getDb();
  const { id } = req.params;
  const atual = db.prepare('SELECT * FROM funis WHERE id=?').get(id);
  if (!atual) return res.status(404).json({ sucesso:false, erro:'Funil não encontrado.' });

  const campos = {};
  if (req.body.nome !== undefined)  campos.nome  = req.body.nome.trim();
  if (req.body.cor  !== undefined)  campos.cor   = req.body.cor;
  if (req.body.ativo !== undefined) campos.ativo = req.body.ativo ? 1 : 0;
  if (req.body.descricao !== undefined) campos.descricao = req.body.descricao;
  campos.atualizado_em = new Date().toISOString();

  const sets = Object.keys(campos).map(k=>`${k}=?`).join(',');
  db.prepare(`UPDATE funis SET ${sets} WHERE id=?`).run(...Object.values(campos), id);
  req.log({ acao:'UPDATE', entidade:'funis', entidade_id:id, antes:atual, depois:campos });

  return res.json({ sucesso:true, dados: db.prepare('SELECT * FROM funis WHERE id=?').get(id) });
}

// DELETE /api/funis/:id
function deletar(req, res) {
  const db = getDb();
  const funil = db.prepare('SELECT * FROM funis WHERE id=?').get(req.params.id);
  if (!funil) return res.status(404).json({ sucesso:false, erro:'Funil não encontrado.' });
  db.prepare("UPDATE funis SET ativo=0, atualizado_em=? WHERE id=?").run(new Date().toISOString(), req.params.id);
  req.log({ acao:'DELETE', entidade:'funis', entidade_id:req.params.id, antes:funil });
  return res.json({ sucesso:true, mensagem:'Funil desativado.' });
}

module.exports = { listar, buscarPorId, criar, atualizar, deletar, seedFunis };
