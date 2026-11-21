// @file js/20-cloud-sync.js
// GAS 云端增量同步：sheetCall、加密行读写、增量拉取/推送/合并、备份读取、云端已删除行清理。

/* INC-BEGIN ═══════════════ 逐条增量同步（Google 表格） ═══════════════
 * 数据按“一条记录一行”存放在 Google 表格里，内容由本机用密码 AES 加密后再上传，
 * 表格里只看得到 id / 类型 / 所属用户 / 时间戳，看不到账目内容。
 * 每次同步只拉取“上次之后变化的行”，并只上传“本机改动过的行”。
 */
const INC_PUSH_BATCH = 200;
const INC_KIND_LIST = { acc: 'accounts', txn: 'transactions', plan: 'plannedTransactions' };

function cloudConfigured() { return !!GAS_URL; }

/* ── GAS（Google 表格）传输层 ── */
async function sheetCall(params, body) {
    const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) };
    let r;
    try { r = await fetch(gasRequestUrl(params || {}), opts); }
    catch (e) {
        throw new Error('无法连接 GAS（Failed to fetch）。常见原因：① 没有在 Apps Script 里运行 authorizeOnce 授权表格权限；② 修改代码后没有“新建版本”重新部署；③ GAS URL 不是以 /exec 结尾的网页应用地址。可在浏览器直接打开 GAS 地址（后面加 ?token=你的令牌&action=pull&since=0）查看具体报错。');
    }
    const t = (await r.text()).trim();
    if (t === 'UNAUTHORIZED') throw new Error('GAS 访问令牌不正确');
    let j;
    try { j = JSON.parse(t); } catch (_) { throw new Error('GAS 返回异常（是否已部署新版 Code.gs？）：' + t.slice(0, 60)); }
    if (j && j.error) throw new Error('GAS：' + j.error);
    return j;
}

/** 每天第一次同步后，让服务端做一份表格副本备份（失败不影响同步） */
function incEnsureBackup() {
    return sheetCall({ action: 'ensureBackup' }).catch(() => {});
}

/* ── 加解密 / 签名 ── */
function incEnc(obj, pw) { return CryptoJS.AES.encrypt(JSON.stringify(obj), pw || userPassword).toString(); }
function incDec(enc, pw) {
    const s = CryptoJS.AES.decrypt(enc, pw || userPassword).toString(CryptoJS.enc.Utf8);
    if (!s) throw new Error('decrypt-empty');
    return JSON.parse(s);
}

function incStable(v) {
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(incStable).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
        .map(k => JSON.stringify(k) + ':' + incStable(v[k])).join(',') + '}';
}

function incSig(payload) {
    const s = incStable(payload);
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + '.' + s.length;
}

/* 签名缓存：用原生 JSON.stringify 做快速比对，内容没变就复用上次算好的签名（5000 条记录时把每次同步的 CPU 开销降到几十毫秒） */
const _incSigCache = new Map();
function incSigCached(id, payload) {
    const j = JSON.stringify(payload);
    const c = _incSigCache.get(id);
    if (c && c.j === j) return c.sig;
    const sig = incSig(payload);
    _incSigCache.set(id, { j, sig });
    return sig;
}

/* ── 本地同步状态：lastSeq（拉到哪了）+ synced（每条记录上次同步时的签名） ── */
function incLoadState() {
    try {
        const s = JSON.parse(localStorage.getItem('APP_sb_state') || 'null');
        if (s && typeof s.lastSeq === 'number' && s.synced && typeof s.synced === 'object') return s;
    } catch (_) {}
    return { lastSeq: 0, synced: {} };
}
function incSaveState(st) {
    try { localStorage.setItem('APP_sb_state', JSON.stringify(st)); } catch (e) { console.warn('[sb] 状态保存失败', e); }
}

/* ── 把内存数据拆成“一条条记录” ── */
function incConfigPayload(d) {
    // users 一定要把“有数据的桶”也算进去：否则某台设备没应用过别人的配置时，
    // 它推上去的用户列表会缺人，接着又把别人的用户覆盖掉。
    const removed = d.removedUsers || {};
    const seen = new Set(), users = [];
    (d.users || []).forEach(u => {
        if (typeof u !== 'string' || !u || seen.has(u) || incUserRemoved(removed, u)) return;
        seen.add(u); users.push(u);
    });
    incBucketNamesWithData(d).forEach(u => { if (!seen.has(u)) { seen.add(u); users.push(u); } });
    return {
        users: users,
        removedUsers: removed,
        categories: d.categories || null,
        exchangeRates: d.exchangeRates || null,
        budgets: d.budgets || [],
        categoryIcons: d.categoryIcons || {},
        userPins: d.userPins || {},
        configUpdatedAt: d.configUpdatedAt || 0
    };
}

