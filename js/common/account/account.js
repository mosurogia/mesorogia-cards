/* =========================
 * js/common/account/account.js
 * - アカウント情報モーダル（開閉/保存/反映）
 * - updateProfile をGASへ送る
 * 依存：
 *   - window.Auth / window.postJSON / window.API（auth-core.js）
 *   - window.normalizeHandle / window.isValidXHandle / window.isEmailLikeName_（auth-utils.js）
 * ========================= */

(function(){
    function ensureAccountDataModal_(){
    if (document.getElementById('accountDataModal')) return;

    const wrap = document.createElement('div');
    wrap.className = 'account-modal';
    wrap.id = 'accountDataModal';
    wrap.style.display = 'none';

    wrap.innerHTML = `
        <form id="account-data-form" class="modal-content account-data-content" role="dialog" aria-modal="true" aria-labelledby="accountModalTitle">
        <div class="account-modal-head">
            <h3 id="accountModalTitle">アカウント設定</h3>
            <button type="button" class="account-close" data-close="accountDataModal" aria-label="閉じる">×</button>
        </div>

        <nav class="account-jump-chips" aria-label="アカウント設定メニュー">
            <button type="button" class="account-jump-chip" data-account-jump="account">アカウント</button>
            <button type="button" class="account-jump-chip" data-account-jump="post">投稿</button>
            <button type="button" class="account-jump-chip" data-account-jump="cardGroups">カードグループ</button>
            <button type="button" class="account-jump-chip" data-account-jump="ownedCards">所持率</button>
            <button type="button" class="account-jump-chip" data-account-jump="savedDecks">保存デッキ</button>
            <button type="button" class="account-jump-chip" data-account-jump="matchResults">戦績</button>
        </nav>

        <div class="account-modal-body account-data-sections">
            <section class="account-data-section" id="account-section-account" data-account-section="account">
            <div class="account-section-head">
                <h4>アカウント情報</h4>
                <span class="account-section-status" id="account-profile-status">ログイン情報</span>
            </div>
            <dl class="account-data-summary">
                <div><dt>ユーザー名</dt><dd id="acct-current-login">-</dd></div>
                <div>
                    <dt>ユーザーID</dt>
                    <dd class="account-copy-value">
                        <span id="acct-current-user-id">-</span>
                        <button
                            type="button"
                            class="account-copy-btn"
                            id="acct-copy-user-id"
                            aria-label="ユーザーIDをコピー"
                            title="ユーザーIDをコピー"
                        >
                            <img src="./img/copy.webp" alt="">
                        </button>
                    </dd>
                </div>
            </dl>
            <div class="account-field">
                <label for="acct-login-name">新しいユーザー名</label>
                <input id="acct-login-name" name="new-username" type="text" autocomplete="username" placeholder="新しいユーザー名を入力">
            </div>
            <div class="account-field">
                <label for="acct-password">新しいパスワード</label>
                <div class="account-pass-row">
                <input id="acct-password" name="new-password" type="password" autocomplete="new-password" placeholder="※4文字以上">
                <button type="button" class="btn ghost" id="acct-pass-toggle">表示</button>
                </div>
                <small class="account-hint">※ 保存時に現在のパスワード確認を行います</small>
            </div>
            <div class="account-section-actions">
                <button type="submit" class="btn ghost" id="acct-save-btn" disabled>保存</button>
            </div>
            </section>

            <section class="account-data-section" id="account-section-post" data-account-section="post">
            <div class="account-section-head">
                <h4>デッキ投稿情報</h4>
                <button
                    type="button"
                    class="account-section-link"
                    data-account-page="deck-post.html#mine"
                    aria-label="デッキ投稿ページへ移動"
                    title="デッキ投稿ページへ移動"
                >
                    <img src="./img/page-jump.webp" alt="">
                </button>
                <span class="account-section-status" id="account-post-status">投稿データ</span>
            </div>
            <dl class="account-data-summary">
                <div><dt>投稿数</dt><dd id="acct-post-count">-</dd></div>
                <div><dt>いいねしたデッキ数</dt><dd id="acct-liked-deck-count">-</dd></div>
                <div><dt>最終投稿日</dt><dd id="acct-last-posted-at">-</dd></div>
                <div><dt>投稿者名</dt><dd id="acct-current-poster-name">-</dd></div>
                <div><dt>Xアカウント名</dt><dd id="acct-current-x">-</dd></div>
            </dl>
            <small class="account-hint" id="acct-post-profile-hint">※ デッキ投稿に表示される名前とXアカウントです</small>
            <div class="account-field">
                <label for="acct-poster-name">投稿者名</label>
                <input id="acct-poster-name" name="poster-name" type="text" autocomplete="nickname" placeholder="投稿に表示する名前（任意）">
            </div>
            <div class="account-field">
                <label for="acct-x">Xアカウント</label>
                <div class="X-info">
                <input id="acct-x" name="poster-x" type="text" inputmode="verbatim" placeholder="（@なし可）">
                <button type="button" class="x-link-btn" id="acct-x-open" title="Xプロフィールを開く">X を確認</button>
                </div>
            </div>
            <div class="account-section-actions">
                <button type="submit" class="btn ghost" id="acct-post-save-btn" disabled>保存</button>
            </div>
            </section>

            <section class="account-data-section" id="account-section-cardGroups" data-account-section="cardGroups">
            <div class="account-section-head">
                <h4>カードグループ</h4>
                <button
                    type="button"
                    class="account-section-link"
                    data-account-page="cards.html"
                    aria-label="カード一覧ページへ移動"
                    title="カード一覧ページへ移動"
                >
                    <img src="./img/page-jump.webp" alt="">
                </button>
                <span class="account-section-status" id="acct-card-groups-status">未取得</span>
            </div>
            <dl class="account-data-summary">
                <div><dt>グループ数</dt><dd id="acct-card-groups-count">-</dd></div>
            </dl>
            <div class="account-section-actions">
                <button
                    type="button"
                    class="btn danger account-reset-btn"
                    data-account-reset="cardGroups"
                >
                <span class="account-reset-icon">!</span>
                    カードグループデータリセット
                </button>
            </div>
            </section>

            <section class="account-data-section" id="account-section-ownedCards" data-account-section="ownedCards">
            <div class="account-section-head">
                <h4>所持率データ</h4>
                <button
                    type="button"
                    class="account-section-link"
                    data-account-page="cards.html#checker"
                    aria-label="所持率チェッカーへ移動"
                    title="所持率チェッカーへ移動"
                >
                    <img src="./img/page-jump.webp" alt="">
                </button>
                <span class="account-section-status" id="acct-owned-status">未取得</span>
            </div>
            <dl class="account-data-summary">
                <div><dt>所持カード種類数</dt><dd id="acct-owned-type-count">-</dd></div>
                <div><dt>合計所持枚数</dt><dd id="acct-owned-total-count">-</dd></div>
            </dl>
            <div class="account-section-actions">
                <button type="button" class="btn danger account-reset-btn" data-account-reset="ownedCards">
                    <span class="account-reset-icon">!</span>
                    所持率データリセット
                </button>
            </div>
            </section>

            <section class="account-data-section" id="account-section-savedDecks" data-account-section="savedDecks">
            <div class="account-section-head">
                <h4>保存デッキ</h4>
                <button
                    type="button"
                    class="account-section-link"
                    data-account-page="deckmaker.html#saved-deck"
                    aria-label="保存デッキ一覧へ移動"
                    title="保存デッキ一覧へ移動"
                >
                    <img src="./img/page-jump.webp" alt="">
                </button>
                <span class="account-section-status" id="acct-saved-decks-status">未取得</span>
            </div>
            <dl class="account-data-summary">
                <div><dt>保存デッキ数</dt><dd id="acct-saved-decks-count">-</dd></div>
            </dl>
            <div class="account-section-actions">
                <button type="button" class="btn danger account-reset-btn" data-account-reset="savedDecks">
                    <span class="account-reset-icon">!</span>
                    保存デッキデータリセット
                </button>
            </div>
            </section>

            <section class="account-data-section" id="account-section-matchResults" data-account-section="matchResults">
            <div class="account-section-head">
                <h4>戦績情報</h4>
                <button
                    type="button"
                    class="account-section-link"
                    data-account-page="match-results.html"
                    aria-label="戦績ページへ移動"
                    title="戦績ページへ移動"
                >
                    <img src="./img/page-jump.webp" alt="">
                </button>
                <span class="account-section-status" id="acct-match-results-status">準備中</span>
            </div>
            <dl class="account-data-summary">
                <div><dt>登録戦績数</dt><dd id="acct-match-results-count">-</dd></div>
                <div><dt id="acct-match-winrate-label">勝率</dt><dd id="acct-match-winrate">-</dd></div>
            </dl>
            <div class="account-section-actions">
                <button type="button" class="btn danger account-reset-btn" data-account-reset="matchResults">
                    <span class="account-reset-icon">!</span>
                    戦績データリセット
                </button>
            </div>
            </section>

            <section class="account-data-section account-offline-card-section" id="account-section-offline-cards" aria-labelledby="account-offline-card-title">
            <div class="account-section-head">
                <h4 id="account-offline-card-title">カードデータ保存</h4>
                <span class="account-section-status" id="offline-card-save-status">未保存</span>
            </div>
            <p class="account-offline-card-note">カードデータと全カード画像をこの端末に保存します。画像込みのため通信量が多くなります。</p>
            <div class="account-section-actions account-offline-card-actions">
                <button type="button" class="btn ghost" id="offline-card-save-btn" data-offline-cards-save>カードデータを保存</button>
                <span class="account-offline-card-progress" id="offline-card-save-progress" aria-live="polite"></span>
            </div>
            <p class="account-offline-card-saved-at" id="offline-card-save-date" hidden></p>
            <p class="account-offline-card-error" id="offline-card-save-error" hidden></p>
            </section>

            <section class="account-data-section account-site-info-section" id="account-section-site-info" aria-labelledby="account-site-info-title">
            <div class="account-section-head">
                <h4 id="account-site-info-title">サイト情報</h4>
            </div>
            <div class="account-site-info">
                <p><strong>モスロギア</strong> はアプリ「神託のメソロギア」の非公式ファンサイトです。</p>
                <p><a class="footer-link" href="https://mythologiatheoracle.com/" target="_blank" rel="noopener noreferrer">公式サイト</a></p>
                <p>© 2025 Mesorogia Cards</p>
            </div>
            </section>
        </div>

        <div class="account-modal-footer">
            <button type="button" class="account-footer-logout btn ghost" id="account-footer-logout">
                ログアウト
            </button>
            <button type="button" class="btn ghost" data-close="accountDataModal">閉じる</button>
        </div>
        </form>
    `;

    document.body.appendChild(wrap);
    }

    function fillAccountForm_(){
    const user = window.Auth?.user || {};
    const login = document.getElementById('acct-login-name');
    const name = document.getElementById('acct-poster-name');
    const currentUserId = document.getElementById('acct-current-user-id');
        if (currentUserId) {
            currentUserId.textContent = user.userId || '（未取得）';
        }
    const x = document.getElementById('acct-x');
    const pass = document.getElementById('acct-password');
    const saveBtn = document.getElementById('acct-save-btn');

    if (login) {
        login.value = '';
        login.placeholder = user.username ? `現在: ${user.username}` : '（未設定）';
    }
    const currentLogin = document.getElementById('acct-current-login');
    if (currentLogin) currentLogin.textContent = user.username || '（未設定）';

    if (name) {
        name.value = '';
        name.placeholder = user.displayName ? `現在: ${user.displayName}` : '（未設定）';
    }
    const currentName = document.getElementById('acct-current-poster-name');
    if (currentName) currentName.textContent = user.displayName || '（未設定）';

    if (x) {
        x.value = '';
        x.placeholder = user.x ? `現在: ${user.x}` : '（未設定）';
    }
    const currentX = document.getElementById('acct-current-x');
    if (currentX) currentX.textContent = user.x ? `@${String(user.x).replace(/^@/, '')}` : '（未設定）';

    const postProfileHint = document.getElementById('acct-post-profile-hint');
    if (postProfileHint) {
        postProfileHint.textContent = (!user.displayName || !user.x)
            ? '※ 投稿者名とXアカウント名は未設定でも投稿できますが、軽く入れておくと投稿時の入力が楽になります'
            : '※ デッキ投稿に表示される名前とXアカウントです';
    }

    if (pass) pass.value = '';
    if (saveBtn) saveBtn.disabled = true;
    const postSaveBtn = document.getElementById('acct-post-save-btn');
    if (postSaveBtn) postSaveBtn.disabled = true;
    }

    window.openAccountDataModal = function openAccountDataModal(opts = {}){
    ensureAccountDataModal_();
    fillAccountForm_();

    const modal = document.getElementById('accountDataModal');
    if (modal) modal.style.display = 'flex';

    try {
        window.AccountDataManager?.open?.(opts);
    } catch(_) {}
    };


    function openModal(id){ const m = document.getElementById(id); if (m) m.style.display = 'flex'; }
    function closeModal(id){ const m = document.getElementById(id); if (m) m.style.display = 'none'; }

    document.addEventListener('DOMContentLoaded', () => {
        ensureAccountDataModal_();
        const copyUserIdBtn = document.getElementById('acct-copy-user-id');
        if (copyUserIdBtn) {
            copyUserIdBtn.addEventListener('click', async () => {
                const userId = document.getElementById('acct-current-user-id')?.textContent?.trim() || '';

                if (!userId || userId === '-' || userId === '（未取得）') {
                    alert('コピーできるユーザーIDがありません');
                    return;
                }

                try {
                    await navigator.clipboard.writeText(userId);

                    copyUserIdBtn.classList.add('is-copied');
                    copyUserIdBtn.title = 'コピーしました';

                    setTimeout(() => {
                        copyUserIdBtn.classList.remove('is-copied');
                        copyUserIdBtn.title = 'ユーザーIDをコピー';
                    }, 1000);
                } catch (err) {
                    console.error(err);
                    alert('コピーに失敗しました');
                }
            });
        }
        const footerLogoutBtn = document.getElementById('account-footer-logout');
        if (footerLogoutBtn) {
            footerLogoutBtn.addEventListener('click', async () => {
                const prevLabel = footerLogoutBtn.textContent;

                footerLogoutBtn.disabled = true;
                footerLogoutBtn.textContent = 'ログアウト中…';

                try {
                    await window.Auth?.logout?.();
                    try { window.onDeckPostAuthChanged?.(); } catch(_) {}
                    closeModal('accountDataModal');
                    alert('ログアウトしました');
                } catch (err) {
                    console.error(err);
                    alert('ログアウト失敗: ' + (err?.message || 'unknown'));
                    footerLogoutBtn.disabled = false;
                    footerLogoutBtn.textContent = prevLabel || 'ログアウト';
                }
            });
        }


        // モーダル開閉（共通）
        document.querySelectorAll('[data-open]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
            const id = btn.getAttribute('data-open');
            if (id === 'authLoginModal') {
            const mode = btn.getAttribute('data-auth-entry') || 'login';
            if (typeof window.openAuthModal === 'function') {
                window.openAuthModal(mode);
            } else {
                openModal(id);
            }
            return;
            }

            if (id === 'accountDataModal') {
                window.openAccountDataModal?.({ scope: btn.getAttribute('data-account-scope') || 'all' });
                return;
            }

            if (id) openModal(id);

            // accountDataModal 開いた瞬間に既知情報を流し込み
            if (id === 'campaignDetailModal') {
            try {
                const camp =
                window.__activeCampaign ||
                await (window.fetchActiveCampaign?.() || Promise.resolve(null));

                // ルール（報酬/抽選文）を描画
                window.setCampaignDetailRules?.(camp);
            } catch(_) {}

            // 開催期間（バナー表示を優先）
            const $range = document.getElementById('campaignDetailRange');
            const $srcRange = document.getElementById('campaign-banner-range');
            if ($range) {
                const t = ($srcRange?.textContent || '').trim();
                $range.textContent = t || '（日程はバナー表示に合わせて運用）';
            }

            // キャンペーン名（バナー表示を優先）
            const $name = document.getElementById('campaignDetailNameInline');
            const $srcName = document.getElementById('campaign-banner-title');
            if ($name) {
                const n = ($srcName?.textContent || '').trim();
                $name.textContent = n || 'キャンペーン';
            }

            // 対象タグ（とりあえずバナーのタイトルを1個タグとして入れる運用）
            const n = (document.getElementById('campaign-banner-title')?.textContent || '').trim();
            if (n && window.setCampaignDetailTags) window.setCampaignDetailTags([n]);
            }
        });
        });

        document.addEventListener('click', (e) => {
        const btn = e.target.closest?.('[data-close]');
        if (!btn) return;

        const id = btn.getAttribute('data-close');
        if (id) closeModal(id);
        });

        // 新しいパスワードの表示切替
        const passInput = document.getElementById('acct-password');
        const passToggle= document.getElementById('acct-pass-toggle');
        if (passToggle && passInput){
        passToggle.addEventListener('click', ()=>{
            const type = passInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passInput.setAttribute('type', type);
            passToggle.textContent = (type === 'password' ? '表示' : '非表示');
        });
        }

        // X確認（正規化→検証→open）
        const xBtn = document.getElementById('acct-x-open');
        const xInput = document.getElementById('acct-x');
        if (xBtn && xInput){
        xBtn.addEventListener('click', (e)=>{
            e.preventDefault();

            const norm = window.normalizeHandle?.(xInput.value) || '';
            if (norm) xInput.value = norm;

            const user = String(norm || '').replace(/^@/, '').trim();
            if (!user){
            alert('Xアカウント名を入力してください');
            return;
            }
            if (!window.isValidXHandle?.(norm)){
            alert('Xアカウント名が不正です（英数と_、最大15文字）');
            return;
            }
            window.open(`https://x.com/${encodeURIComponent(user)}`, '_blank', 'noopener');
        });
        }

        // 保存ボタン：入力があれば有効
        document.addEventListener('input', () => {
        const $login = document.getElementById('acct-login-name');
        const $pwd   = document.getElementById('acct-password');
        const $pname = document.getElementById('acct-poster-name');
        const $x     = document.getElementById('acct-x');
        const btn    = document.getElementById('acct-save-btn');
        const postBtn = document.getElementById('acct-post-save-btn');
        if (!btn && !postBtn) return;

        const accountAny =
            ($login?.value?.trim()?.length || 0) > 0 ||
            ($pwd  ?.value?.trim()?.length || 0) > 0;
        const postAny =
            ($pname?.value?.trim()?.length || 0) > 0 ||
            ($x    ?.value?.trim()?.length || 0) > 0;

        if (btn) btn.disabled = !accountAny;
        if (postBtn) postBtn.disabled = !postAny;
        });
    });
})();

