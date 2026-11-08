// @file js/78-backup-restore.js
// 云端备份列表、备份与当前数据对比、从备份恢复。

// ── 云端备份浏览 ──────────────────────────────────────────────
async function loadBackupList() {
    const container = $('backup-list-container');
    if (!cloudConfigured()) {
        container.innerHTML = '<span class="text-danger small">未配置云端连接，无法读取备份。</span>';
        return;
    }
    container.innerHTML = '<span class="text-muted small"><i class="bi bi-hourglass-split"></i> 读取中…</span>';
    try {
        const backups = await incListBackups();
        if (!backups.length) {
            container.innerHTML = '<span class="text-muted small">暂无备份。云端每日/每周会自动生成表格副本。</span>';
            return;
        }
        container.innerHTML = '';
        backups.forEach(b => {
            const date = new Date(b.createdAt);
            const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
            const sizeKB = (b.size / 1024).toFixed(1);
            const sizeLabel = b.size > 0 ? `${sizeKB} KB` : 'Google 表格副本';
            const kindLabel = b.kind === 'weekly' ? '每周' : '每日';
            const row = document.createElement('div');
            row.className = 'd-flex align-items-center gap-2 py-1 border-bottom';
            row.innerHTML = `
                <div class="flex-grow-1">
                    <div style="font-size:0.82rem;font-weight:500;">${dateStr} <span class="badge bg-secondary" style="font-size:0.62rem;">${kindLabel}</span></div>
                    <div class="text-muted" style="font-size:0.75rem;">${sizeLabel}</div>
                </div>
                <button class="btn btn-sm btn-outline-primary py-0 px-2" onclick="openBackupCompare('${b.name}','${dateStr}')">
                    <i class="bi bi-eye"></i> 对比
                </button>`;
            container.appendChild(row);
        });
    } catch(e) {
        container.innerHTML = `<span class="text-danger small">读取失败：${e.message}</span>`;
    }
}

