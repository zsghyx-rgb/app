// @file js/56-transfer-pair.js
// 转账配对：统一的“找另一半”函数、孤立转账（另一半已不存在）的识别 / 提示 / 清理，以及删除孤立记录的批量处理。

/* ─── 背景 ───
 * 一笔转账 = 两条独立记录（转出 expense + 转入 income），新数据用同一个 transferPairId 关联；
 * 5.1.0 之前的老数据没有 transferPairId，只能靠“同一天 + 两个账户互相指向”来猜另一半。
 * 之前删除/编辑/账户详情各写了一套猜法（有的严格比较、有的宽松比较），老数据在同一天有多笔转账时，
 * 删除一笔会连带删掉别人的转出记录，留下孤立的转入记录（点开提示“找不到配对的转账记录”）。
 * 现在全部走 resolveTransferPair()。 */

function _sameId(a, b) { return a != null && b != null && String(a) === String(b); }

// 找一条转账记录的另一半。pool 默认是全部交易；返回 { tOut, tIn, orphan }（orphan = 缺少另一半）
function resolveTransferPair(t, pool) {
    if (!t || !t.isTransfer) return { tOut: null, tIn: null, orphan: false };
    const list = pool || transactions;
    let tOut = null, tIn = null;
    if (t.transferPairId != null) {
        const same = x => x.isTransfer && _sameId(x.transferPairId, t.transferPairId);
        tOut = t.type === 'expense' ? t : (list.find(x => same(x) && x.type === 'expense') || null);
        tIn  = t.type === 'income'  ? t : (list.find(x => same(x) && x.type === 'income')  || null);
    } else {
        // 老数据：同一天、转出账户=转入记录的 relatedAccountId、转入账户=转出记录的 relatedAccountId；金额一致的优先
        const wantType = t.type === 'expense' ? 'income' : 'expense';
        const cands = list.filter(x => x.isTransfer && x.transferPairId == null && x.type === wantType && x.date === t.date
            && _sameId(x.accountId, t.relatedAccountId) && _sameId(x.relatedAccountId, t.accountId));
        const partner = cands.find(x => Math.abs(x.amount) === Math.abs(t.amount)) || cands[0] || null;
        if (t.type === 'expense') { tOut = t; tIn = partner; } else { tIn = t; tOut = partner; }
    }
    return { tOut, tIn, orphan: !tOut || !tIn };
}

// 所有孤立转账记录的 id（含转出、转入两种：只剩一半的那一条）
function getOrphanTransferIds() {
    const out = new Set();
    const transfers = transactions.filter(x => x.isTransfer);
    if (!transfers.length) return out;
    const byPair = new Map();
    transfers.forEach(x => {
        if (x.transferPairId == null) return;
        const k = String(x.transferPairId);
        const g = byPair.get(k) || { out: 0, inn: 0, items: [] };
        if (x.type === 'expense') g.out++; else g.inn++;
        g.items.push(x);
        byPair.set(k, g);
    });
    byPair.forEach(g => { if (g.out === 0 || g.inn === 0) g.items.forEach(x => out.add(x.id)); });
    transfers.forEach(x => { if (x.transferPairId == null && resolveTransferPair(x, transfers).orphan) out.add(x.id); });
    return out;
}

function _orphanDesc(t) {
    const acc = accounts.find(a => a.id == t.accountId);
    const sym = acc ? (CURRENCY_SYMBOLS[acc.currency] || '') : '';
    const who = t.ownerName !== currentUserName ? `（${t.ownerName}）` : '';
    return `${t.date} ${acc ? getAccountDisplayName(acc) : '?'} ${t.type === 'income' ? '转入' : '转出'} ${sym}${Math.abs(t.amount).toFixed(2)}${who}`;
}

// 点开一条孤立转账时：说明情况；是自己的记录就可以删除
async function handleOrphanTransfer(t) {
    const desc = _orphanDesc(t);
    if (t.ownerName !== currentUserName) {
        uiAlert(`这笔转账的另一半记录已不存在（可能已被删除），它现在是一条孤立记录。\n\n${desc}\n\n这条记录属于 ${t.ownerName}，请让对方登录后在“设置 → 高级功能 → 检查孤立转账”里清理。`);
        return;
    }
    const ok = await uiConfirm(`这笔转账的另一半记录已不存在（可能已被删除），它现在是一条孤立记录，还会影响账户余额。\n\n${desc}\n\n要删除这条孤立记录吗？`,
        { title: '转账配对缺失', okText: '删除这条记录', cancelText: '先保留', danger: true });
    if (ok) deleteOrphanTransfers([t.id]);
}

// 设置 → 高级功能 → 检查孤立转账
async function scanOrphanTransfers() {
    const ids = getOrphanTransferIds();
    const list = transactions.filter(t => ids.has(t.id)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!list.length) { uiAlert('没有发现孤立转账：所有转账的转出、转入记录都是成对的。'); return; }
    const mine = list.filter(t => t.ownerName === currentUserName);
    const others = list.length - mine.length;
    let msg = `发现 ${list.length} 条孤立转账（另一半已不存在）：\n\n` + list.slice(0, 8).map(_orphanDesc).join('\n') + (list.length > 8 ? `\n……共 ${list.length} 条` : '');
    if (!mine.length) { uiAlert(msg + '\n\n这些记录都属于其他用户，请让对方登录后清理。'); return; }
    if (others) msg += `\n\n其中 ${others} 条属于其他用户，需要对方登录后清理。`;
    msg += `\n\n要删除属于你的 ${mine.length} 条吗？删除后底部有“撤销”。`;
    const ok = await uiConfirm(msg, { title: '检查孤立转账', okText: `删除我的 ${mine.length} 条`, cancelText: '先不处理', danger: true });
    if (ok) deleteOrphanTransfers(mine.map(t => t.id));
}

// 批量删除孤立记录（只删除本人的；写删除日志，同步后其他设备也会删除；支持撤销）
function deleteOrphanTransfers(ids) {
    const idSet = new Set(ids);
    const targets = transactions.filter(t => idSet.has(t.id) && t.ownerName === currentUserName);
    if (!targets.length) return;
    const snapTransactions = transactions.slice();
    const snapDeletedLog = (inMemoryLoadedData.deletedLog || []).slice();
    const now = Date.now();
    transactions = transactions.filter(t => !targets.includes(t));
    if (!inMemoryLoadedData.deletedLog) inMemoryLoadedData.deletedLog = [];
    targets.forEach(t => { if (!inMemoryLoadedData.deletedLog.find(e => e.id === t.id)) inMemoryLoadedData.deletedLog.push({ id: t.id, deletedAt: now }); });
    saveUserData(); triggerAutoSave(); filterUserData();
    displayedTransactionCount = 100;
    renderAllTransactions(); renderAccounts();
    if ($('view-stats').classList.contains('active-view')) renderStats();
    showUndo(`已删除 ${targets.length} 条孤立转账记录`, () => {
        transactions = snapTransactions;
        inMemoryLoadedData.deletedLog = snapDeletedLog;
        saveUserData(); triggerAutoSave(); filterUserData();
        displayedTransactionCount = 100;
        renderAllTransactions(); renderAccounts();
        if ($('view-stats').classList.contains('active-view')) renderStats();
    });
}
