/* =========================
 * common/defs.js
 * - 定数・定義・順序・共通ユーティリティ
 * ========================= */

// ========================
// 共通：HTMLエスケープ（堅牢版）
// ========================
(function () {
    'use strict';

    function escapeHtml_(s) {
        return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    window.escapeHtml_ = window.escapeHtml_ || escapeHtml_;
    window.escapeHtml  = window.escapeHtml  || window.escapeHtml_;
})();


// ローカル開発なら '', GitHub Pages なら '/mesorogia-cards/' などに調整
window.BASE_PATH = window.BASE_PATH ?? '';

// =======================================
// GAS API エンドポイント（共通定義）
// =======================================
window.GAS_API_BASE =
    window.GAS_API_BASE ||
    'https://script.google.com/macros/s/AKfycbyrP6JB6TUl-Nj0czIvXRJNZp91K50aGCVdkLhUieA1sftlyVYbhD1PJ-WUmqCLd6Nw/exec';

window.DECKPOST_API_BASE = window.DECKPOST_API_BASE || window.GAS_API_BASE;
window.AUTH_API_BASE     = window.AUTH_API_BASE     || window.GAS_API_BASE;

// ========================
// 投稿・デッキ共通：タグ定義
// ========================
window.POST_TAG_CANDIDATES ??= [
    "初心者向け",
    "趣味構築",
    "ランク戦用",
    "大会入賞",
    "格安デッキ",
    "回廊用",
    "10スタン",
    "LOデッキ",
    "アグロデッキ",
];

// ========================
// 種族表示順（共通）
// ========================
window.RACE_ORDER_all ??= ['ドラゴン','アンドロイド','エレメンタル','ルミナス','シェイド','イノセント','旧神'];
window.RACE_ORDER ??= ['ドラゴン','アンドロイド','エレメンタル','ルミナス','シェイド'];

// ========================
// カテゴリ順（唯一の定義）
// ========================
window.CATEGORY_ORDER_MAP ??= {
    "聖焔龍（フォルティア）": 11,
    "ドラゴライダー": 12,
    "電竜": 13,
    "メロウディア": 14,
    "メイドロボ": 21,
    "アドミラルシップ": 22,
    "テックノイズ": 23,
    "ナチュリア": 31,
    "鬼刹（きせつ）": 32,
    "風花森（ふかしん）": 33,
    "秘饗（バンケット）": 34,
    "ロスリス": 41,
    "白騎士": 42,
    "愚者愚者（クラウンクラウド）": 43,
    "蒼ノ刀": 44,
    "昏き霊園（スレイヴヤード）": 51,
    "マディスキア": 52,
    "炎閻魔（えんえんま）": 53,
    "ヴァントム": 54,
    "ノーカテゴリ": 999,
};

// カテゴリ→種族（枠線色用）
window.getCategoryRace ??= (category) => {
    const code = (window.CATEGORY_ORDER_MAP || {})[String(category || '').trim()];
    if (!code || code === 999) return null;

    const tens = Math.floor(Number(code) / 10); // 1..5
    const idx  = tens - 1;                      // 0..4
    const order = Array.isArray(window.RACE_ORDER) ? window.RACE_ORDER : [];
    return order[idx] || null;
};

// order取得（未定義は最後へ）
window.getCategoryOrder ??= (category) => {
    const m = window.CATEGORY_ORDER_MAP || {};
    return m[String(category || '').trim()] ?? 9999;
};

// 一覧（定義済みカテゴリだけ・順序保証）
window.CATEGORY_LIST ??= Object.keys(window.CATEGORY_ORDER_MAP)
    .sort((a,b) => window.getCategoryOrder(a) - window.getCategoryOrder(b));
