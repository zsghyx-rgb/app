// @file js/80-charts.js
// 图表钻取抽屉关闭、各类 Chart.js 图表渲染(支出/标签/趋势/净资产/资产历史/分类趋势/总支出趋势)与 select 选项更新。

// ─────────────────────────────────────────────────────────────
function closeChartDrawer() {
    $('chart-drawer').classList.remove('show');
    $('chart-drawer-backdrop').classList.remove('show');
    document.body.style.overflow = '';
    // 注意：_fromChartDrawer 不在此处清除——若是点击流水卡片触发的关闭，
    // 需要保留该标记以便弹窗关闭后重新弹出抽屉。只有用户主动关闭时才清除。
    if (!_fromChartDrawer) {
        // already false, nothing to do
    }
}

function closeChartDrawerByUser() {
    _fromChartDrawer = false;
    closeChartDrawer();
}

// 拆分交易钻取辅助：按类别取出对应分录的"虚拟流水"，金额只取该分录自身金额，
// 避免拆分交易的总金额被错误地全部计入其中某一个分类
function expandTxByCategory(t, cat) {
    if (t.items && t.items.length > 1) {
        return t.items
            .filter(it => it.category === cat)
            .map(it => ({
                ...t,
                amount: it.amount,
                category: it.category,
                tags: it.tags || t.tags,
                desc: it.desc || t.desc,
                
                items: undefined,
                _splitPortion: true
            }));
    }
    return t.category === cat ? [t] : [];
}

// 拆分交易钻取辅助：按标签取出对应分录的"虚拟流水"。
// 拆分交易的每个分录可以有自己的标签（it.tags），若分录未单独设置标签则继承整笔的 t.tags。
// 金额只取该分录自身金额，避免一笔拆分交易的总金额被重复/错误计入某个标签。
function expandTxByTag(t, tag) {
    if (t.items && t.items.length > 1) {
        return t.items
            .filter(it => {
                const itTags = (it.tags || t.tags || '').trim();
                return itTags && itTags.split(' ').includes(tag);
            })
            .map(it => ({
                ...t,
                amount: it.amount,
                category: it.category,
                tags: it.tags || t.tags,
                desc: it.desc || t.desc,
                
                items: undefined,
                _splitPortion: true
            }));
    }
    return (t.tags && t.tags.split(' ').includes(tag)) ? [t] : [];
}

// ─────────────────────────────────────────────────────────────
/** 复用已有图表实例：数据没变时只更新数据，不再 destroy + new Chart */
function upsertChart(key, canvas, config) {
    const existing = chartInstances[key];
    const existingCanvas = existing && existing.ctx && existing.ctx.canvas;
    if (existing && existingCanvas === canvas) {
        existing.data = config.data;
        existing.update('none');
        return existing;
    }
    if (existing) existing.destroy();
    chartInstances[key] = new Chart(canvas, config);
    return chartInstances[key];
}

function renderExpenseChart(data) {
    const ctx = $('expenseCategoryChart');
    if (!ctx) return;
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    const cats = {};
    data.filter(t => t.amount < 0 && !t.isTransfer).forEach(t => {
        const acc = accMap.get(String(t.accountId));
        if (!acc) return;
        if (t.items && t.items.length > 1) {
            t.items.forEach(it => {
                const amt = convertAmt(Math.abs(it.amount), acc.currency);
                cats[it.category] = (cats[it.category] || 0) + amt;
            });
        } else {
            const amt = convertAmt(Math.abs(t.amount), acc.currency);
            cats[t.category] = (cats[t.category] || 0) + amt;
        }
    });
    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const t = getChartTheme();
    const chart = upsertChart('expense', ctx, {
        type: 'bar',
        data: { labels: sorted.map(x => x[0]), datasets: [{ label: '支出', data: sorted.map(x => x[1]), backgroundColor: t.expense }] },
        options: {
            indexAxis: 'y', maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.muted } },
                y: { grid: { display: false }, ticks: { color: t.text } }
            }, animation: { duration: 0 },
            onClick(e, els) {
                const meta = chartInstances.expense && chartInstances.expense.$meta;
                if (!meta || !els.length) return;
                const cat = meta.sorted[els[0].index][0];
                const txs = meta.data
                    .filter(t => t.amount < 0 && !t.isTransfer)
                    .flatMap(t => expandTxByCategory(t, cat));
                showChartDrawer(`支出排行 · ${cat}`, txs);
            }
        }
    });
    chart.$meta = { sorted, data };
}

