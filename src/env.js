// 讀取專案根目錄的 .env，把裡面的設定放進 process.env。
//
// 為什麼自己寫而不裝 dotenv：只需要「一行一個 KEY=VALUE」這件事，
// 為此多一個相依套件不划算，而且這支要在 server 與各 script 都最先跑，
// 相依愈少愈不會出意外。
//
// 規則：
//   - 以 # 開頭或空白行略過
//   - 值可以用單引號或雙引號包起來（值裡有空白或 # 時需要）
//   - 已經存在於 process.env 的不覆蓋 —— 命令列帶的環境變數優先於 .env
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');

function load() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const loaded = {};
  for (const raw of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    loaded[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return loaded;
}

// 整個 process 只讀一次：server 與 script 都會 require 到這支，
// 重複解析同一個檔案沒有意義，也免得日誌被洗版。
let done = false;
function ensure() {
  if (done) return;
  done = true;
  load();
}

ensure();

module.exports = { ensure, ENV_FILE };
