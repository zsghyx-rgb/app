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
        _barError = { msg, retry: /同步/.test(msg) };
        toastMs = 5000;
        if (barVisible) showTop = false;
    } else if (type === 'success') {
        _barError = null;
        if (/已同步|同步成功|迁移完成/.test(msg)) { // 同步完成：底部状态条变绿并显示这句话，顶部不再重复
            const long = msg.length > 16;
            const ms = long ? Math.min(Math.max(duration, 3000), 8000) : 1800;
            _barOkText = msg;
            _barOkUntil = Date.now() + ms;
            setTimeout(syncBarRender, ms + 100);
            if (barVisible) showTop = false;
        }
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

/* ───────── 底部同步状态条（未同步 / 同步中 / 同步失败 / 无网络） ─────────
 * 状态由全局变量“推导”出来（而不是各处手动开关），所以不会出现状态残留或互相覆盖：
 *   同步中 > 失败 > 无网络/未同步 > 刚同步完成（短暂）> 隐藏
 */
function syncBarDerive() {
    const loginVisible = !!$('login-overlay') && !$('login-overlay').classList.contains('d-none');
    if (_barBusy && Date.now() - _barBusy.at > 90000) _barBusy = null;   // 保险：90 秒还没结束就当作已结束
    let s = { state: 'idle', text: '', btn: '', close: false, loginVisible };
    if (_barBusy) s = { ...s, state: 'syncing', text: _barBusy.msg };
    else if (_barError) s = { ...s, state: 'error', text: _barError.msg, btn: _barError.retry ? '重试' : '', close: true };
    else if (currentUser && !offlineMode && hasUnsavedChanges) {
        if (driveIsSyncing) s = { ...s, state: 'syncing', text: '正在同步…' };
        else if (typeof navigator !== 'undefined' && navigator.onLine === false) s = { ...s, state: 'offline', text: '无网络，修改已保存在本机，联网后同步' };
        else s = { ...s, state: 'unsaved', text: '有修改尚未同步', btn: '立即同步' };
    } else if (Date.now() < _barOkUntil) s = { ...s, state: 'ok', text: _barOkText || '已同步' };
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
    setInterval(syncBarRender, 800);   // 兜底：hasUnsavedChanges / driveIsSyncing 等变量被各处直接修改时，也能及时反映
})();
