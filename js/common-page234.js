
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
    // 2) 上段タブ（build/edit）
    // tab-bar直後にバナー等が挟まってもOKにする：最初の .tab-content までスキップ
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
  afterTabSwitched(targetId);
};

window.afterTabSwitched = function afterTabSwitched(targetId) {

  // --- cards/checker タブ用（今回追加）---
  if (targetId === 'cards' || targetId === 'checker') {
    // 切り替えたら上に戻す（好みで消してOK）
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }


  // 上段の「デッキ分析」タブに入ったら再描画
if (targetId === 'edit') {
  if (typeof updateDeckAnalysis === 'function') updateDeckAnalysis();
  if (typeof updateExchangeSummary === 'function') updateExchangeSummary();
  // 上にスクロール
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

  // 構築タブに戻った場合
  if (targetId === 'build') {
    if (typeof refreshOwnedOverlay === 'function') refreshOwnedOverlay();
    if (typeof applyGrayscaleFilter === 'function') applyGrayscaleFilter();
  }

  // info/post サブタブ共通
  if (targetId === 'info-tab') {
    if (typeof updateDeckSummaryDisplay === 'function') updateDeckSummaryDisplay();
    if (typeof updateExchangeSummary === 'function') updateExchangeSummary();
  }

  if (targetId === 'info-tab' || targetId === 'post-tab') {
    if (typeof window.syncDeckNameFields === 'function') window.syncDeckNameFields();
  }

  // ✅ どのタブに移動してもデッキリストの×Nバッジを同期
  if (typeof renderDeckList === 'function' && document.getElementById('deck-card-list')) {
    renderDeckList();
    if (typeof autoscaleAllBadges === 'function') {
      requestAnimationFrame(autoscaleAllBadges);
    }
  }


    // （任意）他箇所連動用のイベントも飛ばす
  document.dispatchEvent(new Event('deckTabSwitched'));

  // --- デッキ投稿ページ用のタブ処理 ---
  // deck-post.html の上段タブ
  if (targetId === 'tab-post-list' || targetId === 'tab-compare') {
    // 切り替えたら画面上部へ
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

};



  //#endregion