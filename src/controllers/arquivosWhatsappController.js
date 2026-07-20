/**
 * PROSPEKT CRM — Arquivos WhatsApp Controller
 * Upload/envio de arquivos nas conversas WhatsApp + download seguro.
 * Limite: 300 MB. Streaming. Sem base64 em log. Sem API key no frontend.
 */
const crypto   = require('crypto');
const path     = require('path');
const multer   = require('multer');
const { getProvider } = require('../database/dbProvider');
const evoSvc   = require('../services/evolutionApiService');

// Reusa helpers do arquivosController principal
const { LIMITE_BYTES, LIMITE_MB, extPermitida, sanitizarNome, fmtTamanho } = require('./arquivosController');

const BUCKET_WA = 'whatsapp-arquivos';
const BUCKET_LEAD = 'lead-arquivos';

// Multer 300 MB em memória
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: LIMITE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!extPermitida(file.originalname))
      return cb(Object.assign(new Error('Tipo de arquivo não permitido.'), { code: 'BLOCKED_EXT' }));
    cb(null, true);
  },
});

function handleUploadError(err, req, res, next) {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ sucesso: false, erro: `O arquivo excede o limite máximo de ${LIMITE_MB}MB.` });
  }
  if (err?.code === 'BLOCKED_EXT') {
    return res.status(400).json({ sucesso: false, erro: err.message });
  }
  next(err);
}

// Determina mediatype Evolution a partir do mimetype
function resolveMediatype(mime) {
  if (!mime) return 'document';
  if (mime.startsWith('image/'))  return 'image';
  if (mime.startsWith('video/'))  return 'video';
  if (mime.startsWith('audio/'))  return 'audio';
  return 'document';
}

