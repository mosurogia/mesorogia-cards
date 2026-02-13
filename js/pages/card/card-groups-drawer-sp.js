/**
 * js/pages/card/card-groups-drawer-sp.js
 * - SP：カードグループをドロワー表示（PCサイドバーDOMを移動して流用）
 * - 追加:
 *   - 編集中のみ「✅ 選択完了」フローティングを表示（ドロワーを開かずに終了できる）
 *   - 「選択したら自動で閉じる」トグル（デフォルトOFF / localStorage保存）
 *   - 外部から呼べるAPI: window.__SpGroupDrawer
 */
(function(){
'use strict';

const LS_AUTO_CLOSE = 'cg_sp_autoClose_v1';

const openBtn = document.getElementById('sp-group-open');
const closeBtn = document.getElementById('sp-group-close');
const drawer  = document.getElementById('sp-group-drawer');
const back    = document.getElementById('sp-group-backdrop');
const body    = document.getElementById('sp-group-drawer-body');

// ★ PCサイドバー側の “グループブロック” ルート
const pcRoot  = document.getElementById('cards-groups-block');

if(!openBtn || !closeBtn || !drawer || !back || !body || !pcRoot) return;

let lastParent = null;
let lastNext = null;

const mq = window.matchMedia('(max-width: 900px)');
function isSP(){ return mq.matches; }

function lockScroll(){
    document.documentElement.style.overflow = 'hidden';
}
function unlockScroll(){
    document.documentElement.style.overflow = '';
}

function moveToDrawer(){
    if (pcRoot.parentNode === body) return;
    lastParent = pcRoot.parentNode;
    lastNext = pcRoot.nextSibling;
    body.appendChild(pcRoot);
}
function moveBack(){
    if (!lastParent) return;
    if (pcRoot.parentNode === lastParent) return;
    if (lastNext && lastNext.parentNode === lastParent) lastParent.insertBefore(pcRoot, lastNext);
    else lastParent.appendChild(pcRoot);
}

// =====================================================
// 追加UI: (1) 自動で閉じるトグル (2) 編集完了フローティング
// =====================================================
function getAutoClose_(){
    try { return localStorage.getItem(LS_AUTO_CLOSE) === '1'; } catch { return false; }
}
function setAutoClose_(on){
    try { localStorage.setItem(LS_AUTO_CLOSE, on ? '1' : '0'); } catch {}
}

function ensureAutoCloseToggle_(){
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

    cb.addEventListener('change', () => setAutoClose_(cb.checked));

    wrap.appendChild(cb);
    wrap.appendChild(txt);

    // 右側（×ボタン）より左に差し込む
    head.insertBefore(wrap, closeBtn);
    return wrap;
}

function ensureDoneFab_(){
    let btn = document.getElementById('sp-group-done-fab');
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = 'sp-group-done-fab';
    btn.type = 'button';
    btn.className = 'floating-btn floating-btn--done';
    btn.innerHTML = `<span class="shot-btn-ico">✅</span><span class="shot-btn-txt">完了</span>`;
    btn.addEventListener('click', () => {
    try {
        const st = window.CardGroups?.getState?.();
        const editingId = st?.editingId || '';
        const targetId = editingId || st?.activeId || ''; // 適用中を優先

        if (editingId) {
        // ✅ 編集中なら完了
        window.CardGroups?.stopEditing?.();
        // 完了後は一覧を見たいので閉じる（好み）
        try { if (isOpen_()) close_(); } catch {}
        } else {
        // ✅ 編集してないなら編集開始（適用中がないなら何もしない）
        if (!targetId) return;
        window.CardGroups?.startEditing?.(targetId);
        // 編集開始時は閉じない（編集したいので）
        }
    } catch {}
    });

    document.body.appendChild(btn);
    return btn;
}

function syncDoneFab_(){
    const btn = ensureDoneFab_();
    const st = window.CardGroups?.getState?.();
    const editingId = st?.editingId || '';
    const activeId  = st?.activeId || '';
    // SP & 編集中または適用中のみ表示
    const show = isSP() && (!!editingId || !!activeId);
    btn.style.display = show ? '' : 'none';
    // ✅ ラベル切替
    const ico = btn.querySelector('.shot-btn-ico');
    const txt = btn.querySelector('.shot-btn-txt');
    if (ico && txt) {
        if (editingId) { ico.textContent = '✅'; txt.textContent = '選択完了'; }
        else { ico.textContent = '✏️'; txt.textContent = 'グループ編集'; }
    }
}

// =====================================================
// Open / Close
// =====================================================
function open_(){
    if (!isSP()) return;
    moveToDrawer();
    ensureAutoCloseToggle_();
    drawer.hidden = false;
    back.hidden = false;
    openBtn.style.visibility = 'hidden';
    lockScroll();
    syncDoneFab_();
}

function close_(){
    drawer.hidden = true;
    back.hidden = true;
    openBtn.style.visibility = '';
    unlockScroll();
    syncDoneFab_();
}

function isOpen_(){
    return !drawer.hidden && !back.hidden;
}

let closeTimer = null;
function requestClose_(delayMs){
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

function onGroupSelected_(){
    // “誤タップストレス” 対策：デフォルトは自動で閉じない（ユーザーがONにした時だけ）
    if (!getAutoClose_()) return;
    try {
    const st = window.CardGroups?.getState?.();
    if (!st?.activeId) return;
    } catch {}
    requestClose_(260);
}

// クリックで開閉
openBtn.addEventListener('click', open_);
closeBtn.addEventListener('click', close_);
back.addEventListener('click', close_);

// ✅ cg-op-edit（編集開始）を押したら、トグル設定に関係なくドロワーを閉じる
//    ※「編集開始したらカード一覧を見たい」ため
drawer.addEventListener('click', (e) => {
  if (!isSP()) return;
  if (!isOpen_()) return;

  const btn = e.target.closest('#cg-op-edit');
  if (!btn) return;

  // disabled中は閉じない（誤操作防止）
  if (btn.disabled) return;

  // card-groups-ui.js 側の startEditing が先に動くように一拍置く
  setTimeout(() => {
    try { close_(); } catch {}
  }, 0);
}, { capture: true });


// SP→PCに戻ったらDOMを戻す
window.addEventListener('resize', () => {
    if (!isSP()){
    close_();
    moveBack();
    }
    syncDoneFab_();
});

// CardGroups状態変化でFAB表示を同期
function hookCardGroups_(){
    try {
    window.CardGroups?.onChange?.(() => syncDoneFab_());
    } catch {}
    syncDoneFab_();
}

// ✅ タブ復帰や画面復帰で display が残る事故を防ぐ
document.addEventListener('visibilitychange', () => {
  try { syncDoneFab_(); } catch {}
});
window.addEventListener('pageshow', () => {
  try { syncDoneFab_(); } catch {}
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookCardGroups_, { once: true });
} else {
    hookCardGroups_();
}
window.addEventListener('card-page:ready', hookCardGroups_);

// 外部公開API（card-groups-ui.js から呼ぶ）
window.__SpGroupDrawer = window.__SpGroupDrawer || {};
window.__SpGroupDrawer.open = open_;
window.__SpGroupDrawer.close = close_;
window.__SpGroupDrawer.isOpen = isOpen_;
window.__SpGroupDrawer.onGroupSelected = onGroupSelected_;
window.__SpGroupDrawer.getAutoClose = getAutoClose_;

})();
