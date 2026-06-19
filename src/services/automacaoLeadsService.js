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
// Helper: registra evento rico na tabela logs (timeline) + audit_logs
// ─────────────────────────────────────────────────────────────────────────────
async function registrarTimelineEvento({ sb, isSupa, sqlite, leadId, acao, titulo, descricao, antes, depois }) {
  const id    = crypto.randomBytes(16).toString('hex');
  const agora = new Date().toISOString();
  console.log('TIMELINE_CREATE_START', { leadId, acao });
  try {
    if (isSupa && sb) {
      await sb.from('logs').insert({
        id, acao, entidade: 'leads', entidade_id: leadId,
        antes: antes || null, depois: depois || null,
        descricao, criado_em: agora, origem_acao: 'automacao',
      }).catch(()=>{});
      await sb.from('audit_logs').insert({
        id: crypto.randomBytes(16).toString('hex'),
        acao, entidade: 'leads', entidade_id: leadId,
        descricao, criado_em: agora, origem: 'automacao',
      }).catch(()=>{});
      console.log('TIMELINE_CREATE_SUCCESS', { leadId, acao });
    } else if (sqlite) {
      try {
        sqlite.prepare(`
          INSERT INTO logs (id, usuario_id, usuario_nome, usuario_role, acao, entidade, entidade_id, dados_antes, dados_depois, ip_address, user_agent, criado_em)
          VALUES (?,NULL,'Sistema','AUTOMACAO',?,?,?,?,?,NULL,NULL,?)
        `).run(id, acao, 'leads', leadId,
          antes ? JSON.stringify(antes) : null,
          depois ? JSON.stringify(depois) : null,
          agora
        );
        console.log('TIMELINE_CREATE_SUCCESS', { leadId, acao });
      } catch(eSql) { console.warn('TIMELINE_CREATE_ERROR', { leadId, acao, err: eSql.message }); }
    }
  } catch(e) { console.error('TIMELINE_CREATE_ERROR', { leadId, acao, err: e.message }); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Módulo 1: Automação de Leads Parados
// ─────────────────────────────────────────────────────────────────────────────
async function processarLeadsParados() {
  const { sb, isSupa, sqlite } = getProvider();
  const executadoEm = new Date().toISOString();
  console.log('AUTOMACAO_SEM_RESPOSTA_START', { executadoEm, provider: isSupa ? 'supabase' : 'sqlite' });

  try {
    if (isSupa) {
      await _processarParados_Supa(sb);
    } else if (sqlite) {
      _processarParados_SQLite(sqlite);
    } else {
      console.log('[AUTOMACAO_LEADS_PARADOS] Nenhum provider disponível.');
    }
  } catch (error) {
    console.error('AUTOMACAO_SEM_RESPOSTA_ERROR', { error: error.message });
  }
}

// ── Supabase ──────────────────────────────────────────────────────────────────
async function _processarParados_Supa(sb) {
  const { data: todasEtapas = [] } = await sb.from('etapas').select('id, nome, pipeline_id');

  const resolverEtapa = (nomeAlvo) => {
    const norm = normalizar(nomeAlvo);
    return todasEtapas.find(e => normalizar(e.nome) === norm) || null;
  };

  const { data: leads = [], error: errLeads } = await sb
    .from('leads')
    .select('id, nome, etapa_id, funil_id, responsavel_id, tags, etapa_atualizada_em, criado_em, status')
    .in('status', ['ABERTO', 'ativo'])
    .not('etapa_id', 'is', null);

  if (errLeads) throw errLeads;

  const agora = Date.now();
  let movimentados = 0;

  for (const lead of leads) {
    const etapaAtual = todasEtapas.find(e => e.id === lead.etapa_id);
    if (!etapaAtual) continue;
    const nomeEtapaAtual = normalizar(etapaAtual.nome);

    // Ignora etapas finais
    if (ETAPAS_FINAIS_EXCLUIR.some(ef => normalizar(ef) === nomeEtapaAtual)) continue;

    // Usa etapa_atualizada_em com fallback para criado_em
    const dataRef = lead.etapa_atualizada_em || lead.criado_em;
    const diasParado = (agora - new Date(dataRef).getTime()) / MS_DIA;

    console.log('AUTOMACAO_SEM_RESPOSTA_LEAD_ANALISADO', {
      leadId: lead.id, etapaAtual: etapaAtual.nome,
      diasParado: Math.round(diasParado * 10) / 10,
      dataRef,
    });

    if (diasParado < DIAS_PARADO) {
      console.log('AUTOMACAO_SEM_RESPOSTA_SKIP', { leadId: lead.id, motivo: `${Math.round(diasParado)}d < ${DIAS_PARADO}d` });
      continue;
    }

    // ── Reincidência → Perdidos ───────────────────────────────────────────────
    const jaTagSemResposta = temTag(lead, TAG_SEM_RESPOSTA);
    const jaTagEsfriou     = temTag(lead, TAG_ESFRIOU);
    if (
      (jaTagSemResposta || jaTagEsfriou) &&
      (ETAPAS_DESQUALIFICAR.some(e => normalizar(e) === nomeEtapaAtual) ||
       ETAPAS_FOLLOWUP.some(e => normalizar(e) === nomeEtapaAtual))
    ) {
      const etapaDestino = resolverEtapa('Perdidos') || resolverEtapa('Perdido');
      if (!etapaDestino) { console.warn('AUTOMACAO_SEM_RESPOSTA_SKIP', { leadId: lead.id, motivo: 'Etapa Perdidos não encontrada' }); continue; }
      const novasTags = adicionarTag(lead.tags, TAG_PERDIDO_INATIVO);
      const now = new Date().toISOString();
      await sb.from('leads').update({
        etapa_id: etapaDestino.id, status: 'PERDIDO', motivo_perda: 'Inatividade recorrente',
        perdido_motivo: 'Inatividade recorrente', perdido_em: now,
        tags: novasTags, etapa_atualizada_em: now, atualizado_em: now,
      }).eq('id', lead.id);
      await registrarTimelineEvento({ sb, isSupa: true, sqlite: null, leadId: lead.id,
        acao: 'LEAD_PERDIDO',
        titulo: 'Lead marcado como perdido automaticamente',
        descricao: `Lead permaneceu parado por mais de ${DIAS_PARADO} dias após já ter sido tagueado. Motivo: Inatividade recorrente.`,
        antes: { etapa_nome: etapaAtual.nome },
        depois: { etapa_nome: etapaDestino.nome, motivo_perda: 'Inatividade recorrente', origem_acao: 'automacao' },
      });
      console.log('AUTOMACAO_SEM_RESPOSTA_LEAD_MOVIDO', { leadId: lead.id, de: etapaAtual.nome, para: etapaDestino.nome });
      movimentados++; continue;
    }

    // ── Contato Realizado → Lead Desqualificado ───────────────────────────────
    if (ETAPAS_DESQUALIFICAR.some(e => normalizar(e) === nomeEtapaAtual)) {
      const etapaDestino = resolverEtapa('Lead Desqualificado') || resolverEtapa('Desqualificado');
      if (!etapaDestino) { console.warn('AUTOMACAO_SEM_RESPOSTA_SKIP', { leadId: lead.id, motivo: 'Etapa Lead Desqualificado não encontrada' }); continue; }
      const novasTags = adicionarTag(lead.tags, TAG_SEM_RESPOSTA);
      const now = new Date().toISOString();
      await sb.from('leads').update({
        etapa_id: etapaDestino.id, status: 'PERDIDO',
        motivo_perda: 'Não respondeu', perdido_motivo: 'Não respondeu', perdido_em: now,
        tags: novasTags, etapa_atualizada_em: now, atualizado_em: now,
      }).eq('id', lead.id);
      await registrarTimelineEvento({ sb, isSupa: true, sqlite: null, leadId: lead.id,
        acao: 'AUTOMACAO_SEM_RESPOSTA',
        titulo: 'Lead desqualificado automaticamente',
        descricao: `Lead permaneceu ${Math.ceil(diasParado)} dia(s) em "${etapaAtual.nome}" sem resposta e foi movido para "${etapaDestino.nome}". Motivo: Não respondeu.`,
        antes: { etapa_nome: etapaAtual.nome, etapa_id: lead.etapa_id },
        depois: { etapa_nome: etapaDestino.nome, etapa_id: etapaDestino.id, motivo: 'Não respondeu', origem_acao: 'automacao' },
      });
      console.log('AUTOMACAO_SEM_RESPOSTA_LEAD_MOVIDO', { leadId: lead.id, de: etapaAtual.nome, para: etapaDestino.nome, diasParado: Math.ceil(diasParado) });
      movimentados++; continue;
    }

    // ── Tratativa / Orçamento / Amostra → Follow-Up ───────────────────────────
    if (ETAPAS_FOLLOWUP.some(e => normalizar(e) === nomeEtapaAtual)) {
      const etapaDestino = resolverEtapa('Follow-Up') || resolverEtapa('Follow-up');
      if (!etapaDestino) { console.warn('AUTOMACAO_SEM_RESPOSTA_SKIP', { leadId: lead.id, motivo: 'Etapa Follow-Up não encontrada' }); continue; }
      const novasTags = adicionarTag(lead.tags, TAG_ESFRIOU);
      const now = new Date().toISOString();
      await sb.from('leads').update({
        etapa_id: etapaDestino.id, status: 'ABERTO',
        tags: novasTags, etapa_atualizada_em: now, atualizado_em: now,
      }).eq('id', lead.id);
      await registrarTimelineEvento({ sb, isSupa: true, sqlite: null, leadId: lead.id,
        acao: 'AUTOMACAO_SEM_RESPOSTA',
        titulo: 'Lead movido para Follow-Up automaticamente',
        descricao: `Lead parado ${Math.ceil(diasParado)} dia(s) em "${etapaAtual.nome}". Movido para Follow-Up.`,
        antes: { etapa_nome: etapaAtual.nome },
        depois: { etapa_nome: etapaDestino.nome, origem_acao: 'automacao' },
      });
      console.log('AUTOMACAO_SEM_RESPOSTA_LEAD_MOVIDO', { leadId: lead.id, de: etapaAtual.nome, para: etapaDestino.nome });
      movimentados++;
    }
  }

  console.log('AUTOMACAO_SEM_RESPOSTA_FIM', { leadsAnalisados: leads.length, movimentados });
}

// ── SQLite ────────────────────────────────────────────────────────────────────
function _processarParados_SQLite(sqlite) {
  const agora = Date.now();
  let movimentados = 0;

  // Busca leads ativos
  const leads = sqlite.prepare(`
    SELECT l.*, e.nome as etapa_nome
    FROM leads l
    LEFT JOIN etapas e ON l.etapa_id = e.id
    WHERE l.status IN ('ABERTO','ativo')
      AND l.etapa_id IS NOT NULL
  `).all();

  for (const lead of leads) {
    const nomeEtapaAtual = normalizar(lead.etapa_nome || '');
    if (!nomeEtapaAtual) continue;
    if (ETAPAS_FINAIS_EXCLUIR.some(ef => normalizar(ef) === nomeEtapaAtual)) continue;

    const dataRef = lead.etapa_atualizada_em || lead.criado_em;
    const diasParado = (agora - new Date(dataRef).getTime()) / MS_DIA;

    console.log('AUTOMACAO_SEM_RESPOSTA_LEAD_ANALISADO', {
      leadId: lead.id, etapaAtual: lead.etapa_nome,
      diasParado: Math.round(diasParado * 10) / 10,
    });

    if (diasParado < DIAS_PARADO) {
      console.log('AUTOMACAO_SEM_RESPOSTA_SKIP', { leadId: lead.id, motivo: `${Math.round(diasParado)}d < ${DIAS_PARADO}d` });
      continue;
    }

    // Resolve etapa destino
    let etapaDestNome, statusDestino, motivo;
    const jaTagSemResposta = temTag(lead, TAG_SEM_RESPOSTA);

    if (ETAPAS_DESQUALIFICAR.some(e => normalizar(e) === nomeEtapaAtual)) {
      if (jaTagSemResposta) {
        etapaDestNome = 'Perdidos'; statusDestino = 'PERDIDO'; motivo = 'Inatividade recorrente';
      } else {
        etapaDestNome = 'Lead Desqualificado'; statusDestino = 'PERDIDO'; motivo = 'Não respondeu';
      }
    } else if (ETAPAS_FOLLOWUP.some(e => normalizar(e) === nomeEtapaAtual)) {
      etapaDestNome = 'Follow-Up'; statusDestino = 'ABERTO'; motivo = null;
    } else continue;

    // Resolve etapa destino no banco
    const etapaDestRow = sqlite.prepare(`SELECT id, nome FROM etapas WHERE nome=? LIMIT 1`).get(etapaDestNome)
      || sqlite.prepare(`SELECT id, nome FROM etapas WHERE nome LIKE ? LIMIT 1`).get(`%${etapaDestNome}%`);
    if (!etapaDestRow) {
      console.warn('AUTOMACAO_SEM_RESPOSTA_SKIP', { leadId: lead.id, motivo: `Etapa "${etapaDestNome}" não encontrada` });
      continue;
    }

    const now = new Date().toISOString();
    const novasTags = adicionarTag(lead.tags, motivo === 'Não respondeu' ? TAG_SEM_RESPOSTA : TAG_PERDIDO_INATIVO);

    sqlite.prepare(`
      UPDATE leads SET etapa_id=?, status=?, motivo_perda=?, perdido_motivo=?,
        tags=?, etapa_atualizada_em=?, atualizado_em=?
      WHERE id=?
    `).run(
      etapaDestRow.id, statusDestino, motivo||null, motivo||null,
      JSON.stringify(novasTags), now, now, lead.id
    );

    // Registra na timeline (logs)
    const logId = crypto.randomBytes(16).toString('hex');
    try {
      sqlite.prepare(`
        INSERT INTO logs (id, usuario_id, usuario_nome, usuario_role, acao, entidade, entidade_id, dados_antes, dados_depois, ip_address, user_agent, criado_em)
        VALUES (?,NULL,'Sistema','AUTOMACAO','AUTOMACAO_SEM_RESPOSTA','leads',?,?,?,NULL,NULL,?)
      `).run(logId, lead.id,
        JSON.stringify({ etapa_nome: lead.etapa_nome, etapa_id: lead.etapa_id }),
        JSON.stringify({ etapa_nome: etapaDestRow.nome, etapa_id: etapaDestRow.id, motivo: motivo||'automação', origem_acao: 'automacao' }),
        now
      );
    } catch(eLg) { console.warn('TIMELINE_CREATE_ERROR', { leadId: lead.id, err: eLg.message }); }

    console.log('AUTOMACAO_SEM_RESPOSTA_LEAD_MOVIDO', { leadId: lead.id, de: lead.etapa_nome, para: etapaDestRow.nome });
    movimentados++;
  }

  console.log('AUTOMACAO_SEM_RESPOSTA_FIM', { leadsAnalisados: leads.length, movimentados });
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
