/* =========================
 * js/common/account/account-match-results.js
 * - 保存デッキ戦績APIのクライアント
 * - GASの matchResultAdd / matchResultUpdate / matchResultsList / matchResultDelete / matchResultsSummary を呼び出す
 * ========================= */
(function () {
  'use strict';

  const API = window.API || window.AUTH_API_BASE || window.GAS_API_BASE;
  const Auth = window.Auth;
  const postJSON = window.postJSON;
  const MATCH_MEMO_MAX_LENGTH = 200;
  const MATCH_TOURNAMENT_NAME_MAX_COUNT = 8;
  const MATCH_TOURNAMENT_TEXT_MAX_LENGTH = 80;

  function isLoggedIn_() {
    return !!(Auth?.user && Auth?.token && Auth?.verified);
  }

  function buildPayload_(data) {
    const body = data && typeof data === 'object' ? Object.assign({}, data) : {};
    if (Auth?.attachToken) return Auth.attachToken(body);
    body.token = Auth?.token || body.token || '';
    return body;
  }

  async function request_(mode, data) {
    if (!API || !postJSON) return { ok: false, error: 'api unavailable' };
    if (!isLoggedIn_()) return { ok: false, error: 'auth required' };

    const res = await postJSON(`${API}?mode=${encodeURIComponent(mode)}`, buildPayload_(data));
    return res && typeof res === 'object' ? res : { ok: false, error: 'invalid response' };
  }

  function normalizeResult_(value) {
    const v = String(value || '').trim().toLowerCase();
    return (v === 'win' || v === 'lose') ? v : '';
  }

  function normalizePriority_(value) {
    const v = String(value || '').trim().toLowerCase();
    return (v === 'self' || v === 'opponent') ? v : '';
  }

  function normalizeRating_(value) {
    const s = String(value || '').trim();
    return /^\d{5}$/.test(s) ? s : '';
  }

  function normalizeTournamentResult_(value) {
    const v = String(value || '').trim().toLowerCase();
    return (v === 'win' || v === 'lose') ? v : '';
  }

  function normalizeTournament_(value) {
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
      .map(name => String(name || '').trim().slice(0, MATCH_TOURNAMENT_TEXT_MAX_LENGTH))
      .filter(Boolean)
      .slice(0, MATCH_TOURNAMENT_NAME_MAX_COUNT);
    const rounds = (Array.isArray(data.rounds) ? data.rounds : [data.round])
      .map(round => String(round || '').trim().slice(0, 20))
      .filter(Boolean);
    const opponent = String(data.opponent || '').trim().slice(0, MATCH_TOURNAMENT_TEXT_MAX_LENGTH);
    const format = String(data.format || '').trim().toUpperCase();
    const games = (Array.isArray(data.games) ? data.games : [])
      .map(item => {
        const game = Math.max(1, Math.min(3, Number(item?.game || 0) || 0));
        const result = normalizeTournamentResult_(item?.result);
        if (!game || !result) return null;
        return {
          game,
          label: String(item?.label || `${game}試合目`).trim().slice(0, 20),
          result,
        };
      })
      .filter(Boolean);

    if (!names.length && !rounds.length && !opponent && !games.length) return null;

    return {
      names,
      rounds,
      opponent,
      format: format === 'BO3' ? 'BO3' : 'BO1',
      games,
    };
  }

  function normalizeAddInput_(data = {}) {
    return {
      deckId: String(data.deckId || '').trim(),
      playedAt: data.playedAt || '',
      result: normalizeResult_(data.result),
      opponentDeck: String(data.opponentDeck || '').trim(),
      rating: normalizeRating_(data.rating),
      priority: normalizePriority_(data.priority),
      memo: String(data.memo || '').trim().slice(0, MATCH_MEMO_MAX_LENGTH),
      tournament: normalizeTournament_(data.tournament),
    };
  }

  function normalizeUpdateInput_(data = {}) {
    return Object.assign(normalizeAddInput_(data), {
      matchId: String(data.matchId || data.id || '').trim(),
    });
  }

  function normalizeMatches_(res) {
    const candidates = [res?.matches, res?.results, res?.items, res?.list, res?.data];
    const list = candidates.find(Array.isArray);
    return Array.isArray(list) ? list : [];
  }

  function getMatchId_(match) {
    return String(match?.matchId || match?.id || match?.uuid || '').trim();
  }

  async function add(data) {
    const payload = normalizeAddInput_(data);
    return request_('matchResultAdd', payload);
  }

  async function update(data) {
    const payload = normalizeUpdateInput_(data);
    return request_('matchResultUpdate', payload);
  }

  async function list(opts = {}) {
    return request_('matchResultsList', {
      deckId: String(opts.deckId || '').trim(),
      limit: opts.limit,
    });
  }

  async function remove(matchId) {
    return request_('matchResultDelete', {
      matchId: String(matchId || '').trim(),
    });
  }

  async function summary(opts = {}) {
    return request_('matchResultsSummary', {
      deckId: String(opts.deckId || '').trim(),
      limit: opts.limit,
    });
  }

  async function clearAll(opts = {}) {
    const limit = Math.max(1, Math.min(Number(opts.limit || 5000) || 5000, 10000));
    const maxBatches = Math.max(1, Math.min(Number(opts.maxBatches || 20) || 20, 100));
    let deleted = 0;
    let total = 0;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const listRes = await list({ limit });
      if (!listRes?.ok) return Object.assign({ deleted }, listRes || { ok: false, error: 'list failed' });

      total = Math.max(total, Number(listRes.total || listRes.count || 0) || 0);
      const ids = [...new Set(normalizeMatches_(listRes).map(getMatchId_).filter(Boolean))];
      if (!ids.length) return { ok: true, deleted, total };

      const failed = [];
      for (const matchId of ids) {
        const res = await remove(matchId);
        if (res?.ok) deleted += 1;
        else failed.push({ matchId, error: res?.error || 'delete failed' });
      }

      if (failed.length) {
        return {
          ok: false,
          deleted,
          failed,
          error: `${failed.length}件の削除に失敗しました`,
        };
      }
    }

    return { ok: false, deleted, total, error: '戦績件数が多いため一度で削除しきれませんでした。もう一度リセットしてください。' };
  }

  window.AccountMatchResults = window.AccountMatchResults || {
    add,
    update,
    list,
    delete: remove,
    remove,
    clearAll,
    summary,
    isReady: isLoggedIn_,
  };
})();
