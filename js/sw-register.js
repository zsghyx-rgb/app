// @file js/sw-register.js
// Service Worker 注册、“有新版本，点击刷新”提示条、网络恢复后自动同步。依赖主脚本里的 $ / flushDraftNow / cloudConfigured 等，必须放在所有 js/ 业务文件之后。

/* 以前 SW 装好就 skipWaiting + 自动接管，用户可能正在填表，页面被静默换掉。
 * 现在：新版本先进入 waiting 状态，顶部弹一条“有新版本，点击刷新”，
 * 用户点了才切换（切换前先把未保存的改动落盘）。 */
let _swReg = null;
let _swReloading = false;
let _swUpdateRequested = false;
let _updateBannerDismissed = false;

function showUpdateBanner() {
    const el = $('update-banner');
    if (!el || _updateBannerDismissed) return;
    el.classList.add('show');
}
function dismissUpdateBanner() {
    const el = $('update-banner');
    if (el) el.classList.remove('show');
    _updateBannerDismissed = true;      // 本次会话不再打扰，下次打开还会提示
}
function applyAppUpdate() {
    const el = $('update-banner');
    if (el) el.classList.remove('show');
    flushDraftNow();                    // 先把未保存的改动写进本地草稿，再刷新
    _swUpdateRequested = true;
    if (_swReg && _swReg.waiting) {
        _swReg.waiting.postMessage('SKIP_WAITING');
    } else {
        location.reload();
    }
}

if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(reg => {
            _swReg = reg;
            // 上次已下载好但没刷新：直接提示
            if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();
            reg.addEventListener('updatefound', () => {
                const nw = reg.installing;
                if (!nw) return;
                nw.addEventListener('statechange', () => {
                    if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
                });
            });
        }).catch(() => {});
        // 每小时主动检查一次新版本
        setInterval(() => { if (_swReg) _swReg.update().catch(() => {}); }, 60 * 60 * 1000);
    });
    // 回到前台时也检查一次
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && _swReg) _swReg.update().catch(() => {});
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (_swReloading) return;
        // 首次安装（本来没有 controller）不要自动刷新；只有“用户点了刷新”或本来就受控时才刷新
        if (!hadController && !_swUpdateRequested) return;
        _swReloading = true;
        location.reload();
    });
}

// 网络恢复时自动触发后台同步
window.addEventListener('online', () => {
    if (currentUserName && !offlineMode && cloudConfigured()) {
        window._pendingBackgroundSync = true;
        backgroundSyncAfterLogin();
    }
});
