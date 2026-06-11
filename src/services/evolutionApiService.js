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
// Aceita EVOLUTION_INSTANCE_NAME (padrão solicitado) ou EVOLUTION_INSTANCE (legado)
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE || 'prosperkt';
// URL pública onde a Evolution API entregará os webhooks (ex: https://crm.homolog.com/api/whatsapp/webhook)
const WEBHOOK_URL        = (process.env.WEBHOOK_URL || '').replace(/\/$/, '');

function isConfigured() {
  return !!(EVOLUTION_URL && EVOLUTION_KEY);
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
  // NUNCA incluir campo "token" — a Evolution gera automaticamente.
  // EVOLUTION_API_KEY vai SOMENTE no header "apikey".
  // Se WEBHOOK_URL estiver configurada, registra automaticamente o endpoint
  // para que a Evolution API saiba onde entregar os eventos (necessário em homologação).
  const payload = {
    instanceName: EVOLUTION_INSTANCE,
    qrcode:       true,
    ...(WEBHOOK_URL ? {
      webhook:        WEBHOOK_URL,
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
  if (!WEBHOOK_URL) {
    return { sucesso: false, erro: 'WEBHOOK_URL não configurada no .env' };
  }
  const payload = {
    url: WEBHOOK_URL,
    webhook_by_events: false,
    events: [
      'MESSAGES_UPSERT',
      'MESSAGES_UPDATE',
      'MESSAGES_SET',
      'CONNECTION_UPDATE',
      'QRCODE_UPDATED',
    ],
  };
  console.log(`[EVO] configurarWebhook: PUT /webhook/set/${EVOLUTION_INSTANCE}`, JSON.stringify(payload));
  return call('PUT', `/webhook/set/${EVOLUTION_INSTANCE}`, payload);
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
 */
async function getInstanceInfo() {
  const r = await call('GET', '/instance/fetchInstances');
  if (!r.sucesso) return { sucesso: false, erro: r.erro };

  const lista = Array.isArray(r.dados) ? r.dados : (r.dados ? [r.dados] : []);
  const inst = lista.find(
    (i) => (i.instance?.instanceName || i.instanceName || '') === EVOLUTION_INSTANCE
  );

  if (!inst) return { sucesso: false, erro: `Instância "${EVOLUTION_INSTANCE}" não encontrada.` };

  const info = inst.instance || inst;
  const ownerRaw = info.owner || '';
  const ownerNumero = ownerRaw.split('@')[0].replace(/\D/g, '') || null;

  return {
    sucesso:           true,
    instanceName:      info.instanceName      || EVOLUTION_INSTANCE,
    owner:             ownerNumero,
    ownerJid:          ownerRaw,
    profileName:       info.profileName        || null,
    profilePictureUrl: info.profilePictureUrl  || null,
    status:            info.status             || 'desconhecido',
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
};
