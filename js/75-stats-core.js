// @file js/75-stats-core.js
// 统计页：筛选面板、月份导航、币种/用户/聚合切换、renderStats 调度、图表钻取抽屉。

// ── 统计页筛选面板收起展开 ──────────────────────────────────
function toggleStatsFilter() {
    const panel = $('stats-filter-panel');
    const btn   = $('stats-filter-btn');
    const isOpen = panel.classList.toggle('open');
    btn.classList.toggle('active', isOpen);
}

// ── 统计页子Tab切换 ─────────────────────────────────────────
function switchStatsTab(tab) {
    $$('.stats-sub-tab-btn').forEach(b => b.classList.remove('active'));
    $$('.stats-sub-pane').forEach(p => p.classList.remove('active'));
    $(`stats-tab-${tab}`).classList.add('active');
    $(`stats-pane-${tab}`).classList.add('active');
    if (tab === 'budget') renderBudgetPane();
    else renderStats();
}


function navigateStatsMonth(delta) {
    const now = new Date();
    const isYear = statsNavMode === 'year';

    if (delta === 0) {
        // 点击中间标签：回到本月 / 本年
        if (isYear) {
            statsNavYear = now.getFullYear();
        } else {
            statsNavYear  = now.getFullYear();
            statsNavMonth = now.getMonth();
        }
    } else if (isYear) {
        // 年模式：前后箭头切换上一年 / 下一年，不允许超过今年
        statsNavYear += delta;
        if (statsNavYear > now.getFullYear()) statsNavYear = now.getFullYear();
    } else {
        // 月模式：前后箭头切换上一个月 / 下一个月
        statsNavMonth += delta;
        if (statsNavMonth > 11) { statsNavMonth = 0; statsNavYear++; }
        if (statsNavMonth < 0)  { statsNavMonth = 11; statsNavYear--; }
        // 不允许超过当前月
        if (statsNavYear > now.getFullYear() ||
            (statsNavYear === now.getFullYear() && statsNavMonth > now.getMonth())) {
            statsNavYear  = now.getFullYear();
            statsNavMonth = now.getMonth();
        }
    }
    statsNavMode = isYear ? 'year' : 'month';
    // 关闭自定义面板
    const panel = $('stats-custom-date-panel');
    if (panel) panel.style.setProperty('display', 'none', 'important');
    const toggle = $('stats-custom-toggle');
    if (toggle) toggle.classList.remove('active');
    // 计算该月 / 该年的首末日
    let start, end;
    if (statsNavMode === 'year') {
        start = new Date(statsNavYear, 0, 1);
        end   = new Date(statsNavYear, 11, 31);
    } else {
        start = new Date(statsNavYear, statsNavMonth, 1);
        end   = new Date(statsNavYear, statsNavMonth + 1, 0);
    }
    const startStr = formatLocal(start);
    const endStr   = formatLocal(end);
    $('stats-start-date').value = startStr;
    $('stats-end-date').value   = endStr;
    currentStatsFilter.startDate = startStr;
    currentStatsFilter.endDate   = endStr;
    // 高亮当前模式对应的快捷按钮
    $$('#quick-stats-filter-group-1 button').forEach(b =>
        b.classList.toggle('active', b.dataset.range === statsNavMode));
    updateStatsNavUI();
    renderStats();
}

function updateStatsNavUI() {
    const label   = $('stats-month-label');
    const nextBtn = $('stats-next-month-btn');
    const prevBtn = $('stats-prev-month-btn');
    if (!label) return;
    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const now = new Date();
    const atCurrentMonth = statsNavYear === now.getFullYear() && statsNavMonth === now.getMonth();
    const atCurrentYear  = statsNavYear === now.getFullYear();

    if (statsNavMode === 'month') {
        // 本月显示“本月”，切到其他月份显示具体年月
        label.textContent = atCurrentMonth ? '本月' : `${statsNavYear}年${monthNames[statsNavMonth]}`;
        label.title = '点击回到本月';
        label.classList.remove('text-muted');
    } else if (statsNavMode === 'year') {
        // 今年显示“本年”，切到其他年份显示具体年份
        label.textContent = atCurrentYear ? '本年' : `${statsNavYear}年`;
        label.title = '点击回到本年';
        label.classList.remove('text-muted');
    } else {
        label.textContent = '—';
        label.title = '';
        label.classList.add('text-muted');
    }
    if (prevBtn) prevBtn.title = statsNavMode === 'year' ? '上一年' : '上月';
    if (nextBtn) {
        nextBtn.title = statsNavMode === 'year' ? '下一年' : '下月';
        // 已到当前月 / 当前年时禁用“下一个”
        nextBtn.disabled =
            (statsNavMode === 'month' && atCurrentMonth) ||
            (statsNavMode === 'year'  && atCurrentYear);
    }
    // 月 / 年模式下同步快捷按钮高亮（登录初始化时也会走到这里）
    if (statsNavMode === 'month' || statsNavMode === 'year') {
        $$('#quick-stats-filter-group-1 button').forEach(b =>
            b.classList.toggle('active', b.dataset.range === statsNavMode));
    }
}

