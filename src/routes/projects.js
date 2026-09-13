// 客戶、案場專案、合約，以及「一個案子的全貌」那支彙總 API
const express = require('express');
const { db, audit, today, nextSerial, randomToken, addMonths, listSetting, getSetting } = require('../db');
const { requireStaff } = require('../auth');
const { picker, insert, update, get, remove, checkTaxId } = require('../crud');
const { projectMoney, projectProgress, hideCosts, canSee } = require('../finance');

const router = express.Router();

// ---- 客戶 ----

const pickCustomer = picker(['name', 'phone', 'email', 'line_id', 'address', 'tax_id', 'source', 'note']);

router.get('/customers', requireStaff('customers'), (req, res) => {
  const q = String(req.query.q || '').trim();
  const source = String(req.query.source || '').trim();
  const like = `%${q}%`;
  res.json(db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM projects p WHERE p.customer_id = c.id) AS project_count,
      (SELECT COALESCE(SUM(ct.amount),0) FROM contracts ct JOIN projects p ON p.id = ct.project_id
        WHERE p.customer_id = c.id AND ct.status = 'active') AS contract_amount
    FROM customers c
    WHERE (? = '' OR c.name LIKE ? OR c.phone LIKE ? OR c.address LIKE ?)
      AND (? = '' OR c.source = ?)
    ORDER BY c.id DESC`).all(q, like, like, like, source, source));
});

router.post('/customers', requireStaff('customers'), (req, res) => {
  const c = pickCustomer(req.body || {});
  if (!c.name) return res.status(400).json({ error: '請填客戶姓名' });
  const bad = checkTaxId(c);
  if (bad) return res.status(400).json({ error: bad });
  res.json({ id: insert('customers', c) });
});

router.put('/customers/:id', requireStaff('customers'), (req, res) => {
  if (!get('customers', req.params.id)) return res.status(404).json({ error: '找不到此客戶' });
  const c = pickCustomer(req.body || {});
  const bad = checkTaxId(c);
  if (bad) return res.status(400).json({ error: bad });
  update('customers', Number(req.params.id), c);
  res.json({ ok: true });
});

router.delete('/customers/:id', requireStaff('customers'), (req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE customer_id = ?').get(Number(req.params.id)).n;
  if (n) return res.status(400).json({ error: `這位客戶名下還有 ${n} 個案子，不能刪除` });
  remove('customers', req.params.id);
  res.json({ ok: true });
});

// ---- 專案 ----

const PROJECT_FIELDS = ['name', 'customer_id', 'address', 'site_type', 'area_ping', 'style', 'designer_id',
  'supervisor_id', 'status', 'sign_date', 'start_date', 'due_date', 'actual_end_date', 'handover_date',
  'acceptance_notice_date', 'warranty_months', 'note'];
const pickProject = picker(PROJECT_FIELDS, ['customer_id', 'designer_id', 'supervisor_id', 'warranty_months'], ['area_ping']);

// 清單：一列就要看得出「這案子現在卡在哪、錢收了沒、還賺不賺」
router.get('/projects', requireStaff('projects'), (req, res) => {
  const { status = '', designer_id = '', q = '' } = req.query;
  const like = `%${String(q).trim()}%`;
  const rows = db.prepare(`SELECT p.*, c.name AS customer_name, c.phone AS customer_phone,
      d.name AS designer_name, s.name AS supervisor_name
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN users d ON d.id = p.designer_id
    LEFT JOIN users s ON s.id = p.supervisor_id
    WHERE (? = '' OR p.status = ?)
      AND (? = '' OR p.designer_id = ?)
      AND (? = '' OR p.name LIKE ? OR p.code LIKE ? OR p.address LIKE ? OR c.name LIKE ?)
    ORDER BY p.id DESC`)
    .all(status, status, designer_id, designer_id, String(q).trim(), like, like, like, like);
  for (const r of rows) {
    const m = projectMoney(r.id);
    r.contract_total = m.contract_total;
    r.received = m.received;
    r.receivable = m.receivable;
    r.overdue = m.overdue;
    r.gross_profit = m.gross_profit;
    r.margin = m.margin;
    r.change_pending = m.change_pending;
    r.change_sent_count = m.change_sent_count;
    r.progress = projectProgress(r.id);
    // 合約完工日已過、案子還沒結 → 逾期天數（違約金的前哨）
    r.delay_days = (r.due_date && !r.actual_end_date && r.due_date < today())
      ? Math.round((new Date(today()) - new Date(r.due_date)) / 86400000) : 0;
  }
  if (!canSee(req, 'profit')) rows.forEach(hideCosts);
  res.json(rows);
});

router.post('/projects', requireStaff('projects'), (req, res) => {
  const p = pickProject(req.body || {});
  if (!p.name) return res.status(400).json({ error: '請填案名' });
  p.code = nextSerial('projects', 'code', 'PJ');
  const id = insert('projects', p);
  audit('staff', req.user.id, req.user.name, '建立案場', p.code, p.name);
  res.json({ id, code: p.code });
});

router.put('/projects/:id', requireStaff('projects'), (req, res) => {
  const id = Number(req.params.id);
  const before = get('projects', id);
  if (!before) return res.status(404).json({ error: '找不到此案場' });
  const p = pickProject(req.body || {});
  update('projects', id, p);
  // 交屋日一填，保固期自動起算：保固單少建一張，日後就少一次爭議
  if (p.handover_date && p.handover_date !== before.handover_date) syncWarrantyDates(id);
  audit('staff', req.user.id, req.user.name, '修改案場', before.code, p.status || '');
  res.json({ ok: true });
});

router.delete('/projects/:id', requireStaff('projects'), (req, res) => {
  const p = get('projects', req.params.id);
  if (!p) return res.status(404).json({ error: '找不到此案場' });
  const money = projectMoney(p.id);
  if (money.received > 0 || money.sub_paid > 0) {
    return res.status(400).json({ error: '這個案子已經有收款或付款紀錄，不能刪除；請改成「未成交／結案」' });
  }
  remove('projects', p.id);
  audit('staff', req.user.id, req.user.name, '刪除案場', p.code, p.name);
  res.json({ ok: true });
});

// 保固起算日跟著交屋日走（沒自己填起日的才同步，人工指定過的不動）
function syncWarrantyDates(projectId) {
  const p = get('projects', projectId);
  if (!p || !p.handover_date) return;
  for (const w of db.prepare('SELECT * FROM warranties WHERE project_id = ?').all(projectId)) {
    if (w.start_date) continue;
    const end = addMonths(p.handover_date, w.months || p.warranty_months || 12);
    db.prepare('UPDATE warranties SET start_date = ?, end_date = ? WHERE id = ?').run(p.handover_date, end, w.id);
  }
}

// ---- 業主端連結 ----

router.post('/projects/:id/client-link', requireStaff('projects'), (req, res) => {
  const p = get('projects', req.params.id);
  if (!p) return res.status(404).json({ error: '找不到此案場' });
  const token = randomToken();
  db.prepare('UPDATE projects SET client_token = ? WHERE id = ?').run(token, p.id);
  audit('staff', req.user.id, req.user.name, '產生業主端連結', p.code);
  res.json({ token, url: `/client.html#${token}` });
});

