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
    userPins = inMemoryLoadedData.userPins || {};

    // 确保 allUserData 存在
    if (!inMemoryLoadedData.allUserData) {
        inMemoryLoadedData.allUserData = {};
    }

    // 用户列表（5.1.5）：配置文件里的用户 ∪ 数据桶里的名字。
    // 以前只认 users 字段，一旦这份列表被别的设备的旧配置覆盖，桶里的数据就整体“消失”了；
    // 现在桶里有数据就一定能显示出来（removedUsers 里的名字只是不再显示，除非它还有数据）。
    const removed = inMemoryLoadedData.removedUsers || {};
    const names = [], seenName = new Set();
    const pushName = (u, force) => {
        if (typeof u !== 'string' || !u || seenName.has(u)) return;
        if (!force && Number(removed[u]) > 0) return;   // 正数 = 已删除；负数 = 重新添加过
        seenName.add(u); names.push(u);
    };
    (inMemoryLoadedData.users || []).forEach(u => pushName(u));
    Object.keys(inMemoryLoadedData.allUserData).forEach(u => {
        const ud = inMemoryLoadedData.allUserData[u] || {};
        const hasData = (ud.accounts && ud.accounts.length) ||
                        (ud.transactions && ud.transactions.length) ||
                        (ud.plannedTransactions && ud.plannedTransactions.length);
        pushName(u, !!hasData);
    });
    dataUsers = names;

    // 为每个用户初始化空数据（如果不存在）
    dataUsers.forEach(u => {
        if (!inMemoryLoadedData.allUserData[u]) {
            inMemoryLoadedData.allUserData[u] = { accounts: [], transactions: [], plannedTransactions: [] };
        }
    });

    if (verboseToast) showToast('数据加载成功，请选择用户', 'success', 3000);
    $('user-section').style.display = 'block';

    // 渲染用户按钮：只显示最近 7 天在本设备登录过的用户，其他用户折叠起来
    renderLoginUserList();

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
    if (typeof recordRecentLoginUser === 'function') recordRecentLoginUser(name);

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

    // 首次登录该用户时提示设置 PIN（可跳过）；随后检查进入提醒。
    // 需要后台同步时，提醒会等同步结束再检查，避免用过期的本机缓存判断。
    window._entryReminderWillSync = !!window._pendingBackgroundSync && !offlineMode;
    if (typeof resetEntryReminders === 'function') resetEntryReminders();
    if (typeof maybePromptPinSetup === 'function') {
        maybePromptPinSetup(name).then(() => {
            if (typeof scheduleEntryReminders === 'function') scheduleEntryReminders();
        });
    } else if (typeof scheduleEntryReminders === 'function') {
        scheduleEntryReminders();
    }

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
            // 草稿里的 PIN 可能比内存中的新，合并后同步到全局变量
            userPins = inMemoryLoadedData.userPins || userPins || {};
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

    const plannedStartDate = $('planned-start-date');
    // 用本地日期字符串：valueAsDate 按 UTC 换算，东八区凌晨会填成“昨天”
    if (plannedStartDate) plannedStartDate.value = formatLocal(new Date());

    renderAllTransactions();
    renderCategorySettings();
    updateSelectOptions();
    renderStats();

    renderExchangeRateSettings();
}

/** 本机账本里“应该出现的用户名”：用户列表 ∪ 数据桶名（顺序：先用户列表，再补桶名） */
function bookUserNames() {
    const out = [], seen = new Set();
    const add = u => { if (typeof u === 'string' && u && !seen.has(u)) { seen.add(u); out.push(u); } };
    (dataUsers || []).forEach(add);
    Object.keys((inMemoryLoadedData && inMemoryLoadedData.allUserData) || {}).forEach(add);
    return out;
}

/** 按 id 去重：同一 id 只保留一份（同步层是按 id 全局唯一的）。
 *  归属冲突时保留 updatedAt 较新的；时间相同则保留用户列表里更靠前的那份。 */
function _pickWinner(map, id, ts, idx) {
    const cur = map.get(id);
    if (!cur) { map.set(id, { ts: ts, idx: idx }); return true; }
    if (ts > cur.ts || (ts === cur.ts && idx < cur.idx)) { map.set(id, { ts: ts, idx: idx }); return true; }
    return false;
}

