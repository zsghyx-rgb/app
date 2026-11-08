// @file js/50-accounts.js
// 账户列表渲染与拖拽排序、余额计算、新增/编辑/删除/隐藏账户、账户表单提交。

function getAccountDisplayName(acc) {
    if (!acc) return '';
    if (acc.ownerName && acc.ownerName !== currentUserName) {
        const initial = acc.ownerName.charAt(0).toLowerCase();
        return `[${initial}]${acc.name}`;
    }
    return acc.name;
}

function renderAccounts() {
    const container = $('account-list-container');
    const otherContainer = $('other-users-accounts-container');
    container.innerHTML = '';
    otherContainer.innerHTML = '';

    let totalAssets = 0, totalLiabilities = 0;
    accounts.forEach(acc => {
        // 隐藏账户 / 标记为“不计入总资产汇总”的账户，不参与总资产、总负债、净值的计算
        if (acc.hidden || acc.excludeFromTotal) return;
        const bal = calculateBalance(acc.id);
        // 与统计页一致：按当前显示币种折算
        const dispVal = convertAmt(bal, acc.currency);
        if (acc.accountType === 'Liability') totalLiabilities += dispVal;
        else totalAssets += dispVal;
    });

    const dispCurrency = currentStatsFilter.currency || 'RMB';
    const dispSymbol = CURRENCY_SYMBOLS[dispCurrency] || dispCurrency;
    const hiddenClass = amountsHidden ? 'amount-hidden' : '';
    $('net-worth-display').innerHTML = `
        <div class="hero-eyebrow">净资产</div>
        <div class="hero-big ${hiddenClass}">${dispSymbol}${(totalAssets + totalLiabilities).toFixed(2)}</div>
        <div class="hero-split">
            <span>总资产 <b class="${hiddenClass}">${dispSymbol}${totalAssets.toFixed(2)}</b></span>
            <span>总负债 <b class="${hiddenClass}">${dispSymbol}${Math.abs(totalLiabilities).toFixed(2)}</b></span>
        </div>`;

    ['Asset', 'Liability', 'Receivable'].forEach(type => {
        // 隐藏账户不在账户页面显示
        const rawAccs = userAccounts.filter(a => (a.accountType || 'Asset') === type && !a.hidden);
        if (rawAccs.length === 0) return;
        const myTypeAccs = sortedUserAccounts(rawAccs);
        const accent = type === 'Liability' ? 'var(--app-expense)' : (type === 'Asset' ? 'var(--app-income)' : 'var(--app-transfer)');
        const typeLabel = type === 'Asset' ? '资产' : (type === 'Liability' ? '负债' : '应收');
        const typeIcon = type === 'Asset' ? 'bi-bank' : (type === 'Liability' ? 'bi-credit-card-2-front' : 'bi-hourglass-split');
        container.innerHTML += `<h6 class="account-group-title" style="--group-color:${accent}">${typeLabel}</h6>`;
        const row = document.createElement('div');
        row.className = 'd-flex flex-wrap g-3 gap-3';
        row.dataset.accType = type;
        myTypeAccs.forEach(acc => {
            const bal = calculateBalance(acc.id);
            const col = document.createElement('div');
            col.className = 'account-col';
            col.dataset.accId = acc.id;
            const balClass = amountsHidden ? 'amount-hidden' : (bal < 0 ? 'text-danger' : 'text-success');
            const excludeBadge = acc.excludeFromTotal
                ? `<span class="badge bg-secondary" style="font-size:0.6rem;font-weight:normal;" title="不计入总资产/总负债/净值汇总">不计入汇总</span>`
                : '';
            col.innerHTML = `
                <div class="card account-card p-3 d-flex flex-row align-items-center gap-3"
                     data-id="${acc.id}" style="cursor:pointer;">
                    <div class="account-card-icon"><i class="bi ${typeIcon}"></i></div>
                    <div class="flex-grow-1" style="min-width:0;" onclick="openAccountDetail(${acc.id})">
                        <div class="d-flex justify-content-between align-items-start gap-2">
                            <div style="flex:1;min-width:0;">
                                <div class="fw-bold text-truncate">${acc.name} <span class="fw-normal text-muted" style="font-size:0.72rem;">${acc.currency}</span> ${excludeBadge}</div>
                                ${acc.notes ? `<div class="small text-muted text-truncate" title="${acc.notes}">${acc.notes}</div>` : ''}
                            </div>
                            <div class="text-end" style="flex-shrink:0;">
                                <div class="account-balance ${balClass}">${CURRENCY_SYMBOLS[acc.currency]}${formatAmount(bal, acc.currency)}</div>
                                <small class="text-muted"><i class="bi bi-chevron-right"></i></small>
                            </div>
                        </div>
                    </div>
                </div>`;
            row.appendChild(col);
        });
        container.appendChild(row);
    });

    const otherAccs = accounts.filter(a => a.ownerName !== currentUserName && !a.hidden);
    if (otherAccs.length > 0) {
        otherContainer.innerHTML = `<h6 class="account-group-title" style="--group-color:var(--app-muted)">其他用户的账户</h6>`;
        const otherRow = document.createElement('div');
        otherRow.className = 'd-flex flex-wrap g-3 gap-3';
        // 按各用户自己的 accountOrder 排序
        const sortedOthers = [...otherAccs].sort((a, b) => {
            const orderA = (inMemoryLoadedData.allUserData[a.ownerName] || {}).accountOrder || [];
            const orderB = (inMemoryLoadedData.allUserData[b.ownerName] || {}).accountOrder || [];
            const ia = orderA.indexOf(a.id) >= 0 ? orderA.indexOf(a.id) : 9999;
            const ib = orderB.indexOf(b.id) >= 0 ? orderB.indexOf(b.id) : 9999;
            return a.ownerName === b.ownerName ? ia - ib : 0;
        });
        sortedOthers.forEach(acc => {
            const bal = calculateBalance(acc.id);
            const col = document.createElement('div');
            col.className = 'account-col';
            col.dataset.accId = acc.id;
            col.draggable = true;
            const balClass = amountsHidden ? 'amount-hidden' : (bal < 0 ? 'text-danger' : 'text-success');
            const initial = acc.ownerName.charAt(0).toLowerCase();
            const otherExcludeBadge = acc.excludeFromTotal
                ? `<span class="badge bg-secondary" style="font-size:0.6rem;font-weight:normal;" title="不计入总资产/总负债/净值汇总">不计入汇总</span>`
                : '';
            col.innerHTML = `
                <div class="card account-card account-card-other p-3 shadow-sm">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <div class="fw-bold text-truncate">[${initial}] ${acc.name} ${otherExcludeBadge}</div>
                            <div class="small text-muted">${acc.currency}</div>
                        </div>
                        <div class="text-end">
                            <h5 class="mb-0 ${balClass}">${CURRENCY_SYMBOLS[acc.currency]}${formatAmount(bal, acc.currency)}</h5>
                        </div>
                    </div>
                </div>`;
            otherRow.appendChild(col);
        });
        otherContainer.appendChild(otherRow);
    }
    updateSelectOptions();
    // Update currency buttons in stats view to reflect available account currencies
    renderStatsCurrencyButtons();
    _initAccountDrag();
    renderHiddenAccountsList();
}

