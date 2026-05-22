/** PROSPERKT CRM — comissoes.js (v2) */
let _usuario=null, _canEdit=false, _funis=[], _usuarios=[], _regras=[];

const fmtR = v => 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN = v => Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:1});
const STATUS_BADGE = {
  PENDENTE:'<span class="status-badge pendente">Pendente</span>',
  APROVADA:'<span class="status-badge aprovada">Aprovada</span>',
  PAGA:'<span class="status-badge paga">Paga</span>',
  CANCELADA:'<span class="status-badge cancelada">Cancelada</span>',
};

async function init() {
  _usuario = await Sidebar.init('comissoes');
  if (!_usuario) return;
  _canEdit = _usuario.role === 'SUPER_ADMIN';

  // Botões de admin
  if (_canEdit) {
    document.getElementById('btn-nova-regra').style.display  = '';
    document.getElementById('btn-nova-regra-2').style.display = '';
  }
  // Esconde filtro de vendedor para vendedor
  if (_usuario.role === 'VENDEDOR') {
    const fg = document.getElementById('fg-vendedor');
    if (fg) fg.style.display = 'none';
  }

  const hoje = new Date();
  document.getElementById('f-mes').value = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;

  await Promise.all([carregarFunis(), carregarUsuarios()]);
  await Promise.all([carregarPainel(), carregarRegras()]);
  bindEvents();
  setInterval(carregarPainel, 60000);
}

async function carregarFunis() {
  const r = await Auth.api('GET','/funis');
  _funis = r?.data?.dados||[];
  const opts = _funis.map(f=>`<option value="${f.id}">${f.nome}</option>`).join('');
  document.getElementById('f-funil').innerHTML  = '<option value="">Todos</option>'+opts;
  document.getElementById('r-funil').innerHTML  = '<option value="">Todos os funis</option>'+opts;
}

async function carregarUsuarios() {
  if (_usuario.role === 'VENDEDOR') return;
  const r = await Auth.api('GET','/usuarios');
  _usuarios = (r?.data?.dados||[]).filter(u=>u.ativo);
  const opts = _usuarios.map(u=>`<option value="${u.id}">${u.nome}</option>`).join('');
  const fv = document.getElementById('f-vendedor');
  if (fv) fv.innerHTML = '<option value="">Todos</option>'+opts;
  document.getElementById('r-vendedor').innerHTML = '<option value="">Todos os vendedores</option>'+opts;
}

// ── Painel ───────────────────────────────────────────────────
async function carregarPainel() {
  const mes    = document.getElementById('f-mes').value;
  const funil  = document.getElementById('f-funil').value;
  const vendEl = document.getElementById('f-vendedor');
  const vend   = vendEl ? vendEl.value : '';
  const params = [];
  if (mes)   params.push('mes='+mes);
  if (funil) params.push('funil_id='+funil);
  if (vend)  params.push('usuario_id='+vend);
  const r = await Auth.api('GET','/comissoes/painel'+(params.length?'?'+params.join('&'):''));
  if (!r?.ok) { Toast.show('Erro ao carregar painel.','error'); return; }
  renderPainel(r.data.dados);
  document.getElementById('ultima-att').textContent = 'Atualizado '+new Date().toLocaleTimeString('pt-BR');
}

