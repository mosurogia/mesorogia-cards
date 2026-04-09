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

    /* =========================
     * 1) OwnedStore 本体
     * ========================= */

    function clampInt_(v) {
        return Math.max(0, (v | 0));
    }

    function normalizeEntry_(e) {
        return {
            normal: clampInt_(e?.normal),
            shine: clampInt_(e?.shine),
            premium: clampInt_(e?.premium),
        };
    }

    function sanitizeOwnedMap_(obj) {
        if (!obj || typeof obj !== 'object') return {};

        const out = {};
        for (const [cd, v] of Object.entries(obj)) {
            out[String(cd)] = normalizeEntry_(v);
        }
        return out;
    }

    function readOwnedMapFromStorage_() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            return raw ? sanitizeOwnedMap_(JSON.parse(raw)) : {};
        } catch {
            return {};
        }
    }

    function writeOwnedMapToStorage_(map) {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(map || {}));
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

        function emit_() {
            dirty = true;

            listeners.forEach((fn) => {
                try {
                    fn(cache);
                } catch {}
            });

            if (autosave) {
                writeOwnedMapToStorage_(cache);
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
                return JSON.parse(JSON.stringify(cache));
            },

            get(cd) {
                cd = String(cd);
                return normalizeEntry_(cache[cd] || { normal: 0, shine: 0, premium: 0 });
            },

            set(cd, entry) {
                cache[String(cd)] = normalizeEntry_(entry);
                emit_();
            },

            inc(cd, edition = 'normal', delta = 1) {
                cd = String(cd);
                const e = this.get(cd);
                e[edition] = clampInt_(e[edition] + (delta | 0));
                cache[cd] = e;
                emit_();
            },

            replace(all) {
                cache = {};
                for (const cd in all) {
                    cache[String(cd)] = normalizeEntry_(all[cd]);
                }
                emit_();
            },

            replaceAll(all) {
                this.replace(all);
            },

            patch(partial) {
                if (!partial || typeof partial !== 'object') return;

                for (const [cd, v] of Object.entries(partial)) {
                    cache[String(cd)] = normalizeEntry_(v);
                }
                emit_();
            },

            resetExcess(cards) {
                const byCd = new Map((cards || []).map((c) => [String(c.cd), c]));

                for (const cd in cache) {
                    const info = byCd.get(String(cd));
                    const limit = info && String(info.race).includes('旧神') ? 1 : 3;
                    const e = cache[cd] || { normal: 0, shine: 0, premium: 0 };

                    e.normal = Math.min(e.normal || 0, limit);
                    e.shine = Math.min(e.shine || 0, limit);
                    e.premium = Math.min(e.premium || 0, limit);

                    cache[cd] = normalizeEntry_(e);
                }

                emit_();
            },

            clampForChecker(cards) {
                const byCd = new Map((cards || []).map((c) => [String(c.cd), c]));
                const next = {};

                for (const cd in cache) {
                    const e = cache[cd] || { normal: 0, shine: 0, premium: 0 };
                    const sum = (e.normal | 0) + (e.shine | 0) + (e.premium | 0);
                    if (sum <= 0) continue;

                    const info = byCd.get(String(cd));
                    const limit = info && String(info.race).includes('旧神') ? 1 : 3;

                    next[cd] = {
                        normal: Math.min(sum, limit),
                        shine: 0,
                        premium: 0,
                    };
                }

                this.replace(next);
            },

            setAutosave(v) {
                autosave = !!v;
            },

            save() {
                writeOwnedMapToStorage_(cache);
                dirty = false;
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
            const e = owned[cd] || { normal: 0, shine: 0, premium: 0 };
            const total = (e.normal | 0) + (e.shine | 0) + (e.premium | 0);
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
        return (e.normal | 0) + (e.shine | 0) + (e.premium | 0);
    }

    function setTotal(cd, n, raceHint) {
        ensureOwnedStore_();
        const max = maxAllowedCount(cd, raceHint);
        const count = Math.max(0, Math.min(max, n | 0));
        window.OwnedStore.set(String(cd), { normal: count, shine: 0, premium: 0 });
    }

    function bumpOwnership(el, times = 1) {
        const cd = el?.dataset?.cd;
        if (!cd) return;

        const race = el?.dataset?.race || '';
        const now = totalOf(cd);
        const max = maxAllowedCount(cd, race);

        setTotal(cd, Math.min(max, now + (times | 0)), race);
    }

    function setOwnership(el, count) {
        const cd = el?.dataset?.cd;
        if (!cd) return;

        const race = el?.dataset?.race || '';
        setTotal(cd, count, race);
    }

    function clearOwnership(el) {
        const cd = el?.dataset?.cd;
        if (!cd) return;

        const race = el?.dataset?.race || '';
        setTotal(cd, 0, race);
    }

    function toggleOwnership(el) {
        try {
            if (!el || !el.dataset) return;

            const cd = String(el.dataset.cd || '');
            if (!cd) return;

            ensureOwnedStore_();

            const race = el.dataset.race || '';
            const max = maxAllowedCount(cd, race);
            const now = totalOf(cd);
            const next = now >= max ? 0 : now + 1;

            window.OwnedStore.set(cd, { normal: next, shine: 0, premium: 0 });
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