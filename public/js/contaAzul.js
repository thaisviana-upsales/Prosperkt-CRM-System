/**
 * PROSPEKT CRM — Conta Azul (Frontend)
 * Aba "Conta Azul" no card/modal do lead.
 *
 * BOTÕES:
 *   1. "Enviar para Conta Azul" (SMTP via backend — sem abrir outra janela)
 *   2. "Copiar conteúdo do e-mail" (clipboard — fallback)
 *   3. "Marcar como enviado manualmente" (registra no histórico sem envio)
 *
 * CONFIGURAÇÃO NECESSÁRIA NO RAILWAY:
 *   GMAIL_USER         = conta@prospektpersonalizados.com.br
 *   GMAIL_APP_PASSWORD = xxxx xxxx xxxx xxxx  (Senha de App do Google)
 */

const ContaAzul = (() => {

  // ── Status visuais ────────────────────────────────────────────────────────
  const STATUS_CFG = {
    nao_aplicavel: { icon: '💳', label: 'Conta Azul — Não aplicável',  sub: 'Lead ainda não é uma venda.',          bar: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.07)' },
    pendente:      { icon: '⏳', label: 'Conta Azul Pendente',          sub: 'Ficha pronta. Ainda não foi enviada.', bar: 'rgba(245,166,35,0.08)', border: 'rgba(245,166,35,0.3)' },
    enviado:       { icon: '✅', label: 'Conta Azul Enviado',            sub: 'Ficha enviada com sucesso.',           bar: 'rgba(91,222,62,0.08)',  border: 'rgba(91,222,62,0.3)' },
    erro:          { icon: '❌', label: 'Conta Azul — Erro no envio',   sub: 'Houve falha. Tente novamente.',        bar: 'rgba(255,59,92,0.08)',  border: 'rgba(255,59,92,0.3)' },
  };

  // ── renderTab — ponto de entrada ──────────────────────────────────────────
  async function renderTab(lead) {
    if (!lead) return;

    const isVenda  = ['GANHO','VENDIDO','VENDA'].includes((lead.status || '').toUpperCase());
    const caStatus = lead.conta_azul_status || (isVenda ? 'pendente' : 'nao_aplicavel');

    _atualizarStatusBar(caStatus, lead);

    const naoVenda    = document.getElementById('ca-nao-venda');
    const vendaContent = document.getElementById('ca-venda-content');
    if (!isVenda) {
      if (naoVenda)    naoVenda.style.display    = '';
      if (vendaContent) vendaContent.style.display = 'none';
      return;
    }
    if (naoVenda)    naoVenda.style.display    = 'none';
    if (vendaContent) vendaContent.style.display = '';

    // Assunto automático
    const assuntoEl = document.getElementById('ca-assunto');
    if (assuntoEl && !assuntoEl.value) {
      assuntoEl.value = lead.empresa
        ? `Nova venda para lancamento no Conta Azul — ${lead.empresa} / ${lead.nome}`
        : `Nova venda para lancamento no Conta Azul — ${lead.nome}`;
    }

    // Preview + destinatários + histórico
    _renderPreview(lead).catch(e => console.warn('[ContaAzul] preview:', e));
    _renderDestinatariosFixos();
    _carregarHistorico(lead.id);

    // Verifica se SMTP está configurado (rota de diagnóstico)
    _verificarSmtp();

    // ── Botão principal: Enviar pelo CRM (SMTP) ───────────────────────────
    const btnEnviar = document.getElementById('ca-btn-enviar');
    if (btnEnviar) {
      btnEnviar.onclick = () => _enviar(lead.id);
    }

    // ── Botão: Copiar conteúdo ────────────────────────────────────────────
    const btnCopiar = document.getElementById('ca-btn-copiar');
    if (btnCopiar) {
      btnCopiar.onclick = () => _copiarConteudo(lead);
    }

    // ── Botão: Marcar como enviado manualmente ────────────────────────────
    const btnManual = document.getElementById('ca-btn-manual');
    if (btnManual) {
      btnManual.onclick = () => _marcarManual(lead.id);
    }
  }

  // ── Verifica se SMTP está configurado no backend ──────────────────────────
  async function _verificarSmtp() {
    const aviso = document.getElementById('ca-smtp-aviso');
    const btn   = document.getElementById('ca-btn-enviar');
    try {
      const r = await Auth.api('GET', '/conta-azul/smtp-status');
      const configurado = r?.data?.configurado;
      if (aviso) aviso.style.display = configurado ? 'none' : '';
      if (btn)   btn.title = configurado ? '' : 'Configure GMAIL_USER e GMAIL_APP_PASSWORD no Railway';
    } catch(e) {
      // Rota pode não existir ainda — ignora silenciosamente
      if (aviso) aviso.style.display = 'none';
    }
  }

  // ── Envio via SMTP (dentro do CRM, sem abrir outra janela) ───────────────
  async function _enviar(leadId) {
    const btn  = document.getElementById('ca-btn-enviar');
    const txt  = document.getElementById('ca-btn-txt');
    const spin = document.getElementById('ca-spinner');
    const obs  = document.getElementById('ca-obs')?.value?.trim() || '';
    const assunto = document.getElementById('ca-assunto')?.value?.trim() || '';

    if (btn)  btn.disabled = true;
    if (txt)  txt.textContent = 'Enviando...';
    if (spin) spin.classList.remove('hidden');

    try {
      const r = await Auth.api('POST', `/conta-azul/enviar/${leadId}`, {
        observacao_adicional: obs,
        assunto_override:     assunto,
      });

      if (r?.ok) {
        if (typeof Toast !== 'undefined') Toast.show('E-mail enviado para o Conta Azul com sucesso! ✅', 'success');
        _atualizarStatusBar('enviado', { conta_azul_enviado_em: new Date().toISOString() });
        _carregarHistorico(leadId);
      } else {
        const dados = r?.data || {};
        if (dados.pendencias?.length) {
          if (typeof Toast !== 'undefined') Toast.show(`Preencha os campos obrigatórios: ${dados.pendencias.join(', ')}.`, 'error');
        } else {
          const erro = dados.erro || 'Não foi possível enviar. Verifique a configuração de e-mail no Railway.';
          if (typeof Toast !== 'undefined') Toast.show(erro, 'error');
          // Mostra aviso de configuração se erro for de SMTP
          const aviso = document.getElementById('ca-smtp-aviso');
          if (aviso && (erro.includes('configurado') || erro.includes('SMTP') || erro.includes('GMAIL'))) {
            aviso.style.display = '';
          }
        }
        _atualizarStatusBar('erro', { conta_azul_ultimo_erro: dados.erro || '' });
      }
    } catch(e) {
      if (typeof Toast !== 'undefined') Toast.show('Erro inesperado ao enviar.', 'error');
      console.error('[ContaAzul] enviar:', e);
    } finally {
      if (btn)  btn.disabled = false;
      if (txt)  txt.textContent = 'Enviar para Conta Azul';
      if (spin) spin.classList.add('hidden');
    }
  }

  // ── Monta corpo do e-mail (usado por copiar) ──────────────────────────────
  async function _montarCorpoEmail(lead) {
    const fmtMoney = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtDate  = d => { if (!d) return 'Nao informado'; try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return 'Nao informado'; } };
    const ni       = v => (v && String(v).trim()) ? String(v).trim() : 'Nao informado';

    let produtosLinhas = ['  - Nenhum produto registrado'];
    let totalGeral = 0;
    try {
      const rProd = await Auth.api('GET', `/leads/${lead.id}/produtos`);
      const prods = (rProd?.data?.dados || rProd?.data || []).filter(p => !p._removido);
      if (prods.length > 0) {
        produtosLinhas = prods.map(p => {
          const nome  = p.produto_nome || p.produto?.nome || 'Produto';
          const qtd   = Number(p.quantidade || 1);
          const vUnit = Number(p.valor_unitario || 0);
          const vTot  = Number(p.valor_total || (qtd * vUnit));
          totalGeral += vTot;
          return `  - ${nome}  |  Qtd: ${qtd}  |  Unit: ${fmtMoney(vUnit)}  |  Total: ${fmtMoney(vTot)}`;
        });
        produtosLinhas.push(`  TOTAL GERAL: ${fmtMoney(totalGeral)}`);
      }
    } catch(e) { /* nao critico */ }

    const obs        = document.getElementById('ca-obs')?.value?.trim() || '';
    const preparedBy = (window._usuarioAtual?.nome) || lead.responsavel_nome || 'Usuario CRM';
    const agora      = new Date().toLocaleString('pt-BR');
    const sep        = '='.repeat(52);
    const linha      = '-'.repeat(52);

    return [
      sep, 'NOVA VENDA - LANCAMENTO NO CONTA AZUL',
      `Preparado por: ${preparedBy}  |  ${agora}`, sep, '',
      linha + ' DADOS DO CLIENTE',
      `Nome:               ${ni(lead.nome)}`,
      `Empresa:            ${ni(lead.empresa)}`,
      `CPF / CNPJ:         ${ni(lead.cnpj)}`,
      `Telefone:           ${ni(lead.telefone)}`,
      `E-mail:             ${ni(lead.email)}`, '',
      linha + ' DADOS DA VENDA',
      `Vendedor:           ${ni(lead.responsavel_nome)}`,
      `Funil:              ${ni(lead.funil_nome)}`,
      `Data da venda:      ${fmtDate(lead.data_fechamento || lead.ganho_em)}`,
      `Valor da venda:     ${fmtMoney(lead.valor_venda || lead.valor)}`,
      `Forma de pagamento: ${ni(lead.forma_pagamento)}`,
      `Prev. prox. compra: ${ni(lead.previsao_proxima_compra)}`,
      `Observacoes:        ${ni(lead.observacoes)}`, '',
      linha + ' PRODUTOS',
      ...produtosLinhas, '',
      linha + ' ENDERECO DE ENTREGA',
      `CEP:                ${ni(lead.cep_entrega)}`,
      `Endereco:           ${ni([lead.endereco_entrega, lead.numero_entrega].filter(Boolean).join(', '))}`,
      `Complemento:        ${ni(lead.complemento_entrega)}`,
      `Referencia:         ${ni(lead.referencia_entrega)}`,
      `Bairro:             ${ni(lead.bairro_entrega)}`,
      `Cidade / UF:        ${ni([lead.cidade_entrega, lead.uf_entrega].filter(Boolean).join(' / '))}`, '',
      linha + ' DADOS DE PRODUCAO',
      `Solic. orcamento:   ${fmtDate(lead.data_solicitacao_orcamento)}`,
      `Envio orcamento:    ${fmtDate(lead.data_envio_orcamento)}`,
      `Aprov. orcamento:   ${fmtDate(lead.data_aprovacao_orcamento)}`,
      `Layout virtual:     ${fmtDate(lead.layout_virtual_aprovado_em)}`,
      `Envio de amostra:   ${fmtDate(lead.data_envio_amostra)}`,
      `Aprov. de amostra:  ${fmtDate(lead.data_aprovacao_amostra)}`,
      `Data de entrega:    ${fmtDate(lead.data_entrega)}`,
      `Obs. producao:      ${ni(lead.obs_producao || lead.observacoes_producao)}`, '',
      linha + ' CONTA AZUL',
      obs ? `Obs. adicional:     ${obs}` : 'Obs. adicional:     Nao informado',
      `Preparado por:      ${preparedBy}`,
      `Data/hora:          ${agora}`, sep,
    ].join('\n');
  }

  // ── Copiar conteúdo para clipboard ────────────────────────────────────────
  async function _copiarConteudo(lead) {
    const btn = document.getElementById('ca-btn-copiar');
    try {
      const corpo = await _montarCorpoEmail(lead);
      await navigator.clipboard.writeText(corpo);
      if (typeof Toast !== 'undefined')
        Toast.show('Conteudo copiado. Cole no seu e-mail para enviar ao Conta Azul.', 'success');
      if (btn) {
        const original = btn.innerHTML;
        btn.innerHTML = '✅ Copiado!';
        setTimeout(() => { btn.innerHTML = original; }, 2500);
      }
    } catch(e) {
      console.error('[ContaAzul] clipboard:', e);
      if (typeof Toast !== 'undefined') Toast.show('Nao foi possivel copiar. Selecione o texto no preview manualmente.', 'error');
    }
  }

  // ── Registrar envio manual (sem SMTP) ────────────────────────────────────
  async function _marcarManual(leadId) {
    const btn = document.getElementById('ca-btn-manual');
    if (btn) btn.disabled = true;
    try {
      const obs = document.getElementById('ca-obs')?.value?.trim() || '';
      const r   = await Auth.api('POST', `/conta-azul/registrar-manual/${leadId}`, { observacao_adicional: obs });
      if (r?.ok || r?.data?.sucesso) {
        const agora  = new Date().toLocaleString('pt-BR');
        const nome   = window._usuarioAtual?.nome || 'Usuario';
        const el     = document.getElementById('ca-manual-status');
        if (el) { el.textContent = `✅ E-mail Conta Azul marcado como enviado manualmente por ${nome} em ${agora}.`; el.style.display = ''; }
        _atualizarStatusBar('enviado', { conta_azul_enviado_em: new Date().toISOString(), conta_azul_enviado_por: nome });
        _carregarHistorico(leadId);
        if (typeof Toast !== 'undefined') Toast.show('Envio registrado manualmente!', 'success');
      } else {
        if (typeof Toast !== 'undefined') Toast.show(r?.data?.erro || 'Erro ao registrar.', 'error');
      }
    } catch(e) {
      console.error('[ContaAzul] marcarManual:', e);
      if (typeof Toast !== 'undefined') Toast.show('Erro ao registrar envio manual.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── Preview (texto resumido no card) ─────────────────────────────────────
  async function _renderPreview(lead) {
    const el = document.getElementById('ca-preview');
    if (!el) return;
    const fmtMoney = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtDate  = d => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

    let produtosTexto = '— Nenhum produto registrado —';
    try {
      const rProd = await Auth.api('GET', `/leads/${lead.id}/produtos`);
      const prods = (rProd?.data?.dados || rProd?.data || []).filter(p => !p._removido);
      if (prods.length > 0) {
        produtosTexto = prods.map(p => {
          const nome  = p.produto_nome || p.produto?.nome || 'Produto';
          const qtd   = p.quantidade || 1;
          const vUnit = p.valor_unitario ? ` | Unit: ${fmtMoney(p.valor_unitario)}` : '';
          const vTot  = p.valor_total    ? ` | Total: ${fmtMoney(p.valor_total)}`   : '';
          return `• ${nome} (Qtd: ${qtd})${vUnit}${vTot}`;
        }).join('\n');
      }
    } catch(e) { /* nao critico */ }

    el.textContent = [
      '=== DADOS DO CLIENTE ===',
      `Cliente:       ${lead.nome || '—'}`,
      `Empresa:       ${lead.empresa || '—'}`,
      `Telefone:      ${lead.telefone || '—'}`,
      `E-mail:        ${lead.email || '—'}`,
      `CNPJ / CPF:    ${lead.cnpj || '—'}`,
      '',
      '=== DADOS DA VENDA ===',
      `Vendedor:      ${lead.responsavel_nome || '—'}`,
      `Funil:         ${lead.funil_nome || '—'}`,
      `Data fecham.:  ${fmtDate(lead.data_fechamento)}`,
      `Valor total:   ${fmtMoney(lead.valor_venda || lead.valor)}`,
      `Forma pagto:   ${lead.forma_pagamento || '—'}`,
      `Prev. proxima compra: ${lead.previsao_proxima_compra || '—'}`,
      '',
      '=== PRODUTOS ===',
      produtosTexto,
      '',
      '=== ENDERECO DE ENTREGA ===',
      `CEP:           ${lead.cep_entrega || '—'}`,
      `Endereco:      ${[lead.endereco_entrega, lead.numero_entrega].filter(Boolean).join(', ') || '—'}`,
      `Complemento:   ${lead.complemento_entrega || '—'}`,
      `Referencia:    ${lead.referencia_entrega || '—'}`,
      `Bairro:        ${lead.bairro_entrega || '—'}`,
      `Cidade / UF:   ${[lead.cidade_entrega, lead.uf_entrega].filter(Boolean).join(' / ') || '—'}`,
      '',
      '=== OBSERVACOES ===',
      `${lead.observacoes || '—'}`,
    ].join('\n');
  }

  // ── Destinatários fixos ──────────────────────────────────────────────────
  function _renderDestinatariosFixos() {
    const el = document.getElementById('ca-destinatarios');
    if (!el) return;
    const lista = [
      'tuane@prospektpersonalizados.com.br',
      'ramiro@prospektpersonalizados.com.br',
      'priscila@prospektpersonalizados.com.br',
      'caique@prospektpersonalizados.com.br',
      'felipe@prospektpersonalizados.com.br',
    ];
    el.innerHTML = lista.map(email =>
      `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 4px 2px 0;padding:2px 8px;` +
      `background:rgba(91,222,62,0.08);border:1px solid rgba(91,222,62,0.2);border-radius:20px;font-size:.72rem">` +
      `<span style="color:var(--text-muted)">${escHtml(email)}</span></span>`
    ).join('');
  }

  // ── Histórico de envios ──────────────────────────────────────────────────
  async function _carregarHistorico(leadId) {
    const el = document.getElementById('ca-historico');
    if (!el) return;
    try {
      const r     = await Auth.api('GET', `/conta-azul/historico/${leadId}`);
      const itens = r?.data?.dados || [];
      if (!itens.length) { el.textContent = 'Nenhum envio registrado.'; return; }
      el.innerHTML = itens.map(h => {
        const dt    = new Date(h.enviado_em).toLocaleString('pt-BR');
        const ok    = h.status === 'enviado' || h.status === 'manual';
        const label = h.status === 'manual' ? 'Enviado manualmente' : (ok ? 'Enviado' : 'Erro');
        const cor   = ok ? 'var(--green)' : 'var(--error)';
        const dest  = (() => { try { const d = JSON.parse(h.destinatarios_json || '[]'); return Array.isArray(d) ? d.map(x => x.email).join(', ') : ''; } catch { return ''; } })();
        return `<div style="padding:8px 10px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:7px">` +
          `<div style="display:flex;justify-content:space-between;margin-bottom:3px">` +
          `<span style="font-weight:600;color:${cor}">${ok ? '✅' : '❌'} ${label}</span>` +
          `<span style="color:var(--text-muted)">${dt}</span></div>` +
          `<div style="color:var(--text-secondary)">Por: ${escHtml(h.usuario_nome || '—')}</div>` +
          `${dest ? `<div style="color:var(--text-muted);font-size:.7rem;margin-top:2px">Para: ${escHtml(dest)}</div>` : ''}` +
          `${h.erro ? `<div style="color:var(--error);font-size:.7rem;margin-top:2px">Erro: ${escHtml(h.erro)}</div>` : ''}` +
          `</div>`;
      }).join('');
    } catch(e) {
      el.textContent = 'Erro ao carregar historico.';
    }
  }

  // ── Status bar ───────────────────────────────────────────────────────────
  function _atualizarStatusBar(status, lead) {
    const cfg = STATUS_CFG[status] || STATUS_CFG.nao_aplicavel;
    const bar = document.getElementById('ca-status-bar');
    if (bar) { bar.style.background = cfg.bar; bar.style.border = `1px solid ${cfg.border}`; }
    const icon  = document.getElementById('ca-status-icon');  if (icon)  icon.textContent  = cfg.icon;
    const label = document.getElementById('ca-status-label'); if (label) label.textContent = cfg.label;
    const sub   = document.getElementById('ca-status-sub');
    if (sub) {
      let t = cfg.sub;
      if (status === 'enviado' && lead?.conta_azul_enviado_em)
        t += ` Em: ${new Date(lead.conta_azul_enviado_em).toLocaleString('pt-BR')}` +
             (lead.conta_azul_enviado_por ? ` por ${lead.conta_azul_enviado_por}` : '');
      if (status === 'erro' && lead?.conta_azul_ultimo_erro) t += ` Erro: ${lead.conta_azul_ultimo_erro}`;
      sub.textContent = t;
    }
    _atualizarBadgeCard(status);
  }

  function _atualizarBadgeCard(status) {
    const h = document.getElementById('ml-ca-badge');
    if (!h) return;
    const cfg = STATUS_CFG[status] || STATUS_CFG.nao_aplicavel;
    h.textContent = cfg.icon + ' ' + cfg.label;
    h.style.display = status === 'nao_aplicavel' ? 'none' : '';
    h.style.borderColor = cfg.border;
    h.style.background  = cfg.bar;
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { renderTab };
})();

window.ContaAzul = ContaAzul;
