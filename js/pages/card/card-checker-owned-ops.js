/**
 * js/pages/card/card-checker-owned-ops.js
 * - 所持数の基本操作（クリックで増減 / 上限判定）
 * - checker-render の onclick="toggleOwnership(this)" が依存（window公開）
 *
 * 提供API（window）:
 * - maxAllowedCount(cd, raceHint?) : 上限（旧神=1, その他=3）
 * - toggleOwnership(el)           : 0→1→…→max→0
 * - bumpOwnership(el, times=1)    : +1/+3 等の一括加算
 * - clearOwnership(el)            : 0 にする
 *
 * 依存:
 * - common/owned.js（OwnedStore）
 * - checker-render で card.dataset に cd/race が入っていること
 */
(function () {
  'use strict';

  // =====================================================
  // 1) 内部ヘルパ
  // =====================================================

  function ensureStore_() {
    if (!window.OwnedStore) throw new Error('OwnedStore 未初期化');
  }

  function totalOf_(cd) {
    ensureStore_();
    const e = window.OwnedStore.get(String(cd));
    return (e?.normal | 0) + (e?.shine | 0) + (e?.premium | 0);
  }

  function setTotal_(cd, n, raceHint) {
    ensureStore_();
    const max = window.maxAllowedCount(cd, raceHint);
    const count = Math.max(0, Math.min(max, n | 0));
    window.OwnedStore.set(String(cd), { normal: count, shine: 0, premium: 0 });
  }

  // =====================================================
  // 2) 公開API：上限判定
  // =====================================================

  // 共通：カードごとの上限枚数（旧神は1、それ以外は3）
  window.maxAllowedCount = function maxAllowedCount(cd, raceHint) {
    if (raceHint === '旧神') return 1;

    let race = raceHint || '';

    // race が未指定ならキャッシュ/DOMから引く（フォールバック）
    if (!race && typeof cd !== 'undefined') {
      if (Array.isArray(window.__cardsCache)) {
        const hit = window.__cardsCache.find(c => String(c.cd) === String(cd));
        if (hit?.race) race = hit.race;
      }
      if (!race) {
        const el = document.querySelector(`#packs-root .card[data-cd="${cd}"]`);
        race = el?.dataset?.race || '';
      }
    }
    return (race === '旧神') ? 1 : 3;
  };

  // =====================================================
  // 3) 公開API：一括操作（+1/+3 / 解除）
  // =====================================================

  // 既存互換：+1 / +3 の受け皿
  window.bumpOwnership = function bumpOwnership(el, times = 1) {
    const cd = el?.dataset?.cd;
    if (!cd) return;
    const race = el?.dataset?.race || '';
    const now = totalOf_(cd);
    setTotal_(cd, now + (times | 0), race);
  };

  window.clearOwnership = function clearOwnership(el) {
    const cd = el?.dataset?.cd;
    if (!cd) return;
    const race = el?.dataset?.race || '';
    setTotal_(cd, 0, race);
  };

  // =====================================================
  // 4) 公開API：カード単体クリック
  // =====================================================

  // カード単体クリック時の挙動：0→1→2→3→0（旧神は 0→1→0）
  window.toggleOwnership = function toggleOwnership(el) {
    try {
      if (!el?.dataset) return;
      const cd = String(el.dataset.cd || '');
      if (!cd || !window.OwnedStore) return;

      const race = el.dataset.race || '';
      const max = window.maxAllowedCount(cd, race);

      const now = totalOf_(cd);
      const next = (now >= max) ? 0 : (now + 1);

      window.OwnedStore.set(cd, { normal: next, shine: 0, premium: 0 });
    } catch (err) {
      console.error('toggleOwnership failed:', err);
    }
  };
})();
