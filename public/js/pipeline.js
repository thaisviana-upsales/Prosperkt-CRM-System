/**
 * PROSPERKT CRM — Pipeline JS
 * Kanban, filtros, modal de lead
 * ARQUITETURA: funis → pipelines (funil_id) → etapas (pipeline_id)
 */

let _funis=[], _etapas=[], _leads=[], _usuarios=[], _usuario=null;
let _funilAtivo=null, _pipelineAtivo=null;
let _dragLeadId=null, _dragEtapaOrigem=null;
let _motivosPerda=[];
// Estado de filtros
let _filtros = { funil:'', resp:'', dataTipo:'', dataPeriodo:'', dataInicio:'', dataFim:'', busca:'' };
// Mapa nome→[ids] para agrupar leads no modo "Todos"
let _nomeParaIds = {};
// Callback de motivo de perda pendente
let _pendingMoverCallback = null;

// ── Init ──────────────────────────────────────────────────────
async function init() {
  _usuario = await Sidebar.init('pipeline');
  if (!_usuario) return;
  await Promise.all([carregarFunis(), carregarUsuarios(), carregarMotivos()]);

  const params = new URLSearchParams(location.search);
  const paramFunil = params.get('funil_id');
  if (paramFunil && _funis.find(f=>f.id===paramFunil)) _filtros.funil = paramFunil;

  popularSelFunil();
  popularSelResp();
  document.getElementById('sel-funil').value = _filtros.funil;
  await aplicarFiltros();
  bindEvents();
}

async function carregarFunis() {
  const r = await Auth.api('GET','/funis');
  _funis = (r?.data?.dados||[]).filter(f=>f.ativo);
}

async function carregarUsuarios() {
  const r = await Auth.api('GET','/usuarios');
  _usuarios = (r?.data?.dados||[]).filter(u=>u.ativo);
}

async function carregarMotivos() {
  const r = await Auth.api('GET','/motivos-perda');
  _motivosPerda = r?.data?.dados || [
    'Sem orçamento no momento','Não respondeu','Comprou com concorrente',
    'Preço fora da expectativa','Sem perfil','Lead duplicado',
    'Não tem interesse','Prazo incompatível','Outro'
  ];
}

function popularSelFunil() {
  const sel = document.getElementById('sel-funil');
  sel.innerHTML = '<option value="">Todos</option>' +
    _funis.map(f=>`<option value="${f.id}">${f.nome}</option>`).join('');
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
}

// ── Filtros ───────────────────────────────────────────────────
async function aplicarFiltros() {
  const funilId = _filtros.funil;
  _nomeParaIds = {};

  if (funilId) {
    document.getElementById('page-title').textContent = `Pipeline — ${_funis.find(x=>x.id===funilId)?.nome||''}`;
    document.getElementById('page-sub').textContent = `Leads do funil ${_funis.find(x=>x.id===funilId)?.nome||''}`;
    // Carrega funil com sua pipeline e etapas
    const rd = await Auth.api('GET',`/funis/${funilId}`);
    if (rd?.ok) {
      _pipelineAtivo = rd.data.dados.pipeline_id;
      _etapas = rd.data.dados.etapas || [];
      // Modo funil específico: mapeamento direto por id
      _nomeParaIds = {};
      _etapas.forEach(e => { _nomeParaIds[e.nome] = [e.id]; });
    } else {
      console.warn('[pipeline] Não foi possível carregar etapas do funil', funilId);
      _pipelineAtivo = null;
      _etapas = [];
    }
  } else {
    document.getElementById('page-title').textContent = 'Pipeline — Todos os Funis';
    document.getElementById('page-sub').textContent = 'Visão geral consolidada de todos os leads';
    _pipelineAtivo = null;

    // Carrega TODAS as etapas de todos os pipelines (via /etapas sem filtro)
    const re = await Auth.api('GET', '/etapas');
    const todasEtapas = re?.data?.dados || [];

    // Deduplica por nome (mantendo primeira ocorrência de cada nome, ordenado por ordem)
    const seen = new Set();
    const etapasDedup = [];
    for (const e of todasEtapas.sort((a, b) => a.ordem - b.ordem)) {
      if (!_nomeParaIds[e.nome]) _nomeParaIds[e.nome] = [];
      _nomeParaIds[e.nome].push(e.id);
      if (!seen.has(e.nome)) {
        seen.add(e.nome);
        etapasDedup.push(e);
      }
    }

    _etapas = etapasDedup;

    if (!_etapas.length) {
      console.warn('[pipeline] Nenhuma etapa encontrada via /etapas');
    }
  }

  await carregarLeads();
}

