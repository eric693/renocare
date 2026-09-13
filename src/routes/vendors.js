// 工班／廠商、發包單、估驗計價、保留款與保固金
//
// 發包這一側的錢有三層，混在一起就永遠對不起來：
//   本期估驗（做了多少）→ 扣保留款／保固金／缺失求償 → 實付
// 估驗一律填「累計完成％」而不是「本期金額」：工班報的金額常常重複計價，
// 用累計去減前期，重複的部分自然歸零，而且累計永遠不會超過發包總價。

const express = require('express');
const { db, audit, today, nextSerial, getSetting } = require('../db');
const { requireStaff } = require('../auth');
const { picker, insert, update, get, remove, lineAmount } = require('../crud');

const router = express.Router();

// ---- 工班／廠商 ----

const pickVendor = picker(['name', 'kind', 'trade', 'contact', 'phone', 'tax_id', 'bank_info', 'rating',
  'liability_expiry', 'labor_insured', 'note', 'active'], ['rating', 'labor_insured', 'active']);

// 這支刻意不綁模組權限：缺失要選責任工班、訂料要選廠商、雜支要選廠商，
// 這些模組的人都需要工班名單。但「需要一份名單」不等於「可以看匯款帳戶」——
// 沒有 vendors 模組的人只拿得到下拉選單需要的欄位。
const VENDOR_PICK_FIELDS = ['id', 'name', 'kind', 'trade', 'active'];

router.get('/vendors', requireStaff(), (req, res) => {
  const { trade = '', kind = '', q = '', active = '' } = req.query;
  const like = `%${String(q).trim()}%`;
  const rows = db.prepare(`SELECT v.*,
      (SELECT COUNT(*) FROM subcontracts s WHERE s.vendor_id = v.id) AS job_count,
      (SELECT COALESCE(SUM(s.amount),0) FROM subcontracts s WHERE s.vendor_id = v.id AND s.status <> 'draft') AS job_amount,
      (SELECT COUNT(*) FROM defects d WHERE d.vendor_id = v.id AND d.status IN ('open','fixing')) AS open_defects
    FROM vendors v
    WHERE (? = '' OR v.trade = ?) AND (? = '' OR v.kind = ? OR v.kind = 'both')
      AND (? = '' OR v.active = ?) AND (? = '' OR v.name LIKE ? OR v.contact LIKE ? OR v.phone LIKE ?)
    ORDER BY v.active DESC, v.trade, v.name`)
    .all(trade, trade, kind, kind, active, active, String(q).trim(), like, like, like);
  const t = today();
  for (const r of rows) {
    // 保險過期的工班還在派工，出事是公司扛 —— 清單上直接標出來
    r.insurance_expired = !!(r.liability_expiry && r.liability_expiry < t);
  }
  if (req.user.role !== 'admin' && !req.userModules.includes('vendors')) {
    return res.json(rows.map(r => Object.fromEntries(VENDOR_PICK_FIELDS.map(k => [k, r[k]]))));
  }
  res.json(rows);
});

router.post('/vendors', requireStaff('vendors'), (req, res) => {
  const v = pickVendor(req.body || {});
  if (!v.name) return res.status(400).json({ error: '請填廠商名稱' });
  res.json({ id: insert('vendors', v) });
});

router.put('/vendors/:id', requireStaff('vendors'), (req, res) => {
  if (!get('vendors', req.params.id)) return res.status(404).json({ error: '找不到此廠商' });
  update('vendors', Number(req.params.id), pickVendor(req.body || {}));
  res.json({ ok: true });
});

router.delete('/vendors/:id', requireStaff('vendors'), (req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM subcontracts WHERE vendor_id = ?').get(Number(req.params.id)).n;
  if (n) return res.status(400).json({ error: `這家廠商有 ${n} 張發包單，不能刪除；請改成停用` });
  remove('vendors', req.params.id);
  res.json({ ok: true });
});

