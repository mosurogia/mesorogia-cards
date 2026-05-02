/* =========================
 * 保存デッキ戦績UI
 * - デッキ保管庫から戦績登録・簡易集計を開く
 * ========================= */
(function () {
  'use strict';

  const MODAL_ID = 'deckMatchResultsModal';

  function escapeHtml_(value) {
    if (typeof window.escapeHtml_ === 'function') return window.escapeHtml_(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function isLoggedIn_() {
    const Auth = window.Auth;
    return !!(Auth?.user && Auth?.token && Auth?.verified);
  }

  function pad2_(n) {
    return String(n).padStart(2, '0');
  }

  function formatNow_() {
    const d = new Date();
    return `${d.getFullYear()}/${pad2_(d.getMonth() + 1)}/${pad2_(d.getDate())} ${pad2_(d.getHours())}:${pad2_(d.getMinutes())}:${pad2_(d.getSeconds())}`;
  }

  function ensureModal_() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal deck-match-modal-root';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal-content deck-match-modal" role="dialog" aria-modal="true" aria-labelledby="deckMatchTitle">
        <button type="button" class="modal-close-x deck-match-close" aria-label="閉じる">×</button>
        <h3 id="deckMatchTitle" class="filter-maintitle">戦績管理</h3>
        <div class="deck-match-target" data-role="target"></div>
        <div class="deck-match-summary" data-role="summary" aria-live="polite">戦績を読み込み中...</div>
        <form class="deck-match-form" data-role="form">
          <label>
            <span>対戦日時</span>
            <input type="text" name="playedAt" placeholder="2026/03/14 16:38:14" autocomplete="off">
          </label>
          <label>
            <span>勝敗</span>
            <select name="result">
              <option value="win">win</option>
              <option value="lose">lose</option>
            </select>
          </label>
          <label>
            <span>対面デッキ</span>
            <input type="text" name="opponentDeck" maxlength="80" autocomplete="off" required>
          </label>
          <label>
            <span>レート</span>
            <input type="text" name="rating" inputmode="numeric" maxlength="5" pattern="\\d{5}" placeholder="12345" autocomplete="off" required>
          </label>
          <label>
            <span>優先権</span>
            <select name="priority">
              <option value="self">self</option>
              <option value="opponent">opponent</option>
            </select>
          </label>
          <label class="deck-match-field-wide">
            <span>メモ</span>
            <textarea name="memo" rows="4" maxlength="1000" placeholder="試合内容を数行で記録"></textarea>
          </label>
          <div class="deck-match-status" data-role="status" aria-live="polite"></div>
          <div class="modal-footer deck-match-actions">
            <button type="button" class="modal-buttun deck-match-cancel">閉じる</button>
            <button type="submit" class="modal-buttun deck-match-submit">登録</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (event) => {
      if (
        event.target === modal ||
        event.target.closest('.deck-match-close') ||
        event.target.closest('.deck-match-cancel')
      ) {
        closeModal_();
      }
    });

    modal.querySelector('[data-role="form"]')?.addEventListener('submit', submitMatch_);
    return modal;
  }

  function getActiveDeck_() {
    const modal = ensureModal_();
    const index = Number(modal.dataset.deckIndex);
    if (!Number.isFinite(index)) return null;
    return window.SavedDeckStore?.get?.(index) || null;
  }

  function setStatus_(message, isError = false) {
    const status = ensureModal_().querySelector('[data-role="status"]');
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('is-error', !!isError);
  }

  async function refreshSummary_() {
    const modal = ensureModal_();
    const summary = modal.querySelector('[data-role="summary"]');
    const deck = getActiveDeck_();
    if (!summary || !deck?.id) return;

    summary.textContent = '戦績を読み込み中...';
    const res = await window.AccountMatchResults?.summary?.({ deckId: deck.id, limit: 1000 });
    if (!res?.ok) {
      summary.textContent = '戦績を読み込めませんでした';
      return;
    }

    const rate = Math.round((Number(res.winRate || 0) * 1000)) / 10;
    summary.innerHTML = `
      <div><strong>${Number(res.wins || 0)}勝 ${Number(res.losses || 0)}敗</strong> / ${Number(res.total || 0)}戦</div>
      <div>勝率 ${Number.isFinite(rate) ? rate : 0}%</div>
    `;
  }

  function openModal_(index) {
    if (!isLoggedIn_()) {
      alert('戦績管理はログインが必要です');
      const authModal = document.getElementById('authLoginModal');
      if (authModal) authModal.style.display = 'flex';
      return;
    }

    const deck = window.SavedDeckStore?.get?.(index);
    if (!deck?.id) {
      alert('保存デッキIDを確認できませんでした');
      return;
    }

    const modal = ensureModal_();
    modal.dataset.deckIndex = String(index);
    modal.dataset.deckId = deck.id;

    const target = modal.querySelector('[data-role="target"]');
    if (target) {
      target.innerHTML = `<strong>${escapeHtml_(deck.name || '名称未設定')}</strong><span>ID: ${escapeHtml_(deck.id)}</span>`;
    }

    const form = modal.querySelector('[data-role="form"]');
    if (form) {
      form.reset();
      form.elements.playedAt.value = formatNow_();
    }

    setStatus_('');
    modal.style.display = 'flex';
    refreshSummary_().catch(() => {
      const summary = modal.querySelector('[data-role="summary"]');
      if (summary) summary.textContent = '戦績を読み込めませんでした';
    });
  }

  function closeModal_() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
  }

  async function submitMatch_(event) {
    event.preventDefault();
    const deck = getActiveDeck_();
    if (!deck?.id) return;

    const form = event.currentTarget;
    const submit = form.querySelector('.deck-match-submit');
    const payload = {
      deckId: deck.id,
      playedAt: form.elements.playedAt.value,
      result: form.elements.result.value,
      opponentDeck: form.elements.opponentDeck.value,
      rating: form.elements.rating.value,
      priority: form.elements.priority.value,
      memo: form.elements.memo.value,
    };

    setStatus_('登録中...');
    if (submit) submit.disabled = true;
    try {
      const res = await window.AccountMatchResults?.add?.(payload);
      if (!res?.ok) {
        setStatus_(res?.error || '登録に失敗しました', true);
        return;
      }
      setStatus_('登録しました');
      form.elements.opponentDeck.value = '';
      form.elements.memo.value = '';
      form.elements.playedAt.value = formatNow_();
      await refreshSummary_();
    } catch (e) {
      setStatus_(e?.message || '登録に失敗しました', true);
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function decorateSavedDeckList_() {
    // デッキ保管庫では戦績ボタンを表示しない。
  }

  function bind_() {
    if (bind_._bound) return;
    bind_._bound = true;

    document.addEventListener('click', (event) => {
      const btn = event.target?.closest?.('#savedDeckList button[data-action="match"]');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      openModal_(Number(btn.dataset.index));
    }, true);

    const render = window.SavedDeckUI?.render;
    if (typeof render === 'function' && !render.__matchDecorated) {
      const wrapped = function () {
        const result = render.apply(this, arguments);
        setTimeout(decorateSavedDeckList_, 0);
        return result;
      };
      wrapped.__matchDecorated = true;
      window.SavedDeckUI.render = wrapped;
    }

    decorateSavedDeckList_();
  }

  window.DeckMatchResultsUI = window.DeckMatchResultsUI || {
    bind: bind_,
    open: openModal_,
    refreshButtons: decorateSavedDeckList_,
  };

  window.addEventListener('deckmaker-page:ready', bind_);
  window.addEventListener('saved-decks:data-replaced', () => setTimeout(decorateSavedDeckList_, 0));
  window.addEventListener('DOMContentLoaded', () => setTimeout(bind_, 0), { once: true });
  if (document.readyState !== 'loading') setTimeout(bind_, 0);
})();
