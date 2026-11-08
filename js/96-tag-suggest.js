// @file js/96-tag-suggest.js
// 最近使用标签与标签建议下拉。

// ── 标签建议下拉（点击/聚焦触发） ──
let _tagSuggestCloseTimer = {};

function getRecentTags() {
    const tagSet = new Map();
    const cutoff = Date.now() - RECENT_TAGS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const recent = transactions.filter(t => {
        const ts = t.date ? new Date(t.date).getTime() : NaN;
        return !isNaN(ts) && ts >= cutoff;
    });
    const sorted = recent.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const t of sorted) {
        if (t.tags && t.tags.trim()) {
            const tag = t.tags.trim();
            if (!tagSet.has(tag)) tagSet.set(tag, true);
        }
    }
    return [...tagSet.keys()];
}

function openTagSuggest(inputEl, listId) {
    // 取消待关闭计时
    if (_tagSuggestCloseTimer[listId]) {
        clearTimeout(_tagSuggestCloseTimer[listId]);
        delete _tagSuggestCloseTimer[listId];
    }
    const ul = document.getElementById(listId);
    if (!ul) return;

    // 构建列表
    ul.innerHTML = '';
    const tags = getRecentTags();
    if (tags.length === 0) {
        const li = document.createElement('li');
        li.className = 'ts-empty';
        li.textContent = '暂无历史标签';
        ul.appendChild(li);
    } else {
        tags.forEach(tag => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = '#';
            a.textContent = tag;
            a.addEventListener('mousedown', e => {
                e.preventDefault(); // 阻止 blur 触发
                inputEl.value = tag;
                // 同步分录数据（split card）
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                ul.classList.remove('open');
            });
            li.appendChild(a);
            ul.appendChild(li);
        });
    }
    ul.classList.add('open');
}

function scheduleCloseTagSuggest(listId) {
    _tagSuggestCloseTimer[listId] = setTimeout(() => {
        const ul = document.getElementById(listId);
        if (ul) ul.classList.remove('open');
        delete _tagSuggestCloseTimer[listId];
    }, 200);
}

window.addEventListener('load', () => {
    updateTransferModeButton();
});
