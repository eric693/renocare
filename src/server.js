require('./env');   // 先把 .env 讀進 process.env，後面所有讀 env 的程式才拿得到
process.env.TZ = process.env.TZ || 'Asia/Taipei';

const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { db, audit, getSetting, UI_TEXT_KEYS } = require('./db');
const {
  STAFF_COOKIE, signToken, setAuthCookie, clearAuthCookie,
  requireStaff, parsePermissions, parseReadonly, MODULE_KEYS,
  loginLockedMinutes, loginFailed, loginSucceeded, rateLimit
} = require('./auth');

const loginRateLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 30, prefix: 'login:' });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

// ---- 公開端點：登入頁文字 ----

app.get('/api/public/ui-texts', (req, res) => {
  const out = { company_name: getSetting('company_name', '宅匠室內裝修') };
  for (const k of UI_TEXT_KEYS) out[k] = getSetting(k);
  res.json(out);
});

// 業主端（憑連結的亂數 token 進入，不需要帳號）
app.use('/api/client', require('./routes/client'));

// ---- 登入 ----

app.post('/api/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  const lockKey = `staff:${username || ''}`;
  const locked = loginLockedMinutes(lockKey);
  if (locked) return res.status(429).json({ error: `登入失敗次數過多，請 ${locked} 分鐘後再試` });
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    loginFailed(lockKey);
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  loginSucceeded(lockKey);
  setAuthCookie(res, STAFF_COOKIE, signToken({ t: 'staff', id: user.id }), req);
  audit('staff', user.id, user.name, '員工登入');
  res.json({ id: user.id, name: user.name, role: user.role });
});

app.post('/api/logout', (req, res) => {
  clearAuthCookie(res, STAFF_COOKIE, req);
  res.json({ ok: true });
});

app.get('/api/me', requireStaff(), (req, res) => {
  res.json({
    id: req.user.id, username: req.user.username, name: req.user.name,
    role: req.user.role, title: req.user.title,
    modules: req.user.role === 'admin' ? MODULE_KEYS : parsePermissions(req.user.permissions),
    readonly: req.user.role === 'admin' ? [] : parseReadonly(req.user.readonly_modules),
    company_name: getSetting('company_name', '宅匠室內裝修')
  });
});

app.put('/api/me/password', requireStaff(), (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!bcrypt.compareSync(old_password || '', req.user.password_hash)) {
    return res.status(400).json({ error: '舊密碼不正確' });
  }
  if (!new_password || String(new_password).length < 6) {
    return res.status(400).json({ error: '新密碼至少 6 碼' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(String(new_password), 10), req.user.id);
  audit('staff', req.user.id, req.user.name, '修改自己的密碼');
  res.json({ ok: true });
});

// ---- 各模組路由 ----

app.use('/api', require('./routes/core'));
app.use('/api', require('./routes/dashboard'));
app.use('/api', require('./routes/projects'));
app.use('/api', require('./routes/quotes'));
app.use('/api', require('./routes/changes'));
app.use('/api', require('./routes/billing'));
app.use('/api', require('./routes/vendors'));
app.use('/api', require('./routes/schedule'));
app.use('/api', require('./routes/site'));
app.use('/api', require('./routes/quality'));

// ---- 靜態檔案 ----

// 工地照片要能在業主端看到，而業主端是憑連結進來的（沒有員工帳號），
// 所以 /uploads 不能整個鎖起來；檔名是亂數，等同不可猜的連結。
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { maxAge: '7d' }));
// 前端程式碼不做長快取：改版後若瀏覽器還拿著舊的 JS，會出現「新的 API 配舊的畫面」。
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: 'index.html',
  etag: true,
  setHeaders(res, filePath) {
    if (/(sw\.js|manifest\.webmanifest)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      if (/sw\.js$/i.test(filePath)) res.setHeader('Service-Worker-Allowed', '/');
    }
    else if (/\.(js|css|html)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=604800');
  }
}));

app.use('/api', (req, res) => res.status(404).json({ error: '找不到此 API' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '系統發生錯誤，請稍後再試' });
});

// ---- 每日維護：備份（保留 14 份）、稽核清理、自動提醒 ----

const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
const BACKUP_MIRROR = process.env.RENOCARE_BACKUP_MIRROR !== undefined
  ? process.env.RENOCARE_BACKUP_MIRROR
  : '/root/backups/renocare';
const BACKUP_KEEP = 14;

function unlinkBackup(dir, dbName) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(path.join(dir, dbName + suffix)); } catch { /* 不存在即略過 */ }
  }
}

function sweepBackupDir(dir) {
  if (!fs.existsSync(dir)) return;
  const all = fs.readdirSync(dir);
  const dbs = all.filter(f => /^renocare-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  while (dbs.length > BACKUP_KEEP) unlinkBackup(dir, dbs.shift());
  const kept = new Set(dbs);
  for (const f of all) {
    const m = f.match(/^(renocare-\d{4}-\d{2}-\d{2}\.db)-(wal|shm)$/);
    if (!m) continue;
    const p = path.join(dir, f);
    let drop = !kept.has(m[1]) || m[2] === 'shm';
    if (!drop && m[2] === 'wal') { try { drop = fs.statSync(p).size === 0; } catch { drop = true; } }
    if (drop) { try { fs.unlinkSync(p); } catch { /* 略過 */ } }
  }
}

async function dailyMaintenance() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const s = new Date();
    const name = `renocare-${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}.db`;
    const dest = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(dest)) {
      await db.backup(dest);
      console.log(`資料庫已備份：${dest}`);
      if (BACKUP_MIRROR) {
        try {
          fs.mkdirSync(BACKUP_MIRROR, { recursive: true });
          fs.copyFileSync(dest, path.join(BACKUP_MIRROR, name));
          sweepBackupDir(BACKUP_MIRROR);
        } catch (e) { console.error('異地備份失敗：', e.message); }
      }
    }
    sweepBackupDir(BACKUP_DIR);
    const retention = Number(getSetting('audit_retention_days', '730'));
    if (retention > 0) {
      db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now','localtime',?)").run(`-${retention} days`);
    }
    require('./reminders').run();      // 請款節點到了、許可要到期、保固快過：自動開待辦
  } catch (e) { console.error('每日維護作業失敗：', e.message); }
}
dailyMaintenance();
setInterval(dailyMaintenance, 6 * 3600 * 1000);

const PORT = process.env.PORT || 3490;
app.listen(PORT, () => {
  console.log(`RenoCare 宅匠 室內設計／裝修工程營運管理系統 http://localhost:${PORT}`);
});
