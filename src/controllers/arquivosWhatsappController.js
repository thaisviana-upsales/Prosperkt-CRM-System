/**
 * PROSPEKT CRM — Arquivos WhatsApp Controller
 *
 * CAUSA RAIZ IDENTIFICADA (2026-08-14):
 *   Evolution API v1.8.6 aceita base64 SOMENTE para mediatype 'audio'.
 *   Para image/video/document, retorna HTTP 400 "Verifique telefone e mensagem".
 *
 * SOLUÇÃO:
 *   image/video/document → URL temporária pública /api/whatsapp/temp/:token
 *   audio → base64 (funciona, mesmo método de whatsappController.js)
 *
 *   Arquivo fica em Map em memória por 5 minutos. Evolution baixa via GET.
 *   Token = 32 bytes aleatórios (impossível adivinhar).
 *   Sem Supabase Storage permanente.
 */
const crypto   = require('crypto');
const multer   = require('multer');
const { getProvider } = require('../database/dbProvider');
const evoSvc   = require('../services/evolutionApiService');
const { extPermitida, sanitizarNome, fmtTamanho } = require('./arquivosController');

const LIMITE_WA_BYTES = 80 * 1024 * 1024;
const LIMITE_WA_MB    = 80;

// ── Armazenamento temporário em memória ────────────────────────────────────────
const tempFiles = new Map(); // token → { buffer, mime, name, expires }

const _sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tempFiles) {
    if (v.expires < now) tempFiles.delete(k);
  }
}, 2 * 60 * 1000);
if (_sweeper?.unref) _sweeper.unref();

function getBaseUrl() {
  if (process.env.APP_URL)               return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return 'https://prosperkt-crm-system-production.up.railway.app';
}

