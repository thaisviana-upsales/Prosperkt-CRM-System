/**
 * PROSPERKT CRM — WhatsApp Controller
 * Módulo de conversas, histórico e automação tráfego pago
 *
 * LEGADO: funções originais usam SQLite (getDb)
 * NOVO: funções *Supabase usam whatsappService (tabela whatsapp_mensagens)
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');
const waSvc   = require('../services/whatsappService');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function normalizePhone(tel) {
  return (tel || '').replace(/\D/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/conversas
// Lista todas as conversas com última mensagem
// ─────────────────────────────────────────────────────────────────────────────
function listarConversas(req, res) {
  try {
    const db = getDb();
    const { vendedor_id, status, funil_id, busca, limit = 50, offset = 0 } = req.query;

    let sql = `
      SELECT
        c.*,
        u.nome AS vendedor_nome,
        l.nome AS lead_nome,
        l.empresa AS lead_empresa,
        (SELECT mensagem FROM mensagens_whatsapp WHERE conversa_id = c.id
         ORDER BY criado_em DESC LIMIT 1) AS ultima_mensagem,
        (SELECT direcao FROM mensagens_whatsapp WHERE conversa_id = c.id
         ORDER BY criado_em DESC LIMIT 1) AS ultima_direcao,
        (SELECT COUNT(*) FROM mensagens_whatsapp WHERE conversa_id = c.id
         AND direcao = 'recebida' AND status = 'enviado') AS nao_lidas
      FROM conversas_whatsapp c
      LEFT JOIN usuarios u ON c.vendedor_id = u.id
      LEFT JOIN leads l ON c.lead_id = l.id
      WHERE 1=1
    `;
    const params = [];

    // Filtro de permissão
    if (req.usuario.role === 'VENDEDOR') {
      sql += ' AND c.vendedor_id = ?';
      params.push(req.usuario.id);
    } else if (req.usuario.role === 'GESTOR') {
      // Gestor vê sua equipe — por ora vê todos ativos
    }

    if (vendedor_id) { sql += ' AND c.vendedor_id = ?'; params.push(vendedor_id); }
    if (status)      { sql += ' AND c.status = ?';      params.push(status); }
    if (busca) {
      sql += ` AND (c.telefone LIKE ? OR c.nome_contato LIKE ? OR l.nome LIKE ?)`;
      const like = `%${busca}%`;
      params.push(like, like, like);
    }

    sql += ' ORDER BY COALESCE(c.ultima_msg_em, c.criado_em) DESC';
    sql += ` LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const conversas = db.prepare(sql).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as n FROM conversas_whatsapp WHERE 1=1`).get();

    return res.json({ sucesso: true, dados: conversas, total: total.n });
  } catch (e) {
    console.error('[WA] listarConversas:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao listar conversas.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/conversas/:id/mensagens
// Retorna mensagens paginadas de uma conversa
// ─────────────────────────────────────────────────────────────────────────────
function listarMensagens(req, res) {
  try {
    const db = getDb();
    const { id } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    // Verifica acesso
    const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
    if (!conversa) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
    if (req.usuario.role === 'VENDEDOR' && conversa.vendedor_id !== req.usuario.id) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
    }

    const msgs = db.prepare(`
      SELECT m.*, u.nome AS vendedor_nome
      FROM mensagens_whatsapp m
      LEFT JOIN usuarios u ON m.vendedor_id = u.id
      WHERE m.conversa_id = ?
      ORDER BY m.criado_em ASC
      LIMIT ? OFFSET ?
    `).all(id, Number(limit), Number(offset));

    // Marca recebidas como lidas
    db.prepare(`
      UPDATE mensagens_whatsapp SET status = 'lido'
      WHERE conversa_id = ? AND direcao = 'recebida' AND status != 'lido'
    `).run(id);

    return res.json({ sucesso: true, dados: msgs, conversa });
  } catch (e) {
    console.error('[WA] listarMensagens:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao carregar mensagens.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/conversas/:id/mensagens
// Envia uma mensagem (cria registro no banco)
// ─────────────────────────────────────────────────────────────────────────────
function enviarMensagem(req, res) {
  try {
    const db = getDb();
    const { id } = req.params;
    const { mensagem, tipo = 'texto', arquivo_url, arquivo_nome } = req.body;

    const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
    if (!conversa) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
    if (req.usuario.role === 'VENDEDOR' && conversa.vendedor_id !== req.usuario.id) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
    }
    if (!mensagem && !arquivo_url) {
      return res.status(400).json({ sucesso: false, erro: 'Mensagem ou arquivo obrigatório.' });
    }

    const msgId = crypto.randomBytes(16).toString('hex');
    const agora = new Date().toISOString();

    db.prepare(`
      INSERT INTO mensagens_whatsapp
        (id, conversa_id, lead_id, telefone, mensagem, tipo, direcao, status, vendedor_id, arquivo_url, arquivo_nome, criado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      msgId, id, conversa.lead_id, conversa.telefone,
      mensagem || null, tipo, 'enviada', 'enviado',
      req.usuario.id, arquivo_url || null, arquivo_nome || null, agora
    );

    // Atualiza última mensagem e atualizado_em da conversa
    db.prepare(`
      UPDATE conversas_whatsapp SET ultima_msg_em = ?, atualizado_em = ?, status = 'ABERTA' WHERE id = ?
    `).run(agora, agora, id);

    // Atualiza atualizado_em do lead
    if (conversa.lead_id) {
      db.prepare(`UPDATE leads SET atualizado_em = ? WHERE id = ?`).run(agora, conversa.lead_id);
    }

    req.log({ acao: 'WHATSAPP_SEND', entidade: 'conversas_whatsapp', entidade_id: id,
      depois: { mensagem: mensagem?.slice(0, 100), tipo } });

    const msg = db.prepare(`
      SELECT m.*, u.nome AS vendedor_nome FROM mensagens_whatsapp m
      LEFT JOIN usuarios u ON m.vendedor_id = u.id WHERE m.id = ?
    `).get(msgId);

    return res.status(201).json({ sucesso: true, dados: msg });
  } catch (e) {
    console.error('[WA] enviarMensagem:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao enviar mensagem.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/conversas
// Cria ou busca conversa existente por telefone
// ─────────────────────────────────────────────────────────────────────────────
function criarOuAbrirConversa(req, res) {
  try {
    const db = getDb();
    const { telefone, lead_id, nome_contato, vendedor_id } = req.body;

    if (!telefone) return res.status(400).json({ sucesso: false, erro: 'Telefone obrigatório.' });

    const tel = normalizePhone(telefone);

    // Busca conversa ativa existente pelo telefone
    let conversa = db.prepare(
      `SELECT * FROM conversas_whatsapp WHERE telefone = ? AND status != 'FECHADA' ORDER BY criado_em DESC LIMIT 1`
    ).get(tel);

    if (!conversa) {
      // Cria nova conversa
      const id = crypto.randomBytes(16).toString('hex');
      const agora = new Date().toISOString();
      db.prepare(`
        INSERT INTO conversas_whatsapp (id, lead_id, telefone, nome_contato, vendedor_id, origem, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(id, lead_id || null, tel, nome_contato || null, vendedor_id || req.usuario.id, 'MANUAL', agora, agora);
      conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
    }

    // Atualiza lead_id se veio agora
    if (lead_id && !conversa.lead_id) {
      db.prepare('UPDATE conversas_whatsapp SET lead_id = ? WHERE id = ?').run(lead_id, conversa.id);
    }

    req.log({ acao: 'WHATSAPP_OPEN', entidade: 'conversas_whatsapp', entidade_id: conversa.id,
      depois: { telefone: tel, lead_id } });

    return res.json({ sucesso: true, dados: conversa });
  } catch (e) {
    console.error('[WA] criarOuAbrirConversa:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao abrir conversa.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/webhook/trafego
// Automação: lead entra via WhatsApp (tráfego pago)
// Cria lead, atribui funil "Tráfego Pago", distribui vendedor, registra conversa
// ─────────────────────────────────────────────────────────────────────────────
function webhookTrafego(req, res) {
  try {
    const db = getDb();
    const { telefone, nome, mensagem_inicial, campanha } = req.body;

    if (!telefone) return res.status(400).json({ sucesso: false, erro: 'Telefone obrigatório.' });

    const tel = normalizePhone(telefone);
    const agora = new Date().toISOString();

    // 1. Encontra o funil "Tráfego Pago" (ou primeiro funil ativo)
    let funil = db.prepare(`SELECT * FROM funis WHERE nome LIKE '%Tr%fego%' AND ativo=1 LIMIT 1`).get()
             || db.prepare(`SELECT * FROM funis WHERE ativo=1 ORDER BY criado_em ASC LIMIT 1`).get();

    if (!funil) return res.status(404).json({ sucesso: false, erro: 'Nenhum funil ativo encontrado.' });

    // Primeira etapa do funil
    const primeiraEtapa = db.prepare(`
      SELECT e.* FROM etapas e
      JOIN pipelines p ON e.pipeline_id = p.id
      WHERE p.funil_id = ? ORDER BY e.ordem ASC LIMIT 1
    `).get(funil.id);

    const pipeline = db.prepare(`SELECT * FROM pipelines WHERE funil_id = ? AND ativo=1 LIMIT 1`).get(funil.id);

    // 2. Distribui vendedor (usa configuração de distribuição existente)
    const distRow = db.prepare(`SELECT * FROM leads WHERE 1=1 LIMIT 0`).get(); // só para evitar erro
    const vendedores = db.prepare(`
      SELECT id FROM usuarios WHERE role IN ('VENDEDOR','GESTOR') AND ativo=1
    `).all();

    let vendedorId = null;
    if (vendedores.length > 0) {
      // Distribuição round-robin: pega quem tem menos leads recentes
      const distribuicaoRow = db.prepare(`
        SELECT responsavel_id, COUNT(*) as cnt FROM leads
        WHERE responsavel_id IS NOT NULL
        GROUP BY responsavel_id ORDER BY cnt ASC LIMIT 1
      `).get();
      if (distribuicaoRow && vendedores.find(v => v.id === distribuicaoRow.responsavel_id)) {
        vendedorId = distribuicaoRow.responsavel_id;
      } else {
        vendedorId = vendedores[0].id;
      }
    }

    // 3. Verifica se já existe lead com esse telefone nesse funil
    const leadExistente = db.prepare(`
      SELECT l.* FROM leads l
      JOIN pipelines p ON l.pipeline_id = p.id
      WHERE p.funil_id = ? AND l.telefone = ? AND l.status = 'ABERTO' LIMIT 1
    `).get(funil.id, tel);

    let leadId;
    if (leadExistente) {
      leadId = leadExistente.id;
    } else {
      // 4. Cria o lead
      leadId = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO leads
          (id, nome, telefone, pipeline_id, etapa_id, responsavel_id, origem, status, dados_extras, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        leadId,
        nome || `Lead WhatsApp ${tel}`,
        tel,
        pipeline?.id || null,
        primeiraEtapa?.id || null,
        vendedorId,
        'TRAFEGO_PAGO',
        'ABERTO',
        JSON.stringify({ campanha: campanha || 'Tráfego Pago', primeira_mensagem: mensagem_inicial }),
        agora, agora
      );

      // Nota automática no lead
      const notaId = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO mensagens (id, lead_id, usuario_id, tipo, conteudo, enviado_em, criado_em)
        VALUES (?,?,?,?,?,?,?)
      `).run(notaId, leadId, vendedorId, 'SISTEMA',
        `Lead criado automaticamente via WhatsApp (Tráfego Pago). Campanha: ${campanha || '—'}`,
        agora, agora);
    }

    // 5. Cria ou abre conversa WhatsApp
    let conversa = db.prepare(
      `SELECT * FROM conversas_whatsapp WHERE telefone = ? AND status != 'FECHADA' ORDER BY criado_em DESC LIMIT 1`
    ).get(tel);

    if (!conversa) {
      const convId = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO conversas_whatsapp
          (id, lead_id, telefone, nome_contato, vendedor_id, origem, ultima_msg_em, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(convId, leadId, tel, nome || null, vendedorId, 'TRAFEGO_PAGO', agora, agora, agora);
      conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(convId);
    }

    // 6. Salva mensagem inicial
    if (mensagem_inicial) {
      const msgId = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO mensagens_whatsapp
          (id, conversa_id, lead_id, telefone, mensagem, tipo, direcao, status, criado_em)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(msgId, conversa.id, leadId, tel, mensagem_inicial, 'texto', 'recebida', 'enviado', agora);

      db.prepare(`UPDATE conversas_whatsapp SET ultima_msg_em = ? WHERE id = ?`).run(agora, conversa.id);
    }

    req.log({
      acao: 'WEBHOOK_TRAFEGO', entidade: 'leads', entidade_id: leadId,
      depois: { telefone: tel, funil: funil.nome, vendedor_id: vendedorId, campanha }
    });

    // Dispara primeira mensagem automática (apenas para leads novos)
    if (!leadExistente) {
      const automacoesMsg = require('./automacoesMsgController');
      setImmediate(() => {
        automacoesMsg.dispararPrimeiraMensagem({ lead: { id: leadId }, db });
      });
    }

    return res.json({
      sucesso: true,
      dados: { lead_id: leadId, conversa_id: conversa.id, vendedor_id: vendedorId, funil: funil.nome }
    });
  } catch (e) {
    console.error('[WA] webhookTrafego:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro na automação.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/whatsapp/conversas/:id/status
// Atualiza status da conversa
// ─────────────────────────────────────────────────────────────────────────────
function atualizarStatus(req, res) {
  try {
    const db = getDb();
    const { id } = req.params;
    const { status } = req.body;
    const VALIDOS = ['ABERTA','FECHADA','AGUARDANDO'];
    if (!VALIDOS.includes(status)) return res.status(400).json({ sucesso: false, erro: 'Status inválido.' });

    db.prepare('UPDATE conversas_whatsapp SET status = ?, atualizado_em = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);

    return res.json({ sucesso: true });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/conversas/:id
// Busca uma conversa por ID (para abrir pelo lead)
// ─────────────────────────────────────────────────────────────────────────────
function buscarConversa(req, res) {
  try {
    const db = getDb();
    const conversa = db.prepare(`
      SELECT c.*, u.nome AS vendedor_nome, l.nome AS lead_nome, l.empresa AS lead_empresa
      FROM conversas_whatsapp c
      LEFT JOIN usuarios u ON c.vendedor_id = u.id
      LEFT JOIN leads l ON c.lead_id = l.id
      WHERE c.id = ?
    `).get(req.params.id);

    if (!conversa) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
    return res.json({ sucesso: true, dados: conversa });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/lead/:lead_id
// Busca conversa de um lead específico
// ─────────────────────────────────────────────────────────────────────────────
function conversaPorLead(req, res) {
  try {
    const db = getDb();
    const conversa = db.prepare(`
      SELECT c.*, u.nome AS vendedor_nome
      FROM conversas_whatsapp c
      LEFT JOIN usuarios u ON c.vendedor_id = u.id
      WHERE c.lead_id = ?
      ORDER BY c.criado_em DESC LIMIT 1
    `).get(req.params.lead_id);

    return res.json({ sucesso: true, dados: conversa || null });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/pendentes
// Conversas com mensagem recebida mais recente sem resposta enviada depois
// Regra: 1 pendência por conversa (não duplica)
// ─────────────────────────────────────────────────────────────────────────────
function listarPendentes(req, res) {
  try {
    const db = getDb();
    const role = req.usuario.role;
    const uid  = req.usuario.id;

    // Vendedor não acessa este endpoint no dashboard (bloqueado por role no frontend)
    // mas protege no backend também
    if (role === 'VENDEDOR') {
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
    }

    // Conversas pendentes:
    // a última mensagem da conversa é de direção "recebida" (cliente sem resposta)
    const baseSQL = `
      SELECT
        c.id            AS conversa_id,
        c.telefone,
        c.nome_contato,
        c.origem,
        c.ultima_msg_em,
        c.lead_id,
        l.nome          AS lead_nome,
        l.empresa       AS lead_empresa,
        l.responsavel_id,
        u.nome          AS vendedor_nome,
        f.nome          AS funil_nome,
        f.cor           AS funil_cor,
        -- Ultima mensagem recebida
        m_last.mensagem AS ultima_mensagem,
        m_last.criado_em AS ultima_msg_criado_em,
        -- Tempo esperando em minutos
        ROUND((julianday('now') - julianday(m_last.criado_em)) * 1440) AS minutos_aguardando
      FROM conversas_whatsapp c
      -- Junta última mensagem de cada conversa
      JOIN (
        SELECT conversa_id,
               mensagem,
               direcao,
               criado_em
        FROM mensagens_whatsapp m1
        WHERE criado_em = (
          SELECT MAX(m2.criado_em)
          FROM mensagens_whatsapp m2
          WHERE m2.conversa_id = m1.conversa_id
        )
        GROUP BY conversa_id
      ) m_last ON m_last.conversa_id = c.id
      LEFT JOIN leads l     ON c.lead_id = l.id
      LEFT JOIN usuarios u  ON c.vendedor_id = u.id
      LEFT JOIN pipelines p ON l.pipeline_id = p.id
      LEFT JOIN funis f     ON p.funil_id = f.id
      WHERE
        c.status != 'FECHADA'
        AND m_last.direcao = 'recebida'
    `;

    let sql    = baseSQL;
    const params = [];

    // Gestor: filtra pela equipe (no momento sem equipe configurada, vê todos)
    // Super Admin / GESTOR: vê tudo por ora
    // Ajustar quando houver equipes

    sql += ' ORDER BY m_last.criado_em ASC'; // mais antigos primeiro (mais urgentes)

    const pendentes = db.prepare(sql).all(...params);

    req.log({
      acao: 'DASHBOARD_PENDENTES_ACESSO',
      entidade: 'conversas_whatsapp',
      depois: { total: pendentes.length, role }
    });

    return res.json({
      sucesso: true,
      total: pendentes.length,
      dados: pendentes
    });
  } catch (e) {
    console.error('[WA] listarPendentes:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao buscar pendentes.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOVOS ENDPOINTS SUPABASE (tabela whatsapp_mensagens)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/whatsapp/conversas (Supabase)
// Lista todas as conversas agrupadas por lead/telefone
async function conversasSupabase(req, res) {
  const { limite = 50 } = req.query;
  try {
    const resultado = await waSvc.listarConversas({ limite: Number(limite) });
    return res.json({ sucesso: resultado.sucesso, dados: resultado.dados || [], erro: resultado.erro });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// GET /api/whatsapp/conversas/:leadId (Supabase)
// Mensagens de um lead pelo leadId
async function conversasPorLeadSupabase(req, res) {
  const { leadId } = req.params;
  const { limite = 100, offset = 0 } = req.query;
  try {
    const resultado = await waSvc.listarMensagensLead(leadId, { limite: Number(limite), offset: Number(offset) });
    return res.json({ sucesso: resultado.sucesso, dados: resultado.dados || [], erro: resultado.erro });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// GET /api/leads/:id/conversas
// Mensagens WhatsApp vinculadas ao lead (alias de conversasPorLeadSupabase)
async function conversasDoLead(req, res) {
  const leadId = req.params.id;
  const { limite = 100, offset = 0 } = req.query;
  try {
    const resultado = await waSvc.listarMensagensLead(leadId, { limite: Number(limite), offset: Number(offset) });
    return res.json({
      sucesso: resultado.sucesso,
      dados: resultado.dados || [],
      total: resultado.dados?.length || 0,
      aviso: resultado.aviso,
      erro: resultado.erro,
    });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// POST /api/whatsapp/mensagens/manual
// Salva mensagem manual para testes sem WhatsApp Light
async function mensagemManual(req, res) {
  const { lead_id, telefone, direcao, tipo, conteudo, nome_contato } = req.body;

  if (!telefone) return res.status(400).json({ sucesso: false, erro: 'telefone é obrigatório.' });
  if (!direcao || !['recebida','enviada'].includes(direcao)) {
    return res.status(400).json({ sucesso: false, erro: 'direcao deve ser recebida ou enviada.' });
  }
  if (!conteudo && tipo === 'texto') {
    return res.status(400).json({ sucesso: false, erro: 'conteudo é obrigatório para tipo texto.' });
  }

  try {
    const resultado = await waSvc.salvarMensagem({
      lead_id:      lead_id      || null,
      telefone,
      nome_contato: nome_contato || null,
      direcao,
      tipo:         tipo         || 'texto',
      conteudo:     conteudo     || null,
      status_envio: direcao === 'enviada' ? 'enviado' : 'recebido',
      enviado_por:  direcao === 'enviada' ? req.usuario?.id : null,
    });

    if (!resultado.sucesso) {
      return res.status(500).json({ sucesso: false, erro: resultado.erro });
    }

    // Registra auditoria sem quebrar a resposta
    req.log?.({
      acao: 'WHATSAPP_MANUAL',
      entidade: 'whatsapp_mensagens',
      entidade_id: lead_id || resultado.dados?.id,
      depois: { direcao, tipo, lead_id, telefone },
    });

    return res.status(201).json({ sucesso: true, dados: resultado.dados });
  } catch (e) {
    console.error('[WA] mensagemManual:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = {
  // Legado SQLite (não alterados)
  listarConversas,
  listarMensagens,
  enviarMensagem,
  criarOuAbrirConversa,
  webhookTrafego,
  atualizarStatus,
  buscarConversa,
  conversaPorLead,
  listarPendentes,
  // Novos — Supabase
  conversasSupabase,
  conversasPorLeadSupabase,
  conversasDoLead,
  mensagemManual,
};
