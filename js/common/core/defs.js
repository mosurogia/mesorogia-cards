/* =========================
 * js/common/core/defs.js
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

// ========================
// 共通：日付フォーマット関数 (YYYY/MM/DD)
// ========================
(() => {
  'use strict';
  function formatYmd(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  }
  window.formatYmd = window.formatYmd || formatYmd;
})();

// ========================
// 共通：カードID正規化（5桁）
// ========================
(() => {
  'use strict';

  function normCd5(cd) {
    const s = String(cd ?? '').trim();
    return s ? s.padStart(5, '0').slice(0, 5) : '';
  }

  window.normCd5 = window.normCd5 || normCd5;
})();

// ========================
// 共通：DOM取得ショートハンド
// ========================
// - 互換：既に window.$id が定義されているなら上書きしない
window.$id ??= (id) => document.getElementById(id);

// ローカル判定（共通）
window.IS_LOCAL ??= (
  location.hostname === '127.0.0.1' || location.hostname === 'localhost'
);

// ベースパス（共通）
window.BASE_PATH = window.BASE_PATH ?? '';

// =======================================
// GAS API エンドポイント（共通定義）
// =======================================
window.GAS_API_BASE =
  window.GAS_API_BASE ||
  'https://script.google.com/macros/s/AKfycbwumpl6FvEgX8n8MWv4n9yU-d387BH6UWoZCEKiCyh6nh9VHnX4MVK7bkniOkFuUUqz/exec';

window.DECKPOST_API_BASE ??= window.GAS_API_BASE;
window.AUTH_API_BASE     ??= window.GAS_API_BASE;

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

/**
 * ✅ ここが「リスト集」順の本体（ソース・オブ・トゥルース）
 * 並び順を変えたい時は、この配列の順番だけ変えればOK。
 */
window.CATEGORY_ORDER_LIST ??= [
  // --- 1: ドラゴン枠 ---
    "聖焔龍（フォルティア）",
    "ドラゴライダー",
    "電竜",
    "メロウディア",

    // --- 2: アンドロイド枠 ---
    "メイドロボ",
    "アドミラルシップ",
    "テックノイズ",
    "星装（アストロイ）",

    // --- 3: エレメンタル枠 ---
    "ナチュリア",
    "鬼刹（きせつ）",
    "風花森（ふかしん）",
    "秘饗（バンケット）",
    "アルケミクルス",

    // --- 4: ルミナス枠 ---
    "ロスリス",
    "白騎士",
    "愚者愚者（クラウンクラウド）",
    "蒼ノ刀",
    "歪祝（エヴァル）",


    // --- 5: シェイド枠 ---
    "昏き霊園（スレイヴヤード）",
    "マディスキア",
    "炎閻魔（えんえんま）",
    "ヴァントム",

    // --- その他 ---
    "ノーカテゴリ",
];

/* ✅ カテゴリ→種族（枠線色用）
 * - LISTだけでは race が分からないため “枠” 定義を持つ
 */
window.CATEGORY_GROUPS ??= [
    { race: 'ドラゴン',   list: ["聖焔龍（フォルティア）","ドラゴライダー","電竜","メロウディア"] },
    { race: 'アンドロイド', list: ["メイドロボ","アドミラルシップ","テックノイズ","星装（アストロイ）"
    ] },
    { race: 'エレメンタル', list: ["ナチュリア","鬼刹（きせつ）","風花森（ふかしん）","秘饗（バンケット）","アルケミクルス"] },
    { race: 'ルミナス',   list: ["ロスリス","白騎士","愚者愚者（クラウンクラウド）","蒼ノ刀","歪祝（エヴァル）"] },
    { race: 'シェイド',   list: ["昏き霊園（スレイヴヤード）","マディスキア","炎閻魔（えんえんま）","ヴァントム"] },
    // ノーカテゴリは race なし
];

/**
 * ✅ index再生成（LIST/GROUPSを差し替えた時に呼べる）
 */
window.rebuildCategoryDefs ??= function rebuildCategoryDefs(){
    const list = Array.isArray(window.CATEGORY_ORDER_LIST) ? window.CATEGORY_ORDER_LIST : [];
    const orderMap = {};
    list.forEach((name, idx) => {
        const key = String(name || '').trim();
        if (!key) return;
        orderMap[key] = idx; // 0.. の自然順
    });

    const raceMap = {};
    const groups = Array.isArray(window.CATEGORY_GROUPS) ? window.CATEGORY_GROUPS : [];
    groups.forEach(g => {
        const race = String(g?.race || '').trim();
        const arr  = Array.isArray(g?.list) ? g.list : [];
        if (!race) return;
        arr.forEach(name => {
        const key = String(name || '').trim();
        if (!key) return;
        raceMap[key] = race;
        });
    });

    // 不整合チェック（開発用：消してもOK）
    for (const name of list) {
        const key = String(name || '').trim();
        if (!key || key === 'ノーカテゴリ') continue;
        if (!raceMap[key]) {
        console.warn('[defs] CATEGORY_GROUPS に race 定義がありません:', key);
        }
    }

    window.__CATEGORY_ORDER_INDEX = orderMap;
    window.__CATEGORY_RACE_INDEX  = raceMap;
};

// 初回ビルド
window.rebuildCategoryDefs();

// カテゴリ→種族（枠線色用）
window.getCategoryRace ??= (category) => {
    const key = String(category || '').trim();
    if (!key || key === 'ノーカテゴリ') return null;
    return (window.__CATEGORY_RACE_INDEX || {})[key] || null;
};

// order取得（未定義は最後へ）
window.getCategoryOrder ??= (category) => {
    const key = String(category || '').trim();
    if (!key) return 9999;
    const v = (window.__CATEGORY_ORDER_INDEX || {})[key];
    return (v == null) ? 9999 : v;
};

// 一覧（定義済みカテゴリだけ・順序保証）
window.CATEGORY_LIST ??= (Array.isArray(window.CATEGORY_ORDER_LIST) && window.CATEGORY_ORDER_LIST.length)
    ? window.CATEGORY_ORDER_LIST.slice()
    : [];
