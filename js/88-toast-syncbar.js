// @file js/88-toast-syncbar.js
// showToast 通知实现、底部同步状态条(initSyncBar)。

/**
 * 显示统一 toast 通知
 * type: 'success' | 'warning' | 'error' | 'info' | 'syncing'（同步进度，显示在底部状态条）| 'progress'（弹窗内操作进度，顶部常驻）
 * duration: ms，0 = 不自动消失
 */
function showToast(msg, type = 'success', duration = 3000) {
    // ── 持久状态交给底部状态条，顶部 toast 只做瞬时提示 ──
    if (type === 'syncing') {                       // “同步中… / 正在上传…”：进度类提示 → 状态条
        _barBusy = { msg, at: Date.now() };
        _barError = null;
        syncBarRender();
        return;
    }
    _barBusy = null;
    // 弹窗打开时底部状态条会被盖住，这时才需要在顶部再提示一次
    const barVisible = !(document.querySelector && document.querySelector('.modal.show'));
    let toastMs = duration;
    let showTop = true;
    // 需要用户处理的错误（duration 为 0，或“同步失败 / 同步已中止 / 加载失败”这类同步错误，不管传入多长时间）：底部持久显示（带重试 / 关闭），顶部不再重复
    if (type === 'error' && (duration === 0 || /^(同步失败|同步已中止|加载失败)/.test(msg))) {
        // 同步失败不立刻弹条：先靠底部细线提示，连续失败超过 BAR_ERROR_DELAY_MS 才弹出文字条
        _barError = { msg, retry: /同步/.test(msg), at: Date.now(), delayed: /^同步失败/.test(msg) };
        toastMs = 5000;
        if (barVisible) showTop = false;
    } else if (type === 'success') {
        // 任何成功提示都说明刚才的操作完成了：清掉旧的同步失败提示（同步成功的反馈交给底部绿线）
        _barError = null;
    }
    if (type === 'progress') toastMs = 0;           // 弹窗内的操作进度（如附件上传）：留在顶部、不自动消失，直到下一条提示替换它
    else {
        if (!(toastMs > 0)) toastMs = 5000;
        // 文字越长，停留越久（按约 90ms/字估算，至少保持传入的时长，最长 12 秒）
        const len = String(msg).replace(/<[^>]*>/g, '').length;
        toastMs = Math.max(toastMs, Math.min(1200 + len * 90, 12000));
    }

    const el = $('app-toast');
    if (el && showTop) {
        clearTimeout(_toastTimer);
        applyToastStyle(el, type);
        el.innerHTML = `${toastIcons[type] || ''} <span>${msg}</span>`;
        el.classList.add('show');
        const long = String(msg).replace(/<[^>]*>/g, '').length > 30;
        el.classList.toggle('tap-dismiss', long);
        el.onclick = long ? () => el.classList.remove('show') : null;   // 长提示：点一下即可关闭
        if (toastMs > 0) _toastTimer = setTimeout(() => el.classList.remove('show'), toastMs);
    }
    syncBarRender();
}

/* ───────── 5.1.8：底部导航上方的一行细线同步指示 + 改完 3 秒自动同步 ─────────
 * 状态完全由全局变量推导，平时不显示、不占位置：
 *   有修改未同步 → 琥珀色细线（改完立刻出现，3 秒后自动同步）
 *   同步中       → 蓝色细线来回流动
 *   同步成功     → 绿色细线，约 1.5 秒后淡出
 *   长时间同步不成功 → 才弹出底部文字状态条（#sync-bar）
 */
const AUTO_SYNC_DELAY_MS = 3000;        // 改完多久后自动同步（5.2.0：4 秒 → 3 秒）
const BAR_ERROR_DELAY_MS = 8000;        // 同步连续失败多久后弹文字提示条
const SYNC_LINE_OK_MS = 1500;           // 绿色细线停留时间
const AUTO_SYNC_MODAL_HOLD_MAX_MS = 60000;   // 5.2.0：弹窗开着时，自动同步最多暂缓多久（忘了关窗也不会一直不上传）
let _autoSyncHeldAt = 0;                // >0：有一次自动同步因弹窗打开而暂缓，值为首次暂缓的时间
let _lineOkUntil = 0;
let _lineState = '';
let _lineOkTimer = null;

