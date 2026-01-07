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

  const cards = Array.from(grid.children).filter((c) => {
    if (!c.classList?.contains('card')) return false;
    if (!c.offsetParent) return false; // display:none の場合 null
    const cs = window.getComputedStyle ? getComputedStyle(c) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    return true;
  });
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

// --- 所持フィルター（切り替え式 1 ボタン） ---
if (location.pathname.includes('deckmaker')) {
  const ownedData = readOwnedDataSafe();
  const hasOwned = ownedData && Object.keys(ownedData).length > 0;

  if (hasOwned) {
    const ownWrap = document.createElement('div');
    ownWrap.className = 'filter-block';

    // === タイトル＋？ボタン行 ===
    const header = document.createElement('div');
    header.className = 'filter-title-row';

    const strong = document.createElement('strong');
    strong.className = 'filter-title';
    strong.textContent = '所持フィルター';
    header.appendChild(strong);

    const helpBtn = document.createElement('button');
    helpBtn.type = 'button';
    helpBtn.className = 'filter-help-btn';
    helpBtn.textContent = '？';
    helpBtn.setAttribute('aria-label', '所持フィルターの説明');
    header.appendChild(helpBtn);

    ownWrap.appendChild(header);

    // ▼ 説明テキスト（デフォルト非表示）
    const help = document.createElement('p');
    help.className = 'filter-help owned-filter-help';
    help.innerHTML =
      'OFF：全カード表示<br>' +
      '所持：1枚以上所持<br>' +
      '未コンプ：0～2枚（旧神は0枚）<br>' +
      'コンプ：3枚（旧神は1枚）<br>' +
      '※所持状況は所持率チェッカーのデータを使用';
    ownWrap.appendChild(help);

    // ？ボタンで説明の開閉
    helpBtn.addEventListener('click', () => {
      const opened = help.classList.toggle('is-open');
      helpBtn.classList.toggle('active', opened);
    });

    // ボタングループ
    const g = document.createElement('div');
    g.className = 'filter-group';
    g.dataset.key = '所持フィルター';

    const cycleBtn = document.createElement('button');
    cycleBtn.className = 'filter-btn';
    cycleBtn.type = 'button';
    cycleBtn.dataset.mode = 'owned-cycle';
    cycleBtn.dataset.state = 'off'; // off → owned → incomplete → complete → off...

    // 初期表示
    updateOwnedCycleBtn(cycleBtn);

    g.appendChild(cycleBtn);
    ownWrap.appendChild(g);

    const mainFilters = document.getElementById('main-filters');
    if (mainFilters) mainFilters.prepend(ownWrap);
  }
}



// 所持フィルター切り替えボタンの表示更新
function updateOwnedCycleBtn(btn) {
  const state = btn.dataset.state || 'off';
  let label = '';
  switch (state) {
    case 'owned':
      label = '所持カードのみ';       // 1枚以上所持
      break;
    case 'incomplete':
      label = '未コンプカードのみ';   // 通常0～1枚 / 旧神0枚
      break;
    case 'complete':
      label = 'コンプカードのみ';     // 通常3枚 / 旧神1枚
      break;
    default:
      label = '所持フィルターOFF';
  }
  btn.textContent = label;
  // OFF 以外のときだけ色を付ける
  btn.classList.toggle('selected', state !== 'off');
}

// クリック時に状態をぐるぐる切り替える
function cycleOwnedFilter(btn) {
  const order = ['off', 'owned', 'incomplete', 'complete'];
  const cur = btn.dataset.state || 'off';
  const idx = order.indexOf(cur);
  const next = order[(idx + 1) % order.length];
  btn.dataset.state = next;
  updateOwnedCycleBtn(btn);
  applyFilters();
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
      // カテゴリだけ「（」の前で改行
      if (filterKey === 'category' && item.includes('（')) {
        btn.innerHTML = item.replace('（', '<br>（');
      } else {
        btn.textContent = item;
      }
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
  // ★ deck-post など、カード一覧フィルターUIが無いページでは何もしない
  const hasCardFilterUI =
    document.getElementById('filterModal') &&
    document.getElementById('main-filters') &&
    document.getElementById('detail-filters');

  if (!hasCardFilterUI) return;

  generateFilterUI();
  updateChipsOffset();

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

// 起動時にも一回反映
updateChipsOffset();

// 起動時とリサイズで反映
window.addEventListener('resize', updateChipsOffset);


});



