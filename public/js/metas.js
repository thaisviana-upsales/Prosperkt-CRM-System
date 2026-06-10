/**
 * PROSPEKT CRM — metas.js v2
 * Planejamento comercial por vendedor / mês / funil
 * Conectado ao CRM em tempo real, sem mocks.
 */

// ─── Constantes ───────────────────────────────────────────────────────────────
const MESES_NOME = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const TIPO_INFO = {
  FATURAMENTO: { label: 'Faturamento', icon: '💰', prefix: 'R$ ', suffix: '', pct: false },
  QUANTIDADE_VENDAS: { label: 'Qtd. Vendas', icon: '🏆', prefix: '', suffix: ' vd', pct: false },
  LEADS_RECEBIDOS: { label: 'Leads Recebidos', icon: '📥', prefix: '', suffix: ' leads', pct: false },
  ORCAMENTOS_ENVIADOS: { label: 'Orçamentos', icon: '📄', prefix: '', suffix: '', pct: false },
  CONVERSAO: { label: 'Conversão', icon: '📈', prefix: '', suffix: '%', pct: true },
  TICKET_MEDIO: { label: 'Ticket Médio', icon: '🎯', prefix: 'R$ ', suffix: '', pct: false },
};

const STATUS_INFO = {
  SUPERADA: { label: 'Meta superada', cls: 'superada' },
  ATINGIDA: { label: 'Meta atingida', cls: 'atingida' },
  EM_EVOLUCAO: { label: 'Em evolução', cls: 'em_evolucao' },
  ABAIXO: { label: 'Abaixo da meta', cls: 'abaixo' },
};

// ─── Estado ──────────────────────────────────────────────────────────────────
let _usuario = null;
let _canEdit = false;
let _funis = [];
let _usuarios = [];
let _metasCache = []; // cache da última listagem para editar sem re-fetch