// ---- 發包單 ----

const pickSub = picker(['project_id', 'vendor_id', 'trade', 'scope', 'retention_pct', 'warranty_pct',
  'sign_date', 'start_date', 'end_date', 'status', 'note'],
  ['project_id', 'vendor_id'], ['retention_pct', 'warranty_pct']);

function subDetail(id) {
  const s = db.prepare(`SELECT s.*, v.name AS vendor_name, v.phone AS vendor_phone, p.name AS project_name, p.code AS project_code
    FROM subcontracts s LEFT JOIN vendors v ON v.id = s.vendor_id JOIN projects p ON p.id = s.project_id
    WHERE s.id = ?`).get(id);
  if (!s) return null;
  s.items = db.prepare('SELECT * FROM sub_items WHERE subcontract_id = ? ORDER BY id').all(id);
  s.valuations = db.prepare('SELECT * FROM valuations WHERE subcontract_id = ? ORDER BY id').all(id);
  // 扣款欄存的是「手填扣款＋缺失求償」的合計，編輯表單要拆回手填的那一部分
  for (const v of s.valuations) {
    const ds = db.prepare('SELECT * FROM defects WHERE deducted_valuation_id = ?').all(v.id);
    const auto = new Set(ds.map(defectNote));
    v.defect_deduction = ds.reduce((a, d) => a + d.cost, 0);
    v.manual_deduction = v.deduction - v.defect_deduction;
    v.manual_note = v.deduct_note.split('；').filter(x => x && !auto.has(x)).join('；');
  }
  s.releases = db.prepare('SELECT * FROM retention_releases WHERE subcontract_id = ? ORDER BY id').all(id);
  const nd = s.valuations.filter(v => v.status !== 'draft');
  s.valued = nd.reduce((a, v) => a + v.gross_amount, 0);
  s.paid = s.valuations.filter(v => v.status === 'paid').reduce((a, v) => a + v.net_amount, 0);
  s.unpaid = s.valuations.filter(v => v.status === 'confirmed').reduce((a, v) => a + v.net_amount, 0);
  s.retention_held = nd.reduce((a, v) => a + v.retention, 0)
    - s.releases.filter(r => r.kind === 'retention').reduce((a, r) => a + r.amount, 0);
  s.warranty_held = nd.reduce((a, v) => a + v.warranty_hold, 0)
    - s.releases.filter(r => r.kind === 'warranty').reduce((a, r) => a + r.amount, 0);
  s.cum_progress = nd.length ? Math.max(...nd.map(v => v.cum_progress)) : 0;
  s.remain = s.amount - s.valued;
  return s;
}

router.get('/subcontracts', requireStaff('subcontracts'), (req, res) => {
  const { project_id = '', vendor_id = '', status = '' } = req.query;
  const rows = db.prepare(`SELECT s.*, v.name AS vendor_name, p.name AS project_name, p.code AS project_code
    FROM subcontracts s LEFT JOIN vendors v ON v.id = s.vendor_id JOIN projects p ON p.id = s.project_id
    WHERE (? = '' OR s.project_id = ?) AND (? = '' OR s.vendor_id = ?) AND (? = '' OR s.status = ?)
    ORDER BY s.id DESC`).all(project_id, project_id, vendor_id, vendor_id, status, status);
  for (const r of rows) Object.assign(r, subDetail(r.id));
  res.json(rows);
});

router.get('/subcontracts/:id', requireStaff('subcontracts'), (req, res) => {
  const s = subDetail(Number(req.params.id));
  if (!s) return res.status(404).json({ error: '找不到此發包單' });
  res.json(s);
});

