/* =========================
 * js/common/account/account-data-manager.js
 * - アカウント設定モーダル内のアプリデータ表示/リセット
 * - appDataGet / appDataSave を対象キー単位で呼び出す
 * ========================= */
(function () {
  'use strict';

  const API = window.API || window.AUTH_API_BASE || window.GAS_API_BASE;
  const Auth = window.Auth;
  const postJSON = window.postJSON;

  const EMPTY_CARD_GROUPS = { groups: {}, order: [], sys: {} };
  const RESET_PAYLOADS = {
    cardGroups: { cardGroups: EMPTY_CARD_GROUPS },
    ownedCards: { ownedCards: {} },
    savedDecks: { savedDecks: [] },
  };
  const SCOPE_TO_SECTION = {
    all: 'account',
    account: 'account',
    post: 'post',
    postStats: 'post',
    cardGroups: 'cardGroups',
    ownedCards: 'ownedCards',
    savedDecks: 'savedDecks',
    matchResults: 'matchResults',
  };
  const SCOPE_SECTIONS = {
    all: ['account', 'post', 'cardGroups', 'ownedCards', 'savedDecks', 'matchResults'],
    cards: ['account', 'cardGroups', 'ownedCards'],
    deckmaker: ['account', 'post', 'savedDecks'],
    deckPost: ['account', 'post'],
    matchResults: ['account', 'matchResults'],
  };

  const SCOPE_TITLES = {
    all: 'アカウント設定',
    cards: '図鑑設定',
    deckmaker: 'デッキメーカー設定',
    deckPost: 'デッキ投稿設定',
    matchResults: '戦績設定',
  };
  const APP_SETTINGS_TITLE = 'アプリ設定';

  let lastAppData = null;
  let bound = false;
  let scrollSpyBound = false;
  let scrollSpyTicking = false;
  let labelObserver = null;

  function isLoggedIn_() {
    return !!(Auth?.user && Auth?.token && Auth?.verified);
  }

  function isAppDataSyncing_() {
    const syncs = [
      window.AccountAppDataSync,
      window.AccountOwnedSync,
      window.AccountCardGroupsSync,
      window.AccountSavedDecksSync,
    ];
    return syncs.some((sync) => {
      try {
        if (!sync) return false;
        if (typeof sync.isReady === 'function' && !sync.isReady()) return true;
        const status = sync.getStatus?.() || {};
        return !!(status.syncing || status.state === 'syncing');
      } catch (_) {
        return false;
      }
    });
  }

  function isStandaloneApp_() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator.standalone === true ||
      document.body?.classList?.contains('is-pwa-standalone');
  }

  function getScopeTitle_(scope) {
    if (isStandaloneApp_()) return APP_SETTINGS_TITLE;
    return SCOPE_TITLES[scope] || SCOPE_TITLES.all;
  }

  function setButtonLabel_(selector, text) {
    document.querySelectorAll(selector).forEach((el) => {
      if (el.textContent !== text) el.textContent = text;
    });
  }

  function refreshLabels() {
    const label = isStandaloneApp_() ? APP_SETTINGS_TITLE : SCOPE_TITLES.all;
    setButtonLabel_('.checker-account-settings-label-full', label);
    setButtonLabel_('#match-account-settings-btn', label);
    setButtonLabel_('#cg-account-settings-btn', label);
    setButtonLabel_('#savedDeckAccountSettingsBtn span', label);
    setButtonLabel_('[data-header-action="account"]', label);

    const modal = document.getElementById('accountDataModal');
    const title = document.getElementById('accountModalTitle');
    if (modal?.style?.display === 'flex' && title) {
      const titleText = getScopeTitle_(modal.dataset.accountScope || 'all');
      if (title.textContent !== titleText) title.textContent = titleText;
    }

    const chips = document.querySelector('#accountDataModal .account-jump-chips');
    if (chips) {
      const ariaLabel = `${label}メニュー`;
      if (chips.getAttribute('aria-label') !== ariaLabel) {
        chips.setAttribute('aria-label', ariaLabel);
      }
    }
  }

  function bindLabelRefresh_() {
    if (labelObserver) return;
    labelObserver = new MutationObserver(() => refreshLabels());
    labelObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', refreshLabels);
    window.addEventListener('DOMContentLoaded', refreshLabels);
    window.addEventListener('load', refreshLabels);
  }

  function setText_(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(text);
  }

  function setStatus_(id, text) {
    setText_(id, text);
  }

  function buildPayload_(data = {}) {
    if (Auth?.attachToken) return Auth.attachToken(data);
    return Object.assign({ token: Auth?.token || '' }, data);
  }

  async function fetchAppData_() {
    if (!API || !postJSON || !isLoggedIn_()) {
      return { ok: false, error: 'ログインが必要です' };
    }

    const res = await postJSON(`${API}?mode=appDataGet`, buildPayload_({}));
    if (!res?.ok) return { ok: false, error: res?.error || 'appDataGet failed' };
    lastAppData = normalizeAppData_(res.appData || {});
    return { ok: true, appData: lastAppData };
  }

  async function saveAppDataPatch_(patch) {
    const keys = Object.keys(patch || {});
    if (!keys.length) return { ok: false, error: '保存対象がありません' };
    if (!API || !postJSON || !isLoggedIn_()) {
      return { ok: false, error: 'ログインが必要です' };
    }

    const res = await postJSON(`${API}?mode=appDataSave`, buildPayload_({
      appData: patch,
      appDataPatchKeys: keys,
    }));
    if (!res?.ok) return { ok: false, error: res?.error || 'appDataSave failed' };

    lastAppData = normalizeAppData_(Object.assign({}, lastAppData || {}, patch));
    return { ok: true };
  }

  function normalizeAppData_(src) {
    const obj = (src && typeof src === 'object') ? src : {};
    return {
      ownedCards: (obj.ownedCards && typeof obj.ownedCards === 'object') ? obj.ownedCards : {},
      cardGroups: (obj.cardGroups && typeof obj.cardGroups === 'object') ? obj.cardGroups : EMPTY_CARD_GROUPS,
      savedDecks: Array.isArray(obj.savedDecks) ? obj.savedDecks : [],
      updatedAt: obj.updatedAt || '',
    };
  }

  function normalizeCount_(value) {
    if (typeof value === 'number') return Math.max(0, value | 0);
    if (!value || typeof value !== 'object') return 0;
    return Math.max(0, value.normal | 0);
  }

  function summarizeOwned_(owned) {
    const map = (owned && typeof owned === 'object') ? owned : {};
    let types = 0;
    let total = 0;
    Object.values(map).forEach((value) => {
      const count = normalizeCount_(value);
      if (count > 0) {
        types += 1;
        total += count;
      }
    });
    return { types, total };
  }

  async function getOwnedCardTotals_() {
    let cards = [];

    try {
      if (typeof window.fetchLatestCards === 'function') {
        cards = await window.fetchLatestCards();
      }
    } catch (_) {}

    if (!Array.isArray(cards) || !cards.length) {
      const map = window.cardMap || window.allCardsMap || {};
      cards = Object.values(map);
    }

    const totalTypes = Array.isArray(cards) ? cards.length : 0;

    const totalCards = cards.reduce((sum, card) => {
      const cd = String(card?.cd || '').trim();
      const race = String(card?.race || '').trim();

      const max = typeof window.maxAllowedCount === 'function'
        ? window.maxAllowedCount(cd, race)
        : (race === '旧神' ? 1 : 3);

      return sum + Math.max(0, Number(max) || 0);
    }, 0);

    return { totalTypes, totalCards };
  }

  function summarizeCardGroups_(cardGroups) {
    const groups = (cardGroups?.groups && typeof cardGroups.groups === 'object') ? cardGroups.groups : {};
    const order = Array.isArray(cardGroups?.order) ? cardGroups.order : Object.keys(groups);
    const uniqueCards = new Set();

    order.forEach((id) => {
      const cards = groups[id]?.cards || {};
      Object.keys(cards).forEach((cd) => {
        if (cards[cd]) uniqueCards.add(String(cd));
      });
    });

    return { groups: order.filter((id) => !!groups[id]).length, cards: uniqueCards.size };
  }

  function summarizeSavedDecks_(savedDecks) {
    return Array.isArray(savedDecks) ? savedDecks.length : 0;
  }

  async function summarizeMatchResults_() {
    const api = window.AccountMatchResults;
    const LIMIT = 200;

    if (!api?.summary && !api?.list) {
      setText_('acct-match-results-count', '-');
      setText_('acct-match-winrate', '-');
      setText_('acct-match-winrate-label', '勝率');
      setStatus_('acct-match-results-status', '準備中');
      return;
    }

    try {
      const res = api.summary
        ? await api.summary({ limit: LIMIT })
        : await api.list({ limit: LIMIT });

      if (!res?.ok) throw new Error(res?.error || 'failed');

      const list = Array.isArray(res.matches) ? res.matches : (Array.isArray(res.items) ? res.items : []);
      const count = Number(res.total ?? res.count ?? res.summary?.total ?? list.length);

      const displayCount = Number.isFinite(count)
        ? (count >= LIMIT ? `${LIMIT}以上` : String(count))
        : '-';

      const winRateRaw = Number(
        res.winRate ??
        res.summary?.winRate
      );

      let winRateText = '-';
      if (Number.isFinite(winRateRaw)) {
        winRateText = `${Math.round(winRateRaw * 100)}%`;
      } else {
        const total = list.length;
        const wins = list.filter(m => String(m.result || '').toLowerCase() === 'win').length;
        if (total > 0) winRateText = `${Math.round((wins / total) * 100)}%`;
      }

      setText_('acct-match-results-count', displayCount);
      setText_('acct-match-winrate', winRateText);
      setText_('acct-match-winrate-label', count >= LIMIT ? '直近200戦勝率' : '勝率');
      setStatus_('acct-match-results-status', '取得済み');
    } catch (_) {
      setText_('acct-match-results-count', '-');
      setText_('acct-match-winrate', '-');
      setText_('acct-match-winrate-label', '勝率');
      setStatus_('acct-match-results-status', '取得失敗');
    }
  }

  function readLocalFallback_() {
    const appData = window.AccountAppDataSync?.readLocal?.() || {};
    return normalizeAppData_(appData);
  }

  async function renderData_(appData, sourceLabel) {
    const data = normalizeAppData_(appData || readLocalFallback_());
    const owned = summarizeOwned_(data.ownedCards);
    const cardGroups = summarizeCardGroups_(data.cardGroups);
    const savedDecks = summarizeSavedDecks_(data.savedDecks);
    const ownedTotals = await getOwnedCardTotals_();

    setText_(
      'acct-owned-type-count',
      ownedTotals.totalTypes ? `${owned.types}/${ownedTotals.totalTypes}` : owned.types
    );

    setText_(
      'acct-owned-total-count',
      ownedTotals.totalCards ? `${owned.total}/${ownedTotals.totalCards}` : owned.total
    );

    setStatus_('acct-owned-status', sourceLabel);

    setText_('acct-card-groups-count', cardGroups.groups);
    setStatus_('acct-card-groups-status', sourceLabel);

    setText_('acct-saved-decks-count', savedDecks);
    setStatus_('acct-saved-decks-status', sourceLabel);

    summarizeMatchResults_();
  }

  async function refresh() {
    if (!document.getElementById('accountDataModal')) return;

    if (!isLoggedIn_()) {
      await renderData_(readLocalFallback_(), 'ローカル表示');
      setText_('acct-post-count', '-');
      setText_('acct-liked-deck-count', '-');
      setText_('acct-last-posted-at', '-');
      setStatus_('account-post-status', '未ログイン');
      return;
    }

    setStatus_('acct-owned-status', '取得中');
    setStatus_('acct-card-groups-status', '取得中');
    setStatus_('acct-saved-decks-status', '取得中');

    try {
      const res = await fetchAppData_();
      if (!res.ok) throw new Error(res.error);
      await renderData_(res.appData, '取得済み');
    } catch (err) {
      await renderData_(readLocalFallback_(), '取得失敗');
      console.warn('アカウントデータの取得に失敗しました:', err);
    }

    refreshPostSummary_();
  }

  async function refreshPostSummary_() {
    const user = Auth?.user || {};
    const state = window.DeckPostState?.getState?.();
    const cachedTotal = state?.mine?.total;
    const cachedItems = Array.isArray(state?.mine?.items) ? state.mine.items : [];

    const initialPostCount = Number.isFinite(Number(cachedTotal)) ? Number(cachedTotal) : '-';

    setText_('acct-post-count', initialPostCount);
    setText_('acct-liked-deck-count', '-');
    setText_('acct-last-posted-at', formatLastPostDate_(cachedItems) || '-');

    setText_('acct-current-poster-name', user.displayName || '（未設定）');
    setText_('acct-current-x', user.x ? `@${String(user.x).replace(/^@/, '')}` : '（未設定）');

    if (!isLoggedIn_()) {
      setStatus_('account-post-status', '未ログイン');
      return;
    }

    let gotPosted = false;
    let gotLiked = false;

    if (window.DeckPostApi?.apiList) {
      try {
        const res = await window.DeckPostApi.apiList({ mine: true, limit: 1, offset: 0 });
        if (res?.ok) {
          const count = Number(res.total ?? res.totalCount ?? (Array.isArray(res.items) ? res.items.length : 0));
          const text = Number.isFinite(count) ? count : '-';

          setText_('acct-post-count', text);
          setText_('acct-last-posted-at', formatLastPostDate_(res.items) || '-');

          gotPosted = true;
        }
      } catch (_) {}

    }

    if (!gotPosted) {
      const postCount = await fetchPostCount_();
      if (postCount) {
        setText_('acct-post-count', postCount.count);
        setText_('acct-last-posted-at', postCount.lastPostedAt || '-');
        gotPosted = true;
      }
    }

    if (!gotLiked) {
      const likedCount = await fetchLikedPostCount_();
      if (likedCount != null) {
        setText_('acct-liked-deck-count', likedCount);
        gotLiked = true;
      }
    }

    setStatus_('account-post-status', gotPosted || gotLiked ? '取得済み' : (cachedTotal != null ? 'キャッシュ表示' : '簡易表示'));
  }

  function formatDateOnly_(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }

  function formatLastPostDate_(items) {
    const list = Array.isArray(items) ? items : [];
    let latest = null;

    list.forEach((item) => {
      const raw = item?.createdAt || item?.created_at || item?.updatedAt || item?.updated_at || '';
      const time = raw ? new Date(raw).getTime() : NaN;
      if (!Number.isNaN(time) && (!latest || time > latest.time)) {
        latest = { time, raw };
      }
    });

    return latest ? formatDateOnly_(latest.raw) : '';
  }

  async function fetchPostCount_() {
    const base = window.DECKPOST_API_BASE || window.GAS_API_BASE || '';
    if (!base || !Auth?.token) return null;

    const qs = new URLSearchParams();
    qs.set('mode', 'list');
    qs.set('mine', '1');
    qs.set('limit', '1');
    qs.set('offset', '0');
    qs.set('token', String(Auth.token));

    try {
      const url = `${base}?${qs.toString()}`;
      let data = null;
      let requestUrl = null;

      try {
        requestUrl = new URL(url);
      } catch (_) {}

      if (requestUrl && requestUrl.hostname === 'script.google.com') {
        data = await fetchJsonp_(url);
      } else if (typeof fetch === 'function') {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return null;
        data = await res.json().catch(() => null);
      }

      if (!data || data.ok === false) return null;
      const count = Number(data.total ?? data.totalCount ?? (Array.isArray(data.items) ? data.items.length : 0));
      return Number.isFinite(count)
        ? { count, lastPostedAt: formatLastPostDate_(data.items) }
        : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchLikedPostCount_() {
    const base = window.DECKPOST_API_BASE || window.GAS_API_BASE || '';
    if (!base || !Auth?.token) return null;

    const qs = new URLSearchParams();
    qs.set('mode', 'likedCount');
    qs.set('token', String(Auth.token));

    try {
      const url = `${base}?${qs.toString()}`;
      let data = null;
      let requestUrl = null;

      try {
        requestUrl = new URL(url);
      } catch (_) {}

      if (requestUrl && requestUrl.hostname === 'script.google.com') {
        data = await fetchJsonp_(url);
      } else if (typeof fetch === 'function') {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return null;
        data = await res.json().catch(() => null);
      }

      if (!data || data.ok === false) return null;

      const count = Number(data.count ?? 0);
      return Number.isFinite(count) ? count : null;
    } catch (_) {
      return null;
    }
  }

  function fetchJsonp_(url) {
    if (window.DeckPostApi?.jsonpRequest) {
      return window.DeckPostApi.jsonpRequest(url);
    }

    return new Promise((resolve, reject) => {
      const cbName =
        '__account_data_jsonp_' +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2);

      const sep = url.includes('?') ? '&' : '?';
      const script = document.createElement('script');
      script.src = url + sep + 'callback=' + encodeURIComponent(cbName);
      script.async = true;

      let cleaned = false;
      let timer = null;

      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;

        try {
          delete window[cbName];
        } catch (_) {
          window[cbName] = undefined;
        }

        if (script.parentNode) script.parentNode.removeChild(script);
        if (timer) clearTimeout(timer);
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP timeout'));
      }, 10000);

      window[cbName] = (data) => {
        cleanup();
        resolve(data);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error('JSONP failed'));
      };

      document.head.appendChild(script);
    });
  }

  function resolveScopeSections_(scope) {
    if (SCOPE_SECTIONS[scope]) return SCOPE_SECTIONS[scope];
    const sectionName = SCOPE_TO_SECTION[scope];
    return sectionName ? ['account', sectionName].filter((value, index, array) => array.indexOf(value) === index) : SCOPE_SECTIONS.all;
  }

  function applyScopeVisibility_(scope) {
    const sectionNames = resolveScopeSections_(scope);
    const visibleSections = new Set(sectionNames);

    document.querySelectorAll('#accountDataModal [data-account-section]').forEach((section) => {
      const visible = visibleSections.has(section.dataset.accountSection);
      section.hidden = !visible;
      section.style.display = visible ? '' : 'none';
    });

    document.querySelectorAll('#accountDataModal [data-account-jump]').forEach((chip) => {
      const visible = visibleSections.has(chip.dataset.accountJump);
      chip.hidden = !visible;
      chip.style.display = visible ? '' : 'none';
    });

    return sectionNames[0] || 'account';
  }

  function scrollToScope_(scope) {
    const sectionName = SCOPE_TO_SECTION[scope] || scope || 'account';
    const section = document.querySelector(`#accountDataModal [data-account-section="${sectionName}"]:not([hidden])`);
    if (!section) return;
    const container = document.querySelector('#accountDataModal .account-modal-body');

    setTimeout(() => {
      if (container) {
        const top = section.offsetTop - container.offsetTop;
        container.scrollTo({ top, behavior: 'smooth' });
      } else {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      setActiveChip_(sectionName);
    }, 0);
  }

  function setActiveChip_(sectionName) {
    const chipsRoot = document.querySelector('#accountDataModal .account-jump-chips');
    if (!chipsRoot) return;

    chipsRoot.querySelectorAll('.account-jump-chip').forEach((chip) => {
      chip.classList.toggle('is-active', chip.dataset.accountJump === sectionName);
    });

    const active = chipsRoot.querySelector('.account-jump-chip.is-active');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  function findActiveSectionByScroll_() {
    const container = document.querySelector('#accountDataModal .account-modal-body');
    if (!container) return 'account';

    const sections = Array.from(container.querySelectorAll('[data-account-section]'))
      .filter((section) => !section.hidden);
    if (!sections.length) return 'account';

    const line = container.getBoundingClientRect().top + 24;
    let active = sections[0];

    sections.forEach((section) => {
      if (section.getBoundingClientRect().top <= line) active = section;
    });

    return active.dataset.accountSection || 'account';
  }

  function updateActiveByScroll_() {
    scrollSpyTicking = false;
    setActiveChip_(findActiveSectionByScroll_());
  }

  function bindScrollSpy_() {
    if (scrollSpyBound) return;
    const container = document.querySelector('#accountDataModal .account-modal-body');
    if (!container) return;

    scrollSpyBound = true;
    container.addEventListener('scroll', () => {
      if (scrollSpyTicking) return;
      scrollSpyTicking = true;
      window.requestAnimationFrame?.(updateActiveByScroll_) || setTimeout(updateActiveByScroll_, 0);
    }, { passive: true });
  }

  function goPage_(href) {
    if (!href) return;
    window.location.href = href;
  }

  function clearLocalData_(key) {
    if (key === 'ownedCards') {
      try { window.OwnedStore?.replaceAll?.({}); } catch (_) {}
      try { localStorage.setItem('ownedCards', '{}'); } catch (_) {}
      try { window.OwnedUI?.sync?.(); } catch (_) {}
      try { window.updateSummary?.(); } catch (_) {}
      try { window.updateOwnedTotal?.(); } catch (_) {}
      return;
    }

    if (key === 'cardGroups') {
      const localEmpty = {
        groups: {},
        order: [],
        sys: {
          fav: { touched: true, deleted: true },
          meta: { touched: true, deleted: true },
        },
      };
      try { window.CardGroups?.replaceAll?.(localEmpty); } catch (_) {}
      try { localStorage.setItem('cardGroupsV1', JSON.stringify(localEmpty)); } catch (_) {}
      return;
    }

    if (key === 'savedDecks') {
      try { window.SavedDeckStore?.replaceAll?.([], { persist: true }); } catch (_) {}
      try { localStorage.setItem('savedDecks', '[]'); } catch (_) {}
    }
  }

  function clearLocalMatchResults_() {
    try {
      window.dispatchEvent(new CustomEvent('account-match-results:reset'));
    } catch (_) {}
  }

  async function resetMatchResults_(button) {
    const api = window.AccountMatchResults;
    if (!api?.clearAll) {
      alert('戦績データのリセット機能を読み込めませんでした。ページを再読み込みしてください。');
      return;
    }

    const ok = window.confirm(
`⚠️ 戦績データを完全にリセットします。

この操作は元に戻せません。
本当に削除しますか？`
    );
    if (!ok) return;

    const keep = button?.textContent || '';
    if (button) {
      button.disabled = true;
      button.textContent = 'リセット中...';
    }
    setStatus_('acct-match-results-status', '削除中');

    try {
      const res = await api.clearAll({ limit: 5000 });
      if (!res?.ok) throw new Error(res?.error || 'reset failed');

      clearLocalMatchResults_();
      setText_('acct-match-results-count', '0');
      setText_('acct-match-winrate', '-');
      setText_('acct-match-winrate-label', '勝率');
      setStatus_('acct-match-results-status', '更新済み');
      alert(`${Number(res.deleted || 0)}件の戦績をリセットしました`);
    } catch (err) {
      console.error(err);
      setStatus_('acct-match-results-status', '削除失敗');
      alert('戦績データのリセットに失敗しました：' + (err?.message || err));
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = keep;
      }
    }
  }

  async function resetData_(key, button) {
    if (key === 'matchResults') {
      await resetMatchResults_(button);
      return;
    }

    if (isAppDataSyncing_()) {
      alert('アカウントデータを確認中です。同期完了後に操作してください。');
      return;
    }

    const patch = RESET_PAYLOADS[key];
    if (!patch) return;

    const labels = {
      cardGroups: 'カードグループデータ',
      ownedCards: '所持率データ',
      savedDecks: '保存デッキデータ',
    };
    const ok = window.confirm(
    `⚠️ ${labels[key] || 'データ'}を完全にリセットします。

    この操作は元に戻せません。
    本当に削除しますか？`
    );
    if (!ok) return;

    const keep = button?.textContent || '';
    if (button) {
      button.disabled = true;
      button.textContent = 'リセット中...';
    }

    try {
      const res = await saveAppDataPatch_(patch);
      if (!res.ok) throw new Error(res.error || 'reset failed');
      clearLocalData_(key);
      renderData_(lastAppData || readLocalFallback_(), '更新済み');
      alert('リセットしました');
    } catch (err) {
      console.error(err);
      alert('リセットに失敗しました：' + (err?.message || err));
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = keep;
      }
    }
  }

  function setHidden_(id, hidden) {
    const el = document.getElementById(id);
    if (el) el.hidden = !!hidden;
  }

  function setOfflineCardError_(text) {
    const el = document.getElementById('offline-card-save-error');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function formatDateTime_(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hour}:${minute}`;
  }

  function renderOfflineCardStatus_(status = {}) {
    const state = String(status.state || '');
    const savedCount = Number(status.savedCount || 0);
    const failedCount = Number(status.failedCount || 0);
    const total = Number(status.total || 0);
    const savedAtText = formatDateTime_(status.savedAt);

    const progress = document.getElementById('offline-card-save-progress');
    const savedAt = document.getElementById('offline-card-save-date');
    const button = document.getElementById('offline-card-save-btn');

    setOfflineCardError_('');
    if (button) button.disabled = state === 'saving';

    if (state === 'saving') {
      setStatus_('offline-card-save-status', total ? `保存中 ${savedCount}/${total}` : '保存中');
      if (progress) progress.textContent = total ? `${savedCount}/${total}件を保存中` : '保存準備中';
      setHidden_('offline-card-save-date', true);
      return;
    }

    if (state === 'saved') {
      setStatus_('offline-card-save-status', failedCount > 0 ? '保存済み（一部失敗）' : '保存済み');
      if (progress) {
        progress.textContent = failedCount > 0
          ? `${savedCount}件保存 / ${failedCount}件失敗`
          : `${savedCount}件保存済み`;
      }
      if (savedAt) {
        savedAt.textContent = savedAtText ? `最終保存日: ${savedAtText}` : '';
        savedAt.hidden = !savedAtText;
      }
      if (failedCount > 0) {
        setOfflineCardError_('一部の画像を保存できませんでした。通信状態を確認してもう一度保存してください。');
      }
      return;
    }

    if (state === 'failed') {
      setStatus_('offline-card-save-status', '保存失敗');
      if (progress) progress.textContent = savedCount ? `${savedCount}件保存済み` : '';
      setHidden_('offline-card-save-date', true);
      setOfflineCardError_(status.error || 'カードデータを保存できませんでした。通信状態を確認してください。');
      return;
    }

    setStatus_('offline-card-save-status', '未保存');
    if (progress) progress.textContent = '';
    setHidden_('offline-card-save-date', true);
  }

  function refreshOfflineCards_() {
    const status = window.MesorogiaOfflineCards?.getStatus?.() || {};
    renderOfflineCardStatus_(status);
  }

  async function saveOfflineCards_(button) {
    if (!window.MesorogiaOfflineCards?.save) {
      renderOfflineCardStatus_({
        state: 'failed',
        error: 'カードデータ保存機能を読み込めませんでした。ページを再読み込みしてください。',
      });
      return;
    }

    if (button) button.disabled = true;
    renderOfflineCardStatus_({ state: 'saving', savedCount: 0, failedCount: 0, total: 0 });

    try {
      const status = await window.MesorogiaOfflineCards.save({
        onProgress: renderOfflineCardStatus_,
      });
      renderOfflineCardStatus_(status);
    } catch (err) {
      renderOfflineCardStatus_({
        state: 'failed',
        error: err?.message || String(err),
      });
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bindOnce_() {
    if (bound) return;
    bound = true;

    window.addEventListener('offline-cards:progress', (event) => {
      renderOfflineCardStatus_(event.detail || {});
    });

    document.addEventListener('click', (ev) => {
      const offlineSave = ev.target.closest?.('[data-offline-cards-save]');
      if (offlineSave) {
        ev.preventDefault();
        saveOfflineCards_(offlineSave);
        return;
      }

      const jump = ev.target.closest?.('[data-account-jump]');
      if (jump) {
        ev.preventDefault();
        scrollToScope_(jump.dataset.accountJump);
        return;
      }

      const page = ev.target.closest?.('[data-account-page]');
      if (page) {
        ev.preventDefault();
        goPage_(page.dataset.accountPage);
        return;
      }

      const reset = ev.target.closest?.('[data-account-reset]');
      if (reset) {
        ev.preventDefault();
        resetData_(reset.dataset.accountReset, reset);
      }
    });
  }

  function open(opts = {}) {
    bindOnce_();
    bindScrollSpy_();

    const scope = opts.scope || 'all';
    const modal = document.getElementById('accountDataModal');
    if (modal) modal.dataset.accountScope = scope;

    const title = document.getElementById('accountModalTitle');
    if (title) {
      title.textContent = getScopeTitle_(scope);
    }
    refreshLabels();

    refresh();
    refreshOfflineCards_();

    const firstSection = applyScopeVisibility_(scope);
    scrollToScope_(firstSection);
  }

  window.AccountDataManager = window.AccountDataManager || {
    open,
    refresh,
    refreshLabels,
    reset: resetData_,
    fetch: fetchAppData_,
  };
  bindLabelRefresh_();
  refreshLabels();
})();
