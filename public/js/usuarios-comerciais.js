/**
 * PROSPEKT CRM — Módulo Global de Usuários Comerciais
 * =====================================================
 * Fonte única e centralizada para carregar usuários comerciais ativos
 * e popular selects/filtros em todo o CRM.
 *
 * Uso:
 *   await UsuariosComerciais.carregar();               // busca do backend
 *   UsuariosComerciais.popular(selectElement, opts);   // popula um <select>
 *   UsuariosComerciais.lista();                        // retorna array atual
 *
 * Papéis comerciais reconhecidos (case-insensitive):
 *   VENDEDOR, SDR, GESTOR, CLOSER, COMERCIAL, SALES, SELLER
 *   + SUPER_ADMIN (tem acesso a todos os leads)
 */
(function (global) {
  'use strict';

  // ── Papéis que devem aparecer nos filtros comerciais ──────────────────────
  const ROLES_COMERCIAIS = new Set([
    'vendedor', 'sdr', 'gestor', 'closer', 'comercial', 'sales', 'seller',
    'super_admin',
  ]);

  function isRoleComercial(role) {
    return ROLES_COMERCIAIS.has((role || '').toLowerCase().trim());
  }

  function isAtivo(u) {
    return u.ativo === true || u.ativo === 1 || u.ativo === '1' || u.ativo === 'true';
  }

  // ── Estado interno ────────────────────────────────────────────────────────
  let _lista      = [];       // usuários comerciais ativos (cache)
  let _carregando = false;
  let _carregado  = false;
  let _promise    = null;     // evita requests paralelas

  // ── Busca do backend ──────────────────────────────────────────────────────
  async function carregar({ forcar = false } = {}) {
    if (_carregando && _promise) return _promise;  // evita duplicidade
    if (_carregado && !forcar) return _lista;

    _carregando = true;
    _promise = _buscarDoBackend().finally(() => {
      _carregando = false;
      _carregado  = true;
      _promise    = null;
    });
    return _promise;
  }

  async function _buscarDoBackend() {
    try {
      // Tenta /usuarios/responsaveis primeiro (mais específico, já filtra ativos)
      const r1 = await Auth.api('GET', '/usuarios/responsaveis');
      const lista1 = r1?.data?.dados || [];
      if (lista1.length > 0) {
        _lista = _filtrar(lista1, '/usuarios/responsaveis');
        console.log('[USUARIOS_COMERCIAIS] carregados de /responsaveis:', _lista.length);
        return _lista;
      }

      // Fallback: /usuarios (retorna todos os ativos por padrão)
      const r2 = await Auth.api('GET', '/usuarios');
      const lista2 = r2?.data?.dados || [];
      _lista = _filtrar(lista2, '/usuarios');
      console.log('[USUARIOS_COMERCIAIS] carregados de /usuarios:', _lista.length);
      return _lista;
    } catch (e) {
      console.error('[USUARIOS_COMERCIAIS] Erro ao carregar:', e.message);
      return _lista; // retorna cache anterior se já tinha
    }
  }

  function _filtrar(lista, origem) {
    const vistos = new Set();
    const validos = [];
    const descartados = [];

    (lista || []).forEach(u => {
      if (vistos.has(u.id)) return; // evita duplicidade
      const ativo   = isAtivo(u);
      const roleOk  = isRoleComercial(u.role);
      const temNome = !!(u.nome || u.email);

      if (ativo && roleOk && temNome) {
        validos.push({
          id:    u.id,
          nome:  u.nome || u.email,  // e-mail como fallback se sem nome
          email: u.email || '',
          role:  (u.role || '').toUpperCase(),
        });
        vistos.add(u.id);
      } else {
        descartados.push({ nome: u.nome, role: u.role, ativo: u.ativo,
          motivo: !ativo ? 'inativo' : !roleOk ? 'role_nao_comercial' : 'sem_nome' });
      }
    });

    // Ordena por nome (A→Z)
    validos.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));

    if (descartados.length > 0)
      console.log('[USUARIOS_COMERCIAIS] descartados em', origem, JSON.stringify(descartados));

    return validos;
  }

  // ── Popular um <select> ───────────────────────────────────────────────────
  /**
   * @param {HTMLSelectElement|string} sel   Elemento ou ID do select
   * @param {Object}  opts
   * @param {string}  opts.primeiraNome      Texto da primeira opção (default: "Todos")
   * @param {string}  opts.primeiroValor     Valor da primeira opção (default: "")
   * @param {boolean} opts.semPrimeira       Se true, não adiciona opção "Todos"
   * @param {string}  opts.valorSelecionado  Pré-seleciona este valor, se informado
   */
  function popular(sel, opts = {}) {
    if (typeof sel === 'string') sel = document.getElementById(sel);
    if (!sel) return;

    const primeiraNome  = opts.primeiraNome  ?? 'Todos';
    const primeiroValor = opts.primeiroValor ?? '';
    const semPrimeira   = opts.semPrimeira   ?? false;
    const valorAtual    = opts.valorSelecionado ?? sel.value;

    const opcoesUsuarios = _lista.map(u =>
      `<option value="${u.id}">${_escHtml(u.nome)}</option>`
    ).join('');

    sel.innerHTML = (semPrimeira ? '' : `<option value="${primeiroValor}">${_escHtml(primeiraNome)}</option>`)
      + opcoesUsuarios;

    // Restaura seleção anterior se ainda válida
    if (valorAtual) {
      const existe = Array.from(sel.options).some(o => o.value === valorAtual);
      if (existe) sel.value = valorAtual;
    }

    console.log('[USUARIOS_COMERCIAIS] popular | select:', sel.id || '(sem id)', '| opções:', _lista.length);
  }

  function _escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Retorna lista atual (sem buscar) ─────────────────────────────────────
  function lista() { return _lista; }

  // ── Invalida cache (chamar após criar/editar usuário) ─────────────────────
  function invalidar() {
    _lista     = [];
    _carregado = false;
    console.log('[USUARIOS_COMERCIAIS] cache invalidado');
  }

  // ── API pública ───────────────────────────────────────────────────────────
  global.UsuariosComerciais = { carregar, popular, lista, invalidar };

})(window);
