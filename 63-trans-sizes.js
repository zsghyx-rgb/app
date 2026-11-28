// @file js/63-trans-sizes.js
// 新增/编辑「支出·收入」窗口的大小自定义：分类每行个数、分类图标大小、键盘按键高度。
// 经典、紧凑两种样式各记一套（默认值不同）；设置 › 外观与主题 › 记账窗口样式 里的滑块改的是“当前选中的样式”那一套。
// 只保存在本机 localStorage，不进同步数据。写成 <html> 上的 CSS 变量，css/40、css/45 读取时都带默认值，所以没设置也正常。

const TRANS_SIZE_KEY = 'APP_trans_sizes';        // { classic: {cols?, icon?, key?}, compact: {...} }，只存用户动过的项，没动过的跟着默认值走
const TRANS_SIZE_DEF = {
    cols: { def: { classic: 4,  compact: 4  }, min: 3,  max: 6,  step: 1, cssVar: '--trans-cat-cols', unit: '',   label: '个' },
    icon: { def: { classic: 40, compact: 56 }, min: 32, max: 72, step: 2, cssVar: '--trans-cat-icon', unit: 'px', label: 'px' },
    key:  { def: { classic: 48, compact: 48 }, min: 36, max: 72, step: 2, cssVar: '--trans-key-h',    unit: 'px', label: 'px' }
};

function _transSizeLayout() {
    return document.documentElement.getAttribute('data-trans-layout') === 'compact' ? 'compact' : 'classic';
}

function _transSizeClamp(k, v, layout) {
    const d = TRANS_SIZE_DEF[k]; v = Math.round(Number(v));
    if (!isFinite(v)) return d.def[layout];
    return Math.min(d.max, Math.max(d.min, v));
}

function _transSizeRaw() {
    try {
        const r = JSON.parse(localStorage.getItem(TRANS_SIZE_KEY) || '{}');
        return r && typeof r === 'object' ? r : {};
    } catch (_) { return {}; }
}

/** 某个样式（默认当前样式）的三项大小：用户设置过的取设置值（夹到范围内），否则取默认值 */
function getTransSizes(layout) {
    layout = layout || _transSizeLayout();
    const mine = _transSizeRaw()[layout];
    const raw = mine && typeof mine === 'object' ? mine : {};
    const out = {};
    Object.keys(TRANS_SIZE_DEF).forEach(k => { out[k] = raw[k] == null ? TRANS_SIZE_DEF[k].def[layout] : _transSizeClamp(k, raw[k], layout); });
    return out;
}

/** 把当前样式的三项大小写到 <html> 的 CSS 变量上（切换样式、启动时都会调用） */
function applyTransSizes() {
    const st = document.documentElement && document.documentElement.style;
    if (!st || !st.setProperty) return;
    const sz = getTransSizes();
    Object.keys(TRANS_SIZE_DEF).forEach(k => st.setProperty(TRANS_SIZE_DEF[k].cssVar, sz[k] + TRANS_SIZE_DEF[k].unit));
}

/** 设置页：滑块的范围 / 当前值 / 数字，以及标题里的样式名 */
function renderTransSizeSettings() {
    const layout = _transSizeLayout(), sz = getTransSizes(layout);
    const title = $('trans-size-title');
    if (title) title.textContent = (layout === 'compact' ? '紧凑' : '经典') + '样式的大小';
    Object.keys(TRANS_SIZE_DEF).forEach(k => {
        const d = TRANS_SIZE_DEF[k], inp = $('trans-size-' + k), val = $('trans-size-' + k + '-val');
        if (inp) { inp.min = d.min; inp.max = d.max; inp.step = d.step; inp.value = sz[k]; }
        if (val) val.textContent = sz[k] + ' ' + d.label;
    });
}

function setTransSize(k, v) {
    if (!TRANS_SIZE_DEF[k]) return;
    const layout = _transSizeLayout(), raw = _transSizeRaw();
    if (!raw[layout] || typeof raw[layout] !== 'object') raw[layout] = {};
    raw[layout][k] = _transSizeClamp(k, v, layout);
    try { localStorage.setItem(TRANS_SIZE_KEY, JSON.stringify(raw)); } catch (_) {}
    applyTransSizes(); renderTransSizeSettings();
}

/** 恢复默认：只恢复当前样式那一套，另一个样式的设置不动 */
function resetTransSizes() {
    const layout = _transSizeLayout(), raw = _transSizeRaw();
    delete raw[layout];
    try {
        if (Object.keys(raw).length) localStorage.setItem(TRANS_SIZE_KEY, JSON.stringify(raw));
        else localStorage.removeItem(TRANS_SIZE_KEY);
    } catch (_) {}
    applyTransSizes(); renderTransSizeSettings();
    if (typeof showToast === 'function') showToast(`已恢复${layout === 'compact' ? '紧凑' : '经典'}样式的默认大小`, 'success', 1400);
}

document.addEventListener('DOMContentLoaded', () => {
    try { applyTransSizes(); renderTransSizeSettings(); } catch (e) { console.error('[trans-sizes] 应用尺寸设置失败', e); }
});