router.delete('/projects/:id/client-link', requireStaff('projects'), (req, res) => {
  const p = get('projects', req.params.id);
  if (!p) return res.status(404).json({ error: '找不到此案場' });
  db.prepare("UPDATE projects SET client_token = '' WHERE id = ?").run(p.id);
  audit('staff', req.user.id, req.user.name, '停用業主端連結', p.code);
  res.json({ ok: true });
});

// ---- 合約 ----

const pickContractFields = picker(['project_id', 'contract_no', 'kind', 'quote_id', 'sign_date', 'amount',
  'work_days', 'penalty_per_day', 'review_given_date', 'warranty_bond_amount', 'warranty_bond_date',
  'warranty_bond_returned_date', 'status', 'note'],
['project_id', 'quote_id', 'amount', 'work_days', 'penalty_per_day', 'warranty_bond_amount']);
// 數字欄位留空時 picker 給 null，但這幾欄在資料表是 NOT NULL —— 留空就是 0，不要讓存檔失敗
function pickContract(body) {
  const c = pickContractFields(body);
  for (const k of ['amount', 'work_days', 'penalty_per_day', 'warranty_bond_amount']) if (c[k] === null) c[k] = 0;
  return c;
}

router.post('/contracts', requireStaff('projects'), (req, res) => {
  const c = pickContract(req.body || {});
  if (!c.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!c.contract_no) c.contract_no = nextSerial('contracts', 'contract_no', 'CT');
  const id = insert('contracts', c);
  // 簽了約，案子狀態自動往前推一格（還停在洽談／設計中的話）
  const p = get('projects', c.project_id);
  if (p && ['lead', 'design'].includes(p.status)) {
    db.prepare("UPDATE projects SET status = 'contracted', sign_date = COALESCE(NULLIF(sign_date,''), ?) WHERE id = ?")
      .run(c.sign_date || today(), p.id);
  }
  audit('staff', req.user.id, req.user.name, '建立合約', c.contract_no, String(c.amount));
  res.json({ id });
});