function toggleStatsCustomDate() {
    const panel  = $('stats-custom-date-panel');
    const toggle = $('stats-custom-toggle');
    if (!panel) return;
    const isHidden = panel.style.getPropertyValue('display') === 'none' || panel.style.cssText.includes('none');
    if (isHidden) {
        panel.style.setProperty('display', 'flex', 'important');
        toggle.classList.add('active');
    } else {
        panel.style.setProperty('display', 'none', 'important');
        toggle.classList.remove('active');
    }
}

// ─────────────────────────────────────────────────────────────
function applyStatsFilter() {
    currentStatsFilter.startDate = $('stats-start-date').value;
    currentStatsFilter.endDate   = $('stats-end-date').value;
    // 切换到自定义模式
    statsNavMode = 'range';
    $$('#quick-stats-filter-group-1 button').forEach(b => b.classList.remove('active'));
    updateStatsNavUI();
    renderStats();
}

function quickStatsDateFilter(p) {
    const today = new Date();

    // 本月 / 本年：进入可前后切换的“月 / 年”模式
    if (p === 'month' || p === 'year') {
        statsNavYear  = today.getFullYear();
        statsNavMonth = today.getMonth();
        statsNavMode  = p;
        const start = p === 'month'
            ? new Date(statsNavYear, statsNavMonth, 1)
            : new Date(statsNavYear, 0, 1);
        const end = p === 'month'
            ? new Date(statsNavYear, statsNavMonth + 1, 0)
            : new Date(statsNavYear, 11, 31);
        $('stats-start-date').value = formatLocal(start);
        $('stats-end-date').value   = formatLocal(end);
        currentStatsFilter.startDate = $('stats-start-date').value;
        currentStatsFilter.endDate   = $('stats-end-date').value;
        $$('#quick-stats-filter-group-1 button').forEach(b =>
            b.classList.toggle('active', b.dataset.range === p));
        // 关闭自定义面板
        const panel = $('stats-custom-date-panel');
        if (panel) panel.style.setProperty('display', 'none', 'important');
        const toggle = $('stats-custom-toggle');
        if (toggle) toggle.classList.remove('active');
        updateStatsNavUI();
        renderStats();
        return;
    }

    let start = '', end = '';
    if      (p === '30days')  { start = new Date(today); start.setDate(today.getDate() - 30); end = today; }
    else if (p === '3months') { start = new Date(today); start.setMonth(today.getMonth() - 3); end = today; }
    else if (p === '6months') { start = new Date(today); start.setMonth(today.getMonth() - 6); end = today; }
    else if (p === '12months'){ start = new Date(today); start.setMonth(today.getMonth() - 12); end = today; }
    else if (p === '24months'){ start = new Date(today); start.setMonth(today.getMonth() - 24); end = today; }
    else if (p === 'year')    { start = new Date(today.getFullYear(), 0, 1); end = new Date(today.getFullYear(), 11, 31); }
    else if (p === 'all')     { start = ''; end = ''; }
    $('stats-start-date').value = start ? formatLocal(start) : '';
    $('stats-end-date').value   = end   ? formatLocal(end)   : '';
    currentStatsFilter.startDate = $('stats-start-date').value;
    currentStatsFilter.endDate   = $('stats-end-date').value;
    // 高亮当前按钮，切换到范围模式
    $$('#quick-stats-filter-group-1 button').forEach(b =>
        b.classList.toggle('active', b.dataset.range === p));
    statsNavMode = 'range';
    // 关闭自定义面板
    const panel = $('stats-custom-date-panel');
    if (panel) panel.style.setProperty('display', 'none', 'important');
    const toggle = $('stats-custom-toggle');
    if (toggle) toggle.classList.remove('active');
    updateStatsNavUI();
    renderStats();
}

