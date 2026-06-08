/**
 * PROSPERKT CRM — Biblioteca de Mensagens (ex-Mensagens Padrão)
 * Scripts reutilizáveis dentro das conversas WhatsApp
 *
 * Categoria salva no campo `categoria` como "CatPai|Subcategoria"
 * Título salvo como cadência: "D+2", "D+15", etc.
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

/** Substitui variáveis dinâmicas no texto */
function substituir(texto, vars = {}) {
  return (texto || '')
    .replace(/\[nome_lead\]/gi,     vars.nome_lead     || '')
    .replace(/\[nome_vendedor\]/gi, vars.nome_vendedor || '')
    .replace(/\[nome_empresa\]/gi,  vars.nome_empresa  || vars.empresa || '')
    .replace(/\[telefone_lead\]/gi, vars.telefone_lead || '')
    .replace(/\[funil\]/gi,         vars.funil         || '')
    .replace(/\[etapa\]/gi,         vars.etapa         || '')
    .replace(/\[empresa\]/gi,       vars.empresa       || vars.nome_empresa || '')
    // Variáveis modernas (picker v3)
    .replace(/\[Nome\]/g,           vars.nome_lead     || vars.nome || '')
    .replace(/\[Empresa\]/g,        vars.empresa       || vars.nome_empresa || '')
    .replace(/\[Vendedor\]/g,       vars.nome_vendedor || vars.vendedor || '')
    .replace(/\[Produto\]/g,        vars.produto       || '')
    .replace(/\[Último Pedido\]/g,  vars.ultimoPedido  || '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de DB
// ─────────────────────────────────────────────────────────────────────────────
async function dbListar(filtros = {}) {
  const { sb, isSupa } = getProvider();
  const { categoria, funil_id, busca, ativo } = filtros;

  if (isSupa) {
    let q = sb.from('mensagens_padrao')
      .select('*, usuarios!mensagens_padrao_criado_por_fkey(nome), funis!mensagens_padrao_funil_id_fkey(nome)')
      .order('categoria').order('titulo');
    if (categoria) q = q.eq('categoria', categoria);
    if (funil_id)  q = q.eq('funil_id', funil_id);
    if (ativo !== undefined && ativo !== '') q = q.eq('ativo', Number(ativo));
    if (busca) q = q.or(`titulo.ilike.%${busca}%,texto.ilike.%${busca}%,categoria.ilike.%${busca}%`);
    const { data, error } = await q;
    if (error) throw error;
    // Normaliza joins
    return (data || []).map(m => ({
      ...m,
      criado_por_nome: m.usuarios?.nome || null,
      funil_nome: m.funis?.nome || null,
    }));
  }

  // SQLite
  const { getDb } = require('../database/db');
  const db = getDb();
  const params = [];
  let sql = `
    SELECT mp.*,
      u.nome AS criado_por_nome,
      f.nome AS funil_nome
    FROM mensagens_padrao mp
    LEFT JOIN usuarios u ON mp.criado_por = u.id
    LEFT JOIN funis    f ON mp.funil_id   = f.id
    WHERE 1=1`;
  if (categoria) { sql += ' AND mp.categoria = ?';  params.push(categoria); }
  if (funil_id)  { sql += ' AND mp.funil_id = ?';   params.push(funil_id); }
  if (ativo !== undefined && ativo !== '') { sql += ' AND mp.ativo = ?'; params.push(Number(ativo)); }
  if (busca) {
    sql += ' AND (mp.titulo LIKE ? OR mp.texto LIKE ? OR mp.categoria LIKE ?)';
    const q = `%${busca}%`;
    params.push(q, q, q);
  }
  sql += ' ORDER BY mp.categoria ASC, mp.titulo ASC';
  return db.prepare(sql).all(...params);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/mensagens-padrao
// ─────────────────────────────────────────────────────────────────────────────
async function listar(req, res) {
  try {
    const lista = await dbListar(req.query);
    return res.json({ sucesso: true, dados: lista, total: lista.length });
  } catch (e) {
    console.error('[MsgPadrao] listar:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/mensagens-padrao/categorias
// Retorna as categorias BASE (parte antes do "|") distintas presentes no DB
// + metadados de subcategorias e cadências dinamicamente
// ─────────────────────────────────────────────────────────────────────────────
async function getCategorias(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    let rows = [];

    if (isSupa) {
      const { data, error } = await sb.from('mensagens_padrao')
        .select('categoria, titulo')
        .eq('ativo', 1)
        .order('categoria');
      if (error) throw error;
      rows = data || [];
    } else {
      const { getDb } = require('../database/db');
      rows = getDb().prepare('SELECT categoria, titulo FROM mensagens_padrao WHERE ativo = 1 ORDER BY categoria').all();
    }

    // Monta estrutura dinâmica: { catPai -> { sub -> [cads] } }
    const SEP = '|';
    const catMap = new Map(); // catPai -> Map(sub -> Set(cad))

    rows.forEach(r => {
      const raw = r.categoria || '';
      const sep = raw.indexOf(SEP);
      const catPai = sep >= 0 ? raw.slice(0, sep) : raw;
      const sub    = sep >= 0 ? raw.slice(sep + 1) : '';
      const cad    = r.titulo || '';

      if (!catMap.has(catPai)) catMap.set(catPai, new Map());
      const subMap = catMap.get(catPai);
      if (!subMap.has(sub)) subMap.set(sub, new Set());
      if (cad) subMap.get(sub).add(cad);
    });

    const estrutura = [];
    catMap.forEach((subMap, catPai) => {
      const subs = [];
      subMap.forEach((cadsSet, sub) => {
        subs.push({ nome: sub, cads: [...cadsSet] });
      });
      estrutura.push({ nome: catPai, subs });
    });

    return res.json({ sucesso: true, dados: estrutura });
  } catch (e) {
    console.error('[MsgPadrao] getCategorias:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/mensagens-padrao/:id
// ─────────────────────────────────────────────────────────────────────────────
async function buscarPorId(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    let item;

    if (isSupa) {
      const { data, error } = await sb.from('mensagens_padrao')
        .select('*, usuarios!mensagens_padrao_criado_por_fkey(nome), funis!mensagens_padrao_funil_id_fkey(nome)')
        .eq('id', req.params.id)
        .single();
      if (error) throw error;
      item = data ? { ...data, criado_por_nome: data.usuarios?.nome, funil_nome: data.funis?.nome } : null;
    } else {
      const { getDb } = require('../database/db');
      item = getDb().prepare(`
        SELECT mp.*, u.nome AS criado_por_nome, f.nome AS funil_nome
        FROM mensagens_padrao mp
        LEFT JOIN usuarios u ON mp.criado_por = u.id
        LEFT JOIN funis    f ON mp.funil_id   = f.id
        WHERE mp.id = ?`).get(req.params.id);
    }

    if (!item) return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada.' });
    return res.json({ sucesso: true, dados: item });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mensagens-padrao
// ─────────────────────────────────────────────────────────────────────────────
async function criar(req, res) {
  try {
    const role = req.usuario.role;
    if (role === 'VENDEDOR') {
      return res.status(403).json({ sucesso: false, erro: 'Vendedores não podem criar mensagens.' });
    }

    const { titulo, categoria, texto, funil_id, etapa_id, ativo = 1 } = req.body;
    if (!titulo)    return res.status(400).json({ sucesso: false, erro: 'Título é obrigatório.' });
    if (!texto)     return res.status(400).json({ sucesso: false, erro: 'Texto é obrigatório.' });
    if (!categoria) return res.status(400).json({ sucesso: false, erro: 'Categoria é obrigatória.' });

    const id    = crypto.randomBytes(16).toString('hex');
    const agora = new Date().toISOString();
    const payload = {
      id,
      titulo:       titulo.trim(),
      categoria:    categoria.trim(),
      texto:        texto.trim(),
      funil_id:     funil_id  || null,
      etapa_id:     etapa_id  || null,
      ativo:        ativo ? 1 : 0,
      criado_por:   req.usuario.id,
      criado_em:    agora,
      atualizado_em: agora,
    };

    const { sb, isSupa } = getProvider();
    let criado;

    if (isSupa) {
      const { data, error } = await sb.from('mensagens_padrao').insert(payload).select().single();
      if (error) throw error;
      criado = data;
    } else {
      const { getDb } = require('../database/db');
      const db = getDb();
      db.prepare(`
        INSERT INTO mensagens_padrao
          (id, titulo, categoria, texto, funil_id, etapa_id, ativo, criado_por, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(id, payload.titulo, payload.categoria, payload.texto,
             payload.funil_id, payload.etapa_id, payload.ativo,
             payload.criado_por, agora, agora);
      criado = db.prepare('SELECT * FROM mensagens_padrao WHERE id = ?').get(id);
    }

    req.log({ acao: 'MSG_PADRAO_CRIAR', entidade: 'mensagens_padrao', entidade_id: id,
      depois: { titulo, categoria, funil_id } });

    return res.status(201).json({ sucesso: true, dados: criado });
  } catch (e) {
    console.error('[MsgPadrao] criar:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/mensagens-padrao/:id
// ─────────────────────────────────────────────────────────────────────────────
async function editar(req, res) {
  try {
    const role = req.usuario.role;
    if (role === 'VENDEDOR') {
      return res.status(403).json({ sucesso: false, erro: 'Vendedores não podem editar mensagens.' });
    }

    const { sb, isSupa } = getProvider();
    const { id } = req.params;
    const agora = new Date().toISOString();

    // Monta campos a atualizar
    const campos = {};
    ['titulo','categoria','texto','funil_id','etapa_id'].forEach(k => {
      if (req.body[k] !== undefined) campos[k] = req.body[k] || null;
    });
    if (req.body.titulo)   campos.titulo    = req.body.titulo.trim();
    if (req.body.texto)    campos.texto     = req.body.texto.trim();
    if (req.body.categoria) campos.categoria = req.body.categoria.trim();
    if (req.body.ativo !== undefined) campos.ativo = req.body.ativo ? 1 : 0;
    // ordem: habilitado somente após criação da coluna via supabase_patch_v9_msgs_ordem.sql
    campos.atualizado_em = agora;

    if (isSupa) {
      const { data, error } = await sb.from('mensagens_padrao')
        .update(campos)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.json({ sucesso: true, dados: data });
    }

    const { getDb } = require('../database/db');
    const db = getDb();
    const atual = db.prepare('SELECT * FROM mensagens_padrao WHERE id = ?').get(id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada.' });

    const sets = Object.keys(campos).map(k => `${k}=?`).join(',');
    db.prepare(`UPDATE mensagens_padrao SET ${sets} WHERE id = ?`).run(...Object.values(campos), id);

    req.log({ acao: 'MSG_PADRAO_EDITAR', entidade: 'mensagens_padrao', entidade_id: id,
      antes: atual, depois: campos });

    return res.json({ sucesso: true, dados: db.prepare('SELECT * FROM mensagens_padrao WHERE id = ?').get(id) });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/mensagens-padrao/:id
// ─────────────────────────────────────────────────────────────────────────────
async function deletar(req, res) {
  try {
    if (req.usuario.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ sucesso: false, erro: 'Apenas Super Admin pode excluir mensagens.' });
    }

    const { sb, isSupa } = getProvider();
    const { id } = req.params;

    if (isSupa) {
      const { data: atual, error: errBusca } = await sb.from('mensagens_padrao').select().eq('id', id).single();
      if (errBusca || !atual) return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada.' });
      const { error } = await sb.from('mensagens_padrao').delete().eq('id', id);
      if (error) throw error;
      req.log({ acao: 'MSG_PADRAO_DELETAR', entidade: 'mensagens_padrao', entidade_id: id, antes: atual });
      return res.json({ sucesso: true, mensagem: 'Mensagem excluída.' });
    }

    const { getDb } = require('../database/db');
    const db = getDb();
    const atual = db.prepare('SELECT * FROM mensagens_padrao WHERE id = ?').get(id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada.' });
    db.prepare('DELETE FROM mensagens_padrao WHERE id = ?').run(id);
    req.log({ acao: 'MSG_PADRAO_DELETAR', entidade: 'mensagens_padrao', entidade_id: id, antes: atual });
    return res.json({ sucesso: true, mensagem: 'Mensagem excluída.' });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/mensagens-padrao/:id/preview
// ─────────────────────────────────────────────────────────────────────────────
async function preview(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    let item;

    if (isSupa) {
      const { data, error } = await sb.from('mensagens_padrao').select().eq('id', req.params.id).single();
      if (error) throw error;
      item = data;
    } else {
      const { getDb } = require('../database/db');
      item = getDb().prepare('SELECT * FROM mensagens_padrao WHERE id = ?').get(req.params.id);
    }

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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mensagens-padrao/reordenar
// Body: { itens: [{ id, ordem }] }  — atualiza ordem em lote
// ─────────────────────────────────────────────────────────────────────────────
async function reordenar(req, res) {
  try {
    if (!['SUPER_ADMIN', 'GESTOR'].includes(req.usuario.role)) {
      return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    }
    const { itens } = req.body;
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ sucesso: false, erro: 'Informe a lista de itens.' });
    }
    const { sb, isSupa } = getProvider();
    const agora = new Date().toISOString();
    if (isSupa) {
      // Atualiza cada item individualmente (Supabase não tem upsert em lote fácil)
      const erros = [];
      for (const item of itens) {
        const { error } = await sb.from('mensagens_padrao')
          .update({ ordem: Number(item.ordem), atualizado_em: agora })
          .eq('id', item.id);
        if (error) erros.push(item.id);
      }
      if (erros.length > 0) {
        return res.status(500).json({ sucesso: false, erro: `Falha em ${erros.length} item(s).` });
      }
      return res.json({ sucesso: true, mensagem: `${itens.length} script(s) reordenado(s).` });
    }
    // SQLite
    const { getDb } = require('../database/db');
    const db = getDb();
    const stmt = db.prepare('UPDATE mensagens_padrao SET ordem = ?, atualizado_em = ? WHERE id = ?');
    db.transaction(() => { itens.forEach(item => stmt.run(Number(item.ordem), agora, item.id)); })();
    return res.json({ sucesso: true, mensagem: `${itens.length} script(s) reordenado(s).` });
  } catch (e) {
    console.error('[MsgPadrao] reordenar:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/mensagens-padrao/renomear-subcategoria
// Body: { catPai, subAntiga, subNova }  — renomeia apenas a subcategoria
// ─────────────────────────────────────────────────────────────────────────────
async function renomearSubcategoria(req, res) {
  try {
    if (req.usuario.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ sucesso: false, erro: 'Apenas Super Admin pode renomear.' });
    }
    const { catPai, subAntiga, subNova } = req.body;
    if (!catPai || !subAntiga || !subNova) {
      return res.status(400).json({ sucesso: false, erro: 'catPai, subAntiga e subNova são obrigatórios.' });
    }
    const catAntigaFull = `${catPai}|${subAntiga}`;
    const catNovaFull   = `${catPai}|${subNova}`;
    const agora = new Date().toISOString();
    const { sb, isSupa } = getProvider();
    if (isSupa) {
      const { data: alvo, error: errBusca } = await sb.from('mensagens_padrao')
        .select('id').eq('categoria', catAntigaFull);
      if (errBusca) throw errBusca;
      if (!alvo || alvo.length === 0) {
        return res.status(404).json({ sucesso: false, erro: 'Nenhuma mensagem encontrada nessa subcategoria.' });
      }
      const { error } = await sb.from('mensagens_padrao')
        .update({ categoria: catNovaFull, atualizado_em: agora })
        .eq('categoria', catAntigaFull);
      if (error) throw error;
      return res.json({ sucesso: true, mensagem: `${alvo.length} mensagem(ns) atualizada(s).`, total: alvo.length });
    }
    const { getDb } = require('../database/db');
    const db = getDb();
    const { changes } = db.prepare(
      'UPDATE mensagens_padrao SET categoria = ?, atualizado_em = ? WHERE categoria = ?'
    ).run(catNovaFull, agora, catAntigaFull);
    return res.json({ sucesso: true, mensagem: `${changes} mensagem(ns) atualizada(s).`, total: changes });
  } catch (e) {
    console.error('[MsgPadrao] renomearSubcategoria:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { listar, getCategorias, buscarPorId, criar, editar, deletar, preview, substituir, reordenar, renomearSubcategoria };
