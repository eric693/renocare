// 專案金流與損益的唯一計算入口。
//
// 為什麼集中在這裡：儀表板、案場詳情、專案損益、業主端四個地方都要講同一組數字，
// 各自寫一次 SQL 的結果一定是「這頁說賺 18 萬、那頁說賺 12 萬」，然後沒人敢信系統。
//
// 幾個刻意的定義（全系統一致）：
//   合約總價 = 原合約金額 + 已簽認的追加減帳。未簽認的一毛都不算，
//             它們只出現在「待簽認」清單上催辦 —— 這正是裝修業最容易吃掉利潤的地方。
//   已發生成本 = 發包承諾（已發包的單，不是只有付掉的）+ 建材訂料 + 專案雜支。
//             用「承諾」而不是「已付」，因為錢還沒付不代表沒欠；只看已付會讓施工中的案子
//             看起來每一件都很賺，到結案才發現不是。
//   保留款／保固金只是「還沒付」，不是「不用付」，所以不從成本扣，只另外列出金額。

const { db, today } = require('./db');

// 一張請款節點的金額：依比例的算「原合約金額 × ％」，固定金額的直接用。
// 追加減帳不進節點比例（追加通常是另外結算），而是以「已簽認追加」整筆列為應收。
function milestoneAmount(m, contractAmount) {
  if (m.basis === 'amount') return Math.round(m.fixed_amount || 0);
  return Math.round((contractAmount || 0) * (m.percent || 0) / 100);
}

