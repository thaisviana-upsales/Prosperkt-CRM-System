/**
 * PROSPEKT CRM — Automações de Leads
 *
 * Módulo 1: Stale Leads (leads parados > 7 dias numa etapa)
 *   - Contato Realizado → Desqualificado + tag "sem resposta"
 *   - Contato em Tratativa / Orçamento Enviado / Amostra Física → Follow-up + tag "esfriou após contato"
 *   - Reincidência (já tagueado) → Perdido + tag "perdido por inatividade"
 *
 * Módulo 2: SLA Contato 1 (primeira mensagem automática ao criar lead)
 *   - Envia mensagem WhatsApp de boas-vindas assim que o lead é criado
 *   - Deduplicado por lead_id + tipo
 */

const { getProvider } = require('../database/dbProvider');
const evoSvc = require('./evolutionApiService');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const DIAS_PARADO = 7;
const MS_DIA = 86_400_000;

// Etapas de ORIGEM (por nome, case-insensitive normalizado)
const ETAPAS_DESQUALIFICAR  = ['contato realizado'];
const ETAPAS_FOLLOWUP       = ['contato em tratativa', 'orçamento enviado', 'orcamento enviado', 'amostra fisica', 'amostra física'];
const ETAPAS_FINAIS_EXCLUIR = ['venda', 'vendas', 'ganho', 'venda fechada', 'perdido', 'desqualificado', 'desqualificado'];

