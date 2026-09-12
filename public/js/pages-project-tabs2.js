// 案場詳情分頁（續）：發包與估驗、建材、日報照片、缺失保固、圖面許可、成本雜支

// ============ 發包與估驗 ============

TABS.subs = d => `
  <div class="card">
    <div class="card-head"><h3>發包單</h3><button class="btn small" id="sb-add">新增發包</button></div>
    ${UI.table(['單號／工班', '工種', '發包金額', '累計估驗', '已付', '押著的錢', '狀態', ''],
  d.subcontracts.map(s => `<tr>
      <td><strong>${UI.esc(s.vendor_name || '未指定工班')}</strong><div class="muted">${UI.esc(s.no)}</div></td>
      <td>${UI.esc(s.trade || '—')}<div class="muted">${UI.esc(s.scope || '')}</div></td>
      <td class="num">${money(s.amount)}</td>
      <td class="num">${money(s.valued)}<div class="muted">${s.amount ? Math.round(s.valued / s.amount * 100) : 0}%</div></td>
      <td class="num">${money(s.paid)}</td>
      <td class="num">${money(s.retention_held + s.warranty_held)}
        <div class="muted">保留 ${UI.fmtShort(s.retention_held)}／保固 ${UI.fmtShort(s.warranty_held)}</div></td>
      <td>${UI.tag(twText(TW.sub_status, s.status), s.status === 'settled' ? 'ok' : s.status === 'working' ? 'warn' : '')}</td>
      <td class="nowrap"><button class="btn tiny secondary" data-sbopen="${s.id}">明細／估驗</button></td>
    </tr>`), '還沒有發包單')}
    <div class="muted" style="margin-top:8px">
      估驗一律填「累計完成％」，本期金額由系統用累計減前期算出來，重複計價自然被擋掉。</div>
  </div>`;

TABBIND.subs = (el, d, reload) => {
  el.querySelector('#sb-add').onclick = () => subDialog(d.project.id, null, reload);
  el.querySelectorAll('[data-sbopen]').forEach(b => b.onclick = () => subDetail(Number(b.dataset.sbopen), reload));
};

