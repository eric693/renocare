// 客戶名單、案場清單與案場詳情

App.page('customers', {
  help: {
    intro: '客戶資料只填一次，之後開案場、開估價單、印報價單、業主端都從這裡帶。',
    steps: ['新增客戶 → 姓名與電話是必要的，統編與地址可以成交後再補。',
      '「來源」請確實選 —— 半年後你會想知道賺錢的案子都是從哪裡來的。',
      '承接欄會自動統計這位客戶的案數與累計合約金額，舊客回頭時看這個。',
      '用上方的「來源」篩選，看某個管道帶來多少客戶；搜尋吃姓名、電話、地址。'],
    notes: ['已經有案場的客戶刪不掉，避免案子變成沒有業主。']
  },
  title: '客戶名單',
  sub: '業主資料、來源與承接紀錄',
  module: 'customers',
  async render(el) {
    const state = { source: '', q: '' };
    const bar = App.filterBar([
      { name: 'source', label: '來源', type: 'select', options: [['', '全部來源']].concat(App.listOptions('customer_sources')) },
      { name: 'q', label: '搜尋', placeholder: '姓名／電話／地址' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const act = document.createElement('div');
    act.className = 'actions';
    act.innerHTML = '<button class="btn" id="add">新增客戶</button>' + UI.csvBtn('customers');
    el.appendChild(act);
    const box = document.createElement('div');
    el.appendChild(box);

    const load = async () => {
      const rows = await GET('/customers' + App.qs(state));
      box.innerHTML = UI.table(['客戶', '聯絡方式', '地址', '來源', '承接', ''], rows.map(r => `<tr>
        <td><strong>${UI.esc(r.name)}</strong>${r.tax_id ? `<div class="muted">統編 ${UI.esc(r.tax_id)}</div>` : ''}</td>
        <td>${UI.esc(r.phone)}${r.email ? `<div class="muted">${UI.esc(r.email)}</div>` : ''}</td>
        <td class="muted">${UI.esc(r.address)}</td>
        <td>${UI.esc(r.source || '—')}</td>
        <td class="num">${r.project_count} 案<div class="muted">${UI.fmtMoney(r.contract_amount)}</div></td>
        <td class="nowrap"><button class="btn tiny secondary" data-edit="${r.id}">編輯</button>
          <button class="btn tiny secondary" data-del="${r.id}">刪除</button></td>
      </tr>`), '還沒有客戶資料');
      UI.bindCsv(act, 'customers', '客戶名單', [
        ['客戶', r => r.name], ['電話', r => r.phone], ['Email', r => r.email],
        ['統一編號', r => r.tax_id], ['地址', r => r.address], ['來源', r => r.source],
        ['承接案數', r => r.project_count], ['累計合約金額', r => r.contract_amount], ['備註', r => r.note]
      ], rows);
      box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
        customerDialog(rows.find(x => String(x.id) === b.dataset.edit), load));
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!await UI.confirm('確定刪除這位客戶？')) return;
        try { await DEL('/customers/' + b.dataset.del); load(); } catch (e) { UI.err(e); }
      });
    };
    act.querySelector('#add').onclick = () => customerDialog(null, load);
    await load();
  }
});