router.post('/subcontracts', requireStaff('subcontracts'), (req, res) => {
  const s = pickSub(req.body || {});
  if (!s.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!s.vendor_id) return res.status(400).json({ error: '請指定工班' });
  s.no = nextSerial('subcontracts', 'no', 'SC');
  if (s.retention_pct === undefined) s.retention_pct = Number(getSetting('default_retention_pct', '10'));
  if (s.warranty_pct === undefined) s.warranty_pct = Number(getSetting('default_warranty_pct', '5'));
  const id = insert('subcontracts', s);
  audit('staff', req.user.id, req.user.name, '建立發包單', s.no, s.trade || '');
  res.json({ id, no: s.no });
});

router.put('/subcontracts/:id', requireStaff('subcontracts'), (req, res) => {
  const s = get('subcontracts', req.params.id);
  if (!s) return res.status(404).json({ error: '找不到此發包單' });
  const b = pickSub(req.body || {});
  delete b.project_id;
  // 已經估驗過就不能再改保留款比例：前後期扣的比例不同，帳面永遠對不起來
  const valued = db.prepare("SELECT COUNT(*) AS n FROM valuations WHERE subcontract_id = ? AND status <> 'draft'").get(s.id).n;
  if (valued && (b.retention_pct !== undefined || b.warranty_pct !== undefined)) {
    if (Number(b.retention_pct) !== s.retention_pct || Number(b.warranty_pct) !== s.warranty_pct) {
      return res.status(400).json({ error: '已經有估驗紀錄，保留款／保固金比例不能再改' });
    }
  }
  update('subcontracts', s.id, b);
  res.json({ ok: true });
});

router.delete('/subcontracts/:id', requireStaff('subcontracts'), (req, res) => {
  const s = get('subcontracts', req.params.id);
  if (!s) return res.status(404).json({ error: '找不到此發包單' });
  const n = db.prepare('SELECT COUNT(*) AS n FROM valuations WHERE subcontract_id = ?').get(s.id).n;
  if (n) return res.status(400).json({ error: '已經有估驗紀錄，不能刪除' });
  remove('subcontracts', s.id);
  res.json({ ok: true });
});

// ---- 發包明細（發包總價由明細加總）----

function recalcSub(subId) {
  const items = db.prepare('SELECT * FROM sub_items WHERE subcontract_id = ?').all(subId);
  if (!items.length) return;   // 沒明細的發包單用單頭金額（小工程常常就一句「泥作全包 18 萬」）
  const amount = items.reduce((a, i) => a + i.amount, 0);
  db.prepare('UPDATE subcontracts SET amount = ? WHERE id = ?').run(amount, subId);
}

router.post('/subcontracts/:id/items', requireStaff('subcontracts'), (req, res) => {
  const s = get('subcontracts', req.params.id);
  if (!s) return res.status(404).json({ error: '找不到此發包單' });
  const b = req.body || {};
  const i = picker(['name', 'spec', 'unit', 'note'])(b);
  if (!i.name) return res.status(400).json({ error: '請填項目名稱' });
  i.subcontract_id = s.id;
  i.qty = Number(b.qty) || 0;
  i.unit_price = Math.round(Number(b.unit_price) || 0);
  i.amount = lineAmount(i.qty, i.unit_price);
  const id = insert('sub_items', i);
  recalcSub(s.id);
  res.json({ id, amount: get('subcontracts', s.id).amount });
});

// 發包總價不能改到低於已估驗金額，否則累計％會超過 100、保留款也對不起來
function valuedAmount(subId) {
  return db.prepare("SELECT COALESCE(SUM(gross_amount),0) AS v FROM valuations WHERE subcontract_id = ? AND status <> 'draft'").get(subId).v;
}

function belowValued(subId, newTotal) {
  const valued = valuedAmount(subId);
  return newTotal < valued
    ? `已估驗 ${valued.toLocaleString('zh-TW')} 元，發包總價改完會變成 ${newTotal.toLocaleString('zh-TW')} 元，不能低於已估驗金額`
    : null;
}

