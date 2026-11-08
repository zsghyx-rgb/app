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
    document.body.classList.toggle('sync-bar-on', s.state !== 'idle' && !s.loginVisible);
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
    window.addEventListener('online', syncBarRender);
    window.addEventListener('offline', syncBarRender);
    setInterval(syncBarRender, 800);   // 兜底：hasUnsavedChanges / driveIsSyncing 等变量被各处直接修改时，也能及时反映
})();