function subDialog(pid, row, done) {
  UI.modal({
    title: row ? '編輯發包單' : '新增發包單',
    body: `<div class="form-grid">
      ${UI.select('vendor_id', '工班／廠商', App.vendorOptions(false), { value: row ? row.vendor_id : '' })}
      ${UI.select('trade', '工種', [['', '未選']].concat(App.listOptions('trades')), { value: row ? row.trade : '' })}
      ${UI.textarea('scope', '承攬範圍', { value: row ? row.scope : '', rows: 2 })}
      ${UI.input('retention_pct', '估驗保留款％', { type: 'number', step: '0.1', value: row ? row.retention_pct : (App.meta.defaults ? App.meta.defaults.retention_pct : 10) })}
      ${UI.input('warranty_pct', '保固保證金％', { type: 'number', step: '0.1', value: row ? row.warranty_pct : (App.meta.defaults ? App.meta.defaults.warranty_pct : 5) })}
      ${UI.input('sign_date', '發包日', { type: 'date', value: row ? row.sign_date : UI.today() })}
      ${UI.input('start_date', '預計進場', { type: 'date', value: row ? row.start_date : '' })}
      ${UI.input('end_date', '預計完工', { type: 'date', value: row ? row.end_date : '' })}
      ${UI.select('status', '狀態', twOpts(TW.sub_status), { value: row ? row.status : 'draft' })}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) await PUT('/subcontracts/' + row.id, v);
      else await POST('/subcontracts', { ...v, project_id: pid });
      UI.toast('已儲存'); done();
    }
  });
}

async function subDetail(id, done) {
  const s = await GET('/subcontracts/' + id);
  const dedu = await GET(`/subcontracts/${id}/deductions`).catch(() => []);
  const m = UI.modal({
    title: `${s.vendor_name || '發包單'} — ${s.no}`, wide: true, hideFooter: true,
    body: `<div id="sb-body">
      <div class="stat-grid small">
        ${stat(money(s.amount), '發包總價')}
        ${stat(money(s.valued), '累計估驗', '', '', `完成 ${s.cum_progress}%`)}
        ${stat(money(s.paid), '已付', 'ok')}
        ${stat(money(s.unpaid), '已確認待付', s.unpaid ? 'warn' : '')}
        ${stat(money(s.retention_held), '押著保留款')}
        ${stat(money(s.warranty_held), '押著保固金')}
      </div>
      <div class="card">
        <div class="card-head"><h4>發包明細</h4>
          <span><button class="btn tiny" id="si-add">新增項目</button>
          ${s.items.length ? '' : '<button class="btn tiny secondary" id="si-amt">直接輸入總價</button>'}</span></div>
        ${UI.table(['項目', '單位', '數量', '單價', '金額', ''], s.items.map(i => `<tr>
          <td>${UI.esc(i.name)}<div class="muted">${UI.esc(i.spec || '')}</div></td>
          <td>${UI.esc(i.unit)}</td><td class="num">${i.qty}</td>
          <td class="num">${money(i.unit_price)}</td><td class="num">${money(i.amount)}</td>
          <td><button class="btn tiny secondary" data-sidel="${i.id}">刪</button></td></tr>`),
      '沒有明細，總價直接輸入（小工程常見）')}
      </div>
      <div class="card">
        <div class="card-head"><h4>估驗計價</h4><button class="btn tiny" id="va-add">新增一期估驗</button></div>
        ${UI.table(['期別', '日期', '累計％', '本期估驗', '保留款', '保固金', '其他扣款', '實付', '狀態', ''],
        s.valuations.map(v => `<tr>
          <td>${UI.esc(v.period)}</td><td class="nowrap">${UI.date(v.date)}</td>
          <td class="num">${v.cum_progress}%</td><td class="num">${money(v.gross_amount)}</td>
          <td class="num muted">-${money(v.retention)}</td><td class="num muted">-${money(v.warranty_hold)}</td>
          <td class="num muted">${v.deduction ? '-' + money(v.deduction) : '—'}
            ${v.deduct_note ? `<div class="muted">${UI.esc(v.deduct_note)}</div>` : ''}</td>
          <td class="num"><strong>${money(v.net_amount)}</strong></td>
          <td>${UI.tag(twText(TW.val_status, v.status), v.status === 'paid' ? 'ok' : 'warn')}</td>
          <td class="nowrap">${v.status === 'confirmed' ? `<button class="btn tiny" data-vapay="${v.id}">付款</button>` : ''}
            ${v.status !== 'paid' ? `<button class="btn tiny secondary" data-vadel="${v.id}">刪</button>` : ''}</td>
        </tr>`), '還沒有估驗紀錄')}
      </div>
      <div class="card">
        <div class="card-head"><h4>保留款／保固金退還</h4>
          <span><button class="btn tiny secondary" data-rel="retention">退保留款</button>
          <button class="btn tiny secondary" data-rel="warranty">退保固金</button></span></div>
        ${UI.table(['日期', '種類', '金額', '備註'], s.releases.map(r => `<tr>
          <td class="nowrap">${UI.date(r.date)}</td><td>${twText(TW.release_kind, r.kind)}</td>
          <td class="num">${money(r.amount)}</td><td class="muted">${UI.esc(r.note || '')}</td></tr>`), '還沒有退款紀錄')}
      </div>
    </div>`
  });

  const bd = m.body;
  const refresh = () => { m.close(); done(); };
  bd.querySelector('#si-add').onclick = () => UI.modal({
    title: '新增發包明細',
    body: `<div class="form-grid">
      ${UI.input('name', '項目', { required: true })}${UI.input('spec', '規格')}
      ${UI.input('unit', '單位', { value: '式' })}${UI.input('qty', '數量', { type: 'number', step: '0.01', value: 1 })}
      ${UI.input('unit_price', '單價', { type: 'number' })}</div>`,
    onSubmit: async el => { await POST(`/subcontracts/${id}/items`, UI.formData(el)); refresh(); }
  });
  bd.querySelector('#si-amt') && (bd.querySelector('#si-amt').onclick = () => UI.modal({
    title: '直接輸入發包總價',
    body: `<div class="form-grid">${UI.input('amount', '發包總價', { type: 'number', value: s.amount })}</div>`,
    onSubmit: async el => { await PUT(`/subcontracts/${id}/amount`, UI.formData(el)); refresh(); }
  }));
  bd.querySelectorAll('[data-sidel]').forEach(b => b.onclick = async () => {
    await DEL('/sub-items/' + b.dataset.sidel); refresh();
  });
  bd.querySelector('#va-add').onclick = () => UI.modal({
    title: '估驗計價', wide: true,
    body: `<p>填<b>累計</b>完成％（不是本期）。目前累計 ${s.cum_progress}%，已估驗 ${money(s.valued)}。</p>
      <div class="form-grid">
        ${UI.input('period', '期別', { value: UI.thisMonth() })}
        ${UI.input('date', '估驗日', { type: 'date', value: UI.today() })}
        ${UI.input('cum_progress', '累計完成％', { type: 'number', step: '0.1', value: s.cum_progress })}
        ${UI.input('deduction', '其他扣款', { type: 'number', value: 0 })}
        ${UI.input('deduct_note', '扣款說明', { full: true })}
        ${dedu.length ? UI.checkList('defect_ids', '一併扣回的缺失求償',
      dedu.map(x => [x.id, `${x.location}${x.item}　${money(x.cost)}`]),
      { hint: '勾選的缺失金額會加進本期扣款，而且不會被重複扣第二次。' }) : ''}
        ${UI.textarea('note', '備註')}
      </div>
      <div class="muted">保留款 ${s.retention_pct}%、保固金 ${s.warranty_pct}% 會自動從本期估驗扣下。</div>`,
    onSubmit: async el => {
      const r = await POST(`/subcontracts/${id}/valuations`, UI.formData(el));
      UI.toast(`本期估驗 ${money(r.gross)}，實付 ${money(r.net)}`);
      refresh();
    }
  });
  bd.querySelectorAll('[data-vapay]').forEach(b => b.onclick = async () => {
    await POST(`/valuations/${b.dataset.vapay}/pay`, { paid_date: UI.today() });
    UI.toast('已登錄付款'); refresh();
  });
  bd.querySelectorAll('[data-vadel]').forEach(b => b.onclick = async () => {
    if (!await UI.confirm('確定刪除這期估驗？')) return;
    try { await DEL('/valuations/' + b.dataset.vadel); refresh(); } catch (e) { UI.err(e); }
  });
  bd.querySelectorAll('[data-rel]').forEach(b => b.onclick = () => {
    const kind = b.dataset.rel;
    const held = kind === 'warranty' ? s.warranty_held : s.retention_held;
    UI.modal({
      title: kind === 'warranty' ? '退還保固保證金' : '退還估驗保留款',
      body: `<p>目前押著 <b>${money(held)}</b>。</p><div class="form-grid">
        ${UI.input('amount', '退還金額', { type: 'number', value: held })}
        ${UI.input('date', '退款日', { type: 'date', value: UI.today() })}
        ${UI.textarea('note', '備註')}</div>`,
      onSubmit: async el => {
        const v = { ...UI.formData(el), kind };
        try { await POST(`/subcontracts/${id}/release`, v); }
        catch (e) {
          if (!/缺失沒改善完/.test(e.message)) throw e;
          if (!await UI.confirm(e.message)) return false;
          await POST(`/subcontracts/${id}/release`, { ...v, force: 1 });
        }
        UI.toast('已退款'); refresh();
      }
    });
  });
}

// ============ 建材訂料 ============

TABS.materials = d => `
  <div class="card">
    <div class="card-head"><h3>建材訂料</h3><button class="btn small" id="mt-add">新增訂料</button></div>
    <div class="notice">料的交期晚於現場需要日，就是工班撲空、工資白付。這裡把訂料綁在工序上，會不會來不及一眼看得到。</div>
    ${UI.table(['品項', '廠商', '對應工序', '現場需要', '交期', '金額', '狀態', ''], d.materials.map(r => {
  const late = r.eta_date && r.need_date && r.eta_date > r.need_date;
  return `<tr>
      <td><strong>${UI.esc(r.name)}</strong><div class="muted">${UI.esc(r.spec || '')}</div></td>
      <td>${UI.esc(r.vendor_name || '—')}</td>
      <td class="muted">${UI.esc(r.schedule_name || '—')}</td>
      <td class="nowrap">${UI.date(r.need_date)}</td>
      <td class="nowrap ${late ? 'danger' : ''}">${UI.date(r.eta_date)}
        ${late ? `<div class="danger">晚 ${Math.round((new Date(r.eta_date) - new Date(r.need_date)) / 86400000)} 天</div>` : ''}</td>
      <td class="num">${money(r.amount)}</td>
      <td>${UI.tag(twText(TW.material_status, r.status), r.status === 'arrived' || r.status === 'installed' ? 'ok' : late ? 'danger' : '')}</td>
      <td class="nowrap"><button class="btn tiny secondary" data-mtedit="${r.id}">編輯</button>
        <button class="btn tiny secondary" data-mtdel="${r.id}">刪除</button></td></tr>`;
}), '還沒有訂料紀錄')}
  </div>`;

TABBIND.materials = (el, d, reload) => {
  el.querySelector('#mt-add').onclick = () => materialDialog(d.project.id, null, d.schedule, reload);
  el.querySelectorAll('[data-mtedit]').forEach(b => b.onclick = () =>
    materialDialog(d.project.id, d.materials.find(x => String(x.id) === b.dataset.mtedit), d.schedule, reload));
  el.querySelectorAll('[data-mtdel]').forEach(b => b.onclick = async () => {
    if (!await UI.confirm('確定刪除這筆訂料？')) return;
    await DEL('/materials/' + b.dataset.mtdel); reload();
  });
};

function materialDialog(pid, row, schedule, done) {
  const items = [['', '不綁工序']].concat((schedule || []).map(s => [s.id, `${s.name}（${s.planned_start}）`]));
  UI.modal({
    title: row ? '編輯訂料' : '新增訂料',
    body: `<div class="form-grid">
      ${UI.input('name', '品項', { value: row ? row.name : '', required: true })}
      ${UI.input('spec', '規格／型號', { value: row ? row.spec : '' })}
      ${UI.select('vendor_id', '廠商', App.vendorOptions(false), { value: row ? row.vendor_id : '' })}
      ${UI.select('schedule_item_id', '對應工序', items, { value: row ? row.schedule_item_id : '' })}
      ${UI.input('qty', '數量', { type: 'number', step: '0.01', value: row ? row.qty : 1 })}
      ${UI.input('unit', '單位', { value: row ? row.unit : '式' })}
      ${UI.input('unit_price', '單價', { type: 'number', value: row ? row.unit_price : '' })}
      ${UI.input('need_date', '現場需要日', { type: 'date', value: row ? row.need_date : '' })}
      ${UI.input('order_date', '下單日', { type: 'date', value: row ? row.order_date : '' })}
      ${UI.input('eta_date', '廠商回覆交期', { type: 'date', value: row ? row.eta_date : '' })}
      ${UI.input('arrived_date', '實際到貨日', { type: 'date', value: row ? row.arrived_date : '' })}
      ${UI.select('status', '狀態', twOpts(TW.material_status), { value: row ? row.status : 'planned' })}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) await PUT('/materials/' + row.id, v);
      else await POST('/materials', { ...v, project_id: pid });
      UI.toast('已儲存'); done();
    }
  });
}

