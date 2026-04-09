/* =========================
 * js/logic/deck-saved-store.js
 * - 保存デッキ（複数）: localStorage 永続化の中核（DOM非依存）
 *
 * 目的:
 * - DeckMaker / DeckPost / 将来のアカウント同期 から共通で使う
 * - 保存形式の移行・上限・同名上書きなどのルールをここに集約
 *
 * 依存（存在すれば使う）:
 * - window.formatYmd()
 * - window.readDeckNameInput() / window.writeDeckNameInput()
 * - window.readPostNote() / window.writePostNote()
 * - window.readUserTags() / window.writeUserTags()
 * - window.readSelectedTags() / window.writeSelectedTags()
 * - window.readCardNotes() / window.writeCardNotes()
 * ========================= */
(function () {
    'use strict';

    const DEFAULT_KEY = 'savedDecks';
    const DEFAULT_CAP = 20;

    function _safeJsonParse(raw, fallback) {
        try { return JSON.parse(raw); } catch { return fallback; }
    }

    function _uniq(arr) {
        return Array.from(new Set((arr || []).map(x => String(x ?? '').trim()).filter(Boolean)));
    }

    function _ensureDate(v) {
        return v || (typeof window.formatYmd === 'function' ? window.formatYmd() : '');
    }

    // ---- 旧データを壊さず吸収するためのノーマライズ ----
    function normalizeSavedDeck(d) {
        if (!d || typeof d !== 'object') return null;

        // 旧: {name, cardCounts, m, g, date}
        // 将来: {name, cardCounts, m, g, date, note, poster, shareCode, selectTags, userTags, cardNotes}
        const cardCounts = (d.cardCounts && typeof d.cardCounts === 'object') ? d.cardCounts : null;
        if (!cardCounts) return null;

        const out = {
        name: String(d.name || '').trim() || '',
        cardCounts: { ...cardCounts },
        m: (d.m != null && String(d.m).trim()) ? String(d.m) : null,
        g: (d.g != null && Number.isFinite(+d.g)) ? (+d.g) : null,
        date: _ensureDate(d.date),

        // 任意（後から追加してもOK）
        note: (typeof d.note === 'string') ? d.note : '',
        poster: (typeof d.poster === 'string') ? d.poster : '',
        shareCode: (typeof d.shareCode === 'string') ? d.shareCode : '',

        selectTags: Array.isArray(d.selectTags) ? _uniq(d.selectTags) : [],
        userTags: Array.isArray(d.userTags) ? _uniq(d.userTags) : [],

        // cardNotes: [{cd,text}] 形式を想定。壊れてても空配列に落とす
        cardNotes: Array.isArray(d.cardNotes) ? d.cardNotes : []
        };

        // 代表カードが deck に存在しないなら null
        if (out.m && !out.cardCounts[out.m]) out.m = null;

        return out;
    }

    function _loadAll(key = DEFAULT_KEY) {
        const raw = localStorage.getItem(key);
        const arr = _safeJsonParse(raw || '[]', []);
        if (!Array.isArray(arr)) return [];
        const normalized = arr.map(normalizeSavedDeck).filter(Boolean);

        // date 欠落などがあれば補完して保存し直す
        let mutated = false;
        for (const d of normalized) {
        if (!d.date) { d.date = _ensureDate(''); mutated = true; }
        }
        if (mutated) {
        try { localStorage.setItem(key, JSON.stringify(normalized)); } catch {}
        }
        return normalized;
    }

    function _saveAll(list, key = DEFAULT_KEY) {
        localStorage.setItem(key, JSON.stringify(list));
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

        remove(index, opts = {}) {
        const key = opts.key || DEFAULT_KEY;
        const list = _loadAll(key);
        if (!list[index]) return { ok: false, reason: 'not_found' };
        list.splice(index, 1);
        _saveAll(list, key);
        return { ok: true, list };
        },

        clear(opts = {}) {
        const key = opts.key || DEFAULT_KEY;
        localStorage.removeItem(key);
        return { ok: true };
        },

        /**
         * 現在デッキ状態から保存用オブジェクトを作る（UI側 or 外部連携でも使える）
         * @param {object} state
         *  - deck: {cd:count}
         *  - representativeCd: string|null
         *  - name: string (任意) ※未指定なら readDeckNameInput() を試す
         *  - note/poster/shareCode/selectTags/userTags/cardNotes (任意)
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

        // note
        let note = (typeof state.note === 'string') ? state.note : '';
        if (!note && typeof window.readPostNote === 'function') {
            note = String(window.readPostNote() || '');
        }

        // poster
        const poster = (typeof state.poster === 'string') ? state.poster : (document.getElementById('poster-name')?.value?.trim() || '');

        // shareCode
        const shareCode = (typeof state.shareCode === 'string') ? state.shareCode : (document.getElementById('post-share-code')?.value?.trim() || '');

        // selectTags
        let selectTags = Array.isArray(state.selectTags) ? state.selectTags : null;
        if (!selectTags) {
            try {
            if (typeof window.readSelectedTags === 'function') selectTags = Array.from(window.readSelectedTags() || []);
            } catch {}
        }
        if (!Array.isArray(selectTags)) selectTags = [];

        // userTags
        let userTags = Array.isArray(state.userTags) ? state.userTags : null;
        if (!userTags) {
            try {
            if (typeof window.readUserTags === 'function') userTags = window.readUserTags() || [];
            } catch {}
        }
        if (!Array.isArray(userTags)) userTags = [];

        // cardNotes
        let cardNotes = Array.isArray(state.cardNotes) ? state.cardNotes : null;
        if (!cardNotes) {
            try {
            if (typeof window.readCardNotes === 'function') {
                const v = window.readCardNotes();
                cardNotes = Array.isArray(v) ? v : [];
            }
            } catch {}
        }
        if (!Array.isArray(cardNotes)) cardNotes = [];

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
            note,
            poster,
            shareCode,
            selectTags,
            userTags,
            cardNotes
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
})();