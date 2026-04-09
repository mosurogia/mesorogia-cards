/* =========================
 * auth/account.js
 * - アカウント情報モーダル（開閉/保存/反映）
 * - updateProfile をGASへ送る
 * 依存：
 *   - window.Auth / window.postJSON / window.API（auth-core.js）
 *   - window.normalizeHandle / window.isValidXHandle / window.isEmailLikeName_（auth-utils.js）
 * ========================= */

(function(){
    function openModal(id){ const m = document.getElementById(id); if (m) m.style.display = 'flex'; }
    function closeModal(id){ const m = document.getElementById(id); if (m) m.style.display = 'none'; }

    document.addEventListener('DOMContentLoaded', () => {
        // モーダル開閉（共通）
        document.querySelectorAll('[data-open]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
            const id = btn.getAttribute('data-open');
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

        document.querySelectorAll('[data-close]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
            const id = btn.getAttribute('data-close');
            if (id) closeModal(id);
        });
        });

        // パスワード表示切替
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
        if (!btn) return;

        const any =
            ($login?.value?.trim()?.length || 0) > 0 ||
            ($pwd  ?.value?.trim()?.length || 0) > 0 ||
            ($pname?.value?.trim()?.length || 0) > 0 ||
            ($x    ?.value?.trim()?.length || 0) > 0;

        btn.disabled = !any;
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

        if ($login){
        const now = resUser?.username || ($login.placeholder || '').replace(/^現在:\s*/,'').trim();
        $login.value = '';
        $login.placeholder = now ? `現在: ${now}` : '（未設定）';
        }
        if ($name){
        const now = resUser?.displayName ?? ($name.placeholder || '').replace(/^現在:\s*/,'').trim();
        $name.value = '';
        $name.placeholder = now ? `現在: ${now}` : '（未設定）';
        }
        if ($x){
        const now = resUser?.x ?? ($x.placeholder || '').replace(/^現在:\s*/,'').trim();
        $x.value = '';
        $x.placeholder = now ? `現在: ${now}` : '（未設定）';
        }
        if ($pw){ $pw.value = ''; }
    }

    const form = document.getElementById('account-data-form');
    if (!form) return;

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();

        const btn = document.getElementById('acct-save-btn');
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

        window.reflectLoginUI?.();

        const m = document.getElementById('accountDataModal');
        if (m) m.style.display = 'none';

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
