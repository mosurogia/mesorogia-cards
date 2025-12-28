/*======================================================
  1) 冒頭：定数・初期設定・起動処理
======================================================*/
//#region 1. 初期設定・定数定義（DOMContentLoaded など）

// GAS設定（共通定義を利用）
const GAS_POST_ENDPOINT =window.DECKPOST_API_BASE || window.GAS_API_BASE;

// ローカル判定
const IS_LOCAL = location.hostname === '127.0.0.1' || location.hostname === 'localhost';


// 小ユーティリティ（共通で使うため先に置く）
// 既に他ファイルで定義済みの場合は再定義しない
window.$id ??= (id) => document.getElementById(id);
function formatYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${da}`;
}

// === デッキ名 入出力（情報タブ/投稿タブ 共通）===
// グローバル公開してどこからでも使えるようにする
window.readDeckNameInput = function () {
  const info = $id('info-deck-name')?.value?.trim() || '';
  const post = $id('post-deck-name')?.value?.trim() || '';
  return post || info || '';
};

window.writeDeckNameInput = function (name) {
  const v = name || '';
  const info = $id('info-deck-name');
  const post = $id('post-deck-name');
  if (info) info.value = v;
  if (post) post.value = v;
};

// 念のため：同期関数が未定義なら軽量版を用意
if (typeof window.syncDeckNameFields !== 'function') {
  window.syncDeckNameFields = function () {
    // 今は write で双方に入れているので実質 no-op
  };
}



// グローバル代表カード（既存仕様を維持／代表カードモーダルでも使用）
let representativeCd = null;

// === 起動処理 ===
window.addEventListener('DOMContentLoaded', async () => {

  // 0) オートセーブ復元トースト（最優先）
  try {
    DeckAutosave.maybeRestoreFromStorage();
  } catch (e) {
    console.warn('オートセーブ復元に失敗:', e);
  }

  // 1) カード読み込み & 保存デッキ一覧
  try {
    if (typeof loadCards === 'function') await loadCards();
    if (typeof updateSavedDeckList === 'function') updateSavedDeckList();

  } catch (e) { console.error('起動時の初期ロードに失敗:', e); }


  // 2) ロングプレス結線（初期描画をブロックしない）
  const bind = () => window.__bindLongPressForCards?.('deckmaker');
  if ('requestIdleCallback' in window) requestIdleCallback(bind, { timeout: 800 });
  else if ('requestAnimationFrame' in window) requestAnimationFrame(() => setTimeout(bind, 0));
  else setTimeout(bind, 0);
});



//#endregion



/*======================================================
  2) カードデータ生成・一覧表示
======================================================*/
//#region 2. カードデータ生成・一覧表示

/**
 * 単一カードのカード要素（.card）を生成して返す
 * - データ属性は検索・フィルタ・詳細表示のために付与
 * - 画像は lazyload + フォールバック
 * - クリックでデッキに追加、右クリック/ダブルクリックは抑止
 */
function generateCardListElement(card) {
  const cardDiv = document.createElement('div');
  cardDiv.classList.add('card');

  // ---------- data-* 付与（検索・フィルタ・詳細用） ----------
  // 文字列はそのまま、数値は文字列化、真偽は小文字文字列化
  const setData = (key, val) => {
    if (val === undefined || val === null) return;
    cardDiv.setAttribute(key, String(val));
  };

  setData('data-cd', card.cd);
  setData('data-name', card.name);
  setData('data-effect1', card.effect_name1 ?? '');
  setData('data-effect2', card.effect_name2 ?? '');
  setData('data-effecttext1', card.effect_text1 ?? '');
  setData('data-effecttext2', card.effect_text2 ?? '');
  setData('data-race', card.race ?? '');
  setData('data-category', card.category ?? '');
  setData('data-rarity', card.rarity ?? '');
  setData('data-type', card.type ?? '');
  setData('data-cost', card.cost ?? '');
  setData('data-power', card.power ?? '');
  setData('data-pack', card.pack_name ?? '');

  // まとめ検索用（効果名/テキストも含めて連結）
  const _effectJoined = [card.effect_name1, card.effect_text1, card.effect_name2, card.effect_text2]
    .filter(Boolean).join(' ');
  setData('data-effect', _effectJoined);
  setData('data-field', card.field ?? '');
  setData('data-ability', card.special_ability ?? '');

  // フラグ系は true/false を小文字化して格納
  const flagToStr = (v) => String(v ?? '').toLowerCase();
  setData('data-bp', flagToStr(card.BP_flag));
  setData('data-draw', flagToStr(card.draw));
  setData('data-graveyard_recovery', flagToStr(card.graveyard_recovery));
  setData('data-cardsearch', flagToStr(card.cardsearch));
  setData('data-destroy_opponent', flagToStr(card.destroy_opponent));
  setData('data-destroy_self', flagToStr(card.destroy_self));
  setData('data-heal', flagToStr(card.heal));
  setData('data-power_up', flagToStr(card.power_up));
  setData('data-power_down', flagToStr(card.power_down));

  // リンクカード（性能リンク/コラボ対応）
  if (typeof card.link !== 'undefined') setData('data-link', flagToStr(card.link));
  if (typeof card.link_cd !== 'undefined') setData('data-linkcd', card.link_cd);

  // キーワード（簡易全文検索用）
  const keywords = [
    card.name, card.race, card.category, card.type,
    card.field, card.special_ability,
    card.effect_name1, card.effect_text1,
    card.effect_name2, card.effect_text2
  ].filter(Boolean).join(' ').toLowerCase();
  setData('data-keywords', keywords);

  // ---------- UIパーツ ----------
  // 拡大ボタン（インラインonclickは使用せず、addEventListenerに統一）
  const zoomBtn = document.createElement('div');
  zoomBtn.classList.add('zoom-btn');
  zoomBtn.innerText = '🔎';
  zoomBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof handleZoomClick === 'function') handleZoomClick(e, zoomBtn);
  });
  cardDiv.appendChild(zoomBtn);

  // 所持マーク（所持率連携の余地があるため残置）
  const ownedMark = document.createElement('div');
  ownedMark.classList.add('owned-mark');
  cardDiv.appendChild(ownedMark);

  // 画像
  const img = document.createElement('img');
  img.alt = card.name || '';
  img.loading = 'lazy';
  img.src = `img/${card.cd}.webp`;
  img.addEventListener('error', () => {
    if (img.dataset.fallbackApplied) return;
    img.dataset.fallbackApplied = '1';
    img.src = 'img/00000.webp';
  });
  // 左クリックでデッキに追加（ダブル/右クリック抑止）
  img.addEventListener('click', (e) => { e.stopPropagation(); addCard(card.cd); });
  img.addEventListener('contextmenu', (e) => e.preventDefault());
  img.addEventListener('dblclick', (e) => e.preventDefault());
  cardDiv.appendChild(img);

  return cardDiv;
}

/**
 * 詳細領域のHTMLを生成（カード効果を見やすく段組）
 */
function generateDetailHtml(card) {
  const typeClass = `type-${card.type}`;
  const raceClass = `race-${card.race}`;
  const detailId  = `detail-${card.cd}`;

  const effectParts = [];
  if (card.effect_name1) effectParts.push(`<div><strong class="effect-name">${card.effect_name1}</strong></div>`);
  if (card.effect_text1) effectParts.push(`<div>${card.effect_text1}</div>`);
  if (card.effect_name2) effectParts.push(`<div><strong class="effect-name">${card.effect_name2}</strong></div>`);
  if (card.effect_text2) effectParts.push(`<div>${card.effect_text2}</div>`);

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

/**
 * 既存 .card 要素群から cardMap を再構築
 * - パフォーマンス面では JSON 直読みが最適だが、
 *   現行フロー（DOM→map）に合わせて堅牢化
 */
function rebuildCardMap() {
  Object.keys(cardMap).forEach(key => delete cardMap[key]);

  document.querySelectorAll('.card').forEach(cardEl => {
    const cd = cardEl.dataset.cd;
    if (!cd) return;

    // 効果（data-* から復元）
    const en1 = cardEl.dataset.effect1 || '';
    const et1 = cardEl.dataset.effecttext1 || '';
    const en2 = cardEl.dataset.effect2 || '';
    const et2 = cardEl.dataset.effecttext2 || '';

    // リンクカード
    const linkFlag = (cardEl.dataset.link || '').toLowerCase() === 'true';
    const linkCdRaw = cardEl.dataset.linkcd;

    // モーダル表示用（{name,text}[]）
    const effects = [];
    if (en1 || et1) effects.push({ name: en1 || '効果', text: et1 || '' });
    if (en2 || et2) effects.push({ name: en2 || '効果', text: et2 || '' });

    // 数値は安全に整数化（NaN→0）
    const toInt = (v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : 0;
    };

    cardMap[cd] = {
      name: cardEl.querySelector('img')?.alt || '',
      race: cardEl.dataset.race || '',
      packName: cardEl.dataset.pack || 'その他カード',
      category: cardEl.dataset.category || '',
      type: cardEl.dataset.type || '',
      cost: toInt(cardEl.dataset.cost),
      power: toInt(cardEl.dataset.power),
      rarity: cardEl.dataset.rarity || '',
      effectNames: [en1, en2].filter(Boolean),
      effectTexts: [et1, et2].filter(Boolean),
      effects,
      link: linkFlag,
      linkCd: linkCdRaw ? toInt(linkCdRaw) : toInt(cd)
    };
  });
}

/**
 * カード操作モーダルの効果リストを構築
 * - info は effects / effectNames+effectTexts / effect+text のいずれにも対応
 */
function buildCardOpEffects(info) {
  const wrap = document.getElementById('cardOpEffects');
  if (!wrap) return;
  wrap.innerHTML = '';

  let items = [];
  if (Array.isArray(info.effects)) {
    items = info.effects.map(e =>
      (typeof e === 'string') ? { name: '効果', text: e } : { name: e.name || '効果', text: e.text || '' }
    );
  } else if (Array.isArray(info.effectNames) || Array.isArray(info.effectTexts)) {
    const names = info.effectNames || [];
    const texts = info.effectTexts || [];
    const len = Math.max(names.length, texts.length);
    for (let i = 0; i < len; i++) items.push({ name: names[i] || '効果', text: texts[i] || '' });
  } else if (info.effect || info.text) {
    items = [{ name: info.effect || '効果', text: info.text || '' }];
  }

  if (items.length === 0) {
    const d = document.createElement('div');
    d.className = 'eff';
    d.innerHTML = '<div class="eff-name">効果</div><div class="eff-text">（効果情報なし）</div>';
    wrap.appendChild(d);
    return;
  }

  for (const it of items) {
    const d = document.createElement('div');
    d.className = 'eff';
    const name = document.createElement('div');
    name.className = 'eff-name';
    name.textContent = it.name || '効果';
    const text = document.createElement('div');
    text.className = 'eff-text';
    text.textContent = it.text || '';
    d.appendChild(name);
    d.appendChild(text);
    wrap.appendChild(d);
  }
}
//#endregion


/*======================================================
  3) 検索バー・フィルター処理・メニューバー
======================================================*/
//#region 3. フィルター・検索・メニューバー

/*===== 使用不可種族判定（シンプル版） =====*/
//#region hiderace
let hideInvalidRace = false;

// 使用不可種族表示/非表示ボタン
document.getElementById("toggle-invalid-race")?.addEventListener("click", function () {
  hideInvalidRace = !hideInvalidRace;
  this.classList.toggle("active", hideInvalidRace);
  this.textContent = hideInvalidRace
    ? "🚫使用不可種族を非表示"
    : "✅使用不可種族を表示(モノクロ)";
  applyGrayscaleFilter();
});

// 使用不可種族カードをモノクロ化 or 非表示にする
function applyGrayscaleFilter() {
  document.querySelectorAll(".card").forEach(card => {
    const isGrayscale = card.classList.contains("grayscale");
    if (hideInvalidRace && isGrayscale) {
      card.classList.add("hidden-by-grayscale");
    } else {
      card.classList.remove("hidden-by-grayscale");
    }
  });
}
//#endregion hiderace


/* =========================
   所持カードオーバーレイ表示（シンプル版）
   ========================= */
//#region owned-overlay
// ON/OFF 状態（初期OFF：ボタン初期表示と合わせる）
let ownedOverlayOn = false;

// 所持データ取得
// OwnedStore（あれば最優先）→ localStorage の順で読むだけに簡素化
function readOwnedMapForDeckmaker() {
  if (window.OwnedStore?.getAll) return window.OwnedStore.getAll();
  try {
    const raw = JSON.parse(localStorage.getItem('ownedCards') || '{}') || {};
    const norm = {};
    for (const cd in raw) {
      const v = raw[cd];
      norm[cd] = (v && typeof v === 'object')
        ? { normal: v.normal|0, shine: v.shine|0, premium: v.premium|0 }
        : { normal: v|0, shine: 0, premium: 0 };
    }
    return norm;
  } catch {
    return {};
  }
}

// 1枚のカードに所持数バッジを描画（0〜3にクランプ）
function paintOwnedMarkDeckmaker(cardEl, total) {
  const count = Math.max(0, Math.min(3, total | 0));
  const mark = cardEl.querySelector('.owned-mark');

  // 既存の段階クラスをすべて一度剥がす
  cardEl.classList.remove('owned-0', 'owned-1', 'owned-2', 'owned-3');

  if (ownedOverlayOn) {
    cardEl.classList.add('owned');
    // 段階クラスを付与（CSSで濃淡・表示方法を切れ味良く制御可能）
    cardEl.classList.add(`owned-${count}`);

    if (mark) {
      mark.textContent = String(count);
      mark.style.display = 'flex';
      // アクセシビリティ補助（任意）
      mark.setAttribute('aria-label', `所持 ${count} 枚`);
    }
  } else {
    cardEl.classList.remove('owned');
    if (mark) {
      mark.textContent = '';
      mark.style.display = 'none';
      mark.removeAttribute('aria-label');
    }
  }
  cardEl.dataset.count = String(count);
}


// 画面の全カードへ反映
function refreshOwnedOverlay() {
  const ownedMap = readOwnedMapForDeckmaker();
  document.querySelectorAll('#grid .card').forEach(cardEl => {
    const cd = cardEl.dataset.cd;
    const v = ownedMap[cd] || { normal:0, shine:0, premium:0 };
    const total = (v.normal|0) + (v.shine|0) + (v.premium|0);
    paintOwnedMarkDeckmaker(cardEl, total);
  });
}

// トグル（HTMLのonclickからも呼べるようにグローバル公開）
function toggleOwned() {
  ownedOverlayOn = !ownedOverlayOn;

  // 反映前にボタン文言を即時更新
  const btn = document.getElementById('toggleOwnedBtn');
  if (btn) {
    btn.textContent = `所持カード${ownedOverlayOn ? '反映' : '未反映'}`;
    btn.title = ownedOverlayOn ? '所持オーバーレイ表示中' : '所持オーバーレイOFF';
  }

  // 画面反映
  refreshOwnedOverlay();

  // 交換サマリーなどの派生UI更新（存在する場合のみ）
  if (typeof updateExchangeSummary === 'function') updateExchangeSummary();
}


//所持カード初期化
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('toggleOwnedBtn');
  if (btn) btn.textContent = '所持カード未反映';

  // 初期正規化
  refreshOwnedOverlay();

  // #grid 再描画に追従（ONのときのみ）
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

// HTML側から呼べるように公開
window.toggleOwned = toggleOwned;
window.refreshOwnedOverlay = refreshOwnedOverlay;


/*----------------------------------------------
  共有URL（?o=）デコード → ゲスト所持反映
  - v1/v2/v3 の所持データペイロードに対応
  - OwnedStore に反映し、UIはゲストモード化
----------------------------------------------*/
//#region guest-owned-from-query
(() => {
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
      return unpack2bitExact(bytes, orderLen);
    } else if (ver === '2'){
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

  // カード順（cd昇順 / is_latest）
  async function getCanonicalOrderForOwned_DM(){
    if (window.__CARD_ORDER && window.__CARD_ORDER.length) return window.__CARD_ORDER.slice();
    let cards = [];
    try{
      if (typeof fetchLatestCards === 'function'){
        cards = await fetchLatestCards();
      }else{
        const res = await fetch('public/cards_latest.json');
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
    const counts = decodeOwnedCountsFromPayload(payload, order.length);

    if (!window.OwnedStore?.set){
      console.warn('OwnedStore未初期化');
      return;
    }

    // ゲストモード：オートセーブ無効
    if (typeof OwnedStore.setAutosave === 'function') OwnedStore.setAutosave(false);
    window.__guestOwnedActive  = true;
    window.__guestOwnedPayload = payload;

    // 反映
    for (let i=0;i<order.length;i++){
      const cd = String(order[i]);
      const n  = counts[i] & 3;
      OwnedStore.set(cd, { normal: n, shine: 0, premium: 0 });
    }

    // UI更新
    if (typeof window.applyGrayscaleFilter === 'function') window.applyGrayscaleFilter();
    if (typeof window.updateOwnedTotal    === 'function') window.updateOwnedTotal();
    if (typeof window.updateSummary       === 'function') window.updateSummary();

    // ゲストUI適用（ボタン無効化・色変更・所持オーバーレイON）
    markGuestModeUI();
  }

  // ゲストモードのUI反映（ボタン無効化・色変更・所持オーバーレイON）
  function markGuestModeUI() {
    const btn = document.getElementById('toggleOwnedBtn');
    if (btn) {
      btn.textContent = '他人所持データ反映';
      btn.classList.add('guest-mode');
      btn.disabled = true;
      btn.title = '他人の所持データを表示中';
    }
    // 所持オーバーレイをONにして反映
    ownedOverlayOn = true;
    refreshOwnedOverlay();
    if (typeof updateExchangeSummary === 'function') updateExchangeSummary();

    document.querySelectorAll('#grid .owned-mark').forEach(el => {
      el.classList.add('guest-mode');
    });
  }

  // 起動時に ?o= を検出（全スクリプト読了後に実行）
  document.addEventListener('DOMContentLoaded', () => {
    const params  = new URLSearchParams(location.search);
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
})();
//#endregion guest-owned-from-query





//#endregion owned-overlay


/* ===== デッキバー操作（右クリックメニュー抑制） ===== */
//#region deckbar
document.addEventListener("contextmenu", e => {
  const deckBarTop = document.getElementById("deckBarTop");
  if (deckBarTop && deckBarTop.contains(e.target)) e.preventDefault();
});
//#endregion deckbar


/* ===== 分析＆投稿タブ → デッキ投稿 まで一気に移動 ===== */
//#region goToAnalyze
function goToAnalyzeTab() {
  // まず上段タブを「💾 分析＆投稿（edit）」に切り替え
  const tab2 = document.querySelector('#tab2');
  if (tab2 && typeof switchTab === 'function') {
    switchTab('edit', tab2);
  }

  // 次に、分析＆投稿内のサブタブを「デッキ投稿」に切り替え
  // （ボタンに class="post-tab-bar" を付けておく前提）
  const postTabBtn =
    document.querySelector('#deck-info .post-tab-bar') ||
    document.querySelector('#deck-info [onclick*="post-tab"]');

  if (postTabBtn && typeof switchTab === 'function') {
    switchTab('post-tab', postTabBtn);
  }

  // デッキリスト・分析・交換サマリーを更新
  if (typeof renderDeckList === 'function') renderDeckList();
  if (typeof updateDeckAnalysis === 'function') updateDeckAnalysis();
  if (typeof updateExchangeSummary === 'function') updateExchangeSummary();
}
window.goToAnalyzeTab = goToAnalyzeTab;
//#endregion goToAnalyze



/* ===== デッキ情報開閉（ボタン表記同期） ===== */
//#region deckSummary
function toggleDeckSummary() {
  const summary = document.getElementById('deck-summary');
  const btn = document.querySelector('.deck-summary-toggle');
  if (!summary || !btn) return;
  const isOpen = summary.classList.toggle('open');
  btn.textContent = isOpen ? '▶' : '◀';
}

document.addEventListener('DOMContentLoaded', () => {
  const deckSummary = document.getElementById('deck-summary');
  const toggleBtn = document.querySelector('.deck-summary-toggle');
  if (!deckSummary || !toggleBtn) return;

  deckSummary.classList.add('open');
  toggleBtn.textContent = '▶';
  toggleBtn.removeAttribute('onclick'); // inline重複防止
  toggleBtn.addEventListener('click', toggleDeckSummary);
});
//#endregion deckSummary

//#endregion 3. フィルター・検索・メニューバー



/*======================================================
  4) デッキ構築（追加・削除・オートセーブ）
======================================================*/
//#region 4. デッキ構築処理

// === オートセーブ（ローカル保存） ===
const DeckAutosave = (() => { // オートセーブ機能の名前空間
  const AUTOSAVE_KEY = 'deck_autosave_v1';
  let __autosaveDirty = false;          // 初期はクリーン
  let __autosaveJustLoaded = true;      // ロード直後ガード

  window.addEventListener('load', () => {
  // 初期描画やオートフィルが落ち着くまで保存抑止（必要なら 2000〜5000ms で調整）
  setTimeout(() => { __autosaveJustLoaded = false; }, 3000);
  });

  let __autosaveTimer = 0;

  function isDeckEmpty() {// デッキが空か判定
    return !deck || Object.keys(deck).length === 0;
  }

  // 保存用ペイロード生成
  function buildAutosavePayload(){
    const payload = {
      cardCounts: { ...deck },
      m: representativeCd || null,
      name: readDeckNameInput(),
      note: readPostNote(),   // デッキ解説（本文）
      poster: $id('poster-name')?.value?.trim() || '',
      // 貼り付けコード（有効なら保存）
      shareCode: ($id('post-share-code')?.value?.trim() || ''),
      date: formatYmd()
    };

    // --- ユーザータグ ---
    try{
      if (typeof readUserTags === 'function'){
        const tags = readUserTags();
        if (Array.isArray(tags)) payload.userTags = tags;
      }
    }catch(_){}

  // --- 選択タグ（select-tags） ---
  // ※ サイト共通の保持先（localStorage: dm_post_select_tags_v1）を正として取得する
  try{
    if (typeof window.readSelectedTags === 'function'){
      // readSelectedTags() は Set を返す実装なので Array に直す
      payload.selectTags = Array.from(window.readSelectedTags());
    } else if (typeof __fallbackReadSelectTags === 'function'){
      payload.selectTags = __fallbackReadSelectTags();
    }
  }catch(_){}

    // --- カード解説（post-card-notes） ---
    // 取得元の都合で '[]' といった文字列が来る場合があるので空扱い/配列化を統一
    try {
      let notes = null;
      if (typeof readCardNotes === 'function') {
        notes = readCardNotes();
      } else if (typeof __fallbackReadCardNotes === 'function') {
        notes = __fallbackReadCardNotes();
      }

      if (Array.isArray(notes)) {
        payload.cardNotes = notes;
      } else if (typeof notes === 'string') {
        const s = notes.trim();
        if (!s || s === '[]') {
          payload.cardNotes = [];
        } else {
          try {
            const parsed = JSON.parse(s);
            payload.cardNotes = Array.isArray(parsed) ? parsed : [];
          } catch {
            // テキスト1本だけが入っていた場合などは非配列→空扱い
            payload.cardNotes = [];
          }
        }
      } else {
        payload.cardNotes = [];
      }
    } catch(_) {
      payload.cardNotes = [];
    }

    return payload;
  }


  // ==== ユーザータグの Reader/Writer（グローバル定義） ====

  window.readUserTags ??= function(){
    const box = document.getElementById('user-tags');
    if (!box) return [];
    return Array.from(box.querySelectorAll('.chip'))
      .map(ch => ch.dataset.key?.trim() || ch.textContent.trim())
      .filter(Boolean);
  };

  window.writeUserTags ??= function(arr){
    const box = document.getElementById('user-tags');
    if (!box) return;
    const tags = Array.isArray(arr)
      ? Array.from(new Set(arr.map(s => String(s).trim()).filter(Boolean)))
      : [];
    box.innerHTML = '';
    for (const t of tags){
      const chip = document.createElement('span');
      chip.className = 'chip user-chip';
      chip.dataset.key = t;
      chip.textContent = t;
      chip.addEventListener('click', () => {
        chip.remove();
        scheduleAutosave?.();
      });
      box.appendChild(chip);
    }
};

// ===============================
// ★ GAS: 他ユーザーの userTags 候補取得 API
// ===============================
async function fetchUserTagCandidatesFromGAS(keyword = '') {
  try {
    const base = window.DECKPOST_API_BASE || window.GAS_API_BASE;
    const params = new URLSearchParams({
      mode: 'userTags',
      q: keyword,
      limit: 20
    });

    const res = await fetch(`${base}?${params.toString()}`, { method: 'GET' });
    const json = await res.json();
    if (!json || !json.ok) return [];
    return json.tags || [];  // [{tag, count}]
  } catch (e) {
    console.warn('userTags 候補取得に失敗', e);
    return [];
  }
}

// ===============================
// ★ 候補ボックスを再描画する
// ===============================
function renderUserTagSuggestions(localHistory, gasList, usedTags) {
  const box = document.getElementById('user-tag-suggest-box');
  if (!box) return;

  box.innerHTML = '';

  const merged = [];

  // 1. ローカル履歴（あなたが以前使ったタグ）
  localHistory.forEach(t => {
    if (!usedTags.has(t)) {
      merged.push({ tag: t, type: 'recent' });
    }
  });

  // 2. GAS 候補（他ユーザーの人気タグ）
  gasList.forEach(obj => {
    const t = obj.tag;
    if (!usedTags.has(t) && !merged.some(m => m.tag === t)) {
      merged.push({ tag: t, type: 'gas', count: obj.count });
    }
  });

  // ★ 表示する候補は最大5件まで
  const MAX_SUGGEST = 5;
  const list = merged.slice(0, MAX_SUGGEST);

  if (list.length === 0) {
    box.style.display = 'none';
    return;
  }

  // 見出し
  const head = document.createElement('div');
  head.className = 'user-tag-suggest-head';
  // 「最大3個」は“持てるユーザータグ数”なので文言はそのまま
  head.textContent = '候補（クリックで追加・最大3個まで）';
  box.appendChild(head);

  // リスト本体
  list.forEach(obj => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'user-tag-suggest-item';

    const label = document.createElement('span');
    label.className = 'user-tag-suggest-label';
    label.textContent = obj.tag;

    const meta = document.createElement('span');
    meta.className = 'user-tag-suggest-meta';
    meta.textContent =
      obj.type === 'recent'
        ? '最近使ったタグ'
        : (obj.count ? `使用回数 ${obj.count}` : 'みんなのタグ');

    row.appendChild(label);
    row.appendChild(meta);

    row.addEventListener('click', () => {
      const now = readUserTags();
      if (now.length >= 3) return;
      if (now.includes(obj.tag)) return;

      now.push(obj.tag);
      writeUserTags(now);

      if (typeof window.onUserTagAdded === 'function') {
        window.onUserTagAdded(obj.tag);
      }

      const inputEl = document.getElementById('user-tag-input');
      if (inputEl) inputEl.value = '';

      box.style.display = 'none';
      scheduleAutosave?.();
    });

    box.appendChild(row);
  });

  box.style.display = 'block';
}



// ===============================
// ★ 候補ボタンの挙動
// ===============================
async function onUserTagSuggestClicked() {
  const box   = document.getElementById('user-tag-suggest-box');
  const input = document.getElementById('user-tag-input');
  if (!box) return;

  const keyword = (input?.value || '').trim();

  // すでに開いていて、今ロード中でなければ閉じる
  if (box.style.display === 'block' && box.dataset.loading !== '1') {
    box.style.display = 'none';
    return;
  }

  // --- ローディング表示 ---
  box.dataset.loading = '1';
  box.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'user-tag-suggest-loading';
  loading.textContent = '候補を検索中…';
  box.appendChild(loading);
  box.style.display = 'block';

  try {
    // --- ローカル履歴 ---
    const localHistory = typeof getUserTagHistory === 'function'
      ? getUserTagHistory()
      : [];

    // --- GAS から取得 ---
    const gasList = await fetchUserTagCandidatesFromGAS(keyword);

    // --- 既に使っているタグを除外 ---
    const used = new Set(readUserTags());

    // ローディングフラグ解除して描画
    delete box.dataset.loading;
    renderUserTagSuggestions(localHistory, gasList, used);
  } catch (e) {
    console.warn(e);
    delete box.dataset.loading;
    box.innerHTML = '<div class="user-tag-suggest-loading">候補を取得できませんでした</div>';
  }
}


// ===============================
// ★ DOMContentLoaded で候補ボタンにイベントをつける
// ===============================
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('user-tag-suggest');
  if (btn) {
    btn.addEventListener('click', onUserTagSuggestClicked);
  }

  // 入力中でも候補を更新（リアルタイム検索）
  const input = document.getElementById('user-tag-input');
  if (input) {
    input.addEventListener('input', () => {
      const box = document.getElementById('user-tag-suggest-box');
      if (box.style.display === 'block') {
        // 候補が開いているときは随時更新
        onUserTagSuggestClicked();
      }
    });
  }
});


// ==== ユーザータグ：入力・追加のみ（候補は別ハンドラで制御） ====
(function bindUserTagUIOnce(){
  if (window.__bindUserTagUIOnce) return;
  window.__bindUserTagUIOnce = true;

  window.addEventListener('DOMContentLoaded', () => {
    const box    = document.getElementById('user-tags');
    const input  = document.getElementById('user-tag-input');
    const addBtn = document.getElementById('user-tag-add');
    if (!box || !input || !addBtn) return;

    const addTag = (raw) => {
      const v = (raw != null ? String(raw) : input.value).trim();
      if (!v) return;

      const now = new Set(readUserTags());
      if (now.has(v)) {
        input.value = '';
        return;
      }

      now.add(v);
      writeUserTags(Array.from(now));
      if (typeof window.onUserTagAdded === 'function') {
        window.onUserTagAdded(v);
      }

      input.value = '';
      scheduleAutosave?.();
    };

    addBtn.addEventListener('click', () => addTag());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag();
      }
    });
  });
})();




// 変更点：実質「空」のペイロードか判定
function isTrulyEmpty(payload){
  if (!payload || typeof payload !== 'object') return true;

  // デッキが空？
  const cc = payload.cardCounts || {};
  const deckEmpty = !cc || Object.keys(cc).length === 0;

  // 補助: 文字列ベースの "空" 判定（'[]', '{}' も空扱い）
  function _isBlankLike(v) {
    const s = String(v ?? '').trim();
    if (!s) return true;
    if (s === '[]' || s === '{}') return true;
    return false;
  }

  // 代表カード・デッキ名・本文・ポスター名・カード解説・選択/ユーザータグが空？
  const noName   = _isBlankLike(payload.name);
  const noNote   = _isBlankLike(payload.note);
  const noPoster = _isBlankLike(payload.poster);
  const noM      = !payload.m;

  // cardNotes が配列以外（例: '[]' 文字列）の時は空扱いに補正
  let noCardNotes = true;
  if (Array.isArray(payload.cardNotes)) {
    noCardNotes = payload.cardNotes.length === 0;
  } else {
    noCardNotes = _isBlankLike(payload.cardNotes);
  }

  // 選択タグ/ユーザータグ
  const noSelTags  = !(Array.isArray(payload.selectTags) && payload.selectTags.length);
  const noUserTags = !(Array.isArray(payload.userTags)  && payload.userTags.length);

  return deckEmpty && noName && noNote && noPoster && noM && noCardNotes && noSelTags && noUserTags;

}

  //即時保存（空→非空の既存データを潰さない）
  function saveAutosaveNow() {
    try {
      const next = buildAutosavePayload();

// --- 保存条件チェック（変更なしなら上書きしない） ---
const prevRaw = localStorage.getItem(AUTOSAVE_KEY);
let prev = null;
if (prevRaw) {
  try { prev = JSON.parse(prevRaw); } catch(_) {}
}

// 初回ロード直後やユーザー操作なし → 保存しない
if (!__autosaveDirty) return;

// 生成データが空かつ既存が非空 → 上書き抑止
if (isTrulyEmpty(next) && prev && !isTrulyEmpty(prev)) return;

// 既存データと完全一致なら上書き不要（＝変更なし）
if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;

// ここで初めて上書き
localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(next));

    } catch (e) {
      console.warn('autosave failed', e);
    }
  }

  // デバウンス保存。呼ばれた時点で「ユーザー操作あり」とみなす
  function scheduleAutosave() {
    if (__autosaveJustLoaded) return; // ロード直後の誤保存を抑止
    __autosaveDirty = true;
    clearTimeout(__autosaveTimer);
    __autosaveTimer = setTimeout(saveAutosaveNow, 250);
  }



   // クリア
  function clearAutosave() {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
  }

  // 再読込時復元コード
  function loadAutosave(data){
    if (!data || !data.cardCounts) return;

    // デッキ入れ替え
    Object.keys(deck).forEach(k => delete deck[k]);
    Object.entries(data.cardCounts).forEach(([cd, n]) => { deck[cd] = n|0; });

    // 代表カード・デッキ名
    representativeCd = (data.m && deck[data.m]) ? data.m : null;
    writeDeckNameInput(data.name || '');

    // 解説ノート（本文）
    writePostNote(data.note || '');

  // 選択タグ（localStorage に書き込んでから UI を再描画）
  if (Array.isArray(data.selectTags)) {
    // まず DOM 上の選択状態を完全クリア
    const box = document.getElementById('select-tags');
    if (box){
      box.querySelectorAll('.chip').forEach(ch => {
        ch.setAttribute('aria-pressed', 'false');
        ch.classList.remove('selected','active','on');
      });
    }
    // 正規ストレージへ書き込み → 再描画（サイト共通APIがあればそれを使う）
    if (typeof window.writeSelectedTags === 'function') {
      window.writeSelectedTags(data.selectTags);
    } else if (typeof __fallbackWriteSelectTags === 'function') {
      __fallbackWriteSelectTags(data.selectTags);
    }
    // 再描画と装飾
    if (typeof window.renderPostSelectTags === 'function') window.renderPostSelectTags();
    if (typeof window.applySelectTagWrap === 'function')   window.applySelectTagWrap();
  }

  // ユーザータグ
  if (Array.isArray(data.userTags)) {
    if (typeof writeUserTags === 'function') writeUserTags(data.userTags);
  }

  // 貼り付けコード
  if (data.shareCode) {
    try {
      if (typeof window.writePastedDeckCode === 'function') {
        window.writePastedDeckCode(String(data.shareCode || ''));
      } else {
        const hid = document.getElementById('post-share-code');
        if (hid) hid.value = String(data.shareCode || '');
      }
    } catch(_) {}
  }

  // 投稿者名
  try {
    const nameEl = document.getElementById('poster-name');
    const restoredName = (typeof data.poster === 'string')
      ? data.poster
      : (data.poster?.name || '');
    if (nameEl && restoredName) {
      nameEl.value = restoredName; // 復元時は常に上書き
      try { localStorage.setItem('dm_poster_name', restoredName); } catch {}
    }
  } catch(_) {}

// カード解説（復元）
if (data.cardNotes) {
  CardNotes.replace(Array.isArray(data.cardNotes) ? data.cardNotes : []);
}


// ==== カード解説 ====
    // デッキ名（3タブ同期）
    if (typeof window.syncDeckNameFields === 'function') window.syncDeckNameFields();

    // UI更新（スクロール保持）
    withDeckBarScrollKept(() => {
      updateDeck();
      renderDeckList();
    });
    updateDeckSummaryDisplay();
    updateExchangeSummary();
  }




  // 復元トーストUI
  function showToast(message, opts={}){
    const toast = document.createElement('div');
    toast.id = 'restore-toast';

    const msgSpan = document.createElement('span');
    msgSpan.className = 'msg';
    msgSpan.textContent = message;
    toast.appendChild(msgSpan);

    if (opts.action) {
      const btn = document.createElement('button');
      btn.textContent = opts.action.label;
      btn.onclick = () => { opts.action.onClick?.(); toast.remove(); };
      toast.appendChild(btn);
    }
    if (opts.secondary) {
      const btn2 = document.createElement('button');
      btn2.textContent = opts.secondary.label;
      btn2.onclick = () => { opts.secondary.onClick?.(); toast.remove(); };
      toast.appendChild(btn2);
    }

    document.body.appendChild(toast);
    setTimeout(()=>toast.remove(), 15000);
  }

  function maybeRestoreFromStorage(){
    if (window.location.search.includes('fresh=1')) return;

    const autosave = localStorage.getItem(AUTOSAVE_KEY);
    if (!autosave) return;

    try {
      const data = JSON.parse(autosave);
      const saved = data?.cardCounts || {};
      if (!Object.keys(saved).length) return;

      // いまの deck と同一かをざっくり比較
      const now = window.deck || {};
      const sameSize = Object.keys(now).length === Object.keys(saved).length;
      let same = sameSize;
      if (same) {
        for (const k in saved) { if ((now[k]|0) !== (saved[k]|0)) { same = false; break; } }
      }

      const msg = '以前のデータを復元しますか？';

      showToast(msg, {
        action:    { label: '復元する', onClick: () => loadAutosave(data) },
        secondary: { label: '削除する', onClick: () => clearAutosave() }
      });
    } catch(e){}
  }

  // 外部公開
  return {
    saveAutosaveNow,
    scheduleAutosave,
    clearAutosave,
    maybeRestoreFromStorage,
  };
})();

// ==== オートセーブのグローバル別名（後方互換） ====
window.scheduleAutosave  = DeckAutosave.scheduleAutosave;
window.clearAutosave     = DeckAutosave.clearAutosave;
window.saveAutosaveNow   = DeckAutosave.saveAutosaveNow;

/* ====== 選択タグ / カード解説 のフォールバック Reader/Writer ====== */

// 選択タグ（select-tags）フォールバック読取：.chip の data-key かテキストを収集
function __fallbackReadSelectTags(){
  const box = document.getElementById('select-tags');
  if (!box) return [];
  const chips = Array.from(box.querySelectorAll('.chip'));
  const onChips = chips.filter(ch =>
    ch.getAttribute('aria-pressed') === 'true' ||
    ch.classList.contains('selected') ||
    ch.classList.contains('active') ||
    ch.classList.contains('on')
  );
  return onChips.map(ch => ch.dataset.key?.trim() || ch.textContent.trim()).filter(Boolean);
}

// 選択タグフォールバック書込：一致する .chip をON状態に
function __fallbackWriteSelectTags(keys){
  const box = document.getElementById('select-tags');
  if (!box || !Array.isArray(keys)) return;
  const keyset = new Set(keys.map(k=>String(k).trim()));
  box.querySelectorAll('.chip').forEach(ch => {
    const id = ch.dataset.key?.trim() || ch.textContent.trim();
    const on = id && keyset.has(id);
    ch.setAttribute('aria-pressed', on ? 'true' : 'false');
    ch.classList.toggle('selected', on);
    ch.classList.toggle('active', on);
    ch.classList.toggle('on', on);
  });
}

// カード解説フォールバック読取：hidden にJSONがあればそれを使う
function __fallbackReadCardNotes(){
  const hid = document.getElementById('post-card-notes-hidden');
  if (hid && hid.value){
    try{
      const v = JSON.parse(hid.value);
      return v;
    }catch(_){
      return hid.value; // 生文字列でも保存しておく
    }
  }
  // DOMから拾う簡易版（クラスは実装に依存するため最小限）
  const wrap = document.getElementById('post-card-notes');
  if (!wrap) return [];
  const rows = Array.from(wrap.querySelectorAll('[data-cd]'));
  return rows.map(r => ({
    cd: r.dataset.cd,
    text: (r.querySelector('textarea')?.value || '').trim()
  })).filter(it => it.cd || it.text);
}

// カード解説フォールバック書込：hidden 優先、無ければ最低限の再描画
function __fallbackWriteCardNotes(val){
  const hid = document.getElementById('post-card-notes-hidden');
  // 文字列/配列をJSON化してhiddenに反映（既存の描画関数が拾う前提）
  try{
    if (hid){
      if (typeof val === 'string') hid.value = val;
      else hid.value = JSON.stringify(val);
    }
  }catch(_){}
}
// ==== カード解説の Reader/Writer（無ければ用意） ====
window.readCardNotes ??= function(){
  if (typeof __fallbackReadCardNotes === 'function') return __fallbackReadCardNotes();
  const hid = document.getElementById('post-card-notes-hidden');
  try { return hid?.value ? JSON.parse(hid.value) : []; } catch { return []; }
};

window.writeCardNotes ??= function(val){
  // hidden にミラー
  const hid = document.getElementById('post-card-notes-hidden');
  if (hid){
    try { hid.value = (typeof val === 'string') ? val : JSON.stringify(val); } catch {}
  }
  // 最低限：#post-card-notes を直接再描画（簡易）
  const wrap = document.getElementById('post-card-notes');
  if (!wrap) return;
  const arr = Array.isArray(val) ? val : [];
  wrap.innerHTML = '';
  for (const it of arr){
    const row = document.createElement('div');
    row.className = 'card-note-row';
    row.dataset.cd = String(it.cd || '');
    row.innerHTML = `
      <div class="cn-title">CD:${String(it.cd || '')}</div>
      <textarea class="cn-text" rows="2">${(it.text || '').replace(/</g,'&lt;')}</textarea>
    `;
    wrap.appendChild(row);
  }
};



// カード追加（制約チェック→反映→UI同期）
function addCard(cd){
  const card = cardMap[cd];
  if (!card) return;

  const race = card.race || '';
  const raceType = getRaceType(race);
  const isKyuushin = race === '旧神';

  // --- 同名/リンク含め最大3枚 ---
  const groupKey = card.link ? String(card.linkCd) : String(cd);
  let totalGroupCount = 0;
  for (const [id, count] of Object.entries(deck)){
    const other = cardMap[id];
    if (!other) continue;
    const otherGroup = other.link ? String(other.linkCd) : String(id);
    if (otherGroup === groupKey) totalGroupCount += count;
  }
  if (totalGroupCount >= 3) return;

  // --- 旧神: 1種1枚まで（他旧神が居れば不可） ---
  if (isKyuushin){
    if ((deck[cd] || 0) >= 1) return;
    const hasOtherOldGod = Object.keys(deck).some(id => cardMap[id]?.race === '旧神' && id !== cd);
    if (hasOtherOldGod) return;
  }

  // --- メイン種族は1種類のみ ---
  if (raceType === 'main'){
    const currentMainRaces = getMainRacesInDeck();
    const unique = new Set([...currentMainRaces, race]);
    if (unique.size > 1) return;
  }

  // 反映＋UI同期
  deck[cd] = (deck[cd] || 0) + 1;
  withDeckBarScrollKept(() => updateDeck());
  applyGrayscaleFilter?.();

  // ★ オートセーブ（必ず入れる）
  scheduleAutosave?.();
}


// カード削除（soft=false で0枚ならエントリ削除）
function removeCard(cd, { soft = false } = {}){
  const cur = (deck?.[cd] ?? 0) | 0;
  const next = Math.max(0, cur - 1);

  if (!soft && next === 0) delete deck[cd];
  else deck[cd] = next;

  withDeckBarScrollKept(() => updateDeck());
  applyGrayscaleFilter?.();

  // 開いている操作モーダルが対象ならバッジ/ボタンを同期
  if (typeof _cardOpCurrentCd !== 'undefined' && String(_cardOpCurrentCd) === String(cd)){
    updateCardOpCountBadge?.();
    updateCardOpButtons?.();
  }

  // ★ オートセーブ（必ず入れる）
  scheduleAutosave?.();
}


// 一覧: 使用状況の見た目反映
function updateCardDisabling(){
  const deckRaces = new Set();
  let currentOldGod = null;

  // デッキ内の採用種族＆旧神を集計
  for (const cd of Object.keys(deck)){
    const c = cardMap[cd];
    if (!c) continue;
    if (c.race !== 'イノセント' && c.race !== '旧神') deckRaces.add(c.race);
    if (c.race === '旧神') currentOldGod = c.name;
  }

  document.querySelectorAll('.card').forEach(cardEl => {
    const cd = cardEl.dataset.cd;
    const c = cardMap[cd];
    if (!c) return;

    // 使用種族以外（イノセント/旧神は除外）をグレースケール
    const isUnselectedRace = (
      deckRaces.size > 0 &&
      c.race !== 'イノセント' &&
      c.race !== '旧神' &&
      !deckRaces.has(c.race)
    );
    cardEl.classList.toggle('grayscale', !!isUnselectedRace);

    // 使用中ラベル
    let label = cardEl.querySelector('.used-label');
    if (!label){
      label = document.createElement('div');
      label.className = 'used-label';
      cardEl.appendChild(label);
    }
    label.textContent = '';

    if (c.race === '旧神'){
      if (deck[cd]) label.textContent = '旧神使用';
      else if (currentOldGod) label.textContent = '他の旧神を使用中';
    }else{
      const n = deck[cd] || 0;
      if (n > 0) label.textContent = `使用中 ×${n}`;
    }

    // クリック/右クリックで±1（1回だけバインド）
    if (!label.dataset.listenerAttached){
      label.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); removeCard(cd); });
      label.addEventListener('click',       (e) => { e.stopPropagation(); addCard(cd); });
      label.dataset.listenerAttached = 'true';
    }
  });
}


// デッキリスト描画
function renderDeckList() {
  const container    = document.getElementById('deck-card-list');
  const emptyMessage = document.getElementById('deckcard-empty-message');
  if (!container) return;

  // クリア & 空プレースホルダ差し戻し
  container.innerHTML = '';
  if (emptyMessage) container.appendChild(emptyMessage);

  // [cd, count] へ変換 & 並び替え（タイプ→コスト→パワー→cd）
  const entries = Object.entries(deck || {});

  //デッキから代表カードが消えていたら強制リセット
  if (representativeCd && !deck[representativeCd]) {
    representativeCd = null;
    window.representativeCd = null;
  }

  // 並び替えルール定義
  const typeOrder = { 'チャージャー': 0, 'アタッカー': 1, 'ブロッカー': 2 };
  entries.sort((a, b) => {
    const [cdA] = a, [cdB] = b;
    const A = cardMap[cdA], B = cardMap[cdB];
    if (!A || !B) return 0;
    const tA = typeOrder[A.type] ?? 99, tB = typeOrder[B.type] ?? 99;
    if (tA !== tB) return tA - tB;
    const cA = (+A.cost || 0), cB = (+B.cost || 0); if (cA !== cB) return cA - cB;
    const pA = (+A.power|| 0), pB = (+B.power|| 0); if (pA !== pB) return pA - pB;
    return String(cdA).localeCompare(String(cdB));
  });

  // 代表カードの整合性を確定
  // - 今の representativeCd がデッキ内にあればそのまま
  // - デッキから消えていたら「未選択」（null）に戻す
  const representativeExists = entries.some(([cd]) => cd === representativeCd);
  let nextRepresentative = representativeExists ? representativeCd : null;

  // 空表示制御
  if (emptyMessage) emptyMessage.style.display = entries.length === 0 ? 'flex' : 'none';
  if (entries.length === 0) {
    representativeCd = null;
    window.representativeCd = null;
    updateDeckSummaryDisplay?.();
    return;
  }


  // 行DOM生成（代表カードはクラス付与）
  for (const [cd, count] of entries) {
    const card = cardMap[cd];
    if (!card) continue;

    const cardEl = document.createElement('div');
    cardEl.className = 'deck-entry';
    cardEl.dataset.cd     = cd;
    cardEl.dataset.race   = card.race || '';
    cardEl.dataset.type   = card.type || '';
    cardEl.dataset.rarity = card.rarity || '';
    if (cd === nextRepresentative) cardEl.classList.add('representative');

    const img = document.createElement('img');
    img.src = `img/${String(cd).slice(0,5)}.webp`;
    img.alt = card.name || '';
    img.onerror = () => {
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = '1';
      img.src = 'img/00000.webp';
    };
    cardEl.appendChild(img);

    const badge = document.createElement('div');
    badge.className = 'count-badge';
    badge.textContent = `×${count}`;
    cardEl.appendChild(badge);

    container.appendChild(cardEl);
    // ※ 外部ヘルパ：枚数表示の可読サイズ調整
    autoscaleBadgeForCardEl?.(cardEl);
  }

  // 代表カードの最終確定
  representativeCd = nextRepresentative;
  window.representativeCd = representativeCd;

  updateDeckSummaryDisplay?.();     // デッキ情報の表示同期
  updateDeckCardListBackground?.(); // リスト背景（種族等）同期
  updateRepresentativeHighlight();  // 代表カードのハイライト更新
}




// 閉じる（0枚 key 残存時は削除確認）
function closeCardOpModal(){
  const modal = document.getElementById('cardOpModal');
  if (!modal?.classList.contains('show')) return true;

  const n = (window.deck?.[_cardOpCurrentCd] ?? 0);
  if (n === 0 && _cardOpCurrentCd && (_cardOpCurrentCd in (window.deck||{}))) {
    const ok = confirm('このカードをデッキから削除しますか？');
    if (ok) {
      delete deck[_cardOpCurrentCd];
      updateDeck?.();
      renderDeckList?.();
      updateDeckSummaryDisplay?.();
      scheduleAutosave?.();
      // 続行して閉じる
    } else {
      // 削除しない → 1枚に戻して閉じキャンセル
      deck[_cardOpCurrentCd] = 1;
      updateDeck?.();
      renderDeckList?.();
      updateDeckSummaryDisplay?.();
      scheduleAutosave?.();
      updateCardOpCountBadge?.();
      return false;
    }
  }

  modal.classList.remove('show');
  modal.style.display = 'none';
  _cardOpCurrentCd = null;
  return true;
}

// 枚数バッジの同期（リスト側のバッジも即時更新）
function updateCardOpCountBadge(){
  const badge = document.getElementById('cardOpCountBadge');
  const n = window.deck?.[_cardOpCurrentCd] ?? 0;
  if (badge) badge.textContent = '×' + n;

  updateCardOpButtons();

  // デッキリスト（右の縦リスト）
  if (_cardOpCurrentCd) {
    const listBadge = document.querySelector(
      `#deck-card-list .deck-entry[data-cd="${_cardOpCurrentCd}"] .count-badge`
    );
    if (listBadge) listBadge.textContent = '×' + n;

    // ★ デッキバー（上の横スクロール）も同期
    const barBadge = document.querySelector(
      `#deckBarTop .deck-card[data-cd="${_cardOpCurrentCd}"] .count-badge`
    );
    if (barBadge) {
      barBadge.textContent = String(n);
      // サイズ再計算（任意）
      const cardEl = barBadge.closest('.deck-card');
      if (cardEl && typeof autoscaleBadgeForCardEl === 'function') {
        autoscaleBadgeForCardEl(cardEl);
      }
    }
  }
}


