/**
 * PROSPERKT CRM — Mensagens Padrão Controller
 * Biblioteca de scripts reutilizáveis dentro das conversas WhatsApp
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');

const CATEGORIAS = [
  'Primeiro contato',
  'Envio de orçamento',
  'Confirmação de entrega',
  'Perdido por falta de contato',
  'Sem contato +2h', 'Sem contato +4h', 'Sem contato +8h',
  'Sem contato +1D', 'Sem contato +3D', 'Sem contato +5D', 'Sem contato +7D',
  'Follow-up pós orçamento +2h', 'Follow-up pós orçamento +4h',
  'Follow-up pós orçamento +8h', 'Follow-up pós orçamento +1D',
  'Follow-up pós orçamento +3D', 'Follow-up pós orçamento +5D',
  'Follow-up pós orçamento +7D',
  'Reativação +3M', 'Reativação +6M', 'Reativação +9M', 'Reativação +12M',
  'Geral',
];

/** Substitui variáveis dinâmicas no texto */
function substituir(texto, vars = {}) {
  return (texto || '')
    .replace(/\[nome_lead\]/gi,     vars.nome_lead     || '')
    .replace(/\[nome_vendedor\]/gi, vars.nome_vendedor || '')
    .replace(/\[nome_empresa\]/gi,  vars.nome_empresa  || vars.empresa || '')
    .replace(/\[telefone_lead\]/gi, vars.telefone_lead || '')
    .replace(/\[funil\]/gi,         vars.funil         || '')
    .replace(/\[etapa\]/gi,         vars.etapa         || '')
    .replace(/\[empresa\]/gi,       vars.empresa       || vars.nome_empresa || '');
}

