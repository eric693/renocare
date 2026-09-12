// 營運儀表板、我的工作、待辦事項

// 卡片：數字大、標籤小，可點就帶到對應清單
function stat(num, label, cls = '', href = '', sub = '') {
  return `<div class="stat${href ? ' clickable' : ''}"${href ? ` onclick="location.hash='${href}'"` : ''}>
    <div class="num ${cls}">${num}</div><div class="label">${UI.esc(label)}</div>
    ${sub ? `<div class="label muted">${UI.esc(sub)}</div>` : ''}</div>`;
}

App.page('dashboard', {
  title: '營運儀表板',
  sub: '在建的案子、要不回來的錢、快要出事的事，一頁看完',
  module: 'dashboard',
  help: {
    intro: '這頁只回答三個問題：現在有幾個案子在跑、錢的位置在哪裡、有什麼事情再不處理就會變成損失。',
    steps: [
      '最上排是全部在建案場的合約總價、已收、應收與預估毛利；合約總價已經含「已簽認」的追加減帳。',
      '「需要立刻處理」的每個數字都可以點，直接帶到該處理的那一頁。',
      '下面的案場清單依「逾期應收 → 工期落後 → 合約金額」排序，最該看的排最上面。'
    ],
    notes: [
      '未簽認的追加不算進合約總價，只會出現在「追加單未簽認」那格 —— 這是刻意的：沒簽認的錢不是你的錢。',
      '預估毛利＝合約總價 −（已發包 ＋ 建材 ＋ 雜支）。還沒發包的工種不在成本裡，所以施工前期的毛利會偏高，看「成本 vs 估價」那欄才準。'
    ]
  },
  async render(el) {
    const d = await GET('/dashboard');
    const s = d.summary, a = d.attention;

    const alerts = [
      a.change_sent && ['追加單未簽認', a.change_sent + ' 張', 'changes', 'danger', '做了收不到錢的頭號來源'],
      a.overdue_amount && ['逾期未收', UI.fmtMoney(a.overdue_amount), 'receivables', 'danger', ''],
      a.ready_amount && ['可請款未開單', UI.fmtMoney(a.ready_amount), 'receivables', 'warn', '工進到了，單還沒開'],
      a.material_risk && ['建材交期有風險', a.material_risk + ' 項', 'materials', 'warn', '料沒到，工班會撲空'],
      a.schedule_late && ['工序已逾期', a.schedule_late + ' 項', 'projects', 'warn', ''],
      a.defects_overdue && ['缺失逾期未改', a.defects_overdue + ' 件', 'defects', 'warn', ''],
      a.permit_soon && ['許可將到期', a.permit_soon + ' 件', 'permits', 'danger', ''],
      a.warranty_soon && ['保固將屆', a.warranty_soon + ' 件', 'warranty', '', '到期前回訪一次'],
      a.vendor_insurance && ['工班保險已過期', a.vendor_insurance + ' 家', 'vendors', 'danger', '出事是公司扛'],
      a.retention_held && ['押著工班保留款', UI.fmtMoney(a.retention_held), 'payables', '', ''],
      a.sub_unpaid && ['估驗已確認待付', UI.fmtMoney(a.sub_unpaid), 'payables', '', '']
    ].filter(Boolean);

    el.innerHTML = `
      <div class="card">
        <h3>在建案場（${d.projects.length} 案）</h3>
        <div class="stat-grid">
          ${stat(UI.fmtMoney(s.contract_total), '合約總價（含已簽追加）')}
          ${stat(UI.fmtMoney(s.received), '已收', 'ok')}
          ${stat(UI.fmtMoney(s.receivable), '現在可以去要的錢', s.receivable ? 'warn' : '', 'receivables')}
          ${stat(UI.fmtMoney(s.overdue), '其中已逾期', s.overdue ? 'danger' : '', 'receivables')}
          ${stat(UI.fmtMoney(s.gross_profit), '預估毛利', s.gross_profit < 0 ? 'danger' : 'ok', 'profit', `毛利率 ${s.margin}%`)}
          ${stat(UI.fmtMoney(s.change_pending), '待簽認追加金額', s.change_pending ? 'warn' : '', 'changes')}
        </div>
      </div>

      <div class="card">
        <h3>需要立刻處理</h3>
        ${alerts.length ? `<div class="alert-grid">${alerts.map(([label, val, href, cls, hint]) =>
          `<div class="alert-item ${cls}" onclick="location.hash='${href}'">
            <div class="av">${UI.esc(val)}</div><div class="al">${UI.esc(label)}</div>
            ${hint ? `<div class="ah">${UI.esc(hint)}</div>` : ''}</div>`).join('')}</div>`
      : '<div class="empty ok-empty">目前沒有需要立刻處理的事。</div>'}
      </div>

      <div class="card">
        <h3>本月現金（${d.cash.month}）</h3>
        <div class="stat-grid">
          ${stat(UI.fmtMoney(d.cash.inflow), '收進來')}
          ${stat(UI.fmtMoney(d.cash.outflow), '付出去')}
          ${stat(UI.fmtMoney(d.cash.net), '淨流入', d.cash.net < 0 ? 'danger' : 'ok')}
          ${stat(d.sales.signed_count, '本月新簽約', '', '', UI.fmtMoney(d.sales.signed_amount))}
          ${stat(`${d.sales.won}/${d.sales.quoted}`, '本月報價成交', '', 'quotes')}
        </div>
      </div>

      <div class="card">
        <h3>案場現況</h3>
        ${UI.table(['案場', '狀態', '工進', '合約總價', '已收', '應收', '毛利率', '工期'],
      d.projects.map(p => `<tr class="clickable" onclick="location.hash='projects?id=${p.id}'">
          <td><strong>${UI.esc(p.name)}</strong><div class="muted">${UI.esc(p.code)}　${UI.esc(p.customer_name || '')}</div></td>
          <td>${UI.tag(twText(TW.project_status, p.status), p.status === 'construction' ? 'ok' : '')}
            ${p.change_sent_count ? UI.tag(`${p.change_sent_count} 張追加待簽`, 'danger') : ''}</td>
          <td>${p.progress === null ? '<span class="muted">未排工序</span>' : bar(p.progress)}</td>
          <td class="num">${UI.fmtMoney(p.contract_total)}</td>
          <td class="num">${UI.fmtMoney(p.received)}</td>
          <td class="num ${p.overdue ? 'danger' : ''}">${UI.fmtMoney(p.receivable)}
            ${p.overdue ? `<div class="muted danger">逾期 ${UI.fmtMoney(p.overdue)}</div>` : ''}</td>
          <td class="num ${p.gross_profit < 0 ? 'danger' : ''}">${p.margin}%</td>
          <td>${p.delay_days ? UI.tag(`逾期 ${p.delay_days} 天`, 'danger') : UI.date(p.due_date)}</td>
        </tr>`), '目前沒有進行中的案場')}
      </div>

      <div class="card">
        <h3>我的待辦（${d.my_tasks.length}）</h3>
        ${UI.table(['工作', '案場', '到期'], d.my_tasks.map(t => `<tr>
          <td>${UI.esc(t.title)}${t.priority === 'high' ? ' ' + UI.tag('急', 'danger') : ''}</td>
          <td class="muted">${UI.esc(t.project_name || '')}</td>
          <td class="nowrap ${t.due_date && t.due_date < d.date ? 'danger' : ''}">${UI.date(t.due_date)}</td>
        </tr>`), '目前沒有待辦')}
        <div style="margin-top:10px"><a href="#mytasks">前往我的工作 →</a></div>
      </div>`;
  }
});

