// @file js/64-transaction-submit.js
// 编辑交易表单与转账表单的 submit 处理(保存逻辑)。

$('editTransactionModal').addEventListener('hidden.bs.modal', onSubModalHide);

$('edit-transaction-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const keepOpen = _transKeepOpen;      // “保存并再记”：保存后窗口不关
    _transKeepOpen = false;
    commitTransAmount();                  // 金额框里如果是算式 (12+8.5)，先算成数字
    const mode = $('edit-trans-mode').value;
    if (mode === 'view') return; // 只读模式不保存
    const date = $('edit-trans-date').value;
    const type = $('edit-trans-type').value;
    const accountId = $('edit-trans-account').value;
    const attachmentId = $('edit-trans-attachment-id')?.value || '';

    // 取分录（内联多笔）
    let itemsData = getInlineItems();
    // 拆分模式下如果 getInlineItems 返回 null，说明验证未通过（alert已弹），直接停止
    if (_inSplitMode && itemsData === null) return;

    // 只剩一条有效分录：先确认，再按单笔保存（否则“拆分至少两条”会把用户困死在拆分模式里）
    if (itemsData && itemsData.length === 1) {
        const ok = await uiConfirm('当前只有一条有效分录，是否按单笔交易保存？', {
            okText: '按单笔保存', cancelText: '返回补充'
        });
        if (!ok) return;
        convertSplitToSingle(itemsData[0]);
        itemsData = null;
    }

    // 拆分交易的标签/备注由各分录自己保存，不再写一份到顶层；
    // 否则导出 CSV 时，没填标签的分录会继承整笔标签，和应用内显示不一致
    const tags = itemsData ? '' : $('edit-trans-tags').value;
    const desc = itemsData ? '' : $('edit-trans-desc').value;

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
        hideDescSuggest();
        resetAttachmentUI();
        if (verboseToast) showToast(keepOpen ? '已添加，继续记下一笔' : '已添加', 'success', 1500);
        if ($('view-stats').classList.contains('active-view')) renderStats();
        if (keepOpen) {
            amountPadReset();             // 金额清空，账户/日期/分类保留，数字键盘回到可用状态
        } else {
            bootstrap.Modal.getInstance($('editTransactionModal')).hide();   // 普通“保存”：保存后关闭
            maybeReturnToDetail();
        }
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
    if (isNaN(newFee)) { uiAlert('手续费金额无效（没有手续费请留空）'); return; }

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
        if (!tIn) { uiAlert('找不到配对的转账记录（可能已被删除），请关闭后重新打开这笔转账'); return; }

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
