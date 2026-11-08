// @file js/25-login-settings.js
// 登录页设置：GAS 地址/令牌、离线模式、切换用户、版本号显示、启动时自动加载云端。

function toggleLoginSettings() {
    const panel = $('login-settings-panel');
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? 'block' : 'none';
    $('login-settings-gear').className = isHidden ? 'bi bi-gear-fill text-primary' : 'bi bi-gear';
    if (isHidden) initLoginSettingsUI();
}

function initLoginSettingsUI() {
    initGasUrlUI();
    initGasTokenUI();
}

function initGasUrlUI() {
    const saved = localStorage.getItem('APP_gas_url') || '';
    if (saved) {
        $('gas-url-saved-bar').style.removeProperty('display');
        $('gas-url-input-bar').style.display = 'none';
    } else {
        $('gas-url-saved-bar').style.display = 'none';
        $('gas-url-input-bar').style.removeProperty('display');
    }
}

function showGasUrlInput() {
    $('gas-url-saved-bar').style.display = 'none';
    $('gas-url-input-bar').style.removeProperty('display');
    const input = $('gas-url-input');
    input.value = localStorage.getItem('APP_gas_url') || '';
    input.focus();
}

function saveGasUrl() {
    const val = $('gas-url-input').value.trim();
    if (!val || !val.startsWith('https://script.google.com')) {
        uiAlert('请输入有效的 GAS Web App URL（以 https://script.google.com 开头）');
        return;
    }
    localStorage.setItem('APP_gas_url', val);
    GAS_URL = val;
    initGasUrlUI();
    if (GAS_TOKEN && !offlineMode) loadFromDrive();
}

function initGasTokenUI() {
    const saved = localStorage.getItem('APP_gas_token') || '';
    if (saved) {
        $('gas-token-saved-bar').style.removeProperty('display');
        $('gas-token-input-bar').style.display = 'none';
    } else {
        $('gas-token-saved-bar').style.display = 'none';
        $('gas-token-input-bar').style.removeProperty('display');
    }
}

function showGasTokenInput() {
    $('gas-token-saved-bar').style.display = 'none';
    $('gas-token-input-bar').style.removeProperty('display');
    const input = $('gas-token-input');
    input.value = localStorage.getItem('APP_gas_token') || '';
    input.focus();
}

function saveGasToken() {
    const val = $('gas-token-input').value.trim();
    if (!val) { uiAlert('请输入 Token'); return; }
    localStorage.setItem('APP_gas_token', val);
    GAS_TOKEN = val;
    initGasTokenUI();
    if (GAS_URL && !offlineMode) loadFromDrive();   // URL 和 Token 都齐了：立刻加载
}

function initOfflineModeUI() {
    const btn = $('offline-mode-btn');
    const offlineBar = $('offline-file-bar');
    const onlineBar = $('online-drive-bar');
    if (!btn) return;
    if (offlineMode) {
        btn.className = 'btn btn-sm btn-warning';
        btn.innerHTML = '<i class="bi bi-wifi-off"></i> 离线模式';
        if (offlineBar) offlineBar.style.display = '';
        if (onlineBar) onlineBar.style.display = 'none';
    } else {
        btn.className = 'btn btn-sm btn-outline-secondary';
        btn.innerHTML = '<i class="bi bi-wifi"></i> 在线模式';
        if (offlineBar) offlineBar.style.display = 'none';
        if (onlineBar) onlineBar.style.display = '';
    }
    // 更新应用内状态指示
    const statusEl = $('sync-mode-status');
    if (statusEl) statusEl.textContent = offlineMode ? '离线模式' : '在线模式';
}

function toggleOfflineMode() {
    offlineMode = !offlineMode;
    localStorage.setItem('APP_offline_mode', offlineMode ? 'true' : 'false');
    initOfflineModeUI();

    // 切换数据来源时先清空当前会话，再从缓存或云端重新加载
    window._driveMode = false;
    window._driveRawContent = null;
    window._incPendingInitial = false;
    window._pendingBackgroundSync = false;
    inMemoryLoadedData = null;
    _configUpdatedAt = Date.now();
    userPassword = ''; dataUsers = [];
    accounts = []; transactions = []; plannedTransactions = [];
    userAccounts = []; userTransactions = []; userPlannedTransactions = [];
    const pwdInput = $('login-password');
    if (pwdInput) pwdInput.value = '';
    const errEl = $('password-error');
    if (errEl) errEl.classList.add('d-none');
    $('user-buttons').innerHTML = '';
    $('user-section').style.display = 'none';
    $('password-section').style.display = 'none';

    if (offlineMode) {
        showToast('已切换离线模式：将使用本机缓存', 'info', 3000);
        loadFromDrive();
    } else if (cloudConfigured()) {
        showToast('已切换在线模式', 'info', 2000);
        loadFromDrive();
    }
}


/** 收起登录页的连接设置面板（回到登录界面时调用，保证每次都是关闭状态） */
function closeLoginSettings() {
    const panel = $('login-settings-panel');
    if (panel) panel.style.display = 'none';
    const gear = $('login-settings-gear');
    if (gear) gear.className = 'bi bi-gear';
}

async function switchUser() {
    if (hasUnsavedChanges) {
        const ok = await uiConfirm('有未保存的更改，仍要切换用户吗？\n\n（改动会先保存在本机草稿里，下次登录该用户时自动恢复）', { title: '切换用户', okText: '切换' });
        if (!ok) return;
        flushDraftNow();
    }
    currentUser = null;
    currentUserName = null;
    hasUnsavedChanges = false;
    clearTimeout(driveAutoSaveTimer);

    $('app-wrapper').classList.add('d-none');
    $('login-overlay').classList.remove('d-none');
    closeLoginSettings();

    if (inMemoryLoadedData) {
        window._suppressAutoLogin = true;  // 手动切换时不自动选用户
        onDataLoaded();
        if (verboseToast) showToast('数据已就绪，请选择用户', 'success', 3000);
    }
}

function _applyAppVersion() {
    const titleEl = $('app-title');
    if (titleEl) titleEl.textContent = `记一笔 v${APP_VERSION}`;
    const sidebarEl = $('sidebar-version');
    if (sidebarEl) sidebarEl.textContent = `version ${APP_VERSION}`;
    const settingsEl = $('settings-version');
    if (settingsEl) settingsEl.textContent = `v${APP_VERSION}`;
}

document.addEventListener('DOMContentLoaded', () => {
    _applyAppVersion();
    initOfflineModeUI();

    // 在线模式且已配置云端（GAS）则自动加载
    if (!offlineMode && cloudConfigured()) {
        loadFromDrive();
    }
});
