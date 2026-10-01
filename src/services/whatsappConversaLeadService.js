/**
 * PROSPEKT CRM — whatsappConversaLeadService.js
 * Serviço responsável pelo ciclo de vida e vínculo entre leads e conversas WhatsApp:
 *   - Normalização segura de telefones (padrão WhatsApp BR +55)
 *   - Resolução de variantes de telefone
 *   - Criação e/ou vinculação idempotente de conversa para lead
 *   - Reconciliação em lote para leads já importados
 *
 * REGRA ABSOLUTA:
 * - Não toca em Evolution API, webhooks ou envio de mensagens.
 * - NUNCA usar .catch() encadeado no Supabase query builder.
 */

const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

const CONVERSAS_TABLE = 'conversas_whatsapp';

// Números oficiais do CRM — NUNCA são clientes
const _NUMEROS_OFICIAIS = new Set([
  '5511987994910',
  '5511967668883',
]);

function normalizarTelefoneParaWhatsApp(value) {
  if (!value) return '';
  let t = String(value).trim();

  // Rejeita @lid explicitamente
  if (t.includes('@lid')) return '';

  // Remove sufixo @s.whatsapp.net e :0
  t = t.split('@')[0].split(':')[0];

  // Se tiver letras no username, rejeita
  if (/[a-zA-Z]/.test(t)) return '';

  // Apenas dígitos
  t = t.replace(/\D/g, '');
  if (!t) return '';

  // Rejeita LID por comprimento: 14+ dígitos sem 55
  if (t.length >= 14 && !t.startsWith('55')) return '';

  // Rejeita unix timestamps acidentais
  const numVal = Number(t);
  if ((t.length === 10 && numVal >= 1000000000 && numVal <= 2200000000) ||
      (t.length === 13 && numVal >= 1000000000000 && numVal <= 2200000000000)) {
    // Atenção: telefones DDD 10-22 no Brasil não devem ser descartados se tiverem 10 dígitos reais
    // mas se forem timestamp unix evidente são descartados.
  }

  // Se tiver 10 ou 11 dígitos, adiciona DDI 55 (Brasil)
  if (t.length === 10 || t.length === 11) {
    t = '55' + t;
  }

  // Validação: formato brasileiro (55 + 10 ou 11 dígitos) ou internacional (10 a 15 dígitos)
  const isValid = /^55\d{10,11}$/.test(t) || /^\d{10,15}$/.test(t);
  if (!isValid) return '';

  // Rejeita número oficial
  if (_NUMEROS_OFICIAIS.has(t)) return '';

  return t;
}

/**
 * Gera variantes de telefone para busca robusta no banco
 */
function phoneVariants(tel) {
  const base = normalizarTelefoneParaWhatsApp(tel);
  if (!base) return [];
  const variants = new Set();
  variants.add(base);

  // Sem DDI 55
  if (base.startsWith('55') && base.length >= 12) {
    variants.add(base.slice(2));
  }

  // Com / sem 9º dígito
  const hasPref = base.startsWith('55') && base.length >= 12;
  const ddd   = hasPref ? base.slice(2, 4) : base.slice(0, 2);
  const resto = hasPref ? base.slice(4) : base.slice(2);
  const pref  = hasPref ? '55' : '';

  if (resto.length === 9 && resto[0] === '9') {
    variants.add(pref + ddd + resto.slice(1));
    if (pref) variants.add(ddd + resto.slice(1));
  } else if (resto.length === 8) {
    variants.add(pref + ddd + '9' + resto);
    if (pref) variants.add(ddd + '9' + resto);
  }

  return [...variants];
}

/**
 * Vincula lead a uma conversa existente ou cria conversa nova vazia.
 *
 * @param {Object} params
 * @param {string} params.leadId
 * @param {string} params.telefone
 * @param {string} [params.nome]
 * @param {string} [params.vendedorId]
 * @param {'IMPORT'|'LEAD_OPEN'} [params.contexto='IMPORT']
 * @returns {Promise<Object|null>}
 */
