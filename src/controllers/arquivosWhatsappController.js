/**
 * PROSPEKT CRM — Arquivos WhatsApp Controller
 *
 * Envio: base64 direto → Evolution API (sem Supabase Storage obrigatório)
 * Recebimento: proxy autenticado (fetch com Evolution API Key server-side)
 * Limite: 64 MB (máximo prático do WhatsApp/Evolution — acima disso o WA rejeita)
 *
 * REGRA: TODOS os handlers async usam try/catch + next(err)
 *        para evitar unhandled rejections que crasham o processo Node.js.
 */
const crypto   = require('crypto');
const multer   = require('multer');
const { getProvider } = require('../database/dbProvider');
const evoSvc   = require('../services/evolutionApiService');
const { extPermitida, sanitizarNome, fmtTamanho } = require('./arquivosController');

const LIMITE_WA_BYTES = 64 * 1024 * 1024; // 64 MB — limite prático WhatsApp/Evolution
const LIMITE_WA_MB    = 64;

// Multer em memória — limite próprio (não depende do arquivosController)
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
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      sucesso: false,
      erro: `Arquivo excede ${LIMITE_WA_MB} MB — limite de envio pelo WhatsApp.`,
    });
  }
  if (err?.code === 'BLOCKED_EXT') {
    return res.status(400).json({ sucesso: false, erro: err.message });
  }
  next(err); // passa ao error handler global do Express
}

/** Resolve mediatype da Evolution a partir do mimetype */
function resolveMediatype(mime) {
  if (!mime) return 'document';
  if (mime.startsWith('image/'))  return 'image';
  if (mime.startsWith('video/'))  return 'video';
  if (mime.startsWith('audio/'))  return 'audio';
  return 'document';
}

