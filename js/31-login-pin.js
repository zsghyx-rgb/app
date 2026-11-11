// @file js/31-login-pin.js
// 登录 PIN（可选 1-4 位数字）与登录界面的“最近登录用户”列表。
//
// PIN 规则：
//   · 存在加密数据文件的 userPins 字段里（随账本同步到 Google 表格）：
//       userPins[用户名] = { salt, hash }   // hash = SHA256(salt + ':' + PIN)
//   · 只在“从别人的界面切换到某个用户”时询问；
//     登录自己（本设备上次登录的用户）和进入 App 自动登录都不询问。
//   · 连续输错 3 次，可以用账本加密密码重设。
//
// 本文件只做登录确认，不改动账目数据、加密方式或同步协议。

const LOGIN_RECENT_DAYS = 7;
const LOGIN_RECENT_KEY = 'APP_recent_users';

// ── PIN 存取与校验 ────────────────────────────────────────────
function _pinHash(pin, salt) {
    return CryptoJS.SHA256(String(salt) + ':' + String(pin)).toString();
}

function getUserPinRecord(name) {
    return (userPins && userPins[name]) ? userPins[name] : null;
}

function hasUserPin(name) {
    const rec = getUserPinRecord(name);
    return !!(rec && rec.hash);
}

function setUserPin(name, pin) {
    if (!name || !/^\d{1,4}$/.test(String(pin))) return false;
    const salt = CryptoJS.lib.WordArray.random(8).toString();
    if (!inMemoryLoadedData.userPins) inMemoryLoadedData.userPins = {};
    inMemoryLoadedData.userPins[name] = { salt: salt, hash: _pinHash(pin, salt) };
    userPins = inMemoryLoadedData.userPins;
    // 配置块变了：让同步把它当作新版本推送
    markConfigUpdated();
    saveUserData();
    triggerAutoSave();
    return true;
}

function clearUserPin(name) {
    if (inMemoryLoadedData.userPins) delete inMemoryLoadedData.userPins[name];
    if (userPins) delete userPins[name];
    markConfigUpdated();
    saveUserData();
    triggerAutoSave();
}

function verifyUserPin(name, pin) {
    const rec = getUserPinRecord(name);
    if (!rec || !rec.hash) return true;          // 没设置 PIN：直接通过
    return rec.hash === _pinHash(pin, rec.salt);
}

/** 用户名改名时，把本机与 PIN 相关的记录一起迁移 */
function migrateLoginLocalState(oldName, newName) {
    try {
        if (localStorage.getItem('APP_last_user') === oldName) {
            localStorage.setItem('APP_last_user', newName);
        }
        const raw = localStorage.getItem(LOGIN_RECENT_KEY);
        if (raw) {
            const map = JSON.parse(raw) || {};
            if (map[oldName]) { map[newName] = map[oldName]; delete map[oldName]; }
            localStorage.setItem(LOGIN_RECENT_KEY, JSON.stringify(map));
        }
        const prompted = localStorage.getItem('APP_pin_prompted_' + oldName);
        if (prompted) {
            localStorage.setItem('APP_pin_prompted_' + newName, prompted);
            localStorage.removeItem('APP_pin_prompted_' + oldName);
        }
        const base = localStorage.getItem('APP_transfer_baseline_' + oldName);
        if (base) {
            localStorage.setItem('APP_transfer_baseline_' + newName, base);
            localStorage.removeItem('APP_transfer_baseline_' + oldName);
        }
    } catch (_) {}
}

// ── 本设备最近登录的用户 ──────────────────────────────────────
function recordRecentLoginUser(name) {
    if (!name) return;
    let map = {};
    try { map = JSON.parse(localStorage.getItem(LOGIN_RECENT_KEY) || '{}') || {}; } catch (_) { map = {}; }
    // 只保留 30 天内的记录，避免这个本地列表无限变长
    const cutoff = Date.now() - 30 * 86400000;
    const pruned = {};
    Object.keys(map).forEach(k => { if ((map[k] || 0) > cutoff) pruned[k] = map[k]; });
    pruned[name] = Date.now();
    try { localStorage.setItem(LOGIN_RECENT_KEY, JSON.stringify(pruned)); } catch (_) {}
}

