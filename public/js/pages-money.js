// 應收帳款、應付與押款、專案損益（跨案）

App.page('receivables', {
  title: '應收帳款',
  sub: '錢卡在哪裡：該開單沒開、開了沒收、追加簽了沒請',
  module: 'billing',
  help: {
    intro: '分三段是因為要做的事不一樣：可請款未開單是自己卡住的錢，去開單；已請款未收是去催；已簽認追加未請是最常被整筆忘掉的一段。',
    steps: ['用上方的「只看」切到其中一段，合計會跟著篩選後的清單走。',
      '「可請款未開單」→ 點進案子去開單請款，開單之後才算客戶欠你。',
      '「已請款未收」與逾期 → 打電話催，帳齡那一欄就是你的說詞。',
      '「已簽追加未收」→ 這段不在請款節點裡，登錄收款時對應節點留空。'],
    notes: ['「逾期」只算已經開單請款、過了約定收款期限還沒收足的部分。沒開單的不算客戶欠。']
  },
  async render(el) {
    const state = { status: '', bucket: '', q: '' };
    const bar = App.filterBar([
      { name: 'status', label: '案場狀態', type: 'select', options: [['', '全部（不含未成交）']].concat(twOpts(TW.project_status)) },
      { name: 'bucket', label: '只看', type: 'select', options: [['', '全部'], ['ready', '可請款未開單'],
        ['invoiced', '已請款未收'], ['overdue', '已逾期'], ['change', '已簽追加未收']] },
      { name: 'q', label: '搜尋', placeholder: '案場／代號／業主／電話' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const box = document.createElement('div');
    el.appendChild(box);

    const load = async () => {
      const d = await GET('/receivables' + App.qs(state));
      const s = d.sum;
      box.innerHTML = `
        <div class="stat-grid">
          ${stat(UI.fmtMoney(s.ready), '可請款未開單', s.ready ? 'warn' : '', '', '工進到了，單還沒開')}
          ${stat(UI.fmtMoney(s.invoiced), '已請款未收', '', '', '含未逾期')}
          ${stat(UI.fmtMoney(s.overdue), '其中已逾期', s.overdue ? 'danger' : '')}
          ${stat(UI.fmtMoney(s.change_unbilled), '已簽追加未收', s.change_unbilled ? 'warn' : '')}
          ${stat(UI.fmtMoney(s.received), '累計已收', 'ok')}
          ${stat(UI.fmtMoney(s.contract_total), '合約總價')}
        </div>
        <div class="card">
          <div class="card-head"><h3>逐案明細</h3>${UI.csvBtn('ar')}</div>
          ${UI.table(['案場', '業主', '合約總價', '已收', '可請款', '已請未收', '逾期', '追加未收', '帳齡'],
        d.rows.map(r => `<tr class="clickable" onclick="location.hash='billing?project_id=${r.project_id}'">
            <td><strong>${UI.esc(r.name)}</strong><div class="muted">${UI.esc(r.code)}　${twText(TW.project_status, r.status)}</div></td>
            <td>${UI.esc(r.customer_name || '—')}<div class="muted">${UI.esc(r.customer_phone || '')}</div></td>
            <td class="num">${UI.fmtMoney(r.contract_total)}</td>
            <td class="num">${UI.fmtMoney(r.received)}</td>
            <td class="num ${r.ready ? 'warn' : ''}">${UI.fmtMoney(r.ready)}</td>
            <td class="num">${UI.fmtMoney(r.invoiced_open)}</td>
            <td class="num ${r.overdue ? 'danger' : ''}">${UI.fmtMoney(r.overdue)}</td>
            <td class="num ${r.change_unbilled ? 'warn' : ''}">${UI.fmtMoney(r.change_unbilled)}
              ${r.change_sent_count ? `<div class="muted danger">另有 ${r.change_sent_count} 張待簽</div>` : ''}</td>
            <td class="num ${r.age_days > 30 ? 'danger' : ''}">${r.age_days ? r.age_days + ' 天' : '—'}</td>
          </tr>`), '目前沒有應收')}
        </div>`;
      UI.bindCsv(box, 'ar', '應收帳款', [
        ['案場代號', r => r.code], ['案場', r => r.name], ['狀態', r => twText(TW.project_status, r.status)],
        ['業主', r => r.customer_name], ['業主電話', r => r.customer_phone], ['設計師', r => r.designer_name],
        ['合約總價', r => r.contract_total], ['已簽追加', r => r.change_signed], ['已收', r => r.received],
        ['可請款未開單', r => r.ready], ['已請款未收', r => r.invoiced_open], ['其中逾期', r => r.overdue],
        ['已簽追加未收', r => r.change_unbilled], ['待簽追加張數', r => r.change_sent_count],
        ['待簽追加金額', r => r.change_pending],
        ['最早逾期日', r => r.oldest_due], ['帳齡天數', r => r.age_days]
      ], d.rows);
    };
    await load();
  }
});

App.page('payables', {
  title: '應付與押款',
  sub: '估驗確認待付的錢，以及押在手上的保留款、保固金',
  module: 'subcontracts',
  help: {
    intro: '保留款與保固金是「還沒付」不是「不用付」。押著多久、押誰的，工班記得比誰都清楚，系統也要記得。',
    steps: ['「待付估驗單」是已經確認、還沒匯錢出去的 —— 匯完按「登錄付款」。',
      '要看整張發包單的話點該列的「發包單」，會帶到那個案子的發包分頁。',
      '「各工班押款」是目前押在手上的錢；要退的話到發包單明細按「退保留款」或「退保固金」。'],
    notes: ['工班完工後保留款沒退，系統會每天提醒 —— 這關係到下一次找不找得到人。']
  },
  async render(el) {
    const state = { vendor_id: '', project_id: '', q: '' };
    const bar = App.filterBar([
      { name: 'vendor_id', label: '工班', type: 'select', options: App.vendorOptions(true) },
      { name: 'project_id', label: '案場', type: 'select', options: App.projectOptions(true) },
      { name: 'q', label: '搜尋', placeholder: '工班／工種／發包單號／案場' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const box = document.createElement('div');
    el.appendChild(box);

    const load = async () => {
      const d = await GET('/payables' + App.qs(state));
      box.innerHTML = `
        <div class="stat-grid">
          ${stat(UI.fmtMoney(d.sum), '估驗已確認待付', d.sum ? 'warn' : '')}
          ${stat(UI.fmtMoney(d.held.reduce((a, h) => a + h.retention_held, 0)), '押著的保留款')}
          ${stat(UI.fmtMoney(d.held.reduce((a, h) => a + h.warranty_held, 0)), '押著的保固金')}
        </div>
        <div class="card">
          <div class="card-head"><h3>待付估驗單</h3>${UI.csvBtn('ap')}</div>
          ${UI.table(['估驗日', '案場', '工班', '工種', '本期估驗', '實付', ''], d.rows.map(r => `<tr>
            <td class="nowrap">${UI.date(r.date)}<div class="muted">${UI.esc(r.period)}</div></td>
            <td>${UI.esc(r.project_name)}<div class="muted">${UI.esc(r.project_code)}</div></td>
            <td>${UI.esc(r.vendor_name || '—')}<div class="muted">${UI.esc(r.vendor_phone || '')}</div></td>
            <td>${UI.esc(r.trade || '')}</td>
            <td class="num muted">${UI.fmtMoney(r.gross_amount)}</td>
            <td class="num"><strong>${UI.fmtMoney(r.net_amount)}</strong></td>
            <td class="nowrap"><button class="btn tiny" data-pay="${r.id}">登錄付款</button>
            <a class="btn tiny secondary" href="#subcontracts?project_id=${r.project_id}">發包單</a></td>
          </tr>`), '沒有待付的估驗單')}
        </div>
        <div class="card">
          <div class="card-head"><h3>各工班押款</h3>${UI.csvBtn('held')}</div>
          ${UI.table(['工班', '保留款', '保固金', '合計'], d.held.map(h => `<tr>
            <td>${UI.esc(h.vendor_name)}</td>
            <td class="num">${UI.fmtMoney(h.retention_held)}</td>
            <td class="num">${UI.fmtMoney(h.warranty_held)}</td>
            <td class="num"><strong>${UI.fmtMoney(h.retention_held + h.warranty_held)}</strong></td>
          </tr>`), '目前沒有押款')}
        </div>`;
      UI.bindCsv(box, 'ap', '待付估驗單', [
        ['估驗日', r => r.date], ['期別', r => r.period], ['發包單號', r => r.no],
        ['案場', r => r.project_name], ['案場代號', r => r.project_code],
        ['工班', r => r.vendor_name], ['工班電話', r => r.vendor_phone], ['工種', r => r.trade],
        ['本期估驗', r => r.gross_amount], ['實付', r => r.net_amount],
        ['狀態', r => twText(TW.val_status, r.status)]
      ], d.rows);
      UI.bindCsv(box, 'held', '各工班押款', [
        ['工班', r => r.vendor_name], ['保留款', r => r.retention_held],
        ['保固金', r => r.warranty_held], ['合計', r => r.retention_held + r.warranty_held]
      ], d.held);
      box.querySelectorAll('[data-pay]').forEach(b => b.onclick = async () => {
        await POST(`/valuations/${b.dataset.pay}/pay`, { paid_date: UI.today() });
        UI.toast('已登錄付款'); load();
      });
    };
    await load();
  }
});

App.page('profit', {
  title: '專案損益',
  sub: '不用等結案：合約＋追加 vs 發包＋材料＋雜支，隨時算得出來',
  module: 'profit',
  help: {
    intro: '「做完才知道賺不賺」是這個行業最普遍的病。這頁的每一欄現在就算得出來，不用等發票、不用等結案。',
    steps: ['先看「超出估價」那一欄，正數代表利潤正在被吃掉。',
      '點該列的「成本結構」往下看：錢是花在哪個工種、哪家廠商、哪個雜支科目。',
      '把結論帶回工項單價庫 —— 下次報價要調的就是那幾項。'],
    terms: [
      ['合約總價', '原合約金額 ＋ 已簽認的追加減帳。未簽認的不算。'],
      ['已發生成本', '已發包的工班金額（不是只有付掉的）＋ 建材訂料 ＋ 專案雜支。'],
      ['超出估價', '實際成本 − 成交那版估價單的預估成本。正數代表利潤正在被吃掉。'],
      ['每坪利潤', '毛利 ÷ 室內坪數。判斷案子該不該接，這個數字比總價有用。']
    ],
    notes: ['施工前期還沒發包的工種不在成本裡，所以毛利率會偏高；看「超出估價」那欄比較準。']
  },
  async render(el) {
    const state = { status: '', designer_id: '', q: '' };
    const bar = App.filterBar([
      { name: 'status', label: '狀態', type: 'select', options: [['', '全部（不含洽談／未成交）']].concat(twOpts(TW.project_status)) },
      { name: 'designer_id', label: '設計師', type: 'select', options: App.staffOptions(true) },
      { name: 'q', label: '搜尋', placeholder: '案場／代號／業主' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const box = document.createElement('div');
    el.appendChild(box);

    const load = async () => {
        const d = await GET('/profit' + App.qs(state));
        const s = d.sum;
        const chart = d.rows.length ? Charts.hbars({
          title: '各案毛利',
          data: d.rows.slice(0, 12).map(r => ({ label: r.name, value: r.gross_profit }))
        }) : '';
        box.innerHTML = `
          <div class="stat-grid">
            ${stat(UI.fmtMoney(s.contract_total), '合約總價合計', '', '', `含已簽追加 ${UI.fmtShort(s.change_signed)}`)}
            ${stat(UI.fmtMoney(s.cost_committed), '已發生成本')}
            ${stat(UI.fmtMoney(s.gross_profit), '毛利', s.gross_profit < 0 ? 'danger' : 'ok', '', `毛利率 ${s.margin}%`)}
            ${stat(UI.fmtDelta(s.cost_variance), '超出估價', s.cost_variance > 0 ? 'danger' : 'ok')}
            ${stat(UI.fmtMoney(s.received), '已收')}
            ${stat(UI.fmtMoney(s.receivable), '應收', s.receivable ? 'warn' : '')}
          </div>
          <div class="card">${chart}</div>
          <div class="card">
            <div class="card-head"><h3>逐案損益</h3>${UI.csvBtn('profit')}</div>
            ${UI.table(['案場', '狀態', '工進', '合約總價', '發包', '材料', '雜支', '成本合計', '毛利', '毛利率', '每坪利潤', '超出估價', ''],
          d.rows.map(r => `<tr class="clickable" onclick="location.hash='projects?id=${r.id}'">
              <td><strong>${UI.esc(r.name)}</strong><div class="muted">${UI.esc(r.code)}　${UI.esc(r.designer_name || '')}</div></td>
              <td>${UI.tag(twText(TW.project_status, r.status))}</td>
              <td class="num">${r.progress === null ? '—' : r.progress + '%'}</td>
              <td class="num">${UI.fmtMoney(r.contract_total)}</td>
              <td class="num muted">${UI.fmtMoney(r.sub_committed)}</td>
              <td class="num muted">${UI.fmtMoney(r.material_cost)}</td>
              <td class="num muted">${UI.fmtMoney(r.expense_cost)}</td>
              <td class="num">${UI.fmtMoney(r.cost_committed)}</td>
              <td class="num ${r.gross_profit < 0 ? 'danger' : ''}">${UI.fmtMoney(r.gross_profit)}</td>
              <td class="num ${r.margin < 15 ? 'warn' : ''}">${r.margin}%</td>
              <td class="num">${r.profit_per_ping ? UI.fmtMoney(r.profit_per_ping) : '—'}</td>
              <td class="num ${r.cost_variance > 0 ? 'danger' : ''}">${UI.fmtDelta(r.cost_variance)}</td>
              <td class="nowrap"><button class="btn tiny secondary" data-bd="${r.id}">成本結構</button></td>
            </tr>`), '沒有資料')}
          </div>`;
        Charts.mount(box);
        UI.bindCsv(box, 'profit', '專案損益', [
          ['案場代號', r => r.code], ['案場', r => r.name], ['設計師', r => r.designer_name],
          ['狀態', r => twText(TW.project_status, r.status)], ['工進%', r => r.progress === null ? '' : r.progress],
          ['合約總價', r => r.contract_total], ['已簽追加', r => r.change_signed],
          ['已發包', r => r.sub_committed], ['建材', r => r.material_cost], ['雜支', r => r.expense_cost],
          ['成本合計', r => r.cost_committed], ['當初估價成本', r => r.quoted_cost],
          ['超出估價', r => r.cost_variance], ['毛利', r => r.gross_profit], ['毛利率%', r => r.margin],
          ['每坪利潤', r => r.profit_per_ping], ['已收', r => r.received], ['應收', r => r.receivable]
        ], d.rows);
        // 列本身是連到案場詳情的，所以這顆按鈕要自己吃掉事件
        box.querySelectorAll('[data-bd]').forEach(b => b.onclick = async e => {
          e.stopPropagation();
          const row = d.rows.find(x => String(x.id) === b.dataset.bd);
          try { await costBreakdown(row.id, row.name); } catch (err) { UI.err(err); }
        });
    };
    await load();
  }
});

// ---- 成本結構下鑽 ----
// 損益表只回答「賺多少」，不回答「錢花到哪去」。超出估價的時候，
// 要處理的下一個問題一定是「是哪個工種超的」—— 這支對話框就是那一步。
// 後端 /profit/:id/breakdown 已經把三種成本各自分組好，這裡只負責呈現。
async function costBreakdown(projectId, projectName) {
  const d = await GET(`/profit/${projectId}/breakdown`);
  const m = d.money;
  const money = UI.fmtMoney;

  // 三大類先看比例，再往下看各類的明細；雜支常常是被忽略的那一塊
  const mix = Charts.donut({
    title: '成本組成',
    centerLabel: '已發生成本',
    data: [
      { label: '發包工班', value: m.sub_committed },
      { label: '建材訂料', value: m.material_cost },
      { label: '專案雜支', value: m.expense_cost }
    ],
    note: '發包金額以已發包（非草稿）為準，不是只算已付掉的。'
  });

  const share = v => m.cost_committed ? (v / m.cost_committed * 100).toFixed(1) + '%' : '—';
  const group = (title, rows, headLabel, emptyMsg, extra) => `
    <div class="card">
      <h3>${UI.esc(title)}</h3>
      ${UI.table([headLabel, ...(extra ? [extra] : []), '金額', '佔成本'],
    rows.map(r => `<tr>
          <td>${UI.esc(r.label)}</td>
          ${extra ? `<td class="num muted">${UI.esc(String(r.extra))}</td>` : ''}
          <td class="num">${money(r.value)}</td>
          <td class="num muted">${share(r.value)}</td>
        </tr>`), emptyMsg)}
    </div>`;

  const body = `
    <div class="stat-grid">
      ${stat(money(m.contract_total), '合約總價')}
      ${stat(money(m.cost_committed), '已發生成本')}
      ${stat(money(m.gross_profit), '毛利', m.gross_profit < 0 ? 'danger' : 'ok', '', `毛利率 ${m.margin}%`)}
      ${stat(UI.fmtDelta(m.cost_variance), '超出估價', m.cost_variance > 0 ? 'danger' : 'ok',
    '', `估 ${UI.fmtShort(m.quoted_cost)}`)}
    </div>
    <div class="card">${mix}</div>
    ${group('發包（依工種）', d.by_trade.map(r => ({ label: r.trade, value: r.amount, extra: r.n + ' 張' })),
      '工種', '還沒有發包', '發包單')}
    ${group('建材（依廠商）', d.materials.map(r => ({ label: r.vendor, value: r.amount })), '廠商', '還沒有訂料')}
    ${group('雜支（依科目）', d.expenses.map(r => ({ label: r.category || '未分類', value: r.amount })), '科目', '還沒有雜支')}`;

  const m2 = UI.modal({ title: `成本結構 — ${projectName}`, body, wide: true, hideFooter: true });
  Charts.mount(m2.body);
}