// ── POST /api/whatsapp/conversas/:id/arquivos ────────────────────────────────
// Upload + envio pela Evolution (se dentro do limite)
// Form-data: campo 'arquivo'
async function enviarArquivo(req, res) {
  const { sb, isSupa } = getProvider();
  const conversaId = req.params.id;
  const arquivo    = req.file;
  if (!arquivo) return res.status(400).json({ sucesso: false, erro: 'Nenhum arquivo enviado.' });

  if (!extPermitida(arquivo.originalname))
    return res.status(400).json({ sucesso: false, erro: 'Tipo de arquivo não permitido.' });

  // Busca conversa para obter telefone
  let conversa = null;
  if (isSupa) {
    const { data } = await sb.from('conversas_whatsapp').select('*').eq('id', conversaId).single();
    conversa = data;
  }
  if (!conversa) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });

  const agora       = new Date().toISOString();
  const nomeSeguro  = sanitizarNome(arquivo.originalname);
  const ext         = nomeSeguro.split('.').pop() || 'bin';
  const nomeStorage = `${conversaId}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const msgId       = crypto.randomBytes(16).toString('hex');
  const arqId       = crypto.randomBytes(16).toString('hex');

  let publicUrl = null;
  let storageOk = false;

  // 1. Upload para Supabase Storage
  if (isSupa) {
    try {
      const { error: upErr } = await sb.storage.from(BUCKET_WA).upload(nomeStorage, arquivo.buffer, {
        contentType: arquivo.mimetype, upsert: false,
      });
      if (upErr) {
        if (upErr.message?.includes('Bucket not found') || upErr.statusCode === 404) {
          await sb.storage.createBucket(BUCKET_WA, { public: true });
          const { error: upErr2 } = await sb.storage.from(BUCKET_WA).upload(nomeStorage, arquivo.buffer, {
            contentType: arquivo.mimetype, upsert: false,
          });
          if (!upErr2) {
            const { data: { publicUrl: u } } = sb.storage.from(BUCKET_WA).getPublicUrl(nomeStorage);
            publicUrl = u;
            storageOk = true;
          }
        } else {
          console.error('[wha.enviarArquivo] Storage upload err:', upErr.message);
        }
      } else {
        const { data: { publicUrl: u } } = sb.storage.from(BUCKET_WA).getPublicUrl(nomeStorage);
        publicUrl = u;
        storageOk = true;
      }
    } catch (e) {
      console.error('[wha.enviarArquivo] Storage err:', e.message);
    }
  }

  // 2. Tenta enviar pela Evolution (somente se tiver URL pública)
  const LIMITE_EVOLUTION_BYTES = 64 * 1024 * 1024; // 64 MB (limite típico WA/Evolution)
  let evoOk   = false;
  let evoErro = null;
  let evoMsgId = null;
  let avisoEvolution = null;

  if (publicUrl && evoSvc.isConfigured()) {
    const mediatype = resolveMediatype(arquivo.mimetype);
    if (arquivo.size > LIMITE_EVOLUTION_BYTES) {
      avisoEvolution = `Arquivo salvo no CRM, mas não enviado pelo WhatsApp porque excede o limite de ${Math.round(LIMITE_EVOLUTION_BYTES/1024/1024)}MB permitido pela API.`;
      console.log('[wha.enviarArquivo] Arquivo muito grande para Evolution — salvo apenas no CRM.');
    } else {
      try {
        const telNorm = conversa.telefone?.replace(/\D/g,'');
        if (telNorm) {
          const evoRes = await evoSvc.enviarMidia(telNorm, {
            mediatype,
            mimetype: arquivo.mimetype,
            caption:  req.body.caption || nomeSeguro,
            media:    publicUrl,
            fileName: nomeSeguro,
          });
          if (evoRes.sucesso || evoRes.dados?.key?.id) {
            evoOk    = true;
            evoMsgId = evoRes.dados?.key?.id || null;
            console.log('[wha.enviarArquivo] Evolution OK:', { evoMsgId, nomeSeguro });
          } else {
            evoErro = evoRes.erro || 'Evolution rejeitou o envio.';
            avisoEvolution = `Não foi possível enviar este arquivo pelo WhatsApp: ${evoErro}. O arquivo foi salvo no CRM.`;
            console.error('[wha.enviarArquivo] Evolution err:', evoErro);
          }
        }
      } catch (e) {
        evoErro = e.message;
        avisoEvolution = `Não foi possível enviar pelo WhatsApp. O arquivo foi salvo no CRM.`;
        console.error('[wha.enviarArquivo] Evolution catch:', e.message);
      }
    }
  } else if (!evoSvc.isConfigured()) {
    avisoEvolution = 'Evolution API não configurada — arquivo salvo apenas no CRM.';
  } else if (!publicUrl) {
    avisoEvolution = 'Falha no upload para Storage — arquivo não enviado.';
  }

  // 3. Salva mensagem no histórico (independente do sucesso da Evolution)
  let mensagemSalva = null;
  if (isSupa && storageOk) {
    const tipo = resolveMediatype(arquivo.mimetype);

    // Salva em mensagens_whatsapp
    const { data: msgData, error: msgErr } = await sb.from('mensagens_whatsapp').insert({
      id: msgId, conversa_id: conversaId, lead_id: conversa.lead_id || null,
      telefone: conversa.telefone,
      mensagem: req.body.caption || nomeSeguro,
      tipo,
      direcao: 'enviada',
      status: evoOk ? 'enviado' : 'erro',
      vendedor_id: req.usuario.id,
      arquivo_url: publicUrl,
      arquivo_nome: nomeSeguro,
      criado_em: agora,
    }).select().single();

    if (!msgErr) {
      mensagemSalva = { ...msgData, vendedor_nome: req.usuario.nome };
    }

    // Salva metadados do arquivo
    if (storageOk) {
      try {
        await sb.from('mensagens_whatsapp_arquivos').insert({
          id: arqId, mensagem_id: msgId, conversa_id: conversaId,
          lead_id: conversa.lead_id || null,
          usuario_id: req.usuario.id,
          nome_original: nomeSeguro,
          nome_armazenado: nomeStorage,
          mime_type: arquivo.mimetype,
          tamanho_bytes: arquivo.size,
          storage_path: nomeStorage,
          public_url: publicUrl,
          origem: 'whatsapp_enviado',
          criado_em: agora,
        });
      } catch (e) {
        // Tabela pode não existir ainda — não crítico
        console.warn('[wha.enviarArquivo] mensagens_whatsapp_arquivos insert warn:', e.message);
      }

      // Atualiza conversa
      await sb.from('conversas_whatsapp').update({
        ultima_msg_em: agora, atualizado_em: agora, status: 'ABERTA',
      }).eq('id', conversaId).catch(() => {});
    }
  }

  return res.status(201).json({
    sucesso: storageOk,
    dados: mensagemSalva || { id: msgId, tipo: resolveMediatype(arquivo.mimetype), arquivo_url: publicUrl, arquivo_nome: nomeSeguro },
    evo_ok: evoOk,
    aviso: avisoEvolution || null,
    arq_id: storageOk ? arqId : null,
  });
}

// ── GET /api/whatsapp/conversas/:id/arquivos ─────────────────────────────────
async function listarArquivos(req, res) {
  const { sb, isSupa } = getProvider();
  const { id: conversaId } = req.params;
  try {
    if (!isSupa) return res.json({ sucesso: true, dados: [] });
    const { data, error } = await sb.from('mensagens_whatsapp_arquivos')
      .select('*').eq('conversa_id', conversaId).order('criado_em', { ascending: false });
    if (error) {
      // Tabela pode não existir
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

// ── GET /api/whatsapp/arquivos/:arqId/download ───────────────────────────────
// Download seguro com streaming — não expõe path/key
async function downloadArquivo(req, res) {
  const { sb, isSupa } = getProvider();
  const { arqId } = req.params;
  try {
    if (!isSupa) return res.status(501).json({ sucesso: false, erro: 'Não disponível em modo SQLite.' });

    // Busca em mensagens_whatsapp_arquivos primeiro
    let arq = null;
    try {
      const { data } = await sb.from('mensagens_whatsapp_arquivos').select('*').eq('id', arqId).single();
      arq = data;
    } catch {}

    // Fallback: busca em lead_arquivos
    if (!arq) {
      try {
        const { data } = await sb.from('lead_arquivos').select('*').eq('id', arqId).single();
        if (data) {
          arq = {
            ...data,
            nome_original: data.nome_original,
            mime_type: data.mime_type,
            storage_path: data.nome_storage,
            public_url: data.url,
          };
        }
      } catch {}
    }

    if (!arq) return res.status(404).json({ sucesso: false, erro: 'Arquivo não encontrado.' });

    const nomeOriginal = arq.nome_original || 'arquivo';

    // Tenta signed URL (bucket privado)
    const bucket = arq.storage_path?.startsWith('{') ? BUCKET_LEAD : BUCKET_WA;
    if (arq.storage_path) {
      try {
        const { data: signedData, error: signErr } = await sb.storage
          .from(bucket).createSignedUrl(arq.storage_path, 300);
        if (!signErr && signedData?.signedUrl) {
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nomeOriginal)}"`);
          return res.redirect(302, signedData.signedUrl);
        }
      } catch {}

      // Proxy streaming via download SDK
      try {
        const { data: blob, error: dlErr } = await sb.storage.from(bucket).download(arq.storage_path);
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

    // Último recurso: URL pública
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
};
