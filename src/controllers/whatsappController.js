/**
 * PROSPEKT CRM — WhatsApp Controller
 * Módulo de conversas, histórico e automação tráfego pago
 *
 * LEGADO: funções originais usam SQLite (getDb)
 * NOVO: funções *Supabase usam whatsappService (tabela whatsapp_mensagens)
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');
const { getProvider } = require('../database/dbProvider');
const waSvc   = require('../services/whatsappService');
const planilhaSvc = require('../services/planilhaLeadsService');
const evoSvc  = require('../services/evolutionApiService');


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function normalizePhoneBR(value) {
  if (!value) return null;
  let t = String(value).trim();
  
  // Se contiver letras no nome do contato / JID, rejeita
  let username = t.split('@')[0].split(':')[0];
  if (/[a-zA-Z]/.test(username)) {
    return null;
  }
  
  // Remove sufixo do whatsapp
  t = t.split('@')[0].split(':')[0];
  
  // Remove caracteres não numéricos
  t = t.replace(/\D/g, '');
  if (!t) return null;
  
  // Rejeita se for timestamp unix
  const numVal = Number(t);
  if ((t.length === 10 && numVal >= 1000000000 && numVal <= 2200000000) ||
      (t.length === 13 && numVal >= 1000000000000 && numVal <= 2200000000000)) {
    return null;
  }
  
  // Se tiver 10 ou 11 dígitos, adiciona 55 (Brasil)
  if (t.length === 10 || t.length === 11) {
    t = '55' + t;
  }
  
  // Valida: se começar com 55 e tiver 12 ou 13 dígitos
  // Ou se for qualquer outro número internacional válido (entre 10 e 15 dígitos)
  const isValid = /^55\d{10,11}$/.test(t) || /^\d{10,15}$/.test(t);
  if (isValid) {
    return t;
  }
  
  return null;
}

function normalizePhone(tel) {
  return normalizePhoneBR(tel) || '';
}

/**
 * Gera TODAS as variantes possíveis de um telefone para busca robusta.
 * Cobre: com 55 / sem 55 / com 9º dígito / sem 9º dígito
 * Elimina duplicatas e strings vazias.
 */
