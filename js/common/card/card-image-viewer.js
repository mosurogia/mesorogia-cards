/* =========================
 * js/common/card/card-image-viewer.js
 * - カード画像プレビューとズームモーダルの統合管理
 * - 公開：window.CardPreview / window.CardZoomModal / 互換関数群
 * ========================= */
(function () {
  'use strict';

  /* ===== 共通補助 ===== */
  const FALLBACK_IMG = 'img/00000.webp';

  function normalizeCd5(cd) {
    if (typeof window.normCd5 === 'function') return window.normCd5(cd);
    const s = String(cd ?? '').trim();
    return s ? s.padStart(5, '0').slice(0, 5) : '';
  }

  function buildCardImageSrc(cardOrCd) {
    const explicitCard = (cardOrCd && typeof cardOrCd === 'object') ? cardOrCd : null;
    const cd5 = normalizeCd5(explicitCard ? (explicitCard.cd || explicitCard.id) : cardOrCd);
    const card = explicitCard || (window.cardMap || {})[cd5] || (window.allCardsMap || {})[cd5] || null;
    if (typeof window.getCardImageSrc === 'function') {
      return window.getCardImageSrc(card || cd5);
    }
    return cd5 ? `img/${cd5}.webp` : FALLBACK_IMG;
  }

  function applyFallbackOnError(img, cardOrCd = null) {
    if (!img) return;
    if (typeof window.setCardImageSrc === 'function' && cardOrCd) {
      window.setCardImageSrc(img, cardOrCd);
      return;
    }
    delete img.dataset.fallbackApplied;
    img.onerror = function () {
      if (this.dataset.fallbackApplied) return;
      this.dataset.fallbackApplied = '1';
      this.src = FALLBACK_IMG;
    };
  }

  /* ===== カードプレビュー ===== */
  const PREVIEW_W = 200;
  const PREVIEW_H = 280;
  const PREVIEW_PAD = 12;

  function ensurePreviewLayer() {
    let el = document.getElementById('card-preview-pop');
    if (!el) {
      el = document.createElement('div');
      el.id = 'card-preview-pop';
      el.innerHTML = `<img loading="eager" decoding="async" alt="preview"
        style="max-width:${PREVIEW_W}px;border-radius:6px;box-shadow:0 0 8px rgba(0,0,0,.5);" />`;
      document.body.appendChild(el);
    }

    if (el.parentElement !== document.body) {
      document.body.appendChild(el);
    }

    Object.assign(el.style, {
      position: 'fixed',
      display: 'none',
      zIndex: 9999,
      pointerEvents: 'none',
      left: '0px',
      top: '0px',
    });

    return el;
  }

  function showCardPreviewAt_(x, y, cd) {
    const box = ensurePreviewLayer();
    const img = box.querySelector('img');
    if (!img) return;

    const cd5 = normalizeCd5(cd);
    const card = (window.cardMap || {})[cd5] || (window.allCardsMap || {})[cd5] || cd5;
    applyFallbackOnError(img, card);
    if (!img.src) img.src = buildCardImageSrc(cd5);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const xx = Number(x) || 0;
    const yy = Number(y) || 0;

    let left = xx + PREVIEW_PAD;
    let top = yy + PREVIEW_PAD;

    if (left + PREVIEW_W > vw) {
      left = Math.max(PREVIEW_PAD, xx - PREVIEW_W - PREVIEW_PAD);
    }
    if (top + PREVIEW_H > vh) {
      top = Math.max(PREVIEW_PAD, vh - PREVIEW_H - PREVIEW_PAD);
    }

    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
    box.style.display = 'block';
  }

  function showCardPreviewNextTo_(el, cd) {
    const rect = el?.getBoundingClientRect?.();
    if (!rect) return;
    showCardPreviewAt_(rect.right, rect.top, cd);
  }

  function hideCardPreview_() {
    const box = document.getElementById('card-preview-pop');
    if (box) box.style.display = 'none';
  }

  function bindCardPreviewClose_() {
    if (window.__cardPreviewCloseWired) return;
    window.__cardPreviewCloseWired = true;

    document.addEventListener('click', (e) => {
      const pop = document.getElementById('card-preview-pop');
      if (!pop || pop.style.display === 'none') return;
      if (e.target.closest && e.target.closest('#card-preview-pop')) return;
      hideCardPreview_();
    });
  }

  /* ===== カードズームモーダル ===== */
  function ensureZoomModal_() {
    let modal = document.getElementById('cardZoomModal');
    if (modal) {
      if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
    } else {
      modal = document.createElement('div');
      modal.id = 'cardZoomModal';
      modal.className = 'modal';
      modal.style.display = 'none';
      document.body.appendChild(modal);
    }

    modal.className = 'modal';
    modal.style.display = modal.style.display || 'none';
    modal.innerHTML = `
      <div class="modal-content card-zoom" style="position:relative">
        <button id="cardZoomClose" aria-label="閉じる" class="modal-close-x" type="button">×</button>
        <img id="zoomImage" alt=""
          style="max-width:90vw;max-height:85vh;object-fit:contain;display:block;margin:auto;" />
      </div>
    `;

    bindCardZoomClose_();
    return modal;
  }

  function openCardZoom_(cardOrCd) {
    const explicitCard = (cardOrCd && typeof cardOrCd === 'object') ? cardOrCd : null;
    const cd5 = normalizeCd5(explicitCard ? (explicitCard.cd || explicitCard.id) : cardOrCd);
    if (!cd5) return;

    const modal = ensureZoomModal_();
    const img = document.getElementById('zoomImage');
    if (!modal || !img) return;

    const card = explicitCard || (window.cardMap || {})[cd5] || (window.allCardsMap || {})[cd5] || cd5;
    applyFallbackOnError(img, card);
    if (!img.src) img.src = buildCardImageSrc(card);

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeCardZoom_() {
    const modal = document.getElementById('cardZoomModal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  function bindCardZoomClose_() {
    if (window.__cardZoomBound) return;
    window.__cardZoomBound = true;

    document.addEventListener('click', (e) => {
      const current = document.getElementById('cardZoomModal');
      if (!current || current.style.display !== 'flex') return;
      if (e.target === current) closeCardZoom_();
    });

    document.addEventListener('keydown', (e) => {
      const current = document.getElementById('cardZoomModal');
      if (!current || current.style.display !== 'flex') return;
      if (e.key === 'Escape') closeCardZoom_();
    });

    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('#cardZoomClose');
      if (!btn) return;
      const current = document.getElementById('cardZoomModal');
      if (!current || current.style.display !== 'flex') return;
      e.preventDefault();
      e.stopPropagation();
      closeCardZoom_();
    }, true);
  }

  function bindLongPressForCards_(rootSelector = '#grid', options = {}) {
    const root = typeof rootSelector === 'string'
      ? document.querySelector(rootSelector)
      : rootSelector;
    if (!root || root.dataset.cardZoomLongpressBound === '1') return;

    const itemSelector = options.itemSelector || '.card';
    const cdResolver = typeof options.cdResolver === 'function'
      ? options.cdResolver
      : (el) => el?.dataset?.cd;
    const longMs = Number(options.longMs || 380);
    const moveTol = Number(options.moveTol || 8);

    let timer = null;
    let startX = 0;
    let startY = 0;

    root.dataset.cardZoomLongpressBound = '1';

    root.addEventListener('touchstart', (ev) => {
      const target = ev.target.closest(itemSelector);
      if (!target) return;

      const touch = ev.touches[0];
      if (!touch) return;

      startX = touch.clientX;
      startY = touch.clientY;

      const cd = String(cdResolver(target) || '').trim();
      clearTimeout(timer);
      if (!cd) return;

      timer = setTimeout(() => {
        openCardZoom_(cd);
      }, longMs);
    }, { passive: true });

    root.addEventListener('touchmove', (ev) => {
      const touch = ev.touches[0];
      if (!touch) return;
      if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > moveTol) {
        clearTimeout(timer);
      }
    }, { passive: true });

    root.addEventListener('touchend', () => clearTimeout(timer), { passive: true });
    root.addEventListener('touchcancel', () => clearTimeout(timer), { passive: true });
  }

  /* ===== 公開 API ===== */
  bindCardPreviewClose_();

  window.CardPreview = window.CardPreview || {};
  window.CardPreview.showAt = window.CardPreview.showAt || showCardPreviewAt_;
  window.CardPreview.showNextTo = window.CardPreview.showNextTo || showCardPreviewNextTo_;
  window.CardPreview.hide = window.CardPreview.hide || hideCardPreview_;

  window.showCardPreviewAt = window.showCardPreviewAt || ((x, y, cd) => window.CardPreview.showAt(x, y, cd));
  window.showCardPreviewNextTo = window.showCardPreviewNextTo || ((el, cd) => window.CardPreview.showNextTo(el, cd));
  window.hideCardPreview = window.hideCardPreview || (() => window.CardPreview.hide());

  window.CardZoomModal = window.CardZoomModal || {};
  window.CardZoomModal.ensure = window.CardZoomModal.ensure || ensureZoomModal_;
  window.CardZoomModal.open = window.CardZoomModal.open || openCardZoom_;
  window.CardZoomModal.close = window.CardZoomModal.close || closeCardZoom_;
  window.CardZoomModal.bindLongPressForCards = window.CardZoomModal.bindLongPressForCards || bindLongPressForCards_;

  window.__bindLongPressForCards = window.__bindLongPressForCards || function (target) {
    const selector = (typeof target === 'string' && target.trim() && target.trim().startsWith('#'))
      ? target.trim()
      : '#grid';
    return bindLongPressForCards_(selector);
  };
})();