async function openBackupCompare(fileName, dateStr) {
    const titleEl = $('backup-drawer-title');
    const body    = $('backup-drawer-body');
    const backdrop = $('backup-drawer-backdrop');
    const drawer   = $('backup-drawer');

    titleEl.textContent = `备份对比 · ${dateStr}`;
    body.innerHTML = '<div class="text-center text-muted py-4"><i class="bi bi-hourglass-split"></i> 加载备份中…</div>';
    backdrop.style.opacity = '1'; backdrop.style.pointerEvents = 'auto';
    drawer.style.transform = 'translateY(0)';
    document.body.style.overflow = 'hidden';

    try {
        const backupData = await incReadBackup(fileName);

        // 统计当前数据
        const cur = summarizeData(inMemoryLoadedData);
        // 统计备份数据
        const bak = summarizeData(backupData);

        // 找差异
        const diffTx   = cur.txCount - bak.txCount;
        const diffAcc  = cur.accCount - bak.accCount;

        // 按用户对比交易数
        const allUsers = new Set([...Object.keys(cur.byUser), ...Object.keys(bak.byUser)]);
        let userRowsHtml = '';
        allUsers.forEach(u => {
            const c = cur.byUser[u] || 0;
            const b = bak.byUser[u] || 0;
            const diff = c - b;
            const badge = diff > 0 ? `<span class="badge bg-success">+${diff}</span>`
                        : diff < 0 ? `<span class="badge bg-danger">${diff}</span>`
                        : `<span class="badge bg-secondary">相同</span>`;
            userRowsHtml += `<tr><td>${u}</td><td class="text-center">${b}</td><td class="text-center">${c}</td><td class="text-center">${badge}</td></tr>`;
        });

        // 计算详细差异
        const diff = diffBackupVsCurrent(backupData, inMemoryLoadedData);

        // 辅助：通过 accountId 找账户名
        const allAccounts = [];
        Object.values(inMemoryLoadedData.allUserData || {}).forEach(ud => allAccounts.push(...(ud.accounts || [])));
        Object.values(backupData.allUserData || {}).forEach(ud => allAccounts.push(...(ud.accounts || [])));
        const accNameById = id => {
            const a = allAccounts.find(a => String(a.id) === String(id));
            return a ? a.name : `账户#${id}`;
        };

        // 渲染账户差异
        let accDiffHtml = '';
        if (diff.accountDiffs.length) {
            accDiffHtml = diff.accountDiffs.map(d => `
                <div class="border rounded p-2 mb-1 small">
                    <div class="fw-bold mb-1"><i class="bi bi-bank"></i> ${d.accName} <span class="text-muted">(${d.user})</span></div>
                    ${d.diffs.map(f => `
                        <div class="d-flex gap-2 align-items-center">
                            <span class="text-muted" style="width:52px;">${f.field}</span>
                            <span class="badge bg-secondary text-wrap">${f.backup}</span>
                            <i class="bi bi-arrow-right text-muted"></i>
                            <span class="badge bg-primary text-wrap">${f.current}</span>
                        </div>`).join('')}
                </div>`).join('');
        } else {
            accDiffHtml = '<div class="text-muted small">账户信息无差异</div>';
        }

        // 辅助：渲染单笔交易摘要行（表格行，固定列宽不换行）
        const txRow = (t, badge) => {
            const sym = t.amount < 0 ? '-' : '+';
            const cat = t.category || (t.isTransfer ? '转账' : '');
            const accName = accNameById(t.accountId);
            return `<tr style="white-space:nowrap;">
                <td style="width:46px;padding:5px 6px;">${badge}</td>
                <td style="width:88px;padding:5px 6px;color:var(--bs-secondary);">${t.date}</td>
                <td style="width:72px;padding:5px 6px;max-width:72px;overflow:hidden;text-overflow:ellipsis;" title="${cat}">${cat}</td>
                <td style="width:88px;padding:5px 6px;max-width:88px;overflow:hidden;text-overflow:ellipsis;font-weight:bold;" class="${t.amount < 0 ? 'text-danger' : 'text-success'}" title="${sym}${Math.abs(t.amount)}">${sym}${Math.abs(t.amount)}</td>
                <td style="width:100px;padding:5px 6px;max-width:100px;overflow:hidden;text-overflow:ellipsis;color:var(--bs-secondary);" title="${t.desc || ''}">${t.desc || ''}</td>
                <td style="width:80px;padding:5px 6px;max-width:80px;overflow:hidden;text-overflow:ellipsis;" title="${t.tags || ''}">${t.tags ? `<span class="badge bg-body-tertiary text-body border">${t.tags}</span>` : '<span class="text-muted">—</span>'}</td>
                <td style="width:90px;padding:5px 6px;max-width:90px;overflow:hidden;text-overflow:ellipsis;color:var(--bs-secondary);" title="${accName}">${accName}</td>
                <td style="width:70px;padding:5px 6px;max-width:70px;overflow:hidden;text-overflow:ellipsis;color:var(--bs-secondary);" title="${t._user}">${t._user}</td>
            </tr>`;
        };

        // 辅助：包裹交易列表为可横向滚动的表格
        const txTable = (rows) => `
            <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
                <table style="border-collapse:collapse;min-width:640px;width:100%;font-size:0.82rem;table-layout:fixed;">
                    <thead><tr style="background:var(--bs-tertiary-bg);white-space:nowrap;">
                        <th style="width:46px;padding:4px 6px;border-bottom:2px solid var(--bs-border-color);"></th>
                        <th style="width:88px;padding:4px 6px;border-bottom:2px solid var(--bs-border-color);">日期</th>
                        <th style="width:72px;padding:4px 6px;border-bottom:2px solid var(--bs-border-color);">分类</th>
                        <th style="width:88px;padding:4px 6px;border-bottom:2px solid var(--bs-border-color);">金额</th>
                        <th style="width:100px;padding:4px 6px;border-bottom:2px solid var(--bs-border-color);">备注</th>
                        <th style="width:80px;padding:4px 6px;border-bottom:2px solid var(--bs-border-color);">标签</th>
                        <th style="width:90px;padding:4px 6px;border-bottom:2px solid var(--bs-border-color);">账户</th>
                        <th style="width:70px;padding:4px 6px;border-bottom:2px solid var(--bs-border-color);">用户</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;

        // 渲染变更交易
        let txChangedHtml = '';
        if (diff.txChanged.length) {
            txChangedHtml = diff.txChanged.map(({ tx, _user, diffs }) => `
                <div class="border rounded p-2 mb-1 small">
                    <div class="fw-bold mb-1">${tx.date} · ${tx.category || (tx.isTransfer?'转账':'')} · ${tx.amount} <span class="text-muted">(${_user})</span></div>
                    ${diffs.map(f => `
                        <div class="d-flex gap-2 align-items-center flex-wrap mb-1">
                            <span class="text-muted" style="width:40px;">${f.field}</span>
                            <span class="badge bg-secondary text-wrap">${f.field==='账户'?accNameById(f.backup):f.backup}</span>
                            <i class="bi bi-arrow-right text-muted"></i>
                            <span class="badge bg-primary text-wrap">${f.field==='账户'?accNameById(f.current):f.current}</span>
                        </div>`).join('')}
                </div>`).join('');
        } else {
            txChangedHtml = '<div class="text-muted small">无字段变更</div>';
        }

        body.innerHTML = `
        <div class="row g-3 mb-3">
            <div class="col-6">
                <div class="card border-secondary h-100">
                    <div class="card-header py-1 text-center small fw-bold" style="background:var(--app-surface-2);color:var(--app-text);">备份（${dateStr}）</div>
                    <div class="card-body py-2 text-center">
                        <div class="fs-4 fw-bold">${bak.txCount}</div>
                        <div class="text-muted small">笔交易</div>
                        <div class="mt-1 text-muted small">${bak.accCount} 个账户</div>
                    </div>
                </div>
            </div>
            <div class="col-6">
                <div class="card border-primary h-100">
                    <div class="card-header py-1 text-center small fw-bold" style="background:var(--app-primary);color:var(--app-on-primary);">当前数据</div>
                    <div class="card-body py-2 text-center">
                        <div class="fs-4 fw-bold">${cur.txCount}</div>
                        <div class="text-muted small">笔交易</div>
                        <div class="mt-1 text-muted small">${cur.accCount} 个账户</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="mb-3">
            <div class="fw-bold small mb-1">按用户对比</div>
            <table class="table table-sm table-bordered" style="font-size:0.82rem;">
                <thead><tr><th>用户</th><th class="text-center">备份</th><th class="text-center">当前</th><th class="text-center">差异</th></tr></thead>
                <tbody>${userRowsHtml}</tbody>
            </table>
        </div>

        <div class="mb-3">
            <div class="fw-bold small mb-2"><i class="bi bi-bank text-warning"></i> 账户差异（${diff.accountDiffs.length} 处）</div>
            ${accDiffHtml}
        </div>

        <div class="mb-3">
            <div class="fw-bold small mb-2"><i class="bi bi-plus-circle text-success"></i> 当前新增交易（备份中没有）— ${diff.txOnlyInCurrent.length} 笔</div>
            ${diff.txOnlyInCurrent.length
                ? txTable(diff.txOnlyInCurrent.map(t => txRow(t, '<span class="badge bg-success">新增</span>')).join(''))
                : '<div class="text-muted small">无</div>'}
        </div>

        <div class="mb-3">
            <div class="fw-bold small mb-2"><i class="bi bi-dash-circle text-danger"></i> 备份独有交易（当前已删除）— ${diff.txOnlyInBackup.length} 笔</div>
            ${diff.txOnlyInBackup.length
                ? txTable(diff.txOnlyInBackup.map(t => txRow(t, '<span class="badge bg-danger">已删</span>')).join(''))
                : '<div class="text-muted small">无</div>'}
        </div>

        <div class="mb-3">
            <div class="fw-bold small mb-2"><i class="bi bi-pencil text-warning"></i> 字段变更交易 — ${diff.txChanged.length} 笔</div>
            ${txChangedHtml}
        </div>

        <div class="alert alert-danger py-2 px-3 small mb-2">
            <i class="bi bi-exclamation-triangle-fill"></i> 恢复将用此备份<strong>完全覆盖</strong>当前本机数据，操作不可撤销。建议先确认云端当前数据已同步。
        </div>
        <button class="btn btn-danger w-100" onclick="restoreFromBackup('${fileName}','${dateStr}')">
            <i class="bi bi-arrow-counterclockwise"></i> 从此备份恢复
        </button>`;

        // 存备份数据供恢复用
        window._pendingRestoreData = backupData;

    } catch(e) {
        body.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
    }
}

function summarizeData(data) {
    let txCount = 0, accCount = 0;
    const byUser = {};
    if (!data || !data.allUserData) return { txCount, accCount, byUser };
    Object.entries(data.allUserData).forEach(([u, ud]) => {
        const txs  = (ud.transactions || []).filter(t => !t._isBaseline);
        const accs = ud.accounts || [];
        txCount  += txs.length;
        accCount += accs.length;
        byUser[u] = txs.length;
    });
    return { txCount, accCount, byUser };
}

function diffBackupVsCurrent(backupData, currentData) {
    const result = {
        accountDiffs: [],   // 账户初始余额/名称/货币不同
        txOnlyInCurrent: [], // 当前有，备份没有
        txOnlyInBackup:  [], // 备份有，当前没有
        txChanged: [],       // 同id但字段不同
    };
    if (!backupData?.allUserData || !currentData?.allUserData) return result;

    const allUsers = new Set([
        ...Object.keys(backupData.allUserData),
        ...Object.keys(currentData.allUserData)
    ]);

    allUsers.forEach(u => {
        const bakUD = backupData.allUserData[u]  || { accounts: [], transactions: [] };
        const curUD = currentData.allUserData[u] || { accounts: [], transactions: [] };

        // ── 账户对比 ──
        const bakAccMap = new Map((bakUD.accounts || []).map(a => [String(a.id), a]));
        const curAccMap = new Map((curUD.accounts || []).map(a => [String(a.id), a]));
        curAccMap.forEach((curAcc, id) => {
            const bakAcc = bakAccMap.get(id);
            if (!bakAcc) return; // 新增账户不在这里报（在交易层体现）
            const diffs = [];
            if (parseFloat(curAcc.initialBalance) !== parseFloat(bakAcc.initialBalance))
                diffs.push({ field: '初始余额', backup: bakAcc.initialBalance, current: curAcc.initialBalance });
            if (curAcc.name !== bakAcc.name)
                diffs.push({ field: '账户名', backup: bakAcc.name, current: curAcc.name });
            if (curAcc.currency !== bakAcc.currency)
                diffs.push({ field: '货币', backup: bakAcc.currency, current: curAcc.currency });
            if (diffs.length) result.accountDiffs.push({ user: u, accName: curAcc.name, id, diffs });
        });

        // ── 交易对比 ──
        const bakTxs = (bakUD.transactions || []).filter(t => !t._isBaseline);
        const curTxs = (curUD.transactions || []).filter(t => !t._isBaseline);
        const bakTxMap = new Map(bakTxs.map(t => [String(t.id), t]));
        const curTxMap = new Map(curTxs.map(t => [String(t.id), t]));

        // 当前有，备份没有
        curTxMap.forEach((t, id) => {
            if (!bakTxMap.has(id)) result.txOnlyInCurrent.push({ ...t, _user: u });
        });
        // 备份有，当前没有
        bakTxMap.forEach((t, id) => {
            if (!curTxMap.has(id)) result.txOnlyInBackup.push({ ...t, _user: u });
        });
        // 同id，字段不同
        curTxMap.forEach((cur, id) => {
            const bak = bakTxMap.get(id);
            if (!bak) return;
            const diffs = [];
            const fields = [
                { key: 'amount',    label: '金额' },
                { key: 'date',      label: '日期' },
                { key: 'category',  label: '类别' },
                { key: 'desc',      label: '备注' },
                { key: 'tags',      label: '标签' },
                { key: 'accountId', label: '账户' },
            ];
            fields.forEach(({ key, label }) => {
                const cv = String(cur[key] ?? ''), bv = String(bak[key] ?? '');
                if (cv !== bv) diffs.push({ field: label, backup: bv, current: cv });
            });
            if (diffs.length) result.txChanged.push({ tx: cur, _user: u, diffs });
        });
    });
    return result;
}

async function restoreFromBackup(fileName, dateStr) {
    if (!window._pendingRestoreData) return;
    if (!(await uiConfirm(`确认从备份「${dateStr}」恢复？\n\n恢复会用该备份完全覆盖本机和云端的当前数据，操作不可撤销。\n（云端会先自动留一份恢复前的安全副本）`, { title: '从备份恢复', okText: '确认恢复', danger: true }))) return;

    const backup = window._pendingRestoreData;
    window._pendingRestoreData = null;
    closeBackupDrawer();

    // 统一把时间戳提到现在：让恢复的内容在各设备上都算“最新”，覆盖旧版本
    const now = Date.now();
    Object.values(backup.allUserData || {}).forEach(ud => {
        ['accounts', 'transactions', 'plannedTransactions'].forEach(k => {
            (ud[k] || []).forEach(r => { if (r) r.updatedAt = now; });
        });
    });
    backup.configUpdatedAt = now;

    inMemoryLoadedData = backup;
    _configUpdatedAt = now;
    saveUserData();
    loadAllData();
    filterUserData();
    renderAllTransactions();
    renderAccounts();
    showToast('正在把备份写回云端…', 'syncing', 0);

    try {
        // 1) 把备份中的全部记录（含配置）加密后一次性覆盖云端
        const rows = [];
        incCollectLocal(backup).forEach(item => {
            rows.push({
                id: item.id, kind: item.kind, owner: item.owner,
                enc: incEnc(item.payload), ts: incTsOf(item)
            });
        });
        const r = await sheetCall({}, { action: 'restoreAll', rows });
        if (!r || !r.ok) throw new Error((r && (r.error || r.tooLarge && '部分记录过大')) || '云端恢复失败');

        // 2) 以云端为准重建同步状态（其他设备下次同步也会收到这些变化）
        const state = { lastSeq: 0, synced: {} };
        const after = await incPullRows(0);
        incApplyRows(inMemoryLoadedData, incDecryptRows(after, userPassword), state);
        incPersistLocal(state, true);
        clearUnsavedFlag();
        loadAllData();
        filterUserData();
        renderAllTransactions();
        renderAccounts();
        incEnsureBackup();
        showToast(`已从备份 ${dateStr} 恢复到本机并写回云端`, 'success', 5000);
    } catch (e) {
        hasUnsavedChanges = true;
        syncBarRender();
        showToast('恢复失败：' + e.message + '（本机数据已恢复，但尚未完整写回云端）', 'error', 0);
    }
}

function closeBackupDrawer() {
    const backdrop = $('backup-drawer-backdrop');
    const drawer   = $('backup-drawer');
    if (backdrop) { backdrop.style.opacity = '0'; backdrop.style.pointerEvents = 'none'; }
    if (drawer)   { drawer.style.transform = 'translateY(100%)'; }
    document.body.style.overflow = '';
    window._pendingRestoreData = null;
}
