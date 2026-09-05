/**
 * BurhanGPT v2 - Frontend
 * Auth, sunucu tabanlı sohbet geçmişi, model seçimi, SSE streaming, ChatGPT arayüzü.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // 👉 BURAYI DEĞİŞTİR: Render'ın sana verdiği backend adresi (sonunda / OLMASIN)
  // ---------------------------------------------------------------------------
  const BACKEND_URL = 'https://burhangpt-backend.onrender.com';

  // GitHub Pages'ten veya dosyadan açılırsa BACKEND_URL'e; Render'da/yerelde kendi adresine bağlan
  const API_BASE = (() => {
    const origin = window.location.origin;
    if (window.location.protocol === 'file:' || !origin || origin === 'null') return BACKEND_URL;
    if (window.location.hostname.endsWith('github.io')) return BACKEND_URL;
    return origin;
  })();

  const TOKEN_KEY = 'burhangpt_token';
  const MODEL_KEY = 'burhangpt_model';
  const SIDEBAR_KEY = 'burhangpt_sidebar_collapsed';
  const GUEST_KEY = 'burhangpt_guest_usage';
  const SETTINGS_KEY = 'burhangpt_settings';
  const guestUsage = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(GUEST_KEY) || '{}');
      if (saved.resetAt > Date.now()) return saved;
    } catch {}
    return { count: 0, resetAt: Date.now() + 86400000 };
  })();

  const state = {
    token: localStorage.getItem(TOKEN_KEY),
    user: null,
    guest: false,
    guestUsed: guestUsage.count || 0,
    googleEnabled: false,
    githubEnabled: false,
    models: [],
    model: localStorage.getItem(MODEL_KEY) || 'fast',
    conversations: [],
    currentId: null,
    messages: [],
    streaming: false,
    abort: null,
    autoScroll: true,
    authMode: 'login',
    ctxTargetId: null,
    attachments: [],
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    authView: $('auth-view'), authTitle: $('auth-title'), authForm: $('auth-form'),
    authUser: $('auth-username'), authPass: $('auth-password'), authPass2: $('auth-password2'),
    authPass2Wrap: $('auth-password2-wrap'), authError: $('auth-error'), authSubmit: $('auth-submit'),
    authSwitch: $('auth-switch'), authSwitchText: $('auth-switch-text'),
    guestBtn: $('guest-btn'), guestInfo: $('guest-info'), googleWrap: $('google-wrap'), googleBtn: $('google-btn'), githubBtn: $('github-btn'),

    app: $('app'), sidebar: $('sidebar'), overlay: $('sidebar-overlay'),
    openSidebar: $('open-sidebar-btn'), collapseSidebar: $('collapse-sidebar-btn'), expandSidebar: $('expand-sidebar-btn'),
    newChat: $('new-chat-btn'), headerNewChat: $('header-new-chat'),
    searchToggle: $('search-toggle-btn'), searchWrap: $('search-wrap'), searchInput: $('search-input'),
    historyGroups: $('history-groups'), historyEmpty: $('history-empty'),
    userBtn: $('user-btn'), userMenu: $('user-menu'), userAvatar: $('user-avatar'), userName: $('user-name'),
    logout: $('logout-btn'), clearAll: $('clear-all-btn'),

    modelBtn: $('model-btn'), modelName: $('model-name'), modelMenu: $('model-menu'), modelOptions: $('model-options'),

    chat: $('chat-container'), emptyState: $('empty-state'), messages: $('messages'), scrollBtn: $('scroll-bottom-btn'),
    composer: $('composer'), composerCenter: $('composer-center'), composerBottom: $('composer-bottom'),
    form: $('chat-form'), input: $('user-input'), send: $('send-btn'), stop: $('stop-btn'),
    attach: $('attach-btn'), fileInput: $('file-input'), attachPreview: $('attach-preview'), mic: $('mic-btn'), quickPrompts: document.querySelectorAll('.quick-prompt'),
    settings: $('settings-modal'), settingsBtn: $('settings-btn'), settingsClose: $('settings-close'), settingsSave: $('settings-save'),
    settingsReset: $('settings-reset'), persona: $('set-persona'), temperature: $('set-temp'), tempValue: $('set-temp-val'),
    provider: $('set-provider'), apiKey: $('set-key'), keyToggle: $('set-key-toggle'), autoSpeak: $('set-autospeak'), byokStatus: $('byok-status'),

    ctxMenu: $('ctx-menu'),
  };

  if (window.marked?.setOptions) window.marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  async function api(path, { method = 'GET', body, signal } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal });
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error('Oturum süresi doldu, lütfen tekrar giriş yapın.');
    }
    if (!res.ok) {
      let detail = `Hata (${res.status})`;
      try { const j = await res.json(); if (j.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail); } catch {}
      throw new Error(detail);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function handleUnauthorized() {
    state.token = null;
    state.user = null;
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
  }

  // ---------------------------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------------------------
  function showAuth() {
    state.guest = false;
    el.app.classList.add('hidden');
    el.app.classList.remove('flex');
    el.authView.classList.remove('hidden');
    el.authView.classList.add('flex');
    setAuthMode('login');
    setTimeout(() => el.authUser.focus(), 50);
  }

  function showApp() {
    el.authView.classList.add('hidden');
    el.authView.classList.remove('flex');
    el.app.classList.remove('hidden');
    el.app.classList.add('flex');
    const name = state.guest ? 'Misafir' : state.user.username;
    el.userName.textContent = name;
    el.userAvatar.textContent = name.slice(0, 1).toUpperCase();
    el.guestInfo.textContent = `(kalan ${Math.max(0, 5 - state.guestUsed)} mesaj)`;
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    const reg = mode === 'register';
    el.authTitle.textContent = reg ? 'Hesap oluştur' : 'Tekrar hoş geldin';
    el.authPass2Wrap.classList.toggle('hidden', !reg);
    el.authPass2.required = reg;
    el.authPass.autocomplete = reg ? 'new-password' : 'current-password';
    el.authSwitchText.textContent = reg ? 'Zaten hesabın var mı?' : 'Hesabın yok mu?';
    el.authSwitch.textContent = reg ? 'Giriş yap' : 'Kaydol';
    el.googleWrap.classList.toggle('hidden', reg || (!state.googleEnabled && !state.githubEnabled));
    el.authError.classList.add('hidden');
  }

  async function setupGoogleLogin() {
    try {
      const config = await api('/api/auth/google/config');
      state.googleEnabled = Boolean(config.enabled && config.client_id);
      const github = await api('/api/auth/github/config');
      state.githubEnabled = Boolean(github.enabled && github.client_id);
      el.githubBtn.classList.toggle('hidden', !state.githubEnabled);
      setAuthMode(state.authMode);
      if (!state.googleEnabled) return;
      const render = () => {
        if (!window.google?.accounts?.id) return false;
        window.google.accounts.id.initialize({ client_id: config.client_id, callback: window.handleGoogleCredential });
        window.google.accounts.id.renderButton(el.googleBtn, { theme: 'filled_black', size: 'large', width: 320, text: 'continue_with', shape: 'pill' });
        setAuthMode(state.authMode);
        return true;
      };
      if (!render()) {
        let attempts = 0;
        const timer = window.setInterval(() => { if (render() || ++attempts >= 20) window.clearInterval(timer); }, 500);
      }
    } catch {}
  }

  window.handleGoogleCredential = async ({ credential }) => {
    try {
      const data = await api('/api/auth/google', { method: 'POST', body: { credential } });
      state.token = data.token; state.user = data.user; state.guest = false;
      localStorage.setItem(TOKEN_KEY, data.token);
      await bootApp();
    } catch (err) { showAuthError(err.message); }
  };

  el.githubBtn.addEventListener('click', () => { window.location.href = `${API_BASE}/api/auth/github/start`; });

  el.authSwitch.addEventListener('click', () => setAuthMode(state.authMode === 'login' ? 'register' : 'login'));

  el.guestBtn.addEventListener('click', () => { state.token = null; state.user = null; state.guest = true; bootApp(); });

  el.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.authError.classList.add('hidden');
    const username = el.authUser.value.trim();
    const password = el.authPass.value;

    if (state.authMode === 'register' && password !== el.authPass2.value) {
      return showAuthError('Şifreler eşleşmiyor.');
    }
    el.authSubmit.disabled = true;
    el.authSubmit.textContent = 'Lütfen bekleyin...';
    try {
      const data = await api(`/api/auth/${state.authMode}`, { method: 'POST', body: { username, password } });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem(TOKEN_KEY, data.token);
      el.authPass.value = '';
      el.authPass2.value = '';
      await bootApp();
    } catch (err) {
      showAuthError(err.message);
    } finally {
      el.authSubmit.disabled = false;
      el.authSubmit.textContent = 'Devam et';
    }
  });

  function showAuthError(msg) {
    el.authError.textContent = msg;
    el.authError.classList.remove('hidden');
  }

  el.logout.addEventListener('click', async () => {
    closeUserMenu();
    if (state.guest) { showAuth(); return; }
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    state.conversations = [];
    state.currentId = null;
    state.messages = [];
    handleUnauthorized();
  });

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
  }
  function openSettings() {
    const settings = readSettings();
    el.persona.value = settings.persona || '';
    el.temperature.value = settings.temperature ?? '';
    el.tempValue.textContent = settings.temperature == null ? 'Varsayılan' : settings.temperature;
    el.provider.value = settings.provider || '';
    el.apiKey.value = settings.key || '';
    el.autoSpeak.checked = Boolean(settings.autoSpeak);
    el.settings.classList.remove('hidden'); el.settings.classList.add('flex');
  }
  function closeSettings() { el.settings.classList.add('hidden'); el.settings.classList.remove('flex'); }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ persona: el.persona.value.trim(), temperature: el.temperature.value ? Number(el.temperature.value) : null, provider: el.provider.value, key: el.apiKey.value, autoSpeak: el.autoSpeak.checked }));
    closeSettings();
  }
  el.settingsBtn.addEventListener('click', () => { closeUserMenu(); openSettings(); });
  el.settingsClose.addEventListener('click', closeSettings);
  el.settingsSave.addEventListener('click', saveSettings);
  el.settingsReset.addEventListener('click', () => { localStorage.removeItem(SETTINGS_KEY); openSettings(); });
  el.temperature.addEventListener('input', () => { el.tempValue.textContent = el.temperature.value; });
  el.keyToggle.addEventListener('click', () => { el.apiKey.type = el.apiKey.type === 'password' ? 'text' : 'password'; });

  // ---------------------------------------------------------------------------
  // MODELLER
  // ---------------------------------------------------------------------------
  async function loadModels() {
    try { state.models = await api('/api/models'); } catch { state.models = [{ key: 'fast', name: 'BurhanGPT Hızlı', description: '' }]; }
    if (!state.models.find((m) => m.key === state.model)) state.model = state.models[0].key;
    renderModelMenu();
  }

  function renderModelMenu() {
    const current = state.models.find((m) => m.key === state.model);
    el.modelName.textContent = current ? current.name : 'BurhanGPT';
    el.modelOptions.innerHTML = '';
    for (const m of state.models) {
      const active = m.key === state.model;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-gpt-hover2';
      btn.innerHTML = `
        <div class="w-5 h-5 mt-0.5 shrink-0 text-gpt-muted">
          ${m.key === 'think'
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm text-gpt-text">${escapeHtml(m.name)}</p>
          <p class="text-xs text-gpt-dim">${escapeHtml(m.description || '')}${m.providers?.length ? ` · ${escapeHtml(m.providers.join(' / '))}` : ''}</p>
        </div>
        <div class="w-5 h-5 shrink-0 text-gpt-text ${active ? '' : 'invisible'}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        </div>`;
      btn.addEventListener('click', () => {
        state.model = m.key;
        localStorage.setItem(MODEL_KEY, m.key);
        renderModelMenu();
        closeModelMenu();
      });
      el.modelOptions.appendChild(btn);
    }
  }

  const openModelMenu = () => el.modelMenu.classList.remove('hidden');
  const closeModelMenu = () => el.modelMenu.classList.add('hidden');
  el.modelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    el.modelMenu.classList.contains('hidden') ? openModelMenu() : closeModelMenu();
  });

  // ---------------------------------------------------------------------------
  // SIDEBAR
  // ---------------------------------------------------------------------------
  function openSidebarMobile() { el.sidebar.classList.remove('-translate-x-full'); el.overlay.classList.remove('hidden'); }
  function closeSidebarMobile() { el.sidebar.classList.add('-translate-x-full'); el.overlay.classList.add('hidden'); }
  function setCollapsed(collapsed) {
    el.sidebar.classList.toggle('collapsed', collapsed);
    el.expandSidebar.classList.toggle('hidden', !collapsed);
    el.expandSidebar.classList.toggle('md:flex', collapsed);
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  }
  el.openSidebar.addEventListener('click', openSidebarMobile);
  el.overlay.addEventListener('click', closeSidebarMobile);
  el.collapseSidebar.addEventListener('click', () => {
    if (window.innerWidth < 768) closeSidebarMobile();
    else setCollapsed(true);
  });
  el.expandSidebar.addEventListener('click', () => setCollapsed(false));

  el.searchToggle.addEventListener('click', () => {
    const hidden = el.searchWrap.classList.toggle('hidden');
    if (!hidden) el.searchInput.focus();
    else { el.searchInput.value = ''; renderHistory(); }
  });
  el.searchInput.addEventListener('input', renderHistory);

  const closeUserMenu = () => el.userMenu.classList.add('hidden');
  el.userBtn.addEventListener('click', (e) => { e.stopPropagation(); el.userMenu.classList.toggle('hidden'); });

  document.addEventListener('click', () => { closeUserMenu(); closeModelMenu(); closeCtxMenu(); });
  el.userMenu.addEventListener('click', (e) => e.stopPropagation());
  el.modelMenu.addEventListener('click', (e) => e.stopPropagation());
  el.ctxMenu.addEventListener('click', (e) => e.stopPropagation());

  // ---------------------------------------------------------------------------
  // SOHBET GEÇMİŞİ
  // ---------------------------------------------------------------------------
  async function loadConversations() {
    if (state.guest) { state.conversations = []; renderHistory(); return; }
    try { state.conversations = await api('/api/conversations'); } catch { state.conversations = []; }
    renderHistory();
  }

  function groupLabel(ts) {
    const d = new Date(ts * 1000);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 86400000;
    if (d.getTime() >= startToday) return 'Bugün';
    if (d.getTime() >= startToday - day) return 'Dün';
    if (d.getTime() >= startToday - 7 * day) return 'Önceki 7 Gün';
    if (d.getTime() >= startToday - 30 * day) return 'Önceki 30 Gün';
    return d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  }

  function renderHistory() {
    const q = el.searchInput.value.trim().toLowerCase();
    const list = state.conversations
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      .sort((a, b) => b.updated_at - a.updated_at);

    el.historyGroups.innerHTML = '';
    el.historyEmpty.classList.toggle('hidden', list.length > 0);

    let lastLabel = null;
    let ul = null;
    for (const conv of list) {
      const label = groupLabel(conv.updated_at);
      if (label !== lastLabel) {
        lastLabel = label;
        const h = document.createElement('p');
        h.className = 'px-3 pt-4 pb-1.5 text-xs font-medium text-gpt-dim';
        h.textContent = label;
        el.historyGroups.appendChild(h);
        ul = document.createElement('ul');
        ul.className = 'space-y-0.5';
        el.historyGroups.appendChild(ul);
      }
      const active = conv.id === state.currentId;
      const li = document.createElement('li');
      li.className = `group relative flex items-center rounded-lg text-sm cursor-pointer ${active ? 'bg-gpt-hover' : 'hover:bg-gpt-hover'}`;
      li.innerHTML = `
        <span class="flex-1 truncate px-3 py-2 pr-9" title="${escapeHtml(conv.title)}">${escapeHtml(conv.title)}</span>
        <button class="conv-menu absolute right-1.5 w-7 h-7 rounded-md flex items-center justify-center text-gpt-muted hover:text-gpt-text ${active ? '' : 'opacity-0 group-hover:opacity-100'}" aria-label="Seçenekler">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
        </button>`;
      li.addEventListener('click', () => { if (!state.streaming) { openConversation(conv.id); closeSidebarMobile(); } });
      li.querySelector('.conv-menu').addEventListener('click', (e) => {
        e.stopPropagation();
        openCtxMenu(e.currentTarget, conv.id);
      });
      ul.appendChild(li);
    }
  }

  function openCtxMenu(anchor, convId) {
    closeUserMenu(); closeModelMenu();
    state.ctxTargetId = convId;
    const r = anchor.getBoundingClientRect();
    el.ctxMenu.classList.remove('hidden');
    const w = 192, h = el.ctxMenu.offsetHeight || 90;
    let left = r.right + 6, top = r.top;
    if (left + w > window.innerWidth - 8) left = r.left - w - 6;
    if (left < 8) left = 8;
    if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
    el.ctxMenu.style.left = `${left}px`;
    el.ctxMenu.style.top = `${top}px`;
  }
  function closeCtxMenu() { el.ctxMenu.classList.add('hidden'); state.ctxTargetId = null; }

  el.ctxMenu.querySelector('[data-action="rename"]').addEventListener('click', async () => {
    const id = state.ctxTargetId; closeCtxMenu();
    const conv = state.conversations.find((c) => c.id === id);
    if (!conv) return;
    const title = prompt('Yeni sohbet adı:', conv.title);
    if (!title || !title.trim()) return;
    try {
      await api(`/api/conversations/${id}`, { method: 'PATCH', body: { title: title.trim() } });
      conv.title = title.trim();
      renderHistory();
    } catch (err) { alert(err.message); }
  });

  async function exportConversation(format) {
    const id = state.ctxTargetId; closeCtxMenu();
    if (!id) return;
    const conv = await api(`/api/conversations/${id}`);
    if (format === 'print') {
      const popup = window.open('', '_blank');
      if (!popup) return;
      popup.document.write(`<title>${escapeHtml(conv.title)}</title><pre style="white-space:pre-wrap;font:16px sans-serif">${escapeHtml(conv.messages.map((m) => `${m.role === 'user' ? 'Sen' : 'BurhanGPT'}:\n${m.content}`).join('\n\n'))}</pre>`);
      popup.document.close(); popup.print(); return;
    }
    const body = format === 'json' ? JSON.stringify(conv, null, 2) : `# ${conv.title}\n\n${conv.messages.map((m) => `## ${m.role === 'user' ? 'Sen' : 'BurhanGPT'}\n\n${m.content}`).join('\n\n')}`;
    const blob = new Blob([body], { type: format === 'json' ? 'application/json' : 'text/markdown' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `burhangpt-${format}.${format === 'json' ? 'json' : 'md'}`; link.click(); URL.revokeObjectURL(link.href);
  }
  el.ctxMenu.querySelector('[data-action="export-md"]').addEventListener('click', () => exportConversation('md'));
  el.ctxMenu.querySelector('[data-action="export-json"]').addEventListener('click', () => exportConversation('json'));
  el.ctxMenu.querySelector('[data-action="print"]').addEventListener('click', () => exportConversation('print'));

  el.ctxMenu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    const id = state.ctxTargetId; closeCtxMenu();
    if (state.streaming) return;
    if (!confirm('Bu sohbet silinsin mi?')) return;
    try {
      await api(`/api/conversations/${id}`, { method: 'DELETE' });
      state.conversations = state.conversations.filter((c) => c.id !== id);
      if (state.currentId === id) newChat();
      renderHistory();
    } catch (err) { alert(err.message); }
  });

  el.clearAll.addEventListener('click', async () => {
    closeUserMenu();
    if (state.streaming || !state.conversations.length) return;
    if (!confirm('Tüm sohbetler kalıcı olarak silinsin mi?')) return;
    try {
      await api('/api/conversations', { method: 'DELETE' });
      state.conversations = [];
      newChat();
      renderHistory();
    } catch (err) { alert(err.message); }
  });

  // ---------------------------------------------------------------------------
  // SOHBET GÖRÜNÜMÜ
  // ---------------------------------------------------------------------------
  function placeComposer(center) {
    const target = center ? el.composerCenter : el.composerBottom;
    if (el.composer.parentElement !== target) target.appendChild(el.composer);
    el.composer.classList.toggle('pb-0', center);
  }

  function showEmpty() {
    el.messages.classList.add('hidden');
    el.messages.innerHTML = '';
    el.emptyState.classList.remove('hidden');
    el.emptyState.classList.add('flex');
    placeComposer(true);
    el.scrollBtn.classList.add('hidden');
  }

  function showMessagesView() {
    el.emptyState.classList.add('hidden');
    el.emptyState.classList.remove('flex');
    el.messages.classList.remove('hidden');
    placeComposer(false);
  }

  function newChat() {
    if (state.streaming) return;
    state.currentId = null;
    state.messages = [];
    showEmpty();
    renderHistory();
    closeSidebarMobile();
    el.input.focus();
  }
  el.newChat.addEventListener('click', newChat);
  el.headerNewChat.addEventListener('click', newChat);

  async function openConversation(id) {
    try {
      const data = await api(`/api/conversations/${id}`);
      state.currentId = id;
      state.messages = data.messages;
      if (data.model && state.models.find((m) => m.key === data.model)) {
        state.model = data.model;
        localStorage.setItem(MODEL_KEY, data.model);
        renderModelMenu();
      }
      renderMessages();
      renderHistory();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderMessages() {
    if (!state.messages.length) return showEmpty();
    showMessagesView();
    el.messages.innerHTML = '';
    state.messages.forEach((m, i) => {
      el.messages.appendChild(
        m.role === 'user' ? createUserRow(m.content) : createAssistantRow(m.content, i === state.messages.length - 1)
      );
    });
    state.autoScroll = true;
    scrollToBottom();
  }

  function createUserRow(content) {
    const row = document.createElement('div');
    row.className = 'w-full';
    row.innerHTML = `
      <div class="max-w-3xl mx-auto px-4 md:px-6 py-2.5 flex justify-end">
        <div class="user-bubble bg-gpt-input rounded-3xl px-5 py-2.5 max-w-[85%] md:max-w-[70%] text-[16px] leading-7"></div>
      </div>`;
    row.querySelector('.user-bubble').textContent = content;
    return row;
  }

  function createAssistantRow(content, isLast) {
    const row = document.createElement('div');
    row.className = 'w-full group';
    row.dataset.role = 'assistant';
    row.innerHTML = `
      <div class="max-w-3xl mx-auto px-4 md:px-6 py-2.5 flex gap-4">
        <div class="w-8 h-8 shrink-0 rounded-full border border-gpt-border flex items-center justify-center text-sm font-semibold text-gpt-text mt-0.5">B</div>
        <div class="flex-1 min-w-0">
          <div class="message-content prose prose-invert text-[16px] leading-7"></div>
          <div class="actions flex items-center gap-1 mt-2 text-gpt-muted opacity-0 group-hover:opacity-100 transition-opacity">
            <button class="act-copy w-7 h-7 rounded-md hover:bg-gpt-hover flex items-center justify-center" title="Kopyala">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
            <button class="act-regen w-7 h-7 rounded-md hover:bg-gpt-hover flex items-center justify-center ${isLast ? '' : 'hidden'}" title="Yeniden üret">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 3v6h-6"/></svg>
            </button>
          </div>
        </div>
      </div>`;
    const contentEl = row.querySelector('.message-content');
    renderMarkdown(contentEl, content);

    row.querySelector('.act-copy').addEventListener('click', async (e) => {
      const ok = await copyToClipboard(contentEl.dataset.raw || contentEl.textContent);
      flash(e.currentTarget, ok);
    });
    row.querySelector('.act-regen').addEventListener('click', () => regenerate());
    return row;
  }

  function flash(btn, ok) {
    btn.classList.add(ok ? 'text-green-400' : 'text-red-400');
    setTimeout(() => btn.classList.remove('text-green-400', 'text-red-400'), 1200);
  }

  // ---------------------------------------------------------------------------
  // MARKDOWN
  // ---------------------------------------------------------------------------
  function renderMarkdown(target, text) {
    target.dataset.raw = text || '';
    const markdownHtml = window.marked?.parse ? window.marked.parse(text || '') : escapeHtml(text || '').replace(/\n/g, '<br>');
    target.innerHTML = window.DOMPurify?.sanitize
      ? DOMPurify.sanitize(markdownHtml, { ADD_ATTR: ['target'] })
      : markdownHtml;

    target.querySelectorAll('pre > code').forEach((codeEl) => {
      const pre = codeEl.parentElement;
      const m = /language-([\w+#-]+)/.exec(codeEl.className);
      const lang = m ? m[1] : '';
      try {
        if (window.hljs) {
          codeEl.innerHTML = lang && hljs.getLanguage(lang)
            ? hljs.highlight(codeEl.textContent, { language: lang }).value
            : hljs.highlightAuto(codeEl.textContent).value;
        }
      } catch {}
      codeEl.classList.add('hljs');

      const wrap = document.createElement('div');
      wrap.className = 'code-block not-prose';
      const header = document.createElement('div');
      header.className = 'code-block-header';
      header.innerHTML = `
        <span>${escapeHtml(lang || 'kod')}</span>
        <button type="button" class="copy-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          <span>Kodu kopyala</span>
        </button>`;
      header.querySelector('.copy-btn').addEventListener('click', async (e) => {
        const label = e.currentTarget.querySelector('span');
        const ok = await copyToClipboard(codeEl.textContent);
        label.textContent = ok ? 'Kopyalandı!' : 'Hata';
        setTimeout(() => (label.textContent = 'Kodu kopyala'), 1800);
      });
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(header);
      wrap.appendChild(pre);
    });

    target.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    if (window.katex) {
      target.querySelectorAll('p, li').forEach((node) => {
        node.innerHTML = node.innerHTML.replace(/\\\((.+?)\\\)|\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g, (match, inline, display, dollar) => {
          try { return katex.renderToString(inline || display || dollar, { displayMode: Boolean(display), throwOnError: false }); } catch { return match; }
        });
      });
    }
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  // ---------------------------------------------------------------------------
  // KAYDIRMA
  // ---------------------------------------------------------------------------
  const isNearBottom = () => el.chat.scrollHeight - el.chat.scrollTop - el.chat.clientHeight < 80;
  function scrollToBottom(smooth = false) { el.chat.scrollTo({ top: el.chat.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }
  el.chat.addEventListener('scroll', () => {
    state.autoScroll = isNearBottom();
    el.scrollBtn.classList.toggle('hidden', state.autoScroll || !state.messages.length);
  });
  el.scrollBtn.addEventListener('click', () => { state.autoScroll = true; scrollToBottom(true); });

  // ---------------------------------------------------------------------------
  // COMPOSER
  // ---------------------------------------------------------------------------
  function autoResize() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 208) + 'px';
  }
  function updateSendState() { el.send.disabled = (!el.input.value.trim() && !state.attachments.length) || state.streaming; }
  el.input.addEventListener('input', () => { autoResize(); updateSendState(); });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!el.send.disabled) el.form.requestSubmit();
    }
  });

  function setStreaming(on) {
    state.streaming = on;
    el.send.classList.toggle('hidden', on);
    el.stop.classList.toggle('hidden', !on);
    el.stop.classList.toggle('flex', on);
    updateSendState();
  }
  el.stop.addEventListener('click', () => state.abort && state.abort.abort());

  el.attach.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', async () => {
    for (const file of [...el.fileInput.files]) {
      if (file.type.startsWith('image/')) {
        state.attachments.push({ type: 'image_url', image_url: { url: await readAsDataUrl(file) }, name: file.name });
      } else if (file.type === 'application/pdf' && window.pdfjsLib) {
        const buffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        let text = '';
        for (let pageNo = 1; pageNo <= Math.min(pdf.numPages, 20); pageNo += 1) {
          const page = await pdf.getPage(pageNo);
          const content = await page.getTextContent();
          text += content.items.map((item) => item.str).join(' ') + '\n';
        }
        state.attachments.push({ type: 'text', text: `[${file.name}]\n${text.slice(0, 30000)}`, name: file.name });
      } else if (file.type.startsWith('text/') || /\.(txt|md|csv|json|js|ts|py|java|c|cpp|html|css|xml|ya?ml|sql|sh|log)$/i.test(file.name)) {
        state.attachments.push({ type: 'text', text: `[${file.name}]\n${(await file.text()).slice(0, 30000)}`, name: file.name });
      } else {
        alert(`${file.name} desteklenmiyor.`);
      }
    }
    el.fileInput.value = ''; renderAttachmentPreview(); el.input.focus();
  });
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  }
  function renderAttachmentPreview() {
    el.attachPreview.innerHTML = '';
    el.attachPreview.classList.toggle('hidden', !state.attachments.length);
    state.attachments.forEach((attachment, index) => {
      const chip = document.createElement('span'); chip.className = 'chip';
      chip.innerHTML = `<span>${escapeHtml(attachment.name || 'Ek')}</span><button type="button" aria-label="Eki kaldır">×</button>`;
      chip.querySelector('button').addEventListener('click', () => { state.attachments.splice(index, 1); renderAttachmentPreview(); });
      el.attachPreview.appendChild(chip);
    });
  }
  el.mic.addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert('Bu tarayıcı sesle yazmayı desteklemiyor.');
    const recognition = new SpeechRecognition(); recognition.lang = 'tr-TR'; recognition.interimResults = false;
    el.mic.classList.add('mic-on');
    recognition.onresult = (event) => { el.input.value += `${el.input.value ? ' ' : ''}${event.results[0][0].transcript}`; autoResize(); updateSendState(); };
    recognition.onend = () => el.mic.classList.remove('mic-on'); recognition.start();
  });
  el.quickPrompts.forEach((button) => button.addEventListener('click', () => { el.input.value = button.dataset.prompt; autoResize(); updateSendState(); el.input.focus(); }));

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.input.value.trim();
    if (!text || state.streaming) return;
    sendMessage(text);
  });

  // ---------------------------------------------------------------------------
  // MESAJ GÖNDERME / YENİDEN ÜRETME / STREAM
  // ---------------------------------------------------------------------------
  async function sendMessage(text) {
    showMessagesView();
    el.messages.querySelectorAll('.act-regen').forEach((b) => b.classList.add('hidden'));

    state.messages.push({ role: 'user', content: text });
    el.messages.appendChild(createUserRow(text));
    el.input.value = '';
    autoResize();
    state.autoScroll = true;
    scrollToBottom();

    const settings = readSettings();
    const attachments = state.attachments.map(({ type, text: attachmentText, image_url: imageUrl }) => ({ type, text: attachmentText, image_url: imageUrl }));
    state.attachments = []; renderAttachmentPreview();
    await streamChat({ conversation_id: state.currentId, message: text, model: state.model, attachments,
      system_prompt: settings.persona || null, temperature: settings.temperature ?? null,
      byok_provider: settings.provider || null, byok_key: settings.key || null });
  }

  async function regenerate() {
    if (state.streaming || !state.currentId) return;
    const last = state.messages[state.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    state.messages.pop();
    const rows = el.messages.querySelectorAll('[data-role="assistant"]');
    if (rows.length) rows[rows.length - 1].remove();
    state.autoScroll = true;
    await streamChat({ conversation_id: state.currentId, message: '', model: state.model, regenerate: true });
  }

  async function streamChat(payload) {
    const row = createAssistantRow('', true);
    const contentEl = row.querySelector('.message-content');
    contentEl.classList.add('typing-cursor');
    el.messages.appendChild(row);
    scrollToBottom();

    setStreaming(true);
    state.abort = new AbortController();

    let fullText = '';
    let scheduled = false;
    const scheduleRender = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        renderMarkdown(contentEl, fullText);
        contentEl.classList.add('typing-cursor');
        if (state.autoScroll) scrollToBottom();
      });
    };

    try {
      const res = await fetch(`${API_BASE}${state.guest ? '/api/guest-chat' : '/api/chat'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
        body: JSON.stringify(payload),
        signal: state.abort.signal,
      });

      if (res.status === 401) { handleUnauthorized(); throw new Error('Oturum süresi doldu.'); }
      if (!res.ok || !res.body) {
        let detail = `Sunucu hatası (${res.status})`;
        try { const j = await res.json(); if (j.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail); } catch {}
        throw new Error(detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let done = false;

      while (!done) {
        const { value, done: rd } = await reader.read();
        if (rd) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop();

        for (const evt of events) {
          for (const line of evt.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') { done = true; break; }
            if (!data) continue;
            let parsed;
            try { parsed = JSON.parse(data); } catch { continue; }

            if (parsed.meta) {
              const meta = parsed.meta;
              if (!state.currentId) {
                state.currentId = meta.conversation_id;
                state.conversations.unshift({
                  id: meta.conversation_id, title: meta.title, model: meta.model,
                  created_at: Date.now() / 1000, updated_at: Date.now() / 1000,
                });
              } else {
                const c = state.conversations.find((x) => x.id === state.currentId);
                if (c) { c.updated_at = Date.now() / 1000; c.model = meta.model; }
              }
              renderHistory();
            } else if (parsed.error) {
              fullText += (fullText ? '\n\n' : '') + `⚠️ ${parsed.error}`;
              scheduleRender();
              done = true; break;
            } else if (parsed.content) {
              fullText += parsed.content;
              scheduleRender();
            }
          }
          if (done) break;
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        fullText += fullText ? '\n\n*[Yanıt durduruldu]*' : '*[Yanıt durduruldu]*';
      } else {
        fullText += (fullText ? '\n\n' : '') + `⚠️ **Hata:** ${escapeHtml(err.message || 'Sunucuya ulaşılamadı.')}`;
      }
    } finally {
      renderMarkdown(contentEl, fullText || '*Boş yanıt.*');
      contentEl.classList.remove('typing-cursor');
      if (state.autoScroll) scrollToBottom();
      state.messages.push({ role: 'assistant', content: fullText });
      if (state.guest && fullText && !fullText.startsWith('⚠️')) {
        state.guestUsed += 1;
        localStorage.setItem(GUEST_KEY, JSON.stringify({ count: state.guestUsed, resetAt: guestUsage.resetAt }));
        el.guestInfo.textContent = `(kalan ${Math.max(0, 5 - state.guestUsed)} mesaj)`;
      }
      const settings = readSettings();
      if (settings.autoSpeak && fullText && 'speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(fullText.replace(/[*_#`]/g, '')));
      state.abort = null;
      setStreaming(false);
      el.input.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // BAŞLATMA
  // ---------------------------------------------------------------------------
  async function bootApp() {
    showApp();
    setCollapsed(localStorage.getItem(SIDEBAR_KEY) === '1');
    await loadModels();
    await loadConversations();
    newChat();
    autoResize();
    updateSendState();
  }

  async function init() {
    window.addEventListener('resize', () => { if (window.innerWidth >= 768) el.overlay.classList.add('hidden'); });
    placeComposer(true);
    const authToken = new URLSearchParams(window.location.hash.slice(1)).get('auth_token');
    if (authToken) {
      state.token = authToken;
      localStorage.setItem(TOKEN_KEY, authToken);
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }
    setupGoogleLogin();

    if (!state.token) return showAuth();
    try {
      state.user = await api('/api/auth/me');
      await bootApp();
    } catch {
      showAuth();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();