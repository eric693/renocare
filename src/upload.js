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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, crypto.randomBytes(16).toString('hex') + (OK_EXT.has(ext) ? ext : '.jpg'));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 20 },   // 手機直出的照片大約 3-6MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!OK_EXT.has(ext)) return cb(new Error('只接受圖片或 PDF'));
    cb(null, true);
  }
});

module.exports = { upload, DIR };
