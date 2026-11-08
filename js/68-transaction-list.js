// @file js/68-transaction-list.js
// 首页概览（本月支出/收入/结余/预算）+ 按日期分组的交易列表 + “加载更多”。

/* ─────────────────────────────────────────────────── */

/** 分类名 → 图标。先查用户自定义/精确映射，再按关键词模糊匹配，最后用通用标签图标。 */
function getCategoryIconByName(name) {
    const raw = String(name || '').trim();
    if (!raw) return { icon: 'bi-tag-fill', color: 'var(--app-muted)' };
    if (categoryIcons[raw] || CATEGORY_ICON_MAP[raw]) return getCatIcon(raw);
    if (raw.length >= 2) {
        const keys = Object.keys(CATEGORY_ICON_MAP);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (raw.includes(k) || k.includes(raw)) return CATEGORY_ICON_MAP[k];
        }
    }
    return { icon: 'bi-tag-fill', color: 'var(--app-muted)' };
}

function _txDateLabel(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);
    if (diff === 0) return '今天';
    if (diff === -1) return '昨天';
    if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function _fmtRmb(n) {
    return '¥' + formatAmount(Math.abs(Number(n) || 0), 'RMB');
}

/** 首页概览：本月支出大数字、收入、结余、预算进度（没有预算就不显示进度条）。 */
function renderTransactionsHero() {
    const expEl = $('tx-hero-expense');
    if (!expEl) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const start = formatLocal(new Date(y, m, 1));
    const end = formatLocal(new Date(y, m + 1, 0));

    let income = 0, expense = 0;
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    for (let i = 0; i < transactions.length; i++) {
        const t = transactions[i];
        if (t._isBaseline || t.isTransfer) continue;
        if (currentUserName && t.ownerName !== currentUserName) continue;
        if (t.date < start || t.date > end) continue;
        const acc = accMap.get(String(t.accountId));
        if (!acc) continue;
        const v = toRmb(parseFloat(t.amount) || 0, acc.currency);
        if (v < 0) expense += -v; else income += v;
    }

    const hidden = amountsHidden ? 'amount-hidden' : '';
    const monthEl = $('tx-hero-month');
    if (monthEl) monthEl.textContent = `${m + 1}月`;
    expEl.textContent = _fmtRmb(expense);
    expEl.className = 'tx-hero-amount ' + hidden;
    const incEl = $('tx-hero-income');
    if (incEl) { incEl.textContent = _fmtRmb(income); incEl.className = hidden; }
    const netEl = $('tx-hero-net');
    if (netEl) { netEl.textContent = _fmtRmb(income - expense); netEl.className = hidden; }

    // 预算进度：只有设置过预算才显示；总预算优先，否则把各分类预算相加
    const budgetWrap = $('tx-hero-budget');
    if (!budgetWrap) return;
    let totalBudget = 0;
    if (Array.isArray(budgets) && budgets.length) {
        const totalRow = budgets.find(b => b.category === '__total__');
        if (totalRow) {
            totalBudget = toRmb(parseFloat(totalRow.amount) || 0, totalRow.currency || 'RMB');
        } else {
            budgets.forEach(b => {
                totalBudget += toRmb(parseFloat(b.amount) || 0, b.currency || 'RMB');
            });
        }
    }
    if (!(totalBudget > 0)) {
        budgetWrap.style.display = 'none';
        return;
    }
    const pct = Math.min(100, Math.round((expense / totalBudget) * 100));
    const over = expense > totalBudget;
    budgetWrap.style.display = '';
    const label = $('tx-hero-budget-label');
    if (label) label.textContent = over ? '本月预算 · 已超支' : '本月预算';
    const text = $('tx-hero-budget-text');
    if (text) {
        text.textContent = `${pct}% · ${over ? '超' : '余'} ${_fmtRmb(Math.abs(totalBudget - expense))}`;
        text.className = hidden;
    }
    const fill = $('tx-hero-budget-fill');
    if (fill) {
        fill.style.width = pct + '%';
        fill.classList.toggle('is-over', over);
    }
}

/** 某个日期在筛选结果里的当日合计（转账不计入）。 */
function _dayTotalFor(dateStr, filtered, accMap) {
    let expense = 0, income = 0;
    for (let i = 0; i < filtered.length; i++) {
        const t = filtered[i];
        if (t.date !== dateStr || t.isTransfer) continue;
        const acc = accMap.get(String(t.accountId));
        if (!acc) continue;
        const v = toRmb(parseFloat(t.amount) || 0, acc.currency);
        if (v < 0) expense += -v; else income += v;
    }
    if (expense > 0) return { cls: 'is-expense', text: `支出 ${_fmtRmb(expense)}` };
    if (income > 0) return { cls: 'is-income', text: `收入 ${_fmtRmb(income)}` };
    return null;
}

