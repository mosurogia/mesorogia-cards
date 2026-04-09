/* =========================
 * js/common/core/card-sort.js
 * - カードの並び替え共通処理
 *
 * 【役割】
 * - タイプ → コスト → パワー → cd の基準を1か所に集約
 * - 図鑑 / デッキメーカー / 投稿詳細 / 画像出力 で共通利用
 * - #grid の DOM 並び替え（window.sortCards）もここで管理
 *
 * 【公開API】
 * - window.getTypeOrder(type)
 * - window.getCardSortKeyFromCard(card)
 * - window.compareCardKeys(a, b)
 * - window.compareCards(cardA, cardB)
 * - window.sortCardEntries(entries, cardMap)
 * - window.sortCardCodes(cds, cardMap)
 * - window.sortCards()
 * ========================= */
(function () {
  'use strict';

  // =====================================================
  // 0) 基本ユーティリティ
  // =====================================================

  /**
   * cd を 5桁文字列に正規化
   */
  function normCd5_(cd) {
    return String(cd ?? '').trim().padStart(5, '0').slice(0, 5);
  }

  /**
   * タイプ順
   * - チャージャー → アタッカー → ブロッカー → その他
   */
  function getTypeOrder(type) {
    if (type === 'チャージャー') return 0;
    if (type === 'アタッカー') return 1;
    if (type === 'ブロッカー') return 2;
    return 3;
  }

  /**
   * カード1枚から比較キーを作る
   * - 基準：タイプ → コスト → パワー → cd
   */
  function getCardSortKeyFromCard(card) {
    const cd = normCd5_(card?.cd || card?.id || '');
    return {
      type: getTypeOrder(card?.type),
      cost: Number(card?.cost ?? 0) || 0,
      power: Number(card?.power ?? 0) || 0,
      cd,
    };
  }

  /**
   * 比較キー同士を比較
   */
  function compareCardKeys(a, b) {
    return (
      (a.type - b.type) ||
      (a.cost - b.cost) ||
      (a.power - b.power) ||
      a.cd.localeCompare(b.cd, 'ja')
    );
  }

  /**
   * カード同士を直接比較
   */
  function compareCards(cardA, cardB) {
    const keyA = getCardSortKeyFromCard(cardA || {});
    const keyB = getCardSortKeyFromCard(cardB || {});
    return compareCardKeys(keyA, keyB);
  }

  /**
   * entries: [ [cd, count], ... ] を並び替えた新配列で返す
   */
  function sortCardEntries(entries, cardMap = {}) {
    const arr = Array.isArray(entries) ? [...entries] : [];

    arr.sort((a, b) => {
      const cdA = normCd5_(a?.[0]);
      const cdB = normCd5_(b?.[0]);

      const cardA = cardMap?.[cdA] || { cd: cdA, type: '', cost: 0, power: 0 };
      const cardB = cardMap?.[cdB] || { cd: cdB, type: '', cost: 0, power: 0 };

      return compareCards(cardA, cardB);
    });

    return arr;
  }

  /**
   * cds: ['00001', '00002', ...] を並び替えた新配列で返す
   */
  function sortCardCodes(cds, cardMap = {}) {
    const arr = Array.isArray(cds) ? [...cds] : [];

    arr.sort((a, b) => {
      const cdA = normCd5_(a);
      const cdB = normCd5_(b);

      const cardA = cardMap?.[cdA] || { cd: cdA, type: '', cost: 0, power: 0 };
      const cardB = cardMap?.[cdB] || { cd: cdB, type: '', cost: 0, power: 0 };

      return compareCards(cardA, cardB);
    });

    return arr.map(normCd5_);
  }

  // =====================================================
  // 1) 図鑑ページ用：DOMソート
  // =====================================================

  /**
   * sort-select の値を取得
   */
  function getSortValue_() {
    const sortEl = document.getElementById('sort-select');
    return sortEl?.value || 'default';
  }

  /**
   * .card 要素からソートキーを取得
   */
  function getKeyFromCardEl_(cardEl) {
    const type = getTypeOrder(cardEl?.dataset?.type);
    const cost = parseInt(cardEl?.dataset?.cost, 10) || 0;
    const power = parseInt(cardEl?.dataset?.power, 10) || 0;
    const cd = normCd5_(cardEl?.dataset?.cd || '');

    const cat = (typeof window.getCategoryOrder === 'function')
      ? window.getCategoryOrder(cardEl?.dataset?.category)
      : 9999;

    const rarityOrder = {
      'レジェンド': 0,
      'ゴールド': 1,
      'シルバー': 2,
      'ブロンズ': 3,
    };
    const rarity = rarityOrder[cardEl?.dataset?.rarity] ?? 99;

    return { type, cost, power, cd, cat, rarity };
  }

  /**
   * 図鑑の #grid を並び替え
   */
  function sortCards() {
    const grid = document.getElementById('grid');
    if (!grid) return;

    const sortValue = getSortValue_();

    const isList =
      grid.classList.contains('is-list') ||
      !!grid.querySelector(':scope > .list-row');

    const items = isList
      ? Array.from(grid.querySelectorAll(':scope > .list-row'))
      : Array.from(grid.querySelectorAll(':scope > .card'));

    if (!items.length) return;

    items.sort((A, B) => {
      const aCard = isList ? A.querySelector('.card') : A;
      const bCard = isList ? B.querySelector('.card') : B;
      if (!aCard || !bCard) return 0;

      const a = getKeyFromCardEl_(aCard);
      const b = getKeyFromCardEl_(bCard);

      switch (sortValue) {
        case 'cost-asc':
          return a.cost - b.cost || a.type - b.type || a.power - b.power || a.cd.localeCompare(b.cd, 'ja');

        case 'cost-desc':
          return b.cost - a.cost || a.type - b.type || a.power - b.power || a.cd.localeCompare(b.cd, 'ja');

        case 'power-asc':
          return a.power - b.power || a.type - b.type || a.cost - b.cost || a.cd.localeCompare(b.cd, 'ja');

        case 'power-desc':
          return b.power - a.power || a.type - b.type || a.cost - b.cost || a.cd.localeCompare(b.cd, 'ja');

        case 'category-order':
          return a.cat - b.cat || a.type - b.type || a.cost - b.cost || a.power - b.power || a.cd.localeCompare(b.cd, 'ja');

        case 'rarity-order':
          return a.rarity - b.rarity || a.cost - b.cost || a.power - b.power || a.cd.localeCompare(b.cd, 'ja');

        default:
          return a.type - b.type || a.cost - b.cost || a.power - b.power || a.cd.localeCompare(b.cd, 'ja');
      }
    });

    // 編集開始時のみ「選択済みカードを先頭へ」
    try {
      const editingId = window.CardGroups?.getState?.().editingId || '';
      if (editingId && typeof window.CardGroups?.hasCard === 'function') {
        const picked = [];
        const rest = [];

        for (const it of items) {
          const cardEl = isList ? it.querySelector('.card') : it;
          const cd = normCd5_(cardEl?.dataset?.cd || '');
          if (!cd) {
            rest.push(it);
            continue;
          }

          if (window.CardGroups.hasCard(editingId, cd)) picked.push(it);
          else rest.push(it);
        }

        items.length = 0;
        items.push(...picked, ...rest);
      }
    } catch (e) {
      console.warn('[card-sort] group-pick partition failed', e);
    }

    for (const el of items) {
      grid.appendChild(el);
    }
  }

  // =====================================================
  // 2) 公開API
  // =====================================================

  window.getTypeOrder = window.getTypeOrder || getTypeOrder;
  window.getCardSortKeyFromCard = window.getCardSortKeyFromCard || getCardSortKeyFromCard;
  window.compareCardKeys = window.compareCardKeys || compareCardKeys;

  window.compareCards = window.compareCards || compareCards;
  window.sortCardEntries = window.sortCardEntries || sortCardEntries;
  window.sortCardCodes = window.sortCardCodes || sortCardCodes;
  window.sortCards = window.sortCards || sortCards;
})();