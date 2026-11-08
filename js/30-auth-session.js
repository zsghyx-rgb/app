// @file js/30-auth-session.js
// 解密加载数据、登录/登出、新建数据文件、初始化界面、保存用户数据、账户顺序与数据过滤。

/**
 * 使用密码解密缓存或从云端加载
 */
async function decryptAndLoadData() {
    const password = $('login-password').value;
    if (!password) { uiAlert('请输入密码'); return; }

    if (window._incPendingInitial) {
        // 本机没有可用缓存：从 Google 表格全量拉取 → 解密
        incInitialLoad(password);
        return;
    }
    if (window._driveMode && window._driveRawContent) {
        // 本机缓存（加密）→ 解密
        const raw = window._driveRawContent;
        try {
            let data = null;
            try {
                const bytes = CryptoJS.AES.decrypt(raw, password);
                const str = bytes.toString(CryptoJS.enc.Utf8);
                if (str) data = JSON.parse(str);
            } catch (_) {}
            if (!data) {
                $('password-error').classList.remove('d-none');
                $('password-error').textContent = '❌ 密码错误或缓存数据损坏';
                // 离线模式不连接云端，也不清空本机缓存
                if (offlineMode) return;
                const reload = await uiConfirm(
                    '本机缓存无法用这个密码解密。\n\n如果密码已在其他设备上修改，可以清除本机缓存，直接从 Google 表格用新密码重新加载。\n\n云端数据不会被删除。',
                    { title: '缓存无法解密', okText: '清除缓存并重载', cancelText: '取消' }
                );
                if (reload) {
                    localStorage.removeItem('APP_raw_cache');
                    localStorage.removeItem('APP_sb_state');
                    window._driveMode = false;
                    window._driveRawContent = null;
                    incInitialLoad(password);
                }
                return;
            }
            userPassword = password;
            inMemoryLoadedData = data;
            categories = data.categories || DEFAULT_CATEGORIES;
            exchangeRates = data.exchangeRates || DEFAULT_RATES;
            _configUpdatedAt = data.configUpdatedAt || Date.now();
            $('password-error').classList.add('d-none');
            if (verboseToast) showToast('缓存解密成功，请选择用户', 'success', 3000);
            window._driveMode = false;
            window._driveRawContent = null;
            onDataLoaded();
        } catch (e) {
            $('password-error').classList.remove('d-none');
            $('password-error').textContent = '❌ 解析失败：' + e.message;
        }
        return;
    }

    $('password-section').style.display = 'block';
    uiAlert('请先在连接设置里确认已配置 GAS，然后点击「从 Google 表格加载」。');
}

/**
 * 数据加载成功后，显示用户选择按钮
 */
function onDataLoaded() {
    // 记录本次登录时间（用于判断草稿是否过期）
    localStorage.setItem('APP_last_login_time', Date.now().toString());

    // 预算数据：全局共享（不分用户），跟随主数据文件一起加载
    budgets = inMemoryLoadedData.budgets || [];
    categoryIcons = inMemoryLoadedData.categoryIcons || {};

    // 从数据文件读取用户列表（兼容旧格式：只有allUserData没有users字段）
    if (inMemoryLoadedData.users && inMemoryLoadedData.users.length > 0) {
        dataUsers = inMemoryLoadedData.users;
    } else if (inMemoryLoadedData.allUserData) {
        dataUsers = Object.keys(inMemoryLoadedData.allUserData);
    } else {
        dataUsers = [];
    }

    // 确保 allUserData 存在
    if (!inMemoryLoadedData.allUserData) {
        inMemoryLoadedData.allUserData = {};
    }

    // 为每个用户初始化空数据（如果不存在）
    dataUsers.forEach(u => {
        if (!inMemoryLoadedData.allUserData[u]) {
            inMemoryLoadedData.allUserData[u] = { accounts: [], transactions: [], plannedTransactions: [] };
        }
    });

    if (verboseToast) showToast('数据加载成功，请选择用户', 'success', 3000);
    $('user-section').style.display = 'block';

    // 渲染用户按钮
    const container = $('user-buttons');
    container.innerHTML = '';
    if (dataUsers.length === 0) {
        container.innerHTML = '<span class="text-danger small">账本中没有用户，请新建空账本。</span>';
        return;
    }
    dataUsers.forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-outline-primary flex-fill py-2 fw-bold';
        btn.textContent = name;
        btn.onclick = () => loginWithUser(name);
        container.appendChild(btn);
    });

    // 自动登录：如果上次登录的用户仍在列表中，直接登录
    try {
        const lastUser = localStorage.getItem('APP_last_user');
        if (lastUser && dataUsers.includes(lastUser) && !window._suppressAutoLogin) {
            setTimeout(() => loginWithUser(lastUser), 300);
        }
    } catch(_) {}
    window._suppressAutoLogin = false;
}

