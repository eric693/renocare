// PWA：註冊 Service Worker、離線提示、新版本提示、加到主畫面。
//
// 三個提示都刻意做成不打斷工作的橫幅，而不是彈窗 —— 同仁常常是一邊接客一邊操作，
// 跳出來要按確定的東西只會被亂按掉。

const PWA = {
  reg: null,
  installPrompt: null,

  init() {
    if (!('serviceWorker' in navigator)) return;   // 舊瀏覽器就照原本的網頁用，功能不受影響
    window.addEventListener('load', () => PWA.register());
    window.addEventListener('online', () => PWA.banner(false));
    window.addEventListener('offline', () => PWA.banner(true));
    if (!navigator.onLine) PWA.banner(true);

    // Chrome／Edge 會在符合安裝條件時丟這個事件，接住它才能自己決定何時邀請安裝
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      PWA.installPrompt = e;
      PWA.showInstall();
    });
    window.addEventListener('appinstalled', () => {
      PWA.installPrompt = null;
      document.getElementById('pwa-install')?.remove();
      UI.toast('已加到主畫面');
    });
  },

  async register() {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      PWA.reg = reg;
      // 已經有新版在等：使用者上次沒按更新，這次進來再問一次
      if (reg.waiting) PWA.showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // controller 是 null 代表這是第一次安裝，沒有「更新」可言，不要打擾使用者
          if (sw.state === 'installed' && navigator.serviceWorker.controller) PWA.showUpdate(sw);
        });
      });
      // 新版接手後重新整理一次，確保畫面與程式是同一版
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    } catch (e) {
      // 註冊失敗不影響任何功能，就是少了離線與安裝而已，不要嚇使用者
      console.warn('Service Worker 註冊失敗：', e.message);
    }
  },

  // 三種橫幅共用一個容器，由 flex 直接排上去。
  // 先前用寫死的 bottom 位移，離線提示換行變成兩行時就會被蓋住。
  bar(id, html, cls = '') {
    let wrap = document.getElementById('pwa-bars');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'pwa-bars';
      document.body.appendChild(wrap);
    }
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'pwa-bar ' + cls;
      wrap.appendChild(el);
    }
    el.innerHTML = html;
    return el;
  },

  // 離線橫幅：講清楚「看得到的數字可能不是最新的，而且現在存不了東西」
  banner(offline) {
    if (!offline) {
      document.getElementById('pwa-offline')?.remove();
      return;
    }
    PWA.bar('pwa-offline', `<span>目前沒有網路連線。畫面還開得起來，但<b>數字可能不是最新的</b>，
      而且現在存不了任何資料。恢復連線後請重新整理。</span>`, 'warn');
  },

  showUpdate(sw) {
    const el = PWA.bar('pwa-update', `<span>系統有新版本。</span>
      <button class="btn tiny" id="pwa-do-update">立即更新</button>
      <button class="btn tiny secondary" id="pwa-later">稍後</button>`);
    el.querySelector('#pwa-do-update').onclick = () => {
      sw.postMessage('skip-waiting');     // 換版後 controllerchange 會自動重新整理
      el.remove();
    };
    el.querySelector('#pwa-later').onclick = () => el.remove();
  },

  showInstall() {
    // 每個裝置只邀請一次，按過「不用了」就不再出現
    try { if (localStorage.getItem('pwa_install_dismissed') === '1') return; } catch {}
    const el = PWA.bar('pwa-install', `<span>可以把利玖選品加到主畫面，像 App 一樣開。</span>
      <button class="btn tiny" id="pwa-do-install">加到主畫面</button>
      <button class="btn tiny secondary" id="pwa-no-install">不用了</button>`);
    el.querySelector('#pwa-do-install').onclick = async () => {
      const p = PWA.installPrompt;
      el.remove();
      if (!p) return;
      p.prompt();
      await p.userChoice;
      PWA.installPrompt = null;
    };
    el.querySelector('#pwa-no-install').onclick = () => {
      try { localStorage.setItem('pwa_install_dismissed', '1'); } catch {}
      el.remove();
    };
  }
};

PWA.init();
