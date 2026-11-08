// @file js/94-user-management.js
// 高级导出区开关、多用户管理(新增/重命名/删除用户)。

function toggleAdvancedExportSection() {
    const card = $('adv-export-card');
    const toggleText = $('adv-export-toggle-text');
    const toggleIcon = $('adv-export-toggle-icon');
    if (card.style.display === 'none') {
        card.style.display = 'block';
        toggleText.textContent = '隐藏高级设置';
        toggleIcon.className = 'bi bi-gear-fill';
    } else {
        card.style.display = 'none';
        toggleText.textContent = '显示高级设置';
        toggleIcon.className = 'bi bi-gear';
    }
}


function renderUserManagement() {
    const container = $('user-management-list');
    if (!container) return;
    container.innerHTML = '';
    if (!dataUsers || dataUsers.length === 0) {
        container.innerHTML = '<span class="text-muted small">暂无用户</span>';
        return;
    }

    // 自己的登录 PIN（可选）：只影响“从别人的界面切换过来”时是否询问
    if (currentUserName && typeof hasUserPin === 'function') {
        const pinned = hasUserPin(currentUserName);
        const pinRow = document.createElement('div');
        pinRow.className = 'd-flex align-items-center justify-content-between gap-2 mb-3 pb-2 border-bottom';
        pinRow.innerHTML = `
            <div class="small" style="min-width:0;">
                <div class="fw-bold">我的登录 PIN</div>
                <div class="text-muted" style="font-size:0.72rem;">${pinned ? '已设置 · 从别人界面切换过来时询问' : '未设置 · 切换用户时不需要 PIN'}</div>
            </div>
            <div class="d-flex gap-1 flex-shrink-0">
                <button class="btn btn-outline-secondary btn-sm py-0" onclick="openMyPinModal()">${pinned ? '修改' : '设置'}</button>
                ${pinned ? '<button class="btn btn-outline-danger btn-sm py-0" onclick="clearMyPin()">清除</button>' : ''}
            </div>`;
        container.appendChild(pinRow);
    }

    dataUsers.forEach(u => {
        const hasData = (accounts.some(a => a.ownerName === u) ||
                         transactions.some(t => t.ownerName === u));
        const row = document.createElement('div');
        row.className = 'd-flex align-items-center gap-2 mb-2';
        row.innerHTML = `
            <span class="flex-fill small fw-bold">${u}${u === currentUserName ? ' <span class="badge bg-primary" style="font-size:0.65rem;">当前</span>' : ''}</span>
            <button class="btn btn-outline-secondary btn-sm py-0" onclick="renameUser('${u}')">改名</button>
            <button class="btn btn-outline-danger btn-sm py-0" onclick="removeUser('${u}')"
                ${hasData ? 'disabled title="有数据，不可删除"' : ''}>删除</button>`;
        container.appendChild(row);
    });
}

function addUserFromSettings(e) {
    e.preventDefault();
    const input = $('new-user-input');
    const name = input.value.trim();
    if (!name) return;
    if (dataUsers.includes(name)) { uiAlert(`用户 "${name}" 已存在`); return; }
    dataUsers.push(name);
    if (!inMemoryLoadedData.allUserData[name]) {
        inMemoryLoadedData.allUserData[name] = { accounts: [], transactions: [], plannedTransactions: [] };
    }
    saveUserData(); triggerAutoSave();
    input.value = '';
    renderUserManagement();
    if (verboseToast) showToast(`已添加用户 "${name}"`, 'success');
}

async function renameUser(oldName) {
    const newName = await uiPrompt(`将用户「${oldName}」改名为：`, { title: '重命名用户', okText: '保存', input: { value: oldName } });
    if (!newName || newName.trim() === oldName) return;
    const trimmed = newName.trim();
    if (dataUsers.includes(trimmed)) { uiAlert(`用户名 "${trimmed}" 已存在`); return; }
    const idx = dataUsers.indexOf(oldName);
    if (idx === -1) return;
    dataUsers[idx] = trimmed;
    // 迁移数据
    accounts.forEach(a => { if (a.ownerName === oldName) a.ownerName = trimmed; });
    transactions.forEach(t => { if (t.ownerName === oldName) t.ownerName = trimmed; });
    plannedTransactions.forEach(p => { if (p.ownerName === oldName) p.ownerName = trimmed; });
    inMemoryLoadedData.allUserData[trimmed] = inMemoryLoadedData.allUserData[oldName];
    delete inMemoryLoadedData.allUserData[oldName];
    // 登录 PIN 与本机登录记录一起改名
    if (inMemoryLoadedData.userPins && inMemoryLoadedData.userPins[oldName]) {
        inMemoryLoadedData.userPins[trimmed] = inMemoryLoadedData.userPins[oldName];
        delete inMemoryLoadedData.userPins[oldName];
        userPins = inMemoryLoadedData.userPins;
    }
    if (typeof migrateLoginLocalState === 'function') migrateLoginLocalState(oldName, trimmed);
    if (currentUserName === oldName) {
        currentUserName = trimmed;
        currentUser.name = trimmed;
        document.querySelector('.user-name-full').innerText = trimmed;
        document.querySelector('.user-name-short').innerText = trimmed.charAt(0).toLowerCase();
        $('mobile-current-user').innerText = trimmed;
    }
    saveUserData(); triggerAutoSave();
    renderUserManagement();
    if (verboseToast) showToast(`已重命名为 "${trimmed}"`, 'success');
}

async function removeUser(name) {
    const hasData = accounts.some(a => a.ownerName === name) ||
                    transactions.some(t => t.ownerName === name);
    if (hasData) { uiAlert('该用户有账户或交易数据，不可删除。'); return; }
    const ok = await uiConfirm(`确定删除用户 "${name}"？`, { okText: '删除用户', danger: true });
    if (!ok) return;
    const snapUsers = dataUsers.slice();
    const snapSlot = inMemoryLoadedData.allUserData[name];
    const snapPin = userPins ? userPins[name] : null;
    dataUsers = dataUsers.filter(u => u !== name);
    delete inMemoryLoadedData.allUserData[name];
    if (inMemoryLoadedData.userPins) delete inMemoryLoadedData.userPins[name];
    saveUserData(); triggerAutoSave();
    renderUserManagement();
    showToast(`已删除用户「${name}」`, 'success', 2200);
    showUndo(`已删除用户「${name}」`, () => {
        dataUsers = snapUsers;
        if (snapSlot) inMemoryLoadedData.allUserData[name] = snapSlot;
        if (snapPin) {
            if (!inMemoryLoadedData.userPins) inMemoryLoadedData.userPins = {};
            inMemoryLoadedData.userPins[name] = snapPin;
            userPins = inMemoryLoadedData.userPins;
        }
        saveUserData(); triggerAutoSave();
        renderUserManagement();
        showToast('已撤销，用户已恢复', 'info', 2000);
    });
}
