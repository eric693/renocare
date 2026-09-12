// 工地日報、現場照片、建材訂料
//
// 照片不是拿來紀念的，是證據：封板前的水電照、拆除前的原況照，
// 日後爭議時「有沒有拍」決定的是幾萬到幾十萬的責任歸屬。
// 所以照片一定綁到「哪個案、哪一天、哪個工序」，而不是丟在 LINE 群組裡往上捲。

const express = require('express');
const { db, audit, today, deleteUpload } = require('../db');
const { requireStaff } = require('../auth');
const { picker, insert, update, get, remove, lineAmount } = require('../crud');
const { upload } = require('../upload');

const router = express.Router();

// ---- 工地日報 ----

const pickLog = picker(['project_id', 'date', 'weather', 'workers', 'trades', 'progress_note', 'issue_note'],
  ['project_id', 'workers']);

router.get('/site-logs', requireStaff('sitelog'), (req, res) => {
  const { project_id = '', date_from = '', date_to = '' } = req.query;
  res.json(db.prepare(`SELECT l.*, p.name AS project_name, p.code AS project_code, u.name AS created_by_name,
      (SELECT COUNT(*) FROM photos ph WHERE ph.log_id = l.id) AS photo_count
    FROM site_logs l JOIN projects p ON p.id = l.project_id LEFT JOIN users u ON u.id = l.created_by
    WHERE (? = '' OR l.project_id = ?) AND (? = '' OR l.date >= ?) AND (? = '' OR l.date <= ?)
    ORDER BY l.date DESC, l.id DESC LIMIT 300`)
    .all(project_id, project_id, date_from, date_from, date_to, date_to));
});

router.post('/site-logs', requireStaff('sitelog'), (req, res) => {
  const l = pickLog(req.body || {});
  if (!l.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!l.date) l.date = today();
  // 一天一份：同一天重複填會覆蓋，不要在系統裡養出兩份互相矛盾的日報
  const dup = db.prepare('SELECT id FROM site_logs WHERE project_id = ? AND date = ?').get(l.project_id, l.date);
  if (dup) { update('site_logs', dup.id, l); return res.json({ id: dup.id, merged: true }); }
  l.created_by = req.user.id;
  res.json({ id: insert('site_logs', l) });
});

router.put('/site-logs/:id', requireStaff('sitelog'), (req, res) => {
  if (!get('site_logs', req.params.id)) return res.status(404).json({ error: '找不到此日報' });
  const l = pickLog(req.body || {});
  delete l.project_id;
  update('site_logs', Number(req.params.id), l);
  res.json({ ok: true });
});

router.delete('/site-logs/:id', requireStaff('sitelog'), (req, res) => {
  remove('site_logs', req.params.id);
  res.json({ ok: true });
});

// ---- 照片 ----

router.get('/photos', requireStaff('sitelog'), (req, res) => {
  const { project_id = '', phase = '', schedule_item_id = '', date_from = '', date_to = '' } = req.query;
  res.json(db.prepare(`SELECT ph.*, si.name AS schedule_name, u.name AS created_by_name
    FROM photos ph LEFT JOIN schedule_items si ON si.id = ph.schedule_item_id
    LEFT JOIN users u ON u.id = ph.created_by
    WHERE (? = '' OR ph.project_id = ?) AND (? = '' OR ph.phase = ?)
      AND (? = '' OR ph.schedule_item_id = ?)
      AND (? = '' OR ph.taken_date >= ?) AND (? = '' OR ph.taken_date <= ?)
    ORDER BY ph.taken_date DESC, ph.id DESC LIMIT 500`)
    .all(project_id, project_id, phase, phase, schedule_item_id, schedule_item_id,
      date_from, date_from, date_to, date_to));
});

