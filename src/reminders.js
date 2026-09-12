// 自動提醒：把「會被忘記、忘記就會虧錢」的事變成待辦。
//
// 裝修業真正的損失來源不是不會做，是忘記做：
//   * 變更單送出去沒人追，做完了客戶說沒答應過 → 錢收不回來
//   * 工序做到了卻忘記請款 → 自己墊資撐現金流
//   * 請款開了、期限過了沒人催 → 帳齡越拖越難收
//   * 材料交期晚於現場需要日 → 工班進場撲空，白付一天工資
//   * 許可到期、保固到期、保留款該退 → 罰鍰或工班糾紛
//
// 每一種提醒都用 (ref_type, ref_id) 去重，同一件事不會每天洗出一張新待辦。

const { db, today, shiftDate, getSetting } = require('./db');
const { milestoneAmount } = require('./finance');

function ensureTask({ title, detail, assignee_id, due_date, priority, ref_type, ref_id, project_id }) {
  const dup = db.prepare(`SELECT id FROM tasks WHERE ref_type = ? AND ref_id = ? AND source = 'auto'
                          AND status IN ('todo','doing')`).get(ref_type, ref_id);
  if (dup) return dup.id;
  const info = db.prepare(`INSERT INTO tasks (project_id, title, detail, assignee_id, due_date, priority, source, ref_type, ref_id)
                           VALUES (?,?,?,?,?,?,'auto',?,?)`)
    .run(project_id || null, title, detail || '', assignee_id || null, due_date || '', priority || 'normal', ref_type, ref_id);
  return info.lastInsertRowid;
}

// 案子的負責人：工務優先（現場的事），沒有就設計師
function ownerOf(p, prefer) {
  if (prefer === 'designer') return p.designer_id || p.supervisor_id || null;
  return p.supervisor_id || p.designer_id || null;
}

