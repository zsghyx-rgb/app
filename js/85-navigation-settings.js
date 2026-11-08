// @file js/85-navigation-settings.js
// switchTab 主标签切换、设置菜单/子页、孤儿附件扫描与清理。

function switchTab(t, el) {
    if (t !== 'stats' && _statsRenderRaf) { cancelAnimationFrame(_statsRenderRaf); _statsRenderRaf = 0; }
    ['editTransactionModal','accountModal','plannedModal'].forEach(id => {
        const inst = bootstrap.Modal.getInstance($(id));
        if (inst) inst.hide();
    });
    $$('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
    openedFromDetail = false;
    if (t !== 'account-detail') currentDetailAccountId = null;

    $$('.view-section').forEach(v => v.classList.remove('active-view'));
    const viewEl = $(`view-${t}`);
    if (viewEl) viewEl.classList.add('active-view');
    $$('.nav-link').forEach(n => n.classList.remove('active'));
    if (el) el.classList.add('active');

    const fab = $('mobile-fab-group');
    // 桌面端下始终隐藏悬浮按钮
    if (fab) fab.classList.toggle('d-none', t !== 'transactions' || window.innerWidth > 768);

    if (t === 'stats') {
        // 先让标签页切换完成并画出一帧，再做图表计算，避免点击时整页卡住
        if (_statsRenderRaf) cancelAnimationFrame(_statsRenderRaf);
        _statsRenderRaf = requestAnimationFrame(() => {
            _statsRenderRaf = 0;
            renderStats();
            maybeShowInsight();
        });
    }
    if (t === 'settings') { showSettingsMenu(); renderExchangeRateSettings(); initPasswordHint(); renderUserManagement(); renderThemeSettings(); }
}

function renderSettingsUserCard() {
    const nameEl = $('settings-user-name');
    const subEl  = $('settings-user-sub');
    const avEl   = $('settings-user-avatar');
    const name = currentUserName || '未登录';
    if (nameEl) nameEl.textContent = name;
    if (avEl) avEl.textContent = name.charAt(0).toUpperCase();
    if (subEl) {
        const mode = offlineMode ? '离线模式' : '在线 · 表格同步';
        subEl.textContent = mode + (hasUnsavedChanges ? ' · 有未同步改动' : '');
    }
}

function showSettingsMenu() {
    $('settings-menu').style.display = 'block';
    $$('.settings-subpage').forEach(function(el) { el.classList.remove('active'); });
    renderSettingsUserCard();
    renderThemeSettings();
}
function showSettingsSubpage(name) {
    $('settings-menu').style.display = 'none';
    $$('.settings-subpage').forEach(function(el) { el.classList.remove('active'); });
    var sub = $('settings-sub-' + name);
    if (sub) sub.classList.add('active');
    if (name === 'exchange-rate') renderExchangeRateSettings();
    if (name === 'categories') renderCategorySettings();
    if (name === 'users') { renderUserManagement(); initPasswordHint(); renderHiddenAccountsList(); }
    if (name === 'password') initPasswordHint();
    if (name === 'planned') renderPlannedTransactions();
    if (name === 'orphan-attachments') { $('orphan-attachments-result').innerHTML = ''; }
}

// ── 清理孤立附件 ────────────────────────────────────────────
async function scanOrphanAttachments(btn) {
    if (!GAS_URL) { showToast('请先配置 GAS URL', 'warning'); return; }
    const result = $('orphan-attachments-result');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>扫描中…';
    result.innerHTML = '';
    try {
        // 收集所有交易里用到的附件 ID
        const usedIds = new Set();
        transactions.forEach(t => {
            if (t.attachmentId) {
                t.attachmentId.split(',').forEach(id => {
                    const raw = id.trim().replace(/^pdf:/, '');
                    if (raw) usedIds.add(raw);
                });
            }
        });

        // 拉取 Drive 上的附件列表
        const listResp = await fetch(gasRequestUrl({ action: 'listAttachments' }));
        if (!listResp.ok) throw new Error('无法获取附件列表，请确认 GAS 已更新并重新部署');
        const allFiles = await listResp.json();
        if (!Array.isArray(allFiles)) throw new Error('GAS 返回格式错误，请确认 GAS 已更新');

        const orphans = allFiles.filter(f => !usedIds.has(f.id));

        if (orphans.length === 0) {
            result.innerHTML = '<div class="alert alert-success py-2 small mb-0"><i class="bi bi-check-circle me-1"></i>没有发现孤立附件，Drive 很干净！</div>';
            return;
        }

        // 渲染孤立附件列表
        let html = `<div class="d-flex justify-content-between align-items-center mb-2">
            <span class="small text-muted">发现 <b>${orphans.length}</b> 个孤立附件</span>
            <button class="btn btn-sm btn-danger" onclick="deleteAllOrphans(this)">
                <i class="bi bi-trash me-1"></i>全部删除
            </button>
        </div>`;
        html += '<div id="orphan-list">';
        orphans.forEach(f => {
            const sizeKB = Math.round(f.size / 1024);
            const isImage = /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name || '') || /^image\//.test(f.mimeType || '');
            const nameHtml = isImage
                ? `<span class="flex-grow-1 small text-truncate text-primary" style="cursor:pointer;text-decoration:underline;" title="点击查看图片：${_escHtml(f.name)}" onclick="viewOrphanAttachmentImage('${_escHtml(f.id)}')">${_escHtml(f.name)}</span>`
                : `<span class="flex-grow-1 small text-truncate" title="${_escHtml(f.name)}">${_escHtml(f.name)}</span>`;
            html += `<div class="d-flex align-items-center gap-2 py-1 border-bottom" data-file-id="${_escHtml(f.id)}">
                <i class="bi ${isImage ? 'bi-file-earmark-image' : 'bi-file-earmark'} text-muted"></i>
                ${nameHtml}
                <span class="small text-muted flex-shrink-0">${sizeKB}KB</span>
                <button class="btn btn-sm btn-outline-danger py-0 px-2 flex-shrink-0"
                    onclick="deleteSingleOrphan(this, '${_escHtml(f.id)}')">
                    <i class="bi bi-trash"></i>
                </button>
            </div>`;
        });
        html += '</div>';
        result.innerHTML = html;
    } catch(err) {
        result.innerHTML = `<div class="alert alert-danger py-2 small mb-0"><i class="bi bi-exclamation-triangle me-1"></i>${_escHtml(err.message)}</div>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-search me-1"></i>重新扫描';
    }
}

function viewOrphanAttachmentImage(fileId) {
    const url = getDriveAttachmentUrl(fileId);
    window.open(url, '_blank');
}

async function deleteSingleOrphan(btn, fileId) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    try {
        const resp = await fetch(gasRequestUrl({ action: 'deleteAttachment', fileId }));
        const text = (await resp.text()).trim();
        if (text !== 'OK') throw new Error(text);
        const row = btn.closest('[data-file-id]');
        if (row) row.remove();
        // 更新计数
        const remaining = $$('#orphan-list [data-file-id]').length;
        const countEl = $('orphan-attachments-result').querySelector('b');
        if (countEl) countEl.textContent = remaining;
        if (remaining === 0) {
            $('orphan-attachments-result').innerHTML = '<div class="alert alert-success py-2 small mb-0"><i class="bi bi-check-circle me-1"></i>所有孤立附件已删除！</div>';
        }
    } catch(err) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-trash"></i>';
        showToast('删除失败：' + err.message, 'error');
    }
}

async function deleteAllOrphans(btn) {
    const rows = $$('#orphan-list [data-file-id]');
    if (rows.length === 0) return;
    if (!(await uiConfirm(`确定删除全部 ${rows.length} 个孤立附件？此操作不可撤销。`, { title: '删除孤立附件', okText: `删除 ${rows.length} 个`, danger: true }))) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>删除中…';
    let failed = 0;
    for (const row of rows) {
        const fileId = row.dataset.fileId;
        try {
            const resp = await fetch(gasRequestUrl({ action: 'deleteAttachment', fileId }));
            const text = (await resp.text()).trim();
            if (text !== 'OK') throw new Error(text);
            row.remove();
        } catch(_) { failed++; }
    }
    if (failed === 0) {
        $('orphan-attachments-result').innerHTML = '<div class="alert alert-success py-2 small mb-0"><i class="bi bi-check-circle me-1"></i>所有孤立附件已删除！</div>';
    } else {
        btn.disabled = false;
        btn.innerHTML = `<i class="bi bi-trash me-1"></i>全部删除`;
        showToast(`${failed} 个文件删除失败，请重试`, 'warning');
    }
}
