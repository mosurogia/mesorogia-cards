/* =========================
 * js/common/account/auth-ui.js
 * - ログインUIの表示制御・イベント結線
 * - Auth（auth-core.js）を使ってログイン/登録/ログアウトを行う
 * 依存：
 *   - window.Auth / window.postJSON / window.API（auth-core.js）
 *   - window.normalizeHandle 等（auth-utils.js はアカウント保存側で使用）
 * 公開：
 *   - window.reflectLoginUI
 * ========================= */

(function(){
const Auth = window.Auth;
let authModalMode = 'login';
let authUiLoading = false;

function getAuthModeLabel(mode){
    return mode === 'signup' ? '新規登録' : 'ログイン';
}

function setAuthModalMode(mode = 'login'){
    authModalMode = mode === 'signup' ? 'signup' : 'login';

    const isSignup = authModalMode === 'signup';
    const title = document.getElementById('authLoginModalTitle');
    const confirm = document.getElementById('auth-password-confirm');
    const confirmRow = confirm?.closest?.('.poster-line');
    const switchBtn = document.getElementById('auth-signup-btn');
    const submitBtn = document.getElementById('auth-login-btn-submit');
    const password = document.getElementById('auth-password');
    const status = document.getElementById('auth-inline-status');

    if (title) title.textContent = getAuthModeLabel(authModalMode);
    if (confirmRow) confirmRow.style.display = isSignup ? '' : 'none';
    if (!isSignup && confirm) confirm.value = '';

    if (switchBtn) {
    switchBtn.textContent = isSignup ? 'ログインはこちらから' : '新規登録はこちら';
    switchBtn.classList.remove('primary');
    switchBtn.classList.add('auth-mode-switch');
    }

    if (submitBtn) {
    submitBtn.textContent = isSignup ? '新規登録' : 'ログイン';
    submitBtn.classList.add('primary');
    }

    if (password) {
    password.name = isSignup ? 'new-password' : 'current-password';
    password.autocomplete = isSignup ? 'new-password' : 'current-password';
    }

    if (status) status.textContent = '';
}

function openAuthModal(mode = 'login'){
    setAuthModalMode(mode);

    const modal = document.getElementById('authLoginModal');
    if (modal) modal.style.display = 'flex';

    const target = document.getElementById('auth-username');
    setTimeout(() => {
    try { target?.focus?.(); } catch(_) {}
    }, 0);
}

window.setAuthModalMode = setAuthModalMode;
window.openAuthModal = openAuthModal;

// ===== UI（グローバル公開版）====
window.reflectLoginUI = function reflectLoginUI(){
    const loggedIn = !!(Auth?.user && Auth?.token && Auth?.verified);
    const user = loggedIn ? (Auth.user || {}) : null;
    const authModal = document.getElementById('authLoginModal');
    const isAuthModalOpen = !!(authModal && authModal.style.display !== 'none');
    // ログイン処理中は、内部の認証成功反映で完了前にログイン済み表示へ切り替えない
    const keepAuthFormVisible = !!(authUiLoading && isAuthModalOpen);
    const showLoggedInPanel = loggedIn && !keepAuthFormVisible;

    // 既存のログインフォーム周り（大きい方）
    const $form     = document.getElementById('auth-login-form');
    const $logged   = document.getElementById('auth-logged-in');
    const $disp     = document.getElementById('auth-display');
    const $unameLbl = document.getElementById('auth-username-label');
    const $pw       = document.getElementById('auth-password');

    // 投稿フォーム内のミニ表示
    const $miniOut  = document.getElementById('auth-mini-loggedout');
    const $miniIn   = document.getElementById('auth-mini-loggedin');
    const $cardsAuthActions = document.getElementById('cards-auth-actions');
    const $summaryBar = document.querySelector('.summary-bar');

    if ($form)   $form.style.display   = showLoggedInPanel ? 'none' : '';
    if ($logged) $logged.style.display = showLoggedInPanel ? '' : 'none';
    if ($cardsAuthActions) $cardsAuthActions.style.display = loggedIn ? 'none' : '';
    if ($summaryBar) $summaryBar.classList.toggle('is-auth-logged-in', loggedIn);

    if (loggedIn){
    if ($disp) $disp.textContent = user.displayName || user.username || '(no name)';
    } else {
    if ($pw)   $pw.value = '';
    if ($disp) $disp.textContent = '';
    }

    if ($unameLbl){
    $unameLbl.textContent = loggedIn
        ? (user.username || user.displayName || '')
        : '';
    }

    if ($miniOut) $miniOut.style.display = loggedIn ? 'none' : '';
    if ($miniIn)  $miniIn.style.display  = loggedIn ? '' : 'none';
    window.__CardGroupsUI?.refresh?.();

    // mine-login-note（マイ投稿ページ用）
    const note = document.querySelector('.mine-login-note');
    if (note) note.style.display = loggedIn ? 'none' : '';

    const mineName = document.getElementById('mine-login-username');
    if (mineName) {
    mineName.textContent = loggedIn
        ? (user.username || user.displayName || '')
        : '未ログイン';
    }

    // デッキ投稿フォームの既定値（未入力時のみ自動入力）
    const $dispInput = document.getElementById('auth-display-name');
    if (loggedIn && $dispInput && !$dispInput.value){
    $dispInput.value = user.displayName || user.username || '';
    }

    const $xInput = document.getElementById('auth-x');
    if (loggedIn && $xInput && !$xInput.value){
    $xInput.value = user.x || '';
    }
};

// ===== 認証UIフィードバック =====
function setAuthLoading(on, msg){
    authUiLoading = !!on;
    const loginBtn  = document.getElementById('auth-login-btn-submit');
    const signupBtn = document.getElementById('auth-signup-btn');
    if (loginBtn)  loginBtn.disabled  = !!on;
    if (signupBtn) signupBtn.disabled = !!on;

    if (typeof window.setAuthChecking === 'function') window.setAuthChecking(!!on);

    const st = document.getElementById('auth-inline-status');
    if (st) st.textContent = msg || '';
}

function showAuthOK(msg){
    const st = document.getElementById('auth-inline-status');
    if (st) st.textContent = msg || '完了しました';
}

function showAuthError(msg){
    const st = document.getElementById('auth-inline-status');
    if (st) st.textContent = msg || 'エラーが発生しました';
}

function showForgotPasswordGuide(){
    const st = document.getElementById('auth-inline-status');
    if (!st) return;

    st.textContent = 'ブラウザに保存されたパスワードをご確認ください。再設定が必要な場合は、ユーザー名・投稿者名・Xアカウント・投稿したデッキURLなど、本人確認に使える情報を添えて管理者へお問い合わせください。';
}

function startSlowTimer(ms = 5000) {
    const st = document.getElementById('auth-inline-status');
    let fired = false;

    const id1 = setTimeout(() => {
    if (st && !fired && st.textContent && /中…$/.test(st.textContent)) {
        st.textContent += '（少し時間がかかっています…）';
    }
    }, ms);

    const id2 = setTimeout(() => {
    if (st && !fired && st.textContent && /時間がかかっています/.test(st.textContent)) {
        st.textContent = st.textContent.replace(/（.*?）$/, '') + '（このままお待ちください…）';
    }
    }, 15000);

    return () => { fired = true; clearTimeout(id1); clearTimeout(id2); };
}

// パスワード保存トリガー
function triggerPasswordSave(username, password){
    const form = document.getElementById('auth-login-save');
    if (!form) return;

    const u = form.querySelector('input[name="username"]');
    const p = form.querySelector('input[name="password"]');
    if (!u || !p) return;

    u.value = username || '';
    p.value = password || '';

    form.style.left = '0px';
    form.style.top  = '0px';

    try {
    form.requestSubmit?.();
    form.submit?.();
    } catch(e){}

    setTimeout(() => {
    form.style.left = '-9999px';
    form.style.top  = '-9999px';
    }, 50);
}

async function doSignup(){
    const username  = (document.getElementById('auth-username')?.value || '').trim().toLowerCase();
    const password  = (document.getElementById('auth-password')?.value || '');
    const password2 = (document.getElementById('auth-password-confirm')?.value || '');

    const displayName = '';
    const x = '';

    if (!username || !password){
    alert('ユーザー名とパスワードを入力してください');
    return;
    }
    if (!password2){
    alert('確認用パスワードを入力してください');
    return;
    }
    if (password !== password2){
    alert('パスワードが一致しません。もう一度入力してください');
    return;
    }

    setAuthLoading(true, '登録中…');
    const stopSlow = startSlowTimer(5000);
    try{
    await Auth.signup(username, password, displayName, x);
    stopSlow();
    setAuthLoading(false, '');
    showAuthOK('登録完了');
    window.reflectLoginUI?.();
    window.onDeckPostAuthChanged?.();

    const modal = document.getElementById('authLoginModal');
    const pw    = document.getElementById('auth-password');
    const pw2   = document.getElementById('auth-password-confirm');
    if (pw)  pw.value  = '';
    if (pw2) pw2.value = '';
    if (modal) modal.style.display = 'none';

    setTimeout(() => alert('新規登録しました'), 100);

    triggerPasswordSave(username, password);
    }catch(e){
    stopSlow();
    setAuthLoading(false, '');
    showAuthError('登録失敗：' + (e?.message || 'unknown'));
    }
}

async function doLogin(){
    const username = (document.getElementById('auth-username')?.value || '').trim().toLowerCase();
    const password = (document.getElementById('auth-password')?.value || '');
    if (!username || !password){
    alert('ユーザー名とパスワードを入力してください');
    return;
    }

    setAuthLoading(true, 'ログイン中…');
    const stopSlow = startSlowTimer(5000);
    try{
    await Auth.login(username, password);
    stopSlow();
    setAuthLoading(false, '');
    showAuthOK('ログイン完了');
    window.reflectLoginUI?.();
    window.onDeckPostAuthChanged?.();

    const modal = document.getElementById('authLoginModal');
    if (modal) modal.style.display = 'none';

    setTimeout(() => {
        alert('ログインしました');
        location.hash = '#logged-in';
    }, 100);

    triggerPasswordSave(username, password);

    }catch(e){
    stopSlow();
    setAuthLoading(false, '');
    showAuthError('ログイン失敗：' + (e?.message || 'unknown'));
    }
}

async function doLogout(){
    const logoutBtn = document.getElementById('auth-logout-btn');
    const prevLabel = logoutBtn ? logoutBtn.textContent : '';

    if (logoutBtn){
    logoutBtn.disabled = true;
    logoutBtn.textContent = 'ログアウト中…';
    }

    setAuthLoading(true, 'ログアウト中…');
    const stopSlow = startSlowTimer(5000);

    try{
    await Auth.logout();
    try { window.onDeckPostAuthChanged?.(); } catch(_){}

    const st = document.getElementById('auth-inline-status');
    if (st) st.textContent = '';

    stopSlow();
    setAuthLoading(false, '');
    alert('ログアウトしました');

    } catch(e){
    stopSlow();
    setAuthLoading(false, '');
    showAuthError('ログアウト失敗：' + (e?.message || 'unknown'));
    } finally {
    if (logoutBtn){
        logoutBtn.disabled = false;
        logoutBtn.textContent = prevLabel || 'ログアウト';
    }
    }
}

// DOM 結線
window.addEventListener('DOMContentLoaded', () => {
    const pw = document.getElementById('auth-password');
    const toggle = document.getElementById('auth-pass-toggle');
    if (pw && toggle){
    toggle.addEventListener('click', () => {
        const isPw = pw.type === 'password';
        pw.type = isPw ? 'text' : 'password';
        toggle.textContent = isPw ? '非表示' : '表示';
    });
    }

    const switchBtn = document.getElementById('auth-signup-btn');
    if (switchBtn) {
    switchBtn.addEventListener('click', (e) => {
        e.preventDefault();
        setAuthModalMode(authModalMode === 'signup' ? 'login' : 'signup');
        setTimeout(() => {
        try { document.getElementById('auth-username')?.focus?.(); } catch(_) {}
        }, 0);
    });
    }

    document.getElementById('auth-logout-btn')?.addEventListener('click', doLogout);
    document.getElementById('auth-forgot-password')?.addEventListener('click', showForgotPasswordGuide);

    // 認証状態の初期化
    Auth?.init?.();
    setAuthModalMode('login');

    // Enter 送信抑制（即ログイン防止）
    const loginForm = document.getElementById('auth-login-form');
    if (loginForm) {
    loginForm.addEventListener('submit', (e) => e.preventDefault());
    }

    // ログインはボタン経由のみ
    const loginBtn = document.getElementById('auth-login-btn-submit');
    if (loginBtn) {
    loginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (authModalMode === 'signup') {
        doSignup();
        } else {
        doLogin();
        }
    });
    }

    document.addEventListener('click', (e) => {
    const entry = e.target.closest('[data-auth-entry]');
    if (!entry) return;

    const mode = entry.getAttribute('data-auth-entry');
    openAuthModal(mode);

    setTimeout(() => {
        try { document.getElementById('auth-username')?.focus?.(); } catch(_) {}
    }, 0);
    });

    // 確認パスワード欄 Enter→登録
    const pwConfirm = document.getElementById('auth-password-confirm');
    if (pwConfirm) {
    pwConfirm.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
        e.preventDefault();
        doSignup();
        }
    });
    }
});
})();
// ========================================================
// Campaign Detail Modal (page24依存を廃止して共通化)
// - campaignDetailModal を動的生成
// - setCampaignDetailRules / setCampaignDetailTags を提供
// ========================================================
(function(){
  'use strict';

  // これが質問の DEFAULT_DRAW_TEXT の置き場所（auth-ui.js）
  const DEFAULT_DRAW_TEXT =
`【抽選枠】
応募口数（最大3口）をもとに抽選します。
・同一ユーザーは最大3口まで（投稿数が多いほど当選確率アップ）

【選考枠（2枠）】
運営が内容を見て選ぶ枠です（抽選ではありません）。

① 選考枠（全デッキ対象）
・どんなデッキでも対象
・デッキ説明が丁寧なものが選ばれやすいです
・Eパックのカードがあると有利かも？

② 選考枠（レジェンドなしデッキ対象）
・レジェンドを使わない構築が対象
・制約の中での工夫や完成度を重視します
※レジェンドなしデッキにはキャンペーンタグとは別で自動で専用タグが付きます
`;

  // あなたの運用だと抽選文は固定でOKとのことなので固定用も残す
  const DEFAULT_DRAW_TEXT_FIXED = DEFAULT_DRAW_TEXT;

  function parseRules_(camp){
    const raw = camp?.rulesJSON;
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(String(raw)); } catch(_) { return null; }
  }

  function ensureCampaignDetailModal_(){
    if (document.getElementById('campaignDetailModal')) return;

    const wrap = document.createElement('div');
    wrap.className = 'account-modal';
    wrap.id = 'campaignDetailModal';
    wrap.style.display = 'none';

    wrap.innerHTML = `
      <div class="modal-content campaign-modal" role="dialog" aria-modal="true" aria-labelledby="campaignDetailTitle">
        <div class="account-modal-head campaign-modal-head">
          <div class="campaign-head-left">
            <h3 id="campaignDetailTitle">🎉 キャンペーン詳細</h3>
            <div id="campaignDetailNameInline" class="campaign-head-sub" aria-label="キャンペーン名">（キャンペーン）</div>
          </div>
        </div>

        <div class="account-modal-body campaign-modal-body">
          <div class="campaign-card">
            <div class="campaign-card-title">📅 開催期間</div>
            <div class="campaign-card-text">
              <span id="campaignDetailRange" class="campaign-range">（日程はバナー表示に合わせて運用）</span>
            </div>
          </div>

          <div class="campaign-card">
            <div class="campaign-card-title">🎁 報酬</div>
            <div class="campaign-card-text" id="campaignDetailPrizesText">（報酬：準備中）</div>
          </div>

          <div class="campaign-card">
            <div class="campaign-card-title">📝 参加方法（投稿の仕方）</div>
            <ol class="campaign-steps">
              <li><b>アカウント新規登録 or ログイン</b></li>
              <li>
                <b>投稿内のXアカウント欄を記入</b>
                <div class="campaign-warn">未入力だと、当選しても届けられません（重要）</div>
              </li>
              <li>
                <b>デッキ投稿にキャンペーン対象のタグが付いていれば応募完了</b>
                <div class="campaign-tagbox tag-chips post-tags-main" data-campaign-tagbox>
                  <span class="chip active">（対象タグ：準備中）</span>
                </div>
              </li>
            </ol>
          </div>

          <div class="campaign-card">
            <div class="campaign-card-title">🎟 応募口数</div>
            <div class="campaign-card-text">
              <b>1ユーザーにつき最大3口まで応募OK</b><br>
              <span class="campaign-boost">たくさん投稿すると当選確率アップ！</span>
            </div>
          </div>

          <div class="campaign-card">
            <div class="campaign-card-title">🎲 抽選方法</div>
            <div class="campaign-card-text" id="campaignDetailDrawText"></div>
          </div>

          <div class="campaign-modal-footer">
            <button type="button" class="btn primary" data-close="campaignDetailModal">閉じる</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);
  }

  // （任意）後から対象タグを差し込む用
  function setCampaignDetailTags_(tags){
    const modal = document.getElementById('campaignDetailModal');
    const box = modal?.querySelector('[data-campaign-tagbox]');
    if (!box) return;

    const list = Array.isArray(tags) ? tags.filter(Boolean) : [];
    box.replaceChildren();

    if (!list.length){
      const s = document.createElement('span');
      s.className = 'chip active';
      s.textContent = '（対象タグ：準備中）';
      box.appendChild(s);
      return;
    }
    list.forEach(t=>{
      const s = document.createElement('span');
      s.className = 'campaign-tag chip active';
      s.textContent = t;
      box.appendChild(s);
    });
  }

  function setCampaignDetailRules_(camp){
    const rules = parseRules_(camp) || {};
    const drawEl   = document.getElementById('campaignDetailDrawText');
    const prizesEl = document.getElementById('campaignDetailPrizesText');

    // 抽選方法：固定文
    if (drawEl){
      drawEl.innerHTML = window.escapeHtml_(DEFAULT_DRAW_TEXT_FIXED).replaceAll('\n','<br>');
    }
    if (!prizesEl) return;

    // ---- 報酬：新旧どっちでも表示できるようにする ----
    // 旧: rules.prizes = ["...","..."]
    // 新: rules.prize = { lottery:[{label,amount,winners}], selection:[...] }
    const legacy = Array.isArray(rules.prizes) ? rules.prizes.filter(Boolean) : [];

    const prizeObj  = rules.prize || {};
    const lottery   = Array.isArray(prizeObj.lottery)   ? prizeObj.lottery   : [];
    const selection = Array.isArray(prizeObj.selection) ? prizeObj.selection : [];

    const fmt = (p) => {
      const label   = String(p?.label ?? '').trim();
      const amount  = Number(p?.amount ?? 0);
      const winners = Number(p?.winners ?? p?.qty ?? 0);
      const yen = amount ? `${amount.toLocaleString()}円` : '';
      const win = winners ? `${winners}名` : '';
      const mid = [yen, win].filter(Boolean).join(' / ');
      return `${label || '賞'}${mid ? `（${mid}）` : ''}`;
    };

    const blocks = [];

    if (lottery.length){
      blocks.push(
        `<div class="campaign-prize-block"><b>【抽選枠】</b><ul class="campaign-prize-list">${
          lottery.map(p=>`<li>${window.escapeHtml_(fmt(p))}</li>`).join('')
        }</ul></div>`
      );
    }
    if (selection.length){
      blocks.push(
        `<div class="campaign-prize-block"><b>【選考枠】</b><ul class="campaign-prize-list">${
          selection.map(p=>`<li>${window.escapeHtml_(fmt(p))}</li>`).join('')
        }</ul></div>`
      );
    }

    if (blocks.length){
      prizesEl.innerHTML = blocks.join('');
      return;
    }

    if (legacy.length){
      prizesEl.innerHTML =
        `<ul class="campaign-prize-list">` +
        legacy.map(p=>`<li>${window.escapeHtml_(p)}</li>`).join('')
        `</ul>`;
      return;
    }

    prizesEl.textContent = '（報酬：準備中）';
  }

  // グローバル公開（あなたの現行open処理から呼べるように）
  window.ensureCampaignDetailModal = window.ensureCampaignDetailModal || ensureCampaignDetailModal_;
  window.setCampaignDetailTags     = window.setCampaignDetailTags     || setCampaignDetailTags_;
  window.setCampaignDetailRules    = window.setCampaignDetailRules    || setCampaignDetailRules_;

  // data-close を共通で効かせる（page24がなくても閉じられるように）
  function bindCloseOnce_(){
    if (window.__campaignModalCloseBound) return;
    window.__campaignModalCloseBound = true;

    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-close]');
      if (!btn) return;
      const id = btn.getAttribute('data-close');
      if (!id) return;
      const m = document.getElementById(id);
      if (m) m.style.display = 'none';
    });
  }

  // DOM準備後にモーダル生成だけは確実に
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureCampaignDetailModal_();
      bindCloseOnce_();
    }, { once:true });
  } else {
    ensureCampaignDetailModal_();
    bindCloseOnce_();
  }

})();
