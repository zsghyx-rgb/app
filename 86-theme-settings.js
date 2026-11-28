// @file js/86-theme-settings.js
// 三套主题（clean / cute / finance）× 浅色/深色。设置页切换、持久化到本机 localStorage、
// 更新 meta theme-color、同步 Chart.js 默认颜色，并在主题变化后重建图表。

const APP_THEMES = ['clean', 'cute', 'finance'];
const APP_COLOR_MODES = ['auto', 'light', 'dark'];
const APP_THEME_LABELS = { clean: '简洁清爽', cute: '可爱活泼', finance: '深色金融' };
const APP_THEME_BG = {
    clean:   { light: '#F6F7F9', dark: '#0F1115' },
    cute:    { light: '#FFF7EC', dark: '#1E1712' },
    finance: { light: '#F4F5F8', dark: '#0E1320' }
};

function _storageGet(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
}
function _storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
}

function getAppTheme() {
    const v = _storageGet('APP_app_theme', 'clean');
    return APP_THEMES.includes(v) ? v : 'clean';
}

function getColorMode() {
    const v = _storageGet('APP_color_mode', 'auto');
    return APP_COLOR_MODES.includes(v) ? v : 'auto';
}

function _systemPrefersDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (_) { return false; }
}

function resolveColorMode(mode) {
    const m = mode || getColorMode();
    return m === 'dark' || (m === 'auto' && _systemPrefersDark());
}

function _updateThemeMeta(theme, dark) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const bg = (APP_THEME_BG[theme] || APP_THEME_BG.clean)[dark ? 'dark' : 'light'];
    meta.setAttribute('content', bg);
}

/** 三个主题文件共用同一套 DOM；这里只切换 html 属性，CSS 变量会自动接管全部颜色。 */
function applyAppTheme(theme, mode, opts) {
    theme = APP_THEMES.includes(theme) ? theme : 'clean';
    mode = APP_COLOR_MODES.includes(mode) ? mode : 'auto';
    const dark = mode === 'dark' || (mode === 'auto' && _systemPrefersDark());
    const root = document.documentElement;
    root.setAttribute('data-app-theme', theme);
    root.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
    window.__APP_THEME__ = { theme: theme, mode: mode, dark: dark };
    _updateThemeMeta(theme, dark);
    renderThemeSettings();
    applyChartThemeDefaults();
    if (!opts || opts.refreshCharts !== false) refreshChartsForTheme();
}

function setAppTheme(theme) {
    if (!APP_THEMES.includes(theme)) return;
    _storageSet('APP_app_theme', theme);
    applyAppTheme(theme, getColorMode());
    if (typeof showToast === 'function') {
        showToast(`已切换为「${APP_THEME_LABELS[theme] || theme}」主题`, 'success', 1600);
    }
}

function setColorMode(mode) {
    if (!APP_COLOR_MODES.includes(mode)) return;
    _storageSet('APP_color_mode', mode);
    applyAppTheme(getAppTheme(), mode);
}

function renderThemeSettings() {
    const theme = getAppTheme();
    const mode = getColorMode();
    document.querySelectorAll('#theme-pick-grid .theme-pick').forEach(el => {
        const on = el.dataset.theme === theme;
        el.classList.toggle('selected', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('#appearance-seg button').forEach(el => {
        const on = el.dataset.mode === mode;
        el.classList.toggle('selected', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (typeof syncBarRefreshResetUI === 'function') syncBarRefreshResetUI();   // 同步提示位置：默认 / 自定义
}

// ── Chart.js 主题 ────────────────────────────────────────────
function getChartTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => {
        const raw = cs.getPropertyValue(name);
        return (raw && raw.trim()) || fallback;
    };
    return {
        text: v('--app-text', '#171B24'),
        muted: v('--app-muted', '#6B7280'),
        grid: v('--app-border', '#E5E8EF'),
        primary: v('--app-primary', '#2F6BFF'),
        income: v('--app-income', '#0E9F6E'),
        expense: v('--app-expense', '#E5484D'),
        transfer: v('--app-transfer', '#E8890C'),
        surface: v('--app-surface', '#FFFFFF'),
        font: v('--app-font', '-apple-system, "PingFang SC", sans-serif')
    };
}

/** 把 #RRGGBB 转成 rgba()；不是 6 位 hex 时原样返回。 */
function chartAlpha(color, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(color || '').trim());
    if (!m) return color;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

function applyChartThemeDefaults() {
    if (typeof Chart === 'undefined') return;
    const t = getChartTheme();
    Chart.defaults.color = t.muted;
    Chart.defaults.borderColor = t.grid;
    Chart.defaults.font.family = t.font;
    if (Chart.defaults.plugins && Chart.defaults.plugins.legend && Chart.defaults.plugins.legend.labels) {
        Chart.defaults.plugins.legend.labels.color = t.text;
    }
    if (Chart.defaults.plugins && Chart.defaults.plugins.tooltip) {
        Chart.defaults.plugins.tooltip.backgroundColor = t.surface;
        Chart.defaults.plugins.tooltip.titleColor = t.text;
        Chart.defaults.plugins.tooltip.bodyColor = t.text;
        Chart.defaults.plugins.tooltip.borderColor = t.grid;
        Chart.defaults.plugins.tooltip.borderWidth = 1;
    }
}

/** 主题变化后旧图表的颜色不会自动变，统一销毁并在统计页可见时重画。 */
function refreshChartsForTheme() {
    if (typeof chartInstances === 'undefined') return;
    Object.keys(chartInstances).forEach(key => {
        try { chartInstances[key].destroy(); } catch (_) {}
        delete chartInstances[key];
    });
    if (typeof _statsRenderedKey !== 'undefined') _statsRenderedKey = '';
    const statsVisible = document.getElementById('view-stats')?.classList.contains('active-view');
    if (statsVisible && typeof renderStats === 'function') {
        requestAnimationFrame(() => renderStats());
    }
}

// 跟随系统：只有“外观 = 跟随系统”时才响应系统深浅色变化
(function watchSystemColorScheme() {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
        if (getColorMode() !== 'auto') return;
        applyAppTheme(getAppTheme(), 'auto');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
})();

document.addEventListener('DOMContentLoaded', () => {
    // 内联脚本已经写好属性；这里补齐 Chart 默认色与设置页选中态
    applyChartThemeDefaults();
    renderThemeSettings();
});