function incCollectLocal(data) {
    const m = new Map();
    Object.entries(data.allUserData || {}).forEach(([u, ud]) => {
        Object.entries(INC_KIND_LIST).forEach(([kind, listName]) => {
            (ud[listName] || []).forEach(rec => {
                if (rec == null || rec.id == null) return;
                m.set(String(rec.id), { id: String(rec.id), kind, owner: u, payload: rec });
            });
        });
        if (ud.accountOrder) {
            m.set('order:' + u, { id: 'order:' + u, kind: 'order', owner: u, payload: { order: ud.accountOrder } });
        }
    });
    m.set('config', { id: 'config', kind: 'config', owner: null, payload: incConfigPayload(data) });
    return m;
}

function incTsOf(item) {
    if (item.kind === 'config') return item.payload.configUpdatedAt || Date.now();
    if (item.kind === 'order') return Date.now();
    return item.payload.updatedAt || Date.now();
}

function incEnsureUserSlot(data, u) {
    if (!data.allUserData) data.allUserData = {};
    if (!data.allUserData[u]) data.allUserData[u] = { accounts: [], transactions: [], plannedTransactions: [] };
    return data.allUserData[u];
}

function incRemoveLocalById(data, id) {
    let removed = false;
    if (id.startsWith('order:')) {
        const ud = (data.allUserData || {})[id.slice(6)];
        if (ud && ud.accountOrder) { delete ud.accountOrder; removed = true; }
        return removed;
    }
    Object.values(data.allUserData || {}).forEach(ud => {
        Object.values(INC_KIND_LIST).forEach(ln => {
            const arr = ud[ln];
            if (!arr) return;
            const i = arr.findIndex(r => String(r.id) === id);
            if (i >= 0) { arr.splice(i, 1); removed = true; }
        });
    });
    return removed;
}

function incFindLocalById(data, id) {
    for (const ud of Object.values(data.allUserData || {})) {
        for (const ln of Object.values(INC_KIND_LIST)) {
            const r = (ud[ln] || []).find(x => String(x.id) === id);
            if (r) return r;
        }
    }
    return null;
}

/** 把某个 id 从「除了 exceptOwner 之外」的所有数据桶里摘出来（带内容返回）。
 *  用于记录换了归属的情况：转账改了转入账户、用户改名等。云端一行只有一个 owner，
 *  本地也必须只有一份，否则同一笔会在两个用户的桶里各存一份，余额被算两次。 */
function incDetachById(data, id, exceptOwner) {
    let found = null;
    Object.entries(data.allUserData || {}).forEach(([u, ud]) => {
        if (u === exceptOwner || !ud) return;
        Object.values(INC_KIND_LIST).forEach(ln => {
            const arr = ud[ln];
            if (!arr || !arr.length) return;
            for (let i = arr.length - 1; i >= 0; i--) {
                if (String(arr[i].id) === id) { found = arr.splice(i, 1)[0]; }
            }
        });
    });
    return found;
}

/** 真正存了数据的桶名（空桶不算，避免把已删除的空用户当成“有数据的用户”复活） */
function incBucketNamesWithData(data) {
    return Object.keys(data.allUserData || {}).filter(u => {
        const ud = data.allUserData[u] || {};
        return (ud.accounts && ud.accounts.length) ||
               (ud.transactions && ud.transactions.length) ||
               (ud.plannedTransactions && ud.plannedTransactions.length);
    });
}

/**
 * 清掉「已标记删除、又完全没有数据」的用户（改名留下的旧名字就是这种空桶）。
 * 改名时旧名字会先被标记删除，但记录要等这一轮同步逐条挪到新名字下之后桶才空，
 * 所以必须在整轮合并结束之后再清，否则旧名字会一直挂在用户列表里（“3 个用户变 4 个”）。
 * 新加的空用户没有删除标记，不会被误清；当前登录用户永不清。
 */
function incPruneRemovedUsers(data) {
    const removed = data.removedUsers || {};
    const all = data.allUserData || {};
    let changed = false;
    (data.users || []).slice().forEach(u => {
        if (!u || u === currentUserName) return;
        if (!incUserRemoved(removed, u)) return;
        const ud = all[u] || {};
        const hasData = (ud.accounts || []).length || (ud.transactions || []).length || (ud.plannedTransactions || []).length;
        if (hasData) return;
        data.users = data.users.filter(x => x !== u);
        delete all[u];
        changed = true;
    });
    return changed;
}

/**
 * 改名后把云端仍归属旧名字的记录一起迁到新名字（包括这台设备还没拉到的行）。
 * 不迁的话，下次同步把这些行拉回来，旧名字会重新冒出来，用户就从 3 个变成 4 个。
 * 只是换个 owner（内容、id 都不变），墓碑行不用管。
 */
