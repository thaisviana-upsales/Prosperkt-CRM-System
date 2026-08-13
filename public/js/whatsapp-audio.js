/**
 * whatsapp-audio.js — Módulo isolado de áudio WhatsApp
 * ─────────────────────────────────────────────────────
 * Carregado APÓS whatsapp.js. Intercepta o clique no botão
 * de envio quando há áudio gravado e usa o endpoint dedicado
 * (multipart/form-data → Storage → Evolution).
 *
 * NÃO altera funções de whatsapp.js.
 * NÃO interfere no fluxo de texto.
 * Acessa globais de whatsapp.js: _audioBlob, _convAtiva,
 *   _setRecUI, cancelarGravacao, _mensagens, renderMensagens.
 */

(function WAAudioModule() {
  'use strict';

  const ENDPOINT_SEND  = '/api/whatsapp/audio/send';
  const ENDPOINT_SYNC  = '/api/whatsapp/audio/sync-conversa';
  const ENDPOINT_PLAY  = '/api/whatsapp/audio/play';

  // ─── Helpers de estado ───────────────────────────────────────────────────

  function isPreviewVisible() {
    const el = document.getElementById('wa-audio-preview');
    return !!(el && el.style.display === 'flex');
  }

  function getBlob() {
    try { return (typeof _audioBlob !== 'undefined' && _audioBlob instanceof Blob) ? _audioBlob : null; }
    catch { return null; }
  }

  function getConvAtiva() {
    try { return (typeof _convAtiva !== 'undefined') ? _convAtiva : null; }
    catch { return null; }
  }

  function getToken() {
    return localStorage.getItem('token') || '';
  }

  function fmtHora(iso) {
    try {
      const d = new Date(iso || Date.now());
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  // ─── Bloqueio UI durante envio ────────────────────────────────────────────

  function _bloquearUI() {
    const btn = document.getElementById('btn-send');
    if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"/></svg>'; }
    const cancelBtn = document.getElementById('btn-preview-cancel');
    if (cancelBtn) cancelBtn.disabled = true;
  }

  function _restaurarUI() {
    // _setRecUI('idle') já existe em whatsapp.js — chama se disponível
    try {
      if (typeof _setRecUI === 'function') _setRecUI('idle');
    } catch {}
    const cancelBtn = document.getElementById('btn-preview-cancel');
    if (cancelBtn) cancelBtn.disabled = false;
  }

  function _mostrarStatusEnvio(msg) {
    const label = document.getElementById('wa-rec-label');
    if (label) label.textContent = msg;
  }

  // ─── Envia áudio via FormData para endpoint dedicado ─────────────────────

  async function enviarAudioStorage(blob, convId, leadId) {
    _bloquearUI();
    _mostrarStatusEnvio('Enviando áudio...');

    const mime     = blob.type || 'audio/ogg';
    const ext      = mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'ogg';
    const nomeFich = `audio_${Date.now()}.${ext}`;

    const formData = new FormData();
    formData.append('audio', blob, nomeFich);
    formData.append('conversa_id', convId);
    if (leadId) formData.append('lead_id', leadId);

    console.log('FRONT_AUDIO_SEND_FORMDATA_READY', { conversaId: convId, size: blob.size, mime });

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api${ENDPOINT_SEND}`, true);
      const token = getToken();
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);

      xhr.addEventListener('load', () => {
        let json = {};
        try { json = JSON.parse(xhr.responseText); } catch {}

        if (xhr.status >= 200 && xhr.status < 300 && json.sucesso) {
          // ── Sucesso ──────────────────────────────────────────────────────
          const msg = json.dados || {
            id:          Date.now().toString(),
            conversa_id: convId,
            mensagem:    null,
            tipo:        'audio',
            direcao:     'enviada',
            status:      'enviado',
            arquivo_url: null,
            criado_em:   new Date().toISOString(),
          };

          // Injeta na lista de mensagens globais de whatsapp.js
          try {
            if (Array.isArray(_mensagens)) {
              _mensagens.push(msg);
              if (typeof renderMensagens === 'function') renderMensagens();
            }
          } catch {}

          // Atualiza preview da lista de conversas
          try {
            if (Array.isArray(_conversas) && typeof renderListaConversas === 'function') {
              _conversas = _conversas.map(c =>
                c.id === convId
                  ? { ...c, ultima_mensagem: '[Áudio]', ultima_direcao: 'enviada', ultima_msg_em: msg.criado_em }
                  : c
              );
              renderListaConversas();
              document.getElementById('conv-item-' + convId)?.classList.add('active');
            }
          } catch {}

          // Aviso se Evolution falhou mas áudio foi salvo
          try {
            if (!json._evo_ok && typeof Toast !== 'undefined') {
              Toast.show('Áudio salvo, mas houve falha no envio para o WhatsApp.', 'info');
            } else if (typeof Toast !== 'undefined') {
              Toast.show('Áudio enviado!', 'success');
            }
          } catch {}

          _restaurarUI();
          resolve({ sucesso: true });

        } else {
          // ── Erro ─────────────────────────────────────────────────────────
          const erro = json.erro || `Erro HTTP ${xhr.status}`;
          console.error('FRONT_AUDIO_SEND_ERROR', { status: xhr.status, erro });
          try { if (typeof Toast !== 'undefined') Toast.show('Falha ao enviar áudio: ' + erro, 'error'); } catch {}
          _restaurarUI();
          resolve({ sucesso: false, erro });
        }
      });

      xhr.addEventListener('error', () => {
        console.error('FRONT_AUDIO_SEND_NETWORK_ERROR');
        try { if (typeof Toast !== 'undefined') Toast.show('Erro de rede ao enviar áudio.', 'error'); } catch {}
        _restaurarUI();
        resolve({ sucesso: false, erro: 'Erro de rede' });
      });

      xhr.send(formData);
    });
  }

  // ─── Interceptor do botão de envio (capture phase) ────────────────────────

  function inicializar() {
    const sendBtn = document.getElementById('btn-send');
    if (!sendBtn) {
      console.warn('[WAAudio] btn-send não encontrado — módulo inativo.');
      return;
    }

    // capture: true → roda ANTES do listener de whatsapp.js (bubble phase)
    sendBtn.addEventListener('click', async function(e) {
      if (!isPreviewVisible()) return; // não é modo áudio — deixa whatsapp.js tratar

      const blob  = getBlob();
      if (!blob || blob.size === 0) return; // sem áudio válido — deixa whatsapp.js tratar

      const conv  = getConvAtiva();
      if (!conv?.id) {
        try { if (typeof Toast !== 'undefined') Toast.show('Selecione uma conversa.', 'error'); } catch {}
        e.stopImmediatePropagation();
        return;
      }

      // Intercepta — não deixa whatsapp.js enviar como JSON/base64
      e.stopImmediatePropagation();

      console.log('FRONT_AUDIO_SEND_START', { conversaId: conv.id, size: blob.size, type: blob.type });
      await enviarAudioStorage(blob, conv.id, conv.lead_id || null);

    }, true /* capture */);

    console.log('[WAAudio] Módulo de áudio isolado ativo (interceptor registrado).');
  }

  // ─── API pública: sincronização manual de áudios recebidos ───────────────

  window.WAAudioSync = {
    sincronizar: async function(conversaId) {
      if (!conversaId) {
        try { const c = getConvAtiva(); if (c) conversaId = c.id; } catch {}
      }
      if (!conversaId) return;
      try {
        const token = getToken();
        const r = await fetch(`/api${ENDPOINT_SYNC}/${conversaId}`, {
          method:  'POST',
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
        });
        const json = await r.json();
        console.log('[WAAudio] Sync resultado:', json);
        if (json.sincronizados > 0 && typeof carregarMensagens === 'function') {
          carregarMensagens(_convAtiva);
        }
        return json;
      } catch (e) {
        console.warn('[WAAudio] Sync erro:', e.message);
      }
    },
  };

  // ─── Inicializa após DOM ──────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
  } else {
    // DOM já pronto (script carregado no final do body)
    inicializar();
  }

})();
