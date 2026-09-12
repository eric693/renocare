// 帳號權限、系統設定、操作紀錄

App.page('users', {
  title: '帳號權限',
  sub: '每個人只看得到自己該看的；金額相關的模組可以設成唯讀',
  module: 'users',
  async render(el) {
    const [rows, mods] = await Promise.all([GET('/users'), GET('/modules')]);
    el.innerHTML = `<div class="actions"><button class="btn" id="add">新增帳號</button></div>
      ${UI.table(['帳號', '姓名／職稱', '角色', '可用模組', '狀態', ''], rows.map(r => `<tr class="${r.active ? '' : 'dim'}">
        <td>${UI.esc(r.username)}</td>
        <td><strong>${UI.esc(r.name)}</strong><div class="muted">${UI.esc(r.title || '')}</div></td>
        <td>${r.role === 'admin' ? UI.tag('管理員', 'ok') : '員工'}</td>
        <td class="muted">${r.role === 'admin' ? '全部' : r.modules.map(k =>
      (mods.modules.find(m => m.key === k) || {}).label || k).join('、') || '（未開通）'}
          ${r.readonly && r.readonly.length ? `<div>唯讀：${r.readonly.map(k =>
        (mods.modules.find(m => m.key === k) || {}).label || k).join('、')}</div>` : ''}</td>
        <td>${r.active ? '啟用' : '停用'}</td>
        <td><button class="btn tiny secondary" data-edit="${r.id}">編輯</button></td>
      </tr>`), '')}`;
    const load = () => App.reload();
    el.querySelector('#add').onclick = () => userDialog(null, mods, load);
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
      userDialog(rows.find(x => String(x.id) === b.dataset.edit), mods, load));
  }
});

function userDialog(row, mods, done) {
  const groups = mods.groups.map(g => {
    const items = mods.modules.filter(m => (m.group || '系統') === g);
    if (!items.length) return '';
    return `<div class="perm-group"><h5>${UI.esc(g)}</h5>` + items.map(m => `<label class="chk">
      <input type="checkbox" data-cl="modules" value="${m.key}"${row && row.modules.includes(m.key) ? ' checked' : ''}>
      ${UI.esc(m.label)}${m.hint ? `<small>${UI.esc(m.hint)}</small>` : ''}</label>`).join('') + '</div>';
  }).join('');
  UI.modal({
    title: row ? `編輯帳號 — ${row.name}` : '新增帳號', wide: true,
    body: `<div class="form-grid">
      ${row ? '' : UI.input('username', '帳號', { required: true })}
      ${UI.input('name', '姓名', { value: row ? row.name : '', required: true })}
      ${UI.input('title', '職稱', { value: row ? row.title : '' })}
      ${UI.input('phone', '電話', { value: row ? row.phone : '' })}
      ${UI.input('password', row ? '重設密碼（留空不改）' : '密碼（至少 6 碼）', { type: 'password' })}
      ${UI.select('role', '角色', [['staff', '員工'], ['admin', '管理員（全部模組）']], { value: row ? row.role : 'staff' })}
      ${row ? UI.checkbox('active', '啟用', row.active) : ''}
      <div class="form-row full"><label>可用模組</label>
        <div class="perm-wrap" data-cl-wrap="modules">${groups}</div>
        <input type="hidden" name="modules" value="${row ? row.modules.join(',') : ''}"></div>
      <div class="form-row full"><label>其中只能看不能改</label>
        <div class="chk-list" data-cl-wrap="readonly">${mods.modules.map(m => `<label class="chk">
          <input type="checkbox" data-cl="readonly" value="${m.key}"${row && row.readonly.includes(m.key) ? ' checked' : ''}>
          ${UI.esc(m.label)}</label>`).join('')}</div>
        <input type="hidden" name="readonly" value="${row ? row.readonly.join(',') : ''}"></div>
    </div>`,
    onSubmit: async el => {
      const v = UI.formData(el);
      if (row) await PUT('/users/' + row.id, v); else await POST('/users', v);
      UI.toast('已儲存'); done();
    }
  });
}

