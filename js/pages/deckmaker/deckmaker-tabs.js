/* =========================
 * pages/deckmaker/deckmaker-tabs.js
 * - デッキメーカーのタブ切替後処理
 * - ✅ どのタブでも共通同期（renderDeckList等）を必ず通す
 * ========================= */
(function () {
  'use strict';

  const MULLIGAN_ANALYSIS_GUIDE_KEY = 'deckmaker_mulligan_analysis_guide_seen_at';
  const MULLIGAN_ANALYSIS_GUIDE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  const MULLIGAN_ANALYSIS_GUIDE_HIDE_MS = 10000;
  const MULLIGAN_ANALYSIS_GUIDE_DISABLE_RECENT_CHECK = false;
  const MULLIGAN_ANALYSIS_GUIDE_RESET_ON_RELOAD = true;
  let mulliganAnalysisGuideTimer = 0;

  if (MULLIGAN_ANALYSIS_GUIDE_RESET_ON_RELOAD) {
    try { localStorage.removeItem(MULLIGAN_ANALYSIS_GUIDE_KEY); } catch (_) {}
  }

  function getDeckCardCount() {
    return Object.values(window.deck || {}).reduce((sum, count) => sum + (count | 0), 0);
  }

  function hasRecentlyShownMulliganAnalysisGuide_() {
    if (MULLIGAN_ANALYSIS_GUIDE_DISABLE_RECENT_CHECK) return false;
    try {
      const last = Number(localStorage.getItem(MULLIGAN_ANALYSIS_GUIDE_KEY) || 0);
      return last > 0 && Date.now() - last < MULLIGAN_ANALYSIS_GUIDE_INTERVAL_MS;
    } catch (_) {
      return true;
    }
  }

  function updateMulliganAnalysisGuide_() {
    const guide = document.getElementById('mulligan-analysis-guide');
    if (!guide) return;

    const isBuildVisible = document.getElementById('build')?.classList.contains('active');
    const shouldShow = isBuildVisible
      && getDeckCardCount() >= 30
      && !hasRecentlyShownMulliganAnalysisGuide_();

    if (mulliganAnalysisGuideTimer) {
      clearTimeout(mulliganAnalysisGuideTimer);
      mulliganAnalysisGuideTimer = 0;
    }
    guide.hidden = !shouldShow;
    if (!shouldShow) return;

    try { localStorage.setItem(MULLIGAN_ANALYSIS_GUIDE_KEY, String(Date.now())); } catch (_) {}
    mulliganAnalysisGuideTimer = window.setTimeout(() => {
      guide.hidden = true;
      mulliganAnalysisGuideTimer = 0;
    }, MULLIGAN_ANALYSIS_GUIDE_HIDE_MS);
  }

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
      requestAnimationFrame(updateMulliganAnalysisGuide_);
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
      requestAnimationFrame(updateMulliganAnalysisGuide_);
    }

    if (id === 'info-tab') {
      if (typeof window.updateDeckSummaryDisplay === 'function') window.updateDeckSummaryDisplay();
      if (typeof window.updateExchangeSummary === 'function') window.updateExchangeSummary();
      requestAnimationFrame(updateMulliganAnalysisGuide_);
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
  function goToAnalyzeSubtab(subtabId, subtabClass) {
    // 1) 上段タブを edit に
    const tab2 = document.querySelector('#tab2');
    if (tab2 && typeof window.switchTab === 'function') {
      window.switchTab('edit', tab2);
    }

    // 2) edit内サブタブを切り替え
    const subtabBtn =
      document.querySelector(`#deck-info .${subtabClass}`) ||
      document.querySelector(`#deck-info [onclick*="${subtabId}"]`);

    if (subtabBtn && typeof window.switchTab === 'function') {
      window.switchTab(subtabId, subtabBtn);
    }

    // 3) 念のため同期（tab:switched側でも共通同期されるが、旧page2互換で保険）
    requestAnimationFrame(() => {
      if (typeof window.renderDeckList === 'function') window.renderDeckList();
      if (typeof window.updateDeckAnalysis === 'function') window.updateDeckAnalysis();
      if (typeof window.updateExchangeSummary === 'function') window.updateExchangeSummary();
    });
  }

  window.goToDeckInfoTab ??= function goToDeckInfoTab() {
    goToAnalyzeSubtab('info-tab', 'info-tab-bar');
  };

  window.goToAnalyzeTab ??= function goToAnalyzeTab() {
    goToAnalyzeSubtab('post-tab', 'post-tab-bar');
  };

  window.updateMulliganAnalysisGuide = updateMulliganAnalysisGuide_;
})();