function renderTagChart(data) {
    const ctx = $('tagStatsChart');
    if (!ctx) return;
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    const tags = {};
    data.forEach(t => {
        const acc = accMap.get(String(t.accountId));
        if (!acc) return;
        if (t.items && t.items.length > 1) {
            // 拆分交易：每个分录可能有自己的标签，未单独设置则继承整笔的标签
            t.items.forEach(it => {
                const itTags = (it.tags || t.tags || '').trim();
                if (!itTags) return;
                const amt = convertAmt(Math.abs(it.amount), acc.currency);
                itTags.split(' ').filter(Boolean).forEach(tag => tags[tag] = (tags[tag] || 0) + amt);
            });
        } else {
            if (!t.tags) return;
            const amt = convertAmt(Math.abs(t.amount), acc.currency);
            t.tags.split(' ').filter(Boolean).forEach(tag => tags[tag] = (tags[tag] || 0) + amt);
        }
    });
    const sorted = Object.entries(tags).sort((a, b) => b[1] - a[1]);
    const t = getChartTheme();
    const chart = upsertChart('tags', ctx, {
        type: 'bar',
        data: { labels: sorted.map(x => x[0]), datasets: [{ label: '金额', data: sorted.map(x => x[1]), backgroundColor: t.primary }] },
        options: {
            maintainAspectRatio: false, indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.muted } },
                y: { grid: { display: false }, ticks: { color: t.text } }
            }, animation: { duration: 0 },
            onClick(e, els) {
                const meta = chartInstances.tags && chartInstances.tags.$meta;
                if (!meta || !els.length) return;
                const tag = meta.sorted[els[0].index][0];
                const txs = meta.data.flatMap(t => expandTxByTag(t, tag));
                showChartDrawer(`标签统计 · #${tag}`, txs);
            }
        }
    });
    chart.$meta = { sorted, data };
}

function renderTrendChart(data) {
    const ctx = $('monthlyTrendChart');
    if (!ctx) return;
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    const months = {};
    data.forEach(t => {
        if (t.isTransfer) return;
        const m = t.date.substring(0, 7);
        if (!months[m]) months[m] = { inc: 0, exp: 0 };
        const acc = accMap.get(String(t.accountId));
        if (!acc) return;
        let amt = convertAmt(t.amount, acc.currency);
        if (amt > 0) months[m].inc += amt; else months[m].exp += Math.abs(amt);
    });
    const labels = Object.keys(months).sort();
    const t = getChartTheme();
    const canvas = $('monthlyTrendChart');
    const targetW = Math.max(labels.length * 60, 400);
    if (!chartInstances.trend) canvas.width = targetW;
    else if (canvas.width !== targetW) { canvas.width = targetW; chartInstances.trend.resize(); }
    const chart = upsertChart('trend', ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: '收入', data: labels.map(m => months[m].inc), backgroundColor: t.income, type: 'bar' },
                { label: '支出', data: labels.map(m => months[m].exp), backgroundColor: t.expense, type: 'bar' },
                { label: '结余', data: labels.map(m => months[m].inc - months[m].exp), borderColor: t.primary, type: 'line', fill: false, tension: 0.4 }
            ]
        },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: true, labels: { color: t.text } } },
            scales: {
                x: { grid: { color: t.grid }, ticks: { color: t.muted } },
                y: { beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.muted } }
            },
            animation: { duration: 0 },
            onClick(e, els) {
                const meta = chartInstances.trend && chartInstances.trend.$meta;
                if (!meta || !els.length) return;
                const el = els[0];
                const month = meta.labels[el.index];
                const dsLabel = chartInstances.trend.data.datasets[el.datasetIndex].label;
                if (dsLabel === '结余') return;
                const isIncome = dsLabel === '收入';
                const txs = meta.data.filter(t => {
                    if (t.isTransfer) return false;
                    if (!t.date.startsWith(month)) return false;
                    return isIncome ? t.amount > 0 : t.amount < 0;
                });
                showChartDrawer(`月度收支趋势 · ${month} · ${dsLabel}`, txs);
            }
        }
    });
    chart.$meta = { labels, data };
}

