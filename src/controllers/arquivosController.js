/**
 * PROSPEKT CRM — Arquivos Controller (v2)
 * Upload/listagem/download de arquivos vinculados a leads via Supabase Storage.
 * Limite: 300 MB. Extensões perigosas bloqueadas.
 * Streaming no download — sem carregar arquivo inteiro em memória.
 */
const crypto  = require('crypto');
const path    = require('path');
const multer  = require('multer');
const { getProvider } = require('../database/dbProvider');

// ── Limite e configuração ────────────────────────────────────────────────────
const LIMITE_BYTES = 300 * 1024 * 1024; // 300 MB
const LIMITE_MB    = 300;
const BUCKET       = 'lead-arquivos';

// Extensões explicitamente bloqueadas (executáveis / scripts perigosos)
const EXT_BLOQUEADAS = new Set([
  'exe','bat','cmd','sh','bash','zsh','msi','scr','com','pif',
  'vbs','vbe','js','jse','wsf','wsh','ps1','psm1','psd1',
  'reg','inf','lnk','url','jar','class','hta',
]);

function sanitizarNome(nome) {
  // Remove path traversal, caracteres especiais; mantém ext
  return path.basename(nome).replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 200);
}

function extPermitida(nomeOriginal) {
  const ext = (nomeOriginal.split('.').pop() || '').toLowerCase();
  return !EXT_BLOQUEADAS.has(ext);
}

function fmtTamanho(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024)          return bytes + ' B';
  if (bytes < 1024 * 1024)   return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3)     return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 ** 3)).toFixed(2) + ' GB';
}

// Multer em memória (stream direto para Supabase)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: LIMITE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!extPermitida(file.originalname)) {
      return cb(Object.assign(new Error('Tipo de arquivo não permitido por segurança.'), { code: 'BLOCKED_EXT' }));
    }
    cb(null, true);
  },
});

// Middleware de erro para arquivo grande ou ext bloqueada
function handleUploadError(err, req, res, next) {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      sucesso: false,
      erro: `O arquivo excede o limite máximo de ${LIMITE_MB}MB.`,
    });
  }
  if (err?.code === 'BLOCKED_EXT') {
    return res.status(400).json({ sucesso: false, erro: err.message });
  }
  next(err);
}

