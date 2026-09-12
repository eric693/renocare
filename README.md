# RenoCare 宅匠

室內設計／裝修工程營運管理系統。完整功能說明見 [`功能介紹.md`](功能介紹.md)，
設計依據（產業痛點對照）見 [`docs/產業痛點對照.md`](docs/產業痛點對照.md)。

正式站：https://renocare.crownai.ink　　本機埠：127.0.0.1:3490

## 快速開始

```bash
npm install
cp .env.example .env      # 可選，預設值就能跑
npm run seed -- --reset   # 建立帳號與示範資料
npm start
```

預設帳號：`admin / admin123`（負責人）、`designer / design123`、`foreman / work123`。

## 程式結構

```
db/schema.sql          資料表定義（設計理由寫在註解裡）
src/db.js              開檔、欄位遷移、設定、日期工具
src/finance.js         專案金流與損益的唯一計算入口（全系統共用同一組定義）
src/reminders.js       每天自動產生的提醒（會被忘記、忘記就會虧錢的事）
src/auth.js            登入、模組權限、唯讀權限、限流
src/crud.js            路由共用的欄位挑選與寫入
src/routes/            各模組 API；client.js 是業主端（憑亂數 token，不需帳號）
public/js/pages-*.js   前端各頁；案場詳情的分頁在 pages-project-tabs*.js
public/client.html     業主端（獨立頁面，手機優先）
scripts/seed.js        示範資料
scripts/feature-test.js 端到端測試
```

## 測試

```bash
npm start &        # 兩種測試都會打本機 API
npm test           # 後端端到端：113 項
npm run test:ui    # 前端冒煙：jsdom 把整個 SPA 跑一遍，逐頁渲染，66 項
npm run test:all   # 兩個一起跑
```

後端測的不是「有沒有回 200」，而是錢算得對不對：未簽認的追加不能進合約、
估驗不能重複計價、缺失求償不能扣兩次、逾期要算得出來、業主端不能看到成本。
上傳也整條驗：檔案存得進去、取得回來、刪除連磁碟檔一起刪、被擋下來時回的是
看得懂的 400 而不是 500，以及業主端看不到沒勾「業主可見」的照片。
另有一整段「資料同步」：同一個金額在案場詳情、應收、損益、儀表板、案場清單、
業主端要一模一樣，報表的合計要等於它自己列出來的每一列加總，
簽一張追加之後五個地方要同時跟著動、作廢之後要一起回去。
前端測的是每一頁（含案場詳情的九個分頁與各個對話框）都渲染得出來 ——
樣板字串打錯欄位名這種錯，不該等到客戶點進那一頁才發現。

## 部署

```bash
pm2 start ecosystem.config.cjs && pm2 save
```

nginx 設定在 `/etc/nginx/sites-available/renocare.crownai.ink`，
`client_max_body_size` 放寬到 60m（手機直出的工地照片一次多張）。