/**
 * 净资产曲线：从“每个日期 × 每个账户 × 全部交易”改为一次线性扫描。
 * 原复杂度 O(日期数 × 账户数 × 交易数)，三年数据下可达数千万次比较。
 */
function buildNetWorthSeries() {
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    const deltaByDate = new Map();
    for (let i = 0; i < transactions.length; i++) {
        const t = transactions[i];
        const acc = accMap.get(String(t.accountId));
        if (!acc) continue;
        const v = toRmb(parseFloat(t.amount) || 0, acc.currency);
        deltaByDate.set(t.date, (deltaByDate.get(t.date) || 0) + v);
    }
    let running = 0;
    for (let i = 0; i < accounts.length; i++) {
        running += toRmb(parseFloat(accounts[i].initialBalance) || 0, accounts[i].currency);
    }
    const dates = [...deltaByDate.keys()].sort();
    const raw = new Array(dates.length);
    for (let i = 0; i < dates.length; i++) {
        running += deltaByDate.get(dates[i]) || 0;
        raw[i] = { date: dates[i], value: running };
    }
    return raw;
}

function getNetWorthSeries() {
    const key = [
        _statsDataVersion,
        currentAssetAggregation,
        JSON.stringify(exchangeRates),
        accounts.map(a => a.id + ':' + (a.initialBalance ?? 0) + ':' + (a.currency || '')).join('|'),
        transactions.length,
        currentUserName
    ].join('~');
    if (_netWorthCache && _netWorthCache.key === key) return _netWorthCache;

    const raw = buildNetWorthSeries();
    let labels, data;
    if (currentAssetAggregation === 'day') {
        labels = raw.map(x => x.date);
        data = raw.map(x => x.value);
    } else if (currentAssetAggregation === 'week') {
        const map = {};
        raw.forEach(x => {
            const d = new Date(x.date);
            const ws = new Date(d);
            ws.setDate(d.getDate() - d.getDay());
            map[ws.toISOString().split('T')[0]] = x.value;
        });
        labels = Object.keys(map).sort();
        data = labels.map(k => map[k]);
    } else {
        const map = {};
        raw.forEach(x => { map[x.date.substring(0, 7)] = x.value; });
        labels = Object.keys(map).sort();
        data = labels.map(k => map[k]);
    }
    _netWorthCache = { key, labels, data, raw };
    return _netWorthCache;
}

function renderAssetHistoryChart() {
    const ctx = $('assetHistoryChart');
    if (!ctx) return;
    // 图表默认折叠：不可见时不计算，点“显示图表”时再算
    const wrapper = $('history-chart-wrapper');
    if (wrapper && wrapper.classList.contains('d-none')) return;

    const series = getNetWorthSeries();
    const t = getChartTheme();
    const chart = upsertChart('assetHistory', ctx, {
        type: 'line',
        data: { labels: series.labels, datasets: [{ label: '净资产', data: series.data, borderColor: t.primary, fill: true, backgroundColor: chartAlpha(t.primary, 0.12), tension: 0.4 }] },
        options: {
            maintainAspectRatio: false,
            elements: { point: { radius: 0 } },
            plugins: { legend: { display: true, labels: { color: t.text } } },
            scales: {
                x: { grid: { color: t.grid }, ticks: { color: t.muted } },
                y: { grid: { color: t.grid }, ticks: { color: t.muted } }
            },
            animation: { duration: 0 }
        }
    });
    chart.resize();
}

