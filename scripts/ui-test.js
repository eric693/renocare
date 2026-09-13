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
    // UI_USER／UI_PASS 可以換成權限較少的帳號跑一次，確認分頁與欄位隱藏後畫面不會炸
    body: JSON.stringify({ username: process.env.UI_USER || 'admin', password: process.env.UI_PASS || 'admin123' })
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
  const isAdmin = () => App.me && App.me.role === 'admin';
  // 用權限較少的帳號跑時，沒權限的項目明講跳過，不要算成失敗
  const skip = (name, why = '示範資料沒有可編輯的項目') => console.log(`  - ${name}（${why}，跳過）`);
  ok('側欄有導覽項目', win.document.querySelectorAll('[data-nav]').length > (isAdmin() ? 15 : 0),
    `只有 ${win.document.querySelectorAll('[data-nav]').length} 項`);

  const body = () => win.document.getElementById('page-body');
  const bad = () => {
    const b = body();
    if (!b) return '沒有 page-body';
    const t = b.textContent.trim();
    if (t === '載入中...') return '停在載入中';
    if (b.querySelector('.page-error')) return '頁面出錯：' + t.slice(0, 60);
    if (/^(找不到|系統發生錯誤|操作失敗|請先登入)/.test(t)) return '錯誤訊息：' + t.slice(0, 40);
    return '';
  };

  console.log('\n逐頁渲染');
  const keys = App.navGroups.flatMap(g => g.keys).filter(k => App.pages[k]);
  const noHelp = [];
  for (const key of keys) {
    errors.length = 0;
    try {
      await App.go(key);
      const b = bad();
      ok(`${key}（${App.pages[key].title}）`, !b && !errors.length, b || errors[0] || '');
      // 每一頁都要有「? 操作說明」，而且要說得出步驟 —— 新增頁面時最容易漏的就是這個
      const help = App.pages[key].help;
      if (!win.document.querySelector('#help-box') || !help || !(help.steps && help.steps.length)) {
        noHelp.push(`${key}${!help ? '（沒有說明）' : '（沒有操作步驟）'}`);
      }
    } catch (e) { ok(`${key}（${App.pages[key].title}）`, false, e.message); }
  }
  ok(`${keys.length} 頁都有「? 操作說明」與操作步驟`, noHelp.length === 0, noHelp.join('、'));

  console.log('\n案場詳情的各分頁');
  const projects = await (await win.fetch('/api/projects')).json();
  const pj = projects.find(p => p.status === 'construction') || projects[0];
  ok('找得到示範案場', !!pj);
  if (pj) {
    await App.go('projects?id=' + pj.id);
    const b0 = bad();
    ok('案場詳情', !b0, b0);
    const tabs = [...win.document.querySelectorAll('[data-tab]')];
    ok('詳情頁有分頁列', tabs.length >= (isAdmin() ? 8 : 1), `只有 ${tabs.length} 個`);
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
    ['新增發包單', () => win.subDialog(pj.id, null, () => {})],
    ['新增訂料', () => win.materialDialog(pj.id, null, [], () => {})],
    ['新增保固項目', () => win.warrantyDialog(pj.id, null, () => {})],
    ['新增申辦案件', () => win.permitDialog(pj.id, null, () => {})]
  ];
  for (const [name, fn] of dlgs) {
    try {
      fn();
      const mask = win.document.querySelector('.modal-mask');
      ok(name, !!mask && mask.querySelectorAll('input,select,textarea').length > 0, '表單沒有欄位');
      mask && mask.remove();
    } catch (e) { ok(name, false, e.message); }
  }

  // 唯讀的明細對話框沒有表單欄位，另外檢查：要撈得到資料並且畫得出圖表與三張分組表
  if (!App.can('profit')) skip('成本結構', '沒有專案損益權限');
  else try {
    await win.costBreakdown(pj.id, pj.name);
    const mask = win.document.querySelector('.modal-mask');
    const tables = mask ? mask.querySelectorAll('table').length : 0;
    ok('成本結構', !!mask && tables >= 3 && !!mask.querySelector('svg'), `表格 ${tables} 張`);
    mask && mask.remove();
  } catch (e) { ok('成本結構', false, e.message); }

  const tick = (ms = 400) => new Promise(r => setTimeout(r, ms));
  const closeModals = () => win.document.querySelectorAll('.modal-mask').forEach(m => m.remove());
  const topModal = () => { const ms = [...win.document.querySelectorAll('.modal-mask')]; return ms[ms.length - 1]; };

  // 這五頁曾經因為沒傳分頁代碼而整頁顯示錯誤訊息，舊的檢查比對不到那種訊息 —— 這裡直接要求畫出案場標頭
  console.log('\n選案場的頁面：內容、篩選與清除');
  for (const key of ['schedule', 'sitelog', 'subcontracts', 'billing', 'drawings']) {
    const t = App.pages[key].title;
    if (!App.can(App.pages[key].module)) { skip(t, '沒有這個模組的權限'); continue; }
    errors.length = 0;
    try {
      await App.go(`${key}?project_id=${pj.id}`);
      const b = bad();
      ok(`${t}：畫出案場內容`, !b && !!body().querySelector('.scope-head') && !errors.length, b || errors[0] || '沒有案場標頭');
      const fields = body().querySelectorAll('.filter-bar [data-f]').length;
      ok(`${t}：案場之外還有篩選欄位`, fields >= 3, `只有 ${fields} 個`);
      const q = body().querySelector('.filter-bar [data-f="q"]');
      if (!q) { ok(`${t}：有搜尋欄`, false); continue; }
      q.value = '不存在的關鍵字zz';
      q.closest('.filter-bar').dispatchEvent(new win.Event('change'));
      await tick();
      ok(`${t}：篩選後有提示且不出錯`, !!body().querySelector('#fl-clear') && !bad() && !errors.length,
        bad() || errors[0] || '沒有篩選提示');
      const rows = body().querySelectorAll('tbody tr, .photo-grid figure').length;
      ok(`${t}：不相符的資料被濾掉`, rows === 0, `還剩 ${rows} 列`);
      body().querySelector('#fl-clear').click();
      await tick();
      ok(`${t}：清除篩選`, !body().querySelector('#fl-clear') && body().querySelector('[data-f="q"]').value === '');
    } catch (e) { ok(t, false, e.message); }
  }

  if (!App.can('customers')) skip('客戶名單有來源篩選', '沒有客戶名單權限');
  else {
    await App.go('customers');
    ok('客戶名單有來源篩選', !!body().querySelector('[data-f="source"]'));
  }

  // 每個「編輯」按鈕都要打得開、帶得出欄位。示範資料沒有對應項目時明講跳過，不要默默算通過
  console.log('\n編輯對話框');
  const checkEdit = async (name, title, open, module) => {
    if (module && !App.can(module)) { skip(name, '沒有這個模組的權限'); return; }
    errors.length = 0;
    try {
      const btn = await open();
      if (!btn) { skip(name); return; }
      btn.click();
      await tick();
      const m = topModal();
      const h = m ? m.querySelector('h3').textContent : '';
      ok(name, h.includes(title) && m.querySelectorAll('input,select,textarea').length > 0 && !errors.length,
        errors[0] || h || '沒有對話框');
    } catch (e) { ok(name, false, e.message); }
    closeModals();
  };
  const details = [];
  for (const p of projects) details.push(await (await win.fetch(`/api/projects/${p.id}/detail`)).json());
  const withData = pred => details.find(pred);

  await checkEdit('編輯收款', '編輯收款', async () => {
    const d = withData(x => x.receipts.length);
    if (!d) return null;
    await App.go(`billing?project_id=${d.project.id}`);
    return body().querySelector('[data-rcedit]');
  }, 'billing');
  await checkEdit('編輯圖面', '編輯圖面', async () => {
    const d = withData(x => x.drawings.length);
    if (!d) return null;
    await App.go(`drawings?project_id=${d.project.id}`);
    return body().querySelector('[data-dwedit]');
  }, 'drawings');
  const subs = App.can('subcontracts') ? await (await win.fetch('/api/subcontracts')).json() : [];
  const openSub = async s => {
    await App.go(`subcontracts?project_id=${s.project_id}`);
    body().querySelector(`[data-sbopen="${s.id}"]`).click();
    await tick();
  };
  await checkEdit('編輯發包明細', '編輯發包明細', async () => {
    const s = subs.find(x => x.items.length);
    if (!s) return null;
    await openSub(s);
    return topModal().querySelector('[data-siedit]');
  }, 'subcontracts');
  await checkEdit('編輯估驗', '編輯估驗', async () => {
    const s = subs.find(x => x.valuations.length && x.valuations[x.valuations.length - 1].status !== 'paid');
    if (!s) return null;
    await openSub(s);
    return topModal().querySelector('[data-vaedit]');
  }, 'subcontracts');
  // 示範資料的變更單多半已簽認（不能改明細），所以臨時開一張草稿來測，測完刪掉
  const json = (url, method, data) => win.fetch(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined
  }).then(r => r.json());
  if (!App.can('changes')) skip('編輯變更明細', '沒有追加減帳權限');
  else {
    const tmpCo = await json('/api/changes', 'POST', { project_id: pj.id, title: '冒煙測試暫存變更單', reason: 'client' });
    await json(`/api/changes/${tmpCo.id}/items`, 'POST', { kind: 'add', name: '測試項目', qty: 1, unit_price: 100 });
    await checkEdit('編輯變更明細', '編輯變更明細', async () => {
      await win.changeDetail(tmpCo.id, () => {});
      await tick();
      return topModal().querySelector('[data-ciedit]');
    });
    await json(`/api/changes/${tmpCo.id}`, 'DELETE');
  }

  console.log('\n匯出與列印');
  // CSV 的轉義與 BOM 是「Excel 打開會不會變亂碼／欄位會不會跑掉」的唯一保障
  const csvCell = win.UI.csvCell;
  ok('CSV 逗號會加引號', csvCell('木作,油漆') === '"木作,油漆"', csvCell('木作,油漆'));
  ok('CSV 雙引號會加倍', csvCell('說「這"面"牆」') === '"說「這""面""牆」"', csvCell('說「這"面"牆」'));
  ok('CSV 換行壓成空白', csvCell('第一行\n第二行') === '第一行 第二行', csvCell('第一行\n第二行'));
  ok('CSV 保住電話開頭的 0', csvCell('0912345678') === '="0912345678"', csvCell('0912345678'));
  ok('CSV 數字不加工', csvCell(120000) === '120000');
  ok('CSV 空值是空字串', csvCell(null) === '' && csvCell(undefined) === '');
  let csvOut = null;
  win.URL.createObjectURL = b => { csvOut = b; return 'blob:test'; };
  win.URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = function () {};
  win.UI.csv('測試', [['名稱', r => r.name], ['金額', r => r.amount]],
    [{ name: '木作工程', amount: 120000 }, { name: '油漆, 批土', amount: 60000 }]);
  const csvText = csvOut ? await csvOut.text() : '';
  // Blob.text() 會依規範把 BOM 吃掉，所以要直接看位元組
  const csvBytes = csvOut ? new Uint8Array(await csvOut.arrayBuffer()) : new Uint8Array();
  ok('CSV 開頭有 BOM（Excel 才不會亂碼）',
    csvBytes[0] === 0xEF && csvBytes[1] === 0xBB && csvBytes[2] === 0xBF,
    [...csvBytes.slice(0, 3)].join(','));
  ok('CSV 有表頭與兩列資料', csvText.trim().split('\r\n').length === 3, JSON.stringify(csvText));
  ok('CSV 內容正確', csvText.includes('木作工程,120000') && csvText.includes('"油漆, 批土",60000'));

  // 列印是另開視窗寫 HTML，測的是「該出現的都出現、成本不會漏到紙上」
  let printed = '';
  win.open = () => ({
    document: { write(h) { printed += h; }, close() {} }, focus() {}
  });
  const quotes = await (await win.fetch('/api/quotes')).json();
  if (quotes.length) {
    await App.go('quotes?id=' + quotes[0].id);
    const pb = win.document.querySelector('#q-print');
    if (pb) {
      pb.click();
      ok('報價單印出標題與簽名欄', printed.includes('報價單') && printed.includes('業主簽章'));
      // 這張紙會交到客戶手上，成本欄漏印出去就是把底價送給對方
      ok('報價單紙上沒有成本與毛利欄',
        !printed.includes('成本單價') && !printed.includes('預估毛利') && !printed.includes('預估成本'));
      const q0 = await (await win.fetch('/api/quotes/' + quotes[0].id)).json();
      ok('報價單有印出每一項工項', q0.items.every(i => printed.includes(UI.esc(i.name))),
        `${q0.items.length} 項`);
    } else ok('報價單列印', false, '找不到列印按鈕');
  } else ok('報價單列印', true, '（沒有估價單，跳過）');

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
