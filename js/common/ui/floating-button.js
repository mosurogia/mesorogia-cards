// スマホ用フローティングボタンの表示状態を調整する
(function () {
  'use strict';

  const TARGET_IDS = ['sp-group-open', 'screenshot-save-btn'];
  const COLLAPSE_DELAY_MS = 3000;
  const SCROLL_AWAY_Y = 160;
  const SCROLL_DELTA_PX = 8;
  const mq = window.matchMedia('(max-width: 768px)');

  const buttons = TARGET_IDS
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  if (!buttons.length) return;

  let collapseTimer = null;
  let lastScrollY = window.scrollY || document.documentElement.scrollTop || 0;

  function isVisible_(el) {
    if (!el || el.hidden || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function hasBlockingUi_() {
    const drawer = document.getElementById('sp-group-drawer');
    if (drawer && !drawer.hidden) return true;

    const panel = document.getElementById('shot-panel');
    if (panel && !panel.hidden) return true;

    const cropModal = document.getElementById('shot-crop-modal');
    if (cropModal && !cropModal.hidden) return true;

    const openDialog = document.querySelector('dialog[open]');
    if (openDialog) return true;

    return Array.from(document.querySelectorAll('.modal, .account-modal, .card-detail-modal-root'))
      .some((modal) => {
        if (modal.hidden) return false;
        const style = window.getComputedStyle(modal);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
  }

  function clearCollapseTimer_() {
    if (!collapseTimer) return;
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }

  function setCollapsed_(collapsed) {
    buttons.forEach((btn) => {
      if (isVisible_(btn)) {
        btn.classList.toggle('is-collapsed', collapsed);
      } else {
        btn.classList.remove('is-collapsed');
      }
    });
  }

  function setScrollAway_(away) {
    buttons.forEach((btn) => {
      btn.classList.toggle('is-scroll-away', away && isVisible_(btn));
    });
  }

  function syncScrollAway_() {
    if (!mq.matches || hasBlockingUi_()) {
      setScrollAway_(false);
      return;
    }

    const scrollY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const diff = scrollY - lastScrollY;

    if (Math.abs(diff) < SCROLL_DELTA_PX) return;

    if (diff > 0 && scrollY > SCROLL_AWAY_Y) {
      setScrollAway_(true);
    } else if (diff < 0) {
      setScrollAway_(false);
    }

    lastScrollY = scrollY;
  }

  function scheduleCollapse_() {
    clearCollapseTimer_();

    if (!mq.matches || hasBlockingUi_()) {
      setCollapsed_(false);
      return;
    }

    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      if (!mq.matches || hasBlockingUi_()) {
        setCollapsed_(false);
        return;
      }
      setCollapsed_(true);
    }, COLLAPSE_DELAY_MS);
  }

  function wake_() {
    setCollapsed_(false);
    scheduleCollapse_();
  }

  function onScroll_() {
    setCollapsed_(false);
    syncScrollAway_();
    scheduleCollapse_();
  }

  buttons.forEach((btn) => {
    btn.addEventListener('pointerdown', wake_, { capture: true, passive: true });
    btn.addEventListener('click', wake_, { capture: true, passive: true });
  });

  window.addEventListener('scroll', onScroll_, { passive: true });

  ['touchstart', 'pointerdown', 'keydown'].forEach((type) => {
    window.addEventListener(type, wake_, { passive: true });
  });

  window.addEventListener('resize', wake_, { passive: true });

  if (mq.addEventListener) {
    mq.addEventListener('change', wake_);
  } else if (mq.addListener) {
    mq.addListener(wake_);
  }

  wake_();
})();