function syncLineRender() {
    const line = $('sync-line');
    if (!line) return;
    const loginVisible = !!$('login-overlay') && !$('login-overlay').classList.contains('d-none');
    let st = 'idle';
    if (currentUser && !loginVisible) {
        if (driveIsSyncing) st = 'syncing';
        else if (Date.now() < _lineOkUntil) st = 'ok';
        else if (hasUnsavedChanges && !offlineMode && cloudConfigured()) st = 'unsaved';   // 纯本地使用（没配 GAS）时不提示“待同步”
    }
    if (st === _lineState) return;
    _lineState = st;
    line.dataset.state = st;
    line.classList.toggle('show', st !== 'idle');
}

/** 自动同步成功后调用：绿色细线停留约 1.5 秒再淡出 */
function syncLineOk() {
    _lineOkUntil = Date.now() + SYNC_LINE_OK_MS;
    _lineState = '';
    syncLineRender();
    if (_lineOkTimer) clearTimeout(_lineOkTimer);
    _lineOkTimer = setTimeout(() => {
        _lineOkUntil = 0;
        _lineState = '';
        syncLineRender();
    }, SYNC_LINE_OK_MS + 60);
}

function cancelAutoSync() {
    if (_autoSyncTimer) { clearTimeout(_autoSyncTimer); _autoSyncTimer = null; }
    _autoSyncAgain = false;
    _autoSyncHeldAt = 0;
}

/** 5.2.0：是否有弹窗（记账 / 账户 / 计划交易 / 预算…）正开着。记账窗口是 Bootstrap 弹窗 #editTransactionModal */
function isAnyModalOpen() {
    return typeof document !== 'undefined' && !!document.querySelector('.modal.show');
}

/** 5.2.0：自动同步现在该不该先等一等？弹窗开着就等（避免输入时同步卡顿、也让连续记账合并成一次同步），
 *  但页面在后台时不等，暂缓也有上限。数据安全不依赖这个判断（5.1.9 起同步随时都安全）。 */
function autoSyncShouldHold(now) {
    if (typeof document !== 'undefined' && document.hidden) return false;
    if (!isAnyModalOpen()) return false;
    return !_autoSyncHeldAt || (now - _autoSyncHeldAt) < AUTO_SYNC_MODAL_HOLD_MAX_MS;
}

/** 每次改动后调用：把自动同步往后推 3 秒（连续编辑只同步一次） */
function scheduleAutoSync() {
    if (!currentUser || offlineMode || !cloudConfigured() || !userPassword) return;
    if (driveIsSyncing) { _autoSyncAgain = true; return; }    // 正在同步：结束后再排一次
    if (_autoSyncTimer) clearTimeout(_autoSyncTimer);
    _autoSyncTimer = setTimeout(() => {
        _autoSyncTimer = null;
        autoSyncNow();
    }, AUTO_SYNC_DELAY_MS);
    syncLineRender();
}

