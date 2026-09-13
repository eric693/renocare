-- RenoCare 宅匠：室內設計／裝修工程營運管理系統
--
-- 設計主軸是「錢在哪裡漏掉、時間在哪裡卡住」，不是把紙本搬上電腦：
--   1. 追加減帳（change_orders）要有簽認鏈，沒簽認不算進合約總價 —— 結算時吵不起來。
--   2. 請款節點（billing_milestones）綁在工進上，到了節點系統自己叫，不靠人記。
--   3. 發包（subcontracts）的估驗、保留款、保固金分開記，付出去的錢跟收回來的錢對得上。
--   4. 工序（schedule_items）有前後相依，一個延誤自動推後面，不是每次重畫甘特圖。
--   5. 專案損益（由合約＋簽認變更 vs 發包＋材料＋雜支）隨時看得到，不用等完工才知道賠。

-- ---- 帳號與系統 ----

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'staff',           -- admin / staff
  permissions TEXT NOT NULL DEFAULT '[]',
  readonly_modules TEXT NOT NULL DEFAULT '[]',
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL DEFAULT 'staff',      -- staff / client（業主端簽認）
  actor_id INTEGER,
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ---- 客戶與案場 ----

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  line_id TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_id TEXT NOT NULL DEFAULT '',               -- 統編（商空客戶要開發票）
  source TEXT NOT NULL DEFAULT '',               -- 來源：口碑介紹／官網／IG／建商合作…
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                     -- PJ-202609-001
  name TEXT NOT NULL,                            -- 案名（例：內湖陳宅）
  customer_id INTEGER REFERENCES customers(id),
  address TEXT NOT NULL DEFAULT '',
  site_type TEXT NOT NULL DEFAULT '',            -- 新成屋／中古屋翻修／老屋全室／商空／辦公室
  area_ping REAL NOT NULL DEFAULT 0,             -- 室內坪數
  style TEXT NOT NULL DEFAULT '',
  designer_id INTEGER REFERENCES users(id),      -- 設計師
  supervisor_id INTEGER REFERENCES users(id),    -- 工務／監工
  status TEXT NOT NULL DEFAULT 'lead',           -- lead 洽談 / design 設計中 / contracted 已簽約 / construction 施工中 / acceptance 驗收中 / warranty 保固中 / closed 結案 / lost 未成交
  sign_date TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',           -- 開工
  due_date TEXT NOT NULL DEFAULT '',             -- 合約完工日
  actual_end_date TEXT NOT NULL DEFAULT '',      -- 實際完工
  handover_date TEXT NOT NULL DEFAULT '',        -- 交屋日（保固起算）
  warranty_months INTEGER NOT NULL DEFAULT 12,
  client_token TEXT NOT NULL DEFAULT '',         -- 業主端連結用；空＝尚未開通
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_token ON projects(client_token);

-- ---- 工項單價庫（開估價單、發包單都從這裡帶）----

CREATE TABLE IF NOT EXISTS unit_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT '',             -- 拆除／泥作／水電／木作／油漆／系統櫃／廚具衛浴／空調／地板／玻璃／清潔
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '式',
  material_cost INTEGER NOT NULL DEFAULT 0,      -- 材料成本（發包／估成本用）
  labor_cost INTEGER NOT NULL DEFAULT 0,         -- 工資成本
  material_price INTEGER NOT NULL DEFAULT 0,     -- 對客報價：材料
  labor_price INTEGER NOT NULL DEFAULT 0,        -- 對客報價：工資
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_unit_prices_cat ON unit_prices(category);

-- ---- 估價單（多版本）----
-- 客戶會改到第七版。版本各自留存，超過的標 superseded，日後爭議翻得出「當時報的是哪一版」。

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  quote_no TEXT NOT NULL DEFAULT '',             -- QT-202609-001
  version INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'build',            -- design 設計費／build 工程款
  status TEXT NOT NULL DEFAULT 'draft',          -- draft 草稿／sent 已送出／accepted 已成交／rejected 未成交／superseded 已被新版取代
  quote_date TEXT NOT NULL DEFAULT '',
  valid_until TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  tax_type TEXT NOT NULL DEFAULT 'included',     -- included 含稅／plus 另加 5%／none 免稅
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  cost_total INTEGER NOT NULL DEFAULT 0,         -- 依成本欄位估的成本合計（毛利預估用）
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  decided_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_quotes_project ON quotes(project_id);

CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '式',
  qty REAL NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL DEFAULT 0,         -- 對客單價
  unit_cost INTEGER NOT NULL DEFAULT 0,          -- 估的成本單價
  amount INTEGER NOT NULL DEFAULT 0,
  cost_amount INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);

