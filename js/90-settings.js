// @file js/90-settings.js
// 设置页：金额隐藏、修改数据密码、汇率、分类管理与图标选择器、表格列宽拖拽、图表折叠。

// 点击页面顶部汇总金额循环切换：显示 → 全部隐藏 → 仅隐藏汇总(明细仍可见) → 显示
function toggleAmountVisibility() {
    if (!amountsHidden && !summaryHidden) { amountsHidden = true; summaryHidden = true; }
    else if (amountsHidden) { amountsHidden = false; summaryHidden = true; }
    else { summaryHidden = false; }
    renderAccounts();
    // 重绘列表，让首页概览、每日合计和每一行金额同时套用隐藏状态
    if (typeof renderAllTransactions === 'function') renderAllTransactions();
    else renderTransactionsHero();
    if ($('view-stats').classList.contains('active-view')) renderStats();
}

function openChangePwdModal() {
    ['pwd-current','pwd-new','pwd-confirm'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
    });
    const msg = $('pwd-change-msg');
    if (msg) msg.style.display = 'none';
    new bootstrap.Modal($('changePwdModal')).show();
    // Focus first relevant field after animation
    setTimeout(() => {
        const first = userPassword
            ? $('pwd-current')
            : $('pwd-new');
        if (first) first.focus();
    }, 350);
}

function changeDataPassword() {
    const currentInput = $('pwd-current').value;
    const newPwd       = $('pwd-new').value;
    const confirmPwd   = $('pwd-confirm').value;
    const msgEl        = $('pwd-change-msg');

    const showMsg = (text, type) => {
        msgEl.style.display = 'block';
        msgEl.className = `small mb-2 text-${type}`;
        msgEl.innerHTML = text;
    };

    if (offlineMode) {
        showMsg('<i class="bi bi-x-circle"></i> 离线模式下无法重新加密云端数据，请先切换到在线模式', 'danger');
        return;
    }
    if (userPassword && currentInput !== userPassword) {
        showMsg('<i class="bi bi-x-circle"></i> 当前密码不正确', 'danger');
        return;
    }
    if (!newPwd) {
        showMsg('<i class="bi bi-x-circle"></i> 新密码不能为空', 'danger');
        return;
    }
    if (newPwd.length < 8) {
        showMsg('<i class="bi bi-x-circle"></i> 新密码至少需要 8 位', 'danger');
        return;
    }
    if (newPwd !== confirmPwd) {
        showMsg('<i class="bi bi-x-circle"></i> 两次输入的密码不一致', 'danger');
        return;
    }

    // 改密必须把云端每一行都用新密码重新加密，否则新旧密码混合会导致之后无法解密。
    (async () => {
        const oldPwd = userPassword;
        saveUserData();

        try {
            showMsg('<i class="bi bi-hourglass-split"></i> 正在核对云端数据…', 'warning');
            const state = incLoadState();
            // 先用旧密码拉取一次，确保本机包含云端最新数据
            const rows = await incPullRows(state.lastSeq);
            incApplyRows(inMemoryLoadedData, incDecryptRows(rows, oldPwd), state);
            saveUserData();

            userPassword = newPwd;
            showMsg('<i class="bi bi-hourglass-split"></i> 正在用新密码重新加密云端数据…', 'warning');

            let verified = false;
            let lastErr = null;
            for (let attempt = 1; attempt <= 3 && !verified; attempt++) {
                const local = incCollectLocal(inMemoryLoadedData);
                const upserts = Array.from(local.values()).map(item => ({ item, sig: incSig(item.payload) }));
                await incPushUpserts(upserts, state);

                const checkRows = await incPullRows(0);
                try {
                    incDecryptRows(checkRows, newPwd);
                    checkRows.forEach(r => { if (r.seq > state.lastSeq) state.lastSeq = r.seq; });
                    verified = true;
                } catch (e) {
                    lastErr = e;
                }
            }
            if (!verified) throw lastErr || new Error('校验失败');

            incPersistLocal(state, true);
            clearUnsavedFlag();
            bootstrap.Modal.getInstance($('changePwdModal')).hide();
            initPasswordHint();
            showToast('密码已更新，云端数据已用新密码重新加密；其他设备下次同步需输入新密码', 'success', 6000);
        } catch (e) {
            // 不自动恢复旧密码：可能已有部分行写入了新密码，恢复旧密码会让这些行无法解密。
            showMsg('<i class="bi bi-x-circle"></i> 修改未完成：' + _escHtml(e.message) +
                '<br>请保持当前页面不要退出，再点一次「修改密码」重试（新密码保持不变）。', 'danger');
            showToast('密码修改未完成，请重试', 'error', 0);
        }
    })();
}