// 進度條：數字加一條線，比單純百分比容易掃
function bar(pct) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<div class="pbar"><i style="width:${v}%"></i></div><span class="pv">${v}%</span>`;
}

// ---- 待辦 ----

function taskPage(key, title, sub, mine) {
  App.page(key, {
    title, sub, module: 'tasks',
    help: {
      intro: '除了自己開的工作，系統每天會自動把「再不做就會虧錢」的事變成待辦：追加單沒人簽、工進到了忘記請款、料要來不及、許可快到期、保固快過、保留款該退。',
      notes: ['系統自動產生的待辦（標示「自動」）處理完就按完成，同一件事不會重複跳出來。']
    },
    async render(el) {
      const state = { status: '', assignee_id: mine ? '' : '', project_id: '' };
      const bar = App.filterBar([
        { name: 'status', label: '狀態', type: 'select', options: [['', '未完成']].concat(twOpts(TW.task_status)) },
        ...(mine ? [] : [{ name: 'assignee_id', label: '負責人', type: 'select', options: App.staffOptions(true) }]),
        { name: 'project_id', label: '案場', type: 'select', options: App.projectOptions(true) }
      ], v => { Object.assign(state, v); load(); });
      el.innerHTML = '';
      el.appendChild(bar);
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.innerHTML = '<button class="btn" id="add">新增工作</button>';
      el.appendChild(actions);
      const box = document.createElement('div');
      el.appendChild(box);

      const load = async () => {
        const q = { ...state, ...(mine ? { mine: 1 } : {}) };
        if (!q.status) q.status = '';
        let rows = await GET('/tasks' + App.qs(q));
        if (!state.status) rows = rows.filter(r => r.status === 'todo' || r.status === 'doing');
        const t = UI.today();
        box.innerHTML = UI.table(['工作', '案場', '負責人', '到期', '狀態', ''], rows.map(r => `<tr>
          <td><strong>${UI.esc(r.title)}</strong>
            ${r.priority === 'high' ? ' ' + UI.tag('急', 'danger') : ''}
            ${r.source === 'auto' ? ' ' + UI.tag('自動', '') : ''}
            ${r.detail ? `<div class="muted">${UI.esc(r.detail)}</div>` : ''}</td>
          <td class="muted">${UI.esc(r.project_name || '')}</td>
          <td>${UI.esc(r.assignee_name || '未指派')}</td>
          <td class="nowrap ${r.due_date && r.due_date < t && r.status !== 'done' ? 'danger' : ''}">${UI.date(r.due_date)}</td>
          <td>${UI.tag(twText(TW.task_status, r.status), r.status === 'done' ? 'ok' : r.status === 'doing' ? 'warn' : '')}</td>
          <td class="nowrap">
            ${r.status !== 'done' ? `<button class="btn tiny" data-done="${r.id}">完成</button>` : ''}
            <button class="btn tiny secondary" data-edit="${r.id}">編輯</button>
            <button class="btn tiny secondary" data-del="${r.id}">刪除</button></td>
        </tr>`), '目前沒有工作');
        box.querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
          await PUT('/tasks/' + b.dataset.done, { status: 'done' });
          UI.toast('已完成'); load();
        });
        box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
          taskDialog(rows.find(x => String(x.id) === b.dataset.edit), load));
        box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
          if (!await UI.confirm('確定刪除這筆工作？')) return;
          await DEL('/tasks/' + b.dataset.del); load();
        });
      };
      actions.querySelector('#add').onclick = () => taskDialog(null, load);
      await load();
    }
  });
}
taskPage('mytasks', '我的工作', '指派給我、還沒做完的事', true);
taskPage('tasks', '全部待辦', '全公司的工作進度', false);

function taskDialog(row, done) {
  UI.modal({
    title: row ? '編輯工作' : '新增工作',
    body: `<div class="form-grid">
      ${UI.input('title', '工作標題', { value: row ? row.title : '', required: true, full: true })}
      ${UI.select('project_id', '相關案場', App.projectOptions(false), { value: row ? row.project_id : App.lastProject() })}
      ${UI.select('assignee_id', '負責人', App.staffOptions(false), { value: row ? row.assignee_id : App.me.id })}
      ${UI.input('due_date', '到期日', { type: 'date', value: row ? row.due_date : '' })}
      ${UI.select('priority', '優先度', twOpts(TW.priority), { value: row ? row.priority : 'normal' })}
      ${row ? UI.select('status', '狀態', twOpts(TW.task_status), { value: row.status }) : ''}
      ${UI.textarea('detail', '說明', { value: row ? row.detail : '' })}
    </div>`,
    onSubmit: async el => {
      const d = UI.formData(el);
      if (row) await PUT('/tasks/' + row.id, d); else await POST('/tasks', d);
      UI.toast('已儲存'); done();
    }
  });
}
