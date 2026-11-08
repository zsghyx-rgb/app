// @file js/58-split-items.js
// 拆分模式与分录行(split items)、备注/标签折叠字段。

let _inSplitMode = false;

function _buildMarkOpts(selected) {
    return [
        {v:'', l:'未标记'}, {v:'need', l:'必须的'},
        {v:'want', l:'想要的'}, {v:'regret', l:'后悔的'},
    ].map(o => `<option value="${o.v}"${o.v===(selected||'')?` selected`:``}>${o.l}</option>`).join('');
}

function _buildSplitItemCard(item, idx) {
    const cats = categories.expense || [];
    const catOpts = cats.map(c => `<option value="${c}"${c===item.category?' selected':''}>${c}</option>`).join('');
    const div = document.createElement('div');
    div.className = 'split-item-card border rounded mb-2 p-2';
    div.dataset.accent = idx % 4;
    div.dataset.idx = idx;
    div.innerHTML = `
        <div class="split-card-grid">
            <select class="form-select compact-form-control"
                    onchange="_splitData[${idx}].category=this.value">${catOpts}</select>
            <input type="text" inputmode="decimal" class="form-control compact-form-control decimal-input"
                   placeholder="金额"
                   value="${item.amount>0?item.amount:''}"
                   oninput="_splitData[${idx}].amount=parseFloat(this.value)||0;refreshSplitTotal()">
            <select class="form-select compact-form-control" style="font-size:0.78rem;"
                    onchange="_splitData[${idx}].mark=this.value">${_buildMarkOpts(item.mark||'')}</select>
            <div class="split-card-del">
                <button type="button" class="btn btn-link text-danger btn-sm p-0"
                        onclick="removeSplitItem(${idx})"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="split-card-tags tag-suggest-wrap">
                <input type="text" class="form-control compact-form-control split-card-tags-input"
                       placeholder="添加标签…"
                       value="${item.tags||''}"
                       autocomplete="off"
                       oninput="_splitData[${idx}].tags=this.value"
                       onfocus="openTagSuggest(this,'ts-split-${idx}')"
                       onblur="scheduleCloseTagSuggest('ts-split-${idx}')">
                <ul class="tag-suggest-list" id="ts-split-${idx}"></ul>
            </div>
            <input type="text" class="form-control compact-form-control split-card-desc"
                   placeholder="添加备注…"
                   value="${item.desc||''}" oninput="_splitData[${idx}].desc=this.value">
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

function refreshSplitTotal() {
    const total = _splitData.reduce((s, it) => s + (it.amount||0), 0);
    const el = $('split-total-amt');
    if (el) el.textContent = total.toFixed(2);
}

function addSplitItemRow() {
    const cats = categories.expense || [];
    _splitData.push({ category: cats[0]||'', amount: 0, tags: '', desc: '' });
    renderSplitItems();
    const list = $('split-items-list');
    if (list) setTimeout(() => { list.scrollTop = list.scrollHeight; }, 50);
}

function removeSplitItem(idx) {
    _splitData.splice(idx, 1);
    renderSplitItems();
}

/** 切换拆分模式 */
function toggleSplitMode() {
    if (_inSplitMode) {
        exitSplitMode();
    } else {
        enterSplitMode();
    }
}

/** 拆分按钮点击：普通模式→进入拆分；拆分模式→添加一行 */
function handleSplitBtn() {
    if (_inSplitMode) {
        addSplitItemRow();
    } else {
        enterSplitMode();
    }
}

function enterSplitMode() {
    _inSplitMode = true;
    // 如果还没有拆分数据，从主表单读入第一行
    if (_splitData.length === 0) {
        const cat = $('edit-trans-category').value || (categories.expense[0]||'');
        const amt = parseFloat($('edit-trans-amount').value) || 0;
        const tags = $('edit-trans-tags').value || '';
        const desc = $('edit-trans-desc').value || '';
        _splitData = [
            { category: cat, amount: amt, tags, desc },
            { category: categories.expense[0]||'', amount: 0, tags: '', desc: '' },
        ];
    }
    renderSplitItems();
    // UI toggle
    const singleRow   = $('single-item-row');
    const metaSection = $('single-meta-section');
    const splitSec    = $('split-items-section');
    const splitBtn    = $('split-toggle-btn');
    if (singleRow)   singleRow.style.display = 'none';
    if (metaSection) metaSection.style.display = 'none';
    if (splitSec)    splitSec.classList.add('split-active');
    if (splitBtn)    { splitBtn.innerHTML = '<i class="bi bi-plus-lg"></i>'; splitBtn.classList.add('active'); splitBtn.title = '添加分录'; }
    $('trans-amount-bar')?.classList.add('split-mode');
    // attachment-section stays visible (footer has its own attach button)
    const attachSec = $('attachment-section');
    if (attachSec) attachSec.style.display = '';
    // disable main amount/category (not used in split)
    const amtInput = $('edit-trans-amount');
    if (amtInput) { amtInput.removeAttribute('required'); }
    const catSel = $('edit-trans-category');
    if (catSel) catSel.removeAttribute('required');
}

function exitSplitMode() {
    _inSplitMode = false;
    _splitData = [];
    const singleRow   = $('single-item-row');
    const metaSection = $('single-meta-section');
    const splitSec    = $('split-items-section');
    const splitBtn    = $('split-toggle-btn');
    if (singleRow)   singleRow.style.display = '';
    if (metaSection) metaSection.style.display = '';
    if (splitSec)    splitSec.classList.remove('split-active');
    if (splitBtn)    { splitBtn.innerHTML = '<i class="bi bi-scissors"></i>'; splitBtn.classList.remove('active'); splitBtn.title = '拆分账单'; }
    $('trans-amount-bar')?.classList.remove('split-mode');
    // restore required
    const amtInput = $('edit-trans-amount');
    if (amtInput) { amtInput.setAttribute('required',''); amtInput.value = ''; }
    const catSel = $('edit-trans-category');
    if (catSel) catSel.setAttribute('required','');
}

/** 读取当前拆分数据供 submit 使用（返回 null = 单笔） */
function getInlineItems() {
    if (!_inSplitMode || _splitData.length === 0) return null;
    const type = $('edit-trans-type').value;
    const sign = type === 'expense' ? -1 : 1;
    const items = _splitData.filter(it => it.amount > 0).map(it => ({
        category: it.category,
        amount: sign * Math.abs(it.amount),
        ...(it.tags ? { tags: it.tags } : {}),
        ...(it.desc ? { desc: it.desc } : {}),
    }));
    if (items.length === 0) { uiAlert('请至少填写一条有效金额'); return null; }
    if (items.length === 1) { uiAlert('拆分至少需要两条分录，请补充或退出拆分'); return null; }
    return items;
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
function loadInlineItems(items, type) {
    if (!items || items.length <= 1) { resetInlineItems(); return; }
    _splitData = items.map(it => ({
        category: it.category || '',
        amount: Math.abs(it.amount),
        tags: it.tags || '',
        desc: it.desc || '',
    }));
    enterSplitMode();
    renderSplitItems();
}

// ── 折叠字段展开/收起 ──
function expandMetaField(fieldKey) {
    const expandedEl = $(fieldKey + '-expanded');
    const btnEl = $(fieldKey + '-expand-btn');
    if (!expandedEl) return;
    expandedEl.style.display = '';
    if (btnEl) btnEl.style.display = 'none';
    // 自动聚焦
    if (fieldKey === 'tags') {
        const inp = $('edit-trans-tags');
        if (inp) setTimeout(() => inp.focus(), 50);
    } else if (fieldKey === 'desc') {
        const inp = $('edit-trans-desc');
        if (inp) setTimeout(() => inp.focus(), 50);
    }
}

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

// 根据已有值展开对应的 meta 字段
function expandMetaFieldsForExistingData(tags, desc) {
    if (tags) expandMetaField('tags');
    if (desc) expandMetaField('desc');
}

function expandTransferDescForExistingData(desc) {
    if (desc) expandTransferDesc();
}
