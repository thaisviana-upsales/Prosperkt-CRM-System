/**
 * PROSPEKT CRM — Módulo de Produção e Arquivos do Lead
 * Gerencia a aba Produção: datas automáticas, anotações e upload de arquivos.
 */

let _producaoLeadId = null;

// ─────────────────────────────────────────────────────────────────────────────
// RENDER DA ABA PRODUÇÃO
// ─────────────────────────────────────────────────────────────────────────────

function renderProducaoTab(leadId, leadData) {
  _producaoLeadId = leadId;
  const tab = document.getElementById('tab-producao');
  if (!tab) return;

  tab.innerHTML = `
    <!-- Datas de Produção -->
    <div class="info-section">
      <div class="info-section-title">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        Datas de Produção
      </div>
      <div class="prod-dates-grid">
        <div class="prod-date-item">
          <label class="prod-date-label">Solicitação de orçamento</label>
          <input type="date" id="prod-sol-orcamento" class="input input-sm date-input">
          <span class="prod-date-hint">Manual — a partir da entrada do lead</span>
        </div>
        <div class="prod-date-item">
          <label class="prod-date-label">Envio de orçamento</label>
          <input type="date" id="prod-envio-orcamento" class="input input-sm date-input">
          <span class="prod-date-hint">Auto ao entrar em "Orçamento Enviado"</span>
        </div>
        <div class="prod-date-item">
          <label class="prod-date-label">Envio de amostra física</label>
          <input type="date" id="prod-envio-amostra" class="input input-sm date-input">
          <span class="prod-date-hint">Auto ao entrar em "Amostra Física"</span>
        </div>
        <div class="prod-date-item">
          <label class="prod-date-label">Aprovação da amostra</label>
          <input type="date" id="prod-aprov-amostra" class="input input-sm date-input">
          <span class="prod-date-hint">Auto ao entrar em "Amostra Aprovada"</span>
        </div>
        <div class="prod-date-item">
          <label class="prod-date-label">Data de entrega</label>
          <input type="date" id="prod-entrega" class="input input-sm date-input">
        </div>
        <div class="prod-date-item">
          <label class="prod-date-label">Quantidade (peças)</label>
          <input type="number" id="prod-qtd" class="input input-sm" min="0" placeholder="0">
        </div>
      </div>
      <div class="input-group-sm" style="margin-top:8px">
        <label class="lbl-sm">Anotações do pedido</label>
        <textarea id="prod-anotacoes" class="input input-sm" rows="3" placeholder="Observações de produção, detalhes do pedido..."></textarea>
      </div>
      <button id="btn-salvar-producao" class="btn btn-primary btn-sm" style="margin-top:8px;font-size:.72rem">Salvar Produção</button>
    </div>

    <!-- Upload de Arquivos / Layout -->
    <div class="info-section">
      <div class="info-section-title">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Layout & Arquivos
      </div>
      <div id="arquivos-lista" style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px"></div>
      <label class="upload-dropzone" id="upload-dropzone" title="Clique ou arraste arquivos aqui">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <span id="upload-label" style="font-size:.78rem;color:var(--text-muted)">Clique ou arraste arquivos aqui</span>
        <input type="file" id="upload-input" multiple style="display:none">
      </label>
      <div id="upload-progress" style="display:none;font-size:.72rem;color:var(--text-muted);margin-top:6px">Enviando...</div>
    </div>
  `;

  // Carrega dados existentes
  if (leadId) {
    _carregarProducao(leadId, leadData);
    _carregarArquivos(leadId);
  }

  // Eventos
  document.getElementById('btn-salvar-producao').addEventListener('click', () => _salvarProducao(leadId));

  const input   = document.getElementById('upload-input');
  const dropzone = document.getElementById('upload-dropzone');
  input.addEventListener('change', () => _uploadArquivos(Array.from(input.files), leadId));
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault(); dropzone.classList.remove('drag-over');
    _uploadArquivos(Array.from(e.dataTransfer.files), leadId);
  });
}

