/**
 * PROSPERKT CRM — Metas Controller v2
 * Planejamento comercial por vendedor / mês / funil
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

const TIPOS_VALIDOS = ['FATURAMENTO','QUANTIDADE_VENDAS','LEADS_RECEBIDOS','ORCAMENTOS_ENVIADOS','CONVERSAO','TICKET_MEDIO'];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula o realizado de uma meta puxando do CRM (SQLite síncrono)
 * Filtra por: mês, ano, vendedor (usuario_id), funil (funil_id ou todos)
 */
function calcularRealizado(db, meta) {
  const params = [];

  // Base join — leads → pipelines → funis
  let whereClause = 'WHERE 1=1';

  // Filtro de vendedor
  if (meta.usuario_id) {
    whereClause += ' AND l.responsavel_id = ?';
    params.push(meta.usuario_id);
  }

  // Filtro de funil (só se funil específico)
  if (meta.funil_id && meta.funil_tipo !== 'TODOS') {
    whereClause += ' AND p.funil_id = ?';
    params.push(meta.funil_id);
  }

  // Filtro de mês/ano via strftime
  if (meta.mes && meta.ano) {
    whereClause += ` AND strftime('%m', l.criado_em) = ? AND strftime('%Y', l.criado_em) = ?`;
    params.push(String(meta.mes).padStart(2, '0'), String(meta.ano));
  }

  const joinSql = `FROM leads l
    LEFT JOIN pipelines p ON l.pipeline_id = p.id
    ${whereClause}`;

  try {
    switch (meta.tipo) {
      case 'FATURAMENTO': {
        const r = db.prepare(`SELECT COALESCE(SUM(l.valor),0) AS v ${joinSql} AND l.status='GANHO'`).get(...params);
        return r?.v || 0;
      }
      case 'QUANTIDADE_VENDAS': {
        const r = db.prepare(`SELECT COUNT(*) AS v ${joinSql} AND l.status='GANHO'`).get(...params);
        return r?.v || 0;
      }
      case 'LEADS_RECEBIDOS': {
        const r = db.prepare(`SELECT COUNT(*) AS v ${joinSql}`).get(...params);
        return r?.v || 0;
      }
      case 'ORCAMENTOS_ENVIADOS': {
        // Leads em etapas cujo nome contenha "Orçamento"
        const r = db.prepare(`SELECT COUNT(*) AS v ${joinSql}
          AND l.etapa_id IN (SELECT id FROM etapas WHERE nome LIKE '%Or%amento%' OR nome LIKE '%Orcamento%')`).get(...params);
        return r?.v || 0;
      }
      case 'CONVERSAO': {
        const totalR  = db.prepare(`SELECT COUNT(*) AS v ${joinSql}`).get(...params);
        const ganhosR = db.prepare(`SELECT COUNT(*) AS v ${joinSql} AND l.status='GANHO'`).get(...params);
        const total  = totalR?.v  || 0;
        const ganhos = ganhosR?.v || 0;
        return total > 0 ? parseFloat(((ganhos / total) * 100).toFixed(1)) : 0;
      }
      case 'TICKET_MEDIO': {
        const r = db.prepare(`SELECT COALESCE(AVG(l.valor),0) AS v ${joinSql} AND l.status='GANHO'`).get(...params);
        return parseFloat((r?.v || 0).toFixed(2));
      }
      default: return 0;
    }
  } catch (e) {
    console.error('[Metas] calcularRealizado error:', e.message);
    return 0;
  }
}

function enriquecerMeta(db, m) {
  const realizado  = calcularRealizado(db, m);
  const meta_val   = m.valor_alvo || 0;
  const pct        = meta_val > 0 ? parseFloat(((realizado / meta_val) * 100).toFixed(1)) : 0;
  const gap        = Math.max(0, meta_val - realizado);
  let   status_str = 'ABAIXO';
  if (pct >= 110) status_str = 'SUPERADA';
  else if (pct >= 100) status_str = 'ATINGIDA';
  else if (pct >= 50)  status_str = 'EM_EVOLUCAO';
  return { ...m, realizado, pct, gap, status_calc: status_str };
}

