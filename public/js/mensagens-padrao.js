/**
 * PROSPERKT CRM — Biblioteca de Mensagens v4
 * Categorias dinâmicas carregadas do DB
 * categoria = "CatPai|Subcategoria", titulo = cadência "D+2"
 */

const SEP = '|';
let _usuario = null, _msgs = [], _funis = [], _estrutura = [];
let _canEdit = false, _editId = null, _delId = null;
let _buscaVal = '', _catAtiva = null, _subcatAtiva = null, _mostraFavs = false;
let _favs = new Set();
let _catAberta = new Set();
let _cadAberta = new Set();
let _modoOrdem = false; // modo de reordenação ativo

const FAV_KEY = 'sc_favs_v3';
function loadFavs(){ try{_favs=new Set(JSON.parse(localStorage.getItem(FAV_KEY)||'[]'))}catch{_favs=new Set()} }
function saveFavs(){ localStorage.setItem(FAV_KEY,JSON.stringify([..._favs])) }
function parseCat(c){ const i=(c||'').indexOf(SEP); return i<0?{cat:c||'',sub:''}:{cat:c.slice(0,i),sub:c.slice(i+1)} }
function buildCat(c,s){ return s?`${c}${SEP}${s}`:c }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

// ── Init ────────────────────────────────────────────────────────────────────
async function init(){
  _usuario = await Sidebar.init('mensagens-padrao');
  if(!_usuario) return;
  loadFavs();
  _canEdit = ['SUPER_ADMIN','GESTOR'].includes(_usuario.role);
  const isSuperAdmin = _usuario.role === 'SUPER_ADMIN';

  if(_canEdit) document.getElementById('btn-nova').style.display='';
  else document.getElementById('info-perm').style.display='';
  if(isSuperAdmin) document.getElementById('btn-nova-cat').style.display='';

  await Promise.all([carregarEstrutura(), carregarFunis()]);
  await carregarMensagens();
  bindEvents();
}

// ── API ─────────────────────────────────────────────────────────────────────
async function carregarEstrutura(){
  const r = await Auth.api('GET','/mensagens-padrao/categorias');
  _estrutura = r?.data?.dados || [];
  _estrutura.forEach(c => _catAberta.add(c.nome));
  popularSelectsCat();
}