//#endregion

/*=======================
    4.フィルター機能
========================*/
//#region

document.getElementById("applyFilterBtn")?.addEventListener("click", () => {
  applyFilters(); // ✅ フィルター即適用

  // モーダルを開いた直後に初期表示を作る
    renderUserTagSuggest([]);        // ←「ここに候補が出ます / 候補がありません」を出す
    renderSelectedUserTagChips();    // ←「未選択」などを出す
    updateSuggest();                 // ←（任意）入力済みなら候補更新

  // ✅ モーダルを閉じる
  const modal = document.getElementById("filterModal");
  if (modal) modal.style.display = "none";
});

// 所持フィルター切り替えボタンの表示更新（グローバル）
function updateOwnedCycleBtn(btn) {
  const state = btn.dataset.state || 'off';
  let label = '';
  switch (state) {
    case 'owned':
      label = '所持カードのみ';
      break;
    case 'incomplete':
      label = '未コンプカードのみ';
      break;
    case 'complete':
      label = 'コンプカードのみ';
      break;
    default:
      label = '所持フィルターOFF';
  }
  btn.textContent = label;
  btn.classList.toggle('selected', state !== 'off'); // OFF 以外のときだけ色を付ける
}

// 所持フィルター状態をぐるぐる切り替える（グローバル）
function cycleOwnedFilter(btn) {
  const order = ['off', 'owned', 'incomplete', 'complete'];
  const cur = btn.dataset.state || 'off';
  const idx = order.indexOf(cur);
  const next = order[(idx + 1) % order.length];
  btn.dataset.state = next;
  updateOwnedCycleBtn(btn);
  applyFilters();
}


function applyFilters() {
  const opened = document.querySelector('.card-detail.active');
  if (opened) opened.remove();
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

  // --- 所持/コンプ フィルター（1ボタンの state で判定） ---
  const ownedFilterGroup = document.querySelector('.filter-group[data-key="所持フィルター"]');
  let ownedBtnOn = false, compBtnOn = false, unCompBtnOn = false;

  if (ownedFilterGroup) {
    const cycleBtn = ownedFilterGroup.querySelector('.filter-btn[data-mode="owned-cycle"]');
    const state = cycleBtn?.dataset.state || 'off';
    ownedBtnOn   = (state === 'owned');
    unCompBtnOn  = (state === 'incomplete');
    compBtnOn    = (state === 'complete');
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
    //   通常カード→ 所持合計が 0～2 枚 のみ表示（= 3枚は非表示）
    //   旧神カード→ 所持合計 0 枚のみ表示（= 1枚以上は非表示）
    if (unCompBtnOn) {
      const isOldGod = (card.dataset.race === '旧神');
      const ok = isOldGod ? (total === 0) : (total <= 2);
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

// フィルターボタン、selected切り替え（カード一覧用）
document.addEventListener("click", e => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;

  // ★ 投稿フィルター用のタグボタンは別処理なのでスキップ
  if (btn.classList.contains('post-filter-tag-btn')) {
    return;
  }

  // 所持フィルターの1ボタンは専用のサイクル処理
  const group = btn.closest('.filter-group');
  if (group && group.dataset.key === '所持フィルター') {
    cycleOwnedFilter(btn);
    return;
  }

  // それ以外は従来通り ON/OFF
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

    // 4. 所持フィルター（1ボタン）も OFF に戻す
  const ownedGroup = document.querySelector('.filter-group[data-key="所持フィルター"]');
  if (ownedGroup) {
    const cycleBtn = ownedGroup.querySelector('.filter-btn[data-mode="owned-cycle"]');
    if (cycleBtn) {
      cycleBtn.dataset.state = 'off';
      updateOwnedCycleBtn(cycleBtn);
    }
  }

  // 5. 絞り込み再適用
  applyFilters();

}


//#endregion

// ========================
// DeckPost 投稿フィルター（タグ）
// ========================
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const modal   = document.getElementById('postFilterModal');
    if (!modal) return; // deck-post.html 以外では何もしない

    const btnOpen  = document.getElementById('filterBtn');
    const btnClose = document.getElementById('postFilterCloseBtn');
    const btnApply = document.getElementById('postFilterApplyBtn');
    const btnReset = document.getElementById('postFilterResetBtn');
    const tagArea  = document.getElementById('postFilterTagArea');

    // フィルター状態（グローバルに1つ）
    window.PostFilterState = window.PostFilterState || {
      selectedTags: new Set(),
      selectedUserTags: new Set(),    // ★ 追加
      userTagQuery: '',
    };
    const filterState = window.PostFilterState;

    const userTagInput   = document.getElementById('userTagQuery');
    const userTagSuggest = document.getElementById('userTagSuggest');

// ===== ユーザータグ候補の収集（今ロード済み投稿から）=====
function collectUserTagsWithCount(){
  const ds = window.__DeckPostState;
  const items = ds?.list?.allItems || [];
  const m = new Map(); // tag -> count

  items.forEach(item => {
    const s = String(item.tagsUser || '').trim();
    if (!s) return;
    s.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
      m.set(t, (m.get(t) || 0) + 1);
    });
  });

  return Array.from(m.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a,b) => (b.count - a.count) || a.tag.localeCompare(b.tag, 'ja'));
}

