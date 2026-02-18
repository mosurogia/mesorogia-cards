/**
 * common/card-core.js
 * - cards_latest / packs / 検索index など「カードデータ基盤」
 *
 * 役割（このファイルに置くもの）
 * - JSON取得の共通ヘルパ（複数候補URL対応）
 * - cards_latest の取得（latest抽出）＋ cardMap 構築
 * - packs カタログ読み込み（packs.json → フォールバック）
 * - pack 名分解 / slug 生成 / 略称キー判定
 * - （暫定）カードソート（将来は features に分離推奨）
 */
(function () {
  'use strict';

  // =====================================================
  // 0) グローバル基盤（互換のため window に保持）
  // =====================================================

  // カードマスタ全体（cd → card オブジェクト）※現状未使用でも互換維持
  window.allCardsMap = window.allCardsMap || {};

  // デッキ情報 / カード情報を保持するオブジェクト（互換維持）
  window.deck = window.deck || {};
  window.cardMap = window.cardMap || {};

  // ---- 参照URL（ページごとにズレても拾えるように候補を持つ）----
  window.CARDS_JSON_CANDIDATES = window.CARDS_JSON_CANDIDATES || [
    'public/cards_latest.json',
    './public/cards_latest.json',
    'cards_latest.json',
    './cards_latest.json',
  ];

  window.PACKS_JSON_CANDIDATES = window.PACKS_JSON_CANDIDATES || [
    'public/packs.json',
    './public/packs.json',
    'packs.json',
    './packs.json',
  ];


  // =====================================================
  // 1) JSON取得：最初に成功したものを返す（404/HTML混入も弾く）
  //  - 重要: Promiseキャッシュの前提として「ここはキャッシュ許可」で取る
  // =====================================================

  async function fetchJsonFirstOk_(urls) {
    let lastErr = null;

    for (const url of (urls || [])) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;

        // content-type がJSONっぽいなら json() 優先（速い）
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) {
          return await res.json();
        }

        // 怪しい場合だけ text → 判定 → parse
        const text = await res.text();
        if (/^\s*</.test(text)) continue; // HTML混入
        return JSON.parse(text);
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error('JSON not found');
  }

  // =====================================================
  // 2) cards_latest.json：latest抽出（Promiseキャッシュ）
  // =====================================================

  let __latestCardsPromise = null;

  async function fetchLatestCards() {
    if (__latestCardsPromise) return __latestCardsPromise;

    __latestCardsPromise = (async () => {
      const allCards = await fetchJsonFirstOk_(window.CARDS_JSON_CANDIDATES);
      if (!Array.isArray(allCards)) return [];
      // is_latest だけ抽出
      return allCards.filter(card => card && card.is_latest === true);
    })();

    return __latestCardsPromise;
  }

  // グローバル公開
  window.fetchLatestCards = window.fetchLatestCards || fetchLatestCards;

// =====================================================
// 3) cardMap 構築 & ensureCardMapLoaded（互換）
// =====================================================

// cards -> window.cardMap を構築
function buildCardMapFromCards(cards){
  if (!Array.isArray(cards)) return;

  for (const card of cards){
    const cdRaw = card.cd ?? card.id ?? '';
    const cd5   = String(cdRaw || '').trim().padStart(5, '0');
    if (!cd5) continue;

    window.cardMap[cd5] = {
      cd     : cd5,
      name   : card.name   || '',
      race   : card.race   || '',
      type   : card.type   || '',
      cost   : Number(card.cost  ?? 0) || 0,
      power  : Number(card.power ?? 0) || 0,
      rarity : card.rarity || '',
      packName : card.packName ?? card.pack_name ?? '',
      pack_name: card.pack_name ?? '',          // 互換（古い側が見ることがある）
      category : card.category  || '',
      effect_name1: card.effect_name1 || '',
      effect_text1: card.effect_text1 || '',
      effect_name2: card.effect_name2 || '',
      effect_text2: card.effect_text2 || '',
      field: card.field ?? '',
      //ability: card.ability ?? '', --- IGNORE ---
      special_ability: (() => {
        const raw = (card.special_ability ?? '').trim();
        if (raw) return raw;

        const ab = [];
        if (card.ability_burn) ab.push('燃焼');
        if (card.ability_bind) ab.push('拘束');
        if (card.ability_silence) ab.push('沈黙');

        return ab.length ? ab.join(' ') : '';
      })(),
      // --- flags（bool想定。JSONが0/1でもJS側は truthy/falseyで吸える） ---
      BP_flag: !!card.BP_flag,
      draw: !!card.draw,
      graveyard_recovery: !!card.graveyard_recovery,
      cardsearch: !!card.cardsearch,
      power_up: !!card.power_up,
      power_down: !!card.power_down,
      link: !!card.link,
      link_cd: card.link_cd ?? '',

      // --- 新列（enum/ability） ---
      destroy_target: (card.destroy_target ?? '').trim(),
      life_effect: (card.life_effect ?? '').trim(),
      power_effect: (card.power_effect ?? '').trim(),
      mana_effect: (card.mana_effect ?? '').trim(),

      ability_burn: !!card.ability_burn,
      ability_bind: !!card.ability_bind,
      ability_silence: !!card.ability_silence,

      heal2: !!card.heal2,

      // --- 旧互換（既存フィルターや表示が壊れないように推定） ---
      // destroy_target: OPPONENT / SELF / ALL / ''（想定）
      destroy_opponent:
        !!card.destroy_opponent || ['OPPONENT', 'ALL'].includes(String(card.destroy_target || '').trim()),
      destroy_self:
        !!card.destroy_self || ['SELF', 'ALL'].includes(String(card.destroy_target || '').trim()),

      // life_effect: HEAL / OPPO_DAMAGE / SELF_DAMAGE / BOTH_DAMAGE / ''（想定）
      heal:
        !!card.heal || !!card.heal2 || String(card.life_effect || '').trim() === 'HEAL',

    };
  }
}

// 一度だけカードマスタを読み込んで cardMap を埋める（互換API）
async function ensureCardMapLoaded(){
  if (window.cardMap && Object.keys(window.cardMap).length > 0){
    return window.cardMap;
  }

  try{
    const cards = await window.fetchLatestCards(); // card-core の関数を使う
    buildCardMapFromCards(cards);
  }catch(e){
    console.error('[card-core] ensureCardMapLoaded: カードマスタ読み込み失敗', e);
    throw e;
  }
  return window.cardMap;
}

// グローバル公開（重要）
window.ensureCardMapLoaded = window.ensureCardMapLoaded || ensureCardMapLoaded;
window.buildCardMapFromCards = window.buildCardMapFromCards || buildCardMapFromCards;

  // =====================================================
  // 4) packs.json：カタログ（Promiseキャッシュ）
  // =====================================================

  let __packCatalogPromise = null;

  async function loadPackCatalog() {
    if (window.__PackCatalog) return window.__PackCatalog;
    if (__packCatalogPromise) return __packCatalogPromise;

    __packCatalogPromise = (async () => {
      try {
        const raw = await fetchJsonFirstOk_(window.PACKS_JSON_CANDIDATES);

        const arr = Array.isArray(raw?.packs) ? raw.packs
                  : Array.isArray(raw?.list) ? raw.list
                  : [];

        const order = Array.isArray(raw?.order) ? raw.order : null;

        const list = arr.map(p => {
          const enRaw = String(p?.en ?? '').trim();
          const jpRaw = String(p?.jp ?? '').trim();

          const en = enRaw || (jpRaw ? jpRaw.replace(/[「」]/g, '') : '');
          const jp = jpRaw || '';

          const slug = p?.slug || makePackSlug(en);
          const key = p?.key || slug;

          return {
            key,
            en,
            jp,
            slug,
            labelTwoLine: `${en}${jp ? `\n${jp}` : ''}`,
          };
        });

        const byEn = new Map(list.map(x => [x.en, x]));
        const ord = (order && order.length) ? order : list.map(x => x.en);

        window.__PackCatalog = { list, byEn, order: ord };
        return window.__PackCatalog;

      } catch (e) {
        console.warn('[card-core] packs.json 読み込み失敗 → cards_latest.json から検出にフォールバック', e);

        const cards = await window.fetchLatestCards();
        const byEn = new Map();

        cards.forEach(c => {
          const { en, jp } = splitPackName(c.pack_name || '');
          if (en && !byEn.has(en)) byEn.set(en, { en, jp, slug: makePackSlug(en) });
        });

        const list = [...byEn.values()].sort((a, b) => a.en.localeCompare(b.en, 'ja'));
        list.forEach(x => {
          x.key = x.slug;
          x.labelTwoLine = `${x.en}${x.jp ? `\n${x.jp}` : ''}`;
        });

        window.__PackCatalog = {
          list,
          byEn: new Map(list.map(x => [x.en, x])),
          order: list.map(x => x.en),
        };
        return window.__PackCatalog;
      }
    })();

    return __packCatalogPromise;
  }

  window.loadPackCatalog = window.loadPackCatalog || loadPackCatalog;


  // =====================================================
  // 5) パック略称キー（A〜Z / SPECIAL / COLLAB / ''）
  // =====================================================

  window.packKeyFromAbbr = window.packKeyFromAbbr || function packKeyFromAbbr(abbr) {
    // 「」や空白を除去してから判定
    const s = String(abbr || '').replace(/[「」\s]/g, '');

    if (/^([A-Z])パック/.test(s)) return s[0]; // A〜Z
    if (s.includes('コラボ')) return 'COLLAB';
    if (s.includes('特殊')) return 'SPECIAL';
    return '';
  };

  // =====================================================
  // 6) カードソート（grid/list 両対応）
  // ※将来は js/features/ に分離推奨（今は互換のためここに残す）
  // =====================================================

// =====================================================
// 6.x) 共通：カードの並びキー（type→cost→power→cd）
// =====================================================
window.getTypeOrder = window.getTypeOrder || function getTypeOrder(type) {
  if (type === 'チャージャー') return 0;
  if (type === 'アタッカー') return 1;
  if (type === 'ブロッカー') return 2;
  return 3;
};

window.getCardSortKeyFromCard = window.getCardSortKeyFromCard || function getCardSortKeyFromCard(card) {
  const cd = String(card?.cd || card?.id || '').padStart(5, '0');
  return {
    type: window.getTypeOrder(card?.type),
    cost: Number(card?.cost ?? 0) || 0,
    power: Number(card?.power ?? 0) || 0,
    cd,
  };
};

window.compareCardKeys = window.compareCardKeys || function compareCardKeys(a, b) {
  return (
    (a.type - b.type) ||
    (a.cost - b.cost) ||
    (a.power - b.power) ||
    a.cd.localeCompare(b.cd)
  );
};


  (function installSortCards_() {
    if (window.sortCards) return;

    function getSortValue_() {
      const sortEl = document.getElementById('sort-select');
      return sortEl?.value || 'default';
    }

    function getKeyFromCardEl_(cardEl) {
      const type = window.getTypeOrder(cardEl.dataset.type);
      const cost = parseInt(cardEl.dataset.cost, 10) || 0;
      const power = parseInt(cardEl.dataset.power, 10) || 0;
      const cd = String(cardEl.dataset.cd || '').padStart(5, '0');

      const cat = (typeof window.getCategoryOrder === 'function')
        ? window.getCategoryOrder(cardEl.dataset.category)
        : 9999;

      const rarityOrder = { 'レジェンド': 0, 'ゴールド': 1, 'シルバー': 2, 'ブロンズ': 3 };
      const rarity = rarityOrder[cardEl.dataset.rarity] ?? 99;

      return { type, cost, power, cd, cat, rarity };
    }

    window.sortCards = function sortCards() {
      const grid = document.getElementById('grid');
      if (!grid) return;

      const sortValue = getSortValue_();

      // list表示かどうか（#grid 直下が .list-row になる）
      const isList = grid.classList.contains('is-list') || !!grid.querySelector(':scope > .list-row');

      // 並び替え対象：grid=.card / list=.list-row
      const items = isList
        ? Array.from(grid.querySelectorAll(':scope > .list-row'))
        : Array.from(grid.querySelectorAll(':scope > .card'));

      if (!items.length) return;

      // ① 既存ソート（今の仕様そのまま）
      items.sort((A, B) => {
        const aCard = isList ? A.querySelector('.card') : A;
        const bCard = isList ? B.querySelector('.card') : B;
        if (!aCard || !bCard) return 0;

        const a = getKeyFromCardEl_(aCard);
        const b = getKeyFromCardEl_(bCard);

        switch (sortValue) {
          case 'cost-asc':
            return a.cost - b.cost || a.type - b.type || a.power - b.power || a.cd.localeCompare(b.cd);
          case 'cost-desc':
            return b.cost - a.cost || a.type - b.type || a.power - b.power || a.cd.localeCompare(b.cd);
          case 'power-asc':
            return a.power - b.power || a.type - b.type || a.cost - b.cost || a.cd.localeCompare(b.cd);
          case 'power-desc':
            return b.power - a.power || a.type - b.type || a.cost - b.cost || a.cd.localeCompare(b.cd);
          case 'category-order':
            return a.cat - b.cat || a.type - b.type || a.cost - b.cost || a.power - b.power || a.cd.localeCompare(b.cd);
          case 'rarity-order':
            return a.rarity - b.rarity || a.cost - b.cost || a.power - b.power || a.cd.localeCompare(b.cd);
          default:
            return a.type - b.type || a.cost - b.cost || a.power - b.power || a.cd.localeCompare(b.cd);
        }
      });

      // ② 編集開始時だけ「選択済みを先頭へ」（sort結果は壊さない＝安定分割）
      try {
        const editingId = window.CardGroups?.getState?.().editingId || '';
        if (editingId && typeof window.CardGroups?.hasCard === 'function') {
          const picked = [];
          const rest = [];

          for (const it of items) {
            const cardEl = isList ? it.querySelector('.card') : it;
            const cd = String(cardEl?.dataset?.cd || '').padStart(5, '0');
            if (!cd) { rest.push(it); continue; }

            if (window.CardGroups.hasCard(editingId, cd)) picked.push(it);
            else rest.push(it);
          }

          items.length = 0;
          items.push(...picked, ...rest);
        }
      } catch (e) {
        console.warn('[sortCards] group-pick partition failed', e);
      }

      // ③ DOM反映
      for (const el of items) grid.appendChild(el);
    };

  })();

})();
