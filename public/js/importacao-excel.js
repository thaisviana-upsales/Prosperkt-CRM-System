/**
 * PROSPEKT CRM — importacao-excel.js
 * Lógica da página de Importação de Leads via Excel
 * Acesso: SOMENTE SUPER_ADMIN
 */

(async () => {
  'use strict';

  // ── Inicializa sidebar (exige SUPER_ADMIN) ───────────────────────────────
  const usuario = await Sidebar.init('importacao-excel', 'SUPER_ADMIN');
  if (!usuario) return; // redirecionado pelo auth

  // Bloqueio extra: se role não é SUPER_ADMIN
  if (usuario.role !== 'SUPER_ADMIN') {
    document.getElementById('main-content').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:80vh;flex-direction:column;gap:16px">
        <div style="font-size:48px">🔒</div>
        <div style="font-size:1.1rem;font-weight:700">Acesso Negado</div>
        <div style="font-size:.85rem;color:var(--text-muted)">Esta página é exclusiva para Super Admin.</div>
        <a href="/pipeline.html" class="btn btn-secondary" style="margin-top:8px">Voltar ao CRM</a>
      </div>`;
    return;
  }

  // ── Estado ───────────────────────────────────────────────────────────────
  let arquivoSelecionado = null;
  let importacaoIdAtual  = null;
  let linhasValidacao    = [];

  // ── Elementos ─────────────────────────────────────────────────────────────
  const uploadZone     = document.getElementById('upload-zone');
  const fileInput      = document.getElementById('file-input');
  const fileInfo       = document.getElementById('file-info');
  const fileNameDisp   = document.getElementById('file-name-display');
  const btnValidar     = document.getElementById('btn-validar');
  const btnImportar    = document.getElementById('btn-importar');
  const btnNova        = document.getElementById('btn-nova-importacao');
  const btnBaixarMod   = document.getElementById('btn-baixar-modelo');
  const btnBaixarErros = document.getElementById('btn-baixar-erros');
  const btnReloadHist  = document.getElementById('btn-reload-hist');
  const progWrap       = document.getElementById('prog-wrap');
  const progBar        = document.getElementById('prog-bar');
  const progLabel      = document.getElementById('prog-label');
  const secaoResumo    = document.getElementById('section-resumo');
  const alertUpload    = document.getElementById('alert-upload');
  const alertImportar  = document.getElementById('alert-importar');
  const tbodyPrevia    = document.getElementById('tbody-previa');
  const tbodyHist      = document.getElementById('tbody-hist');
  const countPrevia    = document.getElementById('count-previa');
  const btnClearFile   = document.getElementById('btn-clear-file');

  // ── Upload zone drag-and-drop ─────────────────────────────────────────────
  uploadZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => selecionarArquivo(fileInput.files[0]));

  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    selecionarArquivo(e.dataTransfer.files[0]);
  });

  btnClearFile.addEventListener('click', () => resetarUpload());

  function selecionarArquivo(file) {
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xlsm)$/i)) {
      mostrarAlert(alertUpload, 'danger', '❌ Apenas arquivos .xlsx ou .xlsm são aceitos.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      mostrarAlert(alertUpload, 'danger', '❌ Arquivo maior que 20MB. Divida a planilha.');
      return;
    }
    arquivoSelecionado = file;
    fileNameDisp.textContent = `${file.name} (${fmtTamanho(file.size)})`;
    fileInfo.style.display = 'flex';
    uploadZone.style.display = 'none';
    btnValidar.disabled = false;
    alertUpload.style.display = 'none';
  }

  // ── Download modelo ────────────────────────────────────────────────────────
  btnBaixarMod.addEventListener('click', async () => {
    btnBaixarMod.disabled = true;
    btnBaixarMod.innerHTML = '<span class="imp-spinner"></span>Baixando...';
    try {
      const token = Auth.getToken?.() || localStorage.getItem('prospekt_access_token') || localStorage.getItem('access_token');
      const resp  = await fetch('/api/importacao-excel/modelo', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Erro ao baixar modelo.');
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = 'modelo_importacao_leads_prospekt.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      mostrarAlert(alertUpload, 'danger', `❌ ${e.message}`);
    }
    btnBaixarMod.disabled = false;
    btnBaixarMod.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Baixar modelo .xlsx`;
  });

  // ── Validar planilha (Fase 1) ──────────────────────────────────────────────
  btnValidar.addEventListener('click', async () => {
    if (!arquivoSelecionado) return;
    btnValidar.disabled = true;
    progWrap.style.display = 'block';
    progLabel.textContent = 'Enviando e validando...';
    animarProg(30);
    secaoResumo.style.display = 'none';
    alertUpload.style.display = 'none';

    try {
      const token = Auth.getToken?.() || localStorage.getItem('prospekt_access_token') || localStorage.getItem('access_token');
      const fd    = new FormData();
      fd.append('arquivo', arquivoSelecionado);

      const resp = await fetch('/api/importacao-excel/validar', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body:    fd,
      });
      animarProg(80);
      const data = await resp.json();

      if (!data.sucesso) {
        mostrarAlert(alertUpload, 'danger', `❌ ${data.erro}`);
        progWrap.style.display = 'none';
        btnValidar.disabled = false;
        return;
      }

      animarProg(100);
      setTimeout(() => { progWrap.style.display = 'none'; }, 600);

      importacaoIdAtual = data.importacao_id;
      linhasValidacao   = data.linhas;

      // Resumo
      document.getElementById('sum-total').textContent      = data.resumo.total;
      document.getElementById('sum-validas').textContent    = data.resumo.validas;
      document.getElementById('sum-erros').textContent      = data.resumo.erros;
      document.getElementById('sum-duplicados').textContent = data.resumo.duplicados;

      // Tabela de prévia
      tbodyPrevia.innerHTML = linhasValidacao.map(l => `
        <tr>
          <td style="font-size:.7rem;color:var(--text-muted)">${l.numero_linha}</td>
          <td>${badgeLinha(l.status)}</td>
          <td>${esc(l.nome_lead)}</td>
          <td style="font-family:monospace">${esc(l.telefone)}</td>
          <td>${esc(l.funil)}</td>
          <td>${esc(l.etapa)}</td>
          <td style="font-size:.7rem">${esc(l.vendedor)}</td>
          <td style="font-size:.7rem;color:${l.status==='invalido'?'#FF3B5C':l.status==='duplicado'?'#F5A623':'var(--text-muted)'};max-width:240px">${esc(l.erro||l.duplicado||'—')}</td>
        </tr>`).join('');
      countPrevia.textContent = `(${linhasValidacao.length} linhas)`;

      secaoResumo.style.display = 'block';
      btnImportar.disabled = data.resumo.validas === 0;
      btnBaixarErros.style.display = (data.resumo.erros + data.resumo.duplicados) > 0 ? '' : 'none';

      // Mensagem de aviso
      if (data.resumo.validas === 0) {
        mostrarAlert(alertUpload, 'warning', '⚠️ Nenhuma linha válida encontrada. Corrija os erros e reenvie a planilha.');
      } else {
        mostrarAlert(alertUpload, 'success', `✅ Validação concluída. ${data.resumo.validas} linha(s) pronta(s) para importação.`);
      }
      btnValidar.disabled = false;

    } catch (e) {
      mostrarAlert(alertUpload, 'danger', `❌ Erro ao validar: ${e.message}`);
      progWrap.style.display = 'none';
      btnValidar.disabled = false;
    }
  });

  // ── Importar (Fase 2) ─────────────────────────────────────────────────────
  btnImportar.addEventListener('click', async () => {
    if (!importacaoIdAtual) return;
    if (!confirm('Confirma a importação dos leads válidos? Esta ação não pode ser desfeita.')) return;

    btnImportar.disabled = true;
    btnImportar.innerHTML = '<span class="imp-spinner"></span>Importando...';
    alertImportar.style.display = 'none';

    try {
      const resp = await Auth.api('POST', `/importacao-excel/importar/${importacaoIdAtual}`);
      if (!resp.ok || !resp.data?.sucesso) {
        throw new Error(resp.data?.erro || 'Erro ao importar.');
      }
      const r = resp.data.resumo;
      mostrarAlert(alertImportar, 'success', `🎉 Importação concluída! ${r.importados} lead(s) criado(s).${r.erros ? ` ${r.erros} com erro.` : ''}`);
      btnImportar.innerHTML = '✅ Importação concluída';

      // Recarrega histórico
      setTimeout(carregarHistorico, 1000);

    } catch (e) {
      mostrarAlert(alertImportar, 'danger', `❌ ${e.message}`);
      btnImportar.disabled = false;
      btnImportar.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Importar leads válidos`;
    }
  });

  // ── Nova importação ────────────────────────────────────────────────────────
  btnNova.addEventListener('click', () => {
    resetarUpload();
    secaoResumo.style.display = 'none';
    importacaoIdAtual = null;
    linhasValidacao   = [];
    alertImportar.style.display = 'none';
    alertUpload.style.display   = 'none';
    btnImportar.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Importar leads válidos`;
  });

  // ── Baixar relatório de erros ──────────────────────────────────────────────
  btnBaixarErros.addEventListener('click', async () => {
    if (!importacaoIdAtual) return;
    try {
      const token = Auth.getToken?.() || localStorage.getItem('prospekt_access_token') || localStorage.getItem('access_token');
      const resp  = await fetch(`/api/importacao-excel/historico/${importacaoIdAtual}/erros`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Erro ao baixar relatório.');
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `erros_importacao.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      mostrarAlert(alertUpload, 'danger', `❌ ${e.message}`);
    }
  });

  // ── Histórico ──────────────────────────────────────────────────────────────
  btnReloadHist.addEventListener('click', carregarHistorico);

  async function carregarHistorico() {
    tbodyHist.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:16px"><span class="imp-spinner"></span> Carregando...</td></tr>';
    try {
      const resp = await Auth.api('GET', '/importacao-excel/historico');
      const rows = resp.data?.dados || [];
      if (!rows.length) {
        tbodyHist.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px">Nenhuma importação realizada ainda.</td></tr>';
        return;
      }
      tbodyHist.innerHTML = rows.map(r => `
        <tr>
          <td style="font-size:.72rem;white-space:nowrap">${fmtData(r.criado_em)}</td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.nome_arquivo)}">${esc(r.nome_arquivo)}</td>
          <td style="font-size:.72rem">${esc(r.usuario_nome||'—')}</td>
          <td style="text-align:center">${r.total_linhas||0}</td>
          <td style="text-align:center;color:#6CFF4E">${r.total_importados||0}</td>
          <td style="text-align:center;color:#FF3B5C">${r.total_erros||0}</td>
          <td style="text-align:center;color:#F5A623">${r.total_duplicados||0}</td>
          <td>${badgeStatus(r.status)}</td>
          <td>
            ${(r.total_erros||0)+(r.total_duplicados||0)>0
              ? `<button onclick="baixarErrosHist('${r.id}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:.7rem" title="Baixar erros">⬇ erros</button>`
              : ''}
          </td>
        </tr>`).join('');
    } catch (e) {
      tbodyHist.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#FF3B5C;padding:16px">Erro: ${esc(e.message)}</td></tr>`;
    }
  }

  window.baixarErrosHist = async (id) => {
    try {
      const token = Auth.getToken?.() || localStorage.getItem('prospekt_access_token') || localStorage.getItem('access_token');
      const resp  = await fetch(`/api/importacao-excel/historico/${id}/erros`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Erro ao baixar relatório.');
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `erros_imp_${id.slice(0,8)}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  function resetarUpload() {
    arquivoSelecionado = null;
    fileInput.value    = '';
    fileInfo.style.display = 'none';
    uploadZone.style.display = '';
    btnValidar.disabled = true;
    progWrap.style.display = 'none';
    progBar.style.width = '0%';
  }

  function animarProg(val) {
    progBar.style.width = val + '%';
  }

  function mostrarAlert(el, tipo, msg) {
    el.className = `alert-msg ${tipo}`;
    el.textContent = msg;
    el.style.display = 'block';
  }

  function badgeLinha(status) {
    if (status === 'valido')    return '<span class="badge-val">✓ Válido</span>';
    if (status === 'invalido')  return '<span class="badge-inv">✗ Inválido</span>';
    if (status === 'duplicado') return '<span class="badge-dupl">⊘ Duplicado</span>';
    if (status === 'importado') return '<span class="badge-imp">✔ Importado</span>';
    return `<span style="color:var(--text-muted)">${status}</span>`;
  }

  function badgeStatus(status) {
    const M = {
      concluido:            '<span class="badge-ok">Concluído</span>',
      importando:           '<span class="badge-pend">Importando...</span>',
      aguardando_confirmacao:'<span class="badge-pend">Aguardando</span>',
      erro:                 '<span class="badge-err">Erro</span>',
      cancelado:            '<span class="badge-pend">Cancelado</span>',
    };
    return M[status] || `<span class="badge-pend">${status}</span>`;
  }

  function fmtData(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
  }

  function fmtTamanho(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1048576).toFixed(1) + ' MB';
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  carregarHistorico();
})();
