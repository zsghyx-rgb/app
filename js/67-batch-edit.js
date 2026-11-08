// @file js/67-batch-edit.js
// 批量编辑交易：进入/退出、选择、批量修改弹窗与提交。

/* ────────────────── 批量编辑交易 ────────────────── */
let batchEditMode = false;
let batchSelectedIds = new Set();
let batchSelectedType = null; // 'expense' | 'income'，限制只能多选同一类型

function toggleBatchEditMode() {
    batchEditMode = !batchEditMode;
    if (!batchEditMode) { batchSelectedIds.clear(); batchSelectedType = null; }
    $('batch-edit-bar').classList.toggle('d-none', !batchEditMode);
    $('batch-edit-bar').classList.toggle('d-flex', batchEditMode);
    $('batch-edit-toggle-btn').classList.toggle('btn-primary', batchEditMode);
    $('batch-edit-toggle-btn').classList.toggle('btn-outline-secondary', !batchEditMode);
    updateBatchEditBar();
    renderAllTransactions();
}

function cancelBatchEditMode() {
    batchEditMode = false;
    batchSelectedIds.clear();
    batchSelectedType = null;
    $('batch-edit-bar').classList.add('d-none');
    $('batch-edit-bar').classList.remove('d-flex');
    $('batch-edit-toggle-btn').classList.remove('btn-primary');
    $('batch-edit-toggle-btn').classList.add('btn-outline-secondary');
    updateBatchEditBar();   // 同时解除类型锁定
    renderAllTransactions();
}

/** 根据已选类型，锁定另一种类型的行（隐藏它们的勾选框）；没有任何选中时全部解锁 */
function updateBatchLock() {
    const box = $('mobile-transaction-cards');
    if (!box) return;
    box.classList.toggle('batch-lock-expense', batchEditMode && batchSelectedType === 'expense');
    box.classList.toggle('batch-lock-income', batchEditMode && batchSelectedType === 'income');
}

function updateBatchEditBar() {
    const countEl = $('batch-edit-count');
    if (countEl) countEl.textContent = `已选择 ${batchSelectedIds.size} 笔`;
    const applyBtn = $('batch-edit-apply-btn');
    if (applyBtn) applyBtn.disabled = batchSelectedIds.size === 0;
    updateBatchLock();
}

function toggleBatchSelect(id) {
    if (!batchEditMode) return;
    const t = transactions.find(x => x.id === id);
    if (!t) return;
    const wasSelected = batchSelectedIds.has(id);
    if (!wasSelected) {
        // 限制多选只能选同一种类型：支出/收入分开选择，转账不可选（转账不会走到这里，见渲染时的过滤）
        if (batchSelectedType && t.type !== batchSelectedType) {
            const cb0 = document.querySelector(`.mobile-transaction-card[data-id="${id}"] .batch-edit-checkbox`);
            if (cb0) cb0.checked = false;   // 浏览器已经把它勾上了，要还原
            showToast('已选择' + (batchSelectedType === 'expense' ? '支出' : '收入') + '，只能继续选择同类型的交易；如需选另一类，请先取消已选的', 'warning');
            return;
        }
        batchSelectedIds.add(id);
        batchSelectedType = t.type;
    } else {
        batchSelectedIds.delete(id);
        if (batchSelectedIds.size === 0) batchSelectedType = null;
    }
    const card = document.querySelector(`.mobile-transaction-card[data-id="${id}"]`);
    if (card) {
        const cb = card.querySelector('.batch-edit-checkbox');
        if (cb) cb.checked = !wasSelected;
        card.classList.toggle('batch-selected', !wasSelected);
    }
    updateBatchEditBar();
}

function toggleBatchField(field) {
    const enabled = $('batch-enable-' + field).checked;
    $('batch-field-' + field).disabled = !enabled;
}

function openBatchEditModal() {
    if (batchSelectedIds.size === 0) return;
    $('batch-edit-modal-count').textContent = batchSelectedIds.size;

    ['account', 'category', 'date', 'tags', 'desc'].forEach(f => {
        $('batch-enable-' + f).checked = false;
        toggleBatchField(f);
    });
    $('batch-field-tags').value = '';
    $('batch-field-desc').value = '';
    $('batch-field-date').value = '';

    // 账户下拉：只显示自己名下未隐藏的账户
    const accSel = $('batch-field-account');
    accSel.innerHTML = '';
    sortedUserAccounts(userAccounts.filter(a => !a.hidden)).forEach(a => {
        accSel.add(new Option(`${getAccountDisplayName(a)} (${CURRENCY_SYMBOLS[a.currency]})`, a.id));
    });

    // 分类下拉：根据本次选中交易的统一类型，显示对应的支出/收入分类
    const catSel = $('batch-field-category');
    catSel.innerHTML = '';
    (batchSelectedType === 'income' ? categories.income : categories.expense).forEach(c => catSel.add(new Option(c, c)));

    new bootstrap.Modal($('batchEditModal')).show();
}

async function submitBatchEdit() {
    if (batchSelectedIds.size === 0) return;
    const applyAccount = $('batch-enable-account').checked;
    const applyCategory = $('batch-enable-category').checked;
    const applyDate = $('batch-enable-date').checked;
    const applyTags = $('batch-enable-tags').checked;
    const applyDesc = $('batch-enable-desc').checked;

    if (!applyAccount && !applyCategory && !applyDate && !applyTags && !applyDesc) {
        showToast('请至少勾选一个要修改的字段', 'warning');
        return;
    }
    if (applyDate && !$('batch-field-date').value) {
        showToast('请选择日期', 'warning');
        return;
    }

    const newAccountId = applyAccount ? parseInt($('batch-field-account').value) : null;
    const newCategory = applyCategory ? $('batch-field-category').value : null;
    const newDate = applyDate ? $('batch-field-date').value : null;
    const newTags = applyTags ? $('batch-field-tags').value.trim() : null;
    const newDesc = applyDesc ? $('batch-field-desc').value.trim() : null;

    if (!(await uiConfirm(`确定要批量修改这 ${batchSelectedIds.size} 笔交易吗？此操作不可撤销。`, { title: '批量编辑', okText: '确认修改', danger: true }))) return;

    let count = 0;
    batchSelectedIds.forEach(id => {
        const t = transactions.find(x => x.id === id);
        if (!t) return;
        if (applyAccount && newAccountId) t.accountId = newAccountId;
        if (applyCategory && newCategory) t.category = newCategory;
        if (applyDate && newDate) t.date = newDate;
        if (applyTags) t.tags = newTags;
        if (applyDesc) t.desc = newDesc;
        t.updatedAt = Date.now();
        count++;
    });

    saveUserData();
    triggerAutoSave();
    bootstrap.Modal.getInstance($('batchEditModal'))?.hide();
    showToast(`已批量修改 ${count} 笔交易`, 'success');
    cancelBatchEditMode();
    renderAccounts();
    renderStats();
}
