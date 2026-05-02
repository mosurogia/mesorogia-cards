/**
 * js/common/filter/keyword-filter.js
 * - キーワードフィルターの共通処理
 *
 * 【役割】
 * - キーワード入力値の取得
 * - スペース区切りAND検索トークン化
 * - カード要素から検索用文字列を生成
 * - キーワード一致判定
 * - フィルターチップ用データ生成
 *
 * 【公開API】
 * - window.getKeywordTokens(inputOrId)
 * - window.getKeywordValue(inputOrId)
 * - window.hasKeywordValue(inputOrId)
 * - window.clearKeywordInput(inputOrId)
 * - window.buildKeywordHaystack(cardEl)
 * - window.matchesKeywordTokens(haystack, tokens)
 * - window.createKeywordFilterChip(options)
 * - window.normalizeJapaneseKeyword(value)
 *
 * ※ 旧互換として window.KeywordFilter も残す
 */
(function () {
  'use strict';

  // =========================
  // 1) 内部ヘルパ
  // =========================

  /**
   * 入力欄の値を取得
   */
  function getInputValue_(inputOrId = 'keyword') {
    if (typeof inputOrId === 'string') {
      return String(document.getElementById(inputOrId)?.value || '');
    }

    if (inputOrId && typeof inputOrId.value === 'string') {
      return String(inputOrId.value || '');
    }

    return '';
  }

  /**
   * ひらがな → カタカナ
   */
  function hiraToKata_(value = '') {
    return String(value || '').replace(/[\u3041-\u3096]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) + 0x60)
    );
  }

  /**
   * 日本語検索向け正規化
   * - NFKC
   * - 小文字化
   * - ひらがな→カタカナ
   * - 記号/空白の揺れをある程度吸収
   */
  function normalizeJapaneseKeyword(value = '') {
    return hiraToKata_(String(value || ''))
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[‐-‒–—―ーｰ\-]/g, 'ー')
      .replace(/[・･]/g, '')
      .replace(/[　\s]+/g, ' ')
      .trim();
  }

  /**
   * スペース区切りAND検索用トークン配列
   */
  function tokenize_(value = '') {
    return normalizeJapaneseKeyword(value).split(/\s+/).filter(Boolean);
  }

  /**
   * 検索対象文字列を構築
   * 優先:
   * 1) data-search-text
   * 2) data-keywords
   * 3) 各datasetの連結
   */
  function buildHaystackFromCardEl_(cardEl) {
    const ds = cardEl?.dataset || {};

    const searchText = normalizeJapaneseKeyword(ds.searchText || '');
    if (searchText) return searchText;

    const keywords = normalizeJapaneseKeyword(ds.keywords || '');
    if (keywords) return keywords;

    return normalizeJapaneseKeyword([
      ds.name,
      ds.nameKana,
      ds.keywords,
      ds.aliases,
      ds.effect,
      ds.field,
      ds.ability,
      ds.category,
      ds.race,
      ds.type,
      ds.rarity,
      ds.pack,
      ds.cv,
      ds.cvKana,
      ds.voice,
      ds.voiceKana,
    ].filter(Boolean).join(' '));
  }

  /**
   * トークンAND一致
   */
    function matchesTokens_(haystack, tokens) {
    if (!Array.isArray(tokens) || !tokens.length) return true;

    const hs = normalizeJapaneseKeyword(haystack);
    return tokens.every(token => hs.includes(token)); // ←ここ
    }

  /**
   * 現在の検索文字列
   */
  function getKeywordValue(inputOrId = 'keyword') {
    return String(getInputValue_(inputOrId) || '').trim();
  }

  /**
   * tokens取得
   */
  function getKeywordTokens(inputOrId = 'keyword') {
    return tokenize_(getInputValue_(inputOrId));
  }

  /**
   * 入力あり判定
   */
  function hasKeywordValue(inputOrId = 'keyword') {
    return getKeywordValue(inputOrId).length > 0;
  }

  /**
   * クリア
   */
  function clearKeywordInput(inputOrId = 'keyword') {
    if (typeof inputOrId === 'string') {
      const el = document.getElementById(inputOrId);
      if (el) el.value = '';
      return;
    }

    if (inputOrId && 'value' in inputOrId) {
      inputOrId.value = '';
    }
  }

  /**
   * チップ生成
   */
  function createKeywordFilterChip(options = {}) {
    const {
      inputId = 'keyword',
      labelPrefix = '検索:',
      className = 'chip-keyword',
      onRemove = null,
    } = options || {};

    const keyword = getKeywordValue(inputId);
    if (!keyword) return null;

    return {
      label: `${labelPrefix}${keyword}`,
      className,
      onRemove: () => {
        clearKeywordInput(inputId);
        if (typeof onRemove === 'function') onRemove();
      },
    };
  }

  // =========================
  // 2) 中立公開API
  // =========================

  window.normalizeJapaneseKeyword = window.normalizeJapaneseKeyword || normalizeJapaneseKeyword;
  window.getKeywordTokens = window.getKeywordTokens || getKeywordTokens;
  window.getKeywordValue = window.getKeywordValue || getKeywordValue;
  window.hasKeywordValue = window.hasKeywordValue || hasKeywordValue;
  window.clearKeywordInput = window.clearKeywordInput || clearKeywordInput;
  window.buildKeywordHaystack = window.buildKeywordHaystack || buildHaystackFromCardEl_;
  window.matchesKeywordTokens = window.matchesKeywordTokens || matchesTokens_;
  window.createKeywordFilterChip = window.createKeywordFilterChip || createKeywordFilterChip;

  // =========================
  // 3) 旧互換API
  // =========================

  window.KeywordFilter = window.KeywordFilter || {};
  Object.assign(window.KeywordFilter, {
    normalizeKeyword: normalizeJapaneseKeyword,
    tokenize: tokenize_,
    tokensFromInput: getKeywordTokens,
    keywordFromInput: getKeywordValue,
    hasKeyword: hasKeywordValue,
    clearInput: clearKeywordInput,
    buildHaystackFromCardEl: buildHaystackFromCardEl_,
    matchesTokens: matchesTokens_,
    createKeywordChip: createKeywordFilterChip,
  });
})();