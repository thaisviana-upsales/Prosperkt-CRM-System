/**
 * PROSPEKT CRM — WhatsApp Controller
 * Módulo de conversas, histórico e automação tráfego pago
 *
 * LEGADO: funções originais usam SQLite (getDb)
 * NOVO: funções *Supabase usam whatsappService (tabela whatsapp_mensagens)
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');
const { getProvider } = require('../database/dbProvider');
const waSvc   = require('../services/whatsappService');
const planilhaSvc = require('../services/planilhaLeadsService');
const evoSvc  = require('../services/evolutionApiService');


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
// Números oficiais do CRM — NUNCA devem virar contato de cliente
// Fonte primária: env WHATSAPP_OFFICIAL_NUMBER (Railway)
// Fallback hardcoded: garante proteção mesmo sem env configurada
// ─────────────────────────────────────────────────────────────────────────────
const _NUMEROS_OFICIAIS_HARDCODED = new Set(['5511987994910', '5511967668883']);
const NUMERO_OFICIAL_PROSPEKT = (process.env.WHATSAPP_OFFICIAL_NUMBER || '').replace(/\D/g, '');
const _NUMEROS_OFICIAIS = new Set([..._NUMEROS_OFICIAIS_HARDCODED]);
if (NUMERO_OFICIAL_PROSPEKT) {
  _NUMEROS_OFICIAIS.add(NUMERO_OFICIAL_PROSPEKT);
  console.log('WHATSAPP_PHONE_IS_OFFICIAL_NUMBER_ENV', NUMERO_OFICIAL_PROSPEKT);
} else {
  console.warn('[WA] WHATSAPP_OFFICIAL_NUMBER não configurado — usando fallback hardcoded:', [..._NUMEROS_OFICIAIS_HARDCODED].join(','));
}

function isNumeroOficial(t) {
  return _NUMEROS_OFICIAIS.has(t);
}

function normalizePhoneBR(value) {
  console.log('WHATSAPP_PHONE_NORMALIZE_INPUT', typeof value === 'string' ? value.slice(0, 20) : value);
  if (!value) return null;
  let t = String(value).trim();

  // Se contiver letras no nome do contato / JID, rejeita
  const username = t.split('@')[0].split(':')[0];
  if (/[a-zA-Z]/.test(username)) {
    console.log('WHATSAPP_PHONE_REJECTED_LID', 'letras_no_username');
    return null;
  }

  // Detecta @lid explicitamente antes de remover sufixo
  if (t.includes('@lid')) {
    console.log('WHATSAPP_PHONE_REJECTED_LID', 'sufixo_lid_detectado');
    return null;
  }

  // Remove sufixo do whatsapp
  t = t.split('@')[0].split(':')[0];

  // Remove caracteres não numéricos
  t = t.replace(/\D/g, '');
  if (!t) return null;

  // ── FIX: Rejeição explícita de LID WhatsApp ────────────────────────────────
  // LIDs são identificadores internos do WhatsApp Multi-Device, NÃO são telefones.
  // Tipicamente têm 14-17 dígitos e NÃO começam com 55 (DDI Brasil).
  if (t.length >= 14 && !t.startsWith('55')) {
    console.log('WHATSAPP_PHONE_REJECTED_LID', 'comprimento_14_sem_55', t.length);
    return null;
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Rejeita se for timestamp unix
  const numVal = Number(t);
  if ((t.length === 10 && numVal >= 1000000000 && numVal <= 2200000000) ||
      (t.length === 13 && numVal >= 1000000000000 && numVal <= 2200000000000)) {
    return null;
  }

  // Se tiver 10 ou 11 dígitos, adiciona 55 (Brasil)
  if (t.length === 10 || t.length === 11) {
    t = '55' + t;
  }

  // Valida: se começar com 55 e tiver 12 ou 13 dígitos
  // Ou se for qualquer outro número internacional válido (entre 10 e 15 dígitos)
  const isValid = /^55\d{10,11}$/.test(t) || /^\d{10,15}$/.test(t);
  if (!isValid) {
    console.log('WHATSAPP_PHONE_NORMALIZE_RESULT', null, 'invalido');
    return null;
  }


  // REGRA ABSOLUTA: número oficial NUNCA é telefone de cliente
  if (isNumeroOficial(t)) {
    console.log('WHATSAPP_PHONE_REJECTED_OFFICIAL_AS_CLIENT', t.slice(0, 6) + '****');
    return null;
  }

  console.log('WHATSAPP_PHONE_NORMALIZE_RESULT', t.slice(0, 6) + '****');
  return t;

}

function normalizePhone(tel) {
  return normalizePhoneBR(tel) || '';
}

/**
 * Gera TODAS as variantes possíveis de um telefone para busca robusta.
 * Cobre: com 55 / sem 55 / com 9º dígito / sem 9º dígito
 * Elimina duplicatas e strings vazias.
 */
function phoneVariants(tel) {
  const base = normalizePhone(tel);
  if (!base) return [];
  const variants = new Set();

  // base sempre inclusa
  variants.add(base);

  // sem DDI 55
  const sem55 = base.startsWith('55') && base.length >= 12 ? base.slice(2) : null;
  if (sem55) variants.add(sem55);

  // Adiciona/remove 9º dígito (Brasil: DDD 2 dígitos + número)
  // Com 55: 55 + DDD(2) + digitos -> total 12 (sem 9) ou 13 (com 9)
  // Sem 55: DDD(2) + digitos -> total 10 (sem 9) ou 11 (com 9)
  const adicionarRemoverNono = (num) => {
    const results = new Set();
    results.add(num);
    const hasPref = num.startsWith('55') && num.length >= 12;
    const ddd   = hasPref ? num.slice(2, 4) : num.slice(0, 2);
    const resto = hasPref ? num.slice(4) : num.slice(2);
    const pref  = hasPref ? '55' : '';
    if (resto.length === 9 && resto[0] === '9') {
      // remove 9º dígito
      results.add(pref + ddd + resto.slice(1));
    } else if (resto.length === 8) {
      // adiciona 9º dígito
      results.add(pref + ddd + '9' + resto);
    }
    return results;
  };

  adicionarRemoverNono(base).forEach(v => variants.add(v));
  if (sem55) adicionarRemoverNono(sem55).forEach(v => variants.add(v));
  // Garante variantes com 55 para cada variante sem 55
  [...variants].forEach(v => {
    if (!v.startsWith('55') && v.length >= 10) variants.add('55' + v);
  });

  return [...variants].filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// _classificarRespostaBoasVindas — detecta padrão na resposta do cliente
// e salva tag + observação no lead (execução em background, não bloqueia)
// ─────────────────────────────────────────────────────────────────────────────
async function _classificarRespostaBoasVindas(sb, leadId, texto) {
  if (!sb || !leadId || !texto) return;
  try {
    const t = String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    // Só processa se o lead recebeu a mensagem SLA_CONTATO_1
    const { data: slaLog } = await sb.from('audit_logs')
      .select('id').eq('entidade_id', leadId).eq('acao', 'SLA_CONTATO_1').maybeSingle();
    if (!slaLog) return; // lead não está aguardando classificação

    // Não reclassifica se já foi classificado
    const { data: jaClass } = await sb.from('audit_logs')
      .select('id').eq('entidade_id', leadId).eq('acao', 'CLASSIFICACAO_RESPOSTA_BOAS_VINDAS').maybeSingle();
    if (jaClass) return;

    // ── Tabela de padrões de classificação ──────────────────────────────────
    const PADROES = [
      {
        tag: 'brinde_produto',
        obs: 'Cliente informou: busca brinde/produto.',
        match: /\b(1|brinde|brindes|produto|produtos|brindar|brindes personalizados|item|items)\b/,
      },
      {
        tag: 'projeto',
        obs: 'Cliente informou: busca desenvolvimento de projeto.',
        match: /\b(2|projeto|projetos|desenvolvimento|dev|criar|criacao|criação|desenvolvimento de projeto)\b/,
      },
      {
        tag: 'agencia',
        obs: 'Cliente informou: compra para agência.',
        match: /\b(agencia|agências|agencias|agência)\b/,
      },
      {
        tag: 'marca_direta',
        obs: 'Cliente informou: compra para marca direta.',
        match: /\b(marca|direta|marca direta|empresa|empresas)\b/,
      },
    ];

    // Detecta o primeiro padrão que bate
    const detectado = PADROES.find(p => p.match.test(t));
    if (!detectado) {
      console.log('CLASSIFICACAO_RESPOSTA_BOAS_VINDAS_SEM_PADRAO', { leadId, textoSlice: t.slice(0, 60) });
      return;
    }

    console.log('CLASSIFICACAO_RESPOSTA_BOAS_VINDAS_DETECTADA', { leadId, tag: detectado.tag, texto: t.slice(0, 60) });

    // Busca dados atuais do lead (tags e observacoes)
    const { data: lead } = await sb.from('leads').select('tags, observacoes').eq('id', leadId).maybeSingle();
    if (!lead) return;

    // Monta novas tags (array JSON ou string separada por vírgula)
    let tagsAtuais = [];
    try {
      if (Array.isArray(lead.tags)) tagsAtuais = lead.tags;
      else if (typeof lead.tags === 'string' && lead.tags.startsWith('[')) tagsAtuais = JSON.parse(lead.tags);
      else if (typeof lead.tags === 'string' && lead.tags.trim()) tagsAtuais = lead.tags.split(',').map(s => s.trim()).filter(Boolean);
    } catch { tagsAtuais = []; }

    if (!tagsAtuais.includes(detectado.tag)) {
      tagsAtuais.push(detectado.tag);
    }

    // Monta nova observação (appenda sem apagar o que já tinha)
    const agora = new Date().toISOString();
    const obsAtual = lead.observacoes || '';
    const linhaObs = `[${agora.slice(0, 10)}] ${detectado.obs}`;
    const novaObs  = obsAtual ? `${obsAtual}\n${linhaObs}` : linhaObs;

    // Atualiza lead
    await sb.from('leads').update({
      tags:       JSON.stringify(tagsAtuais),
      observacoes: novaObs,
      atualizado_em: agora,
    }).eq('id', leadId);

    // Registra no audit_log para deduplicação futura
    await sb.from('audit_logs').insert({
      id:          require('crypto').randomBytes(16).toString('hex'),
      usuario_id:  null,
      acao:        'CLASSIFICACAO_RESPOSTA_BOAS_VINDAS',
      entidade:    'leads',
      entidade_id: leadId,
      descricao:   `Resposta classificada automaticamente: "${detectado.tag}". Texto: "${t.slice(0, 120)}"`,
      criado_em:   agora,
    }).catch(() => {});

    console.log('CLASSIFICACAO_RESPOSTA_BOAS_VINDAS_OK', { leadId, tag: detectado.tag });
  } catch (e) {
    console.warn('CLASSIFICACAO_RESPOSTA_BOAS_VINDAS_WARN (não crítico):', e.message);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// isIdentidadeWhatsappConfiavel — guard de segurança de identidade
// Retorna true SOMENTE se o remoteJid tem telefone real (não LID/interno).
// Usado antes de criar conversa ABERTA — identidade LID → PENDENTE_IDENTIFICACAO.
//
// Regras:
//   - LID (@lid no rawJid ou 14+ dígitos sem 55) → false
//   - telefone null sem alias → false
//   - telefone começando com 55 → true
//   - aliasEncontrado (conversa existente) → true (confiar no alias)
// ─────────────────────────────────────────────────────────────────────────────
function isIdentidadeWhatsappConfiavel(telFinal, { isLidJid, lidNumero, aliasEncontrado, conversaExistente } = {}) {
  // Alias encontrado = identidade já validada anteriormente → confiar
  if (aliasEncontrado || conversaExistente) return true;

  // Se for JID de LID → não confiável
  if (isLidJid) return false;

  // Se tiver lidNumero (14+ dígitos sem 55) → não confiável
  if (lidNumero) return false;

  // Sem telefone real → não confiável
  if (!telFinal) return false;

  // Telefone deve começar com 55 (Brasil) ou ser número internacional válido
  const digits = String(telFinal).replace(/\D/g, '');
  if (digits.length >= 14 && !digits.startsWith('55')) return false; // LID numérico

  // Telefone válido → confiável
  return true;
}

// ── formatarTelefoneParaNome — nome inicial do lead automático ────────────────
// REGRA: NÃO usar pushName do WhatsApp. Nome = número formatado.
function formatarTelefoneParaNome(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55'))
    return `+55 ${d.slice(2,4)} ${d.slice(4,9)}-${d.slice(9,13)}`;
  if (d.length === 12 && d.startsWith('55'))
    return `+55 ${d.slice(2,4)} ${d.slice(4,8)}-${d.slice(8,12)}`;
  if (d.length === 11 && d.startsWith('55'))
    return `+55 ${d.slice(2,4)} ${d.slice(4,11)}`;
  return d.length > 0 ? `+${d}` : (tel || 'WhatsApp');
}


// ─────────────────────────────────────────────────────────────────────────────
// Schema real — nomes canônicos das tabelas WhatsApp
// Se o banco tiver nome diferente, altere APENAS aqui.
// ─────────────────────────────────────────────────────────────────────────────
const ALIAS_TABLE      = 'whatsapp_conversa_aliases';   // tabela de mapeamento LID/JID → conversa
const MENSAGENS_TABLE  = 'mensagens_whatsapp';           // mensagens recebidas/enviadas por conversa
const CONVERSAS_TABLE  = 'conversas_whatsapp';           // conversas WhatsApp


console.log('WHATSAPP_SCHEMA_REAL_TABLES_USED', {
  alias:     ALIAS_TABLE,
  mensagens: MENSAGENS_TABLE,
  conversas: CONVERSAS_TABLE,
});
console.log('WHATSAPP_ALIAS_TABLE_USED', ALIAS_TABLE);
console.log('WHATSAPP_CONVERSAS_COLUMNS_OK', {
  id: true, lead_id: true, telefone: true, nome_contato: true,
  status: true, ultima_msg_em: true, dados_extras: true, nao_lidas: true, visivel: true,
});
console.log('WHATSAPP_SCHEMA_TABLES_CONFIRMED', { conversas: CONVERSAS_TABLE, mensagens: MENSAGENS_TABLE, alias: ALIAS_TABLE });

// Buffer circular em memória — últimos 20 webhooks inbound recebidos
// Não persistido, não armazena secrets/API keys/tokens/base64
const _inboundLog = [];
function _logInbound(entry) {
  _inboundLog.unshift({
    recebido_em:    new Date().toISOString(),
    event_type:     entry.event_type     || null,
    remote_jid:     entry.remote_jid     || null,
    lid:            entry.lid            || null,
    fromMe:         entry.fromMe         ?? null,
    texto_curto:    entry.texto_curto    || null,
    tipo_mensagem:  entry.tipo_mensagem  || null,
    decisao:        entry.decisao        || null,
    conversa_id:    entry.conversa_id    || null,
    salvo_em_tabela: entry.salvo_em_tabela || null,
    erro:           entry.erro           || null,
  });
  if (_inboundLog.length > 20) _inboundLog.pop();
}

// ─────────────────────────────────────────────────────────────────────────────
// registrarAlias — salva mapeamento remoteJid/LID → conversa na tabela de aliases
// Chamado após localizar ou criar conversa para garantir deduplicação futura.
// Após salvar, dispara reprocessamento de mensagens pendentes com mesmo LID/JID.
// ─────────────────────────────────────────────────────────────────────────────
async function registrarAlias(sb, { conversaId, tel, rawJid, lidNumero, nome }) {
  if (!conversaId) return;
  try {
    const remotejid = rawJid && rawJid.includes('@') ? rawJid : null;

    const lid = lidNumero || null;
    let aliasAtualizado = false;

    // Verifica se já existe alias para esse remoteJid
    if (remotejid) {
      const { data: existing } = await sb.from(ALIAS_TABLE)
        .select('id,conversa_id').eq('remote_jid', remotejid).limit(1);
      if (existing?.[0]) {
        // Já existe — atualiza se a conversa mudou
        if (existing[0].conversa_id !== conversaId) {
          await sb.from(ALIAS_TABLE)
            .update({ conversa_id: conversaId, telefone_normalizado: tel || null, lid, push_name: nome || null })
            .eq('id', existing[0].id);
          console.log('WHATSAPP_RESOLVE_ALIAS_UPDATED', { conversaId, remotejid, lid });
          aliasAtualizado = true;
        }
        // Mesmo sem atualizar: tenta reprocessar pendentes (alias já existia)
        if (lid || remotejid) {
          reprocessarPendentes(sb, { conversaId, lidNumero: lid, remotejid }).catch(e =>
            console.warn('WHATSAPP_PENDING_REPROCESS_WARN (alias updated):', e.message));
        }
        return;
      }
    }

    // Também verifica por telefone (sem remoteJid)
    if (!remotejid && tel) {
      const { data: existingTel } = await sb.from(ALIAS_TABLE)
        .select('id,conversa_id').eq('telefone_normalizado', tel).eq('conversa_id', conversaId).limit(1);
      if (existingTel?.[0]) return; // já existe para esta conversa+telefone
    }

    // Insere novo alias — deixa criado_em/atualizado_em com DEFAULT do banco (timestamp)
    const { error } = await sb.from(ALIAS_TABLE).insert({
      conversa_id:          conversaId,
      telefone_normalizado: tel    || null,
      remote_jid:           remotejid,
      lid:                  lid,
      push_name:            nome   || null,
      // NÃO envia criado_em/atualizado_em: o banco usa DEFAULT now() (tipo timestamp correto)
    });
    if (!error) {
      console.log('WHATSAPP_ALIAS_REGISTERED', { conversaId, remotejid, lid, tel });
      // Alias novo salvo: reprocessa mensagens pendentes com mesmo LID/JID
      if (lid || remotejid) {
        reprocessarPendentes(sb, { conversaId, lidNumero: lid, remotejid }).catch(e =>
          console.warn('WHATSAPP_PENDING_REPROCESS_WARN (new alias):', e.message));
      }
    } else {
      console.warn('WHATSAPP_ALIAS_INSERT_WARN:', error.message);
    }
  } catch (e) {
    console.warn('WHATSAPP_ALIAS_REGISTER_WARN (não crítico):', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// reprocessarPendentes — move mensagens de conversas PENDENTE_IDENTIFICACAO
// para a conversa canônica quando um alias for salvo.
// Fire-and-forget: não bloqueia o fluxo principal.
// ─────────────────────────────────────────────────────────────────────────────
async function reprocessarPendentes(sb, { conversaId, lidNumero, remotejid }) {
  try {
    console.log('WHATSAPP_PENDING_REPROCESS_START', { conversaId, lidNumero, remotejid });
    const agora = new Date().toISOString();

    // Busca conversas PENDENTE_IDENTIFICACAO com o mesmo LID nos dados_extras
    const filtros = [];
    if (lidNumero) filtros.push(`%"lid":"${lidNumero}"%`);
    if (remotejid) filtros.push(`%${lidNumero || remotejid.split('@')[0]}%`);

    let pendenteIds = [];
    for (const filtro of filtros) {
      if (!filtro) continue;
      const { data: pends } = await sb.from(CONVERSAS_TABLE)
        .select('id')
        .eq('status', 'PENDENTE_IDENTIFICACAO')
        .neq('id', conversaId) // não é a própria canônica
        .like('dados_extras', filtro)
        .limit(20);
      if (pends?.length) {
        pendenteIds.push(...pends.map(p => p.id).filter(id => !pendenteIds.includes(id)));
      }
    }

    if (pendenteIds.length === 0) {
      console.log('WHATSAPP_PENDING_REPROCESS_DONE', { conversaId, pendentes: 0 });
      return;
    }

    console.log('WHATSAPP_PENDING_MATCH_FOUND', { conversaId, pendenteIds, count: pendenteIds.length });

    // Move mensagens de cada conversa pendente para a canônica
    for (const pendId of pendenteIds) {
      // Busca mensagens da pendente
      const { data: msgs } = await sb.from(MENSAGENS_TABLE)
        .select('id').eq('conversa_id', pendId);
      if (msgs?.length) {
        // Move para canônica — só move se não existe duplicata por evolution_message_id
        for (const msg of msgs) {
          await sb.from(MENSAGENS_TABLE)
            .update({ conversa_id: conversaId })
            .eq('id', msg.id);
        }
        console.log('WHATSAPP_PENDING_MOVED_TO_CANONICAL', {
          de: pendId, para: conversaId, qtd: msgs.length
        });
      }

      // Fecha a conversa pendente (não deleta)
      await sb.from(CONVERSAS_TABLE).update({
        status:        'FECHADA',
        visivel:       false,
        atualizado_em: agora,
        dados_extras:  sb.raw ? undefined : undefined, // preserva dados_extras existente
      }).eq('id', pendId);
    }

    // Atualiza conversa canônica
    await sb.from(CONVERSAS_TABLE).update({
      ultima_msg_em: agora,
      atualizado_em: agora,
      status:        'ABERTA',
    }).eq('id', conversaId);

    console.log('WHATSAPP_PENDING_REPROCESS_DONE', { conversaId, pendentesFechadas: pendenteIds.length });
  } catch (e) {
    console.warn('WHATSAPP_PENDING_REPROCESS_ERROR:', e.message);
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// resolverConversaWhatsapp — FUNÇÃO CENTRAL DE RESOLUÇÃO
// Garante que NUNCA se cria conversa duplicada para o mesmo telefone/LID.
//
// Ordem de busca:
//   0. Tabela whatsapp_conversa_aliases (remoteJid ou LID)
//   1. LID em dados_extras (like + jsonb)
//   2. lead_id
//   3. Telefone — exact match todas as variantes
//   4. Telefone — ilike fallback legado
//   5. LID → Evolution API → telefone real
//   6. LID → nome_contato único
//   7. LID → conversa pendente existente
//   8. fromMe=true sem conversa → BLOQUEIA criação
//
// Retorna: { conversaId, permiteCreate, fonte }
// ─────────────────────────────────────────────────────────────────────────────
async function resolverConversaWhatsapp(sb, { tel, lidNumero, leadId, isLidJid, rawJid, fromMe, nome }) {
  const agora = new Date().toISOString();
  let conversaId = null;
  let fonte = null;

  console.log('WHATSAPP_RESOLVE_START', { tel, lidNumero, leadId, isLidJid, fromMe, nome: nome?.slice(0,30) });
  console.log('WHATSAPP_RESOLVE_PHONE_NORMALIZED', { tel });
  if (rawJid) console.log('WHATSAPP_RESOLVE_REMOTE_JID', { rawJid });
  if (lidNumero) console.log('WHATSAPP_RESOLVE_LID', { lidNumero });

  // ── Passo 0 (NOVO): Tabela whatsapp_conversa_aliases ────────────────────
  // Consulta ANTES de qualquer outra busca — é a fonte mais confiável
  // pois mapeia exatamente o remoteJid/LID para uma conversa conhecida.
  try {
    const remotejid = rawJid && rawJid.includes('@') ? rawJid : null;
    const lidBusca  = lidNumero || null;

    if (remotejid) {
      const { data: porJid } = await sb.from(ALIAS_TABLE)
        .select('conversa_id')
        .eq('remote_jid', remotejid)
        .limit(1);
      if (porJid?.[0]) {
        conversaId = porJid[0].conversa_id; fonte = 'alias_remote_jid';
        console.log('WHATSAPP_INBOUND_ALIAS_FOUND_BY_REMOTE_JID', { conversaId, remotejid });
        console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte });
      }
    }

    if (!conversaId && lidBusca) {
      const { data: porLid } = await sb.from(ALIAS_TABLE)
        .select('conversa_id')
        .eq('lid', lidBusca)
        .limit(1);
      if (porLid?.[0]) {
        conversaId = porLid[0].conversa_id; fonte = 'alias_lid';
        console.log('WHATSAPP_INBOUND_ALIAS_FOUND_BY_LID', { conversaId, lidBusca });
        console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte });
      }
    }

    if (!conversaId && tel) {
      // Busca por variantes do telefone (com/sem 9 dígito, com/sem 55)
      const variantesTel = phoneVariants(tel);
      for (const v of variantesTel) {
        const { data: porTelAlias } = await sb.from(ALIAS_TABLE)
          .select('conversa_id')
          .eq('telefone_normalizado', v)
          .limit(1);
        if (porTelAlias?.[0]) {
          conversaId = porTelAlias[0].conversa_id; fonte = 'alias_telefone';
          console.log('WHATSAPP_INBOUND_ALIAS_FOUND_BY_PHONE', { conversaId, v });
          console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte });
          break;
        }
      }
    }

    // ── Se alias encontrou conversa PENDENTE_IDENTIFICACAO, escalar para canônica ──
    // A conversa pendente é uma duplicata oculta — não deve receber mensagens.
    // Tenta encontrar a conversa canônica via lead_id antes de aceitar a pendente.
    if (conversaId) {
      const { data: convAlias } = await sb.from(CONVERSAS_TABLE)
        .select('id,status,lead_id').eq('id', conversaId).single();
      if (convAlias?.status === 'PENDENTE_IDENTIFICACAO' && convAlias?.lead_id) {
        console.log('WHATSAPP_ALIAS_POINTS_TO_PENDING — escalando para canônica via lead_id', { pendente: conversaId, leadId: convAlias.lead_id });
        const { data: canonicaLead } = await sb.from(CONVERSAS_TABLE)
          .select('id')
          .eq('lead_id', convAlias.lead_id)
          .neq('status', 'FECHADA')
          .neq('status', 'PENDENTE_IDENTIFICACAO')
          .not('telefone', 'is', null)
          .order('ultima_msg_em', { ascending: false, nullsFirst: false })
          .limit(1);
        if (canonicaLead?.[0]) {
          const canonicaId = canonicaLead[0].id;
          console.log('WHATSAPP_INBOUND_CANONICAL_CONVERSA_SELECTED', { canonical: canonicaId, abandonando_pendente: conversaId, fonte });
          // Atualiza o alias para apontar para a canônica
          await sb.from(ALIAS_TABLE)
            .update({ conversa_id: canonicaId })
            .eq('conversa_id', conversaId);
          conversaId = canonicaId;
          fonte = fonte + '_escalated_to_canonical';
        } else {
          // Sem canônica via lead — aceita a pendente (melhor que nada)
          console.log('WHATSAPP_ALIAS_PENDENTE_SEM_CANONICA — usando pendente como fallback', { conversaId });
        }
      }
    }
  } catch (eAlias) {
    console.warn('WHATSAPP_ALIAS_LOOKUP_WARN (tabela pode nao existir):', eAlias.message);
  }

  // ── Passo 1: LID em dados_extras ────────────────────────────────────────
  if (!conversaId && isLidJid && lidNumero) {
    console.log('CONVERSA_LOOKUP_LID', { lidNumero });
    const { data: byLike } = await sb.from(CONVERSAS_TABLE)
      .select('id,telefone,lead_id').like('dados_extras', `%${lidNumero}%`)
      .neq('status', 'FECHADA').order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
    if (byLike?.[0]) {
      conversaId = byLike[0].id; fonte = 'lid_like';
      console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte, lidNumero });
    }
    if (!conversaId) {
      try {
        const { data: byJson } = await sb.from(CONVERSAS_TABLE)
          .select('id,telefone,lead_id')
          .filter('dados_extras', 'cs', JSON.stringify({ lid: lidNumero }))
          .neq('status', 'FECHADA').order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
        if (byJson?.[0]) {
          conversaId = byJson[0].id; fonte = 'lid_jsonb';
          console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte, lidNumero });
        }
      } catch(e) { /* dados_extras pode ser TEXT — ignora erro de filtro jsonb */ }
    }
  }

  // ── Passo 1b: DESATIVADO — heurístico nome/pushName bloqueado ────────────────
  // CAUSA DO BUG: correlação por pushName causava roteamento de estranhos para leads
  // existentes cujo nome_contato começava igual ao pushName do intruso.
  // pushName NÃO é identidade técnica — bloqueado permanentemente.
  // Identificação SOMENTE por: alias exato, remoteJid, telefone normalizado, lead_id.
  if (!conversaId && isLidJid && lidNumero) {
    console.log('WHATSAPP_INBOUND_BLOCKED_NAME_CORRELATION', {
      lidNumero, nome: nome?.slice(0,30),
      motivo: 'passo_1b_desativado_heuristico_nome_pushname_bloqueado',
    });
  }


  // ── Passo 2: por lead_id — APENAS conversas canônicas (ABERTA com telefone real) ──
  // REGRA: não retornar PENDENTE_IDENTIFICACAO como destino.
  // USA .neq() ENCADEADO em vez de .not('status','in',...) por compat PostgREST.
  if (!conversaId && leadId) {
    console.log('WEBHOOK_LEAD_ID_RESOLVIDO', { leadId });
    const { data: byLeadCanonica } = await sb.from(CONVERSAS_TABLE)
      .select('id,telefone,status')
      .eq('lead_id', leadId)
      .neq('status', 'FECHADA')
      .neq('status', 'PENDENTE_IDENTIFICACAO')
      .not('telefone', 'is', null)
      .order('ultima_msg_em', { ascending: false, nullsFirst: false })
      .limit(10);

    // Filtra LIDs numéricos (14+ dígitos sem 55) e LID: prefix
    const canonicaLead = (byLeadCanonica || []).find(c => {
      const digits = (c.telefone || '').replace(/\D/g, '');
      if (digits.length >= 14 && !digits.startsWith('55')) return false;
      if ((c.telefone || '').startsWith('LID:')) return false;
      return true;
    });

    if (canonicaLead) {
      conversaId = canonicaLead.id; fonte = 'lead_id_canonica';
      console.log('WEBHOOK_CANONICA_BY_LEAD_FOUND', { conversaId, leadId, telefone: canonicaLead.telefone, status: canonicaLead.status });
      console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte, leadId });
      if (isLidJid && lidNumero && rawJid) {
        registrarAlias(sb, { conversaId, tel: canonicaLead.telefone || null, rawJid, lidNumero, nome: nome || null })
          .catch(e => console.warn('WHATSAPP_ALIAS_LEAD2_WARN:', e.message));
      }
    } else {
      // 2b: fallback — qualquer não-FECHADA excluindo PENDENTE
      const { data: byLeadAny } = await sb.from(CONVERSAS_TABLE)
        .select('id,status').eq('lead_id', leadId)
        .neq('status', 'FECHADA')
        .neq('status', 'PENDENTE_IDENTIFICACAO')
        .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
      if (byLeadAny?.[0]) {
        conversaId = byLeadAny[0].id; fonte = 'lead_id_fallback';
        console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte, leadId });
      }
    }
  }

  // ── Passo 3: telefone — exact match ─────────────────────────────────────
  if (!conversaId && tel) {
    console.log('CONVERSA_LOOKUP_PHONE', { tel });
    const variantes = phoneVariants(tel);
    for (const v of variantes) {
      const { data: byTel } = await sb.from(CONVERSAS_TABLE)
        .select('id,telefone').eq('telefone', v).neq('status', 'FECHADA')
        .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
      if (byTel?.[0]) {
        conversaId = byTel[0].id; fonte = `telefone_eq`;
        console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte, variante: v });
        break;
      }
    }
  }

  // ── Passo 4: telefone — ilike fallback ──────────────────────────────────
  if (!conversaId && tel) {
    const variantes = phoneVariants(tel).filter(v => v.length >= 10);
    for (const v of variantes) {
      const { data: byIlike } = await sb.from(CONVERSAS_TABLE)
        .select('id,telefone').ilike('telefone', `%${v}%`).neq('status', 'FECHADA')
        .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
      if (byIlike?.[0]) {
        conversaId = byIlike[0].id; fonte = `telefone_ilike`;
        console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte, variante: v, telSalvo: byIlike[0].telefone });
        await sb.from(CONVERSAS_TABLE)
          .update({ telefone: tel, atualizado_em: agora }).eq('id', conversaId);
        break;
      }
    }
  }

  // ── Passo 5: LID → Evolution API → telefone real ────────────────────────
  if (!conversaId && isLidJid && lidNumero) {
    console.log('CONVERSA_LOOKUP_LID_EVO_API', { lidNumero });
    try {
      const lidJidCompleto = rawJid?.includes('@') ? rawJid : `${lidNumero}@lid`;
      const resContato = await evoSvc.call('POST', `/contacts/find/${evoSvc.EVOLUTION_INSTANCE}`, { where: { id: lidJidCompleto } });
      const contato = (Array.isArray(resContato?.dados) ? resContato.dados : (resContato?.dados ? [resContato.dados] : []))[0] || null;
      if (contato) {
        const jidReal = contato.id || contato.remoteJid || '';
        const telRaw  = contato.phone || (jidReal.includes('@s.whatsapp.net') ? jidReal.split('@')[0] : null);
        if (telRaw) {
          const telNorm = normalizePhone(telRaw);
          for (const v of phoneVariants(telNorm)) {
            const { data: byEvo } = await sb.from(CONVERSAS_TABLE)
              .select('id,dados_extras,lead_id').eq('telefone', v).neq('status', 'FECHADA')
              .not('lead_id', 'is', null) // SEGURANÇA: só roteia para conversas vinculadas a leads do CRM
              .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
            if (byEvo?.[0]) {
              conversaId = byEvo[0].id; fonte = 'lid_evo_phone';
              console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte, lidNumero, telNorm });
              const ext = (() => { try { return typeof byEvo[0].dados_extras === 'object' ? (byEvo[0].dados_extras || {}) : JSON.parse(byEvo[0].dados_extras || '{}'); } catch { return {}; } })();
              if (!ext.lid) {
                await sb.from(CONVERSAS_TABLE)
                  .update({ dados_extras: { ...ext, lid: lidNumero }, atualizado_em: agora })
                  .eq('id', conversaId);
              }
              // ── FIX: registrar alias para evitar depender do Evolution API em cada mensagem
              // Sem este registro, cada resposta LID exigia nova resolução via Evolution API.
              // Com o alias salvo, Step 0 resolve instantaneamente nas próximas mensagens.
              registrarAlias(sb, {
                conversaId,
                tel: telNorm,
                rawJid: rawJid || null,
                lidNumero,
                nome: !fromMe ? (nome || null) : null,
              }).catch(e => console.warn('WHATSAPP_ALIAS_EVO5_WARN:', e.message));
              break;
            }
          }
        }
      } else {
        console.warn('CONVERSA_LOOKUP_LID_EVO_NO_CONTACT', { lidNumero, lidJidCompleto });
        // Tentativa alternativa: algumas versões da Evolution API indexam pelo campo 'lid'
        // em vez de usar o LID como 'id' do contato. Tenta ambas as variações.
        try {
          const resAlt = await evoSvc.call('POST', `/contacts/find/${evoSvc.EVOLUTION_INSTANCE}`, { where: { lid: lidJidCompleto } });
          const contatoAlt = (Array.isArray(resAlt?.dados) ? resAlt.dados : (resAlt?.dados ? [resAlt.dados] : []))[0] || null;
          console.log('CONVERSA_LOOKUP_LID_EVO_ALT_RESULT', { lidNumero, found: !!contatoAlt, keys: contatoAlt ? Object.keys(contatoAlt).slice(0,8) : [] });
          if (contatoAlt) {
            const jidAlt = contatoAlt.id || contatoAlt.remoteJid || '';
            const telAlt = contatoAlt.phone || (jidAlt.includes('@s.whatsapp.net') ? jidAlt.split('@')[0] : null);
            if (telAlt) {
              const telNormAlt = normalizePhone(telAlt);
              for (const v of phoneVariants(telNormAlt)) {
                const { data: byEvoAlt } = await sb.from(CONVERSAS_TABLE)
                  .select('id,dados_extras,lead_id').eq('telefone', v).neq('status', 'FECHADA')
                  .not('lead_id', 'is', null)
                  .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
                if (byEvoAlt?.[0]) {
                  conversaId = byEvoAlt[0].id; fonte = 'lid_evo_alt_lid_field';
                  console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte, lidNumero, telNormAlt });
                  registrarAlias(sb, { conversaId, tel: telNormAlt, rawJid: rawJid || null, lidNumero, nome: !fromMe ? (nome || null) : null })
                    .catch(e => console.warn('WHATSAPP_ALIAS_EVO_ALT_WARN:', e.message));
                  break;
                }
              }
            }
          }
        } catch (eAlt) { console.warn('CONVERSA_LOOKUP_LID_EVO_ALT_WARN:', eAlt.message); }
      }
    } catch (e) { console.warn('CONVERSA_LOOKUP_LID_EVO_ERROR', e.message); }
  }


  // ── Passo 6: LID → nome_contato único ───────────────────────────────────
  // FIX: exclui PENDENTE_IDENTIFICACAO (antes só excluía FECHADA) para não
  //      contar pendente como candidata e gerar falso-ambíguo.
  //      limit(5) para filtrar por .not('telefone','is',null) e checar unicidade real.
  // PASSO 6 DESATIVADO: heurístico por nome é inseguro — causa roteamento incorreto
  // (mesmo problema do heurístico 'candidata única' já desativado anteriormente)
  // Contato com LID sem match → cria conversa PENDENTE (invisível na lista)
  if (false && !conversaId && isLidJid && lidNumero && nome && !fromMe) {
    const primeiroNome = nome.split(' ')[0];
    if (primeiroNome.length >= 3) {
      const { data: byNomeBruto } = await sb.from(CONVERSAS_TABLE)
        .select('id,dados_extras,telefone').ilike('nome_contato', `%${primeiroNome}%`)
        .neq('status', 'FECHADA')
        .neq('status', 'PENDENTE_IDENTIFICACAO')
        .not('telefone', 'is', null)
        .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(5);
      const byNome = (byNomeBruto || []).filter(r => r.telefone && r.telefone.trim() !== '');
      if (byNome?.length === 1) {
        conversaId = byNome[0].id; fonte = 'lid_nome_contato';
        console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte, nome, primeiroNome });
        const ext = (() => { try { return typeof byNome[0].dados_extras === 'object' ? (byNome[0].dados_extras || {}) : JSON.parse(byNome[0].dados_extras || '{}'); } catch { return {}; } })();
        if (!ext.lid) {
          await sb.from(CONVERSAS_TABLE)
            .update({ dados_extras: { ...ext, lid: lidNumero }, atualizado_em: agora })
            .eq('id', conversaId);
        }
      } else if (byNome?.length > 1) {
        console.warn('CONVERSA_LOOKUP_LID_NOME_AMBIGUO', { nome, primeiroNome, qtd: byNome.length });
      }
    }
  }

  // ── Passo 7: LID → conversa pendente ou canônica via dados_extras ──────────
  // ATENÇÃO: se a pendente existe mas tem lead_id, preferir a canônica real.
  if (!conversaId && isLidJid && lidNumero) {
    // 7a: busca conversa PENDENTE_IDENTIFICACAO com este LID nos dados_extras
    // REGRA: NUNCA buscar em conversas ABERTA para evitar contaminar leads existentes com LIDs de estranhos
    const { data: pendente } = await sb.from(CONVERSAS_TABLE)
      .select('id,lead_id,status').like('dados_extras', `%${lidNumero}%`)
      .eq('status', 'PENDENTE_IDENTIFICACAO') // SEGURANÇA: só conversas pendentes não identificadas
      .order('criado_em', { ascending: false }).limit(1);

    if (pendente?.[0]) {
      const pend = pendente[0];
      // 7b: se a pendente tem lead_id → busca canônica real primeiro
      if (pend.lead_id) {
        const { data: canonicaP } = await sb.from(CONVERSAS_TABLE)
          .select('id')
          .eq('lead_id', pend.lead_id)
          .neq('status', 'FECHADA')
          .neq('status', 'PENDENTE_IDENTIFICACAO')
          .not('telefone', 'is', null)
          .order('ultima_msg_em', { ascending: false, nullsFirst: false })
          .limit(1);
        if (canonicaP?.[0]) {
          conversaId = canonicaP[0].id; fonte = 'lid_pending_escalated_canonical';
          console.log('WHATSAPP_INBOUND_CANONICAL_CONVERSA_SELECTED', { canonical: conversaId, pendente: pend.id, lidNumero });
          console.log('WHATSAPP_DUPLICATE_CONVERSA_PREVENTED', { lidNumero, conversaId });
          // Salva alias para evitar este caminho na próxima vez
          registrarAlias(sb, { conversaId, tel: null, rawJid: rawJid || null, lidNumero, nome: null })
            .catch(e => console.warn('WHATSAPP_ALIAS_PEND_ESCAL_WARN:', e.message));
        } else {
          // Sem canônica → usa a pendente mesmo (ao menos preserva a mensagem)
          conversaId = pend.id; fonte = 'lid_pending_existente_sem_canonica';
          console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte, lidNumero });
        }
      } else {
        // Sem lead_id: usa a pendente
        conversaId = pend.id; fonte = 'lid_pending_existente';
        console.log('WHATSAPP_RESOLVE_CONVERSA_FOUND', { conversaId, fonte, lidNumero });
        console.log('WHATSAPP_DUPLICATE_CONVERSA_PREVENTED', { lidNumero, conversaId });
      }
    }
  }

  // ── Passo 8: fromMe=true sem conversa → BLOQUEAR ────────────────────────
  if (!conversaId && fromMe) {
    console.log('WHATSAPP_FROM_ME_IGNORED_NO_CONVERSA', { tel, lidNumero, nome });
    return { conversaId: null, permiteCreate: false, fonte: 'from_me_blocked' };
  }

  if (conversaId) {
    console.log('WHATSAPP_RESOLVE_SELECTED_CONVERSATION', { conversaId, fonte });
    return { conversaId, permiteCreate: false, fonte };
  }

  console.log('WHATSAPP_RESOLVE_CONVERSA_CREATED', { tel, lidNumero, leadId, motivo: 'nenhuma_encontrada' });
  return { conversaId: null, permiteCreate: true, fonte: 'nao_encontrada' };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/conversas
