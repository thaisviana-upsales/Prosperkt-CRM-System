/**
 * PROSPEKT CRM — Pipeline JS
 * Kanban, filtros, modal de lead
 * ARQUITETURA: funis → pipelines (funil_id) → etapas (pipeline_id)
 */

let _funis=[], _etapas=[], _leads=[], _usuarios=[], _usuario=null;
let _funilAtivo=null, _pipelineAtivo=null;
let _dragLeadId=null, _dragEtapaOrigem=null;
let _motivosPerda=[], _produtos=[];
// Estado de filtros
let _filtros = { funil:'', resp:'', dataTipo:'', dataPeriodo:'', dataInicio:'', dataFim:'', busca:'' };
// Mapa nome→[ids] para agrupar leads no modo "Todos"
let _nomeParaIds = {};
// Callback de motivo de perda pendente
let _pendingMoverCallback = null;
// Parcelas em edição
let _parcelas = [];
// Lead original aberto no modal (para fallback de etapa/funil/pipeline)
let _leadEmEdicao = null;
// Produtos da venda (multi-produto)
let _leadProdutos = []; // itens persistidos no banco (com id)
let _leadProdutosNovas = []; // linhas ainda não salvas no banco
let _leadIdAberto = null; // id do lead cujo modal está aberto

// ── Indicador de carregamento discreto ───────────────────────────────────────
// Não trava a tela; apenas mostra feedback visual enquanto fetches estão em curso
let _loadingCount = 0;
function _setLoadingState(on) {
  _loadingCount = Math.max(0, _loadingCount + (on ? 1 : -1));
  const isLoading = _loadingCount > 0;
  // Barra de status discreta no topo da pipeline
  let bar = document.getElementById('_crm-loading-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = '_crm-loading-bar';
    bar.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:2px;background:var(--green,#6CFF4E);z-index:9999;transition:opacity .3s;pointer-events:none;';
    document.body.appendChild(bar);
  }
  bar.style.opacity = isLoading ? '1' : '0';
  // Spinner no botão "Aplicar" se existir
  const btnAplicar = document.getElementById('btn-aplicar');
  if (btnAplicar) {
    btnAplicar.style.opacity = isLoading ? '.6' : '1';
    btnAplicar.style.cursor  = isLoading ? 'wait' : '';
  }
}



// ── Init ──────────────────────────────────────────────────────
async function init() {
  _usuario = await Sidebar.init('pipeline');
  if (!_usuario) return;
  await Promise.all([carregarFunis(), carregarUsuarios(), carregarMotivos(), carregarProdutos()]);

  const params = new URLSearchParams(location.search);
  const paramFunil = params.get('funil_id');
  if (paramFunil && _funis.find(f=>f.id===paramFunil)) _filtros.funil = paramFunil;

  popularSelFunil();
  popularSelResp();
  document.getElementById('sel-funil').value = _filtros.funil;
  await aplicarFiltros();
  bindEvents();

  // Verifica alertas de recompra pendentes e notifica na Pipeline
  setTimeout(() => _verificarAlertasPipeline(), 1500);
}

async function _verificarAlertasPipeline() {
  try {
    const r = await Auth.api('GET', '/leads/alertas-recompra').catch(() => null);
    if (!r?.ok) return;
    const pendentes = (r.data?.dados || []).filter(a => !a.alerta_recompra_enviado);
    if (!pendentes.length) return;

    const hoje = new Date().toISOString().slice(0,10);
    const vencidos = pendentes.filter(a => a.alerta_recompra_em && a.alerta_recompra_em < hoje);
    const msg = vencidos.length > 0
      ? '⚠️ ' + vencidos.length + ' alerta(s) de recompra vencido(s)!' + (pendentes.length > vencidos.length ? ' + ' + (pendentes.length - vencidos.length) + ' próximo(s).' : '')
      : '🔔 ' + pendentes.length + ' alerta(s) de recompra nos próximos 7 dias.';

    let banner = document.getElementById('banner-alertas-recompra');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'banner-alertas-recompra';
      banner.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9000;background:linear-gradient(135deg,#b87d00,#F5A623);color:#000;padding:10px 16px;border-radius:12px;font-size:.78rem;font-weight:700;max-width:320px;cursor:pointer;box-shadow:0 4px 24px rgba(245,166,35,.35);display:flex;align-items:center;gap:10px';
      document.body.appendChild(banner);
    }
    banner.innerHTML = '';
    const spanMsg = document.createElement('span');
    spanMsg.textContent = msg;
    const btnVer = document.createElement('button');
    btnVer.textContent = 'Ver →';
    btnVer.style.cssText = 'background:#000;color:#F5A623;border:none;border-radius:8px;padding:4px 10px;font-size:.7rem;font-weight:700;cursor:pointer;white-space:nowrap';
    btnVer.onclick = () => window.open('/dashboard.html', '_self');
    const btnX = document.createElement('button');
    btnX.textContent = '✕';
    btnX.style.cssText = 'background:none;border:none;color:#000;font-size:1rem;cursor:pointer;line-height:1';
    btnX.onclick = () => banner.remove();
    banner.append(spanMsg, btnVer, btnX);

    setTimeout(() => { const b = document.getElementById('banner-alertas-recompra'); if(b) {b.style.transition='opacity .4s'; b.style.opacity='0'; setTimeout(()=>b?.remove(),400);} }, 12000);
  } catch(e) { /* silencioso */ }
}

async function carregarFunis() {
  const r = await Auth.api('GET','/funis?somente_ativos=true');
  _funis = r?.data?.dados || [];
}

async function carregarUsuarios() {
  console.log('[FILTRO_VENDEDOR_LOAD_START] pipeline | carregando lista de vendedores...');

  // Helper: aplica filtro ativo + role VENDEDOR/SUPER_ADMIN
  function filtrarVendedoresValidos(lista, origem) {
    const ROLES_OK = ['VENDEDOR', 'SUPER_ADMIN', 'vendedor', 'super_admin'];
    const validos = [];
    const descartados = [];
    (lista || []).forEach(u => {
      const isAtivo = u.ativo === true || u.ativo === 1 || u.ativo === '1' || u.ativo === 'true';
      const roleOk  = ROLES_OK.includes(u.role);
      if (isAtivo && roleOk) validos.push(u);
      else descartados.push({ nome: u.nome, role: u.role, ativo: u.ativo, motivo: !isAtivo ? 'inativo' : 'role inválida' });
    });
    console.log('[FILTRO_VENDEDOR_USUARIOS_TOTAL_API]', origem, '| recebidos:', (lista||[]).length);
    console.log('[FILTRO_VENDEDOR_USUARIOS_ATIVOS_TOTAL]', validos.length, 'válidos após filtro');
    if (descartados.length > 0)
      console.log('[FILTRO_VENDEDOR_USUARIO_DESCARTADO_INATIVO]', JSON.stringify(descartados));
    return validos;
  }

  const r = await Auth.api('GET','/usuarios');
  const raw1 = r?.data?.dados || [];
  _usuarios = filtrarVendedoresValidos(raw1, '/usuarios');

  if (_usuarios.length === 0) {
    console.warn('[FILTRO_VENDEDOR_LOAD_START] pipeline | /usuarios sem resultado — tentando /usuarios/responsaveis...');
    const r2 = await Auth.api('GET', '/usuarios/responsaveis');
    const raw2 = r2?.data?.dados || [];
    _usuarios = filtrarVendedoresValidos(raw2, '/usuarios/responsaveis');
  }

  console.log('[FILTRO_VENDEDOR_USUARIOS_RENDERIZADOS] pipeline |', _usuarios.length, 'vendedores prontos para o select');
}

async function carregarMotivos() {
  const r = await Auth.api('GET','/motivos-perda');
  _motivosPerda = r?.data?.dados || [
    'Sem orçamento no momento','Não respondeu','Comprou com concorrente',
    'Preço fora da expectativa','Sem perfil','Lead duplicado',
    'Não tem interesse','Prazo incompatível','Outro'
  ];
}

async function carregarProdutos() {
  const r = await Auth.api('GET','/produtos');
  _produtos = r?.data?.dados || [];
}

// Helper compartilhado
function isCarteiraRecorrente(nome) {
  return /carteira\s*recorrente/i.test((nome||'').trim());
}

function popularSelFunil() {
  const sel = document.getElementById('sel-funil');
  const funisNovos    = _funis.filter(f => !isCarteiraRecorrente(f.nome));
  const funisCarteira = _funis.filter(f =>  isCarteiraRecorrente(f.nome));
  sel.innerHTML =
    '<option value="">Todos - Novos</option>' +
    funisNovos.map(f=>`<option value="${f.id}">${f.nome}</option>`).join('') +
    (funisCarteira.length ? '<option disabled>──────────────</option>' : '') +
    funisCarteira.map(f=>`<option value="${f.id}">${f.nome}</option>`).join('');
  sel.value = _filtros.funil;
}

function popularSelResp() {
  const sel = document.getElementById('sel-resp');
  if (_usuario.role === 'VENDEDOR') {
    sel.style.display = 'none';
    sel.closest('.filter-group').style.display = 'none';
    return;
  }
  sel.innerHTML = '<option value="">Todos</option>' +
    _usuarios.map(u=>`<option value="${u.id}">${u.nome}</option>`).join('');
  console.log('[FILTRO_VENDEDOR_TOTAL_RENDERIZADO] pipeline |', sel.options.length, 'opções no select (incluindo Todos)');
}

// ── Filtros ───────────────────────────────────────────────────
async function aplicarFiltros() {
  const funilId = _filtros.funil;
  _nomeParaIds = {};
  const t0 = performance.now();
  console.log('[CRM_FILTER_APPLY_START] funil:', funilId || 'todos-novos');

  // Feedback visual discreto imediato (não trava tela)
  _setLoadingState(true);

  if (funilId) {
    document.getElementById('page-title').textContent = `Pipeline — ${_funis.find(x=>x.id===funilId)?.nome||''}`;
    document.getElementById('page-sub').textContent = `Leads do funil ${_funis.find(x=>x.id===funilId)?.nome||''}`;

    // ── Paraleliza: busca etapas + leads simultaneamente ──────────────
    const [rd, rLeads] = await Promise.all([
      Auth.api('GET', `/funis/${funilId}`),
      Auth.api('GET', construirURL()),
    ]);

    if (rd?.ok) {
      _pipelineAtivo = rd.data.dados.pipeline_id;
      _etapas = rd.data.dados.etapas || [];
      _nomeParaIds = {};
      _etapas.forEach(e => { _nomeParaIds[e.nome] = [e.id]; });
    } else {
      console.warn('[pipeline] Não foi possível carregar etapas do funil', funilId);
      _pipelineAtivo = null;
      _etapas = [];
    }
    _leads = rLeads?.data?.dados || [];
  } else {
    document.getElementById('page-title').textContent = 'Pipeline — Todos os Funis (Novos)';
    document.getElementById('page-sub').textContent = 'Leads de novos funis comerciais (excluindo Carteira Recorrente)';
    _pipelineAtivo = null;

    // ── Paraleliza: busca etapas + leads simultaneamente ──────────────
    const [re, rLeads] = await Promise.all([
      Auth.api('GET', '/etapas'),
      Auth.api('GET', construirURL()),
    ]);
    const todasEtapas = re?.data?.dados || [];

    const seen = new Set();
    const etapasDedup = [];
    for (const e of todasEtapas.sort((a, b) => a.ordem - b.ordem)) {
      if (isCarteiraRecorrente(e.funil_nome || '')) continue;
      if (!_nomeParaIds[e.nome]) _nomeParaIds[e.nome] = [];
      _nomeParaIds[e.nome].push(e.id);
      if (!seen.has(e.nome)) { seen.add(e.nome); etapasDedup.push(e); }
    }
    _etapas = etapasDedup;
    _leads  = rLeads?.data?.dados || [];

    if (!_etapas.length) console.warn('[pipeline] Nenhuma etapa encontrada via /etapas');
  }

  _setLoadingState(false);
  renderKanban();
  const ms = Math.round(performance.now() - t0);
  console.log('[CRM_FILTER_API_SUCCESS] tempo:', ms, 'ms');
  console.log('[CRM_RENDER_DONE] etapas:', _etapas.length, '| leads:', _leads.length);
  if (window.Atividades) window.Atividades.iniciarLembretes();
}


async function carregarLeads() {
  const url = construirURL();
  _setLoadingState(true);
  const t0 = performance.now();
  const r = await Auth.api('GET', url);
  _leads = r?.data?.dados || [];
  _setLoadingState(false);
  renderKanban();
  console.log('[CRM_RENDER_DONE] leads:', _leads.length, '| tempo fetch:', Math.round(performance.now()-t0), 'ms');
}

function construirURL() {
  let url = '/leads?';
  const p = [];
  if (_filtros.funil)       p.push(`funil_id=${_filtros.funil}`);
  else                      p.push('excluir_carteira=true'); // "Todos - Novos"
  if (_filtros.resp)        p.push(`responsavel_id=${_filtros.resp}`);
  if (_filtros.busca)       p.push(`busca=${encodeURIComponent(_filtros.busca)}`);
  if (_filtros.dataTipo) {
    p.push(`data_tipo=${_filtros.dataTipo}`);
    if (_filtros.dataPeriodo)  p.push(`data_periodo=${_filtros.dataPeriodo}`);
    if (_filtros.dataInicio)   p.push(`data_inicio=${_filtros.dataInicio}`);
    if (_filtros.dataFim)      p.push(`data_fim=${_filtros.dataFim}`);
  }
  const fullUrl = url + p.join('&');
  console.log('[FILTRO_VENDEDOR_PAYLOAD_API] pipeline | URL:', fullUrl,
    '| vendedor_id:', _filtros.resp || '(todos)');
  return fullUrl;
}

// ── Kanban ────────────────────────────────────────────────────
// ── Formata nome da etapa para exibição visual (sem alterar o dado real) ─────
// Quando o funil for Carteira Recorrente e o nome começar com "Previsão Carteira",
// divide em duas linhas: "Previsão Carteira" / "faixa de tempo".
// Para todos os outros funis, retorna o nome como plain text.
function formatarNomeEtapa(nomeEtapa) {
  const funilAtivo = _funis.find(f => f.id === _filtros.funil);
  const ehCarteira = funilAtivo && isCarteiraRecorrente(funilAtivo.nome);
  if (ehCarteira && nomeEtapa.startsWith('Previsão Carteira ')) {
    const faixa = nomeEtapa.replace('Previsão Carteira ', '').trim();
    return `<span class="carteira-stage-title">
      <span class="carteira-stage-title-main">Previsão Carteira</span>
      <span class="carteira-stage-title-range">${faixa}</span>
    </span>`;
  }
  return `<span class="col-title-text">${nomeEtapa}</span>`;
}

function renderKanban() {
  const wrap = document.getElementById('kanban');
  wrap.innerHTML = '';

  if (!_etapas.length) {
    wrap.innerHTML = '<div style="color:var(--text-muted);padding:48px;text-align:center">Nenhuma etapa encontrada. Verifique se os funis possuém pipelines e etapas configuradas.</div>';
    return;
  }

  const modoTodos = !_filtros.funil; // no modo "Todos", mostra badge do funil no card

  _etapas.forEach(etapa => {
    // Em modo "Todos": agrupa leads de TODAS as etapas com o mesmo nome
    let leads;
    if (modoTodos && _nomeParaIds[etapa.nome]?.length > 1) {
      leads = _leads.filter(l => _nomeParaIds[etapa.nome].includes(l.etapa_id));
    } else {
      leads = _leads.filter(l => l.etapa_id === etapa.id);
    }
    // Leads sem etapa_id válida: não quebrar a tela
    const col = document.createElement('div');
    col.className = 'kanban-col';

    col.innerHTML = `
      <div class="col-header">
        <div class="col-dot" style="background:${etapa.cor}"></div>
        <span class="col-title">${formatarNomeEtapa(etapa.nome)}</span>
        <span class="col-count">${leads.length}</span>
      </div>
      <div class="col-body" data-etapa="${etapa.id}">
        ${leads.map(l=>renderCard(l, modoTodos)).join('')}
      </div>
      <button class="col-add" data-etapa="${etapa.id}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar lead
      </button>`;
    wrap.appendChild(col);

    const body = col.querySelector('.col-body');
    body.addEventListener('dragover', ev => { ev.preventDefault(); body.classList.add('drag-over'); });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', ev => { ev.preventDefault(); body.classList.remove('drag-over'); moverLead(etapa.id); });
    col.querySelector('.col-add').addEventListener('click', () => abrirNovoLead(etapa.id));
    body.querySelectorAll('.lead-card').forEach(card => {
      // Botão WhatsApp: captura o clique ANTES do card, evita abrir o modal
      const btnWa = card.querySelector('.btn-wa-nav');
      if (btnWa) {
        btnWa.addEventListener('click', (ev) => {
          ev.stopPropagation();   // impede card de abrir o modal
          ev.preventDefault();
          const leadId = btnWa.dataset.waLeadId;
          const tel    = btnWa.dataset.waTel;
          const nome   = btnWa.dataset.waNome || '';
          const urlDestino = `/whatsapp.html?lead_id=${encodeURIComponent(leadId)}&phone=${encodeURIComponent(tel)}&nome=${encodeURIComponent(nome)}`;
          console.log('ABRIR_WHATSAPP_DO_LEAD:', { leadId, telefoneNormalizado: tel, urlDestino });
          window.location.href = urlDestino;
        });
      }

      card.addEventListener('click', () => abrirLead(card.dataset.id));
      card.addEventListener('dragstart', ev => {
        _dragLeadId = card.dataset.id; _dragEtapaOrigem = etapa.id;
        card.classList.add('dragging'); ev.dataTransfer.effectAllowed='move';
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
  });
}

function renderCard(l, mostrarFunil) {
  const dataCriacao = l.criado_em
    ? new Date(l.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })
    : '';
  const telNorm = (() => { let t = (l.telefone||'').replace(/\D/g,''); if(t.length===10||t.length===11) t='55'+t; return t; })();
  const funilCor  = _funis.find(f => f.nome === l.funil_nome)?.cor || '#aaa';
  const funilNome = l.funil_nome || '';

  const waIcon = l.telefone ? `
    <button
      class="btn-wa-card btn-wa-nav"
      title="Abrir conversa WhatsApp"
      data-wa-lead-id="${l.id}"
      data-wa-tel="${telNorm}"
      data-wa-nome="${l.nome.replace(/"/g,'&quot;')}"
      style="background:none;border:none;padding:0 0 0 5px;cursor:pointer;display:inline-flex;align-items:center;flex-shrink:0;opacity:.7;transition:opacity .15s"
      onmouseover="this.style.opacity='1'"
      onmouseout="this.style.opacity='.7'"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5BDE3E" stroke-width="2.2">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
    </button>` : '';

  return `<div class="lead-card" draggable="true" data-id="${l.id}">
    <div style="display:flex;align-items:center;gap:0;margin-bottom:3px">
      <span style="font-size:.8rem;font-weight:700;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${l.nome}</span>
      ${waIcon}
    </div>
    ${dataCriacao ? `<div style="font-size:.6rem;color:var(--text-muted);margin-bottom:3px">${dataCriacao}</div>` : ''}
    ${funilNome ? `<div style="display:flex;align-items:center;gap:4px">
      <span style="width:5px;height:5px;border-radius:50%;background:${funilCor};flex-shrink:0"></span>
      <span style="font-size:.6rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${funilNome}</span>
    </div>` : ''}
  </div>`;
}



async function moverLead(etapaId) {
  if (!_dragLeadId || etapaId===_dragEtapaOrigem) return;
  const lead = _leads.find(l=>l.id===_dragLeadId);
  const pid  = lead?.pipeline_id || _pipelineAtivo;
  const etapaDest = _etapas.find(e=>e.id===etapaId);
  const isPerdido = etapaDest?.is_perdido || etapaDest?.probabilidade===0 ||
    etapaDest?.nome?.toLowerCase().includes('perdid') ||
    etapaDest?.nome?.toLowerCase().includes('desqualif');

  const isGanho = etapaDest?.is_ganho || etapaDest?.probabilidade>=100 ||
    /venda|vendas|ganho|fechad|fechamento/i.test(etapaDest?.nome||'');

  // ── Travamento Layout Virtual → Amostra Física ──────────────────────────────
  const isAmFisicaDest  = /amostra.?f/i.test(etapaDest?.nome||'');
  const etapaOrigemObj  = _etapas.find(e=>e.id===_dragEtapaOrigem);
  const vemDeLayoutVirt = /layout.?virtual/i.test(etapaOrigemObj?.nome||'');
  if (isAmFisicaDest && vemDeLayoutVirt && !lead?.layout_virtual_aprovado_em) {
    const leadIdLocal = _dragLeadId;
    _dragLeadId=null; _dragEtapaOrigem=null;
    Toast.show('Preencha a aprovação do Layout Virtual antes de mover para Amostra Física.','error');
    await abrirLead(leadIdLocal);
    showTab('venda');
    return;
  }

  if (isGanho) {
    const leadIdLocal = _dragLeadId;
    const pidLocal = pid;
    const leadObj = lead;
    _dragLeadId=null; _dragEtapaOrigem=null;
    if (!leadIdLocal) return;
    // Valida campos obrigatórios no frontend antes de chamar API
    const faltando=[];
    if (!leadObj?.email)        faltando.push('Email');
    if (!leadObj?.funil_id)     faltando.push('Funil');
    if (!(leadObj?.valor_venda>0)) faltando.push('Valor da Venda');
    if (!leadObj?.forma_pagamento) faltando.push('Forma de Pagamento');
    if (!leadObj?.produto_id && !leadObj?.produto_nome) faltando.push('Produto Adquirido');
    if (faltando.length) {
      Toast.show(`Para registrar a venda, preencha: ${faltando.join(', ')}.`,'error');
      await abrirLead(leadIdLocal);
      abrirSecaoComercial();
      return;
    }
    // Previsão obrigatória — abre modal se não preenchida
    if (!leadObj?.previsao_proxima_compra) {
      Toast.show('Para concluir a venda, informe a previsão de próxima compra deste cliente.','error');
      await abrirLead(leadIdLocal);
      showTab('venda');
      // Destaca o campo
      const prevEl = document.getElementById('fl-previsao-proxima-compra');
      if (prevEl) {
        prevEl.style.outline='2px solid var(--pink,#FF3B5C)';
        prevEl.scrollIntoView({ behavior:'smooth', block:'center' });
        setTimeout(() => { prevEl.style.outline=''; }, 3000);
      }
      return;
    }
    await _executarMover(leadIdLocal, etapaId, pidLocal, etapaDest, null);
    return;
  }


  if (isPerdido) {
    // Captura o ID e pid em variáveis locais ANTES de zerá-los,
    // pois o callback é executado de forma assíncrona (após confirmação no modal)
    // e _dragLeadId já estaria null nesse momento.
    const leadIdLocal = _dragLeadId;
    const pidLocal = pid;
    _dragLeadId=null; _dragEtapaOrigem=null;

    if (!leadIdLocal) {
      console.error('[moverLead] leadId está vazio ao tentar mover para etapa perdida.');
      return;
    }

    abrirModalMotivo((motivo) => {
      if (!motivo) { console.error('[moverLead] motivo_perda vazio ao confirmar.'); return; }
      _executarMover(leadIdLocal, etapaId, pidLocal, etapaDest, motivo);
    });
    return;
  }

  await _executarMover(_dragLeadId, etapaId, pid, etapaDest, null);
  _dragLeadId=null; _dragEtapaOrigem=null;
}

async function _executarMover(leadId, etapaId, pid, etapaDest, motivo) {
  const t0 = performance.now();
  console.log('[CRM_MOVE_CARD_START] lead:', leadId, '-> etapa:', etapaId);

  const isPerd = etapaDest?.is_perdido || etapaDest?.nome?.toLowerCase().includes('perdid') || etapaDest?.nome?.toLowerCase().includes('desqualif');
  const isGan  = etapaDest?.is_ganho  || etapaDest?.probabilidade >= 100;

  // ── ATUALIZAÇÃO OTIMISTA: move card no DOM imediatamente ─────────────────────
  // Salva posição original para rollback em caso de erro
  const leadIdx = _leads.findIndex(l => l.id === leadId);
  const leadOriginal = leadIdx >= 0 ? { ..._leads[leadIdx] } : null;
  const etapaOriginalId = leadOriginal?.etapa_id;

  if (leadIdx >= 0) {
    // Atualiza estado local imediatamente
    _leads[leadIdx] = { ..._leads[leadIdx], etapa_id: etapaId, pipeline_id: pid || _leads[leadIdx].pipeline_id };
    renderKanban(); // tela responde imediatamente
    console.log('[CRM_MOVE_CARD_UI_UPDATED] tempo DOM:', Math.round(performance.now()-t0), 'ms');
  }

  // ── Envia para backend em segundo plano ──────────────────────────────────────
  const payload = { etapa_id:etapaId, pipeline_id:pid };
  if (motivo) payload.motivo_perda = motivo;
  const r = await Auth.api('PATCH', `/leads/${leadId}/mover`, payload);
  console.log('[CRM_MOVE_CARD_API_SUCCESS] tempo total:', Math.round(performance.now()-t0), 'ms | ok:', r?.ok);

  if (r?.ok) {
    Toast.show(isGan?'🎉 Lead ganho!':isPerd?'Lead marcado como perdido.':'Lead movido!', isGan?'success':isPerd?'error':'success');
    // 🎉 Animação de celebração ao fechar venda
    if (isGan && typeof celebrarVenda === 'function') {
      const leadObj2 = _leads?.find?.(l => l.id === leadId);
      celebrarVenda(leadObj2?.nome || '', leadObj2?.valor_venda || 0);
    }
    if (window.Producao && etapaDest?.nome) {
      window.Producao.atualizarDatasEtapa(leadId, etapaDest.nome).catch(() => {});
    }
    // Reload silencioso em background para sincronizar dados do servidor
    // (status, ganho_em, campos atualizados pelo backend) sem travar a tela
    carregarLeads().catch(() => {});
  } else {
    // ── ROLLBACK: desfaz atualização otimista ────────────────────────────────
    Toast.show(r?.data?.erro||'Erro ao mover lead. Revertendo.','error');
    if (leadIdx >= 0 && leadOriginal) {
      _leads[leadIdx] = leadOriginal;
      renderKanban(); // restaura posição visual
    }
    console.warn('[CRM_MOVE_CARD_ROLLBACK] lead restaurado para etapa:', etapaOriginalId);
  }
}


function abrirModalMotivo(callback) {
  const sel = document.getElementById('motivo-perda-sel');
  sel.innerHTML = _motivosPerda.map(m=>{
    const v = m.nome||m; return `<option value="${v}">${v}</option>`;
  }).join('');
  document.getElementById('motivo-perda-outro').value='';
  document.getElementById('ov-motivo').classList.add('open');
  _pendingMoverCallback = callback;
}

// ── Modal ─────────────────────────────────────────────────────
function abrirNovoLead(etapaId) {
  resetModal();
  onFlFunilChange().then(()=>{ document.getElementById('fl-etapa').value=etapaId; });
  document.getElementById('ov-lead').classList.add('open');
  document.getElementById('fl-nome').focus();
}

async function abrirLead(id) {
  const r = await Auth.api('GET',`/leads/${id}`);
  if (!r?.ok) { Toast.show('Erro ao carregar lead.','error'); return; }
  const l = r.data.dados;
  resetModal();
  document.getElementById('ml-title').textContent='Editar Lead';
  document.getElementById('fl-id').value=l.id;
  document.getElementById('fl-nome').value=l.nome||'';
  document.getElementById('fl-empresa').value=l.empresa||'';
  document.getElementById('fl-tel').value=l.telefone||'';
  document.getElementById('fl-email').value=l.email||'';
  document.getElementById('fl-valor').value=l.valor||'';
  document.getElementById('fl-status').value=l.status||'ABERTO';
  atualizarStatusBadge(l.status||'ABERTO');
  document.getElementById('fl-tags').value=l.tags?JSON.parse(l.tags).join(', '):'';
  document.getElementById('fl-data-fechamento').value=l.data_fechamento?l.data_fechamento.slice(0,10):'';
  document.getElementById('fl-data-entrada').value=l.criado_em?l.criado_em.slice(0,10):'';
  // Observações — carrega do banco via l.observacoes
  document.getElementById('fl-obs').value=l.observacoes||'';
  // Motivo de perda
  const motivoSel=document.getElementById('fl-motivo-perda');
  motivoSel.innerHTML='<option value="">— Selecione —</option>'+
    _motivosPerda.map(m=>{ const v=m.nome||m; return `<option value="${v}">${v}</option>`; }).join('');
  const motAtual = l.motivo_perda||l.perdido_motivo||'';
  motivoSel.value=motAtual;
  // Funil do lead
  const funilId = _filtros.funil || l.funil_id || (l.funil_id_real||'');
  await onFlFunilChange(funilId);
  document.getElementById('fl-funil').value=funilId;
  document.getElementById('fl-etapa').value=l.etapa_id||'';
  document.getElementById('fl-resp').value=l.responsavel_id||'';
  // Campos comerciais
  document.getElementById('fl-valor-venda').value = l.valor_venda||'';
  document.getElementById('fl-forma-pgto').value  = l.forma_pagamento||'';
  popularSelProdutos(l.produto_id||''); // legado oculto — mantém compatibilidade
  _parcelas = l.parcelas_json ? (typeof l.parcelas_json==='string' ? JSON.parse(l.parcelas_json) : l.parcelas_json) : [];
  renderParcelas();
  // Campos novos: data de fechamento, previsão próxima compra, detalhes do pedido
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v||''; };
  setVal('fl-data-fechamento', l.data_fechamento);
  // Select de previsão de próxima compra (substitui fl-proxima-compra date)
  const selPrev = document.getElementById('fl-previsao-proxima-compra');
  if (selPrev) selPrev.value = l.previsao_proxima_compra || '';
  setVal('fl-obs-pedido', l.dados_extras?.obs_pedido || '');
  // Layout Virtual
  setVal('fl-layout-virtual-aprovado-em', l.layout_virtual_aprovado_em);
  setVal('fl-layout-virtual-entrada-em',  l.layout_virtual_entrada_em);
  // Multi-produto: carrega do banco
  _leadIdAberto = id;
  await carregarProdutosLead(id, l);
  // Abre aba Venda automaticamente se tiver dados preenchidos
  if (l.valor_venda || l.forma_pagamento || l.produto_id || _leadProdutos.length) showTab('venda');
  // Subtítulo no header do modal
  const sub = document.getElementById('ml-subtitle');
  if (sub) sub.textContent = [l.empresa, l.etapa_nome].filter(Boolean).join(' · ');
  // Guarda lead original para fallback de etapa/funil/pipeline no salvar
  _leadEmEdicao = l;
  // Histórico via endpoint dedicado
  carregarHistorico(id);
  // Atividades — renderiza container na aba Informações
  if (window.Atividades) window.Atividades.renderTab(id);
  // Produção — renderiza aba completa
  if (window.Producao) window.Producao.renderTab(id, l);
  // Tags na aba Informações — chips com botão remover
  _renderTagsDisplay(l.tags, id);
  const tagWrap = document.getElementById('tag-input-wrap');
  if (tagWrap) tagWrap.style.display = 'flex';
  const tagInput = document.getElementById('tag-nova');
  if (tagInput) tagInput.value = '';
  // Botão excluir só para SUPER_ADMIN
  document.getElementById('ml-excluir').style.display = _usuario.role === 'SUPER_ADMIN' ? '' : 'none';
  // Botão clonar visível apenas quando editando lead existente
  document.getElementById('ml-clonar').style.display = '';
  document.getElementById('ov-lead').classList.add('open');
}


async function carregarHistorico(leadId) {
  const hist = document.getElementById('hist-list');
  hist.innerHTML = '<p style="color:var(--text-muted);font-size:.8rem">Carregando...</p>';
  const r = await Auth.api('GET', `/leads/${leadId}/historico`);
  const itens = r?.data?.dados || [];
  const notas = itens.filter(m => m.tipo === 'NOTA');
  if (!notas.length) {
    hist.innerHTML = '<p style="color:var(--text-muted);font-size:.8rem">Sem notas ainda.</p>';
  } else {
    hist.innerHTML = notas.map(m => {
      const data = new Date(m.criado_em || m.enviado_em).toLocaleString('pt-BR');
      return `<div class="hist-item"><div>${m.icone||'📝'} ${m.conteudo||''}</div><div class="hist-meta">${m.autor_nome||'Sistema'} · ${data}</div></div>`;
    }).join('');
  }
  _renderTimeline(itens, leadId);
}

function _renderTimeline(itens, leadId) {
  const tl = document.getElementById('lead-timeline');
  if (!tl) return;
  // Filtra apenas itens com data válida, ordena do mais antigo ao mais recente
  const sorted = [...itens].filter(m => m.criado_em || m.enviado_em)
    .sort((a,b) => new Date(a.criado_em||a.enviado_em) - new Date(b.criado_em||b.enviado_em));
  if (!sorted.length) {
    tl.innerHTML = '<p style="font-size:.72rem;color:var(--text-muted)">Nenhuma movimentação registrada ainda.</p>';
    return;
  }
  tl.innerHTML = sorted.map((m, i) => {
    const data    = new Date(m.criado_em || m.enviado_em);
    const dataStr = data.toLocaleDateString('pt-BR') + ' ' + data.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    const isLast  = i === sorted.length - 1;
    const isAuto  = m.origem_acao === 'automação' || m.origem_acao === 'automacao'
      || (m.acao||'').startsWith('AUTOMACAO') || (m.acao||'') === 'SLA_CONTATO_1';
    const icone   = m.icone  || (m.tipo === 'NOTA' ? '📝' : '📋');
    const titulo  = m.titulo || (m.tipo === 'NOTA' ? 'Nota' : m.acao || 'Evento');
    const desc    = m.conteudo ? `<div style="font-size:.7rem;color:var(--text-muted);margin-top:2px">${m.conteudo}</div>` : '';
    const autoBadge = isAuto
      ? `<span style="background:#6C47FF22;color:#6C47FF;border:1px solid #6C47FF44;border-radius:6px;padding:1px 5px;font-size:.6rem;font-weight:700;margin-left:4px">🤖 automação</span>`
      : '';
    let duracao = '';
    if (i > 0) {
      const prev  = new Date(sorted[i-1].criado_em || sorted[i-1].enviado_em);
      const diffH = Math.round((data - prev) / 3600000);
      if (diffH >= 0) duracao = diffH < 24 ? `${diffH}h` : `${Math.round(diffH/24)}d`;
    }
    const borderStyle = isAuto ? 'border-left:2px solid #6C47FF44;' : '';
    return `<div class="timeline-item" style="${borderStyle}">
      <div class="timeline-dot${isLast?' current':''}">${icone}</div>
      <div class="timeline-body">
        <div class="timeline-stage" style="font-size:.78rem;font-weight:600">${titulo}${autoBadge}</div>
        ${desc}
        <div class="timeline-meta">${dataStr} · ${m.autor_nome||'Sistema'}</div>
      </div>
      ${duracao ? `<div class="timeline-duration">${duracao}</div>` : ''}
    </div>`;
  }).join('');
}


function resetModal() {
  document.getElementById('ml-title').textContent = 'Novo Lead';
  const sub = document.getElementById('ml-subtitle');
  if (sub) sub.textContent = '';
  ['fl-id','fl-nome','fl-empresa','fl-tel','fl-email','fl-tags','fl-obs'].forEach(id => document.getElementById(id).value = '');
  const mpSel = document.getElementById('fl-motivo-perda');
  if (mpSel) { mpSel.innerHTML = '<option value="">— Selecione (se aplicável) —</option>' + _motivosPerda.map(m => { const v = m.nome||m; return `<option value="${v}">${v}</option>`; }).join(''); }
  document.getElementById('fl-valor').value = '';
  document.getElementById('fl-data-fechamento').value = '';
  document.getElementById('fl-data-entrada').value = '';
  document.getElementById('fl-status').value = 'ABERTO';
  atualizarStatusBadge('ABERTO');
  document.getElementById('ml-alert').style.display = 'none';
  document.getElementById('nova-nota').value = '';
  // Botão excluir e clonar: oculta no novo lead
  document.getElementById('ml-excluir').style.display = 'none';
  document.getElementById('ml-clonar').style.display  = 'none';
  // Timeline/tags reset
  const tl = document.getElementById('lead-timeline');
  if (tl) tl.innerHTML = '<p style="font-size:.72rem;color:var(--text-muted)">Selecione um lead para ver a timeline.</p>';
  const tagsDisp = document.getElementById('lead-tags-display');
  if (tagsDisp) tagsDisp.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Sem tags registradas.</span>';
  const tagWrap  = document.getElementById('tag-input-wrap');
  if (tagWrap) tagWrap.style.display = 'none';
  const tagInput = document.getElementById('tag-nova');
  if (tagInput) tagInput.value = '';
  showTab('dados');
  const fSel = document.getElementById('fl-funil');
  // Exclui funis inativos (ex: Tráfego Pago) do select de criação/edição de lead
  const funisCriacaoAtivos = _funis.filter(f => f.ativo !== false && f.ativo !== 0 && f.ativo !== '0');
  fSel.innerHTML = funisCriacaoAtivos.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
  fSel.value = _filtros.funil || (funisCriacaoAtivos[0]?.id || '');
  const rSel = document.getElementById('fl-resp');
  rSel.innerHTML = _usuarios.map(u => `<option value="${u.id}">${u.nome}</option>`).join('');
  if (_usuario.role === 'VENDEDOR') { rSel.value = _usuario.id; rSel.disabled = true; }
  else { rSel.disabled = false; rSel.value = _usuario.id; }
  _leadEmEdicao = null;
  _leadIdAberto = null;
  document.getElementById('fl-valor-venda').value = '';
  document.getElementById('fl-forma-pgto').value = '';
  popularSelProdutos('');
  _parcelas = [];
  renderParcelas();
  _leadProdutos = [];
  _leadProdutosNovas = [];
  renderProdutosLead();
}

function _renderTagsDisplay(tagsRaw, leadId) {
  const el = document.getElementById('lead-tags-display');
  if (!el) return;
  let tags = [];
  if (Array.isArray(tagsRaw)) tags = tagsRaw;
  else if (tagsRaw) {
    try { tags = JSON.parse(tagsRaw); } catch { tags = String(tagsRaw).split(',').map(t => t.trim()).filter(Boolean); }
  }
  if (!tags.length) {
    el.innerHTML = '<span style="font-size:.72rem;color:var(--text-muted)">Sem tags registradas.</span>';
    return;
  }
  const lid = leadId || _leadIdAberto;
  el.innerHTML = tags.map(t => {
    const safeTag = String(t).trim();
    const esc = safeTag.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const btn = lid ? `<button type="button" onclick="_removerTagUI('${lid}','${esc}')" style="background:none;border:none;cursor:pointer;padding:0 0 0 4px;color:inherit;opacity:.7;font-size:.8rem" title="Remover">✕</button>` : '';
    return `<span class="lead-tag" style="font-size:.72rem;display:inline-flex;align-items:center;gap:2px">${safeTag}${btn}</span>`;
  }).join('');
}

async function _adicionarTagUI() {
  const leadId = _leadIdAberto;
  if (!leadId) return;
  const input = document.getElementById('tag-nova');
  const tag   = (input?.value || '').trim();
  if (!tag) return;
  const r = await Auth.api('POST', `/leads/${leadId}/tags`, { tag });
  if (!r?.ok) {
    const msg = r?.data?.erro || 'Erro ao adicionar tag.';
    if (msg.toLowerCase().includes('j') && msg.toLowerCase().includes('existe')) Toast.show('Tag já cadastrada.', 'warning');
    else Toast.show(msg, 'error');
    return;
  }
  const novasTags = r.data.dados?.tags || [];
  _renderTagsDisplay(novasTags, leadId);
  if (input) input.value = '';
  if (_leadEmEdicao) _leadEmEdicao.tags = novasTags;
  carregarHistorico(leadId);
  Toast.show(`Tag "${tag}" adicionada.`, 'success');
}

async function _removerTagUI(leadId, tag) {
  const r = await Auth.api('DELETE', `/leads/${leadId}/tags/${encodeURIComponent(tag)}`);
  if (!r?.ok) { Toast.show(r?.data?.erro || 'Erro ao remover tag.', 'error'); return; }
  const novasTags = r.data.dados?.tags || [];
  _renderTagsDisplay(novasTags, leadId);
  if (_leadEmEdicao) _leadEmEdicao.tags = novasTags;
  carregarHistorico(leadId);
  Toast.show(`Tag "${tag}" removida.`, 'success');
}

function atualizarStatusBadge(status) {
  const dot   = document.getElementById('fl-status-dot');
  const label = document.getElementById('fl-status-label');
  if (!dot || !label) return;
  const cfg = {
    'ABERTO':  { cor: '#6CFF4E', txt: 'ABERTO' },
    'GANHO':   { cor: '#3B8BFF', txt: 'GANHO' },
    'PERDIDO': { cor: '#E10098', txt: 'PERDIDO' },
  }[status] || { cor: '#888', txt: status || 'ABERTO' };
  dot.style.background = cfg.cor;
  label.textContent = cfg.txt;
  label.style.color = cfg.cor;
}

async function onFlFunilChange(overrideFunilId) {
  const funilId=overrideFunilId||document.getElementById('fl-funil').value;
  if (!funilId) return;
  const r=await Auth.api('GET',`/funis/${funilId}`);
  if (!r?.ok) return;
  const etapas=r.data.dados.etapas||[];
  const sel=document.getElementById('fl-etapa');
  sel.innerHTML=etapas.map(e=>`<option value="${e.id}">${e.nome}</option>`).join('');
}

function showTab(tab) {
  const ABAS = ['dados', 'hist', 'venda', 'producao'];
  ABAS.forEach(t => {
    const el  = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (el)  el.style.display  = t === tab ? '' : 'none';
    if (btn) {
      btn.classList.toggle('active', t === tab);
    }
  });
}

async function salvarLead() {
  const id=document.getElementById('fl-id').value;
  const nome=document.getElementById('fl-nome').value.trim();
  const alertEl=document.getElementById('ml-alert');
  alertEl.style.display='none';
  if (!nome) { alertEl.className='alert alert-error'; alertEl.textContent='Nome é obrigatório.'; alertEl.style.display=''; return; }

  const etapaId=document.getElementById('fl-etapa').value;
  const funilId=document.getElementById('fl-funil').value;
  const statusAtual=document.getElementById('fl-status').value;

  // ── Detecção de ganho (etapa ou status) ──────────────────────
  const etapaSel = _etapas.find(e=>e.id===etapaId);
  const isGanhoEtapa = etapaSel?.is_ganho || etapaSel?.probabilidade>=100 ||
    /venda|vendas|ganho|fechad|fechamento/i.test(etapaSel?.nome||'');
  const isGanhoStatus = /^(ganho|GANHO|vendido|venda)$/i.test(statusAtual);

  // ── Validação ANTES de qualquer chamada API ───────────────────
  if (isGanhoEtapa || isGanhoStatus) {
    const email = document.getElementById('fl-email').value.trim();
    const vv    = parseFloat(document.getElementById('fl-valor-venda').value)||0;
    const fp    = document.getElementById('fl-forma-pgto').value;
    const prev  = document.getElementById('fl-previsao-proxima-compra')?.value;
    // Multi-produto: valida lista de produtos
    const prodAtivos = _leadProdutos.filter(p => !p._removido);
    const faltando=[];
    if (!email)   faltando.push('E-mail');
    if (!funilId) faltando.push('Funil');
    if (!fp)      faltando.push('Forma de Pagamento');
    if (prodAtivos.length === 0) {
      alertEl.className='alert alert-error';
      alertEl.textContent='Para registrar a venda, adicione pelo menos um produto com quantidade e valor.';
      alertEl.style.display='';
      abrirSecaoComercial();
      return;
    }
    const prodIncompleto = prodAtivos.find(p => !p.produto_nome || !(p.quantidade > 0) || !(p.valor_unitario > 0));
    if (prodIncompleto) {
      alertEl.className='alert alert-error';
      alertEl.textContent='Preencha produto, quantidade e valor antes de registrar a venda.';
      alertEl.style.display='';
      abrirSecaoComercial();
      return;
    }
    if (vv <= 0) faltando.push('Valor da Venda (soma dos produtos deve ser > 0)');
    if (faltando.length) {
      alertEl.className='alert alert-error';
      alertEl.textContent=`Para registrar a venda, preencha: ${faltando.join(', ')}.`;
      alertEl.style.display='';
      abrirSecaoComercial();
      return;
    }
    // ── Previsão de próxima compra — OBRIGATÓRIA para ganho ───────
    if (!prev) {
      alertEl.className='alert alert-error';
      alertEl.textContent='Para concluir a venda, informe a previsão de próxima compra deste cliente.';
      alertEl.style.display='';
      // Destaca o campo visualmente e faz scroll até ele
      const prevEl = document.getElementById('fl-previsao-proxima-compra');
      if (prevEl) {
        prevEl.style.outline='2px solid var(--pink,#FF3B5C)';
        prevEl.style.borderColor='var(--pink,#FF3B5C)';
        prevEl.scrollIntoView({ behavior:'smooth', block:'center' });
        setTimeout(() => { prevEl.style.outline=''; prevEl.style.borderColor=''; }, 3000);
      }
      showTab('venda');
      return;
    }
  }

  // Sempre resolve pipeline_id a partir do funil selecionado (nunca usa 'todos' ou _pipelineAtivo nulo)
  let pipelineId = _pipelineAtivo; // válido quando há funil ativo no filtro
  if (funilId) {
    // Se o funil do modal difere do filtro ativo, OU estamos no modo "Todos" (_pipelineAtivo=null)
    if (!pipelineId || funilId !== _filtros.funil) {
      const rd = await Auth.api('GET', `/funis/${funilId}`);
      if (rd?.ok) pipelineId = rd.data.dados.pipeline_id || null;
    }
  }

  // — Preserva etapa/funil/pipeline do lead original se o usuário não alterou —
  // etapa_id: usa o do formulário, mas se estiver igual ao do lead original (não mudou),
  // ou se o formulário estiver vazio, usa o original para não sobrescrever.
  const etapaIdFinal    = etapaId    || _leadEmEdicao?.etapa_id    || undefined;
  const funilIdFinal    = funilId    || _leadEmEdicao?.funil_id    || undefined;
  const pipelineIdFinal = pipelineId || _leadEmEdicao?.pipeline_id || undefined;

  const tagsRaw=document.getElementById('fl-tags').value;
  const obsVal=document.getElementById('fl-obs').value.trim();
  const motivoPerdaVal=document.getElementById('fl-motivo-perda').value.trim()||undefined;
  const body={
    nome,
    empresa:   document.getElementById('fl-empresa').value.trim()||undefined,
    telefone:  document.getElementById('fl-tel').value.trim()||undefined,
    email:     document.getElementById('fl-email').value.trim()||undefined,
    valor:     parseFloat(document.getElementById('fl-valor').value)||0,
    data_fechamento: document.getElementById('fl-data-fechamento').value||undefined,
    etapa_id:    etapaIdFinal,
    funil_id:    funilIdFinal,
    pipeline_id: pipelineIdFinal,
    responsavel_id: document.getElementById('fl-resp').value||undefined,
    tags: tagsRaw?tagsRaw.split(',').map(t=>t.trim()).filter(Boolean):[],
    observacoes: obsVal||null,
    motivo_perda: motivoPerdaVal,
    // Campos comerciais da venda
    valor_venda:          parseFloat(document.getElementById('fl-valor-venda').value)||undefined,
    forma_pagamento:      document.getElementById('fl-forma-pgto').value||undefined,
    quantidade_parcelas:  _parcelas.length||undefined,
    parcelas_json:        _parcelas.length ? _parcelas : undefined,
    produto_id:           document.getElementById('fl-produto').value||undefined,
    produto_nome:         document.getElementById('fl-produto').selectedOptions[0]?.text||undefined,
    produto_cor:          document.getElementById('fl-produto').selectedOptions[0]?.dataset?.cor||undefined,
    // Campos novos
    data_fechamento:  document.getElementById('fl-data-fechamento')?.value||undefined,
    previsao_proxima_compra: document.getElementById('fl-previsao-proxima-compra')?.value||undefined,
    dados_extras: {
      obs_pedido:   document.getElementById('fl-obs-pedido')?.value||undefined,
      num_produtos: document.getElementById('fl-num-produtos')?.value||undefined,
      qtd_pecas:    document.getElementById('fl-qtd-pecas')?.value||undefined,
    },
  };

  const btn=document.getElementById('ml-salvar');
  btn.disabled=true;
  document.getElementById('ml-salvar-txt').textContent='Salvando...';
  document.getElementById('ml-spinner').classList.remove('hidden');

  try {
    if (id) {
      // Lead existente: detecta etapaMudou ANTES do PATCH
      // Compara etapa do formulário com a etapa original (não com _leads cache que pode estar desatualizado)
      const etapaOriginal = _leadEmEdicao?.etapa_id || _leads.find(l=>l.id===id)?.etapa_id;
      const etapaMudou = etapaIdFinal && etapaOriginal && etapaOriginal !== etapaIdFinal;
      const r = await Auth.api('PATCH',`/leads/${id}`,body);
      if (r?.ok) {
        if (etapaId && etapaMudou) {
          // etapaSel e isGanhoEtapa já calculados no topo — validação de ganho já passou
          const isPerdidoSel = etapaSel?.is_perdido || etapaSel?.probabilidade===0 ||
            etapaSel?.nome?.toLowerCase().includes('perdid') ||
            etapaSel?.nome?.toLowerCase().includes('desqualif');
          if (isPerdidoSel && !motivoPerdaVal) {
            alertEl.className='alert alert-error';
            alertEl.textContent='Selecione o Motivo de Perda antes de mover para esta etapa.';
            alertEl.style.display='';
            return;
          }
          const payload = { etapa_id:etapaId, pipeline_id:pipelineId };
          if (isPerdidoSel && motivoPerdaVal) payload.motivo_perda = motivoPerdaVal;
          if (isGanhoEtapa) {
            payload.valor_venda         = parseFloat(document.getElementById('fl-valor-venda').value)||0;
            payload.forma_pagamento     = document.getElementById('fl-forma-pgto').value;
            payload.quantidade_parcelas = _parcelas.length||1;
            payload.parcelas_json       = _parcelas.length ? _parcelas : undefined;
            payload.produto_id          = document.getElementById('fl-produto').value||undefined;
            payload.produto_nome        = document.getElementById('fl-produto').selectedOptions[0]?.text||undefined;
            payload.produto_cor         = document.getElementById('fl-produto').selectedOptions[0]?.dataset?.cor||undefined;
            payload.previsao_proxima_compra = document.getElementById('fl-previsao-proxima-compra')?.value || undefined;
            // ── Previsão obrigatória p/ ganho ────────────────────────────
            if (!payload.previsao_proxima_compra) {
              alertEl.className='alert alert-error';
              alertEl.textContent='Para concluir a venda, informe a previsão de próxima compra deste cliente.';
              alertEl.style.display='';
              const prevEl = document.getElementById('fl-previsao-proxima-compra');
              if (prevEl) {
                prevEl.style.outline='2px solid var(--pink,#FF3B5C)';
                prevEl.style.borderColor='var(--pink,#FF3B5C)';
                prevEl.scrollIntoView({ behavior:'smooth', block:'center' });
                setTimeout(() => { prevEl.style.outline=''; prevEl.style.borderColor=''; }, 3000);
              }
              showTab('venda');
              return;
            }
          }

          // Layout Virtual: envia aprovacao se preenchida
          const lvaEl = document.getElementById('fl-layout-virtual-aprovado-em');
          if (lvaEl?.value) payload.layout_virtual_aprovado_em = lvaEl.value;
          // Validação frontend: Amostra Física requer Layout Virtual aprovado
          const isAmFisica = /amostra.?f/i.test(etapaSel?.nome||'');
          const etapaOrigNome = _leadEmEdicao?.etapa_nome || '';
          const vemDeLayout   = /layout.?virtual/i.test(etapaOrigNome);
          if (isAmFisica && vemDeLayout && !payload.layout_virtual_aprovado_em) {
            alertEl.className='alert alert-error';
            alertEl.textContent='Preencha a data de aprovação do Layout Virtual antes de mover para Amostra Física.';
            alertEl.style.display='';
            return;
          }
          await Auth.api('PATCH',`/leads/${id}/mover`,payload);
        }
        Toast.show('Lead atualizado!','success');
        // Atualiza card local imediatamente via backend response (se disponível)
        // e recarrega em background sem bloquear o usuário
        fecharModal();
        carregarLeads().catch(() => {}); // background refresh
      } else {
        alertEl.className='alert alert-error'; alertEl.textContent=r?.data?.erro||'Erro.'; alertEl.style.display='';
      }
    } else {
      // Novo lead: POST cria com status=ABERTO automaticamente no backend
      const r = await Auth.api('POST','/leads',body);
      if (r?.ok) {
        Toast.show('Lead criado!','success');
        fecharModal();
        carregarLeads().catch(() => {}); // background refresh
      } else {
        alertEl.className='alert alert-error'; alertEl.textContent=r?.data?.erro||'Erro.'; alertEl.style.display='';
      }
    }
  } finally {
    btn.disabled=false;
    document.getElementById('ml-salvar-txt').textContent='Salvar';
    document.getElementById('ml-spinner').classList.add('hidden');
  }
}

async function excluirLead() {
  const id=document.getElementById('fl-id').value;
  if (!id || !confirm('Excluir este lead permanentemente?')) return;
  const r=await Auth.api('DELETE',`/leads/${id}`);
  if (r?.ok) { Toast.show('Lead excluído.','success'); fecharModal(); carregarLeads().catch(()=>{}); }
  else Toast.show(r?.data?.erro||'Erro ao excluir.','error');
}

async function adicionarNota() {
  const id=document.getElementById('fl-id').value;
  const txt=document.getElementById('nova-nota').value.trim();
  if (!id||!txt) return;
  const r=await Auth.api('POST',`/leads/${id}/mensagens`,{ conteudo:txt, tipo:'NOTA' });
  if (r?.ok) { Toast.show('Nota adicionada!','success'); document.getElementById('nova-nota').value=''; await abrirLead(id); }
}

function fecharModal() { document.getElementById('ov-lead').classList.remove('open'); }

async function clonarLead() {
  const id = document.getElementById('fl-id').value;
  if (!id) return;
  const btn = document.getElementById('ml-clonar');
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Clonando...';
  try {
    const r = await Auth.api('POST', `/leads/${id}/clonar`);
    if (r?.ok) {
      Toast.show(`Lead clonado: ${r.data.dados?.nome || ''} — somente Dados Principais copiados.`, 'success');
      fecharModal();
      carregarLeads().catch(()=>{}); // background refresh
      // Abre o lead clonado automaticamente
      if (r.data.dados?.id) setTimeout(() => abrirLead(r.data.dados.id), 400);
    } else {
      Toast.show(r?.data?.erro || 'Erro ao clonar.', 'error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
}

function fecharModalMotivo() {
  document.getElementById('ov-motivo').classList.remove('open');
  _pendingMoverCallback=null;
}

async function confirmarMotivo() {
  const sel=document.getElementById('motivo-perda-sel');
  const outro=document.getElementById('motivo-perda-outro').value.trim();
  const motivo=outro||sel.value;
  if (!motivo) { Toast.show('Selecione ou informe o motivo de perda.','error'); return; }
  const cb=_pendingMoverCallback;
  fecharModalMotivo();
  if (cb) await cb(motivo);
}

// ── Funções comerciais ───────────────────────────────────────
function popularSelProdutos(selecionado) {
  // Mantém o select legado (oculto) populado para compatibilidade
  const sel = document.getElementById('fl-produto');
  sel.innerHTML = '<option value="">—</option>' +
    _produtos.map(p => `<option value="${p.id}" data-cor="${p.cor||'#aaa'}">${p.nome}</option>`).join('');
  if (selecionado) sel.value = selecionado;
}

// ── Multi-produto ─────────────────────────────────────────────

// Carrega itens do banco e inicializa a lista
async function carregarProdutosLead(leadId, lead) {
  _leadProdutos = [];
  _leadProdutosNovas = [];

  // Tenta buscar do endpoint lead_produtos
  const r = await Auth.api('GET', `/leads/${leadId}/produtos`);
  if (r?.ok && r.data.dados?.length) {
    _leadProdutos = r.data.dados.map(p => ({ ...p, _salvo: true }));
  } else if (lead?.produto_nome || lead?.produto_id) {
    // Fallback: lead antigo tem produto único — exibe como linha visual
    const pid = lead.produto_id || '';
    const prodMestre = _produtos.find(p => p.id === pid);
    _leadProdutos = [{
      id: null, // não tem id em lead_produtos ainda
      lead_id: leadId,
      produto_id: pid,
      produto_nome: lead.produto_nome || prodMestre?.nome || 'Produto',
      produto_cor: lead.produto_cor || prodMestre?.cor || '#6CFF4E',
      quantidade: 1,
      valor_unitario: Number(lead.valor_venda || 0),
      valor_total: Number(lead.valor_venda || 0),
      _legado: true, _salvo: false,
    }];
  }
  renderProdutosLead();
}

// Recalcula o total e atualiza fl-valor-venda + detalhes do pedido
function recalcularTotalVenda() {
  const ativos = _leadProdutos.filter(p => !p._removido);
  const total  = ativos.reduce((s, p) => s + Number(p.valor_total || (p.quantidade * p.valor_unitario) || 0), 0);
  const totalQtd = ativos.reduce((s, p) => s + (Number(p.quantidade) || 0), 0);

  const vv = document.getElementById('fl-valor-venda');
  const totalEl = document.getElementById('lp-total-valor');
  const wrapEl  = document.getElementById('lp-total-wrap');
  const numProd = document.getElementById('fl-num-produtos');
  const qtdPec  = document.getElementById('fl-qtd-pecas');

  if (vv)       vv.value = total > 0 ? total.toFixed(2) : '';
  if (totalEl)  totalEl.textContent = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  if (wrapEl)   wrapEl.style.display = ativos.length ? 'flex' : 'none';
  if (numProd)  numProd.value = ativos.length || '';
  if (qtdPec)   qtdPec.value  = totalQtd > 0 ? totalQtd : '';
}

// Renderiza a lista de produtos da venda (com input+datalist para busca)
function renderProdutosLead() {
  const lista   = document.getElementById('lp-lista');
  const empty   = document.getElementById('lp-empty');
  const header  = document.getElementById('lp-header');
  if (!lista) return;

  // Monta datalist uma vez no DOM (para reusar em todas as linhas)
  let dl = document.getElementById('dl-produtos-crm');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'dl-produtos-crm';
    document.body.appendChild(dl);
  }
  dl.innerHTML = _produtos.map(p => `<option value="${p.nome}" data-id="${p.id}" data-cor="${p.cor||'#6CFF4E'}"></option>`).join('');

  const ativos = _leadProdutos.filter(p => !p._removido);
  empty.style.display  = ativos.length ? 'none' : '';
  header.style.display = ativos.length ? 'grid' : 'none';
  lista.innerHTML = '';

  ativos.forEach((p, i) => {
    const idx = _leadProdutos.indexOf(p);
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 70px 100px 90px 28px;gap:4px;align-items:center;margin-bottom:2px';
    row.dataset.lpIdx = idx;
    row.innerHTML = `
      <input list="dl-produtos-crm" class="input lp-produto-input" style="font-size:.78rem;padding:4px 6px" placeholder="Buscar produto..." value="${p.produto_nome||''}" data-idx="${idx}" autocomplete="off">
      <input type="number" class="input lp-qty" style="font-size:.78rem;padding:4px 6px" min="0.001" step="any" placeholder="Qtd" value="${p.quantidade||1}" data-idx="${idx}">
      <input type="number" class="input lp-vunit" style="font-size:.78rem;padding:4px 6px" min="0" step="0.01" placeholder="R$ unit" value="${p.valor_unitario||''}" data-idx="${idx}">
      <input type="number" class="input lp-vtot" style="font-size:.78rem;padding:4px 6px;background:var(--surface-2)" readonly placeholder="Total" value="${Number(p.valor_total||(p.quantidade*p.valor_unitario)||0).toFixed(2)}" data-idx="${idx}">
      <button type="button" class="lp-rm" data-idx="${idx}" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;line-height:1" title="Remover">✕</button>`;

    // Evento: selecionar/digitar produto (detecta match no datalist)
    const inputProd = row.querySelector('.lp-produto-input');
    inputProd.addEventListener('change', async e => {
      const pidx     = +e.target.dataset.idx;
      const nomeDigitado = e.target.value.trim();
      // Tenta encontrar produto exato no catálogo
      const opt = [...dl.querySelectorAll('option')].find(
        o => o.value.trim().toLowerCase() === nomeDigitado.toLowerCase()
      );
      _leadProdutos[pidx].produto_nome = nomeDigitado;
      _leadProdutos[pidx].produto_id   = opt ? opt.dataset.id  : '';
      _leadProdutos[pidx].produto_cor  = opt ? opt.dataset.cor : '#6CFF4E';
      await salvarLinhaProduto(pidx);
      recalcularTotalVenda();
    });

    // Evento: editar quantidade
    row.querySelector('.lp-qty').addEventListener('change', async e => {
      const pidx = +e.target.dataset.idx;
      const qty  = Number(e.target.value) || 1;
      _leadProdutos[pidx].quantidade = qty;
      const vunit = Number(_leadProdutos[pidx].valor_unitario) || 0;
      _leadProdutos[pidx].valor_total = Number((qty * vunit).toFixed(2));
      row.querySelector('.lp-vtot').value = _leadProdutos[pidx].valor_total;
      recalcularTotalVenda();
      await salvarLinhaProduto(pidx);
    });

    // Evento: editar valor unitário
    row.querySelector('.lp-vunit').addEventListener('change', async e => {
      const pidx  = +e.target.dataset.idx;
      const vunit = Number(e.target.value) || 0;
      _leadProdutos[pidx].valor_unitario = vunit;
      const qty   = Number(_leadProdutos[pidx].quantidade) || 1;
      _leadProdutos[pidx].valor_total = Number((qty * vunit).toFixed(2));
      row.querySelector('.lp-vtot').value = _leadProdutos[pidx].valor_total;
      recalcularTotalVenda();
      await salvarLinhaProduto(pidx);
    });

    // Evento: remover linha
    row.querySelector('.lp-rm').addEventListener('click', async e => {
      const pidx = +e.target.dataset.idx;
      await removerLinhaProduto(pidx);
    });

    lista.appendChild(row);
  });

  recalcularTotalVenda();
}

// Salva/atualiza uma linha no banco
async function salvarLinhaProduto(idx) {
  const p      = _leadProdutos[idx];
  const leadId = _leadIdAberto;
  if (!leadId || !p.produto_nome) return;

  const payload = {
    produto_id:     p.produto_id     || undefined,
    produto_nome:   p.produto_nome,
    produto_cor:    p.produto_cor    || undefined,
    quantidade:     Number(p.quantidade) || 1,
    valor_unitario: Number(p.valor_unitario) || 0,
  };

  if (p.id) {
    // Já persistido — PATCH
    const r = await Auth.api('PATCH', `/leads/${leadId}/produtos/${p.id}`, payload);
    if (r?.ok) {
      _leadProdutos[idx] = { ...p, ...payload, valor_total: r.data.dados?.valor_total ?? (payload.quantidade * payload.valor_unitario), _salvo: true };
      recalcularTotalVenda();
    }
  } else {
    // Não persistido ainda — POST
    const r = await Auth.api('POST', `/leads/${leadId}/produtos`, payload);
    if (r?.ok && r.data.dados?.id) {
      _leadProdutos[idx] = { ...p, ...r.data.dados, _salvo: true };
      recalcularTotalVenda();
    }
  }
}

// Remove linha (soft delete no banco ou só localmente se não persistida)
async function removerLinhaProduto(idx) {
  const p = _leadProdutos[idx];
  const leadId = _leadIdAberto;
  if (p.id && leadId) {
    await Auth.api('DELETE', `/leads/${leadId}/produtos/${p.id}`);
  }
  _leadProdutos[idx]._removido = true;
  recalcularTotalVenda();
  renderProdutosLead();
}

// Adiciona nova linha vazia
function adicionarLinhaProduto() {
  _leadProdutos.push({
    id: null,
    lead_id: _leadIdAberto,
    produto_id: '',
    produto_nome: '',
    produto_cor: '#6CFF4E',
    quantidade: 1,
    valor_unitario: 0,
    valor_total: 0,
    _salvo: false,
  });
  renderProdutosLead();
  abrirSecaoComercial();
  // Foca o input de busca da última linha adicionada
  const rows = document.querySelectorAll('#lp-lista [data-lp-idx]');
  if (rows.length) rows[rows.length-1].querySelector('.lp-produto-input')?.focus();
}

function renderParcelas() {
  const lista = document.getElementById('parcelas-lista');
  const empty = document.getElementById('parcelas-empty');
  lista.innerHTML = '';
  empty.style.display = _parcelas.length ? 'none' : '';
  _parcelas.forEach((p, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center';
    row.innerHTML = `
      <span style="font-size:.75rem;color:var(--text-muted);min-width:24px">${i+1}x</span>
      <input type="number" class="input" style="flex:1;padding:5px 8px;font-size:.82rem" placeholder="Valor (R$)" value="${p.valor||''}" data-idx="${i}" data-field="valor">
      <input type="date" class="input date-input" style="flex:1;padding:5px 8px;font-size:.82rem" value="${p.vencimento||''}" data-idx="${i}" data-field="vencimento" title="Vencimento (opcional)">
      <button type="button" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;line-height:1" data-rm="${i}" title="Remover">✕</button>`;
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('change', e => {
      _parcelas[+e.target.dataset.idx][e.target.dataset.field] = e.target.value;
    }));
    row.querySelector('[data-rm]').addEventListener('click', e => {
      _parcelas.splice(+e.target.dataset.rm, 1);
      renderParcelas();
    });
    lista.appendChild(row);
  });
}

function adicionarParcela() {
  _parcelas.push({ numero: _parcelas.length+1, valor:'', vencimento:'' });
  renderParcelas();
}

function abrirSecaoComercial() {
  document.getElementById('comercial-body').style.display='';
  document.getElementById('toggle-comercial-icon').style.transform='rotate(90deg)';
}

function fecharSecaoComercial() {
  document.getElementById('comercial-body').style.display='none';
  document.getElementById('toggle-comercial-icon').style.transform='';
}

async function salvarNovoProduto() {
  const nome = document.getElementById('np-nome').value.trim();
  const cor  = document.getElementById('np-cor').value;
  if (!nome) { Toast.show('Informe o nome do produto.','error'); return; }
  const r = await Auth.api('POST','/produtos',{ nome, cor });
  if (!r?.ok) { Toast.show(r?.data?.erro||'Erro ao cadastrar produto.','error'); return; }
  await carregarProdutos();
  popularSelProdutos(r.data.dados.id);
  document.getElementById('form-novo-produto').style.display='none';
  document.getElementById('np-nome').value='';
  Toast.show('Produto cadastrado!','success');
  // Adiciona automaticamente como nova linha na lista de venda
  const novo = r.data.dados;
  _leadProdutos.push({
    id: null,
    lead_id: _leadIdAberto,
    produto_id: novo.id,
    produto_nome: novo.nome,
    produto_cor: novo.cor || '#6CFF4E',
    quantidade: 1,
    valor_unitario: 0,
    valor_total: 0,
    _salvo: false,
  });
  renderProdutosLead();
}

// ── Events ────────────────────────────────────────────────────
function bindEvents() {
  // Filtros
  document.getElementById('sel-funil').addEventListener('change', async e => {
    _filtros.funil=e.target.value; await aplicarFiltros();
  });
  document.getElementById('sel-resp').addEventListener('change', e => {
    _filtros.resp = e.target.value;
    console.log('[FILTRO_VENDEDOR_SELECT_CHANGE] pipeline | valor:', e.target.value,
      '| nome:', document.getElementById('sel-resp').selectedOptions[0]?.text);
    console.log('[FILTRO_VENDEDOR_VALOR_SELECIONADO] resp =', _filtros.resp || '(todos)');
    carregarLeads();
  });
  document.getElementById('sel-data-tipo').addEventListener('change', e => {
    _filtros.dataTipo=e.target.value;
    const periodoSel=document.getElementById('sel-data-periodo');
    periodoSel.style.display=e.target.value?'':'none';
    if (!e.target.value) { _filtros.dataPeriodo=''; _filtros.dataInicio=''; _filtros.dataFim=''; document.getElementById('date-custom-wrap').classList.remove('visible'); }
    carregarLeads();
  });
  document.getElementById('sel-data-periodo').addEventListener('change', e => {
    _filtros.dataPeriodo=e.target.value;
    const cw=document.getElementById('date-custom-wrap');
    if (e.target.value==='personalizado') cw.classList.add('visible');
    else { cw.classList.remove('visible'); _filtros.dataInicio=''; _filtros.dataFim=''; }
    carregarLeads();
  });
  document.getElementById('data-inicio').addEventListener('change', e => { _filtros.dataInicio=e.target.value; carregarLeads(); });
  document.getElementById('data-fim').addEventListener('change', e => { _filtros.dataFim=e.target.value; carregarLeads(); });

  let buscaTimer;
  document.getElementById('busca').addEventListener('input', e => {
    _filtros.busca=e.target.value; clearTimeout(buscaTimer); buscaTimer=setTimeout(carregarLeads,400);
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    _filtros={ funil:'', resp:'', dataTipo:'', dataPeriodo:'', dataInicio:'', dataFim:'', busca:'' };
    document.getElementById('sel-funil').value='';
    document.getElementById('sel-resp').value='';
    document.getElementById('sel-data-tipo').value='';
    document.getElementById('sel-data-periodo').value='';
    document.getElementById('sel-data-periodo').style.display='none';
    document.getElementById('date-custom-wrap').classList.remove('visible');
    document.getElementById('data-inicio').value='';
    document.getElementById('data-fim').value='';
    document.getElementById('busca').value='';
    aplicarFiltros();
  });

  // Modal
  document.getElementById('btn-novo-lead').addEventListener('click', () => abrirNovoLead(_etapas[0]?.id||''));
  document.getElementById('ml-close').addEventListener('click', fecharModal);
  document.getElementById('ml-cancelar').addEventListener('click', fecharModal);
  document.getElementById('ml-salvar').addEventListener('click', salvarLead);
  document.getElementById('ml-excluir').addEventListener('click', excluirLead);
  document.getElementById('ml-clonar').addEventListener('click', clonarLead);
  document.getElementById('btn-add-nota').addEventListener('click', adicionarNota);
  document.getElementById('btn-add-tag')?.addEventListener('click', _adicionarTagUI);
  document.getElementById('tag-nova')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _adicionarTagUI(); } });

  document.getElementById('ov-lead').addEventListener('click', e => { if(e.target===document.getElementById('ov-lead')) fecharModal(); });
  // 4 abas
  document.getElementById('tab-btn-dados').addEventListener('click', () => showTab('dados'));
  document.getElementById('tab-btn-hist').addEventListener('click', () => {
    showTab('hist');
    const id = document.getElementById('fl-id').value;
    if (id) carregarHistorico(id);
  });
  document.getElementById('tab-btn-venda').addEventListener('click', () => showTab('venda'));
  document.getElementById('tab-btn-producao').addEventListener('click', () => showTab('producao'));
  document.getElementById('fl-funil').addEventListener('change', () => onFlFunilChange());
  // Modal motivo de perda
  document.getElementById('btn-motivo-confirmar').addEventListener('click', confirmarMotivo);
  document.getElementById('btn-motivo-cancelar').addEventListener('click', fecharModalMotivo);
  document.getElementById('ov-motivo').addEventListener('click', e => { if(e.target===document.getElementById('ov-motivo')) fecharModalMotivo(); });
  // Produtos
  document.getElementById('btn-add-parcela').addEventListener('click', adicionarParcela);
  document.getElementById('btn-add-linha-produto').addEventListener('click', adicionarLinhaProduto);
  document.getElementById('btn-salvar-produto').addEventListener('click', salvarNovoProduto);
  document.getElementById('btn-cancelar-produto').addEventListener('click', () => {
    document.getElementById('form-novo-produto').style.display = 'none';
  });
}

init();
