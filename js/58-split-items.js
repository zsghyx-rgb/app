// @file js/58-split-items.js
// 拆分模式与分录行(split items)、拆分头部/合计、备注/标签折叠字段。

let _inSplitMode = false;
let _splitTargetAmount = 0;   // 进入拆分时的原金额：用于“已分配 / 还差”提示

/** 当前交易账户的货币符号（拆分各行的金额前缀） */
function _splitCurrencySymbol() {
    const sel = $('edit-trans-account');
    const acc = sel ? accounts.find(a => a.id == sel.value) : null;
    return (acc && (CURRENCY_SYMBOLS[acc.currency] || acc.currency)) || '¥';
}

/** 金额转成输入框文本：0 显示为空，避免 0.00 干扰输入 */
function _splitAmountText(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return v > 0 ? String(v) : '';
}

/** 标签/备注里可能有引号，写进 HTML 属性前先转义 */
function _splitEsc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function _buildSplitItemCard(item, idx) {
    const cats = categories.expense || [];
    const catOpts = cats.map(c => `<option value="${_splitEsc(c)}"${c===item.category?' selected':''}>${_splitEsc(c)}</option>`).join('');
    const canDelete = _splitData.length > 2;
    const sym = _splitCurrencySymbol();
    const div = document.createElement('div');
    div.className = 'split-item-card border rounded mb-2 p-2';
    div.dataset.accent = idx % 4;
    div.dataset.idx = idx;
    div.innerHTML = `
        <div class="split-card-grid">
            <select class="form-select compact-form-control split-card-cat"
                    onchange="_splitData[${idx}].category=this.value">${catOpts}</select>
            <div class="split-amt-wrap split-card-amt">
                <span class="split-amt-sym">${_splitEsc(sym)}</span>
                <input type="text" inputmode="decimal" class="split-amt-input decimal-input"
                       placeholder="0.00" autocomplete="off"
                       value="${_splitEsc(_splitAmountText(item.amount))}"
                       oninput="onSplitAmountInput(this, ${idx})">
            </div>
            <div class="split-card-del">
                <button type="button" class="btn btn-link text-danger btn-sm p-0"
                        ${canDelete ? `onclick="removeSplitItem(${idx})"` : 'disabled title="至少保留两条分录"'}
                        aria-label="删除这条分录"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="split-card-tags tag-suggest-wrap">
                <input type="text" class="form-control compact-form-control split-card-tags-input"
                       placeholder="添加标签…" autocomplete="off"
                       value="${_splitEsc(item.tags || '')}"
                       oninput="_splitData[${idx}].tags=this.value"
                       onfocus="openTagSuggest(this,'ts-split-${idx}')"
                       onblur="scheduleCloseTagSuggest('ts-split-${idx}')">
                <ul class="tag-suggest-list" id="ts-split-${idx}"></ul>
            </div>
            <input type="text" class="form-control compact-form-control split-card-desc"
                   placeholder="添加备注…" autocomplete="off"
                   value="${_splitEsc(item.desc || '')}"
                   oninput="_splitData[${idx}].desc=this.value">
        </div>`;
    return div;
}

function renderSplitItems() {
    const list = $('split-items-list');
    if (!list) return;
    list.innerHTML = '';
    _splitData.forEach((item, idx) => list.appendChild(_buildSplitItemCard(item, idx)));
    refreshSplitTotal();
}

/** 金额输入：decimal-input 的全局清洗（10-config-state.js）已经过滤非法字符，这里只同步数据 */
function onSplitAmountInput(el, idx) {
    if (!_splitData[idx]) return;
    _splitData[idx].amount = parseFloat(el.value) || 0;
    refreshSplitTotal();
}

/** 只剩两条分录时禁用删除，避免删到 1 条后无法保存 */
function _syncSplitDeleteBtns() {
    const list = $('split-items-list');
    if (!list) return;
    const canDelete = _splitData.length > 2;
    [...list.querySelectorAll('.split-card-del button')].forEach((btn, i) => {
        btn.disabled = !canDelete;
        btn.title = canDelete ? '' : '至少保留两条分录';
        if (canDelete) btn.setAttribute('onclick', `removeSplitItem(${i})`);
        else btn.removeAttribute('onclick');
    });
}

