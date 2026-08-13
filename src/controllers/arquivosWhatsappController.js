/**
 * PROSPEKT CRM — Arquivos WhatsApp Controller
 * Envio de arquivos via Evolution API (base64 direto — sem Supabase Storage obrigatório).
 * Download de arquivos recebidos via proxy autenticado.
 * Limite: 64 MB (limite prático da Evolution/WhatsApp).
 */
const crypto   = require('crypto');
const path     = require('path');
const multer   = require('multer');
const { getProvider } = require('../database/dbProvider');
const evoSvc   = require('../services/evolutionApiService');

// Reusa helpers de extensão/nome do arquivosController principal
const { extPermitida, sanitizarNome, fmtTamanho } = require('./arquivosController');

// Limite para arquivos WhatsApp — Evolution/WhatsApp aceita até ~100 MB (documentos),
// mas mantemos 64 MB para evitar timeouts e OOM no servidor.
const LIMITE_WA_BYTES = 64 * 1024 * 1024; // 64 MB
const LIMITE_WA_MB    = 64;

// Multer em memória com limite próprio (não depende do limite do arquivosController)
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
      erro: `O arquivo excede o limite de ${LIMITE_WA_MB}MB para envio pelo WhatsApp.`,
    });
  }
  if (err?.code === 'BLOCKED_EXT') {
    return res.status(400).json({ sucesso: false, erro: err.message });
  }
  next(err);
}

// Resolve mediatype da Evolution a partir do mimetype
function resolveMediatype(mime) {
  if (!mime) return 'document';
  if (mime.startsWith('image/'))  return 'image';
  if (mime.startsWith('video/'))  return 'video';
  if (mime.startsWith('audio/'))  return 'audio';
  return 'document';
}

// ── POST /api/whatsapp/conversas/:id/arquivos ─────────────────────────────────
// Converte o arquivo para base64 e envia DIRETAMENTE à Evolution API.
// Não depende de Supabase Storage — arquivo não fica salvo no CRM.
// Salva apenas o histórico em mensagens_whatsapp (sem arquivo_url).
async function enviarArquivo(req, res) {
  const { sb, isSupa } = getProvider();
  const conversaId = req.params.id;
  const arquivo    = req.file;

  if (!arquivo) {
    return res.status(400).json({ sucesso: false, erro: 'Nenhum arquivo enviado.' });
  }

  if (!extPermitida(arquivo.originalname)) {
    return res.status(400).json({ sucesso: false, erro: 'Tipo de arquivo não permitido.' });
  }

  if (!evoSvc.isConfigured()) {
    return res.status(503).json({ sucesso: false, erro: 'Evolution API não configurada. Contate o administrador.' });
  }

  // Busca conversa para obter telefone
  let conversa = null;
  if (isSupa) {
    const { data } = await sb.from('conversas_whatsapp').select('*').eq('id', conversaId).single();
    conversa = data;
  }
  if (!conversa) {
    return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
  }

  const telNorm = conversa.telefone?.replace(/\D/g, '');
  if (!telNorm) {
    return res.status(400).json({ sucesso: false, erro: 'Conversa sem telefone válido.' });
  }

  const agora      = new Date().toISOString();
  const nomeSeguro = sanitizarNome(arquivo.originalname);
  const msgId      = crypto.randomBytes(16).toString('hex');
  const mediatype  = resolveMediatype(arquivo.mimetype);

  // Converte buffer para base64 com prefixo data URI
  // Evolution API aceita base64 diretamente no campo `media`
  const base64 = `data:${arquivo.mimetype};base64,${arquivo.buffer.toString('base64')}`;

  console.log('[wha.enviarArquivo] Enviando via base64 direto à Evolution:', {
    nomeSeguro, tamanho: fmtTamanho(arquivo.size), mediatype, telefone: telNorm,
  });

  let evoOk    = false;
  let evoErro  = null;
  let evoMsgId = null;

  try {
    const evoRes = await evoSvc.enviarMidia(telNorm, {
      mediatype,
      mimetype: arquivo.mimetype,
      caption:  req.body.caption || nomeSeguro,
      media:    base64,        // base64 direto — sem Supabase Storage
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
      erro: evoErro || 'Falha ao enviar arquivo pelo WhatsApp.',
    });
  }

  // Salva histórico em mensagens_whatsapp (arquivo_url = null — não fica no Storage)
  let mensagemSalva = null;
  if (isSupa) {
    try {
      const { data: msgData } = await sb.from('mensagens_whatsapp').insert({
        id:           msgId,
        conversa_id:  conversaId,
        lead_id:      conversa.lead_id || null,
        telefone:     conversa.telefone,
        mensagem:     req.body.caption || nomeSeguro,
        tipo:         mediatype === 'image' ? 'imagem' : mediatype === 'video' ? 'video' : 'arquivo',
        direcao:      'enviada',
        status:       'enviado',
        vendedor_id:  req.usuario.id,
        arquivo_url:  null,      // sem Storage — arquivo não fica salvo no CRM
        arquivo_nome: nomeSeguro,
        mime_type:    arquivo.mimetype,
        criado_em:    agora,
      }).select().single();

      if (msgData) mensagemSalva = { ...msgData, vendedor_nome: req.usuario.nome };
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
      mime_type:    arquivo.mimetype,
      mensagem:     nomeSeguro,
      direcao:      'enviada',
      status:       'enviado',
      criado_em:    agora,
    },
    evo_ok:  true,
    evo_msg: evoMsgId,
    aviso:   null,
  });
}

