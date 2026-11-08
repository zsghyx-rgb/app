// @file js/45-import-export.js
// JSON 导出与交易/转账 CSV 导入导出。

async function exportJsonData() {
    saveUserData();
    if (!(await uiConfirm('JSON 为明文格式，所有数据均可见（包括密码保护的内容）。确认导出？', { title: '导出明文 JSON', okText: '仍然导出', danger: true }))) return;
    const blob = new Blob([JSON.stringify(inMemoryLoadedData, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ledger_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    clearUnsavedFlag();
    if (verboseToast) showToast('JSON已导出', 'success');
}

function exportTransactionCsv() {
    let csv = '日期,类型,金额,类别,所有者,账户,备注,标签\n';
    const csvField = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    transactions.filter(t => !t.isTransfer).forEach(t => {
        const acc = accounts.find(a => a.id == t.accountId);
        const accName = acc?.name || '';
        if (t.items && t.items.length > 1) {
            t.items.forEach(it => {
                const desc = it.desc !== undefined && it.desc !== '' ? it.desc : (t.desc || '');
                const tags = it.tags !== undefined && it.tags !== '' ? it.tags : (t.tags || '');
                csv += `${t.date},${t.type},${Math.abs(it.amount)},${csvField(it.category)},${csvField(t.ownerName)},${csvField(accName)},${csvField(desc)},${csvField(tags)}\n`;
            });
        } else {
            csv += `${t.date},${t.type},${Math.abs(t.amount)},${csvField(t.category)},${csvField(t.ownerName)},${csvField(accName)},${csvField(t.desc)},${csvField(t.tags)}\n`;
        }
    });
    const blob = new Blob(['\ufeff' + csv], {type: 'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `transactions_${currentUserName}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
}

function exportTransferCsv() {
    let csv = '日期,转出用户名,转出账户,转出金额,转入用户名,转入账户,转入金额,备注\n';
    const csvField = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const transfers = transactions.filter(t => t.isTransfer && t.type === 'expense');
    transfers.forEach(tOut => {
        const accFrom = accounts.find(a => a.id == tOut.accountId);
        const accTo = accounts.find(a => a.id == tOut.relatedAccountId);
        if (!accFrom || !accTo) return;

        let tIn;
        if (tOut.transferPairId) {
            tIn = transactions.find(t => t.transferPairId === tOut.transferPairId && t.type === 'income');
        } else {
            tIn = transactions.find(t => t.isTransfer && t.type === 'income' && t.date === tOut.date && t.relatedAccountId == tOut.accountId);
        }

        const amountIn = tIn ? Math.abs(tIn.amount) : Math.abs(tOut.amount);
        let descClean = tOut.desc || '';
        if (descClean.includes(': ')) descClean = descClean.split(': ')[1];
        csv += `${tOut.date},${csvField(tOut.ownerName)},${csvField(accFrom.name)},${Math.abs(tOut.amount)},${csvField(accTo.ownerName)},${csvField(accTo.name)},${amountIn},${csvField(descClean)}\n`;
    });
    const blob = new Blob(['\ufeff' + csv], {type: 'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `transfers_${currentUserName}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
}

function importTransactionCsv() {
    const file = $('transaction-csv-input').files[0];
    if (!file) return;
    const clean = (str) => str ? str.trim().replace(/^["']|["']$/g, '').trim() : '';
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const rows = text.split(/\r\n|\n|\r/).filter(r => r.trim());
        if (rows.length < 2) { uiAlert('CSV文件似乎是空的'); return; }
        let successCount = 0, failLog = [];
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(',').map(clean);
            if (cols.length < 6) continue;
            let [date, typeStr, amt, cat, owner, accName, note, tags] = cols;
            let acc = userAccounts.find(a => a.name === accName);
            if (!acc) {
                if (failLog.length < 3) failLog.push(`第 ${i+1} 行: 账户 "[${accName}]" 不存在`);
                continue;
            }
            const type = (typeStr.includes('支出') || typeStr.toLowerCase() === 'expense') ? 'expense' : 'income';
            const cleanAmt = parseFloat(amt.replace(/,/g, ''));
            transactions.unshift({
                id: Date.now() + i + Math.random(),
                date, type,
                accountId: acc.id,
                amount: type === 'expense' ? -Math.abs(cleanAmt) : Math.abs(cleanAmt),
                category: cat, desc: note || '', ownerName: currentUserName,
                tags: tags || '', isTransfer: false, updatedAt: Date.now()
            });
            successCount++;
        }
        saveUserData(); triggerAutoSave(); loadAllData(); filterUserData();
        displayedTransactionCount = 100;
        renderAllTransactions(); renderAccounts();
        if (failLog.length > 0) uiAlert(`导入完成。成功: ${successCount}。失败原因:\n${failLog.join('\n')}`);
        else if (successCount === 0) uiAlert('导入失败：没有成功导入任何数据');
        else uiAlert(`成功导入 ${successCount} 条记录`);
    };
    reader.readAsText(file);
}

function importTransferCsv() {
    const file = $('transfer-csv-input').files[0];
    if (!file) return;
    const clean = (str) => str ? str.trim().replace(/^["']|["']$/g, '').trim() : '';
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const rows = text.split(/\r\n|\n|\r/).filter(r => r.trim());
        if (rows.length < 2) { uiAlert('CSV文件似乎是空的'); return; }
        let successCount = 0, failLog = [];
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(',').map(clean);
            if (cols.length < 7) continue;
            let [date, fromOwner, fromAccName, amtOut, toOwner, toAccName, amtIn, note] = cols;
            const accFrom = accounts.find(a => a.name === fromAccName && a.ownerName === fromOwner);
            const accTo = accounts.find(a => a.name === toAccName && a.ownerName === toOwner);
            if (!accFrom || !accTo) {
                if (failLog.length < 3) failLog.push(`第 ${i+1} 行: 找不到账户`);
                continue;
            }
            const cleanAmtOut = parseFloat(amtOut.replace(/,/g, ''));
            const cleanAmtIn = parseFloat(amtIn.replace(/,/g, ''));
            const uniqueId = Date.now() + i + Math.random();
            const fromLabel = getAccountDisplayName(accFrom);
            const toLabel = getAccountDisplayName(accTo);
            transactions.unshift({
                id: uniqueId, date, type: 'expense', accountId: accFrom.id,
                amount: -Math.abs(cleanAmtOut), category: '',
                desc: note || '', ownerName: fromOwner,
                isTransfer: true, relatedAccountId: accTo.id, transferPairId: uniqueId, updatedAt: Date.now()
            });
            transactions.unshift({
                id: uniqueId + 0.1, date, type: 'income', accountId: accTo.id,
                amount: Math.abs(cleanAmtIn), category: '',
                desc: note || '', ownerName: toOwner,
                isTransfer: true, relatedAccountId: accFrom.id, transferPairId: uniqueId, updatedAt: Date.now()
            });
            successCount++;
        }
        saveUserData(); triggerAutoSave(); loadAllData(); filterUserData();
        renderAllTransactions(); renderAccounts();
        if (failLog.length > 0) uiAlert(`导入完成。成功: ${successCount}。失败原因:\n${failLog.join('\n')}`);
        else if (successCount === 0) uiAlert('导入失败');
        else uiAlert(`成功导入 ${successCount} 条转账`);
    };
    reader.readAsText(file);
}