-- ---- 合約 ----

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_no TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'build',            -- design 設計監造約／build 工程約
  quote_id INTEGER REFERENCES quotes(id),
  sign_date TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,             -- 原始合約金額（含稅）
  work_days INTEGER NOT NULL DEFAULT 0,          -- 約定工期（日曆天）
  penalty_per_day INTEGER NOT NULL DEFAULT 0,    -- 逾期違約金／日
  status TEXT NOT NULL DEFAULT 'active',         -- active／closed／void
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);

-- ---- 追加減帳（變更單）----
-- 這張表是整套系統的核心。業界最常見的呆帳就是「現場口頭答應、結算才提出來」：
-- 所以金額只有在 status='signed'（業主確認）之後才會被算進合約總價與應收，
-- 其餘狀態一律只出現在「待簽認」清單上催辦。

CREATE TABLE IF NOT EXISTS change_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  no TEXT NOT NULL DEFAULT '',                   -- CO-202609-001
  title TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',               -- client 業主要求／site 現場條件／design 設計調整／law 法規要求
  detail TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,             -- 淨額（追加為正、減帳為負）
  days_delay INTEGER NOT NULL DEFAULT 0,         -- 展延工期（天）
  status TEXT NOT NULL DEFAULT 'draft',          -- draft 草稿／sent 待業主簽認／signed 已簽認／rejected 業主否決／void 作廢
  sent_at TEXT NOT NULL DEFAULT '',
  signed_at TEXT NOT NULL DEFAULT '',
  signed_name TEXT NOT NULL DEFAULT '',          -- 簽認人（業主端輸入姓名）
  sign_ip TEXT NOT NULL DEFAULT '',              -- 簽認來源 IP（爭議時的佐證）
  sign_channel TEXT NOT NULL DEFAULT '',         -- client 業主端線上簽／paper 紙本回簽（人工登錄）
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_changes_project ON change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_changes_status ON change_orders(status);

CREATE TABLE IF NOT EXISTS change_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id INTEGER NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'add',              -- add 追加／deduct 減帳
  category TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '式',
  qty REAL NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,             -- 減帳存負數
  cost_amount INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_change_items_change ON change_items(change_id);

-- ---- 請款節點與收款 ----

CREATE TABLE IF NOT EXISTS billing_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,                            -- 訂金／開工款／水電進場／木作進場／油漆完成／驗收尾款
  basis TEXT NOT NULL DEFAULT 'percent',         -- percent 依合約比例／amount 固定金額
  percent REAL NOT NULL DEFAULT 0,
  fixed_amount INTEGER NOT NULL DEFAULT 0,
  trigger_item_id INTEGER,                       -- 綁哪個工序（該工序開工／完成就該請款）
  trigger_on TEXT NOT NULL DEFAULT 'start',      -- start 該工序開工／end 該工序完成
  planned_date TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',             -- 約定收款期限（逾期催收看這欄）
  invoiced_date TEXT NOT NULL DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',        -- pending 未到／ready 可請款／invoiced 已請款／paid 已收足／void 取消
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON billing_milestones(project_id);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id INTEGER REFERENCES billing_milestones(id) ON DELETE SET NULL,
  date TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT '匯款',
  invoice_no TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_receipts_project ON receipts(project_id);

-- ---- 工班／供應商與發包 ----

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'sub',              -- sub 工班／supplier 材料商／both
  trade TEXT NOT NULL DEFAULT '',                -- 工種
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  tax_id TEXT NOT NULL DEFAULT '',
  bank_info TEXT NOT NULL DEFAULT '',
  rating INTEGER NOT NULL DEFAULT 0,             -- 1-5
  liability_expiry TEXT NOT NULL DEFAULT '',     -- 營繕承包／意外責任險到期日（沒保出事是公司扛）
  labor_insured INTEGER NOT NULL DEFAULT 0,      -- 是否有投保勞保／職災
  payee_type TEXT NOT NULL DEFAULT 'company',    -- company 公司行號（開發票）／individual 個人（付款要代扣稅與補充保費）
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS subcontracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vendor_id INTEGER REFERENCES vendors(id),
  no TEXT NOT NULL DEFAULT '',                   -- SC-202609-001
  trade TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,             -- 發包總價
  retention_pct REAL NOT NULL DEFAULT 10,        -- 估驗保留款％（完工驗收後退）
  warranty_pct REAL NOT NULL DEFAULT 5,          -- 保固保證金％（保固期滿退）
  sign_date TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',          -- draft／signed 已發包／working 施工中／done 完工／settled 結清
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sub_project ON subcontracts(project_id);

