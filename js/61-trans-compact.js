// @file js/61-trans-compact.js
// 新增/编辑「支出·收入」的紧凑布局（可选；设置 › 外观与主题 › 记账窗口样式；默认经典；只保存在本机）。
//
// 做法：不复制任何业务逻辑。紧凑布局只是把【现有的】账户下拉、日期触发器、快捷日期、标签输入、备注输入、金额卡片、
// 附件区、页签栏这些节点用 appendChild 搬进 index.html 里预先放好的新容器（#tmc-bar / #tmc-tagrow / #tmc-memo-wrap …），
// 在原位置留一个注释节点做占位，切回经典布局时按占位原路搬回。节点 id、事件、校验、保存逻辑全部不变。
// 样式见 css/45-trans-compact.css（全部限定在 html[data-trans-layout="compact"] 之下）。
// 任何一步出错：自动搬回、退回经典布局，并提示。
//
// 经典布局下本文件几乎不做事：只有设置页的选项、以及几个 tmcOn() 为 false 就立刻返回的钩子。

const TRANS_LAYOUT_KEY = 'APP_trans_layout';          // 'classic'（默认）| 'compact'
const TMC_LAYOUTS = ['classic', 'compact'];
let _tmcMoves = [];            // [{ node, ph }]：被搬走的节点和它原位置的占位注释
let _tmcMounted = false;

function getTransLayout() {
    try { const v = localStorage.getItem(TRANS_LAYOUT_KEY); return TMC_LAYOUTS.includes(v) ? v : 'classic'; }
    catch (_) { return 'classic'; }
}

/** 紧凑布局是否正在生效（DOM 已搬好、且属性已打开） */
function tmcOn() {
    return _tmcMounted && document.documentElement.getAttribute('data-trans-layout') === 'compact';
}

/* ═══════════ 一、搬运 DOM ═══════════ */
function _tmcMove(node, target, beforeNode) {
    if (!node || !target || !node.parentNode) throw new Error('紧凑布局：找不到要搬的节点');
    const ph = document.createComment('tmc');
    node.parentNode.insertBefore(ph, node);
    if (beforeNode) target.insertBefore(node, beforeNode); else target.appendChild(node);
    _tmcMoves.push({ node, ph });
}

function tmcMount() {
    if (_tmcMounted) return;
    const modal = $('editTransactionModal');
    const header = modal && modal.querySelector('.modal-header');
    if (!modal || !header) throw new Error('紧凑布局：找不到记账窗口');
    const tagPill = $('tmc-tag-pill');
    _tmcMove($('trans-tab-bar'), header, header.firstChild);                              // 页签并入标题栏
    _tmcMove($('wrap-edit-trans-account'), $('tmc-bar'), tagPill);                        // 账户（现有下拉）→ 胶囊
    _tmcMove(modal.querySelector('.tm-row-card .tm-date-trigger'), $('tmc-bar'), tagPill);// 日期触发器 → 胶囊
    _tmcMove($('trans-date-chips'), $('tmc-pop-date'));                                   // 今天/昨天/前天/选日期 → 日期面板
    _tmcMove($('edit-trans-date'), $('trans-date-chips'));                                // 真正的日期输入框 → 盖在“选日期”按钮上（css/45），点它就是原生点击
    _tmcMove($('attachment-section'), $('tmc-pop-att'));                                  // 附件区 → 图片面板
    _tmcMove($('tags-collapse-wrap'), $('tmc-tagrow'), $('tmc-tag-ok'));                  // 标签输入 → 标签输入行
    _tmcMove(modal.querySelector('#single-meta-section .desc-suggest-wrap'), $('tmc-memo-left'));  // 备注（含联想）
    _tmcMove($('edit-trans-desc-hint'), $('tmc-hint'));                                   // “相似备注推荐分类”提示
    _tmcMove($('trans-amount-card'), $('tmc-memo-right'));                                // 金额 → 备注右侧
    _tmcMounted = true;
}

function tmcUnmount() {
    for (let i = _tmcMoves.length - 1; i >= 0; i--) {
        const { node, ph } = _tmcMoves[i];
        if (ph.parentNode) { ph.parentNode.insertBefore(node, ph); ph.parentNode.removeChild(ph); }
    }
    _tmcMoves = [];
    _tmcMounted = false;
}

/* ═══════════ 二、切换布局 ═══════════ */
function applyTransLayout(layout) {
    layout = layout === 'compact' ? 'compact' : 'classic';
    if (layout === 'compact') {
        try { tmcMount(); }
        catch (e) {
            console.error('[tmc] 紧凑布局挂载失败，退回经典布局', e);
            try { tmcUnmount(); } catch (_) {}
            layout = 'classic';
            if (typeof showToast === 'function') showToast('紧凑布局加载失败，已使用经典布局', 'error', 4000);
        }
    } else {
        try { tmcUnmount(); } catch (e) { console.error('[tmc] 还原失败', e); }
    }
    document.documentElement.setAttribute('data-trans-layout', layout);
    renderTransLayoutSettings();
    try { applyTransSizes(); renderTransSizeSettings(); } catch (e) { console.error('[tmc] 应用尺寸设置失败', e); }   // 两种样式各有一套大小，js/63-trans-sizes.js
    if (layout === 'compact') tmcSync();
    return layout;
}

