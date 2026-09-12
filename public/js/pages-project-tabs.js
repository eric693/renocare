// 案場詳情的各個分頁。每一頁只放「在這個案子底下才有意義」的操作，
// 跨案的總覽（應收、應付、缺失總表）另外有獨立頁面。

const TABS = {}, TABBIND = {};
const money = UI.fmtMoney;

// ============ 合約與收款 ============

TABS.money = d => {
  const m = d.money;
  const msRows = m.milestones.map(x => `<tr>
    <td>${UI.esc(x.name)}<div class="muted">${x.basis === 'percent' ? `合約 ${x.percent}%` : '固定金額'}</div></td>
    <td class="num">${money(x.amount)}</td>
    <td class="num">${money(x.received)}</td>
    <td class="num ${x.overdue ? 'danger' : ''}">${money(x.outstanding)}</td>
    <td>${UI.tag(twText(TW.ms_status, x.status),
    x.status === 'paid' ? 'ok' : x.overdue ? 'danger' : x.status === 'ready' ? 'warn' : '')}
      ${x.invoiced_date ? `<div class="muted">開單 ${x.invoiced_date}${x.due_date ? `／到期 ${x.due_date}` : ''}</div>` : ''}</td>
    <td class="nowrap">
      ${x.status === 'ready' || x.status === 'pending' ? `<button class="btn tiny" data-inv="${x.id}">開單請款</button>` : ''}
      ${x.outstanding > 0 && x.status !== 'pending' ? `<button class="btn tiny" data-rcv="${x.id}">登錄收款</button>` : ''}
      <button class="btn tiny secondary" data-msedit="${x.id}">編輯</button>
      <button class="btn tiny secondary" data-msdel="${x.id}">刪除</button></td>
  </tr>`);

  return `
  <div class="card">
    <div class="card-head"><h3>合約</h3><button class="btn small" id="ct-add">新增合約</button></div>
    ${UI.table(['合約編號', '種類', '簽約日', '金額', '工期', '逾期罰款／日', ''], d.contracts.map(c => `<tr>
      <td>${UI.esc(c.contract_no)}</td>
      <td>${twText(TW.quote_kind, c.kind)}</td>
      <td>${UI.date(c.sign_date)}</td>
      <td class="num">${money(c.amount)}</td>
      <td>${c.work_days ? c.work_days + ' 天' : '—'}</td>
      <td class="num">${c.penalty_per_day ? money(c.penalty_per_day) : '—'}</td>
      <td class="nowrap"><button class="btn tiny secondary" data-ctedit="${c.id}">編輯</button>
        <button class="btn tiny secondary" data-ctdel="${c.id}">刪除</button></td>
    </tr>`), '還沒有合約。可以從估價單標「已成交」自動產生，或在這裡手動新增。')}
    <div class="muted" style="margin-top:8px">已簽認追加減帳 ${money(m.change_signed)}，
      合約總價 <b>${money(m.contract_total)}</b></div>
  </div>

  <div class="card">
    <div class="card-head"><h3>請款節點</h3>
      <span><button class="btn small secondary" id="ms-tpl">套用範本</button>
      <button class="btn small" id="ms-add">新增節點</button></span></div>
    ${UI.table(['節點', '應請金額', '已收', '未收', '狀態', ''], msRows,
    '還沒安排請款節點。按「套用範本」可以一次帶入訂金／開工／木作進場／驗收／尾款。')}
    <div class="muted" style="margin-top:8px">
      節點可以綁工序：綁了之後，那道工序一開工（或完工），系統隔天就會自動提醒你開單請款。</div>
  </div>

  <div class="card">
    <div class="card-head"><h3>收款紀錄</h3><button class="btn small" id="rc-add">登錄收款</button></div>
    ${UI.table(['日期', '金額', '方式', '對應節點', '發票', '備註', ''], d.receipts.map(r => {
      const ms = m.milestones.find(x => x.id === r.milestone_id);
      return `<tr><td class="nowrap">${UI.date(r.date)}</td>
        <td class="num">${money(r.amount)}</td><td>${UI.esc(r.method)}</td>
        <td>${ms ? UI.esc(ms.name) : '<span class="muted">追加／其他款</span>'}</td>
        <td class="muted">${UI.esc(r.invoice_no || '')}</td>
        <td class="muted">${UI.esc(r.note || '')}</td>
        <td><button class="btn tiny secondary" data-rcdel="${r.id}">刪除</button></td></tr>`;
    }), '還沒有收款紀錄')}
    ${m.change_unbilled ? `<div class="notice warn">已簽認的追加還有 ${money(m.change_unbilled)} 沒收到。
      追加款不在請款節點裡，登錄收款時「對應節點」留空即可。</div>` : ''}
  </div>`;
};

