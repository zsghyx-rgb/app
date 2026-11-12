// @file js/55-transaction-modals.js
// 新增/编辑交易与转账弹窗：标签切换、打开新增/编辑、转账账户互换、删除交易。

function switchTransTab(tab, skipReset) {
    // tab: 'expense' | 'income' | 'transfer'
    const transForm = $('edit-transaction-form');
    const transferForm = $('edit-transfer-form');
    const isTransfer = tab === 'transfer';

    // 用户手动切换 支出 / 收入 / 转账 时，把已经输入的金额带过去（新增时才有这个切换）
    let carriedAmount = '';
    if (!skipReset) {
        const wasTransfer = transferForm.style.display !== 'none';
        if (wasTransfer) carriedAmount = $('edit-transfer-amount-out').value || $('edit-transfer-amount-in').value || '';
        else if (!_inSplitMode) carriedAmount = $('edit-trans-amount').value || '';   // 拆分模式下金额是各分项之和，不带过去
    }

    transForm.style.display = isTransfer ? 'none' : '';
    transferForm.style.display = isTransfer ? '' : 'none';

    // 更新标题
    const mode = $('edit-trans-mode').value;
    if (mode === 'add') {
        const titleMap = { expense: '新增支出', income: '新增收入', transfer: '新增转账' };
        $('editTransactionModalTitle').textContent = _userTitle(titleMap[tab] || '新增交易');
    }

    // 切换时同步日期：把当前可见表单的日期复制到另一个
    const transDate = $('edit-trans-date').value;
    const transferDate = $('edit-transfer-date').value;
    if (isTransfer && !transferDate && transDate) $('edit-transfer-date').value = transDate;
    if (!isTransfer && !transDate && transferDate) $('edit-trans-date').value = transferDate;

    // tab 按钮高亮（沉浸式分段控件）
    ['expense','income','transfer'].forEach(t => {
        const btn = $('tab-btn-' + t);
        if (!btn) return;
        btn.classList.toggle('active', t === tab);
    });

    if (isTransfer) {
        // 转账 tab：填充账户下拉框
        if (!skipReset) {
            fillTransferSelects(null, null);
            $('edit-transfer-amount-out').value = carriedAmount;
            $('edit-transfer-amount-in').value = '';
            if (carriedAmount) handleEditTransferAmountChange('out');   // 同币种账户时，转入金额自动同步
            $('edit-transfer-desc').value = '';
        } else {
            // skipReset 时也要确保账户已填充
            if (!$('edit-transfer-from').options.length) fillTransferSelects(null, null);
        }
    } else {
        // 隐藏 tab bar (只在新增时显示；编辑时 tab 固定)
        $('edit-trans-type').value = tab;
        if (!skipReset) {
            // 切换 tab 清空分类，金额保留（与另外两个 tab 互通）
            resetInlineItems();
            $('edit-trans-amount').value = carriedAmount;
        }
        updateEditFormCategories();
        const attachSec = $('attachment-section');
        const attachBtn = $('attachment-btn');
        if (attachSec) attachSec.style.display = tab === 'expense' ? '' : 'none';
        if (attachBtn) attachBtn.style.display = tab === 'expense' ? '' : 'none';
        // 拆分按钮仅在支出时显示
        const splitBtn = $('split-toggle-btn');
        if (splitBtn) splitBtn.style.display = tab === 'expense' ? '' : 'none';
        // 切换 tab 时退出拆分模式
        if (_inSplitMode) exitSplitMode();
        else _splitData = [];
    }
    syncDateLabels();
}

