/* =========================
 * common/app-common.js
 * - UI寄りの共通機能 / ストア / API / footer 等
 * ========================= */


// ========================
//ページトップ移動ボタン
// ========================
window.scrollToTop = window.scrollToTop || function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
};


// ========================
//所持データ共通ストア
// ========================
(function (global) {
    const KEY = 'ownedCards';
    const clampInt = (v)=> Math.max(0, (v|0));
    const norm = (e)=> ({ normal: clampInt(e?.normal), shine: clampInt(e?.shine), premium: clampInt(e?.premium) });

    let cache;
    let autosave = true;
    let dirty = false;

    function persist() {
        try { localStorage.setItem(KEY, JSON.stringify(cache)); }
        catch (e) { console.error('ownedCards の保存に失敗:', e); }
    }

    try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { cache = {}; }

    const listeners = new Set();
    const emit = () => {
        dirty = true;
        listeners.forEach(fn => fn(cache));
        if (autosave) persist();
    };

    window.addEventListener('storage', (e) => {
        if (e.key === KEY) {
        try { cache = JSON.parse(e.newValue || '{}') || {}; } catch { cache = {}; }
        listeners.forEach(fn => fn(cache));
        }
    });

    const OwnedStore = {
        getAll() { return JSON.parse(JSON.stringify(cache)); },
        get(cd)  { cd = String(cd); return norm(cache[cd] || {normal:0,shine:0,premium:0}); },
        set(cd, entry) { cache[String(cd)] = norm(entry); emit(); },

        inc(cd, edition='normal', delta=1) {
        cd = String(cd);
        const e = this.get(cd);
        e[edition] = clampInt(e[edition] + (delta|0));
        cache[cd] = e; emit();
        },

        replace(all) {
        cache = {};
        for (const cd in all) cache[cd] = norm(all[cd]);
        emit();
        },

        resetExcess(cards) {
        const byCd = new Map(cards.map(c => [String(c.cd), c]));
        for (const cd in cache) {
            const info = byCd.get(String(cd));
            const limit = info && String(info.race).includes('旧神') ? 1 : 3;
            const e = cache[cd] || {normal:0,shine:0,premium:0};
            e.normal  = Math.min(e.normal  || 0, limit);
            e.shine   = Math.min(e.shine   || 0, limit);
            e.premium = Math.min(e.premium || 0, limit);
            cache[cd] = e;
        }
        emit();
        },

        clampForChecker(cards) {
        const byCd = new Map(cards.map(c => [String(c.cd), c]));
        const next = {};
        for (const cd in cache) {
            const e = cache[cd] || {normal:0,shine:0,premium:0};
            const sum = (e.normal|0)+(e.shine|0)+(e.premium|0);
            if (sum <= 0) continue;
            const info = byCd.get(String(cd));
            const limit = info && String(info.race).includes('旧神') ? 1 : 3;
            next[cd] = { normal: Math.min(sum, limit), shine: 0, premium: 0 };
        }
        this.replace(next);
        },

        setAutosave(v) { autosave = !!v; },
        save() { persist(); dirty = false; },
        isDirty() { return dirty; },

        reload() {
        try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
        catch { cache = {}; }
        dirty = false;
        listeners.forEach(fn => fn(cache));
        },

        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };

    global.OwnedStore = global.OwnedStore || OwnedStore;
})(window);


// ========================
// キャンペーン
// ========================
(function(){
    let _campCache = { t:0, v:null };

    window.fetchActiveCampaign = async function fetchActiveCampaign(opts = {}){
        const ttlMs = Number(opts.ttlMs || 30000);
        const now = Date.now();
        if (_campCache.v && (now - _campCache.t) < ttlMs) return _campCache.v;

        const base = window.DECKPOST_API_BASE || window.GAS_API_BASE;
        if (!base) return null;

        try{
        const res = await fetch(`${base}?mode=campaignGetActive`, {
            method : 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body   : JSON.stringify({}),
        });
        const json = await res.json();
        const camp = (json && json.ok) ? (json.campaign || null) : null;
        _campCache = { t: now, v: camp };
        return camp;
        }catch(_){
        return null;
        }
    };
})();


// ========================
//フッター：フィードバックURL自動付与
// ========================
(function(){
    const FORM_ID = '1FAIpQLSdB-MkMc0AxNWdlZ1PX-62nj-wINtn0C34-Pj4ykXwceAWtEg';
    const FORM_BASE = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform?usp=pp_url`;
    const ENTRY_URL = 'entry.1634483845';

    function buildFeedbackUrl_(){
        const u = new URL(FORM_BASE);
        u.searchParams.set(ENTRY_URL, location.href);
        return u.toString();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const a = document.querySelector('a.footer-feedback');
        if (a) a.href = buildFeedbackUrl_();
    });
})();
