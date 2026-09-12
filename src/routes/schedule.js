// 工序排程：相依關係與延誤連動
//
// 現場真正的問題不是「畫不出甘特圖」，是「泥作晚三天，沒人記得把後面九個工序一起往後推，
// 於是木作照原訂日期進場，撲空一天，工資照付」。
// 所以這裡的重點只有一個：改一處，後面自動推，而且推了要看得出來是誰造成的。

const express = require('express');
const { db, audit, today, shiftDate, dateDiff, getSetting } = require('../db');
const { requireStaff } = require('../auth');
const { picker, insert, update, get, remove } = require('../crud');

const router = express.Router();

const pickItem = picker(['project_id', 'name', 'trade', 'vendor_id', 'planned_start', 'planned_end',
  'actual_start', 'actual_end', 'progress', 'predecessor_id', 'lag_days', 'status', 'note'],
  ['project_id', 'vendor_id', 'progress', 'predecessor_id', 'lag_days', 'seq'], ['weight']);

function listItems(projectId) {
  return db.prepare(`SELECT si.*, v.name AS vendor_name,
      (SELECT p2.name FROM schedule_items p2 WHERE p2.id = si.predecessor_id) AS predecessor_name,
      (SELECT COUNT(*) FROM material_orders m WHERE m.schedule_item_id = si.id
        AND m.status IN ('planned','ordered')
        AND (m.eta_date = '' OR m.eta_date > COALESCE(NULLIF(si.actual_start,''), si.planned_start))) AS material_risk
    FROM schedule_items si LEFT JOIN vendors v ON v.id = si.vendor_id
    WHERE si.project_id = ? ORDER BY si.seq, si.id`).all(projectId);
}

router.get('/schedule', requireStaff('schedule'), (req, res) => {
  const pid = Number(req.query.project_id) || 0;
  if (!pid) return res.status(400).json({ error: '請指定案場' });
  const rows = listItems(pid);
  const t = today();
  for (const r of rows) {
    r.days = r.planned_start && r.planned_end ? dateDiff(r.planned_start, r.planned_end) + 1 : 0;
    // 落後的定義：預計完成日已過、還沒完成。這比「進度百分比」誠實，
    // 因為百分比是人填的，日期是事實。
    r.late_days = (r.status !== 'done' && r.planned_end && r.planned_end < t)
      ? dateDiff(r.planned_end, t) : 0;
  }
  res.json(rows);
});

// 套用工序範本：名稱:工種:天數:與前一項的間隔
router.post('/schedule/apply-template', requireStaff('schedule'), (req, res) => {
  const pid = Number(req.body.project_id) || 0;
  const p = get('projects', pid);
  if (!p) return res.status(404).json({ error: '找不到此案場' });
  if (db.prepare('SELECT COUNT(*) AS n FROM schedule_items WHERE project_id = ?').get(pid).n) {
    return res.status(400).json({ error: '這個案子已經排過工序了，請直接編輯' });
  }
  let cursor = String(req.body.start_date || '').trim() || p.start_date || today();
  const tpl = getSetting('schedule_template', '').split(',').map(s => s.trim()).filter(Boolean);
  let seq = 0, prev = null;
  for (const part of tpl) {
    const [name, trade, days, lag] = part.split(':');
    if (!name) continue;
    seq++;
    const d = Math.max(1, Number(days) || 1);
    const lagDays = Number(lag) || 0;
    const start = prev ? shiftDate(cursor, lagDays) : cursor;
    const end = shiftDate(start, d - 1);
    const id = insert('schedule_items', {
      project_id: pid, seq, name, trade: trade || '', planned_start: start, planned_end: end,
      predecessor_id: prev, lag_days: lagDays, weight: d      // 天數當權重：長的工序對總進度影響本來就大
    });
    prev = id;
    cursor = shiftDate(end, 1);
  }
  // 排完就知道完工日；合約完工日還沒填的話一併帶上
  if (!p.due_date && prev) {
    const last = get('schedule_items', prev);
    db.prepare('UPDATE projects SET due_date = ? WHERE id = ?').run(last.planned_end, pid);
  }
  res.json({ created: seq });
});

router.post('/schedule', requireStaff('schedule'), (req, res) => {
  const i = pickItem(req.body || {});
  if (!i.project_id) return res.status(400).json({ error: '請指定案場' });
  if (!i.name) return res.status(400).json({ error: '請填工序名稱' });
  i.seq = (db.prepare('SELECT COALESCE(MAX(seq),0) AS v FROM schedule_items WHERE project_id = ?').get(i.project_id).v) + 1;
  if (!i.weight) i.weight = Math.max(1, dateDiff(i.planned_start, i.planned_end) + 1 || 1);
  res.json({ id: insert('schedule_items', i) });
});