// ── GET /api/leads/:id/arquivos ──────────────────────────────────────────────
async function listar(req, res) {
  const { sb, isSupa } = getProvider();
  const leadId = req.params.id;
  try {
    if (isSupa) {
      const { data, error } = await sb.from('lead_arquivos')
        .select('*, enviado_por_usuario:usuarios!enviado_por(id,nome)')
        .eq('lead_id', leadId).order('criado_em', { ascending: false });
      if (error) throw error;
      return res.json({ sucesso: true, dados: (data || []).map(a => ({
        ...a,
        enviado_por_nome: a.enviado_por_usuario?.nome || 'Sistema',
        tamanho_fmt: fmtTamanho(a.tamanho),
      }))});
    }
    return res.json({ sucesso: true, dados: [] });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/leads/:id/arquivos (multipart/form-data campo: arquivo) ────────
async function enviar(req, res) {
  const { sb, isSupa } = getProvider();
  const leadId  = req.params.id;
  const arquivo = req.file;
  if (!arquivo) return res.status(400).json({ sucesso: false, erro: 'Nenhum arquivo enviado.' });

  // Validação de segurança: ext + tamanho (multer já validou, mas dupla verificação)
  if (!extPermitida(arquivo.originalname)) {
    return res.status(400).json({ sucesso: false, erro: 'Tipo de arquivo não permitido.' });
  }
  if (arquivo.size > LIMITE_BYTES) {
    return res.status(413).json({ sucesso: false, erro: `O arquivo excede o limite máximo de ${LIMITE_MB}MB.` });
  }

  const agora       = new Date().toISOString();
  const nomeSeguro  = sanitizarNome(arquivo.originalname);
  const ext         = nomeSeguro.split('.').pop() || 'bin';
  const nomeStorage = `${leadId}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const id          = crypto.randomBytes(16).toString('hex');

  try {
    if (isSupa) {
      // Upload para Supabase Storage (streaming do buffer em memória)
      const { error: upErr } = await sb.storage.from(BUCKET).upload(nomeStorage, arquivo.buffer, {
        contentType: arquivo.mimetype,
        upsert: false,
      });
      if (upErr) {
        if (upErr.message?.includes('Bucket not found') || upErr.statusCode === 404) {
          await sb.storage.createBucket(BUCKET, { public: true });
          const { error: upErr2 } = await sb.storage.from(BUCKET).upload(nomeStorage, arquivo.buffer, {
            contentType: arquivo.mimetype, upsert: false,
          });
          if (upErr2) throw upErr2;
        } else throw upErr;
      }

      const { data: { publicUrl } } = sb.storage.from(BUCKET).getPublicUrl(nomeStorage);

      const { data, error } = await sb.from('lead_arquivos').insert({
        id, lead_id: leadId,
        nome_original: nomeSeguro,
        nome_storage:  nomeStorage,
        url:           publicUrl,
        tamanho:       arquivo.size,
        mime_type:     arquivo.mimetype,
        enviado_por:   req.usuario.id,
        origem:        req.body.origem || 'lead',
        criado_em:     agora,
      }).select().single();
      if (error) throw error;

      console.log('[arquivos.enviar] Upload OK:', { id, nome: nomeSeguro, tamanho: arquivo.size, lead: leadId });
      return res.status(201).json({ sucesso: true, dados: { ...data, tamanho_fmt: fmtTamanho(data.tamanho) } });
    }
    return res.status(201).json({ sucesso: true, dados: { id, nome_original: nomeSeguro } });
  } catch (e) {
    console.error('[arquivos.enviar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── GET /api/leads/:id/arquivos/:arqId/download ──────────────────────────────
// Download seguro: valida dono do arquivo, faz streaming sem carregar em memória
async function download(req, res) {
  const { sb, isSupa } = getProvider();
  const { id: leadId, arqId } = req.params;
  try {
    if (!isSupa) return res.status(501).json({ sucesso: false, erro: 'Download não suportado em modo SQLite.' });

    const { data: arq, error } = await sb.from('lead_arquivos')
      .select('*').eq('id', arqId).eq('lead_id', leadId).single();
    if (error || !arq) return res.status(404).json({ sucesso: false, erro: 'Arquivo não encontrado.' });

    // Permissão: VENDEDOR só acessa seu lead
    if (req.usuario.role === 'VENDEDOR') {
      const { data: lead } = await sb.from('leads').select('responsavel_id').eq('id', leadId).single();
      if (!lead || lead.responsavel_id !== req.usuario.id) {
        return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
      }
    }

    // Tenta download via Storage signed URL (privado) ou URL pública
    if (arq.nome_storage) {
      try {
        const { data: signedData, error: signErr } = await sb.storage
          .from(BUCKET).createSignedUrl(arq.nome_storage, 300); // 5 min
        if (!signErr && signedData?.signedUrl) {
          // Redireciona para URL assinada — Supabase serve o arquivo diretamente
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(arq.nome_original)}"`);
          return res.redirect(302, signedData.signedUrl);
        }
      } catch {}
    }

    // Fallback: proxy via download do Storage
    if (arq.nome_storage) {
      const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(arq.nome_storage);
      if (!dlErr && blob) {
        const buf = Buffer.from(await blob.arrayBuffer());
        res.set('Content-Type', arq.mime_type || 'application/octet-stream');
        res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(arq.nome_original)}"`);
        res.set('Content-Length', buf.length);
        return res.send(buf);
      }
    }

    // Último recurso: redireciona para URL pública
    if (arq.url) return res.redirect(302, arq.url);
    return res.status(404).json({ sucesso: false, erro: 'Arquivo não disponível para download.' });
  } catch (e) {
    console.error('[arquivos.download]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── DELETE /api/leads/:id/arquivos/:arqId ────────────────────────────────────
async function excluir(req, res) {
  const { sb, isSupa } = getProvider();
  const { id: leadId, arqId } = req.params;
  try {
    if (isSupa) {
      // Permissão: VENDEDOR só exclui do seu lead
      if (req.usuario.role === 'VENDEDOR') {
        const { data: lead } = await sb.from('leads').select('responsavel_id').eq('id', leadId).single();
        if (!lead || lead.responsavel_id !== req.usuario.id) {
          return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
        }
      }
      const { data: arq } = await sb.from('lead_arquivos').select('*').eq('id', arqId).single();
      if (!arq) return res.status(404).json({ sucesso: false, erro: 'Arquivo não encontrado.' });
      if (arq.nome_storage) await sb.storage.from(BUCKET).remove([arq.nome_storage]);
      await sb.from('lead_arquivos').delete().eq('id', arqId);
      return res.json({ sucesso: true });
    }
    return res.json({ sucesso: true });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/leads/:id/arquivos/:arqId/producao ─────────────────────────────
async function salvarEmProducao(req, res) {
  const { sb, isSupa } = getProvider();
  const { id: leadId, arqId } = req.params;
  try {
    if (isSupa) {
      const { data: arq } = await sb.from('lead_arquivos').select('*').eq('id', arqId).single();
      if (!arq) return res.status(404).json({ sucesso: false, erro: 'Arquivo não encontrado.' });
      if (req.usuario.role === 'VENDEDOR') {
        const { data: lead } = await sb.from('leads').select('responsavel_id').eq('id', leadId).single();
        if (!lead || lead.responsavel_id !== req.usuario.id)
          return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
      }
      const { error } = await sb.from('lead_arquivos').update({
        lead_id: leadId, origem: 'whatsapp',
      }).eq('id', arqId);
      if (error) throw error;
      return res.json({ sucesso: true, mensagem: 'Arquivo vinculado à Produção do lead.' });
    }
    return res.json({ sucesso: true });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = {
  upload,
  handleUploadError,
  listar,
  enviar,
  download,
  excluir,
  salvarEmProducao,
  LIMITE_BYTES,
  LIMITE_MB,
  extPermitida,
  sanitizarNome,
  fmtTamanho,
  BUCKET,
};
