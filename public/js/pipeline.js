/**
 * PROSPERKT CRM — Pipeline JS
 * Kanban, filtros, modal de lead
 */

let _funis=[], _etapas=[], _leads=[], _usuarios=[], _usuario=null;
let _funilAtivo=null, _pipelineAtivo=null;
let _dragLeadId=null, _dragEtapaOrigem=null;
// Estado de filtros
let _filtros = { funil:'', resp:'', dataTipo:'', dataPeriodo:'', dataInicio:'', dataFim:'', busca:'' };

// ── Init ──────────────────────────────────────────────────────
async function init() {
  _usuario = await Sidebar.init('pipeline');
  if (!_usuario) return;
  await Promise.all([carregarFunis(), carregarUsuarios()]);

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

  // Título
  if (funilId) {
    const f = _funis.find(x=>x.id===funilId);
    document.getElementById('page-title').textContent = `Pipeline — ${f?.nome||''}`;
    document.getElementById('page-sub').textContent = `Leads do funil ${f?.nome||''}`;
    // carrega etapas do funil selecionado
    const rd = await Auth.api('GET',`/funis/${funilId}`);
    if (rd?.ok) { _pipelineAtivo = rd.data.dados.pipeline_id; _etapas = rd.data.dados.etapas||[]; }
  } else {
    document.getElementById('page-title').textContent = 'Pipeline — Todos os Funis';
    document.getElementById('page-sub').textContent = 'Visão geral de todos os leads';
    // Sem funil selecionado: agrupa todas as etapas únicas por nome
    _pipelineAtivo = null;
    _etapas = [];
    // Carrega etapas do 1o funil para mostrar colunas padrão
    if (_funis.length) {
      const rd = await Auth.api('GET',`/funis/${_funis[0].id}`);
      if (rd?.ok) _etapas = rd.data.dados.etapas||[];
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
  const etapasParaMostrar = _etapas;
  const mostrarFunil = !_filtros.funil; // no modo "Todos", mostra badge do funil no card

  etapasParaMostrar.forEach(etapa => {
    const leads = _leads.filter(l=>l.etapa_id===etapa.id);
    const col = document.createElement('div');
    col.className = 'kanban-col';

    col.innerHTML = `
      <div class="col-header">
        <div class="col-dot" style="background:${etapa.cor}"></div>
        <span class="col-title">${etapa.nome}</span>
        <span class="col-count">${leads.length}</span>
      </div>
      <div class="col-body" data-etapa="${etapa.id}">
        ${leads.map(l=>renderCard(l, mostrarFunil)).join('')}
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
  const payload = { etapa_id:etapaId, pipeline_id:pid };

  // Solicita motivo se etapa destino for marcada como perdida
  if (etapaDest?.is_perdido) {
    const motivo = prompt(`Motivo da perda para "${lead?.nome || 'lead'}" (obrigatório):`);
    if (!motivo) { _dragLeadId=null; _dragEtapaOrigem=null; return; }
    payload.motivo_perda = motivo;
  }

  const r = await Auth.api('PATCH',`/leads/${_dragLeadId}/mover`, payload);
  if (r?.ok) {
    const msg = etapaDest?.is_ganho ? '🎉 Lead ganho!' : etapaDest?.is_perdido ? 'Lead marcado como perdido.' : 'Lead movido!';
    const tipo = etapaDest?.is_ganho ? 'success' : etapaDest?.is_perdido ? 'error' : 'success';
    Toast.show(msg, tipo);
    await carregarLeads();
  } else {
    Toast.show(r?.data?.erro||'Erro ao mover.','error');
  }
  _dragLeadId=null; _dragEtapaOrigem=null;
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
  document.getElementById('fl-valor-venda').value=l.valor_venda||'';
  document.getElementById('fl-status').value=l.status||'ABERTO';
  atualizarStatusBadge(l.status||'ABERTO');
  document.getElementById('fl-tags').value=l.tags?JSON.parse(l.tags).join(', '):'';
  document.getElementById('fl-data-fechamento').value=l.data_fechamento?l.data_fechamento.slice(0,10):'';
  document.getElementById('fl-data-entrada').value=l.criado_em?l.criado_em.slice(0,10):'';
  // Funil do lead
  const funilId = _filtros.funil || (l.funil_id_real||'');
  await onFlFunilChange(funilId);
  document.getElementById('fl-funil').value=funilId;
  document.getElementById('fl-etapa').value=l.etapa_id||'';
  document.getElementById('fl-resp').value=l.responsavel_id||'';
  // Histórico
  const hist=document.getElementById('hist-list');
  hist.innerHTML=(l.mensagens||[]).length
    ?(l.mensagens).map(m=>`<div class="hist-item"><div>${m.conteudo}</div><div class="hist-meta">${m.autor_nome||'Sistema'} · ${new Date(m.enviado_em).toLocaleString('pt-BR')}</div></div>`).join('')
    :'<p style="color:var(--text-muted);font-size:.875rem">Sem histórico ainda.</p>';
  // Botão excluir só para GESTOR+
  document.getElementById('ml-excluir').style.display = _usuario.role!=='VENDEDOR' ? '' : 'none';
  document.getElementById('ov-lead').classList.add('open');
}

function resetModal() {
  document.getElementById('ml-title').textContent='Novo Lead';
  ['fl-id','fl-nome','fl-empresa','fl-tel','fl-email','fl-tags','fl-obs'].forEach(id=>document.getElementById(id).value='');
  ['fl-valor','fl-valor-venda'].forEach(id=>document.getElementById(id).value='');
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
  // pipeline_id: busca da etapa/funil selecionado
  let pipelineId=_pipelineAtivo;
  if (funilId && funilId!==_filtros.funil) {
    const rd=await Auth.api('GET',`/funis/${funilId}`);
    if (rd?.ok) pipelineId=rd.data.dados.pipeline_id;
  }

  const tagsRaw=document.getElementById('fl-tags').value;
  const body={
    nome,
    empresa:   document.getElementById('fl-empresa').value.trim()||undefined,
    telefone:  document.getElementById('fl-tel').value.trim()||undefined,
    email:     document.getElementById('fl-email').value.trim()||undefined,
    valor:     parseFloat(document.getElementById('fl-valor').value)||0,
    // NOTA: 'status' não é enviado aqui — é controlado exclusivamente por /mover (via is_ganho/is_perdido da etapa)
    data_fechamento: document.getElementById('fl-data-fechamento').value||undefined,
    etapa_id:  etapaId||undefined,
    pipeline_id: pipelineId||undefined,
    responsavel_id: document.getElementById('fl-resp').value||undefined,
    tags: tagsRaw?tagsRaw.split(',').map(t=>t.trim()).filter(Boolean):[],
    observacoes: document.getElementById('fl-obs').value.trim()||undefined,
  };
  // valor_venda salvo como dados_extras ou campo atualizado
  const valorVenda=parseFloat(document.getElementById('fl-valor-venda').value);
  if (valorVenda>0) body.dados_extras=JSON.stringify({ valor_venda: valorVenda });

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
        if (etapaId && (etapaMudou || !leadAtual)) {
          // motivo_perda pode ser necessário — se o mover falhar por isso, avisar
          const etapaSel = _etapas.find(e=>e.id===etapaId);
          const payload = { etapa_id:etapaId, pipeline_id:pipelineId };
          if (etapaSel?.is_perdido) {
            const motivo = prompt('Motivo da perda (obrigatório):');
            if (!motivo) { alertEl.className='alert alert-error'; alertEl.textContent='Motivo da perda é obrigatório.'; alertEl.style.display=''; btn.disabled=false; document.getElementById('ml-salvar-txt').textContent='Salvar'; document.getElementById('ml-spinner').classList.add('hidden'); return; }
            payload.motivo_perda = motivo;
          }
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
  document.getElementById('tab-btn-hist').addEventListener('click',()=>showTab('hist'));
  document.getElementById('fl-funil').addEventListener('change',()=>onFlFunilChange());
}

init();
