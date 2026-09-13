// 「先選案子、再看那個案子的東西」這類頁面。
// 內容直接重用案場詳情的分頁，側欄進來與案場裡點進來看到的完全一樣 ——
// 同一件事只有一種畫面，交接時不用解釋兩套。

// 關鍵字比對：任一欄位含有關鍵字就算中，不分大小寫
const kw = (q, ...vals) => !q || vals.some(v => String(v ?? '').toLowerCase().includes(q.toLowerCase()));

// 對話框會從清單裡找要編輯的那一筆（工序的前置工序下拉也要完整清單），
// 所以畫面只畫篩選後的，綁按鈕用「完整資料 ∪ 篩選結果」—— 篩選結果可能含詳情沒帶到的舊資料（例如舊日報）
function unionById(full, part) {
  const seen = new Set(full.map(x => x.id));
  return full.concat(part.filter(x => !seen.has(x.id)));
}

// filters：案場選單之外的篩選欄位；narrow(d, 篩選值)：回傳只留下符合條件的資料（可以是 async）
function projectScopedPage(key, { title, sub, module, tab, help, filters = [], narrow }) {
  App.page(key, {
    title, sub, module, help,
    async render(el) {
      const pid = App.pageQuery.get('project_id') || App.lastProject() || (App.projects[0] && App.projects[0].id) || '';
      let curId = '', full = null, fv = {};
      const bar = App.filterBar([
        { name: 'project_id', label: '案場', type: 'select', options: App.projectOptions(false), value: pid },
        ...filters
      ], v => {
        const { project_id, ...rest } = v;
        fv = rest;
        if (String(project_id) !== String(curId)) render(project_id); else paint();
      });
      el.innerHTML = '';
      el.appendChild(bar);
      const box = document.createElement('div');
      el.appendChild(box);

      const active = () => Object.values(fv).some(x => x !== '');
      const paint = async () => {
        const d = full;
        const view = narrow && active() ? await narrow(d, fv) : d;
        const bind = { ...d };
        for (const k of Object.keys(view)) {
          if (Array.isArray(view[k]) && Array.isArray(d[k])) bind[k] = unionById(d[k], view[k]);
        }
        box.innerHTML = `<div class="scope-head">
            <strong>${UI.esc(d.project.name)}</strong>
            <span class="muted">${UI.esc(d.project.code)}　${twText(TW.project_status, d.project.status)}</span>
            ${App.can('projects') ? `<a href="#projects?id=${d.project.id}">看這個案子的全貌 →</a>` : ''}
          </div>`
          + (active() ? `<div class="notice">已套用篩選，下面的清單只列出符合條件的資料；金額合計仍是全案。
              <button class="btn tiny secondary" id="fl-clear">清除篩選</button></div>` : '')
          + TABS[tab](view);
        TABBIND[tab] && TABBIND[tab](box, bind, reload);
        const clear = box.querySelector('#fl-clear');
        if (clear) clear.onclick = () => {
          bar.querySelectorAll('[data-f]').forEach(i => { if (i.dataset.f !== 'project_id') i.value = ''; });
          fv = {};
          paint();
        };
        Charts.mount(box);
      };
      const render = async id => {
        curId = id;
        if (!id) { box.innerHTML = '<div class="empty">請先選擇案場</div>'; return; }
        App.lastProject(id);
        box.innerHTML = '<div class="empty">載入中...</div>';
        full = await GET(`/projects/${id}/detail`);
        await paint();
      };
      const reload = () => render(curId);
      await render(pid);
    }
  });
}

projectScopedPage('schedule', {
  title: '工進排程', module: 'schedule', sub: '工序相依與延誤連動：改一處，後面自動推',
  tab: 'schedule',
  filters: [
    { name: 'status', label: '狀態', type: 'select', options: [['', '全部']].concat(twOpts(TW.sched_status)) },
    { name: 'q', label: '搜尋', placeholder: '工序／工種／工班／備註' }
  ],
  narrow: (d, f) => ({
    ...d,
    schedule: d.schedule.filter(r => (!f.status || r.status === f.status) && kw(f.q, r.name, r.trade, r.vendor_name, r.note))
  }),
  help: {
    intro: '工進的價值不在畫得漂亮，在於「泥作晚三天，木作也要跟著晚三天」這件事不必靠人記得。',
    steps: ['新案子按「套用範本」一次排完整個工期，再微調日期。',
      '某道工序延了，直接改它的「預計完成日」，後面相依的工序會自動一起往後推。',
      '整片停工（下雨、等料、大樓禁工）用「整批推移」，從那道工序起全部往後。',
      '工序多的時候用上方的「狀態」與「搜尋」縮小清單；每一列都可以編輯或刪除。'],
    notes: ['已完成的工序不會被自動推移。', '工序上出現「缺料」標記，表示綁在這道工序的建材交期晚於它的開工日。']
  }
});

