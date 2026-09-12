// 請款節點與收款。裝修業的現金流問題八成不是客戶賴帳，是自己忘記請款。
const express = require('express');
const { db, audit, today, getSetting, shiftDate } = require('../db');
const { requireStaff } = require('../auth');
const { picker, insert, update, get, remove } = require('../crud');
const { projectMoney, milestoneAmount } = require('../finance');

const router = express.Router();

const pickMs = picker(['project_id', 'name', 'basis', 'percent', 'fixed_amount', 'trigger_item_id', 'trigger_on',
  'planned_date', 'due_date', 'status', 'invoice_no', 'note'],
  ['project_id', 'fixed_amount', 'trigger_item_id', 'seq'], ['percent']);

router.get('/milestones', requireStaff('billing'), (req, res) => {
  const pid = Number(req.query.project_id) || 0;
  if (!pid) return res.status(400).json({ error: '請指定案場' });
  const m = projectMoney(pid);
  res.json({ milestones: m.milestones, money: m });
});

router.post('/milestones', requireStaff('billing'), (req, res) => {
  const m = pickMs(req.body || {});
  if (!m.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!m.name) return res.status(400).json({ error: '請填節點名稱' });
  m.seq = (db.prepare('SELECT COALESCE(MAX(seq),0) AS v FROM billing_milestones WHERE project_id = ?').get(m.project_id).v) + 1;
  res.json({ id: insert('billing_milestones', m) });
});

// 套用請款節點範本（設定頁可改）。已經有節點的案子不覆蓋，避免把收過款的節點洗掉。
router.post('/milestones/apply-template', requireStaff('billing'), (req, res) => {
  const pid = Number(req.body.project_id) || 0;
  if (!get('projects', pid)) return res.status(404).json({ error: '找不到此案場' });
  const exists = db.prepare('SELECT COUNT(*) AS n FROM billing_milestones WHERE project_id = ?').get(pid).n;
  if (exists) return res.status(400).json({ error: '這個案子已經有請款節點了，請直接編輯' });
  const tpl = getSetting('milestone_template', '').split(',').map(s => s.trim()).filter(Boolean);
  let seq = 0, sum = 0;
  for (const part of tpl) {
    const [name, pct] = part.split(':');
    if (!name) continue;
    seq++;
    sum += Number(pct) || 0;
    insert('billing_milestones', {
      project_id: pid, seq, name: name.trim(), basis: 'percent', percent: Number(pct) || 0
    });
  }
  res.json({ created: seq, percent_sum: sum });
});

router.put('/milestones/:id', requireStaff('billing'), (req, res) => {
  const m = get('billing_milestones', req.params.id);
  if (!m) return res.status(404).json({ error: '找不到此節點' });
  const b = pickMs(req.body || {});
  delete b.project_id;
  update('billing_milestones', m.id, b);
  res.json({ ok: true });
});

// 開單請款：從這一刻起才算應收，逾期才算得出來。
// 收款期限沒填就用設定的帳期（預設 7 天），不要留空讓它永遠不算逾期。
router.post('/milestones/:id/invoice', requireStaff('billing'), (req, res) => {
  const m = get('billing_milestones', req.params.id);
  if (!m) return res.status(404).json({ error: '找不到此節點' });
  const date = String(req.body.invoiced_date || '').trim() || today();
  const due = String(req.body.due_date || '').trim() || shiftDate(date, Number(getSetting('alert_days', '7')) || 7);
  db.prepare(`UPDATE billing_milestones SET status = 'invoiced', invoiced_date = ?, due_date = ?, invoice_no = ?
              WHERE id = ?`).run(date, due, String(req.body.invoice_no || '').trim(), m.id);
  audit('staff', req.user.id, req.user.name, '開立請款', m.name, date);
  res.json({ ok: true });
});

router.delete('/milestones/:id', requireStaff('billing'), (req, res) => {
  const m = get('billing_milestones', req.params.id);
  if (!m) return res.status(404).json({ error: '找不到此節點' });
  const got = db.prepare('SELECT COALESCE(SUM(amount),0) AS v FROM receipts WHERE milestone_id = ?').get(m.id).v;
  if (got) return res.status(400).json({ error: '這個節點已經有收款紀錄，不能刪除；可以改成「取消」' });
  remove('billing_milestones', m.id);
  res.json({ ok: true });
});

// ---- 收款 ----

const pickReceipt = picker(['project_id', 'milestone_id', 'date', 'amount', 'method', 'invoice_no', 'note'],
  ['project_id', 'milestone_id', 'amount']);

router.post('/receipts', requireStaff('billing'), (req, res) => {
  const r = pickReceipt(req.body || {});
  if (!r.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!r.amount) return res.status(400).json({ error: '請填收款金額' });
  if (!r.date) r.date = today();
  r.created_by = req.user.id;
  const id = insert('receipts', r);
  syncMilestonePaid(r.milestone_id);
  audit('staff', req.user.id, req.user.name, '登錄收款', String(r.project_id), String(r.amount));
  res.json({ id });
});