function loadAllData() {
    accounts = [];
    transactions = [];
    plannedTransactions = [];

    const users = bookUserNames();
    const uIndex = {};
    users.forEach((u, i) => { uIndex[u] = i; });

    // 第一遍：算出每个 id 的“归属赢家”
    const winners = { accounts: new Map(), transactions: new Map(), plannedTransactions: new Map() };
    users.forEach(u => {
        const uData = inMemoryLoadedData.allUserData[u];
        if (!uData) return;
        const idx = uIndex[u] === undefined ? 9999 : uIndex[u];
        ['accounts', 'transactions', 'plannedTransactions'].forEach(kind => {
            (uData[kind] || []).forEach(rec => {
                if (rec == null || rec.id == null) return;
                _pickWinner(winners[kind], String(rec.id), Number(rec.updatedAt) || 0, idx);
            });
        });
    });

    // 第二遍：按顺序装载，非赢家（跨桶重复的那份）直接丢掉
    const emitted = { accounts: new Set(), transactions: new Set(), plannedTransactions: new Set() };
    users.forEach(u => {
        const uData = inMemoryLoadedData.allUserData[u];
        if (!uData) return;
        const myIdx = uIndex[u] === undefined ? 9999 : uIndex[u];
        const take = (kind, rec) => {
            if (rec == null || rec.id == null) return false;
            const id = String(rec.id);
            if (emitted[kind].has(id)) return false;
            const w = winners[kind].get(id);
            if (!w || w.idx !== myIdx) return false;
            emitted[kind].add(id);
            return true;
        };
        (uData.accounts || []).forEach(a => { if (take('accounts', a)) accounts.push({ ...a, ownerName: u }); });
        (uData.transactions || []).forEach(t => { if (take('transactions', t)) transactions.push({ ...t, ownerName: u }); });
        if (uData.plannedTransactions) {
            uData.plannedTransactions.forEach(p => { if (take('plannedTransactions', p)) plannedTransactions.push({ ...p, ownerName: u }); });
        }
    });
    // 5.1.9：界面数组此刻与内存一致，记下版本和“已知记录”，供 saveUserData 对账用
    _globalsVersion = _memVersion;
    _recordGlobalsKnown();
}

/* ═══ 5.1.9：内存数据（inMemoryLoadedData）↔ 界面数组（accounts / transactions / plannedTransactions）对账 ═══
 * 背景：同步层把云端新数据写进内存，界面数组要等刷新才更新；这期间 saveUserData() 若用旧数组整体覆盖内存，
 *      拉到的记录就丢了，而同步进度已前进，随后又被当成“本机删除”发墓碑到云端（5.1.6 事故的根因）。
 * 规则：
 *   1. 同步层每次改内存都调用 memTouched()（_memVersion +1）；loadAllData / saveUserData 完成时令 _globalsVersion = _memVersion。
 *   2. saveUserData 发现两个版本不一致，先 reconcileGlobalsFromMemory()（按 id 三方合并），再写回。
 *   3. 写回时对比前后的 id 集合：消失的登记为“显式删除”（pendingDeletes），重新出现的（撤销）移除。
 *      墓碑只来自显式删除；本机缺失但没有登记的记录，同步时从云端取回（见 20-cloud-sync.js 的 incDiffLocal / incSyncCore）。 */
let _memVersion = 0;
let _globalsVersion = 0;
const _REC_KINDS = ['accounts', 'transactions', 'plannedTransactions'];
let _globalsKnown = { accounts: new Map(), transactions: new Map(), plannedTransactions: new Map() };   // id -> updatedAt（界面数组上次与内存一致时）

function memTouched() { _memVersion++; }

function _recordGlobalsKnown() {
    const src = { accounts: accounts, transactions: transactions, plannedTransactions: plannedTransactions };
    _REC_KINDS.forEach(kind => {
        const m = new Map();
        (src[kind] || []).forEach(r => { if (r && r.id != null) m.set(String(r.id), Number(r.updatedAt) || 0); });
        _globalsKnown[kind] = m;
    });
}

function _memRecordIds() {
    const set = new Set();
    const all = (inMemoryLoadedData && inMemoryLoadedData.allUserData) || {};
    Object.values(all).forEach(ud => {
        if (!ud) return;
        _REC_KINDS.forEach(kind => (ud[kind] || []).forEach(r => { if (r && r.id != null) set.add(String(r.id)); }));
    });
    return set;
}

/* 显式删除登记：本机私有、持久化（localStorage），不进同步数据 */
const PENDING_DEL_KEY = 'APP_pending_deletes';
let _pendingDeletes = null;
function pendingDeletesGet() {
    if (_pendingDeletes) return _pendingDeletes;
    try { const o = JSON.parse(localStorage.getItem(PENDING_DEL_KEY) || 'null'); _pendingDeletes = (o && typeof o === 'object') ? o : {}; }
    catch (_) { _pendingDeletes = {}; }
    return _pendingDeletes;
}
function pendingDeletesSave() {
    try { localStorage.setItem(PENDING_DEL_KEY, JSON.stringify(_pendingDeletes || {})); } catch (e) { console.warn('[pd] 保存失败', e); }
}
function pendingDeletesClear() {
    _pendingDeletes = {};
    try { localStorage.removeItem(PENDING_DEL_KEY); } catch (_) {}
}
/** 墓碑允许的“显式删除”证据：pendingDeletes ∪ 近期 deletedLog（兼容升级前已经删除、还没推送的记录） */
function explicitDeleteIds() {
    const set = new Set(Object.keys(pendingDeletesGet()));
    const log = (inMemoryLoadedData && inMemoryLoadedData.deletedLog) || [];
    log.forEach(e => { if (e && e.id != null) set.add(String(e.id)); });
    return set;
}
function pendingDeletesForget(ids) {
    const pd = pendingDeletesGet(); let n = 0;
    (ids || []).forEach(id => { if (pd[String(id)] !== undefined) { delete pd[String(id)]; n++; } });
    if (n) pendingDeletesSave();
}
function _registerDeletions(before, after) {
    const pd = pendingDeletesGet(); let dirty = false; const now = Date.now();
    before.forEach(id => { if (!after.has(id) && pd[id] === undefined) { pd[id] = now; dirty = true; } });
    if (Object.keys(pd).length) after.forEach(id => { if (pd[id] !== undefined) { delete pd[id]; dirty = true; } });
    if (dirty) pendingDeletesSave();
}

