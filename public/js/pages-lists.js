// 跨案清單：工班廠商、建材交期、缺失、保固、許可

App.page('vendors', {
  title: '工班與廠商',
  sub: '工種、評價、保險到期、在手缺失',
  module: 'vendors',
  help: {
    intro: '派工前要知道三件事：這家做什麼、做得好不好、保險有沒有過期。保險過期的工班在現場出事，責任會回到公司身上。',
    steps: ['新增廠商 → 選工種與類型（工班／材料商／兩者都是）。',
      '責任險到期日一定要填，過期的會在清單上標紅。',
      '每次合作完更新評價，下次發包時這一欄就有用了。',
      '「請款身分」選個人的工班，估驗付款與退保留款時會自動算出代扣所得稅、二代健保補充保費與實際匯款金額。'],
    notes: ['「在手缺失」是這家工班還沒改善完的缺失件數，發包前先看一眼。']
  },
  async render(el) {
    const state = { trade: '', kind: '', q: '' };
    const bar = App.filterBar([
      { name: 'trade', label: '工種', type: 'select', options: [['', '全部工種']].concat(App.listOptions('trades')) },
      { name: 'kind', label: '類型', type: 'select', options: [['', '全部']].concat(twOpts(TW.vendor_kind)) },
      { name: 'q', label: '搜尋', placeholder: '名稱／聯絡人／電話' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const act = document.createElement('div');
    act.className = 'actions';
    act.innerHTML = '<button class="btn" id="add">新增廠商</button>' + UI.csvBtn('vendors');
    el.appendChild(act);
    const box = document.createElement('div');
    el.appendChild(box);

    const load = async () => {
      const rows = await GET('/vendors' + App.qs(state));
      App.vendors = rows.filter(r => r.active);
      // 沒統編又標成公司行號的工班，多半其實是個人：沒改的話付款時不會代扣所得稅與補充保費
      const maybeInd = rows.filter(r => r.active && r.kind !== 'supplier' && !r.tax_id && r.payee_type !== 'individual');
      box.innerHTML = (maybeInd.length ? `<div class="notice warn">有 ${maybeInd.length} 家工班沒填統編，請款身分卻是「公司行號」：
        ${UI.esc(maybeInd.slice(0, 5).map(r => r.name).join('、'))}${maybeInd.length > 5 ? ' 等' : ''}。
        是個人的請按「編輯」改成「個人」，付款時才會代扣所得稅與補充保費；是公司的請補上統編。</div>` : '')
        + UI.table(['名稱', '類型／工種', '聯絡', '評價', '責任險到期', '承接', '在手缺失', ''],
        rows.map(r => `<tr class="${r.active ? '' : 'dim'}">
        <td><strong>${UI.esc(r.name)}</strong>${r.tax_id ? `<div class="muted">統編 ${UI.esc(r.tax_id)}</div>` : ''}</td>
        <td>${twText(TW.vendor_kind, r.kind)}<div class="muted">${UI.esc(r.trade || '')}</div>
          ${r.payee_type === 'individual' ? '<div class="muted">個人・付款代扣</div>' : ''}</td>
        <td>${UI.esc(r.contact || '')}<div class="muted">${UI.esc(r.phone || '')}</div></td>
        <td>${r.rating ? '★'.repeat(r.rating) : '—'}</td>
        <td class="nowrap ${r.insurance_expired ? 'danger' : ''}">${UI.date(r.liability_expiry)}
          ${r.insurance_expired ? '<div class="danger">已過期</div>' : ''}
          ${r.labor_insured ? '' : '<div class="muted">未投保勞保</div>'}</td>
        <td class="num">${r.job_count} 張<div class="muted">${UI.fmtShort(r.job_amount)}</div></td>
        <td class="num ${r.open_defects ? 'warn' : ''}">${r.open_defects || '—'}</td>
        <td class="nowrap"><button class="btn tiny secondary" data-edit="${r.id}">編輯</button>
          <button class="btn tiny secondary" data-del="${r.id}">刪除</button></td>
      </tr>`), '還沒有廠商資料');
      UI.bindCsv(act, 'vendors', '工班與廠商', [
        ['名稱', r => r.name], ['類型', r => twText(TW.vendor_kind, r.kind)], ['工種', r => r.trade],
        ['聯絡人', r => r.contact], ['電話', r => r.phone], ['統一編號', r => r.tax_id],
        ['請款身分', r => r.payee_type === 'individual' ? '個人' : '公司行號'],
        ['匯款帳戶', r => r.bank_info], ['評價', r => r.rating],
        ['責任險到期', r => r.liability_expiry], ['責任險已過期', r => r.insurance_expired ? '是' : ''],
        ['勞保', r => r.labor_insured ? '已投保' : '未投保'],
        ['承接張數', r => r.job_count], ['承接金額', r => r.job_amount],
        ['在手缺失', r => r.open_defects], ['狀態', r => r.active ? '啟用' : '停用'], ['備註', r => r.note]
      ], rows);
      box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
        vendorDialog(rows.find(x => String(x.id) === b.dataset.edit), load));
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!await UI.confirm('確定刪除？')) return;
        try { await DEL('/vendors/' + b.dataset.del); load(); } catch (e) { UI.err(e); }
      });
    };
    act.querySelector('#add').onclick = () => vendorDialog(null, load);
    await load();
  }
});

