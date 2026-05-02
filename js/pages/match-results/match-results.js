/* =========================
 * js/pages/match-results/match-results.js
 * - 戦績ページの保存デッキ一覧・戦績表示・登録フォーム・履歴編集
 * ========================= */
(function () {
  'use strict';

  let activeDeckIndex_ = -1;
  let activeScope_ = 'overall';
  let activeOpponentRace_ = '';
  let loadMatchesRequestId_ = 0;
  let cachedMatches_ = [];
  let matchesLoaded_ = false;
  let matchesDirty_ = false;
  let matchesLoading_ = false;
  let editingMatchId_ = '';
  const CUSTOM_OPPONENT_KEY_ = 'matchResultsCustomOpponentDecks';
  const TODAY_MATCHES_KEY_BASE_ = 'matchResultsTodayMatches';
  const TODAY_MATCH_KEEP_MS_ = 24 * 60 * 60 * 1000;
  let todayMatches_ = [];

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
    const auth = window.Auth || {};
    return !!(auth.user && auth.token && auth.verified);
  }

  function pad2_(n) {
    return String(n).padStart(2, '0');
  }

  function formatNow_() {
    const d = new Date();
    return `${d.getFullYear()}/${pad2_(d.getMonth() + 1)}/${pad2_(d.getDate())} ${pad2_(d.getHours())}:${pad2_(d.getMinutes())}:${pad2_(d.getSeconds())}`;
  }

  function getOpponentGroups_() {
    const fallback = [
      { race: 'ドラゴン', list: ['聖焔龍（フォルティア）', 'ドラゴライダー', '電竜', 'メロウディア'] },
      { race: 'アンドロイド', list: ['メイドロボ', 'アドミラルシップ', 'テックノイズ', '星装（アストロイ）'] },
      { race: 'エレメンタル', list: ['ナチュリア', '鬼刹（きせつ）', '風花森（ふかしん）', '秘饗（バンケット）', 'アルケミクルス'] },
      { race: 'ルミナス', list: ['ロスリス', '白騎士', '愚者愚者（クラウンクラウド）', '蒼ノ刀', '歪祝（エヴァル）'] },
      { race: 'シェイド', list: ['昏き霊園（スレイヴヤード）', 'マディスキア', '炎閻魔（えんえんま）', 'ヴァントム'] },
    ];
    const groups = Array.isArray(window.CATEGORY_GROUPS) ? window.CATEGORY_GROUPS : fallback;
    return groups
      .map(group => ({
        race: String(group?.race || '').trim(),
        list: Array.isArray(group?.list) ? group.list.map(v => String(v || '').trim()).filter(Boolean) : [],
      }))
      .filter(group => group.race);
  }

  function readCustomOpponentDecks_() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CUSTOM_OPPONENT_KEY_) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).map(([race, list]) => [
        String(race || '').trim(),
        Array.isArray(list) ? [...new Set(list.map(v => String(v || '').trim()).filter(Boolean))] : [],
      ]).filter(([race]) => race));
    } catch (_) {
      return {};
    }
  }

  function writeCustomOpponentDecks_(map) {
    try {
      localStorage.setItem(CUSTOM_OPPONENT_KEY_, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function isAccountDecksReady_() {
    if (!isLoggedIn_()) return false;
    const status = window.AccountSavedDecksSync?.getStatus?.() || {};
    return status.source === 'account' || status.state === 'account';
  }

  function getDeckChoicesEmptyMessage_(type) {
    if (!isLoggedIn_()) {
      return type === 'history'
        ? 'ログイン後に戦績の表示デッキを選択できます。'
        : 'ログイン後にデッキを選択できます。';
    }

    if (!isAccountDecksReady_()) {
      return type === 'history'
        ? '戦績の表示デッキを読み込み中です...'
        : 'デッキを読み込み中です...';
    }

    return type === 'history'
      ? '戦績を表示できる保存デッキがありません。'
      : '使用できる保存デッキがありません。';
  }

  function getEntryDeckEmptyLabel_() {
    if (!isLoggedIn_()) return 'ログインが必要';
    if (!isAccountDecksReady_()) return '読み込み中';
    return '未選択';
  }

  function renderFieldLabelValue_(label, prefix, value, emphasize) {
    if (!label) return;
    const valueHtml = emphasize
      ? `<span class="match-entry-field-required">${escapeHtml_(value)}</span>`
      : escapeHtml_(value);
    label.innerHTML = `${escapeHtml_(prefix)}${valueHtml}`;
  }

  function getRaceColorVar_(race) {
    const colorMap = {
      'ドラゴン': 'var(--race-dragon)',
      'アンドロイド': 'var(--race-android)',
      'エレメンタル': 'var(--race-elemental)',
      'ルミナス': 'var(--race-luminous)',
      'シェイド': 'var(--race-shade)',
      'イノセント': 'var(--race-innocent)',
    };
    return colorMap[String(race || '').trim()] || '#94a3b8';
  }

  function getOpponentRaceStyle_(race) {
    return ` style="--match-opponent-race-color:${getRaceColorVar_(race)};"`;
  }

  function ensureActiveOpponentRace_() {
    const groups = getOpponentGroups_();
    if (!groups.length) {
      activeOpponentRace_ = '';
      return null;
    }
    const hit = groups.find(group => group.race === activeOpponentRace_);
    if (hit) return hit;
    activeOpponentRace_ = groups[0].race;
    return groups[0];
  }

  function setOpponentDeck_(name) {
    const input = document.getElementById('matchOpponentDeck');
    if (input) input.value = String(name || '').trim();
    renderOpponentLabel_();
    renderOpponentPicker_();
  }

  function renderEditOpponentLabel_(form) {
    if (!form) return;

    const input = form.elements.opponentDeck;
    const label = form.querySelector('[data-edit-opponent-label]');
    if (!label) return;

    const value = String(input?.value || '').trim();
    renderFieldLabelValue_(label, '対戦デッキ：', value || '未選択', !value);
  }

  function renderOpponentLabel_() {
    const input = document.getElementById('matchOpponentDeck');
    const label = document.getElementById('matchOpponentLabel');
    if (!label) return;
    const value = String(input?.value || '').trim();
    renderFieldLabelValue_(label, '対戦デッキ：', value || '未選択', !value);
  }

  function addCustomOpponentDeck_(race, name) {
    const raceName = String(race || '').trim();
    const deckName = String(name || '').trim();
    if (!raceName || !deckName) return;

    const customMap = readCustomOpponentDecks_();
    const list = Array.isArray(customMap[raceName]) ? customMap[raceName] : [];
    customMap[raceName] = [...new Set([...list, deckName])];
    writeCustomOpponentDecks_(customMap);
    setOpponentDeck_(deckName);
  }

  function deleteCustomOpponentDeck_(race, name) {
    const raceName = String(race || '').trim();
    const deckName = String(name || '').trim();
    if (!raceName || !deckName) return;

    const customMap = readCustomOpponentDecks_();
    const next = (customMap[raceName] || []).filter(item => item !== deckName);
    if (next.length) customMap[raceName] = next;
    else delete customMap[raceName];
    writeCustomOpponentDecks_(customMap);

    const input = document.getElementById('matchOpponentDeck');
    if (input?.value === deckName) input.value = '';
    renderOpponentLabel_();
    renderOpponentPicker_();
  }

  function renderOpponentPicker_() {
    const root = document.getElementById('matchOpponentPicker');
    if (!root) return;

    const groups = getOpponentGroups_();
    const activeGroup = ensureActiveOpponentRace_();
    if (!activeGroup) {
      root.innerHTML = '<div class="match-opponent-empty">選択できる対戦デッキがありません。</div>';
      return;
    }

    const selected = String(document.getElementById('matchOpponentDeck')?.value || '').trim();
    const customMap = readCustomOpponentDecks_();
    const race = activeGroup.race;
    const raceOther = `${race}その他`;
    const baseList = [...(activeGroup.list || [])];
    if (!baseList.includes(raceOther)) baseList.push(raceOther);
    const customList = (customMap[race] || []).filter(name => !baseList.includes(name));
    const raceTabs = groups.map(group => {
      const active = group.race === activeOpponentRace_;
      return `
        <button type="button" class="match-opponent-race-tab${active ? ' is-active' : ''}" data-opponent-race-tab="${escapeHtml_(group.race)}"${getOpponentRaceStyle_(group.race)}>
          ${escapeHtml_(group.race)}
        </button>
      `;
    }).join('');
    const optionButtons = baseList.map(name => `
      <button type="button" class="match-opponent-option${name === selected ? ' is-active' : ''}" data-opponent-name="${escapeHtml_(name)}">
        ${escapeHtml_(name)}
      </button>
    `).join('');
    const customButtons = customList.map(name => `
      <span class="match-opponent-custom-item">
        <button type="button" class="match-opponent-option${name === selected ? ' is-active' : ''}" data-opponent-name="${escapeHtml_(name)}">
          ${escapeHtml_(name)}
        </button>
        <button type="button" class="match-opponent-delete" data-opponent-delete="${escapeHtml_(name)}" data-opponent-race="${escapeHtml_(race)}" aria-label="${escapeHtml_(name)}を削除">×</button>
      </span>
    `).join('');

    root.innerHTML = `
      <div class="match-opponent-race-tabs" role="tablist" aria-label="対戦デッキの種族">
        ${raceTabs}
      </div>
      <section class="match-opponent-race"${getOpponentRaceStyle_(race)}>
        <div class="match-opponent-options">
          ${optionButtons}
          ${customButtons}
        </div>
        <div class="match-opponent-add">
          <input type="text" data-opponent-add-input="${escapeHtml_(race)}" placeholder="${escapeHtml_(race)}のデッキ名を追加" maxlength="40" autocomplete="off">
          <button type="button" data-opponent-add="${escapeHtml_(race)}">追加</button>
        </div>
      </section>
    `;
  }

    function getEditOpponentRace_(form) {
    const groups = getOpponentGroups_();
    const savedRace = String(form?.dataset?.editOpponentRace || '').trim();
    if (groups.some(group => group.race === savedRace)) return savedRace;

    const selected = String(form?.elements?.opponentDeck?.value || '').trim();
    const hit = groups.find(group => {
      const raceOther = `${group.race}その他`;
      return [...(group.list || []), raceOther].includes(selected);
    });

    return hit?.race || groups[0]?.race || '';
  }

  function setEditOpponentDeck_(form, name) {
    if (!form) return;

    const input = form.elements.opponentDeck;
    if (input) input.value = String(name || '').trim();

    renderEditOpponentLabel_(form);
    renderEditOpponentPicker_(form);
  }

  function addEditCustomOpponentDeck_(form, race, name) {
    const raceName = String(race || '').trim();
    const deckName = String(name || '').trim();
    if (!form || !raceName || !deckName) return;

    const customMap = readCustomOpponentDecks_();
    const list = Array.isArray(customMap[raceName]) ? customMap[raceName] : [];
    customMap[raceName] = [...new Set([...list, deckName])];
    writeCustomOpponentDecks_(customMap);

    form.dataset.editOpponentRace = raceName;
    setEditOpponentDeck_(form, deckName);
  }

  function deleteEditCustomOpponentDeck_(form, race, name) {
    const raceName = String(race || '').trim();
    const deckName = String(name || '').trim();
    if (!form || !raceName || !deckName) return;

    const customMap = readCustomOpponentDecks_();
    const next = (customMap[raceName] || []).filter(item => item !== deckName);
    if (next.length) customMap[raceName] = next;
    else delete customMap[raceName];
    writeCustomOpponentDecks_(customMap);

    const input = form.elements.opponentDeck;
    if (input?.value === deckName) input.value = '';

    renderEditOpponentPicker_(form);
  }

  function renderEditOpponentPicker_(form) {
    if (!form) return;

    const root = form.querySelector('[data-edit-opponent-picker]');
    if (!root) return;

    const groups = getOpponentGroups_();
    if (!groups.length) {
      root.innerHTML = '<div class="match-opponent-empty">選択できる対戦デッキがありません。</div>';
      return;
    }

    const selected = String(form.elements.opponentDeck?.value || '').trim();
    const customMap = readCustomOpponentDecks_();
    const activeRace = getEditOpponentRace_(form);
    form.dataset.editOpponentRace = activeRace;

    const activeGroup = groups.find(group => group.race === activeRace) || groups[0];
    const race = activeGroup.race;
    const raceOther = `${race}その他`;
    const baseList = [...(activeGroup.list || [])];
    if (!baseList.includes(raceOther)) baseList.push(raceOther);

    const customList = (customMap[race] || []).filter(name => !baseList.includes(name));

    const raceTabs = groups.map(group => {
      const active = group.race === activeRace;
      return `
        <button type="button" class="match-opponent-race-tab${active ? ' is-active' : ''}" data-edit-opponent-race-tab="${escapeHtml_(group.race)}"${getOpponentRaceStyle_(group.race)}>
          ${escapeHtml_(group.race)}
        </button>
      `;
    }).join('');

    const optionButtons = baseList.map(name => `
      <button type="button" class="match-opponent-option${name === selected ? ' is-active' : ''}" data-edit-opponent-name="${escapeHtml_(name)}">
        ${escapeHtml_(name)}
      </button>
    `).join('');

    const customButtons = customList.map(name => `
      <span class="match-opponent-custom-item">
        <button type="button" class="match-opponent-option${name === selected ? ' is-active' : ''}" data-edit-opponent-name="${escapeHtml_(name)}">
          ${escapeHtml_(name)}
        </button>
        <button type="button" class="match-opponent-delete" data-edit-opponent-delete="${escapeHtml_(name)}" data-edit-opponent-race="${escapeHtml_(race)}" aria-label="${escapeHtml_(name)}を削除">×</button>
      </span>
    `).join('');

    root.innerHTML = `
      <div class="match-opponent-race-tabs" role="tablist" aria-label="対戦デッキの種族">
        ${raceTabs}
      </div>
      <section class="match-opponent-race"${getOpponentRaceStyle_(race)}>
        <div class="match-opponent-options">
          ${optionButtons}
          ${customButtons}
        </div>
        <div class="match-opponent-add">
          <input type="text" data-edit-opponent-add-input="${escapeHtml_(race)}" placeholder="${escapeHtml_(race)}のデッキ名を追加" maxlength="40" autocomplete="off">
          <button type="button" data-edit-opponent-add="${escapeHtml_(race)}">追加</button>
        </div>
      </section>
    `;
  }

  function getDecks_() {
    if (!isAccountDecksReady_()) return [];

    try {
      return window.SavedDeckStore?.list?.() || [];
    } catch (_) {
      return [];
    }
  }

  function getActiveDeck_() {
    const decks = getDecks_();
    return decks[activeDeckIndex_] || null;
  }

  function getDeckMainCd_(deck) {
    const main = String(deck?.m || '').trim();
    if (main && deck?.cardCounts?.[main]) return main;
    return Object.keys(deck?.cardCounts || {})[0] || '00000';
  }

  function getDeckRace_(deck) {
    const byCode = {
      1: 'ドラゴン',
      2: 'アンドロイド',
      3: 'エレメンタル',
      4: 'ルミナス',
      5: 'シェイド',
    };
    const fromCode = byCode[Number(deck?.g || 0)] || '';
    if (fromCode) return fromCode;

    const mainCd = getDeckMainCd_(deck);
    const card = (window.cards || window.CARDS || []).find?.(item => String(item?.cd || item?.id || '') === mainCd);
    return String(card?.race || '').trim();
  }

  function getDeckRaceStyle_(deck) {
    const race = getDeckRace_(deck);
    const colorMap = {
      'ドラゴン': 'var(--race-dragon)',
      'アンドロイド': 'var(--race-android)',
      'エレメンタル': 'var(--race-elemental)',
      'ルミナス': 'var(--race-luminous)',
      'シェイド': 'var(--race-shade)',
      'イノセント': 'var(--race-innocent)',
    };
    const color = colorMap[race] || '';
    return color ? ` style="--match-deck-race-color:${color};"` : '';
  }

  function getDeckCardTotal_(deck) {
    return Object.values(deck?.cardCounts || {}).reduce((sum, count) => {
      return sum + Math.max(0, Number(count || 0) || 0);
    }, 0);
  }

  function normalizeCardCode_(code) {
    const raw = String(code || '').trim();
    return raw ? raw.padStart(5, '0') : '00000';
  }

  function formatDate_(raw) {
    const value = String(raw || '').trim();
    if (!value) return '日付なし';

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
    }

    return value.replace(/-/g, '/');
  }

  function getMatchId_(match) {
    return String(match?.matchId || match?.id || match?.uuid || '').trim();
  }

  function getMatchDeckId_(match) {
    return String(match?.deckId || '').trim();
  }

  function resultLabel_(value) {
    return String(value || '').toLowerCase() === 'win' ? '勝ち' : '負け';
  }

  function getTodayMatchesStorageKey_() {
    const user = window.Auth?.user || {};
    const userId = String(user.userId || user.username || user.gameUserId || '').trim();
    return userId ? `${TODAY_MATCHES_KEY_BASE_}:${userId}` : TODAY_MATCHES_KEY_BASE_;
  }

  function normalizeTodayMatch_(item) {
    const savedAt = Number(item?.savedAt || 0);
    const deckName = String(item?.deckName || '').trim();
    const opponentDeck = String(item?.opponentDeck || '').trim();
    const result = String(item?.result || '').trim().toLowerCase();
    if (!savedAt || !deckName || !opponentDeck || !['win', 'lose'].includes(result)) return null;

    return {
      savedAt,
      deckName,
      opponentDeck,
      result,
    };
  }

  function readStoredTodayMatches_() {
    const expiresAt = Date.now() - TODAY_MATCH_KEEP_MS_;
    try {
      const parsed = JSON.parse(localStorage.getItem(getTodayMatchesStorageKey_()) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(normalizeTodayMatch_)
        .filter(item => item && item.savedAt >= expiresAt);
    } catch (_) {
      return [];
    }
  }

  function writeStoredTodayMatches_() {
    const expiresAt = Date.now() - TODAY_MATCH_KEEP_MS_;
    const stored = todayMatches_.filter(item => item.savedAt >= expiresAt);
    try {
      localStorage.setItem(getTodayMatchesStorageKey_(), JSON.stringify(stored));
    } catch (_) {}
  }

  function renderTodayMatches_() {
    const root = document.getElementById('todayMatchList');
    if (!root) return;

    if (!todayMatches_.length) {
      root.innerHTML = `
        <div class="today-match-empty">
          <span>ここで登録した対戦を一時表示します。</span>
          <span>再読込後は直近24時間以内の戦績だけ表示されます。</span>
        </div>
      `;
      return;
    }

    root.innerHTML = todayMatches_.map(item => {
      const result = String(item.result || '').toLowerCase();
      return `
        <article class="today-match-item">
          <div class="today-match-decks">
            <span class="today-match-own">${escapeHtml_(item.deckName)}</span>
            <span class="today-match-vs">vs</span>
            <span class="today-match-opponent">${escapeHtml_(item.opponentDeck)}</span>
          </div>
          <strong class="today-match-result is-${escapeHtml_(result)}">${escapeHtml_(resultLabel_(result))}</strong>
        </article>
      `;
    }).join('');
  }

  function addTodayMatch_(payload) {
    const deck = getActiveDeck_();
    const deckName = String(deck?.name || '').trim() || 'デッキ';
    const item = normalizeTodayMatch_({
      savedAt: Date.now(),
      deckName,
      opponentDeck: payload?.opponentDeck,
      result: payload?.result,
    });
    if (!item) return;

    todayMatches_.unshift(item);
    writeStoredTodayMatches_();
    renderTodayMatches_();
  }

  function priorityLabel_(value) {
    return String(value || '').toLowerCase() === 'self' ? '先攻' : '後攻';
  }

  function getStatusLabel_() {
    if (!isLoggedIn_()) return 'ログインすると、アカウントに保存されたデッキを表示します。';

    const status = window.AccountSavedDecksSync?.getStatus?.();
    if (status?.syncing || status?.state === 'syncing') return 'アカウントデータを読み込み中...';
    if (status?.source === 'account' || status?.state === 'account') return 'アカウントデータの保存デッキを表示中です。';
    return '保存デッキを表示中です。';
  }

  function normalizeMatches_(res) {
    const candidates = [res?.matches, res?.results, res?.items, res?.list, res?.data];
    const list = candidates.find(Array.isArray);
    return Array.isArray(list) ? list : [];
  }

  function isInputTabActive_() {
    return !!document.querySelector('[data-match-panel="input"].is-active:not([hidden])');
  }

  function isHistoryViewActive_() {
    return !!document.querySelector('[data-match-view-panel="history"].is-active:not([hidden])');
  }

  function buildSummaryFromMatches_(matches) {
    const list = Array.isArray(matches) ? matches : [];
    const total = list.length;
    let wins = 0;
    let losses = 0;
    const byOpponent = {};

    list.forEach(match => {
      const result = String(match?.result || '').toLowerCase();
      const key = String(match?.opponentDeck || match?.opponent || '未指定');
      byOpponent[key] = byOpponent[key] || { total: 0, wins: 0, losses: 0 };
      byOpponent[key].total += 1;

      if (result === 'win') {
        wins += 1;
        byOpponent[key].wins += 1;
      } else if (result === 'lose') {
        losses += 1;
        byOpponent[key].losses += 1;
      }
    });

    Object.keys(byOpponent).forEach(key => {
      const item = byOpponent[key];
      item.winRate = item.total ? item.wins / item.total : 0;
    });

    return {
      ok: true,
      total,
      wins,
      losses,
      winRate: total ? wins / total : 0,
      byOpponent,
    };
  }

  function getVisibleMatches_() {
    if (activeScope_ !== 'deck') return cachedMatches_.slice();
    const deckId = getScopeDeckId_();
    if (!deckId) return [];
    return cachedMatches_.filter(match => String(match?.deckId || '') === deckId);
  }

  function updateCachedMatch_(matchId, patch) {
    const id = String(matchId || '').trim();
    if (!id) return;
    cachedMatches_ = cachedMatches_.map(item => (
      getMatchId_(item) === id ? Object.assign({}, item, patch, { matchId: id }) : item
    ));
  }

  function shouldFallbackReplace_(res) {
    const error = String(res?.error || res?.message || '').toLowerCase();
    return !!error && (
      error.includes('unknown') ||
      error.includes('unsupported') ||
      error.includes('not implemented') ||
      error.includes('invalid mode') ||
      error.includes('mode') ||
      error.includes('action')
    );
  }

  function renderStatus_() {
    const status = document.getElementById('match-results-status');
    if (status) status.textContent = getStatusLabel_();
  }

  function buildDeckPeekEntries_(deck) {
    const entries = Object.entries(deck?.cardCounts || {})
      .map(([code, count]) => [normalizeCardCode_(code), Math.max(0, Number(count || 0) || 0)])
      .filter(([, count]) => count > 0);
    const cardMap = window.cardMap || {};
    return window.sortCardEntries?.(entries, cardMap) || entries;
  }

  function ensureMatchDeckPeekOverlay_() {
    let overlay = document.getElementById('match-deckpeek-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'match-deckpeek-overlay';
    overlay.innerHTML = `
      <div class="match-deckpeek-inner">
        <div class="match-deckpeek-list"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function hideMatchDeckPeek_() {
    const overlay = document.getElementById('match-deckpeek-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.style.left = '';
    overlay.style.top = '';
    overlay.style.right = '';
    overlay.style.bottom = '';
    overlay.style.width = '';
    delete overlay.dataset.deckIndex;
  }

  function renderMatchDeckPeek_(list, deck) {
    const entries = buildDeckPeekEntries_(deck);
    if (!entries.length) {
      list.innerHTML = '<div class="match-deckpeek-empty">デッキが空です</div>';
      return;
    }

    list.innerHTML = entries.map(([code, count]) => {
      const cd = normalizeCardCode_(code);
      return `
        <div class="deck-entry" data-cd="${escapeHtml_(cd)}">
          <img src="img/${escapeHtml_(cd)}.webp" alt="" loading="lazy" onerror="this.src='img/00000.webp'">
          <div class="count-badge">x${count}</div>
        </div>
      `;
    }).join('');
  }

  function showMatchDeckPeek_(index, thumbEl) {
    const decks = getDecks_();
    const deck = decks[index];
    if (!deck || !thumbEl) return;

    const overlay = ensureMatchDeckPeekOverlay_();
    const list = overlay.querySelector('.match-deckpeek-list');
    if (!list) return;

    overlay.dataset.deckIndex = String(index);
    renderMatchDeckPeek_(list, deck);
    overlay.style.display = 'block';
    overlay.style.left = '';
    overlay.style.top = '';
    overlay.style.right = '8px';
    overlay.style.bottom = '20px';
    overlay.style.width = '';

    const choices = thumbEl.closest('.match-entry-deck-choices') || thumbEl;
    const rect = choices.getBoundingClientRect();
    const margin = 8;
    const maxWidth = Math.min(Math.max(200, rect.width), 360);
    overlay.style.width = `${maxWidth}px`;

    const overlayWidth = overlay.offsetWidth || maxWidth;
    const overlayHeight = overlay.offsetHeight || 0;
    let left = rect.left;
    let top = rect.bottom + margin;

    if (left + overlayWidth > window.innerWidth - margin) {
      left = window.innerWidth - margin - overlayWidth;
    }
    if (left < margin) left = margin;
    if (top + overlayHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - overlayHeight - margin);
    }
    if (top < margin) top = margin;

    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
  }

  function renderLoginRequired_(root) {
    root.innerHTML = `
      <div class="match-empty">
        <div>戦績ページはログイン後に表示できます。</div>
        <div class="match-login-actions">
          <button type="button" class="btn primary" data-open="authLoginModal" data-auth-entry="login">ログイン</button>
          <button type="button" class="btn ghost" data-open="authLoginModal" data-auth-entry="signup">新規登録</button>
        </div>
      </div>
    `;
  }

  function renderDeckCard_(deck, index) {
    const mainCd = getDeckMainCd_(deck);
    const name = String(deck?.name || '').trim() || `デッキ${index + 1}`;
    const total = getDeckCardTotal_(deck);
    const date = formatDate_(deck?.date);
    const active = activeScope_ === 'deck' && index === activeDeckIndex_;
    const raceStyle = getDeckRaceStyle_(deck);

    return `
      <button type="button" class="match-deck-card${active ? ' is-active' : ''}" data-deck-index="${index}"${raceStyle}>
        <span class="match-deck-thumb">
          <img src="img/${escapeHtml_(mainCd)}.webp" alt="" loading="lazy" onerror="this.src='img/00000.webp'">
        </span>
        <span class="match-deck-body">
          <span class="match-deck-title">
            <span class="match-deck-name">${escapeHtml_(name)}</span>
          </span>
          <span class="match-deck-meta" aria-label="デッキ情報">
            <span class="match-deck-chip">${total}枚</span>
            <span class="match-deck-chip">${escapeHtml_(date)}</span>
          </span>
        </span>
      </button>
    `;
  }

  function renderEntryDeckChoices_() {
    const root = document.getElementById('matchEntryDeckChoices');
    if (!root) return;

    const decks = getDecks_();
    const editChoiceHtml = `
      <a class="match-entry-deck-choice match-entry-deck-edit-choice" href="deckmaker.html#saved-deck" aria-label="保存デッキを追加・編集">
        <span class="match-entry-deck-card match-entry-deck-edit-card">
          <span class="match-entry-deck-edit-title">保存デッキ</span>
          <span class="match-entry-deck-edit-text">追加・編集</span>
        </span>
      </a>
    `;
    if (!decks.length) {
      root.innerHTML = `<div class="match-entry-deck-empty">${escapeHtml_(getDeckChoicesEmptyMessage_('entry'))}</div>${editChoiceHtml}`;
      return;
    }

    root.innerHTML = decks.map((deck, index) => {
      const mainCd = getDeckMainCd_(deck);
      const name = String(deck?.name || '').trim() || `デッキ${index + 1}`;
      const total = getDeckCardTotal_(deck);
      const checked = index === activeDeckIndex_ ? ' checked' : '';
      const raceStyle = getDeckRaceStyle_(deck);
      return `
        <label class="match-entry-deck-choice">
          <input type="radio" name="entryDeckIndex" value="${index}"${checked}>
          <span class="match-entry-deck-card"${raceStyle}>
            <span class="match-entry-deck-thumb" role="button" tabindex="0" data-match-deck-peek-index="${index}" aria-label="${escapeHtml_(name)}のデッキリストを表示">
              <img src="img/${escapeHtml_(mainCd)}.webp" alt="" loading="lazy" onerror="this.src='img/00000.webp'">
              <span class="thumb-deckpeek-badge" aria-hidden="true">
                <img src="img/deckicon.webp" alt="">
              </span>
            </span>
            <span class="match-entry-deck-text">
              <span class="match-entry-deck-name">${escapeHtml_(name)}</span>
              <span class="match-entry-deck-meta">${total}枚</span>
            </span>
          </span>
        </label>
      `;
    }).join('') + editChoiceHtml;
  }

  function renderEntryDeckLabel_() {
    const label = document.getElementById('matchEntryDeckLabel');
    if (!label) return;
    const deck = getActiveDeck_();
    const name = String(deck?.name || '').trim();
    const value = name || getEntryDeckEmptyLabel_();
    renderFieldLabelValue_(label, '現在のデッキ：', value, value === '未選択');
  }

  function getHistoryRateTitle_() {
    const deck = getActiveDeck_();
    const name = String(deck?.name || '').trim();
    return activeScope_ === 'deck' && name ? `『${name}』勝率` : '全体勝率';
  }

  function renderDecks_() {
    renderStatus_();
    if (!isLoggedIn_()) {
      activeDeckIndex_ = -1;
      activeScope_ = 'overall';
      renderEntryDeckChoices_();
      updateHistoryActions_();
      updateEntryState_();
      renderEmptyHistory_('ログイン後に戦績を表示できます。');
      return;
    }

    const decks = getDecks_();
    if (!decks.length) {
      activeDeckIndex_ = -1;
      activeScope_ = 'overall';
      renderEntryDeckChoices_();
      updateHistoryActions_();
      updateEntryState_();
      renderCurrentMatches_();
      return;
    }

    if (!decks[activeDeckIndex_]) {
      activeDeckIndex_ = -1;
      activeScope_ = 'overall';
    }
    renderEntryDeckChoices_();
    updateHistoryActions_();
    updateEntryState_();
  }

  function getScopeDeckId_() {
    if (activeScope_ !== 'deck') return '';
    return getActiveDeck_()?.id || '';
  }

  function isCurrentHistoryLoaded_() {
    return matchesLoaded_;
  }

  function getScopeLabel_() {
    if (activeScope_ !== 'deck') return '全体';
    const deck = getActiveDeck_();
    return String(deck?.name || '').trim() || '名称未設定';
  }

  function updateScopeTitle_() {
    updateHistoryActions_();
  }

  function renderEmptyHistory_(message) {
    const summary = document.getElementById('matchSummary');
    const body = document.getElementById('matchHistoryBody');
    if (summary) summary.innerHTML = '';
    if (body) body.innerHTML = `<div class="match-empty">${escapeHtml_(message || '戦績はまだありません。')}</div>`;
  }

  function ensureHistoryActions_() {
    const title = document.getElementById('matchHistoryTitle');
    if (!title || document.getElementById('matchHistoryActions')) return;

    const actions = document.createElement('div');
    actions.id = 'matchHistoryActions';
    actions.className = 'match-history-actions';
    actions.innerHTML = `
      <span class="match-history-rate-title" id="matchHistoryRateTitle">全体勝率</span>
      <button type="button" class="btn match-history-refresh" id="matchHistoryRefresh" title="戦績を取得" aria-label="戦績を取得" hidden>戦績取得</button>
    `;
    title.insertAdjacentElement('afterend', actions);
  }

  function updateHistoryActions_() {
    ensureHistoryActions_();
    const rateTitle = document.getElementById('matchHistoryRateTitle');
    const button = document.getElementById('matchHistoryRefresh');
    const needsInitialRetry = isHistoryViewActive_() && !matchesLoaded_;
    const needsRefresh = isLoggedIn_() && !matchesLoading_ && (matchesDirty_ || needsInitialRetry);
    if (rateTitle) rateTitle.textContent = getHistoryRateTitle_();
    if (button) {
      const tooltip = matchesDirty_ && isCurrentHistoryLoaded_()
        ? '未反映の戦績がある可能性があります。更新してください。'
        : '戦績を取得します。';
      button.hidden = !needsRefresh;
      button.disabled = !needsRefresh;
      button.title = tooltip;
      button.textContent = matchesDirty_ && isCurrentHistoryLoaded_() ? '戦績更新' : '戦績取得';
      button.setAttribute('aria-label', tooltip);
    }
  }

  function renderSummary_(summaryRes) {
    const root = document.getElementById('matchSummary');
    if (!root) return;
    if (!summaryRes?.ok) {
      root.innerHTML = '<div class="match-empty">戦績を読み込めませんでした。</div>';
      return;
    }

    const wins = Number(summaryRes.wins || 0);
    const losses = Number(summaryRes.losses || 0);
    const total = Number(summaryRes.total || 0);
    const rate = Math.round((Number(summaryRes.winRate || 0) * 1000)) / 10;
    const rateLabel = activeScope_ === 'deck' ? 'デッキ勝率' : '全体勝率';

    root.innerHTML = `
      <div class="match-summary-grid">
        <div class="match-summary-item">
          <span>戦数</span>
          <strong>${total}</strong>
        </div>
        <div class="match-summary-item">
          <span>勝敗</span>
          <strong>${wins}勝 ${losses}敗</strong>
        </div>
        <div class="match-summary-item">
          <span>${rateLabel}</span>
          <strong>${Number.isFinite(rate) ? rate : 0}%</strong>
        </div>
      </div>
    `;
  }

  function renderMatchEditForm_(item, matchId) {
    const result = String(item.result || '').toLowerCase();
    const priority = String(item.priority || '').toLowerCase();
    const opponent = item.opponentDeck || item.opponent || '';
    const memo = item.memo || '';

    return `
      <form class="match-history-edit-form" data-match-edit-form="${escapeHtml_(matchId)}">

        <fieldset class="match-entry-choice">
          <legend>勝敗</legend>
          <div class="match-choice-buttons">
            <label class="match-choice-button">
              <input type="radio" name="result" value="win" required${result === 'win' ? ' checked' : ''}>
              <span>勝ち</span>
            </label>
            <label class="match-choice-button">
              <input type="radio" name="result" value="lose" required${result === 'lose' ? ' checked' : ''}>
              <span>負け</span>
            </label>
          </div>
        </fieldset>

        <fieldset class="match-entry-choice">
          <legend>優先権（任意）</legend>
          <div class="match-choice-buttons">
            <label class="match-choice-button">
              <input type="radio" name="priority" value="self"${priority === 'self' ? ' checked' : ''}>
              <span>先攻</span>
            </label>
            <label class="match-choice-button">
              <input type="radio" name="priority" value="opponent"${priority === 'opponent' ? ' checked' : ''}>
              <span>後攻</span>
            </label>
          </div>
        </fieldset>

        <input type="hidden" name="opponentDeck" value="${escapeHtml_(opponent)}" required>
        <fieldset class="match-entry-choice">
          <legend data-edit-opponent-label>対戦デッキ：${escapeHtml_(opponent || '未選択')}</legend>
          <div class="match-opponent-picker" data-edit-opponent-picker></div>
        </fieldset>

        <label class="match-history-edit-field match-history-edit-wide">
          <span>メモ</span>
          <textarea name="memo" rows="3" maxlength="200">${escapeHtml_(memo)}</textarea>
        </label>

        <div class="match-history-edit-actions">
          <button type="button" class="btn ghost match-history-cancel" data-match-edit-cancel="${escapeHtml_(matchId)}">キャンセル</button>
          <button type="submit" class="btn primary match-history-save">保存</button>
        </div>
      </form>
    `;
  }

  function renderMatchRows_(matches) {
    const body = document.getElementById('matchHistoryBody');
    if (!body) return;
    if (!matches.length) {
      body.innerHTML = `<div class="match-empty">${escapeHtml_(getScopeLabel_())}の戦績はまだありません。</div>`;
      return;
    }

    body.innerHTML = `
      <div class="match-history-list">
        ${matches.map(item => {
          const matchId = getMatchId_(item);
          const playedAt = item.playedAt || item.date || item.createdAt || '';
          const opponent = item.opponentDeck || item.opponent || '対面未入力';
          const result = item.result || '';
          const rating = item.rating || '';
          const priority = item.priority || '';
          const memo = item.memo || '';
          const editing = matchId && editingMatchId_ === matchId;
          const deckName = String(
            getDecks_().find(deck => String(deck?.id || '') === String(item.deckId || ''))?.name || ''
          ).trim();

          const showOwnDeck = activeScope_ !== 'deck';
          return `
            <article class="match-history-item" data-match-id="${escapeHtml_(matchId)}">
              <div class="match-history-top">
                <strong class="match-history-result is-${escapeHtml_(String(result || '').toLowerCase())}">${escapeHtml_(resultLabel_(result))}</strong>
                <span>${escapeHtml_(formatDate_(playedAt))}</span>
              </div>
              <div class="match-history-body-row">
                <div class="match-history-info">
                  <div class="match-history-meta today-match-decks">
                    ${showOwnDeck && deckName ? `
                      <span class="today-match-own">${escapeHtml_(deckName)}</span>
                      <span class="today-match-vs">vs</span>
                    ` : ''}
                    <span class="today-match-opponent">対面：${escapeHtml_(opponent)}</span>
                    ${rating ? `<span class="match-history-sub">レート：${escapeHtml_(rating)}</span>` : ''}
                    ${priority ? `<span class="match-history-sub">${escapeHtml_(priorityLabel_(priority))}</span>` : ''}
                  </div>
                  ${memo ? `<p class="match-history-memo">${escapeHtml_(memo)}</p>` : ''}
                </div>

                ${editing ? '' : `
                  <div class="match-history-row-actions">
                    <button
                      type="button"
                      class="btn ghost match-history-edit"
                      data-match-edit="${escapeHtml_(matchId)}"
                      ${matchId ? '' : ' disabled'}
                    >
                      編集
                    </button>

                    <button
                      type="button"
                      class="btn ghost match-history-delete"
                      data-match-delete="${escapeHtml_(matchId)}"
                      aria-label="戦績を削除"
                      ${matchId ? '' : ' disabled'}
                    >
                      🗑
                    </button>
                  </div>
                `}
              </div>

              ${editing ? renderMatchEditForm_(item, matchId) : ''}
            </article>
          `;
        }).join('')}
      </div>
    `;
    body.querySelectorAll('[data-match-edit-form]').forEach(form => {
      renderEditOpponentLabel_(form);
      renderEditOpponentPicker_(form);
    });
  }

  function setHistoryLoading_() {
    const summary = document.getElementById('matchSummary');
    const body = document.getElementById('matchHistoryBody');
    if (summary) summary.innerHTML = '';
    if (body) body.innerHTML = '<div class="match-empty">戦績を読み込み中...</div>';
    updateHistoryActions_();
  }

  async function loadMatches_() {
    if (!isLoggedIn_()) {
      renderEmptyHistory_('ログイン後に戦績を表示できます。');
      updateHistoryActions_();
      return;
    }

    if (matchesLoading_) return;

    updateScopeTitle_();
    updateEntryState_();
    matchesLoading_ = true;
    setHistoryLoading_();

    const requestId = ++loadMatchesRequestId_;
    try {
      const listRes = await window.AccountMatchResults?.list?.({ limit: 1000 });
      if (requestId !== loadMatchesRequestId_) return;
      cachedMatches_ = normalizeMatches_(listRes);
      if (editingMatchId_ && !cachedMatches_.some(item => getMatchId_(item) === editingMatchId_)) editingMatchId_ = '';
      matchesLoaded_ = true;
      matchesDirty_ = false;
      matchesLoading_ = false;
      renderCurrentMatches_();
    } catch (e) {
      if (requestId !== loadMatchesRequestId_) return;
      renderEmptyHistory_('戦績を読み込めませんでした。');
    } finally {
      if (requestId === loadMatchesRequestId_) {
        matchesLoading_ = false;
        updateHistoryActions_();
      }
    }
  }

  function renderCurrentMatches_() {
    updateScopeTitle_();
    updateEntryState_();

    if (!isLoggedIn_()) {
      renderEmptyHistory_('ログイン後に戦績を表示できます。');
      return;
    }

    if (matchesLoading_) {
      setHistoryLoading_();
      return;
    }

    if (!isCurrentHistoryLoaded_()) {
      renderEmptyHistory_('更新すると戦績を取得します。');
      updateHistoryActions_();
      return;
    }

    const matches = getVisibleMatches_();
    renderSummary_(buildSummaryFromMatches_(matches));
    renderMatchRows_(matches);
    updateHistoryActions_();
  }

  function updateEntryState_() {
    const form = document.getElementById('matchEntryForm');
    const deckIdInput = document.getElementById('matchEntryDeckId');
    const playedAt = document.getElementById('matchEntryPlayedAt');
    const deck = getActiveDeck_();
    const enabled = isLoggedIn_();

    if (deckIdInput) deckIdInput.value = enabled && deck?.id ? deck.id : '';
    if (playedAt && !playedAt.value) playedAt.value = formatNow_();
    renderEntryDeckLabel_();

    if (!form) return;
    Array.from(form.elements).forEach(el => {
      if (el.name === 'deckId') return;
      el.disabled = !enabled;
    });
  }

  function selectDeck_(index) {
    const decks = getDecks_();
    if (!decks[index] || activeDeckIndex_ === index) {
      activeDeckIndex_ = -1;
      activeScope_ = 'overall';
    } else {
      activeDeckIndex_ = index;
      activeScope_ = 'deck';
    }
    renderDecks_();
    renderCurrentMatches_();
  }

  function toggleScope_() {
    if (activeScope_ === 'deck') {
      activeScope_ = 'overall';
    } else if (getActiveDeck_()) {
      activeScope_ = 'deck';
    }
    renderDecks_();
    renderCurrentMatches_();
  }

  async function submitMatch_(form) {
    const deckId = form.elements.deckId?.value || '';
    const submit = document.getElementById('matchEntrySubmit');
    if (!isLoggedIn_()) {
      form.reportValidity?.();
      return;
    }
    if (!deckId) {
      const deckInput = form.querySelector('input[name="entryDeckIndex"]');
      deckInput?.setCustomValidity('使用デッキを選択してください。');
      deckInput?.reportValidity();
      deckInput?.setCustomValidity('');
      return;
    }
    if (!form.elements.opponentDeck.value) {
      const label = document.getElementById('matchOpponentLabel');
      renderFieldLabelValue_(label, '対戦デッキ：', '未選択（選択してください）', true);
      return;
    }

    const payload = {
      deckId,
      playedAt: form.elements.playedAt.value,
      result: form.elements.result.value,
      opponentDeck: form.elements.opponentDeck.value,
      rating: '',
      priority: form.elements.priority?.value || '',
      memo: form.elements.memo.value,
    };

    if (submit) submit.disabled = true;

    try {
      const res = await window.AccountMatchResults?.add?.(payload);
      if (!res?.ok) {
        window.alert?.(res?.error || '登録に失敗しました。');
        return;
      }

      addTodayMatch_(payload);
      form.elements.opponentDeck.value = '';
      renderOpponentLabel_();
      renderOpponentPicker_();
      form.querySelectorAll('input[name="result"], input[name="priority"]').forEach(input => {
        input.checked = false;
      });
      form.elements.memo.value = '';
      form.elements.playedAt.value = formatNow_();
      activeScope_ = deckId ? 'deck' : 'overall';
      matchesDirty_ = true;
      renderCurrentMatches_();
    } catch (e) {
      window.alert?.(e?.message || '登録に失敗しました。');
    } finally {
      if (submit) submit.disabled = false;
      updateEntryState_();
    }
  }

  async function saveMatchEdit_(form) {
    const matchId = String(form?.dataset?.matchEditForm || '').trim();
    const original = cachedMatches_.find(item => getMatchId_(item) === matchId);
    const submit = form?.querySelector('.match-history-save');
    if (!matchId || !original || !form) return;

    const opponentDeck = String(form.elements.opponentDeck?.value || '').trim();
    if (!opponentDeck) {
      form.elements.opponentDeck?.reportValidity?.();
      return;
    }

    const payload = {
      matchId,
      deckId: getMatchDeckId_(original),
      playedAt: original.playedAt || original.date || original.createdAt || '',
      result: form.elements.result?.value || '',
      opponentDeck,
      rating: original.rating || '',
      priority: form.elements.priority?.value || '',
      memo: form.elements.memo?.value || '',
    };

    if (submit) submit.disabled = true;

    try {
      let usedReplace = false;
      let res = await window.AccountMatchResults?.update?.(payload);
      if (!res?.ok && shouldFallbackReplace_(res)) {
        const addRes = await window.AccountMatchResults?.add?.(payload);
        if (!addRes?.ok) {
          window.alert?.(addRes?.error || '保存に失敗しました。');
          return;
        }

        const deleteRes = await window.AccountMatchResults?.remove?.(matchId);
        if (!deleteRes?.ok) {
          window.alert?.('新しい内容は登録しましたが、古い戦績の削除に失敗しました。戦績を更新して重複がないか確認してください。');
        }
        res = addRes;
        usedReplace = true;
      }

      if (!res?.ok) {
        window.alert?.(res?.error || '保存に失敗しました。');
        return;
      }

      editingMatchId_ = '';
      if (usedReplace) {
        matchesDirty_ = true;
        updateCachedMatch_(matchId, payload);
        renderCurrentMatches_();
      } else {
        updateCachedMatch_(matchId, payload);
        renderCurrentMatches_();
      }
    } catch (e) {
      window.alert?.(e?.message || '保存に失敗しました。');
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function bindEvents_() {
    document.addEventListener('click', event => {
      const tabButton = event.target.closest('[data-match-tab]');
      if (tabButton) {
        showMatchTab_(tabButton.dataset.matchTab);
        return;
      }

      const viewTab = event.target.closest('[data-match-view-tab]');
      if (viewTab) {
        const next = viewTab.dataset.matchViewTab === 'history' ? 'history' : 'entry';

        document.querySelectorAll('[data-match-view-tab]').forEach(button => {
          const active = button.dataset.matchViewTab === next;
          button.classList.toggle('is-active', active);
          button.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        document.querySelectorAll('[data-match-view-panel]').forEach(panel => {
          const active = panel.dataset.matchViewPanel === next;
          panel.classList.toggle('is-active', active);
          panel.hidden = !active;
        });

        if (next === 'history' && !matchesLoaded_ && !matchesLoading_) {
          loadMatches_();
        } else if (next === 'history') {
          renderCurrentMatches_();
        }
        return;
      }

      const deckButton = event.target.closest('[data-deck-index]');
      if (deckButton) {
        selectDeck_(Number(deckButton.dataset.deckIndex));
        return;
      }

      const deckPeek = event.target.closest('[data-match-deck-peek-index]');
      if (deckPeek) {
        event.preventDefault();
        const index = Number(deckPeek.dataset.matchDeckPeekIndex);
        const overlay = document.getElementById('match-deckpeek-overlay');
        if (overlay?.style.display === 'block' && overlay.dataset.deckIndex === String(index)) {
          hideMatchDeckPeek_();
        } else {
          showMatchDeckPeek_(index, deckPeek);
        }
        return;
      }

      const inputToggle = event.target.closest('[data-match-input-toggle]');
      if (inputToggle) {
        const box = inputToggle.closest('.match-input-box');
        const collapsed = !box.classList.contains('is-collapsed');
        box.classList.toggle('is-collapsed', collapsed);
        inputToggle.textContent = collapsed ? '▲' : '▼';
        inputToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        return;
      }

      if (event.target.closest('#matchHistoryRefresh')) {
        loadMatches_();
        return;
      }

      const matchEdit = event.target.closest('[data-match-edit]');
      if (matchEdit) {
        const matchId = String(matchEdit.dataset.matchEdit || '').trim();
        if (matchId) {
          editingMatchId_ = matchId;
          renderCurrentMatches_();
        }
        return;
      }

      const matchDelete = event.target.closest('[data-match-delete]');
      if (matchDelete) {
        const matchId = String(matchDelete.dataset.matchDelete || '').trim();
        if (!matchId) return;

        const ok = window.confirm?.('この戦績を削除しますか？');
        if (!ok) return;

        (async () => {
          try {
            const res = await window.AccountMatchResults?.remove?.(matchId);

            if (!res?.ok) {
              window.alert?.(res?.error || '削除に失敗しました。');
              return;
            }

            cachedMatches_ = cachedMatches_.filter(
              item => getMatchId_(item) !== matchId
            );

            if (editingMatchId_ === matchId) {
              editingMatchId_ = '';
            }

            renderCurrentMatches_();

          } catch (e) {
            window.alert?.(e?.message || '削除に失敗しました。');
          }
        })();

        return;
      }

      const matchEditCancel = event.target.closest('[data-match-edit-cancel]');
      if (matchEditCancel) {
        editingMatchId_ = '';
        renderCurrentMatches_();
        return;
      }

      const editOpponentRaceTab = event.target.closest('[data-edit-opponent-race-tab]');
      if (editOpponentRaceTab) {
        const form = editOpponentRaceTab.closest('[data-match-edit-form]');
        if (form) {
          form.dataset.editOpponentRace = editOpponentRaceTab.dataset.editOpponentRaceTab || '';
          renderEditOpponentPicker_(form);
        }
        return;
      }

      const editOpponentDelete = event.target.closest('[data-edit-opponent-delete]');
      if (editOpponentDelete) {
        const form = editOpponentDelete.closest('[data-match-edit-form]');
        if (form) {
          deleteEditCustomOpponentDeck_(
            form,
            editOpponentDelete.dataset.editOpponentRace,
            editOpponentDelete.dataset.editOpponentDelete
          );
        }
        return;
      }

      const editOpponentAdd = event.target.closest('[data-edit-opponent-add]');
      if (editOpponentAdd) {
        const form = editOpponentAdd.closest('[data-match-edit-form]');
        const race = editOpponentAdd.dataset.editOpponentAdd;
        const input = form?.querySelector(`[data-edit-opponent-add-input="${CSS.escape(race)}"]`);
        addEditCustomOpponentDeck_(form, race, input?.value);
        if (input) input.value = '';
        return;
      }

      const editOpponentOption = event.target.closest('[data-edit-opponent-name]');
      if (editOpponentOption) {
        const form = editOpponentOption.closest('[data-match-edit-form]');
        if (form) setEditOpponentDeck_(form, editOpponentOption.dataset.editOpponentName);
        return;
      }

      const opponentRaceTab = event.target.closest('[data-opponent-race-tab]');
      if (opponentRaceTab) {
        activeOpponentRace_ = opponentRaceTab.dataset.opponentRaceTab || '';
        renderOpponentPicker_();
        return;
      }

      const opponentDelete = event.target.closest('[data-opponent-delete]');
      if (opponentDelete) {
        deleteCustomOpponentDeck_(opponentDelete.dataset.opponentRace, opponentDelete.dataset.opponentDelete);
        return;
      }

      const opponentAdd = event.target.closest('[data-opponent-add]');
      if (opponentAdd) {
        const race = opponentAdd.dataset.opponentAdd;
        const input = Array.from(document.querySelectorAll('[data-opponent-add-input]'))
          .find(el => el.dataset.opponentAddInput === race);
        addCustomOpponentDeck_(race, input?.value);
        if (input) input.value = '';
        return;
      }

      const opponentOption = event.target.closest('[data-opponent-name]');
      if (opponentOption) {
        setOpponentDeck_(opponentOption.dataset.opponentName);
      }
    });

    document.addEventListener('click', event => {
      const priorityChoice = event.target.closest('.match-choice-button');
      const priorityRadio = priorityChoice?.querySelector?.('input[type="radio"][name="priority"]');
      if (priorityRadio && priorityRadio.checked) {
        event.preventDefault();
        priorityRadio.checked = false;
        priorityRadio.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      const deckChoice = event.target.closest('.match-entry-deck-choice');
      if (!deckChoice) return;
      if (event.target.closest('[data-match-deck-peek-index]')) return;

      const deckRadio = deckChoice.querySelector('input[name="entryDeckIndex"]');
      const index = Number(deckRadio?.value);
      if (!deckRadio || !getDecks_()[index]) return;

      if (deckRadio.checked && activeDeckIndex_ === index) {
        event.preventDefault();
        selectDeck_(index);
      }
    });

    document.addEventListener('submit', event => {
      const form = event.target.closest('#matchEntryForm');
      const editForm = event.target.closest('[data-match-edit-form]');
      if (!form && !editForm) return;
      event.preventDefault();
      if (form) submitMatch_(form);
      else saveMatchEdit_(editForm);
    });

    document.addEventListener('change', event => {
      const deckRadio = event.target.closest('input[name="entryDeckIndex"]');
      if (!deckRadio) return;

      const index = Number(deckRadio.value);
      if (!getDecks_()[index]) return;
      selectDeck_(index);
    });

    document.addEventListener('keydown', event => {
      const editInput = event.target.closest('[data-edit-opponent-add-input]');
      if (editInput && event.key === 'Enter') {
        event.preventDefault();
        const form = editInput.closest('[data-match-edit-form]');
        const race = editInput.dataset.editOpponentAddInput;
        addEditCustomOpponentDeck_(form, race, editInput.value);
        editInput.value = '';
        return;
      }
      const input = event.target.closest('[data-opponent-add-input]');
      if (input && event.key === 'Enter') {
        event.preventDefault();
        const race = input.dataset.opponentAddInput;
        addCustomOpponentDeck_(race, input.value);
        input.value = '';
        return;
      }

      const deckPeek = event.target.closest('[data-match-deck-peek-index]');
      if (!deckPeek || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      showMatchDeckPeek_(Number(deckPeek.dataset.matchDeckPeekIndex), deckPeek);
    });

    document.addEventListener('click', event => {
      const overlay = document.getElementById('match-deckpeek-overlay');
      if (!overlay || overlay.style.display !== 'block') return;
      if (event.target.closest('#match-deckpeek-overlay')) return;
      if (event.target.closest('[data-match-deck-peek-index]')) return;
      hideMatchDeckPeek_();
    });

    window.addEventListener('scroll', hideMatchDeckPeek_, { passive: true });
    window.addEventListener('resize', hideMatchDeckPeek_);
  }

  function showMatchTab_(tabName) {
    const next = tabName === 'settings' ? 'settings' : 'input';
    document.querySelectorAll('[data-match-tab]').forEach(button => {
      const active = button.dataset.matchTab === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-match-panel]').forEach(panel => {
      const active = panel.dataset.matchPanel === next;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });

    if (next === 'input') renderCurrentMatches_();
  }

  function renderHeaderAuth_() {
    const loggedIn = isLoggedIn_();
    document.querySelectorAll('.match-page-header-auth [data-auth-entry]').forEach(button => {
      button.style.display = loggedIn ? 'none' : '';
    });
    const settingsBtn = document.getElementById('match-account-settings-btn');
    if (settingsBtn) settingsBtn.style.display = loggedIn ? 'inline-flex' : 'none';
  }

  function chainReflectLoginUI_() {
    const prev = window.reflectLoginUI;
    window.reflectLoginUI = function reflectLoginUIWithMatchResults() {
      if (typeof prev === 'function') prev.apply(this, arguments);
      if (!isLoggedIn_()) {
        cachedMatches_ = [];
        matchesLoaded_ = false;
        matchesDirty_ = false;
        matchesLoading_ = false;
        editingMatchId_ = '';
      }
      todayMatches_ = readStoredTodayMatches_();
      writeStoredTodayMatches_();
      renderTodayMatches_();
      renderDecks_();
      renderHeaderAuth_();
      if (isInputTabActive_()) renderCurrentMatches_();
    };
  }

  function init_() {
    chainReflectLoginUI_();
    bindEvents_();
    renderOpponentLabel_();
    renderOpponentPicker_();
    todayMatches_ = readStoredTodayMatches_();
    writeStoredTodayMatches_();
    renderTodayMatches_();
    const playedAt = document.getElementById('matchEntryPlayedAt');
    if (playedAt) playedAt.value = formatNow_();
    ensureHistoryActions_();
    renderDecks_();
    renderHeaderAuth_();
    renderCurrentMatches_();
  }

  window.addEventListener('saved-decks:data-replaced', () => {
    renderDecks_();
    if (isInputTabActive_()) renderCurrentMatches_();
  });
  window.addEventListener('saved-decks:status', () => {
    renderDecks_();
    if (isInputTabActive_()) renderCurrentMatches_();
  });
  window.addEventListener('account-owned-sync:ready', () => {
    renderDecks_();
    if (isInputTabActive_()) renderCurrentMatches_();
  });
  window.addEventListener('account-match-results:reset', () => {
    cachedMatches_ = [];
    matchesLoaded_ = true;
    matchesDirty_ = false;
    matchesLoading_ = false;
    editingMatchId_ = '';
    renderCurrentMatches_();
  });
  window.SavedDeckStore?.onChange?.(() => {
    renderDecks_();
    if (isInputTabActive_()) renderCurrentMatches_();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init_, { once: true });
  } else {
    init_();
  }
})();
