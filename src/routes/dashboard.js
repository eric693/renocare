// 營運儀表板、待辦事項、專案損益
const express = require('express');
const { db, today, thisMonth, shiftDate, audit, nowStamp } = require('../db');
const { requireStaff } = require('../auth');
const { picker, insert, update, get, remove } = require('../crud');
const { projectMoney, projectProgress, hideCosts, canSee } = require('../finance');

const router = express.Router();

const LIVE = "('design','contracted','construction','acceptance','warranty')";

router.get('/dashboard', requireStaff('dashboard'), (req, res) => {
  const t = today();
  const month = String(req.query.month || thisMonth());
  const soon = shiftDate(t, 7);

  const projects = db.prepare(`SELECT p.*, c.name AS customer_name FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id WHERE p.status IN ${LIVE}`).all();

  let contractTotal = 0, received = 0, receivable = 0, overdue = 0, ready = 0,
    changePending = 0, changeSent = 0, cost = 0, profit = 0, retentionHeld = 0, subUnpaid = 0;
  const live = [];
  for (const p of projects) {
    const m = projectMoney(p.id);
    contractTotal += m.contract_total; received += m.received; receivable += m.receivable;
    overdue += m.overdue; ready += m.ready_amount; changePending += m.change_pending;
    changeSent += m.change_sent_count; cost += m.cost_committed; profit += m.gross_profit;
    retentionHeld += m.retention_held; subUnpaid += m.sub_unpaid;
    live.push({
      id: p.id, code: p.code, name: p.name, status: p.status, customer_name: p.customer_name,
      due_date: p.due_date, contract_total: m.contract_total, received: m.received,
      receivable: m.receivable, overdue: m.overdue, margin: m.margin, gross_profit: m.gross_profit,
      progress: projectProgress(p.id),
      change_sent_count: m.change_sent_count, change_pending: m.change_pending,
      delay_days: (p.due_date && !p.actual_end_date && p.due_date < t)
        ? Math.round((new Date(t) - new Date(p.due_date)) / 86400000) : 0
    });
  }
  live.sort((a, b) => b.overdue - a.overdue || b.delay_days - a.delay_days || b.contract_total - a.contract_total);

  // 本月現金：收進來多少、付出去多少
  const inflow = db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM receipts WHERE substr(date,1,7) = ?").get(month).v;
  const outflow = db.prepare(`SELECT COALESCE(SUM(net_amount),0) AS v FROM valuations
    WHERE status = 'paid' AND substr(paid_date,1,7) = ?`).get(month).v
    + db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM project_expenses WHERE substr(date,1,7) = ?").get(month).v;

  const n = sql => db.prepare(sql).get().n;
  const attention = {
    change_sent: changeSent,
    overdue_amount: overdue,
    ready_amount: ready,
    material_risk: db.prepare(`SELECT COUNT(*) AS n FROM material_orders m JOIN projects p ON p.id = m.project_id
      WHERE p.status IN ${LIVE} AND m.status IN ('planned','ordered') AND m.need_date <> ''
        AND ((m.eta_date <> '' AND m.eta_date > m.need_date) OR (m.status = 'planned' AND m.need_date <= ?))`).get(t).n,
    schedule_late: db.prepare(`SELECT COUNT(*) AS n FROM schedule_items si JOIN projects p ON p.id = si.project_id
      WHERE p.status IN ${LIVE} AND si.status <> 'done' AND si.planned_end <> '' AND si.planned_end < ?`).get(t).n,
    defects_open: n(`SELECT COUNT(*) AS n FROM defects d JOIN projects p ON p.id = d.project_id
      WHERE d.status IN ('open','fixing')`),
    defects_overdue: db.prepare(`SELECT COUNT(*) AS n FROM defects
      WHERE status IN ('open','fixing') AND due_date <> '' AND due_date < ?`).get(t).n,
    permit_soon: db.prepare(`SELECT COUNT(*) AS n FROM permits WHERE status IN ('todo','applied','approved')
      AND expiry_date <> '' AND expiry_date <= ?`).get(soon).n,
    warranty_soon: db.prepare(`SELECT COUNT(*) AS n FROM warranties WHERE end_date <> ''
      AND end_date BETWEEN ? AND ?`).get(t, shiftDate(t, 30)).n,
    vendor_insurance: db.prepare(`SELECT COUNT(*) AS n FROM vendors WHERE active = 1
      AND liability_expiry <> '' AND liability_expiry < ?`).get(t).n,
    retention_held: retentionHeld,
    sub_unpaid: subUnpaid,
    license_soon: require('../reminders').companyLicenses()
      .filter(l => l.expiry <= shiftDate(t, Number(require('../db').getSetting('license_alert_days', '60')) || 60)).length
  };

  // 本月新簽與成交轉換
  const signed = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS v FROM contracts WHERE substr(sign_date,1,7) = ?").get(month);
  const quoted = db.prepare(`SELECT COUNT(*) AS n FROM quotes WHERE substr(quote_date,1,7) = ? AND status <> 'draft'`).get(month);
  const won = db.prepare(`SELECT COUNT(*) AS n FROM quotes WHERE substr(decided_at,1,7) = ? AND status = 'accepted'`).get(month);

  const out = {
    date: t, month,
    summary: {
      live_count: projects.length, contract_total: contractTotal, received, receivable, overdue,
      cost_committed: cost, gross_profit: profit,
      margin: contractTotal ? Math.round((profit / contractTotal) * 1000) / 10 : 0,
      change_pending: changePending
    },
    cash: { month, inflow, outflow, net: inflow - outflow },
    sales: { signed_count: signed.n, signed_amount: signed.v, quoted: quoted.n, won: won.n },
    attention,
    projects: live,
    my_tasks: db.prepare(`SELECT t.*, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ? AND t.status IN ('todo','doing')
      ORDER BY (t.due_date = ''), t.due_date, t.id LIMIT 20`).all(req.user.id)
  };
  // 工務也看儀表板，但毛利是損益權限的事（見 finance.hideCosts）
  if (!canSee(req, 'profit')) { hideCosts(out.summary); out.projects.forEach(hideCosts); }
  res.json(out);
});

