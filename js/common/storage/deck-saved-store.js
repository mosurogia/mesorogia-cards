/* =========================
 * js/common/storage/deck-saved-store.js
 * - 保存デッキ（複数）: localStorage 永続化の中核（DOM非依存）
 *
 * 目的:
 * - DeckMaker / DeckPost / 将来のアカウント同期 から共通で使う
 * - 保存形式の移行・上限・同名上書きなどのルールをここに集約
 *
 * 依存（存在すれば使う）:
 * - window.formatYmd()
 * - window.readDeckNameInput() / window.writeDeckNameInput()
 * ========================= */
(function () {
    'use strict';

    const DEFAULT_KEY = 'savedDecks';
    const DEFAULT_UPDATED_AT_KEY = 'savedDecksUpdatedAt';
    const DEFAULT_CAP = 20;
    const listeners = new Set();
    let displayList = null;

    function _safeJsonParse(raw, fallback) {
        try { return JSON.parse(raw); } catch { return fallback; }
    }

    function _ensureDate(v) {
        return v || (typeof window.formatYmd === 'function' ? window.formatYmd() : '');
    }

    function _newDeckId() {
        const rand = Math.random().toString(36).slice(2, 8);
        return `sd_${Date.now().toString(36)}_${rand}`;
    }

    function _touchUpdatedAt(key = DEFAULT_KEY) {
        if (key !== DEFAULT_KEY) return '';
        const updatedAt = new Date().toISOString();
        try { localStorage.setItem(DEFAULT_UPDATED_AT_KEY, updatedAt); } catch {}
        return updatedAt;
    }

    function _readUpdatedAt() {
        try { return localStorage.getItem(DEFAULT_UPDATED_AT_KEY) || ''; } catch { return ''; }
    }

    function _isAccountDeckMode(key = DEFAULT_KEY) {
        if (key !== DEFAULT_KEY) return false;
        try {
        const status = window.AccountSavedDecksSync?.getStatus?.() || {};
        return status.source === 'account' || status.state === 'account' || status.state === 'syncing';
        } catch {
        return false;
        }
    }

    function _isSavedDeckEditLocked(key = DEFAULT_KEY) {
        if (key !== DEFAULT_KEY) return false;
        try {
        const sync = window.AccountSavedDecksSync || window.AccountAppDataSync;
        if (sync && typeof sync.isReady === 'function' && !sync.isReady()) return true;
        const status = sync?.getStatus?.() || {};
        return !!(status.syncing || status.state === 'syncing');
        } catch {
        return false;
        }
    }

    function _guardEdit(key = DEFAULT_KEY, opts = {}) {
        if (opts.allowDuringSync || opts.persist === false) return null;
        if (!_isSavedDeckEditLocked(key)) return null;
        return { ok: false, reason: 'syncing' };
    }

    function _normalizeDeckId(v) {
        const id = String(v || '').trim();
        return id || _newDeckId();
    }

    // ---- 旧データを壊さず吸収するためのノーマライズ ----
    function normalizeSavedDeck(d) {
        if (!d || typeof d !== 'object') return null;

        // 旧: {name, cardCounts, m, g, date}
        // 現行: {id, name, cardCounts, m, g, date, shareCode, memo}
        const cardCounts = (d.cardCounts && typeof d.cardCounts === 'object') ? d.cardCounts : null;
        if (!cardCounts) return null;

        const out = {
        id: _normalizeDeckId(d.id),
        name: String(d.name || '').trim() || '',
        cardCounts: { ...cardCounts },
        m: (d.m != null && String(d.m).trim()) ? String(d.m) : null,
        g: (d.g != null && Number.isFinite(+d.g)) ? (+d.g) : null,
        date: _ensureDate(d.date),

        shareCode: (typeof d.shareCode === 'string') ? d.shareCode : '',
        memo: (typeof d.memo === 'string') ? d.memo : ''
        };

        // 代表カードが deck に存在しないなら null
        if (out.m && !out.cardCounts[out.m]) out.m = null;

        return out;
    }

    function _loadAll(key = DEFAULT_KEY) {
        if (key === DEFAULT_KEY && Array.isArray(displayList)) {
        return displayList.map(normalizeSavedDeck).filter(Boolean);
        }

        const raw = localStorage.getItem(key);
        const arr = _safeJsonParse(raw || '[]', []);
        if (!Array.isArray(arr)) return [];
        const normalized = arr.map(normalizeSavedDeck).filter(Boolean);
        const shouldPersistNormalized = arr.length !== normalized.length || arr.some(d => (
        !d ||
        !d.id ||
        Object.prototype.hasOwnProperty.call(d, 'selectTags') ||
        Object.prototype.hasOwnProperty.call(d, 'userTags') ||
        Object.prototype.hasOwnProperty.call(d, 'note') ||
        Object.prototype.hasOwnProperty.call(d, 'poster') ||
        Object.prototype.hasOwnProperty.call(d, 'cardNotes') ||
        !Object.prototype.hasOwnProperty.call(d, 'memo')
        ));

        // date 欠落などがあれば補完して保存し直す
        let mutated = false;
        for (const d of normalized) {
        if (!d.date) { d.date = _ensureDate(''); mutated = true; }
        }
        if (mutated || shouldPersistNormalized) {
        try { localStorage.setItem(key, JSON.stringify(normalized)); } catch {}
        }
        return normalized;
    }

    function _emit(list) {
        listeners.forEach(fn => {
            try { fn(list); } catch {}
        });
    }

    function _saveAll(list, key = DEFAULT_KEY, opts = {}) {
        if (key === DEFAULT_KEY && (Array.isArray(displayList) || _isAccountDeckMode(key))) {
        displayList = Array.isArray(list) ? list.map(normalizeSavedDeck).filter(Boolean) : [];
        if (!_isAccountDeckMode(key)) _touchUpdatedAt(key);
        if (!opts.silent) _emit(displayList);
        return;
        }

        if (key === DEFAULT_KEY) displayList = null;
        localStorage.setItem(key, JSON.stringify(list));
        _touchUpdatedAt(key);
        if (!opts.silent) _emit(list);
    }

    function _setDisplayList(list, opts = {}) {
        displayList = Array.isArray(list) ? list.map(normalizeSavedDeck).filter(Boolean) : [];
        if (!opts.silent) _emit(displayList);
        return displayList;
    }

    function _clearDisplayList() {
        displayList = null;
    }

    function _isDeckEmpty(cardCounts) {
        return !cardCounts || Object.keys(cardCounts).length === 0;
    }

    // DeckMaker側の「未入力なら デッキN」採番ルール
    function _assignDefaultNameIfEmpty(list, name) {
        let deckName = String(name || '').trim();
        if (deckName) return deckName;

        let num = 1;
        const existingNames = list.map(d => d?.name).filter(Boolean);
        while (existingNames.includes(`デッキ${num}`)) num++;
        return `デッキ${num}`;
    }

    // raceCode（g）は現状 page2 互換で保持（将来不要なら external 側で無視してOK）
    function _resolveRaceCode(getMainRaceFn) {
        const raceCodeMap = { 'ドラゴン': 1, 'アンドロイド': 2, 'エレメンタル': 3, 'ルミナス': 4, 'シェイド': 5 };
        try {
        const r = (typeof getMainRaceFn === 'function') ? getMainRaceFn() : '';
        return raceCodeMap[r] || 1;
        } catch {
        return 1;
        }
    }

    // ---- 公開API ----
    const SavedDeckStore = {
        KEY: DEFAULT_KEY,

        list(opts = {}) {
        const key = opts.key || DEFAULT_KEY;
        return _loadAll(key);
        },

        get(index, opts = {}) {
        const key = opts.key || DEFAULT_KEY;
        const list = _loadAll(key);
        return list[index] || null;
        },

        getById(id, opts = {}) {
        const key = opts.key || DEFAULT_KEY;
        const deckId = String(id || '').trim();
        if (!deckId) return null;
        const list = _loadAll(key);
        return list.find(d => d.id === deckId) || null;
        },

        remove(index, opts = {}) {
        const key = opts.key || DEFAULT_KEY;
        const locked = _guardEdit(key, opts);
        if (locked) return locked;
        const list = _loadAll(key);
        if (!list[index]) return { ok: false, reason: 'not_found' };
        list.splice(index, 1);
        _saveAll(list, key);
        return { ok: true, list };
        },

        clear(opts = {}) {
        const key = opts.key || DEFAULT_KEY;
        const locked = _guardEdit(key, opts);
        if (locked) return locked;
        if (key === DEFAULT_KEY && _isAccountDeckMode(key)) {
            displayList = [];
            _emit([]);
            return { ok: true };
        }
        localStorage.removeItem(key);
        _touchUpdatedAt(key);
        _emit([]);
        return { ok: true };
        },

        getUpdatedAt() {
        return _readUpdatedAt();
        },

        replaceAll(list, opts = {}) {
        const key = opts.key || DEFAULT_KEY;
        const locked = _guardEdit(key, opts);
        if (locked) return locked;
        const normalized = Array.isArray(list) ? list.map(normalizeSavedDeck).filter(Boolean) : [];

        if (key === DEFAULT_KEY && opts.persist === false) {
            const shown = _setDisplayList(normalized, { silent: !!opts.silent });
            return { ok: true, list: shown };
        }

        if (key === DEFAULT_KEY) _clearDisplayList();
        _saveAll(normalized, key, { silent: !!opts.silent });
        return { ok: true, list: normalized };
        },

        onChange(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
        },

        /**
         * 現在デッキ状態から保存用オブジェクトを作る（UI側 or 外部連携でも使える）
         * @param {object} state
         *  - deck: {cd:count}
         *  - representativeCd: string|null
         *  - name: string (任意) ※未指定なら readDeckNameInput() を試す
         *  - shareCode/memo (任意)
         *  - getMainRace: function (任意) => race文字列
         */
        buildFromState(state = {}) {
        const deck = state.deck && typeof state.deck === 'object' ? state.deck : (window.deck || {});
        const representativeCd = (state.representativeCd != null) ? state.representativeCd : (window.representativeCd || null);

        const cardCounts = { ...deck };

        // deck 空は呼び出し側で弾く想定だが、念のため
        if (_isDeckEmpty(cardCounts)) return null;

        // name
        let name = String(state.name ?? '').trim();
        if (!name && typeof window.readDeckNameInput === 'function') {
            name = String(window.readDeckNameInput() || '').trim();
        }

        // shareCode
        const shareCode = (typeof state.shareCode === 'string') ? state.shareCode : (document.getElementById('post-share-code')?.value?.trim() || '');

        // memo は将来の保存デッキ専用メモ欄用。投稿説明とは分ける。
        const memo = (typeof state.memo === 'string') ? state.memo : '';

        // representative
        const m = (representativeCd && cardCounts[representativeCd]) ? String(representativeCd) : (Object.keys(cardCounts)[0] || null);

        // race code
        const g = _resolveRaceCode(state.getMainRace || window.getMainRace);

        return normalizeSavedDeck({
            name,
            cardCounts,
            m,
            g,
            date: _ensureDate(state.date),
            shareCode,
            memo
        });
        },

        /**
         * 保存（同名上書きあり/上限あり）
         * @param {object} savedDeck normalizeSavedDeck 互換
         * @param {object} opts
         *  - key: localStorage key
         *  - cap: 最大保存数
         *  - confirmOverwrite(name): boolean (任意) ※UI側で confirm を出したい時
         */
        upsert(savedDeck, opts = {}) {
        const key = opts.key || DEFAULT_KEY;
        const locked = _guardEdit(key, opts);
        if (locked) return locked;
        const cap = Number.isFinite(+opts.cap) ? (+opts.cap) : DEFAULT_CAP;
        const list = _loadAll(key);

        const next = normalizeSavedDeck(savedDeck);
        if (!next) return { ok: false, reason: 'invalid' };
        if (_isDeckEmpty(next.cardCounts)) return { ok: false, reason: 'empty_deck' };

        // 未入力名なら採番
        next.name = _assignDefaultNameIfEmpty(list, next.name);

        const existingIndex = list.findIndex(d => d.name === next.name);
        if (existingIndex !== -1) {
            // 上書き確認は UI側で差し込み可能
            if (typeof opts.confirmOverwrite === 'function') {
            const yes = !!opts.confirmOverwrite(next.name);
            if (!yes) return { ok: false, reason: 'cancelled' };
            }
            next.id = list[existingIndex].id || next.id;
            list[existingIndex] = next;
            _saveAll(list, key);
            return { ok: true, mode: 'overwrite', index: existingIndex, name: next.name, list };
        }

        if (list.length >= cap) {
            return { ok: false, reason: 'cap', cap };
        }

        list.push(next);
        _saveAll(list, key);
        return { ok: true, mode: 'insert', index: list.length - 1, name: next.name, list };
        }
    };

    window.SavedDeckStore = window.SavedDeckStore || SavedDeckStore;
    try {
        window.dispatchEvent(new CustomEvent('saved-deck-store:ready'));
    } catch {}
})();
