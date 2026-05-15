/* =========================
 * js/common/ui/header-menu.js
 * - 共通ヘッダーの探索メニューを制御
 * ========================= */
(function () {
    'use strict';

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

    function bindEvents() {
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