projectScopedPage('sitelog', {
  title: '工地日報與照片', module: 'sitelog', sub: '每天一份，照片按工序歸檔',
  tab: 'site',
  filters: [
    { name: 'date_from', label: '日期從', type: 'date' },
    { name: 'date_to', label: '到', type: 'date' },
    { name: 'phase', label: '照片階段', type: 'select', options: [['', '全部']].concat(twOpts(TW.photo_phase)) },
    { name: 'q', label: '搜尋', placeholder: '進度／狀況／工種／照片說明' }
  ],
  // 案場詳情只帶最近 30 份日報、60 張照片；篩選時改向伺服器依日期撈，舊的才找得到
  narrow: async (d, f) => {
    const range = { project_id: d.project.id, date_from: f.date_from, date_to: f.date_to };
    const [logs, photos] = await Promise.all([
      GET('/site-logs' + App.qs(range)),
      GET('/photos' + App.qs({ ...range, phase: f.phase }))
    ]);
    return {
      ...d,
      logs: logs.filter(l => kw(f.q, l.weather, l.trades, l.progress_note, l.issue_note)),
      photos: photos.filter(p => kw(f.q, p.caption, p.schedule_name))
    };
  },
  help: {
    intro: '照片不是紀念品，是證據。封板前的水電照、拆除前的原況照，日後爭議時「有沒有拍」決定的是幾萬到幾十萬的責任歸屬。',
    steps: ['每天收工前按「填今日日報」：天氣、出工人數、進場工種、進度與現場狀況。隔天補填就把日期改掉。',
      '按「上傳照片」選階段（施工前／施工中／完工／缺失／隱蔽工程），可以綁工序，一次最多 20 張。',
      '不想給業主看的內部佐證照，取消勾選「業主端看得到」。',
      '要找以前的日報或照片，用上方的日期範圍、照片階段與搜尋；日報與照片都可以按「編輯」修改。'],
    notes: ['同一天重複填日報會覆蓋前一份，不會產生兩份互相矛盾的紀錄。',
      '照片預設業主端看得到；內部佐證照可以取消勾選。']
  }
});

projectScopedPage('subcontracts', {
  title: '發包與估驗', module: 'subcontracts', sub: '發包單、估驗計價、保留款與保固金',
  tab: 'subs',
  filters: [
    { name: 'status', label: '狀態', type: 'select', options: [['', '全部']].concat(twOpts(TW.sub_status)) },
    { name: 'q', label: '搜尋', placeholder: '工班／工種／單號／承攬範圍' }
  ],
  narrow: (d, f) => ({
    ...d,
    subcontracts: d.subcontracts.filter(s => (!f.status || s.status === f.status)
      && kw(f.q, s.no, s.vendor_name, s.trade, s.scope, s.note))
  }),
  help: {
    intro: '付給工班的錢有三層：本期估驗（做了多少）→ 扣保留款／保固金／缺失求償 → 實付。分開記才對得起來。',
    steps: ['先建發包單（可只填總價），工班進場後每期做一次估驗。',
      '估驗填的是「累計完成％」，本期金額由系統用累計減前期算出來 —— 工班重複計價會自然被擋掉。',
      '缺失單上勾了「向工班求償」，估驗時可以直接勾選一併扣款，而且不會被扣第二次。',
      '完工驗收後退保留款，保固期滿後退保固金。',
      '發包明細打錯按「編輯」改；估驗打錯可以編輯「最後一期、還沒付款」的那一期，金額會照新的累計％重算。'],
    notes: ['發包總價不能改到低於已估驗金額。', '已付款或不是最後一期的估驗不能改 —— 前後期的本期金額會對不上。',
      '個人工班（工班資料的「請款身分」選個人）會自動代扣所得稅與二代健保補充保費；表上的「實匯」才是要匯出去的錢。'],
    terms: [['保留款', '每期估驗先扣下一定比例，完工驗收無誤後退還。'],
      ['保固保證金', '保固期間押著的金額，期滿沒問題才退。']]
  }
});