// ---- 待辦事項 ----

const pickTask = picker(['project_id', 'title', 'detail', 'assignee_id', 'due_date', 'priority', 'status',
  'ref_type', 'ref_id'], ['project_id', 'assignee_id', 'ref_id']);

router.get('/tasks', requireStaff('tasks'), (req, res) => {
  const { assignee_id = '', status = '', project_id = '', mine = '', q = '' } = req.query;
  const uid = mine ? req.user.id : assignee_id;
  const kw = String(q).trim(), like = `%${kw}%`;
  res.json(db.prepare(`SELECT t.*, u.name AS assignee_name, p.name AS project_name, p.code AS project_code
    FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN projects p ON p.id = t.project_id
    WHERE (? = '' OR t.assignee_id = ?) AND (? = '' OR t.status = ?) AND (? = '' OR t.project_id = ?)
      AND (? = '' OR t.title LIKE ? OR t.detail LIKE ? OR p.name LIKE ? OR p.code LIKE ?)
    ORDER BY (t.status = 'done'), (t.due_date = ''), t.due_date, t.id DESC LIMIT 400`)
    .all(uid, uid, status, status, project_id, project_id, kw, like, like, like, like));
});

router.post('/tasks', requireStaff('tasks'), (req, res) => {
  const t = pickTask(req.body || {});
  if (!t.title) return res.status(400).json({ error: '請填工作標題' });
  t.created_by = req.user.id;
  if (t.assignee_id === undefined) t.assignee_id = req.user.id;
  res.json({ id: insert('tasks', t) });
});