async function incRenameOwnerEverywhere(oldName, newName) {
    if (!cloudConfigured() || offlineMode || !currentUserName) return { moved: 0 };
    const rows = await incPullRows(0);
    const now = Date.now();
    const upserts = [];
    rows.forEach(row => {
        if (row.deleted || row.owner !== oldName) return;
        if (row.kind !== 'acc' && row.kind !== 'txn' && row.kind !== 'plan') return;
        let rec;
        try { rec = incDec(row.enc); } catch (_) { return; }   // 解不开的行跳过，不阻断改名
        rec.ownerName = newName;
        rec.updatedAt = now;
        upserts.push({
            item: { id: String(row.id), kind: row.kind, owner: newName, payload: rec },
            sig: incSig(rec), ts: Math.max(now, Number(row.ts) || 0)
        });
    });
    if (upserts.length) {
        // 用一次性状态对象：这些 id 之后还要靠一次拉取合到本机，
        // 不能让正式状态把它们记成“本机没有 = 已删除”，否则下一轮同步会误发墓碑。
        await incPushUpserts(upserts, { lastSeq: 0, synced: {} });
    }
    return { moved: upserts.length };
}

/** 转账 = 转出 + 转入两条独立记录（外加可能的手续费记录）。云端把它们当作互不相干的行，
 *  只要其中一条的删除没有送达（推送中断、旧版本删除、清理云端已删除行等），另一半就会孤零零地留下。
 *  所以收到某条转账记录的删除时，本机把同一笔转账的另一半和手续费一并删掉；
 *  这些被连带删除的记录之后会在本机的差异计算里变成墓碑，补发给云端和其他设备。 */
function incRemoveTransferCompanions(data, gone) {
    if (!gone || !gone.isTransfer) return 0;
    const pairKey = gone.transferPairId != null ? String(gone.transferPairId) : null;
    const feeKey = pairKey != null ? pairKey : (gone.type === 'expense' ? String(gone.id) : null);
    if (pairKey == null && feeKey == null) return 0;
    let n = 0;
    Object.values(data.allUserData || {}).forEach(ud => {
        const arr = ud.transactions;
        if (!arr) return;
        for (let i = arr.length - 1; i >= 0; i--) {
            const r = arr[i];
            const samePair = pairKey != null && r.isTransfer && r.transferPairId != null && String(r.transferPairId) === pairKey;
            const isFee = feeKey != null && r.transferFeeFor != null && String(r.transferFeeFor) === feeKey;
            if (samePair || isFee) { arr.splice(i, 1); n++; }
        }
    });
    return n;
}

/** 用户列表的合并规则（5.1.5 起）：
 *  以前是“整条配置谁的时间戳新谁说了算”，而新增/改名/删除用户又不动时间戳，
 *  结果一台改了预算的旧设备一同步，就能把别的设备刚加的用户连同他的全部数据“抹掉”。
 *  现在：
 *   - users 取并集（云端 ∪ 本机 ∪ 有数据的桶），并集只增不减，绝不因为配置覆盖丢用户；
 *   - 删除用户靠 removedUsers 标记生效（同名重新添加会清掉标记）；
 *   - 有数据的桶一律保留，哪怕用户列表里没有它 —— 钱不能因为一份旧配置就看不见。 */
/** removedUsers 的取值约定（5.1.5）：
 *   正数 = 在该时间点被删除；负数 = 在该时间点被重新添加（删除作废）。
 *  合并时取“更晚发生”的那一个（绝对时间更大），并保留符号，
 *  这样“删了又加”和“加了又删”都能正确收敛到最新的一次操作。 */
function incUserRemoved(map, u) { return Number(map && map[u]) > 0; }

function incMergeRemovedUsers(a, b) {
    const out = {};
    [a, b].forEach(m => {
        if (!m || typeof m !== 'object') return;
        Object.keys(m).forEach(k => {
            const cur = Number(out[k]) || 0;
            const v = Number(m[k]) || 0;
            if (!cur || Math.abs(v) > Math.abs(cur)) out[k] = v;
        });
    });
    return out;
}

function incApplyConfig(data, cfg) {
    incMergeUsersFromConfig(data, cfg);
    data.categories = cfg.categories || data.categories;
    data.exchangeRates = cfg.exchangeRates || data.exchangeRates;
    data.budgets = cfg.budgets || [];
    data.categoryIcons = cfg.categoryIcons || {};
    data.userPins = cfg.userPins || data.userPins || {};
    data.configUpdatedAt = cfg.configUpdatedAt || 0;
    (data.users || []).forEach(u => incEnsureUserSlot(data, u));
}

/** 只合并“谁存在”这一件事：云端 ∪ 本机 ∪ 有数据的桶，再减去主动删除的标记。
 *  配置的其它内容（分类/汇率/预算/PIN）仍然按 configUpdatedAt 定输赢，
 *  但用户列表绝不因为一份旧配置而缩水 —— 缩水就意味着这个人的钱集体消失。 */
function incMergeUsersFromConfig(data, cfg) {
    const removed = incMergeRemovedUsers(data.removedUsers, cfg.removedUsers);
    data.removedUsers = removed;
    const seen = new Set(), users = [];
    const push = (u, force) => {
        if (typeof u !== 'string' || !u || seen.has(u)) return;
        if (!force && incUserRemoved(removed, u)) return;
        seen.add(u); users.push(u);
    };
    (Array.isArray(data.users) ? data.users : []).forEach(u => push(u));
    (Array.isArray(cfg.users) ? cfg.users : []).forEach(u => push(u));
    incBucketNamesWithData(data).forEach(u => push(u, true));   // 还有数据的桶不受删除标记影响
    data.users = users;
    users.forEach(u => incEnsureUserSlot(data, u));
}