router.put('/sub-items/:id', requireStaff('subcontracts'), (req, res) => {
  const row = get('sub_items', req.params.id);
  if (!row) return res.status(404).json({ error: '找不到此明細' });
  const b = req.body || {};
  const i = picker(['name', 'spec', 'unit', 'note'])(b);
  if (i.name !== undefined && !i.name) return res.status(400).json({ error: '請填項目名稱' });
  i.qty = b.qty !== undefined ? Number(b.qty) || 0 : row.qty;
  i.unit_price = b.unit_price !== undefined ? Math.round(Number(b.unit_price) || 0) : row.unit_price;
  i.amount = lineAmount(i.qty, i.unit_price);
  const total = db.prepare('SELECT COALESCE(SUM(amount),0) AS v FROM sub_items WHERE subcontract_id = ?')
    .get(row.subcontract_id).v - row.amount + i.amount;
  const bad = belowValued(row.subcontract_id, total);
  if (bad) return res.status(400).json({ error: bad });
  update('sub_items', row.id, i);
  recalcSub(row.subcontract_id);
  res.json({ ok: true, amount: get('subcontracts', row.subcontract_id).amount });
});

router.delete('/sub-items/:id', requireStaff('subcontracts'), (req, res) => {
  const row = get('sub_items', req.params.id);
  if (!row) return res.status(404).json({ error: '找不到此明細' });
  const rest = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS v FROM sub_items WHERE subcontract_id = ? AND id <> ?')
    .get(row.subcontract_id, row.id);
  // 刪到一筆不剩時單頭金額維持原值（見 recalcSub），只有還剩明細時總價才會變小
  const bad = rest.n ? belowValued(row.subcontract_id, rest.v) : null;
  if (bad) return res.status(400).json({ error: bad });
  remove('sub_items', row.id);
  recalcSub(row.subcontract_id);
  res.json({ ok: true });
});

// 單頭金額直接指定（沒有明細的小發包）
router.put('/subcontracts/:id/amount', requireStaff('subcontracts'), (req, res) => {
  const s = get('subcontracts', req.params.id);
  if (!s) return res.status(404).json({ error: '找不到此發包單' });
  const n = db.prepare('SELECT COUNT(*) AS n FROM sub_items WHERE subcontract_id = ?').get(s.id).n;
  if (n) return res.status(400).json({ error: '這張單有明細，總價由明細加總，請改明細' });
  const amount = Math.round(Number(req.body.amount) || 0);
  const valued = valuedAmount(s.id);
  if (amount < valued) return res.status(400).json({ error: `已估驗 ${valued.toLocaleString('zh-TW')} 元，總價不能低於它` });
  db.prepare('UPDATE subcontracts SET amount = ? WHERE id = ?').run(amount, s.id);
  res.json({ ok: true });
});

// ---- 估驗計價 ----

// 這張單還有哪些「該扣工班」的缺失沒扣過
router.get('/subcontracts/:id/deductions', requireStaff('subcontracts'), (req, res) => {
  const s = get('subcontracts', req.params.id);
  if (!s) return res.status(404).json({ error: '找不到此發包單' });
  res.json(db.prepare(`SELECT * FROM defects WHERE project_id = ? AND vendor_id = ?
    AND charge_vendor = 1 AND cost > 0 AND deducted_valuation_id IS NULL
    ORDER BY id`).all(s.project_id, s.vendor_id));
});

