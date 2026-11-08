// @file js/60-budget.js
// 预算：按分类统计月支出、预算面板渲染、新增/编辑/删除预算。

// ── 预算管理 ────────────────────────────────────────────────────

// 统计指定年月（基于统计页当前导航月份）的支出，按分类汇总（含拆分交易分录）
function computeMonthlySpendByCategory(year, month, filterUser) {
    const mStart = formatLocal(new Date(year, month, 1));
    const mEnd   = formatLocal(new Date(year, month + 1, 0));
    const source = transactions;
    const spend = {};
    let total = 0;
    source.forEach(t => {
        if (t._isBaseline || t.isTransfer || t.amount >= 0) return;
        if (t.date < mStart || t.date > mEnd) return;
        if (filterUser !== 'all' && t.ownerName !== filterUser) return;
        const acc = accounts.find(a => a.id == t.accountId);
        if (!acc) return;
        if (t.items && t.items.length > 1) {
            t.items.forEach(it => {
                const amt = convertAmt(Math.abs(it.amount), acc.currency);
                spend[it.category] = (spend[it.category] || 0) + amt;
                total += amt;
            });
        } else {
            const amt = convertAmt(Math.abs(t.amount), acc.currency);
            spend[t.category] = (spend[t.category] || 0) + amt;
            total += amt;
        }
    });
    return { spend, total };
}

function renderBudgetPane() {
    const wrap = $('budget-list');
    if (!wrap) return;
    const filterUser = currentStatsFilter.user || 'all';
    const { spend, total } = computeMonthlySpendByCategory(statsNavYear, statsNavMonth, filterUser);
    const dispCurrency = currentStatsFilter.currency;

    const labelEl = $('budget-month-label');
    if (labelEl) labelEl.textContent = `${statsNavYear} 年 ${statsNavMonth + 1} 月 · 预算追踪`;

    if (budgets.length === 0) {
        wrap.innerHTML = `<div class="text-center text-muted py-5">
            <i class="bi bi-piggy-bank" style="font-size:2.2rem;opacity:.4;"></i><br>
            还没有设置预算<br>
            <span style="font-size:0.8rem;">点击上方「添加预算」开始追踪每月支出</span>
        </div>`;
        if (typeof renderTransactionsHero === 'function') renderTransactionsHero();
        return;
    }

    const rows = budgets.map(b => {
        // 预算金额按自身设定时的货币存储，展示时统一换算成统计页当前选择的货币，
        // 避免切换统计货币后金额比较出现偏差。未记录货币的旧数据视为当前货币（不做转换）。
        const budgetCurrency = b.currency || dispCurrency;
        const amountInDispCurrency = convertAmt(b.amount, budgetCurrency);
        return {
            ...b,
            spent: b.category === '__total__' ? total : (spend[b.category] || 0),
            amountDisp: amountInDispCurrency
        };
    });
    // 总预算永远置顶，其余按花费金额从高到低排序
    rows.sort((a, b) => {
        if (a.category === '__total__') return -1;
        if (b.category === '__total__') return 1;
        return b.spent - a.spent;
    });

    wrap.innerHTML = rows.map(b => {
        const pctRaw = b.amountDisp > 0 ? (b.spent / b.amountDisp) * 100 : 0;
        const pct = Math.min(100, pctRaw);
        const barColor = pctRaw >= 100 ? 'var(--app-expense)' : pctRaw >= 80 ? 'var(--app-transfer)' : 'var(--app-income)';
        const label = b.category === '__total__'
            ? '<i class="bi bi-pin-angle-fill text-primary" style="font-size:0.75rem;"></i> 总支出预算'
            : b.category;
        const remain = b.amountDisp - b.spent;
        const remainHtml = pctRaw >= 100
            ? `<span style="color:var(--app-expense);">超支 ${formatAmount(Math.abs(remain), dispCurrency)}</span>`
            : `<span class="text-muted">剩余 ${formatAmount(remain, dispCurrency)}</span>`;
        return `
        <div class="card shadow-sm mb-2">
            <div class="card-body py-2 px-3">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="fw-bold" style="font-size:0.88rem;">${label}</span>
                    <div>
                        <button class="btn btn-link btn-sm p-0 text-muted me-2" onclick="editBudget(${b.id})" title="修改金额"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-link btn-sm p-0 text-danger" onclick="deleteBudget(${b.id})" title="删除预算"><i class="bi bi-trash"></i></button>
                    </div>
                </div>
                <div class="progress" style="height:8px;">
                    <div class="progress-bar" style="width:${pct}%;background-color:${barColor};"></div>
                </div>
                <div class="d-flex justify-content-between mt-1" style="font-size:0.78rem;">
                    <span class="text-muted">已用 ${formatAmount(b.spent, dispCurrency)} / ${formatAmount(b.amountDisp, dispCurrency)}</span>
                    ${remainHtml}
                </div>
            </div>
        </div>`;
    }).join('');
    if (typeof renderTransactionsHero === 'function') renderTransactionsHero();
}

