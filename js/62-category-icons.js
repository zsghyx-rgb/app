// @file js/62-category-icons.js
// 分类图标映射与分类网格、金额类型样式、币种符号、编辑表单分类联动、子弹窗关闭处理。

// ── 类别图标网格 ─────────────────────────────────────────────
const CATEGORY_ICON_MAP = {
    // ── 餐饮 ──
    '餐饮': { icon: 'bi-cup-hot-fill', color: 'var(--cat-orange)' },
    '早餐': { icon: 'bi-cup-hot-fill', color: 'var(--cat-orange)' },
    '午餐': { icon: 'bi-egg-fried', color: 'var(--cat-orange)' },
    '晚餐': { icon: 'bi-egg-fried', color: 'var(--cat-orange)' },
    '夜宵': { icon: 'bi-moon-stars-fill', color: 'var(--cat-purple)' },
    '外卖': { icon: 'bi-bicycle', color: 'var(--cat-orange)' },
    '聚餐': { icon: 'bi-people-fill', color: 'var(--cat-orange)' },
    '咖啡': { icon: 'bi-cup-straw', color: 'var(--cat-coffee)' },
    '奶茶': { icon: 'bi-cup-straw', color: 'var(--cat-pink)' },
    '烟酒': { icon: 'bi-cup-fill', color: 'var(--cat-gray)' },
    '零食': { icon: 'bi-egg-fried', color: 'var(--cat-orange)' },
    '水果': { icon: 'bi-basket3-fill', color: 'var(--cat-green)' },
    '蔬菜': { icon: 'bi-flower1', color: 'var(--cat-green)' },
    '生鲜': { icon: 'bi-basket-fill', color: 'var(--cat-green)' },
    '超市': { icon: 'bi-cart-fill', color: 'var(--cat-blue)' },

    // ── 交通出行 ──
    '交通': { icon: 'bi-bus-front-fill', color: 'var(--cat-cyan)' },
    '打车': { icon: 'bi-car-front-fill', color: 'var(--cat-cyan)' },
    '地铁': { icon: 'bi-train-front-fill', color: 'var(--cat-cyan)' },
    '公交': { icon: 'bi-bus-front-fill', color: 'var(--cat-cyan)' },
    '高铁': { icon: 'bi-train-front-fill', color: 'var(--cat-blue)' },
    '机票': { icon: 'bi-airplane-fill', color: 'var(--cat-cyan)' },
    '停车': { icon: 'bi-p-circle-fill', color: 'var(--cat-gray)' },
    '加油': { icon: 'bi-fuel-pump-fill', color: 'var(--cat-orange)' },
    '车辆保养': { icon: 'bi-tools', color: 'var(--cat-gray)' },
    '洗车': { icon: 'bi-car-front-fill', color: 'var(--cat-cyan)' },
    '共享单车': { icon: 'bi-bicycle', color: 'var(--cat-green)' },
    '旅行': { icon: 'bi-airplane-fill', color: 'var(--cat-cyan)' },
    '旅游': { icon: 'bi-airplane-fill', color: 'var(--cat-cyan)' },
    '度假': { icon: 'bi-umbrella-fill', color: 'var(--cat-cyan)' },
    '门票': { icon: 'bi-ticket-perforated-fill', color: 'var(--cat-orange)' },

    // ── 居住 ──
    '住房': { icon: 'bi-house-door-fill', color: 'var(--cat-indigo)' },
    '房租': { icon: 'bi-house-door-fill', color: 'var(--cat-indigo)' },
    '房贷': { icon: 'bi-bank', color: 'var(--cat-indigo)' },
    '物业费': { icon: 'bi-building', color: 'var(--cat-indigo)' },
    '装修': { icon: 'bi-hammer', color: 'var(--cat-gray)' },
    '家具': { icon: 'bi-house-gear-fill', color: 'var(--cat-indigo)' },
    '家电': { icon: 'bi-plug-fill', color: 'var(--cat-slate)' },
    '水电': { icon: 'bi-lightning-charge-fill', color: 'var(--cat-yellow)' },
    '水电煤': { icon: 'bi-lightning-charge-fill', color: 'var(--cat-yellow)' },
    '网费': { icon: 'bi-wifi', color: 'var(--cat-teal)' },
    '物业': { icon: 'bi-building', color: 'var(--cat-indigo)' },
    '日用品': { icon: 'bi-basket2-fill', color: 'var(--cat-blue)' },

    // ── 购物 ──
    '购物': { icon: 'bi-bag-fill', color: 'var(--cat-pink)' },
    '服饰': { icon: 'bi-handbag-fill', color: 'var(--cat-pink)' },
    '数码': { icon: 'bi-laptop', color: 'var(--cat-slate)' },
    '化妆品': { icon: 'bi-stars', color: 'var(--cat-pink)' },
    '美妆': { icon: 'bi-stars', color: 'var(--cat-pink)' },
    '母婴': { icon: 'bi-emoji-laughing-fill', color: 'var(--cat-orange)' },
    '宝宝用品': { icon: 'bi-emoji-laughing-fill', color: 'var(--cat-orange)' },
    '玩具': { icon: 'bi-controller', color: 'var(--cat-purple)' },

    // ── 娱乐 ──
    '娱乐': { icon: 'bi-controller', color: 'var(--cat-purple)' },
    '电影': { icon: 'bi-film', color: 'var(--cat-purple)' },
    'KTV': { icon: 'bi-mic-fill', color: 'var(--cat-pink)' },
    '演出': { icon: 'bi-music-note-beamed', color: 'var(--cat-purple)' },
    '游戏': { icon: 'bi-controller', color: 'var(--cat-purple)' },
    '订阅': { icon: 'bi-collection-play-fill', color: 'var(--cat-purple)' },
    '会员': { icon: 'bi-patch-check-fill', color: 'var(--cat-purple)' },

    // ── 医疗健康 ──
    '医疗': { icon: 'bi-heart-pulse-fill', color: 'var(--cat-red)' },
    '药品': { icon: 'bi-capsule', color: 'var(--cat-red)' },
    '体检': { icon: 'bi-clipboard2-pulse-fill', color: 'var(--cat-red)' },
    '牙医': { icon: 'bi-emoji-smile', color: 'var(--cat-red)' },
    '运动': { icon: 'bi-bicycle', color: 'var(--cat-green)' },
    '健身': { icon: 'bi-bicycle', color: 'var(--cat-green)' },
    '健身房': { icon: 'bi-trophy-fill', color: 'var(--cat-green)' },
    '瑜伽': { icon: 'bi-person-arms-up', color: 'var(--cat-green)' },
    '游泳': { icon: 'bi-water', color: 'var(--cat-cyan)' },
    '球类': { icon: 'bi-trophy-fill', color: 'var(--cat-green)' },
    '户外': { icon: 'bi-tree-fill', color: 'var(--cat-green)' },
    '登山': { icon: 'bi-tree-fill', color: 'var(--cat-green)' },
    '钓鱼': { icon: 'bi-water', color: 'var(--cat-cyan)' },
    '美容': { icon: 'bi-stars', color: 'var(--cat-pink)' },
    '美甲': { icon: 'bi-stars', color: 'var(--cat-pink)' },
    '理发': { icon: 'bi-scissors', color: 'var(--cat-pink)' },
    '护肤': { icon: 'bi-droplet-half', color: 'var(--cat-pink)' },

    // ── 教育学习 ──
    '教育': { icon: 'bi-mortarboard-fill', color: 'var(--cat-blue)' },
    '课程': { icon: 'bi-mortarboard-fill', color: 'var(--cat-blue)' },
    '培训': { icon: 'bi-easel2-fill', color: 'var(--cat-blue)' },
    '考试': { icon: 'bi-pencil-square', color: 'var(--cat-blue)' },
    '书籍': { icon: 'bi-book-fill', color: 'var(--cat-blue)' },
    '文具': { icon: 'bi-pencil-fill', color: 'var(--cat-blue)' },

    // ── 通讯数码 ──
    '通讯': { icon: 'bi-phone-fill', color: 'var(--cat-teal)' },
    '话费': { icon: 'bi-phone-fill', color: 'var(--cat-teal)' },

    // ── 人情往来 ──
    '人情': { icon: 'bi-gift-fill', color: 'var(--cat-pink)' },
    '红包': { icon: 'bi-gift-fill', color: 'var(--cat-red)' },
    '礼物': { icon: 'bi-gift-fill', color: 'var(--cat-pink)' },
    '慈善': { icon: 'bi-heart-fill', color: 'var(--cat-red)' },
    '捐款': { icon: 'bi-heart-fill', color: 'var(--cat-red)' },

    // ── 宠物 ──
    '宠物': { icon: 'bi-emoji-smile-fill', color: 'var(--cat-orange)' },
    '猫粮': { icon: 'bi-emoji-smile-fill', color: 'var(--cat-orange)' },
    '狗粮': { icon: 'bi-emoji-smile-fill', color: 'var(--cat-orange)' },
    '宠物医疗': { icon: 'bi-heart-pulse-fill', color: 'var(--cat-orange)' },

    // ── 金融与杂项支出 ──
    '保险': { icon: 'bi-shield-check', color: 'var(--cat-blue)' },
    '理财': { icon: 'bi-graph-up-arrow', color: 'var(--cat-green)' },
    '税费': { icon: 'bi-receipt-cutoff', color: 'var(--cat-gray)' },
    '罚款': { icon: 'bi-exclamation-octagon-fill', color: 'var(--cat-red)' },
    '手续费': { icon: 'bi-receipt', color: 'var(--cat-gray)' },
    '利息支出': { icon: 'bi-bank', color: 'var(--cat-gray)' },
    '违约金': { icon: 'bi-exclamation-octagon-fill', color: 'var(--cat-red)' },
    '快递': { icon: 'bi-box-seam-fill', color: 'var(--cat-orange)' },
    '维修': { icon: 'bi-tools', color: 'var(--cat-gray)' },
    '其他': { icon: 'bi-three-dots', color: 'var(--cat-gray)' },
    '未分类': { icon: 'bi-question-circle', color: 'var(--cat-gray)' },
    '余额调整': { icon: 'bi-sliders', color: 'var(--cat-gray)' },

    // ── 收入 ──
    '工资': { icon: 'bi-cash-coin', color: 'var(--cat-green)' },
    '兼职': { icon: 'bi-briefcase-fill', color: 'var(--cat-orange)' },
    '副业': { icon: 'bi-briefcase-fill', color: 'var(--cat-orange)' },
    '佣金': { icon: 'bi-briefcase-fill', color: 'var(--cat-green)' },
    '奖金': { icon: 'bi-trophy-fill', color: 'var(--cat-green)' },
    '年终奖': { icon: 'bi-trophy-fill', color: 'var(--cat-green)' },
    '投资': { icon: 'bi-graph-up-arrow', color: 'var(--cat-blue)' },
    '股息': { icon: 'bi-graph-up-arrow', color: 'var(--cat-blue)' },
    '基金': { icon: 'bi-graph-up-arrow', color: 'var(--cat-blue)' },
    '利息收入': { icon: 'bi-piggy-bank-fill', color: 'var(--cat-green)' },
    '房租收入': { icon: 'bi-house-door-fill', color: 'var(--cat-green)' },
    '礼金': { icon: 'bi-gift-fill', color: 'var(--cat-pink)' },
    '报销': { icon: 'bi-receipt', color: 'var(--cat-teal)' },
    '退款': { icon: 'bi-arrow-counterclockwise', color: 'var(--cat-teal)' },
    '中奖': { icon: 'bi-stars', color: 'var(--cat-orange)' },
    '补贴': { icon: 'bi-cash-coin', color: 'var(--cat-green)' },
    '稿费': { icon: 'bi-pencil-fill', color: 'var(--cat-green)' },
    '二手出售': { icon: 'bi-tag-fill', color: 'var(--cat-green)' },
    '众筹': { icon: 'bi-people-fill', color: 'var(--cat-green)' },
    '赔偿': { icon: 'bi-receipt', color: 'var(--cat-green)' },
    '继承': { icon: 'bi-bank', color: 'var(--cat-green)' },
};
const CAT_FALLBACK_PALETTE = ['var(--cat-blue)','var(--cat-green)','var(--cat-orange)','var(--cat-pink)','var(--cat-purple)','var(--cat-teal)','var(--cat-red)','var(--cat-gray)'];

