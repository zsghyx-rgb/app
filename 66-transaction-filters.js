// @file js/66-transaction-filters.js
// 交易页筛选/搜索/排序/日期快捷筛选、用户过滤、getFilteredTransactions、手机滑动手势、NEW/UPDATED 角标。

function updateUserFilterBtn() {
    const btn = $('trans-user-filter-btn');
    const textEl = $('trans-user-filter-text');
    if (!btn) return;
    if (currentUserFilterValue === 'all') {
        if (textEl) textEl.textContent = '所有用户';
        btn.className = 'btn btn-outline-secondary btn-sm';
    } else {
        if (textEl) textEl.textContent = currentUserFilterValue;
        btn.className = 'btn btn-primary btn-sm';
    }
}

function cycleUserFilter() {
    const options = ['all', ...dataUsers];
    const idx = options.indexOf(currentUserFilterValue);
    currentUserFilterValue = options[(idx + 1) % options.length];
    localStorage.setItem('APP_trans_user_filter', currentUserFilterValue);
    updateUserFilterBtn();
    applyTransactionFilter();
}

function clearTransactionFilters() {
    $('trans-search-input').value = '';
    $('filter-start-date').value = '';
    $('filter-end-date').value = '';
    currentUserFilterValue = 'all';
    updateUserFilterBtn();
    displayedTransactionCount = 100;
    // 清除快速按钮高亮、关闭自定义面板
    $$('#quick-date-filter-group button').forEach(b => b.classList.remove('active'));
    const panel = $('trans-custom-date-panel');
    if (panel) panel.style.setProperty('display', 'none', 'important');
    const toggle = $('trans-custom-toggle');
    if (toggle) toggle.classList.remove('active');
    applyTransactionFilter();
}

function toggleTransCustomDate() {
    const panel  = $('trans-custom-date-panel');
    const toggle = $('trans-custom-toggle');
    if (!panel) return;
    const isHidden = panel.style.cssText.includes('none');
    if (isHidden) {
        panel.style.setProperty('display', 'flex', 'important');
        toggle.classList.add('active');
        // 展开时清除快速按钮高亮
        $$('#quick-date-filter-group button').forEach(b => b.classList.remove('active'));
    } else {
        panel.style.setProperty('display', 'none', 'important');
        toggle.classList.remove('active');
    }
}

function handleSearchInput() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        displayedTransactionCount = 100;
        applyTransactionFilter();
    }, 300);
}

function applyTransactionFilter() {
    displayedTransactionCount = 100;
    renderAllTransactions();
}

function quickDateFilter(p) {
    const today = new Date();
    let start = '', end = '';
    if      (p === '30days')   { start = new Date(today); start.setDate(start.getDate() - 30); end = today; }
    else if (p === 'month')    { start = new Date(today.getFullYear(), today.getMonth(), 1); end = new Date(today.getFullYear(), today.getMonth() + 1, 0); }
    else if (p === 'lastmonth'){ start = new Date(today.getFullYear(), today.getMonth() - 1, 1); end = new Date(today.getFullYear(), today.getMonth(), 0); }
    else if (p === 'year')     { start = new Date(today.getFullYear(), 0, 1); end = new Date(today.getFullYear(), 11, 31); }
    $('filter-start-date').value = start ? formatLocal(start) : '';
    $('filter-end-date').value   = end   ? formatLocal(end)   : '';
    // 高亮当前按钮
    $$('#quick-date-filter-group button').forEach(b =>
        b.classList.toggle('active', b.dataset.range === p));
    // 关闭自定义面板
    const panel = $('trans-custom-date-panel');
    if (panel) panel.style.setProperty('display', 'none', 'important');
    const toggle = $('trans-custom-toggle');
    if (toggle) toggle.classList.remove('active');
    displayedTransactionCount = 100;
    applyTransactionFilter();
}

function sortTransactions(field) {
    if (currentSortField === field) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortField = field; currentSortDirection = 'desc';
    }
    displayedTransactionCount = 100;
    renderAllTransactions();
}

function toggleDisplayMode() {
    const modes = ['all', 'transactions', 'transfers'];
    transactionDisplayMode = modes[(modes.indexOf(transactionDisplayMode) + 1) % modes.length];
    localStorage.setItem('APP_trans_display_mode', transactionDisplayMode);
    updateTransferModeButton();
    displayedTransactionCount = 100;
    renderAllTransactions();
}

function updateTransferModeButton() {
    const button = $('transfer-mode-toggle');
    const icon = $('transfer-mode-icon');
    const text = $('transfer-mode-text');
    if (!button || !icon || !text) return;
    button.className = 'btn btn-sm';
    switch (transactionDisplayMode) {
        case 'all':
            button.classList.add('btn-primary'); icon.className = 'bi bi-eye'; text.textContent = '收支+转账'; break;
        case 'transactions':
            button.classList.add('btn-success'); icon.className = 'bi bi-wallet2'; text.textContent = '仅收支'; break;
        case 'transfers':
            button.classList.add('btn-info'); icon.className = 'bi bi-arrow-left-right'; text.textContent = '仅转账'; break;
    }
}

function getFilteredTransactions() {
    // 【关键切换】
    const source = transactions;

    const search = $('trans-search-input').value.toLowerCase();
    const startDate = $('filter-start-date').value;
    const endDate = $('filter-end-date').value;
    const userFilter = currentUserFilterValue;
    const accMap = new Map(accounts.map(a => [String(a.id), a]));

    return source.filter(t => {
        if (t._isBaseline) return false;
        // 隐藏账户：其名下的交易记录不再显示在交易管理页面
        const _tAcc = accMap.get(String(t.accountId));
        if (_tAcc && _tAcc.hidden) return false;
        if (transactionDisplayMode === 'transactions' && t.isTransfer) return false;
        if (transactionDisplayMode === 'transfers' && !t.isTransfer) return false;

        if (startDate && t.date < startDate) return false;
        if (endDate && t.date > endDate) return false;
        if (userFilter !== 'all' && t.ownerName !== userFilter) return false;

        if (search) {
            const accName = _tAcc ? _tAcc.name.toLowerCase() : '';
            if (!JSON.stringify(t).toLowerCase().includes(search) && !accName.includes(search)) return false;
        }
        return true;
    });
}
function initMobileSwipeGestures(card, transactionId) {
    card.addEventListener('click', (e) => {
        const t = transactions.find(x => x.id === transactionId);
        if (!t || t.ownerName !== currentUserName) return;
        if (t.isTransfer) openEditTransfer(transactionId);
        else openEditTransaction(transactionId);
    });
}

function getTxnBadge(t) {
    try {
        const raw = sessionStorage.getItem('knownTxnMap_' + currentUserName);
        if (!raw) return '';
        const knownMap = JSON.parse(raw);
        if (!(t.id in knownMap)) return NEW_BADGE;
        if ((t.updatedAt ?? 0) > (knownMap[t.id] ?? 0)) return UPDATED_BADGE;
    } catch(_) {}
    return '';
}
// 兼容旧调用
function isNewTxn(t) { return getTxnBadge(t) !== ''; }
const NEW_BADGE = '<em style="font-size:0.68rem;color:var(--app-transfer);font-style:italic;margin-left:4px;">新数据</em>';
const UPDATED_BADGE = '<em style="font-size:0.68rem;color:var(--app-primary);font-style:italic;margin-left:4px;">已更新</em>';
