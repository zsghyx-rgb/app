// @file js/97-diagnostics.js
// 账本自检（5.1.5）：一键检查“多设备数字对不上”的常见原因，并顺手修掉本机重复记录。

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

    // 2) 孤立数据桶：有数据但不在用户列表里（以前会把这类数据整块藏起来）
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
    if (!userPassword) { uiAlert('需要先登录（输入加密密码）才能重新拉取。'); return; }
    if (offlineMode) { uiAlert('离线模式下不能重新拉取，请先切换到在线模式。'); return; }
    const ok = await uiConfirm(
        '将丢弃本机的同步进度，从 Google 表格重新拉取完整数据。\n\n本机还没同步上去的改动会丢失；已经同步过的数据不受影响。继续？',
        { title: '从云端重建', okText: '重新拉取', cancelText: '取消', danger: true }
    );
    if (!ok) return;
    try {
        localStorage.removeItem('APP_sb_state');
        localStorage.removeItem('APP_raw_cache');
        window._incPendingInitial = true;
        showToast('正在从 Google 表格重建…', 'syncing', 0);
        await incInitialLoad(userPassword);
    } catch (e) {
        showToast('重建失败：' + (e && e.message ? e.message : e), 'error', 0);
    }
}