// ─── Formatadores ─────────────────────────────────────────────────────────────
function fmtMoney(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(v) {
  return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}
function fmtValor(tipo, v) {
  const info = TIPO_INFO[tipo];
  if (!info) return String(v);
  if (info.prefix === 'R$ ') return fmtMoney(v);
  if (info.suffix === '%') return fmtNum(v) + '%';
  return fmtNum(v) + info.suffix;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Protege rota — redireciona para login se não autenticado
  _usuario = await Sidebar.init('metas');
  if (!_usuario) return; // Sidebar.init já redireciona

  _canEdit = ['SUPER_ADMIN', 'GESTOR'].includes(_usuario.role);

  // Mostra botão Nova Meta apenas para admin/gestor
  if (_canEdit) {
    document.getElementById('btn-nova').style.display = '';
  }

  // Oculta filtro de vendedor se for VENDEDOR (só vê as próprias)
  if (_usuario.role === 'VENDEDOR') {
    document.getElementById('fg-vendedor').style.display = 'none';
  }

  // Carrega dados de suporte
  await Promise.all([carregarFunis(), carregarUsuarios()]);

  // Define filtros padrão: mês atual + ano atual
  const hoje = new Date();
  document.getElementById('f-mes').value = String(hoje.getMonth() + 1);
  document.getElementById('f-ano').value = String(hoje.getFullYear());

  // Carrega metas
  await carregar();

  // Bind eventos
  bindEvents();

  // Auto-refresh a cada 60s
  setInterval(carregar, 60_000);
}

// ─── Carrega funis do servidor ────────────────────────────────────────────────
async function carregarFunis() {
  try {
    const r = await Auth.api('GET', '/funis?somente_ativos=true');
    _funis = r?.data?.dados || [];
    const opts = _funis.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
    // Filtro
    document.getElementById('f-funil').innerHTML = '<option value="">Todos</option>' + opts;
    // Modal
    document.getElementById('m-funil').innerHTML =
      '<option value="" data-tipo="TODOS">Todos os funis</option>' + opts;
  } catch (e) {
    console.warn('[Metas] carregarFunis error:', e);
  }
}


// ─── Carrega usuários do servidor ─────────────────────────────────────────────
async function carregarUsuarios() {
  try {
    const r = await Auth.api('GET', '/usuarios');
    const todos = (r?.data?.dados || []).filter(u => u.ativo);
    _usuarios = todos;

    // Se é vendedor, injeta só ele mesmo nas opções
    if (_usuario.role === 'VENDEDOR') {
      const me = todos.find(u => u.id === _usuario.id);
      const opt = me ? `<option value="${me.id}" selected>${me.nome}</option>` : '';
      document.getElementById('m-vendedor').innerHTML = opt || '<option value="">Seu usuário</option>';
      return;
    }

    // Admin/Gestor: lista completa
    const opts = todos.map(u => `<option value="${u.id}">${u.nome}</option>`).join('');
    // Filtro
    const fv = document.getElementById('f-vendedor');
    if (fv) fv.innerHTML = '<option value="">Todos</option>' + opts;
    // Modal
    document.getElementById('m-vendedor').innerHTML = '<option value="">— selecione —</option>' + opts;
  } catch (e) {
    console.warn('[Metas] carregarUsuarios error:', e);
  }
}

// ─── Carrega e renderiza metas ────────────────────────────────────────────────
async function carregar() {
  mostrarCarregando();

  const params = new URLSearchParams();
  const fv = document.getElementById('f-funil').value;
  const vv = document.getElementById('f-vendedor')?.value;
  const mv = document.getElementById('f-mes').value;
  const av = document.getElementById('f-ano').value;
  const tv = document.getElementById('f-tipo').value;

  if (fv) params.append('funil_id', fv);
  if (vv) params.append('usuario_id', vv);
  if (mv) params.append('mes', mv);
  if (av) params.append('ano', av);
  if (tv) params.append('tipo', tv);

  const qs = params.toString();
  try {
    const r = await Auth.api('GET', '/metas' + (qs ? '?' + qs : ''));
    if (!r?.ok) {
      mostrarErro(r?.data?.erro || 'Erro ao carregar metas.');
      return;
    }
    _metasCache = r.data.dados || []; // salva no cache local
    renderMetas(_metasCache);
    document.getElementById('ultima-att').textContent =
      'Atualizado ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    console.error('[Metas] carregar error:', e);
    mostrarErro('Falha de conexão. Verifique o servidor.');
  }
}

// ─── Estado visual ────────────────────────────────────────────────────────────
function mostrarCarregando() {
  document.getElementById('metas-grid').innerHTML = `
    <div class="loading-state">
      <div class="dots-loader" style="margin-bottom:14px">
        <span></span><span></span><span></span>
      </div>
      Carregando metas...
    </div>`;
  document.getElementById('summary-bar').style.display = 'none';
}

function mostrarErro(msg) {
  document.getElementById('metas-grid').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <div class="empty-title">Ocorreu um erro</div>
      <div class="empty-sub">${msg}</div>
      <button class="btn btn-primary" onclick="carregar()">Tentar novamente</button>
    </div>`;
  document.getElementById('summary-bar').style.display = 'none';
}

// ─── Render cards ─────────────────────────────────────────────────────────────
function renderMetas(metas) {
  const grid = document.getElementById('metas-grid');
  const bar = document.getElementById('summary-bar');

  if (!metas.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎯</div>
        <div class="empty-title">Nenhuma meta cadastrada ainda</div>
        <div class="empty-sub">Defina metas por vendedor, mês e funil para acompanhar o desempenho em tempo real.</div>
        ${_canEdit ? '<button class="btn btn-primary" id="btn-empty-nova">+ Cadastrar primeira meta</button>' : ''}
      </div>`;
    bar.style.display = 'none';
    if (_canEdit) {
      document.getElementById('btn-empty-nova')?.addEventListener('click', () => abrirModal('criar'));
    }
    return;
  }

  // Atualiza summary bar
  const total = metas.length;
  const atingidas = metas.filter(m => ['ATINGIDA', 'SUPERADA'].includes(m.status_calc)).length;
  const evolucao = metas.filter(m => m.status_calc === 'EM_EVOLUCAO').length;
  const abaixo = metas.filter(m => m.status_calc === 'ABAIXO').length;
  document.getElementById('sum-total').textContent = total;
  document.getElementById('sum-atingidas').textContent = atingidas;
  document.getElementById('sum-evolucao').textContent = evolucao;
  document.getElementById('sum-abaixo').textContent = abaixo;
  bar.style.display = '';

  grid.innerHTML = metas.map(m => renderCard(m)).join('');

  // Bind actions
  grid.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => abrirEditar(btn.dataset.edit)));
  grid.querySelectorAll('[data-del]').forEach(btn =>
    btn.addEventListener('click', () => deletarMeta(btn.dataset.del)));
  grid.querySelectorAll('[data-dup]').forEach(btn =>
    btn.addEventListener('click', () => duplicarMeta(btn.dataset.dup)));
}

