/**
 * PROSPERKT CRM — Sidebar Component (shared)
 * Inclua com: <script src="/js/sidebar.js"></script>
 * E chame: Sidebar.render('pipeline') // id da nav-item ativa
 */
const Sidebar = (() => {
  const ROLE_LABELS = { SUPER_ADMIN:'Super Admin', GESTOR:'Gestor', VENDEDOR:'Vendedor' };

  const NAV = [
    { id:'dashboard', href:'/dashboard.html', label:'Dashboard', roles:['SUPER_ADMIN','GESTOR','VENDEDOR'],
      icon:`<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>` },
    { id:'pipeline', href:'/pipeline.html', label:'Pipeline / CRM', roles:['SUPER_ADMIN','GESTOR','VENDEDOR'],
      icon:`<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>` },
    { id:'funis', href:'/funis.html', label:'Funis', roles:['SUPER_ADMIN','GESTOR'],
      icon:`<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>` },
    { id:'whatsapp', href:'/whatsapp.html', label:'Conversas', roles:['SUPER_ADMIN','GESTOR','VENDEDOR'],
      icon:`<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>` },
    { id:'metas', href:'/metas.html', label:'Metas', roles:['SUPER_ADMIN','GESTOR','VENDEDOR'],
      icon:`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>` },
    { id:'comissoes', href:'/comissoes.html', label:'Comissões', roles:['SUPER_ADMIN','GESTOR','VENDEDOR'],
      icon:`<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>` },
    { section:'Administração', roles:['SUPER_ADMIN','GESTOR'] },
    { id:'usuarios', href:'/usuarios.html', label:'Usuários', roles:['SUPER_ADMIN','GESTOR'],
      icon:`<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>` },
    { id:'mensagens-padrao', href:'/mensagens-padrao.html', label:'Biblioteca de Mensagens', roles:['SUPER_ADMIN','GESTOR','VENDEDOR'],
      icon:`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>` },
    { id:'automacoes', href:'/automacoes.html', label:'Automações', roles:['SUPER_ADMIN'],
      icon:`<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="8" x2="12" y2="16"/>` },
    // { id:'logs', href:'/logs.html', label:'Logs de Auditoria', roles:['SUPER_ADMIN','GESTOR'],
    //   icon:`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>` },
    { id:'integracao-whatsapp', href:'/integracao-whatsapp.html', label:'Integração WhatsApp', roles:['SUPER_ADMIN'],
      icon:`<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><circle cx="12" cy="11" r="1"/><line x1="12" y1="7" x2="12" y2="7"/><line x1="12" y1="15" x2="12" y2="15"/>` },
  ];

  function render(activeId, usuario) {
    const role = usuario?.role || 'VENDEDOR';
    const canSee = (roles) => roles.includes(role);

    const navHTML = NAV.map(item => {
      if (item.section) {
        if (!canSee(item.roles)) return '';
        return `<span class="nav-section-label">${item.section}</span>`;
      }
      if (!canSee(item.roles)) return '';
      return `<a href="${item.href}" class="nav-item${item.id===activeId?' active':''}" id="nav-${item.id}">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${item.icon}</svg>
        ${item.label}
      </a>`;
    }).join('');

    const initials = (usuario?.nome||'?').slice(0,2).toUpperCase();
    // Usa Avatar helper se disponível (carregado antes do sidebar em páginas que o incluem)
    const avatarHtml = (typeof Avatar !== 'undefined')
      ? Avatar.html(usuario, 32, '')
      : `<div style="width:32px;height:32px;border-radius:50%;background:var(--grad-brand);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:#0D0D0D;flex-shrink:0">${initials}</div>`;
    return `
      <aside class="sidebar" role="navigation" aria-label="Menu principal">
        <div class="sidebar-logo">
          <div style="display:flex;align-items:center;gap:10px">
            <img src="/img/logo_original_backup.png" alt="PROSPERKT Logo" style="width:36px;height:36px;object-fit:contain;flex-shrink:0;">
            <div><div class="logo-text">PROSPERKT</div><div class="logo-sub">CRM Enterprise</div></div>
          </div>
        </div>
        <nav class="sidebar-nav">${navHTML}</nav>
        <div class="sidebar-footer">
          <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border);margin-bottom:8px">
            ${avatarHtml}
            <div style="flex:1;min-width:0">
              <div style="font-size:0.8125rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${usuario?.nome||'...'}</div>
              <div style="font-size:0.6875rem;color:var(--text-muted)">${ROLE_LABELS[role]||role}</div>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm w-full" id="btn-logout">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sair
          </button>
        </div>
      </aside>`;
  }

  async function init(activeId, roleMinima = 'VENDEDOR') {


    const ok = await Auth.protegerRota(roleMinima);
    if (!ok) return null;
    const usuario = Auth.getUsuario();
    const el = document.getElementById('sidebar-container');
    if (el) el.innerHTML = render(activeId, usuario);
    document.getElementById('btn-logout')?.addEventListener('click', () => Auth.logout());
    return usuario;
  }

  return { render, init };
})();