// ============ 日報與照片 ============

TABS.site = d => `
  <div class="card">
    <div class="card-head"><h3>工地日報</h3><button class="btn small" id="lg-add">填今日日報</button></div>
    ${UI.table(['日期', '天氣', '出工', '工種', '進度', '狀況', '照片'], d.logs.map(l => `<tr>
      <td class="nowrap">${UI.date(l.date)}</td><td>${UI.esc(l.weather || '—')}</td>
      <td class="num">${l.workers || '—'}</td><td class="muted">${UI.esc(l.trades || '')}</td>
      <td>${UI.esc(l.progress_note || '')}</td>
      <td class="${l.issue_note ? 'warn' : 'muted'}">${UI.esc(l.issue_note || '')}</td>
      <td class="num">${l.photo_count || 0}</td>
    </tr>`), '還沒有日報')}
  </div>
  <div class="card">
    <div class="card-head"><h3>現場照片（最近 60 張）</h3><button class="btn small" id="ph-add">上傳照片</button></div>
    <div class="notice">封板前的水電照、拆除前的原況照，日後爭議時「有沒有拍」決定的是幾萬到幾十萬的責任歸屬。</div>
    ${d.photos.length ? `<div class="photo-grid">${d.photos.map(p => `<figure>
      <a href="${UI.esc(p.url)}" target="_blank" rel="noopener"><img src="${UI.esc(p.url)}" loading="lazy" alt=""></a>
      <figcaption>${UI.tag(twText(TW.photo_phase, p.phase), p.phase === 'defect' ? 'danger' : '')}
        ${UI.esc(p.taken_date)}<div>${UI.esc(p.caption || '')}</div>
        ${p.client_visible ? '' : '<div class="muted">（不給業主看）</div>'}
        <button class="btn tiny secondary" data-phdel="${p.id}">刪除</button></figcaption>
    </figure>`).join('')}</div>` : '<div class="empty">還沒有照片</div>'}
  </div>`;

