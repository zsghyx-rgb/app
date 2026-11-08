// @file js/40-draft-drive-sync.js
// 本地草稿自动保存、mergeData 合并、syncToDrive / loadFromDrive、登录后后台同步。

/* ───────── 本地草稿：只存当前用户 + 合并写入 ─────────
 * 旧实现每改一笔都把「整个数据文件」（所有用户 + 全部记录）序列化一遍写进 localStorage，
 * 记录一多，每次编辑都要几十毫秒，列表长了会明显卡。
 * 现在：
 *   ① 只序列化当前用户的数据（其他用户的记录在这次会话里不会变）；
 *   ② 700ms 内的连续改动合并成一次写入（防抖）；
 *   ③ 页面隐藏 / 关闭前强制落盘，保证不丢改动。
 */
const DRAFT_DEBOUNCE_MS = 700;
let _draftTimer = null;

function _buildDraftPayload() {
    const ud = (inMemoryLoadedData.allUserData || {})[currentUserName]
        || { accounts: [], transactions: [], plannedTransactions: [] };
    return {
        __draftV: 2,                        // 2 = 精简草稿（只含当前用户）
        users: dataUsers,
        categories: categories,
        exchangeRates: exchangeRates,
        budgets: budgets,
        categoryIcons: categoryIcons,
        configUpdatedAt: _configUpdatedAt,
        deletedLog: inMemoryLoadedData.deletedLog || [],
        allUserData: { [currentUserName]: ud }
    };
}

function flushDraftNow() {
    if (_draftTimer) { clearTimeout(_draftTimer); _draftTimer = null; }
    if (!hasUnsavedChanges) return;                       // 没有改动就不写，避免同步后又凭空生成“未同步草稿”
    if (!currentUserName || !inMemoryLoadedData) return;
    try {
        saveUserData();
        localStorage.setItem(`APP_local_draft_${currentUserName}`, JSON.stringify(_buildDraftPayload()));
        localStorage.setItem(`APP_local_draft_time_${currentUserName}`, Date.now().toString());
    } catch (e) { /* 容量不足：静默失败，内存数据仍是完整的，同步时会以内存为准 */ }
}

function scheduleDraftSave() {
    if (_draftTimer) clearTimeout(_draftTimer);
    _draftTimer = setTimeout(flushDraftNow, DRAFT_DEBOUNCE_MS);
}

function triggerAutoSave() {
    hasUnsavedChanges = true;
    if (currentUserName) {
        saveUserData();        // 内存立即生效（渲染、同步都读内存）
        scheduleDraftSave();   // 落盘合并成一次
    }
    syncBarRender();
}

window.addEventListener('pagehide', flushDraftNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraftNow(); });

function clearUnsavedFlag() {
    hasUnsavedChanges = false;
    if (_draftTimer) { clearTimeout(_draftTimer); _draftTimer = null; }   // 取消尚未落盘的草稿写入
    try { localStorage.setItem('APP_last_sync_time', String(Date.now())); } catch(_) {}
    
    // 清空 localStorage 中所有用户的本地草稿
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('APP_local_draft_')) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
}

/**
 * 显示 Drive 同步状态徽章
 * state: 'syncing' | 'ok' | 'error'
 */
/**
 * 合并本地数据与远端数据，以 updatedAt 时间戳为准取最新版本
 * 对相同 ID 的记录取 updatedAt 更大的；只有一方有的记录直接保留
 */