// ── GET /api/whatsapp/temp/:token — PÚBLICO, sem autenticar ───────────────────
// Evolution API baixa o arquivo deste endpoint para enviar ao WhatsApp
function getTempMedia(req, res) {
  const tmp = tempFiles.get(req.params.token);
  if (!tmp || tmp.expires < Date.now()) {
    return res.status(404).json({ erro: 'Arquivo temporário expirado.' });
  }
  res.set('Content-Type', tmp.mime || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(tmp.name)}`);
  res.set('Cache-Control', 'no-store');
  res.set('Content-Length', tmp.buffer.length);
  return res.send(tmp.buffer);
}

// ── Multer (compatibilidade com envios multipart legados) ──────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: LIMITE_WA_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!extPermitida(file.originalname))
      return cb(Object.assign(new Error('Tipo de arquivo não permitido.'), { code: 'BLOCKED_EXT' }));
    cb(null, true);
  },
});

function handleUploadError(err, req, res, next) {
  if (err?.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ sucesso: false, erro: `Arquivo excede ${LIMITE_WA_MB} MB.` });
  if (err?.code === 'BLOCKED_EXT')
    return res.status(400).json({ sucesso: false, erro: err.message });
  next(err);
}

const LIMITE_VIDEO_BYTES = 16 * 1024 * 1024; // 16 MB — limite oficial do WhatsApp para vídeo
const LIMITE_VIDEO_MB    = 16;

function resolveMediatype(mime) {
  if (!mime) return 'document';
  if (mime.startsWith('image/'))  return 'image';
  if (mime.startsWith('video/'))  return 'video';
  if (mime.startsWith('audio/'))  return 'audio';
  return 'document';
}

// ── POST /api/whatsapp/conversas/:id/arquivos ─────────────────────────────────
async function enviarArquivo(req, res, next) {
  try {
    const { sb, isSupa } = getProvider();
    const conversaId = req.params.id;

    // 1. Normaliza entrada (multipart ou JSON base64)
    let arqBuffer, arqNome, arqMime;

    if (req.file) {
      arqBuffer = req.file.buffer;
      arqNome   = req.file.originalname;
      arqMime   = req.file.mimetype;
    } else if (req.body?.arquivo_base64) {
      arqNome = req.body.arquivo_nome || 'arquivo';
      arqMime = req.body.mime_type    || 'application/octet-stream';
      const pureB64 = req.body.arquivo_base64.replace(/^data:[^;]+;base64,/, '');
      try { arqBuffer = Buffer.from(pureB64, 'base64'); }
      catch { return res.status(400).json({ sucesso: false, erro: 'Base64 inválido.' }); }
    } else {
      return res.status(400).json({ sucesso: false, erro: 'Nenhum arquivo enviado.' });
    }

    const extNome = (arqNome.split('.').pop() || '').toLowerCase();
    const isVideo = arqMime.startsWith('video/') || ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(extNome);

    // 2. Validações
    if (isVideo) {
      console.log('WA_VIDEO_SEND_START', {
        conversa_id: conversaId,
        nome_arquivo: sanitizarNome(arqNome),
        tamanho: arqBuffer.length,
        mimetype: arqMime,
        mediatype: 'video',
      });
      console.log('WA_VIDEO_SEND_FILE_RECEIVED', {
        conversa_id: conversaId,
        nome_arquivo: sanitizarNome(arqNome),
        tamanho: arqBuffer.length,
        mimetype: arqMime,
      });

      // Validação de formato (WhatsApp exige contêiner MP4 para videoMessage)
      if (extNome !== 'mp4' && arqMime !== 'video/mp4') {
        console.warn('WA_VIDEO_SEND_VALIDATION_ERROR', {
          conversa_id: conversaId,
          nome_arquivo: sanitizarNome(arqNome),
          ext: extNome,
          mimetype: arqMime,
          erro: 'Formato de vídeo não suportado. Envie em MP4.',
        });
        return res.status(400).json({ sucesso: false, erro: 'Formato de vídeo não suportado. Envie em MP4.' });
      }

      // Validação de tamanho (16 MB)
      if (arqBuffer.length > LIMITE_VIDEO_BYTES) {
        console.warn('WA_VIDEO_SEND_VALIDATION_ERROR', {
          conversa_id: conversaId,
          nome_arquivo: sanitizarNome(arqNome),
          tamanho: arqBuffer.length,
          limite: LIMITE_VIDEO_BYTES,
          erro: 'Vídeo muito grande para envio pelo WhatsApp. Reduza o tamanho e tente novamente.',
        });
        return res.status(413).json({
          sucesso: false,
          erro: 'Vídeo muito grande para envio pelo WhatsApp. Reduza o tamanho e tente novamente.',
        });
      }

      console.log('WA_VIDEO_SEND_VALIDATION_OK', {
        conversa_id: conversaId,
        nome_arquivo: sanitizarNome(arqNome),
        tamanho: arqBuffer.length,
        mimetype: 'video/mp4',
        mediatype: 'video',
      });
    } else {
      if (!extPermitida(arqNome))
        return res.status(400).json({ sucesso: false, erro: 'Tipo de arquivo não permitido.' });
      if (arqBuffer.length > LIMITE_WA_BYTES)
        return res.status(413).json({ sucesso: false, erro: `Arquivo excede ${LIMITE_WA_MB} MB.` });
    }

    if (!evoSvc.isConfigured())
      return res.status(503).json({ sucesso: false, erro: 'Evolution API não configurada.' });

    // 3. Busca conversa
    let conversa = null;
    try {
      if (isSupa) {
        const { data } = await sb.from('conversas_whatsapp').select('*').eq('id', conversaId).single();
        conversa = data;
      }
    } catch (e) {
      console.error('[wha.enviarArquivo] Supabase:', e.message);
      return res.status(500).json({ sucesso: false, erro: 'Erro ao buscar conversa.' });
    }

    if (!conversa)
      return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });

    // ── Resolve JID real para envio via Evolution API ────────────────────────
    let telNorm = null;
    {
      const tel = (conversa.telefone || '').trim();

      if (tel.startsWith('LID:')) {
        const lidNumero = tel.slice(4).replace(/\D/g, '');
        if (lidNumero) telNorm = `${lidNumero}@lid`;

      } else if (tel.includes('@lid')) {
        telNorm = tel;

      } else {
        const { data: alias } = await sb
          .from('whatsapp_conversa_aliases')
          .select('remote_jid')
          .eq('conversa_id', conversaId)
          .limit(1)
          .maybeSingle();

        if (alias?.remote_jid) {
          const rjid = alias.remote_jid.trim();
          telNorm = rjid.includes('@lid')
            ? rjid
            : rjid.replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '');
        } else {
          telNorm = tel.replace(/\D/g, '') || null;
        }
      }
    }

    if (!telNorm)
      return res.status(400).json({ sucesso: false, erro: 'Conversa sem telefone válido.' });

    const agora      = new Date().toISOString();
    const nomeSeguro = sanitizarNome(arqNome);
    const msgId      = crypto.randomBytes(16).toString('hex');
    const mediatype  = isVideo ? 'video' : resolveMediatype(arqMime);

    // 4. Monta media para Evolution
    //    REGRA: video → Base64 puro (sem prefixo data URI — Evolution API v2.3.7 aceita perfeitamente)
    //           audio → data URI base64
    //           image/document → URL temporária pública /api/whatsapp/temp/:token
    let media;
    let tempToken = null;

    if (isVideo) {
      media = arqBuffer.toString('base64');
      console.log('WA_VIDEO_SEND_STORAGE_OK', {
        conversa_id: conversaId,
        lead_id: conversa?.lead_id || null,
        metodo: 'pure_base64_memory',
        tamanho: arqBuffer.length,
      });
      console.log('WA_VIDEO_SEND_PAYLOAD_READY', {
        conversa_id: conversaId,
        lead_id: conversa?.lead_id || null,
        nome_arquivo: nomeSeguro,
        tamanho: arqBuffer.length,
        mimetype: 'video/mp4',
        mediatype: 'video',
        usa_base64: true,
        usa_url: false,
      });
    } else if (mediatype === 'audio') {
      media = `data:${arqMime};base64,${arqBuffer.toString('base64')}`;
      console.log('[wha.enviarArquivo] audio→base64', nomeSeguro, fmtTamanho(arqBuffer.length));
    } else {
      tempToken = crypto.randomBytes(32).toString('hex');
      tempFiles.set(tempToken, {
        buffer:  arqBuffer,
        mime:    arqMime,
        name:    nomeSeguro,
        expires: Date.now() + 5 * 60 * 1000, // 5 min TTL
      });
      media = `${getBaseUrl()}/api/whatsapp/temp/${tempToken}`;
      console.log('[wha.enviarArquivo] doc/img→URL', nomeSeguro, mediatype, fmtTamanho(arqBuffer.length));
    }

    // 5. Envia à Evolution
    let evoOk    = false;
    let evoErro  = null;
    let evoMsgId = null;

    if (isVideo) {
      console.log('WA_VIDEO_SEND_EVOLUTION_REQUEST', {
        conversa_id: conversaId,
        lead_id: conversa?.lead_id || null,
        destinatario: telNorm,
        mediatype: 'video',
        mimetype: 'video/mp4',
        usa_base64: true,
      });
    }

    try {
      const evoRes = await evoSvc.enviarMidia(telNorm, {
        mediatype,
        mimetype: isVideo ? 'video/mp4' : arqMime,
        caption:  req.body?.caption || (isVideo ? '' : nomeSeguro),
        media,
        fileName: isVideo ? (nomeSeguro.toLowerCase().endsWith('.mp4') ? nomeSeguro : `${nomeSeguro}.mp4`) : nomeSeguro,
      });

      const candId = evoRes.dados?.key?.id || evoRes.dados?.messageId || evoRes.dados?.id || null;

      if (isVideo) {
        // REGRA DE SUCESSO REAL PARA VÍDEO:
        // O vídeo só é aceito se a Evolution retornou sucesso HTTP E um messageId real!
        if (evoRes.sucesso && candId) {
          evoOk    = true;
          evoMsgId = candId;
          console.log('WA_VIDEO_SEND_EVOLUTION_SUCCESS', {
            conversa_id: conversaId,
            lead_id: conversa?.lead_id || null,
            status: evoRes.status,
            messageId: evoMsgId,
          });
        } else {
          evoErro = evoRes.erro || JSON.stringify(evoRes.dados) || 'Evolution não confirmou o envio do vídeo.';
          console.error('WA_VIDEO_SEND_EVOLUTION_ERROR', {
            conversa_id: conversaId,
            lead_id: conversa?.lead_id || null,
            erro: evoErro,
            status: evoRes.status,
          });
          console.error('WA_VIDEO_SEND_REAL_ERROR', {
            conversa_id: conversaId,
            lead_id: conversa?.lead_id || null,
            motivo: 'sem_messageId_ou_rejeitado',
            erro: evoErro,
            status: evoRes.status,
          });
        }
      } else {
        // REGRA B02: Qualquer mídia (documento ou imagem) exige confirmação real com candId/messageId
        if (evoRes.sucesso && candId) {
          evoOk    = true;
          evoMsgId = candId;
          console.log('[wha.enviarArquivo] Evolution OK', { evoMsgId, nomeSeguro });
        } else {
          evoOk    = false;
          evoErro  = evoRes.erro || JSON.stringify(evoRes.dados) || 'Evolution não confirmou o envio (sem messageId).';
          console.error('[wha.enviarArquivo] Evolution rejeitou:', evoErro, 'status:', evoRes.status);
        }
      }
    } catch (e) {
      evoErro = e.message;
      if (isVideo) {
        console.error('WA_VIDEO_SEND_EVOLUTION_ERROR', { conversa_id: conversaId, erro: e.message });
        console.error('WA_VIDEO_SEND_REAL_ERROR', { conversa_id: conversaId, erro: e.message });
      } else {
        console.error('[wha.enviarArquivo] Evolution exception:', e.message);
      }
    } finally {
      // Limpa temp file 60s após envio (Evolution já baixou)
      if (tempToken) setTimeout(() => tempFiles.delete(tempToken), 60 * 1000);
    }

    if (!evoOk) {
      return res.status(502).json({
        sucesso: false,
        enviado: false,
        erro: isVideo ? (evoErro || 'Não foi possível enviar o vídeo.') : (evoErro || 'Falha ao enviar arquivo pelo WhatsApp.'),
        evo_ok: false,
      });
    }

    // 6. Salva histórico
    let mensagemSalva = null;
    if (isSupa) {
      try {
        const tipoDb = isVideo ? 'video' : (mediatype === 'image' ? 'imagem' : 'arquivo');
        const { data: msgData } = await sb.from('mensagens_whatsapp').insert({
          id: msgId, conversa_id: conversaId,
          lead_id:              conversa.lead_id || null,
          telefone:             conversa.telefone,
          mensagem:             req.body?.caption || (isVideo ? '🎥 Vídeo' : nomeSeguro),
          tipo:                 tipoDb,
          direcao:              'enviada',
          status:               'enviado',
          vendedor_id:          req.usuario?.id || null,
          arquivo_url:          null,
          arquivo_nome:         nomeSeguro,
          mime_type:            isVideo ? 'video/mp4' : arqMime,
          evolution_message_id: evoMsgId,
          criado_em:            agora,
        }).select().single();
        if (msgData) mensagemSalva = { ...msgData, vendedor_nome: req.usuario?.nome || null };
      } catch (e) {
        console.warn('[wha.enviarArquivo] histórico warn:', e.message);
      }

      const ultimaMsgTexto = isVideo ? '🎥 Vídeo' : `📎 ${nomeSeguro}`;
      const { error: convUpdErr } = await sb.from('conversas_whatsapp').update({
        ultima_msg_em: agora, atualizado_em: agora,
        ultima_mensagem: ultimaMsgTexto, status: 'ABERTA',
      }).eq('id', conversaId);
      void convUpdErr;
    }

    if (isVideo) {
      console.log('WA_VIDEO_SEND_DB_SAVE_SUCCESS', {
        conversa_id: conversaId,
        lead_id: conversa?.lead_id || null,
        msgId,
        evolution_message_id: evoMsgId,
      });
      console.log('WA_VIDEO_SEND_UI_SUCCESS', {
        conversa_id: conversaId,
        lead_id: conversa?.lead_id || null,
        msgId,
        evolution_message_id: evoMsgId,
      });
    }

    return res.status(201).json({
      sucesso: true,
      enviado: true,
      dados: mensagemSalva || {
        id: msgId, conversa_id: conversaId,
        tipo: isVideo ? 'video' : (mediatype === 'image' ? 'imagem' : 'arquivo'),
        arquivo_url: null, arquivo_nome: nomeSeguro,
        mime_type: isVideo ? 'video/mp4' : arqMime,
        mensagem: req.body?.caption || (isVideo ? '🎥 Vídeo' : nomeSeguro),
        direcao: 'enviada', status: 'enviado', criado_em: agora,
        evolution_message_id: evoMsgId,
      },
      evo_ok: true, evo_msg: evoMsgId, aviso: null,
    });

  } catch (e) {
    console.error('[wha.enviarArquivo] ERRO NÃO TRATADO:', e.message, e.stack);
    next(e);
  }
}

// ── GET /api/whatsapp/conversas/:id/arquivos ──────────────────────────────────
async function listarArquivos(req, res, next) {
  try {
    const { sb, isSupa } = getProvider();
    const { id: conversaId } = req.params;
    if (!isSupa) return res.json({ sucesso: true, dados: [] });
    const { data, error } = await sb.from('mensagens_whatsapp')
      .select('id, arquivo_nome, mime_type, arquivo_url, direcao, criado_em')
      .eq('conversa_id', conversaId)
      .not('arquivo_nome', 'is', null)
      .order('criado_em', { ascending: false });
    if (error) { console.warn('[wha.listarArquivos]', error.message); return res.json({ sucesso: true, dados: [] }); }
    return res.json({ sucesso: true, dados: data || [] });
  } catch (e) { console.error('[wha.listarArquivos]:', e.message); next(e); }
}

// ── GET /api/whatsapp/mensagens/:msgId/arquivo ────────────────────────────────
// Proxy autenticado para arquivos RECEBIDOS via Evolution/WhatsApp.
// Estratégia em duas camadas:
//   1. Tenta URL direta (arquivo_url no DB) — rápido, mas expira em ~5-15 min
//   2. Fallback: getBase64FromMediaMessage via Evolution — funciona por ~7 dias
async function proxyArquivoRecebido(req, res, next) {
  try {
    const { sb, isSupa } = getProvider();
    const { msgId } = req.params;
    if (!isSupa) return res.status(501).json({ sucesso: false, erro: 'Não disponível em modo SQLite.' });

    // 1. Busca mensagem
    let msg = null;
    try {
      const { data } = await sb.from('mensagens_whatsapp')
        .select('id, arquivo_url, arquivo_nome, mime_type, tipo, direcao, telefone, evolution_message_id, storage_path, storage_bucket')
        .eq('id', msgId).single();
      msg = data;
    } catch (e) { console.warn('[wha.proxy] DB:', e.message); }

    if (!msg) return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada.' });
    // Permite servir imagens enviadas SE têm storage_path ou evolution_message_id
    // (o CRM salva imagens enviadas sem arquivo_url mas com storage_path no Supabase)
    if (!msg.arquivo_url && msg.direcao !== 'recebida' && !msg.storage_path && !msg.evolution_message_id) {
      return res.status(404).json({ sucesso: false, erro: 'Arquivo enviado pelo CRM — sem cópia armazenada.' });
    }

    const nomeArquivo = msg.arquivo_nome || 'arquivo';
    const mimeType    = msg.mime_type || 'application/octet-stream';
    const evoKey      = process.env.EVOLUTION_API_KEY || '';

    // Pré-computa remoteJid correto para Layer 2 (getBase64Media)
    // REGRA DE RESOLUÇÃO (mesma do envio — mantida em sync):
    //   LID:XXXX  → XXXX@lid          (contatos Meta/WhatsApp Business)
    //   já tem @  → usa direto         (JID completo já armazenado)
    //   dígitos   → dígitos@s.whatsapp.net
    let remoteJid = null;
    {
      const _tel = (msg.telefone || '').trim();
      if (_tel.startsWith('LID:')) {
        const _lidNum = _tel.slice(4).replace(/\D/g, '');
        if (_lidNum) remoteJid = `${_lidNum}@lid`;
      } else if (_tel.includes('@')) {
        remoteJid = _tel;
      } else {
        const _digits = _tel.replace(/\D/g, '');
        if (_digits) remoteJid = `${_digits}@s.whatsapp.net`;
      }
    }

    const _tiposMidia   = ['arquivo', 'imagem', 'video', 'documento'];
    const isReceivedMedia = msg.direcao === 'recebida' && _tiposMidia.includes(msg.tipo);
    const waKeyId         = msg.evolution_message_id || null;

    // ══ ESTRATÉGIA ══════════════════════════════════════════════════════════════
    // Layer 0: Supabase Storage (storage_path) → permanente, sem expiração
    // Layer 2: Evolution getBase64FromMediaMessage → decripta (válido ~7 dias)
    // Layer 1: URL direta (arquivo_url) → fallback msgs antigas
    // ════════════════════════════════════════════════════════════════════════════

    // ── Layer 0: Supabase Storage — permanente, sem dependência da Evolution ──
    if (msg.storage_path) {
      const bucket = msg.storage_bucket || 'whatsapp-midias';
      try {
        const { data: fileBlob, error: dlErr } = await sb.storage.from(bucket).download(msg.storage_path);
        if (!dlErr && fileBlob) {
          const buf = Buffer.from(await fileBlob.arrayBuffer());
          const mime = msg.mime_type || mimeType;
          console.log('WA_INBOUND_FILE_STORAGE_SERVE', { msgId: msgId.slice(0,8), path: msg.storage_path, size: buf.length, mime });
          res.set('Content-Type', mime);
          res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nomeArquivo)}`);
          res.set('Cache-Control', 'private, max-age=86400'); // 24h — storage permanente
          res.set('Content-Length', buf.length);
          return res.send(buf);
        }
        console.warn('WA_INBOUND_FILE_STORAGE_FAIL', { msgId: msgId.slice(0,8), erro: dlErr?.message, path: msg.storage_path });
      } catch (e0) {
        console.warn('[wha.proxy] Layer 0 exception:', e0.message);
      }
    }

    // ── Layer 2: getBase64FromMediaMessage (sempre tenta primeiro para recebidas) ──
    if (isReceivedMedia && waKeyId && remoteJid && evoSvc.isConfigured()) {
      console.log('WA_INBOUND_FILE_DOWNLOAD_START', {
        msgId: msgId.slice(0,8), tipo: msg.tipo, nome: nomeArquivo, waKeyId: waKeyId.slice(0,8),
        strategy: 'Layer2-first (decriptado)',
      });
      try {
        const refetch = await evoSvc.getBase64Media(waKeyId, remoteJid);
        if (refetch.sucesso && refetch.dados?.base64) {
          const b64str  = refetch.dados.base64;
          const pureB64 = b64str.replace(/^data:[^;]+;base64,/, '');
          const buf     = Buffer.from(pureB64, 'base64');
          const mime    = refetch.dados.mimetype || mimeType;
          console.log('WA_INBOUND_FILE_DOWNLOAD_SUCCESS', { msgId: msgId.slice(0,8), mime, size: buf.length, nome: nomeArquivo });
          res.set('Content-Type', mime);
          res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nomeArquivo)}`);
          res.set('Cache-Control', 'private, max-age=3600');
          res.set('Content-Length', buf.length);
          return res.send(buf);
        }
        // Layer 2 falhou → tenta Layer 1 como último recurso
        console.warn('WA_INBOUND_FILE_LAYER2_FAIL', { erro: refetch.erro, waKeyId: waKeyId.slice(0,8) });
      } catch (e2) {
        console.warn('[wha.proxy] Layer 2 exception:', e2.message);
      }
    } else if (isReceivedMedia && !waKeyId) {
      // evolution_message_id ausente — mensagem recebida antes da atualização do sistema
      console.warn('WA_INBOUND_FILE_NO_EVOID', {
        msgId: msgId.slice(0,8), tipo: msg.tipo,
        info: 'evolution_message_id null — msg anterior ao fix. Tentando Layer 1 (pode ser encriptado).',
      });
    }

    // ── Layer 1: URL direta (fallback para msgs antigas ou Layer 2 indisponível) ──
    if (msg.arquivo_url) {
      let upstream = null;
      try {
        upstream = await fetch(msg.arquivo_url, {
          headers: evoKey ? { apikey: evoKey, 'x-api-key': evoKey } : {},
        });
        if (!upstream.ok && evoKey) upstream = await fetch(msg.arquivo_url);
      } catch (e) {
        console.warn('[wha.proxy] Layer 1 falhou (rede):', e.message);
        upstream = null;
      }

      if (upstream?.ok) {
        const ct = upstream.headers.get('content-type') || mimeType;
        console.log('WA_INBOUND_FILE_LAYER1_SERVE', { msgId: msgId.slice(0,8), nome: nomeArquivo, ct });
        res.set('Content-Type', ct);
        res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nomeArquivo)}`);
        res.set('Cache-Control', 'private, max-age=600');
        try {
          const { Readable } = require('stream');
          if (Readable.fromWeb && upstream.body) { Readable.fromWeb(upstream.body).pipe(res); return; }
        } catch {}
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.set('Content-Length', buf.length);
        return res.send(buf);
      }
      console.warn('[wha.proxy] Layer 1 URL expirada/inválida:', { status: upstream?.status, msgId: msgId.slice(0,8) });
    }

    // ── Ambos falharam ─────────────────────────────────────────────────────────
    const erroFinal = isReceivedMedia && !waKeyId
      ? 'Arquivo recebido antes da atualização do sistema. Peça ao contato para reenviar o arquivo.'
      : 'Mídia expirou na Evolution API (~7 dias). O arquivo ainda está no WhatsApp do usuário.';
    console.warn('WA_INBOUND_FILE_ALL_LAYERS_FAILED', { msgId: msgId.slice(0,8), waKeyId: waKeyId?.slice(0,8), hasUrl: !!msg.arquivo_url });
    return res.status(404).json({ sucesso: false, erro: erroFinal });

  } catch (e) { console.error('[wha.proxy] ERRO:', e.message, e.stack); next(e); }
}