TABBIND.site = (el, d, reload) => {
  const pid = d.project.id;
  el.querySelector('#lg-add').onclick = () => UI.modal({
    title: '工地日報',
    body: `<div class="form-grid">
      ${UI.input('date', '日期', { type: 'date', value: UI.today() })}
      ${UI.input('weather', '天氣', { value: '晴' })}
      ${UI.input('workers', '出工人數', { type: 'number' })}
      ${UI.checkList('trades', '今日進場工種', App.listOptions('trades'))}
      ${UI.textarea('progress_note', '今日進度')}
      ${UI.textarea('issue_note', '現場狀況／問題')}
    </div>`,
    onSubmit: async bd => {
      await POST('/site-logs', { ...UI.formData(bd), project_id: pid });
      UI.toast('已儲存'); reload();
    }
  });
  el.querySelector('#ph-add').onclick = () => UI.modal({
    title: '上傳現場照片',
    body: `<div class="form-grid">
      <div class="form-row full"><label>選擇照片（可多選）</label><input type="file" id="ph-files" accept="image/*" multiple></div>
      ${UI.select('phase', '階段', twOpts(TW.photo_phase), { value: 'during' })}
      ${UI.select('schedule_item_id', '對應工序', [['', '不指定']].concat(d.schedule.map(s => [s.id, s.name])))}
      ${UI.input('taken_date', '拍攝日期', { type: 'date', value: UI.today() })}
      ${UI.input('caption', '說明', { full: true })}
      ${UI.checkbox('client_visible', '業主端看得到', true, { full: true })}
    </div>`,
    onSubmit: async bd => {
      const files = bd.querySelector('#ph-files').files;
      if (!files.length) { UI.toast('請選擇照片', true); return false; }
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const v = UI.formData(bd);
      for (const [k, val] of Object.entries(v)) fd.append(k, val);
      fd.append('project_id', pid);
      await api('/photos', { method: 'POST', body: fd });
      UI.toast(`已上傳 ${files.length} 張`); reload();
    }
  });
  el.querySelectorAll('[data-phdel]').forEach(b => b.onclick = async () => {
    if (!await UI.confirm('確定刪除這張照片？')) return;
    await DEL('/photos/' + b.dataset.phdel); reload();
  });
};