function phoneVariants(tel) {
  const base = normalizePhone(tel);
  if (!base) return [];
  const variants = new Set();

  // base sempre inclusa
  variants.add(base);

  // sem DDI 55
  const sem55 = base.startsWith('55') && base.length >= 12 ? base.slice(2) : null;
  if (sem55) variants.add(sem55);

  // Adiciona/remove 9º dígito (Brasil: DDD 2 dígitos + número)
  // Com 55: 55 + DDD(2) + digitos -> total 12 (sem 9) ou 13 (com 9)
  // Sem 55: DDD(2) + digitos -> total 10 (sem 9) ou 11 (com 9)
  const adicionarRemoverNono = (num) => {
    const results = new Set();
    results.add(num);
    const hasPref = num.startsWith('55') && num.length >= 12;
    const ddd   = hasPref ? num.slice(2, 4) : num.slice(0, 2);
    const resto = hasPref ? num.slice(4) : num.slice(2);
    const pref  = hasPref ? '55' : '';
    if (resto.length === 9 && resto[0] === '9') {
      // remove 9º dígito
      results.add(pref + ddd + resto.slice(1));
    } else if (resto.length === 8) {
      // adiciona 9º dígito
      results.add(pref + ddd + '9' + resto);
    }
    return results;
  };

  adicionarRemoverNono(base).forEach(v => variants.add(v));
  if (sem55) adicionarRemoverNono(sem55).forEach(v => variants.add(v));
  // Garante variantes com 55 para cada variante sem 55
  [...variants].forEach(v => {
    if (!v.startsWith('55') && v.length >= 10) variants.add('55' + v);
  });

  return [...variants].filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// resolverConversaWhatsapp — FUNÇÃO CENTRAL DE RESOLUÇÃO
// Garante que NUNCA se cria conversa duplicada para o mesmo telefone/LID.
//
// Ordem de busca:
//   1. LID em dados_extras (like + jsonb)
//   2. lead_id
//   3. Telefone — exact match todas as variantes
//   4. Telefone — ilike fallback legado
//   5. LID → Evolution API → telefone real
//   6. LID → nome_contato único
//   7. LID → conversa pendente existente
//   8. fromMe=true sem conversa → BLOQUEIA criação
//
// Retorna: { conversaId, permiteCreate, fonte }
// ─────────────────────────────────────────────────────────────────────────────
async function resolverConversaWhatsapp(sb, { tel, lidNumero, leadId, isLidJid, rawJid, fromMe, nome }) {
  const agora = new Date().toISOString();
  let conversaId = null;
  let fonte = null;

  console.log('CONVERSA_RESOLVE_START', { tel, lidNumero, leadId, isLidJid, fromMe, nome: nome?.slice(0,30) });

  // ── Passo 1: LID em dados_extras ────────────────────────────────────────
  if (!conversaId && isLidJid && lidNumero) {
    console.log('CONVERSA_LOOKUP_LID', { lidNumero });
    const { data: byLike } = await sb.from('conversas_whatsapp')
      .select('id,telefone,lead_id').like('dados_extras', `%${lidNumero}%`)
      .neq('status', 'FECHADA').order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
    if (byLike?.[0]) {
      conversaId = byLike[0].id; fonte = 'lid_like';
      console.log('CONVERSA_FOUND_EXISTING', { conversaId, fonte, lidNumero });
    }
    if (!conversaId) {
      const { data: byJson } = await sb.from('conversas_whatsapp')
        .select('id,telefone,lead_id')
        .filter('dados_extras', 'cs', JSON.stringify({ lid: lidNumero }))
        .neq('status', 'FECHADA').order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
      if (byJson?.[0]) {
        conversaId = byJson[0].id; fonte = 'lid_jsonb';
        console.log('CONVERSA_FOUND_EXISTING', { conversaId, fonte, lidNumero });
      }
    }
  }

  // ── Passo 2: por lead_id ────────────────────────────────────────────────
  if (!conversaId && leadId) {
    console.log('CONVERSA_LOOKUP_LEAD', { leadId });
    const { data: byLead } = await sb.from('conversas_whatsapp')
      .select('id').eq('lead_id', leadId).neq('status', 'FECHADA')
      .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
    if (byLead?.[0]) {
      conversaId = byLead[0].id; fonte = 'lead_id';
      console.log('CONVERSA_FOUND_EXISTING', { conversaId, fonte, leadId });
    }
  }

  // ── Passo 3: telefone — exact match ─────────────────────────────────────
  if (!conversaId && tel) {
    console.log('CONVERSA_LOOKUP_PHONE', { tel });
    const variantes = phoneVariants(tel);
    for (const v of variantes) {
      const { data: byTel } = await sb.from('conversas_whatsapp')
        .select('id,telefone').eq('telefone', v).neq('status', 'FECHADA')
        .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
      if (byTel?.[0]) {
        conversaId = byTel[0].id; fonte = `telefone_eq`;
        console.log('CONVERSA_FOUND_EXISTING', { conversaId, fonte, variante: v });
        break;
      }
    }
  }

  // ── Passo 4: telefone — ilike fallback ──────────────────────────────────
  if (!conversaId && tel) {
    const variantes = phoneVariants(tel).filter(v => v.length >= 10);
    for (const v of variantes) {
      const { data: byIlike } = await sb.from('conversas_whatsapp')
        .select('id,telefone').ilike('telefone', `%${v}%`).neq('status', 'FECHADA')
        .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
      if (byIlike?.[0]) {
        conversaId = byIlike[0].id; fonte = `telefone_ilike`;
        console.log('CONVERSA_FOUND_EXISTING', { conversaId, fonte, variante: v, telSalvo: byIlike[0].telefone });
        await sb.from('conversas_whatsapp')
          .update({ telefone: tel, atualizado_em: agora }).eq('id', conversaId);
        break;
      }
    }
  }

  // ── Passo 5: LID → Evolution API → telefone real ────────────────────────
  if (!conversaId && isLidJid && lidNumero) {
    console.log('CONVERSA_LOOKUP_LID_EVO_API', { lidNumero });
    try {
      const lidJidCompleto = rawJid?.includes('@') ? rawJid : `${lidNumero}@lid`;
      const resContato = await evoSvc.call('POST', `/contacts/find/${evoSvc.EVOLUTION_INSTANCE}`, { where: { id: lidJidCompleto } });
      const contato = (Array.isArray(resContato?.dados) ? resContato.dados : (resContato?.dados ? [resContato.dados] : []))[0] || null;
      if (contato) {
        const jidReal = contato.id || contato.remoteJid || '';
        const telRaw  = contato.phone || (jidReal.includes('@s.whatsapp.net') ? jidReal.split('@')[0] : null);
        if (telRaw) {
          const telNorm = normalizePhone(telRaw);
          for (const v of phoneVariants(telNorm)) {
            const { data: byEvo } = await sb.from('conversas_whatsapp')
              .select('id,dados_extras').eq('telefone', v).neq('status', 'FECHADA')
              .order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1);
            if (byEvo?.[0]) {
              conversaId = byEvo[0].id; fonte = 'lid_evo_phone';
              console.log('CONVERSA_FOUND_EXISTING', { conversaId, fonte, lidNumero, telNorm });
              const ext = (() => { try { return JSON.parse(byEvo[0].dados_extras || '{}'); } catch { return {}; } })();
              if (!ext.lid) {
                await sb.from('conversas_whatsapp')
                  .update({ dados_extras: JSON.stringify({ ...ext, lid: lidNumero }), atualizado_em: agora })
                  .eq('id', conversaId);
              }
              break;
            }
          }
        }
      }
    } catch (e) { console.warn('CONVERSA_LOOKUP_LID_EVO_ERROR', e.message); }
  }

  // ── Passo 6: LID → nome_contato único ───────────────────────────────────
  if (!conversaId && isLidJid && lidNumero && nome && !fromMe) {
    const primeiroNome = nome.split(' ')[0];
    if (primeiroNome.length >= 3) {
      const { data: byNome } = await sb.from('conversas_whatsapp')
        .select('id,dados_extras').ilike('nome_contato', `%${primeiroNome}%`)
        .neq('status', 'FECHADA').order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(2);
      if (byNome?.length === 1) {
        conversaId = byNome[0].id; fonte = 'lid_nome_contato';
        console.log('CONVERSA_FOUND_EXISTING', { conversaId, fonte, nome, primeiroNome });
        const ext = (() => { try { return JSON.parse(byNome[0].dados_extras || '{}'); } catch { return {}; } })();
        if (!ext.lid) {
          await sb.from('conversas_whatsapp')
            .update({ dados_extras: JSON.stringify({ ...ext, lid: lidNumero }), atualizado_em: agora })
            .eq('id', conversaId);
        }
      } else if (byNome?.length > 1) {
        console.warn('CONVERSA_LOOKUP_LID_NOME_AMBIGUO', { nome, primeiroNome, qtd: byNome.length });
      }
    }
  }

  // ── Passo 7: LID → conversa pendente existente ───────────────────────────
  if (!conversaId && isLidJid && lidNumero) {
    const { data: pendente } = await sb.from('conversas_whatsapp')
      .select('id').like('dados_extras', `%"lid":"${lidNumero}"%`)
      .order('criado_em', { ascending: false }).limit(1);
    if (pendente?.[0]) {
      conversaId = pendente[0].id; fonte = 'lid_pending_existente';
      console.log('CONVERSA_FOUND_EXISTING', { conversaId, fonte, lidNumero });
      console.log('CONVERSA_CREATE_BLOCKED_DUPLICATE', { lidNumero, conversaId });
    }
  }

  // ── Passo 8: fromMe=true sem conversa → BLOQUEAR ────────────────────────
  if (!conversaId && fromMe) {
    console.log('WHATSAPP_FROM_ME_IGNORED_NO_CONVERSA', { tel, lidNumero, nome });
    return { conversaId: null, permiteCreate: false, fonte: 'from_me_blocked' };
  }

  if (conversaId) {
    return { conversaId, permiteCreate: false, fonte };
  }

  console.log('CONVERSA_CREATE_ALLOWED', { tel, lidNumero, leadId });
  return { conversaId: null, permiteCreate: true, fonte: 'nao_encontrada' };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/conversas
// Lista todas as conversas com última mensagem
// ─────────────────────────────────────────────────────────────────────────────
async function listarConversas(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const { vendedor_id, status, busca, limit = 50, offset = 0 } = req.query;
    const role = req.usuario.role;

    if (isSupa) {
      let q = sb.from('conversas_whatsapp')
        .select('*, usuarios!conversas_whatsapp_vendedor_id_fkey(nome), leads!conversas_whatsapp_lead_id_fkey(nome,empresa)')
        .order('ultima_msg_em', { ascending: false, nullsFirst: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      if (role === 'VENDEDOR') q = q.eq('vendedor_id', req.usuario.id);
      if (vendedor_id) q = q.eq('vendedor_id', vendedor_id);
      // Por padrão: exclui FECHADA (inclui duplicatas marcadas por deduplicação)
      // Se o usuário pedir status=FECHADA explicitamente, mostra normalmente
      if (status) {
        q = q.eq('status', status);
      } else {
        q = q.neq('status', 'FECHADA');
      }
      if (busca)       q = q.or(`telefone.ilike.%${busca}%,nome_contato.ilike.%${busca}%`);
      const { data, error } = await q;
      if (error) throw error;
      const conversas = (data || []).map(c => ({
        ...c,
        vendedor_nome: c.usuarios?.nome || null,
        lead_nome:     c.leads?.nome    || null,
        lead_empresa:  c.leads?.empresa || null,
      }));
      // Ultima mensagem por conversa
      const ids = conversas.map(c => c.id);
      let ultimaMap = {};
      if (ids.length > 0) {
        const { data: msgs } = await sb.from('mensagens_whatsapp')
          .select('conversa_id,mensagem,direcao,criado_em')
          .in('conversa_id', ids)
          .order('criado_em', { ascending: false });
        (msgs || []).forEach(m => { if (!ultimaMap[m.conversa_id]) ultimaMap[m.conversa_id] = m; });
      }
      const comUltima = conversas.map(c => ({
        ...c,
        ultima_mensagem: ultimaMap[c.id]?.mensagem || null,
        ultima_direcao:  ultimaMap[c.id]?.direcao  || null,
      }));
      return res.json({ sucesso: true, dados: comUltima, total: comUltima.length });
    }

    const db = getDb();
    // SQLite fallback (variáveis já declaradas acima)

    let sql = `
      SELECT
        c.*,
        u.nome AS vendedor_nome,
        l.nome AS lead_nome,
        l.empresa AS lead_empresa,
        (SELECT mensagem FROM mensagens_whatsapp WHERE conversa_id = c.id
         ORDER BY criado_em DESC LIMIT 1) AS ultima_mensagem,
        (SELECT direcao FROM mensagens_whatsapp WHERE conversa_id = c.id
         ORDER BY criado_em DESC LIMIT 1) AS ultima_direcao,
        (SELECT COUNT(*) FROM mensagens_whatsapp WHERE conversa_id = c.id
         AND direcao = 'recebida' AND status = 'enviado') AS nao_lidas
      FROM conversas_whatsapp c
      LEFT JOIN usuarios u ON c.vendedor_id = u.id
      LEFT JOIN leads l ON c.lead_id = l.id
      WHERE 1=1
    `;
    const params = [];

    // Filtro de permissão
    if (req.usuario.role === 'VENDEDOR') {
      sql += ' AND c.vendedor_id = ?';
      params.push(req.usuario.id);
    } else if (req.usuario.role === 'GESTOR') {
      // Gestor vê sua equipe — por ora vê todos ativos
    }

    if (vendedor_id) { sql += ' AND c.vendedor_id = ?'; params.push(vendedor_id); }
    if (status)      { sql += ' AND c.status = ?';      params.push(status); }
    if (busca) {
      sql += ` AND (c.telefone LIKE ? OR c.nome_contato LIKE ? OR l.nome LIKE ?)`;
      const like = `%${busca}%`;
      params.push(like, like, like);
    }

    sql += ' ORDER BY COALESCE(c.ultima_msg_em, c.criado_em) DESC';
    sql += ` LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const conversas = db.prepare(sql).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as n FROM conversas_whatsapp WHERE 1=1`).get();

    return res.json({ sucesso: true, dados: conversas, total: total.n });
  } catch (e) {
    console.error('[WA] listarConversas:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao listar conversas.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/conversas/:id/mensagens
// Retorna mensagens paginadas de uma conversa
// ─────────────────────────────────────────────────────────────────────────────
async function listarMensagens(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const { id } = req.params;
    const { limit = 200, offset = 0 } = req.query;

    if (isSupa) {
      const { data: conversa, error: errC } = await sb.from('conversas_whatsapp')
        .select('*, usuarios!conversas_whatsapp_vendedor_id_fkey(nome), leads!conversas_whatsapp_lead_id_fkey(nome,empresa)')
        .eq('id', id).single();
      if (errC || !conversa) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
      if (req.usuario.role === 'VENDEDOR' && conversa.vendedor_id !== req.usuario.id)
        return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

      const { data: msgs, error: errM } = await sb.from('mensagens_whatsapp')
        .select('*, usuarios!mensagens_whatsapp_vendedor_id_fkey(nome)')
        .eq('conversa_id', id)
        .order('criado_em', { ascending: true })
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      if (errM) throw errM;

      const normalizado = (msgs || []).map(m => ({ ...m, vendedor_nome: m.usuarios?.nome || null }));
      const convNorm = { ...conversa, vendedor_nome: conversa.usuarios?.nome, lead_nome: conversa.leads?.nome, lead_empresa: conversa.leads?.empresa };

      // Marca como lidas (não bloqueia resposta)
      sb.from('mensagens_whatsapp').update({ status: 'lido' })
        .eq('conversa_id', id).eq('direcao', 'recebida').neq('status', 'lido').then(() => {});

      return res.json({ sucesso: true, dados: normalizado, conversa: convNorm });
    }

    const db = getDb();
    const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
    if (!conversa) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
    if (req.usuario.role === 'VENDEDOR' && conversa.vendedor_id !== req.usuario.id)
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
    const msgs = db.prepare(`SELECT m.*, u.nome AS vendedor_nome FROM mensagens_whatsapp m LEFT JOIN usuarios u ON m.vendedor_id = u.id WHERE m.conversa_id = ? ORDER BY m.criado_em ASC LIMIT ? OFFSET ?`).all(id, Number(limit), Number(offset));
    db.prepare(`UPDATE mensagens_whatsapp SET status = 'lido' WHERE conversa_id = ? AND direcao = 'recebida' AND status != 'lido'`).run(id);
    return res.json({ sucesso: true, dados: msgs, conversa });
  } catch (e) {
    console.error('[WA] listarMensagens:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao carregar mensagens.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/conversas/:id/mensagens
// Envia uma mensagem (cria registro no banco)
// ─────────────────────────────────────────────────────────────────────────────
async function enviarMensagem(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const { id } = req.params;
    const { mensagem, tipo = 'texto', arquivo_url, arquivo_nome } = req.body;

    if (!mensagem && !arquivo_url)
      return res.status(400).json({ sucesso: false, erro: 'Mensagem ou arquivo obrigatório.' });

    // ── 1. Busca conversa ────────────────────────────────────────────────────
    let conversa = null;
    if (isSupa) {
      const { data, error: errC } = await sb.from('conversas_whatsapp').select('*').eq('id', id).single();
      if (errC || !data) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
      conversa = data;
    } else {
      const db = getDb();
      conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
    }
    if (!conversa) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });

    if (req.usuario.role === 'VENDEDOR' && conversa.vendedor_id !== req.usuario.id)
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

    // ── 2. Normaliza telefone da conversa ────────────────────────────────────
    const telNormalizado = normalizePhone(conversa.telefone);
    if (!telNormalizado)
      return res.status(400).json({ sucesso: false, erro: 'Conversa sem telefone válido.' });

    // ── 3. Monta texto com identificação do remetente ─────────────────────────
    // Formato: "Nome | PROSPEKT\n\nMensagem"
    // Guard: não duplica o cabeçalho se a mensagem já começar com "| PROSPEKT"
    const nomeRemetente  = req.usuario.nome || 'CRM';
    const cabecalho      = `${nomeRemetente} | PROSPEKT`;
    const jaTemCabecalho = tipo === 'texto' && (mensagem || '').trimStart().includes('| PROSPEKT');
    const textoParaCliente = tipo === 'texto'
      ? (jaTemCabecalho ? mensagem : `${cabecalho}\n\n${mensagem}`)
      : (mensagem || '');

    // ── 4. ENVIA PELA EVOLUTION PRIMEIRO (antes de salvar) ────────────────────
    let evoOk  = false;
    let evoErr = null;
    let evoRes = null; // ← declarado no escopo externo para evitar ReferenceError

    if (evoSvc.isConfigured() && tipo === 'texto' && mensagem) {
      const endpoint = `/message/sendText/${evoSvc.EVOLUTION_INSTANCE}`;
      const payload  = { number: telNormalizado, textMessage: { text: textoParaCliente } };

      // Logs obrigatórios antes do envio
      console.log('CRM_SEND_WHATSAPP_START', {
        conversaId: id,
        leadId: conversa.lead_id || null,
        telefoneOriginal: conversa.telefone,
        telefoneNormalizado: telNormalizado,
        textoDigitado: mensagem?.slice(0, 80),
        textoFinal: textoParaCliente?.slice(0, 80),
      });
      console.log('EVOLUTION_SEND_ENDPOINT', `${process.env.EVOLUTION_API_URL || ''}${endpoint}`);
      console.log('EVOLUTION_SEND_PAYLOAD', JSON.stringify(payload, null, 2));

      evoRes = await evoSvc.enviarTexto(telNormalizado, textoParaCliente);

      console.log('EVOLUTION_SEND_RESPONSE_STATUS', evoRes.status || (evoRes.sucesso ? 200 : 500));
      console.log('EVOLUTION_SEND_RESPONSE_DATA_RAW', JSON.stringify(evoRes.dados || evoRes.erro, null, 2));

      // ── Detecta sucesso real da Evolution API ─────────────────────────────
      // A Evolution v1.8.6 retorna sucesso quando:
      //   (a) evoRes.sucesso = true  (HTTP 2xx)
      //   (b) OU: body contém key.id ou messageId → mensagem foi aceita e enfileirada
      //       mesmo que o HTTP status seja 201/400 em alguns casos de versão
      const evoKeyId = evoRes.dados?.key?.id || evoRes.dados?.messageId || null;
      const evoSucessoReal = evoRes.sucesso || !!evoKeyId;

      console.log('EVOLUTION_SEND_SUCESSO_REAL:', { evoRes_sucesso: evoRes.sucesso, evoKeyId, evoSucessoReal });

      if (evoSucessoReal) {
        evoOk = true;
        if (!evoRes.sucesso && evoKeyId) {
          // Corrige o objeto para que evoMsgId seja extraído corretamente abaixo
          evoRes = { ...evoRes, sucesso: true };
          console.log('EVOLUTION_SEND_SUCESSO_VIA_KEY_ID:', evoKeyId);
        }
      } else {
        evoErr = evoRes.erro || 'Erro desconhecido na Evolution API';
        console.error('EVOLUTION_SEND_ERROR', {
          status:  evoRes.status,
          data:    evoRes.dados,
          message: evoErr,
        });
        // Retorna erro imediato — não salva mensagem não enviada
        return res.status(502).json({
          sucesso: false,
          erro: `Evolution API recusou o envio: ${evoErr}`,
          detalhe: { endpoint, numero: telNormalizado, evoStatus: evoRes.status },
        });
      }
    } else if (arquivo_url) {
      // Mídia: tenta enviar, mas não bloqueia se falhar
      if (evoSvc.isConfigured()) {
        const midiaRes = await evoSvc.enviarMidia(telNormalizado, {
          media: arquivo_url, fileName: arquivo_nome, mediatype: tipo
        });
        if (midiaRes.sucesso) evoOk = true;
        else {
          evoErr = midiaRes.erro;
          console.error('EVOLUTION_SEND_ERROR (midia):', evoErr);
        }
      }
      evoOk = true; // mídia continua salvando mesmo sem Evolution
    } else if (!evoSvc.isConfigured()) {
      // Evolution não configurada: salva localmente como aviso
      console.warn('[WA] enviarMensagem: Evolution API não configurada — salvando somente no CRM sem envio real.');
      evoOk = true;
    }

    // ── 5. SÓ SALVA após confirmação da Evolution ────────────────────────────
    const agora = new Date().toISOString();
    const msgId = crypto.randomBytes(16).toString('hex');
    // ID retornado pela Evolution — agora evoRes está acessível no escopo correto
    const evoMsgId = evoRes?.dados?.key?.id || null;

    if (isSupa) {
      // ── Payload Supabase: SOMENTE colunas que existem na tabela ─────────────
      // Colunas reais: id, conversa_id, lead_id, telefone, mensagem, tipo,
      //                direcao, status, vendedor_id, arquivo_url, arquivo_nome, criado_em
      // NÃO EXISTEM: atualizado_em, evolution_message_id
      const dbPayload = {
        id: msgId,
        conversa_id: id,
        lead_id: conversa.lead_id || null,
        telefone: telNormalizado,
        mensagem: mensagem || null,
        tipo,
        direcao: 'enviada',
        // CHECK(status IN ('enviado','entregue','lido','erro'))
        status: evoOk ? 'enviado' : 'erro',
        vendedor_id: req.usuario.id,
        arquivo_url: arquivo_url || null,
        arquivo_nome: arquivo_nome || null,
        criado_em: agora,
        // atualizado_em: NÃO EXISTE NA TABELA — removido
      };

      console.log('SUPA_INSERT_PAYLOAD_KEYS', Object.keys(dbPayload));

      // Insert sem nome de FK fixo no select (evita erro se FK tiver outro nome)
      const { data: nova, error: errI } = await sb.from('mensagens_whatsapp')
        .insert(dbPayload)
        .select('*')
        .single();

      if (errI) {
        console.error('SUPA_INSERT_ERROR', { message: errI.message, code: errI.code, details: errI.details });
        // Mesmo com erro no insert, a mensagem JÁ FOI ENVIADA pela Evolution.
        // Retorna 201 com dados mínimos para não mostrar erro falso ao usuário.
        if (evoOk) {
          console.warn('SUPA_INSERT_FAILED_BUT_EVO_OK — retornando sucesso parcial para evitar erro falso no frontend');
          const msgMinima = {
            id: msgId, conversa_id: id, mensagem: mensagem || null,
            tipo, direcao: 'enviada', status: 'enviado',
            vendedor_id: req.usuario.id, vendedor_nome: req.usuario.nome,
            criado_em: agora,
          };
          return res.status(201).json({ sucesso: true, dados: msgMinima });
        }
        throw errI;
      }

      // UPDATE conversas_whatsapp — SOMENTE colunas existentes
      // Colunas reais: ultima_msg_em, atualizado_em, status
      // NÃO EXISTEM: ultima_mensagem, ultima_direcao
      const { error: errUpdConv } = await sb.from('conversas_whatsapp')
        .update({ ultima_msg_em: agora, atualizado_em: agora, status: 'ABERTA' })
        .eq('id', id);
      if (errUpdConv) console.warn('SUPA_UPDATE_CONVERSA_WARN:', errUpdConv.message);

      if (conversa.lead_id) {
        const { error: errUpdLead } = await sb.from('leads').update({ atualizado_em: agora }).eq('id', conversa.lead_id);
        if (errUpdLead) console.warn('SUPA_UPDATE_LEAD_WARN:', errUpdLead.message);
      }

      const msg = { ...nova, vendedor_nome: req.usuario.nome };
      console.log('SUPA_INSERT_OK', { msgId, status: msg.status, evoMsgId });

      // ── Solução 3: Armazena mapeamento LID → telefone ───────────────────────
      // A Evolution v1.8.6 com Multi-Device retorna @lid no key.remoteJid.
      // Salvamos em dados_extras para que o webhook resolva respostas futuras.
      const _evoRemoteJid = evoRes?.dados?.key?.remoteJid || '';
      if (evoOk && _evoRemoteJid.endsWith('@lid')) {
        const _lid = _evoRemoteJid.split('@')[0];
        console.log('LID_DETECTADO_NO_ENVIO:', { lid: _lid, conversaId: id, telefone: telNormalizado });
        sb.from('conversas_whatsapp').select('dados_extras').eq('id', id).single()
          .then(({ data: _cv }) => {
            const _ex = (() => { try { return JSON.parse(_cv?.dados_extras || '{}'); } catch { return {}; } })();
            if (!_ex.lid || _ex.lid !== _lid) {
              _ex.lid = _lid;
              _ex.lid_telefone = telNormalizado;
              return sb.from('conversas_whatsapp')
                .update({ dados_extras: JSON.stringify(_ex), atualizado_em: new Date().toISOString() })
                .eq('id', id)
                .then(() => console.log('LID_MAPEADO_SUCESSO (Supabase):', { lid: _lid, conversaId: id }));
            }
          })
          .catch(e => console.warn('LID_MAPEAMENTO_WARN (nao critico):', e.message));
      }

      req.log({ acao: 'WHATSAPP_SEND', entidade: 'conversas_whatsapp', entidade_id: id, depois: { mensagem: mensagem?.slice(0, 100), tipo, evo_ok: evoOk, evoMsgId } });
      return res.status(201).json({ sucesso: true, dados: msg });
    }


    // SQLite path
    const db = getDb();
    db.prepare(`
      INSERT INTO mensagens_whatsapp
        (id, conversa_id, lead_id, telefone, mensagem, tipo, direcao, status, vendedor_id, arquivo_url, arquivo_nome, criado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      msgId, id, conversa.lead_id, telNormalizado,
      mensagem || null, tipo, 'enviada', 'enviado',
      req.usuario.id, arquivo_url || null, arquivo_nome || null, agora
    );
    db.prepare(`UPDATE conversas_whatsapp SET ultima_msg_em = ?, atualizado_em = ?, status = 'ABERTA' WHERE id = ?`).run(agora, agora, id);
    if (conversa.lead_id)
      db.prepare(`UPDATE leads SET atualizado_em = ? WHERE id = ?`).run(agora, conversa.lead_id);

    // ── Solução 3: Armazena mapeamento LID → telefone (SQLite) ──────────────
    const _evoRemoteJidSql = evoRes?.dados?.key?.remoteJid || '';
    if (evoOk && _evoRemoteJidSql.endsWith('@lid')) {
      const _lidSql = _evoRemoteJidSql.split('@')[0];
      try {
        const _cvSql = db.prepare('SELECT dados_extras FROM conversas_whatsapp WHERE id=?').get(id);
        const _exSql = (() => { try { return JSON.parse(_cvSql?.dados_extras || '{}'); } catch { return {}; } })();
        if (!_exSql.lid || _exSql.lid !== _lidSql) {
          _exSql.lid = _lidSql;
          _exSql.lid_telefone = telNormalizado;
          db.prepare('UPDATE conversas_whatsapp SET dados_extras=?, atualizado_em=? WHERE id=?')
            .run(JSON.stringify(_exSql), new Date().toISOString(), id);
          console.log('LID_MAPEADO_SUCESSO (SQLite):', { lid: _lidSql, conversaId: id });
        }
      } catch(e) { console.warn('LID_MAPEAMENTO_WARN SQLite (nao critico):', e.message); }
    }

    req.log({ acao: 'WHATSAPP_SEND', entidade: 'conversas_whatsapp', entidade_id: id, depois: { mensagem: mensagem?.slice(0, 100), tipo, evo_ok: evoOk } });
    const msg = db.prepare(`SELECT m.*, u.nome AS vendedor_nome FROM mensagens_whatsapp m LEFT JOIN usuarios u ON m.vendedor_id = u.id WHERE m.id = ?`).get(msgId);
    return res.status(201).json({ sucesso: true, dados: msg });

  } catch (e) {
    // ── LOG DETALHADO: identifica exatamente onde a excecao ocorreu ─────────
    console.error('WHATSAPP_SEND_CATCH — excecao inesperada no enviarMensagem:', {
      message:    e.message,
      name:       e.name,
      code:       e.code,
      stack:      e.stack?.split('\n').slice(0, 5).join(' | '),
      // Estado das variaveis no momento do erro:
      evoOk_snapshot:    typeof evoOk    !== 'undefined' ? evoOk    : 'NAO_DEFINIDO',
      evoRes_snapshot:   typeof evoRes   !== 'undefined' ? JSON.stringify(evoRes?.dados)?.slice(0,200) : 'NAO_DEFINIDO',
      isSupa_snapshot:   typeof isSupa   !== 'undefined' ? isSupa   : 'NAO_DEFINIDO',
      conversa_snapshot: typeof conversa !== 'undefined' ? conversa?.id : 'NAO_DEFINIDO',
    });
    return res.status(500).json({ sucesso: false, erro: 'Erro ao enviar mensagem.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/conversas
// Cria ou busca conversa existente por telefone
// ─────────────────────────────────────────────────────────────────────────────
async function criarOuAbrirConversa(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const { telefone, lead_id, nome_contato, vendedor_id } = req.body;
    if (!telefone) return res.status(400).json({ sucesso: false, erro: 'Telefone obrigatório.' });
    const tel = normalizePhone(telefone);
    const agora = new Date().toISOString();

    if (isSupa) {
      // Busca conversa ativa
      const { data: existing } = await sb.from('conversas_whatsapp')
        .select('*').eq('telefone', tel).neq('status', 'FECHADA')
        .order('criado_em', { ascending: false }).limit(1);
      let conversa = existing?.[0] || null;

      if (!conversa) {
        const novaId = crypto.randomBytes(16).toString('hex');
        const { data: nova, error } = await sb.from('conversas_whatsapp').insert({
          id: novaId, lead_id: lead_id || null, telefone: tel,
          nome_contato: nome_contato || null,
          vendedor_id: vendedor_id || req.usuario.id,
          origem: 'MANUAL', criado_em: agora, atualizado_em: agora,
        }).select().single();
        if (error) throw error;
        conversa = nova;
      } else if (lead_id && !conversa.lead_id) {
        await sb.from('conversas_whatsapp').update({ lead_id }).eq('id', conversa.id);
        conversa.lead_id = lead_id;
      }
      req.log({ acao: 'WHATSAPP_OPEN', entidade: 'conversas_whatsapp', entidade_id: conversa.id, depois: { telefone: tel, lead_id } });
      return res.json({ sucesso: true, dados: conversa });
    }

    const db = getDb();
    let conversa = db.prepare(`SELECT * FROM conversas_whatsapp WHERE telefone = ? AND status != 'FECHADA' ORDER BY criado_em DESC LIMIT 1`).get(tel);
    if (!conversa) {
      const id = crypto.randomBytes(16).toString('hex');
      db.prepare(`INSERT INTO conversas_whatsapp (id, lead_id, telefone, nome_contato, vendedor_id, origem, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, lead_id || null, tel, nome_contato || null, vendedor_id || req.usuario.id, 'MANUAL', agora, agora);
      conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
    } else if (lead_id && !conversa.lead_id) {
      db.prepare('UPDATE conversas_whatsapp SET lead_id = ? WHERE id = ?').run(lead_id, conversa.id);
    }
    req.log({ acao: 'WHATSAPP_OPEN', entidade: 'conversas_whatsapp', entidade_id: conversa.id, depois: { telefone: tel, lead_id } });
    return res.json({ sucesso: true, dados: conversa });
  } catch (e) {
    console.error('[WA] criarOuAbrirConversa:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao abrir conversa.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/webhook/trafego
// Automação: lead entra via WhatsApp (tráfego pago)
// Cria lead, atribui funil "Tráfego Pago", distribui vendedor, registra conversa
// ─────────────────────────────────────────────────────────────────────────────
function webhookTrafego(req, res) {
  try {
    const db = getDb();
    const { telefone, nome, mensagem_inicial, campanha } = req.body;

    if (!telefone) return res.status(400).json({ sucesso: false, erro: 'Telefone obrigatório.' });

    const tel = normalizePhone(telefone);
    const agora = new Date().toISOString();

    // 1. Encontra o funil "Tráfego Pago" (ou primeiro funil ativo)
    let funil = db.prepare(`SELECT * FROM funis WHERE nome LIKE '%Tr%fego%' AND ativo=1 LIMIT 1`).get()
             || db.prepare(`SELECT * FROM funis WHERE ativo=1 ORDER BY criado_em ASC LIMIT 1`).get();

    if (!funil) return res.status(404).json({ sucesso: false, erro: 'Nenhum funil ativo encontrado.' });

    // Primeira etapa do funil
    const primeiraEtapa = db.prepare(`
      SELECT e.* FROM etapas e
      JOIN pipelines p ON e.pipeline_id = p.id
      WHERE p.funil_id = ? ORDER BY e.ordem ASC LIMIT 1
    `).get(funil.id);

    const pipeline = db.prepare(`SELECT * FROM pipelines WHERE funil_id = ? AND ativo=1 LIMIT 1`).get(funil.id);

    // 2. Distribui vendedor (usa configuração de distribuição existente)
    const distRow = db.prepare(`SELECT * FROM leads WHERE 1=1 LIMIT 0`).get(); // só para evitar erro
    const vendedores = db.prepare(`
      SELECT id FROM usuarios WHERE role IN ('VENDEDOR','GESTOR') AND ativo=1
    `).all();

    let vendedorId = null;
    if (vendedores.length > 0) {
      // Distribuição round-robin: pega quem tem menos leads recentes
      const distribuicaoRow = db.prepare(`
        SELECT responsavel_id, COUNT(*) as cnt FROM leads
        WHERE responsavel_id IS NOT NULL
        GROUP BY responsavel_id ORDER BY cnt ASC LIMIT 1
      `).get();
      if (distribuicaoRow && vendedores.find(v => v.id === distribuicaoRow.responsavel_id)) {
        vendedorId = distribuicaoRow.responsavel_id;
      } else {
        vendedorId = vendedores[0].id;
      }
    }

    // 3. Verifica se já existe lead com esse telefone nesse funil
    const leadExistente = db.prepare(`
      SELECT l.* FROM leads l
      JOIN pipelines p ON l.pipeline_id = p.id
      WHERE p.funil_id = ? AND l.telefone = ? AND l.status = 'ABERTO' LIMIT 1
    `).get(funil.id, tel);

    let leadId;
    if (leadExistente) {
      leadId = leadExistente.id;
    } else {
      // 4. Cria o lead
      leadId = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO leads
          (id, nome, telefone, pipeline_id, etapa_id, responsavel_id, origem, status, dados_extras, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        leadId,
        nome || `Lead WhatsApp ${tel}`,
        tel,
        pipeline?.id || null,
        primeiraEtapa?.id || null,
        vendedorId,
        'TRAFEGO_PAGO',
        'ABERTO',
        JSON.stringify({ campanha: campanha || 'Tráfego Pago', primeira_mensagem: mensagem_inicial }),
        agora, agora
      );

      // Nota automática no lead
      const notaId = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO mensagens (id, lead_id, usuario_id, tipo, conteudo, enviado_em, criado_em)
        VALUES (?,?,?,?,?,?,?)
      `).run(notaId, leadId, vendedorId, 'SISTEMA',
        `Lead criado automaticamente via WhatsApp (Tráfego Pago). Campanha: ${campanha || '—'}`,
        agora, agora);
    }

    // 5. Cria ou abre conversa WhatsApp
    let conversa = db.prepare(
      `SELECT * FROM conversas_whatsapp WHERE telefone = ? AND status != 'FECHADA' ORDER BY criado_em DESC LIMIT 1`
    ).get(tel);

    if (!conversa) {
      const convId = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO conversas_whatsapp
          (id, lead_id, telefone, nome_contato, vendedor_id, origem, ultima_msg_em, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(convId, leadId, tel, nome || null, vendedorId, 'TRAFEGO_PAGO', agora, agora, agora);
      conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(convId);
    }

    // 6. Salva mensagem inicial
    if (mensagem_inicial) {
      const msgId = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO mensagens_whatsapp
          (id, conversa_id, lead_id, telefone, mensagem, tipo, direcao, status, criado_em)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(msgId, conversa.id, leadId, tel, mensagem_inicial, 'texto', 'recebida', 'enviado', agora);

      db.prepare(`UPDATE conversas_whatsapp SET ultima_msg_em = ? WHERE id = ?`).run(agora, conversa.id);
    }

    req.log({
      acao: 'WEBHOOK_TRAFEGO', entidade: 'leads', entidade_id: leadId,
      depois: { telefone: tel, funil: funil.nome, vendedor_id: vendedorId, campanha }
    });

    // Dispara primeira mensagem automática (apenas para leads novos)
    if (!leadExistente) {
      const automacoesMsg = require('./automacoesMsgController');
      setImmediate(() => {
        automacoesMsg.dispararPrimeiraMensagem({ lead: { id: leadId }, db });
      });
    }

    return res.json({
      sucesso: true,
      dados: { lead_id: leadId, conversa_id: conversa.id, vendedor_id: vendedorId, funil: funil.nome }
    });
  } catch (e) {
    console.error('[WA] webhookTrafego:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro na automação.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/whatsapp/conversas/:id/status
// Atualiza status da conversa
// ─────────────────────────────────────────────────────────────────────────────
async function atualizarStatus(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const { id } = req.params;
    const { status } = req.body;
    const VALIDOS = ['ABERTA','FECHADA','AGUARDANDO'];
    if (!VALIDOS.includes(status)) return res.status(400).json({ sucesso: false, erro: 'Status inválido.' });
    const agora = new Date().toISOString();
    if (isSupa) {
      const { error } = await sb.from('conversas_whatsapp').update({ status, atualizado_em: agora }).eq('id', id);
      if (error) throw error;
    } else {
      getDb().prepare('UPDATE conversas_whatsapp SET status = ?, atualizado_em = ? WHERE id = ?').run(status, agora, id);
    }
    return res.json({ sucesso: true });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/conversas/:id
// Busca uma conversa por ID (para abrir pelo lead)
// ─────────────────────────────────────────────────────────────────────────────
async function buscarConversa(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    if (isSupa) {
      const { data, error } = await sb.from('conversas_whatsapp')
        .select('*, usuarios!conversas_whatsapp_vendedor_id_fkey(nome), leads!conversas_whatsapp_lead_id_fkey(nome,empresa)')
        .eq('id', req.params.id).single();
      if (error || !data) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
      return res.json({ sucesso: true, dados: { ...data, vendedor_nome: data.usuarios?.nome, lead_nome: data.leads?.nome, lead_empresa: data.leads?.empresa } });
    }
    const db = getDb();
    const conversa = db.prepare(`SELECT c.*, u.nome AS vendedor_nome, l.nome AS lead_nome, l.empresa AS lead_empresa FROM conversas_whatsapp c LEFT JOIN usuarios u ON c.vendedor_id = u.id LEFT JOIN leads l ON c.lead_id = l.id WHERE c.id = ?`).get(req.params.id);
    if (!conversa) return res.status(404).json({ sucesso: false, erro: 'Conversa não encontrada.' });
    return res.json({ sucesso: true, dados: conversa });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/lead/:lead_id
// Busca conversa de um lead específico
// ─────────────────────────────────────────────────────────────────────────────
async function conversaPorLead(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const leadId = req.params.lead_id;

    if (isSupa) {
      // ── Fase 1: busca por lead_id ──────────────────────────────────────────
      const { data: byLeadId } = await sb.from('conversas_whatsapp')
        .select('*, usuarios!conversas_whatsapp_vendedor_id_fkey(nome), leads!conversas_whatsapp_lead_id_fkey(nome,empresa)')
        .eq('lead_id', leadId)
        .neq('status', 'FECHADA')
        .order('criado_em', { ascending: false })
        .limit(1);

      if (byLeadId?.[0]) {
        const c = byLeadId[0];
        console.log(`[WA] conversaPorLead: encontrou por lead_id=${leadId} conv=${c.id}`);
        return res.json({ sucesso: true, dados: { ...c, vendedor_nome: c.usuarios?.nome, lead_nome: c.leads?.nome, lead_empresa: c.leads?.empresa } });
      }

      // ── Fase 2: busca pelo telefone NORMALIZADO do lead ────────────────────
      // Cenário: conversa chegou via webhook sem lead_id vinculado ainda
      const { data: lead } = await sb.from('leads').select('telefone').eq('id', leadId).single();
      if (!lead?.telefone) {
        console.log(`[WA] conversaPorLead: lead ${leadId} sem telefone`);
        return res.json({ sucesso: true, dados: null });
      }

      // USA normalizePhone com prefixo 55 — igual ao formato salvo pelo webhook
      const telNorm = normalizePhone(lead.telefone);
      console.log(`[WA] conversaPorLead: buscando por telefone normalizado ${telNorm}`);

      const { data: byTel } = await sb.from('conversas_whatsapp')
        .select('*, usuarios!conversas_whatsapp_vendedor_id_fkey(nome), leads!conversas_whatsapp_lead_id_fkey(nome,empresa)')
        .eq('telefone', telNorm)
        .order('criado_em', { ascending: false })
        .limit(1);

      if (byTel?.[0]) {
        const c = byTel[0];
        console.log(`[WA] conversaPorLead: encontrou por telefone=${telNorm} conv=${c.id}`);
        // Vincula lead_id automaticamente se ainda não vinculado
        if (!c.lead_id) {
          await sb.from('conversas_whatsapp')
            .update({ lead_id: leadId, atualizado_em: new Date().toISOString() })
            .eq('id', c.id);
        }
        return res.json({ sucesso: true, dados: { ...c, lead_id: c.lead_id || leadId, vendedor_nome: c.usuarios?.nome, lead_nome: c.leads?.nome, lead_empresa: c.leads?.empresa } });
      }

      console.log(`[WA] conversaPorLead: nenhuma conversa para lead=${leadId} tel=${telNorm}`);
      return res.json({ sucesso: true, dados: null });
    }

    // SQLite fallback
    const db = getDb();

    // Fase 1: por lead_id
    const conversa = db.prepare(
      `SELECT c.*, u.nome AS vendedor_nome, l.nome AS lead_nome, l.empresa AS lead_empresa
       FROM conversas_whatsapp c
       LEFT JOIN usuarios u ON c.vendedor_id = u.id
       LEFT JOIN leads l ON c.lead_id = l.id
       WHERE c.lead_id = ? AND c.status != 'FECHADA'
       ORDER BY c.criado_em DESC LIMIT 1`
    ).get(leadId);

    if (conversa) return res.json({ sucesso: true, dados: conversa });

    // Fase 2 SQLite: busca por telefone normalizado (com 55)
    const lead = db.prepare('SELECT telefone FROM leads WHERE id = ?').get(leadId);
    if (!lead?.telefone) return res.json({ sucesso: true, dados: null });

    const telNorm = normalizePhone(lead.telefone);
    const convByTel = db.prepare(
      `SELECT c.*, u.nome AS vendedor_nome, l.nome AS lead_nome, l.empresa AS lead_empresa
       FROM conversas_whatsapp c
       LEFT JOIN usuarios u ON c.vendedor_id = u.id
       LEFT JOIN leads l ON c.lead_id = l.id
       WHERE c.telefone = ? AND c.status != 'FECHADA'
       ORDER BY c.criado_em DESC LIMIT 1`
    ).get(telNorm);

    if (convByTel) {
      if (!convByTel.lead_id) {
        db.prepare('UPDATE conversas_whatsapp SET lead_id = ?, atualizado_em = ? WHERE id = ?').run(leadId, new Date().toISOString(), convByTel.id);
      }
      return res.json({ sucesso: true, dados: { ...convByTel, lead_id: convByTel.lead_id || leadId } });
    }

    return res.json({ sucesso: true, dados: null });
  } catch (e) {
    console.error('[WA] conversaPorLead:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/pendentes
// Conversas com mensagem recebida mais recente sem resposta enviada depois
// Regra: 1 pendência por conversa (não duplica)
// ─────────────────────────────────────────────────────────────────────────────
function listarPendentes(req, res) {
  try {
    const db = getDb();
    const role = req.usuario.role;
    const uid  = req.usuario.id;

    // Vendedor não acessa este endpoint no dashboard (bloqueado por role no frontend)
    // mas protege no backend também
    if (role === 'VENDEDOR') {
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
    }

    // Conversas pendentes:
    // a última mensagem da conversa é de direção "recebida" (cliente sem resposta)
    const baseSQL = `
      SELECT
        c.id            AS conversa_id,
        c.telefone,
        c.nome_contato,
        c.origem,
        c.ultima_msg_em,
        c.lead_id,
        l.nome          AS lead_nome,
        l.empresa       AS lead_empresa,
        l.responsavel_id,
        u.nome          AS vendedor_nome,
        f.nome          AS funil_nome,
        f.cor           AS funil_cor,
        -- Ultima mensagem recebida
        m_last.mensagem AS ultima_mensagem,
        m_last.criado_em AS ultima_msg_criado_em,
        -- Tempo esperando em minutos
        ROUND((julianday('now') - julianday(m_last.criado_em)) * 1440) AS minutos_aguardando
      FROM conversas_whatsapp c
      -- Junta última mensagem de cada conversa
      JOIN (
        SELECT conversa_id,
               mensagem,
               direcao,
               criado_em
        FROM mensagens_whatsapp m1
        WHERE criado_em = (
          SELECT MAX(m2.criado_em)
          FROM mensagens_whatsapp m2
          WHERE m2.conversa_id = m1.conversa_id
        )
        GROUP BY conversa_id
      ) m_last ON m_last.conversa_id = c.id
      LEFT JOIN leads l     ON c.lead_id = l.id
      LEFT JOIN usuarios u  ON c.vendedor_id = u.id
      LEFT JOIN pipelines p ON l.pipeline_id = p.id
      LEFT JOIN funis f     ON p.funil_id = f.id
      WHERE
        c.status != 'FECHADA'
        AND m_last.direcao = 'recebida'
    `;

    let sql    = baseSQL;
    const params = [];

    // Gestor: filtra pela equipe (no momento sem equipe configurada, vê todos)
    // Super Admin / GESTOR: vê tudo por ora
    // Ajustar quando houver equipes

    sql += ' ORDER BY m_last.criado_em ASC'; // mais antigos primeiro (mais urgentes)

    const pendentes = db.prepare(sql).all(...params);

    req.log({
      acao: 'DASHBOARD_PENDENTES_ACESSO',
      entidade: 'conversas_whatsapp',
      depois: { total: pendentes.length, role }
    });

    return res.json({
      sucesso: true,
      total: pendentes.length,
      dados: pendentes
    });
  } catch (e) {
    console.error('[WA] listarPendentes:', e);
    return res.status(500).json({ sucesso: false, erro: 'Erro ao buscar pendentes.', detalhe: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOVOS ENDPOINTS SUPABASE (tabela whatsapp_mensagens)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/whatsapp/conversas (Supabase)
// Lista todas as conversas agrupadas por lead/telefone
async function conversasSupabase(req, res) {
  const { limite = 50 } = req.query;
  try {
    const resultado = await waSvc.listarConversas({ limite: Number(limite) });
    return res.json({ sucesso: resultado.sucesso, dados: resultado.dados || [], erro: resultado.erro });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// GET /api/whatsapp/conversas/:leadId (Supabase)
// Mensagens de um lead pelo leadId
async function conversasPorLeadSupabase(req, res) {
  const { leadId } = req.params;
  const { limite = 100, offset = 0 } = req.query;
  try {
    const resultado = await waSvc.listarMensagensLead(leadId, { limite: Number(limite), offset: Number(offset) });
    return res.json({ sucesso: resultado.sucesso, dados: resultado.dados || [], erro: resultado.erro });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// GET /api/leads/:id/conversas
// Mensagens WhatsApp vinculadas ao lead (alias de conversasPorLeadSupabase)
async function conversasDoLead(req, res) {
  const leadId = req.params.id;
  const { limite = 100, offset = 0 } = req.query;
  try {
    const resultado = await waSvc.listarMensagensLead(leadId, { limite: Number(limite), offset: Number(offset) });
    return res.json({
      sucesso: resultado.sucesso,
      dados: resultado.dados || [],
      total: resultado.dados?.length || 0,
      aviso: resultado.aviso,
      erro: resultado.erro,
    });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// POST /api/whatsapp/mensagens/manual
// Salva mensagem manual para testes sem WhatsApp Light
async function mensagemManual(req, res) {
  const { lead_id, telefone, direcao, tipo, conteudo, nome_contato } = req.body;

  if (!telefone) return res.status(400).json({ sucesso: false, erro: 'telefone é obrigatório.' });
  if (!direcao || !['recebida','enviada'].includes(direcao)) {
    return res.status(400).json({ sucesso: false, erro: 'direcao deve ser recebida ou enviada.' });
  }
  if (!conteudo && tipo === 'texto') {
    return res.status(400).json({ sucesso: false, erro: 'conteudo é obrigatório para tipo texto.' });
  }

  try {
    const resultado = await waSvc.salvarMensagem({
      lead_id:      lead_id      || null,
      telefone,
      nome_contato: nome_contato || null,
      direcao,
      tipo:         tipo         || 'texto',
      conteudo:     conteudo     || null,
      status_envio: direcao === 'enviada' ? 'enviado' : 'recebido',
      enviado_por:  direcao === 'enviada' ? req.usuario?.id : null,
    });

    if (!resultado.sucesso) {
      return res.status(500).json({ sucesso: false, erro: resultado.erro });
    }

    // Registra auditoria sem quebrar a resposta
    req.log?.({
      acao: 'WHATSAPP_MANUAL',
      entidade: 'whatsapp_mensagens',
      entidade_id: lead_id || resultado.dados?.id,
      depois: { direcao, tipo, lead_id, telefone },
    });

    return res.status(201).json({ sucesso: true, dados: resultado.dados });
  } catch (e) {
    console.error('[WA] mensagemManual:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/webhook
// Recebe eventos da Evolution API v1.8.6 e outros provedores WhatsApp
// Sem autenticação JWT (webhook externo) — protegido por WHATSAPP_WEBHOOK_SECRET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza telefone de qualquer formato WhatsApp para dígitos puros.
 * USA a mesma função normalizePhone do topo do arquivo.
 */
function normalizarTelWhatsApp(raw) {
  return normalizePhone(raw);
}

/**
 * Extrai campos de qualquer formato de webhook WhatsApp.
 * Suporta Evolution API v1.8.6 (payload aninhado em body.data)
 * e formatos legados (campos na raiz).
 */
/**
 * Extrai campos de qualquer formato de webhook WhatsApp.
 * Evolution API v1.8.6 envia body.data como ARRAY em MESSAGES_UPSERT.
 * Suporta body.data = objeto OU array — normaliza para objeto único antes de parsear.
 */
function normalizarPayloadWA(body) {
  // ── Normaliza body.data: pode ser array (Evolution v1.8.6) ou objeto ───────
  let dataRaw = body.data || null;
  if (Array.isArray(dataRaw)) {
    dataRaw = dataRaw[0] || null; // pega o primeiro item do array
  }

  // ── Detecta se é Evolution API (tem key com remoteJid) ───────────────────
  const isEvolution = !!(dataRaw && dataRaw.key && dataRaw.key.remoteJid);

  let remoteJid = '', fromMe = false, messageId = null, pushName = '', msgData = {};

  if (isEvolution) {
    remoteJid = dataRaw.key.remoteJid || '';
    fromMe    = dataRaw.key.fromMe === true;
    messageId = dataRaw.key.id || null;
    pushName  = dataRaw.pushName || dataRaw.notifyName || '';
    msgData   = dataRaw.message || {};
  }

  // ── Extrai telefone (todos os caminhos possíveis) ─────────────────────────
  // PRIORIDADE para Evolution API com LID:
  //   1. Se remoteJid é @lid, tenta participant (JID real do contato em grupos/multi-device)
  //   2. Tenta campos alternativos: data.number, data.sender
  //   3. Fallback: remoteJid (pode ser LID)
  const participantJid = isEvolution
    ? (dataRaw?.participant || dataRaw?.key?.participant || null)
    : null;
  const isLidRaw = isEvolution && remoteJid.endsWith('@lid');

  const rawTel = isEvolution
    ? (
        // Se LID, tenta participant primeiro (JID com telefone real)
        (isLidRaw && participantJid) ? participantJid
        : remoteJid
      )
    : (
        dataRaw?.key?.remoteJid ||
        dataRaw?.remoteJid ||
        dataRaw?.from ||
        dataRaw?.sender ||
        dataRaw?.number ||
        body.messages?.[0]?.key?.remoteJid ||
        body.telefone || body.phone || body.from || body.remoteJid || body.sender || body.number || ''
      );
  const tel = normalizarTelWhatsApp(rawTel);
  // Preserva o número LID original (sem @) para mapeamento
  const lidNumero = isLidRaw ? normalizePhone(remoteJid) : null;

  // ── Extrai nome do contato ────────────────────────────────────────────────
  const nome = (
    (isEvolution ? pushName : null) ||
    dataRaw?.pushName || dataRaw?.notifyName ||
    body.pushName || body.nome || body.name ||
    body.contactName || body.senderName || tel || ''
  ).trim();

  // ── Extrai texto (todos os caminhos possíveis) ─────────────────────────────
  const conteudo = isEvolution
    ? (
        msgData.conversation ||
        msgData.extendedTextMessage?.text ||
        msgData.textMessage?.text ||
        msgData.text ||
        msgData.imageMessage?.caption ||
        msgData.videoMessage?.caption ||
        msgData.documentMessage?.title ||
        null
      )
    : (
        dataRaw?.message?.conversation ||
        dataRaw?.message?.extendedTextMessage?.text ||
        dataRaw?.text ||
        body.messages?.[0]?.message?.conversation ||
        body.messages?.[0]?.message?.extendedTextMessage?.text ||
        body.mensagem || body.message || body.text || body.body || body.content || body.caption || ''
      )?.trim() || null;

  // ── Tipo da mensagem ──────────────────────────────────────────────────────
  let tipo = 'texto';
  if (isEvolution) {
    if (msgData.imageMessage)                          tipo = 'imagem';
    else if (msgData.audioMessage || msgData.pttMessage) tipo = 'audio';
    else if (msgData.videoMessage)                     tipo = 'video';
    else if (msgData.documentMessage)                  tipo = 'documento';
    else if (msgData.stickerMessage)                   tipo = 'sticker';
  } else {
    const rawTipo = dataRaw?.type || body.tipo || body.type;
    if (['texto','audio','imagem','video','documento','sticker','localizacao','contato'].includes(rawTipo)) {
      tipo = rawTipo;
    }
  }

  // ── messageId (todos os caminhos) ─────────────────────────────────────────
  const finalMsgId = messageId ||
    dataRaw?.key?.id || dataRaw?.id ||
    body.messages?.[0]?.key?.id ||
    body.messageId || body.message_id || body.wamid || body.msgId || null;

  // ── Mídia ─────────────────────────────────────────────────────────────────
  const midiaUrl    = dataRaw?.mediaUrl || body.midia_url || body.mediaUrl || body.media_url || null;
  const arquivoNome = dataRaw?.fileName || body.arquivo_nome || body.fileName || body.filename || null;
  const mimeType    = dataRaw?.mimeType || body.mime_type   || body.mimeType   || null;

  // ── fromMe / direção ──────────────────────────────────────────────────────
  const resolvedFromMe = isEvolution
    ? fromMe
    : (dataRaw?.key?.fromMe === true || dataRaw?.fromMe === true || body.fromMe === true);
  const direcao = resolvedFromMe ? 'enviada' : 'recebida';

  // ── JID raw para detectar grupos (@g.us) ──────────────────────────────────
  const rawJid = remoteJid || dataRaw?.remoteJid || body.from || body.remoteJid || body.sender || '';

  return { tel, nome, conteudo, tipo, messageId: finalMsgId, midiaUrl, arquivoNome, mimeType, direcao, rawJid, isEvolution, fromMe: resolvedFromMe, lidNumero };
}


// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES_UPDATE: Atualiza status de entrega/leitura de uma mensagem enviada
// Evolution v1.8.6 — payload esperado:
//   body.event = "MESSAGES_UPDATE"
//   body.data = array de { key: { id, remoteJid, fromMe }, update: { status } }
//   ou body.data = { key: {...}, update: { status } }
// Status Evolution → CRM:
//   PENDING → pending
//   SERVER_ACK → sent
//   DELIVERY_ACK → delivered
//   READ → read
//   PLAYED → read
//   ERROR → failed
// ─────────────────────────────────────────────────────────────────────────────
async function processarStatusMensagem(body, req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const agora = new Date().toISOString();

    // A Evolution envia body.data como array ou objeto único
    const updates = Array.isArray(body.data)
      ? body.data
      : (body.data ? [body.data] : []);

    if (!updates.length) {
      return res.json({ sucesso: true, ignorado: true, motivo: 'sem_updates_de_status' });
    }

    const EVO_STATUS_MAP = {
      // Schema Supabase: CHECK(status IN ('enviado','entregue','lido','erro'))
      'PENDING':      'enviado',
      'SERVER_ACK':   'enviado',
      'DELIVERY_ACK': 'entregue',
      'READ':         'lido',
      'PLAYED':       'lido',
      'ERROR':        'erro',
      // Variantes lowercase
      'pending':      'enviado',
      'sent':         'enviado',
      'delivered':    'entregue',
      'read':         'lido',
      'played':       'lido',
      'error':        'erro',
    };

    let atualizadas = 0;

    for (const upd of updates) {
      const evoMsgId = upd.key?.id || upd.id || null;
      const evoStatus = upd.update?.status || upd.status || null;
      const remoteJid = upd.key?.remoteJid || upd.remoteJid || null;

      if (!evoMsgId || !evoStatus) {
        console.log('[WA Status] Update sem messageId ou status:', JSON.stringify(upd));
        continue;
      }

      const statusCRM = EVO_STATUS_MAP[evoStatus] || null;
      if (!statusCRM) {
        console.log('[WA Status] Status desconhecido:', evoStatus);
        continue;
      }

      console.log('WEBHOOK_STATUS_UPDATE:', { evoMsgId, evoStatus, statusCRM, remoteJid });

      const updatePayload = {
        status: statusCRM,
        atualizado_em: agora,
        ...(statusCRM === 'entregue' ? { entregue_em: agora } : {}),
        ...(statusCRM === 'lido'     ? { lido_em: agora }     : {}),
      };

      if (isSupa) {
        // Busca por evolution_message_id (coluna nova) OU por id (coluna existente)
        let updated = false;

        // Tenta por evolution_message_id primeiro (coluna adicionada via migração)
        try {
          const { data: byEvoId, error: errEvo } = await sb.from('mensagens_whatsapp')
            .update(updatePayload)
            .eq('evolution_message_id', evoMsgId)
            .select('id');
          if (!errEvo && byEvoId?.length) {
            updated = true;
            atualizadas += byEvoId.length;
            console.log('WEBHOOK_STATUS_SALVO:', { por: 'evolution_message_id', evoMsgId, statusCRM, ids: byEvoId.map(r=>r.id) });
          }
        } catch(e) { /* coluna pode não existir ainda */ }

        // Fallback: busca por id (o campo id da mensagem = messageId da Evolution quando salvo)
        if (!updated) {
          const { data: byId, error: errId } = await sb.from('mensagens_whatsapp')
            .update(updatePayload)
            .eq('id', evoMsgId)
            .select('id');
          if (!errId && byId?.length) {
            updated = true;
            atualizadas += byId.length;
            console.log('WEBHOOK_STATUS_SALVO:', { por: 'id', evoMsgId, statusCRM, ids: byId.map(r=>r.id) });
          }
        }

        if (!updated) {
          console.log('[WA Status] Mensagem não encontrada para atualizar:', evoMsgId);
        }
      } else {
        // SQLite fallback
        const db = getDb();
        try {
          const byEvoId = db.prepare('UPDATE mensagens_whatsapp SET status=?, atualizado_em=? WHERE evolution_message_id=?')
            .run(statusCRM, agora, evoMsgId);
          if (!byEvoId.changes) {
            db.prepare('UPDATE mensagens_whatsapp SET status=?, atualizado_em=? WHERE id=?')
              .run(statusCRM, agora, evoMsgId);
          }
          atualizadas++;
        } catch(e) {
          // Coluna evolution_message_id pode não existir no SQLite ainda — usa só id
          db.prepare('UPDATE mensagens_whatsapp SET status=? WHERE id=?').run(statusCRM, evoMsgId);
          atualizadas++;
        }
      }
    }

    return res.json({ sucesso: true, atualizadas });
  } catch (e) {
    console.error('[WA Status] Erro ao processar status:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

async function webhookReceberMensagem(req, res) {
  // ── 0. Log de diagnóstico OBRIGATÓRIO (antes de qualquer validação) ───────
  console.log('WEBHOOK_EVOLUTION_RECEBIDO_REAL', JSON.stringify(req.body, null, 2));

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ sucesso: false, erro: 'Payload JSON inválido.' });
  }

  // ── 1. Validação de autenticação — múltiplas estratégias ─────────────────
  // A Evolution API v1.8.6 NÃO envia x-webhook-secret por padrão.
  // Ela envia `apikey` no body E `instance` no body.
  //
  // Estratégia (aceita se QUALQUER condição for verdadeira):
  //   (a) WHATSAPP_WEBHOOK_SECRET não configurado → aceita tudo
  //   (b) Header x-webhook-secret bate com WHATSAPP_WEBHOOK_SECRET
  //   (c) body.apikey bate com EVOLUTION_API_KEY (Evolution envia apikey no body)
  //   (d) body.instance bate com EVOLUTION_INSTANCE (quando var está configurada)
  //   (e) body.instance não-vazio + event reconhecido da Evolution (fallback: EVOLUTION_INSTANCE não configurado)
  //       → seguro porque o endpoint não executa código perigoso sem validar o payload depois
  const secretEsperado      = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  const evoApiKeyEsperado   = process.env.EVOLUTION_API_KEY       || '';
  const evoInstanceEsperada = (process.env.EVOLUTION_INSTANCE || process.env.EVOLUTION_INSTANCE_NAME || '').trim();

  const secretHeader    = req.headers['x-webhook-secret'] || req.query.secret || '';
  const apikeyPayload   = body.apikey   || '';
  const instancePayload = body.instance || '';
  const eventoPayload   = String(body.event || body.type || '').toUpperCase();

  const semSecretConfigurado   = !secretEsperado;
  const autenticadoPorSecret   = !!(secretEsperado && secretHeader === secretEsperado);
  const autenticadoPorApikey   = !!(evoApiKeyEsperado && apikeyPayload && apikeyPayload === evoApiKeyEsperado);
  const autenticadoPorInstance = !!(evoInstanceEsperada && instancePayload && instancePayload === evoInstanceEsperada);
  // (e) Fallback: payload tem instance E evento Evolution reconhecido — sem EVOLUTION_INSTANCE configurado
  const EVENTOS_EVOLUTION_CONHECIDOS = [
    'MESSAGES_UPSERT','MESSAGES_UPDATE','MESSAGES_SET','CONNECTION_UPDATE',
    'QRCODE_UPDATED','CONTACTS_UPSERT','CHATS_UPSERT','PRESENCE_UPDATE',
  ];
  const autenticadoPorPayloadEvolution = !!(
    !evoInstanceEsperada &&      // só aplica quando EVOLUTION_INSTANCE não está configurado
    instancePayload &&           // payload precisa ter instance
    EVENTOS_EVOLUTION_CONHECIDOS.includes(eventoPayload)
  );

  const autenticado = semSecretConfigurado || autenticadoPorSecret || autenticadoPorApikey || autenticadoPorInstance || autenticadoPorPayloadEvolution;

  console.log('WEBHOOK_RECEIVED', {
    ip: req.ip,
    event: eventoPayload || '(sem event)',
    instance: instancePayload || '(sem instance)',
  });
  console.log('WEBHOOK_AUTH_RESULT', {
    autenticado,
    semSecretConfigurado,
    autenticadoPorSecret,
    autenticadoPorApikey,
    autenticadoPorInstance,
    autenticadoPorPayloadEvolution,
    evoInstanceEsperada: evoInstanceEsperada || '(não configurado)',
  });

  if (!autenticado) {
    console.warn('WEBHOOK_AUTH_REJECTED', {
      ip: req.ip,
      secretHeader: secretHeader ? '(presente)' : '(ausente)',
      apikeyPayload: apikeyPayload ? apikeyPayload.slice(0, 6) + '...' : '(ausente)',
      instancePayload: instancePayload || '(ausente)',
      eventoPayload,
      dica: 'Configure WHATSAPP_WEBHOOK_SECRET="" para desativar auth, ou EVOLUTION_INSTANCE=nome-da-instancia',
    });
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }

  // ── 2. Identifica tipo de evento ─────────────────────────────────────────
  const evento = String(body.event || body.type || '').toUpperCase().replace(/\./g, '_');
  const instance = body.instance || '(sem instance)';

  console.log('WEBHOOK_EVENT_NAME', evento || '(sem evento)');
  console.log('WEBHOOK_INSTANCE', instance);
  console.log('WEBHOOK_PROCESS_START', { event: evento, instance });

  // ── 2a. Evento de STATUS — atualiza check de entrega/leitura ─────────────
  // NUNCA cria mensagem nova — apenas atualiza status da mensagem existente
  const ehEventoStatus =
    evento === 'MESSAGES_UPDATE' ||
    evento === 'MESSAGE_STATUS'  ||
    evento === 'MESSAGE-STATUS'  ||
    String(body.event || '').toUpperCase() === 'MESSAGES_UPDATE';

  if (ehEventoStatus) {
    // ── DETECÇÃO: MESSAGES_UPDATE com mensagem real (Evolution v2+) ──────────
    // Algumas versões da Evolution enviam NOVAS mensagens recebidas como MESSAGES_UPDATE
    // em vez de MESSAGES_UPSERT. Detecta pelo campo 'message' no payload.
    const dados = body.data;
    const primeiroDado = Array.isArray(dados) ? dados[0] : dados;
    const temMensagemReal = primeiroDado?.message &&
      typeof primeiroDado.message === 'object' &&
      Object.keys(primeiroDado.message).length > 0;

    if (temMensagemReal) {
      console.log('WEBHOOK_MESSAGES_UPDATE_COM_MENSAGEM — redirecionando para fluxo de recebimento');
      // Normaliza para o formato MESSAGES_UPSERT e continua no fluxo principal
      body.event = 'MESSAGES_UPSERT';
      // Cai no processamento normal abaixo (não retorna aqui)
    } else {
      console.log('WEBHOOK_STATUS_UPDATE: processando atualização de status — NÃO cria conversa/mensagem');
      return await processarStatusMensagem(body, req, res);
    }
  }

  // ── 2b. Filtra eventos não-mensagem ───────────────────────────────────────
  const EVENTOS_MENSAGEM_NOVA = [
    'MESSAGES_UPSERT', 'MESSAGES_SET',
    'SEND_MESSAGE', 'SEND_MESSAGES',
    'MESSAGE', 'NEW_MESSAGE',
  ];
  const EVENTOS_IGNORADOS_SEM_AVISO = [
    'MESSAGES_UPDATE', 'MESSAGE_STATUS', 'MESSAGE-STATUS',
    'CHATS_UPSERT', 'CHATS_UPDATE', 'CHATS_SET',
    'CONTACTS_UPSERT', 'CONTACTS_UPDATE', 'CONTACTS_SET',
    'PRESENCE_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED',
    'LABELS_EDIT', 'LABELS_ASSOCIATION',
    'GROUPS_UPSERT', 'GROUPS_UPDATE', 'GROUP_PARTICIPANTS_UPDATE',
    'NEW_JWT_TOKEN', 'CALL',
  ];

  // Se tiver campo event, exige que seja da lista EXATA de mensagens novas
  // Se NÃO tiver campo event, tenta processar (payload legado)
  const ehEventoMensagem = !body.event || EVENTOS_MENSAGEM_NOVA.includes(evento);

  if (!ehEventoMensagem) {
    if (EVENTOS_IGNORADOS_SEM_AVISO.includes(evento)) {
      return res.json({ sucesso: true, ignorado: true, motivo: `evento_${evento}_ignorado` });
    }
    console.warn('WEBHOOK_EVENTO_IGNORADO:', { eventName: evento, eventOriginal: body.event, body: JSON.stringify(body).slice(0, 200) });
    return res.json({ sucesso: true, ignorado: true, motivo: `evento_${evento}_ignorado` });
  }


  // ── 3. Normalizar payload ─────────────────────────────────────────────────
  const parsed = normalizarPayloadWA(body);
  const { tel, nome, conteudo, tipo, messageId, midiaUrl, arquivoNome, mimeType, direcao, rawJid, fromMe, lidNumero } = parsed;

  // Logs obrigatórios pós-parse
  console.log('WEBHOOK_MESSAGES_UPSERT_RECEIVED', {
    event: evento,
    instance,
    rawJid,
    tel: tel || '(não extraído)',
    fromMe,
    messageId: messageId || '(sem id)',
    hasText: !!(conteudo),
    tipo,
  });
  console.log('WEBHOOK_FROM_ME_VALUE', fromMe);
  console.log('WEBHOOK_PHONE_NORMALIZED', { rawJid, telNormalizado: tel || '(inválido)' });

  if (!tel) {
    console.warn('WEBHOOK_PHONE_INVALID_REJECTED', { rawJid, body: JSON.stringify(body).slice(0, 200) });
    return res.status(400).json({ sucesso: false, erro: 'Telefone não identificado no payload.' });
  }

  // ── Detecta JID no formato LID (WhatsApp Multi-Device) ──────────────────────
  const isLidJid = rawJid.endsWith('@lid');
  if (isLidJid) {
    console.log(`[WA Webhook] ⚠️ LID_DETECTADO: ${lidNumero || tel} (JID: ${rawJid}) participant_tel=${tel}`);
  }

  // ── Valida número antes de criar qualquer conversa ───────────────────────
  // Brasil: 55 + DDD(2) + número(8-9) = 12-13 dígitos
  // Internacional genérico: 10-15 dígitos
  const numBrasileiro = /^55\d{10,11}$/.test(tel);

  const numGenerico   = /^\d{10,15}$/.test(tel);
  if (!numBrasileiro && !numGenerico) {
    console.warn('WEBHOOK_NUMERO_INVALIDO_NAO_CRIAR_CONVERSA', {
      telefoneOriginal: rawJid,
      telefoneNormalizado: tel,
      eventName: evento,
    });
    return res.json({ sucesso: true, ignorado: true, motivo: 'numero_invalido', telefone: tel });
  }

  // Ignora mensagens de grupos (JID com @g.us)
  if (rawJid.includes('@g.us')) {
    console.log('[WA Webhook] Grupo ignorado:', rawJid);
    return res.json({ sucesso: true, ignorado: true, motivo: 'grupo_ignorado' });
  }

  // Bloqueia se não houver conteúdo real — sem texto E não é mídia
  if (!conteudo && tipo === 'texto') {
    console.warn('PAYLOAD_SEM_TEXTO_RECONHECIDO — ignorando sem criar conversa:', JSON.stringify(req.body).slice(0, 300));
    return res.json({ sucesso: true, ignorado: true, motivo: 'sem_conteudo' });
  }

  const { sb, isSupa } = getProvider();
  const agora = new Date().toISOString();
  const db = !isSupa ? getDb() : null;

  try {
    // ── 4. Idempotência por messageId ─────────────────────────────────────
    if (messageId) {
      if (isSupa) {
        const { data: existing } = await sb.from('mensagens_whatsapp')
          .select('id').eq('id', messageId).limit(1);
        if (existing?.[0]) {
          return res.json({ sucesso: true, ignorado: true, motivo: 'mensagem_ja_salva' });
        }
      } else if (db) {
        const ex = db.prepare('SELECT id FROM mensagens_whatsapp WHERE id = ? LIMIT 1').get(messageId);
        if (ex) return res.json({ sucesso: true, ignorado: true, motivo: 'mensagem_ja_salva' });
      }
    }

    // ── 4b. Se fromMe=true: deduplicação extra por conteúdo+telefone+janela 30s ─
    // O CRM salva a mensagem ao enviar (com ID gerado localmente).
    // O webhook chega logo depois com fromMe=true e um key.id diferente.
    // Para evitar duplicação: verifica se existe msg enviada com mesmo texto/tel nos últimos 30s.
    if (fromMe) {
      console.log(`[WA Webhook] fromMe=true — mensagem enviada pelo número conectado para ${tel}`);
      if (conteudo) {
        // O CRM salva o texto SEM cabeçalho (apenas o que o usuário digitou).
        // A Evolution entrega com cabeçalho: "Nome | PROSPEKT\n\ntexto_usuario"
        // Extrai o texto limpo (após cabeçalho) para comparar com o que está no banco.
        const CABECALHO_RE = /^.+\| PROSPEKT\n\n/;
        const textoLimpo = conteudo.replace(CABECALHO_RE, '').trim();
        const trintaSeg = new Date(Date.now() - 30_000).toISOString();

        if (isSupa) {
          // Busca por texto exato (sem cabeçalho) OU pelo texto completo (mensagem enviada manualmente no app)
          const { data: msgDup } = await sb.from('mensagens_whatsapp')
            .select('id')
            .eq('telefone', tel)
            .eq('direcao', 'enviada')
            .gte('criado_em', trintaSeg)
            .or(`mensagem.eq.${textoLimpo},mensagem.eq.${conteudo}`)
            .limit(1);
          if (msgDup?.[0]) {
            console.log(`[WA Webhook] fromMe=true DUPLICATA DETECTADA — msg já salva pelo CRM (${msgDup[0].id}), ignorando.`);
            return res.json({ sucesso: true, ignorado: true, motivo: 'fromMe_duplicata_crm' });
          }
        } else if (db) {
          const msgDup = db.prepare(
            "SELECT id FROM mensagens_whatsapp WHERE telefone=? AND direcao='enviada' AND (mensagem=? OR mensagem=?) AND criado_em>=? LIMIT 1"
          ).get(tel, textoLimpo, conteudo, trintaSeg);
          if (msgDup) {
            console.log(`[WA Webhook] fromMe=true DUPLICATA DETECTADA (SQLite) — ignorando.`);
            return res.json({ sucesso: true, ignorado: true, motivo: 'fromMe_duplicata_crm' });
          }
        }
      }
    }

    // ── 5. Busca lead pelo telefone (normalizado) ────────────────────────────
    // Determina variantes de telefone: com 55 (5511964634949) e sem 55 (11964634949)
    let leadId = null;
    const telSem55 = (tel.startsWith('55') && tel.length >= 12) ? tel.slice(2) : null;
    const telVariants = telSem55 ? [tel, telSem55] : [tel];

    console.log('[WA Webhook] INSTANCIA_CONECTADA:', process.env.EVOLUTION_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE || '?');
    console.log('[WA Webhook] REMOTE_JID_RECEBIDO:', body.data?.[0]?.key?.remoteJid || body.data?.key?.remoteJid || '(ver payload)');
    console.log('[WA Webhook] FROM_ME:', fromMe);
    console.log('[WA Webhook] TELEFONE_EXTRAIDO:', { rawTelUsado: tel, variantesSem55: telSem55, fromMe });

    if (isSupa) {
      let leadsFound = null;
      const variantesCompletas = phoneVariants(tel);
      for (const variant of variantesCompletas) {
        const { data: found } = await sb.from('leads').select('id,telefone')
          .or(`telefone.eq.${variant},telefone.ilike.%${variant}%`)
          .is('deleted_at', null).limit(1);
        if (found?.[0]) { leadsFound = found; break; }
      }
      leadId = leadsFound?.[0]?.id || null;
      console.log(`WEBHOOK_LEAD_ENCONTRADO: tel=${tel} variantes=${variantesCompletas.join('|')} → leadId=${leadId}`);

      // Só cria lead se for mensagem recebida (fromMe=false) e não existir
      if (!leadId && !fromMe) {
        let destino = null;
        try { destino = await planilhaSvc.resolverDestino(); } catch(e) {}
        if (destino) {
          const novoLeadId = crypto.randomBytes(16).toString('hex');
          const { data: novoLead, error: errL } = await sb.from('leads').insert({
            id: novoLeadId, nome: nome || `WhatsApp ${tel}`, telefone: tel,
            status: 'ABERTO', funil_id: destino.funil.id,
            pipeline_id: destino.pipeline.id, etapa_id: destino.etapa.id,
            dados_extras: JSON.stringify({ fonte: 'evolution_webhook', numero_wa: tel }),
            criado_em: agora, atualizado_em: agora,
          }).select('id').single();
          if (!errL && novoLead) { leadId = novoLead.id; console.log(`[WA Webhook] ✅ Lead criado: ${leadId} (${tel})`); }
          else console.warn('[WA Webhook] Lead não criado:', errL?.message);
        }
      }
    } else if (db) {
      // SQLite: tenta ambas variantes
      let l = db.prepare("SELECT id FROM leads WHERE telefone = ? LIMIT 1").get(tel);
      if (!l && telSem55) l = db.prepare("SELECT id FROM leads WHERE telefone = ? LIMIT 1").get(telSem55);
      leadId = l?.id || null;
    }
    console.log('[WA Webhook] RESULTADO_BUSCA_LEAD:', { telefoneNormalizado: tel, variantesSem55: telSem55, leadId });

    // ── 6. Resolve conversa (FUNÇÃO CENTRAL — elimina duplicação) ─────────────
    // Usa resolverConversaWhatsapp() que executa 8 passos de busca em ordem antes
    // de permitir qualquer criação. Nunca cria conversa duplicada.
    let conversaId = null;
    if (isSupa) {
      const resolucao = await resolverConversaWhatsapp(sb, {
        tel, lidNumero, leadId, isLidJid, rawJid, fromMe, nome
      });

      if (!resolucao.permiteCreate && !resolucao.conversaId) {
        // fromMe=true sem conversa — eco do CRM, descarta
        console.log('WHATSAPP_FROM_ME_IGNORED_NO_CONVERSA', { tel, fonte: resolucao.fonte });
        return res.json({ sucesso: true, ignorado: true, motivo: 'fromMe_sem_conversa_existente' });
      }

      conversaId = resolucao.conversaId;
      console.log('CONVERSA_RESOLVE_RESULT', { conversaId, permiteCreate: resolucao.permiteCreate, fonte: resolucao.fonte });
    } else if (db) {
      const variantesLocais = phoneVariants(tel);
      let conv = null;
      for (const v of variantesLocais) {
        conv = db.prepare("SELECT id FROM conversas_whatsapp WHERE telefone = ? AND status != 'FECHADA' LIMIT 1").get(v);
        if (conv) break;
      }
      conversaId = conv?.id || null;
    }

    // ── Determina nome_contato correto ────────────────────────────────────────
    // REGRA: NUNCA usar pushName de fromMe=true (seria o nome do dono do WA)
    // Prioridade: lead_nome > pushName (só fromMe=false) > nome existente > telefone > fallback
    let nomeContato = null;
    if (leadId && isSupa) {
      const { data: leadData } = await sb.from('leads').select('nome').eq('id', leadId).single();
      nomeContato = leadData?.nome || null;
      if (nomeContato) console.log('CONTACT_NAME_SOURCE_LEAD', { leadId, nome: nomeContato });
    }
    if (!nomeContato && !fromMe && nome) {
      nomeContato = nome;
      console.log('CONTACT_NAME_SOURCE_EVOLUTION_PUSHNAME', { nome: nomeContato });
    }
    if (!nomeContato && fromMe) {
      console.log('CONTACT_NAME_NOT_USER_NAME', { motivo: 'fromMe_pushname_rejeitado', pushNameRejeitado: nome });
    }
    if (!nomeContato) {
      nomeContato = tel || 'Contato WhatsApp não identificado';
      console.log('CONTACT_NAME_SOURCE_PHONE', { nome: nomeContato });
    }

    if (isSupa && !conversaId) {
      // Cria nova conversa — só chega aqui se resolverConversaWhatsapp liberou (permiteCreate=true)
      const novoConvId = crypto.randomBytes(16).toString('hex');
      const telParaConversa = (isLidJid && !leadId) ? `LID:${lidNumero}` : (tel || null);
      const dadosExtrasNova = isLidJid && lidNumero
        ? JSON.stringify({ lid: lidNumero, remoteJid: rawJid })
        : null;
      console.log('CONVERSA_CREATE_NEEDED', { tel: telParaConversa, leadId, nomeContato });
      const { data: novaConv, error: errC } = await sb.from('conversas_whatsapp').insert({
        id: novoConvId, telefone: telParaConversa, nome_contato: nomeContato,
        lead_id: leadId || null, origem: 'WHATSAPP_WEBHOOK', status: 'ABERTA',
        dados_extras: dadosExtrasNova, criado_em: agora, atualizado_em: agora,
      }).select('id').single();
      if (!errC && novaConv) {
        conversaId = novaConv.id;
        console.log('WEBHOOK_CONVERSA_CREATED', { conversaId, tel: telParaConversa, leadId, nomeContato });
      } else {
        console.error('[WA Webhook] Erro ao criar conversa:', errC?.message);
      }
    } else if (isSupa && conversaId) {
      // Conversa existente — atualiza sem sobrescrever nome_contato com dado ruim
      const { data: convAtual } = await sb.from('conversas_whatsapp')
        .select('telefone,lead_id,dados_extras,nome_contato').eq('id', conversaId).single();
      const upd = { ultima_msg_em: agora, atualizado_em: agora, status: 'ABERTA' };
      if (leadId) upd.lead_id = leadId;
      if (convAtual && convAtual.telefone !== tel && tel && !tel.startsWith('LID:')) {
        upd.telefone = tel;
      }
      const nomeAtual = convAtual?.nome_contato || '';
      const nomeEhPlaceholder = nomeAtual === tel || nomeAtual === 'Contato WhatsApp não identificado' || nomeAtual.startsWith('LID:');
      if (leadId && nomeContato && nomeContato !== tel && nomeContato !== 'Contato WhatsApp não identificado') {
        upd.nome_contato = nomeContato;
        console.log('CONTACT_NAME_SOURCE_LEAD', { leadId, nome: nomeContato, anterior: nomeAtual });
      } else if (!fromMe && nome && nomeEhPlaceholder) {
        upd.nome_contato = nome;
        console.log('CONTACT_NAME_SOURCE_EVOLUTION_PUSHNAME', { nome, anterior: nomeAtual });
      } else {
        console.log('CONTACT_NAME_SOURCE_EXISTING_CONVERSA', { nomeAtual, fromMe, motivo: 'preservado' });
      }
      if (isLidJid && lidNumero) {
        const extrasAtuais = (() => { try { return JSON.parse(convAtual?.dados_extras || '{}'); } catch { return {}; } })();
        if (!extrasAtuais.lid || extrasAtuais.lid !== lidNumero) {
          extrasAtuais.lid = lidNumero;
          upd.dados_extras = JSON.stringify(extrasAtuais);
        }
      }
      console.log('CONVERSA_FOUND_EXISTING', { conversaId, leadId, upd: Object.keys(upd) });
      await sb.from('conversas_whatsapp').update(upd).eq('id', conversaId);
    } else if (db && !conversaId) {
      const cid = crypto.randomBytes(16).toString('hex');
      db.prepare('INSERT INTO conversas_whatsapp (id,telefone,nome_contato,lead_id,origem,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?)').run(cid, tel, nome||null, leadId||null, 'WHATSAPP_WEBHOOK', agora, agora);
      conversaId = cid;
    } else if (db && conversaId) {
      db.prepare('UPDATE conversas_whatsapp SET ultima_msg_em=?,atualizado_em=? WHERE id=?').run(agora, agora, conversaId);
    }


    console.log('WEBHOOK_CONVERSATION_TARGET', {
      conversaId,
      leadId,
      telefoneNormalizado: tel,
    });

    // ── 7. Salva mensagem em mensagens_whatsapp ───────────────────────────
    const msgId = messageId || crypto.randomBytes(16).toString('hex');
    let msgSalva = false;
    let erroSalvar = null;

    if (isSupa && conversaId) {
      // Para mensagens RECEBIDAS: não enviar campo status — usa default do banco
      // (o check constraint do Supabase aceita apenas: pending, sent, delivered, read, failed)
      // Para mensagens ENVIADAS: status 'sent'
      const insertPayload = {
        id: msgId, conversa_id: conversaId, lead_id: leadId || null,
        telefone: tel, mensagem: conteudo, tipo,
        direcao,
        arquivo_url: midiaUrl || null, arquivo_nome: arquivoNome || null,
        criado_em: agora,
      };
      // Só adiciona status para mensagens enviadas — schema: CHECK(status IN ('enviado','entregue','lido','erro'))
      if (direcao === 'enviada') insertPayload.status = 'enviado';

      const { error: errM } = await sb.from('mensagens_whatsapp').insert(insertPayload);
      msgSalva = !errM;
      if (!errM) {
        console.log('WEBHOOK_MESSAGE_SAVED', { mensagemId: msgId, conversaId, direcao, telefone: tel });
        console.log('WEBHOOK_MENSAGEM_SALVA_COM_SUCESSO:', { mensagemId: msgId, conversaId, telefoneNormalizado: tel, direcao });
        // Atualiza conversa — SOMENTE colunas que existem na tabela Supabase:
        // ultima_msg_em, atualizado_em, status (ultima_mensagem e ultima_direcao NÃO EXISTEM)
        const { error: errConvUpd } = await sb.from('conversas_whatsapp').update({
          ultima_msg_em: agora,
          atualizado_em: agora,
          status: 'ABERTA',
        }).eq('id', conversaId);
        if (errConvUpd) console.warn('[WA Webhook] update conversa warn:', errConvUpd.message);
      }
      if (errM) {
        erroSalvar = errM;
        console.error('WEBHOOK_ERRO_AO_PROCESSAR_MENSAGEM:', {
          error: errM.message, code: errM.code, details: errM.details,
          mensagemId: msgId, conversaId, telefone: tel,
          body: JSON.stringify(req.body).slice(0, 300),
        });
      }
    } else if (db && conversaId) {
      try {
        db.prepare('INSERT INTO mensagens_whatsapp (id,conversa_id,lead_id,telefone,mensagem,tipo,direcao,status,criado_em) VALUES (?,?,?,?,?,?,?,?,?)').run(msgId, conversaId, leadId||null, tel, conteudo, tipo, direcao, 'enviado', agora);
        db.prepare('UPDATE conversas_whatsapp SET ultima_msg_em=?,atualizado_em=?,status=\'ABERTA\' WHERE id=?').run(agora, agora, conversaId);
        msgSalva = true;
      } catch(e) {
        erroSalvar = e;
        console.error('ERRO_AO_SALVAR_MENSAGEM_WHATSAPP:', e.message);
      }
    } else if (!conversaId) {
      console.error('ERRO_AO_SALVAR_MENSAGEM_WHATSAPP: conversaId é null — conversa não foi criada.');
    }

    // ── 8. Também salva em whatsapp_mensagens (tabela Supabase extra) ──────
    const resultadoWaSvc = await waSvc.salvarMensagem({
      lead_id: leadId, telefone: tel, nome_contato: nome || null,
      direcao, tipo, conteudo, midia_url: midiaUrl,
      arquivo_nome: arquivoNome, mime_type: mimeType,
      whatsapp_message_id: msgId, status_envio: direcao === 'recebida' ? 'recebido' : 'enviado',
      recebido_em: direcao === 'recebida' ? agora : null,
      enviado_em:  direcao === 'enviada'  ? agora : null,
    }).catch(e => { console.warn('[WA Webhook] waSvc.salvarMensagem falhou (não crítico):', e.message); return { sucesso: false }; });

    const resultado = {
      lead_id:     leadId,
      conversa_id: conversaId,
      mensagem_id: msgId,
      direcao,
      msgSalva,
    };

    if (msgSalva) {
      console.log('MENSAGEM_SALVA_COM_SUCESSO:', resultado);

      // ── 9. Se há mídia recebida: registra metadados em lead_arquivos ───────
      // Só para mensagens RECEBIDAS (fromMe=false) que tenham URL de mídia
      if (!fromMe && midiaUrl && leadId && conversaId && isSupa) {
        try {
          // Deduplicar por evolution_message_id (campo mensagem_id na tabela)
          const { data: existe } = await sb.from('lead_arquivos')
            .select('id').eq('mensagem_id', msgId).maybeSingle();
          if (!existe) {
            const arqId = crypto.randomBytes(16).toString('hex');
            const ext   = (arquivoNome?.split('.').pop() || (tipo === 'imagem' ? 'jpg' : tipo === 'audio' ? 'ogg' : tipo === 'video' ? 'mp4' : 'bin'));
            await sb.from('lead_arquivos').insert({
              id:              arqId,
              lead_id:         leadId,
              conversa_id:     conversaId,
              mensagem_id:     msgId,
              nome_original:   arquivoNome || `${tipo}-${agora.slice(0,10)}.${ext}`,
              nome_storage:    `wa/${leadId}/${msgId}.${ext}`,
              url:             midiaUrl,
              tamanho:         null,
              mime_type:       mimeType || null,
              enviado_por:     null, // recebido do lead, não do usuário
              origem:          'whatsapp',
              criado_em:       agora,
            });
            console.log('[WA Webhook] Mídia registrada em lead_arquivos:', { arqId, leadId, conversaId, tipo });
          } else {
            console.log('[WA Webhook] Mídia já registrada (dedup):', msgId);
          }
        } catch (eArq) {
          console.warn('[WA Webhook] Falha ao registrar mídia em lead_arquivos (não crítico):', eArq.message);
        }
      }
    } else {
      console.error('ERRO_AO_SALVAR_MENSAGEM_WHATSAPP:', { ...resultado, erro: erroSalvar?.message || 'Sem conversa ou erro no insert' });
    }

    return res.status(201).json({ sucesso: true, ...resultado });

  } catch (e) {
    console.error('ERRO_AO_SALVAR_MENSAGEM_WHATSAPP:', e.message, e.stack);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao processar mensagem.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/integracao/status
// Status da integração: atividade recente, secret configurado, logs
// ─────────────────────────────────────────────────────────────────────────────
async function statusIntegracao(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    const agora = new Date();
    const h24   = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const d7    = new Date(agora.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString();

    let msgs24 = 0, msgs7d = 0, convAtivas = 0, ultima = null, logs = [];

    if (isSupa) {
      // ── Supabase ──────────────────────────────────────────────────────────
      const [r24, r7d, rConv, rUlt, rLogs] = await Promise.all([
        sb.from('mensagens_whatsapp').select('id', { count: 'exact', head: true }).gte('criado_em', h24),
        sb.from('mensagens_whatsapp').select('id', { count: 'exact', head: true }).gte('criado_em', d7),
        sb.from('conversas_whatsapp').select('id', { count: 'exact', head: true }).eq('status', 'ABERTA'),
        sb.from('mensagens_whatsapp').select('telefone,direcao,mensagem,criado_em').order('criado_em', { ascending: false }).limit(1),
        sb.from('mensagens_whatsapp').select('telefone,direcao,mensagem,criado_em').order('criado_em', { ascending: false }).limit(15),
      ]);
      msgs24    = r24.count  ?? 0;
      msgs7d    = r7d.count  ?? 0;
      convAtivas = rConv.count ?? 0;
      ultima    = rUlt.data?.[0]  || null;
      logs      = rLogs.data      || [];
    } else {
      // ── SQLite ────────────────────────────────────────────────────────────
      const db = getDb();
      msgs24     = db.prepare(`SELECT COUNT(*) as n FROM mensagens_whatsapp WHERE criado_em >= ?`).get(h24)?.n ?? 0;
      msgs7d     = db.prepare(`SELECT COUNT(*) as n FROM mensagens_whatsapp WHERE criado_em >= ?`).get(d7)?.n ?? 0;
      convAtivas = db.prepare(`SELECT COUNT(*) as n FROM conversas_whatsapp WHERE status = 'ABERTA'`).get()?.n ?? 0;
      ultima     = db.prepare(`SELECT telefone, direcao, mensagem, criado_em FROM mensagens_whatsapp ORDER BY criado_em DESC LIMIT 1`).get();
      logs       = db.prepare(`SELECT telefone, direcao, mensagem, criado_em FROM mensagens_whatsapp ORDER BY criado_em DESC LIMIT 15`).all();
    }

    // Secret configurado?
    const secretConf    = !!(process.env.WHATSAPP_WEBHOOK_SECRET);
    const secretValor   = process.env.WHATSAPP_WEBHOOK_SECRET || '';
    const secretPreview = secretConf
      ? secretValor.slice(0, 6) + '••••••••••••••••'
      : '';

    const webhookUrl = (() => {
      // 1. Tenta obter URL pública via obterWebhookUrl (usa WEBHOOK_URL / RAILWAY_PUBLIC_DOMAIN etc.)
      const url = evoSvc.obterWebhookUrl();
      if (url) return url;

      // 2. Em produção, nunca usar localhost — usar domínio público fixo
      const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PUBLIC_DOMAIN;
      if (isProd) {
        const publicDomain = process.env.PUBLIC_APP_URL
          || process.env.APP_URL
          || process.env.BASE_URL
          || 'https://prosperkt-crm-system-production.up.railway.app';
        const base = publicDomain.replace(/\/$/, '');
        console.log('[LOG] WHATSAPP_WEBHOOK_LOCALHOST_BLOCKED_IN_PROD: true');
        return `${base}/api/whatsapp/webhook`;
      }

      // 3. Em desenvolvimento local, usar apenas o host da requisição (sem fallback localhost)
      const reqHost = req ? req.get('host') : null;
      if (!reqHost) return null;
      return `${req.protocol}://${reqHost}/api/whatsapp/webhook`;
    })();

    // Log seguro da rota de webhook
    console.log(`[LOG] WHATSAPP_WEBHOOK_ROUTE_OK: true | webhook_url: ${webhookUrl}`);

    return res.json({
      sucesso:            true,
      webhook_url:        webhookUrl,
      msgs_24h:           msgs24,
      msgs_7d:            msgs7d,
      conversas_ativas:   convAtivas,
      ultima_msg_em:      ultima?.criado_em || null,
      ultima_direcao:     ultima?.direcao   || null,
      ultimo_telefone:    ultima?.telefone  || null,
      secret_configurado: secretConf,
      secret_preview:     secretPreview,
      secret_valor:       secretValor,   // retorna chave completa (rota protegida por SUPER_ADMIN)
      logs: logs.map(m => ({
        telefone:   m.telefone,
        direcao:    m.direcao,
        mensagem:   m.mensagem || m.conteudo || '',
        criado_em:  m.criado_em,
      })),
    });
  } catch(e) {
    console.error('[WA] statusIntegracao:', e);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}


// ───────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/deduplicar
// Diagnóstico: lista grupos de conversas duplicadas (sem escrever nada)
// ───────────────────────────────────────────────────────────────────────────────
async function diagnosticarDuplicatas(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    if (!isSupa) return res.json({ sucesso: true, aviso: 'Apenas Supabase suportado.', grupos: [] });

    console.log('DUPLICATE_CONVERSAS_SCAN_START');
    const { data: todas } = await sb.from('conversas_whatsapp')
      .select('id,telefone,lead_id,nome_contato,status,criado_em,ultima_msg_em,dados_extras')
      .order('criado_em', { ascending: true });

    const byPhone = {};
    for (const c of (todas || [])) {
      if (!c.telefone || c.telefone.startsWith('LID:')) continue;
      const key = normalizePhoneBR(c.telefone) || c.telefone;
      if (!byPhone[key]) byPhone[key] = [];
      byPhone[key].push(c);
    }

    const grupos = Object.entries(byPhone)
      .filter(([, convs]) => convs.length > 1)
      .map(([tel, convs]) => ({ telefone: tel, quantidade: convs.length, conversas: convs.map(c => ({ id: c.id, nome_contato: c.nome_contato, status: c.status, lead_id: c.lead_id, criado_em: c.criado_em, ultima_msg_em: c.ultima_msg_em })) }));

    console.log('DUPLICATE_CONVERSAS_FOUND', { total_grupos: grupos.length });
    return res.json({ sucesso: true, total_grupos_duplicados: grupos.length, grupos });
  } catch (e) {
    console.error('[WA Dedup] diagnosticarDuplicatas:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/deduplicar
// Executa deduplicação segura: move mensagens, marca duplicatas como FECHADA
// NÃO usa DELETE nem TRUNCATE
// ───────────────────────────────────────────────────────────────────────────────
async function executarDeduplicacao(req, res) {
  try {
    const { sb, isSupa } = getProvider();
    if (!isSupa) return res.json({ sucesso: true, aviso: 'Apenas Supabase suportado.', mescladas: 0 });

    console.log('DUPLICATE_CONVERSAS_SCAN_START');
    const agora = new Date().toISOString();
    const { data: todas } = await sb.from('conversas_whatsapp')
      .select('id,telefone,lead_id,nome_contato,status,criado_em,ultima_msg_em,dados_extras')
      .order('criado_em', { ascending: true });

    // Agrupa por telefone normalizado
    const byPhone = {};
    for (const c of (todas || [])) {
      if (!c.telefone || c.telefone.startsWith('LID:')) continue;
      const key = normalizePhoneBR(c.telefone) || c.telefone;
      if (!byPhone[key]) byPhone[key] = [];
      byPhone[key].push(c);
    }

    let gruposMesclados = 0;
    let mensagensMov = 0;
    const relatorio = [];

    for (const [tel, convs] of Object.entries(byPhone)) {
      if (convs.length <= 1) continue;
      console.log('DUPLICATE_CONVERSAS_FOUND', { telefone: tel, quantidade: convs.length });

      // Escolhe conversa canônica: prioridade = tem lead_id > status ABERTA > mais mensagens > mais antiga
      // Conta mensagens por conversa
      const ids = convs.map(c => c.id);
      const { data: contagens } = await sb.from('mensagens_whatsapp')
        .select('conversa_id')
        .in('conversa_id', ids);
      const contagemMap = {};
      for (const m of (contagens || [])) {
        contagemMap[m.conversa_id] = (contagemMap[m.conversa_id] || 0) + 1;
      }

      convs.sort((a, b) => {
        if (!!a.lead_id !== !!b.lead_id) return a.lead_id ? -1 : 1;
        if ((a.status === 'ABERTA') !== (b.status === 'ABERTA')) return a.status === 'ABERTA' ? -1 : 1;
        const ca = contagemMap[a.id] || 0;
        const cb = contagemMap[b.id] || 0;
        if (ca !== cb) return cb - ca; // mais mensagens primeiro
        return new Date(a.criado_em) - new Date(b.criado_em); // mais antiga primeiro
      });

      const canonica = convs[0];
      const duplicatas = convs.slice(1);
      console.log('DUPLICATE_CANONICAL_SELECTED', { conversaId: canonica.id, telefone: tel, total: convs.length });

      for (const dup of duplicatas) {
        // Move mensagens da duplicata para a canônica
        const { error: errMove } = await sb.from('mensagens_whatsapp')
          .update({ conversa_id: canonica.id })
          .eq('conversa_id', dup.id);
        if (!errMove) {
          const qtd = contagemMap[dup.id] || 0;
          mensagensMov += qtd;
          console.log('DUPLICATE_MESSAGES_MOVED', { de: dup.id, para: canonica.id, mensagens: qtd });
        }

        // Mescla dados_extras (preserva LID se existir)
        const extCan = (() => { try { return JSON.parse(canonica.dados_extras || '{}'); } catch { return {}; } })();
        const extDup = (() => { try { return JSON.parse(dup.dados_extras || '{}'); } catch { return {}; } })();
        const extMerge = { ...extDup, ...extCan }; // canônica tem prioridade

        // Atualiza canônica com ultima_msg_em mais recente
        const ultimaRecente = [canonica.ultima_msg_em, dup.ultima_msg_em]
          .filter(Boolean).sort().pop();

        await sb.from('conversas_whatsapp').update({
          dados_extras: JSON.stringify(extMerge),
          ultima_msg_em: ultimaRecente || agora,
          atualizado_em: agora,
        }).eq('id', canonica.id);

        // Marca duplicata como FECHADA (não deleta)
        await sb.from('conversas_whatsapp').update({
          status: 'FECHADA',
          atualizado_em: agora,
          dados_extras: JSON.stringify({ ...extDup, _duplicata_de: canonica.id, _deduplicado_em: agora }),
        }).eq('id', dup.id);
        console.log('DUPLICATE_CONVERSA_MARKED', { duplicataId: dup.id, canonicaId: canonica.id });
      }

      gruposMesclados++;
      relatorio.push({ telefone: tel, canonicaId: canonica.id, duplicatasIds: duplicatas.map(d => d.id) });
    }

    console.log('DUPLICATE_CONVERSAS_SCAN_DONE', { gruposMesclados, mensagensMov });
    return res.json({ sucesso: true, grupos_mesclados: gruposMesclados, mensagens_movidas: mensagensMov, relatorio });
  } catch (e) {
    console.error('[WA Dedup] executarDeduplicacao:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = {
  // Legado SQLite (não alterados)
  listarConversas,
  listarMensagens,
  enviarMensagem,
  criarOuAbrirConversa,
  webhookTrafego,
  atualizarStatus,
  buscarConversa,
  conversaPorLead,
  listarPendentes,
  // Novos — Supabase
  conversasSupabase,
  conversasPorLeadSupabase,
  conversasDoLead,
  mensagemManual,
  webhookReceberMensagem,
  // Integração status
  statusIntegracao,
  // Evolution API — gerenciamento de instância
  evoInstanciaStatus,
  evoCriarInstancia,
  evoQrCode,
  evoDesconectar,
  evoDeletarInstancia,
  evoConfigurarWebhook,
  evoConsultarWebhook,
  evoDiagRaw,
  // Deduplicação segura de conversas
  diagnosticarDuplicatas,
  executarDeduplicacao,
};

// ─────────────────────────────────────────────────────────────────────────────
// EVOLUTION API — Gerenciamento de Instância
// Todos os endpoints exigem SUPER_ADMIN
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/whatsapp/evolution/status */
async function evoInstanciaStatus(req, res) {
  try {
    const instName = evoSvc.EVOLUTION_INSTANCE;
    console.log('[EVOLUTION_STATUS_REQUEST] instance:', instName);

    if (!evoSvc.isConfigured()) {
      return res.json({
        sucesso: true,
        configurada: false,
        mensagem: 'Evolution API não configurada. Preencha EVOLUTION_API_URL e EVOLUTION_API_KEY no .env.',
      });
    }

    // ── Fonte primária: connectionState (funciona com apikey de instância) ──────
    const stateR = await evoSvc.getConnectionState();
    const rawState = (stateR.dados?.instance?.state || stateR.dados?.state || '').toLowerCase();

    let estado = 'unknown';
    if (rawState === 'open' || rawState === 'connected') {
      estado = 'connected';
    } else if (rawState === 'connecting') {
      estado = 'connecting';
    } else if (rawState === 'close' || rawState === 'closed' || rawState === 'disconnected') {
      estado = 'disconnected';
    } else if (rawState) {
      console.log('[EVOLUTION_STATUS_CONNECTED] rawState desconhecido:', rawState);
    }

    console.log('[EVOLUTION_STATUS_CONNECTED] estado:', estado, '| rawState:', rawState);

    // ── Secundário: getInstanceInfo — tenta owner/profileName (pode dar 401 no fetchInstances) ──
    // getInstanceInfo() nunca retorna sucesso:false por causa do 401 — trata internamente.
    const infoR = await evoSvc.getInstanceInfo().catch(e => {
      console.log('[EVOLUTION_PROFILE_FETCH_401] getInstanceInfo falhou:', e.message);
      return { sucesso: false, owner: null, profileName: null, profilePictureUrl: null };
    });

    const owner            = infoR.owner            || null;
    const profileName      = infoR.profileName      || null;
    const profilePictureUrl = infoR.profilePictureUrl || null;

    if (owner) {
      console.log('[EVOLUTION_CONNECTED_NUMBER_FOUND] owner disponível: ***' + String(owner).slice(-4));
      console.log('[EVOLUTION_CONNECTED_NUMBER_SOURCE] evolution_api');
    } else {
      console.log('[EVOLUTION_CONNECTED_NUMBER_NOT_FOUND] owner não retornado por nenhum endpoint autorizado');
    }

    const webhookUrl = evoSvc.obterWebhookUrl();
    console.log('[EVOLUTION_STATUS_CONNECTED] webhookUrl:', webhookUrl ? 'configurado' : 'ausente');

    return res.json({
      sucesso:           true,
      configurada:       true,
      instancia:         instName,
      estado,
      owner,
      profileName,
      profilePictureUrl,
      // Informa se owner não está disponível (sem apikey global) — não é erro
      ownerIndisponivel: !owner && estado === 'connected',
      dados:             stateR.dados,
      erro:              stateR.sucesso ? undefined : stateR.erro,
    });
  } catch (e) {
    console.error('[EVOLUTION_STATUS_REQUEST] Erro inesperado:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}


/** POST /api/whatsapp/evolution/criar */
async function evoCriarInstancia(req, res) {
  try {
    const r = await evoSvc.criarInstancia();

    // Instância-alvo já existia — service detectou antes de tentar criar
    if (r.sucesso && r.jaExistia) {
      console.log(`[EVO] Instância "${evoSvc.EVOLUTION_INSTANCE}" já existia — retornando sucesso.`);
      return res.json({
        sucesso: true,
        instancia: evoSvc.EVOLUTION_INSTANCE,
        aviso: 'Instância já existia. Clique em "Gerar QR Code" para conectar.',
      });
    }

    if (!r.sucesso) {
      // Log completo para diagnóstico
      console.log('[EVO] criarInstancia falhou — status:', r.status, '| erro:', r.erro, '| dados:', JSON.stringify(r.dados));

      // Fallback: ainda trata token duplicado que escapou da verificação prévia
      const erroStr = String(
        r.erro ||
        r.dados?.message ||
        r.dados?.error ||
        r.dados?.raw ||
        ''
      ).toLowerCase();

      const jaExiste =
        erroStr.includes('already') ||
        erroStr.includes('exists') ||
        erroStr.includes('token') ||
        erroStr.includes('duplicate') ||
        erroStr.includes('já existe') ||
        erroStr.includes('conflict') ||
        r.status === 409 ||
        r.status === 422;

      if (jaExiste) {
        console.log(`[EVO] Instância "${evoSvc.EVOLUTION_INSTANCE}" — token duplicado detectado via resposta de erro. Tratando como sucesso.`);
        return res.json({
          sucesso: true,
          instancia: evoSvc.EVOLUTION_INSTANCE,
          aviso: 'Instância já existia. Clique em "Gerar QR Code" para conectar.',
        });
      }

      return res.status(400).json({ sucesso: false, erro: r.erro, dados: r.dados });
    }

    return res.json({ sucesso: true, dados: r.dados, instancia: evoSvc.EVOLUTION_INSTANCE });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

/** GET /api/whatsapp/evolution/qrcode */
async function evoQrCode(req, res) {
  try {
    // Verifica se já está conectado — não gera novo QR sem desconectar antes
    const estado = await evoSvc.getConnectionState();
    const estadoAtual = (estado.dados?.instance?.state || estado.dados?.state || '').toLowerCase();

    if (estadoAtual === 'open') {
      return res.status(409).json({
        sucesso: false,
        erro: 'WhatsApp já está conectado. Desconecte a sessão atual antes de gerar um novo QR Code.',
        estado: 'open',
        codigo: 'ALREADY_CONNECTED',
      });
    }

    const r = await evoSvc.getQrCode();
    if (!r.sucesso) return res.status(400).json({ sucesso: false, erro: r.erro });
    // Normaliza: Evolution API pode retornar qrcode em diferentes campos
    const qr = r.dados?.qrcode?.base64
      || r.dados?.base64
      || r.dados?.qrCode
      || r.dados?.code
      || null;
    return res.json({ sucesso: true, qrcode: qr, dados: r.dados });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}


/** DELETE /api/whatsapp/evolution/desconectar */
async function evoDesconectar(req, res) {
  try {
    const r = await evoSvc.desconectar();
    if (!r.sucesso) return res.status(400).json({ sucesso: false, erro: r.erro });
    return res.json({ sucesso: true, mensagem: 'WhatsApp desconectado com sucesso.', dados: r.dados });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

/** DELETE /api/whatsapp/evolution/deletar */
async function evoDeletarInstancia(req, res) {
  try {
    const r = await evoSvc.deletarInstancia();
    if (!r.sucesso) return res.status(400).json({ sucesso: false, erro: r.erro });
    return res.json({ sucesso: true, mensagem: 'Instância deletada.', dados: r.dados });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

/** POST /api/whatsapp/evolution/configurar-webhook — reconfigura eventos do webhook */
async function evoConfigurarWebhook(req, res) {
  try {
    const r = await evoSvc.configurarWebhook();
    if (!r.sucesso) return res.status(400).json({ sucesso: false, erro: r.erro, dados: r.dados });
    return res.json({ sucesso: true, mensagem: 'Webhook configurado com MESSAGES_UPSERT.', dados: r.dados });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

/** GET /api/whatsapp/evolution/webhook-config — consulta config atual do webhook */
async function evoConsultarWebhook(req, res) {
  try {
    const r = await evoSvc.consultarWebhook();
    return res.json({ sucesso: r.sucesso, dados: r.dados, erro: r.erro });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

/**
 * GET /api/whatsapp/evolution/diag-raw
 * DIAGNÓSTICO — mapeia endpoints da Evolution API para encontrar campo do número.
 */
async function evoDiagRaw(req, res) {
  try {
    const instName = evoSvc.EVOLUTION_INSTANCE;
    console.log('[EVOLUTION_DIAG_RAW] Iniciando | instance:', instName);

    // Lote 1: endpoints principais
    const [fetchAll, connState, connectInfo] = await Promise.allSettled([
      evoSvc.call('GET', '/instance/fetchInstances'),
      evoSvc.call('GET', `/instance/connectionState/${instName}`),
      evoSvc.call('GET', `/instance/connect/${instName}`),
    ]);

    // Lote 2: endpoints alternativos (Evolution v1/v2 diferem aqui)
    const [fetchQuery, settings, profilePic, chatContacts] = await Promise.allSettled([
      evoSvc.call('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(instName)}`),
      evoSvc.call('GET', `/settings/find/${instName}`),
      evoSvc.call('GET', `/instance/profilePicture/${instName}`),
      evoSvc.call('POST', `/chat/findContacts/${instName}`, { where: {} }),
    ]);

    const safe = (r) => {
      if (r.status === 'rejected') return { erro: r.reason?.message || 'Rejected' };
      return { httpStatus: r.value?.status, sucesso: r.value?.sucesso, dados: r.value?.dados };
    };

    // Análise do fetchInstances
    let ownerDetectado = null, camposDisponiveis = [];
    for (const fetched of [fetchAll, fetchQuery]) {
      if (fetched.status === 'fulfilled' && fetched.value?.dados) {
        const lista = Array.isArray(fetched.value.dados) ? fetched.value.dados : [fetched.value.dados];
        const instData = lista.find(i => (i.instance?.instanceName || i.instanceName || '') === instName);
        if (instData) {
          const info = instData.instance || instData;
          camposDisponiveis = Object.keys(info);
          ownerDetectado = info.owner || info.ownerJid || info.wid || info.number || info.phone || null;
          console.log('[EVOLUTION_PROFILE_RESPONSE_FIELDS] Campos:', camposDisponiveis.join(', '));
          console.log('[EVOLUTION_CONNECTED_NUMBER_SOURCE] owner:', ownerDetectado ? 'PRESENTE' : 'AUSENTE');
          break;
        }
      }
    }

    return res.json({
      sucesso: true,
      diag: {
        instancia: instName,
        ownerDetectado,
        camposDisponiveis,
        fetchInstances:    safe(fetchAll),
        fetchInstancesQ:   safe(fetchQuery),
        connectionState:   safe(connState),
        connectInfo:       safe(connectInfo),
        settings:          safe(settings),
        profilePicture:    safe(profilePic),
        chatFindContacts:  safe(chatContacts),
      },
    });
  } catch (e) {
    console.error('[EVOLUTION_DIAG_RAW] Erro:', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

