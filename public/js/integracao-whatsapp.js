/**
 * PROSPEKT — integracao-whatsapp.js v2
 * Integração WhatsApp com Evolution API
 */

let _secretoReal = '';
let _secretoVisivel = false;
let _statusData = null;
let _qrPollTimer = null;
let _usuario = null;


function $id(id) { return document.getElementById(id); }

async function init() {
  const usuario = await Sidebar.init('integracao-whatsapp', 'SUPER_ADMIN');
  _usuario = usuario;
  aplicarVisibilidadePorRole(usuario);
  setWebhookUrl();
  await Promise.all([carregarStatus(), carregarEvoStatus()]);
  bindEvents();
}

/**
 * Esconde controles de instância para não-SUPER_ADMIN.
 * O backend já bloqueia via exigirSuperAdmin, mas o frontend
 * também deve ocultar para UX limpa.
 */
function aplicarVisibilidadePorRole(usuario) {
  const isSuperAdmin = usuario?.role === 'SUPER_ADMIN';
  // Botoões de controle da instância
  const botoesAdmin = ['evo-btn-criar', 'evo-btn-qr', 'evo-btn-desconectar'];
  botoesAdmin.forEach(id => {
    const el = $id(id);
    if (el) el.style.display = isSuperAdmin ? '' : 'none';
  });

  // Se não for super admin, exibe aviso informativo no painel Evolution
  if (!isSuperAdmin) {
    const painel = $id('evo-panel');
    if (painel) {
      const aviso = document.createElement('div');
      aviso.style.cssText = 'margin-top:12px;padding:10px 14px;background:rgba(59,139,255,.08);border:1px solid rgba(59,139,255,.2);border-radius:10px;font-size:.76rem;color:#3B8BFF;display:flex;align-items:center;gap:8px';
      aviso.innerHTML = '<span style="font-size:.95rem">🔒</span> A conexão WhatsApp é gerenciada pelo Administrador. Você utiliza o número oficial já conectado sem precisar configurar nada.';
      painel.appendChild(aviso);
    }
  }
}

function setWebhookUrl() {
  const base = window.location.origin;
  const url  = `${base}/api/whatsapp/webhook`;
  const el = $id('whook-url');
  if (el) {
    const btn = el.querySelector('button');
    el.textContent = url + ' ';
    if (btn) { el.appendChild(btn); btn.dataset.url = url; }
  }
}

async function carregarStatus() {
  try {
    const r = await Auth.api('GET', '/whatsapp/integracao/status');
    if (!r?.ok) { renderStatusErro(); return; }
    _statusData = r.data;
    renderStatus(r.data);
    renderLogs(r.data.logs || []);
    renderSecret(r.data);
  } catch(e) {
    renderStatusErro();
  }
}

function renderStatus(d) {
  const dot  = $id('sdot');
  const lbl  = $id('slabel');
  const sub  = $id('ssub');
  const nCon = $id('num-val');
  const nInf = $id('num-info');

  const ativo  = d.msgs_24h > 0;
  const semana = d.msgs_7d  > 0;

  if (dot) dot.className = `sdot ${ativo ? 'g' : semana ? 'y' : 'gr'}`;
  if (lbl) lbl.textContent = ativo ? '🟢 Webhook Ativo' : semana ? '🟡 Atividade Recente' : '⚫ Sem Atividade';
  if (sub) sub.textContent = ativo
    ? `${d.msgs_24h} mensagem(ns) nas últimas 24h`
    : semana
    ? `Última atividade: ${d.ultima_msg_em ? formatDate(d.ultima_msg_em) : '—'}`
    : 'Nenhuma mensagem recebida ainda. Configure o webhook no provedor.';

  if (nCon) nCon.textContent = d.ultimo_telefone ? formatTel(d.ultimo_telefone) : '—';
  if (nInf) nInf.textContent = d.ultimo_telefone
    ? `Último número identificado — ${d.ultima_msg_em ? formatDate(d.ultima_msg_em) : ''}`
    : 'Nenhum número ativo identificado';

  const s24 = $id('s24'); if (s24) s24.textContent = d.msgs_24h ?? '0';
  const sc  = $id('sconv'); if (sc) sc.textContent = d.conversas_ativas ?? '0';
  if (d.ultima_msg_em) {
    const su = $id('sultima');   if (su) su.textContent = formatDate(d.ultima_msg_em);
    const sd = $id('sultima-d'); if (sd) sd.textContent = d.ultima_direcao === 'recebida' ? '📥 Recebida' : '📤 Enviada';
  }
}

function renderStatusErro() {
  const dot = $id('sdot');
  if (dot) dot.className = 'sdot r';
  const lbl = $id('slabel'); if (lbl) lbl.textContent = '🔴 Erro ao consultar';
  const sub = $id('ssub');   if (sub) sub.textContent = 'Não foi possível obter o status. Verifique a conexão com o servidor.';
}

