/**
 * js/pages/deckmaker/deckmaker-loader.js
 * - deckmakerページ専用ローダー：ページ専用JSを「依存順」で順番読み込み
 * - HTML は「共通（common/ui/features）」＋「このローダー1本」だけ置けばOK
 *
 * ✅ 重要：
 * loader で「後から」読み込まれたJSは DOMContentLoaded を取り逃がすことがあるため、
 * 読み込み完了後に 'deckmaker-page:ready' を dispatch して、各JSはそれを起点に初期化する。
 */

(function () {
  'use strict';

  const BASE = 'js/pages/deckmaker/';

  // ロードするファイル（順番に注意）
  const FILES = [
    'deckmaker-entry.js',
    'deck.js',
    'filter.js',
    'deck-ui.js',
    'deck-shortage-ui.js',
    'mulligan.js',
    'post.js',
    'campaign.js',
    'deckmaker-tabs.js',
  ];

  // ------------------------------------------------------
  // 順番ロード（async=false で「依存順」を守る）
  // ------------------------------------------------------
  function loadSeq(files, i, done) {
    if (i >= files.length) return done && done();

    const s = document.createElement('script');
    s.src = BASE + files[i];
    s.async = false;

    s.onload = () => loadSeq(files, i + 1, done);
    s.onerror = () => {
      console.error('[deckmaker-page-loader] failed:', s.src);
      alert('ページの初期化に失敗しました（JSロード失敗）\n' + s.src);
    };

    document.head.appendChild(s);
  }

  // ------------------------------------------------------
  // ✅ “後から読み込まれたJS”でも拾える ready 合図
  // - window.onDeckmakerReady(fn) を用意（ready済みなら即実行）
  // - 最後に 'deckmaker-page:ready' を dispatch
  // ------------------------------------------------------
  const q = [];
  window.onDeckmakerReady = window.onDeckmakerReady || function (fn) {
    if (window.__deckmakerReadyFired) {
      try { fn(); } catch (e) { console.error(e); }
      return;
    }
    q.push(fn);
  };

  function fireReady_() {
    // DOMがまだなら待つ（図鑑ローダーと同じ思想）
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fireReady_, { once: true });
      return;
    }

    // ready 確定
    if (window.__deckmakerReadyFired) return;
    window.__deckmakerReadyFired = true;

    // 先に “登録式コールバック” を消化
    while (q.length) {
      const fn = q.shift();
      try { fn && fn(); } catch (e) { console.error(e); }
    }

    // 最後にイベントも投げる（好みでどちらでも使える）
    window.dispatchEvent(new Event('deckmaker-page:ready'));
  }

  // ------------------------------------------------------
  // 実行
  // ------------------------------------------------------
  loadSeq(FILES, 0, () => {
    fireReady_();
  });

})();