// 建立管理員與一整套示範資料。
// 示範資料刻意做成「一個進行中的案子該長什麼樣」：合約簽了、工序排了、
// 追加單一張已簽一張待簽、請款收了兩期、發包估驗過、缺失還沒改完。
// 這樣打開系統就看得到每一頁的實際用法，不是一堆空白表格。
const bcrypt = require('bcryptjs');
const { db, today, shiftDate, addMonths, nextSerial, randomToken, setSetting } = require('../src/db');
const { insert } = require('../src/crud');

const RESET = process.argv.includes('--reset');

if (RESET) {
  const tables = ['photos', 'site_logs', 'material_orders', 'defects', 'drawings', 'permits', 'warranties',
    'retention_releases', 'valuations', 'sub_items', 'subcontracts', 'receipts', 'billing_milestones',
    'change_items', 'change_orders', 'quote_items', 'quotes', 'contracts', 'schedule_items',
    'project_expenses', 'tasks', 'projects', 'customers', 'vendors', 'unit_prices'];
  db.pragma('foreign_keys = OFF');
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
  db.exec(`DELETE FROM sqlite_sequence WHERE name IN (${tables.map(t => `'${t}'`).join(',')})`);
  db.pragma('foreign_keys = ON');
  console.log('已清空示範資料');
}

// ---- 帳號 ----
function ensureUser(u) {
  const e = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
  if (e) return e.id;
  return db.prepare(`INSERT INTO users (username, password_hash, name, title, role, phone, permissions)
    VALUES (?,?,?,?,?,?,?)`).run(u.username, bcrypt.hashSync(u.password, 10), u.name, u.title,
    u.role, u.phone || '', JSON.stringify(u.modules || [])).lastInsertRowid;
}

const adminId = ensureUser({ username: 'admin', password: 'admin123', name: '王總', title: '負責人', role: 'admin' });
const designerId = ensureUser({
  username: 'designer', password: 'design123', name: '林設計', title: '主任設計師', role: 'staff',
  modules: ['dashboard', 'projects', 'schedule', 'sitelog', 'tasks', 'customers', 'quotes', 'unitprices',
    'changes', 'billing', 'drawings', 'permits', 'defects', 'warranty', 'materials', 'profit']
});
const foremanId = ensureUser({
  username: 'foreman', password: 'work123', name: '陳工務', title: '工務主任', role: 'staff',
  modules: ['dashboard', 'projects', 'schedule', 'sitelog', 'tasks', 'vendors', 'subcontracts',
    'materials', 'defects', 'warranty', 'drawings']
});

if (!RESET && db.prepare('SELECT COUNT(*) AS n FROM projects').get().n) {
  console.log('已有資料，只確認帳號。要重建示範資料請加 --reset');
  process.exit(0);
}

setSetting('company_name', '宅匠室內裝修');
setSetting('ui_login_sub', '室內設計／裝修工程營運管理系統');
setSetting('ui_demo_hint', '示範帳號：admin / admin123（負責人）、designer / design123（設計師）、foreman / work123（工務）');

// ---- 工項單價庫 ----
const UNITS = [
  ['拆除', '室內全室拆除', '含垃圾清運', '坪', 1200, 1800, 1800, 2600],
  ['拆除', '磚牆拆除', '含清運', 'm2', 200, 500, 350, 750],
  ['泥作', '浴室防水', '彈泥兩底三度', 'm2', 350, 450, 600, 700],
  ['泥作', '地磚鋪設', '60x60 拋光石英磚', '坪', 2800, 2200, 4200, 3200],
  ['泥作', '砌磚牆', '1/2B 紅磚', 'm2', 450, 900, 700, 1400],
  ['水電', '全室水電重配', '含配電箱', '坪', 1500, 2500, 2400, 3800],
  ['水電', '燈具安裝', '單一迴路', '只', 0, 350, 0, 550],
  ['木作', '天花板平釘', '矽酸鈣板', '坪', 1400, 1600, 2200, 2600],
  ['木作', '木作櫃體', '木心板噴漆', '尺', 2200, 1800, 3600, 2900],
  ['木作', '木地板', '超耐磨 8mm', '坪', 2600, 800, 4200, 1200],
  ['油漆', '全室批土油漆', 'ICI 乳膠漆兩底兩面', '坪', 400, 900, 700, 1500],
  ['系統櫃', '系統衣櫃', 'EGGER 板材', '尺', 3200, 600, 5200, 900],
  ['廚具', '廚具三件組', '含檯面水槽爐具', '式', 78000, 12000, 118000, 18000],
  ['衛浴', '衛浴設備組', '和成馬桶面盆龍頭', '套', 32000, 6000, 48000, 9000],
  ['空調', '分離式冷氣', '含管線施工', '台', 32000, 6000, 45000, 9000],
  ['玻璃鋁窗', '氣密窗更換', '隔音 30dB', '才', 380, 120, 620, 200],
  ['窗簾', '調光捲簾', '', '才', 180, 40, 320, 80],
  ['清潔', '工程細清', '', '坪', 0, 350, 0, 550],
  ['清潔', '保護工程', '', '坪', 180, 220, 320, 380]
];
for (const [category, name, spec, unit, mc, lc, mp, lp] of UNITS) {
  insert('unit_prices', {
    category, name, spec, unit, material_cost: mc, labor_cost: lc, material_price: mp, labor_price: lp
  });
}

