/* =========================
 * pages/deckmaker/deckmaker-tabs.js
 * - デッキメーカーのタブ切替後処理
 * - ✅ どのタブでも共通同期（renderDeckList等）を必ず通す
 * ========================= */
(function () {
  'use strict';

  // タブ切替後の共通処理（タブ固有処理は tab:switched 内で分岐）
  window.afterTabSwitched ??= function (targetId) {};

  document.addEventListener('tab:switched', (e) => {
    const id = e?.detail?.targetId;

    // ----------------------------
    // 1) タブ固有処理（returnしない）
    // ----------------------------
    if (id === 'edit') {
      // 分析タブのグラフ更新（分析タブ内のサブタブ切替はこれに含まない）
      if (typeof window.updateDeckAnalysis === 'function') window.updateDeckAnalysis();
      if (typeof window.updateExchangeSummary === 'function') window.updateExchangeSummary();

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (id === 'build') {
      // 所持オーバーレイ同期
      if (typeof window.refreshOwnedOverlay === 'function') window.refreshOwnedOverlay();

      // hideInvalidRace ONの時だけ hidden-by-grayscale を反映
      if (window.DeckmakerFilter?.applyHideInvalidRaceView) {
        window.DeckmakerFilter.applyHideInvalidRaceView();
      }
      // ✅ 旧互換：デッキ種族に応じたモノクロ/使用中ラベルを再適用
    if (typeof window.updateCardDisabling === 'function') window.updateCardDisabling();
    if (typeof window.applyGrayscaleFilter === 'function') window.applyGrayscaleFilter();
    }

    if (id === 'info-tab') {
      if (typeof window.updateDeckSummaryDisplay === 'function') window.updateDeckSummaryDisplay();
      if (typeof window.updateExchangeSummary === 'function') window.updateExchangeSummary();
    }

    if (id === 'info-tab' || id === 'post-tab') {
      if (typeof window.syncDeckNameFields === 'function') window.syncDeckNameFields();
    }
    if (id === 'post-tab') {
      // 投稿タブ初期化（旧 afterTabSwitched 相当）
      if (typeof window.initDeckPostTab === 'function') window.initDeckPostTab();
    }

    // ----------------------------
    // 2) ✅ 共通同期（どのタブでも必ずやる）
    // ----------------------------
    // デッキリストの×Nバッジ同期
    if (typeof window.renderDeckList === 'function' && document.getElementById('deck-card-list')) {
      window.renderDeckList();
      if (typeof window.autoscaleAllBadges === 'function') {
        requestAnimationFrame(window.autoscaleAllBadges);
      }
    }

    // 既存互換：他コードがこのイベントでプレビューを閉じる等
    document.dispatchEvent(new Event('deckTabSwitched'));
  });
    // =====================================================
  // 互換API：分析＆投稿タブ → デッキ投稿まで一気に移動
  // - HTML: onclick="goToAnalyzeTab()" の互換 :contentReference[oaicite:8]{index=8}
  // =====================================================
  window.goToAnalyzeTab ??= function goToAnalyzeTab() {
    // 1) 上段タブを edit に
    const tab2 = document.querySelector('#tab2');
    if (tab2 && typeof window.switchTab === 'function') {
      window.switchTab('edit', tab2);
    }

    // 2) edit内サブタブを post-tab に
    const postTabBtn =
      document.querySelector('#deck-info .post-tab-bar') ||
      document.querySelector('#deck-info [onclick*="post-tab"]');

    if (postTabBtn && typeof window.switchTab === 'function') {
      window.switchTab('post-tab', postTabBtn);
    }

    // 3) 念のため同期（tab:switched側でも共通同期されるが、旧page2互換で保険）
    requestAnimationFrame(() => {
      if (typeof window.renderDeckList === 'function') window.renderDeckList();
      if (typeof window.updateDeckAnalysis === 'function') window.updateDeckAnalysis();
      if (typeof window.updateExchangeSummary === 'function') window.updateExchangeSummary();
    });
  };
})();