/* ── 拉取 ── */
async function incPullRows(sinceSeq) {
    const out = [];
    let since = sinceSeq;
    for (;;) {
        const r = await sheetCall({ action: 'pull', since, limit: 2000 });
        out.push(...r.rows);
        if (!r.more || !r.rows.length) break;
        since = r.rows[r.rows.length - 1].seq;
    }
    return out;
}

async function incPullByIds(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 200) out.push(...(await sheetCall({}, { action: 'pullIds', ids: ids.slice(i, i + 200) })).rows);
    return out;
}

/**
 * 改密码专用：让服务端只重写密文列（ts / deleted / seq 不动）。
 * 已删除的墓碑行走不了 push（“已删除不可复活”），但它们的密文也要换成新密码，
 * 否则改密后「恢复云端已删除的记录」就解不开这些行了。
 * 旧版 Code.gs 没有 rekey 动作：这里返回 unsupported，改密流程继续（墓碑保持旧密码）。
 */
async function incRekeyRows(rows) {
    let updated = 0, unsupported = false, tooLarge = 0;
    for (let i = 0; i < rows.length; i += 200) {
        const part = rows.slice(i, i + 200);
        try {
            const r = await sheetCall({}, { action: 'rekey', rows: part });
            updated += (r && r.updated) || 0;
            tooLarge += (r && r.tooLarge) || 0;
        } catch (_) {
            unsupported = true;
            break;
        }
    }
    return { updated, unsupported, tooLarge };
}

/** 不改任何状态地试解一条密文（改密码后的校验用） */
function incCanDecrypt(enc, pw) {
    try { incDec(enc, pw); return true; } catch (_) { return false; }
}

/** 先整体解密，任何一条失败就整体放弃，避免“一半成功”造成数据缺失 */
function incDecryptRows(rows, pw) {
    let failed = 0;
    const out = rows.map(row => {
        if (row.deleted) return { row, rec: null };
        try { return { row, rec: incDec(row.enc, pw) }; }
        catch (_) { failed++; return null; }
    });
    if (failed) throw new Error(`有 ${failed} 条云端记录解密失败（密码不一致或数据损坏），本次同步已中止，本地数据未改动`);
    return out;
}

/**
 * 把拉到的记录合并进内存数据。冲突规则与原来的 mergeData 一致：
 *  - 本机没改过 → 直接用云端版本
 *  - 本机也改过 → updatedAt 较新的一方胜出
 *  - 云端已删除 → 一律删除（删除优先）
 */
function incApplyRows(data, decrypted, state) {
    const res = { newItems: 0, changed: 0, configChanged: false, removed: 0 };
    const local = incCollectLocal(data);

    decrypted.sort((a, b) => a.row.seq - b.row.seq).forEach(({ row, rec }) => {
        const id = String(row.id);
        if (row.seq > state.lastSeq) state.lastSeq = row.seq;

        if (row.deleted) {
            const gone = row.kind === 'txn' ? incFindLocalById(data, id) : null;   // 先取到记录再删，才能找到它的另一半
            if (incRemoveLocalById(data, id)) { res.removed++; res.changed++; }
            if (gone) { const extra = incRemoveTransferCompanions(data, gone); if (extra) { res.removed += extra; res.changed += extra; } }
            state.synced[id] = 'X';
            return;
        }

        const remoteSig = incSig(rec);
        if (state.synced[id] === remoteSig) return; // 云端自上次同步后没变化（含重复拉到的行）

        if (row.kind === 'config') {
            const lc = local.get('config').payload;
            const localSig = incSig(lc);
            if (localSig === remoteSig) { state.synced[id] = remoteSig; return; }
            // 用户列表先取并集：即使这份配置因为时间戳更旧而不被采用，
            // “谁存在”也不该被它抹掉（这正是以前整块数据消失的原因）。
            const usersBefore = JSON.stringify(data.users || []);
            incMergeUsersFromConfig(data, rec);
            const usersGrew = JSON.stringify(data.users || []) !== usersBefore;
            const dirty = state.synced[id] !== localSig;
            if (!dirty || (rec.configUpdatedAt || 0) > (lc.configUpdatedAt || 0)) {
                incApplyConfig(data, rec);
                state.synced[id] = remoteSig;
                res.configChanged = true; res.changed++;
            } else if (usersGrew) {
                // 配置内容保留本机版本，但用户列表补全了，界面要跟着刷新
                res.changed++;
            }
            return;
        }

        if (row.kind === 'order') {
            const u = row.owner;
            const ud = incEnsureUserSlot(data, u);
            const lo = ud.accountOrder ? { order: ud.accountOrder } : null;
            const localSig = lo ? incSig(lo) : null;
            if (localSig === remoteSig) { state.synced[id] = remoteSig; return; }
            const dirty = lo && state.synced[id] !== localSig;
            if (!dirty) { ud.accountOrder = rec.order; state.synced[id] = remoteSig; res.changed++; }
            return;
        }

        const listName = INC_KIND_LIST[row.kind];
        if (!listName) return;
        const ud = incEnsureUserSlot(data, row.owner);
        const arr = ud[listName] || (ud[listName] = []);
        let idx = arr.findIndex(r => String(r.id) === id);
        if (idx < 0) {
            // 这条记录是换了归属的（转账改了转入账户、用户改名）：云端只有一行一个 owner，
            // 本机也必须只有一份，所以从旧桶里“搬”过来，而不是在新桶里再复制一份。
            const moved = incDetachById(data, id, row.owner);
            if (moved) { arr.push(moved); idx = arr.length - 1; res.changed++; }
        }
        if (idx < 0) {
            arr.push(rec);
            state.synced[id] = remoteSig;
            if (row.kind === 'txn' || row.kind === 'acc') res.newItems++;
            res.changed++;
            return;
        }
        const localSig = incSig(arr[idx]);
        if (localSig === remoteSig) { state.synced[id] = remoteSig; return; }
        const dirty = state.synced[id] !== localSig;
        const remoteTs = rec.updatedAt ?? row.ts ?? 0;
        if (!dirty || remoteTs > (arr[idx].updatedAt || 0)) {
            arr[idx] = rec;
            state.synced[id] = remoteSig;
            res.changed++;
        }
        // 否则：本机改动更新，保留本机版本，稍后会被推送
    });
    // 整轮合并之后：改名留下的旧名字空桶在这里清掉（记录已经全部挪到新名字下）
    if (incPruneRemovedUsers(data)) res.changed++;
    return res;
}