// ---- 工班 ----
const VENDORS = [
  ['大昌拆除工程行', 'sub', '拆除', '張大昌', '0912-345-678', 4, shiftDate(today(), 200), 1],
  ['信宏泥作', 'sub', '泥作', '李信宏', '0922-111-222', 5, shiftDate(today(), 120), 1],
  ['全泰水電', 'sub', '水電', '吳全泰', '0933-222-333', 4, shiftDate(today(), -20), 1],
  ['匠心木作', 'sub', '木作', '黃師傅', '0955-444-555', 5, shiftDate(today(), 300), 1],
  ['亮彩油漆', 'sub', '油漆', '劉先生', '0966-555-666', 3, '', 0],
  ['歐德系統櫃', 'supplier', '系統櫃', '業務 小周', '02-2700-1234', 4, '', 0],
  ['台灣櫻花廚具', 'supplier', '廚具', '門市 陳小姐', '02-2555-8888', 4, '', 0],
  ['日立冷氣經銷', 'supplier', '空調', '工程部', '02-2999-1111', 4, shiftDate(today(), 90), 1],
  ['潔淨清潔', 'sub', '清潔', '王大姐', '0977-888-999', 4, '', 0]
];
const vendorId = {};
for (const [name, kind, trade, contact, phone, rating, exp, insured] of VENDORS) {
  vendorId[trade] = insert('vendors', {
    name, kind, trade, contact, phone, rating, liability_expiry: exp, labor_insured: insured
  });
}

// ---- 客戶與案場 ----
const cust1 = insert('customers', {
  name: '陳先生', phone: '0910-123-456', email: 'chen@example.com',
  address: '台北市內湖區行善路 100 號 12 樓', source: '口碑介紹'
});
const cust2 = insert('customers', {
  name: '李小姐', phone: '0920-987-654', address: '新北市板橋區文化路二段 50 號', source: 'Instagram'
});
const cust3 = insert('customers', {
  name: '御品餐飲有限公司', phone: '02-2758-0000', tax_id: '54321098',
  address: '台北市大安區忠孝東路四段 200 號 1 樓', source: '建商合作'
});

const start = shiftDate(today(), -45);

const pj1 = insert('projects', {
  code: nextSerial('projects', 'code', 'PJ'), name: '內湖陳宅 全室翻修', customer_id: cust1,
  address: '台北市內湖區行善路 100 號 12 樓', site_type: '中古屋翻修', area_ping: 32, style: '現代簡約',
  designer_id: designerId, supervisor_id: foremanId, status: 'construction',
  sign_date: shiftDate(today(), -60), start_date: start, due_date: shiftDate(start, 90),
  warranty_months: 12, client_token: randomToken()
});

const pj2 = insert('projects', {
  code: nextSerial('projects', 'code', 'PJ'), name: '板橋李宅 新成屋', customer_id: cust2,
  address: '新北市板橋區文化路二段 50 號', site_type: '新成屋', area_ping: 25, style: '北歐',
  designer_id: designerId, supervisor_id: foremanId, status: 'design'
});

