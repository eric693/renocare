// 缺失與驗收、保固、圖面版本、許可與法規
const express = require('express');
const { db, audit, today, addMonths, nextSerial, deleteUpload } = require('../db');
const { requireStaff } = require('../auth');
const { picker, insert, update, get, remove } = require('../crud');
const { upload } = require('../upload');

const router = express.Router();

// ---- 缺失改善 ----
// 點交那天列出來的三十幾項，沒有系統就是一張紙，改到哪一項沒人知道。
// 這裡把「責任工班」設成必填的實務欄位：要修的人是誰、要扣誰的錢，從一開始就寫清楚。

const pickDefect = picker(['project_id', 'source', 'location', 'item', 'description', 'vendor_id', 'owner_id',
  'severity', 'found_date', 'due_date', 'fixed_date', 'verified_date', 'cost', 'charge_vendor', 'status', 'note'],
  ['project_id', 'vendor_id', 'owner_id', 'cost', 'charge_vendor']);

router.get('/defects', requireStaff('defects'), (req, res) => {
  const { project_id = '', status = '', vendor_id = '', source = '', q = '' } = req.query;
  const kw = String(q).trim(), like = `%${kw}%`;
  const rows = db.prepare(`SELECT d.*, v.name AS vendor_name, u.name AS owner_name,
      p.name AS project_name, p.code AS project_code,
      (SELECT COUNT(*) FROM photos ph WHERE ph.defect_id = d.id) AS photo_count
    FROM defects d JOIN projects p ON p.id = d.project_id
    LEFT JOIN vendors v ON v.id = d.vendor_id LEFT JOIN users u ON u.id = d.owner_id
    WHERE (? = '' OR d.project_id = ?) AND (? = '' OR d.status = ?)
      AND (? = '' OR d.vendor_id = ?) AND (? = '' OR d.source = ?)
      AND (? = '' OR d.no LIKE ? OR d.location LIKE ? OR d.item LIKE ? OR d.description LIKE ?
           OR p.name LIKE ? OR p.code LIKE ?)
    ORDER BY (d.status IN ('verified','void')), d.due_date, d.id DESC`)
    .all(project_id, project_id, status, status, vendor_id, vendor_id, source, source,
      kw, like, like, like, like, like, like);
  const t = today();
  for (const r of rows) {
    r.overdue = r.status === 'open' || r.status === 'fixing' ? !!(r.due_date && r.due_date < t) : false;
  }
  res.json(rows);
});

router.post('/defects', requireStaff('defects'), (req, res) => {
  const d = pickDefect(req.body || {});
  if (!d.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!d.item) return res.status(400).json({ error: '請填缺失項目' });
  d.no = nextSerial('defects', 'no', 'DF');
  if (!d.found_date) d.found_date = today();
  if (!d.owner_id) {
    const p = get('projects', d.project_id);
    d.owner_id = p ? (p.supervisor_id || p.designer_id) : null;
  }
  res.json({ id: insert('defects', d), no: d.no });
});

router.put('/defects/:id', requireStaff('defects'), (req, res) => {
  const before = get('defects', req.params.id);
  if (!before) return res.status(404).json({ error: '找不到此缺失' });
  const d = pickDefect(req.body || {});
  delete d.project_id;
  // 已經在估驗時扣過工班的錢，金額就不能再改，否則帳對不回去
  if (before.deducted_valuation_id && d.cost !== undefined && Number(d.cost) !== before.cost) {
    return res.status(400).json({ error: '這筆缺失的求償金額已在估驗中扣款，不能再改' });
  }
  if (d.status === 'fixed' && !d.fixed_date && !before.fixed_date) d.fixed_date = today();
  if (d.status === 'verified' && !d.verified_date && !before.verified_date) d.verified_date = today();
  update('defects', before.id, d);
  res.json({ ok: true });
});