router.post('/subcontracts/:id/valuations', requireStaff('subcontracts'), (req, res) => {
  const s = get('subcontracts', req.params.id);
  if (!s) return res.status(404).json({ error: '找不到此發包單' });
  const b = req.body || {};
  const cum = Number(b.cum_progress);
  if (!(cum >= 0 && cum <= 100)) return res.status(400).json({ error: '累計完成％要在 0 到 100 之間' });
  const prior = db.prepare("SELECT COALESCE(SUM(gross_amount),0) AS v FROM valuations WHERE subcontract_id = ?").get(s.id).v;
  const cumAmount = Math.round(s.amount * cum / 100);
  const gross = cumAmount - prior;
  if (gross < 0) {
    return res.status(400).json({ error: `累計 ${cum}% 換算 ${cumAmount.toLocaleString('zh-TW')} 元，低於已估驗的 ${prior.toLocaleString('zh-TW')} 元。請確認是不是填成「本期完成％」了` });
  }
  const retention = Math.round(gross * (s.retention_pct || 0) / 100);
  const warranty = Math.round(gross * (s.warranty_pct || 0) / 100);
  const defectIds = String(b.defect_ids || '').split(',').map(x => Number(x)).filter(Boolean);
  let deduction = Math.round(Number(b.deduction) || 0);
  const notes = [];
  for (const did of defectIds) {
    const d = get('defects', did);
    if (!d || d.deducted_valuation_id) continue;
    deduction += d.cost;
    notes.push(defectNote(d));
  }
  const net = gross - retention - warranty - deduction;
  if (net < 0) return res.status(400).json({ error: '扣款金額大於本期估驗，實付會變成負數，請確認' });

  const v = {
    subcontract_id: s.id,
    period: String(b.period || '').trim() || require('../db').thisMonth(),
    date: String(b.date || '').trim() || today(),
    cum_progress: cum, cum_amount: cumAmount, gross_amount: gross,
    retention, warranty_hold: warranty, deduction,
    deduct_note: [String(b.deduct_note || '').trim(), ...notes].filter(Boolean).join('；'),
    net_amount: net, status: 'confirmed', note: String(b.note || '').trim(), created_by: req.user.id
  };
  const id = insert('valuations', v);
  for (const did of defectIds) {
    db.prepare('UPDATE defects SET deducted_valuation_id = ? WHERE id = ? AND deducted_valuation_id IS NULL').run(id, did);
  }
  // 估驗到 100% 就把發包單標成完工，保留款待退的提醒才會跑出來
  if (cum >= 100 && s.status !== 'settled') db.prepare("UPDATE subcontracts SET status = 'done' WHERE id = ?").run(s.id);
  else if (s.status === 'signed') db.prepare("UPDATE subcontracts SET status = 'working' WHERE id = ?").run(s.id);
  audit('staff', req.user.id, req.user.name, '估驗計價', s.no, `累計 ${cum}%，本期 ${gross}，實付 ${net}`);
  res.json({ id, gross, retention, warranty_hold: warranty, deduction, net });
});

// 缺失求償寫進扣款說明的格式；編輯估驗時要靠它把自動產生的說明與手填的分開
function defectNote(d) { return `${d.location}${d.item} ${d.cost}`; }