function refreshSplitTotal() {
    const total = Math.round(_splitData.reduce((s, it) => s + (Number(it.amount) || 0), 0) * 100) / 100;
    const sym = _splitCurrencySymbol();
    const amtEl = $('split-total-amt');
    if (amtEl) amtEl.textContent = sym + total.toFixed(2);

    // 头部项数
    const validCount = _splitData.filter(it => (Number(it.amount) || 0) > 0).length;
    const titleEl = $('split-mode-title');
    if (titleEl) titleEl.textContent = `拆分账单 · ${validCount} 项`;

    // 和进入拆分前的金额对比：还差 / 超出 / 已分配完
    const hintEl = $('split-target-hint');
    const fillBtn = $('split-fill-btn');
    if (!hintEl) return;
    hintEl.className = 'split-summary-hint';
    let showFill = false;
    if (_splitTargetAmount > 0) {
        const diff = Math.round((_splitTargetAmount - total) * 100) / 100;
        if (Math.abs(diff) < 0.005) {
            hintEl.textContent = '已分配完 ✓';
            hintEl.classList.add('is-done');
        } else if (diff > 0) {
            hintEl.textContent = `还差 ${sym}${diff.toFixed(2)}`;
            hintEl.classList.add('is-short');
            showFill = true;
        } else {
            hintEl.textContent = `超出 ${sym}${(-diff).toFixed(2)}`;
            hintEl.classList.add('is-over');
        }
    } else {
        hintEl.textContent = '';
    }
    if (fillBtn) fillBtn.style.display = showFill ? '' : 'none';
}

/** 把差额补到最后一行（“还差”时使用） */
function fillSplitRemainder() {
    if (!_inSplitMode || _splitData.length === 0 || _splitTargetAmount <= 0) return;
    const total = _splitData.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const diff = Math.round((_splitTargetAmount - total) * 100) / 100;
    if (diff <= 0) return;
    const idx = _splitData.length - 1;
    _splitData[idx].amount = Math.round(((Number(_splitData[idx].amount) || 0) + diff) * 100) / 100;
    const input = document.querySelector(`#split-items-list .split-item-card[data-idx="${idx}"] .split-amt-input`);
    if (input) input.value = _splitAmountText(_splitData[idx].amount);
    refreshSplitTotal();
}

function addSplitItemRow() {
    if (!_inSplitMode) return;
    const cats = categories.expense || [];
    const prev = _splitData[_splitData.length - 1];
    // 新行继承上一行的分类（比固定第一个分类更符合拆分习惯）
    _splitData.push({
        category: (prev && prev.category) || cats[0] || '',
        amount: 0, tags: '', desc: ''
    });
    const list = $('split-items-list');
    const idx = _splitData.length - 1;
    const card = _buildSplitItemCard(_splitData[idx], idx);
    if (list) {
        // 只追加新卡片，不重建整个列表：已输入的内容和焦点都不会被打断
        list.appendChild(card);
        _syncSplitDeleteBtns();
        list.scrollTop = list.scrollHeight;
        const inp = card.querySelector('.split-amt-input');
        if (inp) setTimeout(() => inp.focus(), 30);
    }
    refreshSplitTotal();
}

function removeSplitItem(idx) {
    if (_splitData.length <= 2) return;
    _splitData.splice(idx, 1);
    renderSplitItems();   // 索引变化后重建，保证每行的内联事件指向正确的数据
}

/** 拆分按钮点击：普通模式→进入拆分；拆分模式→添加一行（兼容旧入口） */
function handleSplitBtn() {
    if (_inSplitMode) addSplitItemRow();
    else enterSplitMode();
}

