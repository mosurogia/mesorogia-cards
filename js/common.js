/*====================
    1.初期設定
=====================*/


/*デッキ状態とカード情報を保持するオブジェクト*/

// デッキ情報　例: { "10001": 2, "10234": 1 }
const deck = {};

// カード情報　例: { "10001": { name: "...", race: "...", type: "...", cost: 3, power: 2, ... }, ... }
const cardMap = {};

// ここで window に公開
window.deck = deck;
window.cardMap = cardMap;

// ========================
// 共通：HTMLエスケープ
// ========================
window.escapeHtml_ = window.escapeHtml_ || function (s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
};

// 旧互換（escapeHtml を使っている箇所があっても落ちない）
window.escapeHtml = window.escapeHtml || window.escapeHtml_;



// common.js などグローバルに置く
// ローカル開発なら '', GitHub Pages なら '/mesorogia-cards/' などに調整
const BASE_PATH = '';

// =======================================
// GAS API エンドポイント（共通定義）
// =======================================
// 今後 URL を変更したいときは、基本的にここの値だけ変えればOK。
window.GAS_API_BASE =
  window.GAS_API_BASE ||
  'https://script.google.com/macros/s/AKfycbyOdtj9u9ZW1hXgQIXDPmXc_kOY5B9lcVHpSDAa4-4uonmR12DxVdQqtSI3R8t7quRK/exec';

// 用途別のエイリアス（必要なら今後増やしてOK）
window.DECKPOST_API_BASE = window.DECKPOST_API_BASE || window.GAS_API_BASE; // デッキ投稿・一覧など
window.AUTH_API_BASE     = window.AUTH_API_BASE     || window.GAS_API_BASE; // 認証（ログイン/登録など）


async function fetchLatestCards() {
  const res = await fetch('./public/cards_latest.json');
  if (!res.ok) {
    throw new Error(`HTTP error ${res.status} - ${res.statusText}`);
  }
  const allCards = await res.json();
  return allCards.filter(card => card.is_latest === true);
}

// =======================================
// カードマスタ → cardMap 構築（共通）
// =======================================
function buildCardMapFromCards(cards){
  if (!Array.isArray(cards)) return;

  for (const card of cards){
    const cdRaw = card.cd ?? card.id ?? '';
    const cd5   = String(cdRaw || '').trim().padStart(5, '0');
    if (!cd5) continue;

    // 必要そうな情報だけ拾う。足りなければ適宜追加OK
    window.cardMap[cd5] = {
      cd     : cd5,
      name   : card.name   || '',
      race   : card.race   || '',
      type   : card.type   || '',
      cost   : Number(card.cost  ?? 0) || 0,
      power  : Number(card.power ?? 0) || 0,
      rarity : card.rarity || '',
      packName : card.pack_name || '',
      category : card.category  || '',
      effect_name1: card.effect_name1 || '',
      effect_text1: card.effect_text1 || '',
      effect_name2: card.effect_name2 || '',
      effect_text2: card.effect_text2 || '',
    };
  }
}

// 一度だけカードマスタを読み込んで cardMap を埋める
async function ensureCardMapLoaded(){
  // すでに埋まっていれば何もしない
  if (window.cardMap && Object.keys(window.cardMap).length > 0){
    return window.cardMap;
  }

  try{
    const cards = await fetchLatestCards(); // 既存の共通関数
    buildCardMapFromCards(cards);
  }catch(e){
    console.error('ensureCardMapLoaded: カードマスタ読み込み失敗', e);
  }
  return window.cardMap;
}

// グローバル公開
window.ensureCardMapLoaded = ensureCardMapLoaded;


// パック一覧を読み出して共通利用（card_data.py が packs.json を出す想定）
let __PackCatalog = null;
/**
 * 返り値:
 * {
 *   list: [{ key, en, jp, slug, labelTwoLine }, ...] // 表示順でソート済み
 *   byEn:  Map(en -> item)
 *   order: string[] // en の表示順
 * }
 */