/* ── 推送 ── */
function incDiffLocal(data, state, force) {
    const local = incCollectLocal(data);
    const upserts = [], tombstones = [];
    local.forEach((item, id) => {
        const sig = incSigCached(id, item.payload);
        if (!force && state.synced[id] === sig) return;
        upserts.push({ item, sig });
    });
    Object.keys(state.synced).forEach(id => {
        if (state.synced[id] !== 'X' && !local.has(id)) tombstones.push(id);
    });
    return { upserts, tombstones };
}

/** pw 可选：改密码时用新密码加密，其它调用沿用全局 userPassword。
 *  upserts 里每项可带 ts，改密码重写时用它保证服务端接受（服务端只拒绝严格更旧的 ts）。 */
async function incPushUpserts(upserts, state, pw) {
    let pushed = 0;
    const rejected = [];
    for (let i = 0; i < upserts.length; i += INC_PUSH_BATCH) {
        const batch = upserts.slice(i, i + INC_PUSH_BATCH);
        const body = batch.map(({ item, ts }) => ({
            id: item.id, kind: item.kind, owner: item.owner,
            enc: incEnc(item.payload, pw), ts: (typeof ts === 'number' && ts > 0) ? ts : incTsOf(item), deleted: false
        }));
        const r = await sheetCall({}, { action: 'push', rows: body });
        if (r.tooLarge && r.tooLarge.length) throw new Error(`有 ${r.tooLarge.length} 条记录内容过大（超过单元格上限），无法同步`);
        const ok = new Set((r.accepted || []).map(String));
        batch.forEach(({ item, sig }) => {
            if (ok.has(item.id)) { state.synced[item.id] = sig; pushed++; }
            else rejected.push(item.id);
        });
    }
    return { pushed, rejected };
}

async function incPushTombstones(ids, state) {
    for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200);
        await sheetCall({}, { action: 'tombstone', ids: part, ts: Date.now() });
        part.forEach(id => { state.synced[id] = 'X'; });
    }
}

/**
 * 一次完整同步：先拉取并合并 → 再推送本机改动。
 * options.manual：手动触发（删除条数异常时可弹窗确认）
 * options.force：把本机所有记录都视为“已修改”重新推送（用于迁移）
 */
