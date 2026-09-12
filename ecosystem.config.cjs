// pm2 部署設定。時區在此明確指定，讓程式從啟動的第一刻就是台北時間
// （src/db.js 另有保底設定，供 npm run seed 等直接執行的情境使用）。
module.exports = {
  apps: [{
    name: 'renocare',
    script: 'src/server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',        // SQLite 為單檔寫入，不適合多實例並行
    autorestart: true,
    max_memory_restart: '400M',
    time: true,
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Taipei',
      PORT: 3490
    }
  }]
};