async function enriquecerMetaSupa(sb, m) {
  let realizado = 0;
  try {
    const mesStr = String(m.mes).padStart(2, '0');
    const anoStr = String(m.ano);
    const de  = `${anoStr}-${mesStr}-01T00:00:00`;
    // Calcula o último dia real do mês (evita erro para meses com < 31 dias)
    const ultimoDia = new Date(Number(m.ano), Number(m.mes), 0).getDate();
    const ate = `${anoStr}-${mesStr}-${String(ultimoDia).padStart(2,'0')}T23:59:59`;

    let qLeads = sb.from('leads').select('id,status,valor,valor_venda,responsavel_id,etapa_id,funil_id,criado_em');
    if (m.usuario_id) qLeads = qLeads.eq('responsavel_id', m.usuario_id);
    if (m.funil_id && m.funil_tipo !== 'TODOS') qLeads = qLeads.eq('funil_id', m.funil_id);
    qLeads = qLeads.gte('criado_em', de).lte('criado_em', ate);
    const { data: leadsRaw, error: leadsErr } = await qLeads;
    if (leadsErr) console.error('[Metas] enriquecerMetaSupa leads error:', leadsErr.message);
    const leads = leadsRaw || [];

    const ganhos = leads.filter(l => {
      const s = (l.status || '').toUpperCase();
      return ['GANHO','VENDIDO','VENDA'].includes(s) || l.ganho_em;
    });

    switch (m.tipo) {
      case 'FATURAMENTO':
        realizado = ganhos.reduce((s, l) => s + Number(l.valor_venda || l.valor || 0), 0);
        break;
      case 'QUANTIDADE_VENDAS':
        realizado = ganhos.length;
        break;
      case 'LEADS_RECEBIDOS':
        realizado = leads.length;
        break;
      case 'ORCAMENTOS_ENVIADOS': {
        const { data: etOrc = [] } = await sb.from('etapas').select('id').ilike('nome', '%or%amento%');
        const ids = etOrc.map(e => e.id);
        realizado = leads.filter(l => ids.includes(l.etapa_id)).length;
        break;
      }
      case 'CONVERSAO':
        realizado = leads.length > 0 ? parseFloat(((ganhos.length / leads.length) * 100).toFixed(1)) : 0;
        break;
      case 'TICKET_MEDIO':
        realizado = ganhos.length > 0
          ? parseFloat((ganhos.reduce((s, l) => s + Number(l.valor_venda || l.valor || 0), 0) / ganhos.length).toFixed(2))
          : 0;
        break;
      default: realizado = 0;
    }
  } catch (e) {
    console.error('[Metas] enriquecerMetaSupa error:', e.message);
  }

  const meta_val   = m.valor_alvo || 0;
  const pct        = meta_val > 0 ? parseFloat(((realizado / meta_val) * 100).toFixed(1)) : 0;
  const gap        = Math.max(0, meta_val - realizado);
  let   status_str = 'ABAIXO';
  if (pct >= 110) status_str = 'SUPERADA';
  else if (pct >= 100) status_str = 'ATINGIDA';
  else if (pct >= 50)  status_str = 'EM_EVOLUCAO';
  return { ...m, realizado, pct, gap, status_calc: status_str };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/metas
// ─────────────────────────────────────────────────────────────────────────────
async function listar(req, res) {
  try {
    const { isSupa, sb, sqlite: db } = getProvider();
    const filtros = { ...req.query, role: req.usuario?.role };
    console.log('METAS_LIST_REQUEST', { filtros });

    if (isSupa) {
      // Supabase: busca metas + enriquece via leads do Supabase
      // NOTA: especificar FK explicitamente evita ambiguidade PGRST201
      // (metas tem dois FK para usuarios: usuario_id e criado_por)
      let q = sb.from('metas')
        .select('*, usuarios!metas_usuario_id_fkey(nome), funis!metas_funil_id_fkey(nome)')
        .eq('ativo', 1);
      const { funil_id, usuario_id, mes, ano, tipo } = req.query;
      if (funil_id)   q = q.eq('funil_id', funil_id);
      if (usuario_id) q = q.eq('usuario_id', usuario_id);
      if (mes)        q = q.eq('mes', Number(mes));
      if (ano)        q = q.eq('ano', Number(ano));
      if (tipo)       q = q.eq('tipo', tipo);
      if (req.usuario.role === 'VENDEDOR') q = q.eq('usuario_id', req.usuario.id);
      q = q.order('ano', { ascending: false }).order('mes', { ascending: false });
      const { data, error } = await q;
      if (error) {
        console.error('METAS_LIST_ERROR', error);
        throw error;
      }
      const metas = (data || []).map(m => ({
        ...m,
        usuario_nome: m.usuarios?.nome || null,
        funil_nome:   m.funis?.nome   || null,
      }));
      const comRealizado = await Promise.all(metas.map(m => enriquecerMetaSupa(sb, m)));
      console.log('METAS_LIST_RESPONSE', { total: comRealizado.length });
      return res.json({ sucesso: true, dados: comRealizado, total: comRealizado.length });
    }
    const { funil_id, usuario_id, mes, ano, tipo } = req.query;

    let sql = `
      SELECT m.*,
             u.nome AS usuario_nome,
             f.nome AS funil_nome
      FROM   metas m
      LEFT JOIN usuarios u ON m.usuario_id = u.id
      LEFT JOIN funis    f ON m.funil_id   = f.id
      WHERE  m.ativo = 1
    `;
    const params = [];

    // Filtros query-string
    if (funil_id)   { sql += ' AND m.funil_id = ?';   params.push(funil_id); }
    if (usuario_id) { sql += ' AND m.usuario_id = ?'; params.push(usuario_id); }
    if (mes)        { sql += ' AND m.mes = ?';        params.push(Number(mes)); }
    if (ano)        { sql += ' AND m.ano = ?';        params.push(Number(ano)); }
    if (tipo)       { sql += ' AND m.tipo = ?';       params.push(tipo); }

    // VENDEDOR só vê as próprias metas
    if (req.usuario.role === 'VENDEDOR') {
      sql += ' AND m.usuario_id = ?';
      params.push(req.usuario.id);
    }

    sql += ' ORDER BY m.ano DESC, m.mes DESC, m.criado_em DESC';

    const metas = db.prepare(sql).all(...params);
    const comRealizado = metas.map(m => enriquecerMeta(db, m));

    return res.json({ sucesso: true, dados: comRealizado, total: comRealizado.length });
  } catch (e) {
    console.error('[Metas] listar error:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao listar metas.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/metas
// ─────────────────────────────────────────────────────────────────────────────
async function criar(req, res) {
  if (!['SUPER_ADMIN', 'GESTOR'].includes(req.usuario.role))
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

  try {
    const { isSupa, sb, sqlite: db } = getProvider();
    if (isSupa) {
      const { usuario_id, funil_id, funil_tipo, mes, ano, tipo, valor_alvo, observacoes } = req.body;
      console.log('METAS_CREATE_PAYLOAD', { usuario_id, funil_id, funil_tipo, mes, ano, tipo, valor_alvo });
      if (!tipo || !TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ sucesso:false, erro:'Tipo inválido.' });
      if (!mes || mes < 1 || mes > 12) return res.status(400).json({ sucesso:false, erro:'Mês inválido.' });
      if (!ano) return res.status(400).json({ sucesso:false, erro:'Ano inválido.' });
      if (valor_alvo === undefined || isNaN(Number(valor_alvo))) return res.status(400).json({ sucesso:false, erro:'Valor obrigatório.' });
      const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const { data, error } = await sb.from('metas').insert({
        usuario_id: usuario_id || null,
        funil_id:   funil_id   || null,
        funil_tipo: funil_tipo || 'TODOS',
        mes: Number(mes), ano: Number(ano),
        titulo: `${tipo} — ${MESES[mes-1]}/${ano}`,
        tipo, valor_alvo: Number(valor_alvo),
        observacoes: observacoes || null,
        criado_por: req.usuario.id,
        ativo: 1,
      }).select('*, usuarios!metas_usuario_id_fkey(nome), funis!metas_funil_id_fkey(nome)').single();
      if (error) {
        console.error('METAS_CREATE_ERROR', error);
        throw error;
      }
      const m = { ...data, usuario_nome: data.usuarios?.nome || null, funil_nome: data.funis?.nome || null };
      req.log({ acao:'CREATE', entidade:'metas', entidade_id: data.id, depois: req.body });
      return res.status(201).json({ sucesso: true, dados: await enriquecerMetaSupa(sb, m) });
    }
    const { usuario_id, funil_id, funil_tipo, mes, ano, tipo, valor_alvo, observacoes } = req.body;

    // Validações
    if (!tipo || !TIPOS_VALIDOS.includes(tipo))
      return res.status(400).json({ sucesso: false, erro: `Tipo inválido. Use: ${TIPOS_VALIDOS.join(', ')}` });
    if (!mes || mes < 1 || mes > 12)
      return res.status(400).json({ sucesso: false, erro: 'Mês inválido (1-12).' });
    if (!ano || ano < 2020 || ano > 2030)
      return res.status(400).json({ sucesso: false, erro: 'Ano inválido.' });
    if (valor_alvo === undefined || valor_alvo === null || isNaN(Number(valor_alvo)))
      return res.status(400).json({ sucesso: false, erro: 'Valor da meta obrigatório.' });

    const id = crypto.randomBytes(16).toString('hex');
    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const titulo_auto = `${tipo} — ${MESES[mes-1]}/${ano}`;

    db.prepare(`
      INSERT INTO metas
        (id, usuario_id, funil_id, funil_tipo, mes, ano, titulo, tipo, valor_alvo, observacoes, criado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      usuario_id || null,
      funil_id   || null,
      funil_tipo || 'TODOS',
      Number(mes),
      Number(ano),
      titulo_auto,
      tipo,
      Number(valor_alvo),
      observacoes || null,
      req.usuario.id
    );

    req.log({ acao: 'CREATE', entidade: 'metas', entidade_id: id,
      depois: { tipo, mes, ano, valor_alvo, usuario_id, funil_id } });

    const criada = db.prepare('SELECT m.*, u.nome AS usuario_nome, f.nome AS funil_nome FROM metas m LEFT JOIN usuarios u ON m.usuario_id=u.id LEFT JOIN funis f ON m.funil_id=f.id WHERE m.id=?').get(id);
    return res.status(201).json({ sucesso: true, dados: enriquecerMeta(db, criada) });
  } catch (e) {
    console.error('[Metas] criar error:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao criar meta.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/metas/:id
// ─────────────────────────────────────────────────────────────────────────────
async function atualizar(req, res) {
  if (!['SUPER_ADMIN', 'GESTOR'].includes(req.usuario.role))
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

  try {
    const { isSupa, sb, sqlite: db } = getProvider();
    if (isSupa) {
      const campos = {};
      ['tipo','valor_alvo','funil_id','funil_tipo','usuario_id','mes','ano','observacoes','ativo'].forEach(k => {
        if (req.body[k] !== undefined) campos[k] = req.body[k];
      });
      if (campos.tipo && !TIPOS_VALIDOS.includes(campos.tipo)) return res.status(400).json({ sucesso:false, erro:'Tipo inválido.' });
      campos.atualizado_em = new Date().toISOString();
      const { data, error } = await sb.from('metas').update(campos).eq('id', req.params.id)
        .select('*, usuarios!metas_usuario_id_fkey(nome), funis!metas_funil_id_fkey(nome)').single();
      if (error) throw error;
      if (!data) return res.status(404).json({ sucesso:false, erro:'Meta não encontrada.' });
      const m = { ...data, usuario_nome: data.usuarios?.nome || null, funil_nome: data.funis?.nome || null };
      req.log({ acao:'UPDATE', entidade:'metas', entidade_id: req.params.id, depois: campos });
      return res.json({ sucesso: true, dados: await enriquecerMetaSupa(sb, m) });
    }
    const atual = db.prepare('SELECT * FROM metas WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Meta não encontrada.' });

    const campos = {};
    ['tipo','valor_alvo','funil_id','funil_tipo','usuario_id','mes','ano','observacoes','ativo'].forEach(k => {
      if (req.body[k] !== undefined) campos[k] = req.body[k];
    });

    if (campos.tipo && !TIPOS_VALIDOS.includes(campos.tipo))
      return res.status(400).json({ sucesso: false, erro: 'Tipo inválido.' });

    // Regenera título se mudou mês/ano/tipo
    const novoMes  = campos.mes  || atual.mes;
    const novoAno  = campos.ano  || atual.ano;
    const novoTipo = campos.tipo || atual.tipo;
    if (campos.mes || campos.ano || campos.tipo) {
      const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      campos.titulo = `${novoTipo} — ${MESES[novoMes-1]}/${novoAno}`;
    }

    campos.atualizado_em = new Date().toISOString();
    const sets = Object.keys(campos).map(k => `${k}=?`).join(',');
    db.prepare(`UPDATE metas SET ${sets} WHERE id=?`).run(...Object.values(campos), req.params.id);

    req.log({ acao: 'UPDATE', entidade: 'metas', entidade_id: req.params.id, antes: atual, depois: campos });

    const atualizada = db.prepare('SELECT m.*, u.nome AS usuario_nome, f.nome AS funil_nome FROM metas m LEFT JOIN usuarios u ON m.usuario_id=u.id LEFT JOIN funis f ON m.funil_id=f.id WHERE m.id=?').get(req.params.id);
    return res.json({ sucesso: true, dados: enriquecerMeta(db, atualizada) });
  } catch (e) {
    console.error('[Metas] atualizar error:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar meta.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/metas/:id  (soft delete)
// ─────────────────────────────────────────────────────────────────────────────
async function deletar(req, res) {
  if (!['SUPER_ADMIN', 'GESTOR'].includes(req.usuario.role))
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

  try {
    const { isSupa, sb, sqlite: db } = getProvider();
    if (isSupa) {
      const { error } = await sb.from('metas').update({ ativo: false, atualizado_em: new Date().toISOString() }).eq('id', req.params.id);
      if (error) throw error;
      req.log({ acao:'DELETE', entidade:'metas', entidade_id: req.params.id });
      return res.json({ sucesso: true, mensagem: 'Meta removida.' });
    }
    const meta = db.prepare('SELECT * FROM metas WHERE id=?').get(req.params.id);
    if (!meta) return res.status(404).json({ sucesso: false, erro: 'Meta não encontrada.' });

    db.prepare('UPDATE metas SET ativo=0, atualizado_em=? WHERE id=?').run(new Date().toISOString(), req.params.id);
    req.log({ acao: 'DELETE', entidade: 'metas', entidade_id: req.params.id });
    return res.json({ sucesso: true, mensagem: 'Meta removida.' });
  } catch (e) {
    console.error('[Metas] deletar error:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao remover meta.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/metas/:id/duplicar
// ─────────────────────────────────────────────────────────────────────────────
async function duplicar(req, res) {
  if (!['SUPER_ADMIN', 'GESTOR'].includes(req.usuario.role))
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

  try {
    const { isSupa, sb, sqlite: db } = getProvider();
    if (isSupa) {
      const { data: src } = await sb.from('metas').select('*').eq('id', req.params.id).eq('ativo', 1).single();
      if (!src) return res.status(404).json({ sucesso:false, erro:'Meta não encontrada.' });
      let novoMes = (src.mes || 1) + 1, novoAno = src.ano || new Date().getFullYear();
      if (novoMes > 12) { novoMes = 1; novoAno++; }
      const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const { data, error } = await sb.from('metas').insert({
        usuario_id: src.usuario_id, funil_id: src.funil_id, funil_tipo: src.funil_tipo || 'TODOS',
        mes: novoMes, ano: novoAno,
        titulo: `${src.tipo} — ${MESES[novoMes-1]}/${novoAno}`,
        tipo: src.tipo, valor_alvo: src.valor_alvo,
        observacoes: src.observacoes, criado_por: req.usuario.id, ativo: 1,
      }).select('*, usuarios!metas_usuario_id_fkey(nome), funis!metas_funil_id_fkey(nome)').single();
      if (error) throw error;
      const m = { ...data, usuario_nome: data.usuarios?.nome || null, funil_nome: data.funis?.nome || null };
      req.log({ acao:'DUPLICATE', entidade:'metas', entidade_id: data.id, depois:{ src_id: src.id } });
      return res.status(201).json({ sucesso: true, dados: await enriquecerMetaSupa(sb, m) });
    }
    const src = db.prepare('SELECT * FROM metas WHERE id=? AND ativo=1').get(req.params.id);
    if (!src) return res.status(404).json({ sucesso: false, erro: 'Meta não encontrada.' });

    const novoId  = crypto.randomBytes(16).toString('hex');
    // Avança mês por padrão
    let novoMes = (src.mes || 1) + 1, novoAno = src.ano || new Date().getFullYear();
    if (novoMes > 12) { novoMes = 1; novoAno++; }

    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const titulo = `${src.tipo} — ${MESES[novoMes-1]}/${novoAno}`;

    db.prepare(`
      INSERT INTO metas (id, usuario_id, funil_id, funil_tipo, mes, ano, titulo, tipo, valor_alvo, observacoes, criado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(novoId, src.usuario_id, src.funil_id, src.funil_tipo || 'TODOS', novoMes, novoAno,
           titulo, src.tipo, src.valor_alvo, src.observacoes, req.usuario.id);

    req.log({ acao: 'DUPLICATE', entidade: 'metas', entidade_id: novoId, depois: { src_id: src.id } });
    const criada = db.prepare('SELECT m.*, u.nome AS usuario_nome, f.nome AS funil_nome FROM metas m LEFT JOIN usuarios u ON m.usuario_id=u.id LEFT JOIN funis f ON m.funil_id=f.id WHERE m.id=?').get(novoId);
    return res.status(201).json({ sucesso: true, dados: enriquecerMeta(db, criada) });
  } catch (e) {
    console.error('[Metas] duplicar error:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao duplicar meta.', detalhe: e.message });
  }
}

module.exports = { listar, criar, atualizar, deletar, duplicar };
