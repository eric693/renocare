// 端到端流程測試：直接打 API，走完一個案子從估價到結案會經過的每一步。
// 重點不在「有沒有回 200」，而在「錢算得對不對」——
// 未簽認的追加不能進合約、估驗不能重複計價、扣款不能扣兩次、逾期要算得出來。
const http = require('http');

const PORT = process.env.PORT || 3490;
let cookie = '';
let pass = 0, fail = 0;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, path, method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }
    }, res => {
      if (res.headers['set-cookie']) cookie = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch { /* 非 JSON 就留 null */ }
        resolve({ status: res.statusCode, body: json, raw: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// 上傳走 multipart，跟其他 API 不同，所以另外包一支
function upload(path, fields, files) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  for (const [field, name, buf] of files) fd.append(field, new Blob([buf]), name);
  return fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', headers: { Cookie: cookie }, body: fd })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
}

// 最小的合法 PNG，不必在 repo 裡放二進位測試檔
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  + '0000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex');

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '　' + extra : '')); }
}
const eq = (name, a, b) => ok(`${name}（${a} = ${b}）`, a === b);

(async () => {
  console.log('登入');
  let r = await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  ok('管理員登入', r.status === 200);
  ok('錯誤密碼被擋', (await req('POST', '/api/login', { username: 'admin', password: 'x' })).status === 401);

  console.log('\n建立測試案場');
  const cust = (await req('POST', '/api/customers', { name: '測試業主', phone: '0900-000-000' })).body.id;
  const pj = (await req('POST', '/api/projects', {
    name: '測試案 全室', customer_id: cust, area_ping: 30, status: 'construction',
    start_date: '2026-01-01', due_date: '2026-04-01'
  })).body;
  ok('案場編號自動產生', /^PJ-\d{6}-\d{3}$/.test(pj.code), pj.code);

  console.log('\n估價單：金額由明細重算');
  const q = (await req('POST', '/api/quotes', { project_id: pj.id, tax_type: 'included' })).body;
  await req('POST', `/api/quotes/${q.id}/items`, { name: '木作', unit: '尺', qty: 10, unit_price: 6000, unit_cost: 4000 });
  await req('POST', `/api/quotes/${q.id}/items`, { name: '油漆', unit: '坪', qty: 30, unit_price: 2000, unit_cost: 1200 });
  let qd = (await req('GET', `/api/quotes/${q.id}`)).body;
  eq('估價總額', qd.total, 120000);
  eq('預估成本', qd.cost_total, 76000);
  // 前端亂送 amount 不會被採用
  await req('PUT', `/api/quote-items/${qd.items[0].id}`, { name: '木作', unit: '尺', qty: 10, unit_price: 6000, unit_cost: 4000, amount: 999999 });
  qd = (await req('GET', `/api/quotes/${q.id}`)).body;
  eq('明細金額只由數量×單價決定', qd.items[0].amount, 60000);

  console.log('\n成交：自動產生合約，案子不能再改估價');
  await req('POST', `/api/quotes/${q.id}/status`, { status: 'accepted' });
  let det = (await req('GET', `/api/projects/${pj.id}/detail`)).body;
  eq('合約金額', det.money.contract_amount, 120000);
  ok('已成交的估價單不能再加明細',
    (await req('POST', `/api/quotes/${q.id}/items`, { name: 'x', qty: 1, unit_price: 1 })).status === 400);

  console.log('\n追加減帳：沒簽認不算錢');
  const co = (await req('POST', '/api/changes', { project_id: pj.id, title: '增設隔間', reason: 'client', days_delay: 3 })).body;
  await req('POST', `/api/changes/${co.id}/items`, { kind: 'add', name: '隔間牆', qty: 1, unit_price: 50000, unit_cost: 30000 });
  await req('POST', `/api/changes/${co.id}/items`, { kind: 'deduct', name: '原做法扣除', qty: 1, unit_price: 8000, unit_cost: 5000 });
  det = (await req('GET', `/api/projects/${pj.id}/detail`)).body;
  eq('變更單淨額（追加 50000 − 減帳 8000）', det.changes[0].amount, 42000);
  eq('未簽認時合約總價不變', det.money.contract_total, 120000);
  eq('未簽認金額另外列出', det.money.change_pending, 42000);

  await req('POST', `/api/changes/${co.id}/status`, { status: 'sent' });
  await req('POST', `/api/changes/${co.id}/status`, { status: 'signed', signed_name: '測試業主' });
  det = (await req('GET', `/api/projects/${pj.id}/detail`)).body;
  eq('簽認後併入合約總價', det.money.contract_total, 162000);
  eq('簽認後工期自動展延 3 天', det.project.due_date, '2026-04-04');
  ok('已簽認的變更單不能改',
    (await req('PUT', `/api/changes/${co.id}`, { title: '偷改' })).status === 400);

  console.log('\n請款節點與逾期');
  await req('POST', '/api/milestones/apply-template', { project_id: pj.id });
  det = (await req('GET', `/api/projects/${pj.id}/detail`)).body;
  const ms = det.money.milestones;
  eq('節點金額＝原合約 × 比例（訂金 30%）', ms[0].amount, 36000);
  eq('節點合計等於原合約', ms.reduce((a, x) => a + x.amount, 0), 120000);
  ok('未開單時不算應收', det.money.receivable === 42000, `實際 ${det.money.receivable}`);   // 只有已簽追加

  await req('POST', `/api/milestones/${ms[0].id}/invoice`, { invoiced_date: '2026-01-05', due_date: '2026-01-10' });
  det = (await req('GET', `/api/projects/${pj.id}/detail`)).body;
  eq('開單後應收＝節點 36000 ＋ 已簽追加 42000', det.money.receivable, 78000);
  eq('期限已過視為逾期', det.money.overdue, 36000);

  await req('POST', '/api/receipts', { project_id: pj.id, milestone_id: ms[0].id, date: '2026-01-08', amount: 36000 });
  det = (await req('GET', `/api/projects/${pj.id}/detail`)).body;
  eq('收足後節點結清', det.money.milestones[0].status, 'paid');
  eq('逾期歸零', det.money.overdue, 0);
  eq('剩下的應收是追加那一段', det.money.receivable, 42000);

  await req('POST', '/api/receipts', { project_id: pj.id, date: '2026-01-20', amount: 42000 });
  det = (await req('GET', `/api/projects/${pj.id}/detail`)).body;
  eq('追加款收了之後應收歸零', det.money.receivable, 0);

  console.log('\n發包與估驗：累計制擋掉重複計價');
  const vd = (await req('POST', '/api/vendors', { name: '測試木作', kind: 'sub', trade: '木作' })).body.id;
  const sc = (await req('POST', '/api/subcontracts', {
    project_id: pj.id, vendor_id: vd, trade: '木作', retention_pct: 10, warranty_pct: 5, status: 'signed'
  })).body;
  await req('PUT', `/api/subcontracts/${sc.id}/amount`, { amount: 100000 });
  let v1 = (await req('POST', `/api/subcontracts/${sc.id}/valuations`, { cum_progress: 40 })).body;
  eq('第一期本期估驗', v1.gross, 40000);
  eq('扣保留款 10%', v1.retention, 4000);
  eq('扣保固金 5%', v1.warranty_hold, 2000);
  eq('實付', v1.net, 34000);
  let v2 = (await req('POST', `/api/subcontracts/${sc.id}/valuations`, { cum_progress: 70 })).body;
  eq('第二期只算增量（70% − 40%）', v2.gross, 30000);
  const bad = await req('POST', `/api/subcontracts/${sc.id}/valuations`, { cum_progress: 50 });
  ok('累計倒退被擋下', bad.status === 400, bad.body && bad.body.error);

  console.log('\n缺失求償：只扣一次');
  const df = (await req('POST', '/api/defects', {
    project_id: pj.id, item: '牆面不平', vendor_id: vd, cost: 5000, charge_vendor: 1
  })).body;
  let dedu = (await req('GET', `/api/subcontracts/${sc.id}/deductions`)).body;
  eq('有一筆待扣', dedu.length, 1);
  const v3 = (await req('POST', `/api/subcontracts/${sc.id}/valuations`,
    { cum_progress: 100, defect_ids: String(df.id) })).body;
  eq('本期估驗', v3.gross, 30000);
  eq('缺失求償被扣下', v3.deduction, 5000);
  eq('實付＝30000 − 3000 − 1500 − 5000', v3.net, 20500);
  dedu = (await req('GET', `/api/subcontracts/${sc.id}/deductions`)).body;
  eq('同一筆缺失不會被扣第二次', dedu.length, 0);

  console.log('\n保留款：不能超退');
  const sub = (await req('GET', `/api/subcontracts/${sc.id}`)).body;
  eq('累計押著的保留款', sub.retention_held, 10000);
  eq('發包單估驗到 100% 自動標完工', sub.status, 'done');
  const over = await req('POST', `/api/subcontracts/${sc.id}/release`, { kind: 'retention', amount: 99999, force: 1 });
  ok('退超過押款金額被擋下', over.status === 400, over.body && over.body.error);

  console.log('\n工序延誤連動');
  await req('POST', '/api/schedule/apply-template', { project_id: pj.id, start_date: '2026-01-01' });
  let sch = (await req('GET', `/api/schedule?project_id=${pj.id}`)).body;
  const second = sch[1], third = sch[2];
  const before3 = third.planned_start;
  const rr = (await req('PUT', `/api/schedule/${second.id}`, {
    planned_end: shift(second.planned_end, 5), cascade: 1
  })).body;
  ok('後續工序一起被推移', rr.shifted > 0, `shifted=${rr.shifted}`);
  sch = (await req('GET', `/api/schedule?project_id=${pj.id}`)).body;
  eq('第三道工序往後 5 天', sch[2].planned_start, shift(before3, 5));

  console.log('\n專案損益');
  await req('POST', '/api/project-expenses', { project_id: pj.id, category: '規費', item: '審查規費', amount: 10000 });
  det = (await req('GET', `/api/projects/${pj.id}/detail`)).body;
  eq('成本＝發包 100000 ＋ 雜支 10000', det.money.cost_committed, 110000);
  eq('毛利＝162000 − 110000', det.money.gross_profit, 52000);

  console.log('\n業主端');
  const link = (await req('POST', `/api/projects/${pj.id}/client-link`)).body;
  const cl = await req('GET', `/api/client/${link.token}`);
  eq('業主端讀得到案子', cl.status, 200);
  ok('業主端看不到成本', cl.body.money.cost_committed === undefined && cl.body.money.gross_profit === undefined);
  eq('業主端看到的合約總價', cl.body.money.contract_total, 162000);
  ok('假 token 進不去', (await req('GET', '/api/client/' + 'f'.repeat(32))).status === 404);

  const co2 = (await req('POST', '/api/changes', { project_id: pj.id, title: '業主端簽認測試' })).body;
  await req('POST', `/api/changes/${co2.id}/items`, { kind: 'add', name: '加作', qty: 1, unit_price: 20000 });
  await req('POST', `/api/changes/${co2.id}/status`, { status: 'sent' });
  const signRes = await req('POST', `/api/client/${link.token}/changes/${co2.id}/sign`, { signed_name: '陳先生', agree: 1 });
  eq('業主線上簽認成功', signRes.status, 200);
  det = (await req('GET', `/api/projects/${pj.id}/detail`)).body;
  eq('線上簽認後併入合約總價', det.money.contract_total, 182000);
  ok('簽認留下軌跡', det.changes.find(c => c.id === co2.id).sign_channel === 'client');
  ok('重複簽認被擋',
    (await req('POST', `/api/client/${link.token}/changes/${co2.id}/sign`, { signed_name: 'x', agree: 1 })).status === 400);

  console.log('\n權限');
  await req('POST', '/api/logout');
  await req('POST', '/api/login', { username: 'foreman', password: 'work123' });
  ok('工務看不到專案損益', (await req('GET', '/api/profit')).status === 403);
  ok('工務看得到工地日報', (await req('GET', `/api/site-logs?project_id=${pj.id}`)).status === 200);

  console.log('\n上傳檔案與照片');
  // 隱蔽工程沒拍到照，日後的責任歸屬就是幾萬到幾十萬。所以上傳這條路徑
  // 從存檔、讀回、改資訊、刪除到「刪檔案」都要驗，錯誤訊息也要看得懂。
  const up1 = await upload('/api/photos',
    { project_id: pj.id, phase: 'before', caption: '拆除前原況', client_visible: 1 },
    [['files', '工地照 前.png', PNG], ['files', 'IMG_1234.JPG', PNG]]);
  eq('一次上傳兩張照片', up1.status, 200);
  ok('回傳兩個照片 id', up1.body && up1.body.ids && up1.body.ids.length === 2);
  const photos = (await req('GET', `/api/photos?project_id=${pj.id}`)).body
    .filter(p => up1.body.ids.includes(p.id));
  eq('照片讀得回來', photos.length, 2);
  ok('中文檔名換成不可猜的亂數（業主端沒有帳號，檔名就是保護）',
    photos.every(p => /^\/uploads\/[0-9a-f]{32}\.(png|jpg)$/.test(p.url)), photos[0].url);
  const fileRes = await fetch(`http://127.0.0.1:${PORT}${photos[0].url}`);
  eq('上傳的檔案真的取得到', fileRes.status, 200);
  ok('回傳的是圖片', String(fileRes.headers.get('content-type')).startsWith('image/'));

  await req('PUT', `/api/photos/${photos[0].id}`, { caption: '改過的說明', phase: 'hidden', client_visible: 0 });
  const edited = (await req('GET', `/api/photos?project_id=${pj.id}`)).body.find(p => p.id === photos[0].id);
  ok('照片資訊改得動', edited.caption === '改過的說明' && edited.phase === 'hidden' && !edited.client_visible);

  // 被擋下來的三種情況都要回 400 並說人話，不能是 500「系統發生錯誤」
  const badType = await upload('/api/photos', { project_id: pj.id }, [['files', '工地錄影.mov', PNG]]);
  eq('不支援的格式回 400', badType.status, 400);
  ok('訊息指名是哪個檔、能傳什麼', /工地錄影\.mov/.test(badType.body.error) && /\.heic/.test(badType.body.error),
    badType.body && badType.body.error);
  const tooBig = await upload('/api/photos', { project_id: pj.id },
    [['files', 'big.jpg', Buffer.alloc(26 * 1024 * 1024)]]);
  eq('超過單檔上限回 400', tooBig.status, 400);
  ok('訊息說得出上限是多少', /25MB/.test(tooBig.body.error), tooBig.body && tooBig.body.error);
  eq('沒選檔回 400', (await upload('/api/photos', { project_id: pj.id }, [])).status, 400);

  // 缺失照片：點交拍一張、改善後拍一張，複驗與求償靠的就是這個
  const dfList = (await req('GET', `/api/defects?project_id=${pj.id}`)).body;
  if (dfList.length) {
    const df = dfList[0];
    const up2 = await upload('/api/photos',
      { project_id: pj.id, defect_id: df.id, phase: 'defect' }, [['files', 'df.png', PNG]]);
    eq('缺失可以附照片', up2.status, 200);
    eq('照片查得到是哪一筆缺失的', (await req('GET', `/api/photos?defect_id=${df.id}`)).body.length, 1);
    eq('缺失清單的照片張數跟著動',
      (await req('GET', `/api/defects?project_id=${pj.id}`)).body.find(x => x.id === df.id).photo_count, 1);
    await req('DELETE', `/api/photos/${up2.body.ids[0]}`);
  } else ok('缺失可以附照片', true, '（沒有缺失，跳過）');

  // 圖面：同名上傳會讓舊版退位，現行版本永遠只有一個
  const dw1 = await upload('/api/drawings',
    { project_id: pj.id, name: '平面配置圖', category: '平面圖', client_visible: 1 },
    [['file', '平面配置圖.pdf', Buffer.from('%PDF-1.4\n%%EOF')]]);
  eq('圖面上傳成功', dw1.status, 200);
  const dw2 = await upload('/api/drawings',
    { project_id: pj.id, name: '平面配置圖', category: '平面圖', client_visible: 1 },
    [['file', '平面配置圖v2.pdf', Buffer.from('%PDF-1.4\n%%EOF')]]);
  const dws = (await req('GET', `/api/drawings?project_id=${pj.id}`)).body.filter(d => d.name === '平面配置圖');
  eq('同一張圖只有一個現行版本', dws.filter(d => d.is_current).length, 1);
  ok('現行版本是新上傳的那一版', dws.find(d => d.is_current).id === dw2.body.id);
  eq('圖面擋掉非圖非 PDF',
    (await upload('/api/drawings', { project_id: pj.id, name: 'x' }, [['file', 'x.exe', PNG]])).status, 400);

  // 刪除要連磁碟上的檔案一起收掉，不然工地照片會把硬碟塞爆
  const gone = photos[1].url;
  await req('DELETE', `/api/photos/${photos[1].id}`);
  await new Promise(r => setTimeout(r, 120));
  eq('刪照片連檔案一起刪掉', (await fetch(`http://127.0.0.1:${PORT}${gone}`)).status, 404);

  // 業主端：只看得到勾了「業主可見」的照片與圖面
  const clink = (await req('POST', `/api/projects/${pj.id}/client-link`)).body;
  const cv = await fetch(`http://127.0.0.1:${PORT}/api/client/${clink.client_token || clink.token}`);
  const cdata = await cv.json();
  ok('業主端看不到標為不可見的照片', !cdata.photos.some(p => p.caption === '改過的說明'),
    `業主端 ${cdata.photos.length} 張`);
  ok('業主端看得到可見的圖面', cdata.drawings.some(d => d.name === '平面配置圖'));

  console.log('\n搜尋與篩選');
  await req('POST', '/api/logout');                                  // 上一段還是工務的身分
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  // 清單頁的搜尋不是裝飾：找不到那張單，使用者就會改用 Excel 自己記一份。
  // 這裡驗「搜得到自己、搜不到別人」，避免哪天 SQL 改壞了變成永遠回全部。
  const miss = encodeURIComponent('不存在的關鍵字');
  const found = await req('GET', `/api/receivables?q=${encodeURIComponent(pj.code)}`);   // 案場代號是唯一的
  eq('應收搜尋只留下相符的案子', found.body.rows.length, 1);
  ok('應收合計跟著篩選走', found.body.sum.contract_total === found.body.rows[0].contract_total);
  eq('應收搜尋沒有誤中', (await req('GET', `/api/receivables?q=${miss}`)).body.rows.length, 0);
  ok('應收可以只看逾期', (await req('GET', '/api/receivables?bucket=overdue')).body.rows.every(r => r.overdue > 0));
  const dfAll = (await req('GET', `/api/defects?project_id=${pj.id}`)).body;
  if (dfAll.length) {
    const kw = dfAll[0].item.slice(0, 2);
    ok('缺失搜尋找得到', (await req('GET', `/api/defects?q=${encodeURIComponent(kw)}`)).body.some(d => d.id === dfAll[0].id));
  } else ok('缺失搜尋找得到', true, '（這個案子沒有缺失，跳過）');
  eq('缺失搜尋沒有誤中', (await req('GET', `/api/defects?q=${miss}`)).body.length, 0);
  eq('工班搜尋沒有誤中', (await req('GET', `/api/vendors?q=${miss}`)).body.length, 0);
  eq('待辦搜尋沒有誤中', (await req('GET', `/api/tasks?q=${miss}`)).body.length, 0);
  eq('操作紀錄可依身分篩選',
    (await req('GET', '/api/audit?actor_type=client')).body.every(r => r.actor_type === 'client'), true);

  console.log('\n帳號刪除的三道防線');
  const me = (await req('GET', '/api/users')).body.find(u => u.username === 'admin');
  eq('不能刪除自己', (await req('DELETE', `/api/users/${me.id}`)).status, 400);
  const tmp = (await req('POST', '/api/users',
    { username: 'tmp_del_test', name: '暫時帳號', password: 'tmp123456' })).body.id;
  const delFresh = await req('DELETE', `/api/users/${tmp}`);
  ok('沒做過事的帳號可以真的刪掉', delFresh.status === 200 && delFresh.body.deactivated === false);
  ok('刪掉之後就查不到', !(await req('GET', '/api/users')).body.some(u => u.id === tmp));
  const designer = (await req('GET', '/api/users')).body.find(u => u.username === 'designer');
  const delUsed = await req('DELETE', `/api/users/${designer.id}`);
  ok('有歷史紀錄的帳號改成停用而不是刪除',
    delUsed.status === 200 && delUsed.body.deactivated === true, delUsed.body && delUsed.body.message);
  ok('停用後歷史紀錄還指得到這個人',
    (await req('GET', '/api/users')).body.some(u => u.id === designer.id && !u.active));
  await req('PUT', `/api/users/${designer.id}`, { active: 1 });   // 還原，不要污染示範資料

  console.log('\n清理測試資料');
  await req('POST', '/api/logout');
  await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const del = await req('DELETE', `/api/projects/${pj.id}`);
  ok('有收付款紀錄的案子不能刪', del.status === 400, del.body && del.body.error);

  console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

function shift(d, n) {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