function renderSecret(d) {
  _secretoReal = d.secret_configurado
    ? '(configurado no servidor)'
    : '(não configurado — defina WHATSAPP_WEBHOOK_SECRET no .env)';
  const display = $id('sec-display');
  if (!display) return;
  if (d.secret_configurado) {
    display.textContent = '••••••••••••••••••••••••';
    display.style.color = 'var(--green)';
  } else {
    display.textContent = '⚠️ WHATSAPP_WEBHOOK_SECRET não configurado';
    display.style.color = '#FFB627';
  }
}

function renderLogs(logs) {
  const el = $id('log-list');
  if (!el) return;
  if (!logs.length) {
    el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:.77rem">
      <div style="font-size:1.6rem;opacity:.15;margin-bottom:8px">📭</div>
      Nenhuma atividade registrada ainda.<br>Configure o webhook e envie uma mensagem de teste.
    </div>`;
    return;
  }
  el.innerHTML = logs.map(m => `
    <div class="log-it">
      <span class="log-dir ${m.direcao === 'recebida' ? 'r' : 'e'}">${m.direcao === 'recebida' ? '📥 Receb.' : '📤 Enviada'}</span>
      <div style="flex:1;min-width:0">
        <div class="log-tel">${formatTel(m.telefone || '')}</div>
        <div class="log-msg" style="font-size:.72rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.mensagem || m.conteudo || '—')}</div>
      </div>
      <span style="font-size:.67rem;color:var(--text-muted);white-space:nowrap">${m.criado_em ? formatDate(m.criado_em) : ''}</span>
    </div>`).join('');
}

// ── Evolution API ─────────────────────────────────────────────────────────────

async function carregarEvoStatus() {
  const dot     = $id('evo-dot');
  const label   = $id('evo-label');
  const sub     = $id('evo-sub');
  const naoConf = $id('evo-nao-config');

  const r = await Auth.api('GET', '/whatsapp/evolution/status');
  if (!r?.ok) {
    if (dot)   dot.className   = 'sdot r';
    if (label) label.textContent = '🔴 Erro ao consultar Evolution API';
    if (sub)   sub.textContent   = 'Verifique a conexão com o servidor.';
    return;
  }

  const d = r.data;

  if (!d.configurada) {
    if (dot)   dot.className     = 'sdot gr';
    if (label) label.textContent = '⚫ Não configurada';
    if (sub)   sub.textContent   = 'Evolution API não configurada no servidor.';
    if (naoConf) naoConf.style.display = '';
    return;
  }

  if (naoConf) naoConf.style.display = 'none';

  const instEl = $id('evo-instance-name');
  if (instEl && d.instancia) instEl.textContent = d.instancia;

  // ── Número real conectado (owner) ─────────────────────────────────
  const nCon  = $id('num-val');
  const nInf  = $id('num-info');
  if (d.owner) {
    if (nCon) nCon.textContent = formatTel(d.owner);
    const perfil = d.profileName ? ` — ${d.profileName}` : '';
    if (nInf) nInf.textContent = `Número real conectado${perfil}`;
  } else {
    const estado = (d.estado || '').toLowerCase();
    if (estado === 'open') {
      if (nCon) nCon.textContent = 'Conectado';
      if (nInf) nInf.textContent = 'Número conectado, aguardando identificação';
    } else {
      if (nCon) nCon.textContent = '—';
      if (nInf) nInf.textContent = 'Nenhum número conectado';
    }
  }

  // Foto do perfil (se disponível)
  const fotoEl = $id('num-foto');
  if (fotoEl && d.profilePictureUrl) {
    fotoEl.src = d.profilePictureUrl;
    fotoEl.style.display = '';
  } else if (fotoEl) {
    fotoEl.style.display = 'none';
  }

  // ── Status da conexão ───────────────────────────────────────────
  const estado = (d.estado || '').toLowerCase();
  if (estado === 'open') {
    if (dot)   dot.className     = 'sdot g';
    if (label) label.textContent = '🟢 Conectado — Pronto para enviar e receber';
    if (sub)   sub.textContent   = 'WhatsApp conectado e funcionando via Evolution API.';
  } else if (estado === 'connecting') {
    if (dot)   dot.className     = 'sdot y';
    if (label) label.textContent = '🟡 Conectando...';
    if (sub)   sub.textContent   = 'Aguardando QR Code ser escaneado.';
  } else if (estado === 'close' || estado === 'closed') {
    if (dot)   dot.className     = 'sdot r';
    if (label) label.textContent = '🔴 Desconectado';
    if (sub)   sub.textContent   = 'Instância existe mas WhatsApp não está conectado. Clique em "Gerar QR Code".';
  } else {
    if (dot)   dot.className     = 'sdot gr';
    if (label) label.textContent = `⚫ Estado: ${d.estado || 'desconhecido'}`;
    if (sub)   sub.textContent   = 'Clique em "Criar Instância" e depois "Gerar QR Code".';
  }
}


async function abrirModalQr() {
  const modal = $id('modal-qr-ov');
  if (modal) modal.style.display = 'flex';
  await carregarQrCode();
  iniciarPollConexao();
}

function fecharModalQr() {
  const modal = $id('modal-qr-ov');
  if (modal) modal.style.display = 'none';
  pararPollConexao();
}

async function carregarQrCode() {
  const loading = $id('qr-loading');
  const img     = $id('qr-img');
  const errEl   = $id('qr-error');

  if (loading) { loading.style.display = ''; loading.textContent = 'Gerando QR Code...'; }
  if (img)     img.style.display = 'none';
  if (errEl)   errEl.style.display = 'none';

  const r = await Auth.api('GET', '/whatsapp/evolution/qrcode');

  if (!r?.ok) {
    if (loading) loading.style.display = 'none';
    if (errEl) {
      const erroMsg = r?.data?.erro || 'Erro ao obter QR Code. Crie a instância primeiro.';
      const isConflito = r?.data?.codigo === 'ALREADY_CONNECTED'
        || /sess(a|ã)o|já.*conect|already.*connect|device.*exist|conflict/i.test(erroMsg);

      errEl.style.display = '';
      errEl.innerHTML = `<div>❌ ${escHtml(erroMsg)}</div>`;

      if (isConflito) {
        errEl.innerHTML += `
          <div style="margin-top:10px;padding:10px;background:rgba(255,182,39,.08);border:1px solid rgba(255,182,39,.25);border-radius:8px;font-size:.75rem;color:#FFB627">
            ⚠️ Este número já possui uma sessão ativa. Verifique os Dispositivos Conectados no WhatsApp
            ou desconecte a instância atual antes de escanear novamente.
          </div>
          <button id="qr-btn-desconectar-sessao" class="btn btn-sm" style="margin-top:10px;background:rgba(225,0,152,.12);color:var(--pink);border:1px solid rgba(225,0,152,.25)">
            ⏹ Desconectar sessão atual
          </button>`;
        // Bind do botão de desconexão do conflito
        setTimeout(() => {
          $id('qr-btn-desconectar-sessao')?.addEventListener('click', async () => {
            const rd = await Auth.api('DELETE', '/whatsapp/evolution/desconectar');
            if (rd?.ok) {
              Toast.show('Sessão desconectada. Gere o QR Code novamente.', 'success');
              await carregarQrCode();
            } else {
              Toast.show(rd?.data?.erro || 'Erro ao desconectar.', 'error');
            }
          });
        }, 100);
      }
    }
    return;
  }

  const qr = r.data?.qrcode;
  if (!qr) {
    if (loading) { loading.style.display = ''; loading.textContent = '✅ Instância já conectada ou aguardando. Verifique o status.'; }
    return;
  }

  if (loading) loading.style.display = 'none';
  if (img) {
    img.src = qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`;
    img.style.display = '';
  }
}

