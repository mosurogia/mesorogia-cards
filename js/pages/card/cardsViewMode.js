/**
 * pages/card/cardsViewMode.js
 * - グリッド ⇔ リスト表示切替（図鑑ページ専用でOK）
 * - リスト行の表示/非表示を .card の display と同期
 * - detailテンプレ (#detail-xxxxx) を #detail-bank に退避/復元
 */

(function () {
  const VIEW_KEY = 'cards_view_mode'; // localStorage key

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

  grid.querySelectorAll('.list-row').forEach(row => {
    const card = row.querySelector('.card');
    if (!card) return;
    const style = getComputedStyle(card);
    row.style.display = (style.display === 'none') ? 'none' : '';
  });
}

function buildListRows_() {
  const grid = document.getElementById('grid');
  if (!grid) return;

  // ✅ 二重生成防止
  if (grid.querySelector('.list-row')) {
    syncListRowVisibility_();
    return;
  }

  const bank = getDetailBank_();

  // ✅ 元の card-list.js と同じ：grid直下の .card だけ拾う
  const cards = Array.from(grid.children).filter(el => el.classList?.contains('card'));
  const frag = document.createDocumentFragment();

  cards.forEach(cardEl => {
    const row = document.createElement('div');
    row.className = 'list-row';

    // 左：カード（直置き）
    row.appendChild(cardEl);

    // 右：詳細（bankから持ってきて直置き）
    const cd = String(cardEl.dataset.cd || '').padStart(5, '0');
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

    } else {
      // ✅ 保険：bankに無い場合はその場で生成（読み込み順/生成漏れ対策）
      try {
        const m = window.allCardsMap?.[cd] || window.allCardsMap?.[Number(cd)] || null;
        const html =
          window.CardDetailTemplate?.generate
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

  rows.forEach(row => {
    // card を回収
    const c = row.querySelector('.card');
    if (c) cards.push(c);

    // detail を bank に戻す（gridに戻さない）
    const tpl = row.querySelector('.card-detail[id^="detail-"]');
    if (tpl) {
      tpl.style.display = 'none';      // gridでは隠す（テンプレ待機）
      tpl.classList.remove('active');
      // ✅ 同IDが既に bank にあるなら差し替え（重複防止）
      const existed = bank.querySelector('#' + tpl.id);
      if (existed && existed !== tpl) existed.remove();
      bank.appendChild(tpl);
    }
  });

  grid.innerHTML = '';
  cards.forEach(cardEl => grid.appendChild(cardEl));
}


  function setActiveBtn_(mode) {
    const root = document.getElementById('viewToggle');
    if (!root) return;
    root.querySelectorAll('.view-btn').forEach(btn => {
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
    if (!root) return;

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('.view-btn');
      if (!btn) return;
      applyViewMode_(btn.dataset.view);
    });
  }

// 初期表示設定
function initCardsViewMode_() {
  bindViewToggle_();

  // ✅ 常にgridを初期値にする（再読込でカード表示固定）
  try { localStorage.setItem(VIEW_KEY, 'grid'); } catch {}
  setActiveBtn_('grid');

  // ✅ カード生成後に前回モードを反映したいなら（任意）
  // window.applyCardsViewMode();
}

// loader経由でも確実に動くように両対応
window.addEventListener('DOMContentLoaded', initCardsViewMode_);
window.addEventListener('card-page:ready', initCardsViewMode_);


  // ✅ 外から「カード生成後」に呼べる
  window.applyCardsViewMode = function (mode) {
    if (!mode) {
      try { mode = localStorage.getItem(VIEW_KEY) || 'grid'; } catch { mode = 'grid'; }
    }
    applyViewMode_(mode);
  };
  window.syncListRowVisibility_ = syncListRowVisibility_;
})();