async function autoSyncNow() {
    if (!currentUser || offlineMode || !cloudConfigured() || !userPassword) return;
    if (driveIsSyncing) { _autoSyncAgain = true; return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;   // 离线：等 online 事件
    if (!hasUnsavedChanges) return;
    // 5.2.0：弹窗开着 → 先不同步，只记下“被暂缓”；关窗后由 resumeAutoSyncAfterModal 重新排 3 秒，
    // 暂缓超过上限由 resumeAutoSyncIfNeeded 照常同步
    if (autoSyncShouldHold(Date.now())) { if (!_autoSyncHeldAt) _autoSyncHeldAt = Date.now(); return; }
    _autoSyncHeldAt = 0;
    await incSync(false);
}

window.addEventListener('online', () => {
    syncLineRender();
    if (hasUnsavedChanges) scheduleAutoSync();      // 网络恢复：3 秒内自动补同步
});
window.addEventListener('offline', syncLineRender);

/** 同步进行中又有改动时，scheduleAutoSync 只记下 _autoSyncAgain 标记（不能并发）。
 *  同步结束后由下面的 800ms 兜底定时器调用这里补排下一次，保证改动最终会被上传。 */
function resumeAutoSyncIfNeeded() {
    // 5.2.0：被弹窗暂缓的自动同步——弹窗关了就补排（再给 3 秒），暂缓到上限就照常同步
    if (_autoSyncHeldAt && hasUnsavedChanges && !driveIsSyncing && !_autoSyncTimer) {
        if (!isAnyModalOpen()) { _autoSyncHeldAt = 0; scheduleAutoSync(); }
        else if (Date.now() - _autoSyncHeldAt >= AUTO_SYNC_MODAL_HOLD_MAX_MS) autoSyncNow();
    }
    if (!_autoSyncAgain || driveIsSyncing) return;
    _autoSyncAgain = false;
    if (hasUnsavedChanges) scheduleAutoSync();
}

/** 5.2.0：后台同步遇到弹窗时只推迟“渲染”（数据早已刷新），弹窗都关了再补渲染 */
function flushPendingUIRefresh() {
    if (!window._pendingUIRefresh || isAnyModalOpen()) return;
    window._pendingUIRefresh = false;
    if (!currentUser) return;
    loadAllData();
    filterUserData();
    renderAllTransactions();
    renderAccounts();
    if (typeof verboseToast !== 'undefined' && verboseToast) showToast('已刷新最新数据', 'success', 2500);
}

/** 弹窗关闭后：还有没上传的改动、而且没有排着的同步 → 排一次（关窗后 3 秒，连续记账合并成一次；取消关闭也算） */
function resumeAutoSyncAfterModal() {
    if (isAnyModalOpen() || !hasUnsavedChanges || driveIsSyncing || _autoSyncTimer) return;
    _autoSyncHeldAt = 0;
    scheduleAutoSync();
}

if (typeof document !== 'undefined') {
    document.addEventListener('hidden.bs.modal', () => { flushPendingUIRefresh(); resumeAutoSyncAfterModal(); });
    // 页面切到后台（手机切应用 / 锁屏）：不再等弹窗，立刻同步（草稿已由 flushDraftNow 落盘，这里是尽力而为）
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden || !hasUnsavedChanges) return;
        if (_autoSyncTimer) { clearTimeout(_autoSyncTimer); _autoSyncTimer = null; }
        _autoSyncHeldAt = 0;
        autoSyncNow();
    });
}

/* ───────── 底部同步状态条（未同步 / 同步中 / 同步失败 / 无网络） ─────────
 * 状态由全局变量“推导”出来（而不是各处手动开关），所以不会出现状态残留或互相覆盖：
 *   同步中 > 失败 > 无网络/未同步 > 刚同步完成（短暂）> 隐藏
 */
function syncBarDerive() {
    const loginVisible = !!$('login-overlay') && !$('login-overlay').classList.contains('d-none');
    if (_barBusy && Date.now() - _barBusy.at > 90000) _barBusy = null;   // 保险：90 秒还没结束就当作已结束
    let s = { state: 'idle', text: '', btn: '', close: false, loginVisible };
    if (_barBusy) s = { ...s, state: 'syncing', text: _barBusy.msg };
    else if (_barError) {
        // 5.1.8：同步失败先只显示底部细线，连续失败超过 BAR_ERROR_DELAY_MS 才弹出文字条
        const ripe = !_barError.delayed || (Date.now() - (_barError.at || 0) >= BAR_ERROR_DELAY_MS);
        if (ripe) s = { ...s, state: 'error', text: _barError.msg, btn: _barError.retry ? '重试' : '', close: true };
    } else if (currentUser && !offlineMode && hasUnsavedChanges) {
        // 有修改未同步 / 正在自动同步：只显示细线，不占屏幕
        if (typeof navigator !== 'undefined' && navigator.onLine === false
            && Date.now() - (_unsavedSince || 0) > BAR_ERROR_DELAY_MS) {
            s = { ...s, state: 'offline', text: '无网络，修改已保存在本机，联网后自动同步' };
        }
    }
    return s;
}