async function _carregarProducao(leadId, leadData) {
  const r = await Auth.api('GET', `/leads/${leadId}/producao`);
  const d = r?.data?.dados;
  if (d) {
    _setVal('prod-sol-orcamento',   d.data_solicitacao_orcamento || '');
    _setVal('prod-envio-orcamento', d.data_envio_orcamento       || '');
    _setVal('prod-envio-amostra',   d.data_envio_amostra         || '');
    _setVal('prod-aprov-amostra',   d.data_aprovacao_amostra     || '');
    _setVal('prod-entrega',         d.data_entrega               || '');
    _setVal('prod-qtd',             d.quantidade                 || '');
    _setVal('prod-anotacoes',       d.anotacoes                  || '');
  } else if (leadData?.criado_em) {
    // Data solicitação padrão = data de entrada do lead
    _setVal('prod-sol-orcamento', leadData.criado_em.slice(0, 10));
  }
}

function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

async function _salvarProducao(leadId) {
  const payload = {
    data_solicitacao_orcamento: document.getElementById('prod-sol-orcamento')?.value || null,
    data_envio_orcamento:       document.getElementById('prod-envio-orcamento')?.value || null,
    data_envio_amostra:         document.getElementById('prod-envio-amostra')?.value || null,
    data_aprovacao_amostra:     document.getElementById('prod-aprov-amostra')?.value || null,
    data_entrega:               document.getElementById('prod-entrega')?.value || null,
    quantidade:                 parseInt(document.getElementById('prod-qtd')?.value) || null,
    anotacoes:                  document.getElementById('prod-anotacoes')?.value || null,
  };
  const r = await Auth.api('POST', `/leads/${leadId}/producao`, payload);
  if (r?.ok) Toast.show('Dados de produção salvos!','success');
  else Toast.show(r?.data?.erro || 'Erro ao salvar.','error');
}

// ─────────────────────────────────────────────────────────────────────────────
// ARQUIVOS
// ─────────────────────────────────────────────────────────────────────────────

async function _carregarArquivos(leadId) {
  const r = await Auth.api('GET', `/leads/${leadId}/arquivos`);
  const lista = r?.data?.dados || [];
  _renderArquivos(lista, leadId);
}

