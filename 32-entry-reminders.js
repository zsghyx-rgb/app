// @file js/32-entry-reminders.js
// 进入 App 时的转账提醒：
//   · 别人新转入当前用户账户的转账
//   · 这类转账被对方修改 / 删除
//
// 判断依据是本机保存的“上次看到的状态”（localStorage，按用户分开）：
//   APP_transfer_baseline_<用户> = { v:1, at, items: { 转账key: {sig,date,amount,...} } }
// 每次进入 App 与上次的基线对比一次，然后把当前状态写成新基线，旧提醒不会反复弹出。
//
// 只提醒“跨用户的转入”，自己账户之间的转账、其他用户自己的收支变动都不提醒。
// 不改动账目数据、加密方式或同步协议。

const ENTRY_REMINDER_KEY_PREFIX = 'APP_transfer_baseline_';
const ENTRY_REMINDER_MODAL_ID = 'entry-reminders-modal';

let _entryReminderTimer = null;
let _entryReminderChecked = false;

function resetEntryReminders() {
    _entryReminderChecked = false;
    if (_entryReminderTimer) { clearTimeout(_entryReminderTimer); _entryReminderTimer = null; }
}

/** 登录后调用：等后台同步结束（若需要）再检查，避免提醒基于过期的本机缓存。 */
function scheduleEntryReminders() {
    if (_entryReminderChecked) return;
    if (_entryReminderTimer) { clearTimeout(_entryReminderTimer); _entryReminderTimer = null; }
    const willSync = !!window._entryReminderWillSync;
    window._entryReminderWillSync = false;
    // 在线且登录后要后台增量同步：正常情况下 incBackgroundSync() 结束时就会调用检查，
    // 这里的 8 秒只是兜底，防止同步卡住时提醒一直不出现。
    _entryReminderTimer = setTimeout(checkEntryReminders, willSync ? 8000 : 900);
}

function checkEntryReminders() {
    if (_entryReminderChecked) return;
    if (!currentUserName || !inMemoryLoadedData) return;
    // 后台同步遇到表单打开时会推迟界面刷新：此时 accounts/transactions 还是旧的，
    // 等表单关闭、数据刷新后再对比，避免把旧状态写成新基线。
    if (window._pendingUIRefresh) {
        if (_entryReminderTimer) clearTimeout(_entryReminderTimer);
        _entryReminderTimer = setTimeout(checkEntryReminders, 1500);
        return;
    }
    // 登录 PIN、设置弹层等打开时先让一让，等它关闭再弹提醒
    if (typeof _uiSheetResolve !== 'undefined' && _uiSheetResolve) {
        if (_entryReminderTimer) clearTimeout(_entryReminderTimer);
        _entryReminderTimer = setTimeout(checkEntryReminders, 700);
        return;
    }
    _entryReminderChecked = true;
    if (_entryReminderTimer) { clearTimeout(_entryReminderTimer); _entryReminderTimer = null; }
    const items = computeEntryReminders();
    if (items.length) showEntryReminders(items);
}

// ── 基线读写 ──────────────────────────────────────────────────
function _reminderBaselineKey(user) { return ENTRY_REMINDER_KEY_PREFIX + user; }

function _loadReminderBaseline(user) {
    try {
        const obj = JSON.parse(localStorage.getItem(_reminderBaselineKey(user)) || 'null');
        if (!obj || typeof obj.items !== 'object' || !obj.items) return null;
        return obj;
    } catch (_) { return null; }
}

function _saveReminderBaseline(user, items) {
    try {
        localStorage.setItem(_reminderBaselineKey(user), JSON.stringify({
            v: 1, at: Date.now(), items: items
        }));
    } catch (_) {}
}

// ── 找出“别人转入当前用户账户”的转账 ──────────────────────────
function _incomingTransfersForMe() {
    const accMap = new Map(accounts.map(a => [String(a.id), a]));
    const list = [];
    transactions.forEach(t => {
        if (!t.isTransfer || t.type !== 'income') return;
        const acc = accMap.get(String(t.accountId));
        if (!acc || acc.ownerName !== currentUserName) return;
        const fromAcc = accMap.get(String(t.relatedAccountId));
        // 自己账户之间的转账不算“别人转入”
        if (fromAcc && fromAcc.ownerName === currentUserName) return;
        list.push({ t: t, acc: acc, fromAcc: fromAcc, key: String(t.transferPairId || ('id:' + t.id)) });
    });
    return list;
}

function _transferSnapshot(item) {
    const t = item.t;
    const amount = Math.abs(parseFloat(t.amount) || 0);
    return {
        // 参与比较的指纹：日期、金额、两端账户、备注
        sig: [t.date, amount, String(t.accountId), String(t.relatedAccountId), t.desc || ''].join('|'),
        date: t.date || '',
        amount: amount,
        currency: item.acc.currency || 'RMB',
        toName: getAccountDisplayName(item.acc),
        fromName: item.fromAcc ? getAccountDisplayName(item.fromAcc) : '已删除账户',
        fromOwner: item.fromAcc ? (item.fromAcc.ownerName || '') : '',
        desc: t.desc || ''
    };
}

