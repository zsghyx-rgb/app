// @file js/99-account-select.js
// 自定义账户下拉选择组件。

// ── 自定义账户下拉组件 ──
const ACC_SELECT_IDS = ['edit-trans-account', 'edit-transfer-from', 'edit-transfer-to'];

function accSelectSync(selectId) {
    const sel = $(selectId);
    const trigger = $('trigger-' + selectId);
    if (!sel || !trigger) return;
    const opt = sel.options[sel.selectedIndex];
    // 触发器只显示纯账户名（无余额），取 data-name 属性
    const text = opt ? (opt.getAttribute('data-name') || opt.text) : '';
    const textEl = trigger.querySelector('.acc-trigger-text');
    if (textEl) textEl.textContent = text;
    else trigger.textContent = text;
    if (selectId === 'edit-trans-account') updateAmountCurrencySymbol();
    else if (selectId === 'edit-transfer-from') updateTransferCurrencySymbol('out');
    else if (selectId === 'edit-transfer-to') updateTransferCurrencySymbol('in');
}

function accSelectBuild(selectId) {
    const sel = $(selectId);
    const dropdown = $('dropdown-' + selectId);
    if (!sel || !dropdown) return;
    dropdown.innerHTML = '';
    Array.from(sel.options).forEach((opt, i) => {
        const div = document.createElement('div');
        div.className = 'acc-select-option' + (i === sel.selectedIndex ? ' selected' : '');
        div.dataset.index = i;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'acc-name';
        nameSpan.textContent = opt.getAttribute('data-name') || opt.text;

        div.appendChild(nameSpan);

        const bal = opt.getAttribute('data-bal');
        if (bal !== null) {
            const balSpan = document.createElement('span');
            balSpan.className = 'acc-bal';
            balSpan.textContent = bal;
            div.appendChild(balSpan);
        }

        div.addEventListener('mousedown', (e) => {
            e.preventDefault();
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            accSelectClose(selectId);
            accSelectSync(selectId);
        });
        dropdown.appendChild(div);
    });
}

function accSelectOpen(selectId) {
    // 先关闭其他
    ACC_SELECT_IDS.forEach(id => { if (id !== selectId) accSelectClose(id); });
    accSelectBuild(selectId);
    const trigger = $('trigger-' + selectId);
    const dropdown = $('dropdown-' + selectId);
    if (!trigger || !dropdown) return;
    trigger.classList.add('open');
    dropdown.classList.add('open');
    // fixed 定位：对齐触发器底部，宽度与触发器相同
    const rect = trigger.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.width = rect.width + 'px';
    dropdown.style.top = (rect.bottom) + 'px';
}

function accSelectClose(selectId) {
    $('trigger-' + selectId)?.classList.remove('open');
    $('dropdown-' + selectId)?.classList.remove('open');
}

function accSelectRepositionAll() {
    ACC_SELECT_IDS.forEach(id => {
        const dropdown = $('dropdown-' + id);
        if (!dropdown || !dropdown.classList.contains('open')) return;
        const trigger = $('trigger-' + id);
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
        dropdown.style.top = rect.bottom + 'px';
    });
}

function accSelectInit() {
    ACC_SELECT_IDS.forEach(id => {
        const trigger = $('trigger-' + id);
        if (!trigger) return;
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = $('dropdown-' + id)?.classList.contains('open');
            if (isOpen) accSelectClose(id); else accSelectOpen(id);
        });
    });
    document.addEventListener('click', () => {
        ACC_SELECT_IDS.forEach(id => accSelectClose(id));
    });
    // 表单内部滚动区滚动时同步下拉位置（v2 布局下真正滚动的是 .trans-scroll-area，不是 .modal-body）
    document.querySelectorAll('#editTransactionModal .trans-scroll-area').forEach(el => {
        el.addEventListener('scroll', accSelectRepositionAll, { passive: true });
    });
}

// 页面加载后初始化
document.addEventListener('DOMContentLoaded', accSelectInit);
