/* =========================
 * js/common/storage/owned.js
 * 所持データ（OwnedStore）＋所持マークUI（owned-mark）共通
 * - page1（カード一覧） / page3（所持率チェッカー） / 統合ページで共有
 * ========================= */

// ▼ どのページでも安全に所持データを読むヘルパ
function readOwnedDataSafe() {
    try {
        if (window.OwnedStore?.getAll) {
            const s = window.OwnedStore.getAll();
            if (s && typeof s === 'object') return s;
        }
    } catch {}

    try {
        const raw = localStorage.getItem('ownedCards');
        const obj = raw ? JSON.parse(raw) : {};
        if (obj && typeof obj === 'object') return obj;
    } catch {}

    return {};
}

(function () {
    'use strict';

    const LS_KEY = 'ownedCards';
    const LS_UPDATED_AT_KEY = 'ownedCardsUpdatedAt';

    /* =========================
     * 1) OwnedStore 本体
     * ========================= */

    function clampInt_(v) {
        return Math.max(0, (v | 0));
    }

    function normalizeCount_(e) {
        if (typeof e === 'number') {
            return clampInt_(e);
        }

        return clampInt_(e?.normal);
    }

    function normalizeEntry_(e) {
        return { normal: normalizeCount_(e) };
    }

    function sanitizeOwnedMap_(obj) {
        if (!obj || typeof obj !== 'object') return {};

        const out = {};
        for (const [cd, v] of Object.entries(obj)) {
            const count = normalizeCount_(v);
            if (count > 0) out[String(cd)] = count;
        }
        return out;
    }

    function cloneOwnedMap_(map) {
        return Object.assign({}, map || {});
    }

    function readOwnedMapFromStorage_() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            return raw ? sanitizeOwnedMap_(JSON.parse(raw)) : {};
        } catch {
            return {};
        }
    }

    function touchOwnedUpdatedAt_() {
        const updatedAt = new Date().toISOString();
        try { localStorage.setItem(LS_UPDATED_AT_KEY, updatedAt); } catch {}
        return updatedAt;
    }

    function readOwnedUpdatedAt_() {
        try { return localStorage.getItem(LS_UPDATED_AT_KEY) || ''; } catch { return ''; }
    }

    function writeOwnedMapToStorage_(map, opts = {}) {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(map || {}));
            if (opts.touch) touchOwnedUpdatedAt_();
        } catch (e) {
            console.error('ownedCards の保存に失敗:', e);
        }
    }

    function ensureOwnedStore_() {
        if (window.OwnedStore && typeof window.OwnedStore.getAll === 'function') return;

        let cache = readOwnedMapFromStorage_();
        let autosave = true;
        let dirty = false;

        const listeners = new Set();

        writeOwnedMapToStorage_(cache);

        function emit_(opts = {}) {
            dirty = true;

            listeners.forEach((fn) => {
                try {
                    fn(cache);
                } catch {}
            });

            if (autosave && opts.persist !== false) {
                writeOwnedMapToStorage_(cache, { touch: true });
            }
        }

        window.addEventListener('storage', (e) => {
            if (e.key !== LS_KEY) return;

            try {
                cache = JSON.parse(e.newValue || '{}') || {};
            } catch {
                cache = {};
            }

            cache = sanitizeOwnedMap_(cache);

            listeners.forEach((fn) => {
                try {
                    fn(cache);
                } catch {}
            });
        });

        window.OwnedStore = {
            getAll() {
                return cloneOwnedMap_(cache);
            },

            get(cd) {
                cd = String(cd);
                return { normal: normalizeCount_(cache[cd]) };
            },

            set(cd, entry) {
                const key = String(cd);
                const count = normalizeCount_(entry);
                if (count > 0) cache[key] = count;
                else delete cache[key];
                emit_();
            },

            inc(cd, edition = 'normal', delta = 1) {
                cd = String(cd);
                const e = this.get(cd);
                const count = clampInt_(e.normal + (delta | 0));
                if (count > 0) cache[cd] = count;
                else delete cache[cd];
                emit_();
            },

            replace(all, opts = {}) {
                cache = {};
                for (const cd in all) {
                    const count = normalizeCount_(all[cd]);
                    if (count > 0) cache[String(cd)] = count;
                }
                emit_(opts);
            },

            replaceAll(all, opts = {}) {
                this.replace(all, opts);
            },

            patch(partial) {
                if (!partial || typeof partial !== 'object') return;

                for (const [cd, v] of Object.entries(partial)) {
                    const key = String(cd);
                    const count = normalizeCount_(v);
                    if (count > 0) cache[key] = count;
                    else delete cache[key];
                }
                emit_();
            },

            resetExcess(cards) {
                const byCd = new Map((cards || []).map((c) => [String(c.cd), c]));

                for (const cd in cache) {
                    const info = byCd.get(String(cd));
                    const limit = info && String(info.race).includes('旧神') ? 1 : 3;
                    const count = Math.min(normalizeCount_(cache[cd]), limit);
                    if (count > 0) cache[cd] = count;
                    else delete cache[cd];
                }

                emit_();
            },

            clampForChecker(cards) {
                const byCd = new Map((cards || []).map((c) => [String(c.cd), c]));
                const next = {};

                for (const cd in cache) {
                    const sum = normalizeCount_(cache[cd]);
                    if (sum <= 0) continue;

                    const info = byCd.get(String(cd));
                    const limit = info && String(info.race).includes('旧神') ? 1 : 3;

                    next[cd] = Math.min(sum, limit);
                }

                this.replace(next);
            },

            setAutosave(v) {
                autosave = !!v;
            },

            save() {
                writeOwnedMapToStorage_(cache, { touch: true });
                dirty = false;
            },

            getUpdatedAt() {
                return readOwnedUpdatedAt_();
            },

            isDirty() {
                return dirty;
            },

            reload() {
                cache = readOwnedMapFromStorage_();
                dirty = false;

                listeners.forEach((fn) => {
                    try {
                        fn(cache);
                    } catch {}
                });
            },

            onChange(fn) {
                if (typeof fn !== 'function') return () => {};
                listeners.add(fn);
                return () => listeners.delete(fn);
            },
        };
    }

    function isOwnedInteractionLocked_() {
        const sync = window.AccountOwnedSync || window.AccountAppDataSync;
        if (!sync || typeof sync.isReady !== 'function') return false;
        return !sync.isReady();
    }

    /* =========================
     * 2) 上限枚数（旧神=1 / その他=3）
     * ========================= */

    function maxAllowedCount(cd, raceHint) {
        if (raceHint === '旧神') return 1;

        let race = raceHint || '';

        if (!race && typeof cd !== 'undefined') {
            try {
                if (Array.isArray(window.__cardsCache)) {
                    const hit = window.__cardsCache.find((c) => String(c.cd) === String(cd));
                    if (hit?.race) race = hit.race;
                }
            } catch {}

            if (!race) {
                const el = document.querySelector(`.card[data-cd="${cd}"]`);
                race = el?.dataset?.race || '';
            }
        }

        return race === '旧神' ? 1 : 3;
    }

    /* =========================
     * 3) 表示反映（1枚カード）
     * ========================= */

    function paintCard(cardEl, count, opts = {}) {
        if (!cardEl) return;

        count = Number(count || 0);

        const mark = cardEl.querySelector('.owned-mark');
        const wantText = String(count);

        const markNeedsFix = !!(
            mark &&
            (mark.textContent !== wantText || mark.style.display === 'none' || mark.hidden)
        );

        const prev = Number(cardEl.dataset.count || 0);
        const prevRaceGray = cardEl.classList.contains('grayscale-race');
        const prevOwnedGray = cardEl.classList.contains('grayscale-owned');
        const nextGray = !!(opts.grayscale && count === 0);

        if (prev === count && prevOwnedGray === nextGray && !markNeedsFix) return;

        cardEl.classList.remove(
            'owned-0',
            'owned-1',
            'owned-2',
            'owned-3',
            'owned',
            'grayscale',
            'grayscale-owned'
        );

        cardEl.classList.add(`owned-${count}`);
        cardEl.classList.add('owned');

        if (nextGray) cardEl.classList.add('grayscale-owned');
        if (prevRaceGray || nextGray) cardEl.classList.add('grayscale');

        if (mark) {
            mark.textContent = wantText;
            mark.style.display = 'flex';
            mark.hidden = false;
        }

        cardEl.dataset.count = String(count);
    }

    /* =========================
     * 4) 一括同期
     * ========================= */

    function readOwnedMap_() {
        ensureOwnedStore_();

        try {
            if (window.OwnedStore?.getAll) {
                const s = window.OwnedStore.getAll();
                if (s && typeof s === 'object') return sanitizeOwnedMap_(s);
            }
        } catch {}

        return readOwnedMapFromStorage_();
    }

    function syncOwnedMarks(rootSelector = '#packs-root', opts = {}) {
        const owned = readOwnedMap_();
        const root = document.querySelector(rootSelector);
        if (!root) return;

        root.querySelectorAll('.card').forEach((el) => {
            const cd = String(el.dataset.cd || '');
            const total = normalizeCount_(owned[cd]);
            paintCard(el, total, opts);
        });

        if (!opts.skipSummary) {
            try {
                window.updateSummary?.();
            } catch {}
        }

        if (!opts.skipOwnedTotal) {
            try {
                window.updateOwnedTotal?.();
            } catch {}
        }
    }

    function waitForCardsAndSync(rootSelector = '#packs-root', opts = {}) {
        const root = document.querySelector(rootSelector);
        if (!root) return;

        if (root.querySelector('.card')) {
            syncOwnedMarks(rootSelector, opts);
            return;
        }

        const mo = new MutationObserver(() => {
            if (root.querySelector('.card')) {
                mo.disconnect();
                syncOwnedMarks(rootSelector, opts);
            }
        });

        mo.observe(root, { childList: true, subtree: true });
    }

    /* =========================
     * 5) 公開UI API
     * ========================= */

    window.OwnedUI = {
        bind(rootSelector = '#packs-root', opts = {}) {
            ensureOwnedStore_();

            waitForCardsAndSync(rootSelector, opts);

            if (typeof window.OwnedStore?.onChange === 'function') {
                window.OwnedStore.onChange(() => syncOwnedMarks(rootSelector, opts));
            }

            if (typeof window.applyGrayscaleFilter !== 'function') {
                window.applyGrayscaleFilter = () => syncOwnedMarks(rootSelector, opts);
            }
        },

        sync(rootSelector = '#packs-root', opts = {}) {
            return syncOwnedMarks(rootSelector, opts);
        },

        paintCard,
        maxAllowedCount,
    };

    /* =========================
     * 6) 操作系（ボタン/クリック用）
     * ========================= */

    function totalOf(cd) {
        ensureOwnedStore_();
        const e = window.OwnedStore.get(String(cd));
        return e.normal | 0;
    }

    function setTotal(cd, n, raceHint) {
        if (isOwnedInteractionLocked_()) return;
        ensureOwnedStore_();
        const max = maxAllowedCount(cd, raceHint);
        const count = Math.max(0, Math.min(max, n | 0));
        window.OwnedStore.set(String(cd), count);
    }

    function bumpOwnership(el, times = 1) {
        if (isOwnedInteractionLocked_()) return;
        const cd = el?.dataset?.cd;
        if (!cd) return;

        const race = el?.dataset?.race || '';
        const now = totalOf(cd);
        const max = maxAllowedCount(cd, race);

        setTotal(cd, Math.min(max, now + (times | 0)), race);
    }

    function setOwnership(el, count) {
        if (isOwnedInteractionLocked_()) return;
        const cd = el?.dataset?.cd;
        if (!cd) return;

        const race = el?.dataset?.race || '';
        setTotal(cd, count, race);
    }

    function clearOwnership(el) {
        if (isOwnedInteractionLocked_()) return;
        const cd = el?.dataset?.cd;
        if (!cd) return;

        const race = el?.dataset?.race || '';
        setTotal(cd, 0, race);
    }

    function toggleOwnership(el) {
        try {
            if (isOwnedInteractionLocked_()) return;
            if (!el || !el.dataset) return;

            const cd = String(el.dataset.cd || '');
            if (!cd) return;

            ensureOwnedStore_();

            const race = el.dataset.race || '';
            const max = maxAllowedCount(cd, race);
            const now = totalOf(cd);
            const next = now >= max ? 0 : now + 1;

            window.OwnedStore.set(cd, next);
        } catch (err) {
            console.error('toggleOwnership failed:', err);
        }
    }

    /* =========================
     * 7) 既存互換
     * ========================= */

    window.maxAllowedCount = maxAllowedCount;
    window.bumpOwnership = bumpOwnership;
    window.setOwnership = setOwnership;
    window.clearOwnership = clearOwnership;
    window.toggleOwnership = toggleOwnership;

    /* =========================
     * 8) 初期化
     * ========================= */

    ensureOwnedStore_();
})();
