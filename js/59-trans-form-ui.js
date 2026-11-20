// @file js/59-trans-form-ui.js
// 新增/编辑支出收入的表单增强（5.1.1）：数字键盘（支持 + − 算式）、日期快捷（今天/昨天/前天）、保存并再记一笔、备注联想（选中后带出分类）。

/* ═══════════ 一、数字键盘 ═══════════
 * 金额输入框 #edit-trans-amount 在“数字键盘模式”下是只读的（不弹系统键盘），数字由页面里的键盘填入；
 * 框里放的是算式文本（如 12+8.5），保存前由 commitTransAmount() 算成一个数字再交给原来的保存逻辑。
 * “系统键盘模式”下和以前完全一样（右上角键盘图标切换，选择记在本机）。 */
const AMOUNT_PAD_KEY = 'APP_amount_pad';          // 'pad'（默认）| 'system'
let _padMode = 'pad';
try { if (localStorage.getItem(AMOUNT_PAD_KEY) === 'system') _padMode = 'system'; } catch (_) {}
let _padFresh = false;         // 刚载入的已有金额：下一次按数字键会替换它（按运算符/退格则在它基础上继续）
let _padTempHidden = false;    // 点了备注/标签输入框时临时收起键盘（点金额区再显示）
let _transKeepOpen = false;    // “保存并再记”：保存后窗口不关

function _amtEl() { return $('edit-trans-amount'); }

// 算式求值：只支持 + −，忽略结尾多余的运算符；结果保留两位小数；无法解析返回 NaN
function evalAmountExpr(s) {
    if (s == null || s === '') return NaN;
    if (!/^[0-9.+\-]*$/.test(s)) return NaN;
    let total = 0, sign = 1, cur = '', any = false;
    for (const ch of s) {
        if (ch === '+' || ch === '-') {
            if (cur !== '') { total += sign * parseFloat(cur); any = true; }
            sign = ch === '+' ? 1 : -1;
            cur = '';
        } else cur += ch;
    }
    if (cur !== '') { total += sign * parseFloat(cur); any = true; }
    if (!any || isNaN(total)) return NaN;
    return Math.round(total * 100) / 100;
}

function _hasOperator(s) { return /[+\-]/.test(s.slice(1)) || /^-/.test(s); }

function _updateExprHint() {
    const hint = $('amount-expr-hint'), el = _amtEl();
    if (!hint || !el) return;
    const s = el.value;
    if (_hasOperator(s)) {
        const v = evalAmountExpr(s);
        hint.style.display = '';
        hint.textContent = isNaN(v) ? '' : `= ${v.toFixed(2)}`;
        hint.classList.toggle('is-bad', !isNaN(v) && v <= 0);
    } else {
        hint.style.display = 'none';
    }
    const eq = $('kp-eq'); if (eq) eq.classList.toggle('is-ready', _hasOperator(s));
}

// 把算式算成一个数字写回输入框（保存、切到系统键盘、进入拆分、切换收入/支出/转账之前调用）
function commitTransAmount() {
    const el = _amtEl();
    if (!el || !_hasOperator(el.value)) { _updateExprHint(); return; }
    const v = evalAmountExpr(el.value);
    el.value = isNaN(v) ? '' : String(v);     // 结果 ≤ 0 时原样写回负数/0，由保存逻辑提示“请输入有效金额”
    _updateExprHint();
}

function amountPadPress(k) {
    const el = _amtEl();
    if (!el) return;
    let s = el.value;
    if (k === 'back') { _padFresh = false; s = s.slice(0, -1); }
    else if (k === 'clear') { _padFresh = false; s = ''; }
    else if (k === '=') { commitTransAmount(); _padFresh = false; return; }
    else if (k === '+' || k === '-') {
        _padFresh = false;
        if (s === '') return;                                   // 不以运算符开头
        if (/[+\-]$/.test(s)) s = s.slice(0, -1);               // 连按运算符：替换上一个
        else if (/\.$/.test(s)) s = s.slice(0, -1);             // 12. + → 12+
        s += k;
    } else {                                                    // 数字 / 小数点
        if (_padFresh) { s = ''; _padFresh = false; }
        const seg = (/[0-9.]*$/.exec(s) || [''])[0];            // 正在输入的这一段数字
        if (k === '.') {
            if (seg.includes('.')) return;
            if (seg === '') s += '0';
            s += '.';
        } else {
            if (seg.includes('.') && seg.split('.')[1].length >= 2) return;   // 小数最多 2 位
            if (seg.replace('.', '').length >= 10) return;
            if (seg === '0') s = s.slice(0, -1);                // 0 后面再输数字：不出现 007
            s += k;
        }
    }
    el.value = s;
    _updateExprHint();
}

