// @file js/35-ui-feedback.js
// Toast 图标样式、应用内底部弹层(uiConfirm/uiAlert/uiPrompt/uiForm)、删除后的撤销提示条。

const toastIcons = {
    success: '<i class="bi bi-check-circle-fill"></i>',
    warning: '<i class="bi bi-exclamation-triangle-fill"></i>',
    error:   '<i class="bi bi-x-circle-fill"></i>',
    syncing: '<span class="spinner-border spinner-border-sm"></span>',
    progress:'<span class="spinner-border spinner-border-sm"></span>',
    info:    '<i class="bi bi-info-circle-fill"></i>',
};

function applyToastStyle(el, type) {
    // 使用 Bootstrap 语义变量的 subtle/emphasis 组合，随主题与深浅色自动适配
    const colors = {
        success: { bg: 'var(--bs-success-bg-subtle)', color: 'var(--bs-success-text-emphasis)', border: 'var(--bs-success-border-subtle)' },
        warning: { bg: 'var(--bs-warning-bg-subtle)', color: 'var(--bs-warning-text-emphasis)', border: 'var(--bs-warning-border-subtle)' },
        error:   { bg: 'var(--bs-danger-bg-subtle)',  color: 'var(--bs-danger-text-emphasis)',  border: 'var(--bs-danger-border-subtle)' },
        syncing: { bg: 'var(--bs-primary-bg-subtle)', color: 'var(--bs-primary-text-emphasis)', border: 'var(--bs-primary-border-subtle)' },
        progress:{ bg: 'var(--bs-primary-bg-subtle)', color: 'var(--bs-primary-text-emphasis)', border: 'var(--bs-primary-border-subtle)' },
        info:    { bg: 'var(--bs-info-bg-subtle)',    color: 'var(--bs-info-text-emphasis)',    border: 'var(--bs-info-border-subtle)' },
    };
    const c = colors[type] || colors.success;
    el.style.background = c.bg;
    el.style.color = c.color;
    el.style.border = `1px solid ${c.border}`;
}

/* ───────── 应用内底部弹层：替代原生 confirm / alert ─────────
 * 原生弹窗在 PWA 里很生硬（样式不可控、会被浏览器当成“网站提示”），
 * 这里统一换成应用内的底部弹层：
 *   uiConfirm(msg, opts) → Promise<boolean>
 *   uiAlert(msg, opts)   → Promise<void>（不需要等待结果的地方可以直接调用）
 */
let _uiSheetResolve = null;
let _uiSheetInputEl = null;      // 非空表示当前是“输入型”弹层（uiPrompt）
let _uiSheetFields = null;       // 非空表示当前是“多字段表单型”弹层（uiForm）
let _uiSheetFocusKey = null;     // uiForm 时指定默认聚焦的字段 key

function _uiSheetOpen(opts) {
    const o = Object.assign({
        title: '', message: '', okText: '确定', cancelText: '取消',
        okClass: 'btn-primary', cancel: true, danger: false,
        input: null,            // { placeholder, value, type, maxlength }
        fields: null,           // 数组：[{ key, label, placeholder, value, type, inputmode, autofocus }]
        focusKey: null          // fields 模式下默认聚焦的 key
    }, opts || {});
    return new Promise(resolve => {
        const backdrop = $('ui-sheet-backdrop');
        const sheet = $('ui-sheet');
        const actions = $('ui-sheet-actions');
        // 极端情况（弹层节点缺失）：退回原生确认框，保证逻辑不中断
        if (!sheet || !actions || !backdrop) {
            resolve(o.input ? window.prompt(o.message || o.title) : window.confirm(o.message || o.title));
            return;
        }

        // 同一时间只允许一个弹层：上一个按“取消”结束，避免 Promise 永久悬挂
        if (_uiSheetResolve) {
            const prev = _uiSheetResolve;
            _uiSheetResolve = null;
            prev(_uiSheetFields ? null : (o.input ? null : false));
        }
        _uiSheetResolve = resolve;

        $('ui-sheet-title').textContent = o.title || '';
        const bodyEl = $('ui-sheet-body');
        bodyEl.textContent = o.message || '';
        actions.innerHTML = '';
        _uiSheetInputEl = null;
        _uiSheetFields = null;
        _uiSheetFocusKey = o.focusKey || null;

        if (o.fields && Array.isArray(o.fields) && o.fields.length) {
            // 多字段表单模式：返回 { key: value, ... } 或 null（取消）
            _uiSheetFields = {};
            const wrap = document.createElement('div');
            wrap.style.cssText = 'margin-top:12px;display:flex;flex-direction:column;gap:10px;';
            o.fields.forEach(f => {
                const row = document.createElement('div');
                const lbl = document.createElement('div');
                lbl.textContent = f.label || '';
                lbl.style.cssText = 'font-size:.8rem;color:var(--bs-secondary-color);margin-bottom:2px;';
                const inp = document.createElement('input');
                inp.type = f.type || 'text';
                if (f.inputmode) inp.inputMode = f.inputmode;
                inp.className = 'form-control';
                inp.placeholder = f.placeholder || '';
                inp.value = f.value !== undefined ? f.value : '';
                inp.autocomplete = 'off';
                inp.spellcheck = false;
                if (f.maxlength) inp.maxLength = f.maxlength;
                inp.style.cssText = 'font-size:1rem;padding:.6rem .8rem;border-radius:12px;';
                inp.dataset.fieldKey = f.key;
                inp.addEventListener('keydown', ev => {
                    if (ev.key === 'Enter') { ev.preventDefault(); _uiSheetClose(true); }
                });
                row.appendChild(lbl);
                row.appendChild(inp);
                wrap.appendChild(row);
                _uiSheetFields[f.key] = inp;
            });
            bodyEl.appendChild(wrap);
        } else if (o.input) {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'margin-top:12px;';
            const inp = document.createElement('input');
            inp.type = o.input.type || 'text';
            if (o.input.inputmode) inp.inputMode = o.input.inputmode;
            inp.className = 'form-control';
            inp.placeholder = o.input.placeholder || '';
            inp.value = o.input.value || '';
            inp.autocomplete = o.input.autocomplete || 'off';
            inp.spellcheck = false;
            if (o.input.maxlength) inp.maxLength = o.input.maxlength;
            // 数字键盘输入（如登录 PIN）：只保留数字，并限制长度
            if ((o.input.inputmode || '') === 'numeric') {
                inp.addEventListener('input', () => {
                    const cleaned = inp.value.replace(/[^0-9]/g, '').slice(0, o.input.maxlength || 4);
                    if (cleaned !== inp.value) inp.value = cleaned;
                });
            }
            inp.style.cssText = 'font-size:1rem;padding:.6rem .8rem;border-radius:12px;';
            inp.addEventListener('keydown', ev => {
                if (ev.key === 'Enter') { ev.preventDefault(); _uiSheetClose(true); }
            });
            wrap.appendChild(inp);
            bodyEl.appendChild(wrap);
            _uiSheetInputEl = inp;
        }

        if (o.cancel) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn-outline-secondary';
            b.textContent = o.cancelText;
            b.onclick = () => _uiSheetClose(false);
            actions.appendChild(b);
        }
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn ' + (o.danger ? 'btn-danger' : o.okClass);
        ok.textContent = o.okText;
        ok.onclick = () => _uiSheetClose(true);
        actions.appendChild(ok);

        backdrop.classList.add('show');
        sheet.classList.add('show');
        document.body.classList.add('ui-sheet-on');
        setTimeout(() => {
            try {
                if (_uiSheetFields) {
                    // 多字段表单：默认聚焦 focusKey 指定的字段（没指定就聚焦第一个）
                    const targetKey = _uiSheetFocusKey || (o.fields[0] && o.fields[0].key);
                    const el = targetKey ? _uiSheetFields[targetKey] : null;
                    if (el) { el.focus({ preventScroll: true }); try { el.select(); } catch (_) {} }
                    else ok.focus({ preventScroll: true });
                } else if (_uiSheetInputEl) { _uiSheetInputEl.focus({ preventScroll: true }); _uiSheetInputEl.select(); }
                else ok.focus({ preventScroll: true });
            } catch (_) {}
        }, 130);
    });
}

