/**
 * PROSPEKT CRM — Lead Arquivos JS
 * Gerencia a aba "Arquivos" no card do lead:
 *   - Upload com validação (tipo, tamanho 300MB)
 *   - Drag-and-drop
 *   - Lista com ícone, tamanho, data, usuário
 *   - Download seguro via /api/leads/:id/arquivos/:arqId/download
 *   - Exclusão com confirmação
 */
(function () {
  'use strict';

  const LIMITE_BYTES = 300 * 1024 * 1024; // 300 MB

  const EXT_BLOQUEADAS = new Set([
    'exe','bat','cmd','sh','bash','zsh','msi','scr','com','pif',
    'vbs','vbe','js','jse','wsf','wsh','ps1','psm1','psd1',
    'reg','inf','lnk','url','jar','class','hta',
  ]);

  const ICONES = {
    pdf:   '📄', image: '🖼️', video: '🎬', audio: '🎵',
    zip:   '🗜️', rar:  '🗜️', '7z': '🗜️',
    doc:   '📝', docx: '📝', xls:  '📊', xlsx: '📊',
    ppt:   '📑', pptx: '📑', txt:  '📄', csv:  '📊',
    default: '📎',
  };

  function iconeParaMime(mime, nome) {
    if (!mime && !nome) return ICONES.default;
    if (mime?.startsWith('image/')) return ICONES.image;
    if (mime?.startsWith('video/')) return ICONES.video;
    if (mime?.startsWith('audio/')) return ICONES.audio;
    if (mime === 'application/pdf') return ICONES.pdf;
    const ext = (nome || '').split('.').pop().toLowerCase();
    return ICONES[ext] || ICONES.default;
  }

  function fmtBytes(b) {
    if (!b) return '–';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 ** 3)   return (b / (1024 * 1024)).toFixed(1) + ' MB';
    return (b / (1024 ** 3)).toFixed(2) + ' GB';
  }

  function fmtData(iso) {
    if (!iso) return '–';
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function extPermitida(nome) {
    const ext = (nome.split('.').pop() || '').toLowerCase();
    return !EXT_BLOQUEADAS.has(ext);
  }

  // ── Estado ──────────────────────────────────────────────────────────────────
  let _leadId = null;

  // ── API ─────────────────────────────────────────────────────────────────────
  async function carregar(leadId) {
    _leadId = leadId;
    const lista = document.getElementById('arq-lista');
    const emptyMsg = document.getElementById('arq-empty-msg');
    if (!lista) return;

    lista.innerHTML = '<p style="font-size:.75rem;color:var(--text-muted);padding:8px 0">Carregando...</p>';

    let r = null;
    try {
      r = await Auth.api('GET', `/leads/${leadId}/arquivos`);
    } catch (e) {
      lista.innerHTML = `<p style="font-size:.75rem;color:var(--pink,#FF3B5C);padding:8px 0">Erro ao carregar arquivos: ${e.message}</p>`;
      return;
    }

    const arquivos = r?.data?.dados || [];
    if (!arquivos.length) {
      lista.innerHTML = '<p style="font-size:.75rem;color:var(--text-muted);text-align:center;padding:20px 0" id="arq-empty-msg">Nenhum arquivo anexado.</p>';
      return;
    }

    lista.innerHTML = arquivos.map(a => renderCard(a)).join('');
  }

  function renderCard(a) {
    const ico    = iconeParaMime(a.mime_type, a.nome_original);
    const tam    = a.tamanho_fmt || fmtBytes(a.tamanho);
    const data   = fmtData(a.criado_em);
    const usuario = a.enviado_por_nome || 'Sistema';
    const leadId  = _leadId;

    const isImagem = a.mime_type?.startsWith('image/');
    const previewHtml = isImagem && a.url
      ? `<img src="${a.url}" alt="${a.nome_original}" loading="lazy"
           style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px;cursor:pointer"
           onclick="window.open('${a.url}','_blank')">`
      : '';

    return `
<div class="arq-card" id="arq-card-${a.id}">
  ${previewHtml}
  <div style="display:flex;align-items:flex-start;gap:10px">
    <span style="font-size:1.6rem;line-height:1;flex-shrink:0">${ico}</span>
    <div style="flex:1;min-width:0">
      <p style="font-size:.8rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0"
         title="${a.nome_original}">${a.nome_original}</p>
      <p style="font-size:.68rem;color:var(--text-muted);margin:2px 0 0">${tam} &bull; ${data} &bull; ${usuario}</p>
    </div>
    <a href="/api/leads/${leadId}/arquivos/${a.id}/download"
       class="arq-btn-down"
       title="Baixar arquivo"
       download="${a.nome_original}">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 13 7 8"/>
        <line x1="12" y1="3" x2="12" y2="13"/>
      </svg>
    </a>
    <button class="arq-btn-del" data-id="${a.id}" title="Remover arquivo" onclick="LeadArquivos.confirmarExcluir('${a.id}','${a.nome_original.replace(/'/g,"\\'")}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
      </svg>
    </button>
  </div>
</div>`;
  }

  // ── Upload ───────────────────────────────────────────────────────────────────
  async function uploadArquivos(files) {
    if (!_leadId) { Toast.show('Selecione um lead primeiro.', 'error'); return; }
    const progressWrap = document.getElementById('arq-upload-progress');
    const progressBar  = document.getElementById('arq-progress-bar');
    const progressLabel = document.getElementById('arq-upload-label');

    const validos = [];
    for (const f of files) {
      if (!extPermitida(f.name)) {
        Toast.show(`Tipo não permitido: ${f.name}`, 'error'); continue;
      }
      if (f.size > LIMITE_BYTES) {
        Toast.show(`O arquivo "${f.name}" excede o limite máximo de 300MB.`, 'error'); continue;
      }
      validos.push(f);
    }
    if (!validos.length) return;

    if (progressWrap) progressWrap.style.display = '';
    let done = 0;

    for (const f of validos) {
      if (progressLabel) progressLabel.textContent = `Enviando ${f.name}...`;
      if (progressBar)   progressBar.style.width = Math.round((done / validos.length) * 100) + '%';

      try {
        const formData = new FormData();
        formData.append('arquivo', f);

        const token = localStorage.getItem('token') || '';
        const resp  = await fetch(`/api/leads/${_leadId}/arquivos`, {
          method:  'POST',
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
          body:    formData,
        });
        const json = await resp.json();
        if (!resp.ok || !json.sucesso) {
          Toast.show(`Erro ao enviar "${f.name}": ${json.erro || resp.statusText}`, 'error');
        } else {
          Toast.show(`"${f.name}" enviado com sucesso!`, 'success');
        }
      } catch (e) {
        Toast.show(`Erro ao enviar "${f.name}": ${e.message}`, 'error');
      }

      done++;
      if (progressBar) progressBar.style.width = Math.round((done / validos.length) * 100) + '%';
    }

    if (progressWrap) setTimeout(() => { progressWrap.style.display = 'none'; if (progressBar) progressBar.style.width = '0'; }, 1000);
    carregar(_leadId);
  }

  // ── Exclusão ─────────────────────────────────────────────────────────────────
  function confirmarExcluir(arqId, nome) {
    if (!confirm(`Remover o arquivo "${nome}"? Esta ação não pode ser desfeita.`)) return;
    Auth.api('DELETE', `/leads/${_leadId}/arquivos/${arqId}`)
      .then(r => {
        if (r?.data?.sucesso) {
          Toast.show('Arquivo removido.', 'success');
          document.getElementById(`arq-card-${arqId}`)?.remove();
          const lista = document.getElementById('arq-lista');
          if (lista && !lista.querySelector('.arq-card')) {
            lista.innerHTML = '<p style="font-size:.75rem;color:var(--text-muted);text-align:center;padding:20px 0">Nenhum arquivo anexado.</p>';
          }
        } else {
          Toast.show('Erro ao remover arquivo.', 'error');
        }
      }).catch(() => Toast.show('Erro ao remover arquivo.', 'error'));
  }

  // ── Bind de eventos ──────────────────────────────────────────────────────────
  function bindEvents() {
    const dropZone  = document.getElementById('arq-drop-zone');
    const fileInput = document.getElementById('arq-file-input');
    if (!dropZone || !fileInput) return;

    // Clique na zona
    dropZone.addEventListener('click', () => fileInput.click());

    // Input file
    fileInput.addEventListener('change', function () {
      if (this.files?.length) uploadArquivos(Array.from(this.files));
      this.value = '';
    });

    // Drag & drop
    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('arq-drag-over');
    });
    ['dragleave','dragend'].forEach(ev => dropZone.addEventListener(ev, () => dropZone.classList.remove('arq-drag-over')));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('arq-drag-over');
      if (e.dataTransfer?.files?.length) uploadArquivos(Array.from(e.dataTransfer.files));
    });
  }

  // Init
  bindEvents();

  // API pública — chamada pelo pipeline.js ao abrir lead
  window.LeadArquivos = { carregar, confirmarExcluir };
})();
