/**
 * PROSPEKT CRM — admVendasCloneService.js
 *
 * Serviço centralizado para clonar leads para Adm. de Vendas.
 *
 * GATILHO: lead movido para etapa "Vendas" (is_ganho=true OU nome=~/^vendas?$/i)
 *          em qualquer funil comercial.
 *
 * EXCLUÍDO como origem: funil "Adm. de Vendas" (evita loop).
 * INCLUÍDO como origem: Carteira Recorrente e todos os funis comerciais ativos.
 *
 * IDEMPOTÊNCIA: clonarDeLeadGanho já verifica duplicata por lead_original_id + data_venda.
 *
 * LOGS:
 *   ADM_VENDAS_CLONE_CHECK_START
 *   ADM_VENDAS_CLONE_SKIPPED_NOT_VENDAS
 *   ADM_VENDAS_CLONE_SKIPPED_FUNIL_NAO_COMERCIAL
 *   ADM_VENDAS_CLONE_ALREADY_EXISTS
 *   ADM_VENDAS_CLONE_CREATED_SUCCESS
 *   ADM_VENDAS_CLONE_ERROR
 */
const crypto = require('crypto');

// Regex para detectar etapa "Vendas" pelo nome (inclui variações comuns)
const REGEX_ETAPA_VENDAS = /^vendas?$/i;

// Regex para detectar funil "Adm. de Vendas" (único excluído como ORIGEM)
const REGEX_FUNIL_ADM_VENDAS = /adm\.?\s*(de\s*)?vendas|administra[çc][aã]o\s*de\s*vendas/i;

// Lazy import para evitar dependência circular
let _admVendasCtrl = null;
function getAdmVendasCtrl() {
  if (!_admVendasCtrl) _admVendasCtrl = require('../controllers/admVendasController');
  return _admVendasCtrl;
}

/**
 * Verifica se deve clonar e executa se necessário.
 * Seguro de chamar múltiplas vezes (idempotente).
 *
 * @param {Object} params
 *   leadId      {string}  — id do lead original
 *   etapaDestId {string}  — id da etapa destino
 *   sb          {object}  — Supabase client
 *   isSupa      {boolean} — modo Supabase
 *   sqlite      {object}  — SQLite db (pode ser null)
 *   usuarioId   {string}  — id do usuário que disparou a ação
 *   leadData    {object}  — dados do lead (opcional, busca no DB se null)
 */