router.delete('/defects/:id', requireStaff('defects'), (req, res) => {
  const d = get('defects', req.params.id);
  if (!d) return res.status(404).json({ error: '找不到此缺失' });
  if (d.deducted_valuation_id) return res.status(400).json({ error: '已在估驗中扣款的缺失不能刪除' });
  remove('defects', d.id);
  res.json({ ok: true });
});

// ---- 保固 ----

const pickWarranty = picker(['project_id', 'item', 'vendor_id', 'start_date', 'months', 'note'],
  ['project_id', 'vendor_id', 'months']);

router.get('/warranties', requireStaff('warranty'), (req, res) => {
  const { project_id = '', expiring = '', status = '', q = '' } = req.query;
  const kw = String(q).trim(), like = `%${kw}%`;
  const rows = db.prepare(`SELECT w.*, v.name AS vendor_name, p.name AS project_name, p.code AS project_code,
      c.name AS customer_name, c.phone AS customer_phone
    FROM warranties w JOIN projects p ON p.id = w.project_id
    LEFT JOIN vendors v ON v.id = w.vendor_id LEFT JOIN customers c ON c.id = p.customer_id
    WHERE (? = '' OR w.project_id = ?)
      AND (? = '' OR w.item LIKE ? OR p.name LIKE ? OR p.code LIKE ? OR c.name LIKE ? OR v.name LIKE ?)
    ORDER BY w.end_date`).all(project_id, project_id, kw, like, like, like, like, like);
  const t = today();
  for (const r of rows) {
    r.expired = !!(r.end_date && r.end_date < t);
    r.days_left = r.end_date ? Math.round((new Date(r.end_date) - new Date(t)) / 86400000) : null;
  }
  // status 是算出來的（沒有欄位），所以在這裡篩：valid 保固中、soon 60 天內到期、expired 已到期
  const byStatus = {
    valid: r => !r.expired,
    soon: r => !r.expired && r.days_left !== null && r.days_left <= 60,
    expired: r => r.expired
  }[expiring ? 'soon' : status];
  res.json(byStatus ? rows.filter(byStatus) : rows);
});

router.post('/warranties', requireStaff('warranty'), (req, res) => {
  const w = pickWarranty(req.body || {});
  if (!w.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!w.item) return res.status(400).json({ error: '請填保固項目' });
  const p = get('projects', w.project_id);
  if (!w.months) w.months = (p && p.warranty_months) || 12;
  if (!w.start_date && p && p.handover_date) w.start_date = p.handover_date;
  w.end_date = w.start_date ? addMonths(w.start_date, w.months) : '';
  res.json({ id: insert('warranties', w) });
});

router.put('/warranties/:id', requireStaff('warranty'), (req, res) => {
  const before = get('warranties', req.params.id);
  if (!before) return res.status(404).json({ error: '找不到此保固' });
  const w = pickWarranty(req.body || {});
  delete w.project_id;
  const start = w.start_date ?? before.start_date;
  const months = w.months ?? before.months;
  w.end_date = start ? addMonths(start, months) : '';
  update('warranties', before.id, w);
  res.json({ ok: true });
});

router.delete('/warranties/:id', requireStaff('warranty'), (req, res) => {
  remove('warranties', req.params.id);
  res.json({ ok: true });
});

// 保固報修：直接開一張 source='warranty' 的缺失單，用同一套改善／複驗流程，
// 不要再造第二個長得很像的東西。
router.post('/warranties/:id/report', requireStaff('warranty'), (req, res) => {
  const w = get('warranties', req.params.id);
  if (!w) return res.status(404).json({ error: '找不到此保固' });
  const b = req.body || {};
  const p = get('projects', w.project_id);
  const expired = w.end_date && w.end_date < today();
  const id = insert('defects', {
    project_id: w.project_id, no: nextSerial('defects', 'no', 'DF'), source: 'warranty',
    location: String(b.location || '').trim(), item: String(b.item || w.item).trim(),
    description: String(b.description || '').trim() + (expired ? `（注意：${w.item} 保固已於 ${w.end_date} 到期）` : ''),
    vendor_id: w.vendor_id, owner_id: p ? (p.supervisor_id || p.designer_id) : null,
    severity: String(b.severity || 'normal'), found_date: today(),
    due_date: String(b.due_date || '').trim(), status: 'open'
  });
  res.json({ id, expired: !!expired });
});