/** 三方合并：把“同步已写入内存、界面数组还没跟上”的变化并进界面数组（只在版本不一致时调用） */
function reconcileGlobalsFromMemory() {
    const mem = inMemoryLoadedData;
    if (!mem || !mem.allUserData) return;
    const users = bookUserNames();
    const cur = { accounts: accounts, transactions: transactions, plannedTransactions: plannedTransactions };
    const next = {};
    _REC_KINDS.forEach(kind => {
        // 内存侧：id -> {rec, owner}（跨桶重复取 updatedAt 大的，平手取靠前的用户，与 loadAllData 一致）
        const memMap = new Map();
        users.forEach(u => {
            const ud = mem.allUserData[u]; if (!ud) return;
            (ud[kind] || []).forEach(rec => {
                if (rec == null || rec.id == null) return;
                const id = String(rec.id), c = memMap.get(id);
                if (!c || (Number(rec.updatedAt) || 0) > (Number(c.rec.updatedAt) || 0)) memMap.set(id, { rec, owner: u });
            });
        });
        const known = _globalsKnown[kind] || new Map();
        const out = [], seen = new Set();
        (cur[kind] || []).forEach(g => {
            if (g == null || g.id == null) return;
            const id = String(g.id); seen.add(id);
            const m = memMap.get(id);
            if (!m) {
                // 内存里没有：界面新建的 → 留；界面上次已知、现在内存没了（远端删除）→ 丢，除非本机之后又改过
                if (!known.has(id) || (Number(g.updatedAt) || 0) > known.get(id)) out.push(g);
                return;
            }
            // 内存里有：内存版本更新（同步拉到的）→ 采用；否则保留界面上的（本机改动）
            if ((Number(m.rec.updatedAt) || 0) > (Number(g.updatedAt) || 0)) out.push({ ...m.rec, ownerName: m.owner });
            else out.push(g);
        });
        memMap.forEach((m, id) => {
            if (seen.has(id)) return;
            if (known.has(id)) return;            // 界面上次已知、本机删掉了 → 不复活
            out.push({ ...m.rec, ownerName: m.owner });   // 同步新拉到的
        });
        next[kind] = out;
    });
    accounts = next.accounts; transactions = next.transactions; plannedTransactions = next.plannedTransactions;
    // 配置：内存里的配置更新（同步拉到的）就采用，否则保留界面上的（本机刚改的）
    if ((Number(mem.configUpdatedAt) || 0) > (Number(_configUpdatedAt) || 0)) {
        if (mem.categories) categories = mem.categories;
        if (mem.exchangeRates) exchangeRates = mem.exchangeRates;
        if (mem.budgets) budgets = mem.budgets;
        if (mem.categoryIcons) categoryIcons = mem.categoryIcons;
        if (mem.userPins) userPins = mem.userPins;
        if (mem.users && mem.users.length) dataUsers = mem.users;
        _configUpdatedAt = mem.configUpdatedAt;
    }
}

function saveUserData() {
    if (!currentUser) return;
    // 5.1.9：同步刚往内存里写过东西、界面数组还没跟上 → 先对账，绝不能用旧数组覆盖掉同步拉到的数据
    if (_globalsVersion !== _memVersion) reconcileGlobalsFromMemory();
    const idsBefore = _memRecordIds();
    // 回写范围 = 用户列表 ∪ 数据桶名，保证“桶里有数据但不在用户列表”的记录不会被写丢
    bookUserNames().forEach(u => {
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
    inMemoryLoadedData.userPins = userPins || {};
    inMemoryLoadedData.categories = categories;
    inMemoryLoadedData.exchangeRates = exchangeRates;
    inMemoryLoadedData.budgets = budgets;
    inMemoryLoadedData.categoryIcons = categoryIcons;
    inMemoryLoadedData.configUpdatedAt = _configUpdatedAt;
    // 5.1.9：写回前内存里有、写回后没有的 = 用户显式删除，登记后才会向云端发墓碑；重新出现的（撤销）从登记里移除
    _registerDeletions(idsBefore, _memRecordIds());
    _globalsVersion = _memVersion;
    _recordGlobalsKnown();
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
