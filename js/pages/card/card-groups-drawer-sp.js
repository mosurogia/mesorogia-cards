// js/pages/card/card-groups-drawer-sp.js
/**
 * Card / Groups Drawer (SP)
 *
 * 【役割】
 * - SP（max-width:900px）時にカードグループUIをドロワーで表示する
 * - PCサイドバーのDOM（#cards-groups-block）を移動して流用する
 *
 * 【追加機能】
 * - 編集中/適用中のみ「✅ 選択完了（or ✏️ グループ編集）」フローティングボタンを表示
 * - 「適用後に閉じる」トグル（デフォルトOFF / localStorage保存）
 *
 * 【依存（存在すれば使う）】
 * - DOM:
 *   - #sp-group-open / #sp-group-close / #sp-group-drawer / #sp-group-backdrop / #sp-group-drawer-body
 *   - #cards-groups-block（PC側ルート）
 * - window.CardGroups:
 *   - getState() -> { editingId, activeId }
 *   - startEditing(id) / stopEditing()
 *   - onChange(fn)
 *
 * 【公開（外部API）】
 * - window.__SpGroupDrawer:
 *   - open() / close() / isOpen()
 *   - onGroupSelected()
 *   - getAutoClose()
 */
(function () {
  'use strict';

  // =========================
  // 0) 定数・DOM参照・前提チェック
  // =========================

  const LS_AUTO_CLOSE = 'cg_sp_autoClose_v1';

  const openBtn = document.getElementById('sp-group-open');
  const closeBtn = document.getElementById('sp-group-close');
  const drawer = document.getElementById('sp-group-drawer');
  const back = document.getElementById('sp-group-backdrop');
  const body = document.getElementById('sp-group-drawer-body');

  // PCサイドバー側の “グループブロック” ルート（これを移動して流用）
  const pcRoot = document.getElementById('cards-groups-block');

  // 必須DOMが無ければ何もしない（安全停止）
  if (!openBtn || !closeBtn || !drawer || !back || !body || !pcRoot) return;

  // PC側へ戻すための「元の親・元の次要素」
  let lastParent = null;
  let lastNext = null;

  // SP判定（CSSのブレークポイントと一致させる）
  const mq = window.matchMedia('(max-width: 900px)');

  // =========================
  // 1) 小ユーティリティ（SP判定 / スクロールロック / DOM移動）
  // =========================

  // 現在SP表示かどうか
  function isSP() {
    return mq.matches;
  }

  // ドロワー表示中のスクロール固定
  function lockScroll_() {
    document.documentElement.style.overflow = 'hidden';
  }

  // スクロール固定解除
  function unlockScroll_() {
    document.documentElement.style.overflow = '';
  }

  // PC側DOMをドロワーへ移動する（同じDOMを流用する）
  function moveToDrawer_() {
    if (pcRoot.parentNode === body) return;
    lastParent = pcRoot.parentNode;
    lastNext = pcRoot.nextSibling;
    body.appendChild(pcRoot);
  }

  // ドロワーからPC側へDOMを戻す（元の位置が保てればそこへ戻す）
  function moveBack_() {
    if (!lastParent) return;
    if (pcRoot.parentNode === lastParent) return;

    if (lastNext && lastNext.parentNode === lastParent) lastParent.insertBefore(pcRoot, lastNext);
    else lastParent.appendChild(pcRoot);
  }

  // =========================
  // 2) 追加UI：自動クローズトグル / 編集完了FAB
  // =========================

  // 「適用後に閉じる」設定を取得する（localStorage）
  function getAutoClose_() {
    try {
      return localStorage.getItem(LS_AUTO_CLOSE) === '1';
    } catch {
      return false;
    }
  }

  // 「適用後に閉じる」設定を保存する（localStorage）
  function setAutoClose_(on) {
    try {
      localStorage.setItem(LS_AUTO_CLOSE, on ? '1' : '0');
    } catch {}
  }

  // ドロワーヘッダーに「適用後に閉じる」トグルを挿入する（無ければ生成）
  function ensureAutoCloseToggle_() {
    const head = drawer.querySelector('.sp-group-drawer-head');
    if (!head) return null;

    let wrap = head.querySelector('#sp-group-auto-close-wrap');
    if (wrap) return wrap;

    wrap = document.createElement('label');
    wrap.id = 'sp-group-auto-close-wrap';
    wrap.className = 'sp-group-auto-close';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'sp-group-auto-close';
    cb.checked = getAutoClose_();

    const txt = document.createElement('span');
    txt.className = 'sp-group-auto-close-txt';
    txt.textContent = '適用後に閉じる';

    // 設定変更を永続化
    cb.addEventListener('change', () => setAutoClose_(cb.checked));

    wrap.appendChild(cb);
    wrap.appendChild(txt);

    // 右側（×ボタン closeBtn）より左に差し込む
    head.insertBefore(wrap, closeBtn);
    return wrap;
  }

  // 編集/適用状態に応じて表示するフローティングボタンを生成（無ければ生成）
  function ensureDoneFab_() {
    let btn = document.getElementById('sp-group-done-fab');
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = 'sp-group-done-fab';
    btn.type = 'button';
    btn.className = 'floating-btn floating-btn--done';
    btn.innerHTML =
      `<span class="shot-btn-ico">✅</span><span class="shot-btn-txt">完了</span>`;

    // FABクリック：編集中なら完了、未編集なら編集開始（適用中がある時だけ）
    btn.addEventListener('click', () => {
      try {
        const st = window.CardGroups?.getState?.();
        const editingId = st?.editingId || '';
        const targetId = editingId || st?.activeId || ''; // 適用中を優先

        if (editingId) {
          // --- 編集中なら「選択完了」 ---
          window.CardGroups?.stopEditing?.();

          // 好み：完了後は閉じる（一覧を見たい想定）
          try {
            if (isOpen_()) close_();
          } catch {}
        } else {
          // --- 未編集なら編集開始（対象が無いなら何もしない） ---
          if (!targetId) return;
          window.CardGroups?.startEditing?.(targetId);

          // 編集開始時は閉じない（編集操作を継続したいため）
        }
      } catch {}
    });

    document.body.appendChild(btn);
    return btn;
  }

  // FABの表示・ラベルを CardGroups 状態に同期する
  function syncDoneFab_() {
    const btn = ensureDoneFab_();

    const st = window.CardGroups?.getState?.();
    const editingId = st?.editingId || '';
    const activeId = st?.activeId || '';

    // SP &（編集中 or 適用中）だけ表示
    const show = isSP() && (!!editingId || !!activeId);
    btn.style.display = show ? '' : 'none';

    // ラベル切替：編集中なら「✅ 選択完了」、それ以外は「✏️ グループ編集」
    const ico = btn.querySelector('.shot-btn-ico');
    const txt = btn.querySelector('.shot-btn-txt');
    if (ico && txt) {
      if (editingId) {
        ico.textContent = '✅';
        txt.textContent = '選択完了';
      } else {
        ico.textContent = '✏️';
        txt.textContent = 'グループ編集';
      }
    }
  }

  // =========================
  // 3) ドロワー開閉（Open / Close / isOpen）
  // =========================

  // ドロワーを開く（SPのときだけ）
  function open_() {
    if (!isSP()) return;

    // --- 1) DOMをドロワーへ移動 ---
    moveToDrawer_();

    // --- 2) 追加UIを準備 ---
    ensureAutoCloseToggle_();

    // --- 3) 表示・スクロール固定 ---
    drawer.hidden = false;
    back.hidden = false;
    openBtn.style.visibility = 'hidden';
    lockScroll_();

    // --- 4) FAB表示同期 ---
    syncDoneFab_();
  }

  // ドロワーを閉じる（DOMは戻さない：SP→PC切替時に戻す）
  function close_() {
    drawer.hidden = true;
    back.hidden = true;
    openBtn.style.visibility = '';
    unlockScroll_();
    syncDoneFab_();
  }

  // ドロワーが開いているか
  function isOpen_() {
    return !drawer.hidden && !back.hidden;
  }

  // =========================
  // 4) 自動クローズ制御（選択後に閉じる）
  // =========================

  let closeTimer = null;

  // 指定ms後に閉じる（連打時はタイマーをまとめる）
  function requestClose_(delayMs) {
    if (!isSP()) return;
    if (!isOpen_()) return;

    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }

    const ms = Math.max(0, delayMs | 0);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      close_();
    }, ms);
  }

  // 外部から呼ばれる：グループ選択が確定したら（設定ONなら）閉じる
  function onGroupSelected_() {
    // 誤タップストレス対策：デフォルトは閉じない。ユーザーがONにした時だけ閉じる。
    if (!getAutoClose_()) return;

    // 念のため：適用先が確定している時だけ閉じる
    try {
      const st = window.CardGroups?.getState?.();
      if (!st?.activeId) return;
    } catch {}

    requestClose_(260);
  }

  // =========================
  // 5) イベント結線（クリック / リサイズ / 可視状態）
  // =========================

  // クリックで開閉
  openBtn.addEventListener('click', open_);
  closeBtn.addEventListener('click', close_);
  back.addEventListener('click', close_);

  // cg-op-edit（編集開始）を押したらトグル設定に関係なく閉じる
  // ※「編集開始したらカード一覧を見たい」ため
  drawer.addEventListener(
    'click',
    (e) => {
      if (!isSP()) return;
      if (!isOpen_()) return;

      const btn = e.target.closest('#cg-op-edit');
      if (!btn) return;

      // disabled中は閉じない（誤操作防止）
      if (btn.disabled) return;

      // card-groups-ui.js 側の startEditing が先に動くように一拍置く
      setTimeout(() => {
        try {
          close_();
        } catch {}
      }, 0);
    },
    { capture: true }
  );

  // SP→PCに戻ったら：閉じてDOMをPC側へ戻す
  window.addEventListener('resize', () => {
    if (!isSP()) {
      close_();
      moveBack_();
    }
    syncDoneFab_();
  });

  // タブ復帰や画面復帰で display が残る事故を防ぐ
  document.addEventListener('visibilitychange', () => {
    try {
      syncDoneFab_();
    } catch {}
  });
  window.addEventListener('pageshow', () => {
    try {
      syncDoneFab_();
    } catch {}
  });

  // =========================
  // 6) CardGroups 連携（状態変化でFAB同期）
  // =========================

  // CardGroupsの状態変化に追従してFAB表示を同期する
  function hookCardGroups_() {
    try {
      window.CardGroups?.onChange?.(() => syncDoneFab_());
    } catch {}

    // 初回同期
    syncDoneFab_();
  }

  // DOMReady後に接続（card-page:readyもケア）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookCardGroups_, { once: true });
  } else {
    hookCardGroups_();
  }
  window.addEventListener('card-page:ready', hookCardGroups_);

  // =========================
  // 7) 外部公開API（card-groups-ui.js から呼ぶ）
  // =========================

  window.__SpGroupDrawer = window.__SpGroupDrawer || {};
  window.__SpGroupDrawer.open = open_;
  window.__SpGroupDrawer.close = close_;
  window.__SpGroupDrawer.isOpen = isOpen_;
  window.__SpGroupDrawer.onGroupSelected = onGroupSelected_;
  window.__SpGroupDrawer.getAutoClose = getAutoClose_;
})();