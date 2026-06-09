/**
 * PROSPEKT CRM — Avatar Utility
 * Funções compartilhadas para exibição e upload de avatars de usuários.
 * Inclua: <script src="/js/avatar.js"></script>
 */

const Avatar = (() => {
  /**
   * Gera HTML de um avatar circular.
   * @param {Object} u        — objeto usuário com avatar_url e nome
   * @param {number} size     — tamanho em px (padrão 36)
   * @param {string} extra    — estilos CSS extras
   */
  function html(u, size = 36, extra = '') {
    if (!u) return _fallback('?', size, extra);
    if (u.avatar_url) {
      return `<img
        src="${escAttr(u.avatar_url)}"
        alt="${escAttr(u.nome || '?')}"
        title="${escAttr(u.nome || '')}"
        style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;${extra}"
        onerror="this.replaceWith(Avatar._fallbackEl('${escAttr(u.nome || '?')}', ${size}))"
      >`;
    }
    return _fallback(u.nome || '?', size, extra);
  }

  function _fallback(nome, size, extra = '') {
    const initials = (nome || '?').slice(0, 2).toUpperCase();
    const fs = Math.max(Math.round(size * 0.38), 10);
    return `<div title="${escAttr(nome)}" style="width:${size}px;height:${size}px;border-radius:50%;background:var(--grad-brand);display:flex;align-items:center;justify-content:center;font-size:${fs}px;font-weight:700;color:#0D0D0D;flex-shrink:0;${extra}">${initials}</div>`;
  }

  // Cria elemento DOM (usado no onerror do img)
  function _fallbackEl(nome, size) {
    const div = document.createElement('div');
    div.innerHTML = _fallback(nome, size);
    return div.firstElementChild;
  }

  function escAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Lê um arquivo de imagem do <input type="file">,
   * redimensiona para maxPx x maxPx preservando proporção
   * e resolve com a data URL resultante.
   */
  function readAndResize(file, maxPx = 256) {
    return new Promise((resolve, reject) => {
      const TIPOS = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!TIPOS.includes(file.type)) {
        return reject(new Error('Formato inválido. Use JPG, PNG ou WEBP.'));
      }
      if (file.size > 5 * 1024 * 1024) {
        return reject(new Error('Arquivo muito grande. Máximo 5MB.'));
      }

      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxPx || h > maxPx) {
            if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
            else        { w = Math.round(w * maxPx / h); h = maxPx; }
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => reject(new Error('Erro ao carregar imagem.'));
        img.src = ev.target.result;
      };
      reader.onerror = () => reject(new Error('Erro ao ler arquivo.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Abre um seletor de arquivo, redimensiona e faz upload para a API.
   * @param {string} userId  — id do usuário
   * @param {Function} onSuccess(usuario) — callback com dados atualizados
   * @param {Function} onError(msg)       — callback de erro
   */
  function promptUpload(userId, onSuccess, onError) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/jpeg,image/jpg,image/png,image/webp';
    inp.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0';
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
      if (!inp.files[0]) { inp.remove(); return; }
      try {
        const dataUrl = await readAndResize(inp.files[0], 256);
        const r = await Auth.api('POST', `/usuarios/${userId}/avatar`, { avatar_url: dataUrl });
        if (r?.ok) {
          onSuccess && onSuccess(r.data.dados);
        } else {
          onError && onError(r?.data?.erro || 'Erro ao salvar foto.');
        }
      } catch (e) {
        onError && onError(e.message);
      } finally {
        inp.remove();
      }
    });
    inp.click();
  }

  return { html, _fallbackEl, readAndResize, promptUpload };
})();
