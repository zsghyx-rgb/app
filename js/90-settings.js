// @file js/90-settings.js
// 设置页：金额隐藏、修改数据密码、汇率、分类管理与图标选择器、表格列宽拖拽、图表折叠。

// 点击页面顶部汇总金额循环切换：显示 → 全部隐藏 → 仅隐藏汇总(明细仍可见) → 显示
function toggleAmountVisibility() {
    if (!amountsHidden && !summaryHidden) { amountsHidden = true; summaryHidden = true; }
    else if (amountsHidden) { amountsHidden = false; summaryHidden = true; }
    else { summaryHidden = false; }
    renderAccounts();
    // 重绘列表，让每日合计和每一行金额同时套用隐藏状态
    if (typeof renderAllTransactions === 'function') renderAllTransactions();
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

/**
 * 修改数据密码：把云端每一行都改用新密码加密，本机缓存也一起重写。
 *  - 本机记录：走 push，ts 取「至少不早于云端原值」——服务端只拒绝严格更旧的 ts，相同 ts 会接受；
 *  - 云端有、本机没有的正常行（本机删过、墓碑还没推上去）：走 rekey，只换密文，不动 ts / 归属 / seq，
 *    这样既换掉了密文，又不会把本机已经删掉的记录“复活”；
 *  - 已删除的墓碑行：只能走 rekey（push 对 deleted=1 的行是“已删除：不可复活”，直接跳过），
 *    否则改密后「恢复云端已删除的记录」就再也解不开这些行了；
 *  - 写完全量回读，确认每条正常行都能用新密码解开，才真正切换密码；失败会把写过的行改回旧密码。
 */
function changeDataPassword() {
    const currentInput = $('pwd-current').value;
    const newPwd       = $('pwd-new').value;
    const confirmPwd   = $('pwd-confirm').value;
    const msgEl        = $('pwd-change-msg');
    const btn          = $('pwd-change-btn');

    const showMsg = (text, type) => {
        if (!msgEl) return;
        msgEl.style.display = 'block';
        msgEl.className = `small mb-2 text-${type}`;
        msgEl.innerHTML = text;
    };
    const setBusy = busy => {
        if (!btn) return;
        btn.disabled = busy;
        btn.innerHTML = busy
            ? '<span class="spinner-border spinner-border-sm me-1"></span>处理中…'
            : '<i class="bi bi-check-lg"></i> 确认修改';
    };

    if (offlineMode) {
        showMsg('<i class="bi bi-x-circle"></i> 离线模式下无法重新加密云端数据，请先切换到在线模式', 'danger');
        return;
    }
    if (driveIsSyncing) {
        showMsg('<i class="bi bi-hourglass-split"></i> 正在同步中，请等这次同步结束后再修改密码', 'warning');
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
    if (newPwd === userPassword) {
        showMsg('<i class="bi bi-info-circle"></i> 新密码和当前密码相同，不需要修改', 'warning');
        return;
    }

    // 整个过程中 userPassword 保持旧值，只有校验全部通过后才切换，
    // 这样中途失败（网络断开等）时本机缓存和内存数据仍然是旧密码，不会出现“本机也一半新一半旧”。
    (async () => {
        const oldPwd = userPassword;
        let rewriteAll = null;
        let rewritten = false;
        setBusy(true);
        driveIsSyncing = true;          // 期间不要让自动同步插进来
        try {
            saveUserData();
            const state = incLoadState();

            showMsg('<i class="bi bi-hourglass-split"></i> 正在读取云端全部数据…', 'warning');
            const firstRows = await incPullRows(0);

            // 用旧密码解开云端每一行（含已删除的墓碑行——它们的密文同样要换掉）。
            // 个别旧密码也解不开的行（以前改密留下的残留、别的工具写入）先记下来：
            // 它们不参与后面的校验，也不阻断这次改密。
            const cloudRec = new Map();      // id -> 明文（只换密文的重写要用）
            const broken = new Set();        // 旧密码解不开的 id
            const decrypted = [];
            firstRows.forEach(row => {
                try {
                    const rec = incDec(row.enc, oldPwd);
                    cloudRec.set(String(row.id), rec);
                    if (!row.deleted) decrypted.push({ row, rec });
                } catch (_) {
                    broken.add(String(row.id));
                    if (row.deleted) decrypted.push({ row, rec: null });
                }
            });

            // 先把云端最新数据合并进本机，待重加密的每一行都是最新版本
            incApplyRows(inMemoryLoadedData, decrypted, state);
            incRefreshAfterMerge({ changed: 1, configChanged: true });
            saveUserData();

            const baseTs = new Map(firstRows.map(r => [String(r.id), Number(r.ts) || 0]));
            const firstRowsById = new Map();
            firstRows.forEach(r => firstRowsById.set(String(r.id), r));

            // 用 pw 重写一次云端：本机记录全部 push，云端独有的行和墓碑行只换密文。
            // forceTs > 0 时给所有行一个“现在”的 ts（重试时用，保证服务端一定接受）。
            rewriteAll = async (pw, forceTs) => {
                const local = incCollectLocal(inMemoryLoadedData);
                const upserts = [];
                local.forEach((item, id) => {
                    upserts.push({
                        item, sig: incSig(item.payload),
                        ts: Math.max(forceTs || 0, incTsOf(item), baseTs.get(id) || 0)
                    });
                });
                const pushedRes = await incPushUpserts(upserts, state, pw);

                const rekeyRows = [];
                const cloudOnly = [];
                firstRowsById.forEach((row, id) => {
                    const rec = cloudRec.get(id);
                    if (rec == null) return;                       // 旧密码就解不开：没有明文可重写
                    if (row.deleted) {                             // 墓碑行：只换密文
                        rekeyRows.push({ id, enc: incEnc(rec, pw) });
                        return;
                    }
                    if (local.has(id)) return;                     // 本机记录已经 push 过了
                    if (row.kind !== 'acc' && row.kind !== 'txn' && row.kind !== 'plan') return;
                    rekeyRows.push({ id, enc: incEnc(rec, pw) });
                    cloudOnly.push({
                        item: { id, kind: row.kind, owner: row.owner, payload: rec },
                        sig: incSig(rec), ts: Math.max(forceTs || 0, Number(row.ts) || 0)
                    });
                });
                let rekey = { updated: 0, unsupported: false, tooLarge: 0 };
                if (rekeyRows.length) rekey = await incRekeyRows(rekeyRows);
                if (rekey.unsupported && cloudOnly.length) {
                    // 服务端还是旧版 Code.gs（没有 rekey）：这些本机没有的行只能也 push 一遍（内容不变）
                    await incPushUpserts(cloudOnly, state, pw);
                }
                return { pushed: pushedRes.pushed, rekey };
            };

            // 最多写 3 次并回读校验：所有“旧密码本来能解开”的正常行都必须能用新密码解开
            let verified = false, lastBad = 0, lastStat = null;
            for (let attempt = 1; attempt <= 3 && !verified; attempt++) {
                showMsg(`<i class="bi bi-hourglass-split"></i> 正在用新密码重新加密云端数据…（第 ${attempt}/3 次）`, 'warning');
                lastStat = await rewriteAll(newPwd, attempt > 1 ? Date.now() : 0);
                rewritten = true;
                const checkRows = await incPullRows(0);
                const bad = checkRows.filter(r => !r.deleted && !broken.has(String(r.id)) && !incCanDecrypt(r.enc, newPwd));
                if (bad.length) {
                    lastBad = bad.length;
                } else {
                    checkRows.forEach(r => { if (r.seq > state.lastSeq) state.lastSeq = r.seq; });
                    verified = true;
                }
            }
            if (!verified) throw new Error(`还有 ${lastBad} 条云端记录没能改用新密码`);

            // 校验通过，才真正切换密码：内存、本机缓存（APP_raw_cache）一起换成新密码
            userPassword = newPwd;
            incPersistLocal(state, true);
            clearUnsavedFlag();
            hasUnsavedChanges = false;
            try { bootstrap.Modal.getInstance($('changePwdModal')).hide(); } catch (_) {}
            initPasswordHint();

            let extra = '';
            if (lastStat && lastStat.rekey && lastStat.rekey.unsupported) {
                extra += '；服务端还是旧版 Code.gs，云端已删除的记录仍是旧密码（重新部署 Code.gs 后请再改一次密码）';
            }
            if (lastStat && lastStat.rekey && lastStat.rekey.tooLarge) {
                extra += `；有 ${lastStat.rekey.tooLarge} 条记录内容过大，密文无法重写`;
            }
            if (broken.size) {
                extra += `；另有 ${broken.size} 条记录原本就无法用当前密码解开，本次未改动`;
            }
            showToast(`密码已更新，云端 ${(lastStat && lastStat.pushed) || 0} 条记录已用新密码重新加密；其他设备下次登录需输入新密码${extra}`, 'success', 7000);
        } catch (e) {
            // 失败回滚：把这次写过的行再用旧密码写回去，避免云端留下半新半旧的数据。
            // 回滚也失败时不切换本机密码，提示用户留在本页重试（重试会从头再写一遍）。
            let rolledBack = false;
            if (rewritten && rewriteAll) {
                try { await rewriteAll(oldPwd, Date.now()); rolledBack = true; } catch (_) {}
            }
            showMsg('<i class="bi bi-x-circle"></i> 修改未完成：' + _escHtml(e.message) + '<br>' +
                (rolledBack
                    ? '已把这次写入的部分改回原密码，云端没有留下半新半旧的数据，请稍后重试。'
                    : '请保持本页面不要退出，稍后再点一次「确认修改」重试（表单内容不用改）。'), 'danger');
            showToast('密码修改未完成', 'error', 0);
        } finally {
            driveIsSyncing = false;
            setBusy(false);
            syncBarRender();
            // 失败时本机可能还有没上传的改动：恢复自动同步，让它在旧密码下正常把改动推上去
            if (hasUnsavedChanges && typeof scheduleAutoSync === 'function') scheduleAutoSync();
        }
    })();
}

function initPasswordHint() {
    const hint = $('pwd-status-hint');
    if (!hint) return;
    hint.textContent = userPassword ? '云端数据使用密码加密' : '当前没有加密密码';
}

/* ───────── 设置 › 数据与同步：状态卡片（5.1.8） ───────── */
function _dsFmtTime(ts) {
    const n = Number(ts);
    if (!n) return '—';
    const d = new Date(n);
    if (isNaN(d.getTime())) return '—';
    const p = x => String(x).padStart(2, '0');
    const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return '今天 ' + hm;
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}

function renderDataSyncStatus() {
    const sub = $('ds-status-sub'), pill = $('ds-status-pill');
    if (!sub || !pill) return;
    const lastEl = $('ds-last-sync'), cntEl = $('ds-record-count'), pendEl = $('ds-pending');
    const badge = $('offline-mode-badge');
    if (badge) badge.style.display = offlineMode ? '' : 'none';

    let records = 0;
    const all = (inMemoryLoadedData && inMemoryLoadedData.allUserData) || {};
    Object.values(all).forEach(ud => {
        records += (ud.accounts || []).length + (ud.transactions || []).length + (ud.plannedTransactions || []).length;
    });

    // 待同步数量：和同步时同一套差异算法，但不改任何状态
    let pending = 0;
    try {
        if (inMemoryLoadedData) {
            const d = incDiffLocal(inMemoryLoadedData, incLoadState(), false);
            pending = d.upserts.length + d.tombstones.length;
        }
    } catch (_) {}

    if (lastEl) lastEl.textContent = _dsFmtTime(localStorage.getItem('APP_last_sync_time'));
    if (cntEl) cntEl.textContent = records + ' 条';
    if (pendEl) pendEl.textContent = pending > 0 ? pending + ' 项' : '无';

    let cls = 'ok', text = '已同步', subText = '数据已与云端一致，无需操作';
    if (!userPassword) { cls = 'off'; text = '未登录'; subText = '输入数据密码后才能同步'; }
    else if (offlineMode) { cls = 'off'; text = '离线'; subText = '离线模式只读写本机缓存，不会联网'; }
    else if (_barError) { cls = 'err'; text = '同步失败'; subText = _barError.msg || '同步失败'; }
    else if (driveIsSyncing) { cls = 'warn'; text = '同步中'; subText = '正在和 Google 表格同步…'; }
    else if (hasUnsavedChanges || pending > 0) { cls = 'warn'; text = '待同步'; subText = '改动会在 4 秒后自动上传，也可以点下面的按钮立即同步'; }
    pill.className = 'ds-pill ds-pill-' + cls;
    pill.textContent = text;
    sub.textContent = subText;
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