function mergeData(local, remote) {
    const mergeArray = (localArr, remoteArr) => {
        const map = new Map();
        // 先放 remote，再用 local 覆盖（若 local 更新）
        (remoteArr || []).forEach(item => map.set(String(item.id), item));
        (localArr || []).forEach(item => {
            const existing = map.get(String(item.id));
            if (!existing) {
                map.set(String(item.id), item);
            } else {
                const itemTs     = item.updatedAt     ?? null;
                const existingTs = existing.updatedAt ?? null;
                if (itemTs === null && existingTs !== null) {
                    // local 没有 updatedAt，remote 有 → 保留 remote（existing）
                    // 不做任何事
                } else if (itemTs !== null && existingTs === null) {
                    // local 有 updatedAt，remote 没有 → 保留 local
                    map.set(String(item.id), item);
                } else {
                    // 两者都有或都没有 updatedAt → 取较大值（local >= remote 则用 local）
                    if ((itemTs || 0) >= (existingTs || 0)) {
                        map.set(String(item.id), item);
                    }
                }
            }
        });
        return Array.from(map.values());
    };

    // ── 合并删除日志（保留窗口见 DELETED_LOG_RETENTION_DAYS：删除记录只在窗口内生效，避免陈旧记录在未来误删"复活"的数据）──
    const now = Date.now();
    const cutoff = now - DELETED_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const localLog = (local.deletedLog || []);
    const remoteLog = (remote.deletedLog || []);
    const logMap = new Map();
    [...localLog, ...remoteLog].forEach(entry => {
        if (entry.deletedAt > cutoff) {
            logMap.set(String(entry.id), entry);
        }
    });
    const mergedDeletedLog = Array.from(logMap.values());
    const deletedIdSet = new Set(mergedDeletedLog.map(e => String(e.id)));

    const merged = {
        users: local.users || remote.users || [],
        categories: local.categories,
        exchangeRates: local.exchangeRates,
        deletedLog: mergedDeletedLog,
        allUserData: {}
    };

    // ── 配置块冲突合并：比较 configUpdatedAt，取较新的那份 ──
    const localConfigTs  = local.configUpdatedAt  || 0;
    const remoteConfigTs = remote.configUpdatedAt || 0;
    if (remoteConfigTs > localConfigTs) {
        merged.categories    = remote.categories    || local.categories;
        merged.exchangeRates = remote.exchangeRates || local.exchangeRates;
        merged.budgets       = remote.budgets       || local.budgets;
        merged.categoryIcons = remote.categoryIcons || local.categoryIcons || {};
        merged.configUpdatedAt = remoteConfigTs;
    } else {
        merged.budgets       = local.budgets       || remote.budgets || [];
        merged.categoryIcons = local.categoryIcons || remote.categoryIcons || {};
        merged.configUpdatedAt = localConfigTs || remoteConfigTs || 0;
    }
    // 确保 categories 和 exchangeRates 有值（local 优先已在上方设置，但以防为 undefined）
    if (!merged.categories) merged.categories = local.categories || remote.categories || { expense: [], income: [] };
    if (!merged.exchangeRates) merged.exchangeRates = local.exchangeRates || remote.exchangeRates || {};

    // 合并每个用户的数据
    const allUsers = new Set([
        ...Object.keys(local.allUserData || {}),
        ...Object.keys((remote && remote.allUserData) || {})
    ]);
    let _mergedTxnTotal = 0;
    allUsers.forEach(u => {
        const localU = (local.allUserData || {})[u] || { accounts: [], transactions: [], plannedTransactions: [] };
        const remoteU = ((remote && remote.allUserData) || {})[u] || { accounts: [], transactions: [], plannedTransactions: [] };
        const mergedTransactions = mergeArray(localU.transactions, remoteU.transactions)
            .filter(t => !deletedIdSet.has(String(t.id))); // 过滤已删除的交易
        _mergedTxnTotal += mergedTransactions.length;
        // accountOrder：优先保留 local 的，local 没有则用 remote 的
        const mergedOrder = localU.accountOrder || remoteU.accountOrder || undefined;
        merged.allUserData[u] = {
            accounts: mergeArray(localU.accounts, remoteU.accounts)
                .filter(a => !deletedIdSet.has(String(a.id))), // 过滤已删除的账户
            transactions: mergedTransactions,
            plannedTransactions: mergeArray(localU.plannedTransactions, remoteU.plannedTransactions),
            ...(mergedOrder ? { accountOrder: mergedOrder } : {})
        };
    });

    // ── 数据完整性统计：供调用方检测"合并后交易数量异常骤降"的情况 ──
    const localTxnTotal  = Object.values(local.allUserData || {}).reduce((s, u) => s + (u.transactions || []).length, 0);
    const remoteTxnTotal = Object.values((remote && remote.allUserData) || {}).reduce((s, u) => s + (u.transactions || []).length, 0);
    merged._mergeStats = {
        localTxnTotal, remoteTxnTotal,
        mergedTxnTotal: _mergedTxnTotal,
        filteredByDeletedLog: mergedDeletedLog.length,
    };

    return merged;
}

