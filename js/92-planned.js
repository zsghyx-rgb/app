// @file js/92-planned.js
// 计划/周期交易：列表、新增/编辑/删除、手动与自动生成。

function renderPlannedTransactions() {
    const container = $('planned-list-container');
    if (!container) return;
    container.innerHTML = '';
    if (userPlannedTransactions.length === 0) {
        container.innerHTML = '<div class="alert alert-secondary">暂无计划交易，点击上方"新增计划"按钮创建。</div>';
        return;
    }
    const sortedPlans = [...userPlannedTransactions].sort((a, b) => {
        const la = a.lastGenerated || '0000-00-00';
        const lb = b.lastGenerated || '0000-00-00';
        return la.localeCompare(lb);
    });
    sortedPlans.forEach(plan => {
        const acc = accounts.find(a => a.id == plan.accountId);
        if (!acc) return;
        const nextDate = getNextGenerationDate(plan);
        const isActive = !plan.endDate || new Date(plan.endDate) >= new Date();
        const card = document.createElement('div');
        card.className = 'card mb-3 shadow-sm';
        card.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h6 class="mb-2"><i class="bi bi-calendar-event text-primary"></i> ${plan.name}
                            ${isActive ? '<span class="badge bg-success ms-2">进行中</span>' : '<span class="badge bg-secondary ms-2">已结束</span>'}
                        </h6>
                        <div class="row g-2 small text-muted mb-2">
                            <div class="col-auto"><i class="bi bi-arrow-repeat"></i> 每月 ${plan.dayOfMonth} 号</div>
                            <div class="col-auto"><i class="bi bi-wallet2"></i> ${acc.name}</div>
                            <div class="col-auto"><i class="bi bi-tag"></i> ${plan.category}</div>
                            <div class="col-auto fw-bold ${plan.type === 'expense' ? 'text-danger' : 'text-success'}">${CURRENCY_SYMBOLS[acc.currency]}${formatAmount(Math.abs(plan.amount), acc.currency)}</div>
                        </div>
                        <div class="small text-muted">
                            <i class="bi bi-calendar-check"></i>
                            ${nextDate ? `下次生成: ${nextDate} | ` : ''}开始: ${plan.startDate}${plan.endDate ? ` | 结束: ${plan.endDate}` : ' | 无限期'}
                        </div>
                        ${plan.lastGenerated ? `<div class="small text-success mt-1"><i class="bi bi-check-circle"></i> 上次生成: ${plan.lastGenerated}</div>` : ''}
                        ${plan.desc ? `<div class="small mt-1"><i class="bi bi-file-text"></i> ${plan.desc}</div>` : ''}
                    </div>
                    <div class="btn-group">
                        ${isActive ? `<button class="btn btn-sm btn-outline-success" onclick="manualGeneratePlanned(${plan.id})"><i class="bi bi-play-fill"></i></button>` : ''}
                        <button class="btn btn-sm btn-outline-primary" onclick="openEditPlanned(${plan.id})"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deletePlanned(${plan.id})"><i class="bi bi-trash"></i></button>
                    </div>
                </div>
            </div>`;
        container.appendChild(card);
    });
}

function updatePlannedCategories() {
    const type = $('planned-type').value;
    const select = $('planned-category');
    if (!select) return;
    select.innerHTML = '';
    (type === 'expense' ? categories.expense : categories.income).forEach(c => select.add(new Option(c, c)));
}


function openNewPlanned() {
    $('planned-id').value = '';
    $('planned-mode').value = 'add';
    $('plannedModalTitle').textContent = '新增计划交易';
    $('planned-submit-btn').textContent = '保存计划';
    $('planned-name').value = '';
    $('planned-type').value = 'expense';
    updatePlannedCategories();
    $('planned-amount').value = '';
    $('planned-recurrence').value = 'monthly';
    $('planned-day-of-month').value = '1';
    $('planned-start-date').value = new Date().toISOString().split('T')[0];
    $('planned-end-date').value = '';
    $('planned-desc').value = '';
    $('planned-tags').value = '';
    new bootstrap.Modal($('plannedModal')).show();
}

function openEditPlanned(id) {
    const plan = plannedTransactions.find(p => p.id === id);
    if (!plan || plan.ownerName !== currentUserName) return;
    $('planned-id').value = plan.id;
    $('planned-mode').value = 'edit';
    $('plannedModalTitle').textContent = '编辑计划交易';
    $('planned-submit-btn').textContent = '保存修改';
    $('planned-name').value = plan.name;
    $('planned-type').value = plan.type;
    updatePlannedCategories();
    $('planned-account').value = plan.accountId;
    $('planned-category').value = plan.category;
    $('planned-amount').value = plan.amount;
    $('planned-recurrence').value = plan.recurrence;
    $('planned-start-date').value = plan.startDate;
    $('planned-end-date').value = plan.endDate || '';
    $('planned-desc').value = plan.desc || '';
    $('planned-tags').value = plan.tags || '';
    $('planned-day-of-month').value = plan.dayOfMonth;
    new bootstrap.Modal($('plannedModal')).show();
}

$('planned-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const mode = $('planned-mode').value;

    if (mode === 'add') {
        const plan = {
            id: Date.now(),
            name: $('planned-name').value,
            type: $('planned-type').value,
            accountId: $('planned-account').value,
            category: $('planned-category').value,
            amount: parseFloat($('planned-amount').value),
            recurrence: $('planned-recurrence').value,
            startDate: $('planned-start-date').value,
            endDate: $('planned-end-date').value || null,
            dayOfMonth: parseInt($('planned-day-of-month').value),
            lastGenerated: null, ownerName: currentUserName,
            desc: $('planned-desc').value,
            tags: $('planned-tags').value,
            updatedAt: Date.now()
        };
        plannedTransactions.push(plan);
        saveUserData(); triggerAutoSave(); loadAllData(); filterUserData(); renderPlannedTransactions();
        bootstrap.Modal.getInstance($('plannedModal')).hide();
        e.target.reset();
        if (verboseToast) showToast('计划已创建', 'success');
    } else {
        const id = parseInt($('planned-id').value);
        const plan = plannedTransactions.find(p => p.id === id);
        if (plan) {
            plan.name = $('planned-name').value;
            plan.type = $('planned-type').value;
            plan.accountId = $('planned-account').value;
            plan.category = $('planned-category').value;
            plan.amount = parseFloat($('planned-amount').value);
            plan.recurrence = $('planned-recurrence').value;
            plan.startDate = $('planned-start-date').value;
            plan.endDate = $('planned-end-date').value || null;
            plan.dayOfMonth = parseInt($('planned-day-of-month').value);
            plan.desc = $('planned-desc').value;
            plan.tags = $('planned-tags').value;
            plan.updatedAt = Date.now();
            saveUserData(); triggerAutoSave(); loadAllData(); filterUserData(); renderPlannedTransactions();
            bootstrap.Modal.getInstance($('plannedModal')).hide();
            if (verboseToast) showToast('计划已更新', 'success');
        }
    }
});

function deletePlanned(id) {
    const index = plannedTransactions.findIndex(p => p.id === id);
    if (index < 0 || plannedTransactions[index].ownerName !== currentUserName) return;
    const removed = plannedTransactions.splice(index, 1)[0];
    saveUserData(); triggerAutoSave(); loadAllData(); filterUserData(); renderPlannedTransactions();
    showToast('计划交易已删除', 'success', 2000);
    showUndo(`已删除计划「${removed.name}」`, () => {
        plannedTransactions.push(removed);
        saveUserData(); triggerAutoSave(); loadAllData(); filterUserData(); renderPlannedTransactions();
        showToast('已撤销，计划已恢复', 'info', 2000);
    });
}

async function manualGeneratePlanned(id) {
    const plan = plannedTransactions.find(p => p.id === id);
    if (!plan) return;
    const today = new Date().toISOString().split('T')[0];
    const nextDate = getNextGenerationDate(plan);
    let msg = `立即生成交易「${plan.name}」\n\n`;
    if (nextDate) msg += `计划下次生成日期：${nextDate}\n`;
    msg += `今天：${today}`;
    if (plan.lastGenerated) msg += `\n上次生成：${plan.lastGenerated}`;

    // 用多字段表单：日期 + 金额。默认输入法聚焦在日期框（focusKey='date'），
    // 金额预填计划金额，用户可改。
    const vals = await uiForm(msg, [
        { key: 'date',   label: '交易日期（YYYY-MM-DD）', value: today, placeholder: 'YYYY-MM-DD', type: 'text', inputmode: 'numeric' },
        { key: 'amount', label: '金额（可修改）', value: String(Math.abs(plan.amount)), placeholder: '金额', type: 'number', inputmode: 'decimal' }
    ], { title: '按计划生成交易', okText: '生成', focusKey: 'date' });
    if (!vals) return;
    const targetDate = (vals.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) { uiAlert('日期格式错误！请使用 YYYY-MM-DD 格式'); return; }
    const amtRaw = parseFloat(vals.amount);
    if (!isFinite(amtRaw) || amtRaw <= 0) { uiAlert('金额必须大于 0'); return; }
    generateTransactionFromPlan(plan, targetDate, amtRaw);
}

async function generateTransactionFromPlan(plan, targetDate, amountOverride) {
    const acc = accounts.find(a => a.id == plan.accountId);
    if (!acc) return;
    if (plan.lastGenerated === targetDate) { uiAlert(`计划 "${plan.name}" 在 ${targetDate} 已经生成过交易了！`); return; }
    const existingTransaction = transactions.find(t => t.fromPlannedId === plan.id && t.date === targetDate);
    if (existingTransaction) {
        const ok = await uiConfirm(`警告：${targetDate} 已存在来自此计划的交易！是否仍要生成新交易？（不推荐）`, { okText: '仍然生成', cancelText: '取消' });
        if (!ok) return;
    }
    // 优先用调用方传入的金额（来自表单），否则回退到计划金额
    const baseAmt = (amountOverride !== undefined && isFinite(amountOverride) && amountOverride > 0)
        ? Math.abs(amountOverride)
        : Math.abs(plan.amount);
    const amount = plan.type === 'expense' ? -baseAmt : baseAmt;
    transactions.unshift({
        id: Date.now() + Math.random(), date: targetDate, type: plan.type,
        accountId: plan.accountId, amount, category: plan.category,
        desc: `[计划] ${plan.name}${plan.desc ? ': ' + plan.desc : ''}`,
        ownerName: plan.ownerName, tags: plan.tags || '', isTransfer: false,
        fromPlannedId: plan.id, updatedAt: Date.now()
    });
    plan.lastGenerated = targetDate;
    plan.updatedAt = Date.now();
    saveUserData(); triggerAutoSave(); loadAllData(); filterUserData();
    displayedTransactionCount = 100; renderAllTransactions(); renderAccounts(); renderPlannedTransactions();
    showToast(`已按计划「${plan.name}」生成 ${targetDate} 的交易`, 'success', 2600);
}

function getNextGenerationDate(plan) {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (plan.endDate && plan.endDate < todayStr) return null;
    if (plan.recurrence === 'monthly') {
        const nextDate = new Date(today.getFullYear(), today.getMonth(), plan.dayOfMonth);
        const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        if (nextDate < todayMidnight) nextDate.setMonth(nextDate.getMonth() + 1);
        const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
        return nextDateStr >= plan.startDate ? nextDateStr : null;
    }
    return null;
}
