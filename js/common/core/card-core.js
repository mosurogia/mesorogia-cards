/**
 * js/common/core/card-core.js
 * - cards_latest / packs / 検索index など「カードデータ基盤」
 *
 * 役割（このファイルに置くもの）
 * - JSON取得の共通ヘルパ（固定URL想定）
 * - cards_latest の取得（latest抽出）＋ cardMap 構築
 * - packs カタログ読み込み（packs.json → フォールバック）
 * - pack 名分解 / slug 生成 / 略称キー判定
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

  // ---- 参照URL（固定）
  // ※ もう候補を出さない前提ならここで確定させる
  window.CARDS_JSON_URL = window.CARDS_JSON_URL || './public/cards_latest.json';
  window.PACKS_JSON_URL = window.PACKS_JSON_URL || './public/packs.json';


  // =====================================================
  // 0.5) pack_name 文字列の分解（EN/JP抽出）＆ slug
  //  - 例: "Awaking The Oracle「目覚めし神託」" -> {en:"Awaking The Oracle", jp:"目覚めし神託"}
  //  - 例: "Beyond the Sanctuary／聖域の先へ"   -> {en:"Beyond the Sanctuary", jp:"聖域の先へ"}
  //  - 例: "Drawn Sword" -> {en:"Drawn Sword", jp:""}
  // =====================================================

  // 既にどこかで定義済みなら尊重（互換維持）
  window.splitPackName = window.splitPackName || function splitPackName(raw) {
    const s = String(raw || '').trim();
    if (!s) return { en: '', jp: '' };

    // 1) EN「JP」
    {
      const m = s.match(/^([^「]+)(?:「([^」]*)」)?/);
      const en = (m?.[1] || '').trim();
      const jp = (m?.[2] || '').trim();
      if (en || jp) return { en, jp };
    }

    // 2) EN／JP
    {
      const slash = s.indexOf('／');
      if (slash >= 0) {
        return {
          en: s.slice(0, slash).trim(),
          jp: s.slice(slash + 1).trim(),
        };
      }
    }

    // 3) EN単体（または雑多な文字列）
    return { en: s, jp: '' };
  };

  // page2互換：EN名だけ欲しい（空なら fallback を返す）
  window.getPackEnName = window.getPackEnName || function getPackEnName(raw, fallback = 'その他カード') {
    const { en } = window.splitPackName(raw);
    return en || String(fallback ?? '');
  };

  // packs.json の slug 生成（未定義ならここで提供）
  window.makePackSlug = window.makePackSlug || function makePackSlug(en) {
    const s = String(en || '').trim().toLowerCase();
    if (!s) return '';
    // 英数とスペース中心を想定：スペース→-、それ以外は除去寄り
    return s
      .replace(/&/g, 'and')
      .replace(/['"]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };

  // =====================================================
  // 1) JSON取得：固定URLのJSONを取る（404/HTML混入も弾く）
  //  - 重要: Promiseキャッシュの前提として「ここはキャッシュ許可」で取る
  // =====================================================

  async function fetchJsonStrict_(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);

    // content-type がJSONっぽいなら json() 優先（速い）
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      return await res.json();
    }

    // 怪しい場合だけ text → 判定 → parse
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error('HTML mixed in response');
    return JSON.parse(text);
  }

  // =====================================================
  // 2) cards_latest.json：latest抽出（Promiseキャッシュ）
  // =====================================================

  let __latestCardsPromise = null;

  async function fetchLatestCards() {
    if (__latestCardsPromise) return __latestCardsPromise;

    __latestCardsPromise = (async () => {
      const allCards = await fetchJsonStrict_(window.CARDS_JSON_URL);
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
  function buildCardMapFromCards(cards) {
    if (!Array.isArray(cards)) return;

    for (const card of cards) {
      const cdRaw = card.cd ?? card.id ?? '';
      const cd5 = String(cdRaw || '').trim().padStart(5, '0');
      if (!cd5) continue;

      window.cardMap[cd5] = {
        cd: cd5,
        name: card.name || '',
        race: card.race || '',
        type: card.type || '',
        cost: Number(card.cost ?? 0) || 0,
        power: Number(card.power ?? 0) || 0,
        rarity: card.rarity || '',
        packName: card.packName ?? card.pack_name ?? '',
        pack_name: card.pack_name ?? '', // 互換（古い側が見ることがある）
        category: card.category || '',
        effect_name1: card.effect_name1 || '',
        effect_text1: card.effect_text1 || '',
        effect_name2: card.effect_name2 || '',
        effect_text2: card.effect_text2 || '',
        field: card.field ?? '',
        // ability: card.ability ?? '', --- IGNORE ---
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
          !!card.destroy_opponent ||
          ['OPPONENT', 'ALL'].includes(String(card.destroy_target || '').trim()),
        destroy_self:
          !!card.destroy_self ||
          ['SELF', 'ALL'].includes(String(card.destroy_target || '').trim()),

        // life_effect: HEAL / OPPO_DAMAGE / SELF_DAMAGE / BOTH_DAMAGE / ''（想定）
        heal:
          !!card.heal ||
          !!card.heal2 ||
          String(card.life_effect || '').trim() === 'HEAL',
      };
    }
  }

  // 一度だけカードマスタを読み込んで cardMap を埋める（互換API）
  async function ensureCardMapLoaded() {
    if (window.cardMap && Object.keys(window.cardMap).length > 0) {
      return window.cardMap;
    }

    try {
      const cards = await window.fetchLatestCards(); // card-core の関数を使う
      buildCardMapFromCards(cards);
    } catch (e) {
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
        const raw = await fetchJsonStrict_(window.PACKS_JSON_URL);

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
  // 6) カードソート
  // - 並び替え本体は js/common/core/card-sort.js へ分離
  // =====================================================

  // =====================================================
  // 7) packs.json フォールバック用（ここで使う前提の関数）
  // ※ splitPackName / makePackSlug が別ファイルなら、そのままでOK
  // =====================================================
  // このファイル内で未定義のままでも、既存コードと同様に
  // グローバルに存在する前提で動かす設計（互換維持）
  // - splitPackName(pack_name) -> {en,jp}
  // - makePackSlug(en) -> slug
})();