TABBIND.money = (el, d, reload) => {
  const pid = d.project.id;
  el.querySelector('#ct-add').onclick = () => contractDialog(pid, null, reload);
  el.querySelectorAll('[data-ctedit]').forEach(b => b.onclick = () =>
    contractDialog(pid, d.contracts.find(x => String(x.id) === b.dataset.ctedit), reload));
  el.querySelectorAll('[data-ctdel]').forEach(b => b.onclick = async () => {
    if (!await UI.confirm('確定刪除這張合約？相關的請款節點金額會跟著改變。')) return;
    await DEL('/contracts/' + b.dataset.ctdel); reload();
  });
  el.querySelector('#ms-tpl').onclick = async () => {
    try {
      const r = await POST('/milestones/apply-template', { project_id: pid });
      UI.toast(`已建立 ${r.created} 個節點（合計 ${r.percent_sum}%）`); reload();
    } catch (e) { UI.err(e); }
  };
  el.querySelector('#ms-add').onclick = () => milestoneDialog(pid, null, d, reload);
  el.querySelectorAll('[data-msedit]').forEach(b => b.onclick = () =>
    milestoneDialog(pid, d.money.milestones.find(x => String(x.id) === b.dataset.msedit), d, reload));
  el.querySelectorAll('[data-msdel]').forEach(b => b.onclick = async () => {
    if (!await UI.confirm('確定刪除這個請款節點？')) return;
    try { await DEL('/milestones/' + b.dataset.msdel); reload(); } catch (e) { UI.err(e); }
  });
  el.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => {
    const ms = d.money.milestones.find(x => String(x.id) === b.dataset.inv);
    UI.modal({
      title: `開單請款 — ${ms.name}`,
      body: `<p>金額 <b>${money(ms.amount)}</b>。開單之後這筆錢才會進入應收帳款，逾期也才算得出來。</p>
        <div class="form-grid">
          ${UI.input('invoiced_date', '請款日', { type: 'date', value: UI.today() })}
          ${UI.input('due_date', '約定收款期限', { type: 'date', value: '' })}
          ${UI.input('invoice_no', '發票號碼', { value: '' })}
        </div>`,
      onSubmit: async bd => { await POST(`/milestones/${ms.id}/invoice`, UI.formData(bd)); UI.toast('已開單'); reload(); }
    });
  });
  el.querySelectorAll('[data-rcv]').forEach(b => b.onclick = () =>
    receiptDialog(pid, d, Number(b.dataset.rcv), reload));
  el.querySelector('#rc-add').onclick = () => receiptDialog(pid, d, null, reload);
  el.querySelectorAll('[data-rcdel]').forEach(b => b.onclick = async () => {
    if (!await UI.confirm('確定刪除這筆收款？')) return;
    await DEL('/receipts/' + b.dataset.rcdel); reload();
  });
};