function vendorDialog(row, done) {
  UI.modal({
    title: row ? '編輯廠商' : '新增廠商', wide: true,
    body: `<div class="form-grid">
      ${UI.input('name', '名稱', { value: row ? row.name : '', required: true })}
      ${UI.select('kind', '類型', twOpts(TW.vendor_kind), { value: row ? row.kind : 'sub' })}
      ${UI.select('trade', '工種', [['', '未選']].concat(App.listOptions('trades')), { value: row ? row.trade : '' })}
      ${UI.input('contact', '聯絡人', { value: row ? row.contact : '' })}
      ${UI.input('phone', '電話', { value: row ? row.phone : '' })}
      ${UI.input('tax_id', '統一編號', { value: row ? row.tax_id : '' })}
      ${UI.select('payee_type', '請款身分', twOpts(TW.payee_type), { value: row ? row.payee_type : 'company' })}
      ${UI.input('bank_info', '匯款帳戶', { value: row ? row.bank_info : '', full: true })}
      ${UI.input('rating', '評價（1-5）', { type: 'number', value: row ? row.rating : 0 })}
      ${UI.input('liability_expiry', '責任險到期日', { type: 'date', value: row ? row.liability_expiry : '' })}
      ${UI.checkbox('labor_insured', '已投保勞保／職災', row ? row.labor_insured : 0)}
      ${UI.checkbox('active', '啟用', row ? row.active : 1)}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) await PUT('/vendors/' + row.id, v); else await POST('/vendors', v);
      UI.toast('已儲存');
      App.vendors = await GET('/vendors?active=1').catch(() => App.vendors);
      done();
    }
  });
}

App.page('materials', {
  title: '建材訂料',
  sub: '交期晚於現場需要日＝工班撲空、工資白付',
  module: 'materials',
  help: {
    intro: '磁磚、廚具、系統櫃的交期才是真正卡住工進的東西。訂料綁在工序上，會不會來不及一眼看得到。',
    steps: ['新增訂料 → 填品項、廠商、金額，最重要的是「現場需要日」。',
      '綁上對應工序，工序日期一改，這筆料要不要提前就看得出來。',
      '下單後把廠商回覆的交期填進去；交期晚於現場需要日的會標紅並開待辦。'],
    notes: ['「有風險」只列兩種：廠商交期晚於現場需要日、需要日到了還沒下單。']
  },
  async render(el) {
    const state = { project_id: '', status: '', risk: '', q: '' };
    const bar = App.filterBar([
      { name: 'project_id', label: '案場', type: 'select', options: App.projectOptions(true) },
      { name: 'status', label: '狀態', type: 'select', options: [['', '全部']].concat(twOpts(TW.material_status)) },
      { name: 'risk', label: '只看有風險的', type: 'select', options: [['', '否'], ['1', '是']] },
      { name: 'q', label: '搜尋', placeholder: '品項／規格／廠商／案場' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const act = document.createElement('div');
    act.className = 'actions';
    act.innerHTML = '<button class="btn" id="add">新增訂料</button>' + UI.csvBtn('materials');
    el.appendChild(act);
    const box = document.createElement('div');
    el.appendChild(box);

    // 訂料要綁工序，而工序是跟著案子的 —— 開對話框前先把那個案子的工序撈回來
    const openDialog = async (pid, row) => {
      const schedule = await GET('/schedule?project_id=' + pid).catch(() => []);
      materialDialog(pid, row, schedule, load);
    };
    act.querySelector('#add').onclick = async () => {
      const pid = state.project_id || App.lastProject();
      if (!pid) { UI.toast('請先在上方選擇案場', true); return; }
      try { await openDialog(pid, null); } catch (e) { UI.err(e); }
    };

    const load = async () => {
      const rows = await GET('/materials' + App.qs(state));
      const risky = rows.filter(r => r.late_days > 0 || r.not_ordered);
      box.innerHTML = `
        ${risky.length ? `<div class="notice warn">有 ${risky.length} 項料會影響工進：交期晚於現場需要日，或需要日到了還沒下單。</div>` : ''}
        ${UI.table(['案場', '品項', '廠商', '對應工序', '現場需要', '交期／到貨', '金額', '狀態', ''], rows.map(r => `<tr>
          <td>${UI.esc(r.project_name)}<div class="muted">${UI.esc(r.project_code)}</div></td>
          <td><strong>${UI.esc(r.name)}</strong><div class="muted">${UI.esc(r.spec || '')}</div></td>
          <td>${UI.esc(r.vendor_name || '—')}</td>
          <td class="muted">${UI.esc(r.schedule_name || '—')}</td>
          <td class="nowrap ${r.not_ordered ? 'danger' : ''}">${UI.date(r.need_date)}
            ${r.not_ordered ? '<div class="danger">還沒下單</div>' : ''}</td>
          <td class="nowrap ${r.late_days ? 'danger' : ''}">${r.arrived_date || r.eta_date || '—'}
            ${r.late_days ? `<div class="danger">晚 ${r.late_days} 天</div>` : ''}</td>
          <td class="num">${UI.fmtMoney(r.amount)}</td>
          <td>${UI.tag(twText(TW.material_status, r.status),
        r.status === 'arrived' || r.status === 'installed' ? 'ok' : r.late_days ? 'danger' : '')}</td>
          <td class="nowrap"><button class="btn tiny secondary" data-edit="${r.id}">編輯</button>
            <button class="btn tiny secondary" data-del="${r.id}">刪除</button></td>
        </tr>`), '沒有訂料資料')}`;
      UI.bindCsv(act, 'materials', '建材訂料', [
        ['案場', r => r.project_name], ['案場代號', r => r.project_code],
        ['品項', r => r.name], ['規格', r => r.spec], ['廠商', r => r.vendor_name],
        ['對應工序', r => r.schedule_name], ['數量', r => r.qty], ['單位', r => r.unit],
        ['單價', r => r.unit_price], ['金額', r => r.amount],
        ['現場需要日', r => r.need_date], ['下單日', r => r.order_date],
        ['回覆交期', r => r.eta_date], ['到貨日', r => r.arrived_date],
        ['晚幾天', r => r.late_days || ''], ['還沒下單', r => r.not_ordered ? '是' : ''],
        ['狀態', r => twText(TW.material_status, r.status)], ['備註', r => r.note]
      ], rows);
      box.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
        const r = rows.find(x => String(x.id) === b.dataset.edit);
        try { await openDialog(r.project_id, r); } catch (e) { UI.err(e); }
      });
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!await UI.confirm('確定刪除這筆訂料？')) return;
        try { await DEL('/materials/' + b.dataset.del); load(); } catch (e) { UI.err(e); }
      });
    };
    await load();
  }
});

App.page('defects', {
  title: '缺失與驗收',
  sub: '點交那張紙，變成追得動的清單',
  module: 'defects',
  help: {
    intro: '點交當天列出來的三十幾項，沒有系統就是一張紙，改到哪一項沒人知道。這裡每一項都有責任工班、期限與複驗狀態。',
    steps: ['點交時逐項新增：位置、項目、責任工班、要求改善日。',
      '在缺失裡加照片 —— 點交當下拍一張，改善完再拍一張，複驗與求償靠的就是這兩張。',
      '要跟工班拿錢的勾「向工班求償」並填改善成本，下次估驗計價時可以直接勾選一併扣款。',
      '改善完成 → 複驗通過，狀態改掉才算結案。'],
    notes: ['勾了「向工班求償」的缺失，估驗計價時可以直接勾選一併扣款，而且不會被扣第二次。']
  },
  async render(el) {
    const state = { project_id: '', status: '', vendor_id: '', source: '', q: '' };
    const bar = App.filterBar([
      { name: 'project_id', label: '案場', type: 'select', options: App.projectOptions(true) },
      { name: 'status', label: '狀態', type: 'select', options: [['', '全部']].concat(twOpts(TW.defect_status)) },
      { name: 'source', label: '來源', type: 'select', options: [['', '全部']].concat(twOpts(TW.defect_source)) },
      { name: 'vendor_id', label: '責任工班', type: 'select', options: App.vendorOptions(true) },
      { name: 'q', label: '搜尋', placeholder: '單號／位置／項目／描述' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const act = document.createElement('div');
    act.className = 'actions';
    act.innerHTML = '<button class="btn" id="add">新增缺失</button>' + UI.csvBtn('defects');
    el.appendChild(act);
    const box = document.createElement('div');
    el.appendChild(box);

    const load = async () => {
      const rows = await GET('/defects' + App.qs(state));
      const open = rows.filter(r => r.status === 'open' || r.status === 'fixing');
      box.innerHTML = `
        <div class="stat-grid">
          ${stat(open.length, '待改善／改善中', open.length ? 'warn' : '')}
          ${stat(rows.filter(r => r.overdue).length, '已逾期', rows.filter(r => r.overdue).length ? 'danger' : '')}
          ${stat(rows.filter(r => r.status === 'fixed').length, '待複驗')}
          ${stat(UI.fmtMoney(rows.filter(r => r.charge_vendor).reduce((a, r) => a + r.cost, 0)), '應向工班求償')}
        </div>
        ${UI.table(['單號', '案場', '位置／項目', '來源', '責任工班', '要求改善', '狀態', '求償', ''], rows.map(r => `<tr>
          <td>${UI.esc(r.no)}</td>
          <td>${UI.esc(r.project_name)}<div class="muted">${UI.esc(r.project_code)}</div></td>
          <td><strong>${UI.esc(r.location)}${UI.esc(r.item)}</strong>
            <div class="muted">${UI.esc((r.description || '').slice(0, 50))}</div></td>
          <td>${twText(TW.defect_source, r.source)}</td>
          <td>${UI.esc(r.vendor_name || '—')}</td>
          <td class="nowrap ${r.overdue ? 'danger' : ''}">${UI.date(r.due_date)}</td>
          <td>${UI.tag(twText(TW.defect_status, r.status),
        r.status === 'verified' ? 'ok' : r.status === 'open' ? 'danger' : 'warn')}</td>
          <td class="num">${r.charge_vendor ? UI.fmtMoney(r.cost) : '—'}
            ${r.deducted_valuation_id ? '<div class="muted">已扣回</div>' : ''}</td>
          <td class="nowrap"><button class="btn tiny secondary" data-edit="${r.id}">編輯</button>
            <button class="btn tiny secondary" data-del="${r.id}">刪除</button></td>
        </tr>`), '目前沒有缺失')}`;
      UI.bindCsv(act, 'defects', '缺失清單', [
        ['單號', r => r.no], ['案場', r => r.project_name], ['案場代號', r => r.project_code],
        ['位置', r => r.location], ['項目', r => r.item], ['說明', r => r.description],
        ['來源', r => twText(TW.defect_source, r.source)], ['嚴重度', r => twText(TW.severity, r.severity)],
        ['責任工班', r => r.vendor_name], ['負責人', r => r.owner_name],
        ['發現日', r => r.found_date], ['要求改善日', r => r.due_date],
        ['完成日', r => r.fixed_date], ['複驗日', r => r.verified_date],
        ['逾期', r => r.overdue ? '是' : ''], ['狀態', r => twText(TW.defect_status, r.status)],
        ['求償金額', r => r.charge_vendor ? r.cost : ''],
        ['已於估驗扣回', r => r.deducted_valuation_id ? '是' : ''], ['備註', r => r.note]
      ], rows);
      box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
        const r = rows.find(x => String(x.id) === b.dataset.edit);
        defectDialog(r.project_id, r, load);
      });
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!await UI.confirm('確定刪除這筆缺失？已經扣回工班款的缺失不能刪。')) return;
        try { await DEL('/defects/' + b.dataset.del); load(); } catch (e) { UI.err(e); }
      });
    };
    act.querySelector('#add').onclick = () => {
      const pid = state.project_id || App.lastProject();
      if (!pid) { UI.toast('請先在上方選擇案場', true); return; }
      defectDialog(pid, null, load);
    };
    await load();
  }
});

App.page('warranty', {
  title: '保固維修',
  sub: '到期前主動回訪一次：現在修是服務，過期再修是爭議',
  module: 'warranty',
  help: {
    intro: '保固不是一個日期，是一堆各自不同的期限：防水五年、木作一年、五金三個月。分開記才管得動。',
    steps: ['交屋後逐項建立保固：項目、負責工班、保固月數。起算日留空就用案場的交屋日。',
      '業主來電報修 → 按「報修」，直接轉成一張缺失單進入追蹤清單，責任工班也一併帶過去。',
      '到期前 30 天系統會開待辦提醒主動回訪。'],
    notes: ['已過期的保固還是可以報修，系統會在建立時明白告訴你「此項保固已過期」 —— 修不修是商業決定，但不要在不知情的狀況下做。']
  },
  async render(el) {
    const state = { project_id: '', status: '', q: '' };
    const bar = App.filterBar([
      { name: 'project_id', label: '案場', type: 'select', options: App.projectOptions(true) },
      { name: 'status', label: '保固狀態', type: 'select',
        options: [['', '全部'], ['valid', '保固中'], ['soon', '60 天內到期'], ['expired', '已到期']] },
      { name: 'q', label: '搜尋', placeholder: '保固項目／案場／業主／工班' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const act = document.createElement('div');
    act.className = 'actions';
    act.innerHTML = '<button class="btn" id="add">新增保固項目</button>' + UI.csvBtn('warranty');
    el.appendChild(act);
    const box = document.createElement('div');
    el.appendChild(box);
    act.querySelector('#add').onclick = () => {
      const pid = state.project_id || App.lastProject();
      if (!pid) { UI.toast('請先在上方選擇案場', true); return; }
      warrantyDialog(pid, null, load);
    };

    const load = async () => {
      const rows = await GET('/warranties' + App.qs(state));
      const soon = rows.filter(r => !r.expired && r.days_left !== null && r.days_left <= 60);
      box.innerHTML = `
        ${soon.length ? `<div class="notice warn">有 ${soon.length} 項保固將在 60 天內到期。</div>` : ''}
        ${UI.table(['案場', '業主', '保固項目', '負責工班', '起算', '到期', '剩餘', ''], rows.map(r => `<tr>
          <td>${UI.esc(r.project_name)}<div class="muted">${UI.esc(r.project_code)}</div></td>
          <td>${UI.esc(r.customer_name || '—')}<div class="muted">${UI.esc(r.customer_phone || '')}</div></td>
          <td>${UI.esc(r.item)}</td>
          <td>${UI.esc(r.vendor_name || '—')}</td>
          <td class="nowrap">${UI.date(r.start_date)}</td>
          <td class="nowrap">${UI.date(r.end_date)}</td>
          <td class="num ${r.expired ? 'muted' : r.days_left <= 60 ? 'warn' : ''}">
            ${r.expired ? '已到期' : r.days_left === null ? '—' : r.days_left + ' 天'}</td>
          <td class="nowrap"><button class="btn tiny" data-rep="${r.id}">報修</button>
            <button class="btn tiny secondary" data-edit="${r.id}">編輯</button>
            <button class="btn tiny secondary" data-del="${r.id}">刪除</button></td>
        </tr>`), '還沒有保固資料')}`;
      UI.bindCsv(act, 'warranty', '保固清單', [
        ['案場', r => r.project_name], ['案場代號', r => r.project_code],
        ['業主', r => r.customer_name], ['業主電話', r => r.customer_phone],
        ['保固項目', r => r.item], ['負責工班', r => r.vendor_name],
        ['起算日', r => r.start_date], ['月數', r => r.months], ['到期日', r => r.end_date],
        ['剩餘天數', r => r.expired ? '已到期' : r.days_left], ['備註', r => r.note]
      ], rows);
      box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
        const w = rows.find(x => String(x.id) === b.dataset.edit);
        warrantyDialog(w.project_id, w, load);
      });
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!await UI.confirm('確定刪除這項保固？')) return;
        try { await DEL('/warranties/' + b.dataset.del); load(); } catch (e) { UI.err(e); }
      });
      box.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => {
        const w = rows.find(x => String(x.id) === b.dataset.rep);
        UI.modal({
          title: `保固報修 — ${w.item}`,
          body: `<div class="form-grid">
            ${UI.input('location', '位置')}${UI.input('item', '項目', { value: w.item })}
            ${UI.textarea('description', '狀況描述')}
            ${UI.input('due_date', '約定處理日', { type: 'date' })}
            ${UI.select('severity', '嚴重度', twOpts(TW.severity), { value: 'normal' })}</div>`,
          onSubmit: async bd => {
            const r = await POST(`/warranties/${w.id}/report`, UI.formData(bd));
            UI.toast(r.expired ? '已建立報修單（此項保固已過期）' : '已建立報修單，可在缺失頁追蹤');
          }
        });
      });
    };
    await load();
  }
});

App.page('permits', {
  title: '許可與法規',
  sub: '裝修許可、消防審查、竣工查驗的期限',
  module: 'permits',
  help: {
    intro: '室內裝修審查許可有有效期限，逾期未完成竣工查驗可能被要求停工或處分。到期前七天系統會自動開待辦。',
    steps: ['開工前逐項建立：申辦項目、主管機關、承辦人。',
      '送件後填申請日，核准後填文號、核准日與有效期限。',
      '「有效期限」一定要填 —— 沒填就不會提醒，這一欄空著等於沒在管。']
  },
  async render(el) {
    const state = { project_id: '', status: '', q: '' };
    const bar = App.filterBar([
      { name: 'project_id', label: '案場', type: 'select', options: App.projectOptions(true) },
      { name: 'status', label: '狀態', type: 'select', options: [['', '全部']].concat(twOpts(TW.permit_status)) },
      { name: 'q', label: '搜尋', placeholder: '項目／機關／文號／案場' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const act = document.createElement('div');
    act.className = 'actions';
    act.innerHTML = '<button class="btn" id="add">新增申辦案件</button>' + UI.csvBtn('permits');
    el.appendChild(act);
    const box = document.createElement('div');
    el.appendChild(box);
    act.querySelector('#add').onclick = () => {
      const pid = state.project_id || App.lastProject();
      if (!pid) { UI.toast('請先在上方選擇案場', true); return; }
      permitDialog(pid, null, load);
    };

    const load = async () => {
      const rows = await GET('/permits' + App.qs(state));
      box.innerHTML = UI.table(['案場', '項目', '主管機關', '文號', '申請／核准', '有效期限', '剩餘', '狀態', '承辦', ''],
        rows.map(r => `<tr>
        <td>${UI.esc(r.project_name)}<div class="muted">${UI.esc(r.project_code)}</div></td>
        <td>${UI.esc(r.kind)}</td><td>${UI.esc(r.agency || '—')}</td>
        <td class="muted">${UI.esc(r.doc_no || '')}</td>
        <td class="nowrap muted">${r.applied_date || '—'} / ${r.approved_date || '—'}</td>
        <td class="nowrap ${r.expired ? 'danger' : ''}">${UI.date(r.expiry_date)}</td>
        <td class="num ${r.expired ? 'danger' : r.days_left !== null && r.days_left <= 7 ? 'warn' : ''}">
          ${r.days_left === null ? '—' : r.expired ? '已逾期' : r.days_left + ' 天'}</td>
        <td>${UI.tag(twText(TW.permit_status, r.status), r.status === 'approved' ? 'ok' : r.status === 'todo' ? 'warn' : '')}</td>
        <td>${UI.esc(r.owner_name || '—')}</td>
        <td class="nowrap"><button class="btn tiny secondary" data-edit="${r.id}">編輯</button>
          <button class="btn tiny secondary" data-del="${r.id}">刪除</button></td>
      </tr>`), '還沒有申辦案件');
      UI.bindCsv(act, 'permits', '許可與法規', [
        ['案場', r => r.project_name], ['案場代號', r => r.project_code],
        ['申辦項目', r => r.kind], ['主管機關', r => r.agency], ['文號', r => r.doc_no],
        ['申請日', r => r.applied_date], ['核准日', r => r.approved_date],
        ['有效期限', r => r.expiry_date], ['剩餘天數', r => r.expired ? '已逾期' : r.days_left],
        ['狀態', r => twText(TW.permit_status, r.status)], ['承辦', r => r.owner_name], ['備註', r => r.note]
      ], rows);
      box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
        const r = rows.find(x => String(x.id) === b.dataset.edit);
        permitDialog(r.project_id, r, load);
      });
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!await UI.confirm('確定刪除這筆申辦案件？')) return;
        try { await DEL('/permits/' + b.dataset.del); load(); } catch (e) { UI.err(e); }
      });
    };
    await load();
  }
});
