/*==================
      1.初期設定
===================*/


// ▼ どのページでも安全に所持データを読むヘルパ
function readOwnedDataSafe() {
  // OwnedStore 優先
  try {
    if (window.OwnedStore?.getAll) {
      const s = window.OwnedStore.getAll();
      if (s && typeof s === 'object') return s;
    }
  } catch {}
  // localStorage フォールバック
  try {
    const raw = localStorage.getItem('ownedCards');
    const obj = raw ? JSON.parse(raw) : {};
    if (obj && typeof obj === 'object') return obj;
  } catch {}
  return {};
}




//全カード情報
const allCardsMap = {};
window.allCardsMap = allCardsMap;

/*====================
      2.カード詳細
====================*/

//カード詳細情報🔎ボタン
  function handleZoomClick(event, el) {
    event.stopPropagation();
    event.preventDefault();
    const cardEl = el.closest('.card');
    expandCard(cardEl);
  }

//カード詳細展開
function expandCard(clickedCard) {
  const cd = clickedCard.getAttribute('data-cd');
  const grid = document.getElementById('grid');
  const existing = document.querySelector('.card-detail.active');

  if (existing && existing.getAttribute('data-cd') === cd) {
    existing.remove();
    return;
  }

  if (existing) existing.remove();

  const detail = document.getElementById('detail-' + cd);
  if (!detail) return;

  const cloned = detail.cloneNode(true);
  cloned.style.display = 'block';
  cloned.classList.add('active');
  cloned.setAttribute('data-cd', cd);

  const cards = Array.from(grid.children).filter(
    c => c.classList.contains("card") && c.style.display !== "none"
  );
  const clickedIndex = cards.indexOf(clickedCard);

  let columns = 7;
  if (grid.clientWidth < 768) columns = 4;
  else if (grid.clientWidth < 1024) columns = 5;

  const rowStart = Math.floor(clickedIndex / columns) * columns;
  const rowEnd = Math.min(rowStart + columns - 1, cards.length - 1);
  const insertAfter = cards[rowEnd];
  insertAfter.insertAdjacentElement('afterend', cloned);
}

// 実行関数
async function loadCards() {
  const cards = await fetchLatestCards();
  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  cards.forEach(card => {
    // 一覧用カード生成
    const cardElement = generateCardListElement(card);
    grid.appendChild(cardElement);

    // 詳細パネル生成
    const detailHtml = generateDetailHtml(card);
    grid.insertAdjacentHTML('beforeend', detailHtml);

    // ← カードをマップに登録
    allCardsMap[card.cd] = card;
  });

  sortCards(); // 任意：並び替え
  if (typeof window.rebuildCardMap === 'function') {
    rebuildCardMap(); //カード一覧再読み込み
  }
  // カード読み込み完了後に deckmaker 側へ通知
if (typeof window.onCardsLoaded === 'function') {
  window.onCardsLoaded();
}
}


