(function () {
  'use strict';

  function isMobile_(mediaQuery) {
    return window.matchMedia(mediaQuery || '(max-width: 1023px)').matches;
  }

  function ensureBase_(options) {
    const opts = options || {};
    const buttonId = String(opts.buttonId || 'deckpeek-button');
    const overlayId = String(opts.overlayId || 'deckpeek-overlay');
    const gridId = String(opts.gridId || 'deckpeek-grid');
    const buttonText = String(opts.buttonText || 'デッキ表示');
    const parent = opts.parent || document.body;

    let button = document.getElementById(buttonId);
    if (!button) {
      button = document.createElement('button');
      button.id = buttonId;
      button.type = 'button';
      button.textContent = buttonText;
      parent.appendChild(button);
    }

    let overlay = document.getElementById(overlayId);
    let grid = document.getElementById(gridId);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.innerHTML = `<div class="deckpeek-grid" id="${gridId}"></div>`;
      parent.appendChild(overlay);
      grid = overlay.querySelector(`#${gridId}`);
    } else if (!grid) {
      grid = document.createElement('div');
      grid.id = gridId;
      grid.className = 'deckpeek-grid';
      overlay.appendChild(grid);
    }

    return { button, overlay, grid };
  }

  function renderGrid_(grid, items, options) {
    if (!grid) return;

    const opts = options || {};
    const emptyText = String(opts.emptyText || 'デッキが空です');
    const imageBase = String(opts.imageBase || 'img/');
    const fallbackSrc = String(opts.fallbackSrc || 'img/00000.webp');
    const cardClass = String(opts.cardClass || 'deckpeek-card');
    const badgeClass = String(opts.badgeClass || 'count-badge');

    grid.innerHTML = '';

    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      const empty = document.createElement('div');
      empty.style.padding = '6px';
      empty.style.color = '#666';
      empty.style.fontSize = '12px';
      empty.textContent = emptyText;
      grid.appendChild(empty);
      return;
    }

    list.forEach((item) => {
      const code = window.normCd5 ? window.normCd5(item?.code) : String(item?.code || '').trim().padStart(5, '0');
      const count = Math.max(1, parseInt(item?.count, 10) || 1);

      const card = document.createElement('div');
      card.className = cardClass;
      card.dataset.cd = code;

      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = item?.imageSrc || `${imageBase}${code}.webp`;
      image.onerror = () => {
        image.onerror = null;
        image.src = fallbackSrc;
      };

      const badge = document.createElement('div');
      badge.className = badgeClass;
      badge.textContent = `x${count}`;

      card.appendChild(image);
      card.appendChild(badge);
      grid.appendChild(card);
    });
  }

  function isElementVisible_(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false;
    const rect = element.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
  }

  function createController_(options) {
    const opts = options || {};
    const elements = ensureBase_(opts);
    const button = elements.button;
    const overlay = elements.overlay;
    const grid = elements.grid;
    const mediaQuery = String(opts.mediaQuery || '(max-width: 1023px)');
    const resolveTarget = typeof opts.resolveTarget === 'function' ? opts.resolveTarget : () => null;
    const isEnabled = typeof opts.isEnabled === 'function' ? opts.isEnabled : () => true;
    const isForcedVisible = typeof opts.isForcedVisible === 'function' ? opts.isForcedVisible : () => false;
    const canShowButton = typeof opts.canShowButton === 'function'
      ? opts.canShowButton
      : () => true;
    const getIntersectingState = typeof opts.getIntersectingState === 'function'
      ? opts.getIntersectingState
      : (target) => isElementVisible_(target);
    const render = typeof opts.render === 'function' ? opts.render : () => {};
    const onVisibilityChange = typeof opts.onVisibilityChange === 'function' ? opts.onVisibilityChange : null;

    let io = null;
    let observedTarget = null;

    function hide() {
      overlay.style.display = 'none';
    }

    function show() {
      render({ button, overlay, grid });
      overlay.style.display = 'block';
    }

    function updateVisibility(entry) {
      const visible = !!entry?.isIntersecting;
      const allowed = !!isEnabled();
      const forced = !!isForcedVisible();
      const canShow = !!canShowButton(observedTarget);
      const showButton = isMobile_(mediaQuery) && ((allowed && canShow && !visible) || forced);

      button.style.display = showButton ? 'inline-flex' : 'none';
      if (!showButton) hide();

      if (onVisibilityChange) {
        onVisibilityChange({
          button,
          overlay,
          grid,
          showButton,
          visible,
          forced,
          allowed,
          canShow,
        });
      }
    }

    function refresh() {
      if (io) {
        io.disconnect();
        io = null;
      }

      observedTarget = resolveTarget() || null;
      if (observedTarget) {
        io = new IntersectionObserver((entries) => {
          const state = getIntersectingState(observedTarget, entries[0]);
          updateVisibility({ isIntersecting: !!state });
        }, { root: null, threshold: 0.05 });
        io.observe(observedTarget);
        updateVisibility({ isIntersecting: !!getIntersectingState(observedTarget, null) });
        return;
      }

      updateVisibility({ isIntersecting: false });
    }

    if (!button.dataset.deckPeekBound) {
      button.dataset.deckPeekBound = '1';

      let rafId = 0;
      function refreshOnNextFrame() {
        if (rafId) return;
        rafId = window.requestAnimationFrame(() => {
          rafId = 0;
          refresh();
        });
      }

      button.addEventListener('touchstart', (event) => {
        event.preventDefault();
        show();
      }, { passive: false });
      button.addEventListener('touchend', hide, { passive: true });
      button.addEventListener('touchcancel', hide, { passive: true });

      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        show();
      });

      window.addEventListener('mouseup', hide);
      window.addEventListener('blur', hide);

      window.addEventListener('scroll', () => {
        hide();
        refreshOnNextFrame();
      }, { passive: true });

      window.addEventListener('resize', refreshOnNextFrame);
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) hide();
    });

    return {
      button,
      overlay,
      grid,
      show,
      hide,
      refresh,
      renderGrid(items, renderOptions) {
        renderGrid_(grid, items, renderOptions);
      },
    };
  }

  window.DeckPeekCommon = {
    isMobile: isMobile_,
    ensureBase: ensureBase_,
    renderGrid: renderGrid_,
    createController: createController_,
  };
})();