async function clonarSeVendas({ leadId, etapaDestId, sb, isSupa, sqlite, usuarioId, leadData }) {
  try {
    console.log('ADM_VENDAS_CLONE_CHECK_START', { leadId, etapaDestId });

    if (!leadId || !etapaDestId) {
      console.log('ADM_VENDAS_CLONE_SKIPPED_NOT_VENDAS', { motivo: 'params ausentes', leadId, etapaDestId });
      return { clonado: false };
    }

    // ── 1. Busca etapa destino ─────────────────────────────────────────────────
    let etapaDest = null;
    if (isSupa && sb) {
      const { data } = await sb.from('etapas')
        .select('id, nome, is_ganho, probabilidade')
        .eq('id', etapaDestId)
        .maybeSingle();
      etapaDest = data;
    }
    // SQLite fallback (não implementado aqui — toda a lógica abaixo usa Supabase)
    if (!etapaDest) {
      console.log('ADM_VENDAS_CLONE_SKIPPED_NOT_VENDAS', { motivo: 'etapa não encontrada', leadId, etapaDestId });
      return { clonado: false };
    }

    // ── 2. Verifica se a etapa destino é "Vendas" ─────────────────────────────
    const nomeEtapa = (etapaDest.nome || '').trim();
    const etapaIsVendas =
      etapaDest.is_ganho ||
      etapaDest.probabilidade >= 100 ||
      REGEX_ETAPA_VENDAS.test(nomeEtapa) ||
      /\bvendas?\b/i.test(nomeEtapa);

    if (!etapaIsVendas) {
      console.log('ADM_VENDAS_CLONE_SKIPPED_NOT_VENDAS', {
        leadId,
        etapaNome: nomeEtapa,
        motivo: 'etapa não é "Vendas" nem marcada como ganho',
      });
      return { clonado: false };
    }

    // ── 3. Busca lead completo se não fornecido ────────────────────────────────
    if (!leadData && isSupa && sb) {
      const { data } = await sb.from('leads').select('*').eq('id', leadId).maybeSingle();
      leadData = data;
    }
    if (!leadData) {
      console.log('ADM_VENDAS_CLONE_SKIPPED_NOT_VENDAS', { motivo: 'lead não encontrado', leadId });
      return { clonado: false };
    }

    // ── 4. Verifica funil de origem — exclui APENAS "Adm. de Vendas" ──────────
    // Carteira Recorrente e todos os demais funis comerciais são VÁLIDOS como origem
    let funilNome = '';
    if (leadData.funil_id && isSupa && sb) {
      const { data: funil } = await sb.from('funis')
        .select('nome, ativo')
        .eq('id', leadData.funil_id)
        .maybeSingle();

      funilNome = funil?.nome || '';

      // Único exclusão: Adm. de Vendas como origem (evita loop)
      if (REGEX_FUNIL_ADM_VENDAS.test(funilNome)) {
        console.log('ADM_VENDAS_CLONE_SKIPPED_FUNIL_NAO_COMERCIAL', {
          leadId,
          funilNome,
          motivo: 'funil de origem é Adm. de Vendas — evita loop',
        });
        return { clonado: false };
      }

      // Funis inativos não disparam clone
      if (funil && funil.ativo === false) {
        console.log('ADM_VENDAS_CLONE_SKIPPED_FUNIL_NAO_COMERCIAL', {
          leadId,
          funilNome,
          motivo: 'funil inativo',
        });
        return { clonado: false };
      }
    }

    // ── 5. Carrega produtos do lead (multi-produto) ────────────────────────────
    let leadProdutos = [];
    try {
      if (isSupa && sb) {
        const { data: prods } = await sb.from('lead_produtos')
          .select('*')
          .eq('lead_id', leadId)
          .is('deleted_at', null)
          .order('criado_em');
        leadProdutos = prods || [];
      }
    } catch {}

    // ── 6. Chama clonarDeLeadGanho (idempotente — verifica duplicata por dia) ─
    const leadParaClone = { ...leadData, _lead_produtos: leadProdutos };
    const resultado = await getAdmVendasCtrl().clonarDeLeadGanho(
      leadParaClone,
      leadData.responsavel_id,
      sb,
      isSupa,
      sqlite
    );

    const agora = new Date().toISOString();

    if (resultado.criado) {
      // ── Clone criado com sucesso ────────────────────────────────────────────
      console.log('ADM_VENDAS_CLONE_CREATED_SUCCESS', {
        leadId,
        leadNome: leadData.nome,
        funilOrigem: funilNome,
        etapaDestino: nomeEtapa,
        cloneId: resultado.id,
      });

      if (isSupa && sb) {
        // Timeline visual no lead original (lead_timeline)
        await sb.from('lead_timeline').insert({
          id:          crypto.randomBytes(16).toString('hex'),
          lead_id:     leadId,
          tipo:        'ADM_VENDAS_CRIADO',
          descricao:   `Lead clonado automaticamente para Administração de Vendas após venda comercial. Card ADM criado (ID: ${resultado.id}).`,
          usuario_id:  usuarioId || null,
          criado_em:   agora,
        }).catch(() => {});

        // Log de auditoria (logs)
        await sb.from('logs').insert({
          id:           crypto.randomBytes(16).toString('hex'),
          acao:         'ADM_VENDAS_CRIADO',
          entidade:     'leads',
          entidade_id:  leadId,
          descricao:    `Venda concluída e enviada para Administração de Vendas. Card ADM: ${resultado.id}.`,
          depois:       JSON.stringify({ adm_venda_id: resultado.id, funil_origem: funilNome }),
          criado_em:    agora,
          origem_acao:  'automacao',
        }).catch(() => {});
      }

    } else if (!resultado.sucesso) {
      // ── Erro no clone ───────────────────────────────────────────────────────
      console.error('ADM_VENDAS_CLONE_ERROR', {
        leadId,
        funilNome,
        etapaDestino: nomeEtapa,
        erro: resultado.erro,
      });

    } else {
      // ── Clone já existia (idempotência) ────────────────────────────────────
      console.log('ADM_VENDAS_CLONE_ALREADY_EXISTS', {
        leadId,
        existenteId: resultado.id,
        funilNome,
        etapaDestino: nomeEtapa,
      });
    }

    return resultado;

  } catch (e) {
    console.error('ADM_VENDAS_CLONE_ERROR', {
      leadId,
      etapaDestId,
      erro: e.message,
      stack: e.stack?.split('\n').slice(0, 3).join(' | '),
    });
    return { sucesso: false, clonado: false, erro: e.message };
  }
}

module.exports = { clonarSeVendas };