//カード拡大モーダル（長押し）
(function(){
  const modal = () => document.getElementById('cardZoomModal');
  const $ = (id) => document.getElementById(id);

  // cd→カード情報を探す（page1.js は allCardsMap、page2.js は cardMap）
  function findCardByCd(cd){
    cd = String(cd);
    if (window.allCardsMap && window.allCardsMap[cd]) return window.allCardsMap[cd];
    if (window.cardMap && window.cardMap[cd]) return { cd, ...window.cardMap[cd] };
    return null;
  }

// （IIFE内）画像のみ版
function openCardZoom(cd){
  const m = document.getElementById('cardZoomModal'); if (!m) return;
  const img = document.getElementById('zoomImage');   if (!img) return;

  img.src = `img/${cd}.webp`;
  img.onerror = function(){
    if (this.dataset.fallbackApplied) return;
    this.dataset.fallbackApplied = '1';
    this.src = 'img/00000.webp';
  };

  m.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}


  function closeCardZoom(){
    const m = modal(); if (!m) return;
    m.style.display = 'none';
    document.body.style.overflow = '';
  }

  // 背景タップ/×/ESCで閉じる
  document.addEventListener('click', (e)=>{
    const m = modal(); if (!m || m.style.display !== 'flex') return;
    if (e.target === m) closeCardZoom();
  });
  document.addEventListener('keydown', (e)=>{
    const m = modal(); if (!m || m.style.display !== 'flex') return;
    if (e.key === 'Escape') closeCardZoom();
  });
  const closeBtn = document.getElementById('cardZoomClose');
  if (closeBtn) closeBtn.addEventListener('click', closeCardZoom);

  // #grid 配下の .card に長押しをバインド
  function bindLongPressForCards(context){
    const root = document.getElementById('grid');
    if (!root) return;

    let timer = null, startX=0, startY=0, moved=false;
    const LONG_MS = 380;   // 体感よいしきい値（350〜450ms 推奨）
    const MOVE_TOL = 8;    // 長押し中の許容移動

    root.addEventListener('touchstart', (ev)=>{
      const t = ev.target.closest('.card');
      if (!t) return;
      const touch = ev.touches[0];
      startX = touch.clientX; startY = touch.clientY; moved = false;

      const cd = t.dataset.cd;
      clearTimeout(timer);
      timer = setTimeout(()=>{ openCardZoom(cd, context); }, LONG_MS);
    }, {passive:true});

    root.addEventListener('touchmove', (ev)=>{
      const touch = ev.touches[0];
      if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > MOVE_TOL){
        moved = true; clearTimeout(timer);
      }
    }, {passive:true});

    root.addEventListener('touchend', ()=>{
      if (!moved){ /* タップは既存のonclick(=行間展開)へ任せる */ }
      clearTimeout(timer);
    }, {passive:true});

    root.addEventListener('touchcancel', ()=> clearTimeout(timer), {passive:true});

  }

  // 公開（各ページで呼ぶ）
  window.__bindLongPressForCards = bindLongPressForCards;
})();

/*============================
      3.フィルター生成・表示
==========================*/
//#region
  // ✅ フィルターモーダルを開く
  function openFilterModal() {
    document.getElementById("filterModal").style.display = "flex";
  }


  // ✅ フィルターモーダルを閉じる
  function closeFilterModal() {
    document.getElementById("filterModal").style.display = "none";
  }

  // ✅モーダル制御（外クリック / ESC）
  document.addEventListener("click", function (e) {
    const modal = document.getElementById("filterModal");
    if (e.target === modal) closeFilterModal();
  });



  // ✅ 詳細フィルターをトグル
  function toggleDetailFilters() {
    const detail = document.getElementById("detail-filters");
    detail.style.display = (detail.style.display === "none") ? "block" : "none";
  }

    document.addEventListener("keydown", function (e) {
      const modal = document.getElementById("filterModal");
      if (e.key === "Escape" && modal && modal.style.display === "flex") {
        closeFilterModal();
      }
    });

//フィルターボタン名命名
// 🔁 ボタン表示用のラベル変換マップ
const DISPLAY_LABELS = {
  // BP
  true: 'BPあり',
  false: 'BPなし',


  // その他条件
  draw: 'ドロー',
  graveyard_recovery: '墓地回収',
  cardsearch: 'サーチ',
  destroy_opponent: '相手破壊',
  destroy_self: '自己破壊',
  heal: '回復',
  power_up: 'バフ',
  power_down: 'デバフ',
};