async function vincularOuCriarConversaParaLead({ leadId, telefone, nome, vendedorId, contexto = 'IMPORT' }) {
  const { sb, isSupa, sqlite } = getProvider();

  const isImport = contexto === 'IMPORT';
  const logPrefix = isImport ? 'IMPORT_LEAD_WHATSAPP' : 'LEAD_OPEN_CONVERSA';

  console.log(`${logPrefix}_LINK_START`, { leadId, telefoneOriginal: telefone, vendedorId });

  // 1. Normaliza telefone
  const telNorm = normalizarTelefoneParaWhatsApp(telefone);
  console.log(`${logPrefix}_PHONE_NORMALIZED`, { leadId, telNorm });

  if (!telNorm) {
    console.warn(`${logPrefix}_LINK_ERROR`, { leadId, motivo: 'telefone_invalido_ou_ausente', telefone });
    return null;
  }

  const agora = new Date().toISOString();

  if (isSupa) {
    let conversa = null;

    // 2. Se leadId fornecido, busca conversa ativa vinculada ao lead
    if (leadId) {
      const { data: byLead, error: errLead } = await sb
        .from(CONVERSAS_TABLE)
        .select('*')
        .eq('lead_id', leadId)
        .neq('status', 'FECHADA')
        .order('criado_em', { ascending: false })
        .limit(1);

      if (!errLead && byLead?.[0]) {
        conversa = byLead[0];
        console.log(isImport ? 'IMPORT_LEAD_WHATSAPP_CONVERSA_FOUND' : 'LEAD_OPEN_CONVERSA_FOUND_BY_LEAD', {
          id: conversa.id,
          leadId
        });
      }
    }

    // 3. Se não encontrou por lead_id, busca por variantes de telefone
    if (!conversa) {
      const variantes = phoneVariants(telNorm);
      for (const v of variantes) {
        const { data: byTel, error: errTel } = await sb
          .from(CONVERSAS_TABLE)
          .select('*')
          .eq('telefone', v)
          .neq('status', 'FECHADA')
          .order('criado_em', { ascending: false })
          .limit(1);

        if (!errTel && byTel?.[0]) {
          conversa = byTel[0];
          console.log(isImport ? 'IMPORT_LEAD_WHATSAPP_CONVERSA_FOUND' : 'LEAD_OPEN_CONVERSA_FOUND_BY_PHONE', {
            id: conversa.id,
            telefoneVariante: v
          });
          break;
        }
      }
    }

    // 4. Se encontrou conversa existente: atualiza vínculos
    if (conversa) {
      const upd = {};
      if (leadId && !conversa.lead_id) upd.lead_id = leadId;
      if (vendedorId && conversa.vendedor_id !== vendedorId) upd.vendedor_id = vendedorId;
      if (nome && !conversa.nome_contato) upd.nome_contato = nome;

      if (Object.keys(upd).length > 0) {
        upd.atualizado_em = agora;
        const { data: updConv, error: errUpd } = await sb
          .from(CONVERSAS_TABLE)
          .update(upd)
          .eq('id', conversa.id)
          .select()
          .single();

        if (!errUpd && updConv) {
          conversa = updConv;
          console.log(isImport ? 'IMPORT_LEAD_WHATSAPP_CONVERSA_LINKED' : 'LEAD_OPEN_CONVERSA_LINKED_TO_RESPONSAVEL', {
            id: conversa.id,
            leadId,
            vendedorId
          });
        }
      }
      return conversa;
    }

    // 5. Se não encontrou nenhuma conversa: cria conversa nova vazia
    const novaId = crypto.randomBytes(16).toString('hex');
    const novaRow = {
      id:            novaId,
      lead_id:       leadId || null,
      telefone:      telNorm,
      nome_contato:  nome || null,
      vendedor_id:   vendedorId || null,
      origem:        isImport ? 'IMPORTACAO' : 'MANUAL',
      status:        'ABERTA',
      criado_em:     agora,
      atualizado_em: agora,
    };

    const { data: novaCriada, error: errInsert } = await sb
      .from(CONVERSAS_TABLE)
      .insert(novaRow)
      .select()
      .single();

    if (errInsert || !novaCriada) {
      console.error(isImport ? 'IMPORT_LEAD_WHATSAPP_LINK_ERROR' : 'LEAD_OPEN_CONVERSA_ERROR', {
        leadId,
        erro: errInsert?.message
      });
      return null;
    }

    console.log(isImport ? 'IMPORT_LEAD_WHATSAPP_CONVERSA_CREATED' : 'LEAD_OPEN_CONVERSA_CREATED', {
      id: novaCriada.id,
      leadId,
      telNorm,
      vendedorId
    });
    return novaCriada;
  }

  // ── SQLite fallback ──────────────────────────────────────────────────────────
  try {
    const db = sqlite;
    let conversa = null;

    if (leadId) {
      conversa = db.prepare(`SELECT * FROM ${CONVERSAS_TABLE} WHERE lead_id = ? AND status != 'FECHADA' ORDER BY criado_em DESC LIMIT 1`).get(leadId);
      if (conversa) {
        console.log(isImport ? 'IMPORT_LEAD_WHATSAPP_CONVERSA_FOUND' : 'LEAD_OPEN_CONVERSA_FOUND_BY_LEAD', { id: conversa.id, leadId });
      }
    }

    if (!conversa) {
      const variantes = phoneVariants(telNorm);
      for (const v of variantes) {
        const row = db.prepare(`SELECT * FROM ${CONVERSAS_TABLE} WHERE telefone = ? AND status != 'FECHADA' ORDER BY criado_em DESC LIMIT 1`).get(v);
        if (row) {
          conversa = row;
          console.log(isImport ? 'IMPORT_LEAD_WHATSAPP_CONVERSA_FOUND' : 'LEAD_OPEN_CONVERSA_FOUND_BY_PHONE', { id: conversa.id, telefone: v });
          break;
        }
      }
    }

    if (conversa) {
      const updLead = leadId && !conversa.lead_id ? leadId : conversa.lead_id;
      const updVend = vendedorId || conversa.vendedor_id;
      const updNome = nome || conversa.nome_contato;

      db.prepare(`UPDATE ${CONVERSAS_TABLE} SET lead_id = ?, vendedor_id = ?, nome_contato = ?, atualizado_em = ? WHERE id = ?`)
        .run(updLead, updVend, updNome, agora, conversa.id);

      conversa = db.prepare(`SELECT * FROM ${CONVERSAS_TABLE} WHERE id = ?`).get(conversa.id);
      console.log(isImport ? 'IMPORT_LEAD_WHATSAPP_CONVERSA_LINKED' : 'LEAD_OPEN_CONVERSA_LINKED_TO_RESPONSAVEL', { id: conversa.id, leadId, vendedorId });
      return conversa;
    }

    const novaId = crypto.randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO ${CONVERSAS_TABLE} (id, lead_id, telefone, nome_contato, vendedor_id, origem, status, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(novaId, leadId || null, telNorm, nome || null, vendedorId || null, isImport ? 'IMPORTACAO' : 'MANUAL', 'ABERTA', agora, agora);

    conversa = db.prepare(`SELECT * FROM ${CONVERSAS_TABLE} WHERE id = ?`).get(novaId);
    console.log(isImport ? 'IMPORT_LEAD_WHATSAPP_CONVERSA_CREATED' : 'LEAD_OPEN_CONVERSA_CREATED', { id: novaId, leadId, vendedorId });
    return conversa;
  } catch (errSqlite) {
    console.error(isImport ? 'IMPORT_LEAD_WHATSAPP_LINK_ERROR' : 'LEAD_OPEN_CONVERSA_ERROR', { leadId, erro: errSqlite.message });
    return null;
  }
}

/**
 * Reconcilia conversas para leads já importados
 * Idempotente: pode ser chamado várias vezes sem duplicar conversas.
 *
 * @param {Object} options
 * @param {string} [options.vendedorId] - Filtro opcional por vendedor
 * @returns {Promise<Object>}
 */
async function reconciliarConversasLeadsImportados({ vendedorId } = {}) {
  const { sb, isSupa, sqlite } = getProvider();

  let leads = [];

  if (isSupa) {
    let q = sb.from('leads').select('id,nome,telefone,responsavel_id').neq('status', 'arquivado').not('telefone', 'is', null);
    if (vendedorId) q = q.eq('responsavel_id', vendedorId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    leads = data || [];
  } else {
    let sql = `SELECT id,nome,telefone,responsavel_id FROM leads WHERE status != 'arquivado' AND telefone IS NOT NULL`;
    const params = [];
    if (vendedorId) {
      sql += ' AND responsavel_id = ?';
      params.push(vendedorId);
    }
    leads = sqlite.prepare(sql).all(...params);
  }

  let vinculadas = 0;
  let criadas    = 0;
  let erros      = 0;
  let ignorados  = 0;

  for (const lead of leads) {
    try {
      const telNorm = normalizarTelefoneParaWhatsApp(lead.telefone);
      if (!telNorm) {
        ignorados++;
        continue;
      }

      // Verifica se já existia conversa antes da chamada
      let existiaAntes = false;
      if (isSupa) {
        const { data: ex } = await sb.from(CONVERSAS_TABLE).select('id').eq('lead_id', lead.id).limit(1);
        existiaAntes = Boolean(ex?.[0]);
      } else {
        const ex = sqlite.prepare(`SELECT id FROM ${CONVERSAS_TABLE} WHERE lead_id = ? LIMIT 1`).get(lead.id);
        existiaAntes = Boolean(ex);
      }

      const conv = await vincularOuCriarConversaParaLead({
        leadId:     lead.id,
        telefone:   lead.telefone,
        nome:       lead.nome,
        vendedorId: lead.responsavel_id,
        contexto:   'IMPORT'
      });

      if (conv) {
        if (existiaAntes) vinculadas++;
        else criadas++;
      } else {
        erros++;
      }
    } catch (e) {
      console.error('RECONCILIAR_LEAD_ERROR', { leadId: lead.id, erro: e.message });
      erros++;
    }
  }

  return {
    total_leads: leads.length,
    conversas_criadas: criadas,
    conversas_vinculadas: vinculadas,
    ignorados_sem_telefone: ignorados,
    erros
  };
}

module.exports = {
  normalizarTelefoneParaWhatsApp,
  phoneVariants,
  vincularOuCriarConversaParaLead,
  reconciliarConversasLeadsImportados
};