function syncBarRender() {
    const bar = $('sync-bar');
    if (!bar) return;
    const s = syncBarDerive();
    const key = [s.state, s.text, s.btn, s.close, s.loginVisible].join('|');
    if (key === _barKey) return;
    _barKey = key;
    const icons = { unsaved: toastIcons.warning, syncing: toastIcons.syncing, error: toastIcons.error, ok: toastIcons.success, offline: '<i class="bi bi-wifi-off"></i>' };
    bar.dataset.state = s.state;
    bar.querySelector('.sb-icon').innerHTML = icons[s.state] || '';
    bar.querySelector('.sb-text').textContent = s.text;
    const btn = bar.querySelector('.sb-btn'), cls = bar.querySelector('.sb-close');
    btn.textContent = s.btn; btn.style.display = s.btn ? '' : 'none';
    cls.style.display = s.close ? '' : 'none';
    bar.classList.toggle('on-login', s.loginVisible);
    bar.classList.toggle('show', s.state !== 'idle');
    if (s.state === 'idle') bar.classList.remove('expanded');
    syncBarApplyPos();
    // 提示条被拖到别处后，页面底部不必再留出它的位置
    document.body.classList.toggle('sync-bar-on', s.state !== 'idle' && !s.loginVisible && !bar.classList.contains('moved'));
}

/* ─── 5.0.9：长按拖动提示条，位置记在本机 ───
 * 位置按“可移动范围的比例”保存 {x, y}（0~1），换屏幕尺寸/横竖屏后仍在相对位置，并自动限制在屏幕内。 */
const SYNC_BAR_POS_KEY = 'APP_sync_bar_pos';
const SYNC_BAR_MARGIN = 8;          // 离屏幕边缘的最小距离
const SYNC_BAR_LONGPRESS_MS = 380;  // 长按多久后进入拖动

let _syncBarInsets = null;
function _syncBarSafeInsets() {      // 读取刘海/底部横条的安全区（env() 只能借助真实元素算出像素）
    if (_syncBarInsets) return _syncBarInsets;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    _syncBarInsets = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
    probe.remove();
    return _syncBarInsets;
}

function _syncBarBounds(bar) {
    const ins = _syncBarSafeInsets();
    const w = bar.offsetWidth, h = bar.offsetHeight;
    const minL = SYNC_BAR_MARGIN, minT = ins.top + SYNC_BAR_MARGIN;
    const maxL = Math.max(minL, window.innerWidth - w - SYNC_BAR_MARGIN);
    const maxT = Math.max(minT, window.innerHeight - h - SYNC_BAR_MARGIN - ins.bottom);
    return { minL, maxL, minT, maxT };
}

function _syncBarSetLeftTop(bar, left, top) {
    const b = _syncBarBounds(bar);
    const l = Math.min(b.maxL, Math.max(b.minL, left));
    const t = Math.min(b.maxT, Math.max(b.minT, top));
    bar.style.setProperty('--sb-left', l + 'px');
    bar.style.setProperty('--sb-top', t + 'px');
    return { l, t, b };
}