// フィルター生成
async function generateFilterUI() {
  const cards = await fetchLatestCards();
  const mainFilters = document.getElementById('main-filters');
  const detailFilters = document.getElementById('detail-filters');

  const getUniqueValues = (key) => [...new Set(cards.map(card => card[key]).filter(Boolean))];

  // カテゴリは順付きで取得（順序定義は common.js の getCategoryOrder を使う）
  const categories = getUniqueValues("category").sort((a, b) => getCategoryOrder(a) - getCategoryOrder(b));

  // その他データ
  const races = getUniqueValues("race");

  const costs = [...new Set(cards.map(card => parseInt(card.cost)).filter(Number.isFinite))].sort((a, b) => a - b);
  const powers = [...new Set(cards.map(card => parseInt(card.power)).filter(Number.isFinite))].sort((a, b) => a - b);
  const types = ['チャージャー', 'アタッカー', 'ブロッカー'];
  const rarities = ['レジェンド', 'ゴールド', 'シルバー', 'ブロンズ'];

  // ===== パック名（英名＋仮名の2行表示、英名でフィルター） =====
  // 共通カタログが読めたらそれを優先。だめなら従来の packs からフォールバック。
  let packCatalog = null;
  try {
    packCatalog = await window.loadPackCatalog(); // common.js のやつ
  } catch {}

  // 英名→仮名の対応をグローバルに持っておく（チップ表示にも使う）
  window.__PACK_EN_TO_JP = {};

  const packWrapper = document.createElement('div');
  packWrapper.className = 'filter-block';

  const packTitle = document.createElement('strong');
  packTitle.className = 'filter-title';
  packTitle.textContent = 'パック名';
  packWrapper.appendChild(packTitle);

  const packGroup = document.createElement('div');
  packGroup.className = 'filter-group';
  packGroup.dataset.key = 'パック名';

  // ① カタログがある場合：その順でボタン化
    if (packCatalog && Array.isArray(packCatalog.list)) {
    // packs.json の順序でボタン生成
    packCatalog.list.forEach(p => {
      const en = p.en || '';
      const jp = p.jp || '';
      if (!en) return;
      window.__PACK_EN_TO_JP[en] = jp;

      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.type = 'button';
      // ★ 絞り込みキーは英名（cards_latest.json の pack_name を split した en と一致）
      btn.dataset.pack = en;
      // 表示は 2 行
      btn.innerHTML = `<span class="pack-en">${en}</span><br><small class="pack-kana">${jp}</small>`;
      packGroup.appendChild(btn);
    });
  } else {
    // ② フォールバック：JSON上の pack_name を英名/仮名に割ってアルファベット順
    const packsRaw = getUniqueValues('pack_name');
    const splitPackLabel = (s) => {
      const m = String(s||'').match(/^([^「]+)(?:「([^」]*)」)?/);
      return { en: (m?.[1]||'').trim(), jp: (m?.[2]||'').trim() };
    };
    const uniq = [...new Map(packsRaw.map(n => {
      const sp = splitPackLabel(n);
      return [sp.en, sp]; // 英名でユニーク化
    })).values()].sort((a,b) => a.en.localeCompare(b.en,'en'));

    uniq.forEach(sp => {
      window.__PACK_EN_TO_JP[sp.en] = sp.jp;

      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.type = 'button';
      btn.dataset.pack = sp.en; // ★ 英名
      btn.innerHTML = `<span class="pack-en">${sp.en}</span><br><small class="pack-kana">${sp.jp}</small>`;
      packGroup.appendChild(btn);
    });
  }

  packWrapper.appendChild(packGroup);




// 効果名（textEffect1 + textEffect2 を統合）
const effect_name = [...new Set(
  cards.flatMap(card => [card.effect_name1, card.effect_name2]).filter(Boolean)
)].sort();
const bpValues = [...new Set(cards.map(card => card.BP_flag).filter(Boolean))].sort();
const FIELD_DISPLAY = {
  'フィールド関係なし': 'フィールド関係なし',
  'ドラゴンフィールド': 'ドラゴン',
  'アンドロイドフィールド': 'アンドロイド',
  'エレメンタルフィールド': 'エレメンタル',
  'ルミナスフィールド': 'ルミナス',
  'シェイドフィールド': 'シェイド',
  'ノーマルフィールド': 'ノーマル',
};

const SPECIAL_ABILITIES = ['特殊効果未所持', '燃焼', '拘束', '沈黙'];
// その他条件
const OTHER_BOOLEAN_KEYS = [
  'draw',
  'cardsearch',
  'graveyard_recovery',
  'destroy_opponent',
  'destroy_self',
  'heal',
  'power_up',
  'power_down'

];





// デッキメーカー限定、所持フィルター（所持データが無いときは非表示＝生成しない）
if (location.pathname.includes('deckmaker')) {
  const ownedData = readOwnedDataSafe();
  const hasOwned = ownedData && Object.keys(ownedData).length > 0;

  if (hasOwned) {
    const ownWrap = document.createElement('div');
    ownWrap.className = 'filter-block';

    const strong = document.createElement('strong');
    strong.className = 'filter-title';
    strong.textContent = '所持フィルター';
    ownWrap.appendChild(strong);

    const g = document.createElement('div');
    g.className = 'filter-group';
    g.dataset.key = '所持フィルター';

    // ① 所持カードのみ表示（1枚でも所持していれば表示）
    const ownedBtn = document.createElement('button');
    ownedBtn.className = 'filter-btn';
    ownedBtn.type = 'button';
    ownedBtn.dataset.mode = 'owned';
    ownedBtn.textContent = '所持カードのみ表示';

    // ★ ② 未コンプカードのみ表示（通常0～1枚 / 旧神0枚）
    const uncompBtn = document.createElement('button');
    uncompBtn.className = 'filter-btn';
    uncompBtn.type = 'button';
    uncompBtn.dataset.mode = 'incomplete';
    uncompBtn.textContent = '未コンプカードのみ表示';

    // ③ コンプカードのみ表示（通常3枚 / 旧神1枚）
    const compBtn = document.createElement('button');
    compBtn.className = 'filter-btn';
    compBtn.type = 'button';
    compBtn.dataset.mode = 'complete';
    compBtn.textContent = 'コンプカードのみ表示';

    // 並び順：所持 → 未コンプ → コンプ
    g.appendChild(ownedBtn);
    g.appendChild(uncompBtn);
    g.appendChild(compBtn);
    ownWrap.appendChild(g);


    // 他のメインフィルターより上に置く
    const mainFilters = document.getElementById('main-filters');
    if (mainFilters) mainFilters.prepend(ownWrap);
  }
}




  // 🧩 共通ボタン生成（修正版）
  function createButtonGroup(title, list, filterKey) {
    const wrapper = document.createElement('div');
    wrapper.className = 'filter-block';

    // タイトル
    const strong = document.createElement('strong');
    strong.className = 'filter-title';
    strong.textContent = title;
    wrapper.appendChild(strong);

    // ボタングループ
    const groupDiv = document.createElement('div');
    groupDiv.className = 'filter-group';
    groupDiv.dataset.key = title;

    list.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.type = 'button';
      btn.dataset[filterKey] = item;
      btn.textContent = item;
      groupDiv.appendChild(btn);
    });

    wrapper.appendChild(groupDiv);
    return wrapper;
  }

  // 🧩 範囲選択（コスト・パワー）
  function createRangeSelector(title, filterKey, list) {
    const wrapper = document.createElement('div');
    wrapper.className = 'filter-block filter-range-wrapper';

    // タイトル
    const strong = document.createElement('strong');
    strong.className = 'filter-title';
    strong.textContent = title;
    wrapper.appendChild(strong);

    // セレクトボックスグループ
    const groupDiv = document.createElement('div');
    groupDiv.className = 'filter-group';
    groupDiv.dataset.key = title;

    const selectMin = document.createElement('select');
    const selectMax = document.createElement('select');
    selectMin.id = `${filterKey}-min`;
    selectMax.id = `${filterKey}-max`;

    const minOptions = [...list];
    const maxOptions = [...list, '上限なし'];
    minOptions.forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      if (v === 0) o.selected = true;
      selectMin.appendChild(o);
    });

    maxOptions.forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      if (v === '上限なし') o.selected = true;
      selectMax.appendChild(o);
    });

    groupDiv.appendChild(selectMin);
    const wave = document.createElement('span');
    wave.className = 'tilde'; wave.textContent = '～';
    groupDiv.appendChild(wave);
    groupDiv.appendChild(selectMax);
    wrapper.appendChild(groupDiv);
    // 変更されたら即反映（デバウンス不要の即時）
    selectMin.addEventListener('change', () => applyFilters());
    selectMax.addEventListener('change', () => applyFilters());
    return wrapper;
  }

  // 🧩 範囲選択（タイプ、レアリティ、BP要素、特殊効果）
    function createRangeStyleWrapper(title, list, filterKey) {
    const wrapper = document.createElement('div');
    wrapper.className = 'filter-block filter-range-wrapper';

    const strong = document.createElement('strong');
    strong.className = 'filter-title';
    strong.textContent = title;
    wrapper.appendChild(strong);

    const groupDiv = document.createElement('div');
    groupDiv.className = 'filter-group';
    groupDiv.dataset.key = title;

    list.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.type = 'button';
      btn.dataset[filterKey] = item;
      btn.textContent = DISPLAY_LABELS[item] ?? item;
      groupDiv.appendChild(btn);
    });

    wrapper.appendChild(groupDiv);
    return wrapper;
  }


  // 📌 メインフィルター構築
  mainFilters.appendChild(createRangeStyleWrapper('タイプ', types, 'type'));
  mainFilters.appendChild(createRangeStyleWrapper('レアリティ', rarities, 'rarity'));
  mainFilters.appendChild(packWrapper);//パック
  mainFilters.appendChild(createButtonGroup('種族', races, 'race'));
  mainFilters.appendChild(createButtonGroup('カテゴリ', categories, 'category'));
  mainFilters.appendChild(createRangeSelector('コスト', 'cost', costs));
  mainFilters.appendChild(createRangeSelector('パワー', 'power', powers));


  // 📌 詳細フィルター

