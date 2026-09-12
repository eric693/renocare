// 前端冒煙測試：用 jsdom 把整個 SPA 跑起來，逐頁渲染一次。
//
// 為什麼需要這支：後端測試只保證 API 回的數字對，但前端是幾千行的樣板字串，
// 一個打錯的欄位名或忘了定義的函式，要等到有人點進那一頁才會炸。
// 這裡把每一頁（含案場詳情的九個分頁）都渲染一次，任何例外都算失敗。
//
// jsdom 借用同一台機器上其他專案的（本專案不為了測試多一個相依）。
const path = require('path');
module.paths.push('/root/longcare/node_modules');
const { JSDOM } = require('jsdom');
const fs = require('fs');

const PORT = process.env.PORT || 3490;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const problems = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '　' + extra : '')); problems.push(name + ' ' + extra); }
}

(async () => {
  // 先拿一份登入 cookie，jsdom 那邊的 fetch 直接帶著走
  const login = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const cookie = (login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get('set-cookie')])
    .filter(Boolean).map(c => c.split(';')[0]).join('; ');

  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: BASE + '/', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;

  const errors = [];
  win.addEventListener('error', e => errors.push(String(e.error || e.message)));
  win.fetch = (url, opts = {}) => fetch(BASE + url, {
    ...opts, headers: { ...(opts.headers || {}), Cookie: cookie }
  });
  win.navigator.serviceWorker = undefined;
  win.alert = () => {};

  // 一次全部串起來再 eval：瀏覽器裡多個 <script> 共用同一個全域語彙環境，
  // 但逐段 eval 不會 —— 串起來才等同於真實載入順序。最後把要驗的東西掛到 window 上。
  const srcs = [...win.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  const bundle = srcs.map(src => fs.readFileSync(path.join(__dirname, '..', 'public', src), 'utf8')).join('\n;\n')
    + '\n;window.App=App;window.UI=UI;window.TABS=TABS;window.TABBIND=TABBIND;'
    + 'window.projectDialog=projectDialog;window.customerDialog=customerDialog;window.taskDialog=taskDialog;'
    + 'window.unitDialog=unitDialog;window.vendorDialog=vendorDialog;window.defectDialog=defectDialog;'
    + 'window.changeDialog=changeDialog;window.subDialog=subDialog;';
  try { win.eval(bundle); }
  catch (e) { ok('載入前端程式', false, e.message); }
  ok('前端程式全部載入', fail === 0);

  const App = win.App, UI = win.UI;
  await App.boot();
  ok('登入後渲染主畫面', !!win.document.getElementById('nav'), '找不到側欄');
  ok('側欄有導覽項目', win.document.querySelectorAll('[data-nav]').length > 15,
    `只有 ${win.document.querySelectorAll('[data-nav]').length} 項`);

  const body = () => win.document.getElementById('page-body');
  const bad = () => {
    const b = body();
    if (!b) return '沒有 page-body';
    const t = b.textContent.trim();
    if (t === '載入中...') return '停在載入中';
    if (/^(找不到|系統發生錯誤|操作失敗|請先登入)/.test(t)) return '錯誤訊息：' + t.slice(0, 40);
    return '';
  };

  console.log('\n逐頁渲染');
  const keys = App.navGroups.flatMap(g => g.keys).filter(k => App.pages[k]);
  for (const key of keys) {
    errors.length = 0;
    try {
      await App.go(key);
      const b = bad();
      ok(`${key}（${App.pages[key].title}）`, !b && !errors.length, b || errors[0] || '');
    } catch (e) { ok(`${key}（${App.pages[key].title}）`, false, e.message); }
  }

  console.log('\n案場詳情的各分頁');
  const projects = await (await win.fetch('/api/projects')).json();
  const pj = projects.find(p => p.status === 'construction') || projects[0];
  ok('找得到示範案場', !!pj);
  if (pj) {
    await App.go('projects?id=' + pj.id);
    const b0 = bad();
    ok('案場詳情', !b0, b0);
    const tabs = [...win.document.querySelectorAll('[data-tab]')];
    ok('詳情頁有分頁列', tabs.length >= 8, `只有 ${tabs.length} 個`);
    for (const t of tabs) {
      errors.length = 0;
      try {
        t.click();
        const inner = win.document.getElementById('tab-body').textContent.trim();
        ok(`分頁：${t.textContent.trim()}`, inner.length > 0 && !errors.length, errors[0] || '內容空白');
      } catch (e) { ok(`分頁：${t.textContent.trim()}`, false, e.message); }
    }
  }

  console.log('\n對話框');
  const dlgs = [
    ['新增案場', () => win.projectDialog(null, () => {})],
    ['新增客戶', () => win.customerDialog(null, () => {})],
    ['新增工作', () => win.taskDialog(null, () => {})],
    ['新增工項', () => win.unitDialog(null, () => {})],
    ['新增廠商', () => win.vendorDialog(null, () => {})],
    ['新增缺失', () => win.defectDialog(pj.id, null, () => {})],
    ['新增變更單', () => win.changeDialog(pj.id, null, () => {})],
    ['新增發包單', () => win.subDialog(pj.id, null, () => {})]
  ];
  for (const [name, fn] of dlgs) {
    try {
      fn();
      const mask = win.document.querySelector('.modal-mask');
      ok(name, !!mask && mask.querySelectorAll('input,select,textarea').length > 0, '表單沒有欄位');
      mask && mask.remove();
    } catch (e) { ok(name, false, e.message); }
  }

  console.log('\n業主端');
  const tokenRow = projects.find(p => p.client_token) ||
    await (await win.fetch(`/api/projects/${pj.id}/client-link`, { method: 'POST' })).json();
  const token = tokenRow.client_token || tokenRow.token;
  const cHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.html'), 'utf8');
  const cdom = new JSDOM(cHtml, {
    url: `${BASE}/client.html#${token}`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      // 業主端不帶 cookie：它靠的就是連結本身，這裡刻意不給登入身分，
      // 順便驗證「沒有帳號也看得到」這件事真的成立。
      w.fetch = (url, opts) => fetch(BASE + url, opts);
      w.alert = () => {};
      w.HTMLDialogElement && (w.HTMLDialogElement.prototype.showModal = function () { this.open = true; });
    }
  });
  await new Promise(r => setTimeout(r, 800));
  const ctext = cdom.window.document.getElementById('app').textContent;
  ok('業主端載入到案子', /工程進度/.test(ctext), ctext.slice(0, 60));
  ok('業主端顯示工程款', /合約總金額/.test(ctext));
  ok('業主端不顯示成本字樣', !/發包|毛利|成本/.test(ctext));
  cdom.window.close();

  console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
  if (problems.length) console.log('問題：\n  ' + problems.join('\n  '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
