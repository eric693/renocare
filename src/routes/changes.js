// 追加減帳（變更單）—— 這套系統的核心。
//
// 產業現況：現場客戶說「這面牆幫我改一下」，師傅就做了；結算時客戶說「我沒說要加錢」。
// 有沒有簽認，就是這筆錢收不收得到的分界，所以：
//   * 只有 status='signed' 的金額會被算進合約總價與應收（見 finance.js）
//   * 送出後三天沒簽會自動變成待辦催辦（見 reminders.js）
//   * 簽認來源（線上／紙本）、簽認人、時間、IP 全部留下來，日後爭議拿得出東西
//   * 已簽認的單不能再改金額，要改只能開一張新的（減帳單），軌跡才連得起來

const express = require('express');
const { db, audit, today, nowStamp, nextSerial } = require('../db');
const { requireStaff } = require('../auth');
const { picker, insert, update, get, remove, lineAmount } = require('../crud');
const { clientIp } = require('../auth');

const router = express.Router();

const pickChange = picker(['project_id', 'title', 'reason', 'detail', 'days_delay', 'note'],
  ['project_id', 'days_delay']);

function recalcChange(changeId) {
  const items = db.prepare('SELECT * FROM change_items WHERE change_id = ?').all(changeId);
  const amount = items.reduce((a, i) => a + i.amount, 0);
  db.prepare('UPDATE change_orders SET amount = ? WHERE id = ?').run(amount, changeId);
  return { amount };
}

router.get('/changes', requireStaff('changes'), (req, res) => {
  const { project_id = '', status = '' } = req.query;
  res.json(db.prepare(`SELECT c.*, p.name AS project_name, p.code AS project_code, u.name AS created_by_name
    FROM change_orders c JOIN projects p ON p.id = c.project_id LEFT JOIN users u ON u.id = c.created_by
    WHERE (? = '' OR c.project_id = ?) AND (? = '' OR c.status = ?)
    ORDER BY (c.status = 'sent') DESC, c.id DESC`).all(project_id, project_id, status, status));
});

router.get('/changes/:id', requireStaff('changes'), (req, res) => {
  const c = db.prepare(`SELECT c.*, p.name AS project_name, p.code AS project_code, cu.name AS customer_name
    FROM change_orders c JOIN projects p ON p.id = c.project_id
    LEFT JOIN customers cu ON cu.id = p.customer_id WHERE c.id = ?`).get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: '找不到此變更單' });
  c.items = db.prepare('SELECT * FROM change_items WHERE change_id = ? ORDER BY id').all(c.id);
  res.json(c);
});

router.post('/changes', requireStaff('changes'), (req, res) => {
  const c = pickChange(req.body || {});
  if (!c.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!c.title) return res.status(400).json({ error: '請填變更事由標題' });
  c.no = nextSerial('change_orders', 'no', 'CO');
  c.created_by = req.user.id;
  const id = insert('change_orders', c);
  audit('staff', req.user.id, req.user.name, '建立變更單', c.no, c.title);
  res.json({ id, no: c.no });
});

router.put('/changes/:id', requireStaff('changes'), (req, res) => {
  const c = get('change_orders', req.params.id);
  if (!c) return res.status(404).json({ error: '找不到此變更單' });
  if (c.status === 'signed') {
    return res.status(400).json({ error: '已簽認的變更單不能修改。要調整請另開一張變更單（減帳），保留完整軌跡' });
  }
  const b = pickChange(req.body || {});
  delete b.project_id;
  update('change_orders', c.id, b);
  res.json({ ok: true });
});

