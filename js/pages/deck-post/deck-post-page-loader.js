/**
 * js/pages/deck-post/deck-post-page-loader.js
 * - deck-postページ専用ローダー：ページ専用JSを「依存順」で直列ロード
 * - HTML は「共通（common/dom/logic/external）」＋「このローダー1本」だけ置けばOK
 *
 * ✅ 重要：
 * loader で後から読み込まれたJSは DOMContentLoaded を取り逃がすことがあるため、
 * 読み込み完了後に ready 合図を dispatch し、各JSはそれを起点に初期化する。
 * （deckmaker 系と同じ思想）
 */
(function () {
  'use strict';

  // =========================
  // 0) 設定
  // =========================
  const BASE = 'js/pages/deck-post/';

  // ローダー段階の失敗もスマホ実機で見えるようにする。
  window.debugLog = window.debugLog || function debugLog(...args) {
    const el = document.getElementById('debug-log') || (() => {
      const d = document.createElement('div');
      d.id = 'debug-log';
      d.style = [
        'position:fixed',
        'bottom:0',
        'left:0',
        'right:0',
        'max-height:40%',
        'overflow:auto',
        'background:#000',
        'color:#0f0',
        'font-size:11px',
        'z-index:99999',
      ].join(';');
      document.body.appendChild(d);
      return d;
    })();

    el.insertAdjacentHTML(
      'beforeend',
      `<div>${args.map((a) => {
        try {
          return JSON.stringify(a);
        } catch (_) {
          return String(a);
        }
      }).join(' ')}</div>`
    );
  };

  function getAssetVersion_() {
    return String(window.MESOROGIA_PWA_CACHE_CONFIG?.version || 'dev').trim() || 'dev';
  }

  /**
   * ✅ ロードするファイル（依存順）
   * - いまは「移植JSは後から」なので、コメントだけにしてあります
   * - 追加する時はコメントを外し、依存順に並べてください
   *
   * 推奨順（現在構成ベース）：
   * loader → state → api → list → filter → detail → editor → utils → campaign → export → modals
   */
  const BASE_FILES = [
    'deck-post-state.js',
    'deck-post-api.js',
    'deck-post-list.js',
    'deck-post-filter.js',
    'deck-post-detail.js',
    'deck-post-editor.js',
    'deck-post-utils.js',
    'deck-post-campaign.js',
    'deck-post-export.js',
    'deck-post-modals.js',
    'deck-post-entry.js',
  ];

  // =========================
  // 1) 直列ロード
  // =========================
  /**
   * loadSeq_(files, i, done)
   * - async=false で「依存順」を守って順番に読み込む
   */
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

    const s = document.createElement('script');
    s.src = `${BASE}${file}?v=${encodeURIComponent(getAssetVersion_())}`;
    s.async = false;

    window.debugLog?.('loader JS読込前', file);

    s.onload = () => {
      window.debugLog?.('loader JS読込成功', file);
      loadSeq_(files, i + 1, done);
    };
    s.onerror = () => {
      window.debugLog?.('loader JS読込失敗', s.src);
      console.error('[deck-post-page-loader] failed:', s.src);
      alert('ページの初期化に失敗しました（JSロード失敗）\n' + s.src);
    };

    document.head.appendChild(s);
  }

  // =========================
  // 2) ready 合図（後から読み込まれたJSでも拾える）
  // =========================
  const queue_ = [];

  /**
   * window.onDeckPostReady(fn)
   * - ready済みなら即実行
   * - 未readyならキューに積む
   */
  window.onDeckPostReady =
    window.onDeckPostReady ||
    function onDeckPostReady(fn) {
      if (window.__deckPostPageReadyFired) {
        try {
          fn && fn();
        } catch (e) {
          console.error(e);
        }
        return;
      }
      queue_.push(fn);
    };

  /**
   * fireReady_()
   * - DOMがまだなら DOMReady 後に実行
   * - キューを先に消化 → 最後にイベントを投げる
   */
  function fireReady_() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fireReady_, { once: true });
      return;
    }

    if (window.__deckPostPageReadyFired) return;
    window.__deckPostPageReadyFired = true;

    while (queue_.length) {
      const fn = queue_.shift();
      try {
        fn && fn();
      } catch (e) {
        console.error(e);
      }
    }

    // ✅ 推奨イベント名：他ページに合わせて "-page:ready"
    window.dispatchEvent(new Event('deck-post-page:ready'));

    // ✅ 互換：古い想定イベント名が残っていても落ちない
    window.dispatchEvent(new Event('deckpost:ready'));
  }

  // =========================
  // 3) 実行
  // =========================
  loadSeq_(BASE_FILES, 0, fireReady_);
})();