// ＋／－／代表ボタン活性（旧神は1枚まで、通常は3枚まで）
function updateCardOpButtons(){
  const plusBtn  = document.getElementById('cardOpInc');
  const minusBtn = document.getElementById('cardOpDec');
  const repBtn   = document.getElementById('cardOpSetRep');

  if (!_cardOpCurrentCd) {
    if (plusBtn)  plusBtn.disabled  = true;
    if (minusBtn) minusBtn.disabled = true;
    if (repBtn)   repBtn.disabled   = true;
    return;
  }
  const info = cardMap[_cardOpCurrentCd];
  const n = deck?.[_cardOpCurrentCd] ?? 0;

  if (plusBtn)  plusBtn.disabled  = (info?.race === '旧神') ? (n >= 1) : (n >= 3);
  if (minusBtn) minusBtn.disabled = (n <= 0);
  if (repBtn)   repBtn.disabled   = !(n > 0);
}

// 0枚でも key は残す（閉じ時に削除判断）
function removeCardSoft(cd){
  const cur  = (+deck?.[cd] || 0);
  const next = Math.max(0, cur - 1);
  deck[cd] = next;
  updateDeckSummaryDisplay?.();
  scheduleAutosave?.();
}

// ===== オートセーブ：タグ/解説の変更を監視して保存 =====
(function bindAutosaveForTagsAndNotes(){
  if (window.__autosaveBound) return;
  window.__autosaveBound = true;

  document.addEventListener('DOMContentLoaded', () => {
    // 選択タグ：クリック/変更で保存
    const sel = document.getElementById('select-tags');
    if (sel){
      sel.addEventListener('click', () => scheduleAutosave?.());
      sel.addEventListener('change', () => scheduleAutosave?.());
    }

    // ユーザータグ：追加/削除ボタンや入力で保存（存在する範囲で拾う）
    const userTagsBox = document.getElementById('user-tags');
    const userTagInput = document.getElementById('user-tag-input');
    const userTagAdd = document.getElementById('user-tag-add');
    if (userTagsBox){
      userTagsBox.addEventListener('click', (e) => {
        // チップの削除×などが想定される
        scheduleAutosave?.();
      });
    }
    if (userTagInput){
      userTagInput.addEventListener('input', () => scheduleAutosave?.());
      userTagInput.addEventListener('change', () => scheduleAutosave?.());
    }
    if (userTagAdd){
      userTagAdd.addEventListener('click', () => scheduleAutosave?.());
    }

    // カード解説：入力や追加/削除で保存
    const notesWrap = document.getElementById('post-card-notes');
    if (notesWrap){
      notesWrap.addEventListener('input', () => scheduleAutosave?.());
      notesWrap.addEventListener('change', () => scheduleAutosave?.());
      notesWrap.addEventListener('click', (e) => {
        // 行の追加・削除ボタンなどが想定される
        const t = e.target;
        if (t && (t.matches('button') || t.closest('button'))) {
          scheduleAutosave?.();
        }
      });
    }

    // hidden にミラーする系（もし更新されるならそれもフック）
    const hiddenNotes = document.getElementById('post-card-notes-hidden');
    if (hiddenNotes){
      hiddenNotes.addEventListener('change', () => scheduleAutosave?.());
      hiddenNotes.addEventListener('input', () => scheduleAutosave?.());
    }
  });
})();



