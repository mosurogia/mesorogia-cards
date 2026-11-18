/**
 * カードグループのPCパネルを初期化するDOM処理。
 * 開閉設定の読み書きは専用の保存口へ委譲し、グループデータを変更しない。
 */
(function () {
  'use strict';
  function initCardsSummaryPanelToggle_(){
    const panel = document.getElementById('cards-summary-panel');
    const button = document.getElementById('cards-summary-panel-toggle');
    if (!panel || !button || button.dataset.bound === '1') return;

    button.dataset.bound = '1';

    const preference = window.CardGroupPanelPreference;
    const pcMedia = window.matchMedia('(min-width: 901px)');
    let positionRaf = 0;

    const updateTogglePosition = () => {
      positionRaf = 0;
      const rect = panel.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const buttonHeight = button.offsetHeight || 48;
      const visibleTop = Math.max(0, rect.top);
      const visibleBottom = Math.min(viewportHeight, rect.bottom);
      const visibleHeight = Math.max(buttonHeight, visibleBottom - visibleTop);
      const top = Math.max(0, Math.round(visibleTop + ((visibleHeight - buttonHeight) / 2)));
      button.style.setProperty('--summary-toggle-top', `${top}px`);
    };

    const scheduleTogglePosition = () => {
      if (positionRaf) return;
      positionRaf = requestAnimationFrame(updateTogglePosition);
    };

    const setCollapsed = (collapsed, persist = false) => {
      const label = collapsed ? 'カードグループを開く' : 'カードグループを閉じる';
      panel.classList.toggle('is-collapsed', collapsed);
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      button.setAttribute('aria-label', label);
      button.dataset.tooltip = label;
      button.innerHTML = collapsed ? '&#9654;' : '&#9664;';
      if (persist && pcMedia.matches) preference.save(collapsed);
      scheduleTogglePosition();
    };

    setCollapsed(preference.read(panel.classList.contains('is-collapsed')));
    button.addEventListener('click', () => {
      if (pcMedia.matches) setCollapsed(!panel.classList.contains('is-collapsed'), true);
    });
    window.addEventListener('scroll', scheduleTogglePosition, { passive: true });
    window.addEventListener('resize', scheduleTogglePosition);
    panel.addEventListener('scroll', scheduleTogglePosition, { passive: true });
    scheduleTogglePosition();
  }

  window.initCardGroupPanel = initCardsSummaryPanelToggle_;
})();