// ---- 圖面版本 ----

const pickDrawing = picker(['project_id', 'name', 'category', 'version', 'released_to', 'client_visible', 'note'],
  ['project_id', 'client_visible']);

router.get('/drawings', requireStaff('drawings'), (req, res) => {
  const { project_id = '', current = '' } = req.query;
  res.json(db.prepare(`SELECT d.*, u.name AS created_by_name, p.name AS project_name
    FROM drawings d JOIN projects p ON p.id = d.project_id LEFT JOIN users u ON u.id = d.created_by
    WHERE (? = '' OR d.project_id = ?) AND (? = '' OR d.is_current = 1)
    ORDER BY d.category, d.name, d.id DESC`).all(project_id, project_id, current));
});

// 上傳新版：同一個案子、同一張圖名的舊版自動退位。
// 「現行版本只有一個」是這張表存在的唯一理由 —— 工班拿舊圖施工是最貴的錯誤之一。
router.post('/drawings', requireStaff('drawings'), upload.single('file'), (req, res) => {
  const d = pickDrawing(req.body || {});
  if (!d.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!d.name) return res.status(400).json({ error: '請填圖面名稱' });
  if (!req.file) return res.status(400).json({ error: '請選擇檔案' });
  db.prepare('UPDATE drawings SET is_current = 0 WHERE project_id = ? AND name = ?').run(d.project_id, d.name);
  const last = db.prepare('SELECT version FROM drawings WHERE project_id = ? AND name = ? ORDER BY id DESC LIMIT 1')
    .get(d.project_id, d.name);
  if (!d.version) {
    const n = last ? (Number(String(last.version).replace(/\D/g, '')) || 0) + 1 : 1;
    d.version = 'v' + n;
  }
  d.url = '/uploads/' + req.file.filename;
  d.is_current = 1;
  d.created_by = req.user.id;
  const id = insert('drawings', d);
  audit('staff', req.user.id, req.user.name, '上傳圖面', d.name, d.version);
  res.json({ id, version: d.version });
});

// 發布給工班：留下發布時間與對象，日後「我沒收到新圖」有紀錄可查
router.post('/drawings/:id/release', requireStaff('drawings'), (req, res) => {
  const d = get('drawings', req.params.id);
  if (!d) return res.status(404).json({ error: '找不到此圖面' });
  db.prepare('UPDATE drawings SET released_at = ?, released_to = ? WHERE id = ?')
    .run(require('../db').nowStamp(), String(req.body.released_to || '').trim(), d.id);
  audit('staff', req.user.id, req.user.name, '發布圖面', `${d.name} ${d.version}`, String(req.body.released_to || ''));
  res.json({ ok: true });
});

