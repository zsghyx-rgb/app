// @file js/70-attachments-hints.js
// 备注相似度提示、历史分类匹配、附件(图片压缩/上传/缩略图)、历史分类检查、筛选面板开关。

/**
 * 计算两个字符串的相似度分（0~10）
 * 优先：完全一致 > 包含关系 > 字符重叠率
 */
function descSimilarityScore(a, b) {
    if (!a || !b) return 0;
    const al = a.toLowerCase(), bl = b.toLowerCase();
    if (al === bl) return 10;
    if (al.includes(bl) || bl.includes(al)) {
        const shorter = Math.min(al.length, bl.length);
        const longer  = Math.max(al.length, bl.length);
        return 5 * (shorter / longer);
    }
    const setA = new Set(al.split(''));
    const setB = new Set(bl.split(''));
    const inter = [...setA].filter(c => setB.has(c)).length;
    const union = new Set([...setA, ...setB]).size;
    const ratio = inter / union;
    return ratio >= 0.6 ? ratio * 3 : 0;
}

/**
 * 根据历史交易备注，推断最佳分类和账户
 * 返回 { category, accountId, count } 或 null
 */
function findBestCategoryFromHistory(desc, type) {
    if (!desc || desc.trim().length < 2) return null;
    const pool = transactions.filter(t =>
        !t.isTransfer && t.ownerName === currentUserName && t.desc && t.category
    );
    if (pool.length === 0) return null;

    const catScores = {};
    pool.forEach(t => {
        const score = descSimilarityScore(desc, t.desc);
        if (score === 0) return;
        if (type === 'expense' && !categories.expense.includes(t.category)) return;
        if (type === 'income'  && !categories.income.includes(t.category))  return;
        if (!catScores[t.category]) catScores[t.category] = { score: 0, accCounts: {} };
        catScores[t.category].score += score;
        catScores[t.category].accCounts[t.accountId] =
            (catScores[t.category].accCounts[t.accountId] || 0) + 1;
    });

    if (Object.keys(catScores).length === 0) return null;

    const [bestCat, bestData] = Object.entries(catScores)
        .sort((a, b) => b[1].score - a[1].score)[0];

    const bestAccId = Object.entries(bestData.accCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0];

    const count = Object.values(catScores[bestCat].accCounts)
        .reduce((s, n) => s + n, 0);

    return { category: bestCat, accountId: bestAccId ? Number(bestAccId) : null, count };
}

/**
 * 更新备注输入框下方的提示气泡
 */
function updateDescHint(descId, hintId, typeId, catId, accId) {
    const desc = $(descId)?.value || '';
    const type = $(typeId)?.value || 'expense';
    const hint = $(hintId);
    if (!hint) return;
    if (desc.trim().length < 2) { hint.style.display = 'none'; return; }
    // 多笔模式下不推荐分类（一备注对多分类，推荐无意义）
    if (_inSplitMode) { hint.style.display = 'none'; return; }

    const result = findBestCategoryFromHistory(desc, type);
    if (!result) { hint.style.display = 'none'; return; }

    hint.style.display = 'flex';
    hint.innerHTML =
        `<span style="flex:1;">💡 <b>${result.category}</b>` +
        ` <span style="color:var(--bs-secondary);font-size:0.72rem;">(${result.count}次)</span></span>` +
        `<button type="button" class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size:0.73rem;"` +
        ` onclick="applyDescHint('${catId}','${result.category}')">应用</button>`;
}


function getDriveAttachmentUrl(fileId) {
    // 使用 Google Drive 直接预览链接
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
}

function resetAttachmentUI() {
    const inputFile = $('attachment-file-input');
    const container = $('attachment-preview-container');
    const idField = $('edit-trans-attachment-id');
    if (inputFile) inputFile.value = '';
    if (container) {
        container.innerHTML = '';
        container.style.setProperty('display', 'none', 'important');
    }
    if (idField) idField.value = '';
}