function _saveAccountOrder() {
    const order = [];
    $$('#account-list-container .account-col').forEach(c => {
        if (c.dataset.accId) order.push(Number(c.dataset.accId));
    });
    saveAccountOrder(order);
    saveUserData();
    triggerAutoSave();
}

function _initAccountDrag() {
    let dragSrc = null;
    const cols = $$('#account-list-container .account-col');
    cols.forEach(col => {
        // ── 桌面：HTML5 drag ──
        col.addEventListener('dragstart', e => {
            dragSrc = col;
            setTimeout(() => col.classList.add('dragging'), 0);
            e.dataTransfer.effectAllowed = 'move';
        });
        col.addEventListener('dragend', () => {
            col.classList.remove('dragging');
            $$('#account-list-container .account-col').forEach(c => c.classList.remove('drag-over'));
            _saveAccountOrder();
        });
        col.addEventListener('dragover', e => {
            e.preventDefault();
            if (dragSrc && dragSrc !== col) {
                $$('#account-list-container .account-col').forEach(c => c.classList.remove('drag-over'));
                col.classList.add('drag-over');
            }
        });
        col.addEventListener('drop', e => {
            e.preventDefault();
            if (!dragSrc || dragSrc === col) return;
            col.classList.remove('drag-over');
            const parent = col.parentNode;
            const cols2 = [...parent.children];
            const srcIdx = cols2.indexOf(dragSrc);
            const dstIdx = cols2.indexOf(col);
            if (srcIdx < dstIdx) parent.insertBefore(dragSrc, col.nextSibling);
            else parent.insertBefore(dragSrc, col);
        });
        // ── 手机：touch 长按拖拽 ──
        let touchTimer = null, isTouchDragging = false, touchClone = null;
        col.addEventListener('touchstart', e => {
            touchTimer = setTimeout(() => {
                isTouchDragging = true;
                dragSrc = col;
                col.classList.add('dragging');
                touchClone = col.cloneNode(true);
                touchClone.style.cssText = 'position:fixed;opacity:.7;pointer-events:none;z-index:9999;width:' + col.offsetWidth + 'px;';
                document.body.appendChild(touchClone);
                const r = col.getBoundingClientRect();
                touchClone.style.left = r.left + 'px';
                touchClone.style.top  = r.top  + 'px';
            }, 400);
        }, { passive: true });
        col.addEventListener('touchmove', e => {
            clearTimeout(touchTimer);
            if (!isTouchDragging || !touchClone) return;
            e.preventDefault();
            const touch = e.touches[0];
            touchClone.style.left = (touch.clientX - col.offsetWidth / 2) + 'px';
            touchClone.style.top  = (touch.clientY - 30) + 'px';
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            const target = el && el.closest('.account-col');
            $$('#account-list-container .account-col').forEach(c => c.classList.remove('drag-over'));
            if (target && target !== dragSrc) target.classList.add('drag-over');
        }, { passive: false });
        col.addEventListener('touchend', e => {
            clearTimeout(touchTimer);
            if (!isTouchDragging) return;
            isTouchDragging = false;
            col.classList.remove('dragging');
            if (touchClone) { touchClone.remove(); touchClone = null; }
            const touch = e.changedTouches[0];
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            const target = el && el.closest('.account-col');
            $$('#account-list-container .account-col').forEach(c => c.classList.remove('drag-over'));
            if (target && target !== dragSrc) {
                const parent = target.parentNode;
                const cols2 = [...parent.children];
                const srcIdx = cols2.indexOf(dragSrc);
                const dstIdx = cols2.indexOf(target);
                if (srcIdx < dstIdx) parent.insertBefore(dragSrc, target.nextSibling);
                else parent.insertBefore(dragSrc, target);
            }
            _saveAccountOrder();
            dragSrc = null;
        });
    });
}

