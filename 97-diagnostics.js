// @file js/97-diagnostics.js
// 账本自检与数据修复：
//  - 自检：多设备数字对不上时，列出用户/数据桶/同步状态，并顺手合并本机重复记录
//  - 从云端重建本机数据
//  - 用本机数据覆盖云端；恢复云端“已删除但本机没有”的记录

/** 收集一份可读的自检报告（纯数据，便于贴到聊天/控制台） */
function jibiSelfCheck() {
    const d = inMemoryLoadedData || {};
    const users = (d.users || []).slice();
    const buckets = Object.keys(d.allUserData || {});
    const kinds = { accounts: 'accounts', transactions: 'transactions', plannedTransactions: 'plannedTransactions' };

    // 1) 跨桶重复：同一个 id 同时出现在两个用户的桶里（转账改了转入账户、用户改名都会造成）
    const seen = new Map();
    const dups = [];
    buckets.forEach(b => Object.keys(kinds).forEach(key => {
        (((d.allUserData[b] || {})[key]) || []).forEach(r => {
            if (!r || r.id == null) return;
            const k = key + ':' + String(r.id);
            if (seen.has(k)) dups.push({ 记录: k, 出现位置: seen.get(k) + ' 和 ' + b });
            else seen.set(k, b);
        });
    }));
    const dupIds = new Set();
    dups.forEach(x => dupIds.add(x.记录.split(':')[1]));

    // 2) 孤立数据桶：有数据但不在用户列表里
    const orphanBuckets = buckets.filter(b => {
        if (users.indexOf(b) >= 0) return false;
        const ud = d.allUserData[b] || {};
        return (ud.accounts || []).length || (ud.transactions || []).length || (ud.plannedTransactions || []).length;
    });

    // 3) 账户余额 + 该账户下有多少笔重复流水
    const bal = {};
    (typeof accounts !== 'undefined' ? accounts : []).forEach(a => {
        const list = (transactions || []).filter(t => String(t.accountId) === String(a.id));
        const won = list.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        bal[a.name + '（' + a.ownerName + '）'] = {
            余额: Math.round(((Number(a.initialBalance) || 0) + won) * 100) / 100,
            流水笔数: list.length,
            重复id流水: list.filter(t => dupIds.has(String(t.id))).length
        };
    });

    // 4) 本月支出：全部用户 vs 当前用户（统计页默认“全部”，交易页只看“当前”）
    const monthSpend = u => {
        const n = new Date();
        const s = new Date(n.getFullYear(), n.getMonth(), 1);
        const e = new Date(n.getFullYear(), n.getMonth() + 1, 0);
        const f = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
        let total = 0;
        (transactions || []).forEach(t => {
            if (t.isTransfer || t._isBaseline || Number(t.amount) >= 0) return;
            if (t.date < f(s) || t.date > f(e)) return;
            if (u !== 'all' && t.ownerName !== u) return;
            total += Math.abs(Number(t.amount) || 0);
        });
        return Math.round(total * 100) / 100;
    };

    // 5) 同步状态
    let state = null;
    try { state = JSON.parse(localStorage.getItem('APP_sb_state') || 'null'); } catch (_) {}

    return {
        版本: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?'),
        当前用户: currentUserName || '（未登录）',
        用户列表: users,
        数据桶: buckets,
        有数据但不在用户列表: orphanBuckets,
        跨桶重复记录: dups,
        各账户余额: bal,
        本月支出_全部用户: monthSpend('all'),
        本月支出_当前用户: monthSpend(currentUserName || 'all'),
        配置文件时间戳: d.configUpdatedAt || 0,
        已删除用户标记: Object.keys(d.removedUsers || {}).filter(u => Number(d.removedUsers[u]) > 0),
        同步序号: state ? state.lastSeq : null,
        已同步记录数: state && state.synced ? Object.keys(state.synced).length : 0
    };
}