// ============ 缺失與保固 ============

TABS.quality = d => `
  <div class="card">
    <div class="card-head"><h3>缺失改善</h3><button class="btn small" id="df-add">新增缺失</button></div>
    ${UI.table(['單號', '位置／項目', '來源', '責任工班', '要求改善', '狀態', '求償', ''], d.defects.map(r => `<tr>
      <td>${UI.esc(r.no)}</td>
      <td><strong>${UI.esc(r.location)}${UI.esc(r.item)}</strong>
        <div class="muted">${UI.esc(r.description || '')}</div></td>
      <td>${twText(TW.defect_source, r.source)}</td>
      <td>${UI.esc(r.vendor_name || '—')}</td>
      <td class="nowrap ${r.overdue ? 'danger' : ''}">${UI.date(r.due_date)}</td>
      <td>${UI.tag(twText(TW.defect_status, r.status),
  r.status === 'verified' ? 'ok' : r.status === 'open' ? 'danger' : 'warn')}</td>
      <td class="num">${r.charge_vendor ? money(r.cost) : '—'}
        ${r.deducted_valuation_id ? '<div class="muted">已於估驗扣回</div>' : ''}</td>
      <td class="nowrap"><button class="btn tiny secondary" data-dfedit="${r.id}">編輯</button></td>
    </tr>`), '目前沒有缺失紀錄')}
  </div>
  <div class="card">
    <div class="card-head"><h3>保固</h3><button class="btn small" id="wr-add">新增保固項目</button></div>
    ${UI.table(['項目', '負責工班', '起始', '月數', '到期', ''], d.warranties.map(w => `<tr>
      <td>${UI.esc(w.item)}</td><td>${UI.esc(w.vendor_name || '—')}</td>
      <td class="nowrap">${UI.date(w.start_date)}</td><td class="num">${w.months}</td>
      <td class="nowrap ${w.end_date && w.end_date < UI.today() ? 'muted' : ''}">${UI.date(w.end_date)}</td>
      <td class="nowrap"><button class="btn tiny secondary" data-wredit="${w.id}">編輯</button>
        <button class="btn tiny" data-wrrep="${w.id}">報修</button></td>
    </tr>`), '還沒有保固項目。交屋日填好之後，這裡建立的保固會自動從交屋日起算。')}
  </div>`;