// 分类色既可能是主题变量（var(--cat-blue)），也可能是用户自定义图标时选的十六进制色。
// 返回可用于 rgba(var(--cat-color-rgb), α) 的 "R,G,B" 或对应的 RGB 变量。
function _catColorRgbStr(color) {
    const varMatch = /^var\(--cat-([a-z-]+)\)$/.exec(color || '');
    if (varMatch) return `var(--cat-${varMatch[1]}-rgb)`;
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color || '');
    if (!m) return 'var(--app-primary-rgb)';
    return `${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}`;
}

function getCatIcon(name) {
    if (categoryIcons[name]) return categoryIcons[name];
    if (CATEGORY_ICON_MAP[name]) return CATEGORY_ICON_MAP[name];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return { icon: 'bi-tag-fill', color: CAT_FALLBACK_PALETTE[hash % CAT_FALLBACK_PALETTE.length] };
}

function catGridBuild(selectId, gridId) {
    const sel = $(selectId);
    const grid = $(gridId);
    if (!sel || !grid) return;
    grid.innerHTML = '';
    Array.from(sel.options).forEach((opt, i) => {
        const meta = getCatIcon(opt.value);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cat-grid-item' + (i === sel.selectedIndex ? ' selected' : '');
        btn.style.setProperty('--cat-color', meta.color);
        btn.style.setProperty('--cat-color-rgb', _catColorRgbStr(meta.color));
        btn.innerHTML = `<span class="cat-icon-circle"><i class="bi ${meta.icon}"></i></span><span class="cat-name">${opt.text}</span>`;
        btn.addEventListener('click', () => {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            catGridSync(selectId, gridId);
        });
        grid.appendChild(btn);
    });
}

