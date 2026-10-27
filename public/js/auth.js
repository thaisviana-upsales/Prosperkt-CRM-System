/**
 * PROSPEKT CRM — Auth Client
 * Gerencia tokens, sessão e proteção de rotas no browser
 *
 * CORREÇÕES v2:
 *  - Redirect único via window.__redirectingToLogin (evita loop/piscar)
 *  - Refresh disparado para QUALQUER 401, não só TOKEN_EXPIRED
 *  - Refresh serializado: múltiplas chamadas paralelas aguardam a mesma Promise
 *  - Timer re-agendado ao carregar a página (se já havia token na sessionStorage)
 *  - Toast de sessão expirada antes do redirect
 */

const Auth = (() => {
  const _IS_DEV = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.__DEBUG__ === true
  );
  const logDebug  = (...args) => { if (_IS_DEV) console.log(...args); };
  const warnDebug = (...args) => { if (_IS_DEV) console.warn(...args); };

  const TOKEN_KEY = 'pkt_access_token';
  const USER_KEY  = 'pkt_user';
  let _refreshTimer   = null;
  let _refreshPromise = null; // serializa refreshes paralelos

  // B22: Configuração da política de retry com backoff exponencial
  const RETRY_CONFIG = {
    maxTentativas: 3,
    baseDelayMs: 1200,          // 1.2s, 2.4s, 4.8s (+ jitter)
    reagendamentoRedeMs: 25000, // nova tentativa em 25s se falhar por rede no auto-refresh
  };
  let _ultimoRefreshStatus = { sucesso: true, definitivo: false, erroRede: false };

  function _esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Token storage
  // ─────────────────────────────────────────────────────────────────────────
  function setSession(accessToken, usuario) {
    sessionStorage.setItem(TOKEN_KEY, accessToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(usuario));
    scheduleRefresh(accessToken);
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
    _refreshPromise = null;
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function getUsuario() {
    const raw = sessionStorage.getItem(USER_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
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
  // Auto-refresh: renova 90s antes de expirar
  // ─────────────────────────────────────────────────────────────────────────
  function scheduleRefresh(token) {
    if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
    const decoded = decodeToken(token);
    if (!decoded?.exp) return;

    const expiresIn = (decoded.exp * 1000) - Date.now() - 90_000; // 90s antes
    if (expiresIn <= 0) {
      // Já expirado ou prestes a expirar — faz refresh imediato
      logDebug('AUTH_SCHEDULE_REFRESH: token expirado/iminente, refresh imediato');
      refreshToken();
      return;
    }

    const minutos = Math.round(expiresIn / 60000);
    logDebug(`AUTH_SCHEDULE_REFRESH: próximo refresh em ~${minutos}min`);
    _refreshTimer = setTimeout(() => {
      logDebug('AUTH_TIMER_REFRESH: disparando refresh agendado');
      refreshToken();
    }, expiresIn);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Refresh token — resiliente com retry, backoff e tratamento de erro de rede
  // ─────────────────────────────────────────────────────────────────────────
  async function refreshToken() {
    // Se já há um refresh em andamento, aguarda o mesmo resultado
    if (_refreshPromise) {
      logDebug('AUTH_REFRESH_SERIALIZED: aguardando refresh em andamento...');
      return _refreshPromise;
    }

    _refreshPromise = (async () => {
      let erroDefinitivo = false;
      let erroRede = false;

      for (let t = 1; t <= RETRY_CONFIG.maxTentativas; t++) {
        try {
          logDebug(`AUTH_REFRESH_START: solicitando renovação (tentativa ${t}/${RETRY_CONFIG.maxTentativas})`);
          const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Accept': 'application/json' },
          });

          // Erro transitório do gateway/proxy (502, 503, 504)
          if (res.status >= 500) {
            erroRede = true;
            warnDebug(`AUTH_REFRESH_TEMP_SERVER_ERROR: HTTP ${res.status}`);
            if (t < RETRY_CONFIG.maxTentativas) {
              const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, t - 1) + Math.random() * 250;
              await _esperar(delay);
              continue;
            }
            break;
          }

          let data = {};
          try { data = await res.json(); } catch (_) {}

          if (res.ok && data.sucesso && data.accessToken) {
            setSession(data.accessToken, data.usuario);
            logDebug('AUTH_REFRESH_OK: novo token obtido e agendado');
            _ultimoRefreshStatus = { sucesso: true, definitivo: false, erroRede: false };
            return true;
          }

          // Erro definitivo de autenticação: refresh token ausente ou inválido no cookie
          if (res.status === 401 || res.status === 403) {
            erroDefinitivo = true;
            warnDebug('AUTH_REFRESH_DEFINITIVE_FAIL:', data.codigo || data.erro || 'Sessão inválida');
            break; // não adianta retry se a sessão realmente expirou ou foi revogada
          }

          warnDebug('AUTH_REFRESH_FAILED:', data.erro || 'Falha na resposta');
          break;

        } catch (e) {
          // Erro de rede (Failed to fetch, sem internet, offline)
          erroRede = true;
          warnDebug(`AUTH_NETWORK_ERROR_DURING_REFRESH: tentativa ${t}/${RETRY_CONFIG.maxTentativas}: ${e.message}`);
          if (t < RETRY_CONFIG.maxTentativas) {
            const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, t - 1) + Math.random() * 250;
            await _esperar(delay);
          }
        }
      }

      _ultimoRefreshStatus = {
        sucesso: false,
        definitivo: erroDefinitivo,
        erroRede: erroRede && !erroDefinitivo,
      };

      // Se falhou por instabilidade de rede e ainda temos sessão, reagenda nova tentativa silenciosa
      if (erroRede && !erroDefinitivo && isLoggedIn()) {
        logDebug(`AUTH_REFRESH_RETRY_SCHEDULED: reagendando refresh em ${RETRY_CONFIG.reagendamentoRedeMs/1000}s devido a erro de rede`);
        if (_refreshTimer) clearTimeout(_refreshTimer);
        _refreshTimer = setTimeout(() => {
          refreshToken();
        }, RETRY_CONFIG.reagendamentoRedeMs);
      }

      return false;
    })();

    try {
      return await _refreshPromise;
    } finally {
      _refreshPromise = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Redirect único — evita loop de redirects paralelos
  // ─────────────────────────────────────────────────────────────────────────
  function redirectToLogin(motivo = '') {
    // Proteção: nunca executa mais de uma vez por ciclo de vida da página
    if (window.__redirectingToLogin) {
      warnDebug('AUTH_REDIRECT_BLOCKED: redirect já em andamento, ignorando');
      return;
    }
    window.__redirectingToLogin = true;

    warnDebug('AUTH_REDIRECT_TO_LOGIN_ONCE', { motivo });

    // Exibe mensagem clara antes de redirecionar
    _mostrarSessaoExpirada(() => {
      clearSession();
      window.location.href = '/login.html';
    });
  }

  function _mostrarSessaoExpirada(callback) {
    // Tenta usar Toast se disponível, senão usa alert simples
    try {
      if (typeof Toast !== 'undefined') {
        Toast.show('Sessão expirada. Redirecionando para o login...', 'warning');
        setTimeout(callback, 2000);
        return;
      }
    } catch (_) {}
    // Fallback: sem alert (não bloqueia), só aguarda e redireciona
    setTimeout(callback, 800);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API Calls com tratamento robusto de 401
  // ─────────────────────────────────────────────────────────────────────────
  async function api(method, path, body = null, _retried = false) {
    const token = getToken();

    const opts = {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body)  opts.body = JSON.stringify(body);


    let res, data;
    try {
      res  = await fetch(`/api${path}`, opts);
      data = await res.json();
    } catch (e) {
      // Erro de rede (offline, CORS, etc.) — não é 401, não faz redirect
      warnDebug('AUTH_NETWORK_ERROR', { url: `/api${path}`, error: e.message });
      return { ok: false, status: 0, data: { sucesso: false, erro: 'Erro de rede.' } };
    }

    // ── Tratamento de 401 ────────────────────────────────────────────────
    if (res.status === 401) {
      warnDebug('AUTH_401_RECEIVED', { url: `/api${path}`, status: res.status, codigo: data?.codigo });

      // Se já redirecionando, para tudo
      if (window.__redirectingToLogin) {
        return { ok: false, status: 401, data };
      }

      // Tenta refresh uma única vez (para qualquer tipo de 401)
      if (!_retried) {
        const refreshed = await refreshToken();
        if (refreshed) {
          logDebug('AUTH_RETRY_AFTER_REFRESH', { url: `/api${path}` });
          return api(method, path, body, true); // tenta novamente com novo token
        }
      }

      // Refresh falhou ou já foi tentado — só redireciona se for erro definitivo
      if (_ultimoRefreshStatus.definitivo) {
        redirectToLogin(`Sessão expirada em ${path}`);
      } else {
        warnDebug('AUTH_PRESERVE_SESSION: falha de rede transitória no refresh, sessão preservada');
      }
      return { ok: false, status: 401, data };
    }

    return { ok: res.ok, status: res.status, data };
  }

  async function login(email, senha) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    const data = await res.json();
    if (data.sucesso && !data.deve_trocar_senha) {
      // Só salva sessão se NÃO precisa trocar senha
      setSession(data.accessToken, data.usuario);
      window.__redirectingToLogin = false;
    }
    return data;
  }

  async function logout() {
    await api('POST', '/auth/logout');
    clearSession();
    window.location.href = '/login.html';
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
    if (!isLoggedIn()) {
      const refreshed = await refreshToken();
      if (!refreshed) {
        if (_ultimoRefreshStatus.definitivo) {
          redirectToLogin('protegerRota: sem sessão válida');
        }
        return false;
      }
    }

    // Re-agenda refresh ao entrar na página (timer pode ter sido perdido)
    const token = getToken();
    if (token && !_refreshTimer) {
      scheduleRefresh(token);
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

  // ─────────────────────────────────────────────────────────────────────────
  // Init: ao carregar qualquer página protegida, re-agenda refresh se já há token
  // ─────────────────────────────────────────────────────────────────────────
  (function _initRefreshTimer() {
    const token = getToken();
    if (token) {
      scheduleRefresh(token);
    }
  })();

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
    refreshToken,
  };
})();