// ===== アカウント保存（共通・一元化） =====
(function setupAccountSaveOnce(){
    if (window.__acctSaveBound) return;
    window.__acctSaveBound = true;

    const API      = window.API;
    const postJSON = window.postJSON;
    const Auth     = window.Auth;

    function buildPayloadFromForm(){
        const curLoginRaw = (document.getElementById('acct-login-name')?.placeholder || '').trim();
        const curLogin    = curLoginRaw.replace(/^現在:\s*/,'').trim();

        const curNameRaw  = (document.getElementById('acct-poster-name')?.placeholder || '').trim();
        const curName     = curNameRaw.replace(/^現在:\s*/,'').trim();

        const curXRaw     = (document.getElementById('acct-x')?.placeholder || '').trim();
        const curX        = curXRaw.replace(/^現在:\s*/,'').trim();

        const newLogin   = (document.getElementById('acct-login-name')?.value || '').trim();
        const newPass    = (document.getElementById('acct-password')?.value || '').trim();
        const newNameRaw = (document.getElementById('acct-poster-name')?.value || '').trim();
        const newXRaw    = (document.getElementById('acct-x')?.value || '').trim();

        const payload = { loginName: curLogin };

        if (newLogin && newLogin.toLowerCase() !== curLogin.toLowerCase()){
        payload.newLoginName = newLogin.toLowerCase();
        }
        if (newPass){
        payload.newPassword = newPass;
        }

        if (newNameRaw && window.isEmailLikeName_?.(newNameRaw)){
        alert('投稿者名にメールアドレスは入れないでください');
        return null;
        }

        let newXNorm = '';
        if (newXRaw){
        const norm = window.normalizeHandle?.(newXRaw) || '';
        if (!window.isValidXHandle?.(norm)){
            alert('Xアカウント名が不正です（英数と_、最大15文字）');
            return null;
        }
        newXNorm = norm.replace(/^@/, '');
        }

        if (newNameRaw && newNameRaw !== curName){
        payload.posterName = newNameRaw;
        }
        if (newXNorm && newXNorm !== curX){
        payload.xAccount = newXNorm;
        }
        return payload;
    }

    function applyResultToForm(resUser){
        const $login = document.getElementById('acct-login-name');
        const $name  = document.getElementById('acct-poster-name');
        const $x     = document.getElementById('acct-x');
        const $pw    = document.getElementById('acct-password');

        const $userId = document.getElementById('acct-current-user-id');
        if ($userId) {
            $userId.textContent = resUser?.userId || '（未取得）';
        }

        if ($login){
        const now = resUser?.username || ($login.placeholder || '').replace(/^現在:\s*/,'').trim();
        $login.value = '';
        $login.placeholder = now ? `現在: ${now}` : '（未設定）';
        const current = document.getElementById('acct-current-login');
        if (current) current.textContent = now || '（未設定）';
        }
        if ($name){
        const now = resUser?.displayName ?? ($name.placeholder || '').replace(/^現在:\s*/,'').trim();
        $name.value = '';
        $name.placeholder = now ? `現在: ${now}` : '（未設定）';
        const current = document.getElementById('acct-current-poster-name');
        if (current) current.textContent = now || '（未設定）';
        }
        if ($x){
        const now = resUser?.x ?? ($x.placeholder || '').replace(/^現在:\s*/,'').trim();
        $x.value = '';
        $x.placeholder = now ? `現在: ${now}` : '（未設定）';
        const current = document.getElementById('acct-current-x');
        if (current) current.textContent = now ? `@${String(now).replace(/^@/, '')}` : '（未設定）';
        }
        const postProfileHint = document.getElementById('acct-post-profile-hint');
        if (postProfileHint) {
        const displayName = resUser?.displayName ?? ($name?.placeholder || '').replace(/^現在:\s*/,'').trim();
        const xAccount = resUser?.x ?? ($x?.placeholder || '').replace(/^現在:\s*/,'').trim();
        postProfileHint.textContent = (!displayName || displayName === '（未設定）' || !xAccount || xAccount === '（未設定）')
            ? '※ 投稿者名とXアカウント名は未設定でも投稿できますが、軽く入れておくと投稿時の入力が楽になります'
            : '※ デッキ投稿に表示される名前とXアカウントです';
        }
        if ($pw){ $pw.value = ''; }
    }

    document.addEventListener('submit', async (ev) => {
        const form = ev.target.closest?.('#account-data-form');
        if (!form) return;

        ev.preventDefault();

        const submitter = ev.submitter?.closest?.('button[type="submit"]');
        const btn = submitter || document.getElementById('acct-save-btn');
        if (!btn) return;

        const payload = buildPayloadFromForm();
        if (!payload) return;

        const keys = Object.keys(payload);
        if (keys.length <= 1){
        alert('新しい変更データを入力してください');
        return;
        }

        const curPw = window.prompt('現在のパスワードを入力してください');
        if (!curPw || !curPw.trim()){
        alert('保存をキャンセルしました');
        return;
        }
        payload.password = curPw.trim();

        const sendBody = (Auth && typeof Auth.attachToken === 'function')
        ? Auth.attachToken(payload)
        : payload;

        btn.disabled = true;
        const keep = btn.textContent;
        btn.textContent = '送信中...';

        try{
        const res = await postJSON(`${API}?mode=updateProfile`, sendBody);
        if (!res?.ok) throw new Error(res?.error || 'update failed');

        if (res.user && Auth) {
            Auth._save(res.user, Auth.token);
        }

        try {
            if (typeof window.refreshWhoAmI === 'function') {
            await window.refreshWhoAmI();
            } else if (Auth && typeof Auth.whoami === 'function') {
            await Auth.whoami();
            }
        } catch(_) {}

        const newUser = (Auth && Auth.user) ? Auth.user : (res.user || null);
        applyResultToForm(newUser);
        const accountBtn = document.getElementById('acct-save-btn');
        const postBtn = document.getElementById('acct-post-save-btn');
        if (accountBtn) accountBtn.disabled = true;
        if (postBtn) postBtn.disabled = true;

        window.reflectLoginUI?.();
        window.AccountDataManager?.refresh?.();

        alert('アカウント情報を更新しました');
        }catch(err){
        console.error(err);
        alert('保存に失敗しました：' + err.message);
        }finally{
        btn.disabled = false;
        btn.textContent = keep;
        }
    });
})();

// ======================================
//  マイ投稿用: whoami → ユーザー名反映
// ======================================
window.refreshWhoAmI = window.refreshWhoAmI || async function refreshWhoAmI(){
    if (!window.Auth) return;

    const span = document.getElementById('mine-login-username');
    const note = document.querySelector('.mine-login-note');

    const res = await window.Auth.whoami();
    const loggedIn = !!(res && res.ok && res.user);

    if (span){
        span.textContent = loggedIn
        ? (res.user.displayName || res.user.username || 'ログイン中')
        : '未ログイン';
    }

    if (note){
        note.style.display = loggedIn ? 'none' : '';
    }
};