TABBIND.quality = (el, d, reload) => {
  const pid = d.project.id;
  el.querySelector('#df-add').onclick = () => defectDialog(pid, null, reload);
  el.querySelectorAll('[data-dfedit]').forEach(b => b.onclick = () =>
    defectDialog(pid, d.defects.find(x => String(x.id) === b.dataset.dfedit), reload));
  el.querySelector('#wr-add').onclick = () => warrantyDialog(pid, null, reload);
  el.querySelectorAll('[data-wredit]').forEach(b => b.onclick = () =>
    warrantyDialog(pid, d.warranties.find(x => String(x.id) === b.dataset.wredit), reload));
  el.querySelectorAll('[data-wrrep]').forEach(b => b.onclick = () => {
    const w = d.warranties.find(x => String(x.id) === b.dataset.wrrep);
    UI.modal({
      title: `保固報修 — ${w.item}`,
      body: `<div class="form-grid">
        ${UI.input('location', '位置')}${UI.input('item', '項目', { value: w.item })}
        ${UI.textarea('description', '狀況描述')}
        ${UI.input('due_date', '約定處理日', { type: 'date' })}
        ${UI.select('severity', '嚴重度', twOpts(TW.severity), { value: 'normal' })}</div>`,
      onSubmit: async bd => {
        const r = await POST(`/warranties/${w.id}/report`, UI.formData(bd));
        UI.toast(r.expired ? '已建立報修單（注意：此項保固已過期）' : '已建立報修單');
        reload();
      }
    });
  });
};

function defectDialog(pid, row, done) {
  UI.modal({
    title: row ? `缺失 ${row.no}` : '新增缺失', wide: true,
    body: `<div class="form-grid">
      ${UI.input('location', '位置', { value: row ? row.location : '', placeholder: '例：主臥' })}
      ${UI.input('item', '缺失項目', { value: row ? row.item : '', required: true })}
      ${UI.textarea('description', '狀況描述', { value: row ? row.description : '' })}
      ${UI.select('source', '來源', twOpts(TW.defect_source), { value: row ? row.source : 'self' })}
      ${UI.select('vendor_id', '責任工班', App.vendorOptions(false), { value: row ? row.vendor_id : '' })}
      ${UI.select('owner_id', '追蹤人', App.staffOptions(false), { value: row ? row.owner_id : '' })}
      ${UI.select('severity', '嚴重度', twOpts(TW.severity), { value: row ? row.severity : 'normal' })}
      ${UI.input('found_date', '發現日', { type: 'date', value: row ? row.found_date : UI.today() })}
      ${UI.input('due_date', '要求改善日', { type: 'date', value: row ? row.due_date : '' })}
      ${UI.input('fixed_date', '完成改善日', { type: 'date', value: row ? row.fixed_date : '' })}
      ${UI.input('verified_date', '複驗通過日', { type: 'date', value: row ? row.verified_date : '' })}
      ${UI.select('status', '狀態', twOpts(TW.defect_status), { value: row ? row.status : 'open' })}
      ${UI.input('cost', '改善成本', { type: 'number', value: row ? row.cost : 0 })}
      ${UI.checkbox('charge_vendor', '向工班求償（估驗時可一併扣款）', row ? row.charge_vendor : 0)}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) await PUT('/defects/' + row.id, v);
      else await POST('/defects', { ...v, project_id: pid });
      UI.toast('已儲存'); done();
    }
  });
}

function warrantyDialog(pid, row, done) {
  UI.modal({
    title: row ? '編輯保固' : '新增保固項目',
    body: `<div class="form-grid">
      ${UI.input('item', '保固項目', { value: row ? row.item : '', required: true, placeholder: '例：防水工程' })}
      ${UI.select('vendor_id', '負責工班', App.vendorOptions(false), { value: row ? row.vendor_id : '' })}
      ${UI.input('start_date', '起算日（留空＝用交屋日）', { type: 'date', value: row ? row.start_date : '' })}
      ${UI.input('months', '保固月數', { type: 'number', value: row ? row.months : 12 })}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) await PUT('/warranties/' + row.id, v);
      else await POST('/warranties', { ...v, project_id: pid });
      UI.toast('已儲存'); done();
    }
  });
}

// ============ 圖面與許可 ============

