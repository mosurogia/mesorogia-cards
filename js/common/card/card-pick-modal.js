/**
 * js/common/card/card-pick-modal.js
 * - ページ共通のカード選択モーダル
 * - window.openCardPickModal({ onPicked }) でカードを選ばせる
 */
(function () {
  'use strict';

  if (window.openCardPickModal && window.closeCardPickModal) return;

  let cardPickOnPicked_ = null;
  const cardPickFilters_ = {
    type: '',
    category: '',
    pack: '',
  };

  function escHtml_(value) {
    if (typeof window.escapeHtml_ === 'function') return window.escapeHtml_(value);
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normCd5_(cd) {
    if (typeof window.normCd5 === 'function') return window.normCd5(cd);
    const s = String(cd ?? '').trim();
    return s ? s.padStart(5, '0').slice(0, 5) : '';
  }

  function getCardPackLabel_(card) {
    const raw = String(card?.packName ?? card?.pack_name ?? card?.pack ?? '').trim();
    if (!raw) return '';

    if (typeof window.splitPackName === 'function') {
      const parts = window.splitPackName(raw);
      return String(parts?.en || parts?.jp || raw).trim();
    }

    return raw;
  }

  function filterLabel_(key, value) {
    if (!value) return '';
    return value;
  }

  function makeTypeButtonHtml_(type, img, alt, active) {
    return `
      <button type="button" class="type-icon-btn${active ? ' is-active' : ''}" data-card-pick-type="${escHtml_(type)}" data-type="${escHtml_(type)}">
        <img src="${escHtml_(img)}" alt="${escHtml_(alt)}">
      </button>
    `;
  }

  function ensureFilterUi_(modalEl) {
    if (!modalEl || document.getElementById('cardPickFilters')) return;

    const queryEl = modalEl.querySelector('#cardPickQuery');
    const resultEl = modalEl.querySelector('#cardPickResult');
    if (!queryEl || !resultEl) return;

    const panel = document.createElement('div');
    panel.id = 'cardPickFilters';
    panel.className = 'card-pick-filters';
    panel.innerHTML = `
      <div class="type-quick-filter card-pick-type-filter" aria-label="タイプで絞り込み">
        ${makeTypeButtonHtml_('', 'img/type-all.webp', 'All', true)}
        ${makeTypeButtonHtml_('チャージャー', 'img/type-charger.webp', 'Charger', false)}
        ${makeTypeButtonHtml_('アタッカー', 'img/type-attacker.webp', 'Attacker', false)}
        ${makeTypeButtonHtml_('ブロッカー', 'img/type-blocker.webp', 'Blocker', false)}
      </div>

      <div class="card-pick-folder-row">
        <details class="card-pick-folder" id="cardPickCategoryFolder" data-card-pick-folder="category">
          <summary>カテゴリ</summary>
          <div class="card-pick-option-list" id="cardPickCategoryOptions"></div>
        </details>
        <details class="card-pick-folder" id="cardPickPackFolder" data-card-pick-folder="pack">
          <summary>パック</summary>
          <div class="card-pick-option-list" id="cardPickPackOptions"></div>
        </details>
      </div>

      <div id="cardPickActiveChips" class="card-pick-chips" style="display:none;"></div>
    `;

    resultEl.parentNode.insertBefore(panel, resultEl);
  }

  function ensureModal_() {
    let modalEl = document.getElementById('cardPickModal');
    if (modalEl) {
      ensureFilterUi_(modalEl);
      return modalEl;
    }

    modalEl = document.createElement('div');
    modalEl.id = 'cardPickModal';
    modalEl.className = 'modal';
    modalEl.style.display = 'none';
    modalEl.innerHTML = `
      <div class="modal-content card-pick-modal" role="dialog" aria-modal="true" aria-labelledby="cardPickTitle">
        <div class="card-pick-head">
          <h3 id="cardPickTitle" class="filter-maintitle">カードを選択</h3>
          <button type="button" id="cardPickCloseBtn" class="modal-buttun">閉じる</button>
        </div>

        <input id="cardPickQuery" class="ctrl-input" style="width: 100%;" type="text" placeholder="カード名で検索（入力で即絞り込み）" autocomplete="off">

        <div id="cardPickResult" class="card-pick-result"></div>
      </div>
    `;
    document.body.appendChild(modalEl);
    ensureFilterUi_(modalEl);
    return modalEl;
  }

  async function ensureCardNameIndexLoaded_() {
    await window.ensureCardMapLoaded?.();

    const map = window.cardMap || window.allCardsMap || {};
    window.__cardNameIndex = Object.values(map)
      .map((card) => {
        const cd5 = normCd5_(card.cd);
        const name = String(card.name || '').trim();
        return cd5 && name ? {
          cd5,
          name,
          type: String(card.type || '').trim(),
          category: String(card.category || '').trim(),
          pack: getCardPackLabel_(card),
        } : null;
      })
      .filter(Boolean);

    if (typeof window.searchCardsByName !== 'function') {
      window.searchCardsByName = function searchCardsByName(query, limit = 120, filters = {}) {
        const q = String(query || '').trim().toLowerCase();
        const rows = Array.isArray(window.__cardNameIndex) ? window.__cardNameIndex : [];
        const type = String(filters.type || '').trim();
        const category = String(filters.category || '').trim();
        const pack = String(filters.pack || '').trim();

        const filtered = rows.filter((row) => {
          if (q && !String(row.name || '').toLowerCase().includes(q)) return false;
          if (type && String(row.type || '') !== type) return false;
          if (category && String(row.category || '') !== category) return false;
          if (pack && String(row.pack || '') !== pack) return false;
          return true;
        });

        return filtered
          .slice()
          .sort((a, b) => {
            const cdA = normCd5_(a.cd5 || a.cd);
            const cdB = normCd5_(b.cd5 || b.cd);
            const cardA = (window.cardMap || {})[cdA] || { cd: cdA, type: '', cost: 0, power: 0 };
            const cardB = (window.cardMap || {})[cdB] || { cd: cdB, type: '', cost: 0, power: 0 };
            return window.compareCards?.(cardA, cardB) || cdA.localeCompare(cdB, 'ja');
          })
          .slice(0, limit);
      };
    }

    return window.__cardNameIndex;
  }

  function renderCardPickFilterOptions_() {
    const rows = Array.isArray(window.__cardNameIndex) ? window.__cardNameIndex : [];
    const categoryEl = document.getElementById('cardPickCategoryOptions');
    const packEl = document.getElementById('cardPickPackOptions');

    function filterOptionAttrs_(key, value) {
      if (key === 'pack') return ` data-pack="${escHtml_(value)}"`;
      if (key === 'category') {
        const race = typeof window.getCategoryRace === 'function'
          ? window.getCategoryRace(value)
          : '';
        return ` data-cat-race="${escHtml_(race || 'none')}"`;
      }
      return '';
    }

    function fillOptions(el, values, key) {
      if (!el) return;
      const current = cardPickFilters_[key];
      const buttons = values.map((value) => `
        <button type="button" class="card-pick-option is-ring${value === current ? ' is-active' : ''}" data-card-pick-filter="${escHtml_(key)}" data-value="${escHtml_(value)}"${filterOptionAttrs_(key, value)}>
          ${escHtml_(value)}
        </button>
      `);
      el.innerHTML = buttons.length
        ? buttons.join('')
        : '<div class="card-pick-option-empty">選択できる項目がありません</div>';
    }

    const categories = [...new Set(rows.map(row => row.category).filter(Boolean))]
      .sort((a, b) => {
        const orderA = typeof window.getCategoryOrder === 'function' ? window.getCategoryOrder(a) : 9999;
        const orderB = typeof window.getCategoryOrder === 'function' ? window.getCategoryOrder(b) : 9999;
        if (orderA !== orderB) return orderA - orderB;
        return a.localeCompare(b, 'ja');
      });
    const packs = [...new Set(rows.map(row => row.pack).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ja'));

    fillOptions(categoryEl, categories, 'category');
    fillOptions(packEl, packs, 'pack');
  }

  function renderCardPickChips_() {
    const chipsEl = document.getElementById('cardPickActiveChips');
    if (!chipsEl) return;

    const chips = Object.entries(cardPickFilters_)
      .filter(([key]) => key !== 'type')
      .filter(([, value]) => String(value || '').trim())
      .map(([key, value]) => ({ key, value, label: filterLabel_(key, value) }));

    chipsEl.style.display = chips.length ? '' : 'none';
    chipsEl.innerHTML = chips.map((chip) => `
      <button type="button" class="chip-mini" data-card-pick-chip="${escHtml_(chip.key)}">
        ${escHtml_(chip.label)}<span class="x" aria-hidden="true">×</span>
      </button>
    `).join('');
  }

  function syncCardPickFilterUi_() {
    document.querySelectorAll('[data-card-pick-type]').forEach((btn) => {
      const active = String(btn.dataset.cardPickType || '') === cardPickFilters_.type;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    document.querySelectorAll('[data-card-pick-filter]').forEach((btn) => {
      const key = btn.dataset.cardPickFilter;
      const active = String(btn.dataset.value || '') === String(cardPickFilters_[key] || '');
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    document.querySelectorAll('.card-pick-folder').forEach((folder) => {
      const key = folder.dataset.cardPickFolder || '';
      folder.classList.toggle('is-active', !!cardPickFilters_[key]);
    });

    renderCardPickChips_();
  }

  function resetCardPickFilters_() {
    cardPickFilters_.type = '';
    cardPickFilters_.category = '';
    cardPickFilters_.pack = '';
    syncCardPickFilterUi_();
  }

  function renderCardPickResult_(query) {
    const resultEl = document.getElementById('cardPickResult');
    if (!resultEl) return;

    const q = String(query || '');
    const rows = window.searchCardsByName?.(q, q.trim() ? 120 : 999999, cardPickFilters_) || [];

    if (!rows.length) {
      resultEl.innerHTML = '<div class="card-pick-empty">一致するカードがありません</div>';
      return;
    }

    resultEl.innerHTML = rows.map((row) => {
      const cd5 = normCd5_(row.cd5 || row.cd);
      const card = (window.cardMap || window.allCardsMap || {})[cd5] || {};
      const name = String(row.name || card.name || '').trim();

      return `
        <button type="button" class="card-pick-item" data-cd="${escHtml_(cd5)}" data-name="${escHtml_(name)}" title="${escHtml_(name)}">
          <img
            class="card-pick-img"
            src="img/${escHtml_(cd5)}.webp"
            alt="${escHtml_(name)}"
            loading="lazy"
            onerror="this.onerror=null;this.src='img/00000.webp';"
          >
        </button>
      `;
    }).join('');
  }

  function closeCardPickModal() {
    const modalEl = document.getElementById('cardPickModal');
    if (modalEl) modalEl.style.display = 'none';

    cardPickOnPicked_ = null;

    const resultEl = document.getElementById('cardPickResult');
    if (resultEl) resultEl.replaceChildren();
  }

  function bindCardPickUi_() {
    const modalEl = ensureModal_();
    const closeBtnEl = document.getElementById('cardPickCloseBtn');
    const queryEl = document.getElementById('cardPickQuery');
    const resultEl = document.getElementById('cardPickResult');

    if (closeBtnEl && !closeBtnEl.dataset.wiredCommonCardPickClose) {
      closeBtnEl.dataset.wiredCommonCardPickClose = '1';
      closeBtnEl.addEventListener('click', closeCardPickModal);
    }

    if (modalEl && !modalEl.dataset.wiredCommonCardPickBackdrop) {
      modalEl.dataset.wiredCommonCardPickBackdrop = '1';
      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) closeCardPickModal();
      });
    }

    if (queryEl && !queryEl.dataset.wiredCommonCardPickInput) {
      queryEl.dataset.wiredCommonCardPickInput = '1';
      queryEl.addEventListener('input', () => {
        renderCardPickResult_(queryEl.value);
      });
    }

    if (modalEl && !modalEl.dataset.wiredCommonCardPickFilters) {
      modalEl.dataset.wiredCommonCardPickFilters = '1';
      modalEl.addEventListener('click', (e) => {
        const typeBtn = e.target.closest('[data-card-pick-type]');
        if (typeBtn) {
          cardPickFilters_.type = String(typeBtn.dataset.cardPickType || '').trim();
          document.querySelectorAll('[data-card-pick-type]').forEach((btn) => {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-pressed', 'false');
          });
          typeBtn.classList.add('is-active');
          typeBtn.setAttribute('aria-pressed', 'true');
          syncCardPickFilterUi_();
          renderCardPickResult_(queryEl?.value || '');
          return;
        }

        const filterBtn = e.target.closest('[data-card-pick-filter]');
        if (filterBtn) {
          const key = filterBtn.dataset.cardPickFilter;
          if (!Object.prototype.hasOwnProperty.call(cardPickFilters_, key)) return;
          const value = String(filterBtn.dataset.value || '').trim();
          cardPickFilters_[key] = cardPickFilters_[key] === value ? '' : value;
          filterBtn.closest('.card-pick-folder')?.removeAttribute('open');
          syncCardPickFilterUi_();
          renderCardPickResult_(queryEl?.value || '');
          return;
        }

        const chipBtn = e.target.closest('[data-card-pick-chip]');
        if (chipBtn) {
          const key = chipBtn.dataset.cardPickChip;
          if (!Object.prototype.hasOwnProperty.call(cardPickFilters_, key)) return;
          cardPickFilters_[key] = '';
          syncCardPickFilterUi_();
          renderCardPickResult_(queryEl?.value || '');
        }
      });
    }

    document.querySelectorAll('.card-pick-folder').forEach((folder) => {
      if (folder.dataset.wiredCardPickFolderToggle) return;
      folder.dataset.wiredCardPickFolderToggle = '1';
      folder.addEventListener('toggle', () => {
        if (!folder.open) return;
        document.querySelectorAll('.card-pick-folder[open]').forEach((other) => {
          if (other !== folder) other.removeAttribute('open');
        });
      });
    });

    if (resultEl && !resultEl.dataset.wiredCommonCardPickResult) {
      resultEl.dataset.wiredCommonCardPickResult = '1';
      resultEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.card-pick-item');
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        const cd = String(btn.dataset.cd || '').trim();
        const name = String(btn.dataset.name || '').trim();
        if (!cd && !name) return;

        cardPickOnPicked_?.({ cd, name });
        closeCardPickModal();
      }, true);
    }

    if (!document.body.dataset.wiredCommonCardPickEsc) {
      document.body.dataset.wiredCommonCardPickEsc = '1';
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;

        const cardModalEl = document.getElementById('cardPickModal');
        if (cardModalEl && cardModalEl.style.display !== 'none' && cardModalEl.style.display !== '') {
          closeCardPickModal();
        }
      });
    }
  }

  function openCardPickModal(opts) {
    if (typeof opts === 'function') opts = { onPicked: opts };

    cardPickOnPicked_ = typeof opts?.onPicked === 'function'
      ? opts.onPicked
      : null;

    const modalEl = ensureModal_();
    bindCardPickUi_();

    const queryEl = document.getElementById('cardPickQuery');
    const resultEl = document.getElementById('cardPickResult');
    if (!modalEl || !queryEl || !resultEl) return;

    modalEl.style.display = 'flex';
    queryEl.value = '';
    resetCardPickFilters_();
    resultEl.innerHTML = '<div class="card-pick-empty">カードを読み込み中です</div>';

    Promise.resolve(ensureCardNameIndexLoaded_()).then(() => {
      renderCardPickFilterOptions_();
      syncCardPickFilterUi_();
      renderCardPickResult_('');
    });

    setTimeout(() => queryEl.focus(), 0);
  }

  window.openCardPickModal = openCardPickModal;
  window.closeCardPickModal = closeCardPickModal;
})();
