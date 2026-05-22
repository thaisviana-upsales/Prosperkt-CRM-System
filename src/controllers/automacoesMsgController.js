/**
 * PROSPERKT CRM — Automações de Mensagem Controller
 * Gerencia automações de primeira mensagem WhatsApp ao criar lead
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');

// ─── Helpers ─────────────────────────────────────────────────────────────────
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
// Lista automações de primeira mensagem
// ─────────────────────────────────────────────────────────────────────────────
function listar(req, res) {
  try {
    const db = getDb();
    const lista = db.prepare(`
      SELECT a.*,
        u.nome AS criado_por_nome,
        f.nome AS funil_nome
      FROM automacoes a
      LEFT JOIN usuarios u ON a.criado_por = u.id
      LEFT JOIN funis f ON json_extract(a.trigger_config, '$.funil_id') = f.id
      WHERE a.trigger_tipo = ? AND a.acao_tipo = ?
      ORDER BY a.criado_em DESC
    `).all(TRIGGER, ACAO);

    return res.json({ sucesso: true, dados: lista, total: lista.length });
  } catch (e) {
    console.error('[AutoMsg] listar:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/automacoes/mensagens
// Cria nova automação de primeira mensagem
// ─────────────────────────────────────────────────────────────────────────────
function criar(req, res) {
  try {
    const db = getDb();
    if (!['SUPER_ADMIN'].includes(req.usuario.role)) {
      return res.status(403).json({ sucesso: false, erro: 'Apenas Super Admin pode criar automações.' });
    }

    const {
      nome,
      descricao,
      funil_id,        // null = todos os funis
      etapa_id,        // null = qualquer etapa
      delay_segundos = 0,
      mensagem_texto,
      ativo = 1
    } = req.body;

    if (!nome)           return res.status(400).json({ sucesso: false, erro: 'Nome é obrigatório.' });
    if (!mensagem_texto) return res.status(400).json({ sucesso: false, erro: 'Texto da mensagem é obrigatório.' });

    const id = crypto.randomBytes(16).toString('hex');
    const agora = new Date().toISOString();

    const triggerConfig = JSON.stringify({ funil_id: funil_id || null, etapa_id: etapa_id || null });
    const acaoConfig    = JSON.stringify({ mensagem_texto, delay_segundos: Number(delay_segundos) });

    db.prepare(`
      INSERT INTO automacoes
        (id, nome, descricao, trigger_tipo, trigger_config, acao_tipo, acao_config, ativo, criado_por, criado_em, atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, nome.trim(), descricao || null, TRIGGER, triggerConfig, ACAO, acaoConfig,
           ativo ? 1 : 0, req.usuario.id, agora, agora);

    req.log({ acao: 'AUTOMACAO_CRIAR', entidade: 'automacoes', entidade_id: id,
      depois: { nome, funil_id, delay_segundos } });

    const criada = db.prepare('SELECT * FROM automacoes WHERE id = ?').get(id);
    return res.status(201).json({ sucesso: true, dados: criada });
  } catch (e) {
    console.error('[AutoMsg] criar:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/automacoes/mensagens/:id
// Edita automação
// ─────────────────────────────────────────────────────────────────────────────
function editar(req, res) {
  try {
    const db = getDb();
    if (!['SUPER_ADMIN'].includes(req.usuario.role)) {
      return res.status(403).json({ sucesso: false, erro: 'Apenas Super Admin pode editar automações.' });
    }

    const atual = db.prepare('SELECT * FROM automacoes WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Automação não encontrada.' });

    const {
      nome,
      descricao,
      funil_id,
      etapa_id,
      delay_segundos,
      mensagem_texto,
      ativo
    } = req.body;

    const triggerConfig = JSON.stringify({
      funil_id:  funil_id  !== undefined ? (funil_id  || null) : JSON.parse(atual.trigger_config || '{}').funil_id,
      etapa_id:  etapa_id  !== undefined ? (etapa_id  || null) : JSON.parse(atual.trigger_config || '{}').etapa_id,
    });

    const acaoAtual = JSON.parse(atual.acao_config || '{}');
    const acaoConfig = JSON.stringify({
      mensagem_texto:  mensagem_texto  !== undefined ? mensagem_texto  : acaoAtual.mensagem_texto,
      delay_segundos:  delay_segundos  !== undefined ? Number(delay_segundos) : acaoAtual.delay_segundos,
    });

    const agora = new Date().toISOString();
    db.prepare(`
      UPDATE automacoes SET
        nome = COALESCE(?, nome),
        descricao = COALESCE(?, descricao),
        trigger_config = ?,
        acao_config = ?,
        ativo = COALESCE(?, ativo),
        atualizado_em = ?
      WHERE id = ?
    `).run(
      nome?.trim() || null,
      descricao !== undefined ? (descricao || null) : null,
      triggerConfig, acaoConfig,
      ativo !== undefined ? (ativo ? 1 : 0) : null,
      agora, req.params.id
    );

    req.log({ acao: 'AUTOMACAO_EDITAR', entidade: 'automacoes', entidade_id: req.params.id,
      antes: atual, depois: req.body });

    return res.json({ sucesso: true, dados: db.prepare('SELECT * FROM automacoes WHERE id = ?').get(req.params.id) });
  } catch (e) {
    console.error('[AutoMsg] editar:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/automacoes/mensagens/:id
// Remove automação
// ─────────────────────────────────────────────────────────────────────────────
function deletar(req, res) {
  try {
    const db = getDb();
    if (!['SUPER_ADMIN'].includes(req.usuario.role)) {
      return res.status(403).json({ sucesso: false, erro: 'Apenas Super Admin pode excluir automações.' });
    }
    const atual = db.prepare('SELECT * FROM automacoes WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Automação não encontrada.' });
    db.prepare('DELETE FROM automacoes WHERE id = ?').run(req.params.id);
    req.log({ acao: 'AUTOMACAO_DELETAR', entidade: 'automacoes', entidade_id: req.params.id, antes: atual });
    return res.json({ sucesso: true, mensagem: 'Automação excluída.' });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTOR: dispararPrimeiraMensagem
// Chamado internamente pelo leadsController.criar() e webhookTrafego
// Sem resposta HTTP — executado assíncronamente após criação do lead
// ─────────────────────────────────────────────────────────────────────────────
function dispararPrimeiraMensagem({ lead, db: dbExt, logFn } = {}) {
  // Usa o DB já disponível ou obtém um novo
  const db = dbExt || getDb();

  try {
    if (!lead || !lead.id) return;

    // 1. Busca dados completos do lead (vendedor, funil, telefone)
    const leadFull = db.prepare(`
      SELECT l.*,
        u.nome AS vendedor_nome,
        f.id   AS funil_id,
        f.nome AS funil_nome,
        p.id   AS pipeline_id_real
      FROM leads l
      LEFT JOIN usuarios u  ON l.responsavel_id = u.id
      LEFT JOIN pipelines p ON l.pipeline_id = p.id
      LEFT JOIN funis f     ON p.funil_id = f.id
      WHERE l.id = ?
    `).get(lead.id);

    if (!leadFull) return;
    if (!leadFull.telefone) return; // sem telefone, sem mensagem WA

    const funilId = leadFull.funil_id || null;

    // 2. Busca automação ativa que corresponde ao funil do lead
    // Prioridade: funil específico > funil genérico (null)
    const automacoes = db.prepare(`
      SELECT * FROM automacoes
      WHERE trigger_tipo = ? AND acao_tipo = ? AND ativo = 1
      ORDER BY
        CASE WHEN json_extract(trigger_config, '$.funil_id') IS NOT NULL THEN 0 ELSE 1 END ASC,
        criado_em ASC
    `).all(TRIGGER, ACAO);

    let automacao = null;
    for (const a of automacoes) {
      const tc = JSON.parse(a.trigger_config || '{}');
      // Funil específico: só aplica se o lead está nesse funil
      if (tc.funil_id && tc.funil_id !== funilId) continue;
      automacao = a;
      break;
    }

    if (!automacao) return; // nenhuma automação aplicável

    const acaoConfig = JSON.parse(automacao.acao_config || '{}');
    const delay = Number(acaoConfig.delay_segundos) || 0;

    // 3. Substitui variáveis
    const textoFinal = substituirVariaveis(acaoConfig.mensagem_texto, {
      nome_lead:      leadFull.nome,
      nome_vendedor:  leadFull.vendedor_nome || 'Equipe',
      nome_empresa:   leadFull.empresa,
      telefone_lead:  leadFull.telefone,
      funil:          leadFull.funil_nome,
      empresa:        leadFull.empresa,
    });

    // 4. Executa após delay (0 = imediato)
    const executar = () => {
      try {
        const agora = new Date().toISOString();
        const tel   = leadFull.telefone.replace(/\D/g, '');

        // 4a. Garante que existe conversa WhatsApp para este lead/telefone
        let conversa = db.prepare(
          `SELECT * FROM conversas_whatsapp WHERE lead_id = ? ORDER BY criado_em DESC LIMIT 1`
        ).get(lead.id);

        if (!conversa) {
          // Tenta por telefone
          conversa = db.prepare(
            `SELECT * FROM conversas_whatsapp WHERE telefone = ? AND status != 'FECHADA' ORDER BY criado_em DESC LIMIT 1`
          ).get(tel);
        }

        if (!conversa) {
          // Cria conversa
          const convId = crypto.randomBytes(16).toString('hex');
          db.prepare(`
            INSERT INTO conversas_whatsapp
              (id, lead_id, telefone, nome_contato, vendedor_id, origem, ultima_msg_em, criado_em, atualizado_em)
            VALUES (?,?,?,?,?,?,?,?,?)
          `).run(convId, lead.id, tel, leadFull.nome, leadFull.responsavel_id,
                 'AUTOMACAO', agora, agora, agora);
          conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(convId);
        } else {
          // Vincula lead_id se ainda não vinculado
          if (!conversa.lead_id) {
            db.prepare('UPDATE conversas_whatsapp SET lead_id = ? WHERE id = ?')
              .run(lead.id, conversa.id);
          }
        }

        // 4b. Salva a mensagem automática no histórico WhatsApp
        const msgId = crypto.randomBytes(16).toString('hex');
        db.prepare(`
          INSERT INTO mensagens_whatsapp
            (id, conversa_id, lead_id, telefone, mensagem, tipo, direcao, status, vendedor_id, criado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?)
        `).run(
          msgId, conversa.id, lead.id, tel,
          textoFinal, 'texto', 'enviada', 'enviado',
          leadFull.responsavel_id, agora
        );

        // 4c. Atualiza última mensagem da conversa
        db.prepare(`
          UPDATE conversas_whatsapp SET ultima_msg_em = ?, atualizado_em = ?, status = 'ABERTA' WHERE id = ?
        `).run(agora, agora, conversa.id);

        // 4d. Log de auditoria
        if (typeof logFn === 'function') {
          logFn({
            acao:        'AUTOMACAO_MSG_ENVIADA',
            entidade:    'mensagens_whatsapp',
            entidade_id: msgId,
            depois: {
              automacao_id:  automacao.id,
              automacao_nome: automacao.nome,
              lead_id:       lead.id,
              lead_nome:     leadFull.nome,
              vendedor_nome: leadFull.vendedor_nome,
              conversa_id:   conversa.id,
              delay_segundos: delay,
            }
          });
        } else {
          // Grava log diretamente se não houver logFn (webhook)
          try {
            const logId = crypto.randomBytes(16).toString('hex');
            db.prepare(`
              INSERT INTO logs (id, usuario_id, acao, entidade, entidade_id, depois, criado_em)
              VALUES (?,?,?,?,?,?,?)
            `).run(logId, leadFull.responsavel_id, 'AUTOMACAO_MSG_ENVIADA',
                   'mensagens_whatsapp', msgId,
                   JSON.stringify({ automacao_id: automacao.id, lead_id: lead.id, vendedor: leadFull.vendedor_nome }),
                   agora);
          } catch(_) { /* ignora erro de log */ }
        }

        console.log(`[AutoMsg] ✓ Mensagem enviada — lead: ${leadFull.nome} | automação: ${automacao.nome}`);
      } catch (innerErr) {
        console.error('[AutoMsg] Erro ao executar disparo:', innerErr.message);
      }
    };

    if (delay > 0) {
      setTimeout(executar, delay * 1000);
    } else {
      executar();
    }

  } catch (e) {
    console.error('[AutoMsg] dispararPrimeiraMensagem:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/automacoes/mensagens/:id/preview
// Retorna preview da mensagem com variáveis de exemplo substituídas
// ─────────────────────────────────────────────────────────────────────────────
function preview(req, res) {
  try {
    const db = getDb();
    const auto = db.prepare('SELECT * FROM automacoes WHERE id = ?').get(req.params.id);
    if (!auto) return res.status(404).json({ sucesso: false, erro: 'Automação não encontrada.' });

    const ac = JSON.parse(auto.acao_config || '{}');
    const texto = substituirVariaveis(ac.mensagem_texto, {
      nome_lead:     'João Silva',
      nome_vendedor: req.usuario.nome || 'Carlos',
      empresa:       'Empresa Exemplo',
      telefone_lead: '11999990000',
      funil:         'Tráfego Pago',
    });
    return res.json({ sucesso: true, dados: { texto_original: ac.mensagem_texto, texto_preview: texto } });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { listar, criar, editar, deletar, preview, dispararPrimeiraMensagem };