// 键盘是否显示 + 输入框是只读还是可输入
function amountPadSync() {
    const kp = $('amount-keypad'), el = _amtEl(), form = $('edit-transaction-form');
    if (!kp || !el || !form) return;
    const mode = $('edit-trans-mode') ? $('edit-trans-mode').value : 'add';
    const formVisible = form.style.display !== 'none';
    const padOn = _padMode === 'pad';
    kp.style.display = (formVisible && mode !== 'view' && !_inSplitMode && padOn && !_padTempHidden) ? '' : 'none';
    el.readOnly = padOn;
    el.setAttribute('inputmode', padOn ? 'none' : 'decimal');
    const tg = $('amount-kb-toggle');
    if (tg) { tg.classList.toggle('active', !padOn); tg.title = padOn ? '改用系统键盘' : '改用数字键盘'; }
    $('trans-amount-card')?.classList.toggle('pad-active', padOn && formVisible && !_inSplitMode);
}

function amountPadShow() {            // 点金额区：显示数字键盘（系统键盘模式下则聚焦输入）
    if (_padMode === 'pad') { _padTempHidden = false; amountPadSync(); }
    else { const el = _amtEl(); if (el && !el.disabled) el.focus(); }
}

function toggleAmountKeyboard() {
    commitTransAmount();
    _padMode = _padMode === 'pad' ? 'system' : 'pad';
    try { localStorage.setItem(AMOUNT_PAD_KEY, _padMode); } catch (_) {}
    _padTempHidden = false;
    amountPadSync();
    const el = _amtEl();
    if (_padMode === 'system') { if (el && !el.disabled) el.focus(); }
    else if (el) el.blur();
}

function amountPadReset() {           // “保存并再记”之后：金额清空，键盘回到可用状态
    const el = _amtEl();
    if (el) el.value = '';
    _padFresh = false; _padTempHidden = false;
    _updateExprHint(); amountPadSync();
}

/* ═══════════ 二、日期快捷 ═══════════ */
function setTransDateOffset(n) {
    const d = new Date(); d.setDate(d.getDate() - n);
    $('edit-trans-date').value = formatLocal(d);
    syncDateLabels();
}

function pickTransDate() {
    const el = $('edit-trans-date');
    if (!el) return;
    if (el.showPicker) { try { el.showPicker(); return; } catch (_) {} }
    el.focus(); el.click();
}

function syncDateChips() {
    const box = $('trans-date-chips'), el = $('edit-trans-date');
    if (!box || !el) return;
    const v = el.value;
    let matched = false;
    box.querySelectorAll('button[data-off]').forEach(b => {
        const off = b.dataset.off;
        if (off === 'pick') return;
        const d = new Date(); d.setDate(d.getDate() - Number(off));
        const on = formatLocal(d) === v;
        b.classList.toggle('active', on);
        if (on) matched = true;
    });
    const pick = box.querySelector('button[data-off="pick"]');
    if (pick) pick.classList.toggle('active', !matched && !!v);
    const lab = $('trans-date-chip-pick');
    if (lab) lab.textContent = (!matched && v) ? v.slice(5).replace('-', '月') + '日' : '选日期';
}

/* ═══════════ 三、保存并再记一笔 ═══════════ */
function submitTransAndContinue() {
    commitTransAmount();
    _transKeepOpen = true;
    const form = $('edit-transaction-form');
    if (form.requestSubmit) form.requestSubmit(); else $('edit-trans-submit-btn').click();
    // 如果校验没通过（表单没有触发 submit），标记要复位，免得影响下一次普通“保存”
    setTimeout(() => { _transKeepOpen = false; }, 0);
}

/* ═══════════ 四、备注联想（选中后只带出分类） ═══════════ */
let _descMatches = [];
let _descCloseTimer = null;
let _descIndexCache = { key: '', list: [] };

function _buildDescIndex(type) {
    const key = type + '|' + transactions.length + '|' + _statsDataVersion;
    if (_descIndexCache.key === key) return _descIndexCache.list;
    const map = new Map();
    transactions.forEach(t => {
        if (t.isTransfer || t.items || t._isBaseline || t.ownerName !== currentUserName || t.type !== type) return;
        const d = (t.desc || '').trim();
        if (!d) return;
        let e = map.get(d);
        if (!e) { e = { desc: d, count: 0, last: '', cats: {} }; map.set(d, e); }
        e.count++;
        if ((t.date || '') > e.last) e.last = t.date || '';
        if (t.category) e.cats[t.category] = (e.cats[t.category] || 0) + 1;
    });
    _descIndexCache = { key, list: [...map.values()] };
    return _descIndexCache.list;
}

function _bestCategoryOf(entry, type) {
    const valid = new Set(categories[type] || []);
    let best = '', n = 0;
    Object.entries(entry.cats).forEach(([c, k]) => { if (valid.has(c) && k > n) { best = c; n = k; } });
    return best;
}