router.put('/contracts/:id', requireStaff('projects'), (req, res) => {
  const before = get('contracts', req.params.id);
  if (!before) return res.status(404).json({ error: '找不到此合約' });
  const c = pickContract(req.body || {});
  delete c.project_id;   // 合約不換案子，要換就刪掉重開，否則收付款會對到別的案
  update('contracts', before.id, c);
  audit('staff', req.user.id, req.user.name, '修改合約', before.contract_no,
    `${before.amount} → ${c.amount ?? before.amount}`);
  res.json({ ok: true });
});

router.delete('/contracts/:id', requireStaff('projects'), (req, res) => {
  const c = get('contracts', req.params.id);
  if (!c) return res.status(404).json({ error: '找不到此合約' });
  remove('contracts', c.id);
  audit('staff', req.user.id, req.user.name, '刪除合約', c.contract_no);
  res.json({ ok: true });
});

// ---- 一個案子的全貌 ----
// 案場詳情頁一次要顯示十幾個區塊。拆成十幾支 API 會讓畫面一格一格跳出來，
// 而且每一格都可能自己失敗；這裡一次給完，前端只要畫。

// 選案場的頁面（工進、日報、發包、請款、圖面）也靠這支拿資料，所以有其中任一模組就能進來。
// 但「進得來」不等於「每一塊都看得到」：沒有對應模組的區塊回空陣列（前端分頁照畫不會炸），
// 成本與毛利只給有損益權限的人 —— 否則工務從這裡就讀得到估價成本，設計師讀得到發包金額。
const DETAIL_MODULES = ['projects', 'schedule', 'sitelog', 'subcontracts', 'billing', 'drawings'];
const SECTION_MODULES = {
  contracts: ['billing'], receipts: ['billing'], quotes: ['quotes'], changes: ['changes'],
  subcontracts: ['subcontracts'], materials: ['materials'], defects: ['defects'], warranties: ['warranty'],
  logs: ['sitelog'], photos: ['sitelog'], drawings: ['drawings'], permits: ['permits'], expenses: ['profit']
};