function _loadRecentUserMap() {
    try { return JSON.parse(localStorage.getItem(LOGIN_RECENT_KEY) || '{}') || {}; } catch (_) { return {}; }
}

// ── 登录界面的用户列表：最近 7 天 + 折叠的其他用户 ─────────────
function _makeLoginUserBtn(name, primary) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = primary
        ? 'btn btn-outline-primary flex-fill py-2 fw-bold'
        : 'btn btn-outline-secondary flex-fill py-2';
    if (!primary) btn.style.fontSize = '0.85rem';
    btn.textContent = name;
    btn.onclick = () => requestLoginWithUser(name);
    return btn;
}

function renderLoginUserList() {
    const container = $('user-buttons');
    if (!container) return;
    container.innerHTML = '';
    if (!dataUsers || dataUsers.length === 0) {
        container.innerHTML = '<span class="text-danger small">账本中没有用户，请新建空账本。</span>';
        return;
    }

    const map = _loadRecentUserMap();
    const cutoff = Date.now() - LOGIN_RECENT_DAYS * 86400000;
    let recent = dataUsers.filter(u => (map[u] || 0) >= cutoff);

    // 没有 7 天内的记录时：至少显示本设备上次登录的用户，避免列表空白
    if (recent.length === 0) {
        let lastUser = '';
        try { lastUser = localStorage.getItem('APP_last_user') || ''; } catch (_) {}
        if (lastUser && dataUsers.includes(lastUser)) recent = [lastUser];
        else recent = dataUsers.slice();
    }

    const others = dataUsers.filter(u => !recent.includes(u));

    recent.forEach(u => container.appendChild(_makeLoginUserBtn(u, true)));

    if (others.length) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'login-user-more';
        more.innerHTML = `<i class="bi bi-people"></i> 其他用户 ${others.length}`;
        more.onclick = () => {
            more.remove();
            others.forEach(u => container.appendChild(_makeLoginUserBtn(u, false)));
        };
        container.appendChild(more);
    }
}

// ── 选择用户：只有“切换到别人”才问 PIN ────────────────────────
function requestLoginWithUser(name) {
    if (!inMemoryLoadedData) { uiAlert('请先加载账本数据'); return; }
    let lastUser = '';
    try { lastUser = localStorage.getItem('APP_last_user') || ''; } catch (_) {}
    // 登录自己 / 该用户没有设置 PIN：直接进入
    if (name === lastUser || !hasUserPin(name)) { loginWithUser(name); return; }
    promptPinToSwitch(name);
}

function _validPinOrNull(v) {
    if (v === null) return null;                 // 取消
    const pin = String(v).trim();
    if (pin === '') return null;
    return /^\d{1,4}$/.test(pin) ? pin : '';
}

async function promptPinToSwitch(name) {
    let fails = 0;
    while (true) {
        const msg = fails === 0
            ? '这是其他用户的账户，请输入该用户的 PIN。'
            : `PIN 不正确（还可尝试 ${Math.max(0, 3 - fails)} 次）。`;
        const val = await uiPrompt(msg, {
            title: `切换到「${name}」`,
            okText: '进入',
            input: { type: 'password', placeholder: '1-4 位数字', inputmode: 'numeric', maxlength: 4 }
        });
        if (val === null) return;                // 取消
        const pin = String(val).trim();
        if (!/^\d{1,4}$/.test(pin)) {
            await uiAlert('PIN 只能是 1-4 位数字。', { title: '格式不对' });
            continue;
        }
        if (verifyUserPin(name, pin)) { loginWithUser(name); return; }
        fails++;
        if (fails >= 3) {
            const reset = await uiConfirm(
                'PIN 已连续输错 3 次。\n\n可以用账本加密密码重设该用户的 PIN。',
                { title: '重设 PIN', okText: '用账本密码重设', danger: true }
            );
            if (!reset) return;
            await _resetPinWithDataPassword(name);
            return;
        }
    }
}

