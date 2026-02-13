/**
 * js/pages/card/card-page-loader.js
 * - cardページ専用ローダー：js/pages/card 配下を「依存順」で順番読み込み
 * - HTML は「共通（common/ui/features）」＋「このローダー1本」だけ置けばOK
 *
 * 読み込み順ルール:
 * 1) 一覧（card-list）→ 2) 表示切替（view mode）
 * 3) checker（owned ops → page wiring → render）
 * 読み込み完了後に window イベント 'card-page:ready' を dispatch する
 */

/**
 * js/pages/card/card-page-loader.js
 * - 初回：カード一覧に必要なものだけ
 * - checker は「#checker で開いた」or「タブ切替」時に遅延ロード（1回だけ）
 */
(function () {
  'use strict';

  const BASE = 'js/pages/card/';

  const BASE_FILES = [
    'card-list.js',
    'cardsViewMode.js',
    'card-groups-ui.js',
    'card-groups-drawer-sp.js',
  ];

  const CHECKER_FILES = [
    'card-checker-owned-ops.js',
    'card-checker-render.js',
    'card-checker-page.js',
  ];

  function loadSeq(files, i, done){
    if (i >= files.length) return done && done();
    const s = document.createElement('script');
    s.src = BASE + files[i];
    s.async = false;
    s.onload = () => loadSeq(files, i + 1, done);
    s.onerror = () => console.error('[card-page-loader] failed:', s.src);
    document.head.appendChild(s);
  }

    // ---- 外部/追加CSS 遅延ロード（1回だけ）----
  let __chartLoaded = false;
  let __page3CssLoaded = false;

  function loadScript_(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed: ' + src));
      document.head.appendChild(s);
    });
  }

  async function ensureChartJs_(){
    if (__chartLoaded) return;
    __chartLoaded = true;
    await loadScript_('https://cdn.jsdelivr.net/npm/chart.js');
    await loadScript_('https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels');
  }


  // ---- checker 遅延ロード（1回だけ）----
  let checkerLoaded = false;
  window.__ensureCheckerLoaded = function __ensureCheckerLoaded(){
    if (checkerLoaded) return;
    checkerLoaded = true;
    loadSeq(CHECKER_FILES, 0, () => {
      // checker 側 init は各ファイルの DOMContentLoaded / card-page:ready で走る想定
      // 必要ならここでイベントを投げてもOK
      window.dispatchEvent(new Event('card-checker:loaded'));
    });
  };

  // 1) まずベースだけ
  loadSeq(BASE_FILES, 0, () => {
    fireReady_();

    // 2) hash が checker 系なら、すぐ checker も読み込む
    const h = location.hash || '';
    const needChecker =
      h === '#checker' ||
      h.startsWith('#pack-') ||
      h.startsWith('#race-') ||
      h === '#packs-root';

    if (needChecker) window.__ensureCheckerLoaded();
  });

  // 3) switchTab をフックして checker タブで遅延ロード
  const hook = () => {
    const orig = window.switchTab;
    if (typeof orig !== 'function') return;

    window.switchTab = function(tabId, el){
      if (tabId === 'checker') {
        ensureChartJs_().catch(console.error); // ← Chart遅延ロード
        window.__ensureCheckerLoaded(); // ← checker系JSロード
      }
      return orig(tabId, el);
    };
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hook, { once: true });
  } else {
    hook();
  }
})();


function fireReady_(){
  // DOMがまだなら待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fireReady_, { once: true });
    return;
  }
  // ✅ “後から読み込まれたJS”でも拾える合図
  window.dispatchEvent(new Event('card-page:ready'));
}

/* =====================================================
 * hash(#checker / #pack-xxx) に応じてタブを自動切替
 * - cards.html#checker
 * - cards.html#pack-awaking-the-oracle 等
 * ===================================================== */
(function () {
  'use strict';

  function handleHashJump_() {
    const hash = location.hash || '';
    if (!hash) return;

    const needChecker =
      hash === '#checker' ||
      hash.startsWith('#pack-') ||
      hash.startsWith('#race-') ||
      hash === '#packs-root';

    if (!needChecker) return;

    const tab2 = document.getElementById('tab2');

    // checkerタブへ切替
    if (typeof window.switchTab === 'function' && tab2) {
      window.switchTab('checker', tab2);
    } else {
      // フォールバック（最低限）
      document.getElementById('cards')?.classList.remove('active');
      document.getElementById('checker')?.classList.add('active');
      tab2?.classList.add('active');
      document.getElementById('tab1')?.classList.remove('active');
    }

    // 描画反映後にスクロール
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target =
          document.getElementById(hash.slice(1)) ||
          document.querySelector(hash);
        if (target) {
          target.scrollIntoView({ block: 'start' });
        }
      });
    });
  }

  // 初回ロード：card-page が全部準備できてから
  window.addEventListener('card-page:ready', handleHashJump_);

  // hash変更（Xリンクを踏んだ直後など）
  window.addEventListener('hashchange', handleHashJump_);
})();
