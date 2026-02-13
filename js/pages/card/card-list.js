/**
 * card-list.js / Card List (図鑑) ページ制御
 * - cards_latest.json を読み込み、#grid にカード一覧を描画
 * - 詳細テンプレ（#detail-xxxxx）は #detail-bank に退避して初期描画を軽量化
 * - 表示切替（グリッド ⇔ リスト）は cardsViewMode.js が担当
 * - OwnedUI / CardDetailUI と連携（所持マーク同期・詳細内の所持編集UI）
 *
 * 依存：
 * - defs.js（定数/ユーティリティ）
 * - card-core.js（カード生成/ソート/カードデータ取得）
 * - owned.js（OwnedStore / OwnedUI）
 * - ui/card-detail-template.js（window.generateDetailHtml or window.CardDetailTemplate.generate）
 */

/*==================================================
  1. 初期設定
==================================================*/
//#region 1. 初期設定

let __cardListInited = false;

function initCardListPage_(){
  if (__cardListInited) return;
  __cardListInited = true;

  try { loadCards(); } catch (e) { console.warn('[card-list] loadCards failed', e); }
  try { window.OwnedUI?.bind?.("#grid"); } catch (e) { console.warn('[card-list] OwnedUI.bind(#grid) failed', e); }

  const sortEl = document.getElementById('sort-select');
  if (sortEl && !sortEl.dataset.bound) {
    sortEl.dataset.bound = '1';
    sortEl.addEventListener('change', () => {
      try { window.sortCards?.(); } catch (e) { console.warn('[card-list] sortCards failed', e); }
      try { window.applyFilters?.(); } catch (e) { console.warn('[card-list] applyFilters failed', e); }
      try { window.syncListRowVisibility_?.(); } catch {}
    });
  }

  setTimeout(() => { try { window.__bindLongPressForCards?.('list'); } catch {} }, 0);
}

// loader経由でも確実に動くように両対応
window.addEventListener('DOMContentLoaded', initCardListPage_);
window.addEventListener('card-page:ready', initCardListPage_);


//#endregion


/*==================================================
  2. 詳細テンプレ生成（委譲）
==================================================*/
//#region 2. 詳細テンプレ生成（委譲）

// ✅ 詳細テンプレは ui/card-detail-template.js を唯一の正にする
//  - 図鑑 / 所持率：card-detail-template.js が window.generateDetailHtml を公開している前提
//  - もし読み込み順ミスで未定義なら、ここで即わかるように警告を出す
const generateDetailHtml = function (card) {
  if (typeof window.generateDetailHtml === 'function') {
    return window.generateDetailHtml(card);
  }
  console.warn('[card-list] window.generateDetailHtml が未定義です。card-detail-template.js の読み込み順を確認してください。');

  // 最低限の保険（※基本はここに来ないのが正）
  const cd = String(card.cd ?? '').padStart(5, '0');
  const typeClass = card.type ? `type-${card.type}` : '';
  const raceClass = card.race ? `race-${card.race}` : '';
  return `
    <div class="card-detail ${typeClass} ${raceClass}" id="detail-${cd}" data-cd="${cd}" style="display:none;">
      <div class="card-name">${card.name || ''}</div>
      <div class="card-meta card-pack">${card.pack_name || ''}</div>
      <div class="card-meta">
        <span class="card-race">${card.race || ''}</span> /
        <span class="card-category">${card.category || ''}</span>
      </div>
      <div class="card-effect"></div>
    </div>
  `.trim();
};

//#endregion


/*==================================================
  3. detail-bank（詳細テンプレ退避）
==================================================*/
//#region 3. detail-bank（詳細テンプレ退避）

function getOrCreateDetailBank_() {
  let bank = document.getElementById('detail-bank');
  if (!bank) {
    bank = document.createElement('div');
    bank.id = 'detail-bank';
    bank.style.display = 'none';
    document.body.appendChild(bank);
  }
  return bank;
}

//#endregion


/*==================================================
  4. カード読み込み＆描画
==================================================*/
//#region 4. カード読み込み＆描画

async function loadCards() {
  const cards = await fetchLatestCards();

  const grid = document.getElementById('grid');
  if (!grid) return;

  // 既存DOMクリア
  grid.innerHTML = '';

  // detailは grid に積まず bank に退避（初期表示を軽くする）
  const bank = getOrCreateDetailBank_();
  bank.innerHTML = '';

  const fragCards = document.createDocumentFragment();
  const fragDetails = document.createDocumentFragment();

  for (const card of cards) {
    // 一覧用カード生成（画像がここ）
    const cardElement = generateCardListElement(card);
    fragCards.appendChild(cardElement);

    // detail は bank へ（グリッドに入れない）
    const html =
      window.CardDetailTemplate?.generate
        ? window.CardDetailTemplate.generate(card)
        : (typeof window.generateDetailHtml === 'function' ? window.generateDetailHtml(card) : '');
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    const detailEl = tmp.firstElementChild;
    if (detailEl) {
      detailEl.style.display = 'none'; // テンプレとして隠す
      fragDetails.appendChild(detailEl);
    }

    // map登録（card-core側の allCardsMap を想定）
    allCardsMap[card.cd] = card;
  }

  grid.appendChild(fragCards);
  bank.appendChild(fragDetails); // 先に積む（リスト切替事故を防ぐ）

  requestAnimationFrame(() => {
    try { sortCards(); } catch {}
    try { window.rebuildCardMap?.(); } catch {}
    try { window.onCardsLoaded?.(); } catch {}
    try { window.applyCardsViewMode?.('grid'); } catch {}
    try { window.OwnedUI?.bind?.("#grid"); } catch {}
  });
}

//#endregion