//#endregion



/*======================================================
  5) デッキ情報・デッキリスト
======================================================*/
//#region

//前回メイン種族
let lastMainRace = null;
// #deck-card-list の背景をメイン種族色に
function updateDeckCardListBackground(){
  const listEl = document.getElementById('deck-card-list');
  if (!listEl) return;

  // デッキが空かどうか
  const hasCards = Object.keys(deck).length > 0;

  if (!hasCards){
    lastMainRace = null;
    // 一度リセットしてからデフォルト画像
    listEl.style.removeProperty('backgroundImage');
    listEl.style.removeProperty('backgroundColor');
    listEl.style.backgroundImage = 'url("./img/cardlist.webp")';
    return;

  }

  const mainRace = getMainRace();
  if (mainRace) {
  if (mainRace !== lastMainRace) {
    lastMainRace = mainRace;
    const color = RACE_BG[mainRace] || 'transparent';
    listEl.style.backgroundImage = 'none';
    listEl.style.backgroundColor = color;
  }
  } else {
  // カードはあるがメイン種族が無い場合 → デフォ背景に戻す
  lastMainRace = null;
  listEl.style.removeProperty('backgroundImage');
    listEl.style.removeProperty('backgroundColor');
    listEl.style.backgroundImage = 'url("./img/cardlist.webp")';
  }
}

//枚数表示サイズ調整
function autoscaleBadgeForCardEl(cardEl){
  const img   = cardEl.querySelector('img');
  const badge = cardEl.querySelector('.count-badge');
  if (!img || !badge) return;

  const apply = () => {
    const W   = img.clientWidth || img.naturalWidth || 220; // カードの表示幅
    // ← 好みで係数調整（初期: 幅18% / 高さ12% / 文字7%）
    const bW  = Math.max(20, Math.round(W * 0.18)); // バッジ幅
    const bH  = Math.max(14, Math.round(W * 0.18)); // バッジ高
    const fz  = Math.max(10, Math.round(W * 0.12)); // フォント
    const gap = Math.max(2,  Math.round(W * 0.02)); // 右上の余白

    Object.assign(badge.style, {
      width:        `${bW}px`,
      height:       `${bH}px`,
      fontSize:     `${fz}px`,
      borderRadius: `${Math.round(bH * 0.6)}px`,
      padding:      `0 ${Math.round(bW * 0.15)}px`,
      display:      'flex',
      alignItems:   'center',
      justifyContent:'center',
      top:          `${gap}px`,
      right:        `${gap}px`,
    });
  };

  if (img.complete) apply();
  else img.addEventListener('load', apply, { once: true });
}

function autoscaleAllBadges(){
  document.querySelectorAll('.deck-entry, .deck-card').forEach(autoscaleBadgeForCardEl);
}

// リサイズやレイアウト変化で再計算
window.addEventListener('resize', () => requestAnimationFrame(autoscaleAllBadges));
if (window.ResizeObserver) {
  const target = document.getElementById('deck-card-list');
  if (target) {
    new ResizeObserver(() => requestAnimationFrame(autoscaleAllBadges))
      .observe(target);
  }
}

//#region 代表カード選択モーダル

//代表カード初期化処理
document.addEventListener('DOMContentLoaded', () => {
  ['deck-representative', 'post-representative'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('tap-target');
    el.style.cursor = 'pointer';
    el.title = 'タップして代表カードを選択';
    el.addEventListener('click', openRepSelectModal);
  });

  document.getElementById('repSelectClose')?.addEventListener('click', closeRepSelectModal);
  document.getElementById('repSelectModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'repSelectModal') closeRepSelectModal();
  });
});

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
  let name = "未選択";
  if (representativeCd && cardMap[representativeCd]) {
    name = cardMap[representativeCd].name;//代表カード名
  }

  const infoEl = document.getElementById("deck-representative");
  const postEl = document.getElementById("post-representative");

  if (infoEl) infoEl.textContent = name;
  if (postEl) postEl.textContent = name;
}


//#endregion 代表カード選択モーダル

// 状態
let _cardOpCurrentCd = null;
let _cardOpDrag = { active:false, startX:0, startY:0, startLeft:0, startTop:0 };

// モーダルオープン（anchorRect 近傍に配置）
function openCardOpModal(cd, anchorRect){
  _cardOpCurrentCd = String(cd);
  const info = (window.cardMap || window.allCardsMap || {})[_cardOpCurrentCd];
  if (!info) return;

  const imgEl = document.getElementById('cardOpImg');
  if (imgEl) {
    imgEl.src = `img/${_cardOpCurrentCd.slice(0,5)}.webp`;
    imgEl.alt = info.name || '';
  }
  const titleEl = document.getElementById('cardOpTitle');
  if (titleEl) titleEl.textContent = info.name || 'カード操作';

  updateCardOpCountBadge();
  buildCardOpEffects(info);

  const modal = document.getElementById('cardOpModal');
  const box   = document.getElementById('cardOpModalContent');
  if (!modal || !box) return;

  modal.style.display = 'block';
  modal.classList.add('show');

  // 位置：クリック元の右横（画面内にクランプ）
  const vw = window.innerWidth, vh = window.innerHeight;
  const r = anchorRect || { left: vw/2, right: vw/2, top: vh/2, bottom: vh/2, width:0, height:0 };
  const desiredLeft = (r.right ?? r.left) + 8;
  const desiredTop  = (r.top ?? r.bottom) + 0;
  const left = Math.min(Math.max(8, desiredLeft), vw - box.offsetWidth  - 8);
  const top  = Math.min(Math.max(8, desiredTop ), vh - box.offsetHeight - 8);

  box.style.transform = 'none';
  box.style.left = left + 'px';
  box.style.top  = top  + 'px';
}

// ドラッグ移動（トップライン）
(function initCardOpDrag(){
  const box  = document.getElementById('cardOpModalContent');
  // ドラッグ開始要素を「cardOpHeader 内の .cardop-topline」に限定
  const head = document.querySelector('#cardOpHeader .cardop-topline')
            || document.getElementById('cardOpHeader');
  if (!box || !head) return;

  const onDown = (e)=>{
    // ×ボタン上ではドラッグ開始しない
    if (e.target.closest('#cardOpCloseBtn')) return;
    _cardOpDrag.active = true;
    const rect = box.getBoundingClientRect();
    const pt   = e.touches?.[0] || e;
    _cardOpDrag.startX = pt.clientX;
    _cardOpDrag.startY = pt.clientY;
    _cardOpDrag.startLeft = rect.left;
    _cardOpDrag.startTop  = rect.top;
    box.style.transform = 'none';
    e.preventDefault();
  };

  const onMove = (e)=>{
    if (!_cardOpDrag.active) return;
    const pt = e.touches?.[0] || e;
    const left = _cardOpDrag.startLeft + (pt.clientX - _cardOpDrag.startX);
    const top  = _cardOpDrag.startTop  + (pt.clientY - _cardOpDrag.startY);
    const vw = innerWidth, vh = innerHeight, w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = Math.min(Math.max(left, 8 - w*0.9), vw - 8) + 'px';
    box.style.top  = Math.min(Math.max(top , 8 - h*0.9), vh - 8) + 'px';
  };

  const onUp = ()=>{ _cardOpDrag.active = false; };

  head.addEventListener('mousedown', onDown);
  addEventListener('mousemove', onMove);
  addEventListener('mouseup', onUp);
  head.addEventListener('touchstart', onDown, {passive:false});
  addEventListener('touchmove', onMove, {passive:false});
  addEventListener('touchend', onUp);
})();


// ×ボタン
document.getElementById('cardOpCloseBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  closeCardOpModal();
  renderDeckList?.(); // 画面反映
});


// タブ/サブタブ遷移時は自動クローズ（0枚・削除拒否時は遷移キャンセル）
document.addEventListener('click', (e)=>{
  const t = e.target;
  if (!t) return;
  if (t.closest?.('.tab') || t.closest?.('.subtab-bar .tab')) {
    const ok = closeCardOpModal();
    if (ok === false) { e.preventDefault(); e.stopPropagation(); }
  }
});

// デッキリスト（委譲）：画像タップでモーダル
document.addEventListener('click', (e)=>{
  const cell = e.target.closest?.('.deck-entry');
  if (!cell) return;
  const cd = cell.dataset.cd || cell.getAttribute('data-cd');
  if (!cd) return;
  openCardOpModal(cd, cell.getBoundingClientRect());
});



/* イベント：ボタン群 */
// ===== カード操作モーダル：共通参照 =====
const cardOpModal     = document.getElementById('cardOpModal');
const cardOpContent   = document.getElementById('cardOpModalContent');
const cardOpHeader    = document.getElementById('cardOpHeader');
const cardOpCloseBtn  = document.getElementById('cardOpCloseBtn');

const cardOpTitle        = document.getElementById('cardOpTitle');
const cardOpImg          = document.getElementById('cardOpImg');
const cardOpCountBadge   = document.getElementById('cardOpCountBadge');



/* －／＋／代表登録：ボタン結線 */
const cardOpDecBtn   = document.getElementById('cardOpDec');
const cardOpIncBtn   = document.getElementById('cardOpInc');
const cardOpSetRepBtn= document.getElementById('cardOpSetRep');

function refreshCardOpControls(){
  // 枚数バッジとボタン活性を同期
  updateCardOpCountBadge();   // バッジ更新
  updateCardOpButtons();
  refreshPostSummary();
}

cardOpIncBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!_cardOpCurrentCd) return;
  addCard(_cardOpCurrentCd);  // 既存の上限・種族・旧神チェックは addCard 内で実施
  refreshCardOpControls();
});

cardOpDecBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!_cardOpCurrentCd) return;
  removeCardSoft(_cardOpCurrentCd);
  refreshCardOpControls();

});

cardOpSetRepBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!_cardOpCurrentCd) return;

  // 代表カードに設定（デッキ外は不可にしたいなら if(!(deck?.[_cardOpCurrentCd]>0)) return;）
  representativeCd = _cardOpCurrentCd;
  window.representativeCd = representativeCd;

  // 画面を即時同期
  updateRepresentativeHighlight?.();
  updateDeckSummaryDisplay?.();
  scheduleAutosave?.();

  // お好みでモーダルを閉じるなら↓
  closeCardOpModal();
});



//#endregion



/*======================================================
  6) デッキ情報・分析タブ
======================================================*/
//#region 6. デッキ情報・分析

/*======= デッキメイン種族判別（必要最小限） =====*/
//#region Mainraces
// 種族の種別判定ヘルパー
function getRaceType(race) {
  if (race === "旧神") return "kyuushin";
  if (race === "イノセント") return "innocent";
  if (["ドラゴン", "アンドロイド", "エレメンタル", "ルミナス", "シェイド"].includes(race)) return "main";
  return "other";
}

// メイン種族の定義とヘルパー
const MAIN_RACES = ["ドラゴン", "アンドロイド", "エレメンタル", "ルミナス", "シェイド"];

// メイン種族背景色
const RACE_BG = {
  'ドラゴン':     'rgba(255, 100, 100, 0.16)',
  'アンドロイド': 'rgba(100, 200, 255, 0.16)',
  'エレメンタル': 'rgba(100, 255, 150, 0.16)',
  'ルミナス':     'rgba(255, 250, 150, 0.16)',
  'シェイド':     'rgba(200, 150, 255, 0.16)',
};

// デッキ内に存在するメイン種族を返す
function getMainRacesInDeck() {
  const races = Object.keys(window.deck || {})
    .map(cd => window.cardMap?.[cd]?.race)
    .filter(r => MAIN_RACES.includes(r));
  return [...new Set(races)];
}
// 配列からメイン種族を1つ決める
function computeMainRace() {
  const arr = getMainRacesInDeck();
  if (arr.length <= 1) return arr[0] || null;
  for (const r of MAIN_RACES) if (arr.includes(r)) return r;
  return arr[0] || null;
}

// デッキの代表メイン種族（基本1つ想定）
function getMainRace() {
  const list = getMainRacesInDeck();
  return list[0] || null;
}
//#endregion Mainraces


//#region ========== コア: デッキ描画＆サマリー ==========
/*デッキ情報更新*/
/*説明
 * デッキバーとデッキ情報を更新するメイン関数。
 * デッキ内カードを並び替えて表示し、種族やタイプの内訳を集計する。
 */
function updateDeck(){
  const deckBarTop = document.getElementById('deckBarTop');
  if (!deckBarTop) return;
  deckBarTop.innerHTML = '';

  // --- サマリー集計 ---
  let total = 0;
  const typeCount = { 'チャージャー': 0, 'アタッカー': 0, 'ブロッカー': 0 };
  const races = new Set();
  let hasOldGod = false;

  for (const [cd, count] of Object.entries(deck)){
    const card = cardMap[cd];
    if (!card) continue;
    total += count;
    typeCount[card.type] = (typeCount[card.type] || 0) + count;
    if (card.race !== 'イノセント' && card.race !== '旧神') races.add(card.race);
    if (card.race === '旧神') hasOldGod = true;
  }

  // --- デッキバー横のサマリー ---
  const summary = document.getElementById('deck-summary');
  if (summary){
    const info = summary.querySelector('.deck-info') || (() => {
      const el = document.createElement('div');
      el.className = 'deck-info';
      summary.insertBefore(el, summary.firstChild);
      return el;
    })();
    info.innerHTML = `
      デッキ枚数：${total}/30~40<br>
      使用種族：${races.size > 0 ? Array.from(races).join('/') : 'なし'}<br>
      旧神：${hasOldGod ? '採用中' : '未採用'}<br>
      🔵 ${typeCount['チャージャー']|0} 🟣 ${typeCount['アタッカー']|0} ⚪️ ${typeCount['ブロッカー']|0}
    `;
  }

  // --- 空デッキ時のヘルプ表示＆リセット ---
  if (Object.keys(deck).length === 0){
    deckBarTop.innerHTML = `
      <div id="deck-empty-text">
        <div style="font-size: .7rem;">カード操作</div>
        <div class="deck-help" id="deckHelp">
          <div>【PC】<br>・左クリック：追加<br>・右クリック：削除</div>
          <div>【スマホ】<br>・タップ,上フリック：追加<br>・下フリック：削除<br>・長押し：拡大表示</div>
        </div>
      </div>`;
    updateCardDisabling();
    updateDeckSummary([]);
    updateExchangeSummary();
    requestAnimationFrame(autoscaleAllBadges);
    return;
  }

  // --- 並び替え: タイプ→コスト→パワー→ID ---
  const TYPE_ORDER = { 'チャージャー': 0, 'アタッカー': 1, 'ブロッカー': 2 };
  const entries = Object.entries(deck).sort((a, b) => {
    const [cdA] = a; const [cdB] = b;
    const A = cardMap[cdA], B = cardMap[cdB];
    if (!A || !B) return 0;
    const tA = TYPE_ORDER[A.type] ?? 99;
    const tB = TYPE_ORDER[B.type] ?? 99;
    if (tA !== tB) return tA - tB;
    const cA = (parseInt(A.cost) || 0), cB = (parseInt(B.cost) || 0);
    if (cA !== cB) return cA - cB;
    const pA = (parseInt(A.power) || 0), pB = (parseInt(B.power) || 0);
    if (pA !== pB) return pA - pB;
    return String(cdA).localeCompare(String(cdB));
  });

  // --- デッキバーへ要素追加 ---
  for (const [cd, count] of entries){
    const card = cardMap[cd];
    if (!card) continue;

    const cardEl = document.createElement('div');
    cardEl.className = 'deck-card';
    cardEl.dataset.cd = cd;
    cardEl.dataset.race = card.race;

    const img = document.createElement('img');
    img.src = `img/${String(cd).slice(0,5)}.webp`;
    img.alt = card.name;
    img.onerror = () => {
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = '1';
      img.src = 'img/00000.webp';
    };
    cardEl.appendChild(img);

    const badge = document.createElement('div');
    badge.className = 'count-badge';
    badge.textContent = count;
    cardEl.appendChild(badge);

    // PC: 左追加 / 右削除
    cardEl.addEventListener('mousedown', (e) => {
      if (e.button === 2){ e.preventDefault(); removeCard(cd); }
      else if (e.button === 0){ e.preventDefault(); addCard(cd); }
    });
    cardEl.addEventListener('contextmenu', e => e.preventDefault());

    // モバイル: 上フリック追加 / 下フリック削除
    (function attachTouchSwipe(el, cd){
      let startX = 0, startY = 0;
      const THRESHOLD = 20, MAX_SHIFT = 40;
      const cleanUp = () => { el.style.transform = 'translateY(0)'; el.style.zIndex = ''; };

      el.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY;
        el.style.transition = ''; el.style.zIndex = '2000';
      }, { passive:true });

      el.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - startX; const dy = t.clientY - startY;
        if (Math.abs(dx) > Math.abs(dy)) return; // 横操作優先は無視
        const limited = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, dy));
        el.style.transform = `translateY(${limited}px)`;
      }, { passive:true });

      el.addEventListener('touchend', (e) => {
        const endY = e.changedTouches[0].clientY;
        const diffY = startY - endY; // 上=正, 下=負
        el.style.transition = 'transform .2s ease';
        if (Math.abs(diffY) <= THRESHOLD){ setTimeout(() => { el.style.transition = ''; cleanUp(); }, 200); return; }
        const to = diffY > 0 ? -MAX_SHIFT : MAX_SHIFT;
        el.style.transform = `translateY(${to}px)`;
        setTimeout(() => {
          el.style.transition = ''; cleanUp();
          if (diffY > 0) addCard(cd); else removeCard(cd);
        }, 200);
      }, { passive:true });

      el.addEventListener('touchcancel', () => { cleanUp(); }, { passive:true });
    })(cardEl, cd);

    deckBarTop.appendChild(cardEl);
    autoscaleBadgeForCardEl(cardEl);
  }

  // --- 解析用の配列化 ---
  const deckCards = [];
  for (const [cd, count] of Object.entries(deck)){
    const card = cardMap[cd];
    if (!card) continue;
    for (let i=0;i<count;i++) deckCards.push({ 種族: card.race, タイプ: card.type });
  }

  // --- 各種同期 ---
  updateCardDisabling();
  updateDeckSummary(deckCards);
  updateDeckAnalysis();
  updateExchangeSummary();
  updateDeckCardListBackground();
  scheduleAutosave();
  updateAutoTags();
  if (document.getElementById('select-tags')) renderPostSelectTags();
}
//#endregion


//#regionデッキ情報処理

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
  const countByType = type => deckCards.filter(c => c.タイプ === type).length;

  const nChg = countByType("チャージャー");
  const nAtk = countByType("アタッカー");
  const nBlk = countByType("ブロッカー");

  // 既存の数字だけ表示するスパン（互換のため残す）
  document.getElementById("count-charger") && (document.getElementById("count-charger").textContent = nChg);
  document.getElementById("count-attacker") && (document.getElementById("count-attacker").textContent = nAtk);
  document.getElementById("count-blocker") && (document.getElementById("count-blocker").textContent = nBlk);

  // 🆕 チップUI（type-summary があればそちらに描画）
  const typeWrap = document.getElementById("type-summary");
    if (typeWrap) {
      typeWrap.innerHTML = `
        <span class="type-chip" data-type="チャージャー">チャージャー ${nChg}枚</span>
        <span class="type-chip" data-type="アタッカー">アタッカー ${nAtk}枚</span>
        <span class="type-chip" data-type="ブロッカー">ブロッカー ${nBlk}枚</span>
      `;
    }


  updateAutoTags();//自動タグ
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

// 1行表示（🌈 / 🟡 / ⚪️ / 🟤）
const raritySummary = document.getElementById("rarity-summary");
if (raritySummary) {
  const legend = rarityCounts['レジェンド'];
  const gold   = rarityCounts['ゴールド'];
  const silver = rarityCounts['シルバー'];
  const bronze = rarityCounts['ブロンズ'];

  raritySummary.innerHTML = `
    <span class="rar-item">🌈レジェンド${legend}枚</span>
    <span class="rar-item">🟡ゴールド${gold}枚</span>
    <span class="rar-item">⚪️シルバー${silver}枚</span>
    <span class="rar-item">🟤ブロンズ${bronze}枚</span>
  `;
}

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
// 総コスト
const sumCost = deckCards.reduce((s, c) => s + (c.cost || 0), 0);
const sumCostEl = document.getElementById('total-cost');
if (sumCostEl) sumCostEl.textContent = String(sumCost);

// タイプ別総パワー
let chargerPower = 0;
let attackerPower = 0;
deckCards.forEach(c => {
  if (c.type === "チャージャー") {
    chargerPower += (c.power || 0);
  } else if (c.type === "アタッカー") {
    attackerPower += (c.power || 0);
  }
});

// 旧UI（テキスト）互換は空にしておく
const sumPowerEl = document.getElementById('total-power');
if (sumPowerEl) sumPowerEl.textContent = "";

// 🆕 チップUI（type-summary と同じ仕様）
const powerWrap = document.getElementById('power-summary');
if (powerWrap) {
  powerWrap.innerHTML = `
    <span class="type-chip" data-type="チャージャー">チャージャー ${chargerPower}</span>
    <span class="type-chip" data-type="アタッカー">アタッカー ${attackerPower}</span>
  `;
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

  updateAutoTags();//自動タグ設定

  // 投稿サマリー更新
    if (typeof refreshPostSummary === 'function') {
    refreshPostSummary();
  }
}



/* =========================
   交換ポイント計算と表示（パック別集計版）
   - 未所持枚数 = デッキ要求 - 所持合計(normal+shine+premium)
   - 不足分のみをポイント/ダイヤ/砂に換算
   - ポイントは「パック別の内訳」を表示、ダイヤは合計のみ
========================= */

// 交換レート（既存値）
const EXCHANGE_RATE = {
  point:   { LEGEND: 300,  GOLD: 150,  SILVER: 20,  BRONZE: 10 },
  diamond: { LEGEND: 4000, GOLD: 1000, SILVER: 250, BRONZE: 150 },
  sand:    { LEGEND: 300,  GOLD: 150,  SILVER: 20,  BRONZE: 10 },
};

// レアリティ → キー
function rarityToKeyJP(r) {
  if (!r) return null;
  if (r.includes('レジェ'))  return 'LEGEND';
  if (r.includes('ゴールド')) return 'GOLD';
  if (r.includes('シルバー')) return 'SILVER';
  if (r.includes('ブロンズ')) return 'BRONZE';
  return null;
}

/* ============= packs.json 読み込み（順序ラベル） ============= */
// packs.json の順序・ラベルを共通関数から取得して使う版（common.js の loadPackCatalog を利用）
let __PACK_ORDER = null;
let __PACK_LABELS = {}; // en → 表示ラベル（基本は en のまま）

async function ensurePacksLoaded(){
  if (__PACK_ORDER) return;

  // 1) まず同階層の packs.json を探す
  const tryUrls = ['./public/packs.json'];
  for (const url of tryUrls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();

      // order（表示順）と labels（表示名）を構築
      __PACK_ORDER = Array.isArray(data.order) ? data.order.slice() : [];
      __PACK_LABELS = {};
      if (Array.isArray(data.packs)) {
        data.packs.forEach(p => {
          if (p?.en) __PACK_LABELS[p.en] = p.en; // 今は EN 表示で統一
        });
      }

      return; // 成功
    } catch(e) {
      // 次の候補へ
    }
  }

  // 2) どれも読めなかった場合のフォールバック（最小限）
  console.warn('packs.json を読み込めませんでした。アルファベット順で表示します。');
  __PACK_ORDER = [];     // ← 無順序（render 側で dict のキーを並べ替え）
  __PACK_LABELS = {};

  // 表示順の補完：orderが無い/不足なら末尾に足す
  const mustHave = ['Awaking The Oracle', 'Beyond the Sanctuary', 'Creeping Souls', 'Drawn Sword', 'その他カード', 'コラボカード'];
  __PACK_ORDER = Array.isArray(__PACK_ORDER) ? __PACK_ORDER : [];
  for (const k of mustHave) if (!__PACK_ORDER.includes(k)) __PACK_ORDER.push(k);
}

function getPackLabel(en){ return __PACK_LABELS[en] || en || 'その他カード'; }


/* EN名をカードの pack_name / pack / pack_en から抽出
   例: "Awaking The Oracle「神託者の覚醒」" → "Awaking The Oracle"
   例: "Beyond the Sanctuary／聖域の先へ"   → "Beyond the Sanctuary"
   ※ 無指定や不明な場合は 'その他カード' を返す（'Unknown'は使わない）
*/
function getPackEnName(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'その他カード';
  const i = s.indexOf('「');                 // EN「JP」
  if (i >= 0) return s.slice(0, i).trim() || 'その他カード';
  const slash = s.indexOf('／');            // EN／JP
  if (slash >= 0) return s.slice(0, slash).trim() || 'その他カード';
  return s; // すでに EN 単体（例: "Drawn Sword" / "コラボカード" など）
}