function contractDialog(pid, row, done) {
  UI.modal({
    title: row ? '編輯合約' : '新增合約',
    body: `<div class="form-grid">
      ${UI.input('contract_no', '合約編號（留空自動產生）', { value: row ? row.contract_no : '' })}
      ${UI.select('kind', '種類', twOpts(TW.quote_kind), { value: row ? row.kind : 'build' })}
      ${UI.input('sign_date', '簽約日', { type: 'date', value: row ? row.sign_date : UI.today() })}
      ${UI.input('amount', '合約金額（含稅）', { type: 'number', value: row ? row.amount : '' })}
      ${UI.input('work_days', '約定工期（日曆天）', { type: 'number', value: row ? row.work_days : '' })}
      ${UI.input('penalty_per_day', '逾期違約金／日', { type: 'number', value: row ? row.penalty_per_day : '' })}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) await PUT('/contracts/' + row.id, v);
      else await POST('/contracts', { ...v, project_id: pid });
      UI.toast('已儲存'); done();
    }
  });
}

function milestoneDialog(pid, row, d, done) {
  const items = [['', '不綁工序（依日期或人工判斷）']].concat(d.schedule.map(s => [s.id, `${s.name}（${s.planned_start}）`]));
  UI.modal({
    title: row ? '編輯請款節點' : '新增請款節點',
    body: `<div class="form-grid">
      ${UI.input('name', '節點名稱', { value: row ? row.name : '', required: true, placeholder: '例：木作進場' })}
      ${UI.select('basis', '計算方式', twOpts(TW.ms_basis), { value: row ? row.basis : 'percent' })}
      ${UI.input('percent', '佔原合約％', { type: 'number', step: '0.1', value: row ? row.percent : '' })}
      ${UI.input('fixed_amount', '固定金額', { type: 'number', value: row ? row.fixed_amount : '' })}
      ${UI.select('trigger_item_id', '綁定工序', items, { value: row ? row.trigger_item_id : '' })}
      ${UI.select('trigger_on', '觸發時機', twOpts(TW.trigger_on), { value: row ? row.trigger_on : 'start' })}
      ${UI.input('planned_date', '預計請款日（沒綁工序時用）', { type: 'date', value: row ? row.planned_date : '' })}
      ${row ? UI.select('status', '狀態', twOpts(TW.ms_status), { value: row.status }) : ''}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) await PUT('/milestones/' + row.id, v);
      else await POST('/milestones', { ...v, project_id: pid });
      UI.toast('已儲存'); done();
    }
  });
}

function receiptDialog(pid, d, msId, done) {
  const ms = d.money.milestones.find(x => x.id === msId);
  UI.modal({
    title: '登錄收款',
    body: `<div class="form-grid">
      ${UI.select('milestone_id', '對應請款節點',
      [['', '追加款／其他（不對應節點）']].concat(d.money.milestones.map(x => [x.id, `${x.name}（未收 ${money(x.outstanding)}）`])),
      { value: msId || '' })}
      ${UI.input('date', '收款日', { type: 'date', value: UI.today() })}
      ${UI.input('amount', '金額', { type: 'number', value: ms ? ms.outstanding : '' })}
      ${UI.select('method', '方式', App.listOptions('payment_methods', ['匯款']), { value: '匯款' })}
      ${UI.input('invoice_no', '發票號碼', {})}
      ${UI.textarea('note', '備註', {})}
    </div>`,
    onSubmit: async el => {
      await POST('/receipts', { ...UI.formData(el), project_id: pid });
      UI.toast('已登錄'); done();
    }
  });
}

// ============ 追加減帳 ============

TABS.changes = d => `
  <div class="card">
    <div class="card-head"><h3>追加減帳</h3><button class="btn small" id="co-add">新增變更單</button></div>
    <div class="notice">只有<b>業主簽認</b>的變更單才會算進合約總價。送出之後三天沒簽，系統會自動開一張待辦提醒你去追。</div>
    ${UI.table(['單號', '事由', '金額', '展延', '狀態', '簽認', ''], d.changes.map(c => `<tr>
      <td>${UI.esc(c.no)}<div class="muted">${UI.date(c.created_at.slice(0, 10))}</div></td>
      <td><strong>${UI.esc(c.title)}</strong>
        <div class="muted">${twText(TW.change_reason, c.reason)}${c.detail ? '　' + UI.esc(c.detail.slice(0, 40)) : ''}</div></td>
      <td class="num ${c.amount < 0 ? 'danger' : ''}">${money(c.amount)}</td>
      <td>${c.days_delay ? c.days_delay + ' 天' : '—'}</td>
      <td>${UI.tag(twText(TW.change_status, c.status),
  c.status === 'signed' ? 'ok' : c.status === 'sent' ? 'danger' : c.status === 'rejected' ? 'warn' : '')}</td>
      <td class="muted">${c.signed_at ? `${UI.esc(c.signed_name)}<div>${UI.esc(c.signed_at)}</div>
        <div>${c.sign_channel === 'client' ? '業主端線上簽' : '紙本回簽'}</div>` : '—'}</td>
      <td class="nowrap"><button class="btn tiny secondary" data-coopen="${c.id}">明細</button></td>
    </tr>`), '還沒有變更單')}
  </div>`;

