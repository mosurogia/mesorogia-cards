/**
 * js/pages/deckmaker/deckmaker-filter.js
 *
 * 【役割】
 * デッキメーカー画面専用の軽量フィルター。
 *
 * - キーワード検索（スペース区切りAND）
 * - タイプ即時フィルター（type-icon-btn：単一選択）
 * - 使用不可種族の非表示切替（grayscale → hidden-by-grayscale）
 * - 所持枚数バッジ同期（OwnedUI に委譲）
 *
 * 【設計方針】
 * - カードマスタ/ソートは common/card-core.js に委譲
 * - 所持データの描画は common/owned.js（OwnedUI）に委譲
 * - このファイルは deckmaker 固有の UI 制御のみ担当
 */
(function () {
  'use strict';

  // =====================================================
  // 0) ready（loader後読み込みでも確実に初期化）
  // =====================================================
  function onReady_(fn) {
    if (typeof window.onDeckmakerReady === 'function') {
      window.onDeckmakerReady(fn);
      return;
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  // =====================================================
  // 1) 使用不可種族カードを「非表示」反映（grayscale → hidden-by-grayscale）
  // =====================================================
  let hideInvalidRace = false;

  // ✅ 新：役割名（hidden-by-grayscale の付け外し）
  function applyHideInvalidRaceView() {
    document.querySelectorAll('.card').forEach(card => {
      const isGrayscale = card.classList.contains('grayscale') || card.classList.contains('grayscale-race');
      if (hideInvalidRace && isGrayscale) card.classList.add('hidden-by-grayscale');
      else card.classList.remove('hidden-by-grayscale');
    });
  }

  function toggleInvalidRace_(btn) {
    hideInvalidRace = !hideInvalidRace;
    btn.classList.toggle('active', hideInvalidRace);
    btn.textContent = hideInvalidRace ? '🚫使用不可種族を非表示' : '✅使用不可種族を表示(モノクロ)';
    applyHideInvalidRaceView();
  }

  // ✅ deckmaker ではこれを「正式API」にする（cardFilter.js が呼ぶため）
  // - grayscale が付いているカードを、hideInvalidRace ON の時だけ hidden-by-grayscale にする
  window.applyGrayscaleFilter ??= applyHideInvalidRaceView;

  // =====================================================
  // 2) フィルター（keyword + type quick）
  // =====================================================
  function getSelectedQuickType_() {
    let selectedType = '';
    document.querySelectorAll('.type-icon-btn').forEach(btn => {
      if (btn.classList.contains('is-active')) selectedType = btn.dataset.type || '';
    });
    return String(selectedType || '');
  }

  function getCvTokens_() {
    const input = document.getElementById('cv-filter');
    if (typeof window.getKeywordTokens === 'function') return window.getKeywordTokens(input);
    return String(input?.value || '').normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
  }

  function buildCvHaystack_(cardEl) {
    const ds = cardEl?.dataset || {};
    const raw = [ds.cv, ds.cvKana].filter(Boolean).join(' ');
    if (typeof window.normalizeJapaneseKeyword === 'function') return window.normalizeJapaneseKeyword(raw);
    return raw.normalize('NFKC').toLowerCase().trim();
  }

  function applyFilters() {
    const tokens = window.getKeywordTokens?.('keyword') || [];
    const cvTokens = getCvTokens_();
    const selectedType = getSelectedQuickType_();

    document.querySelectorAll('.card').forEach(cardEl => {
      const type = cardEl.dataset.type || '';
      const haystack = window.buildKeywordHaystack?.(cardEl) || '';
      const cvHaystack = buildCvHaystack_(cardEl);

      let visible = true;

      if (!(window.matchesKeywordTokens?.(haystack, tokens) ?? true)) visible = false;
      if (visible && !(window.matchesKeywordTokens?.(cvHaystack, cvTokens) ?? true)) visible = false;
      if (visible && selectedType && selectedType !== type) visible = false;

      cardEl.style.display = visible ? '' : 'none';
    });

    // ✅ 非表示反映（grayscale を前提に hidden-by-grayscale を付ける）
    applyHideInvalidRaceView();

    // 所持バッジ同期（deckmakerはsummary不要）
    try {
      window.OwnedUI?.sync?.('#grid', { skipSummary: true, skipOwnedTotal: true });
    } catch {}
  }

  // =====================================================
  // 3) イベント結線
  // =====================================================
  onReady_(() => {
    const toggleBtn = document.getElementById('toggle-invalid-race');
    if (toggleBtn) {
      toggleBtn.removeAttribute('onclick');
      toggleBtn.addEventListener('click', () => toggleInvalidRace_(toggleBtn));
    }

    document.getElementById('keyword')?.addEventListener('input', applyFilters);

    document.querySelectorAll('.type-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.type-icon-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        applyFilters();
      });
    });

    document.getElementById('sort-select')?.addEventListener('change', () => {
      try { window.sortCards?.(); } catch {}
      try { window.OwnedUI?.sync?.('#grid', { skipSummary: true, skipOwnedTotal: true }); } catch {}
    });

    // 所持UI bind（OwnedStore変更に追従）
    try { window.OwnedUI?.bind?.('#grid', { skipSummary: true, skipOwnedTotal: true }); } catch {}

    applyFilters();
  });

  // =====================================================
  // 4) 公開API
  // =====================================================
  window.DeckmakerFilter = window.DeckmakerFilter || {};
  window.DeckmakerFilter.applyFilters = applyFilters;
  window.DeckmakerFilter.toggleInvalidRace = toggleInvalidRace_;
  window.DeckmakerFilter.applyHideInvalidRaceView = applyHideInvalidRaceView;

  // ✅ 互換：旧 page2.js が applyFilters 前提でも動くように --- IGNORE ---
  window.applyFilters ??= applyFilters;

  // ✅ 互換：旧 page2.js が toggleInvalidRace 前提でも動くように --- IGNORE ---
  window.readOwnedMapForDeckmaker ??= function readOwnedMapForDeckmakerCompat() {
    // 1) OwnedStore があるなら最優先
    try {
      if (window.OwnedStore?.getAll) {
        const all = window.OwnedStore.getAll() || {};
        const out = {};
        for (const cd in all) {
          const k = window.normCd5 ? window.normCd5(cd) : String(cd).padStart(5, '0').slice(0, 5);
          const v = all[cd];
          out[k] = {
            normal:  typeof v === 'number'
              ? (v | 0)
              : (v?.normal | 0),
          };
        }
        return out;
      }
    } catch {}

    // 2) localStorage フォールバック
    try {
      const raw = JSON.parse(localStorage.getItem('ownedCards') || '{}') || {};
      const out = {};
      for (const cd in raw) {
        const k = window.normCd5 ? window.normCd5(cd) : String(cd).padStart(5, '0').slice(0, 5);
        const v = raw[cd];
        out[k] = (v && typeof v === 'object')
          ? { normal: (v.normal | 0) }
          : { normal: (v | 0) };
      }
      return out;
    } catch {}

    return {};
  };

  // ✅ 互換（page2 の呼び出し残り対策）
  // - 旧: refreshOwnedOverlay() / toggleOwned()
  // - 新: common/owned.js の OwnedUI に委譲
  window.refreshOwnedOverlay ??= function refreshOwnedOverlayCompat() {
    try {
      window.OwnedUI?.sync?.('#grid', { skipSummary: true, skipOwnedTotal: true });
    } catch {}
  };

  window.toggleOwned ??= function toggleOwnedCompat() {
    // deckmaker は「常時表示」運用なので、再同期だけでOK
    try {
      window.OwnedUI?.sync?.('#grid', { skipSummary: true, skipOwnedTotal: true });
    } catch {}
    // deck-info 未読込なら no-op（deckmaker-entry.js 側のスタブで落ちない）
    try { window.updateExchangeSummary?.(); } catch {}
  };

})();
