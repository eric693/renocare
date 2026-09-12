// 「先選案子、再看那個案子的東西」這類頁面。
// 內容直接重用案場詳情的分頁，側欄進來與案場裡點進來看到的完全一樣 ——
// 同一件事只有一種畫面，交接時不用解釋兩套。

function projectScopedPage(key, { title, sub, module, tab, help }) {
  App.page(key, {
    title, sub, module, help,
    async render(el) {
      const pid = App.pageQuery.get('project_id') || App.lastProject() || (App.projects[0] && App.projects[0].id) || '';
      const bar = App.filterBar([
        { name: 'project_id', label: '案場', type: 'select', options: App.projectOptions(false), value: pid }
      ], v => { App.lastProject(v.project_id); render(v.project_id); });
      el.innerHTML = '';
      el.appendChild(bar);
      const box = document.createElement('div');
      el.appendChild(box);

      const render = async id => {
        if (!id) { box.innerHTML = '<div class="empty">請先選擇案場</div>'; return; }
        App.lastProject(id);
        box.innerHTML = '<div class="empty">載入中...</div>';
        const d = await GET(`/projects/${id}/detail`);
        const reload = () => render(id);
        box.innerHTML = `<div class="scope-head">
            <strong>${UI.esc(d.project.name)}</strong>
            <span class="muted">${UI.esc(d.project.code)}　${twText(TW.project_status, d.project.status)}</span>
            <a href="#projects?id=${id}">看這個案子的全貌 →</a>
          </div>` + TABS[tab](d);
        TABBIND[tab] && TABBIND[tab](box, d, reload);
        Charts.mount(box);
      };
      await render(pid);
    }
  });
}

projectScopedPage('schedule', {
  title: '工進排程', module: 'schedule', sub: '工序相依與延誤連動：改一處，後面自動推',
  help: {
    intro: '工進的價值不在畫得漂亮，在於「泥作晚三天，木作也要跟著晚三天」這件事不必靠人記得。',
    steps: ['新案子按「套用範本」一次排完整個工期，再微調日期。',
      '某道工序延了，直接改它的「預計完成日」，後面相依的工序會自動一起往後推。',
      '整片停工（下雨、等料、大樓禁工）用「整批推移」，從那道工序起全部往後。'],
    notes: ['已完成的工序不會被自動推移。', '工序上出現「缺料」標記，表示綁在這道工序的建材交期晚於它的開工日。']
  }
});

projectScopedPage('sitelog', {
  title: '工地日報與照片', module: 'sitelog', sub: '每天一份，照片按工序歸檔',
  help: {
    intro: '照片不是紀念品，是證據。封板前的水電照、拆除前的原況照，日後爭議時「有沒有拍」決定的是幾萬到幾十萬的責任歸屬。',
    steps: ['每天收工前按「填今日日報」：天氣、出工人數、進場工種、進度與現場狀況。隔天補填就把日期改掉。',
      '按「上傳照片」選階段（施工前／施工中／完工／缺失／隱蔽工程），可以綁工序，一次最多 20 張。',
      '不想給業主看的內部佐證照，取消勾選「業主端看得到」。'],
    notes: ['同一天重複填日報會覆蓋前一份，不會產生兩份互相矛盾的紀錄。',
      '照片預設業主端看得到；內部佐證照可以取消勾選。']
  }
});

projectScopedPage('subcontracts', {
  title: '發包與估驗', module: 'subcontracts', sub: '發包單、估驗計價、保留款與保固金',
  help: {
    intro: '付給工班的錢有三層：本期估驗（做了多少）→ 扣保留款／保固金／缺失求償 → 實付。分開記才對得起來。',
    steps: ['先建發包單（可只填總價），工班進場後每期做一次估驗。',
      '估驗填的是「累計完成％」，本期金額由系統用累計減前期算出來 —— 工班重複計價會自然被擋掉。',
      '缺失單上勾了「向工班求償」，估驗時可以直接勾選一併扣款，而且不會被扣第二次。',
      '完工驗收後退保留款，保固期滿後退保固金。'],
    terms: [['保留款', '每期估驗先扣下一定比例，完工驗收無誤後退還。'],
      ['保固保證金', '保固期間押著的金額，期滿沒問題才退。']]
  }
});

projectScopedPage('billing', {
  title: '請款與收款', module: 'billing', sub: '請款節點綁工進，到了系統自己叫',
  help: {
    intro: '裝修業的現金流問題八成不是客戶賴帳，是自己忘記請款。把節點綁在工序上，工進到了系統隔天就提醒。',
    steps: ['新案子按「套用範本」帶入訂金／開工／木作進場／驗收／尾款五個節點。',
      '把節點綁到對應的工序，該工序一開工就會自動變成「可請款」並產生待辦。',
      '開單請款後才算應收；約定收款期限過了沒收足，就會進入逾期催收。'],
    notes: ['追加款不在節點裡。登錄收款時「對應節點」留空，系統會自動歸到已簽認追加的那一段。']
  }
});

projectScopedPage('drawings', {
  title: '圖面與許可', module: 'drawings', sub: '只有一個現行版本，發布留痕',
  help: {
    intro: '同一張圖只會有一個現行版本，上傳新版時舊版自動退位；發布給哪些工班、什麼時候發的都留紀錄。',
    steps: ['按「上傳新版圖面」，圖面名稱相同就會被視為同一張圖的新版本，舊版自動退位。',
      '發圖給工班後按「發布」登錄發給了誰、什麼時候發的 —— 工班拿舊圖施工時，這筆紀錄決定責任在誰。',
      '要讓業主看得到的，勾「業主可見」；業主端只看得到現行版本。'],
    notes: ['接受 jpg／png／webp／heic／gif／pdf，單檔 25MB。',
      '許可與法規在同一個分頁下方：有效期限填了，到期前七天系統才會提醒。']
  }
});
