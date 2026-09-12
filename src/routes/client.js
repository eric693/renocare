// 業主端：憑一條連結進來，不需要帳號。
//
// 為什麼要做這一塊：裝修糾紛有一半來自資訊不對稱 —— 業主看不到進度就一直打電話問，
// 追加單用 LINE 講完就沒下文。把「看得到」與「線上簽認」放在同一頁，
// 進度自己看、追加當場按，兩件最耗人力的事一起解決。
//
// 安全性：token 是 32 位十六進位亂數，猜不到；可以隨時停用重發。
// 這裡只給看得懂也該看的東西 —— 不給成本、不給發包金額、不給內部照片。

const express = require('express');
const { db, audit, today, nowStamp } = require('../db');
const { projectMoney, projectProgress } = require('../finance');
const { rateLimit, clientIp } = require('../auth');
const { insert, get } = require('../crud');
const { nextSerial } = require('../db');

const router = express.Router();

// 猜 token 的成本要夠高：同一個 IP 每分鐘 60 次就擋
router.use(rateLimit({ windowMs: 60 * 1000, max: 60, prefix: 'client:' }));

function projectByToken(token) {
  if (!token || String(token).length < 16) return null;
  return db.prepare("SELECT * FROM projects WHERE client_token = ? AND client_token <> ''").get(String(token));
}

function requireToken(req, res, next) {
  const p = projectByToken(req.params.token);
  if (!p) return res.status(404).json({ error: '連結無效或已停用，請聯絡您的設計師' });
  req.project = p;
  next();
}

router.get('/:token', requireToken, (req, res) => {
  const p = req.project;
  const m = projectMoney(p.id);
  const company = db.prepare("SELECT value FROM settings WHERE key = 'company_name'").get();
  const staff = db.prepare('SELECT name, phone FROM users WHERE id = ?');

  res.json({
    company: company ? company.value : '',
    project: {
      code: p.code, name: p.name, address: p.address, site_type: p.site_type,
      start_date: p.start_date, due_date: p.due_date, handover_date: p.handover_date,
      status: p.status, progress: projectProgress(p.id)
    },
    contact: {
      designer: p.designer_id ? staff.get(p.designer_id) : null,
      supervisor: p.supervisor_id ? staff.get(p.supervisor_id) : null
    },
    // 給業主看的錢：合約總價、已簽認追加、已付、還要付多少。成本一律不給。
    money: {
      contract_amount: m.contract_amount,
      change_signed: m.change_signed,
      contract_total: m.contract_total,
      paid: m.received,
      outstanding: m.contract_total - m.received
    },
    milestones: m.milestones.map(x => ({
      name: x.name, amount: x.amount, received: x.received,
      status: x.status, invoiced_date: x.invoiced_date, due_date: x.due_date
    })),
    schedule: db.prepare(`SELECT name, trade, planned_start, planned_end, actual_start, actual_end, progress, status
      FROM schedule_items WHERE project_id = ? ORDER BY seq, id`).all(p.id),
    changes: db.prepare(`SELECT id, no, title, reason, detail, amount, days_delay, status, sent_at, signed_at, signed_name
      FROM change_orders WHERE project_id = ? AND status IN ('sent','signed','rejected')
      ORDER BY id DESC`).all(p.id),
    photos: db.prepare(`SELECT url, caption, phase, taken_date FROM photos
      WHERE project_id = ? AND client_visible = 1 ORDER BY taken_date DESC, id DESC LIMIT 120`).all(p.id),
    logs: db.prepare(`SELECT date, weather, trades, progress_note FROM site_logs
      WHERE project_id = ? ORDER BY date DESC LIMIT 20`).all(p.id),
    drawings: db.prepare(`SELECT name, category, version, url, released_at FROM drawings
      WHERE project_id = ? AND client_visible = 1 AND is_current = 1 ORDER BY category, name`).all(p.id),
    defects: db.prepare(`SELECT no, location, item, description, status, found_date, fixed_date, verified_date
      FROM defects WHERE project_id = ? AND source IN ('client','acceptance','warranty')
      ORDER BY id DESC LIMIT 100`).all(p.id)
  });
});