// ── GET /api/whatsapp/arquivos/:arqId/download ────────────────────────────────
async function downloadArquivo(req, res, next) {
  try {
    const { sb, isSupa } = getProvider();
    const { arqId } = req.params;
    if (!isSupa) return res.status(501).json({ sucesso: false, erro: 'Não disponível em modo SQLite.' });

    let msg = null;
    try {
      const { data } = await sb.from('mensagens_whatsapp')
        .select('arquivo_url, arquivo_nome, mime_type, direcao').eq('id', arqId).single();
      msg = data;
    } catch {}

    if (msg?.arquivo_url) { req.params.msgId = arqId; return proxyArquivoRecebido(req, res, next); }

    let arq = null;
    try {
      const { data } = await sb.from('mensagens_whatsapp_arquivos').select('*').eq('id', arqId).single();
      arq = data;
    } catch {}

    if (!arq) return res.status(404).json({ sucesso: false, erro: 'Arquivo não encontrado.' });

    const BUCKET_WA = 'whatsapp-arquivos';
    const nomeOriginal = arq.nome_original || 'arquivo';

    if (arq.storage_path) {
      try {
        const { data: sd, error: se } = await sb.storage.from(BUCKET_WA).createSignedUrl(arq.storage_path, 300);
        if (!se && sd?.signedUrl) {
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nomeOriginal)}"`);
          return res.redirect(302, sd.signedUrl);
        }
      } catch {}
      try {
        const { data: blob, error: de } = await sb.storage.from(BUCKET_WA).download(arq.storage_path);
        if (!de && blob) {
          const buf = Buffer.from(await blob.arrayBuffer());
          res.set('Content-Type', arq.mime_type || 'application/octet-stream');
          res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(nomeOriginal)}"`);
          res.set('Content-Length', buf.length);
          return res.send(buf);
        }
      } catch {}
    }

    if (arq.public_url) {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nomeOriginal)}"`);
      return res.redirect(302, arq.public_url);
    }

    return res.status(404).json({ sucesso: false, erro: 'Arquivo não disponível para download.' });

  } catch (e) { console.error('[wha.downloadArquivo] ERRO:', e.message, e.stack); next(e); }
}

module.exports = {
  upload,
  handleUploadError,
  getTempMedia,
  enviarArquivo,
  listarArquivos,
  downloadArquivo,
  proxyArquivoRecebido,
};
