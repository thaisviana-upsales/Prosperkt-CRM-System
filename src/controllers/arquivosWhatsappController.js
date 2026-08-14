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

const LIMITE_WA_BYTES = 64 * 1024 * 1024;
const LIMITE_WA_MB    = 64;

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

    // 2. Validações
    if (!extPermitida(arqNome))
      return res.status(400).json({ sucesso: false, erro: 'Tipo de arquivo não permitido.' });
    if (arqBuffer.length > LIMITE_WA_BYTES)
      return res.status(413).json({ sucesso: false, erro: `Arquivo excede ${LIMITE_WA_MB} MB.` });
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

    const telNorm = conversa.telefone?.replace(/\D/g, '');
    if (!telNorm)
      return res.status(400).json({ sucesso: false, erro: 'Conversa sem telefone válido.' });

    const agora      = new Date().toISOString();
    const nomeSeguro = sanitizarNome(arqNome);
    const msgId      = crypto.randomBytes(16).toString('hex');
    const mediatype  = resolveMediatype(arqMime);

    // 4. Monta media para Evolution
    //    REGRA: audio → base64 (funciona)
    //           image/video/document → URL pública (base64 retorna 400 nesses tipos)
    let media;
    let tempToken = null;

    if (mediatype === 'audio') {
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
      console.log('[wha.enviarArquivo] doc/img/vid→URL', nomeSeguro, mediatype, fmtTamanho(arqBuffer.length));
    }

    // 5. Envia à Evolution
    let evoOk    = false;
    let evoErro  = null;
    let evoMsgId = null;

    try {
      const evoRes = await evoSvc.enviarMidia(telNorm, {
        mediatype,
        mimetype: arqMime,
        caption:  req.body?.caption || nomeSeguro,
        media,
        fileName: nomeSeguro,
      });

      if (evoRes.sucesso || evoRes.dados?.key?.id) {
        evoOk    = true;
        evoMsgId = evoRes.dados?.key?.id || null;
        console.log('[wha.enviarArquivo] Evolution OK', { evoMsgId, nomeSeguro });
      } else {
        evoErro = evoRes.erro || JSON.stringify(evoRes.dados) || 'Evolution rejeitou.';
        console.error('[wha.enviarArquivo] Evolution rejeitou:', evoErro, 'status:', evoRes.status);
      }
    } catch (e) {
      evoErro = e.message;
      console.error('[wha.enviarArquivo] Evolution exception:', e.message);
    } finally {
      // Limpa temp file 60s após envio (Evolution já baixou)
      if (tempToken) setTimeout(() => tempFiles.delete(tempToken), 60 * 1000);
    }

    if (!evoOk)
      return res.status(502).json({ sucesso: false, erro: evoErro || 'Falha ao enviar pelo WhatsApp.' });

    // 6. Salva histórico
    let mensagemSalva = null;
    if (isSupa) {
      try {
        const tipoDb = mediatype === 'image' ? 'imagem' : mediatype === 'video' ? 'video' : 'arquivo';
        const { data: msgData } = await sb.from('mensagens_whatsapp').insert({
          id: msgId, conversa_id: conversaId,
          lead_id:     conversa.lead_id || null,
          telefone:    conversa.telefone,
          mensagem:    req.body?.caption || nomeSeguro,
          tipo:        tipoDb,
          direcao:     'enviada',
          status:      'enviado',
          vendedor_id: req.usuario?.id || null,
          arquivo_url: null,
          arquivo_nome: nomeSeguro,
          mime_type:   arqMime,
          criado_em:   agora,
        }).select().single();
        if (msgData) mensagemSalva = { ...msgData, vendedor_nome: req.usuario?.nome || null };
      } catch (e) {
        console.warn('[wha.enviarArquivo] histórico warn:', e.message);
      }

      await sb.from('conversas_whatsapp').update({
        ultima_msg_em: agora, atualizado_em: agora,
        ultima_mensagem: `📎 ${nomeSeguro}`, status: 'ABERTA',
      }).eq('id', conversaId).catch(() => {});
    }

    return res.status(201).json({
      sucesso: true,
      dados: mensagemSalva || {
        id: msgId, conversa_id: conversaId,
        tipo: mediatype === 'image' ? 'imagem' : mediatype === 'video' ? 'video' : 'arquivo',
        arquivo_url: null, arquivo_nome: nomeSeguro,
        mime_type: arqMime, mensagem: nomeSeguro,
        direcao: 'enviada', status: 'enviado', criado_em: agora,
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
    if (!msg.arquivo_url && msg.direcao !== 'recebida') {
      return res.status(404).json({ sucesso: false, erro: 'Arquivo enviado pelo CRM — sem cópia armazenada. Veja no WhatsApp.' });
    }

    const nomeArquivo = msg.arquivo_nome || 'arquivo';
    const mimeType    = msg.mime_type || 'application/octet-stream';
    const evoKey      = process.env.EVOLUTION_API_KEY || '';

    // Pré-computa remoteJid (necessário para Layer 2)
    const telNumeros = (msg.telefone || '').replace(/\D/g, '');
    const remoteJid  = telNumeros
      ? (msg.telefone?.includes('@') ? msg.telefone : `${telNumeros}@s.whatsapp.net`)
      : null;

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