/* ---------- 不足・通貨計算（完成版：この1つだけ残す） ---------- */
function computeExchangeNeeds(){
  const owned = readOwnedMapForDeckmaker?.() || {};
  const sand  = { LEGEND:0, GOLD:0, SILVER:0, BRONZE:0 };
  const packPoint = {};  // パック別のポイント（※コラボは内訳に含めない）
  const shortages = [];  // 未所持カードリスト { cd, name, shortage }
  let pointTotal = 0;
  let diamondTotal = 0;

  for (const [cd, needRaw] of Object.entries(window.deck || {})) {
    // pack_name を確実に拾うため allCardsMap をフォールバックに使う
    const info = (window.cardMap?.[cd]) || (window.allCardsMap?.[cd]);
    if (!info) continue;

    const key = rarityToKeyJP(info.rarity);
    if (!key) continue;

    const v = owned[cd] || { normal:0, shine:0, premium:0 };
    const have = (v.normal|0) + (v.shine|0) + (v.premium|0);
    const shortage = Math.max(0, (needRaw|0) - have);
    if (!shortage) continue;

    // 未所持カード情報を記録
    shortages.push({ cd, name: info.name || cd, shortage });

    // 合計（ポイント・ダイヤ・砂）
    const pt = (EXCHANGE_RATE.point[key]   || 0) * shortage;
    const dm = (EXCHANGE_RATE.diamond[key] || 0) * shortage;
    const sd = (EXCHANGE_RATE.sand[key]    || 0) * shortage;

    pointTotal   += pt;
    diamondTotal += dm;
    sand[key]    += sd;

    // パック別（ポイントのみ集計）— コラボカードは除外
    const packEn = getPackEnName(info.packName || info.pack_name || info.pack || '');
    if (packEn !== 'コラボカード') {
      packPoint[packEn] = (packPoint[packEn] || 0) + pt;
    }
  }

  // packPoints は packPoint のエイリアスとする。shortages も返す。
  const packPoints = packPoint;
  return { pointTotal, diamondTotal, sand, packPoint, packPoints, shortages };
}


/* ---------- パック別ポイントの描画（ポイントのみ） ---------- */
function renderPointByPack(dict){
  const box = document.getElementById('point-by-pack');
  if (!box) return;

  // dict が空 or すべて 0 なら非表示
  const keys = Object.keys(dict || {}).filter(k => (dict[k] | 0) > 0);
  if (!keys.length) {
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }

  // 1) __PACK_ORDER に載っていて、かつ dict に実データがあるもの（順序は packs.json の order）
  const orderedInDict = Array.isArray(__PACK_ORDER)
    ? __PACK_ORDER.filter(en => (dict[en] | 0) > 0)
    : [];

  // 2) __PACK_ORDER に無いが dict に存在するもの（アルファベット順）
  const extras = keys.filter(en => !orderedInDict.includes(en))
                     .sort((a,b)=> a.localeCompare(b));

  const finalOrder = [...orderedInDict, ...extras];

  const html = [];
  for (const en of finalOrder) {
    const val = dict[en] | 0;
    if (!val) continue;
    html.push(`<li>${getPackLabel(en)}：<strong>${val}ポイント</strong></li>`);
  }

  box.innerHTML = `<ul class="by-pack-list-ul">${html.join('')}</ul>`;
  box.style.display = ''; // 表示
}
// ▼ 追加（renderPointByPack の直後でOK）
let __latestPackPoint = null;
function tryRenderPointByPack(dict){
  // dict が来たら更新、来なければ前回値で描画だけ試みる
  if (dict) __latestPackPoint = dict;

  const box = document.getElementById('point-by-pack');
  if (!box || !__latestPackPoint) return;

  // 既存の描画ロジックに委譲
  renderPointByPack(__latestPackPoint);

  // 現在モードがポイント以外なら非表示にして整合
  if (__exchangeModeCompact !== 'point') {
    box.style.display = 'none';
  }
}


/*
 * パック別ポイントの描画（新UI用）
 *
 * computeExchangeNeeds() から取得した packPoint を元にポイント一覧を描画します。
 * 旧UIコードでは未定義の renderByPackList() を呼び出しており、
 * その結果パックごとのポイントが正しく表示されない不具合がありました。
 * 新UIでは本関数を経由して packPoint を取得し、既存の renderPointByPack() へ委譲します。
 */
/*
function renderByPackList() {
  // 最新の交換ポイント情報を取得
  const { packPoint } = computeExchangeNeeds();
  // packPoint を用いて描画
  renderPointByPack(packPoint);
}
*/

/* =========================
   パック内訳の再計算をデッキ更新に追従させるフック
   - 追加/削除/並び替え/復元など、代表的な関数の後に再計算を挿入
   ========================= */
(function wirePackPointAutoRecalc(){
  function recalc(){ try{ updateExchangeSummary(); }catch(e){} }

  function hook(name){
    const fn = window[name];
    if (typeof fn === 'function' && !fn.__packPointHooked){
      const orig = fn;
      window[name] = function(...args){
        const r = orig.apply(this, args);
        try{ recalc(); }catch(e){}
        return r;
      };
      window[name].__packPointHooked = true;
    }
  }

  // よく呼ばれる描画系・読込系の関数をカバー（存在すればフック）
  [
    'renderDeckList',
    'updateDeckAnalysis',
    'updateDeckSummaryDisplay',
    'loadDeckFromStorage',
    'loadDeckFromLocal',
    'restoreDeckFromLocal',
    'applyDeckCode',
    'loadDeckByCode',
  ].forEach(hook);

  // カードロード完了 or 任意の復元イベントにも追従
  window.onCardsLoaded = (function(prev){
    return function(...args){
      if (typeof prev === 'function') prev.apply(this, args);
      recalc();
    };
  })(window.onCardsLoaded);

  window.onDeckRestored = (function(prev){
    return function(...args){
      if (typeof prev === 'function') prev.apply(this, args);
      recalc();
    };
  })(window.onDeckRestored);

  // 最後に一度だけ実行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', recalc, { once:true });
  } else {
    recalc();
  }
})();


/* ---------- 合計表示＋パック別（ポイント）を反映 ---------- */
async function updateExchangeSummary(){
  await ensurePacksLoaded();

  const els = {
    point:    document.getElementById('point-cost'),
    diamond:  document.getElementById('diamond-cost'),
    sandLeg:  document.getElementById('sand-leg'),
    sandGld:  document.getElementById('sand-gld'),
    sandSil:  document.getElementById('sand-sil'),
    sandBro:  document.getElementById('sand-bro'),
  };
  if (!els.point) return;

  const { pointTotal, diamondTotal, sand, packPoint } = computeExchangeNeeds();

  els.point.textContent   = String(pointTotal || 0);
  els.diamond.textContent = String(diamondTotal || 0);
  els.sandLeg.textContent = String(sand.LEGEND || 0);
  els.sandGld.textContent = String(sand.GOLD   || 0);
  els.sandSil.textContent = String(sand.SILVER || 0);
  els.sandBro.textContent = String(sand.BRONZE || 0);

  // パック別（ポイントのみ）
  tryRenderPointByPack(packPoint);

  // ★ 追加：コンパクト行も“現在モードのまま”上書き同期しておく
  if (document.getElementById('exchange-values-compact')) {
    setExchangeCompact({
      point: pointTotal,
      diamond: diamondTotal,
      sand,
      packPoint
    });
  }
}

/* ---------- コンパクト行（トグルは合計のみ切替＋ポイント時は内訳） ---------- */
let __exchangeModeCompact = 'point'; // 'point'|'diamond'|'sand'
function setExchangeCompact(values){
  const wrap = document.getElementById('exchange-values-compact');
  const btn  = document.getElementById('exchange-toggle-btn-compact');
  // ポイントの時だけパック内訳を出す、それ以外は消す
  const packBox = document.getElementById('point-by-pack');
  if (packBox) {
    packBox.style.display = (__exchangeModeCompact === 'point') ? '' : 'none';
  }
  if (!wrap || !btn) return;

  const { point, diamond, sand, packPoint } = values;

  if (__exchangeModeCompact === 'point') {
    // ポイントモード：合計は小さめ、内訳リストを別領域に描画
    wrap.innerHTML = `🟢 必要ポイント：`;
    tryRenderPointByPack(packPoint);
    if (packBox) packBox.style.display = ''; // 見せる
  } else if (__exchangeModeCompact === 'diamond') {
    wrap.innerHTML = `💎 必要ダイヤ：<strong>${diamond|0}個</strong>`;
    if (packBox) { packBox.innerHTML = ''; packBox.style.display = 'none'; }
  } else { // sand
    wrap.innerHTML =
      `🪨 必要砂：
      <div class="point-sand">
        <span class="rar-item">🌈レジェンド${sand?.LEGEND|0}個</span>
        <span class="rar-item">🟡ゴールド${sand?.GOLD|0}個</span>
        <span class="rar-item">⚪️シルバー${sand?.SILVER|0}個</span>
        <span class="rar-item">🟤ブロンズ${sand?.BRONZE|0}個</span>
      </div>`;
    if (packBox) { packBox.innerHTML = ''; packBox.style.display = 'none'; }
  }

  btn.textContent =
    (__exchangeModeCompact === 'point')   ? '🟢 ポイント' :
    (__exchangeModeCompact === 'diamond') ? '💎 ダイヤ'   : '🪨 砂';
}


function toggleExchangeCompact(){
  __exchangeModeCompact =
    (__exchangeModeCompact === 'point')   ? 'diamond' :
    (__exchangeModeCompact === 'diamond') ? 'sand'    : 'point';
  const { pointTotal, diamondTotal, sand, packPoint } = computeExchangeNeeds();
  setExchangeCompact({
    point: pointTotal,
    diamond: diamondTotal,
    sand,
    packPoint
  });
}
window.toggleExchangeCompact = toggleExchangeCompact;

/* ---------- 初期化（DOMContentLoaded） ---------- */
document.addEventListener('DOMContentLoaded', ()=>{
  updateExchangeSummary();
  const { pointTotal, diamondTotal, sand, packPoint } = computeExchangeNeeds();
  setExchangeCompact({
    point: pointTotal,
    diamond: diamondTotal,
    sand,
    packPoint
  });
    // 要素の生成順に負けないよう、最後にもう一度だけ描画を試みる
  tryRenderPointByPack();

});



/* =========================
   🆕 マリガン練習ロジック
   ========================= */

   const RARITY_ICON = { LEGEND:'🌈', GOLD:'🟡', SILVER:'⚪️', BRONZE:'🟤' };
(() => {
  const HAND_SIZE = 4;

    const els = {
    trainer:   document.getElementById('mulligan-trainer'),
    warning:   document.getElementById('mull-warning'),
    hand:      document.getElementById('mull-hand'),
    btn:       document.getElementById('btn-mull-or-reset'),
    remainList:document.getElementById('mull-remaining-by-type'),
  };

  if (!els.trainer) return; // 他ページ安全化

   // 共有（common.js）
  const getDeckObject = () => (window.deck || {});
  const getCardInfo   = (cd) => (window.cardMap?.[String(cd)] || window.allCardsMap?.[String(cd)]);

    // 状態
  const state = {
    pool: [],  // 山札（手札４枚以外のデッキリスト）
    hand: [],  // { cd, selected }
  };

  // cd→枚数 のMapを作る
  function buildDeckCountMap(){
    const deckObj = getDeckObject();
    const map = {};
    for (const cd in deckObj) map[String(cd)] = (deckObj[cd]|0);
    return map;
  }


  // countMap を実カード配列に展開
  function expandFromCountMap(counts){
    const arr = [];
    for (const cd in counts) {
      for (let i=0;i<(counts[cd]|0);i++) arr.push(String(cd));
    }
    return arr;
  }
  // 「現在の手札4枚を除いた山」を作る
  function buildPoolExcludingCurrentHand(){
    const counts = buildDeckCountMap();
    // 手札分を引いて除外（同名が複数あればその枚数ぶん引く）
    state.hand.forEach(h => {
      const cd = String(h.cd);
      if (counts[cd] > 0) counts[cd]--;
    });
    return shuffleInPlace(expandFromCountMap(counts));
  }

    // シャッフル＆1枚引く
  function shuffleInPlace(arr){
    for (let i=arr.length-1; i>0; i--){
      const j = (Math.random()* (i+1))|0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function drawOne(){
    // state.pool から1枚引く
    if (!state.pool.length) return null;
    return state.pool.pop();
  }

  // 初期配り（※毎回の「手札リセット」でdiscardedはリセット）
  function dealInitialHand(){
    // 初期はデッキ全体から引く
  state.pool = shuffleInPlace(expandFromCountMap(buildDeckCountMap()));
    state.hand = [];

    for (let i=0; i<HAND_SIZE; i++){
      const cd = drawOne();
      if (!cd) break;
      state.hand.push({ cd, selected:false });
    }
    renderHand();
    refreshUI();
  }

    // 手札描画
  function renderHand(){
    els.hand.innerHTML = '';
    state.hand.forEach((slot) => {
      const wrap = document.createElement('div');
      wrap.className = 'card-thumb';
      wrap.dataset.selected = slot.selected ? 'true' : 'false';

      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.loading  = 'lazy';
      img.src      = `img/${slot.cd}.webp`;
      img.onerror  = function(){
        this.remove();
        const title = document.createElement('div');
        title.className = 'title-fallback';
        const info = getCardInfo(slot.cd);
        title.textContent = info?.name ? `${info.name}（${slot.cd}）` : `No Image (${slot.cd})`;
        wrap.appendChild(title);

        const errImg = document.createElement('img');
        errImg.alt = '';
        errImg.src = 'img/00000.webp';
        errImg.style.display = 'none';
        wrap.appendChild(errImg);
      };

      // タップで選択トグル
      wrap.addEventListener('click', () => {
        slot.selected = !slot.selected;
        wrap.dataset.selected = slot.selected ? 'true' : 'false';
        refreshUI();
      });

      wrap.appendChild(img);
      els.hand.appendChild(wrap);
    });
  }


  // タイプ別：残り山枚数
function tallyPoolByType() {
  // 手札を除いた最新の山で集計
  const livePool = buildPoolExcludingCurrentHand();
  const counts = { 'チャージャー': 0, 'アタッカー': 0, 'ブロッカー': 0 };
  const map = window.cardMap || window.allCardsMap || {};
  for (const cd of livePool) {
    const t = map[String(cd)]?.type;
    if (t === 'チャージャー' || t === 'アタッカー' || t === 'ブロッカー') counts[t]++;
  }
  return counts;
}

function renderRemainingByType() {
  if (!els.remainList) return;
  const types = [
    { key: 'チャージャー', label: 'チャージャー' },
    { key: 'アタッカー',   label: 'アタッカー' },
    { key: 'ブロッカー',   label: 'ブロッカー' },
  ];
  const counts = tallyPoolByType();
  els.remainList.innerHTML = '';

  for (const t of types) {
    const n = counts[t.key] ?? 0;
    const li = document.createElement('li');
    li.className = 'mrt-chip compact';
    li.dataset.type = t.key;

    // ← 文字と数字を分けて入れる（数字は常に見える）
    li.innerHTML = `<span class="mrt-name">${t.label}</span><span class="mrt-count">${n}</span>`;

    els.remainList.appendChild(li);
  }
}



// ウィンドウサイズ変更時にも更新
window.addEventListener('resize', () => {
  if (typeof renderRemainingByType === 'function') {
    renderRemainingByType();
  }
});


  // UI活性とボタン文言切替（単一ボタン仕様）
  function refreshUI(){
    const deckSize = Object.values(getDeckObject()).reduce((a,b)=>a+(b|0),0);
    const hasDeck  = deckSize >= 30;
    const anySelected = state.hand.some(h => h.selected);
    const canReset    = hasDeck && deckSize >= HAND_SIZE;
    const canMull     = hasDeck && anySelected && state.pool.length > 0;

    // 警告
      if (!hasDeck) {
    if (els.hand) els.hand.innerHTML = '';      // 手札のカードを消す
    if (els.hand) els.hand.style.display = 'none'; // 非表示
    if (els.warning) els.warning.hidden = false;   // 警告ON
  } else {
    if (els.hand) els.hand.style.display = '';     // 通常表示
    if (els.warning) els.warning.hidden = true;    // 警告OFF
  }

    // 文言
    if (els.btn) {
      els.btn.textContent = anySelected
        ? `${state.hand.filter(h => h.selected).length}枚マリガンする`
        : '手札リセット';
      // 活性
      els.btn.disabled = anySelected ? !canMull : !canReset;
    }

    renderRemainingByType();
  }

  // マリガン（“今回”返したカードだけ抽選から除外）
  function doMulligan(){
    // 現在手札を除いた山を作り直す
  let pool = buildPoolExcludingCurrentHand();
  // 置き換え対象のインデックスを先に列挙
  const targets = [];
  for (let i=0;i<state.hand.length;i++) if (state.hand[i].selected) targets.push(i);
  // 選択枚数ぶん、poolから順番に補充（同一回の重複を避けるためpop）
  for (const pos of targets) {
    const next = pool.pop(); // 無ければ undefined
    if (!next) break;        // 引けなければそこで終了（見た目は据え置き）
    state.hand[pos].cd = next;
    state.hand[pos].selected = false;
  }

    renderHand();
    refreshUI();
  }

  // 手札リセット（discardedをクリア → デッキから再配り）
  function resetHand(){ dealInitialHand(); }

  // 単一ボタン：選択0→リセット / 1〜4→マリガン
  els.btn?.addEventListener('click', () => {
    const anySelected = state.hand.some(h => h.selected);
    if (anySelected) doMulligan();
    else resetHand();
  });

  // デッキ側の更新に追従
  const hookOnce = (name, wrapper) => {
    const fn = window[name];
    if (typeof fn === 'function' && !fn.__mull_hooked){
      const orig = fn;
      window[name] = function(...args){
        const r = orig.apply(this, args);
        try { wrapper(); } catch {}
        return r;
      };
      window[name].__mull_hooked = true;
    }
  };
  hookOnce('renderDeckList',        () => dealInitialHand());
  hookOnce('updateDeckAnalysis',    () => dealInitialHand());
  hookOnce('updateDeckSummaryDisplay', () => dealInitialHand());

  // カードロード完了時
  window.onCardsLoaded = (function(prev){
    return function(...args){
      if (typeof prev === 'function') prev.apply(this, args);
      dealInitialHand();
    };
  })(window.onCardsLoaded);

  // タブ移動（情報タブに入ったら更新）
  const origAfter = window.afterTabSwitched;
  window.afterTabSwitched = function(targetId){
    if (typeof origAfter === 'function') origAfter(targetId);
    if (targetId === 'info-tab' || targetId === 'edit') {
      dealInitialHand();
    }
  };

  // 初回
  dealInitialHand();
})();




// 所持データが変わったら自動で再計算（OwnedStore.onChange があるので利用）
if (window.OwnedStore?.onChange) {
  window.OwnedStore.onChange(() => updateExchangeSummary());
}

// ===== 不足カードをレアリティ別に集計 =====
function groupShortageByRarity(shortages){
  const sum = { LEGEND:0, GOLD:0, SILVER:0, BRONZE:0 };
  if (!Array.isArray(shortages)) return sum;
  shortages.forEach(s=>{
    const info = cardMap[s.cd] || {};
    const key = rarityToKeyJP(info.rarity);
    if (key) sum[key] += (s.shortage|0);
  });
  return sum;
}

/** コンパクト不足UIの描画 */
function renderShortageCompact(shortages){
  const line  = document.getElementById('shortage-summary-line');
  const list  = document.getElementById('shortage-collapsible');
  if (!line || !list) return;

  const sum = groupShortageByRarity(shortages);

  // リスト描画
  line.innerHTML = `
    <span class="rar-item">${RARITY_ICON.LEGEND}レジェンド${sum.LEGEND}枚</span>
    <span class="rar-item">${RARITY_ICON.GOLD}ゴールド${sum.GOLD}枚</span>
    <span class="rar-item">${RARITY_ICON.SILVER}シルバー${sum.SILVER}枚</span>
    <span class="rar-item">${RARITY_ICON.BRONZE}ブロンズ${sum.BRONZE}枚</span>
  `;

    // 🔽🔽 ここを追加：リストを毎回リセットしてから描画
    list.innerHTML = '';

  // 空ならメッセージだけを 1 回だけ表示
  if (!shortages.length) {
  list.textContent = '不足はありません';
  return;
  }

  // 空でないときだけヒントを入れる
  const hint = document.createElement('div');
  hint.className = 'shortage-hint';
  hint.textContent = 'タップ/クリックでカード表示';
  list.appendChild(hint);


  const typeOrder = { 'チャージャー':0, 'アタッカー':1, 'ブロッカー':2 };
  const sorted = shortages.slice().sort((a,b)=>{
    const A = cardMap[a.cd] || {}, B = cardMap[b.cd] || {};
    const tA = typeOrder[A.type] ?? 99, tB = typeOrder[B.type] ?? 99;
    if (tA !== tB) return tA - tB;
    const cA = (parseInt(A.cost)||0), cB = (parseInt(B.cost)||0); if (cA !== cB) return cA - cB;
    const pA = (parseInt(A.power)||0), pB = (parseInt(B.power)||0); if (pA !== pB) return pA - pB;
    return String(a.cd).localeCompare(String(b.cd));
  });

  sorted.forEach(({cd, name, shortage}) => {
  const info = cardMap[cd] || {};
  const rkey = rarityToKeyJP(info.rarity);
  const icon = rkey ? RARITY_ICON[rkey] : '';
  const row  = document.createElement('div');
  row.className = 'shortage-item';
  row.dataset.cd = cd; // ← 5桁cdで画像を出すためココに保持
    row.innerHTML = `
    <span class="rar">${icon}</span>
    <span class="title" role="button" tabindex="0">${name || cd}</span>
    <span class="need">×${shortage}</span>
  `;
  list.appendChild(row);
});

  // ==== 画像プレビュー（デリゲーションで一度だけ結線）====

  const pop = document.getElementById('card-preview-pop');

  if (!window.__shortagePreviewWired) {
  window.__shortagePreviewWired = true;

  // クリックは「.title」だけをトリガー
  list.addEventListener('click', (e) => {
    // ★ クリック元が .title かどうかを厳密に判定
    const titleEl = e.target.closest('.title');
    if (!titleEl) return;

    e.stopPropagation();

    const item = titleEl.closest('.shortage-item');
    const cd = item?.dataset.cd;
    if (!cd) return;

    const x = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
    const y = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0;

    showCardPreviewAt(x, y, cd);
  }, { passive: true });

  // キーボード操作（Enter/Space）でも .title から開けるように
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const titleEl = e.target.closest('.title');
    if (!titleEl) return;

    e.preventDefault();
    e.stopPropagation();

    const item = titleEl.closest('.shortage-item');
    const cd = item?.dataset.cd;
    if (!cd) return;

    // キー操作時はタイトル要素の位置周辺に出す
    const rect = titleEl.getBoundingClientRect();
    const x = rect.right;
    const y = rect.bottom;
    showCardPreviewAt(x, y, cd);
    const vw = window.innerWidth, vh = window.innerHeight, r = pop.getBoundingClientRect();
    let nx = Math.min(Math.max(x, 8), vw - r.width - 8);
    let ny = Math.min(Math.max(y, 8), vh - r.height - 8);
    pop.style.left = nx + 'px'; pop.style.top = ny + 'px';
  });
}

}


// ==== 未所持カード画像プレビュー共通層 ====
function ensureCardPreviewLayer() {
  if (document.getElementById('card-preview-pop')) return;
  const el = document.createElement('div');
  el.id = 'card-preview-pop';
  el.style.position = 'fixed';
  el.style.display = 'none';
  el.style.zIndex = 3000;
  el.innerHTML = `<img style="max-width:200px;border-radius:6px;box-shadow:0 0 8px rgba(0,0,0,.5);" />`;
  document.body.appendChild(el);
}
function showCardPreviewAt(x, y, cd) {
  ensureCardPreviewLayer();
  const box = document.getElementById('card-preview-pop');
  const img = box.querySelector('img');

  // 画像セット（5桁→webp、なければ 00000 へフォールバック）
  const src = `img/${String(cd).slice(0,5)}.webp`;
  img.onload = null;
  img.onerror = () => { img.onerror = null; img.src = 'img/00000.webp'; };
  img.src = src;

  // 位置計算（はみ出し防止）
  const PAD = 8;
  const vw = window.innerWidth, vh = window.innerHeight;
  const W  = 200, H = 280; // だいたいの最大想定
  let left = x + PAD, top = y + PAD;
  if (left + W > vw) left = Math.max(PAD, x - W - PAD);
  if (top + H > vh) top = Math.max(PAD, vh - H - PAD);

  box.style.left = `${left}px`;
  box.style.top  = `${top}px`;
  box.style.display = 'block';
}
function hideCardPreview() {
  const box = document.getElementById('card-preview-pop');
  if (box) box.style.display = 'none';
}
// 画面のどこかをクリックしたら閉じる（プレビュー上のクリックは除外）
document.addEventListener('click', (e) => {
  const pop = document.getElementById('card-preview-pop');
  if (pop && pop.style.display !== 'none' && !e.target.closest('#card-preview-pop')) {
    hideCardPreview();
  }
});


/*未所持リスト閉じるorタブ切り替え時にプレビュー閉じる*/
document.getElementById('shortage-toggle-btn')?.addEventListener('click', ()=> hideCardPreview());
document.addEventListener('deckTabSwitched', ()=> hideCardPreview()); // 既存フックが無ければ afterTabSwitched 内で直接呼んでもOK




/** まとめ：計算→新UI描画 */
function renderOwnedInfoCompact(){
  const ownedBox = document.getElementById('owned-info');
  if (!ownedBox) return;

  const { pointTotal, diamondTotal, sand, shortages, packPoint } = computeExchangeNeeds();

  // 未所持リスト（レアリティ枚数サマリ＋カード行）
  renderShortageCompact(shortages);
  // 合計のコンパクト表示（ポイント/ダイヤ/砂）
  // ★ ポイント時の内訳描画に必要な packPoint も渡す
  setExchangeCompact({ point: pointTotal, diamond: diamondTotal, sand, packPoint });
}


// 所持データがあるか？（OwnedStore優先、なければ localStorage）
function hasOwnedData() {
  // 1) OwnedStore
  if (window.OwnedStore?.getAll) {
    const all = window.OwnedStore.getAll() || {};
    for (const cd in all) {
      const v = all[cd] || {};
      const total = (v.normal|0) + (v.shine|0) + (v.premium|0);
      if (total > 0) return true;
    }
  }
  // 2) localStorage フォールバック
  try {
    const raw = JSON.parse(localStorage.getItem('ownedCards') || '{}') || {};
    for (const cd in raw) {
      const v = raw[cd];
      if (typeof v === 'object') {
        if ((v.normal|0) + (v.shine|0) + (v.premium|0) > 0) return true;
      } else if ((v|0) > 0) {
        return true;
      }
    }
  } catch {}
  return false;
}