function projectMoney(projectId) {
  const t = today();
  const one = (sql, ...args) => db.prepare(sql).get(projectId, ...args) || {};

  const contractAmount = one(
    "SELECT COALESCE(SUM(amount),0) AS v FROM contracts WHERE project_id = ? AND status = 'active'").v || 0;

  const chg = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'signed' THEN amount ELSE 0 END),0) AS signed,
      COALESCE(SUM(CASE WHEN status IN ('draft','sent') THEN amount ELSE 0 END),0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END),0) AS sent_count,
      COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END),0) AS draft_count
    FROM change_orders WHERE project_id = ?`).get(projectId);

  const contractTotal = contractAmount + chg.signed;

  // ---- 收款側 ----
  const milestones = db.prepare(
    "SELECT * FROM billing_milestones WHERE project_id = ? AND status <> 'void' ORDER BY seq, id").all(projectId);
  const received = db.prepare('SELECT COALESCE(SUM(amount),0) AS v FROM receipts WHERE project_id = ?').get(projectId).v;
  const receivedByMs = new Map();
  for (const r of db.prepare(
    'SELECT milestone_id, SUM(amount) AS v FROM receipts WHERE project_id = ? GROUP BY milestone_id').all(projectId)) {
    receivedByMs.set(r.milestone_id, r.v);
  }

  // 沒掛節點的收款＝追加款或其他零星款。分開算，才講得清楚
  // 「追加簽了但還沒收」到底剩多少 —— 這一段是最常整筆被忘掉的錢。
  const freeReceived = db.prepare(
    'SELECT COALESCE(SUM(amount),0) AS v FROM receipts WHERE project_id = ? AND milestone_id IS NULL').get(projectId).v;

  let invoiced = 0, overdue = 0, msTotal = 0, invoicedOpen = 0, readyAmount = 0;
  for (const m of milestones) {
    m.amount = milestoneAmount(m, contractAmount);
    m.received = receivedByMs.get(m.id) || 0;
    m.outstanding = m.amount - m.received;
    msTotal += m.amount;
    if (m.status === 'invoiced' || m.status === 'paid') invoiced += m.amount;
    if (m.status === 'invoiced') invoicedOpen += m.outstanding;
    if (m.status === 'ready') readyAmount += m.outstanding;
    // 逾期的定義：已開單請款、有約定期限、期限已過、還沒收足。
    // 沒開單的不算逾期（是我們自己還沒請，不是客戶欠）。
    m.overdue = (m.status === 'invoiced' && m.due_date && m.due_date < t && m.outstanding > 0);
    if (m.overdue) overdue += m.outstanding;
  }

  const changeUnbilled = Math.max(0, chg.signed - freeReceived);   // 已簽認追加還沒收到的部分
  const billable = msTotal + chg.signed;                 // 依節點＋已簽追加，總共可以請到的錢
  const receivable = invoicedOpen + changeUnbilled;      // 現在可以去要的錢
  const unbilled = contractTotal - invoiced - chg.signed; // 連單都還沒開的部分

  // ---- 成本側 ----
  const sub = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN status IN ('signed','working','done','settled') THEN amount ELSE 0 END),0) AS committed,
           COALESCE(SUM(CASE WHEN status = 'draft' THEN amount ELSE 0 END),0) AS draft
    FROM subcontracts WHERE project_id = ?`).get(projectId);

  const val = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN v.status <> 'draft' THEN v.gross_amount ELSE 0 END),0) AS valued,
           COALESCE(SUM(CASE WHEN v.status = 'paid' THEN v.net_amount ELSE 0 END),0) AS paid,
           COALESCE(SUM(CASE WHEN v.status <> 'draft' THEN v.retention ELSE 0 END),0) AS retention,
           COALESCE(SUM(CASE WHEN v.status <> 'draft' THEN v.warranty_hold ELSE 0 END),0) AS warranty_hold,
           COALESCE(SUM(CASE WHEN v.status = 'confirmed' THEN v.net_amount ELSE 0 END),0) AS unpaid
    FROM valuations v JOIN subcontracts s ON s.id = v.subcontract_id
    WHERE s.project_id = ?`).get(projectId);

  const released = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN r.kind = 'retention' THEN r.amount ELSE 0 END),0) AS retention,
           COALESCE(SUM(CASE WHEN r.kind = 'warranty' THEN r.amount ELSE 0 END),0) AS warranty
    FROM retention_releases r JOIN subcontracts s ON s.id = r.subcontract_id
    WHERE s.project_id = ?`).get(projectId);

  const material = one(
    "SELECT COALESCE(SUM(amount),0) AS v FROM material_orders WHERE project_id = ? AND status <> 'cancelled'").v;
  const expense = one('SELECT COALESCE(SUM(amount),0) AS v FROM project_expenses WHERE project_id = ?').v;

  const costCommitted = sub.committed + material + expense;
  const grossProfit = contractTotal - costCommitted;
  const margin = contractTotal ? Math.round((grossProfit / contractTotal) * 1000) / 10 : 0;

  // 估價時預估的成本（成交的那一版），拿來跟實際發包比：差多少就是估錯或現場失控多少
  const quoted = db.prepare(`
    SELECT COALESCE(SUM(cost_total),0) AS cost, COALESCE(SUM(total),0) AS total
    FROM quotes WHERE project_id = ? AND status = 'accepted'`).get(projectId);

  return {
    contract_amount: contractAmount,
    change_signed: chg.signed,
    change_pending: chg.pending,
    change_sent_count: chg.sent_count,
    change_draft_count: chg.draft_count,
    contract_total: contractTotal,

    milestones,
    milestone_total: msTotal,
    billable,
    invoiced,
    invoiced_open: invoicedOpen,
    ready_amount: readyAmount,
    received,
    ms_received: received - freeReceived,
    free_received: freeReceived,
    change_unbilled: changeUnbilled,
    receivable,
    overdue,
    unbilled,
    // 節點比例沒配到 100%（或固定金額加起來對不上合約）時提醒，不要等到尾款才發現少請一段
    milestone_gap: contractAmount - msTotal,

    sub_committed: sub.committed,
    sub_draft: sub.draft,
    sub_valued: val.valued,
    sub_paid: val.paid,
    sub_unpaid: val.unpaid,
    retention_held: (val.retention - released.retention),
    warranty_held: (val.warranty_hold - released.warranty),
    material_cost: material,
    expense_cost: expense,
    cost_committed: costCommitted,

    gross_profit: grossProfit,
    margin,
    quoted_cost: quoted.cost,
    quoted_total: quoted.total,
    // 正數＝實際成本超出當初估價（吃掉利潤），負數＝比估的省
    cost_variance: costCommitted - quoted.cost
  };
}

// 工進：以工序權重加權的完成率。沒排工序的案子回 null，畫面顯示「—」而不是 0%
function projectProgress(projectId) {
  const rows = db.prepare('SELECT weight, progress, status FROM schedule_items WHERE project_id = ?').all(projectId);
  if (!rows.length) return null;
  const w = rows.reduce((a, r) => a + (r.weight || 1), 0);
  if (!w) return null;
  const done = rows.reduce((a, r) => a + (r.weight || 1) * (r.status === 'done' ? 100 : (r.progress || 0)), 0);
  return Math.round(done / w);
}

module.exports = { projectMoney, projectProgress, milestoneAmount };