/**
 * 新建空账本（首次使用或云端还没有数据时）
 */
async function createNewDataFile() {
    if (offlineMode) { uiAlert('离线模式下不能新建空账本，请先切换到在线模式。'); return; }
    // 现在所有数据都在同一张 records 表格里，“空账本”只用于首次初始化。
    // 云端已有数据时绝不能再建空账本，否则同步会用大量删除覆盖现有数据。
    if (cloudConfigured()) {
        try {
            const r = await sheetCall({ action: 'pull', since: 0, limit: 1 });
            if (r && Array.isArray(r.rows) && r.rows.length > 0) {
                uiAlert('云端已经有账本数据，不能在这里新建空账本。\n\n如果确实要重新开始，请先在 Google 表格中备份并清空 records 表格。');
                return;
            }
        } catch (e) {
            uiAlert('无法检查云端数据：' + e.message + '\n\n请确认网络和 GAS 配置后再试。');
            return;
        }
    }

    const usersInput = await uiPrompt('输入用户名（多个用英文逗号分隔）：', { title: '新建空账本', input: { value: 'abc,def', placeholder: 'abc,def' } });
    if (!usersInput) return;

    const users = usersInput.split(',').map(u => u.trim()).filter(u => u.length > 0);
    if (users.length === 0) { uiAlert('至少需要一个用户'); return; }

    const pwd = await uiPrompt('设置数据加密密码：', { title: '设置密码', input: { type: 'password', placeholder: '至少 8 位' } });
    if (!pwd) return;
    const pwdConfirm = await uiPrompt('再次确认密码：', { title: '确认密码', input: { type: 'password' } });
    if (pwd !== pwdConfirm) { uiAlert('两次密码不一致，请重试'); return; }

    const allUserData = {};
    users.forEach(u => {
        allUserData[u] = { accounts: [], transactions: [], plannedTransactions: [] };
    });

    inMemoryLoadedData = {
        users: users,
        allUserData: allUserData,
        categories: DEFAULT_CATEGORIES,
        exchangeRates: {...DEFAULT_RATES},
        configUpdatedAt: Date.now(),
    };

    categories = DEFAULT_CATEGORIES;
    exchangeRates = DEFAULT_RATES;
    _configUpdatedAt = inMemoryLoadedData.configUpdatedAt;
    userPassword = pwd;
    dataUsers = users;

    if (verboseToast) showToast('空账本已创建，请选择用户', 'success', 3000);
    window._pendingBackgroundSync = true;   // 登录后自动把空账本写入云端
    $('password-section').style.display = 'none';
    onDataLoaded();
}

/**
 * 用户登录
 */
function loginWithUser(name) {
    if (!inMemoryLoadedData) { uiAlert('请先加载账本数据'); return; }

    currentUser = { name: name };
    currentUserName = name;
    // 记录本设备最近登录的用户
    try { localStorage.setItem('APP_last_user', name); } catch(_) {}

    $('login-overlay').classList.add('d-none');
    $('app-wrapper').classList.remove('d-none');

    const initial = name.charAt(0).toLowerCase();
    document.querySelector('.user-name-full').innerText = name;
    document.querySelector('.user-name-short').innerText = initial;
    $('mobile-current-user').innerText = name;
    renderSettingsUserCard();

    loadAllData();
    filterUserData();
    // 记录本次登录时已知的交易快照（ID + updatedAt，用于标注新同步/修改数据）
    try {
        const knownMap = {};
        transactions.forEach(t => { knownMap[t.id] = t.updatedAt ?? 0; });
        sessionStorage.setItem('knownTxnMap_' + name, JSON.stringify(knownMap));
    } catch(_) {}
    initAppUI();

    // 初始 tab = 交易页，仅手机端显示悬浮按钮
    const fabInit = $('mobile-fab-group');
    if (fabInit && window.innerWidth <= 768) fabInit.classList.remove('d-none');

    // 更新离线模式状态显示
    const badge = $('offline-mode-badge');
    if (badge) badge.style.display = offlineMode ? '' : 'none';
    const statusEl = $('sync-mode-status');
    if (statusEl) statusEl.textContent = offlineMode ? '离线模式' : '在线模式';

    // 检查是否有本地未同步草稿，有则合并恢复
    checkAndRestoreDraft(name);

    // 离线优先：后台静默同步（有新版本时合并刷新UI）
    setTimeout(() => backgroundSyncAfterLogin(), 300);
}