function customerDialog(row, done) {
  UI.modal({
    title: row ? '編輯客戶' : '新增客戶',
    body: `<div class="form-grid">
      ${UI.input('name', '姓名／公司名', { value: row ? row.name : '', required: true })}
      ${UI.input('phone', '電話', { value: row ? row.phone : '' })}
      ${UI.input('email', 'Email', { value: row ? row.email : '' })}
      ${UI.input('line_id', 'LINE ID', { value: row ? row.line_id : '' })}
      ${UI.input('tax_id', '統一編號（商空客戶）', { value: row ? row.tax_id : '' })}
      ${UI.select('source', '來源', [['', '未填']].concat(App.listOptions('customer_sources')), { value: row ? row.source : '' })}
      ${UI.input('address', '聯絡地址', { value: row ? row.address : '', full: true })}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const d = UI.formData(el);
      if (row) await PUT('/customers/' + row.id, d); else await POST('/customers', d);
      UI.toast('已儲存'); done();
    }
  });
}

// ---- 案場 ----

App.page('projects', {
  title: '案場專案',
  sub: '一個案子的合約、工進、收付與損益都在這裡',
  module: 'projects',
  help: {
    intro: '案場是整套系統的軸心：估價、追加、請款、發包、工進、缺失、保固全部掛在案場底下。點任何一列進去就是這個案子的全貌。',
    steps: [
      '新增案場 → 開估價單 → 估價單標成交會自動產生合約 → 套用請款節點與工序範本 → 開始施工。',
      '案場詳情頁上方永遠顯示這個案子的錢：合約總價、已收、應收、成本、毛利。',
      '產生業主端連結後傳給客戶，他可以自己看進度與照片、線上簽追加單，不必再一直打電話問。'
    ],
    notes: ['案子狀態會影響提醒：只有設計中／已簽約／施工中／驗收中／保固中的案子會跑每日自動提醒。']
  },
  async render(el) {
    const id = App.pageQuery.get('id');
    if (id) return renderProjectDetail(el, Number(id));

    const state = { status: '', designer_id: '', q: '' };
    const bar = App.filterBar([
      { name: 'status', label: '狀態', type: 'select', options: [['', '全部狀態']].concat(twOpts(TW.project_status)) },
      { name: 'designer_id', label: '設計師', type: 'select', options: App.staffOptions(true) },
      { name: 'q', label: '搜尋', placeholder: '案名／編號／地址／客戶' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const act = document.createElement('div');
    act.className = 'actions';
    act.innerHTML = '<button class="btn" id="add">新增案場</button>' + UI.csvBtn('projects');
    el.appendChild(act);
    const box = document.createElement('div');
    el.appendChild(box);

    const load = async () => {
      const rows = await GET('/projects' + App.qs(state));
      box.innerHTML = UI.table(['案場', '客戶', '狀態', '工進', '合約總價', '已收 / 應收', '毛利率', '工期'],
        rows.map(r => `<tr class="clickable" onclick="location.hash='projects?id=${r.id}'">
        <td><strong>${UI.esc(r.name)}</strong>
          <div class="muted">${UI.esc(r.code)}　${UI.esc(r.site_type || '')}${r.area_ping ? ` ${r.area_ping} 坪` : ''}</div></td>
        <td>${UI.esc(r.customer_name || '—')}<div class="muted">${UI.esc(r.designer_name || '')}</div></td>
        <td>${UI.tag(twText(TW.project_status, r.status), r.status === 'construction' ? 'ok' : r.status === 'lost' ? 'danger' : '')}
          ${r.change_sent_count ? `<div>${UI.tag(`${r.change_sent_count} 張追加待簽`, 'danger')}</div>` : ''}</td>
        <td>${r.progress === null ? '<span class="muted">—</span>' : bar2(r.progress)}</td>
        <td class="num">${UI.fmtMoney(r.contract_total)}</td>
        <td class="num">${UI.fmtMoney(r.received)}
          <div class="muted ${r.overdue ? 'danger' : ''}">應收 ${UI.fmtMoney(r.receivable)}</div></td>
        <td class="num ${r.gross_profit < 0 ? 'danger' : ''}">${r.margin === undefined ? '<span class="muted">—</span>' : r.margin + '%'}</td>
        <td>${r.delay_days ? UI.tag(`逾期 ${r.delay_days} 天`, 'danger') : UI.date(r.due_date)}</td>
      </tr>`), '還沒有案場');
      UI.bindCsv(act, 'projects', '案場清單', [
        ['代號', r => r.code], ['案場', r => r.name], ['客戶', r => r.customer_name],
        ['設計師', r => r.designer_name], ['狀態', r => twText(TW.project_status, r.status)],
        ['類型', r => r.site_type], ['坪數', r => r.area_ping], ['地址', r => r.address],
        ['簽約日', r => r.sign_date], ['開工日', r => r.start_date], ['約定完工', r => r.due_date],
        ['實際完工', r => r.actual_end_date], ['逾期天數', r => r.delay_days || ''],
        ['工進%', r => r.progress === null ? '' : r.progress],
        ['合約總價', r => r.contract_total], ['已收', r => r.received], ['應收', r => r.receivable],
        ['逾期未收', r => r.overdue], ['毛利', r => r.gross_profit ?? ''], ['毛利率%', r => r.margin ?? ''],
        ['追加待簽張數', r => r.change_sent_count]
      ], () => rows);
    };
    act.querySelector('#add').onclick = () => projectDialog(null, async () => { await App.reloadProjects(); load(); });
    await load();
  }
});

function bar2(pct) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<div class="pbar"><i style="width:${v}%"></i></div><span class="pv">${v}%</span>`;
}

function projectDialog(row, done) {
  UI.modal({
    title: row ? '編輯案場' : '新增案場', wide: true,
    body: `<div class="form-grid">
      ${UI.input('name', '案名', { value: row ? row.name : '', required: true, placeholder: '例：內湖陳宅 全室翻修' })}
      ${UI.select('customer_id', '業主', App.projectCustomerOptions ? App.projectCustomerOptions() : [], { value: row ? row.customer_id : '' })}
      ${UI.input('address', '案場地址', { value: row ? row.address : '', full: true })}
      ${UI.select('site_type', '類型', [['', '未選']].concat(App.listOptions('site_types')), { value: row ? row.site_type : '' })}
      ${UI.input('area_ping', '室內坪數', { type: 'number', step: '0.1', value: row ? row.area_ping : '' })}
      ${UI.select('style', '風格', [['', '未選']].concat(App.listOptions('styles')), { value: row ? row.style : '' })}
      ${UI.select('status', '狀態', twOpts(TW.project_status), { value: row ? row.status : 'lead' })}
      ${UI.select('designer_id', '設計師', App.staffOptions(false), { value: row ? row.designer_id : '' })}
      ${UI.select('supervisor_id', '工務', App.staffOptions(false), { value: row ? row.supervisor_id : '' })}
      ${UI.input('sign_date', '簽約日', { type: 'date', value: row ? row.sign_date : '' })}
      ${UI.input('start_date', '開工日', { type: 'date', value: row ? row.start_date : '' })}
      ${UI.input('due_date', '合約完工日', { type: 'date', value: row ? row.due_date : '' })}
      ${UI.input('actual_end_date', '實際完工日', { type: 'date', value: row ? row.actual_end_date : '' })}
      ${UI.input('handover_date', '交屋日（保固起算）', { type: 'date', value: row ? row.handover_date : '' })}
      ${UI.input('warranty_months', '保固月數', { type: 'number', value: row ? row.warranty_months : 12 })}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const d = UI.formData(el);
      if (row) await PUT('/projects/' + row.id, d);
      else {
        const r = await POST('/projects', d);
        await App.reloadProjects();
        location.hash = 'projects?id=' + r.id;
      }
      UI.toast('已儲存');
      done && done();
    },
    onOpen: async body => {
      // 客戶下拉要即時抓（剛新增的客戶也要選得到）
      const cs = await GET('/customers').catch(() => []);
      const sel = body.querySelector('[name=customer_id]');
      if (!sel) return;
      sel.innerHTML = [['', '未指定']].concat(cs.map(c => [c.id, `${c.name}${c.phone ? ' ' + c.phone : ''}`]))
        .map(([v, t]) => `<option value="${v}"${String(v) === String(row ? row.customer_id : '') ? ' selected' : ''}>${UI.esc(t)}</option>`).join('');
    }
  });
}
App.projectCustomerOptions = () => [['', '未指定']];

// ---- 案場詳情 ----

async function renderProjectDetail(el, id) {
  const d = await GET(`/projects/${id}/detail`);
  const p = d.project, m = d.money;
  const back = `<a href="#projects">← 回案場清單</a>`;

  // 錢的四象限：收多少、還能收多少、花多少、剩多少。
  // 這四個數字是老闆每天唯一想知道的事。
  const head = `
    <div class="card">
      <div class="detail-head">
        <div>
          <h2>${UI.esc(p.name)} ${UI.tag(twText(TW.project_status, p.status), p.status === 'construction' ? 'ok' : '')}</h2>
          <div class="muted">${UI.esc(p.code)}　${UI.esc(p.address || '')}　${UI.esc(p.site_type || '')}
            ${p.area_ping ? `${p.area_ping} 坪` : ''}</div>
          <div class="muted">業主 ${UI.esc(p.customer_name || '—')} ${UI.esc(p.customer_phone || '')}　
            設計 ${UI.esc(p.designer_name || '—')}　工務 ${UI.esc(p.supervisor_name || '—')}</div>
        </div>
        <div class="detail-actions">
          <button class="btn small" id="p-edit">編輯案場</button>
          <button class="btn small secondary" id="p-link">業主端連結</button>
        </div>
      </div>
      <div class="stat-grid">
        ${stat(UI.fmtMoney(m.contract_total), '合約總價', '', '', `原約 ${UI.fmtShort(m.contract_amount)} ＋已簽追加 ${UI.fmtShort(m.change_signed)}`)}
        ${stat(UI.fmtMoney(m.received), '已收', 'ok', '', `還沒收 ${UI.fmtShort(m.contract_total - m.received)}`)}
        ${stat(UI.fmtMoney(m.receivable), '可以去要的錢', m.overdue ? 'danger' : m.receivable ? 'warn' : '', '',
    m.overdue ? `其中逾期 ${UI.fmtShort(m.overdue)}` : '')}
        ${m.gross_profit === undefined ? '' /* 沒有損益權限：後端不給成本與毛利 */ : `
        ${stat(UI.fmtMoney(m.cost_committed), '已發生成本', '', '',
      `發包 ${UI.fmtShort(m.sub_committed)}／材料 ${UI.fmtShort(m.material_cost)}／雜支 ${UI.fmtShort(m.expense_cost)}`)}
        ${stat(UI.fmtMoney(m.gross_profit), '預估毛利', m.gross_profit < 0 ? 'danger' : 'ok', '', `毛利率 ${m.margin}%`)}`}
        ${stat(d.progress === null ? '—' : d.progress + '%', '工進', '', '',
        p.due_date ? `合約完工 ${p.due_date}` : '')}
      </div>
      ${m.change_pending ? `<div class="notice warn">有 ${m.change_sent_count + m.change_draft_count} 張追加減帳還沒簽認，合計
        ${UI.fmtMoney(m.change_pending)}。<b>未簽認的金額不算在上面的合約總價裡</b> —— 先讓業主簽，再叫師傅做。</div>` : ''}
      ${penaltyNotice(m)}
      ${m.milestone_gap && App.can('billing') ? `<div class="notice warn">請款節點加起來比原合約少 ${UI.fmtMoney(m.milestone_gap)}，
        代表有一段合約金額沒有安排請款時機，檢查一下節點比例。</div>` : ''}
      ${m.cost_variance > 0 ? `<div class="notice warn">實際成本已經比當初估價高出 ${UI.fmtMoney(m.cost_variance)}
        （估 ${UI.fmtMoney(m.quoted_cost)}，實際 ${UI.fmtMoney(m.cost_committed)}）。</div>` : ''}
    </div>`;

  // 分頁照模組權限列：後端對沒權限的區塊回空陣列，分頁留著只會讓人以為「這案子沒資料」
  const TAB_MODULES = {
    money: ['billing'], changes: ['changes'], schedule: ['schedule'], subs: ['subcontracts'],
    materials: ['materials'], site: ['sitelog'], quality: ['defects', 'warranty'],
    docs: ['drawings', 'permits'], cost: ['profit']
  };
  const tabs = [
    ['money', '合約與收款'],
    ['changes', `追加減帳${d.changes.filter(c => c.status === 'sent').length ? ' ●' : ''}`],
    ['schedule', '工進'],
    ['subs', '發包與估驗'],
    ['materials', '建材訂料'],
    ['site', '日報與照片'],
    ['quality', '缺失與保固'],
    ['docs', '圖面與許可'],
    ['cost', '成本與雜支']
  ].filter(([k]) => TAB_MODULES[k].some(mod => App.can(mod)));
  el.innerHTML = `${back}${head}
    <div class="tabs" id="tabs">${tabs.map(([k, t], i) =>
    `<button data-view data-tab="${k}" class="${i === 0 ? 'active' : ''}">${UI.esc(t)}</button>`).join('')}</div>
    <div id="tab-body"></div>`;

  const body = el.querySelector('#tab-body');
  const render = key => {
    el.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
    body.innerHTML = TABS[key](d);
    TABBIND[key] && TABBIND[key](body, d, () => renderProjectDetail(el, id));
    Charts.mount(body);
  };
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => render(b.dataset.tab));
  el.querySelector('#p-edit').onclick = () => projectDialog(p, () => renderProjectDetail(el, id));
  el.querySelector('#p-link').onclick = () => clientLinkDialog(p, () => renderProjectDetail(el, id));
  if (tabs.length) render(tabs[0][0]);
  else body.innerHTML = '<div class="empty">你的帳號沒有這個案子底下任何分頁的權限。</div>';
}

function clientLinkDialog(p, done) {
  const url = t => `${location.origin}/client.html#${t}`;
  UI.modal({
    title: '業主端連結', wide: true, hideFooter: true,
    body: `<div id="cl-box">
      <p>把這條連結傳給業主，他可以自己看工進與現場照片、線上簽認追加減帳、回報缺失。
      不需要帳號密碼，連結本身就是憑證；覺得外流就按「重新產生」，舊連結立刻失效。</p>
      ${p.client_token
      ? `<div class="form-row full"><label>連結</label>
           <input value="${UI.esc(url(p.client_token))}" readonly onclick="this.select()"></div>
         <div style="display:flex;gap:8px;flex-wrap:wrap">
           <button class="btn" id="cl-copy">複製連結</button>
           <a class="btn secondary" href="${UI.esc(url(p.client_token))}" target="_blank" rel="noopener">開啟預覽</a>
           <button class="btn secondary" id="cl-new">重新產生</button>
           <button class="btn secondary" id="cl-off">停用</button>
         </div>`
      : `<button class="btn" id="cl-new">產生業主端連結</button>`}
    </div>`,
    onOpen: (bd, close) => {
      const q = s => bd.querySelector(s);
      q('#cl-new') && (q('#cl-new').onclick = async () => {
        await POST(`/projects/${p.id}/client-link`);
        UI.toast('已產生新連結'); close(); done();
      });
      q('#cl-off') && (q('#cl-off').onclick = async () => {
        if (!await UI.confirm('停用後這條連結立刻失效，確定嗎？')) return;
        await DEL(`/projects/${p.id}/client-link`);
        UI.toast('已停用'); close(); done();
      });
      q('#cl-copy') && (q('#cl-copy').onclick = async () => {
        try { await navigator.clipboard.writeText(url(p.client_token)); UI.toast('已複製'); }
        catch { UI.toast('請手動複製上面的連結', true); }
      });
    }
  });
}
