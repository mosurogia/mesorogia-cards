/* ==================================================
 * js/pages/deck-post/deck-post-entry.js
 * - deck-postページの起動ハブ
 * - 各モジュールの初期化順を管理
================================================== */

const DeckPostApp = (() => {
  'use strict';

  let state = null;
  let initialized = false;

  // ローディング表示を重い初期化より先に描画させる
  function waitForPaint_() {
    return new Promise((resolve) => {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          window.setTimeout(resolve, 0);
        });
        return;
      }
      window.setTimeout(resolve, 0);
    });
  }

  // ===== 初期化 =====
  async function init() {
    if (initialized) return;

    // state は deck-post-state.js で管理する（後ロード対応）
    state = window.DeckPostState?.getState?.() || window.__DeckPostState || null;
    if (!state) {
      console.error('DeckPostState is not ready');
      window.DeckPostList?.showListStatusMessage?.('error', '初期化に失敗しました（state未ロード）');
      return;
    }

    // ① カードマスタ読み込み（デッキリスト・カード解説で使う）
    try {
      window.DeckPostList?.showListStatusMessage?.('loading', '投稿一覧を読み込み中です…(5秒ほどかかります)');
    } catch (e) {}

    await waitForPaint_();

    try {
      await window.ensureCardMapLoaded();
      console.log('cardMap loaded, size =', Object.keys(window.cardMap || {}).length);
    } catch (e) {
      console.error('カードマスタ読み込みに失敗しました', e);
    }

    // ② トークン
    window.DeckPostState?.setToken?.(
      window.DeckPostApi?.resolveToken?.() || ''
    );

    // ログイン状態初期反映（ID表示だけ & マイ投稿表示中なら読み込み）
    window.DeckPostList?.handleAuthChanged?.();

    // ③ 一覧ページ初期化
    await window.DeckPostList?.init?.();

    // ④ 詳細UI初期化
    window.DeckPostDetail?.init?.();

    // ⑤ キャンペーンUI初期化
    window.DeckPostCampaign?.init?.();

    initialized = true;
  }

  // loader の ready を起点に初期化（後ロードJSでも確実）
  if (typeof window.onDeckPostReady === 'function') {
    window.onDeckPostReady(init);
  } else {
    window.addEventListener('deck-post-page:ready', init, { once: true });
    window.addEventListener('deckpost:ready', init, { once: true });
  }

  return {
    init,
  };
})();

window.DeckPostApp = DeckPostApp;