function _createDayGroup(dateStr, filtered, accMap) {
    const group = document.createElement('div');
    group.className = 'tx-day-group';
    const total = _dayTotalFor(dateStr, filtered, accMap);
    const hidden = amountsHidden ? 'amount-hidden' : '';
    group.innerHTML = `
        <div class="tx-day-head">
            <span class="tx-day-label">${_escHtml(_txDateLabel(dateStr))}</span>
            ${total ? `<span class="tx-day-total ${total.cls} ${hidden}">${total.text}</span>` : ''}
        </div>
        <div class="tx-day-rows"></div>`;
    return group;
}

/** 单条交易行。结构：分类图标 / 分类 + 备注·账户 / 金额。 */
function _buildTransactionCard(t, accMap, batchEditMode, batchSelectedIds) {
    const acc = accMap.get(String(t.accountId));
    if (!acc) return null;

    const accDisplayName = getAccountDisplayName(acc);
    const descClean = t.desc || '';
    const isSplit = t.items && t.items.length > 1;
    const isTransfer = !!t.isTransfer;
    const firstItem = isSplit ? t.items[0] : null;
    const catName = isTransfer ? '转账' : (isSplit ? firstItem.category : (t.category || '未分类'));
    const meta = getCategoryIconByName(catName);
    const hidden = amountsHidden ? 'amount-hidden' : '';
    const badge = getTxnBadge(t);

    const card = document.createElement('div');
    card.className = 'mobile-transaction-card';
    card.dataset.ttype = t.type;
    card.dataset.id = t.id;

    const isBatchable = !isTransfer && !isSplit && t.ownerName === currentUserName;
    if (batchEditMode) card.classList.toggle('batch-selected', batchSelectedIds.has(t.id));

    let tagsText = '';
    let noteText = '';
    if (isSplit) {
        const allTags = t.items.map(it => it.tags).filter(Boolean);
        const allDesc = t.items.map(it => it.desc).filter(Boolean);
        tagsText = allTags.join(' / ');
        noteText = allDesc.join(' / ');
    } else {
        tagsText = t.tags || '';
        noteText = descClean;
    }

    const catDisplay = isSplit
        ? `${firstItem.category}等${t.items.length - 1}项`
        : catName;

    let amountClass, amountText, subText, iconClass, iconColor;
    if (isTransfer && t.type === 'expense') {
        const accTo = accMap.get(String(t.relatedAccountId));
        if (!accTo) return null;
        let tIn = t.transferPairId
            ? transactions.find(tx => tx.transferPairId === t.transferPairId && tx.type === 'income')
            : transactions.find(tx => tx.isTransfer && tx.type === 'income' && tx.date === t.date && tx.relatedAccountId == t.accountId);
        const amountIn = tIn ? Math.abs(tIn.amount) : Math.abs(t.amount);
        amountClass = 'is-transfer';
        amountText = `${CURRENCY_SYMBOLS[acc.currency] || ''}${formatAmount(Math.abs(t.amount), acc.currency)}`;
        if (acc.currency !== accTo.currency) {
            subText = `${accDisplayName} → ${getAccountDisplayName(accTo)} · ${CURRENCY_SYMBOLS[accTo.currency] || ''}${formatAmount(amountIn, accTo.currency)}`;
        } else {
            subText = `${accDisplayName} → ${getAccountDisplayName(accTo)}`;
        }
        iconClass = 'bi-arrow-left-right';
        iconColor = 'var(--app-transfer)';
    } else {
        const positive = (parseFloat(t.amount) || 0) >= 0;
        amountClass = positive ? 'is-income' : 'is-expense';
        amountText = `${positive ? '+' : '-'}${CURRENCY_SYMBOLS[acc.currency] || ''}${formatAmount(Math.abs(t.amount), acc.currency)}`;
        subText = accDisplayName;
        iconClass = meta.icon;
        iconColor = meta.color;
    }

    const tagHtml = tagsText
        ? `<span class="tx-tag"><i class="bi bi-tag" style="font-size:0.6rem;"></i> ${_escHtml(tagsText)}</span>`
        : '';
    const attachHtml = t.attachmentId
        ? ` <i class="bi bi-paperclip" style="font-size:0.64rem;"></i>`
        : '';

    const contentHtml = `
        <div class="tx-row-inner">
            ${batchEditMode && isBatchable ? `<input type="checkbox" class="form-check-input batch-edit-checkbox" ${batchSelectedIds.has(t.id) ? 'checked' : ''} onclick="event.stopPropagation();toggleBatchSelect(${t.id})">` : ''}
            <span class="tx-row-icon" style="--cat-color:${iconColor}"><i class="bi ${iconClass}"></i></span>
            <div class="tx-row-main">
                <div class="tx-row-cat"><span class="tx-cat-name">${_escHtml(catDisplay)}</span>${badge}${tagHtml}${attachHtml}</div>
                <div class="tx-row-sub">${noteText ? `${_escHtml(noteText)}<span class="tx-dot">·</span>` : ''}${_escHtml(subText)}</div>
            </div>
            <div class="tx-row-amt ${amountClass} ${hidden}">${amountText}</div>
        </div>`;
    card.innerHTML = contentHtml;

    if (batchEditMode) {
        if (isBatchable) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => toggleBatchSelect(t.id));
        } else {
            card.style.opacity = '0.5';
        }
    } else if (t.ownerName === currentUserName) {
        initMobileSwipeGestures(card, t.id);
    } else if (!isTransfer) {
        card.style.opacity = '0.85';
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => openEditTransaction(t.id));
    } else {
        card.style.opacity = '0.75';
    }
    return card;
}