/**
 * 进入主界面后检查所有用户的本地草稿
 * 当前用户的草稿：合并 + 刷新 UI + toast 提示
 * 其他用户的草稿：静默合并数据 + toast 提示（不影响当前用户视图）
 */
function checkAndRestoreDraft(userName) {
    // 扫描 localStorage 找出所有用户的草稿 key
    const allDraftUsers = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('APP_local_draft_') && !key.includes('_time_')) {
            const draftUser = key.replace('APP_local_draft_', '');
            allDraftUsers.push(draftUser);
        }
    }

    if (allDraftUsers.length === 0) return;

    let needsUIRefresh = false;

    allDraftUsers.forEach(draftUser => {
        const draftKey = `APP_local_draft_${draftUser}`;
        const timeKey  = `APP_local_draft_time_${draftUser}`;
        const draftStr  = localStorage.getItem(draftKey);
        const draftTime = localStorage.getItem(timeKey);
        if (!draftStr || !draftTime) return;

        try {
            const draft = JSON.parse(draftStr);
            // 草稿作为 local，当前内存数据作为 remote，按 updatedAt 取最新
            inMemoryLoadedData = mergeData(draft, inMemoryLoadedData);
            _configUpdatedAt = inMemoryLoadedData.configUpdatedAt || Date.now();
            hasUnsavedChanges = true;

            const timeStr = new Date(parseInt(draftTime))
                .toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

            if (draftUser === userName) {
                // 当前用户：需要刷新 UI
                needsUIRefresh = true;
                showToast(`已恢复 ${timeStr} 的本地未同步记录`, 'warning', 6000);
            } else {
                // 其他用户：数据已合并，仅提示
                showToast(`已恢复 [${draftUser}] ${timeStr} 的本地未同步记录`, 'warning', 6000);
            }
        } catch(e) {
            // 草稿损坏，直接清除，不影响主流程
            localStorage.removeItem(draftKey);
            localStorage.removeItem(timeKey);
        }
    });

    if (needsUIRefresh) {
        loadAllData();
        filterUserData();
        renderAccounts();
        renderAllTransactions();
    }
}


/**
 * 登出
 */
async function logout() {
    if (hasUnsavedChanges) {
        const ok = await uiConfirm('有未保存的更改，确定退出吗？\n\n（改动会先保存在本机草稿里，下次登录时自动恢复）', { title: '退出登录', okText: '退出', danger: true });
        if (!ok) return;
    }
    flushDraftNow();
    location.reload();
}