// 在预算弹窗里把货币单位标出来，避免用户填错单位
function setBudgetModalCurrency(currency) {
    const labelEl = $('budget-currency-label');
    const symbolEl = $('budget-currency-symbol');
    if (labelEl) labelEl.textContent = currency;
    if (symbolEl) symbolEl.textContent = CURRENCY_SYMBOLS[currency] || currency;
}

function openAddBudgetModal() {
    $('budget-edit-id').value = '';
    $('budget-modal-title').textContent = '添加预算';
    const sel = $('budget-category-select');
    sel.innerHTML = '';
    sel.disabled = false;
    const usedCats = new Set(budgets.map(b => b.category));
    if (!usedCats.has('__total__')) sel.add(new Option('总支出预算（不限分类）', '__total__'));
    (categories.expense || []).forEach(c => { if (!usedCats.has(c)) sel.add(new Option(c, c)); });
    if (sel.options.length === 0) {
        showToast('所有分类都已设置过预算啦', 'info', 2500);
        return;
    }
    $('budget-amount-input').value = '';
    // 新建预算时，按统计页当前选择的货币录入
    setBudgetModalCurrency(currentStatsFilter.currency);
    bootstrap.Modal.getOrCreateInstance($('budgetModal')).show();
}

function editBudget(id) {
    const b = budgets.find(x => x.id === id);
    if (!b) return;
    $('budget-edit-id').value = id;
    $('budget-modal-title').textContent = '修改预算';
    const sel = $('budget-category-select');
    sel.innerHTML = '';
    sel.add(new Option(b.category === '__total__' ? '总支出预算（不限分类）' : b.category, b.category));
    sel.disabled = true;
    $('budget-amount-input').value = b.amount;
    // 修改时沿用该预算原本设定的货币，保持金额含义不变
    setBudgetModalCurrency(b.currency || currentStatsFilter.currency);
    bootstrap.Modal.getOrCreateInstance($('budgetModal')).show();
}

function saveBudgetModal() {
    const idVal = $('budget-edit-id').value;
    const category = $('budget-category-select').value;
    const amount = parseFloat($('budget-amount-input').value);
    if (!category) { uiAlert('请选择分类'); return; }
    if (!amount || amount <= 0) { uiAlert('请输入有效的预算金额'); return; }

    if (idVal) {
        const b = budgets.find(x => x.id === Number(idVal));
        if (b) b.amount = amount; // 编辑时金额单位沿用原货币，不改变 currency
    } else {
        budgets.push({ id: Date.now(), category, amount, currency: currentStatsFilter.currency });
    }
    bootstrap.Modal.getInstance($('budgetModal'))?.hide();
    markConfigUpdated(); triggerAutoSave();
    renderBudgetPane();
    showToast('预算已保存', 'success', 2000);
}

function deleteBudget(id) {
    const removed = budgets.find(b => b.id === id);
    budgets = budgets.filter(b => b.id !== id);
    markConfigUpdated(); triggerAutoSave();
    renderBudgetPane();
    if (removed) {
        showToast('预算已删除', 'success', 2000);
        showUndo('已删除 1 条预算', () => {
            budgets.push(removed);
            markConfigUpdated(); triggerAutoSave(); renderBudgetPane();
            showToast('已撤销，预算已恢复', 'info', 2000);
        });
    }
}
