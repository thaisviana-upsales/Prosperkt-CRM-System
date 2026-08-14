/**
 * PROSPEKT CRM — Conta Azul (Frontend)
 * Aba "Conta Azul" no card/modal do lead.
 *
 * BOTÕES (nenhum requer senha ou configuração de SMTP):
 *   1. "Abrir Gmail para enviar"  — abre Gmail na web (nova aba) já preenchido
 *   2. "Baixar ficha da venda"    — gera e baixa arquivo .txt com todos os dados
 *   3. "Marcar como enviado"      — registra envio no histórico do CRM
 *   4. "Copiar conteúdo"          — copia corpo para área de transferência
 */

const ContaAzul = (() => {

  // ── Destinatários fixos ──────────────────────────────────────────────────
  const DESTINATARIOS = [
    'tuane@prospektpersonalizados.com.br',
    'ramiro@prospektpersonalizados.com.br',
    'priscila@prospektpersonalizados.com.br',
    'caique@prospektpersonalizados.com.br',
    'felipe@prospektpersonalizados.com.br',
  ];

  // ── Status visuais ────────────────────────────────────────────────────────
  const STATUS_CFG = {
    nao_aplicavel: { icon: '💳', label: 'Conta Azul — Não aplicável',  sub: 'Lead ainda não é uma venda.',          bar: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.07)' },
    pendente:      { icon: '⏳', label: 'Conta Azul Pendente',          sub: 'Ficha pronta. Ainda não foi enviada.', bar: 'rgba(245,166,35,0.08)', border: 'rgba(245,166,35,0.3)' },
    enviado:       { icon: '✅', label: 'Conta Azul Enviado',            sub: 'Ficha enviada com sucesso.',           bar: 'rgba(91,222,62,0.08)',  border: 'rgba(91,222,62,0.3)' },
    erro:          { icon: '❌', label: 'Conta Azul — Erro no envio',   sub: 'Houve falha. Tente novamente.',        bar: 'rgba(255,59,92,0.08)',  border: 'rgba(255,59,92,0.3)' },
  };

  // ── renderTab ─────────────────────────────────────────────────────────────
  async function renderTab(lead) {
    if (!lead) return;

    const isVenda  = ['GANHO','VENDIDO','VENDA'].includes((lead.status || '').toUpperCase());
    const caStatus = lead.conta_azul_status || (isVenda ? 'pendente' : 'nao_aplicavel');

    _atualizarStatusBar(caStatus, lead);

    const naoVenda     = document.getElementById('ca-nao-venda');
    const vendaContent = document.getElementById('ca-venda-content');
    if (!isVenda) {
      if (naoVenda)     naoVenda.style.display    = '';
      if (vendaContent) vendaContent.style.display = 'none';
      return;
    }
    if (naoVenda)     naoVenda.style.display    = 'none';
    if (vendaContent) vendaContent.style.display = '';

    // Assunto automático
    const assuntoEl = document.getElementById('ca-assunto');
    if (assuntoEl && !assuntoEl.value) {
      assuntoEl.value = lead.empresa
        ? `Nova venda - Conta Azul: ${lead.empresa} / ${lead.nome}`
        : `Nova venda - Conta Azul: ${lead.nome}`;
    }

    // Preview + destinatários + histórico
    _renderPreview(lead).catch(e => console.warn('[ContaAzul] preview:', e));
    _renderDestinatariosFixos();
    _carregarHistorico(lead.id);

    // ── Botão 1: Abrir Gmail ────────────────────────────────────────────────
    const btnGmail = document.getElementById('ca-btn-gmail');
    if (btnGmail) {
      btnGmail.onclick = () => _abrirGmail(lead);
    }

    // ── Botão 2: Baixar ficha ───────────────────────────────────────────────
    const btnBaixar = document.getElementById('ca-btn-baixar');
    if (btnBaixar) {
      btnBaixar.onclick = () => _baixarFicha(lead);
    }

    // ── Botão 3: Marcar como enviado ────────────────────────────────────────
    const btnManual = document.getElementById('ca-btn-manual');
    if (btnManual) {
      btnManual.onclick = () => _marcarManual(lead.id);
    }

    // ── Botão 4: Copiar conteúdo ────────────────────────────────────────────
    const btnCopiar = document.getElementById('ca-btn-copiar');
    if (btnCopiar) {
      btnCopiar.onclick = () => _copiarConteudo(lead);
    }
  }

  // ── Monta o corpo completo da ficha ───────────────────────────────────────
  async function _montarCorpo(lead) {
    const fmtMoney = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtDate  = d => { if (!d) return 'Nao informado'; try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return 'Nao informado'; } };
    const ni       = v => (v && String(v).trim()) ? String(v).trim() : 'Nao informado';

    // Busca produtos
    let linhasProd = ['  - Nenhum produto registrado'];
    let totalGeral = 0;
    try {
      const rProd = await Auth.api('GET', `/leads/${lead.id}/produtos`);
      const prods = (rProd?.data?.dados || rProd?.data || []).filter(p => !p._removido);
      if (prods.length > 0) {
        linhasProd = prods.map(p => {
          const nome  = p.produto_nome || p.produto?.nome || 'Produto';
          const qtd   = Number(p.quantidade || 1);
          const vUnit = Number(p.valor_unitario || 0);
          const vTot  = Number(p.valor_total || (qtd * vUnit));
          totalGeral += vTot;
          return `  - ${nome}\n    Qtd: ${qtd}  |  Unit: ${fmtMoney(vUnit)}  |  Total: ${fmtMoney(vTot)}`;
        });
        linhasProd.push(`\n  TOTAL GERAL: ${fmtMoney(totalGeral)}`);
      }
    } catch(e) {}

    const obs        = document.getElementById('ca-obs')?.value?.trim() || '';
    const usuario    = window._usuarioAtual?.nome || lead.responsavel_nome || 'Usuario CRM';
    const agora      = new Date().toLocaleString('pt-BR');
    const sep        = '='.repeat(54);
    const linha      = '-'.repeat(54);

    return [
      sep,
      'NOVA VENDA - LANCAMENTO NO CONTA AZUL',
      `Preparado por: ${usuario}  |  ${agora}`,
      sep, '',
      linha + ' DADOS DO CLIENTE',
      `Nome:                 ${ni(lead.nome)}`,
      `Empresa:              ${ni(lead.empresa)}`,
      `CPF / CNPJ:           ${ni(lead.cnpj)}`,
      `Telefone:             ${ni(lead.telefone)}`,
      `WhatsApp:             ${ni(lead.whatsapp || lead.telefone)}`,
      `E-mail:               ${ni(lead.email)}`, '',
      linha + ' DADOS DA VENDA',
      `Vendedor:             ${ni(lead.responsavel_nome)}`,
      `Funil de origem:      ${ni(lead.funil_nome)}`,
      `Etapa atual:          ${ni(lead.etapa_nome || lead.etapa)}`,
      `Data da venda:        ${fmtDate(lead.data_fechamento || lead.ganho_em)}`,
      `Valor da venda:       ${fmtMoney(lead.valor_venda || lead.valor)}`,
      `Forma de pagamento:   ${ni(lead.forma_pagamento)}`,
      `Prev. prox. compra:   ${ni(lead.previsao_proxima_compra)}`,
      `Observacoes comerc.:  ${ni(lead.observacoes)}`, '',
      linha + ' PRODUTOS',
      ...linhasProd, '',
      linha + ' ENDERECO DE ENTREGA',
      `CEP:                  ${ni(lead.cep_entrega)}`,
      `Endereco:             ${ni([lead.endereco_entrega, lead.numero_entrega].filter(Boolean).join(', '))}`,
      `Complemento:          ${ni(lead.complemento_entrega)}`,
      `Referencia:           ${ni(lead.referencia_entrega)}`,
      `Bairro:               ${ni(lead.bairro_entrega)}`,
      `Cidade / UF:          ${ni([lead.cidade_entrega, lead.uf_entrega].filter(Boolean).join(' / '))}`, '',
      linha + ' DADOS DE PRODUCAO',
      `Solic. orcamento:     ${fmtDate(lead.data_solicitacao_orcamento)}`,
      `Envio orcamento:      ${fmtDate(lead.data_envio_orcamento)}`,
      `Aprov. orcamento:     ${fmtDate(lead.data_aprovacao_orcamento)}`,
      `Layout virtual apr.:  ${fmtDate(lead.layout_virtual_aprovado_em)}`,
      `Envio de amostra:     ${fmtDate(lead.data_envio_amostra)}`,
      `Aprov. de amostra:    ${fmtDate(lead.data_aprovacao_amostra)}`,
      `Data de entrega:      ${fmtDate(lead.data_entrega)}`,
      `Obs. de producao:     ${ni(lead.obs_producao || lead.observacoes_producao)}`, '',
      linha + ' CONTA AZUL',
      `Obs. adicional:       ${obs || 'Nao informado'}`,
      `Preparado por:        ${usuario}`,
      `Data/hora:            ${agora}`,
      sep,
    ].join('\n');
  }

  // ── OPÇÃO A: Abre Gmail na web (nova aba) já preenchido ───────────────────
  // Usa URL do Gmail: mail.google.com/mail/?view=cm&to=...&su=...&body=...
  // Usuário só clica "Enviar" no Gmail. Sem senha, sem configuração.
  async function _abrirGmail(lead) {
    const btnEl  = document.getElementById('ca-btn-gmail');
    const txtEl  = document.getElementById('ca-btn-gmail-txt');
    if (btnEl) btnEl.disabled = true;
    if (txtEl) txtEl.textContent = 'Preparando...';

    try {
      const corpo   = await _montarCorpo(lead);
      const assunto = document.getElementById('ca-assunto')?.value?.trim()
        || (lead.empresa
          ? `Nova venda - Conta Azul: ${lead.empresa} / ${lead.nome}`
          : `Nova venda - Conta Azul: ${lead.nome}`);

      // Gmail compose URL — abre Gmail na web já preenchido
      const params = new URLSearchParams({
        view: 'cm',
        to:   DESTINATARIOS.join(','),
        su:   assunto,
        body: corpo,
      });
      const url = `https://mail.google.com/mail/u/0/?${params.toString()}`;

      window.open(url, '_blank');
      if (typeof Toast !== 'undefined')
        Toast.show('Gmail aberto com a ficha preenchida. Clique "Enviar" no Gmail para concluir.', 'success');

    } catch(e) {
      console.error('[ContaAzul] abrirGmail:', e);
      if (typeof Toast !== 'undefined') Toast.show('Erro ao abrir Gmail. Tente "Baixar ficha".', 'error');
    } finally {
      if (btnEl) btnEl.disabled = false;
      if (txtEl) txtEl.textContent = 'Abrir Gmail para enviar';
    }
  }

  // ── OPÇÃO B: Baixa ficha como arquivo .txt ────────────────────────────────
  // Gera arquivo com todos os dados da venda e dispara download no navegador.
  // Sem servidor, sem senha, sem configuração. Usuário baixa e anexa ao email.
  async function _baixarFicha(lead) {
    const btnEl  = document.getElementById('ca-btn-baixar');
    if (btnEl) btnEl.disabled = true;
    try {
      const corpo = await _montarCorpo(lead);
      const nomeArq = `conta-azul-${(lead.empresa || lead.nome || 'venda').replace(/[^a-zA-Z0-9]/g,'-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.txt`;

      const blob = new Blob([corpo], { type: 'text/plain;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = nomeArq;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);

      if (typeof Toast !== 'undefined')
        Toast.show(`Ficha baixada: ${nomeArq}`, 'success');
    } catch(e) {
      console.error('[ContaAzul] baixarFicha:', e);
      if (typeof Toast !== 'undefined') Toast.show('Erro ao gerar arquivo.', 'error');
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  }

  // ── Copiar para clipboard ─────────────────────────────────────────────────
  async function _copiarConteudo(lead) {
    const btn = document.getElementById('ca-btn-copiar');
    try {
      const corpo = await _montarCorpo(lead);
      await navigator.clipboard.writeText(corpo);
      if (typeof Toast !== 'undefined')
        Toast.show('Conteudo copiado. Cole no seu e-mail para enviar.', 'success');
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '✅ Copiado!';
        setTimeout(() => { btn.innerHTML = orig; }, 2500);
      }
    } catch(e) {
      if (typeof Toast !== 'undefined') Toast.show('Erro ao copiar. Selecione o texto no preview manualmente.', 'error');
    }
  }

  // ── Marcar como enviado manualmente ─────────────────────────────────────
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
        if (el) { el.textContent = `✅ Marcado como enviado por ${nome} em ${agora}.`; el.style.display = ''; }
        _atualizarStatusBar('enviado', { conta_azul_enviado_em: new Date().toISOString(), conta_azul_enviado_por: nome });
        _carregarHistorico(leadId);
        if (typeof Toast !== 'undefined') Toast.show('Envio registrado manualmente!', 'success');
      } else {
        if (typeof Toast !== 'undefined') Toast.show(r?.data?.erro || 'Erro ao registrar.', 'error');
      }
    } catch(e) {
      if (typeof Toast !== 'undefined') Toast.show('Erro ao registrar envio manual.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── Preview no card ──────────────────────────────────────────────────────
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
    } catch(e) {}

    el.textContent = [
      '=== DADOS DO CLIENTE ===',
      `Cliente:      ${lead.nome || '—'}`,
      `Empresa:      ${lead.empresa || '—'}`,
      `Telefone:     ${lead.telefone || '—'}`,
      `E-mail:       ${lead.email || '—'}`,
      `CNPJ/CPF:     ${lead.cnpj || '—'}`,
      '',
      '=== DADOS DA VENDA ===',
      `Vendedor:     ${lead.responsavel_nome || '—'}`,
      `Funil:        ${lead.funil_nome || '—'}`,
      `Data:         ${fmtDate(lead.data_fechamento)}`,
      `Valor:        ${fmtMoney(lead.valor_venda || lead.valor)}`,
      `Forma pagto:  ${lead.forma_pagamento || '—'}`,
      '',
      '=== PRODUTOS ===',
      produtosTexto,
      '',
      '=== ENDERECO ===',
      `CEP:          ${lead.cep_entrega || '—'}`,
      `${[lead.endereco_entrega, lead.numero_entrega].filter(Boolean).join(', ') || '—'}`,
      `${lead.bairro_entrega || ''} ${lead.cidade_entrega || ''} ${lead.uf_entrega ? '/ ' + lead.uf_entrega : ''}`.trim() || '—',
    ].join('\n');
  }

  // ── Destinatários fixos ──────────────────────────────────────────────────
  function _renderDestinatariosFixos() {
    const el = document.getElementById('ca-destinatarios');
    if (!el) return;
    el.innerHTML = DESTINATARIOS.map(email =>
      `<span style="display:inline-flex;align-items:center;margin:2px 4px 2px 0;padding:2px 8px;` +
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
        const label = h.status === 'manual' ? 'Marcado como enviado' : (ok ? 'Enviado' : 'Erro');
        const cor   = ok ? 'var(--green)' : 'var(--error)';
        return `<div style="padding:8px 10px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:7px">` +
          `<div style="display:flex;justify-content:space-between;margin-bottom:3px">` +
          `<span style="font-weight:600;color:${cor}">${ok ? '✅' : '❌'} ${label}</span>` +
          `<span style="color:var(--text-muted)">${dt}</span></div>` +
          `<div style="color:var(--text-secondary)">Por: ${escHtml(h.usuario_nome || '—')}</div>` +
          `${h.erro ? `<div style="color:var(--error);font-size:.7rem;margin-top:2px">Erro: ${escHtml(h.erro)}</div>` : ''}` +
          `</div>`;
      }).join('');
    } catch(e) { el.textContent = 'Erro ao carregar historico.'; }
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
      if (status === 'erro' && lead?.conta_azul_ultimo_erro) t += ` — ${lead.conta_azul_ultimo_erro}`;
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