// ── POST /api/whatsapp/conversas/:id/arquivos ─────────────────────────────────
// Aceita DOIS formatos de entrada (ambos enviados para Evolution API como base64):
//   1. JSON body: { arquivo_base64, arquivo_nome, mime_type }  ← novo (Auth.api, igual áudio)
//   2. multipart/form-data com field 'arquivo'                 ← legado (XHR FormData)
async function enviarArquivo(req, res, next) {   // <-- next OBRIGATÓRIO
  try {
    const { sb, isSupa } = getProvider();
    const conversaId = req.params.id;

    // ── Detecta formato de entrada ────────────────────────────────────────────
    let arqBuffer, arqNome, arqMime;

    if (req.file) {
      // Formato 1: multipart (multer)
      arqBuffer = req.file.buffer;
      arqNome   = req.file.originalname;
      arqMime   = req.file.mimetype;
    } else if (req.body?.arquivo_base64) {
      // Formato 2: JSON base64 (Auth.api — mesmo que áudio)
      const b64str = req.body.arquivo_base64; // "data:mime;base64,..." ou puro base64
      arqNome = req.body.arquivo_nome || 'arquivo';
      arqMime = req.body.mime_type    || 'application/octet-stream';

      // Remove data URI prefix se presente
      const pureB64 = b64str.replace(/^data:[^;]+;base64,/, '');
      try {
        arqBuffer = Buffer.from(pureB64, 'base64');
      } catch {
        return res.status(400).json({ sucesso: false, erro: 'Base64 inválido.' });
      }
    } else {
      return res.status(400).json({ sucesso: false, erro: 'Nenhum arquivo enviado.' });
    }

    if (!extPermitida(arqNome)) {
      return res.status(400).json({ sucesso: false, erro: 'Tipo de arquivo não permitido.' });
    }
    if (arqBuffer.length > LIMITE_WA_BYTES) {
      return res.status(413).json({ sucesso: false, erro: `Arquivo excede ${LIMITE_WA_MB} MB.` });
    }
    if (!evoSvc.isConfigured()) {
      return res.status(503).json({ sucesso: false, erro: 'Evolution API não configurada. Contate o administrador.' });
    }

    // 1. Busca conversa para obter telefone
    let conversa = null;
    try {
      if (isSupa) {
        const { data } = await sb.from('conversas_whatsapp').select('*').eq('id', conversaId).single();
        conversa = data;
      }
    } catch (e) {
      console.error('[wha.enviarArquivo] Erro ao buscar conversa:', e.message);
      return res.status(500).json({ sucesso: false, erro: 'Erro ao buscar conversa.' });
    }

    if (!conversa) {
      return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
    }

    const telNorm = conversa.telefone?.replace(/\D/g, '');
    if (!telNorm) {
      return res.status(400).json({ sucesso: false, erro: 'Conversa sem telefone válido.' });
    }

    const agora      = new Date().toISOString();
    const nomeSeguro = sanitizarNome(arqNome);
    const msgId      = crypto.randomBytes(16).toString('hex');
    const mediatype  = resolveMediatype(arqMime);

    // 2. Converte buffer para base64 com prefixo data URI
    //    Evolution API aceita base64 no campo `media` (confirmado para áudio — funciona)
    const base64 = `data:${arqMime};base64,${arqBuffer.toString('base64')}`;

    console.log('[wha.enviarArquivo] Enviando →', {
      nomeSeguro,
      tamanho:   fmtTamanho(arqBuffer.length),
      mediatype,
      telefone:  telNorm,
      formato:   req.file ? 'multipart' : 'json-base64',
    });

    // 3. Envia à Evolution API
    let evoOk    = false;
    let evoErro  = null;
    let evoMsgId = null;

    try {
      const evoRes = await evoSvc.enviarMidia(telNorm, {
        mediatype,
        mimetype: arqMime,
        caption:  req.body?.caption || nomeSeguro,
        media:    base64,
        fileName: nomeSeguro,
      });

      if (evoRes.sucesso || evoRes.dados?.key?.id) {
        evoOk    = true;
        evoMsgId = evoRes.dados?.key?.id || null;
        console.log('[wha.enviarArquivo] Evolution OK →', { evoMsgId, nomeSeguro });
      } else {
        evoErro = evoRes.erro || JSON.stringify(evoRes.dados) || 'Evolution rejeitou o envio.';
        console.error('[wha.enviarArquivo] Evolution rejeitou →', evoErro);
      }
    } catch (e) {
      evoErro = e.message;
      console.error('[wha.enviarArquivo] Evolution exception →', e.message);
    }

    if (!evoOk) {
      return res.status(502).json({
        sucesso: false,
        erro:    evoErro || 'Falha ao enviar arquivo pelo WhatsApp.',
      });
    }

    // 4. Salva histórico em mensagens_whatsapp (arquivo_url = null — sem Storage)
    let mensagemSalva = null;
    if (isSupa) {
      try {
        const tipoDb = mediatype === 'image' ? 'imagem'
          : mediatype === 'video' ? 'video'
          : 'arquivo';

        const { data: msgData } = await sb.from('mensagens_whatsapp').insert({
          id:           msgId,
          conversa_id:  conversaId,
          lead_id:      conversa.lead_id || null,
          telefone:     conversa.telefone,
          mensagem:     req.body?.caption || nomeSeguro,
          tipo:         tipoDb,
          direcao:      'enviada',
          status:       'enviado',
          vendedor_id:  req.usuario?.id || null,
          arquivo_url:  null,   // sem Storage — arquivo não fica salvo no CRM
          arquivo_nome: nomeSeguro,
          mime_type:    arqMime,
          criado_em:    agora,
        }).select().single();

        if (msgData) {
          mensagemSalva = { ...msgData, vendedor_nome: req.usuario?.nome || null };
        }
      } catch (e) {
        console.warn('[wha.enviarArquivo] histórico insert warn:', e.message);
      }

      // Atualiza última mensagem da conversa
      await sb.from('conversas_whatsapp').update({
        ultima_msg_em:   agora,
        atualizado_em:   agora,
        ultima_mensagem: `📎 ${nomeSeguro}`,
        status:          'ABERTA',
      }).eq('id', conversaId).catch(() => {});
    }

    return res.status(201).json({
      sucesso: true,
      dados: mensagemSalva || {
        id:           msgId,
        conversa_id:  conversaId,
        tipo:         mediatype === 'image' ? 'imagem' : mediatype === 'video' ? 'video' : 'arquivo',
        arquivo_url:  null,
        arquivo_nome: nomeSeguro,
        mime_type:    arqMime,
        mensagem:     nomeSeguro,
        direcao:      'enviada',
        status:       'enviado',
        criado_em:    agora,
      },
      evo_ok:  true,
      evo_msg: evoMsgId,
      aviso:   null,
    });

  } catch (e) {
    // Nunca deixa unhandled rejection crashar o processo
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
    if (error) {
      console.warn('[wha.listarArquivos]', error.message);
      return res.json({ sucesso: true, dados: [] });
    }
    return res.json({ sucesso: true, dados: data || [] });
  } catch (e) {
    console.error('[wha.listarArquivos] ERRO:', e.message);
    next(e);
  }
}