// GET /api/mensagens-padrao
function listar(req, res) {
  try {
    const db = getDb();
    const { categoria, funil_id, busca, ativo } = req.query;

    let sql = `
      SELECT mp.*,
        u.nome AS criado_por_nome,
        f.nome AS funil_nome,
        e.nome AS etapa_nome
      FROM mensagens_padrao mp
      LEFT JOIN usuarios u ON mp.criado_por = u.id
      LEFT JOIN funis    f ON mp.funil_id   = f.id
      LEFT JOIN etapas   e ON mp.etapa_id   = e.id
      WHERE 1=1`;
    const params = [];

    if (categoria) { sql += ' AND mp.categoria = ?';  params.push(categoria); }
    if (funil_id)  { sql += ' AND mp.funil_id = ?';   params.push(funil_id); }
    if (ativo !== undefined && ativo !== '') {
      sql += ' AND mp.ativo = ?'; params.push(Number(ativo));
    }
    if (busca) {
      sql += ' AND (mp.titulo LIKE ? OR mp.texto LIKE ? OR mp.categoria LIKE ?)';
      const q = `%${busca}%`;
      params.push(q, q, q);
    }

    sql += ' ORDER BY mp.categoria ASC, mp.titulo ASC';
    const lista = db.prepare(sql).all(...params);
    return res.json({ sucesso: true, dados: lista, total: lista.length });
  } catch (e) {
    console.error('[MsgPadrao] listar:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// GET /api/mensagens-padrao/categorias
function getCategorias(req, res) {
  return res.json({ sucesso: true, dados: CATEGORIAS });
}

// GET /api/mensagens-padrao/:id
function buscarPorId(req, res) {
  try {
    const db = getDb();
    const item = db.prepare(`
      SELECT mp.*, u.nome AS criado_por_nome, f.nome AS funil_nome, e.nome AS etapa_nome
      FROM mensagens_padrao mp
      LEFT JOIN usuarios u ON mp.criado_por = u.id
      LEFT JOIN funis    f ON mp.funil_id   = f.id
      LEFT JOIN etapas   e ON mp.etapa_id   = e.id
      WHERE mp.id = ?`).get(req.params.id);
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada.' });
    return res.json({ sucesso: true, dados: item });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// POST /api/mensagens-padrao
function criar(req, res) {
  try {
    const db = getDb();
    const role = req.usuario.role;
    if (role === 'VENDEDOR') {
      return res.status(403).json({ sucesso: false, erro: 'Vendedores não podem criar mensagens padrão.' });
    }

    const { titulo, categoria, texto, funil_id, etapa_id, ativo = 1 } = req.body;
    if (!titulo) return res.status(400).json({ sucesso: false, erro: 'Título é obrigatório.' });
    if (!texto)  return res.status(400).json({ sucesso: false, erro: 'Texto é obrigatório.' });
    if (!categoria) return res.status(400).json({ sucesso: false, erro: 'Categoria é obrigatória.' });

    const id   = crypto.randomBytes(16).toString('hex');
    const agora = new Date().toISOString();

    db.prepare(`
      INSERT INTO mensagens_padrao
        (id, titulo, categoria, texto, funil_id, etapa_id, ativo, criado_por, criado_em, atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(id, titulo.trim(), categoria.trim(), texto.trim(),
           funil_id || null, etapa_id || null, ativo ? 1 : 0,
           req.usuario.id, agora, agora);

    req.log({ acao: 'MSG_PADRAO_CRIAR', entidade: 'mensagens_padrao', entidade_id: id,
      depois: { titulo, categoria, funil_id } });

    const criado = db.prepare('SELECT * FROM mensagens_padrao WHERE id = ?').get(id);
    return res.status(201).json({ sucesso: true, dados: criado });
  } catch (e) {
    console.error('[MsgPadrao] criar:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// PATCH /api/mensagens-padrao/:id
function editar(req, res) {
  try {
    const db = getDb();
    const role = req.usuario.role;
    if (role === 'VENDEDOR') {
      return res.status(403).json({ sucesso: false, erro: 'Vendedores não podem editar mensagens padrão.' });
    }

    const atual = db.prepare('SELECT * FROM mensagens_padrao WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada.' });

    const campos = {};
    ['titulo','categoria','texto','funil_id','etapa_id'].forEach(k => {
      if (req.body[k] !== undefined) campos[k] = req.body[k] || null;
    });
    if (req.body.titulo) campos.titulo = req.body.titulo.trim();
    if (req.body.texto)  campos.texto  = req.body.texto.trim();
    if (req.body.ativo !== undefined) campos.ativo = req.body.ativo ? 1 : 0;
    campos.atualizado_em = new Date().toISOString();

    const sets = Object.keys(campos).map(k => `${k}=?`).join(',');
    db.prepare(`UPDATE mensagens_padrao SET ${sets} WHERE id = ?`).run(...Object.values(campos), req.params.id);

    req.log({ acao: 'MSG_PADRAO_EDITAR', entidade: 'mensagens_padrao', entidade_id: req.params.id,
      antes: atual, depois: campos });

    return res.json({ sucesso: true, dados: db.prepare('SELECT * FROM mensagens_padrao WHERE id = ?').get(req.params.id) });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// DELETE /api/mensagens-padrao/:id
function deletar(req, res) {
  try {
    const db = getDb();
    if (req.usuario.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ sucesso: false, erro: 'Apenas Super Admin pode excluir mensagens padrão.' });
    }
    const atual = db.prepare('SELECT * FROM mensagens_padrao WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada.' });
    db.prepare('DELETE FROM mensagens_padrao WHERE id = ?').run(req.params.id);
    req.log({ acao: 'MSG_PADRAO_DELETAR', entidade: 'mensagens_padrao', entidade_id: req.params.id, antes: atual });
    return res.json({ sucesso: true, mensagem: 'Mensagem excluída.' });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// GET /api/mensagens-padrao/:id/preview
// Retorna texto com variáveis substituídas por exemplos (para preview)
function preview(req, res) {
  try {
    const db = getDb();
    const item = db.prepare('SELECT * FROM mensagens_padrao WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada.' });

    const texto = substituir(item.texto, {
      nome_lead:     req.query.nome_lead     || 'João Silva',
      nome_vendedor: req.query.nome_vendedor || req.usuario.nome || 'Carlos',
      nome_empresa:  req.query.empresa       || 'Empresa Exemplo',
      telefone_lead: req.query.telefone      || '11999990000',
      funil:         req.query.funil         || 'Tráfego Pago',
      etapa:         req.query.etapa         || 'Lead Recebido',
      empresa:       req.query.empresa       || 'Empresa Exemplo',
    });
    return res.json({ sucesso: true, dados: { original: item.texto, preview: texto } });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { listar, getCategorias, buscarPorId, criar, editar, deletar, preview, CATEGORIAS, substituir };