// 後續工序（依 predecessor 一路往下找）。刻意用迴圈而不是遞迴 SQL：
// 資料是人建的，難免出現 A→B→A 這種環，這裡用 seen 擋住，不然會無限跑。
function successors(itemId) {
  const out = [];
  const seen = new Set([itemId]);
  let frontier = [itemId];
  const q = db.prepare('SELECT id FROM schedule_items WHERE predecessor_id = ?');
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      for (const r of q.all(id)) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r.id);
        next.push(r.id);
      }
    }
    frontier = next;
  }
  return out;
}

// 把某個工序之後的所有工序整批推移 days 天（可為負＝提前）
function cascade(itemId, days) {
  if (!days) return 0;
  const ids = successors(itemId);
  const upd = db.prepare('UPDATE schedule_items SET planned_start = ?, planned_end = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const id of ids) {
      const it = get('schedule_items', id);
      if (it.status === 'done') continue;       // 已經做完的不要動
      upd.run(it.planned_start ? shiftDate(it.planned_start, days) : '',
        it.planned_end ? shiftDate(it.planned_end, days) : '', id);
    }
  });
  tx();
  return ids.length;
}

router.put('/schedule/:id', requireStaff('schedule'), (req, res) => {
  const before = get('schedule_items', req.params.id);
  if (!before) return res.status(404).json({ error: '找不到此工序' });
  const i = pickItem(req.body || {});
  delete i.project_id;
  if (i.predecessor_id && Number(i.predecessor_id) === before.id) {
    return res.status(400).json({ error: '前置工序不能是自己' });
  }
  // 完成了就補上實際完成日與 100%，不要讓「已完成但進度 80%」這種資料存在
  if (i.status === 'done') {
    if (!i.actual_end && !before.actual_end) i.actual_end = today();
    i.progress = 100;
  }
  update('schedule_items', before.id, i);

  // 連動：預計完成日被往後改，或實際完成晚於預計 —— 後面全部跟著推
  let shifted = 0, days = 0;
  const after = get('schedule_items', before.id);
  const auto = Number(req.body.cascade) !== 0;
  if (auto) {
    if (i.planned_end !== undefined && before.planned_end && after.planned_end) {
      days = dateDiff(before.planned_end, after.planned_end);
    } else if (after.actual_end && after.planned_end && after.actual_end > after.planned_end
               && !before.actual_end) {
      days = dateDiff(after.planned_end, after.actual_end);
    }
    if (days) shifted = cascade(before.id, days);
  }
  if (shifted) {
    const p = get('projects', before.project_id);
    audit('staff', req.user.id, req.user.name, '工序延誤連動', p ? p.code : '',
      `${after.name} ${days > 0 ? '延後' : '提前'} ${Math.abs(days)} 天，後續 ${shifted} 項一起調整`);
    // 合約完工日也跟著走：業主要求的變更才展延工期（走變更單），
    // 自己造成的延誤不改合約日，但要讓畫面看得出來會逾期幾天，所以只更新最後一項的預計完成。
  }
  res.json({ ok: true, shifted, days });
});

// 直接整批推移（下雨、停工、等料）
router.post('/schedule/:id/shift', requireStaff('schedule'), (req, res) => {
  const it = get('schedule_items', req.params.id);
  if (!it) return res.status(404).json({ error: '找不到此工序' });
  const days = Math.round(Number(req.body.days) || 0);
  if (!days) return res.status(400).json({ error: '請填要推移幾天' });
  const includeSelf = Number(req.body.include_self) !== 0;
  if (includeSelf && it.status !== 'done') {
    update('schedule_items', it.id, {
      planned_start: it.planned_start ? shiftDate(it.planned_start, days) : '',
      planned_end: it.planned_end ? shiftDate(it.planned_end, days) : ''
    });
  }
  const n = cascade(it.id, days);
  const p = get('projects', it.project_id);
  audit('staff', req.user.id, req.user.name, '工進整批推移', p ? p.code : '',
    `自「${it.name}」起 ${days > 0 ? '延後' : '提前'} ${Math.abs(days)} 天，共 ${n + (includeSelf ? 1 : 0)} 項`);
  res.json({ shifted: n + (includeSelf ? 1 : 0) });
});

router.delete('/schedule/:id', requireStaff('schedule'), (req, res) => {
  const it = get('schedule_items', req.params.id);
  if (!it) return res.status(404).json({ error: '找不到此工序' });
  // 被當成前置的工序被刪掉，後面的相依關係要接回它的前置，不然鏈就斷了
  db.prepare('UPDATE schedule_items SET predecessor_id = ? WHERE predecessor_id = ?').run(it.predecessor_id, it.id);
  remove('schedule_items', it.id);
  res.json({ ok: true });
});

module.exports = router;