function initPasswordHint() {
    const hint = $('pwd-status-hint');
    if (!hint) return;
    hint.textContent = userPassword ? '云端数据使用密码加密' : '当前没有加密密码';
}

const FOREIGN_CURRENCIES = [
    { code: 'EUR', symbol: '€', label: '欧元' },
    { code: 'USD', symbol: '$', label: '美元' },
    { code: 'HKD', symbol: 'HK$', label: '港元' },
    { code: 'JPY', symbol: '¥', label: '日元' },
    { code: 'GBP', symbol: '£', label: '英镑' },
];

function getActiveForeignCurrencies() {
    // Returns currencies that at least one account uses (excluding RMB)
    const usedCurrencies = new Set(accounts.map(a => a.currency).filter(c => c !== 'RMB'));
    return FOREIGN_CURRENCIES.filter(c => usedCurrencies.has(c.code));
}

function renderStatsCurrencyButtons() {
    // 货币按钮
    const container = $('stats-currency-btns');
    if (container) {
        const activeForeign = getActiveForeignCurrencies();
        const allBtns = [
            { code: 'RMB', label: 'CNY (¥)', style: 'btn-outline-success' },
            ...activeForeign.map(c => ({ code: c.code, label: `${c.code} (${c.symbol})`, style: 'btn-outline-info' }))
        ];
        container.innerHTML = allBtns.map(b => {
            const isActive = currentStatsFilter.currency === b.code ? ' active' : '';
            return `<button class="btn btn-sm ${b.style}${isActive}" onclick="switchStatsCurrency('${b.code}', this)">${b.label}</button>`;
        }).join('');
        if (currentStatsFilter.currency !== 'RMB' && !activeForeign.find(c => c.code === currentStatsFilter.currency)) {
            currentStatsFilter.currency = 'RMB';
            const firstBtn = container.querySelector('button');
            if (firstBtn) firstBtn.classList.add('active');
        }
    }
    // 用户按钮
    const userContainer = $('stats-user-btns');
    if (userContainer) {
        const users = dataUsers && dataUsers.length ? dataUsers : [];
        const opts = [{ key: 'all', label: '所有用户' }, ...users.map(u => ({ key: u, label: u }))];
        userContainer.innerHTML = opts.map(o => {
            const isActive = (currentStatsFilter.user || 'all') === o.key ? ' active' : '';
            return `<button class="btn btn-sm btn-outline-secondary${isActive}" data-user="${o.key}" onclick="switchStatsUser('${o.key}')">${o.label}</button>`;
        }).join('');
    }
}

function renderExchangeRateSettings() {
    const container = $('exchange-rate-inputs');
    if (!container) return;
    container.innerHTML = '';
    const activeForeign = getActiveForeignCurrencies();
    if (activeForeign.length === 0) {
        container.innerHTML = '<p class="text-muted small">暂无外币账户，添加外币账户后此处将显示汇率设置。</p>';
        $('current-exchange-rate').innerText = '-';
        return;
    }
    activeForeign.forEach(cur => {
        const key = `${cur.code}_RMB`;
        const rate = exchangeRates[key] || DEFAULT_RATES[key] || 1;
        const inputId = `rate-${cur.code}`;
        const div = document.createElement('div');
        div.className = 'input-group mb-2';
        div.innerHTML = `
            <span class="input-group-text" style="width:100px;">1 ${cur.symbol} (${cur.code})</span>
            <input type="text" inputmode="decimal" class="form-control decimal-input" data-max-decimals="4" id="${inputId}" value="${rate}">
            <span class="input-group-text">¥</span>
            <button class="btn btn-outline-primary btn-sm" onclick="setExchangeRate('${cur.code}', 'RMB', $('${inputId}').value)">保存</button>`;
        container.appendChild(div);
    });
    const summaryParts = activeForeign.map(cur => {
        const key = `${cur.code}_RMB`;
        const rate = exchangeRates[key] || DEFAULT_RATES[key] || 1;
        return `1 ${cur.symbol} = ${rate} ¥`;
    });
    $('current-exchange-rate').innerText = summaryParts.join(' | ');
}

