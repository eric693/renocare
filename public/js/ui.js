// UI 共用元件：跳出視窗、提示、表格、表單欄位
const UI = {
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  toast(msg, isError) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show' + (isError ? ' error' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, isError ? 3600 : 2200);
  },
  err(e) { UI.toast(e && e.message ? e.message : String(e), true); },

  // 開啟 Modal；onSubmit 回傳 false 可阻止關閉
  modal({ title, body, wide, submitText = '儲存', onSubmit, onOpen, onClose, hideFooter }) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal${wide ? ' wide' : ''}">
        <div class="modal-head"><h3>${UI.esc(title)}</h3><button class="close" type="button">&times;</button></div>
        <div class="modal-body"></div>
        ${hideFooter ? '' : `<div class="modal-foot">
          <button class="btn secondary" data-act="cancel" type="button">取消</button>
          <button class="btn" data-act="ok" type="button">${UI.esc(submitText)}</button>
        </div>`}
      </div>`;
    const bodyEl = mask.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    // onClose 一定要有：呼叫端若用 Promise 等待結果，使用者按取消時才不會永遠卡住
    let closed = false;
    const close = () => { if (closed) return; closed = true; mask.remove(); if (onClose) onClose(); };
    mask.querySelector('.close').onclick = close;
    mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
    if (!hideFooter) {
      mask.querySelector('[data-act="cancel"]').onclick = close;
      mask.querySelector('[data-act="ok"]').onclick = async () => {
        const btn = mask.querySelector('[data-act="ok"]');
        btn.disabled = true;
        try {
          const r = onSubmit ? await onSubmit(bodyEl, close) : true;
          if (r !== false) close();
        } catch (e) { UI.err(e); }
        btn.disabled = false;
      };
    }
    document.body.appendChild(mask);
    UI.bindSearchSelects(bodyEl);        // 可搜尋下拉一律自動生效
    UI.bindCheckLists(bodyEl);           // 複選群組同理，呼叫端不必自己記得綁
    if (onOpen) onOpen(bodyEl, close);
    return { close, body: bodyEl };
  },

  confirm(msg) {
    return new Promise(resolve => {
      const m = UI.modal({
        title: '確認操作', hideFooter: true,
        body: `<p style="font-size:15px">${UI.esc(msg)}</p>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
            <button class="btn secondary" data-c="no" type="button">取消</button>
            <button class="btn" data-c="yes" type="button">確定</button>
          </div>`
      });
      m.body.querySelector('[data-c=no]').onclick = () => { m.close(); resolve(false); };
      m.body.querySelector('[data-c=yes]').onclick = () => { m.close(); resolve(true); };
    });
  },

  // ---- 表單欄位產生器 ----
  input(name, label, opts = {}) {
    const { type = 'text', value = '', placeholder = '', required = false, full = false, step } = opts;
    return `<div class="form-row${full ? ' full' : ''}">
      <label>${UI.esc(label)}${required ? ' *' : ''}</label>
      <input name="${name}" type="${type}" value="${UI.esc(value)}" placeholder="${UI.esc(placeholder)}"${step ? ` step="${step}"` : ''}>
    </div>`;
  },
  // 選項一多就自動升級成「可搜尋下拉」。品牌、商品、廠商動輒幾十上百筆，
  // 原生 select 只能一直捲，打字又只能比對開頭第一個字。
  // 門檻設 8：再少就直接看得完，加搜尋框反而礙事。
  SEARCHABLE_MIN: 8,

  select(name, label, options, opts = {}) {
    const { value = '', full = false } = opts;
    if (options.length >= UI.SEARCHABLE_MIN && !opts.plain) {
      return UI.searchSelect(name, label, options, { ...opts, full });
    }
    const inner = options.map(o => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return `<option value="${UI.esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${UI.esc(t)}</option>`;
    }).join('');
    return `<div class="form-row${full ? ' full' : ''}"><label>${UI.esc(label)}</label><select name="${name}">${inner}</select></div>`;
  },
  // 可搜尋的下拉：商品動輒上百筆，用原生 select 要一直捲。
  // 上面多一個關鍵字欄，輸入就即時篩選（SKU、品名、品牌都比對），
  // 篩到剩一項會自動選起來，直接按儲存就好。
  // 綁定由 UI.bindSearchSelects 統一處理，呼叫端不必自己接事件。
  searchSelect(name, label, options, opts = {}) {
    const { value = '', full = true, placeholder = '輸入關鍵字快速篩選' } = opts;
    const json = UI.esc(JSON.stringify(options.map(o => (Array.isArray(o) ? o : [o, o]))));
    const inner = options.map(o => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return `<option value="${UI.esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${UI.esc(t)}</option>`;
    }).join('');
    return `<div class="form-row${full ? ' full' : ''}" data-ss-wrap>
      <label>${UI.esc(label)}</label>
      <input type="search" class="ss-search" placeholder="${UI.esc(placeholder)}" data-ss-for="${name}" autocomplete="off">
      <select name="${name}" data-ss-options="${json}">${inner}</select>
      <div class="muted ss-count"></div>
    </div>`;
  },

  // 幫容器裡所有 searchSelect 接上篩選行為（UI.modal 開啟時自動呼叫）
  bindSearchSelects(root) {
    root.querySelectorAll('.ss-search').forEach(input => {
      const sel = root.querySelector(`select[name="${input.dataset.ssFor}"]`);
      if (!sel || sel.dataset.ssBound) return;
      sel.dataset.ssBound = '1';
      let all = [];
      try { all = JSON.parse(sel.dataset.ssOptions || '[]'); } catch { all = []; }
      const countEl = input.parentElement.querySelector('.ss-count');

      const render = () => {
        const q = input.value.trim().toLowerCase();
        const keep = sel.value;
        const hits = q ? all.filter(([v, t]) => String(t).toLowerCase().includes(q) || String(v) === q) : all;
        sel.innerHTML = hits.map(([v, t]) =>
          `<option value="${UI.esc(v)}">${UI.esc(t)}</option>`).join('');
        // 原本選的還在就保留，否則篩到剩一項時自動選它
        if (hits.some(([v]) => String(v) === String(keep))) sel.value = keep;
        else if (hits.length === 1) sel.value = String(hits[0][0]);
        // 只有「選到的東西真的變了」才發 change：
        // 否則篩選列每打一個字就會重新查一次清單，畫面一直閃
        if (sel.value !== keep) sel.dispatchEvent(new Event('change', { bubbles: true }));
        if (countEl) {
          countEl.textContent = !q ? ''
            : hits.length ? `符合 ${hits.length} 項` : '找不到符合的商品，可留空改用手動輸入';
        }
      };
      input.addEventListener('input', e => { e.stopPropagation(); render(); });
      input.addEventListener('change', e => e.stopPropagation());
      // 在搜尋框按 Enter 不要送出整張表單，只是收合篩選
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sel.focus(); } });
    });
  },

  inputList(name, label, options, opts = {}) {
    const { value = '', placeholder = '', full = false } = opts;
    const listId = `dl-${name}-${Math.random().toString(36).slice(2, 7)}`;
    return `<div class="form-row${full ? ' full' : ''}">
      <label>${UI.esc(label)}</label>
      <input name="${name}" list="${listId}" value="${UI.esc(value)}" placeholder="${UI.esc(placeholder)}">
      <datalist id="${listId}">${options.map(o => `<option value="${UI.esc(o)}"></option>`).join('')}</datalist>
    </div>`;
  },
  textarea(name, label, opts = {}) {
    const { value = '', full = true, placeholder = '', rows } = opts;
    return `<div class="form-row${full ? ' full' : ''}"><label>${UI.esc(label)}</label>
      <textarea name="${name}"${rows ? ` rows="${rows}"` : ''} placeholder="${UI.esc(placeholder)}">${UI.esc(value)}</textarea></div>`;
  },
  // 可複選的勾選群組。值以逗號串起來存成一個字串（例如 "Facebook,Instagram"）——
  // 這樣既有的單選欄位不必改資料表就能升級成複選，舊資料（只有一個值）本來就是合法的字串。
  // formData 會讀 hidden input，所以呼叫端跟其他欄位一樣用 UI.formData 就拿得到。
  checkList(name, label, options, opts = {}) {
    const { value = '', full = true, hint = '' } = opts;
    const picked = UI.splitList(value);
    const items = options.map(o => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return `<label class="chk"><input type="checkbox" data-cl="${name}" value="${UI.esc(v)}"${
        picked.includes(String(v)) ? ' checked' : ''}> ${UI.esc(t)}</label>`;
    }).join('');
    return `<div class="form-row${full ? ' full' : ''}">
      <label>${UI.esc(label)}</label>
      <div class="chk-list" data-cl-wrap="${name}">${items}</div>
      <input type="hidden" name="${name}" value="${UI.esc(picked.join(','))}">
      ${hint ? `<div class="muted">${UI.esc(hint)}</div>` : ''}
    </div>`;
  },
  // 勾選群組要在插進畫面後綁一次，勾選才會同步到 hidden input
  bindCheckLists(root) {
    root.querySelectorAll('[data-cl-wrap]').forEach(wrap => {
      const name = wrap.dataset.clWrap;
      const hidden = wrap.parentElement.querySelector(`input[type=hidden][name="${name}"]`);
      if (!hidden) return;
      wrap.querySelectorAll(`[data-cl="${name}"]`).forEach(cb => cb.addEventListener('change', () => {
        hidden.value = [...wrap.querySelectorAll(`[data-cl="${name}"]`)]
          .filter(x => x.checked).map(x => x.value).join(',');
      }));
    });
  },
  // 逗號分隔的多選值 → 陣列（空字串回空陣列，不要回 ['']）
  splitList(v) {
    return String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  },

  checkbox(name, label, checked, opts = {}) {
    return `<div class="form-row${opts.full ? ' full' : ''}"><label>${UI.esc(label)}</label>
      <label class="chk"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}> ${UI.esc(opts.text || '是')}</label></div>`;
  },
  formData(el) {
    const out = {};
    el.querySelectorAll('input[name], select[name], textarea[name]').forEach(i => {
      out[i.name] = i.type === 'checkbox' ? (i.checked ? 1 : 0) : i.value.trim();
    });
    return out;
  },

  // rowsHtml 可以是 <tr> 陣列，也可以是已經串好的一整段 HTML 字串。
  // 兩種寫法在呼叫端都很自然，這裡一併吃下來，不要讓呼叫端記得該用哪一種。
  table(headers, rowsHtml, emptyMsg = '目前沒有資料') {
    const body = Array.isArray(rowsHtml) ? rowsHtml.join('') : String(rowsHtml || '');
    if (!body.trim()) return `<div class="empty">${UI.esc(emptyMsg)}</div>`;
    return `<div class="table-wrap"><table class="list">
      <thead><tr>${headers.map(h => `<th>${UI.esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table></div>`;
  },

  tag(text, cls = '') { return `<span class="tag ${cls}">${UI.esc(text)}</span>`; },

  // 庫存流水表：商品詳情與全站庫存流水頁共用同一個版面，
  // 兩邊看到的欄位一致，交接時不用解釋「這頁跟那頁哪裡不一樣」
  stockMoveTable(rows, { withProduct = false } = {}) {
    const headers = ['時間'].concat(withProduct ? ['商品'] : [])
      .concat(['增減', '異動前', '異動後', '原因', '來源', '操作人', '同步', '備註']);
    return UI.table(headers, rows.map(m => `<tr>
      <td class="nowrap">${UI.esc(m.created_at)}</td>
      ${withProduct ? `<td>${UI.esc(m.product_name || '')}${m.sku ? `<div class="muted">${UI.esc(m.sku)}</div>` : ''}</td>` : ''}
      <td class="${m.qty_delta < 0 ? 'danger' : 'ok'}"><strong>${m.qty_delta > 0 ? '+' : ''}${m.qty_delta}</strong></td>
      <td class="muted">${m.before_qty}</td>
      <td>${m.after_qty}</td>
      <td>${UI.esc(m.reason || '—')}</td>
      <td>${UI.esc(m.source_label || '—')}${m.ref_no ? `<div class="muted">${UI.esc(m.ref_no)}</div>` : ''}</td>
      <td>${UI.esc(m.user_name || '—')}</td>
      <td>${m.sync_status === 'ok' ? UI.tag('成功', 'ok')
        : m.sync_status === 'error' ? UI.tag('失敗', 'danger') : '<span class="muted">—</span>'}
        ${m.sync_message ? `<div class="muted">${UI.esc(m.sync_message)}</div>` : ''}</td>
      <td class="muted">${UI.esc(m.note || '')}</td>
    </tr>`), '尚無庫存異動紀錄');
  },

  // 外部連結按鈕（品牌官網／IG／商品頁）
  link(url, text) {
    if (!url) return '<span class="muted">—</span>';
    return `<a class="btn tiny secondary" href="${UI.esc(url)}" target="_blank" rel="noopener">${UI.esc(text)}</a>`;
  },

  today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  thisMonth() { return UI.today().slice(0, 7); },
  // 金額一律台幣整數。工程業的數字沒有小數，也沒有外幣，
  // 保留 fmtTWD 這個名字是為了讓「這裡一定是台幣」在程式裡看得出來。
  fmtMoney(n) { return 'NT$ ' + Math.round(Number(n) || 0).toLocaleString('zh-TW'); },
  fmtTWD(n) { return UI.fmtMoney(n); },
  // 大數字的縮寫（卡片、圖表軸用）：一百二十三萬 → 123.4萬
  fmtShort(n) {
    const v = Math.abs(Number(n) || 0);
    if (v >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '億';
    if (v >= 1e4) return (n / 1e4).toFixed(v >= 1e6 ? 0 : 1).replace(/\.0$/, '') + '萬';
    return Math.round(Number(n) || 0).toLocaleString('zh-TW');
  },
  fmtNum(n) { return Number(n || 0).toLocaleString('zh-TW'); },
  fmtPct(n) { return (n === null || n === undefined || n === '') ? '—' : Number(n) + '%'; },
  fmtDelta(n) {
    const v = Number(n || 0);
    return (v > 0 ? '+' : '') + v.toLocaleString('zh-TW');
  },
  // 日期是空字串時不要印出空白欄位，看不出是「沒填」還是「壞掉」
  date(d) { return d ? UI.esc(d) : '<span class="muted">—</span>'; },
  moneyClass(n) { return Number(n) < 0 ? 'danger' : ''; },

  // ---- 匯出 CSV ----
  // 對帳、報稅、給會計都要 Excel。資料已經在前端了，所以直接在瀏覽器產檔：
  // 不必為每張報表再寫一支後端匯出，而且權限天然跟畫面一致 —— 看得到才匯得出。
  csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    const s = String(v).replace(/\r?\n/g, ' ').trim();
    // 電話與統編開頭的 0 會被 Excel 當成數字吃掉，用公式形式保住它
    if (/^0\d+$/.test(s) || /^\d{10,}$/.test(s)) return `="${s}"`;
    return /[",;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  },
  csv(name, columns, rows) {
    if (!rows.length) { UI.toast('目前沒有資料可以匯出', true); return; }
    const lines = [columns.map(c => UI.csvCell(c[0])).join(',')];
    for (const r of rows) lines.push(columns.map(c => UI.csvCell(c[1](r))).join(','));
    // BOM 一定要加：沒有它，Excel 會把繁體中文開成亂碼
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${UI.today()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    UI.toast(`已匯出 ${rows.length} 筆`);
  },
  // 每張清單的按鈕長得一樣，避免各頁各寫一顆
  csvBtn(id, label = '匯出 CSV') {
    return `<button class="btn small secondary" data-csv="${UI.esc(id)}">${UI.esc(label)}</button>`;
  },
  bindCsv(root, id, name, columns, rows) {
    const b = root.querySelector(`[data-csv="${id}"]`);
    if (b) b.onclick = () => UI.csv(name, columns, typeof rows === 'function' ? rows() : rows);
  },

  // ---- 列印 ----
  // 報價單要給客戶、變更單要紙本回簽、請款單要附發票寄出去 —— 這些是實體文件，
  // 不是畫面。所以另開一個乾淨的視窗自己排版，不去動系統畫面的樣式。
  print(title, bodyHtml) {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { UI.toast('瀏覽器擋掉了列印視窗，請允許彈出視窗', true); return; }
    const company = (window.App && App.me && App.me.company_name) || '';
    w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
      <title>${UI.esc(title)}</title>
      <style>
        @page { size: A4; margin: 14mm; }
        * { box-sizing: border-box; }
        body { font: 13px/1.7 "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif; color: #111; margin: 0; }
        h1 { font-size: 20px; margin: 0 0 2px; }
        h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #ccc; }
        .doc-head { display: flex; justify-content: space-between; align-items: flex-end;
          border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
        .doc-head .co { font-size: 15px; font-weight: 700; }
        .muted { color: #666; }
        table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; }
        th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; vertical-align: top; }
        th { background: #f2f2f2; font-weight: 600; }
        td.num, th.num { text-align: right; white-space: nowrap; }
        .kv { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 24px; margin-bottom: 8px; }
        .kv div { border-bottom: 1px dotted #ddd; padding: 3px 0; }
        .kv b { display: inline-block; min-width: 6em; color: #555; font-weight: 500; }
        .total { text-align: right; font-size: 15px; font-weight: 700; margin-top: 6px; }
        .note { white-space: pre-wrap; }
        /* 簽名欄一定要留在紙上，線上簽認的案子也常常要附一份紙本歸檔 */
        .sign { margin-top: 34px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
        .sign div { border-top: 1px solid #111; padding-top: 6px; }
        .foot { margin-top: 26px; font-size: 11px; color: #888; }
        @media print { .noprint { display: none; } }
      </style></head><body>
      <div class="doc-head"><div><div class="co">${UI.esc(company)}</div>
        <h1>${UI.esc(title)}</h1></div>
        <div class="muted">列印日期 ${UI.esc(UI.today())}</div></div>
      ${bodyHtml}
      <div class="foot">本文件由 ${UI.esc(company)} 營運系統產生。</div>
      <div class="noprint" style="margin-top:18px;text-align:center">
        <button onclick="window.print()" style="padding:8px 20px;font-size:14px">列印</button></div>
      </body></html>`);
    w.document.close();
    w.focus();
  },
  // 列印用表格：跟畫面上的 UI.table 分開，因為紙上不需要標籤、顏色與操作欄
  ptable(headers, rows) {
    return `<table><thead><tr>${headers.map(h =>
      `<th${String(h).startsWith('#') ? ' class="num"' : ''}>${UI.esc(String(h).replace(/^#/, ''))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(cells => `<tr>${cells.map((c, i) =>
        `<td${String(headers[i]).startsWith('#') ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
};

// 中文對照：狀態碼只在資料庫裡是英文，畫面上永遠是中文
const TW = {
  project_status: { lead: '洽談中', design: '設計中', contracted: '已簽約', construction: '施工中',
    acceptance: '驗收中', warranty: '保固中', closed: '已結案', lost: '未成交' },
  quote_status: { draft: '草稿', sent: '已送出', accepted: '已成交', rejected: '未成交', superseded: '已被新版取代' },
  quote_kind: { design: '設計監造', build: '工程' },
  tax_type: { included: '報價已含稅', plus: '報價未稅，另加 5%', none: '免稅' },
  change_status: { draft: '草稿', sent: '待業主簽認', signed: '已簽認', rejected: '業主否決', void: '作廢' },
  change_reason: { client: '業主要求', site: '現場條件', design: '設計調整', law: '法規要求' },
  change_kind: { add: '追加', deduct: '減帳' },
  ms_status: { pending: '未到節點', ready: '可請款', invoiced: '已請款', paid: '已收足', void: '取消' },
  ms_basis: { percent: '依合約比例', amount: '固定金額' },
  trigger_on: { start: '該工序開工時', end: '該工序完成時' },
  sub_status: { draft: '草稿', signed: '已發包', working: '施工中', done: '已完工', settled: '已結清' },
  val_status: { draft: '草稿', confirmed: '已確認待付', paid: '已付款' },
  sched_status: { pending: '未開工', working: '施工中', done: '已完成', hold: '暫停' },
  material_status: { planned: '待下單', ordered: '已下單', arrived: '已到貨', installed: '已安裝', cancelled: '取消' },
  defect_status: { open: '待改善', fixing: '改善中', fixed: '已完成待複驗', verified: '複驗通過', void: '免辦' },
  defect_source: { self: '自主檢查', client: '業主提出', acceptance: '驗收點交', warranty: '保固報修' },
  severity: { low: '低', normal: '一般', high: '高（影響交屋）' },
  permit_status: { todo: '待送件', applied: '審查中', approved: '已核准', rejected: '補正中', na: '不適用' },
  task_status: { todo: '待處理', doing: '進行中', done: '已完成', cancelled: '取消' },
  priority: { low: '低', normal: '一般', high: '高' },
  photo_phase: { before: '施工前', during: '施工中', after: '完工', defect: '缺失', hidden: '隱蔽工程' },
  vendor_kind: { sub: '工班', supplier: '材料商', both: '工班＋材料' },
  release_kind: { retention: '保留款', warranty: '保固保證金' }
};
const twOpts = obj => Object.entries(obj).map(([k, v]) => [k, v]);
const twText = (dict, v) => (dict && dict[v]) || v || '';
