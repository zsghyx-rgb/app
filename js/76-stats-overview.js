// @file js/76-stats-overview.js
// 统计页（5.1.2）：概览卡（支出大字 + 对比上期 + 日均 + 预算进度）、分类占比（环形图+列表）、近 6 个月趋势（不受日期筛选影响）、每日支出、
// “更多图表”折叠区，以及设置 → 统计图表 里逐个图表的显示开关（只存本机）。

/* ═══════════ 一、图表开关（本机） ═══════════ */
const STATS_CHART_PREFS_KEY = 'APP_stats_charts';
const STATS_CHART_DEFS = [
    { id: 'category',   group: 'main', def: true,  name: '分类占比',        desc: '环形图 + 占比列表，点一下看明细', inst: 'categoryShare' },
    { id: 'trend',      group: 'main', def: true,  name: '月度收支趋势',    desc: '近 6 个月（年视图为全年 12 个月），不受日期筛选影响；点柱子切换到该月', inst: 'trend6' },
    { id: 'daily',      group: 'main', def: true,  name: '每日支出',        desc: '这段时间每天花了多少，点某一天看明细', inst: 'daily' },
    { id: 'ranking',    group: 'more', def: false, name: '支出排行（柱状）', desc: '按分类从高到低的柱状图（旧版样式）', inst: 'expense' },
    { id: 'tags',       group: 'more', def: true,  name: '标签统计',        desc: '按标签汇总支出', inst: 'tags' },
    { id: 'catTrend',   group: 'more', def: true,  name: '单类别趋势',      desc: '选一个分类，看它随时间的变化', inst: 'cattrend' },
    { id: 'totalTrend', group: 'more', def: true,  name: '总支出趋势',      desc: '所选期间内的总支出变化', inst: 'totalExpense' },
    { id: 'assets',     group: 'more', def: true,  name: '历史资产趋势',    desc: '净资产随时间的变化（计算量最大，点开才绘制）', inst: 'assetHistory' }
];
let _statsPrefs = null;
let _statsMoreOpen = null;          // 本次打开页面时“更多图表”是否展开（默认取设置）
let _catShareExpanded = false;      // 分类占比列表是否展开全部
let _catShareMeta = null;

function getStatsChartPrefs() {
    if (_statsPrefs) return _statsPrefs;
    const prefs = { charts: {}, moreOpenDefault: false };
    STATS_CHART_DEFS.forEach(d => prefs.charts[d.id] = d.def);
    try {
        const saved = JSON.parse(localStorage.getItem(STATS_CHART_PREFS_KEY) || 'null');
        if (saved && typeof saved === 'object') {
            if (saved.charts) STATS_CHART_DEFS.forEach(d => { if (typeof saved.charts[d.id] === 'boolean') prefs.charts[d.id] = saved.charts[d.id]; });
            if (typeof saved.moreOpenDefault === 'boolean') prefs.moreOpenDefault = saved.moreOpenDefault;
        }
    } catch (_) {}
    _statsPrefs = prefs;
    if (_statsMoreOpen === null) _statsMoreOpen = prefs.moreOpenDefault;
    return prefs;
}
function _saveStatsChartPrefs() {
    try { localStorage.setItem(STATS_CHART_PREFS_KEY, JSON.stringify(_statsPrefs)); } catch (_) {}
}
function _statsPrefsSig() {
    const p = getStatsChartPrefs();
    return STATS_CHART_DEFS.map(d => p.charts[d.id] ? 1 : 0).join('') + (_statsMoreOpen ? 'o' : 'c') + (_catShareExpanded ? 'e' : 'f');
}