function splitPackName(name='') {
  const s = String(name);
  if (s.includes('「')) {
    const i = s.indexOf('「');
    return { en: s.slice(0, i).trim(), jp: s.slice(i).trim() };
  }
  if (s.includes('／')) {
    const [en, jp=''] = s.split('／');
    return { en: en.trim(), jp: jp.trim() ? `「${jp.trim()}」` : '' };
  }
  return { en: s.trim(), jp: '' };
}
function makePackSlug(en='') {
  const base = String(en || '').trim();
  const ascii = base.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  // 英字が1文字も無い（=日本語など）と空になるのでフォールバックで元文字列を返す
  return ascii || base;
}
async function loadPackCatalog() {
  if (window.__PackCatalog) return window.__PackCatalog;
  try {
    const res2 = await fetch('./public/packs.json', { cache: 'no-store' });
if (!res2.ok) throw new Error(`HTTP ${res2.status}`);

    const raw = await res2.json();
    // どちらの形式でも受け付ける:
    // A) { "packs": [ ... ], "order": [...] } ← 新しい生成スクリプト
    // B) { "list":  [ ... ], "order": [...] } ← 以前の手作業ファイル
    const arr   = Array.isArray(raw.packs) ? raw.packs : (Array.isArray(raw.list) ? raw.list : []);
    const order = Array.isArray(raw.order) ? raw.order : null;

    const list = arr.map(p => {
      const enRaw = (p.en ?? '').trim();
      const jpRaw = (p.jp ?? '').trim();
      // en が未入力で jp 側だけある場合でも表示できるように補正
      const en  = enRaw || (jpRaw ? jpRaw.replace(/[「」]/g,'') : '');
      const jp  = jpRaw || '';
      // slug/key は与えられていれば尊重。無ければ makePackSlug から作る
      const slug = p.slug || makePackSlug(en);
      const key  = p.key  || slug;
      return {
        key, en, jp, slug,
        labelTwoLine: `${en}${jp ? `\n${jp}` : ''}`
      };
    });

    const byEn  = new Map(list.map(x => [x.en, x]));
    const ord   = order && order.length ? order : list.map(x => x.en);

    window.__PackCatalog = { list, byEn, order: ord };
    return window.__PackCatalog;

  } catch (e) {
    console.warn('packs.json 読み込み失敗→cards_latest.jsonから検出にフォールバック', e);
    const cards = await fetchLatestCards();
    const byEn = new Map();
    cards.forEach(c => {
      const { en, jp } = splitPackName(c.pack_name || '');
      if (en && !byEn.has(en)) byEn.set(en, { en, jp, slug: makePackSlug(en) });
    });
    const list = [...byEn.values()].sort((a,b)=>a.en.localeCompare(b.en,'ja'));
    list.forEach(x => { x.key = x.slug; x.labelTwoLine = `${x.en}${x.jp?`\n${x.jp}`:''}`; });
    const order = list.map(x => x.en);
    window.__PackCatalog = { list, byEn: new Map(list.map(x=>[x.en,x])), order };
    return window.__PackCatalog;
  }
}


// ここで window に公開
window.splitPackName   = splitPackName;
window.makePackSlug    = makePackSlug;
window.loadPackCatalog = loadPackCatalog;

// ========================
// 投稿・デッキ共通：タグ定義
// ========================
window.POST_TAG_CANDIDATES ??= [
  "初心者向け",
  "趣味構築",
  "ランク戦用",
  "大会入賞",
  "格安デッキ",
  "回廊用"
];


// カテゴリ順を定義（番号は飛び飛びでもOK）
const getCategoryOrder = (category) => {
const order = {
"聖焔龍（フォルティア）": 11,
"ドラゴライダー": 12,
"電竜": 13,
"メロウディア": 14,
"メイドロボ": 21,
"アドミラルシップ": 22,
"テックノイズ": 23,
"ナチュリア": 31,
"鬼刹（きせつ）": 32,
"風花森（ふかしん）":33,
"秘饗（バンケット）": 34,
"ロスリス": 41,
"白騎士": 42,
"愚者愚者（クラウンクラウド）":43,
"蒼ノ刀": 44,
"昏き霊園（スレイヴヤード）": 51,
"マディスキア": 52,
"炎閻魔（えんえんま）": 53,
"ノーカテゴリ": 999
};
return order[category] ?? 9999;
};

// タイプ順を定義
const getTypeOrder = (type) => {
if (type === "チャージャー") return 0;
if (type === "アタッカー") return 1;
if (type === "ブロッカー") return 2;
return 3;
};



//ページトップ移動ボタン
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}