function run() {
  const t = today();
  const soon = shiftDate(t, Number(getSetting('alert_days', '7')) || 7);
  const projects = db.prepare(
    "SELECT * FROM projects WHERE status IN ('design','contracted','construction','acceptance','warranty')").all();

  for (const p of projects) {
    // 1) 請款節點：綁的工序已經開工／完成，節點就從「未到」變成「可請款」
    const ms = db.prepare("SELECT * FROM billing_milestones WHERE project_id = ? AND status = 'pending'").all(p.id);
    for (const m of ms) {
      let reached = false;
      if (m.trigger_item_id) {
        const it = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(m.trigger_item_id);
        if (it) reached = m.trigger_on === 'end'
          ? (it.status === 'done' || !!it.actual_end)
          : (it.status !== 'pending' || !!it.actual_start);
      } else if (m.planned_date) {
        reached = m.planned_date <= t;
      }
      if (!reached) continue;
      db.prepare("UPDATE billing_milestones SET status = 'ready' WHERE id = ?").run(m.id);
      const contract = db.prepare(
        "SELECT COALESCE(SUM(amount),0) AS v FROM contracts WHERE project_id = ? AND status = 'active'").get(p.id).v;
      ensureTask({
        project_id: p.id, ref_type: 'milestone', ref_id: m.id,
        title: `【可以請款】${p.name} — ${m.name}`,
        detail: `金額約 ${milestoneAmount(m, contract).toLocaleString('zh-TW')} 元。工進已到節點，開單請款後系統才會把它列入應收。`,
        assignee_id: ownerOf(p, 'designer'), due_date: t, priority: 'high'
      });
    }

    // 2) 已請款但逾期未收
    for (const m of db.prepare(
      "SELECT * FROM billing_milestones WHERE project_id = ? AND status = 'invoiced' AND due_date <> '' AND due_date < ?")
      .all(p.id, t)) {
      const got = db.prepare('SELECT COALESCE(SUM(amount),0) AS v FROM receipts WHERE milestone_id = ?').get(m.id).v;
      const contract = db.prepare(
        "SELECT COALESCE(SUM(amount),0) AS v FROM contracts WHERE project_id = ? AND status = 'active'").get(p.id).v;
      const left = milestoneAmount(m, contract) - got;
      if (left <= 0) continue;
      ensureTask({
        project_id: p.id, ref_type: 'overdue', ref_id: m.id,
        title: `【逾期未收】${p.name} — ${m.name} 還差 ${left.toLocaleString('zh-TW')} 元`,
        detail: `約定收款日 ${m.due_date}，已逾期。`,
        assignee_id: ownerOf(p, 'designer'), due_date: t, priority: 'high'
      });
    }

    // 3) 變更單送出後遲遲沒簽 —— 這是整套系統最想擋住的漏洞
    for (const c of db.prepare(
      "SELECT * FROM change_orders WHERE project_id = ? AND status = 'sent' AND sent_at <> '' AND sent_at <= ?")
      .all(p.id, shiftDate(t, -3))) {
      ensureTask({
        project_id: p.id, ref_type: 'change', ref_id: c.id,
        title: `【追加單未簽認】${p.name} — ${c.title}（${c.amount.toLocaleString('zh-TW')} 元）`,
        detail: `${c.sent_at} 送出至今未取得業主簽認。沒簽認的追加不算進合約總價，做下去等於自己吸收。`,
        assignee_id: ownerOf(p, 'designer'), due_date: t, priority: 'high'
      });
    }

    // 4) 材料交期晚於現場需要日
    for (const mo of db.prepare(`SELECT * FROM material_orders WHERE project_id = ?
        AND status IN ('planned','ordered') AND need_date <> ''`).all(p.id)) {
      const late = mo.eta_date ? mo.eta_date > mo.need_date : mo.need_date <= soon && mo.status === 'planned';
      if (!late) continue;
      ensureTask({
        project_id: p.id, ref_type: 'material', ref_id: mo.id,
        title: `【料要來不及】${p.name} — ${mo.name}`,
        detail: mo.eta_date
          ? `現場 ${mo.need_date} 要用，廠商交期 ${mo.eta_date}，差 ${
              Math.round((new Date(mo.eta_date) - new Date(mo.need_date)) / 86400000)} 天。`
          : `現場 ${mo.need_date} 要用，到現在還沒下單。`,
        assignee_id: ownerOf(p), due_date: mo.need_date, priority: 'high'
      });
    }

    // 5) 許可期限
    for (const pm of db.prepare(`SELECT * FROM permits WHERE project_id = ?
        AND status IN ('todo','applied','approved') AND expiry_date <> '' AND expiry_date <= ?`).all(p.id, soon)) {
      ensureTask({
        project_id: p.id, ref_type: 'permit', ref_id: pm.id,
        title: `【許可將到期】${p.name} — ${pm.kind}（${pm.expiry_date}）`,
        detail: '逾期未展延可能被要求停工或處分。',
        assignee_id: pm.owner_id || ownerOf(p, 'designer'), due_date: pm.expiry_date, priority: 'high'
      });
    }

    // 6) 缺失逾期未改善
    for (const d of db.prepare(`SELECT * FROM defects WHERE project_id = ?
        AND status IN ('open','fixing') AND due_date <> '' AND due_date < ?`).all(p.id, t)) {
      ensureTask({
        project_id: p.id, ref_type: 'defect', ref_id: d.id,
        title: `【缺失逾期】${p.name} — ${d.location}${d.item}`,
        detail: `要求改善日 ${d.due_date} 已過。`,
        assignee_id: d.owner_id || ownerOf(p), due_date: t, priority: 'normal'
      });
    }
  }

  // 7) 保固到期前回訪（到期前一個月）
  for (const w of db.prepare(`SELECT w.*, p.name AS project_name, p.supervisor_id, p.designer_id
      FROM warranties w JOIN projects p ON p.id = w.project_id
      WHERE w.end_date <> '' AND w.end_date BETWEEN ? AND ?`).all(t, shiftDate(t, 30))) {
    ensureTask({
      project_id: w.project_id, ref_type: 'warranty', ref_id: w.id,
      title: `【保固將屆】${w.project_name} — ${w.item}（${w.end_date}）`,
      detail: '到期前主動回訪一次：有問題現在修是服務，過期再修是爭議。',
      assignee_id: w.supervisor_id || w.designer_id, due_date: w.end_date, priority: 'normal'
    });
  }

  // 8) 完工的發包單還壓著保留款沒退：工班會一直來要，也影響往後找不找得到人
  for (const s of db.prepare(`SELECT s.*, p.name AS project_name, p.supervisor_id, p.designer_id,
        (SELECT COALESCE(SUM(v.retention),0) FROM valuations v WHERE v.subcontract_id = s.id AND v.status <> 'draft') AS held,
        (SELECT COALESCE(SUM(r.amount),0) FROM retention_releases r WHERE r.subcontract_id = s.id AND r.kind = 'retention') AS back
      FROM subcontracts s JOIN projects p ON p.id = s.project_id
      WHERE s.status = 'done'`).all()) {
    if (s.held - s.back <= 0) continue;
    ensureTask({
      project_id: s.project_id, ref_type: 'retention', ref_id: s.id,
      title: `【保留款待退】${s.project_name} — ${s.trade} ${(s.held - s.back).toLocaleString('zh-TW')} 元`,
      detail: '該工班已完工。確認無缺失後辦理退款，或先在缺失單上登記求償再退差額。',
      assignee_id: s.supervisor_id || s.designer_id, due_date: '', priority: 'normal'
    });
  }
}

module.exports = { run, ensureTask };