function renderPainel(d) {
  const { ranking, totais, por_funil } = d;
  const isVend = _usuario.role === 'VENDEDOR';

  // ── Summary bar ─────────────────────────────────────────────
  // Determina dados a exibir: 1 vendedor filtrado ou totais da equipe
  const filtroVend = document.getElementById('f-vendedor');
  const vendFiltrado = filtroVend && filtroVend.value ? ranking.find(v => v.usuario_id === filtroVend.value) : null;
  const src = isVend ? ranking[0] : vendFiltrado;  // dados do vendedor específico (se existir)

  // Extrai valores (zerado se nenhum dado)
  const qtdVendas   = src ? src.qtd_vendas    : (isVend ? 0 : totais.qtd_vendas);
  const fatReal     = src ? src.total_vendido  : (isVend ? 0 : totais.total_vendido);
  const comissao    = src ? src.total_comissao : (isVend ? 0 : totais.total_comissao);
  const bonus       = src ? src.bonus_a_receber : (isVend ? 0 : totais.bonus_total);
  const salario     = src ? src.salario_fixo   : (isVend ? 0 : totais.salario_total);
  const totalRec    = src ? src.total_a_receber : (isVend ? 0 : totais.total_a_receber);
  const vendId      = src ? src.usuario_id : (isVend ? _usuario.id : null);
  const podeEditar  = _usuario.role !== 'VENDEDOR';

  // Edição inline de salário
  const salarioCard = podeEditar && vendId
    ? `<div class="sum-card edit-card" id="salary-card-${vendId}" title="Clique para editar o salário fixo">
         <div class="sum-label">Salário Fixo <span style="font-size:.6rem;opacity:.6">✎</span></div>
         <div class="sum-val" id="salary-display-${vendId}" onclick="iniciarEdicaoSalario('${vendId}',${salario})"
              style="cursor:pointer">${fmtR(salario)}</div>
       </div>`
    : `<div class="sum-card">
         <div class="sum-label">Salário Fixo</div>
         <div class="sum-val">${fmtR(salario)}</div>
       </div>`;

  document.getElementById('summary-bar').innerHTML = `
    <div class="sum-card">
      <div class="sum-label">Vendas Realizadas</div>
      <div class="sum-val">${qtdVendas}</div>
    </div>
    <div class="sum-card blue">
      <div class="sum-label">Faturamento Realizado</div>
      <div class="sum-val">${fmtR(fatReal)}</div>
    </div>
    <div class="sum-card green">
      <div class="sum-label">Comissão a Receber</div>
      <div class="sum-val" style="color:var(--green)">${fmtR(comissao)}</div>
    </div>
    <div class="sum-card gold">
      <div class="sum-label">Bônus a Receber${src?.meta_atingida ? ' 🏆' : ''}</div>
      <div class="sum-val" style="color:#FFB627">${fmtR(bonus)}</div>
    </div>
    ${salarioCard}
    <div class="sum-card" style="border-color:var(--green)">
      <div class="sum-label">Total a Receber</div>
      <div class="sum-val" style="color:var(--green);font-size:1.15rem">${fmtR(totalRec)}</div>
    </div>
  `;

  // ── Por funil (admin/gestor) ─────────────────────────────────
  const pfWrap = document.getElementById('por-funil-wrap');
  if (!isVend && por_funil?.length) {
    pfWrap.style.display = '';
    const maxF = Math.max(...por_funil.map(f=>f.total_comissao||0), 1);
    document.getElementById('por-funil').innerHTML = por_funil.map(f => `
      <div class="funil-row">
        <span style="min-width:120px;font-size:.8125rem;font-weight:600">${f.funil_nome||'—'}</span>
        <div class="funil-bar-bg"><div class="funil-bar" style="width:${Math.round((f.total_comissao/maxF)*100)}%"></div></div>
        <span style="min-width:90px;text-align:right;font-size:.8125rem;font-weight:700;color:var(--green)">${fmtR(f.total_comissao)}</span>
        <span style="min-width:60px;text-align:right;font-size:.75rem;color:var(--text-muted)">${f.qtd} venda${f.qtd!==1?'s':''}</span>
      </div>`).join('');
  } else {
    pfWrap.style.display = 'none';
  }

  // ── Ranking vendedores ───────────────────────────────────────
  const wrap = document.getElementById('ranking-wrap');
  if (!ranking?.length) {
    wrap.innerHTML='<div class="empty-state">Nenhuma comissão registrada neste período.<br><small>Mova um lead para etapa VENDAS (GANHO) para calcular automaticamente.</small></div>';
    return;
  }

  const posClass = ['gold','silver','bronze'];
  wrap.innerHTML = ranking.map((v,i) => `
    <div class="rank-card">
      <div class="rank-head" data-uid="${v.usuario_id}">
        <div class="rank-pos ${posClass[i]||''}">${i+1}</div>
        <div class="rank-avatar">${(v.vendedor_nome||'?').slice(0,2).toUpperCase()}</div>
        <div class="rank-info">
          <div class="rank-name">${v.vendedor_nome||'—'}${v.meta_atingida?' <span class="rank-meta-badge">🏆 Meta</span>':''}</div>
          <div class="rank-detail">${v.qtd_vendas} venda${v.qtd_vendas!==1?'s':''} · Clique para expandir</div>
        </div>
        <div class="rank-vals">
          <div class="rv"><div class="rv-val">${fmtR(v.total_vendido)}</div><div class="rv-lbl">Faturado</div></div>
          <div class="rv"><div class="rv-val" style="color:var(--green)">${fmtR(v.total_comissao)}</div><div class="rv-lbl">Comissão</div></div>
          <div class="rv"><div class="rv-val" style="color:var(--green);font-size:1rem">${fmtR(v.total_a_receber||0)}</div><div class="rv-lbl">Total</div></div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:8px;flex-shrink:0;color:var(--text-muted)"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="rank-body" id="body-${v.usuario_id}">
        <table class="items-table">
          <thead><tr><th>Lead</th><th>Empresa</th><th>Venda (R$)</th><th>Comissão</th><th>Status</th>${_canEdit?'<th>Ação</th>':''}</tr></thead>
          <tbody>
            ${(v.items||[]).map(it=>`
              <tr>
                <td>${it.lead_nome||'—'}</td>
                <td style="color:var(--text-muted)">${it.empresa||'—'}</td>
                <td style="font-weight:700">${fmtR(it.valor_venda)}</td>
                <td style="font-weight:800;color:var(--green)">${fmtR(it.valor_comissao)}</td>
                <td>${STATUS_BADGE[it.status]||it.status}</td>
                ${_canEdit?`<td>
                  <select class="fs" style="min-width:100px;padding:4px 8px;font-size:.75rem" data-comid="${it.id}" onchange="atualizarStatus(this)">
                    <option value="PENDENTE" ${it.status==='PENDENTE'?'selected':''}>Pendente</option>
                    <option value="APROVADA" ${it.status==='APROVADA'?'selected':''}>Aprovar</option>
                    <option value="PAGA" ${it.status==='PAGA'?'selected':''}>Paga</option>
                    <option value="CANCELADA" ${it.status==='CANCELADA'?'selected':''}>Cancelar</option>
                  </select>
                </td>`:''}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`).join('');

  // Accordion
  wrap.querySelectorAll('.rank-head').forEach(head => {
    head.addEventListener('click', () => {
      const body = document.getElementById('body-'+head.dataset.uid);
      if (body) body.classList.toggle('open');
    });
  });
}

// ── Edição inline de salário ───────────────────────────────────────────────────
function iniciarEdicaoSalario(vendId, valorAtual) {
  const display = document.getElementById(`salary-display-${vendId}`);
  if (!display) return;

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '0.01';
  input.value = valorAtual || 0;
  input.style.cssText = 'width:100%;background:var(--surface-2);border:1px solid var(--green);border-radius:6px;color:var(--text-primary);font-family:inherit;font-size:.95rem;font-weight:800;padding:3px 6px;outline:none';

  display.replaceWith(input);
  input.focus();
  input.select();

  const salvar = async () => {
    const novoVal = parseFloat(input.value) || 0;
    const r = await Auth.api('PATCH', `/comissoes/salario/${vendId}`, { salario_fixo: novoVal });
    if (r?.ok) {
      Toast.show('Salário atualizado!', 'success');
      await carregarPainel();  // recarrega tudo para refletir novo total
    } else {
      Toast.show(r?.data?.erro || 'Erro ao salvar salário.', 'error');
      input.replaceWith(display);  // restaura display
    }
  };

  input.addEventListener('keydown', e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') input.replaceWith(display); });
  input.addEventListener('blur', salvar);
}



async function atualizarStatus(sel) {
  const id = sel.dataset.comid;
  const r  = await Auth.api('PATCH',`/comissoes/${id}/status`,{ status:sel.value });
  if (r?.ok) Toast.show('Status atualizado!','success');
  else { Toast.show(r?.data?.erro||'Erro.','error'); await carregarPainel(); }
}

// ── Regras ───────────────────────────────────────────────────
async function carregarRegras() {
  const r = await Auth.api('GET','/comissoes/regras');
  _regras = r?.data?.dados||[];
  renderRegras();
}

function renderRegras() {
  const tbody = document.getElementById('regras-tbody');
  if (!_regras.length) { tbody.innerHTML='<tr><td colspan="8" class="empty-state">Nenhuma regra configurada ainda.</td></tr>'; updateFaixasPreview(); return; }
  tbody.innerHTML = _regras.map(r => {
    const faixaStr = (r.valor_min>0||r.valor_max)
      ? `${fmtR(r.valor_min)} → ${r.valor_max?fmtR(r.valor_max):'∞'}`
      : 'Qualquer valor';
    const comStr   = r.tipo_calculo==='PERCENTUAL' ? `${fmtN(r.percentual)}%` : fmtR(r.valor_fixo);
    const bonusStr = r.bonus_meta_pct>0 ? `+${fmtR(r.bonus_meta_pct)}` : '—';
    const vNome    = _usuarios.find(u=>u.id===r.usuario_id)?.nome || 'Todos';
    const fNome    = _funis.find(f=>f.id===r.funil_id)?.nome    || 'Todos';
    return `<tr>
      <td><strong>${r.nome}</strong></td>
      <td><span class="tipo-badge ${r.tipo_calculo==='PERCENTUAL'?'pct':'fix'}">${r.tipo_calculo}</span></td>
      <td style="font-size:.8125rem">${faixaStr}</td>
      <td style="font-weight:700;color:var(--green)">${comStr}</td>
      <td style="color:var(--pink);font-size:.8125rem">${bonusStr}</td>
      <td style="font-size:.8125rem">${vNome}</td>
      <td style="font-size:.8125rem">${fNome}</td>
      <td>${_canEdit?`<div style="display:flex;gap:4px">
        <button class="btn btn-ghost btn-sm" data-edit="${r.id}" title="Editar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-ghost btn-sm" data-del="${r.id}" style="color:var(--pink)" title="Excluir">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>`:'—'}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-edit]').forEach(btn=>btn.addEventListener('click',()=>abrirEditar(btn.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(btn =>btn.addEventListener('click',()=>deletarRegra(btn.dataset.del)));
  updateFaixasPreview();
}

