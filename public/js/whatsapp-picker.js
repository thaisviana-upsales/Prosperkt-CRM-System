/**
 * PROSPERKT CRM — whatsapp-picker.js
 * Picker de Mensagens Padrão para uso dentro da conversa WhatsApp
 * Depende de: auth.js, toast.js, whatsapp.js (para _convAtiva e _usuario)
 */
(function () {
  let _msgs      = [];
  let _cats      = [];
  let _catAtiva  = '';
  let _buscaVal  = '';
  let _carregado = false;
  let _buscaTimer;

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function substituirVars(texto) {
    // Pega contexto da conversa ativa via globals do whatsapp.js
    const conv = (typeof _convAtiva !== 'undefined') ? _convAtiva : {};
    const user = (typeof _usuario  !== 'undefined') ? _usuario  : {};
    return (texto || '')
      .replace(/\[nome_lead\]/gi,     conv.nome_contato || conv.lead_nome || 'Lead')
      .replace(/\[nome_vendedor\]/gi, user.nome || 'Vendedor')
      .replace(/\[nome_empresa\]/gi,  conv.lead_empresa || 'Empresa')
      .replace(/\[telefone_lead\]/gi, conv.telefone     || '')
      .replace(/\[funil\]/gi,         conv.funil_nome   || '')
      .replace(/\[etapa\]/gi,         conv.etapa_nome   || '')
      .replace(/\[empresa\]/gi,       conv.lead_empresa || 'Empresa');
  }

  // ── API ──────────────────────────────────────────────────────────────────────
  async function carregarDados() {
    if (_carregado) { renderPicker(); return; }
    const [rCats, rMsgs] = await Promise.all([
      Auth.api('GET', '/mensagens-padrao/categorias'),
      Auth.api('GET', '/mensagens-padrao?ativo=1'),
    ]);
    _cats = rCats?.data?.dados || [];
    _msgs = rMsgs?.data?.dados || [];
    _carregado = true;
    renderCatFilters();
    renderPicker();
  }

  async function buscar() {
    const params = new URLSearchParams({ ativo: 1 });
    if (_catAtiva)  params.set('categoria', _catAtiva);
    if (_buscaVal)  params.set('busca', _buscaVal);
    const r = await Auth.api('GET', `/mensagens-padrao?${params}`);
    _msgs = r?.data?.dados || [];
    renderPicker();
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function renderCatFilters() {
    const el = document.getElementById('picker-filters');
    if (!el) return;
    el.innerHTML = `<button class="picker-filter ${_catAtiva===''?'active':''}" data-cat="">Todas</button>` +
      _cats.map(c => `<button class="picker-filter ${_catAtiva===c?'active':''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    el.querySelectorAll('.picker-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        _catAtiva = btn.dataset.cat;
        el.querySelectorAll('.picker-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        buscar();
      });
    });
  }

  function renderPicker() {
    const el = document.getElementById('picker-list');
    if (!el) return;

    if (!_msgs.length) {
      el.innerHTML = `
        <div style="text-align:center;padding:50px 20px;color:var(--text-muted)">
          <div style="font-size:2.5rem;opacity:.2;margin-bottom:12px">📋</div>
          <div style="font-size:.9rem;font-weight:700;margin-bottom:6px">Nenhum script encontrado</div>
          <div style="font-size:.78rem">
            ${_catAtiva||_buscaVal ? 'Tente outro filtro ou busca.' : 'Cadastre mensagens padrão em Configurações → Mensagens Padrão.'}
          </div>
          <a href="/mensagens-padrao.html" style="margin-top:16px;display:inline-block;font-size:.78rem;color:var(--green)">Ir para Mensagens Padrão →</a>
        </div>`;
      return;
    }

    el.innerHTML = _msgs.map(m => {
      const textoSubst = substituirVars(m.texto);
      const preview = textoSubst.slice(0, 120);
      return `
      <div class="picker-item" data-id="${m.id}">
        <div class="picker-item-body">
          <div class="picker-item-titulo">${esc(m.titulo)}</div>
          <span class="picker-item-cat">${esc(m.categoria)}</span>
          <div class="picker-item-preview">${esc(preview)}${preview.length < textoSubst.length ? '…' : ''}</div>
        </div>
        <button class="picker-usar-btn" data-id="${m.id}" data-texto="${esc(textoSubst)}">
          Usar
        </button>
      </div>`;
    }).join('');

    el.querySelectorAll('.picker-usar-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        usarMensagem(btn.dataset.id, btn.dataset.texto);
      });
    });
    // Clicar no card inteiro também usa
    el.querySelectorAll('.picker-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.classList.contains('picker-usar-btn')) return;
        const btn = item.querySelector('.picker-usar-btn');
        if (btn) usarMensagem(btn.dataset.id, btn.dataset.texto);
      });
    });
  }

  // ── Usar mensagem ────────────────────────────────────────────────────────────
  function usarMensagem(id, textoSubstituido) {
    const ta = document.getElementById('msg-input');
    if (!ta) { Toast.show('Campo de mensagem não encontrado.', 'error'); return; }

    // Insere no campo de digitação (já com variáveis substituídas)
    ta.value = textoSubstituido;

    // Dispara evento input para atualizar botão de envio
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    // Auto-resize do textarea
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';

    fecharPicker();
    ta.focus();

    // Posiciona cursor no final
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    }, 50);

    Toast.show('Script inserido! Edite e envie quando quiser.', 'success');
  }

  // ── Abrir/Fechar ─────────────────────────────────────────────────────────────
  function abrirPicker() {
    document.getElementById('picker-ov')?.classList.add('open');
    document.getElementById('picker-busca').value = '';
    _buscaVal = '';
    carregarDados();
    setTimeout(() => document.getElementById('picker-busca')?.focus(), 100);
  }

  function fecharPicker() {
    document.getElementById('picker-ov')?.classList.remove('open');
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    // Botão "Scripts" na barra de input
    const btnScript = document.getElementById('btn-script');
    if (btnScript) {
      btnScript.addEventListener('click', abrirPicker);
    }

    // Fechar picker
    document.getElementById('picker-close')?.addEventListener('click', fecharPicker);
    document.getElementById('picker-ov')?.addEventListener('click', e => {
      if (e.target === document.getElementById('picker-ov')) fecharPicker();
    });

    // Busca com debounce
    document.getElementById('picker-busca')?.addEventListener('input', e => {
      clearTimeout(_buscaTimer);
      _buscaVal = e.target.value.trim();
      if (_carregado) {
        _buscaTimer = setTimeout(buscar, 300);
      }
    });

    // Escape fecha o picker
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') fecharPicker();
    });
  }

  // Inicializa quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
