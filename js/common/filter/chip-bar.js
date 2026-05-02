/**
 * js/common/filter/chip-bar.js
 * - フィルター用チップバーの共通描画
 *
 * 【役割】
 * - #active-chips-bar の取得 / 不足ノード補完
 * - chips-scroll の中身描画
 * - chips-left / chips-count の補完
 * - 個別チップ / 全解除チップの生成
 *
 * 【使い方】
 * window.FilterChipBar.render({
 *   rootId: 'active-chips-bar',
 *   countText: '12枚表示',
 *   show: true,
 *   showLeft: true,
 *   chips: [
 *     { label: '検索:ドラゴン', className: 'chip-keyword', onRemove: () => {} },
 *   ],
 *   clearLabel: 'すべて解除',
 *   onClearAll: () => {},
 * });
 */
(function () {
  'use strict';

  // =========================
  // 1) 内部ヘルパ
  // =========================

  /**
   * チップバー本体を取得
   */
  function getBar_(rootId = 'active-chips-bar') {
    return document.getElementById(rootId);
  }

  /**
   * chips-scroll を保証
   */
  function ensureScroll_(bar) {
    if (!bar) return null;

    let scroll = bar.querySelector('.chips-scroll');
    if (!scroll) {
      scroll = document.createElement('div');
      scroll.className = 'chips-scroll';
      bar.appendChild(scroll);
    }
    return scroll;
  }

  /**
   * chips-left / chips-count を保証
   */
  function ensureLeft_(bar) {
    if (!bar) return { left: null, count: null };

    let left = bar.querySelector('.chips-left');
    if (!left) {
      left = document.createElement('div');
      left.className = 'chips-left';

      const scroll = ensureScroll_(bar);
      if (scroll) bar.insertBefore(left, scroll);
      else bar.appendChild(left);
    }

    let count = left.querySelector('.chips-count');
    if (!count) {
      count = document.createElement('span');
      count.className = 'chips-count';
      count.textContent = '0';
      left.appendChild(count);
    }

    return { left, count };
  }

  /**
   * チップ1個生成
   */
  function createChip_(label, onRemove, className = '') {
    const chip = document.createElement('span');
    chip.className = ['chip-mini', className].filter(Boolean).join(' ');
    chip.textContent = String(label || '');

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    x.textContent = '×';
    x.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onRemove === 'function') onRemove();
    });

    chip.appendChild(x);
    return chip;
  }

  /**
   * 全解除チップ生成
   */
  function createClearChip_(label, onClick) {
    const chip = document.createElement('span');
    chip.className = 'chip-mini chip-clear';
    chip.textContent = String(label || 'すべて解除');

    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onClick === 'function') onClick();
    });

    return chip;
  }

  /**
   * スクロール領域クリア
   */
  function clear_(bar) {
    const scroll = ensureScroll_(bar);
    if (scroll) scroll.replaceChildren();
  }

  // =========================
  // 2) 公開API
  // =========================

  /**
   * 最低限のDOMを保証
   */
  function ensure(rootId = 'active-chips-bar') {
    const bar = getBar_(rootId);
    if (!bar) return null;

    ensureScroll_(bar);
    ensureLeft_(bar);

    return bar;
  }

  /**
   * count 表示だけ更新
   */
  function setCount(rootId = 'active-chips-bar', text = '') {
    const bar = ensure(rootId);
    if (!bar) return;

    const { count } = ensureLeft_(bar);
    if (count) count.textContent = String(text || '');
  }

  /**
   * 描画本体
   */
  function render(options = {}) {
    const {
      rootId = 'active-chips-bar',
      countText = '',
      show = true,
      showLeft = false,
      chips = [],
      clearLabel = 'すべて解除',
      onClearAll = null,
    } = options || {};

    const bar = ensure(rootId);
    if (!bar) return;

    const scroll = ensureScroll_(bar);
    const { left, count } = ensureLeft_(bar);
    if (!scroll) return;

    scroll.replaceChildren();

    if (count) count.textContent = String(countText || '');
    if (left) left.style.display = showLeft ? '' : 'none';

    chips.forEach((item) => {
      if (!item || !item.label) return;
      const chip = createChip_(item.label, item.onRemove, item.className || '');
      scroll.appendChild(chip);
    });

    if (chips.length && typeof onClearAll === 'function') {
      scroll.appendChild(createClearChip_(clearLabel, onClearAll));
    }

    bar.style.display = show ? '' : 'none';
  }

  /**
   * バー非表示
   */
  function hide(rootId = 'active-chips-bar') {
    const bar = getBar_(rootId);
    if (!bar) return;
    bar.style.display = 'none';
  }

  /**
   * スクロール中身だけ消す
   */
  function clear(rootId = 'active-chips-bar') {
    const bar = getBar_(rootId);
    if (!bar) return;
    clear_(bar);
  }

  window.FilterChipBar = window.FilterChipBar || {};
  Object.assign(window.FilterChipBar, {
    ensure,
    render,
    setCount,
    hide,
    clear,
  });
})();