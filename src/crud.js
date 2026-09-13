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

// 統一編號：8 碼數字，逐位乘上 1,2,1,2,1,2,4,1，各乘積的十位與個位相加，總和能被 5 整除才合法
// （財政部 112 年起由 10 放寬為 5）。第 7 碼是 7 時乘積 28 可視為 10 或 1，總和加 1 能整除也算。
function validTaxId(id) {
  if (!/^\d{8}$/.test(id)) return false;
  const w = [1, 2, 1, 2, 1, 2, 4, 1];
  let s = 0;
  for (let i = 0; i < 8; i++) { const p = Number(id[i]) * w[i]; s += Math.floor(p / 10) + (p % 10); }
  return s % 5 === 0 || (id[6] === '7' && (s + 1) % 5 === 0);
}
function checkTaxId(obj) {
  return obj.tax_id && !validTaxId(obj.tax_id) ? '統一編號要是 8 碼數字，而且檢查碼要正確，請再核對一次' : null;
}

// 統一發票號碼：2 碼英文字軌＋8 碼數字。空白、連字號、小寫都接受，一律存成 AB-12345678。
// 有填才檢查（留空合法）；格式不對回錯誤訊息，對的話直接改寫 obj.invoice_no。
function fixInvoiceNo(obj) {
  if (obj.invoice_no === undefined || obj.invoice_no === '') return null;
  const s = String(obj.invoice_no).toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z]{2}\d{8}$/.test(s)) return '發票號碼格式應為 2 碼英文字軌加 8 碼數字，例：AB-12345678';
  obj.invoice_no = `${s.slice(0, 2)}-${s.slice(2)}`;
  return null;
}

module.exports = { picker, insert, update, get, remove, lineAmount, validTaxId, checkTaxId, fixInvoiceNo };