// Tags automáticas
const TAG_SEM_RESPOSTA    = 'sem resposta';
const TAG_ESFRIOU         = 'esfriou após contato';
const TAG_PERDIDO_INATIVO = 'perdido por inatividade';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: normaliza nome para comparação
// ─────────────────────────────────────────────────────────────────────────────
function normalizar(s = '') {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: verifica se lead tem tag
// ─────────────────────────────────────────────────────────────────────────────
function temTag(lead, tag) {
  const tags = Array.isArray(lead.tags) ? lead.tags : [];
  return tags.some(t => normalizar(t) === normalizar(tag));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: adiciona tag sem duplicar
// ─────────────────────────────────────────────────────────────────────────────
function adicionarTag(tags, novaTag) {
  const arr = Array.isArray(tags) ? [...tags] : [];
  if (!arr.some(t => normalizar(t) === normalizar(novaTag))) arr.push(novaTag);
  return arr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: registra no histórico do lead (audit_logs)
// ─────────────────────────────────────────────────────────────────────────────
async function registrarHistorico(sb, leadId, mensagem) {
  try {
    await sb.from('audit_logs').insert({
      id:         crypto.randomBytes(16).toString('hex'),
      usuario_id: null,
      acao:       'AUTOMACAO',
      entidade:   'leads',
      entidade_id: leadId,
      descricao:  mensagem,
      criado_em:  new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[AUTOMACAO] Falha ao registrar histórico (não crítico):', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Módulo 1: Automação de Leads Parados
// ─────────────────────────────────────────────────────────────────────────────
async function processarLeadsParados() {
  const { sb, isSupa } = getProvider();
  if (!isSupa) {
    console.log('[AUTOMACAO_LEADS_PARADOS] Apenas disponível com Supabase — ignorando.');
    return;
  }

  const executadoEm = new Date().toISOString();
  console.log('AUTOMACAO_LEADS_PARADOS_INICIO', { executadoEm });

  try {
    // 1. Carrega todas as etapas para resolução por nome
    const { data: todasEtapas = [] } = await sb.from('etapas').select('id, nome, funil_id');

    const resolverEtapa = (nomeAlvo) => {
      const norm = normalizar(nomeAlvo);
      return todasEtapas.find(e => normalizar(e.nome) === norm) || null;
    };

    // 2. Busca leads ativos com etapa_atualizada_em preenchida
    const { data: leads = [], error: errLeads } = await sb
      .from('leads')
      .select('id, nome, etapa_id, funil_id, responsavel_id, tags, etapa_atualizada_em, status')
      .eq('status', 'ativo')
      .not('etapa_id', 'is', null)
      .not('etapa_atualizada_em', 'is', null);

    if (errLeads) throw errLeads;

    const agora = Date.now();
    let movimentados = 0;

    for (const lead of leads) {
      // Ignora etapas finais
      const etapaAtual = todasEtapas.find(e => e.id === lead.etapa_id);
      if (!etapaAtual) continue;
      const nomeEtapaAtual = normalizar(etapaAtual.nome);
      if (ETAPAS_FINAIS_EXCLUIR.some(ef => normalizar(ef) === nomeEtapaAtual)) continue;

      // Calcula dias parado
      const entradaEm = new Date(lead.etapa_atualizada_em).getTime();
      const diasParado = (agora - entradaEm) / MS_DIA;

      console.log('AUTOMACAO_LEAD_ANALISADO', {
        leadId: lead.id,
        nome: lead.nome,
        etapaAtual: etapaAtual.nome,
        dataEntradaEtapa: lead.etapa_atualizada_em,
        diasParado: Math.floor(diasParado),
      });

      if (diasParado < DIAS_PARADO) continue;

      // ── Regra 3: Reincidência → Perdido ──────────────────────────────────
      const jaTagSemResposta = temTag(lead, TAG_SEM_RESPOSTA);
      const jaTagEsfriou     = temTag(lead, TAG_ESFRIOU);
      if (
        (jaTagSemResposta || jaTagEsfriou) &&
        (ETAPAS_DESQUALIFICAR.some(e => normalizar(e) === nomeEtapaAtual) ||
         ETAPAS_FOLLOWUP.some(e => normalizar(e) === nomeEtapaAtual))
      ) {
        const etapaDestino = resolverEtapa('Perdido');
        if (!etapaDestino) {
          console.warn('AUTOMACAO_ETAPA_DESTINO_NAO_ENCONTRADA', { leadId: lead.id, etapaDestino: 'Perdido' });
          continue;
        }
        const novasTags = adicionarTag(lead.tags, TAG_PERDIDO_INATIVO);
        await sb.from('leads').update({
          etapa_id: etapaDestino.id,
          status: 'perdido',
          tags: novasTags,
          etapa_atualizada_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        }).eq('id', lead.id);
        const msg = `Lead movido automaticamente para Perdido após inatividade recorrente por mais de ${DIAS_PARADO} dias.`;
        await registrarHistorico(sb, lead.id, msg);
        console.log('AUTOMACAO_LEAD_MOVIMENTADO', {
          leadId: lead.id, etapaOrigem: etapaAtual.nome, etapaDestino: 'Perdido',
          tagAplicada: TAG_PERDIDO_INATIVO, vendedorResponsavel: lead.responsavel_id,
        });
        movimentados++;
        continue;
      }

      // ── Regra 1: Contato Realizado → Desqualificado ───────────────────────
      if (ETAPAS_DESQUALIFICAR.some(e => normalizar(e) === nomeEtapaAtual)) {
        const etapaDestino = resolverEtapa('Desqualificado');
        if (!etapaDestino) {
          console.warn('AUTOMACAO_ETAPA_DESTINO_NAO_ENCONTRADA', { leadId: lead.id, etapaDestino: 'Desqualificado' });
          continue;
        }
        const novasTags = adicionarTag(lead.tags, TAG_SEM_RESPOSTA);
        await sb.from('leads').update({
          etapa_id: etapaDestino.id,
          status: 'perdido',
          tags: novasTags,
          etapa_atualizada_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        }).eq('id', lead.id);
        const msg = `Lead movido automaticamente para Desqualificado após ${DIAS_PARADO} dias parado em ${etapaAtual.nome}. Tag aplicada: ${TAG_SEM_RESPOSTA}.`;
        await registrarHistorico(sb, lead.id, msg);
        console.log('AUTOMACAO_LEAD_MOVIMENTADO', {
          leadId: lead.id, etapaOrigem: etapaAtual.nome, etapaDestino: 'Desqualificado',
          tagAplicada: TAG_SEM_RESPOSTA, vendedorResponsavel: lead.responsavel_id,
        });
        movimentados++;
        continue;
      }

      // ── Regra 2: Tratativa / Orçamento / Amostra → Follow-up ─────────────
      if (ETAPAS_FOLLOWUP.some(e => normalizar(e) === nomeEtapaAtual)) {
        const etapaDestino = resolverEtapa('Follow-up');
        if (!etapaDestino) {
          console.warn('AUTOMACAO_ETAPA_DESTINO_NAO_ENCONTRADA', { leadId: lead.id, etapaDestino: 'Follow-up' });
          continue;
        }
        const novasTags = adicionarTag(lead.tags, TAG_ESFRIOU);
        await sb.from('leads').update({
          etapa_id: etapaDestino.id,
          status: 'ativo',
          tags: novasTags,
          etapa_atualizada_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        }).eq('id', lead.id);
        const msg = `Lead movido automaticamente para Follow-up após ${DIAS_PARADO} dias parado na etapa ${etapaAtual.nome}. Tag aplicada: ${TAG_ESFRIOU}.`;
        await registrarHistorico(sb, lead.id, msg);
        console.log('AUTOMACAO_LEAD_MOVIMENTADO', {
          leadId: lead.id, etapaOrigem: etapaAtual.nome, etapaDestino: 'Follow-up',
          tagAplicada: TAG_ESFRIOU, vendedorResponsavel: lead.responsavel_id,
        });
        movimentados++;
      }
    }

    console.log('AUTOMACAO_LEADS_PARADOS_FIM', { executadoEm, leadsAnalisados: leads.length, movimentados });
  } catch (error) {
    console.error('AUTOMACAO_LEADS_PARADOS_ERRO', { error: error.message, stack: error.stack });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Módulo 2: SLA Contato 1 — Primeira mensagem automática
// ─────────────────────────────────────────────────────────────────────────────

const MSG_SLA_CONTATO_1 = (nome) => {
  const saudacao = nome ? `Oi, ${nome}! Tudo bem? 😊` : 'Oi! Tudo bem? 😊';
  return `${saudacao}

Recebi seu contato aqui na PROSPEKT e já vou te ajudar.

Pra eu te direcionar da melhor forma e ganhar tempo no seu atendimento, me responde rapidinho:

1️⃣ Qual brinde ou produto você está buscando?

2️⃣ Você já tem uma quantidade aproximada?

3️⃣ Você está comprando para uma agência ou para uma marca direta?

Com essas respostas, consigo te encaminhar o melhor consultor e agilizar seu orçamento. 🚀`;
};

/**
 * Normaliza telefone para formato WhatsApp: 55 + DDD + número (10-11 dígitos)
 * Retorna null se inválido.
 */
function normalizarTelefone(tel) {
  if (!tel) return null;
  let t = String(tel).replace(/\D/g, '');
  if (t.length === 8 || t.length === 9) return null; // sem DDD
  if (t.startsWith('55')) {
    if (t.length < 12 || t.length > 13) return null;
    return t;
  }
  if (t.length === 10 || t.length === 11) return '55' + t;
  return null;
}

/**
 * Dispara SLA Contato 1 para um lead recém-criado.
 * Chamado de forma assíncrona (não bloqueia criação do lead).
 *
 * @param {{ id, nome, telefone, responsavel_id }} lead
 */
async function enviarSlaContato1(lead) {
  const { sb, isSupa } = getProvider();
  if (!isSupa) return; // Só funciona com Supabase

  const leadId = lead.id;
  const nome   = lead.nome || '';

  console.log('AUTOMACAO_SLA_CONTATO_1_INICIO', { leadId, nome, telefone: lead.telefone });

  // 1. Verificar se já foi enviado (deduplicação)
  const { data: jaEnviado } = await sb.from('audit_logs')
    .select('id')
    .eq('entidade_id', leadId)
    .eq('acao', 'SLA_CONTATO_1')
    .maybeSingle();
  if (jaEnviado) {
    console.log('AUTOMACAO_SLA_CONTATO_1_JA_ENVIADA', { leadId });
    return;
  }

  // 2. Validar telefone
  const telNorm = normalizarTelefone(lead.telefone);
  if (!telNorm) {
    const motivo = lead.telefone ? 'telefone inválido' : 'lead sem telefone';
    console.warn('AUTOMACAO_SLA_CONTATO_1_NAO_ENVIADA', { leadId, motivo });
    await registrarHistorico(sb, leadId, `Automação SLA de contato 1 não enviada: ${motivo}.`);
    return;
  }

  console.log('AUTOMACAO_SLA_CONTATO_1_TELEFONE_NORMALIZADO', { leadId, telefoneNormalizado: telNorm });

  // 3. Verificar se a Evolution API está configurada
  if (!evoSvc.isConfigured()) {
    console.warn('AUTOMACAO_SLA_CONTATO_1_NAO_ENVIADA', { leadId, motivo: 'Evolution API não configurada' });
    return;
  }

  try {
    // 4. Enviar mensagem via Evolution API
    const mensagem = MSG_SLA_CONTATO_1(nome);
    await evoSvc.enviarTexto(telNorm, mensagem);

    // 5. Encontrar ou criar conversa
    const agora = new Date().toISOString();
    let conversaId = null;
    const { data: convExistente } = await sb.from('conversas_whatsapp')
      .select('id')
      .or(`telefone.eq.${telNorm},telefone.eq.${telNorm.slice(2)}`)
      .neq('status', 'FECHADA')
      .limit(1)
      .maybeSingle();

    if (convExistente) {
      conversaId = convExistente.id;
      await sb.from('conversas_whatsapp').update({ ultima_msg_em: agora, atualizado_em: agora }).eq('id', conversaId);
    } else {
      conversaId = crypto.randomBytes(16).toString('hex');
      await sb.from('conversas_whatsapp').insert({
        id: conversaId,
        telefone: telNorm,
        nome_contato: nome || null,
        lead_id: leadId,
        origem: 'AUTOMACAO',
        status: 'ABERTA',
        ultima_msg_em: agora,
        criado_em: agora,
        atualizado_em: agora,
      });
    }

    // 6. Salvar mensagem na conversa
    const msgId = crypto.randomBytes(16).toString('hex');
    await sb.from('mensagens_whatsapp').insert({
      id: msgId,
      conversa_id: conversaId,
      lead_id: leadId,
      telefone: telNorm,
      mensagem: mensagem,
      tipo: 'texto',
      direcao: 'enviada',
      status: 'enviado',
      criado_em: agora,
    });

    // 7. Registrar no histórico (com ação SLA_CONTATO_1 para deduplicação)
    await sb.from('audit_logs').insert({
      id:          crypto.randomBytes(16).toString('hex'),
      usuario_id:  null,
      acao:        'SLA_CONTATO_1',
      entidade:    'leads',
      entidade_id: leadId,
      descricao:   'Automação SLA de contato 1 enviada automaticamente no momento da criação do lead.',
      criado_em:   agora,
    });

    console.log('AUTOMACAO_SLA_CONTATO_1_ENVIADA', { leadId, conversaId, telefoneNormalizado: telNorm });
  } catch (error) {
    console.error('AUTOMACAO_SLA_CONTATO_1_ERRO', { leadId, error: error.message });
    // Não registra como enviada — permite nova tentativa futura se necessário
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler: executa automação de leads parados a cada 6 horas
// ─────────────────────────────────────────────────────────────────────────────
const INTERVALO_6H = 6 * 60 * 60 * 1000;

function iniciarAutomacoes() {
  console.log('[AUTOMACOES] Iniciando serviço de automações...');

  // Primeira execução após 30s (aguarda banco estabilizar)
  setTimeout(() => {
    processarLeadsParados().catch(e => console.error('[AUTOMACOES] Erro inicial:', e.message));
  }, 30_000);

  // Execuções recorrentes a cada 6 horas
  setInterval(() => {
    processarLeadsParados().catch(e => console.error('[AUTOMACOES] Erro recorrente:', e.message));
  }, INTERVALO_6H);

  console.log('[AUTOMACOES] Serviço iniciado. Leads parados verificados a cada 6h.');
}

module.exports = { iniciarAutomacoes, enviarSlaContato1, processarLeadsParados };