/** 所持データの有無に合わせた表示制御 */
function updateOwnedInfoVisibility(){
  const box = document.getElementById('owned-info');
  if (!box) return;
  const show = hasOwnedData();   // ← ownedOverlayOn ではなく所持データの有無で判定
  box.style.display = show ? '' : 'none';
}

/* 初期化：ボタンイベントと初期描画 */
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('shortage-toggle-btn')?.addEventListener('click', ()=>{
    const area = document.getElementById('shortage-collapsible');
    if (!area) return;
    const now = area.hasAttribute('hidden');
    if (now) area.removeAttribute('hidden'); else area.setAttribute('hidden','');
  });
  document.getElementById('exchange-toggle-btn-compact')?.addEventListener('click', toggleExchangeCompact);

  // 初期表示
  renderOwnedInfoCompact();
  updateOwnedInfoVisibility();
});

/* 所持ON/OFF・計算更新のたびに同期 */
const _oldToggleOwned = window.toggleOwned;
window.toggleOwned = function(){
  _oldToggleOwned?.();
  renderOwnedInfoCompact();
  updateOwnedInfoVisibility();
};
const _oldUpdateExchangeSummary = window.updateExchangeSummary;
window.updateExchangeSummary = function(){
  _oldUpdateExchangeSummary?.();
  renderOwnedInfoCompact();
  updateOwnedInfoVisibility();
};

/* 分析タブへ移動したときも同期 */
const _goToAnalyzeTab = window.goToAnalyzeTab;
window.goToAnalyzeTab = function(){
  _goToAnalyzeTab?.();
  renderOwnedInfoCompact();
  updateOwnedInfoVisibility();
};

/* 所持データ変更イベント（OwnedStoreがあれば） */
if (window.OwnedStore?.onChange) {
  window.OwnedStore.onChange(()=>{
    renderOwnedInfoCompact();
    updateOwnedInfoVisibility();
  });
}




// グローバル公開（HTMLの onclick から使う）

window.updateExchangeSummary = updateExchangeSummary;

window.updateDeckAnalysis = updateDeckAnalysis;





// deck & cardMap から並び順に展開（タイプ→コスト→パワー→cd）
function getDeckCardsArray(){
  const entries = Object.entries(deck);
  const TYPE_ORDER = {'チャージャー':0,'アタッカー':1,'ブロッカー':2};
  entries.sort((a,b)=>{
    const A = cardMap[a[0]]||{}, B = cardMap[b[0]]||{};
    const tA = TYPE_ORDER[A.type] ?? 99, tB = TYPE_ORDER[B.type] ?? 99;
    if (tA !== tB) return tA - tB;
    const cA = (A.cost|0), cB = (B.cost|0); if (cA !== cB) return cA - cB;
    const pA = (A.power|0), pB = (B.power|0); if (pA !== pB) return pA - pB;
    return String(a[0]).localeCompare(String(b[0]));
  });
  const out = [];
  for (const [cd, count] of entries) for (let i=0;i<count;i++) out.push(cd);
  return out;
}


/*デッキ名同期
* デッキ情報のデッキ名とデッキ投稿のデッキ名が同じになるようにする
* 未設定時は「デッキリスト」を既定表示
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const infoNameEl = $('info-deck-name');
  const postNameEl = $('post-deck-name');
  const titleEl    = $('note-side-title');

  // 双方向同期：info/post → 両方、タイトルは空なら空のまま（CSSで“デッキリスト”表示）
  function setBoth(val) {
    const v = val ?? '';
    if (infoNameEl && infoNameEl.value !== v) infoNameEl.value = v;
    if (postNameEl && postNameEl.value !== v) postNameEl.value = v;
    if (titleEl) {
      titleEl.textContent = v; // 空の時は空文字 → :empty::before で“デッキリスト”が出る
    }
  }

  // 入力欄→相互反映
  infoNameEl?.addEventListener('input', () => { setBoth(infoNameEl.value.trim()); scheduleAutosave?.(); });
  postNameEl?.addEventListener('input', () => { setBoth(postNameEl.value.trim()); scheduleAutosave?.(); });

  // ===== タイトルをその場編集 =====
  function selectAll(el){
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  function beginEdit(){
    if (!titleEl || titleEl.isContentEditable) return;
    titleEl.dataset.prev = titleEl.textContent.trim();
    titleEl.contentEditable = 'true';
    titleEl.focus();
    selectAll(titleEl);
  }
  function commitEdit(ok=true){
    if (!titleEl || !titleEl.isContentEditable) return;
    titleEl.contentEditable = 'false';
    const next = ok ? titleEl.textContent.trim() : (titleEl.dataset.prev || '');
    // commit: 両入力にも反映。空ならタイトルは空文字（見た目は“デッキリスト”）
    setBoth(next);
    scheduleAutosave?.();
  }

  // クリックで編集開始
  titleEl?.addEventListener('click', (e) => {
    // 既に編集中なら無視
    if (titleEl.isContentEditable) return;
    beginEdit();
  });

  // Enterで確定 / Escでキャンセル / フォーカス外れたら確定
  titleEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commitEdit(false); }
  });
  titleEl?.addEventListener('blur', () => commitEdit(true));

  // 外部からの同期（復元トーストの“復元する”押下時などで呼ぶ）
  window.syncDeckNameFields = function () {
    const name = (postNameEl?.value?.trim()) || (infoNameEl?.value?.trim()) || '';
    setBoth(name);
  };

  // 初期同期：読み込み直後に一度（空ならタイトルは空＝“デッキリスト”表示）
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => window.syncDeckNameFields?.(), { once: true });
  } else {
    window.syncDeckNameFields?.();
  }
})();



// ===== deck-code-controls が画面に見えていない時だけ、画面下に“浮遊バー”を出す（モバイル用） =====
(function setupFloatingDeckControls(){
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

  // ★ 現在のタブ状態を判定（afterTabSwitchedの仕様と一致させる）
  function isDeckAnalysisInfoOpen() {
    const analysisTab = document.getElementById('edit');
    const infoTab = document.getElementById('info-tab');
    return (
      analysisTab?.classList.contains('active') &&
      infoTab?.classList.contains('active')
    );
  }

  function ensureFloating() {
    let float = document.getElementById('deck-code-controls-float');
    if (float) return float;
    const original = document.querySelector('.deck-code-controls');
    if (!original) return null;

    float = document.createElement('div');
    float.id = 'deck-code-controls-float';
    float.className = 'deck-code-controls floating';
    float.innerHTML = original.innerHTML;
    document.body.appendChild(float);

    float.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.preventDefault();

      const floatBtns = Array.from(float.querySelectorAll('button'));
      const idx = floatBtns.indexOf(btn);
      if (idx < 0) return;

      const origBtns = Array.from(original.querySelectorAll('button'));
      if (origBtns[idx]) origBtns[idx].click();
    });
    return float;
  }

  function installObserver() {
    const original = document.querySelector('.deck-code-controls');
    const float = ensureFloating();
    if (!original || !float) return;

    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];

      // ★ 新しい条件：モバイル＆「デッキ分析」＋「デッキ情報」タブが開いている時のみ有効
      if (!isMobile() || !isDeckAnalysisInfoOpen()) {
        float.style.display = 'none';
        return;
      }

      // 元のコントロールが画面内に見えていない時だけ出す
      if (entry.isIntersecting) {
        float.style.display = 'none';
      } else {
        float.style.display = 'flex';
      }
    }, { root: null, threshold: 0.01 });

    io.observe(original);

    // タブ切替時にも即座に状態更新
    document.addEventListener('click', (e) => {
      if (e.target.closest('.tab')) {
        setTimeout(() => {
          const rect = original.getBoundingClientRect();
          const visible = rect.top < window.innerHeight && rect.bottom > 0;
          float.style.display = (isMobile() && !visible && isDeckAnalysisInfoOpen()) ? 'flex' : 'none';
        }, 200);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installObserver, { once: true });
  } else {
    installObserver();
  }
})();



//#endregion


// ===== Deck Peek：モバイルで分析中にデッキリストが見えていない時、左上のボタン長押しでミニリストを表示 =====
(function setupDeckPeek(){
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

  // 「デッキ分析」タブが開いているか（ info/post サブタブは不問）
  function isEditTabOpen() {
    const analysisTab = document.getElementById('edit');
    return !!analysisTab?.classList.contains('active');
  }

  // 要素生成（1回だけ）
  function ensureNodes(){
    let btn = document.getElementById('deckpeek-button');
    let pane = document.getElementById('deckpeek-overlay');

    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'deckpeek-button';
      btn.type = 'button';
      btn.textContent = 'デッキ表示';
      document.body.appendChild(btn);
    }
    if (!pane) {
      pane = document.createElement('div');
      pane.id = 'deckpeek-overlay';
      pane.innerHTML = `<div class="deckpeek-grid" id="deckpeek-grid"></div>`;
      document.body.appendChild(pane);
    }
    return { btn, pane };
  }

  // いまの deck を最小DOMでレンダリング（軽量）
  function renderDeckPeek(){
    const grid = document.getElementById('deckpeek-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // 並び順は「タイプ→コスト→パワー→cd」（既存の getDeckCardsArray に合わせる）
    const cds = (typeof getDeckCardsArray === 'function') ? getDeckCardsArray() : [];
    if (!cds.length) {
      grid.innerHTML = '<div style="padding:6px;color:#666;font-size:12px;">デッキが空です</div>';
      return;
    }

    // 枚数を出すため、cd→枚数マップを作る
    const counts = {};
    for (const [cd, n] of Object.entries(window.deck || {})) counts[String(cd)] = n|0;

    // 代表カード強調は負荷増を避けて省略（必要なら角枠など追加可）
    const unique = Array.from(new Set(cds)); // 画像は1枚でOK（×Nはバッジに）
    unique.forEach(cd => {
      const wrap = document.createElement('div');
      wrap.className = 'deckpeek-card';

      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = `img/${String(cd).slice(0,5)}.webp`;
      img.onerror = () => { img.onerror=null; img.src='img/00000.webp'; };

      const badge = document.createElement('div');
      badge.className = 'count-badge';
      badge.textContent = `×${counts[String(cd)] || 1}`;

      wrap.appendChild(img);
      wrap.appendChild(badge);
      grid.appendChild(wrap);
    });
  }

  // 表示制御：モバイル && editタブ && deck-card-list が画面内に無い → ボタン表示
  let io = null;
  function installObserver(){
    const { btn, pane } = ensureNodes();
    const list  = document.getElementById('deck-card-list');
    const modal = document.getElementById('noteFullModal');
    if (!list || !modal) return;

    // ▼ 表示状態を一元的に更新する関数
    const updateDeckpeekVisibility = (visibleEntry) => {
      const visible = !!visibleEntry?.isIntersecting; // deck-card-list が画面内か
      const modalOpen = getComputedStyle(modal).display === 'flex'; // ←ご指定の条件

      // 通常条件（モバイル + 編集タブ + リストが画面外） or モーダル開
      const show = (isMobile() && isEditTabOpen() && !visible) || modalOpen;

      btn.style.display = show ? 'inline-flex' : 'none';
      if (modalOpen) btn.classList.add('onModal'); else btn.classList.remove('onModal');

      if (!show) pane.style.display = 'none';
    };

    // ▼ 既存の IntersectionObserver（リストの出入り監視）
    if (window._deckpeekIO) window._deckpeekIO.disconnect();
    window._deckpeekIO = new IntersectionObserver((entries)=>{
      updateDeckpeekVisibility(entries[0]);
    }, { root: null, threshold: 0.05 });
    window._deckpeekIO.observe(list);

    // ▼ 追加：モーダルの display/class 変化を監視（開閉に即応）
    if (window._noteFullMO) window._noteFullMO.disconnect();
    window._noteFullMO = new MutationObserver(()=>{
      // エントリが無いとき用に visible=false 相当で評価
      updateDeckpeekVisibility({ isIntersecting: false });
    });
    window._noteFullMO.observe(modal, { attributes: true, attributeFilter: ['style','class'] });

    // 初期反映
    // IntersectionObserver の初回発火を待たずに即評価
    updateDeckpeekVisibility({ isIntersecting: false });
  }




    // ===== メイン種族カラー反映 =====
  function updateDeckPeekButtonColor() {
    const btn = document.getElementById('deckpeek-button');
    if (!btn) return;

    const mainRace = getMainRace?.();  // 既存関数
    const color = RACE_BG[mainRace] || 'rgba(255, 255, 255, .9)';
    btn.style.background = color;
  }

  // デッキ更新・リスト再描画・タブ切替時に色更新
  const hookColorOnce = (name) => {
    const fn = window[name];
    if (typeof fn === 'function' && !fn.__colorHooked) {
      const orig = fn;
      window[name] = function(...args){
        const r = orig.apply(this, args);
        try { updateDeckPeekButtonColor(); } catch {}
        return r;
      };
      window[name].__colorHooked = true;
    }
  };
  hookColorOnce('updateDeck');
  hookColorOnce('renderDeckList');

  document.addEventListener('click', (e)=>{
    if (e.target.closest('.tab')) {
      setTimeout(updateDeckPeekButtonColor, 200);
    }
  });

  // 初期化後にも一度呼ぶ
  document.addEventListener('DOMContentLoaded', updateDeckPeekButtonColor);


  // 長押しで表示（押している間だけ）
  function bindPressHold(){
    const { btn, pane } = ensureNodes();

    const show = () => {
      renderDeckPeek();
      pane.style.display = 'block';
    };
    const hide = () => {
      pane.style.display = 'none';
    };

    // タッチ系
    btn.addEventListener('touchstart', (e)=>{ e.preventDefault(); show(); }, {passive:false});
    btn.addEventListener('touchend',   hide, {passive:true});
    btn.addEventListener('touchcancel',hide, {passive:true});

    // マウス系（デバッグ/エミュ用）
    btn.addEventListener('mousedown', (e)=>{ e.preventDefault(); show(); });
    window.addEventListener('mouseup', hide);
    // 指が外に出ても確実に閉じる
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', hide, { passive: true });
  }

  // タブ切替時にも状態更新
  document.addEventListener('click', (e)=>{
    if (e.target.closest('.tab')) {
      setTimeout(installObserver, 200);
    }
  });

  // デッキ更新のたびにミニ描画を更新（軽量なので都度OK）
  const hookOnce = (name, wrapper) => {
    const fn = window[name];
    if (typeof fn === 'function' && !fn.__deckpeek_hooked){
      const orig = fn;
      window[name] = function(...args){
        const r = orig.apply(this, args);
        try { wrapper(); } catch {}
        return r;
      };
      window[name].__deckpeek_hooked = true;
    }
  };
  hookOnce('updateDeck', renderDeckPeek);
  hookOnce('renderDeckList', renderDeckPeek);

  // 初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>{ installObserver(); bindPressHold(); }, {once:true});
  } else {
    installObserver();
    bindPressHold();
  }
})();





//#endregion 6. デッキ情報・分析


/*======================================================
  7) デッキ保存
======================================================*/
//#region 7. デッキ画像出力

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

  // 🔤 デッキ名（info/post どちらでもOK）を取得
  let deckNameInput = (typeof readDeckNameInput === 'function')
    ? readDeckNameInput()
    : (document.getElementById("info-deck-name")?.value?.trim() || '');

  // 未入力なら「デッキ〇」で採番し、両タブへ即時反映
  if (!deckNameInput) {
    let num = 1;
    const existingNames = saved.map(d => d.name).filter(Boolean);
    while (existingNames.includes(`デッキ${num}`)) num++;
    deckNameInput = `デッキ${num}`;
    if (typeof writeDeckNameInput === 'function') writeDeckNameInput(deckNameInput);
    if (typeof window.syncDeckNameFields === 'function') window.syncDeckNameFields(); // 念のため
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

  // 🔽 デッキ名は両タブへ同時反映
  writeDeckNameInput(data.name || "");

  withDeckBarScrollKept(() => {
  updateDeck(); // デッキ欄更新
  renderDeckList();//デッキリスト画像更新
  });
  updateDeckSummaryDisplay();//代表カードデッキ情報表示
  updateExchangeSummary();//交換ポイント数更新
  scheduleAutosave();  //オートセーブ
  updateExchangeSummary(); // ★ 合計やパック別の再計算＆描画

  // ★ さらに現在モードのままコンパクト行も上書き
  const { pointTotal, diamondTotal, sand, packPoint } = computeExchangeNeeds();
  setExchangeCompact({
    point: pointTotal,
    diamond: diamondTotal,
    sand,
    packPoint
  });
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

 // デッキリセット（委譲で拾う：再描画に強い）
  document.addEventListener('click', (e) => {
   // どちらのボタンでも拾う（下部/上部）
  const btn = e.target.closest('#resetDeckButton, #resetDeckButtonTop');
  if (!btn) return;

  if (!confirm('現在のデッキを全てリセットします。よろしいですか？')) return;

  // データ初期化
  Object.keys(deck).forEach(k => delete deck[k]);
  representativeCd = null;

  //デッキ名（情報タブ＆投稿タブ）も空に
  writeDeckNameInput(''); // info側（#info-deck-name）
  const postNameEl = document.getElementById('post-deck-name');
  if (postNameEl) postNameEl.value = '';       // 投稿側（#post-deck-name）
  if (typeof window.syncDeckNameFields === 'function') window.syncDeckNameFields(); // 念のため同期
  clearAutosave(); // 🔁 オートセーブも消して復活しないように


  // UI更新（横スクロール保持）
  withDeckBarScrollKept(() => {
    updateDeck();       // デッキバー＆サマリー再計算
    renderDeckList();   // デッキリスト画像エリア再描画
  });

  // 付随パネルや数値も同期
  updateDeckSummaryDisplay();
  updateExchangeSummary();
  scheduleAutosave();  //オートセーブ
});

//#endregion



/*======================================================
  8) デッキ投稿フォーム関連
======================================================*/
//#region 8. デッキ投稿フォーム
// ===== デッキ投稿の流れヘルプモーダル =====
(function(){
  function openPostFlowHelp(){
    const modal = document.getElementById('postFlowHelpModal');
    if (modal) modal.style.display = 'flex';
  }

  function closePostFlowHelp(){
    const modal = document.getElementById('postFlowHelpModal');
    if (modal) modal.style.display = 'none';
  }

  window.openPostFlowHelp = openPostFlowHelp; // 必要なら他からも呼べるように

  window.addEventListener('DOMContentLoaded', () => {
    const btnTop  = document.getElementById('post-flow-help-btn-top');
    const btnForm = document.getElementById('post-flow-help-btn-form');
    const btnClose = document.getElementById('post-flow-help-close');
    const modal = document.getElementById('postFlowHelpModal');

    if (btnTop) {
      btnTop.addEventListener('click', openPostFlowHelp);
    }
    if (btnForm) {
      btnForm.addEventListener('click', openPostFlowHelp);
    }
    if (btnClose) {
      btnClose.addEventListener('click', closePostFlowHelp);
    }

    // モーダルの背景クリックで閉じる
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closePostFlowHelp();
        }
      });
    }
  });
})();


// ===== サブタブの active を単一化（追加追記） =====
(function(){
  function setupExclusiveTabs(){
    // タブボタンとコンテンツの親を特定（ページ構造に合わせて調整可能）
    const tabRoot = document.getElementById('post-tab') || document; // 投稿タブ内優先で検索

    // ボタンクリックで active を排他的に付け直す
    tabRoot.querySelectorAll('[data-subtab-target]').forEach(btn => {
      if (btn.__exclusiveBound) return;
      btn.__exclusiveBound = true;

      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-subtab-target');
        if (!targetId) return;

        // ボタン側の active を単一化
        const allBtns = tabRoot.querySelectorAll('[data-subtab-target]');
        allBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // コンテンツ側の active を単一化
        const allPanels = tabRoot.querySelectorAll('.tab-content');
        allPanels.forEach(p => p.classList.remove('active'));

        const panel = tabRoot.querySelector(`#${CSS.escape(targetId)}`);
        if (panel) panel.classList.add('active');
      });
    });
  }

  window.addEventListener('DOMContentLoaded', setupExclusiveTabs);
})();


//タグ配列
window.autoTagList     ??= []; // updateAutoTags()
window.selectedTagList ??= []; // renderPostSelectTags()
const userTagInput = document.getElementById('user-tag-input')?.value || '';


// ===== デッキ投稿で使う簡易ヘルパー =====
function getDeckCount() {
  try { return Object.values(deck || {}).reduce((a, b) => a + (b|0), 0); }
  catch { return 0; }
}

function getDeckAsArray() {
  // [{cd, count}] 形式
  return Object.entries(deck || {}).map(([cd, n]) => ({ cd, count: n|0 }));
}

function getRepresentativeImageUrl() {
  return representativeCd ? `img/${String(representativeCd).slice(0,5)}.webp` : '';
}

function exportDeckCode() {
  // まずは簡易：デッキmapをBase64化（後で独自コードに差し替え可）
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(deck || {})))); }
  catch { return ''; }
}

// === 追加: 入力値の読み書きヘルパ ===
function readPostNote(){
  return document.getElementById('post-note')?.value || '';
}
function writePostNote(v){
  const el = document.getElementById('post-note');
  if (el) el.value = v || '';
}

// === ユーザータグ 読み取り ===
function readUserTags(){
  // 内部状態があればそれを優先
  if (Array.isArray(window.PostUserTags)) {
    return window.PostUserTags
      .map(t => String(t || '').trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  const wrap = document.getElementById('user-tags');
  if (!wrap) return [];

  return Array.from(wrap.querySelectorAll('.chip'))
    .map(ch => {
      const raw = ch.textContent || '';
      // chip の中身が「タグ名×」になっている場合、末尾の × を落とす
      const s = raw.endsWith('×') ? raw.slice(0, -1) : raw;
      return s.trim();
    })
    .filter(Boolean)
    .slice(0, 3);
}

// === 入力監視: 解説/ユーザータグでオートセーブを走らせる ===
document.addEventListener('DOMContentLoaded', ()=>{
  const note = document.getElementById('post-note');
  if (note) note.addEventListener('input', scheduleAutosave);

  const userTagInput = document.getElementById('user-tag-input');
  const addBtn = document.getElementById('user-tag-add');
  if (userTagInput && addBtn){
    addBtn.addEventListener('click', ()=>{ setTimeout(scheduleAutosave, 0); });
    userTagInput.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') setTimeout(scheduleAutosave, 0);
    });
  }
});

// === ユーザータグ 書き込み ===
function writeUserTags(list){
  const wrap = document.getElementById('user-tags');
  if (!wrap) return;

  // 正規化（空文字除外・重複除外・3個まで）
  const normalized = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach(t => {
    const s = String(t || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    if (normalized.length < 3) normalized.push(s);
  });

  // 内部状態も同期
  window.PostUserTags = normalized;

  // 描画
  wrap.innerHTML = '';
  window.PostUserTags.forEach((tag, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip active';

    // ラベル部分
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = tag;
    chip.appendChild(label);

    // 削除ボタン
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      window.PostUserTags.splice(i, 1);
      writeUserTags(window.PostUserTags);
      if (typeof scheduleAutosave === 'function') scheduleAutosave();
    });

    chip.appendChild(rm);
    wrap.appendChild(chip);
  });
}

// === ユーザータグ履歴（最近使ったタグ） ===
const USER_TAG_HISTORY_KEY = 'dm_user_tag_history_v1';