function updateFaixasPreview() {
  const regrasGerais = _regras.filter(r=>!r.usuario_id&&!r.funil_id&&r.tipo_calculo==='PERCENTUAL').sort((a,b)=>(a.valor_min||0)-(b.valor_min||0));
  const wrap = document.getElementById('faixas-preview');
  if (!regrasGerais.length) { wrap.style.display='none'; return; }
  wrap.style.display='';
  document.getElementById('faixas-lista').innerHTML = regrasGerais.map(r=>`
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:160px;font-size:.8125rem;color:var(--text-muted)">
        ${r.valor_min>0?fmtR(r.valor_min)+' +':'Até '+fmtR(r.valor_max||99999999)}
      </div>
      <div style="flex:1;height:4px;background:var(--surface-2);border-radius:2px;overflow:hidden">
        <div style="height:100%;background:var(--grad-brand);width:${Math.min(r.percentual*10,100)}%;border-radius:2px"></div>
      </div>
      <div style="font-size:1rem;font-weight:800;color:var(--green);min-width:50px;text-align:right">${fmtN(r.percentual)}%</div>
      <div style="font-size:.75rem;color:var(--text-muted)">sobre faturamento</div>
    </div>`).join('');
}

// Modal
function abrirModal(modo='criar',regra=null) {
  document.getElementById('modal-title').textContent = modo==='criar'?'Nova Regra de Comissão':'Editar Regra';
  document.getElementById('r-id').value      = regra?.id||'';
  document.getElementById('r-nome').value    = regra?.nome||'';
  document.getElementById('r-tipo').value    = regra?.tipo_calculo||'PERCENTUAL';
  document.getElementById('r-valor').value   = regra?.tipo_calculo==='FIXO' ? regra?.valor_fixo : (regra?.percentual||'');
  document.getElementById('r-min').value     = regra?.valor_min||'';
  document.getElementById('r-max').value     = regra?.valor_max||'';
  document.getElementById('r-bonus').value   = regra?.bonus_meta_pct||'';
  document.getElementById('r-vendedor').value= regra?.usuario_id||'';
  document.getElementById('r-funil').value   = regra?.funil_id||'';
  document.getElementById('modal-alert').style.display='none';
  updateValorLabel();
  document.getElementById('modal-ov').classList.add('open');
  document.getElementById('r-nome').focus();
}
function abrirEditar(id) { const r=_regras.find(x=>x.id===id); if(r) abrirModal('editar',r); }
function fecharModal() { document.getElementById('modal-ov').classList.remove('open'); }
function updateValorLabel() {
  const tipo = document.getElementById('r-tipo').value;
  document.getElementById('r-valor-label').textContent = tipo==='PERCENTUAL'?'Percentual (%) *':'Valor fixo (R$) *';
}

