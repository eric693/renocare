// 應收帳款、應付與押款、專案損益（跨案）

App.page('receivables', {
  title: '應收帳款',
  sub: '錢卡在哪裡：該開單沒開、開了沒收、追加簽了沒請',
  module: 'billing',
  help: {
    intro: '分三段是因為要做的事不一樣：可請款未開單是自己卡住的錢，去開單；已請款未收是去催；已簽認追加未請是最常被整筆忘掉的一段。',
    notes: ['「逾期」只算已經開單請款、過了約定收款期限還沒收足的部分。沒開單的不算客戶欠。']
  },
  async render(el) {
    const d = await GET('/receivables');
    const s = d.sum;
    el.innerHTML = `
      <div class="stat-grid">
        ${stat(UI.fmtMoney(s.ready), '可請款未開單', s.ready ? 'warn' : '', '', '工進到了，單還沒開')}
        ${stat(UI.fmtMoney(s.invoiced), '已請款未收', '', '', '含未逾期')}
        ${stat(UI.fmtMoney(s.overdue), '其中已逾期', s.overdue ? 'danger' : '')}
        ${stat(UI.fmtMoney(s.change_unbilled), '已簽追加未收', s.change_unbilled ? 'warn' : '')}
        ${stat(UI.fmtMoney(s.received), '累計已收', 'ok')}
        ${stat(UI.fmtMoney(s.contract_total), '合約總價')}
      </div>
      <div class="card">
        <h3>逐案明細</h3>
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
  }
});

App.page('payables', {
  title: '應付與押款',
  sub: '估驗確認待付的錢，以及押在手上的保留款、保固金',
  module: 'subcontracts',
  help: {
    intro: '保留款與保固金是「還沒付」不是「不用付」。押著多久、押誰的，工班記得比誰都清楚，系統也要記得。',
    notes: ['工班完工後保留款沒退，系統會每天提醒 —— 這關係到下一次找不找得到人。']
  },
  async render(el) {
    const d = await GET('/payables');
    el.innerHTML = `
      <div class="stat-grid">
        ${stat(UI.fmtMoney(d.sum), '估驗已確認待付', d.sum ? 'warn' : '')}
        ${stat(UI.fmtMoney(d.held.reduce((a, h) => a + h.retention_held, 0)), '押著的保留款')}
        ${stat(UI.fmtMoney(d.held.reduce((a, h) => a + h.warranty_held, 0)), '押著的保固金')}
      </div>
      <div class="card">
        <h3>待付估驗單</h3>
        ${UI.table(['估驗日', '案場', '工班', '工種', '本期估驗', '實付', ''], d.rows.map(r => `<tr>
          <td class="nowrap">${UI.date(r.date)}<div class="muted">${UI.esc(r.period)}</div></td>
          <td>${UI.esc(r.project_name)}<div class="muted">${UI.esc(r.project_code)}</div></td>
          <td>${UI.esc(r.vendor_name || '—')}<div class="muted">${UI.esc(r.vendor_phone || '')}</div></td>
          <td>${UI.esc(r.trade || '')}</td>
          <td class="num muted">${UI.fmtMoney(r.gross_amount)}</td>
          <td class="num"><strong>${UI.fmtMoney(r.net_amount)}</strong></td>
          <td><button class="btn tiny" data-pay="${r.id}">登錄付款</button></td>
        </tr>`), '沒有待付的估驗單')}
      </div>
      <div class="card">
        <h3>各工班押款</h3>
        ${UI.table(['工班', '保留款', '保固金', '合計'], d.held.map(h => `<tr>
          <td>${UI.esc(h.vendor_name)}</td>
          <td class="num">${UI.fmtMoney(h.retention_held)}</td>
          <td class="num">${UI.fmtMoney(h.warranty_held)}</td>
          <td class="num"><strong>${UI.fmtMoney(h.retention_held + h.warranty_held)}</strong></td>
        </tr>`), '目前沒有押款')}
      </div>`;
    el.querySelectorAll('[data-pay]').forEach(b => b.onclick = async () => {
      await POST(`/valuations/${b.dataset.pay}/pay`, { paid_date: UI.today() });
      UI.toast('已登錄付款'); App.reload();
    });
  }
});

App.page('profit', {
  title: '專案損益',
  sub: '不用等結案：合約＋追加 vs 發包＋材料＋雜支，隨時算得出來',
  module: 'profit',
  help: {
    intro: '「做完才知道賺不賺」是這個行業最普遍的病。這頁的每一欄現在就算得出來，不用等發票、不用等結案。',
    terms: [
      ['合約總價', '原合約金額 ＋ 已簽認的追加減帳。未簽認的不算。'],
      ['已發生成本', '已發包的工班金額（不是只有付掉的）＋ 建材訂料 ＋ 專案雜支。'],
      ['超出估價', '實際成本 − 成交那版估價單的預估成本。正數代表利潤正在被吃掉。'],
      ['每坪利潤', '毛利 ÷ 室內坪數。判斷案子該不該接，這個數字比總價有用。']
    ],
    notes: ['施工前期還沒發包的工種不在成本裡，所以毛利率會偏高；看「超出估價」那欄比較準。']
  },
  async render(el) {
    const state = { status: '', designer_id: '' };
    const bar = App.filterBar([
      { name: 'status', label: '狀態', type: 'select', options: [['', '全部（不含洽談／未成交）']].concat(twOpts(TW.project_status)) },
      { name: 'designer_id', label: '設計師', type: 'select', options: App.staffOptions(true) }
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
          <h3>逐案損益</h3>
          ${UI.table(['案場', '狀態', '工進', '合約總價', '發包', '材料', '雜支', '成本合計', '毛利', '毛利率', '每坪利潤', '超出估價'],
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
          </tr>`), '沒有資料')}
        </div>`;
      Charts.mount(box);
    };
    await load();
  }
});