function setExchangeRate(from, to, rate) {
    const key = `${from}_${to}`;
    exchangeRates[key] = parseFloat(rate);
    markConfigUpdated(); saveUserData(); triggerAutoSave();
    renderExchangeRateSettings();
    if (verboseToast) showToast('汇率已更新', 'success');
}

function renderCategorySettings() {
    var render = function(type, id) {
        var div = $(id);
        if (!div) return;
        div.innerHTML = '';
        if (!categories[type]) return;
        var list = document.createElement('div');
        list.className = 'cat-sort-list';
        categories[type].forEach(function(cat, idx) {
            var meta = getCatIcon(cat);
            var row = document.createElement('div');
            row.className = 'cat-sort-item d-flex align-items-center gap-2 p-2 mb-1 rounded border';
            row.style.background = 'var(--bs-secondary-bg)';
            row.innerHTML = '\
                <div class="d-flex flex-column gap-0">\
                    <button class="btn btn-sm py-0 px-1 ' + (idx === 0 ? 'invisible' : '') + '" onclick="moveCategory(\'' + type + '\',' + idx + ',-1)" style="line-height:1;"><i class="bi bi-chevron-up"></i></button>\
                    <button class="btn btn-sm py-0 px-1 ' + (idx === categories[type].length - 1 ? 'invisible' : '') + '" onclick="moveCategory(\'' + type + '\',' + idx + ',1)" style="line-height:1;"><i class="bi bi-chevron-down"></i></button>\
                </div>\
                <span class="cat-icon-mini" style="--cat-color:' + meta.color + ';--cat-color-rgb:' + _catColorRgbStr(meta.color) + ';cursor:pointer;" onclick="openIconPicker(\'' + type + '\',\'' + cat + '\')" title="设置图标"><i class="bi ' + meta.icon + '"></i></span>\
                <span class="cat-text flex-grow-1" style="cursor:pointer;" title="点击修改名称" onclick="editCategoryName(\'' + type + '\',\'' + cat + '\')">' + cat + '</span>\
                <button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="removeCategory(\'' + type + '\',\'' + cat + '\')" title="删除分类"><i class="bi bi-trash"></i></button>';
            row.dataset.idx = idx;
            row.dataset.type = type;
            list.appendChild(row);
        });
        div.appendChild(list);
    };
    render('expense', 'expense-cat-container');
    render('income', 'income-cat-container');
    updateSelectOptions();
}

function moveCategory(type, idx, dir) {
    var list = categories[type];
    var target = idx + dir;
    if (target < 0 || target >= list.length) return;
    var temp = list[idx];
    list[idx] = list[target];
    list[target] = temp;
    markConfigUpdated(); saveUserData(); triggerAutoSave(); renderCategorySettings();
}

function addCategory(e, type) {
    e.preventDefault();
    const input = $(type === 'expense' ? 'new-expense-cat' : 'new-income-cat');
    const val = input.value.trim();
    if (!val) return;
    if (categories[type].includes(val)) {
        showToast(`分类「${val}」已存在`, 'warning', 2200);
        return;
    }
    categories[type].push(val); input.value = '';
    markConfigUpdated(); saveUserData(); triggerAutoSave(); renderCategorySettings();
    showToast(`分类「${val}」已添加`, 'success', 2200);
    setTimeout(function() { openIconPicker(type, val); }, 100);
}