function switchStatsCurrency(c, el) {
    if (el) {
        $$('#stats-currency-btns button').forEach(b => b.classList.remove('active'));
        el.classList.add('active');
    }
    currentStatsFilter.currency = c;
    localStorage.setItem('APP_stats_currency', c);
    renderStats();
    // 账户页净资产、交易页概览与当日合计使用同一个显示币种，立即同步刷新
    if (typeof renderAllTransactions === 'function') renderAllTransactions();
    if (typeof renderAccounts === 'function') renderAccounts();
}

function switchStatsUser(u) {
    currentStatsFilter.user = u;
    localStorage.setItem('APP_stats_user', u);
    // 更新用户按钮高亮
    $$('#stats-user-btns button').forEach(b =>
        b.classList.toggle('active', b.dataset.user === u));
    renderStats();
}

function switchAssetAggregation(type, el) {
    $$('.chart-card .btn-group button').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    currentAssetAggregation = type;
    renderAssetHistoryChart();
}

function renderStats() {
    // 统计页不可见时完全跳过：交易页每次重绘都会调用 renderStats，
    // 以前即使人不在统计页也会把 6 张图全部重算一遍，这是交易页卡顿的主要来源之一。
    if (!$('view-stats')?.classList.contains('active-view')) return;

    renderStatsCurrencyButtons();
    updateStatsNavUI();
    const start = currentStatsFilter.startDate;
    const end = currentStatsFilter.endDate;
    const filterUser = currentStatsFilter.user || 'all';
    const filterCurrency = currentStatsFilter.currency;

    const sourceTrans = transactions;

    // 按需计算：筛选条件、汇率、数据版本、来源数组长度均未变化时，跳过重复的过滤与汇总计算
    const cacheKey = [
        0, start, end, filterUser, filterCurrency,
        _statsDataVersion, sourceTrans.length, accounts.length, currentUserName,
        JSON.stringify(exchangeRates)
    ].join('|');

    let filtered, inc, exp;
    if (_statsCache && _statsCache.key === cacheKey) {
        filtered = _statsCache.filtered;
        inc = _statsCache.inc;
        exp = _statsCache.exp;
    } else {
        filtered = sourceTrans.filter(t => {
            if (t._isBaseline) return false;
            if (start && t.date < start) return false;
            if (end && t.date > end) return false;
            if (filterUser !== 'all' && t.ownerName !== filterUser) return false;
            return true;
        });
        const accMap = new Map(accounts.map(a => [String(a.id), a]));
        inc = 0; exp = 0;
        filtered.forEach(t => {
            if (t.isTransfer) return;
            const acc = accMap.get(String(t.accountId));
            if (!acc) return;
            let amt = convertAmt(t.amount, acc.currency);
            if (amt > 0) inc += amt; else exp += amt;
        });
        _statsCache = { key: cacheKey, filtered, inc, exp };
    }

    const hiddenClass = amountsHidden ? 'amount-hidden' : '';
    $('stat-income-display').className = `stat-number is-income ${hiddenClass}`;
    $('stat-expense-display').className = `stat-number is-expense ${hiddenClass}`;
    $('stat-net-display').className = `stat-number is-net ${hiddenClass}`;
    $('stat-income-display').innerText = formatAmount(inc, currentStatsFilter.currency);
    $('stat-expense-display').innerText = formatAmount(Math.abs(exp), currentStatsFilter.currency);
    $('stat-net-display').innerText = formatAmount(inc + exp, currentStatsFilter.currency);

    // 概览子页才需要图表；在预算子页时只刷新预算
    if (!$('stats-pane-overview')?.classList.contains('active')) {
        if ($('stats-pane-budget')?.classList.contains('active')) renderBudgetPane();
        return;
    }

    const sel = $('category-trend-select');
    if (sel && sel.options.length === 0) {
        categories.expense.forEach(c => sel.add(new Option(c, c)));
    }

    // 同一份数据、同一组筛选条件：图表已经是正确的，直接复用，避免切来切去反复重画
    const chartKey = [cacheKey, sel ? sel.value : ''].join('~');
    if (_statsRenderedKey === chartKey) {
        if ($('stats-pane-budget')?.classList.contains('active')) renderBudgetPane();
        return;
    }

    renderExpenseChart(filtered);
    renderTagChart(filtered);
    renderTrendChart(filtered);
    renderAssetHistoryChart();
    renderCategoryTrendChart(filtered);
    renderTotalExpenseTrendChart(filtered);
    _statsRenderedKey = chartKey;

    // 预算子页若当前可见，同步刷新（集中在此处理，避免各个筛选入口各自维护一份遗漏）
    if ($('stats-pane-budget')?.classList.contains('active')) renderBudgetPane();
}