function getOrCreateBalanceAdjCategory(type) {
    const list = type === 'income' ? categories.income : categories.expense;
    const keywords = ['其他', '其它', '余额调整'];
    const found = list.find(c => keywords.some(k => c === k || c.includes(k)));
    if (found) return found;
    // 未找到，创建「余额调整」分类
    list.push('余额调整');
    markConfigUpdated(); saveUserData();
    return '余额调整';
}

// 金额运算用，避免浮点误差导致出现多位小数（如 0.1+0.2 = 0.30000000000000004）
function roundMoney(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function calculateBalance(accId) {
    const acc = accounts.find(a => a.id == accId);
    let bal = parseFloat(acc.initialBalance);
    transactions.filter(t => t.accountId == accId).forEach(t => bal += parseFloat(t.amount));
    return roundMoney(bal);
}

function deleteAccount(id) {
    const hasTransactions = transactions.some(t => t.accountId == id || (t.relatedAccountId && t.relatedAccountId == id));
    if (hasTransactions) {
        uiAlert(`该账户已有交易流水，无法删除！\n请先删除或转移相关交易记录。`);
        return;
    }
    const index = accounts.findIndex(a => a.id == id);
    if (index < 0) return;

    const snapAccounts = accounts.slice();
    const snapDeletedLog = (inMemoryLoadedData.deletedLog || []).slice();
    const removed = accounts.splice(index, 1)[0];

    // 写入删除日志，防止多设备同步时被恢复
    if (!inMemoryLoadedData.deletedLog) inMemoryLoadedData.deletedLog = [];
    const strId = String(id);
    if (!inMemoryLoadedData.deletedLog.find(e => String(e.id) === strId)) {
        inMemoryLoadedData.deletedLog.push({ id: strId, deletedAt: Date.now(), type: 'account' });
    }
    filterUserData();
    renderAccounts();
    updateSelectOptions();
    triggerAutoSave();
    showToast('账户已删除', 'success', 2200);

    showUndo(`已删除账户「${removed.name}」`, () => {
        accounts = snapAccounts;
        inMemoryLoadedData.deletedLog = snapDeletedLog;
        filterUserData();
        renderAccounts();
        updateSelectOptions();
        triggerAutoSave();
        showToast('已撤销，账户已恢复', 'info', 2000);
    });
}

function openNewAccount() {
    $('acc-id').value = '';
    $('acc-mode').value = 'add';
    $('accountModalTitle').textContent = '新增账户';
    $('acc-submit-btn').textContent = '保存';
    $('acc-name').value = '';
    $('acc-type').value = 'Asset';
    $('acc-currency').value = 'RMB';
    $('acc-balance').value = '0';
    $('acc-add-only-fields').style.display = '';
    $('acc-balance-label').textContent = '初始余额';
    $('acc-balance-hint').classList.add('d-none');
    $('acc-notes').value = '';
    $('acc-exclude-total').checked = false;
    $('acc-hide-btn').classList.add('d-none');
    new bootstrap.Modal($('accountModal')).show();
}

function openEditAccount(id) {
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    $('acc-id').value = id;
    $('acc-mode').value = 'edit';
    $('accountModalTitle').textContent = '编辑账户';
    $('acc-submit-btn').textContent = '保存修改';
    $('acc-name').value = acc.name;
    $('acc-balance').value = calculateBalance(id).toFixed(2);
    $('acc-add-only-fields').style.display = 'none';
    $('acc-balance-label').textContent = '账户余额';
    $('acc-balance-hint').classList.remove('d-none');
    $('acc-notes').value = acc.notes || '';
    $('acc-exclude-total').checked = !!acc.excludeFromTotal;
    const hideBtn = $('acc-hide-btn');
    hideBtn.classList.remove('d-none');
    hideBtn.innerHTML = acc.hidden
        ? '<i class="bi bi-eye"></i> 取消隐藏（恢复显示）'
        : '<i class="bi bi-eye-slash"></i> 隐藏此账户';
    new bootstrap.Modal($('accountModal')).show();
}

/** 在编辑账户弹窗内点击“隐藏此账户”/“取消隐藏” */
async function toggleAccountHiddenFromModal() {
    const id = parseInt($('acc-id').value);
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    const willHide = !acc.hidden;
    if (willHide) {
        const ok = await uiConfirm(`隐藏账户「${acc.name}」？\n\n隐藏后该账户不再显示在账户页和交易页，可在「设置 → 账户与用户 → 隐藏账户管理」里恢复。`, { okText: '隐藏' });
        if (!ok) return;
    }
    acc.hidden = willHide;
    acc.updatedAt = Date.now();
    saveUserData(); triggerAutoSave(); loadAllData(); filterUserData();
    renderAccounts(); displayedTransactionCount = 100; renderAllTransactions();
    renderHiddenAccountsList();
    bootstrap.Modal.getInstance($('accountModal'))?.hide();
    showToast(willHide ? '账户已隐藏' : '账户已恢复显示', 'success');
    if (willHide && currentDetailAccountId === id) {
        switchTab('accounts', document.querySelector('.nav-link[onclick*=accounts]'));
    }
}

/** 恢复一个隐藏账户（从设置页“隐藏账户管理”列表调用） */
function restoreHiddenAccount(id) {
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    acc.hidden = false;
    acc.updatedAt = Date.now();
    saveUserData(); triggerAutoSave(); loadAllData(); filterUserData();
    renderAccounts(); displayedTransactionCount = 100; renderAllTransactions();
    renderHiddenAccountsList();
    showToast('账户已恢复显示', 'success');
}

/** 渲染“设置 → 账户与用户”页面里的隐藏账户管理列表 */
function renderHiddenAccountsList() {
    const container = $('hidden-accounts-list');
    if (!container) return;
    const hiddenAccs = accounts.filter(a => a.ownerName === currentUserName && a.hidden);
    if (hiddenAccs.length === 0) {
        container.innerHTML = '<p class="text-muted small mb-0">暂无隐藏账户</p>';
        return;
    }
    container.innerHTML = hiddenAccs.map(acc => {
        const bal = calculateBalance(acc.id);
        const balStr = `${CURRENCY_SYMBOLS[acc.currency] || ''}${formatAmount(bal, acc.currency)}`;
        return `<div class="d-flex align-items-center justify-content-between py-2" style="border-bottom:1px solid var(--bs-border-color);">
            <div class="flex-grow-1" style="min-width:0;">
                <div class="fw-bold text-truncate">${_escHtml(acc.name)}</div>
                <div class="small text-muted">${acc.currency} · ${balStr}</div>
            </div>
            <button class="btn btn-sm btn-outline-primary flex-shrink-0" onclick="restoreHiddenAccount(${acc.id})">
                <i class="bi bi-eye"></i> 恢复
            </button>
        </div>`;
    }).join('');
}

$('account-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const mode = $('acc-mode').value;
    const name = $('acc-name').value;
    const balance = roundMoney(parseFloat($('acc-balance').value));
    const notes = $('acc-notes').value.trim();
    const excludeFromTotal = $('acc-exclude-total').checked;

    if (mode === 'add') {
        accounts.push({
            id: Date.now(),
            name,
            accountType: $('acc-type').value,
            currency: $('acc-currency').value,
            initialBalance: balance,
            notes,
            excludeFromTotal,
            ownerName: currentUserName,
            updatedAt: Date.now()
        });
        saveUserData(); triggerAutoSave(); loadAllData(); filterUserData(); renderAccounts();
        bootstrap.Modal.getInstance($('accountModal')).hide();
        e.target.reset();
        if (verboseToast) showToast('账户已添加', 'success');
    } else {
        const id = parseInt($('acc-id').value);
        const acc = accounts.find(a => a.id === id);
        if (acc) {
            const oldBalance = calculateBalance(id);
            const diff = roundMoney(balance - oldBalance);
            acc.name = name;
            acc.notes = notes;
            acc.excludeFromTotal = excludeFromTotal;
            acc.updatedAt = Date.now();
            if (Math.abs(diff) > 0.01) {
                const adjType = diff > 0 ? 'income' : 'expense';
                const adjCategory = getOrCreateBalanceAdjCategory(adjType);
                transactions.unshift({
                    id: Date.now() + Math.random(),
                    date: new Date().toISOString().split('T')[0],
                    type: adjType,
                    accountId: id, amount: diff, category: adjCategory,
                    desc: `余额调整 (${oldBalance.toFixed(2)} → ${balance.toFixed(2)})`,
                    ownerName: currentUserName, isTransfer: false, tags: '', updatedAt: Date.now()
                });
            }
            saveUserData(); triggerAutoSave(); loadAllData(); filterUserData(); renderAccounts();
            displayedTransactionCount = 100; renderAllTransactions();
            bootstrap.Modal.getInstance($('accountModal')).hide();
            if (verboseToast) showToast('账户已更新', 'success');
            if (currentDetailAccountId === id) refreshDetailContent(id);
        }
    }
});
