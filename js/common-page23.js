
  // ==========================
  // 共通UI操作
  // ==========================
  //#region
  // タブ切り替え処理
function switchTab(id, clickedTab) {
  // 現在のタブグループを特定
  const tabGroup = clickedTab.closest('.tab-bar');
  const contentGroup = tabGroup.nextElementSibling?.classList.contains('tab-contents-group')
    ? tabGroup.nextElementSibling
    : document; // fallback: 全体対象

  // ★ 追加：切替前フック
  if (typeof window.beforeTabSwitch === 'function') {
    const current = contentGroup.querySelector('.tab-content.active');
    const fromId = current?.id || null;
    if (fromId && fromId !== id) {
      try { window.beforeTabSwitch(fromId, id); } catch {}
    }
  }

  // タブグループ内のタブボタンから active を外す
  tabGroup.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  clickedTab.classList.add('active');

  // 対応するコンテンツだけ表示（他は非表示）
  contentGroup.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const target = contentGroup.querySelector(`#${id}`) || document.getElementById(id);
  if (target) target.classList.add('active');

  // 特定タブの追加処理
  if (id === "edit") {
//同時起動コード
  renderDeckList();  // デッキに含まれるカード画像を一覧表示
  updateDeckAnalysis();  // 分析グラフやレアリティ比率などを更新
  updateExchangeSummary();  // ポイント等のサマリーを更新（未実装の場合はここで呼び出し）
  }
}





  //#endregion