/**
 * PROSPEKT CRM — Auth Client
 * Gerencia tokens, sessão e proteção de rotas no browser
 */

const Auth = (() => {
  const TOKEN_KEY = 'pkt_access_token';
  const USER_KEY  = 'pkt_user';
  let _refreshTimer = null;

  // ─────────────────────────────────────────────────────────────────────────
  // Token storage (sessionStorage para access token — nunca localStorage)
  // ─────────────────────────────────────────────────────────────────────────
  function setSession(accessToken, usuario) {
    sessionStorage.setItem(TOKEN_KEY, accessToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(usuario));
    scheduleRefresh(accessToken);
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    if (_refreshTimer) clearTimeout(_refreshTimer);
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function getUsuario() {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function isLoggedIn() {
    return !!getToken() && !!getUsuario();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Decodifica JWT sem verificação (só para ler exp)
  // ─────────────────────────────────────────────────────────────────────────
  function decodeToken(token) {
    try {
      const payload = token.split('.')[1];
      return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch { return null; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-refresh: renova 60s antes de expirar
  // ─────────────────────────────────────────────────────────────────────────
  function scheduleRefresh(token) {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    const decoded = decodeToken(token);
    if (!decoded?.exp) return;

    const expiresIn = (decoded.exp * 1000) - Date.now() - 60_000; // 60s antes
    if (expiresIn <= 0) {
      refreshToken();
      return;
    }

    _refreshTimer = setTimeout(refreshToken, expiresIn);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API Calls
  // ─────────────────────────────────────────────────────────────────────────
  async function api(method, path, body = null, retried = false) {
    const opts = {
      method,
      credentials: 'include', // envia cookies httpOnly
      headers: { 'Content-Type': 'application/json' },
    };

    const token = getToken();
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body)  opts.body = JSON.stringify(body);

    const res  = await fetch(`/api${path}`, opts);
    const data = await res.json();

    // Token expirado — tenta refresh automático uma vez
    if (res.status === 401 && data.codigo === 'TOKEN_EXPIRED' && !retried) {
      const refreshed = await refreshToken();
      if (refreshed) return api(method, path, body, true);
      redirect('/login.html');
      return null;
    }

    return { ok: res.ok, status: res.status, data };
  }

  async function refreshToken() {
    try {
      const res  = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.sucesso) {
        setSession(data.accessToken, data.usuario);
        return true;
      }
      return false;
    } catch { return false; }
  }

  async function login(email, senha) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    const data = await res.json();
    if (data.sucesso) {
      setSession(data.accessToken, data.usuario);
    }
    return data;
  }

  async function logout() {
    await api('POST', '/auth/logout');
    clearSession();
    redirect('/login.html');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Proteção de rotas
  // ─────────────────────────────────────────────────────────────────────────
  function redirect(url) {
    window.location.href = url;
  }

  /**
   * Chame na página protegida:
   * Auth.protegerRota() — redireciona para login se não autenticado
   * Auth.protegerRota('GESTOR') — exige role mínima
   */
  async function protegerRota(roleMinima = null) {
    // Tenta restaurar sessão via refresh token (cookie httpOnly)
    if (!isLoggedIn()) {
      const refreshed = await refreshToken();
      if (!refreshed) {
        redirect('/login.html');
        return false;
      }
    }

    const usuario = getUsuario();
    if (roleMinima) {
      const hierarquia = { SUPER_ADMIN: 3, GESTOR: 2, VENDEDOR: 1 };
      const nivelUser  = hierarquia[usuario.role] || 0;
      const nivelMin   = hierarquia[roleMinima]   || 99;
      if (nivelUser < nivelMin) {
        redirect('/acesso-negado.html');
        return false;
      }
    }

    return true;
  }

  /**
   * Na página de login: se já autenticado, redireciona para dashboard
   */
  async function redirecinarSeLogado() {
    if (isLoggedIn()) {
      redirect('/dashboard.html');
      return true;
    }
    const refreshed = await refreshToken();
    if (refreshed) {
      redirect('/dashboard.html');
      return true;
    }
    return false;
  }

  return {
    login,
    logout,
    api,
    getToken,
    getUsuario,
    isLoggedIn,
    protegerRota,
    redirecinarSeLogado,
    setSession,
    clearSession,
  };
})();
