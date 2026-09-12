// 工項單價庫與估價單（多版本）
const express = require('express');
const { db, audit, today, nextSerial } = require('../db');
const { requireStaff } = require('../auth');
const { picker, insert, update, get, remove, lineAmount } = require('../crud');

const router = express.Router();

// ---- 工項單價庫 ----
// 估價單、變更單、發包單都從這裡帶值。對客單價與成本單價分開存，
// 才有辦法在估價的當下就看得到這張單預估賺多少 —— 而不是做完才知道。

const pickUnit = picker(['category', 'name', 'spec', 'unit', 'material_cost', 'labor_cost',
  'material_price', 'labor_price', 'note', 'active'],
  ['material_cost', 'labor_cost', 'material_price', 'labor_price', 'active']);

router.get('/unit-prices', requireStaff(), (req, res) => {
  const { category = '', q = '', active = '' } = req.query;
  const like = `%${String(q).trim()}%`;
  res.json(db.prepare(`SELECT * FROM unit_prices
    WHERE (? = '' OR category = ?) AND (? = '' OR active = ?)
      AND (? = '' OR name LIKE ? OR spec LIKE ?)
    ORDER BY category, name`).all(category, category, active, active, String(q).trim(), like, like));
});

router.post('/unit-prices', requireStaff('unitprices'), (req, res) => {
  const u = pickUnit(req.body || {});
  if (!u.name) return res.status(400).json({ error: '請填工項名稱' });
  res.json({ id: insert('unit_prices', u) });
});

router.put('/unit-prices/:id', requireStaff('unitprices'), (req, res) => {
  if (!get('unit_prices', req.params.id)) return res.status(404).json({ error: '找不到此工項' });
  const u = pickUnit(req.body || {});
  u.updated_at = require('../db').nowStamp();
  update('unit_prices', Number(req.params.id), u);
  res.json({ ok: true });
});

router.delete('/unit-prices/:id', requireStaff('unitprices'), (req, res) => {
  remove('unit_prices', req.params.id);
  res.json({ ok: true });
});

// ---- 估價單 ----

const pickQuote = picker(['project_id', 'kind', 'quote_date', 'valid_until', 'discount', 'tax_type', 'note'],
  ['project_id', 'discount']);
const pickItem = picker(['category', 'name', 'spec', 'unit', 'note'], [], ['qty']);

// 單頭金額一律由明細重算。前端送上來的合計只當顯示用，
// 真的拿它入帳的話，只要有人在明細改了一行忘了重算，合約金額就是錯的。
function recalcQuote(quoteId) {
  const q = get('quotes', quoteId);
  if (!q) return null;
  const items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ?').all(quoteId);
  const subtotal = items.reduce((a, i) => a + i.amount, 0);
  const costTotal = items.reduce((a, i) => a + i.cost_amount, 0);
  const base = subtotal - (q.discount || 0);
  // 含稅：報價本身就是最終價，稅內含（÷1.05 只是為了開發票時知道未稅額）
  // 另加：報價是未稅價，另外加 5%
  const tax = q.tax_type === 'plus' ? Math.round(base * 0.05)
    : q.tax_type === 'included' ? Math.round(base - base / 1.05) : 0;
  const total = q.tax_type === 'plus' ? base + tax : base;
  db.prepare('UPDATE quotes SET subtotal=?, tax_amount=?, total=?, cost_total=? WHERE id=?')
    .run(subtotal, tax, total, costTotal, quoteId);
  return { subtotal, tax, total, cost_total: costTotal };
}

router.get('/quotes', requireStaff('quotes'), (req, res) => {
  const { project_id = '', status = '' } = req.query;
  res.json(db.prepare(`SELECT q.*, p.name AS project_name, p.code AS project_code, u.name AS created_by_name
    FROM quotes q JOIN projects p ON p.id = q.project_id LEFT JOIN users u ON u.id = q.created_by
    WHERE (? = '' OR q.project_id = ?) AND (? = '' OR q.status = ?)
    ORDER BY q.id DESC`).all(project_id, project_id, status, status));
});

router.get('/quotes/:id', requireStaff('quotes'), (req, res) => {
  const q = db.prepare(`SELECT q.*, p.name AS project_name, p.code AS project_code, p.address, p.area_ping,
      c.name AS customer_name FROM quotes q JOIN projects p ON p.id = q.project_id
      LEFT JOIN customers c ON c.id = p.customer_id WHERE q.id = ?`).get(Number(req.params.id));
  if (!q) return res.status(404).json({ error: '找不到此估價單' });
  q.items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY seq, id').all(q.id);
  res.json(q);
});

