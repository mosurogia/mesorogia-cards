// js/pages/deckmaker/deck-ui.js
(function () {
  'use strict';

  // =========================
  // 0) グローバル変数・定数
  // =========================
  let costChart = null;
  let powerChart = null;

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
    return String(cd ?? '').trim().padStart(5, '0').slice(0, 5);
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
      try { window.showToast?.('デッキが空です'); } catch (_) {}
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
  // カードがないときはデフォルト背景
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
      listEl.style.backgroundImage = 'url("./img/cardlist.webp")';
      return;
    }

    const mainRace =
      (typeof window.getMainRace === 'function' ? window.getMainRace() : null) ||
      (typeof window.computeMainRace === 'function' ? window.computeMainRace() : null);

    if (mainRace) {
      listEl.style.backgroundImage = 'none';
      listEl.classList.add(`race-bg-${mainRace}`);
    } else {
      listEl.style.removeProperty('backgroundColor');
      listEl.style.backgroundImage = 'url("./img/cardlist.webp")';
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
    const rep = String(window.representativeCd || '').padStart(5, '0').slice(0, 5);
    const targets = document.querySelectorAll('.deck-card, .deck-entry');
    targets.forEach(el => {
      el.classList.remove('representative');
      const raw = el.dataset.cd || el.getAttribute('data-cd') || '';
      const cd = String(raw).padStart(5, '0').slice(0, 5);
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
  }

  // =========================
  // 4) カード効果（操作モーダル内）
  // =========================
  function buildCardOpEffects(info) {
    const wrap = document.getElementById('cardOpEffects');
    if (!wrap) return;

    wrap.innerHTML = '';

    const items = [];
    const names = [info?.effect_name1, info?.effect_name2].filter(Boolean);
    const texts = [info?.effect_text1, info?.effect_text2].filter(Boolean);

    for (let i = 0; i < Math.max(names.length, texts.length); i++) {
      items.push({ name: names[i] || '効果', text: texts[i] || '' });
    }

    if (!items.length && (info?.effect || info?.text)) {
      items.push({ name: info.effect || '効果', text: info.text || '' });
    }

    const esc = (typeof window.escapeHtml_ === 'function')
      ? window.escapeHtml_
      : (s) => String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    if (!items.length) {
      const d = document.createElement('div');
      d.className = 'eff';
      d.innerHTML = '<div class="eff-name">効果</div><div class="eff-text">（効果情報なし）</div>';
      wrap.appendChild(d);
      return;
    }

    for (const it of items) {
      const d = document.createElement('div');
      d.className = 'eff';
      d.innerHTML =
        `<div class="eff-name">${esc(it.name || '効果')}</div>` +
        `<div class="eff-text">${esc(it.text || '')}</div>`;
      wrap.appendChild(d);
    }
  }
  window.buildCardOpEffects = window.buildCardOpEffects || buildCardOpEffects;

  // =========================
  // 5) カード操作モーダル
  // =========================
  // 現在操作中のカードコード（normCd5で統一）
  let _cardOpCurrentCd = null;
  const _cardOpDrag = { active: false, startX: 0, startY: 0, startLeft: 0, startTop: 0 };

  // カード操作モーダルの要素をまとめて取得
  function getCardOpEls_() {
    return {
      modal:  document.getElementById('cardOpModal'),
      box:    document.getElementById('cardOpModalContent'),
      header: document.getElementById('cardOpHeader'),
      close:  document.getElementById('cardOpCloseBtn'),
      title:  document.getElementById('cardOpTitle'),
      img:    document.getElementById('cardOpImg'),
      badge:  document.getElementById('cardOpCountBadge'),
      dec:    document.getElementById('cardOpDec'),
      inc:    document.getElementById('cardOpInc'),
      rep:    document.getElementById('cardOpSetRep'),
    };
  }

  // ＋／－／代表ボタン活性（旧神は1枚まで、通常は3枚まで）
  function updateCardOpButtons_() {
    const { inc, dec, rep } = getCardOpEls_();
    const cd = _cardOpCurrentCd;

    if (!cd) {
      if (inc) inc.disabled = true;
      if (dec) dec.disabled = true;
      if (rep) rep.disabled = true;
      return;
    }

    const deck = getDeck_();
    const map = getCardMap_();
    const info = map?.[cd];
    const n = deck?.[cd] ?? 0;

    if (inc) inc.disabled = (info?.race === '旧神') ? (n >= 1) : (n >= 3);
    if (dec) dec.disabled = (n <= 0);
    if (rep) rep.disabled = !(n > 0);
  }

  // 枚数バッジの同期（リスト側のバッジも即時更新）
  function updateCardOpCountBadge_() {
    const { badge } = getCardOpEls_();
    const deck = getDeck_();
    const cd = _cardOpCurrentCd;

    const n = (cd ? (deck?.[cd] ?? 0) : 0);
    if (badge) badge.textContent = '×' + n;

    updateCardOpButtons_();

    if (cd) {
      const listBadge = document.querySelector(
        `#deck-card-list .deck-entry[data-cd="${CSS.escape(cd)}"] .count-badge`
      );
      if (listBadge) listBadge.textContent = '×' + n;

      const barBadge = document.querySelector(
        `#deckBarTop .deck-card[data-cd="${CSS.escape(cd)}"] .count-badge`
      );
      if (barBadge) {
        barBadge.textContent = String(n);
        const cardEl = barBadge.closest('.deck-card');
        if (cardEl && typeof window.autoscaleBadgeForCardEl === 'function') {
          window.autoscaleBadgeForCardEl(cardEl);
        }
      }
    }
  }

  // 0枚でも key は残す（閉じ時に削除判断）
  function removeCardSoft_(cd) {
    const deck = getDeck_();
    const cur = (+deck?.[cd] || 0);
    const next = Math.max(0, cur - 1);
    deck[cd] = next;
    window.updateDeckSummaryDisplay?.();
    window.scheduleAutosave?.();
  }

  //モーダルを閉じる前に、0枚のカードを削除するか確認する
  function closeCardOpModal_() {
    const { modal } = getCardOpEls_();
    if (!modal?.classList.contains('show')) return true;

    const deck = getDeck_();
    const cd = _cardOpCurrentCd;
    const n = (cd ? (deck?.[cd] ?? 0) : 0);

    if (n === 0 && cd && Object.prototype.hasOwnProperty.call(deck || {}, cd)) {
      const ok = confirm('このカードをデッキから削除しますか？');
      if (ok) {
        delete deck[cd];
        window.updateDeck?.();
        window.renderDeckList?.();
        window.updateDeckSummaryDisplay?.();
        window.scheduleAutosave?.();
      } else {
        deck[cd] = 1;
        window.updateDeck?.();
        window.renderDeckList?.();
        window.updateDeckSummaryDisplay?.();
        window.scheduleAutosave?.();
        updateCardOpCountBadge_();
        return false;
      }
    }

    modal.classList.remove('show');
    modal.style.display = 'none';
    _cardOpCurrentCd = null;
    return true;
  }

  // カード操作モーダルを開く（anchorRectはオプションで、アンカーの位置情報）
  function openCardOpModal_(cd, anchorRect) {
    const cd5 = normCd5(cd);
    const map = getCardMap_();
    const info = map?.[cd5] || map?.[String(cd)] || null;
    if (!info) return;

    _cardOpCurrentCd = cd5;

    const { modal, box, img, title } = getCardOpEls_();
    if (!modal || !box) return;

    if (img) {
      img.src = `img/${cd5}.webp`;
      img.alt = info.name || '';
      img.onerror = () => { img.onerror = null; img.src = 'img/00000.webp'; };
    }
    if (title) title.textContent = info.name || 'カード操作';

    updateCardOpCountBadge_();
    try { window.buildCardOpEffects?.(info); } catch (_) {}

    modal.style.display = 'block';
    modal.classList.add('show');

    const vw = window.innerWidth, vh = window.innerHeight;
    const r = anchorRect || { left: vw / 2, right: vw / 2, top: vh / 2, bottom: vh / 2, width: 0, height: 0 };
    const desiredLeft = (r.right ?? r.left) + 8;
    const desiredTop = (r.top ?? r.bottom) + 0;

    requestAnimationFrame(() => {
      const w = box.offsetWidth || 320;
      const h = box.offsetHeight || 240;
      const left = Math.min(Math.max(8, desiredLeft), vw - w - 8);
      const top = Math.min(Math.max(8, desiredTop), vh - h - 8);

      box.style.transform = 'none';
      box.style.left = left + 'px';
      box.style.top = top + 'px';
    });
  }

  // カード操作モーダルの初期化
  function initCardOpModal_() {
    const els = getCardOpEls_();
    if (!els.modal || !els.box) return;

    const dragHandle =
      document.querySelector('#cardOpHeader .cardop-topline') ||
      document.getElementById('cardOpHeader');

    if (dragHandle && !dragHandle.__cardOpDragBound) {
      dragHandle.__cardOpDragBound = true;

      const onDown = (e) => {
        if (e.target?.closest?.('#cardOpCloseBtn')) return;
        _cardOpDrag.active = true;
        const rect = els.box.getBoundingClientRect();
        const pt = e.touches?.[0] || e;
        _cardOpDrag.startX = pt.clientX;
        _cardOpDrag.startY = pt.clientY;
        _cardOpDrag.startLeft = rect.left;
        _cardOpDrag.startTop = rect.top;
        els.box.style.transform = 'none';
        e.preventDefault?.();
      };

      const onMove = (e) => {
        if (!_cardOpDrag.active) return;
        const pt = e.touches?.[0] || e;
        const left = _cardOpDrag.startLeft + (pt.clientX - _cardOpDrag.startX);
        const top = _cardOpDrag.startTop + (pt.clientY - _cardOpDrag.startY);

        const vw = innerWidth, vh = innerHeight;
        const w = els.box.offsetWidth || 320;
        const h = els.box.offsetHeight || 240;

        els.box.style.left = Math.min(Math.max(left, 8 - w * 0.9), vw - 8) + 'px';
        els.box.style.top = Math.min(Math.max(top, 8 - h * 0.9), vh - 8) + 'px';
      };

      const onUp = () => { _cardOpDrag.active = false; };

      dragHandle.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

      dragHandle.addEventListener('touchstart', onDown, { passive: false });
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
      window.addEventListener('touchcancel', onUp);
    }

    els.close?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeCardOpModal_();
      window.renderDeckList?.();
    });

    document.addEventListener('tab:switched', (e) => {
      const ok = closeCardOpModal_();
      if (ok === false) {
        e.preventDefault?.();
        e.stopPropagation?.();
      }
    });

    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t) return;
      if (t.closest?.('.tab') || t.closest?.('.subtab-bar .tab')) {
        const ok = closeCardOpModal_();
        if (ok === false) { e.preventDefault(); e.stopPropagation(); }
      }
    });

    document.addEventListener('click', (e) => {
      const cell = e.target.closest?.('.deck-entry');
      if (!cell) return;
      if (e.target.closest?.('button, a, input, textarea, select, label')) return;

      const cd = cell.dataset.cd || cell.getAttribute('data-cd');
      if (!cd) return;

      openCardOpModal_(cd, cell.getBoundingClientRect());
    });

    function refreshCardOpControls_() {
      updateCardOpCountBadge_();
      updateCardOpButtons_();
      window.refreshPostSummary?.();
    }

    els.inc?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_cardOpCurrentCd) return;
      window.addCard?.(_cardOpCurrentCd);
      refreshCardOpControls_();
    });

    els.dec?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_cardOpCurrentCd) return;
      removeCardSoft_(_cardOpCurrentCd);
      refreshCardOpControls_();
    });

    els.rep?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_cardOpCurrentCd) return;

      const cd = _cardOpCurrentCd;
      const map = getCardMap_();
      const info = map?.[cd] || {};

      window.setRepresentativeCard?.(cd, info.name || '');

      window.updateDeckSummaryDisplay?.();
      window.updateDeckCardListBackground?.();
      window.updateRepresentativeHighlight?.();
      window.refreshPostSummary?.();

      window.scheduleAutosave?.();
      closeCardOpModal_();
    });

    window.openCardOpModal = window.openCardOpModal || openCardOpModal_;
    window.closeCardOpModal = window.closeCardOpModal || (() => closeCardOpModal_());
    window.updateCardOpCountBadge = window.updateCardOpCountBadge || updateCardOpCountBadge_;
  }

  // =========================
  // 6) デッキリスト描画
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

    // 代表カードがデッキから消えていたらリセット
    const repNow = window.representativeCd || null;
    if (repNow && !deck[repNow]) {
      window.representativeCd = null;
    }

    // 並び替え（タイプ→コスト→パワー→cd）
    entries.sort((a, b) => {
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

    if (emptyMessage) emptyMessage.style.display = entries.length === 0 ? 'flex' : 'none';
    if (entries.length === 0) {
      window.representativeCd = null;
      window.updateDeckSummaryDisplay?.();
      return;
    }

    // 代表カードの整合性確定
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
      badge.textContent = `×${count}`;
      cardEl.appendChild(badge);

      container.appendChild(cardEl);
      window.autoscaleBadgeForCardEl?.(cardEl);
    }

    window.representativeCd = nextRepresentative;

    window.updateDeckSummaryDisplay?.();
    window.updateDeckCardListBackground?.();
    window.updateRepresentativeHighlight?.();
  }
  window.renderDeckList = window.renderDeckList || renderDeckList;

  // =========================
  // 7) デッキ分析（※ここから下はあなたの既存をそのまま続けてOK）
  // =========================

  // ===== デッキ分析更新 =====
  function updateDeckAnalysis() {
    const deck = getDeck_();
    const cardMap = getCardMap_();

  // deck と cardMap からカード詳細を展開
  const deckCards = [];
  Object.entries(deck).forEach(([cdRaw, count]) => {
    const cd5 = normCd5(cdRaw);
    const card = cardMap[cd5] || cardMap[String(cdRaw)];
    if (!card) return;

    const cnt = count | 0;
    for (let i = 0; i < cnt; i++) {
      deckCards.push({
        cd: cd5,
        race: card.race,
        type: card.type,
        category: card.category,
        cost: parseInt(card.cost, 10) || 0,
        power: parseInt(card.power, 10) || 0,
        rarity: card.rarity || ''
      });
    }
  });

    // レアリティ集計
    const rarityCounts = { 'レジェンド': 0, 'ゴールド': 0, 'シルバー': 0, 'ブロンズ': 0 };
    deckCards.forEach(c => {
      if (Object.prototype.hasOwnProperty.call(rarityCounts, c.rarity)) rarityCounts[c.rarity]++;
    });

    // 1行表示（🌈 / 🟡 / ⚪️ / 🟤）
    const raritySummary = document.getElementById('rarity-summary');
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

    function isCostFreeBySpecialSummon(c) {
      return c?.type === 'アタッカー'
        && c?.category === 'ロスリス'
        && Number(c?.cost) === 66;
    }

    // ✅ コスト分布だけ：66ロスリスアタッカーを除外
    const excludedLosslis66Atk = deckCards.filter(isCostFreeBySpecialSummon).length;
    const deckCardsForCostChart = deckCards.filter(c => !isCostFreeBySpecialSummon(c));

    // 1) 分布を集計
    const costCount = {};
    const powerCount = {};

    deckCardsForCostChart.forEach(c => {
      const v = Number(c.cost);
      if (!Number.isNaN(v)) costCount[v] = (costCount[v] || 0) + 1;
    });

    deckCards.forEach(c => {
      const v = Number(c.power);
      if (!Number.isNaN(v)) powerCount[v] = (powerCount[v] || 0) + 1;
    });

    // 2) ラベル（空バーも出す）
    const alwaysShowCosts  = [0, 2, 4, 6, 8, 10, 12];
    const alwaysShowPowers = [4, 5, 6, 7, 8, 10, 14, 16];

    const costLabels = [...new Set([...alwaysShowCosts, ...Object.keys(costCount).map(Number)])].sort((a, b) => a - b);
    const powerLabels = [...new Set([...alwaysShowPowers, ...Object.keys(powerCount).map(Number)])].sort((a, b) => a - b);

    // 3) 総コスト表示
    const sumCost = deckCards.reduce((sum, c) => {
      if (isCostFreeBySpecialSummon(c)) return sum;
      return sum + (Number(c.cost) || 0);
    }, 0);

    const sumCostEl = document.getElementById('total-cost');
    if (sumCostEl) sumCostEl.textContent = String(sumCost);

    const costSummary = document.getElementById('cost-summary-deckmaker');
    if (costSummary) costSummary.innerHTML = `<span class="stat-chip">総コスト ${sumCost}</span>`;

    // タイプ別総パワー + 平均チャージ量
    let chargerPower = 0;
    let attackerPower = 0;

    let chargerChargeSum = 0;
    let chargerChargeCnt = 0;

    deckCards.forEach(c => {
      if (c.type === 'チャージャー') {
        const p = (c.power || 0);
        const cost = (c.cost || 0);

        chargerPower += p;

        const charge = p - cost;
        if (charge > 0) {
          chargerChargeSum += charge;
          chargerChargeCnt += 1;
        }
      }
      if (c.type === 'アタッカー') {
        attackerPower += (c.power || 0);
      }
    });

    const avgChargeEl = document.getElementById('avg-charge');
    if (avgChargeEl) {
      const avg = chargerChargeCnt > 0 ? (chargerChargeSum / chargerChargeCnt) : null;
      avgChargeEl.textContent = avg !== null ? avg.toFixed(2) : '-';
    }

    // ✅ マナ効率（30109除外）
    const EXCLUDE_MANA_COST_CDS = new Set(['30109']);

    const sumCostForMana = deckCards.reduce((sum, c) => {
      if (isCostFreeBySpecialSummon(c)) return sum;

      const cd5 = String(c.cd ?? '').padStart(5, '0');
      if (EXCLUDE_MANA_COST_CDS.has(cd5)) return sum;

      return sum + (Number(c.cost) || 0);
    }, 0);

    const manaEffEl = document.getElementById('mana-efficiency');
    if (manaEffEl) {
      const BASE_MANA = 4;
      const totalMana = chargerPower + BASE_MANA;

      const manaEff = (sumCostForMana > 0) ? (totalMana / sumCostForMana) : null;

      let label = '';
      if (manaEff === null) label = '';
      else if (manaEff > 1.5) label = 'マナ過剰';
      else if (manaEff > 1) label = '適正';
      else label = 'マナ不足';

      if (manaEff !== null) {
        manaEffEl.textContent = `${manaEff.toFixed(2)}${label ? `（${label}）` : ''}`;
      } else {
        manaEffEl.textContent = '-';
      }

      manaEffEl.className = 'mana-eff';
      if (manaEff !== null) {
        if (manaEff > 1.1) manaEffEl.classList.add('mana-good');
        else if (manaEff > 0.9) manaEffEl.classList.add('mana-ok');
        else manaEffEl.classList.add('mana-bad');
      }
    }

    const sumPowerEl = document.getElementById('total-power');
    if (sumPowerEl) sumPowerEl.textContent = '';

    const powerSummary = document.getElementById('power-summary-deckmaker');
    if (powerSummary) {
      powerSummary.innerHTML = `
        <span class="type-chip" data-type="チャージャー">チャージャー ${chargerPower}</span>
        <span class="type-chip" data-type="アタッカー">アタッカー ${attackerPower}</span>
      `;
    }

    // ===== グラフ描画（Chart が無い/Canvas が無いなら安全にスキップ）=====
    const ChartCtor = window.Chart;
    if (!ChartCtor) {
      // Chart 未ロードでも他表示は出す
      window.updateAutoTags?.();
      if (typeof window.refreshPostSummary === 'function') window.refreshPostSummary();
      return;
    }

    // datalabels は任意
    try { ChartCtor.register(window.ChartDataLabels); } catch (_) {}

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
        if (!Number.isNaN(v) && table[t] && (v in table[t])) table[t][v]++;
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

    const costDatasets  = buildStackCounts(deckCardsForCostChart, 'cost',  costLabels);
    const powerDatasets = buildStackCounts(deckCards,            'power', powerLabels);

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false, drawBorder: false }, ticks: { autoSkip: false } },
        y: { stacked: true, beginAtZero: true, grid: { display: false, drawBorder: false }, ticks: { display: false } }
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'center',
          align: 'center',
          formatter: v => v > 0 ? v : '',
          font: { weight: 600 },
          clamp: true
        },
        tooltip: { enabled: true },
      },
    };

    if (costChart)  costChart.destroy();
    if (powerChart) powerChart.destroy();

    const costCtx  = document.getElementById('costChart-deckmaker')?.getContext('2d');
    const powerCtx = document.getElementById('powerChart-deckmaker')?.getContext('2d');

    if (costCtx) {
      costChart = new ChartCtor(costCtx, {
        type: 'bar',
        data: { labels: costLabels, datasets: costDatasets },
        options: commonOptions
      });
    }

    // ✅ 66ロスリスアタッカー注記
    const costCanvas = document.getElementById('costChart-deckmaker');
    if (costCanvas) {
      const parent = costCanvas.parentElement;
      let noteEl = parent?.querySelector?.('.chart-note');

      if (!noteEl) {
        noteEl = document.createElement('div');
        noteEl.className = 'chart-note';
        parent?.appendChild(noteEl);
      }
      noteEl.textContent = (excludedLosslis66Atk > 0)
        ? `※66ロスリスアタッカー（${excludedLosslis66Atk}枚）は除く`
        : '';
    }

    if (powerCtx) {
      powerChart = new ChartCtor(powerCtx, {
        type: 'bar',
        data: { labels: powerLabels, datasets: powerDatasets },
        options: commonOptions
      });
    }

    // 自動タグ（UIがある時だけ）
    window.updateAutoTags?.();

    // 投稿サマリー更新
    if (typeof window.refreshPostSummary === 'function') window.refreshPostSummary();
  }

  // 代表カードデッキ情報表示
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
  function installDeckPeekObserver_() {
    const { btn, pane } = getDeckPeekEls_();
    if (!btn || !pane) return;
    const list = document.getElementById('deck-card-list');
    const modal = document.getElementById('noteFullModal');
    if (!list) return;

    const updateVisibility = (visibleEntry) => {
      const visible = !!visibleEntry?.isIntersecting;
      const modalOpen = modal ? (getComputedStyle(modal).display === 'flex') : false;

      // モバイル && editタブ && deck-card-listが見えてない → 表示
      const show = (isMobile_() && isEditTabOpen_() && !visible) || modalOpen;

      btn.style.display = show ? 'inline-flex' : 'none';
      if (modalOpen) btn.classList.add('onModal'); else btn.classList.remove('onModal');
      if (!show) pane.style.display = 'none';
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

    updateVisibility({ isIntersecting: false });
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
    initCardOpModal_();
    initRepresentativeUi_();
    initDeckPeekAndFloating_();
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