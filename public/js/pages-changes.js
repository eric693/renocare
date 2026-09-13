// 追加減帳（跨案清單）＋ 變更單的新增／明細／送簽
// 這是整套系統最重要的一頁：沒簽認的追加，做下去等於自己吸收。

App.page('changes', {
  title: '追加減帳',
  sub: '簽認了才算錢。送出三天沒簽，系統會自己來催',
  module: 'changes',
  help: {
    intro: '現場客戶說「這面牆幫我改一下」，師傅就做了；結算時客戶說「我沒說要加錢」。變更單就是為了擋住這件事。',
    steps: ['現場一有變更就開一張變更單，把追加與減帳逐項列清楚。',
      '按「送簽」之後，可以用業主端連結讓客戶線上按確認；紙本回簽的話，人工登錄簽認人姓名。',
      '簽認完成的金額才會併進合約總價與應收，也才會出現在請款上。'],
    notes: ['送出超過三天還沒簽，系統每天會把它變成一張待辦提醒你去追。',
      '已簽認的變更單不能修改，要調整只能另開一張（減帳）—— 軌跡才連得起來。',
      '變更單可以帶「展延工期」，簽認後合約完工日會自動往後，逾期違約金才不會算在自己頭上。']
  },
  async render(el) {
    const state = { project_id: '', status: '', q: '' };
    const bar = App.filterBar([
      { name: 'project_id', label: '案場', type: 'select', options: App.projectOptions(true) },
      { name: 'status', label: '狀態', type: 'select', options: [['', '全部']].concat(twOpts(TW.change_status)) },
      { name: 'q', label: '搜尋', placeholder: '單號／標題／案場' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const act = document.createElement('div');
    act.className = 'actions';
    act.innerHTML = '<button class="btn" id="add">新增變更單</button>' + UI.csvBtn('changes');
    el.appendChild(act);
    const sum = document.createElement('div');
    el.appendChild(sum);
    const box = document.createElement('div');
    el.appendChild(box);

    const load = async () => {
      const rows = await GET('/changes' + App.qs(state));
      const pending = rows.filter(r => r.status === 'sent');
      const draft = rows.filter(r => r.status === 'draft');
      const signed = rows.filter(r => r.status === 'signed');
      sum.innerHTML = `<div class="stat-grid">
        ${stat(pending.length, '待業主簽認', pending.length ? 'danger' : '', '', UI.fmtMoney(pending.reduce((a, r) => a + r.amount, 0)))}
        ${stat(draft.length, '草稿未送簽', draft.length ? 'warn' : '', '', UI.fmtMoney(draft.reduce((a, r) => a + r.amount, 0)))}
        ${stat(signed.length, '已簽認', 'ok', '', UI.fmtMoney(signed.reduce((a, r) => a + r.amount, 0)))}
      </div>`;
      box.innerHTML = UI.table(['單號', '案場', '事由', '金額', '展延', '狀態', '簽認紀錄', ''], rows.map(r => `<tr>
        <td>${UI.esc(r.no)}</td>
        <td>${UI.esc(r.project_name)}<div class="muted">${UI.esc(r.project_code)}</div></td>
        <td><strong>${UI.esc(r.title)}</strong><div class="muted">${twText(TW.change_reason, r.reason)}</div></td>
        <td class="num ${r.amount < 0 ? 'danger' : ''}">${UI.fmtMoney(r.amount)}</td>
        <td>${r.days_delay ? r.days_delay + ' 天' : '—'}</td>
        <td>${UI.tag(twText(TW.change_status, r.status),
        r.status === 'signed' ? 'ok' : r.status === 'sent' ? 'danger' : r.status === 'rejected' ? 'warn' : '')}
          ${r.status === 'sent' && r.sent_at ? `<div class="muted">送出 ${r.sent_at}</div>` : ''}</td>
        <td class="muted">${r.signed_at ? `${UI.esc(r.signed_name)}<div>${UI.esc(r.signed_at)}</div>
          <div>${r.sign_channel === 'client' ? '線上簽認' : '紙本回簽'}</div>` : '—'}</td>
        <td class="nowrap"><button class="btn tiny secondary" data-open="${r.id}">明細</button></td>
      </tr>`), '還沒有變更單');
      UI.bindCsv(act, 'changes', '追加減帳', [
        ['單號', r => r.no], ['案場', r => r.project_name], ['案場代號', r => r.project_code],
        ['事由', r => r.title], ['原因', r => twText(TW.change_reason, r.reason)],
        ['說明', r => r.detail], ['金額', r => r.amount], ['展延天數', r => r.days_delay],
        ['狀態', r => twText(TW.change_status, r.status)],
        ['送簽時間', r => r.sent_at], ['簽認時間', r => r.signed_at], ['簽認人', r => r.signed_name],
        ['簽認管道', r => r.sign_channel === 'client' ? '業主端線上簽' : r.sign_channel ? '紙本回簽' : ''],
        ['簽認 IP', r => r.sign_ip], ['建立人', r => r.created_by_name], ['備註', r => r.note]
      ], rows);
      box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => changeDetail(Number(b.dataset.open), load));
    };
    act.querySelector('#add').onclick = () => changeDialog(App.lastProject(), null, load);
    await load();
  }
});

function changeDialog(pid, row, done) {
  UI.modal({
    title: row ? '編輯變更單' : '新增變更單',
    body: `<div class="form-grid">
      ${row ? '' : UI.select('project_id', '案場', App.projectOptions(false), { value: pid || App.lastProject() })}
      ${UI.input('title', '變更事由', { value: row ? row.title : '', required: true, full: true, placeholder: '例：主臥增設更衣間隔間' })}
      ${UI.select('reason', '原因', twOpts(TW.change_reason), { value: row ? row.reason : 'client' })}
      ${UI.input('days_delay', '展延工期（天）', { type: 'number', value: row ? row.days_delay : 0 })}
      ${UI.textarea('detail', '說明（寫清楚一點，這是日後爭議時的依據）', { value: row ? row.detail : '' })}
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) { await PUT('/changes/' + row.id, v); done(); }
      else {
        if (!v.project_id) { UI.toast('請選擇案場', true); return false; }
        const r = await POST('/changes', v);
        changeDetail(r.id, done);
      }
    }
  });
}

async function changeDetail(id, done) {
  const c = await GET('/changes/' + id);
  const open = c.status === 'draft' || c.status === 'sent';
  const editable = c.status === 'draft';
  const m = UI.modal({
    title: `${c.no}　${c.title}`, wide: true, hideFooter: true,
    body: `<div>
      <div class="detail-head">
        <div class="muted">${UI.esc(c.project_name)}（${UI.esc(c.project_code)}）　業主 ${UI.esc(c.customer_name || '—')}
          <div>${twText(TW.change_reason, c.reason)}${c.days_delay ? `　展延 ${c.days_delay} 天` : ''}</div>
          ${c.detail ? `<div>${UI.esc(c.detail)}</div>` : ''}</div>
        <div>${UI.tag(twText(TW.change_status, c.status),
      c.status === 'signed' ? 'ok' : c.status === 'sent' ? 'danger' : '')}
          <div class="num big">${UI.fmtMoney(c.amount)}</div></div>
      </div>
      ${c.signed_at ? `<div class="notice ok">由 <b>${UI.esc(c.signed_name)}</b> 於 ${UI.esc(c.signed_at)}
        以${c.sign_channel === 'client' ? '業主端線上簽認' : '紙本回簽'}確認${c.sign_ip ? `（來源 ${UI.esc(c.sign_ip)}）` : ''}。</div>` : ''}
      ${c.status === 'sent' ? `<div class="notice warn">已於 ${UI.esc(c.sent_at)} 送出，還沒取得簽認。
        <b>在簽認之前，這筆金額不算進合約總價。</b></div>` : ''}
      <div class="card">
        <div class="card-head"><h4>變更明細</h4>
          ${editable ? '<button class="btn tiny" id="ci-add">新增項目</button>' : ''}</div>
        ${UI.table(['類別', '項目', '單位', '數量', '單價', '金額', ''], c.items.map(i => `<tr>
          <td>${UI.tag(twText(TW.change_kind, i.kind), i.kind === 'deduct' ? 'warn' : '')}
            <div class="muted">${UI.esc(i.category || '')}</div></td>
          <td>${UI.esc(i.name)}<div class="muted">${UI.esc(i.spec || '')}</div></td>
          <td>${UI.esc(i.unit)}</td><td class="num">${i.qty}</td>
          <td class="num">${UI.fmtMoney(i.unit_price)}</td>
          <td class="num ${i.amount < 0 ? 'danger' : ''}">${UI.fmtMoney(i.amount)}</td>
          <td class="nowrap">${editable ? `<button class="btn tiny secondary" data-ciedit="${i.id}">編輯</button>
            <button class="btn tiny secondary" data-cidel="${i.id}">刪</button>` : ''}</td>
        </tr>`), '還沒有明細')}
      </div>
      <div class="modal-foot" style="justify-content:flex-start;flex-wrap:wrap;gap:8px">
        <button class="btn secondary" id="c-print">列印變更單</button>
        ${editable ? `<button class="btn secondary" id="c-edit">編輯單頭</button>
          <button class="btn" id="c-send">送簽給業主</button>` : ''}
        ${open ? `<button class="btn secondary" id="c-paper">紙本回簽登錄</button>` : ''}
        ${c.status === 'sent' ? '<button class="btn secondary" id="c-reject">業主否決</button>' : ''}
        ${editable ? '<button class="btn secondary" id="c-del">刪除</button>' : ''}
        ${c.status === 'signed' ? '<button class="btn secondary" id="c-void">作廢</button>' : ''}
      </div>
    </div>`
  });
  const bd = m.body;
  const refresh = () => { m.close(); done && done(); };
  const q = s => bd.querySelector(s);

  // 單價一律存正數，方向看「類型」，所以編輯時直接帶回原值即可
  const itemDialog = row => UI.modal({
    title: row ? '編輯變更明細' : '新增變更明細', wide: true,
    body: `<div class="form-grid">
      ${UI.select('kind', '類型', twOpts(TW.change_kind), { value: row ? row.kind : 'add' })}
      ${UI.select('category', '類別', [['', '未分類']].concat(App.listOptions('trades')), { value: row ? row.category : '' })}
      ${UI.input('name', '項目', { required: true, value: row ? row.name : '' })}
      ${UI.input('spec', '規格說明', { full: true, value: row ? row.spec : '' })}
      ${UI.input('unit', '單位', { value: row ? row.unit : '式' })}
      ${UI.input('qty', '數量', { type: 'number', step: '0.01', value: row ? row.qty : 1 })}
      ${UI.input('unit_price', '對客單價', { type: 'number', value: row ? row.unit_price : '' })}
      ${UI.input('unit_cost', '成本單價', { type: 'number', value: row ? row.unit_cost : '' })}
    </div><div class="muted">選「減帳」時金額會自動存成負數，單價照正數填就好。</div>`,
    onSubmit: async el => {
      if (row) await PUT('/change-items/' + row.id, UI.formData(el));
      else await POST(`/changes/${id}/items`, UI.formData(el));
      refresh(); changeDetail(id, done);
    }
  });
  q('#ci-add') && (q('#ci-add').onclick = () => itemDialog(null));
  bd.querySelectorAll('[data-ciedit]').forEach(b => b.onclick = () =>
    itemDialog(c.items.find(x => String(x.id) === b.dataset.ciedit)));
  bd.querySelectorAll('[data-cidel]').forEach(b => b.onclick = async () => {
    await DEL('/change-items/' + b.dataset.cidel);
    m.close(); changeDetail(id, done);
  });
  // 紙本回簽用的那張紙：業主在現場簽，回來再登錄。已簽認的印出來是歸檔憑證，
  // 所以簽認資訊（誰、何時、什麼管道）要一起印在上面。
  q('#c-print').onclick = () => UI.print(`工程變更單　${c.no}`, `
    <div class="kv">
      <div><b>案場</b>${UI.esc(c.project_name)}（${UI.esc(c.project_code)}）</div>
      <div><b>業主</b>${UI.esc(c.customer_name || '')}</div>
      <div><b>變更事由</b>${UI.esc(c.title)}</div>
      <div><b>變更原因</b>${UI.esc(twText(TW.change_reason, c.reason))}</div>
      <div><b>開單日期</b>${UI.esc((c.created_at || '').slice(0, 10))}</div>
      <div><b>工期展延</b>${c.days_delay ? c.days_delay + ' 天' : '不展延'}</div>
    </div>
    ${c.detail ? `<h2>說明</h2><div class="note">${UI.esc(c.detail)}</div>` : ''}
    <h2>變更項目</h2>
    ${UI.ptable(['類型', '類別', '項目', '規格', '單位', '#數量', '#單價', '#金額'],
      c.items.map(i => [twText(TW.change_kind, i.kind), UI.esc(i.category || ''), UI.esc(i.name),
        UI.esc(i.spec || ''), UI.esc(i.unit), i.qty, UI.fmtMoney(i.unit_price), UI.fmtMoney(i.amount)]))}
    <div class="total">變更金額合計　${UI.fmtMoney(c.amount)}</div>
    <h2>業主確認</h2>
    <div class="note muted">本變更單經業主簽認後，變更金額併入合約總價；${c.days_delay
      ? `並同意合約完工日往後展延 ${c.days_delay} 天。` : '合約完工日不變。'}
未經簽認之項目不予施作、不予計價。</div>
    ${c.signed_at
      ? `<div class="note" style="margin-top:14px">已由 <b>${UI.esc(c.signed_name)}</b> 於 ${UI.esc(c.signed_at)} 以${
        c.sign_channel === 'client' ? '線上簽認' : '紙本回簽'}確認${c.sign_ip ? `（來源 IP ${UI.esc(c.sign_ip)}）` : ''}。</div>`
      : '<div class="sign"><div>業主簽章／日期</div><div>本公司代表／日期</div></div>'}`);

  q('#c-edit') && (q('#c-edit').onclick = () => { m.close(); changeDialog(null, c, () => changeDetail(id, done)); });
  q('#c-send') && (q('#c-send').onclick = async () => {
    try {
      await POST(`/changes/${id}/status`, { status: 'sent' });
      UI.toast('已送簽。把業主端連結傳給客戶，他可以線上按確認');
      refresh();
    } catch (e) { UI.err(e); }
  });
  q('#c-paper') && (q('#c-paper').onclick = () => UI.modal({
    title: '紙本回簽登錄',
    body: `<p>業主已在紙本上簽名確認時用這個。登錄之後金額就會併進合約總價。</p>
      <div class="form-grid">${UI.input('signed_name', '簽認人姓名', { required: true, full: true })}</div>`,
    onSubmit: async el => {
      await POST(`/changes/${id}/status`, { status: 'signed', ...UI.formData(el) });
      UI.toast('已登錄簽認'); refresh();
    }
  }));
  q('#c-reject') && (q('#c-reject').onclick = async () => {
    if (!await UI.confirm('標記為業主否決？這張單的金額不會進入合約。')) return;
    await POST(`/changes/${id}/status`, { status: 'rejected' }); refresh();
  });
  q('#c-void') && (q('#c-void').onclick = async () => {
    if (!await UI.confirm('作廢這張已簽認的變更單？合約總價會跟著減少。')) return;
    await POST(`/changes/${id}/status`, { status: 'void' }); refresh();
  });
  q('#c-del') && (q('#c-del').onclick = async () => {
    if (!await UI.confirm('確定刪除這張草稿？')) return;
    await DEL('/changes/' + id); refresh();
  });
}