/** 设置页「数据自检」按钮：显示一份摘要，同时把完整报告打到控制台；发现重复记录会顺手修掉 */
function jibiShowSelfCheck() {
    let rep;
    try { rep = jibiSelfCheck(); }
    catch (e) { uiAlert('自检失败：' + e.message); return; }

    const dupCount = rep.跨桶重复记录.length;
    const orphan = rep.有数据但不在用户列表;
    let fixed = '';
    if (dupCount && typeof loadAllData === 'function') {
        // 内存里按 id 去重（保留最新那份），再回写数据桶；下次同步时服务端仍以它自己那行为准
        try {
            loadAllData();
            saveUserData();
            triggerAutoSave();
            fixed = '\n\n已自动合并本机重复记录（' + dupCount + ' 条）。';
        } catch (e) { fixed = '\n\n自动合并失败：' + e.message; }
    }

    const lines = [
        '版本 ' + rep.版本 + ' · 当前用户 ' + rep.当前用户,
        '用户：' + (rep.用户列表.length ? rep.用户列表.join('、') : '（空）'),
        '数据桶：' + rep.数据桶.length + ' 个' + (orphan.length ? '，其中 ' + orphan.length + ' 个不在用户列表里（' + orphan.join('、') + '）' : ''),
        '跨桶重复记录：' + dupCount + ' 条',
        '本月支出：全部用户 ' + rep.本月支出_全部用户 + ' / 当前用户 ' + rep.本月支出_当前用户,
        '已同步记录：' + rep.已同步记录数 + ' 条'
    ];
    console.log('[自检] 完整报告', rep);
    uiAlert(lines.join('\n') + fixed + '\n\n完整报告已输出到浏览器控制台（F12 → Console）。', { title: '数据自检', okText: '知道了' });
}

/** 从云端全量重建本机数据（自检发现数据对不上、或换了设备后一片空白时用） */
async function rebuildFromCloud() {
    if (!userPassword) { uiAlert('请先登录（需要加密密码）再重新拉取。'); return; }
    if (offlineMode) { uiAlert('离线模式下不能重新拉取，请先切换到在线模式。'); return; }
    const ok = await uiConfirm(
        '将丢弃本机的同步进度，从 Google 表格重新拉取完整数据。\n\n本机还没同步上去的改动会丢失；已经同步过的数据不受影响。继续？',
        { title: '从云端重建', okText: '重新拉取', cancelText: '取消', danger: true }
    );
    if (!ok) return;

    // 先留一份旧的缓存/同步进度：万一云端拉不到数据，还能退回现在能用的状态
    const oldState = localStorage.getItem('APP_sb_state');
    const oldCache = localStorage.getItem('APP_raw_cache');
    try {
        localStorage.removeItem('APP_sb_state');
        localStorage.removeItem('APP_raw_cache');
        window._incPendingInitial = true;
        showToast('正在从云端重建…', 'syncing', 0);
        await incInitialLoad(userPassword);
        if (window._incPendingInitial) {
            // incInitialLoad 自己吞掉了错误；这里看标记判断是否成功
            if (oldCache !== null) localStorage.setItem('APP_raw_cache', oldCache);
            if (oldState !== null) localStorage.setItem('APP_sb_state', oldState);
            showToast('重建失败：没拉到云端数据，本机数据已保留', 'error', 0);
        }
    } catch (e) {
        if (oldCache !== null) localStorage.setItem('APP_raw_cache', oldCache);
        if (oldState !== null) localStorage.setItem('APP_sb_state', oldState);
        showToast('重建失败：' + (e && e.message ? e.message : e) + '（本机数据已保留）', 'error', 0);
    }
}

/** 只统计真正的账目记录（不含 config / order） */
function jibiCountRecords(map) {
    let n = 0;
    map.forEach(it => { if (it.kind === 'acc' || it.kind === 'txn' || it.kind === 'plan') n++; });
    return n;
}

/**
 * 用本机数据整体覆盖云端。
 * 用于：云端被误删/被清空、某台设备数据乱了、想把完好的那台设备的数据重新变成唯一标准。
 * 与「从备份恢复」走同一个服务端动作 restoreAll：覆盖前 GAS 会自动留一份 records_before_restore_ 安全副本。
 */
