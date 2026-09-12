// 路由共用的小工具。二十幾張表都在做同一件事（挑欄位、組 INSERT/UPDATE），
// 各寫一次只會讓「某一張表忘記 trim」這種錯誤散落各處。

const { db } = require('./db');

// 依白名單挑出要寫入的欄位；NUMS 轉數字、空字串視為 null（給外鍵用）
function picker(fields, nums = [], floats = []) {
  return function pick(body) {
    const o = {};
    for (const f of fields) {
      if (body[f] === undefined) continue;
      if (nums.includes(f)) {
        const raw = String(body[f]).trim();
        o[f] = raw === '' ? null : (Math.round(Number(raw)) || 0);
      } else if (floats.includes(f)) {
        const raw = String(body[f]).trim();
        o[f] = raw === '' ? 0 : (Number(raw) || 0);
      } else {
        o[f] = String(body[f] ?? '').trim();
      }
    }
    return o;
  };
}

function insert(table, obj) {
  const cols = Object.keys(obj);
  if (!cols.length) throw new Error('沒有要寫入的欄位');
  const info = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map(c => obj[c]));
  return info.lastInsertRowid;
}

function update(table, id, obj) {
  const cols = Object.keys(obj);
  if (!cols.length) return false;
  db.prepare(`UPDATE ${table} SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`)
    .run(...cols.map(c => obj[c]), id);
  return true;
}

function get(table, id) { return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)); }
function remove(table, id) { db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(id)); }

// 明細列的金額一律由伺服器算，不吃前端送來的 amount：
// 前端算錯或被改過，帳就再也對不起來。
function lineAmount(qty, price) { return Math.round((Number(qty) || 0) * (Number(price) || 0)); }

module.exports = { picker, insert, update, get, remove, lineAmount };
