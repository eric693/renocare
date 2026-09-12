// 檔案上傳（工地照片、圖面）。檔名一律換成亂數：
//   * 原始檔名常是中文或含空白，不同系統轉碼會壞掉
//   * 工地照片要能給業主看，而業主端沒有帳號 —— 不可猜的檔名就是它的保護
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(DIR, { recursive: true });

const OK_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.pdf']);
const MAX_MB = 25;                                   // 現在的手機一張 48MP HEIC 就可能十幾 MB
const MAX_FILES = 20;

// multer 依 RFC 7578 把檔名當 latin1 解，中文檔名拿到手會是亂碼。
// 檔名本身不會被保留（一律換成亂數），但錯誤訊息要指名是哪一個檔，所以這裡轉回來。
function originalName(file) {
  const raw = file.originalname || '';
  try {
    const utf8 = Buffer.from(raw, 'latin1').toString('utf8');
    return utf8.includes('\uFFFD') ? raw : utf8;      // 轉出替代字元代表本來就不是 latin1，維持原樣
  } catch { return raw; }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, crypto.randomBytes(16).toString('hex') + (OK_EXT.has(ext) ? ext : '.jpg'));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!OK_EXT.has(ext)) {
      // 帶上 code 與檔名，錯誤處理器才講得出「哪一個檔、為什麼不行」。
      // 只說「系統發生錯誤」的話，現場的人會以為系統壞了，然後就不傳照片了 ——
      // 而沒拍到的隱蔽工程照，日後就是幾萬到幾十萬的責任歸屬。
      const e = new Error('檔案類型不支援');
      e.code = 'BAD_FILE_TYPE';
      e.filename = originalName(file);
      return cb(e);
    }
    cb(null, true);
  }
});

// 上傳被擋下來的原因要能翻成人話；不是上傳錯誤的就回 null，交給原本的處理流程
function uploadErrorMessage(err) {
  if (!err) return null;
  if (err.code === 'BAD_FILE_TYPE') {
    return `${err.filename ? `「${err.filename}」` : '這個檔案'}不是支援的格式。`
      + `只接受 ${[...OK_EXT].join('、')}（手機照片與 PDF 圖面都可以）。`;
  }
  if (err.code === 'LIMIT_FILE_SIZE') return `檔案太大，單檔上限 ${MAX_MB}MB。`;
  if (err.code === 'LIMIT_FILE_COUNT') return `一次最多上傳 ${MAX_FILES} 個檔案，請分批。`;
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return '上傳欄位不正確，請重新整理頁面後再試。';
  if (String(err.code || '').startsWith('LIMIT_')) return '上傳的內容超過限制，請調整後再試。';
  return null;
}

module.exports = { upload, DIR, uploadErrorMessage, OK_EXT, MAX_MB, MAX_FILES };
