const jwt = require('jsonwebtoken');
const { db, SECRET } = require('./db');

const STAFF_COOKIE = 'rc_staff';
const TOKEN_TTL = '7d';

// 模組權限清單（staff 帳號逐一勾選；admin 全開）
// group 對應側欄的分類，勾選權限時照同樣的分組排列，找得到也對得起來
const MODULES = [
  { key: 'dashboard', label: '營運儀表板', group: '每日作業', hint: '在建案場、今日該做的事、要錢與被要錢的事' },
  { key: 'projects', label: '案場專案', group: '每日作業', hint: '一個案子的全貌：合約、工進、收付、損益' },
  { key: 'schedule', label: '工進排程', group: '每日作業', hint: '工序相依與延誤連動，改一處後面自動推' },
  { key: 'sitelog', label: '工地日報與照片', group: '每日作業', hint: '每日出工、進度、現場照片留證' },
  { key: 'tasks', label: '待辦事項', group: '每日作業', hint: '個人與全公司待辦，含系統自動提醒' },
  { key: 'ai', label: 'AI 助理', group: '每日作業', hint: '用問的查系統資料，範圍跟帳號權限一樣（只能查不能改）' },

  { key: 'customers', label: '客戶名單', group: '接案', hint: '業主資料、來源、承接紀錄' },
  { key: 'quotes', label: '估價單', group: '接案', hint: '多版本估價、成本與毛利預估' },
  { key: 'unitprices', label: '工項單價庫', group: '接案', hint: '工項報價與成本的公版，開單直接帶' },

  { key: 'changes', label: '追加減帳', group: '合約與收款', hint: '變更單簽認鏈，簽了才算錢' },
  { key: 'billing', label: '請款與收款', group: '合約與收款', hint: '請款節點、應收帳齡、逾期催收' },

  { key: 'vendors', label: '工班與廠商', group: '發包', hint: '工種、評價、保險到期' },
  { key: 'subcontracts', label: '發包與估驗', group: '發包', hint: '發包單、估驗計價、保留款與保固金' },
  { key: 'materials', label: '建材訂料', group: '發包', hint: '交期追蹤，料沒到就是工進要延' },

  { key: 'defects', label: '缺失與驗收', group: '交屋', hint: '點交缺失、責任工班、複驗' },
  { key: 'warranty', label: '保固維修', group: '交屋', hint: '保固期限與報修處理' },

  { key: 'drawings', label: '圖面版本', group: '文件', hint: '只有一個現行版本，發布留痕' },
  { key: 'permits', label: '許可與法規', group: '文件', hint: '裝修許可、消防審查、竣工查驗期限' },

  { key: 'profit', label: '專案損益', group: '經營', hint: '合約＋追加 vs 發包＋材料＋雜支，隨時看得到' },

  { key: 'users', label: '帳號權限', group: '系統', hint: '可新增帳號與調整他人權限' },
  { key: 'settings', label: '系統設定', group: '系統', hint: '公司名稱、下拉選項、範本' },
  { key: 'audit', label: '操作紀錄', group: '系統', hint: '誰在什麼時候改了什麼' }
];
// 權限勾選畫面的分組順序
const MODULE_GROUPS = ['每日作業', '接案', '合約與收款', '發包', '交屋', '文件', '經營', '系統'];
const MODULE_KEYS = MODULES.map(m => m.key);

// 登入暴力嘗試防護：同一帳號連續失敗 5 次鎖 15 分鐘
const loginAttempts = new Map();
const LOGIN_MAX_FAILS = 5, LOGIN_LOCK_MS = 15 * 60 * 1000;
function loginLockedMinutes(key) {
  const a = loginAttempts.get(key);
  if (a && a.lockedUntil && a.lockedUntil > Date.now()) return Math.ceil((a.lockedUntil - Date.now()) / 60000);
  return 0;
}
function loginFailed(key) {
  if (loginAttempts.size > 10000) loginAttempts.clear();
  const a = loginAttempts.get(key) || { fails: 0 };
  a.fails++;
  if (a.fails >= LOGIN_MAX_FAILS) { a.lockedUntil = Date.now() + LOGIN_LOCK_MS; a.fails = 0; }
  loginAttempts.set(key, a);
}
function loginSucceeded(key) { loginAttempts.delete(key); }

