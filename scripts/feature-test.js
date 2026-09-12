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
