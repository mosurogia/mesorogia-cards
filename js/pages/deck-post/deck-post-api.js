/* =========================
 * js/external/deck-post-api.js
 * - DeckPost: GAS API 通信レイヤ（fetch / JSONP fallback）
 *
 * 役割：
 * - token 解決（DeckPostAuth / AuthDeckPost / window.Auth）
 * - POST（doPost）: gasPost_（mode 対応）
 * - GET（doGet） : apiList / apiCampaignTags / apiGetPost
 * - 更新系API    : updateDeckNote_ / updateCardNotes_ / updateDeckCode_
 * - 互換：window.gasPost_ / window.gasPostDeckPost_
 *
 * 依存（存在すれば使う）：
 * - window.DECKPOST_API_BASE / window.GAS_API_BASE
 * - window.Auth.token（共通Authがいる場合）
 * ========================= */
(function () {
  'use strict';

  // =========================
  // 0) 設定
  // =========================
  const GAS_BASE = window.DECKPOST_API_BASE || window.GAS_API_BASE || '';
  const DEFAULT_PAGE_LIMIT = 20;

  // =========================
  // 1) token 解決
  // =========================
  function resolveToken() {
    // DeckPostAuth（正式）優先
    try {
      const raw = localStorage.getItem('DeckPostAuth');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && obj.token) return String(obj.token);
      }
    } catch (_) {}

    // 古い名前
    try {
      const raw = localStorage.getItem('AuthDeckPost');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && obj.token) return String(obj.token);
      }
    } catch (_) {}

    // 共通Auth
    try {
      const A = window.Auth;
      if (A && A.token) return String(A.token);
    } catch (_) {}

    return '';
  }

  // =========================
  // 2) 共通POST
  // =========================
  function buildPostUrl_(mode) {
    const base = window.DECKPOST_API_BASE || window.GAS_API_BASE || '';
    if (!base) return '';
    return `${base}?mode=${encodeURIComponent(String(mode || 'post'))}`;
  }

  async function gasPost_(payload) {
    const mode = String(payload?.mode || 'post');
    const url = buildPostUrl_(mode);
    if (!url) return { ok: false, error: 'api base not set' };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload || {}),
      });

      const json = await res.json().catch(() => null);
      return json || { ok: false, error: 'invalid response' };
    } catch (_) {
      return { ok: false, error: 'network' };
    }
  }

  // 互換
  window.gasPost_ = window.gasPost_ || gasPost_;
  window.gasPostDeckPost_ = window.gasPostDeckPost_ || gasPost_;

  // =========================
  // 3) 共通GET(JSONP fallback)
  // =========================
  function jsonpRequest(url) {
    return new Promise((resolve, reject) => {
      const cbName =
        '__deckpost_jsonp_' +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2);

      const sep = url.includes('?') ? '&' : '?';
      const script = document.createElement('script');
      script.src = url + sep + 'callback=' + cbName;
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
        reject(new Error('JSONP script error'));
      };

      document.body.appendChild(script);
    });
  }

  async function fetchJsonWithJsonpFallback_(url) {
    let requestUrl = null;
    try {
      requestUrl = new URL(url);
    } catch (_) {}

    if (requestUrl && requestUrl.hostname === 'script.google.com') {
      try {
        return await jsonpRequest(url);
      } catch (_) {
        return null;
      }
    }

    try {
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data) return data;
      }
    } catch (_) {}

    try {
      return await jsonpRequest(url);
    } catch (_) {
      return null;
    }
  }

  // =========================
  // 4) 一覧取得
  // =========================
  async function apiList(opts = {}) {
    if (!GAS_BASE) return { ok: false, error: 'api base not set' };

    const limit = Number(opts.limit ?? DEFAULT_PAGE_LIMIT);
    const offset = Number(opts.offset ?? 0);
    const mine = !!opts.mine;

    const qs = new URLSearchParams();
    qs.set('mode', 'list');
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    if (mine) qs.set('mine', '1');

    const tk = (window.Auth && window.Auth.token) || opts.token || resolveToken();
    if (tk) qs.set('token', String(tk));

    const url = `${GAS_BASE}?${qs.toString()}`;
    const data = await fetchJsonWithJsonpFallback_(url);

    if (data && (Array.isArray(data.items) || data.ok !== undefined || data.error)) {
      return data;
    }

    return { ok: false, error: 'list failed' };
  }

  // =========================
  // 5) キャンペーンタグ一覧
  // =========================
  async function apiCampaignTags() {
    if (!GAS_BASE) return { ok: false, error: 'api base not set' };

    const qs = new URLSearchParams();
    qs.set('mode', 'campaignTags');

    const url = `${GAS_BASE}?${qs.toString()}`;
    const data = await fetchJsonWithJsonpFallback_(url);

    return data || { ok: false, error: 'campaignTags failed' };
  }

  // =========================
  // 6) 投稿1件取得
  // =========================
  async function apiGetPost(opts = {}) {
    const postId = String(opts.postId || opts.pid || '').trim();
    if (!postId) return { ok: false, error: 'postId required' };
    if (!GAS_BASE) return { ok: false, error: 'api base not set' };

    const qs = new URLSearchParams();
    qs.set('mode', 'get');
    qs.set('postId', postId);

    const tk = (window.Auth && window.Auth.token) || opts.token || resolveToken();
    if (tk) qs.set('token', String(tk));

    const url = `${GAS_BASE}?${qs.toString()}`;
    const data = await fetchJsonWithJsonpFallback_(url);

    return data || { ok: false, error: 'get failed' };
  }

  // =========================
  // 7) いいね
  // =========================
  async function apiToggleLike(opts = {}) {
    const postId = String(opts.postId || '').trim();
    if (!postId) return { ok: false, error: 'postId required' };

    const tk = (window.Auth && window.Auth.token) || opts.token || resolveToken();
    if (!tk) return { ok: false, error: 'auth required' };

    const like = (opts.like === undefined) ? null : !!opts.like;

    // 互換:
    // - like未指定: 旧page4互換のトグル送信
    // - like指定あり: 将来用の明示指定送信
    const payload = {
      mode: like === null ? 'toggleLike' : 'like',
      postId,
      token: tk,
    };

    if (like !== null) {
      payload.like = like ? 1 : 0;
    }

    return await gasPost_(payload);
  }

  // =========================
  // 8) 更新系API
  // =========================
  function resolveWriteToken_() {
    return (window.Auth && window.Auth.token) || resolveToken();
  }

  async function updateDeckNote_(postId, deckNote) {
    const token = resolveWriteToken_();
    if (!token) return { ok: false, error: 'auth required' };

    return await gasPost_({
      mode: 'update',
      token,
      postId: String(postId || '').trim(),
      deckNote: String(deckNote || ''),
    });
  }

  async function updateCardNotes_(postId, cardNotes) {
    const token = resolveWriteToken_();
    if (!token) return { ok: false, error: 'auth required' };

    const list = Array.isArray(cardNotes) ? cardNotes : [];
    const payloadNotes = list
      .map((row) => {
        const cdRaw = String(row?.cd || '').trim();
        const cd = window.normCd5 ? window.normCd5(cdRaw) : (cdRaw ? cdRaw.padStart(5, '0') : '');
        const text = String(row?.text || '');
        return { cd, text };
      })
      .filter((row) => !!row.cd);

    return await gasPost_({
      mode: 'update',
      token,
      postId: String(postId || '').trim(),
      cardNotes: payloadNotes,
    });
  }

  async function updateDeckCode_(postId, shareCode) {
    const token = resolveWriteToken_();
    if (!token) return { ok: false, error: 'auth required' };

    return await gasPost_({
      mode: 'update',
      token,
      postId: String(postId || '').trim(),
      shareCode: String(shareCode || ''),
    });
  }

  // =========================
  // 9) 公開API
  // =========================
  window.DeckPostApi = window.DeckPostApi || {
    // base
    getBase() {
      return GAS_BASE;
    },

    // token
    resolveToken,

    // doPost
    gasPost_,
    apiToggleLike,
    updateDeckNote_,
    updateCardNotes_,
    updateDeckCode_,

    // doGet
    jsonpRequest,
    apiList,
    apiCampaignTags,
    apiGetPost,
  };
})();
