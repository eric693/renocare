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
  try {
    await win.costBreakdown(pj.id, pj.name);
    const mask = win.document.querySelector('.modal-mask');
    const tables = mask ? mask.querySelectorAll('table').length : 0;
    ok('成本結構', !!mask && tables >= 3 && !!mask.querySelector('svg'), `表格 ${tables} 張`);
    mask && mask.remove();
  } catch (e) { ok('成本結構', false, e.message); }

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
