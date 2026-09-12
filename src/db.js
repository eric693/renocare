require('./env');

// 時區固定台北：主機時區是 UTC，若不指定，SQLite 的 datetime('now','localtime')
// 與 Node 的 new Date() 都會慢 8 小時 —— 凌晨 00:00~08:00 建立的日報、估驗、
// 收款會被記成前一天，工進與月結算全部差一天。
// 這行必須在 require('better-sqlite3') 之前：SQLite 的 localtime 是啟動時讀 TZ 決定的。
process.env.TZ = process.env.TZ || 'Asia/Taipei';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'renocare.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

// 既有資料庫的欄位遷移（日後新增欄位寫在這裡，新安裝直接走 schema.sql）
function ensureColumns(table, cols) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  for (const [name, ddl] of Object.entries(cols)) {
    if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

// 缺失求償在哪一期估驗被扣掉。分開一欄而不是寫在備註裡，
// 是因為「不能扣第二次」這件事要靠它擋住。
ensureColumns('defects', { deducted_valuation_id: 'INTEGER' });

const UI_TEXT_KEYS = ['ui_login_title', 'ui_login_sub', 'ui_demo_hint'];

// 系統簽章密鑰（首次啟動自動產生）
const secretFile = path.join(DATA_DIR, '.secret');
if (!fs.existsSync(secretFile)) {
  fs.writeFileSync(secretFile, require('crypto').randomBytes(48).toString('hex'), { mode: 0o600 });
}
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// 下拉選項的預設值。只在「這個 key 從來沒被寫過」時塞一次，
// 使用者在設定頁刪掉的項目不會被硬塞回來。
const DEFAULT_LISTS = {
  company_name: '宅匠室內裝修',
  trades: '拆除,泥作,水電,木作,油漆,系統櫃,廚具,衛浴,空調,地板,玻璃鋁窗,窗簾,清潔,統包',
  site_types: '新成屋,中古屋翻修,老屋全室,商業空間,辦公室,店面,毛胚屋',
  styles: '現代簡約,北歐,無印,日式,輕奢,工業風,鄉村,古典',
  expense_categories: '規費,機具租賃,垃圾清運,運費,保險,行政雜支,其他',
  payment_methods: '匯款,現金,支票,刷卡',
  permit_kinds: '室內裝修審查許可,消防圖說審查,竣工查驗,使用執照變更,大樓施工申請,拆除申報',
  customer_sources: '口碑介紹,官網,Instagram,Facebook,建商合作,舊客回流,房仲介紹',
  // 請款節點範本：套用到新案時一次展開成 billing_milestones
  milestone_template: '訂金:30,開工款:30,木作進場:20,完工驗收:15,交屋尾款:5',
  // 工序範本：名稱:工種:天數:與前一項的間隔天數
  schedule_template: '保護工程:清潔:2:0,拆除:拆除:3:0,泥作:泥作:10:0,水電配管:水電:8:0,鋁窗玻璃:玻璃鋁窗:3:0,木作:木作:18:0,油漆:油漆:12:2,系統櫃安裝:系統櫃:4:0,廚具衛浴:廚具:4:0,地板:地板:3:0,空調:空調:3:0,細清:清潔:2:0,驗收點交:統包:2:0',
  default_retention_pct: '10',
  default_warranty_pct: '5',
  default_warranty_months: '12',
  // 逾期／到期的提醒天數
  alert_days: '7'
};
for (const [k, v] of Object.entries(DEFAULT_LISTS)) {
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k) === undefined) setSetting(k, v);
}

function listSetting(key) {
  return getSetting(key, '').split(',').map(s => s.trim()).filter(Boolean);
}

function deleteUpload(webPath) {
  if (!webPath || !String(webPath).startsWith('/uploads/')) return;
  fs.unlink(path.join(__dirname, '..', 'uploads', path.basename(webPath)), () => {});
}

function audit(actorType, actorId, actorName, action, target = '', detail = '') {
  db.prepare('INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, target, detail) VALUES (?,?,?,?,?,?)')
    .run(actorType, actorId, actorName, action, target, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

// ---- 日期工具（伺服器時區可能是 UTC，一律用本地格式化後的字串比對）----
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function nowStamp() { return `${today()} ${nowTime()}`; }
function thisMonth() { return today().slice(0, 7); }

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d)) return '';
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d)) return '';
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);   // 1/31 + 1 月要落在 2/28，不是 3/3
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 兩個日期相差幾天（b - a）
function dateDiff(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
}

// 產生流水號：前綴 + 年月 + 當月序號，例：PJ-202609-004
function nextSerial(table, column, prefix) {
  const ym = today().slice(0, 7).replace('-', '');
  const like = `${prefix}-${ym}-%`;
  const row = db.prepare(`SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`).get(like);
  const n = row ? Number(String(row.v).split('-').pop()) + 1 : 1;
  return `${prefix}-${ym}-${String(n).padStart(3, '0')}`;
}

function randomToken() { return require('crypto').randomBytes(16).toString('hex'); }

module.exports = {
  db, SECRET, UI_TEXT_KEYS, DEFAULT_LISTS, ensureColumns,
  getSetting, setSetting, listSetting, audit, deleteUpload,
  today, nowTime, nowStamp, thisMonth, shiftDate, addMonths, dateDiff, nextSerial, randomToken
};
