/*================
    1.初期設定
===============*/
//#region

//初期呼び出し
window.addEventListener('DOMContentLoaded', async () => {
  await loadCards(); // カードデータ読み込み
  updateSavedDeckList();  // その後に保存デッキ一覧を表示
  setTimeout(()=> window.__bindLongPressForCards('deckmaker'), 0);
});

// 日付フォーマット
function formatYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${da}`;
}

// 代表カードのグローバル変数
let representativeCd = null;

//#endregion
/*===================
    2.一覧カード生成
================*/

//#regioncard
//カード一覧生成
function generateCardListElement(card) {
  const cardDiv = document.createElement('div');
  cardDiv.classList.add('card');

  cardDiv.setAttribute('data-cd', card.cd);
  cardDiv.setAttribute('data-name', card.name);
  cardDiv.setAttribute('data-effect1', card.effect_name1 ?? "");
  cardDiv.setAttribute('data-effect2', card.effect_name2 ?? "");
  cardDiv.setAttribute('data-race', card.race);
  cardDiv.setAttribute('data-category', card.category);
  cardDiv.setAttribute('data-rarity', card.rarity);
  cardDiv.setAttribute('data-type', card.type);
  cardDiv.setAttribute('data-cost', card.cost);
  cardDiv.setAttribute('data-power', card.power);
  cardDiv.setAttribute('data-pack', card.pack_name);
  cardDiv.setAttribute('data-effect', [card.effect_name1, card.effect_name2].filter(Boolean).join(','));
  cardDiv.setAttribute('data-field', card.field);
  cardDiv.setAttribute('data-ability', card.special_ability);
  cardDiv.setAttribute('data-bp', String(card.BP_flag ?? "").toLowerCase());
  cardDiv.setAttribute('data-draw', String(card.draw ?? "").toLowerCase());
  cardDiv.setAttribute('data-graveyard_Recovery', String(card.graveyard_recovery ?? "").toLowerCase());
  cardDiv.setAttribute('data-cardsearch', String(card.cardsearch ?? "").toLowerCase());
  cardDiv.setAttribute('data-destroy_Opponent', String(card.destroy_opponent ?? "").toLowerCase());
  cardDiv.setAttribute('data-destroy_Self', String(card.destroy_self ?? "").toLowerCase());



  // UIパーツ
  const zoomBtn = document.createElement('div');
  zoomBtn.classList.add('zoom-btn');
  zoomBtn.innerText = '🔎';
  zoomBtn.setAttribute('onclick', 'handleZoomClick(event, this)');
  cardDiv.appendChild(zoomBtn);

  const ownedMark = document.createElement('div');
  ownedMark.classList.add('owned-mark');
  cardDiv.appendChild(ownedMark);

const img = document.createElement('img');
img.alt = card.name;
img.loading = 'lazy';
img.src = `img/${card.cd}.webp`;

// フォールバック：個別画像が無いときは 00000.webp を使う
img.onerror = () => {
  if (img.dataset.fallbackApplied) return; // 無限ループ防止
  img.dataset.fallbackApplied = '1';
  img.src = 'img/00000.webp';
};

// 左クリックで addCard() を呼ぶ
img.onclick = (e) => { e.stopPropagation(); addCard(card.cd); };

// 右クリックメニューを出さない
img.addEventListener('contextmenu', e => {
  e.preventDefault();
});

// PCブラウザのダブルクリックによる拡大も抑止
img.addEventListener('dblclick', e => {
  e.preventDefault();
});

  cardDiv.appendChild(img);


  return cardDiv;
}


// 詳細情報生成
function generateDetailHtml(card) {
  const typeClass = `type-${card.type}`;
  const raceClass = `race-${card.race}`;
  const detailId = `detail-${card.cd}`;

  const effectParts = [];

  if (card.effect_name1) {
    effectParts.push(`<div><strong class="effect-name">${card.effect_name1}</strong></div>`);
  }
  if (card.effect_text1) {
    effectParts.push(`<div>${card.effect_text1}</div>`);
  }
  if (card.effect_name2) {
    effectParts.push(`<div><strong class="effect-name">${card.effect_name2}</strong></div>`);
  }
  if (card.effect_text2) {
    effectParts.push(`<div>${card.effect_text2}</div>`);
  }

  const effectHtml = effectParts.join('\n');

  return `
    <div class="card-detail ${typeClass} ${raceClass}" data-name="${card.name}" id="${detailId}">
      <div class="card-name">${card.name}</div>
      <div class="card-meta">
        <span class="card-race">${card.race}</span> /
        <span class="card-category">${card.category}</span>
      </div>
      <div class="card-effect">
        ${effectHtml}
      </div>
    </div>
  `;
}

//カード一覧再読み込み
function rebuildCardMap() {
  Object.keys(cardMap).forEach(key => delete cardMap[key]);
  document.querySelectorAll('.card').forEach(cardEl => {
    const cd = cardEl.dataset.cd;
    cardMap[cd] = {
      name: cardEl.querySelector('img')?.alt || "",
      race: cardEl.dataset.race || "",
      type: cardEl.dataset.type || "",
      cost: parseInt(cardEl.dataset.cost) || 0,
      power: parseInt(cardEl.dataset.power) || 0,
      rarity: cardEl.dataset.rarity || ""
    };
  });
}

//#endregioncard

/*=================
    3.メニューバー
=================*/
//#region
/*=====使用不可種族判定=====*/
//#regionhiderace
  // 使用不可種族表示切替フラグ
  let hideInvalidRace = false;

// 使用不可種族表示/非表示ボタン
document.getElementById("toggle-invalid-race").addEventListener("click", function () {
  hideInvalidRace = !hideInvalidRace;
  this.classList.toggle("active", hideInvalidRace);
  this.textContent = hideInvalidRace ? "🚫使用不可種族を非表示" : "✅使用不可種族を表示(モノクロ)";
  applyGrayscaleFilter();
});

// 使用不可種族カードをモノクロ化 or 非表示にする
function applyGrayscaleFilter() {
  const cards = document.querySelectorAll(".card");
  cards.forEach(card => {
    const isGrayscale = card.classList.contains("grayscale");

    if (hideInvalidRace && isGrayscale) {
      card.classList.add("hidden-by-grayscale");
    } else {
      card.classList.remove("hidden-by-grayscale");
    }
  });
}
//#endregionhiderace

/* =========================
   所持カードオーバーレイ表示（デッキメーカー用／初期は未反映）
   ========================= */

// ON/OFF 状態（初期OFF：ボタン初期表示と合わせる）
let ownedOverlayOn = false;

// 所持データ取得（OwnedStore優先、なければ localStorage）
function readOwnedMapForDeckmaker() {
  // 1) 画面の真実は OwnedStore（ゲスト所持や未保存編集を含む）
  if (window.OwnedStore?.getAll) {
    return window.OwnedStore.getAll();
  }
  // 2) まれに OwnedStore 未初期化なら、最後に保存されたものを読む
  try {
    const raw = JSON.parse(localStorage.getItem('ownedCards') || '{}') || {};
    const norm = {};
    for (const cd in raw) {
      const v = raw[cd];
      norm[cd] = (v && typeof v === 'object')
        ? { normal: v.normal|0, shine: v.shine|0, premium: v.premium|0 }
        : { normal: v|0,      shine: 0,            premium: 0 };
    }
    return norm;
  } catch {
    return {};
  }
}


// 1枚のカード要素へ所持数を描画（未所持=0も表示）
function paintOwnedMarkDeckmaker(cardEl, total) {
  // デッキ構築の上限想定でクランプ（0〜3）
  const count = Math.max(0, Math.min(3, total|0));
  const mark = cardEl.querySelector('.owned-mark');

  if (ownedOverlayOn) {
    cardEl.classList.add('owned'); // CSSで表示トリガー
    mark.textContent = String(count); // 0 も表示
    mark.style.display = 'flex';      // 念のため強制表示
  } else {
    // OFF時は非表示
    cardEl.classList.remove('owned', 'owned-1', 'owned-2', 'owned-3');
    mark.textContent = '';
    mark.style.display = 'none';
  }

  if (window.__guestOwnedActive) mark.classList.add('guest-mode'); else mark.classList.remove('guest-mode');

  // 他ページ互換のため（必要なら）
  cardEl.dataset.count = String(count);
}

// 画面中のカード全てに反映（#grid を見る）
function refreshOwnedOverlay() {
  const ownedMap = readOwnedMapForDeckmaker();
  document.querySelectorAll('#grid .card').forEach(cardEl => {
    const cd = cardEl.dataset.cd;
    const v = ownedMap[cd] || { normal:0, shine:0, premium:0 };
    const total = (v.normal|0) + (v.shine|0) + (v.premium|0);
    paintOwnedMarkDeckmaker(cardEl, total);
  });
}

// トグル（ボタンと同期）
function toggleOwned() {
  if (window.__guestOwnedActive) return; // ゲストモードは操作不可
  ownedOverlayOn = !ownedOverlayOn;
  const btn = document.getElementById('toggleOwnedBtn');
  if (btn) btn.textContent = `所持カード${ownedOverlayOn ? '反映' : '未反映'}`;
  refreshOwnedOverlay();
  updateExchangeSummary();          // 数値/不足リストを最新化
  updateOwnedPanelsVisibility();    // 表示/非表示を反映
}


document.addEventListener('DOMContentLoaded', () => {
  // 初期は「未反映」ラベルのままにしておく
  const btn = document.getElementById('toggleOwnedBtn');
  if (btn) btn.textContent = '所持カード未反映';

  // 初期正規化（非表示のまま整える）
  refreshOwnedOverlay();
updateOwnedPanelsVisibility();  // 起動直後の表示状態を同期

  // #grid の再描画にも追従（ONのときのみ即時反映）
  const root = document.getElementById('grid');
  if (root) {
    let busy = false;
    new MutationObserver(muts => {
      if (busy || !ownedOverlayOn) return;
      if (!muts.some(m => m.addedNodes?.length || m.removedNodes?.length)) return;
      busy = true;
      requestAnimationFrame(() => { refreshOwnedOverlay(); busy = false; });
    }).observe(root, { childList: true, subtree: true });
  }
});

// グローバル公開（onclick から呼ぶため）
window.toggleOwned = toggleOwned;
window.refreshOwnedOverlay = refreshOwnedOverlay;


// デッキバー操作（右クリック防止）
document.addEventListener("contextmenu", e => {
  const deckBarTop = document.getElementById("deckBarTop");
  if (deckBarTop && deckBarTop.contains(e.target)) {
    e.preventDefault();
  }
});


//分析タブへ移動
function goToAnalyzeTab() {
  // 「デッキ分析」タブに切り替え
  const tab2 = document.querySelector('#tab2');
  if (tab2) switchTab('edit', tab2);
  renderDeckList();  // デッキに含まれるカード画像を一覧表示
  updateDeckAnalysis();  // 分析グラフやレアリティ比率などを更新
  updateExchangeSummary();  // ポイント等のサマリーを更新
}

//デッキ情報開閉
  function toggleDeckSummary() {
    const summary = document.getElementById('deck-summary');
    summary.classList.toggle('open');
  }


// =====================
// 共有URL（?o=...）受信 → ゲスト所持で反映
// =====================

// --- decoder helpers ---
function xorChecksumHex(bytes){
  let x = 0; for (let i = 0; i < bytes.length; i++) x ^= bytes[i];
  return (x & 0xff).toString(16).padStart(2, '0');
}
function decodeVarint(bytes, offs = 0){
  let x = 0, shift = 0, i = offs;
  for (; i < bytes.length; i++){
    const b = bytes[i];
    x |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0){ i++; break; }
    shift += 7;
  }
  return [x >>> 0, i - offs];
}
function unpack2bitExact(bytes, k){
  const out = new Uint8Array(k);
  for (let i = 0; i < k; i++){
    const q = i >> 2, r = i & 3;
    out[i] = (bytes[q] >> (r * 2)) & 3;
  }
  return out;
}
function bitsetGet(bitset, i){ return (bitset[i >> 3] >> (i & 7)) & 1; }

// v1/v2/v3 すべて読める汎用デコーダ
function decodeOwnedCountsFromPayload(payload, orderLen){
  if (!payload || payload.length < 3) throw new Error('invalid payload');
  const ver = payload[0];
  const csHex = payload.slice(1,3);
  const b64 = payload.slice(3);
  const bytes = bytesFromB64url(b64);
  const now = xorChecksumHex(bytes);
  if (now !== csHex) console.warn('Checksum mismatch: expected', csHex, 'got', now);

  if (ver === '1'){
    // 全カード2bit固定
    return unpack2bitExact(bytes, orderLen);

  } else if (ver === '2'){
    // bitset + 非0値列(2bit)
    const bitsetLen = Math.ceil(orderLen / 8);
    if (bytes.length < bitsetLen) throw new Error('bitset too short');
    const bitset = bytes.slice(0, bitsetLen);
    const valuesBytes = bytes.slice(bitsetLen);
    let K = 0; for (let i = 0; i < orderLen; i++) if (bitsetGet(bitset, i)) K++;
    const values = unpack2bitExact(valuesBytes, K);
    const counts = new Uint8Array(orderLen);
    let p = 0;
    for (let i = 0; i < orderLen; i++){
      counts[i] = bitsetGet(bitset, i) ? (values[p++] & 3) : 0;
    }
    return counts;

  } else if (ver === '3'){
    // [K(varint)] [gapPlus varint ×K] [values(2bit K個)]
    let idx = 0;
    const [K, used0] = decodeVarint(bytes, idx); idx += used0;
    const positions = new Array(K);
    let prev = -1;
    for (let i = 0; i < K; i++){
      const [gapPlus, used] = decodeVarint(bytes, idx); idx += used;
      const pos = prev + gapPlus; // gapPlus = pos - prev
      positions[i] = pos;
      prev = pos;
    }
    const valuesBytes = bytes.slice(idx);
    const values = unpack2bitExact(valuesBytes, K);
    const counts = new Uint8Array(orderLen);
    for (let i = 0; i < K; i++){
      const pos = positions[i];
      if (pos >= 0 && pos < orderLen) counts[pos] = values[i] & 3;
    }
    return counts;
  }

  throw new Error('unsupported version');
}




// カード順（cd昇順/is_latest）
async function getCanonicalOrderForOwned_DM(){
  if (window.__CARD_ORDER && window.__CARD_ORDER.length) return window.__CARD_ORDER.slice();
  let cards = [];
  try{
    if (typeof fetchLatestCards === 'function'){
      cards = await fetchLatestCards();
    }else{
      const res = await fetch('public/cards_latest.json'); // 環境に合わせて
      const all = await res.json();
      cards = all.filter(c => c.is_latest);
    }
  }catch(e){ console.error(e); }
  cards.sort((a,b) => (parseInt(a.cd,10)||0) - (parseInt(b.cd,10)||0));
  window.__CARD_ORDER = cards.map(c => String(c.cd));
  return window.__CARD_ORDER.slice();
}

// ゲスト所持を OwnedStore に反映（保存はしない）
async function applyGuestOwned(payload){
  const order = await getCanonicalOrderForOwned_DM();
  const counts = decodeOwnedCountsFromPayload(payload, order.length); // ← v3対応版を使用

  if (!window.OwnedStore?.set){
    console.warn('OwnedStore未初期化');
    return;
  }

  // ゲストモード：オートセーブ無効
  if (typeof OwnedStore.setAutosave === 'function') OwnedStore.setAutosave(false);
  window.__guestOwnedActive = true;
  window.__guestOwnedPayload = payload;

  // 反映
  for (let i=0;i<order.length;i++){
    const cd = String(order[i]);
    const n = counts[i] & 3;
    OwnedStore.set(cd, { normal: n, shine: 0, premium: 0 });
  }

  // UI更新（利用側に合わせて調整）
  if (typeof window.applyGrayscaleFilter === 'function') window.applyGrayscaleFilter();
  if (typeof window.updateOwnedTotal === 'function') window.updateOwnedTotal();
  if (typeof window.updateSummary === 'function') window.updateSummary();
  // ゲストUI適用（ボタン無効化・色変更・所持オーバーレイON）
  markGuestModeUI();
}

// ゲストモードのUI反映（ボタン無効化・色変更・所持オーバーレイON）
function markGuestModeUI() {
  // ボタンを置き換え＆無効化
  const btn = document.getElementById('toggleOwnedBtn');
  if (btn) {
    btn.textContent = '他人所持データ反映';
    btn.classList.add('guest-mode');
    btn.disabled = true;              // 機能オフ
    btn.title = '他人の所持データを表示中';
  }
  // 所持オーバーレイをONにして反映
  ownedOverlayOn = true;
  refreshOwnedOverlay();

  updateExchangeSummary();          // ゲスト所持での計算結果に更新
  updateOwnedPanelsVisibility();    // パネルを表示

  // owned-markに目印クラス
  document.querySelectorAll('#grid .owned-mark').forEach(el => {
    el.classList.add('guest-mode');
  });
}


// 起動時に ?o= を検出（全スクリプト読了後に実行）
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const payload = params.get('o');
  if (!payload) return;
  (async () => {
    try{
      await applyGuestOwned(payload);
    }catch(e){
      console.error(e);
      alert('共有データの読み込みに失敗しました');
    }
  })();
});

// --- Base64URL → bytes（※パディング復元あり） ---
function bytesFromB64url(s){
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  const mod = s.length & 3;
  if (mod === 2) s += '==';
  else if (mod === 3) s += '=';
  else if (mod === 1) s += '===';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// v1用：フル2bit列を展開
function unpack2bit(bytes, length){
  const out = new Uint8Array(length);
  for (let i=0;i<length;i++){
    const q = i >> 2, r = i & 3;
    out[i] = (bytes[q] >> (r*2)) & 3;
  }
  return out;
}


//#endregion


/*======================
    4.デッキ情報読み取り
======================*/
//#regiondeck

/*=======デッキメイン種族判別======*/
//#regionMainraces
// 種族の種別判定ヘルパー
function getRaceType(race) {
  if (race === "旧神") return "kyuushin";
  if (race === "イノセント") return "innocent";
  if (["ドラゴン", "アンドロイド", "エレメンタル", "ルミナス", "シェイド"].includes(race)) return "main";
  return "other";
}

// メイン種族の定義とヘルパー
const MAIN_RACES = ["ドラゴン", "アンドロイド", "エレメンタル", "ルミナス", "シェイド"];

// デッキ内に存在するメイン種族を（重複なしで）配列で返す
function getMainRacesInDeck() {
  const races = Object.keys(deck)
    .map(cd => cardMap[cd]?.race)
    .filter(r => MAIN_RACES.includes(r));
  return [...new Set(races)]; // 重複排除
}

// デッキの代表メイン種族
function getMainRace() {
  const list = getMainRacesInDeck();
  return list[0] || "ドラゴン";//無いときはドラゴン
}
//#endregionMainraces




//#endregiondeck

/*==================
    5.デッキ操作
===================*/
//#region

//カード追加
function addCard(cd) {
  const card = cardMap[cd];
  if (!card) return;

  const race = card.race || "";
  const raceType = getRaceType(race);
  const isKyuushin = race === "旧神";

  // 既に3枚入っていれば追加不可
  if ((deck[cd] || 0) >= 3) return;

  // 旧神は1枚まで、かつ他の旧神がいる場合は追加不可
  if (isKyuushin) {
    if ((deck[cd] || 0) >= 1) return;
    const hasOtherOldGod = Object.keys(deck).some(id => cardMap[id]?.race === "旧神" && id !== cd);
    if (hasOtherOldGod) return;
  }

  // メイン種族は1種類のみ
  if (raceType === "main") {
    const currentMainRaces = getMainRacesInDeck();
    const unique = new Set([...currentMainRaces, race]);
    if (unique.size > 1) return; // 2種類目は追加不可
  }
  //カード追加
  deck[cd] = (deck[cd] || 0) + 1;
  updateDeck();//デッキ情報更新
  applyGrayscaleFilter();//他種族モノクロor非表示
}

//カード削除
function removeCard(cd) {
  if (!deck[cd]) return;
  if (deck[cd] > 1) {
    deck[cd]--;//1枚減らす
  } else {
    delete deck[cd];//削除
  }
  updateDeck();//デッキ情報更新
  applyGrayscaleFilter();//他種族モノクロor非表示
}


/*デッキ情報更新*/
/*説明
 * デッキバーとデッキ情報を更新するメイン関数。
 * デッキ内カードを並び替えて表示し、種族やタイプの内訳を集計する。
 */
function updateDeck() {
  const deckBarTop = document.getElementById("deckBarTop");
  deckBarTop.innerHTML = "";

  // サマリー集計
  let total = 0;
  const typeCount = { "チャージャー": 0, "アタッカー": 0, "ブロッカー": 0 };
  const races = new Set();
  let hasOldGod = false;

  Object.entries(deck).forEach(([cd, count]) => {
    const card = cardMap[cd];
    if (!card) return;
    total += count;
    typeCount[card.type] += count;
    if (card.race !== "イノセント" && card.race !== "旧神") {
      races.add(card.race);
    }
    if (card.race === "旧神") {
      hasOldGod = true;
    }
  });

  // デッキバー横のサマリーを更新（※0枚でもここでゼロが入る）
  const summary = document.getElementById("deck-summary");
  const info = summary.querySelector(".deck-info") || (() => {
    const el = document.createElement("div");
    el.className = "deck-info";
    summary.insertBefore(el, summary.firstChild);
    return el;
  })();
  info.innerHTML = `
    デッキ枚数：${total} /30~40<br>
    使用種族：${races.size > 0 ? Array.from(races).join("/") : "なし"}<br>
    旧神：${hasOldGod ? "採用中" : "未採用"}<br>
    🔵 ${typeCount["チャージャー"]} 🟣 ${typeCount["アタッカー"]} ⚪️ ${typeCount["ブロッカー"]}
  `;

  // 空のときはヘルプテキストを表示
  if (Object.keys(deck).length === 0) {
    deckBarTop.innerHTML = `
      <div id="deck-empty-text">
        <div style="font-size: 0.7rem;">デッキバー操作</div>
        <div class="deck-help" id="deckHelp">
          <div>【PC】<br>・左クリック：追加<br>・右クリック：削除</div>
          <div>【スマホ】<br>・上フリック：追加<br>・下フリック：削除</div>
        </div>
      </div>
    `;
    // 一覧側のカード状態と deck-info をリセット
    updateCardDisabling();
    updateDeckSummary([]);
    updateExchangeSummary();
    updateOwnedPanelsVisibility();
    return;
  }

  // デッキをタイプ→コスト→パワー→ID順にソート
  const typeOrder = { "チャージャー": 0, "アタッカー": 1, "ブロッカー": 2 };
  const entries = Object.entries(deck).sort((a, b) => {
    const [cdA, countA] = a;
    const [cdB, countB] = b;
    const cardA = cardMap[cdA];
    const cardB = cardMap[cdB];
    if (!cardA || !cardB) return 0;

    const tA = typeOrder[cardA.type] ?? 99;
    const tB = typeOrder[cardB.type] ?? 99;
    if (tA !== tB) return tA - tB;

    const cA = parseInt(cardA.cost) || 0;
    const cB = parseInt(cardB.cost) || 0;
    if (cA !== cB) return cA - cB;

    const pA = parseInt(cardA.power) || 0;
    const pB = parseInt(cardB.power) || 0;
    if (pA !== pB) return pA - pB;

    return cdA.localeCompare(cdB);
  });

  // 並び替えた順にデッキバーに表示
  entries.forEach(([cd, count]) => {
    const card = cardMap[cd];
    if (!card) return;

    const cardEl = document.createElement("div");
    cardEl.className = "deck-card";
    cardEl.dataset.cd = cd;
    cardEl.dataset.race = card.race;

    // 画像は5桁IDで読み込む
    const img = document.createElement("img");
    img.src = `img/${cd.slice(0, 5)}.webp`;
    // フォールバック：個別画像が無いときは 00000.webp を使う
    img.onerror = () => {
      if (img.dataset.fallbackApplied) return; // 無限ループ防止
      img.dataset.fallbackApplied = '1';
      img.src = 'img/00000.webp';
    };
    img.alt = card.name;
    cardEl.appendChild(img);

    // 枚数バッジ
    const badge = document.createElement("div");
    badge.className = "count-badge";
    badge.textContent = count;
    cardEl.appendChild(badge);

    // PCの場合：左クリック追加、右クリック削除
    cardEl.addEventListener("mousedown", e => {
      if (e.button === 2) {
        e.preventDefault();
        removeCard(cd);
      } else if (e.button === 0) {
        e.preventDefault();
        addCard(cd);
      }
    });
    //モバイルの場合：上下フリックで追加/削除
    (function attachTouchSwipe(el, cd){
      let startX = 0, startY = 0;
      const THRESHOLD = 20; // しきい値（px）
      const MAX_SHIFT = 40; // 視覚アニメ距離（px）

      const cleanUp = () => {
        el.style.transform = 'translateY(0)';
        el.style.zIndex = '';
      };

      el.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        el.style.transition = '';
        el.style.zIndex = '2000'; // ヘッダー等より前面
      }, {passive:true});

      el.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;

        // 横が優勢なら（deck-bar の pan-x を妨げない）
        if (Math.abs(dx) > Math.abs(dy)) return;

        // 視覚フィードバック（±40px に制限）
        let limited = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, dy));
        el.style.transform = `translateY(${limited}px)`;
      }, {passive:true});

      el.addEventListener('touchend', (e) => {
        const endY = e.changedTouches[0].clientY;
        const diffY = startY - endY; // 上=正、下=負
        el.style.transition = 'transform 0.2s ease';

        const isSwipe = Math.abs(diffY) > THRESHOLD;
        if (!isSwipe) {
          setTimeout(() => { el.style.transition = ''; cleanUp(); }, 200);
          return;
        }

        // 方向別に 40px だけスッと動かしてから確定
        const to = diffY > 0 ? -MAX_SHIFT : MAX_SHIFT;
        el.style.transform = `translateY(${to}px)`;
        setTimeout(() => {
          el.style.transition = '';
          cleanUp();
          if (diffY > 0) {
            // 上フリック：追加（上限/旧神/種族は addCard 内で判定）
            addCard(cd);
          } else {
            // 下フリック：削除
            removeCard(cd);
          }
        }, 200);
      }, {passive:true});

      el.addEventListener('touchcancel', () => {
        cleanUp();
      }, {passive:true});
    })(cardEl, cd);

    cardEl.addEventListener("contextmenu", e => e.preventDefault());

    deckBarTop.appendChild(cardEl);
  });


  // デッキカードの情報を配列化してサマリー更新
  const deckCards = [];
  Object.entries(deck).forEach(([cd, count]) => {
    const card = cardMap[cd];
    if (!card) return;
    for (let i = 0; i < count; i++) {
      deckCards.push({ 種族: card.race, タイプ: card.type });
    }
  });

  updateCardDisabling();// カード禁止表示・バッジ更新など
  updateDeckSummary(deckCards);//デッキ分析（タイプ等）
  updateDeckAnalysis();//デッキ詳細情報分析
  updateExchangeSummary();  // ポイント等のサマリーを更新
  updateOwnedPanelsVisibility(); //表示/非表示も更新
}


/*カード使用状況判定*/
/*説明
 * カードの使用状況に応じてデッキ外の一覧をグレースケールにしたり、「使用中×n」「旧神使用中」ラベルを付ける処理。（ここでは基本的な禁止/許可判定のみ抜粋しています）
 */
function updateCardDisabling() {
  const deckRaces = new Set();
  let currentOldGod = null;

// デッキに含まれる種族と旧神を集計
  Object.keys(deck).forEach(cd => {
    const card = cardMap[cd];
    if (!card) return;
    if (card.race !== "イノセント" && card.race !== "旧神") {
      deckRaces.add(card.race);
    }
    if (card.race === "旧神") {
      currentOldGod = card.name;
    }
  });

  document.querySelectorAll(".card").forEach(cardEl => {
    const cd = cardEl.dataset.cd;
    const card = cardMap[cd];
    if (!card) return;

// 使用種族以外（イノセント・旧神除く）の定義
    const isUnselectedRace =
      deckRaces.size > 0 &&//１枚存在
      card.race !== "イノセント" &&//イノセント以外
      card.race !== "旧神" &&//旧神以外
      !deckRaces.has(card.race);//使用種族を持たない
//使用種族以外をグレースケール化
    if (isUnselectedRace) {
      cardEl.classList.add("grayscale");
    } else {
      cardEl.classList.remove("grayscale");
    }

// 使用枚数や旧神利用中のラベル表示
    const label = cardEl.querySelector(".used-label") || document.createElement("div");
    label.className = "used-label";
    label.textContent = "";

    if (card.race === "旧神") {
      if (deck[cd]) {
        label.textContent = "旧神使用";
      } else if (currentOldGod) {
        label.textContent = "他の旧神を使用中";
      }
    } else {
      const count = deck[cd] || 0;
      if (count > 0) {
        label.textContent = `使用中 ×${count}`;
      }
    }
// ラベル生成・テキスト設定後
if (!label.dataset.listenerAttached) {
  // 右クリック：カードを1枚削除
  label.addEventListener("contextmenu", e => {
    e.preventDefault();
    e.stopPropagation();
    removeCard(cd);
  });
  // 左クリック：カードを1枚追加
  label.addEventListener("click", e => {
    e.stopPropagation();
    addCard(cd);
  });
  // リスナー登録済みフラグ
  label.dataset.listenerAttached = "true";
}

    // 既に付いていない場合だけ append
    if (!cardEl.contains(label)) {
      cardEl.appendChild(label);
    }
  });

}

//#endregion

/*==============================
    6.デッキ分析-デッキリスト画面
===============================*/
//#region

//デッキリスト表示
function renderDeckList() {
  const container = document.getElementById('deck-card-list');
  const emptyMessage = document.getElementById('deckcard-empty-message');
  if (!container) return;

  // クリア＆プレースホルダ差し戻し
  container.innerHTML = '';
  if (emptyMessage) container.appendChild(emptyMessage);

  // [cd, 枚数] へ変換
  const entries = Object.entries(deck);

  // ソート（タイプ→コスト→パワー→ID）
  const typeOrder = { 'チャージャー': 0, 'アタッカー': 1, 'ブロッカー': 2 };
  entries.sort((a, b) => {
    const [cdA] = a;
    const [cdB] = b;
    const cardA = cardMap[cdA];
    const cardB = cardMap[cdB];
    if (!cardA || !cardB) return 0;
    const typeA = typeOrder[cardA.type] ?? 99;
    const typeB = typeOrder[cardB.type] ?? 99;
    if (typeA !== typeB) return typeA - typeB;
    const costA  = (parseInt(cardA.cost)  || 0);
    const costB  = (parseInt(cardB.cost)  || 0);
    if (costA !== costB) return costA - costB;
    const powerA = (parseInt(cardA.power) || 0);
    const powerB = (parseInt(cardB.power) || 0);
    if (powerA !== powerB) return powerA - powerB;
    return cdA.localeCompare(cdB);
  });


  // 代表カードの整合性を先に確定
  const representativeExists = entries.some(([cd]) => cd === representativeCd);
  let nextRepresentative = representativeExists
    ? representativeCd
    : (entries.length > 0 ? entries[0][0] : null);

  // 空表示制御（この時点でOK）
  if (emptyMessage) {
    emptyMessage.style.display = entries.length === 0 ? 'flex' : 'none';
  }
  if (entries.length === 0) {
    // 空なら代表名表示だけ同期して終わり
    representativeCd = null;
    updateDeckSummaryDisplay();
    return;
  }

// 並び替え後をDOM化（この時点で代表クラスも付与）
  for (const [cd, count] of entries) {
    const card = cardMap[cd];
    if (!card) continue;

    const cardEl = document.createElement('div');
    cardEl.className = 'deck-entry';
    cardEl.dataset.cd = cd;
    cardEl.dataset.race = card.race;
    cardEl.dataset.type = card.type;
    cardEl.dataset.rarity = card.rarity || '';

    // 代表カードならその場でクラス付与
    if (cd === nextRepresentative) {
      cardEl.classList.add('representative');
    }

    const img = document.createElement('img');
    img.src = `img/${cd.slice(0, 5)}.webp`;
    // フォールバック：個別画像が無いときは 00000.webp を使う
    img.onerror = () => {
      if (img.dataset.fallbackApplied) return; // 無限ループ防止
      img.dataset.fallbackApplied = '1';
      img.src = 'img/00000.webp';
    };
    img.alt = card.name;
    cardEl.appendChild(img);

    const badge = document.createElement('div');
    badge.className = 'count-badge';
    badge.textContent = `×${count}`;
    cardEl.appendChild(badge);

    // クリックで代表カードを切替
    cardEl.addEventListener('click', () => {
      if (representativeCd === cd) return;

      // 以前の代表からクラス剥がし（必要最小限）
      const prev = container.querySelector('.deck-entry.representative');
      if (prev) prev.classList.remove('representative');

      // 新代表に付与＆変数更新
      cardEl.classList.add('representative');
      representativeCd = cd;

      updateDeckSummaryDisplay();//代表カードデッキ情報表示
    });

    container.appendChild(cardEl);
  }

  representativeCd = nextRepresentative;  // 代表カードの最終確定
  updateDeckSummaryDisplay();//代表カードデッキ情報表示
}


//代表カードクラス付与
  function updateRepresentativeHighlight() {
    document.querySelectorAll(".deck-entry").forEach(el => {
      el.classList.remove("representative");
      if (el.dataset.cd === representativeCd) {
        el.classList.add("representative");
      }
    });
  }


//代表カードデッキ情報表示
  function updateDeckSummaryDisplay() {
    const name = cardMap[representativeCd]?.name || "未選択";
    document.getElementById("deck-representative").textContent = name;
  }

  //デッキリスト「デッキをここに表示」
  function updateDeckEmptyMessage() {
    const deck = document.getElementById("deck-card-list");
    const msg = document.getElementById("deckcard-empty-message");
    if (!deck || !msg) return;
    const cards = deck.querySelectorAll(".deck-entry"); // ← カードクラス名に合わせて変更

    if (cards.length === 0) {
      msg.style.display = "flex";
    } else {
      msg.style.display = "none";
    }
  }


//#endregion

/*==============================
    6.デッキ分析-デッキ情報-
===============================*/

//#region

//デッキ分析用変数
let costChart = null;
let powerChart = null;


/*デッキ情報欄*/
/*説明
 * デッキ情報欄（枚数・種族・旧神・タイプ内訳）の更新。
 * 引数 deckCards は { 種族: ..., タイプ: ... } の配列。
 */
function updateDeckSummary(deckCards) {
  // 枚数
  document.getElementById("deck-count").textContent = deckCards.length;

  // メイン種族（イノセント・旧神を除外）
  const races = [...new Set(deckCards.map(c => c.種族))].filter(
    r => r !== "イノセント" && r !== "旧神"
  );
  document.getElementById("deck-races").textContent = races[0] || "未選択";

  // 旧神の表示
  const oldGods = deckCards.filter(c => c.種族 === "旧神");
  if (oldGods.length === 0) {
    document.getElementById("deck-eldergod").textContent = "未採用";
  } else {
    // デッキに採用されている旧神1種類のみ表示
    const cd = Object.keys(deck).find(cd => cardMap[cd]?.race === "旧神");
    const name = cd ? cardMap[cd]?.name || "旧神" : "旧神";
    document.getElementById("deck-eldergod").textContent = name;
  }

  // タイプごとのカウント
  const countByType = type =>
    deckCards.filter(c => c.タイプ === type).length;
  document.getElementById("count-charger").textContent = countByType("チャージャー");
  document.getElementById("count-attacker").textContent = countByType("アタッカー");
  document.getElementById("count-blocker").textContent = countByType("ブロッカー");
}


// ===== デッキ分析更新 =====
function updateDeckAnalysis() {
  // deck と cardMap からカード詳細を展開
  const deckCards = [];
  Object.entries(deck).forEach(([cd, count]) => {
    const card = cardMap[cd];
    if (!card) return;
    for (let i = 0; i < count; i++) {
      deckCards.push({
        cd,
        race: card.race,
        type: card.type,
        cost: parseInt(card.cost) || 0,
        power: parseInt(card.power) || 0,
        rarity: card.rarity || ''
      });
    }
  });

  // レアリティ集計
  const rarityCounts = { 'レジェンド': 0, 'ゴールド': 0, 'シルバー': 0, 'ブロンズ': 0 };
  deckCards.forEach(c => {
    if (rarityCounts.hasOwnProperty(c.rarity)) rarityCounts[c.rarity]++;
  });
  document.getElementById('rarity-legend').textContent = `🌈${rarityCounts['レジェンド']}`;
  document.getElementById('rarity-gold').textContent   = `🟡 ${rarityCounts['ゴールド']}`;
  document.getElementById('rarity-silver').textContent = `⚪️ ${rarityCounts['シルバー']}`;
  document.getElementById('rarity-bronze').textContent = `🟤 ${rarityCounts['ブロンズ']}`;

//メイン種族率計算
let mainRaceCount = 0;
deckCards.forEach(c => {
  if (MAIN_RACES.includes(c.race)) {
    mainRaceCount++;
  }
});
let mainRaceRate = 0;
if (deckCards.length > 0) {
  mainRaceRate = (mainRaceCount / deckCards.length) * 100;
}
document.getElementById('race-rate').textContent = `${mainRaceRate.toFixed(1)}%`;


  // コスト・パワーの棒グラフを生成
  // ===== コスト／パワー分布グラフ =====

  // 1) 分布を集計
  const costCount = {};
  const powerCount = {};
  deckCards.forEach(c => {
    if (!Number.isNaN(c.cost))  costCount[c.cost]  = (costCount[c.cost]  || 0) + 1;
    if (!Number.isNaN(c.power)) powerCount[c.power] = (powerCount[c.power] || 0) + 1;
  });

  // 2) ラベルを用意（常に見せたい目盛りを混ぜて空バーも0で出す）
  const alwaysShowCosts  = [2, 4, 6, 8, 10, 12];
  const alwaysShowPowers = [0, 4, 5, 6, 7, 8, 12, 16];

  const costLabels = [...new Set([...alwaysShowCosts, ...Object.keys(costCount).map(Number)])]
    .sort((a,b)=>a-b);
  const powerLabels = [...new Set([...alwaysShowPowers, ...Object.keys(powerCount).map(Number)])]
    .sort((a,b)=>a-b);

  const costData  = costLabels.map(k => costCount[k]  || 0);
  const powerData = powerLabels.map(k => powerCount[k] || 0);

// 3) 総コスト/パワー表示
// 総コスト計算
const sumCost = deckCards.reduce((s, c) => s + (c.cost || 0), 0);
const sumCostEl = document.getElementById('total-cost');
if (sumCostEl) sumCostEl.textContent = String(sumCost);

// タイプ別総パワー計算
let chargerPower = 0;
let attackerPower = 0;
deckCards.forEach(c => {
  if (c.type === "チャージャー") {
    chargerPower += (c.power || 0);
  } else if (c.type === "アタッカー") {
    attackerPower += (c.power || 0);
  }
});

// 表示
const sumPowerEl = document.getElementById('total-power');
if (sumPowerEl) {
  sumPowerEl.textContent = `🔵${chargerPower} 🟣${attackerPower}`;
}


// 4) 初手事故率（マリガン対応）
// 可とみなす条件：コスト4以下
const earlyPlayable = deckCards.filter(c => (c.cost || 0) <= 4).length;

// マリガン枚数の反映：value="0" のとき 4枚、以降 value の分だけ +1
const mulliganEl = document.getElementById('mulligan-count');
const mulliganVal = parseInt(mulliganEl?.value ?? '0', 10) || 0;
const draws = 4 + mulliganVal;

// 事故率（= 引いた全カードが「非プレイ可能」になる確率）
const badRatePercent = calculateBadHandRate(deckCards.length, earlyPlayable, draws) * 100;

// 表示
const badRateEl = document.getElementById('bad-hand-rate');
if (badRateEl) badRateEl.textContent = `${badRatePercent.toFixed(1)}%`;

// 1%以下なら注記を表示、それ以外は非表示
let freqEl = document.getElementById('bad-hand-frequency');
// 必要なら自動生成（HTMLに既にあるならこの塊は実行されません）
if (!freqEl && badRateEl) {
  freqEl = document.createElement('span');
  freqEl.id = 'bad-hand-frequency';
  freqEl.textContent = '（ほぼ事故なし）';
  badRateEl.insertAdjacentElement('afterend', freqEl);
}
if (freqEl) {
  freqEl.style.display = (badRatePercent <= 1) ? '' : 'none';
}


// 5) データラベル（最初に一度だけでOK）
try { Chart.register(window.ChartDataLabels); } catch (_) {}

// 6) 積み上げ棒グラフ（タイプ別）
const TYPES = ['チャージャー', 'アタッカー', 'ブロッカー'];
const COLORS = {
  'チャージャー': 'rgba(119, 170, 212, 0.7)',
  'アタッカー':   'rgba(125, 91, 155, 0.7)',
  'ブロッカー':   'rgba(214, 212, 204, 0.7)',
};

function buildStackCounts(cards, key, labels) {
  const table = {};
  TYPES.forEach(t => { table[t] = Object.fromEntries(labels.map(l => [l, 0])); });
  cards.forEach(c => {
    const v = Number(c[key]);
    const t = c.type;
    if (!Number.isNaN(v) && table[t] && v in table[t]) table[t][v]++;
  });
  return TYPES.map(t => ({
    label: t,
    data: labels.map(l => table[t][l] || 0),
    backgroundColor: COLORS[t],
    borderWidth: 0,
    barPercentage: 0.9,
    categoryPercentage: 0.9,
  }));
}

// costLabels / powerLabels はこれまで通り作成済みとする
const costDatasets  = buildStackCounts(deckCards, 'cost',  costLabels);
const powerDatasets = buildStackCounts(deckCards, 'power', powerLabels);

const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { stacked: true, grid: { display: false, drawBorder: false }, title: { display: false }, ticks: { autoSkip: false } },
    y: { stacked: true, beginAtZero: true, grid: { display: false, drawBorder: false }, title: { display: false }, ticks: { display: false } }
  },
  plugins: {
    legend: { display: false },
    datalabels: { display: true, anchor: 'center', align: 'center', formatter: v => v > 0 ? v : '', font: { weight: 600 }, clamp: true },
    tooltip: { enabled: true },
  },
};

// 既存チャートがあれば破棄してから作り直し
if (costChart)  costChart.destroy();
if (powerChart) powerChart.destroy();

const costCtx  = document.getElementById('costChart')?.getContext('2d');
const powerCtx = document.getElementById('powerChart')?.getContext('2d');

if (costCtx) {
  costChart = new Chart(costCtx, { type: 'bar', data: { labels: costLabels,  datasets: costDatasets  }, options: commonOptions });
}
if (powerCtx) {
  powerChart = new Chart(powerCtx,{ type: 'bar', data: { labels: powerLabels, datasets: powerDatasets }, options: commonOptions });
}

}

// ===== 初手事故率計算用 =====
function combination(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}
function calculateBadHandRate(total, early, draws) {
  const nonPlayable = total - early;
  if (nonPlayable < draws) return 0;
  const numer = combination(nonPlayable, draws);
  const denom = combination(total, draws);
  return denom === 0 ? 0 : numer / denom;
}

// ===== 分析表示切替 =====
function toggleAnalysis() {
  const section = document.getElementById("analysis-section");
  const btn = document.getElementById("toggle-analysis-btn");
  const isOpen = section.classList.toggle("open");
  if (isOpen) {
    updateDeckAnalysis(); // 開くときだけ分析を更新
    updateExchangeSummary();// ポイント等のサマリーを更新
    btn.textContent = "⬆ 分析を隠す";
  } else {
    btn.textContent = "🔍 分析を表示";
  }
}


// マリガン枚数変更時に再計算
document.getElementById('mulligan-count')?.addEventListener('change', () => updateDeckAnalysis());

/* =========================
   交換ポイント計算と表示
   - 不足枚数 = デッキ要求 - 所持合計(normal+shine+premium)
   - 不足分のみをポイント/ダイヤ/砂に換算
   - 砂はUIに合わせてレジェンド/ゴールドのみ表示
========================= */

// 1枚あたりの交換レート（前に入れていた export は不要です）
const EXCHANGE_RATE = {
  point:   { LEGEND: 300, GOLD: 150, SILVER: 20,  BRONZE: 10 },
  diamond: { LEGEND: 4000, GOLD: 1000, SILVER: 250, BRONZE: 150 },
  sand:    { LEGEND: 300, GOLD: 150, SILVER: 20,  BRONZE: 10 },
};

function rarityToKey(r) {
  if (!r) return null;
  if (r.includes('レジェ')) return 'LEGEND';
  if (r.includes('ゴールド')) return 'GOLD';
  if (r.includes('シルバー')) return 'SILVER';
  if (r.includes('ブロンズ')) return 'BRONZE';
  if (r === 'レジェンド') return 'LEGEND';
  if (r === 'ゴールド') return 'GOLD';
  if (r === 'シルバー') return 'SILVER';
  if (r === 'ブロンズ') return 'BRONZE';
  return null;
}
function rarityIconJP(rarity) {
  if (!rarity) return '';
  if (rarity.includes('レジェ'))  return '🌈';
  if (rarity.includes('ゴールド')) return '🟡';
  if (rarity.includes('シルバー')) return '⚪️';
  if (rarity.includes('ブロンズ')) return '🟤';
  return '';
}

// 所持＝OwnedStore優先（未初期化時は localStorage）
// 既に page2.js にある readOwnedMapForDeckmaker() をそのまま使います

function computeExchangeNeeds() {
  const owned = readOwnedMapForDeckmaker();
  let point = 0, diamond = 0;
  const sand = { LEGEND: 0, GOLD: 0, SILVER: 0, BRONZE: 0 };
  const shortages = [];

  for (const [cd, need] of Object.entries(deck)) {
    const info = cardMap[cd];
    if (!info) continue;
    const key = rarityToKey(info.rarity);
    if (!key) continue;

    const v = owned[cd] || { normal:0, shine:0, premium:0 };
    const have = (v.normal|0) + (v.shine|0) + (v.premium|0);
    const shortage = Math.max(0, (need|0) - have);
    if (!shortage) continue;

    point   += EXCHANGE_RATE.point[key]   * shortage;
    diamond += EXCHANGE_RATE.diamond[key] * shortage;
    sand[key] += EXCHANGE_RATE.sand[key]  * shortage;


    shortages.push({ cd, name: info.name, shortage });
  }
  return { point, diamond, sand, shortages };
}

function updateExchangeSummary() {
  const els = {
    point:    document.getElementById('point-cost'),
    diamond:  document.getElementById('diamond-cost'),
    sandLeg:  document.getElementById('sand-leg'),
    sandGld:  document.getElementById('sand-gld'),
    sandSil:  document.getElementById('sand-sil'),
    sandBro:  document.getElementById('sand-bro'),
  };
  if (!els.point) return;

  const { point, diamond, sand, shortages } = computeExchangeNeeds();
  const fmt = (n) => String(n);

  // 数値の更新
  els.point.textContent   = fmt(point);
  els.diamond.textContent = fmt(diamond);
  els.sandLeg.textContent = fmt(sand.LEGEND);
  els.sandGld.textContent = fmt(sand.GOLD);
  els.sandSil.textContent = fmt(sand.SILVER);
  els.sandBro.textContent = fmt(sand.BRONZE);

  // 不足カード（HTMLに直接書き込み）
  const list = document.getElementById('shortage-list');
  if (!list) return;

  list.innerHTML = '';
  if (!shortages || shortages.length === 0) {
    list.textContent = 'なし';
  } else {
    // 並び順：タイプ→コスト→パワー→cd
    const typeOrder = { 'チャージャー': 0, 'アタッカー': 1, 'ブロッカー': 2 };

    const sorted = shortages.slice().sort((a, b) => {
      const A = cardMap[a.cd] || {};
      const B = cardMap[b.cd] || {};
      const tA = typeOrder[A.type] ?? 99;
      const tB = typeOrder[B.type] ?? 99;
      if (tA !== tB) return tA - tB;

      const cA = parseInt(A.cost) || 0;
      const cB = parseInt(B.cost) || 0;
      if (cA !== cB) return cA - cB;

      const pA = parseInt(A.power) || 0;
      const pB = parseInt(B.power) || 0;
      if (pA !== pB) return pA - pB;

      return String(a.cd).localeCompare(String(b.cd));
    });

    sorted.forEach(({ cd, name, shortage }) => {
      const info = cardMap[cd] || {};
      const icon = rarityIconJP(info.rarity);
      const line = document.createElement('div');
      // 例）🟡情熱のナチュリア サラ×3
      line.textContent = `${icon}${name}×${shortage}`;
      list.appendChild(line);
    });
  }
}

// 所持データ系パネルの表示切替（所持反映ON または ゲストモード時に表示）
function updateOwnedPanelsVisibility() {
  const show = ownedOverlayOn || !!window.__guestOwnedActive;
  const ex = document.querySelector('#deck-info .exchange-summary');
  const sh = document.getElementById('shortage-block');
  if (ex) ex.style.display = show ? 'block' : 'none';
  if (sh) sh.style.display = show ? 'block' : 'none';
}


// 表示切り替え（ボタンの onclick="toggleExchange()" から呼ばれる）
let __exchangeMode = 'point'; // 'point' | 'diamond' | 'sand'

function setExchangeVisible(mode) {
  const elPoint = document.getElementById('exchange-point');
  const elDia   = document.getElementById('exchange-diamond');
  const elSand  = document.getElementById('exchange-sand');
  if (elPoint) elPoint.style.display = (mode === 'point'   ? '' : 'none');
  if (elDia)   elDia.style.display   = (mode === 'diamond' ? '' : 'none');
  if (elSand)  elSand.style.display  = (mode === 'sand'    ? '' : 'none');

  const btn = document.getElementById('exchange-toggle-btn');
  if (btn) {
    btn.textContent =
      mode === 'point'   ? '🟢 ポイント' :
      mode === 'diamond' ? '💎 ダイヤ' :
                           '🪨 砂';
  }
}

function toggleExchange() {
  __exchangeMode = (__exchangeMode === 'point')
    ? 'diamond'
    : (__exchangeMode === 'diamond' ? 'sand' : 'point');
  setExchangeVisible(__exchangeMode);
}

// 初期表示はポイント
document.addEventListener('DOMContentLoaded', () => {
  setExchangeVisible('point');
  updateExchangeSummary();
});

// 所持データが変わったら自動で再計算（OwnedStore.onChange があるので利用）
if (window.OwnedStore?.onChange) {
  window.OwnedStore.onChange(() => updateExchangeSummary());
}

// グローバル公開（HTMLの onclick から使う）
window.toggleExchange = toggleExchange;
window.updateExchangeSummary = updateExchangeSummary;

window.updateDeckAnalysis = updateDeckAnalysis;

//#endregion


/*=================================
      7.デッキ保存機能
================================*/
//#region


// 保存デッキリスト確認
function updateSavedDeckList() {
  const container = document.getElementById("savedDeckList");
  const counter   = document.getElementById("savedDeckCount");
  if (!container) return;

  container.innerHTML = "";

  const multiSaved = JSON.parse(localStorage.getItem("savedDecks") || "[]");

  if (counter) {
    counter.textContent = `保存デッキ数：${multiSaved.length} / 20`;
  }

  if (multiSaved.length > 0) {
    let mutated = false;
    multiSaved.forEach((deckData, index) => {
      if (!deckData.date) {
        deckData.date = formatYmd();
        mutated = true;
      }
      const html = generateDeckLayout(deckData, index);
      container.insertAdjacentHTML("beforeend", html);
    });
    if (mutated) {
      try {
        localStorage.setItem("savedDecks", JSON.stringify(multiSaved));
      } catch (e) {
        console.warn("保存データの読み込みに失敗:", e);
      }
    }
    return;
  }

  // 空表示
  container.innerHTML = `
    <div class="saved-deck-empty">
      <p>保存されたデッキはまだありません。</p>
    </div>
  `;
}


// 保存デッキ1件のカード集計からメイン種族を決定（イノセント・旧神を除外）
function pickMainRaceFromCounts(cardCounts) {
  const tally = {};
  for (const cd in cardCounts || {}) {
    const info = cardMap[cd];
    if (!info) continue;
    const r = info.race;
    if (r === "イノセント" || r === "旧神") continue;
    tally[r] = (tally[r] || 0) + (cardCounts[cd] || 0);
  }
  let best = "未選択", bestCnt = -1;
  for (const r in tally) {
    if (tally[r] > bestCnt) {
      best = r;
      bestCnt = tally[r];
    }
  }
  return bestCnt > 0 ? best : "未選択";
}

// 保存デッキ表示
function generateDeckLayout(deckData, index) {
  let cardImg   = "img/10001.webp";
  let deckName  = "名称未設定";
  let race      = "未選択";
  let count     = "0/30~40";
  let typeCount = "🔵0🟣0⚪️0";
  let savedDate = "";

  if (deckData && deckData.cardCounts) {
    // 集計
    let total = 0, charge = 0, attack = 0, block = 0;
    for (const cd in deckData.cardCounts) {
      const n = deckData.cardCounts[cd] || 0;
      if (n <= 0) continue;
      total += n;
      const info = cardMap[cd];
      if (!info) continue;
      if (info.type === "チャージャー") charge += n;
      if (info.type === "アタッカー")  attack += n;
      if (info.type === "ブロッカー")  block  += n;
    }
    count     = `${total}/30~40`;
    typeCount = `🔵${charge}🟣${attack}⚪️${block}`;
    deckName  = deckData.name || "名称未設定";
    race      = pickMainRaceFromCounts(deckData.cardCounts);

    if (deckData.m) {
      cardImg = "img/" + String(deckData.m).padStart(5, "0") + ".webp";
    }
    savedDate = deckData.date ? deckData.date : "";
  }

  const loadBtn   = `<button onclick="loadDeckFromIndex(${index})">🔄 読み込む</button>`;
  const deleteBtn = `<button onclick="deleteDeckFromIndex(${index})">🗑 削除</button>`;
  return `
    <div class="saved-deck-item">
      <img src="${cardImg}" alt="代表カード" />
      <div class="saved-deck-info">
        <div class="row">
          <strong>${deckName}</strong>
          <span>使用種族：${race}</span>
        </div>
        <div class="row">
          <span>${count}</span>
          <span>${typeCount}</span>
        </div>
        ${savedDate ? `<div class="row"><small>保存日時: ${savedDate}</small></div>` : ""}
      </div>
      <div class="deck-buttons">
        ${loadBtn}
        ${deleteBtn}
      </div>
    </div>
  `;
}



// 💾 現在のデッキを一時保存（複数対応）
function saveDeckToLocalStorage() {
  const saved = JSON.parse(localStorage.getItem("savedDecks") || "[]");

  // デッキオブジェクトが空なら保存しない
  if (Object.keys(deck).length === 0) {
    alert("デッキが空です");
    return;
  }

  // 代表カードとメイン種族コード算出
  const m = (representativeCd && deck[representativeCd]) ? representativeCd : (Object.keys(deck)[0] || "10001");

  const raceCodeMap = { "ドラゴン": 1, "アンドロイド": 2, "エレメンタル": 3, "ルミナス": 4, "シェイド": 5 };

  const g = raceCodeMap[getMainRace()] || 1;

  let deckNameInput = document.getElementById("deck-name")?.value.trim();

  // 未入力なら「デッキ〇」形式で採番
  if (!deckNameInput) {
    let num = 1;
    const existingNames = saved.map(d => d.name);
    while (existingNames.includes(`デッキ${num}`)) {
      num++;
    }
    deckNameInput = `デッキ${num}`;
  }

  // 同名が存在する場合は上書き確認
  const existingIndex = saved.findIndex(d => d.name === deckNameInput);
  if (existingIndex !== -1) {
    if (!confirm(`同名のデッキ「${deckNameInput}」があります。上書きしますか？`)) {
      return; // キャンセル時は保存しない
    }
    // 上書き
    saved[existingIndex] = {
      name: deckNameInput,
      cardCounts: { ...deck },
      m,
      g,
      date: formatYmd()
    };
    //データをアプリに保存
    localStorage.setItem("savedDecks", JSON.stringify(saved));
    updateSavedDeckList();//保存デッキ表示更新
    return;
  }

  // 新規保存（上限20）
  if (saved.length >= 20) {
    alert("保存できるデッキは20件までです");
    return;
  }

  saved.push({
    name: deckNameInput,
    cardCounts: { ...deck },
    m,
    g,
    date: formatYmd()
  });
  localStorage.setItem("savedDecks", JSON.stringify(saved));
  updateSavedDeckList();
}

// 🔄 インデックス指定で読み込み
function loadDeckFromIndex(index) {
  const saved = JSON.parse(localStorage.getItem("savedDecks") || "[]");
  if (!saved[index]) return;
  const data = saved[index];

  // 現在のデッキをクリアして読み込み
  Object.keys(deck).forEach(k => delete deck[k]);
  Object.entries(data.cardCounts).forEach(([cd, n]) => {
    deck[cd] = n;
  });

  // 代表カード復元
  representativeCd = data.m && deck[data.m] ? data.m : null;

  // 🔽 デッキ名入力欄に反映
  const nameInput = document.getElementById("deck-name");
  if (nameInput) {
    nameInput.value = data.name || ""; // ない場合は空に
  }
  updateDeck(); // デッキ欄更新
  renderDeckList();//デッキリスト画像更新
  updateDeckSummaryDisplay();//代表カードデッキ情報表示
  updateExchangeSummary();//交換ポイント数更新
}

// 🗑 インデックス指定で削除
function deleteDeckFromIndex(index) {
  const saved = JSON.parse(localStorage.getItem("savedDecks") || "[]");
  if (!saved[index]) return;
  saved.splice(index, 1);
  localStorage.setItem("savedDecks", JSON.stringify(saved));
  updateSavedDeckList();
  renderDeckList();//デッキリスト画像更新
}


// ♻ デッキを完全リセット（メモリも表示も空）
document.getElementById("resetDeckButton")?.addEventListener("click", () => {
  Object.keys(deck).forEach(k => delete deck[k]);
  representativeCd = null; //代表カードリセット
  updateDeck();// デッキ欄更新
  renderDeckList();//デッキリスト画像更新
});


//#endregion