async function carregarLeads() {
  const url = construirURL();
  const r = await Auth.api('GET', url);
  _leads = r?.data?.dados || [];
  renderKanban();
}

function construirURL() {
  let url = '/leads?';
  const p = [];
  if (_filtros.funil)       p.push(`funil_id=${_filtros.funil}`);
  if (_filtros.resp)        p.push(`responsavel_id=${_filtros.resp}`);
  if (_filtros.busca)       p.push(`busca=${encodeURIComponent(_filtros.busca)}`);
  if (_filtros.dataTipo) {
    p.push(`data_tipo=${_filtros.dataTipo}`);
    if (_filtros.dataPeriodo)  p.push(`data_periodo=${_filtros.dataPeriodo}`);
    if (_filtros.dataInicio)   p.push(`data_inicio=${_filtros.dataInicio}`);
    if (_filtros.dataFim)      p.push(`data_fim=${_filtros.dataFim}`);
  }
  return url + p.join('&');
}

// ── Kanban ────────────────────────────────────────────────────
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
        <span class="col-title">${etapa.nome}</span>
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
  const tags   = l.tags ? JSON.parse(l.tags) : [];
  const tagsHtml = tags.slice(0,3).map(t=>`<span class="lead-tag">${t}</span>`).join('');
  const valor  = l.valor>0 ? `R$ ${Number(l.valor).toLocaleString('pt-BR')}` : '';
  const funilBadge = mostrarFunil && l.funil_nome
    ? `<div class="lead-funil-badge"><div class="lead-funil-dot" style="background:${_funis.find(f=>f.nome===l.funil_nome)?.cor||'#aaa'}"></div>${l.funil_nome}</div>` : '';
  return `<div class="lead-card" draggable="true" data-id="${l.id}">
    <div class="lead-name">${l.nome}</div>
    <div class="lead-info">
      ${l.empresa?`<span>${l.empresa}</span>`:''}
      ${l.telefone?`<span>${l.telefone}</span>`:''}
      ${l.responsavel_nome?`<span style="color:var(--text-secondary)">👤 ${l.responsavel_nome}</span>`:''}
    </div>
    ${valor?`<div class="lead-valor">${valor}</div>`:''}
    ${funilBadge}
    ${tags.length?`<div class="lead-tags">${tagsHtml}</div>`:''}
    ${l.telefone ? `
    <div class="lead-card-actions" onclick="event.stopPropagation()">
      <a href="/whatsapp.html?lead_id=${l.id}&tel=${encodeURIComponent(l.telefone)}&nome=${encodeURIComponent(l.nome)}"
         class="btn-wa-card" title="Abrir conversa WhatsApp com ${l.nome}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        WhatsApp
      </a>
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

  if (isPerdido) {
    // Abre modal de motivo de perda antes de mover
    abrirModalMotivo((motivo) => {
      _executarMover(_dragLeadId, etapaId, pid, etapaDest, motivo);
    });
    _dragLeadId=null; _dragEtapaOrigem=null;
    return;
  }

  await _executarMover(_dragLeadId, etapaId, pid, etapaDest, null);
  _dragLeadId=null; _dragEtapaOrigem=null;
}