async function incSyncCore(options = {}) {
    const state = options.freshState ? { lastSeq: 0, synced: {} } : incLoadState();
    const data = inMemoryLoadedData;
    const summary = { newItems: 0, changed: 0, configChanged: false, pushed: 0, deleted: 0, rejected: 0, aborted: '' };

    // 1) 拉取
    // 拉取与写入都在 GAS 的同一把锁里，不会乱序，所以直接从上次的序号往后拉即可
    const rows = await incPullRows(state.lastSeq);

    // 1.5) 熔断（拉取侧）：云端一次发来大量“删除标记”时先确认。
    // 另一台设备如果丢了自己的数据桶，会把“自己没见过的记录”当成删除推上云端；
    // 本机原样拉下来，会把自己的完整数据也跟着删掉。删除前一定先问。
    const delRows = rows.filter(r => r.deleted).length;
    const liveRows = rows.length - delRows;
    if (delRows > 50 && delRows > liveRows) {
        let ok = false;
        if (options.manual) {
            ok = await uiConfirm(
                `云端这次有 ${delRows} 条“已删除”记录（正常记录只有 ${liveRows} 条）。\n\n` +
                '如果这不是你刚做的批量删除，请点“取消”：本机不会删除任何数据，也不会把删除推回云端。\n' +
                '确认是本人操作，才点“继续同步”。',
                { title: '云端发来大量删除', okText: '继续同步', cancelText: '取消（安全）', danger: true }
            );
        }
        if (!ok) {
            summary.aborted = `云端有 ${delRows} 条删除标记、正常记录只有 ${liveRows} 条，已中止（本机数据未改动）`;
            incSaveState(state);
            return summary;
        }
    }

    const pullPw = options.pullPassword || userPassword;
    const applied = incApplyRows(data, incDecryptRows(rows, pullPw), state);
    summary.newItems += applied.newItems;
    summary.changed += applied.changed;
    summary.configChanged = applied.configChanged;

    // 2) 计算本机改动
    const diff = incDiffLocal(data, state, !!options.force);

    // 3) 熔断：一次要删除的云端记录异常多时，先确认
    const knownCount = Object.keys(state.synced).length;
    if (diff.tombstones.length > 20 && diff.tombstones.length > knownCount * 0.2) {
        let ok = false;
        if (options.manual) {
            ok = await uiConfirm(
                `本次同步将删除云端 ${diff.tombstones.length} 条记录（占 ${Math.round(diff.tombstones.length / Math.max(1, knownCount) * 100)}%）。\n\n如果这不是你的操作，请点“取消”，本地和云端都不会被改动。`,
                { title: '检测到异常删除', okText: '继续推送', cancelText: '取消（安全）', danger: true }
            );
        }
        if (!ok) {
            summary.aborted = `检测到异常删除（${diff.tombstones.length} 条），已中止推送`;
            incSaveState(state);
            return summary;
        }
    }

    // 4) 推送
    const up = await incPushUpserts(diff.upserts, state);
    summary.pushed = up.pushed;
    summary.rejected = up.rejected.length;
    if (diff.tombstones.length) {
        await incPushTombstones(diff.tombstones, state);
        summary.deleted = diff.tombstones.length;
    }

    // 5) 被服务端拒绝的（云端有更新版本/已删除）：按 id 取回后再合并一次
    if (up.rejected.length) {
        const again = await incPullByIds(up.rejected);
        const a2 = incApplyRows(data, incDecryptRows(again, pullPw), state);
        summary.newItems += a2.newItems;
        summary.changed += a2.changed;
        summary.configChanged = summary.configChanged || a2.configChanged;
    }

    summary.state = state;
    return summary;
}

/** 同步成功后写本地缓存：必须先写缓存、后写状态，万一中途被杀掉也只会多拉一次而不会漏数据 */
function incPersistLocal(state, rewriteCache) {
    if (rewriteCache) {
        try {
            const content = CryptoJS.AES.encrypt(JSON.stringify(inMemoryLoadedData), userPassword).toString();
            window._driveRawContent = content;
            localStorage.setItem('APP_raw_cache', content);
        } catch (e) {
            // 缓存写入失败（容量不足等）：不能保存状态，否则下次会漏拉
            console.warn('[sb] 缓存写入失败，跳过状态保存', e);
            localStorage.removeItem('APP_sb_state');
            return;
        }
    }
    incSaveState(state);
}

/** 把合并结果刷新到界面（与原 syncToDrive 的刷新逻辑一致） */
function incRefreshAfterMerge(summary) {
    if (!summary.changed) return;
    _configUpdatedAt = inMemoryLoadedData.configUpdatedAt || Date.now();
    categories    = inMemoryLoadedData.categories    || DEFAULT_CATEGORIES;
    exchangeRates = inMemoryLoadedData.exchangeRates || DEFAULT_RATES;
    categoryIcons = inMemoryLoadedData.categoryIcons || {};
    budgets       = inMemoryLoadedData.budgets       || [];
    userPins      = inMemoryLoadedData.userPins      || {};
    if (inMemoryLoadedData.users && inMemoryLoadedData.users.length) dataUsers = inMemoryLoadedData.users;
    if (!currentUser) { // 还在登录界面（例如迁移时）：只刷新用户列表
        window._suppressAutoLogin = true;
        onDataLoaded();
        return;
    }
    loadAllData();
    filterUserData();
    renderAllTransactions();
    renderAccounts();
    if (summary.configChanged) renderCategorySettings();
}

/** 手动 / 自动同步入口（对应原 syncToDrive）
 *  5.1.8：自动同步不再弹提示——成功只让底部细线变绿，失败先由细线提示，
 *  连续失败超过 BAR_ERROR_DELAY_MS 才弹文字状态条（见 js/88-toast-syncbar.js）。 */