router.post('/photos', requireStaff('sitelog'), upload.array('files', 20), (req, res) => {
  const b = req.body || {};
  const pid = Number(b.project_id) || 0;
  if (!get('projects', pid)) return res.status(400).json({ error: '請指定案場' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '請選擇照片' });
  const ids = [];
  for (const f of files) {
    ids.push(insert('photos', {
      project_id: pid, url: '/uploads/' + f.filename,
      caption: String(b.caption || '').trim(),
      phase: String(b.phase || 'during').trim(),
      taken_date: String(b.taken_date || '').trim() || today(),
      schedule_item_id: Number(b.schedule_item_id) || null,
      log_id: Number(b.log_id) || null,
      defect_id: Number(b.defect_id) || null,
      client_visible: Number(b.client_visible) === 0 ? 0 : 1,
      created_by: req.user.id
    }));
  }
  audit('staff', req.user.id, req.user.name, '上傳工地照片', String(pid), `${files.length} 張`);
  res.json({ ids });
});

router.put('/photos/:id', requireStaff('sitelog'), (req, res) => {
  if (!get('photos', req.params.id)) return res.status(404).json({ error: '找不到此照片' });
  const p = picker(['caption', 'phase', 'taken_date', 'schedule_item_id', 'defect_id', 'client_visible'],
    ['schedule_item_id', 'defect_id', 'client_visible'])(req.body || {});
  update('photos', Number(req.params.id), p);
  res.json({ ok: true });
});

router.delete('/photos/:id', requireStaff('sitelog'), (req, res) => {
  const p = get('photos', req.params.id);
  if (!p) return res.status(404).json({ error: '找不到此照片' });
  remove('photos', p.id);
  deleteUpload(p.url);
  res.json({ ok: true });
});

// ---- 建材訂料 ----

const pickMaterial = picker(['project_id', 'vendor_id', 'schedule_item_id', 'name', 'spec', 'unit',
  'need_date', 'order_date', 'eta_date', 'arrived_date', 'status', 'note'],
  ['project_id', 'vendor_id', 'schedule_item_id'], ['qty']);

function materialRow(b) {
  const m = pickMaterial(b);
  if (b.qty !== undefined || b.unit_price !== undefined) {
    m.qty = Number(b.qty) || 0;
    m.unit_price = Math.round(Number(b.unit_price) || 0);
    m.amount = lineAmount(m.qty, m.unit_price);
  }
  return m;
}

router.get('/materials', requireStaff('materials'), (req, res) => {
  const { project_id = '', status = '', risk = '' } = req.query;
  const rows = db.prepare(`SELECT m.*, v.name AS vendor_name, p.name AS project_name, p.code AS project_code,
      si.name AS schedule_name, si.planned_start AS schedule_start
    FROM material_orders m JOIN projects p ON p.id = m.project_id
    LEFT JOIN vendors v ON v.id = m.vendor_id LEFT JOIN schedule_items si ON si.id = m.schedule_item_id
    WHERE (? = '' OR m.project_id = ?) AND (? = '' OR m.status = ?)
    ORDER BY m.need_date, m.id`).all(project_id, project_id, status, status);
  const t = today();
  for (const r of rows) {
    // 會不會來不及：有交期就比交期，沒交期又還沒下單就看現場需要日
    r.late_days = (r.eta_date && r.need_date && r.eta_date > r.need_date)
      ? Math.round((new Date(r.eta_date) - new Date(r.need_date)) / 86400000) : 0;
    r.not_ordered = r.status === 'planned' && r.need_date && r.need_date <= t;
  }
  res.json(risk ? rows.filter(r => r.late_days > 0 || r.not_ordered) : rows);
});

router.post('/materials', requireStaff('materials'), (req, res) => {
  const m = materialRow(req.body || {});
  if (!m.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!m.name) return res.status(400).json({ error: '請填品項' });
  // 掛了工序卻沒填現場需要日：直接用該工序的開工日，少一次人工填寫也少一次填錯
  if (m.schedule_item_id && !m.need_date) {
    const si = get('schedule_items', m.schedule_item_id);
    if (si) m.need_date = si.planned_start;
  }
  res.json({ id: insert('material_orders', m) });
});

router.put('/materials/:id', requireStaff('materials'), (req, res) => {
  const before = get('material_orders', req.params.id);
  if (!before) return res.status(404).json({ error: '找不到此訂料' });
  const m = materialRow(req.body || {});
  delete m.project_id;
  if (m.arrived_date && !m.status) m.status = 'arrived';
  update('material_orders', before.id, m);
  res.json({ ok: true });
});

router.delete('/materials/:id', requireStaff('materials'), (req, res) => {
  remove('material_orders', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
