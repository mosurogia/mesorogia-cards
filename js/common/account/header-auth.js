/* =========================
 * js/common/account/header-auth.js
 * - 全ページ共通ヘッダーのアカウント導線
 * - 認証本体は auth-core.js / auth-ui.js を流用
 * ========================= */
(function(){
    'use strict';

    const Auth = window.Auth;
    const MENU_ID = 'header-auth-menu';

    function isLoggedIn(){
        return !!(Auth?.user && Auth?.token && Auth?.verified);
    }

    function getUserLabel(){
        const user = Auth?.user || {};
        return user.displayName || user.username || 'ユーザー';
    }

    function openModal(id){
        const modal = document.getElementById(id);
        if (modal) modal.style.display = 'flex';
    }

    function fillAccountForm(){
        const user = Auth?.user || {};
        const login = document.getElementById('acct-login-name');
        const name = document.getElementById('acct-poster-name');
        const x = document.getElementById('acct-x');

        if (login) {
            login.value = '';
            login.placeholder = user.username ? `現在: ${user.username}` : '（未設定）';
        }
        if (name) {
            name.value = '';
            name.placeholder = user.displayName ? `現在: ${user.displayName}` : '（未設定）';
        }
        if (x) {
            x.value = '';
            x.placeholder = user.x ? `現在: ${user.x}` : '（未設定）';
        }
    }

    function closeMenu(root){
        const menu = root?.querySelector('.header-auth-menu');
        const button = root?.querySelector('.header-auth-user');
        if (menu) menu.hidden = true;
        if (button) button.setAttribute('aria-expanded', 'false');
    }

    function toggleMenu(root){
        const menu = root?.querySelector('.header-auth-menu');
        const button = root?.querySelector('.header-auth-user');
        if (!menu || !button) return;

        const willOpen = menu.hidden;
        menu.hidden = !willOpen;
        button.setAttribute('aria-expanded', String(willOpen));
    }

    function render(){
        document.querySelectorAll('[data-header-auth]').forEach((root, index) => {
            const menuId = `${MENU_ID}-${index + 1}`;

            if (!isLoggedIn()) {
                root.innerHTML = `
                    <button type="button" class="header-auth-login" data-header-action="login">
                        ログイン
                    </button>
                `;
                return;
            }

            const label = window.escapeHtml_ ? window.escapeHtml_(getUserLabel()) : getUserLabel();
            root.innerHTML = `
                <div class="header-auth-dropdown">
                    <button type="button" class="header-auth-user" aria-haspopup="true" aria-expanded="false" aria-controls="${menuId}">
                        <span aria-hidden="true">👤</span>
                        <span class="header-auth-name">${label}</span>
                    </button>
                    <div class="header-auth-menu" id="${menuId}" role="menu" hidden>
                        <button type="button" role="menuitem" data-header-action="account">アカウントデータ</button>
                        <a role="menuitem" href="cards.html#checker" data-header-action="owned-data">所持データ</a>
                        <a role="menuitem" href="deckmaker.html#saved-deck" data-header-action="saved-deck">保存デッキ</a>
                        <a role="menuitem" href="match-results.html" data-header-action="match-results">戦績ページへ</a>
                        <a role="menuitem" href="deck-post.html#mine" data-header-action="mine-posts">マイページ</a>
                        <button type="button" role="menuitem" class="header-auth-logout" data-header-action="logout">ログアウト</button>
                    </div>
                </div>
            `;
        });
    }

    async function logout(root){
        const button = root?.querySelector('[data-header-action="logout"]');
        if (button) {
            button.disabled = true;
            button.textContent = 'ログアウト中…';
        }

        try {
            await Auth?.logout?.();
            try { window.onDeckPostAuthChanged?.(); } catch(_) {}
            closeMenu(root);
            alert('ログアウトしました');
        } catch(e) {
            alert('ログアウト失敗：' + (e?.message || 'unknown'));
            if (button) {
                button.disabled = false;
                button.textContent = 'ログアウト';
            }
        }
    }

    function openSavedDeck(){
        const target = document.getElementById('saved-deck');
        const tab = document.getElementById('tab2');
        if (target && tab && typeof window.switchTab === 'function') {
            window.switchTab('edit', tab);
            setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        }
    }

    function openMinePosts(){
        const mineBtn = document.getElementById('toMineBtn');
        if (mineBtn) {
            mineBtn.click();
        }
    }

    function handleRouteHash(){
        const hash = location.hash;
        if (hash === '#saved-deck') {
            openSavedDeck();
            return;
        }
        if (hash === '#mine') {
            openMinePosts();
        }
    }

    function bindEvents(){
        document.addEventListener('click', (event) => {
            const root = event.target.closest('[data-header-auth]');
            const actionEl = event.target.closest('[data-header-action], .header-auth-user');

            if (!root || !actionEl) {
                document.querySelectorAll('[data-header-auth]').forEach(closeMenu);
                return;
            }

            if (actionEl.classList.contains('header-auth-user')) {
                event.preventDefault();
                toggleMenu(root);
                return;
            }

            const action = actionEl.getAttribute('data-header-action');
            if (action === 'login') {
                event.preventDefault();
                if (typeof window.openAuthModal === 'function') {
                    window.openAuthModal('login');
                } else {
                    openModal('authLoginModal');
                }
                return;
            }

            if (action === 'account') {
                event.preventDefault();

                if (typeof window.openAccountDataModal === 'function') {
                    window.openAccountDataModal({ scope: 'all' });
                } else {
                    openModal('accountDataModal');
                }

                closeMenu(root);
                return;
            }

            if (action === 'logout') {
                event.preventDefault();
                logout(root);
                return;
            }

            if (action === 'saved-deck' && location.pathname.endsWith('/deckmaker.html')) {
                event.preventDefault();
                closeMenu(root);
                openSavedDeck();
                return;
            }

            if (action === 'mine-posts' && location.pathname.endsWith('/deck-post.html')) {
                event.preventDefault();
                closeMenu(root);
                openMinePosts();
                return;
            }

            closeMenu(root);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            document.querySelectorAll('[data-header-auth]').forEach(closeMenu);
        });
    }

    function chainReflectLoginUI(){
        const prev = window.reflectLoginUI;
        window.reflectLoginUI = function reflectLoginUIWithHeader(){
            if (typeof prev === 'function') prev.apply(this, arguments);
            render();
        };
    }

    window.addEventListener('DOMContentLoaded', () => {
        chainReflectLoginUI();
        bindEvents();
        render();
        setTimeout(handleRouteHash, 0);
    });
})();