async function removeCategory(type, cat) {
    const affected = transactions.filter(t => t.type === type && t.category === cat);
    const affectedPlans = plannedTransactions ? plannedTransactions.filter(p => p.type === type && p.category === cat) : [];
    let confirmMsg = `确定删除分类 "${cat}"？`;
    if (affected.length > 0) confirmMsg += `\n\n⚠️ 将影响 ${affected.length} 条历史记录（改为"未分类"）`;
    if (affectedPlans.length > 0) confirmMsg += `\n⚠️ 将影响 ${affectedPlans.length} 条计划交易（改为"未分类"）`;
    const ok = await uiConfirm(confirmMsg, { okText: '删除分类', danger: true });
    if (!ok) return;

    const snapCats = categories[type].slice();
    const snapIcon = categoryIcons[cat];

    categories[type] = categories[type].filter(c => c !== cat);
    affected.forEach(t => { t.category = '未分类'; });
    affectedPlans.forEach(p => { p.category = '未分类'; });
    delete categoryIcons[cat];
    markConfigUpdated(); saveUserData(); triggerAutoSave(); renderCategorySettings();
    displayedTransactionCount = 100; renderAllTransactions(); renderStats();
    showToast(`分类「${cat}」已删除`, 'success', 2200);

    showUndo(`已删除分类「${cat}」`, () => {
        categories[type] = snapCats;
        affected.forEach(t => { t.category = cat; });
        affectedPlans.forEach(p => { p.category = cat; });
        if (snapIcon) categoryIcons[cat] = snapIcon;
        markConfigUpdated(); saveUserData(); triggerAutoSave(); renderCategorySettings();
        renderAllTransactions(); renderStats();
        showToast('已撤销，分类已恢复', 'info', 2000);
    });
}

