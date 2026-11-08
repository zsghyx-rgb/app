// @file js/98-insights.js
// 智能提醒抽屉：月度总结、趋势分析、异常消费、本月动态。

// ── 智能洞察 ──────────────────────────────────────────────────
// ══════════════════════════════════════════════════════
// 智能提醒抽屉（新版：月报 + 日报 合并卡片）
// ══════════════════════════════════════════════════════

let _insightCurrentTab = 'monthly';

/* ─── localStorage 控制 ─── */
function _insightMonthKey() { return `insight_month_${currentUserName}_${_yyyyMM(new Date())}`; }
function _insightDayKey()   { return `insight_day_${_ymd(new Date())}`; }
function _yyyyMM(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function _ymd(d)    { return d.toISOString().split('T')[0]; }
function _monthlyShown()  { try { return !!localStorage.getItem(_insightMonthKey()); } catch(_){return false;} }
function _dailyShown()    { try { return !!localStorage.getItem(_insightDayKey());   } catch(_){return false;} }
function _markMonthlyShown() { try { localStorage.setItem(_insightMonthKey(), '1'); } catch(_){} }
function _markDailyShown()   { try { localStorage.setItem(_insightDayKey(), '1');   } catch(_){} }

/* ─── 切换到统计页时自动触发 ─── */
function maybeShowInsight() {
    if (!transactions || transactions.length === 0) return;
    const monthNew = !_monthlyShown();
    const dayNew   = !_dailyShown();
    _updateInsightBadge(monthNew || dayNew);
    if (!monthNew && !dayNew) return;
    _insightCurrentTab = monthNew ? 'monthly' : 'daily';
    // 延迟 400ms，等页面渲染完再弹
    setTimeout(() => openInsightDrawer(false), 400);
}

function _updateInsightBadge(show) {
    const b = $('insight-badge');
    if (b) b.style.display = show ? 'block' : 'none';
}

/* ─── 打开 / 关闭 ─── */
function openInsightDrawer(manual = false) {
    if (!manual) {
        _insightCurrentTab = !_monthlyShown() ? 'monthly' : 'daily';
    }
    _syncInsightTabUI();
    _renderInsightTab(_insightCurrentTab);

    const backdrop = $('insight-drawer-backdrop');
    const drawer   = $('insight-drawer');
    backdrop.style.opacity       = '1';
    backdrop.style.pointerEvents = 'auto';
    drawer.style.transform       = 'translateY(0)';
    document.body.style.overflow = 'hidden';

    if (_insightCurrentTab === 'monthly') _markMonthlyShown();
    else _markDailyShown();
    _updateInsightBadge(!_monthlyShown() || !_dailyShown());
}

function closeInsightDrawer() {
    $('insight-drawer-backdrop').style.opacity       = '0';
    $('insight-drawer-backdrop').style.pointerEvents = 'none';
    $('insight-drawer').style.transform              = 'translateY(100%)';
    document.body.style.overflow = '';
}

function switchInsightTab(tab) {
    _insightCurrentTab = tab;
    _syncInsightTabUI();
    _renderInsightTab(tab);
    if (tab === 'monthly') _markMonthlyShown();
    else _markDailyShown();
    _updateInsightBadge(!_monthlyShown() || !_dailyShown());
}

function _syncInsightTabUI() {
    ['monthly','daily'].forEach(t => {
        const btn = $(`insight-tab-${t}`);
        if (btn) btn.classList.toggle('active', t === _insightCurrentTab);
    });
}

/* ─── 数据工具 ─── */
function _txMonth(tx)  { return tx.date ? tx.date.substring(0,7) : ''; }

function _monthExpenses(yyyyMM) {
    return transactions.filter(tx =>
        tx.type === 'expense' && _txMonth(tx) === yyyyMM && !tx.isTransfer && !tx._isBaseline
    );
}

function _monthIncome(yyyyMM) {
    return transactions.filter(tx =>
        tx.type === 'income' && _txMonth(tx) === yyyyMM && !tx.isTransfer && !tx._isBaseline
    );
}

// 统一换算到 currentStatsFilter.currency
function _cvt(amt, accCurrency) {
    return convertAmt(Math.abs(amt), accCurrency);
}

function _sumByCategory(txList) {
    const map = {};
    txList.forEach(tx => {
        const acc = accounts.find(a => a.id == tx.accountId);
        const cur = acc ? acc.currency : 'RMB';
        const val = _cvt(tx.amount, cur);
        const cat = tx.category || '未分类';
        map[cat] = (map[cat] || 0) + val;
    });
    return map;
}

function _sumCvt(txList) {
    return txList.reduce((s, tx) => {
        const acc = accounts.find(a => a.id == tx.accountId);
        const cur = acc ? acc.currency : 'RMB';
        return s + _cvt(tx.amount, cur);
    }, 0);
}

// 货币符号 + 格式化
function _fmtC(n) {
    const sym = CURRENCY_SYMBOLS[currentStatsFilter.currency] || currentStatsFilter.currency;
    return sym + n.toFixed(2);
}

function _pctStr(cur, prev) {
    if (prev === 0 && cur === 0) return { text: '持平', cls: 'insight-badge-neu' };
    if (prev === 0) return { text: '+∞%', cls: 'insight-badge-up' };
    const pct  = (cur - prev) / prev * 100;
    const sign = pct > 0 ? '+' : '';
    const cls  = pct > 5 ? 'insight-badge-up' : pct < -5 ? 'insight-badge-down' : 'insight-badge-neu';
    return { text: `${sign}${pct.toFixed(1)}%`, cls };
}

function _recentFullMonths(n) {
    const now = new Date();
    const months = [];
    for (let i = 1; i <= n; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(_yyyyMM(d));
    }
    return months;
}

// 近 n 个完整月的支出/收入总额平均值
function _avg3Exp(baseMonthOffset = 1) {
    // baseMonthOffset=1 → 从上月起往前3个月；=2 → 从前月起往前3个月（用于月报，排除上月自身）
    const months = [];
    const now = new Date();
    for (let i = baseMonthOffset; i < baseMonthOffset + 3; i++) {
        months.push(_yyyyMM(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }
    const vals = months.map(m => _sumCvt(_monthExpenses(m)));
    const nonZero = vals.filter(v => v > 0);
    return { avg: nonZero.length ? nonZero.reduce((a,b)=>a+b,0)/nonZero.length : 0, months };
}

function _avg3Inc(baseMonthOffset = 1) {
    const months = [];
    const now = new Date();
    for (let i = baseMonthOffset; i < baseMonthOffset + 3; i++) {
        months.push(_yyyyMM(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }
    const vals = months.map(m => _sumCvt(_monthIncome(m)));
    const nonZero = vals.filter(v => v > 0);
    return { avg: nonZero.length ? nonZero.reduce((a,b)=>a+b,0)/nonZero.length : 0, months };
}

// 近3个月的类别平均支出 map
function _avg3CatExp(baseMonthOffset = 1) {
    const months = [];
    const now = new Date();
    for (let i = baseMonthOffset; i < baseMonthOffset + 3; i++) {
        months.push(_yyyyMM(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }
    const allCats = {};
    const countCats = {};
    months.forEach(m => {
        const catMap = _sumByCategory(_monthExpenses(m));
        Object.entries(catMap).forEach(([cat, amt]) => {
            allCats[cat]   = (allCats[cat]   || 0) + amt;
            countCats[cat] = (countCats[cat] || 0) + 1;
        });
    });
    const avg = {};
    Object.keys(allCats).forEach(cat => { avg[cat] = allCats[cat] / 3; }); // 除以3，无数据月算0
    return avg;
}

function _avg3CatInc(baseMonthOffset = 1) {
    const months = [];
    const now = new Date();
    for (let i = baseMonthOffset; i < baseMonthOffset + 3; i++) {
        months.push(_yyyyMM(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }
    const allCats = {};
    months.forEach(m => {
        const catMap = _sumByCategory(_monthIncome(m));
        Object.entries(catMap).forEach(([cat, amt]) => {
            allCats[cat] = (allCats[cat] || 0) + amt;
        });
    });
    const avg = {};
    Object.keys(allCats).forEach(cat => { avg[cat] = allCats[cat] / 3; });
    return avg;
}

// 近3个月同期（1~dayOfMonth）的支出类别平均 map
function _avg3SamePeriodCatExp(dayOfMonth) {
    const months = [];
    const now = new Date();
    for (let i = 1; i <= 3; i++) {
        months.push(_yyyyMM(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }
    const allCats = {};
    months.forEach(m => {
        const samePeriod = _monthExpenses(m).filter(tx => {
            const d = parseInt((tx.date||'').split('-')[2]||'0');
            return d <= dayOfMonth;
        });
        const catMap = _sumByCategory(samePeriod);
        Object.entries(catMap).forEach(([cat, amt]) => {
            allCats[cat] = (allCats[cat] || 0) + amt;
        });
    });
    const avg = {};
    Object.keys(allCats).forEach(cat => { avg[cat] = allCats[cat] / 3; });
    return avg;
}

function _avg3SamePeriodTotal(dayOfMonth) {
    const months = [];
    const now = new Date();
    for (let i = 1; i <= 3; i++) {
        months.push(_yyyyMM(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }
    const vals = months.map(m => {
        const samePeriod = _monthExpenses(m).filter(tx => {
            const d = parseInt((tx.date||'').split('-')[2]||'0');
            return d <= dayOfMonth;
        });
        return _sumCvt(samePeriod);
    });
    return vals.reduce((a,b)=>a+b,0) / 3;
}

/* ─── 趋势分析 ─── */
function _renderTrendAnalysis() {
    // 取近5个完整月（M-1 到 M-5），用后4个判断趋势
    const months = _recentFullMonths(5);  // [M-1, M-2, M-3, M-4, M-5]
    const totals  = months.map(m => _sumCvt(_monthExpenses(m)));

    // 至少需要3个月有数据
    const nonZero = totals.filter(v => v > 0);
    if (nonZero.length < 3) return '';

    // 判断总体趋势：用最近4个月（M-1 ~ M-4）
    const t = totals.slice(0, 4);  // [M-1, M-2, M-3, M-4]，索引越大越早

    function _trendLabel(vals) {
        // vals[0] = 最近，vals[n] = 最早
        const valid = vals.filter(v => v > 0);
        if (valid.length < 3) return null;
        // 计算相邻差方向
        const dirs = [];
        for (let i = 0; i < vals.length - 1; i++) {
            if (vals[i] === 0 || vals[i+1] === 0) continue;
            const chg = (vals[i] - vals[i+1]) / vals[i+1];
            dirs.push(chg > 0.05 ? 1 : chg < -0.05 ? -1 : 0);
        }
        if (dirs.length < 2) return null;
        const upCount   = dirs.filter(d => d === 1).length;
        const downCount = dirs.filter(d => d === -1).length;
        const neuCount  = dirs.filter(d => d === 0).length;
        if (upCount >= 2 && downCount === 0)   return { icon:'📈', label:'持续上升', cls:'insight-badge-up' };
        if (downCount >= 2 && upCount === 0)   return { icon:'📉', label:'持续下降', cls:'insight-badge-down' };
        if (upCount >= 2 && downCount >= 1)    return { icon:'〰️', label:'总体上升', cls:'insight-badge-up' };
        if (downCount >= 2 && upCount >= 1)    return { icon:'〰️', label:'总体下降', cls:'insight-badge-down' };
        if (neuCount >= 2)                      return { icon:'➡️', label:'基本稳定', cls:'insight-badge-neu' };
        return { icon:'〰️', label:'波动', cls:'insight-badge-neu' };
    }

    const totalTrend = _trendLabel(t);
    if (!totalTrend) return '';

    // 各类别近4个月趋势
    const allCats = new Set();
    months.slice(0, 4).forEach(m => {
        Object.keys(_sumByCategory(_monthExpenses(m))).forEach(c => allCats.add(c));
    });

    const catTrends = [];
    allCats.forEach(cat => {
        const catVals = months.slice(0, 4).map(m => (_sumByCategory(_monthExpenses(m)))[cat] || 0);
        const trend   = _trendLabel(catVals);
        const avg     = catVals.filter(v=>v>0).reduce((a,b)=>a+b,0) / 4;
        if (trend && avg > 0) catTrends.push({ cat, trend, avg, last: catVals[0] });
    });

    // 只展示有明显趋势（上升或下降）的类别，按最新金额排序
    const notable = catTrends
        .filter(r => r.trend.label !== '基本稳定' && r.trend.label !== '波动')
        .sort((a, b) => b.last - a.last)
        .slice(0, 5);

    let html = `<div class="insight-card">
        <div class="insight-card-title">📊 近4个月消费趋势</div>
        <div class="insight-row">
            <span>总体支出趋势</span>
            <span>${totalTrend.icon}&nbsp;<span class="${totalTrend.cls}">${totalTrend.label}</span>
            &nbsp;<span class="text-muted" style="font-size:0.75rem;">
                ${months.slice(0,4).map((m,i) => totals[i]>0 ? m.slice(5)+'月 '+_fmtC(totals[i]) : '').filter(Boolean).reverse().join(' → ')}
            </span></span>
        </div>`;

    if (notable.length > 0) {
        notable.forEach(({ cat, trend, last }) => {
            html += `<div class="insight-row">
                <span class="text-muted">${cat}</span>
                <span>${trend.icon}&nbsp;<span class="${trend.cls}">${trend.label}</span>
                &nbsp;<span class="text-muted" style="font-size:0.75rem;">上月 ${_fmtC(last)}</span></span>
            </div>`;
        });
    }

    html += `</div>`;
    return html;
}

/* ─── 异常消费检测 ─── */
function _renderAnomalies() {
    // 以上月为分析对象，前3个月（M-2, M-3, M-4）为基准
    const now       = new Date();
    const lastMonth = _yyyyMM(new Date(now.getFullYear(), now.getMonth()-1, 1));
    const baseMths  = _recentFullMonths(5).slice(1, 4);  // M-2, M-3, M-4

    const lastCats  = _sumByCategory(_monthExpenses(lastMonth));
    const lastTotal = _sumCvt(_monthExpenses(lastMonth));

    if (Object.keys(lastCats).length === 0) return '';

    // 每个类别的基准均值和标准差
    function _stats(cat) {
        const vals = baseMths.map(m => (_sumByCategory(_monthExpenses(m)))[cat] || 0);
        const mean = vals.reduce((a,b)=>a+b,0) / vals.length;
        const std  = Math.sqrt(vals.map(v=>(v-mean)**2).reduce((a,b)=>a+b,0) / vals.length);
        return { mean, std, vals };
    }

    const anomalies = [];

    Object.entries(lastCats).forEach(([cat, amt]) => {
        // 上月该类别金额小于5就忽略（太小的噪音）
        if (amt < 5) return;

        const { mean, std, vals } = _stats(cat);
        const hasHistory = vals.some(v => v > 0);

        if (!hasHistory) {
            // 历史3个月从未有该类别，且金额超过上月总支出10%
            if (lastTotal > 0 && amt / lastTotal > 0.1) {
                anomalies.push({
                    cat, amt, type: 'new',
                    desc: `近3月首次出现，占上月支出 ${(amt/lastTotal*100).toFixed(0)}%`
                });
            }
        } else if (std < mean * 0.01) {
            // 标准差极小（基本固定支出），若上月明显偏高
            if (amt > mean * 1.5) {
                anomalies.push({
                    cat, amt, type: 'spike',
                    desc: `历史稳定约 ${_fmtC(mean)}，上月异常偏高 +${((amt/mean-1)*100).toFixed(0)}%`
                });
            }
        } else {
            // 均值+1.5倍标准差检验
            const threshold = mean + 1.5 * Math.max(std, mean * 0.15);
            if (amt > threshold && amt > mean * 1.3) {
                anomalies.push({
                    cat, amt, type: 'spike',
                    desc: `历史均值 ${_fmtC(mean)}`
                });
            }
        }
    });

    if (anomalies.length === 0) return '';

    anomalies.sort((a, b) => b.amt - a.amt);

    let html = `<div class="insight-card" style="border-left:3px solid var(--app-expense);">
        <div class="insight-card-title" style="color:var(--app-expense);">消费提醒</div>`;

    anomalies.slice(0, 5).forEach(({ cat, amt, type, desc }) => {
        const icon = type === 'new' ? '🆕' : '🔺';
        html += `<div class="insight-row">
            <span>${icon} <b>${cat}</b></span>
            <span><b class="insight-badge-up">${_fmtC(amt)}</b>
                &nbsp;<span class="text-muted" style="font-size:0.75rem;">${desc}</span>
            </span>
        </div>`;
    });

    html += `</div>`;
    return html;
}

/* ─── 月度总结渲染 ─── */
function _renderMonthly() {
    const now       = new Date();
    const lastMonth = _yyyyMM(new Date(now.getFullYear(), now.getMonth()-1, 1));
    const lastExp   = _monthExpenses(lastMonth);
    const lastInc   = _monthIncome(lastMonth);

    if (lastExp.length === 0 && lastInc.length === 0) {
        return `<div class="text-muted text-center py-5" style="font-size:0.9rem;">
            上月暂无记录，无法生成月度总结。<br>
            <span style="font-size:0.8rem;">有完整一个月的数据后将自动生成。</span>
        </div>`;
    }

    const lastExpTotal = _sumCvt(lastExp);
    const lastIncTotal = _sumCvt(lastInc);
    const netLast      = lastIncTotal - lastExpTotal;

    // 近3月平均（从前月起往前3个月，不含上月自身）
    const avg3Exp    = _avg3Exp(2);
    const avg3Inc    = _avg3Inc(2);
    const avg3CatExp = _avg3CatExp(2);
    const avg3CatInc = _avg3CatInc(2);
    const expPct     = _pctStr(lastExpTotal, avg3Exp.avg);
    const incPct     = _pctStr(lastIncTotal, avg3Inc.avg);

    const lastCats    = _sumByCategory(lastExp);
    const lastIncCats = _sumByCategory(lastInc);
    const sortedCats  = Object.entries(lastCats).sort((a,b) => b[1]-a[1]);

    // 历史新高检测（近4个月中是否最高）
    let highlightMsg = '';
    if (sortedCats.length > 0) {
        const topCat = sortedCats[0][0];
        const topAmt = sortedCats[0][1];
        const hist = _recentFullMonths(4).slice(1).map(m =>
            (_sumByCategory(_monthExpenses(m)))[topCat] || 0
        );
        if (hist.some(v => v > 0) && hist.every(v => topAmt > v)) {
            highlightMsg = `📌 「${topCat}」上月支出 ${_fmtC(topAmt)}，为近 4 个月最高。`;
        }
    }

    // 近3月支出总额均值（含上月，用于总览里的参考行）
    const histVals = _recentFullMonths(3).map(m => _sumCvt(_monthExpenses(m))).filter(v => v > 0);
    const histAvg  = histVals.length ? histVals.reduce((a,b)=>a+b,0)/histVals.length : 0;

    const baseLabel = '近3月均值';

    let html = '';

    // ── 收支总览卡 ──
    html += `<div class="insight-card">
        <div class="insight-card-title">📊 上月收支总览（${lastMonth}）</div>
        <div class="insight-row">
            <span>总收入</span>
            <span><b>${_fmtC(lastIncTotal)}</b>&nbsp;<span class="${incPct.cls}">${incPct.text} vs ${baseLabel}</span>
            ${avg3Inc.avg > 0 ? `<span class="text-muted" style="font-size:0.75rem;"> 均值${_fmtC(avg3Inc.avg)}</span>` : ''}</span>
        </div>
        <div class="insight-row">
            <span>总支出</span>
            <span><b>${_fmtC(lastExpTotal)}</b>&nbsp;<span class="${expPct.cls}">${expPct.text} vs ${baseLabel}</span>
            ${avg3Exp.avg > 0 ? `<span class="text-muted" style="font-size:0.75rem;"> 均值${_fmtC(avg3Exp.avg)}</span>` : ''}</span>
        </div>
        <div class="insight-row">
            <span>收支${netLast >= 0 ? '结余' : '超支'}</span>
            <span style="font-weight:600;color:${netLast >= 0 ? 'var(--app-income)' : 'var(--app-expense)'};">
                ${netLast >= 0 ? '+' : ''}${_fmtC(netLast)}
            </span>
        </div>
    </div>`;

    // 亮点提示
    if (highlightMsg) {
        html += `<div class="insight-today-plan">${highlightMsg}</div>`;
    }

    // ── 异常消费 ──
    html += _renderAnomalies();

    // ── 支出类别对比卡 ──
    if (sortedCats.length > 0) {
        html += `<div class="insight-card">
            <div class="insight-card-title">📂 支出类别明细（vs ${baseLabel}）</div>`;
        sortedCats.slice(0, 8).forEach(([cat, amt]) => {
            const avgAmt = avg3CatExp[cat] || 0;
            const pct    = _pctStr(amt, avgAmt);
            html += `<div class="insight-row">
                <span>${cat}</span>
                <span><b>${_fmtC(amt)}</b>&nbsp;<span class="${pct.cls}">${pct.text}</span>
                &nbsp;<span class="text-muted" style="font-size:0.75rem;">${avgAmt>0?'均值'+_fmtC(avgAmt):'历史无'}</span></span>
            </div>`;
        });
        html += `</div>`;
    }

    // ── 收入类别对比卡 ──
    const sortedIncCats = Object.entries(lastIncCats).sort((a,b) => b[1]-a[1]);
    if (sortedIncCats.length > 0) {
        html += `<div class="insight-card">
            <div class="insight-card-title">💰 收入来源明细（vs ${baseLabel}）</div>`;
        sortedIncCats.slice(0, 6).forEach(([cat, amt]) => {
            const avgAmt = avg3CatInc[cat] || 0;
            const pct    = _pctStr(amt, avgAmt);
            html += `<div class="insight-row">
                <span>${cat}</span>
                <span><b>${_fmtC(amt)}</b>&nbsp;<span class="${pct.cls}">${pct.text}</span>
                &nbsp;<span class="text-muted" style="font-size:0.75rem;">${avgAmt>0?'均值'+_fmtC(avgAmt):'历史无'}</span></span>
            </div>`;
        });
        html += `</div>`;
    }

    // ── 近4月趋势分析 ──
    html += _renderTrendAnalysis();

    // ── 今年各月支出走势 ──
    html += _renderYearlyTrend();

    html += `<div class="text-muted text-center" style="font-size:0.75rem;padding-bottom:4px;">
        本月首次查看 · 下月初自动刷新 · 对比基准为近3月均值
    </div>`;
    return html;
}

/* ─── 今年各月支出走势 ─── */
function _renderYearlyTrend() {
    const now     = new Date();
    const year    = now.getFullYear();
    const curM    = now.getMonth(); // 0-indexed，本月不完整
    const months  = [];
    for (let m = 0; m < curM; m++) {
        months.push({ label: `${m+1}月`, key: `${year}-${String(m+1).padStart(2,'0')}` });
    }
    if (months.length === 0) return '';

    const vals   = months.map(m => _sumCvt(_monthExpenses(m.key)));
    const maxVal = Math.max(...vals, 0.01);
    const maxIdx = vals.indexOf(Math.max(...vals));

    let html = `<div class="insight-card">
        <div class="insight-card-title">📅 ${year} 年各月支出走势（折算 ${currentStatsFilter.currency}）</div>
        <div style="display:flex;align-items:flex-end;gap:5px;height:80px;margin-bottom:6px;">`;

    vals.forEach((v, i) => {
        const pct    = maxVal > 0 ? (v / maxVal * 100) : 0;
        const isMax  = i === maxIdx && v > 0;
        const barClr = isMax ? 'var(--app-expense)' : 'var(--app-primary)';
        html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">
            <div style="width:100%;background:${barClr};border-radius:3px 3px 0 0;height:${Math.max(pct*0.72,2)}px;opacity:0.85;"></div>
        </div>`;
    });

    html += `</div>
        <div style="display:flex;gap:5px;">`;
    vals.forEach((v, i) => {
        const isMax = i === maxIdx && v > 0;
        html += `<div style="flex:1;text-align:center;font-size:0.68rem;color:${isMax?'var(--app-expense)':'var(--bs-secondary-color)'};">
            ${months[i].label}
        </div>`;
    });
    html += `</div>`;

    if (maxIdx >= 0 && vals[maxIdx] > 0) {
        html += `<div class="insight-row" style="margin-top:8px;">
            <span class="text-muted">支出最高月</span>
            <span><b>${months[maxIdx].label}</b>
                <span class="insight-badge-up" style="margin-left:4px;">${_fmtC(vals[maxIdx])}</span>
            </span>
        </div>`;
    }

    // 今年累计
    const yearTotal = vals.reduce((a,b)=>a+b,0);
    if (yearTotal > 0) {
        const monthAvg = yearTotal / months.length;
        html += `<div class="insight-row">
            <span class="text-muted">今年累计支出</span>
            <span><b>${_fmtC(yearTotal)}</b>
                <span class="text-muted" style="font-size:0.75rem;"> 月均 ${_fmtC(monthAvg)}</span>
            </span>
        </div>`;
    }

    html += `</div>`;
    return html;
}

/* ─── 本月动态渲染 ─── */
function _renderDaily() {
    const now       = new Date();
    const curMonth  = _yyyyMM(now);
    const prevMonth = _yyyyMM(new Date(now.getFullYear(), now.getMonth()-1, 1));
    const todayStr  = _ymd(now);
    const todayDay  = now.getDate();

    const curTxs    = _monthExpenses(curMonth);
    const prevTxs   = _monthExpenses(prevMonth);
    const prevSame  = prevTxs.filter(tx => parseInt((tx.date||'').split('-')[2]||'0') <= todayDay);

    const curTotal  = _sumCvt(curTxs);
    const prevTotal = _sumCvt(prevSame);
    const totalPct  = _pctStr(curTotal, prevTotal);
    const curCats   = _sumByCategory(curTxs);
    const prevCats  = _sumByCategory(prevSame);

    let html = '';

    // 今日计划交易
    const todayPlans = plannedTransactions.filter(p => {
        if (p.dayOfMonth !== todayDay) return false;
        if (p.endDate   && p.endDate   < todayStr) return false;
        if (p.startDate && p.startDate > todayStr) return false;
        return true;
    });

    // 7天内即将到期的计划（不含今天）
    const soonPlans = plannedTransactions.filter(p => {
        const d = p.dayOfMonth;
        if (d <= todayDay || d > todayDay + 7) return false;
        if (p.endDate   && p.endDate   < todayStr) return false;
        if (p.startDate && p.startDate > todayStr) return false;
        return true;
    }).sort((a,b) => a.dayOfMonth - b.dayOfMonth);

    // 今日计划
    if (todayPlans.length > 0) {
        todayPlans.forEach(p => {
            const acc = accounts.find(a => a.id == p.accountId);
            const sym = acc ? (CURRENCY_SYMBOLS[acc.currency] || '¥') : '¥';
            html += `<div class="insight-today-plan">
                <b>📅 今日计划 · ${p.name}</b><br>
                <span class="text-muted" style="font-size:0.82rem;">${p.category} · ${p.type==='expense'?'支出':'收入'} ${sym}${p.amount.toFixed(2)}</span>
            </div>`;
        });
    }

    // 本月至今
    html += `<div class="insight-card">
        <div class="insight-card-title">📈 本月至今支出（vs 上月同期）</div>
        <div class="insight-row">
            <span>本月支出</span>
            <span><b>${_fmtC(curTotal)}</b>&nbsp;<span class="${totalPct.cls}">${totalPct.text}</span></span>
        </div>
        <div class="insight-row">
            <span class="text-muted">上月同期（1~${todayDay}日）</span>
            <span>${_fmtC(prevTotal)}</span>
        </div>
        <div class="insight-row">
            <span class="text-muted">本月笔数</span><span>${curTxs.length} 笔</span>
        </div>
    </div>`;

    // 类别 vs 上月同期
    const catRows = [...new Set([...Object.keys(curCats),...Object.keys(prevCats)])]
        .map(cat => ({ cat, cur: curCats[cat]||0, prev: prevCats[cat]||0 }))
        .filter(r => r.cur > 0)
        .sort((a,b) => b.cur - a.cur);

    if (catRows.length > 0) {
        html += `<div class="insight-card">
            <div class="insight-card-title">📂 类别 vs 上月同期</div>`;
        catRows.slice(0, 8).forEach(({ cat, cur, prev }) => {
            const pct = _pctStr(cur, prev);
            html += `<div class="insight-row">
                <span>${cat}</span>
                <span><b>${_fmtC(cur)}</b>&nbsp;<span class="${pct.cls}">${pct.text}</span>
                &nbsp;<span class="text-muted" style="font-size:0.75rem;">${prev>0?'上月同期'+_fmtC(prev):'上月同期无'}</span></span>
            </div>`;
        });
        html += `</div>`;
    }

    // 7天内计划
    if (soonPlans.length > 0) {
        html += `<div class="insight-card">
            <div class="insight-card-title">⏳ 7天内计划支出</div>`;
        soonPlans.forEach(p => {
            const acc = accounts.find(a => a.id == p.accountId);
            const sym = acc ? (CURRENCY_SYMBOLS[acc.currency]||'¥') : '¥';
            const left = p.dayOfMonth - todayDay;
            html += `<div class="insight-row">
                <span><b>${p.dayOfMonth}日</b> · ${p.name}
                    <span class="text-muted" style="font-size:0.75rem;"> ${p.category}</span>
                </span>
                <span><b>${sym}${p.amount.toFixed(2)}</b>
                    <span class="text-muted" style="font-size:0.75rem;"> 还有${left}天</span>
                </span>
            </div>`;
        });
        html += `</div>`;
    }

    if (curTxs.length === 0 && todayPlans.length === 0 && soonPlans.length === 0) {
        html += `<div class="text-muted text-center py-4">本月暂无支出记录。</div>`;
    }

    html += `<div class="text-muted text-center" style="font-size:0.75rem;padding-bottom:4px;">
        数据截至 ${todayStr} · 明天自动刷新
    </div>`;
    return html;
}

/* ─── 渲染对应 Tab ─── */
function _renderInsightTab(tab) {
    const el = $('insight-content');
    if (!el) return;
    el.innerHTML = tab === 'monthly' ? _renderMonthly() : _renderDaily();
    el.scrollTop = 0;
}