const pj3 = insert('projects', {
  code: nextSerial('projects', 'code', 'PJ'), name: '大安御品 餐廳商空', customer_id: cust3,
  address: '台北市大安區忠孝東路四段 200 號 1 樓', site_type: '商業空間', area_ping: 48,
  designer_id: designerId, supervisor_id: foremanId, status: 'acceptance',
  sign_date: shiftDate(today(), -150), start_date: shiftDate(today(), -140),
  due_date: shiftDate(today(), -10), warranty_months: 24
});

// ---- 估價單與合約（內湖陳宅）----
const q1 = insert('quotes', {
  project_id: pj1, quote_no: nextSerial('quotes', 'quote_no', 'QT'), version: 1, kind: 'build',
  status: 'superseded', quote_date: shiftDate(today(), -75), tax_type: 'included', created_by: designerId
});
const q2 = insert('quotes', {
  project_id: pj1, quote_no: nextSerial('quotes', 'quote_no', 'QT'), version: 2, kind: 'build',
  status: 'accepted', quote_date: shiftDate(today(), -65), decided_at: shiftDate(today(), -60),
  tax_type: 'included', created_by: designerId
});
const QITEMS = [
  ['拆除', '室內全室拆除', '含垃圾清運', '坪', 32, 4400, 3000],
  ['泥作', '浴室防水', '彈泥兩底三度', 'm2', 36, 1300, 800],
  ['泥作', '地磚鋪設', '60x60 拋光石英磚', '坪', 18, 7400, 5000],
  ['水電', '全室水電重配', '含配電箱', '坪', 32, 6200, 4000],
  ['木作', '天花板平釘', '矽酸鈣板', '坪', 26, 4800, 3000],
  ['木作', '木作櫃體', '木心板噴漆', '尺', 42, 6500, 4000],
  ['木作', '木地板', '超耐磨 8mm', '坪', 20, 5400, 3400],
  ['油漆', '全室批土油漆', '乳膠漆兩底兩面', '坪', 32, 2200, 1300],
  ['系統櫃', '系統衣櫃', 'EGGER 板材', '尺', 30, 6100, 3800],
  ['廚具', '廚具三件組', '含檯面水槽爐具', '式', 1, 136000, 90000],
  ['衛浴', '衛浴設備組', '和成', '套', 2, 57000, 38000],
  ['空調', '分離式冷氣', '含管線', '台', 3, 54000, 38000],
  ['清潔', '保護工程', '', '坪', 32, 700, 400],
  ['清潔', '工程細清', '', '坪', 32, 550, 350]
];
for (const qid of [q1, q2]) {
  let seq = 0;
  for (const [category, name, spec, unit, qty, price, cost] of QITEMS) {
    seq++;
    const p = qid === q1 ? Math.round(price * 1.08) : price;   // 第一版報得比較高，客戶殺價後成交
    insert('quote_items', {
      quote_id: qid, seq, category, name, spec, unit, qty,
      unit_price: p, unit_cost: cost, amount: Math.round(qty * p), cost_amount: Math.round(qty * cost)
    });
  }
}
const { recalcQuote } = require('../src/routes/quotes');
recalcQuote(q1); recalcQuote(q2);
const q2row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(q2);

const ct1 = insert('contracts', {
  project_id: pj1, contract_no: nextSerial('contracts', 'contract_no', 'CT'), kind: 'build',
  quote_id: q2, sign_date: shiftDate(today(), -60), amount: q2row.total, work_days: 90,
  penalty_per_day: 3000, status: 'active', note: '含設計監造'
});

// ---- 工序 ----
const SCHEDULE = [
  ['保護工程', '清潔', 2, 0], ['拆除', '拆除', 4, 0], ['泥作', '泥作', 12, 0],
  ['水電配管', '水電', 8, 0], ['鋁窗玻璃', '玻璃鋁窗', 3, 0], ['木作', '木作', 20, 0],
  ['油漆', '油漆', 12, 2], ['系統櫃安裝', '系統櫃', 4, 0], ['廚具衛浴', '廚具', 4, 0],
  ['地板', '木作', 3, 0], ['空調', '空調', 3, 0], ['細清', '清潔', 2, 0], ['驗收點交', '清潔', 2, 0]
];
let cursor = start, prev = null, seq = 0;
const schedIds = {};
for (const [name, trade, days, lag] of SCHEDULE) {
  seq++;
  const s = prev ? shiftDate(cursor, lag) : cursor;
  const e = shiftDate(s, days - 1);
  const done = e < today();
  const working = !done && s <= today();
  const id = insert('schedule_items', {
    project_id: pj1, seq, name, trade, vendor_id: vendorId[trade] || null,
    planned_start: s, planned_end: e, predecessor_id: prev, lag_days: lag, weight: days,
    actual_start: (done || working) ? s : '', actual_end: done ? e : '',
    progress: done ? 100 : working ? 45 : 0,
    status: done ? 'done' : working ? 'working' : 'pending'
  });
  schedIds[name] = id;
  prev = id;
  cursor = shiftDate(e, 1);
}

