// 估價單（多版本）與工項單價庫

App.page('quotes', {
  title: '估價單',
  sub: '多版本留存、對客報價與成本並排，開單當下就知道賺多少',
  module: 'quotes',
  help: {
    intro: '客戶會改到第七版。每一版各自留存，成交的那一版標「已成交」後會自動產生合約，其餘版本標成「已被新版取代」——日後爭議翻得出當時報的是哪一版。',
    steps: ['新增估價單 → 從工項單價庫帶入項目 → 調整數量單價 → 送出給客戶。',
      '客戶要改：按「開新版本」會複製上一版的明細，改兩行就好，不必重打。',
      '成交後按「標為已成交」，系統自動開一張合約，案子狀態也跟著推進到「已簽約」。'],
    notes: ['每一行都有「對客單價」與「成本單價」兩欄。成本欄是預估毛利的依據，也是日後跟實際發包比對的基準。',
      '已成交的估價單不能再改，要調整只能走追加減帳 —— 這是刻意的。']
  },
  async render(el) {
    const id = App.pageQuery.get('id');
    if (id) return renderQuote(el, Number(id));
    const state = { project_id: '', status: '', q: '' };
    const bar = App.filterBar([
      { name: 'project_id', label: '案場', type: 'select', options: App.projectOptions(true) },
      { name: 'status', label: '狀態', type: 'select', options: [['', '全部']].concat(twOpts(TW.quote_status)) },
      { name: 'q', label: '搜尋', placeholder: '單號／備註／案場' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const act = document.createElement('div');
    act.className = 'actions';
    act.innerHTML = '<button class="btn" id="add">新增估價單</button>' + UI.csvBtn('quotes');
    el.appendChild(act);
    const box = document.createElement('div');
    el.appendChild(box);

    const load = async () => {
      const rows = await GET('/quotes' + App.qs(state));
      box.innerHTML = UI.table(['單號', '案場', '版本', '日期', '報價金額', '預估成本', '預估毛利', '狀態'],
        rows.map(r => {
          const gp = r.total - r.cost_total;
          return `<tr class="clickable" onclick="location.hash='quotes?id=${r.id}'">
          <td>${UI.esc(r.quote_no)}<div class="muted">${twText(TW.quote_kind, r.kind)}</div></td>
          <td>${UI.esc(r.project_name)}<div class="muted">${UI.esc(r.project_code)}</div></td>
          <td class="num">v${r.version}</td>
          <td class="nowrap">${UI.date(r.quote_date)}</td>
          <td class="num">${UI.fmtMoney(r.total)}</td>
          <td class="num muted">${UI.fmtMoney(r.cost_total)}</td>
          <td class="num ${gp < 0 ? 'danger' : ''}">${UI.fmtMoney(gp)}
            <div class="muted">${r.total ? Math.round(gp / r.total * 1000) / 10 : 0}%</div></td>
          <td>${UI.tag(twText(TW.quote_status, r.status),
            r.status === 'accepted' ? 'ok' : r.status === 'rejected' ? 'danger' : r.status === 'sent' ? 'warn' : '')}</td>
        </tr>`;
        }), '還沒有估價單');
      UI.bindCsv(act, 'quotes', '估價單清單', [
        ['單號', r => r.quote_no], ['版本', r => r.version], ['類型', r => twText(TW.quote_kind, r.kind)],
        ['案場', r => r.project_name], ['案場代號', r => r.project_code],
        ['報價日', r => r.quote_date], ['有效至', r => r.valid_until],
        ['小計', r => r.subtotal], ['折讓', r => r.discount],
        ['稅別', r => twText(TW.tax_type, r.tax_type)], ['稅額', r => r.tax_amount],
        ['報價總額', r => r.total], ['預估成本', r => r.cost_total],
        ['預估毛利', r => r.total - r.cost_total],
        ['毛利率%', r => r.total ? Math.round((r.total - r.cost_total) / r.total * 1000) / 10 : 0],
        ['狀態', r => twText(TW.quote_status, r.status)], ['建立人', r => r.created_by_name]
      ], () => rows);
    };
    act.querySelector('#add').onclick = () => quoteDialog(null, null);
    await load();
  }
});

function quoteDialog(pid, copyFrom) {
  UI.modal({
    title: copyFrom ? '開新版本' : '新增估價單',
    body: `<div class="form-grid">
      ${UI.select('project_id', '案場', App.projectOptions(false), { value: pid || App.lastProject() })}
      ${UI.select('kind', '種類', twOpts(TW.quote_kind), { value: 'build' })}
      ${UI.input('quote_date', '報價日', { type: 'date', value: UI.today() })}
      ${UI.input('valid_until', '有效期限', { type: 'date' })}
      ${UI.select('tax_type', '稅別', twOpts(TW.tax_type), { value: 'included' })}
      ${UI.textarea('note', '備註（付款方式、工期、不含項目）')}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (!v.project_id) { UI.toast('請選擇案場', true); return false; }
      const r = await POST('/quotes', { ...v, copy_from: copyFrom || '' });
      location.hash = 'quotes?id=' + r.id;
    }
  });
}

async function renderQuote(el, id) {
  const q = await GET('/quotes/' + id);
  const locked = q.status === 'accepted';
  const gp = q.total - q.cost_total;
  el.innerHTML = `<a href="#quotes">← 回估價單清單</a>
    <div class="card">
      <div class="detail-head">
        <div><h2>${UI.esc(q.quote_no)} <span class="muted">v${q.version}</span>
          ${UI.tag(twText(TW.quote_status, q.status), q.status === 'accepted' ? 'ok' : '')}</h2>
          <div class="muted">${UI.esc(q.project_name)}（${UI.esc(q.project_code)}）　業主 ${UI.esc(q.customer_name || '—')}
            ${q.area_ping ? `　${q.area_ping} 坪` : ''}</div></div>
        <div class="detail-actions">
          <button class="btn small" id="q-print">列印報價單</button>
          <button class="btn small secondary" id="q-csv">匯出明細</button>
          <button class="btn small secondary" id="q-copy">開新版本</button>
          ${locked ? '' : `<button class="btn small secondary" id="q-edit">編輯單頭</button>
          <button class="btn small" id="q-send">標為已送出</button>
          <button class="btn small" id="q-accept">標為已成交</button>
          <button class="btn small secondary" id="q-reject">標為未成交</button>`}
        </div>
      </div>
      <div class="stat-grid">
        ${stat(UI.fmtMoney(q.subtotal), '小計')}
        ${stat(UI.fmtMoney(q.discount), '折讓')}
        ${stat(UI.fmtMoney(q.total), '報價總額', '', '', twText(TW.tax_type, q.tax_type))}
        ${stat(UI.fmtMoney(q.cost_total), '預估成本')}
        ${stat(UI.fmtMoney(gp), '預估毛利', gp < 0 ? 'danger' : 'ok', '', `${q.total ? Math.round(gp / q.total * 1000) / 10 : 0}%`)}
        ${stat(q.area_ping ? UI.fmtMoney(Math.round(q.total / q.area_ping)) : '—', '每坪單價')}
      </div>
      ${locked ? '<div class="notice">已成交的估價單不能再修改。需要調整請開追加減帳變更單，軌跡才連得起來。</div>' : ''}
      ${q.note ? `<div class="muted">備註：${UI.esc(q.note)}</div>` : ''}
    </div>
    <div class="card">
      <div class="card-head"><h3>估價明細（${q.items.length} 項）</h3>
        ${locked ? '' : `<span><button class="btn small secondary" id="i-lib">從單價庫帶入</button>
        <button class="btn small" id="i-add">新增一行</button></span>`}</div>
      ${UI.table(['#', '工項', '單位', '數量', '對客單價', '金額', '成本單價', '成本', '毛利', ''],
    q.items.map((i, n) => {
      const g = i.amount - i.cost_amount;
      return `<tr>
        <td class="muted">${n + 1}</td>
        <td><strong>${UI.esc(i.name)}</strong>
          <div class="muted">${UI.esc(i.category || '')}${i.spec ? '　' + UI.esc(i.spec) : ''}</div></td>
        <td>${UI.esc(i.unit)}</td><td class="num">${i.qty}</td>
        <td class="num">${UI.fmtMoney(i.unit_price)}</td><td class="num">${UI.fmtMoney(i.amount)}</td>
        <td class="num muted">${UI.fmtMoney(i.unit_cost)}</td><td class="num muted">${UI.fmtMoney(i.cost_amount)}</td>
        <td class="num ${g < 0 ? 'danger' : ''}">${UI.fmtMoney(g)}</td>
        <td class="nowrap">${locked ? '' : `<button class="btn tiny secondary" data-iedit="${i.id}">改</button>
          <button class="btn tiny secondary" data-idel="${i.id}">刪</button>`}</td></tr>`;
    }), '還沒有明細')}
    </div>`;

  const reload = () => renderQuote(el, id);
  const q$ = s => el.querySelector(s);
  q$('#q-copy').onclick = () => quoteDialog(q.project_id, q.id);

  // 報價單是要交到客戶手上的文件：紙上不出現成本與毛利，只出現對客單價。
  q$('#q-print').onclick = () => UI.print(`報價單　${q.quote_no}（v${q.version}）`, `
    <div class="kv">
      <div><b>業主</b>${UI.esc(q.customer_name || '')}</div>
      <div><b>報價日</b>${UI.esc(q.quote_date || '')}</div>
      <div><b>工程地點</b>${UI.esc(q.address || q.project_name || '')}</div>
      <div><b>有效期限</b>${UI.esc(q.valid_until || '—')}</div>
      <div><b>案場</b>${UI.esc(q.project_name)}（${UI.esc(q.project_code)}）</div>
      <div><b>室內坪數</b>${q.area_ping ? q.area_ping + ' 坪' : '—'}</div>
      <div><b>報價類型</b>${UI.esc(twText(TW.quote_kind, q.kind))}</div>
      <div><b>稅別</b>${UI.esc(twText(TW.tax_type, q.tax_type))}</div>
    </div>
    <h2>工程項目</h2>
    ${UI.ptable(['#', '工項', '規格', '單位', '#數量', '#單價', '#金額'],
      q.items.map((i, n) => [n + 1, UI.esc(i.name) + (i.category ? `<div class="muted">${UI.esc(i.category)}</div>` : ''),
        UI.esc(i.spec || ''), UI.esc(i.unit), i.qty,
        UI.fmtMoney(i.unit_price), UI.fmtMoney(i.amount)]))}
    <div class="total">小計　${UI.fmtMoney(q.subtotal)}</div>
    ${q.discount ? `<div class="total">折讓　− ${UI.fmtMoney(q.discount)}</div>` : ''}
    ${q.tax_amount ? `<div class="total">稅額（5%）　${UI.fmtMoney(q.tax_amount)}</div>` : ''}
    <div class="total">報價總額　${UI.fmtMoney(q.total)}</div>
    ${q.area_ping ? `<div class="muted" style="text-align:right">每坪 ${UI.fmtMoney(Math.round(q.total / q.area_ping))}</div>` : ''}
    ${q.note ? `<h2>備註</h2><div class="note">${UI.esc(q.note)}</div>` : ''}
    <h2>確認</h2>
    <div class="note muted">施工期間如需變更或追加項目，將另開變更單，經雙方簽認後方施作與計價。</div>
    <div class="sign"><div>業主簽章／日期</div><div>本公司代表／日期</div></div>`);

  q$('#q-csv').onclick = () => UI.csv(`報價明細-${q.quote_no}`, [
    ['項次', r => r._n], ['工項', r => r.name], ['類別', r => r.category], ['規格', r => r.spec],
    ['單位', r => r.unit], ['數量', r => r.qty], ['對客單價', r => r.unit_price], ['金額', r => r.amount],
    ['成本單價', r => r.unit_cost], ['成本', r => r.cost_amount], ['毛利', r => r.amount - r.cost_amount]
  ], q.items.map((i, n) => ({ ...i, _n: n + 1 })));
  if (!locked) {
    q$('#q-edit').onclick = () => UI.modal({
      title: '編輯估價單',
      body: `<div class="form-grid">
        ${UI.input('quote_date', '報價日', { type: 'date', value: q.quote_date })}
        ${UI.input('valid_until', '有效期限', { type: 'date', value: q.valid_until })}
        ${UI.input('discount', '折讓金額', { type: 'number', value: q.discount })}
        ${UI.select('tax_type', '稅別', twOpts(TW.tax_type), { value: q.tax_type })}
        ${UI.textarea('note', '備註', { value: q.note })}</div>`,
      onSubmit: async bd => { await PUT('/quotes/' + id, UI.formData(bd)); reload(); }
    });
    const setStatus = async (status, msg) => {
      if (status === 'accepted' && !await UI.confirm('標為已成交會自動產生一張合約，之後這張估價單不能再修改。確定嗎？')) return;
      await POST(`/quotes/${id}/status`, { status });
      UI.toast(msg);
      await App.reloadProjects();
      reload();
    };
    q$('#q-send').onclick = () => setStatus('sent', '已標為送出');
    q$('#q-accept').onclick = () => setStatus('accepted', '已成交，合約已建立');
    q$('#q-reject').onclick = () => setStatus('rejected', '已標為未成交');
    q$('#i-add').onclick = () => itemDialog(null);
    q$('#i-lib').onclick = () => libDialog();
    el.querySelectorAll('[data-iedit]').forEach(b => b.onclick = () =>
      itemDialog(q.items.find(x => String(x.id) === b.dataset.iedit)));
    el.querySelectorAll('[data-idel]').forEach(b => b.onclick = async () => {
      await DEL('/quote-items/' + b.dataset.idel); reload();
    });
  }

  function itemDialog(row) {
    UI.modal({
      title: row ? '編輯明細' : '新增明細', wide: true,
      body: `<div class="form-grid">
        ${UI.select('category', '類別', [['', '未分類']].concat(App.listOptions('trades')), { value: row ? row.category : '' })}
        ${UI.input('name', '工項', { value: row ? row.name : '', required: true })}
        ${UI.input('spec', '規格說明', { value: row ? row.spec : '', full: true })}
        ${UI.input('unit', '單位', { value: row ? row.unit : '式' })}
        ${UI.input('qty', '數量', { type: 'number', step: '0.01', value: row ? row.qty : 1 })}
        ${UI.input('unit_price', '對客單價', { type: 'number', value: row ? row.unit_price : '' })}
        ${UI.input('unit_cost', '成本單價', { type: 'number', value: row ? row.unit_cost : '' })}
        ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
      </div>`,
      onSubmit: async bd => {
        const v = UI.formData(bd);
        if (row) await PUT('/quote-items/' + row.id, v);
        else await POST(`/quotes/${id}/items`, v);
        reload();
      }
    });
  }

  async function libDialog() {
    const lib = await GET('/unit-prices?active=1');
    UI.modal({
      title: '從工項單價庫帶入', wide: true,
      body: `<p>勾選要帶入的工項，數量先給 1，帶入後再改。</p>
        <div class="form-grid">${UI.checkList('picks', '工項',
        lib.map(u => [u.id, `[${u.category}] ${u.name}${u.spec ? ' / ' + u.spec : ''}　報價 ${UI.fmtMoney(u.material_price + u.labor_price)} / ${u.unit}`]))}</div>`,
      onSubmit: async bd => {
        const picks = UI.splitList(UI.formData(bd).picks);
        if (!picks.length) { UI.toast('請至少勾選一項', true); return false; }
        for (const pid of picks) {
          const u = lib.find(x => String(x.id) === String(pid));
          if (!u) continue;
          await POST(`/quotes/${id}/items`, {
            category: u.category, name: u.name, spec: u.spec, unit: u.unit, qty: 1,
            unit_price: u.material_price + u.labor_price, unit_cost: u.material_cost + u.labor_cost
          });
        }
        UI.toast(`已帶入 ${picks.length} 項`); reload();
      }
    });
  }
}

// ---- 工項單價庫 ----

App.page('unitprices', {
  title: '工項單價庫',
  sub: '報價與成本的公版，開估價單直接帶',
  module: 'unitprices',
  help: {
    intro: '每個工項同時記「成本」與「對客報價」。開估價單時一起帶入，所以報價的當下就看得到這張單賺多少，而不是做完才知道。',
    steps: ['先把常做的三十到五十項建起來，之後開估價單用勾的就好。',
      '材料與工資分開填，發包時比對工班報價才有依據。',
      '毛利率低於 15% 的會標紅 —— 那是該重新談成本、還是該調報價，自己決定。'],
    notes: ['材料與工資分開記，發包時比對工班報價比較有依據。', '單價調整不會回頭改已經開出去的估價單。']
  },
  async render(el) {
    const state = { category: '', q: '' };
    const bar = App.filterBar([
      { name: 'category', label: '類別', type: 'select', options: [['', '全部類別']].concat(App.listOptions('trades')) },
      { name: 'q', label: '搜尋', placeholder: '工項名稱／規格' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const act = document.createElement('div');
    act.className = 'actions';
    act.innerHTML = '<button class="btn" id="add">新增工項</button>' + UI.csvBtn('unitprices');
    el.appendChild(act);
    const box = document.createElement('div');
    el.appendChild(box);

    const load = async () => {
      const rows = await GET('/unit-prices' + App.qs(state));
      box.innerHTML = UI.table(['類別', '工項', '單位', '材料成本', '工資成本', '報價（材料）', '報價（工資）', '毛利率', ''],
        rows.map(r => {
          const cost = r.material_cost + r.labor_cost, price = r.material_price + r.labor_price;
          const rate = price ? Math.round((price - cost) / price * 1000) / 10 : 0;
          return `<tr class="${r.active ? '' : 'dim'}">
          <td>${UI.esc(r.category || '—')}</td>
          <td><strong>${UI.esc(r.name)}</strong><div class="muted">${UI.esc(r.spec || '')}</div></td>
          <td>${UI.esc(r.unit)}</td>
          <td class="num muted">${UI.fmtMoney(r.material_cost)}</td>
          <td class="num muted">${UI.fmtMoney(r.labor_cost)}</td>
          <td class="num">${UI.fmtMoney(r.material_price)}</td>
          <td class="num">${UI.fmtMoney(r.labor_price)}</td>
          <td class="num ${rate < 15 ? 'danger' : ''}">${rate}%</td>
          <td class="nowrap"><button class="btn tiny secondary" data-edit="${r.id}">編輯</button>
            <button class="btn tiny secondary" data-del="${r.id}">刪除</button></td></tr>`;
        }), '還沒有工項');
      UI.bindCsv(act, 'unitprices', '工項單價庫', [
        ['類別', r => r.category], ['工項', r => r.name], ['規格', r => r.spec], ['單位', r => r.unit],
        ['材料成本', r => r.material_cost], ['工資成本', r => r.labor_cost],
        ['成本合計', r => r.material_cost + r.labor_cost],
        ['報價（材料）', r => r.material_price], ['報價（工資）', r => r.labor_price],
        ['報價合計', r => r.material_price + r.labor_price],
        ['毛利率%', r => {
          const c = r.material_cost + r.labor_cost, p = r.material_price + r.labor_price;
          return p ? Math.round((p - c) / p * 1000) / 10 : 0;
        }],
        ['狀態', r => r.active ? '啟用' : '停用'], ['備註', r => r.note]
      ], () => rows);
      box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
        unitDialog(rows.find(x => String(x.id) === b.dataset.edit), load));
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!await UI.confirm('確定刪除這個工項？')) return;
        await DEL('/unit-prices/' + b.dataset.del); load();
      });
    };
    act.querySelector('#add').onclick = () => unitDialog(null, load);
    await load();
  }
});

function unitDialog(row, done) {
  UI.modal({
    title: row ? '編輯工項' : '新增工項', wide: true,
    body: `<div class="form-grid">
      ${UI.select('category', '類別', [['', '未分類']].concat(App.listOptions('trades')), { value: row ? row.category : '' })}
      ${UI.input('name', '工項名稱', { value: row ? row.name : '', required: true })}
      ${UI.input('spec', '規格說明', { value: row ? row.spec : '', full: true })}
      ${UI.input('unit', '單位', { value: row ? row.unit : '式' })}
      ${UI.input('material_cost', '材料成本', { type: 'number', value: row ? row.material_cost : 0 })}
      ${UI.input('labor_cost', '工資成本', { type: 'number', value: row ? row.labor_cost : 0 })}
      ${UI.input('material_price', '對客報價（材料）', { type: 'number', value: row ? row.material_price : 0 })}
      ${UI.input('labor_price', '對客報價（工資）', { type: 'number', value: row ? row.labor_price : 0 })}
      ${UI.checkbox('active', '啟用', row ? row.active : 1)}
      ${UI.textarea('note', '備註', { value: row ? row.note : '' })}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) await PUT('/unit-prices/' + row.id, v); else await POST('/unit-prices', v);
      UI.toast('已儲存'); done();
    }
  });
}