function hideDescSuggest() {
    const ul = $('desc-suggest-list');
    if (ul) { ul.classList.remove('open'); ul.innerHTML = ''; }
    _descMatches = [];
}

function scheduleCloseDescSuggest() {
    clearTimeout(_descCloseTimer);
    _descCloseTimer = setTimeout(hideDescSuggest, 180);
}

function renderDescSuggest() {
    const ul = $('desc-suggest-list'), inp = $('edit-trans-desc');
    if (!ul || !inp) return;
    const q = inp.value.trim();
    if (!q || _inSplitMode || document.activeElement !== inp) { hideDescSuggest(); return; }
    const type = $('edit-trans-type').value || 'expense';
    const ql = q.toLowerCase();
    let list = _buildDescIndex(type).filter(e => e.desc.toLowerCase().includes(ql));
    if (list.length === 1 && list[0].desc === q) list = [];        // 已经输入完整的历史备注，不再提示
    list.sort((a, b) => {
        const pa = a.desc.toLowerCase().startsWith(ql) ? 0 : 1, pb = b.desc.toLowerCase().startsWith(ql) ? 0 : 1;
        return pa - pb || b.count - a.count || (b.last || '').localeCompare(a.last || '');
    });
    _descMatches = list.slice(0, 6);
    if (!_descMatches.length) { hideDescSuggest(); return; }
    ul.innerHTML = _descMatches.map((e, i) => {
        const cat = _bestCategoryOf(e, type);
        return `<li data-i="${i}"><span class="ds-text">${_escHtml(e.desc)}</span>`
             + `<span class="ds-meta">${cat ? _escHtml(cat) + ' · ' : ''}${e.count}次</span></li>`;
    }).join('');
    ul.classList.add('open');
}

function pickDescSuggestion(i) {
    const e = _descMatches[i];
    if (!e) return;
    const type = $('edit-trans-type').value || 'expense';
    $('edit-trans-desc').value = e.desc;
    const cat = _bestCategoryOf(e, type);
    if (cat) applyDescHint('edit-trans-category', cat);            // 只带出分类（不带标签、金额）
    hideDescSuggest();
    const hint = $('edit-trans-desc-hint'); if (hint) hint.style.display = 'none';
    $('edit-trans-desc').blur();
    amountPadShow();                                               // 备注选好了，回到数字键盘继续输入金额
}

// 备注输入框：原有“相似备注推荐分类”提示 + 新的联想下拉；下拉出现时不再同时显示那条提示
function onTransDescInput() {
    updateDescHint('edit-trans-desc', 'edit-trans-desc-hint', 'edit-trans-type', 'edit-trans-category', 'edit-trans-account');
    renderDescSuggest();
    if (_descMatches.length) { const hint = $('edit-trans-desc-hint'); if (hint) hint.style.display = 'none'; }
}

/* ═══════════ 五、打开弹窗时的初始化 ═══════════ */
// mode: 'add' | 'edit' | 'view'
function transFormUiInit(mode) {
    _padTempHidden = false;
    _padFresh = (mode === 'edit');                // 编辑已有交易：第一次按数字替换原金额
    _transKeepOpen = false;
    const again = $('edit-trans-save-again-btn');
    if (again) again.style.display = (mode === 'add') ? '' : 'none';
    hideDescSuggest();
    _updateExprHint();
    amountPadSync();
    syncDateChips();
}

document.addEventListener('DOMContentLoaded', () => {
    // 键盘按键（事件委托）。用 pointerdown 而不是 click：连续快速点按时更跟手，也避免 iOS 的 300ms 延迟/双击放大
    const kp = $('amount-keypad');
    if (kp) {
        kp.addEventListener('pointerdown', e => {
            const b = e.target.closest('button[data-k]');
            if (!b) return;
            e.preventDefault();
            amountPadPress(b.dataset.k);
        });
        kp.addEventListener('click', e => e.preventDefault());
    }
    // 备注联想：用 pointerdown 选择，避免先触发输入框失焦把列表关掉
    const ul = $('desc-suggest-list');
    if (ul) ul.addEventListener('pointerdown', e => {
        const li = e.target.closest('li[data-i]');
        if (!li) return;
        e.preventDefault();
        clearTimeout(_descCloseTimer);
        pickDescSuggestion(Number(li.dataset.i));
    });
    // 点了备注/标签等文本输入框（会弹系统键盘）时，临时收起数字键盘，免得和系统键盘叠在一起
    const form = $('edit-transaction-form');
    if (form) form.addEventListener('focusin', e => {
        const t = e.target;
        if (!t || t.id === 'edit-trans-amount') return;
        if ((t.tagName === 'INPUT' && (!t.type || t.type === 'text' || t.type === 'search')) || t.tagName === 'TEXTAREA') {
            _padTempHidden = true;
            amountPadSync();
        }
    });
});
