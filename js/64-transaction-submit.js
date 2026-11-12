// @file js/64-transaction-submit.js
// 编辑交易表单与转账表单的 submit 处理(保存逻辑)。

$('editTransactionModal').addEventListener('hidden.bs.modal', onSubModalHide);

$('edit-transaction-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const mode = $('edit-trans-mode').value;
    if (mode === 'view') return; // 只读模式不保存
    const date = $('edit-trans-date').value;
    const type = $('edit-trans-type').value;
    const accountId = $('edit-trans-account').value;
    const tags = $('edit-trans-tags').value;
    const desc = $('edit-trans-desc').value;
    const attachmentId = $('edit-trans-attachment-id')?.value || '';
    
    // 取分录（内联多笔）
    const itemsData = getInlineItems();
    // 拆分模式下如果 getInlineItems 返回 null，说明验证未通过（alert已弹），直接停止
    if (_inSplitMode && itemsData === null) return;
    let category, finalAmount;
    if (itemsData) {
        finalAmount = roundMoney(itemsData.reduce((s, it) => s + it.amount, 0));
        category = itemsData[0].category;
    } else {
        $('edit-trans-category').removeAttribute('disabled');
        category = $('edit-trans-category').value;
        const amount = parseFloat($('edit-trans-amount').value);
        if (isNaN(amount) || amount <= 0) { uiAlert('请输入有效金额'); return; }
        finalAmount = roundMoney(type === 'expense' ? -Math.abs(amount) : Math.abs(amount));
    }

    if (mode === 'add') {
        // 只有单笔才记住分类，多笔不记
        if (!itemsData) _lastTransPrefs = { type, accountId, category };
        else _lastTransPrefs = { type, accountId, category: _lastTransPrefs.category };
        transactions.unshift({
            id: Date.now() + Math.random(), date, type, accountId,
            amount: finalAmount, category, tags, desc,
            ...(itemsData ? { items: itemsData } : {}),
            ...(attachmentId ? { attachmentId } : {}),
            ownerName: currentUserName, isTransfer: false, updatedAt: Date.now()
        });
        saveUserData(); triggerAutoSave(); loadAllData(); filterUserData();
        displayedTransactionCount = 100; renderAllTransactions(); renderAccounts();
        // renderAccounts()->updateSelectOptions() resets dropdowns, manually restore
        $('edit-trans-account').value = accountId; accSelectSync('edit-trans-account');
        const catEl = $('edit-trans-category');
        if (catEl && !itemsData) {
            const opt = [...catEl.options].find(o => o.value === category);
            if (opt) catEl.value = category;
        }
        catGridSync('edit-trans-category', 'cat-grid-edit-trans-category');
        if (currentDetailAccountId) refreshDetailContent(currentDetailAccountId);
        resetInlineItems();
        $('edit-trans-tags').value = '';
        $('edit-trans-desc').value = '';
        const hintEl = $('edit-trans-desc-hint');
        if (hintEl) hintEl.style.display = 'none';
        resetAttachmentUI();
        if (verboseToast) showToast('已添加', 'success', 1500);
        if ($('view-stats').classList.contains('active-view')) renderStats();
    } else {
        const id = parseFloat($('edit-trans-id').value);
        const t = transactions.find(x => x.id === id);
        if (t) {
            t.date = date; t.type = type; t.accountId = accountId;
            t.category = category; t.amount = finalAmount; t.tags = tags; t.desc = desc;
            if (itemsData) t.items = itemsData; else delete t.items;
            if (attachmentId) t.attachmentId = attachmentId; else delete t.attachmentId;
            t.updatedAt = Date.now();
            saveUserData(); triggerAutoSave(); filterUserData();
            displayedTransactionCount = 100;
            renderAllTransactions(); renderAccounts();
            if ($('view-stats').classList.contains('active-view')) renderStats();
            showToast('交易已更新', 'success', 2000);
            bootstrap.Modal.getInstance($('editTransactionModal')).hide();
            maybeReturnToDetail();
        }
    }
});