// 一覧のカードをソート
function sortCards() {
  const sortValue = document.getElementById("sort-select").value;
  const grid = document.getElementById("grid");
  const cards = Array.from(grid.children).filter(card => card.classList.contains("card"));

  cards.sort((a, b) => {
    const typeA = getTypeOrder(a.dataset.type);
    const typeB = getTypeOrder(b.dataset.type);
    const costA = parseInt(a.dataset.cost);
    const costB = parseInt(b.dataset.cost);
    const powerA = parseInt(a.dataset.power);
    const powerB = parseInt(b.dataset.power);
    const cdA = parseInt(a.dataset.cd);
    const cdB = parseInt(b.dataset.cd);
    const catA = getCategoryOrder(a.dataset.category);
    const catB = getCategoryOrder(b.dataset.category);

    switch (sortValue) {
      case "cost-asc":
        return costA - costB || typeA - typeB || powerA - powerB || cdA - cdB;
      case "cost-desc":
        return costB - costA || typeA - typeB || powerA - powerB || cdA - cdB;
      case "power-asc":
        return powerA - powerB || typeA - typeB || costA - costB || cdA - cdB;
      case "power-desc":
        return powerB - powerA || typeA - typeB || costA - costB || cdA - cdB;
      case "category-order":
        return catA - catB || typeA - typeB || costA - costB || powerA - powerB || cdA - cdB;
      case "rarity-order":
        const rarityOrder = { "レジェンド": 0, "ゴールド": 1, "シルバー": 2, "ブロンズ": 3 };
        const rA = rarityOrder[a.dataset.rarity] ?? 99;
        const rB = rarityOrder[b.dataset.rarity] ?? 99;
        return rA - rB || costA - costB || powerA - powerB || cdA - cdB;
      default:
        return typeA - typeB || costA - costB || powerA - powerB || cdA - cdB;
    }
  });

  cards.forEach(card => grid.appendChild(card));
}



/* === 所持データ共通ストア ===*/
(function (global) {
  //所持データ変数
    const KEY = 'ownedCards';
  //エディション変数
    const clampInt = (v)=> Math.max(0, (v|0));
    const norm = (e)=> ({ normal: clampInt(e?.normal), shine: clampInt(e?.shine), premium: clampInt(e?.premium) });

  let cache;
  let autosave = true;   // 既定は従来通り「自動保存ON」。page3.jsでfalseに切り替える
  let dirty = false;     // 未保存フラグ

  function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); }
  catch (e) { console.error('ownedCards の保存に失敗:', e); }
}

  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { cache = {}; }

  const listeners = new Set();
  const emit = () => {
  dirty = true;                          // 何か変わった → 未保存
  listeners.forEach(fn => fn(cache));    // UIは即通知
  if (autosave) persist();               // 自動保存ONのときだけ書き込む
};

  // 外部タブ同期
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      try { cache = JSON.parse(e.newValue || '{}') || {}; } catch { cache = {}; }
      listeners.forEach(fn => fn(cache));
    }
  });

  const OwnedStore = {

  //キャッシュデータコピー（所持データがすぐに変わらないように）
    getAll() { return JSON.parse(JSON.stringify(cache)); },
  //カード所持データの取得（各エディション）
    get(cd)  { cd = String(cd); return norm(cache[cd] || {normal:0,shine:0,premium:0}); },
  //そのまま置き換え
    set(cd, entry) { cache[String(cd)] = norm(entry); emit(); },

  //最小限の差分更新
    inc(cd, edition='normal', delta=1) {
      cd = String(cd);
      const e = this.get(cd);
      e[edition] = clampInt(e[edition] + (delta|0));
      cache[cd] = e; emit();
    },
  //全置換
    replace(all) {
      cache = {};
      for (const cd in all) cache[cd] = norm(all[cd]);
      emit();
    },

    // 余剰分を制限（旧神=1, それ以外=3）までで丸める
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

    // チェッカー向けに「合計→制限でクランプ」した形へ差し替える
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


    // 自動保存のON/OFFを切り替え
  setAutosave(v) { autosave = !!v; },

  // 今の cache を localStorage に保存して未保存フラグを戻す
  save() { persist(); dirty = false; },

  // 未保存かどうか（離脱警告などに使う）
  isDirty() { return dirty; },

  // ストレージの内容で cache を読み直してから通知
  reload() {
    try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
    catch { cache = {}; }
    dirty = false;
    listeners.forEach(fn => fn(cache));
  },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  global.OwnedStore = OwnedStore;
})(window);


/*====================
    キャンペーン（フロント共通）
=====================*/

// 開催中キャンペーンを取得（GAS: mode=campaignGetActive）
// - deckmaker / deck-post どちらでも使うため common.js に置く
// - 30秒キャッシュ
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
        body   : JSON.stringify({}), // bodyは空でOK（modeはクエリで渡す）
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