// ---- 請款節點 ----
const MS = [['訂金', 30], ['開工款', 30], ['木作進場', 20], ['完工驗收', 15], ['交屋尾款', 5]];
const msIds = [];
let msSeq = 0;
for (const [name, pct] of MS) {
  msSeq++;
  msIds.push(insert('billing_milestones', {
    project_id: pj1, seq: msSeq, name, basis: 'percent', percent: pct,
    trigger_item_id: name === '木作進場' ? schedIds['木作'] : null,
    trigger_on: 'start',
    planned_date: msSeq === 1 ? shiftDate(today(), -60) : msSeq === 2 ? start : ''
  }));
}
// 前兩期已收，第三期已開單但逾期未收 —— 這是最需要被看見的狀態
const amt = pct => Math.round(q2row.total * pct / 100);
db.prepare("UPDATE billing_milestones SET status='paid', invoiced_date=?, due_date=? WHERE id=?")
  .run(shiftDate(today(), -60), shiftDate(today(), -55), msIds[0]);
db.prepare("UPDATE billing_milestones SET status='paid', invoiced_date=?, due_date=? WHERE id=?")
  .run(start, shiftDate(start, 5), msIds[1]);
db.prepare("UPDATE billing_milestones SET status='invoiced', invoiced_date=?, due_date=?, invoice_no=? WHERE id=?")
  .run(shiftDate(today(), -18), shiftDate(today(), -11), 'AB-12345678', msIds[2]);
insert('receipts', { project_id: pj1, milestone_id: msIds[0], date: shiftDate(today(), -58), amount: amt(30), method: '匯款' });
insert('receipts', { project_id: pj1, milestone_id: msIds[1], date: shiftDate(start, 2), amount: amt(30), method: '匯款' });

// ---- 追加減帳：一張已簽、一張待簽 ----
const co1 = insert('change_orders', {
  project_id: pj1, no: nextSerial('change_orders', 'no', 'CO'), title: '主臥增設更衣間隔間與系統櫃',
  reason: 'client', detail: '業主現場決定將主臥次要空間改為更衣間，增加隔間牆、木作門片與系統櫃 12 尺。',
  status: 'signed', sent_at: shiftDate(today(), -25), signed_at: shiftDate(today(), -23) + ' 14:20',
  signed_name: '陳先生', sign_channel: 'client', sign_ip: '203.0.113.24', days_delay: 5, created_by: designerId
});
for (const [kind, name, unit, qty, price, cost] of [
  ['add', '主臥更衣間隔間（含門片）', '式', 1, 48000, 32000],
  ['add', '系統衣櫃加作', '尺', 12, 6100, 3800]
]) {
  insert('change_items', {
    change_id: co1, kind, name, unit, qty, unit_price: price, unit_cost: cost,
    amount: Math.round(qty * price), cost_amount: Math.round(qty * cost)
  });
}
const co2 = insert('change_orders', {
  project_id: pj1, no: nextSerial('change_orders', 'no', 'CO'), title: '客廳電視牆改為大理石美耐板',
  reason: 'client', detail: '業主看樣後要求變更建材，扣除原木作噴漆做法。',
  status: 'sent', sent_at: shiftDate(today(), -6), days_delay: 2, created_by: designerId
});
for (const [kind, name, unit, qty, price, cost] of [
  ['add', '電視牆大理石美耐板', 'm2', 9, 4800, 3100],
  ['deduct', '原木作噴漆電視牆（扣除）', 'm2', 9, 2600, 1600]
]) {
  const sign = kind === 'deduct' ? -1 : 1;
  insert('change_items', {
    change_id: co2, kind, name, unit, qty, unit_price: price, unit_cost: cost,
    amount: sign * Math.round(qty * price), cost_amount: sign * Math.round(qty * cost)
  });
}
const { recalcChange } = require('../src/routes/changes');
recalcChange(co1); recalcChange(co2);