async function incSync(manual = false, forcePush = false) {
    if (!currentUser) return;
    if (offlineMode) { if (manual) showToast('离线模式下不会同步，请切换到在线模式', 'warning'); return; }
    if (!userPassword) { if (manual) uiAlert('需要加密密码才能同步，请重新登录。'); return; }
    if (driveIsSyncing) { _autoSyncAgain = true; return; }
    const seqAtStart = _editSeq;
    driveIsSyncing = true;
    if (typeof syncLineRender === 'function') syncLineRender();
    saveUserData();
    try {
        const s = await incSyncCore({ manual, force: forcePush });
        if (s.aborted) { showToast('同步已中止：' + s.aborted, 'error', 0); return; }
        incRefreshAfterMerge(s);
        incPersistLocal(s.state, s.changed > 0 || s.pushed > 0 || s.deleted > 0);
        clearUnsavedFlag();
        incEnsureBackup();
        _barError = null;
        _barBusy = null;
        if (typeof syncLineOk === 'function') syncLineOk();
        if (s.rejected > 0) {
            showToast(`有 ${s.rejected} 条改动被云端拒绝（多半是本机时间落后于其他设备）。请校准手机/电脑时间后再同步一次。`, 'warning', 0);
        }
    } catch (err) {
        showToast('同步失败：' + err.message, 'error', 0);
    } finally {
        driveIsSyncing = false;
        // 同步期间又改过数据：不能因为这次同步结束就认为“已全部上传”，再排一次自动同步
        if (_editSeq !== seqAtStart) {
            hasUnsavedChanges = true;
            if (!_unsavedSince) _unsavedSince = Date.now();
            scheduleAutoSync();
        }
        if (typeof syncLineRender === 'function') syncLineRender();
        if (typeof syncBarRender === 'function') syncBarRender();
    }
}

/** 登录后的后台静默同步（对应原 backgroundSyncAfterLogin） */
async function incBackgroundSync() {
    if (!userPassword || driveIsSyncing) return;
    driveIsSyncing = true;
    try {
        saveUserData();
        const s = await incSyncCore({ manual: false });
        localStorage.setItem('APP_last_login_time', Date.now().toString());
        // 即使表单打开、稍后才刷新界面，也先把配置里的 PIN 同步到全局变量，
        // 否则随后保存表单时可能用旧的 userPins 覆盖云端的新值。
        userPins = inMemoryLoadedData.userPins || userPins || {};
        if (s.aborted) { showToast('后台同步已中止：' + s.aborted, 'warning', 4000); return; }
        incPersistLocal(s.state, s.changed > 0 || s.pushed > 0 || s.deleted > 0);
        clearUnsavedFlag();
        incEnsureBackup();
        const isFormOpen = $('add-transaction-section') && $('add-transaction-section').classList.contains('show');
        if (isFormOpen) {
            if (s.changed > 0) { window._pendingUIRefresh = true; showToast(s.newItems > 0 ? `后台已合并 ${s.newItems} 条云端新数据，关闭表单后自动刷新` : '后台已合并云端改动', 'info', 3000); }
        } else {
            incRefreshAfterMerge(s);
            if (s.newItems > 0) showToast(`云端有 ${s.newItems} 条新数据已合并`, 'success', 3000);
            else if (verboseToast) showToast('云端数据已是最新', 'info', 2000);
        }
        if (s.rejected > 0) {
            showToast(`有 ${s.rejected} 条改动被云端拒绝（多半是本机时间落后于其他设备），请校准时间后再同步。`, 'warning', 0);
        }
    } catch (e) {
        console.warn('[sb] 后台同步失败', e);
        // 以前这里只写控制台，用户完全看不到同步失败；现在走底部状态条（带“重试”按钮）
        const msg = (e && e.message) ? e.message : String(e);
        showToast('同步失败：' + msg, 'error', 0);
    } finally {
        driveIsSyncing = false;
        // 同步结束后再检查进入提醒（若登录时已检查过，函数内部会直接返回）
        if (typeof checkEntryReminders === 'function') setTimeout(checkEntryReminders, 400);
    }
}

/* ── 首次加载（本机没有缓存）：输入密码 → 全量拉取 → 解密 ── */
function incAssemble(rows, pw) {
    const dec = incDecryptRows(rows, pw);
    const data = { users: [], allUserData: {}, categories: null, exchangeRates: null, budgets: [], categoryIcons: {}, userPins: {}, configUpdatedAt: 0, deletedLog: [] };
    const state = { lastSeq: 0, synced: {} };
    let hasConfig = false;
    dec.sort((a, b) => a.row.seq - b.row.seq).forEach(({ row, rec }) => {
        const id = String(row.id);
        if (row.seq > state.lastSeq) state.lastSeq = row.seq;
        if (row.deleted) { state.synced[id] = 'X'; return; }
        state.synced[id] = incSig(rec);
        if (row.kind === 'config') { incApplyConfig(data, rec); hasConfig = true; return; }
        if (row.kind === 'order') { incEnsureUserSlot(data, row.owner).accountOrder = rec.order; return; }
        const ln = INC_KIND_LIST[row.kind];
        if (ln) incEnsureUserSlot(data, row.owner)[ln].push(rec);
    });
    if (!data.categories) data.categories = typeof DEFAULT_CATEGORIES !== 'undefined' ? DEFAULT_CATEGORIES : { expense: [], income: [] };
    if (!data.exchangeRates) data.exchangeRates = typeof DEFAULT_RATES !== 'undefined' ? { ...DEFAULT_RATES } : {};
    // 配置行可能是别的设备推上来的旧版本（用户列表少几个人）。数据行都拉下来了，用户列表里却没有，
    // 登录后就“什么都看不到”。这里按「有数据的桶一定算用户」再补一次。
    incMergeUsersFromConfig(data, { users: [] });
    return { data, state, hasConfig };
}

