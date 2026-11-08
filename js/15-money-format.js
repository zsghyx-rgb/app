// @file js/15-money-format.js
// 币种换算与金额格式化(formatLocal / convertAmt / toRmb / formatAmount)。

/**
 * 将 Date 对象格式化为本地日期字符串 YYYY-MM-DD
 */
function formatLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 将金额从账户货币转换为统计显示货币
 */
function convertAmt(amt, accCurrency) {
    // Convert amount from accCurrency to currentStatsFilter.currency
    const targetCurrency = currentStatsFilter.currency;
    if (accCurrency === targetCurrency) return amt;
    // Convert to RMB first
    let inRmb = amt;
    if (accCurrency !== 'RMB') {
        const r = exchangeRates[`${accCurrency}_RMB`];
        inRmb = r ? amt * r : amt;
    }
    // Then convert to target
    if (targetCurrency === 'RMB') return inRmb;
    const toRate = exchangeRates[`${targetCurrency}_RMB`];
    return toRate ? inRmb / toRate : inRmb;
}

/**
 * 将任意货币金额转换为人民币（用于净资产统计）
 */
function toRmb(amt, currency) {
    if (currency === 'RMB') return amt;
    const r = exchangeRates[`${currency}_RMB`];
    return r ? amt * r : amt;
}

/**
 * 格式化金额（日元不显示小数）
 */
function formatAmount(amt, currency) {
    return amt.toFixed(2);
}
