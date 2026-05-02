// js/pages/deckmaker/deckmaker-ui.js
(function () {
  'use strict';

  // =========================
  // 0) グローバル変数・定数
  // =========================
  let costChart = null;
  let powerChart = null;
  let deckCountControlsVisible = true;

  // =========================
  // 1) 共通ユーティリティ（このファイル内で統一）
  // =========================

  // deck / cardMap の取得（読み込み順に左右されない）
  function getDeck_() {
    return window.deck || (window.deck = {});
  }
  function getCardMap_() {
    return window.cardMap || window.allCardsMap || {};
  }

  // cd 正規化（window.normCd5 が無くても落ちない）
  const normCd5 = window.normCd5 || function (cd) {
    const s = String(cd ?? '').trim();
    return s ? s.padStart(5, '0').slice(0, 5) : '';
  };

  // 並び順（全機能で統一）
  const TYPE_ORDER = { 'チャージャー': 0, 'アタッカー': 1, 'ブロッカー': 2 };

  // モバイル判定（768px以下）
  const isMobile_ = () => window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

  // 「分析(edit)」が開いているか
  function isEditTabOpen_() {
    const analysisTab = document.getElementById('edit');
    return !!analysisTab?.classList.contains('active');
  }

  // 既存window関数を「一度だけ」フックして、実行後にafterFnを呼ぶ
  function hookOnce_(fnName, afterFn) {
    const key = `__hookOnce__${fnName}`;
    if (window[key]) return;
    window[key] = true;

    const wrap = (orig) => {
      if (typeof orig !== 'function') return orig;
      if (orig.__hookedByHookOnce) return orig;
      const wrapped = function (...args) {
        const ret = orig.apply(this, args);
        try { afterFn(); } catch (_) {}
        return ret;
      };
      wrapped.__hookedByHookOnce = true;
      return wrapped;
    };

    const desc = Object.getOwnPropertyDescriptor(window, fnName);

    // non-configurableなら監視できないので「今ある関数だけ」ラップ
    if (desc && desc.configurable === false) {
      try {
        const cur = window[fnName];
        if (typeof cur === 'function') window[fnName] = wrap(cur);
      } catch (_) {}
      return;
    }

    // 既に関数があるなら先にラップ
    try {
      const cur = window[fnName];
      if (typeof cur === 'function') window[fnName] = wrap(cur);
    } catch (_) {}

    // accessorは触らない
    if (desc && (typeof desc.get === 'function' || typeof desc.set === 'function')) return;

    let current = null;
    try { current = window[fnName]; } catch (_) {}

    Object.defineProperty(window, fnName, {
      configurable: true,
      get() { return current; },
      set(v) { current = wrap(v); }
    });

    // すでに値があった場合：setterを通してラップ
    try {
      if (typeof current === 'function') window[fnName] = current;
    } catch (_) {}
  }

  // =========================
  // 2) 代表カード選択モーダル
  // =========================
  // 代表カード選択モーダルの表示・非表示
  function openRepSelectModal_() {
    const deck = getDeck_();
    if (!deck || Object.keys(deck).length === 0) {
      try {
        if (typeof window.showToast === 'function') window.showToast('デッキにカードを入れてください');
        else alert('デッキにカードを入れてください');
      } catch (_) {}
      return;
    }
    buildRepSelectGrid_();
    const modal = document.getElementById('repSelectModal');
    if (modal) modal.style.display = 'block';
  }
  function closeRepSelectModal_() {
    const modal = document.getElementById('repSelectModal');
    if (modal) modal.style.display = 'none';
  }

  // グリッド生成（renderDeckList と同じ並び順）
  function buildRepSelectGrid_() {
    const grid = document.getElementById('repSelectGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const deck = getDeck_();
    const cardMap = getCardMap_();

    const entries = Object.entries(deck || {}).sort((a, b) => {
      const [cdA] = a, [cdB] = b;
      const A = cardMap[normCd5(cdA)] || cardMap[String(cdA)];
      const B = cardMap[normCd5(cdB)] || cardMap[String(cdB)];
      if (!A || !B) return String(cdA).localeCompare(String(cdB));

      const tA = TYPE_ORDER[A.type] ?? 99, tB = TYPE_ORDER[B.type] ?? 99;
      if (tA !== tB) return tA - tB;

      const cA = (+A.cost || 0), cB = (+B.cost || 0);
      if (cA !== cB) return cA - cB;

      const pA = (+A.power || 0), pB = (+B.power || 0);
      if (pA !== pB) return pA - pB;

      return String(cdA).localeCompare(String(cdB));
    });

    for (const [cdRaw] of entries) {
      const cd = normCd5(cdRaw);
      const info = cardMap[cd] || cardMap[String(cdRaw)];
      if (!info) continue;

      const wrap = document.createElement('div');
      wrap.className = 'item';
      wrap.style.cursor = 'pointer';
      wrap.dataset.cd = cd;

      const img = document.createElement('img');
      img.alt = info.name || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = `img/${cd}.webp`;
      img.onerror = () => { img.onerror = null; img.src = 'img/00000.webp'; };

      const name = document.createElement('div');
      name.className = 'cardnote-name';
      name.textContent = info.name || '';

      wrap.appendChild(img);
      wrap.appendChild(name);

      wrap.addEventListener('click', () => {
        try { window.setRepresentativeCard?.(cd, info.name || ''); }
        catch (_) { try { window.setRepresentativeCard?.(cd, ''); } catch (_) {} }

        window.updateDeckSummaryDisplay?.();
        window.updateRepresentativeHighlight?.();
        window.scheduleAutosave?.();
        closeRepSelectModal_();
      });

      grid.appendChild(wrap);
    }
  }

  // 代表カード選択UIの初期化
  function initRepresentativeUi_() {
    const headerBtn = document.querySelector('.deck-representative-open');
    if (headerBtn && !headerBtn.__repBound) {
      headerBtn.__repBound = true;
      headerBtn.addEventListener('click', openRepSelectModal_);
    }

    ['deck-representative', 'post-representative'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.__repBound) return;
      el.__repBound = true;

      el.classList.add('tap-target');
      el.style.cursor = 'pointer';
      el.title = 'タップして代表カードを選択';
      el.addEventListener('click', openRepSelectModal_);
    });

    const closeBtn = document.getElementById('repSelectClose');
    if (closeBtn && !closeBtn.__repBound) {
      closeBtn.__repBound = true;
      closeBtn.addEventListener('click', closeRepSelectModal_);
    }

    const modal = document.getElementById('repSelectModal');
    if (modal && !modal.__repBound) {
      modal.__repBound = true;
      modal.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'repSelectModal') closeRepSelectModal_();
      });
    }

    // 互換公開
    window.openRepSelectModal = window.openRepSelectModal || openRepSelectModal_;
    window.closeRepSelectModal = window.closeRepSelectModal || closeRepSelectModal_;
    window.buildRepSelectGrid = window.buildRepSelectGrid || buildRepSelectGrid_;
  }

  // =========================
  // 3) デッキカードリストの背景更新
  // =========================
  // デッキカードリストの背景を、メイン種族に応じた色に更新
  // カードがないときは無地背景
  function updateDeckCardListBackground_() {
    const listEl = document.getElementById('deck-card-list');
    if (!listEl) return;

    const deck = getDeck_();
    const hasCards = Object.keys(deck || {}).length > 0;

    listEl.classList.remove(
      'race-bg-ドラゴン',
      'race-bg-アンドロイド',
      'race-bg-エレメンタル',
      'race-bg-ルミナス',
      'race-bg-シェイド'
    );

    if (!hasCards) {
      listEl.style.removeProperty('backgroundColor');
      listEl.style.removeProperty('background');
      listEl.style.removeProperty('background-image');
      return;
    }

    const mainRace =
      (typeof window.getMainRace === 'function' ? window.getMainRace() : null) ||
      (typeof window.computeMainRace === 'function' ? window.computeMainRace() : null);

    if (mainRace) {
      listEl.style.removeProperty('background');
      listEl.style.removeProperty('background-image');
      listEl.classList.add(`race-bg-${mainRace}`);
    } else {
      listEl.style.removeProperty('backgroundColor');
      listEl.style.removeProperty('background');
      listEl.style.removeProperty('background-image');
    }
  }
  window.updateDeckCardListBackground = window.updateDeckCardListBackground || updateDeckCardListBackground_;

  // デッキリスト枚数バッジの自動拡大縮小
  function autoscaleBadgeForCardEl_(cardEl) {
    const img = cardEl?.querySelector?.('img');
    const badge = cardEl?.querySelector?.('.count-badge');
    if (!img || !badge) return;

    const apply = () => {
      const W = img.clientWidth || img.naturalWidth || 220;
      const bW = Math.max(20, Math.round(W * 0.18));
      const bH = Math.max(14, Math.round(W * 0.18));
      const fz = Math.max(10, Math.round(W * 0.12));
      const gap = Math.max(2, Math.round(W * 0.02));

      Object.assign(badge.style, {
        width: `${bW}px`,
        height: `${bH}px`,
        fontSize: `${fz}px`,
        borderRadius: `${Math.round(bH * 0.6)}px`,
        padding: `0 ${Math.round(bW * 0.15)}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        top: `${gap}px`,
        right: `${gap}px`,
      });
    };

    if (img.complete) apply();
    else img.addEventListener('load', apply, { once: true });
  }

  // 全カード要素に対してバッジの自動拡大縮小を適用
  function autoscaleAllBadges_() {
    document.querySelectorAll('.deck-entry, .deck-card, .deckpeek-card')
      .forEach(autoscaleBadgeForCardEl_);
  }

  window.autoscaleBadgeForCardEl = window.autoscaleBadgeForCardEl || autoscaleBadgeForCardEl_;
  window.autoscaleAllBadges = window.autoscaleAllBadges || autoscaleAllBadges_;

  // ウィンドウリサイズ時に自動で拡大縮小を更新するイベントをバインド
  function bindAutoscale_() {
    if (window.__dmBadgeAutoscaleBound) return;
    window.__dmBadgeAutoscaleBound = true;

    window.addEventListener('resize', () => requestAnimationFrame(autoscaleAllBadges_));

    if (window.ResizeObserver) {
      const target = document.getElementById('deck-card-list');
      if (target) {
        new ResizeObserver(() => requestAnimationFrame(autoscaleAllBadges_))
          .observe(target);
      }
    }
  }

  function applyRepresentativeClass_() {
    const rep = normCd5(window.representativeCd);
    const targets = document.querySelectorAll('.deck-card, .deck-entry');
    targets.forEach(el => {
      el.classList.remove('representative');
      const raw = el.dataset.cd || el.getAttribute('data-cd') || '';
      const cd = normCd5(raw);
      if (rep && cd === rep) el.classList.add('representative');
    });
  }

  window.updateRepresentativeHighlight = window.updateRepresentativeHighlight || function (cd5, name) {
    const repCd = (cd5 || window.representativeCd || null);

    // 表示名の補完（updateDeckSummaryDisplayがあるなら最終的にはそっちでOK）
    if (!name && repCd) {
      const map = getCardMap_();
      name = map?.[repCd]?.name || '';
    }

    if (typeof window.updateDeckSummaryDisplay === 'function') {
      window.updateDeckSummaryDisplay();
    } else {
      const infoEl = document.getElementById('deck-representative');
      const postEl = document.getElementById('post-representative');
      if (infoEl) infoEl.textContent = name || '';
      if (postEl) postEl.textContent = name || '';
    }

    const repValidator = document.getElementById('post-rep-validator');
    if (repValidator) {
      repValidator.value = repCd || '';
      if (typeof repValidator.setCustomValidity === 'function') repValidator.setCustomValidity('');
    }

    applyRepresentativeClass_();
  };

  // デッキカードリストの背景更新と代表カードハイライトを、描画後に追従させる
  function initListUiExtras_() {
    bindAutoscale_();
    try { window.updateDeckCardListBackground?.(); } catch (_) {}
    try { requestAnimationFrame(autoscaleAllBadges_); } catch (_) {}
    try { window.updateRepresentativeHighlight?.(); } catch (_) {}
    applyDeckCountControlsVisibility_();
  }

  // デッキリストの枚数調整ボタン表示を反映
  function applyDeckCountControlsVisibility_() {
    const listEl = document.getElementById('deck-card-list');
    const toggle = document.querySelector('.deck-count-adjust-toggle');

    if (listEl) {
      listEl.classList.toggle('is-count-controls-visible', deckCountControlsVisible);
    }

    if (toggle) {
      toggle.textContent = deckCountControlsVisible ? '＋－ ボタン：ON' : '＋－ ボタン：OFF';
      toggle.setAttribute('aria-pressed', deckCountControlsVisible ? 'true' : 'false');
    }
  }

  // デッキリストの枚数調整トグルを初期化
  function initDeckCountAdjustToggle_() {
    const toggle = document.querySelector('.deck-count-adjust-toggle');
    if (!toggle || toggle.__deckCountAdjustBound) return;

    toggle.__deckCountAdjustBound = true;
    toggle.addEventListener('click', () => {
      deckCountControlsVisible = !deckCountControlsVisible;
      applyDeckCountControlsVisibility_();
    });

    applyDeckCountControlsVisibility_();
  }

  // デッキリスト操作メニューを初期化
  function initDeckListActionsMenu_() {
    const menu = document.querySelector('.deck-list-menu');
    const toggle = menu?.querySelector?.('.deck-list-menu-toggle');
    const panel = menu?.querySelector?.('.deck-list-menu-panel');
    if (!menu || !toggle || !panel || menu.__deckListMenuBound) return;

    menu.__deckListMenuBound = true;

    const closeMenu = () => {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    };
    const openMenu = () => {
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    };
    const toggleMenu = () => {
      if (panel.hidden) openMenu();
      else closeMenu();
    };

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    panel.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[data-deck-action]');
      if (!btn) return;

      closeMenu();
      const action = btn.dataset.deckAction;

      if (action === 'representative') {
        openRepSelectModal_();
        return;
      }

      if (action === 'image') {
        if (typeof window.exportDeckImage === 'function') window.exportDeckImage();
        else document.getElementById('exportPngBtn')?.click();
        return;
      }

      if (action === 'save') {
        window.saveDeckToLocalStorage?.();
        return;
      }

      if (action === 'reset') {
        window.resetDeckState?.();
      }
    });

    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) closeMenu();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  }

  // =========================
  // 4) カード詳細モーダル
  // =========================
  function initCardDetailModal_() {
    if (initCardDetailModal_.bound) return;
    initCardDetailModal_.bound = true;

    document.addEventListener('tab:switched', () => {
      window.closeCardDetailModal?.();
    });

    document.addEventListener('click', (e) => {
      const cell = e.target.closest?.('.deck-entry');
      if (!cell) return;
      if (e.target.closest?.('button, a, input, textarea, select, label')) return;

      const cd = cell.dataset.cd || cell.getAttribute('data-cd');
      if (!cd) return;

      window.openCardDetailModal?.(cd, {
        anchorRect: cell.getBoundingClientRect(),
        cardMap: getCardMap_(),
      });
    });
  }

  // =========================
  // 5) デッキリスト描画
  // =========================
  function renderDeckList() {
    const deck = getDeck_();
    const cardMap = getCardMap_();
    const container = document.getElementById('deck-card-list');
    const emptyMessage = document.getElementById('deckcard-empty-message');
    if (!container) return;

    container.innerHTML = '';
    if (emptyMessage) container.appendChild(emptyMessage);

    const entries = Object.entries(deck || {});

    const repNow = window.representativeCd || null;
    if (repNow && !deck[repNow]) {
      window.representativeCd = null;
    }

    entries.sort((a, b) => {
      const [cdA] = a;
      const [cdB] = b;
      const cardA = cardMap[normCd5(cdA)] || cardMap[String(cdA)];
      const cardB = cardMap[normCd5(cdB)] || cardMap[String(cdB)];
      if (!cardA || !cardB) return String(cdA).localeCompare(String(cdB));

      const typeA = TYPE_ORDER[cardA.type] ?? 99;
      const typeB = TYPE_ORDER[cardB.type] ?? 99;
      if (typeA !== typeB) return typeA - typeB;

      const costA = Number(cardA.cost || 0);
      const costB = Number(cardB.cost || 0);
      if (costA !== costB) return costA - costB;

      const powerA = Number(cardA.power || 0);
      const powerB = Number(cardB.power || 0);
      if (powerA !== powerB) return powerA - powerB;

      return String(cdA).localeCompare(String(cdB));
    });

    if (emptyMessage) emptyMessage.style.display = entries.length === 0 ? 'flex' : 'none';
    if (entries.length === 0) {
      window.representativeCd = null;
      window.updateDeckSummaryDisplay?.();
      window.updateDeckCardListBackground?.();
      return;
    }

    const rep = window.representativeCd || null;
    const representativeExists = entries.some(([cd]) => normCd5(cd) === rep);
    const nextRepresentative = representativeExists ? rep : null;

    for (const [cdRaw, count] of entries) {
      const cd = normCd5(cdRaw);
      const card = cardMap[cd] || cardMap[String(cdRaw)];
      if (!card) continue;

      const cardEl = document.createElement('div');
      cardEl.className = 'deck-entry';
      cardEl.dataset.cd = cd;
      cardEl.dataset.race = card.race || '';
      cardEl.dataset.type = card.type || '';
      cardEl.dataset.rarity = card.rarity || '';
      if (cd === nextRepresentative) cardEl.classList.add('representative');

      const img = document.createElement('img');
      img.src = `img/${cd}.webp`;
      img.alt = card.name || '';
      img.onerror = () => { img.onerror = null; img.src = 'img/00000.webp'; };
      cardEl.appendChild(img);

      const badge = document.createElement('div');
      badge.className = 'count-badge';
      badge.textContent = 'x' + count;
      cardEl.appendChild(badge);

      const controls = document.createElement('div');
      controls.className = 'deck-entry-count-controls';

      const dec = document.createElement('button');
      dec.type = 'button';
      dec.className = 'deck-entry-count-btn';
      dec.textContent = Number(count) <= 1 ? '削除' : '-';
      dec.setAttribute('aria-label', Number(count) <= 1 ? 'カードを削除' : 'カードを1枚減らす');
      dec.addEventListener('click', (e) => {
        e.stopPropagation();
        if (Number(count) <= 1) {
          const cardName = card.name || 'このカード';
          const ok = window.confirm?.(`「${cardName}」をデッキから削除しますか？`);
          if (!ok) return;
        }
        window.removeCard?.(cd);
      });

      const inc = document.createElement('button');
      inc.type = 'button';
      inc.className = 'deck-entry-count-btn';
      inc.textContent = '+';
      inc.disabled = card.race === '旧神' ? Number(count) >= 1 : Number(count) >= 3;
      inc.setAttribute('aria-label', 'カードを1枚増やす');
      inc.addEventListener('click', (e) => {
        e.stopPropagation();
        window.addCard?.(cd);
      });

      controls.appendChild(dec);
      controls.appendChild(inc);
      cardEl.appendChild(controls);

      container.appendChild(cardEl);
      window.autoscaleBadgeForCardEl?.(cardEl);
    }

    window.representativeCd = nextRepresentative;
    window.updateDeckSummaryDisplay?.();
    window.updateDeckCardListBackground?.();
    window.updateRepresentativeHighlight?.();
    applyDeckCountControlsVisibility_();
  }

  function initDeckListRendering_() {
    window.renderDeckList = renderDeckList;

    if (!window.__deckListRenderHooked) {
      window.__deckListRenderHooked = true;
      const hookAfterRender = (fnName) => {
        const original = window[fnName];
        if (typeof original !== 'function' || original.__deckListRenderHooked) return;

        const wrapped = function (...args) {
          const result = original.apply(this, args);
          renderDeckList();
          return result;
        };
        wrapped.__deckListRenderHooked = true;
        window[fnName] = wrapped;
      };

      hookAfterRender('updateDeck');
      hookAfterRender('addCard');
      hookAfterRender('removeCard');
    }

    renderDeckList();
  }
  // =========================

  // ===== デッキ分析更新 =====
  function updateDeckAnalysis() {
    const deck = getDeck_();
    const cardMap = getCardMap_();
    const buildDeckAnalysisCards = window.buildDeckAnalysisCards;
    const analyzeDeckCards = window.analyzeDeckCards;
    const formatManaEfficiencyText = window.formatManaEfficiencyText;
    const renderDeckTypePowerSummary = window.renderDeckTypePowerSummary;

    if (typeof buildDeckAnalysisCards !== 'function' || typeof analyzeDeckCards !== 'function') {
      window.updateAutoTags?.();
      if (typeof window.refreshPostSummary === 'function') window.refreshPostSummary();
      return;
    }

    const deckCards = buildDeckAnalysisCards(deck, cardMap, { normalizeCd: normCd5 });
    const analysis = analyzeDeckCards(deckCards);
    const rarityCounts = analysis.rarityCounts || {};

    const raritySummary = document.getElementById('rarity-summary');
    if (raritySummary) {
      const legend = rarityCounts[window.DECK_RARITY_LEGEND] || 0;
      const gold = rarityCounts[window.DECK_RARITY_GOLD] || 0;
      const silver = rarityCounts[window.DECK_RARITY_SILVER] || 0;
      const bronze = rarityCounts[window.DECK_RARITY_BRONZE] || 0;

      raritySummary.innerHTML = `
        <span class="rar-item">🌈レジェンド${legend}枚</span>
        <span class="rar-item">🟡ゴールド${gold}枚</span>
        <span class="rar-item">⚪️シルバー${silver}枚</span>
        <span class="rar-item">🟤ブロンズ${bronze}枚</span>
      `;
    }

    const sumCostEl = document.getElementById('total-cost');
    if (sumCostEl) sumCostEl.textContent = String(analysis.sumCost);

    const costSummary = document.getElementById('cost-summary-deckmaker');
    if (costSummary) {
      costSummary.innerHTML = `<span class="stat-chip">総コスト ${analysis.sumCost}</span>`;
    }

    const avgChargeEl = document.getElementById('avg-charge');
    if (avgChargeEl) {
      avgChargeEl.textContent = analysis.avgCharge !== null ? analysis.avgCharge.toFixed(2) : '-';
    }

    const manaEffEl = document.getElementById('mana-efficiency');
    if (manaEffEl) {
      const manaState = typeof formatManaEfficiencyText === 'function'
        ? formatManaEfficiencyText(analysis.manaEfficiency)
        : { text: '-', className: 'mana-eff' };
      manaEffEl.textContent = manaState.text;
      manaEffEl.className = manaState.className;
    }

    const sumPowerEl = document.getElementById('total-power');
    if (sumPowerEl) sumPowerEl.textContent = '';

    const powerSummary = document.getElementById('power-summary-deckmaker');
    if (typeof renderDeckTypePowerSummary === 'function') {
      renderDeckTypePowerSummary(powerSummary, analysis);
    }

    const ChartCtor = window.Chart;
    if (!ChartCtor) {
      window.updateAutoTags?.();
      if (typeof window.refreshPostSummary === 'function') window.refreshPostSummary();
      return;
    }

    if (costChart) costChart.destroy();
    if (powerChart) powerChart.destroy();

    const renderedCharts = window.renderDeckDistributionCharts?.({
      chartCtor: ChartCtor,
      costCanvas: document.getElementById('costChart-deckmaker'),
      powerCanvas: document.getElementById('powerChart-deckmaker'),
      costLabels: analysis.costLabels,
      powerLabels: analysis.powerLabels,
      costCards: analysis.costCards,
      powerCards: analysis.analysisCards,
      noteText: analysis.excludedLosslis66Count > 0
        ? `※66コスロスリスカード ${analysis.excludedLosslis66Count}枚は除く`
        : '',
    });

    if (renderedCharts) {
      costChart = renderedCharts.costChart;
      powerChart = renderedCharts.powerChart;
    }

    window.updateAutoTags?.();
    if (typeof window.refreshPostSummary === 'function') window.refreshPostSummary();
  }
  function updateDeckSummaryDisplay() {
    const cardMap = getCardMap_();
    const repCd = window.representativeCd;

    let name = '未選択';
    if (repCd && cardMap[repCd]) name = cardMap[repCd].name;

    const infoEl = document.getElementById('deck-representative');
    const postEl = document.getElementById('post-representative');
    if (infoEl) infoEl.textContent = name;
    if (postEl) postEl.textContent = name;
  }

  // 自動タグ更新
  function updateAutoTags() {
    const deck = getDeck_();
    const cardMap = getCardMap_();

    const autoWrap = document.getElementById('auto-tags');
    if (!autoWrap) return;

    const deckCount = Object.values(deck).reduce((sum, n) => sum + (n | 0), 0);
    if (deckCount === 0) {
      autoWrap.innerHTML = '';
      return;
    }

    const autoTags = [];

    const mainRace = window.computeMainRace?.();
    if (mainRace) autoTags.push(mainRace);

    const rarityCounts = { 'レジェンド': 0, 'ゴールド': 0, 'シルバー': 0, 'ブロンズ': 0 };
    Object.entries(deck).forEach(([cd, n]) => {
      const r = cardMap[cd]?.rarity;
      if (r && rarityCounts[r] != null) rarityCounts[r] += (n | 0);
    });

    const legendNone = rarityCounts['レジェンド'] === 0;
    const goldNone   = rarityCounts['ゴールド']   === 0;

    if (legendNone && goldNone) autoTags.push('レジェンドゴールドなし');
    else if (legendNone) autoTags.push('レジェンドなし');

    const hasOldGod = Object.keys(deck).some(cd => cardMap[cd]?.race === '旧神');
    if (!hasOldGod && !legendNone) autoTags.push('旧神なし');

    // 単一英語パック
    (function(){
      const englishPacks = new Set();
      for (const [cd, n] of Object.entries(deck)) {
        if (!(n | 0)) continue;
        const infoRaw = (window.cardMap?.[cd]) || (window.allCardsMap?.[cd]);
        if (!infoRaw) continue;

        let info = infoRaw;
        if (infoRaw.link) {
          const srcCd = String(infoRaw.linkCd || infoRaw.link_cd || '');
          if (srcCd) {
            const base = (window.cardMap?.[srcCd]) || (window.allCardsMap?.[srcCd]);
            if (base) info = base;
          }
        }

        const packEn = window.getPackEnName?.(info.packName || info.pack_name || info.pack || '');
        if (!packEn) continue;

        const first = packEn.charAt(0);
        if (first >= 'A' && first <= 'Z') englishPacks.add(packEn);
      }
      if (englishPacks.size === 1) {
        const onlyPackEn = Array.from(englishPacks)[0];
        const key = onlyPackEn.charAt(0).toUpperCase();
        autoTags.push(`${key}パックのみ`);
      }
    })();

    // ハイランダー
    const isHighlander =
      deckCount >= 30 &&
      Object.values(deck).every(n => (n | 0) === 1);

    if (isHighlander) autoTags.push('ハイランダー');

    autoWrap.innerHTML = '';
    autoTags.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = tag;
      chip.dataset.auto = 'true';
      autoWrap.appendChild(chip);
    });
  }

  // 公開API
  window.updateDeckAnalysis = updateDeckAnalysis;
  window.updateDeckSummaryDisplay = updateDeckSummaryDisplay;
  window.updateAutoTags = updateAutoTags;

  // =========================
  // 8) デッキ全体表示（デッキピーク）
  // =========================
  // Deck Peek 要素取得（HTMLに存在する前提）
  function getDeckPeekEls_() {
    const btn  = document.getElementById('deckpeek-button');
    const pane = document.getElementById('deckpeek-overlay');
    const grid = document.getElementById('deckpeek-grid');
    return { btn, pane, grid };
  }

  // デッキ内カードをソートしてコードの配列で返す
  function getDeckCdsSorted_() {
    const deck = getDeck_();
    const cardMap = getCardMap_();

    const cds = Object.keys(deck).filter(cd => (deck[cd] | 0) > 0);
    cds.sort((a, b) => {
      const A = cardMap[normCd5(a)] || cardMap[String(a)];
      const B = cardMap[normCd5(b)] || cardMap[String(b)];
      if (!A || !B) return String(a).localeCompare(String(b));

      const tA = TYPE_ORDER[A.type] ?? 99;
      const tB = TYPE_ORDER[B.type] ?? 99;
      if (tA !== tB) return tA - tB;

      const cA = (parseInt(A.cost, 10) || 0);
      const cB = (parseInt(B.cost, 10) || 0);
      if (cA !== cB) return cA - cB;

      const pA = (parseInt(A.power, 10) || 0);
      const pB = (parseInt(B.power, 10) || 0);
      if (pA !== pB) return pA - pB;

      return normCd5(a).localeCompare(normCd5(b));
    });
    return cds.map(normCd5);
  }

  // Deck Peekの内容を描画
  function renderDeckPeek_() {
    const { grid } = getDeckPeekEls_();
    if (!grid) return;
    grid.innerHTML = '';

    const deck = getDeck_();
    const cds = getDeckCdsSorted_();
    if (!cds.length) {
      grid.innerHTML = '<div style="padding:6px;color:#666;font-size:12px;">デッキが空です</div>';
      return;
    }

    for (const cd of cds) {
      const wrap = document.createElement('div');
      wrap.className = 'deckpeek-card';

      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = `img/${normCd5(cd)}.webp`;
      img.onerror = () => { img.onerror = null; img.src = 'img/00000.webp'; };

      const badge = document.createElement('div');
      badge.className = 'count-badge';
      badge.textContent = `×${(deck[cd] | 0) || 1}`;

      wrap.appendChild(img);
      wrap.appendChild(badge);
      grid.appendChild(wrap);
    }
  }

  // ボタン色：メイン種族を淡く反映（無ければ白）
  function updateDeckPeekButtonColor_() {
    const btn = document.getElementById('deckpeek-button');
    if (!btn) return;

    const mainRace =
      (typeof window.getMainRace === 'function' ? window.getMainRace() : null) ||
      (typeof window.computeMainRace === 'function' ? window.computeMainRace() : null);

    btn.classList.remove(
      'race-bg-ドラゴン',
      'race-bg-アンドロイド',
      'race-bg-エレメンタル',
      'race-bg-ルミナス',
      'race-bg-シェイド'
    );

    if (mainRace) btn.classList.add(`race-bg-${mainRace}`);
    else btn.style.background = 'rgba(255,255,255,.9)';
  }

  // Deck Peekの表示制御をセットアップ
  function isInfoSectionVisibleEnough_() {
    const infoSection =
      document.querySelector('#deck-info .tab-content.active .info-section') ||
      document.querySelector('#deck-info .info-section');
    if (!infoSection || typeof infoSection.getBoundingClientRect !== 'function') return false;

    const rect = infoSection.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!vw || !vh || rect.width <= 0 || rect.height <= 0) return false;

    const visibleWidth = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
    const visibleAreaRatio = (visibleWidth * visibleHeight) / (vw * vh);
    return visibleAreaRatio >= 0.2;
  }

  function hasDeckCards_() {
    const deck = getDeck_();
    return Object.values(deck).some(count => (count | 0) > 0);
  }

  function installDeckPeekObserver_() {
    const { btn, pane } = getDeckPeekEls_();
    if (!btn || !pane) return;
    const list = document.getElementById('deck-card-list');
    const modal = document.getElementById('noteFullModal');
    if (!list) return;

    const updateVisibility = (visibleEntry) => {
      const visible = !!visibleEntry?.isIntersecting;
      const modalOpen = modal ? (getComputedStyle(modal).display === 'flex') : false;
      const infoVisibleEnough = isInfoSectionVisibleEnough_();
      const hasDeckCards = hasDeckCards_();

      // モバイル && editタブ && deck-card-listが見えてない → 表示
      const show = hasDeckCards && ((isMobile_() && isEditTabOpen_() && !visible && infoVisibleEnough) || modalOpen);

      btn.style.display = show ? 'inline-flex' : 'none';
      if (modalOpen) btn.classList.add('onModal'); else btn.classList.remove('onModal');
      if (!show) pane.style.display = 'none';
    };

    const refreshVisibility = () => {
      const rect = list.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      updateVisibility({ isIntersecting: rect.bottom > 0 && rect.top < vh });
    };

    if (window.__deckPeekIO) window.__deckPeekIO.disconnect();
    window.__deckPeekIO = new IntersectionObserver((entries) => {
      updateVisibility(entries[0]);
    }, { root: null, threshold: 0.05 });

    window.__deckPeekIO.observe(list);

    if (modal) {
      if (window.__deckPeekMO) window.__deckPeekMO.disconnect();
      window.__deckPeekMO = new MutationObserver(() => {
        updateVisibility({ isIntersecting: false });
      });
      window.__deckPeekMO.observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    if (window.__deckPeekScrollHandler) {
      window.removeEventListener('scroll', window.__deckPeekScrollHandler);
      window.removeEventListener('resize', window.__deckPeekScrollHandler);
    }
    window.__deckPeekScrollHandler = refreshVisibility;
    window.addEventListener('scroll', window.__deckPeekScrollHandler, { passive: true });
    window.addEventListener('resize', window.__deckPeekScrollHandler);

    refreshVisibility();
  }

  // Deck Peekのボタンに長押しイベントをバインド
  function bindPressHoldDeckPeek_() {
    const { btn, pane } = getDeckPeekEls_();
    if (!btn || !pane) return;
    if (btn.__deckPeekBound) return;
    btn.__deckPeekBound = true;

    const show = () => {
      renderDeckPeek_();
      updateDeckPeekButtonColor_();
      pane.style.display = 'block';
    };
    const hide = () => { pane.style.display = 'none'; };

    btn.addEventListener('touchstart', (e) => { e.preventDefault(); show(); }, { passive: false });
    btn.addEventListener('touchend', hide, { passive: true });
    btn.addEventListener('touchcancel', hide, { passive: true });

    btn.addEventListener('mousedown', (e) => { e.preventDefault(); show(); });
    window.addEventListener('mouseup', hide);

    window.addEventListener('blur', hide);
    window.addEventListener('scroll', hide, { passive: true });
  }

  // Deck Peekと関連機能の初期化
  function initDeckPeekAndFloating_() {
    installDeckPeekObserver_();
    bindPressHoldDeckPeek_();

    // updateDeck/renderDeckList 後に追従
    hookOnce_('updateDeck', () => { renderDeckPeek_(); updateDeckPeekButtonColor_(); });
    hookOnce_('renderDeckList', () => { renderDeckPeek_(); updateDeckPeekButtonColor_(); });

    document.addEventListener('tab:switched', () => {
      setTimeout(() => {
        installDeckPeekObserver_();
        updateDeckPeekButtonColor_();
      }, 0);
    });

    updateDeckPeekButtonColor_();
  }

  //  マナ効率ヘルプモーダルの初期化
  function initManaHelpModal_() {
    const btn   = document.getElementById('mana-help-btn');
    const modal = document.getElementById('manaHelpModal');
    const close = document.getElementById('mana-help-close');
    if (!modal) return;

    // 多重バインド防止
    if (modal.__manaHelpBound) return;
    modal.__manaHelpBound = true;

    if (btn) {
      btn.addEventListener('click', () => {
        modal.style.display = 'flex'; // 他のmodalと揃える
      });
    }

    if (close) {
      close.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }

    // 背景クリックで閉じる
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }


  // =========================
  // 9) 初期化
  // =========================
  function initDeckUi_() {
    initDeckListRendering_();
    initCardDetailModal_();
    initRepresentativeUi_();
    initDeckPeekAndFloating_();
    initDeckCountAdjustToggle_();
    initDeckListActionsMenu_();
    initListUiExtras_();
    initManaHelpModal_();
    window.updateDeckSummaryDisplay?.();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDeckUi_);
  } else {
    initDeckUi_();
  }

})();