function _renderArquivos(lista, leadId) {
  const el = document.getElementById('arquivos-lista');
  if (!el) return;
  if (!lista.length) {
    el.innerHTML = '<p style="font-size:.72rem;color:var(--text-muted)">Nenhum arquivo anexado ainda.</p>';
    return;
  }
  // Usuário atual (para checar permissão de exclusão)
  const usuarioId = window._usuario?.id;
  const role = window._usuario?.role;

  el.innerHTML = lista.map(a => {
    const tamanho = a.tamanho
      ? a.tamanho > 1024*1024
        ? (a.tamanho/1024/1024).toFixed(1)+' MB'
        : (a.tamanho/1024).toFixed(0)+' KB'
      : '';
    const icone = _iconeArquivo(a.mime_type || '');
    const data  = a.criado_em ? new Date(a.criado_em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    const url   = a.download_url || a.url || '#';
    // Pode excluir: SUPER_ADMIN ou quem enviou
    const podeExcluir = role === 'SUPER_ADMIN' || a.enviado_por === usuarioId;
    return `<div class="arquivo-item">
      <span style="font-size:1.1rem;flex-shrink:0">${icone}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.75rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${a.nome_original}">${a.nome_original}</div>
        <div style="font-size:.62rem;color:var(--text-muted)">${tamanho}${tamanho?' · ':''}${data}${a.enviado_por_nome?' · '+a.enviado_por_nome:''}</div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <a href="${url}" target="_blank" title="Visualizar" style="background:var(--surface-2);border:1px solid var(--border);border-radius:5px;padding:3px 7px;font-size:.65rem;color:var(--text-primary);text-decoration:none">&#128065;</a>
        <a href="${url}" download="${a.nome_original}" title="Baixar" style="background:var(--surface-2);border:1px solid var(--border);border-radius:5px;padding:3px 7px;font-size:.65rem;color:var(--green);text-decoration:none">↓</a>
        ${podeExcluir ? `<button onclick="window.Producao._excluirArquivo('${a.id}','${leadId}')" title="Excluir" style="background:none;border:1px solid var(--border);border-radius:5px;padding:3px 7px;font-size:.65rem;color:var(--pink);cursor:pointer">✕</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function _iconeArquivo(mime) {
  if (mime.startsWith('image/'))       return '🖼️';
  if (mime.includes('pdf'))            return '📄';
  if (mime.includes('zip')||mime.includes('rar')) return '🗜️';
  if (mime.includes('sheet')||mime.includes('excel')) return '📊';
  if (mime.includes('word')||mime.includes('document')) return '📝';
  return '📎';
}

async function _uploadArquivos(files, leadId) {
  if (!files.length || !leadId) return;
  const label    = document.getElementById('upload-label');
  const progress = document.getElementById('upload-progress');
  progress.style.display = '';
  let enviados = 0;

  for (const file of files) {
    label.textContent = `Enviando ${file.name}...`;
    const fd = new FormData();
    fd.append('arquivo', file);
    try {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const resp  = await fetch(`/api/leads/${leadId}/arquivos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (resp.ok) enviados++;
      else { const j = await resp.json(); Toast.show(j.erro || `Erro ao enviar ${file.name}`, 'error'); }
    } catch (e) { Toast.show(`Erro: ${e.message}`, 'error'); }
  }

  progress.style.display = 'none';
  label.textContent = 'Clique ou arraste arquivos aqui';
  if (enviados > 0) {
    Toast.show(`${enviados} arquivo(s) enviado(s)!`, 'success');
    await _carregarArquivos(leadId);
  }
}

async function _excluirArquivo(arqId, leadId) {
  if (!confirm('Remover este arquivo?')) return;
  const r = await Auth.api('DELETE', `/leads/${leadId}/arquivos/${arqId}`);
  if (r?.ok) { Toast.show('Arquivo removido.','success'); await _carregarArquivos(leadId); }
  else Toast.show(r?.data?.erro||'Erro.','error');
}

// Atualiza datas de produção automaticamente ao mover para etapa correspondente
async function atualizarDatasEtapa(leadId, nomeEtapa) {
  if (!leadId) return;
  const hoje = new Date().toISOString().slice(0,10);
  const mapa = {
    'Orçamento Enviado': 'data_envio_orcamento',
    'Amostra Física':    'data_envio_amostra',
    'Amostra Aprovada':  'data_aprovacao_amostra',
  };
  const campo = mapa[nomeEtapa];
  if (!campo) return;
  await Auth.api('POST', `/leads/${leadId}/producao`, { [campo]: hoje });
}

// Estilos
if (!document.getElementById('prod-css')) {
  const st = document.createElement('style');
  st.id = 'prod-css';
  st.textContent = `
    .upload-dropzone {
      display:flex;flex-direction:column;align-items:center;gap:6px;
      border:2px dashed var(--border);border-radius:10px;padding:16px 12px;
      cursor:pointer;transition:var(--transition-fast);text-align:center;
    }
    .upload-dropzone:hover, .upload-dropzone.drag-over {
      border-color:var(--green);background:var(--green-dim);
    }
    .arquivo-item {
      display:flex;align-items:center;gap:8px;
      padding:6px 10px;background:var(--surface);border:1px solid var(--border);
      border-radius:7px;
    }
    .prod-date-hint { font-size:.6rem; color:var(--text-muted); font-style:italic; }
  `;
  document.head.appendChild(st);
}

window.Producao = {
  renderTab: renderProducaoTab,
  atualizarDatasEtapa,
  _excluirArquivo,
};
