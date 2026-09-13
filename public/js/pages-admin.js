// 帳號權限、系統設定、操作紀錄

App.page('users', {
  title: '帳號權限',
  sub: '每個人只看得到自己該看的；金額相關的模組可以設成唯讀',
  module: 'users',
  help: {
    intro: '一人一個帳號，不要共用 —— 共用的話操作紀錄就失去意義，出事查不出是誰做的。',
    steps: ['新增帳號 → 填帳號密碼與姓名 → 勾選這個人用得到的模組。',
      '再到「其中只能看不能改」勾第二次，被勾的模組就變成唯讀：看得到、改不了。',
      '離職就按刪除。做過事的帳號會自動改成停用而不是真的刪掉。'],
    terms: [['管理員', '所有模組全開，而且不受唯讀限制。系統至少要保留一位啟用中的管理員。'],
      ['唯讀', '典型用法是讓工務看得到發包單（要知道叫誰來），但改不了金額。']],
    notes: ['做過事的帳號刪不掉 —— 案場的設計師、日報的填寫人、待辦的指派對象都指著它，刪掉會讓歷史紀錄變成無名氏，所以改成停用。停用的人登不進來，效果一樣。',
      '工班名單與工項名稱不綁模組權限（各處的下拉選單都要用），但沒有該模組權限的人看不到工班的匯款帳戶，也看不到工項的成本單價。']
  },
  async render(el) {
    const state = { role: '', active: '', q: '' };
    const mods = await GET('/modules');
    const bar = App.filterBar([
      { name: 'role', label: '角色', type: 'select', options: [['', '全部'], ['admin', '管理員'], ['staff', '員工']] },
      { name: 'active', label: '狀態', type: 'select', options: [['', '全部'], ['1', '啟用'], ['0', '停用']] },
      { name: 'q', label: '搜尋', placeholder: '帳號／姓名／職稱／電話' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const box = document.createElement('div');
    el.appendChild(box);

    const load = async () => {
      const rows = await GET('/users' + App.qs(state));
      box.innerHTML = `<div class="actions"><button class="btn" id="add">新增帳號</button>${UI.csvBtn('users')}</div>
        ${UI.table(['帳號', '姓名／職稱', '角色', '可用模組', '狀態', ''], rows.map(r => `<tr class="${r.active ? '' : 'dim'}">
          <td>${UI.esc(r.username)}</td>
          <td><strong>${UI.esc(r.name)}</strong><div class="muted">${UI.esc(r.title || '')}</div></td>
          <td>${r.role === 'admin' ? UI.tag('管理員', 'ok') : '員工'}</td>
          <td class="muted">${r.role === 'admin' ? '全部' : r.modules.map(k =>
        (mods.modules.find(m => m.key === k) || {}).label || k).join('、') || '（未開通）'}
            ${r.readonly && r.readonly.length ? `<div>唯讀：${r.readonly.map(k =>
          (mods.modules.find(m => m.key === k) || {}).label || k).join('、')}</div>` : ''}</td>
          <td>${r.active ? '啟用' : '停用'}</td>
          <td class="nowrap"><button class="btn tiny secondary" data-edit="${r.id}">編輯</button>
            <button class="btn tiny secondary" data-del="${r.id}">刪除</button></td>
        </tr>`), '找不到符合條件的帳號')}`;
      UI.bindCsv(box, 'users', '帳號清單', [
        ['帳號', r => r.username], ['姓名', r => r.name], ['職稱', r => r.title],
        ['角色', r => r.role === 'admin' ? '管理員' : '員工'], ['電話', r => r.phone],
        ['狀態', r => r.active ? '啟用' : '停用'],
        ['可用模組', r => r.role === 'admin' ? '全部' : r.modules.map(k =>
          (mods.modules.find(m => m.key === k) || {}).label || k).join('、')],
        ['其中唯讀', r => (r.readonly || []).map(k =>
          (mods.modules.find(m => m.key === k) || {}).label || k).join('、')],
        ['建立時間', r => r.created_at]
      ], rows);
      box.querySelector('#add').onclick = () => userDialog(null, mods, load);
      box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
        userDialog(rows.find(x => String(x.id) === b.dataset.edit), mods, load));
      // 做過事的帳號刪不掉，後端會改成停用並回報原因，照實說給使用者聽
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        const u = rows.find(x => String(x.id) === b.dataset.del);
        if (!await UI.confirm(`確定刪除「${u.name}」？做過事的帳號會改為停用，歷史紀錄才不會變成無名氏。`)) return;
        try {
          const r = await DEL('/users/' + u.id);
          UI.toast(r.message || '已刪除');
          load();
        } catch (e) { UI.err(e); }
      });
    };
    await load();
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
    steps: ['先把工種、雜支科目、收付款方式改成貴公司實際在用的字 —— 之後每一張單都從這裡帶。',
      '把常用的請款節點比例與工序順序寫成範本，新案子就不必每次重打。',
      '改完按「儲存設定」，重新整理後生效。'],
    terms: [
      ['請款節點範本', '格式「名稱:百分比」，用逗號分隔。例：簽約金:5,水電完成:25,木作完成:30,完工清潔:30,驗收交屋:10（內政部室內裝修契約範本：簽約金最多 5%、單期最多 30%，尾款在驗收並取得合格證明後付）'],
      ['遲延違約金', '合約沒填每日金額時，依範本每逾 1 日課工程總價千分之一，總額以合約總價 10% 為限。'],
      ['個人工班代扣', '請款身分為「個人」的工班，每次付款依這裡的比例與門檻代扣所得稅與二代健保補充保費。工班報酬屬於哪一類所得（執行業務、薪資等）請跟會計師確認。'],
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
      <h4 class="form-sec">契約與代扣</h4>
      ${row('penalty_permille', '遲延違約金（每日千分之幾）', '合約沒約定每日金額時使用；內政部室內裝修契約範本為工程總價千分之一')}
      ${row('penalty_cap_pct', '遲延違約金上限％', '範本為合約總價 10%')}
      ${row('withhold_pct', '個人工班代扣所得稅％', '執行業務所得一般為 10%；工班所得類別請跟會計師確認')}
      ${row('withhold_over', '所得稅扣繳門檻（單次給付超過此金額才扣）', '執行業務所得為 20,000 元')}
      ${row('nhi_pct', '二代健保補充保費率％', '目前為 2.11%')}
      ${row('nhi_from', '補充保費門檻（單次給付達此金額起扣）', '執行業務收入為 20,000 元')}
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
  help: {
    intro: '這頁存在的理由是爭議發生時能翻得出來：這張單是誰開的、誰改的、業主什麼時候簽的、從哪個 IP 簽的。',
    steps: ['用上方的身分、日期範圍、關鍵字縮小範圍（關鍵字吃人員、動作、對象與細節）。',
      '要給會計或律師的話按「匯出 CSV」。'],
    notes: ['紀錄不能刪除 —— 能被刪的軌跡沒有意義。系統會依「系統設定」裡的保留天數自動清理舊紀錄。',
      '身分標「業主」的是從業主端連結來的操作，最重要的是變更單線上簽認。']
  },
  async render(el) {
    const state = { q: '', actor_type: '', date_from: '', date_to: '' };
    const bar = App.filterBar([
      { name: 'actor_type', label: '身分', type: 'select',
        options: [['', '全部'], ['staff', '員工'], ['client', '業主端']] },
      { name: 'date_from', label: '起', type: 'date' },
      { name: 'date_to', label: '迄', type: 'date' },
      { name: 'q', label: '搜尋', placeholder: '人員／動作／對象／細節' }
    ], v => { Object.assign(state, v); load(); });
    el.innerHTML = '';
    el.appendChild(bar);
    const box = document.createElement('div');
    el.appendChild(box);
    const load = async () => {
      const rows = await GET('/audit' + App.qs(state));
      box.innerHTML = `<div class="actions">${UI.csvBtn('audit')}</div>` +
        UI.table(['時間', '身分', '人員', '動作', '對象', '細節'], rows.map(r => `<tr>
        <td class="nowrap muted">${UI.esc(r.created_at)}</td>
        <td>${r.actor_type === 'client' ? UI.tag('業主', 'warn') : '員工'}</td>
        <td>${UI.esc(r.actor_name)}</td>
        <td>${UI.esc(r.action)}</td>
        <td>${UI.esc(r.target)}</td>
        <td class="muted">${UI.esc(r.detail)}</td>
      </tr>`), '沒有紀錄');
      UI.bindCsv(box, 'audit', '操作紀錄', [
        ['時間', r => r.created_at], ['身分', r => r.actor_type === 'client' ? '業主' : '員工'],
        ['人員', r => r.actor_name], ['動作', r => r.action], ['對象', r => r.target],
        ['細節', r => r.detail]
      ], rows);
    };
    await load();
  }
});