router.get('/projects/:id/detail', requireStaff(), (req, res) => {
  if (!DETAIL_MODULES.some(m => canSee(req, m))) return res.status(403).json({ error: '無此模組使用權限' });
  const p = db.prepare(`SELECT p.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
      d.name AS designer_name, s.name AS supervisor_name
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN users d ON d.id = p.designer_id
    LEFT JOIN users s ON s.id = p.supervisor_id
    WHERE p.id = ?`).get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: '找不到此案場' });
  const id = p.id;
  const all = sql => db.prepare(sql).all(id);

  const out = {
    project: p,
    money: projectMoney(id),
    progress: projectProgress(id),
    contracts: all('SELECT * FROM contracts WHERE project_id = ? ORDER BY id'),
    quotes: all(`SELECT q.*, u.name AS created_by_name FROM quotes q LEFT JOIN users u ON u.id = q.created_by
                 WHERE q.project_id = ? ORDER BY q.id DESC`),
    changes: all(`SELECT co.*, u.name AS created_by_name FROM change_orders co LEFT JOIN users u ON u.id = co.created_by
                  WHERE co.project_id = ? ORDER BY co.id DESC`),
    schedule: all(`SELECT si.*, v.name AS vendor_name FROM schedule_items si LEFT JOIN vendors v ON v.id = si.vendor_id
                   WHERE si.project_id = ? ORDER BY si.seq, si.id`),
    subcontracts: all(`SELECT s.*, v.name AS vendor_name,
        (SELECT COALESCE(SUM(x.gross_amount),0) FROM valuations x WHERE x.subcontract_id = s.id AND x.status <> 'draft') AS valued,
        (SELECT COALESCE(SUM(x.net_amount),0) FROM valuations x WHERE x.subcontract_id = s.id AND x.status = 'paid') AS paid,
        (SELECT COALESCE(SUM(x.retention),0) FROM valuations x WHERE x.subcontract_id = s.id AND x.status <> 'draft')
          - (SELECT COALESCE(SUM(r.amount),0) FROM retention_releases r WHERE r.subcontract_id = s.id AND r.kind='retention') AS retention_held,
        (SELECT COALESCE(SUM(x.warranty_hold),0) FROM valuations x WHERE x.subcontract_id = s.id AND x.status <> 'draft')
          - (SELECT COALESCE(SUM(r.amount),0) FROM retention_releases r WHERE r.subcontract_id = s.id AND r.kind='warranty') AS warranty_held
      FROM subcontracts s LEFT JOIN vendors v ON v.id = s.vendor_id
      WHERE s.project_id = ? ORDER BY s.id`),
    receipts: all('SELECT * FROM receipts WHERE project_id = ? ORDER BY date DESC, id DESC'),
    materials: all(`SELECT m.*, v.name AS vendor_name, si.name AS schedule_name
      FROM material_orders m LEFT JOIN vendors v ON v.id = m.vendor_id
      LEFT JOIN schedule_items si ON si.id = m.schedule_item_id
      WHERE m.project_id = ? ORDER BY m.need_date, m.id`),
    defects: all(`SELECT d.*, v.name AS vendor_name, u.name AS owner_name
      FROM defects d LEFT JOIN vendors v ON v.id = d.vendor_id LEFT JOIN users u ON u.id = d.owner_id
      WHERE d.project_id = ? ORDER BY (d.status IN ('verified','void')), d.id DESC`),
    logs: all(`SELECT l.*, u.name AS created_by_name,
        (SELECT COUNT(*) FROM photos ph WHERE ph.log_id = l.id) AS photo_count
      FROM site_logs l LEFT JOIN users u ON u.id = l.created_by
      WHERE l.project_id = ? ORDER BY l.date DESC, l.id DESC LIMIT 30`),
    photos: all('SELECT * FROM photos WHERE project_id = ? ORDER BY taken_date DESC, id DESC LIMIT 60'),
    drawings: all('SELECT * FROM drawings WHERE project_id = ? ORDER BY category, name, id DESC'),
    permits: all(`SELECT pm.*, u.name AS owner_name FROM permits pm LEFT JOIN users u ON u.id = pm.owner_id
                  WHERE pm.project_id = ? ORDER BY pm.id`),
    warranties: all(`SELECT w.*, v.name AS vendor_name FROM warranties w LEFT JOIN vendors v ON v.id = w.vendor_id
                     WHERE w.project_id = ? ORDER BY w.end_date`),
    expenses: all(`SELECT e.*, v.name AS vendor_name FROM project_expenses e LEFT JOIN vendors v ON v.id = e.vendor_id
                   WHERE e.project_id = ? ORDER BY e.date DESC, e.id DESC`),
    tasks: all(`SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
                WHERE t.project_id = ? AND t.status IN ('todo','doing') ORDER BY t.due_date, t.id`)
  };
  for (const [key, mods] of Object.entries(SECTION_MODULES)) {
    if (!mods.some(m => canSee(req, m))) out[key] = [];
  }
  if (!canSee(req, 'billing')) out.money.milestones = [];
  if (!canSee(req, 'profit')) hideCosts(out.money);
  res.json(out);
});

// ---- 專案雜支 ----

const pickExpense = picker(['project_id', 'date', 'category', 'item', 'vendor_id', 'amount', 'invoice_no', 'note'],
  ['project_id', 'vendor_id', 'amount']);

router.post('/project-expenses', requireStaff('projects'), (req, res) => {
  const e = pickExpense(req.body || {});
  if (!e.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!e.date) e.date = today();
  e.created_by = req.user.id;
  res.json({ id: insert('project_expenses', e) });
});

router.put('/project-expenses/:id', requireStaff('projects'), (req, res) => {
  if (!get('project_expenses', req.params.id)) return res.status(404).json({ error: '找不到此筆支出' });
  const e = pickExpense(req.body || {});
  delete e.project_id;
  update('project_expenses', Number(req.params.id), e);
  res.json({ ok: true });
});

router.delete('/project-expenses/:id', requireStaff('projects'), (req, res) => {
  remove('project_expenses', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
