/**
 * Service Worker — 记一笔 PWA
 *
 * 策略：
 *  - 第三方 CDN 库（Bootstrap / Chart.js / CryptoJS）：Cache First（缓存优先）
 *  - HTML 主文件：Stale While Revalidate（缓存秒开，后台检查更新，下次生效）
 *  - 其他同源资源（icon / manifest）：Cache First
 */

const CACHE_NAME = 'app-libs-v1';

// 需要预缓存的第三方库
const PRECACHE_URLS = [
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css',
    'https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/crypto-js.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
];

// ==================== Install：预缓存第三方库 ====================
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(PRECACHE_URLS);
        }).then(() => self.skipWaiting())
    );
});

// ==================== Activate：清理旧缓存 ====================
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ==================== Fetch：请求拦截策略 ====================
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // GAS / Google Drive 请求：永远走网络，绝对不缓存
    if (url.hostname.includes('script.google.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('drive.google.com')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // HTML 文件：Stale While Revalidate
    // 先返回缓存（秒开），同时后台拉新版本存入缓存，下次打开生效
    if (url.pathname.endsWith('.html') || url.pathname === '/' ||
        url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => {
                return cache.match(event.request).then(cached => {
                    // 后台发起网络请求，无论有没有缓存都执行
                    const networkFetch = fetch(event.request).then(response => {
                        if (response && response.status === 200) {
                            // 有更新就存入缓存，下次打开生效
                            cache.put(event.request, response.clone());
                            // 通知页面"有新版本可用"
                            self.clients.matchAll().then(clients => {
                                clients.forEach(client => client.postMessage({ type: 'HTML_UPDATED' }));
                            });
                        }
                        return response;
                    }).catch(() => null); // 离线时后台请求失败，静默忽略

                    // 有缓存：立即返回缓存，后台更新
                    // 无缓存（首次访问）：等网络返回
                    return cached || networkFetch;
                });
            })
        );
        return;
    }

    // CDN 资源 和 本地静态资源：Cache First
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response && response.status === 200 && event.request.method === 'GET') {
                    const toCache = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
                }
                return response;
            });
        })
    );
});