detailFilters.appendChild(createButtonGroup('効果名', effect_name, 'effect'));
// 📌 フィールドフィルター（表示名は短縮、data値はフルで一致させる）
const fieldKeys = Object.keys(FIELD_DISPLAY);
const fieldWrapper = createButtonGroup('フィールド', fieldKeys, 'field');

// ボタン表示名を短縮ラベルに変更
fieldWrapper.querySelectorAll('.filter-btn').forEach(btn => {
  const val = btn.dataset.field;
  btn.textContent = FIELD_DISPLAY[val] ?? val;
});

detailFilters.appendChild(fieldWrapper);

detailFilters.appendChild(createRangeStyleWrapper('BP（ブレッシングポイント）要素', ['true', 'false'], 'bp'));
detailFilters.appendChild(createRangeStyleWrapper('特殊効果', SPECIAL_ABILITIES, 'ability'));

// ✅ boolean 条件 → まとめて「その他」タイトルの下に表示
const otherWrapper = document.createElement('div');
otherWrapper.className = 'filter-range-wrapper';

const strong = document.createElement('strong');
strong.className = 'filter-title';
strong.textContent = 'その他';
otherWrapper.appendChild(strong);

const groupDiv = document.createElement('div');
groupDiv.className = 'filter-group';
groupDiv.dataset.key = 'その他';