async function jibiOverwriteCloud() {
    if (!userPassword) { uiAlert('请先登录（需要加密密码）再覆盖云端。'); return; }
    if (offlineMode) { uiAlert('离线模式下不能写入云端，请先切换到在线模式。'); return; }
    if (driveIsSyncing) { uiAlert('正在同步中，请稍后再试。'); return; }
    if (!inMemoryLoadedData || !inMemoryLoadedData.allUserData) { uiAlert('本机还没有加载数据。'); return; }

    const local = incCollectLocal(inMemoryLoadedData);
    const localRecords = jibiCountRecords(local);

    let cloudLive = 0, cloudOnly = 0, cloudDeleted = 0;
    showToast('正在核对云端数据…', 'syncing', 0);
    try {
        const rows = await incPullRows(0);
        cloudDeleted = rows.filter(r => r.deleted).length;
        rows.forEach(r => {
            if (r.deleted) return;
            if (r.kind === 'acc' || r.kind === 'txn' || r.kind === 'plan') cloudLive++;
            if (!local.has(String(r.id))) cloudOnly++;
        });
    } catch (e) {
        uiAlert('读取云端失败：' + e.message +
            '\n\n请检查连接设置里的 GAS 地址是否有效，以及 Drive 的 FamilyLedger 文件夹里是否有名为 records_sheet 的 Google 表格（同名 .xlsx 不算）。');
        return;
    }

    const bucketUsers = Object.keys(inMemoryLoadedData.allUserData || {});
    const users = (inMemoryLoadedData.users && inMemoryLoadedData.users.length ? inMemoryLoadedData.users : bucketUsers);
    const risk = localRecords < cloudLive
        ? `\n⚠ 本机记录（${localRecords}）比云端（${cloudLive}）少，覆盖后云端多出来的 ${cloudLive - localRecords} 条会被标记删除。\n请先确认这台设备的数据才是完整的。\n`
        : '';
    const ok = await uiConfirm(
        `将用本机的 ${localRecords} 条记录（用户：${users.join('、')}）覆盖云端表格。\n` +
        risk +
        `\n本机：${localRecords} 条\n` +
        `云端：${cloudLive} 条（其中 ${cloudOnly} 条本机没有，覆盖后会标记为已删除）\n` +
        (cloudDeleted ? `云端另有 ${cloudDeleted} 条已删除记录\n` : '') +
        '\n覆盖前云端会自动留一份 records_before_restore_ 安全副本，' +
        '覆盖后其他设备同步一次即可拿到这份数据。继续？',
        { title: '用本机数据覆盖云端', okText: '确认覆盖', cancelText: '取消', danger: true }
    );
    if (!ok) return;

    // 把时间戳提到现在：让本机这份数据在所有设备上都算“最新”
    const now = Date.now();
    Object.values(inMemoryLoadedData.allUserData || {}).forEach(ud => {
        ['accounts', 'transactions', 'plannedTransactions'].forEach(k => {
            (ud[k] || []).forEach(r => { if (r) r.updatedAt = now; });
        });
    });
    inMemoryLoadedData.configUpdatedAt = now;
    _configUpdatedAt = now;
    saveUserData();
    showToast('正在把本机数据写入云端…', 'syncing', 0);

    try {
        const rows = [];
        incCollectLocal(inMemoryLoadedData).forEach(item => {
            rows.push({
                id: item.id, kind: item.kind, owner: item.owner,
                enc: incEnc(item.payload), ts: incTsOf(item)
            });
        });
        const r = await sheetCall({}, { action: 'restoreAll', rows });
        if (!r || !r.ok) throw new Error((r && r.error) || '云端写入失败');

        // 以云端为准重建同步状态：其他设备下次同步会拉到这批全新的序号
        const state = { lastSeq: 0, synced: {} };
        const after = await incPullRows(0);
        incApplyRows(inMemoryLoadedData, incDecryptRows(after, userPassword), state);
        userPins = inMemoryLoadedData.userPins || userPins || {};
        pendingDeletesClear();   // 云端已按本机重写，旧的删除登记作废
        incPersistLocal(state, true);
        clearUnsavedFlag();
        loadAllData();
        filterUserData();
        renderAllTransactions();
        renderAccounts();
        incEnsureBackup();
        showToast(`已用本机 ${localRecords} 条记录覆盖云端`, 'success', 6000);
    } catch (e) {
        hasUnsavedChanges = true;
        if (typeof syncBarRender === 'function') syncBarRender();
        showToast('覆盖失败：' + (e && e.message ? e.message : e), 'error', 0);
    }
}

/**
 * 恢复云端“已删除但本机没有”的记录。
 * 用于：另一台设备把本机没见过的记录误判为删除、推上云端之后，找回被误删的账目。
 * 只恢复属于当前用户的记录；已删除用户的记录直接跳过。
 */
