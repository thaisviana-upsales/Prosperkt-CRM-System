/**
 * PROSPEKT CRM — Evolution API Service
 * Wrapper para chamadas à Evolution API (self-hosted)
 *
 * Variáveis necessárias no .env:
 *   EVOLUTION_API_URL=https://seu-servidor-evolution.com
 *   EVOLUTION_API_KEY=sua-chave-aqui
 *   EVOLUTION_INSTANCE=nome-da-instancia        (ou EVOLUTION_INSTANCE_NAME)
 *   WEBHOOK_URL=https://seu-crm-homologacao.com/api/whatsapp/webhook
 */

const EVOLUTION_URL      = (process.env.EVOLUTION_API_URL  || '').replace(/\/$/, '');
const EVOLUTION_KEY      = process.env.EVOLUTION_API_KEY   || '';
// Prioridade: EVOLUTION_INSTANCE → EVOLUTION_INSTANCE_NAME → erro de configuração (sem fallback hardcoded)
const EVOLUTION_INSTANCE = (process.env.EVOLUTION_INSTANCE || process.env.EVOLUTION_INSTANCE_NAME || '').trim();

// Log de startup — confirma qual instância está ativa neste servidor
if (EVOLUTION_INSTANCE) {
  const src = process.env.EVOLUTION_INSTANCE ? 'EVOLUTION_INSTANCE' : 'EVOLUTION_INSTANCE_NAME';
  console.log(`[EVO] Instância carregada: "${EVOLUTION_INSTANCE}" (fonte: ${src})`);
} else {
  console.error('[EVO] ATENÇÃO: EVOLUTION_INSTANCE e EVOLUTION_INSTANCE_NAME não estão configuradas no ambiente. Defina no Railway/env.');
}

function obterWebhookUrl() {
  let source = 'ENV_WEBHOOK_URL';
  let url = process.env.WEBHOOK_URL;
  
  if (url) {
    if (!url.endsWith('/api/whatsapp/webhook')) {
      url = url.replace(/\/$/, '') + '/api/whatsapp/webhook';
    }
  } else {
    const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PUBLIC_DOMAIN;
    if (isProd) {
      source = 'PRODUCTION_FALLBACK';
      const domain = process.env.RAILWAY_PUBLIC_DOMAIN || 
                     process.env.PUBLIC_APP_URL || 
                     process.env.APP_URL || 
                     process.env.BASE_URL || 
                     'prosperkt-crm-system-production.up.railway.app';
      
      let base = domain;
      if (!base.startsWith('http://') && !base.startsWith('https://')) {
        base = 'https://' + base;
      }
      url = base.replace(/\/$/, '') + '/api/whatsapp/webhook';
      
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        console.log('[LOG] WHATSAPP_WEBHOOK_LOCALHOST_BLOCKED_IN_PROD: true');
        url = 'https://prosperkt-crm-system-production.up.railway.app/api/whatsapp/webhook';
      }
    }
  }

  if (url) {
    console.log(`[LOG] WHATSAPP_WEBHOOK_URL_SOURCE: ${source}`);
    console.log(`[LOG] WHATSAPP_WEBHOOK_URL_ENV: ${process.env.WEBHOOK_URL || 'N/A'}`);
    console.log(`[LOG] WHATSAPP_WEBHOOK_URL_PRODUCTION: ${url}`);
  }
  
  return url || null;
}

function isConfigured() {
  const ok = !!(EVOLUTION_URL && EVOLUTION_KEY && EVOLUTION_INSTANCE);
  if (!ok) {
    if (!EVOLUTION_URL)      console.warn('[EVO] EVOLUTION_API_URL não configurada no ambiente.');
    if (!EVOLUTION_KEY)      console.warn('[EVO] EVOLUTION_API_KEY não configurada no ambiente.');
    if (!EVOLUTION_INSTANCE) console.warn('[EVO] EVOLUTION_INSTANCE (ou EVOLUTION_INSTANCE_NAME) não configurada no ambiente.');
  }
  return ok;
}

function headers() {
  return {
    'Content-Type':  'application/json',
    'apikey':        EVOLUTION_KEY,
  };
}