function initAppUI() {
    renderAccounts();

    // 恢复交易页用户筛选（已保存的值需校验是否仍有效；否则默认当前用户）
    const savedTransUser = localStorage.getItem('APP_trans_user_filter');
    const validUsers = ['all', ...dataUsers];
    currentUserFilterValue = (savedTransUser && validUsers.includes(savedTransUser))
        ? savedTransUser
        : currentUserName;
    updateUserFilterBtn();

    // 恢复收支/转账显示模式
    const savedMode = localStorage.getItem('APP_trans_display_mode');
    if (savedMode && ['all', 'transactions', 'transfers'].includes(savedMode)) {
        transactionDisplayMode = savedMode;
    } else {
        transactionDisplayMode = 'all';
    }
    updateTransferModeButton();

    $('filter-start-date').value = '';
    $('filter-end-date').value = '';

    if ($('stats-start-date')) {
        // 默认显示当前月份
        const now = new Date();
        statsNavYear  = now.getFullYear();
        statsNavMonth = now.getMonth();
        statsNavMode  = 'month';
        const mStart = new Date(statsNavYear, statsNavMonth, 1);
        const mEnd   = new Date(statsNavYear, statsNavMonth + 1, 0);
        const mStartStr = formatLocal(mStart);
        const mEndStr   = formatLocal(mEnd);
        $('stats-start-date').value = mStartStr;
        $('stats-end-date').value   = mEndStr;
        currentStatsFilter.startDate = mStartStr;
        currentStatsFilter.endDate   = mEndStr;
        updateStatsNavUI();
    }

    // 恢复统计页货币（renderStatsCurrencyButtons 内部会校验账户是否有效）
    const savedCurrency = localStorage.getItem('APP_stats_currency');
    if (savedCurrency) currentStatsFilter.currency = savedCurrency;

    // 恢复统计页用户筛选
    const savedStatsUser = localStorage.getItem('APP_stats_user');
    if (savedStatsUser && validUsers.includes(savedStatsUser)) {
        currentStatsFilter.user = savedStatsUser;
    } else {
        currentStatsFilter.user = 'all';
    }

    const today = new Date();
    const plannedStartDate = $('planned-start-date');
    if (plannedStartDate) plannedStartDate.valueAsDate = today;

    renderAllTransactions();
    renderCategorySettings();
    updateSelectOptions();
    renderStats();

    renderExchangeRateSettings();
}

function loadAllData() {
    accounts = [];
    transactions = [];
    plannedTransactions = [];

    dataUsers.forEach(u => {
        const uData = inMemoryLoadedData.allUserData[u];
        if (uData) {
            accounts.push(...(uData.accounts || []).map(a => ({...a, ownerName: u})));
            transactions.push(...(uData.transactions || []).map(t => ({...t, ownerName: u})));
            if (uData.plannedTransactions) {
                plannedTransactions.push(...uData.plannedTransactions.map(p => ({...p, ownerName: u})));
            }
        }
    });

}

function saveUserData() {
    if (!currentUser) return;
    dataUsers.forEach(u => {
        // 保留已有的 accountOrder，不覆盖
        const prevOrder = (inMemoryLoadedData.allUserData[u] || {}).accountOrder;
        inMemoryLoadedData.allUserData[u] = {
            accounts: accounts.filter(a => a.ownerName === u),
            transactions: transactions.filter(t => t.ownerName === u),
            plannedTransactions: plannedTransactions.filter(p => p.ownerName === u),
            ...(prevOrder ? { accountOrder: prevOrder } : {})
        };
    });
    inMemoryLoadedData.users = dataUsers;
    inMemoryLoadedData.categories = categories;
    inMemoryLoadedData.exchangeRates = exchangeRates;
    inMemoryLoadedData.budgets = budgets;
    inMemoryLoadedData.categoryIcons = categoryIcons;
    inMemoryLoadedData.configUpdatedAt = _configUpdatedAt;
}

/** 获取当前用户的账户顺序数组，不存在则返回 null */
function getAccountOrder() {
    return (inMemoryLoadedData.allUserData[currentUserName] || {}).accountOrder || null;
}

/** 保存账户顺序并触发同步 */
function saveAccountOrder(idArray) {
    if (!inMemoryLoadedData.allUserData[currentUserName]) return;
    inMemoryLoadedData.allUserData[currentUserName].accountOrder = idArray;
    triggerAutoSave();
}

/** 按 accountOrder 对账户数组排序（不在列表里的追加到末尾） */
function sortedUserAccounts(accs) {
    const order = getAccountOrder();
    if (!order || order.length === 0) return accs;
    const idxMap = {};
    order.forEach((id, i) => { idxMap[String(id)] = i; });
    return [...accs].sort((a, b) => {
        const ia = idxMap[String(a.id)] ?? 9999;
        const ib = idxMap[String(b.id)] ?? 9999;
        return ia - ib;
    });
}

function filterUserData() {
    userAccounts = accounts.filter(a => a.ownerName === currentUserName);
    userTransactions = transactions.filter(t => t.ownerName === currentUserName);
    userPlannedTransactions = plannedTransactions.filter(p => p.ownerName === currentUserName);
}