// 履歴読み込み
function getUserTagHistory() {
  try {
    const raw = localStorage.getItem(USER_TAG_HISTORY_KEY) || '[]';
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(s => String(s || '').trim()).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

// 履歴に1つ追加（先頭に詰め、重複除去、最大20件）
function pushUserTagHistory(tag) {
  const t = String(tag || '').trim();
  if (!t) return;

  let list = getUserTagHistory();
  list = list.filter(x => x !== t);
  list.unshift(t);
  if (list.length > 20) list = list.slice(0, 20);

  try {
    localStorage.setItem(USER_TAG_HISTORY_KEY, JSON.stringify(list));
  } catch {}
}

// どこからでも呼べるフック
window.onUserTagAdded = function(tag){
  pushUserTagHistory(tag);
};



/* ✅ 保存キー（選択状態を保持） */
const SELECT_TAGS_KEY = 'dm_post_select_tags_v1';



// ===== カード読み込み完了後のフック =====
window.onCardsLoaded = function() {
  if (typeof rebuildCardMap === 'function') rebuildCardMap();
  if (document.getElementById('select-tags')) renderPostSelectTags();
};



/* 既存の選択状態 読み書き */
function readSelectedTags() {
  try { return new Set(JSON.parse(localStorage.getItem(SELECT_TAGS_KEY) || '[]')); }
  catch { return new Set(); }
}
function writeSelectedTags(setOrArray) {
  const arr = Array.isArray(setOrArray) ? setOrArray : Array.from(setOrArray);
  localStorage.setItem(SELECT_TAGS_KEY, JSON.stringify(arr));
}

/* デッキに含まれるカテゴリ候補を抽出*/
function getDeckCategoryTags() {
  const bad = new Set(['ノーカテゴリ', 'なし', '-', '', null, undefined]);
  const set = new Set();
  Object.entries(deck || {}).forEach(([cd, n]) => {
    if (!n) return;
    const cat = cardMap[cd]?.category;
    if (!bad.has(cat)) set.add(String(cat).trim());
  });
  return Array.from(set); // 例：["アドミラルシップ","テックノイズ", ...]
}

/* 重複除去
  基本タグ + カテゴリタグ 並べ替え（基本→カテゴリの順）
  */
function buildMergedTagList(baseTags, categoryTags) {
  const merged = [];
  const seen = new Set();
  baseTags.forEach(t => { if (!seen.has(t)) { merged.push(t); seen.add(t); } });
  categoryTags.sort((a,b)=>a.localeCompare(b,'ja')).forEach(t => {
    if (!seen.has(t)) { merged.push(t); seen.add(t); }
  });
  return merged;
}


// ===== ユーザータグ =====
const USER_TAGS_KEY = 'dm_post_user_tags_v1';
const USER_TAG_MAX = 10;
const USER_TAG_LEN = 20;

// その後に通常の定数定義（必要なら）
const POST_TAG_CANDIDATES = window.POST_TAG_CANDIDATES || [];



/* cards データの取得（既にグローバルがあればそれを使う / なければ fetch） */
async function getAllCardsForTags() {
  // グローバルに置いてあるケースを広めに拾う
  const candidates = [window.cards, window.allCards, window.cardData, window.CARDS];
  for (const c of candidates) if (Array.isArray(c) && c.length) return c;

  // それでも無ければJSONから読む

  const data = await res.json();
  // is_latest がある前提なら最新のみ
  const latest = Array.isArray(data) ? data.filter(x => x?.is_latest !== false) : [];
  return latest.length ? latest : (Array.isArray(data) ? data : []);
}


//デッキ名同期
async function initDeckPostTab() {

  // デッキ名を反映
  const srcName = document.getElementById('info-deck-name')?.value || "";
  const nameInput = document.getElementById('post-deck-name');
  if (nameInput && !nameInput.value) nameInput.value = srcName;

  // サマリー同期
  updateDeckAnalysis();
  refreshPostSummary();
  renderPostSelectTags();


}

//デッキ投稿情報表示
function refreshPostSummary() {
  const count = typeof getDeckCount === 'function'
  ? getDeckCount()
  : Object.values(deck || {}).reduce((a, b) => a + (b|0), 0);

  const races = typeof getMainRacesInDeck==='function' ? getMainRacesInDeck() : [];
  const rep = document.getElementById('deck-representative')?.textContent || '未選択';
  const rLegend = document.getElementById('rarity-legend')?.textContent ?? '0';
  const rGold   = document.getElementById('rarity-gold')?.textContent   ?? '0';
  const rSilver = document.getElementById('rarity-silver')?.textContent ?? '0';
  const rBronze = document.getElementById('rarity-bronze')?.textContent ?? '0';

  document.getElementById('post-deck-count')?.replaceChildren(document.createTextNode(count));
  document.getElementById('post-deck-races')?.replaceChildren(document.createTextNode(races.join(' / ') || '-'));
  document.getElementById('post-representative')?.replaceChildren(document.createTextNode(rep));

  // 隠し値（送信用）
  document.getElementById('post-deck-code')?.setAttribute('value', typeof exportDeckCode==='function' ? exportDeckCode() : '');
  document.getElementById('post-races-hidden')?.setAttribute('value', races.join(','));
  // 代表カードの画像URLなど（あなたの実装に合わせて取得）
  const repImg = typeof getRepresentativeImageUrl==='function' ? getRepresentativeImageUrl() : '';
  document.getElementById('post-rep-img')?.setAttribute('value', repImg);
}

// ---- デッキ解説：プリセットボタン → 文章挿入 ----
function insertAtCursor(el, text) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end   = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after  = el.value.slice(end);
  el.value = before + text + after;

  const pos = start + text.length;
  try {
    el.selectionStart = el.selectionEnd = pos;
  } catch (e) {}
  // 入力更新を他ロジックに通知
  el.dispatchEvent(new Event('input'));
}



// === デッキ解説プリセット挿入 ===
const NOTE_PRESETS = {
  "deck-overview": `【デッキ概要】
どんなコンセプトで作ったか、狙いの動きなど。

【キーカード】
主軸となるカード・シナジー解説。

【入れ替え候補】
なぜこの構成にしたのか、他構築との差別化など。

`,

  "play-guide": `【マリガン基準】
初手で意識するカード、キープ基準など。

【試合の立ち回り】
〈序盤〉
〈中盤〉
〈終盤〉

【プレイのコツ】
状況判断やよくあるミスなど。

`,

  "matchup": `【環境での立ち位置】
どんな相手に強いか・苦手かなど。

【相性一覧】
〈有利対面〉
〈不利対面〉

【対策カード】
環境・メタに合わせた調整案など。

`,

  "results": `【使用環境】
使用期間・レート帯・環境など（例：シーズン〇〇／レート1600帯）

【戦績】
総試合数・勝敗（ざっくりでもOK）

【課題・改善点】
苦手な対面や構築上の弱点、今後調整したい点。

【まとめ】
使ってみた全体の印象、成果や気づきなど。

`
};

// 共通の挿入関数
function insertPresetTo(el, text){
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end   = el.selectionEnd   ?? el.value.length;
  const v = el.value;
  el.value = v.slice(0, start) + text + v.slice(end);
  el.focus();
  el.selectionStart = el.selectionEnd = start + text.length;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ===== プリセットクリック処理 =====
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.note-preset-btn');
  if (!btn) return;
  const preset = btn.dataset.preset;
  const text = NOTE_PRESETS[preset];
  if (!text) return;
  const isFullOpen = document.getElementById('noteFullModal')?.style.display !== 'none';
  const target = isFullOpen ? document.getElementById('note-full-text')
                            : document.getElementById('post-note');
  insertPresetTo(target, text);
});



// ==== デッキ解説: 全画面モーダル ====
(function(){
function openNoteFull(){
const modal = document.getElementById('noteFullModal');
const src = document.getElementById('post-note');
const dst = document.getElementById('note-full-text');
if (!modal || !src || !dst) return;
dst.value = src.value;
// デッキ名（右側タイトル）を最新に同期
if (window.syncDeckNameFields) window.syncDeckNameFields();

// 右ペインに現在のデッキ一覧を軽量レンダリング
const side = document.getElementById('note-side-list');
if (side) {
side.innerHTML = '';
const entries = Object.entries(window.deck || {});
const sorted = entries.sort(([a],[b])=> String(a).localeCompare(String(b)));
sorted.forEach(([cd,n])=>{
const row = document.createElement('div'); row.className='note-card-row';
row.style.display='grid'; row.style.gridTemplateColumns='56px 1fr auto'; row.style.alignItems='center'; row.style.gap='8px'; row.style.margin='4px 0';
const img = document.createElement('img'); img.alt=''; img.loading='lazy'; img.src = `img/${String(cd).slice(0,5)}.webp`; img.onerror=()=>{img.src='img/00000.webp'}; img.style.width='56px'; img.style.borderRadius='6px';
const name = document.createElement('div'); name.textContent = (window.cardMap?.[cd]?.name)||cd; name.style.fontSize='.95rem';
const qty = document.createElement('div'); qty.textContent = '×'+n; qty.style.opacity='.8';

row.dataset.cardId = cd;
row.addEventListener('click', () => {
  if (typeof openCardOpModal === 'function') {
    // 位置合わせ用に行の矩形を渡す
    const rect = row.getBoundingClientRect();
    openCardOpModal(cd, rect);
  }
});
row.appendChild(img);
row.appendChild(name);
row.appendChild(qty);
side.appendChild(row);
});
}
modal.style.display='flex';
document.body.style.overflow='hidden';
}
function closeNoteFull(){
const modal = document.getElementById('noteFullModal');
const src = document.getElementById('post-note');
const dst = document.getElementById('note-full-text');
if (!modal || !src || !dst) return;
src.value = dst.value;
src.dispatchEvent(new Event('input')); // オートセーブ連動
modal.style.display='none';
document.body.style.overflow='';
}
document.addEventListener('DOMContentLoaded', ()=>{
document.getElementById('note-fullscreen-btn')?.addEventListener('click', openNoteFull);
document.getElementById('note-full-close')?.addEventListener('click', closeNoteFull);
document.addEventListener('keydown', (e)=>{ if (e.key==='Escape' && document.getElementById('noteFullModal')?.style.display==='flex') closeNoteFull(); });
});


  // ============= デッキ名と note-side-title の双方向同期 =============
  const infoDeckName = document.getElementById('info-deck-name');
  const postDeckName = document.getElementById('post-deck-name');
  const noteSideTitle = document.getElementById('note-side-title');

  function setAllDeckName(name){
    if(infoDeckName && infoDeckName.value !== name) infoDeckName.value = name;
    if(postDeckName && postDeckName.value !== name) postDeckName.value = name;
    if(noteSideTitle && noteSideTitle.textContent !== name) noteSideTitle.textContent = name || 'デッキリスト';
  }

  // 入力から右側タイトルへ
  infoDeckName?.addEventListener('input', ()=> setAllDeckName(infoDeckName.value));
  postDeckName?.addEventListener('input', ()=> setAllDeckName(postDeckName.value));

  // 右側タイトルタップで編集（contenteditable）
  if(noteSideTitle){
    noteSideTitle.addEventListener('click', ()=>{
      // 編集開始
      noteSideTitle.setAttribute('contenteditable', 'true');
      const range = document.createRange();
      range.selectNodeContents(noteSideTitle);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      noteSideTitle.focus();
    });
    // Enter または blur で確定
    noteSideTitle.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){
        e.preventDefault(); noteSideTitle.blur();
      }
    });
    noteSideTitle.addEventListener('blur', ()=>{
      noteSideTitle.setAttribute('contenteditable', 'false');
      setAllDeckName(noteSideTitle.textContent.trim());
    });
  }

  // 初期同期（ページ読み込み時）
  setAllDeckName(postDeckName?.value || infoDeckName?.value || '');

})();

// === cardOpModal open from note-side ===
(function attachNoteSideOpenCardOp(){
  const list = document.getElementById('note-side-list');
  if (!list) return;
  list.addEventListener('click', (e)=>{
    const row = e.target.closest('.note-card-row');
    if (!row) return;
    const cardId = row.dataset.cardId || row.getAttribute('data-card-id');
    if (!cardId) return;

    // 既存の起動関数に合わせて順にトライ
    if (typeof window.openCardOpModal === 'function') {
      window.openCardOpModal(cardId);
      return;
    }
    if (typeof window.showCardOpModal === 'function') {
      window.showCardOpModal(cardId);
      return;
    }
    if (typeof window.openCardOperationModal === 'function') {
      window.openCardOperationModal(cardId);
      return;
    }
    // 最終手段: カスタムイベント（受け側があれば拾える）
    document.dispatchEvent(new CustomEvent('open-cardop', { detail: { cardId }}));
  });
})();


  /* =========================
   カード解説モジュール（統一版）
   - 表示：要求レイアウト（thumb/↑↓/削除/ピックボタン/textarea）
   - 保存：#post-card-notes-hidden に JSON を常にミラー
   - 追加/削除/上下移動/カード選択モーダル対応
========================= */
const CardNotes = (() => {
  const MAX = 20;
  let cardNotes = [];       // [{cd, text}]
  let pickingIndex = -1;

  // --- 要素取得ヘルパ ---
  const elWrap       = () => document.getElementById('post-card-notes');
  const elHidden     = () => document.getElementById('post-card-notes-hidden');
  const elModal      = () => document.getElementById('cardNoteSelectModal');   // 既存の候補モーダル
  const elCandidates = () => document.getElementById('cardNoteCandidates');    // ↑内のグリッド

  const cdToImg = (cd) => `img/${String(cd||'').slice(0,5) || '00000'}.webp`;
  const cdToName = (cd) => (window.cardMap?.[cd]?.name) || '';

  // --- 外部へ渡すAPI（loadAutosave等から使う） ---
  function replace(arr){
    cardNotes = Array.isArray(arr) ? arr.map(r => ({cd:String(r.cd||''), text:String(r.text||'')})) : [];
    renderRows();
  }
  function get(){ return cardNotes.slice(); }

  // --- 描画 ---
  function renderRows(){
    const root = elWrap(); if (!root) return;
    root.innerHTML = '';

    cardNotes.forEach((row, i) => {
      const cd = String(row.cd||'');
      const item = document.createElement('div');
      item.className = 'post-card-note';
      item.dataset.index = String(i);
      const cardName = cdToName(cd) || 'カードを選択';

      item.innerHTML = `
        <div class="left">
          <div class="thumb">
            <img alt="" src="${cdToImg(cd)}" onerror="this.src='img/00000.webp'">
          </div>
          <div class="actions">
            <button type="button" class="note-move" data-dir="-1">↑</button>
            <button type="button" class="note-move" data-dir="1">↓</button>
            <button type="button" class="note-remove">削除</button>
          </div>
        </div>
        <button type="button" class="pick-btn">${cardName}</button>
        <textarea class="note" placeholder="このカードの採用理由・使い方など"></textarea>
      `;

      // テキスト反映 & 入力で保存
      const ta = item.querySelector('textarea.note');
      ta.value = row.text || '';
      ta.addEventListener('input', syncHidden);

      // 画像クリックでもピッカー
      item.querySelector('.thumb img')?.addEventListener('click', () => openPickerFor(i));

      root.appendChild(item);
    });

    syncHidden();
  }

  function syncHidden(){
    const out = Array.from(elWrap().querySelectorAll('.post-card-note')).map(n => {
      const i = Number(n.dataset.index || 0);
      const text = n.querySelector('.note')?.value?.trim() || '';
      const cd   = String(cardNotes[i]?.cd || '');   // cd は配列を正とする
      return (cd || text) ? {cd, text} : null;
    }).filter(Boolean);
    if (elHidden()) elHidden().value = JSON.stringify(out);
    if (typeof window.scheduleAutosave === 'function') window.scheduleAutosave();
  }

  // --- 行操作 ---
  function addRow(initial={cd:'', text:''}){
    if (cardNotes.length >= MAX) { alert(`カード解説は最大 ${MAX} 件までです`); return; }
    cardNotes.push({ cd:String(initial.cd||''), text:String(initial.text||'') });
    renderRows();
  }
  function removeRow(index){
    cardNotes.splice(index,1);
    renderRows();
  }
  function moveRow(index, dir){
    const j = index + dir;
    if (j < 0 || j >= cardNotes.length) return;
    [cardNotes[index], cardNotes[j]] = [cardNotes[j], cardNotes[index]];
    renderRows();
  }

  // --- ピッカー ---
  function currentDeckUniqueCds(){
    // デッキ内ユニークCD（表示の並びはあなたの既存規則に合わせる）
    const set = new Set(Object.keys(window.deck || {}));
    return Array.from(set);
  }
  function ensureImg(img, cd){ img.src = cdToImg(cd); img.onerror = () => img.src = 'img/00000.webp'; }
  const sortByRule = (arr) => arr; // 並び替えがあれば差し替え

  function openPickerFor(index){
    pickingIndex = index|0;

    const list = currentDeckUniqueCds();
    if (!list.length){ alert('デッキが空です。先にカードを追加してください。'); return; }

    const used = new Set(cardNotes.filter((_,i)=>i!==pickingIndex).map(r=>String(r.cd)).filter(Boolean));
    const grid = elCandidates(); if (!grid) return;
    grid.innerHTML = '';
    sortByRule(list.slice()).forEach(cd=>{
      const wrap = document.createElement('div');
      wrap.className = 'item' + (used.has(cd) ? ' disabled' : '');
      wrap.dataset.cd = cd;
      const img = document.createElement('img'); ensureImg(img, cd); wrap.appendChild(img);
      if (!used.has(cd)) wrap.addEventListener('click', ()=>pickCard(cd));
      grid.appendChild(wrap);
    });
    showPickerModal(true);
  }
  function showPickerModal(open){ const m = elModal(); if (m) m.style.display = open ? 'block' : 'none'; }
  function pickCard(cd){
    if (pickingIndex < 0) return;
    cardNotes[pickingIndex].cd = String(cd);
    renderRows(); showPickerModal(false); pickingIndex = -1;
  }


  // --- 初期化：hiddenから読んで描画（ページ初回表示用） ---
  (function initOnce(){
    try{
      const raw = (elHidden()?.value || '[]');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        cardNotes = arr.map(r => ({cd:String(r.cd||''), text:String(r.text||'')}));
      }
    }catch(_){}
    if (!cardNotes.length) cardNotes = [{ cd:'', text:'' }]; // ★空なら1行作る
    renderRows();
  })();

  // --- クリック委任（追加/削除/上下/ピッカー/閉じる） ---
  document.addEventListener('click', (e)=>{
    if (e.target.id === 'add-card-note') { // ★HTMLのidと一致
      e.preventDefault();
      addRow();
      return;
    }
    const row = e.target.closest('.post-card-note');
    if (row){
      const idx = row.dataset.index|0;
      if (e.target.matches('.note-remove')) { removeRow(idx); return; }
      if (e.target.matches('.note-move')) {
        const dir = parseInt(e.target.dataset.dir,10)||0; moveRow(idx, dir); return;
      }
      if (e.target.matches('.pick-btn, .thumb img')) { openPickerFor(idx); return; }
    }
    if (e.target.id === 'cardNoteClose' ||
        (e.target.id === 'cardNoteSelectModal' && e.target === elModal())) {
      showPickerModal(false); pickingIndex = -1;
    }
  });

  return { replace, get, addRow };
})();

// =========================
// カード解説ノート：フォールバック & 追加ボタン結線
// =========================

// ▼ note本文のフォールバック（未定義なら用意）
window.readPostNote ??= function () {
  const el = document.getElementById('post-note');
  return (el?.value || '').trim();
};
window.writePostNote ??= function (val) {
  const el = document.getElementById('post-note');
  if (el) el.value = val || '';
};

// ▼ ノート行の最小レンダラ（既存の writeCardNotes があれば使う）
function __appendNoteRow(cd, text = '') {
  // 既存の描画APIがあるならそれを使う
  if (typeof window.readCardNotes === 'function' &&
      typeof window.writeCardNotes === 'function') {
    const curr = window.readCardNotes() || [];
    curr.push({ cd: String(cd || ''), text: String(text || '') });
    window.writeCardNotes(curr);
    return;
  }

  // フォールバック描画：#post-card-notes に1行追加
  const wrap = document.getElementById('post-card-notes');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'card-note-row';
  row.dataset.cd = String(cd || '');
  row.innerHTML = `
    <div class="cn-title">CD:${cd ? String(cd) : ''}</div>
    <textarea class="cn-text" rows="2"></textarea>
  `;
  wrap.appendChild(row);
}

// ▼ 代表カード or 最初のデッキカードを候補にするヘルパ
function __pickNoteTargetCd() {
  if (window.representativeCd) return String(window.representativeCd);
  const ids = Object.keys(window.deck || {});
  return ids.length ? String(ids[0]) : '';
}

// ▼ 「追加」ボタン配線
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('add-note-btn');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();

    // どのカードのノートか選ぶ：代表カード→無ければ先頭→無ければ空行
    const targetCd = __pickNoteTargetCd();

    if (!targetCd) {
      // デッキが空：空行だけ追加（後で手入力でCDを書ける構成でもOK）
      __appendNoteRow('', '');
    } else {
      __appendNoteRow(targetCd, '');
    }

    // 入力フォーカス（最後に追加した行）
    const wrap = document.getElementById('post-card-notes');
    const last = wrap?.querySelector('.card-note-row:last-child .cn-text');
    last?.focus();

    // オートセーブ
    window.scheduleAutosave?.();
  });
});


/** タブ遷移時に同期（既に afterTabSwitched があるなら post-tab を足す） */
if (typeof window.afterTabSwitched === 'function') {
  const _orig = window.afterTabSwitched;
  window.afterTabSwitched = function(targetId){
    _orig(targetId);
    if (targetId === 'post-tab') initDeckPostTab();
  };
} else {
  // 念のため
  window.afterTabSwitched = function(targetId){
    if (targetId === 'post-tab') initDeckPostTab();
  };
}

// ===== 自動タグ生成 =====
function updateAutoTags() {
  const autoWrap = document.getElementById('auto-tags');
  if (!autoWrap) return;

    // 🟣 デッキが空ならタグを生成しない
  const deckCount = Object.values(deck).reduce((sum, n) => sum + n, 0);
  if (deckCount === 0) {
    autoWrap.innerHTML = '';
    return;
  }

  const autoTags = [];

  // === 1.メイン種族 ===
  const mainRace = computeMainRace?.();
  if (mainRace) autoTags.push(mainRace);

  // === 2.レアリティ関連 ===
  const rarityCounts = { 'レジェンド': 0, 'ゴールド': 0, 'シルバー': 0, 'ブロンズ': 0 };
  Object.entries(deck).forEach(([cd, n]) => {
    const r = cardMap[cd]?.rarity;
    if (r && rarityCounts[r] != null) rarityCounts[r] += n;
  });

  const legendNone = rarityCounts['レジェンド'] === 0;
  const goldNone = rarityCounts['ゴールド'] === 0;
  if (legendNone && goldNone) {
    autoTags.push('レジェンドゴールドなし');
  } else if (legendNone) {
    autoTags.push('レジェンドなし');
  }

  // === 3.旧神 ===
  const hasOldGod = Object.keys(deck).some(cd => cardMap[cd]?.race === '旧神');
  if (!hasOldGod) autoTags.push('旧神なし');

  // === 4.単一英語パックデッキ（A/B/C/Dパックのみ） ===
  // デッキ内のカードについて、pack_name / pack から EN名を取得し、
  // 先頭が A〜Z のパックだけをカウントする。
  // その英語パックが 1種類だけなら「Aパックのみ」「Bパックのみ」…のタグを付与。
  (function(){
    const englishPacks = new Set();

    for (const [cd, n] of Object.entries(deck)) {
      if (!(n | 0)) continue;

      // まずは通常どおり、この cd のカード情報を取得
      const infoRaw = (window.cardMap?.[cd]) || (window.allCardsMap?.[cd]);
      if (!infoRaw) continue;

      let info = infoRaw;

      // 🔹リンクカードなら、リンク元カードの情報を優先して参照する
      //   - cardMap / allCardsMap のどちらかに linkCd があればそちらを採用
      if (infoRaw.link) {
        const srcCd = String(infoRaw.linkCd || infoRaw.link_cd || '');
        if (srcCd) {
          const base =
            (window.cardMap?.[srcCd]) ||
            (window.allCardsMap?.[srcCd]);
          if (base) {
            info = base;
          }
        }
      }

      // pack 名はカード本体の packName / pack_name / pack のいずれか
      const packEn = getPackEnName(info.packName || info.pack_name || info.pack || '');
      if (!packEn) continue;

      const first = packEn.charAt(0);
      // 先頭が A〜Z のものだけを「英語パック」とみなす
      if (first >= 'A' && first <= 'Z') {
        englishPacks.add(packEn);
      }
    }


    if (englishPacks.size === 1) {
      const onlyPackEn = Array.from(englishPacks)[0];
      const key = onlyPackEn.charAt(0).toUpperCase(); // A/B/C/D...
      autoTags.push(`${key}パックのみ`);
    }
  })();

  // === 5.ハイランダー ===
  // デッキ30枚以上、かつ全カードが1枚ずつ（重複なし）
  const deckCountForHL = Object.values(deck).reduce((s, n) => s + (n | 0), 0);
  const isHighlander = deckCountForHL >= 30 && Object.values(deck).every(n => (n | 0) === 1);
  if (isHighlander) autoTags.push('ハイランダー');


  // === 出力 ===
  autoWrap.innerHTML = '';
  autoTags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = tag;
    chip.dataset.auto = "true";
    autoWrap.appendChild(chip);
  });
}


// ===== 選択タグ=====
async function renderPostSelectTags() {
  const wrap = document.getElementById('select-tags');
  if (!wrap) return;

  // いまの選択を保持
  const selected = readSelectedTags();

  // ★「コラボカードあり」は自動では選択しないよう、ここで一度外す
  selected.delete('コラボカードあり');

  // --- コラボカードの有無を判定（候補リスト制御用） ---
  let hasCollab = false;
  (function syncCollabTag() {
    const d = window.deck || {};
    const keys = Object.keys(d || {});
    if (!keys.length) {
      // デッキが空ならコラボも無し
      hasCollab = false;
      return;
    }

    // デッキ内に1枚でも「コラボ」パックのカードがあれば true
    hasCollab = keys.some(cd => {
      const el = document.querySelector(`.card[data-cd="${cd}"]`);
      const pack = (el?.dataset?.pack || '').toLowerCase();
      return /コラボ|collab/.test(pack);
    });
  })();

  // デッキに含まれるカテゴリのみ（デッキが空なら[]）
  const categoryTags = getDeckCategoryTags();

  // 基本タグ + カテゴリ（五十音）
  const merged = buildMergedTagList(POST_TAG_CANDIDATES, categoryTags);

    // ★アクティブキャンペーンがあるなら、選択タグ候補に必ず含める（1キャンペーン前提）
  const campTag = String(window.__activeCampaignTag || '').trim();
  if (campTag && !merged.includes(campTag)) {
    merged.unshift(campTag); // 先頭に出す（邪魔なら push に変更OK）
  }

  // コラボカードがある場合だけ、候補リストに「コラボカードあり」を追加
  if (hasCollab && !merged.includes('コラボカードあり')) {
    merged.push('コラボカードあり');
  }

  // 画面再構築
  wrap.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'post-hint';
  hint.textContent = '⇩タップでさらにタグを追加';
  wrap.appendChild(hint);
  const frag = document.createDocumentFragment();

  merged.forEach(label => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.label = label;
    chip.innerHTML = formatTagLabelForWrap(label);
    chip.dataset.tag = label;

    // 復元（※「コラボカードあり」はここまでに selected から外してあるので active にならない）
    if (selected.has(label)) chip.classList.add('active');

    chip.addEventListener('click', () => {
      const now = readSelectedTags();
      if (chip.classList.toggle('active')) now.add(label);
      else now.delete(label);
      writeSelectedTags(now);
    });

    frag.appendChild(chip);
  });

  wrap.appendChild(frag);

  // いま表示していないタグは掃除（基本タグは残す）
  const visible = new Set(merged);
  const cleaned = Array.from(selected).filter(
    t => visible.has(t) || POST_TAG_CANDIDATES.includes(t)
  );
  writeSelectedTags(cleaned);

  // 取得APIは据え置き
  window.getSelectedPostTags = () => Array.from(readSelectedTags());

  // 折り返し適用（必要なら）
  if (typeof applySelectTagWrap === 'function') {
    applySelectTagWrap();
  }
}


// --- 選択タグの見た目用： （ の直後で改行可能にする ---
function formatTagLabelForWrap(label){
  // 全角の「（」出現ごとに <wbr> を注入
  return String(label).replace(/（/g, '<br>（');
}

// #select-tags 配下の .chip に対して適用（描画後フック）
function applySelectTagWrap(){
  const root = document.getElementById('select-tags');
  if (!root) return;
  root.querySelectorAll('.chip').forEach(chip => {
    // 既に適用済みならスキップ
    if (chip.__wrapped) return;
    // 元ラベルは data-label or textContent から拾う
    const raw = chip.dataset.label || chip.textContent;
    chip.dataset.label = raw; // 保存
    chip.innerHTML = formatTagLabelForWrap(raw);
    chip.__wrapped = true;
  });
}

