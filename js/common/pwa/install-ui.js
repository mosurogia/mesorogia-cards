(function () {
  'use strict';

  const STORAGE_PREFIX = 'mesorogiaPwaInstall';
  const DISMISS_KEY = `${STORAGE_PREFIX}:dismissedAt`;
  const HEADER_BANNER_DISMISS_KEY = `${STORAGE_PREFIX}:headerBannerDismissedAt`;
  const INSTALLED_KEY = `${STORAGE_PREFIX}:installedAt`;
  const NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

  let deferredPrompt = null;
  let nudgeEl = null;
  let headerBannerEl = null;
  let appNavFailureTimer = 0;

  const APP_NAV_ITEMS = [
    {
      href: 'cards.html',
      key: 'cards.html',
      label: '図鑑',
      icon: './img/header_icon_1.webp',
      tabMenu: 'cards'
    },
    {
      href: 'deckmaker.html',
      key: 'deckmaker.html',
      label: 'デッキ',
      icon: './img/header_icon_2.webp',
      tabMenu: 'deckmaker'
    },
    {
      href: 'deck-post.html',
      key: 'deck-post.html',
      label: '投稿',
      icon: './img/header_icon_3.webp'
    },
    {
      href: 'match-results.html',
      key: 'match-results.html',
      label: '戦績',
      icon: './img/header_icon_4.webp'
    },
    {
      href: '#',
      key: 'settings',
      label: '設定',
      iconText: '☰',
      action: 'account'
    }
  ];

  const TAB_MENUS = {
    cards: [
      { label: 'カード一覧', tabId: 'cards', buttonId: 'tab1' },
      { label: '所持率', tabId: 'checker', buttonId: 'tab2' }
    ],
    deckmaker: [
      { label: '構築', tabId: 'build', buttonId: 'tab1' },
      { label: '投稿', tabId: 'edit', buttonId: 'tab2' }
    ]
  };

  function isStandalone_() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator.standalone === true;
  }

  function isIos_() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
  }

  function getCurrentPageKey_() {
    const path = window.location.pathname || '';
    const file = path.split('/').pop() || 'deckmaker.html';
    return file === '' ? 'deckmaker.html' : file;
  }

  function ensureAppBottomNav_() {
    let nav = document.querySelector('.app-bottom-nav');
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'app-bottom-nav';
      nav.setAttribute('aria-label', 'アプリメニュー');
      document.body.appendChild(nav);
    }

    const current = getCurrentPageKey_();
    nav.innerHTML = APP_NAV_ITEMS.map((item) => {
      const active = item.key === current;
      const hasSubmenu = active && !!item.tabMenu;

      return `
    <a
      href="${item.href}"
      data-key="${item.key}"
      data-action="${item.action || ''}"
      data-tab-menu="${item.tabMenu || ''}"
      class="${[
        active ? 'is-active' : '',
        hasSubmenu ? 'has-bottom-tab-menu' : ''
      ].filter(Boolean).join(' ')}"
      ${active ? 'aria-current="page"' : ''}
      ${hasSubmenu ? 'aria-expanded="false"' : ''}
      >
      ${item.icon
        ? `<img src="${item.icon}" alt="">`
        : `<span class="app-bottom-nav-menu-icon" aria-hidden="true">${item.iconText || '☰'}</span>`
      }
      <span>${item.label}</span>
      </a>
    `;
    }).join('');

    return nav;
  }

  function showAppNavFailureLater_() {
    if (!isStandalone_()) return;
    window.clearTimeout(appNavFailureTimer);

    appNavFailureTimer = window.setTimeout(() => {
      let overlay = document.querySelector('.app-nav-loading');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'app-nav-loading';
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'polite');
        document.body.appendChild(overlay);
      }

      overlay.classList.add('is-error');
      overlay.innerHTML = '<span>読み込みに失敗しました。通信状況を確認して、もう一度お試しください。</span>';
      overlay.hidden = false;
    }, 8000);
  }

  function bindAppBottomNavLoading_() {
    if (document.__appBottomNavLoadingBound) return;
    document.__appBottomNavLoadingBound = true;

    document.addEventListener('click', (event) => {
      const menu = window.__bottomTabMenu;
      const clickedMenu = event.target.closest?.('.bottom-tab-menu');
      const clickedNavLink = event.target.closest?.('.app-bottom-nav a');

      if (menu?.classList.contains('show') && !clickedMenu) {
        closeBottomTabMenu_();

        if (clickedNavLink) {
          event.preventDefault();
          return;
        }
      }

      const link = event.target.closest?.('.app-bottom-nav a');
      if (!link) return;
      if (link.dataset.action === 'account') {
        event.preventDefault();

        if (typeof window.openAccountDataModal === 'function') {
          window.openAccountDataModal({ scope: 'all' });
        } else if (typeof window.openAccountModal === 'function') {
          window.openAccountModal();
        }

        return;
      }
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (link.target && link.target !== '_self') return;

      const nextUrl = new URL(link.href, window.location.href);

      if (nextUrl.href === window.location.href) {
        event.preventDefault();

        const key = link.dataset.tabMenu;
        if (key && TAB_MENUS[key]?.length) {
          openBottomTabMenu_(link, key);
          return;
        }

        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
        return;
      }

      showAppNavFailureLater_();
    });

    window.addEventListener('scroll', () => {
      if (window.__bottomTabMenu?.classList.contains('show')) {
        closeBottomTabMenu_();
      }
    }, { passive: true });
  }

  function refreshStandaloneChrome_() {
    const standalone = isStandalone_();
    document.body.classList.toggle('is-pwa-standalone', standalone);

    const nav = ensureAppBottomNav_();
    nav.hidden = !standalone;
  }

  function canShowNudge_() {
    if (isStandalone_()) return false;

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (!dismissedAt) return true;

    return Date.now() - dismissedAt > NUDGE_COOLDOWN_MS;
  }

  function hasInstalled_() {
    return !!Number(localStorage.getItem(INSTALLED_KEY) || 0);
  }

  function canShowHeaderBanner_() {
    if (isStandalone_() || hasInstalled_()) return false;

    const dismissedAt = Number(localStorage.getItem(HEADER_BANNER_DISMISS_KEY) || 0);
    if (!dismissedAt) return true;

    return Date.now() - dismissedAt > NUDGE_COOLDOWN_MS;
  }

  function dismissNudge_() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    if (nudgeEl) nudgeEl.hidden = true;
  }

  function dismissHeaderBanner_() {
    localStorage.setItem(HEADER_BANNER_DISMISS_KEY, String(Date.now()));
    if (headerBannerEl) headerBannerEl.hidden = true;
  }

  function markInstalled_() {
    localStorage.setItem(INSTALLED_KEY, String(Date.now()));
    if (headerBannerEl) headerBannerEl.hidden = true;
  }

  async function runInstallPrompt_() {
    if (isStandalone_()) {
      showInstruction_('already');
      return;
    }

    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      promptEvent.prompt();
      const choice = await promptEvent.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') markInstalled_();
      refreshHeaderBanner_();
      refreshFooterButton_();
      dismissNudge_();
      return;
    }

    showInstruction_(isIos_() ? 'ios' : 'manual');
  }

  function ensureHeaderBanner_() {
    if (headerBannerEl) return headerBannerEl;

    const header = document.querySelector('.main-header');
    if (!header) return null;

    headerBannerEl = document.createElement('div');
    headerBannerEl.className = 'pwa-header-banner';
    headerBannerEl.hidden = true;
    headerBannerEl.innerHTML = `
      <div class="pwa-header-banner-icon">
        <img src="./img/appicon_192.webp" alt="">
      </div>

      <div class="pwa-header-banner-text">
        <strong>モスロギアをアプリで使えます</strong>
        <span>全画面表示・ホームからすぐ起動</span>
      </div>

      <div class="pwa-header-banner-actions">
        <button type="button" class="pwa-header-banner-primary">アプリを追加</button>
        <button type="button" class="pwa-header-banner-close" aria-label="アプリ化バナーを閉じる">閉じる</button>
      </div>

      <div class="pwa-header-banner-preview" aria-hidden="true">
        <img src="./img/pwa_preview.webp" alt="">
      </div>
    `;

    header.insertAdjacentElement('afterend', headerBannerEl);

    headerBannerEl.querySelector('.pwa-header-banner-primary')?.addEventListener('click', runInstallPrompt_);
    headerBannerEl.querySelector('.pwa-header-banner-close')?.addEventListener('click', dismissHeaderBanner_);
    return headerBannerEl;
  }

  function refreshHeaderBanner_() {
    const el = ensureHeaderBanner_();
    if (!el) return;

    el.hidden = !canShowHeaderBanner_();
  }

  function showInstruction_(type) {
    const old = document.querySelector('.pwa-install-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.className = 'pwa-install-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    let title = 'アプリとして追加';
    let body = 'ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。';

    if (type === 'ios') {
      title = 'iPhoneで追加';
      body = 'Safariの共有ボタンから「ホーム画面に追加」を選んでください。';
    } else if (type === 'already') {
      title = '追加済みです';
      body = 'このサイトはアプリ表示で開かれています。';
    }

    modal.innerHTML = `
      <div class="pwa-install-dialog">
        <h3>${title}</h3>
        <p>${body}</p>
        <button type="button" class="pwa-install-primary">閉じる</button>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('.pwa-install-primary')) {
        close();
      }
    });
  }

  function refreshFooterButton_() {
    const button = document.querySelector('.js-pwa-install-footer');
    if (!button) return;

    const hidden = isStandalone_();
    button.hidden = hidden;
    button.previousElementSibling?.classList?.toggle('is-hidden', hidden);
    button.textContent = deferredPrompt ? 'アプリを追加' : 'アプリ追加方法';
  }

  function refreshToolbarButtons_() {
    document.querySelectorAll('.js-pwa-install-toolbar').forEach((button) => {
      button.hidden = isStandalone_();
      button.textContent = '📱 アプリで見る';
    });
  }

  function addFooterEntry_() {
    const footerLeft = document.querySelector('.site-footer .footer-mini-left');
    if (!footerLeft || footerLeft.querySelector('.js-pwa-install-footer')) return;

    const sep = document.createElement('span');
    sep.className = 'footer-sep footer-pwa-sep';
    sep.textContent = '・';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'footer-link footer-pwa-install js-pwa-install-footer';
    button.textContent = 'アプリ追加方法';
    button.addEventListener('click', runInstallPrompt_);

    footerLeft.append(sep, button);
    refreshFooterButton_();
  }

  function bindToolbarEntries_() {
    document.querySelectorAll('.js-pwa-install-toolbar').forEach((button) => {
      if (button.__pwaInstallToolbarBound) return;
      button.__pwaInstallToolbarBound = true;
      button.addEventListener('click', runInstallPrompt_);
    });

    refreshToolbarButtons_();
  }

  function ensureBackToTopButton_() {
    let button = document.querySelector('.app-back-to-top');
    if (button) return button;

    button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-back-to-top';
    button.setAttribute('aria-label', 'ページ上部へ戻る');
    button.textContent = '▲';

    button.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });

    document.body.appendChild(button);
    return button;
  }

  function refreshBackToTopButton_() {
    const button = ensureBackToTopButton_();
    const visible = isStandalone_() && window.scrollY > 500;
    button.classList.toggle('is-visible', visible);
  }

  function closeBottomTabMenu_() {
    window.__bottomTabMenu?.remove();
    window.__bottomTabMenu = null;
    document.querySelectorAll('.app-bottom-nav a.has-bottom-tab-menu').forEach((link) => {
      link.setAttribute('aria-expanded', 'false');
    });
  }

  function openBottomTabMenu_(anchor, key) {
    closeBottomTabMenu_();

    const items = TAB_MENUS[key];
    if (!items?.length) return;

    anchor.setAttribute('aria-expanded', 'true');

    const menu = document.createElement('div');
    menu.className = 'bottom-tab-menu';

    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;

      button.addEventListener('click', () => {
        if (typeof window.switchTab === 'function') {
          window.switchTab(item.tabId, document.getElementById(item.buttonId));
        } else {
          document.getElementById(item.buttonId)?.click();
        }
        closeBottomTabMenu_();
      });

      menu.appendChild(button);
    });

    document.body.appendChild(menu);

    const rect = anchor.getBoundingClientRect();

    menu.dataset.menuKey = key;

    menu.style.left = `${rect.left}px`;
    menu.style.width = `${rect.width}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;

    requestAnimationFrame(() => {
      menu.classList.add('show');
    });

    window.__bottomTabMenu = menu;
  }

  function ensureNudge_() {
    if (nudgeEl) return nudgeEl;

    nudgeEl = document.createElement('div');
    nudgeEl.className = 'pwa-install-nudge';
    nudgeEl.hidden = true;
    nudgeEl.innerHTML = `
      <div class="pwa-install-nudge-text">
        <strong>モスロギアをアプリに追加できます</strong>
        <span>ホーム画面からすぐに開けます。</span>
      </div>
      <div class="pwa-install-nudge-actions">
        <button type="button" class="pwa-install-nudge-primary">アプリを追加</button>
        <button type="button" class="pwa-install-nudge-later">あとで</button>
      </div>
    `;

    nudgeEl.querySelector('.pwa-install-nudge-primary')?.addEventListener('click', runInstallPrompt_);
    nudgeEl.querySelector('.pwa-install-nudge-later')?.addEventListener('click', dismissNudge_);
    document.body.appendChild(nudgeEl);
    return nudgeEl;
  }

  function showNudge_() {
    if (!canShowNudge_()) return;

    const el = ensureNudge_();
    el.hidden = false;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    refreshFooterButton_();
    refreshToolbarButtons_();
    refreshHeaderBanner_();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    markInstalled_();
    dismissNudge_();
    refreshHeaderBanner_();
    refreshFooterButton_();
    refreshToolbarButtons_();
  });

  function init_() {
    refreshStandaloneChrome_();
    refreshHeaderBanner_();
    addFooterEntry_();
    bindToolbarEntries_();
    bindAppBottomNavLoading_();
    ensureNudge_();
    ensureBackToTopButton_();
    refreshBackToTopButton_();
    window.addEventListener('scroll', refreshBackToTopButton_, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init_, { once: true });
  } else {
    init_();
  }

  window.MesorogiaPwaInstall = {
    showNudge: showNudge_,
    open: runInstallPrompt_
  };

  window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', () => {
    refreshStandaloneChrome_();
    refreshHeaderBanner_();
    refreshFooterButton_();
    refreshToolbarButtons_();
  });
}());
