/**
 * PROSPEKT CRM — Automações de Mensagem Controller
 * Gerencia automações de primeira mensagem WhatsApp ao criar lead
 *
 * Em Supabase, usa getProvider() — não chama better-sqlite3 em produção.
 * Em SQLite local, mantém fallback.
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

// ─── Constantes ───────────────────────────────────────────────────────────────
const TRIGGER = 'LEAD_CRIADO';
const ACAO    = 'PRIMEIRA_MSG_WA';

/** Substitui variáveis dinâmicas no texto da mensagem */
function substituirVariaveis(texto, { nome_lead, nome_vendedor, nome_empresa, telefone_lead, funil, empresa } = {}) {
  return (texto || '')
    .replace(/\[nome_lead\]/gi,     nome_lead     || '')
    .replace(/\[nome_vendedor\]/gi, nome_vendedor  || 'Equipe')
    .replace(/\[nome_empresa\]/gi,  nome_empresa   || empresa || '')
    .replace(/\[telefone_lead\]/gi, telefone_lead  || '')
    .replace(/\[funil\]/gi,         funil          || '')
    .replace(/\[empresa\]/gi,       empresa        || nome_empresa || '');
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/automacoes/mensagens
// ─────────────────────────────────────────────────────────────────────────────
async function listar(req, res) {
  const { isSupa, sb, sqlite: db } = getProvider();
  try {
    if (isSupa) {
      const { data, error } = await sb.from('automacoes')
        .select('*')
        .eq('trigger_tipo', TRIGGER)
        .eq('acao_tipo', ACAO)
        .order('criado_em', { ascending: false });
      if (error) throw error;
      const lista = data || [];
      return res.json({ sucesso: true, dados: lista, total: lista.length });
    }
    // SQLite
    const lista = db.prepare(`
      SELECT a.*, u.nome AS criado_por_nome, f.nome AS funil_nome
      FROM automacoes a
      LEFT JOIN usuarios u ON a.criado_por = u.id
      LEFT JOIN funis f ON json_extract(a.trigger_config, '$.funil_id') = f.id
      WHERE a.trigger_tipo = ? AND a.acao_tipo = ?
      ORDER BY a.criado_em DESC
    `).all(TRIGGER, ACAO);
    return res.json({ sucesso: true, dados: lista, total: lista.length });
  } catch (e) {
    console.error('[AutoMsg] listar:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/automacoes/mensagens
// ─────────────────────────────────────────────────────────────────────────────
async function criar(req, res) {
  if (!['SUPER_ADMIN'].includes(req.usuario.role))
    return res.status(403).json({ sucesso: false, erro: 'Apenas Super Admin pode criar automações.' });

  const { isSupa, sb, sqlite: db } = getProvider();
  const { nome, descricao, funil_id, etapa_id, delay_segundos = 0, mensagem_texto, ativo = 1 } = req.body;

  if (!nome)           return res.status(400).json({ sucesso: false, erro: 'Nome é obrigatório.' });
  if (!mensagem_texto) return res.status(400).json({ sucesso: false, erro: 'Texto da mensagem é obrigatório.' });

  const id = crypto.randomBytes(16).toString('hex');
  const agora = new Date().toISOString();
  const triggerConfig = JSON.stringify({ funil_id: funil_id || null, etapa_id: etapa_id || null });
  const acaoConfig    = JSON.stringify({ mensagem_texto, delay_segundos: Number(delay_segundos) });

  try {
    if (isSupa) {
      const payload = {
        id, nome: nome.trim(), descricao: descricao || null,
        trigger_tipo: TRIGGER,
        trigger_config: { funil_id: funil_id || null, etapa_id: etapa_id || null },
        acao_tipo: ACAO,
        acao_config: { mensagem_texto, delay_segundos: Number(delay_segundos) },
        ativo: ativo ? 1 : 0,
        criado_por: req.usuario.id,
        criado_em: agora, atualizado_em: agora,
      };
      const { data, error } = await sb.from('automacoes').insert(payload).select().single();
      if (error) throw error;
      req.log({ acao: 'AUTOMACAO_CRIAR', entidade: 'automacoes', entidade_id: id, depois: { nome, funil_id } });
      return res.status(201).json({ sucesso: true, dados: data });
    }
    // SQLite
    db.prepare(`
      INSERT INTO automacoes
        (id, nome, descricao, trigger_tipo, trigger_config, acao_tipo, acao_config, ativo, criado_por, criado_em, atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, nome.trim(), descricao || null, TRIGGER, triggerConfig, ACAO, acaoConfig,
           ativo ? 1 : 0, req.usuario.id, agora, agora);
    req.log({ acao: 'AUTOMACAO_CRIAR', entidade: 'automacoes', entidade_id: id, depois: { nome, funil_id } });
    return res.status(201).json({ sucesso: true, dados: db.prepare('SELECT * FROM automacoes WHERE id = ?').get(id) });
  } catch (e) {
    console.error('[AutoMsg] criar:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/automacoes/mensagens/:id
// ─────────────────────────────────────────────────────────────────────────────
async function editar(req, res) {
  if (!['SUPER_ADMIN'].includes(req.usuario.role))
    return res.status(403).json({ sucesso: false, erro: 'Apenas Super Admin pode editar automações.' });

  const { isSupa, sb, sqlite: db } = getProvider();
  const { nome, descricao, funil_id, etapa_id, delay_segundos, mensagem_texto, ativo } = req.body;
  const agora = new Date().toISOString();

  try {
    if (isSupa) {
      // Busca atual para merge
      const { data: atual, error: errBusca } = await sb.from('automacoes').select('*').eq('id', req.params.id).single();
      if (errBusca || !atual) return res.status(404).json({ sucesso: false, erro: 'Automação não encontrada.' });

      const tcAtual = (() => { try { return JSON.parse(atual.trigger_config || '{}'); } catch { return {}; } })();
      const acAtual = (() => { try { return JSON.parse(atual.acao_config   || '{}'); } catch { return {}; } })();

      const triggerConfig = JSON.stringify({
        funil_id: funil_id  !== undefined ? (funil_id  || null) : tcAtual.funil_id,
        etapa_id: etapa_id  !== undefined ? (etapa_id  || null) : tcAtual.etapa_id,
      });
      const acaoConfig = JSON.stringify({
        mensagem_texto:  mensagem_texto  !== undefined ? mensagem_texto  : acAtual.mensagem_texto,
        delay_segundos:  delay_segundos  !== undefined ? Number(delay_segundos) : acAtual.delay_segundos,
      });

      const campos = {
        trigger_config: { funil_id: funil_id !== undefined ? (funil_id || null) : tcAtual.funil_id, etapa_id: etapa_id !== undefined ? (etapa_id || null) : tcAtual.etapa_id },
        acao_config: { mensagem_texto: mensagem_texto !== undefined ? mensagem_texto : acAtual.mensagem_texto, delay_segundos: delay_segundos !== undefined ? Number(delay_segundos) : acAtual.delay_segundos },
        atualizado_em: agora,
      };
      if (nome      !== undefined) campos.nome      = nome.trim();
      if (descricao !== undefined) campos.descricao = descricao || null;
      if (ativo     !== undefined) campos.ativo     = ativo ? 1 : 0;

      const { data, error } = await sb.from('automacoes').update(campos).eq('id', req.params.id).select().single();
      if (error) throw error;
      req.log({ acao: 'AUTOMACAO_EDITAR', entidade: 'automacoes', entidade_id: req.params.id, antes: atual, depois: campos });
      return res.json({ sucesso: true, dados: data });
    }
    // SQLite
    const atual = db.prepare('SELECT * FROM automacoes WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Automação não encontrada.' });

    const tcAtual = (() => { try { return JSON.parse(atual.trigger_config || '{}'); } catch { return {}; } })();
    const acAtual = (() => { try { return JSON.parse(atual.acao_config   || '{}'); } catch { return {}; } })();

    const triggerConfig = JSON.stringify({
      funil_id: funil_id !== undefined ? (funil_id || null) : tcAtual.funil_id,
      etapa_id: etapa_id !== undefined ? (etapa_id || null) : tcAtual.etapa_id,
    });
    const acaoConfig = JSON.stringify({
      mensagem_texto: mensagem_texto !== undefined ? mensagem_texto : acAtual.mensagem_texto,
      delay_segundos: delay_segundos !== undefined ? Number(delay_segundos) : acAtual.delay_segundos,
    });

    db.prepare(`
      UPDATE automacoes SET
        nome = COALESCE(?, nome), descricao = COALESCE(?, descricao),
        trigger_config = ?, acao_config = ?,
        ativo = COALESCE(?, ativo), atualizado_em = ?
      WHERE id = ?
    `).run(
      nome?.trim() || null,
      descricao !== undefined ? (descricao || null) : null,
      triggerConfig, acaoConfig,
      ativo !== undefined ? (ativo ? 1 : 0) : null,
      agora, req.params.id
    );
    req.log({ acao: 'AUTOMACAO_EDITAR', entidade: 'automacoes', entidade_id: req.params.id, antes: atual, depois: req.body });
    return res.json({ sucesso: true, dados: db.prepare('SELECT * FROM automacoes WHERE id = ?').get(req.params.id) });
  } catch (e) {
    console.error('[AutoMsg] editar:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/automacoes/mensagens/:id
// ─────────────────────────────────────────────────────────────────────────────
async function deletar(req, res) {
  if (!['SUPER_ADMIN'].includes(req.usuario.role))
    return res.status(403).json({ sucesso: false, erro: 'Apenas Super Admin pode excluir automações.' });

  const { isSupa, sb, sqlite: db } = getProvider();
  try {
    if (isSupa) {
      const { data: atual } = await sb.from('automacoes').select('id').eq('id', req.params.id).single();
      if (!atual) return res.status(404).json({ sucesso: false, erro: 'Automação não encontrada.' });
      const { error } = await sb.from('automacoes').delete().eq('id', req.params.id);
      if (error) throw error;
      req.log({ acao: 'AUTOMACAO_DELETAR', entidade: 'automacoes', entidade_id: req.params.id });
      return res.json({ sucesso: true, mensagem: 'Automação excluída.' });
    }
    const atual = db.prepare('SELECT * FROM automacoes WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Automação não encontrada.' });
    db.prepare('DELETE FROM automacoes WHERE id = ?').run(req.params.id);
    req.log({ acao: 'AUTOMACAO_DELETAR', entidade: 'automacoes', entidade_id: req.params.id, antes: atual });
    return res.json({ sucesso: true, mensagem: 'Automação excluída.' });
  } catch (e) {
    console.error('[AutoMsg] deletar:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/automacoes/mensagens/:id/preview
// ─────────────────────────────────────────────────────────────────────────────
async function preview(req, res) {
  const { isSupa, sb, sqlite: db } = getProvider();
  try {
    let auto = null;
    if (isSupa) {
      const { data, error } = await sb.from('automacoes').select('*').eq('id', req.params.id).single();
      if (error || !data) return res.status(404).json({ sucesso: false, erro: 'Automação não encontrada.' });
      auto = data;
    } else {
      auto = db.prepare('SELECT * FROM automacoes WHERE id = ?').get(req.params.id);
      if (!auto) return res.status(404).json({ sucesso: false, erro: 'Automação não encontrada.' });
    }
    const ac = (() => { try { return JSON.parse(auto.acao_config || '{}'); } catch { return {}; } })();
    const texto = substituirVariaveis(ac.mensagem_texto, {
      nome_lead:     'João Silva',
      nome_vendedor: req.usuario.nome || 'Carlos',
      empresa:       'Empresa Exemplo',
      telefone_lead: '11999990000',
      funil:         'Tráfego Pago',
    });
    return res.json({ sucesso: true, dados: { texto_original: ac.mensagem_texto, texto_preview: texto } });
  } catch (e) {
    console.error('[AutoMsg] preview:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTOR: dispararPrimeiraMensagem
// Chamado internamente pelo leadsController.criar() — apenas em modo SQLite.
// Em Supabase, usar automacaoLeadsService.enviarSlaContato1() em vez disso.
// ─────────────────────────────────────────────────────────────────────────────
function dispararPrimeiraMensagem({ lead, db: dbExt, logFn } = {}) {
  const { isSupa } = getProvider();
  // Em Supabase: a automação de primeira mensagem é gerenciada por automacaoLeadsService.enviarSlaContato1()
  if (isSupa) return;

  const db = dbExt || (() => {
    try { return require('../database/db').getDb(); } catch { return null; }
  })();
  if (!db) return;

  try {
    if (!lead || !lead.id) return;

    const leadFull = db.prepare(`
      SELECT l.*, u.nome AS vendedor_nome, f.id AS funil_id, f.nome AS funil_nome, p.id AS pipeline_id_real
      FROM leads l
      LEFT JOIN usuarios u  ON l.responsavel_id = u.id
      LEFT JOIN pipelines p ON l.pipeline_id = p.id
      LEFT JOIN funis f     ON p.funil_id = f.id
      WHERE l.id = ?
    `).get(lead.id);

    if (!leadFull || !leadFull.telefone) return;

    const funilId = leadFull.funil_id || null;
    const automacoes = db.prepare(`
      SELECT * FROM automacoes
      WHERE trigger_tipo = ? AND acao_tipo = ? AND ativo = 1
      ORDER BY CASE WHEN json_extract(trigger_config, '$.funil_id') IS NOT NULL THEN 0 ELSE 1 END ASC, criado_em ASC
    `).all(TRIGGER, ACAO);

    let automacao = null;
    for (const a of automacoes) {
      const tc = (() => { try { return JSON.parse(a.trigger_config || '{}'); } catch { return {}; } })();
      if (tc.funil_id && tc.funil_id !== funilId) continue;
      automacao = a;
      break;
    }

    if (!automacao) return;

    const acaoConfig = (() => { try { return JSON.parse(automacao.acao_config || '{}'); } catch { return {}; } })();
    const delay = Number(acaoConfig.delay_segundos) || 0;
    const textoFinal = substituirVariaveis(acaoConfig.mensagem_texto, {
      nome_lead:      leadFull.nome,
      nome_vendedor:  leadFull.vendedor_nome || 'Equipe',
      nome_empresa:   leadFull.empresa,
      telefone_lead:  leadFull.telefone,
      funil:          leadFull.funil_nome,
      empresa:        leadFull.empresa,
    });

    const executar = () => {
      try {
        const agora = new Date().toISOString();
        const tel   = leadFull.telefone.replace(/\D/g, '');

        let conversa = db.prepare(`SELECT * FROM conversas_whatsapp WHERE lead_id = ? ORDER BY criado_em DESC LIMIT 1`).get(lead.id);
        if (!conversa) conversa = db.prepare(`SELECT * FROM conversas_whatsapp WHERE telefone = ? AND status != 'FECHADA' ORDER BY criado_em DESC LIMIT 1`).get(tel);
        if (!conversa) {
          const convId = crypto.randomBytes(16).toString('hex');
          db.prepare(`INSERT INTO conversas_whatsapp (id,lead_id,telefone,nome_contato,vendedor_id,origem,ultima_msg_em,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)`)
            .run(convId, lead.id, tel, leadFull.nome, leadFull.responsavel_id, 'AUTOMACAO', agora, agora, agora);
          conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(convId);
        } else if (!conversa.lead_id) {
          db.prepare('UPDATE conversas_whatsapp SET lead_id = ? WHERE id = ?').run(lead.id, conversa.id);
        }

        const msgId = crypto.randomBytes(16).toString('hex');
        db.prepare(`INSERT INTO mensagens_whatsapp (id,conversa_id,lead_id,telefone,mensagem,tipo,direcao,status,vendedor_id,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(msgId, conversa.id, lead.id, tel, textoFinal, 'texto', 'enviada', 'enviado', leadFull.responsavel_id, agora);
        db.prepare(`UPDATE conversas_whatsapp SET ultima_msg_em = ?, atualizado_em = ?, status = 'ABERTA' WHERE id = ?`)
          .run(agora, agora, conversa.id);

        if (typeof logFn === 'function') {
          logFn({ acao: 'AUTOMACAO_MSG_ENVIADA', entidade: 'mensagens_whatsapp', entidade_id: msgId,
            depois: { automacao_id: automacao.id, lead_id: lead.id, lead_nome: leadFull.nome, delay_segundos: delay } });
        }
        console.log(`[AutoMsg] ✓ Mensagem enviada — lead: ${leadFull.nome} | automação: ${automacao.nome}`);
      } catch (innerErr) {
        console.error('[AutoMsg] Erro ao executar disparo:', innerErr.message);
      }
    };

    delay > 0 ? setTimeout(executar, delay * 1000) : executar();
  } catch (e) {
    console.error('[AutoMsg] dispararPrimeiraMensagem:', e.message);
  }
}

module.exports = { listar, criar, editar, deletar, preview, dispararPrimeiraMensagem };
