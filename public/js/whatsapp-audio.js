/**
 * whatsapp-audio.js — Módulo isolado de áudio v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Carregado APÓS whatsapp.js. Corrige dois problemas sem tocar em whatsapp.js:
 *
 *   1. Player 0:00/0:00 → MutationObserver detecta preview visível e chama
 *      prevEl.load() para forçar carregamento da nova source.
 *
 *   2. Botão permanece como microfone → após _setRecUI('preview') setar o ícone
 *      de mic, o Observer sobrescreve com paper-plane + tooltip "Enviar áudio".
 *
 * NÃO sobrescreve nenhuma função global de whatsapp.js.
 * NÃO toca em envio/recebimento de texto.
 * NÃO interfere quando não há áudio gravado.
 *
 * Globais de whatsapp.js usados (somente leitura ou chamadas):
 *   _audioBlob, _convAtiva, _mensagens (push — mutação, não reassign)
 *   _setRecUI(), cancelarGravacao(), renderMensagens(), renderListaConversas()
 */

(function WAAudioModuleV2() {
  'use strict';

  // ─── Constantes ─────────────────────────────────────────────────────────────
  const ENDPOINT_AUDIO = '/api/whatsapp/audio/send'; // URL completa — não prefixar novamente com /api

  // Ícone paper-plane (enviar) — substituirá o mic que _setRecUI('preview') coloca
  const ICON_ENVIAR_AUDIO = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0D0D0D" stroke-width="2.5">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>`;

  // ─── Estado local do módulo ──────────────────────────────────────────────────
  let _previewBlob = null; // cópia local do blob — nunca reatribui _audioBlob global

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function _isPreviewVisible() {
    const el = document.getElementById('wa-audio-preview');
    return !!(el && el.style.display === 'flex');
  }

  function _getConvAtiva() {
    try { return (typeof _convAtiva !== 'undefined') ? _convAtiva : null; } catch { return null; }
  }

  function _getGlobalBlob() {
    try { return (typeof _audioBlob !== 'undefined' && _audioBlob instanceof Blob) ? _audioBlob : null; } catch { return null; }
  }

  function _getToken() {
    // Usa o helper oficial do CRM (evita hardcodar chave/storage)
    try { if (typeof Auth !== 'undefined' && Auth.getToken) return Auth.getToken() || ''; } catch {}
    // Fallback direto à chave oficial do sessionStorage (pkt_access_token)
    return sessionStorage.getItem('pkt_access_token') || '';
  }

  function _toast(msg, tipo) {
    try { if (typeof Toast !== 'undefined') Toast.show(msg, tipo); } catch {}
  }

  function _ext(mime) {
    if (!mime) return 'ogg';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('ogg'))  return 'ogg';
    if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
    if (mime.includes('wav')) return 'wav';
    return 'ogg';
  }

  // ─── Ações quando preview entra em modo visível ──────────────────────────────
  function _aoExibirPreview() {
    const blob = _getGlobalBlob();

    // Valida blob
    if (!blob || blob.size === 0 || !blob.type.startsWith('audio/')) {
      console.warn('FRONT_AUDIO_BLOB_INVALID', { existe: !!blob, size: blob?.size, type: blob?.type });
      _toast('Não foi possível gravar o áudio. Tente novamente.', 'error');
      try { if (typeof _setRecUI === 'function') _setRecUI('idle'); } catch {}
      return;
    }

    _previewBlob = blob;
    console.log('FRONT_AUDIO_BLOB_READY', { size: blob.size, type: blob.type });

    // ── Fix 1: forçar load() no player e corrigir duração 0:00 (Chrome/WebM) ─
    const prevEl = document.getElementById('wa-audio-prev-el');
    if (prevEl) {
      // Garante src (whatsapp.js já setou, mas cria fallback se necessário)
      if (!prevEl.src || prevEl.src === window.location.href) {
        try { prevEl.src = URL.createObjectURL(blob); } catch {}
      }

      prevEl.load(); // força browser a processar nova source

      prevEl.addEventListener('loadedmetadata', () => {
        // Chrome com audio/webm não embute duration no header → retorna Infinity
        // Fix: seek para posição absurda força browser a calcular duração real
        if (!isFinite(prevEl.duration) || prevEl.duration === 0) {
          prevEl.currentTime = 1e101;
          prevEl.addEventListener('timeupdate', function onSeek() {
            prevEl.removeEventListener('timeupdate', onSeek);
            prevEl.currentTime = 0;
            console.log('FRONT_AUDIO_PREVIEW_READY', { duration: prevEl.duration, fixedWebM: true });
          });
        } else {
          console.log('FRONT_AUDIO_PREVIEW_READY', { duration: prevEl.duration });
        }
      }, { once: true });

      prevEl.addEventListener('error', (e) => {
        console.warn('FRONT_AUDIO_PREVIEW_ERROR', { error: e.type });
      }, { once: true });
    }

    // ── Fix 2: trocar ícone mic por paper-plane no sendBtn ───────────────────
    // Usa requestAnimationFrame para garantir que _setRecUI('preview') já finalizou
    requestAnimationFrame(() => {
      const sendBtn = document.getElementById('btn-send');
      if (sendBtn && _isPreviewVisible()) {
        sendBtn.innerHTML = ICON_ENVIAR_AUDIO;
        sendBtn.title     = 'Enviar áudio';
        sendBtn.disabled  = false;
      }
    });
  }

  // ─── Ações quando preview é ocultado (envio ou cancelamento) ────────────────
  function _aoOcultarPreview() {
    _previewBlob = null;
    console.log('FRONT_AUDIO_CANCEL');
  }

  // ─── MutationObserver no div de preview ─────────────────────────────────────
  function _configurarObserver() {
    const previewDiv = document.getElementById('wa-audio-preview');
    if (!previewDiv) {
      console.warn('[WAAudio] wa-audio-preview não encontrado.');
      return;
    }

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'attributes' || m.attributeName !== 'style') continue;
        if (previewDiv.style.display === 'flex') {
          _aoExibirPreview();
        } else {
          _aoOcultarPreview();
        }
      }
    });

    obs.observe(previewDiv, { attributes: true, attributeFilter: ['style'] });
    console.log('[WAAudio] Observer configurado em wa-audio-preview.');
  }

  // ─── Envio via FormData → endpoint isolado ───────────────────────────────────
  async function _enviarAudioStorage() {
    const blob = _previewBlob;
    const conv = _getConvAtiva();

    if (!blob || blob.size === 0) {
      console.warn('FRONT_AUDIO_SEND_ERROR', { motivo: 'blob ausente ou vazio' });
      return;
    }
    if (!conv?.id) {
      _toast('Selecione uma conversa antes de enviar.', 'error');
      return;
    }

    console.log('FRONT_AUDIO_SEND_CLICK', { conversaId: conv.id, size: blob.size, type: blob.type });

    // Bloqueia botão durante envio
    const sendBtn = document.getElementById('btn-send');
    if (sendBtn) {
      sendBtn.disabled  = true;
      sendBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D0D0D" stroke-width="2.5"
        style="animation:wa-spin 1s linear infinite">
        <circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"/>
      </svg>`;
    }

    const mime = blob.type || 'audio/ogg';
    const ext  = _ext(mime);
    const fd   = new FormData();
    fd.append('audio',        blob, `audio_${Date.now()}.${ext}`);
    fd.append('conversa_id',  conv.id);
    if (conv.lead_id) fd.append('lead_id', conv.lead_id);

    const result = await new Promise((resolve) => {
      const xhr   = new XMLHttpRequest();
      const token = _getToken();

      console.log('WA_AUDIO_AUTH_TOKEN_PRESENT', { present: !!token });

      if (!token) {
        // Sessão expirada — não adianta nem tentar
        _toast('Sessão expirada. Faça login novamente.', 'error');
        resolve({ ok: false, erro: 'Token de autenticação ausente.' });
        return;
      }

      xhr.open('POST', ENDPOINT_AUDIO, true); // ENDPOINT_AUDIO já contém /api — não duplicar
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      // NÃO definir Content-Type — browser gera boundary do FormData automaticamente

      console.log('WA_AUDIO_SEND_REQUEST_START', { conversaId: conv.id, size: blob.size, type: blob.type });

      xhr.addEventListener('load', () => {
        let json = {};
        try { json = JSON.parse(xhr.responseText); } catch {}
        console.log('WA_AUDIO_SEND_RESPONSE', { status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300 });
        if (xhr.status >= 200 && xhr.status < 300 && json.sucesso) {
          resolve({ ok: true, dados: json.dados, _evo_ok: json._evo_ok });
        } else {
          resolve({ ok: false, erro: json.erro || `HTTP ${xhr.status}` });
        }
      });
      xhr.addEventListener('error', () => resolve({ ok: false, erro: 'Erro de rede' }));
      xhr.send(fd);
    });


    if (result.ok) {
      console.log('FRONT_AUDIO_SEND_SUCCESS', { conversaId: conv.id, evoOk: result._evo_ok });

      // Reset UI — usa cancelarGravacao de whatsapp.js para limpar estado
      try { if (typeof cancelarGravacao === 'function') cancelarGravacao(); } catch {}

      // Injeta mensagem na conversa sem recarregar da rede
      try {
        const msg = result.dados || {
          id:          `audio_local_${Date.now()}`,
          conversa_id: conv.id,
          lead_id:     conv.lead_id || null,
          mensagem:    null,
          tipo:        'audio',
          direcao:     'enviada',
          status:      'enviado',
          arquivo_url: null,
          criado_em:   new Date().toISOString(),
        };
        if (Array.isArray(_mensagens)) {
          _mensagens.push(msg);
          if (typeof renderMensagens === 'function') renderMensagens();
        }
      } catch {}

      // Atualiza lista de conversas (mutação no array existente, não reassign)
      try {
        if (Array.isArray(_conversas) && typeof renderListaConversas === 'function') {
          const agora = new Date().toISOString();
          // Encontra e muta o objeto sem reatribuir a variável
          const idx = _conversas.findIndex(c => c.id === conv.id);
          if (idx !== -1) {
            _conversas[idx].ultima_mensagem = '[Áudio]';
            _conversas[idx].ultima_direcao  = 'enviada';
            _conversas[idx].ultima_msg_em   = agora;
          }
          renderListaConversas();
          document.getElementById('conv-item-' + conv.id)?.classList.add('active');
        }
      } catch {}

      if (!result._evo_ok) {
        _toast('Áudio salvo, mas houve falha ao enviar para o WhatsApp.', 'info');
      } else {
        _toast('Áudio enviado!', 'success');
      }

    } else {
      console.error('FRONT_AUDIO_SEND_ERROR', { erro: result.erro });
      _toast('Falha ao enviar áudio: ' + result.erro, 'error');

      // Restaura botão de envio
      if (sendBtn) {
        sendBtn.disabled  = false;
        sendBtn.innerHTML = ICON_ENVIAR_AUDIO;
        sendBtn.title     = 'Enviar áudio';
      }
    }
  }

  // ─── Interceptor capture no sendBtn ─────────────────────────────────────────
  // Roda ANTES do listener de whatsapp.js (que é bubble phase)
  // Intercepta SOMENTE quando há áudio em preview — nunca bloqueia texto
  function _configurarInterceptor() {
    const sendBtn = document.getElementById('btn-send');
    if (!sendBtn) {
      console.warn('[WAAudio] btn-send não encontrado — interceptor inativo.');
      return;
    }

    sendBtn.addEventListener('click', async function(e) {
      // ── Guarda de segurança 1: não há preview visível → não intercepta ──────
      if (!_isPreviewVisible()) return;

      // ── Guarda de segurança 2: não há blob válido → não intercepta ──────────
      if (!_previewBlob || _previewBlob.size === 0) return;

      // ── Intercepta: impede whatsapp.js de processar como texto ──────────────
      e.stopImmediatePropagation();

      console.log('FRONT_AUDIO_SEND_CLICK_INTERCEPTED', { size: _previewBlob.size });
      await _enviarAudioStorage();

    }, true /* capture = roda antes do bubble de whatsapp.js */);

    console.log('[WAAudio] Interceptor de áudio registrado (capture phase).');
  }

  // ─── API pública (opcional — pode chamar do console) ─────────────────────────
  window.WAAudioSync = {
    sincronizar: async function(conversaId) {
      if (!conversaId) {
        try { const c = _getConvAtiva(); if (c) conversaId = c.id; } catch {}
      }
      if (!conversaId) return;
      const token = _getToken();
      try {
        const r    = await fetch(`/api/whatsapp/audio/sync-conversa/${conversaId}`, {
          method: 'POST',
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        const json = await r.json();
        console.log('[WAAudio] Sync resultado:', json);
        if (json.sincronizados > 0 && typeof carregarMensagens === 'function') {
          carregarMensagens(_convAtiva);
        }
        return json;
      } catch (err) {
        console.warn('[WAAudio] Sync erro:', err.message);
      }
    },
  };

  // ─── Inicialização ───────────────────────────────────────────────────────────
  function inicializar() {
    _configurarObserver();
    _configurarInterceptor();

    // Injeta keyframe de spinner (uma vez, sem duplicar)
    if (!document.getElementById('wa-audio-style')) {
      const s = document.createElement('style');
      s.id = 'wa-audio-style';
      s.textContent = '@keyframes wa-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(s);
    }

    // ── Fix global: duração 0:00 em TODOS os players de áudio da conversa ──────
    // Chrome/WebM não embute duration no header → browser reporta Infinity ou 0
    // Seek hack força o browser a calcular a duração real procurando o final do arquivo
    function _fixAudioDuration(el) {
      if (!el || el.dataset.waDurFix) return;
      el.dataset.waDurFix = '1';

      const applyFix = () => {
        if (!isFinite(el.duration) || el.duration === 0) {
          el.currentTime = 1e101;
          el.addEventListener('timeupdate', function f() {
            el.removeEventListener('timeupdate', f);
            el.currentTime = 0;
          });
        }
      };

      if (el.readyState >= 1) {
        // Metadados já carregados
        applyFix();
      } else {
        el.addEventListener('loadedmetadata', applyFix, { once: true });
      }
    }

    // Aplica a todos os <audio> já existentes no DOM
    document.querySelectorAll('audio').forEach(_fixAudioDuration);

    // Observa novos <audio> adicionados (ex: renderMensagens() ao trocar conversa)
    const _durObserver = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'AUDIO') { _fixAudioDuration(node); continue; }
          node.querySelectorAll?.('audio').forEach(_fixAudioDuration);
        }
      }
    });
    _durObserver.observe(document.body, { childList: true, subtree: true });

    console.log('[WAAudio v2] Módulo de áudio isolado ativo.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
  } else {
    inicializar();
  }

})();
