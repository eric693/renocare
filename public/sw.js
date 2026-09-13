// Service Worker：讓系統可以「加到主畫面」像 App 一樣開，斷網時也還打得開畫面。
//
// 這是一套會算錢的營運系統，所以快取策略刻意保守：
//
//   1. /api 一律不快取。庫存、金額、訂單狀態這種東西拿到舊的比拿不到更危險
//      —— 使用者會照著錯的數字做決定，而且不會發現。斷網時 API 直接失敗，
//      畫面上的錯誤訊息就是「你現在沒網路」的誠實回報。
//   2. 前端程式（js/css/html）走 network-first：有網路一定拿最新版，
//      沒網路才退回快取。這跟 server.js 對這些檔案設 no-cache 是同一個理由 ——
//      「新的 API 配舊的畫面」會產生清不掉的怪錯誤。
//   3. 圖示等靜態資源走 cache-first，那些東西不會變。
//
// 改版時把 VERSION 加一，舊快取會在啟用時清掉。
const VERSION = 'renocare-v8';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// 首次安裝就抓下來的最小骨架：沒網路時至少開得起畫面
const PRECACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/api.js',
  '/js/ui.js',
  '/js/charts.js',
  '/js/app.js',
  '/js/pages-core.js',
  '/js/pages-projects.js',
  '/js/pages-project-tabs.js',
  '/js/pages-project-tabs2.js',
  '/js/pages-scoped.js',
  '/js/pages-quotes.js',
  '/js/pages-changes.js',
  '/js/pages-money.js',
  '/js/pages-lists.js',
  '/js/pages-admin.js',
  '/js/pwa.js',
  '/icons/icon-192.png',
];

self.addEventListener('install', e => {
  // 個別檔案抓失敗不該讓整個安裝失敗（少一個 icon 不值得讓 PWA 裝不起來）
  e.waitUntil(caches.open(SHELL).then(c => Promise.allSettled(PRECACHE.map(u => c.add(u)))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (!k.startsWith(VERSION)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

// 頁面按下「立即更新」時才換版本，不在使用者填單填到一半時偷換掉程式
self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

const isAsset = url => /\.(png|jpg|jpeg|svg|ico|webp|woff2?)$/i.test(url.pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // 寫入動作一律直接上網
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // 外部資源不插手
  if (url.pathname.startsWith('/api/')) return;           // 帳務資料只認即時的
  if (url.pathname.startsWith('/uploads/')) return;       // 上傳檔要驗登入，不進快取

  // 圖示等不會變的靜態資源：先給快取，順手在背景更新
  if (isAsset(url)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      const net = fetch(req).then(r => {
        if (r.ok) caches.open(ASSETS).then(c => c.put(req, r.clone()));
        return r;
      }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  // 畫面與程式碼：有網路拿最新，斷網才退回快取
  e.respondWith((async () => {
    try {
      const r = await fetch(req);
      if (r.ok) {
        const copy = r.clone();
        caches.open(SHELL).then(c => c.put(req, copy));
      }
      return r;
    } catch {
      const hit = await caches.match(req);
      if (hit) return hit;
      // 換頁請求沒命中就退回首頁骨架（SPA 的路由在 hash，首頁足以接手）
      if (req.mode === 'navigate') {
        const shell = await caches.match('/index.html') || await caches.match('/');
        if (shell) return shell;
      }
      return new Response('離線中，且這個資源沒有離線副本。', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