TABS.docs = d => `
  <div class="card">
    <div class="card-head"><h3>圖面版本</h3><button class="btn small" id="dw-add">上傳新版圖面</button></div>
    <div class="notice">同一張圖只會有一個「現行版本」。工班拿舊圖施工是最貴的錯誤之一，發布時間與發給誰都會留紀錄。</div>
    ${UI.table(['圖面', '版次', '現行', '發布', '業主可見', ''], d.drawings.map(w => `<tr>
      <td>${UI.esc(w.name)}<div class="muted">${UI.esc(w.category || '')}</div></td>
      <td>${UI.esc(w.version)}</td>
      <td>${w.is_current ? UI.tag('現行版', 'ok') : '<span class="muted">舊版</span>'}</td>
      <td class="muted">${w.released_at ? `${UI.esc(w.released_at)}<div>給 ${UI.esc(w.released_to || '—')}</div>` : '未發布'}</td>
      <td>${w.client_visible ? '是' : '否'}</td>
      <td class="nowrap"><a class="btn tiny secondary" href="${UI.esc(w.url)}" target="_blank" rel="noopener">開啟</a>
        <button class="btn tiny" data-dwrel="${w.id}">發布</button>
        <button class="btn tiny secondary" data-dwdel="${w.id}">刪除</button></td>
    </tr>`), '還沒有圖面')}
  </div>
  <div class="card">
    <div class="card-head"><h3>許可與法規</h3><button class="btn small" id="pm-add">新增申辦案件</button></div>
    ${UI.table(['項目', '主管機關', '文號', '申請／核准', '有效期限', '狀態', ''], d.permits.map(r => `<tr>
      <td>${UI.esc(r.kind)}</td><td>${UI.esc(r.agency || '—')}</td><td class="muted">${UI.esc(r.doc_no || '')}</td>
      <td class="nowrap muted">${r.applied_date || '—'} / ${r.approved_date || '—'}</td>
      <td class="nowrap ${r.expiry_date && r.expiry_date < UI.today() ? 'danger' : ''}">${UI.date(r.expiry_date)}</td>
      <td>${UI.tag(twText(TW.permit_status, r.status), r.status === 'approved' ? 'ok' : r.status === 'todo' ? 'warn' : '')}</td>
      <td class="nowrap"><button class="btn tiny secondary" data-pmedit="${r.id}">編輯</button>
        <button class="btn tiny secondary" data-pmdel="${r.id}">刪除</button></td>
    </tr>`), '還沒有申辦案件')}
  </div>`;

TABBIND.docs = (el, d, reload) => {
  const pid = d.project.id;
  el.querySelector('#dw-add').onclick = () => UI.modal({
    title: '上傳圖面',
    body: `<div class="form-grid">
      ${UI.input('name', '圖面名稱', { required: true, placeholder: '例：平面配置圖' })}
      ${UI.input('category', '分類', { placeholder: '例：施工圖' })}
      ${UI.input('version', '版次（留空自動遞增）')}
      <div class="form-row full"><label>檔案（圖片或 PDF）</label><input type="file" id="dw-file" accept="image/*,.pdf"></div>
      ${UI.checkbox('client_visible', '業主端看得到', 0, { full: true })}
      ${UI.textarea('note', '備註')}
    </div>`,
    onSubmit: async bd => {
      const f = bd.querySelector('#dw-file').files[0];
      if (!f) { UI.toast('請選擇檔案', true); return false; }
      const fd = new FormData();
      fd.append('file', f);
      for (const [k, v] of Object.entries(UI.formData(bd))) fd.append(k, v);
      fd.append('project_id', pid);
      const r = await api('/drawings', { method: 'POST', body: fd });
      UI.toast(`已上傳 ${r.version}`); reload();
    }
  });
  el.querySelectorAll('[data-dwrel]').forEach(b => b.onclick = () => UI.modal({
    title: '發布圖面給工班',
    body: `<div class="form-grid">${UI.input('released_to', '發給哪些工班', { full: true, placeholder: '例：木作、水電' })}</div>`,
    onSubmit: async bd => { await POST(`/drawings/${b.dataset.dwrel}/release`, UI.formData(bd)); UI.toast('已記錄發布'); reload(); }
  }));
  el.querySelectorAll('[data-dwdel]').forEach(b => b.onclick = async () => {
    if (!await UI.confirm('確定刪除這個版本？')) return;
    await DEL('/drawings/' + b.dataset.dwdel); reload();
  });
  el.querySelector('#pm-add').onclick = () => permitDialog(pid, null, reload);
  el.querySelectorAll('[data-pmedit]').forEach(b => b.onclick = () =>
    permitDialog(pid, d.permits.find(x => String(x.id) === b.dataset.pmedit), reload));
  el.querySelectorAll('[data-pmdel]').forEach(b => b.onclick = async () => {
    if (!await UI.confirm('確定刪除？')) return;
    await DEL('/permits/' + b.dataset.pmdel); reload();
  });
};