// ── GET /api/whatsapp/mensagens/:msgId/arquivo ───────────────────────────────
// Proxy autenticado para arquivos recebidos via Evolution/WhatsApp.
// O browser não pode acessar Evolution URLs diretamente (requerem API key).
// Este endpoint faz proxy com autenticação server-side.
async function proxyArquivoRecebido(req, res, next) {
  try {
    const { sb, isSupa } = getProvider();
    const { msgId } = req.params;

    if (!isSupa) {
      return res.status(501).json({ sucesso: false, erro: 'Não disponível em modo SQLite.' });
    }

    // Busca mensagem no banco
    let msg = null;
    try {
      const { data } = await sb.from('mensagens_whatsapp')
        .select('arquivo_url, arquivo_nome, mime_type, tipo, direcao')
        .eq('id', msgId)
        .single();
      msg = data;
    } catch (e) {
      console.warn('[wha.proxyArquivoRecebido] DB error:', e.message);
    }

    if (!msg) {
      return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada.' });
    }
    if (!msg.arquivo_url) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Este arquivo não está disponível (sem URL salva). O arquivo pode ter sido enviado pelo CRM sem armazenamento.',
      });
    }

    const nomeArquivo = msg.arquivo_nome || 'arquivo';
    const mimeType    = msg.mime_type || 'application/octet-stream';
    const evoKey      = process.env.EVOLUTION_API_KEY || '';

    console.log('[wha.proxyArquivoRecebido] Proxying:', {
      msgId,
      nome:      nomeArquivo,
      mime:      mimeType,
      urlStart:  msg.arquivo_url.slice(0, 70),
    });

    // Tenta buscar a mídia da Evolution com API key
    let upstream = null;
    const tryFetch = async (withKey) => {
      const hdrs = withKey && evoKey ? { apikey: evoKey, 'x-api-key': evoKey } : {};
      return fetch(msg.arquivo_url, { headers: hdrs });
    };

    try {
      upstream = await tryFetch(true);
      if (!upstream.ok && evoKey) {
        // Tenta sem key (URL pode ser pública, tipo S3 pre-signed)
        upstream = await tryFetch(false);
      }
    } catch (e) {
      console.error('[wha.proxyArquivoRecebido] fetch error:', e.message);
      return res.status(502).json({ sucesso: false, erro: 'Não foi possível buscar o arquivo da Evolution: ' + e.message });
    }

    if (!upstream.ok) {
      console.warn('[wha.proxyArquivoRecebido] upstream status:', upstream.status);
      return res.status(upstream.status).json({
        sucesso: false,
        erro: `Arquivo indisponível na Evolution (HTTP ${upstream.status}). A URL pode ter expirado.`,
      });
    }

    // Stream para o cliente com headers corretos
    const contentType = upstream.headers.get('content-type') || mimeType;
    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nomeArquivo)}`);
    res.set('Cache-Control', 'private, max-age=3600');

    // Node.js 18+: Readable.fromWeb está disponível
    try {
      const { Readable } = require('stream');
      if (Readable.fromWeb && upstream.body) {
        Readable.fromWeb(upstream.body).pipe(res);
      } else {
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.set('Content-Length', buf.length);
        res.send(buf);
      }
    } catch (e) {
      // fallback bufferizado
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.set('Content-Length', buf.length);
      res.send(buf);
    }

  } catch (e) {
    console.error('[wha.proxyArquivoRecebido] ERRO NÃO TRATADO:', e.message, e.stack);
    next(e);
  }
}

// ── GET /api/whatsapp/arquivos/:arqId/download ───────────────────────────────
// Mantido para compatibilidade. Delega para proxyArquivoRecebido se possível.
async function downloadArquivo(req, res, next) {
  try {
    const { sb, isSupa } = getProvider();
    const { arqId } = req.params;

    if (!isSupa) {
      return res.status(501).json({ sucesso: false, erro: 'Não disponível em modo SQLite.' });
    }

    // Tenta encontrar a mensagem diretamente (fluxo novo — sem Storage)
    let msg = null;
    try {
      const { data } = await sb.from('mensagens_whatsapp')
        .select('arquivo_url, arquivo_nome, mime_type, direcao')
        .eq('id', arqId).single();
      msg = data;
    } catch {}

    if (msg?.arquivo_url) {
      // Redireciona para proxy
      req.params.msgId = arqId;
      return proxyArquivoRecebido(req, res, next);
    }

    // Fallback: tabela legada mensagens_whatsapp_arquivos
    let arq = null;
    try {
      const { data } = await sb.from('mensagens_whatsapp_arquivos').select('*').eq('id', arqId).single();
      arq = data;
    } catch {}

    if (!arq) {
      return res.status(404).json({ sucesso: false, erro: 'Arquivo não encontrado.' });
    }

    const BUCKET_WA    = 'whatsapp-arquivos';
    const nomeOriginal = arq.nome_original || 'arquivo';

    if (arq.storage_path) {
      try {
        const { data: signedData, error: signErr } = await sb.storage
          .from(BUCKET_WA).createSignedUrl(arq.storage_path, 300);
        if (!signErr && signedData?.signedUrl) {
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nomeOriginal)}"`);
          return res.redirect(302, signedData.signedUrl);
        }
      } catch {}

      try {
        const { data: blob, error: dlErr } = await sb.storage.from(BUCKET_WA).download(arq.storage_path);
        if (!dlErr && blob) {
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

  } catch (e) {
    console.error('[wha.downloadArquivo] ERRO NÃO TRATADO:', e.message, e.stack);
    next(e);
  }
}

module.exports = {
  upload,
  handleUploadError,
  enviarArquivo,
  listarArquivos,
  downloadArquivo,
  proxyArquivoRecebido,
};