async function compressImage(file, maxKB = 500) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onerror = () => resolve(file); // 图片解码失败时降级用原文件
            img.onload = () => {
                let quality = 0.85;
                let w = img.width, h = img.height;
                // 若尺寸超大先等比缩小
                const maxPx = 1920;
                if (w > maxPx || h > maxPx) {
                    const ratio = Math.min(maxPx / w, maxPx / h);
                    w = Math.round(w * ratio);
                    h = Math.round(h * ratio);
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);

                const tryCompress = (q) => {
                    canvas.toBlob(blob => {
                        if (!blob) { resolve(file); return; }
                        if (blob.size <= maxKB * 1024 || q < 0.2) {
                            resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                        } else {
                            tryCompress(Math.max(q - 0.1, 0.15));
                        }
                    }, 'image/jpeg', q);
                };
                tryCompress(quality);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// 1. 全局状态变量
let isUploadingAttachment = false;

// 2. 拦截模态框关闭（在 window load 中初始化）
window.addEventListener('load', () => {
    const editModalEl = document.getElementById('editTransactionModal');
    editModalEl.addEventListener('hide.bs.modal', function (event) {
        if (isUploadingAttachment) {
            event.preventDefault(); // 阻止关闭
            uiAlert('图片正在同步至网盘，请稍候...');
        }
    });
    editModalEl.addEventListener('hidden.bs.modal', function () {
        // 后台同步有新数据待刷新时，在表单关闭后执行
        if (window._pendingUIRefresh) {
            window._pendingUIRefresh = false;
            loadAllData();
            filterUserData();
            renderAllTransactions();
            renderAccounts();
            if (verboseToast) showToast('已刷新最新数据', 'success', 2500);
        }
    });
    updateTransferModeButton();
});

// 3. 处理文件选择与上传
async function handleAttachmentSelected(input) {
    const file = input.files[0];
    if (!file) return;

    const isPdf = file.type === 'application/pdf';

    let currentIds = $('edit-trans-attachment-id').value ? $('edit-trans-attachment-id').value.split(',').filter(id => id.trim()) : [];
    if (currentIds.length >= 3) {
        uiAlert('最多只能上传 3 个附件');
        input.value = '';
        return;
    }

    isUploadingAttachment = true;
    $('edit-trans-submit-btn').disabled = true;

    try {
        let base64Data, fileName, mimeType, fileSizeKB;

        if (isPdf) {
            showToast('上传中…', 'progress', 0);
            base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result.split(',')[1]);
                reader.onerror = () => reject(new Error('文件读取失败'));
                reader.readAsDataURL(file);
            });
            fileName = file.name || `attach_${Date.now()}.pdf`;
            mimeType = 'application/pdf';
            fileSizeKB = Math.round(file.size / 1024);
        } else {
            showToast('压缩中…', 'progress', 0);
            const compressedFile = await compressImage(file, 500);
            showToast('上传中…', 'progress', 0);
            base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result.split(',')[1]);
                reader.onerror = () => reject(new Error('文件读取失败'));
                reader.readAsDataURL(compressedFile);
            });
            fileName = `attach_${Date.now()}.jpg`;
            mimeType = 'image/jpeg';
            fileSizeKB = Math.round(compressedFile.size / 1024);
        }

        const response = await fetch(`${GAS_URL}?token=${encodeURIComponent(GAS_TOKEN)}`, {
            method: 'POST',
            body: JSON.stringify({ action: 'uploadAttachment', filename: fileName, mimeType, data: base64Data }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await response.json();

        if (result.fileId) {
            const storedId = isPdf ? `pdf:${result.fileId}` : result.fileId;
            currentIds.push(storedId);
            $('edit-trans-attachment-id').value = currentIds.join(',');
            renderAttachmentThumbs(currentIds);
            showToast(`已上传（${fileSizeKB}KB）`, 'success', 3000);
        } else {
            showToast('上传失败：' + (result.error || '未知错误'), 'error');
        }
    } catch (err) {
        showToast('上传失败：' + err.message, 'error');
    } finally {
        isUploadingAttachment = false;
        $('edit-trans-submit-btn').disabled = false;
        input.value = '';
    }
}


// 4. 渲染多张缩略图（图片显示缩略图，PDF显示图标）
function renderAttachmentThumbs(ids) {
    const container = $('attachment-preview-container');
    container.innerHTML = '';

    if (!ids || ids.length === 0) {
        container.style.setProperty('display', 'none', 'important');
        return;
    }

    container.style.setProperty('display', 'flex', 'important');
    ids.forEach((id, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'thumb-wrapper';

        const isPdf = id.startsWith('pdf:');
        const rawId = isPdf ? id.slice(4) : id;

        if (isPdf) {
            const downloadUrl = `https://drive.google.com/uc?id=${rawId}&export=download`;
            wrapper.innerHTML = `
                <div class="thumb-img d-flex flex-column align-items-center justify-content-center gap-1"
                     style="background:var(--bs-tertiary-bg);border-radius:6px;cursor:pointer;font-size:0.7rem;color:var(--bs-secondary);padding:4px;"
                     onclick="window.open('${downloadUrl}', '_blank')" title="点击下载 PDF">
                    <i class="bi bi-file-earmark-pdf" style="font-size:1.8rem;color:var(--app-expense);"></i>
                    <span>PDF</span>
                </div>
                <button type="button" class="thumb-remove" onclick="removeSpecificAttachment(${index})">✕</button>
            `;
        } else {
            const url = `https://drive.google.com/thumbnail?id=${rawId}&sz=w800`;
            wrapper.innerHTML = `
                <img src="${url}" class="thumb-img" onclick="window.open('${url}', '_blank')">
                <button type="button" class="thumb-remove" onclick="removeSpecificAttachment(${index})">✕</button>
            `;
        }
        container.appendChild(wrapper);
    });
}

// 5. 删除特定位置的图片（直接删 + 可撤销，不再弹原生确认框）
function removeSpecificAttachment(index) {
    const rawVal = $('edit-trans-attachment-id').value;
    let ids = rawVal ? rawVal.split(',').filter(id => id.trim()) : [];
    const removed = ids[index];
    if (!removed) return;
    ids.splice(index, 1);
    $('edit-trans-attachment-id').value = ids.join(',');
    renderAttachmentThumbs(ids);
    showToast('附件已删除', 'success', 2000);
    showUndo('已删除 1 个附件', () => {
        const cur = ($('edit-trans-attachment-id').value || '').split(',').filter(x => x.trim());
        cur.splice(index, 0, removed);
        $('edit-trans-attachment-id').value = cur.join(',');
        renderAttachmentThumbs(cur);
        showToast('已撤销，附件已恢复', 'info', 2000);
    });
}

// 6. 全屏预览


function applyDescHint(catId, category) {
    const catEl = $(catId);
    if (!catEl) return;
    catEl.value = category;
    catEl.dispatchEvent(new Event('change', { bubbles: true }));
    // 分类下拉是隐藏的 <select>，真正显示给用户的是 .cat-grid 按钮组，
    // 之前只更新了隐藏 select 的 value 而没有同步可见的按钮高亮，
    // 导致用户点击“应用”后界面看起来分类并没有变化（实际数据已变但未渲染）。
    catGridSync(catId, 'cat-grid-' + catId);
}
/**
 * 自动校对：基于历史记忆，检测分类与相似备注不一致的交易
 *
 * 两种问题：
 *  1. 孤立分类：分类已不在当前分类列表里（被删/改名过）。会根据这批交易的备注，
 *     用和「新增交易界面识别推荐分类」相同的逻辑（findBestCategoryFromHistory）
 *     给出一个建议分类，用户可以一键应用，也可以手动输入别的。
 *  2. 相似备注但分类不一致：同/近似备注历史上大多数都归到 A，这一笔却归到 B，
 *     给出建议分类，用户确认后一键修改。
 */
async function checkHistoryCategories() {
    const suspects = [];

    // ── 第一步：孤立分类（优先级最高，排在最前）──
    const allValidCats = new Set([...categories.expense, ...categories.income]);
    const orphanTrans = transactions.filter(t =>
        !t.isTransfer && t.ownerName === currentUserName && !t._isBaseline && t.category &&
        !allValidCats.has(t.category)
    );
    // 去重：同一个孤立分类只提示一次
    const orphanGroups = {};
    orphanTrans.forEach(t => {
        if (!orphanGroups[t.category]) orphanGroups[t.category] = [];
        orphanGroups[t.category].push(t);
    });
    Object.entries(orphanGroups).forEach(([orphanCat, txList]) => {
        // 给孤立分类算一个建议：对这批交易逐条用备注查历史推荐，
        // 再按「被推荐的分类」出现次数聚合，取最多的那个作为建议。
        const type = txList[0].amount > 0 ? 'income' : 'expense';
        const suggCounts = {};
        txList.forEach(t => {
            const r = findBestCategoryFromHistory(t.desc, type);
            if (r && r.category) suggCounts[r.category] = (suggCounts[r.category] || 0) + 1;
        });
        let suggested = null, suggHits = 0;
        Object.entries(suggCounts).forEach(([c, n]) => { if (n > suggHits) { suggested = c; suggHits = n; } });
        suspects.push({ isOrphan: true, orphanCat, txList, type, t: txList[0], suggested, suggHits });
    });

    // ── 第二步：相似备注但分类不一致 ──
    const myTrans = transactions.filter(t =>
        !t.isTransfer && !t._isBaseline && t.ownerName === currentUserName && t.desc && !(t.items && t.items.length > 1)
    );
    myTrans.forEach(t => {
        const type = t.amount > 0 ? 'income' : 'expense';
        const pool = myTrans.filter(x => x !== t && x.category && !(x.items && x.items.length > 1));
        const catScores = {};
        pool.forEach(x => {
            const score = descSimilarityScore(t.desc, x.desc);
            if (score === 0) return;
            if (type === 'expense' && !categories.expense.includes(x.category)) return;
            if (type === 'income'  && !categories.income.includes(x.category))  return;
            catScores[x.category] = (catScores[x.category] || 0) + score;
        });
        if (Object.keys(catScores).length === 0) return;
        const [bestCat, bestScore] = Object.entries(catScores).sort((a, b) => b[1] - a[1])[0];
        const currentScore = catScores[t.category] || 0;
        if (bestCat !== t.category && bestScore >= 5 && bestScore > currentScore * 1.5) {
            suspects.push({ isOrphan: false, t, type, suggested: bestCat, bestScore });
        }
    });

    if (suspects.length === 0) { uiAlert('校对完成！所有分类均正常。'); return; }

    const orphanCount = suspects.filter(s => s.isOrphan).length;
    const suggCount   = suspects.filter(s => !s.isOrphan).length;
    const withSugg    = suspects.filter(s => s.suggested).length;
    let summary = `发现 ${suspects.length} 条需处理：`;
    if (orphanCount) summary += `\n⚠️ ${orphanCount} 个孤立分类（不在分类列表中）`;
    if (suggCount)   summary += `\n💡 ${suggCount} 条建议修改`;
    if (withSugg)    summary += `\n（其中 ${withSugg} 条已根据备注算出建议分类，可一键应用）`;
    if (!(await uiConfirm(summary + '\n\n点「开始处理」后逐条确认。', { title: '分类历史校对', okText: '开始处理' }))) return;

    let updated = 0;
    for (let i = 0; i < suspects.length; i++) {
        const s = suspects[i];

        if (s.isOrphan) {
            // 孤立分类：有建议就先问「改为建议分类？」；没有建议或用户拒绝就退回手动输入
            const validList = (s.type === 'expense' ? categories.expense : categories.income).join('、');
            let applied = false;

            if (s.suggested) {
                const useSugg = await uiConfirm(
                    `【${i + 1}/${suspects.length}】孤立分类\n\n` +
                    `分类名称：「${s.orphanCat}」（已不在分类列表中）\n` +
                    `涉及交易：${s.txList.length} 条\n` +
                    (s.suggHits ? `备注识别：${s.suggHits} 条交易备注指向「${s.suggested}」\n` : '') +
                    `\n💡 建议改为：「${s.suggested}」`,
                    { title: '修正孤立分类', okText: `改为「${s.suggested}」`, cancelText: '手动输入' }
                );
                if (useSugg) {
                    s.txList.forEach(t => { t.category = s.suggested; });
                    updated += s.txList.length;
                    applied = true;
                }
            }

            if (!applied) {
                // 手动输入：预填建议（若有）或原分类名
                const newCat = await uiPrompt(
                    `【${i + 1}/${suspects.length}】孤立分类\n\n` +
                    `分类名称：「${s.orphanCat}」（已不在分类列表中）\n` +
                    `涉及交易：${s.txList.length} 条\n\n` +
                    `可选分类：\n${validList}\n\n` +
                    `输入分类名后点确定修改，留空跳过。`,
                    { title: '修正孤立分类', okText: '修改', input: { value: s.suggested || s.orphanCat } }
                );
                if (newCat && newCat.trim() && newCat.trim() !== s.orphanCat) {
                    s.txList.forEach(t => { t.category = newCat.trim(); });
                    updated += s.txList.length;
                }
            }
        } else {
            const typeLabel = s.t.amount > 0 ? '收入' : '支出';
            // 给三个选择：改为建议分类 / 手动输入 / 跳过
            const useSugg = await uiConfirm(
                `【${i + 1}/${suspects.length}】分类建议\n\n` +
                `日期：${s.t.date}\n备注：${s.t.desc}\n` +
                `金额：${Math.abs(s.t.amount)} (${typeLabel})\n\n` +
                `当前分类：${s.t.category}\n` +
                `💡 建议改为：${s.suggested}` +
                (s.bestScore ? `\n（历史相似备注 ${s.bestScore} 分指向此分类）` : ''),
                { title: '分类建议', okText: `改为「${s.suggested}」`, cancelText: '手动输入' }
            );
            if (useSugg) {
                s.t.category = s.suggested; updated++;
            } else {
                // 手动输入：预填建议分类
                const manual = await uiPrompt(
                    `备注：${s.t.desc}\n当前分类：${s.t.category}\n\n输入新的分类名（留空跳过）：`,
                    { title: '手动修改分类', okText: '修改', cancelText: '跳过', input: { value: s.suggested } }
                );
                if (manual && manual.trim()) {
                    s.t.category = manual.trim(); updated++;
                }
            }
        }

        if (i > 0 && i % 10 === 0 && i < suspects.length - 1) {
            if (!(await uiConfirm(`已处理 ${i + 1} 条，继续？`, { title: '继续校对', okText: '继续', cancelText: '停止' }))) break;
        }
    }

    if (updated > 0) {
        saveUserData(); triggerAutoSave(); renderAllTransactions(); renderStats();
        uiAlert(`校对完成，共修改 ${updated} 条记录。`);
    } else {
        uiAlert('校对结束，未做任何修改。');
    }
}

// ── 交易页搜索/筛选面板收起展开 ────────────────────────────
function toggleTransFilter() {
    const panel = $('trans-filter-panel');
    const btn   = $('trans-filter-btn');
    const isOpen = panel.classList.toggle('open');
    btn.classList.toggle('active', isOpen);
    if (isOpen) {
        setTimeout(() => $('trans-search-input')?.focus(), 50);
    }
}

function clearSearchInput() {
    $('trans-search-input').value = '';
    handleSearchInput();
    $('trans-search-input').focus();
}