function catGridSync(selectId, gridId) {
    const sel = $(selectId);
    const grid = $(gridId);
    if (!sel || !grid) return;
    grid.querySelectorAll('.cat-grid-item').forEach((el, i) => {
        el.classList.toggle('selected', i === sel.selectedIndex);
    });
}

// 金额输入框颜色随支出/收入变化
function updateAmountTypeClass(type) {
    [$('trans-amount-bar'), $('trans-amount-card')].forEach(el => {
        if (!el) return;
        el.classList.remove('amt-expense', 'amt-income');
        if (type === 'expense') el.classList.add('amt-expense');
        else if (type === 'income') el.classList.add('amt-income');
    });
}

// 金额前的货币符号随所选账户的币种变化
function updateAmountCurrencySymbol() {
    const accSel = $('edit-trans-account');
    const symEl = $('amount-currency-symbol');
    if (!accSel || !symEl) return;
    const acc = accounts.find(a => a.id == accSel.value);
    symEl.textContent = acc ? (CURRENCY_SYMBOLS[acc.currency] || acc.currency) : '¥';
}

// 转账 转出/转入 金额前的货币符号随各自所选账户的币种变化
function updateTransferCurrencySymbol(direction) {
    const selId = direction === 'out' ? 'edit-transfer-from' : 'edit-transfer-to';
    const symId = direction === 'out' ? 'transfer-currency-out' : 'transfer-currency-in';
    const accSel = $(selId);
    const symEl = $(symId);
    if (!accSel || !symEl) return;
    const acc = accounts.find(a => a.id == accSel.value);
    symEl.textContent = acc ? (CURRENCY_SYMBOLS[acc.currency] || acc.currency) : '¥';
}




