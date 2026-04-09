/* =========================
 * js/common/card/card-preview.js
 * - カード画像プレビュー（共通）
 * - 公開：window.CardPreview / window.showCardPreviewAt / window.hideCardPreview（互換）
 * ========================= */
(function(){
  'use strict';

  const PREVIEW_W = 200;
  const PREVIEW_H = 280;
  const PREVIEW_PAD = 12;
  const FALLBACK_IMG = 'img/00000.webp';

  function normCd5(cd){
    return String(cd ?? '').trim().padStart(5,'0').slice(0,5);
  }

  function imgSrcOf(cd){
    const cd5 = normCd5(cd);
    return cd5 ? `img/${cd5}.webp` : FALLBACK_IMG;
  }

  function ensureLayer(){
    let el = document.getElementById('card-preview-pop');
    if (!el){
      el = document.createElement('div');
      el.id = 'card-preview-pop';
      el.innerHTML = `<img loading="eager" decoding="async"
        style="max-width:${PREVIEW_W}px;border-radius:6px;box-shadow:0 0 8px rgba(0,0,0,.5);" />`;
      document.body.appendChild(el);
    }

    // 常に body 直下（モーダル内などに居ると座標が狂うのを防ぐ）
    if (el.parentElement !== document.body) document.body.appendChild(el);

    Object.assign(el.style, {
      position: 'fixed',
      display: 'none',
      zIndex: 9999,
      pointerEvents: 'none', // 外側クリックで閉じる想定なら none が自然
      left: '0px',
      top: '0px',
    });

    return el;
  }

  function showAt(x, y, cd){
    const box = ensureLayer();
    const img = box.querySelector('img');
    if (!img) return;

    // onerrorはガードして無限ループ防止
    img.onerror = () => {
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = '1';
      img.src = FALLBACK_IMG;
    };
    img.dataset.fallbackApplied = '';

    img.src = imgSrcOf(cd);

    const vw = window.innerWidth, vh = window.innerHeight;
    const xx = Number(x) || 0;
    const yy = Number(y) || 0;

    let left = xx + PREVIEW_PAD;
    let top  = yy + PREVIEW_PAD;

    if (left + PREVIEW_W > vw) left = Math.max(PREVIEW_PAD, xx - PREVIEW_W - PREVIEW_PAD);
    if (top  + PREVIEW_H > vh) top  = Math.max(PREVIEW_PAD, vh - PREVIEW_H - PREVIEW_PAD);

    box.style.left = `${Math.round(left)}px`;
    box.style.top  = `${Math.round(top)}px`;
    box.style.display = 'block';
  }

  function showNextTo(el, cd){
    const r = el?.getBoundingClientRect?.();
    if (!r) return;
    // 要素の右上付近に出す
    showAt(r.right, r.top, cd);
  }

  function hide(){
    const box = document.getElementById('card-preview-pop');
    if (box) box.style.display = 'none';
  }

  // ===== 公開API =====
  window.CardPreview = window.CardPreview || {};
  window.CardPreview.showAt     = window.CardPreview.showAt     || showAt;
  window.CardPreview.showNextTo = window.CardPreview.showNextTo || showNextTo;
  window.CardPreview.hide       = window.CardPreview.hide       || hide;

  // ===== 互換（旧グローバル名）=====
  window.showCardPreviewAt = window.showCardPreviewAt || ((x,y,cd)=>window.CardPreview.showAt(x,y,cd));
  window.showCardPreviewNextTo = window.showCardPreviewNextTo || ((el,cd)=>window.CardPreview.showNextTo(el,cd));
  window.hideCardPreview = window.hideCardPreview || (()=>window.CardPreview.hide());

  // ===== 共通の「外側クリックで閉じる」：1回だけ =====
  if (!window.__cardPreviewCloseWired){
    window.__cardPreviewCloseWired = true;
    document.addEventListener('click', (e) => {
      const pop = document.getElementById('card-preview-pop');
      if (!pop) return;
      if (pop.style.display === 'none') return;
      // pop自体は pointerEvents:none なので基本ここに来る
      // もし pointerEvents:auto に戻すなら、以下の判定を残す
      if (e.target.closest && e.target.closest('#card-preview-pop')) return;
      hide();
    });
  }
})();
