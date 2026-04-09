/* =========================
 * js/common/core/app-common.js
 * - UI寄りの共通機能 / API / footer 等
 * ========================= */

// ========================
// ページトップ移動ボタン
// ========================
window.scrollToTop = window.scrollToTop || function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ========================
// キャンペーン
// ========================
(function () {
    let _campCache = { t: 0, v: null };

    window.fetchActiveCampaign = async function fetchActiveCampaign(opts = {}) {
        const ttlMs = Number(opts.ttlMs || 30000);
        const now = Date.now();

        if (_campCache.v && (now - _campCache.t) < ttlMs) return _campCache.v;

        const base = window.DECKPOST_API_BASE || window.GAS_API_BASE;
        if (!base) return null;

        try {
            const res = await fetch(`${base}?mode=campaignGetActive`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: JSON.stringify({}),
            });

            const json = await res.json();
            const camp = json && json.ok ? (json.campaign || null) : null;

            _campCache = { t: now, v: camp };
            return camp;
        } catch (_) {
            return null;
        }
    };
})();

// ========================
// フッター：フィードバックURL自動付与
// フォームのURLを直接埋めるとGoogle側でスパムと判定されるため、jsで動的に生成してセットする
// ========================
(function () {
    const FORM_ID = '1FAIpQLSdB-MkMc0AxNWdlZ1PX-62nj-wINtn0C34-Pj4ykXwceAWtEg';
    const FORM_BASE = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform?usp=pp_url`;
    const ENTRY_URL = 'entry.1634483845';

    function buildFeedbackUrl_() {
        const u = new URL(FORM_BASE);
        u.searchParams.set(ENTRY_URL, location.href);
        return u.toString();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const a = document.querySelector('a.footer-feedback');
        if (a) a.href = buildFeedbackUrl_();
    });
})();