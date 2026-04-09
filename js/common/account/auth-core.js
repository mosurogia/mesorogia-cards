/* =========================
 * auth/auth-core.js
 * - 認証のコア（状態/トークン/通信）
 * - UIは触らない（auth-ui.js が担当）
 * - 依存：defs.js（AUTH_API_BASE / GAS_API_BASE）
 * 公開：
 *   - window.Auth
 *   - window.postJSON
 *   - window.API（互換）
 * - 文字列ユーティリティ（X handle / メアド混入対策）
 * 公開：
 *   - window.normalizeHandle
 *   - window.isValidXHandle
 *   - window.isEmailLikeName_
 * ========================= */

//====================
//認証のコア
//====================
(function(){
    // API base（互換のため window.API も残す）
    const API = window.AUTH_API_BASE || window.GAS_API_BASE;
    window.API = API;

    const LS_TOKEN = 'mos_auth_token_v1';

    async function postJSON(url, payload){
        const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
        body: JSON.stringify(payload || {})
        });

        const text = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);

        try { return JSON.parse(text); }
        catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}`); }
    }
    window.postJSON = window.postJSON || postJSON;

    const Auth = {
        user: null,
        token: null,
        verified: false,

        setDisplayName(name){
        if (!this.user) return;
        this.user.displayName = name || this.user.displayName;
        window.reflectLoginUI?.();
        },

        async whoami(){
        if (!this.token) {
            this._clear();
            window.reflectLoginUI?.();
            return { ok:false };
        }

        // UI側のスピナー（無いページでも落ちないように）
        if (typeof window.setAuthChecking !== 'function') {
            window.setAuthChecking = function(){ /* no-op */ };
        }

        window.setAuthChecking?.(true);
        try{
            const res = await postJSON(`${API}?mode=whoami`, { token: this.token });
            if (!res?.ok || !res.user){
            this._clear();
            window.reflectLoginUI?.();
            return { ok:false };
            }
            this._save(res.user, this.token);
            this.verified = true;
            window.reflectLoginUI?.();
            return { ok:true, user: res.user };
        } finally {
            window.setAuthChecking?.(false);
        }
        },

        async init(){
        this.user = null;
        this.token = localStorage.getItem(LS_TOKEN) || null;
        this.verified = false;
        window.reflectLoginUI?.();

        if (this.token) {
            await this.whoami(); // verified=true になる
        }
        },

        async signup(username, password, displayName='', x=''){
        const res = await postJSON(`${API}?mode=signup`, {username, password, displayName, x});
        if (!res?.ok) throw new Error(res?.error || 'signup failed');
        this._save(res.user, res.token);
        window.reflectLoginUI?.();
        return res.user;
        },

        async login(username, password){
        const res = await postJSON(`${API}?mode=login`, {
            username,
            password,
        });
        if (!res?.ok) throw new Error(res?.error || 'login failed');

        this.user = res.user;
        this.token = res.token;
        this.verified = true;

        localStorage.setItem(LS_TOKEN, this.token);
        window.reflectLoginUI?.();

        return res.user;
        },

        async logout(){
        try { await postJSON(`${API}?mode=logout`, { token:this.token }); } catch(_){}
        this._clear();
        window.reflectLoginUI?.();
        },

        attachToken(body){ return Object.assign({}, body, { token: this.token || '' }); },

        _save(user, token){
        this.user = user || null;
        this.token = token || null;
        this.verified = !!(user && token);

        if (this.token) localStorage.setItem(LS_TOKEN, this.token);
        else localStorage.removeItem(LS_TOKEN);
        },

        _clear(){
        this.user = null;
        this.token = null;
        this.verified = false;
        localStorage.removeItem(LS_TOKEN);
        },
    };

    window.Auth = window.Auth || Auth;
})();


//====================
//文字列ユーティリティ
//====================
(function(){
    function normalizeHandle(raw){
        let s = String(raw || '').trim();
        if (!s) return '';

        // 全角→半角（＠含む） + 空白除去
        try { s = s.normalize('NFKC'); } catch(_) {}
        s = s.replace(/\s+/g, '');

        // URL貼り付け対策
        s = s.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i, '');

        // クエリ/パス除去
        s = s.split(/[/?#]/)[0];

        // @ は全部消して、先頭に1個だけ付け直す
        s = s.replace(/[＠@]/g, '');

        if (!s) return '';
        return '@' + s;
    }

    function isValidXHandle(handle){
        const h = String(handle || '').trim();
        // @ + 英数/_ 1〜15文字
        return /^@[A-Za-z0-9_]{1,15}$/.test(h);
    }

    function isEmailLikeName_(s){
        const v = String(s || '').trim();
        if (!v) return false;
        if (/^mailto:/i.test(v)) return true;
        if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(v)) return true;
        return false;
    }

    window.normalizeHandle  = window.normalizeHandle  || normalizeHandle;
    window.isValidXHandle   = window.isValidXHandle   || isValidXHandle;
    window.isEmailLikeName_ = window.isEmailLikeName_ || isEmailLikeName_;
    })();