// 改估驗：只能改最後一期、還沒付款的。金額照新增時的規則整個重算，
// 已經扣回的缺失求償維持綁在這一期，不會因為改了％就被漏扣或重扣。
router.put('/valuations/:id', requireStaff('subcontracts'), (req, res) => {
  const v = get('valuations', req.params.id);
  if (!v) return res.status(404).json({ error: '找不到此估驗單' });
  if (v.status === 'paid') return res.status(400).json({ error: '已付款的估驗單不能修改' });
  const last = db.prepare('SELECT MAX(id) AS v FROM valuations WHERE subcontract_id = ?').get(v.subcontract_id).v;
  if (last !== v.id) return res.status(400).json({ error: '只能修改最後一期，否則後面各期的本期金額會對不上' });
  const s = get('subcontracts', v.subcontract_id);
  const b = req.body || {};
  const cum = b.cum_progress !== undefined ? Number(b.cum_progress) : v.cum_progress;
  if (!(cum >= 0 && cum <= 100)) return res.status(400).json({ error: '累計完成％要在 0 到 100 之間' });
  const prior = db.prepare('SELECT COALESCE(SUM(gross_amount),0) AS v FROM valuations WHERE subcontract_id = ? AND id <> ?')
    .get(s.id, v.id).v;
  const cumAmount = Math.round(s.amount * cum / 100);
  const gross = cumAmount - prior;
  if (gross < 0) {
    return res.status(400).json({ error: `累計 ${cum}% 換算 ${cumAmount.toLocaleString('zh-TW')} 元，低於前期已估驗的 ${prior.toLocaleString('zh-TW')} 元` });
  }
  const ds = db.prepare('SELECT * FROM defects WHERE deducted_valuation_id = ?').all(v.id);
  const defectCost = ds.reduce((a, d) => a + d.cost, 0);
  const oldManual = v.deduction - defectCost;
  const manual = b.deduction !== undefined ? Math.round(Number(b.deduction) || 0) : oldManual;
  const retention = Math.round(gross * (s.retention_pct || 0) / 100);
  const warranty = Math.round(gross * (s.warranty_pct || 0) / 100);
  const deduction = manual + defectCost;
  const net = gross - retention - warranty - deduction;
  if (net < 0) return res.status(400).json({ error: '扣款金額大於本期估驗，實付會變成負數，請確認' });
  const auto = new Set(ds.map(defectNote));
  const oldNote = v.deduct_note.split('；').filter(x => x && !auto.has(x)).join('；');
  const note = b.deduct_note !== undefined ? String(b.deduct_note).trim() : oldNote;

  update('valuations', v.id, {
    period: b.period !== undefined ? String(b.period).trim() || v.period : v.period,
    date: b.date !== undefined ? String(b.date).trim() || v.date : v.date,
    cum_progress: cum, cum_amount: cumAmount, gross_amount: gross,
    retention, warranty_hold: warranty, deduction,
    deduct_note: [note, ...ds.map(defectNote)].filter(Boolean).join('；'),
    net_amount: net,
    note: b.note !== undefined ? String(b.note).trim() : v.note
  });
  // 改到 100% 就標完工；從 100% 改回來的，完工標記也要撤掉，否則會跳出「該退保留款」的誤報
  if (cum >= 100 && s.status !== 'settled') db.prepare("UPDATE subcontracts SET status = 'done' WHERE id = ?").run(s.id);
  else if (cum < 100 && s.status === 'done') db.prepare("UPDATE subcontracts SET status = 'working' WHERE id = ?").run(s.id);
  audit('staff', req.user.id, req.user.name, '修改估驗', s.no, `累計 ${v.cum_progress}% → ${cum}%，實付 ${v.net_amount} → ${net}`);
  res.json({ gross, retention, warranty_hold: warranty, deduction, net });
});

router.post('/valuations/:id/pay', requireStaff('subcontracts'), (req, res) => {
  const v = get('valuations', req.params.id);
  if (!v) return res.status(404).json({ error: '找不到此估驗單' });
  db.prepare("UPDATE valuations SET status = 'paid', paid_date = ? WHERE id = ?")
    .run(String(req.body.paid_date || '').trim() || today(), v.id);
  audit('staff', req.user.id, req.user.name, '估驗付款', String(v.id), String(v.net_amount));
  res.json({ ok: true });
});

router.delete('/valuations/:id', requireStaff('subcontracts'), (req, res) => {
  const v = get('valuations', req.params.id);
  if (!v) return res.status(404).json({ error: '找不到此估驗單' });
  if (v.status === 'paid') return res.status(400).json({ error: '已付款的估驗單不能刪除' });
  const last = db.prepare('SELECT MAX(id) AS v FROM valuations WHERE subcontract_id = ?').get(v.subcontract_id).v;
  if (last !== v.id) return res.status(400).json({ error: '只能刪除最後一期，否則累計會對不上' });
  db.prepare('UPDATE defects SET deducted_valuation_id = NULL WHERE deducted_valuation_id = ?').run(v.id);
  remove('valuations', v.id);
  res.json({ ok: true });
});

// ---- 保留款／保固金退還 ----

