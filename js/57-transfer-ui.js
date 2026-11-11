// @file js/57-transfer-ui.js
// 转账界面：单个大金额输入、跨币种才出现“转入金额”（带汇率估算）、手续费（记为转出账户的一笔“手续费”支出）、合计提示。

/* ─── 手续费数据约定 ───
 * 手续费 = 一笔独立的支出记录：记在转出账户、分类“手续费”、所有者 = 转账发起人，
 * 并带可选字段 transferFeeFor = 转账配对 id（transferPairId；老转账没有配对 id 时用转出记录的 id）。
 * 这样手续费会计入支出统计和预算；编辑/删除转账时一并处理。老版本程序会忽略该字段，数据照常能打开。 */
const TRANSFER_FEE_CATEGORY = '手续费';

function transferFeeKey(tOut) {
    return String(tOut.transferPairId != null ? tOut.transferPairId : tOut.id);
}

function getTransferFeeRecord(tOut) {
    if (!tOut) return null;
    const key = transferFeeKey(tOut);
    return transactions.find(x => x.transferFeeFor != null && String(x.transferFeeFor) === key) || null;
}

// 分类里没有“手续费”时自动补上（只补一次，和手动在设置里添加分类一样）
function ensureTransferFeeCategory() {
    if (!categories.expense) categories.expense = [];
    if (!categories.expense.includes(TRANSFER_FEE_CATEGORY)) {
        categories.expense.push(TRANSFER_FEE_CATEGORY);
        if (typeof markConfigUpdated === 'function') markConfigUpdated();
    }
}

// 新增 / 更新 / 删除一笔转账对应的手续费记录（fee<=0 表示没有手续费）
function applyTransferFee(tOut, fee, date, fromAccountId, desc) {
    const rec = getTransferFeeRecord(tOut);
    if (fee > 0) {
        ensureTransferFeeCategory();
        const feeDesc = desc ? `转账手续费 · ${desc}` : '转账手续费';
        if (rec) {
            rec.date = date; rec.accountId = fromAccountId; rec.amount = -fee;
            rec.desc = feeDesc; rec.updatedAt = Date.now();
        } else {
            transactions.unshift({
                id: Date.now() + Math.random(), date: date, type: 'expense', accountId: fromAccountId,
                amount: -fee, category: TRANSFER_FEE_CATEGORY, desc: feeDesc, tags: '',
                ownerName: tOut.ownerName, isTransfer: false,
                transferFeeFor: tOut.transferPairId != null ? tOut.transferPairId : tOut.id,
                updatedAt: Date.now()
            });
        }
    } else if (rec) {
        removeTransactionsAndLog([rec.id]);
    }
}

// 删除若干笔交易并写入删除日志（供同步使用）
function removeTransactionsAndLog(ids) {
    const now = Date.now();
    transactions = transactions.filter(x => !ids.includes(x.id));
    if (!inMemoryLoadedData.deletedLog) inMemoryLoadedData.deletedLog = [];
    ids.forEach(did => {
        if (!inMemoryLoadedData.deletedLog.find(e => e.id === did)) inMemoryLoadedData.deletedLog.push({ id: did, deletedAt: now });
    });
}

/* ─── 界面 ─── */

function _transferAccs() {
    const fromId = $('edit-transfer-from') && $('edit-transfer-from').value;
    const toId = $('edit-transfer-to') && $('edit-transfer-to').value;
    return {
        from: accounts.find(a => a.id == fromId) || null,
        to: accounts.find(a => a.id == toId) || null
    };
}

// 两种币种之间的参考换算（按设置里的汇率）；没有汇率时返回 null
function convertBetweenCurrencies(amt, fromCur, toCur) {
    if (fromCur === toCur) return amt;
    const rf = fromCur === 'RMB' ? 1 : exchangeRates[`${fromCur}_RMB`];
    const rt = toCur === 'RMB' ? 1 : exchangeRates[`${toCur}_RMB`];
    if (!rf || !rt) return null;
    return amt * rf / rt;
}

function _transferMoney(sym, n) { return `${sym}${n.toFixed(2)}`; }

function _transferFeeValue() {
    const el = $('edit-transfer-fee');
    if (!el || el.value.trim() === '') return 0;
    const v = parseFloat(el.value);
    return (isNaN(v) || v < 0) ? NaN : v;
}