// ===== ユーザータグ候補の描画 =====
function renderUserTagSuggest(list){
  if (!userTagSuggest) return;

  const emptyEl = userTagSuggest.querySelector('[data-user-tag-empty]');
  const itemsEl = userTagSuggest.querySelector('[data-user-tag-items]');

  // items側だけクリア（emptyは消さない）
  if (itemsEl) itemsEl.innerHTML = '';

  // ★ 候補がない：empty を表示（文言だけ切り替え）
  if (!list.length){
    const q = (userTagInput?.value || '').trim();
    if (emptyEl){
      emptyEl.textContent = q ? '候補がありません' : 'ここに候補が出ます';
      emptyEl.style.display = '';
    }
    return;
  }

  // ★ 候補がある：empty を非表示、items にチップ描画
  if (emptyEl) emptyEl.style.display = 'none';

  const frag = document.createDocumentFragment();
  list.forEach(x => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suggest-item';
    btn.dataset.tag = x.tag;

    const t = document.createElement('span');
    t.className = 't';
    t.textContent = x.tag;

    const c = document.createElement('span');
    c.className = 'c';
    c.textContent = String(x.count);

    btn.appendChild(t);
    btn.appendChild(c);
    frag.appendChild(btn);
  });

  (itemsEl || userTagSuggest).appendChild(frag);
}






let suggestCache = null;
let suggestTimer = null;


function normalizeKana(str){
  return str
    .replace(/[ぁ-ゖ]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) + 0x60)
    )
    .replace(/[ァ-ヶ]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    )
    .toLowerCase();
}


// ===== 選択済みユーザータグチップの描画 =====
function renderSelectedUserTagChips(){
  const wrap = document.getElementById('userTagSelectedArea');
  if (!wrap) return;

  const emptyEl = wrap.querySelector('[data-user-tag-selected-empty]');
  const itemsEl = wrap.querySelector('[data-user-tag-selected-items]');

  // items側だけクリア（emptyは消さない）
  if (itemsEl) itemsEl.innerHTML = '';

  const tags = Array.from(filterState.selectedUserTags || []);

  // ★ 未選択：empty を表示
  if (!tags.length){
    if (emptyEl) emptyEl.style.display = '';
    return;
  }

  // ★ 選択あり：empty を非表示、items にチップ描画
  if (emptyEl) emptyEl.style.display = 'none';

  const frag = document.createDocumentFragment();
  tags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'chip chip-user-selected';
    chip.textContent = tag;

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'chip-x';
    x.textContent = '×';
    x.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      filterState.selectedUserTags.delete(tag);
      renderSelectedUserTagChips();
      renderActivePostFilterChips?.();
      window.DeckPostApp?.applySortAndRerenderList?.();
    });

    chip.appendChild(x);
    frag.appendChild(chip);
  });

  (itemsEl || wrap).appendChild(frag);
}


