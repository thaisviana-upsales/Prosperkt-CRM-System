/**
 * PROSPEKT CRM — Conta Azul (Frontend)
 * Aba "Conta Azul" no card/modal do lead.
 * Renderiza ficha, carrega destinatários, envia e-mail via backend.
 */

const ContaAzul = (() => {
  // ── Configurações de status ────────────────────────────────────────────────
  const STATUS_CFG = {
    nao_aplicavel: { icon: '💳', label: 'Conta Azul — Não aplicável', sub: 'Lead ainda não é uma venda.',          bar: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.07)' },
    pendente:      { icon: '⏳', label: 'Conta Azul Pendente',         sub: 'Ficha pronta. Ainda não foi enviada.', bar: 'rgba(245,166,35,0.08)', border: 'rgba(245,166,35,0.3)' },
    enviado:       { icon: '✅', label: 'Conta Azul Enviado',           sub: 'Ficha enviada com sucesso.',           bar: 'rgba(91,222,62,0.08)',  border: 'rgba(91,222,62,0.3)' },
    erro:          { icon: '❌', label: 'Conta Azul — Erro no envio',  sub: 'Houve falha no envio. Tente novamente.', bar: 'rgba(255,59,92,0.08)', border: 'rgba(255,59,92,0.3)' },
  };

  // ── Renderiza a aba Conta Azul ─────────────────────────────────────────────
  async function renderTab(lead) {
    if (!lead) return;

    const isVenda = ['GANHO','VENDIDO','VENDA'].includes((lead.status || '').toUpperCase());
    const caStatus = lead.conta_azul_status || (isVenda ? 'pendente' : 'nao_aplicavel');

    // Status bar
    _atualizarStatusBar(caStatus, lead);

    // Mostra bloco certo
    const naoVenda = document.getElementById('ca-nao-venda');
    const vendaContent = document.getElementById('ca-venda-content');
    if (!isVenda) {
      if (naoVenda) naoVenda.style.display = '';
      if (vendaContent) vendaContent.style.display = 'none';
      return;
    }
    if (naoVenda) naoVenda.style.display = 'none';
    if (vendaContent) vendaContent.style.display = '';

    // Assunto automático
    const fmtDate = d => d ? new Date(d).toLocaleDateString('pt-BR') : '';
    const assuntoAuto = `Cadastro Conta Azul — ${lead.empresa || lead.nome || 'Cliente'} — Venda ${fmtDate(lead.data_fechamento || lead.atualizado_em)}`;
    const assuntoEl = document.getElementById('ca-assunto');
    if (assuntoEl && !assuntoEl.value) assuntoEl.value = assuntoAuto;

    // Preview de texto
    _renderPreview(lead);

    // Destinatários e histórico em paralelo
    _carregarDestinatarios();
    _carregarHistorico(lead.id);

    // Botão enviar
    const btn = document.getElementById('ca-btn-enviar');
    if (btn) {
      btn.onclick = null;
      btn.onclick = () => _enviar(lead.id);
    }
  }

  // ── Status bar (inline na aba e card da pipeline) ─────────────────────────
  function _atualizarStatusBar(status, lead) {
    const cfg = STATUS_CFG[status] || STATUS_CFG.nao_aplicavel;
    const bar = document.getElementById('ca-status-bar');
    if (bar) {
      bar.style.background = cfg.bar;
      bar.style.border     = `1px solid ${cfg.border}`;
    }
    const icon = document.getElementById('ca-status-icon');
    if (icon) icon.textContent = cfg.icon;
    const label = document.getElementById('ca-status-label');
    if (label) label.textContent = cfg.label;
    const sub = document.getElementById('ca-status-sub');
    if (sub) {
      let subText = cfg.sub;
      if (status === 'enviado' && lead?.conta_azul_enviado_em) {
        subText += ` Em: ${new Date(lead.conta_azul_enviado_em).toLocaleString('pt-BR')}`;
        if (lead.conta_azul_enviado_por) subText += ` por ${lead.conta_azul_enviado_por}`;
      }
      if (status === 'erro' && lead?.conta_azul_ultimo_erro) {
        subText += ` Erro: ${lead.conta_azul_ultimo_erro}`;
      }
      sub.textContent = subText;
    }

    // Atualiza o mini-badge no header do card Pipeline (se existir)
    _atualizarBadgeCard(status);
  }

  // ── Mini badge no card da Pipeline (opcional) ─────────────────────────────
  function _atualizarBadgeCard(status) {
    const headerBadge = document.getElementById('ml-ca-badge');
    if (!headerBadge) return;
    const cfg = STATUS_CFG[status] || STATUS_CFG.nao_aplicavel;
    headerBadge.textContent = cfg.icon + ' ' + cfg.label;
    headerBadge.style.display = status === 'nao_aplicavel' ? 'none' : '';
    headerBadge.style.borderColor = cfg.border;
    headerBadge.style.background  = cfg.bar;
  }

  // ── Preview de texto da ficha ─────────────────────────────────────────────
  function _renderPreview(lead) {
    const el = document.getElementById('ca-preview');
    if (!el) return;
    const fmtMoney = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtDate  = d => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

    el.textContent = [
      '=== DADOS DO CLIENTE ===',
      `Cliente:       ${lead.nome || '—'}`,
      `Empresa:       ${lead.empresa || '—'}`,
      `Telefone:      ${lead.telefone || '—'}`,
      `E-mail:        ${lead.email || '—'}`,
      '',
      '=== DADOS DA VENDA ===',
      `Vendedor:      ${lead.responsavel_nome || '—'}`,
      `Data fecham.:  ${fmtDate(lead.data_fechamento)}`,
      `Valor total:   ${fmtMoney(lead.valor_venda || lead.valor)}`,
      `Forma pagto:   ${lead.forma_pagamento || '—'}`,
      '',
      '=== ENDEREÇO DE ENTREGA ===',
      `CEP:           ${lead.cep_entrega || '—'}`,
      `Endereço:      ${[lead.endereco_entrega, lead.numero_entrega].filter(Boolean).join(', ') || '—'}`,
      `Complemento:   ${lead.complemento_entrega || '—'}`,
      `Bairro:        ${lead.bairro_entrega || '—'}`,
      `Cidade / UF:   ${[lead.cidade_entrega, lead.uf_entrega].filter(Boolean).join(' / ') || '—'}`,
    ].join('\n');
  }

  // ── Carrega destinatários ──────────────────────────────────────────────────
  async function _carregarDestinatarios() {
    const el = document.getElementById('ca-destinatarios');
    if (!el) return;
    try {
      const r = await Auth.api('GET', '/conta-azul/destinatarios');
      const dest = r?.data?.dados || [];
      if (!dest.length) {
        el.textContent = '⚠ Nenhum destinatário cadastrado. Adicione na tabela config_email_conta_azul.';
        el.style.color = 'var(--warning)';
        return;
      }
      el.innerHTML = dest.map(d =>
        `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 4px 2px 0;padding:2px 8px;background:rgba(91,222,62,0.08);border:1px solid rgba(91,222,62,0.2);border-radius:20px;font-size:.72rem">` +
        `<strong style="color:var(--text-primary)">${escHtml(d.nome)}</strong>` +
        `<span style="color:var(--text-muted)">&lt;${escHtml(d.email)}&gt;</span></span>`
      ).join('');
    } catch (e) {
      el.textContent = 'Não foi possível carregar os destinatários.';
      console.warn('[ContaAzul] destinatários:', e);
    }
  }

  // ── Carrega histórico de envios ────────────────────────────────────────────
  async function _carregarHistorico(leadId) {
    const el = document.getElementById('ca-historico');
    if (!el) return;
    try {
      const r = await Auth.api('GET', `/conta-azul/historico/${leadId}`);
      const itens = r?.data?.dados || [];
      if (!itens.length) {
        el.textContent = 'Nenhum envio registrado.';
        return;
      }
      el.innerHTML = itens.map(h => {
        const dt   = new Date(h.enviado_em).toLocaleString('pt-BR');
        const oks  = h.status === 'enviado';
        const dest = (() => { try { const d = JSON.parse(h.destinatarios_json || '[]'); return Array.isArray(d) ? d.map(x => x.email).join(', ') : ''; } catch(e) { return ''; } })();
        return `<div style="padding:8px 10px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:7px">` +
          `<div style="display:flex;justify-content:space-between;margin-bottom:3px">` +
          `<span style="font-weight:600;color:${oks?'var(--green)':'var(--error)'}">${oks?'✅ Enviado':'❌ Erro'}</span>` +
          `<span style="color:var(--text-muted)">${dt}</span></div>` +
          `<div style="color:var(--text-secondary)">Por: ${escHtml(h.usuario_nome||'—')}</div>` +
          `${dest?`<div style="color:var(--text-muted);font-size:.7rem;margin-top:2px">Para: ${escHtml(dest)}</div>`:''}` +
          `${h.erro?`<div style="color:var(--error);font-size:.7rem;margin-top:2px">Erro: ${escHtml(h.erro)}</div>`:''}` +
          `</div>`;
      }).join('');
    } catch (e) {
      el.textContent = 'Erro ao carregar histórico.';
      console.warn('[ContaAzul] histórico:', e);
    }
  }

  // ── Enviar ficha ──────────────────────────────────────────────────────────
  async function _enviar(leadId) {
    const btn  = document.getElementById('ca-btn-enviar');
    const txt  = document.getElementById('ca-btn-txt');
    const spin = document.getElementById('ca-spinner');
    const obs  = document.getElementById('ca-obs')?.value?.trim() || '';
    const assunto = document.getElementById('ca-assunto')?.value?.trim() || '';

    if (btn) btn.disabled = true;
    if (txt) txt.textContent = 'Enviando...';
    if (spin) spin.classList.remove('hidden');

    try {
      const r = await Auth.api('POST', `/conta-azul/enviar/${leadId}`, {
        observacao_adicional: obs,
        assunto_override: assunto,
      });

      if (r?.ok) {
        if (typeof Toast !== 'undefined') Toast.show('Ficha Conta Azul enviada com sucesso! 🎉', 'success');
        _atualizarStatusBar('enviado', { conta_azul_enviado_em: new Date().toISOString(), conta_azul_enviado_por: '' });
        _carregarHistorico(leadId);
      } else {
        const erro = r?.data?.erro || 'Não foi possível enviar a ficha Conta Azul. Verifique os dados e a configuração de e-mail.';
        if (typeof Toast !== 'undefined') Toast.show(erro, 'error');
        _atualizarStatusBar('erro', { conta_azul_ultimo_erro: erro });
      }
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.show('Erro inesperado ao enviar.', 'error');
      console.error('[ContaAzul] enviar:', e);
    } finally {
      if (btn) btn.disabled = false;
      if (txt) txt.textContent = 'Enviar para Conta Azul';
      if (spin) spin.classList.add('hidden');
    }
  }

  // ── Helper escapeHtml ─────────────────────────────────────────────────────
  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // API pública
  return { renderTab };
})();

// Expõe globalmente para pipeline.js chamar
window.ContaAzul = ContaAzul;
