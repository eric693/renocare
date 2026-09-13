// 共用下拉選項、人員清單、系統設定、帳號權限、操作紀錄
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit, getSetting, setSetting, listSetting, DEFAULT_LISTS, UI_TEXT_KEYS } = require('../db');
const { requireStaff, requireAdmin, MODULES, MODULE_GROUPS, MODULE_KEYS, parsePermissions } = require('../auth');

const router = express.Router();

// 前端各頁的下拉選項都從這裡拿，改設定不必改程式
router.get('/meta', requireStaff(), (req, res) => {
  res.json({
    trades: listSetting('trades'),
    site_types: listSetting('site_types'),
    styles: listSetting('styles'),
    expense_categories: listSetting('expense_categories'),
    payment_methods: listSetting('payment_methods'),
    permit_kinds: listSetting('permit_kinds'),
    customer_sources: listSetting('customer_sources'),
    defaults: {
      retention_pct: Number(getSetting('default_retention_pct', '10')),
      warranty_pct: Number(getSetting('default_warranty_pct', '5')),
      warranty_months: Number(getSetting('default_warranty_months', '12')),
      review_days: Number(getSetting('review_days', '7')),
      client_bond_pct: Number(getSetting('client_bond_pct', '5')),
      acceptance_days: Number(getSetting('acceptance_days', '10'))
    }
  });
});

router.get('/staff-options', requireStaff(), (req, res) => {
  res.json(db.prepare('SELECT id, name, title FROM users WHERE active = 1 ORDER BY id').all());
});

// ---- 系統設定 ----

router.get('/settings', requireStaff('settings'), (req, res) => {
  const out = {};
  for (const k of Object.keys(DEFAULT_LISTS)) out[k] = getSetting(k, DEFAULT_LISTS[k]);
  for (const k of UI_TEXT_KEYS) out[k] = getSetting(k, '');
  out.audit_retention_days = getSetting('audit_retention_days', '730');
  out.alert_days = getSetting('alert_days', '7');
  res.json(out);
});

router.put('/settings', requireStaff('settings'), (req, res) => {
  const allowed = new Set([...Object.keys(DEFAULT_LISTS), ...UI_TEXT_KEYS, 'audit_retention_days', 'alert_days']);
  for (const [k, v] of Object.entries(req.body || {})) {
    if (allowed.has(k)) setSetting(k, String(v ?? ''));
  }
  audit('staff', req.user.id, req.user.name, '修改系統設定');
  res.json({ ok: true });
});

// ---- 帳號權限 ----

router.get('/modules', requireStaff(), (req, res) => res.json({ modules: MODULES, groups: MODULE_GROUPS }));

router.get('/users', requireStaff('users'), (req, res) => {
  const { role = '', active = '', q = '' } = req.query;
  const kw = String(q).trim(), like = `%${kw}%`;
  const rows = db.prepare(`SELECT id, username, name, title, role, phone, active, permissions, readonly_modules, created_at
    FROM users
    WHERE (? = '' OR role = ?) AND (? = '' OR active = ?)
      AND (? = '' OR username LIKE ? OR name LIKE ? OR title LIKE ? OR phone LIKE ?)
    ORDER BY active DESC, id`).all(role, role, active, active, kw, like, like, like, like);
  for (const r of rows) {
    r.modules = r.role === 'admin' ? MODULE_KEYS : parsePermissions(r.permissions);
    r.readonly = r.role === 'admin' ? [] : parsePermissions(r.readonly_modules);
  }
  res.json(rows);
});

function permJson(v) {
  const arr = String(v || '').split(',').map(s => s.trim()).filter(k => MODULE_KEYS.includes(k));
  return JSON.stringify([...new Set(arr)]);
}

