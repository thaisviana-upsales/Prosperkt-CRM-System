/**
 * PROSPEKT CRM — Arquivos Controller
 * Upload e listagem de arquivos vinculados a um lead via Supabase Storage
 */
const crypto  = require('crypto');
const multer  = require('multer');
const { getProvider } = require('../database/dbProvider');

// Multer em memória (sem disco local — enviamos direto para Supabase Storage)
const LIMITE_MB = 50;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITE_MB * 1024 * 1024 },
  fileFilter: (_req, _file, cb) => cb(null, true), // aceita qualquer formato
});

// Middleware de erro para arquivo grande
function handleUploadError(err, req, res, next) {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      sucesso: false,
      erro: `Arquivo muito grande para o limite técnico atual (${LIMITE_MB}MB). Reduza o tamanho ou envie em partes.`,
    });
  }
  next(err);
}

const BUCKET = 'lead-arquivos'; // bucket no Supabase Storage

// ── GET /api/leads/:id/arquivos ───────────────────────────────────────────────
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
        ...a, enviado_por_nome: a.enviado_por_usuario?.nome || 'Sistema'
      }))});
    }
    return res.json({ sucesso: true, dados: [] });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/leads/:id/arquivos (multipart/form-data) ────────────────────────
async function enviar(req, res) {
  const { sb, isSupa } = getProvider();
  const leadId  = req.params.id;
  const arquivo = req.file;
  if (!arquivo) return res.status(400).json({ sucesso: false, erro: 'Nenhum arquivo enviado.' });

  const agora    = new Date().toISOString();
  const ext      = arquivo.originalname.split('.').pop();
  const nomeStorage = `${leadId}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const id       = crypto.randomBytes(16).toString('hex');

  try {
    if (isSupa) {
      // Upload para Supabase Storage
      const { error: upErr } = await sb.storage.from(BUCKET).upload(nomeStorage, arquivo.buffer, {
        contentType: arquivo.mimetype,
        upsert: false,
      });
      if (upErr) {
        // Se o bucket não existe, tenta criar e re-enviar
        if (upErr.message?.includes('Bucket not found') || upErr.statusCode === 404) {
          await sb.storage.createBucket(BUCKET, { public: true });
          const { error: upErr2 } = await sb.storage.from(BUCKET).upload(nomeStorage, arquivo.buffer, {
            contentType: arquivo.mimetype, upsert: false,
          });
          if (upErr2) throw upErr2;
        } else throw upErr;
      }

      // URL pública
      const { data: { publicUrl } } = sb.storage.from(BUCKET).getPublicUrl(nomeStorage);

      // Registra no banco
      const { data, error } = await sb.from('lead_arquivos').insert({
        id, lead_id: leadId,
        nome_original: arquivo.originalname,
        nome_storage:  nomeStorage,
        url:           publicUrl,
        tamanho:       arquivo.size,
        mime_type:     arquivo.mimetype,
        enviado_por:   req.usuario.id,
        criado_em:     agora,
      }).select().single();
      if (error) throw error;
      return res.status(201).json({ sucesso: true, dados: data });
    }
    return res.status(201).json({ sucesso: true, dados: { id, nome_original: arquivo.originalname } });
  } catch (e) {
    console.error('[arquivos.enviar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── DELETE /api/leads/:id/arquivos/:arqId ─────────────────────────────────────
async function excluir(req, res) {
  const { sb, isSupa } = getProvider();
  const { arqId } = req.params;
  try {
    if (isSupa) {
      const { data: arq } = await sb.from('lead_arquivos').select('*').eq('id', arqId).single();
      if (!arq) return res.status(404).json({ sucesso: false, erro: 'Arquivo não encontrado.' });
      // Remove do Storage
      await sb.storage.from(BUCKET).remove([arq.nome_storage]);
      // Remove do banco
      await sb.from('lead_arquivos').delete().eq('id', arqId);
      return res.json({ sucesso: true });
    }
    return res.json({ sucesso: true });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/leads/:id/arquivos/:arqId/producao ──────────────────────────────
// Vincula arquivo de conversa WhatsApp à aba Produção do lead (sem duplicar Storage)
async function salvarEmProducao(req, res) {
  const { sb, isSupa } = getProvider();
  const { id: leadId, arqId } = req.params;
  try {
    if (isSupa) {
      const { data: arq } = await sb.from('lead_arquivos').select('*').eq('id', arqId).single();
      if (!arq) return res.status(404).json({ sucesso: false, erro: 'Arquivo não encontrado.' });
      // Permissão: vendedor só pode vincular arquivos dos seus próprios leads
      if (req.usuario.role === 'VENDEDOR') {
        const { data: lead } = await sb.from('leads').select('responsavel_id').eq('id', leadId).single();
        if (!lead || lead.responsavel_id !== req.usuario.id)
          return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
      }
      // Atualiza registro existente: garante que lead_id está correto e marca como vínculado à produção
      const { error } = await sb.from('lead_arquivos').update({
        lead_id: leadId,
        origem: 'whatsapp',
      }).eq('id', arqId);
      if (error) throw error;
      return res.json({ sucesso: true, mensagem: 'Arquivo vinculado à Produção do lead.' });
    }
    return res.json({ sucesso: true });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { upload, handleUploadError, listar, enviar, excluir, salvarEmProducao };
