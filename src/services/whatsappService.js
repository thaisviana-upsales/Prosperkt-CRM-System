/**
 * PROSPERKT CRM — WhatsApp Service (Supabase)
 * Camada de acesso à tabela whatsapp_mensagens no Supabase.
 * Independente do controller legado SQLite (whatsappController.js).
 *
 * Responsabilidades:
 *  - CRUD de mensagens na tabela whatsapp_mensagens
 *  - Normalização de telefone
 *  - Nunca lança exceção para o caller — sempre retorna { sucesso, dados?, erro? }
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

// ── Helpers ────────────────────────────────────────────────────────────────────
function normalizePhone(tel) {
  return (tel || '').replace(/\D/g, '');
}

function agora() {
  return new Date().toISOString();
}

// ── Salvar mensagem ────────────────────────────────────────────────────────────
/**
 * Salva uma mensagem em whatsapp_mensagens.
 * @param {object} dados - campos da mensagem
 * @returns {{ sucesso: boolean, dados?: object, erro?: string }}
 */
async function salvarMensagem(dados) {
  const { sb, isSupa } = getProvider();
  const id = dados.id || crypto.randomBytes(16).toString('hex');
  const tel = normalizePhone(dados.telefone);
  const ts  = agora();

  const registro = {
    id,
    lead_id:             dados.lead_id             || null,
    telefone:            tel,
    nome_contato:        dados.nome_contato         || null,
    direcao:             dados.direcao              || 'enviada',
    tipo:                dados.tipo                 || 'texto',
    conteudo:            dados.conteudo             || null,
    midia_url:           dados.midia_url            || null,
    arquivo_nome:        dados.arquivo_nome          || null,
    mime_type:           dados.mime_type             || null,
    whatsapp_message_id: dados.whatsapp_message_id  || null,
    status_envio:        dados.status_envio          || 'pendente',
    erro_envio:          dados.erro_envio            || null,
    enviado_por:         dados.enviado_por           || null,
    recebido_em:         dados.recebido_em           || (dados.direcao === 'recebida' ? ts : null),
    enviado_em:          dados.enviado_em            || (dados.direcao === 'enviada'  ? ts : null),
    criado_em:           ts,
    atualizado_em:       ts,
  };

  try {
    if (isSupa) {
      const { data, error } = await sb.from('whatsapp_mensagens').insert(registro).select().single();
      if (error) return { sucesso: false, erro: error.message };
      return { sucesso: true, dados: data };
    }
    // SQLite: fallback gracioso — tabela pode não existir
    return { sucesso: false, erro: 'Supabase não ativo. Execute supabase_patch_v7_whatsapp_conversas.sql.' };
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

// ── Listar mensagens de um lead ────────────────────────────────────────────────
/**
 * Retorna mensagens do lead ordenadas por criado_em ASC.
 * @param {string} leadId
 * @param {{ limite?: number, offset?: number }} opts
 */
async function listarMensagensLead(leadId, opts = {}) {
  const { sb, isSupa } = getProvider();
  const limite = Number(opts.limite) || 100;
  const offset = Number(opts.offset) || 0;

  try {
    if (isSupa) {
      const { data, error } = await sb.from('whatsapp_mensagens')
        .select('*, enviado_por_usuario:usuarios!enviado_por(nome)')
        .eq('lead_id', leadId)
        .is('deleted_at', null)
        .order('criado_em', { ascending: true })
        .range(offset, offset + limite - 1);
      if (error) return { sucesso: false, erro: error.message, dados: [] };
      const msgs = (data || []).map(m => ({
        ...m,
        enviado_por_nome: m.enviado_por_usuario?.nome || null,
      }));
      return { sucesso: true, dados: msgs };
    }
    return { sucesso: true, dados: [], aviso: 'Supabase não ativo.' };
  } catch (e) {
    return { sucesso: false, erro: e.message, dados: [] };
  }
}

// ── Listar todas as conversas agrupadas por telefone/lead ──────────────────────
/**
 * Agrupa mensagens por lead_id / telefone para exibir lista de conversas.
 * Retorna a última mensagem de cada grupo.
 */
async function listarConversas(opts = {}) {
  const { sb, isSupa } = getProvider();
  const limite = Number(opts.limite) || 50;

  try {
    if (!isSupa) return { sucesso: true, dados: [], aviso: 'Supabase não ativo.' };

    // Pega mensagens não deletadas ordenadas por criado_em DESC
    const { data, error } = await sb.from('whatsapp_mensagens')
      .select('*')
      .is('deleted_at', null)
      .order('criado_em', { ascending: false })
      .limit(500); // pega as 500 mais recentes para agrupar no JS

    if (error) return { sucesso: false, erro: error.message, dados: [] };

    // Agrupa por lead_id (ou telefone quando sem lead)
    const grupos = {};
    for (const m of data || []) {
      const chave = m.lead_id || m.telefone;
      if (!grupos[chave]) grupos[chave] = m; // mantém a mais recente (já ordenado DESC)
    }

    const conversas = Object.values(grupos)
      .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
      .slice(0, limite);

    return { sucesso: true, dados: conversas };
  } catch (e) {
    return { sucesso: false, erro: e.message, dados: [] };
  }
}

// ── Atualizar status de uma mensagem (ex: entregue, lido) ──────────────────────
async function atualizarStatusMensagem(id, statusEnvio, erroEnvio) {
  const { sb, isSupa } = getProvider();
  try {
    if (!isSupa) return { sucesso: false, erro: 'Supabase não ativo.' };
    const upd = { status_envio: statusEnvio, atualizado_em: agora() };
    if (erroEnvio !== undefined) upd.erro_envio = erroEnvio;
    const { data, error } = await sb.from('whatsapp_mensagens').update(upd).eq('id', id).select().single();
    if (error) return { sucesso: false, erro: error.message };
    return { sucesso: true, dados: data };
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

// ── Incluir tabela no backup automático ───────────────────────────────────────
// (apenas exporta o nome para que backupService.js inclua automaticamente)
const TABELA_NOME = 'whatsapp_mensagens';

module.exports = {
  salvarMensagem,
  listarMensagensLead,
  listarConversas,
  atualizarStatusMensagem,
  normalizePhone,
  TABELA_NOME,
};