OTHER_BOOLEAN_KEYS.forEach(key => {
  const btn = document.createElement('button');
  btn.className = 'filter-btn';
  btn.type = 'button';
  btn.dataset[key] = 'true';
  btn.textContent = DISPLAY_LABELS[key] ?? key;
  groupDiv.appendChild(btn);
});

otherWrapper.appendChild(groupDiv);



detailFilters.appendChild(otherWrapper);

}

// ===== 0.3秒デバウンス =====
function debounce(fn, ms = 300) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ===== 選択中フィルターのチップ表示 =====
function renderActiveFilterChips() {
  const grid = document.getElementById('grid');
  if (!grid) return;

  // 固定バー（無ければ作る）
  let bar = document.getElementById('active-chips-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'active-chips-bar';
    const sc = document.createElement('div');
    sc.className = 'chips-scroll';
    bar.appendChild(sc);
    const sb = document.querySelector('.search-bar');
    if (sb && sb.parentNode) sb.insertAdjacentElement('afterend', bar);
    else grid.parentNode.insertBefore(bar, grid); // フォールバック
  }
  const scroll = bar.querySelector('.chips-scroll');
  scroll.innerHTML = '';

  const chips = [];

  // ① キーワード
  const kwEl = document.getElementById('keyword');
  const kw = (kwEl?.value || '').trim();
  if (kw) chips.push({ label: `検索:${kw}`, onRemove: () => { kwEl.value=''; applyFilters(); } });

  // ② 範囲（コスト/パワー）
  const cminEl = document.getElementById('cost-min');
  const cmaxEl = document.getElementById('cost-max');
  const pminEl = document.getElementById('power-min');
  const pmaxEl = document.getElementById('power-max');

  const cmin = cminEl?.value, cmax = cmaxEl?.value;
  const pmin = pminEl?.value, pmax = pmaxEl?.value;

  if (cminEl && cmaxEl) {
    const isDefault = (cmin|0) === (cminEl.options[0]?.value|0) && cmax === '上限なし';
    if (!isDefault) chips.push({
      label: `コスト:${cmin}–${cmax === '上限なし' ? '∞' : cmax}`,
      onRemove: () => { cminEl.selectedIndex = 0; cmaxEl.selectedIndex = cmaxEl.options.length-1; applyFilters(); }
    });
  }
  if (pminEl && pmaxEl) {
    const isDefault = (pmin|0) === (pminEl.options[0]?.value|0) && pmax === '上限なし';
    if (!isDefault) chips.push({
      label: `パワー:${pmin}–${pmax === '上限なし' ? '∞' : pmax}`,
      onRemove: () => { pminEl.selectedIndex = 0; pmaxEl.selectedIndex = pmaxEl.options.length-1; applyFilters(); }
    });
  }

  // ③ ボタン系
  const GROUPS = [
    ['種族','race'], ['カテゴリ','category'], ['タイプ','type'],
    ['レア','rarity'], ['パック','pack'],
    ['効果名','effect'], ['フィールド','field'],
    ['BP','bp'], ['特効','ability'],
    // boolean（その他）
    ['その他','draw'], ['その他','cardsearch'], ['その他','graveyard_recovery'],
    ['その他','destroy_opponent'], ['その他','destroy_self'],
    ['その他','heal'], ['その他','power_up'], ['その他','power_down'],
  ];

  //チップ見栄え
    GROUPS.forEach(([title, key])=>{
     document.querySelectorAll(`.filter-btn.selected[data-${key}]`).forEach(btn=>{
    const val = btn.dataset[key];
    let labelText;

    // パック：英名＋仮名の短縮表示
    if (key === 'pack') {
      const jp = (window.__PACK_EN_TO_JP && window.__PACK_EN_TO_JP[val]) || '';
      labelText = jp ? `${val} / ${jp}` : val;
    }
    // その他（boolean群）は val は常に 'true' なので key から表示名を引く
    else if (['draw','cardsearch','graveyard_recovery','destroy_opponent','destroy_self','heal','power_up','power_down'].includes(key)) {
      labelText = DISPLAY_LABELS[key] ?? key;
    }
    // それ以外は通常（valから表示名）
    else {
      labelText = (DISPLAY_LABELS && DISPLAY_LABELS[val] != null) ? DISPLAY_LABELS[val] : val;
    }

      chips.push({
        label: `${title}:${labelText}`,
        onRemove: () => { btn.classList.remove('selected'); applyFilters(); }
      });
    });
  });


  // 生成（横スクロール1行）
  chips.forEach(({label,onRemove})=>{
    const chip = document.createElement('span');
    chip.className = 'chip-mini';
    chip.textContent = label;

    const x = document.createElement('button');
    x.className = 'x'; x.type='button'; x.textContent='×';
    x.addEventListener('click', (e)=>{ e.stopPropagation(); onRemove(); });
    chip.appendChild(x);

    scroll.appendChild(chip);
  });

  // 全解除
  if (chips.length){
    const clr = document.createElement('span');
    clr.className = 'chip-mini chip-clear';
    clr.textContent = 'すべて解除';
    clr.addEventListener('click', ()=>{
      // キーワード
      if (kwEl) kwEl.value = '';
      // ボタン
      document.querySelectorAll('.filter-btn.selected').forEach(b=>b.classList.remove('selected'));
      // 範囲
      if (cminEl && cmaxEl){ cminEl.selectedIndex=0; cmaxEl.selectedIndex=cmaxEl.options.length-1; }
      if (pminEl && pmaxEl){ pminEl.selectedIndex=0; pmaxEl.selectedIndex=pmaxEl.options.length-1; }
      applyFilters();
    });
    scroll.appendChild(clr);
  }

  // 表示/非表示
  bar.style.display = chips.length ? '' : 'none';
}