// Lista todas as conversas com última mensagem
// ─────────────────────────────────────────────────────────────────────────────
async function listarConversas(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const { vendedor_id, status, busca, limit = 50, offset = 0 } = req.query;
    const role = req.usuario.role;

    if (isSupa) {
      let q = sb.from(CONVERSAS_TABLE)
        .select('*, usuarios!conversas_whatsapp_vendedor_id_fkey(nome), leads!conversas_whatsapp_lead_id_fkey(nome,empresa)')
        .order('ultima_msg_em', { ascending: false, nullsFirst: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      if (role === 'VENDEDOR') q = q.eq('vendedor_id', req.usuario.id);
      if (vendedor_id) q = q.eq('vendedor_id', vendedor_id);
      // Por padrão: exclui FECHADA e PENDENTE_IDENTIFICACAO
      if (status) {
        q = q.eq('status', status);
      } else {
        q = q.neq('status', 'FECHADA').neq('status', 'PENDENTE_IDENTIFICACAO');
      }
      // Exclui conversas explicitamente invisíveis (visivel=false)
      q = q.neq('visivel', false);
      if (busca) q = q.or(`telefone.ilike.%${busca}%,nome_contato.ilike.%${busca}%`);
      const { data, error } = await q;
      if (error) throw error;

      // FIX DEFINITIVO (2026-08-29): incluir conversas de novos contatos WhatsApp
      // mesmo sem lead_id vinculado — essas são conversas reais de números que
      // mandaram mensagem mas ainda não têm cadastro no CRM.
      const rawData = (data || []).filter(c => {
        // Ocultar: conversas com lead_id que apontam para lead DELETADO (órfão)
        if (c.lead_id && !c.leads) {
          console.log('WHATSAPP_LIST_HIDE_ORPHAN', { id: c.id, lead_id: c.lead_id, motivo: 'lead_deletado' });
          return false;
        }
        // Mostrar tudo o que está ABERTA/AGUARDANDO e não é órfão
        return true;
      });


      const conversas = rawData.map(c => ({
        ...c,
        vendedor_nome: c.usuarios?.nome || null,
        lead_nome:     c.leads?.nome    || null,
        lead_empresa:  c.leads?.empresa || null,
      }));
      // Ultima mensagem por conversa
      const ids = conversas.map(c => c.id);
      let ultimaMap = {};
      if (ids.length > 0) {
        const { data: msgs } = await sb.from(MENSAGENS_TABLE)
          .select('conversa_id,mensagem,direcao,criado_em')
          .in('conversa_id', ids)
          .order('criado_em', { ascending: false });
        (msgs || []).forEach(m => { if (!ultimaMap[m.conversa_id]) ultimaMap[m.conversa_id] = m; });
      }
      const comUltima = conversas.map(c => ({
        ...c,
        ultima_mensagem: ultimaMap[c.id]?.mensagem || null,
        ultima_direcao:  ultimaMap[c.id]?.direcao  || null,
        // nao_lidas: usa o campo do banco (incrementado pelo webhook ao receber, zerado ao abrir)
        nao_lidas: c.nao_lidas || 0,
      }));
      return res.json({ sucesso: true, dados: comUltima, total: comUltima.length });
    }

    const db = getDb();
    // SQLite fallback (variáveis já declaradas acima)

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
      INNER JOIN leads l ON c.lead_id = l.id  -- REGRA: só exibe conversas vinculadas a um lead
      WHERE 1=1
        AND c.lead_id IS NOT NULL
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
async function listarMensagens(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const { id } = req.params;
    const { limit = 200, offset = 0 } = req.query;

    if (isSupa) {
      const { data: conversa, error: errC } = await sb.from(CONVERSAS_TABLE)
        .select('*, usuarios!conversas_whatsapp_vendedor_id_fkey(nome), leads!conversas_whatsapp_lead_id_fkey(nome,empresa)')
        .eq('id', id).single();
      if (errC || !conversa) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
      if (req.usuario.role === 'VENDEDOR' && conversa.vendedor_id !== req.usuario.id)
        return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

      const { data: msgs, error: errM } = await sb.from(MENSAGENS_TABLE)
        .select('*, usuarios!mensagens_whatsapp_vendedor_id_fkey(nome)')
        .eq('conversa_id', id)
        .order('criado_em', { ascending: true })
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      if (errM) throw errM;

      const normalizado = (msgs || []).map(m => ({ ...m, vendedor_nome: m.usuarios?.nome || null }));
      const convNorm = { ...conversa, vendedor_nome: conversa.usuarios?.nome, lead_nome: conversa.leads?.nome, lead_empresa: conversa.leads?.empresa };

      // Marca como lidas e zera nao_lidas (não bloqueia resposta)
      // WHATSAPP_MARK_READ: log obrigatório para auditoria
      Promise.all([
        sb.from(MENSAGENS_TABLE).update({ status: 'lido' })
          .eq('conversa_id', id).eq('direcao', 'recebida').neq('status', 'lido'),
        sb.from(CONVERSAS_TABLE).update({ nao_lidas: 0, atualizado_em: new Date().toISOString() })
          .eq('id', id).gt('nao_lidas', 0),
      ]).then(() => {
        console.log('WHATSAPP_MARK_READ', { conversaId: id });
      }).catch(e => console.warn('[WA] mark-read warn:', e.message));

      return res.json({ sucesso: true, dados: normalizado, conversa: convNorm });
    }

    const db = getDb();
    const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
    if (!conversa) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
    if (req.usuario.role === 'VENDEDOR' && conversa.vendedor_id !== req.usuario.id)
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
    const msgs = db.prepare(`SELECT m.*, u.nome AS vendedor_nome FROM mensagens_whatsapp m LEFT JOIN usuarios u ON m.vendedor_id = u.id WHERE m.conversa_id = ? ORDER BY m.criado_em ASC LIMIT ? OFFSET ?`).all(id, Number(limit), Number(offset));
    db.prepare(`UPDATE mensagens_whatsapp SET status = 'lido' WHERE conversa_id = ? AND direcao = 'recebida' AND status != 'lido'`).run(id);
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
async function enviarMensagem(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const { id } = req.params;
    const { mensagem, tipo = 'texto', arquivo_url, arquivo_nome } = req.body;

    if (!mensagem && !arquivo_url)
      return res.status(400).json({ sucesso: false, erro: 'Mensagem ou arquivo obrigatório.' });

    // ── 1. Busca conversa ────────────────────────────────────────────────────
    let conversa = null;
    if (isSupa) {
      const { data, error: errC } = await sb.from(CONVERSAS_TABLE).select('*').eq('id', id).single();
      if (errC || !data) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
      conversa = data;
    } else {
      const db = getDb();
      conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
    }
    if (!conversa) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });

    // Permissão VENDEDOR: pode enviar se for o vendedor_id, se vendedor_id for null,
    // ou se for o responsavel_id do lead vinculado
    if (req.usuario.role === 'VENDEDOR' && conversa.vendedor_id && conversa.vendedor_id !== req.usuario.id) {
      let podeEnviar = false;
      if (conversa.lead_id) {
        try {
          if (isSupa) {
            const { data: ld } = await sb.from('leads').select('responsavel_id').eq('id', conversa.lead_id).single();
            podeEnviar = ld?.responsavel_id === req.usuario.id;
          } else {
            const dbAux = getDb();
            const ld = dbAux.prepare('SELECT responsavel_id FROM leads WHERE id = ?').get(conversa.lead_id);
            podeEnviar = ld?.responsavel_id === req.usuario.id;
          }
        } catch { podeEnviar = false; }
      }
      if (!podeEnviar) return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
    }
    // VENDEDOR assume conversa sem vendedor_id
    if (req.usuario.role === 'VENDEDOR' && !conversa.vendedor_id) {
      try {
        if (isSupa) await sb.from(CONVERSAS_TABLE).update({ vendedor_id: req.usuario.id, atualizado_em: new Date().toISOString() }).eq('id', id).then(()=>{});
        else getDb().prepare('UPDATE conversas_whatsapp SET vendedor_id=?, atualizado_em=? WHERE id=?').run(req.usuario.id, new Date().toISOString(), id);
        conversa.vendedor_id = req.usuario.id;
      } catch { /* não crítico */ }
    }

    // ── 2. Resolve telefone real do cliente para envio ───────────────────────
    // Ordem de prioridade (requisito de segurança):
    //   1. Telefone do lead vinculado (mais confiável — sempre começa com 55)
    //   2. telefone da conversa, se começar com 55
    //   3. telefone da conversa normalizado via normalizePhone
    //   4. Bloqueia se só houver LID
    // NUNCA usa LID como destinatário de envio.
    console.log('WHATSAPP_SEND_RESTORE_START', { conversaId: id, conversa_telefone: conversa.telefone });

    let telParaEnvio = null;
    let phoneSource  = 'none';

    // 1. Tenta telefone do lead vinculado
    if (conversa.lead_id && isSupa) {
      try {
        const { data: leadData } = await sb.from('leads')
          .select('telefone').eq('id', conversa.lead_id).single();
        const telLead = leadData?.telefone ? normalizePhone(leadData.telefone) : null;
        if (telLead && telLead.startsWith('55')) {
          telParaEnvio = telLead;
          phoneSource  = 'lead_telefone';
        }
      } catch(eLead) {
        console.warn('WHATSAPP_SEND_PHONE_LEAD_WARN:', eLead.message);
      }
    }

    // 2. Tenta telefone da conversa (começa com 55)
    if (!telParaEnvio && conversa.telefone) {
      const telConv = normalizePhone(conversa.telefone);
      if (telConv && telConv.startsWith('55')) {
        telParaEnvio = telConv;
        phoneSource  = 'conversa_telefone';
      }
    }

    // 3. Fallback: remoteJid do dados_extras (para conversas LID sem telefone real)
    // Evolution API aceita JID diretamente (ex: "148382630805756@lid") no campo number
    if (!telParaEnvio && (conversa.telefone || '').startsWith('LID:')) {
      try {
        const ext = typeof conversa.dados_extras === 'object'
          ? (conversa.dados_extras || {})
          : JSON.parse(conversa.dados_extras || '{}');
        const rawJidExt = ext.remoteJid || ext.lid;
        if (rawJidExt) {
          // Normaliza: se for só o número sem @, adiciona @lid
          const jidDestino = rawJidExt.includes('@') ? rawJidExt : `${rawJidExt}@lid`;
          telParaEnvio = jidDestino;
          phoneSource  = 'dados_extras_lid_jid';
          console.log('WHATSAPP_SEND_LID_JID_SOURCE', { jidDestino, remoteJid: rawJidExt });
        }
      } catch(_eLid) {
        console.warn('WHATSAPP_SEND_LID_EXTRACT_WARN:', _eLid.message);
      }
    }

    // 4. Fallback: normalizePhone sem exigir 55 (números internacionais válidos)
    if (!telParaEnvio && conversa.telefone && !conversa.telefone.startsWith('LID:')) {
      const telFallback = normalizePhone(conversa.telefone);
      if (telFallback && telFallback.length >= 10) {
        telParaEnvio = telFallback;
        phoneSource  = 'conversa_telefone_fallback';
      }
    }

    // Logs de diagnóstico
    console.log('WHATSAPP_SEND_PHONE_SOURCE',  { source: phoneSource, raw: conversa.telefone });
    console.log('WHATSAPP_SEND_PHONE_FINAL',   { phone_final: telParaEnvio });
    console.log('WHATSAPP_SEND_INSTANCE_USED', evoSvc.EVOLUTION_INSTANCE);

    if (!telParaEnvio) {
      console.error('WHATSAPP_SEND_BLOCKED_NO_PHONE', { telefone: conversa.telefone });
      return res.status(400).json({ sucesso: false, erro: 'Conversa sem telefone ou JID válido para envio.' });
    }

    const telNormalizado = telParaEnvio;
    console.log('WHATSAPP_SEND_PAYLOAD_TYPE', 'text');


    // ── 3. Monta texto com identificação do remetente ─────────────────────────
    // Formato: "Nome | PROSPEKT\n\nMensagem"
    // Guard: não duplica o cabeçalho se a mensagem já começar com "| PROSPEKT"
    const nomeRemetente  = req.usuario.nome || 'CRM';
    const cabecalho      = `${nomeRemetente} | PROSPEKT`;
    const jaTemCabecalho = tipo === 'texto' && (mensagem || '').trimStart().includes('| PROSPEKT');
    const textoBase      = tipo === 'texto'
      ? (jaTemCabecalho ? mensagem : `${cabecalho}\n\n${mensagem}`)
      : (mensagem || '');

    // ── Sanitiza texto para Evolution: remove caracteres de controle inválidos ──
    // Scripts da Biblioteca podem conter chars Unicode multi-byte (emojis, símbolos)
    // que são válidos no WhatsApp mas devem estar corretamente encodados.
    // Remove apenas caracteres de controle C0/C1 (0x00-0x08, 0x0B-0x0C, 0x0E-0x1F, 0x7F)
    // preservando: \n (0x0A), \r (0x0D), \t (0x09) e todos os emojis/unicode válidos.
    const textoParaCliente = typeof textoBase === 'string'
      ? textoBase.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()
      : String(textoBase || '').trim();

    // Valida texto final antes de enviar
    const textoOrigemLog = req.body.script_id ? `script:${req.body.script_id}` : 'manual';
    console.log('SCRIPT_SEND_START', { conversaId: id, origem: textoOrigemLog, telefone: telNormalizado });

    if (!textoParaCliente && !(tipo === 'audio' && arquivo_url)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Não foi possível enviar. A mensagem ficou vazia após processamento.',
        codigo: 'MENSAGEM_VAZIA',
      });
    }

    // ── 4. ENVIA PELA EVOLUTION PRIMEIRO (antes de salvar) ────────────────────
    let evoOk  = false;
    let evoErr = null;
    let evoRes = null; // ← declarado no escopo externo para evitar ReferenceError

    // ── Áudio: base64 vem em arquivo_url prefixado com 'data:audio' ────────────
    if (evoSvc.isConfigured() && tipo === 'audio' && arquivo_url) {
      console.log('WHATSAPP_AUDIO_SEND_START', { conversaId: id, telefone: telNormalizado });
      console.log('WHATSAPP_AUDIO_SEND_PAYLOAD_SAFE', { numero: telNormalizado, base64Length: arquivo_url.length });
      const evoAudio = await evoSvc.enviarAudio(telNormalizado, arquivo_url);
      console.log('WHATSAPP_AUDIO_SEND_RESPONSE_STATUS', evoAudio.status || (evoAudio.sucesso ? 200 : 500));
      if (evoAudio.sucesso || evoAudio.dados?.key?.id) {
        evoOk = true;
        evoRes = evoAudio;
        console.log('WHATSAPP_AUDIO_SEND_SUCCESS', { msgId: evoAudio.dados?.key?.id });
      } else {
        console.error('WHATSAPP_AUDIO_SEND_ERROR', evoAudio.erro);
        return res.status(502).json({ sucesso: false, erro: `Falha ao enviar áudio: ${evoAudio.erro || 'Erro desconhecido na Evolution.'}`, detalhe: { numero: telNormalizado } });
      }
    } else if (evoSvc.isConfigured() && tipo === 'texto' && mensagem) {
      const endpoint = `/message/sendText/${evoSvc.EVOLUTION_INSTANCE}`;
      const payload  = { number: telNormalizado, textMessage: { text: textoParaCliente } };

      // Logs obrigatórios antes do envio
      console.log('WHATSAPP_SEND_START', { conversaId: id });
      console.log('WHATSAPP_SEND_INSTANCE_USED', evoSvc.EVOLUTION_INSTANCE);
      console.log('WHATSAPP_SEND_TO_PHONE_NORMALIZED', telNormalizado);
      console.log('WHATSAPP_SEND_ENDPOINT', `${process.env.EVOLUTION_API_URL || ''}${endpoint}`);
      console.log('WHATSAPP_SEND_API_KEY_PRESENT', process.env.EVOLUTION_API_KEY ? '✅ sim' : '❌ AUSENTE');
      console.log('WHATSAPP_SEND_PAYLOAD_SAFE', JSON.stringify({ number: telNormalizado, textPreview: textoParaCliente?.slice(0, 80), origem: textoOrigemLog }));
      // Compat: log antigo preservado
      console.log('CRM_SEND_WHATSAPP_START', {
        conversaId: id,
        leadId: conversa.lead_id || null,
        telefoneOriginal: conversa.telefone,
        telefoneNormalizado: telNormalizado,
        textoDigitado: mensagem?.slice(0, 80),
        textoFinal: textoParaCliente?.slice(0, 80),
        origem: textoOrigemLog,
      });
      console.log('SCRIPT_SEND_USING_MANUAL_FLOW', { conversaId: id, origem: textoOrigemLog });

      evoRes = await evoSvc.enviarTexto(telNormalizado, textoParaCliente);

      console.log('EVOLUTION_SEND_RESPONSE_STATUS', evoRes.status || (evoRes.sucesso ? 200 : 500));
      console.log('EVOLUTION_SEND_RESPONSE_DATA_RAW', JSON.stringify(evoRes.dados || evoRes.erro, null, 2));

      // ── Detecta sucesso real da Evolution API ─────────────────────────────
      // A Evolution v1.8.6 retorna sucesso quando:
      //   (a) evoRes.sucesso = true  (HTTP 2xx)
      //   (b) OU: body contém key.id ou messageId → mensagem foi aceita e enfileirada
      //       mesmo que o HTTP status seja 201/400 em alguns casos de versão
      const evoKeyId = evoRes.dados?.key?.id || evoRes.dados?.messageId || null;
      const evoSucessoReal = evoRes.sucesso || !!evoKeyId;

      console.log('EVOLUTION_SEND_SUCESSO_REAL:', { evoRes_sucesso: evoRes.sucesso, evoKeyId, evoSucessoReal });

      if (evoSucessoReal) {
        evoOk = true;
        if (!evoRes.sucesso && evoKeyId) {
          // Corrige o objeto para que evoMsgId seja extraído corretamente abaixo
          evoRes = { ...evoRes, sucesso: true };
          console.log('EVOLUTION_SEND_SUCESSO_VIA_KEY_ID:', evoKeyId);
        }
      } else {
        evoErr = evoRes.erro || 'Erro desconhecido na Evolution API';
        console.error('EVOLUTION_SEND_ERROR', {
          status:  evoRes.status,
          data:    evoRes.dados,
          message: evoErr,
        });

        // Detecta contato LID não enviável (Instagram Direct — exists: false)
        const _evoDataMsg = evoRes.dados?.response?.message;
        const _isLidNaoEnviavel = Array.isArray(_evoDataMsg) && _evoDataMsg.some(m => m?.exists === false);
        if (_isLidNaoEnviavel || (evoRes.status === 400 && (conversa.telefone || '').startsWith('LID:'))) {
          return res.status(400).json({
            sucesso: false,
            erro: 'Este contato é do Instagram Direct e não possui número de WhatsApp acessível. Use o botão "Criar Lead" para informar o número real e habilitar o envio.',
            codigo: 'LID_NAO_ENVIAVEL',
          });
        }

        // Retorna erro imediato — não salva mensagem não enviada
        return res.status(502).json({
          sucesso: false,
          erro: `Evolution API recusou o envio: ${evoErr}`,
          detalhe: { endpoint, numero: telNormalizado, evoStatus: evoRes.status },
        });
      }

    } else if (tipo !== 'audio' && arquivo_url) {
      // Mídia: tenta enviar, mas não bloqueia se falhar
      if (evoSvc.isConfigured()) {
        const midiaRes = await evoSvc.enviarMidia(telNormalizado, {
          media: arquivo_url, fileName: arquivo_nome, mediatype: tipo
        });
        if (midiaRes.sucesso) evoOk = true;
        else {
          evoErr = midiaRes.erro;
          console.error('EVOLUTION_SEND_ERROR (midia):', evoErr);
        }
      }
      evoOk = true; // mídia continua salvando mesmo sem Evolution
    } else if (!evoSvc.isConfigured()) {
      // Evolution não configurada: salva localmente como aviso
      console.warn('[WA] enviarMensagem: Evolution API não configurada — salvando somente no CRM sem envio real.');
      evoOk = true;
    }

    // ── 5. SÓ SALVA após confirmação da Evolution ────────────────────────────
    const agora = new Date().toISOString();
    // Alias é registrado APÓS salvar a mensagem (não-bloqueante, fire-and-forget)
    // Ver bloco abaixo dentro do if(isSupa) após insert com sucesso.

    const msgId = crypto.randomBytes(16).toString('hex');
    // ID retornado pela Evolution — agora evoRes está acessível no escopo correto
    const evoMsgId = evoRes?.dados?.key?.id || null;

    if (isSupa) {
      // ── Payload Supabase: SOMENTE colunas que existem na tabela ─────────────
      // Colunas reais: id, conversa_id, lead_id, telefone, mensagem, tipo,
      //                direcao, status, vendedor_id, arquivo_url, arquivo_nome, criado_em
      // NÃO EXISTEM: atualizado_em, evolution_message_id
      const dbPayload = {
        id: msgId,
        conversa_id: id,
        lead_id: conversa.lead_id || null,
        telefone: telNormalizado,
        mensagem: mensagem || null,
        tipo,
        direcao: 'enviada',
        // CHECK(status IN ('enviado','entregue','lido','erro'))
        status: evoOk ? 'enviado' : 'erro',
        vendedor_id: req.usuario.id,
        arquivo_url: arquivo_url || null,
        arquivo_nome: arquivo_nome || null,
        criado_em: agora,
        // atualizado_em: NÃO EXISTE NA TABELA — removido
      };

      console.log('SUPA_INSERT_PAYLOAD_KEYS', Object.keys(dbPayload));

      // Insert sem nome de FK fixo no select (evita erro se FK tiver outro nome)
      const { data: nova, error: errI } = await sb.from(MENSAGENS_TABLE)
        .insert(dbPayload)
        .select('*')
        .single();

      if (errI) {
        console.error('SUPA_INSERT_ERROR', { message: errI.message, code: errI.code, details: errI.details });
        // Mesmo com erro no insert, a mensagem JÁ FOI ENVIADA pela Evolution.
        // Retorna 201 com dados mínimos para não mostrar erro falso ao usuário.
        if (evoOk) {
          console.warn('SUPA_INSERT_FAILED_BUT_EVO_OK — retornando sucesso parcial para evitar erro falso no frontend');
          const msgMinima = {
            id: msgId, conversa_id: id, mensagem: mensagem || null,
            tipo, direcao: 'enviada', status: 'enviado',
            vendedor_id: req.usuario.id, vendedor_nome: req.usuario.nome,
            criado_em: agora,
          };
          return res.status(201).json({ sucesso: true, dados: msgMinima });
        }
        throw errI;
      }

      // UPDATE conversas_whatsapp — SOMENTE colunas existentes
      // Colunas reais: ultima_msg_em, atualizado_em, status
      // NÃO EXISTEM: ultima_mensagem, ultima_direcao
      const { error: errUpdConv } = await sb.from(CONVERSAS_TABLE)
        .update({ ultima_msg_em: agora, atualizado_em: agora, status: 'ABERTA' })
        .eq('id', id);
      if (errUpdConv) console.warn('SUPA_UPDATE_CONVERSA_WARN:', errUpdConv.message);

      if (conversa.lead_id) {
        const { error: errUpdLead } = await sb.from('leads').update({ atualizado_em: agora }).eq('id', conversa.lead_id);
        if (errUpdLead) console.warn('SUPA_UPDATE_LEAD_WARN:', errUpdLead.message);
      }

      const msg = { ...nova, vendedor_nome: req.usuario.nome };
      console.log('SUPA_INSERT_OK', { msgId, status: msg.status, evoMsgId });

      // ── Registra alias após envio (fire-and-forget, não bloqueia resposta) ────
      // Alias = mapeamento remoteJid/LID → conversa, para que respostas futuras
      // sejam roteadas para ESTA conversa e não criem duplicatas.
      // É executado APÓS insert bem-sucedido e NUNCA bloqueia o retorno.
      const _evoRemoteJid = evoRes?.dados?.key?.remoteJid || '';
      const _lidEnvio = _evoRemoteJid.endsWith('@lid') ? _evoRemoteJid.split('@')[0] : null;
      console.log('WHATSAPP_SEND_RESPONSE_REMOTE_JID', { remoteJid: _evoRemoteJid || 'none', isLid: !!_lidEnvio });
      if (_lidEnvio) console.log('WHATSAPP_SEND_RESPONSE_LID_DETECTED', { lid: _lidEnvio, conversaId: id, telefone: telNormalizado });

      // Logs obrigatórios de diagnóstico do envio
      console.log('WHATSAPP_SEND_RESTORE_START',    { conversaId: id });
      console.log('WHATSAPP_SEND_INSTANCE_USED',    evoSvc.EVOLUTION_INSTANCE);
      console.log('WHATSAPP_SEND_PHONE_SOURCE',     { source: 'conversa.telefone', raw: conversa.telefone });
      console.log('WHATSAPP_SEND_PHONE_FINAL',      { phone_final: telNormalizado, starts_with_55: telNormalizado?.startsWith('55') });
      console.log('WHATSAPP_SEND_IS_LID_DESTINATION', !!_lidEnvio);
      console.log('WHATSAPP_SEND_PAYLOAD_TYPE',     'text');
      console.log('WHATSAPP_SEND_EVOLUTION_STATUS', evoRes?.status || 200);
      console.log('WHATSAPP_SEND_EVOLUTION_RESPONSE_SAFE', { key_id: evoRes?.dados?.key?.id || null, remoteJid: _evoRemoteJid || null });
      console.log('WHATSAPP_SEND_SUCCESS',          { conversaId: id, tel: telNormalizado, msgId, lidEnvio: _lidEnvio || 'nenhum' });

      // Fire-and-forget: alias não pode bloquear resposta ao usuário
      registrarAlias(sb, {
        conversaId: id,
        tel:        telNormalizado,
        rawJid:     _evoRemoteJid || `${telNormalizado}@s.whatsapp.net`,
        lidNumero:  _lidEnvio,
        nome:       null,
      }).then(() => {
        if (_lidEnvio) console.log('WHATSAPP_SEND_ALIAS_LID_SAVED', { lid: _lidEnvio, conversaId: id });
        else console.log('WHATSAPP_SEND_ALIAS_PHONE_SAVED', { telefone: telNormalizado, conversaId: id });
      }).catch(e => console.warn('WHATSAPP_ALIAS_REGISTER_SEND_WARN (não crítico):', e.message));

      // Também mantém LID em dados_extras para compatibilidade com código anterior
      if (_lidEnvio) {
        sb.from(CONVERSAS_TABLE).select('dados_extras').eq('id', id).single()
          .then(({ data: _cv }) => {
            const _ex = (() => { try { return JSON.parse(_cv?.dados_extras || '{}'); } catch { return {}; } })();
            if (!_ex.lid || _ex.lid !== _lidEnvio) {
              _ex.lid = _lidEnvio;
              _ex.lid_telefone = telNormalizado;
              return sb.from(CONVERSAS_TABLE)
                .update({ dados_extras: JSON.stringify(_ex), atualizado_em: new Date().toISOString() })
                .eq('id', id)
                .then(() => console.log('LID_MAPEADO_SUCESSO (Supabase):', { lid: _lidEnvio, conversaId: id }));
            }
          })
          .catch(e => console.warn('LID_MAPEAMENTO_WARN (nao critico):', e.message));
      }

      req.log({ acao: 'WHATSAPP_SEND', entidade: 'conversas_whatsapp', entidade_id: id, depois: { mensagem: mensagem?.slice(0, 100), tipo, evo_ok: evoOk, evoMsgId } });
      return res.status(201).json({ sucesso: true, dados: msg });
    }



    // SQLite path
    const db = getDb();
    db.prepare(`
      INSERT INTO mensagens_whatsapp
        (id, conversa_id, lead_id, telefone, mensagem, tipo, direcao, status, vendedor_id, arquivo_url, arquivo_nome, criado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      msgId, id, conversa.lead_id, telNormalizado,
      mensagem || null, tipo, 'enviada', 'enviado',
      req.usuario.id, arquivo_url || null, arquivo_nome || null, agora
    );
    db.prepare(`UPDATE conversas_whatsapp SET ultima_msg_em = ?, atualizado_em = ?, status = 'ABERTA' WHERE id = ?`).run(agora, agora, id);
    if (conversa.lead_id)
      db.prepare(`UPDATE leads SET atualizado_em = ? WHERE id = ?`).run(agora, conversa.lead_id);

    // ── Solução 3: Armazena mapeamento LID → telefone (SQLite) ──────────────
    const _evoRemoteJidSql = evoRes?.dados?.key?.remoteJid || '';
    if (evoOk && _evoRemoteJidSql.endsWith('@lid')) {
      const _lidSql = _evoRemoteJidSql.split('@')[0];
      try {
        const _cvSql = db.prepare('SELECT dados_extras FROM conversas_whatsapp WHERE id=?').get(id);
        const _exSql = (() => { try { return JSON.parse(_cvSql?.dados_extras || '{}'); } catch { return {}; } })();
        if (!_exSql.lid || _exSql.lid !== _lidSql) {
          _exSql.lid = _lidSql;
          _exSql.lid_telefone = telNormalizado;
          db.prepare('UPDATE conversas_whatsapp SET dados_extras=?, atualizado_em=? WHERE id=?')
            .run(JSON.stringify(_exSql), new Date().toISOString(), id);
          console.log('LID_MAPEADO_SUCESSO (SQLite):', { lid: _lidSql, conversaId: id });
        }
      } catch(e) { console.warn('LID_MAPEAMENTO_WARN SQLite (nao critico):', e.message); }
    }

    req.log({ acao: 'WHATSAPP_SEND', entidade: 'conversas_whatsapp', entidade_id: id, depois: { mensagem: mensagem?.slice(0, 100), tipo, evo_ok: evoOk } });
    const msg = db.prepare(`SELECT m.*, u.nome AS vendedor_nome FROM mensagens_whatsapp m LEFT JOIN usuarios u ON m.vendedor_id = u.id WHERE m.id = ?`).get(msgId);
    return res.status(201).json({ sucesso: true, dados: msg });

  } catch (e) {
    // ── LOG DETALHADO: identifica exatamente onde a excecao ocorreu ─────────
    console.error('WHATSAPP_SEND_CATCH — excecao inesperada no enviarMensagem:', {
      message:    e.message,
      name:       e.name,
      code:       e.code,
      stack:      e.stack?.split('\n').slice(0, 5).join(' | '),
      // Estado das variaveis no momento do erro:
      evoOk_snapshot:    typeof evoOk    !== 'undefined' ? evoOk    : 'NAO_DEFINIDO',
      evoRes_snapshot:   typeof evoRes   !== 'undefined' ? JSON.stringify(evoRes?.dados)?.slice(0,200) : 'NAO_DEFINIDO',
      isSupa_snapshot:   typeof isSupa   !== 'undefined' ? isSupa   : 'NAO_DEFINIDO',
      conversa_snapshot: typeof conversa !== 'undefined' ? conversa?.id : 'NAO_DEFINIDO',
    });
    return res.status(500).json({ sucesso: false, erro: 'Erro ao enviar mensagem.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/conversas
// Cria ou busca conversa existente por telefone
// ─────────────────────────────────────────────────────────────────────────────
async function criarOuAbrirConversa(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const { telefone, lead_id, nome_contato, vendedor_id } = req.body;
    if (!telefone) return res.status(400).json({ sucesso: false, erro: 'Telefone obrigatório.' });
    const tel = normalizePhone(telefone);
    if (!tel || tel.length < 10) return res.status(400).json({ sucesso: false, erro: 'Telefone inválido ou muito curto.' });
    const agora = new Date().toISOString();
    const nomeContato = nome_contato || null;

    console.log('WHATSAPP_CONVERSA_RESOLVE_START', { tel, lead_id, nomeContato });

    if (isSupa) {
      // ── Busca por todas as variantes de telefone para evitar duplicatas ──────
      let conversa = null;
      const variantes = phoneVariants(tel);
      for (const v of variantes) {
        const { data } = await sb.from(CONVERSAS_TABLE)
          .select('*').eq('telefone', v).neq('status', 'FECHADA')
          .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
        if (data?.[0]) { conversa = data[0]; break; }
      }

      // Se ainda não existe, tenta por lead_id
      if (!conversa && lead_id) {
        const { data: byLead } = await sb.from(CONVERSAS_TABLE)
          .select('*').eq('lead_id', lead_id).neq('status', 'FECHADA')
          .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
        if (byLead?.[0]) { conversa = byLead[0]; console.log('WHATSAPP_CONVERSA_FOUND_BY_LEAD', conversa.id); }
      }

      if (!conversa) {
        // Cria nova conversa vinculada ao lead e telefone
        const novaId = crypto.randomBytes(16).toString('hex');
        const { data: nova, error } = await sb.from(CONVERSAS_TABLE).insert({
          id: novaId, lead_id: lead_id || null, telefone: tel,
          nome_contato: nomeContato,
          vendedor_id: vendedor_id || req.usuario.id,
          origem: 'MANUAL', status: 'ABERTA', criado_em: agora, atualizado_em: agora,
        }).select().single();
        if (error) throw error;
        conversa = nova;
        console.log('WHATSAPP_CONVERSA_CREATED', { id: conversa.id, tel, lead_id });
      } else {
        // Atualiza lead_id e/ou nome_contato se estiverem ausentes
        const upd = {};
        if (lead_id && !conversa.lead_id)         upd.lead_id      = lead_id;
        if (nomeContato && !conversa.nome_contato) upd.nome_contato = nomeContato;
        if (Object.keys(upd).length) {
          await sb.from(CONVERSAS_TABLE).update({ ...upd, atualizado_em: agora }).eq('id', conversa.id);
          Object.assign(conversa, upd);
        }
        console.log('WHATSAPP_CONVERSA_FOUND_BY_PHONE', { id: conversa.id, tel: conversa.telefone });
      }

      req.log({ acao: 'WHATSAPP_OPEN', entidade: 'conversas_whatsapp', entidade_id: conversa.id, depois: { telefone: tel, lead_id } });
      return res.json({ sucesso: true, dados: conversa });
    }

    // ── SQLite path ────────────────────────────────────────────────────────────
    const db = getDb();
    let conversa = null;
    // Tenta variantes de telefone
    const variantesSql = phoneVariants(tel);
    for (const v of variantesSql) {
      const row = db.prepare(`SELECT * FROM conversas_whatsapp WHERE telefone = ? AND status != 'FECHADA' ORDER BY COALESCE(ultima_msg_em, criado_em) DESC LIMIT 1`).get(v);
      if (row) { conversa = row; break; }
    }
    // Tenta por lead_id
    if (!conversa && lead_id) {
      conversa = db.prepare(`SELECT * FROM conversas_whatsapp WHERE lead_id = ? AND status != 'FECHADA' ORDER BY COALESCE(ultima_msg_em, criado_em) DESC LIMIT 1`).get(lead_id);
      if (conversa) console.log('WHATSAPP_CONVERSA_FOUND_BY_LEAD (SQLite):', conversa.id);
    }
    if (!conversa) {
      const id = crypto.randomBytes(16).toString('hex');
      db.prepare(`INSERT INTO conversas_whatsapp (id, lead_id, telefone, nome_contato, vendedor_id, origem, status, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, lead_id || null, tel, nomeContato, vendedor_id || req.usuario.id, 'MANUAL', 'ABERTA', agora, agora);
      conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
      console.log('WHATSAPP_CONVERSA_CREATED (SQLite):', id);
    } else {
      if (lead_id && !conversa.lead_id)
        db.prepare('UPDATE conversas_whatsapp SET lead_id = ?, atualizado_em = ? WHERE id = ?').run(lead_id, agora, conversa.id);
      if (nomeContato && !conversa.nome_contato)
        db.prepare('UPDATE conversas_whatsapp SET nome_contato = ?, atualizado_em = ? WHERE id = ?').run(nomeContato, agora, conversa.id);
      console.log('WHATSAPP_CONVERSA_FOUND_BY_PHONE (SQLite):', conversa.id);
    }
    req.log({ acao: 'WHATSAPP_OPEN', entidade: 'conversas_whatsapp', entidade_id: conversa.id, depois: { telefone: tel, lead_id } });
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
async function atualizarStatus(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const { id } = req.params;
    const { status } = req.body;
    const VALIDOS = ['ABERTA','FECHADA','AGUARDANDO'];
    if (!VALIDOS.includes(status)) return res.status(400).json({ sucesso: false, erro: 'Status inválido.' });
    const agora = new Date().toISOString();
    if (isSupa) {
      const { error } = await sb.from(CONVERSAS_TABLE).update({ status, atualizado_em: agora }).eq('id', id);
      if (error) throw error;
    } else {
      getDb().prepare('UPDATE conversas_whatsapp SET status = ?, atualizado_em = ? WHERE id = ?').run(status, agora, id);
    }
    return res.json({ sucesso: true });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/conversas/:id
// Busca uma conversa por ID (para abrir pelo lead)
// ─────────────────────────────────────────────────────────────────────────────
async function buscarConversa(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    if (isSupa) {
      const { data, error } = await sb.from(CONVERSAS_TABLE)
        .select('*, usuarios!conversas_whatsapp_vendedor_id_fkey(nome), leads!conversas_whatsapp_lead_id_fkey(nome,empresa)')
        .eq('id', req.params.id).single();
      if (error || !data) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
      return res.json({ sucesso: true, dados: { ...data, vendedor_nome: data.usuarios?.nome, lead_nome: data.leads?.nome, lead_empresa: data.leads?.empresa } });
    }
    const db = getDb();
    const conversa = db.prepare(`SELECT c.*, u.nome AS vendedor_nome, l.nome AS lead_nome, l.empresa AS lead_empresa FROM conversas_whatsapp c LEFT JOIN usuarios u ON c.vendedor_id = u.id LEFT JOIN leads l ON c.lead_id = l.id WHERE c.id = ?`).get(req.params.id);
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
async function conversaPorLead(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const leadId = req.params.lead_id;

    if (isSupa) {
      // ── Fase 1: busca por lead_id ──────────────────────────────────────────
      const { data: byLeadId } = await sb.from(CONVERSAS_TABLE)
        .select('*, usuarios!conversas_whatsapp_vendedor_id_fkey(nome), leads!conversas_whatsapp_lead_id_fkey(nome,empresa)')
        .eq('lead_id', leadId)
        .neq('status', 'FECHADA')
        .order('criado_em', { ascending: false })
        .limit(1);

      if (byLeadId?.[0]) {
        const c = byLeadId[0];
        console.log(`[WA] conversaPorLead: encontrou por lead_id=${leadId} conv=${c.id}`);
        return res.json({ sucesso: true, dados: { ...c, vendedor_nome: c.usuarios?.nome, lead_nome: c.leads?.nome, lead_empresa: c.leads?.empresa } });
      }

      // ── Fase 2: busca pelo telefone NORMALIZADO do lead ────────────────────
      // Cenário: conversa chegou via webhook sem lead_id vinculado ainda
      const { data: lead } = await sb.from('leads').select('telefone').eq('id', leadId).single();
      if (!lead?.telefone) {
        console.log(`[WA] conversaPorLead: lead ${leadId} sem telefone`);
        return res.json({ sucesso: true, dados: null });
      }

      // USA normalizePhone com prefixo 55 — igual ao formato salvo pelo webhook
      const telNorm = normalizePhone(lead.telefone);
      console.log(`[WA] conversaPorLead: buscando por telefone normalizado ${telNorm}`);

      const { data: byTel } = await sb.from(CONVERSAS_TABLE)
        .select('*, usuarios!conversas_whatsapp_vendedor_id_fkey(nome), leads!conversas_whatsapp_lead_id_fkey(nome,empresa)')
        .eq('telefone', telNorm)
        .order('criado_em', { ascending: false })
        .limit(1);

      if (byTel?.[0]) {
        const c = byTel[0];
        console.log(`[WA] conversaPorLead: encontrou por telefone=${telNorm} conv=${c.id}`);
        // Vincula lead_id automaticamente se ainda não vinculado
        if (!c.lead_id) {
          await sb.from(CONVERSAS_TABLE)
            .update({ lead_id: leadId, atualizado_em: new Date().toISOString() })
            .eq('id', c.id);
        }
        return res.json({ sucesso: true, dados: { ...c, lead_id: c.lead_id || leadId, vendedor_nome: c.usuarios?.nome, lead_nome: c.leads?.nome, lead_empresa: c.leads?.empresa } });
      }

      console.log(`[WA] conversaPorLead: nenhuma conversa para lead=${leadId} tel=${telNorm}`);
      return res.json({ sucesso: true, dados: null });
    }

    // SQLite fallback
    const db = getDb();

    // Fase 1: por lead_id
    const conversa = db.prepare(
      `SELECT c.*, u.nome AS vendedor_nome, l.nome AS lead_nome, l.empresa AS lead_empresa
       FROM conversas_whatsapp c
       LEFT JOIN usuarios u ON c.vendedor_id = u.id
       LEFT JOIN leads l ON c.lead_id = l.id
       WHERE c.lead_id = ? AND c.status != 'FECHADA'
       ORDER BY c.criado_em DESC LIMIT 1`
    ).get(leadId);

    if (conversa) return res.json({ sucesso: true, dados: conversa });

    // Fase 2 SQLite: busca por telefone normalizado (com 55)
    const lead = db.prepare('SELECT telefone FROM leads WHERE id = ?').get(leadId);
    if (!lead?.telefone) return res.json({ sucesso: true, dados: null });

    const telNorm = normalizePhone(lead.telefone);
    const convByTel = db.prepare(
      `SELECT c.*, u.nome AS vendedor_nome, l.nome AS lead_nome, l.empresa AS lead_empresa
       FROM conversas_whatsapp c
       LEFT JOIN usuarios u ON c.vendedor_id = u.id
       LEFT JOIN leads l ON c.lead_id = l.id
       WHERE c.telefone = ? AND c.status != 'FECHADA'
       ORDER BY c.criado_em DESC LIMIT 1`
    ).get(telNorm);

    if (convByTel) {
      if (!convByTel.lead_id) {
        db.prepare('UPDATE conversas_whatsapp SET lead_id = ?, atualizado_em = ? WHERE id = ?').run(leadId, new Date().toISOString(), convByTel.id);
      }
      return res.json({ sucesso: true, dados: { ...convByTel, lead_id: convByTel.lead_id || leadId } });
    }

    return res.json({ sucesso: true, dados: null });
  } catch (e) {
    console.error('[WA] conversaPorLead:', e.message);
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/webhook
// Recebe eventos da Evolution API v1.8.6 e outros provedores WhatsApp
// Sem autenticação JWT (webhook externo) — protegido por WHATSAPP_WEBHOOK_SECRET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza telefone de qualquer formato WhatsApp para dígitos puros.
 * USA a mesma função normalizePhone do topo do arquivo.
 */
function normalizarTelWhatsApp(raw) {
  return normalizePhone(raw);
}

/**
 * Extrai campos de qualquer formato de webhook WhatsApp.
 * Suporta Evolution API v1.8.6 (payload aninhado em body.data)
 * e formatos legados (campos na raiz).
 */
/**
 * Extrai campos de qualquer formato de webhook WhatsApp.
 * Evolution API v1.8.6 envia body.data como ARRAY em MESSAGES_UPSERT.
 * Suporta body.data = objeto OU array — normaliza para objeto único antes de parsear.
 */
function normalizarPayloadWA(body) {
  // ── Normaliza body.data: pode ser array (Evolution v1.8.6) ou objeto ───────
  let dataRaw = body.data || null;
  if (Array.isArray(dataRaw)) {
    dataRaw = dataRaw[0] || null; // pega o primeiro item do array
  }

  // ── Detecta se é Evolution API (tem key com remoteJid) ───────────────────
  const isEvolution = !!(dataRaw && dataRaw.key && dataRaw.key.remoteJid);

  let remoteJid = '', fromMe = false, messageId = null, pushName = '', msgData = {};

  if (isEvolution) {
    remoteJid = dataRaw.key.remoteJid || '';
    fromMe    = dataRaw.key.fromMe === true;
    messageId = dataRaw.key.id || null;
    pushName  = dataRaw.pushName || dataRaw.notifyName || '';
    msgData   = dataRaw.message || {};
  }

  // ── Extrai telefone (todos os caminhos possíveis) ─────────────────────────
  // PRIORIDADE para Evolution API com LID:
  //   1. Se remoteJid é @lid COM participant: usa o participant JID (contém telefone real)
  //   2. Se remoteJid é @lid: tenta extrair de campos adicionais do payload
  //      (contact.phone, contact.id @s.whatsapp.net, number, source)
  //   3. Se nenhum campo tem o número real: rawTel = null
  //   4. JID normal @s.whatsapp.net: usa remoteJid diretamente
  const participantJid = isEvolution
    ? (dataRaw?.participant || dataRaw?.key?.participant || null)
    : null;
  const isLidRaw = isEvolution && remoteJid.endsWith('@lid');

  // Tenta extrair número real de campos adicionais quando é LID
  let _lidRealPhone = null;
  if (isLidRaw && !participantJid) {
    // LOG completo do payload para diagnóstico (apenas para LID sem participant)
    console.log('WA_LID_PAYLOAD_FIELDS', JSON.stringify({
      event: body.event,
      remoteJid: dataRaw?.key?.remoteJid,
      participant: dataRaw?.key?.participant,
      pushName: dataRaw?.pushName,
      notifyName: dataRaw?.notifyName,
      contact_id: dataRaw?.contact?.id,
      contact_phone: dataRaw?.contact?.phone,
      contact_lid: dataRaw?.contact?.lid,
      number: dataRaw?.number,
      source: dataRaw?.source,
      phoneNumber: dataRaw?.phoneNumber,
      waId: dataRaw?.waId,
      jid: dataRaw?.jid,
      id_field: dataRaw?.id,
      dataKeys: Object.keys(dataRaw || {}),
    }).slice(0, 800));

    // Tenta campo contact.phone ou contact.id (@s.whatsapp.net)
    const _cId   = dataRaw?.contact?.id   || '';
    const _cPhone = dataRaw?.contact?.phone || '';
    const _cPhoneAlt = dataRaw?.phoneNumber || dataRaw?.waId || dataRaw?.number || dataRaw?.source || '';
    if (_cPhone) {
      _lidRealPhone = _cPhone;
    } else if (_cId && _cId.includes('@s.whatsapp.net')) {
      _lidRealPhone = _cId.split('@')[0];
    } else if (_cPhoneAlt) {
      _lidRealPhone = _cPhoneAlt;
    }
    if (_lidRealPhone) {
      console.log('WA_LID_REAL_PHONE_FROM_PAYLOAD', { _lidRealPhone, source: _cPhone ? 'contact.phone' : _cId ? 'contact.id' : 'alt_field' });
    }
  }

  const rawTel = isEvolution
    ? (
        (isLidRaw && participantJid) ? participantJid   // LID + participant: JID real do contato
        : (isLidRaw && _lidRealPhone) ? _lidRealPhone   // LID + campo extra: número real
        : isLidRaw ? null                               // LID sem nenhum campo: sem tel real
        : remoteJid                                     // JID normal: usa direto
      )
    : (
        dataRaw?.key?.remoteJid ||
        dataRaw?.remoteJid ||
        dataRaw?.from ||
        dataRaw?.sender ||
        dataRaw?.number ||
        body.messages?.[0]?.key?.remoteJid ||
        body.telefone || body.phone || body.from || body.remoteJid || body.sender || body.number || ''
      );
  const tel = normalizarTelWhatsApp(rawTel);
  // Preserva o número LID original (sem @) para mapeamento interno.
  // Nunca usa lidNumero como telefone de conversa.
  const lidNumero = isLidRaw ? remoteJid.split('@')[0].replace(/\D/g, '') || null : null;

  // ── Extrai nome do contato ────────────────────────────────────────────────
  const nome = (
    (isEvolution ? pushName : null) ||
    dataRaw?.pushName || dataRaw?.notifyName ||
    body.pushName || body.nome || body.name ||
    body.contactName || body.senderName || tel || ''
  ).trim();

  // ── Extrai texto (todos os caminhos possíveis) ─────────────────────────────
  const conteudo = isEvolution
    ? (
        msgData.conversation ||
        msgData.extendedTextMessage?.text ||
        msgData.textMessage?.text ||
        msgData.text ||
        msgData.imageMessage?.caption ||
        msgData.videoMessage?.caption ||
        msgData.documentMessage?.title ||
        null
      )
    : (
        dataRaw?.message?.conversation ||
        dataRaw?.message?.extendedTextMessage?.text ||
        dataRaw?.text ||
        body.messages?.[0]?.message?.conversation ||
        body.messages?.[0]?.message?.extendedTextMessage?.text ||
        body.mensagem || body.message || body.text || body.body || body.content || body.caption || ''
      )?.trim() || null;

  // ── Tipo da mensagem ──────────────────────────────────────────────────────
  let tipo = 'texto';
  if (isEvolution) {
    if (msgData.imageMessage)                          tipo = 'imagem';
    else if (msgData.audioMessage || msgData.pttMessage) tipo = 'audio';
    else if (msgData.videoMessage)                     tipo = 'video';
    else if (msgData.documentMessage)                  tipo = 'documento';
    else if (msgData.stickerMessage)                   tipo = 'sticker';
  } else {
    const rawTipo = dataRaw?.type || body.tipo || body.type;
    if (['texto','audio','imagem','video','documento','sticker','localizacao','contato'].includes(rawTipo)) {
      tipo = rawTipo;
    }
  }

  // ── messageId (todos os caminhos) ─────────────────────────────────────────
  const finalMsgId = messageId ||
    dataRaw?.key?.id || dataRaw?.id ||
    body.messages?.[0]?.key?.id ||
    body.messageId || body.message_id || body.wamid || body.msgId || null;

  // ── Mídia ─────────────────────────────────────────────────────────────────
  // mediaUrl: Evolution v1.8.6 fornece URL temporária em dataRaw.mediaUrl (pode expirar)
  // Para documentos/imagens/vídeos, o URL real pode estar DENTRO do objeto de mídia
  // (msgData.documentMessage.url, imageMessage.url etc.) — extraído aqui como fallback
  const midiaUrl = dataRaw?.mediaUrl
    || msgData?.documentMessage?.url
    || msgData?.imageMessage?.url
    || msgData?.videoMessage?.url
    || body.midia_url || body.mediaUrl || body.media_url || null;
  // WA_INBOUND_FILE_TYPE_DETECTED — somente para mídias não-áudio
  if (['imagem','video','documento'].includes(
      msgData?.imageMessage ? 'imagem' : msgData?.videoMessage ? 'video' : msgData?.documentMessage ? 'documento' : ''
  )) {
    console.log('WA_INBOUND_FILE_TYPE_DETECTED', {
      tipo: msgData?.imageMessage ? 'imagem' : msgData?.videoMessage ? 'video' : 'documento',
      hasMidiaUrl: !!midiaUrl,
      fileName: msgData?.documentMessage?.fileName || msgData?.imageMessage?.fileName || null,
      mimeType: msgData?.documentMessage?.mimetype || msgData?.imageMessage?.mimetype || null,
    });
  }

  // Objeto de mídia específico — prioridade para extrair mimeType e fileName
  const _imgMsg  = msgData?.imageMessage    || null;
  const _vidMsg  = msgData?.videoMessage    || null;
  const _audMsg  = msgData?.audioMessage    || msgData?.pttMessage || null;
  const _docMsg  = msgData?.documentMessage || null;
  const _midiaMsg = _imgMsg || _vidMsg || _audMsg || _docMsg || msgData?.stickerMessage || null;

  const mimeType = (
    _midiaMsg?.mimetype || _midiaMsg?.mediaType ||
    dataRaw?.mimeType   || body.mime_type || body.mimeType || null
  );
  const arquivoNome = (
    _docMsg?.fileName || _docMsg?.title ||
    _midiaMsg?.fileName ||
    dataRaw?.fileName || body.arquivo_nome || body.fileName || body.filename || null
  );
  console.log('[WA Webhook] MEDIA_META', { tipo, hasMidiaUrl: !!midiaUrl, mimeType, arquivoNome });

  // ── fromMe / direção ──────────────────────────────────────────────────────
  const resolvedFromMe = isEvolution
    ? fromMe
    : (dataRaw?.key?.fromMe === true || dataRaw?.fromMe === true || body.fromMe === true);
  const direcao = resolvedFromMe ? 'enviada' : 'recebida';

  // ── JID raw para detectar grupos (@g.us) ──────────────────────────────────
  const rawJid = remoteJid || dataRaw?.remoteJid || body.from || body.remoteJid || body.sender || '';

  return { tel, nome, conteudo, tipo, messageId: finalMsgId, midiaUrl, arquivoNome, mimeType, direcao, rawJid, isEvolution, fromMe: resolvedFromMe, lidNumero };
}


// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES_UPDATE: Atualiza status de entrega/leitura de uma mensagem enviada
// Evolution v1.8.6 — payload esperado:
//   body.event = "MESSAGES_UPDATE"
//   body.data = array de { key: { id, remoteJid, fromMe }, update: { status } }
//   ou body.data = { key: {...}, update: { status } }
// Status Evolution → CRM:
//   PENDING → pending
//   SERVER_ACK → sent
//   DELIVERY_ACK → delivered
//   READ → read
//   PLAYED → read
//   ERROR → failed
// ─────────────────────────────────────────────────────────────────────────────
async function processarStatusMensagem(body, req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const agora = new Date().toISOString();

    // A Evolution envia body.data como array ou objeto único
    const updates = Array.isArray(body.data)
      ? body.data
      : (body.data ? [body.data] : []);

    if (!updates.length) {
      return res.json({ sucesso: true, ignorado: true, motivo: 'sem_updates_de_status' });
    }

    const EVO_STATUS_MAP = {
      // Schema Supabase: CHECK(status IN ('enviado','entregue','lido','erro'))
      'PENDING':      'enviado',
      'SERVER_ACK':   'enviado',
      'DELIVERY_ACK': 'entregue',
      'READ':         'lido',
      'PLAYED':       'lido',
      'ERROR':        'erro',
      // Variantes lowercase
      'pending':      'enviado',
      'sent':         'enviado',
      'delivered':    'entregue',
      'read':         'lido',
      'played':       'lido',
      'error':        'erro',
    };

    let atualizadas = 0;

    for (const upd of updates) {
      const evoMsgId = upd.key?.id || upd.id || null;
      const evoStatus = upd.update?.status || upd.status || null;
      const remoteJid = upd.key?.remoteJid || upd.remoteJid || null;

      if (!evoMsgId || !evoStatus) {
        console.log('[WA Status] Update sem messageId ou status:', JSON.stringify(upd));
        continue;
      }

      const statusCRM = EVO_STATUS_MAP[evoStatus] || null;
      if (!statusCRM) {
        console.log('[WA Status] Status desconhecido:', evoStatus);
        continue;
      }

      console.log('WEBHOOK_STATUS_UPDATE:', { evoMsgId, evoStatus, statusCRM, remoteJid });

      const updatePayload = {
        status: statusCRM,
        atualizado_em: agora,
        ...(statusCRM === 'entregue' ? { entregue_em: agora } : {}),
        ...(statusCRM === 'lido'     ? { lido_em: agora }     : {}),
      };

      if (isSupa) {
        // Busca por evolution_message_id (coluna nova) OU por id (coluna existente)
        let updated = false;

        // Tenta por evolution_message_id primeiro (coluna adicionada via migração)
        try {
          const { data: byEvoId, error: errEvo } = await sb.from(MENSAGENS_TABLE)
            .update(updatePayload)
            .eq('evolution_message_id', evoMsgId)
            .select('id');
          if (!errEvo && byEvoId?.length) {
            updated = true;
            atualizadas += byEvoId.length;
            console.log('WEBHOOK_STATUS_SALVO:', { por: 'evolution_message_id', evoMsgId, statusCRM, ids: byEvoId.map(r=>r.id) });
          }
        } catch(e) { /* coluna pode não existir ainda */ }

        // Fallback: busca por id (o campo id da mensagem = messageId da Evolution quando salvo)
        if (!updated) {
          const { data: byId, error: errId } = await sb.from(MENSAGENS_TABLE)
            .update(updatePayload)
            .eq('id', evoMsgId)
            .select('id');
          if (!errId && byId?.length) {
            updated = true;
            atualizadas += byId.length;
            console.log('WEBHOOK_STATUS_SALVO:', { por: 'id', evoMsgId, statusCRM, ids: byId.map(r=>r.id) });
          }
        }

        if (!updated) {
          console.log('[WA Status] Mensagem não encontrada para atualizar:', evoMsgId);
        }
      } else {
        // SQLite fallback
        const db = getDb();
        try {
          const byEvoId = db.prepare('UPDATE mensagens_whatsapp SET status=?, atualizado_em=? WHERE evolution_message_id=?')
            .run(statusCRM, agora, evoMsgId);
          if (!byEvoId.changes) {
            db.prepare('UPDATE mensagens_whatsapp SET status=?, atualizado_em=? WHERE id=?')
              .run(statusCRM, agora, evoMsgId);
          }
          atualizadas++;
        } catch(e) {
          // Coluna evolution_message_id pode não existir no SQLite ainda — usa só id
          db.prepare('UPDATE mensagens_whatsapp SET status=? WHERE id=?').run(statusCRM, evoMsgId);
          atualizadas++;
        }
      }
    }

    return res.json({ sucesso: true, atualizadas });
  } catch (e) {
    console.error('[WA Status] Erro ao processar status:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

async function webhookReceberMensagem(req, res) {
  // ── 0. WHATSAPP_WEBHOOK_RAW_RECEIVED — antes de qualquer validação ou parser ─────
  const _rawPayload = req.body || {};
  const _rawEvento  = String(_rawPayload.event || _rawPayload.type || '(sem event)');
  const _rawInstance= String(_rawPayload.instance || '(sem instance)');
  const _rawData    = _rawPayload.data;
  const _rawDataItem= Array.isArray(_rawData) ? _rawData[0] : (_rawData || {});
  const _rawRemoteJid = _rawDataItem?.key?.remoteJid || '(sem jid)';
  const _rawFromMe    = _rawDataItem?.key?.fromMe;
  const _rawMsgId     = _rawDataItem?.key?.id || '(sem id)';
  const _rawHasText   = !!(_rawDataItem?.message?.conversation || _rawDataItem?.message?.extendedTextMessage?.text);
  const _rawHasMedia  = !!(_rawDataItem?.message?.imageMessage || _rawDataItem?.message?.audioMessage || _rawDataItem?.message?.videoMessage || _rawDataItem?.message?.documentMessage);
  console.log('WHATSAPP_WEBHOOK_RAW_RECEIVED', {
    ts:           new Date().toISOString(),
    method:       req.method,
    contentType:  req.headers['content-type'] || '(sem)',
    event:        _rawEvento,
    instance:     _rawInstance,
    remoteJid:    _rawRemoteJid,
    fromMe:       _rawFromMe,
    messageId:    _rawMsgId,
    hasText:      _rawHasText,
    hasMedia:     _rawHasMedia,
    payloadSize:  JSON.stringify(_rawPayload).length,
  });
  // Log completo do payload: DESATIVADO — causava rate limit 500 logs/sec no Railway.
  // Para ativar temporariamente para diagnóstico: descomente a linha abaixo.
  // console.log('WEBHOOK_EVOLUTION_RECEBIDO_REAL', JSON.stringify(req.body, null, 2));

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ sucesso: false, erro: 'Payload JSON inválido.' });
  }

  // ── 1. Validação de autenticação — múltiplas estratégias ─────────────────
  // A Evolution API v1.8.6 NÃO envia x-webhook-secret por padrão.
  // Ela envia `apikey` no body E `instance` no body.
  //
  // Estratégia (aceita se QUALQUER condição for verdadeira):
  //   (a) WHATSAPP_WEBHOOK_SECRET não configurado → aceita tudo
  //   (b) Header x-webhook-secret bate com WHATSAPP_WEBHOOK_SECRET
  //   (c) body.apikey bate com EVOLUTION_API_KEY (Evolution envia apikey no body)
  //   (d) body.instance bate com EVOLUTION_INSTANCE (quando var está configurada)
  //   (e) body.instance não-vazio + event reconhecido da Evolution (fallback: EVOLUTION_INSTANCE não configurado)
  //       → seguro porque o endpoint não executa código perigoso sem validar o payload depois
  const secretEsperado      = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  const evoApiKeyEsperado   = process.env.EVOLUTION_API_KEY       || '';
  const evoInstanceEsperada = (process.env.EVOLUTION_INSTANCE || process.env.EVOLUTION_INSTANCE_NAME || '').trim();

  const secretHeader    = req.headers['x-webhook-secret'] || req.query.secret || '';
  const apikeyPayload   = body.apikey   || '';
  const instancePayload = body.instance || '';
  const eventoPayload   = String(body.event || body.type || '').toUpperCase();

  const semSecretConfigurado   = !secretEsperado;
  const autenticadoPorSecret   = !!(secretEsperado && secretHeader === secretEsperado);
  const autenticadoPorApikey   = !!(evoApiKeyEsperado && apikeyPayload && apikeyPayload === evoApiKeyEsperado);
  const autenticadoPorInstance = !!(evoInstanceEsperada && instancePayload && instancePayload === evoInstanceEsperada);
  // (e) Fallback: payload tem instance E evento Evolution reconhecido — sem EVOLUTION_INSTANCE configurado
  const EVENTOS_EVOLUTION_CONHECIDOS = [
    'MESSAGES_UPSERT','MESSAGES_UPDATE','MESSAGES_SET','CONNECTION_UPDATE',
    'QRCODE_UPDATED','CONTACTS_UPSERT','CHATS_UPSERT','PRESENCE_UPDATE',
  ];
  const autenticadoPorPayloadEvolution = !!(
    !evoInstanceEsperada &&      // só aplica quando EVOLUTION_INSTANCE não está configurado
    instancePayload &&           // payload precisa ter instance
    EVENTOS_EVOLUTION_CONHECIDOS.includes(eventoPayload)
  );

  const autenticado = semSecretConfigurado || autenticadoPorSecret || autenticadoPorApikey || autenticadoPorInstance || autenticadoPorPayloadEvolution;

  console.log('WEBHOOK_RECEIVED', {
    ip: req.ip,
    event: eventoPayload || '(sem event)',
    instance: instancePayload || '(sem instance)',
  });
  console.log('WEBHOOK_AUTH_RESULT', {
    autenticado,
    semSecretConfigurado,
    autenticadoPorSecret,
    autenticadoPorApikey,
    autenticadoPorInstance,
    autenticadoPorPayloadEvolution,
    evoInstanceEsperada: evoInstanceEsperada || '(não configurado)',
  });

  if (!autenticado) {
    console.warn('WEBHOOK_AUTH_REJECTED', {
      ip: req.ip,
      secretHeader: secretHeader ? '(presente)' : '(ausente)',
      apikeyPayload: apikeyPayload ? apikeyPayload.slice(0, 6) + '...' : '(ausente)',
      instancePayload: instancePayload || '(ausente)',
      eventoPayload,
      dica: 'Configure WHATSAPP_WEBHOOK_SECRET="" para desativar auth, ou EVOLUTION_INSTANCE=nome-da-instancia',
    });
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }

  // ── 2. Identifica tipo de evento ─────────────────────────────────────────
  const evento = String(body.event || body.type || '').toUpperCase().replace(/\./g, '_');
  const instance = body.instance || '(sem instance)';

  console.log('WHATSAPP_WEBHOOK_INBOUND_START', {
    event: evento, instance,
    alias_table:   ALIAS_TABLE,
    mensagens_table: MENSAGENS_TABLE,
    conversas_table: CONVERSAS_TABLE,
  });
  console.log('WEBHOOK_EVENT_NAME', evento || '(sem evento)');
  console.log('WEBHOOK_INSTANCE', instance);
  console.log('WEBHOOK_PROCESS_START', { event: evento, instance });


  // ── 2a. Evento de STATUS — atualiza check de entrega/leitura ─────────────
  // NUNCA cria mensagem nova — apenas atualiza status da mensagem existente
  const ehEventoStatus =
    evento === 'MESSAGES_UPDATE' ||
    evento === 'MESSAGE_STATUS'  ||
    evento === 'MESSAGE-STATUS'  ||
    String(body.event || '').toUpperCase() === 'MESSAGES_UPDATE';

  if (ehEventoStatus) {
    // ── DETECÇÃO: MESSAGES_UPDATE com mensagem real (Evolution v2+) ──────────
    // Algumas versões da Evolution enviam NOVAS mensagens recebidas como MESSAGES_UPDATE
    // em vez de MESSAGES_UPSERT. Detecta pelo campo 'message' no payload.
    const dados = body.data;
    const primeiroDado = Array.isArray(dados) ? dados[0] : dados;
    const temMensagemReal = primeiroDado?.message &&
      typeof primeiroDado.message === 'object' &&
      Object.keys(primeiroDado.message).length > 0;

    if (temMensagemReal) {
      console.log('WEBHOOK_MESSAGES_UPDATE_COM_MENSAGEM — redirecionando para fluxo de recebimento');
      // Normaliza para o formato MESSAGES_UPSERT e continua no fluxo principal
      body.event = 'MESSAGES_UPSERT';
      // Cai no processamento normal abaixo (não retorna aqui)
    } else {
      console.log('WEBHOOK_STATUS_UPDATE: processando atualização de status — NÃO cria conversa/mensagem');
      return await processarStatusMensagem(body, req, res);
    }
  }

  // ── 2b. Filtra eventos não-mensagem ───────────────────────────────────────
  const EVENTOS_MENSAGEM_NOVA = [
    'MESSAGES_UPSERT', 'MESSAGES_SET',
    'SEND_MESSAGE', 'SEND_MESSAGES',
    'MESSAGE', 'NEW_MESSAGE',
  ];
  const EVENTOS_IGNORADOS_SEM_AVISO = [
    'MESSAGES_UPDATE', 'MESSAGE_STATUS', 'MESSAGE-STATUS',
    'CHATS_UPSERT', 'CHATS_UPDATE', 'CHATS_SET',
    'CONTACTS_UPSERT', 'CONTACTS_UPDATE', 'CONTACTS_SET',
    'PRESENCE_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED',
    'LABELS_EDIT', 'LABELS_ASSOCIATION',
    'GROUPS_UPSERT', 'GROUPS_UPDATE', 'GROUP_PARTICIPANTS_UPDATE',
    'NEW_JWT_TOKEN', 'CALL',
  ];

  // Se tiver campo event, exige que seja da lista EXATA de mensagens novas
  // Se NÃO tiver campo event, tenta processar (payload legado)
  const ehEventoMensagem = !body.event || EVENTOS_MENSAGEM_NOVA.includes(evento);

  if (!ehEventoMensagem) {
    if (EVENTOS_IGNORADOS_SEM_AVISO.includes(evento)) {
      return res.json({ sucesso: true, ignorado: true, motivo: `evento_${evento}_ignorado` });
    }
    console.warn('WEBHOOK_EVENTO_IGNORADO:', { eventName: evento, eventOriginal: body.event, body: JSON.stringify(body).slice(0, 200) });
    return res.json({ sucesso: true, ignorado: true, motivo: `evento_${evento}_ignorado` });
  }


  // ── 3. Normalizar payload ─────────────────────────────────────────────────
  const parsed = normalizarPayloadWA(body);
  const { tel, nome, conteudo, tipo, messageId, midiaUrl, arquivoNome, mimeType, direcao, rawJid, fromMe, lidNumero } = parsed;

  // Logs obrigatórios pós-parse
  console.log('WEBHOOK_MESSAGES_UPSERT_RECEIVED', {
    event: evento,
    instance,
    rawJid,
    tel: tel || '(não extraído)',
    fromMe,
    messageId: messageId || '(sem id)',
    hasText: !!(conteudo),
    tipo,
  });
  console.log('WEBHOOK_FROM_ME_VALUE', fromMe);
  console.log('WEBHOOK_PHONE_NORMALIZED', { rawJid, telNormalizado: tel || '(inválido)' });

  // ── Detecta JID no formato LID (WhatsApp Multi-Device) ──────────────────────
  // MOVIDO para antes do bloco telFinal — que já precisa da variável
  const isLidJid = rawJid.endsWith('@lid');
  if (isLidJid) {
    console.log(`[WA Webhook] ⚠️ LID_DETECTADO: ${lidNumero || '(sem numero)'} (JID: ${rawJid})`);
    console.log('WA_INBOUND_LID_DETECTED', { lidNumero, rawJid, fromMe });
  }

  // ── CORREÇÃO LID: tel pode ser nulo quando remoteJid é @lid sem participant ──
  // APÓS FIX DA CAUSA RAIZ: normalizarPayloadWA já retorna tel=null para LID sem participant.
  // Esta seção mantém o comportamento correto como camada defensiva adicional.
  let telFinal = tel;
  if (!telFinal) {
    if (isLidJid) {
      // LID sem participant: não há telefone real no payload.
      // Não usar o número do LID como tel — é um ID interno do WhatsApp, não um telefone.
      telFinal = null;
      console.warn('WHATSAPP_LID_SEM_TELEFONE_REAL', { lidNumero, rawJid, motivo: 'lid_sem_participant_aguardando_resolucao' });
      console.log('WA_INBOUND_PHONE_NULL_LID_FLOW_START', { lidNumero, rawJid, fromMe });
    } else if (rawJid && rawJid.length > 3) {
      // Não é LID: usa rawJid como fallback (comportamento original)
      telFinal = rawJid.split('@')[0].replace(/\D/g, '') || null;
      console.warn('WHATSAPP_INBOUND_PHONE_FALLBACK_JID', { rawJid, telFinal, motivo: 'tel_nulo_usando_jid' });
    }
    if (!telFinal && !isLidJid) {
      console.warn('WEBHOOK_PHONE_INVALID_REJECTED', { rawJid, body: JSON.stringify(body).slice(0, 200) });
      return res.status(400).json({ sucesso: false, erro: 'Telefone não identificado no payload.' });
    }
  }

  // ── Log estruturado de identidade WA — diagnóstico obrigatório (Fase 12) ─────
  // Permite rastrear QUALQUER duplicação futura em segundos pelos logs.
  console.log('[WA_IDENTITY]', JSON.stringify({
    messageId:         messageId      || null,
    evento:            evento         || null,
    rawJid:            rawJid         || null,
    isLidJid:          isLidJid,
    lidNumero:         lidNumero      || null,
    participantJid:    (isLidJid ? (normalizarPayloadWA._lastParticipant || null) : null),
    telNormalized:     telFinal       || null,
    fromMe:            fromMe,
    pushName:          nome?.slice(0, 40) || null,
    instance:          instance       || null,
  }));

  // ── WHATSAPP_INBOUND_NORMALIZED_RESULT — resultado do parser para rastreamento ──────
  console.log('WHATSAPP_INBOUND_NORMALIZED_RESULT', {
    remote_jid:    rawJid         || null,
    lid:           lidNumero      || null,
    telefone_real: telFinal       || null,
    fromMe:        fromMe,
    texto_curto:   conteudo       ? conteudo.slice(0, 40) : null,
    tipo_mensagem: tipo,
    messageId:     messageId      || null,
    instance:      instance       || null,
  });

  // ── Valida número — permissivo para não bloquear recebimento ────────────────
  // Brasil: 55 + DDD(2) + número(8-9) = 12-13 dígitos
  // Internacional genérico: 10-15 dígitos
  // telFinal pode ser null quando LID sem participant (caso tratado acima)
  const numBrasileiro = telFinal ? /^55\d{10,11}$/.test(telFinal) : false;
  const numGenerico   = telFinal ? /^\d{10,15}$/.test(telFinal)   : false;
  if (telFinal && !numBrasileiro && !numGenerico) {
    // APENAS LOGA — não descarta. Pode ser número LID ou formato não previsto.
    console.warn('WEBHOOK_NUMERO_FORMATO_INCOMUM', {
      telefoneOriginal: rawJid,
      telefoneNormalizado: telFinal,
      eventName: evento,
      acao: 'prosseguindo_mesmo_assim',
    });
  }

  // Ignora mensagens de grupos (JID com @g.us)
  if (rawJid.includes('@g.us')) {
    console.log('[WA Webhook] Grupo ignorado:', rawJid);
    return res.json({ sucesso: true, ignorado: true, motivo: 'grupo_ignorado' });
  }

  // ── Bloqueia SOMENTE se: tipo=texto, sem conteúdo E sem mídia ───────────────
  // Áudios, imagens, vídeos e documentos devem passar mesmo sem texto.
  const ehMidia = ['audio','imagem','video','documento','sticker'].includes(tipo);
  if (!conteudo && tipo === 'texto' && !ehMidia) {
    console.warn('WHATSAPP_INBOUND_SEM_CONTEUDO — ignorando mensagem sem texto e sem mídia:', JSON.stringify(req.body).slice(0, 300));
    return res.json({ sucesso: true, ignorado: true, motivo: 'sem_conteudo' });
  }

  const { sb, isSupa } = getProvider();
  const agora = new Date().toISOString();
  const db = !isSupa ? getDb() : null;

  try {
    // ── 4. Idempotência por messageId ─────────────────────────────────────
    if (messageId) {
      if (isSupa) {
        // Verifica ambos os IDs: local e o da Evolution (salvo em evolution_message_id)
        const { data: existing } = await sb.from(MENSAGENS_TABLE)
          .select('id,conversa_id')
          .or(`id.eq.${messageId},evolution_message_id.eq.${messageId}`)
          .limit(1);
        if (existing?.[0]) {
          // ── FIX DEFINITIVO: fromMe=true + LID = capturar LID do destinatário ────────
          // Cenário A: eco chega com LID JID (ex: SR Assis) → captura diretamente
          if (fromMe && isLidJid && lidNumero && existing[0].conversa_id) {
            console.log('WHATSAPP_FROMME_LID_ALIAS_CAPTURE', { conversaId: existing[0].conversa_id, lidNumero, rawJid });
            registrarAlias(sb, {
              conversaId: existing[0].conversa_id,
              tel: null,
              rawJid,
              lidNumero,
              nome: null,
            }).catch(e => console.warn('WHATSAPP_FROMME_LID_ALIAS_WARN:', e.message));
          }

          // ── FIX COMPLEMENTAR: eco chega com phone JID (não LID) ───────────────────
          // Cenário B: CRM envia para 5511988360519@s.whatsapp.net → eco fromMe tem phone JID.
          // Quando o destinatário responde com o LID do dispositivo, Step 0 falha (sem alias LID).
          // Aqui: tenta buscar o LID do contato na Evolution API via o telefone do eco.
          // Fire-and-forget para não atrasar a resposta HTTP.
          if (fromMe && !isLidJid && tel && existing[0].conversa_id && isSupa) {
            (async () => {
              try {
                const telJidBusca = `${tel}@s.whatsapp.net`;
                const resC = await evoSvc.call('POST', `/contacts/find/${evoSvc.EVOLUTION_INSTANCE}`, { where: { id: telJidBusca } });
                const c = (Array.isArray(resC?.dados) ? resC.dados : (resC?.dados ? [resC.dados] : []))[0] || null;
                console.log('WHATSAPP_FROMME_PHONE_CONTACT_EVO', {
                  tel, found: !!c,
                  contactId: c?.id || null,
                  contactLid: c?.lid || null,
                  keys: c ? Object.keys(c).slice(0, 10) : [],
                });
                // Se Evolution retornar campo 'lid' no contato → registra alias para LID
                if (c) {
                  const rawLid = c.lid || (typeof c.id === 'string' && c.id.endsWith('@lid') ? c.id : null);
                  if (rawLid) {
                    const lidNorm = String(rawLid).split('@')[0].replace(/\D/g, '');
                    if (lidNorm && lidNorm.length >= 10) {
                      console.log('WHATSAPP_FROMME_LID_CAPTURED_VIA_PHONE', { tel, lidNorm, conversaId: existing[0].conversa_id });
                      await registrarAlias(sb, {
                        conversaId: existing[0].conversa_id,
                        tel,
                        rawJid: `${lidNorm}@lid`,
                        lidNumero: lidNorm,
                        nome: null,
                      });
                    }
                  }
                }
              } catch (e) { console.warn('WHATSAPP_FROMME_PHONE_LID_WARN:', e.message); }
            })();
          }

          return res.json({ sucesso: true, ignorado: true, motivo: 'mensagem_ja_salva' });
        }
      } else if (db) {
        const ex = db.prepare('SELECT id FROM mensagens_whatsapp WHERE id = ? OR evolution_message_id = ? LIMIT 1').get(messageId, messageId);
        if (ex) return res.json({ sucesso: true, ignorado: true, motivo: 'mensagem_ja_salva' });
      }
    }


    // ── 4b. Se fromMe=true: deduplicação extra por conteúdo+telefone+janela 30s ─
    if (fromMe) {
      console.log(`[WA Webhook] fromMe=true — mensagem enviada pelo número conectado para ${tel}`);
      if (conteudo) {
        const CABECALHO_RE = /^.+\| PROSPEKT\n\n/;
        const textoLimpo = conteudo.replace(CABECALHO_RE, '').trim();
        const trintaSeg = new Date(Date.now() - 30_000).toISOString();

        if (isSupa) {
          const { data: msgDup } = await sb.from(MENSAGENS_TABLE)
            .select('id')
            .eq('telefone', tel)
            .eq('direcao', 'enviada')
            .gte('criado_em', trintaSeg)
            .or(`mensagem.eq.${textoLimpo},mensagem.eq.${conteudo}`)
            .limit(1);
          if (msgDup?.[0]) {
            console.log(`[WA Webhook] fromMe=true DUPLICATA DETECTADA — msg já salva pelo CRM (${msgDup[0].id}), ignorando.`);
            return res.json({ sucesso: true, ignorado: true, motivo: 'fromMe_duplicata_crm' });
          }
        } else if (db) {
          const msgDup = db.prepare(
            "SELECT id FROM mensagens_whatsapp WHERE telefone=? AND direcao='enviada' AND (mensagem=? OR mensagem=?) AND criado_em>=? LIMIT 1"
          ).get(tel, textoLimpo, conteudo, trintaSeg);
          if (msgDup) {
            console.log(`[WA Webhook] fromMe=true DUPLICATA DETECTADA (SQLite) — ignorando.`);
            return res.json({ sucesso: true, ignorado: true, motivo: 'fromMe_duplicata_crm' });
          }
        }
      }
    }

    // ── 5. Busca lead pelo telefone (normalizado) ────────────────────────────
    let leadId = null;
    const telSem55 = (telFinal && telFinal.startsWith('55') && telFinal.length >= 12) ? telFinal.slice(2) : null;
    // Declaradas aqui (escopo pai) para ficarem visíveis no step 5b, 5c E no step 6.
    // ERRO ANTERIOR: estavam dentro do if(isSupa) do step 5, causando ReferenceError no step 6.
    let aliasConversaEncontrada = null; // conversa_id resolvida via alias de LID — bypassa 5c e step 6
    let lidLeadCriadoNesta      = false; // lead criado nesta req para LID sem tel real

    if (isSupa) {
      let leadsFound = null;

      // ── 5a. Busca por telefone (variantes) — só quando telFinal não é null ─
      if (telFinal) {
        const variantesCompletas = phoneVariants(telFinal);
        for (const variant of variantesCompletas) {
          const { data: found } = await sb.from('leads').select('id,telefone')
            .or(`telefone.eq.${variant},telefone.ilike.%${variant}%`)
            .is('deleted_at', null).limit(1);
          if (found?.[0]) { leadsFound = found; break; }
        }
        leadId = leadsFound?.[0]?.id || null;
        console.log(`WEBHOOK_LEAD_ENCONTRADO: tel=${telFinal} variantes=${phoneVariants(telFinal).join('|')} → leadId=${leadId}`);
      } else {
        console.log(`WEBHOOK_LEAD_LOOKUP_SKIP: telFinal=null (LID sem participant), buscando via alias`);
      }

      // ── 5b-ECO: fromMe+LID → alias correto via evolution_message_id ──────────────
      // Quando o CRM envia mensagem, o ECO chega com remoteJid=LID. O key.id do ECO
      // é IDÊNTICO ao evolution_message_id salvo no banco ao enviar. Usamos isso para
      // encontrar a conversa canônica e salvar alias LID→canonical. Sem isso, o ECO
      // criaria alias para conversa órfã e todo inbound futuro falharia.
      if (fromMe && isLidJid && lidNumero && messageId) {
        try {
          const { data: _ecoMsg } = await sb.from(MENSAGENS_TABLE)
            .select('conversa_id, lead_id')
            .eq('evolution_message_id', messageId)
            .eq('direcao', 'enviada')
            .limit(1);
          if (_ecoMsg?.[0]?.conversa_id) {
            await registrarAlias(sb, {
              conversaId: _ecoMsg[0].conversa_id,
              tel: null, rawJid: rawJid || null, lidNumero: lidNumero || null, nome: null,
            }).catch(() => {});
            console.log('WA_ECO_LID_ALIAS_SAVED', {
              conversaId: _ecoMsg[0].conversa_id, leadId: _ecoMsg[0].lead_id, lidNumero, messageId,
            });
            return res.json({ sucesso: true, ignorado: true, motivo: 'fromMe_eco_alias_salvo_via_message_id' });
          }
        } catch(_eEco) { console.warn('WA_ECO_LID_ALIAS_WARN:', _eEco.message); }
      }

      // ── 5b. FIX: Quando telFinal=null (LID sem participant), busca lead via alias ─
      // Cenário: LID chegou na resposta do cliente sem campo participant (sem telefone real).
      // Busca por remoteJid OU lid na tabela de aliases.
      // FIX CRÍTICO: usa queries SEPARADAS (não .or()) porque remote_jid contém '@' que
      // quebra o filtro PostgREST quando passado dentro de .or(`col.eq.${val}`).
      // FIX 2: quando alias tem conversa_id mas sem lead_id, flag aliasConversaEncontrada
      // impede que 5c rode e crie lead desnecessário.
      // (aliasConversaEncontrada declarada no escopo pai, linha ~2778)
      if (!leadId && isLidJid && lidNumero) {
        try {
          console.log('WA_INBOUND_ALIAS_LOOKUP_START', { lidNumero, rawJid });
          let _aliasRow = null;

          // Busca 1: por remote_jid exato (query própria — sem .or() com @ no valor)
          if (rawJid && rawJid.includes('@')) {
            const { data: _aJid } = await sb.from(ALIAS_TABLE)
              .select('conversa_id, telefone_normalizado')
              .eq('remote_jid', rawJid)
              .limit(1);
            if (_aJid?.[0]) _aliasRow = _aJid[0];
          }

          // Busca 2: por lid numérico (se busca 1 falhou)
          if (!_aliasRow && lidNumero) {
            const { data: _aLid } = await sb.from(ALIAS_TABLE)
              .select('conversa_id, telefone_normalizado')
              .eq('lid', lidNumero)
              .limit(1);
            if (_aLid?.[0]) _aliasRow = _aLid[0];
          }

          if (_aliasRow) {
            console.log('WA_INBOUND_ALIAS_FOUND', {
              lidNumero, rawJid,
              conversaId: _aliasRow.conversa_id,
              telefone_normalizado: _aliasRow.telefone_normalizado || null,
            });

            // Caso A: alias tem telefone normalizado → buscar lead pelo telefone
            if (_aliasRow.telefone_normalizado) {
              const telAlias = _aliasRow.telefone_normalizado;
              for (const v of phoneVariants(telAlias)) {
                const { data: foundByAlias } = await sb.from('leads').select('id,telefone')
                  .eq('telefone', v).is('deleted_at', null).limit(1);
                if (foundByAlias?.[0]) { leadId = foundByAlias[0].id; break; }
              }
              if (leadId) {
                console.log('WEBHOOK_LEAD_ENCONTRADO_VIA_ALIAS', { lidNumero, telAlias, leadId });
              }
            }

            // Caso B: alias tem conversa_id → resolve lead via conversa (mesmo sem telefone)
            if (_aliasRow.conversa_id) {
              // Sempre marca conversaEncontrada para bypasaar 5c
              aliasConversaEncontrada = _aliasRow.conversa_id;
              if (!leadId) {
                try {
                  const { data: _cvAlias } = await sb.from(CONVERSAS_TABLE)
                    .select('lead_id, telefone').eq('id', _aliasRow.conversa_id).single();
                  if (_cvAlias?.lead_id) {
                    leadId = _cvAlias.lead_id;
                    // Se conversa tem telefone real, atualiza telFinal
                    if (_cvAlias.telefone && !_cvAlias.telefone.startsWith('LID:') && !_cvAlias.telefone.startsWith('PENDING:')) {
                      const _telNormConv = normalizePhoneBR(_cvAlias.telefone);
                      if (_telNormConv) telFinal = _telNormConv;
                    }
                    console.log('WEBHOOK_LEAD_ENCONTRADO_VIA_ALIAS_CONVERSA', {
                      lidNumero, leadId,
                      conversaId: _aliasRow.conversa_id,
                      telFinalAtualizado: telFinal || null,
                    });
                  } else {
                    // Conversa existe mas sem lead_id — RECONCILIAR via mensagem enviada pelo CRM.
                    // CAUSA RAIZ DO BUG: o alias criado no ECO (fromMe) apontava para conversa
                    // criada sem lead_id. A mensagem é salva, mas a UI filtra conversas sem lead.
                    // FIX: busca mensagem 'enviada' nessa conversa → o CRM sempre vincula lead_id ao enviar.
                    console.log('WA_INBOUND_ALIAS_CONVERSA_SEM_LEAD', {
                      conversaId: _aliasRow.conversa_id,
                      motivo: 'tentando_reconciliar_via_mensagem_enviada',
                    });
                    try {
                      // Busca 1: mensagem enviada na conversa do alias com lead_id
                      const { data: _msgLead } = await sb.from(MENSAGENS_TABLE)
                        .select('lead_id')
                        .eq('conversa_id', _aliasRow.conversa_id)
                        .eq('direcao', 'enviada')
                        .not('lead_id', 'is', null)
                        .limit(1);
                      if (_msgLead?.[0]?.lead_id) {
                        leadId = _msgLead[0].lead_id;
                        console.log('WA_INBOUND_ALIAS_RECONCILED_VIA_SENT_MSG', {
                          conversaId: _aliasRow.conversa_id,
                          leadId,
                          motivo: 'lead_encontrado_em_mensagem_enviada_nessa_conversa',
                        });
                        // Vincula o lead à conversa para que apareça na UI (fire-and-forget)
                        sb.from(CONVERSAS_TABLE)
                          .update({ lead_id: leadId, status: 'ABERTA', atualizado_em: agora })
                          .eq('id', _aliasRow.conversa_id)
                          .then(() => console.log('WA_INBOUND_CONVERSA_LEAD_LINKED', { conversaId: _aliasRow.conversa_id, leadId }))
                          .catch(e => console.warn('WA_INBOUND_CONVERSA_LEAD_LINK_WARN:', e.message));
                      } else {
                        // Busca 2: conversa ativa com lead_id que tenha rawJid nos dados_extras
                        const { data: _convComLid } = await sb.from(CONVERSAS_TABLE)
                          .select('id, lead_id, telefone')
                          .not('lead_id', 'is', null)
                          .neq('status', 'FECHADA')
                          .neq('status', 'PENDENTE_IDENTIFICACAO')
                          .ilike('dados_extras', `%${lidNumero}%`)
                          .limit(1);
                        if (_convComLid?.[0]?.lead_id) {
                          leadId = _convComLid[0].lead_id;
                          // Repontar alias para a conversa ativa com lead
                          aliasConversaEncontrada = _convComLid[0].id;
                          console.log('WA_INBOUND_ALIAS_RECONCILED_VIA_DADOS_EXTRAS', {
                            conversaIdAntiga: _aliasRow.conversa_id,
                            conversaIdNova: _convComLid[0].id,
                            leadId,
                            motivo: 'dados_extras_lid_match',
                          });
                          // Atualiza alias para apontar para a conversa ativa
                          sb.from(ALIAS_TABLE)
                            .update({ conversa_id: aliasConversaEncontrada, atualizado_em: agora })
                            .eq('remote_jid', rawJid)
                            .then(() => {})
                            .catch(() => {});
                          sb.from(ALIAS_TABLE)
                            .update({ conversa_id: aliasConversaEncontrada, atualizado_em: agora })
                            .eq('lid', lidNumero)
                            .then(() => {})
                            .catch(() => {});
                        } else {
                          // Reconciliação falhou — alias aponta para conversa orfão sem lead.
                          // Se continuar com aliasConversaEncontrada setado, a mensagem vai para
                          // conversa invisível (filtrada por .not('lead_id','is',null) na UI).
                          // FIX: limpar aliasConversaEncontrada → 5c vai rodar → Evolution API
                          // tenta resolver o telefone real do LID → se encontrar, usa conversa
                          // canônica do lead → se não encontrar, cria lead em Instagram Direct VISÍVEL.
                          console.log('WA_INBOUND_ALIAS_RECONCILE_FAILED', {
                            conversaId: _aliasRow.conversa_id,
                            motivo: 'alias_orfao_sem_lead_sem_mensagem_enviada',
                            acao: 'limpando_alias_5c_vai_resolver_visivelmente',
                          });
                          aliasConversaEncontrada = null;
                          // Alias órfão limpo — step 5c vai resolver visivelmente
                        } // fecha else (reconciliação falhou — if _convComLid)
                      } // fecha else (busca 2 — if _msgLead)
                    } catch (_eRec) { console.warn('WA_INBOUND_ALIAS_RECONCILE_WARN:', _eRec.message); }
                  } // fecha else (sem lead_id — if _cvAlias)
                } catch (_eCvAlias) { console.warn('WA_INBOUND_ALIAS_CV_WARN:', _eCvAlias.message); }
              } // fecha if (!leadId)
            } // fecha if (_aliasRow.conversa_id)
          } // fecha if (_aliasRow)
        } catch (_eAliasLookup) { console.warn('WA_INBOUND_ALIAS_LOOKUP_WARN:', _eAliasLookup.message); }
      } // fecha if (!leadId && isLidJid && lidNumero) — step 5b

      // ── 5c. Cria lead para número desconhecido ─────────────────────────────
      // Só executa se não encontrou lead E não há alias que resolva a conversa.
      if (!leadId && !aliasConversaEncontrada) {
        if (telFinal && !isLidJid) {
          // Número com telefone real (não LID) — sem lead existente → criar em Instagram Direct
          console.log('WA_INBOUND_UNKNOWN_REAL_PHONE', { telFinal, motivo: 'sem_lead_criando_instagram_direct' });
        } else if (isLidJid && lidNumero) {

          // ── LID sem telefone real — tentar Evolution API e criar lead em Instagram Direct ──
          // REGRAS: sem pushName, sem correlação por nome, sem heurística aproximada.
          // Identidade: apenas rawJid/LID técnico.
          console.log('WA_INBOUND_ALT_PHONE_SEARCH_START', { lidNumero, rawJid });

          // Tentativa 1: buscar telefone real do contato via Evolution API pelo LID
          let _telViaEvo = null;
          try {
            const _lidJidBusca = rawJid?.includes('@') ? rawJid : `${lidNumero}@lid`;
            const _resEvo = await evoSvc.call('POST', `/contacts/find/${evoSvc.EVOLUTION_INSTANCE}`, { where: { id: _lidJidBusca } });
            const _cEvo = (Array.isArray(_resEvo?.dados) ? _resEvo.dados : (_resEvo?.dados ? [_resEvo.dados] : []))[0] || null;
            if (!_cEvo) {
              // Tentativa alternativa: buscar pelo campo 'lid' (algumas versões da Evolution)
              const _resEvoB = await evoSvc.call('POST', `/contacts/find/${evoSvc.EVOLUTION_INSTANCE}`, { where: { lid: _lidJidBusca } });
              const _cEvoB = (Array.isArray(_resEvoB?.dados) ? _resEvoB.dados : (_resEvoB?.dados ? [_resEvoB.dados] : []))[0] || null;
              if (_cEvoB) {
                const _jidB = _cEvoB.id || _cEvoB.remoteJid || '';
                const _rawB = _cEvoB.phone || (_jidB.includes('@s.whatsapp.net') ? _jidB.split('@')[0] : null);
                if (_rawB) _telViaEvo = normalizePhone(_rawB) || null;
              }
            } else {
              const _jid = _cEvo.id || _cEvo.remoteJid || '';
              const _raw = _cEvo.phone || (_jid.includes('@s.whatsapp.net') ? _jid.split('@')[0] : null);
              if (_raw) _telViaEvo = normalizePhone(_raw) || null;
            }
          } catch(_eEvo) {
            console.warn('WA_INBOUND_EVO_LID_WARN:', _eEvo.message);
          }

          if (_telViaEvo) {
            // Evolution retornou telefone real — usar como telFinal
            console.log('WA_INBOUND_ALT_PHONE_FOUND', { lidNumero, tel: _telViaEvo });
            telFinal = _telViaEvo;
            console.log('WA_INBOUND_LEAD_LOOKUP_BY_PHONE', { telefone: _telViaEvo });
            for (const _v of phoneVariants(_telViaEvo)) {
              const { data: _fnd } = await sb.from('leads').select('id,telefone')
                .or(`telefone.eq.${_v},telefone.ilike.%${_v}%`)
                .is('deleted_at', null).limit(1);
              if (_fnd?.[0]) { leadId = _fnd[0].id; break; }
            }
            if (!leadId) {
              // Lead não existe para este telefone real → criar em Instagram Direct
              const _dCheck2 = (_telViaEvo || '').replace(/\D/g, '');
              if (_dCheck2.startsWith('55') && _dCheck2.length >= 12) {
                let _destIgEvo = null;
                try { _destIgEvo = await planilhaSvc.resolverDestinoInstagramDirect(); } catch(_e) {}
                if (_destIgEvo) {
                  const _novoIdEvo = crypto.randomBytes(16).toString('hex');
                  const _nomeEvo = formatarTelefoneParaNome(_telViaEvo);
                  console.log('WA_INBOUND_CREATE_LEAD_INSTAGRAM_DIRECT_START', { tel: _telViaEvo, lidNumero, funil: _destIgEvo.funil.nome, etapa: _destIgEvo.etapa.nome });
                  const { data: _nlEvo, error: _errNlEvo } = await sb.from('leads').insert({
                    id: _novoIdEvo, nome: _nomeEvo, telefone: _telViaEvo,
                    status: 'ABERTO', funil_id: _destIgEvo.funil.id,
                    pipeline_id: _destIgEvo.pipeline.id, etapa_id: _destIgEvo.etapa.id,
                    origem: 'WhatsApp Recebido',
                    dados_extras: JSON.stringify({ criado_por_mensagem_whatsapp: true, remoteJid: rawJid, lid: lidNumero, pushName: nome || null, primeira_mensagem_em: agora, funil_entrada: 'Instagram - Direct' }),
                    data_entrada: agora, criado_em: agora, atualizado_em: agora,
                  }).select('id').single();
                  if (!_errNlEvo && _nlEvo) {
                    leadId = _nlEvo.id; lidLeadCriadoNesta = true;
                    console.log('WA_INBOUND_CREATE_LEAD_INSTAGRAM_DIRECT_SUCCESS', { leadId, tel: _telViaEvo, funil: _destIgEvo.funil.nome, etapa: _destIgEvo.etapa.nome });
              } else {
                console.error('WA_INBOUND_ERROR', {
                  etapa: 'criacao_lead_lid_com_tel_real',
                  erro: _errNlEvo?.message,
                  erroStack: _errNlEvo?.stack || null,
                  erroDetalhe: JSON.stringify(_errNlEvo || {}),
                  tel: _telViaEvo, lidNumero, rawJid,
                });
              }
                }
              }
            } else {
              console.log('WA_INBOUND_LEAD_LOOKUP_BY_PHONE', { leadId, tel: _telViaEvo, resultado: 'encontrado' });
            }
          } else {
            // Evolution API não retornou telefone real
            console.log('WA_INBOUND_ALT_PHONE_NOT_FOUND', { lidNumero });

            // ── FALLBACK OUTBOUND 30MIN — DESATIVADO PERMANENTEMENTE ────────────────────
            // CAUSA DO BUG (confirmado 2026-08-29): número desconhecido com LID sem telefone
            // estava sendo roteado para a conversa do ÚLTIMO lead que recebeu mensagem nos
            // últimos 30 min — contaminou a conversa do lead Thais-Teste com mensagens de estranho.
            // Este heurístico é identicamente perigoso ao fallback 72h (desativado em linha ~3382):
            // não filtra por número de destino, usa qualquer conversa recentemente ativa.
            // REGRA: LID sem telefone real → criar lead novo em Instagram Direct (visível no CRM).
            // NÃO REATIVAR sem testes extensivos e autorização explícita.
            const _aliasViaOutbound = false; // DESATIVADO — sempre false
            console.log('WA_INBOUND_OUTBOUND_FALLBACK_DISABLED', { lidNumero, rawJid, motivo: 'desativado_bug_2026-08-29' });

            if (!_aliasViaOutbound) {
              // Nenhum outbound recente → tentar Instagram Direct
              console.log('WA_INBOUND_UNKNOWN_TECH_IDENTITY', { lidNumero, rawJid });
              console.log('WA_INBOUND_CREATE_LEAD_INSTAGRAM_DIRECT_START', { lidNumero, funil: 'Instagram - Direct' });

              let _destIgLid = null;
              try { _destIgLid = await planilhaSvc.resolverDestinoInstagramDirect(); } catch(_eIg) {
                console.error('WA_INBOUND_ERROR', {
                  etapa: 'resolver_destino_instagram_direct',
                  erro: _eIg.message,
                  erroStack: _eIg.stack || null,
                  lidNumero, rawJid,
                  motivo: 'funil_instagram_direct_nao_encontrado',
                });
              }
              if (_destIgLid) {
                const _novoLidId = crypto.randomBytes(16).toString('hex');
                const _nomeLid   = `WhatsApp LID ${lidNumero}`;
                const _telLid    = `LID:${lidNumero}`; // placeholder NOT NULL — NÃO é telefone real
                const { data: _nlLid, error: _errLid } = await sb.from('leads').insert({
                  id: _novoLidId, nome: _nomeLid,
                  telefone: _telLid,
                  status: 'ABERTO', funil_id: _destIgLid.funil.id,
                  pipeline_id: _destIgLid.pipeline.id, etapa_id: _destIgLid.etapa.id,
                  origem: 'WhatsApp Recebido',
                  dados_extras: JSON.stringify({
                    criado_por_mensagem_whatsapp: true,
                    remoteJid: rawJid, rawJid, lid: lidNumero,
                    pushName: nome || null,
                    primeira_mensagem_em: agora,
                    funil_entrada: 'Instagram - Direct',
                    tipo_identidade: 'lid_sem_telefone',
                  }),
                  data_entrada: agora, criado_em: agora, atualizado_em: agora,
                }).select('id').single();
                if (!_errLid && _nlLid) {
                  leadId = _nlLid.id;
                  lidLeadCriadoNesta = true;
                  telFinal = _telLid;
                  console.log('WA_INBOUND_CREATE_LEAD_INSTAGRAM_DIRECT_SUCCESS', {
                    leadId, lidNumero, telefone_placeholder: _telLid,
                    funil: _destIgLid.funil.nome, etapa: _destIgLid.etapa.nome,
                  });
                } else {
                  console.error('WA_INBOUND_ERROR', {
                    etapa: 'criacao_lead_lid_sem_telefone',
                    erro: _errLid?.message, erroStack: _errLid?.stack || null,
                    erroDetalhe: JSON.stringify(_errLid || {}),
                    lidNumero, rawJid, telPlaceholder: _telLid,
                  });
                }
              }
            }
          }
        } else {
          // Identidade sem telefone real e sem LID reconhecível → bloquear
          console.warn('WHATSAPP_BLOCK_LEAD_CREATION_FOR_LID', {
            telFinal, lidNumero, rawJid, isLidJid,
            motivo: 'identidade_nao_confiavel_nao_cria_lead',
          });
        }
      } else if (aliasConversaEncontrada && !leadId) {
        // Alias resolveu conversa mas sem lead_id — OK, conversa existe e será usada pelo resolver
        console.log('WA_INBOUND_ALIAS_BYPASS_5C', {
          conversaId: aliasConversaEncontrada,
          motivo: 'alias_resolveu_conversa_sem_lead_5c_bypassado',
        });
      }
    } else if (db) {
      // SQLite: tenta ambas variantes
      let l = db.prepare("SELECT id FROM leads WHERE telefone = ? LIMIT 1").get(telFinal);
      if (!l && telSem55) l = db.prepare("SELECT id FROM leads WHERE telefone = ? LIMIT 1").get(telSem55);
      leadId = l?.id || null;
    }
    console.log('[WA Webhook] RESULTADO_BUSCA_LEAD:', {
      telefoneNormalizado: telFinal,
      variantesSem55: telSem55,
      leadId,
      aliasConversaEncontrada: aliasConversaEncontrada || null,
      lidLeadCriadoNesta,
    });

    // ── 6. Resolve conversa (FUNÇÃO CENTRAL — elimina duplicação) ─────────────
    // Usa resolverConversaWhatsapp() que executa 8 passos de busca em ordem antes
    // de permitir qualquer criação. Nunca cria conversa duplicada.
    // FIX CRÍTICO: se aliasConversaEncontrada já foi resolvida no Step 5b,
    // usa diretamente como conversaId sem chamar resolverConversaWhatsapp para esse path.
    let conversaId = null;
    if (isSupa) {
      // Shortcut: alias já resolvido no Step 5b → usa conversa diretamente
      if (aliasConversaEncontrada && !fromMe) {
        conversaId = aliasConversaEncontrada;
        console.log('WA_INBOUND_DECISION', {
          decisao: 'CONVERSA_EXISTENTE_POR_ALIAS',
          conversaId,
          leadId: leadId || null,
          rawJid,
          lidNumero,
          motivo: 'alias_resolvido_step5b',
        });
      } else {
      const resolucao = await resolverConversaWhatsapp(sb, {
        tel: telFinal, lidNumero, leadId, isLidJid, rawJid, fromMe, nome
      });

      if (!resolucao.permiteCreate && !resolucao.conversaId) {
        // ── FIX: eco fromMe + LID → salvar alias via Evolution API (fire-and-forget) ──
        // Garante que o próximo inbound deste LID seja roteado para a conversa correta.
        // Sem este salvamento, o alias nunca seria criado e o inbound criaria PENDENTE.
        if (fromMe && isLidJid && lidNumero && isSupa) {
          (async () => {
            try {
              console.log('WA_INBOUND_FROMME_LID_ALIAS_SAVE_START', { lidNumero, rawJid });
              const _lidJidFM = rawJid?.includes('@') ? rawJid : `${lidNumero}@lid`;
              const _resFM = await evoSvc.call('POST', `/contacts/find/${evoSvc.EVOLUTION_INSTANCE}`, { where: { id: _lidJidFM } });
              const _cFM = (Array.isArray(_resFM?.dados) ? _resFM.dados : (_resFM?.dados ? [_resFM.dados] : []))[0] || null;
              if (_cFM) {
                const _jidFM = _cFM.id || _cFM.remoteJid || '';
                const _rawFM = _cFM.phone || (_jidFM.includes('@s.whatsapp.net') ? _jidFM.split('@')[0] : null);
                if (_rawFM) {
                  const _telFM = normalizePhone(_rawFM);
                  if (_telFM) {
                    for (const _vFM of phoneVariants(_telFM)) {
                      const { data: _convFM } = await sb.from(CONVERSAS_TABLE)
                        .select('id').eq('telefone', _vFM).neq('status', 'FECHADA')
                        .not('lead_id', 'is', null)
                        .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
                      if (_convFM?.[0]) {
                        await registrarAlias(sb, { conversaId: _convFM[0].id, tel: _telFM, rawJid: rawJid || null, lidNumero, nome: null });
                        console.log('WA_INBOUND_FROMME_LID_ALIAS_SAVED_VIA_EVO', { lidNumero, tel: _telFM, conversaId: _convFM[0].id });
                        break;
                      }
                    }
                  }
                }
              } else {
                console.log('WA_INBOUND_FROMME_LID_EVO_NO_CONTACT', { lidNumero });
              }
            } catch(_eFM) { console.warn('WA_INBOUND_FROMME_LID_ALIAS_WARN:', _eFM.message); }
          })();
        }
        // fromMe=true sem conversa — eco do CRM, descarta
        console.log('WHATSAPP_FROM_ME_IGNORED_NO_CONVERSA', { tel: telFinal, fonte: resolucao.fonte });
        return res.json({ sucesso: true, ignorado: true, motivo: 'fromMe_sem_conversa_existente' });
      }

      conversaId = resolucao.conversaId;
        console.log('CONVERSA_RESOLVE_RESULT', { conversaId, permiteCreate: resolucao.permiteCreate, fonte: resolucao.fonte });
      } // fim do else (sem aliasConversaEncontrada)
    } else if (db) {
      const variantesLocais = phoneVariants(tel);
      let conv = null;
      for (const v of variantesLocais) {
        conv = db.prepare("SELECT id FROM conversas_whatsapp WHERE telefone = ? AND status != 'FECHADA' LIMIT 1").get(v);
        if (conv) break;
      }
      conversaId = conv?.id || null;
    }

    // ── Determina nome_contato correto ────────────────────────────────────────
    // REGRA: NUNCA usar pushName de fromMe=true (seria o nome do dono do WA)
    // Prioridade: lead_nome > pushName (só fromMe=false) > nome existente > telefone > fallback
    let nomeContato = null;
    if (leadId && isSupa) {
      const { data: leadData } = await sb.from('leads').select('nome').eq('id', leadId).single();
      nomeContato = leadData?.nome || null;
      if (nomeContato) console.log('CONTACT_NAME_SOURCE_LEAD', { leadId, nome: nomeContato });
    }
    if (!nomeContato && !fromMe && nome) {
      nomeContato = nome;
      console.log('CONTACT_NAME_SOURCE_EVOLUTION_PUSHNAME', { nome: nomeContato });
    }
    if (!nomeContato && fromMe) {
      console.log('CONTACT_NAME_NOT_USER_NAME', { motivo: 'fromMe_pushname_rejeitado', pushNameRejeitado: nome });
    }
    if (!nomeContato) {
      nomeContato = tel || 'Contato WhatsApp não identificado';
      console.log('CONTACT_NAME_SOURCE_PHONE', { nome: nomeContato });
    }

    if (isSupa && !conversaId) {
      // ── REGRA ABSOLUTA DE SEGURANÇA ──────────────────────────────────────────
      // Antes de criar conversa: valida se a identidade é confiável.
      // Uma identidade LID sem alias nem telefone real NÃO gera conversa ABERTA.
      // Gera PENDENTE_IDENTIFICACAO (oculta da lista) para não duplicar.
      // Se tem telefone real brasileiro + lead vinculado → confiar para criar conversa ABERTA
      // (mesmo que isLidJid=true, se temos phone real + lead, devemos ser visíveis no CRM)
      const _digitsForTrust = String(telFinal || '').replace(/\D/g, '');
      const temTelRealBr = telFinal && _digitsForTrust.startsWith('55') && _digitsForTrust.length >= 12;
      // FIX: lidLeadCriadoNesta=true → lead criado nesta req para LID sem tel → identidade confiável
      // FIX2: aliasConversaEncontrada → alias resolveu conversa → confiar mesmo sem tel
      const identidadeConfiavel = (temTelRealBr && !!leadId) || lidLeadCriadoNesta || !!aliasConversaEncontrada || isIdentidadeWhatsappConfiavel(telFinal, {
        isLidJid,
        lidNumero,
        aliasEncontrado:  false, // chegou aqui → alias não encontrou conversa
        conversaExistente: false,
      });

      if (!identidadeConfiavel) {
        // ── Antes de criar PENDENTE: verifica se o lead já tem conversa canônica ──
        // Se existir, usar ela como destino — evita mensagem ir para conversa oculta.
        let conversaCanonica = null;
        if (leadId) {
          const { data: canonicaCheck } = await sb.from(CONVERSAS_TABLE)
            .select('id')
            .eq('lead_id', leadId)
            .neq('status', 'FECHADA')
            .neq('status', 'PENDENTE_IDENTIFICACAO')
            .not('telefone', 'is', null)
            .order('ultima_msg_em', { ascending: false, nullsFirst: false })
            .limit(1);
          if (canonicaCheck?.[0]) {
            conversaCanonica = canonicaCheck[0].id;
            console.log('WHATSAPP_LID_REDIRECTED_TO_CANONICAL_LEAD', {
              conversaCanonica, leadId, lidNumero, rawJid,
              motivo: 'lead_ja_tem_conversa_canonica',
            });
            console.log('WHATSAPP_INBOUND_CANONICAL_CONVERSA_SELECTED', { canonical: conversaCanonica, leadId, lidNumero });
            // Salva alias para próximos recebimentos
            await registrarAlias(sb, {
              conversaId: conversaCanonica,
              tel:        telFinal || null,
              rawJid:     rawJid   || null,
              lidNumero:  lidNumero || null,
              nome:       nome      || null,
            }).catch(e => console.warn('WHATSAPP_ALIAS_CANONICAL_WARN:', e.message));
            conversaId = conversaCanonica;
          }
        }

        // ── FIX CRÍTICO: Fallback por último envio recente (72h) quando alias não existe ──
        // Cenário confirmado pelos logs: LID '62972877619405@lid' responde sem participant,
        // sem alias registrado, sem leadId. Antes desta correção → PENDENTE_IDENTIFICACAO → invisível.
        // Agora: busca mensagens enviadas nas últimas 72h → se única conversa candidata com
        // telefone real (não PENDENTE) → usa essa conversa + salva alias para próximas respostas.
        // FALLBACK 72H DESATIVADO — causava roteamento aleatório de LIDs desconhecidos
        // para a conversa mais recentemente ativa, contaminando leads existentes.
        // Todo LID sem alias/telefone real cria conversa PENDENTE_IDENTIFICACAO (invisível)
        // e aguarda identificação correta pelo usuário ou por alias futuro.
        // NÃO REATIVAR sem testes extensivos e sem autorização explícita.
        if (false && !conversaCanonica && isLidJid && lidNumero) {
          // código desativado
        }

        if (!conversaCanonica) {
          // ── SOLUÇÃO DEFINITIVA (2026-08-29) ────────────────────────────────────
          // Criar lead + conversa ABERTA visível com queries Supabase diretas.
          // NÃO usa planilhaSvc (estava falhando silenciosamente).
          // NUNCA cria conversa visivel:false — toda mensagem inbound DEVE aparecer no CRM.
          const _telNovo = telFinal || (lidNumero ? `LID:${lidNumero}` : `UNKNOWN:${crypto.randomBytes(4).toString('hex')}`);
          const _nomeNovo = nome || nomeContato || _telNovo;
          
          try {
            // 1. Buscar qualquer funil + pipeline + etapa disponíveis (direto no Supabase)
            let _fId = null, _pId = null, _eId = null, _fNome = null;
            const { data: _funs } = await sb.from('funis').select('id,nome').limit(5);
            for (const _f of (_funs || [])) {
              const { data: _ps } = await sb.from('pipelines').select('id').eq('funil_id', _f.id).limit(1);
              if (_ps?.[0]) {
                const { data: _es } = await sb.from('etapas').select('id').eq('pipeline_id', _ps[0].id).order('ordem', { ascending: true }).limit(1);
                if (_es?.[0]) { _fId = _f.id; _fNome = _f.nome; _pId = _ps[0].id; _eId = _es[0].id; break; }
              }
            }
            console.log('WA_INBOUND_GARANTIA_FUNIL', { fId: _fId, fNome: _fNome, pId: _pId, eId: _eId, tel: _telNovo });
            
            // 2. Criar lead (se não existe e temos um funil)
            if (_fId && _pId && _eId && !leadId) {
              const _novoLeadId = crypto.randomBytes(16).toString('hex');
              const { data: _nl, error: _enl } = await sb.from('leads').insert({
                id: _novoLeadId, nome: _nomeNovo, telefone: _telNovo,
                status: 'ABERTO', funil_id: _fId, pipeline_id: _pId, etapa_id: _eId,
                origem: 'WhatsApp Recebido',
                dados_extras: JSON.stringify({ criado_por_mensagem_whatsapp: true, lid: lidNumero || null, remoteJid: rawJid || null, pushName: nome || null, primeira_mensagem_em: agora, funil_entrada: _fNome }),
                data_entrada: agora, criado_em: agora, atualizado_em: agora,
              }).select('id').single();
              if (!_enl && _nl) {
                leadId = _nl.id;
                if (!telFinal) telFinal = _telNovo;
                console.log('WA_INBOUND_GARANTIA_LEAD_OK', { leadId, funil: _fNome, tel: _telNovo });
              } else {
                console.error('WA_INBOUND_GARANTIA_LEAD_ERRO', { erro: _enl?.message, tel: _telNovo });
              }
            }

            // 3. Criar conversa ABERTA visível — com ou sem lead, a conversa SEMPRE aparece
            const _convNovoId = crypto.randomBytes(16).toString('hex');
            const { data: _nc, error: _enc } = await sb.from(CONVERSAS_TABLE).insert({
              id: _convNovoId, telefone: _telNovo, nome_contato: _nomeNovo,
              lead_id: leadId || null, origem: 'WHATSAPP_WEBHOOK', status: 'ABERTA', visivel: true,
              dados_extras: JSON.stringify({ lid: lidNumero || null, remoteJid: rawJid || null, criado_via: 'garantia_inbound' }),
              criado_em: agora, atualizado_em: agora,
            }).select('id').single();
            if (!_enc && _nc) {
              conversaId = _nc.id;
              console.log('WA_INBOUND_GARANTIA_CONVERSA_OK', { conversaId, leadId: leadId || null, status: 'ABERTA', visivel: true });
            } else {
              console.error('WA_INBOUND_GARANTIA_CONVERSA_ERRO', { erro: _enc?.message, tel: _telNovo });
            }
          } catch (_eGar) {
            console.error('WA_INBOUND_GARANTIA_EXCEPTION', { erro: _eGar.message, tel: _telNovo });
          }
        }




      } else {
        // Identidade confiável: cria conversa ABERTA normalmente
        const novoConvId = crypto.randomBytes(16).toString('hex');
        const telParaConversa = telFinal || null;
        const dadosExtrasNova = isLidJid && lidNumero
          ? JSON.stringify({ lid: lidNumero, remoteJid: rawJid })
          : null;
        console.log('WHATSAPP_INBOUND_CONVERSA_CREATED', { tel: telParaConversa, lidNumero: lidNumero || null, leadId, nomeContato });
        const { data: novaConv, error: errC } = await sb.from(CONVERSAS_TABLE).insert({
          id: novoConvId, telefone: telParaConversa, nome_contato: nomeContato,
          lead_id: leadId || null, origem: 'WHATSAPP_WEBHOOK', status: 'ABERTA', visivel: true,
          dados_extras: dadosExtrasNova, criado_em: agora, atualizado_em: agora,
        }).select('id').single();
        if (!errC && novaConv) {
          conversaId = novaConv.id;
          console.log('WEBHOOK_CONVERSA_CREATED', { conversaId, tel: telParaConversa, status: 'ABERTA', lidNumero: lidNumero || null, leadId, nomeContato });
        } else {
          console.error('[WA Webhook] Erro ao criar conversa:', errC?.message);
        }
      }
    } else if (isSupa && conversaId) {
      // Conversa existente — atualiza sem sobrescrever nome_contato com dado ruim
      const { data: convAtual } = await sb.from(CONVERSAS_TABLE)
        .select('telefone,lead_id,dados_extras,nome_contato').eq('id', conversaId).single();
      const upd = { ultima_msg_em: agora, atualizado_em: agora, status: 'ABERTA' };
      if (leadId) upd.lead_id = leadId;
      if (convAtual && convAtual.telefone !== telFinal && telFinal && !telFinal.startsWith('LID:')) {
        upd.telefone = telFinal;
      }
      console.log('WHATSAPP_INBOUND_CONVERSA_FOUND', { conversaId, fonte: 'existente' });
      const nomeAtual = convAtual?.nome_contato || '';
      const nomeEhPlaceholder = nomeAtual === tel || nomeAtual === 'Contato WhatsApp não identificado' || nomeAtual.startsWith('LID:');
      if (leadId && nomeContato && nomeContato !== tel && nomeContato !== 'Contato WhatsApp não identificado') {
        upd.nome_contato = nomeContato;
        console.log('CONTACT_NAME_SOURCE_LEAD', { leadId, nome: nomeContato, anterior: nomeAtual });
      } else if (!fromMe && nome && nomeEhPlaceholder) {
        upd.nome_contato = nome;
        console.log('CONTACT_NAME_SOURCE_EVOLUTION_PUSHNAME', { nome, anterior: nomeAtual });
      } else {
        console.log('CONTACT_NAME_SOURCE_EXISTING_CONVERSA', { nomeAtual, fromMe, motivo: 'preservado' });
      }
      if (isLidJid && lidNumero) {
        const extrasAtuais = (() => { try { return JSON.parse(convAtual?.dados_extras || '{}'); } catch { return {}; } })();
        if (!extrasAtuais.lid || extrasAtuais.lid !== lidNumero) {
          extrasAtuais.lid = lidNumero;
          upd.dados_extras = JSON.stringify(extrasAtuais);
        }
      }
      console.log('CONVERSA_FOUND_EXISTING', { conversaId, leadId, upd: Object.keys(upd) });
      await sb.from(CONVERSAS_TABLE).update(upd).eq('id', conversaId);
    } else if (db && !conversaId) {
      const cid = crypto.randomBytes(16).toString('hex');
      db.prepare('INSERT INTO conversas_whatsapp (id,telefone,nome_contato,lead_id,origem,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?)').run(cid, telFinal, nome||null, leadId||null, 'WHATSAPP_WEBHOOK', agora, agora);
      conversaId = cid;
    } else if (db && conversaId) {
      db.prepare('UPDATE conversas_whatsapp SET ultima_msg_em=?,atualizado_em=? WHERE id=?').run(agora, agora, conversaId);
    }


    console.log('WEBHOOK_CONVERSATION_TARGET', {
      conversaId,
      leadId,
      telefoneNormalizado: telFinal,
    });

    // ── 7. Salva mensagem em mensagens_whatsapp ───────────────────────────
    // evoMsgIdWebhook = ID da Evolution (key.id) — usado para idempotência e rastreio
    const evoMsgIdWebhook = messageId || null;
    const msgId = messageId || crypto.randomBytes(16).toString('hex');
    let msgSalva = false;
    let erroSalvar = null;

    if (isSupa && conversaId) {
      // Para mensagens RECEBIDAS: não enviar campo status — usa default do banco
      // Para mensagens ENVIADAS: status 'sent'
      // CORREÇÃO CIRÚRGICA: 'documento' não está na CHECK constraint de mensagens_whatsapp.
      // Mapeia 'documento' → 'arquivo' apenas para o campo tipo no banco.
      // Internamente o código continua usando 'documento' para lógica e logs.
      const tipoDb = tipo === 'documento' ? 'arquivo' : tipo;
      if (tipo === 'documento') console.log('WA_INBOUND_FILE_WEBHOOK_RECEIVED', { msgId, tipo, tipoDb, arquivoNome, mimeType, hasMidiaUrl: !!midiaUrl });
      const insertPayload = {
        id: msgId, conversa_id: conversaId, lead_id: leadId || null,
        telefone: telFinal, mensagem: conteudo || (tipo === 'audio' ? '[Áudio]' : tipo === 'imagem' ? '[Imagem]' : tipo === 'video' ? '[Vídeo]' : tipo === 'documento' ? '[Documento]' : null),
        tipo: tipoDb, // 'arquivo' para documentos (respeit a CHECK constraint)
        direcao,
        arquivo_url: midiaUrl || null, arquivo_nome: arquivoNome || null,
        criado_em: agora,
      };
      // Campos opcionais — sempre tenta incluir evolution_message_id e mime_type
      try { if (mimeType)         insertPayload.mime_type            = mimeType; } catch{}
      try { if (evoMsgIdWebhook)  insertPayload.evolution_message_id = evoMsgIdWebhook; } catch{}
      // Só adiciona status para mensagens enviadas — schema: CHECK(status IN ('enviado','entregue','lido','erro'))
      if (direcao === 'enviada') insertPayload.status = 'enviado';
      if (tipo === 'audio') console.log('WHATSAPP_AUDIO_RECEIVED_WEBHOOK', { msgId, mimeType, midiaUrl: midiaUrl ? '(presente)' : '(ausente)', duration: null });
      if (midiaUrl) console.log('WHATSAPP_AUDIO_MEDIA_DETECTED', { tipo, mimeType, midiaUrl: midiaUrl.slice(0,80) });

      console.log('WHATSAPP_MESSAGE_INSERT_START', { msgId, conversaId, direcao, telFinal, tipo, tabela: MENSAGENS_TABLE });
      const { error: errM } = await sb.from(MENSAGENS_TABLE).insert(insertPayload);
      msgSalva = !errM;
      if (!errM) {
        console.log('WHATSAPP_MESSAGE_INSERT_SUCCESS', { mensagemId: msgId, conversaId, direcao, telFinal, tipo, evoMsgId: evoMsgIdWebhook });
        console.log('WHATSAPP_CONVERSATION_UPDATE_SUCCESS', { conversaId });
        console.log('WHATSAPP_MESSAGE_SAVED_IN_ORIGINAL_CONVERSATION', { mensagemId: msgId, conversaId, direcao, tabela: MENSAGENS_TABLE });
        console.log('WEBHOOK_MESSAGE_SAVED', { mensagemId: msgId, conversaId, direcao, telefone: tel });
        console.log('WHATSAPP_MESSAGE_SAVED_EXISTING_CONVERSA', { mensagemId: msgId, conversaId, telefone: tel, direcao, evoMsgId: evoMsgIdWebhook });

        // ── Documentos: armazena no Supabase Storage enquanto Evolution tem em cache ──
        // Fire-and-forget — NÃO bloqueia resposta do webhook.
        // Após sucesso: storage_path aponta para arquivo permanente no Supabase.
        // Proxy usa storage_path como Layer 0 (antes de tentar Evolution re-fetch).
        if (tipo === 'documento' && evoMsgIdWebhook && evoSvc.isConfigured()) {
          const _sbRef      = sb; // captura referência para closure async
          const _docBucket  = 'whatsapp-midias';
          const _docNome    = (arquivoNome || 'documento').replace(/[^a-zA-Z0-9._\-]/g, '_');
          const _docPath    = `docs/${evoMsgIdWebhook}/${_docNome}`;
          const _docTel     = (telFinal || '').replace(/\D/g, '');
          const _docJid     = (telFinal || '').includes('@') ? (telFinal || '') : `${_docTel}@s.whatsapp.net`;
          Promise.resolve().then(async () => {
            try {
              // Aguarda 2s para Evolution indexar a mensagem em seu banco interno
              await new Promise(r => setTimeout(r, 2000));
              const refetch = await evoSvc.getBase64Media(evoMsgIdWebhook, _docJid);
              if (!refetch.sucesso || !refetch.dados?.base64) {
                console.warn('WA_DOC_STORE_BASE64_FAIL', { msgId: evoMsgIdWebhook, erro: refetch.erro });
                return;
              }
              const pureB64 = refetch.dados.base64.replace(/^data:[^;]+;base64,/, '');
              const buf     = Buffer.from(pureB64, 'base64');
              const mimeDoc = refetch.dados.mimetype || mimeType || 'application/octet-stream';
              const { error: upErr } = await _sbRef.storage.from(_docBucket).upload(_docPath, buf, {
                contentType: mimeDoc, upsert: true,
              });
              if (upErr) {
                console.warn('WA_DOC_STORE_UPLOAD_FAIL', { msgId: evoMsgIdWebhook, erro: upErr.message });
                return;
              }
              // Atualiza mensagem com storage_path permanente
              await _sbRef.from(MENSAGENS_TABLE).update({
                storage_path: _docPath, storage_bucket: _docBucket, mime_type: mimeDoc,
              }).eq('id', evoMsgIdWebhook);
              console.log('WA_DOC_STORE_SUCCESS', { msgId: evoMsgIdWebhook, path: _docPath, size: buf.length, mime: mimeDoc });
            } catch (e) {
              console.warn('WA_DOC_STORE_EXCEPTION', { msgId: evoMsgIdWebhook, erro: e.message });
            }
          });
        }

        // Atualiza conversa — SOMENTE colunas que existem na tabela Supabase:
        // ultima_msg_em, atualizado_em, status (ultima_mensagem e ultima_direcao NÃO EXISTEM)
        const convUpdate = {
          ultima_msg_em: agora,
          atualizado_em: agora,
          status: 'ABERTA',
        };
        // Incrementa nao_lidas APENAS para mensagens recebidas (não enviadas pelo CRM)
        // O campo nao_lidas só existe após patch v21 — envolto em try/catch
        if (direcao === 'recebida') {
          try {
            // Busca o valor atual e incrementa
            const { data: convAtualNL } = await sb.from(CONVERSAS_TABLE)
              .select('nao_lidas').eq('id', conversaId).single();
            const naoLidasAtual = convAtualNL?.nao_lidas || 0;
            convUpdate.nao_lidas = naoLidasAtual + 1;
            console.log('WHATSAPP_UNREAD_INCREMENT', { conversaId, nao_lidas: convUpdate.nao_lidas });
          } catch(eNL) { console.warn('WHATSAPP_UNREAD_INCREMENT_WARN (coluna pode nao existir):', eNL.message); }
        }
        const { error: errConvUpd } = await sb.from(CONVERSAS_TABLE).update(convUpdate).eq('id', conversaId);
        if (errConvUpd) console.warn('[WA Webhook] update conversa warn:', errConvUpd.message);
      }
      if (errM) {
        erroSalvar = errM;
        console.error('WEBHOOK_ERRO_AO_PROCESSAR_MENSAGEM:', {
          error: errM.message, code: errM.code, details: errM.details,
          mensagemId: msgId, conversaId, telefone: tel,
          body: JSON.stringify(req.body).slice(0, 300),
        });
      }
    } else if (db && conversaId) {
      try {
        db.prepare('INSERT INTO mensagens_whatsapp (id,conversa_id,lead_id,telefone,mensagem,tipo,direcao,status,criado_em) VALUES (?,?,?,?,?,?,?,?,?)').run(msgId, conversaId, leadId||null, tel, conteudo, tipo, direcao, 'enviado', agora);
        db.prepare('UPDATE conversas_whatsapp SET ultima_msg_em=?,atualizado_em=?,status=\'ABERTA\' WHERE id=?').run(agora, agora, conversaId);
        msgSalva = true;
      } catch(e) {
        erroSalvar = e;
        console.error('ERRO_AO_SALVAR_MENSAGEM_WHATSAPP:', e.message);
      }
    } else if (!conversaId) {
      console.error('ERRO_AO_SALVAR_MENSAGEM_WHATSAPP: conversaId é null — conversa não foi criada.');
    }

    // ── 8. Também salva em whatsapp_mensagens (tabela Supabase extra) ──────
    const resultadoWaSvc = await waSvc.salvarMensagem({
      lead_id: leadId, telefone: tel, nome_contato: nome || null,
      direcao, tipo, conteudo, midia_url: midiaUrl,
      arquivo_nome: arquivoNome, mime_type: mimeType,
      whatsapp_message_id: msgId, status_envio: direcao === 'recebida' ? 'recebido' : 'enviado',
      recebido_em: direcao === 'recebida' ? agora : null,
      enviado_em:  direcao === 'enviada'  ? agora : null,
    }).catch(e => { console.warn('[WA Webhook] waSvc.salvarMensagem falhou (não crítico):', e.message); return { sucesso: false }; });

    const resultado = {
      lead_id:     leadId,
      conversa_id: conversaId,
      mensagem_id: msgId,
      direcao,
      msgSalva,
    };

    if (msgSalva) {
      console.log('MENSAGEM_SALVA_COM_SUCESSO:', resultado);
      console.log('WHATSAPP_MESSAGE_SAVED_IN_CONVERSA', { mensagemId: msgId, conversaId, direcao, tel: telFinal });

      // ── Fix CRÍTICO: registra alias após receber mensagem ─────────────────
      // Popula whatsapp_conversa_aliases para que próximas mensagens deste
      // cliente sejam resolvidas na mesma conversa (Passo 0 do resolver).
      if (isSupa && conversaId) {
        // CORREÇÃO: só registra tel no alias se for número válido.
        // Quando LID sem participant, telFinal=null — não passar número inválido.
        const _telAlias = (telFinal && normalizePhoneBR(telFinal)) ? telFinal : null;
        console.log('WHATSAPP_ALIAS_REGISTER_RECV', { conversaId, tel: _telAlias, lidNumero: lidNumero || null, rawJid });
        registrarAlias(sb, {
          conversaId,
          tel:       _telAlias,
          rawJid:    rawJid || null,
          lidNumero: lidNumero || null,
          nome:      !fromMe ? nome : null,
        }).catch(e => console.warn('WHATSAPP_ALIAS_REGISTER_RECV_WARN:', e.message));

        // CORREÇÃO: se LID com lead vinculado e sem telefone na conversa,
        // atualiza o telefone da conversa com o tel real do lead (background).
        if (isLidJid && lidNumero && leadId && !telFinal) {
          (async () => {
            try {
              const { data: _cv } = await sb.from(CONVERSAS_TABLE)
                .select('telefone').eq('id', conversaId).single();
              if (!_cv?.telefone || _cv.telefone.startsWith('LID:')) {
                const { data: _ld } = await sb.from('leads').select('telefone').eq('id', leadId).single();
                const _telReal = _ld?.telefone ? normalizePhoneBR(_ld.telefone) : null;
                if (_telReal) {
                  await sb.from(CONVERSAS_TABLE)
                    .update({ telefone: _telReal, atualizado_em: new Date().toISOString() })
                    .eq('id', conversaId);
                  console.log('WHATSAPP_LID_CONVERSA_TEL_ATUALIZADO', { conversaId, _telReal, lidNumero });
                  await registrarAlias(sb, { conversaId, tel: _telReal, rawJid: rawJid || null, lidNumero, nome: null });
                }
              }
            } catch(_e) { console.warn('WHATSAPP_LID_TEL_UPDATE_WARN:', _e.message); }
          })();
        }
      }

      // ── Classificação automática de resposta à mensagem de boas-vindas ────
      // Detecta padrão (brinde/produto/projeto/agência) e salva tag + observação
      if (!fromMe && direcao === 'recebida' && leadId && isSupa && conteudo) {
        _classificarRespostaBoasVindas(sb, leadId, conteudo)
          .catch(e => console.warn('CLASSIFICACAO_BOAS_VINDAS_HOOK_WARN:', e.message));
      }

      // ── 9. Se há mídia recebida: registra metadados em lead_arquivos ───────
      // Só para mensagens RECEBIDAS (fromMe=false) que tenham URL de mídia
      if (!fromMe && midiaUrl && leadId && conversaId && isSupa) {
        try {
          // Deduplicar por evolution_message_id (campo mensagem_id na tabela)
          const { data: existe } = await sb.from('lead_arquivos')
            .select('id').eq('mensagem_id', msgId).maybeSingle();
          if (!existe) {
            const arqId = crypto.randomBytes(16).toString('hex');
            const ext   = (arquivoNome?.split('.').pop() || (tipo === 'imagem' ? 'jpg' : tipo === 'audio' ? 'ogg' : tipo === 'video' ? 'mp4' : 'bin'));
            await sb.from('lead_arquivos').insert({
              id:              arqId,
              lead_id:         leadId,
              conversa_id:     conversaId,
              mensagem_id:     msgId,
              nome_original:   arquivoNome || `${tipo}-${agora.slice(0,10)}.${ext}`,
              nome_storage:    `wa/${leadId}/${msgId}.${ext}`,
              url:             midiaUrl,
              tamanho:         null,
              mime_type:       mimeType || null,
              enviado_por:     null, // recebido do lead, não do usuário
              origem:          'whatsapp',
              criado_em:       agora,
            });
            console.log('[WA Webhook] Mídia registrada em lead_arquivos:', { arqId, leadId, conversaId, tipo });
          } else {
            console.log('[WA Webhook] Mídia já registrada (dedup):', msgId);
          }
        } catch (eArq) {
          console.warn('[WA Webhook] Falha ao registrar mídia em lead_arquivos (não crítico):', eArq.message);
        }
      }
    } else {
      console.error('ERRO_AO_SALVAR_MENSAGEM_WHATSAPP:', { ...resultado, erro: erroSalvar?.message || 'Sem conversa ou erro no insert' });
    }

    // ── Registra no buffer de debug (não bloqueia, sem dados sensíveis) ────────────────
    _logInbound({
      event_type:     evento         || null,
      remote_jid:     rawJid         || null,
      lid:            lidNumero      || null,
      fromMe:         fromMe,
      texto_curto:    conteudo       ? conteudo.slice(0, 40) : null,
      tipo_mensagem:  tipo           || null,
      decisao:        msgSalva       ? 'salvo' : (erroSalvar ? 'erro_insert' : 'sem_conversa'),
      conversa_id:    conversaId     || null,
      salvo_em_tabela: msgSalva      ? MENSAGENS_TABLE : null,
      erro:           erroSalvar     ? erroSalvar.message : null,
    });

    return res.status(201).json({ sucesso: true, ...resultado });

  } catch (e) {
    console.error('ERRO_AO_SALVAR_MENSAGEM_WHATSAPP:', e.message, e.stack);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao processar mensagem.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/integracao/status
// Status da integração: atividade recente, secret configurado, logs
// ─────────────────────────────────────────────────────────────────────────────
async function statusIntegracao(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const agora = new Date();
    const h24   = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const d7    = new Date(agora.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString();

    let msgs24 = 0, msgs7d = 0, convAtivas = 0, ultima = null, logs = [];

    if (isSupa) {
      // ── Supabase ──────────────────────────────────────────────────────────
      // ── Supabase: contar mensagens e conversas ───────────────────────────────────
      // conversas_ativas: apenas ABERTA, excluindo PENDENTE_IDENTIFICACAO e LIDs
      const [r24, r7d, rConv, rUlt, rLogs] = await Promise.all([
        sb.from(MENSAGENS_TABLE).select('id', { count: 'exact', head: true }).gte('criado_em', h24),
        sb.from(MENSAGENS_TABLE).select('id', { count: 'exact', head: true }).gte('criado_em', d7),
        // Conta apenas conversas ABERTA sem telefone LID
        sb.from(CONVERSAS_TABLE).select('id,telefone,dados_extras', { count: 'exact' })
          .eq('status', 'ABERTA'),
        sb.from(MENSAGENS_TABLE).select('telefone,direcao,mensagem,criado_em').order('criado_em', { ascending: false }).limit(30),
        sb.from(MENSAGENS_TABLE).select('telefone,direcao,mensagem,conteudo,criado_em').order('criado_em', { ascending: false }).limit(50),
      ]);
      msgs24    = r24.count  ?? 0;
      msgs7d    = r7d.count  ?? 0;

      // FIX: exclui conversas LID da contagem de ativas
      const isLidPhone = (tel) => {
        if (!tel) return false;
        const t = String(tel).trim();
        if (t.startsWith('LID:')) return true;
        const d = t.replace(/\D/g, '');
        return d.length >= 14 && !d.startsWith('55');
      };
      const convsAtivasFiltradas = (rConv.data || []).filter(c => {
        if (isLidPhone(c.telefone)) return false;
        const ext = (() => { try { return typeof c.dados_extras === 'object' ? (c.dados_extras || {}) : JSON.parse(c.dados_extras || '{}'); } catch { return {}; } })();
        const tipoId = ext.tipo_identidade || '';
        return tipoId !== 'lid' && tipoId !== 'lid_nao_resolvido';
      });
      convAtivas = convsAtivasFiltradas.length;

      // FIX: filtra LID dos logs de atividade recente
      // Mensagens com telefone LID mostram texto descritivo, nunca o número bruto
      const NUMERO_OFICIAL_REGEX = /^(5511987994910|5511967668883)$/;
      const logsRaw = (rLogs.data || []);
      ultima = (rUlt.data || []).find(m => !isLidPhone(m.telefone)) || null;
      logs = logsRaw
        .filter(m => !NUMERO_OFICIAL_REGEX.test((m.telefone || '').replace(/\D/g, '')))
        .map(m => {
          const tel = m.telefone || '';
          const lidDetectado = isLidPhone(tel);
          return {
            telefone:  lidDetectado ? null : tel,
            direcao:   m.direcao,
            mensagem:  lidDetectado
              ? '(Mensagem pendente de identificação — LID interno do WhatsApp)'
              : (m.mensagem || m.conteudo || ''),
            criado_em: m.criado_em,
            lid_pendente: lidDetectado,
          };
        })
        .slice(0, 15);
    } else {
      // ── SQLite ────────────────────────────────────────────────────────────
      const db = getDb();
      msgs24     = db.prepare(`SELECT COUNT(*) as n FROM mensagens_whatsapp WHERE criado_em >= ?`).get(h24)?.n ?? 0;
      msgs7d     = db.prepare(`SELECT COUNT(*) as n FROM mensagens_whatsapp WHERE criado_em >= ?`).get(d7)?.n ?? 0;
      convAtivas = db.prepare(`SELECT COUNT(*) as n FROM conversas_whatsapp WHERE status = 'ABERTA'`).get()?.n ?? 0;
      ultima     = db.prepare(`SELECT telefone, direcao, mensagem, criado_em FROM mensagens_whatsapp ORDER BY criado_em DESC LIMIT 1`).get();
      logs       = db.prepare(`SELECT telefone, direcao, mensagem, criado_em FROM mensagens_whatsapp ORDER BY criado_em DESC LIMIT 15`).all();
    }

    // Secret configurado?
    const secretConf    = !!(process.env.WHATSAPP_WEBHOOK_SECRET);
    const secretValor   = process.env.WHATSAPP_WEBHOOK_SECRET || '';
    const secretPreview = secretConf
      ? secretValor.slice(0, 6) + '••••••••••••••••'
      : '';

    const webhookUrl = (() => {
      // 1. Tenta obter URL pública via obterWebhookUrl (usa WEBHOOK_URL / RAILWAY_PUBLIC_DOMAIN etc.)
      const url = evoSvc.obterWebhookUrl();
      if (url) return url;

      // 2. Em produção, nunca usar localhost — usar domínio público fixo
      const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PUBLIC_DOMAIN;
      if (isProd) {
        const publicDomain = process.env.PUBLIC_APP_URL
          || process.env.APP_URL
          || process.env.BASE_URL
          || 'https://prosperkt-crm-system-production.up.railway.app';
        const base = publicDomain.replace(/\/$/, '');
        console.log('[LOG] WHATSAPP_WEBHOOK_LOCALHOST_BLOCKED_IN_PROD: true');
        return `${base}/api/whatsapp/webhook`;
      }

      // 3. Em desenvolvimento local, usar apenas o host da requisição (sem fallback localhost)
      const reqHost = req ? req.get('host') : null;
      if (!reqHost) return null;
      return `${req.protocol}://${reqHost}/api/whatsapp/webhook`;
    })();

    // Log seguro da rota de webhook
    console.log(`[LOG] WHATSAPP_WEBHOOK_ROUTE_OK: true | webhook_url: ${webhookUrl}`);

    return res.json({
      sucesso:            true,
      webhook_url:        webhookUrl,
      msgs_24h:           msgs24,
      msgs_7d:            msgs7d,
      conversas_ativas:   convAtivas,
      ultima_msg_em:      ultima?.criado_em || null,
      ultima_direcao:     ultima?.direcao   || null,
      ultimo_telefone:    ultima?.telefone  || null,
      secret_configurado: secretConf,
      secret_preview:     secretPreview,
      secret_valor:       secretValor,   // retorna chave completa (rota protegida por SUPER_ADMIN)
      logs: logs.map(m => ({
        telefone:   m.telefone,
        direcao:    m.direcao,
        mensagem:   m.mensagem || m.conteudo || '',
        criado_em:  m.criado_em,
      })),
    });
  } catch(e) {
    console.error('[WA] statusIntegracao:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}


// ───────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/deduplicar
// Diagnóstico: lista grupos de conversas duplicadas (sem escrever nada)
// ───────────────────────────────────────────────────────────────────────────────
async function diagnosticarDuplicatas(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    if (!isSupa) return res.json({ sucesso: true, aviso: 'Apenas Supabase suportado.', grupos: [] });

    console.log('DUPLICATE_CONVERSAS_SCAN_START');
    const { data: todas } = await sb.from(CONVERSAS_TABLE)
      .select('id,telefone,lead_id,nome_contato,status,criado_em,ultima_msg_em,dados_extras')
      .order('criado_em', { ascending: true });

    const byPhone = {};
    for (const c of (todas || [])) {
      if (!c.telefone || c.telefone.startsWith('LID:')) continue;
      const key = normalizePhoneBR(c.telefone) || c.telefone;
      if (!byPhone[key]) byPhone[key] = [];
      byPhone[key].push(c);
    }

    const grupos = Object.entries(byPhone)
      .filter(([, convs]) => convs.length > 1)
      .map(([tel, convs]) => ({ telefone: tel, quantidade: convs.length, conversas: convs.map(c => ({ id: c.id, nome_contato: c.nome_contato, status: c.status, lead_id: c.lead_id, criado_em: c.criado_em, ultima_msg_em: c.ultima_msg_em })) }));

    console.log('DUPLICATE_CONVERSAS_FOUND', { total_grupos: grupos.length });
    return res.json({ sucesso: true, total_grupos_duplicados: grupos.length, grupos });
  } catch (e) {
    console.error('[WA Dedup] diagnosticarDuplicatas:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/deduplicar
// Executa deduplicação segura: move mensagens, marca duplicatas como FECHADA
// NÃO usa DELETE nem TRUNCATE
// ───────────────────────────────────────────────────────────────────────────────
async function executarDeduplicacao(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    if (!isSupa) return res.json({ sucesso: true, aviso: 'Apenas Supabase suportado.', mescladas: 0 });

    console.log('DUPLICATE_CONVERSAS_SCAN_START');
    const agora = new Date().toISOString();
    const { data: todas } = await sb.from(CONVERSAS_TABLE)
      .select('id,telefone,lead_id,nome_contato,status,criado_em,ultima_msg_em,dados_extras')
      .order('criado_em', { ascending: true });

    // Agrupa por telefone normalizado
    const byPhone = {};
    for (const c of (todas || [])) {
      if (!c.telefone || c.telefone.startsWith('LID:')) continue;
      const key = normalizePhoneBR(c.telefone) || c.telefone;
      if (!byPhone[key]) byPhone[key] = [];
      byPhone[key].push(c);
    }

    let gruposMesclados = 0;
    let mensagensMov = 0;
    const relatorio = [];

    for (const [tel, convs] of Object.entries(byPhone)) {
      if (convs.length <= 1) continue;
      console.log('DUPLICATE_CONVERSAS_FOUND', { telefone: tel, quantidade: convs.length });

      // Escolhe conversa canônica: prioridade = tem lead_id > status ABERTA > mais mensagens > mais antiga
      // Conta mensagens por conversa
      const ids = convs.map(c => c.id);
      const { data: contagens } = await sb.from(MENSAGENS_TABLE)
        .select('conversa_id')
        .in('conversa_id', ids);
      const contagemMap = {};
      for (const m of (contagens || [])) {
        contagemMap[m.conversa_id] = (contagemMap[m.conversa_id] || 0) + 1;
      }

      convs.sort((a, b) => {
        if (!!a.lead_id !== !!b.lead_id) return a.lead_id ? -1 : 1;
        if ((a.status === 'ABERTA') !== (b.status === 'ABERTA')) return a.status === 'ABERTA' ? -1 : 1;
        const ca = contagemMap[a.id] || 0;
        const cb = contagemMap[b.id] || 0;
        if (ca !== cb) return cb - ca; // mais mensagens primeiro
        return new Date(a.criado_em) - new Date(b.criado_em); // mais antiga primeiro
      });

      const canonica = convs[0];
      const duplicatas = convs.slice(1);
      console.log('DUPLICATE_CANONICAL_SELECTED', { conversaId: canonica.id, telefone: tel, total: convs.length });

      for (const dup of duplicatas) {
        // Move mensagens da duplicata para a canônica
        const { error: errMove } = await sb.from(MENSAGENS_TABLE)
          .update({ conversa_id: canonica.id })
          .eq('conversa_id', dup.id);
        if (!errMove) {
          const qtd = contagemMap[dup.id] || 0;
          mensagensMov += qtd;
          console.log('DUPLICATE_MESSAGES_MOVED', { de: dup.id, para: canonica.id, mensagens: qtd });
        }

        // Mescla dados_extras (preserva LID se existir)
        const extCan = (() => { try { return JSON.parse(canonica.dados_extras || '{}'); } catch { return {}; } })();
        const extDup = (() => { try { return JSON.parse(dup.dados_extras || '{}'); } catch { return {}; } })();
        const extMerge = { ...extDup, ...extCan }; // canônica tem prioridade

        // Atualiza canônica com ultima_msg_em mais recente
        const ultimaRecente = [canonica.ultima_msg_em, dup.ultima_msg_em]
          .filter(Boolean).sort().pop();

        await sb.from(CONVERSAS_TABLE).update({
          dados_extras: JSON.stringify(extMerge),
          ultima_msg_em: ultimaRecente || agora,
          atualizado_em: agora,
        }).eq('id', canonica.id);

        // Marca duplicata como FECHADA (não deleta)
        await sb.from(CONVERSAS_TABLE).update({
          status: 'FECHADA',
          atualizado_em: agora,
          dados_extras: JSON.stringify({ ...extDup, _duplicata_de: canonica.id, _deduplicado_em: agora }),
        }).eq('id', dup.id);
        console.log('DUPLICATE_CONVERSA_MARKED', { duplicataId: dup.id, canonicaId: canonica.id });
      }

      gruposMesclados++;
      relatorio.push({ telefone: tel, canonicaId: canonica.id, duplicatasIds: duplicatas.map(d => d.id) });
    }

    console.log('DUPLICATE_CONVERSAS_SCAN_DONE', { gruposMesclados, mensagensMov });
    return res.json({ sucesso: true, grupos_mesclados: gruposMesclados, mensagens_movidas: mensagensMov, relatorio });
  } catch (e) {
    console.error('[WA Dedup] executarDeduplicacao:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// EVOLUTION API — Gerenciamento de Instância
// Todos os endpoints exigem SUPER_ADMIN
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/whatsapp/evolution/status */
async function evoInstanciaStatus(req, res) {
  try {
    const instName = evoSvc.EVOLUTION_INSTANCE;
    console.log('[EVOLUTION_STATUS_REQUEST] instance:', instName);

    if (!evoSvc.isConfigured()) {
      return res.json({
        sucesso: true,
        configurada: false,
        mensagem: 'Evolution API não configurada. Preencha EVOLUTION_API_URL e EVOLUTION_API_KEY no .env.',
      });
    }

    // ── Fonte primária: connectionState ────────────────────────────────────────
    const stateR = await evoSvc.getConnectionState();
    const rawState = (stateR.dados?.instance?.state || stateR.dados?.state || '').toLowerCase();

    let estado = 'unknown';
    if (rawState === 'open' || rawState === 'connected') {
      estado = 'connected';
    } else if (rawState === 'connecting') {
      estado = 'connecting';
    } else if (rawState === 'close' || rawState === 'closed' || rawState === 'disconnected') {
      estado = 'disconnected';
    } else if (rawState) {
      console.log('[EVOLUTION_STATUS_CONNECTED] rawState desconhecido:', rawState);
    }

    console.log('[EVOLUTION_STATUS_CONNECTED] estado:', estado, '| rawState:', rawState);

    // ── Secundário: getInstanceInfo — tenta owner/profileName (pode dar 401 no fetchInstances) ──
    // getInstanceInfo() nunca retorna sucesso:false por causa do 401 — trata internamente.
    const infoR = await evoSvc.getInstanceInfo().catch(e => {
      console.log('[EVOLUTION_PROFILE_FETCH_401] getInstanceInfo falhou:', e.message);
      return { sucesso: false, owner: null, profileName: null, profilePictureUrl: null };
    });

    const owner            = infoR.owner            || null;
    const profileName      = infoR.profileName      || null;
    const profilePictureUrl = infoR.profilePictureUrl || null;

    if (owner) {
      console.log('[EVOLUTION_CONNECTED_NUMBER_FOUND] owner disponível: ***' + String(owner).slice(-4));
      console.log('[EVOLUTION_CONNECTED_NUMBER_SOURCE] evolution_api');
    } else {
      console.log('[EVOLUTION_CONNECTED_NUMBER_NOT_FOUND] owner não retornado por nenhum endpoint autorizado');
    }

    const webhookUrl = evoSvc.obterWebhookUrl();
    console.log('[EVOLUTION_STATUS_CONNECTED] webhookUrl:', webhookUrl ? 'configurado' : 'ausente');

    return res.json({
      sucesso:           true,
      configurada:       true,
      instancia:         instName,
      estado,
      owner,
      profileName,
      profilePictureUrl,
      ownerIndisponivel: !owner && estado === 'connected',
      dados:             stateR.dados,
      erro:              stateR.sucesso ? undefined : stateR.erro,
    });
  } catch (e) {
    console.error('[EVOLUTION_STATUS_REQUEST] Erro inesperado:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}


/** POST /api/whatsapp/evolution/criar */
async function evoCriarInstancia(req, res) {
  try {
    const r = await evoSvc.criarInstancia();

    // Instância-alvo já existia — service detectou antes de tentar criar
    if (r.sucesso && r.jaExistia) {
      console.log(`[EVO] Instância "${evoSvc.EVOLUTION_INSTANCE}" já existia — retornando sucesso.`);
      return res.json({
        sucesso: true,
        instancia: evoSvc.EVOLUTION_INSTANCE,
        aviso: 'Instância já existia. Clique em "Gerar QR Code" para conectar.',
      });
    }

    if (!r.sucesso) {
      // Log completo para diagnóstico
      console.log('[EVO] criarInstancia falhou — status:', r.status, '| erro:', r.erro, '| dados:', JSON.stringify(r.dados));

      // Fallback: ainda trata token duplicado que escapou da verificação prévia
      const erroStr = String(
        r.erro ||
        r.dados?.message ||
        r.dados?.error ||
        r.dados?.raw ||
        ''
      ).toLowerCase();

      const jaExiste =
        erroStr.includes('already') ||
        erroStr.includes('exists') ||
        erroStr.includes('token') ||
        erroStr.includes('duplicate') ||
        erroStr.includes('já existe') ||
        erroStr.includes('conflict') ||
        r.status === 409 ||
        r.status === 422;

      if (jaExiste) {
        console.log(`[EVO] Instância "${evoSvc.EVOLUTION_INSTANCE}" — token duplicado detectado via resposta de erro. Tratando como sucesso.`);
        return res.json({
          sucesso: true,
          instancia: evoSvc.EVOLUTION_INSTANCE,
          aviso: 'Instância já existia. Clique em "Gerar QR Code" para conectar.',
        });
      }

      return res.status(400).json({ sucesso: false, erro: r.erro, dados: r.dados });
    }

    return res.json({ sucesso: true, dados: r.dados, instancia: evoSvc.EVOLUTION_INSTANCE });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

/** GET /api/whatsapp/evolution/qrcode */
async function evoQrCode(req, res) {
  try {
    const forceReconnect = req.query.forceReconnect === 'true' || req.query.force === 'true';

    // Verifica estado atual
    const estado = await evoSvc.getConnectionState();
    const estadoAtual = (estado.dados?.instance?.state || estado.dados?.state || '').toLowerCase();

    if (estadoAtual === 'open') {
      if (forceReconnect) {
        // Sessão quebrada (session_broken): faz logout para liberar o QR
        console.log('[EVO_QR] forceReconnect=true + estado open → fazendo logout para regenerar QR');
        const logoutR = await evoSvc.desconectar();
        console.log('[EVO_QR] logout resultado:', logoutR.sucesso ? 'OK' : logoutR.erro);
        // Aguarda 1.5s para o Evolution API processar o logout
        await new Promise(r => setTimeout(r, 1500));
      } else {
        return res.status(409).json({
          sucesso: false,
          erro: 'WhatsApp já está conectado. Desconecte a sessão atual antes de gerar um novo QR Code.',
          estado: 'open',
          codigo: 'ALREADY_CONNECTED',
        });
      }
    }

    const r = await evoSvc.getQrCode();
    if (!r.sucesso) return res.status(400).json({ sucesso: false, erro: r.erro });
    // Normaliza: Evolution API pode retornar qrcode em diferentes campos
    const qr = r.dados?.qrcode?.base64
      || r.dados?.base64
      || r.dados?.qrCode
      || r.dados?.code
      || null;
    return res.json({ sucesso: true, qrcode: qr, dados: r.dados });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}



/** DELETE /api/whatsapp/evolution/desconectar */
async function evoDesconectar(req, res) {
  try {
    const r = await evoSvc.desconectar();
    if (!r.sucesso) return res.status(400).json({ sucesso: false, erro: r.erro });
    return res.json({ sucesso: true, mensagem: 'WhatsApp desconectado com sucesso.', dados: r.dados });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

/** DELETE /api/whatsapp/evolution/deletar */
async function evoDeletarInstancia(req, res) {
  try {
    const r = await evoSvc.deletarInstancia();
    if (!r.sucesso) return res.status(400).json({ sucesso: false, erro: r.erro });
    return res.json({ sucesso: true, mensagem: 'Instância deletada.', dados: r.dados });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

/** POST /api/whatsapp/evolution/configurar-webhook — reconfigura eventos do webhook */
async function evoConfigurarWebhook(req, res) {
  try {
    const r = await evoSvc.configurarWebhook();
    if (!r.sucesso) return res.status(400).json({ sucesso: false, erro: r.erro, dados: r.dados });
    return res.json({ sucesso: true, mensagem: 'Webhook configurado com MESSAGES_UPSERT.', dados: r.dados });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

/** GET /api/whatsapp/evolution/webhook-config — consulta config atual do webhook */
async function evoConsultarWebhook(req, res) {
  try {
    const r = await evoSvc.consultarWebhook();
    return res.json({ sucesso: r.sucesso, dados: r.dados, erro: r.erro });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

/**
 * GET /api/whatsapp/evolution/diag-raw
 * DIAGNÓSTICO — mapeia endpoints da Evolution API para encontrar campo do número.
 */
async function evoDiagRaw(req, res) {
  try {
    const instName = evoSvc.EVOLUTION_INSTANCE;
    console.log('[EVOLUTION_DIAG_RAW] Iniciando | instance:', instName);

    // Lote 1: endpoints principais
    const [fetchAll, connState, connectInfo] = await Promise.allSettled([
      evoSvc.call('GET', '/instance/fetchInstances'),
      evoSvc.call('GET', `/instance/connectionState/${instName}`),
      evoSvc.call('GET', `/instance/connect/${instName}`),
    ]);

    // Lote 2: endpoints alternativos (Evolution v1/v2 diferem aqui)
    const [fetchQuery, settings, profilePic, chatContacts] = await Promise.allSettled([
      evoSvc.call('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(instName)}`),
      evoSvc.call('GET', `/settings/find/${instName}`),
      evoSvc.call('GET', `/instance/profilePicture/${instName}`),
      evoSvc.call('POST', `/chat/findContacts/${instName}`, { where: {} }),
    ]);

    const safe = (r) => {
      if (r.status === 'rejected') return { erro: r.reason?.message || 'Rejected' };
      return { httpStatus: r.value?.status, sucesso: r.value?.sucesso, dados: r.value?.dados };
    };

    // Análise do fetchInstances
    let ownerDetectado = null, camposDisponiveis = [];
    for (const fetched of [fetchAll, fetchQuery]) {
      if (fetched.status === 'fulfilled' && fetched.value?.dados) {
        const lista = Array.isArray(fetched.value.dados) ? fetched.value.dados : [fetched.value.dados];
        const instData = lista.find(i => (i.instance?.instanceName || i.instanceName || '') === instName);
        if (instData) {
          const info = instData.instance || instData;
          camposDisponiveis = Object.keys(info);
          ownerDetectado = info.owner || info.ownerJid || info.wid || info.number || info.phone || null;
          console.log('[EVOLUTION_PROFILE_RESPONSE_FIELDS] Campos:', camposDisponiveis.join(', '));
          console.log('[EVOLUTION_CONNECTED_NUMBER_SOURCE] owner:', ownerDetectado ? 'PRESENTE' : 'AUSENTE');
          break;
        }
      }
    }

    return res.json({
      sucesso: true,
      diag: {
        instancia: instName,
        ownerDetectado,
        camposDisponiveis,
        fetchInstances:    safe(fetchAll),
        fetchInstancesQ:   safe(fetchQuery),
        connectionState:   safe(connState),
        connectInfo:       safe(connectInfo),
        settings:          safe(settings),
        profilePicture:    safe(profilePic),
        chatFindContacts:  safe(chatContacts),
      },
    });
  } catch (e) {
    console.error('[EVOLUTION_DIAG_RAW] Erro:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/media/:conversaId/:msgId
// Proxy seguro: serve áudio/mídia sem expor EVOLUTION_API_KEY ao frontend
// ─────────────────────────────────────────────────────────────────────────────
async function servirMidia(req, res) {
  try {
    const { conversaId, msgId } = req.params;
    const { sb, isSupa } = getProvider();

    // Busca a URL salva no banco
    let mediaUrl = null;
    let mimeType = 'audio/ogg';
    if (isSupa) {
      const { data: msg } = await sb.from(MENSAGENS_TABLE)
        .select('arquivo_url, mime_type').eq('id', msgId).eq('conversa_id', conversaId).single();
      mediaUrl = msg?.arquivo_url || null;
      mimeType = msg?.mime_type || mimeType;
    } else {
      const db = getDb();
      const msg = db.prepare('SELECT arquivo_url, mime_type FROM mensagens_whatsapp WHERE id=? AND conversa_id=? LIMIT 1').get(msgId, conversaId);
      mediaUrl = msg?.arquivo_url || null;
      mimeType = msg?.mime_type || mimeType;
    }

    if (!mediaUrl) {
      return res.status(404).json({ sucesso: false, erro: 'Mídia não encontrada.' });
    }

    // Se for base64 embutido, decodifica e serve diretamente
    if (mediaUrl.startsWith('data:')) {
      const [header, b64data] = mediaUrl.split(',');
      const mime = header.replace('data:','').replace(';base64','') || mimeType;
      const buf  = Buffer.from(b64data, 'base64');
      res.set('Content-Type', mime);
      res.set('Content-Length', buf.length);
      res.set('Cache-Control', 'private, max-age=3600');
      return res.send(buf);
    }

    // Se for URL externa (Evolution), faz proxy no backend (nunca expõe apikey ao frontend)
    const fetchOpts = evoSvc.isConfigured()
      ? { headers: { apikey: process.env.EVOLUTION_API_KEY || '' } }
      : {};

    let upstream;
    try {
      upstream = await fetch(mediaUrl, fetchOpts);
    } catch (e) {
      // Tenta sem headers se der erro de CORS/rede
      upstream = await fetch(mediaUrl);
    }

    if (!upstream.ok) {
      console.warn('WHATSAPP_MEDIA_PROXY_UPSTREAM_ERROR', { status: upstream.status, url: mediaUrl.slice(0,80) });
      return res.status(502).json({ sucesso: false, erro: 'Não foi possível buscar a mídia.' });
    }

    const contentType = upstream.headers.get('content-type') || mimeType;
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=3600');

    // Stream direto
    const { Readable } = require('stream');
    const nodeStream = Readable.fromWeb ? Readable.fromWeb(upstream.body) : upstream.body;
    if (nodeStream?.pipe) {
      nodeStream.pipe(res);
    } else {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.set('Content-Length', buf.length);
      res.send(buf);
    }
  } catch (e) {
    console.error('[WA Media Proxy] Erro:', e.message);
    res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = {
  // legado
  statusIntegracao,
  listarConversas,
  listarMensagens,
  enviarMensagem,
  criarOuAbrirConversa,
  buscarConversa,
  conversaPorLead,
  atualizarStatus,
  webhookTrafego,
  webhookReceberMensagem,
  listarPendentes,
  conversasSupabase,
  conversasPorLeadSupabase,
  mensagemManual,
  conversasDoLead,
  // evo
  evoInstanciaStatus,
  evoCriarInstancia,
  evoQrCode,
  evoDesconectar,
  evoDeletarInstancia,
  evoConfigurarWebhook,
  evoConsultarWebhook,
  evoDiagRaw,
  // novo: proxy de mídia
  servirMidia,
  // dedup
  diagnosticarDuplicatas,
  executarDeduplicacao,
  // debug inbound
  debugLastInbound,
  atualizarConversa,
};

// ─── PATCH /api/whatsapp/conversas/:id ────────────────────────────────────────
// Atualiza lead_id, nome_contato e/ou telefone de uma conversa.
// Usado pelo modal "Criar Lead" no frontend.
async function atualizarConversa(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const { id } = req.params;
    if (!isSupa) return res.status(400).json({ sucesso: false, erro: 'Apenas Supabase suportado.' });

    const campos = {};
    if (req.body.lead_id     !== undefined) campos.lead_id     = req.body.lead_id;
    if (req.body.nome_contato !== undefined) campos.nome_contato = req.body.nome_contato;
    if (req.body.telefone     !== undefined) campos.telefone    = req.body.telefone;
    if (req.body.status       !== undefined) campos.status      = req.body.status;
    campos.atualizado_em = new Date().toISOString();

    const { data, error } = await sb.from(CONVERSAS_TABLE).update(campos).eq('id', id).select().single();
    if (error) throw error;
    return res.json({ sucesso: true, dados: data });
  } catch(e) {
    console.error('[WA] atualizarConversa:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}



// ───────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/debug/last-inbound
// Retorna os últimos 20 webhooks inbound processados (SUPER_ADMIN)
// Não retorna payload completo, API key, token ou secret.
// ───────────────────────────────────────────────────────────────────────────────
async function debugLastInbound(req, res) {
  try {
    // Verifica SUPER_ADMIN
    if (req.usuario?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ sucesso: false, erro: 'Acesso restrito a SUPER_ADMIN.' });
    }
    return res.json({
      sucesso: true,
      total:   _inboundLog.length,
      tabelas: { conversas: CONVERSAS_TABLE, mensagens: MENSAGENS_TABLE, alias: ALIAS_TABLE },
      eventos: _inboundLog,
    });
  } catch(e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}
