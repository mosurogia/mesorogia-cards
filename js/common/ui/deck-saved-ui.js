/* =========================
 * js/common/ui/deck-saved-ui.js
 * - 保存デッキUI（一覧描画・クリック委譲・保存/読込/削除）
 *
 * ✅ 重要（移植後の起動方式）
 * deckmaker は loader が「後から」pages JS を読み込むため、
 * DOMContentLoaded を取り逃がすことがある。
 * → loader が dispatch する 'deckmaker-page:ready' を起点に UI を bind/render する。
 * ========================= */
(function () {
  'use strict';

  const escapeHtml_ = window.escapeHtml_;
  const MAIN_RACES_ = ['ドラゴン', 'アンドロイド', 'エレメンタル', 'ルミナス', 'シェイド'];
  const RACE_BY_CODE_ = {
    1: 'ドラゴン',
    2: 'アンドロイド',
    3: 'エレメンタル',
    4: 'ルミナス',
    5: 'シェイド'
  };

  function getSavedDeckMainRace_(deckData, cardMap) {
    const cardCounts = deckData?.cardCounts || {};
    const races = Object.keys(cardCounts)
      .map(cd => cardMap[cd]?.race)
      .filter(r => MAIN_RACES_.includes(r));
    const uniqueRaces = [...new Set(races)];

    if (uniqueRaces.length > 0) return uniqueRaces[0];

    const raceByCode = RACE_BY_CODE_[Number(deckData?.g)];
    return raceByCode || '';
  }

  function validateDeckCodeLight_(raw) {
    const s = String(raw || '').trim();
    if (!s) return { ok: false, reason: '空文字' };
    if (s.length < 60) return { ok: false, reason: '短すぎ' };
    if (s.length > 400) return { ok: false, reason: '長すぎ' };
    if (/\s/.test(s)) return { ok: false, reason: '空白/改行を含む' };
    if (/https?:\/\//i.test(s)) return { ok: false, reason: 'URL形式' };
    if (/^[A-Za-z]{20,}$/.test(s)) return { ok: false, reason: '英字のみの単語' };
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return { ok: false, reason: '文字種/末尾が不正' };

    const padLen = (s.match(/=+$/) || [''])[0].length;
    if (padLen > 2) return { ok: false, reason: 'パディング異常' };
    const coreLen = s.replace(/=+$/, '').length;
    if (coreLen % 4 === 1) return { ok: false, reason: '長さ整合×' };

    const hasLower = /[a-z]/.test(s);
    const hasUpper = /[A-Z]/.test(s);
    const hasDigit = /\d/.test(s);
    const hasMark = /[+/_-]/.test(s);
    const mixedCnt = [hasLower, hasUpper, hasDigit, hasMark].filter(Boolean).length;
    if (mixedCnt < 3) return { ok: false, reason: '多様性不足' };

    const digitCount = (s.match(/\d/g) || []).length;
    if (digitCount < 6) return { ok: false, reason: '数字が少なすぎ' };

    return { ok: true, reason: '' };
  }

  async function copyText_(text) {
    const value = String(text || '');
    if (!value) return false;

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {}
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    } finally {
      textarea.remove();
    }

    return ok;
  }

  function showDeckCodeCopyToast_() {
    const message = 'デッキコードをコピーしました';

    if (typeof window.dmToast === 'function') {
      window.dmToast(message);
      return;
    }

    if (typeof window.showMiniToast_ === 'function') {
      window.showMiniToast_(message);
      return;
    }

    let toast = document.getElementById('saved-deck-code-copy-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'saved-deck-code-copy-toast';
      toast.className = 'dm-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('show');
    }, 1800);
  }

  function updateSavedDeckShareCode_(index, code, opts = {}) {
    if (isSavedDeckInteractionLocked_()) return false;
    const key = opts.key || window.SavedDeckStore?.KEY || 'savedDecks';
    const list = window.SavedDeckStore?.list?.({ key }) || [];
    if (!list[index]) return false;

    list[index] = { ...list[index], shareCode: String(code || '').trim() };
    return !!window.SavedDeckStore?.replaceAll?.(list, { key });
  }

  function isSavedDeckInteractionLocked_() {
    const sync = window.AccountSavedDecksSync || window.AccountAppDataSync;
    if (!sync) return false;
    try {
      if (typeof sync.isReady === 'function' && !sync.isReady()) return true;
      const status = sync.getStatus?.() || {};
      return !!(status.syncing || status.state === 'syncing');
    } catch {
      return false;
    }
  }

  function showSavedDeckSyncLocked_() {
    alert('アカウントデータを確認中です。同期完了後に操作してください。');
  }

  function buildPeekEntries_(deckData) {
    const entries = Object.entries(deckData?.cardCounts || {})
      .map(([code, count]) => ({ code, count: Number(count) || 0 }))
      .filter(item => item.count > 0);

    if (typeof window.sortCardEntries === 'function') {
      try {
        return window.sortCardEntries(
          entries.map(item => [item.code, item.count]),
          window.cardMap || window.allCardsMap || {}
        ).map(([code, count]) => ({ code, count: Number(count) || 0 }));
      } catch {}
    }

    return entries;
  }

  function ensureSavedDeckPeekOverlay_() {
    let overlay = document.getElementById('saved-deckpeek-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'saved-deckpeek-overlay';
    overlay.innerHTML = `
      <div class="saved-deckpeek-inner">
        <div class="deckpeek-grid saved-deckpeek-grid"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function hideSavedDeckPeek_() {
    const overlay = document.getElementById('saved-deckpeek-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.style.left = '';
    overlay.style.top = '';
  }

  function showSavedDeckPeek_(deckData, thumbEl) {
    const overlay = ensureSavedDeckPeekOverlay_();
    const grid = overlay.querySelector('.saved-deckpeek-grid');
    if (!grid) return;

    const items = buildPeekEntries_(deckData);
    if (window.DeckPeekCommon?.renderGrid) {
      window.DeckPeekCommon.renderGrid(grid, items, { emptyText: 'デッキが空です' });
    } else {
      grid.innerHTML = '';
      items.forEach((item) => {
        const code = window.normCd5 ? window.normCd5(item.code) : String(item.code || '').padStart(5, '0');
        const card = document.createElement('div');
        card.className = 'deckpeek-card';
        card.innerHTML = `
          <img src="img/${code}.webp" alt="">
          <div class="count-badge">x${Number(item.count) || 1}</div>
        `;
        grid.appendChild(card);
      });
    }

    overlay.style.display = 'block';

    const rect = thumbEl?.getBoundingClientRect?.();
    const margin = 8;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const availableRight = rect ? (viewportWidth - rect.right - margin - 8) : (viewportWidth - margin * 2);
    const availableLeft = rect ? (rect.left - margin - 8) : 0;
    const bestSideWidth = Math.max(availableRight, availableLeft);
    const preferredWidth = Math.min(360, Math.max(200, bestSideWidth));
    overlay.style.width = `${preferredWidth}px`;

    const overlayWidth = overlay.offsetWidth || preferredWidth;
    const overlayHeight = overlay.offsetHeight || 0;

    let left = rect ? rect.right + margin : margin;
    let top = rect ? rect.top : margin;

    if (rect && availableRight >= overlayWidth) {
      left = rect.right + margin;
    } else if (rect && availableLeft >= overlayWidth) {
      left = rect.left - overlayWidth - margin;
    } else if (rect && availableRight >= availableLeft) {
      left = rect.right + margin;
      overlay.style.width = `${Math.max(200, availableRight)}px`;
    } else if (rect) {
      left = Math.max(margin, rect.left - Math.max(200, availableLeft) - margin);
      overlay.style.width = `${Math.max(200, availableLeft)}px`;
    } else if (left + overlayWidth > viewportWidth - margin) {
      left = viewportWidth - overlayWidth - margin;
    }
    if (left < margin) left = margin;

    if (top + overlayHeight > viewportHeight - margin) {
      top = viewportHeight - overlayHeight - margin;
    }
    if (top < margin) top = margin;

    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
  }

  function getSavedDeckSourceSafe_() {
    let status = null;
    try {
      status = window.AccountSavedDecksSync?.getStatus?.() || null;
    } catch {}

    const isAccount = status?.source === 'account' || status?.state === 'account';
    const isSaving = status?.syncing || status?.state === 'syncing';
    const isError = status?.state === 'error';
    const rawMessage = String(status?.message || '').trim();
    const message = rawMessage.replace(/^保存デッキ:\s*/, '');
    const label = isSaving
      ? 'アカウント確認中'
      : (isError ? (message || '連携失敗') : (isAccount ? 'アカウント連携中' : (message || 'ローカル保存')));
    const type = isAccount ? 'account' : isSaving ? 'syncing' : isError ? 'error' : 'local';
    const localUpdatedAt = type === 'local' ? (window.SavedDeckStore?.getUpdatedAt?.() || '') : '';
    return { type, label, lastSync: status?.lastSync || localUpdatedAt };
  }

  function formatSourceUpdatedAt_(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
    }

    const normalized = raw.replace(/-/g, '/');
    const match = normalized.match(/^(\d{4})\/0?(\d{1,2})\/0?(\d{1,2})/);
    return match ? `${match[1]}/${Number(match[2])}/${Number(match[3])}` : raw;
  }

  function ensureSavedDeckHeaderLayout_() {
    const header = document.getElementById('saved-deck');
    if (!header) return null;

    let top = header.querySelector('.saved-deck-head-top');
    if (!top) {
      top = document.createElement('div');
      top.className = 'saved-deck-head-top';
      header.insertBefore(top, header.firstChild);
    }

    let meta = header.querySelector('.saved-deck-head-meta');
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'saved-deck-head-meta';
      header.appendChild(meta);
    }

    const title = header.querySelector('.saved-deck-title');
    if (title && title.parentElement !== top) top.insertBefore(title, top.firstChild);

    const counter = document.getElementById('savedDeckCount');
    if (counter && counter.parentElement !== top) top.appendChild(counter);

    return { header, top, meta };
  }

  function ensureSavedDeckSourceEl_() {
    let el = document.getElementById('savedDeckSource');
    if (el) return el;

    const layout = ensureSavedDeckHeaderLayout_();
    const meta = layout?.meta;
    if (!meta) return null;

    el = document.createElement('span');
    el.id = 'savedDeckSource';
    el.className = 'saved-deck-source data-source-badge';
    meta.appendChild(el);
    return el;
  }

  function ensureSavedDeckAuthActionsEl_() {
    let el = document.getElementById('savedDeckAuthActions');
    if (el) return el;

    const layout = ensureSavedDeckHeaderLayout_();
    const meta = layout?.meta || document.querySelector('#saved-deck .saved-deck-head-meta');
    if (!meta) return null;

    el = document.createElement('div');
    el.id = 'savedDeckAuthActions';
    el.className = 'cards-auth-actions saved-deck-auth-actions data-source-auth-actions';
    el.innerHTML = `
      <button type="button" class="cards-auth-btn primary" data-open="authLoginModal" data-auth-entry="login">ログイン</button>
      <button type="button" class="cards-auth-btn" data-open="authLoginModal" data-auth-entry="signup">新規登録</button>
    `;
    meta.insertBefore(el, meta.firstChild);
    return el;
  }

  function ensureSavedDeckAccountSettingsEl_() {
    let el = document.getElementById('savedDeckAccountSettingsBtn');
    if (el) return el;

    const layout = ensureSavedDeckHeaderLayout_();
    const meta = layout?.meta || document.querySelector('#saved-deck .saved-deck-head-meta');
    if (!meta) return null;

    el = document.createElement('button');
    el.id = 'savedDeckAccountSettingsBtn';
    el.type = 'button';
    el.className = 'btn danger saved-deck-account-settings-btn';
    el.dataset.open = 'accountDataModal';
    el.dataset.accountScope = 'deckmaker';
    el.innerHTML = `
      <span>アカウント設定</span>
    `;
    window.AccountDataManager?.refreshLabels?.();

    const source = document.getElementById('savedDeckSource');
    if (source && source.parentElement === meta) meta.insertBefore(el, source);
    else meta.appendChild(el);
    return el;
  }

  function ensureSavedDeckMatchLinkEl_() {
    let el = document.getElementById('savedDeckMatchLink');
    if (el) return el;

    const layout = ensureSavedDeckHeaderLayout_();
    const meta = layout?.meta || document.querySelector('#saved-deck .saved-deck-head-meta');
    if (!meta) return null;

    el = document.createElement('span');
    el.id = 'savedDeckMatchLink';
    el.className = 'saved-deck-match-link';
    meta.appendChild(el);
    return el;
  }

  function renderSavedDeckMatchLink_() {
    const el = ensureSavedDeckMatchLinkEl_();
    if (!el) return;

    const auth = window.Auth || {};
    const loggedIn = !!(auth.token && auth.user && auth.verified);
    if (loggedIn) {
      el.innerHTML = '<a class="saved-deck-match-link-btn" href="match-results.html">戦績ページへ</a>';
      return;
    }

    el.innerHTML = '<button type="button" class="saved-deck-match-link-btn" disabled title="ログイン後に出せます">戦績ページへ</button>';
  }

  function renderSavedDeckAuthActions_() {
    const el = ensureSavedDeckAuthActionsEl_();
    if (!el) return;

    const auth = window.Auth || {};
    const loggedIn = !!(auth.token && auth.user);
    el.style.display = loggedIn ? 'none' : '';
  }

  function renderSavedDeckAccountSettings_() {
    const el = ensureSavedDeckAccountSettingsEl_();
    if (!el) return;

    const auth = window.Auth || {};
    const loggedIn = !!(auth.token && auth.user && auth.verified);
    el.style.display = loggedIn ? 'inline-flex' : 'none';
  }

  function renderSavedDeckSource_() {
    const el = ensureSavedDeckSourceEl_();
    if (!el) return;

    const source = getSavedDeckSourceSafe_();
    el.dataset.source = source.type;
    el.classList.remove('is-account', 'is-local', 'is-syncing', 'is-error');
    el.classList.add(`is-${source.type}`);
    const updatedAt = formatSourceUpdatedAt_(source.lastSync);
    el.title = updatedAt ? `最終更新:${updatedAt}` : `保存デッキ: ${source.label}`;
    if (source.type === 'local') {
      el.dataset.tooltip = 'デッキはブラウザに保存されます。キャッシュを削除するとデータが消えるのでご注意ください。';
      el.dataset.tooltip = 'デッキはブラウザに保存されます。\nキャッシュを削除するとデータが消えるのでご注意ください。';
      el.tabIndex = 0;
    } else {
      delete el.dataset.tooltip;
      el.removeAttribute('tabindex');
    }
    el.innerHTML = `
      <span class="saved-deck-source-text">${escapeHtml_(source.label)}</span>
    `;
    renderSavedDeckAuthActions_();
    renderSavedDeckAccountSettings_();
    renderSavedDeckMatchLink_();
  }

  // ------------------------------
  // 表示（1件のHTML）
  // ------------------------------
  function generateDeckLayout_(deckData, index) {
    let cardImg   = 'img/10001.webp';
    let deckName  = '名称未設定';
    let count     = 'デッキ0枚';
    let typeCount = `
      <span class="saved-deck-type-row">
        <span class="type-chip" data-type="チャージャー">チャージャー 0枚</span>
        <span class="type-chip" data-type="アタッカー">アタッカー 0枚</span>
        <span class="type-chip" data-type="ブロッカー">ブロッカー 0枚</span>
      </span>
    `;
    let savedDate = '';

    const cardMap = window.cardMap || window.allCardsMap || {};
    const mainRace = getSavedDeckMainRace_(deckData, cardMap);
    const raceClass = mainRace ? ` race-bg-${mainRace}` : '';

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

      count     = `デッキ${total}枚`;
      typeCount = `
        <span class="saved-deck-type-row">
          <span class="type-chip" data-type="チャージャー">チャージャー ${charge}枚</span>
          <span class="type-chip" data-type="アタッカー">アタッカー ${attack}枚</span>
          <span class="type-chip" data-type="ブロッカー">ブロッカー ${block}枚</span>
        </span>
      `;
      deckName  = deckData.name || '名称未設定';

      if (deckData.m) {
        const cd5 = window.normCd5 ? window.normCd5(deckData.m) : String(deckData.m).padStart(5, '0');
        cardImg = 'img/' + (cd5 || '00000') + '.webp';
      }

      savedDate = deckData.date ? deckData.date : '';
    }

    // ✅ onclick ではなく「クリック委譲（data-action）」に統一
    const loadBtn   = `<button type="button" class="saved-deck-action saved-deck-action-load" data-action="load" data-index="${index}">デッキ呼び出し</button>`;
    const codeBtn   = `<button type="button" class="saved-deck-action saved-deck-action-code" data-action="paste-code" data-index="${index}">デッキコード貼り付け</button>`;
    const deleteBtn = `<button type="button" class="saved-deck-action saved-deck-action-delete" data-action="delete" data-index="${index}">デッキ削除</button>`;
    const shareCode = String(deckData?.shareCode || '').trim();
    const codePreview = shareCode ? `${shareCode.slice(0, 5)}...` : '';
    const codeCopyTitle = shareCode
      ? 'デッキコードをコピーします'
      : 'デッキコードを貼り付けるとここからコピーできます';
    const codeStatus = `
      <span class="saved-deck-code-copy ${shareCode ? 'has-code' : 'is-empty'}" data-tooltip="${escapeHtml_(codeCopyTitle)}">
        <span class="saved-deck-code-label">${shareCode ? `コード:${escapeHtml_(codePreview)}` : 'デッキコードなし'}</span>
        <button type="button" class="saved-deck-code-copy-btn" data-action="copy-code" data-index="${index}" ${shareCode ? '' : 'disabled'}>コピー</button>
      </span>
    `;

    return `
      <div class="saved-deck-item${raceClass}">
        <div class="saved-deck-main">
          <button type="button" class="saved-deck-thumb" data-action="peek" data-index="${index}" aria-label="${escapeHtml_(deckName)}のデッキリストを表示">
            <img src="${cardImg}" alt="代表カード" />
            <span class="saved-deck-thumb-peek" aria-hidden="true">🔎</span>
          </button>
          <div class="saved-deck-info">
            <div class="row saved-deck-title-row">
              <strong>${escapeHtml_(deckName)}</strong>
              <span class="saved-deck-number">No.${index + 1}</span>
            </div>
            ${savedDate ? `<div class="row"><small>${escapeHtml_(savedDate)}</small></div>` : ''}
            <div class="deck-buttons">
              <div class="deck-buttons-top">${codeBtn}</div>
              <div class="deck-buttons-bottom">
                ${loadBtn}
                ${deleteBtn}
              </div>
            </div>
          </div>
        </div>
        <div class="saved-deck-summary" aria-label="デッキ枚数とタイプ別枚数">
          <div class="saved-deck-summary-head">
            <span class="saved-deck-count-label">${escapeHtml_(count)}</span>
            ${codeStatus}
          </div>
          <div class="saved-deck-type-box">
            ${typeCount}
          </div>
        </div>
      </div>
    `;
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
    renderSavedDeckSource_();

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

    if (isSavedDeckInteractionLocked_()) {
      showSavedDeckSyncLocked_();
      return { ok: false, reason: 'syncing' };
    }

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
    window.MesorogiaPwaInstall?.showNudge?.();
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
        tgt[window.normCd5 ? window.normCd5(cd) : String(cd).padStart(5, '0').slice(0, 5)] = nn;
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

      if (action === 'peek') {
        const data = window.SavedDeckStore.get(index, { key });
        if (!data) return;
        const thumb = btn.closest('.saved-deck-thumb') || btn;
        const overlay = document.getElementById('saved-deckpeek-overlay');
        const isSameOpen = overlay?.style.display === 'block' && overlay.dataset.index === String(index);
        if (isSameOpen) {
          hideSavedDeckPeek_();
          return;
        }

        showSavedDeckPeek_(data, thumb);
        const nextOverlay = document.getElementById('saved-deckpeek-overlay');
        if (nextOverlay) nextOverlay.dataset.index = String(index);
        return;
      }

      if (action === 'paste-code') {
        if (isSavedDeckInteractionLocked_()) {
          showSavedDeckSyncLocked_();
          return;
        }

        if (!navigator.clipboard?.readText) {
          alert('クリップボードを読み取れません。ブラウザ設定を確認してください');
          return;
        }

        navigator.clipboard.readText().then((text) => {
          const code = String(text || '').trim();
          if (!code) {
            alert('クリップボードが空です');
            return;
          }

          const result = validateDeckCodeLight_(code);
          if (!result.ok) {
            alert(`貼り付けた文字列はデッキコードではなさそうです。\n理由: ${result.reason || '形式不一致'}`);
            return;
          }

          if (!updateSavedDeckShareCode_(index, code, { key })) {
            alert('デッキコードを保存できませんでした');
            return;
          }

          renderSavedDeckList_({ key, cap, containerId: opts.containerId, counterId: opts.counterId });
        }).catch((err) => {
          console.error(err);
          alert('デッキコードの貼り付けに失敗しました（権限やブラウザ設定をご確認ください）');
        });
        return;
      }

      if (action === 'copy-code') {
        const data = window.SavedDeckStore.get(index, { key });
        const code = String(data?.shareCode || '').trim();
        if (!code) {
          alert('コピーできるデッキコードがありません');
          return;
        }

        copyText_(code).then((ok) => {
          if (!ok) {
            alert('デッキコードをコピーできませんでした');
            return;
          }

          const prevText = btn.textContent;
          btn.textContent = 'コピー済み';
          setTimeout(() => { btn.textContent = prevText; }, 1200);
          showDeckCodeCopyToast_();
        });
        return;
      }

      if (action === 'delete') {
        if (isSavedDeckInteractionLocked_()) {
          showSavedDeckSyncLocked_();
          return;
        }

        const ok = confirm('この保存デッキを削除しますか？');
        if (!ok) return;
        const res = window.SavedDeckStore.remove(index, { key });
        if (res?.reason === 'syncing') {
          showSavedDeckSyncLocked_();
          return;
        }
        renderSavedDeckList_({ key, cap, containerId: opts.containerId, counterId: opts.counterId });
      }
    });

    document.addEventListener('click', (e) => {
      const accountBtn = e.target.closest('#savedDeckAccountSettingsBtn');
      if (accountBtn) {
        window.openAccountDataModal?.({ scope: accountBtn.dataset.accountScope || 'deckmaker' });
        return;
      }

      const authBtn = e.target.closest('#savedDeckAuthActions [data-auth-entry]');
      if (!authBtn) return;

      const mode = authBtn.getAttribute('data-auth-entry') || 'login';
      if (typeof window.openAuthModal === 'function') {
        window.openAuthModal(mode);
        return;
      }

      const modal = document.getElementById('authLoginModal');
      if (modal) modal.style.display = 'flex';
    });

    document.addEventListener('click', (e) => {
      const overlay = document.getElementById('saved-deckpeek-overlay');
      if (!overlay || overlay.style.display !== 'block') return;
      if (e.target.closest('#saved-deckpeek-overlay')) return;
      if (e.target.closest('#savedDeckList .saved-deck-thumb')) return;
      hideSavedDeckPeek_();
    });

    window.addEventListener('scroll', hideSavedDeckPeek_, { passive: true });
    window.addEventListener('resize', hideSavedDeckPeek_);
    window.addEventListener('account-owned-sync:status', () => {
      renderSavedDeckAuthActions_();
      renderSavedDeckAccountSettings_();
    });
    window.addEventListener('saved-decks:status', renderSavedDeckSource_);
    window.addEventListener('saved-decks:data-replaced', renderSavedDeckSource_);

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
    if (isSavedDeckInteractionLocked_()) {
      showSavedDeckSyncLocked_();
      return false;
    }

    const key = opts.key || window.SavedDeckStore?.KEY || 'savedDecks';
    const res = window.SavedDeckStore?.remove?.(+index, { key });
    if (res?.reason === 'syncing') {
      showSavedDeckSyncLocked_();
      return false;
    }

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
