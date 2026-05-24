/**
 * PROSPERKT CRM — Leads Controller
 * Supabase JS nativo quando DATABASE_PROVIDER=supabase, SQLite caso contrário.
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

// ── Helpers Supabase ──────────────────────────────────────────────────────────

function mapStatus(s) {
  // Normaliza status do Supabase (minúsculo) para padrão interno (maiúsculo)
  if (!s) return 'ABERTO';
  const m = { ativo:'ABERTO', ganho:'GANHO', perdido:'PERDIDO', arquivado:'ARQUIVADO',
               ABERTO:'ABERTO', GANHO:'GANHO', PERDIDO:'PERDIDO' };
  return m[s] || 'ABERTO';
}

function toSupaStatus(s) {
  const m = { ABERTO:'ativo', GANHO:'ganho', PERDIDO:'perdido', ARQUIVADO:'arquivado' };
  return m[s] || 'ativo';
}

function normalizeLead(l) {
  if (!l) return l;
  return { ...l, status: mapStatus(l.status) };
}

// ── GET /api/leads ────────────────────────────────────────────────────────────
async function listar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { funil_id, etapa_id, responsavel_id, status, busca } = req.query;

  try {
    if (isSupa) {
      let q = sb.from('leads').select(`
        *,
        responsavel:usuarios!responsavel_id(id,nome),
        etapa:etapas!etapa_id(id,nome,cor)
      `);

      if (etapa_id)       q = q.eq('etapa_id', etapa_id);
      if (responsavel_id) q = q.eq('responsavel_id', responsavel_id);
      if (funil_id)       q = q.eq('funil_id', funil_id);
      if (status)         q = q.eq('status', toSupaStatus(status));
      if (req.usuario.role === 'VENDEDOR') q = q.eq('responsavel_id', req.usuario.id);
      if (busca) q = q.or(`nome.ilike.%${busca}%,email.ilike.%${busca}%,telefone.ilike.%${busca}%,empresa.ilike.%${busca}%`);

      q = q.order('criado_em', { ascending: false });

      const { data, error } = await q;
      if (error) throw error;

      const leads = (data || []).map(l => ({
        ...normalizeLead(l),
        responsavel_nome: l.responsavel?.nome || null,
        etapa_nome: l.etapa?.nome || null,
        etapa_cor:  l.etapa?.cor  || null,
      }));
      return res.json({ sucesso:true, dados:leads, total:leads.length });
    }

    // SQLite
    let sql = `SELECT l.*, u.nome as responsavel_nome, e.nome as etapa_nome, e.cor as etapa_cor,
      f.nome as funil_nome, f.id as funil_id_real
      FROM leads l
      LEFT JOIN usuarios u ON l.responsavel_id=u.id
      LEFT JOIN etapas e ON l.etapa_id=e.id
      LEFT JOIN pipelines p ON l.pipeline_id=p.id
      LEFT JOIN funis f ON p.funil_id=f.id
      WHERE 1=1`;
    const params = [];
    if (funil_id)       { sql += ' AND p.funil_id=?';       params.push(funil_id); }
    if (etapa_id)       { sql += ' AND l.etapa_id=?';       params.push(etapa_id); }
    if (status)         { sql += ' AND l.status=?';          params.push(status); }
    if (responsavel_id) { sql += ' AND l.responsavel_id=?'; params.push(responsavel_id); }
    if (req.usuario.role === 'VENDEDOR') { sql += ' AND l.responsavel_id=?'; params.push(req.usuario.id); }
    if (busca) { sql += ' AND (l.nome LIKE ? OR l.email LIKE ? OR l.telefone LIKE ? OR l.empresa LIKE ?)'; const q=`%${busca}%`; params.push(q,q,q,q); }
    sql += ' ORDER BY l.criado_em DESC';
    const leads = sqlite.prepare(sql).all(...params);
    return res.json({ sucesso:true, dados:leads, total:leads.length });
  } catch(e) {
    console.error('[leads.listar]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── GET /api/leads/:id ────────────────────────────────────────────────────────
async function buscarPorId(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      const { data, error } = await sb.from('leads').select(`
        *, responsavel:usuarios!responsavel_id(id,nome), etapa:etapas!etapa_id(id,nome,cor)
      `).eq('id', req.params.id).single();
      if (error || !data) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
      if (req.usuario.role==='VENDEDOR' && data.responsavel_id !== req.usuario.id)
        return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
      const { data: msgs } = await sb.from('mensagens').select('*, autor:usuarios!usuario_id(nome)').eq('lead_id', req.params.id).order('criado_em');
      const mensagens = (msgs||[]).map(m=>({...m, autor_nome:m.autor?.nome||'Sistema'}));
      return res.json({ sucesso:true, dados:{ ...normalizeLead(data), responsavel_nome:data.responsavel?.nome, etapa_nome:data.etapa?.nome, etapa_cor:data.etapa?.cor, mensagens } });
    }
    const lead = sqlite.prepare(`SELECT l.*, u.nome as responsavel_nome, e.nome as etapa_nome, e.cor as etapa_cor, f.nome as funil_nome
      FROM leads l LEFT JOIN usuarios u ON l.responsavel_id=u.id LEFT JOIN etapas e ON l.etapa_id=e.id
      LEFT JOIN pipelines p ON l.pipeline_id=p.id LEFT JOIN funis f ON p.funil_id=f.id WHERE l.id=?`).get(req.params.id);
    if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
    if (req.usuario.role==='VENDEDOR' && lead.responsavel_id !== req.usuario.id) return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
    const mensagens = sqlite.prepare(`SELECT m.*, u.nome as autor_nome FROM mensagens m LEFT JOIN usuarios u ON m.usuario_id=u.id WHERE m.lead_id=? ORDER BY m.enviado_em`).all(req.params.id);
    return res.json({ sucesso:true, dados:{ ...lead, mensagens } });
  } catch(e) {
    console.error('[leads.buscarPorId]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── POST /api/leads ───────────────────────────────────────────────────────────
async function criar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { nome, email, telefone, empresa, cargo, valor, pipeline_id, etapa_id,
          responsavel_id, origem, tags, dados_extras, observacoes, funil_id } = req.body;
  if (!nome) return res.status(400).json({ sucesso:false, erro:'Nome é obrigatório.' });

  const respId = req.usuario.role==='VENDEDOR' ? req.usuario.id : (responsavel_id || req.usuario.id);
  const id = crypto.randomBytes(16).toString('hex');

  try {
    if (isSupa) {
      // Determina funil_id: do body, ou via pipeline_id→funis
      let fId = funil_id || null;
      if (!fId && pipeline_id) {
        const { data: p } = await sb.from('pipelines').select('funil_id').eq('id', pipeline_id).single();
        if (p) fId = p.funil_id;
      }

      const row = {
        id,
        nome: nome.trim(),
        email:          email        || null,
        telefone:       telefone     || null,
        empresa:        empresa      || null,
        cargo:          cargo        || null,
        valor:          valor        || 0,
        funil_id:       fId          || null,
        etapa_id:       etapa_id     || null,
        responsavel_id: respId,
        origem:         origem       || 'manual',
        status:         'ativo',      // sempre ABERTO para novo lead
        observacoes:    observacoes  || null,
        criado_em:      new Date().toISOString(),
        atualizado_em:  new Date().toISOString(),
      };

      const { data, error } = await sb.from('leads').insert(row).select().single();
      if (error) throw error;

      // Nota inicial como mensagem
      if (observacoes) {
        await sb.from('mensagens').insert({ id: crypto.randomBytes(16).toString('hex'), lead_id:id, usuario_id:req.usuario.id, texto:observacoes, tipo:'nota' });
      }

      req.log({ acao:'CREATE', entidade:'leads', entidade_id:id, depois:{ nome, etapa_id, funil_id:fId } });
      return res.status(201).json({ sucesso:true, dados: normalizeLead(data) });
    }

    // SQLite
    sqlite.prepare(`INSERT INTO leads (id,nome,email,telefone,empresa,cargo,valor,pipeline_id,etapa_id,responsavel_id,origem,tags,dados_extras,status,criado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'ABERTO',?)`).run(
      id, nome.trim(), email||null, telefone||null, empresa||null, cargo||null,
      valor||0, pipeline_id||null, etapa_id||null, respId, origem||null,
      tags ? JSON.stringify(tags) : null, dados_extras ? JSON.stringify(dados_extras) : null, req.usuario.id
    );
    if (observacoes) {
      sqlite.prepare(`INSERT INTO mensagens (id,lead_id,usuario_id,tipo,conteudo) VALUES (?,?,?,'NOTA',?)`).run(crypto.randomBytes(16).toString('hex'), id, req.usuario.id, observacoes);
    }
    req.log({ acao:'CREATE', entidade:'leads', entidade_id:id, depois:{ nome, pipeline_id, etapa_id } });
    return res.status(201).json({ sucesso:true, dados: sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id) });
  } catch(e) {
    console.error('[leads.criar]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── PATCH /api/leads/:id ──────────────────────────────────────────────────────
async function atualizar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  try {
    if (isSupa) {
      const { data: atual, error: errAtual } = await sb.from('leads').select('*').eq('id', id).single();
      if (errAtual || !atual) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
      if (req.usuario.role==='VENDEDOR' && atual.responsavel_id !== req.usuario.id) return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });

      const allow = ['nome','email','telefone','empresa','cargo','valor','origem','data_fechamento','motivo_perda','observacoes'];
      const upd = { atualizado_em: new Date().toISOString() };
      allow.forEach(k => { if (req.body[k] !== undefined) upd[k] = req.body[k]; });
      if (req.body.responsavel_id && req.usuario.role !== 'VENDEDOR') upd.responsavel_id = req.body.responsavel_id;

      const { data, error } = await sb.from('leads').update(upd).eq('id', id).select().single();
      if (error) throw error;
      return res.json({ sucesso:true, dados: normalizeLead(data) });
    }

    // SQLite
    const atual = sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id);
    if (!atual) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
    if (req.usuario.role==='VENDEDOR' && atual.responsavel_id !== req.usuario.id) return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
    const campos = {};
    ['nome','email','telefone','empresa','cargo','valor','origem','data_fechamento','motivo_perda','dados_extras'].forEach(k => { if (req.body[k] !== undefined) campos[k] = req.body[k]; });
    if (req.body.tags !== undefined) campos.tags = JSON.stringify(req.body.tags);
    if (req.body.responsavel_id && req.usuario.role !== 'VENDEDOR') campos.responsavel_id = req.body.responsavel_id;
    campos.atualizado_em = new Date().toISOString();
    const sets = Object.keys(campos).map(k=>`${k}=?`).join(',');
    sqlite.prepare(`UPDATE leads SET ${sets} WHERE id=?`).run(...Object.values(campos), id);
    return res.json({ sucesso:true, dados: sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id) });
  } catch(e) {
    console.error('[leads.atualizar]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── PATCH /api/leads/:id/mover ────────────────────────────────────────────────
async function mover(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  const { etapa_id, pipeline_id, motivo_perda } = req.body;
  if (!etapa_id) return res.status(400).json({ sucesso:false, erro:'etapa_id é obrigatório.' });

  try {
    if (isSupa) {
      const { data: lead, error: errL } = await sb.from('leads').select('*').eq('id', id).single();
      if (errL || !lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
      if (req.usuario.role==='VENDEDOR' && lead.responsavel_id !== req.usuario.id) return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });

      const { data: etapa, error: errE } = await sb.from('etapas').select('*').eq('id', etapa_id).single();
      if (errE || !etapa) return res.status(404).json({ sucesso:false, erro:'Etapa não encontrada.' });

      const isGanho   = etapa.is_ganho   || etapa.nome?.toLowerCase().includes('venda') || etapa.probabilidade >= 100;
      const isPerdido = etapa.is_perdido  || etapa.nome?.toLowerCase().includes('perdid') || etapa.nome?.toLowerCase().includes('desqualif');

      if (isPerdido && !motivo_perda && !lead.perdido_motivo)
        return res.status(400).json({ sucesso:false, erro:'motivo_perda é obrigatório ao mover para etapa perdida.' });

      const novoStatus = isGanho ? 'ganho' : isPerdido ? 'perdido' : 'ativo';
      const agora = new Date().toISOString();
      const upd = { etapa_id, atualizado_em: agora, status: novoStatus };
      if (isGanho && !lead.ganho_em) upd.ganho_em = agora;
      if (isPerdido && motivo_perda)  { upd.perdido_em = agora; upd.perdido_motivo = motivo_perda; }

      const { data, error } = await sb.from('leads').update(upd).eq('id', id).select().single();
      if (error) throw error;

      // Comissão automática ao ganhar
      if (isGanho && lead.responsavel_id && (lead.valor||0) > 0) {
        calcularComissaoSupabase(sb, lead, req).catch(e => console.error('[COMISSAO_AUTO]', e.message));
      }

      req.log({ acao:'MOVER', entidade:'leads', entidade_id:id, antes:{ etapa_id:lead.etapa_id, status:lead.status }, depois:{ etapa_id, status:novoStatus } });
      return res.json({ sucesso:true, dados: normalizeLead(data) });
    }

    // SQLite
    const lead = sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id);
    if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
    if (req.usuario.role==='VENDEDOR' && lead.responsavel_id !== req.usuario.id) return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });

    const etapa = sqlite.prepare('SELECT * FROM etapas WHERE id=?').get(etapa_id);
    if (!etapa) return res.status(404).json({ sucesso:false, erro:'Etapa não encontrada.' });

    if (etapa.is_perdido && !motivo_perda && !lead.motivo_perda)
      return res.status(400).json({ sucesso:false, erro:'motivo_perda é obrigatório ao mover para etapa perdida.' });

    const novoStatus = etapa.is_ganho ? 'GANHO' : etapa.is_perdido ? 'PERDIDO' : 'ABERTO';
    const agora = new Date().toISOString();
    const extras = {};
    if (etapa.is_ganho && !lead.data_fechamento) extras.data_fechamento = agora.slice(0,10);
    if (etapa.is_perdido && motivo_perda) extras.motivo_perda = motivo_perda;
    const extraSets = Object.keys(extras).map(k=>`${k}=?`).join(',');
    sqlite.prepare(`UPDATE leads SET etapa_id=?, pipeline_id=COALESCE(?,pipeline_id), status=?, atualizado_em=?${extraSets?','+extraSets:''} WHERE id=?`).run(etapa_id, pipeline_id||null, novoStatus, agora, ...Object.values(extras), id);

    req.log({ acao:'MOVER', entidade:'leads', entidade_id:id, antes:{ etapa_id:lead.etapa_id }, depois:{ etapa_id, status:novoStatus } });

    if (etapa.is_ganho && lead.responsavel_id && (lead.valor||0) > 0) {
      try { calcularComissaoSQLite(sqlite, lead, id, pipeline_id, agora, req); } catch(e) { console.error('[COMISSAO_AUTO]', e.message); }
    }
    return res.json({ sucesso:true, dados: sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id) });
  } catch(e) {
    console.error('[leads.mover]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── PATCH /api/leads/:id/transferir ──────────────────────────────────────────
async function transferir(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  if (req.usuario.role==='VENDEDOR') return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
  const { responsavel_id } = req.body;
  if (!responsavel_id) return res.status(400).json({ sucesso:false, erro:'responsavel_id é obrigatório.' });
  try {
    if (isSupa) {
      const { data, error } = await sb.from('leads').update({ responsavel_id, atualizado_em: new Date().toISOString() }).eq('id', req.params.id).select().single();
      if (error) throw error;
      return res.json({ sucesso:true, dados: normalizeLead(data) });
    }
    sqlite.prepare('UPDATE leads SET responsavel_id=?, atualizado_em=? WHERE id=?').run(responsavel_id, new Date().toISOString(), req.params.id);
    return res.json({ sucesso:true, dados: sqlite.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id) });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// ── DELETE /api/leads/:id ─────────────────────────────────────────────────────
async function deletar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  if (req.usuario.role==='VENDEDOR') return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
  try {
    if (isSupa) {
      const { error } = await sb.from('leads').delete().eq('id', req.params.id);
      if (error) throw error;
      return res.json({ sucesso:true, mensagem:'Lead excluído.' });
    }
    const lead = sqlite.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id);
    if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
    sqlite.prepare('DELETE FROM leads WHERE id=?').run(req.params.id);
    return res.json({ sucesso:true, mensagem:'Lead excluído.' });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// ── POST /api/leads/:id/mensagens ─────────────────────────────────────────────
async function adicionarMensagem(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { conteudo, tipo='NOTA' } = req.body;
  if (!conteudo) return res.status(400).json({ sucesso:false, erro:'Conteúdo é obrigatório.' });
  const id = crypto.randomBytes(16).toString('hex');
  try {
    if (isSupa) {
      const { data, error } = await sb.from('mensagens').insert({ id, lead_id:req.params.id, usuario_id:req.usuario.id, texto:conteudo, tipo:tipo.toLowerCase() }).select('*, autor:usuarios!usuario_id(nome)').single();
      if (error) throw error;
      return res.status(201).json({ sucesso:true, dados:{ ...data, autor_nome: data.autor?.nome||'Sistema' } });
    }
    sqlite.prepare(`INSERT INTO mensagens (id,lead_id,usuario_id,tipo,conteudo) VALUES (?,?,?,?,?)`).run(id, req.params.id, req.usuario.id, tipo, conteudo);
    const msg = sqlite.prepare(`SELECT m.*, u.nome as autor_nome FROM mensagens m LEFT JOIN usuarios u ON m.usuario_id=u.id WHERE m.id=?`).get(id);
    return res.status(201).json({ sucesso:true, dados:msg });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// ── Distribuição ──────────────────────────────────────────────────────────────
async function getDistribuicao(req, res) {
  const { sqlite, isSupa } = getProvider();
  if (isSupa) return res.json({ sucesso:true, dados:{ modo:'MANUAL', pesos:[] } });
  let cfg = sqlite.prepare("SELECT * FROM automacoes WHERE trigger_tipo='DISTRIBUICAO' LIMIT 1").get();
  if (!cfg) return res.json({ sucesso:true, dados:{ modo:'MANUAL', pesos:[] } });
  return res.json({ sucesso:true, dados:{ ...JSON.parse(cfg.acao_config||'{}'), id:cfg.id } });
}

async function setDistribuicao(req, res) {
  const { sqlite, isSupa } = getProvider();
  if (isSupa) return res.json({ sucesso:true, mensagem:'Configuração salva.' });
  const { modo='MANUAL', pesos=[] } = req.body;
  const config = JSON.stringify({ modo, pesos });
  let existente = sqlite.prepare("SELECT id FROM automacoes WHERE trigger_tipo='DISTRIBUICAO' LIMIT 1").get();
  if (existente) { sqlite.prepare("UPDATE automacoes SET acao_config=? WHERE id=?").run(config, existente.id); }
  else { const id = crypto.randomBytes(16).toString('hex'); sqlite.prepare(`INSERT INTO automacoes (id,nome,trigger_tipo,acao_tipo,acao_config,criado_por) VALUES (?,?,?,?,?,?)`).run(id,'Distribuição de Leads','DISTRIBUICAO','DISTRIBUIR',config,req.usuario.id); }
  return res.json({ sucesso:true, mensagem:'Configuração salva.' });
}

// ── Comissão automática Supabase ──────────────────────────────────────────────
async function calcularComissaoSupabase(sb, lead, req) {
  const mesRef = new Date().toISOString().slice(0,7);
  const { data: regras } = await sb.from('comissao_regras').select('*').eq('ativo', 1).or(`usuario_id.is.null,usuario_id.eq.${lead.responsavel_id}`).order('valor_min', { ascending:true });
  if (!regras?.length) return;
  let regra = regras[0];
  for (const r of regras) { if ((lead.valor||0) >= (r.valor_min||0)) regra = r; }
  const valorVenda = lead.valor || 0;
  const comissaoBase = regra.tipo_calculo === 'PERCENTUAL' ? valorVenda * (regra.percentual||0)/100 : (regra.valor_fixo||0);
  const comId = crypto.randomBytes(16).toString('hex');
  await sb.from('comissoes').insert({ id:comId, usuario_id:lead.responsavel_id, lead_id:lead.id, valor_venda:valorVenda, percentual:valorVenda>0?(comissaoBase/valorVenda)*100:0, valor_comissao:comissaoBase, status:'PENDENTE', periodo_ref:mesRef });
}

// ── Comissão automática SQLite ────────────────────────────────────────────────
function calcularComissaoSQLite(db, lead, leadId, pipeline_id, agora, req) {
  const valorVenda = lead.valor || 0;
  const mesRef = agora.slice(0,7);
  const pipelineInfo = db.prepare(`SELECT p.funil_id FROM pipelines p WHERE p.id=?`).get(pipeline_id||lead.pipeline_id);
  const regras = db.prepare(`SELECT * FROM comissao_regras WHERE ativo=1 AND (usuario_id IS NULL OR usuario_id=?) AND (funil_id IS NULL OR funil_id=?) ORDER BY valor_min ASC`).all(lead.responsavel_id, pipelineInfo?.funil_id||'');
  let regra = regras[0] || null;
  for (const r of regras) { if (valorVenda >= (r.valor_min||0)) regra = r; }
  if (!regra) return;
  const comissaoBase = regra.tipo_calculo === 'PERCENTUAL' ? valorVenda * (regra.percentual||0)/100 : (regra.valor_fixo||0);
  const comId = require('crypto').randomBytes(16).toString('hex');
  db.prepare(`INSERT OR IGNORE INTO comissoes (id,usuario_id,lead_id,valor_venda,percentual,valor_comissao,status,periodo_ref,observacoes) VALUES (?,?,?,?,?,?,'PENDENTE',?,?)`).run(comId, lead.responsavel_id, leadId, valorVenda, valorVenda>0?(comissaoBase/valorVenda)*100:0, comissaoBase, mesRef, `Regra: ${regra.nome}`);
}

module.exports = { listar, buscarPorId, criar, atualizar, mover, transferir, deletar, adicionarMensagem, getDistribuicao, setDistribuicao };