router.post('/quotes', requireStaff('quotes'), (req, res) => {
  const q = pickQuote(req.body || {});
  if (!q.project_id) return res.status(400).json({ error: '請指定案場' });
  q.quote_no = nextSerial('quotes', 'quote_no', 'QT');
  q.version = (db.prepare('SELECT COALESCE(MAX(version),0) AS v FROM quotes WHERE project_id = ?').get(q.project_id).v) + 1;
  if (!q.quote_date) q.quote_date = today();
  q.created_by = req.user.id;
  const id = insert('quotes', q);
  // 從舊版複製明細：第七版跟第六版通常只差兩行，重打一次是浪費也是出錯的來源
  const from = Number(req.body.copy_from || 0);
  if (from) {
    const src = db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY seq, id').all(from);
    const ins = db.prepare(`INSERT INTO quote_items (quote_id, seq, category, name, spec, unit, qty, unit_price, unit_cost, amount, cost_amount, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const i of src) ins.run(id, i.seq, i.category, i.name, i.spec, i.unit, i.qty, i.unit_price, i.unit_cost, i.amount, i.cost_amount, i.note);
    recalcQuote(id);
  }
  audit('staff', req.user.id, req.user.name, '建立估價單', q.quote_no, `v${q.version}`);
  res.json({ id, quote_no: q.quote_no, version: q.version });
});

router.put('/quotes/:id', requireStaff('quotes'), (req, res) => {
  const q = get('quotes', req.params.id);
  if (!q) return res.status(404).json({ error: '找不到此估價單' });
  if (q.status === 'accepted') return res.status(400).json({ error: '已成交的估價單不能再改；請開新版本' });
  const body = pickQuote(req.body || {});
  delete body.project_id;
  update('quotes', q.id, body);
  res.json(recalcQuote(q.id));
});

// 狀態：送出／成交／未成交。成交時把同案其他版本標成「已被取代」，
// 並依成交金額自動開一張合約（沒有的話），省掉一次重打。
router.post('/quotes/:id/status', requireStaff('quotes'), (req, res) => {
  const q = get('quotes', req.params.id);
  if (!q) return res.status(404).json({ error: '找不到此估價單' });
  const status = String(req.body.status || '').trim();
  if (!['draft', 'sent', 'accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '狀態不正確' });
  }
  recalcQuote(q.id);
  const fresh = get('quotes', q.id);
  db.prepare("UPDATE quotes SET status = ?, decided_at = ? WHERE id = ?")
    .run(status, ['accepted', 'rejected'].includes(status) ? today() : '', q.id);

  if (status === 'accepted') {
    db.prepare(`UPDATE quotes SET status = 'superseded' WHERE project_id = ? AND id <> ?
                AND status IN ('draft','sent')`).run(q.project_id, q.id);
    const has = db.prepare('SELECT COUNT(*) AS n FROM contracts WHERE quote_id = ?').get(q.id).n;
    if (!has && Number(req.body.make_contract) !== 0) {
      insert('contracts', {
        project_id: q.project_id,
        contract_no: nextSerial('contracts', 'contract_no', 'CT'),
        kind: q.kind, quote_id: q.id, sign_date: today(), amount: fresh.total, status: 'active',
        note: `由估價單 ${q.quote_no} v${q.version} 成立`
      });
      const p = get('projects', q.project_id);
      if (p && ['lead', 'design'].includes(p.status)) {
        db.prepare("UPDATE projects SET status = 'contracted', sign_date = COALESCE(NULLIF(sign_date,''), ?) WHERE id = ?")
          .run(today(), p.id);
      }
    }
  }
  audit('staff', req.user.id, req.user.name, '估價單狀態', q.quote_no, status);
  res.json({ ok: true });
});

router.delete('/quotes/:id', requireStaff('quotes'), (req, res) => {
  const q = get('quotes', req.params.id);
  if (!q) return res.status(404).json({ error: '找不到此估價單' });
  if (q.status === 'accepted') return res.status(400).json({ error: '已成交的估價單不能刪除' });
  remove('quotes', q.id);
  res.json({ ok: true });
});

// ---- 估價明細 ----

function itemPayload(body) {
  const i = pickItem(body);
  if (!i.name) throw new Error('請填工項名稱');
  const qty = Number(body.qty) || 0;
  const price = Math.round(Number(body.unit_price) || 0);
  const cost = Math.round(Number(body.unit_cost) || 0);
  i.qty = qty;
  i.unit_price = price;
  i.unit_cost = cost;
  i.amount = lineAmount(qty, price);
  i.cost_amount = lineAmount(qty, cost);
  return i;
}

router.post('/quotes/:id/items', requireStaff('quotes'), (req, res) => {
  const q = get('quotes', req.params.id);
  if (!q) return res.status(404).json({ error: '找不到此估價單' });
  if (q.status === 'accepted') return res.status(400).json({ error: '已成交的估價單不能再改明細' });
  let i;
  try { i = itemPayload(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  i.quote_id = q.id;
  i.seq = (db.prepare('SELECT COALESCE(MAX(seq),0) AS v FROM quote_items WHERE quote_id = ?').get(q.id).v) + 1;
  const id = insert('quote_items', i);
  res.json({ id, ...recalcQuote(q.id) });
});

router.put('/quote-items/:id', requireStaff('quotes'), (req, res) => {
  const row = get('quote_items', req.params.id);
  if (!row) return res.status(404).json({ error: '找不到此明細' });
  const q = get('quotes', row.quote_id);
  if (q.status === 'accepted') return res.status(400).json({ error: '已成交的估價單不能再改明細' });
  let i;
  try { i = itemPayload(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  update('quote_items', row.id, i);
  res.json(recalcQuote(row.quote_id));
});

router.delete('/quote-items/:id', requireStaff('quotes'), (req, res) => {
  const row = get('quote_items', req.params.id);
  if (!row) return res.status(404).json({ error: '找不到此明細' });
  remove('quote_items', row.id);
  res.json(recalcQuote(row.quote_id));
});

module.exports = router;
module.exports.recalcQuote = recalcQuote;
