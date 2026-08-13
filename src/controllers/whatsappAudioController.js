/**
 * PROSPEKT CRM — WhatsApp Audio Controller (Módulo Isolado)
 * ──────────────────────────────────────────────────────────
 * Gerencia envio e recebimento de áudio pelo WhatsApp.
 * NÃO altera e NÃO importa lógica de whatsappController.js.
 * Arquivos salvos no bucket 'whatsapp-midias' (privado).
 *
 * Endpoints registrados em src/routes/api.js:
 *   POST   /api/whatsapp/audio/send
 *   POST   /api/whatsapp/audio/sync-conversa/:conversaId
 *   GET    /api/whatsapp/audio/play/:msgId
 */

'use strict';

const crypto    = require('crypto');
const multer    = require('multer');
const { getProvider } = require('../database/dbProvider');
const evoSvc    = require('../services/evolutionApiService');

// ─── Constantes ──────────────────────────────────────────────────────────────
const BUCKET         = 'whatsapp-midias';
const CONVERSAS_TABLE = 'conversas_whatsapp';
const MENSAGENS_TABLE = 'mensagens_whatsapp';
const LIMITE_AUDIO_MB = 16;
const LIMITE_AUDIO_BYTES = LIMITE_AUDIO_MB * 1024 * 1024;

// ─── Multer — memória, somente áudio ─────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: LIMITE_AUDIO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('audio/')) {
      return cb(Object.assign(new Error('Apenas arquivos de áudio são permitidos.'), { code: 'AUDIO_ONLY' }));
    }
    cb(null, true);
  },
});

function handleUploadError(err, req, res, next) {
  if (err?.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ sucesso: false, erro: `Áudio excede o limite de ${LIMITE_AUDIO_MB} MB.` });
  if (err?.code === 'AUDIO_ONLY')
    return res.status(400).json({ sucesso: false, erro: err.message });
  next(err);
}

// ─── Helper: extensão a partir do mimetype ───────────────────────────────────
function extFromMime(mime = '') {
  if (mime.includes('ogg'))  return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('m4a') || mime.includes('mp4'))  return 'm4a';
  if (mime.includes('wav'))  return 'wav';
  return 'ogg';
}

// ─── Helper: normalização mínima de telefone (sem tocar normalizePhone) ───────
function telSoDigitos(tel = '') {
  return tel.replace(/\D/g, '');
}

// ─── Helper: gera signed URL longa (1 ano) ───────────────────────────────────
async function gerarSignedUrl(sb, storagePath, expiresIn = 3600 * 24 * 365) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ─── Helper: busca conversa e valida permissão ───────────────────────────────
async function buscarConversa(sb, conversaId, usuario) {
  const { data, error } = await sb
    .from(CONVERSAS_TABLE)
    .select('*')
    .eq('id', conversaId)
    .single();
  if (error || !data) return null;
  // GESTOR acessa tudo; VENDEDOR só suas conversas
  if (usuario.role === 'VENDEDOR' && data.vendedor_id && data.vendedor_id !== usuario.id) return null;
  return data;
}

