/**
 * PROSPEKT CRM — Conta Azul Controller
 * Aba Conta Azul no card do lead:
 *   - Lista destinatários cadastrados
 *   - Compila ficha da venda
 *   - Envia e-mail para financeiro/operacional
 *   - Salva histórico e registra timeline
 *   - Atualiza conta_azul_status no lead
 */

const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');
const { registrarTimeline } = require('../services/auditService');
const { enviarEmail } = require('../services/emailService');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/conta-azul/destinatarios
// ─────────────────────────────────────────────────────────────────────────────
async function listarDestinatarios(req, res) {
  const { sb, isSupa } = getProvider();
  try {
    if (isSupa) {
      const { data, error } = await sb
        .from('config_email_conta_azul')
        .select('id, nome, email, tipo, ativo')
        .order('nome');
      if (error) throw error;
      const ativos = (data || []).filter(d => d.ativo === 1 || d.ativo === true || d.ativo === '1');
      return res.json({ sucesso: true, dados: ativos });
    }
    return res.json({ sucesso: true, dados: [] }); // SQLite: sem suporte inicial
  } catch (e) {
    console.error('[contaAzul.destinatarios]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/conta-azul/historico/:leadId
// ─────────────────────────────────────────────────────────────────────────────
async function historico(req, res) {
  const { sb, isSupa } = getProvider();
  const { leadId } = req.params;
  try {
    if (isSupa) {
      const { data, error } = await sb
        .from('conta_azul_emails_enviados')
        .select('*')
        .eq('lead_id', leadId)
        .order('enviado_em', { ascending: false });
      if (error) throw error;
      return res.json({ sucesso: true, dados: data || [] });
    }
    return res.json({ sucesso: true, dados: [] });
  } catch (e) {
    console.error('[contaAzul.historico]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/conta-azul/enviar/:leadId
// ─────────────────────────────────────────────────────────────────────────────
async function enviar(req, res) {
  if (!['SUPER_ADMIN', 'GESTOR'].includes(req.usuario.role)) {
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado. Somente SUPER_ADMIN e GESTOR podem enviar.' });
  }

  const { sb, isSupa } = getProvider();
  const leadId = req.params.leadId;
  const { observacao_adicional = '', assunto_override = '' } = req.body;

  try {
    // ── 1. Carrega lead completo ────────────────────────────────────────────
    const { data: lead, error: leadErr } = await sb
      .from('leads')
      .select('*, responsavel:usuarios!responsavel_id(nome), funil:funis!funil_id(nome)')
      .eq('id', leadId)
      .single();
    if (leadErr || !lead) return res.status(404).json({ sucesso: false, erro: 'Lead não encontrado.' });

    const statusUpper = (lead.status || '').toUpperCase();
    if (!['GANHO', 'VENDIDO', 'VENDA'].includes(statusUpper)) {
      return res.status(400).json({ sucesso: false, erro: 'Este lead ainda não é uma venda. A ficha Conta Azul só pode ser enviada para leads com status GANHO.' });
    }

    // ── 2. Carrega produtos do lead ──────────────────────────────────────────
    const { data: leadProdutos } = await sb
      .from('lead_produtos')
      .select('*, produto:produtos!produto_id(nome, descricao)')
      .eq('lead_id', leadId)
      .is('deleted_at', null);

    // ── 3. Carrega destinatários ativos ──────────────────────────────────────
    const { data: destRaw } = await sb
      .from('config_email_conta_azul')
      .select('nome, email, tipo')
      .order('nome');
    const destinatarios = (destRaw || []).filter(d => d.ativo === 1 || d.ativo === true || d.ativo === '1');

    if (!destinatarios.length) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Nenhum destinatário cadastrado. Cadastre ao menos um e-mail na tabela config_email_conta_azul.',
      });
    }

    // Parse de dados_extras antes da validação
    const dadosExtras = typeof lead.dados_extras === 'string'
      ? JSON.parse(lead.dados_extras || '{}')
      : (lead.dados_extras || {});

    // ── 4. Validação de campos obrigatórios ──────────────────────────────────
    const pendencias = [];
    if (!lead.nome)                                          pendencias.push('Nome do cliente');
    if (!lead.telefone)                                      pendencias.push('Telefone');
    if (!lead.cnpj)                                          pendencias.push('CNPJ / CPF');
    if (!leadProdutos || leadProdutos.length === 0)          pendencias.push('Produto(s)');
    if (!lead.valor_venda && !lead.valor)                    pendencias.push('Valor da venda');
    if (!lead.forma_pagamento)                               pendencias.push('Forma de pagamento');
    if (!lead.data_fechamento)                               pendencias.push('Data de fechamento');
    if (!lead.cep_entrega && !dadosExtras?.cep)              pendencias.push('CEP de entrega');
    if (!lead.endereco_entrega && !dadosExtras?.endereco)    pendencias.push('Endereço de entrega');
    if (!lead.cidade_entrega && !dadosExtras?.cidade)        pendencias.push('Cidade de entrega');
    if (!lead.uf_entrega && !dadosExtras?.uf)                pendencias.push('UF de entrega');

    if (pendencias.length > 0) {
      return res.status(400).json({
        sucesso: false,
        erro: `Não foi possível enviar. Preencha os campos obrigatórios: ${pendencias.join(', ')}.`,
        pendencias,
      });
    }

    // ── 5. Monta dados da ficha ───────────────────────────────────────────────
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
    const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const produtosList = (leadProdutos || []).map(lp => {
      const nome  = lp.produto?.nome || lp.produto_nome || 'Produto';
      const qtd   = lp.quantidade || 1;
      const valor = fmtMoney(lp.valor_total || 0);
      return `• ${nome} (Qtd: ${qtd}) — ${valor}`;
    }).join('\n') || '— Nenhum produto registrado —';

    const assunto = assunto_override ||
      `Cadastro Conta Azul — ${lead.empresa || lead.nome || 'Cliente'} — Venda ${fmtDate(lead.data_fechamento || lead.atualizado_em)}`;

    // ── 5. Gera HTML do e-mail ───────────────────────────────────────────────
    const htmlEmail = gerarHtmlEmail({
      lead, dadosExtras, produtosList, observacao_adicional,
      fmtDate, fmtMoney, leadId,
      responsavelNome: lead.responsavel?.nome || lead.responsavel_nome || '—',
      funilNome: lead.funil?.nome || lead.funil_nome || '—',
      usuarioLogado: req.usuario.nome || req.usuario.email || 'Sistema',
    });

    // ── 6. Envia e-mail ──────────────────────────────────────────────────────
    const toEmails = destinatarios.map(d => d.email);
    const envio = await enviarEmail({ to: toEmails, subject: assunto, html: htmlEmail });

    const agora = new Date().toISOString();
    const statusEnvio = envio.ok ? 'enviado' : 'erro';

    // ── 7. Salva histórico ───────────────────────────────────────────────────
    await sb.from('conta_azul_emails_enviados').insert({
      id: crypto.randomBytes(16).toString('hex'),
      lead_id: leadId,
      usuario_id: req.usuario.id,
      usuario_nome: req.usuario.nome,
      destinatarios_json: JSON.stringify(destinatarios),
      assunto,
      observacao_adicional: observacao_adicional || null,
      status: statusEnvio,
      erro: envio.erro || null,
      enviado_em: agora,
      criado_em: agora,
    });

    // ── 8. Atualiza conta_azul_status no lead ────────────────────────────────
    const updLead = {
      conta_azul_status: statusEnvio,
      atualizado_em: agora,
    };
    if (envio.ok) {
      updLead.conta_azul_enviado_em  = agora;
      updLead.conta_azul_enviado_por = req.usuario.nome;
      updLead.conta_azul_ultimo_erro = null;
    } else {
      updLead.conta_azul_ultimo_erro = envio.erro;
    }
    await sb.from('leads').update(updLead).eq('id', leadId);

    // ── 9. Timeline ──────────────────────────────────────────────────────────
    const descTimeline = envio.ok
      ? `Ficha Conta Azul enviada por e-mail para: ${destinatarios.map(d => d.email).join(', ')}.`
      : `Falha ao enviar ficha Conta Azul. Erro: ${envio.erro}`;
    setImmediate(() => registrarTimeline({
      leadId,
      usuarioId:   req.usuario.id,
      usuarioNome: req.usuario.nome || 'Sistema',
      tipoAcao:    'EMAIL_CONTA_AZUL_ENVIADO',
      descricao:   descTimeline,
      dadosNovos:  { status: statusEnvio, assunto, destinatarios: toEmails },
      origem:      'conta_azul',
    }).catch(e => console.error('[TIMELINE_CONTA_AZUL]', e.message)));

    if (!envio.ok) {
      return res.status(502).json({ sucesso: false, erro: envio.erro, status: 'erro' });
    }

    return res.json({
      sucesso: true,
      mensagem: 'Ficha Conta Azul enviada com sucesso.',
      destinatarios: toEmails,
      assunto,
    });

  } catch (e) {
    console.error('[contaAzul.enviar]', e.message);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao enviar ficha Conta Azul. ' + e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: gera HTML do e-mail da ficha Conta Azul
// ─────────────────────────────────────────────────────────────────────────────
function gerarHtmlEmail({ lead, dadosExtras, produtosList, observacao_adicional,
  fmtDate, fmtMoney, leadId, responsavelNome, funilNome, usuarioLogado }) {

  const linha = (label, value) =>
    `<tr><td style="padding:5px 12px 5px 0;color:#888;font-size:13px;width:180px;vertical-align:top">${label}</td><td style="padding:5px 0;font-size:13px;color:#eee">${value || '—'}</td></tr>`;

  const secao = (titulo, conteudo) => `
    <div style="margin:20px 0">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5BDE3E;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1)">${titulo}</div>
      ${conteudo}
    </div>`;

  const produtosHtml = produtosList.split('\n').map(p =>
    `<div style="font-size:13px;color:#eee;padding:3px 0">${p}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Ficha Conta Azul — Prospekt CRM</title></head>
<body style="margin:0;padding:0;background:#0D1117;font-family:Inter,Arial,sans-serif">
  <div style="max-width:680px;margin:32px auto;background:#0D1A22;border-radius:12px;border:1px solid rgba(91,222,62,0.2);overflow:hidden">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#003B46,#014654);padding:28px 32px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#5BDE3E;margin-bottom:8px">PROSPEKT CRM</div>
      <h1 style="margin:0;font-size:20px;font-weight:700;color:#fff">Ficha Conta Azul</h1>
      <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.6)">
        ${lead.empresa || lead.nome} · Venda ${fmtDate(lead.data_fechamento || lead.atualizado_em)}
      </p>
    </div>

    <!-- Corpo -->
    <div style="padding:28px 32px">
      <p style="font-size:14px;color:#ccc;margin:0 0 24px">Olá, time.<br>Segue a ficha da venda para cadastro/conferência no <strong style="color:#fff">Conta Azul</strong>.</p>

      ${secao('Dados do Cliente', `<table style="border-collapse:collapse;width:100%">
        ${linha('Cliente / Razão Social', lead.nome)}
        ${linha('Empresa', lead.empresa)}
        ${linha('Telefone', lead.telefone)}
        ${linha('E-mail', lead.email)}
        ${linha('CPF / CNPJ', lead.cnpj || lead.cpf_cnpj || dadosExtras?.cpf_cnpj)}
      </table>`)}

      ${secao('Dados da Venda', `<table style="border-collapse:collapse;width:100%">
        ${linha('Vendedor responsável', responsavelNome)}
        ${linha('Funil de origem', funilNome)}
        ${linha('Data de fechamento', fmtDate(lead.data_fechamento))}
        ${linha('Valor total da venda', fmtMoney(lead.valor_venda || lead.valor))}
        ${linha('Forma de pagamento', lead.forma_pagamento)}
        ${linha('Parcelamento / Condição', lead.parcelas_json ? (() => { try { const p = JSON.parse(lead.parcelas_json); return Array.isArray(p) ? p.map(x => `${x.parcela}x: ${x.valor ? 'R$ '+Number(x.valor).toLocaleString('pt-BR',{minimumFractionDigits:2}) : ''} ${x.vencimento||''}`).join(' | ') : JSON.stringify(p); } catch(e) { return lead.parcelas_json; } })() : '—')}
        ${linha('Previsão próxima compra', lead.previsao_proxima_compra || dadosExtras?.previsao_proxima_compra)}
      </table>`)}

      ${secao('Produtos', `<div style="padding:4px 0">${produtosHtml}</div>`)}

      ${secao('Endereço de Entrega', `<table style="border-collapse:collapse;width:100%">
        ${linha('CEP', lead.cep_entrega)}
        ${linha('Endereço', lead.endereco_entrega)}
        ${linha('Número', lead.numero_entrega)}
        ${linha('Complemento', lead.complemento_entrega)}
        ${linha('Referência', lead.referencia_entrega)}
        ${linha('Bairro', lead.bairro_entrega)}
        ${linha('Cidade / UF', [lead.cidade_entrega, lead.uf_entrega].filter(Boolean).join(' / '))}
      </table>`)}

      ${(lead.observacoes || dadosExtras?.obs_pedido || observacao_adicional) ? secao('Observações', `
        ${lead.observacoes ? `<div style="font-size:13px;color:#ccc;margin-bottom:8px"><strong style="color:#fff">Comercial:</strong> ${lead.observacoes}</div>` : ''}
        ${dadosExtras?.obs_pedido ? `<div style="font-size:13px;color:#ccc;margin-bottom:8px"><strong style="color:#fff">Pedido:</strong> ${dadosExtras.obs_pedido}</div>` : ''}
        ${observacao_adicional ? `<div style="font-size:13px;color:#ccc;background:rgba(91,222,62,0.06);border-left:3px solid #5BDE3E;padding:10px 14px;border-radius:0 6px 6px 0"><strong style="color:#5BDE3E">Obs. adicional:</strong><br>${observacao_adicional}</div>` : ''}
      `) : ''}

      <!-- Rodapé -->
      <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08)">
        <p style="font-size:12px;color:#666;margin:0">
          Lead no CRM: <span style="color:#888">#${leadId}</span><br>
          Enviado por: <strong style="color:#aaa">${usuarioLogado}</strong>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/conta-azul/registrar-manual/:leadId
// Registra envio manual sem SMTP — apenas salva histórico e atualiza status.
// ─────────────────────────────────────────────────────────────────────────────
async function registrarManual(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { leadId } = req.params;
  const usuario = req.usuario;
  const { observacao_adicional } = req.body || {};

  try {
    const agr      = new Date().toISOString();
    const hId      = require('crypto').randomBytes(16).toString('hex');
    const destJson = JSON.stringify(
      ['tuane@prospektpersonalizados.com.br','ramiro@prospektpersonalizados.com.br',
       'priscila@prospektpersonalizados.com.br','caique@prospektpersonalizados.com.br',
       'felipe@prospektpersonalizados.com.br'].map(e => ({ email: e }))
    );

    if (isSupa) {
      // Registra no histórico
      await sb.from('conta_azul_emails_enviados').insert({
        id:                  hId,
        lead_id:             leadId,
        usuario_id:          usuario?.id || null,
        usuario_nome:        usuario?.nome || 'Usuário',
        status:              'manual',
        assunto:             observacao_adicional ? `Envio manual — ${observacao_adicional}` : 'Envio manual registrado',
        destinatarios_json:  destJson,
        enviado_em:          agr,
        erro:                null,
      }).catch(() => {}); // Ignora se tabela não existir ainda

      // Atualiza status do lead
      await sb.from('leads').update({
        conta_azul_status:    'enviado',
        conta_azul_enviado_em: agr,
        conta_azul_enviado_por: usuario?.nome || 'Usuário',
        atualizado_em:        agr,
      }).eq('id', leadId).catch(() => {});

      // Timeline
      try {
        await registrarTimeline({
          leadId,
          tipo:      'CONTA_AZUL_MANUAL',
          descricao: `Ficha Conta Azul marcada como enviada manualmente por ${usuario?.nome || 'Usuário'}.`,
          usuarioId: usuario?.id,
          sb,
        });
      } catch(eTl) { /* não crítico */ }

    } else {
      try {
        sqlite.prepare(`
          INSERT OR IGNORE INTO conta_azul_emails_enviados
            (id,lead_id,usuario_id,usuario_nome,status,assunto,destinatarios_json,enviado_em)
          VALUES (?,?,?,?,?,?,?,?)
        `).run(hId, leadId, usuario?.id||null, usuario?.nome||'Usuário', 'manual',
               'Envio manual registrado', destJson, agr);
        sqlite.prepare(`UPDATE leads SET conta_azul_status='enviado',conta_azul_enviado_em=?,conta_azul_enviado_por=? WHERE id=?`)
          .run(agr, usuario?.nome||'Usuário', leadId);
      } catch(eSq) { /* SQLite opcional */ }
    }

    console.log('[ContaAzul] Envio manual registrado', { leadId, usuario: usuario?.nome });
    return res.json({ sucesso: true, dados: { id: hId, enviado_em: agr, status: 'manual' } });

  } catch(e) {
    console.error('[contaAzul.registrarManual]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { listarDestinatarios, historico, enviar, registrarManual };