// ── 图表钻取底部抽屉 ─────────────────────────────────────────
function showChartDrawer(title, txList) {
    const drawer    = $('chart-drawer');
    const backdrop  = $('chart-drawer-backdrop');
    const titleEl   = $('chart-drawer-title');
    const summaryEl = $('chart-drawer-summary');
    const body      = $('chart-drawer-body');

    titleEl.textContent = title;
    _chartDrawerData = { title: title, txList: txList };
    body.innerHTML = '';

    if (!txList || txList.length === 0) {
        body.innerHTML = '<div id="chart-drawer-empty"><i class="bi bi-inbox" style="font-size:2rem;opacity:.4;"></i><br>暂无相关流水</div>';
        summaryEl.textContent = '';
    } else {
        // 汇总
        const accMap = new Map(accounts.map(a => [String(a.id), a]));
        let total = 0;
        txList.forEach(t => {
            const acc = accMap.get(String(t.accountId));
            if (acc) total += convertAmt(Math.abs(t.amount), acc.currency);
        });
        const currency = currentStatsFilter.currency || 'RMB';
        const symbol = CURRENCY_SYMBOLS[currency] || '';
        summaryEl.textContent = `共 ${txList.length} 笔  合计 ${symbol}${formatAmount(total)}`;

        // 按日期倒序，过滤转账收入侧
        const sorted = [...txList]
            .filter(t => !(t.isTransfer && t.type === 'income'))
            .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

        // ── 卡片 ──
        sorted.forEach(t => {
                const acc = accMap.get(String(t.accountId));
                if (!acc) return;
                const card = document.createElement('div');
                card.className = 'mobile-transaction-card';

                const accDisplayName = getAccountDisplayName(acc);
                const descClean      = t.desc || '';
                const tagsHtml       = t.tags ? `<span style="color:var(--bs-secondary);font-size:0.78rem;"> <i class="bi bi-tag" style="font-size:0.62rem;"></i> ${t.tags}</span>` : '';
                const noteHtml       = descClean ? `<span style="color:var(--bs-secondary);font-size:0.78rem;"> <i class="bi bi-chat-left-text" style="font-size:0.62rem;"></i> ${descClean}</span>` : '';
                const attachIconHtml = t.attachmentId ? ` <i class="bi bi-paperclip" style="color:var(--bs-secondary);font-size:0.72rem;"></i>` : '';

                if (t.isTransfer && t.type === 'expense') {
                    const accTo = accounts.find(a => a.id == t.relatedAccountId);
                    if (!accTo) return;
                    card.innerHTML = `
                        <div class="card-line-1">
                            <div class="fw-bold flex-grow-1" style="font-size:0.85rem;">${accDisplayName} <i class="bi bi-arrow-right-short text-primary"></i> ${getAccountDisplayName(accTo)}</div>
                            <div class="amount-transfer fw-bold">${CURRENCY_SYMBOLS[acc.currency]}${formatAmount(Math.abs(t.amount), acc.currency)}</div>
                        </div>
                        <div class="card-line-2"><span class="text-muted small">${t.date}${descClean ? ` · ${descClean}` : ''}</span></div>`;
                } else {
                    const amountClass = t.amount < 0 ? 'amount-expense' : 'amount-income';
                    const catDisplay  = t.items && t.items.length > 1
                        ? t.items[0].category + '等' + (t.items.length - 1) + '项'
                        : (t.category || '') + (t._splitPortion ? ' <span class="text-muted" style="font-size:.72rem;">(拆分)</span>' : '');
                    card.innerHTML = `
                        <div class="card-line-1">
                            <span class="category-text">${catDisplay}${tagsHtml}${attachIconHtml}</span>
                            <div class="${amountClass} fw-bold">${CURRENCY_SYMBOLS[acc.currency]}${formatAmount(Math.abs(t.amount), acc.currency)}</div>
                        </div>
                        <div class="card-line-2">
                            <span class="text-muted small">${t.date} · ${accDisplayName}${noteHtml}</span>
                        </div>`;
                }

                card.addEventListener('click', () => {
                    _fromChartDrawer = true;
                    closeChartDrawer();
                    setTimeout(() => {
                        if (t.isTransfer) openEditTransfer(t.id);
                        else openEditTransaction(t.id);
                    }, 280);
                });
                body.appendChild(card);
            });
        }

    backdrop.classList.add('show');
    drawer.classList.add('show');
    document.body.style.overflow = 'hidden';
}