// タグ描画関数の末尾や、初期化完了後に一度呼ぶ
window.addEventListener('DOMContentLoaded', () => {
  // タグUI構築が非同期なら、その完了コールバックでもう一度呼んでください
  applySelectTagWrap();
});


/* タブ表示前に先に描画してもOK（非表示でも動きます） */
document.addEventListener('DOMContentLoaded', () => {
  // post-tab があるページだけで動く
  if (document.getElementById('post-tab')) {
    renderPostSelectTags().catch(console.error);
  }
});

/* 初期化時：選択タグラベルの折返し適用 */
document.addEventListener('DOMContentLoaded', () => {
  applySelectTagWrap();
});

/* タグ描画後に再適用したい場合のフック */
window.afterRenderSelectTags = function () {
  applySelectTagWrap();
};

// =====ユーザータグ =====
/*ユーザータグ*/
(() => {
  // DOM が無ければ何もしない
  const wrap = document.getElementById('user-tags');
  const input = document.getElementById('user-tag-input');
  const addBtn = document.getElementById('user-tag-add');
  if (!wrap || !input || !addBtn) return;

  // グローバルにぶつからないよう window 下に専用名前で載せます
  window.PostUserTags = window.PostUserTags || [];

  const MAX_TAGS = 3;

  function normalize(s) {
    // 前後空白を削除、全角スペースも潰す、空文字を弾く
    return (s || '')
      .replace(/\s+/g, ' ')
      .replace(/　+/g, ' ')
      .trim();
  }

  function render() {
    wrap.innerHTML = '';
    window.PostUserTags.forEach((tag, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip active'; // 自由タグと同じ形で色はCSSの .user-tags に任せる
      chip.textContent = tag;

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'rm';
      rm.setAttribute('aria-label', `${tag} を削除`);
      rm.textContent = '×';
      rm.onclick = () => {
        window.PostUserTags.splice(i, 1);
        render();
      };

      chip.appendChild(rm);
      wrap.appendChild(chip);
    });
  }

  function addTagFromInput() {
    const raw = input.value;
    const v = normalize(raw);
    if (!v) return;

    if (window.PostUserTags.length >= MAX_TAGS) {
      alert('ユーザータグは最大3個までです');
      return;
    }
    if (window.PostUserTags.includes(v)) {
      // 重複は先頭に寄せるなど好みで
      // ここでは何もしない
      input.value = '';
      return;
    }
    window.PostUserTags.push(v);

    // ★ 追加：履歴に登録（定義されていれば）
    if (typeof window.onUserTagAdded === 'function') {
      window.onUserTagAdded(v);
    }

    input.value = '';
    render();
  }

  // Enter で追加
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTagFromInput();
    }
  });
  // 追加ボタン
  addBtn.addEventListener('click', addTagFromInput);

  // 初期描画
  render();
})();


// ===== ユーザー用デッキコード貼り付け =====
(function initUserPasteCode(){
  const $ = (id) => document.getElementById(id);
  const pasteBtn  = $('btn-paste-code');
  const clearBtn  = $('btn-clear-code');
  const previewEl = $('pasted-code-preview');
  const hiddenEl  = $('post-share-code'); // hidden

  if (!pasteBtn || !clearBtn || !previewEl || !hiddenEl) return;

function reflectUI(s){
  // 軽量バリデーション
  const vr = validateDeckCodeLight(s || '');
  const ok = !!vr.ok;

  // 表示：OK のときだけ原文を見せる。NG/空は「（未設定）」に戻す
  const display = (ok && s) ? s : '（未設定）';
  previewEl.textContent = display;

  // タイトル（ツールチップ）
  if (!s) {
    previewEl.title = '';
  } else if (ok) {
    previewEl.title = '判定: デッキコード（OK）';
  } else {
    previewEl.title = `判定: 不明（${vr.reason || '形式不一致'}）`;
  }

  // 見た目クラス
  previewEl.classList.toggle('ok', ok && !!s);
  previewEl.classList.toggle('ng', !ok && !!s);

  // クリアボタン：OKなら有効、NG/空は無効（入力は保持しないため）
  clearBtn.disabled = !(ok && !!s);
}

async function doPaste(){
  try{
    const t = await navigator.clipboard.readText();
    const s = String(t || '').trim();
    if (!s){
      alert('クリップボードが空です');
      return;
    }

    const vr = validateDeckCodeLight(s);

    if (!vr.ok){
      // 失格：UIは未設定に戻し、hidden も空
      hiddenEl.value = '';
      try{ window.scheduleAutosave?.(); }catch(_){ }
      reflectUI('');  // ← NGはここで“空表示”にする
      alert(`貼り付けた文字列はデッキコードではなさそうです。\n理由: ${vr.reason || '形式不一致'}`);
      return;
    }

    // 合格：保存してUI反映
    hiddenEl.value = s;
    reflectUI(s);
    try{ window.scheduleAutosave?.(); }catch(_){ }

  }catch(err){
    console.error(err);
    alert('デッキコードの貼り付けに失敗しました（権限やブラウザ設定をご確認ください）');
  }
}

  function doClear(){
    hiddenEl.value = '';
    reflectUI('');
    try{ window.scheduleAutosave?.(); }catch(_){ }
  }

  pasteBtn.addEventListener('click', doPaste);
  clearBtn.addEventListener('click', doClear);

  // 初期同期（オートセーブ復元時など）
  window.writePastedDeckCode = function(s){ try{ hiddenEl.value = String(s || ''); reflectUI(hiddenEl.value); }catch(_){}};
  reflectUI(hiddenEl.value || '');
})();


// --- デッキコード軽量判定（見た目チェック専用・強化版） ---
// 返り値: { ok: boolean, reason: string }
function validateDeckCodeLight(raw){
  const s = String(raw || '').trim();

  // 空・長さ（やや厳しめ：URL-safe Base64 で60～400程度を想定）
  if (!s) return { ok:false, reason:'空文字' };
  if (s.length < 60)  return { ok:false, reason:'短すぎ' };
  if (s.length > 400) return { ok:false, reason:'長すぎ' };

  // 空白・改行・タブ禁止／URL除外
  if (/\s/.test(s)) return { ok:false, reason:'空白/改行を含む' };
  if (/https?:\/\//i.test(s)) return { ok:false, reason:'URL形式' };

  // 「英字だけの単語列」を除外（camelCase など明らかに文章ぽいもの）
  if (/^[A-Za-z]{20,}$/.test(s)) return { ok:false, reason:'英字のみの単語' };

  // Base64/URL-safe Base64 っぽさ（許容文字セット）
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) {
    return { ok:false, reason:'文字種/末尾が不正' };
  }

  // 末尾 '=' の個数は 0～2、かつ Base64 長の整合（= を除いた長さ % 4 != 1）
  const padLen = (s.match(/=+$/) || [''])[0].length;
  if (padLen > 2) return { ok:false, reason:'パディング異常' };
  const coreLen = s.replace(/=+$/,'').length;
  if (coreLen % 4 === 1) return { ok:false, reason:'長さ整合×' };

  // 雑なエントロピー要件：カテゴリ混在を要求（数字 or 記号 が混ざる）
  const hasLower = /[a-z]/.test(s);
  const hasUpper = /[A-Z]/.test(s);
  const hasDigit = /\d/.test(s);
  const hasMark  = /[+/_-]/.test(s);
  const mixedCnt = [hasLower,hasUpper,hasDigit,hasMark].filter(Boolean).length;
  if (mixedCnt < 3) return { ok:false, reason:'多様性不足' };

  // 数字の個数（最低 6 以上を要求）
  const digitCount = (s.match(/\d/g) || []).length;
  if (digitCount < 6) return { ok:false, reason:'数字が少なすぎ' };

  return { ok:true, reason:'' };
}

// --- クリップボード貼り付け---
async function doPaste(){
  try{
    const t = await navigator.clipboard.readText();
    const s = String(t || '').trim();
    if (!s){
      alert('クリップボードが空です');
      return;
    }

    const vr = validateDeckCodeLight(s);
    // プレビューは常に更新（中身確認用）
    reflectUI(s);

    if (!vr.ok){
      // デッキコードらしくない → hidden には保存しない
      hiddenEl.value = '';
      alert(`デッキコードではなさそうです（${vr.reason || '形式不一致'}）`);
      return;
    }

    // OK のときだけ採用
    hiddenEl.value = s;
    try{ window.scheduleAutosave?.(); }catch(_){ }

  }catch(err){
    console.error(err);
    alert('貼り付けに失敗しました');
  }
}


// === Xハンドル正規化（グローバル） ===
function normalizeHandle(v=''){
  v = String(v).trim();
  if (!v) return '';
  v = v.replace(/^https?:\/\/(www\.)?x\.com\//i,''); // URLで来たらドメイン除去
  v = v.replace(/^@+/,'');  // 先頭@を削除
  return '@' + v;
}


/*同意チェック*/
function bindMinimalAgreeCheck() {
  const agree  = document.getElementById('post-agree');
  const submit = document.getElementById('post-submit');

  const sync = () => {
    const ok = !!agree.checked;
    submit.disabled = !ok;
    submit.classList.toggle('is-disabled', !ok);
  };

  agree.addEventListener('change', sync);
  sync();
}
// 投稿フォームのリセット
function resetDeckPostForm() {
  const ok = window.confirm('投稿フォームの内容をすべて初期化します。\nよろしいですか？');
  if (!ok) return;

  // デッキ名（投稿タブ側）
  const nameInput = document.getElementById('post-deck-name');
  if (nameInput) nameInput.value = '';

  // デッキ解説
  const note = document.getElementById('post-note');
  if (note) note.value = '';

  // カード解説（行＋ミラー用hidden）
  const notesWrap   = document.getElementById('post-card-notes');
  const notesHidden = document.getElementById('post-card-notes-hidden');
  if (notesWrap)   notesWrap.innerHTML = '';
  if (notesHidden) notesHidden.value = '[]';

  // 選択タグ
  const selectTags = document.getElementById('select-tags');
  if (selectTags) {
    // すべての .chip から active を外す
    selectTags.querySelectorAll('.chip.active').forEach(chip => {
      chip.classList.remove('active');
    })
  }

  // ユーザータグ
  const userTagsWrap   = document.getElementById('user-tags');
  const userTagsHidden = document.getElementById('post-user-tags-hidden');
  if (userTagsWrap)   userTagsWrap.innerHTML = '';
  if (userTagsHidden) userTagsHidden.value = '';

  // 貼り付けデッキコード
  const pastedPreview = document.getElementById('pasted-code-preview');
  const clearBtn      = document.getElementById('btn-clear-code');
  const shareHidden   = document.getElementById('post-share-code');
  if (pastedPreview) pastedPreview.textContent = '（未設定）';
  if (clearBtn)      clearBtn.disabled = true;
  if (shareHidden)   shareHidden.value = '';

  // 投稿同意チェックを外す
  const agree = document.getElementById('post-agree');
  if (agree) agree.checked = false;

  // 投稿ボタン状態もリセット
  const submit = document.getElementById('post-submit');
  if (submit) {
    submit.disabled = true;
    submit.classList.add('is-disabled');
  }

  // 必要ならサマリー類を再同期
  if (typeof refreshPostSummary === 'function') {
    refreshPostSummary();
  }
}



// === 投稿タブ: 画像生成ボタン ===
(function attachPostImageGenButton(){
  const btn = document.getElementById('post-open-imagegen');
  if (!btn) return;

  btn.addEventListener('click', () => {
    // common-page24.js 側の exportDeckImage() を直接呼ぶ
    if (typeof window.exportDeckImage === 'function') {
      window.exportDeckImage();
      return;
    }
    // fallback: デッキ情報タブ側のボタンがあればクリック
    const proxy = document.getElementById('exportPngBtn');
    if (proxy) {
      proxy.click();
      return;
    }
    alert('画像生成機能が見つかりませんでした（exportDeckImage / #exportPngBtn）');
  });
})();

// ===== 投稿タブ初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  const postTab = document.getElementById('post-tab');
  if (!postTab) return;

  // 同意チェック初期化
  bindMinimalAgreeCheck();

  // ★ 追加：キャンペーンミニ通知（開催中のみ表示）
  try { renderDeckmakerCampaignMiniNotice(); } catch(e){ console.warn('campaign mini error', e); }

  // ★ 追加：キャンペーンバナー（開催中のみ表示）
  try { renderDeckmakerCampaignBanner(); } catch(e){ console.warn('campaign banner error', e); }


  // 投稿リセットボタン
  const resetBtn = document.getElementById('post-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetDeckPostForm);
  }
});




//投稿チェック
function validateDeckBeforePost(){
  const msgs = [];
  // 30〜40枚
  const n = typeof getDeckCount==='function' ? getDeckCount() : 0;
  if (n < 30 || n > 40) msgs.push(`枚数が範囲外(${n})`);
  // 同名3枚/旧神1種1枚/種族制限は、あなたの既存ロジックがあればそれを利用して判定メッセージをpush
  if (typeof validateDeckConstraints==='function') {
    const more = validateDeckConstraints(); // 例：配列で返す
    if (Array.isArray(more)) msgs.push(...more);
  }
  // デッキ名の取得（info/postどちらからでもOK）
  const infoNameEl = document.getElementById('info-deck-name');
  const postNameEl = document.getElementById('post-deck-name');
  const title =
    (postNameEl?.value?.trim()) ||
    (infoNameEl?.value?.trim()) ||
    ''; // 両方空なら空文字

  if (!title) msgs.push('デッキ名が未入力');
  // 同意
  if (!document.getElementById('post-agree')?.checked) msgs.push('ガイドライン未同意');
  return msgs;
}


// ★ Auth から安全に値を取る小ヘルパ（共通JSで定義していない場合の保険）
function getAuthSafe(){
  const A = window.Auth || {};
  return {
    token: A.token || '',
    user : (A.user || null)
  };
}

// --- デッキ特徴量（コスト/パワー/タイプ内訳）を計算して投稿用にまとめる ---
function buildDeckFeaturesForPost() {
  // 既存の deck オブジェクト（cd -> 枚数）を利用
  const deckObj = window.deck || {};
  const entries = Object.entries(deckObj).filter(([,n]) => (n|0) > 0);

  // カード辞書を一度だけ構築（cd -> {cost, power, type}）
  if (!window.__cardIndex) {
    const src = window.allCards || window.cards || window.cardData || [];
    const idx = {};
    (Array.isArray(src) ? src : Object.values(src)).forEach(c => {
      // 想定キー：cd, cost, power, type など（実データに合わせて調整可）
      if (c && c.cd != null) idx[String(c.cd).padStart(5,'0')] = c;
    });
    window.__cardIndex = idx;
  }
  const idx = window.__cardIndex;

  // 固定長ヒスト（0..30,+31） = 32本
  const HLEN = 32, LIM = 31;
  const hCost = new Array(HLEN).fill(0);
  const byType = { Chg:[], Atk:[], Blk:[] };

  // 合計タイプ枚数
  const typeMix = { Chg:0, Atk:0, Blk:0 };

  entries.forEach(([cd, n]) => {
    const c = idx[String(cd).padStart(5,'0')] || {};
    const cnt = n|0;

    const cost = Math.max(0, Math.min(LIM, Number(c.cost)||0));
    hCost[cost] += cnt;
    if ((Number(c.cost)||0) > LIM) hCost[LIM] += 0; // 31+（将来の拡張用に明示）

    const typeKey = (c.type === 'チャージャー') ? 'Chg' :
                    (c.type === 'アタッカー')  ? 'Atk' :
                    (c.type === 'ブロッカー')  ? 'Blk' : null;
    if (typeKey){
      typeMix[typeKey] += cnt;
      for (let i = 0; i < cnt; i++) byType[typeKey].push(Number(c.power)||0);
    }
  });

  // タイプ別のパワー分布（同じく32本）
  function hist32(arr){
    const h = new Array(HLEN).fill(0);
    arr.forEach(v => {
      const p = Math.max(0, Math.min(LIM, Number(v)||0));
      h[p] += 1;
    });
    return h;
  }

  const typePower = {
    Chg: { hist: hist32(byType.Chg), sum: byType.Chg.reduce((a,b)=>a+b,0), n: byType.Chg.length },
    Atk: { hist: hist32(byType.Atk), sum: byType.Atk.reduce((a,b)=>a+b,0), n: byType.Atk.length },
    Blk: { hist: hist32(byType.Blk), sum: byType.Blk.reduce((a,b)=>a+b,0), n: byType.Blk.length },
  };
  ['Chg','Atk','Blk'].forEach(k => {
    const o = typePower[k]; o.avg = o.n ? (o.sum / o.n) : 0;
  });

  return {
    costHistJSON: JSON.stringify(hCost),
    costHistV: 1,
    typeMixJSON: JSON.stringify([typeMix.Chg, typeMix.Atk, typeMix.Blk]),
    typePowerHistJSON: JSON.stringify(typePower),
    typePowerHistV: 1
  };
}


// 送信内容
function buildDeckPostPayload(){
  const title   = document.getElementById('post-deck-name')?.value.trim() || '';
  const comment = document.getElementById('post-note')?.value.trim() || '';
  const code    = document.getElementById('post-deck-code')?.value || '';
  const races   = document.getElementById('post-races-hidden')?.value || '';
  const repImg  = document.getElementById('post-rep-img')?.value || '';
  const count   = (typeof getDeckCount === 'function') ? getDeckCount() : 0;
  const shareCode = document.getElementById('post-share-code')?.value.trim() || '';

  // 投稿者名・X
  const posterInp = document.getElementById('auth-display-name')?.value.trim() || '';
  const posterXIn = normalizeHandle(document.getElementById('auth-x')?.value || '');

  // deck を {cd: count} 形式へ（GAS の buildDeckFeatures_ が解釈しやすい形）
  let cardsMap = {};
  try {
    if (typeof deck === 'object' && deck) {
      // 既存のグローバル deck を想定（cd:枚数）
      Object.entries(deck).forEach(([cd, n]) => {
        n = n | 0;
        if (n > 0) cardsMap[String(cd).padStart(5,'0')] = n;
      });
    } else if (typeof getDeckAsArray === 'function') {
      // フォールバック：[[cd,count], ...] を想定
      (getDeckAsArray() || []).forEach(([cd, n]) => {
        n = n | 0;
        if (n > 0) cardsMap[String(cd).padStart(5,'0')] = n;
      });
    }
  } catch(_) {}

  // --- カード解説を取り出す ---
  let cardNotes = [];
  try {
    // CardNotes モジュールがあればそっち優先
    if (window.CardNotes && typeof window.CardNotes.getList === 'function') {
      cardNotes = window.CardNotes.getList();
    } else {
      // フォールバック：hidden の JSON を読む
      const hidden = document.getElementById('post-card-notes-hidden');
      if (hidden && hidden.value) {
        const arr = JSON.parse(hidden.value);
        if (Array.isArray(arr)) {
          cardNotes = arr.map(r => ({
            cd:   String(r.cd   || ''),
            text: String(r.text || '')
          }));
        }
      }
    }
  } catch(_) {
    cardNotes = [];
  }

  const { token, user } = getAuthSafe();
  const posterName = posterInp || user?.displayName || user?.username || '';
  const posterX    = posterXIn || user?.x || '';
  const username   = user?.username || (window.Auth?.user?.username) || '';

return {
  title, comment, code, count, races, repImg,
  cards: cardsMap,
  // ★ 追加：{cd: count} をそのまま文字列化
  cardsJSON: JSON.stringify(cardsMap),

  cardNotes,
  shareCode,
  ua: navigator.userAgent,
  autoTags  : Array.from(document.querySelectorAll('#auto-tags .chip[data-auto="true"]'))
                 .map(el => el.textContent.trim()).filter(Boolean),
  selectTags: Array.from(document.querySelectorAll('#select-tags .chip.active'))
                 .map(el => el.textContent.trim()).filter(Boolean),
  userTags  : Array.isArray(window.PostUserTags) ? window.PostUserTags.slice(0, 3) : [],
  token,
  poster: { name: posterName, x: posterX, username },
  };
}

// 投稿中フラグ
let isPostingDeck = false;

// 投稿トースト表示
function showPostToast(message, type='success', persist=false){
  const box = document.getElementById('post-toast');
  if (!box) return;

  // 内容（失敗時はクロスボタン付き）
  if (persist) {
    box.innerHTML = `
      <div>${message}</div>
      <div style="margin-top:6px;font-size:0.8em;opacity:0.85">
        📸 エラーが続く場合は、このメッセージのスクリーンショットをご提出ください。
      </div>
      <div style="text-align:right;margin-top:8px;">
        <button id="toast-close-btn" style="
          background:#fff;color:#333;border:none;border-radius:6px;
          padding:4px 8px;cursor:pointer;font-size:0.75rem;">閉じる</button>
      </div>
    `;
  } else {
    box.textContent = message;
  }

  // スタイル設定
  box.className = 'post-toast ' + type;
  box.style.display = 'block';

  // 閉じるボタン（失敗時）
  if (persist) {
    document.getElementById('toast-close-btn')?.addEventListener('click', () => {
      box.style.display = 'none';
      box.innerHTML = '';  // ←中身を完全リセット
    });
    return; // ← 自動では消さない
  }

  // --- 成功時のみ短時間で消える ---
  clearTimeout(window._postToastTimer);
  window._postToastTimer = setTimeout(()=>{
    box.style.display = 'none';
  }, 3500);
}

// 投稿成功モーダルを開く
function openPostSuccessModal(opts = {}) {
  const modal = document.getElementById('postSuccessModal');
  if (!modal) return;

  const nameEl = document.getElementById('post-success-deck-name');
  const deckName =
    (opts.deckName ||
      (window.readDeckNameInput?.() || '').trim());

  if (nameEl) {
    nameEl.textContent = deckName || '（デッキ名）';
  }

  // キャンペーン表示（開催中のみ）
  const campBox = document.getElementById('post-success-campaign');
  const campText = document.getElementById('post-success-campaign-text');
  const camp = opts.campaign || null;
  if (campBox && campText) {
    if (camp && (camp.isActive === true || String(camp.isActive) === 'true') && String(camp.campaignId || '')) {
      const title = String(camp.title || 'キャンペーン');
      const start = camp.startAt ? new Date(camp.startAt) : null;
      const end   = camp.endAt   ? new Date(camp.endAt)   : null;
      const fmt = (d)=> (d && !isNaN(d)) ? formatYmd(d) : '';
      const range = (start||end) ? `（${fmt(start)}〜${fmt(end)}）` : '';
      campText.textContent = `${title}${range}`;
      campBox.style.display = '';
    } else {
      campBox.style.display = 'none';
    }
  }

  modal.style.display = 'flex'; // 他モーダルに合わせてflex
  document.body.style.overflow = 'hidden';

  // プレビューを非同期で生成します。エラーはログ出力のみにします。
  if (typeof updatePostSuccessPreview === 'function') {
    updatePostSuccessPreview().catch(err => {
      console.error('post-success preview error:', err);
    });
  }
}



// 投稿成功モーダルのイベントをセット
function initPostSuccessModal() {
  const modal      = document.getElementById('postSuccessModal');
  if (!modal) return;

  const closeBtn   = document.getElementById('post-success-close');
  const openPosts  = document.getElementById('post-success-open-posts');
  const tweetBtn   = document.getElementById('post-success-tweet');
  const genImgBtn  = document.getElementById('post-success-gen-image');

  const closeModal = () => {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  };

  // ×ボタン
  closeBtn?.addEventListener('click', closeModal);


  // 投稿一覧を開く
  openPosts?.addEventListener('click', () => {
    closeModal();
    // ヘッダーの「📤 デッキ投稿」と同じ遷移先に合わせる
    location.href = 'deck-post.html';
  });

  // ポスト用画像を生成（既存の画像生成ロジックを可能な範囲で流用）
  genImgBtn?.addEventListener('click', () => {
    try {
      if (typeof window.exportDeckImage === 'function') {
        // deckmaker 上部の「画像生成」と同じ関数があればそれを使う
        window.exportDeckImage();
      } else if (window.DeckImg && typeof window.DeckImg.export === 'function') {
        window.DeckImg.export();
      } else if (window.DeckImg && typeof window.DeckImg.exportDeckImage === 'function') {
        window.DeckImg.exportDeckImage();
      } else {
        alert('画像生成機能が見つかりませんでした。上部の「画像生成」ボタンをお使いください。');
      }
    } catch (e) {
      console.error('post-success image gen error:', e);
      alert('画像生成中にエラーが発生しました。');
    }
  });

  // X でポスト画面を開く
  tweetBtn?.addEventListener('click', () => {
    const deckName =
      (window.readDeckNameInput?.() ||
        document.getElementById('post-success-deck-name')?.textContent ||
        '').trim();

    const baseText = deckName
      ? `【神託のメソロギア】「${deckName}」デッキを投稿しました！`
      : '【神託のメソロギア】デッキを投稿しました！';

    const hashtags = '#神託のメソロギア #メソロギアデッキ';
    const text = `${baseText}\n${hashtags}`;

    // 投稿一覧ページを共有URLに（必要なら後で個別ページURLに差し替え）
    const url = 'https://mosurogia.github.io/mesorogia-cards/deck-post.html';

    const intent =
      'https://twitter.com/intent/tweet?text=' +
      encodeURIComponent(text) +
      '&url=' +
      encodeURIComponent(url);

    window.open(intent, '_blank', 'noopener');
  });
}

// ページ読み込み時にモーダルを初期化
document.addEventListener('DOMContentLoaded', initPostSuccessModal);