router.put('/receipts/:id', requireStaff('billing'), (req, res) => {
  const before = get('receipts', req.params.id);
  if (!before) return res.status(404).json({ error: '找不到此收款' });
  const r = pickReceipt(req.body || {});
  delete r.project_id;
  update('receipts', before.id, r);
  syncMilestonePaid(before.milestone_id);
  syncMilestonePaid(r.milestone_id);
  res.json({ ok: true });
});

router.delete('/receipts/:id', requireStaff('billing'), (req, res) => {
  const r = get('receipts', req.params.id);
  if (!r) return res.status(404).json({ error: '找不到此收款' });
  remove('receipts', r.id);
  syncMilestonePaid(r.milestone_id);
  res.json({ ok: true });
});

// 收足了就把節點標成已收；收不足（分次付）維持已請款，應收帳款才看得到還差多少
function syncMilestonePaid(milestoneId) {
  if (!milestoneId) return;
  const m = get('billing_milestones', milestoneId);
  if (!m) return;
  const contract = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS v FROM contracts WHERE project_id = ? AND status = 'active'").get(m.project_id).v;
  const due = milestoneAmount(m, contract);
  const got = db.prepare('SELECT COALESCE(SUM(amount),0) AS v FROM receipts WHERE milestone_id = ?').get(m.id).v;
  if (got >= due && due > 0) db.prepare("UPDATE billing_milestones SET status = 'paid' WHERE id = ?").run(m.id);
  else if (m.status === 'paid') db.prepare("UPDATE billing_milestones SET status = 'invoiced' WHERE id = ?").run(m.id);
}

// ---- 應收帳款總表（跨案）----
// 分成三段，因為要做的事不一樣：
//   可請款未開單 → 去開單（錢是自己卡住的）
//   已請款未收 → 去催（分帳齡）
//   已簽認追加未請 → 最常被漏掉的一段

router.get('/receivables', requireStaff('billing'), (req, res) => {
  const t = today();
  const { status = '', bucket = '', q = '' } = req.query;
  const kw = String(q).trim(), like = `%${kw}%`;
  const rows = [];
  const projects = db.prepare(`SELECT p.*, c.name AS customer_name, c.phone AS customer_phone, u.name AS designer_name
    FROM projects p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = p.designer_id
    WHERE p.status NOT IN ('lost') AND (? = '' OR p.status = ?)
      AND (? = '' OR p.name LIKE ? OR p.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)`)
    .all(status, status, kw, like, like, like, like);

  for (const p of projects) {
    const m = projectMoney(p.id);
    if (!m.contract_total && !m.received) continue;
    const ready = m.ready_amount;
    const invoicedOpen = m.invoiced_open;
    const changeUnbilled = m.change_unbilled;   // 已簽認追加還沒收的部分
    const oldest = m.milestones.filter(x => x.overdue).map(x => x.due_date).sort()[0] || '';
    rows.push({
      project_id: p.id, code: p.code, name: p.name, customer_name: p.customer_name, customer_phone: p.customer_phone,
      designer_name: p.designer_name, status: p.status,
      contract_total: m.contract_total, received: m.received,
      ready, invoiced_open: invoicedOpen, overdue: m.overdue,
      change_signed: m.change_signed, change_unbilled: changeUnbilled,
      change_pending: m.change_pending, change_sent_count: m.change_sent_count,
      oldest_due: oldest,
      age_days: oldest ? Math.round((new Date(t) - new Date(oldest)) / 86400000) : 0
    });
  }
  // 三段分別對應三件不同的事，所以可以只看其中一段；合計跟著篩選後的清單走，
  // 不然「看到的列」跟「上面的數字」對不起來，比沒有合計更糟。
  const buckets = {
    ready: r => r.ready > 0,
    invoiced: r => r.invoiced_open > 0,
    overdue: r => r.overdue > 0,
    change: r => r.change_unbilled > 0
  };
  const shown = buckets[bucket] ? rows.filter(buckets[bucket]) : rows;
  shown.sort((a, b) => b.overdue - a.overdue || b.ready - a.ready);
  const sum = shown.reduce((a, r) => ({
    ready: a.ready + r.ready, invoiced: a.invoiced + r.invoiced_open, overdue: a.overdue + r.overdue,
    change_unbilled: a.change_unbilled + r.change_unbilled, received: a.received + r.received,
    contract_total: a.contract_total + r.contract_total
  }), { ready: 0, invoiced: 0, overdue: 0, change_unbilled: 0, received: 0, contract_total: 0 });
  res.json({ rows: shown, sum });
});

module.exports = router;