function iniciarPollConexao() {
  pararPollConexao();
  let tentativas = 0;
  _qrPollTimer = setInterval(async () => {
    tentativas++;
    const statusEl = $id('qr-status-poll');
    if (statusEl) statusEl.textContent = `Verificando conexão... (${tentativas * 5}s)`;

    const r = await Auth.api('GET', '/whatsapp/evolution/status');
    const estado = (r?.data?.estado || '').toLowerCase();

    if (estado === 'open') {
      pararPollConexao();
      if (statusEl) { statusEl.style.color = 'var(--green)'; statusEl.textContent = '✅ Conectado com sucesso!'; }
      Toast.show('WhatsApp conectado! 🎉', 'success');
      setTimeout(() => { fecharModalQr(); carregarEvoStatus(); carregarStatus(); }, 2000);
    }

    if (tentativas >= 24) {
      pararPollConexao();
      if (statusEl) statusEl.textContent = 'QR Code expirado. Clique em 🔄 Atualizar QR.';
    }
  }, 5000);
}

function pararPollConexao() {
  if (_qrPollTimer) { clearInterval(_qrPollTimer); _qrPollTimer = null; }
}

// ── Eventos ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Refresh geral
  $id('btn-refresh')?.addEventListener('click', () => { carregarStatus(); carregarEvoStatus(); });

  // Copiar URL webhook
  $id('cpurl')?.addEventListener('click', function() {
    const url = this.dataset.url || $id('whook-url')?.textContent?.trim()
      || `${window.location.origin}/api/whatsapp/webhook`;
    navigator.clipboard?.writeText(url).then(() => {
      this.textContent = '✓ Copiado'; setTimeout(() => this.textContent = 'Copiar', 2000);
    });
  });

  // Copiar secret
  $id('cpsec')?.addEventListener('click', function() {
    navigator.clipboard?.writeText(_secretoReal).then(() => {
      this.textContent = '✓ Copiado'; setTimeout(() => this.textContent = 'Copiar', 2000);
    });
    Toast.show('Secret copiado!', 'success');
  });

  // Toggle secret
  $id('sec-tog')?.addEventListener('click', function() {
    _secretoVisivel = !_secretoVisivel;
    this.textContent = _secretoVisivel ? 'Ocultar' : 'Mostrar';
    const d = $id('sec-display'); if (!d) return;
    if (_secretoVisivel && _statusData?.secret_configurado) d.textContent = _statusData.secret_preview || '••••••••';
    else if (_statusData?.secret_configurado) d.textContent = '••••••••••••••••••••••••';
  });

  // Testar status
  $id('btn-testar')?.addEventListener('click', async () => {
    Toast.show('Atualizando status...', 'info');
    await Promise.all([carregarStatus(), carregarEvoStatus()]);
    Toast.show('Status atualizado!', 'success');
  });

  // Simular mensagem
  $id('btn-simular')?.addEventListener('click', async () => {
    const tel  = ($id('t-tel')?.value  || '').trim();
    const nome = ($id('t-nome')?.value || '').trim();
    const msg  = ($id('t-msg')?.value  || '').trim();
    const res  = $id('t-res');
    const btn  = $id('btn-simular');
    if (!tel) { Toast.show('Informe o telefone.', 'error'); return; }
    if (!msg)  { Toast.show('Informe a mensagem.', 'error'); return; }
    btn.disabled = true;
    if (res) res.textContent = 'Enviando...';
    const r = await Auth.api('POST', '/whatsapp/mensagens/manual', {
      telefone: tel.replace(/\D/g, ''), nome_contato: nome || null,
      direcao: 'recebida', tipo: 'texto', conteudo: msg,
    });
    btn.disabled = false;
    if (r?.ok) {
      if (res) { res.style.color = 'var(--green)'; res.textContent = '✅ Mensagem simulada!'; }
      Toast.show('Mensagem injetada no CRM!', 'success');
      const tMsg = $id('t-msg'); if (tMsg) tMsg.value = '';
      carregarStatus();
    } else {
      if (res) { res.style.color = 'var(--pink)'; res.textContent = '❌ ' + (r?.data?.erro || 'Erro.'); }
      Toast.show(r?.data?.erro || 'Erro ao simular.', 'error');
    }
  });

  // ── Evolution API buttons ────────────────────────────────────────────────
  $id('evo-btn-refresh')?.addEventListener('click', carregarEvoStatus);

  $id('evo-btn-criar')?.addEventListener('click', async () => {
    const btn = $id('evo-btn-criar');
    btn.disabled = true; btn.textContent = 'Criando...';
    const r = await Auth.api('POST', '/whatsapp/evolution/criar');
    btn.disabled = false; btn.textContent = '➕ Criar Instância';
    if (r?.ok) {
      if (r.data?.aviso) {
        // Instância já existia — não é erro, apenas informativo
        Toast.show('✅ ' + r.data.aviso, 'success');
      } else {
        Toast.show('✅ Instância criada! Agora clique em "Gerar QR Code".', 'success');
      }
      carregarEvoStatus();
    } else {
      Toast.show(r?.data?.erro || 'Erro ao criar instância.', 'error');
    }
  });

  $id('evo-btn-qr')?.addEventListener('click', abrirModalQr);


  $id('evo-btn-desconectar')?.addEventListener('click', async () => {
    if (!confirm('Desconectar o WhatsApp?\nO número precisará escanear um novo QR Code para reconectar.')) return;
    const r = await Auth.api('DELETE', '/whatsapp/evolution/desconectar');
    if (r?.ok) { Toast.show('WhatsApp desconectado.', 'success'); carregarEvoStatus(); }
    else Toast.show(r?.data?.erro || 'Erro ao desconectar.', 'error');
  });

  // Modal QR Code
  $id('qr-btn-refresh')?.addEventListener('click', carregarQrCode);
  $id('qr-btn-fechar')?.addEventListener('click', fecharModalQr);
  $id('modal-qr-ov')?.addEventListener('click', e => { if (e.target === $id('modal-qr-ov')) fecharModalQr(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModalQr(); });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTel(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (!d) return '—';
  if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  return d;
}

function formatDate(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  const h = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (dt.toDateString() === hoje.toDateString()) return `Hoje, ${h}`;
  if (dt.toDateString() === ontem.toDateString()) return `Ontem, ${h}`;
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ` ${h}`;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

init();