// -----------------------------------------------------------------------------
// 投稿成功モーダル内のポスト画像プレビュー
// 成功時に表示されるモーダルの右側にデッキ画像の簡易プレビューを挿入します。
// common-page24.js で公開されている buildShareNode / buildDeckSummaryData / getCanvasSpec を利用します。
// -----------------------------------------------------------------------------
async function updatePostSuccessPreview() {
    const container = document.getElementById('post-success-preview');
    if (!container) return;

    // 既存プレビューをクリア
    container.innerHTML = '';

    // デッキが空の場合は何もしない
    const deckObj = window.deck || {};
    const total = Object.values(deckObj).reduce((a, b) => a + (b | 0), 0);
    if (!total) return;

    // 必要な関数が存在するか確認
    if (typeof window.buildShareNodeForPreview       !== 'function' ||
        typeof window.buildDeckSummaryDataForPreview !== 'function' ||
        typeof window.getCanvasSpecForPreview        !== 'function') {
        return;
    }

    // データと spec を取得
    const data   = window.buildDeckSummaryDataForPreview();
    const aspect = '3:4';
    const kinds  = data.uniqueList ? data.uniqueList.length : 0;
    const spec   = window.getCanvasSpecForPreview(aspect, kinds);
    spec.cols = 5;

    try {
        // プレビュー用ノードを構築
        const node = await window.buildShareNodeForPreview(data, spec);

        // 固定配置・固定サイズを解除
        node.style.position = 'relative';
        node.style.left     = '0';
        node.style.top      = '0';

        // プレビューの縮小率を算出します。
        // コンテナの幅から計算し、1より大きくならないよう制限します。
        const containerWidth = container.clientWidth || spec.width;
        let scale = containerWidth / spec.width;
        if (scale > 1) scale = 1;

        // ★ポイント★
        // 1) コンテナ自体の幅・高さを縮小後のサイズに合わせます。
        container.style.width  = `${spec.width  * scale}px`;
        container.style.height = `${spec.height * scale}px`;
        container.style.overflow = 'hidden';

        // 2) ノードには元サイズを指定し、transform で縮小します。
        node.style.width  = `${spec.width}px`;
        node.style.height = `${spec.height}px`;
        node.style.transformOrigin = 'top left';
        node.style.transform = `scale(${scale})`;

        // 挿入
        container.appendChild(node);


    } catch (err) {
        console.error('updatePostSuccessPreview error:', err);
    }
}


// 検証用：コンソールから呼び出せるテスト関数
// 例）ブラウザのコンソールで
//   debugShowPostSuccessModal('テストデッキ');
// と叩くと、投稿なしでモーダルだけ確認できます。
// deckName: 任意のデッキ名（省略可）
// postId: 任意の投稿ID（省略可）
// campaign: 任意のキャンペーン情報オブジェクト（省略可）
window.debugShowPostSuccessModal = async function(deckName){
  let campaign = null;
  try { campaign = await (window.fetchActiveCampaign?.() || Promise.resolve(null)); } catch(_){ campaign = null; }

  openPostSuccessModal({
    deckName:
      (deckName ||
        (window.readDeckNameInput?.() || '').trim() ||
        'テスト用デッキ'),
    campaign,
  });
};


// 文字列CSV / 配列どっちでも対応して tag を除去する
function stripTagAny_(v, tag){
  const t = String(tag || '').trim();
  if (!t) return v;

  // 配列
  if (Array.isArray(v)){
    return v.map(x=>String(x||'').trim()).filter(x=>x && x !== t);
  }

  // CSV文字列
  const s = String(v || '');
  if (!s) return s;

  const arr = s.split(',').map(x=>x.trim()).filter(Boolean).filter(x=>x !== t);
  return arr.join(',');
}


// 送信（デッキコードは任意：空なら検証スキップ）
async function submitDeckPost(e, opts = {}) {
  e?.preventDefault();


  // すでに送信処理中なら無視（トーストだけ出す）
  if (isPostingDeck) {
    showPostToast('投稿処理中です。完了までお待ちください。', 'info');
    return false;
  }
  isPostingDeck = true;

  const form = document.getElementById('deck-post-form');

  // 0) 通常の required チェック
  if (form && !form.reportValidity()) {
    isPostingDeck = false; // ★ ここで必ず戻す
    return false;
  }

  // 0-1) 代表カード未選択チェック
  const repValidator = document.getElementById('post-rep-validator');
  if (repValidator) {
    repValidator.setCustomValidity('');
    const hasRep = !!window.representativeCd;
    if (!hasRep) {
      repValidator.setCustomValidity('代表カードを1枚選択してください');
      repValidator.reportValidity();
      isPostingDeck = false; // ★ 戻す
      return false;
    }
  }

  // 0-2) カード解説未入力チェック
  const cardnoteValidator = document.getElementById('post-cardnote-validator');
  if (cardnoteValidator) {
    cardnoteValidator.setCustomValidity('');

    let hasIncomplete = false;
    const rows = document.querySelectorAll('#post-card-notes .post-card-note, #post-card-notes .card-note-row');
    rows.forEach(row => {
      const cd = (row.dataset.cd || '').trim();
      if (!cd) return;
      const ta = row.querySelector('textarea');
      if (ta && !ta.value.trim()) {
        hasIncomplete = true;
      }
    });

    if (hasIncomplete) {
      cardnoteValidator.setCustomValidity('カードが選択されているカード解説には本文を入力してください');
      cardnoteValidator.reportValidity();
      isPostingDeck = false; // ★ 戻す
      return false;
    }
  }

// ===== ここでキャンペーン確認を挟む =====
let joinCampaign = false;

let camp = null;
try { camp = await (window.fetchActiveCampaign?.() || Promise.resolve(null)); } catch(_){ camp = null; }

const isActive =
  camp &&
  (camp.isActive === true || String(camp.isActive) === 'true') &&
  String(camp.campaignId || '');

if (isActive) {
  const result = window.checkCampaignEligibility_?.(camp) || { ok:false, reasons:['条件判定関数が未設定です'] };

  if (result.ok) {
    // ★ 条件OKなら、確認なしで自動でキャンペーン参加
    joinCampaign = true;
  } else {
    // ★ 条件NGのときだけ「投稿するか？」を聞く（参加しない投稿はここでのみ発生）
    const reasons = Array.isArray(result.reasons) ? result.reasons : [];
    const ok = window.confirm(
      'キャンペーン条件を満たしていませんが、投稿は可能です。\n\n未達条件：\n- ' +
      (reasons.length ? reasons.join('\n- ') : '（詳細不明）') +
      '\n\nOK：投稿する（キャンペーン不参加）\nキャンセル：やめる'
    );
    if (!ok) {
      isPostingDeck = false;
      return false;
    }
    joinCampaign = false;
  }
}
// ===== キャンペーン確認ここまで =====


  const btn = document.getElementById('post-submit');
  const spinner = document.getElementById('post-loading');

  if (btn) {
    btn.disabled = true;
    btn.textContent = '投稿中…';
  }
  if (spinner) spinner.style.display = 'block';

  //ここまで来ても representativeCd が空なら、デッキ内から自動で1枚選ぶ ---
  if (!window.representativeCd) {
    const deckObj = window.deck || {};
    const cds = Object.entries(deckObj)
      .filter(([, n]) => (n | 0) > 0)
      .map(([cd]) => cd);

    if (cds.length) {
      cds.sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
      window.representativeCd = cds[0];
      console.warn('[post] representativeCd が空だったため、自動で代表カードを補完しました:', window.representativeCd);
    }
  }

  // --- 投稿ペイロード構築 ---
  const base = buildDeckPostPayload();
  const feat = buildDeckFeaturesForPost();
  const payload = { ...base, ...feat };

    payload.joinCampaign = !!joinCampaign;
    payload.campaignId   = (joinCampaign && isActive) ? String(camp.campaignId || '') : '';

  // 代表カード情報を追加
  payload.repCd = window.representativeCd || '';
  payload.repImg = payload.repCd
    ? `img/${String(payload.repCd).slice(0,5)}.webp`
    : '';


  try {
  // camp から「今回のキャンペーンタグ名」を取る（camp側の実データに合わせて）
  const campaignTag = String(camp?.tag || camp?.entryTag || camp?.campaignTag || '').trim();

  // joinCampaign=false のときはタグを剥がす（誤解防止）
  if (!joinCampaign && campaignTag) {
    payload.selectTags = stripTagAny_(payload.selectTags, campaignTag);
    payload.tagsPick   = stripTagAny_(payload.tagsPick,   campaignTag); // あればでOK
  }

  // 参加しないなら campaignId も空にしておく
  if (!joinCampaign) payload.campaignId = '';

  const res = await fetch(`${GAS_POST_ENDPOINT}?mode=post`, {
    method : 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body   : JSON.stringify(payload),
  });
  const json = await res.json();


  if (json.ok) {
    // 成功トースト＋チェックアニメ
    showPostToast('投稿が完了しました', 'success');
    try { showSuccessCheck(); } catch (_) {}

    // 成功モーダルを開く（デッキ名も反映）
    const deckName =
      (window.readDeckNameInput?.() ||
      document.getElementById('post-deck-name')?.value ||
      '').trim();

    const postId = String(json.postId || '');
    let campaign = null;
    try { campaign = await (window.fetchActiveCampaign?.() || Promise.resolve(null)); } catch(_){ campaign = null; }

    openPostSuccessModal({ deckName, postId, campaign });

  } else {
    if (json.error === 'too_many_posts') {
      showPostToast(
        '短時間に連続して投稿することはできません。少し時間をおいて再度お試しください。',
        'error'
      );
    } else if (json.error === 'dup_post') {
      showPostToast(
        '同じ内容の投稿を二重送信しそうだったのでブロックしました。',
        'info'
      );
    } else {
      showPostToast(
        `投稿失敗：${json.error || '不明なエラー'}`,
        'error',
        true
      );
    }
  }
  } catch(err){
    console.error(err);
    showPostToast('通信エラーが発生しました', 'error', true);
  }

  // --- 投稿完了後：UI復元 ---
  if (btn) {
    btn.disabled = false;
    btn.textContent = '投稿';
  }
  if (spinner) spinner.style.display = 'none';

  // ★ 最後に必ずフラグ解除
  isPostingDeck = false;

  return false;
}


// 共通：innerHTML用エスケープ
function escapeHtml_(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}


//#endregion



/*======================================================
  9) デッキ解説・ノート関連
======================================================*/
//#region 9. ノートプリセット・モーダル
// // ここに：NOTE_PRESETS, insertPresetTo, フルスクリーン編集モーダル など
//#endregion



/*======================================================
  10) 代表カード選択モーダル
======================================================*/
//#region 10. 代表カードモーダル
/* ==================================================
   3) 代表カード選択モーダル
   - 代表名をタップ → デッキから候補グリッド生成 → 選択で代表更新
   - 並び順はデッキリストと同一ルール
   ================================================== */

// 開閉
function openRepSelectModal() {
  if (!deck || Object.keys(deck).length === 0) {
    try { showToast?.('デッキが空です'); } catch {}
    return;
  }
  buildRepSelectGrid();
  const modal = document.getElementById('repSelectModal');
  if (modal) modal.style.display = 'block';
}
function closeRepSelectModal() {
  const modal = document.getElementById('repSelectModal');
  if (modal) modal.style.display = 'none';
}

// グリッド生成（renderDeckList と同じ並び順）
function buildRepSelectGrid() {
  const grid = document.getElementById('repSelectGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const typeOrder = { 'チャージャー': 0, 'アタッカー': 1, 'ブロッカー': 2 };
  const entries = Object.entries(deck || {}).sort((a, b) => {
    const [cdA] = a, [cdB] = b;
    const A = cardMap[cdA], B = cardMap[cdB];
    if (!A || !B) return 0;
    const tA = typeOrder[A.type] ?? 99, tB = typeOrder[B.type] ?? 99;
    if (tA !== tB) return tA - tB;
    const cA = (+A.cost || 0), cB = (+B.cost || 0); if (cA !== cB) return cA - cB;
    const pA = (+A.power || 0), pB = (+B.power || 0); if (pA !== pB) return pA - pB;
    return String(cdA).localeCompare(String(cdB));
  });

  for (const [cd] of entries) {
    const info = cardMap[cd];
    if (!info) continue;

    const wrap = document.createElement('div');
    wrap.className = 'item';
    wrap.style.cursor = 'pointer';
    wrap.dataset.cd = String(cd);

    const img = document.createElement('img');
    img.alt = info.name || '';
    img.loading = 'lazy';
    img.src = `img/${String(cd).slice(0,5)}.webp`;
    img.onerror = () => { img.onerror = null; img.src = 'img/00000.webp'; };

    const name = document.createElement('div');
    name.className = 'cardnote-name';
    name.textContent = info.name || '';

    wrap.appendChild(img);
    wrap.appendChild(name);

    // ★ クリックで代表カードに設定
    wrap.addEventListener('click', () => {
      const newCd = String(cd);

      // 代表カードを更新
      representativeCd = newCd;
      window.representativeCd = representativeCd;

      // 画面を同期
      updateRepresentativeHighlight?.();
      updateDeckSummaryDisplay?.();
      scheduleAutosave?.();

      // モーダルを閉じる
      closeRepSelectModal();
    });

    grid.appendChild(wrap);
  }
}


// 代表名タップでモーダル起動／外側タップで閉じる
document.addEventListener('DOMContentLoaded', () => {
  ['deck-representative', 'post-representative'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('tap-target');
    el.style.cursor = 'pointer';
    el.title = 'タップして代表カードを選択';
    el.addEventListener('click', openRepSelectModal);
  });
  document.getElementById('repSelectClose')?.addEventListener('click', closeRepSelectModal);
  document.getElementById('repSelectModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'repSelectModal') closeRepSelectModal();
  });
});



//#endregion



/*======================================================
  11) ログイン・アカウント関連
======================================================*/
//#region 11. Auth関連（whoami / logout / UI同期）
  // // ここに：Auth.updateUI, whoami 呼び出し、ロード中UIなど
//#endregion


/*======================================================
  12) キャンペーン関連
======================================================*/
//#region 12. キャンペーン関連（条件チェック・参加確認）
  // // ここに：キャンペーン関連の処理
// ===== キャンペーン（ミニ告知：タブバー直下） =====
async function renderDeckmakerCampaignMiniNotice(){
  const box  = document.getElementById('campaign-mini');
  const text = document.getElementById('campaign-mini-text');
  if (!box || !text) return;

  let camp = null;
  try {
    camp = await (window.fetchActiveCampaign?.() || Promise.resolve(null));
  } catch(_) {}

  const isActive =
    camp &&
    (camp.isActive === true || String(camp.isActive) === 'true') &&
    String(camp.campaignId || '');

  if (!isActive) {
    box.style.display = 'none';
    return;
  }

  const title = String(camp.title || '').trim();

  // ★「入りきらない時だけ」改行される
  const msg = title
    ? `${escapeHtml_(title)}開催中！<wbr>デッキ投稿募集中！`
    : `キャンペーン開催中！<wbr>デッキ投稿募集中！`;

  text.innerHTML = msg;
  box.style.display = '';
}


// ===== キャンペーンバナー（デッキメーカー：投稿ボタン上） =====
async function renderDeckmakerCampaignBanner(){
  const box = document.getElementById('campaign-banner');
  const titleEl = document.getElementById('campaign-banner-title');
  const textEl  = document.getElementById('campaign-banner-text');
  const rangeEl = document.getElementById('campaign-banner-range');
  if (!box || !titleEl || !textEl) return;

  let camp = null;
  try { camp = await (window.fetchActiveCampaign?.() || Promise.resolve(null)); } catch(_){ camp = null; }

  const isActive =
    camp && (camp.isActive === true || String(camp.isActive) === 'true') && String(camp.campaignId||'');

  if (!isActive) {
    box.style.display = 'none';
    return;
  }

  const rawTitle = String(camp.title || 'キャンペーン');
  const start = camp.startAt ? new Date(camp.startAt) : null;
  const end   = camp.endAt   ? new Date(camp.endAt)   : null;

  const fmt = (d)=> (d && !isNaN(d)) ? formatYmd(d) : '';
  const computedRange = (start||end) ? `${fmt(start)}〜${fmt(end)}` : '';

  const titleHasRange = /[（(]\s*\d{4}\/\d{1,2}\/\d{1,2}\s*〜\s*\d{4}\/\d{1,2}\/\d{1,2}\s*[)）]/.test(rawTitle);
  const cleanTitle = rawTitle
    .replace(/[（(]\s*\d{4}\/\d{1,2}\/\d{1,2}\s*〜\s*\d{4}\/\d{1,2}\/\d{1,2}\s*[)）]\s*/g, '')
    .trim();

  titleEl.textContent = cleanTitle || 'キャンペーン';
  if (rangeEl) rangeEl.textContent = (!titleHasRange && computedRange) ? computedRange : '';

  // 文言（基本形）
  textEl.textContent =
    'デッキを投稿して、キャンペーンに参加しよう！ 詳しい参加条件や報酬は、詳細をチェック！';

  box.style.display = '';

// --- ここから追記：キャンペーンタグをグローバル共有（1キャンペーン前提） ---
window.__activeCampaign = camp;
window.__activeCampaignTag = (cleanTitle || 'キャンペーン').trim();

  // バナーUI（対象タグ行）
  const tagRow  = document.getElementById('campaign-banner-tagrow');
  const tagBtn  = document.getElementById('campaign-tag-toggle');

  // ★ 毎回ここで最新のログイン状態を取る（固定しない）
  const getAuthState = ()=>{
    const A = window.Auth;
    const loggedIn = !!(A?.user && A?.token && A?.verified);

    // ★ Auth.user.x ではなく入力欄を参照
    const xRaw = document.getElementById('auth-x')?.value || '';
    const xAccount = String(xRaw).trim().replace(/^@+/, ''); // @ありでもOK
    const hasX = !!xAccount;

    return { loggedIn, hasX, xAccount };
  };


    // ===== 対象判定：チェックリスト更新 =====
  const criteriaRoot = box.querySelector('.campaign-criteria');

  function updateCriteriaUI({ isLoggedIn, hasX, hasTag }){
    if (!criteriaRoot) return;
    const map = { login: !!isLoggedIn, x: !!hasX, tag: !!hasTag };

    criteriaRoot.querySelectorAll('.criteria-item').forEach(el=>{
      const key = el.dataset.criteria;
      const ok = !!map[key];
      el.classList.toggle('is-ok', ok);
      el.classList.toggle('is-ng', !ok);
    });
  }

  window.updateCampaignBannerEligibility_ = function(){
    const st = getAuthState();
    updateCriteriaUI({
      isLoggedIn: st.loggedIn,
      hasX: st.hasX,
      hasTag: isCampaignTagSelected(),
    });
  };


  // ===== キャンペーンタグ（選択タグと同期・ログイン前でも操作OK） =====
  const campTag = ()=> String(window.__activeCampaignTag || '').trim();

  const isCampaignTagSelected = ()=>{
    const tag = campTag();
    if (!tag) return false;
    try {
      const set = readSelectedTags?.(); // Set
      return !!(set && set.has && set.has(tag));
    } catch(_) { return false; }
  };

  const setCampaignTagSelected = (on)=>{
    const tag = campTag();
    if (!tag) return;

    // 1) データ更新（これが正）
    try{
      const set = readSelectedTags?.() || new Set();
      if (on) set.add(tag); else set.delete(tag);
      writeSelectedTags?.(set);
    }catch(_){}

    // 2) #select-tags 側の見た目同期（あれば）
    const wrap = document.getElementById('select-tags');
    if (wrap){
      const chip = wrap.querySelector(`.chip[data-label="${CSS.escape(tag)}"]`);
      if (chip) chip.classList.toggle('active', !!on);
    }

    // 3) バナー側タグ自体も active 同期
    if (tagBtn){
      tagBtn.classList.toggle('active', !!on);
      tagBtn.setAttribute('aria-pressed', String(!!on));
    }

    // 4) チェック更新
    try{ window.updateCampaignBannerEligibility_?.(); }catch(_){}
  };

  const refreshCampaignTagUI = ()=>{
    if (!tagRow || !tagBtn) return;
    tagRow.style.display = '';
    tagBtn.textContent = campTag() || 'キャンペーン';
    tagBtn.disabled = false;              // ★ ログイン前でも押せる
    setCampaignTagSelected(isCampaignTagSelected()); // 見た目だけ同期
  };

  if (tagRow && tagBtn){
    tagBtn.onclick = ()=>{
      const next = !isCampaignTagSelected(); // ★ auth関係なくトグル
      setCampaignTagSelected(next);
    };
    refreshCampaignTagUI();
  }


  // ★ ログイン/ログアウト/プロフィール更新のたびに再描画（既存hookに追記）
  if (!window.__campaignTagHooked) {
    window.__campaignTagHooked = true;

    const orig = window.onDeckPostAuthChanged;
    window.onDeckPostAuthChanged = function(...args){
      try { orig?.apply(this, args); } catch(_) {}
      try { refreshCampaignTagUI(); } catch(_) {}
    };
  }

  // 初回判定
  window.updateCampaignBannerEligibility_();

}

document.getElementById('auth-x')?.addEventListener('input', () => {
  window.updateCampaignBannerEligibility_?.();
});

// 投稿フォームにイベントアタッチ
function showSuccessCheck() {
  const el = document.getElementById('success-check');
  if (!el) return;

  el.style.display = 'flex';
  el.style.animation = 'popin 0.25s ease forwards';

  setTimeout(() => {
    el.style.animation = 'fadeout 0.5s ease forwards';
  }, 1800);

  setTimeout(() => {
    el.style.display = 'none';
  }, 2400);
}


// ===== キャンペーン確認モーダル =====
async function onClickPostButton() {
  const camp = await (window.fetchActiveCampaign?.() || Promise.resolve(null));

  const isActive =
    camp &&
    (camp.isActive === true || String(camp.isActive) === 'true');

  // キャンペーンが無ければ即投稿
  if (!isActive) {
    submitPost({ joinCampaign: false });
    return;
  }

  const result = checkCampaignEligibility_(camp);

  // 条件OK
  if (result.ok) {
    openCampaignConfirmModal({
      mode: 'ok',
      onJoin: () => submitPost({ joinCampaign: true }),
      onSkip: () => submitPost({ joinCampaign: false })
    });
  }
  // 条件NG
  else {
    openCampaignConfirmModal({
      mode: 'ng',
      reasons: result.reasons,
      onProceed: () => submitPost({ joinCampaign: false })
    });
  }
}

// ===== submitPost：onClickPostButton() → submitDeckPost() の橋渡し =====
function submitPost({ joinCampaign }) {
  // joinCampaign の意思決定だけ submitDeckPost に渡す
  window.__joinCampaign = !!joinCampaign;

  // submitDeckPost は form submit 経由でも direct call でもOK
  submitDeckPost(null, { joinCampaign: window.__joinCampaign });
}


// ===== キャンペーン参加条件チェック =====
function checkCampaignEligibility_(camp) {
  const reasons = [];

  // ログイン必須（バナーと同条件に揃えるなら token/verified も見る）
  const A = window.Auth;
  const loggedIn = !!(A?.user && A?.token && A?.verified);
  if (!loggedIn) reasons.push('ログインが必要です');

  // Xアカウント必須（入力欄を参照、@ありでもOK）
  const xRaw = document.getElementById('auth-x')?.value || '';
  const x = String(xRaw).trim().replace(/^@+/, '');
  if (!x) reasons.push('Xアカウントが未入力です');

  // ★ 対象タグ必須（バナーと同じ：window.__activeCampaignTag を選択しているか）
  const needTag = String(window.__activeCampaignTag || '').trim();
  let hasTag = false;
  try {
    const set = readSelectedTags?.() || new Set(); // page2.js内で使ってるやつ
    hasTag = !!(needTag && set.has(needTag));
  } catch (_) {}
  if (!hasTag) reasons.push('キャンペーンタグが未選択です');

  return { ok: reasons.length === 0, reasons };
}
window.checkCampaignEligibility_ = checkCampaignEligibility_;


// グローバルから使えるように
window.checkCampaignEligibility_ = checkCampaignEligibility_;

function openCampaignConfirmModal({ mode, reasons = [], onJoin, onSkip, onProceed }) {
  const modal = document.createElement('div');
  modal.className = 'campaign-confirm-modal';

  const body =
    mode === 'ok'
      ? `
        <h3>🎉 キャンペーン開催中！</h3>
        <p>このデッキはキャンペーン条件を満たしています。</p>
        <p>キャンペーンに参加して投稿しますか？</p>
      `
      : `
        <h3>⚠ キャンペーン開催中</h3>
        <p>以下の条件を満たしていません：</p>
        <ul>${reasons.map(r => `<li>${r}</li>`).join('')}</ul>
        <p>キャンペーンには参加できませんが、投稿は可能です。</p>
      `;

  modal.innerHTML = `
    <div class="modal-content">
      ${body}
      <div class="modal-actions">
        ${
          mode === 'ok'
            ? `
              <button class="primary">参加して投稿</button>
              <button class="ghost">参加せず投稿</button>
            `
            : `<button class="primary">投稿する</button>`
        }
        <button class="cancel">キャンセル</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const btns = modal.querySelectorAll('button');
  btns.forEach(btn => {
    btn.onclick = () => {
      modal.remove();
      if (btn.classList.contains('primary')) {
        mode === 'ok' ? onJoin?.() : onProceed?.();
      }
      if (btn.classList.contains('ghost')) onSkip?.();
    };
  });
}

// 投稿フォームの submit イベントにキャンペーン確認を挟む
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('deck-post-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onClickPostButton(); // ← キャンペーン確認→投稿 の入口
  });
});


//#endregion

/*======================================================
  13) 共通ユーティリティ
======================================================*/
//#region 12. 共通関数・ユーティリティ

// デッキバーの横スクロール位置を保持したまま描画処理を実行
function withDeckBarScrollKept(doRender){
  const scroller = document.querySelector('.deck-bar-scroll');
  const prev = scroller ? scroller.scrollLeft : 0;
  doRender?.();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { if (scroller) scroller.scrollLeft = prev; });
  });
}


//#endregion










/*
// ===== ベータ版制御 =====
document.addEventListener('DOMContentLoaded', () => {
  const postBtn = document.getElementById('post-submit');
  if (postBtn) {
    postBtn.disabled = true;
    postBtn.textContent = '投稿（ベータ中は無効）';
    postBtn.style.fontSize = '.5rem';
    postBtn.style.opacity = '0.6';
    postBtn.style.cursor = 'not-allowed';
  }

  const status = document.getElementById('post-status');
  if (status) {
    status.textContent = '※ ベータ版のため投稿送信はできません。';
    status.style.color = '#b57b00';
  }

    const previewBtn = document.getElementById('post-preview');
  if (previewBtn) {
    previewBtn.disabled = true;
    previewBtn.textContent = 'プレビュー（ベータ中は無効）';
    previewBtn.style.fontSize = '.5rem';
    previewBtn.style.opacity = '0.6';
    previewBtn.style.cursor = 'not-allowed';

    // 安全対策：クリックしても何もしない
    previewBtn.addEventListener('click', (e) => {
      e.preventDefault();
      alert('現在ベータ版のためプレビューは利用できません。');
    });
  }
});

function submitDeckPost(event){
  alert('現在ベータ版のため投稿は無効です。');
  event.preventDefault();
  return false;
}
*/