// 日期友好显示："今天"/"昨天"/"明天"/"M月D日"
function formatTransDateLabel(dateStr) {
    if (!dateStr) return '选择日期';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '选择日期';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((d - today) / 86400000);
    if (diffDays === 0) return '今天';
    if (diffDays === -1) return '昨天';
    if (diffDays === 1) return '明天';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function syncDateLabels() {
    const tEl = $('edit-trans-date-label');
    if (tEl) tEl.textContent = formatTransDateLabel($('edit-trans-date').value);
    const fEl = $('edit-transfer-date-label');
    if (fEl) fEl.textContent = formatTransDateLabel($('edit-transfer-date').value);
}

// 标签输入框始终显示（不再需要展开/收起逻辑）

// 弹窗标题加用户名
function _userTitle(base) {
    return currentUserName ? `${base} · ${currentUserName}` : base;
}

function _initNewTransModal(mode, title) {
    const today = new Date().toISOString().split('T')[0];
    $('editTransactionModal').querySelector('.trans-modal-v2')?.classList.remove('view-only');
    $('edit-trans-id').value = '';
    $('edit-trans-mode').value = mode;
    // 同步重置转账表单状态，防止切 tab 后误走编辑分支
    $('edit-transfer-id').value = '';
    $('edit-transfer-mode').value = mode;
    $('editTransactionModalTitle').textContent = _userTitle(title);
    $('edit-trans-submit-btn').textContent = '保存';
    $('edit-trans-delete-btn').style.setProperty('display','none','important');
    $('edit-transfer-submit-btn').textContent = '保存';
    $('edit-transfer-delete-btn').style.setProperty('display','none','important');
    // 两个表单的日期同步初始化
    $('edit-trans-date').value = today;
    $('edit-transfer-date').value = today;
    $('edit-trans-tags').value = '';
    $('edit-trans-desc').value = '';
    const hintEl = $('edit-trans-desc-hint');
    if (hintEl) hintEl.style.display = 'none';
    resetInlineItems();
    resetAttachmentUI();
    resetMetaFieldsCollapse();
    $('trans-tab-bar').style.display = '';
}

function openNewTransFromDetail() {
    openedFromDetail = true;
    const prefs = _lastTransPrefs;
    _initNewTransModal('add', '新增交易');
    switchTransTab(prefs.type || 'expense', true);
    const accSelect = $('edit-trans-account');
    if (accSelect) { accSelect.value = currentDetailAccountId; accSelectSync('edit-trans-account'); }
    const catSelect = $('edit-trans-category');
    if (catSelect && prefs.category) {
        const opt = [...catSelect.options].find(o => o.value === prefs.category);
        if (opt) catSelect.value = prefs.category;
    }
    catGridSync('edit-trans-category', 'cat-grid-edit-trans-category');
    new bootstrap.Modal($('editTransactionModal')).show();
}

function openNewTransferFromDetail() {
    openedFromDetail = true;
    const today = new Date().toISOString().split('T')[0];
    $('editTransactionModal').querySelector('.trans-modal-v2')?.classList.remove('view-only');
    $('editTransactionModal').querySelectorAll('input,select,textarea').forEach(el => el.disabled = false);
    $('editTransactionModalTitle').textContent = _userTitle('新增转账');
    $('edit-transfer-id').value = '';
    $('edit-transfer-mode').value = 'add';
    $('edit-transfer-submit-btn').textContent = '保存';
    $('edit-transfer-delete-btn').style.setProperty('display','none','important');
    $('edit-transfer-date').value = today;
    fillTransferSelects(currentDetailAccountId, null);
    $('edit-transfer-amount-out').value = '';
    $('edit-transfer-amount-in').value = '';
    $('edit-transfer-desc').value = '';
    resetMetaFieldsCollapse();
    resetTransferFeeUI();
    $('trans-tab-bar').style.display = '';
    switchTransTab('transfer', true);
    new bootstrap.Modal($('editTransactionModal')).show();
}

function openNewTransaction() {
    const prefs = _lastTransPrefs;
    _initNewTransModal('add', '新增交易');
    switchTransTab(prefs.type || 'expense', true);

    const accSelect = $('edit-trans-account');
    if (accSelect && accSelect.options.length > 0) {
        const lastAccOpt = prefs.accountId && [...accSelect.options].find(o => o.value == prefs.accountId);
        if (lastAccOpt) accSelect.value = prefs.accountId;
        else accSelect.selectedIndex = 0;
    }
    accSelectSync('edit-trans-account');
    const catSelect = $('edit-trans-category');
    if (catSelect && prefs.category) {
        const lastCatOpt = [...catSelect.options].find(o => o.value === prefs.category);
        if (lastCatOpt) catSelect.value = prefs.category;
    }
    catGridSync('edit-trans-category', 'cat-grid-edit-trans-category');
    new bootstrap.Modal($('editTransactionModal')).show();
}

function fillTransferSelects(fromValue, toValue) {
    const fromSelect = $('edit-transfer-from');
    const toSelect = $('edit-transfer-to');
    fromSelect.innerHTML = '';
    // 转出：只有自己的账户，按手动排序（隐藏账户不可选）
    sortedUserAccounts(accounts.filter(a => a.ownerName === currentUserName && !a.hidden)).forEach(a => {
        const name = `${getAccountDisplayName(a)} (${CURRENCY_SYMBOLS[a.currency]})`;
        const opt = new Option(name, a.id);
        opt.setAttribute('data-name', name);
        opt.setAttribute('data-bal', calculateBalance(a.id).toFixed(2));
        fromSelect.add(opt);
    });
    toSelect.innerHTML = '';
    // 转入：自己的账户（排序）+ 其他用户账户（隐藏账户不可选）
    const sortedMine = sortedUserAccounts(accounts.filter(a => a.ownerName === currentUserName && !a.hidden));
    const others = accounts.filter(a => a.ownerName !== currentUserName && !a.hidden);
    [...sortedMine, ...others].forEach(a => {
        const name = `${getAccountDisplayName(a)} (${CURRENCY_SYMBOLS[a.currency]})`;
        const opt = new Option(name, a.id);
        opt.setAttribute('data-name', name);
        const isMine = a.ownerName === currentUserName;
        if (isMine) opt.setAttribute('data-bal', calculateBalance(a.id).toFixed(2));
        toSelect.add(opt);
    });
    if (fromValue) fromSelect.value = fromValue;
    else if (fromSelect.options.length > 0) fromSelect.selectedIndex = 0;
    if (toValue) toSelect.value = toValue;
    else {
        const fromId = fromSelect.value;
        const other = accounts.find(a => a.id != fromId && !a.hidden);
        if (other) toSelect.value = other.id;
        else if (toSelect.options.length > 1) toSelect.selectedIndex = 1;
    }
    accSelectSync('edit-transfer-from');
    accSelectSync('edit-transfer-to');
}

function openNewTransfer() {
    _initNewTransModal('add', '新增转账');
    $('edit-transfer-id').value = '';
    $('edit-transfer-mode').value = 'add';
    $('edit-transfer-amount-out').value = '';
    $('edit-transfer-amount-in').value = '';
    $('edit-transfer-desc').value = '';
    resetTransferFeeUI();
    switchTransTab('transfer', true);
    new bootstrap.Modal($('editTransactionModal')).show();
}


// 互换转出/转入账户（金额同步互换）
function swapTransferAccounts() {
    const fromSel = $('edit-transfer-from');
    const toSel = $('edit-transfer-to');
    if (!fromSel || !toSel) return;
    const toAcc = accounts.find(a => a.id == toSel.value);
    if (toAcc && toAcc.ownerName !== currentUserName) { uiAlert('只能从自己的账户转出，转入账户是其他用户的账户，无法互换'); return; }
    const tmp = fromSel.value;
    fromSel.value = toSel.value;
    toSel.value = tmp;
    accSelectSync('edit-transfer-from');
    accSelectSync('edit-transfer-to');

    const outAmtEl = $('edit-transfer-amount-out');
    const inAmtEl = $('edit-transfer-amount-in');
    if (outAmtEl && inAmtEl) {
        const tmpAmt = outAmtEl.value;
        outAmtEl.value = inAmtEl.value;
        inAmtEl.value = tmpAmt;
        inAmtEl.dataset.auto = '';
    }
    markTransferPair();
    refreshTransferLayout();
}

function handleEditTransferAmountChange(direction) {
    const fromId = $('edit-transfer-from')?.value;
    const toId   = $('edit-transfer-to')?.value;
    if (!fromId || !toId) return;
    const accFrom = accounts.find(a => a.id == fromId);
    const accTo   = accounts.find(a => a.id == toId);
    if (!accFrom || !accTo) return;

    const outEl = $('edit-transfer-amount-out');
    const inEl  = $('edit-transfer-amount-in');
    // 换了账户且币种组合变了：转入金额不再沿用旧值，按新币种重新估算/同步
    const pairKey = `${accFrom.currency}>${accTo.currency}`;
    if (direction === undefined && inEl.dataset.pair !== undefined && inEl.dataset.pair !== pairKey) inEl.dataset.auto = '1';
    inEl.dataset.pair = pairKey;
    if (accFrom.currency === accTo.currency) {
        // 同币种：只需输入一个金额，转入金额自动等于转出金额
        if (direction === 'out') {
            inEl.value = outEl.value;
            inEl.dataset.auto = '1';     // 同币种时转入金额是镜像值，不是用户输入
        } else if (direction === 'in') {
            outEl.value = inEl.value;
        } else {
            // 账户切换触发（无 direction）：哪个有值就同步到另一个，都有值以 out 为准
            if (outEl.value) inEl.value = outEl.value;
            else if (inEl.value) outEl.value = inEl.value;
        }
    } else {
        // 跨币种：用户手动改转入金额后不再自动估算
        if (direction === 'in') inEl.dataset.auto = '';
        else autoEstimateTransferIn();
    }
    refreshTransferLayout();
}

function deleteTransaction(id) {
    const t = transactions.find(x => x.id === id);
    if (!t) { uiAlert('找不到记录'); return; }
    let feeRecToDelete = null;   // 这笔转账的手续费记录（有的话一并删除）

    let pairIds = null;          // 要一起删除的转账记录 id（转出 + 转入）
    if (t.isTransfer) {
        const pr = resolveTransferPair(t);
        if (pr.orphan) {
            // 另一半已不存在：谁拥有这条记录，谁可以删除它
            if (t.ownerName !== currentUserName) { uiAlert('无权删除此转账'); return; }
            pairIds = [t.id];
            if (pr.tOut) feeRecToDelete = getTransferFeeRecord(pr.tOut);
        } else {
            if (pr.tOut.ownerName !== currentUserName) { uiAlert('无权删除此转账'); return; }
            pairIds = [pr.tOut.id, pr.tIn.id];
            feeRecToDelete = getTransferFeeRecord(pr.tOut);
        }
    } else {
        if (t.ownerName !== currentUserName) { uiAlert('无权删除此交易'); return; }
    }

    // 删除前留一份快照，用于底部“撤销”（比弹确认框更顺手，也真的能挽回误删）
    const snapTransactions = transactions.slice();
    const snapDeletedLog = (inMemoryLoadedData.deletedLog || []).slice();
    const snapCount = transactions.length;

    {
        const now = Date.now();
        // 收集要删除的id，写入删除日志
        let deletedIds = [];
        if (t.isTransfer) {
            // 有配对 id 的：同一 transferPairId 的全部记录；老数据：只删找到的这一对（不再按“同一天 + 账户”误伤别的转账）
            deletedIds = t.transferPairId != null
                ? transactions.filter(x => x.isTransfer && _sameId(x.transferPairId, t.transferPairId)).map(x => x.id)
                : pairIds.slice();
            transactions = transactions.filter(x => !deletedIds.includes(x.id));
        } else {
            deletedIds = [id];
            transactions = transactions.filter(x => x.id !== id);
        }
        if (feeRecToDelete) {
            deletedIds.push(feeRecToDelete.id);
            transactions = transactions.filter(x => x.id !== feeRecToDelete.id);
        }
        // 写入删除日志到根数据
        if (!inMemoryLoadedData.deletedLog) inMemoryLoadedData.deletedLog = [];
        deletedIds.forEach(did => {
            if (!inMemoryLoadedData.deletedLog.find(e => e.id === did)) {
                inMemoryLoadedData.deletedLog.push({ id: did, deletedAt: now });
            }
        });
        // 只保留 DELETED_LOG_RETENTION_DAYS 天内的日志（需与 loadFromDrive 的 STALE_CACHE_DAYS 保持 ≥2倍安全边际）
        const cutoff = now - DELETED_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        inMemoryLoadedData.deletedLog = inMemoryLoadedData.deletedLog.filter(e => e.deletedAt > cutoff);

        saveUserData(); triggerAutoSave(); filterUserData();
        displayedTransactionCount = 100;
        renderAllTransactions(); renderAccounts();
        if ($('view-stats').classList.contains('active-view')) renderStats();
    }

    const removedCount = Math.max(1, snapCount - transactions.length - (feeRecToDelete ? 1 : 0));
    showUndo(`已删除 ${removedCount} 笔${t.isTransfer ? '转账' : '交易'}${feeRecToDelete ? '（含手续费）' : ''}`, () => {
        transactions = snapTransactions;
        inMemoryLoadedData.deletedLog = snapDeletedLog;
        saveUserData(); triggerAutoSave(); filterUserData();
        displayedTransactionCount = 100;
        renderAllTransactions(); renderAccounts();
        if ($('view-stats').classList.contains('active-view')) renderStats();
        if (currentDetailAccountId) refreshDetailContent(currentDetailAccountId);
        showToast('已撤销，记录已恢复', 'info', 2000);
    });
}

function openEditTransaction(id) {
    const t = transactions.find(x => x.id == id);
    if (!t) { uiAlert('找不到此交易'); return; }
    if (t.isTransfer) { openEditTransfer(id); return; }

    const isOwner = t.ownerName === currentUserName;
    const readOnly = !isOwner;

    $('edit-trans-id').value = t.id;
    $('edit-trans-mode').value = readOnly ? 'view' : 'edit';
    $('editTransactionModalTitle').textContent = readOnly ? `查看交易（${t.ownerName}）` : '编辑交易';
    $('edit-trans-submit-btn').textContent = '保存修改';
    $('edit-trans-submit-btn').style.display = readOnly ? 'none' : '';
    $('edit-trans-delete-btn').style.display = 'none';
    if (!readOnly) $('edit-trans-delete-btn').style.removeProperty('display');
    $('edit-trans-date').value = t.date;
    // 查看别人的交易时，需确保对方账户在下拉选项里
    if (readOnly && t.ownerName !== currentUserName) {
        const sel = $('edit-trans-account');
        if (sel && ![...sel.options].find(o => o.value == t.accountId)) {
            const ownerAcc = accounts.find(a => a.id == t.accountId);
            if (ownerAcc) {
                const name = `${getAccountDisplayName(ownerAcc)} (${CURRENCY_SYMBOLS[ownerAcc.currency] || ownerAcc.currency})`;
                const opt = new Option(name, ownerAcc.id);
                opt.setAttribute('data-name', name);
                sel.add(opt);
                accSelectBuild('edit-trans-account');
            }
        }
    }
    $('edit-trans-account').value = t.accountId; accSelectSync('edit-trans-account');
    $('edit-trans-tags').value = t.tags || '';
    $('edit-trans-desc').value = t.desc || '';
    // 编辑时隐藏 tab bar（固定类型）
    $('trans-tab-bar').style.display = 'none';
    resetMetaFieldsCollapse();
    switchTransTab(t.type, true);
    // 加载分录
    if (t.items && t.items.length > 1) {
        loadInlineItems(t.items, t.type);
    } else {
        resetInlineItems();
        $('edit-trans-category').value = t.category;
        $('edit-trans-amount').value = Math.abs(t.amount);
        catGridSync('edit-trans-category', 'cat-grid-edit-trans-category');
    }
    updateAmountCurrencySymbol();
    // 加载附件
    resetAttachmentUI();
    if (t.attachmentId) {
        $('edit-trans-attachment-id').value = t.attachmentId;
        const ids = t.attachmentId.split(',').filter(id => id.trim());
        renderAttachmentThumbs(ids);
    }
    // 只读模式：禁用所有表单控件
    const form = $('edit-transaction-form');
    form.querySelectorAll('input,select,textarea,button[type="button"]:not([data-bs-dismiss])').forEach(el => {
        if (el.id === 'edit-trans-submit-btn' || el.id === 'edit-trans-delete-btn') return;
        el.disabled = readOnly;
    });
    $('editTransactionModal').querySelector('.trans-modal-v2')?.classList[readOnly ? 'add' : 'remove']('view-only');
    new bootstrap.Modal($('editTransactionModal')).show();
}

function openEditTransfer(id) {
    const pool = transactions;

    const t = pool.find(x => x.id === id);
    if (!t || !t.isTransfer) return;

    const pr = resolveTransferPair(t, pool);
    if (pr.orphan) { handleOrphanTransfer(t); return; }   // 另一半已不存在：说明情况，是自己的记录可删除
    const tOut = pr.tOut, tIn = pr.tIn;

    // 只读判断：非本人转账
    const isOwner = tOut.ownerName === currentUserName;
    const readOnly = !isOwner;

    $('edit-transfer-id').value = tOut.id;
    $('edit-transfer-mode').value = readOnly ? 'view' : 'edit';
    $('editTransactionModalTitle').textContent = readOnly
        ? `查看转账（${tOut.ownerName}）`
        : '编辑转账';
    $('edit-transfer-submit-btn').style.display = readOnly ? 'none' : '';
    $('edit-transfer-delete-btn').style.display = readOnly ? 'none' : '';
    if (!readOnly) {
        $('edit-transfer-submit-btn').textContent = '保存修改';
        $('edit-transfer-delete-btn').style.removeProperty('display');
    }
    $('edit-transfer-date').value = tOut.date;
    $('trans-tab-bar').style.display = 'none';
    switchTransTab('transfer', true);
    // switchTransTab 会按“新增”重置标题；刚新增过转账再打开编辑时会显示成“新增转账”，所以在它之后再设一次
    $('editTransactionModalTitle').textContent = readOnly ? `查看转账（${tOut.ownerName}）` : '编辑转账';
    fillTransferSelects(tOut.accountId, tIn.accountId);
    // 收款人查看他人发起的转账时，转出账户不在自己的账户列表里：补上一项，才能显示转出账户名称
    {
        const fromSel = $('edit-transfer-from');
        if (![...fromSel.options].some(o => o.value == tOut.accountId)) {
            const fromAcc = accounts.find(a => a.id == tOut.accountId);
            if (fromAcc) {
                const nm = `${getAccountDisplayName(fromAcc)} (${CURRENCY_SYMBOLS[fromAcc.currency]})`;
                const opt = new Option(nm, fromAcc.id);
                opt.setAttribute('data-name', nm);
                fromSel.add(opt);
                fromSel.value = tOut.accountId;
                accSelectSync('edit-transfer-from');
            }
        }
    }
    $('edit-transfer-amount-out').value = Math.abs(tOut.amount);
    $('edit-transfer-amount-in').value = Math.abs(tIn.amount);
    $('edit-transfer-desc').value = tOut.desc || '';
    // 重置并按已有数据展开
    resetMetaFieldsCollapse();
    expandTransferDescForExistingData(tOut.desc);
    loadTransferFeeUI(tOut, readOnly);

    // 只读模式：禁用所有转账表单控件
    const form = $('editTransactionModal');
    form.querySelectorAll('input,select,textarea').forEach(el => {
        if (['edit-transfer-id','edit-transfer-mode'].includes(el.id)) return;
        el.disabled = readOnly;
    });
    $('editTransactionModal').querySelector('.trans-modal-v2')?.classList[readOnly ? 'add' : 'remove']('view-only');

    new bootstrap.Modal($('editTransactionModal')).show();
}

// showTransItemsDetail: 直接打开编辑窗口（拆分内容在编辑窗口内显示）
function showTransItemsDetail(t) {
    openedFromDetail = !!currentDetailAccountId;
    openEditTransaction(t.id);
}

function maybeReturnToDetail() {
    if (openedFromDetail && currentDetailAccountId) {
        openedFromDetail = false;
        refreshDetailContent(currentDetailAccountId);
    } else {
        openedFromDetail = false;
    }
}

function deleteCurrentTransaction() {
    const id = parseFloat($('edit-trans-id').value);
    bootstrap.Modal.getInstance($('editTransactionModal')).hide();
    deleteTransaction(id);
    maybeReturnToDetail();
}

function deleteCurrentTransfer() {
    const id = parseFloat($('edit-transfer-id').value);
    bootstrap.Modal.getInstance($('editTransactionModal')).hide();
    deleteTransaction(id);
    maybeReturnToDetail();
}