TABBIND.changes = (el, d, reload) => {
  el.querySelector('#co-add').onclick = () => changeDialog(d.project.id, null, reload);
  el.querySelectorAll('[data-coopen]').forEach(b => b.onclick = () => changeDetail(Number(b.dataset.coopen), reload));
};

// ============ 工進 ============

TABS.schedule = d => {
  const t = UI.today();
  const rows = d.schedule;
  // 甘特條：以全案最早開工到最晚完工為軸，用百分比定位，不必算像素
  const dates = rows.flatMap(r => [r.planned_start, r.planned_end, r.actual_end]).filter(Boolean).sort();
  const t0 = dates[0], t1 = dates[dates.length - 1];
  // 工序都還沒填日期時，甘特圖沒有時間軸可畫 —— 這時只畫明細表，不要產生一排 NaN 的長條
  const hasAxis = !!t0;
  const span = hasAxis ? Math.max(1, (new Date(t1) - new Date(t0)) / 86400000) : 1;
  const pos = dt => (hasAxis && dt ? ((new Date(dt) - new Date(t0)) / 86400000 / span) * 100 : 0);

  return `
  <div class="card">
    <div class="card-head"><h3>工序（${rows.length}）</h3>
      <span><button class="btn small secondary" id="sc-tpl">套用範本</button>
      <button class="btn small" id="sc-add">新增工序</button></span></div>
    ${rows.length && hasAxis ? `<div class="gantt">${rows.map(r => {
    const late = r.status !== 'done' && r.planned_end && r.planned_end < t;
    const l = r.planned_start ? pos(r.planned_start) : 0;
    const w = Math.max(1.2, (r.planned_end ? pos(r.planned_end) : l) - l);
    return `<div class="g-row" data-scedit="${r.id}">
        <div class="g-name">${UI.esc(r.name)}<small>${UI.esc(r.vendor_name || r.trade || '')}</small></div>
        <div class="g-track">
          <div class="g-bar ${r.status === 'done' ? 'done' : late ? 'late' : r.status === 'working' ? 'working' : ''}"
            style="left:${l.toFixed(2)}%;width:${w.toFixed(2)}%"
            title="${UI.esc(r.planned_start)} ~ ${UI.esc(r.planned_end)}">
            <i style="width:${Math.max(0, Math.min(100, r.progress))}%"></i></div>
        </div>
        <div class="g-meta">${r.planned_start ? `${r.planned_start.slice(5)}~${(r.planned_end || '').slice(5)}` : '未排'}
          ${late ? `<span class="danger">逾期</span>` : ''}
          ${r.material_risk ? `<span class="warn">缺料</span>` : ''}</div>
      </div>`;
  }).join('')}</div>` : `<div class="empty">${rows.length ? '工序還沒填日期，先在下面的明細裡補上預計起訖。'
    : '還沒排工序。按「套用範本」可以依常見工序一次排完，再微調日期。'}</div>`}
  </div>

  <div class="card">
    <h3>工序明細</h3>
    ${UI.table(['#', '工序', '工班', '預計', '實際', '進度', '狀態', ''], rows.map(r => `<tr>
      <td class="muted">${r.seq}</td>
      <td>${UI.esc(r.name)}${r.predecessor_name ? `<div class="muted">接續：${UI.esc(r.predecessor_name)}</div>` : ''}</td>
      <td>${UI.esc(r.vendor_name || r.trade || '—')}</td>
      <td class="nowrap">${UI.date(r.planned_start)} ~ ${UI.date(r.planned_end)}</td>
      <td class="nowrap muted">${r.actual_start || '—'} ~ ${r.actual_end || ''}</td>
      <td class="num">${r.progress}%</td>
      <td>${UI.tag(twText(TW.sched_status, r.status), r.status === 'done' ? 'ok' : r.status === 'working' ? 'warn' : '')}</td>
      <td class="nowrap"><button class="btn tiny secondary" data-scedit2="${r.id}">編輯</button>
        <button class="btn tiny secondary" data-scshift="${r.id}">整批推移</button>
        <button class="btn tiny secondary" data-scdel="${r.id}">刪除</button></td>
    </tr>`), '')}
    <div class="muted" style="margin-top:8px">把某道工序的「預計完成日」往後改，後面所有相依的工序會自動一起往後推
      —— 這就是現場最常忘記做、忘記了就會白付一天工資的事。</div>
  </div>`;
};