// 真實客戶端 IP（服務跑在 nginx 後方）
function clientIp(req) {
  return (req.headers['x-real-ip'] || '').trim()
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
}

// 通用限流：僅用於未登入的攻擊面（登入）
function rateLimit({ windowMs, max, prefix = '' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = prefix + clientIp(req);
    if (hits.size > 20000) { for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }
    let e = hits.get(key);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(key, e); }
    e.count++;
    if (e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({ error: '請求過於頻繁，請稍後再試' });
    }
    next();
  };
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function signToken(payload) { return jwt.sign(payload, SECRET, { expiresIn: TOKEN_TTL }); }

// 正式站走 https（nginx 轉發時會帶 x-forwarded-proto），這種情況一律加 Secure，
// 免得有人先連 http:// 就把登入權杖用明文送出去。本機 http 開發時不加，否則登不進去。
function isHttps(req) {
  if (!req) return false;
  return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
    || (req.connection && req.connection.encrypted) || false;
}
function setAuthCookie(res, name, token, req) {
  res.setHeader('Set-Cookie',
    `${name}=${token}; HttpOnly; Path=/; Max-Age=${7 * 86400}; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`);
}
function clearAuthCookie(res, name, req) {
  res.setHeader('Set-Cookie',
    `${name}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`);
}

function parsePermissions(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(k => MODULE_KEYS.includes(k)) : [];
  } catch { return []; }
}

// 唯讀模組：看得到但不能改。存法與 permissions 相同，是它的子集合
// （沒有該模組權限時，唯讀標記沒有意義）。
const parseReadonly = parsePermissions;

// 會改到資料的 HTTP 方法。唯讀模組只擋這些，GET 一律放行
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// requireStaff() 任一登入員工；requireStaff('finance') 需具該模組權限（admin 一律通過）
function requireStaff(moduleKey) {
  return (req, res, next) => {
    const token = parseCookies(req)[STAFF_COOKIE];
    if (!token) return res.status(401).json({ error: '請先登入' });
    let payload;
    try { payload = jwt.verify(token, SECRET); } catch { return res.status(401).json({ error: '登入已過期，請重新登入' }); }
    if (payload.t !== 'staff') return res.status(401).json({ error: '請先登入' });
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.id);
    if (!user) return res.status(401).json({ error: '帳號不存在或已停用' });
    req.user = user;
    req.userModules = user.role === 'admin' ? MODULE_KEYS : parsePermissions(user.permissions);
    req.userReadonly = user.role === 'admin' ? [] : parseReadonly(user.readonly_modules);
    if (moduleKey && user.role !== 'admin') {
      if (!req.userModules.includes(moduleKey)) {
        return res.status(403).json({ error: '無此模組使用權限' });
      }
      // 唯讀：看得到但改不了。擋在這裡就不必在幾十支寫入路由各加一次判斷，
      // 日後新增的寫入端點也自動受保護。
      if (req.userReadonly.includes(moduleKey) && WRITE_METHODS.has(req.method)) {
        const label = (MODULES.find(m => m.key === moduleKey) || {}).label || moduleKey;
        return res.status(403).json({ error: `你對「${label}」只有檢視權限，不能修改` });
      }
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  requireStaff()(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
    next();
  });
}

module.exports = {
  MODULES, MODULE_KEYS, MODULE_GROUPS, STAFF_COOKIE,
  signToken, setAuthCookie, clearAuthCookie, parsePermissions, parseReadonly,
  requireStaff, requireAdmin, loginLockedMinutes, loginFailed, loginSucceeded, rateLimit, clientIp
};