function permitDialog(pid, row, done) {
  UI.modal({
    title: row ? '編輯申辦案件' : '新增申辦案件',
    body: `<div class="form-grid">
      ${UI.select('kind', '申辦項目', App.listOptions('permit_kinds'), { value: row ? row.kind : '' })}
      ${UI.input('agency', '主管機關', { value: row ? row.agency : '' })}
      ${UI.input('doc_no', '文號', { value: row ? row.doc_no : '' })}
      ${UI.input('applied_date', '申請日', { type: 'date', value: row ? row.applied_date : '' })}
      ${UI.input('approved_date', '核准日', { type: 'date', value: row ? row.approved_date : '' })}
      ${UI.input('expiry_date', '有效期限', { type: 'date', value: row ? row.expiry_date : '' })}
      ${UI.select('owner_id', '承辦人', App.staffOptions(false), { value: row ? row.owner_id : '' })}
      ${UI.select('status', '狀態', twOpts(TW.permit_status), { value: row ? row.status : 'todo' })}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) await PUT('/permits/' + row.id, v);
      else await POST('/permits', { ...v, project_id: pid });
      UI.toast('已儲存'); done();
    }
  });
}

// ============ 成本與雜支 ============

TABS.cost = d => {
  const m = d.money;
  return `
  <div class="card">
    <h3>成本組成</h3>
    <div class="stat-grid">
      ${stat(money(m.sub_committed), '已發包', '', '', `其中草稿未發包 ${UI.fmtShort(m.sub_draft)}`)}
      ${stat(money(m.material_cost), '建材訂料')}
      ${stat(money(m.expense_cost), '專案雜支')}
      ${stat(money(m.cost_committed), '合計已發生成本')}
      ${stat(money(m.quoted_cost), '當初估價的成本', '', '', '成交那一版估價單')}
      ${stat(UI.fmtDelta(m.cost_variance), '超出估價', m.cost_variance > 0 ? 'danger' : 'ok')}
    </div>
    <div class="stat-grid">
      ${stat(money(m.sub_valued), '已估驗')}
      ${stat(money(m.sub_paid), '已付工班', 'ok')}
      ${stat(money(m.sub_unpaid), '已確認待付', m.sub_unpaid ? 'warn' : '')}
      ${stat(money(m.retention_held), '押著保留款')}
      ${stat(money(m.warranty_held), '押著保固金')}
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h3>專案雜支</h3><button class="btn small" id="ex-add">新增雜支</button></div>
    <div class="muted">不走發包的成本：規費、吊車、垃圾清運、保險、現場雜項。這些加起來常常吃掉一兩個百分點的毛利。</div>
    ${UI.table(['日期', '科目', '項目', '廠商', '金額', '發票', ''], d.expenses.map(e => `<tr>
      <td class="nowrap">${UI.date(e.date)}</td><td>${UI.esc(e.category)}</td>
      <td>${UI.esc(e.item)}</td><td class="muted">${UI.esc(e.vendor_name || '')}</td>
      <td class="num">${money(e.amount)}</td><td class="muted">${UI.esc(e.invoice_no || '')}</td>
      <td class="nowrap"><button class="btn tiny secondary" data-exedit="${e.id}">編輯</button>
        <button class="btn tiny secondary" data-exdel="${e.id}">刪除</button></td>
    </tr>`), '還沒有雜支')}
  </div>`;
};

TABBIND.cost = (el, d, reload) => {
  const pid = d.project.id;
  const dlg = row => UI.modal({
    title: row ? '編輯雜支' : '新增雜支',
    body: `<div class="form-grid">
      ${UI.input('date', '日期', { type: 'date', value: row ? row.date : UI.today() })}
      ${UI.select('category', '科目', App.listOptions('expense_categories'), { value: row ? row.category : '' })}
      ${UI.input('item', '項目', { value: row ? row.item : '' })}
      ${UI.select('vendor_id', '廠商', App.vendorOptions(false), { value: row ? row.vendor_id : '' })}
      ${UI.input('amount', '金額', { type: 'number', value: row ? row.amount : '' })}
      ${UI.input('invoice_no', '發票／單據號', { value: row ? row.invoice_no : '' })}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async bd => {
      const v = UI.formData(bd);
      if (row) await PUT('/project-expenses/' + row.id, v);
      else await POST('/project-expenses', { ...v, project_id: pid });
      UI.toast('已儲存'); reload();
    }
  });
  el.querySelector('#ex-add').onclick = () => dlg(null);
  el.querySelectorAll('[data-exedit]').forEach(b => b.onclick = () =>
    dlg(d.expenses.find(x => String(x.id) === b.dataset.exedit)));
  el.querySelectorAll('[data-exdel]').forEach(b => b.onclick = async () => {
    if (!await UI.confirm('確定刪除？')) return;
    await DEL('/project-expenses/' + b.dataset.exdel); reload();
  });
};