async function incInitialLoad(password) {
    const errEl = $('password-error');
    try {
        showToast('正在从 Google 表格加载…', 'syncing', 0);
        userPassword = password;
        const rows = await incPullRows(0);
        if (!rows.length) throw new Error('云端还没有数据。请先在连接设置里点「新建空账本」初始化');
        const { data, state, hasConfig } = incAssemble(rows, password);
        if (!hasConfig) throw new Error('云端数据缺少配置记录，无法加载');
        inMemoryLoadedData = data;
        categories = data.categories;
        exchangeRates = data.exchangeRates;
        _configUpdatedAt = data.configUpdatedAt || Date.now();
        window._incPendingInitial = false;
        if (errEl) errEl.classList.add('d-none');
        incPersistLocal(state, true);
        localStorage.setItem('APP_last_sync_time', String(Date.now()));
        showToast('数据已从 Google 表格加载', 'success', 2500);
        onDataLoaded();
    } catch (e) {
        userPassword = '';
        if (errEl) { errEl.classList.remove('d-none'); errEl.textContent = '❌ ' + e.message; }
        showToast('加载失败：' + e.message, 'error', 0);
    }
}

/* ── 备份（服务端每天/每周生成 Google 表格副本） ── */
async function incListBackups() {
    return (await sheetCall({ action: 'listBackups' })).map(x => ({ name: x.name, createdAt: x.createdAt, size: x.size, kind: x.kind }));
}
async function incReadBackupRows(name) {
    const rows = await sheetCall({ action: 'readBackup', file: name });
    if (!Array.isArray(rows)) throw new Error('备份不存在或格式异常');
    return rows;
}
async function incReadBackup(name) {
    return incAssemble(await incReadBackupRows(name), userPassword).data;
}

/* INC-END */


/** 构建带 token 的请求 URL，支持 file / action 额外参数 */
function gasRequestUrl(options = {}) {
    const params = [];
    if (GAS_TOKEN)        params.push(`token=${encodeURIComponent(GAS_TOKEN)}`);
    if (options.action)   params.push(`action=${encodeURIComponent(options.action)}`);
    if (options.file)     params.push(`file=${encodeURIComponent(options.file)}`);
    if (options.fileName) params.push(`fileName=${encodeURIComponent(options.fileName)}`);
    if (options.mimeType) params.push(`mimeType=${encodeURIComponent(options.mimeType)}`);
    if (options.fileId)   params.push(`fileId=${encodeURIComponent(options.fileId)}`);
    if (options.since !== undefined) params.push(`since=${encodeURIComponent(options.since)}`);
    if (options.limit !== undefined) params.push(`limit=${encodeURIComponent(options.limit)}`);
    return params.length ? `${GAS_URL}?${params.join('&')}` : GAS_URL;
}



/**
 * 清理云端表格里“已删除”标记的残留行。
 * 增量同步采用软删除（tombstone）：删除后云端那一行会保留并标记 deleted，
 * 这样其他设备才能知道自己该删掉哪条。代价是表格会一直变长。
 * 这里向服务端请求物理清理（需要 Code.gs 支持 action=purgeDeleted）。
 */
async function purgeCloudDeletedRows(btn) {
    if (!GAS_URL) { showToast('请先在连接设置里配置 GAS URL', 'warning'); return; }
    const ok = await uiConfirm('将从云端表格中物理删除所有带“已删除”标记的行。\n\n已经同步过删除操作的设备不受影响；尚未同步的设备下次打开会照常合并。继续？', { title: '清理云端已删除行', okText: '开始清理' });
    if (!ok) return;

    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>清理中…'; }
    showToast('正在清理云端已删除行…', 'syncing', 0);
    try {
        const r = await sheetCall({}, { action: 'purgeDeleted' });
        if (r && (r.ok || r.removed !== undefined)) {
            showToast(`已清理 ${r.removed || 0} 行已删除记录`, 'success', 3000);
        } else {
            showToast('服务端没有返回清理结果，可能还没升级 Code.gs', 'warning', 4000);
        }
    } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        if (/返回异常|error/i.test(msg)) {
            showToast('服务端还不支持这个操作：需要先在 Apps Script 里加上 purgeDeleted（改完要重新部署新版本）', 'error', 0);
        } else {
            showToast('清理失败：' + msg, 'error', 0);
        }
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
    }
}