router.post('/users', requireStaff('users'), (req, res) => {
  const b = req.body || {};
  if (!b.username || !b.name) return res.status(400).json({ error: '請填帳號與姓名' });
  if (!b.password || String(b.password).length < 6) return res.status(400).json({ error: '密碼至少 6 碼' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(String(b.username).trim())) {
    return res.status(400).json({ error: '這個帳號已經存在' });
  }
  const info = db.prepare(`INSERT INTO users (username, password_hash, name, title, role, phone, permissions, readonly_modules)
                           VALUES (?,?,?,?,?,?,?,?)`)
    .run(String(b.username).trim(), bcrypt.hashSync(String(b.password), 10), String(b.name).trim(),
      String(b.title || '').trim(), b.role === 'admin' ? 'admin' : 'staff', String(b.phone || '').trim(),
      permJson(b.modules), permJson(b.readonly));
  audit('staff', req.user.id, req.user.name, '新增帳號', b.username);
  res.json({ id: info.lastInsertRowid });
});

router.put('/users/:id', requireStaff('users'), (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '找不到此帳號' });
  const b = req.body || {};
  // 最後一個管理員不能被降級或停用，否則沒有人進得去改權限
  const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
  const losingAdmin = u.role === 'admin' && ((b.role !== undefined && b.role !== 'admin') || String(b.active) === '0');
  if (losingAdmin && admins <= 1) return res.status(400).json({ error: '系統至少要保留一位啟用中的管理員' });

  const set = {
    name: String(b.name ?? u.name).trim(),
    title: String(b.title ?? u.title).trim(),
    phone: String(b.phone ?? u.phone).trim(),
    role: b.role === undefined ? u.role : (b.role === 'admin' ? 'admin' : 'staff'),
    active: b.active === undefined ? u.active : (Number(b.active) ? 1 : 0),
    permissions: b.modules === undefined ? u.permissions : permJson(b.modules),
    readonly_modules: b.readonly === undefined ? u.readonly_modules : permJson(b.readonly)
  };
  db.prepare(`UPDATE users SET name=?, title=?, phone=?, role=?, active=?, permissions=?, readonly_modules=? WHERE id=?`)
    .run(set.name, set.title, set.phone, set.role, set.active, set.permissions, set.readonly_modules, id);
  if (b.password) {
    if (String(b.password).length < 6) return res.status(400).json({ error: '密碼至少 6 碼' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(b.password), 10), id);
  }
  audit('staff', req.user.id, req.user.name, '修改帳號', u.username);
  res.json({ ok: true });
});

// 刪除帳號：帳號一旦做過事就不能真的刪 —— 案場的設計師、日報的填寫人、
// 待辦的指派對象都指著它，刪掉會讓歷史紀錄變成無名氏。有紀錄的一律改成停用，
// 停用的人登不進來，效果一樣，但過去的軌跡還在。
const USER_REFS = [
  ['projects', 'designer_id', '擔任設計師的案場'],
  ['projects', 'supervisor_id', '擔任工地主任的案場'],
  ['tasks', 'assignee_id', '被指派的待辦'],
  ['tasks', 'created_by', '建立的待辦'],
  ['defects', 'owner_id', '負責的缺失'],
  ['permits', 'owner_id', '承辦的許可'],
  ['site_logs', 'created_by', '填寫的工地日報'],
  ['drawings', 'created_by', '上傳的圖面'],
  ['quotes', 'created_by', '建立的估價單'],
  ['change_orders', 'created_by', '建立的變更單'],
  ['receipts', 'created_by', '登錄的收款'],
  ['valuations', 'created_by', '建立的估驗單']
];

router.delete('/users/:id', requireStaff('users'), (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '找不到此帳號' });
  if (id === req.user.id) return res.status(400).json({ error: '不能刪除自己的帳號' });
  const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
  if (u.role === 'admin' && u.active && admins <= 1) {
    return res.status(400).json({ error: '系統至少要保留一位啟用中的管理員' });
  }
  const used = USER_REFS
    .map(([t, col, label]) => ({ label, n: db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`).get(id).n }))
    .filter(r => r.n > 0);
  if (used.length) {
    if (!u.active) return res.status(400).json({ error: '這個帳號已經停用了，有歷史紀錄不能刪除' });
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
    audit('staff', req.user.id, req.user.name, '停用帳號', u.username, used.map(r => `${r.label} ${r.n}`).join('、'));
    return res.json({ ok: true, deactivated: true,
      message: `這個帳號有 ${used.map(r => `${r.label} ${r.n} 筆`).join('、')}，不能刪除，已改為停用。` });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit('staff', req.user.id, req.user.name, '刪除帳號', u.username);
  res.json({ ok: true, deactivated: false });
});

// ---- 操作紀錄 ----

router.get('/audit', requireStaff('audit'), (req, res) => {
  const { q = '', limit = 200, actor_type = '', date_from = '', date_to = '' } = req.query;
  const kw = String(q).trim(), like = `%${kw}%`;
  res.json(db.prepare(`SELECT * FROM audit_logs
    WHERE (? = '' OR actor_name LIKE ? OR action LIKE ? OR target LIKE ? OR detail LIKE ?)
      AND (? = '' OR actor_type = ?)
      AND (? = '' OR substr(created_at,1,10) >= ?) AND (? = '' OR substr(created_at,1,10) <= ?)
    ORDER BY id DESC LIMIT ?`)
    .all(kw, like, like, like, like, actor_type, actor_type,
      date_from, date_from, date_to, date_to, Math.min(Number(limit) || 200, 1000)));
});

module.exports = router;
module.exports.requireAdmin = requireAdmin;
