/* =========================
 * js/common/ui/tabs.js
 * - タブ切替（同一グループ内だけ）
 * - 切替後は CustomEvent を投げるだけ（ページ依存処理は pages 側）
 * ========================= */
(function () {
  'use strict';

  function switchTab(targetId, el) {
    const tabBar = el && typeof el.closest === 'function' ? el.closest('.tab-bar') : null;

    // フォールバック：tabBarが取れない場合は「対象だけ表示」に寄せる（全体剥がしはやめる）
    if (!tabBar) {
      const t = document.getElementById(targetId);
      if (t) t.classList.add('active');
      document.dispatchEvent(new CustomEvent('tab:switched', { detail: { targetId, el: el || null, tabBar: null } }));

      try { window.afterTabSwitched?.(targetId); } catch (e) { console.error(e); }
      return;
    }

    // 1) 入れ子タブ対応：tabBar直後が .tab-contents-group ならその直下だけ
    const next = tabBar.nextElementSibling;
    let contents = [];

    if (next && next.classList && next.classList.contains('tab-contents-group')) {
      contents = Array.from(next.querySelectorAll(':scope > .tab-content'));
    } else {
      // 2) 上段タブ：tabBarの次から .tab-content が連続する範囲
      let cur = tabBar.nextElementSibling;
      while (cur && !(cur.classList && cur.classList.contains('tab-content'))) {
        cur = cur.nextElementSibling;
      }
      while (cur && cur.classList && cur.classList.contains('tab-content')) {
        contents.push(cur);
        cur = cur.nextElementSibling;
      }
    }

    // 3) 同一グループ内だけ active を張り替え
    tabBar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (el && el.classList) el.classList.add('active');
    contents.forEach(c => c.classList.remove('active'));

    // 4) 対象IDを表示（※他グループは触らない）
    const target = document.getElementById(targetId);
    if (target) target.classList.add('active');

    // 5) ページ側に通知
    document.dispatchEvent(new CustomEvent('tab:switched', { detail: { targetId, el: el || null, tabBar } }));

    // 6) ページ側の後処理呼び出し（あれば）
    try { window.afterTabSwitched?.(targetId); } catch (e) { console.error(e); }
  }

  // 互換：window直下に生やす（既存HTML onclick でも動く）
  window.switchTab = switchTab;
})();
