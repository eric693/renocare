// App 骨架：登入、側欄導覽、頁面路由
const App = {
  me: null,
  pages: {},          // key -> {title, sub, module, help, render}
  meta: {},
  staff: [],
  projects: [],       // 案場下拉共用（幾乎每一頁都要選案子）
  vendors: [],

  page(key, def) { App.pages[key] = def; },
  pageQuery: new URLSearchParams(),

  async boot() {
    try {
      App.me = await GET('/me');
      await App.loadShared();
      App.renderLayout();
      App.go(location.hash.slice(1) || App.homePage());
    } catch {
      App.renderLogin();
    }
    window.addEventListener('hashchange', () => App.go(location.hash.slice(1) || App.homePage()));
  },

  onUnauthorized() { if (App.me) { App.me = null; App.renderLogin(); } },

  async loadShared() {
    [App.meta, App.staff] = await Promise.all([
      GET('/meta').catch(() => ({})),
      GET('/staff-options').catch(() => [])
    ]);
    await App.reloadProjects();
    App.vendors = await GET('/vendors?active=1').catch(() => []);
  },

  async reloadProjects() {
    App.projects = App.can('projects') ? await GET('/projects').catch(() => []) : [];
  },

  // ---- 共用下拉 ----
  projectOptions(withAll) {
    const live = App.projects.filter(p => !['lost', 'closed'].includes(p.status));
    const rest = App.projects.filter(p => ['lost', 'closed'].includes(p.status));
    const fmt = p => [p.id, `${p.code} ${p.name}${['lost', 'closed'].includes(p.status) ? '（已結案）' : ''}`];
    return (withAll ? [['', '全部案場']] : [['', '請選擇案場']]).concat(live.map(fmt)).concat(rest.map(fmt));
  },
  staffOptions(withAll) {
    return (withAll ? [['', '全部人員']] : [['', '未指派']]).concat(App.staff.map(s => [s.id, s.name]));
  },
  vendorOptions(withAll, trade) {
    const list = trade ? App.vendors.filter(v => v.trade === trade) : App.vendors;
    return (withAll ? [['', '全部廠商']] : [['', '未指定']])
      .concat(list.map(v => [v.id, `${v.name}${v.trade ? `（${v.trade}）` : ''}`]));
  },
  listOptions(key, fallback) {
    const list = (App.meta && App.meta[key] && App.meta[key].length) ? App.meta[key] : (fallback || []);
    return list.map(v => [v, v]);
  },
  projectName(id) {
    const p = App.projects.find(x => String(x.id) === String(id));
    return p ? p.name : '';
  },

  can(module) {
    return App.me && (App.me.role === 'admin' || App.me.modules.includes(module));
  },
  canEdit(module) {
    if (!module) return true;
    if (!App.me) return false;
    if (App.me.role === 'admin') return true;
    return App.me.modules.includes(module) && !(App.me.readonly || []).includes(module);
  },
  currentModule() {
    const key = (location.hash.slice(1) || '').split('?')[0];
    const def = App.pages[key];
    return def ? def.module : null;
  },

  readonlyBanner() {
    return `<div class="notice warn readonly-banner">
      🔒 你對這個模組只有<b>檢視權限</b>：可以看資料與匯出，但新增、修改、刪除都會被擋下。
      需要編輯請找管理員調整帳號權限。</div>`;
  },

  lockPage(root) {
    const SAFE = '[data-view], [data-f], #help-toggle, .ss-search';
    root.querySelectorAll('#page-body button').forEach(b => {
      if (b.matches(SAFE)) return;
      b.disabled = true;
      b.title = '你對這個模組只有檢視權限';
      b.classList.add('locked');
    });
  },

  async renderLogin() {
    const t = await GET('/public/ui-texts').catch(() => ({}));
    document.getElementById('app').innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <h1>${UI.esc(t.ui_login_title || t.company_name || '宅匠')}</h1>
          <div class="sub">${UI.esc(t.ui_login_sub || '室內設計／裝修工程營運管理系統')}</div>
          <div class="form-row"><label>帳號</label><input id="lg-user" autocomplete="username"></div>
          <div class="form-row"><label>密碼</label><input id="lg-pass" type="password" autocomplete="current-password"></div>
          <button class="btn" id="lg-btn">登入</button>
          <div class="login-err" id="lg-err"></div>
          ${t.ui_demo_hint ? `<div style="margin-top:14px;padding:12px;background:var(--primary-light);border-radius:8px;font-size:13px;line-height:1.8">${UI.esc(t.ui_demo_hint).replace(/\n/g, '<br>')}</div>` : ''}
          <div style="margin-top:12px;font-size:13px;text-align:center"><a href="/intro.html">系統功能介紹</a></div>
        </div>
      </div>`;
    const doLogin = async () => {
      const err = document.getElementById('lg-err');
      err.textContent = '';
      try {
        await POST('/login', {
          username: document.getElementById('lg-user').value.trim(),
          password: document.getElementById('lg-pass').value
        });
        location.reload();
      } catch (e) { err.textContent = e.message; }
    };
    document.getElementById('lg-btn').onclick = doLogin;
    document.getElementById('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  },

  navGroups: [
    { label: '每日作業', keys: ['dashboard', 'mytasks', 'projects', 'schedule', 'sitelog', 'tasks'] },
    { label: '接案', keys: ['customers', 'quotes', 'unitprices'] },
    { label: '合約與收款', keys: ['changes', 'billing', 'receivables'] },
    { label: '發包', keys: ['vendors', 'subcontracts', 'payables', 'materials'] },
    { label: '交屋', keys: ['defects', 'warranty'] },
    { label: '文件', keys: ['drawings', 'permits'] },
    { label: '經營', keys: ['profit'] },
    { label: '系統', keys: ['users', 'settings', 'audit'] }
  ],

  renderLayout() {
    const navHtml = App.navGroups.map(g => {
      const items = g.keys.filter(k => App.pages[k] && (!App.pages[k].module || App.can(App.pages[k].module)));
      if (!items.length) return '';
      return `<div class="nav-group">${g.label}</div>` +
        items.map(k => `<a href="#${k}" data-nav="${k}">${UI.esc(App.pages[k].title)}</a>`).join('');
    }).join('');
    document.getElementById('app').innerHTML = `
      <div class="topbar">
        <button class="menu-btn" id="menu-btn">選單</button>
        <strong>${UI.esc(App.me.company_name)}</strong>
      </div>
      <div class="backdrop" id="backdrop"></div>
      <div class="layout">
        <aside class="sidebar" id="sidebar">
          <div class="brand">${UI.esc(App.me.company_name)}<small>室內設計／裝修工程營運管理</small></div>
          <nav class="nav" id="nav">${navHtml}</nav>
          <div class="user-box">
            <div class="name">${UI.esc(App.me.name)}</div>
            <div>${UI.esc(App.me.title || (App.me.role === 'admin' ? '管理員' : '員工'))}</div>
            <button id="pw-btn" type="button">修改密碼</button>
            <button id="logout-btn" type="button">登出</button>
          </div>
        </aside>
        <main class="main" id="page"></main>
      </div>`;
    document.getElementById('logout-btn').onclick = async () => { await POST('/logout'); location.reload(); };
    document.getElementById('pw-btn').onclick = App.changePasswordDialog;
    const sidebar = document.getElementById('sidebar'), backdrop = document.getElementById('backdrop');
    document.getElementById('menu-btn').onclick = () => { sidebar.classList.add('open'); backdrop.classList.add('show'); };
    backdrop.onclick = () => { sidebar.classList.remove('open'); backdrop.classList.remove('show'); };
    document.getElementById('nav').addEventListener('click', () => { sidebar.classList.remove('open'); backdrop.classList.remove('show'); });
  },

  changePasswordDialog() {
    UI.modal({
      title: '修改密碼',
      body: `<div class="form-grid">
        ${UI.input('old_password', '舊密碼', { type: 'password', full: true })}
        ${UI.input('new_password', '新密碼（至少 6 碼）', { type: 'password', full: true })}
      </div>`,
      onSubmit: async el => { await PUT('/me/password', UI.formData(el)); UI.toast('密碼已更新'); }
    });
  },

  homePage() {
    if (App.can('dashboard')) return 'dashboard';
    for (const g of App.navGroups) {
      for (const k of g.keys) {
        const d = App.pages[k];
        if (d && (!d.module || App.can(d.module))) return k;
      }
    }
    return 'mytasks';
  },

  // 頁面 hash 可以帶參數（例如 #projects?id=3），路由只看問號前面的頁面代碼
  async go(rawKey) {
    const [key, query = ''] = String(rawKey).split('?');
    App.pageQuery = new URLSearchParams(query);
    const def = App.pages[key];
    if (!def || (def.module && !App.can(def.module))) {
      const home = App.homePage();
      if (home === key || !App.pages[home]) {
        document.getElementById('page').innerHTML =
          '<div class="empty">你的帳號目前沒有可用的模組，請聯絡管理員開通權限。</div>';
        return;
      }
      return App.go(home);
    }
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === key));
    if (location.hash.slice(1) !== rawKey) history.replaceState(null, '', '#' + rawKey);
    const el = document.getElementById('page');
    const readonly = !App.canEdit(def.module);
    el.innerHTML = `<div class="page-title">${UI.esc(def.title)}</div><div class="page-sub">${UI.esc(def.sub || '')}</div>`
      + App.helpHtml(key, def.help)
      + (readonly ? App.readonlyBanner() : '')
      + `<div id="page-body"><div class="empty">載入中...</div></div>`;
    App.bindHelp(el, key);
    try {
      await def.render(document.getElementById('page-body'));
      Charts.mount(el);
      if (readonly) App.lockPage(el);
    }
    // page-error 讓冒煙測試認得出「這頁其實炸了」，不必去猜錯誤訊息長什麼樣
    catch (e) { document.getElementById('page-body').innerHTML = `<div class="empty page-error">${UI.esc(e.message)}</div>`; }
  },

  helpKey(key) { return 'help_open_' + key; },
  helpOpen(key) {
    try { return localStorage.getItem(App.helpKey(key)) !== '0'; } catch { return true; }
  },
  helpHtml(key, help) {
    if (!help) return '';
    const li = arr => (arr || []).map(t => `<li>${UI.esc(t)}</li>`).join('');
    const open = App.helpOpen(key);
    const steps = help.steps && help.steps.length ? `<div class="help-h">操作步驟</div><ol>${li(help.steps)}</ol>` : '';
    const notes = help.notes && help.notes.length ? `<div class="help-h">注意事項</div><ul>${li(help.notes)}</ul>` : '';
    const terms = help.terms && help.terms.length
      ? `<div class="help-h">名詞說明</div><dl>` +
        help.terms.map(([t, d]) => `<dt>${UI.esc(t)}</dt><dd>${UI.esc(d)}</dd>`).join('') + `</dl>` : '';
    return `<section class="help-box${open ? ' open' : ''}" id="help-box">
      <button type="button" class="help-toggle" id="help-toggle">
        <span class="help-mark">?</span>操作說明<span class="help-arrow">${open ? '收合' : '展開'}</span>
      </button>
      <div class="help-body">
        ${help.intro ? `<p class="help-intro">${UI.esc(help.intro)}</p>` : ''}
        ${steps}${notes}${terms}
      </div>
    </section>`;
  },
  bindHelp(el, key) {
    const box = el.querySelector('#help-box');
    if (!box) return;
    el.querySelector('#help-toggle').onclick = () => {
      const open = box.classList.toggle('open');
      box.querySelector('.help-arrow').textContent = open ? '收合' : '展開';
      try { localStorage.setItem(App.helpKey(key), open ? '1' : '0'); } catch {}
    };
  },

  reload() { App.go(location.hash.slice(1) || App.homePage()); },

  // 篩選列：定義 [{name,label,type,options,value}]，變動即回呼
  filterBar(fields, onChange) {
    const html = fields.map(f => {
      if (f.type === 'select') {
        const opts = f.options.map(o => (Array.isArray(o) ? o : [o, o]));
        const searchable = opts.length >= UI.SEARCHABLE_MIN;
        const optionsHtml = opts.map(([v, t]) =>
          `<option value="${UI.esc(v)}"${String(v) === String(f.value ?? '') ? ' selected' : ''}>${UI.esc(t)}</option>`).join('');
        return `<label class="fl">${UI.esc(f.label)}
          ${searchable ? `<input type="search" class="ss-search" data-ss-for="${f.name}"
            placeholder="搜尋${UI.esc(f.label)}" autocomplete="off">` : ''}
          <select data-f="${f.name}"${searchable ? ` name="${f.name}" data-ss-options="${UI.esc(JSON.stringify(opts))}"` : ''}>
            ${optionsHtml}</select></label>`;
      }
      return `<label class="fl">${UI.esc(f.label)}
        <input data-f="${f.name}" type="${f.type || 'text'}" value="${UI.esc(f.value ?? '')}" placeholder="${UI.esc(f.placeholder || '')}"></label>`;
    }).join('');
    const wrap = document.createElement('div');
    wrap.className = 'filter-bar';
    wrap.innerHTML = html;
    UI.bindSearchSelects(wrap);
    wrap.addEventListener('change', () => {
      const out = {};
      wrap.querySelectorAll('[data-f]').forEach(i => { out[i.dataset.f] = i.value.trim(); });
      onChange(out);
    });
    wrap.addEventListener('keydown', e => { if (e.key === 'Enter') wrap.dispatchEvent(new Event('change')); });
    return wrap;
  },

  qs(obj) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) if (v !== '' && v !== undefined && v !== null) p.set(k, v);
    const s = p.toString();
    return s ? '?' + s : '';
  },

  // 案場選擇器：大部分頁面都是「先選案子，再看那個案子的東西」。
  // 記住上次選的（放 localStorage），不要每次進頁面都重選一次。
  lastProject(v) {
    try {
      if (v !== undefined) { localStorage.setItem('rc_project', v); return v; }
      return localStorage.getItem('rc_project') || '';
    } catch { return ''; }
  }
};