async function jibiRecoverCloudDeleted() {
    if (!userPassword) { uiAlert('请先登录（需要加密密码）再读取云端。'); return; }
    if (offlineMode) { uiAlert('离线模式下不能读取云端，请先切换到在线模式。'); return; }
    if (!inMemoryLoadedData || !inMemoryLoadedData.allUserData) { uiAlert('本机还没有加载数据。'); return; }

    showToast('正在读取云端的已删除记录…', 'syncing', 0);
    let rows;
    try { rows = await incPullRows(0); }
    catch (e) { showToast('读取失败：' + e.message, 'error', 0); return; }

    const local = incCollectLocal(inMemoryLoadedData);
    const removed = inMemoryLoadedData.removedUsers || {};
    const users = (inMemoryLoadedData.users || []).concat(Object.keys(inMemoryLoadedData.allUserData || {}))
        .filter(u => !incUserRemoved(removed, u));
    const cand = [], skipped = [];
    let failed = 0;
    rows.forEach(row => {
        if (!row.deleted) return;
        if (!INC_KIND_LIST[row.kind]) return;            // 只处理账户/交易/计划
        if (local.has(String(row.id))) return;           // 本机已有，不用恢复
        let rec = null;
        try { rec = incDec(row.enc, userPassword); } catch (_) { failed++; return; }
        if (!rec) return;
        if (users.indexOf(row.owner) < 0) { skipped.push({ row, rec }); return; }
        cand.push({ row, rec });
    });

    if (!cand.length) {
        uiAlert('没有可恢复的记录。' +
            (skipped.length ? `\n其中 ${skipped.length} 条属于已删除的用户，已跳过。` : '') +
            (failed ? `\n另有 ${failed} 条无法解密。` : ''), { title: '恢复已删除记录', okText: '知道了' });
        return;
    }

    const label = ({ row, rec }) => {
        if (row.kind === 'txn') {
            const cat = rec.category || (rec.isTransfer ? '转账' : '');
            return `${rec.date || ''} ${cat} ${rec.amount != null ? rec.amount : ''} ${rec.desc || ''}`.replace(/\s+/g, ' ').trim() + `（${row.owner}）`;
        }
        if (row.kind === 'acc') return `账户「${rec.name || ''}」（${row.owner}）`;
        return `计划「${rec.name || rec.desc || ''}」（${row.owner}）`;
    };
    const preview = cand.slice(0, 20).map((x, i) => `${i + 1}. ${label(x)}`).join('\n')
        + (cand.length > 20 ? `\n…另有 ${cand.length - 20} 条` : '');

    const ok = await uiConfirm(
        `云端有 ${cand.length} 条“已删除、但本机没有”的记录：\n\n${preview}\n\n` +
        '如果是误删，点“恢复”：会加回本机并写回云端。' +
        (skipped.length ? `\n（另有 ${skipped.length} 条属于已删除的用户，已跳过）` : ''),
        { title: '恢复已删除记录', okText: '恢复这些记录', cancelText: '取消', danger: false }
    );
    if (!ok) return;

    const now = Date.now();
    const state = incLoadState();
    const items = [];
    cand.forEach(({ row, rec }) => {
        const ln = INC_KIND_LIST[row.kind];
        const ud = incEnsureUserSlot(inMemoryLoadedData, row.owner);
        const arr = ud[ln] || (ud[ln] = []);
        if (arr.some(x => String(x.id) === String(row.id))) return;
        rec.updatedAt = now;
        arr.push(rec);
        memTouched();                                   // 内存变了，界面数组需要对账
        pendingDeletesForget([String(row.id)]);         // 加回来的记录不再是“已删除”
        items.push({ item: { id: String(row.id), kind: row.kind, owner: row.owner, payload: rec }, sig: incSig(rec) });
    });

    showToast('正在把恢复的记录写回云端…', 'syncing', 0);
    try {
        // 直接推，不要先拉：先拉会重新收到这些记录的删除标记，又把刚恢复的删掉
        const up = await incPushUpserts(items, state);
        if (up.rejected.length) {
            const again = await incPullByIds(up.rejected);
            incApplyRows(inMemoryLoadedData, incDecryptRows(again, userPassword), state);
        }
        incPersistLocal(state, true);
        clearUnsavedFlag();
        loadAllData();
        filterUserData();
        renderAllTransactions();
        renderAccounts();
        const failedN = up.rejected.length;
        showToast(`已恢复 ${up.pushed} 条记录` + (failedN ? `，${failedN} 条被云端拒绝（时间戳较旧）` : ''), failedN ? 'warning' : 'success', 6000);
    } catch (e) {
        loadAllData(); filterUserData();   // 先让界面数组跟上内存（含刚加回的记录），再保存，避免旧数组把它们覆盖掉
        saveUserData();
        hasUnsavedChanges = true;
        if (typeof syncBarRender === 'function') syncBarRender();
        showToast('恢复记录已加回本机，但写回云端失败：' + (e && e.message ? e.message : e), 'error', 0);
    }
}