router.put('/tasks/:id', requireStaff('tasks'), (req, res) => {
  const before = get('tasks', req.params.id);
  if (!before) return res.status(404).json({ error: '找不到此工作' });
  const t = pickTask(req.body || {});
  if (t.status === 'done' && before.status !== 'done') t.done_at = nowStamp();
  if (t.status && t.status !== 'done') t.done_at = '';
  update('tasks', before.id, t);
  res.json({ ok: true });
});

router.delete('/tasks/:id', requireStaff('tasks'), (req, res) => {
  remove('tasks', req.params.id);
  res.json({ ok: true });
});

// ---- 專案損益 ----
// 「做完才知道賺不賺」是這個行業最普遍的病。這頁的每一欄都是現在就算得出來的，
// 不用等結案、不用等發票。

router.get('/profit', requireStaff('profit'), (req, res) => {
  const { status = '', designer_id = '', month = '', q = '' } = req.query;
  const kw = String(q).trim(), like = `%${kw}%`;
  const rows = db.prepare(`SELECT p.*, c.name AS customer_name, u.name AS designer_name
    FROM projects p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = p.designer_id
    WHERE (? = '' OR p.status = ?) AND (? = '' OR p.designer_id = ?)
      AND (? = '' OR substr(p.sign_date,1,7) = ?)
      AND (? = '' OR p.name LIKE ? OR p.code LIKE ? OR c.name LIKE ?)
      AND p.status <> 'lead' AND p.status <> 'lost'
    ORDER BY p.id DESC`)
    .all(status, status, designer_id, designer_id, month, month, kw, like, like, like);
  const out = [];
  const sum = {
    contract_total: 0, change_signed: 0, cost_committed: 0, sub_committed: 0,
    material_cost: 0, expense_cost: 0, gross_profit: 0, received: 0, receivable: 0, quoted_cost: 0
  };
  for (const p of rows) {
    const m = projectMoney(p.id);
    const row = {
      id: p.id, code: p.code, name: p.name, status: p.status,
      customer_name: p.customer_name, designer_name: p.designer_name, sign_date: p.sign_date,
      area_ping: p.area_ping, progress: projectProgress(p.id),
      ...m
    };
    delete row.milestones;
    // 每坪產值與每坪利潤：報價合不合理、案子該不該接，這兩個數字比總價有用
    row.per_ping = p.area_ping ? Math.round(m.contract_total / p.area_ping) : 0;
    row.profit_per_ping = p.area_ping ? Math.round(m.gross_profit / p.area_ping) : 0;
    out.push(row);
    for (const k of Object.keys(sum)) sum[k] += m[k] || 0;
  }
  sum.margin = sum.contract_total ? Math.round((sum.gross_profit / sum.contract_total) * 1000) / 10 : 0;
  sum.cost_variance = sum.cost_committed - sum.quoted_cost;
  res.json({ rows: out, sum });
});

// 單案的成本組成（圓餅圖與工種明細）
router.get('/profit/:id/breakdown', requireStaff('profit'), (req, res) => {
  const pid = Number(req.params.id);
  if (!get('projects', pid)) return res.status(404).json({ error: '找不到此案場' });
  res.json({
    money: projectMoney(pid),
    by_trade: db.prepare(`SELECT COALESCE(NULLIF(s.trade,''),'未分類') AS trade,
        SUM(s.amount) AS amount, COUNT(*) AS n
      FROM subcontracts s WHERE s.project_id = ? AND s.status <> 'draft'
      GROUP BY trade ORDER BY amount DESC`).all(pid),
    materials: db.prepare(`SELECT COALESCE(NULLIF(v.name,''),'未指定廠商') AS vendor, SUM(m.amount) AS amount
      FROM material_orders m LEFT JOIN vendors v ON v.id = m.vendor_id
      WHERE m.project_id = ? AND m.status <> 'cancelled' GROUP BY vendor ORDER BY amount DESC`).all(pid),
    expenses: db.prepare(`SELECT category, SUM(amount) AS amount FROM project_expenses
      WHERE project_id = ? GROUP BY category ORDER BY amount DESC`).all(pid)
  });
});

module.exports = router;