// 🔁 DOM読み込み後に実行
document.addEventListener("DOMContentLoaded", () => {
  generateFilterUI();

  // 🟡 コスト・パワーセレクト変更時に即絞り込み反映
  ["cost-min", "cost-max", "power-min", "power-max"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", applyFilters);
    }
  });

  // キーワード入力：0.3秒デバウンスで即時絞り込み
  const kw = document.getElementById('keyword');
  if (kw) kw.addEventListener('input', debounce(() => applyFilters(), 300));

function updateChipsOffset() {
  // 必要ならここに他の固定要素を足す（例: '.main-header', '.subtab-bar'）
  const parts = [
    //document.querySelector('.search-bar'),
    // document.querySelector('.main-header'),
    // document.querySelector('.subtab-bar'),
  ].filter(Boolean);

  const sum = parts.reduce((h, el) => h + el.offsetHeight, 0);
  document.documentElement.style.setProperty('--chips-offset', `${sum}px`);
}

const df = document.getElementById('detail-filters');
  if (df && !document.querySelector('.filter-subtitle')) {
    const h = document.createElement('h4');
    h.className = 'filter-subtitle';
    h.textContent = 'さらに詳しい条件フィルター';
    df.parentNode.insertBefore(h, df);
  }


// 起動時とリサイズで反映
window.addEventListener('resize', updateChipsOffset);


});



