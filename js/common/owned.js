/* =========================
 * common/owned.js
 * 所持データ（OwnedStore）＋所持マークUI（owned-mark）共通
 * - page1（カード一覧） / page3（所持率チェッカー） / 統合ページで共有
 * ========================= */

// ▼ どのページでも安全に所持データを読むヘルパ
function readOwnedDataSafe() {
    // OwnedStore 優先
    try {
        if (window.OwnedStore?.getAll) {
        const s = window.OwnedStore.getAll();
        if (s && typeof s === 'object') return s;
        }
    } catch {}
    // localStorage フォールバック
    try {
        const raw = localStorage.getItem('ownedCards');
        const obj = raw ? JSON.parse(raw) : {};
        if (obj && typeof obj === 'object') return obj;
    } catch {}
    return {};
}

(function () {
    const LS_KEY = 'ownedCards';

    /* ---------- OwnedStore（既にあれば尊重） ---------- */
    function ensureOwnedStore_() {
        if (window.OwnedStore && typeof window.OwnedStore.getAll === 'function') return;

        // 最小実装：localStorage を裏に持つ
        let map = readOwnedMap_();
        const listeners = new Set();

        window.OwnedStore = {
        get(cd) {
            cd = String(cd);
            return map[cd] || { normal: 0, shine: 0, premium: 0 };
        },
        set(cd, obj) {
            cd = String(cd);
            map[cd] = {
            normal: Number(obj?.normal || 0),
            shine: Number(obj?.shine || 0),
            premium: Number(obj?.premium || 0),
            };
            writeOwnedMap_(map);
            listeners.forEach(fn => {
            try { fn(); } catch (e) {}
            });
        },
        getAll() {
            return map;
        },
        replaceAll(next) {
            map = sanitizeOwnedMap_(next);
            writeOwnedMap_(map);
            listeners.forEach(fn => {
            try { fn(); } catch (e) {}
            });
        },
        onChange(fn) {
            if (typeof fn === 'function') listeners.add(fn);
        },
        patch(partial) {
        if (!partial || typeof partial !== 'object') return;
        for (const [cd, v] of Object.entries(partial)) {
            const e = v && typeof v === 'object' ? v : {};
            map[String(cd)] = {
            normal: Number(e.normal || 0),
            shine: Number(e.shine || 0),
            premium: Number(e.premium || 0),
            };
        }
        writeOwnedMap_(map);
        listeners.forEach(fn => { try { fn(); } catch(e){} });
        },
        };
    }

    /* ---------- 所持データ read/write ---------- */
    function sanitizeOwnedMap_(obj) {
        if (!obj || typeof obj !== 'object') return {};
        const out = {};
        for (const [cd, v] of Object.entries(obj)) {
        const e = v && typeof v === 'object' ? v : {};
        out[String(cd)] = {
            normal: Number(e.normal || 0),
            shine: Number(e.shine || 0),
            premium: Number(e.premium || 0),
        };
        }
        return out;
    }

    function readOwnedMap_() {
        // OwnedStore 優先
        try {
        if (window.OwnedStore?.getAll) {
            const s = window.OwnedStore.getAll();
            if (s && typeof s === 'object') return sanitizeOwnedMap_(s);
        }
        } catch {}

        // localStorage fallback
        try {
        const raw = localStorage.getItem(LS_KEY);
        return raw ? sanitizeOwnedMap_(JSON.parse(raw)) : {};
        } catch {
        return {};
        }
    }

    function writeOwnedMap_(map) {
        try {
        localStorage.setItem(LS_KEY, JSON.stringify(map || {}));
        } catch {}
    }

    /* ---------- 上限枚数（旧神=1 / その他=3） ---------- */
    function maxAllowedCount(cd, raceHint) {
        if (raceHint === '旧神') return 1;

        let race = raceHint || '';
        if (!race && typeof cd !== 'undefined') {
        // cardsCache があればそこから
        try {
            if (Array.isArray(window.__cardsCache)) {
            const hit = window.__cardsCache.find(c => String(c.cd) === String(cd));
            if (hit?.race) race = hit.race;
            }
        } catch {}
        // DOMからも拾える
        if (!race) {
            const el = document.querySelector(`.card[data-cd="${cd}"]`);
            race = el?.dataset?.race || '';
        }
        }
        return (race === '旧神') ? 1 : 3;
    }

// ---------- 表示反映（1枚カード） ----------
function paintCard(cardEl, count, opts = {}) {
  if (!cardEl) return;

  count = Number(count || 0);

  // ✅ owned-mark の表示ズレも検知する（0枚のときに消えがち問題対策）
  const mark = cardEl.querySelector('.owned-mark');
  const wantText = String(count);

  const markNeedsFix = !!(mark && (
    mark.textContent !== wantText ||
    mark.style.display === 'none' ||
    mark.hidden
  ));

  // ✅ 変化がないなら何もしない（ただしマーク表示ズレがあるなら更新する）
  const prev = Number(cardEl.dataset.count || 0);
  const prevGray = cardEl.classList.contains('grayscale');
  const nextGray = !!(opts.grayscale && count === 0);
  if (prev === count && prevGray === nextGray && !markNeedsFix) return;

  cardEl.classList.remove('owned-0','owned-1','owned-2','owned-3','owned','grayscale');
  cardEl.classList.add(`owned-${count}`);
  cardEl.classList.add('owned');
  if (nextGray) cardEl.classList.add('grayscale');

  if (mark) {
    mark.textContent = wantText;
    mark.style.display = 'flex';
    mark.hidden = false;
  }

  cardEl.dataset.count = String(count);
}



// ---------- 一括同期 ----------
function syncOwnedMarks(rootSelector = '#packs-root', opts = {}) {
  const owned = readOwnedMap_();
  const root = document.querySelector(rootSelector);
  if (!root) return;

  root.querySelectorAll('.card').forEach((el) => {
    const cd = String(el.dataset.cd || '');
    const e = owned[cd] || { normal: 0, shine: 0, premium: 0 };
    const total = (e.normal|0) + (e.shine|0) + (e.premium|0);
    paintCard(el, total, opts);
  });

  // ✅ ここ：チェッカー一括操作では summary を呼ばない
  if (!opts.skipSummary) {
    try { window.updateSummary?.(); } catch {}
  }
  if (!opts.skipOwnedTotal) {
    try { window.updateOwnedTotal?.(); } catch {}
  }
}


// ---------- 初回：カードDOM生成待ち→同期 ----------
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

// ---------- 公開I/F ----------
window.OwnedUI = {
  bind(rootSelector = '#packs-root', opts = {}) {
    ensureOwnedStore_();

    waitForCardsAndSync(rootSelector, opts);

    if (typeof window.OwnedStore?.onChange === 'function') {
      window.OwnedStore.onChange(() => syncOwnedMarks(rootSelector, opts));
    }

    // ✅ 既存互換：ただし上書きしない（競合防止）
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



    /* ---------- 操作系（ボタン/クリック用） ---------- */
    function totalOf(cd) {
        ensureOwnedStore_();
        const e = window.OwnedStore.get(String(cd));
        return (e.normal|0) + (e.shine|0) + (e.premium|0);
    }

    function setTotal(cd, n, raceHint) {
        ensureOwnedStore_();
        const max = maxAllowedCount(cd, raceHint);
        const count = Math.max(0, Math.min(max, n|0));
        window.OwnedStore.set(String(cd), { normal: count, shine: 0, premium: 0 });
    }

    function bumpOwnership(el, times = 1) {
        const cd = el?.dataset?.cd;
        if (!cd) return;
        const race = el?.dataset?.race || '';
        const now = totalOf(cd);
        const max = maxAllowedCount(cd, race);
        setTotal(cd, Math.min(max, now + (times|0)), race);
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
        const next = (now >= max) ? 0 : (now + 1);

        window.OwnedStore.set(cd, { normal: next, shine: 0, premium: 0 });
        } catch (err) {
        console.error('toggleOwnership failed:', err);
        }
    }


    // 既存互換（古いコードが window.* を探しに来る）
    window.maxAllowedCount = maxAllowedCount;
    window.bumpOwnership = bumpOwnership;
    window.setOwnership = setOwnership;
    window.clearOwnership = clearOwnership;
    window.toggleOwnership = toggleOwnership;

    // 初期化だけは即時
    ensureOwnedStore_();
})();


