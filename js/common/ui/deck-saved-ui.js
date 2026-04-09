/* =========================
 * js/dom/deck-saved-ui.js
 * - 保存デッキUI（一覧描画・クリック委譲・保存/読込/削除）
 *
 * ✅ 重要（移植後の起動方式）
 * deckmaker は loader が「後から」pages JS を読み込むため、
 * DOMContentLoaded を取り逃がすことがある。
 * → loader が dispatch する 'deckmaker-page:ready' を起点に UI を bind/render する。
 * ========================= */
(function () {
  'use strict';

  // ------------------------------
  // 表示（1件のHTML）
  // ------------------------------
  function generateDeckLayout_(deckData, index) {
    let cardImg   = 'img/10001.webp';
    let deckName  = '名称未設定';
    let race      = '未選択';
    let count     = '0/30~40';
    let typeCount = '🔵0🟣0⚪️0';
    let savedDate = '';

    const cardMap = window.cardMap || window.allCardsMap || {};

    if (deckData && deckData.cardCounts) {
      let total = 0, charge = 0, attack = 0, block = 0;

      for (const cd in deckData.cardCounts) {
        const n = deckData.cardCounts[cd] || 0;
        if (n <= 0) continue;
        total += n;

        const info = cardMap[cd];
        if (!info) continue;
        if (info.type === 'チャージャー') charge += n;
        if (info.type === 'アタッカー')  attack += n;
        if (info.type === 'ブロッカー')  block  += n;
      }

      count     = `${total}/30~40`;
      typeCount = `🔵${charge}🟣${attack}⚪️${block}`;
      deckName  = deckData.name || '名称未設定';

      // main race label（あれば）
      try {
        if (typeof window.pickMainRaceFromCounts === 'function') {
          race = window.pickMainRaceFromCounts(deckData.cardCounts) || race;
        } else if (typeof window.getMainRaceNameFromCounts === 'function') {
          race = window.getMainRaceNameFromCounts(deckData.cardCounts) || race;
        }
      } catch {}

      if (deckData.m) {
        cardImg = 'img/' + String(deckData.m).padStart(5, '0') + '.webp';
      }

      savedDate = deckData.date ? deckData.date : '';
    }

    // ✅ onclick ではなく「クリック委譲（data-action）」に統一
    const loadBtn   = `<button data-action="load" data-index="${index}">🔄 読み込む</button>`;
    const deleteBtn = `<button data-action="delete" data-index="${index}">🗑 削除</button>`;

    return `
      <div class="saved-deck-item">
        <img src="${cardImg}" alt="代表カード" />
        <div class="saved-deck-info">
          <div class="row">
            <strong>${escapeHtml_(deckName)}</strong>
            <span>使用種族：${escapeHtml_(race)}</span>
          </div>
          <div class="row">
            <span>${escapeHtml_(count)}</span>
            <span>${escapeHtml_(typeCount)}</span>
          </div>
          ${savedDate ? `<div class="row"><small>保存日時: ${escapeHtml_(savedDate)}</small></div>` : ''}
        </div>
        <div class="deck-buttons">
          ${loadBtn}
          ${deleteBtn}
        </div>
      </div>
    `;
  }

  function escapeHtml_(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ------------------------------
  // 一覧描画
  // ------------------------------
  function renderSavedDeckList_(opts = {}) {
    const key = opts.key || window.SavedDeckStore?.KEY || 'savedDecks';
    const cap = Number.isFinite(+opts.cap) ? (+opts.cap) : 20;

    const container = document.getElementById(opts.containerId || 'savedDeckList');
    const counter   = document.getElementById(opts.counterId || 'savedDeckCount');
    if (!container) return;

    container.innerHTML = '';

    const list = window.SavedDeckStore ? window.SavedDeckStore.list({ key }) : [];

    if (counter) counter.textContent = `保存デッキ数：${list.length} / ${cap}`;

    if (list.length > 0) {
      list.forEach((deckData, i) => {
        container.insertAdjacentHTML('beforeend', generateDeckLayout_(deckData, i));
      });
      return;
    }

    container.insertAdjacentHTML(
      'beforeend',
      `<div class="saved-deck-empty">保存デッキはまだありません</div>`
    );
  }

  // ------------------------------
  // 現在デッキを保存
  // ------------------------------
  function saveCurrentDeck_(opts = {}) {
    const key = opts.key || window.SavedDeckStore?.KEY || 'savedDecks';
    const cap = Number.isFinite(+opts.cap) ? (+opts.cap) : 20;

    if (!window.SavedDeckStore) {
      alert('SavedDeckStore が読み込まれていません');
      return { ok: false, reason: 'no_store' };
    }

    if (!window.deck || Object.keys(window.deck).length === 0) {
      alert('デッキが空です');
      return { ok: false, reason: 'empty_deck' };
    }

    const built = window.SavedDeckStore.buildFromState({
      deck: window.deck,
      representativeCd: window.representativeCd,
      getMainRace: window.getMainRace
    });

    if (!built) {
      alert('デッキが空です');
      return { ok: false, reason: 'empty_deck' };
    }

    const res = window.SavedDeckStore.upsert(built, {
      key,
      cap,
      confirmOverwrite: (name) => confirm(`同名のデッキ「${name}」があります。上書きしますか？`)
    });

    if (!res.ok) {
      if (res.reason === 'cap') alert(`保存できるデッキは${res.cap}件までです`);
      return res;
    }

    // 未入力名の採番が入った場合にUIへ反映（旧page2互換）
    try {
      if (typeof window.writeDeckNameInput === 'function') window.writeDeckNameInput(res.name || built.name);
      if (typeof window.syncDeckNameFields === 'function') window.syncDeckNameFields();
    } catch {}

    renderSavedDeckList_({ key, cap, containerId: opts.containerId, counterId: opts.counterId });
    return res;
  }

  // ------------------------------
  // 読み込み適用（現在デッキへ）
  // ------------------------------
  function applySavedDeckToCurrent_(savedDeck, hooks = {}) {
    if (!savedDeck || !savedDeck.cardCounts) return false;

    // 既存の page 側APIを優先（移植の途中でも壊れにくい）
    const setDeckState =
      hooks.setDeckState ||
      window.setDeckState ||     // ★今回追加
      window.replaceDeck ||
      null;

    if (typeof setDeckState === 'function') {
      setDeckState(savedDeck.cardCounts, { representativeCd: savedDeck.m, mainRaceCode: savedDeck.g });
    } else {
      // 最低限：window.deck を「差し替えず」中身だけ入れ替える（参照維持）
      const tgt = (window.deck && typeof window.deck === 'object') ? window.deck : (window.deck = {});
      Object.keys(tgt).forEach(k => delete tgt[k]);
      for (const [cd, n] of Object.entries(savedDeck.cardCounts || {})) {
        const nn = Number(n) || 0;
        if (nn <= 0) continue;
        tgt[String(cd).padStart(5, '0').slice(0, 5)] = nn;
      }
      window.representativeCd = savedDeck.m || window.representativeCd || null;
    }

    // 再描画系（存在するものだけ）
    try { window.updateDeck?.(); } catch {}
    try { window.updateCardDisabling?.(); } catch {}
    try { window.updateDeckAnalysis?.(); } catch {}
    try { window.updateExchangeSummary?.(); } catch {}

    // 名前も同期（あれば）
    try {
      if (savedDeck.name && typeof window.writeDeckNameInput === 'function') window.writeDeckNameInput(savedDeck.name);
      if (typeof window.syncDeckNameFields === 'function') window.syncDeckNameFields();
    } catch {}

    return true;
  }

  // ------------------------------
  // UI bind（クリック委譲）
  // ------------------------------
  function bindSavedDeckUI_(opts = {}) {
    const containerId = opts.containerId || 'savedDeckList';
    const container = document.getElementById(containerId);
    if (!container) return;

    // 二重bind防止
    if (container.__savedDeckBound) return;
    container.__savedDeckBound = true;

    const key = opts.key || window.SavedDeckStore?.KEY || 'savedDecks';
    const cap = Number.isFinite(+opts.cap) ? (+opts.cap) : 20;

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const action = btn.getAttribute('data-action');
      const index = +btn.getAttribute('data-index');
      if (!Number.isFinite(index)) return;

      if (action === 'load') {
        const data = window.SavedDeckStore.get(index, { key });
        if (!data) return;
        applySavedDeckToCurrent_(data, opts.hooks || {});
        return;
      }

      if (action === 'delete') {
        const ok = confirm('この保存デッキを削除しますか？');
        if (!ok) return;
        window.SavedDeckStore.remove(index, { key });
        renderSavedDeckList_({ key, cap, containerId: opts.containerId, counterId: opts.counterId });
      }
    });

    // 初回描画
    renderSavedDeckList_({ key, cap, containerId: opts.containerId, counterId: opts.counterId });
  }

  // ------------------------------
  // 公開API（互換）
  // ------------------------------
  window.SavedDeckUI = window.SavedDeckUI || {
    render: renderSavedDeckList_,
    bind: bindSavedDeckUI_,
    saveCurrent: saveCurrentDeck_,
    applyToCurrent: applySavedDeckToCurrent_
  };

  // page2 互換 API（残しておくと移植が楽）
  window.updateSavedDeckList ??= function (opts = {}) {
    return window.SavedDeckUI.render(opts);
  };
  window.saveDeckToLocalStorage ??= function (opts = {}) {
    // 保存ボタンが onclick="saveDeckToLocalStorage()" のままでも動く
    return window.SavedDeckUI.saveCurrent(opts);
  };
  window.loadDeckFromIndex ??= function (index, opts = {}) {
    const key = opts.key || window.SavedDeckStore?.KEY || 'savedDecks';
    const data = window.SavedDeckStore?.get?.(+index, { key });
    if (!data) return false;
    return window.SavedDeckUI.applyToCurrent(data, opts.hooks || {});
  };
  window.deleteDeckFromIndex ??= function (index, opts = {}) {
    const key = opts.key || window.SavedDeckStore?.KEY || 'savedDecks';
    window.SavedDeckStore?.remove?.(+index, { key });

    const cap = Number.isFinite(+opts.cap) ? (+opts.cap) : 20;
    window.SavedDeckUI.render({ key, cap, containerId: opts.containerId, counterId: opts.counterId });

    try { window.renderDeckList?.(); } catch {}
    return true;
  };

  // ------------------------------
  // ✅ 自動起動：loader の ready 合図で bind/render
  // ------------------------------
  function boot_() {
    try { window.SavedDeckUI.bind(); } catch (e) { console.warn(e); }
    try { window.SavedDeckUI.render(); } catch (e) { console.warn(e); }
  }

  // loader のイベント（最優先）
  window.addEventListener('deckmaker-page:ready', boot_, { once: true });

  // onDeckmakerReady が使える場合も拾う（loaderが提供）
  if (typeof window.onDeckmakerReady === 'function') {
    window.onDeckmakerReady(boot_);
  }

  // 念のため DOM 直後でも一回
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot_, 0), { once: true });
  } else {
    setTimeout(boot_, 0);
  }

})();