async function salvarRegra() {
  const id   = document.getElementById('r-id').value;
  const nome = document.getElementById('r-nome').value.trim();
  const tipo = document.getElementById('r-tipo').value;
  const val  = parseFloat(document.getElementById('r-valor').value)||0;
  const alertEl = document.getElementById('modal-alert');
  alertEl.style.display='none';
  if (!nome) { alertEl.className='alert alert-error'; alertEl.textContent='Nome obrigatório.'; alertEl.style.display=''; return; }
  const body = {
    nome, tipo_calculo:tipo,
    percentual:    tipo==='PERCENTUAL'?val:0,
    valor_fixo:    tipo==='FIXO'?val:0,
    valor_min:     parseFloat(document.getElementById('r-min').value)||0,
    valor_max:     parseFloat(document.getElementById('r-max').value)||null,
    bonus_meta_valor: parseFloat(document.getElementById('r-bonus').value)||0,
    usuario_id:    document.getElementById('r-vendedor').value||undefined,
    funil_id:      document.getElementById('r-funil').value||undefined,
  };
  const btn=document.getElementById('modal-salvar');
  btn.disabled=true;
  document.getElementById('modal-salvar-txt').textContent='Salvando...';
  document.getElementById('modal-spinner').classList.remove('hidden');
  try {
    const r = id ? await Auth.api('PATCH',`/comissoes/regras/${id}`,body) : await Auth.api('POST','/comissoes/regras',body);
    if (r?.ok) { Toast.show(id?'Regra atualizada!':'Regra criada!','success'); fecharModal(); await carregarRegras(); }
    else { alertEl.className='alert alert-error'; alertEl.textContent=r?.data?.erro||'Erro.'; alertEl.style.display=''; }
  } finally {
    btn.disabled=false;
    document.getElementById('modal-salvar-txt').textContent='Salvar regra';
    document.getElementById('modal-spinner').classList.add('hidden');
  }
}