/**
 * Chamada genérica à Evolution API.
 * Retorna { sucesso, dados?, erro?, status? }
 */
async function call(method, path, body = null) {
  if (!isConfigured()) {
    return { sucesso: false, erro: 'Evolution API não configurada. Defina EVOLUTION_API_URL e EVOLUTION_API_KEY no .env.' };
  }
  const url = `${EVOLUTION_URL}${path}`;
  try {
    const opts = {
      method,
      headers: headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    const res  = await fetch(url, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      const msg = data?.message || data?.error || data?.raw || `HTTP ${res.status}`;
      return { sucesso: false, erro: msg, status: res.status, dados: data };
    }
    return { sucesso: true, dados: data, status: res.status };
  } catch (e) {
    return { sucesso: false, erro: `Erro de rede: ${e.message}` };
  }
}

// ── Instância ──────────────────────────────────────────────────────────────────

/**
 * Cria uma instância na Evolution API v1.8.6.
 *
 * Estratégia para evitar "Token already exists":
 *  1. Verifica se a instância-alvo (EVOLUTION_INSTANCE) já existe → retorna sucesso imediato.
 *  2. Se houver instâncias de outros nomes que usam o mesmo apikey (colisão de token),
 *     deleta-as antes de criar a nova.
 *  3. Payload mínimo: apenas instanceName + qrcode. NUNCA envia campo "token".
 *
 * EVOLUTION_API_KEY é usado SOMENTE no header apikey — nunca como token da instância.
 */
async function criarInstancia() {
  // Guard: EVOLUTION_INSTANCE deve estar configurado
  if (!EVOLUTION_INSTANCE) {
    console.error('[EVO] criarInstancia: EVOLUTION_INSTANCE está vazia! Configure a variável no ambiente Railway/env.');
    return { sucesso: false, erro: 'EVOLUTION_INSTANCE não configurada. Defina EVOLUTION_INSTANCE no ambiente Railway.' };
  }
  // ── 1. Verifica instâncias existentes ────────────────────────────────────
  const listaR = await call('GET', '/instance/fetchInstances');
  const instancias = Array.isArray(listaR.dados)
    ? listaR.dados
    : (listaR.dados ? [listaR.dados] : []);

  // ── 2. Verifica se a instância-alvo já existe ─────────────────────────────
  const jaExisteAlvo = instancias.some(
    (i) => (i.instance?.instanceName || i.instanceName || '') === EVOLUTION_INSTANCE
  );
  if (jaExisteAlvo) {
    console.log(`[EVO] criarInstancia: instância "${EVOLUTION_INSTANCE}" já existe — retornando sucesso sem recriar.`);
    return { sucesso: true, dados: { instanceName: EVOLUTION_INSTANCE }, jaExistia: true };
  }

  // ── 3. Remove instâncias antigas que colidem por apikey/token ─────────────
  // A Evolution v1.8.6 usa o apikey como token implícito de instância.
  // Se houver qualquer outra instância criada com este apikey, ela causará
  // "Token already exists" na criação da nova. Deletamos todas antes.
  for (const inst of instancias) {
    const nomeInst = inst.instance?.instanceName || inst.instanceName || '';
    if (nomeInst && nomeInst !== EVOLUTION_INSTANCE) {
      console.log(`[EVO] criarInstancia: deletando instância antiga "${nomeInst}" para liberar token...`);
      await call('DELETE', `/instance/delete/${nomeInst}`);
    }
  }

  // ── 4. Cria a instância com payload mínimo ────────────────────────────────
  const webhookUrl = obterWebhookUrl();
  const payload = {
    instanceName: EVOLUTION_INSTANCE,
    qrcode:       true,
    ...(webhookUrl ? {
      webhook:        webhookUrl,
      webhook_by_events: false,
      events: [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'MESSAGES_SET',
        'CONNECTION_UPDATE',
        'QRCODE_UPDATED',
      ],
    } : {}),
  };

  console.log('PAYLOAD_CREATE_INSTANCE_EVOLUTION:', JSON.stringify(payload, null, 2));

  return call('POST', '/instance/create', payload);
}

/**
 * Retorna o QR Code da instância (base64 ou objeto com qrcode).
 */
async function getQrCode() {
  return call('GET', `/instance/connect/${EVOLUTION_INSTANCE}`);
}

/**
 * Estado de conexão: open | connecting | close
 */
async function getConnectionState() {
  return call('GET', `/instance/connectionState/${EVOLUTION_INSTANCE}`);
}

/**
 * Desconecta a instância (logout do WhatsApp).
 */
async function desconectar() {
  return call('DELETE', `/instance/logout/${EVOLUTION_INSTANCE}`);
}

/**
 * Deleta a instância por completo.
 */
async function deletarInstancia() {
  return call('DELETE', `/instance/delete/${EVOLUTION_INSTANCE}`);
}

/**
 * Lista instâncias existentes.
 */
async function listarInstancias() {
  return call('GET', '/instance/fetchInstances');
}

/**
 * Configura (ou reconfigura) o webhook da instância com todos os eventos necessários.
 * IMPORTANTE: inclui MESSAGES_UPSERT para receber novas mensagens.
 * Chame este método sempre que o webhook URL mudar ou os eventos precisarem ser atualizados.
 */
async function configurarWebhook() {
  const webhookUrl = obterWebhookUrl();
  if (!webhookUrl) {
    return { sucesso: false, erro: 'WEBHOOK_URL não configurada no .env e sem fallback público disponível.' };
  }
  const payload = {
    url: webhookUrl,
    webhook_by_events: false,
    events: [
      'MESSAGES_UPSERT',
      'MESSAGES_UPDATE',
      'MESSAGES_SET',
      'CONNECTION_UPDATE',
      'QRCODE_UPDATED',
    ],
  };
  console.log(`[EVO] configurarWebhook: POST /webhook/set/${EVOLUTION_INSTANCE}`, JSON.stringify(payload));
  return call('POST', `/webhook/set/${EVOLUTION_INSTANCE}`, payload);
}

/**
 * Retorna a configuração atual do webhook da instância.
 * Usar para diagnosticar se MESSAGES_UPSERT está habilitado.
 */
async function consultarWebhook() {
  return call('GET', `/webhook/find/${EVOLUTION_INSTANCE}`);
}

/**
 * Retorna informações da instância conectada: owner (número real), profileName, foto.
 * Normaliza o campo owner removendo @s.whatsapp.net.
/**
 * Retorna informações da instância conectada.
 *
 * ESTRATÉGIA (apikey de instância não tem acesso global):
 *  1. Tenta fetchInstances (bônus) → se 401, loga e ignora silenciosamente.
 *  2. Usa connectionState como fonte PRIMÁRIA de estado (funciona com apikey de instância).
 *  3. Owner/número retornado apenas se algum endpoint autorizado retornar esse dado.
 *  4. Nunca falha porque fetchInstances deu 401 — isso é esperado.
 */
async function getInstanceInfo() {
  let ownerRaw        = null;
  let profileName     = null;
  let profilePicture  = null;

  // ── FASE 1: fetchInstances (opcional — exige apikey global) ────────────────
  // Trata 401 silenciosamente: apikey de instância não tem permissão global.
  const fetchR = await call('GET', '/instance/fetchInstances');
  if (fetchR.sucesso) {
    const lista = Array.isArray(fetchR.dados) ? fetchR.dados : (fetchR.dados ? [fetchR.dados] : []);
    const inst  = lista.find(i => (i.instance?.instanceName || i.instanceName || '') === EVOLUTION_INSTANCE);
    if (inst) {
      const info = inst.instance || inst;
      // Mapeia todos os campos possíveis onde o owner pode estar
      ownerRaw       = info.owner || info.ownerJid || info.wid || info.number || info.phone || null;
      profileName    = info.profileName    || null;
      profilePicture = info.profilePictureUrl || info.profilePicture || null;
      console.log('[EVOLUTION_PROFILE_RESPONSE_FIELDS]', Object.keys(info).join(', '));
    }
    console.log('[EVOLUTION_PROFILE_FETCH_SUCCESS] fetchInstances OK | owner:', ownerRaw ? 'PRESENTE' : 'AUSENTE');
  } else if (fetchR.status === 401) {
    console.log('[EVOLUTION_FETCH_INSTANCES_401_SKIPPED] apikey de instância sem acesso global — ignorado.');
  } else {
    console.log('[EVOLUTION_PROFILE_FETCH_START] fetchInstances indisponível:', fetchR.status, fetchR.erro);
  }

  // ── FASE 2: connectionState — fonte primária de estado ────────────────────
  // Este endpoint funciona com apikey de instância.
  console.log('[EVOLUTION_PROFILE_FETCH_START] connectionState...');
  const connR   = await call('GET', `/instance/connectionState/${EVOLUTION_INSTANCE}`);
  const rawState = connR.dados?.instance?.state || connR.dados?.state || 'desconhecido';

  // Se connectionState também não retornou owner, tenta campos extras
  if (!ownerRaw && connR.sucesso && connR.dados) {
    const cd = connR.dados?.instance || connR.dados;
    ownerRaw = cd?.owner || cd?.ownerJid || cd?.wid || cd?.number || null;
  }

  const ownerNumero = ownerRaw ? ownerRaw.split('@')[0].replace(/\D/g, '') || null : null;

  if (ownerNumero) {
    console.log('[EVOLUTION_CONNECTED_NUMBER_FOUND] owner normalizado presente');
    console.log('[EVOLUTION_CONNECTED_NUMBER_SOURCE] fetchInstances ou connectionState');
  } else {
    console.log('[EVOLUTION_CONNECTED_NUMBER_NOT_FOUND] nenhum endpoint autorizado retornou owner');
  }

  return {
    sucesso:           true, // sempre retorna sucesso — 401 no fetchInstances não é falha crítica
    instanceName:      EVOLUTION_INSTANCE,
    owner:             ownerNumero,
    ownerJid:          ownerRaw,
    profileName,
    profilePictureUrl: profilePicture,
    status:            rawState,
  };
}

// ── Mensagens ─────────────────────────────────────────────────────────────────

/**
 * Envia mensagem de texto.
 * Evolution API v1.8.6: payload usa textMessage.text, não text diretamente.
 * @param {string} telefone  — número no formato 5511999990000 (sem + e sem @)
 * @param {string} texto
 */
async function enviarTexto(telefone, texto) {
  const number = telefone.replace(/\D/g, '');
  console.log(`[EVO] enviarTexto → POST /message/sendText/${EVOLUTION_INSTANCE} | number:${number} | preview:${texto?.slice(0,60)}`);
  return call('POST', `/message/sendText/${EVOLUTION_INSTANCE}`, {
    number,
    textMessage: { text: texto },
  });
}

/**
 * Envia mídia (imagem, documento, áudio, vídeo).
 * @param {string} telefone
 * @param {{ mediatype, mimetype, caption, media, fileName }} opcoes
 */
async function enviarMidia(telefone, opcoes) {
  const number = telefone.replace(/\D/g, '');
  return call('POST', `/message/sendMedia/${EVOLUTION_INSTANCE}`, {
    number,
    mediatype: opcoes.mediatype || 'image',
    mimetype:  opcoes.mimetype  || 'image/jpeg',
    caption:   opcoes.caption   || '',
    media:     opcoes.media,      // URL pública ou base64
    fileName:  opcoes.fileName   || 'arquivo',
  });
}

/**
 * Envia áudio (PTT — push-to-talk).
 */
async function enviarAudio(telefone, audioUrl) {
  const number = telefone.replace(/\D/g, '');
  return call('POST', `/message/sendWhatsAppAudio/${EVOLUTION_INSTANCE}`, {
    number,
    audio: audioUrl,
    encoding: true,
  });
}

module.exports = {
  isConfigured,
  call,
  criarInstancia,
  getQrCode,
  getConnectionState,
  getInstanceInfo,
  desconectar,
  deletarInstancia,
  listarInstancias,
  configurarWebhook,
  consultarWebhook,
  enviarTexto,
  enviarMidia,
  enviarAudio,
  EVOLUTION_INSTANCE,
  obterWebhookUrl,
};