function _syncBarLoadPos() {
    try {
        const p = JSON.parse(localStorage.getItem(SYNC_BAR_POS_KEY) || 'null');
        if (p && isFinite(p.x) && isFinite(p.y)) return { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
    } catch (_) {}
    return null;
}

// 按已保存的位置摆放（没有保存位置 / 登录界面时恢复默认位置）
function syncBarApplyPos() {
    const bar = $('sync-bar');
    if (!bar) return;
    const pos = _syncBarLoadPos();
    if (!pos || bar.classList.contains('on-login')) {
        bar.classList.remove('moved');
        return;
    }
    bar.classList.add('moved');
    const b = _syncBarBounds(bar);
    _syncBarSetLeftTop(bar, b.minL + pos.x * (b.maxL - b.minL), b.minT + pos.y * (b.maxT - b.minT));
}

function resetSyncBarPos() {
    try { localStorage.removeItem(SYNC_BAR_POS_KEY); } catch (_) {}
    const bar = $('sync-bar');
    if (bar) {
        bar.classList.remove('moved');
        bar.style.removeProperty('--sb-left');
        bar.style.removeProperty('--sb-top');
    }
    _barKey = '';              // 让下一次渲染重新计算页面底部留白
    syncBarRender();
    syncBarRefreshResetUI();
}

// 设置页“同步提示位置”一行：显示当前是默认位置还是自定义位置
function syncBarRefreshResetUI() {
    const st = $('sync-bar-pos-state'), btn = $('sync-bar-reset-btn');
    const custom = !!_syncBarLoadPos();
    if (st) st.textContent = custom ? '当前：自定义位置' : '当前：默认位置';
    if (btn) btn.disabled = !custom;
}

function initSyncBarDrag() {
    const bar = $('sync-bar');
    if (!bar) return;
    let timer = null, dragging = false, sx = 0, sy = 0, offX = 0, offY = 0, pid = null, swallowClick = false;

    const cancelPending = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const finish = () => {
        cancelPending();
        if (!dragging) return;
        dragging = false;
        bar.classList.remove('dragging');
        try { if (pid != null) bar.releasePointerCapture(pid); } catch (_) {}
        // 保存位置（比例）
        const r = bar.getBoundingClientRect(), b = _syncBarBounds(bar);
        const x = b.maxL > b.minL ? (r.left - b.minL) / (b.maxL - b.minL) : 0;
        const y = b.maxT > b.minT ? (r.top - b.minT) / (b.maxT - b.minT) : 0;
        try { localStorage.setItem(SYNC_BAR_POS_KEY, JSON.stringify({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) })); } catch (_) {}
        syncBarApplyPos();
        document.body.classList.remove('sync-bar-on');
        syncBarRefreshResetUI();
        setTimeout(() => { swallowClick = false; }, 0);
    };

    bar.addEventListener('pointerdown', e => {
        if (bar.classList.contains('on-login')) return;                 // 登录界面不可拖
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target.closest('.sb-btn, .sb-close')) return;              // 按钮上的长按不触发拖动
        sx = e.clientX; sy = e.clientY; pid = e.pointerId;
        cancelPending();
        timer = setTimeout(() => {
            timer = null;
            dragging = true; swallowClick = true;
            const r = bar.getBoundingClientRect();
            offX = sx - r.left; offY = sy - r.top;
            bar.classList.add('moved', 'dragging');
            _syncBarSetLeftTop(bar, r.left, r.top);
            try { bar.setPointerCapture(pid); } catch (_) {}
            if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }   // 触感反馈（iOS 不支持则忽略）
        }, SYNC_BAR_LONGPRESS_MS);
    });
    bar.addEventListener('pointermove', e => {
        if (!dragging) {
            // 长按前手指移动超过 8px：说明是想滑动/点击别的，取消长按
            if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cancelPending();
            return;
        }
        e.preventDefault();
        _syncBarSetLeftTop(bar, e.clientX - offX, e.clientY - offY);
    });
    bar.addEventListener('pointerup', finish);
    bar.addEventListener('pointercancel', finish);
    bar.addEventListener('contextmenu', e => { if (dragging || timer) e.preventDefault(); });
    // 拖动结束时手指抬起会产生一次 click，不要让它触发“展开/立即同步”
    bar.addEventListener('click', e => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);
    window.addEventListener('resize', syncBarApplyPos);
    window.addEventListener('orientationchange', () => setTimeout(syncBarApplyPos, 200));
}

function syncBarAction() {            // “立即同步” / “重试”
    if (_barError) { _barError = null; syncBarRender(); }
    syncToDrive(true);
}
function syncBarDismiss() { _barError = null; syncBarRender(); }
(function initSyncBar() {
    const bar = document.getElementById('sync-bar');
    if (!bar) return;
    bar.querySelector('.sb-btn').addEventListener('click', syncBarAction);
    bar.querySelector('.sb-text').addEventListener('click', () => bar.classList.toggle('expanded'));   // 文字很长时，点一下展开看全文
    bar.querySelector('.sb-close').addEventListener('click', syncBarDismiss);
    initSyncBarDrag();
    window.addEventListener('online', syncBarRender);
    window.addEventListener('offline', syncBarRender);
    syncLineRender();
    // 兜底：hasUnsavedChanges / driveIsSyncing 等变量被各处直接修改时，也能及时反映；
    // 同时把“同步期间又改了数据”而暂缓的自动同步补排上
    setInterval(() => { syncBarRender(); syncLineRender(); resumeAutoSyncIfNeeded(); flushPendingUIRefresh(); }, 800);
})();