// 單張變更單（簽認前要看得到逐項明細，不能只有一個總額）
router.get('/:token/changes/:id', requireToken, (req, res) => {
  const c = db.prepare(`SELECT id, no, title, reason, detail, amount, days_delay, status, sent_at, signed_at, signed_name
    FROM change_orders WHERE id = ? AND project_id = ?`).get(Number(req.params.id), req.project.id);
  if (!c) return res.status(404).json({ error: '找不到此變更單' });
  c.items = db.prepare(`SELECT kind, category, name, spec, unit, qty, unit_price, amount
    FROM change_items WHERE change_id = ? ORDER BY id`).all(c.id);
  res.json(c);
});

// 線上簽認／否決。這支是整套系統最關鍵的一個動作：
// 按下去的那一刻，這筆錢才正式進入合約總價。所以簽認人、時間、IP 全部記下來。
router.post('/:token/changes/:id/sign', requireToken, (req, res) => {
  const c = db.prepare('SELECT * FROM change_orders WHERE id = ? AND project_id = ?')
    .get(Number(req.params.id), req.project.id);
  if (!c) return res.status(404).json({ error: '找不到此變更單' });
  if (c.status !== 'sent') {
    return res.status(400).json({ error: c.status === 'signed' ? '這張單已經簽認過了' : '這張單目前不需要您簽認' });
  }
  const name = String((req.body || {}).signed_name || '').trim();
  if (!name) return res.status(400).json({ error: '請填寫您的姓名以完成確認' });
  const agree = Number((req.body || {}).agree);

  if (agree === 0) {
    db.prepare(`UPDATE change_orders SET status = 'rejected', signed_at = ?, signed_name = ?,
                sign_ip = ?, sign_channel = 'client' WHERE id = ?`)
      .run(nowStamp(), name, clientIp(req), c.id);
    audit('client', null, name, '業主否決變更單', c.no, `${req.project.code} ${c.title}`);
    return res.json({ ok: true, status: 'rejected' });
  }

  db.prepare(`UPDATE change_orders SET status = 'signed', signed_at = ?, signed_name = ?,
              sign_ip = ?, sign_channel = 'client' WHERE id = ?`)
    .run(nowStamp(), name, clientIp(req), c.id);

  // 展延工期：業主自己要求的變更造成的延後，合約完工日跟著往後，
  // 日後不會被拿來當逾期違約的理由。
  if (c.days_delay > 0 && req.project.due_date) {
    const nd = require('../db').shiftDate(req.project.due_date, c.days_delay);
    db.prepare('UPDATE projects SET due_date = ? WHERE id = ?').run(nd, req.project.id);
  }
  audit('client', null, name, '業主線上簽認變更單', c.no,
    `${req.project.code} ${c.title} ${c.amount} 元`);
  res.json({ ok: true, status: 'signed' });
});

// 業主回報缺失（施工中或保固期都用得到）
router.post('/:token/defects', requireToken, (req, res) => {
  const b = req.body || {};
  const item = String(b.item || '').trim();
  if (!item) return res.status(400).json({ error: '請填寫要反映的項目' });
  const p = req.project;
  const id = insert('defects', {
    project_id: p.id, no: nextSerial('defects', 'no', 'DF'),
    source: p.status === 'warranty' ? 'warranty' : 'client',
    location: String(b.location || '').trim(),
    item, description: String(b.description || '').trim(),
    owner_id: p.supervisor_id || p.designer_id, found_date: today(), status: 'open'
  });
  audit('client', null, String(b.name || '業主'), '業主回報缺失', p.code, item);
  res.json({ id });
});

module.exports = router;
