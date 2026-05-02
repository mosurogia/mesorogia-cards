/* =========================================================
 * pages/deckmaker-entry.js
 * ---------------------------------------------------------
 * 【役割】
 * デッキメーカー専用エントリーポイント。
 * deckmakerページの初期化・カード一覧生成・起動フロー統合を担当する。
 *
 * 【主な責務】
 * 1. deckモード用カード要素生成の差し替え
 *    - 左クリック：追加
 *    - 右クリック：削除
 *    - 🔎ボタン：詳細表示
 *
 * 2. カード一覧ロード（loadCards）
 *    - cards_latest を取得
 *    - gridへカードDOM生成
 *    - フィルター適用
 *
 * 3. デッキメーカー起動統合処理（initDeckmakerPage）
 *    - cardMapの保証
 *    - オートセーブ復元
 *    - フルカードデータ確定
 *    - カード一覧描画
 *    - フィルター／ソート／所持表示同期
 *    - ロングプレス結線
 *
 * 4. UI補助
 *    - dmToast（page2から移植）
 *    - キャンペーンバナー表示
 *
 * 【依存モジュール】
 * - common/card-core.js
 * - features/cardGrid.js（CardUI）
 * - deckmaker-deck.js（updateDeck / removeCard 等）
 * - deckmaker-filter.js
 * - deckmaker-ui.js（任意）
 * - loader.js（onDeckmakerReady）
 *
 * 【設計方針】
 * - deckmakerページ専用ロジックのみをここに集約
 * - 共通処理は common / features 側へ委譲
 * - 初期化は loader 経由で一元管理
 * ========================================================= */

