/**
 * js/pages/deckmaker/deckmaker-loader.js
 * - deckmakerページ専用ローダー：ページ専用JSを依存順で直列ロード
 * - HTML は共通JSの後に、このローダー1本だけを置けばよい
 *
 * ローダーで後から読み込まれたJSは DOMContentLoaded を取り逃がすことがあるため、
 * 読み込み完了後に 'deckmaker-page:ready' を dispatch し、各JSはそれを起点に初期化する。
 */
(function () {
  'use strict';

  const BASE = 'js/pages/deckmaker/';

  const FILES = [
    'deckmaker-entry.js',
    'deckmaker-deck.js',
    'deckmaker-filter.js',
    'deckmaker-ui.js',
    'deckmaker-shortage-ui.js',
    'deckmaker-mulligan.js',
    'deckmaker-post.js',
    'deckmaker-campaign.js',
    'deckmaker-tabs.js',
  ];

  function getAssetVersion_() {
    return String(window.MESOROGIA_PWA_CACHE_CONFIG?.version || 'dev').trim() || 'dev';
  }

  function buildScriptUrl_(file, retry) {
    const params = new URLSearchParams();
    params.set('v', getAssetVersion_());
    if (retry) {
      params.set('retry', String(retry));
      params.set('t', String(Date.now()));
    }
    return `${BASE}${file}?${params.toString()}`;
  }

  // 依存順を守るため、1ファイルずつ読み込む。
  function loadSeq_(files, i, done) {
    if (!Array.isArray(files) || i >= files.length) {
      if (typeof done === 'function') done();
      return;
    }

    const file = String(files[i] || '').trim();
    if (!file) {
      loadSeq_(files, i + 1, done);
      return;
    }

    loadScript_(file, 0, () => loadSeq_(files, i + 1, done));
  }

  function loadScript_(file, retry, done) {
    const s = document.createElement('script');
    s.src = buildScriptUrl_(file, retry);
    s.async = false;

    window.debugLog?.('deckmaker JS読込前', file);

    s.onload = () => {
      window.debugLog?.('deckmaker JS読込成功', file);
      done();
    };

    s.onerror = () => {
      window.debugLog?.('deckmaker JS読込失敗', s.src);
      if (retry < 1) {
        loadScript_(file, retry + 1, done);
        return;
      }

      console.error('[deckmaker-page-loader] failed:', s.src);
      alert('ページの初期化に失敗しました（JSロード失敗）\n' + s.src);
    };

    document.head.appendChild(s);
  }

  const queue_ = [];

  window.onDeckmakerReady = window.onDeckmakerReady || function onDeckmakerReady(fn) {
    if (window.__deckmakerReadyFired) {
      try {
        fn && fn();
      } catch (e) {
        console.error(e);
      }
      return;
    }
    queue_.push(fn);
  };

  function fireReady_() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fireReady_, { once: true });
      return;
    }

    if (window.__deckmakerReadyFired) return;
    window.__deckmakerReadyFired = true;

    while (queue_.length) {
      const fn = queue_.shift();
      try {
        fn && fn();
      } catch (e) {
        console.error(e);
      }
    }

    window.dispatchEvent(new Event('deckmaker-page:ready'));
  }

  loadSeq_(FILES, 0, fireReady_);
})();
