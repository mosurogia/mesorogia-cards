/*==================
      1.初期設定
===================*/






//全カード情報
const allCardsMap = {};


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
  rebuildCardMap();//カード一覧再読み込み
}

/*============================
      3.フィルター生成・表示
==========================*/
//#region
  // ✅ フィルターモーダルを開く
  function openFilterModal() {
    document.getElementById("filterModal").style.display = "flex";
    const detail = document.getElementById("detail-filters");
    if (detail) detail.style.display = "none";
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

//詳細フィルターデータ
  const packs = getUniqueValues("pack_name");
// ===== パック名の並び制御（英語→かな。その他特殊カードは最後） =====
const splitPackLabel = (s) => {
  const str = String(s || "");
  const m = str.match(/^([^「]+)(?:「([^」]*)」)?/); // 例: Awaking...「神託者...」
  return { en: (m?.[1] || "").trim(), kana: (m?.[2] || "").trim() };
};

// ユーザーが任意の順を指定したい場合は、ここに配列で定義（前の方が優先）
// 例: window.packCustomOrder = ["Awaking The Oracle「神託者の覚醒」","Beyond the Sanctuary 「聖域の先へ」"];
window.packCustomOrder = window.packCustomOrder || null;

// 末尾に送りたいラベル（完全一致/部分一致の両方で拾う）
const isSpecialOthers = (packName) => {
  const { en, kana } = splitPackLabel(packName);
  return en === "その他特殊カード" || kana === "その他特殊カード" || /その他特殊カード/.test(packName);
};

// 英語→かなの基本ソート
const basicSort = (a, b) => {
  const A = splitPackLabel(a), B = splitPackLabel(b);
  const p = A.en.localeCompare(B.en, "en");
  return p || A.kana.localeCompare(B.kana, "ja");
};

// カスタム順 → 基本ソート → 「その他特殊カード」を最後へ
function sortPacksWithRules(list) {
  const arr = [...list];

  // 1) カスタム順があれば最優先
  if (Array.isArray(window.packCustomOrder) && window.packCustomOrder.length) {
    const indexOf = (name) => {
      const i = window.packCustomOrder.indexOf(name);
      return i < 0 ? Number.POSITIVE_INFINITY : i;
    };
    arr.sort((a, b) => {
      const ia = indexOf(a), ib = indexOf(b);
      if (ia !== ib) return ia - ib;
      return basicSort(a, b);
    });
  } else {
    // 2) デフォルト：英語→かな
    arr.sort(basicSort);
  }

  // 3) 最後送り（その他特殊カード）: 安定パーティション
  const normal = [];
  const specials = [];
  for (const name of arr) (isSpecialOthers(name) ? specials : normal).push(name);
  return [...normal, ...specials];
}

// 既存の packs を並び替えてからボタン生成
const sortedPacks = sortPacksWithRules(packs);



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
];


  // 🧩 共通ボタン生成（修正版）
  function createButtonGroup(title, list, filterKey) {
    const wrapper = document.createElement('div');

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
    wrapper.className = 'filter-range-wrapper';

    // タイトル
    const strong = document.createElement('strong');
    strong.className = 'filter-title';
    strong.textContent = title+'：';
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
    groupDiv.appendChild(document.createTextNode(' ～ '));
    groupDiv.appendChild(selectMax);
    wrapper.appendChild(groupDiv);
    return wrapper;
  }
  // 🧩 範囲選択（タイプ、レアリティ、BP要素、特殊効果）
    function createRangeStyleWrapper(title, list, filterKey) {
    const wrapper = document.createElement('div');
    wrapper.className = 'filter-range-wrapper';

    const strong = document.createElement('strong');
    strong.className = 'filter-title';
    strong.textContent = title + '：';
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
  mainFilters.appendChild(createButtonGroup('種族', races, 'race'));
  mainFilters.appendChild(createButtonGroup('カテゴリ', categories, 'category'));
  mainFilters.appendChild(createRangeStyleWrapper('タイプ', types, 'type'));
  mainFilters.appendChild(createRangeStyleWrapper('レアリティ', rarities, 'rarity'));
  mainFilters.appendChild(createRangeSelector('コスト', 'cost', costs));
  mainFilters.appendChild(createRangeSelector('パワー', 'power', powers));


  // 📌 詳細フィルター
detailFilters.appendChild(createButtonGroup('パック名', sortedPacks, 'pack'));
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
strong.textContent = 'その他：';
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


["cost-min", "cost-max", "power-min", "power-max"].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("change", applyFilters);
  }
});


detailFilters.appendChild(otherWrapper);
return otherWrapper;


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
  };

  const costMin = parseInt(document.getElementById("cost-min")?.value ?? 0);
  const costMaxVal = document.getElementById("cost-max")?.value;
  const costMax = costMaxVal === "上限なし" ? Infinity : parseInt(costMaxVal);

  const powerMin = parseInt(document.getElementById("power-min")?.value ?? 0);
  const powerMaxVal = document.getElementById("power-max")?.value;
  const powerMax = powerMaxVal === "上限なし" ? Infinity : parseInt(powerMaxVal);

  document.querySelectorAll(".card").forEach(card => {
    const name = card.dataset.name?.toLowerCase() || "";
    const effect1 = card.dataset.effect1?.toLowerCase() || "";
    const effect2 = card.dataset.effect2?.toLowerCase() || "";
    const tribe = card.dataset.tribe?.toLowerCase() || "";
    const category = card.dataset.category?.toLowerCase() || "";

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
      cost: parseInt(card.dataset.cost),
      power: parseInt(card.dataset.power),
    };

    // 絞り込み条件のチェック
    const matchesKeyword =
      name.includes(keyword) ||
      effect1.includes(keyword) ||
      effect2.includes(keyword) ||
      tribe.includes(keyword) ||
      category.includes(keyword);

    const matchesFilters = Object.entries(selectedFilters).every(([key, selectedValues]) => {
      if (!selectedValues || selectedValues.length === 0) return true;
      return selectedValues.includes(cardData[key]);
    });

    const matchesCost = cardData.cost >= costMin && cardData.cost <= costMax;
    const matchesPower = cardData.power >= powerMin && cardData.power <= powerMax;

    const isVisible = matchesKeyword && matchesFilters && matchesCost && matchesPower;
    card.style.display = isVisible ? "" : "none";
  });

//同時に起動コード
  applyGrayscaleFilter();
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
  if (e.target.classList.contains("filter-btn")) {
    e.target.classList.toggle("selected");
    applyFilters();
  }
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