App.page('settings', {
  title: '系統設定',
  sub: '公司名稱、各種下拉選項、請款節點與工序範本',
  module: 'settings',
  help: {
    intro: '下拉選項都在這裡改，不必改程式。範本則決定新案子按「套用範本」時會帶出什麼。',
    terms: [
      ['請款節點範本', '格式「名稱:百分比」，用逗號分隔。例：訂金:30,開工款:30,木作進場:20,完工驗收:15,交屋尾款:5'],
      ['工序範本', '格式「名稱:工種:天數:與前一項的間隔天數」，用逗號分隔。系統會依序串好前後相依關係。']
    ]
  },
  async render(el) {
    const s = await GET('/settings');
    const row = (k, label, hint, big) => big
      ? `<div class="form-row full"><label>${UI.esc(label)}</label>
          <textarea name="${k}" rows="3">${UI.esc(s[k] || '')}</textarea>
          ${hint ? `<div class="muted">${UI.esc(hint)}</div>` : ''}</div>`
      : `<div class="form-row full"><label>${UI.esc(label)}</label>
          <input name="${k}" value="${UI.esc(s[k] || '')}">
          ${hint ? `<div class="muted">${UI.esc(hint)}</div>` : ''}</div>`;
    el.innerHTML = `<div class="card"><div class="form-grid" id="st">
      ${row('company_name', '公司名稱')}
      ${row('ui_login_title', '登入頁標題', '留空就用公司名稱')}
      ${row('ui_login_sub', '登入頁副標')}
      ${row('ui_demo_hint', '登入頁提示文字', '示範帳號說明等；留空就不顯示', true)}
      <h4 class="form-sec">下拉選項（用逗號分隔）</h4>
      ${row('trades', '工種')}
      ${row('site_types', '案場類型')}
      ${row('styles', '風格')}
      ${row('expense_categories', '雜支科目')}
      ${row('payment_methods', '收付款方式')}
      ${row('permit_kinds', '許可申辦項目')}
      ${row('customer_sources', '客戶來源')}
      <h4 class="form-sec">範本</h4>
      ${row('milestone_template', '請款節點範本', '格式：名稱:百分比，逗號分隔', true)}
      ${row('schedule_template', '工序範本', '格式：名稱:工種:天數:間隔天數，逗號分隔', true)}
      <h4 class="form-sec">預設值</h4>
      ${row('default_retention_pct', '發包保留款％')}
      ${row('default_warranty_pct', '發包保固金％')}
      ${row('default_warranty_months', '保固月數')}
      ${row('alert_days', '提醒提前天數／預設收款帳期', '許可到期、料要來不及提前幾天提醒；開單請款沒填期限時也用這個天數')}
      ${row('audit_retention_days', '操作紀錄保留天數')}
    </div>
    <div class="actions"><button class="btn" id="save">儲存設定</button></div></div>`;
    el.querySelector('#save').onclick = async () => {
      await PUT('/settings', UI.formData(el.querySelector('#st')));
      UI.toast('已儲存，重新整理後生效');
      App.meta = await GET('/meta').catch(() => App.meta);
    };
  }
});

App.page('audit', {
  title: '操作紀錄',
  sub: '誰在什麼時候改了什麼，含業主端的線上簽認',
  module: 'audit',
  async render(el) {
    const state = { q: '' };
    const bar = App.filterBar([{ name: 'q', label: '搜尋', placeholder: '人員／動作／對象' }],
      v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const box = document.createElement('div');
    el.appendChild(box);
    const load = async () => {
      const rows = await GET('/audit' + App.qs(state));
      box.innerHTML = UI.table(['時間', '身分', '人員', '動作', '對象', '細節'], rows.map(r => `<tr>
        <td class="nowrap muted">${UI.esc(r.created_at)}</td>
        <td>${r.actor_type === 'client' ? UI.tag('業主', 'warn') : '員工'}</td>
        <td>${UI.esc(r.actor_name)}</td>
        <td>${UI.esc(r.action)}</td>
        <td>${UI.esc(r.target)}</td>
        <td class="muted">${UI.esc(r.detail)}</td>
      </tr>`), '沒有紀錄');
    };
    await load();
  }
});
