// @file js/10-config-state.js
// 全局常量与状态变量(账户/交易/分类/汇率/预算…)、$ 选择器、APP_VERSION、本地存储键清理。

const DEFAULT_CATEGORIES = {
    expense: ['餐饮', '交通', '住房', '购物', '娱乐', '医疗'],
    income: ['工资', '投资', '兼职', '礼金', '其他']
};

const DEFAULT_RATES = { 'EUR_RMB': 7.8, 'USD_RMB': 7.2, 'HKD_RMB': 0.92, 'JPY_RMB': 0.048, 'GBP_RMB': 9.1 };

// GAS_URL 不再硬编码，从 localStorage 读取，首次使用时在登录界面填写
let GAS_URL = localStorage.getItem('APP_gas_url') || '';
// 详细同步通知开关（默认关闭，减少打扰）
let verboseToast = true;   // 始终显示详细操作提示（不再提供关闭入口）
let GAS_TOKEN = localStorage.getItem('APP_gas_token') || '';
const CURRENCY_SYMBOLS = { 'RMB': '¥', 'EUR': '€', 'USD': '$', 'HKD': 'HK$', 'JPY': '¥', 'GBP': '£' };


let inMemoryLoadedData = null;
let userPassword = '';          // 用户输入的密码
let dataUsers = [];             // 从数据文件读取的用户列表
let userPins = {};              // 用户登录 PIN（可选）：{ 用户名: { salt, hash } }，随数据文件同步
let accounts = [];
let transactions = [];
let plannedTransactions = [];
let userAccounts = [];
let userTransactions = [];
let userPlannedTransactions = [];
let categories = {};
let exchangeRates = {};
let budgets = [];                // 预算列表：[{id, category:'__total__'|分类名, amount}]
let categoryIcons = {};          // 自定义分类图标：{ 分类名: { icon: 'bi-xxx', color: '#xxxxxx' } }

let currentUser = null;
let currentUserName = null;
let hasUnsavedChanges = false;
let driveAutoSaveTimer = null;   // 防抖计时器
let _lastTransPrefs = {};        // 上次新增交易的选项（仅本次会话有效）
let _configUpdatedAt = Date.now(); // 配置块（分类/图标/预算/汇率）最后修改时间，用于同步合并冲突
function markConfigUpdated() { _configUpdatedAt = Date.now(); }
let _toastTimer = null;          // toast 自动消失计时器
let _barBusy = null;             // 底部同步状态条：{msg, at}，来自 showToast(..., 'syncing')
let _barError = null;            // {msg, retry}，来自 showToast(..., 'error', 0)
let _barOkUntil = 0;             // “已同步”短暂显示到什么时候
let _barOkText = '';             // 状态条在“已同步”状态下显示的文字（如“已同步 3 条新数据”）
let _barKey = '';                // 上次渲染的状态指纹（没变化就不动 DOM）
let driveIsSyncing = false;      // 防并发
let offlineMode = localStorage.getItem('APP_offline_mode') === 'true'; // 离线模式（只读本机缓存）

let chartInstances = {};
// 图表缓存：同一份数据再次进入统计页时不再重复计算/重建图表
let _statsRenderedKey = '';
let _netWorthCache = null;
let _statsRenderRaf = 0;
// 统计页按需计算缓存：当筛选条件、汇率、数据版本均未变化时，跳过重复的过滤与汇总计算
let _statsDataVersion = 0;
let _statsCache = null;
let currentStatsFilter = { startDate: '', endDate: '', currency: localStorage.getItem('APP_stats_currency') || 'RMB', user: localStorage.getItem('APP_stats_user') || 'all' };
// 月导航状态（'month' = 单月模式，'range' = 快速范围/自定义模式）
let statsNavYear  = new Date().getFullYear();
let statsNavMonth = new Date().getMonth(); // 0-indexed
let statsNavMode  = 'month';
let currentSortField = 'date';
let currentSortDirection = 'desc';
// 金额显示三态（不记住，刷新后恢复显示）：amountsHidden = 明细金额(各账户余额/每笔交易/每日合计)，summaryHidden = 页面顶部汇总金额
let amountsHidden = false;
let summaryHidden = false;
let searchDebounceTimer = null;
let displayedTransactionCount = 100;
let currentAssetAggregation = 'month';
let transactionDisplayMode = localStorage.getItem('APP_trans_display_mode') || 'all';
let currentUserFilterValue = localStorage.getItem('APP_trans_user_filter') || 'all';

// 清理已移除功能（AI / 设备昵称 / 旧整包同步）遗留在本机的配置
['ai_api_url', 'ai_api_key', 'ai_model', 'APP_device_name', 'APP_backend', 'APP_drive_version'].forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
const APP_VERSION = '5.0.8';

// ── 数据同步相关日期常量 ──────────────────────────────────────
// 约束：STALE_CACHE_DAYS（本地缓存过期天数）必须 ≤ DELETED_LOG_RETENTION_DAYS（删除日志保留天数），
// 建议 ≤ 一半，留安全边际。否则会出现"删除记录已失效但设备缓存还没刷新"的
// 空窗期，导致已删除的数据在同步时被误判为新数据而复活。
const DELETED_LOG_RETENTION_DAYS = 30; // deletedLog 条目保留天数（防止已删数据被合并复活）
const STALE_CACHE_DAYS = 10; // 本地缓存过期天数：超过此天数未同步则强制从云端拉取最新数据

// 标签建议下拉：只显示最近 N 天内发生过的交易所带的标签（按交易日期 t.date 判断，而非编辑时间）
const RECENT_TAGS_WINDOW_DAYS = 180; // 约半年
const $ = id => document.getElementById(id);
const $$ = selector => document.querySelectorAll(selector);

// 金额类输入框统一用 type="text"，这里做实时清洗：
// 支持德语等用 "," 作小数点的系统直接输入逗号，自动转成 "."；
// 同时过滤非数字字符，只保留一个小数点，并限制小数位数（默认2位，可用 data-max-decimals 覆盖，如汇率用4位）。
// 用捕获阶段保证比元素自身的 oninput 先执行。
document.addEventListener('input', function (e) {
    const el = e.target;
    if (!el.classList || !el.classList.contains('decimal-input')) return;
    const original = el.value;
    let cleaned = original.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot !== -1) {
        cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    }
    const maxDecimals = parseInt(el.dataset.maxDecimals || '2', 10);
    const dotIdx = cleaned.indexOf('.');
    if (dotIdx !== -1 && cleaned.length - dotIdx - 1 > maxDecimals) {
        cleaned = cleaned.slice(0, dotIdx + 1 + maxDecimals);
    }
    if (cleaned !== original) {
        const pos = el.selectionStart;
        const diff = original.length - cleaned.length;
        el.value = cleaned;
        // 尽量保持光标位置稳定
        if (pos !== null && el.setSelectionRange) {
            const newPos = Math.max(0, pos - diff);
            try { el.setSelectionRange(newPos, newPos); } catch (e2) {}
        }
    }
}, true);