// ── 分类图标选择器 ───────────────────────────────────────────
const ICON_PICKER_LIST = [
    // 餐饮
    'bi-cup-hot-fill','bi-cup-straw','bi-cup-fill','bi-basket-fill','bi-basket2-fill','bi-basket3-fill',
    'bi-egg-fried','bi-flower1','bi-flower2',
    // 交通
    'bi-car-front-fill','bi-bus-front-fill','bi-train-front-fill','bi-airplane-fill','bi-bicycle',
    'bi-fuel-pump-fill','bi-scooter','bi-ship-fill','bi-geo-alt-fill','bi-signpost-fill',
    // 住房
    'bi-house-fill','bi-house-door-fill','bi-house-gear-fill','bi-building','bi-building-fill','bi-door-open-fill',
    'bi-key-fill','bi-lamp-fill','bi-fan','bi-tools','bi-hammer','bi-bricks',
    // 购物
    'bi-handbag-fill','bi-bag-fill','bi-bag-check-fill','bi-bag-dash-fill','bi-bag-plus-fill',
    'bi-cart-fill','bi-cart-check-fill','bi-box-seam-fill','bi-gift-fill','bi-tshirt-fill',
    'bi-gem','bi-tag-fill','bi-tags-fill',
    // 娱乐
    'bi-controller','bi-film','bi-music-note-beamed','bi-dice-5-fill','bi-camera-reels-fill',
    'bi-camera-fill','bi-headset','bi-boombox-fill','bi-play-circle-fill','bi-collection-play-fill',
    'bi-mic-fill','bi-easel2-fill',
    // 医疗
    'bi-heart-pulse-fill','bi-capsule','bi-bandaid-fill','bi-heart-fill','bi-heartbreak-fill',
    'bi-activity','bi-droplet','bi-droplet-fill','bi-eyedropper','bi-exclamation-octagon-fill','bi-shield-plus',
    // 教育
    'bi-mortarboard-fill','bi-book-fill','bi-book-half','bi-journal-text','bi-pencil-square',
    'bi-pencil-fill','bi-pen-fill','bi-pen','bi-clipboard2-pulse-fill','bi-globe2',
    // 数码
    'bi-laptop','bi-phone-fill','bi-tablet-fill','bi-wifi','bi-bluetooth','bi-printer-fill',
    'bi-cpu-fill','bi-motherboard-fill','bi-usb-drive-fill','bi-watch','bi-smartwatch',
    // 运动
    'bi-trophy-fill','bi-award-fill','bi-star-fill','bi-emoji-sunglasses-fill','bi-person-arms-up',
    // 人情往来
    'bi-people-fill','bi-person-fill','bi-people','bi-person-heart','bi-envelope-fill',
    'bi-envelope-paper-fill','bi-chat-heart-fill','bi-suit-heart-fill','bi-balloon-fill',
    // 旅行
    'bi-suitcase-fill','bi-suitcase2-fill','bi-compass-fill','bi-map-fill','bi-globe-asia-australia',
    'bi-sun-fill','bi-umbrella-fill','bi-tree-fill','bi-moon-stars-fill','bi-water',
    // 宠物
    'bi-p-circle-fill','bi-paw','bi-cat-fill','bi-dog-fill','bi-bug-fill','bi-tree',
    // 工资/收入
    'bi-cash-coin','bi-cash-stack','bi-bank','bi-wallet2','bi-credit-card-fill','bi-wallet-fill',
    'bi-coin','bi-piggy-bank-fill','bi-briefcase-fill','bi-briefcase','bi-bar-chart-fill',
    // 投资/理财
    'bi-graph-up-arrow','bi-graph-down-arrow','bi-graph-up','bi-pie-chart-fill','bi-bar-chart-line-fill',
    'bi-currency-exchange','bi-arrow-up-circle-fill','bi-arrow-down-circle-fill',
    // 礼金/退款
    'bi-gift','bi-megaphone-fill','bi-bell-fill','bi-ticket-perforated-fill','bi-receipt',
    'bi-receipt-cutoff','bi-arrow-counterclockwise','bi-arrow-return-left','bi-send-fill',
    // 其他
    'bi-three-dots','bi-question-circle','bi-sliders','bi-shield-check','bi-patch-check-fill',
    'bi-check-circle-fill','bi-x-circle-fill','bi-plus-circle-fill','bi-dash-circle-fill',
    'bi-info-circle-fill','bi-exclamation-triangle-fill','bi-cloud-sun-fill','bi-fire',
    'bi-trash-fill','bi-folder-fill','bi-file-earmark-text','bi-clipboard-data','bi-stopwatch-fill',
    'bi-box-fill','bi-cone-striped','bi-brightness-high-fill','bi-palette-fill',
    'bi-emoji-smile-fill','bi-stars','bi-scissors','bi-umbrella','bi-moon',
    'bi-lightning-charge-fill','bi-plug-fill','bi-droplet-half',
];
const ICON_PICKER_COLORS = ['#fd7e14','#dc3545','#d63384','#6610f2','#0d6efd','#0dcaf0','#198754','#6c757d'];

let _iconPickerType = '';
let _iconPickerCat = '';
let _iconPickerIcon = '';
let _iconPickerColor = '';

function openIconPicker(type, cat) {
    const current = getCatIcon(cat);
    _iconPickerType = type;
    _iconPickerCat = cat;
    _iconPickerIcon = current.icon;
    _iconPickerColor = current.color;
    $('icon-picker-cat-name').textContent = cat;
    $('icon-picker-type').value = type;
    $('icon-picker-cat').value = cat;

    const colorRow = $('icon-picker-color-row');
    colorRow.innerHTML = ICON_PICKER_COLORS.map(c =>
        `<div class="icon-picker-color-item${c === _iconPickerColor ? ' selected' : ''}" style="--swatch-color:${c};" onclick="selectIconPickerColor('${c}')"></div>`
    ).join('');

    renderIconPickerGrid();
    bootstrap.Modal.getOrCreateInstance($('iconPickerModal')).show();
}

function renderIconPickerGrid() {
    const grid = $('icon-picker-grid');
    grid.style.setProperty('--picker-color', _iconPickerColor);
    grid.style.setProperty('--picker-color-rgb', _catColorRgbStr(_iconPickerColor));
    grid.innerHTML = ICON_PICKER_LIST.map(ic =>
        `<div class="icon-picker-item${ic === _iconPickerIcon ? ' selected' : ''}" onclick="selectIconPickerIcon('${ic}')"><i class="bi ${ic}"></i></div>`
    ).join('');
}

