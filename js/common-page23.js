
  // ==========================
  // 共通UI操作
  // ==========================
  //#region
// タブ切替を“同じグループ内”に限定する安全版
window.switchTab = function switchTab(targetId, el) {
  const tabBar = el && typeof el.closest === 'function' ? el.closest('.tab-bar') : null;

  // フォールバック（念のため）：tabBarが取れない場合は最小限の切替だけ行う
  if (!tabBar) {
    document.querySelectorAll('.tab-content.active').forEach(n => n.classList.remove('active'));
    const t = document.getElementById(targetId);
    if (t) t.classList.add('active');
    afterTabSwitched(targetId);
    return;
  }

  // 1) “入れ子タブ”想定：タブバー直後の .tab-contents-group をグループとみなす
  const next = tabBar.nextElementSibling;
  let contents = [];

  if (next && next.classList && next.classList.contains('tab-contents-group')) {
    // 例：info-tab / post-tab のコンテナ
    contents = Array.from(next.querySelectorAll(':scope > .tab-content'));
  } else {
    // 2) 上段タブ（build / edit など）：タブバー直後から連続する兄弟 .tab-content のみ対象
    let cur = tabBar.nextElementSibling;
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
  afterTabSwitched(targetId);
};

// ここから新規：タブ切替“後”の再描画フック
function afterTabSwitched(targetId) {
  // 上段の「デッキ分析」タブに入ったら、リストと数値・グラフを毎回再生成
  if (targetId === 'edit') {
    if (typeof renderDeckList === 'function') renderDeckList();       // #deck-card-list 再構築
    if (typeof updateDeckAnalysis === 'function') updateDeckAnalysis();// グラフ/内訳再計算
    if (typeof updateExchangeSummary === 'function') updateExchangeSummary(); // 不足/ポイント再計算
    if (typeof autoscaleAllBadges === 'function')
      requestAnimationFrame(autoscaleAllBadges);                      // バッジサイズ再調整
  }

  // 上段の「デッキ構築」へ戻った場合も、表示を最新にそろえておくと安心
  if (targetId === 'build') {
    if (typeof refreshOwnedOverlay === 'function') refreshOwnedOverlay();
    if (typeof applyGrayscaleFilter === 'function') applyGrayscaleFilter();
  }

  // 入れ子サブタブ（info-tab / post-tab）に切り替えた時は、数値の揺れ防止で軽く同期
  if (targetId === 'info-tab') {
    if (typeof updateDeckSummaryDisplay === 'function') updateDeckSummaryDisplay();
    if (typeof updateExchangeSummary === 'function') updateExchangeSummary();
  }
}



  //#endregion