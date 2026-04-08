/**
 * js/pages/deck-post/deck-post-utils.js
 * - deck-post 用の共通ユーティリティ
 * - 純粋関数と軽量DOMヘルパをまとめる
 */
(function () {
  'use strict';

  // =========================
  // 1) 共有URL生成
  // =========================
  /**
   * 投稿共有URLを生成
   * - deck-post.html?pid=xxxxx
   */
  function buildPostShareUrl_(postId) {
    const base = location.origin + location.pathname;
    return `${base}?pid=${encodeURIComponent(String(postId || '').trim())}`;
  }

  // =========================
  // 2) 表示名正規化
  // =========================
  /**
   * 投稿者表示名を正規化
   */
  function normPosterName_(name) {
    return String(name || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  // =========================
  // 3) Xアカウント正規化
  // =========================
  /**
   * X / Twitter の入力をユーザーID形式へ正規化
   * - URL形式対応
   * - 先頭 @ 除去
   * - クエリや末尾スラッシュ除去
   */
  function normX_(x) {
    let s = String(x || '').trim();
    if (!s) return '';

    s = s.replace(/^https?:\/\/(www\.)?x\.com\//i, '')
         .replace(/^https?:\/\/(www\.)?twitter\.com\//i, '')
         .replace(/^@+/, '')
         .replace(/[\/?#].*$/, '');

    return s.toLowerCase();
  }

  // =========================
  // 4) 投稿者キー生成
  // =========================
  /**
   * 投稿者判定用キーを生成
   * - X を最優先
   * - 次に userId
   * - 最後に表示名
   */
  function posterKeyFromItem_(item) {
    const x = normX_(item?.posterX || item?.x || item?.xAccount || item?.posterXRaw || '');
    if (x) return `x:${x}`;

    const uid = String(item?.userId || item?.uid || item?.posterUid || '').trim();
    if (uid) return `uid:${uid}`;

    const n = normPosterName_(item?.posterName || item?.username || '');
    if (n) return `name:${n}`;

    return '';
  }

  // =========================
  // 5) ログインユーザー名取得
  // =========================
  /**
   * 現在ログイン中のユーザー名取得
   */
  function getLoginUsername() {
    try {
      const auth = window.Auth || {};
      if (auth.user && auth.user.username) {
        return String(auth.user.username);
      }
    } catch (_) {}

    try {
      const saved = localStorage.getItem('auth_username');
      if (saved) return String(saved);
    } catch (_) {}

    return '';
  }

  // =========================
  // 6) 日付整形
  // =========================
  /**
   * 日付を YYYY/MM/DD に整形
   */
  function fmtDate(v) {
    if (!v) return '';

    try {
      const d = new Date(v);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return `${y}/${m}/${da}`;
    } catch (_) {
      return '';
    }
  }

  /**
   * 投稿日＋更新日を整形
   * - 更新日なし / 同日なら投稿日だけ
   */
  function fmtPostDates_(item) {
    const cRaw = item?.createdAt || '';
    const uRaw = item?.updatedAt || '';
    const c = fmtDate(cRaw);
    const u = fmtDate(uRaw);

    if (!c && !u) return '';
    if (!u || !c || u === c) return c || u;

    return `${c}（更新日${u}）`;
  }

  // =========================
  // 7) HTML → Element
  // =========================
  /**
   * HTML文字列から要素生成
   */
  function createElementFromHTML(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html || '').trim();
    return t.content.firstElementChild;
  }

  // =========================
  // 8) 公開API
  // =========================
  window.buildPostShareUrl_ = buildPostShareUrl_;

  window.normPosterName_ = window.normPosterName_ || normPosterName_;
  window.normPosterName = window.normPosterName || normPosterName_;

  window.normX_ = window.normX_ || normX_;
  window.posterKeyFromItem_ = window.posterKeyFromItem_ || posterKeyFromItem_;

  window.getLoginUsername = window.getLoginUsername || getLoginUsername;

  window.fmtDate = window.fmtDate || fmtDate;
  window.fmtPostDates_ = window.fmtPostDates_ || fmtPostDates_;

  window.createElementFromHTML =
    window.createElementFromHTML || createElementFromHTML;
})();