CREATE TABLE IF NOT EXISTS sub_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcontract_id INTEGER NOT NULL REFERENCES subcontracts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '式',
  qty REAL NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);

-- 估驗計價：填「累計完成％」，本期金額由系統減去先前已估驗的累計，
-- 這樣工班自己算錯或重複請款都對不上，而且累計永遠不會超過發包總價。
CREATE TABLE IF NOT EXISTS valuations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcontract_id INTEGER NOT NULL REFERENCES subcontracts(id) ON DELETE CASCADE,
  period TEXT NOT NULL DEFAULT '',               -- 期別（2026-09 或 第3期）
  date TEXT NOT NULL DEFAULT '',
  cum_progress REAL NOT NULL DEFAULT 0,          -- 累計完成％
  cum_amount INTEGER NOT NULL DEFAULT 0,         -- 累計應計 = 發包總價 × 累計％
  gross_amount INTEGER NOT NULL DEFAULT 0,       -- 本期估驗（累計應計 − 前期累計）
  retention INTEGER NOT NULL DEFAULT 0,          -- 本期扣保留款
  warranty_hold INTEGER NOT NULL DEFAULT 0,      -- 本期扣保固金
  deduction INTEGER NOT NULL DEFAULT 0,          -- 其他扣款（罰款、代購材料、清潔費）
  deduct_note TEXT NOT NULL DEFAULT '',
  net_amount INTEGER NOT NULL DEFAULT 0,         -- 應付工班（扣完保留款、保固金、其他扣款）
  tax_withheld INTEGER NOT NULL DEFAULT 0,       -- 代扣所得稅（個人工班）
  nhi_withheld INTEGER NOT NULL DEFAULT 0,       -- 代扣二代健保補充保費（個人工班）
  pay_amount INTEGER NOT NULL DEFAULT 0,         -- 實際匯款 = 應付 − 代扣
  status TEXT NOT NULL DEFAULT 'draft',          -- draft／confirmed 已確認／paid 已付款
  paid_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_valuations_sub ON valuations(subcontract_id);

-- 保留款／保固金的退還
CREATE TABLE IF NOT EXISTS retention_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcontract_id INTEGER NOT NULL REFERENCES subcontracts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'retention',        -- retention 保留款／warranty 保固金
  date TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  tax_withheld INTEGER NOT NULL DEFAULT 0,
  nhi_withheld INTEGER NOT NULL DEFAULT 0,
  pay_amount INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);

-- ---- 工序排程 ----
-- predecessor_id + lag_days 讓延誤可以往後推：泥作晚三天，後面的水電木作油漆一起晚三天，
-- 而不是每次都要重畫一張甘特圖（然後忘記通知某一班）。

CREATE TABLE IF NOT EXISTS schedule_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  trade TEXT NOT NULL DEFAULT '',
  vendor_id INTEGER REFERENCES vendors(id),
  planned_start TEXT NOT NULL DEFAULT '',
  planned_end TEXT NOT NULL DEFAULT '',
  actual_start TEXT NOT NULL DEFAULT '',
  actual_end TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0,           -- 0-100
  predecessor_id INTEGER,                        -- 前置工序（完成後才能開始）
  lag_days INTEGER NOT NULL DEFAULT 0,           -- 與前置工序的間隔天數（養護期）
  weight REAL NOT NULL DEFAULT 1,                -- 佔整案工進的權重（算總進度用）
  status TEXT NOT NULL DEFAULT 'pending',        -- pending 未開工／working 施工中／done 完成／hold 暫停
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_schedule_project ON schedule_items(project_id);

-- ---- 工地日報與照片 ----

CREATE TABLE IF NOT EXISTS site_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL DEFAULT '',
  weather TEXT NOT NULL DEFAULT '',
  workers INTEGER NOT NULL DEFAULT 0,
  trades TEXT NOT NULL DEFAULT '',               -- 今日進場工種（逗號分隔）
  progress_note TEXT NOT NULL DEFAULT '',
  issue_note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_logs_project ON site_logs(project_id, date);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT 'during',          -- before 施工前／during 施工中／after 完工／defect 缺失／hidden 隱蔽（封板前必拍）
  taken_date TEXT NOT NULL DEFAULT '',
  schedule_item_id INTEGER REFERENCES schedule_items(id) ON DELETE SET NULL,
  log_id INTEGER REFERENCES site_logs(id) ON DELETE SET NULL,
  defect_id INTEGER,
  client_visible INTEGER NOT NULL DEFAULT 1,     -- 業主端看不看得到（內部佐證照可關閉）
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id, taken_date);

-- ---- 材料訂料 ----
-- 磁磚、廚具、系統櫃的交期才是真正卡住工進的東西，所以訂料掛在工序上，
-- 到貨日晚於該工序預計開工日就是紅字。