$('edit-transfer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const mode = $('edit-transfer-mode').value;
    const newDate = $('edit-transfer-date').value;
    const newFromId = $('edit-transfer-from').value;
    const newToId = $('edit-transfer-to').value;
    const newAmtOut = parseFloat($('edit-transfer-amount-out').value);
    const newDesc = $('edit-transfer-desc').value;
    const newFee = _transferFeeValue();     // 0 = 无手续费；NaN = 输入无效

    if (newFromId === newToId) { uiAlert('转出账户和转入账户不能相同'); return; }

    const accFrom = accounts.find(a => a.id == newFromId);
    const accTo = accounts.find(a => a.id == newToId);
    if (!accFrom || !accTo) { uiAlert('账户不存在'); return; }
    // 同币种时转入金额一定等于转出金额（转入框是隐藏的）；跨币种才读转入框
    const newAmtIn = accFrom.currency === accTo.currency ? newAmtOut : parseFloat($('edit-transfer-amount-in').value);
    if (isNaN(newAmtOut) || isNaN(newAmtIn) || newAmtOut <= 0 || newAmtIn <= 0) { uiAlert('请输入有效的转账金额'); return; }
    if (isNaN(newFee)) { uiAlert('请输入有效的手续费金额（或留空表示没有手续费）'); return; }

    if (mode === 'add') {
        const uniqueId = Date.now() + Math.random();
        transactions.unshift({
            id: uniqueId, date: newDate, type: 'expense', accountId: newFromId,
            amount: -Math.abs(newAmtOut), category: '',
            desc: newDesc, ownerName: currentUserName,
            isTransfer: true, relatedAccountId: newToId, transferPairId: uniqueId, updatedAt: Date.now()
        });
        transactions.unshift({
            id: uniqueId + 0.1, date: newDate, type: 'income', accountId: newToId,
            amount: Math.abs(newAmtIn), category: '',
            desc: newDesc, ownerName: accTo.ownerName,
            isTransfer: true, relatedAccountId: newFromId, transferPairId: uniqueId, updatedAt: Date.now()
        });
        if (newFee > 0) applyTransferFee(transactions.find(x => x.id === uniqueId), newFee, newDate, newFromId, newDesc);
        saveUserData(); triggerAutoSave(); loadAllData(); filterUserData();
        displayedTransactionCount = 100; renderAllTransactions(); renderAccounts();
        // 若在账户详情页，只刷新内容（不触发switchTab，保持modal开着）
        if (currentDetailAccountId) refreshDetailContent(currentDetailAccountId);
        // 保持模态窗打开，清空金额/备注，不聚焦
        $('edit-transfer-amount-out').value = '';
        $('edit-transfer-amount-in').value = '';
        $('edit-transfer-desc').value = '';
        resetTransferFeeUI();
        if (verboseToast) showToast('已添加', 'success', 1500);
        if ($('view-stats').classList.contains('active-view')) renderStats();
    } else {
        const id = parseFloat($('edit-transfer-id').value);
        const tOut = transactions.find(x => x.id === id);
        if (!tOut || !tOut.isTransfer) { uiAlert('找不到转账记录'); return; }

        const tIn = resolveTransferPair(tOut).tIn;
        if (!tIn) { uiAlert('找不到配对的转账记录（另一半可能已被删除）。请关闭后在转账记录上重新点开处理。'); return; }

        tOut.date = newDate; tOut.accountId = newFromId; tOut.relatedAccountId = newToId;
        tOut.amount = -Math.abs(newAmtOut); tOut.desc = newDesc;
        tOut.updatedAt = Date.now();
        tIn.date = newDate; tIn.accountId = newToId; tIn.relatedAccountId = newFromId;
        tIn.amount = Math.abs(newAmtIn); tIn.desc = newDesc;
        tIn.ownerName = accTo.ownerName;
        tIn.updatedAt = Date.now();
        applyTransferFee(tOut, newFee, newDate, newFromId, newDesc);

        saveUserData(); triggerAutoSave(); filterUserData();
        displayedTransactionCount = 100;
        renderAllTransactions(); renderAccounts();
        if ($('view-stats').classList.contains('active-view')) renderStats();
        showToast('转账已更新', 'success', 2000);
        bootstrap.Modal.getInstance($('editTransactionModal')).hide();
        maybeReturnToDetail();
    }
});
