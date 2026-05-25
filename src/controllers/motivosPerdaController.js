/**
 * PROSPERKT CRM — Motivos de Perda Controller
 * CRUD de motivos de perda configuráveis
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

const MOTIVOS_PADRAO = [
  { id:'mp-sem-orcamento',  nome:'Sem orçamento no momento', ordem:1 },
  { id:'mp-nao-respondeu',  nome:'Não respondeu',            ordem:2 },
  { id:'mp-concorrente',    nome:'Comprou com concorrente',  ordem:3 },
  { id:'mp-preco',          nome:'Preço fora da expectativa',ordem:4 },
  { id:'mp-sem-perfil',     nome:'Sem perfil',               ordem:5 },
  { id:'mp-duplicado',      nome:'Lead duplicado',           ordem:6 },
  { id:'mp-sem-interesse',  nome:'Não tem interesse',        ordem:7 },
  { id:'mp-prazo',          nome:'Prazo incompatível',       ordem:8 },
  { id:'mp-outro',          nome:'Outro',                    ordem:9 },
];

// GET /api/motivos-perda
async function listar(req, res) {
  const { sb, isSupa } = getProvider();
  try {
    if (isSupa) {
      const { data, error } = await sb.from('motivos_perda')
        .select('*').eq('ativo', 1).order('ordem');
      if (error) {
        // Tabela pode não existir — retorna fallback
        console.warn('[motivos_perda] tabela não encontrada, usando fallback:', error.message);
        return res.json({ sucesso: true, dados: MOTIVOS_PADRAO, fallback: true });
      }
      const dados = (data && data.length > 0) ? data : MOTIVOS_PADRAO;
      return res.json({ sucesso: true, dados });
    }
    // SQLite: retorna padrão (tabela não existe no SQLite)
    return res.json({ sucesso: true, dados: MOTIVOS_PADRAO });
  } catch(e) {
    return res.json({ sucesso: true, dados: MOTIVOS_PADRAO, fallback: true });
  }
}

// POST /api/motivos-perda
async function criar(req, res) {
  const { sb, isSupa } = getProvider();
  const { nome, ordem = 99 } = req.body;
  if (!nome) return res.status(400).json({ sucesso: false, erro: 'Nome é obrigatório.' });
  try {
    if (isSupa) {
      const id = crypto.randomBytes(16).toString('hex');
      const { data, error } = await sb.from('motivos_perda')
        .insert({ id, nome: nome.trim(), ordem, ativo: 1 }).select().single();
      if (error) throw error;
      return res.status(201).json({ sucesso: true, dados: data });
    }
    return res.status(201).json({ sucesso: true, dados: { id: crypto.randomBytes(8).toString('hex'), nome: nome.trim(), ordem, ativo: 1 } });
  } catch(e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// PATCH /api/motivos-perda/:id
async function atualizar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  try {
    if (isSupa) {
      const upd = { atualizado_em: new Date().toISOString() };
      if (req.body.nome  !== undefined) upd.nome  = req.body.nome.trim();
      if (req.body.ativo !== undefined) upd.ativo = req.body.ativo ? 1 : 0;
      if (req.body.ordem !== undefined) upd.ordem = req.body.ordem;
      const { data, error } = await sb.from('motivos_perda').update(upd).eq('id', id).select().single();
      if (error) throw error;
      return res.json({ sucesso: true, dados: data });
    }
    return res.json({ sucesso: true, dados: { id } });
  } catch(e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// DELETE /api/motivos-perda/:id
async function deletar(req, res) {
  const { sb, isSupa } = getProvider();
  try {
    if (isSupa) {
      const { error } = await sb.from('motivos_perda')
        .update({ ativo: 0, atualizado_em: new Date().toISOString() }).eq('id', req.params.id);
      if (error) throw error;
    }
    return res.json({ sucesso: true });
  } catch(e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { listar, criar, atualizar, deletar };