// 根据当前选择的账户刷新：币种符号、是否显示“转入金额”、手续费摘要、合计提示
function refreshTransferLayout() {
    const { from, to } = _transferAccs();
    const symOut = from ? (CURRENCY_SYMBOLS[from.currency] || '') : '¥';
    const symIn = to ? (CURRENCY_SYMBOLS[to.currency] || '') : '¥';
    if ($('transfer-currency-out')) $('transfer-currency-out').textContent = symOut;
    if ($('transfer-currency-in')) $('transfer-currency-in').textContent = symIn;
    if ($('transfer-currency-fee')) $('transfer-currency-fee').textContent = symOut;

    const cross = !!(from && to && from.currency !== to.currency);
    const wrap = $('transfer-in-wrap');
    if (wrap) wrap.style.display = cross ? '' : 'none';
    const inEl = $('edit-transfer-amount-in');
    if (inEl) inEl.required = cross;   // 隐藏的必填框会让表单无法提交，所以只在显示时才必填

    // 汇率参考
    const hint = $('transfer-rate-hint');
    if (hint) {
        hint.innerHTML = '';
        const out = parseFloat($('edit-transfer-amount-out').value);
        if (cross && !isNaN(out) && out > 0) {
            const est = convertBetweenCurrencies(out, from.currency, to.currency);
            if (est != null) hint.innerHTML = `参考汇率约 ${symIn}${est.toFixed(2)}`
                + ` <a href="#" onclick="applyTransferEstimate();return false;">使用</a>`;
        }
    }

    // 手续费摘要
    const fee = _transferFeeValue();
    const sum = $('transfer-fee-summary');
    if (sum) sum.textContent = (fee > 0) ? _transferMoney(symOut, fee) : '无';
    if (sum) sum.classList.toggle('has-fee', fee > 0);

    // 合计提示
    const tip = $('transfer-total-hint');
    if (tip) {
        const out = parseFloat($('edit-transfer-amount-out').value);
        const inn = parseFloat($('edit-transfer-amount-in').value);
        if (!isNaN(out) && out > 0 && from && to) {
            const inAmt = cross ? inn : out;
            let txt = (fee > 0 && !isNaN(fee))
                ? `转出合计 ${_transferMoney(symOut, out + fee)}（含手续费 ${_transferMoney(symOut, fee)}）`
                : `转出 ${_transferMoney(symOut, out)}`;
            if (!isNaN(inAmt) && inAmt > 0) txt += ` · 转入 ${_transferMoney(symIn, inAmt)}`;
            tip.textContent = txt;
            tip.style.display = '';
        } else {
            tip.style.display = 'none';
        }
    }
}

// 记录当前“转出币种>转入币种”组合；组合变化（换了账户）时，转入金额要按新汇率重新估算
function _transferPairKey() {
    const { from, to } = _transferAccs();
    return (from && to) ? `${from.currency}>${to.currency}` : '';
}
function markTransferPair() {
    const inEl = $('edit-transfer-amount-in');
    if (inEl) inEl.dataset.pair = _transferPairKey();
}

// 跨币种：转入金额没手动改过时，按汇率自动估算（标记 auto，手动输入后不再覆盖）
function autoEstimateTransferIn() {
    const { from, to } = _transferAccs();
    const inEl = $('edit-transfer-amount-in');
    if (!from || !to || from.currency === to.currency || !inEl) return;
    if (inEl.value !== '' && inEl.dataset.auto !== '1') return;
    const out = parseFloat($('edit-transfer-amount-out').value);
    if (isNaN(out) || out <= 0) { if (inEl.dataset.auto === '1') inEl.value = ''; return; }
    const est = convertBetweenCurrencies(out, from.currency, to.currency);
    if (est != null) { inEl.value = est.toFixed(2); inEl.dataset.auto = '1'; }
}

function applyTransferEstimate() {
    const inEl = $('edit-transfer-amount-in');
    if (inEl) { inEl.dataset.auto = '1'; inEl.value = ''; }
    autoEstimateTransferIn();
    refreshTransferLayout();
}

/* 手续费行：折叠 / 展开 */
function toggleTransferFee(open, noFocus) {
    const body = $('transfer-fee-body');
    if (!body) return;
    const show = (open === undefined) ? body.style.display === 'none' : !!open;
    body.style.display = show ? '' : 'none';
    const chev = $('transfer-fee-chevron');
    if (chev) chev.className = show ? 'bi bi-chevron-up tm-row-chevron' : 'bi bi-chevron-down tm-row-chevron';
    if (show && !noFocus) { const el = $('edit-transfer-fee'); if (el && !el.disabled) el.focus(); }
}

function handleTransferFeeInput() { refreshTransferLayout(); }

function clearTransferFee() {
    $('edit-transfer-fee').value = '';
    refreshTransferLayout();
    toggleTransferFee(false);
}

// 打开“新增转账”时重置
function resetTransferFeeUI() {
    if ($('edit-transfer-fee')) $('edit-transfer-fee').value = '';
    const inEl = $('edit-transfer-amount-in');
    if (inEl) { inEl.dataset.auto = ''; inEl.dataset.pair = ''; }
    const card = $('transfer-fee-card');
    if (card) card.style.display = '';
    toggleTransferFee(false, true);
    refreshTransferLayout();
}

// 打开“编辑/查看转账”时载入已有手续费
function loadTransferFeeUI(tOut, readOnly) {
    const rec = getTransferFeeRecord(tOut);
    const feeEl = $('edit-transfer-fee');
    if (feeEl) feeEl.value = rec ? Math.abs(rec.amount) : '';
    const inEl = $('edit-transfer-amount-in');
    if (inEl) { inEl.dataset.auto = ''; markTransferPair(); }     // 已保存的转入金额是用户确认过的，不再自动覆盖
    const card = $('transfer-fee-card');
    if (card) card.style.display = (readOnly && !rec) ? 'none' : '';   // 只读且没有手续费：不显示这一行
    toggleTransferFee(!!rec, true);
    refreshTransferLayout();
}
