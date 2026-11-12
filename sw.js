/* 记一笔 · Service Worker
 * 与 index.html v5.1.0 配套（页面里通过 navigator.serviceWorker.register('sw.js') 注册）
 *
 * 策略：
 *  1. 应用外壳（index.html / css/*.css / js/*.js / manifest.json / 图标）：网络优先（3 秒超时），失败回退缓存
 *     → 联网时总能拿到最新版，断网也能打开
 *  2. CDN（Bootstrap / Bootstrap Icons / CryptoJS / Chart.js）：全部使用固定版本号，
 *     路径里带版本号 → 内容永不变化 → 缓存优先，离线可用、也不会某天被上游改坏
 *  3. 数据请求一律不拦截、不缓存：Google Apps Script / Google Drive 附件等都直接走网络
 *     （账目数据是 Google 表格中的加密密文行，同步状态由 App 自己管理，不能被 SW 缓存）
 *
 * 版本更新：
 *  install 里不再自动 skipWaiting。新版本会停在 waiting 状态，
 *  页面收到提示后显示“有新版本，点击刷新”，用户点击时才 postMessage('SKIP_WAITING') 切换。
 *  这样用户正在填表时不会被打断。
 */
const APP_VERSION = '5.1.0';
const SHELL_CACHE = `jibi-shell-v${APP_VERSION}`;
const CDN_CACHE = 'jibi-cdn-v2';   // CDN 资源带版本号，长期有效，不随 APP_VERSION 清理

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  // 拆分后的样式与脚本（新增/改名文件时必须同步这里，并升级 APP_VERSION）
  './css/10-base-layout.css',
  './css/20-feedback-sync.css',
  './css/30-transactions.css',
  './css/40-transaction-form.css',
  './css/50-insights-stats.css',
  './css/60-widgets.css',
  './css/themes/clean.css',
  './css/themes/cute.css',
  './css/themes/finance.css',
  './css/70-app-skin.css',
  './js/boot-head.js',
  './js/10-config-state.js',
  './js/15-money-format.js',
  './js/20-cloud-sync.js',
  './js/25-login-settings.js',
  './js/30-auth-session.js',
  './js/31-login-pin.js',
  './js/32-entry-reminders.js',
  './js/35-ui-feedback.js',
  './js/40-draft-drive-sync.js',
  './js/45-import-export.js',
  './js/50-accounts.js',
  './js/52-account-detail.js',
  './js/55-transaction-modals.js',
  './js/56-transfer-pair.js',
  './js/57-transfer-ui.js',
  './js/58-split-items.js',
  './js/60-budget.js',
  './js/62-category-icons.js',
  './js/64-transaction-submit.js',
  './js/66-transaction-filters.js',
  './js/67-batch-edit.js',
  './js/68-transaction-list.js',
  './js/70-attachments-hints.js',
  './js/75-stats-core.js',
  './js/78-backup-restore.js',
  './js/80-charts.js',
  './js/85-navigation-settings.js',
  './js/86-theme-settings.js',
  './js/88-toast-syncbar.js',
  './js/90-settings.js',
  './js/92-planned.js',
  './js/94-user-management.js',
  './js/96-tag-suggest.js',
  './js/98-insights.js',
  './js/99-account-select.js',
  './js/99-html-escape.js',
  './js/sw-register.js',
];

/* 固定版本：任何一项都不要再写“不指定版本”的地址（以前 chart.js 就是这样，
 * 上游一发新版就可能直接改坏图表）。这里必须与 index.html 里的 <script>/<link> 完全一致。 */
const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css',
  'https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/crypto-js.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
];

// 这些域名永远走网络，SW 不介入
const BYPASS_HOSTS = [
  'script.google.com',
  'script.googleusercontent.com',
  'drive.google.com',
  'docs.google.com',
  'lh3.googleusercontent.com',
  'www.googleapis.com',
  'accounts.google.com',
];

function shouldBypass(url) {
  const h = url.hostname;
  if (BYPASS_HOSTS.includes(h)) return true;
  if (h.endsWith('.googleusercontent.com')) return true;
  return false;
}

/* ───────── 安装：预缓存外壳与 CDN（单个失败不影响整体安装） ───────── */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all([
      ...SHELL_URLS.map(u => shell.add(new Request(u, { cache: 'reload' })).catch(() => {})),
      ...CDN_URLS.map(async u => {
        if (await cdn.match(u)) return;               // 已经缓存过就不重复下载
        await cdn.add(u).catch(() => {});
      }),
    ]);
    // 注意：这里故意不调用 skipWaiting()，等页面提示用户后再切换
  })());
});

/* ───────── 激活：清理旧版本外壳缓存，接管页面 ───────── */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('jibi-shell-') && k !== SHELL_CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* 页面点击“刷新”后发来 SKIP_WAITING：立刻接管并让页面 reload */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

/* ───────── 请求拦截 ───────── */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                    // POST（同步上传/附件上传）一律放行
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  if (shouldBypass(url)) return;                        // 数据/附件请求：直接走网络

  // 页面导航 或 同源外壳资源：网络优先 + 缓存兜底
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
    return;
  }

  // CDN：带版本号的缓存优先
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(req));
  }
  // 其他跨域资源：不处理，浏览器默认行为
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await timeout(fetch(req), 3000);
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch (_) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = (await cache.match('./index.html')) || (await cache.match('./'));
      if (shell) return shell;
    }
    // 超时但缓存里也没有：再等一次真实网络结果
    return fetch(req);
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

function timeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