CREATE TABLE IF NOT EXISTS material_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vendor_id INTEGER REFERENCES vendors(id),
  schedule_item_id INTEGER REFERENCES schedule_items(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT '式',
  unit_price INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  need_date TEXT NOT NULL DEFAULT '',            -- 現場需要日（通常＝對應工序開工日）
  order_date TEXT NOT NULL DEFAULT '',
  eta_date TEXT NOT NULL DEFAULT '',             -- 廠商回覆交期
  arrived_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',        -- planned 待下單／ordered 已下單／arrived 已到貨／installed 已安裝／cancelled 取消
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_materials_project ON material_orders(project_id);

-- ---- 缺失改善（點交／驗收／保固報修共用）----

CREATE TABLE IF NOT EXISTS defects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  no TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'self',           -- self 自主檢查／client 業主提出／acceptance 驗收點交／warranty 保固報修
  location TEXT NOT NULL DEFAULT '',             -- 主臥／客廳／廚房
  item TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  vendor_id INTEGER REFERENCES vendors(id),      -- 責任工班（決定誰去修、扣誰的錢）
  owner_id INTEGER REFERENCES users(id),         -- 追蹤人
  severity TEXT NOT NULL DEFAULT 'normal',       -- low／normal／high（影響交屋）
  found_date TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  fixed_date TEXT NOT NULL DEFAULT '',
  verified_date TEXT NOT NULL DEFAULT '',
  cost INTEGER NOT NULL DEFAULT 0,               -- 改善成本（要扣工班就填）
  charge_vendor INTEGER NOT NULL DEFAULT 0,      -- 是否向工班求償（估驗時自動帶入扣款）
  deducted_valuation_id INTEGER,                 -- 已經在哪一期估驗扣過了（避免同一筆扣兩次）
  status TEXT NOT NULL DEFAULT 'open',           -- open 待改善／fixing 改善中／fixed 已完成待複驗／verified 複驗通過／void 免辦
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_defects_project ON defects(project_id, status);

-- ---- 圖面版本 ----
-- 工班拿舊版圖施工是最貴的錯誤之一，所以每張圖只有一個 is_current=1，
-- 發布時間與發給誰都留紀錄。

CREATE TABLE IF NOT EXISTS drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                            -- 平面配置圖／水電圖／天花圖／立面圖
  category TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT 'v1',
  url TEXT NOT NULL DEFAULT '',
  is_current INTEGER NOT NULL DEFAULT 1,
  released_at TEXT NOT NULL DEFAULT '',
  released_to TEXT NOT NULL DEFAULT '',          -- 發給哪些工班
  client_visible INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_drawings_project ON drawings(project_id);

-- ---- 法規／許可期限 ----
-- 室內裝修許可、消防審查、竣工查驗：沒送或逾期，輕則停工重則罰鍰。

CREATE TABLE IF NOT EXISTS permits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                            -- 室內裝修審查許可／消防圖說審查／竣工查驗／使用執照變更／大樓施工申請
  agency TEXT NOT NULL DEFAULT '',
  doc_no TEXT NOT NULL DEFAULT '',
  applied_date TEXT NOT NULL DEFAULT '',
  approved_date TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',          -- 許可有效期限（逾期要展延）
  owner_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'todo',           -- todo 待送件／applied 審查中／approved 已核准／rejected 補正／na 不適用
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_permits_project ON permits(project_id);

-- ---- 專案雜支（不走發包的成本：規費、吊車、垃圾清運、飲料）----

CREATE TABLE IF NOT EXISTS project_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '其他',         -- 規費／機具租賃／垃圾清運／運費／保險／雜支
  item TEXT NOT NULL DEFAULT '',
  vendor_id INTEGER REFERENCES vendors(id),
  amount INTEGER NOT NULL DEFAULT 0,
  invoice_no TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pexp_project ON project_expenses(project_id);

-- ---- 保固 ----

CREATE TABLE IF NOT EXISTS warranties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item TEXT NOT NULL,                            -- 防水／木作／系統櫃／衛浴設備
  vendor_id INTEGER REFERENCES vendors(id),
  start_date TEXT NOT NULL DEFAULT '',
  months INTEGER NOT NULL DEFAULT 12,
  end_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_warranties_project ON warranties(project_id);

-- ---- 任務 ----

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  assignee_id INTEGER REFERENCES users(id),
  due_date TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'todo',           -- todo／doing／done／cancelled
  source TEXT NOT NULL DEFAULT 'manual',         -- manual 人工／auto 系統自動產生（請款節點、許可到期…）
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,
  done_at TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status);