(function () {
  'use strict';

  // =========================================================
  // 0) no-op（任意モジュール未読込の間のTDZ/参照エラー防止）
  // =========================================================
  window.updateDeckAnalysis ??= function () {};
  window.updateExchangeSummary ??= function () {};
  window.ensurePacksLoaded ??= async function () {};

  // =========================================================
  // 1) dmToast（page2から移植）
  // =========================================================
  window.dmToast ??= (() => {
    let el = null;
    let t = null;

    function ensure() {
      if (el && document.body.contains(el)) return el;
      el = document.createElement('div');
      el.className = 'dm-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
      return el;
    }

    return (msg, ms = 1800) => {
      const e = ensure();
      e.textContent = String(msg ?? '');
      e.classList.add('show');
      clearTimeout(t);
      t = setTimeout(() => e.classList.remove('show'), ms);
    };
  })();

  // =========================================================
  // 2) deck専用カード生成（差し替え）
  //    - 右クリックで削除（removeCard）
  // =========================================================
  function generateCardListElementDeck(card) {
    if (!window.CardUI?.createCardElement) {
      const div = document.createElement('div');
      div.className = 'card';
      return div;
    }

    return window.CardUI.createCardElement(card, {
      mode: 'deck',
      enableZoomBtn: true,
      enableOwnedMark: true,
      onImageRightClick: (card, e) => {
        try {
          e?.preventDefault?.();
          e?.stopPropagation?.();
        } catch (_) {}
        window.removeCard?.(card.cd);
      },
    });
  }

  // entry側で生成関数を上書きして「deckモード優先」にする
  window.generateCardListElement = generateCardListElementDeck;

  // =========================================================
  // 3) カード一覧ロード（page2から移植）
  //    ※ initDeckmakerPage より先に定義するのが重要
  // =========================================================
  window.loadCards = async function loadCards() {
    const grid = window.$id?.('grid') || document.getElementById('grid');
    if (!grid) return;

    const latest = await window.fetchLatestCards?.();
    if (!Array.isArray(latest) || latest.length === 0) {
      console.warn('[deckmaker] cards_latest が空です');
      return;
    }

    grid.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const raw of latest) {
      const cd5 = window.normCd5 ? window.normCd5(raw.cd ?? raw.id) : String(raw.cd ?? raw.id ?? '').padStart(5, '0');
      const card = window.cardMap?.[cd5] || { ...raw, cd: cd5 };

      // ✅ entryの差し替え生成を優先
      const el =
        (typeof window.generateCardListElement === 'function'
          ? window.generateCardListElement(card)
          : window.CardUI?.createCardElement?.(card, { mode: 'deck' }));

      if (el) frag.appendChild(el);
    }

    grid.appendChild(frag);

    // deckmaker専用applyがあればそちら優先
    const af = window.DeckmakerFilter?.applyFilters || window.applyFilters;
    if (typeof af === 'function') af();
  };

  // =========================================================
  // 4) deckmaker 起動処理（集約）
  // =========================================================
  window.initDeckmakerPage = async function initDeckmakerPage() {
    if (window.__deckmakerInited) return;
    window.__deckmakerInited = true;

    // 1) cardMap を確実に用意（復元 → updateDeck が cardMap を使うため最優先）
    try {
      await window.ensureCardMapLoaded?.();
    } catch (e) {
      console.warn('cardMap 読み込みに失敗:', e);
    }

    // 2) オートセーブ復元（cardMap 準備後）
    // deckmaker-deck.js は window.maybeRestoreFromStorage を公開している想定
    try {
      window.maybeRestoreFromStorage?.();

      // maybeRestoreFromStorage 内で updateDeck してる構成もあり得るが、
      // 表示が空になる事故を防ぐためここでも念のため同期する
      window.updateDeck?.();
      window.updateCardDisabling?.();
    } catch (e) {
      console.warn('オートセーブ復元に失敗:', e);
    }

    // 3) カードデータを「フル」へ確定（軽量cardMap対策）
    // ※ ensureCardMapLoaded はもう済んでいるので、ここでは二重 await を避ける
    try {
      const cardMap = window.cardMap || null;
      const cards = cardMap ? Object.values(cardMap) : null;

      const needsFull =
        !cards || !cards.length ||
        (cards[0].pack_name == null) ||
        (cards[0].field == null) ||
        (cards[0].special_ability == null) ||
        (cards[0].BP_flag == null);

      if (needsFull) {
        const full = await window.fetchLatestCards?.();
        if (Array.isArray(full) && full.length) {
          window.cards = full;
          window.allCards = full;
        }
      }
    } catch (e) {
      console.warn('カードデータのフル確定に失敗:', e);
    }

    // 4) ロード＆保存デッキ表示
    try {
      await window.loadCards?.();

      // 保存デッキ（共通UI）
      // - bind(): 一覧描画 + 読込/削除ボタンのイベント委譲を張る
      // - cardMap 確保後に呼ぶ必要があるので initDeckmakerPage 内でOK
      if (window.SavedDeckUI?.bind) {
        window.SavedDeckUI.bind({
          key: window.SavedDeckStore?.KEY || 'savedDecks',
          cap: 20,
          containerId: 'savedDeckList',
          counterId: 'savedDeckCount',
          hooks: {
            // 読み込み後に何か追加でやりたい場合はここ（今は無しでもOK）
            onLoaded: () => {}
          }
        });
      } else {
        // フォールバック（互換関数が生えてる場合）
        window.updateSavedDeckList?.();
      }
    } catch (e) {
      console.error('起動時の初期ロードに失敗:', e);
    }

    // 5) 初期確定（存在するものだけ）
    requestAnimationFrame(() => {
      try { window.applyFilters?.(); } catch (e) { console.warn(e); }
      try { window.sortCards?.(); } catch (e) { console.warn(e); }
      try { window.refreshOwnedOverlay?.(); } catch (e) { console.warn(e); }
    });

    // 6) ロングプレス結線（遅延でOK）
    const bind = () => window.__bindLongPressForCards?.('deckmaker');
    if ('requestIdleCallback' in window) requestIdleCallback(bind, { timeout: 800 });
    else if ('requestAnimationFrame' in window) requestAnimationFrame(() => setTimeout(bind, 0));
    else setTimeout(bind, 0);
  };

  // =========================================================
  // 5) キャンペーンバナー表示（UI補助）
  // =========================================================
  async function initCampaignBanner() {
    try {
      const camp = await window.fetchActiveCampaign?.({ ttlMs: 60000 });
      if (!camp) return;

      const mini = document.getElementById('campaign-mini');
      const text = document.getElementById('campaign-mini-text');
      if (!mini || !text) return;

      text.textContent = camp.title || 'キャンペーン開催中';
      mini.style.display = '';
    } catch (_) {}
  }

  // =========================================================
  // 6) 起動トリガー（loader の onDeckmakerReady に統一）
  // =========================================================
  const boot = () => window.initDeckmakerPage?.();

  if (typeof window.onDeckmakerReady === 'function') {
    // loader側が ready を管理している場合はこちら
    window.onDeckmakerReady(boot);
  } else {
    // 単体でも動くようフォールバック
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  }

  // =========================================================
  // 7) DOMContentLoaded時に走らせたいUI（起動とは独立）
  // =========================================================
  document.addEventListener('DOMContentLoaded', () => {
    initCampaignBanner();
    // 他に初期化するUIがあればここで呼び出す
  });
})();