function _uiSheetClose(result) {
    const sheet = $('ui-sheet'), backdrop = $('ui-sheet-backdrop');
    if (sheet) sheet.classList.remove('show');
    if (backdrop) backdrop.classList.remove('show');
    document.body.classList.remove('ui-sheet-on');
    const r = _uiSheetResolve;
    const inp = _uiSheetInputEl;
    const fields = _uiSheetFields;
    _uiSheetResolve = null;
    _uiSheetInputEl = null;
    _uiSheetFields = null;
    _uiSheetFocusKey = null;
    if (!r) return;
    if (fields) {
        // 多字段表单：取消返回 null，确认返回 { key: value }
        if (!result) return r(null);
        const out = {};
        Object.keys(fields).forEach(k => { out[k] = fields[k].value; });
        return r(out);
    }
    r(inp ? (result ? inp.value : null) : !!result);
}
function _uiSheetCancel() { _uiSheetClose(false); }

function uiConfirm(message, opts) {
    return _uiSheetOpen(Object.assign({ message: message, okText: '确定', cancelText: '取消' }, opts || {}));
}
function uiAlert(message, opts) {
    return _uiSheetOpen(Object.assign({ message: message, okText: '知道了', cancel: false }, opts || {}));
}
function uiPrompt(message, opts) {
    const o = Object.assign({ message: message, okText: '确定', cancelText: '取消', input: {} }, opts || {});
    return _uiSheetOpen(o);
}
/**
 * 多字段表单弹层。
 * @param message  说明文字
 * @param fields   [{ key, label, placeholder, value, type, inputmode, maxlength }]
 * @param opts     { title, okText, cancelText, focusKey }
 * @returns Promise<{key:value}|null>  取消返回 null
 */
function uiForm(message, fields, opts) {
    const o = Object.assign({ message: message, okText: '确定', cancelText: '取消', fields: fields }, opts || {});
    return _uiSheetOpen(o);
}
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _uiSheetResolve) { e.preventDefault(); _uiSheetClose(false); }
});

/* ───────── 删除类操作的“撤销”提示条 ─────────
 * 删除不再弹确认框：直接删掉 + 底部给 6 秒“撤销”，比“确定要删除吗”更顺手，也更难误删后无法挽回。
 */
let _undoTimer = null;
let _undoFn = null;

function showUndo(msg, fn, ms = 6000) {
    const bar = $('undo-bar');
    if (!bar) { if (typeof fn === 'function') fn(); return; }
    bar.querySelector('.ub-text').textContent = msg;
    _undoFn = (typeof fn === 'function') ? fn : null;
    bar.classList.add('show');
    clearTimeout(_undoTimer);
    _undoTimer = setTimeout(hideUndo, ms);
}
function hideUndo() {
    const bar = $('undo-bar');
    if (bar) bar.classList.remove('show');
    clearTimeout(_undoTimer);
    _undoTimer = null;
    _undoFn = null;
}
function _undoRun() {
    const fn = _undoFn;
    hideUndo();
    if (typeof fn === 'function') {
        try { fn(); } catch (e) { console.warn('[undo] 撤销失败', e); }
    }
}
