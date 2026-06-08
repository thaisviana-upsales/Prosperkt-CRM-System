/**
 * PROSPERKT — whatsapp-picker.js v3
 * Painel lateral de scripts dentro do WhatsApp
 */
(function(){
const SEP='|';
const FAV_KEY='sc_favs_v3';
const ESTRUTURA=[
  {icon:'🏢',nome:'🏢 Agências',subs:[
    {nome:'Follow Up - Lead Novo',cads:['D+2','D+15','D+60','D+3M']},
    {nome:'Follow Up - Carteira',cads:['D+6 Meses','D+8 Meses','D+12 Meses','D+18 Meses','D+24 Meses']},
  ]},
  {icon:'🏭',nome:'🏭 Marca Direta',subs:[
    {nome:'Follow Up - Lead Novo',cads:['D+2','D+15','D+60','D+3M']},
    {nome:'Follow Up - Carteira',cads:['D+6 Meses','D+8 Meses','D+12 Meses','D+18 Meses','D+24 Meses']},
  ]},
];

let _msgs=[],_estrutura=[],_buscaVal='';
let _favs=new Set(),_catAtiva=null,_subcatAtiva=null,_mostraFavs=false;
let _catAberta=new Set();
let _bt;

/**
 * _leadVars — mapa de variáveis dinâmicas do lead ativo.
 * Populado em abrirPicker() via carregarVarsLead().
 * Extensível: adicionar novas variáveis aqui sem refatorar.
 */
let _leadVars = {};

/**
 * VARS_MAP — tabela extensível de variáveis suportadas.
 * Cada entrada: { regex, key }
 *   regex: padrão a substituir no texto do script
 *   key:   chave em _leadVars com o valor real
 * Para adicionar nova variável: acrescentar uma linha aqui.
 */
const VARS_MAP = [
  { regex: /\[Nome\]/g,           key: 'nome'          },
  { regex: /\[Empresa\]/g,        key: 'empresa'       },
  { regex: /\[Vendedor\]/g,       key: 'vendedor'      },
  { regex: /\[Produto\]/g,        key: 'produto'       },
  { regex: /\[Último Pedido\]/g,  key: 'ultimoPedido'  },
  // Variáveis legadas do CRM (retrocompatibilidade)
  { regex: /\[nome_lead\]/gi,     key: 'nome'          },
  { regex: /\[nome_vendedor\]/gi, key: 'vendedor'      },
  { regex: /\[nome_empresa\]/gi,  key: 'empresa'       },
  { regex: /\[telefone_lead\]/gi, key: 'telefone'      },
  { regex: /\[funil\]/gi,         key: 'funil'         },
  { regex: /\[etapa\]/gi,         key: 'etapa'         },
  { regex: /\[empresa\]/gi,       key: 'empresa'       },
  // ── Futuras variáveis (descomente quando disponíveis) ──────────
  // { regex: /\[Telefone\]/g,           key: 'telefone'         },
  // { regex: /\[Email\]/g,              key: 'email'            },
  // { regex: /\[Cidade\]/g,             key: 'cidade'           },
  // { regex: /\[Segmento\]/g,           key: 'segmento'         },
  // { regex: /\[Data Última Compra\]/g, key: 'dataUltimaCompra' },
  // { regex: /\[Ticket Médio\]/g,       key: 'ticketMedio'      },
  // { regex: /\[Origem Lead\]/g,        key: 'origemLead'       },
  // { regex: /\[Funil\]/g,              key: 'funil'            },
  // { regex: /\[Etapa\]/g,              key: 'etapa'            },
  // { regex: /\[Data Próximo Follow Up\]/g, key: 'proximoFollowUp' },
];

function loadFavs(){try{_favs=new Set(JSON.parse(localStorage.getItem(FAV_KEY)||'[]'))}catch{_favs=new Set()}}
function saveFavs(){localStorage.setItem(FAV_KEY,JSON.stringify([..._favs]))}
function parseCat(c){const i=(c||'').indexOf(SEP);return i<0?{cat:c||'',sub:''}:{cat:c.slice(0,i),sub:c.slice(i+1)}}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

/**
 * substituirVars — aplica todas as variáveis de _leadVars ao texto.
 * Fallback: se o valor não existe, mantém a variável original visível.
 */
function substituirVars(t){
  let resultado = t || '';
  VARS_MAP.forEach(({ regex, key }) => {
    const valor = _leadVars[key];
    if (valor) {
      resultado = resultado.replace(regex, valor);
    }
    // sem valor → mantém a variável original (fallback)
  });
  return resultado;
}

/**
 * carregarVarsLead — busca dados do lead vinculado à conversa ativa.
 * Popula _leadVars com todos os dados disponíveis.
 * Adicionar novas fontes de dados aqui quando necessário.
 */
async function carregarVarsLead(){
  const conv  = (typeof _convAtiva !== 'undefined') ? _convAtiva : {};
  const user  = (typeof _usuario   !== 'undefined') ? _usuario   : {};

  // Dados base imediatamente disponíveis na conversa ativa
  _leadVars = {
    nome:         conv.nome_contato || conv.lead_nome || '',
    empresa:      conv.lead_empresa || '',
    vendedor:     conv.vendedor_nome || user.nome || '',
    telefone:     conv.telefone      || '',
    funil:        conv.funil_nome    || '',
    etapa:        conv.etapa_nome    || '',
    produto:      '',   // preenchido abaixo se lead vinculado
    ultimoPedido: '',   // preenchido abaixo se lead vinculado
    // Futuras variáveis (inicializadas vazias):
    email:            '',
    cidade:           '',
    segmento:         '',
    dataUltimaCompra: '',
    ticketMedio:      '',
    origemLead:       '',
    proximoFollowUp:  '',
  };

  // Se há lead vinculado, busca produtos/histórico via API
  const leadId = conv.lead_id || conv.leadId || '';
  if (!leadId) return;

  try {
    const r = await Auth.api('GET', `/leads/${leadId}/produtos`);
    const produtos = r?.data?.dados || r?.data || [];
    if (produtos.length > 0) {
      // [Produto] = primeiro produto ativo vinculado ao lead
      _leadVars.produto = produtos[0]?.nome || produtos[0]?.produto_nome || '';
      // [Último Pedido] = último produto (mais recente)
      const ultimo = produtos[produtos.length - 1];
      _leadVars.ultimoPedido = ultimo?.nome || ultimo?.produto_nome || '';
    }
  } catch(e) {
    // falha silenciosa — variáveis ficam vazias, fallback preserva placeholder
    console.warn('[Picker] Não foi possível carregar produtos do lead:', e.message);
  }
}

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

async function carregarDados(){
  // Sempre recarrega para refletir alterações do admin em tempo real
  const [rMsg, rCat] = await Promise.all([
    Auth.api('GET','/mensagens-padrao?ativo=1'),
    Auth.api('GET','/mensagens-padrao/categorias'),
  ]);
  _msgs = rMsg?.data?.dados||[];
  _estrutura = rCat?.data?.dados||[];
  _catAberta = new Set(_estrutura.map(c=>c.nome));
  renderAll();
}

function renderAll(){renderNav();renderLista();}

// ── Nav do picker ────────────────────────────────────────────────────────────
function renderNav(){
  const nav=document.getElementById('pk-nav');
  if(!nav) return;
  const countCat={},countSub={};
  const fonte=_msgs.filter(m=>!_buscaVal||(m.titulo+m.texto+m.categoria).toLowerCase().includes(_buscaVal.toLowerCase()));
  fonte.forEach(m=>{
    const {cat,sub}=parseCat(m.categoria);
    countCat[cat]=(countCat[cat]||0)+1;
    countSub[`${cat}${SEP}${sub}`]=(countSub[`${cat}${SEP}${sub}`]||0)+1;
  });
  const favN=[..._favs].filter(id=>_msgs.find(m=>m.id===id)).length;
  const isTodos=!_catAtiva&&!_subcatAtiva&&!_mostraFavs;
  const isFavs=_mostraFavs;

  nav.innerHTML=`
    <button class="pk-nav-btn ${isTodos?'pk-active':''}" id="pk-all">📋 Todos <span class="pk-cnt">${_msgs.length}</span></button>
    <button class="pk-nav-btn pk-fav-btn ${isFavs?'pk-active':''}" id="pk-favs">⭐ Favoritos${favN>0?` <span class="pk-cnt pk-fcnt">${favN}</span>`:''}</button>
    <div class="pk-sep"></div>
    ${_estrutura.map(cat=>{
      const isOpen=_catAberta.has(cat.nome);
      const isCatA=_catAtiva===cat.nome&&!_subcatAtiva&&!_mostraFavs;
      const total=countCat[cat.nome]||0;
      const icon=cat.nome.match(/^(\S+)\s/)?.[1]||'📁';
      return `
      <div class="pk-cat-hd ${isCatA?'pk-active':''} ${isOpen?'pk-open':''}" data-pcat="${esc(cat.nome)}">
        <span>${icon}</span><span style="flex:1;font-size:.73rem">${esc(cat.nome.replace(icon+' ',''))}</span>
        ${total>0?`<span class="pk-cnt">${total}</span>`:''}
        <svg style="flex-shrink:0;transition:transform .2s;${isOpen?'transform:rotate(90deg)':''}" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="pk-subs" ${isOpen?'':'style="display:none"'}>
        ${cat.subs.map(sub=>{
          const k=`${cat.nome}${SEP}${sub.nome}`;
          const cnt=countSub[k]||0;
          const isSubA=_catAtiva===cat.nome&&_subcatAtiva===sub.nome&&!_mostraFavs;
          return `<button class="pk-sub-btn ${isSubA?'pk-active':''}" data-pcat="${esc(cat.nome)}" data-psub="${esc(sub.nome)}">
            ${esc(sub.nome)}${cnt>0?` <span class="pk-cnt">${cnt}</span>`:''}
          </button>`;
        }).join('')}
      </div>`;
    }).join('')}`;

  nav.querySelector('#pk-all').onclick=()=>{_catAtiva=null;_subcatAtiva=null;_mostraFavs=false;renderAll();};
  nav.querySelector('#pk-favs').onclick=()=>{_catAtiva=null;_subcatAtiva=null;_mostraFavs=true;renderAll();};
  nav.querySelectorAll('.pk-cat-hd[data-pcat]').forEach(hd=>{
    hd.onclick=()=>{
      const c=hd.dataset.pcat;
      if(_catAberta.has(c))_catAberta.delete(c);else _catAberta.add(c);
      _catAtiva=c;_subcatAtiva=null;_mostraFavs=false;renderAll();
    };
  });
  nav.querySelectorAll('.pk-sub-btn').forEach(btn=>{
    btn.onclick=e=>{e.stopPropagation();_catAtiva=btn.dataset.pcat;_subcatAtiva=btn.dataset.psub;_mostraFavs=false;renderAll();};
  });
}

// ── Lista de scripts ─────────────────────────────────────────────────────────
function renderLista(){
  const el=document.getElementById('pk-list');
  if(!el) return;
  const lista=filtrar();

  if(!lista.length){
    el.innerHTML=`<div style="text-align:center;padding:36px 16px;color:var(--text-muted)">
      <div style="font-size:2rem;opacity:.2;margin-bottom:8px">${_mostraFavs?'⭐':'📋'}</div>
      <div style="font-size:.82rem;font-weight:700;margin-bottom:4px">${_mostraFavs?'Nenhum favorito':'Nenhum script'}</div>
      <div style="font-size:.72rem">${_mostraFavs?'Use ⭐ nos scripts para favoritar.':'Tente outro filtro.'}</div>
    </div>`;
    return;
  }

  // Se em subcategoria: agrupa por cadência
  if(_subcatAtiva){
    const catRef=_estrutura.find(c=>c.nome===_catAtiva);
    const subRef=catRef?.subs.find(s=>s.nome===_subcatAtiva);
    const ordemCad=subRef?.cads||[];
    const grupos={};
    ordemCad.forEach(c=>grupos[c]=[]);
    lista.forEach(m=>{const g=grupos[m.titulo];if(g)g.push(m);else{grupos['Outros']=grupos['Outros']||[];grupos['Outros'].push(m);}});

    el.innerHTML=[...ordemCad,'Outros'].filter(cad=>(grupos[cad]||[]).length>0).map(cad=>`
      <div class="pk-cad-lbl">${esc(cad)}</div>
      ${(grupos[cad]||[]).map(m=>renderItem(m)).join('')}
    `).join('');
  } else {
    el.innerHTML=lista.map(m=>renderItem(m)).join('');
  }

  el.querySelectorAll('.pk-usar').forEach(btn=>{
    btn.onclick=e=>{e.stopPropagation();const m=_msgs.find(x=>x.id===btn.dataset.id);if(m)usarMensagem(m.id,substituirVars(m.texto));};
  });
  el.querySelectorAll('.pk-fav').forEach(btn=>{
    btn.onclick=e=>{e.stopPropagation();const id=btn.dataset.fid;_favs.has(id)?_favs.delete(id):_favs.add(id);saveFavs();renderAll();};
  });
}

function renderItem(m){
  const {cat,sub}=parseCat(m.categoria);
  const isFav=_favs.has(m.id);
  const tx=substituirVars(m.texto);
  const prev=tx.slice(0,90);
  return `<div class="pk-item${isFav?' pk-fav-item':''}">
    <div class="pk-item-top">
      <div class="pk-item-meta">
        <div class="pk-item-title">${esc(m.titulo)}</div>
        <div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:2px">
          ${cat?`<span class="pk-badge">${esc(cat.replace(/^[^\s]+\s/,''))}</span>`:''}
          ${sub?`<span class="pk-badge pk-badge-g">${esc(sub)}</span>`:''}
        </div>
      </div>
      <button class="pk-fav" data-fid="${m.id}" title="${isFav?'Remover favorito':'Favoritar'}" style="background:none;border:none;cursor:pointer;font-size:.9rem;padding:3px;line-height:1">${isFav?'⭐':'☆'}</button>
    </div>
    <div class="pk-item-prev">${esc(prev)}${prev.length<tx.length?'…':''}</div>
    <button class="pk-usar" data-id="${m.id}">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/><line x1="5" y1="12" x2="15" y2="12"/></svg>
      Usar script
    </button>
  </div>`;
}

// ── Inserção (lógica original preservada) ─────────────────────────────────────
function usarMensagem(id,texto){
  const ta=document.getElementById('msg-input');
  if(!ta){Toast.show('Campo de mensagem não encontrado.','error');return;}
  ta.value=texto;
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  ta.style.height='auto';
  ta.style.height=Math.min(ta.scrollHeight,100)+'px';
  fecharPicker();
  ta.focus();
  setTimeout(()=>{ta.selectionStart=ta.selectionEnd=ta.value.length;},50);
  Toast.show('Script inserido! Edite e envie quando quiser.','success');
}

// ── Abrir / Fechar ────────────────────────────────────────────────────────────
async function abrirPicker(){
  loadFavs();
  _buscaVal='';_catAtiva=null;_subcatAtiva=null;_mostraFavs=false;
  const busca=document.getElementById('pk-busca');
  if(busca) busca.value='';
  document.getElementById('pk-panel')?.classList.add('open');
  // Carrega variáveis do lead ativo e scripts em paralelo
  await Promise.all([ carregarVarsLead(), carregarDados() ]);
  setTimeout(()=>busca?.focus(),120);
}
function fecharPicker(){document.getElementById('pk-panel')?.classList.remove('open');}

// ── Inject UI ─────────────────────────────────────────────────────────────────
function injectUI(){
  if(document.getElementById('pk-panel')) return;

  // Estilos
  const s=document.createElement('style');
  s.textContent=`
#pk-panel{position:fixed;top:0;right:0;bottom:0;width:360px;max-width:96vw;background:var(--surface);border-left:1px solid var(--border);z-index:920;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.16,1,.3,1);box-shadow:-4px 0 24px rgba(0,0,0,.4)}
#pk-panel.open{transform:translateX(0)}
#pk-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:919;opacity:0;pointer-events:none;transition:opacity .28s}
#pk-overlay.open{opacity:1;pointer-events:all}
.pk-hd{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0;background:linear-gradient(135deg,rgba(26,58,107,.2),rgba(59,139,255,.08))}
.pk-hd-icon{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#1a3a6b,#3B8BFF);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pk-hd-title{font-size:.88rem;font-weight:800;flex:1}
.pk-hd-sub{font-size:.68rem;color:var(--text-muted);margin-top:1px}
.pk-close{background:none;border:none;cursor:pointer;color:var(--text-muted);padding:5px;border-radius:7px;display:flex;align-items:center;transition:all .15s}
.pk-close:hover{background:var(--surface-2);color:var(--text-primary)}
.pk-search-wrap{padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;position:relative}
.pk-search-wrap svg{position:absolute;left:22px;top:50%;transform:translateY(-50%);color:var(--text-muted);pointer-events:none}
#pk-busca{width:100%;box-sizing:border-box;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:8px 12px 8px 30px;color:var(--text-primary);font-family:inherit;font-size:.78rem;outline:none;transition:border-color .2s}
#pk-busca:focus{border-color:var(--green)}
.pk-body{display:flex;flex:1;overflow:hidden}
#pk-nav{width:148px;flex-shrink:0;border-right:1px solid var(--border);overflow-y:auto;padding:6px 0;background:var(--surface)}
#pk-list{flex:1;overflow-y:auto;padding:8px}
.pk-nav-btn{display:flex;align-items:center;justify-content:space-between;gap:4px;width:calc(100% - 10px);margin:1px 5px;padding:7px 10px;border-radius:7px;border:none;background:none;cursor:pointer;font-family:inherit;font-size:.72rem;font-weight:600;color:var(--text-muted);text-align:left;transition:all .13s}
.pk-nav-btn:hover{background:var(--surface-2);color:var(--text-primary)}
.pk-nav-btn.pk-active{background:rgba(108,255,78,.1);color:var(--green)}
.pk-fav-btn.pk-active{background:rgba(255,182,39,.1);color:#FFB627}
.pk-sep{margin:5px 12px;border:none;border-top:1px solid var(--border)}
.pk-cat-hd{display:flex;align-items:center;gap:5px;padding:7px 10px;cursor:pointer;font-size:.72rem;font-weight:700;color:var(--text-secondary);transition:all .13s;user-select:none}
.pk-cat-hd:hover{color:var(--text-primary)}
.pk-cat-hd.pk-active{color:var(--green)}
.pk-subs{padding:0}
.pk-sub-btn{display:flex;align-items:center;justify-content:space-between;width:100%;padding:5px 8px 5px 22px;border:none;background:none;cursor:pointer;font-family:inherit;font-size:.68rem;color:var(--text-muted);text-align:left;transition:all .13s;border-left:2px solid transparent}
.pk-sub-btn:hover{color:var(--text-primary)}
.pk-sub-btn.pk-active{color:var(--green);border-left-color:var(--green);font-weight:700}
.pk-cnt{font-size:.6rem;background:rgba(108,255,78,.1);color:var(--green);border-radius:10px;padding:1px 5px;font-weight:700;flex-shrink:0}
.pk-fcnt{background:rgba(255,182,39,.15);color:#FFB627}
.pk-cad-lbl{font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);padding:8px 4px 4px;margin-top:4px}
.pk-item{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px;transition:border-color .15s;position:relative}
.pk-item:hover{border-color:var(--border-hover)}
.pk-fav-item{border-color:rgba(255,182,39,.35)}
.pk-item-top{display:flex;align-items:flex-start;gap:6px;margin-bottom:4px}
.pk-item-meta{flex:1;min-width:0}
.pk-item-title{font-size:.78rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-badge{font-size:.58rem;font-weight:700;padding:1px 6px;border-radius:20px;background:rgba(59,139,255,.1);color:#3B8BFF;display:inline-block}
.pk-badge-g{background:rgba(108,255,78,.08);color:var(--green)}
.pk-item-prev{font-size:.72rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:8px}
.pk-usar{background:linear-gradient(135deg,#166921,#28a745);color:#fff;border:none;border-radius:7px;padding:6px 12px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px;width:100%;justify-content:center;transition:all .15s}
.pk-usar:hover{box-shadow:0 3px 10px rgba(108,255,78,.3)}
  `;
  document.head.appendChild(s);

  // Overlay
  const ov=document.createElement('div');
  ov.id='pk-overlay';
  ov.onclick=fecharPicker;
  document.body.appendChild(ov);

  // Painel
  const panel=document.createElement('div');
  panel.id='pk-panel';
  panel.innerHTML=`
    <div class="pk-hd">
      <div class="pk-hd-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
      <div><div class="pk-hd-title">Biblioteca de Mensagens</div><div class="pk-hd-sub">Selecione — edite — envie</div></div>
      <button class="pk-close" id="pk-close-btn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="pk-search-wrap">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="pk-busca" placeholder="Buscar script...">
    </div>
    <div class="pk-body">
      <div id="pk-nav"></div>
      <div id="pk-list"><div style="text-align:center;padding:40px;color:var(--text-muted);font-size:.82rem">Carregando...</div></div>
    </div>`;
  document.body.appendChild(panel);

  document.getElementById('pk-close-btn').onclick=fecharPicker;
  document.getElementById('pk-busca').addEventListener('input',e=>{
    clearTimeout(_bt);_buscaVal=e.target.value.trim();
    _bt=setTimeout(()=>renderAll(),280);
  });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape')fecharPicker(); });
}

// ── Sincroniza overlay ────────────────────────────────────────────────────────
const _origAbrir=abrirPicker;
function abrirPickerFull(){
  document.getElementById('pk-overlay')?.classList.add('open');
  _origAbrir();
}
function fecharPickerFull(){
  document.getElementById('pk-overlay')?.classList.remove('open');
  fecharPicker();
}

// ── Init ─────────────────────────────────────────────────────────────────────
function init(){
  injectUI();
  const btn=document.getElementById('btn-script');
  if(btn) btn.addEventListener('click',abrirPickerFull);
  document.getElementById('pk-close-btn')?.addEventListener('click',fecharPickerFull);
  document.getElementById('pk-overlay')?.addEventListener('click',fecharPickerFull);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else init();
})();
