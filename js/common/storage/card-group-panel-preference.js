/**
 * PCカードグループの開閉設定専用の保存口。
 * cardGroupsV1とアカウント同期には含めない端末固有の設定。
 */
(function () {
  'use strict';
  const KEY = 'cards_pc_group_collapsed';

  /** 保存値を真偽値へ正規化する純粋処理。未設定・不正値は既定値を返す。 */
  function parseCollapsed(value, fallback = false) {
    return value === 'true' ? true : value === 'false' ? false : fallback;
  }

  /** 保存が許可されない環境でもパネルの操作を継続できる。 */
  function read(fallback) {
    try { return parseCollapsed(localStorage.getItem(KEY), fallback); }
    catch (_) { return fallback; }
  }

  /** PCの操作時だけ呼び出し、スマホのドロワー状態とは分離する。 */
  function save(collapsed) {
    try { localStorage.setItem(KEY, String(!!collapsed)); } catch (_) {}
  }
  window.CardGroupPanelPreference = { parseCollapsed, read, save };
})();

