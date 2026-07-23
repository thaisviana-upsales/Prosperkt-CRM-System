/**
 * PROSPEKT CRM — importacao-excel.js
 * Lógica da página de Importação de Leads via Excel
 * Acesso: SOMENTE SUPER_ADMIN
 *
 * v3: Suporte a correlação inteligente (fuzzy match vendedor/funil/etapa)
 *     com UI de revisão de sugestões antes de importar.
 */

(async () => {
  'use strict';

  // ── Inicializa sidebar (exige SUPER_ADMIN) ───────────────────────────────
  const usuario = await Sidebar.init('importacao-excel', 'SUPER_ADMIN');
  if (!usuario) return;

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
  // Mapa de correções confirmadas pelo admin: { "2": { vendedor_id, vendedor_nome, ... } }
  let correcoesConfirmadas = {};

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
    correcoesConfirmadas = {}; // resetar correções

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
      const rs = data.resumo;
      document.getElementById('sum-total').textContent      = rs.total;
      document.getElementById('sum-validas').textContent    = rs.validas;
      document.getElementById('sum-erros').textContent      = rs.erros;
      document.getElementById('sum-duplicados').textContent = rs.duplicados;

      // Renderiza tabela + seção sugestões
      renderizarResultados(data);
      secaoResumo.style.display = 'block';

      // Habilita botão de importar se há válidas ou sugestões
      const temValidas = rs.validas > 0;
      const temSugestoes = rs.sugestoes > 0;
      btnImportar.disabled = !temValidas && !temSugestoes;
      btnBaixarErros.style.display = (rs.erros + rs.duplicados) > 0 ? '' : 'none';

      if (temSugestoes) {
        mostrarAlert(alertUpload, 'warning', `⚠️ ${rs.sugestoes} linha(s) aguardando sua confirmação de correlação. Revise as sugestões abaixo antes de importar.`);
      } else if (!temValidas) {
        mostrarAlert(alertUpload, 'warning', '⚠️ Nenhuma linha válida encontrada. Corrija os erros e reenvie a planilha.');
      } else {
        mostrarAlert(alertUpload, 'success', `✅ Validação concluída. ${rs.validas} linha(s) pronta(s) para importação.`);
      }
      btnValidar.disabled = false;

    } catch (e) {
      mostrarAlert(alertUpload, 'danger', `❌ Erro ao validar: ${e.message}`);
      progWrap.style.display = 'none';
      btnValidar.disabled = false;
    }
  });

  // ── Renderiza tabela de pré-validação + seção de sugestões ──────────────
  function renderizarResultados(data) {
    const linhas = data.linhas;

    // Tabela de prévia
    tbodyPrevia.innerHTML = linhas.map(l => `
      <tr>
        <td style="font-size:.7rem;color:var(--text-muted)">${l.numero_linha}</td>
        <td>${badgeLinha(l.status, l.sugestoes)}</td>
        <td>${esc(l.nome_lead)}</td>
        <td style="font-family:monospace">${esc(l.telefone)}</td>
        <td>${esc(l.funil)}</td>
        <td>${esc(l.etapa)}</td>
        <td style="font-size:.7rem">${esc(l.vendedor)}</td>
        <td style="font-size:.7rem;color:${corMsgStatus(l.status)};max-width:240px">${esc(msgLinha(l))}</td>
      </tr>`).join('');
    countPrevia.textContent = `(${linhas.length} linhas)`;

    // Seção de sugestões
    renderizarSugestoes(linhas);
  }

  // ── Seção de Correções Sugeridas ──────────────────────────────────────────
  function renderizarSugestoes(linhas) {
    let secaoSug = document.getElementById('section-sugestoes');

    const linhasComSug = linhas.filter(l => l.status === 'sugestao' && l.sugestoes);
    // Também mostra sugestões auto aceitas para transparência
    const linhasAutoSug = linhas.filter(l => l.sugestoes && Object.values(l.sugestoes).some(s => s?.tipo === 'auto'));

    if (!linhasComSug.length && !linhasAutoSug.length) {
      if (secaoSug) secaoSug.remove();
      return;
    }

    if (!secaoSug) {
      secaoSug = document.createElement('div');
      secaoSug.id = 'section-sugestoes';
      // Insere antes da barra de ações
      const actionBar = document.querySelector('.action-bar');
      actionBar.parentNode.insertBefore(secaoSug, actionBar);
    }

    const htmlManual = linhasComSug.map(l => {
      const sug = l.sugestoes;
      const itens = Object.entries(sug)
        .filter(([, v]) => v && v.tipo === 'manual')
        .map(([campo, v]) => {
          const key = `${l.numero_linha}_${campo}`;
          const confirmado = correcoesConfirmadas[String(l.numero_linha)]?.[`${campo}_id`];
          return `
          <div class="sug-item" id="sugitem-${key}">
            <div class="sug-campo">${nomeCampo(campo)}</div>
            <div class="sug-detail">
              <span class="sug-informado">"${esc(v.informado)}"</span>
              <span class="sug-arrow">→</span>
              <span class="sug-sugerido">"${esc(v.sugerido)}"</span>
              <span class="sug-score">${v.score}% similar</span>
            </div>
            <div class="sug-actions">
              ${confirmado
                ? `<span class="sug-confirmado">✓ Confirmado</span>
                   <button class="sug-btn sug-btn-rejeitar" onclick="recusarSugestao(${l.numero_linha},'${campo}')">Desfazer</button>`
                : `<button class="sug-btn sug-btn-aceitar" onclick="confirmarSugestao(${l.numero_linha},'${campo}','${esc(v.id)}','${esc(v.sugerido)}')">✓ Sim, usar "${esc(v.sugerido)}"</button>
                   <button class="sug-btn sug-btn-rejeitar" onclick="recusarSugestao(${l.numero_linha},'${campo}')">✕ Não</button>`
              }
            </div>
          </div>`;
        }).join('');
      if (!itens) return '';
      return `
      <div class="sug-linha-card" id="sugcard-linha-${l.numero_linha}">
        <div class="sug-linha-header">
          <span class="sug-linha-num">Linha ${l.numero_linha}</span>
          <span style="color:var(--text-muted);font-size:.75rem">${esc(l.nome_lead)}</span>
        </div>
        ${itens}
      </div>`;
    }).filter(Boolean).join('');

    const htmlAuto = linhasAutoSug.length ? `
    <div class="sug-auto-section">
      <div class="sug-auto-title">✔ Correlações automáticas aplicadas (alta confiança)</div>
      ${linhasAutoSug.map(l => {
        const itens = Object.entries(l.sugestoes)
          .filter(([,v]) => v?.tipo === 'auto')
          .map(([campo, v]) => `<div class="sug-auto-item"><span class="sug-campo">${nomeCampo(campo)}:</span> "${esc(v.informado)}" → "${esc(v.sugerido)}" <span class="sug-score">${v.score}%</span></div>`)
          .join('');
        return `<div style="font-size:.72rem;color:var(--text-muted);margin-bottom:4px"><b>Linha ${l.numero_linha}</b>: ${itens}</div>`;
      }).join('')}
    </div>` : '';

    const totalManualPendente = linhasComSug.reduce((acc, l) => {
      return acc + Object.values(l.sugestoes).filter(v => v?.tipo === 'manual' && !correcoesConfirmadas[String(l.numero_linha)]?.[`${v.tipo}_id`]).length;
    }, 0);

    secaoSug.innerHTML = `
    <div class="imp-section sug-section">
      <div class="imp-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Correções Sugeridas
        ${linhasComSug.length ? `<span class="sug-badge-count">${linhasComSug.length} linha(s) aguardando</span>` : ''}
      </div>
      <p style="font-size:.8rem;color:var(--text-muted);margin:0 0 14px">
        O CRM encontrou correspondências para campos que não batem exatamente. Confirme as substituições para liberar as linhas para importação.
      </p>
      ${linhasComSug.length ? `
      <div style="margin-bottom:12px">
        <button class="btn btn-secondary" id="btn-aplicar-todas" onclick="aplicarTodasSugestoes()" style="font-size:.78rem;padding:6px 14px">
          ✓ Aplicar todas as sugestões
        </button>
      </div>` : ''}
      <div id="sug-lista-manual">${htmlManual || '<div style="font-size:.8rem;color:#6CFF4E;padding:8px 0">✓ Todas as correções foram revisadas.</div>'}</div>
      ${htmlAuto}
    </div>`;
  }

  // ── Ações de sugestão (globais para onclick inline) ──────────────────────
  window.confirmarSugestao = function(numeroLinha, campo, id, nome) {
    if (!correcoesConfirmadas[String(numeroLinha)]) correcoesConfirmadas[String(numeroLinha)] = { _historico: [] };
    const cor = correcoesConfirmadas[String(numeroLinha)];

    const sug = linhasValidacao.find(l => l.numero_linha === numeroLinha)?.sugestoes?.[campo];
    if (sug) {
      cor._historico.push(`${nomeCampo(campo)}: "${sug.informado}" → "${sug.sugerido}"`);
    }

    if (campo === 'vendedor') { cor.vendedor_id = id; cor.vendedor_nome = nome; }
    if (campo === 'funil')    { cor.funil_id    = id; cor.funil_nome    = nome; }
    if (campo === 'etapa')    { cor.etapa_id    = id; cor.etapa_nome    = nome; }

    atualizarContadores();
    renderizarSugestoes(linhasValidacao);
  };

  window.recusarSugestao = function(numeroLinha, campo) {
    if (correcoesConfirmadas[String(numeroLinha)]) {
      if (campo === 'vendedor') { delete correcoesConfirmadas[String(numeroLinha)].vendedor_id; }
      if (campo === 'funil')    { delete correcoesConfirmadas[String(numeroLinha)].funil_id; }
      if (campo === 'etapa')    { delete correcoesConfirmadas[String(numeroLinha)].etapa_id; }
    }
    atualizarContadores();
    renderizarSugestoes(linhasValidacao);
  };

  window.aplicarTodasSugestoes = function() {
    linhasValidacao.forEach(l => {
      if (l.status !== 'sugestao' || !l.sugestoes) return;
      Object.entries(l.sugestoes).forEach(([campo, v]) => {
        if (v && v.tipo === 'manual') {
          window.confirmarSugestao(l.numero_linha, campo, v.id, v.sugerido);
        }
      });
    });
  };

  function atualizarContadores() {
    // Recalcula validas = originais validas + sugestoes com todas correções confirmadas
    const linhasOriginaisValidas = linhasValidacao.filter(l => l.status === 'valido').length;
    const linhasComSugTotalmenteConfirmadas = linhasValidacao.filter(l => {
      if (l.status !== 'sugestao' || !l.sugestoes) return false;
      const camposManual = Object.entries(l.sugestoes).filter(([,v]) => v?.tipo === 'manual');
      const cor = correcoesConfirmadas[String(l.numero_linha)] || {};
      return camposManual.every(([campo]) => cor[`${campo}_id`]);
    }).length;

    const validas = linhasOriginaisValidas + linhasComSugTotalmenteConfirmadas;
    const sugestoesPendentes = linhasValidacao.filter(l => l.status === 'sugestao').length - linhasComSugTotalmenteConfirmadas;

    document.getElementById('sum-validas').textContent = validas;
    btnImportar.disabled = validas === 0;

    if (sugestoesPendentes > 0) {
      mostrarAlert(alertUpload, 'warning', `⚠️ ${sugestoesPendentes} linha(s) ainda aguardando confirmação.`);
    } else if (validas > 0) {
      mostrarAlert(alertUpload, 'success', `✅ ${validas} linha(s) prontas para importação.`);
    }
  }

  // ── Importar (Fase 2) ─────────────────────────────────────────────────────
  btnImportar.addEventListener('click', async () => {
    if (!importacaoIdAtual) return;
    if (!confirm('Confirma a importação dos leads válidos? Esta ação não pode ser desfeita.')) return;

    btnImportar.disabled = true;
    btnImportar.innerHTML = '<span class="imp-spinner"></span>Importando...';
    alertImportar.style.display = 'none';

    try {
      const resp = await Auth.api('POST', `/importacao-excel/importar/${importacaoIdAtual}`, {
        correcoes: correcoesConfirmadas,
      });
      if (!resp.ok || !resp.data?.sucesso) {
        throw new Error(resp.data?.erro || 'Erro ao importar.');
      }
      const r = resp.data.resumo;
      mostrarAlert(alertImportar, 'success', `🎉 Importação concluída! ${r.importados} lead(s) criado(s).${r.erros ? ` ${r.erros} com erro.` : ''}`);
      btnImportar.innerHTML = '✅ Importação concluída';

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
    correcoesConfirmadas = {};
    alertImportar.style.display = 'none';
    alertUpload.style.display   = 'none';
    const secSug = document.getElementById('section-sugestoes');
    if (secSug) secSug.remove();
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

  function badgeLinha(status, sugestoes) {
    if (status === 'valido') {
      const temAuto = sugestoes && Object.values(sugestoes).some(s => s?.tipo === 'auto');
      return temAuto
        ? '<span class="badge-sug-auto">✓ Válido*</span>'
        : '<span class="badge-val">✓ Válido</span>';
    }
    if (status === 'sugestao')  return '<span class="badge-sug">⚠ Aguardando</span>';
    if (status === 'invalido')  return '<span class="badge-inv">✗ Inválido</span>';
    if (status === 'duplicado') return '<span class="badge-dupl">⊘ Duplicado</span>';
    if (status === 'importado') return '<span class="badge-imp">✔ Importado</span>';
    return `<span style="color:var(--text-muted)">${status}</span>`;
  }

  function corMsgStatus(status) {
    if (status === 'invalido')  return '#FF3B5C';
    if (status === 'duplicado') return '#F5A623';
    if (status === 'sugestao')  return '#F5A623';
    return 'var(--text-muted)';
  }

  function msgLinha(l) {
    if (l.status === 'sugestao' && l.sugestoes) {
      return Object.values(l.sugestoes)
        .filter(v => v?.tipo === 'manual')
        .map(v => v.msg)
        .join(' | ') || '—';
    }
    if (l.status === 'valido' && l.sugestoes) {
      return Object.values(l.sugestoes)
        .filter(v => v?.tipo === 'auto')
        .map(v => v.msg)
        .join(' | ') || '—';
    }
    return l.erro || l.duplicado || '—';
  }

  function nomeCampo(campo) {
    const M = { vendedor: 'Vendedor', funil: 'Funil', etapa: 'Etapa' };
    return M[campo] || campo;
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
