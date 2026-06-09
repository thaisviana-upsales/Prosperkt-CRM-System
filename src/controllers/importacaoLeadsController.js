/**
 * PROSPEKT CRM — importacaoLeadsController.js
 * Endpoints para importação de leads via planilha / webhook externo.
 *
 * Endpoints:
 *   POST /api/leads/importar-planilha   — importa lote de leads (JSON)
 *   POST /api/leads/webhook-planilha    — importa 1 lead (webhook Apps Script)
 *   GET  /api/leads/importacoes         — lista histórico de importações
 *   POST /api/leads/sync-planilha       — força sincronização manual da planilha
 */

const planilhaSvc = require('../services/planilhaLeadsService');
const { getProvider } = require('../database/dbProvider');

// ── POST /api/leads/importar-planilha ─────────────────────────────────────────
// Recebe array de objetos com as colunas da planilha e importa em lote.
async function importarPlanilha(req, res) {
  let payload = req.body;

  // Aceita array diretamente ou { leads: [...] }
  if (!Array.isArray(payload)) {
    payload = payload?.leads;
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Envie um array de leads no body. Ex: [{ "nome":"Ana", "telefone":"11999...", ... }]',
    });
  }

  if (payload.length > 500) {
    return res.status(400).json({ sucesso: false, erro: 'Máximo de 500 leads por importação.' });
  }

  try {
    const resultados = await planilhaSvc.importarLote(payload, {
      fonte: 'planilha_teste',
      superAdminId: req.usuario?.id,
    });

    const criados    = resultados.filter(r => r.status === 'criado').length;
    const duplicados = resultados.filter(r => r.status === 'duplicado').length;
    const ignorados  = resultados.filter(r => r.status === 'ignorado').length;
    const erros      = resultados.filter(r => r.status === 'erro').length;

    req.log?.({
      acao:       'IMPORTACAO_PLANILHA',
      entidade:   'leads',
      depois:     { total: payload.length, criados, duplicados, ignorados, erros },
    });

    return res.json({
      sucesso: true,
      resumo: { total: payload.length, criados, duplicados, ignorados, erros },
      resultados,
    });
  } catch (e) {
    console.error('[importarPlanilha]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/leads/webhook-planilha ─────────────────────────────────────────
// Recebe 1 lead por chamada — compatível com Google Apps Script / Zapier.
// Autenticação: header x-webhook-token (sem JWT).
// Env: WEBHOOK_PLANILHA_TOKEN — se não configurado avisa em dev, bloqueia em prod.
async function webhookPlanilha(req, res) {
  const tokenEsperado = process.env.WEBHOOK_PLANILHA_TOKEN;
  const tokenEnviado  = req.headers['x-webhook-token'] || req.query.token;
  const isDev         = (process.env.NODE_ENV || 'development') === 'development';

  if (!tokenEsperado) {
    if (isDev) {
      // Em desenvolvimento sem token configurado: permite mas avisa
      console.warn('[Webhook Planilha] ⚠️  WEBHOOK_PLANILHA_TOKEN não configurado. Definir no .env para produção.');
    } else {
      // Em produção sem token: bloqueia por segurança
      return res.status(401).json({
        sucesso: false,
        erro: 'Webhook não configurado. Defina WEBHOOK_PLANILHA_TOKEN no servidor.',
      });
    }
  } else if (tokenEnviado !== tokenEsperado) {
    console.warn(`[Webhook Planilha] Token inválido recebido de ${req.ip}`);
    return res.status(401).json({ sucesso: false, erro: 'Token inválido.' });
  }

  const row = req.body;
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return res.status(400).json({ sucesso: false, erro: 'Envie um objeto JSON com os dados do lead.' });
  }

  // Validação mínima: precisa de ao menos 1 identificador
  if (!row.telefone && !row.email && !row.nome) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Ao menos um campo é obrigatório: telefone, email ou nome.',
    });
  }

  // Normaliza fonte — sempre rastreia como google_sheets quando vier do webhook
  const fonteNormalizada = row.fonte || 'google_sheets';

  try {
    const resultado = await planilhaSvc.importarUmLead(row, null, { fonte: fonteNormalizada });

    const statusCode = resultado.status === 'criado' ? 201 : 200;

    console.log(`[Webhook Planilha] ${resultado.status.toUpperCase()} — ${row.nome || row.telefone || row.email}`);

    return res.status(statusCode).json({
      sucesso:    true,
      status:     resultado.status,   // criado | duplicado | ignorado | erro
      lead_id:    resultado.lead_id   || null,
      motivo:     resultado.motivo    || null,
      mensagem:   resultado.status === 'criado'
        ? 'Lead criado no funil Tráfego Pago — etapa Lead Recebido.'
        : resultado.status === 'duplicado'
          ? 'Lead já existe. Não foi criado duplicado.'
          : resultado.motivo || 'Linha ignorada.',
    });
  } catch (e) {
    console.error('[webhookPlanilha]', e.message);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao processar lead.' });
  }
}


// ── GET /api/leads/importacoes ─────────────────────────────────────────────────
// Lista histórico de importações (GESTOR+)
async function listarImportacoes(req, res) {
  const { sb, isSupa } = getProvider();
  const { limite = 100, offset = 0, status, fonte } = req.query;

  try {
    if (isSupa) {
      let q = sb.from('planilha_importacoes').select('*');
      if (status) q = q.eq('status_importacao', status);
      if (fonte)  q = q.eq('fonte', fonte);
      q = q.order('criado_em', { ascending: false }).range(Number(offset), Number(offset) + Number(limite) - 1);
      const { data, error } = await q;
      if (error) throw error;
      return res.json({ sucesso: true, dados: data || [], total: data?.length || 0 });
    }
    return res.json({ sucesso: true, dados: [], aviso: 'Tabela planilha_importacoes disponível apenas com Supabase.' });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/leads/sync-planilha ─────────────────────────────────────────────
// Força uma sincronização manual com a planilha Google Sheets (GESTOR+)
async function syncManual(req, res) {
  try {
    const resultados = await planilhaSvc.sincronizarPlanilha();
    if (!resultados) {
      return res.json({ sucesso: true, mensagem: 'Sync executada. Nenhuma linha encontrada ou planilha inacessível.' });
    }
    const criados    = resultados.filter(r => r.status === 'criado').length;
    const duplicados = resultados.filter(r => r.status === 'duplicado').length;
    const erros      = resultados.filter(r => r.status === 'erro').length;
    return res.json({
      sucesso: true,
      resumo: { total: resultados.length, criados, duplicados, erros },
      resultados,
    });
  } catch (e) {
    console.error('[syncManual]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { importarPlanilha, webhookPlanilha, listarImportacoes, syncManual };