function renderAllTransactions() {
    _statsDataVersion++; // 交易数据可能已变化，使统计页缓存失效
    renderTransactionsHero();

    const mobileContainer = $('mobile-transaction-cards');
    if (mobileContainer) mobileContainer.innerHTML = '';

    let filtered = getFilteredTransactions();
    filtered.sort((a, b) => {
        if (currentSortField === 'date') {
            const dc = currentSortDirection === 'asc' ? (a.date > b.date ? 1 : a.date < b.date ? -1 : 0) : (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
            return dc !== 0 ? dc : b.id - a.id;
        }
        let valA, valB;
        if (currentSortField === 'amount') { valA = Math.abs(a.amount); valB = Math.abs(b.amount); }
        else if (currentSortField === 'category') { valA = a.category; valB = b.category; }
        else if (currentSortField === 'account') { valA = a.accountId; valB = b.accountId; }
        else if (currentSortField === 'desc') { valA = a.desc; valB = b.desc; }
        else if (currentSortField === 'tags') { valA = a.tags || ''; valB = b.tags || ''; }
        else if (currentSortField === 'user') { valA = a.ownerName; valB = b.ownerName; }
        else { valA = a[currentSortField]; valB = b[currentSortField]; }
        return currentSortDirection === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });

    const displayData = filtered.slice(0, Math.min(displayedTransactionCount, filtered.length));

    if (mobileContainer) {
        const accMap = new Map(accounts.map(a => [String(a.id), a]));
        const groupByDate = currentSortField === 'date';
        const frag = document.createDocumentFragment();
        let currentDate = null;
        let currentRows = null;

        displayData.forEach(t => {
            // 转账只显示支出侧
            if (t.isTransfer && t.type === 'income') return;
            const acc = accMap.get(String(t.accountId));
            if (!acc) return;

            if (groupByDate) {
                if (t.date !== currentDate) {
                    currentDate = t.date;
                    const group = _createDayGroup(t.date, filtered, accMap);
                    frag.appendChild(group);
                    currentRows = group.querySelector('.tx-day-rows');
                }
            }

            const card = _buildTransactionCard(t, accMap, batchEditMode, batchSelectedIds);
            if (!card) return;
            if (groupByDate && currentRows) currentRows.appendChild(card);
            else frag.appendChild(card);
        });
        mobileContainer.appendChild(frag);
    }

    const loadMoreContainer = $('load-more-container');
    const mobileLoadMore = $('mobile-load-more-container');
    if (filtered.length > displayedTransactionCount) {
        if (loadMoreContainer) loadMoreContainer.classList.remove('d-none');
        if (mobileLoadMore) mobileLoadMore.classList.remove('d-none');
    } else {
        if (loadMoreContainer) loadMoreContainer.classList.add('d-none');
        if (mobileLoadMore) mobileLoadMore.classList.add('d-none');
    }
}

function loadMoreTransactions() {
    displayedTransactionCount += 100;
    renderAllTransactions();
}