// ─── Helper: resolve telefone real da conversa ────────────────────────────────
async function resolverTelefone(sb, conversa) {
  let tel = conversa.telefone || '';
  if (tel.startsWith('LID:') || tel.includes('@lid') || !tel) {
    // Tenta buscar pelo lead
    if (conversa.lead_id) {
      const { data: ld } = await sb.from('leads').select('telefone').eq('id', conversa.lead_id).single();
      if (ld?.telefone && !ld.telefone.startsWith('LID:')) tel = ld.telefone;
    }
  }
  const digits = telSoDigitos(tel);
  if (!digits || digits.length < 8) return null;
  return digits;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/audio/send
// multipart/form-data: { audio (file), conversa_id, lead_id? }
// ─────────────────────────────────────────────────────────────────────────────
async function enviarAudio(req, res) {
  try {
    const { sb, isSupa } = getProvider();

    console.log('WA_AUDIO_SEND_ENDPOINT_HIT', { hasUser: !!req.usuario, hasFile: !!req.file });

    if (!isSupa) return res.status(400).json({ sucesso: false, erro: 'Storage requer Supabase.' });

    const conversaId = req.body?.conversa_id;
    const arquivo    = req.file;

    // ── Validações ──────────────────────────────────────────────────────────────────
    if (!conversaId)
      return res.status(400).json({ sucesso: false, erro: 'conversa_id obrigatório.' });
    if (!arquivo)
      return res.status(400).json({ sucesso: false, erro: 'Arquivo de áudio não recebido.' });
    if (arquivo.size === 0)
      return res.status(400).json({ sucesso: false, erro: 'Arquivo de áudio vazio.' });
    if (!arquivo.mimetype.startsWith('audio/'))
      return res.status(400).json({ sucesso: false, erro: 'Formato de áudio não suportado.' });

    console.log('WA_AUDIO_AUTH_OK',       { usuario: req.usuario?.id });
    console.log('WA_AUDIO_FILE_RECEIVED', { size: arquivo.size, mime: arquivo.mimetype, conversaId });

    // ── 1. Busca conversa ────────────────────────────────────────────────────
    const conversa = await buscarConversa(sb, conversaId, req.usuario);
    if (!conversa)
      return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada ou acesso negado.' });

    // ── 2. Resolve telefone ──────────────────────────────────────────────────
    const telNormalizado = await resolverTelefone(sb, conversa);
    if (!telNormalizado)
      return res.status(400).json({ sucesso: false, erro: 'Conversa sem telefone válido para envio.' });

    // ── 3. Upload para Supabase Storage ───────────────────────────────────────────────────────────────────────────
    console.log('WHATSAPP_AUDIO_FILE_VALIDATED', { size: arquivo.size, mime: arquivo.mimetype });

    const ext         = extFromMime(arquivo.mimetype);
    const ts          = Date.now();
    const msgId       = crypto.randomBytes(16).toString('hex');
    const storagePath = `whatsapp/conversas/${conversaId}/audios/enviados/${ts}.${ext}`;

    const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, arquivo.buffer, {
      contentType: arquivo.mimetype,
      upsert: false,
    });

    if (upErr) {
      console.warn('WA_AUDIO_STORAGE_UPLOAD_ERROR', { erro: upErr.message });
      return res.status(500).json({ sucesso: false, erro: 'Falha ao salvar áudio no Storage.' });
    }
    console.log('WA_AUDIO_STORAGE_UPLOAD_SUCCESS', { storagePath, bucket: BUCKET, bytes: arquivo.size });

    // ── 4. Converte buffer para base64 puro (sem prefixo data URI) ─────────────
    // Evolution API v2 exige: URL ou base64 puro — NÃO aceita "data:...;base64,..."
    const base64Audio = arquivo.buffer.toString('base64');
    console.log('WA_AUDIO_BASE64_READY', { mime: arquivo.mimetype, bytes: arquivo.size });

    // ── 5. Envia pela Evolution ────────────────────────────────────────────────
    console.log('WA_AUDIO_EVOLUTION_SEND_START', { telefone: telNormalizado });
    let evoOk  = false;
    let evoErr = null;

    if (evoSvc.isConfigured()) {
      // Tentativa 1: sendWhatsAppAudio (PTT/voz) com base64 puro
      let evoResult = await evoSvc.enviarAudio(telNormalizado, base64Audio);
      evoOk = !!(evoResult.sucesso || evoResult.dados?.key?.id);

      if (!evoOk) {
        const pttErr   = evoResult.erro || 'sem detalhe';
        const pttDados = JSON.stringify(evoResult.dados || {}).slice(0, 300);
        console.warn('WA_AUDIO_PTT_FAIL', { erro: pttErr, status: evoResult.status, dados: pttDados });

        // Tentativa 2: sendMedia com mediatype=audio e base64 puro
        console.log('WA_AUDIO_SENDMEDIA_FALLBACK_START', { telefone: telNormalizado });
        evoResult = await evoSvc.enviarMidia(telNormalizado, {
          mediatype: 'audio',
          mimetype:  arquivo.mimetype,
          media:     base64Audio,         // base64 puro — sem data URI
          fileName:  `audio_${ts}.${ext}`,
          caption:   '',
        });
        evoOk = !!(evoResult.sucesso || evoResult.dados?.key?.id);
        if (evoOk) {
          console.log('WA_AUDIO_SENDMEDIA_FALLBACK_SUCCESS', { msgId: evoResult.dados?.key?.id });
        } else {
          const mediaErr   = evoResult.erro || 'sem detalhe';
          const mediaDados = JSON.stringify(evoResult.dados || {}).slice(0, 300);
          console.warn('WA_AUDIO_SENDMEDIA_FALLBACK_FAIL', { erro: mediaErr, status: evoResult.status, dados: mediaDados });
        }
      } else {
        console.log('WA_AUDIO_EVOLUTION_SEND_SUCCESS', { msgId: evoResult.dados?.key?.id });
      }

      evoErr = evoOk ? null : (evoResult.erro || 'Evolution rejeitou o áudio');
    } else {
      console.warn('WA_AUDIO_EVOLUTION_NOT_CONFIGURED');
    }


    // ── 6. Gera signed URL longa para banco (1 ano) ───────────────────────────────────────────────────────────────────────────────
    const longSignedUrl = await gerarSignedUrl(sb, storagePath, 3600 * 24 * 365);

    // ── 7a. INSERT com colunas GARANTIDAS (base schema — nunca falha por coluna ausente) ─
    const agora       = new Date().toISOString();
    const arquivoNome = `audio_${ts}.${ext}`;
    const coreInsert  = {

      id:           msgId,
      conversa_id:  conversaId,
      lead_id:      conversa.lead_id || null,
      telefone:     telNormalizado,
      mensagem:     null,
      tipo:         'audio',
      direcao:      'enviada',
      status:       evoOk ? 'enviado' : 'erro',
      vendedor_id:  req.usuario.id,
      arquivo_url:  longSignedUrl || storagePath,
      arquivo_nome: arquivoNome,
      criado_em:    agora,
    };

    const { error: errInsert } = await sb.from(MENSAGENS_TABLE).insert(coreInsert);
    if (errInsert) {
      console.warn('WA_AUDIO_MESSAGE_DB_ERROR', { erro: errInsert.message });
      // Não falha a request — áudio já foi enviado pela Evolution
    } else {
      console.log('WA_AUDIO_MESSAGE_DB_SAVED', { msgId, storagePath, evoOk });

      // ── 7b. UPDATE colunas opcionais (patch v44+) — best-effort, falha silenciosa ─
      const optCols = {
        mime_type:      arquivo.mimetype,
        storage_bucket: BUCKET,
        storage_path:   storagePath,
      };
      const { error: optErr } = await sb.from(MENSAGENS_TABLE).update(optCols).eq('id', msgId);
      if (optErr) {
        console.warn('WA_AUDIO_MESSAGE_DB_OPT_COLS_SKIP', { erro: optErr.message });
      } else {
        console.log('WA_AUDIO_MESSAGE_DB_OPT_COLS_SAVED', { msgId });
      }
    }


    // ── 8. Atualiza conversa ───────────────────────────────────────────────
    try {
      await sb.from(CONVERSAS_TABLE).update({
        ultima_mensagem: '[Áudio]',
        ultima_direcao:  'enviada',
        ultima_msg_em:   agora,
        atualizado_em:   agora,
        status:          'ABERTA',
      }).eq('id', conversaId);
    } catch { /* não crítico */ }

    console.log('WA_AUDIO_SEND_DONE', { msgId, conversaId, evoOk });

    // ── 9. Retorna mensagem para o frontend renderizar ───────────────────────────────────────────────────────────────────────────────
    return res.status(201).json({
      sucesso: true,
      dados: {
        id:           msgId,
        conversa_id:  conversaId,
        lead_id:      conversa.lead_id || null,
        mensagem:     null,
        tipo:         'audio',
        direcao:      'enviada',
        status:       evoOk ? 'enviado' : 'erro',
        vendedor_id:  req.usuario.id,
        arquivo_url:  longSignedUrl || storagePath,
        arquivo_nome: arquivoNome,
        mime_type:    arquivo.mimetype,
        storage_path: storagePath,
        storage_bucket: BUCKET,
        criado_em:    agora,
      },
      _evo_ok: evoOk,
      _evo_err: evoErr,
    });

  } catch (e) {
    console.error('WA_AUDIO_SEND_ERROR', e.message);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao enviar áudio.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/audio/sync-conversa/:conversaId
// Sincroniza áudios recebidos: baixa via Evolution → salva Storage → atualiza banco
// ─────────────────────────────────────────────────────────────────────────────
async function sincronizarAudios(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    if (!isSupa) return res.status(400).json({ sucesso: false, erro: 'Storage requer Supabase.' });

    const { conversaId } = req.params;
    const conversa = await buscarConversa(sb, conversaId, req.usuario);
    if (!conversa)
      return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });

    console.log('WA_AUDIO_RECEIVED_SYNC_START', { conversaId, usuario: req.usuario?.id });

    // Busca mensagens de áudio recebidas sem storage_path
    const { data: msgs, error: errM } = await sb
      .from(MENSAGENS_TABLE)
      .select('id, arquivo_url, arquivo_nome, mime_type, evolution_message_id, telefone, criado_em')
      .eq('conversa_id', conversaId)
      .eq('tipo', 'audio')
      .eq('direcao', 'recebida')
      .is('storage_path', null)
      .order('criado_em', { ascending: false })
      .limit(20);

    if (errM) {
      return res.status(500).json({ sucesso: false, erro: 'Erro ao buscar mensagens.' });
    }
    if (!msgs || msgs.length === 0) {
      return res.json({ sucesso: true, sincronizados: 0, mensagem: 'Nenhum áudio pendente de sincronização.' });
    }

    const resultados = [];
    for (const msg of msgs) {
      try {
        if (!msg.evolution_message_id) {
          resultados.push({ id: msg.id, status: 'sem_evolution_id' });
          continue;
        }

        // Determina remoteJid a partir do telefone
        const remoteJid = msg.telefone
          ? (msg.telefone.includes('@') ? msg.telefone : `${msg.telefone}@s.whatsapp.net`)
          : null;
        if (!remoteJid) {
          resultados.push({ id: msg.id, status: 'sem_telefone' });
          continue;
        }

        // Baixa mídia via Evolution
        const evoMedia = await evoSvc.getBase64Media(msg.evolution_message_id, remoteJid);
        if (!evoMedia.sucesso || !evoMedia.dados?.base64) {
          resultados.push({ id: msg.id, status: 'evolution_falhou', erro: evoMedia.erro });
          continue;
        }

        // Faz upload para Storage
        const mime      = evoMedia.dados.mimetype || msg.mime_type || 'audio/ogg';
        const ext       = extFromMime(mime);
        const ts        = new Date(msg.criado_em).getTime() || Date.now();
        const storagePath = `whatsapp/conversas/${conversaId}/audios/recebidos/${ts}.${ext}`;
        const b64Data   = evoMedia.dados.base64.includes(',')
          ? evoMedia.dados.base64.split(',')[1]
          : evoMedia.dados.base64;
        const buf = Buffer.from(b64Data, 'base64');

        const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buf, {
          contentType: mime, upsert: true,
        });
        if (upErr) {
          resultados.push({ id: msg.id, status: 'storage_upload_falhou', erro: upErr.message });
          continue;
        }
        console.log('WA_AUDIO_RECEIVED_STORAGE_SUCCESS', { msgId: msg.id, storagePath });

        // Gera signed URL longa
        const signedUrl = await gerarSignedUrl(sb, storagePath, 3600 * 24 * 365);

        // Atualiza mensagem no banco
        await sb.from(MENSAGENS_TABLE).update({
          arquivo_url:    signedUrl || msg.arquivo_url,
          storage_path:   storagePath,
          storage_bucket: BUCKET,
        }).eq('id', msg.id);

        resultados.push({ id: msg.id, status: 'ok', storagePath });

      } catch (eSync) {
        resultados.push({ id: msg.id, status: 'erro', erro: eSync.message });
      }
    }

    const qtdOk = resultados.filter(r => r.status === 'ok').length;
    return res.json({ sucesso: true, sincronizados: qtdOk, total: msgs.length, resultados });

  } catch (e) {
    console.error('WHATSAPP_AUDIO_SYNC_ERROR', e.message);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno na sincronização.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/audio/play/:msgId
// Gera signed URL fresca e redireciona — para recarregamento de áudios vencidos
// ─────────────────────────────────────────────────────────────────────────────
async function servirAudioAssinado(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    if (!isSupa) return res.status(400).json({ sucesso: false, erro: 'Storage requer Supabase.' });

    const { msgId } = req.params;
    const { data: msg } = await sb
      .from(MENSAGENS_TABLE)
      .select('storage_path, storage_bucket, conversa_id, direcao')
      .eq('id', msgId)
      .single();

    if (!msg?.storage_path) {
      return res.status(404).json({ sucesso: false, erro: 'Áudio não encontrado no Storage.' });
    }

    const bucket = msg.storage_bucket || BUCKET;
    const { data: signed } = await sb.storage.from(bucket).createSignedUrl(msg.storage_path, 3600);
    if (!signed?.signedUrl) {
      return res.status(502).json({ sucesso: false, erro: 'Não foi possível gerar URL de acesso.' });
    }

    res.set('Cache-Control', 'private, max-age=3540');
    return res.redirect(302, signed.signedUrl);

  } catch (e) {
    console.error('WHATSAPP_AUDIO_PLAY_ERROR', e.message);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao servir áudio.' });
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/audio/health
// Confirma que o módulo isolado de áudio está registrado
// ───────────────────────────────────────────────────────────────────────────────
function health(req, res) {
  console.log('WA_AUDIO_ROUTE_READY', { routes: 4 });
  return res.json({
    sucesso: true,
    module:  'whatsapp-audio',
    routes:  [
      'POST /api/whatsapp/audio/send',
      'POST /api/whatsapp/audio/sync-conversa/:conversaId',
      'GET  /api/whatsapp/audio/play/:msgId',
      'GET  /api/whatsapp/audio/health',
    ],
    bucket: BUCKET,
  });
}

module.exports = {
  upload,
  handleUploadError,
  enviarAudio,
  sincronizarAudios,
  servirAudioAssinado,
  health,
};