// 檔案本身不能換（換檔就是出新版），但名稱、分類、版次、給不給業主看、備註是常要改的。
// 圖面名稱是「同一張圖」的判斷依據，所以改名要整組版本一起改，否則舊版會變成另一張沒有現行版的圖。
router.put('/drawings/:id', requireStaff('drawings'), (req, res) => {
  const d = get('drawings', req.params.id);
  if (!d) return res.status(404).json({ error: '找不到此圖面' });
  const b = picker(['name', 'category', 'version', 'client_visible', 'note'], ['client_visible'])(req.body || {});
  if (b.name !== undefined && !b.name) return res.status(400).json({ error: '請填圖面名稱' });
  if (b.version !== undefined && !b.version) return res.status(400).json({ error: '請填版次' });
  const name = b.name !== undefined ? b.name : d.name;
  if (name !== d.name) {
    const clash = db.prepare('SELECT COUNT(*) AS n FROM drawings WHERE project_id = ? AND name = ?').get(d.project_id, name).n;
    if (clash) return res.status(400).json({ error: `這個案子已經有一張「${name}」，改成同名會把兩張圖的版本混在一起` });
  }
  if (b.version !== undefined && b.version !== d.version) {
    const dup = db.prepare('SELECT COUNT(*) AS n FROM drawings WHERE project_id = ? AND name = ? AND version = ? AND id <> ?')
      .get(d.project_id, d.name, b.version, d.id).n;
    if (dup) return res.status(400).json({ error: `「${d.name}」已經有 ${b.version} 這個版次` });
  }
  delete b.name;
  db.transaction(() => {
    update('drawings', d.id, b);
    if (name !== d.name) db.prepare('UPDATE drawings SET name = ? WHERE project_id = ? AND name = ?').run(name, d.project_id, d.name);
  })();
  audit('staff', req.user.id, req.user.name, '修改圖面', `${d.name} ${d.version}`, name !== d.name ? `改名為 ${name}` : '');
  res.json({ ok: true });
});

router.delete('/drawings/:id', requireStaff('drawings'), (req, res) => {
  const d = get('drawings', req.params.id);
  if (!d) return res.status(404).json({ error: '找不到此圖面' });
  remove('drawings', d.id);
  deleteUpload(d.url);
  // 刪掉現行版，讓同名的上一版重新變成現行版，不要讓一張圖變成沒有現行版本
  if (d.is_current) {
    const prev = db.prepare('SELECT id FROM drawings WHERE project_id = ? AND name = ? ORDER BY id DESC LIMIT 1')
      .get(d.project_id, d.name);
    if (prev) db.prepare('UPDATE drawings SET is_current = 1 WHERE id = ?').run(prev.id);
  }
  res.json({ ok: true });
});

// ---- 許可與法規 ----

const pickPermit = picker(['project_id', 'kind', 'agency', 'doc_no', 'applied_date', 'approved_date',
  'expiry_date', 'owner_id', 'status', 'note'], ['project_id', 'owner_id']);

router.get('/permits', requireStaff('permits'), (req, res) => {
  const { project_id = '', status = '', q = '' } = req.query;
  const kw = String(q).trim(), like = `%${kw}%`;
  const rows = db.prepare(`SELECT pm.*, p.name AS project_name, p.code AS project_code, u.name AS owner_name
    FROM permits pm JOIN projects p ON p.id = pm.project_id LEFT JOIN users u ON u.id = pm.owner_id
    WHERE (? = '' OR pm.project_id = ?) AND (? = '' OR pm.status = ?)
      AND (? = '' OR pm.kind LIKE ? OR pm.agency LIKE ? OR pm.doc_no LIKE ? OR p.name LIKE ? OR p.code LIKE ?)
    ORDER BY (pm.status IN ('approved','na')), pm.expiry_date, pm.id`)
    .all(project_id, project_id, status, status, kw, like, like, like, like, like);
  const t = today();
  for (const r of rows) {
    r.days_left = r.expiry_date ? Math.round((new Date(r.expiry_date) - new Date(t)) / 86400000) : null;
    r.expired = r.days_left !== null && r.days_left < 0;
  }
  res.json(rows);
});

router.post('/permits', requireStaff('permits'), (req, res) => {
  const pm = pickPermit(req.body || {});
  if (!pm.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!pm.kind) return res.status(400).json({ error: '請選擇申辦項目' });
  res.json({ id: insert('permits', pm) });
});

router.put('/permits/:id', requireStaff('permits'), (req, res) => {
  if (!get('permits', req.params.id)) return res.status(404).json({ error: '找不到此案件' });
  const pm = pickPermit(req.body || {});
  delete pm.project_id;
  update('permits', Number(req.params.id), pm);
  res.json({ ok: true });
});

router.delete('/permits/:id', requireStaff('permits'), (req, res) => {
  remove('permits', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