async function deletarRegra(id) {
  if (!confirm('Excluir esta regra? Comissões já calculadas não serão afetadas.')) return;
  const r = await Auth.api('DELETE',`/comissoes/regras/${id}`);
  if (r?.ok) { Toast.show('Regra excluída.','success'); await carregarRegras(); }
  else Toast.show(r?.data?.erro||'Erro.','error');
}

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    });
  });
  document.getElementById('btn-filtrar').addEventListener('click',carregarPainel);
  document.getElementById('btn-limpar').addEventListener('click',()=>{
    document.getElementById('f-funil').value='';
    const fv=document.getElementById('f-vendedor'); if(fv) fv.value='';
    carregarPainel();
  });
  document.getElementById('btn-refresh').addEventListener('click',()=>Promise.all([carregarPainel(),carregarRegras()]));
  document.getElementById('btn-nova-regra').addEventListener('click',()=>abrirModal('criar'));
  document.getElementById('btn-nova-regra-2').addEventListener('click',()=>abrirModal('criar'));
  document.getElementById('modal-close').addEventListener('click',fecharModal);
  document.getElementById('modal-cancelar').addEventListener('click',fecharModal);
  document.getElementById('modal-salvar').addEventListener('click',salvarRegra);
  document.getElementById('modal-ov').addEventListener('click',e=>{if(e.target===document.getElementById('modal-ov'))fecharModal();});
  document.getElementById('r-tipo').addEventListener('change',updateValorLabel);
}

init();