//#endregion


/*=======================
    4.フィルター機能
========================*/

//#filter
document.getElementById("applyFilterBtn")?.addEventListener("click", () => {
  applyFilters(); // ✅ フィルター即適用

  // ✅ モーダルを閉じる
  const modal = document.getElementById("filterModal");
  if (modal) modal.style.display = "none";
});




function applyFilters() {
  const keyword = document.getElementById("keyword").value.trim().toLowerCase();
  const tokens  = keyword.split(/\s+/).filter(Boolean);

  const selectedFilters = {
    race: getSelectedFilterValues("race"),
    category: getSelectedFilterValues("category"),
    type: getSelectedFilterValues("type"),
    rarity: getSelectedFilterValues("rarity"),
    pack: getSelectedFilterValues("pack"),
    effect: getSelectedFilterValues("effect"),
    field: getSelectedFilterValues("field"),
    bp: getSelectedFilterValues("bp"),
    ability: getSelectedFilterValues("ability"),
    draw: getBooleanFilter("draw"),
    cardsearch: getBooleanFilter("cardsearch"),
    graveyard_recovery: getBooleanFilter("graveyard_recovery"),
    destroy_opponent: getBooleanFilter("destroy_opponent"),
    destroy_self: getBooleanFilter("destroy_self"),
    heal: getBooleanFilter("heal"),
    power_up: getBooleanFilter("power_up"),
    power_down: getBooleanFilter("power_down"),
  };

  const costMin = parseInt(document.getElementById("cost-min")?.value ?? 0);
  const costMaxVal = document.getElementById("cost-max")?.value;
  const costMax = costMaxVal === "上限なし" ? Infinity : parseInt(costMaxVal);

  const powerMin = parseInt(document.getElementById("power-min")?.value ?? 0);
  const powerMaxVal = document.getElementById("power-max")?.value;
  const powerMax = powerMaxVal === "上限なし" ? Infinity : parseInt(powerMaxVal);

  // --- 所持/コンプ フィルター ---
  const ownedFilterGroup = document.querySelector('.filter-group[data-key="所持フィルター"]');
  let ownedBtnOn = false, compBtnOn = false, unCompBtnOn = false;
  if (ownedFilterGroup) {
    ownedBtnOn   = ownedFilterGroup.querySelector('[data-mode="owned"]')?.classList.contains('selected') || false;
    unCompBtnOn  = ownedFilterGroup.querySelector('[data-mode="incomplete"]')?.classList.contains('selected') || false; // ★追加
    compBtnOn    = ownedFilterGroup.querySelector('[data-mode="complete"]')?.classList.contains('selected') || false;
  }

  // 所持データ（都度読むが軽い）
  const ownedDataMap = readOwnedDataSafe();


  document.querySelectorAll(".card").forEach(card => {
    const haystack =
      (card.dataset.keywords?.toLowerCase()) // ← ここに名＋効果名＋効果本文が入る
      || [
          card.dataset.name,
           card.dataset.effect,      // 名＋本文の結合（①②で付与）
          card.dataset.field,
          card.dataset.ability,
          card.dataset.category,
          card.dataset.race,
        ].filter(Boolean).join(' ').toLowerCase();

    const cardData = {
      race: card.dataset.race,
      category: card.dataset.category,
      type: card.dataset.type,
      rarity: card.dataset.rarity,
      pack: card.dataset.pack,
      effect: card.dataset.effect,
      field: card.dataset.field,
      bp: card.dataset.bp,
      ability: card.dataset.ability,
      draw: card.dataset.draw,
      cardsearch: card.dataset.cardsearch,
      graveyard_recovery: card.dataset.graveyard_recovery,
      destroy_opponent: card.dataset.destroy_opponent,
      destroy_self: card.dataset.destroy_self,
      heal: card.dataset.heal,
      power_up: card.dataset.power_up,
      power_down: card.dataset.power_down,
      cost: parseInt(card.dataset.cost),
      power: parseInt(card.dataset.power),
    };

    // 絞り込み条件のチェック
      const matchesKeyword = tokens.length === 0
      ? true
      : tokens.every(t => haystack.includes(t));

    const matchesFilters = Object.entries(selectedFilters).every(([key, selectedValues]) => {
      if (!selectedValues || selectedValues.length === 0) return true;

      // ★ パックだけは英名で一致判定（カード側は full の "EN「仮名」"）
      if (key === 'pack') {
        const cardEn = (cardData.pack || '').split('「')[0].trim(); // 先頭の英名
        return selectedValues.includes(cardEn);
      }

    // 効果名だけは「含む」判定（例: '■召喚時■' を含んでいればOK）
    if (key === 'effect') {
      const eff = cardData.effect || '';
      return selectedValues.some(v => eff.includes(v));
    }
    return selectedValues.includes(cardData[key]);
    });


    const matchesCost = cardData.cost >= costMin && cardData.cost <= costMax;
    const matchesPower = cardData.power >= powerMin && cardData.power <= powerMax;

  let visible = matchesKeyword && matchesFilters && matchesCost && matchesPower;

  // 各カードごとの可視判定の中（visible を決めているブロック）に以下ロジックを反映
  if (ownedBtnOn || compBtnOn || unCompBtnOn) {
    const cd = String(card.dataset.cd || '');
    const entry = ownedDataMap[cd];
    let total = 0;
    if (typeof entry === 'number') {
      total = entry;
    } else if (entry && typeof entry === 'object') {
      total = (entry.normal|0) + (entry.shine|0) + (entry.premium|0);
    }

    // 所持のみ：1枚以上なければ非表示
    if (ownedBtnOn && total <= 0) visible = false;

    // コンプのみ：通常3枚 / 旧神1枚に満たなければ非表示
    if (compBtnOn) {
      const isOldGod = (card.dataset.race === '旧神');
      const need = isOldGod ? 1 : 3;
      if (total < need) visible = false;
    }
    // ★ 未コンプのみ：
    //   通常カード→ 所持合計が 0～1 枚 のみ表示（= 2枚以上は非表示）
    //   旧神カード→ 所持合計 0 枚のみ表示（= 1枚以上は非表示）
    if (unCompBtnOn) {
      const isOldGod = (card.dataset.race === '旧神');
      const ok = isOldGod ? (total === 0) : (total <= 1);
      if (!ok) visible = false;
    }
  }

  card.style.display = visible ? "" : "none";
  });

  //同時に起動コード
    if (typeof applyGrayscaleFilter === 'function') applyGrayscaleFilter();
    renderActiveFilterChips();
  }

