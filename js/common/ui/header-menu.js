/* =========================
 * js/common/ui/header-menu.js
 * - 共通ヘッダーの探索メニューを制御
 * ========================= */
(function () {
    'use strict';

    // =========================
    // 用語集の初回閲覧と新着表示
    // =========================
    const GLOSSARY_SEEN_KEY = 'mesorogia:glossary:launch-seen';
    let glossarySeen = false;

    // 用語集を開いた記録を保存し、保存できない環境でもページを利用可能にする。
    function updateGlossaryNotice() {
        const isGlossary = window.location.pathname.split('/').pop() === 'glossary.html';
        glossarySeen = glossarySeen || isGlossary;
        try {
            glossarySeen = glossarySeen || window.localStorage.getItem(GLOSSARY_SEEN_KEY) === '1';
            if (isGlossary) window.localStorage.setItem(GLOSSARY_SEEN_KEY, '1');
        } catch (_) {
            // 保存が制限されている場合は、このページ内の閲覧状態を使う。
        }
        document.documentElement.classList.toggle('has-glossary-news', !glossarySeen);
        const label = document.querySelector('.header-menu-button--new .sr-only');
        if (label) label.textContent = glossarySeen
            ? '探索・情報メニュー'
            : '探索・情報メニュー（新着：用語集）';
    }

    // 初期描画、履歴からの復帰、別タブの閲覧記録を同じ表示に揃える。
    updateGlossaryNotice();
    window.addEventListener('pageshow', updateGlossaryNotice);
    window.addEventListener('storage', (event) => {
        if (event.key === GLOSSARY_SEEN_KEY || event.key === null) updateGlossaryNotice();
    });

    function getMenu(root) {
        return root?.querySelector('.header-menu-panel');
    }

    function getButton(root) {
        return root?.querySelector('.header-menu-button');
    }

    function closeMenu(root) {
        const menu = getMenu(root);
        const button = getButton(root);
        if (menu) menu.hidden = true;
        if (button) button.setAttribute('aria-expanded', 'false');
    }

    function closeOtherMenus(currentRoot) {
        document.querySelectorAll('[data-header-dropdown]').forEach((root) => {
            if (root !== currentRoot) closeMenu(root);
        });
    }

    function toggleMenu(root) {
        const menu = getMenu(root);
        const button = getButton(root);
        if (!menu || !button) return;

        const willOpen = menu.hidden;
        closeOtherMenus(root);
        menu.hidden = !willOpen;
        button.setAttribute('aria-expanded', String(willOpen));
    }

    function runAppAction(action) {
        if (action === 'install') {
            if (typeof window.MesorogiaPwaInstall?.open === 'function') {
                window.MesorogiaPwaInstall.open();
            } else {
                alert('ブラウザのメニューからホーム画面に追加してください。');
            }
            return;
        }
    }

    function updateHeaderLogoTitle() {
        const header = document.querySelector('.main-header');
        const title = header?.querySelector('.header-logo-title');
        const nav = header?.querySelector('.header-nav');
        if (!header || !title || !nav) return;

        header.classList.remove('is-header-logo-title-hidden');

        if (window.matchMedia('(max-width: 560px)').matches) {
            header.classList.add('is-header-logo-title-hidden');
            return;
        }

        const titleRect = title.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const hasHorizontalOverflow = header.scrollWidth > Math.ceil(header.clientWidth + 1);
        const touchesNav = titleRect.right + 8 > navRect.left;
        const outsideHeader = titleRect.right > headerRect.right - 4;

        if (hasHorizontalOverflow || touchesNav || outsideHeader) {
            header.classList.add('is-header-logo-title-hidden');
        }
    }

    function bindHeaderLogoTitle() {
        let frameId = 0;
        const requestUpdate = () => {
            if (frameId) cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(() => {
                frameId = 0;
                updateHeaderLogoTitle();
            });
        };

        requestUpdate();
        window.addEventListener('resize', requestUpdate);
        window.addEventListener('load', requestUpdate);

        const account = document.querySelector('.main-header .header-account');
        if (account && typeof MutationObserver === 'function') {
            new MutationObserver(requestUpdate).observe(account, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }
    }

    function bindEvents() {
        bindHeaderLogoTitle();

        document.addEventListener('click', (event) => {
            const disabledLink = event.target.closest('[data-header-disabled-link]');
            if (disabledLink) {
                event.preventDefault();
                return;
            }

            const appActionButton = event.target.closest('[data-header-app-action]');
            if (appActionButton) {
                event.preventDefault();
                const root = appActionButton.closest('[data-header-dropdown]');
                closeMenu(root);
                runAppAction(appActionButton.getAttribute('data-header-app-action'));
                return;
            }

            const button = event.target.closest('.header-menu-button');
            if (button) {
                const root = button.closest('[data-header-dropdown]');
                if (!root) return;
                event.preventDefault();
                toggleMenu(root);
                return;
            }

            const root = event.target.closest('[data-header-dropdown]');
            if (!root) {
                document.querySelectorAll('[data-header-dropdown]').forEach(closeMenu);
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            document.querySelectorAll('[data-header-dropdown]').forEach(closeMenu);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindEvents, { once: true });
    } else {
        bindEvents();
    }
})();
