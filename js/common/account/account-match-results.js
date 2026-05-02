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

  function normalizeAddInput_(data = {}) {
    return {
      deckId: String(data.deckId || '').trim(),
      playedAt: data.playedAt || '',
      result: normalizeResult_(data.result),
      opponentDeck: String(data.opponentDeck || '').trim(),
      rating: normalizeRating_(data.rating),
      priority: normalizePriority_(data.priority),
      memo: String(data.memo || '').trim().slice(0, MATCH_MEMO_MAX_LENGTH),
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