function updateSuggest(){
  const qRaw = (userTagInput?.value || '').trim();
  if (!qRaw || qRaw.length < 1){
    renderUserTagSuggest([]);
    return;
  }

  const q = normalizeKana(qRaw);

  if (!suggestCache) suggestCache = collectUserTagsWithCount();

  const hit = suggestCache
    .filter(x => normalizeKana(x.tag).includes(q))
    .slice(0, 20);

  renderUserTagSuggest(hit);
}

// ===== ユーザータグ入力欄のイベント =====
userTagInput?.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(updateSuggest, 80);
});

userTagInput?.addEventListener('focus', () => updateSuggest());

// ===== 選択済みユーザータグチップの描画 =====
userTagSuggest?.addEventListener('click', (e) => {
  const btn = e.target.closest('.suggest-item');
  if (!btn) return;

  const tag = btn.dataset.tag;
  if (!tag) return;

  // ★ 選択済みタグとして追加
  filterState.selectedUserTags.add(tag);

  // 入力欄クリア（任意）
  userTagInput.value = '';
  renderUserTagSuggest([]);                    // 候補は閉じる
  renderSelectedUserTagChips();                // ★ ここが「チップ描画の位置」
});


// Apply/Reset と同期
btnReset?.addEventListener('click', () => {
  filterState.userTagQuery = '';
  filterState.selectedUserTags?.clear?.();
  if (userTagInput) userTagInput.value = '';
  renderUserTagSuggest([]);
  renderSelectedUserTagChips();
});

// ===== 開催中キャンペーンタグ（なければ空文字）=====
async function getActiveCampaignTag_(){
  try{
    // 1) page4 側で「開催中＆今回タグ（= cleanTitle）」を持っているならそれを最優先
    const running = !!window.__isCampaignRunning;
    const active  = String(window.__activeCampaignTag || '').trim();
    if (running && active) return active;
    if (!running) return '';

    // 2) 念のため、fetchActiveCampaign からも復元（tag か title 由来）
    if (typeof window.fetchActiveCampaign !== 'function') return '';
    const camp = await window.fetchActiveCampaign();

    // まず camp.tag
    const tag = String(camp?.tag || '').trim();
    if (tag) return tag;

    // 無い場合は title から（page4 と同じ「日程括弧除去」）
    const rawTitle = String(camp?.title || '').trim();
    if (!rawTitle) return '';
    const cleanTitle = rawTitle
      .replace(/[（(]\s*\d{4}\/\d{1,2}\/\d{1,2}\s*〜\s*\d{4}\/\d{1,2}\/\d{1,2}\s*[)）]\s*/g, '')
      .trim();
    return cleanTitle || '';
  }catch(_){
    return '';
  }
}


