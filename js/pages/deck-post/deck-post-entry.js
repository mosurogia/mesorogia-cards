/* ==================================================
 * js/pages/deck-post/deck-post-entry.js
 * - deck-postページの起動ハブ
 * - 各モジュールの初期化順を管理
================================================== */

// ★ここに追加（ファイル最上部でOK）
window.debugLog = function(...args){
  const el = document.getElementById('debug-log') || (() => {
    const d = document.createElement('div');
    d.id = 'debug-log';
    d.style = `
      position:fixed;
      bottom:0;
      left:0;
      right:0;
      max-height:40%;
      overflow:auto;
      background:#000;
      color:#0f0;
      font-size:11px;
      z-index:99999;
    `;
    document.body.appendChild(d);
    return d;
  })();

  el.innerHTML += `<div>${args.map(a=>JSON.stringify(a)).join(' ')}</div>`;
};

window.addEventListener('error', (e) => {
  debugLog('❌ JS error', e.message, e.filename, e.lineno);
});

window.addEventListener('unhandledrejection', (e) => {
  debugLog('❌ Promise error', e.reason?.message || e.reason);
});


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

    // ===== 初期ハッシュ遷移 =====
  async function openInitialHashPage_() {
    const hash = String(location.hash || '').replace('#', '');

    if (hash !== 'mine') return;

    try {
      // ログイン表示更新
      window.DeckPostList?.handleAuthChanged?.();

      // マイ投稿事前取得
      await window.prefetchMineItems_?.();

      // マイ投稿表示
      window.DeckPostList?.showMine?.();

      // 1ページ目読み込み
      await window.DeckPostList?.loadMinePage?.(1);
    } catch (e) {
      console.error('初期マイ投稿表示失敗', e);
    }
  }

  // ===== 初期化 =====
async function init() {
  debugLog('① init開始');

  if (initialized) {
    debugLog('init済みなので中断');
    return;
  }

  state = window.DeckPostState?.getState?.() || window.__DeckPostState || null;
  debugLog('② state取得', !!state);

  if (!state) {
    debugLog('❌ state未ロード');
    console.error('DeckPostState is not ready');
    window.DeckPostList?.showListStatusMessage?.('error', '初期化に失敗しました（state未ロード）');
    return;
  }

  try {
    window.DeckPostList?.showListStatusMessage?.('loading', '投稿一覧を読み込み中です…(5秒ほどかかります)');
  } catch (e) {
    debugLog('status表示エラー', e.message);
  }

  await waitForPaint_();

  debugLog('③ cardMap読み込み前');

  try {
    await window.ensureCardMapLoaded();
    debugLog('④ cardMap成功', Object.keys(window.cardMap || {}).length);
  } catch (e) {
    debugLog('❌ cardMap失敗', e.message);
    console.error('カードマスタ読み込みに失敗しました', e);
  }

  debugLog('⑤ token設定前');

  window.DeckPostState?.setToken?.(
    window.DeckPostApi?.resolveToken?.() || ''
  );

  debugLog('⑥ handleAuthChanged前');
  window.DeckPostList?.handleAuthChanged?.();

  debugLog('⑦ list init前');

  try {
    await window.DeckPostList?.init?.();
    debugLog('⑧ list init成功');
  } catch (e) {
    debugLog('❌ list init失敗', e.message);
    console.error(e);
  }

  debugLog('⑨ detail init前');
  window.DeckPostDetail?.init?.();

  debugLog('⑩ campaign init前');
  window.DeckPostCampaign?.init?.();

  debugLog('⑪ hash処理前');
  await openInitialHashPage_();

  initialized = true;
  debugLog('✅ init完了');
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