// 按开关显示/隐藏统计页里的各图表卡片，更新“更多图表”折叠区
function applyStatsChartPrefs() {
    const p = getStatsChartPrefs();
    STATS_CHART_DEFS.forEach(d => {
        const el = $('chart-card-' + d.id);
        if (el) el.classList.toggle('d-none', !p.charts[d.id]);
        if (!p.charts[d.id] && chartInstances[d.inst]) {      // 关掉的图表释放掉
            try { chartInstances[d.inst].destroy(); } catch (_) {}
            delete chartInstances[d.inst];
        }
    });
    const moreOn = STATS_CHART_DEFS.filter(d => d.group === 'more' && p.charts[d.id]).length;
    const wrap = $('stats-more-wrap');
    if (wrap) wrap.classList.toggle('d-none', moreOn === 0);
    const cnt = $('stats-more-count');
    if (cnt) cnt.textContent = moreOn ? `${moreOn} 张` : '';
    const body = $('stats-more-body'), chev = $('stats-more-chevron');
    if (body) body.style.display = _statsMoreOpen ? '' : 'none';
    if (chev) chev.className = _statsMoreOpen ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
}

function toggleStatsMore() {
    getStatsChartPrefs();
    _statsMoreOpen = !_statsMoreOpen;
    applyStatsChartPrefs();
    _statsRenderedKey = '';       // 刚展开的图表还没画过：重新渲染
    renderStats();
}

function setStatsChartPref(id, on) {
    getStatsChartPrefs().charts[id] = !!on;
    _saveStatsChartPrefs();
    applyStatsChartPrefs();
    _statsRenderedKey = '';
}

function setStatsMoreOpenDefault(on) {
    getStatsChartPrefs().moreOpenDefault = !!on;
    _statsMoreOpen = !!on;
    _saveStatsChartPrefs();
    applyStatsChartPrefs();
    _statsRenderedKey = '';
}

function resetStatsChartPrefs() {
    try { localStorage.removeItem(STATS_CHART_PREFS_KEY); } catch (_) {}
    _statsPrefs = null; _statsMoreOpen = null;
    getStatsChartPrefs();
    applyStatsChartPrefs();
    _statsRenderedKey = '';
    renderStatsChartSettings();
}

// 设置 → 统计图表
function renderStatsChartSettings() {
    const p = getStatsChartPrefs();
    const row = d => `
        <div class="chart-switch-row">
            <div class="chart-switch-text">
                <div class="chart-switch-name">${d.name}</div>
                <div class="chart-switch-desc">${d.desc}</div>
            </div>
            <div class="form-check form-switch"><input class="form-check-input" type="checkbox" ${p.charts[d.id] ? 'checked' : ''} aria-label="${d.name}" onchange="setStatsChartPref('${d.id}', this.checked)"></div>
        </div>`;
    const main = $('chart-switch-main'), more = $('chart-switch-more'), open = $('chart-switch-moreopen');
    if (main) main.innerHTML = STATS_CHART_DEFS.filter(d => d.group === 'main').map(row).join('');
    if (more) more.innerHTML = STATS_CHART_DEFS.filter(d => d.group === 'more').map(row).join('');
    if (open) open.checked = p.moreOpenDefault;
}