function updateEditFormCategories() {
    const type = $('edit-trans-type').value;
    const catSelect = $('edit-trans-category');
    catSelect.innerHTML = '';
    (type === 'expense' ? categories.expense : categories.income).forEach(c => catSelect.add(new Option(c, c)));
    catGridBuild('edit-trans-category', 'cat-grid-edit-trans-category');
    updateAmountTypeClass(type);
    // 附件区域和相机按钮只在支出时显示
    const attachSec = $('attachment-section');
    const attachBtn = $('attachment-btn');
    const isExpense = type === 'expense';
    if (attachSec) attachSec.style.display = isExpense ? '' : 'none';
    if (attachBtn) attachBtn.style.display = isExpense ? '' : 'none';
}

// 编辑弹窗关闭时：若来自账户详情，刷新详情视图
function onSubModalHide() {
    const hintEl = $('edit-trans-desc-hint');
    if (hintEl) hintEl.style.display = 'none';
    resetAttachmentUI();
    // 重置拆分状态
    if (_inSplitMode) exitSplitMode();
    _splitData = [];
    // 重置只读状态（覆盖收/支/转账三个表单，避免下次新增时残留禁用态）
    $('editTransactionModal').querySelectorAll('input,select,textarea').forEach(el => { el.disabled = false; });
    $('editTransactionModal').querySelector('.trans-modal-v2')?.classList.remove('view-only');
    $('edit-trans-submit-btn').style.display = '';
    $('edit-transfer-submit-btn').style.display = '';
    $('edit-trans-delete-btn').style.setProperty('display','none','important');
    $('edit-transfer-delete-btn').style.setProperty('display','none','important');
    $('edit-trans-submit-btn').textContent = '保存';
    $('edit-transfer-submit-btn').textContent = '保存';
    // 确保单笔区域可见
    const singleRow = $('single-item-row');
    const metaSec = $('single-meta-section');
    if (singleRow) singleRow.style.display = '';
    if (metaSec) metaSec.style.display = '';
    maybeReturnToDetail();
    if (_fromChartDrawer && _chartDrawerData) {
        _fromChartDrawer = false;
        setTimeout(function() { showChartDrawer(_chartDrawerData.title, _chartDrawerData.txList); }, 100);
    }
}