// ---- 發包與估驗 ----
const SUBS = [
  ['拆除', 96000, 'done', 100], ['泥作', 268000, 'working', 80], ['水電', 182000, 'working', 70],
  ['木作', 420000, 'working', 35], ['油漆', 92000, 'draft', 0], ['清潔', 38000, 'draft', 0]
];
for (const [trade, amount, status, pct] of SUBS) {
  const sid = insert('subcontracts', {
    project_id: pj1, vendor_id: vendorId[trade] || null,
    no: nextSerial('subcontracts', 'no', 'SC'), trade, scope: `${trade}工程全項`,
    amount, retention_pct: 10, warranty_pct: 5, sign_date: shiftDate(today(), -50),
    start_date: start, status
  });
  if (!pct) continue;
  const cum = Math.round(amount * pct / 100);
  const retention = Math.round(cum * 0.1);
  const warranty = Math.round(cum * 0.05);
  insert('valuations', {
    subcontract_id: sid, period: today().slice(0, 7), date: shiftDate(today(), -8),
    cum_progress: pct, cum_amount: cum, gross_amount: cum, retention, warranty_hold: warranty,
    deduction: 0, net_amount: cum - retention - warranty,
    status: trade === '拆除' ? 'paid' : 'confirmed',
    paid_date: trade === '拆除' ? shiftDate(today(), -5) : ''
  });
}

// ---- 建材訂料（一項交期來不及）----
insert('material_orders', {
  project_id: pj1, vendor_id: vendorId['系統櫃'], schedule_item_id: schedIds['系統櫃安裝'],
  name: '系統衣櫃板材', spec: 'EGGER 淺橡木', qty: 1, unit: '式', unit_price: 118000, amount: 118000,
  need_date: db.prepare('SELECT planned_start AS v FROM schedule_items WHERE id = ?').get(schedIds['系統櫃安裝']).v,
  order_date: shiftDate(today(), -10), eta_date: shiftDate(today(), 40), status: 'ordered'
});
insert('material_orders', {
  project_id: pj1, vendor_id: vendorId['廚具'], schedule_item_id: schedIds['廚具衛浴'],
  name: '櫻花廚具三件組', qty: 1, unit: '式', unit_price: 90000, amount: 90000,
  need_date: db.prepare('SELECT planned_start AS v FROM schedule_items WHERE id = ?').get(schedIds['廚具衛浴']).v,
  status: 'planned'
});
insert('material_orders', {
  project_id: pj1, vendor_id: vendorId['空調'], schedule_item_id: schedIds['空調'],
  name: '日立變頻分離式 3 台', qty: 3, unit: '台', unit_price: 38000, amount: 114000,
  need_date: db.prepare('SELECT planned_start AS v FROM schedule_items WHERE id = ?').get(schedIds['空調']).v,
  order_date: shiftDate(today(), -12), eta_date: shiftDate(today(), 20), status: 'ordered'
});

// ---- 工地日報 ----
for (let i = 1; i <= 6; i++) {
  insert('site_logs', {
    project_id: pj1, date: shiftDate(today(), -i), weather: i % 3 === 0 ? '雨' : '晴',
    workers: 4 + (i % 3), trades: i % 2 ? '木作,水電' : '木作',
    progress_note: i % 2 ? '主臥天花板骨架完成，客廳造型牆放樣。' : '木作櫃體進場組立，水電配合收邊。',
    issue_note: i === 2 ? '雨天影響外牆窗框收邊，順延一天。' : '',
    created_by: foremanId
  });
}

// ---- 缺失（含一筆要跟工班求償）----
insert('defects', {
  project_id: pj1, no: nextSerial('defects', 'no', 'DF'), source: 'self', location: '主浴',
  item: '地坪洩水坡度不足', description: '試水後靠牆側積水，需重新洩水。',
  vendor_id: vendorId['泥作'], owner_id: foremanId, severity: 'high',
  found_date: shiftDate(today(), -12), due_date: shiftDate(today(), -3),
  cost: 8000, charge_vendor: 1, status: 'fixing'
});
insert('defects', {
  project_id: pj1, no: nextSerial('defects', 'no', 'DF'), source: 'client', location: '客廳',
  item: '插座位置與圖面不符', description: '電視牆插座偏移 30 公分。',
  vendor_id: vendorId['水電'], owner_id: foremanId, severity: 'normal',
  found_date: shiftDate(today(), -5), due_date: shiftDate(today(), 3), status: 'open'
});