async function _executarMover(leadId, etapaId, pid, etapaDest, motivo) {
  const payload = { etapa_id:etapaId, pipeline_id:pid };
  if (motivo) payload.motivo_perda = motivo;
  const r = await Auth.api('PATCH',`/leads/${leadId}/mover`, payload);
  if (r?.ok) {
    const isPerd = etapaDest?.is_perdido || etapaDest?.nome?.toLowerCase().includes('perdid') || etapaDest?.nome?.toLowerCase().includes('desqualif');
    const isGan  = etapaDest?.is_ganho  || etapaDest?.probabilidade >= 100;
    Toast.show(isGan?'🎉 Lead ganho!':isPerd?'Lead marcado como perdido.':'Lead movido!', isGan?'success':isPerd?'error':'success');
    await carregarLeads();
  } else {
    Toast.show(r?.data?.erro||'Erro ao mover.','error');
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
  // Histórico via endpoint dedicado
  carregarHistorico(id);
  // Botão excluir só para GESTOR+
  document.getElementById('ml-excluir').style.display = _usuario.role!=='VENDEDOR' ? '' : 'none';
  document.getElementById('ov-lead').classList.add('open');
}

async function carregarHistorico(leadId) {
  const hist=document.getElementById('hist-list');
  hist.innerHTML='<p style="color:var(--text-muted);font-size:.875rem">Carregando...</p>';
  const r=await Auth.api('GET',`/leads/${leadId}/historico`);
  const itens=r?.data?.dados||[];
  if (!itens.length) { hist.innerHTML='<p style="color:var(--text-muted);font-size:.875rem">Sem histórico ainda.</p>'; return; }
  hist.innerHTML=itens.map(m=>{
    const data=new Date(m.criado_em||m.enviado_em).toLocaleString('pt-BR');
    const icone=m.tipo==='LOG'?'📋':'💬';
    return `<div class="hist-item"><div>${icone} ${m.conteudo||''}</div><div class="hist-meta">${m.autor_nome||'Sistema'} · ${data}</div></div>`;
  }).join('');
}

function resetModal() {
  document.getElementById('ml-title').textContent='Novo Lead';
  ['fl-id','fl-nome','fl-empresa','fl-tel','fl-email','fl-tags','fl-obs'].forEach(id=>document.getElementById(id).value='');
  const mpSel=document.getElementById('fl-motivo-perda');
  if (mpSel) { mpSel.innerHTML='<option value="">— Selecione (se aplicável) —</option>'+_motivosPerda.map(m=>{const v=m.nome||m;return`<option value="${v}">${v}</option>`;}).join(''); }
  document.getElementById('fl-valor').value='';
  document.getElementById('fl-data-fechamento').value='';
  document.getElementById('fl-data-entrada').value='';
  document.getElementById('fl-status').value='ABERTO';
  atualizarStatusBadge('ABERTO');
  document.getElementById('ml-alert').style.display='none';
  document.getElementById('nova-nota').value='';
  document.getElementById('ml-excluir').style.display='none';
  showTab('dados');
  const fSel=document.getElementById('fl-funil');
  fSel.innerHTML=_funis.map(f=>`<option value="${f.id}">${f.nome}</option>`).join('');
  fSel.value=_filtros.funil||(_funis[0]?.id||'');
  onFlFunilChange();
  const rSel=document.getElementById('fl-resp');
  rSel.innerHTML=_usuarios.map(u=>`<option value="${u.id}">${u.nome}</option>`).join('');
  if (_usuario.role==='VENDEDOR') { rSel.value=_usuario.id; rSel.disabled=true; }
  else { rSel.disabled=false; rSel.value=_usuario.id; }
}

// Atualiza o badge de status no modal (somente leitura)
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
  document.getElementById('tab-dados').style.display=tab==='dados'?'':'none';
  document.getElementById('tab-hist').style.display=tab==='hist'?'':'none';
  ['dados','hist'].forEach(t=>{
    const btn=document.getElementById(`tab-btn-${t}`);
    btn.style.color=t===tab?'var(--green)':'var(--text-muted)';
    btn.style.borderBottomColor=t===tab?'var(--green)':'transparent';
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

  // Sempre resolve pipeline_id a partir do funil selecionado (nunca usa 'todos' ou _pipelineAtivo nulo)
  let pipelineId = _pipelineAtivo; // válido quando há funil ativo no filtro
  if (funilId) {
    // Se o funil do modal difere do filtro ativo, OU estamos no modo "Todos" (_pipelineAtivo=null)
    if (!pipelineId || funilId !== _filtros.funil) {
      const rd = await Auth.api('GET', `/funis/${funilId}`);
      if (rd?.ok) pipelineId = rd.data.dados.pipeline_id || null;
    }
  }

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
    etapa_id:    etapaId||undefined,
    funil_id:    funilId||undefined,
    pipeline_id: pipelineId||undefined,
    responsavel_id: document.getElementById('fl-resp').value||undefined,
    tags: tagsRaw?tagsRaw.split(',').map(t=>t.trim()).filter(Boolean):[],
    observacoes: obsVal||null,
    motivo_perda: motivoPerdaVal,
  };
  // NOTA: valor_venda NAO e campo de leads — pertence a comissoes. Nao enviar dados_extras.

  const btn=document.getElementById('ml-salvar');
  btn.disabled=true;
  document.getElementById('ml-salvar-txt').textContent='Salvando...';
  document.getElementById('ml-spinner').classList.remove('hidden');

  try {
    if (id) {
      // Lead existente: salva dados gerais e, se a etapa mudou, move o lead (o /mover atualiza o status corretamente)
      const leadAtual = _leads.find(l=>l.id===id);
      const etapaMudou = leadAtual && leadAtual.etapa_id !== etapaId;
      const r = await Auth.api('PATCH',`/leads/${id}`,body);
      if (r?.ok) {
        if (etapaId && etapaMudou) {
          const etapaSel = _etapas.find(e=>e.id===etapaId);
          const isPerdidoSel = etapaSel?.is_perdido || etapaSel?.probabilidade===0 ||
            etapaSel?.nome?.toLowerCase().includes('perdid') ||
            etapaSel?.nome?.toLowerCase().includes('desqualif');
          if (isPerdidoSel && !motivoPerdaVal) {
            alertEl.className='alert alert-error';
            alertEl.textContent='Selecione o Motivo de Perda antes de mover para esta etapa.';
            alertEl.style.display='';
            btn.disabled=false;
            document.getElementById('ml-salvar-txt').textContent='Salvar';
            document.getElementById('ml-spinner').classList.add('hidden');
            return;
          }
          const payload = { etapa_id:etapaId, pipeline_id:pipelineId };
          if (isPerdidoSel && motivoPerdaVal) payload.motivo_perda = motivoPerdaVal;
          await Auth.api('PATCH',`/leads/${id}/mover`,payload);
        }
        Toast.show('Lead atualizado!','success');
        fecharModal();
        await carregarLeads();
      } else {
        alertEl.className='alert alert-error'; alertEl.textContent=r?.data?.erro||'Erro.'; alertEl.style.display='';
      }
    } else {
      // Novo lead: POST cria com status=ABERTO automaticamente no backend
      const r = await Auth.api('POST','/leads',body);
      if (r?.ok) {
        Toast.show('Lead criado!','success');
        fecharModal();
        await carregarLeads();
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
  if (r?.ok) { Toast.show('Lead excluído.','success'); fecharModal(); await carregarLeads(); }
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

// ── Events ────────────────────────────────────────────────────
function bindEvents() {
  // Filtros
  document.getElementById('sel-funil').addEventListener('change', async e => {
    _filtros.funil=e.target.value; await aplicarFiltros();
  });
  document.getElementById('sel-resp').addEventListener('change', e => {
    _filtros.resp=e.target.value; carregarLeads();
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
  document.getElementById('btn-novo-lead').addEventListener('click', ()=>abrirNovoLead(_etapas[0]?.id||''));
  document.getElementById('ml-close').addEventListener('click', fecharModal);
  document.getElementById('ml-cancelar').addEventListener('click', fecharModal);
  document.getElementById('ml-salvar').addEventListener('click', salvarLead);
  document.getElementById('ml-excluir').addEventListener('click', excluirLead);
  document.getElementById('btn-add-nota').addEventListener('click', adicionarNota);
  document.getElementById('ov-lead').addEventListener('click', e=>{ if(e.target===document.getElementById('ov-lead')) fecharModal(); });
  document.getElementById('tab-btn-dados').addEventListener('click',()=>showTab('dados'));
  document.getElementById('tab-btn-hist').addEventListener('click',()=>{ showTab('hist'); const id=document.getElementById('fl-id').value; if(id) carregarHistorico(id); });
  document.getElementById('fl-funil').addEventListener('change',()=>onFlFunilChange());
  // Modal motivo de perda
  document.getElementById('btn-motivo-confirmar').addEventListener('click', confirmarMotivo);
  document.getElementById('btn-motivo-cancelar').addEventListener('click', fecharModalMotivo);
  document.getElementById('ov-motivo').addEventListener('click', e=>{ if(e.target===document.getElementById('ov-motivo')) fecharModalMotivo(); });
}

init();
