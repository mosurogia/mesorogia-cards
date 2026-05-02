/**
 * js/pages/deck-post/deck-post-export.js
 * - デッキ画像生成 / 共有リンクコピー
 * - 投稿詳細まわりの export 系UIだけを担当
 *
 * このファイルに置くもの
 * - 投稿共有URL生成
 * - 共有リンクコピー
 * - デッキ画像生成ボタン処理
 * - export 用イベント配線
 *
 * 前提
 * - deck-post-detail.js の extractDeckMap / getMainRace / findItemById_ が使える
 * - exportDeckImage が共通側に存在する
 * - showActionToast / showMiniToast_ があれば使う
 */
(function () {
  'use strict';

  // =========================
  // 0) 依存参照
  // =========================
  const extractDeckMap =
    (...args) => window.DeckPostDetail?.extractDeckMap?.(...args);

  const getMainRace =
    (...args) => window.DeckPostDetail?.getMainRace?.(...args);

  const findItemById_ =
    (...args) => window.DeckPostDetail?.findItemById_?.(...args);

  // =========================
  // 1) 小物
  // =========================
  /**
   * トースト表示
   * - 共通トースト優先
   * - 無ければ alert
   */
  function showToast_(text) {
    if (typeof window.showActionToast === 'function') {
      window.showActionToast(text);
      return;
    }

    if (typeof window.showMiniToast_ === 'function') {
      window.showMiniToast_(text);
      return;
    }

    alert(String(text || ''));
  }



  /**
   * クリップボードへコピー
   * - navigator.clipboard 優先
   * - 失敗時は textarea fallback
   */
  async function copyText_(text) {
    const value = String(text || '');
    if (!value) return false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}

    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();

      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * 投稿item取得
   * - detail 側 helper 優先
   * - 無ければ state から探す
   */
  function findPostItem_(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return null;

    const byDetail = findItemById_(pid);
    if (byDetail) return byDetail;

    const state = window.DeckPostState?.getState?.() || window.__DeckPostState || {};
    const pools = [
      state?.mine?.items,
      state?.list?.items,
      state?.list?.allItems,
      state?.list?.filteredItems,
    ].filter(Array.isArray);

    for (const arr of pools) {
      const hit = arr.find((it) => String(it?.postId || '').trim() === pid);
      if (hit) return hit;
    }

    return null;
  }

  /**
   * 5桁cdへ正規化
   */
  function normalizeCd_(cd) {
    if (typeof window.normCd5 === 'function') return window.normCd5(cd);
    const s = String(cd || '').trim();
    return s ? s.padStart(5, '0').slice(0, 5) : '';
  }

  /**
   * 代表カードcdを投稿itemから決める
   */
  function pickRepresentativeCd_(item, deckMap) {
    let repCd = normalizeCd_(
      item?.repCd ||
      item?.repCardCd ||
      item?.rep ||
      item?.repCard ||
      item?.representativeCd ||
      ''
    );

    if (!repCd) {
      const src = String(item?.repImg || '').trim();
      const m = src.match(/(?:^|\/)(\d{5})(?:\.(?:webp|png|jpe?g))(?:\?.*)?$/i);
      if (m) repCd = m[1];
    }

    if (!repCd || !deckMap?.[repCd]) {
      repCd = Object.keys(deckMap || {})
        .map(normalizeCd_)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))[0] || '';
    }

    return repCd;
  }

  // =========================
  // 2) 共有リンクコピー
  // =========================
  /**
   * 共有リンクをコピー
   */
  async function copyPostShareUrl_(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return false;

    const url = window.buildPostShareUrl_(pid);
    const ok = await copyText_(url);

    if (ok) {
      showToast_('共有リンクをコピーしました');
      return true;
    }

    alert('コピーに失敗しました：\n' + url);
    return false;
  }

  // =========================
  // 3) デッキ画像生成
  // =========================
  /**
   * 投稿itemから exportDeckImage 用payloadを作る
   */
  function buildExportPayload_(item) {
    const deckMap = extractDeckMap(item);
    if (!deckMap || !Object.keys(deckMap).length) return null;

    const mainRace = getMainRace(item?.races);
    const representativeCd = pickRepresentativeCd_(item, deckMap);

    return {
      deck: deckMap,
      deckName: item?.title || '',
      posterName: item?.posterName || item?.poster || '',
      posterX: item?.posterX || item?.x || '',
      mainRace,
      representativeCd,
      showCredit: true,
      skipSizeCheck: true,
    };
  }

  /**
   * デッキ画像生成を実行
   */
  async function exportPostDeckImage_(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return false;

    const item = findPostItem_(pid);
    if (!item) return false;

    if (typeof window.exportDeckImage !== 'function') {
      alert('画像生成機能が見つかりませんでした');
      return false;
    }

    const payload = buildExportPayload_(item);
    if (!payload) {
      alert('デッキ情報が見つかりませんでした');
      return false;
    }

    await window.exportDeckImage(payload);
    return true;
  }

  // =========================
  // 4) クリック処理
  // =========================
  /**
   * exportボタン処理
   */
  async function handleExportButtonClick_(btn) {
    const root =
      btn.closest('.post-detail-inner') ||
      btn.closest('[data-postid]');

    const postId = String(
      btn.dataset.postid ||
      root?.dataset?.postid ||
      ''
    ).trim();

    if (!postId) return;

    await exportPostDeckImage_(postId);
  }

  /**
   * shareボタン処理
   */
  async function handleShareButtonClick_(btn) {
    const postId = String(btn.dataset.postid || '').trim();
    if (!postId) return;

    await copyPostShareUrl_(postId);
  }

  // =========================
  // 5) イベント配線
  // =========================
  /**
   * export系イベントを配線
   */
  function bindDeckPostExport_() {
    if (document.body.dataset.wiredDeckPostExport === '1') return;
    document.body.dataset.wiredDeckPostExport = '1';

    document.addEventListener('click', async (e) => {
      const exportBtn = e.target.closest('.btn-decklist-export');
      if (exportBtn) {
        e.preventDefault();
        e.stopPropagation();
        await handleExportButtonClick_(exportBtn);
        return;
      }

      const shareBtn = e.target.closest('.btn-post-share');
      if (shareBtn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await handleShareButtonClick_(shareBtn);
      }
    }, true);
  }

  // =========================
  // 6) 公開API
  // =========================
  window.DeckPostExport = {
    copyPostShareUrl: copyPostShareUrl_,
    exportPostDeckImage: exportPostDeckImage_,
    handleExportButtonClick: handleExportButtonClick_,
    handleShareButtonClick: handleShareButtonClick_,
    bindDeckPostExport: bindDeckPostExport_,
  };

  // =========================
  // 7) 初期化
  // =========================
  if (typeof window.onDeckPostReady === 'function') {
    window.onDeckPostReady(bindDeckPostExport_);
  } else {
    window.addEventListener('deck-post-page:ready', bindDeckPostExport_, { once: true });
    window.addEventListener('deckpost:ready', bindDeckPostExport_, { once: true });
  }
})();