async function carregarFunis(){
  const r = await Auth.api('GET','/funis?somente_ativos=true');
  _funis = r?.data?.dados||[];
  const s = document.getElementById('f-funil');
  s.innerHTML='<option value="">Todos os funis</option>'+_funis.map(f=>`<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join('');
}

async function carregarMensagens(){
  const p = new URLSearchParams();
  if(_buscaVal) p.set('busca',_buscaVal);
  const r = await Auth.api('GET',`/mensagens-padrao?${p}`);
  if(!r?.ok){ Toast.show('Erro ao carregar mensagens.','error'); return; }
  _msgs = r.data.dados||[];
  // Recarrega estrutura para refletir novas categorias criadas
  const re = await Auth.api('GET','/mensagens-padrao/categorias');
  if(re?.ok){ _estrutura = re.data.dados||[]; popularSelectsCat(); }
  renderNav(); renderMain();
}

function popularSelectsCat(){
  const selCat = document.getElementById('f-cat');
  const selCatForm = document.getElementById('fc-cat');
  const opts = _estrutura.map(c=>`<option value="${esc(c.nome)}">${esc(c.nome)}</option>`).join('');
  if(selCat) selCat.innerHTML = opts || '<option value="">Sem categorias</option>';
  if(selCatForm) selCatForm.innerHTML = '<option value="">-- Selecione --</option>' + opts;
  atualizarSubcats();
}

function atualizarSubcats(){
  const cat = document.getElementById('f-cat')?.value;
  const catRef = _estrutura.find(c=>c.nome===cat);
  const subs = catRef?.subs || [];
  const selSub = document.getElementById('f-subcat');
  if(selSub) selSub.innerHTML = subs.map(s=>`<option value="${esc(s.nome)}">${esc(s.nome)}</option>`).join('') || '<option value="">Sem subcategorias</option>';
  atualizarCadencias();
}

function atualizarCadencias(){
  const cat = document.getElementById('f-cat')?.value;
  const sub = document.getElementById('f-subcat')?.value;
  const catRef = _estrutura.find(c=>c.nome===cat);
  const subRef = catRef?.subs.find(s=>s.nome===sub);
  const cads = subRef?.cads || [];
  const sel = document.getElementById('f-cadencia');
  if(sel) sel.innerHTML = cads.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('') || '<option value="">D+?</option>';
}

// ── Filtro ──────────────────────────────────────────────────────────────────
function filtrar(){
  return _msgs.filter(m=>{
    const {cat,sub}=parseCat(m.categoria);
    if(_mostraFavs&&!_favs.has(m.id)) return false;
    if(_catAtiva&&cat!==_catAtiva) return false;
    if(_subcatAtiva&&sub!==_subcatAtiva) return false;
    if(_buscaVal){
      const q=_buscaVal.toLowerCase();
      if(!m.titulo.toLowerCase().includes(q)&&!(m.texto||'').toLowerCase().includes(q)&&!cat.toLowerCase().includes(q)&&!sub.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

// ── Render Nav ──────────────────────────────────────────────────────────────
function renderNav(){
  const el = document.getElementById('sc-nav-list');
  const countCat={}, countSub={};
  _msgs.forEach(m=>{ const {cat,sub}=parseCat(m.categoria); countCat[cat]=(countCat[cat]||0)+1; countSub[`${cat}${SEP}${sub}`]=(countSub[`${cat}${SEP}${sub}`]||0)+1; });

  const isTodos=!_catAtiva&&!_subcatAtiva&&!_mostraFavs;
  const favN=[..._favs].filter(id=>_msgs.find(m=>m.id===id)).length;

  el.innerHTML=`
    <button class="sc-all-btn ${isTodos?'active':''}" id="nav-all">
      <span>📋 Todos</span><span style="font-size:.65rem;background:var(--surface-2);border:1px solid var(--border);border-radius:20px;padding:1px 7px;color:var(--text-muted);font-weight:700">${_msgs.length}</span>
    </button>
    <button class="sc-favs-btn ${_mostraFavs?'active':''}" id="nav-favs">
      <span>⭐ Favoritos</span>${favN>0?`<span style="font-size:.65rem;background:rgba(255,182,39,.15);color:#FFB627;border-radius:20px;padding:1px 7px;font-weight:700">${favN}</span>`:''}
    </button>
    <hr class="sc-divider">
    ${_estrutura.map(cat=>{
      const isOpen=_catAberta.has(cat.nome);
      const isCatA=_catAtiva===cat.nome&&!_subcatAtiva&&!_mostraFavs;
      const icon=cat.nome.match(/^(\S+)\s/)?.[1]||'📁';
      const adminBtns=_usuario?.role==='SUPER_ADMIN'?`
        <button class="cat-act-btn" data-rc="${esc(cat.nome)}" title="Renomear">✏️</button>
        <button class="cat-act-btn" data-dc="${esc(cat.nome)}" title="Excluir" style="color:var(--pink)">🗑️</button>`:'';
      return `
      <div class="sc-cat-hd ${isCatA?'active':''} ${isOpen?'open':''}" data-cat="${esc(cat.nome)}">
        <span>${icon}</span><span style="flex:1">${esc(cat.nome.replace(icon+' ',''))}</span>
        <span class="sc-cat-cnt">${countCat[cat.nome]||0}</span>
        ${adminBtns}
        <svg class="sc-cat-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="sc-sub-list ${isOpen?'open':''}" id="sub-list-${esc(cat.nome).replace(/\W/g,'_')}">
        ${cat.subs.map(sub=>{
          const k=`${cat.nome}${SEP}${sub.nome}`;
          const isSubA=_catAtiva===cat.nome&&_subcatAtiva===sub.nome&&!_mostraFavs;
          return `<button class="sc-sub-btn ${isSubA?'active':''}" data-cat="${esc(cat.nome)}" data-sub="${esc(sub.nome)}">
            <span>${esc(sub.nome)}</span>${(countSub[k]||0)>0?`<span class="sc-sub-cnt">${countSub[k]}</span>`:''}
          </button>`;
        }).join('')}
      </div>`;
    }).join('')}`;


  el.querySelector('#nav-all').onclick=()=>{_catAtiva=null;_subcatAtiva=null;_mostraFavs=false;renderNav();renderMain();};
  el.querySelector('#nav-favs').onclick=()=>{_catAtiva=null;_subcatAtiva=null;_mostraFavs=true;renderNav();renderMain();};
  el.querySelectorAll('.sc-cat-hd[data-cat]').forEach(hd=>{
    hd.onclick=(e)=>{
      // Se clicou em botão admin dentro do header, não navegar
      if(e.target.closest('.cat-act-btn')) return;
      const c=hd.dataset.cat;
      if(_catAberta.has(c))_catAberta.delete(c);else _catAberta.add(c);
      _catAtiva=c;_subcatAtiva=null;_mostraFavs=false;renderNav();renderMain();
    };
  });
  el.querySelectorAll('[data-rc]').forEach(btn=>{ btn.onclick=e=>{e.stopPropagation();abrirRenomearCat(btn.dataset.rc);}; });
  el.querySelectorAll('[data-dc]').forEach(btn=>{ btn.onclick=e=>{e.stopPropagation();abrirDeleteCat(btn.dataset.dc);}; });
  el.querySelectorAll('.sc-sub-btn').forEach(btn=>{
    btn.onclick=e=>{e.stopPropagation();_catAtiva=btn.dataset.cat;_subcatAtiva=btn.dataset.sub;_mostraFavs=false;renderNav();renderMain();};
  });

}

// ── Render Main ─────────────────────────────────────────────────────────────
function renderMain(){ renderStats(); renderCtx(); renderLista(); }

function renderStats(){
  document.getElementById('stat-total').textContent=_msgs.length;
  document.getElementById('stat-ativos').textContent=_msgs.filter(m=>m.ativo).length;
  document.getElementById('stat-favs').textContent=[..._favs].filter(id=>_msgs.find(m=>m.id===id)).length;
  document.getElementById('stat-cats').textContent=_estrutura.length;
}

function renderCtx(){
  const title=document.getElementById('ctx-title'), sub=document.getElementById('ctx-sub');
  if(_mostraFavs){title.textContent='⭐ Favoritos';sub.textContent='Scripts marcados como favorito';}
  else if(_subcatAtiva){title.textContent=_subcatAtiva;sub.textContent=_catAtiva;}
  else if(_catAtiva){title.textContent=_catAtiva;sub.textContent='Todas as subcategorias';}
  else{title.textContent='Todas as Mensagens';sub.textContent='Selecione uma categoria para filtrar';}
}

function renderLista(){
  const el=document.getElementById('sc-list');
  const lista=filtrar();
  if(!lista.length){
    el.innerHTML=`<div class="sc-empty"><div class="sc-empty-ico">${_mostraFavs?'⭐':'📋'}</div><div style="font-size:.88rem;font-weight:700;color:var(--text-secondary);margin-bottom:6px">${_mostraFavs?'Nenhum favorito':'Nenhuma mensagem'}</div><div style="font-size:.78rem">${_canEdit&&!_mostraFavs?'Crie a primeira mensagem clicando em "+ Nova Mensagem".':'Aguardando mensagens desta categoria.'}</div>${_canEdit&&!_mostraFavs?`<button class="btn btn-primary" style="margin-top:14px" id="btn-empty-nova">+ Nova Mensagem</button>`:''}</div>`;
    document.getElementById('btn-empty-nova')?.addEventListener('click',()=>abrirModal());
    return;
  }

  if(_subcatAtiva||((!_mostraFavs)&&_catAtiva)){
    const catRef=_estrutura.find(c=>c.nome===_catAtiva);
    const subRef=catRef?.subs.find(s=>s.nome===_subcatAtiva);
    if(subRef){
      const ordemCad=subRef.cads||[];
      const grupos={};
      ordemCad.forEach(c=>grupos[c]=[]);
      lista.forEach(m=>{const g=grupos[m.titulo];if(g)g.push(m);else{grupos['Outros']=grupos['Outros']||[];grupos['Outros'].push(m);}});
      el.innerHTML=[...ordemCad,'Outros'].filter(cad=>(grupos[cad]||[]).length>0).map(cad=>{
        const items=grupos[cad]||[];
        const cadKey=`${_catAtiva}|${_subcatAtiva}|${cad}`;
        const isOpen=_cadAberta.has(cadKey);
        return `<div class="sc-cad-group">
          <div class="sc-cad-hd ${isOpen?'open':''}" data-cadkey="${esc(cadKey)}">
            <span class="sc-cad-badge">${esc(cad)}</span>
            <span class="sc-cad-cnt">${items.length} mensagem${items.length>1?'s':''}</span>
            <svg class="sc-cad-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="sc-card-wrap ${isOpen?'open':''}" id="cwrap-${esc(cadKey).replace(/\W/g,'_')}">
            ${items.map(m=>renderCard(m)).join('')}
          </div>
        </div>`;
      }).join('');
      el.querySelectorAll('.sc-cad-hd').forEach(hd=>{
        hd.onclick=()=>{const k=hd.dataset.cadkey;if(_cadAberta.has(k))_cadAberta.delete(k);else _cadAberta.add(k);renderLista();};
      });
    } else { el.innerHTML=lista.map(m=>renderCard(m)).join(''); }
  } else { el.innerHTML=lista.map(m=>renderCard(m)).join(''); }
  bindCardEvents(lista);
}

function renderCard(m){
  const {cat,sub}=parseCat(m.categoria);
  const isFav=_favs.has(m.id);
  const icon=cat.match(/^(\S+)\s/)?.[1]||'';
  return `<div class="sc-card${isFav?' fav-card':''}" id="sc-card-${m.id}">
    <div class="sc-card-row">
      <div style="flex:1;min-width:0">
        <div class="sc-card-title">${esc(m.titulo)}</div>
        <div class="sc-card-badges">
          ${cat?`<span class="sc-badge-cat">${esc(icon?cat.replace(icon+' ',''):cat)}</span>`:''}
          ${sub?`<span class="sc-badge-sub">${esc(sub)}</span>`:''}
          ${!m.ativo?'<span style="font-size:.6rem;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(255,59,92,.1);color:#ff3b5c;border:1px solid rgba(255,59,92,.2)">Inativo</span>':''}
        </div>
      </div>
      <div class="sc-card-acts">
        <button class="sc-fav-btn ${isFav?'on':''}" data-fid="${m.id}" title="${isFav?'Remover favorito':'Favoritar'}">${isFav?'⭐':'☆'}</button>
        ${_canEdit?`<label class="toggle"><input type="checkbox" data-tid="${m.id}" ${m.ativo?'checked':''}><span class="toggle-slider"></span></label>`:''}
        <button class="sc-expand-btn" data-eid="${m.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    </div>
    <div class="sc-card-body" id="cb-${m.id}">
      <div class="sc-card-inner">
        <div class="sc-texto">${esc(m.texto||'')}</div>
        <div class="sc-card-foot">
          <span class="sc-card-info">${m.criado_por_nome?'Por '+esc(m.criado_por_nome):''}</span>
          <div style="display:flex;gap:6px;align-items:center">
            ${_canEdit?`<button class="btn btn-ghost btn-sm" data-eid2="${m.id}">Editar</button>`:''}
            ${_canEdit?`<button class="sc-dup-btn" data-dupid="${m.id}" title="Duplicar">⧉ Duplicar</button>`:''}
            ${_usuario?.role==='SUPER_ADMIN'?`<button class="btn btn-ghost btn-sm" data-did="${m.id}" style="color:var(--pink)">Excluir</button>`:''}
            <button class="sc-usar-btn" data-uid="${m.id}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              Copiar
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function bindCardEvents(lista){
  lista.forEach(m=>{
    document.querySelector(`[data-eid="${m.id}"]`)?.addEventListener('click',()=>document.getElementById(`cb-${m.id}`)?.classList.toggle('open'));
    document.querySelector(`[data-fid="${m.id}"]`)?.addEventListener('click',e=>{e.stopPropagation();_favs.has(m.id)?_favs.delete(m.id):_favs.add(m.id);saveFavs();renderNav();renderMain();});
    document.querySelector(`[data-tid="${m.id}"]`)?.addEventListener('change',el=>toggleAtivo(m.id,el.target.checked));
    document.querySelector(`[data-eid2="${m.id}"]`)?.addEventListener('click',()=>abrirModal(m.id));
    document.querySelector(`[data-did="${m.id}"]`)?.addEventListener('click',()=>confirmarDel(m.id));
    document.querySelector(`[data-dupid="${m.id}"]`)?.addEventListener('click',()=>duplicarMsg(m.id));
    document.querySelector(`[data-uid="${m.id}"]`)?.addEventListener('click',()=>copiarScript(m.id));
  });
}

function copiarScript(id){
  const m=_msgs.find(x=>x.id===id);
  if(!m) return;
  navigator.clipboard?.writeText(m.texto||'').then(()=>Toast.show('Copiado!','success')).catch(()=>Toast.show('Script pronto.','success'));
}

// ── Modal Mensagem ───────────────────────────────────────────────────────────
function abrirModal(id=null){
  _editId=id;
  document.getElementById('form-alert').style.display='none';
  document.getElementById('modal-titulo').textContent=id?'Editar Mensagem':'Nova Mensagem';
  document.getElementById('f-id').value='';
  document.getElementById('f-texto').value='';
  document.getElementById('f-ativo').checked=true;
  document.getElementById('f-funil').value='';

  if(_estrutura.length){
    document.getElementById('f-cat').value=_estrutura[0].nome;
    atualizarSubcats();
  }

  if(id){
    const m=_msgs.find(x=>x.id===id);
    if(m){
      const {cat,sub}=parseCat(m.categoria);
      document.getElementById('f-id').value=m.id;
      document.getElementById('f-cat').value=cat; atualizarSubcats();
      document.getElementById('f-subcat').value=sub; atualizarCadencias();
      document.getElementById('f-cadencia').value=m.titulo;
      document.getElementById('f-funil').value=m.funil_id||'';
      document.getElementById('f-texto').value=m.texto||'';
      document.getElementById('f-ativo').checked=!!m.ativo;
    }
  }
  document.getElementById('modal-form-ov').classList.add('open');
  setTimeout(()=>document.getElementById('f-texto').focus(),60);
}

function fecharModal(){ document.getElementById('modal-form-ov').classList.remove('open'); _editId=null; }

async function salvarForm(){
  const alertEl=document.getElementById('form-alert'); alertEl.style.display='none';
  const cat=document.getElementById('f-cat').value;
  const sub=document.getElementById('f-subcat').value;
  const cad=document.getElementById('f-cadencia').value||document.getElementById('f-cadencia-custom').value.trim();
  const funil=document.getElementById('f-funil').value;
  const texto=document.getElementById('f-texto').value.trim();
  const ativo=document.getElementById('f-ativo').checked?1:0;
  const id=document.getElementById('f-id').value;
  if(!cat||!sub){ alertEl.textContent='Selecione categoria e subcategoria.';alertEl.style.display='';return; }
  if(!cad){ alertEl.textContent='Informe a cadência.';alertEl.style.display='';return; }
  if(!texto){ alertEl.textContent='O texto é obrigatório.';alertEl.style.display='';return; }
  const btn=document.getElementById('btn-modal-salvar');
  const txt=document.getElementById('btn-salvar-txt');
  btn.disabled=true; txt.textContent='Salvando...';
  const payload={titulo:cad,categoria:buildCat(cat,sub),texto,funil_id:funil||null,ativo};
  const r=id?await Auth.api('PATCH',`/mensagens-padrao/${id}`,payload):await Auth.api('POST','/mensagens-padrao',payload);
  btn.disabled=false; txt.textContent='Salvar';
  if(r?.ok){ Toast.show(id?'Mensagem atualizada!':'Mensagem criada!','success');fecharModal();await carregarMensagens(); }
  else{ alertEl.textContent=r?.data?.erro||'Erro ao salvar.';alertEl.style.display=''; }
}

// ── Modal Categoria ──────────────────────────────────────────────────────────
function abrirModalCat(){
  document.getElementById('fc-cat').value='';
  document.getElementById('fc-sub').value='';
  document.getElementById('fc-cads').value='';
  document.getElementById('cat-alert').style.display='none';
  document.getElementById('modal-cat-ov').classList.add('open');
  setTimeout(()=>document.getElementById('fc-cat').focus(),60);
}
function fecharModalCat(){ document.getElementById('modal-cat-ov').classList.remove('open'); }

async function salvarCategoria(){
  const alertEl=document.getElementById('cat-alert'); alertEl.style.display='none';
  const catNome=document.getElementById('fc-cat').value.trim();
  const subNome=document.getElementById('fc-sub').value.trim();
  const cadsRaw=document.getElementById('fc-cads').value.trim();
  if(!catNome||!subNome){ alertEl.textContent='Informe categoria e subcategoria.';alertEl.style.display='';return; }
  const cads=cadsRaw?cadsRaw.split('\n').map(s=>s.trim()).filter(Boolean):['D+?'];
  const categoria=buildCat(catNome,subNome);
  document.getElementById('btn-cat-salvar').disabled=true;
  // Cria um placeholder inativo por cadência
  let erros=0;
  for(const cad of cads){
    const r=await Auth.api('POST','/mensagens-padrao',{
      titulo:cad, categoria,
      texto:`[Edite: ${catNome} – ${subNome} – ${cad}]`,
      ativo:0
    });
    if(!r?.ok) erros++;
  }
  document.getElementById('btn-cat-salvar').disabled=false;
  if(erros===0){
    Toast.show(`Categoria criada com ${cads.length} placeholder(s). Edite cada mensagem para adicionar o texto real.`,'success');
    fecharModalCat(); await carregarMensagens();
  } else {
    alertEl.textContent=`${erros} erro(s) ao criar placeholders.`;alertEl.style.display='';
  }
}

// ── Toggle / Delete ──────────────────────────────────────────────────────────

async function toggleAtivo(id,estado){
  const r=await Auth.api('PATCH',`/mensagens-padrao/${id}`,{ativo:estado?1:0});
  if(r?.ok){ Toast.show(estado?'Ativado!':'Desativado.','success');await carregarMensagens(); }
  else{ Toast.show('Erro.','error');await carregarMensagens(); }
}
function confirmarDel(id){ _delId=id;document.getElementById('modal-del-ov').classList.add('open'); }
function fecharDel(){ document.getElementById('modal-del-ov').classList.remove('open');_delId=null; }
async function executarDel(){
  const r=await Auth.api('DELETE',`/mensagens-padrao/${_delId}`);
  if(r?.ok){ _favs.delete(_delId);saveFavs();Toast.show('Excluído.','success');fecharDel();await carregarMensagens(); }
  else{ Toast.show(r?.data?.erro||'Erro.','error'); }
}

// ── Duplicar Mensagem ────────────────────────────────────────────────────────
async function duplicarMsg(id){
  const m=_msgs.find(x=>x.id===id);
  if(!m) return;
  const r=await Auth.api('POST','/mensagens-padrao',{
    titulo: m.titulo+' (cópia)',
    categoria: m.categoria,
    texto: m.texto,
    funil_id: m.funil_id||null,
    ativo: 0,
  });
  if(r?.ok){ Toast.show('Mensagem duplicada! Edite e ative quando quiser.','success'); await carregarMensagens(); }
  else Toast.show(r?.data?.erro||'Erro ao duplicar.','error');
}

// ── Renomear Categoria ────────────────────────────────────────────────────────
function abrirRenomearCat(catNome){
  const {cat,sub}=parseCat(catNome);
  document.getElementById('rc-cat-orig').value=catNome;
  document.getElementById('rc-sub-orig').value='';
  document.getElementById('rc-cat').value=cat;
  document.getElementById('rc-sub').value=sub;
  document.getElementById('rc-alert').style.display='none';
  document.getElementById('modal-rename-cat-ov').classList.add('open');
  setTimeout(()=>document.getElementById('rc-cat').focus(),60);
}
function fecharRenameCat(){ document.getElementById('modal-rename-cat-ov').classList.remove('open'); }

async function salvarRenameCat(){
  const alertEl=document.getElementById('rc-alert'); alertEl.style.display='none';
  const catOrig=document.getElementById('rc-cat-orig').value;
  const novacat=document.getElementById('rc-cat').value.trim();
  const novasub=document.getElementById('rc-sub').value.trim();
  if(!novacat){ alertEl.textContent='Informe o nome da categoria.';alertEl.style.display='';return; }
  const {cat:catOrigPai,sub:subOrigPai}=parseCat(catOrig);
  // Batch: atualiza categoria de todas as mensagens que correspondem
  const alvo=_msgs.filter(m=>{
    const {cat,sub}=parseCat(m.categoria);
    if(novasub&&subOrigPai) return cat===catOrigPai&&sub===subOrigPai;
    return cat===catOrigPai;
  });
  if(!alvo.length){ alertEl.textContent='Nenhuma mensagem encontrada nessa categoria.';alertEl.style.display='';return; }
  const btn=document.getElementById('btn-rc-salvar');
  btn.disabled=true; btn.textContent='Salvando...';
  let erros=0;
  for(const m of alvo){
    const {cat,sub}=parseCat(m.categoria);
    const novaCat=novacat;
    const novaSub=novasub||(subOrigPai?subOrigPai:sub);
    const novaCategoria=buildCat(novaCat,novaSub);
    const r=await Auth.api('PATCH',`/mensagens-padrao/${m.id}`,{categoria:novaCategoria});
    if(!r?.ok) erros++;
  }
  btn.disabled=false; btn.textContent='Salvar Alterações';
  if(erros===0){
    Toast.show(`Categoria renomeada! ${alvo.length} mensagem(ns) atualizada(s).`,'success');
    fecharRenameCat();
    _catAtiva=null;_subcatAtiva=null;
    await carregarMensagens();
  } else {
    alertEl.textContent=`${erros} erro(s) ao salvar.`;alertEl.style.display='';
  }
}

// ── Excluir Categoria ─────────────────────────────────────────────────────────
function abrirDeleteCat(catNome){
  const {cat,sub}=parseCat(catNome);
  document.getElementById('del-cat-val').value=catNome;
  const count=_msgs.filter(m=>{
    const p=parseCat(m.categoria);
    return p.cat===cat&&(!sub||p.sub===sub);
  }).length;
  const warnEl=document.getElementById('del-cat-warn');
  const moverWrap=document.getElementById('del-cat-mover-wrap');
  const moverSel=document.getElementById('del-cat-mover');
  warnEl.style.display='';
  warnEl.innerHTML=count>0
    ?`⚠️ Esta categoria possui <strong>${count} mensagem(ns)</strong>. Escolha o que fazer com elas abaixo.`
    :'Esta categoria não possui mensagens. Pode excluir com segurança.';
  if(count>0){
    moverWrap.style.display='';
    const outrasOpts=_msgs
      .map(m=>parseCat(m.categoria))
      .filter(p=>buildCat(p.cat,p.sub)!==catNome)
      .reduce((acc,p)=>{const k=buildCat(p.cat,p.sub);if(!acc.has(k))acc.set(k,k);return acc;},new Map());
    moverSel.innerHTML='<option value="">— Excluir junto com a categoria —</option>'+
      [...outrasOpts.keys()].map(k=>`<option value="${esc(k)}">${esc(k)}</option>`).join('');
  } else {
    moverWrap.style.display='none';
  }
  document.getElementById('del-cat-alert').style.display='none';
  document.getElementById('modal-del-cat-ov').classList.add('open');
}
function fecharDeleteCat(){ document.getElementById('modal-del-cat-ov').classList.remove('open'); }

async function confirmarDeleteCat(){
  const alertEl=document.getElementById('del-cat-alert'); alertEl.style.display='none';
  const catNome=document.getElementById('del-cat-val').value;
  const moverPara=document.getElementById('del-cat-mover').value;
  const {cat,sub}=parseCat(catNome);
  const alvo=_msgs.filter(m=>{ const p=parseCat(m.categoria); return p.cat===cat&&(!sub||p.sub===sub); });
  const btn=document.getElementById('btn-del-cat-confirmar');
  btn.disabled=true;
  let erros=0;
  if(moverPara){
    // Move mensagens para outra categoria
    for(const m of alvo){
      const r=await Auth.api('PATCH',`/mensagens-padrao/${m.id}`,{categoria:moverPara});
      if(!r?.ok) erros++;
    }
  } else {
    // Exclui todas as mensagens da categoria
    for(const m of alvo){
      const r=await Auth.api('DELETE',`/mensagens-padrao/${m.id}`);
      if(!r?.ok) erros++;
      else _favs.delete(m.id);
    }
    saveFavs();
  }
  btn.disabled=false;
  if(erros===0){
    const acao=moverPara?`Mensagens movidas para "${moverPara}".`:`${alvo.length} mensagem(ns) excluída(s).`;
    Toast.show(`Categoria removida. ${acao}`,'success');
    fecharDeleteCat();
    _catAtiva=null;_subcatAtiva=null;
    await carregarMensagens();
  } else {
    alertEl.textContent=`${erros} erro(s) durante a operação.`;alertEl.style.display='';
  }
}

function bindEvents(){
  document.getElementById('btn-nova').addEventListener('click',()=>abrirModal());
  document.getElementById('btn-nova-cat')?.addEventListener('click',abrirModalCat);
  let bt; document.getElementById('busca-input').addEventListener('input',e=>{clearTimeout(bt);_buscaVal=e.target.value.trim();bt=setTimeout(()=>{renderNav();renderMain();},300);});
  document.getElementById('btn-modal-close').addEventListener('click',fecharModal);
  document.getElementById('btn-modal-cancelar').addEventListener('click',fecharModal);
  document.getElementById('btn-modal-salvar').addEventListener('click',salvarForm);
  document.getElementById('modal-form-ov').addEventListener('click',e=>{if(e.target===document.getElementById('modal-form-ov'))fecharModal();});
  document.getElementById('f-cat').addEventListener('change',atualizarSubcats);
  document.getElementById('f-subcat').addEventListener('change',atualizarCadencias);
  document.getElementById('btn-del-cancelar').addEventListener('click',fecharDel);
  document.getElementById('btn-del-confirmar').addEventListener('click',executarDel);
  document.getElementById('modal-del-ov').addEventListener('click',e=>{if(e.target===document.getElementById('modal-del-ov'))fecharDel();});
  document.getElementById('btn-cat-close')?.addEventListener('click',fecharModalCat);
  document.getElementById('btn-cat-cancelar')?.addEventListener('click',fecharModalCat);
  document.getElementById('btn-cat-salvar')?.addEventListener('click',salvarCategoria);
  document.getElementById('modal-cat-ov')?.addEventListener('click',e=>{if(e.target===document.getElementById('modal-cat-ov'))fecharModalCat();});
  document.querySelectorAll('.var-chip').forEach(chip=>{ chip.addEventListener('click',()=>{const ta=document.getElementById('f-texto');const s=ta.selectionStart,e2=ta.selectionEnd,v=chip.dataset.var;ta.value=ta.value.slice(0,s)+v+ta.value.slice(e2);ta.setSelectionRange(s+v.length,s+v.length);ta.focus();}); });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      fecharModal();fecharDel();fecharModalCat();
      fecharRenameCat();fecharDeleteCat();
    }
  });
  // Renomear categoria
  document.getElementById('btn-rc-close')?.addEventListener('click',fecharRenameCat);
  document.getElementById('btn-rc-cancelar')?.addEventListener('click',fecharRenameCat);
  document.getElementById('btn-rc-salvar')?.addEventListener('click',salvarRenameCat);
  document.getElementById('modal-rename-cat-ov')?.addEventListener('click',e=>{if(e.target===document.getElementById('modal-rename-cat-ov'))fecharRenameCat();});
  // Excluir categoria
  document.getElementById('btn-del-cat-cancelar')?.addEventListener('click',fecharDeleteCat);
  document.getElementById('btn-del-cat-confirmar')?.addEventListener('click',confirmarDeleteCat);
  document.getElementById('modal-del-cat-ov')?.addEventListener('click',e=>{if(e.target===document.getElementById('modal-del-cat-ov'))fecharDeleteCat();});

}

init();