// 🔹 選択されたフィルター値（複数選択）を取得
function getSelectedFilterValues(key) {
  return Array.from(document.querySelectorAll(`.filter-btn.selected[data-${key}]`))
    .map(btn => btn.dataset[key]);
}


// 🔹 boolean系フィルター（true固定）を取得
function getBooleanFilter(key) {
  const btn = document.querySelector(`.filter-group [data-${key}].selected`);
  return btn ? ['true'] : [];
}

//フィルターボタン、selectrd切り替え
  document.addEventListener("click", e => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  btn.classList.toggle("selected");
  applyFilters();
  });



/*リセットボタン*/
function resetFilters() {
  // 1. キーワード検索をクリア
  document.getElementById("keyword").value = "";

  // 2. 全フィルターボタンの選択を解除
  document.querySelectorAll(".filter-btn.selected").forEach(btn => {
    btn.classList.remove("selected");
  });

  // 3. 範囲選択（セレクトボックス）を初期化
  const costMin = document.getElementById("cost-min");
  const costMax = document.getElementById("cost-max");
  const powerMin = document.getElementById("power-min");
  const powerMax = document.getElementById("power-max");

  if (costMin && costMax) {
    costMin.selectedIndex = 0;
    costMax.selectedIndex = costMax.options.length - 1;
  }
  if (powerMin && powerMax) {
    powerMin.selectedIndex = 0;
    powerMax.selectedIndex = powerMax.options.length - 1;
  }

  // 4. 絞り込み再適用
  applyFilters();
}










//#endfilter