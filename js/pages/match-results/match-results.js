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
  let activeSummaryChartTab_ = 'usage';
  let summaryChartExpanded_ = false;
  let lastSummaryPlaceholderKey_ = '';
  let summaryDeckSelectLastFocus_ = null;
  let loginRequiredPromptShown_ = false;
  let loginRequiredPromptTimer_ = 0;
  let loginRequiredPromptAttempts_ = 0;
  let matchEntryToastTimer_ = 0;
  let summaryDateFilterFrom_ = '';
  let summaryDateFilterTo_ = '';
  let summaryDateFilterDraftFrom_ = '';
  let summaryDateFilterDraftTo_ = '';
  let summaryDateFilterOpen_ = false;
  let summaryDatePickerTarget_ = '';
  let summaryDatePickerMonth_ = '';
  let summaryEnvironmentFilterId_ = '';
  let summaryEnvironmentFilterDraftId_ = '';
  let summaryTournamentFilterName_ = '';
  let summaryTournamentFilterDraftName_ = '';
  let summaryTournamentFilterOpen_ = false;
  let summaryEnvironmentCatalog_ = [];
  let summaryEnvironmentCatalogPromise_ = null;
  const matchImageOpponentSelection_ = new Set();
  const MATCH_IMAGE_OPPONENT_SELECTION_MAX_ = 5;
  const CUSTOM_OPPONENT_KEY_ = 'matchResultsCustomOpponentDecks';
  const ENVIRONMENTS_JSON_URL_ = './public/environments.json';
  const TIER_API_URL_ = 'https://script.google.com/macros/s/AKfycbww_gGboqJK5g5Fw3wLXSQO0uGw9Zx8pRG9F9falVfb_aVkwb_KcVmr6sK2RpjOw8mS3Q/exec';
  const TIER_CACHE_KEY_ = 'tier-list-cache-v1';
  const TODAY_MATCHES_KEY_BASE_ = 'matchResultsTodayMatches';
  const TODAY_MATCH_KEEP_MS_ = 24 * 60 * 60 * 1000;
  const TOURNAMENT_NAME_MAX_COUNT_ = 8;
  const TOURNAMENT_NAME_HISTORY_KEY_ = 'matchResultsTournamentNames';
  const TOURNAMENT_NAME_HISTORY_MAX_ = 24;
  const TOURNAMENT_GAME_LABELS_ = ['1試合目', '2試合目', '3試合目'];
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

  function showMatchEntryToast_(message) {
    let toast = document.getElementById('matchEntryToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'matchEntryToast';
      toast.className = 'match-entry-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }

    toast.textContent = String(message || '');
    toast.classList.add('is-visible');
    clearTimeout(matchEntryToastTimer_);
    matchEntryToastTimer_ = setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 2600);
  }

  function isLoggedIn_() {
    const auth = window.Auth || {};
    return !!(auth.user && auth.token && auth.verified);
  }

  function openLoginRequiredModal_() {
    if (loginRequiredPromptShown_ || isLoggedIn_()) return;

    const modal = document.getElementById('authLoginModal');
    if (!modal) return;

    loginRequiredPromptShown_ = true;
    if (typeof window.openAuthModal === 'function') {
      window.openAuthModal('login');
    } else {
      modal.style.display = 'flex';
    }

    const title = document.getElementById('authLoginModalTitle');
    if (title) title.textContent = 'ログインをしてください';

    const status = document.getElementById('auth-inline-status');
    if (status) status.textContent = '戦績ページを利用するにはログインが必要です。';

    modal.style.zIndex = '10000';
    const content = modal.querySelector('.modal-content');
    if (content) content.style.zIndex = '10001';

    try {
      document.getElementById('auth-username')?.focus?.();
    } catch (_) {}
  }

  function scheduleLoginRequiredPrompt_() {
    if (loginRequiredPromptShown_ || isLoggedIn_()) return;
    if (loginRequiredPromptTimer_) clearTimeout(loginRequiredPromptTimer_);

    const auth = window.Auth || {};
    const waitingForTokenCheck = !!auth.token && !auth.verified;
    if (waitingForTokenCheck && loginRequiredPromptAttempts_ < 20) {
      loginRequiredPromptAttempts_ += 1;
      loginRequiredPromptTimer_ = setTimeout(scheduleLoginRequiredPrompt_, 300);
      return;
    }

    loginRequiredPromptTimer_ = setTimeout(openLoginRequiredModal_, 0);
  }

  function pad2_(n) {
    return String(n).padStart(2, '0');
  }

  function formatNow_() {
    const d = new Date();
    return `${d.getFullYear()}/${pad2_(d.getMonth() + 1)}/${pad2_(d.getDate())} ${pad2_(d.getHours())}:${pad2_(d.getMinutes())}:${pad2_(d.getSeconds())}`;
  }

  function parseMatchDateValue_(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';

    const direct = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(value);
    if (direct) {
      return `${direct[1]}-${pad2_(direct[2])}-${pad2_(direct[3])}`;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${pad2_(date.getMonth() + 1)}-${pad2_(date.getDate())}`;
  }

  function getMatchDateValue_(match) {
    return parseMatchDateValue_(match?.playedAt || match?.date || match?.createdAt || '');
  }

  function ymdToTime_(value) {
    const ymd = parseMatchDateValue_(value);
    if (!ymd) return 0;
    const time = Date.parse(`${ymd}T00:00:00`);
    return Number.isNaN(time) ? 0 : time;
  }

  function normalizeSummaryEnvironment_(row) {
    const envId = String(row?.env_id || row?.envId || row?.id || '').trim();
    const label = String(row?.label || row?.name || envId || '').trim();
    const startAt = parseMatchDateValue_(row?.start_at || row?.startAt);
    const endAt = parseMatchDateValue_(row?.end_at || row?.endAt);
    if (!envId || !label || !startAt) return null;

    return {
      envId,
      label,
      startAt,
      endAt,
      note: String(row?.note || '').trim(),
    };
  }

  function completeSummaryEnvironmentRanges_(rows) {
    const list = (rows || [])
      .map(normalizeSummaryEnvironment_)
      .filter(Boolean)
      .sort((a, b) => ymdToTime_(a.startAt) - ymdToTime_(b.startAt));

    return list.map((env, index) => {
      if (env.endAt) return env;

      const next = list[index + 1];
      const nextStart = ymdToTime_(next?.startAt);
      if (!nextStart) return env;

      const end = new Date(nextStart - 24 * 60 * 60 * 1000);
      return {
        ...env,
        endAt: `${end.getFullYear()}-${pad2_(end.getMonth() + 1)}-${pad2_(end.getDate())}`,
      };
    });
  }

  function loadSummaryEnvironmentCatalog_() {
    if (summaryEnvironmentCatalogPromise_) return summaryEnvironmentCatalogPromise_;

    summaryEnvironmentCatalogPromise_ = fetch(ENVIRONMENTS_JSON_URL_, { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error(`environment json ${res.status}`);
        return res.json();
      })
      .then(json => {
        const raw = Array.isArray(json) ? json : (json?.environments || []);
        summaryEnvironmentCatalog_ = completeSummaryEnvironmentRanges_(raw);
        return summaryEnvironmentCatalog_;
      })
      .catch(err => {
        console.warn('[match-results] environments.json 読み込み失敗:', err);
        summaryEnvironmentCatalog_ = [];
        return [];
      });

    return summaryEnvironmentCatalogPromise_;
  }

  function getSummaryEnvironmentById_(envId) {
    const id = String(envId || '').trim();
    return summaryEnvironmentCatalog_.find(env => env.envId === id) || null;
  }

  function isMatchInSummaryEnvironment_(match, env) {
    const matchTime = ymdToTime_(getMatchDateValue_(match));
    const startTime = ymdToTime_(env?.startAt);
    if (!matchTime || !startTime) return false;

    const endTime = ymdToTime_(env?.endAt);
    if (matchTime < startTime) return false;
    return !endTime || matchTime <= endTime;
  }

  function isMatchInSummaryDateRange_(match) {
    const environment = getSummaryEnvironmentById_(summaryEnvironmentFilterId_);
    if (environment) return isMatchInSummaryEnvironment_(match, environment);

    const dateValue = getMatchDateValue_(match);
    if (!dateValue) return !summaryDateFilterFrom_ && !summaryDateFilterTo_;
    if (summaryDateFilterFrom_ && dateValue < summaryDateFilterFrom_) return false;
    if (summaryDateFilterTo_ && dateValue > summaryDateFilterTo_) return false;
    return true;
  }

  function getMatchTournamentNames_(match) {
    return (getFullTournament_(match)?.names || [])
      .map(name => String(name || '').trim())
      .filter(Boolean);
  }

  function isMatchInSummaryTournament_(match) {
    const selected = String(summaryTournamentFilterName_ || '').trim();
    if (!selected) return true;
    const selectedKey = normalizeTournamentText_(selected);
    return getMatchTournamentNames_(match)
      .some(name => normalizeTournamentText_(name) === selectedKey);
  }

  function getSummaryTournamentOptions_() {
    const map = new Map();
    getVisibleMatchesBeforeDateFilter_().forEach(match => {
      getMatchTournamentNames_(match).forEach(name => {
        const key = normalizeTournamentText_(name);
        if (!key || map.has(key)) return;
        map.set(key, name);
      });
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'ja'));
  }

  function getSummaryTournamentFilterLabel_() {
    return summaryTournamentFilterName_ || '指定なし';
  }

  function isSummaryTournamentFilterActive_() {
    return !!String(summaryTournamentFilterName_ || '').trim();
  }

  function getTournamentRoundOrder_(round) {
    const key = normalizeTournamentText_(round);
    const order = {
      r1: 1,
      r2: 2,
      r3: 3,
      r4: 4,
      r5: 5,
      top16: 16,
      top8: 18,
      '準々決勝': 20,
      '準決勝': 30,
      '決勝': 40,
      'その他': 90,
    };
    return order[key] || 99;
  }

  function getTournamentMatchRows_(matches) {
    return (Array.isArray(matches) ? matches : [])
      .map((match, index) => {
        const tournament = getFullTournament_(match);
        if (!tournament) return null;
        const round = tournament.rounds[0] || '';
        const wins = tournament.games.filter(game => String(game?.result || '').toLowerCase() === 'win').length;
        const losses = tournament.games.filter(game => String(game?.result || '').toLowerCase() === 'lose').length;
        return {
          index,
          round,
          result: String(match?.result || '').toLowerCase() === 'win' ? '○' : '×',
          opponentDeck: String(match?.opponentDeck || match?.opponent || '').trim(),
          playerName: String(tournament.opponent || '').trim(),
          score: `${wins}-${losses}`,
          order: getTournamentRoundOrder_(round),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order || a.index - b.index);
  }

  function getTournamentPlacementCandidate_(round, isWin) {
    const key = normalizeTournamentText_(round)
      .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
      .replace(/\s+/g, '');
    if (!key) return null;

    if (key === 'top16' || key === 'best16' || key === 'ベスト16') {
      return isWin ? { rank: 8, label: 'ベスト8' } : { rank: 16, label: 'ベスト16' };
    }
    if (key === 'top8' || key === 'best8' || key === 'ベスト8' || key === '準々決勝') {
      return isWin ? { rank: 4, label: 'ベスト4' } : { rank: 8, label: 'ベスト8' };
    }
    if (key === 'top4' || key === 'best4' || key === 'ベスト4' || key === '準決勝') {
      return isWin ? { rank: 2, label: '決勝' } : { rank: 4, label: 'ベスト4' };
    }
    if (key === '決勝') {
      return isWin ? { rank: 1, label: '優勝' } : { rank: 2, label: '決勝' };
    }
    return null;
  }

  function getTournamentPlacementLabel_(matches) {
    return getTournamentMatchRows_(matches)
      .map(row => getTournamentPlacementCandidate_(row.round, row.result === '○'))
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank)[0]?.label || '';
  }

  function formatDateFilterLabel_(value) {
    if (!value) return '';
    const parts = String(value).split('-');
    if (parts.length !== 3) return value;
    return `${Number(parts[0])}/${Number(parts[1])}/${Number(parts[2])}`;
  }

  function getSummaryDateFilterLabel_() {
    const environment = getSummaryEnvironmentById_(summaryEnvironmentFilterId_);
    if (environment) return environment.label;

    if (!summaryDateFilterFrom_ && !summaryDateFilterTo_) return '全期間';
    const from = summaryDateFilterFrom_ ? formatDateFilterLabel_(summaryDateFilterFrom_) : '指定なし';
    const to = summaryDateFilterTo_ ? formatDateFilterLabel_(summaryDateFilterTo_) : '指定なし';
    return `${from} - ${to}`;
  }

  function getTodayDateValue_() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}-${pad2_(d.getDate())}`;
  }

  function getMonthValue_(dateValue) {
    const value = parseMatchDateValue_(dateValue) || getTodayDateValue_();
    return value.slice(0, 7);
  }

  function shiftMonthValue_(monthValue, diff) {
    const [year, month] = String(monthValue || getTodayDateValue_().slice(0, 7)).split('-').map(Number);
    const d = new Date(year, (month || 1) - 1 + diff, 1);
    return `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}`;
  }

  function renderSummaryDateCalendarHtml_() {
    if (!summaryDatePickerTarget_) return '';

    const selectedValue = summaryDatePickerTarget_ === 'from'
      ? summaryDateFilterDraftFrom_
      : summaryDateFilterDraftTo_;
    const monthValue = summaryDatePickerMonth_ || getMonthValue_(selectedValue);
    const [year, month] = monthValue.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const today = getTodayDateValue_();
    const blanks = Array.from({ length: firstDay }, () => '<span class="match-summary-calendar-blank"></span>').join('');
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const value = `${year}-${pad2_(month)}-${pad2_(day)}`;
      const classes = [
        'match-summary-calendar-day',
        value === selectedValue ? 'is-selected' : '',
        value === today ? 'is-today' : '',
      ].filter(Boolean).join(' ');
      return `<button type="button" class="${classes}" data-match-summary-date-pick="${value}">${day}</button>`;
    }).join('');

    return `
      <div class="match-summary-calendar" data-match-summary-calendar>
        <div class="match-summary-calendar-head">
          <button type="button" data-match-summary-month-prev aria-label="前の月">‹</button>
          <strong>${year}年${month}月</strong>
          <button type="button" data-match-summary-month-next aria-label="次の月">›</button>
        </div>
        <div class="match-summary-calendar-week">
          <span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span>
        </div>
        <div class="match-summary-calendar-days">
          ${blanks}${days}
        </div>
        <div class="match-summary-calendar-foot">
          <button type="button" data-match-summary-date-clear>日付を消す</button>
          <button type="button" data-match-summary-date-today>今日</button>
        </div>
      </div>
    `;
  }

  function renderSummaryEnvironmentSelectHtml_(selectedId) {
    const selectedEnvironment = getSummaryEnvironmentById_(selectedId);
    const options = summaryEnvironmentCatalog_
      .slice()
      .sort((a, b) => ymdToTime_(b.startAt) - ymdToTime_(a.startAt))
      .map(env => {
        const selected = env.envId === selectedId ? ' selected' : '';
        return `<option value="${escapeHtml_(env.envId)}"${selected}>${escapeHtml_(env.label)}</option>`;
      })
      .join('');
    const disabledAttr = summaryEnvironmentCatalog_.length ? '' : ' disabled';
    const rangeText = selectedEnvironment
      ? `${formatDateFilterLabel_(selectedEnvironment.startAt)} - ${selectedEnvironment.endAt ? formatDateFilterLabel_(selectedEnvironment.endAt) : '指定なし'}`
      : '';
    const metaHtml = selectedEnvironment
      ? `
        <div class="match-summary-environment-meta">
          <span>期間：${escapeHtml_(rangeText)}</span>
          ${selectedEnvironment.note ? `<span>${escapeHtml_(selectedEnvironment.note)}</span>` : ''}
        </div>
      `
      : '';

    return `
      <label class="match-summary-environment-field">
        <span>環境から選ぶ</span>
        <select class="match-summary-environment-select" data-match-summary-environment-select${disabledAttr}>
          <option value="">環境を選択</option>
          ${options}
        </select>
      </label>
      ${metaHtml}
    `;
  }

  function renderSummaryTournamentOptionsHtml_(selectedName) {
    const options = getSummaryTournamentOptions_();
    if (!options.length) {
      return '<div class="match-summary-tournament-empty">大会情報がある戦績がありません</div>';
    }

    const selectedKey = normalizeTournamentText_(selectedName);
    return `
      <div class="match-summary-tournament-options">
        ${options.map(name => {
          const checked = normalizeTournamentText_(name) === selectedKey ? ' checked' : '';
          return `
            <label class="match-summary-tournament-option">
              <input type="radio" name="summaryTournamentFilter" value="${escapeHtml_(name)}"${checked}>
              <span>${escapeHtml_(name)}</span>
            </label>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderSummaryTournamentListHtml_(matches) {
    const rows = getTournamentMatchRows_(matches);
    if (!rows.length) {
      return '<div class="match-summary-tournament-list-empty">大会戦績がありません</div>';
    }

    return `
      <div class="match-summary-tournament-list">
        ${rows.map(row => `
          <div class="match-summary-tournament-row">
            <div class="match-summary-tournament-main">
              <span class="match-summary-tournament-round">${escapeHtml_(row.round || '-')}</span>
              <span class="match-summary-tournament-result ${row.result === '○' ? 'is-win' : 'is-lose'}">${escapeHtml_(row.result)}</span>
              <span class="match-summary-tournament-vs">対 ${escapeHtml_(row.opponentDeck || '未入力')}</span>
            </div>
            <div class="match-summary-tournament-sub">
              ${row.playerName ? `<span>vs ${escapeHtml_(row.playerName)}</span>` : '<span></span>'}
              <strong>${escapeHtml_(row.score)}</strong>
            </div>
          </div>
        `).join('')}
      </div>
    `;
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

  function getOpponentRaceByDeck_(deckName) {
    const name = String(deckName || '').trim();
    if (!name) return '';

    const groups = getOpponentGroups_();
    const customMap = readCustomOpponentDecks_();
    const hit = groups.find(group => {
      const raceOther = `${group.race}その他`;
      const baseList = [...(group.list || []), raceOther];
      const customList = customMap[group.race] || [];
      return [...baseList, ...customList].includes(name);
    });

    return hit?.race || 'その他';
  }

  function getMainRaceFromTierValue_(value) {
    const races = Array.isArray(value)
      ? value
      : String(value || '').split(/[,\s、/／]+/);
    const normalized = races.map(race => String(race || '').trim()).filter(Boolean);
    const mainRaces = ['ドラゴン', 'アンドロイド', 'エレメンタル', 'ルミナス', 'シェイド'];
    const mainRace = mainRaces.find(race => normalized.includes(race));
    return mainRace || normalized.find(race => race === '旧神' || race === 'イノセント') || '';
  }

  function getTierItemRace_(item) {
    return getMainRaceFromTierValue_(item?.race || item?.races);
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
      '旧神': 'var(--race-accent)',
    };
    return colorMap[String(race || '').trim()] || '#94a3b8';
  }

  function getRaceBgVar_(race) {
    const colorMap = {
      'ドラゴン': 'color-mix(in srgb, var(--race-dragon) 55%, #fff)',
      'アンドロイド': 'color-mix(in srgb, var(--race-android) 55%, #fff)',
      'エレメンタル': 'color-mix(in srgb, var(--race-elemental) 55%, #fff)',
      'ルミナス': 'color-mix(in srgb, var(--race-luminous) 58%, #fff)',
      'シェイド': 'color-mix(in srgb, var(--race-shade) 55%, #fff)',
      'イノセント': 'color-mix(in srgb, var(--race-innocent) 60%, #fff)',
      '旧神': 'color-mix(in srgb, var(--race-accent) 55%, #fff)',
    };
    return colorMap[String(race || '').trim()] || 'color-mix(in srgb, #94a3b8 55%, #fff)';
  }

  function getOpponentRaceStyle_(race) {
    return ` style="--match-opponent-race-color:${getRaceColorVar_(race)};"`;
  }

  function getMatchHistoryRaceStyle_(race) {
    const raceName = String(race || '').trim();
    const bgMap = {
      'ドラゴン': 'rgba(226, 69, 69, .14)',
      'アンドロイド': 'rgba(45, 190, 192, .14)',
      'エレメンタル': 'rgba(42, 183, 106, .14)',
      'ルミナス': 'rgba(232, 200, 43, .16)',
      'シェイド': 'rgba(139, 100, 184, .14)',
      'イノセント': 'rgba(154, 160, 166, .16)',
      '旧神': 'rgba(226, 69, 69, .12)',
    };
    if (!bgMap[raceName]) return '';
    const color = getRaceColorVar_(raceName);
    return ` style="--match-history-race-bg:${bgMap[raceName]};--match-history-race-border:color-mix(in srgb, ${color} 34%, transparent);"`;
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
    activeOpponentRace_ = raceName;
    setOpponentDeck_(deckName);
  }

  function getTierDeckTypesFromData_(data) {
    const latestEnvironment = Array.isArray(data?.environments) ? data.environments[0] : null;
    const allItems = Array.isArray(data?.items) ? data.items : [];
    const sources = Array.isArray(latestEnvironment?.items) && latestEnvironment.items.length
      ? latestEnvironment.items
      : allItems;
    const raceByDeckName = new Map();

    allItems.forEach(item => {
      const name = String(item?.deckName || '').trim();
      const race = getTierItemRace_(item);
      if (name && race) raceByDeckName.set(name, race);
    });

    const seen = new Set();
    return sources
      .map(item => {
        const name = String(item?.deckName || '').trim();
        return {
          name,
          tier: String(item?.tier || '未分類').trim().toUpperCase() || '未分類',
          race: getTierItemRace_(item) || raceByDeckName.get(name) || '',
        };
      })
      .filter(item => {
        const name = item.name;
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  function readTierCacheData_() {
    try {
      const raw = localStorage.getItem(TIER_CACHE_KEY_);
      if (!raw) return null;

      const cache = JSON.parse(raw);
      return cache?.data || cache || null;
    } catch (_) {
      return null;
    }
  }

  function saveTierCacheData_(data) {
    try {
      localStorage.setItem(TIER_CACHE_KEY_, JSON.stringify({
        savedAt: Date.now(),
        data,
      }));
    } catch (_) {}
  }

  function readTierDeckTypes_() {
    const data = readTierCacheData_();
    return data ? getTierDeckTypesFromData_(data) : [];
  }

  async function fetchLatestTierDeckTypes_() {
    const url = new URL(TIER_API_URL_);
    url.searchParams.set('mode', 'tierList');
    url.searchParams.set('force', '1');
    url.searchParams.set('_', String(Date.now()));

    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data || data.ok !== true || !Array.isArray(data.items)) {
      throw new Error('Tierデータの形式が不正です');
    }

    saveTierCacheData_(data);
    return getTierDeckTypesFromData_(data);
  }

  async function loadTierDeckTypes_() {
    try {
      return await fetchLatestTierDeckTypes_();
    } catch (error) {
      console.warn('[match-results] Tierデータを取得できませんでした。キャッシュを使用します。', error);
      return [];
    }
  }

  function getTierClassName_(tier) {
    const value = String(tier || '').trim().toLowerCase();
    return /^[a-z0-9_-]+$/.test(value) ? value : 'other';
  }

  function renderTierDeckTypeSections_(items) {
    const order = ['S', 'A', 'B', 'C', 'D', 'E', '未分類'];
    const grouped = new Map();
    items.forEach(item => {
      const tier = item.tier || '未分類';
      if (!grouped.has(tier)) grouped.set(tier, []);
      grouped.get(tier).push(item);
    });

    return Array.from(grouped.keys())
      .sort((a, b) => {
        const ai = order.includes(a) ? order.indexOf(a) : order.length;
        const bi = order.includes(b) ? order.indexOf(b) : order.length;
        return ai - bi || a.localeCompare(b, 'ja');
      })
      .map(tier => `
        <section class="match-opponent-tier-section">
          <h4 class="is-${escapeHtml_(getTierClassName_(tier))}">${escapeHtml_(tier)}ランク</h4>
          <div class="match-opponent-tier-list">
            ${grouped.get(tier).map(item => {
              const fallbackRace = getOpponentRaceByDeck_(item.name);
              const race = item.race || fallbackRace;
              const selectRace = item.race || (fallbackRace === 'その他' ? '' : fallbackRace);
              return `
                <button type="button" class="match-opponent-tier-option" data-opponent-tier-deck="${escapeHtml_(item.name)}" data-opponent-tier-race="${escapeHtml_(selectRace)}"${getOpponentRaceStyle_(race)}>
                  ${escapeHtml_(item.name)}
                </button>
              `;
            }).join('')}
          </div>
        </section>
      `).join('');
  }

  function ensureOpponentTierModal_() {
    let modal = document.getElementById('matchOpponentTierModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'matchOpponentTierModal';
    modal.className = 'match-opponent-tier-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="match-opponent-tier-backdrop" data-opponent-tier-close></div>
      <div class="match-opponent-tier-dialog" role="dialog" aria-modal="true" aria-labelledby="matchOpponentTierTitle">
        <div class="match-opponent-tier-head">
          <h3 id="matchOpponentTierTitle">ティア表から追加</h3>
          <button type="button" class="match-opponent-tier-close" data-opponent-tier-close aria-label="閉じる">×</button>
        </div>
        <div class="match-opponent-tier-body"></div>
        <p class="match-opponent-tier-credit">Tier表作成：神託のメソロギアDiscordコミュニティ「クラナンダ」</p>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  async function openOpponentTierModal_(race) {
    const raceName = String(race || activeOpponentRace_ || '').trim();
    const modal = ensureOpponentTierModal_();
    const body = modal.querySelector('.match-opponent-tier-body');
    const cachedDeckTypes = readTierDeckTypes_();

    modal.dataset.opponentTierRace = raceName;
    body.innerHTML = cachedDeckTypes.length
      ? renderTierDeckTypeSections_(cachedDeckTypes)
      : `
        <div class="match-opponent-tier-empty">
          ティア表データを取得中です...
        </div>
      `;
    modal.hidden = false;

    const latestDeckTypes = await loadTierDeckTypes_();
    const deckTypes = latestDeckTypes.length ? latestDeckTypes : cachedDeckTypes;
    body.innerHTML = deckTypes.length
      ? renderTierDeckTypeSections_(deckTypes)
      : `
        <div class="match-opponent-tier-empty">
          ティア表データを取得できませんでした。ティア表ページを開いてからもう一度試してください。
        </div>
      `;
  }

  function closeOpponentTierModal_() {
    const modal = document.getElementById('matchOpponentTierModal');
    if (!modal) return;
    modal.hidden = true;
  }

  function selectOpponentTierDeck_(name, race) {
    const modal = document.getElementById('matchOpponentTierModal');
    const raceName = String(race || modal?.dataset?.opponentTierRace || activeOpponentRace_ || '').trim();
    addCustomOpponentDeck_(raceName, name);
    closeOpponentTierModal_();
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
        <button type="button" class="match-opponent-race-tab match-opponent-tier-open" data-opponent-tier-open="${escapeHtml_(race)}">ティア表から選ぶ</button>
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

  function formatCompactDate_(date = new Date()) {
    return [
      date.getFullYear(),
      pad2_(date.getMonth() + 1),
      pad2_(date.getDate()),
    ].join('');
  }

  function sanitizeFileName_(value) {
    const name = String(value || '').trim() || 'deck';
    return name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40);
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
    const byOpponentRace = {};

    list.forEach(match => {
      const result = String(match?.result || '').toLowerCase();
      const key = String(match?.opponentDeck || match?.opponent || '未指定');
      const race = getOpponentRaceByDeck_(key) || 'その他';
      byOpponent[key] = byOpponent[key] || { total: 0, wins: 0, losses: 0 };
      byOpponent[key].total += 1;
      byOpponentRace[race] = byOpponentRace[race] || { total: 0, wins: 0, losses: 0 };
      byOpponentRace[race].total += 1;

      if (result === 'win') {
        wins += 1;
        byOpponent[key].wins += 1;
        byOpponentRace[race].wins += 1;
      } else if (result === 'lose') {
        losses += 1;
        byOpponent[key].losses += 1;
        byOpponentRace[race].losses += 1;
      }
    });

    Object.keys(byOpponent).forEach(key => {
      const item = byOpponent[key];
      item.winRate = item.total ? item.wins / item.total : 0;
    });
    Object.keys(byOpponentRace).forEach(key => {
      const item = byOpponentRace[key];
      item.winRate = item.total ? item.wins / item.total : 0;
    });

    return {
      ok: true,
      total,
      wins,
      losses,
      winRate: total ? wins / total : 0,
      byOpponent,
      byOpponentRace,
    };
  }

  function getVisibleMatches_() {
    let matches = cachedMatches_.slice();
    if (activeScope_ === 'deck') {
      const deckId = getScopeDeckId_();
      matches = deckId
        ? matches.filter(match => String(match?.deckId || '') === deckId)
        : [];
    }
    return matches
      .filter(isMatchInSummaryDateRange_)
      .filter(isMatchInSummaryTournament_);
  }

  function getVisibleMatchesBeforeDateFilter_() {
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
    overlay.classList.remove('is-summary-deck-peek');
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
    const isSummaryDeckPeek = !!thumbEl.closest('.match-summary-deck-modal');
    overlay.classList.toggle('is-summary-deck-peek', isSummaryDeckPeek);
    overlay.style.display = 'block';
    overlay.style.left = '';
    overlay.style.top = '';
    overlay.style.right = '8px';
    overlay.style.bottom = '20px';
    overlay.style.width = '';

    const choices = thumbEl.closest('.match-entry-deck-choices') || thumbEl.closest('.match-summary-deck-modal-dialog') || thumbEl;
    const rect = thumbEl.getBoundingClientRect();
    const widthRect = choices.getBoundingClientRect();
    const margin = 8;
    const minWidth = isSummaryDeckPeek ? 300 : 200;
    const maxLimit = isSummaryDeckPeek ? 460 : 360;
    const maxWidth = Math.min(Math.max(minWidth, widthRect.width), maxLimit, window.innerWidth - margin * 2);
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

  function ensureSummaryDeckSelectModal_() {
    let modal = document.getElementById('matchSummaryDeckSelectModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'matchSummaryDeckSelectModal';
    modal.className = 'match-summary-deck-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="match-summary-deck-modal-backdrop" data-match-summary-deck-select-close></div>
      <div class="match-summary-deck-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="matchSummaryDeckSelectTitle">
        <div class="match-summary-deck-modal-head">
          <h3 id="matchSummaryDeckSelectTitle">デッキ選択</h3>
          <button type="button" class="match-summary-deck-modal-close" data-match-summary-deck-select-close aria-label="閉じる">×</button>
        </div>
        <div class="match-summary-deck-modal-body" id="matchSummaryDeckSelectOptions"></div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function renderSummaryDeckSelectOptions_() {
    const root = document.getElementById('matchSummaryDeckSelectOptions');
    if (!root) return;

    const decks = getDecks_();
    const overallActive = activeScope_ !== 'deck';
    const overallHtml = `
      <div class="match-summary-deck-option${overallActive ? ' is-active' : ''}">
        <button type="button" class="match-summary-deck-option-main" data-match-summary-deck-option="-1">
          <span class="match-summary-deck-option-thumb">
            <img src="img/00000.webp" alt="" loading="lazy" onerror="this.src='img/00000.webp'">
          </span>
          <span class="match-summary-deck-option-body">
            <span class="match-summary-deck-option-name">全体</span>
            <span class="match-summary-deck-option-meta">すべての戦績</span>
          </span>
        </button>
      </div>
    `;
    const deckHtml = decks.map((deck, index) => {
      const mainCd = getDeckMainCd_(deck);
      const name = String(deck?.name || '').trim() || `デッキ${index + 1}`;
      const total = getDeckCardTotal_(deck);
      const active = activeScope_ === 'deck' && activeDeckIndex_ === index;
      const raceStyle = getDeckRaceStyle_(deck);
      return `
        <div class="match-summary-deck-option${active ? ' is-active' : ''}"${raceStyle}>
          <button type="button" class="match-summary-deck-option-main" data-match-summary-deck-option="${index}">
            <span class="match-summary-deck-option-thumb">
              <img src="img/${escapeHtml_(mainCd)}.webp" alt="" loading="lazy" onerror="this.src='img/00000.webp'">
            </span>
            <span class="match-summary-deck-option-body">
              <span class="match-summary-deck-option-name">${escapeHtml_(name)}</span>
              <span class="match-summary-deck-option-meta">${total}枚</span>
            </span>
          </button>
          <button type="button" class="match-summary-deck-peek-button" data-match-summary-deck-peek-index="${index}">リスト</button>
        </div>
      `;
    }).join('');

    root.innerHTML = overallHtml + (deckHtml || '<div class="match-summary-deck-option-empty">保存デッキがありません。</div>');
  }

  function openSummaryDeckSelectModal_(trigger) {
    const modal = ensureSummaryDeckSelectModal_();
    summaryDeckSelectLastFocus_ = trigger || document.activeElement;
    renderSummaryDeckSelectOptions_();
    modal.hidden = false;
    requestAnimationFrame(() => {
      const active = modal.querySelector('.match-summary-deck-option.is-active .match-summary-deck-option-main');
      const first = modal.querySelector('.match-summary-deck-option-main, .match-summary-deck-modal-close');
      (active || first)?.focus?.();
    });
  }

  function closeSummaryDeckSelectModal_() {
    const modal = document.getElementById('matchSummaryDeckSelectModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    try {
      summaryDeckSelectLastFocus_?.focus?.();
    } catch (_) {}
  }

  function selectSummaryDeckFromModal_(index) {
    const decks = getDecks_();
    if (index >= 0 && decks[index]) {
      activeDeckIndex_ = index;
      activeScope_ = 'deck';
    } else {
      activeDeckIndex_ = -1;
      activeScope_ = 'overall';
    }
    closeSummaryDeckSelectModal_();
    renderDecks_();
    renderCurrentMatches_();
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

  function getSummaryDeckMeta_() {
    const summaryDeck = activeScope_ === 'deck' ? getActiveDeck_() : null;
    const summaryDeckName = summaryDeck
      ? String(summaryDeck?.name || '').trim() || '名称未設定'
      : '全体';
    const summaryMainCd = summaryDeck ? getDeckMainCd_(summaryDeck) : '00000';
    const summaryRaceStyle = summaryDeck ? getDeckRaceStyle_(summaryDeck) : '';
    const summarySelectAttr = ` role="button" tabindex="0" data-match-summary-deck-select aria-haspopup="dialog" aria-label="表示するデッキを選択"`;
    const summaryThumbLabel = summaryDeck ? '' : '<span class="match-summary-thumb-empty">未選択</span>';
    return {
      summaryDeckName,
      summaryMainCd,
      summaryRaceStyle,
      summarySelectAttr,
      summaryThumbLabel,
    };
  }

  function renderSummaryPlaceholder_(message) {
    const root = document.getElementById('matchSummary');
    if (!root) return;

    const toolsHtml = renderSummaryChartToolsHtml_();
    const placeholderKey = [
      activeScope_,
      getScopeDeckId_(),
      activeSummaryChartTab_,
      summaryEnvironmentFilterId_,
      summaryEnvironmentCatalog_.map(env => env.envId).join(','),
      message || '',
      shouldShowHistoryRefresh_() ? getHistoryRefreshText_() : 'disabled',
    ].join('|');
    if (lastSummaryPlaceholderKey_ === placeholderKey && root.dataset.summaryState === 'placeholder') {
      updateHistoryActions_();
      return;
    }

    const {
      summaryDeckName,
      summaryMainCd,
      summaryRaceStyle,
      summarySelectAttr,
      summaryThumbLabel,
    } = getSummaryDeckMeta_();
    const summaryChartTabs = [
      { key: 'usage', label: '対面率' },
      { key: 'rate', label: '勝率' },
      { key: 'win', label: '勝利' },
      { key: 'lose', label: '敗北' },
    ];
    if (!summaryChartTabs.some(tab => tab.key === activeSummaryChartTab_)) {
      activeSummaryChartTab_ = 'usage';
    }

    root.innerHTML = `
      <div class="match-summary-grid"${summaryRaceStyle}>
        <span class="match-summary-thumb"${summarySelectAttr}>
          <img src="img/${escapeHtml_(summaryMainCd)}.webp" alt="" loading="lazy" onerror="this.src='img/00000.webp'">
          ${summaryThumbLabel}
        </span>
        <div class="match-summary-info">
          <div class="match-summary-title">${escapeHtml_(summaryDeckName)}</div>
          <div class="match-summary-stat">
            <span>試合数</span>
            <strong>--</strong>
          </div>
          <div class="match-summary-result">
            <strong>--勝--敗</strong>
            <span>（--%）</span>
          </div>
        </div>
      </div>
      <div class="match-summary-chart-tabs">
        ${toolsHtml}
        <div class="match-summary-chart-tab-list" role="tablist" aria-label="対面デッキタイプグラフの表示切り替え">
          ${summaryChartTabs.map(tab => {
            const active = tab.key === activeSummaryChartTab_;
            return `
              <button type="button" class="match-summary-chart-tab${active ? ' is-active' : ''}" data-match-summary-chart-tab="${tab.key}" role="tab" aria-selected="${active ? 'true' : 'false'}">
                <span>${escapeHtml_(tab.label)}</span>
                <strong>--</strong>
              </button>
            `;
          }).join('')}
        </div>
      </div>
      <div class="match-summary-chart-panels">
        <div class="match-summary-chart-panel is-active">
          <div class="match-summary-chart-card is-empty">
            <div class="match-summary-bar-empty">${escapeHtml_(message || '戦績を読み込み中...')}</div>
          </div>
        </div>
      </div>
    `;
    root.dataset.summaryState = 'placeholder';
    lastSummaryPlaceholderKey_ = placeholderKey;
  }

  function renderEmptyHistory_(message) {
    const body = document.getElementById('matchHistoryBody');
    renderSummaryPlaceholder_(message || '戦績はまだありません。');
    if (body) body.innerHTML = '';
  }

  function ensureHistoryActions_() {
  }

  function updateHistoryActions_() {
    const button = document.getElementById('matchHistoryRefresh');
    if (!button) {
      updateSummaryImageAction_();
      return;
    }

    const enabled = shouldShowHistoryRefresh_();
    button.hidden = false;
    button.disabled = !enabled;
    button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    button.textContent = getHistoryRefreshText_();
    button.title = getHistoryRefreshTitle_();
    button.setAttribute('aria-label', getHistoryRefreshTitle_());
    updateSummaryImageAction_();
  }

  function shouldShowHistoryRefresh_() {
    if (!isLoggedIn_() || matchesLoading_) return false;
    return matchesDirty_ || !matchesLoaded_;
  }

  function getHistoryRefreshText_() {
    return matchesDirty_ && matchesLoaded_ ? '戦績更新' : '戦績取得';
  }

  function getHistoryRefreshTitle_() {
    return matchesDirty_ && matchesLoaded_
      ? '未反映の戦績がある可能性があります。更新してください。'
      : '戦績を取得します。';
  }

  function getMatchImageUnavailableTitle_() {
    if (typeof html2canvas !== 'function') return '画像生成機能を読み込めませんでした。ページを再読み込みしてください。';
    if (typeof window.buildShareNodeForPreview !== 'function') return 'デッキ画像生成機能を読み込めませんでした。ページを再読み込みしてください。';
    if (!isLoggedIn_()) return 'ログイン後に画像保存できます。';
    if (matchesLoading_) return '戦績を読み込み中です。';
    if (!matchesLoaded_) return '先に戦績を取得してください。';
    if (activeScope_ !== 'deck') return '画像保存はデッキ別戦績で利用できます。';
    if (!getActiveDeck_()) return '画像保存するデッキを選択してください。';
    if (!getVisibleMatches_().length) return '画像保存できる戦績がありません。';
    return '';
  }

  function updateSummaryImageAction_() {
    const buttons = document.querySelectorAll('.match-summary-image-save');
    const disabledReason = getMatchImageUnavailableTitle_();
    const enabled = !disabledReason;
    buttons.forEach(button => {
      button.disabled = !enabled;
      button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      button.title = enabled ? 'デッキリストと戦績を画像保存します。' : disabledReason;
      button.setAttribute('aria-label', button.title);
    });
  }

  function renderSummaryChartToolsHtml_() {
    const canRefresh = shouldShowHistoryRefresh_();
    const label = getHistoryRefreshText_();
    const title = getHistoryRefreshTitle_();
    const disabledAttr = canRefresh ? ' aria-disabled="false"' : ' disabled aria-disabled="true"';
    const imageDisabledReason = getMatchImageUnavailableTitle_();
    const imageDisabledAttr = imageDisabledReason ? ' disabled aria-disabled="true"' : ' aria-disabled="false"';
    const imageTitle = imageDisabledReason || 'デッキリストと戦績を画像保存します。';
    const filterLabel = getSummaryDateFilterLabel_();
    const tournamentLabel = getSummaryTournamentFilterLabel_();
    const draftFrom = summaryDateFilterOpen_ ? summaryDateFilterDraftFrom_ : summaryDateFilterFrom_;
    const draftTo = summaryDateFilterOpen_ ? summaryDateFilterDraftTo_ : summaryDateFilterTo_;
    const draftEnvironmentId = summaryDateFilterOpen_ ? summaryEnvironmentFilterDraftId_ : summaryEnvironmentFilterId_;
    const draftTournamentName = summaryTournamentFilterOpen_ ? summaryTournamentFilterDraftName_ : summaryTournamentFilterName_;
    return `
      <div class="match-summary-chart-tools">
        <div class="match-summary-filter-group">
          <div class="match-summary-date-filter${summaryDateFilterOpen_ ? ' is-open' : ''}">
            <button type="button" class="match-summary-date-filter-button" data-match-summary-date-toggle aria-expanded="${summaryDateFilterOpen_ ? 'true' : 'false'}">
              <span>期間</span>
              <strong>${escapeHtml_(filterLabel)}</strong>
            </button>
            <div class="match-summary-date-filter-panel"${summaryDateFilterOpen_ ? '' : ' hidden'}>
              <div class="match-summary-date-fields">
                <label>
                  <span>開始</span>
                  <button type="button" class="match-summary-date-value" data-match-summary-date-open="from">${escapeHtml_(draftFrom ? formatDateFilterLabel_(draftFrom) : '開始日')}</button>
                </label>
                <label>
                  <span>終了</span>
                  <button type="button" class="match-summary-date-value" data-match-summary-date-open="to">${escapeHtml_(draftTo ? formatDateFilterLabel_(draftTo) : '終了日')}</button>
                </label>
              </div>
              ${renderSummaryEnvironmentSelectHtml_(draftEnvironmentId)}
              ${renderSummaryDateCalendarHtml_()}
              <div class="match-summary-date-filter-actions">
                <button type="button" data-match-summary-date-apply>適用</button>
                <button type="button" data-match-summary-date-reset>解除</button>
              </div>
            </div>
          </div>
          <div class="match-summary-tournament-filter${summaryTournamentFilterOpen_ ? ' is-open' : ''}">
            <button type="button" class="match-summary-date-filter-button match-summary-tournament-filter-button" data-match-summary-tournament-toggle aria-expanded="${summaryTournamentFilterOpen_ ? 'true' : 'false'}">
              <span>大会戦績</span>
              <strong>${escapeHtml_(tournamentLabel)}</strong>
            </button>
            <div class="match-summary-date-filter-panel match-summary-tournament-filter-panel"${summaryTournamentFilterOpen_ ? '' : ' hidden'}>
              ${renderSummaryTournamentOptionsHtml_(draftTournamentName)}
              <div class="match-summary-date-filter-actions">
                <button type="button" data-match-summary-tournament-apply>適用</button>
                <button type="button" data-match-summary-tournament-reset>解除</button>
              </div>
            </div>
          </div>
        </div>
        <div class="match-summary-chart-tool-actions">
          <button type="button" class="match-summary-tool-button match-summary-refresh" id="matchHistoryRefresh" title="${escapeHtml_(title)}" aria-label="${escapeHtml_(title)}"${disabledAttr}>${escapeHtml_(label)}</button>
          <button type="button" class="match-summary-tool-button match-summary-image-save" title="${escapeHtml_(imageTitle)}" aria-label="${escapeHtml_(imageTitle)}"${imageDisabledAttr}>画像保存</button>
        </div>
      </div>
    `;
  }

  async function waitMatchImageAssets_(root) {
    const images = Array.from(root.querySelectorAll('img'));
    await Promise.all(images.map(img => {
      if (img.complete && img.naturalWidth) return Promise.resolve();
      return new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
  }

  function getMatchExportOpponentItems_(summary) {
    return Object.entries(summary?.byOpponent || {}).map(([name, item]) => {
      const total = Number(item?.total || 0);
      const wins = Number(item?.wins || 0);
      const losses = Number(item?.losses || 0);
      const winRate = total ? wins / total : 0;
      return { name, total, wins, losses, winRate };
    })
      .filter(item => item.total >= 3)
      .sort((a, b) => b.winRate - a.winRate || b.total - a.total || a.name.localeCompare(b.name, 'ja'))
  }

  function getMatchExportOpponentRows_(summary) {
    const items = getMatchExportOpponentItems_(summary);
    if (activeSummaryChartTab_ !== 'rate' || matchImageOpponentSelection_.size === 0) {
      return items.slice(0, MATCH_IMAGE_OPPONENT_SELECTION_MAX_);
    }

    const selectedRows = items.filter(item => matchImageOpponentSelection_.has(item.name));
    return selectedRows.length ? selectedRows.slice(0, MATCH_IMAGE_OPPONENT_SELECTION_MAX_) : items.slice(0, MATCH_IMAGE_OPPONENT_SELECTION_MAX_);
  }

  function pruneMatchImageOpponentSelection_(items) {
    const names = new Set(items.map(item => item.name));
    Array.from(matchImageOpponentSelection_).forEach(name => {
      if (!names.has(name)) matchImageOpponentSelection_.delete(name);
    });
  }

  function toggleMatchImageOpponentSelection_(name) {
    const deckName = String(name || '').trim();
    if (!deckName) return;
    if (matchImageOpponentSelection_.has(deckName)) {
      matchImageOpponentSelection_.delete(deckName);
      return;
    }
    if (matchImageOpponentSelection_.size >= MATCH_IMAGE_OPPONENT_SELECTION_MAX_) {
      showMatchEntryToast_('戦績画像に載せる対面は5つまでです。');
      return;
    }
    matchImageOpponentSelection_.add(deckName);
  }

  function getMatchExportRaceBarColor_(race) {
    const colorMap = {
      'ドラゴン': 'rgba(226, 69, 69, .72)',
      'アンドロイド': 'rgba(45, 190, 192, .72)',
      'エレメンタル': 'rgba(42, 183, 106, .72)',
      'ルミナス': 'rgba(232, 200, 43, .78)',
      'シェイド': 'rgba(139, 100, 184, .72)',
      'イノセント': 'rgba(154, 160, 166, .76)',
      '旧神': 'rgba(226, 69, 69, .58)',
    };
    return colorMap[String(race || '').trim()] || 'rgba(100, 116, 139, .72)';
  }

  function getMatchExportPeriodText_() {
    const environment = getSummaryEnvironmentById_(summaryEnvironmentFilterId_);
    if (environment) {
      return environment.label || '';
    }
    if (!summaryDateFilterFrom_ && !summaryDateFilterTo_) return '';

    const from = summaryDateFilterFrom_ ? formatDateFilterLabel_(summaryDateFilterFrom_) : '指定なし';
    const to = summaryDateFilterTo_ ? formatDateFilterLabel_(summaryDateFilterTo_) : '指定なし';
    return `${from}~${to}`;
  }

  function renderMatchExportTournamentRowsHtml_() {
    const rows = getTournamentMatchRows_(getVisibleMatches_());
    return rows.map(row => `
      <div style="font-size:34px;font-weight:900;line-height:1.3;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${escapeHtml_(row.round || '-')} ${escapeHtml_(row.result)} 対 ${escapeHtml_(row.opponentDeck || '未入力')} <span style="color:#475569;">（${escapeHtml_(row.score)}）</span>
      </div>
    `).join('') || '<div style="color:#64748b;font-size:38px;font-weight:800;">大会戦績がありません</div>';
  }

  function renderMatchExportTournamentCardRowsHtml_() {
    const rows = getTournamentMatchRows_(getVisibleMatches_());
    return rows.map(row => {
      const isWin = row.result === '○';
      const race = getOpponentRaceByDeck_(row.opponentDeck);
      const raceColor = getMatchExportRaceBarColor_(race);
      const resultColor = isWin ? '#dc2626' : '#2563eb';
      const resultBg = isWin ? 'rgba(254,226,226,.94)' : 'rgba(219,234,254,.94)';
      return `
        <div style="display:grid;grid-template-columns:96px 66px minmax(0,1fr) 130px;align-items:center;gap:16px;padding:18px 20px;border:2px solid rgba(15,23,42,.10);border-left:16px solid ${raceColor};border-radius:18px;background:#fff;box-shadow:0 10px 22px rgba(15,23,42,.08);">
          <div style="display:flex;align-items:center;justify-content:center;height:58px;border-radius:14px;background:#f1f5f9;color:#334155;font-size:34px;font-weight:900;white-space:nowrap;">${escapeHtml_(row.round || '-')}</div>
          <div style="display:flex;align-items:center;justify-content:center;width:58px;height:58px;border-radius:999px;background:${resultBg};color:${resultColor};font-size:40px;font-weight:900;">${escapeHtml_(row.result)}</div>
          <div style="min-width:0;">
            <div style="font-size:42px;font-weight:900;line-height:1.18;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">対 ${escapeHtml_(row.opponentDeck || '未入力')}</div>
          </div>
          <div style="display:flex;align-items:center;justify-content:center;height:54px;border-radius:999px;background:#f8fafc;border:1px solid rgba(15,23,42,.10);color:#334155;font-size:38px;font-weight:900;font-variant-numeric:tabular-nums;">${escapeHtml_(row.score)}</div>
        </div>
      `;
    }).join('') || '<div style="color:#64748b;font-size:38px;font-weight:800;">大会戦績がありません</div>';
  }

  function buildMatchExportPanel_(summary) {
    const panel = document.createElement('aside');
    panel.className = 'match-export-panel';
    Object.assign(panel.style, {
      boxSizing: 'border-box',
      height: '100%',
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      gap: '24px',
      padding: '42px',
      border: '1px solid rgba(15,23,42,0.10)',
      borderLeft: '3px solid rgba(15,23,42,0.22)',
      borderRadius: '16px',
      background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
      boxShadow: '0 14px 34px rgba(2,6,23,0.10)',
      color: '#0f172a',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif',
    });

    const total = Number(summary?.total || 0);
    const wins = Number(summary?.wins || 0);
    const losses = Number(summary?.losses || 0);
    const rate = Math.round(Number(summary?.winRate || 0) * 1000) / 10;
    const rateText = `${Number.isFinite(rate) ? rate : 0}%`;
    const createdText = formatDateFilterLabel_(getTodayDateValue_());
    const periodText = getMatchExportPeriodText_();
    const placementText = isSummaryTournamentFilterActive_() ? getTournamentPlacementLabel_(getVisibleMatches_()) : '';

    const rateBlock = document.createElement('div');
    rateBlock.innerHTML = `
      <div style="margin-bottom:14px;color:#0f172a;font-size:48px;font-weight:900;line-height:1.1;letter-spacing:0;">
        モスロギア戦績
      </div>
      <div style="margin-bottom:22px;color:#475569;font-size:30px;font-weight:900;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        作成日：${escapeHtml_(createdText)}${periodText ? `（${escapeHtml_(periodText)}）` : ''}
      </div>
      <div style="font-size:34px;font-weight:800;color:#475569;">勝率</div>
      <div style="font-size:132px;font-weight:900;line-height:1;font-variant-numeric:tabular-nums;">${escapeHtml_(rateText)}</div>
      <div style="margin-top:14px;font-size:42px;font-weight:800;color:#334155;">${total}戦 / ${wins}勝${losses}敗</div>
    `;
    if (placementText) {
      rateBlock.style.position = 'relative';
      rateBlock.style.paddingRight = '220px';
      const placement = document.createElement('div');
      Object.assign(placement.style, {
        position: 'absolute',
        right: '0',
        top: '174px',
        width: '190px',
        boxSizing: 'border-box',
        padding: '16px 18px',
        border: '2px solid rgba(15,23,42,.10)',
        borderRadius: '18px',
        background: '#f8fafc',
        boxShadow: '0 8px 18px rgba(15,23,42,.06)',
      });
      placement.innerHTML = `
        <div style="color:#64748b;font-size:24px;font-weight:900;line-height:1.1;">最高到達</div>
        <div style="margin-top:6px;color:#0f172a;font-size:40px;font-weight:900;line-height:1.05;white-space:nowrap;">${escapeHtml_(placementText)}</div>
      `;
      rateBlock.append(placement);
    }

    const ranking = document.createElement('div');
    if (isSummaryTournamentFilterActive_()) {
      ranking.innerHTML = `
        <div style="font-size:48px;font-weight:900;margin-bottom:24px;">大会一覧</div>
        <div style="display:grid;gap:22px;">
          ${renderMatchExportTournamentCardRowsHtml_()}
        </div>
      `;
    } else {
      const opponentRows = getMatchExportOpponentRows_(summary);
      const rows = opponentRows.map(item => {
        const pct = Math.round(item.winRate * 1000) / 10;
        const bar = Math.max(4, Math.min(100, pct));
        const color = getMatchExportRaceBarColor_(getOpponentRaceByDeck_(item.name));
        return `
          <div style="display:grid;grid-template-columns:minmax(0,1fr) 108px;gap:14px;align-items:center;">
            <div style="min-width:0;">
              <div style="display:flex;justify-content:space-between;gap:14px;align-items:baseline;">
                <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:42px;font-weight:900;">対 ${escapeHtml_(item.name)}</span>
                <span style="flex:0 0 auto;color:#64748b;font-size:34px;font-weight:800;">${item.wins}勝${item.losses}敗</span>
              </div>
              <div style="height:50px;margin-top:12px;border-radius:999px;background:#e5e7eb;overflow:hidden;">
                <span style="display:block;width:${bar}%;height:100%;border-radius:999px;background:${color};"></span>
              </div>
            </div>
            <span style="text-align:right;font-size:46px;font-weight:900;font-variant-numeric:tabular-nums;">${Number.isFinite(pct) ? pct : 0}%</span>
          </div>
        `;
      }).join('');
      ranking.innerHTML = `
        <div style="font-size:48px;font-weight:900;margin-bottom:24px;">対面勝率</div>
        <div style="display:grid;gap:30px;">
          ${rows || '<div style="color:#64748b;font-size:38px;font-weight:800;">対面データなし</div>'}
        </div>
        <div style="margin:22px 0 0;color:#64748b;font-size:26px;font-weight:800;">※試合数が少ないものは省いています</div>
      `;
    }

    panel.append(rateBlock, ranking);
    return panel;
  }

  async function buildMatchExportNode_(deck, summary) {
    if (typeof window.ensureCardMapLoaded === 'function') {
      await window.ensureCardMapLoaded();
    }

    const deckData = window.buildDeckSummaryDataForPreview({
      deck: deck.cardCounts || {},
      deckName: String(deck.name || '').trim() || 'デッキ',
      representativeCd: deck.m || getDeckMainCd_(deck),
      mainRace: getDeckRace_(deck),
      showCredit: false,
      brandUrl: 'https://mosurogia.github.io/mesorogia-cards/match-results.html',
    });
    const deckSpec = window.getCanvasSpecForPreview('3:4', deckData.uniqueList?.length || 0);
    deckSpec.brandUrl = 'https://mosurogia.github.io/mesorogia-cards/match-results.html';
    deckSpec.showCredit = false;

    const deckNode = await window.buildShareNodeForPreview(deckData, deckSpec);
    deckNode.lastElementChild?.remove();
    const bodyHeight = deckSpec.height - deckSpec.footerH - 6;
    Object.assign(deckNode.style, {
      position: 'relative',
      left: 'auto',
      top: 'auto',
      width: '100%',
      height: `${bodyHeight}px`,
      gridTemplateRows: `${deckSpec.headerH}px auto`,
    });

    const root = document.createElement('div');
    root.className = 'match-export-root';
    const rightWidth = Math.round(deckSpec.width * 40 / 60);
    const footerHeight = 84;
    const rootPadding = 24;
    const columnGap = 24;
    const rowGap = 6;
    Object.assign(root.style, {
      position: 'fixed',
      left: '-9999px',
      top: '0',
      width: `${deckSpec.width + rightWidth + columnGap + rootPadding * 2}px`,
      height: `${bodyHeight + footerHeight + rowGap + rootPadding * 2}px`,
      boxSizing: 'border-box',
      padding: `${rootPadding}px`,
      display: 'grid',
      gridTemplateRows: `minmax(0, 1fr) ${footerHeight}px`,
      gap: `${rowGap}px`,
      background: '#fff',
      color: '#0f172a',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif',
    });

    const body = document.createElement('div');
    Object.assign(body.style, {
      display: 'grid',
      gridTemplateColumns: '60fr 40fr',
      gap: `${columnGap}px`,
      minHeight: '0',
    });
    body.append(deckNode, buildMatchExportPanel_(summary));

    const footer = document.createElement('footer');
    Object.assign(footer.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: '20px',
      padding: '8px 14px',
      border: '1px solid rgba(15,23,42,0.10)',
      borderRadius: '12px',
      background: '#f8fafc',
      boxShadow: '0 14px 34px rgba(2,6,23,0.08)',
      color: '#475569',
      fontSize: '24px',
      fontWeight: '800',
    });
    const url = document.createElement('span');
    url.textContent = 'https://mosurogia.github.io/mesorogia-cards/';
    footer.append(url);

    root.append(body, footer);
    return root;
  }

  async function exportMatchSummaryImage_() {
    const disabledReason = getMatchImageUnavailableTitle_();
    if (disabledReason) {
      alert(disabledReason);
      return;
    }
    if (window.__isExportingMatchImg) return;

    const deck = getActiveDeck_();
    const matches = getVisibleMatches_();
    const summary = buildSummaryFromMatches_(matches);
    const fileName = `${sanitizeFileName_(deck?.name || 'deck')}-match-${formatCompactDate_()}.png`;
    const loader = window.__DeckImgLoading?.show?.('戦績画像生成中...');
    let node = null;

    window.__isExportingMatchImg = true;
    try {
      node = await buildMatchExportNode_(deck, summary);
      document.body.appendChild(node);
      await waitMatchImageAssets_(node);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const scale = Math.max(2, Math.min(3, window.devicePixelRatio || 1));
      const canvas = await html2canvas(node, {
        scale,
        useCORS: true,
        backgroundColor: '#fff',
        scrollX: 0,
        scrollY: 0,
        width: node.scrollWidth,
        height: node.scrollHeight,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        allowTaint: false,
      });
      if (typeof window.showDeckImgPreviewModal === 'function') {
        window.showDeckImgPreviewModal(canvas, fileName);
      } else {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = fileName;
        link.click();
      }
    } catch (error) {
      console.error('[match-results] 戦績画像生成に失敗しました:', error);
      alert('戦績画像の生成に失敗しました。ページを再読み込みしてからもう一度お試しください。');
    } finally {
      node?.remove();
      window.__isExportingMatchImg = false;
      window.__DeckImgLoading?.hide?.(loader);
    }
  }

  function renderSummary_(summaryRes) {
    const root = document.getElementById('matchSummary');
    if (!root) return;
    if (!summaryRes?.ok) {
      renderSummaryPlaceholder_('戦績を読み込めませんでした。');
      return;
    }
    lastSummaryPlaceholderKey_ = '';
    delete root.dataset.summaryState;

    const wins = Number(summaryRes.wins || 0);
    const losses = Number(summaryRes.losses || 0);
    const total = Number(summaryRes.total || 0);
    const rate = Math.round((Number(summaryRes.winRate || 0) * 1000)) / 10;
    const {
      summaryDeckName,
      summaryMainCd,
      summaryRaceStyle,
      summarySelectAttr,
      summaryThumbLabel,
    } = getSummaryDeckMeta_();
    const rateDisplay = `${Number.isFinite(rate) ? rate : 0}%`;
    const isTournamentSummary = isSummaryTournamentFilterActive_();
    const visibleMatches = getVisibleMatches_();
    const summaryChartTabs = [
      { key: 'usage', label: '対面率', total },
      { key: 'rate', label: isTournamentSummary ? '大会一覧' : '勝率', total, displayValue: isTournamentSummary ? total : rateDisplay },
      { key: 'win', label: '勝利', total: wins },
      { key: 'lose', label: '敗北', total: losses },
    ];
    if (!summaryChartTabs.some(tab => tab.key === activeSummaryChartTab_)) {
      activeSummaryChartTab_ = 'usage';
    }
    const opponentItems = Object.entries(summaryRes.byOpponent || {}).map(([name, item]) => {
      const opponentTotal = Number(item?.total || 0);
      const opponentWins = Number(item?.wins || 0);
      const opponentLosses = Number(item?.losses || 0);
      return {
        name,
        total: opponentTotal,
        wins: opponentWins,
        losses: opponentLosses,
        winRate: opponentTotal ? opponentWins / opponentTotal : 0,
      };
    });
    const getChartItems_ = tab => {
      const withValues = opponentItems.map(item => {
        if (tab.key === 'win') {
          return {
            name: item.name,
            count: item.wins,
            countLabel: `${item.wins}勝`,
            percent: tab.total ? item.wins / tab.total : 0,
          };
        }
        if (tab.key === 'lose') {
          return {
            name: item.name,
            count: item.losses,
            countLabel: `${item.losses}敗`,
            percent: tab.total ? item.losses / tab.total : 0,
          };
        }
        if (tab.key === 'rate') {
          const ratePercent = Math.round((item.winRate || 0) * 1000) / 10;
          return {
            name: item.name,
            count: item.total,
            countLabel: `${item.wins}勝${item.losses}敗`,
            percent: item.winRate,
            rateLabel: `${Number.isFinite(ratePercent) ? ratePercent : 0}%`,
            isRate: true,
          };
        }
        return {
          name: item.name,
          count: item.total,
          countLabel: `${item.total}戦`,
          percent: tab.total ? item.total / tab.total : 0,
        };
      }).filter(item => tab.key === 'rate' ? item.count >= 3 : item.count > 0);

      if (tab.key === 'rate') {
        return withValues.sort((a, b) => b.percent - a.percent || b.count - a.count || a.name.localeCompare(b.name));
      }
      return withValues.sort((a, b) => b.count - a.count || b.percent - a.percent || a.name.localeCompare(b.name));
    };
    const summaryChartPanels = summaryChartTabs.map(tab => {
      if (tab.key === 'rate' && isTournamentSummary) {
        const active = tab.key === activeSummaryChartTab_;
        return `
          <div class="match-summary-chart-panel${active ? ' is-active' : ''}"${active ? '' : ' hidden'}>
            ${renderSummaryTournamentListHtml_(visibleMatches)}
          </div>
        `;
      }

      const chartItems = getChartItems_(tab);
      if (tab.key === 'rate') pruneMatchImageOpponentSelection_(chartItems);
      const canPickMatchImageOpponents = tab.key === 'rate' && !getMatchImageUnavailableTitle_();
      const shownItems = summaryChartExpanded_ ? chartItems : chartItems.slice(0, 5);
      const hiddenCount = Math.max(0, chartItems.length - 5);
      const maxBarCount = chartItems.reduce((max, item) => Math.max(max, Number(item.count || 0)), 0);
      const barRowsHtml = shownItems.length
        ? shownItems.map(item => {
          const percent = Math.round((item.percent || 0) * 1000) / 10;
          const relativePercent = tab.key === 'rate'
            ? percent
            : maxBarCount ? (Number(item.count || 0) / maxBarCount) * 100 : 0;
          const barPercent = Math.max(0, Math.min(100, relativePercent));
          const barColor = getRaceBgVar_(getOpponentRaceByDeck_(item.name));
          const selectedForImage = canPickMatchImageOpponents && matchImageOpponentSelection_.has(item.name);
          const disabledForImage = canPickMatchImageOpponents
            && !selectedForImage
            && matchImageOpponentSelection_.size >= MATCH_IMAGE_OPPONENT_SELECTION_MAX_;
          const nameHtml = canPickMatchImageOpponents
            ? `
              <span class="match-summary-bar-name-wrap">
                <button type="button" class="match-summary-export-pick${selectedForImage ? ' is-selected' : ''}" data-match-summary-export-pick="${escapeHtml_(item.name)}" aria-pressed="${selectedForImage ? 'true' : 'false'}" aria-label="${escapeHtml_(item.name)}を戦績画像に載せる"${disabledForImage ? ' disabled aria-disabled="true"' : ''}></button>
                <span class="match-summary-bar-name">${escapeHtml_(item.name)}</span>
              </span>
            `
            : `<span class="match-summary-bar-name">${escapeHtml_(item.name)}</span>`;
          return `
            <div class="match-summary-bar-row${item.isRate ? ' is-rate' : ''}" style="--match-summary-bar-color:${barColor};">
              ${nameHtml}
              <span class="match-summary-bar-track" aria-hidden="true">
                <span class="match-summary-bar-fill" style="--match-summary-bar-percent:${barPercent}%;">
                  <span>${escapeHtml_(item.countLabel)}</span>
                </span>
              </span>
              <span class="match-summary-bar-rate">${escapeHtml_(item.rateLabel || `${Number.isFinite(percent) ? percent : 0}%`)}</span>
            </div>
          `;
        }).join('')
        : `<div class="match-summary-bar-empty">${escapeHtml_(tab.label)}の対面データなし</div>`;
      const moreHtml = hiddenCount > 0
        ? `
          <div class="match-summary-bar-more">
            <span class="match-summary-bar-separator" aria-hidden="true"></span>
            <button type="button" class="match-summary-bar-more-button" data-match-summary-chart-more>
              ${summaryChartExpanded_ ? 'その他を閉じる ▲' : `その他${hiddenCount}種類を見る ▼`}
            </button>
          </div>
        `
        : '';
      const rateNoteHtml = tab.key === 'rate'
        ? '<div class="match-summary-bar-note">※試合数が少ないものは省いています</div>'
        : '';
      const imagePickNoteHtml = canPickMatchImageOpponents
        ? `<div class="match-summary-bar-note">左の□を選ぶと、戦績画像に載せる対面を最大${MATCH_IMAGE_OPPONENT_SELECTION_MAX_}件まで指定できます。</div>`
        : '';
      const chartLabel = chartItems.length
        ? `${tab.label}：${chartItems.map(item => `${item.name}${item.countLabel}`).join('、')}`
        : `${tab.label}：対面データなし`;
      const active = tab.key === activeSummaryChartTab_;
      const chartStateClass = tab.total > 0 ? '' : ' is-empty';

      return `
        <div class="match-summary-chart-panel${active ? ' is-active' : ''}" data-match-summary-chart-panel="${tab.key}"${active ? '' : ' hidden'}>
          <div class="match-summary-chart-card${chartStateClass}" role="img" aria-label="${escapeHtml_(chartLabel)}">
            <div class="match-summary-bar-list">
              ${barRowsHtml}
              ${moreHtml}
              ${imagePickNoteHtml}
              ${rateNoteHtml}
            </div>
          </div>
        </div>
      `;
    }).join('');

    root.innerHTML = `
      <div class="match-summary-grid"${summaryRaceStyle}>
        <span class="match-summary-thumb"${summarySelectAttr}>
          <img src="img/${escapeHtml_(summaryMainCd)}.webp" alt="" loading="lazy" onerror="this.src='img/00000.webp'">
          ${summaryThumbLabel}
        </span>
        <div class="match-summary-info">
          <div class="match-summary-title">${escapeHtml_(summaryDeckName)}</div>
          <div class="match-summary-stat">
            <span>試合数</span>
            <strong>${total}</strong>
          </div>
          <div class="match-summary-result">
            <strong>${wins}勝${losses}敗</strong>
            <span>（${Number.isFinite(rate) ? rate : 0}%）</span>
          </div>
        </div>
      </div>
      <div class="match-summary-chart-tabs">
        ${renderSummaryChartToolsHtml_()}
        <div class="match-summary-chart-tab-list" role="tablist" aria-label="対面デッキタイプグラフの表示切り替え">
          ${summaryChartTabs.map(tab => {
            const active = tab.key === activeSummaryChartTab_;
            return `
              <button type="button" class="match-summary-chart-tab${active ? ' is-active' : ''}" data-match-summary-chart-tab="${tab.key}" role="tab" aria-selected="${active ? 'true' : 'false'}">
                <span>${escapeHtml_(tab.label)}</span>
                <strong>${escapeHtml_(tab.displayValue ?? String(Number(tab.total || 0)))}</strong>
              </button>
            `;
          }).join('')}
        </div>
      </div>
      <div class="match-summary-chart-panels">
        ${summaryChartPanels}
      </div>
    `;
  }

  function getFullTournament_(matchOrTournament) {
    let data = matchOrTournament?.tournament || matchOrTournament?.tournamentInfo ||
      matchOrTournament?.tournamentJson || matchOrTournament?.tournamentJSON || matchOrTournament;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (_) {
        data = null;
      }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const names = (Array.isArray(data.names) ? data.names : [data.name])
      .map(name => String(name || '').trim())
      .filter(Boolean);
    const rounds = (Array.isArray(data.rounds) ? data.rounds : [data.round])
      .map(round => String(round || '').trim())
      .filter(Boolean);
    const opponent = String(data.opponent || '').trim();
    const format = String(data.format || '').trim().toUpperCase() === 'BO3' ? 'BO3' : 'BO1';
    const games = (Array.isArray(data.games) ? data.games : [])
      .map(item => {
        const game = Number(item?.game || 0) || 0;
        const result = String(item?.result || '').trim().toLowerCase();
        if (game < 1 || game > 3 || !['win', 'lose'].includes(result)) return null;
        return {
          game,
          label: String(item?.label || TOURNAMENT_GAME_LABELS_[game - 1] || `${game}試合目`).trim(),
          result,
        };
      })
      .filter(Boolean);

    if (!names.length && !rounds.length && !opponent && !games.length) return null;
    return { names, rounds, opponent, format, games };
  }

  function renderTournamentNameChipsHtml_(names) {
    return (Array.isArray(names) ? names : [])
      .map(name => String(name || '').trim())
      .filter(Boolean)
      .map(name => `
        <button type="button" class="match-tournament-name-chip" data-tournament-name-value="${escapeHtml_(name)}">
          <span class="match-tournament-name-label">${escapeHtml_(name)}</span>
          <span class="match-tournament-name-remove" aria-hidden="true">×</span>
        </button>
      `).join('');
  }

  function getStoredTournamentNames_() {
    try {
      const raw = localStorage.getItem(TOURNAMENT_NAME_HISTORY_KEY_);
      const list = JSON.parse(raw || '[]');
      if (!Array.isArray(list)) return [];
      return Array.from(new Set(list
        .map(name => String(name || '').trim())
        .filter(Boolean)))
        .slice(0, TOURNAMENT_NAME_HISTORY_MAX_);
    } catch (_) {
      return [];
    }
  }

  function rememberTournamentNames_(names) {
    const nextNames = (Array.isArray(names) ? names : [names])
      .map(name => String(name || '').trim())
      .filter(Boolean);
    if (!nextNames.length) return;

    const merged = [];
    nextNames.concat(getStoredTournamentNames_()).forEach(name => {
      if (!merged.includes(name)) merged.push(name);
    });
    try {
      localStorage.setItem(TOURNAMENT_NAME_HISTORY_KEY_, JSON.stringify(merged.slice(0, TOURNAMENT_NAME_HISTORY_MAX_)));
    } catch (_) {
      return;
    }
  }

  function renderTournamentNameHistoryHtml_(selectedNames) {
    const selected = new Set((Array.isArray(selectedNames) ? selectedNames : [])
      .map(name => String(name || '').trim())
      .filter(Boolean));
    return getStoredTournamentNames_()
      .filter(name => !selected.has(name))
      .slice(0, 12)
      .map(name => `
        <button type="button" class="match-tournament-history-chip" data-tournament-name-history-value="${escapeHtml_(name)}">
          <span>${escapeHtml_(name)}</span>
        </button>
      `).join('');
  }

  function renderTournamentNameHistory_(form) {
    const panel = getTournamentPanel_(form);
    const root = panel?.querySelector('[data-tournament-name-history]');
    if (!root) return;
    root.innerHTML = renderTournamentNameHistoryHtml_(getTournamentNames_(form));
  }

  function renderAllTournamentNameHistories_() {
    document.querySelectorAll('form').forEach(form => renderTournamentNameHistory_(form));
  }

  function renderTournamentRoundCheckboxesHtml_(rounds) {
    const selected = new Set((Array.isArray(rounds) ? rounds : []).map(round => String(round || '').trim()));
    const roundOptions = ['R1', 'R2', 'R3', 'R4', 'R5', 'TOP16', 'TOP8', '準々決勝', '準決勝', '決勝', 'その他'];
    return roundOptions.map(round => (
      `<label><input type="checkbox" name="tournamentRound" value="${escapeHtml_(round)}"${selected.has(round) ? ' checked' : ''}><span>${escapeHtml_(round)}</span></label>`
    )).join('');
  }

  function renderTournamentGameFieldsHtml_(tournament) {
    const format = String(tournament?.format || 'BO1').toUpperCase() === 'BO3' ? 'bo3' : 'bo1';
    const count = format === 'bo3' ? 3 : 1;
    const selected = new Map((Array.isArray(tournament?.games) ? tournament.games : [])
      .map(item => [Number(item?.game || 0) || 0, String(item?.result || '').toLowerCase()]));

    return TOURNAMENT_GAME_LABELS_.slice(0, count).map((label, index) => {
      const gameNo = index + 1;
      const name = `tournamentGame${gameNo}`;
      const result = selected.get(gameNo) || '';
      return `
        <fieldset class="match-tournament-game">
          <legend>${escapeHtml_(label)}</legend>
          <div class="match-choice-buttons">
            <label class="match-choice-button">
              <input type="radio" name="${name}" value="win"${result === 'win' ? ' checked' : ''}>
              <span>勝ち</span>
            </label>
            <label class="match-choice-button">
              <input type="radio" name="${name}" value="lose"${result === 'lose' ? ' checked' : ''}>
              <span>負け</span>
            </label>
          </div>
        </fieldset>
      `;
    }).join('');
  }

  function renderTournamentPanelHtml_(tournament, opts = {}) {
    const data = getFullTournament_(tournament) || { names: [], rounds: [], opponent: '', format: 'BO1', games: [] };
    const format = data.format === 'BO3' ? 'bo3' : 'bo1';
    const className = ['match-tournament-panel', 'match-entry-wide', opts.className || ''].filter(Boolean).join(' ');
    return `
      <details class="${className}" data-match-tournament-panel${opts.open ? ' open' : ''}>
        <summary>大会情報（任意）</summary>
        <div class="match-tournament-body">
          <label class="match-tournament-field">
            <span>大会名</span>
            <div class="match-tournament-add">
              <input type="text" maxlength="40" placeholder="大会名" data-tournament-name-input>
              <button type="button" data-tournament-name-add>+追加</button>
            </div>
            <div class="match-tournament-name-list" data-tournament-name-list aria-live="polite">
              ${renderTournamentNameChipsHtml_(data.names)}
            </div>
            <div class="match-tournament-name-history" data-tournament-name-history>
              ${renderTournamentNameHistoryHtml_(data.names)}
            </div>
          </label>

          <fieldset class="match-tournament-field">
            <legend>ラウンド</legend>
            <div class="match-tournament-rounds">
              ${renderTournamentRoundCheckboxesHtml_(data.rounds)}
            </div>
          </fieldset>

          <label class="match-tournament-field">
            <span>対戦相手</span>
            <input type="text" name="tournamentOpponent" maxlength="40" placeholder="対戦相手" value="${escapeHtml_(data.opponent)}">
          </label>

          <fieldset class="match-tournament-field">
            <legend>勝敗詳細</legend>
            <div class="match-tournament-format">
              <label><input type="radio" name="tournamentFormat" value="bo1"${format === 'bo1' ? ' checked' : ''}><span>BO1</span></label>
              <label><input type="radio" name="tournamentFormat" value="bo3"${format === 'bo3' ? ' checked' : ''}><span>BO3</span></label>
            </div>
            <div class="match-tournament-games" data-tournament-games>
              ${renderTournamentGameFieldsHtml_(data)}
            </div>
          </fieldset>
        </div>
      </details>
    `;
  }

  function renderTournamentSummaryHtml_(match) {
    const tournament = getFullTournament_(match);
    if (!tournament) return '';

    const names = tournament.names.join(' / ');
    const rounds = tournament.rounds.join(' / ');
    const games = tournament.games
      .sort((a, b) => a.game - b.game)
      .map(item => `${item.label || `${item.game}試合目`}：${resultLabel_(item.result)}`)
      .join('、');

    return `
      <div class="match-history-tournament">
        <div class="match-history-tournament-head">大会情報</div>
        <div class="match-history-tournament-lines">
          ${names ? `<span>大会名：${escapeHtml_(names)}</span>` : ''}
          ${rounds ? `<span>ラウンド：${escapeHtml_(rounds)}</span>` : ''}
          ${tournament.opponent ? `<span>対戦相手：${escapeHtml_(tournament.opponent)}</span>` : ''}
          ${tournament.format ? `<span>形式：${escapeHtml_(tournament.format)}</span>` : ''}
          ${games ? `<span>勝敗詳細：${escapeHtml_(games)}</span>` : ''}
        </div>
      </div>
    `;
  }

  function renderMatchEditForm_(item, matchId) {
    const result = String(item.result || '').toLowerCase();
    const priority = String(item.priority || '').toLowerCase();
    const opponent = item.opponentDeck || item.opponent || '';
    const memo = item.memo || '';
    const tournament = getFullTournament_(item);

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

        ${renderTournamentPanelHtml_(tournament, { open: !!tournament, className: 'match-history-edit-wide' })}

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
          const opponentRace = getOpponentRaceByDeck_(opponent);
          const result = item.result || '';
          const rating = item.rating || '';
          const priority = item.priority || '';
          const memo = item.memo || '';
          const tournamentHtml = renderTournamentSummaryHtml_(item);
          const editing = matchId && editingMatchId_ === matchId;
          const deckName = String(
            getDecks_().find(deck => String(deck?.id || '') === String(item.deckId || ''))?.name || ''
          ).trim();

          const showOwnDeck = activeScope_ !== 'deck';
          return `
            <article class="match-history-item" data-match-id="${escapeHtml_(matchId)}" data-opponent-race="${escapeHtml_(opponentRace)}"${getMatchHistoryRaceStyle_(opponentRace)}>
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
                  ${tournamentHtml}
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
    const body = document.getElementById('matchHistoryBody');
    renderSummaryPlaceholder_('戦績を読み込み中...');
    if (body) body.innerHTML = '';
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
      rememberTournamentNames_(cachedMatches_.flatMap(match => getFullTournament_(match)?.names || []));
      if (editingMatchId_ && !cachedMatches_.some(item => getMatchId_(item) === editingMatchId_)) editingMatchId_ = '';
      matchesLoaded_ = true;
      matchesDirty_ = false;
      matchesLoading_ = false;
      renderAllTournamentNameHistories_();
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

  function prepareMatchEntryValidation_(form) {
    if (!form) return;

    const resultInputs = Array.from(form.querySelectorAll('input[name="result"]'));
    resultInputs.forEach(input => input.setCustomValidity(''));
    if (!form.elements.result?.value) {
      resultInputs[0]?.setCustomValidity('勝敗の項目を選択してください。');
    }
    if (!String(form.elements.deckId?.value || '').trim()) {
      showMatchEntryToast_('自分のデッキを選択してください');
      return;
    }
    if (!String(form.elements.opponentDeck?.value || '').trim()) {
      showMatchEntryToast_('対戦デッキを選択してください');
      return;
    }
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

  function getTournamentPanel_(form) {
    return form?.querySelector?.('[data-match-tournament-panel]') || null;
  }

  function getTournamentNames_(form) {
    const panel = getTournamentPanel_(form);
    if (!panel) return [];
    return Array.from(panel.querySelectorAll('[data-tournament-name-value]'))
      .map(item => String(item.dataset.tournamentNameValue || '').trim())
      .filter(Boolean);
  }

  function renderTournamentNames_(form, names) {
    const panel = getTournamentPanel_(form);
    const root = panel?.querySelector('[data-tournament-name-list]');
    if (!root) return;

    const list = Array.from(new Set((Array.isArray(names) ? names : getTournamentNames_(form))
      .map(name => String(name || '').trim())
      .filter(Boolean)))
      .slice(0, TOURNAMENT_NAME_MAX_COUNT_);
    root.innerHTML = list.map(name => `
      <button type="button" class="match-tournament-name-chip" data-tournament-name-value="${escapeHtml_(name)}">
        <span class="match-tournament-name-label">${escapeHtml_(name)}</span>
        <span class="match-tournament-name-remove" aria-hidden="true">×</span>
      </button>
    `).join('');
    renderTournamentNameHistory_(form);
  }

  function addTournamentName_(form, rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return;
    const names = getTournamentNames_(form);
    rememberTournamentNames_(value);
    if (names.includes(value)) {
      renderTournamentNameHistory_(form);
      return;
    }
    if (names.length >= TOURNAMENT_NAME_MAX_COUNT_) {
      showMatchEntryToast_(`大会名は${TOURNAMENT_NAME_MAX_COUNT_}件まで追加できます`);
      renderAllTournamentNameHistories_();
      return;
    }
    renderTournamentNames_(form, names.concat(value));
    renderAllTournamentNameHistories_();
  }

  function getTournamentGameCount_(form) {
    const format = String(form?.elements?.tournamentFormat?.value || 'bo1').toLowerCase();
    return format === 'bo3' ? 3 : 1;
  }

  function readTournamentGames_(form) {
    return TOURNAMENT_GAME_LABELS_.map((label, index) => {
      const input = form?.querySelector?.(`input[name="tournamentGame${index + 1}"]:checked`);
      return input ? { game: index + 1, label, result: input.value } : null;
    }).filter(Boolean);
  }

  function renderTournamentGames_(form) {
    const root = form?.querySelector?.('[data-tournament-games]');
    if (!root) return;

    const selected = new Map(readTournamentGames_(form).map(item => [item.game, item.result]));
    const count = getTournamentGameCount_(form);
    root.innerHTML = TOURNAMENT_GAME_LABELS_.slice(0, count).map((label, index) => {
      const gameNo = index + 1;
      const name = `tournamentGame${gameNo}`;
      const result = selected.get(gameNo) || '';
      return `
        <fieldset class="match-tournament-game">
          <legend>${escapeHtml_(label)}</legend>
          <div class="match-choice-buttons">
            <label class="match-choice-button">
              <input type="radio" name="${name}" value="win"${result === 'win' ? ' checked' : ''}>
              <span>勝ち</span>
            </label>
            <label class="match-choice-button">
              <input type="radio" name="${name}" value="lose"${result === 'lose' ? ' checked' : ''}>
              <span>負け</span>
            </label>
          </div>
        </fieldset>
      `;
    }).join('');
  }

  function readTournamentFromForm_(form) {
    const panel = getTournamentPanel_(form);
    if (!panel) return null;

    const names = getTournamentNames_(form);
    const rounds = Array.from(panel.querySelectorAll('input[name="tournamentRound"]:checked'))
      .map(input => String(input.value || '').trim())
      .filter(Boolean);
    const opponent = String(form.elements.tournamentOpponent?.value || '').trim();
    const format = String(form.elements.tournamentFormat?.value || '').trim().toUpperCase();
    const games = readTournamentGames_(form);
    const hasValue = names.length || rounds.length || opponent || games.length;
    if (!hasValue) return null;

    return {
      names,
      rounds,
      opponent,
      format,
      games,
    };
  }

  function getTournamentDraftState_(form) {
    const panel = getTournamentPanel_(form);
    if (!panel) return { hasValue: false, isComplete: false, tournament: null };

    const tournament = readTournamentFromForm_(form);
    if (!tournament) return { hasValue: false, isComplete: false, tournament: null };

    const hasName = tournament.names.length > 0;
    const hasRound = tournament.rounds.length > 0;
    const hasGameResult = tournament.games.length >= getTournamentGameCount_(form);
    return {
      hasValue: true,
      isComplete: hasName && hasRound && hasGameResult,
      tournament,
    };
  }

  function getTournamentGameMatchResult_(tournament) {
    const games = Array.isArray(tournament?.games) ? tournament.games : [];
    const winCount = games.filter(game => String(game?.result || '').toLowerCase() === 'win').length;
    const loseCount = games.filter(game => String(game?.result || '').toLowerCase() === 'lose').length;
    if (winCount === loseCount) return '';
    return winCount > loseCount ? 'win' : 'lose';
  }

  function getTournamentResultMismatchMessage_(form, tournament, matchResult) {
    if (!tournament) return '';
    const result = String(matchResult || '').trim().toLowerCase();
    if (!['win', 'lose'].includes(result)) return '';

    const expectedCount = getTournamentGameCount_(form);
    const games = Array.isArray(tournament.games) ? tournament.games : [];
    if (games.length < expectedCount) return '';

    const gameResult = getTournamentGameMatchResult_(tournament);
    if (!gameResult || gameResult === result) return '';
    return '全体の勝敗と大会の勝敗詳細が一致していません';
  }

  function ensureTournamentConfirmModal_() {
    let modal = document.getElementById('matchTournamentConfirmModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'matchTournamentConfirmModal';
    modal.className = 'match-tournament-confirm-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="match-tournament-confirm-backdrop" data-tournament-confirm-cancel></div>
      <div class="match-tournament-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="matchTournamentConfirmTitle">
        <h3 id="matchTournamentConfirmTitle">大会情報が入力途中です</h3>
        <p>大会情報を保存するには、大会名・ラウンド・勝敗詳細を入力してください。</p>
        <div class="match-tournament-confirm-actions">
          <button type="button" class="btn ghost" data-tournament-confirm-cancel>編集しなおす</button>
          <button type="button" class="btn primary" data-tournament-confirm-discard>大会情報なしで登録</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function confirmIncompleteTournament_(actionLabel) {
    return new Promise(resolve => {
      const modal = ensureTournamentConfirmModal_();
      const discardButton = modal.querySelector('[data-tournament-confirm-discard]');
      const cancelButton = modal.querySelector('[data-tournament-confirm-cancel]');
      const close = result => {
        modal.hidden = true;
        modal.removeEventListener('click', onClick);
        modal.removeEventListener('keydown', onKeydown);
        resolve(result);
      };
      const onClick = event => {
        if (event.target.closest('[data-tournament-confirm-discard]')) {
          close(true);
          return;
        }
        if (event.target.closest('[data-tournament-confirm-cancel]')) {
          close(false);
        }
      };
      const onKeydown = event => {
        if (event.key === 'Escape') close(false);
      };

      if (discardButton) discardButton.textContent = `大会情報なしで${actionLabel}`;
      modal.addEventListener('click', onClick);
      modal.addEventListener('keydown', onKeydown);
      modal.hidden = false;
      requestAnimationFrame(() => {
        cancelButton?.focus?.();
      });
    });
  }

  async function resolveTournamentForSubmit_(form, actionLabel) {
    const draft = getTournamentDraftState_(form);
    if (!draft.hasValue) return { ok: true, tournament: null };
    if (draft.isComplete) return { ok: true, tournament: draft.tournament };

    getTournamentPanel_(form)?.setAttribute('open', '');
    const shouldDiscard = await confirmIncompleteTournament_(actionLabel);
    if (shouldDiscard) return { ok: true, tournament: null };
    return { ok: false, tournament: null };
  }

  function normalizeTournamentText_(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function normalizeTournamentValue_(value) {
    let data = value;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (_) {
        data = null;
      }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const names = (Array.isArray(data.names) ? data.names : [data.name])
      .map(normalizeTournamentText_)
      .filter(Boolean);
    const rounds = (Array.isArray(data.rounds) ? data.rounds : [data.round])
      .map(normalizeTournamentText_)
      .filter(Boolean);
    if (!names.length || !rounds.length) return null;

    return { names, rounds };
  }

  function getMatchTournament_(match) {
    return normalizeTournamentValue_(
      match?.tournament || match?.tournamentInfo || match?.tournamentJson || match?.tournamentJSON
    );
  }

  function hasTournamentDuplicate_(tournament, matches, excludeMatchId) {
    const next = normalizeTournamentValue_(tournament);
    if (!next) return false;

    const nameSet = new Set(next.names);
    const roundSet = new Set(next.rounds);
    const excludeId = String(excludeMatchId || '').trim();
    return (Array.isArray(matches) ? matches : []).some(match => {
      if (excludeId && getMatchId_(match) === excludeId) return false;
      const current = getMatchTournament_(match);
      if (!current) return false;
      return current.names.some(name => nameSet.has(name)) &&
        current.rounds.some(round => roundSet.has(round));
    });
  }

  function areTournamentDuplicateKeysEqual_(left, right) {
    const a = normalizeTournamentValue_(left);
    const b = normalizeTournamentValue_(right);
    if (!a && !b) return true;
    if (!a || !b) return false;

    const aNames = new Set(a.names);
    const aRounds = new Set(a.rounds);
    const sameNames = a.names.length === b.names.length && b.names.every(name => aNames.has(name));
    const sameRounds = a.rounds.length === b.rounds.length && b.rounds.every(round => aRounds.has(round));
    return sameNames && sameRounds;
  }

  async function getMatchesForTournamentDuplicateCheck_() {
    if (matchesLoaded_ && !matchesDirty_) return cachedMatches_;

    const listRes = await window.AccountMatchResults?.list?.({ limit: 1000 });
    if (!listRes?.ok) {
      throw new Error(listRes?.error || '戦績の重複確認に失敗しました。');
    }

    cachedMatches_ = normalizeMatches_(listRes);
    matchesLoaded_ = true;
    matchesDirty_ = false;
    return cachedMatches_;
  }

  async function isDuplicateTournamentEntry_(payload, excludeMatchId) {
    if (!normalizeTournamentValue_(payload?.tournament)) return false;
    const matches = await getMatchesForTournamentDuplicateCheck_();
    return hasTournamentDuplicate_(payload.tournament, matches, excludeMatchId);
  }

  function resetTournamentForm_(form) {
    const panel = getTournamentPanel_(form);
    if (!panel) return;

    renderTournamentNames_(form, []);
    const nameInput = panel.querySelector('[data-tournament-name-input]');
    if (nameInput) nameInput.value = '';
    panel.querySelectorAll('input[name="tournamentRound"]').forEach(input => {
      input.checked = false;
    });
    if (form.elements.tournamentOpponent) form.elements.tournamentOpponent.value = '';
    const bo1 = form.querySelector('input[name="tournamentFormat"][value="bo1"]');
    if (bo1) bo1.checked = true;
    renderTournamentGames_(form);
  }

  async function submitMatch_(form) {
    prepareMatchEntryValidation_(form);
    const deckId = form.elements.deckId?.value || '';
    const submit = document.getElementById('matchEntrySubmit');
    if (!isLoggedIn_()) {
      scheduleLoginRequiredPrompt_();
      form.reportValidity?.();
      return;
    }
    if (!deckId) {
      const deckInput = form.querySelector('input[name="entryDeckIndex"]');
      if (deckInput) {
        deckInput.setCustomValidity('使用デッキを選択してください。');
        deckInput.reportValidity();
        deckInput.setCustomValidity('');
      }
      showMatchEntryToast_('自分のデッキを選択してください');
      return;
    }
    if (!form.elements.opponentDeck.value) {
      const label = document.getElementById('matchOpponentLabel');
      renderFieldLabelValue_(label, '対戦デッキ：', '未選択（選択してください）', true);
      showMatchEntryToast_('対戦デッキを選択してください');
      return;
    }
    const resultInputs = Array.from(form.querySelectorAll('input[name="result"]'));
    resultInputs.forEach(input => input.setCustomValidity(''));
    if (!form.elements.result?.value) {
      const resultInput = resultInputs[0];
      resultInput?.setCustomValidity('勝敗の項目を選択してください。');
      resultInput?.reportValidity();
      return;
    }

    const tournamentResult = await resolveTournamentForSubmit_(form, '登録');
    if (!tournamentResult.ok) return;

    const payload = {
      deckId,
      playedAt: form.elements.playedAt.value,
      result: form.elements.result.value,
      opponentDeck: form.elements.opponentDeck.value,
      rating: '',
      priority: form.elements.priority?.value || '',
      memo: form.elements.memo.value,
      tournament: tournamentResult.tournament,
    };

    const tournamentMismatchMessage = getTournamentResultMismatchMessage_(form, payload.tournament, payload.result);
    if (tournamentMismatchMessage) {
      getTournamentPanel_(form)?.setAttribute('open', '');
      showMatchEntryToast_(tournamentMismatchMessage);
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.classList.add('is-loading');
      submit.setAttribute('aria-busy', 'true');
      submit.dataset.defaultText = submit.dataset.defaultText || submit.textContent || '登録';
      submit.textContent = '登録中...';
    }

    try {
      if (await isDuplicateTournamentEntry_(payload)) {
        getTournamentPanel_(form)?.setAttribute('open', '');
        showMatchEntryToast_('同じ大会・同じラウンドの戦績はすでに登録されています');
        return;
      }

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
      resetTournamentForm_(form);
      form.elements.playedAt.value = formatNow_();
      activeScope_ = deckId ? 'deck' : 'overall';
      matchesDirty_ = true;
      renderCurrentMatches_();
      showMatchEntryToast_('戦績を登録しました');
    } catch (e) {
      window.alert?.(e?.message || '登録に失敗しました。');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        submit.removeAttribute('aria-busy');
        submit.textContent = submit.dataset.defaultText || '登録';
      }
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

    const tournamentResult = await resolveTournamentForSubmit_(form, '保存');
    if (!tournamentResult.ok) return;

    const payload = {
      matchId,
      deckId: getMatchDeckId_(original),
      playedAt: original.playedAt || original.date || original.createdAt || '',
      result: form.elements.result?.value || '',
      opponentDeck,
      rating: original.rating || '',
      priority: form.elements.priority?.value || '',
      memo: form.elements.memo?.value || '',
      tournament: tournamentResult.tournament,
    };

    const tournamentMismatchMessage = getTournamentResultMismatchMessage_(form, payload.tournament, payload.result);
    if (tournamentMismatchMessage) {
      getTournamentPanel_(form)?.setAttribute('open', '');
      showMatchEntryToast_(tournamentMismatchMessage);
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.classList.add('is-loading');
      submit.setAttribute('aria-busy', 'true');
      submit.dataset.defaultText = submit.dataset.defaultText || submit.textContent || '保存';
      submit.textContent = '保存中...';
    }

    try {
      const tournamentChanged = !areTournamentDuplicateKeysEqual_(
        payload.tournament,
        original?.tournament || original?.tournamentInfo || original?.tournamentJson || original?.tournamentJSON
      );
      if (tournamentChanged && await isDuplicateTournamentEntry_(payload, matchId)) {
        getTournamentPanel_(form)?.setAttribute('open', '');
        showMatchEntryToast_('同じ大会・同じラウンドの戦績はすでに登録されています');
        return;
      }

      let usedReplace = false;
      let res = await window.AccountMatchResults?.update?.(payload);
      if (!res?.ok && shouldFallbackReplace_(res)) {
        const deleteRes = await window.AccountMatchResults?.remove?.(matchId);
        if (!deleteRes?.ok) {
          window.alert?.(deleteRes?.error || '古い戦績の削除に失敗しました。');
          return;
        }

        const addRes = await window.AccountMatchResults?.add?.(payload);
        if (!addRes?.ok) {
          matchesDirty_ = true;
          window.alert?.(addRes?.error || '古い戦績は削除しましたが、新しい内容の登録に失敗しました。戦績を更新して確認してください。');
          loadMatches_();
          return;
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
        await loadMatches_();
      } else {
        updateCachedMatch_(matchId, payload);
        renderCurrentMatches_();
      }
      showMatchEntryToast_('戦績を編集しました');
    } catch (e) {
      window.alert?.(e?.message || '保存に失敗しました。');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        submit.removeAttribute('aria-busy');
        submit.textContent = submit.dataset.defaultText || '保存';
      }
    }
  }

  function bindEvents_() {
    document.addEventListener('click', event => {
      const tournamentNameAdd = event.target.closest('[data-tournament-name-add]');
      if (tournamentNameAdd) {
        const form = tournamentNameAdd.closest('form');
        const input = form?.querySelector('[data-tournament-name-input]');
        addTournamentName_(form, input?.value);
        if (input) input.value = '';
        return;
      }

      const tournamentNameHistory = event.target.closest('[data-tournament-name-history-value]');
      if (tournamentNameHistory) {
        const form = tournamentNameHistory.closest('form');
        addTournamentName_(form, tournamentNameHistory.dataset.tournamentNameHistoryValue);
        return;
      }

      const tournamentNameChip = event.target.closest('[data-tournament-name-value]');
      if (tournamentNameChip) {
        const form = tournamentNameChip.closest('form');
        const value = String(tournamentNameChip.dataset.tournamentNameValue || '').trim();
        renderTournamentNames_(form, getTournamentNames_(form).filter(name => name !== value));
        return;
      }

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

      const dateToggle = event.target.closest('[data-match-summary-date-toggle]');
      if (dateToggle) {
        summaryDateFilterOpen_ = !summaryDateFilterOpen_;
        if (summaryDateFilterOpen_) {
          summaryTournamentFilterOpen_ = false;
          summaryDateFilterDraftFrom_ = summaryDateFilterFrom_;
          summaryDateFilterDraftTo_ = summaryDateFilterTo_;
          summaryEnvironmentFilterDraftId_ = summaryEnvironmentFilterId_;
          summaryDatePickerTarget_ = '';
          summaryDatePickerMonth_ = getMonthValue_(summaryDateFilterDraftFrom_ || summaryDateFilterDraftTo_);
        }
        renderCurrentMatches_();
        return;
      }

      const tournamentToggle = event.target.closest('[data-match-summary-tournament-toggle]');
      if (tournamentToggle) {
        summaryTournamentFilterOpen_ = !summaryTournamentFilterOpen_;
        if (summaryTournamentFilterOpen_) {
          summaryDateFilterOpen_ = false;
          summaryDatePickerTarget_ = '';
          summaryTournamentFilterDraftName_ = summaryTournamentFilterName_;
        }
        renderCurrentMatches_();
        return;
      }

      const tournamentOption = event.target.closest('input[name="summaryTournamentFilter"]');
      if (tournamentOption) {
        summaryTournamentFilterDraftName_ = String(tournamentOption.value || '').trim();
        renderCurrentMatches_();
        return;
      }

      if (event.target.closest('[data-match-summary-tournament-apply]')) {
        summaryTournamentFilterName_ = summaryTournamentFilterDraftName_;
        summaryTournamentFilterOpen_ = false;
        summaryChartExpanded_ = false;
        renderCurrentMatches_();
        return;
      }

      if (event.target.closest('[data-match-summary-tournament-reset]')) {
        summaryTournamentFilterName_ = '';
        summaryTournamentFilterDraftName_ = '';
        summaryTournamentFilterOpen_ = false;
        summaryChartExpanded_ = false;
        renderCurrentMatches_();
        return;
      }

      const dateOpen = event.target.closest('[data-match-summary-date-open]');
      if (dateOpen) {
        summaryEnvironmentFilterDraftId_ = '';
        summaryDatePickerTarget_ = dateOpen.dataset.matchSummaryDateOpen || 'from';
        const currentValue = summaryDatePickerTarget_ === 'from'
          ? summaryDateFilterDraftFrom_
          : summaryDateFilterDraftTo_;
        summaryDatePickerMonth_ = getMonthValue_(currentValue);
        renderCurrentMatches_();
        return;
      }

      if (event.target.closest('[data-match-summary-month-prev]')) {
        summaryDatePickerMonth_ = shiftMonthValue_(summaryDatePickerMonth_, -1);
        renderCurrentMatches_();
        return;
      }

      if (event.target.closest('[data-match-summary-month-next]')) {
        summaryDatePickerMonth_ = shiftMonthValue_(summaryDatePickerMonth_, 1);
        renderCurrentMatches_();
        return;
      }

      const datePick = event.target.closest('[data-match-summary-date-pick]');
      if (datePick) {
        summaryEnvironmentFilterDraftId_ = '';
        const value = String(datePick.dataset.matchSummaryDatePick || '').trim();
        if (summaryDatePickerTarget_ === 'to') summaryDateFilterDraftTo_ = value;
        else {
          summaryDatePickerTarget_ = 'from';
          summaryDateFilterDraftFrom_ = value;
        }
        summaryDatePickerMonth_ = getMonthValue_(value);
        renderCurrentMatches_();
        return;
      }

      if (event.target.closest('[data-match-summary-date-clear]')) {
        if (summaryDatePickerTarget_ === 'to') summaryDateFilterDraftTo_ = '';
        else summaryDateFilterDraftFrom_ = '';
        renderCurrentMatches_();
        return;
      }

      if (event.target.closest('[data-match-summary-date-today]')) {
        summaryEnvironmentFilterDraftId_ = '';
        const today = getTodayDateValue_();
        if (summaryDatePickerTarget_ === 'to') summaryDateFilterDraftTo_ = today;
        else {
          summaryDatePickerTarget_ = 'from';
          summaryDateFilterDraftFrom_ = today;
        }
        summaryDatePickerMonth_ = getMonthValue_(today);
        renderCurrentMatches_();
        return;
      }

      const dateApply = event.target.closest('[data-match-summary-date-apply]');
      if (dateApply) {
        let from = summaryDateFilterDraftFrom_;
        let to = summaryDateFilterDraftTo_;
        if (from && to && from > to) {
          const swapped = from;
          from = to;
          to = swapped;
        }
        if (summaryEnvironmentFilterDraftId_) {
          summaryEnvironmentFilterId_ = summaryEnvironmentFilterDraftId_;
          summaryDateFilterFrom_ = '';
          summaryDateFilterTo_ = '';
          summaryDateFilterDraftFrom_ = '';
          summaryDateFilterDraftTo_ = '';
        } else {
          summaryEnvironmentFilterId_ = '';
          summaryDateFilterFrom_ = from;
          summaryDateFilterTo_ = to;
        }
        summaryDateFilterOpen_ = false;
        summaryDatePickerTarget_ = '';
        summaryChartExpanded_ = false;
        renderCurrentMatches_();
        return;
      }

      if (event.target.closest('[data-match-summary-date-reset]')) {
        summaryDateFilterFrom_ = '';
        summaryDateFilterTo_ = '';
        summaryDateFilterDraftFrom_ = '';
        summaryDateFilterDraftTo_ = '';
        summaryEnvironmentFilterId_ = '';
        summaryEnvironmentFilterDraftId_ = '';
        summaryDateFilterOpen_ = false;
        summaryDatePickerTarget_ = '';
        summaryChartExpanded_ = false;
        renderCurrentMatches_();
        return;
      }

      const summaryChartTab = event.target.closest('[data-match-summary-chart-tab]');
      if (summaryChartTab) {
        activeSummaryChartTab_ = summaryChartTab.dataset.matchSummaryChartTab || 'usage';
        summaryChartExpanded_ = false;
        renderCurrentMatches_();
        return;
      }

      const summaryExportPick = event.target.closest('[data-match-summary-export-pick]');
      if (summaryExportPick) {
        event.preventDefault();
        toggleMatchImageOpponentSelection_(summaryExportPick.dataset.matchSummaryExportPick);
        renderCurrentMatches_();
        return;
      }

      if (event.target.closest('[data-match-summary-chart-more]')) {
        summaryChartExpanded_ = !summaryChartExpanded_;
        renderCurrentMatches_();
        return;
      }

      if (event.target.closest('.match-summary-image-save')) {
        event.preventDefault();
        exportMatchSummaryImage_();
        return;
      }

      const summaryDeckSelect = event.target.closest('[data-match-summary-deck-select]');
      if (summaryDeckSelect) {
        event.preventDefault();
        openSummaryDeckSelectModal_(summaryDeckSelect);
        return;
      }

      const summaryDeckPeek = event.target.closest('[data-match-summary-deck-peek-index]');
      if (summaryDeckPeek) {
        event.preventDefault();
        showMatchDeckPeek_(Number(summaryDeckPeek.dataset.matchSummaryDeckPeekIndex), summaryDeckPeek);
        return;
      }

      const summaryDeckOption = event.target.closest('[data-match-summary-deck-option]');
      if (summaryDeckOption) {
        event.preventDefault();
        selectSummaryDeckFromModal_(Number(summaryDeckOption.dataset.matchSummaryDeckOption));
        return;
      }

      if (event.target.closest('[data-match-summary-deck-select-close]')) {
        event.preventDefault();
        closeSummaryDeckSelectModal_();
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

      const opponentTierOpen = event.target.closest('[data-opponent-tier-open]');
      if (opponentTierOpen) {
        openOpponentTierModal_(opponentTierOpen.dataset.opponentTierOpen);
        return;
      }

      const opponentTierDeck = event.target.closest('[data-opponent-tier-deck]');
      if (opponentTierDeck) {
        selectOpponentTierDeck_(
          opponentTierDeck.dataset.opponentTierDeck,
          opponentTierDeck.dataset.opponentTierRace
        );
        return;
      }

      if (event.target.closest('[data-opponent-tier-close]')) {
        closeOpponentTierModal_();
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

    document.addEventListener('pointerdown', event => {
      const priorityChoice = event.target.closest('.match-choice-button');
      const priorityRadio = priorityChoice?.querySelector?.('input[type="radio"][name="priority"]');
      if (!priorityRadio) return;
      priorityRadio.dataset.wasChecked = priorityRadio.checked ? 'true' : 'false';
    });

    document.addEventListener('click', event => {
      const priorityChoice = event.target.closest('.match-choice-button');
      const priorityRadio = priorityChoice?.querySelector?.('input[type="radio"][name="priority"]');
      if (priorityRadio && priorityRadio.dataset.wasChecked === 'true') {
        event.preventDefault();
        priorityRadio.checked = false;
        delete priorityRadio.dataset.wasChecked;
        priorityRadio.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      if (priorityRadio) delete priorityRadio.dataset.wasChecked;

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

    document.addEventListener('click', event => {
      if (!event.target.closest('#matchEntrySubmit')) return;
      prepareMatchEntryValidation_(document.getElementById('matchEntryForm'));
    }, true);

    document.addEventListener('invalid', event => {
      const resultInput = event.target.closest?.('#matchEntryForm input[name="result"]');
      if (!resultInput) return;
      resultInput.setCustomValidity('勝敗の項目を選択してください。');
    }, true);

    document.addEventListener('change', event => {
      const tournamentFormat = event.target.closest('input[name="tournamentFormat"]');
      if (tournamentFormat) {
        renderTournamentGames_(tournamentFormat.closest('form'));
        return;
      }

      const environmentSelect = event.target.closest('[data-match-summary-environment-select]');
      if (environmentSelect) {
        summaryEnvironmentFilterDraftId_ = String(environmentSelect.value || '').trim();
        if (summaryEnvironmentFilterDraftId_) {
          summaryDateFilterDraftFrom_ = '';
          summaryDateFilterDraftTo_ = '';
          summaryDatePickerTarget_ = '';
        }
        renderCurrentMatches_();
        return;
      }

      const resultRadio = event.target.closest('input[name="result"]');
      if (resultRadio) {
        document.querySelectorAll('#matchEntryForm input[name="result"]').forEach(input => {
          input.setCustomValidity('');
        });
        return;
      }

      const deckRadio = event.target.closest('input[name="entryDeckIndex"]');
      if (!deckRadio) return;

      const index = Number(deckRadio.value);
      if (!getDecks_()[index]) return;
      selectDeck_(index);
    });

    document.addEventListener('keydown', event => {
      const tournamentNameInput = event.target.closest('[data-tournament-name-input]');
      if (tournamentNameInput && event.key === 'Enter') {
        event.preventDefault();
        const form = tournamentNameInput.closest('form');
        addTournamentName_(form, tournamentNameInput.value);
        tournamentNameInput.value = '';
        return;
      }

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

      const summaryDeckSelect = event.target.closest('[data-match-summary-deck-select]');
      if (summaryDeckSelect && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openSummaryDeckSelectModal_(summaryDeckSelect);
        return;
      }

      if (event.key === 'Escape') {
        closeSummaryDeckSelectModal_();
        closeOpponentTierModal_();
      }

      const deckPeek = event.target.closest('[data-match-deck-peek-index], [data-match-summary-deck-peek-index]');
      if (!deckPeek || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      const deckIndex = deckPeek.dataset.matchDeckPeekIndex ?? deckPeek.dataset.matchSummaryDeckPeekIndex;
      showMatchDeckPeek_(Number(deckIndex), deckPeek);
    });

    document.addEventListener('click', event => {
      const overlay = document.getElementById('match-deckpeek-overlay');
      if (!overlay || overlay.style.display !== 'block') return;
      if (event.target.closest('#match-deckpeek-overlay')) return;
      if (event.target.closest('[data-match-deck-peek-index]')) return;
      if (event.target.closest('[data-match-summary-deck-peek-index]')) return;
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
      scheduleLoginRequiredPrompt_();
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
    renderTournamentGames_(document.getElementById('matchEntryForm'));
    renderTournamentNameHistory_(document.getElementById('matchEntryForm'));
    ensureHistoryActions_();
    renderDecks_();
    renderHeaderAuth_();
    renderCurrentMatches_();
    loadSummaryEnvironmentCatalog_().then(() => {
      if (isHistoryViewActive_()) renderCurrentMatches_();
    });
    scheduleLoginRequiredPrompt_();
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
