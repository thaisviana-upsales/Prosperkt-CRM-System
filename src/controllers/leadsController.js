/**
 * PROSPERKT CRM — Leads Controller
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');
const automacoesMsg = require('./automacoesMsgController');

function aplicarFiltroRole(sql, params, usuario) {
  if (usuario.role === 'VENDEDOR') {
    sql += ' AND l.responsavel_id=?'; params.push(usuario.id);
  }
  return sql;
}

// Calcula intervalo de datas a partir de período nomeado
function calcularIntervalo(periodo) {
  const hoje = new Date();
  const ini  = d => d.toISOString().slice(0,10);
  switch (periodo) {
    case 'hoje':      return { de: ini(hoje), ate: ini(hoje) };
    case 'ontem':     { const d = new Date(hoje); d.setDate(d.getDate()-1); return { de:ini(d), ate:ini(d) }; }
    case '7d':        { const d = new Date(hoje); d.setDate(d.getDate()-6); return { de:ini(d), ate:ini(hoje) }; }
    case '30d':       { const d = new Date(hoje); d.setDate(d.getDate()-29); return { de:ini(d), ate:ini(hoje) }; }
    case 'mes_atual': { const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1); return { de:ini(d), ate:ini(hoje) }; }
    case 'mes_ant':   {
      const d1 = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1);
      const d2 = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
      return { de:ini(d1), ate:ini(d2) };
    }
    default: return null;
  }
}

// GET /api/leads
function listar(req, res) {
  const db = getDb();
  const { funil_id, etapa_id, responsavel_id, status, busca, pipeline_id,
          data_tipo, data_periodo, data_inicio, data_fim } = req.query;

  let sql = `SELECT l.*,
    u.nome as responsavel_nome,
    e.nome as etapa_nome, e.cor as etapa_cor,
    f.nome as funil_nome, f.id as funil_id_real
    FROM leads l
    LEFT JOIN usuarios u ON l.responsavel_id=u.id
    LEFT JOIN etapas e ON l.etapa_id=e.id
    LEFT JOIN pipelines p ON l.pipeline_id=p.id
    LEFT JOIN funis f ON p.funil_id=f.id
    WHERE 1=1`;
  const params = [];

  if (funil_id)       { sql += ' AND p.funil_id=?';      params.push(funil_id); }
  if (pipeline_id)    { sql += ' AND l.pipeline_id=?';   params.push(pipeline_id); }
  if (etapa_id)       { sql += ' AND l.etapa_id=?';      params.push(etapa_id); }
  if (status)         { sql += ' AND l.status=?';         params.push(status); }
  if (responsavel_id) { sql += ' AND l.responsavel_id=?'; params.push(responsavel_id); }
  if (busca) {
    sql += ' AND (l.nome LIKE ? OR l.email LIKE ? OR l.telefone LIKE ? OR l.empresa LIKE ?)';
    const q = `%${busca}%`;
    params.push(q,q,q,q);
  }

  // Filtros de data
  if (data_tipo) {
    const coluna = {
      criacao:     'l.criado_em',
      fechamento:  'l.data_fechamento',
      perdido:     'l.atualizado_em', // usa atualizado_em quando status=PERDIDO
    }[data_tipo] || 'l.criado_em';

    if (data_tipo === 'perdido') {
      sql += " AND l.status='PERDIDO'";
    }

    let de = data_inicio, ate = data_fim;
    if (data_periodo && data_periodo !== 'personalizado') {
      const intervalo = calcularIntervalo(data_periodo);
      if (intervalo) { de = intervalo.de; ate = intervalo.ate; }
    }
    if (de)  { sql += ` AND date(${coluna}) >= ?`; params.push(de); }
    if (ate) { sql += ` AND date(${coluna}) <= ?`; params.push(ate); }
  }

  sql = aplicarFiltroRole(sql, params, req.usuario);
  sql += ' ORDER BY l.criado_em DESC';

  const leads = db.prepare(sql).all(...params);
  return res.json({ sucesso:true, dados:leads, total:leads.length });
}

// GET /api/leads/:id
function buscarPorId(req, res) {
  const db = getDb();
  const lead = db.prepare(`SELECT l.*,
    u.nome as responsavel_nome,
    e.nome as etapa_nome, e.cor as etapa_cor,
    f.nome as funil_nome
    FROM leads l
    LEFT JOIN usuarios u ON l.responsavel_id=u.id
    LEFT JOIN etapas e ON l.etapa_id=e.id
    LEFT JOIN pipelines p ON l.pipeline_id=p.id
    LEFT JOIN funis f ON p.funil_id=f.id
    WHERE l.id=?`).get(req.params.id);
  if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });

  // VENDEDOR só vê seus próprios leads
  if (req.usuario.role==='VENDEDOR' && lead.responsavel_id !== req.usuario.id)
    return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });

  const mensagens = db.prepare(`SELECT m.*, u.nome as autor_nome FROM mensagens m
    LEFT JOIN usuarios u ON m.usuario_id=u.id WHERE m.lead_id=? ORDER BY m.enviado_em`).all(req.params.id);

  return res.json({ sucesso:true, dados:{ ...lead, mensagens } });
}

// POST /api/leads
function criar(req, res) {
  const db = getDb();
  const { nome, email, telefone, empresa, cargo, valor, pipeline_id, etapa_id,
          responsavel_id, origem, tags, dados_extras, observacoes } = req.body;
  if (!nome) return res.status(400).json({ sucesso:false, erro:'Nome é obrigatório.' });

  // VENDEDOR só pode criar para si mesmo
  const respId = req.usuario.role==='VENDEDOR' ? req.usuario.id : (responsavel_id || req.usuario.id);

  const id = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO leads (id,nome,email,telefone,empresa,cargo,valor,
    pipeline_id,etapa_id,responsavel_id,origem,tags,dados_extras,status,criado_por)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'ABERTO',?)`).run(
    id, nome.trim(), email||null, telefone||null, empresa||null, cargo||null,
    valor||0, pipeline_id||null, etapa_id||null, respId, origem||null,
    tags ? JSON.stringify(tags) : null,
    dados_extras ? JSON.stringify(dados_extras) : null, req.usuario.id
  );

  // Salva observação inicial como mensagem
  if (observacoes) {
    const msgId = crypto.randomBytes(16).toString('hex');
    db.prepare(`INSERT INTO mensagens (id,lead_id,usuario_id,tipo,conteudo) VALUES (?,?,?,'NOTA',?)`)
      .run(msgId, id, req.usuario.id, observacoes);
  }

  req.log({ acao:'CREATE', entidade:'leads', entidade_id:id, depois:{ nome, pipeline_id, etapa_id } });
  const criado = db.prepare('SELECT * FROM leads WHERE id=?').get(id);

  // ── Hook: dispara primeira mensagem automática via WhatsApp ──
  // Executa assincronamente (não bloqueia a resposta)
  setImmediate(() => {
    automacoesMsg.dispararPrimeiraMensagem({
      lead: criado,
      db,
      logFn: ({ acao, entidade, entidade_id, depois }) => {
        try {
          const { registrarLog } = require('../services/auditService');
          registrarLog({
            acao, entidade, entidade_id,
            depois: typeof depois === 'object' ? JSON.stringify(depois) : depois,
            usuario: req.usuario
          });
        } catch(_) {}
      }
    });
  });

  return res.status(201).json({ sucesso:true, dados:criado });
}

// PATCH /api/leads/:id
function atualizar(req, res) {
  const db = getDb();
  const { id } = req.params;
  const atual = db.prepare('SELECT * FROM leads WHERE id=?').get(id);
  if (!atual) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
  if (req.usuario.role==='VENDEDOR' && atual.responsavel_id !== req.usuario.id)
    return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });

  const campos = {};
  ['nome','email','telefone','empresa','cargo','valor','origem','status',
   'data_fechamento','motivo_perda','dados_extras'].forEach(k => {
    if (req.body[k] !== undefined) campos[k] = req.body[k];
  });
  if (req.body.tags !== undefined) campos.tags = JSON.stringify(req.body.tags);
  if (req.body.responsavel_id && req.usuario.role !== 'VENDEDOR') campos.responsavel_id = req.body.responsavel_id;
  campos.atualizado_em = new Date().toISOString();

  const sets = Object.keys(campos).map(k=>`${k}=?`).join(',');
  db.prepare(`UPDATE leads SET ${sets} WHERE id=?`).run(...Object.values(campos), id);
  req.log({ acao:'UPDATE', entidade:'leads', entidade_id:id, antes:atual, depois:campos });
  return res.json({ sucesso:true, dados: db.prepare('SELECT * FROM leads WHERE id=?').get(id) });
}

// PATCH /api/leads/:id/mover
function mover(req, res) {
  const db = getDb();
  const { id } = req.params;
  const { etapa_id, pipeline_id } = req.body;
  if (!etapa_id) return res.status(400).json({ sucesso:false, erro:'etapa_id é obrigatório.' });

  const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(id);
  if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
  if (req.usuario.role==='VENDEDOR' && lead.responsavel_id !== req.usuario.id)
    return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });

  const etapa = db.prepare('SELECT * FROM etapas WHERE id=?').get(etapa_id);
  const novoStatus = etapa?.is_ganho ? 'GANHO' : etapa?.is_perdido ? 'PERDIDO' : 'ABERTO';
  const agora = new Date().toISOString();

  db.prepare(`UPDATE leads SET etapa_id=?, pipeline_id=COALESCE(?,pipeline_id), status=?, atualizado_em=? WHERE id=?`)
    .run(etapa_id, pipeline_id||null, novoStatus, agora, id);

  req.log({ acao:'MOVER', entidade:'leads', entidade_id:id,
    antes:{ etapa_id:lead.etapa_id }, depois:{ etapa_id, status:novoStatus } });

  // ── Hook: calcula comissão automaticamente ao mover para etapa GANHO ──
  if (etapa?.is_ganho && lead.responsavel_id && (lead.valor || 0) > 0) {
    try {
      const valorVenda = lead.valor || 0;
      const mesRef = agora.slice(0, 7); // "YYYY-MM"

      // Busca regras ativas para este vendedor/funil
      const pipelineInfo = db.prepare(`SELECT p.funil_id FROM pipelines p WHERE p.id=?`)
        .get(pipeline_id || lead.pipeline_id);
      const funilId = pipelineInfo?.funil_id;

      const regras = db.prepare(`SELECT * FROM comissao_regras WHERE ativo=1
        AND (usuario_id IS NULL OR usuario_id=?)
        AND (funil_id IS NULL OR funil_id=?)
        ORDER BY valor_min ASC`).all(lead.responsavel_id, funilId || '');

      // Aplica faixa de comissão
      let regra = regras[0] || null;
      for (const r of regras) {
        if (valorVenda >= (r.valor_min || 0)) regra = r;
      }

      let comissaoBase = 0;
      if (regra) {
        comissaoBase = regra.tipo_calculo === 'PERCENTUAL'
          ? valorVenda * (regra.percentual || 0) / 100
          : (regra.valor_fixo || 0);
      }

      // Verifica bônus de meta
      let bonus = 0;
      if (regra?.bonus_meta_pct > 0) {
        // Soma vendas do mês para verificar se meta foi atingida
        const totalMes = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM leads
          WHERE status='GANHO' AND responsavel_id=? AND strftime('%Y-%m',atualizado_em)=?`)
          .get(lead.responsavel_id, mesRef)?.v || 0;
        const meta = db.prepare(`SELECT valor_alvo FROM metas WHERE ativo=1
          AND tipo='FATURAMENTO' AND (usuario_id=? OR usuario_id IS NULL)
          AND date(data_inicio) <= date('now') AND date(data_fim) >= date('now')
          ORDER BY usuario_id DESC LIMIT 1`).get(lead.responsavel_id);
        if (meta && (totalMes + valorVenda) >= meta.valor_alvo) {
          bonus = valorVenda * regra.bonus_meta_pct / 100;
        }
      }

      const comissaoTotal = comissaoBase + bonus;
      const percUsado = valorVenda > 0 ? (comissaoTotal / valorVenda) * 100 : 0;

      // Grava na tabela comissoes
      const comId = require('crypto').randomBytes(16).toString('hex');
      db.prepare(`INSERT OR IGNORE INTO comissoes
        (id,usuario_id,lead_id,valor_venda,percentual,valor_comissao,status,periodo_ref,observacoes)
        VALUES (?,?,?,?,?,?,'PENDENTE',?,?)`).run(
        comId, lead.responsavel_id, id, valorVenda,
        percUsado, comissaoTotal, mesRef,
        regra ? `Regra: ${regra.nome}${bonus>0?' + bônus meta':''}` : 'Sem regra configurada'
      );

      req.log({ acao:'COMISSAO_AUTO', entidade:'comissoes', entidade_id:comId,
        depois:{ lead_id:id, valor_venda:valorVenda, comissao:comissaoTotal, regra:regra?.nome } });
    } catch(e) {
      // Não falha o mover se houver erro no cálculo
      console.error('[COMISSAO_AUTO] Erro:', e.message);
    }
  }

  return res.json({ sucesso:true, dados: db.prepare('SELECT * FROM leads WHERE id=?').get(id) });
}

// PATCH /api/leads/:id/transferir
function transferir(req, res) {
  const db = getDb();
  if (req.usuario.role==='VENDEDOR') return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
  const { responsavel_id } = req.body;
  if (!responsavel_id) return res.status(400).json({ sucesso:false, erro:'responsavel_id é obrigatório.' });

  const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id);
  if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });

  db.prepare('UPDATE leads SET responsavel_id=?, atualizado_em=? WHERE id=?')
    .run(responsavel_id, new Date().toISOString(), req.params.id);

  req.log({ acao:'TRANSFERIR', entidade:'leads', entidade_id:req.params.id,
    antes:{ responsavel_id:lead.responsavel_id }, depois:{ responsavel_id } });

  return res.json({ sucesso:true, dados: db.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id) });
}

// DELETE /api/leads/:id
function deletar(req, res) {
  const db = getDb();
  const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id);
  if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
  if (req.usuario.role==='VENDEDOR') return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
  db.prepare('DELETE FROM leads WHERE id=?').run(req.params.id);
  req.log({ acao:'DELETE', entidade:'leads', entidade_id:req.params.id, antes:lead });
  return res.json({ sucesso:true, mensagem:'Lead excluído.' });
}

// POST /api/leads/:id/mensagens
function adicionarMensagem(req, res) {
  const db = getDb();
  const { conteudo, tipo='NOTA' } = req.body;
  if (!conteudo) return res.status(400).json({ sucesso:false, erro:'Conteúdo é obrigatório.' });
  const id = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO mensagens (id,lead_id,usuario_id,tipo,conteudo) VALUES (?,?,?,?,?)`)
    .run(id, req.params.id, req.usuario.id, tipo, conteudo);
  const msg = db.prepare(`SELECT m.*, u.nome as autor_nome FROM mensagens m
    LEFT JOIN usuarios u ON m.usuario_id=u.id WHERE m.id=?`).get(id);
  return res.status(201).json({ sucesso:true, dados:msg });
}

// GET /api/leads/distribuicao
function getDistribuicao(req, res) {
  const db = getDb();
  let cfg = db.prepare("SELECT * FROM automacoes WHERE trigger_tipo='DISTRIBUICAO' LIMIT 1").get();
  if (!cfg) return res.json({ sucesso:true, dados:{ modo:'MANUAL', pesos:[] } });
  return res.json({ sucesso:true, dados:{ ...JSON.parse(cfg.acao_config||'{}'), id:cfg.id } });
}

// POST /api/leads/distribuicao
function setDistribuicao(req, res) {
  const db = getDb();
  const { modo='MANUAL', pesos=[] } = req.body;
  const config = JSON.stringify({ modo, pesos });
  let existente = db.prepare("SELECT id FROM automacoes WHERE trigger_tipo='DISTRIBUICAO' LIMIT 1").get();
  if (existente) {
    db.prepare("UPDATE automacoes SET acao_config=? WHERE id=?").run(config, existente.id);
  } else {
    const id = crypto.randomBytes(16).toString('hex');
    db.prepare(`INSERT INTO automacoes (id,nome,trigger_tipo,acao_tipo,acao_config,criado_por)
      VALUES (?,?,?,?,?,?)`).run(id,'Distribuição de Leads','DISTRIBUICAO','DISTRIBUIR',config,req.usuario.id);
  }
  return res.json({ sucesso:true, mensagem:'Configuração salva.' });
}

module.exports = { listar, buscarPorId, criar, atualizar, mover, transferir, deletar, adicionarMensagem, getDistribuicao, setDistribuicao };
