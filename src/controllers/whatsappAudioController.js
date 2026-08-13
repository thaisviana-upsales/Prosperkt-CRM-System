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
const { tentarConverter } = require('../utils/audioConverter');

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
  if (error) console.warn('WA_AUDIO_SIGNED_URL_ERROR', { storagePath, err: error.message, code: error.statusCode });
  if (!data?.signedUrl) console.warn('WA_AUDIO_SIGNED_URL_NULL', { storagePath, hasData: !!data });
  else console.log('WA_AUDIO_SIGNED_URL_OK', { bytes: data.signedUrl.length });
  return data?.signedUrl || null;
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

    // ── Duração enviada pelo frontend (lida do wa-rec-timer) ────────────────────
    const duracaoStr = req.body?.duracao;
    const duracaoSeg = duracaoStr ? parseInt(duracaoStr, 10) : null;

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

    // ── 4. Converte buffer para base64 puro (sem prefixo data URI) ──────────────
    // Tenta converter WebM → OGG Opus (formato nativo WhatsApp)
    // Se ffmpeg não estiver disponível, usa WebM como fallback
    console.log('WA_AUDIO_EVOLUTION_SEND_START', { telefone: telNormalizado });

    let audioBuffer    = arquivo.buffer;
    let audioMime      = arquivo.mimetype;
    let audioConverted = false;

    const oggBuffer = await tentarConverter(arquivo.buffer);
    if (oggBuffer && oggBuffer.length > 0) {
      audioBuffer    = oggBuffer;
      audioMime      = 'audio/ogg; codecs=opus';
      audioConverted = true;
      console.log('WA_AUDIO_CONVERTED_OGG', { originalBytes: arquivo.size, oggBytes: oggBuffer.length });
    } else {
      console.warn('WA_AUDIO_CONVERTER_UNAVAILABLE — enviando WebM como fallback');
    }

    const base64Audio = audioBuffer.toString('base64');
    console.log('WA_AUDIO_BASE64_READY', { mime: audioMime, bytes: audioBuffer.length, converted: audioConverted });

    // ── 5. Envia como mensagem de áudio via sendMedia ───────────────────────────
    let evoOk  = false;
    let evoErr = null;

    if (evoSvc.isConfigured()) {
      const evoResult = await evoSvc.enviarAudio(telNormalizado, base64Audio, audioMime);
      evoOk  = !!(evoResult.sucesso || evoResult.dados?.key?.id);
      evoErr = evoOk ? null : (evoResult.erro || 'Evolution rejeitou the áudio');

      if (evoOk) {
        console.log('WA_AUDIO_EVOLUTION_SEND_SUCCESS', {
          msgId:     evoResult.dados?.key?.id,
          mime:      audioMime,
          converted: audioConverted,
        });
      } else {
        const errDados = JSON.stringify(evoResult.dados || {}).slice(0, 400);
        console.warn('WA_AUDIO_EVOLUTION_SEND_FAIL', {
          erro:   evoErr,
          status: evoResult.status,
          dados:  errDados,
        });
      }
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
      arquivo_url:    longSignedUrl || storagePath,
      arquivo_nome: arquivoNome,
      criado_em:    agora,
      ...(duracaoSeg ? { media_duration: duracaoSeg } : {}),
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
        id:              msgId,
        conversa_id:     conversaId,
        lead_id:         conversa.lead_id || null,
        mensagem:        null,
        tipo:            'audio',
        direcao:         'enviada',
        status:          evoOk ? 'enviado' : 'erro',
        vendedor_id:     req.usuario.id,
        arquivo_url:     longSignedUrl || storagePath,
        arquivo_nome:    arquivoNome,
        mime_type:       arquivo.mimetype,
        storage_path:    storagePath,
        storage_bucket:  BUCKET,
        media_duration:  duracaoSeg || null,
        criado_em:       agora,
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
    let   convCache   = null; // cache da conversa p/ evitar N queries para LID

    console.log('WA_AUDIO_SYNC_MSGS_FOUND', {
      total: msgs.length,
      evoIds: msgs.map(m => m.evolution_message_id ? m.evolution_message_id.slice(0,12) : 'NULL'),
      phones: msgs.map(m => m.telefone || 'NULL'),
    });

    for (const msg of msgs) {
      try {
        if (!msg.evolution_message_id) {
          console.warn('WA_AUDIO_SYNC_SEM_EVO_ID', { msgId: msg.id });
          resultados.push({ id: msg.id, status: 'sem_evolution_id' });
          continue;
        }

        // ── Determina remoteJid ───────────────────────────────────────────────
        // Prioridade 1: telefone direto da mensagem
        let remoteJid = msg.telefone
          ? (msg.telefone.includes('@') ? msg.telefone : `${telSoDigitos(msg.telefone)}@s.whatsapp.net`)
          : null;

        // Prioridade 2: dados da conversa (LID JIDs têm dados_extras.remoteJid)
        if (!remoteJid) {
          if (!convCache) {
            const { data: cd } = await sb.from(CONVERSAS_TABLE)
              .select('telefone, dados_extras').eq('id', conversaId).single();
            convCache = cd || {};
          }
          if (convCache.telefone && !convCache.telefone.startsWith('LID:')) {
            const d = telSoDigitos(convCache.telefone);
            if (d && d.length >= 10) remoteJid = `${d}@s.whatsapp.net`;
          }
          if (!remoteJid && convCache.dados_extras) {
            try {
              const ex = typeof convCache.dados_extras === 'string'
                ? JSON.parse(convCache.dados_extras)
                : convCache.dados_extras;
              remoteJid = ex?.remoteJid || null;
            } catch (_) {}
          }
        }

        if (!remoteJid) {
          console.warn('WA_AUDIO_SYNC_SEM_REMOTEJID', { msgId: msg.id, telefone: msg.telefone });
          resultados.push({ id: msg.id, status: 'sem_remoteJid' });
          continue;
        }

        console.log('WA_AUDIO_SYNC_EVO_CALL', {
          msgId:    msg.id,
          evoId:    msg.evolution_message_id.slice(0,16),
          jid:      remoteJid.slice(0,20),
        });

        // Baixa mídia via Evolution
        const evoMedia = await evoSvc.getBase64Media(msg.evolution_message_id, remoteJid);

        console.log('WA_AUDIO_SYNC_EVO_RESULT', {
          msgId:    msg.id,
          sucesso:  evoMedia.sucesso,
          hasBase64: !!evoMedia.dados?.base64,
          erro:     evoMedia.erro || null,
          status:   evoMedia.status || null,
        });

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
          console.warn('WA_AUDIO_SYNC_UPLOAD_FAIL', { msgId: msg.id, erro: upErr.message });
          resultados.push({ id: msg.id, status: 'storage_upload_falhou', erro: upErr.message });
          continue;
        }
        // Gera signed URL longa — fallback para base64 se Supabase falhar
        const signedUrl = await gerarSignedUrl(sb, storagePath, 3600 * 24 * 365);

        // Atualiza mensagem no banco
        // IMPORTANTE: se signedUrl=null, usa base64 embutido (servirMidia trata data: nativamente)
        // Nunca usa storagePath relativo — quebra o fetch() do Node.js em servirMidia
        const arquivoUrlFinal = signedUrl
          || `data:${mime};base64,${b64Data}`;

        await sb.from(MENSAGENS_TABLE).update({
          arquivo_url:    arquivoUrlFinal,
          storage_path:   storagePath,
          storage_bucket: BUCKET,
          mime_type:      mime,
        }).eq('id', msg.id);

        console.log('WA_AUDIO_RECEIVED_SYNC_SAVED', {
          msgId: msg.id,
          storagePath,
          urlType: signedUrl ? 'signed_url' : 'base64_fallback',
        });
        resultados.push({ id: msg.id, status: 'sincronizado', storagePath });

      } catch (eSync) {
        console.error('WA_AUDIO_SYNC_MSG_ERROR', { msgId: msg.id, erro: eSync.message });
        resultados.push({ id: msg.id, status: 'erro', erro: eSync.message });
      }
    }

    const qtdOk = resultados.filter(r => r.status === 'sincronizado').length;
    return res.json({ sucesso: true, sincronizados: qtdOk, total: msgs.length, resultados });

  } catch (e) {
    console.error('WHATSAPP_AUDIO_SYNC_ERROR', e.message);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno na sincronização.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/audio/play/:msgId
// Serve áudio diretamente (sem redirect) — funciona sem auth para <audio> element.
// Caso 1 — áudio enviado: busca no Supabase Storage via storage_path
// Caso 2 — áudio recebido: baixa da Evolution API, faz upload no Supabase, serve
// Segurança: msgId é UUID 32 hex opaco — não-adivinhável
// ─────────────────────────────────────────────────────────────────────────────
async function servirAudioAssinado(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    if (!isSupa) return res.status(400).end();

    const { msgId } = req.params;
    if (!msgId) return res.status(400).end();

    const { data: msg, error: msgErr } = await sb
      .from(MENSAGENS_TABLE)
      .select('id, storage_path, storage_bucket, arquivo_url, mime_type, direcao, conversa_id')
      .eq('id', msgId)
      .single();

    if (msgErr || !msg) {
      console.warn('WA_AUDIO_PLAY_NOT_FOUND', { msgId });
      return res.status(404).end();
    }

    // ── Caso 1: áudio enviado — já está no Supabase Storage ─────────────────
    if (msg.storage_path) {
      const bucket = msg.storage_bucket || BUCKET;
      const { data: fileBlob, error: dlErr } = await sb.storage.from(bucket).download(msg.storage_path);
      if (dlErr || !fileBlob) {
        console.warn('WA_AUDIO_PLAY_STORAGE_ERR', { msgId, erro: dlErr?.message });
        return res.status(502).end();
      }
      const buf = Buffer.from(await fileBlob.arrayBuffer());
      const mime = msg.mime_type || 'audio/ogg';
      res.set('Content-Type',   mime);
      res.set('Content-Length', buf.length);
      res.set('Cache-Control',  'private, max-age=86400');
      res.set('Accept-Ranges',  'bytes');
      console.log('WA_AUDIO_PLAY_SERVED_STORAGE', { msgId, bytes: buf.length, mime });
      return res.send(buf);
    }

    // ── Caso 2: áudio recebido — arquivo_url é URL da Evolution ─────────────
    const evoUrl = msg.arquivo_url;
    if (!evoUrl || evoUrl.startsWith('/api/')) {
      console.warn('WA_AUDIO_PLAY_NO_SOURCE', { msgId, evoUrl: evoUrl || '(null)' });
      return res.status(404).end();
    }

    const evoKey  = process.env.EVOLUTION_API_KEY || '';
    const fetchFn = globalThis.fetch || (await import('node-fetch').then(m => m.default).catch(() => null));
    if (!fetchFn) return res.status(500).end();

    console.log('WA_AUDIO_PLAY_FETCHING_EVOLUTION', { msgId, url: evoUrl.slice(0, 80) });
    const evoRes = await fetchFn(evoUrl, {
      headers: evoKey ? { apikey: evoKey } : {},
    }).catch(e => { console.warn('WA_AUDIO_PLAY_EVO_FETCH_ERR', { err: e.message }); return null; });

    if (!evoRes || !evoRes.ok) {
      console.warn('WA_AUDIO_PLAY_EVO_FAIL', { msgId, status: evoRes?.status });
      return res.status(502).end();
    }

    const audioBuf  = Buffer.from(await evoRes.arrayBuffer());
    const contentType = evoRes.headers.get('content-type') || msg.mime_type || 'audio/ogg';

    // ── Salva no Supabase para servir rapidamente em próximas requisições ───
    try {
      const ext         = contentType.includes('ogg') ? 'ogg' : contentType.includes('webm') ? 'webm' : 'ogg';
      const storagePath = `whatsapp/conversas/${msg.conversa_id}/audios/recebidos/${Date.now()}.${ext}`;

      const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, audioBuf, {
        contentType: contentType,
        upsert: false,
      });

      if (!upErr) {
        await sb.from(MENSAGENS_TABLE).update({
          storage_path:   storagePath,
          storage_bucket: BUCKET,
          mime_type:      contentType,
        }).eq('id', msgId);
        console.log('WA_AUDIO_PLAY_CACHED_SUPABASE', { msgId, storagePath, bytes: audioBuf.length });
      }
    } catch (cacheErr) {
      console.warn('WA_AUDIO_PLAY_CACHE_SKIP', { msgId, erro: cacheErr.message });
    }

    // Serve o áudio diretamente
    res.set('Content-Type',   contentType);
    res.set('Content-Length', audioBuf.length);
    res.set('Cache-Control',  'private, max-age=3600');
    res.set('Accept-Ranges',  'bytes');
    console.log('WA_AUDIO_PLAY_SERVED_EVOLUTION', { msgId, bytes: audioBuf.length, mime: contentType });
    return res.send(audioBuf);

  } catch (e) {
    console.error('WA_AUDIO_PLAY_ERROR', e.message);
    return res.status(500).end();
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/audio/health
// Confirma que o módulo isolado de áudio está registrado
// ───────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE: resolverMidiaRecebida
// Chamado ANTES de router.get('/whatsapp/media/:conversaId/:msgId', autenticar, waAudioCtrl.resolverMidiaRecebida, whatsappCtrl.servirMidia);
// Se msg.tipo='audio' e arquivo_url=null (áudio recebido sem URL):
//   1. Busca base64 via Evolution getBase64FromMediaMessage
//   2. Faz upload no Supabase Storage
//   3. Atualiza arquivo_url no banco
//   4. Chama next() → servirMidia encontra arquivo_url e serve o áudio
// NÃO bloqueia em caso de erro — sempre chama next().
// ─────────────────────────────────────────────────────────────────────────────
async function resolverMidiaRecebida(req, res, next) {
  try {
    const { sb, isSupa } = getProvider();
    if (!isSupa) return next();

    const { msgId, conversaId } = req.params;

    // Busca a mensagem com campos suficientes para decidir
    const { data: msg } = await sb.from(MENSAGENS_TABLE)
      .select('id, tipo, direcao, arquivo_url, storage_path, evolution_message_id, mime_type')
      .eq('id', msgId)
      .eq('conversa_id', conversaId)
      .single();

    // Skip se:
    //  - nao e audio
    //  - e enviado (nao recebido)
    //  - ja esta cacheado permanentemente no Supabase Storage (storage_path preenchido)
    if (!msg || msg.tipo !== 'audio' || msg.direcao === 'enviada' || msg.storage_path) return next();

    const evoMsgId = msg.evolution_message_id;
    console.log('WA_AUDIO_MEDIA_RESOLVER_START', {
      msgId,
      evoMsgId: evoMsgId || '(null)',
      temArquivoUrl: !!msg.arquivo_url,
    });

    if (!evoMsgId) {
      console.warn('WA_AUDIO_MEDIA_RESOLVER_NO_EVOID', { msgId });
      return next();
    }

    // Determina remoteJid da conversa
    // Prioridade: telefone normal -> dados_extras.remoteJid (LID JIDs)
    const { data: conv } = await sb.from(CONVERSAS_TABLE)
      .select('telefone, dados_extras')
      .eq('id', conversaId)
      .single();

    let remoteJid = null;
    if (conv?.telefone && !conv.telefone.startsWith('LID:')) {
      const digits = telSoDigitos(conv.telefone);
      if (digits && digits.length >= 10) remoteJid = `${digits}@s.whatsapp.net`;
    }
    if (!remoteJid && conv?.dados_extras) {
      try {
        const extras = typeof conv.dados_extras === 'string'
          ? JSON.parse(conv.dados_extras)
          : conv.dados_extras;
        // dados_extras.remoteJid pode ser @lid ou @s.whatsapp.net — ambos aceitos pela Evolution
        remoteJid = extras?.remoteJid || null;
      } catch (_) {}
    }

    if (!remoteJid) {
      console.warn('WA_AUDIO_MEDIA_RESOLVER_NO_JID', { msgId, telefone: conv?.telefone });
      return next();
    }

    // Baixa o audio da Evolution API (funciona com @lid e @s.whatsapp.net)
    const evoResult = await evoSvc.getBase64Media(evoMsgId, remoteJid);
    if (!evoResult?.sucesso || !evoResult?.dados?.base64) {
      console.warn('WA_AUDIO_MEDIA_RESOLVER_EVO_FAIL', {
        msgId, evoMsgId,
        remoteJid: remoteJid.slice(0, 20),
        err: evoResult?.erro,
      });
      return next();
    }

    const base64Raw  = evoResult.dados.base64;
    // base64 pode vir como "data:audio/ogg;base64,XXXXX" ou so os bytes
    const base64Data = base64Raw.includes(',') ? base64Raw.split(',')[1] : base64Raw;
    const mimetype   = evoResult.dados.mimetype || msg.mime_type || 'audio/ogg';
    const ext        = extFromMime(mimetype);
    const audioBuf   = Buffer.from(base64Data, 'base64');

    // Upload permanente no Supabase Storage
    const storagePath = `whatsapp/conversas/${conversaId}/audios/recebidos/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, audioBuf, {
      contentType: mimetype,
      upsert: false,
    });

    const dbUpdate = { mime_type: mimetype };

    if (!upErr) {
      const signedUrl = await gerarSignedUrl(sb, storagePath, 3600 * 24 * 365);

      if (signedUrl) {
        // URL assinada de 1 ano — servirMidia faz fetch desta URL diretamente
        dbUpdate.arquivo_url    = signedUrl;
        dbUpdate.storage_path   = storagePath;
        dbUpdate.storage_bucket = BUCKET;
        console.log('WA_AUDIO_MEDIA_RESOLVER_OK_SIGNED', { msgId, storagePath });
      } else {
        // Supabase nao gerou signed URL — base64 embutido como fallback permanente
        // servirMidia trata data: nativamente (linhas 3834-3841 de whatsappController.js)
        dbUpdate.arquivo_url    = `data:${mimetype};base64,${base64Data}`;
        dbUpdate.storage_path   = storagePath; // ainda guarda o path pra futuras tentativas
        dbUpdate.storage_bucket = BUCKET;
        console.warn('WA_AUDIO_MEDIA_RESOLVER_OK_BASE64_FALLBACK', { msgId });
      }
    } else {
      // Upload falhou — base64 embutido como unico fallback
      dbUpdate.arquivo_url = `data:${mimetype};base64,${base64Data}`;
      console.warn('WA_AUDIO_MEDIA_RESOLVER_UPLOAD_FAIL_BASE64', { msgId, err: upErr.message });
    }

    await sb.from(MENSAGENS_TABLE).update(dbUpdate).eq('id', msgId);
    console.log('WA_AUDIO_MEDIA_RESOLVER_DB_UPDATED', {
      msgId,
      urlType: dbUpdate.arquivo_url?.startsWith('data:') ? 'base64' : 'signed_url',
      bytes: audioBuf.length,
    });

  } catch (e) {
    console.warn('WA_AUDIO_MEDIA_RESOLVER_ERR', { err: e.message });
  }
  return next(); // NUNCA bloqueia servirMidia
}

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
  resolverMidiaRecebida,
  health,
};