projectScopedPage('billing', {
  title: '請款與收款', module: 'billing', sub: '請款節點綁工進，到了系統自己叫',
  tab: 'money',
  filters: [
    { name: 'status', label: '節點狀態', type: 'select', options: [['', '全部']].concat(twOpts(TW.ms_status)) },
    { name: 'date_from', label: '收款日從', type: 'date' },
    { name: 'date_to', label: '到', type: 'date' },
    { name: 'q', label: '搜尋', placeholder: '合約編號／節點／發票號碼／收款方式／備註' }
  ],
  // 節點狀態只篩節點；日期只篩收款紀錄；關鍵字三張表都篩（收款也比對它對應的節點名稱）
  narrow: (d, f) => {
    const all = d.money.milestones;
    const byId = new Map(all.map(x => [x.id, x]));
    return {
      ...d,
      contracts: d.contracts.filter(c => kw(f.q, c.contract_no, c.note)),
      allMilestones: all,
      money: {
        ...d.money,
        milestones: all.filter(x => (!f.status || x.status === f.status) && kw(f.q, x.name, x.invoice_no, x.note))
      },
      receipts: d.receipts.filter(r => (!f.date_from || r.date >= f.date_from) && (!f.date_to || r.date <= f.date_to)
        && kw(f.q, r.method, r.invoice_no, r.note, (byId.get(r.milestone_id) || {}).name))
    };
  },
  help: {
    intro: '裝修業的現金流問題八成不是客戶賴帳，是自己忘記請款。把節點綁在工序上，工進到了系統隔天就提醒。',
    steps: ['新案子按「套用範本」帶入請款節點（預設依內政部室內裝修契約範本：簽約金 5%、水電完成 25%、木作完成 30%、完工清潔 30%、驗收交屋 10%）。',
      '把節點綁到對應的工序，該工序一開工就會自動變成「可請款」並產生待辦。',
      '開單請款後才算應收；約定收款期限過了沒收足，就會進入逾期催收。',
      '收款紀錄打錯（日期、金額、發票號碼、對應節點）按「編輯」改，節點的已收狀態會自動重算。',
      '用上方的節點狀態、收款日範圍與搜尋找特定節點或某一筆收款。'],
    notes: ['追加款不在節點裡。登錄收款時「對應節點」留空，系統會自動歸到已簽認追加的那一段。']
  }
});

projectScopedPage('drawings', {
  title: '圖面與許可', module: 'drawings', sub: '只有一個現行版本，發布留痕',
  tab: 'docs',
  filters: [
    { name: 'current', label: '圖面版本', type: 'select', options: [['', '全部版本'], ['1', '只看現行版']] },
    { name: 'permit_status', label: '許可狀態', type: 'select', options: [['', '全部']].concat(twOpts(TW.permit_status)) },
    { name: 'q', label: '搜尋', placeholder: '圖名／分類／版次／許可項目／機關／文號' }
  ],
  narrow: (d, f) => ({
    ...d,
    drawings: d.drawings.filter(w => (!f.current || w.is_current)
      && kw(f.q, w.name, w.category, w.version, w.released_to, w.note)),
    permits: d.permits.filter(r => (!f.permit_status || r.status === f.permit_status)
      && kw(f.q, r.kind, r.agency, r.doc_no, r.owner_name, r.note))
  }),
  help: {
    intro: '同一張圖只會有一個現行版本，上傳新版時舊版自動退位；發布給哪些工班、什麼時候發的都留紀錄。',
    steps: ['按「上傳新版圖面」，圖面名稱相同就會被視為同一張圖的新版本，舊版自動退位。',
      '發圖給工班後按「發布」登錄發給了誰、什麼時候發的 —— 工班拿舊圖施工時，這筆紀錄決定責任在誰。',
      '要讓業主看得到的，勾「業主可見」；業主端只看得到現行版本。',
      '圖名、分類、版次、業主可見打錯按「編輯」改；改圖名會連同這張圖的所有版本一起改。要換檔案請上傳新版。',
      '圖多的時候用上方「只看現行版」、許可狀態與搜尋縮小清單。'],
    notes: ['接受 jpg／png／webp／heic／gif／pdf，單檔 25MB。',
      '許可與法規在同一個分頁下方：有效期限填了，到期前七天系統才會提醒。']
  }
});
