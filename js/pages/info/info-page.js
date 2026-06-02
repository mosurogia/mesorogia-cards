/* =========================
 * 情報ページ
 * ========================= */
(function () {
  'use strict';

  function openSettings_() {
    if (typeof window.openAccountDataModal === 'function') {
      window.openAccountDataModal({ scope: 'all' });
      return;
    }

    if (typeof window.openAccountModal === 'function') {
      window.openAccountModal();
    }
  }

  function init_() {
    document.querySelector('[data-info-open-settings]')?.addEventListener('click', openSettings_);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init_, { once: true });
  } else {
    init_();
  }
}());