function renderCategoryTrendChart(data) {
    const cat = $('category-trend-select').value;
    const ctx = $('categoryTrendChart');
    if (!ctx) return;
    if (!cat) return;
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    const months = {};
    (data || []).filter(t => t.amount < 0 && !t.isTransfer).forEach(t => {
        const acc = accMap.get(String(t.accountId));
        if (!acc) return;
        const m = t.date.substring(0, 7);
        if (t.items && t.items.length > 1) {
            t.items.filter(it => it.category === cat).forEach(it => {
                months[m] = (months[m] || 0) + convertAmt(Math.abs(it.amount), acc.currency);
            });
        } else if (t.category === cat) {
            months[m] = (months[m] || 0) + convertAmt(Math.abs(t.amount), acc.currency);
        }
    });
    const labels = Object.keys(months).sort();
    const t = getChartTheme();
    const canvas = $('categoryTrendChart');
    const targetW = Math.max(labels.length * 60, 400);
    if (!chartInstances.cattrend) canvas.width = targetW;
    else if (canvas.width !== targetW) { canvas.width = targetW; chartInstances.cattrend.resize(); }
    const chart = upsertChart('cattrend', ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: cat, data: labels.map(m => months[m]), borderColor: t.transfer, backgroundColor: chartAlpha(t.transfer, 0.45), fill: true, tension: 0.4 }] },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: true, labels: { color: t.text } } },
            scales: {
                x: { grid: { color: t.grid }, ticks: { color: t.muted } },
                y: { beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.muted } }
            },
            animation: { duration: 0 },
            onClick(e, els) {
                const meta = chartInstances.cattrend && chartInstances.cattrend.$meta;
                if (!meta || !els.length) return;
                const month = meta.labels[els[0].index];
                const txs = (meta.data || [])
                    .filter(t => t.amount < 0 && !t.isTransfer && t.date.startsWith(month))
                    .flatMap(t => expandTxByCategory(t, meta.cat));
                showChartDrawer(`单类别趋势 · ${meta.cat} · ${month}`, txs);
            }
        }
    });
    chart.$meta = { labels, data, cat };
}

function renderTotalExpenseTrendChart(data) {
    const ctx = $('totalExpenseTrendChart');
    if (!ctx) return;
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    const months = {};
    (data || []).filter(t => t.amount < 0 && !t.isTransfer).forEach(t => {
        const acc = accMap.get(String(t.accountId));
        if (!acc) return;
        const m = t.date.substring(0, 7);
        let amt = convertAmt(Math.abs(t.amount), acc.currency);
        months[m] = (months[m] || 0) + amt;
    });
    const labels = Object.keys(months).sort();
    const t = getChartTheme();
    const canvas = $('totalExpenseTrendChart');
    const targetW = Math.max(labels.length * 60, 400);
    if (!chartInstances.totalExpense) canvas.width = targetW;
    else if (canvas.width !== targetW) { canvas.width = targetW; chartInstances.totalExpense.resize(); }
    const chart = upsertChart('totalExpense', ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: '总支出', data: labels.map(m => months[m]), borderColor: t.expense, backgroundColor: chartAlpha(t.expense, 0.42), fill: true, tension: 0.4 }] },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: true, labels: { color: t.text } } },
            scales: {
                x: { grid: { color: t.grid }, ticks: { color: t.muted } },
                y: { beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.muted } }
            }, animation: { duration: 0 },
            onClick(e, els) {
                const meta = chartInstances.totalExpense && chartInstances.totalExpense.$meta;
                if (!meta || !els.length) return;
                const month = meta.labels[els[0].index];
                const txs = (meta.data || []).filter(t => t.amount < 0 && !t.isTransfer && t.date.startsWith(month));
                showChartDrawer(`总支出趋势 · ${month}`, txs);
            }
        }
    });
    chart.$meta = { labels, data };
}

function updateSelectOptions() {
    const fill = (id, arr) => {
        const el = $(id);
        if (!el) return;
        el.innerHTML = '';
        arr.forEach(x => el.add(new Option(x, x)));
    };
    const currentType = $('edit-trans-type')?.value || 'expense';
    fill('edit-trans-category', currentType === 'expense' ? categories.expense : categories.income);
    const plannedType = $('planned-type')?.value || 'expense';
    fill('planned-category', plannedType === 'expense' ? categories.expense : categories.income);

    const accFill = (id, includeOthers, showBal) => {
        const el = $(id);
        if (!el) return;
        el.innerHTML = '';
        const myAccs = sortedUserAccounts(userAccounts.filter(a => !a.hidden));
        const accsToShow = includeOthers ? [...myAccs, ...accounts.filter(a => a.ownerName !== currentUserName && !a.hidden)] : myAccs;
        accsToShow.forEach(a => {
            const name = `${getAccountDisplayName(a)} (${CURRENCY_SYMBOLS[a.currency] || a.currency})`;
            const opt = new Option(name, a.id);
            opt.setAttribute('data-name', name);
            if (showBal) opt.setAttribute('data-bal', calculateBalance(a.id).toFixed(2));
            el.add(opt);
        });
        if (showBal) accSelectSync(id);
    };
    accFill('edit-trans-account', false, true); accFill('planned-account', false, false);

    updateUserFilterBtn();
}