/** 拆分模式的界面切换 */
function _applySplitUI(active) {
    const singleRow   = $('single-item-row');
    const metaSection = $('single-meta-section');
    const splitSec    = $('split-items-section');
    const form        = $('edit-transaction-form');
    const amountCard  = $('trans-amount-card');
    if (singleRow)   singleRow.style.display = active ? 'none' : '';
    if (metaSection) metaSection.style.display = active ? 'none' : '';
    if (splitSec)    splitSec.classList.toggle('split-active', active);
    if (form)        form.classList.toggle('split-mode', active);
    // 拆分时金额由各分录相加，顶部金额卡片隐藏，把空间让给分录
    if (amountCard)  amountCard.style.display = active ? 'none' : '';
    // 附件卡片只在支出下显示（拆分只在支出里）
    const attachSec = $('attachment-section');
    if (attachSec) attachSec.style.display = ($('edit-trans-type').value === 'expense') ? '' : 'none';
    // 拆分时主表单的金额/分类不参与校验
    const amtInput = $('edit-trans-amount');
    if (amtInput) { if (active) amtInput.removeAttribute('required'); else amtInput.setAttribute('required', ''); }
    const catSel = $('edit-trans-category');
    if (catSel) { if (active) catSel.removeAttribute('required'); else catSel.setAttribute('required', ''); }
    amountPadSync();          // 拆分时不需要数字键盘
}

function enterSplitMode() {
    commitTransAmount();      // 金额框里如果是算式 (12+8)，先算成数字再读
    if (_inSplitMode) return;
    _inSplitMode = true;
    // 如果还没有拆分数据，从主表单读入第一行
    if (_splitData.length === 0) {
        const cat = $('edit-trans-category').value || (categories.expense[0]||'');
        const amt = parseFloat($('edit-trans-amount').value) || 0;
        const tags = $('edit-trans-tags').value || '';
        const desc = $('edit-trans-desc').value || '';
        _splitData = [
            { category: cat, amount: amt, tags, desc },
            { category: cat, amount: 0, tags: '', desc: '' },
        ];
        _splitTargetAmount = amt;
    } else {
        // 编辑已有拆分：原金额就是各分录之和
        _splitTargetAmount = Math.round(_splitData.reduce((s, it) => s + (Number(it.amount) || 0), 0) * 100) / 100;
    }
    _applySplitUI(true);
    renderSplitItems();
}

/** 清掉合计/项数等拆分残留 */
function _resetSplitSummary() {
    const list = $('split-items-list');
    if (list) list.innerHTML = '';
    const amtEl = $('split-total-amt');
    if (amtEl) amtEl.textContent = '';
    const hintEl = $('split-target-hint');
    if (hintEl) { hintEl.textContent = ''; hintEl.className = 'split-summary-hint'; }
    const fillBtn = $('split-fill-btn');
    if (fillBtn) fillBtn.style.display = 'none';
    const titleEl = $('split-mode-title');
    if (titleEl) titleEl.textContent = '拆分账单';
}

/**
 * 退出拆分。
 * opts.fillTotal = true：把合计填回单笔金额（用户主动退出 / 只剩一条分录时按单笔保存）
 * 不传则清空金额（重置、切换 tab 等场景）
 */
function exitSplitMode(opts) {
    const fillTotal = !!(opts && opts.fillTotal);
    const total = Math.round(_splitData.reduce((s, it) => s + (Number(it.amount) || 0), 0) * 100) / 100;
    const first = _splitData.find(it => (Number(it.amount) || 0) > 0) || null;
    _inSplitMode = false;
    _splitData = [];
    _splitTargetAmount = 0;
    _applySplitUI(false);
    const amtInput = $('edit-trans-amount');
    if (amtInput) amtInput.value = (fillTotal && total > 0) ? _splitAmountText(total) : '';
    if (fillTotal && first) {
        const catSel = $('edit-trans-category');
        if (catSel && first.category) { catSel.value = first.category; catGridSync('edit-trans-category', 'cat-grid-edit-trans-category'); }
        // 第一行的标签/备注带回单笔表单，避免退出后内容全部丢失
        const tagsEl = $('edit-trans-tags');
        if (tagsEl) tagsEl.value = first.tags || '';
        const descEl = $('edit-trans-desc');
        if (descEl) descEl.value = first.desc || '';
    }
    _resetSplitSummary();
}

