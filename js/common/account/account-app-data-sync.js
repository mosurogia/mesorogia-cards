/* =========================
 * js/common/account/account-app-data-sync.js
 * - アカウント連携用のアプリ内データ同期
 * - ownedCards / cardGroups / savedDecks の分割保存同期を行う
 * ========================= */
(function(){
    'use strict';

    const API = window.API || window.AUTH_API_BASE || window.GAS_API_BASE;
    const Auth = window.Auth;
    const postJSON = window.postJSON;

    const LS_LAST_SYNC = 'appDataAccountLastSync';
    const LS_OWNED = 'ownedCards';
    const LS_GUEST_OWNED = 'ownedCardsGuestLocal';
    const LS_GUEST_CARD_GROUPS = 'cardGroupsGuestLocal';
    const LS_GUEST_SAVED_DECKS = 'savedDecksGuestLocal';
    const LS_ACTIVE_SOURCE = 'ownedCardsActiveSource';
    const LS_CARD_GROUPS = 'cardGroupsV1';
    const LS_CARD_GROUPS_MIGRATION_DECISION = 'cardGroupsAccountMigrationDecisionV1';
    const LS_OWNED_MIGRATION_DECISION = 'ownedCardsAccountMigrationDecisionV1';
    const LS_SAVED_DECKS_MIGRATION_DECISION = 'savedDecksAccountMigrationDecisionV1';
    const MIGRATION_SKIP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const EMPTY_ERRORS = new Set(['unknown mode', 'not implemented', 'unsupported mode']);
    const STATUS_LOCAL_ONLY = '端末内保存';
    const STATUS_ACCOUNT_LINKED = 'アカウント連携中';
    const STATUS_UNLINKED_LOCAL = '未連携・端末内保存';
    const STATUS_SYNC_ERROR = '同期エラー・端末内保存';
    const MIGRATION_DECISION_SKIPPED = 'skipped';
    const MIGRATION_DECISION_EMPTY_ACCOUNT = 'empty-account';

    let syncing = false;
    let cachedAppData = null;
    let lastSavedJson = '';
    let accountOwnedLinkEnabled = false;
    let authCheckPending = true;
    let pendingCardGroupsSync = null;
    let pendingCardGroupsProcessing = false;
    let pendingOwnedSync = null;
    let pendingOwnedProcessing = false;
    let pendingSavedDecksSync = null;
    let pendingSavedDecksProcessing = false;
    let pendingOwnedAccountSave = false;
    let cardsTabSwitchSeen = false;
    let lastAccountSaveDebug = null;
    let suppressOwnedAutosave = false;
    const savedDecksStatus = {
        source: 'local',
        state: 'local',
        syncing: false,
        lastSync: '',
        message: STATUS_LOCAL_ONLY,
    };
    const syncStatus = {
        source: 'local',
        state: 'local',
        syncing: false,
        lastSync: '',
        message: STATUS_LOCAL_ONLY,
    };

    function updateStatus_(patch){
        Object.assign(syncStatus, patch || {});
        try {
            window.dispatchEvent(new CustomEvent('account-owned-sync:status', {
                detail: Object.assign({}, syncStatus),
            }));
        } catch(_) {}
    }

    function updateSavedDecksStatus_(patch){
        const next = Object.assign({}, patch || {});
        const isAccount = next.source === 'account' || next.state === 'account';
        if (isAccount && !next.lastSync) {
            try {
                next.lastSync = localStorage.getItem(LS_LAST_SYNC) || new Date().toISOString();
            } catch(_) {
                next.lastSync = new Date().toISOString();
            }
        }
        Object.assign(savedDecksStatus, next);
        try {
            window.dispatchEvent(new CustomEvent('saved-decks:status', {
                detail: Object.assign({}, savedDecksStatus),
            }));
        } catch(_) {}
    }

    function notifyReady_(){
        try {
            window.dispatchEvent(new CustomEvent('account-owned-sync:ready', {
                detail: { ready: !authCheckPending && !syncing },
            }));
        } catch(_) {}
    }

    function isLoginSyncReason_(reason){
        return ['login', 'signup', 'auto-login', 'whoami', 'init'].includes(String(reason || ''));
    }

    function refreshOwnedDisplay_(reason){
        const run = () => {
            try {
                window.dispatchEvent(new CustomEvent('owned-data:replaced', {
                    detail: { reason: reason || 'account-sync' },
                }));
            } catch(_) {}

            try {
                window.OwnedUI?.sync?.('#packs-root', {
                    grayscale: true,
                    skipSummary: true,
                    skipOwnedTotal: true,
                });
            } catch(_) {}

            try {
                if (typeof window.updateSummary === 'function') window.updateSummary();
                else window.Summary?.updateSummary?.();
            } catch(_) {}

            try { window.__syncCheckerMeters?.(); } catch(_) {}
        };

        run();
        setTimeout(run, 0);
        setTimeout(run, 150);
        setTimeout(run, 500);
    }

    function normalizeCount_(entry){
        if (typeof entry === 'number') {
            return Math.max(0, Number(entry || 0) | 0);
        }

        if (typeof entry === 'string') {
            return Math.max(0, Number(entry || 0) | 0);
        }

        return Math.max(0, Number(entry?.normal || 0) | 0);
    }

    function parseJsonObject_(value){
        if (value && typeof value === 'object') return value;
        if (typeof value !== 'string') return {};

        try {
            const parsed = JSON.parse(value);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch(_) {
            return {};
        }
    }

    function normalizeOwnedMap_(map){
        map = parseJsonObject_(map);
        if (!map || typeof map !== 'object') return {};

        const out = {};
        Object.entries(map).forEach(([cd, entry]) => {
            const raw = String(cd || '').trim();
            if (!raw) return;

            const key = raw.padStart(5, '0');
            const total = normalizeCount_(entry);
            if (total <= 0) return;

            out[key] = total;
        });

        return out;
    }

    function isOwnedMapAlreadyNumeric_(map){
        map = parseJsonObject_(map);
        if (!map || typeof map !== 'object') return true;

        for (const entry of Object.values(map)) {
            const total = normalizeCount_(entry);
            if (total <= 0) continue;
            if (typeof entry !== 'number') return false;
        }

        return true;
    }

    function normalizeAppData_(data){
        const src = parseJsonObject_(data);
        const ownedCards = normalizeOwnedMap_(src.ownedCards);
        const ownedData = normalizeOwnedMap_(src.ownedData);

        return {
            schema: 2,
            ownedCards: hasOwnedData_(ownedCards) ? ownedCards : ownedData,
            cardGroups: normalizeCardGroups_(src.cardGroups),
            savedDecks: normalizeSavedDecks_(src.savedDecks),
            updatedAt: String(src.updatedAt || ''),
        };
    }

    function hasOwn_(obj, key){
        return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
    }

    function patchHasOwned_(patch){
        return hasOwn_(patch, 'ownedCards') || hasOwn_(patch, 'ownedData');
    }

    function getAppDataPatchKeys_(patch){
        const keys = [];
        if (patchHasOwned_(patch)) keys.push('ownedCards');
        if (hasOwn_(patch, 'cardGroups')) keys.push('cardGroups');
        if (hasOwn_(patch, 'savedDecks')) keys.push('savedDecks');
        return keys;
    }

    function hasOwnedData_(map){
        return Object.keys(normalizeOwnedMap_(map)).length > 0;
    }

    function recoverOwnedCandidate_(primary){
        const normalized = normalizeOwnedMap_(primary);
        if (hasOwnedData_(normalized)) return normalized;

        const guest = readGuestOwned_();
        if (hasOwnedData_(guest)) return guest;

        return {};
    }

    function ownedDataKey_(map){
        const normalized = normalizeOwnedMap_(map);
        return JSON.stringify(Object.keys(normalized).sort().map(cd => [cd, normalized[cd]]));
    }

    function isSameOwnedData_(a, b){
        return ownedDataKey_(a) === ownedDataKey_(b);
    }

    function normalizeCardGroupCards_(cards){
        const out = {};

        if (Array.isArray(cards)) {
            cards.forEach((cdRaw) => {
                const cd = String(cdRaw || '').trim().padStart(5, '0');
                if (!cd || cd === '00000') return;
                out[cd] = 1;
            });
            return out;
        }

        if (!cards || typeof cards !== 'object') return out;

        Object.entries(cards).forEach(([cdRaw, value]) => {
            const cd = String(cdRaw || '').trim().padStart(5, '0');
            const count = (typeof value === 'number') ? (value | 0) : (value ? 1 : 0);
            if (!cd || cd === '00000' || count <= 0) return;
            out[cd] = 1;
        });

        return out;
    }

    function normalizeCardGroups_(groups){
        const src = (groups && typeof groups === 'object') ? groups : {};
        const groupMapSrc = (src.groups && typeof src.groups === 'object') ? src.groups : {};
        const outGroups = {};

        Object.keys(groupMapSrc).forEach((idRaw) => {
            const id = String(idRaw || '').trim();
            if (!id) return;

            const g = groupMapSrc[id] || {};
            outGroups[id] = {
                id,
                name: String(g.name || ''),
                fixed: !!g.fixed,
                cards: normalizeCardGroupCards_(g.cards),
            };
        });

        const orderSrc = Array.isArray(src.order) ? src.order : Object.keys(outGroups);
        const order = orderSrc
            .map(v => String(v || '').trim())
            .filter(id => !!outGroups[id]);

        Object.keys(outGroups).forEach((id) => {
            if (order.indexOf(id) < 0) order.push(id);
        });

        let sys = {};
        try {
            sys = JSON.parse(JSON.stringify((src.sys && typeof src.sys === 'object') ? src.sys : {}));
        } catch(_) {
            sys = {};
        }

        return {
            groups: outGroups,
            order,
            sys,
        };
    }

    function hasCardGroupsData_(groups){
        const normalized = normalizeCardGroups_(groups);

        try {
            if (window.CardGroups?.hasUserData) return window.CardGroups.hasUserData(normalized);
        } catch(_) {}

        const groupMap = normalized.groups || {};
        const order = Array.isArray(normalized.order) ? normalized.order : Object.keys(groupMap);
        if (order.some(id => id !== 'fav' && id !== 'meta' && groupMap[id])) return true;
        if (Object.keys(groupMap.fav?.cards || {}).length > 0) return true;
        if (normalized.sys?.fav?.touched || normalized.sys?.fav?.deleted) return true;
        if (normalized.sys?.meta?.touched || normalized.sys?.meta?.deleted) return true;
        return false;
    }

    function getUserDecisionId_(){
        return String(Auth?.user?.userId || Auth?.user?.username || Auth?.user?.gameUserId || '');
    }

    function cardGroupsDataKey_(groups){
        const normalized = normalizeCardGroups_(groups);
        try {
            return JSON.stringify({
                order: Array.isArray(normalized.order) ? normalized.order : [],
                groups: normalized.groups || {},
                sys: normalized.sys || {},
            });
        } catch(_) {
            return '';
        }
    }

    function readCardGroupsMigrationDecision_(){
        return readMigrationDecision_(LS_CARD_GROUPS_MIGRATION_DECISION);
    }

    function readMigrationDecision_(storageKey){
        try {
            const raw = localStorage.getItem(storageKey);
            const parsed = raw ? JSON.parse(raw) : null;
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch(_) {
            return {};
        }
    }

    function writeCardGroupsMigrationDecision_(decision, groups){
        writeMigrationDecision_(LS_CARD_GROUPS_MIGRATION_DECISION, decision, cardGroupsDataKey_(groups));
    }

    function writeOwnedMigrationDecision_(decision, owned){
        writeMigrationDecision_(LS_OWNED_MIGRATION_DECISION, decision, ownedDataKey_(owned));
    }

    function writeSavedDecksMigrationDecision_(decision, decks){
        writeMigrationDecision_(LS_SAVED_DECKS_MIGRATION_DECISION, decision, savedDecksDataKey_(decks));
    }

    function writeMigrationDecision_(storageKey, decision, dataKey){
        const data = {
            userId: getUserDecisionId_(),
            key: dataKey,
            decision: String(decision || ''),
            updatedAt: new Date().toISOString(),
        };

        try {
            localStorage.setItem(storageKey, JSON.stringify(data));
        } catch(_) {}
    }

    function hasCardGroupsMigrationDecision_(groups){
        return hasMigrationDecision_(readCardGroupsMigrationDecision_(), cardGroupsDataKey_(groups));
    }

    function hasMigrationDecision_(data, dataKey){
        const updatedAt = new Date(String(data?.updatedAt || '')).getTime();
        const isFresh = !Number.isNaN(updatedAt) && (Date.now() - updatedAt) < MIGRATION_SKIP_TTL_MS;
        return !!(
            data &&
            data.userId === getUserDecisionId_() &&
            data.key === dataKey &&
            data.decision &&
            (data.decision !== MIGRATION_DECISION_SKIPPED || isFresh)
        );
    }

    function getCardGroupsMigrationDecision_(groups){
        if (!hasCardGroupsMigrationDecision_(groups)) return '';
        return String(readCardGroupsMigrationDecision_().decision || '');
    }

    function getOwnedMigrationDecision_(owned){
        const data = readMigrationDecision_(LS_OWNED_MIGRATION_DECISION);
        if (!hasMigrationDecision_(data, ownedDataKey_(owned))) return '';
        return String(data.decision || '');
    }

    function getSavedDecksMigrationDecision_(decks){
        const data = readMigrationDecision_(LS_SAVED_DECKS_MIGRATION_DECISION);
        if (!hasMigrationDecision_(data, savedDecksDataKey_(decks))) return '';
        return String(data.decision || '');
    }

    function normalizeSavedDecks_(decks){
        const arr = Array.isArray(decks) ? decks : [];
        return arr
            .filter(d => d && typeof d === 'object' && d.cardCounts && typeof d.cardCounts === 'object')
            .map(d => {
                const next = {
                    id: String(d.id || '').trim(),
                    name: String(d.name || '').trim(),
                    cardCounts: Object.assign({}, d.cardCounts),
                    m: (d.m != null && String(d.m).trim()) ? String(d.m) : null,
                    g: (d.g != null && Number.isFinite(+d.g)) ? (+d.g) : null,
                    date: String(d.date || ''),
                    shareCode: (typeof d.shareCode === 'string') ? d.shareCode : '',
                    memo: (typeof d.memo === 'string') ? d.memo : '',
                };

                if (!next.id) delete next.id;
                return next;
            })
            .slice(0, 100);
    }

    function hasSavedDecksData_(decks){
        return normalizeSavedDecks_(decks).length > 0;
    }

    function savedDecksDataKey_(decks){
        try {
            return JSON.stringify(normalizeSavedDecks_(decks));
        } catch(_) {
            return '[]';
        }
    }

    function isSameSavedDecksData_(a, b){
        return savedDecksDataKey_(a) === savedDecksDataKey_(b);
    }

    function confirmCardGroupsSync_(message){
        if (typeof window.confirm !== 'function') return true;
        return window.confirm(message);
    }

    function isCardsPage_(){
        return !!(
            document.getElementById('cards') &&
            document.getElementById('checker') &&
            document.getElementById('tab1')
        );
    }

    function isCheckerHash_(){
        const hash = location.hash || '';
        return hash === '#checker' ||
            hash.startsWith('#pack-') ||
            hash.startsWith('#race-') ||
            hash === '#packs-root';
    }

    function isCardsTabOpen_(){
        if (!isCardsPage_()) return false;
        if (isCheckerHash_() && !cardsTabSwitchSeen) return false;

        const cards = document.getElementById('cards');
        const checker = document.getElementById('checker');
        const tab = document.getElementById('tab1');
        return !!(
            cards?.classList?.contains('active') &&
            tab?.classList?.contains('active') &&
            !checker?.classList?.contains('active')
        );
    }

    function isCheckerTabOpen_(){
        if (!isCardsPage_()) return false;

        const checker = document.getElementById('checker');
        const tab = document.getElementById('tab2');
        return !!(
            checker?.classList?.contains('active') &&
            tab?.classList?.contains('active')
        );
    }

    function isDeckmakerPage_(){
        const path = String(location.pathname || '').toLowerCase();
        return path.endsWith('/deckmaker.html') ||
            path.endsWith('\\deckmaker.html') ||
            !!document.getElementById('savedDeckList');
    }

    function getCardGroupsSyncConfirmMessage_(){
        return 'カードグループのアカウントデータが空です。\nこの端末のカードグループをアカウントに移行しますか？\nOK: この端末のカードグループをアカウントへ保存\nキャンセル: いまは移行しない';
    }

    function getOwnedSyncConfirmMessage_(){
        return 'この端末の所持率データをアカウントに移行しますか？\nOK: この端末の所持率データをアカウントへ保存\nキャンセル: いまは移行しない';
    }

    function getSavedDecksSyncConfirmMessage_(){
        return 'この端末の保存デッキリストをアカウントに移行しますか？\nOK: この端末の保存デッキリストをアカウントへ保存\nキャンセル: いまは移行しない';
    }

    function handleMigrationCancel_(label, writeDecision, data){
        const startEmptyAccount = confirmStartEmptyAccount_(label);
        writeDecision(startEmptyAccount ? MIGRATION_DECISION_EMPTY_ACCOUNT : MIGRATION_DECISION_SKIPPED, data);
        if (startEmptyAccount) {
            setAccountLinked_();
            return true;
        }

        setLocalOnly_();
        return false;
    }

    function queueCardGroupsSync_(remoteGroups, reason){
        pendingCardGroupsSync = {
            remoteGroups: normalizeCardGroups_(remoteGroups),
            reason: reason || 'card-groups-sync',
        };
    }

    async function flushPendingCardGroupsSync_(){
        if (!pendingCardGroupsSync || pendingCardGroupsProcessing) return;
        if (!isCardsTabOpen_()) return;

        pendingCardGroupsProcessing = true;
        const pending = pendingCardGroupsSync;
        pendingCardGroupsSync = null;

        try {
            const localGroups = readLocalCardGroups_();
            const hasLocalGroups = hasCardGroupsData_(localGroups);
            if (!hasLocalGroups) return;

            const ok = hasLocalGroups && confirmCardGroupsSync_(getCardGroupsSyncConfirmMessage_());

            if (ok) {
                const res = await saveAccountAppData_({ cardGroups: localGroups }, { confirmed: true });
                if (res?.ok) writeCardGroupsMigrationDecision_('migrated', localGroups);
                return;
            }

            handleMigrationCancel_('カードグループ', writeCardGroupsMigrationDecision_, localGroups);
        } finally {
            pendingCardGroupsProcessing = false;
        }
    }

    function queueOwnedSync_(owned, reason){
        pendingOwnedSync = {
            owned: normalizeOwnedMap_(owned),
            reason: reason || 'owned-sync',
        };
    }

    async function flushPendingOwnedSync_(){
        if (!pendingOwnedSync || pendingOwnedProcessing) return;
        if (!isCheckerTabOpen_()) return;

        pendingOwnedProcessing = true;
        const pending = pendingOwnedSync;
        pendingOwnedSync = null;

        try {
            const localOwned = readLocalOwned_();
            const owned = hasOwnedData_(localOwned) ? localOwned : pending.owned;
            if (!hasOwnedData_(owned)) return;

            const ok = confirmOwnedSync_(getOwnedSyncConfirmMessage_());
            if (ok) {
                const res = await saveAccountAppData_({ ownedCards: owned }, { confirmed: true });
                if (res?.ok) writeOwnedMigrationDecision_('migrated', owned);
            } else {
                handleMigrationCancel_('所持率データ', writeOwnedMigrationDecision_, owned);
            }
        } finally {
            pendingOwnedProcessing = false;
        }
    }

    function queueSavedDecksSync_(decks, reason){
        pendingSavedDecksSync = {
            decks: normalizeSavedDecks_(decks),
            reason: reason || 'saved-decks-sync',
        };
    }

    async function flushPendingSavedDecksSync_(){
        if (!pendingSavedDecksSync || pendingSavedDecksProcessing) return;
        if (!isDeckmakerPage_()) return;

        pendingSavedDecksProcessing = true;
        const pending = pendingSavedDecksSync;
        pendingSavedDecksSync = null;

        try {
            const localDecks = readLocalSavedDecks_();
            const decks = hasSavedDecksData_(localDecks) ? localDecks : pending.decks;
            if (!hasSavedDecksData_(decks)) return;

            const ok = confirmOwnedSync_(getSavedDecksSyncConfirmMessage_());
            if (ok) {
                const res = await saveAccountAppData_({ savedDecks: decks }, { confirmed: true });
                if (res?.ok) writeSavedDecksMigrationDecision_('migrated', decks);
            } else {
                handleMigrationCancel_('保存デッキリスト', writeSavedDecksMigrationDecision_, decks);
            }
        } finally {
            pendingSavedDecksProcessing = false;
        }
    }

    function confirmOwnedSync_(message){
        if (typeof window.confirm !== 'function') return true;
        return window.confirm(message);
    }

    function confirmStartEmptyAccount_(label){
        return confirmOwnedSync_(
            `${label}はアカウントに保存しませんでした。\n\n` +
            `アカウント連携を開始しますか？\n\n` +
            `OK: ローカルとは分けて、空のアカウントデータで始める\n` +
            `キャンセル: 今は連携せず、この端末だけで使う`
        );
    }

    function keepLocalOnlyAfterSkip_(label){
        setLocalOnly_();
    }

    function isOwnedInteractionReady_(){
        return !authCheckPending && !syncing;
    }

    const ACCOUNT_LINKED_MESSAGE = STATUS_ACCOUNT_LINKED;

    function getLocalOnlyMessage_(){
        return isLoggedIn_() ? STATUS_UNLINKED_LOCAL : STATUS_LOCAL_ONLY;
    }

    function setSyncError_(){
        accountOwnedLinkEnabled = false;
        updateStatus_({
            source: 'local',
            state: 'error',
            syncing: false,
            message: STATUS_SYNC_ERROR,
        });
        updateSavedDecksStatus_({
            source: 'local',
            state: 'error',
            syncing: false,
            message: STATUS_SYNC_ERROR,
        });
    }

    function setAccountLinked_(){
        const syncedAt = new Date().toISOString();
        accountOwnedLinkEnabled = true;
        try { localStorage.setItem(LS_LAST_SYNC, syncedAt); } catch(_) {}
        try { localStorage.setItem(LS_ACTIVE_SOURCE, 'account'); } catch(_) {}
        updateStatus_({
            source: 'account',
            state: 'account',
            syncing: false,
            lastSync: syncedAt,
            message: ACCOUNT_LINKED_MESSAGE,
        });
        updateSavedDecksStatus_({
            source: 'account',
            state: 'account',
            syncing: false,
            lastSync: syncedAt,
            message: ACCOUNT_LINKED_MESSAGE,
        });
    }

    function setLocalOnly_(message){
        accountOwnedLinkEnabled = false;
        try { localStorage.setItem(LS_ACTIVE_SOURCE, 'local'); } catch(_) {}
        try { localStorage.removeItem(LS_LAST_SYNC); } catch(_) {}
        updateStatus_({
            source: 'local',
            state: 'local',
            syncing: false,
            lastSync: '',
            message: message || getLocalOnlyMessage_(),
        });
        updateSavedDecksStatus_({
            source: 'local',
            state: 'local',
            syncing: false,
            lastSync: '',
            message: message || getLocalOnlyMessage_(),
        });
    }

    function readLocalOwned_(){
        let storeOwned = {};
        try {
            if (window.OwnedStore?.getAll) {
                storeOwned = normalizeOwnedMap_(window.OwnedStore.getAll());
                if (hasOwnedData_(storeOwned)) return storeOwned;
            }
        } catch(_) {}

        try {
            const storageOwned = normalizeOwnedMap_(JSON.parse(localStorage.getItem(LS_OWNED) || '{}'));
            if (hasOwnedData_(storageOwned)) {
                try { window.OwnedStore?.replaceAll?.(storageOwned); } catch(_) {}
                return storageOwned;
            }
        } catch(_) {}

        return storeOwned;
    }

    function readGuestOwned_(){
        try {
            return normalizeOwnedMap_(JSON.parse(localStorage.getItem(LS_GUEST_OWNED) || '{}'));
        } catch(_) {
            return {};
        }
    }

    function saveGuestOwnedSnapshot_(){
        const localOwned = readLocalOwned_();
        if (!hasOwnedData_(localOwned)) return;

        try {
            localStorage.setItem(LS_GUEST_OWNED, JSON.stringify(localOwned));
        } catch(_) {}
    }

    function saveGuestCardGroupsSnapshot_(){
        const localGroups = readLocalCardGroups_();
        if (!hasCardGroupsData_(localGroups)) return;

        try {
            localStorage.setItem(LS_GUEST_CARD_GROUPS, JSON.stringify(localGroups));
        } catch(_) {}
    }

    function saveGuestSavedDecksSnapshot_(){
        const localDecks = readLocalSavedDecks_();
        if (!hasSavedDecksData_(localDecks)) return;

        try {
            localStorage.setItem(LS_GUEST_SAVED_DECKS, JSON.stringify(localDecks));
        } catch(_) {}
    }

    function restoreGuestOwned_(){
        accountOwnedLinkEnabled = false;
        writeLocalOwned_(readGuestOwned_());
        restoreGuestCardGroups_();
        restoreGuestSavedDecks_();
        setLocalOnly_();
        refreshOwnedDisplay_('logout-restore-local');
    }

    function writeLocalOwned_(map){
        const normalized = normalizeOwnedMap_(map);

        if (window.OwnedStore?.replaceAll) {
            suppressOwnedAutosave = true;
            try {
                window.OwnedStore.replaceAll(normalized);
            } finally {
                suppressOwnedAutosave = false;
            }
        }

        try {
            localStorage.setItem(LS_OWNED, JSON.stringify(normalized));
        } catch(e) {
            console.error('所持データのローカル反映に失敗:', e);
        }
    }

    function mergeAppDataPatch_(baseRaw, patchRaw){
        const patch = (patchRaw && typeof patchRaw === 'object') ? patchRaw : {};
        const base = normalizeAppData_(baseRaw);
        const next = normalizeAppData_(Object.assign({}, base, patch));

        if (patchHasOwned_(patch)) {
            const patchedOwned = normalizeOwnedMap_(patch.ownedCards || patch.ownedData || {});

            if (hasOwnedData_(patchedOwned)) {
                next.ownedCards = patchedOwned;
            } else if (hasOwnedData_(base.ownedCards)) {
                next.ownedCards = base.ownedCards;
            } else {
                next.ownedCards = recoverOwnedCandidate_(readLocalOwned_());
            }

            return next;
        }

        if (hasOwnedData_(base.ownedCards)) {
            next.ownedCards = base.ownedCards;
        } else {
            const localOwned = recoverOwnedCandidate_(readLocalOwned_());
            if (hasOwnedData_(localOwned)) next.ownedCards = localOwned;
        }

        return next;
    }

    function readLocalCardGroups_(){
        try {
            if (window.CardGroups?.exportState) return normalizeCardGroups_(window.CardGroups.exportState());
            if (window.CardGroups?.getState) return normalizeCardGroups_(window.CardGroups.getState());
        } catch(_) {}

        try {
            const raw = localStorage.getItem(LS_CARD_GROUPS);
            const obj = raw ? JSON.parse(raw) : {};
            return normalizeCardGroups_(obj);
        } catch(_) {
            return {};
        }
    }

    function readGuestCardGroups_(){
        try {
            const raw = localStorage.getItem(LS_GUEST_CARD_GROUPS);
            return raw ? normalizeCardGroups_(JSON.parse(raw)) : {};
        } catch(_) {
            return {};
        }
    }

    function readGuestSavedDecks_(){
        try {
            const raw = localStorage.getItem(LS_GUEST_SAVED_DECKS);
            return raw ? normalizeSavedDecks_(JSON.parse(raw)) : [];
        } catch(_) {
            return [];
        }
    }

    function writeLocalCardGroups_(groups){
        const normalized = normalizeCardGroups_(groups);

        try {
            if (window.CardGroups?.replaceAll) {
                window.CardGroups.replaceAll(normalized);
                return;
            }
        } catch(_) {}

        try {
            localStorage.setItem(LS_CARD_GROUPS, JSON.stringify(normalized));
        } catch(e) {
            console.error('カードグループのローカル反映に失敗:', e);
        }
    }

    function restoreGuestCardGroups_(){
        const guestGroups = readGuestCardGroups_();
        writeLocalCardGroups_(hasCardGroupsData_(guestGroups) ? guestGroups : {});
        refreshCardGroupsDisplay_('logout-restore-local');
    }

    function writeLocalSavedDecks_(decks, opts = {}){
        const normalized = normalizeSavedDecks_(decks);

        try {
            if (window.SavedDeckStore?.replaceAll) {
                window.SavedDeckStore.replaceAll(normalized, {
                    silent: !!opts.silent,
                    persist: opts.source === 'account' ? false : true,
                });
            } else {
                if (opts.source !== 'account') {
                    localStorage.setItem('savedDecks', JSON.stringify(normalized));
                }
            }
        } catch(e) {
            console.error('保存デッキのローカル反映に失敗', e);
        }

        if (opts.source) {
            updateSavedDecksStatus_({
                source: opts.source,
                state: opts.source,
                syncing: false,
                lastSync: opts.source === 'account' ? new Date().toISOString() : '',
                message: opts.source === 'account' ? STATUS_ACCOUNT_LINKED : getLocalOnlyMessage_(),
            });
        }

        refreshSavedDecksDisplay_(opts.reason || 'account-sync');
    }

    function restoreGuestSavedDecks_(){
        const guestDecks = readGuestSavedDecks_();
        writeLocalSavedDecks_(hasSavedDecksData_(guestDecks) ? guestDecks : [], {
            silent: true,
            source: 'local',
            reason: 'logout-restore-local',
        });
    }

    function refreshCardGroupsDisplay_(reason){
        try {
            window.dispatchEvent(new CustomEvent('card-groups:data-replaced', {
                detail: { reason: reason || 'account-sync' },
            }));
        } catch(_) {}

        try { window.applyFilters?.(); } catch(_) {}
    }

    function refreshSavedDecksDisplay_(reason){
        try {
            window.dispatchEvent(new CustomEvent('saved-decks:data-replaced', {
                detail: { reason: reason || 'account-sync' },
            }));
        } catch(_) {}

        try { window.SavedDeckUI?.render?.(); } catch(_) {}
    }

    function resolveCardGroupsSync_(remoteAppData, opts = {}){
        const isLoginSync = !!opts.isLoginSync;
        const isManual = !!opts.isManual;
        const currentLocalGroups = readLocalCardGroups_();
        const guestGroups = readGuestCardGroups_();
        const localGroups = hasCardGroupsData_(currentLocalGroups) ? currentLocalGroups : guestGroups;
        const remoteGroups = normalizeCardGroups_(remoteAppData?.cardGroups);
        const hasLocalGroups = hasCardGroupsData_(localGroups);
        const hasRemoteGroups = hasCardGroupsData_(remoteGroups);

        if (hasRemoteGroups) {
            writeLocalCardGroups_(remoteGroups);
            refreshCardGroupsDisplay_('account-card-groups-restored');
            return { groups: remoteGroups, saveRemote: false, restored: true };
        }

        if (hasLocalGroups) {
            if (isLoginSync || isManual) {
                if (!hasCardGroupsData_(currentLocalGroups)) {
                    writeLocalCardGroups_(localGroups);
                    refreshCardGroupsDisplay_('guest-card-groups-restored');
                }

                const cardGroupsDecision = getCardGroupsMigrationDecision_(localGroups);
                if (cardGroupsDecision === MIGRATION_DECISION_EMPTY_ACCOUNT) {
                    setAccountLinked_();
                    return { groups: {}, saveRemote: false, skipped: true, reason: 'card-groups-empty-account-recently' };
                }
                if (cardGroupsDecision === MIGRATION_DECISION_SKIPPED) {
                    setLocalOnly_();
                    return { groups: localGroups, saveRemote: false, skipped: true, reason: 'card-groups-migration-skipped-recently' };
                }

                if (!isCardsTabOpen_()) {
                    queueCardGroupsSync_(remoteGroups, isLoginSync ? 'login' : 'manual');
                    return { groups: localGroups, saveRemote: false, pending: true };
                }

                const ok = confirmCardGroupsSync_(getCardGroupsSyncConfirmMessage_());
                if (ok) {
                    writeCardGroupsMigrationDecision_('migrated', localGroups);
                    return { groups: localGroups, saveRemote: true, migrated: true };
                }

                if (handleMigrationCancel_('カードグループ', writeCardGroupsMigrationDecision_, localGroups)) {
                    return { groups: {}, saveRemote: false, skipped: true, reason: 'card-groups-empty-account-started' };
                }
                return { groups: localGroups, saveRemote: false, skipped: true };
            }

            return { groups: localGroups, saveRemote: false, skipped: true };
        }

        return { groups: localGroups, saveRemote: false, empty: true };
    }

    function readLocalSavedDecks_(){
        try {
            if (window.SavedDeckStore?.list) return window.SavedDeckStore.list();
        } catch(_) {}

        try {
            const raw = localStorage.getItem('savedDecks');
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch(_) {
            return [];
        }
    }

    function resolveSavedDecksSync_(remoteAppData, opts = {}){
        const isLoginSync = !!opts.isLoginSync;
        const isManual = !!opts.isManual;
        const localDecks = readLocalSavedDecks_();
        const remoteDecks = normalizeSavedDecks_(remoteAppData?.savedDecks);
        const hasLocalDecks = hasSavedDecksData_(localDecks);
        const hasRemoteDecks = hasSavedDecksData_(remoteDecks);

        if (hasRemoteDecks && !hasLocalDecks) {
            writeLocalSavedDecks_(remoteDecks, {
                silent: true,
                source: 'account',
                reason: 'account-saved-decks-restored',
            });
            return { decks: remoteDecks, saveRemote: false, restored: true };
        }

        if (!hasRemoteDecks && hasLocalDecks) {
            if (!isManual && !isLoginSync) {
                updateSavedDecksStatus_({ source: 'local', state: 'local', message: getLocalOnlyMessage_() });
                return { decks: localDecks, saveRemote: false, skipped: true };
            }

            const savedDecksDecision = getSavedDecksMigrationDecision_(localDecks);
            if (savedDecksDecision === MIGRATION_DECISION_EMPTY_ACCOUNT) {
                setAccountLinked_();
                return { decks: [], saveRemote: false, skipped: true, reason: 'saved-decks-empty-account-recently' };
            }
            if (savedDecksDecision === MIGRATION_DECISION_SKIPPED) {
                setLocalOnly_();
                return { decks: localDecks, saveRemote: false, skipped: true, reason: 'saved-decks-migration-skipped-recently' };
            }

            if (!isDeckmakerPage_()) {
                queueSavedDecksSync_(localDecks, isLoginSync ? 'login' : 'manual');
                return { decks: localDecks, saveRemote: false, pending: true };
            }

            const ok = confirmOwnedSync_(getSavedDecksSyncConfirmMessage_());
            if (ok) {
                writeSavedDecksMigrationDecision_('migrated', localDecks);
                return { decks: localDecks, saveRemote: true, migrated: true };
            }

            if (handleMigrationCancel_('保存デッキリスト', writeSavedDecksMigrationDecision_, localDecks)) {
                return { decks: [], saveRemote: false, skipped: true, reason: 'saved-decks-empty-account-started' };
            }
            updateSavedDecksStatus_({
                source: 'local',
                state: 'local',
                syncing: false,
                message: getLocalOnlyMessage_(),
            });
            return { decks: localDecks, saveRemote: false, skipped: true };
        }

        if (hasRemoteDecks && hasLocalDecks) {
            if (isSameSavedDecksData_(localDecks, remoteDecks)) {
                updateSavedDecksStatus_({ source: 'account', state: 'account', message: STATUS_ACCOUNT_LINKED });
                return { decks: remoteDecks, saveRemote: false, same: true };
            }

            if (isLoginSync) {
                writeLocalSavedDecks_(remoteDecks, {
                    silent: true,
                    source: 'account',
                    reason: 'account-saved-decks-restored',
                });
                return { decks: remoteDecks, saveRemote: false, restored: true, reason: 'login-account-saved-decks-restored' };
            }

            if (!isManual) {
                updateSavedDecksStatus_({ source: 'local', state: 'local', message: getLocalOnlyMessage_() });
                return { decks: localDecks, saveRemote: false, skipped: true, reason: 'saved-decks-conflict-manual-required' };
            }

            const useLocal = confirmOwnedSync_(
                'この端末の保存デッキをアカウントへ保存しますか？\nOK: この端末の保存デッキでアカウントを上書き\nキャンセル: 次の確認へ'
            );
            if (useLocal) {
                return { decks: localDecks, saveRemote: true, migrated: true };
            }

            const useAccount = confirmOwnedSync_(
                'アカウントの保存デッキをこの端末へ読み込みますか？\nOK: アカウントの保存デッキでこの端末を上書き\nキャンセル: 何もしない'
            );
            if (useAccount) {
                writeLocalSavedDecks_(remoteDecks, {
                    silent: true,
                    source: 'account',
                    reason: 'account-saved-decks-restored',
                });
                return { decks: remoteDecks, saveRemote: false, restored: true };
            }

            setLocalOnly_();
            updateSavedDecksStatus_({ source: 'local', state: 'local', message: getLocalOnlyMessage_() });
            return { decks: localDecks, saveRemote: false, skipped: true, reason: 'saved-decks-conflict-cancelled' };
        }

        return { decks: [], saveRemote: false, empty: true };
    }

    function readLocalAppData_(){
        return normalizeAppData_({
            ownedCards: readLocalOwned_(),
            cardGroups: readLocalCardGroups_(),
            savedDecks: readLocalSavedDecks_(),
        });
    }

    function cloneJson_(value){
        try {
            return JSON.parse(JSON.stringify(value || {}));
        } catch(_) {
            return {};
        }
    }

    function countOwnedEntries_(owned){
        return Object.keys(normalizeOwnedMap_(owned)).length;
    }

    function sumOwnedCounts_(owned){
        return Object.values(normalizeOwnedMap_(owned)).reduce((sum, count) => sum + (count | 0), 0);
    }

    function readActiveSource_(){
        try {
            return localStorage.getItem(LS_ACTIVE_SOURCE) || '';
        } catch(_) {
            return '';
        }
    }

    function buildDebugSummary_(data){
        return {
            source: data.currentSource,
            displayedOwnedSource: data.displayedOwnedSource,
            state: data.status?.state || '',
            accountLinked: !!data.accountLinked,
            localStorageSource: data.localStorageSource || '',
            localOwnedTypes: countOwnedEntries_(data.localData?.ownedCards),
            localOwnedTotal: sumOwnedCounts_(data.localData?.ownedCards),
            accountOwnedTypes: countOwnedEntries_(data.accountData?.ownedCards),
            accountOwnedTotal: sumOwnedCounts_(data.accountData?.ownedCards),
            guestOwnedTypes: countOwnedEntries_(data.guestLocalOwned),
            guestOwnedTotal: sumOwnedCounts_(data.guestLocalOwned),
        };
    }

    function logDebugSnapshot_(snapshot){
        if (!window.console) return;

        try {
            console.group('[メソロギア] 所持データ同期デバッグ');
            console.table(buildDebugSummary_(snapshot));
            console.log('所持データの実表示元:', snapshot.displayedOwnedSource === 'account' ? 'アカウント' : 'ローカル');
            console.log('同期モード:', snapshot.currentSource === 'account' ? 'アカウント' : 'ローカル');
            console.log('同期ステータス:', snapshot.status);
            console.log('ローカルデータ:', snapshot.localData);
            console.log('アカウントデータ:', snapshot.accountData);
            console.log('退避ローカルデータ:', snapshot.guestLocalOwned);
            console.log('直近のアカウント保存:', snapshot.lastAccountSave);
            if (snapshot.accountFetchError) console.warn('アカウントデータ取得エラー:', snapshot.accountFetchError);
            console.groupEnd();
        } catch(_) {}
    }

    async function debugOwnedData_(opts = {}){
        const shouldFetchAccount = opts.fetchAccount !== false;
        const status = Object.assign({}, syncStatus);
        let accountData = cloneJson_(cachedAppData);
        let accountFetchError = '';

        if (shouldFetchAccount && isLoggedIn_()) {
            const remote = await fetchAccountAppData_();
            if (remote?.ok) {
                accountData = cloneJson_(remote.appData);
            } else {
                accountFetchError = remote?.error || (remote?.unsupported ? 'unsupported' : 'account fetch failed');
            }
        }

        const localData = readLocalAppData_();
        const displayedOwnedSource =
            status.source === 'account' &&
            hasOwnedData_(accountData?.ownedCards) &&
            isSameOwnedData_(localData.ownedCards, accountData.ownedCards)
                ? 'account'
                : 'local';

        const snapshot = {
            currentSource: status.source || (accountOwnedLinkEnabled ? 'account' : 'local'),
            displayedOwnedSource,
            status,
            accountLinked: accountOwnedLinkEnabled,
            localStorageSource: readActiveSource_(),
            localData,
            accountData,
            guestLocalOwned: readGuestOwned_(),
            lastAccountSave: cloneJson_(lastAccountSaveDebug),
            accountFetchError,
        };

        if (opts.log !== false) logDebugSnapshot_(snapshot);
        return snapshot;
    }

    function isLoggedIn_(){
        return !!(Auth?.user && Auth?.token && Auth?.verified);
    }

    function refreshStatusFromAuth_(){
        let lastSync = '';
        try { lastSync = localStorage.getItem(LS_LAST_SYNC) || ''; } catch(_) {}

        if (syncing) {
            updateStatus_({
                state: 'syncing',
                syncing: true,
                message: 'アカウント確認中',
            });
            updateSavedDecksStatus_({
                state: 'syncing',
                syncing: true,
                message: 'アカウント確認中',
            });
            return;
        }

        if (!isLoggedIn_()) {
            accountOwnedLinkEnabled = false;
            updateStatus_({
                source: 'local',
                state: 'local',
                syncing: false,
                lastSync: '',
                message: STATUS_LOCAL_ONLY,
            });
            updateSavedDecksStatus_({
                source: 'local',
                state: 'local',
                syncing: false,
                lastSync: '',
                message: STATUS_LOCAL_ONLY,
            });
            return;
        }

        updateStatus_({
            source: accountOwnedLinkEnabled ? 'account' : 'local',
            state: accountOwnedLinkEnabled ? 'account' : 'local',
            syncing: false,
            lastSync,
            message: accountOwnedLinkEnabled ? STATUS_ACCOUNT_LINKED : STATUS_UNLINKED_LOCAL,
        });
        updateSavedDecksStatus_({
            source: accountOwnedLinkEnabled ? 'account' : 'local',
            state: accountOwnedLinkEnabled ? 'account' : 'local',
            syncing: false,
            lastSync,
            message: accountOwnedLinkEnabled ? STATUS_ACCOUNT_LINKED : STATUS_UNLINKED_LOCAL,
        });
    }

    function isUnsupportedResponse_(res){
        if (!res || res.ok) return false;

        const error = String(res.error || res.message || '').toLowerCase();
        return Array.from(EMPTY_ERRORS).some(key => error.includes(key));
    }

    async function fetchAccountAppData_(){
        if (!API || !postJSON || !Auth?.token) return { ok: false, unsupported: true };

        try {
            const payload = Auth.attachToken ? Auth.attachToken({}) : { token: Auth.token };
            const res = await postJSON(`${API}?mode=appDataGet`, payload);

            if (isUnsupportedResponse_(res)) return { ok: false, unsupported: true };
            if (!res?.ok) return { ok: false, error: res?.error || 'appDataGet failed' };

            cachedAppData = normalizeAppData_(res.appData || {});

            return {
                ok: true,
                appData: cachedAppData,
                updatedAt: res.updatedAt || cachedAppData.updatedAt || '',
            };
        } catch(e) {
            return { ok: false, error: e?.message || 'appDataGet failed' };
        }
    }

    async function resolveSaveBaseAppData_(patch){
        if (cachedAppData) return normalizeAppData_(cachedAppData);

        try {
            const remote = await fetchAccountAppData_();
            if (remote?.ok) return normalizeAppData_(remote.appData);
        } catch(_) {}

        return null;
    }

    async function saveAccountAppData_(patch, opts = {}){
        if (!API || !postJSON || !Auth?.token) {
            setSyncError_();
            return { ok: false, unsupported: !API || !postJSON };
        }
        if (!accountOwnedLinkEnabled && !opts.confirmed) {
            updateStatus_({
                source: 'local',
                state: 'local',
                syncing: false,
                message: STATUS_UNLINKED_LOCAL,
            });
            return { ok: false, skipped: true, reason: 'account-write-not-confirmed' };
        }

        const base = await resolveSaveBaseAppData_(patch);
        if (!base) {
            setSyncError_();
            return { ok: false, error: 'account appData base fetch failed' };
        }
        const next = mergeAppDataPatch_(base, patch);
        const payloadAppData = normalizeAppData_(next);
        const appDataPatchKeys = getAppDataPatchKeys_(patch);
        const patchIncludesOwned = patchHasOwned_(patch);
        const payloadOwned = normalizeOwnedMap_(payloadAppData.ownedCards);

        if (appDataPatchKeys.length === 0) {
            return { ok: false, skipped: true, reason: 'empty-app-data-patch-keys' };
        }

        if (patchIncludesOwned && !hasOwnedData_(payloadOwned)) {
            console.warn('アカウント所持データの空保存を中止しました', {
                patch,
                base,
                next,
            });
            return { ok: false, skipped: true, reason: 'empty-owned-payload-blocked' };
        }

        const saveDedupKey = JSON.stringify({
            keys: appDataPatchKeys,
            appData: payloadAppData,
        });

        if (saveDedupKey === lastSavedJson) {
            if (appDataPatchKeys.indexOf('savedDecks') >= 0) {
                updateSavedDecksStatus_({
                    source: 'account',
                    state: 'account',
                    syncing: false,
                    lastSync: new Date().toISOString(),
                    message: STATUS_ACCOUNT_LINKED,
                });
            }
            return { ok: false, skipped: true };
        }

        try {
            lastAccountSaveDebug = {
                at: new Date().toISOString(),
                patch: cloneJson_(patch),
                appDataPatchKeys,
                payloadAppData: cloneJson_(payloadAppData),
                ownedTypes: countOwnedEntries_(payloadOwned),
                ownedTotal: sumOwnedCounts_(payloadOwned),
            };

            const payload = Auth.attachToken
                ? Auth.attachToken({ appData: payloadAppData, appDataPatchKeys })
                : { token: Auth.token, appData: payloadAppData, appDataPatchKeys };

            const res = await postJSON(`${API}?mode=appDataSave`, payload);
            lastAccountSaveDebug.response = cloneJson_(res);

            if (isUnsupportedResponse_(res)) {
                setSyncError_();
                return { ok: false, unsupported: true };
            }
            if (!res?.ok) {
                setSyncError_();
                return { ok: false, error: res?.error || 'appDataSave failed' };
            }

            cachedAppData = normalizeAppData_(Object.assign({}, payloadAppData, { updatedAt: res.updatedAt || payloadAppData.updatedAt }));
            lastSavedJson = saveDedupKey;
            if (appDataPatchKeys.indexOf('savedDecks') >= 0) {
                updateSavedDecksStatus_({
                    source: 'account',
                    state: 'account',
                    syncing: false,
                    lastSync: new Date().toISOString(),
                    message: STATUS_ACCOUNT_LINKED,
                });
            }
            setAccountLinked_();

            return { ok: true };
        } catch(e) {
            if (lastAccountSaveDebug) lastAccountSaveDebug.error = e?.message || 'appDataSave failed';
            setSyncError_();
            return { ok: false, error: e?.message || 'appDataSave failed' };
        }
    }

    async function saveOwnedToAccount_(ownedOverride){
        if (!accountOwnedLinkEnabled) {
            return { ok: false, skipped: true, reason: 'account-link-disabled' };
        }

        const overrideOwned = normalizeOwnedMap_(ownedOverride);
        const owned = hasOwnedData_(overrideOwned)
            ? overrideOwned
            : recoverOwnedCandidate_(readLocalOwned_());
        if (!hasOwnedData_(owned)) {
            return { ok: false, skipped: true, reason: 'empty-owned-save-blocked' };
        }

        return saveAccountAppData_({ ownedCards: owned });
    }

    async function saveCardGroupsToAccount_(){
        if (!accountOwnedLinkEnabled) {
            return { ok: false, skipped: true, reason: 'account-link-disabled' };
        }
        return saveAccountAppData_({ cardGroups: readLocalCardGroups_() });
    }

    async function saveSavedDecksToAccount_(){
        if (!accountOwnedLinkEnabled) {
            return { ok: false, skipped: true, reason: 'account-link-disabled' };
        }
        return saveAccountAppData_({ savedDecks: readLocalSavedDecks_() });
    }

    function isCardGroupsEditable_(){
        return !syncing;
    }

    async function syncAppDataWithAccount(reason = 'manual'){
        if (syncing) return { ok: false, skipped: true };
        if (!isLoggedIn_()) {
            refreshStatusFromAuth_();
            notifyReady_();
            return { ok: false, skipped: true };
        }

        const isManual = String(reason || '') === 'manual-badge-click';
        const isLoginSync = isLoginSyncReason_(reason);
        if (!accountOwnedLinkEnabled) {
            saveGuestOwnedSnapshot_();
            saveGuestCardGroupsSnapshot_();
            saveGuestSavedDecksSnapshot_();
        }

        syncing = true;
        notifyReady_();
        updateStatus_({
            state: 'syncing',
            syncing: true,
            message: 'アカウント確認中',
        });
        updateSavedDecksStatus_({
            state: 'syncing',
            syncing: true,
            message: 'アカウント確認中',
        });
        try {
            const localOwnedRaw = readLocalOwned_();
            const guestOwned = readGuestOwned_();
            const localOwned = hasOwnedData_(localOwnedRaw) ? localOwnedRaw : guestOwned;
            const hasLocalOwned = hasOwnedData_(localOwned);
            const remoteRes = await fetchAccountAppData_();

            if (remoteRes.unsupported) {
                setSyncError_();
                return { ok: false, unsupported: true };
            }
            if (!remoteRes.ok) {
                setSyncError_();
                return remoteRes;
            }

            const rawRemoteAppData = parseJsonObject_(remoteRes.appData);
            const rawRemoteOwned = rawRemoteAppData.ownedCards || rawRemoteAppData.ownedData || {};
            const remoteOwnedNeedsMigration =
                hasOwnedData_(rawRemoteOwned) && !isOwnedMapAlreadyNumeric_(rawRemoteOwned);
            const remoteAppData = normalizeAppData_(remoteRes.appData);
            const remoteOwned = normalizeOwnedMap_(remoteAppData.ownedCards);
            const hasRemoteOwned = hasOwnedData_(remoteOwned);
            const cardGroupsSync = resolveCardGroupsSync_(remoteAppData, { isLoginSync, isManual });
            const savedDecksSync = resolveSavedDecksSync_(remoteAppData, { isLoginSync, isManual });
            const cardGroupsPatch = cardGroupsSync.saveRemote ? { cardGroups: cardGroupsSync.groups } : {};
            const savedDecksPatch = savedDecksSync.saveRemote ? { savedDecks: savedDecksSync.decks } : {};
            const appDataPatch = Object.assign({}, cardGroupsPatch, savedDecksPatch);
            const hasAppDataPatch = Object.keys(appDataPatch).length > 0;

            if (!hasRemoteOwned && hasLocalOwned) {
                if (!hasOwnedData_(localOwnedRaw)) {
                    writeLocalOwned_(localOwned);
                    pendingOwnedAccountSave = true;
                    refreshOwnedDisplay_('guest-owned-restored');
                }

                const ownedDecision = getOwnedMigrationDecision_(localOwned);
                if (ownedDecision === MIGRATION_DECISION_EMPTY_ACCOUNT) {
                    setAccountLinked_();
                    return { ok: true, skipped: true, reason: 'owned-empty-account-recently' };
                }
                if (ownedDecision === MIGRATION_DECISION_SKIPPED) {
                    setLocalOnly_();
                    if (hasAppDataPatch) {
                        return await saveAccountAppData_(appDataPatch, { confirmed: true });
                    }
                    return { ok: false, skipped: true, reason: 'owned-migration-skipped-recently' };
                }

                if (!isManual && !isLoginSync) {
                    setLocalOnly_();
                    return { ok: false, skipped: true, reason: 'local-to-account-requires-manual-confirm' };
                }

                if (!isCheckerTabOpen_()) {
                    queueOwnedSync_(localOwned, isLoginSync ? 'login' : 'manual');
                    if (hasAppDataPatch) {
                        return await saveAccountAppData_(appDataPatch, { confirmed: true });
                    }

                    setAccountLinked_();
                    return { ok: true, pending: true, reason: 'owned-sync-pending-until-checker-tab' };
                }

                const ok = confirmOwnedSync_(getOwnedSyncConfirmMessage_());
                if (!ok) {
                    if (handleMigrationCancel_('所持率データ', writeOwnedMigrationDecision_, localOwned)) {
                        return { ok: true, skipped: true, reason: 'owned-empty-account-started' };
                    }
                    return { ok: false, skipped: true, reason: 'user-cancelled-owned-local-to-account' };
                }
                writeOwnedMigrationDecision_('migrated', localOwned);
                return await saveAccountAppData_(Object.assign({ ownedCards: localOwned }, appDataPatch), { confirmed: true });
            }

            if (hasRemoteOwned && !hasLocalOwned) {
                if (!isManual && !isLoginSync) {
                    setLocalOnly_();
                    return { ok: false, skipped: true, reason: 'account-to-local-requires-login-or-manual' };
                }

                if (isLoginSync) {
                    writeLocalOwned_(remoteOwned);
                    if (remoteOwnedNeedsMigration) pendingOwnedAccountSave = true;
                    refreshOwnedDisplay_('account-owned-restored');
                    if (hasAppDataPatch) {
                        return await saveAccountAppData_(Object.assign({ ownedCards: remoteOwned }, appDataPatch), { confirmed: true });
                    }
                    lastSavedJson = JSON.stringify(normalizeAppData_(remoteAppData));
                    setAccountLinked_();
                    return { ok: true, restored: true, reason };
                }

                const ok = confirmOwnedSync_(
                    'アカウントに保存済みの所持データがあります。この端末に反映しますか？\nOK: アカウントの所持データを読み込み\nキャンセル: 連携せず、この端末だけで保存'
                );
                if (!ok) {
                    setLocalOnly_();
                    return { ok: false, skipped: true, reason: 'user-cancelled-account-to-local' };
                }

                writeLocalOwned_(remoteOwned);
                if (remoteOwnedNeedsMigration) pendingOwnedAccountSave = true;
                refreshOwnedDisplay_('account-owned-restored');
                if (hasAppDataPatch) {
                    return await saveAccountAppData_(Object.assign({ ownedCards: remoteOwned }, appDataPatch), { confirmed: true });
                }
                lastSavedJson = JSON.stringify(normalizeAppData_(remoteAppData));
                setAccountLinked_();
                return { ok: true, restored: true };
            }

            if (hasRemoteOwned && hasLocalOwned) {
                if (isLoginSync) {
                    if (!isSameOwnedData_(localOwned, remoteOwned)) {
                        // ログイン時は直前にローカル退避済みなので、アカウント側の所持データを表示元にする。
                        writeLocalOwned_(remoteOwned);
                        if (remoteOwnedNeedsMigration) pendingOwnedAccountSave = true;
                        refreshOwnedDisplay_('account-owned-restored');
                        if (hasAppDataPatch) {
                            return await saveAccountAppData_(Object.assign({ ownedCards: remoteOwned }, appDataPatch), { confirmed: true });
                        }
                        lastSavedJson = JSON.stringify(normalizeAppData_(remoteAppData));
                        setAccountLinked_();
                        return { ok: true, restored: true, reason: 'login-owned-conflict-account-restored' };
                    }

                    writeLocalOwned_(remoteOwned);
                    if (remoteOwnedNeedsMigration) pendingOwnedAccountSave = true;
                    refreshOwnedDisplay_('account-owned-restored');
                    if (hasAppDataPatch) {
                        return await saveAccountAppData_(Object.assign({ ownedCards: remoteOwned }, appDataPatch), { confirmed: true });
                    }
                    lastSavedJson = JSON.stringify(normalizeAppData_(remoteAppData));
                    setAccountLinked_();
                    return { ok: true, restored: true, reason };
                }

                if (isSameOwnedData_(localOwned, remoteOwned)) {
                    if (hasAppDataPatch) {
                        return await saveAccountAppData_(Object.assign({ ownedCards: remoteOwned }, appDataPatch), { confirmed: true });
                    }
                    lastSavedJson = JSON.stringify(normalizeAppData_(remoteAppData));
                    setAccountLinked_();
                    return { ok: true, same: true, reason };
                }

                if (!isManual) {
                    setLocalOnly_();
                    return { ok: false, skipped: true, reason: 'conflict-requires-manual-confirm' };
                }

                const useLocal = confirmOwnedSync_(
                    'この端末とアカウントに別の所持データがあります。\nOK: この端末の所持データをアカウントに保存\nキャンセル: 次の確認へ'
                );
                if (useLocal) {
                    return await saveAccountAppData_(Object.assign({ ownedCards: localOwned }, appDataPatch), { confirmed: true });
                }

                const useAccount = confirmOwnedSync_(
                    'アカウントの所持データをこの端末に読み込みますか？\nOK: アカウントの所持データを読み込み\nキャンセル: 連携せず、この端末だけで保存'
                );
                if (useAccount) {
                    writeLocalOwned_(remoteOwned);
                    if (remoteOwnedNeedsMigration) pendingOwnedAccountSave = true;
                    refreshOwnedDisplay_('account-owned-restored');
                    if (hasAppDataPatch) {
                        return await saveAccountAppData_(Object.assign({ ownedCards: remoteOwned }, appDataPatch), { confirmed: true });
                    }
                    lastSavedJson = JSON.stringify(normalizeAppData_(remoteAppData));
                    setAccountLinked_();
                    return { ok: true, restored: true, reason };
                }

                setLocalOnly_();
                return { ok: false, skipped: true, reason: 'user-cancelled-conflict' };
            }

            if (hasAppDataPatch) {
                return await saveAccountAppData_(appDataPatch, { confirmed: true });
            }
            setAccountLinked_();
            return { ok: true, empty: true };
        } finally {
            syncing = false;
            bindOwnedAutosave_();
            bindCardGroupsAutosave_();
            bindSavedDecksAutosave_();
            notifyReady_();
            refreshCardGroupsDisplay_('account-sync-ready');
            refreshSavedDecksDisplay_('account-sync-ready');

            if (pendingOwnedAccountSave && isLoggedIn_() && accountOwnedLinkEnabled) {
                pendingOwnedAccountSave = false;
                setTimeout(() => {
                    try { saveOwnedToAccount_(); } catch(_) {}
                }, 0);
            }
        }
    }

    function bindOwnedAutosave_(){
        if (!window.OwnedStore?.onChange) return;
        if (bindOwnedAutosave_._bound) return;
        bindOwnedAutosave_._bound = true;

        window.OwnedStore.onChange((nextOwned) => {
            if (suppressOwnedAutosave) return;
            if (!isLoggedIn_() || syncing || !accountOwnedLinkEnabled) return;
            if (pendingOwnedSync) return;

            const ownedSnapshot = normalizeOwnedMap_(nextOwned);
            if (!hasOwnedData_(ownedSnapshot)) return;

            clearTimeout(bindOwnedAutosave_._timer);
            bindOwnedAutosave_._timer = setTimeout(() => {
                saveOwnedToAccount_(ownedSnapshot);
            }, 1200);
        });
    }

    function bindCardGroupsAutosave_(){
        if (!window.CardGroups?.onChange) return;
        if (bindCardGroupsAutosave_._bound) return;
        bindCardGroupsAutosave_._bound = true;

        window.CardGroups.onChange(() => {
            if (!isLoggedIn_() || syncing || !accountOwnedLinkEnabled) return;

            clearTimeout(bindCardGroupsAutosave_._timer);
            bindCardGroupsAutosave_._timer = setTimeout(() => {
                saveCardGroupsToAccount_();
            }, 1200);
        });
    }

    function bindSavedDecksAutosave_(){
        if (!window.SavedDeckStore?.onChange) return;
        if (bindSavedDecksAutosave_._bound) return;
        bindSavedDecksAutosave_._bound = true;

        window.SavedDeckStore.onChange(() => {
            if (!isLoggedIn_() || syncing || !accountOwnedLinkEnabled) return;
            if (pendingSavedDecksSync) return;

            updateSavedDecksStatus_({
                source: 'local',
                state: 'syncing',
                syncing: true,
                message: 'アカウントへ保存中',
            });

            clearTimeout(bindSavedDecksAutosave_._timer);
            bindSavedDecksAutosave_._timer = setTimeout(() => {
                saveSavedDecksToAccount_();
            }, 1200);
        });
    }

    function runAccountSyncInBackground_(reason){
        try {
            syncAppDataWithAccount(reason).catch((err) => {
                console.warn('[account-app-data-sync] background sync failed:', err);
                refreshStatusFromAuth_();
                notifyReady_();
            });
        } catch(err) {
            console.warn('[account-app-data-sync] background sync failed:', err);
            refreshStatusFromAuth_();
            notifyReady_();
        }
    }

    function wrapAuthMethod_(name){
        if (!Auth || typeof Auth[name] !== 'function' || Auth[name].__appDataSyncWrapped) return;

        const original = Auth[name].bind(Auth);
        const wrapped = async function(){
            if (name === 'logout') {
                try {
                    return await original.apply(Auth, arguments);
                } finally {
                    authCheckPending = false;
                    restoreGuestOwned_();
                    notifyReady_();
                }
            }

            if (name === 'init') {
                authCheckPending = true;
                notifyReady_();
            }

            try {
                const result = await original.apply(Auth, arguments);
                if (isLoggedIn_() && (name === 'login' || name === 'signup' || (name === 'whoami' && authCheckPending))) {
                    runAccountSyncInBackground_(name === 'whoami' ? 'auto-login' : name);
                } else {
                    refreshStatusFromAuth_();
                }
                return result;
            } finally {
                if (name === 'init') {
                    authCheckPending = false;
                    notifyReady_();
                }
            }
        };

        wrapped.__appDataSyncWrapped = true;
        Auth[name] = wrapped;
    }

    function bootAppDataSync_(){
        refreshStatusFromAuth_();
        bindOwnedAutosave_();
        bindCardGroupsAutosave_();
        bindSavedDecksAutosave_();
        flushPendingCardGroupsSync_();
        flushPendingOwnedSync_();
        flushPendingSavedDecksSync_();
    }

    window.AccountAppDataSync = window.AccountAppDataSync || {
        sync: syncAppDataWithAccount,
        save: saveOwnedToAccount_,
        saveCardGroups: saveCardGroupsToAccount_,
        saveSavedDecks: saveSavedDecksToAccount_,
        readLocal: readLocalAppData_,
        debug: debugOwnedData_,
        isReady: isOwnedInteractionReady_,
        getStatus: () => Object.assign({}, syncStatus),
    };

    window.AccountOwnedSync = window.AccountOwnedSync || {
        sync: syncAppDataWithAccount,
        save: saveOwnedToAccount_,
        readLocal: readLocalOwned_,
        debug: debugOwnedData_,
        isReady: isOwnedInteractionReady_,
        getStatus: () => Object.assign({}, syncStatus),
    };

    window.AccountCardGroupsSync = window.AccountCardGroupsSync || {
        sync: syncAppDataWithAccount,
        save: saveCardGroupsToAccount_,
        readLocal: readLocalCardGroups_,
        isReady: isOwnedInteractionReady_,
        isEditable: isCardGroupsEditable_,
        getStatus: () => Object.assign({}, syncStatus),
    };

    window.AccountSavedDecksSync = window.AccountSavedDecksSync || {
        sync: syncAppDataWithAccount,
        save: saveSavedDecksToAccount_,
        readLocal: readLocalSavedDecks_,
        isReady: isOwnedInteractionReady_,
        getStatus: () => Object.assign({}, savedDecksStatus),
    };

    window.showOwnedDataDebug = window.showOwnedDataDebug || debugOwnedData_;

    wrapAuthMethod_('init');
    wrapAuthMethod_('login');
    wrapAuthMethod_('signup');
    wrapAuthMethod_('whoami');
    wrapAuthMethod_('logout');

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', bootAppDataSync_);
    } else {
        bootAppDataSync_();
    }

    document.addEventListener('tab:switched', (e) => {
        if (e?.detail?.targetId === 'cards') cardsTabSwitchSeen = true;
        flushPendingCardGroupsSync_();
        flushPendingOwnedSync_();
        flushPendingSavedDecksSync_();
    });

    window.addEventListener('saved-deck-store:ready', () => {
        bindSavedDecksAutosave_();
        refreshSavedDecksDisplay_('saved-deck-store-ready');
        flushPendingSavedDecksSync_();
    });
})();