// 狀態流轉。送出＝進入待簽認（開始計時催辦）；紙本回簽也走同一支，
// 只是 sign_channel 標成 paper，並要求填簽認人姓名。
router.post('/changes/:id/status', requireStaff('changes'), (req, res) => {
  const c = get('change_orders', req.params.id);
  if (!c) return res.status(404).json({ error: '找不到此變更單' });
  const status = String(req.body.status || '').trim();
  if (!['draft', 'sent', 'signed', 'rejected', 'void'].includes(status)) {
    return res.status(400).json({ error: '狀態不正確' });
  }
  if (c.status === 'signed' && status !== 'void') {
    return res.status(400).json({ error: '已簽認的變更單只能作廢，不能改回其他狀態' });
  }
  recalcChange(c.id);
  const fresh = get('change_orders', c.id);
  if (status === 'sent' && !fresh.amount) {
    return res.status(400).json({ error: '金額是 0，先把追加或減帳的明細填好再送簽' });
  }

  const set = { status };
  if (status === 'sent') { set.sent_at = today(); set.signed_at = ''; set.signed_name = ''; }
  if (status === 'signed') {
    const name = String(req.body.signed_name || '').trim();
    if (!name) return res.status(400).json({ error: '請填業主簽認人姓名（紙本回簽也要留下是誰簽的）' });
    set.signed_at = nowStamp();
    set.signed_name = name;
    set.sign_channel = 'paper';
    set.sign_ip = clientIp(req);
    if (!fresh.sent_at) set.sent_at = today();
  }
  update('change_orders', c.id, set);

  // 簽認後展延工期：把合約完工日往後推，逾期違約金才不會算在自己頭上
  if (status === 'signed' && fresh.days_delay > 0) {
    const p = get('projects', fresh.project_id);
    if (p && p.due_date) {
      const nd = require('../db').shiftDate(p.due_date, fresh.days_delay);
      db.prepare('UPDATE projects SET due_date = ? WHERE id = ?').run(nd, p.id);
      audit('staff', req.user.id, req.user.name, '變更單展延工期', p.code,
        `${p.due_date} → ${nd}（${fresh.days_delay} 天，${fresh.no}）`);
    }
  }
  audit('staff', req.user.id, req.user.name, '變更單狀態', c.no, `${c.status} → ${status}`);
  res.json({ ok: true });
});

router.delete('/changes/:id', requireStaff('changes'), (req, res) => {
  const c = get('change_orders', req.params.id);
  if (!c) return res.status(404).json({ error: '找不到此變更單' });
  if (c.status === 'signed') return res.status(400).json({ error: '已簽認的變更單不能刪除，只能作廢' });
  remove('change_orders', c.id);
  audit('staff', req.user.id, req.user.name, '刪除變更單', c.no);
  res.json({ ok: true });
});

// ---- 變更明細 ----
// 減帳（kind='deduct'）一律存成負數：加總時不必判斷方向，
// 也不會出現「這張單到底是加還是減」的歧義。

function changeItemPayload(body) {
  const i = picker(['kind', 'category', 'name', 'spec', 'unit', 'note'])(body);
  if (!i.name) throw new Error('請填項目名稱');
  const sign = i.kind === 'deduct' ? -1 : 1;
  const qty = Number(body.qty) || 0;
  const price = Math.abs(Math.round(Number(body.unit_price) || 0));
  const cost = Math.abs(Math.round(Number(body.unit_cost) || 0));
  i.qty = qty;
  i.unit_price = price;
  i.unit_cost = cost;
  i.amount = sign * lineAmount(qty, price);
  i.cost_amount = sign * lineAmount(qty, cost);
  return i;
}

function guardOpen(c) {
  if (c.status === 'signed') return '已簽認的變更單不能再改明細';
  return null;
}

router.post('/changes/:id/items', requireStaff('changes'), (req, res) => {
  const c = get('change_orders', req.params.id);
  if (!c) return res.status(404).json({ error: '找不到此變更單' });
  const bad = guardOpen(c);
  if (bad) return res.status(400).json({ error: bad });
  let i;
  try { i = changeItemPayload(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  i.change_id = c.id;
  const id = insert('change_items', i);
  res.json({ id, ...recalcChange(c.id) });
});

router.put('/change-items/:id', requireStaff('changes'), (req, res) => {
  const row = get('change_items', req.params.id);
  if (!row) return res.status(404).json({ error: '找不到此明細' });
  const bad = guardOpen(get('change_orders', row.change_id));
  if (bad) return res.status(400).json({ error: bad });
  let i;
  try { i = changeItemPayload(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  update('change_items', row.id, i);
  res.json(recalcChange(row.change_id));
});

router.delete('/change-items/:id', requireStaff('changes'), (req, res) => {
  const row = get('change_items', req.params.id);
  if (!row) return res.status(404).json({ error: '找不到此明細' });
  const bad = guardOpen(get('change_orders', row.change_id));
  if (bad) return res.status(400).json({ error: bad });
  remove('change_items', row.id);
  res.json(recalcChange(row.change_id));
});

module.exports = router;
module.exports.recalcChange = recalcChange;