/**
 * 对比基线，返回本次要提醒的条目；同时把当前状态写成新基线。
 * 第一次使用（没有基线）时只建立基线，不提醒历史记录。
 */
function computeEntryReminders() {
    const current = _incomingTransfersForMe();
    const baseline = _loadReminderBaseline(currentUserName);
    const curMap = new Map(current.map(x => [x.key, x]));
    const items = [];

    if (baseline) {
        current.forEach(x => {
            const snap = _transferSnapshot(x);
            const old = baseline.items[x.key];
            if (!old) {
                items.push({ kind: 'new', key: x.key, snap: snap, t: x.t });
            } else if (old.sig !== snap.sig) {
                items.push({ kind: 'modified', key: x.key, snap: snap, old: old, t: x.t });
            }
        });
        Object.keys(baseline.items).forEach(k => {
            if (!curMap.has(k)) items.push({ kind: 'deleted', key: k, snap: baseline.items[k] });
        });
    }

    const fresh = {};
    current.forEach(x => { fresh[x.key] = _transferSnapshot(x); });
    _saveReminderBaseline(currentUserName, fresh);

    // 新转入按日期倒序；修改/删除排在新转入之后
    const order = { new: 0, modified: 1, deleted: 2 };
    items.sort((a, b) => {
        if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
        return String(b.snap.date || '').localeCompare(String(a.snap.date || ''));
    });
    return items;
}

// ── 弹窗 ──────────────────────────────────────────────────────
function _ensureEntryReminderModal() {
    let modalEl = $(ENTRY_REMINDER_MODAL_ID);
    if (modalEl) return modalEl;
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="${ENTRY_REMINDER_MODAL_ID}" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h6 class="modal-title"><i class="bi bi-bell-fill me-1 text-primary"></i> 进入提醒</h6>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button>
                    </div>
                    <div class="modal-body" id="entry-reminders-body"></div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" data-bs-dismiss="modal">知道了</button>
                    </div>
                </div>
            </div>
        </div>`);
    return $(ENTRY_REMINDER_MODAL_ID);
}

function _reminderKindMeta(kind) {
    if (kind === 'new')      return { label: '新转入', icon: 'bi-arrow-down-left',  cls: 'is-income' };
    if (kind === 'modified') return { label: '被修改', icon: 'bi-pencil-square',   cls: 'is-warn' };
    return                          { label: '被删除', icon: 'bi-trash3',          cls: 'is-danger' };
}

function _buildReminderRow(item) {
    const meta = _reminderKindMeta(item.kind);
    const s = item.snap || {};
    const symbol = CURRENCY_SYMBOLS[s.currency] || s.currency || '';
    const amount = symbol + formatAmount(Number(s.amount) || 0, s.currency);

    const row = document.createElement('div');
    row.className = 'entry-reminder-row';
    row.innerHTML = `
        <span class="entry-reminder-icon ${meta.cls}"><i class="bi ${meta.icon}"></i></span>
        <div class="entry-reminder-main">
            <div class="entry-reminder-title">
                ${_escHtml(s.fromName || '')}<i class="bi bi-arrow-right-short"></i>${_escHtml(s.toName || '')}
            </div>
            <div class="entry-reminder-sub">
                ${_escHtml(s.date || '')}${s.desc ? ' · ' + _escHtml(s.desc) : ''}
                <span class="entry-reminder-tag ${meta.cls}">${meta.label}</span>
            </div>
        </div>
        <div class="entry-reminder-amt ${meta.cls}">${item.kind === 'new' ? '+' : ''}${amount}</div>`;

    if (item.t) {
        row.style.cursor = 'pointer';
        row.title = '查看详细信息';
        row.addEventListener('click', () => {
            // 先移开焦点，避免关闭弹窗时浏览器提示 aria-hidden 焦点冲突
            try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (_) {}
            const inst = bootstrap.Modal.getInstance($(ENTRY_REMINDER_MODAL_ID));
            if (inst) inst.hide();
            setTimeout(() => openEditTransfer(item.t.id), 300);
        });
    } else {
        row.title = '这笔转账已被删除，只能保留提醒信息';
    }
    return row;
}

function showEntryReminders(items) {
    const modalEl = _ensureEntryReminderModal();
    const body = $('entry-reminders-body');
    if (!body) return;
    body.innerHTML = '';

    const intro = document.createElement('p');
    intro.className = 'text-muted small mb-2';
    intro.textContent = `上次登录后，有 ${items.length} 条与你账户有关的转账变动。`;
    body.appendChild(intro);

    const groups = [
        { kind: 'new',      title: '新转入' },
        { kind: 'modified', title: '被修改' },
        { kind: 'deleted',  title: '被删除' }
    ];
    groups.forEach(g => {
        const list = items.filter(i => i.kind === g.kind);
        if (!list.length) return;
        const title = document.createElement('div');
        title.className = 'entry-reminder-group-title';
        title.textContent = `${g.title} · ${list.length}`;
        body.appendChild(title);
        list.forEach(item => body.appendChild(_buildReminderRow(item)));
    });

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}