function selectIconPickerColor(color) {
    _iconPickerColor = color;
    $$('#icon-picker-color-row .icon-picker-color-item').forEach(el => {
        el.classList.toggle('selected', el.style.getPropertyValue('--swatch-color') === color);
    });
    renderIconPickerGrid();
    applyIconPickerSelection();
}

function selectIconPickerIcon(icon) {
    _iconPickerIcon = icon;
    renderIconPickerGrid();
    applyIconPickerSelection();
}

function applyIconPickerSelection() {
    categoryIcons[_iconPickerCat] = { icon: _iconPickerIcon, color: _iconPickerColor };
    markConfigUpdated(); saveUserData(); triggerAutoSave();
    renderCategorySettings();
}

function resetIconPicker() {
    delete categoryIcons[_iconPickerCat];
    markConfigUpdated(); saveUserData(); triggerAutoSave();
    renderCategorySettings();
    bootstrap.Modal.getInstance($('iconPickerModal'))?.hide();
}

async function editCategoryName(type, oldName) {
    const newName = await uiPrompt(`将「${oldName}」修改为：`, { title: '修改分类名称', okText: '保存', input: { value: oldName } });
    if (!newName) return;
    const trimmedName = newName.trim();
    if (trimmedName === '' || trimmedName === oldName) return;
    if (categories[type].includes(trimmedName)) { uiAlert('该分类名称已存在！'); return; }
    const catIdx = categories[type].indexOf(oldName);
    if (catIdx > -1) categories[type][catIdx] = trimmedName;
    transactions.forEach(t => {
        if (t.type !== type) return;
        if (t.category === oldName) t.category = trimmedName;
        if (t.items) t.items.forEach(it => { if (it.category === oldName) it.category = trimmedName; });
        // 同步顶层 category（拆分交易顶层是 items[0].category 的缓存）
        if (t.items && t.items.length > 0) t.category = t.items[0].category;
    });
    if (plannedTransactions) plannedTransactions.forEach(p => { if (p.type === type && p.category === oldName) p.category = trimmedName; });
    markConfigUpdated(); saveUserData(); triggerAutoSave(); renderCategorySettings();
    displayedTransactionCount = 100; renderAllTransactions(); renderStats();
    if (verboseToast) showToast(`分类已重命名: "${oldName}" → "${trimmedName}"`, 'success');
}

let resizingColumn = null, startX = 0, startWidth = 0;
function startColumnResize(e, resizer) {
    e.stopPropagation(); e.preventDefault();
    resizingColumn = resizer.parentElement; startX = e.pageX; startWidth = resizingColumn.offsetWidth;
    document.addEventListener('mousemove', doColumnResize);
    document.addEventListener('mouseup', stopColumnResize);
}
function doColumnResize(e) {
    if (!resizingColumn) return;
    const width = startWidth + (e.pageX - startX);
    if (width > 50) { resizingColumn.style.width = `${width}px`; resizingColumn.style.minWidth = `${width}px`; }
}
function stopColumnResize() {
    resizingColumn = null;
    document.removeEventListener('mousemove', doColumnResize);
    document.removeEventListener('mouseup', stopColumnResize);
}

function toggleChartVisibility(wrapperId, btn) {
    const wrapper = $(wrapperId);
    const isHidden = wrapper.classList.contains('d-none');
    if (isHidden) {
        wrapper.classList.remove('d-none');
        btn.innerHTML = '<i class="bi bi-eye-slash"></i> 隐藏图表';
        btn.classList.replace('btn-primary', 'btn-outline-secondary');
        // 资产曲线是计算量最大的一张图，展开时才计算/绘制
        renderAssetHistoryChart();
    } else {
        wrapper.classList.add('d-none');
        btn.innerHTML = '<i class="bi bi-eye"></i> 显示图表';
        btn.classList.replace('btn-outline-secondary', 'btn-primary');
    }
}