router.post('/subcontracts/:id/release', requireStaff('subcontracts'), (req, res) => {
  const s = subDetail(Number(req.params.id));
  if (!s) return res.status(404).json({ error: '找不到此發包單' });
  const kind = req.body.kind === 'warranty' ? 'warranty' : 'retention';
  const amount = Math.round(Number(req.body.amount) || 0);
  const held = kind === 'warranty' ? s.warranty_held : s.retention_held;
  if (amount <= 0) return res.status(400).json({ error: '請填退還金額' });
  if (amount > held) return res.status(400).json({ error: `目前只押著 ${held.toLocaleString('zh-TW')} 元，不能退超過` });
  const open = db.prepare(`SELECT COUNT(*) AS n FROM defects WHERE project_id = ? AND vendor_id = ?
    AND status IN ('open','fixing')`).get(s.project_id, s.vendor_id).n;
  if (open && !Number(req.body.force)) {
    return res.status(400).json({ error: `這家工班在本案還有 ${open} 件缺失沒改善完。確定要退就再按一次` });
  }
  const id = insert('retention_releases', {
    subcontract_id: s.id, kind, amount,
    date: String(req.body.date || '').trim() || today(),
    note: String(req.body.note || '').trim()
  });
  const after = subDetail(s.id);
  if (after.retention_held <= 0 && after.warranty_held <= 0 && after.status === 'done') {
    db.prepare("UPDATE subcontracts SET status = 'settled' WHERE id = ?").run(s.id);
  }
  audit('staff', req.user.id, req.user.name, kind === 'warranty' ? '退還保固金' : '退還保留款', s.no, String(amount));
  res.json({ id });
});

// ---- 應付總表（跨案）----

router.get('/payables', requireStaff('subcontracts'), (req, res) => {
  const { vendor_id = '', project_id = '', q = '' } = req.query;
  const kw = String(q).trim(), like = `%${kw}%`;
  const rows = db.prepare(`SELECT v.id, v.date, v.period, v.gross_amount, v.net_amount, v.status, v.paid_date,
      s.no, s.trade, s.project_id, p.name AS project_name, p.code AS project_code,
      ve.name AS vendor_name, ve.phone AS vendor_phone
    FROM valuations v JOIN subcontracts s ON s.id = v.subcontract_id
    JOIN projects p ON p.id = s.project_id LEFT JOIN vendors ve ON ve.id = s.vendor_id
    WHERE v.status = 'confirmed'
      AND (? = '' OR ve.id = ?) AND (? = '' OR s.project_id = ?)
      AND (? = '' OR ve.name LIKE ? OR s.trade LIKE ? OR s.no LIKE ? OR p.name LIKE ? OR p.code LIKE ?)
    ORDER BY v.date`)
    .all(vendor_id, vendor_id, project_id, project_id, kw, like, like, like, like, like);
  const held = db.prepare(`SELECT ve.id AS vendor_id, ve.name AS vendor_name,
      SUM(x.retention) - COALESCE((SELECT SUM(r.amount) FROM retention_releases r
        JOIN subcontracts s2 ON s2.id = r.subcontract_id WHERE s2.vendor_id = ve.id AND r.kind='retention'),0) AS retention_held,
      SUM(x.warranty_hold) - COALESCE((SELECT SUM(r.amount) FROM retention_releases r
        JOIN subcontracts s2 ON s2.id = r.subcontract_id WHERE s2.vendor_id = ve.id AND r.kind='warranty'),0) AS warranty_held
    FROM valuations x JOIN subcontracts s ON s.id = x.subcontract_id JOIN vendors ve ON ve.id = s.vendor_id
    WHERE x.status <> 'draft' AND (? = '' OR ve.id = ?) AND (? = '' OR ve.name LIKE ?)
    GROUP BY ve.id HAVING retention_held > 0 OR warranty_held > 0`)
    .all(vendor_id, vendor_id, kw, like);
  res.json({
    rows, held,
    sum: rows.reduce((a, r) => a + r.net_amount, 0)
  });
});

module.exports = router;
