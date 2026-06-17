/**
 * pages/cards/cards-view-mode.js
 * - グリッド表示と一覧表示の切り替えを担当
 * - 一覧行の表示状態をカード本体と同期
 * - 詳細テンプレートを detail-bank に退避・復元
 */

(function () {
  'use strict';

  const VIEW_KEY = 'cards_view_mode';

  function getDetailBank_() {
    let bank = document.getElementById('detail-bank');
    if (!bank) {
      bank = document.createElement('div');
      bank.id = 'detail-bank';
      bank.style.display = 'none';
      document.body.appendChild(bank);
    }
    return bank;
  }

  function syncListRowVisibility_() {
    const grid = document.getElementById('grid');
    if (!grid || !grid.classList.contains('is-list')) return;

    grid.querySelectorAll('.list-row').forEach((row) => {
      const card = row.querySelector('.card');
      if (!card) return;

      const style = getComputedStyle(card);
      row.style.display = (style.display === 'none') ? 'none' : '';
    });
  }

  function moveOwnedEditorToListCard_(row) {
    const card = row?.querySelector(':scope > .card');
    const detail = row?.querySelector(':scope > .card-detail');
    if (!card || !detail) return;

    const editor = detail.querySelector('.owned-editor');
    if (!editor) return;

    let slot = card.querySelector(':scope > .list-owned-editor-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'list-owned-editor-slot';
      card.appendChild(slot);
    }

    slot.appendChild(editor);
  }

  function restoreOwnedEditorFromListCard_(row) {
    const detail = row?.querySelector(':scope > .card-detail');
    const editor = row?.querySelector(':scope > .card .list-owned-editor-slot > .owned-editor');
    if (!detail || !editor) return;

    const target = detail.querySelector('.card-detail-actions-owned')
      || detail.querySelector('.card-detail-actions')
      || detail;

    target.appendChild(editor);

    const slot = row.querySelector(':scope > .card .list-owned-editor-slot');
    if (slot && !slot.children.length) slot.remove();
  }

  function syncListOwnedEditors_(grid) {
    if (!grid) return;
    grid.querySelectorAll('.list-row').forEach(moveOwnedEditorToListCard_);
  }

  function buildListRows_() {
    const grid = document.getElementById('grid');
    if (!grid) return;

    if (grid.querySelector('.list-row')) {
      syncListOwnedEditors_(grid);
      syncListRowVisibility_();
      return;
    }

    const bank = getDetailBank_();
    const cards = Array.from(grid.children).filter((el) => el.classList?.contains('card'));
    const frag = document.createDocumentFragment();

    cards.forEach((cardEl) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.appendChild(cardEl);

      const cd = window.normCd5
        ? window.normCd5(cardEl.dataset.cd)
        : String(cardEl.dataset.cd || '').padStart(5, '0');

      const tpl = bank.querySelector('#detail-' + cd);

      if (tpl) {
        tpl.style.display = '';
        tpl.classList.remove('active');

        try {
          if (!tpl.getAttribute('data-cd')) tpl.setAttribute('data-cd', cd);
          window.CardDetailUI?.attachOwnedEditor?.(tpl, cd);
        } catch (e) {
          console.warn('attachOwnedEditor failed', e);
        }

        row.appendChild(tpl);
        moveOwnedEditorToListCard_(row);
      } else {
        try {
          const m = window.allCardsMap?.[cd] || window.allCardsMap?.[Number(cd)] || null;
          const html = window.CardDetailTemplate?.generate
            ? window.CardDetailTemplate.generate(m || { cd })
            : (typeof window.generateDetailHtml === 'function' ? window.generateDetailHtml(m || { cd }) : '');

          if (html) {
            const tmp = document.createElement('div');
            tmp.innerHTML = html.trim();
            const el = tmp.firstElementChild;

            if (el) {
              el.style.display = '';
              if (!el.getAttribute('data-cd')) el.setAttribute('data-cd', cd);
              try { window.CardDetailUI?.attachOwnedEditor?.(el, cd); } catch {}
              row.appendChild(el);
              moveOwnedEditorToListCard_(row);
            }
          }
        } catch (e) {
          console.warn('detail fallback build failed', e);
        }
      }

      frag.appendChild(row);
    });

    grid.innerHTML = '';
    grid.appendChild(frag);
    syncListRowVisibility_();
  }

  function restoreGrid_() {
    const grid = document.getElementById('grid');
    if (!grid) return;

    const bank = getDetailBank_();
    const rows = Array.from(grid.querySelectorAll('.list-row'));
    if (!rows.length) return;

    const cards = [];

    rows.forEach((row) => {
      const card = row.querySelector('.card');
      if (card) cards.push(card);

      const tpl = row.querySelector('.card-detail[id^="detail-"]');
      if (tpl) {
        restoreOwnedEditorFromListCard_(row);
        tpl.style.display = 'none';
        tpl.classList.remove('active');

        const existed = bank.querySelector('#' + tpl.id);
        if (existed && existed !== tpl) existed.remove();
        bank.appendChild(tpl);
      }
    });

    grid.innerHTML = '';
    cards.forEach((cardEl) => grid.appendChild(cardEl));
  }

  function setActiveBtn_(mode) {
    const root = document.getElementById('viewToggle');
    if (!root) return;

    root.querySelectorAll('.view-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.view === mode);
    });
  }

  function applyViewMode_(mode) {
    const grid = document.getElementById('grid');
    if (!grid) return;

    if (mode === 'list') {
      grid.classList.add('is-list');
      buildListRows_();
    } else {
      grid.classList.remove('is-list');
      restoreGrid_();
    }

    setActiveBtn_(mode);
    try { localStorage.setItem(VIEW_KEY, mode); } catch {}

    if (typeof window.applyFilters === 'function') {
      window.applyFilters();
    }

    try { syncListRowVisibility_(); } catch (_) {}
  }

  function bindViewToggle_() {
    const root = document.getElementById('viewToggle');
    if (!root || root.dataset.viewModeBound === '1') return;

    root.dataset.viewModeBound = '1';
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('.view-btn');
      if (!btn) return;
      applyViewMode_(btn.dataset.view);
    });
  }

  function initCardsViewMode_() {
    bindViewToggle_();

    try { localStorage.setItem(VIEW_KEY, 'grid'); } catch {}
    setActiveBtn_('grid');
  }

  window.addEventListener('DOMContentLoaded', initCardsViewMode_);
  window.addEventListener('card-page:ready', initCardsViewMode_);

  window.applyCardsViewMode = function applyCardsViewMode(mode) {
    let nextMode = mode;
    if (!nextMode) {
      try {
        nextMode = localStorage.getItem(VIEW_KEY) || 'grid';
      } catch {
        nextMode = 'grid';
      }
    }

    applyViewMode_(nextMode);
  };

  window.syncListRowVisibility_ = syncListRowVisibility_;
})();
