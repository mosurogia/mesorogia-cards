/*====================
    1.初期設定
=====================*/


/*デッキ状態とカード情報を保持するオブジェクト*/

// デッキ情報　例: { "10001": 2, "10234": 1 }
const deck = {};

// カード情報　例: { "10001": { name: "...", race: "...", type: "...", cost: 3, power: 2, ... }, ... }
const cardMap = {};



// common.js などグローバルに置く
// ローカル開発なら '', GitHub Pages なら '/mesorogia-cards/' などに調整
const BASE_PATH = 'mesorogia-cards';

async function fetchLatestCards() {
  const res = await fetch('public/cards_latest.json'); 
  if (!res.ok) {
    throw new Error(`HTTP error ${res.status} - ${res.statusText}`);
  }
  const allCards = await res.json();
  return allCards.filter(card => card.is_latest === true);
}














// カテゴリ順を定義（番号は飛び飛びでもOK）
const getCategoryOrder = (category) => {
const order = {
"聖焔龍（フォルティア）": 11,
"ドラゴライダー": 12,
"メイドロボ": 21,
"アドミラルシップ": 22,
"テックノイズ": 23,
"ナチュリア": 31,
"鬼刹（きせつ）": 32,
"風花森（ふかしん）":33,
"ロスリス": 41,
"白騎士": 42,
"愚者愚者（ぐしゃぐしゃ）":43,
"昏き霊園": 51,
"マディスキア": 52,
"炎閻魔": 53,
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
