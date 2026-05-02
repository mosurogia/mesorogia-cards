/* =========================
 * js/pages/deck-post/deck-post-modals.js
 * - デッキ投稿ページの汎用モーダル管理
 * - ヘルプモーダル
 * - 削除確認モーダル
 * - トースト表示
 * ========================= */
(function () {
  'use strict';

  // =========================
  // 0) 共通
  // =========================

  function openModalById_(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
  }

  function closeModalById_(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function bindBackdropClose_(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal || modal.dataset.backdropBound === '1') return;

    modal.dataset.backdropBound = '1';
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModalById_(modalId);
    });
  }

  // =========================
  // 1) マイ投稿：説明モーダル
  // =========================

  function openMineHelp() {
    openModalById_('mineHelpModal');
  }

  function closeMineHelp() {
    closeModalById_('mineHelpModal');
  }

  function bindMineHelpModal_() {
    const btn = document.getElementById('mineHelpBtn');
    const closeBtn = document.getElementById('mineHelpCloseBtn');
    const modal = document.getElementById('mineHelpModal');

    if (btn && !btn.dataset.boundMineHelp) {
      btn.dataset.boundMineHelp = '1';
      btn.addEventListener('click', openMineHelp);
    }

    if (closeBtn && !closeBtn.dataset.boundMineHelpClose) {
      closeBtn.dataset.boundMineHelpClose = '1';
      closeBtn.addEventListener('click', closeMineHelp);
    }

    if (modal) bindBackdropClose_('mineHelpModal');
  }

  // =========================
  // 2) マナ効率ヘルプモーダル
  // =========================

  function openManaHelp() {
    openModalById_('manaHelpModal');
  }

  function closeManaHelp() {
    closeModalById_('manaHelpModal');
  }

  function bindManaHelpModal_() {
    const modal = document.getElementById('manaHelpModal');
    const closeBtn = document.getElementById('mana-help-close');

    if (closeBtn && !closeBtn.dataset.boundManaHelpClose) {
      closeBtn.dataset.boundManaHelpClose = '1';
      closeBtn.addEventListener('click', closeManaHelp);
    }

    if (modal) bindBackdropClose_('manaHelpModal');

    if (!document.body.dataset.boundManaHelpOpen) {
      document.body.dataset.boundManaHelpOpen = '1';

      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.help-button');
        if (!btn) return;

        const label = String(btn.getAttribute('aria-label') || '');
        if (!label.includes('マナ効率')) return;

        e.preventDefault();
        openManaHelp();
      });
    }
  }

  // =========================
  // 3) 削除確認モーダル
  // =========================

  function ensureDeleteConfirmModal_() {
    if (document.getElementById('deleteConfirmModal')) return;

    const wrap = document.createElement('div');
    wrap.id = 'deleteConfirmModal';
    wrap.className = 'account-modal';
    wrap.style.display = 'none';

    wrap.innerHTML = `
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="deleteConfirmTitle">
        <div class="account-modal-head">
          <h3 id="deleteConfirmTitle">投稿の削除確認</h3>
          <button type="button" class="account-close" data-close="deleteConfirmModal" aria-label="閉じる">×</button>
        </div>

        <div class="account-modal-body">
          <p id="deleteConfirmText" style="margin:0; line-height:1.6;"></p>
          <p style="margin:.6rem 0 0; color:#b00020; font-weight:700;">
            ※ 削除すると元に戻せません
          </p>
        </div>

        <div class="account-modal-footer">
          <button type="button" class="btn ghost" data-delete-cancel>キャンセル</button>
          <button type="button" class="btn danger" data-delete-ok>削除する</button>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);

    bindBackdropClose_('deleteConfirmModal');

    wrap.querySelector('[data-close="deleteConfirmModal"]')
      ?.addEventListener('click', closeDeleteModal_);

    wrap.querySelector('[data-delete-cancel]')
      ?.addEventListener('click', closeDeleteModal_);
  }

  function openDeleteModal_(text) {
    ensureDeleteConfirmModal_();

    const modal = document.getElementById('deleteConfirmModal');
    const textEl = document.getElementById('deleteConfirmText');

    if (textEl) textEl.textContent = String(text || '');
    if (modal) modal.style.display = 'flex';
  }

  function closeDeleteModal_() {
    closeModalById_('deleteConfirmModal');
  }

  function confirmDeleteByModal_(text) {
    ensureDeleteConfirmModal_();
    openDeleteModal_(text);

    return new Promise((resolve) => {
      const modal = document.getElementById('deleteConfirmModal');
      if (!modal) {
        resolve(false);
        return;
      }

      const okBtn = modal.querySelector('[data-delete-ok]');
      const cancelBtn = modal.querySelector('[data-delete-cancel]');
      const closeBtn = modal.querySelector('[data-close="deleteConfirmModal"]');

      const cleanup = () => {
        okBtn?.removeEventListener('click', onOk);
        cancelBtn?.removeEventListener('click', onCancel);
        closeBtn?.removeEventListener('click', onCancel);
        closeDeleteModal_();
      };

      const onOk = () => {
        cleanup();
        resolve(true);
      };

      const onCancel = () => {
        cleanup();
        resolve(false);
      };

      okBtn?.addEventListener('click', onOk);
      cancelBtn?.addEventListener('click', onCancel);
      closeBtn?.addEventListener('click', onCancel);
    });
  }

  // =========================
  // 4) トースト
  // =========================

  function showMiniToast_(text) {
    let toast = document.getElementById('mini-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mini-toast';
      toast.style.position = 'fixed';
      toast.style.left = '50%';
      toast.style.bottom = '18px';
      toast.style.transform = 'translateX(-50%)';
      toast.style.padding = '10px 14px';
      toast.style.borderRadius = '999px';
      toast.style.background = 'rgba(17,24,39,.92)';
      toast.style.color = '#fff';
      toast.style.fontSize = '.9rem';
      toast.style.zIndex = '9999';
      toast.style.opacity = '0';
      toast.style.transition = 'opacity .18s ease';
      document.body.appendChild(toast);
    }

    toast.textContent = String(text || '');
    toast.style.opacity = '1';

    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.style.opacity = '0';
    }, 1400);
  }

  function showActionToast(message) {
    let toast = document.getElementById('action-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'action-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = String(message || '');
    toast.classList.add('is-visible');

    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 1800);
  }

  // =========================
  // 5) Esc 閉じる
  // =========================

  function bindEscClose_() {
    if (document.body.dataset.boundDeckPostModalEsc === '1') return;
    document.body.dataset.boundDeckPostModalEsc = '1';

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;

      closeMineHelp();
      closeManaHelp();
      closeDeleteModal_();
    });
  }

  // =========================
  // 6) 初期化
  // =========================

  function initDeckPostModals() {
    bindMineHelpModal_();
    bindManaHelpModal_();
    ensureDeleteConfirmModal_();
    bindEscClose_();
  }

  // =========================
  // 7) 公開API
  // =========================

  window.DeckPostModals = window.DeckPostModals || {
    init: initDeckPostModals,
    openMineHelp,
    closeMineHelp,
    openManaHelp,
    closeManaHelp,
    ensureDeleteConfirmModal_,
    openDeleteModal_,
    closeDeleteModal_,
    confirmDeleteByModal_,
    showMiniToast_,
    showActionToast,
  };

  // 旧互換
  window.openMineHelp = window.openMineHelp || openMineHelp;
  window.closeMineHelp = window.closeMineHelp || closeMineHelp;
  window.ensureDeleteConfirmModal_ = window.ensureDeleteConfirmModal_ || ensureDeleteConfirmModal_;
  window.openDeleteModal_ = window.openDeleteModal_ || openDeleteModal_;
  window.closeDeleteModal_ = window.closeDeleteModal_ || closeDeleteModal_;
  window.confirmDeleteByModal_ = window.confirmDeleteByModal_ || confirmDeleteByModal_;
  window.showMiniToast_ = window.showMiniToast_ || showMiniToast_;
  window.showActionToast = window.showActionToast || showActionToast;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDeckPostModals, { once: true });
  } else {
    initDeckPostModals();
  }
})();