async function _resetPinWithDataPassword(name) {
    if (!userPassword) {
        await uiAlert('当前会话没有账本密码，请退出后重新登录再试。');
        return false;
    }
    const pwd = await uiPrompt('输入账本加密密码。验证通过后将清除该用户的 PIN。', {
        title: '验证账本密码',
        okText: '验证',
        input: { type: 'password', placeholder: '账本加密密码' }
    });
    if (pwd === null) return false;
    if (pwd !== userPassword) {
        await uiAlert('账本密码不正确。');
        return false;
    }
    clearUserPin(name);
    const newPin = _validPinOrNull(await uiPrompt('PIN 已清除。现在设置一个新的？（留空表示暂不设置）', {
        title: '设置新 PIN',
        okText: '保存',
        cancelText: '暂不设置',
        input: { type: 'password', placeholder: '1-4 位数字，可留空', inputmode: 'numeric', maxlength: 4 }
    }));
    if (newPin === '') {
        await uiAlert('PIN 只能是 1-4 位数字。这次先不设置，可在设置页随时设置。', { title: '未设置' });
    } else if (newPin) {
        setUserPin(name, newPin);
        showToast('PIN 已重设', 'success', 2000);
    }
    loginWithUser(name);
    return true;
}

// ── 首次登录提示设置 PIN（每个用户在本设备只弹一次，可跳过） ────
function maybePromptPinSetup(name) {
    return new Promise(resolve => {
        if (!name || hasUserPin(name)) return resolve();
        const flagKey = 'APP_pin_prompted_' + name;
        try { if (localStorage.getItem(flagKey) === '1') return resolve(); } catch (_) {}

        setTimeout(async () => {
            try {
                const pin = _validPinOrNull(await uiPrompt(
                    '可以给这个用户设一个 1-4 位数字 PIN。\n\n' +
                    '只有从别人的界面切换到「' + name + '」时才会询问；' +
                    '登录自己、进入 App 自动登录都不需要。',
                    {
                        title: '设置登录 PIN（可选）',
                        okText: '保存',
                        cancelText: '暂不设置',
                        input: { type: 'password', placeholder: '1-4 位数字，可留空', inputmode: 'numeric', maxlength: 4 }
                    }
                ));
                try { localStorage.setItem(flagKey, '1'); } catch (_) {}
                if (pin === '') {
                    await uiAlert('PIN 只能是 1-4 位数字。这次先不设置，可在设置页随时设置。', { title: '未设置' });
                } else if (pin) {
                    setUserPin(name, pin);
                    showToast('PIN 已保存，可在设置中修改', 'success', 3000);
                }
            } finally {
                resolve();
            }
        }, 650);
    });
}

// ── 设置页：设置 / 清除自己的 PIN ─────────────────────────────
async function openMyPinModal() {
    if (!currentUserName) return;
    const hadPin = hasUserPin(currentUserName);
    let pin = _validPinOrNull(await uiPrompt(
        `为「${currentUserName}」设置 1-4 位数字 PIN。\n\n` +
        '切换到其他用户时需要输入；登录自己不需要。',
        {
            title: hadPin ? '修改登录 PIN' : '设置登录 PIN',
            okText: '保存',
            input: { type: 'password', placeholder: '1-4 位数字', inputmode: 'numeric', maxlength: 4 }
        }
    ));
    if (pin === '') {
        await uiAlert('PIN 只能是 1-4 位数字。', { title: '格式不对' });
        return;
    }
    if (!pin) return;
    setUserPin(currentUserName, pin);
    renderUserManagement();
    showToast('PIN 已保存', 'success', 2000);
}

async function clearMyPin() {
    if (!currentUserName) return;
    const ok = await uiConfirm(
        `清除后，从别人的界面切换到「${currentUserName}」时将不再询问 PIN。`,
        { title: '清除登录 PIN', okText: '清除', danger: true }
    );
    if (!ok) return;
    clearUserPin(currentUserName);
    renderUserManagement();
    showToast('PIN 已清除', 'info', 2000);
}