// ---- 許可 ----
insert('permits', {
  project_id: pj1, kind: '室內裝修審查許可', agency: '台北市建管處', doc_no: '北市裝字第 11200456 號',
  applied_date: shiftDate(today(), -70), approved_date: shiftDate(today(), -50),
  expiry_date: shiftDate(today(), 5), owner_id: designerId, status: 'approved',
  note: '有效期限內須完成竣工查驗'
});
insert('permits', {
  project_id: pj1, kind: '大樓施工申請', agency: '社區管委會',
  applied_date: shiftDate(today(), -48), approved_date: shiftDate(today(), -46),
  expiry_date: shiftDate(today(), 45), owner_id: foremanId, status: 'approved', note: '押金 5 萬元'
});

// ---- 保固（大安御品：已交屋，保固中）----
db.prepare("UPDATE projects SET status='warranty', handover_date=?, actual_end_date=? WHERE id=?")
  .run(shiftDate(today(), -20), shiftDate(today(), -25), pj3);
for (const [item, trade, months] of [['防水工程', '泥作', 60], ['木作工程', '木作', 24], ['空調設備', '空調', 12]]) {
  const s = shiftDate(today(), -20);
  insert('warranties', {
    project_id: pj3, item, vendor_id: vendorId[trade] || null, start_date: s, months, end_date: addMonths(s, months)
  });
}
const ct3 = insert('contracts', {
  project_id: pj3, contract_no: nextSerial('contracts', 'contract_no', 'CT'), kind: 'build',
  sign_date: shiftDate(today(), -150), amount: 2860000, work_days: 130, status: 'active'
});
insert('billing_milestones', { project_id: pj3, seq: 1, name: '訂金', basis: 'percent', percent: 30, status: 'paid' });
insert('billing_milestones', { project_id: pj3, seq: 2, name: '期中款', basis: 'percent', percent: 40, status: 'paid' });
insert('billing_milestones', {
  project_id: pj3, seq: 3, name: '驗收尾款', basis: 'percent', percent: 30, status: 'invoiced',
  invoiced_date: shiftDate(today(), -20), due_date: shiftDate(today(), -6), invoice_no: 'AB-99887766'
});
insert('receipts', { project_id: pj3, date: shiftDate(today(), -145), amount: 858000, method: '匯款' });
insert('receipts', { project_id: pj3, date: shiftDate(today(), -70), amount: 1144000, method: '匯款' });
insert('subcontracts', {
  project_id: pj3, vendor_id: vendorId['泥作'], no: nextSerial('subcontracts', 'no', 'SC'),
  trade: '泥作', scope: '全室泥作', amount: 620000, status: 'done', retention_pct: 10, warranty_pct: 5
});
insert('project_expenses', {
  project_id: pj1, date: shiftDate(today(), -40), category: '規費', item: '室內裝修審查規費', amount: 18000
});
insert('project_expenses', {
  project_id: pj1, date: shiftDate(today(), -35), category: '垃圾清運', item: '拆除廢棄物清運 3 車', amount: 27000
});
insert('project_expenses', {
  project_id: pj1, date: shiftDate(today(), -30), category: '機具租賃', item: '吊車吊運鋁窗', amount: 12000
});

// ---- 自動提醒跑一次，讓待辦一開始就有東西 ----
require('../src/reminders').run();

const { projectMoney } = require('../src/finance');
const m = projectMoney(pj1);
console.log('示範資料建立完成');
console.log(`  內湖陳宅：合約 ${m.contract_amount.toLocaleString()} + 已簽追加 ${m.change_signed.toLocaleString()}`
  + ` = ${m.contract_total.toLocaleString()}；已收 ${m.received.toLocaleString()}，應收 ${m.receivable.toLocaleString()}`
  + `，毛利 ${m.gross_profit.toLocaleString()}（${m.margin}%）`);
console.log(`  業主端連結：/client.html#${db.prepare('SELECT client_token AS v FROM projects WHERE id = ?').get(pj1).v}`);
console.log('  帳號：admin/admin123、designer/design123、foreman/work123');