/** 拆分头部“退出拆分”：有内容时先确认，再把合计填回单笔金额 */
function requestExitSplitMode() {
    if (!_inSplitMode) return;
    const hasData = _splitData.some(it => (Number(it.amount) || 0) > 0 || it.tags || it.desc);
    const doExit = () => exitSplitMode({ fillTotal: true });
    if (!hasData) { doExit(); return; }
    uiConfirm('退出拆分后，合计会填回单笔金额，已填写的分录将被清空。是否继续？', {
        okText: '退出拆分', cancelText: '继续拆分'
    }).then(ok => { if (ok) doExit(); });
}

/** 只有一条有效分录时，按单笔保存（不写 items） */
function convertSplitToSingle(item) {
    if (!item) return;
    const amt = Math.abs(Number(item.amount) || 0);
    _inSplitMode = false;
    _splitData = [];
    _splitTargetAmount = 0;
    _applySplitUI(false);
    const amtEl = $('edit-trans-amount');
    if (amtEl) amtEl.value = _splitAmountText(amt);
    const catEl = $('edit-trans-category');
    if (catEl && item.category) { catEl.value = item.category; catGridSync('edit-trans-category', 'cat-grid-edit-trans-category'); }
    const tagsEl = $('edit-trans-tags');
    if (tagsEl) tagsEl.value = item.tags || '';
    const descEl = $('edit-trans-desc');
    if (descEl) descEl.value = item.desc || '';
    _resetSplitSummary();
}

/** 读取当前拆分数据供 submit 使用（返回 null = 单笔 / 校验未通过） */
function getInlineItems() {
    if (!_inSplitMode || _splitData.length === 0) return null;
    const type = $('edit-trans-type').value;
    const sign = type === 'expense' ? -1 : 1;
    const items = _splitData
        .filter(it => (Number(it.amount) || 0) > 0)
        .map(it => ({
            category: it.category,
            amount: sign * Math.abs(Number(it.amount)),
            ...(it.tags ? { tags: it.tags } : {}),
            ...(it.desc ? { desc: it.desc } : {}),
        }));
    if (items.length === 0) { uiAlert('请至少填写一条有效金额'); return null; }
    return items;   // 只有一条时由保存流程询问是否按单笔保存
}

/** 清空拆分状态（新增/切换 tab 时调用） */
function resetInlineItems() {
    if (_inSplitMode) exitSplitMode();
    else {
        _splitData = [];
        const amtInput = $('edit-trans-amount');
        if (amtInput) { amtInput.value = ''; amtInput.setAttribute('required',''); }
    }
}

/** 编辑已有拆分交易时恢复拆分 UI */
function loadInlineItems(items) {
    if (!items || items.length <= 1) { resetInlineItems(); return; }
    _splitData = items.map(it => ({
        category: it.category || '',
        amount: Math.abs(Number(it.amount) || 0),
        tags: it.tags || '',
        desc: it.desc || '',
    }));
    enterSplitMode();
}

// ── 折叠字段展开/收起 ──
function expandTransferDesc() {
    const expandedEl = $('transfer-desc-expanded');
    const btnEl = $('transfer-desc-expand-btn');
    if (expandedEl) expandedEl.style.display = '';
    if (btnEl) btnEl.style.display = 'none';
    const inp = $('edit-transfer-desc');
    if (inp) setTimeout(() => inp.focus(), 50);
}

// 折叠所有 meta 字段（新增/切换 tab 时调用）
function resetMetaFieldsCollapse() {
    // 标签折叠，其他默认展开
    ['tags'].forEach(key => {
        const expandedEl = $(key + '-expanded');
        const btnEl = $(key + '-expand-btn');
        if (expandedEl) expandedEl.style.display = 'none';
        if (btnEl) btnEl.style.display = '';
    });
    // 备注默认展开
    const descExp = $('desc-expanded');
    const descBtn = $('desc-expand-btn');
    if (descExp) descExp.style.display = '';
    if (descBtn) descBtn.style.display = 'none';
    // 转账备注默认展开
    const tfExp = $('transfer-desc-expanded');
    const tfBtn = $('transfer-desc-expand-btn');
    if (tfExp) tfExp.style.display = '';
    if (tfBtn) tfBtn.style.display = 'none';
}

function expandTransferDescForExistingData(desc) {
    if (desc) expandTransferDesc();
}