// ── GET /api/whatsapp/conversas/:id/arquivos ──────────────────────────────────
async function listarArquivos(req, res) {
  const { sb, isSupa } = getProvider();
  const { id: conversaId } = req.params;
  try {
    if (!isSupa) return res.json({ sucesso: true, dados: [] });
    const { data, error } = await sb.from('mensagens_whatsapp')
      .select('id, arquivo_nome, mime_type, arquivo_url, tamanho_bytes, direcao, criado_em')
      .eq('conversa_id', conversaId)
      .not('arquivo_nome', 'is', null)
      .order('criado_em', { ascending: false });
    if (error) {
      console.warn('[wha.listarArquivos]', error.message);
      return res.json({ sucesso: true, dados: [] });
    }
    return res.json({ sucesso: true, dados: (data || []).map(a => ({
      ...a, tamanho_fmt: fmtTamanho(a.tamanho_bytes),
    }))});
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── GET /api/whatsapp/mensagens/:msgId/arquivo ────────────────────────────────
// Proxy autenticado para arquivos recebidos via Evolution/WhatsApp.
// O browser não pode acessar Evolution URLs diretamente (podem exigir API key).
// Este endpoint busca a URL da Evolution no DB e faz proxy com autenticação.
async function proxyArquivoRecebido(req, res) {
  const { sb, isSupa } = getProvider();
  const { msgId } = req.params;

  try {
    if (!isSupa) {
      return res.status(501).json({ sucesso: false, erro: 'Não disponível em modo SQLite.' });
    }

    const { data: msg } = await sb.from('mensagens_whatsapp')
      .select('arquivo_url, arquivo_nome, mime_type, tipo, direcao')
      .eq('id', msgId)
      .single();

    if (!msg) {
      return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada.' });
    }

    if (!msg.arquivo_url) {
      return res.status(404).json({ sucesso: false, erro: 'Este arquivo não está disponível para download (sem URL salva).' });
    }

    const nomeArquivo = msg.arquivo_nome || 'arquivo';
    const mimeType    = msg.mime_type || 'application/octet-stream';
    const evoKey      = process.env.EVOLUTION_API_KEY || '';

    console.log('[wha.proxyArquivoRecebido] Proxying arquivo:', {
      msgId, nome: nomeArquivo, mime: mimeType, urlPrefix: msg.arquivo_url.slice(0, 60),
    });

    // Tenta buscar o arquivo da URL da Evolution com API key
    let upstream;
    const fetchHeaders = evoKey ? { apikey: evoKey } : {};

    try {
      upstream = await fetch(msg.arquivo_url, { headers: fetchHeaders });
    } catch (e) {
      console.error('[wha.proxyArquivoRecebido] fetch error:', e.message);
      return res.status(502).json({ sucesso: false, erro: 'Não foi possível buscar o arquivo da Evolution.' });
    }

    if (!upstream.ok) {
      console.warn('[wha.proxyArquivoRecebido] upstream não-ok:', upstream.status, msg.arquivo_url.slice(0, 60));
      // Tenta sem API key (URL pode ser pública)
      if (evoKey) {
        try {
          const upstream2 = await fetch(msg.arquivo_url);
          if (upstream2.ok) {
            upstream = upstream2;
          } else {
            return res.status(upstream.status).json({ sucesso: false, erro: 'Arquivo não disponível ou URL expirada.' });
          }
        } catch {
          return res.status(upstream.status).json({ sucesso: false, erro: 'Arquivo não disponível.' });
        }
      } else {
        return res.status(upstream.status).json({ sucesso: false, erro: 'Arquivo não disponível ou URL expirada.' });
      }
    }

    const contentType = upstream.headers.get('content-type') || mimeType;
    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nomeArquivo)}`);
    res.set('Cache-Control', 'private, max-age=3600');

    // Stream direto para o cliente
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
    console.error('[wha.proxyArquivoRecebido] erro:', e.message);
    res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── GET /api/whatsapp/arquivos/:arqId/download ───────────────────────────────
// Mantido para compatibilidade — redireciona para proxyArquivoRecebido se arqId = msgId
async function downloadArquivo(req, res) {
  const { sb, isSupa } = getProvider();
  const { arqId } = req.params;

  try {
    if (!isSupa) return res.status(501).json({ sucesso: false, erro: 'Não disponível em modo SQLite.' });

    // Tenta encontrar pela mensagem diretamente (novo fluxo — sem Storage)
    try {
      const { data: msg } = await sb.from('mensagens_whatsapp')
        .select('arquivo_url, arquivo_nome, mime_type, direcao')
        .eq('id', arqId).single();

      if (msg?.arquivo_url) {
        // Redireciona internamente para o proxy
        req.params.msgId = arqId;
        return proxyArquivoRecebido(req, res);
      }
    } catch {}

    // Fallback: tenta tabela legada mensagens_whatsapp_arquivos
    let arq = null;
    try {
      const { data } = await sb.from('mensagens_whatsapp_arquivos').select('*').eq('id', arqId).single();
      arq = data;
    } catch {}

    if (!arq) return res.status(404).json({ sucesso: false, erro: 'Arquivo não encontrado.' });

    const nomeOriginal = arq.nome_original || 'arquivo';
    const BUCKET_WA    = 'whatsapp-arquivos';

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
          res.set('Cache-Control', 'private, no-store');
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
    console.error('[wha.downloadArquivo]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
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