/**
 * 同步到 Google 表格（保留原调用入口，实际全部走逐条增量同步）
 */
async function syncToDrive(manual = false, forcePush = false) {
    return incSync(manual, forcePush);
}

/**
 * 从 Google 表格加载（登录界面调用）
 *  - 有本地缓存且未过期：先解缓存，登录后后台增量同步
 *  - 没有缓存 / 缓存过期：输入密码后全量拉取
 */
async function loadFromDrive() {
    const localRawCache = localStorage.getItem('APP_raw_cache');
    const lastSyncTime = parseInt(localStorage.getItem('APP_last_sync_time') || '0', 10);
    const daysSinceSync = lastSyncTime ? (Date.now() - lastSyncTime) / (24 * 60 * 60 * 1000) : Infinity;
    const cacheIsStale = daysSinceSync > STALE_CACHE_DAYS;

    // 离线模式：只用本机缓存（不需要云端连接配置）
    if (offlineMode) {
        if (!localRawCache) {
            showToast('本机还没有缓存，无法离线使用。请先切回在线模式登录一次。', 'warning', 5000);
            $('password-section').style.display = 'none';
            return;
        }
        window._driveMode = true;
        window._driveRawContent = localRawCache;
        window._incPendingInitial = false;
        $('user-section').style.display = 'none';
        $('user-buttons').innerHTML = '';
        $('password-error').classList.add('d-none');
        $('password-section').style.display = 'block';
        $('login-password').focus();
        return;
    }

    if (!cloudConfigured()) {
        uiAlert('请先在登录界面的连接设置里填写 GAS URL 和 Token。');
        return;
    }

    // 有未过期缓存：先让用户用缓存登录，随后后台增量同步
    if (localRawCache && !cacheIsStale) {
        window._driveMode = true;
        window._driveRawContent = localRawCache;
        window._incPendingInitial = false;
        window._pendingBackgroundSync = true;
        $('user-section').style.display = 'none';
        $('user-buttons').innerHTML = '';
        $('password-error').classList.add('d-none');
        $('password-section').style.display = 'block';
        $('login-password').focus();
        if (verboseToast) showToast('请输入密码', 'info', 2000);
        return;
    }

    // 没有缓存 / 缓存过期：输入密码后从云端全量拉取
    window._driveMode = false;
    window._driveRawContent = null;
    window._incPendingInitial = true;
    localStorage.removeItem('APP_sb_state'); // 没有可用缓存 → 状态作废，做全量拉取
    showToast(localRawCache ? `已 ${Math.floor(daysSinceSync)} 天未同步，请输入密码并从云端重新加载` : '请输入密码以从 Google 表格加载数据', 'info', 4000);
    $('user-section').style.display = 'none';
    $('user-buttons').innerHTML = '';
    $('password-error').classList.add('d-none');
    $('password-section').style.display = 'block';
    $('login-password').focus();
}

/** 登录后在后台静默同步（离线模式不执行） */
async function backgroundSyncAfterLogin() {
    if (!window._pendingBackgroundSync || offlineMode) return;
    window._pendingBackgroundSync = false;
    await incBackgroundSync();
}
