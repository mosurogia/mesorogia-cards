/**
 * 期間限定イベント機能の表示切り替え
 */
(function () {
  'use strict';

  const FEATURES = {
    innocentOldgodPickup: {
      enabled: false,
      domKey: 'innocent-oldgod-pickup',
    },
  };

  function normalizeKey_(key) {
    return String(key || '').trim();
  }

  function isEnabled_(key) {
    const feature = FEATURES[normalizeKey_(key)];
    return !!feature?.enabled;
  }

  function applyDomVisibility_() {
    Object.entries(FEATURES).forEach(([key, feature]) => {
      const domKey = feature?.domKey || key;
      document.querySelectorAll(`[data-event-feature="${domKey}"]`).forEach((el) => {
        const enabled = isEnabled_(key);
        el.hidden = !enabled;
        el.style.display = enabled ? '' : 'none';
      });
    });
  }

  window.MESOROGIA_EVENT_FEATURES = FEATURES;
  window.isMesorogiaEventFeatureEnabled = isEnabled_;
  window.applyMesorogiaEventFeatureVisibility = applyDomVisibility_;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyDomVisibility_, { once: true });
  } else {
    applyDomVisibility_();
  }
}());