// ★ async にする
async function buildTagButtons() {
  if (!tagArea) return;

  const campaignTag = await getActiveCampaignTag_(); // ★ 追加

  const ds    = window.__DeckPostState;
  const items = ds?.list?.allItems || [];

  // ===== 定義 =====
  const BASE_TAGS = Array.isArray(window.POST_TAG_CANDIDATES)
    ? window.POST_TAG_CANDIDATES
    : ["初心者向け","趣味構築","ランク戦用","大会入賞","格安デッキ","回廊用"];

  const RACE_ORDER = ["イノセント","旧神","ドラゴン","アンドロイド","エレメンタル","ルミナス","シェイド"];
  const RACE_SET = new Set(RACE_ORDER);

  const isCategoryTag = (t) => {
    try {
      return (typeof getCategoryOrder === 'function') && (getCategoryOrder(t) < 9999);
    } catch (_) {
      return false;
    }
  };

  // ===== 投稿からタグを収集 =====
  const presentAll = new Set();   // tagsAuto+tagsPick の全部
  const presentAuto = new Set();  // tagsAuto のみ
  let hasCollab = false;

  items.forEach((item) => {
    const auto = String(item.tagsAuto || '');
    const pick = String(item.tagsPick || '');

    [auto, pick].filter(Boolean).join(',').split(',').forEach((raw) => {
      const t = String(raw || '').trim();
      if (!t) return;
      presentAll.add(t);
      if (t === 'コラボカードあり') hasCollab = true;
    });

    auto.split(',').forEach((raw) => {
      const t = String(raw || '').trim();
      if (!t) return;
      presentAuto.add(t);
      if (t === 'コラボカードあり') hasCollab = true;
    });
  });

  // ===== グループ別に並べる =====
  const groupBase = BASE_TAGS.filter(t => presentAll.has(t));

  const groupAuto = Array.from(presentAuto)
    .filter(t =>
      t !== 'コラボカードあり' &&
      !RACE_SET.has(t) &&
      !isCategoryTag(t) &&
      !BASE_TAGS.includes(t)
    )
    .sort((a,b)=>a.localeCompare(b,'ja'));

  if (hasCollab && !groupBase.includes('コラボカードあり')) {
    groupAuto.push('コラボカードあり');
  }

  const groupRace = RACE_ORDER.filter(t => presentAll.has(t));

  const groupCategory = Array.from(presentAll)
    .filter(t => isCategoryTag(t) && t !== 'ノーカテゴリ')
    .sort((a,b)=>{
      const da = getCategoryOrder(a);
      const db = getCategoryOrder(b);
      if (da !== db) return da - db;
      return a.localeCompare(b,'ja');
    });

  // ===== 最終リスト =====
  const ordered = [];
  const seen = new Set();

  [groupBase, groupAuto, groupRace, groupCategory].forEach(arr => {
    arr.forEach(t => {
      if (!t || seen.has(t)) return;
      seen.add(t);
      ordered.push(t);
    });
  });

  // ★ キャンペーン時のみ：最後に追加（投稿にまだ無くても出す）
  if (campaignTag && !seen.has(campaignTag)) {
    seen.add(campaignTag);
    ordered.push(campaignTag);
  }

  
  // ===== 描画 =====
  tagArea.innerHTML = '';

  if (!ordered.length) {
    const p = document.createElement('p');
    p.className = 'filter-wip-text';
    p.textContent = 'まだ絞り込みに使えるタグがありません。';
    tagArea.appendChild(p);
    return;
  }

  ordered.forEach((tag) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-btn post-filter-tag-btn';
    btn.dataset.tag = tag;

    // カテゴリ改行
    const isCat = isCategoryTag(tag);
    if (isCat && tag.includes('（')) {
      btn.innerHTML = tag.replace('（', '<br>（');
    } else {
      btn.textContent = tag;
    }

    // ★ キャンペーンタグの装飾（見た目＋先頭に🎉）
    if (campaignTag && tag === campaignTag) {
      btn.classList.add('is-campaign-tag');
      // innerHTMLを使ってるカテゴリでも崩れないように text を上書き
      btn.textContent = `🎉 ${tag}`;
    }

    if (filterState.selectedTags.has(tag)) {
      btn.classList.add('selected');
    }

    btn.addEventListener('click', () => {
      const nowSelected = btn.classList.toggle('selected');
      if (nowSelected) filterState.selectedTags.add(tag);
      else filterState.selectedTags.delete(tag);
    });

    tagArea.appendChild(btn);
  });
}


    // ---- 開閉まわり ----
    async function openModal() {
      await buildTagButtons();          // 投稿タグ
      renderUserTagSuggest([]);     // 「ここに候補が出ます」
      renderSelectedUserTagChips(); // 選択中(青チップ)を state から再描画
      modal.style.display = 'flex';
    }
    function closeModal() {
      modal.style.display = 'none';
    }

    btnOpen?.addEventListener('click', (e) => {
      e.preventDefault();
      openModal().catch(console.warn); // ★ async保険
    });
    btnClose?.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        closeModal();
      }
    });