function renderCard(m) {
  const info = TIPO_INFO[m.tipo] || { label: m.tipo, icon: '🎯' };
  const statusI = STATUS_INFO[m.status_calc] || STATUS_INFO.ABAIXO;
  const pct = Math.min(m.pct || 0, 150); // cap visual em 150%
  const barPct = Math.min(pct, 100);

  const vendedorNome = m.usuario_nome || 'Equipe toda';
  const funilNome = m.funil_nome || 'Todos os funis';
  const periodoStr = MESES_NOME[m.mes] ? `${MESES_NOME[m.mes]}/${m.ano}` : (m.ano || '—');

  const realizado = fmtValor(m.tipo, m.realizado);
  const valorAlvo = fmtValor(m.tipo, m.valor_alvo);
  const gapFmt = fmtValor(m.tipo, m.gap);
  const pctFmt = fmtNum(m.pct) + '%';

  const clsStatus = statusI.cls;
  const clsBar = statusI.cls;

  const pctColor = ['atingida', 'superada'].includes(clsStatus) ? 'var(--green)'
    : clsStatus === 'em_evolucao' ? '#7dbfff' : 'var(--pink)';

  return `
<div class="meta-card status-${clsStatus}" id="meta-card-${m.id}">
  <div class="mc-header">
    <div class="mc-badges">
      <span class="badge badge-tipo">${info.icon} ${info.label}</span>
      <span class="badge-status ${clsStatus}">${statusI.label}</span>
    </div>
  </div>

  <div class="mc-info">
    <div class="mc-vendedor">👤 ${escHtml(vendedorNome)}</div>
    <div class="mc-sub">
      <span>📅 ${escHtml(periodoStr)}</span>
      <span>🔀 ${escHtml(funilNome)}</span>
      ${m.observacoes ? `<span title="${escHtml(m.observacoes)}">📝 Obs.</span>` : ''}
    </div>
  </div>

  <div class="prog-wrap">
    <div class="prog-labels">
      <span style="font-size:.78rem">
        ${realizado}
        <span style="color:var(--text-muted)"> / ${valorAlvo}</span>
      </span>
      <span style="font-weight:800;color:${pctColor}">${pctFmt}</span>
    </div>
    <div class="prog-bar-bg">
      <div class="prog-bar ${clsBar}" style="width:${barPct}%"></div>
    </div>
  </div>

  <div class="mc-stats">
    <div class="mc-stat">
      <div class="mc-stat-val">${valorAlvo}</div>
      <div class="mc-stat-lbl">Meta</div>
    </div>
    <div class="mc-stat">
      <div class="mc-stat-val" style="color:var(--green)">${realizado}</div>
      <div class="mc-stat-lbl">Realizado</div>
    </div>
    <div class="mc-stat">
      <div class="mc-stat-val" style="color:${m.gap > 0 ? 'var(--pink)' : 'var(--green)'}">
        ${m.gap > 0 ? gapFmt : '✓'}
      </div>
      <div class="mc-stat-lbl">Gap</div>
    </div>
  </div>


  ${_canEdit ? `
  <div class="mc-actions">
    <button class="btn btn-ghost btn-sm" data-edit="${m.id}" title="Editar meta">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Editar
    </button>
    <button class="btn btn-ghost btn-sm" data-dup="${m.id}" title="Duplicar meta (próximo mês)">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      Duplicar
    </button>
    <button class="btn btn-ghost btn-sm" data-del="${m.id}" data-nome="${escHtml(info.label + ' ' + periodoStr)}"
      title="Remover meta" style="color:var(--pink)">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      Excluir
    </button>
  </div>` : ''}
</div>`;
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function abrirModal(modo = 'criar', meta = null) {
  document.getElementById('modal-title').textContent = modo === 'criar' ? 'Nova Meta' : 'Editar Meta';
  document.getElementById('m-id').value = meta?.id || '';
  document.getElementById('m-vendedor').value = meta?.usuario_id || '';
  document.getElementById('m-mes').value = meta?.mes || '';
  document.getElementById('m-ano').value = meta?.ano || new Date().getFullYear();
  document.getElementById('m-funil').value = meta?.funil_id || '';
  document.getElementById('m-tipo').value = meta?.tipo || 'FATURAMENTO';
  document.getElementById('m-valor').value = meta?.valor_alvo || '';
  document.getElementById('m-obs').value = meta?.observacoes || '';
  document.getElementById('modal-alert').style.display = 'none';

  atualizarHintValor();
  document.getElementById('modal-ov').classList.add('open');
  setTimeout(() => document.getElementById('m-vendedor').focus(), 50);
}

function abrirEditar(id) {
  // Usa cache local primeiro (evita re-fetch e problema de filtro ativo)
  const meta = _metasCache.find(m => m.id === id);
  if (meta) {
    abrirModal('editar', meta);
    return;
  }
  // Fallback: busca sem filtros
  Auth.api('GET', '/metas').then(r => {
    const m = (r?.data?.dados || []).find(x => x.id === id);
    if (m) abrirModal('editar', m);
    else Toast.show('Meta não encontrada.', 'error');
  });
}

function fecharModal() {
  document.getElementById('modal-ov').classList.remove('open');
}

function atualizarHintValor() {
  const tipo = document.getElementById('m-tipo').value;
  const hints = {
    FATURAMENTO: 'Valor em reais (R$). Ex: 50000',
    QUANTIDADE_VENDAS: 'Número de vendas. Ex: 20',
    LEADS_RECEBIDOS: 'Número de leads. Ex: 100',
    ORCAMENTOS_ENVIADOS: 'Número de orçamentos. Ex: 30',
    CONVERSAO: 'Percentual de conversão. Ex: 25 (= 25%)',
    TICKET_MEDIO: 'Valor médio por venda em R$. Ex: 2500',
  };
  document.getElementById('m-valor-hint').textContent = hints[tipo] || '';
}

// ─── Salvar (criar ou editar) ─────────────────────────────────────────────────
async function salvar() {
  const alertEl = document.getElementById('modal-alert');
  alertEl.style.display = 'none';

  const id = document.getElementById('m-id').value;
  const usuario_id = document.getElementById('m-vendedor').value;
  const mes = parseInt(document.getElementById('m-mes').value);
  const ano = parseInt(document.getElementById('m-ano').value);
  const funilSel = document.getElementById('m-funil');
  const funil_id = funilSel.value || null;
  const funil_tipo = funil_id ? 'ESPECIFICO' : 'TODOS';
  const tipo = document.getElementById('m-tipo').value;
  const valor_alvo = parseFloat(document.getElementById('m-valor').value);
  const observacoes = document.getElementById('m-obs').value.trim() || null;

  // Validações frontend
  if (!usuario_id) return mostrarAlertModal('Selecione o vendedor.');
  if (!mes || mes < 1 || mes > 12) return mostrarAlertModal('Selecione o mês.');
  if (!ano) return mostrarAlertModal('Selecione o ano.');
  if (!tipo) return mostrarAlertModal('Selecione o tipo de meta.');
  if (isNaN(valor_alvo) || valor_alvo < 0) return mostrarAlertModal('Informe o valor da meta.');

  const body = { usuario_id, funil_id, funil_tipo, mes, ano, tipo, valor_alvo, observacoes };

  const btn = document.getElementById('modal-salvar');
  btn.disabled = true;
  document.getElementById('modal-salvar-txt').textContent = 'Salvando...';
  document.getElementById('modal-spinner').classList.remove('hidden');

  try {
    const r = id
      ? await Auth.api('PATCH', `/metas/${id}`, body)
      : await Auth.api('POST', '/metas', body);

    if (r?.ok) {
      Toast.show(id ? 'Meta atualizada!' : 'Meta criada!', 'success');
      fecharModal();

      // ── Sincroniza filtros com o período da meta recém criada/editada ──
      // Isso garante que a meta apareça imediatamente após salvar,
      // independentemente do filtro que estava ativo antes.
      const fMes = document.getElementById('f-mes');
      const fAno = document.getElementById('f-ano');
      if (fMes) fMes.value = String(mes);
      if (fAno) fAno.value = String(ano);

      await carregar();
    } else {
      mostrarAlertModal(r?.data?.erro || 'Erro ao salvar meta.');
    }
  } catch (e) {
    mostrarAlertModal('Falha de conexão.');
    console.error('[Metas] salvar error:', e);
  } finally {
    btn.disabled = false;
    document.getElementById('modal-salvar-txt').textContent = 'Salvar Meta';
    document.getElementById('modal-spinner').classList.add('hidden');
  }
}

function mostrarAlertModal(msg) {
  const el = document.getElementById('modal-alert');
  el.className = 'alert alert-error';
  el.textContent = msg;
  el.style.display = '';
}

// ─── Modal de Confirmação (substitui window.confirm bloqueado pelo browser) ─────
function confirmDialog(titulo, msg) {
  return new Promise(resolve => {
    document.getElementById('confirm-title').textContent = titulo;
    document.getElementById('confirm-msg').textContent = msg;
    const ov = document.getElementById('confirm-ov');
    ov.classList.add('open');

    const okBtn = document.getElementById('confirm-ok');
    const canBtn = document.getElementById('confirm-cancel');

    function cleanup(val) {
      ov.classList.remove('open');
      okBtn.removeEventListener('click', onOk);
      canBtn.removeEventListener('click', onCancel);
      ov.removeEventListener('click', onOverlay);
      resolve(val);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlay(e) { if (e.target === ov) cleanup(false); }

    okBtn.addEventListener('click', onOk);
    canBtn.addEventListener('click', onCancel);
    ov.addEventListener('click', onOverlay);
  });
}

// ─── Deletar ──────────────────────────────────────────────────────────────────
async function deletarMeta(id) {
  if (!id) { Toast.show('ID da meta inválido.', 'error'); return; }

  const confirmado = await confirmDialog(
    'Excluir meta?',
    'Esta ação não pode ser desfeita. A meta será removida permanentemente.'
  );
  if (!confirmado) return;

  try {
    const r = await Auth.api('DELETE', `/metas/${id}`);
    if (r?.ok) {
      Toast.show('Meta removida.', 'success');
      // Remove do cache local imediatamente para resposta instantânea
      _metasCache = _metasCache.filter(m => m.id !== id);
      await carregar();
    } else {
      const msg = r?.data?.erro || r?.data?.mensagem || `Erro ${r?.status || ''}`.trim();
      Toast.show(msg || 'Não foi possível remover a meta.', 'error');
    }
  } catch (e) {
    console.error('[Metas] deletarMeta error:', e);
    Toast.show('Falha de conexão ao tentar remover.', 'error');
  }
}


// ─── Duplicar ─────────────────────────────────────────────────────────────────
async function duplicarMeta(id) {
  try {
    const r = await Auth.api('POST', `/metas/${id}/duplicar`);
    if (r?.ok) {
      Toast.show('Meta duplicada para o próximo mês!', 'success');
      await carregar();
    } else {
      Toast.show(r?.data?.erro || 'Erro ao duplicar.', 'error');
    }
  } catch (e) {
    Toast.show('Falha de conexão.', 'error');
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Bind global events ───────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btn-nova').addEventListener('click', () => abrirModal('criar'));
  document.getElementById('btn-refresh').addEventListener('click', carregar);
  document.getElementById('modal-close').addEventListener('click', fecharModal);
  document.getElementById('modal-cancelar').addEventListener('click', fecharModal);
  document.getElementById('modal-salvar').addEventListener('click', salvar);
  document.getElementById('modal-ov').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-ov')) fecharModal();
  });
  document.getElementById('btn-filtrar').addEventListener('click', carregar);
  document.getElementById('btn-limpar').addEventListener('click', () => {
    ['f-funil', 'f-vendedor', 'f-mes', 'f-tipo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    // Mantém ano atual
    document.getElementById('f-ano').value = String(new Date().getFullYear());
    carregar();
  });

  // Hint dinâmico para tipo no modal
  document.getElementById('m-tipo').addEventListener('change', atualizarHintValor);

  // Keyboard: Escape fecha modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('modal-ov').classList.contains('open')) {
      fecharModal();
    }
  });
}

// ─── Kick-off ─────────────────────────────────────────────────────────────────
init();