function setTransLayout(layout) {
    if (!TMC_LAYOUTS.includes(layout)) return;
    const modal = $('editTransactionModal');
    if (modal && modal.classList.contains('show')) return;      // 记账窗口开着时不切换（设置页里不会发生，保险）
    const real = applyTransLayout(layout);
    try { localStorage.setItem(TRANS_LAYOUT_KEY, real); } catch (_) {}
    if (typeof showToast === 'function') showToast(`已切换为「${real === 'compact' ? '紧凑' : '经典'}」记账窗口`, 'success', 1600);
}

function renderTransLayoutSettings() {
    const cur = document.documentElement.getAttribute('data-trans-layout') || 'classic';
    document.querySelectorAll('#trans-layout-seg button').forEach(el => {
        const on = el.dataset.layout === cur;
        el.classList.toggle('selected', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

/* ═══════════ 三、状态同步（胶囊文字、拆分按钮） ═══════════
 * 由 amountPadSync / renderAttachmentThumbs / resetAttachmentUI / exitSplitMode 调用；经典布局下立刻返回。 */
function _tmcAttachmentCount() {
    const v = ($('edit-trans-attachment-id') && $('edit-trans-attachment-id').value) || '';
    return v.split(',').filter(x => x.trim()).length;
}

function tmcSync() {
    if (!tmcOn()) return;
    const form = $('edit-transaction-form');
    if (!form) return;
    const content = $('editTransactionModal').querySelector('.trans-modal-v2');
    const viewOnly = !!(content && content.classList.contains('view-only'));
    const mode = ($('edit-trans-mode') && $('edit-trans-mode').value) || 'add';
    const formVisible = form.style.display !== 'none';

    // 标题栏右侧的“拆分”：只在支出表单、非拆分状态、非只读时出现（沿用原来 #split-toggle-btn 的显示规则）
    const sb = $('tmc-split-btn'), orig = $('split-toggle-btn');
    const canSplit = formVisible && !viewOnly && mode !== 'view' && !_inSplitMode && orig && orig.style.display !== 'none';
    if (sb) sb.style.display = canSplit ? '' : 'none';

    // 标签胶囊：有内容就显示内容
    const tags = (($('edit-trans-tags') && $('edit-trans-tags').value) || '').trim();
    const tagPill = $('tmc-tag-pill'), tagText = $('tmc-tag-text');
    if (tagText) tagText.textContent = tags || '标签';
    if (tagPill) tagPill.classList.toggle('on', !!tags);
    if (tagPill) tagPill.classList.toggle('open', !!$('tmc-tagrow') && $('tmc-tagrow').classList.contains('open'));

    // 图片胶囊：只在支出里出现（沿用 #attachment-section 的显示规则）；有附件显示“N 张”
    const attSec = $('attachment-section'), attPill = $('tmc-att-pill'), attText = $('tmc-att-text');
    const n = _tmcAttachmentCount();
    if (attPill) {
        const show = !!attSec && attSec.style.display !== 'none' && formVisible && (!viewOnly || n > 0);
        attPill.style.display = show ? '' : 'none';
        attPill.classList.toggle('on', n > 0);
        attPill.classList.toggle('open', !!$('tmc-pop-att') && $('tmc-pop-att').classList.contains('open'));
        if (attText) attText.textContent = n > 0 ? `${n} 张` : '图片';
    }
}

/* ═══════════ 四、胶囊 / 面板交互 ═══════════ */
function tmcClosePops() {
    ['tmc-pop-date', 'tmc-pop-att'].forEach(id => { const el = $(id); if (el) el.classList.remove('open'); });
    const dt = document.querySelector('#tmc-bar .tm-date-trigger');
    if (dt) dt.classList.remove('open');
    tmcSync();
}

function tmcTogglePop(which) {
    const id = which === 'date' ? 'tmc-pop-date' : 'tmc-pop-att';
    const el = $(id);
    if (!el) return;
    const willOpen = !el.classList.contains('open');
    tmcClosePops();
    if (typeof accSelectClose === 'function') accSelectClose('edit-trans-account');
    if (willOpen) {
        el.classList.add('open');
        if (which === 'date') { const dt = document.querySelector('#tmc-bar .tm-date-trigger'); if (dt) dt.classList.add('open'); if (typeof syncDateChips === 'function') syncDateChips(); }
    }
    tmcSync();
}

function tmcOpenTagRow() {
    const row = $('tmc-tagrow'), inp = $('edit-trans-tags');
    if (!row || !inp || inp.disabled) return;
    row.classList.add('open');
    tmcSync();
    inp.focus();
}

function tmcCloseTagRow() {
    const row = $('tmc-tagrow');
    if (row) row.classList.remove('open');
    tmcSync();
}

/* ═══════════ 五、系统键盘弹出时：弹窗缩到键盘上方 ═══════════
 * iOS 的 100dvh 不随键盘变化。用 visualViewport 估算键盘高度，写进 --tmc-kb，由 css/45 把弹窗高度减掉，
 * 分类区（弹性）自动变矮，备注/金额行留在键盘上方。尽力而为：没有 visualViewport 或算不出来就保持原行为。 */
function tmcOnViewport() {
    if (!tmcOn()) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    const modal = $('editTransactionModal');
    if (!vv || !modal || !modal.classList.contains('show')) { _tmcKeyboard(root, 0, 0); return; }
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    _tmcKeyboard(root, kb > 120 ? kb : 0, vv.offsetTop);
}
function _tmcKeyboard(root, kb, top) {
    if (kb > 0) {
        root.style.setProperty('--tmc-kb', kb + 'px');
        root.style.setProperty('--tmc-vtop', Math.round(top) + 'px');
        root.classList.add('tmc-kb');
        root.classList.toggle('tmc-pan', top > 1);
    } else {
        root.classList.remove('tmc-kb', 'tmc-pan');
        root.style.removeProperty('--tmc-kb');
        root.style.removeProperty('--tmc-vtop');
    }
}

/* ═══════════ 六、初始化 ═══════════ */
function tmcInitEvents() {
    const bar = $('tmc-bar'), form = $('edit-transaction-form'), modal = $('editTransactionModal');
    if (!bar || !form || !modal) return;

    // 日期胶囊：点它展开快捷日期面板（不再直接弹系统日期选择器）。用捕获阶段拦截，原来 onclick 里的 showPicker 就不会执行；
    // “选日期”仍然调用原来的 pickTransDate()
    bar.addEventListener('click', e => {
        if (!tmcOn()) return;
        const dt = e.target.closest('.tm-date-trigger');
        if (dt && !e.target.closest('#tmc-pop-date')) { e.stopPropagation(); e.preventDefault(); tmcTogglePop('date'); }
    }, true);
    bar.addEventListener('click', e => { if (tmcOn() && e.target.closest('.tm-acc-trigger')) tmcClosePops(); });   // 点账户：收起面板
    // 点 今天 / 昨天 / 前天：选完收起面板。“选日期”由透明的日期输入框接管（原生点击），不在这里收起——
    // 面板一隐藏，iOS 的日期滚轮可能跟着消失；等输入框失焦（选完）再收起，收不起来点别处也会收起
    $('tmc-pop-date').addEventListener('click', e => {
        const b = e.target.closest('button[data-off]');
        if (b && b.dataset.off !== 'pick') setTimeout(tmcClosePops, 0);
    });
    const dateInp = $('edit-trans-date');
    if (dateInp) dateInp.addEventListener('focusout', () => setTimeout(() => {
        if (tmcOn() && document.activeElement !== dateInp) tmcClosePops();
    }, 200));

    // 标签胶囊 → 展开输入行并聚焦；输入行的 ✓ / 回车 / 失焦 → 收起，胶囊显示内容
    $('tmc-tag-pill').addEventListener('click', () => { if (!tmcOn()) return; tmcClosePops(); tmcOpenTagRow(); });
    const tagInp = $('edit-trans-tags');
    if (tagInp) {
        tagInp.addEventListener('input', () => tmcSync());
        tagInp.addEventListener('keydown', e => { if (tmcOn() && e.key === 'Enter') { e.preventDefault(); tagInp.blur(); } });
        tagInp.addEventListener('focusout', () => setTimeout(() => { if (tmcOn() && document.activeElement !== tagInp) tmcCloseTagRow(); }, 160));
    }
    $('tmc-tag-ok').addEventListener('pointerdown', e => { e.preventDefault(); if (tagInp) tagInp.blur(); tmcCloseTagRow(); });

    // 图片胶囊 → 还没有附件：直接选文件；已有附件：展开面板（缩略图 / 删除 / 继续添加）
    const att = $('tmc-att-pill');
    const onAtt = () => {
        if (!tmcOn()) return;
        const content = modal.querySelector('.trans-modal-v2');
        const viewOnly = !!(content && content.classList.contains('view-only'));
        if (_tmcAttachmentCount() === 0 && !viewOnly) { tmcClosePops(); const f = $('attachment-file-input'); if (f) f.click(); }
        else tmcTogglePop('att');
    };
    att.addEventListener('click', onAtt);
    att.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAtt(); } });

    // 点别处：收起面板
    document.addEventListener('click', e => { if (tmcOn() && !e.target.closest('#tmc-bar')) tmcClosePops(); });

    // 关窗：收起面板、标签行、键盘高度
    modal.addEventListener('hidden.bs.modal', () => {
        ['tmc-pop-date', 'tmc-pop-att'].forEach(id => { const el = $(id); if (el) el.classList.remove('open'); });
        const row = $('tmc-tagrow'); if (row) row.classList.remove('open');
        _tmcKeyboard(document.documentElement, 0, 0);
        tmcSync();
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', tmcOnViewport);
        window.visualViewport.addEventListener('scroll', tmcOnViewport);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try { tmcInitEvents(); } catch (e) { console.error('[tmc] 初始化事件失败', e); }
    applyTransLayout(getTransLayout());
});