// ===== 選択中フィルター（投稿タグ＋ユーザータグ）のチップ表示 =====
function renderActivePostFilterChips(){
  const bar = document.getElementById('active-chips-bar');
  if (!bar) return;

  const scroll = bar.querySelector('.chips-scroll');
  if (!scroll) return;

  const st = window.PostFilterState;

  const selectedTags = st?.selectedTags ? Array.from(st.selectedTags) : [];
  const selectedUser = st?.selectedUserTags ? Array.from(st.selectedUserTags) : [];

  scroll.innerHTML = '';

  // 共通：チップ生成
  function addChip(label, onRemove, extraClass=''){
    const chip = document.createElement('span');
    chip.className = `chip-mini ${extraClass}`.trim();
    chip.textContent = label;

    const x = document.createElement('button');
    x.className = 'x';
    x.type = 'button';
    x.textContent = '×';
    x.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRemove(); // ← これだけ
    });

    chip.appendChild(x);
    scroll.appendChild(chip);
  }


  // ① 投稿タグ（🏷️）
  selectedTags.forEach((tag) => {
    addChip(`🏷️${tag}`, () => {
      st.selectedTags?.delete?.(tag);

      document
        .querySelectorAll(`.post-filter-tag-btn[data-tag="${CSS.escape(tag)}"]`)
        .forEach(btn => btn.classList.remove('selected'));

      window.DeckPostApp?.applySortAndRerenderList?.();
      renderActivePostFilterChips();
    }, 'chip-tag');
  });

  // ② ユーザータグ（✍️）
  selectedUser.forEach((tag) => {
    addChip(`✍️${tag}`, () => {
      st.selectedUserTags?.delete?.(tag);

      renderSelectedUserTagChips(); // ← モーダル内の青チップを消す
      window.DeckPostApp?.applySortAndRerenderList?.();
      renderActivePostFilterChips();
    }, 'chip-user');
  });



  // すべて解除（投稿タグ＋ユーザータグ）
  const total = selectedTags.length + selectedUser.length;
  if (total) {
    const clr = document.createElement('span');
    clr.className = 'chip-mini chip-clear';
    clr.textContent = 'すべて解除';
    clr.addEventListener('click', () => {
      st.selectedTags?.clear?.();
      st.selectedUserTags?.clear?.();
      st.userTagQuery = '';

      // 投稿タグボタンの見た目解除
      document
        .querySelectorAll('.post-filter-tag-btn.selected')
        .forEach(btn => btn.classList.remove('selected'));

      // ユーザータグUIも同期（あれば）
      const userTagInput = document.getElementById('userTagInput'); // idが違うなら消してOK
      if (userTagInput) userTagInput.value = '';
      if (typeof renderUserTagSuggest === 'function') renderUserTagSuggest([]);
      if (typeof renderSelectedUserTagChips === 'function') renderSelectedUserTagChips();

      window.DeckPostApp?.applySortAndRerenderList?.();
      renderActivePostFilterChips();
    });
    scroll.appendChild(clr);
  }

  // 表示/非表示
  bar.style.display = total ? '' : 'none';
}


    // ---- リセット ----
    btnReset?.addEventListener('click', () => {
      filterState.selectedTags.clear();
      if (tagArea) {
        tagArea
          .querySelectorAll('.post-filter-tag-btn.selected')
          .forEach((btn) => btn.classList.remove('selected'));
      }

      if (window.DeckPostApp?.applySortAndRerenderList) {
        DeckPostApp.applySortAndRerenderList();
      }

      renderActivePostFilterChips();// チップ表示も更新
    });

    // ---- 適用 ----
    btnApply?.addEventListener('click', () => {
      if (window.DeckPostApp?.applySortAndRerenderList) {
        window.DeckPostApp?.applySortAndRerenderList?.();
      }
      closeModal();
      renderActivePostFilterChips();// チップ表示も更新
    });
  });
})();