/* ═══════════ 二、期间信息与汇总工具 ═══════════ */
function _dayDiff(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function _addDays(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return formatLocal(d); }

// 统计页当前选中的期间：标签、已过天数、用来对比的上一期间
function getStatsPeriodInfo() {
    const f = currentStatsFilter, now = new Date(), todayStr = formatLocal(now);
    const info = { mode: statsNavMode, start: f.startDate, end: f.endDate, label: '所选期间支出', prevStart: '', prevEnd: '', cmpLabel: '', days: 1, monthMode: false };
    if (statsNavMode === 'month') {
        const y = statsNavYear, m = statsNavMonth, isCur = y === now.getFullYear() && m === now.getMonth();
        const pm = m === 0 ? 11 : m - 1, py = m === 0 ? y - 1 : y, pDays = new Date(py, pm + 1, 0).getDate();
        info.monthMode = true;
        info.label = isCur ? '本月支出' : `${y}年${m + 1}月支出`;
        info.prevStart = formatLocal(new Date(py, pm, 1));
        if (isCur) {      // 进行中的月份：和上月“同一天数”比，否则永远显示少花了
            info.days = now.getDate();
            info.prevEnd = formatLocal(new Date(py, pm, Math.min(now.getDate(), pDays)));
            info.cmpLabel = '较上月同期';
        } else {
            info.days = new Date(y, m + 1, 0).getDate();
            info.prevEnd = formatLocal(new Date(py, pm, pDays));
            info.cmpLabel = '比上月';
        }
    } else if (statsNavMode === 'year') {
        const y = statsNavYear, isCur = y === now.getFullYear();
        info.label = isCur ? '本年支出' : `${y}年支出`;
        info.prevStart = `${y - 1}-01-01`;
        if (isCur) {
            info.days = _dayDiff(`${y}-01-01`, todayStr) + 1;
            info.prevEnd = formatLocal(new Date(y - 1, now.getMonth(), now.getDate()));
            info.cmpLabel = '较去年同期';
        } else {
            info.days = _dayDiff(`${y}-01-01`, `${y}-12-31`) + 1;
            info.prevEnd = `${y - 1}-12-31`;
            info.cmpLabel = '比去年';
        }
    } else if (f.startDate && f.endDate) {
        const effEnd = f.endDate > todayStr ? todayStr : f.endDate, len = _dayDiff(f.startDate, f.endDate) + 1;
        info.days = Math.max(1, _dayDiff(f.startDate, effEnd) + 1);
        info.prevEnd = _addDays(f.startDate, -1);
        info.prevStart = _addDays(f.startDate, -len);
        info.cmpLabel = '较上一周期';
    } else {
        const first = transactions.reduce((m, t) => (!t._isBaseline && t.date && (!m || t.date < m)) ? t.date : m, '');
        const from = f.startDate || first || todayStr, to = (f.endDate && f.endDate < todayStr) ? f.endDate : todayStr;
        info.days = Math.max(1, _dayDiff(from, to) + 1);
        info.label = f.startDate || f.endDate ? '所选期间支出' : '全部期间支出';
    }
    return info;
}

// 一段日期内的支出合计（转换成统计页当前币种，遵守统计页的用户筛选；不含转账）
function _expenseBetween(s, e) {
    const user = currentStatsFilter.user || 'all';
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    let sum = 0;
    transactions.forEach(t => {
        if (t._isBaseline || t.isTransfer || t.amount >= 0) return;
        if (t.date < s || t.date > e) return;
        if (user !== 'all' && t.ownerName !== user) return;
        const acc = accMap.get(String(t.accountId));
        if (acc) sum += Math.abs(convertAmt(t.amount, acc.currency));
    });
    return sum;
}

/* ═══════════ 三、概览卡 ═══════════ */
function renderStatsOverview(inc, exp) {
    const cur = currentStatsFilter.currency, sym = CURRENCY_SYMBOLS[cur] || cur || '';
    const hid = summaryHidden ? 'amount-hidden' : '';
    const spent = Math.abs(exp), info = getStatsPeriodInfo();
    $('so-label').textContent = info.label;
    $('so-sub').textContent = (currentStatsFilter.user && currentStatsFilter.user !== 'all') ? currentStatsFilter.user : '';
    const set = (id, cls, txt) => { const el = $(id); el.className = `${cls} ${hid}`; el.innerText = txt; };
    set('stat-expense-display', 'so-amount stat-number is-expense', sym + formatAmount(spent, cur));
    set('stat-income-display', 'stat-number is-income', sym + formatAmount(inc, cur));
    set('stat-net-display', 'stat-number is-net', sym + formatAmount(inc + exp, cur));

    // 对比上一期间 + 日均
    const chips = [];
    if (info.prevStart && info.prevEnd) {
        const prev = _expenseBetween(info.prevStart, info.prevEnd);
        if (prev > 0.004) {
            const pct = (spent - prev) / prev * 100;
            const up = pct > 0.05, down = pct < -0.05;
            chips.push(`<span class="so-chip ${up ? 'is-up' : down ? 'is-down' : ''}"><i class="bi ${up ? 'bi-arrow-up-right' : down ? 'bi-arrow-down-right' : 'bi-dash'}"></i> ${Math.abs(pct).toFixed(1)}% <small>${info.cmpLabel}</small></span>`);
        } else if (spent > 0.004) {
            chips.push(`<span class="so-chip">上期无支出 <small>${info.cmpLabel}</small></span>`);
        }
    }
    chips.push(`<span class="so-chip">日均 <span class="${hid}">${sym}${formatAmount(spent / Math.max(1, info.days), cur)}</span></span>`);
    $('so-chips').innerHTML = chips.join('');

    // 预算进度：只在“按月”视图且设置了总预算时显示
    const box = $('so-budget');
    let html = '';
    if (info.monthMode && typeof budgets !== 'undefined') {
        const tb = budgets.find(b => b.category === '__total__');
        if (tb) {
            const limit = convertAmt(tb.amount, tb.currency || cur);
            if (limit > 0) {
                const used = computeMonthlySpendByCategory(statsNavYear, statsNavMonth, currentStatsFilter.user || 'all').total;
                const raw = used / limit * 100, w = Math.min(100, Math.round(raw)), left = limit - used;
                html = `<div class="so-track"><div class="so-fill ${raw >= 100 ? 'is-over' : raw >= 80 ? 'is-warn' : ''}" style="width:${w}%"></div></div>
                        <div class="so-budget-text"><span>总预算已用 ${Math.round(raw)}%</span><span class="${hid}">${left >= 0 ? '剩余 ' : '已超支 '}${sym}${formatAmount(Math.abs(left), cur)}</span></div>`;
            }
        }
    }
    box.style.display = html ? '' : 'none';
    box.innerHTML = html;
}

/* ═══════════ 四、分类占比（环形图 + 列表） ═══════════ */
// 分类颜色：getCatIcon 返回的是主题变量（如 var(--cat-pink)，随主题/深浅色变化），Canvas 画图需要解析成实际颜色
function _catColor(name) {
    let c = String(getCatIcon(name).color || '').trim();
    const m = /^var\((--[\w-]+)\)$/.exec(c);
    if (m) c = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
    return c || getChartTheme().primary;
}

function renderCategoryShare(data) {
    const canvas = $('categoryShareChart');
    if (!canvas) return;
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    const cats = {};
    data.filter(t => t.amount < 0 && !t.isTransfer).forEach(t => {
        const acc = accMap.get(String(t.accountId));
        if (!acc) return;
        if (t.items && t.items.length > 1) t.items.forEach(it => { cats[it.category] = (cats[it.category] || 0) + convertAmt(Math.abs(it.amount), acc.currency); });
        else cats[t.category] = (cats[t.category] || 0) + convertAmt(Math.abs(t.amount), acc.currency);
    });
    const sorted = Object.entries(cats).filter(x => x[1] > 0.004).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, x) => s + x[1], 0);
    const cur = currentStatsFilter.currency, sym = CURRENCY_SYMBOLS[cur] || cur || '';
    const th = getChartTheme();
    const TOP = 8, top = sorted.slice(0, TOP), rest = sorted.slice(TOP);
    const restSum = rest.reduce((s, x) => s + x[1], 0);
    const slices = rest.length ? top.concat([['其他', restSum]]) : top;
    _catShareMeta = { data, slices, rest: rest.map(x => x[0]) };
    $('cat-share-sub').textContent = sorted.length ? `${sorted.length} 个分类` : '';

    const hidDetail = amountsHidden ? 'amount-hidden' : '', hidSum = summaryHidden ? 'amount-hidden' : '';
    const donutBox = canvas.parentElement;
    donutBox.style.display = sorted.length ? '' : 'none';      // 没有支出时不显示空圆环，只留一句提示
    $('cat-donut-center').innerHTML = sorted.length
        ? `<span class="cdc-label">总支出</span><b class="${hidSum}">${sym}${formatAmount(total, cur)}</b>` : '';

    if (!sorted.length) {
        if (chartInstances.categoryShare) { try { chartInstances.categoryShare.destroy(); } catch (_) {} delete chartInstances.categoryShare; }
        $('cat-share-list').innerHTML = '<div class="text-muted small text-center py-3">这段时间没有支出记录</div>';
        return;
    }
    const colors = slices.map(([n]) => n === '其他' ? th.muted : _catColor(n));
    const chart = upsertChart('categoryShare', canvas, {
        type: 'doughnut',
        data: { labels: slices.map(x => x[0]), datasets: [{ data: slices.map(x => x[1]), backgroundColor: colors, borderColor: th.surface, borderWidth: 2 }] },
        options: {
            maintainAspectRatio: false, cutout: '68%', animation: { duration: 0 },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}  ${sym}${formatAmount(c.parsed, cur)}  ${(c.parsed / total * 100).toFixed(1)}%` } } },
            onClick(e, els) { if (els.length) openCategoryShareDetail(chart.data.labels[els[0].index]); }
        }
    });
    chart.data.labels = slices.map(x => x[0]);
    chart.data.datasets[0].data = slices.map(x => x[1]);
    chart.data.datasets[0].backgroundColor = colors;
    chart.data.datasets[0].borderColor = th.surface;
    chart.update('none');

    // 列表：前 8 个分类 + “其他”（点开展开剩余）
    const rowHtml = ([n, v], color) => {
        const pct = v / total * 100;
        return `<div class="cs-row" onclick="openCategoryShareDetail('${n.replace(/'/g, "\\'")}')">
            <span class="cs-dot" style="background:${color}"></span>
            <span class="cs-name">${_escHtml(n)}</span>
            <span class="cs-pct">${pct.toFixed(1)}%</span>
            <span class="cs-amt ${hidDetail}">${sym}${formatAmount(v, cur)}</span>
            <span class="cs-bar"><i style="width:${Math.max(2, pct).toFixed(1)}%;background:${color}"></i></span>
        </div>`;
    };
    let html = top.map(x => rowHtml(x, _catColor(x[0]))).join('');
    if (rest.length) {
        if (_catShareExpanded) html += rest.map(x => rowHtml(x, _catColor(x[0]))).join('');
        html += `<button type="button" class="cs-more" onclick="toggleCatShareAll()">${_catShareExpanded ? '收起' : `其他 ${rest.length} 个分类 · ${sym}${formatAmount(restSum, cur)}（${(restSum / total * 100).toFixed(1)}%），点开查看`}</button>`;
    }
    $('cat-share-list').innerHTML = html;
}

function toggleCatShareAll() { _catShareExpanded = !_catShareExpanded; _statsRenderedKey = ''; renderStats(); }

function openCategoryShareDetail(name) {
    if (!_catShareMeta) return;
    const cats = name === '其他' ? _catShareMeta.rest : [name];
    const txs = _catShareMeta.data.filter(t => t.amount < 0 && !t.isTransfer).flatMap(t => cats.flatMap(c => expandTxByCategory(t, c)));
    showChartDrawer(`支出占比 · ${name}`, txs);
}

/* ═══════════ 五、月度收支趋势（不受日期筛选影响） ═══════════ */
function statsGoToMonth(y, m) {
    statsNavMode = 'month'; statsNavYear = y; statsNavMonth = m;
    const s = formatLocal(new Date(y, m, 1)), e = formatLocal(new Date(y, m + 1, 0));
    $('stats-start-date').value = s; $('stats-end-date').value = e;
    currentStatsFilter.startDate = s; currentStatsFilter.endDate = e;
    const panel = $('stats-custom-date-panel'); if (panel) panel.style.setProperty('display', 'none', 'important');
    const tg = $('stats-custom-toggle'); if (tg) tg.classList.remove('active');
    $$('#quick-stats-filter-group-1 button').forEach(b => b.classList.toggle('active', b.dataset.range === 'month'));
    updateStatsNavUI();
    renderStats();
}

function _compactMoney(v) {
    const a = Math.abs(v);
    if (a >= 10000) return (v / 10000).toFixed(a >= 100000 ? 0 : 1).replace(/\.0$/, '') + '万';
    if (a >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(v));
}

function renderTrend6Chart() {
    const canvas = $('trend6Chart');
    if (!canvas) return;
    const now = new Date();
    let months = [], title;       // months: [{y, m}]
    if (statsNavMode === 'year') {
        const y = statsNavYear, last = y === now.getFullYear() ? now.getMonth() : 11;
        for (let m = 0; m <= last; m++) months.push({ y, m });
        title = `月度收支趋势 · ${y}年`;
    } else {
        let ey = now.getFullYear(), em = now.getMonth();
        if (statsNavMode === 'month') { ey = statsNavYear; em = statsNavMonth; }
        else if (currentStatsFilter.endDate && currentStatsFilter.endDate < formatLocal(now)) { ey = +currentStatsFilter.endDate.slice(0, 4); em = +currentStatsFilter.endDate.slice(5, 7) - 1; }
        for (let i = 5; i >= 0; i--) { const d = new Date(ey, em - i, 1); months.push({ y: d.getFullYear(), m: d.getMonth() }); }
        title = '月度收支趋势 · 近 6 个月';
    }
    $('trend6-title').textContent = title;
    const key = x => `${x.y}-${String(x.m + 1).padStart(2, '0')}`;
    const agg = {}; months.forEach(x => agg[key(x)] = { inc: 0, exp: 0 });
    const user = currentStatsFilter.user || 'all';
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    transactions.forEach(t => {
        if (t._isBaseline || t.isTransfer) return;
        const a = agg[(t.date || '').slice(0, 7)];
        if (!a) return;
        if (user !== 'all' && t.ownerName !== user) return;
        const acc = accMap.get(String(t.accountId));
        if (!acc) return;
        const v = convertAmt(t.amount, acc.currency);
        if (v > 0) a.inc += v; else a.exp += Math.abs(v);
    });
    const th = getChartTheme();
    const cur = currentStatsFilter.currency, sym = CURRENCY_SYMBOLS[cur] || cur || '';
    const sel = statsNavMode === 'month' ? key({ y: statsNavYear, m: statsNavMonth }) : '';
    const shade = (color, k) => (!sel || key(months.find(x => key(x) === k)) === sel) ? color : chartAlpha(color, 0.45);
    const labels = months.map(x => (statsNavMode !== 'year' && x.m === 0) ? `${x.y}年1月` : `${x.m + 1}月`);   // 1 月带上年份，方便跨年时分辨
    const keys = months.map(key);
    const chart = upsertChart('trend6', canvas, {
        type: 'bar',
        data: { labels, datasets: [
            { label: '收入', data: keys.map(k => agg[k].inc), backgroundColor: keys.map(k => shade(th.income, k)), borderRadius: 4 },
            { label: '支出', data: keys.map(k => agg[k].exp), backgroundColor: keys.map(k => shade(th.expense, k)), borderRadius: 4 },
            // 5.1.8：结余（收入 − 支出）趋势线，和柱状图共用一条纵轴，负值会落在 0 以下
            { type: 'line', label: '结余', data: keys.map(k => agg[k].inc - agg[k].exp),
              borderColor: th.primary, backgroundColor: chartAlpha(th.primary, 0.14),
              borderWidth: 2.5, pointRadius: 2.5, pointHoverRadius: 5, pointBackgroundColor: th.primary,
              tension: 0.32, fill: false, borderDash: [] }
        ] },
        options: {
            maintainAspectRatio: false, animation: { duration: 0 },
            plugins: {
                legend: { display: true, position: 'bottom', labels: { color: th.text, boxWidth: 10, boxHeight: 10 } },
                tooltip: { callbacks: { label: c => ` ${c.dataset.label} ${sym}${formatAmount(c.parsed.y, cur)}${c.dataset.label === '结余' && c.parsed.y < 0 ? '（超支）' : ''}` } }
            },
            scales: { x: { grid: { display: false }, ticks: { color: th.muted } }, y: { beginAtZero: true, grid: { color: th.grid }, ticks: { color: th.muted, callback: v => sym + _compactMoney(v) } } },
            onClick(e, els) { if (els.length) { const x = months[els[0].index]; if (x) statsGoToMonth(x.y, x.m); } }
        }
    });
    chart.data.labels = labels;
    chart.data.datasets[0].data = keys.map(k => agg[k].inc); chart.data.datasets[0].backgroundColor = keys.map(k => shade(th.income, k));
    chart.data.datasets[1].data = keys.map(k => agg[k].exp); chart.data.datasets[1].backgroundColor = keys.map(k => shade(th.expense, k));
    if (chart.data.datasets[2]) {
        chart.data.datasets[2].data = keys.map(k => agg[k].inc - agg[k].exp);
        chart.data.datasets[2].borderColor = th.primary;
        chart.data.datasets[2].backgroundColor = chartAlpha(th.primary, 0.14);
    }
    chart.update('none');
}

/* ═══════════ 六、每日支出 ═══════════ */
function renderDailyChart() {
    const canvas = $('dailyChart');
    if (!canvas) return;
    const info = getStatsPeriodInfo(), todayStr = formatLocal(new Date());
    let from, to, title = '每日支出';
    if (info.start && info.end && _dayDiff(info.start, info.end) + 1 <= 62) {
        from = info.start; to = info.end > todayStr ? todayStr : info.end;
    } else {                              // 范围太大（全年/全部）：改看最近 30 天
        to = (info.end && info.end < todayStr) ? info.end : todayStr;
        from = _addDays(to, -29);
        title = '每日支出 · 近 30 天';
    }
    $('daily-title').textContent = title;
    const days = []; for (let d = from; d <= to; d = _addDays(d, 1)) days.push(d);
    const sums = {}; days.forEach(d => sums[d] = 0);
    const user = currentStatsFilter.user || 'all';
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    transactions.forEach(t => {
        if (t._isBaseline || t.isTransfer || t.amount >= 0 || !(t.date in sums)) return;
        if (user !== 'all' && t.ownerName !== user) return;
        const acc = accMap.get(String(t.accountId));
        if (acc) sums[t.date] += Math.abs(convertAmt(t.amount, acc.currency));
    });
    const vals = days.map(d => sums[d]), total = vals.reduce((s, v) => s + v, 0), avg = days.length ? total / days.length : 0;
    const max = Math.max(0, ...vals), maxDay = max > 0 ? days[vals.indexOf(max)] : '';
    const cur = currentStatsFilter.currency, sym = CURRENCY_SYMBOLS[cur] || cur || '';
    $('daily-sub').textContent = total > 0 ? `日均 ${sym}${formatAmount(avg, cur)} · 最高 ${sym}${formatAmount(max, cur)}（${maxDay.slice(5).replace('-', '/')}）` : '';
    const th = getChartTheme();
    const multiMonth = days.length > 0 && days[0].slice(0, 7) !== days[days.length - 1].slice(0, 7);
    const labels = days.map(d => multiMonth ? d.slice(5).replace('-', '/') : String(+d.slice(8)));
    const colors = days.map(d => d === todayStr ? th.primary : th.expense);
    const chart = upsertChart('daily', canvas, {
        type: 'bar',
        data: { labels, datasets: [
            { type: 'bar', label: '支出', data: vals, backgroundColor: colors, borderRadius: 3, order: 2 },
            { type: 'line', label: '日均', data: days.map(() => avg), borderColor: chartAlpha(th.muted, 0.9), borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0, fill: false, order: 1 }
        ] },
        options: {
            maintainAspectRatio: false, animation: { duration: 0 },
            plugins: { legend: { display: false }, tooltip: { callbacks: { title: c => days[c[0].dataIndex], label: c => c.datasetIndex === 0 ? ` 支出 ${sym}${formatAmount(c.parsed.y, cur)}` : ` 日均 ${sym}${formatAmount(c.parsed.y, cur)}` } } },
            scales: { x: { grid: { display: false }, ticks: { color: th.muted, autoSkip: true, maxTicksLimit: 8, maxRotation: 0 } }, y: { beginAtZero: true, grid: { color: th.grid }, ticks: { color: th.muted, maxTicksLimit: 4, callback: v => sym + _compactMoney(v) } } },
            onClick(e, els) {
                if (!els.length || els[0].datasetIndex !== 0) return;
                const day = days[els[0].index];
                const txs = transactions.filter(t => !t._isBaseline && !t.isTransfer && t.amount < 0 && t.date === day && (user === 'all' || t.ownerName === user));
                showChartDrawer(`每日支出 · ${day}`, txs);
            }
        }
    });
    chart.data.labels = labels;
    chart.data.datasets[0].data = vals; chart.data.datasets[0].backgroundColor = colors;
    chart.data.datasets[1].data = days.map(() => avg);
    chart.update('none');
}