TABBIND.schedule = (el, d, reload) => {
  const pid = d.project.id;
  el.querySelector('#sc-tpl').onclick = () => {
    UI.modal({
      title: '套用工序範本',
      body: `<p>依設定頁的工序範本一次排出整個工期，並自動串好前後相依關係。之後可以個別調整日期。</p>
        <div class="form-grid">${UI.input('start_date', '從哪天開始', { type: 'date', value: d.project.start_date || UI.today() })}</div>`,
      onSubmit: async bd => {
        const r = await POST('/schedule/apply-template', { project_id: pid, ...UI.formData(bd) });
        UI.toast(`已排 ${r.created} 道工序`); reload();
      }
    });
  };
  el.querySelector('#sc-add').onclick = () => scheduleDialog(pid, null, d, reload);
  const open = id => scheduleDialog(pid, d.schedule.find(x => String(x.id) === String(id)), d, reload);
  el.querySelectorAll('[data-scedit]').forEach(b => b.onclick = () => open(b.dataset.scedit));
  el.querySelectorAll('[data-scedit2]').forEach(b => b.onclick = () => open(b.dataset.scedit2));
  el.querySelectorAll('[data-scdel]').forEach(b => b.onclick = async () => {
    if (!await UI.confirm('確定刪除這道工序？後面的工序會接到它的前置工序。')) return;
    await DEL('/schedule/' + b.dataset.scdel); reload();
  });
  el.querySelectorAll('[data-scshift]').forEach(b => b.onclick = () => {
    const it = d.schedule.find(x => String(x.id) === b.dataset.scshift);
    UI.modal({
      title: `整批推移 — ${it.name}`,
      body: `<p>下雨、停工、等料的時候用。填正數往後延，負數提前。</p>
        <div class="form-grid">
          ${UI.input('days', '推移天數', { type: 'number', value: 1 })}
          ${UI.checkbox('include_self', '含這道工序本身', true)}
        </div>`,
      onSubmit: async bd => {
        const r = await POST(`/schedule/${it.id}/shift`, UI.formData(bd));
        UI.toast(`已調整 ${r.shifted} 道工序`); reload();
      }
    });
  });
};

function scheduleDialog(pid, row, d, done) {
  const preds = [['', '無（可獨立開工）']].concat(
    d.schedule.filter(s => !row || s.id !== row.id).map(s => [s.id, s.name]));
  UI.modal({
    title: row ? `編輯工序 — ${row.name}` : '新增工序', wide: true,
    body: `<div class="form-grid">
      ${UI.input('name', '工序名稱', { value: row ? row.name : '', required: true })}
      ${UI.select('trade', '工種', [['', '未選']].concat(App.listOptions('trades')), { value: row ? row.trade : '' })}
      ${UI.select('vendor_id', '工班', App.vendorOptions(false), { value: row ? row.vendor_id : '' })}
      ${UI.input('planned_start', '預計開工', { type: 'date', value: row ? row.planned_start : '' })}
      ${UI.input('planned_end', '預計完成', { type: 'date', value: row ? row.planned_end : '' })}
      ${UI.input('actual_start', '實際開工', { type: 'date', value: row ? row.actual_start : '' })}
      ${UI.input('actual_end', '實際完成', { type: 'date', value: row ? row.actual_end : '' })}
      ${UI.input('progress', '進度％', { type: 'number', value: row ? row.progress : 0 })}
      ${UI.select('status', '狀態', twOpts(TW.sched_status), { value: row ? row.status : 'pending' })}
      ${UI.select('predecessor_id', '前置工序', preds, { value: row ? row.predecessor_id : '' })}
      ${UI.input('lag_days', '與前置工序的間隔天數（養護期）', { type: 'number', value: row ? row.lag_days : 0 })}
      ${UI.checkbox('cascade', '日期往後改時，後面的工序一起推', true, { full: true })}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) {
        const r = await PUT('/schedule/' + row.id, v);
        UI.toast(r.shifted ? `已儲存，後續 ${r.shifted} 道工序一起${r.days > 0 ? '往後' : '往前'} ${Math.abs(r.days)} 天` : '已儲存');
      } else {
        await POST('/schedule', { ...v, project_id: pid });
        UI.toast('已新增');
      }
      done();
    }
  });
}
