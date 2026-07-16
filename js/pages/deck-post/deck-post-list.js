/* ==================================================
 * js/pages/deck-post/deck-post-list.js
 * - 投稿一覧取得 / マイ投稿取得 / ページング / 再読込制御
 * - 一覧カード描画
================================================== */

(function () {
  'use strict';

  // =========================
  // 0) 定数
  // =========================
  // 1ページあたりの件数（UI表示用）
  const PAGE_LIMIT = 10;

  // 一覧データをまとめて取得するときの1リクエスト上限
  const FETCH_LIMIT = 100;
  const BACKGROUND_FETCH_DELAY_MS = 2500;
  const BACKGROUND_MAX_ERROR_COUNT = 3;
  let allListFetchPromise_ = null;
  let backgroundListController_ = null;
  let currentPageDetailPrefetchController_ = null;
  let incrementalFilterController_ = null;
  let listProgressEl_ = null;
  let listCacheStatusEl_ = null;
  let listBackgroundChain_ = Promise.resolve();
  let lastBackgroundRequestAt_ = 0;
  let listUsingBrowserCache_ = false;
  let listLatestSnapshot_ = null;
  let listLatestRefreshPromise_ = null;
  let applyingLatestSnapshot_ = false;
  let listManualCacheRefreshBusy_ = false;
  const LIST_BROWSER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  function wait_(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isBackgroundStopped_(controller) {
    return !controller || controller.stopped || document.hidden;
  }

  async function waitBackgroundInterval_(controller, ms = BACKGROUND_FETCH_DELAY_MS) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < ms) {
      if (isBackgroundStopped_(controller)) return false;
      await wait_(Math.min(250, ms - (Date.now() - startedAt)));
    }
    return !isBackgroundStopped_(controller);
  }

  function enqueueBackgroundListRequest_(task) {
    const run = listBackgroundChain_.catch(() => {}).then(async () => {
      const elapsed = Date.now() - lastBackgroundRequestAt_;
      if (lastBackgroundRequestAt_ && elapsed < BACKGROUND_FETCH_DELAY_MS) {
        await wait_(BACKGROUND_FETCH_DELAY_MS - elapsed);
      }
      const result = await task();
      lastBackgroundRequestAt_ = Date.now();
      return result;
    });
    listBackgroundChain_ = run.catch(() => {});
    return run;
  }

  function ensureListStatusGroupEl_() {
    const wrap = document.querySelector('.list-controls-filter');
    if (!wrap) return null;

    let group = document.getElementById('listStatusGroup');
    if (!group) {
      group = document.createElement('div');
      group.id = 'listStatusGroup';
      group.className = 'list-status-group';
      wrap.appendChild(group);
    }
    return group;
  }

  function ensureListLoadProgressEl_() {
    if (listProgressEl_?.isConnected) return listProgressEl_;

    const group = ensureListStatusGroupEl_();
    if (!group) return null;

    listProgressEl_ = document.getElementById('listLoadProgress');
    if (!listProgressEl_) {
      listProgressEl_ = document.createElement('div');
      listProgressEl_.id = 'listLoadProgress';
      listProgressEl_.className = 'list-load-progress';
      listProgressEl_.setAttribute('role', 'status');
      listProgressEl_.setAttribute('aria-live', 'polite');
    }
    group.appendChild(listProgressEl_);
    return listProgressEl_;
  }

  function updateListLoadProgress_(label = '') {
    const state = getDeckPostState_();
    const el = ensureListLoadProgressEl_();
    if (!el) return;

    const loaded = Number(state?.list?.allItems?.length || state?.list?.items?.length || 0);
    const sourceTotal = getKnownSourceTotal_();
    const total = Number(sourceTotal || (!hasActivePostFilter_() ? state?.list?.total : 0) || 0);
    const hasCompleteAllItems = total > 0 && loaded >= total;
    if (hasCompleteAllItems && state?.list && !state.list.hasAllItems) {
      state.list.hasAllItems = true;

      // フィルター中は検索結果を壊さない
      if (!hasActivePostFilter_() && !hasListSort_() && Array.isArray(state.list.allItems) && state.list.allItems.length) {
        state.list.filteredItems = getListItemsForFilterBase_(state.list.allItems);
      }
    }

    if (label) {
      el.textContent = label;
    } else if (state?.list?.hasAllItems || hasCompleteAllItems) {
      el.textContent = `全投稿読込済み ${loaded} / ${total}`;
    } else if (incrementalFilterController_ && !incrementalFilterController_.stopped) {
      el.textContent = total
        ? `条件に合う投稿を検索中… ${loaded} / ${total}`
        : `条件に合う投稿を検索中… ${loaded}件読込済み`;
    } else if (backgroundListController_?.stopped) {
      el.textContent = '裏読み停止中';
    } else {
      el.textContent = total ? `検索準備 ${loaded} / ${total}` : `検索準備 ${loaded}件読込済み`;
    }

    el.hidden = false;
  }

  function ensureListCacheStatusEl_() {
    if (listCacheStatusEl_?.isConnected) return listCacheStatusEl_;

    const group = ensureListStatusGroupEl_();
    if (!group) return null;

    listCacheStatusEl_ = document.getElementById('listCacheStatus');
    if (!listCacheStatusEl_) {
      listCacheStatusEl_ = document.createElement('div');
      listCacheStatusEl_.id = 'listCacheStatus';
      listCacheStatusEl_.className = 'list-cache-status';
      listCacheStatusEl_.innerHTML = `
        <span class="list-cache-status-text" data-list-cache-updated>最終更新: --:--</span>
        <button type="button" class="list-cache-refresh-btn" data-list-cache-refresh>更新</button>
      `;
    }
    group.appendChild(listCacheStatusEl_);
    return listCacheStatusEl_;
  }

  function formatListCacheUpdatedAt_(savedAt) {
    const time = Number(savedAt || 0);
    if (!time) return '--:--';
    const d = new Date(time);
    if (Number.isNaN(d.getTime())) return '--:--';
    const now = new Date();
    const sameDate = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (sameDate) return `${hh}:${mm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
  }

  function updateListCacheStatus_(savedAt) {
    const el = ensureListCacheStatusEl_();
    if (!el) return;
    const text = el.querySelector('[data-list-cache-updated]');
    if (text) text.textContent = `最終更新: ${formatListCacheUpdatedAt_(savedAt)}`;
    el.hidden = false;
    updateListCacheRefreshButton_();
  }

  function updateListCacheRefreshButton_() {
    const el = ensureListCacheStatusEl_();
    const btn = el?.querySelector('[data-list-cache-refresh]');
    if (!btn) return;

    const state = getDeckPostState_();
    if (listManualCacheRefreshBusy_) {
      btn.hidden = false;
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      return;
    }

    const isLoading = !!state?.list?.loading || !!allListFetchPromise_ || !!listLatestRefreshPromise_;
    btn.hidden = isLoading;
    if (isLoading) return;

    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = listLatestSnapshot_ ? '最新を表示' : '更新';
  }

  function hasCompleteAllItems_() {
    const state = getDeckPostState_();
    const allItems = Array.isArray(state?.list?.allItems) ? state.list.allItems : [];
    const total = Number(getKnownSourceTotal_() || (!hasActivePostFilter_() ? state?.list?.total : 0) || 0);
    return total > 0 && allItems.length >= total;
  }

  function hasListSort_() {
    const state = getDeckPostState_();
    return String(state?.list?.sortKey || 'new') !== 'new';
  }

  function normalizeCompleteAllItemsState_() {
    const state = getDeckPostState_();
    if (!state?.list || !hasCompleteAllItems_()) return false;

    state.list.hasAllItems = true;

    // フィルター中は filteredItems を allItems で上書きしない
    if (hasActivePostFilter_() || hasListSort_()) {
      return true;
    }

    state.list.filteredItems = getListItemsForFilterBase_(state.list.allItems);
    state.list.items = state.list.filteredItems;
    state.list.total = state.list.filteredItems.length;
    state.list.totalPages = Math.max(1, Math.ceil(Math.max(state.list.total, 0) / PAGE_LIMIT));
    return true;
  }

  function isQuickFilterReady_() {
    const state = getDeckPostState_();
    return !!state?.list?.hasAllItems || normalizeCompleteAllItemsState_();
  }

  function quickFilterButtonAttrs_() {
    return isQuickFilterReady_()
      ? 'data-ready="1"'
      : 'data-ready="0" title="読み込み済みの投稿から検索し、追加取得しながら結果を更新します。"';
  }

  function updateQuickFilterButtonsReadyState_() {
    const ready = isQuickFilterReady_();
    document.querySelectorAll('#postList .btn-filter-poster, #postList .btn-user-tag-search').forEach((btn) => {
      btn.disabled = false;
      btn.dataset.ready = ready ? '1' : '0';
      btn.setAttribute('aria-disabled', 'false');
      if (ready) {
        btn.removeAttribute('title');
      } else {
        btn.title = '読み込み済みの投稿から検索し、追加取得しながら結果を更新します。';
      }
    });
  }

  function getPageLoadProgress_(page) {
    const state = getDeckPostState_();
    const p = Math.max(Number(page || 1), 1);
    const total = Number(state?.list?.total || 0);
    const allItems = Array.isArray(state?.list?.allItems) ? state.list.allItems : [];
    const start = (p - 1) * PAGE_LIMIT;
    const expected = total > 0
      ? Math.max(0, Math.min(PAGE_LIMIT, total - start))
      : PAGE_LIMIT;
    const loaded = Math.max(0, Math.min(expected, allItems.length - start));

    return { loaded, expected };
  }

  function getKnownSourceTotal_() {
    const state = getDeckPostState_();
    if (state?.list?.hasAllItems) {
      return Array.isArray(state.list.allItems) ? state.list.allItems.length : 0;
    }

    const sourceTotal = Number(state?.list?.sourceTotal || 0);
    if (Number.isFinite(sourceTotal) && sourceTotal > 0) return sourceTotal;

    const totals = Object.values(state?.list?.pageCache || {})
      .map((entry) => Number(entry?.total || 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (totals.length) return Math.max(...totals);

    const rawTotal = Number(state?.list?.total || 0);
    if (!hasActivePostFilter_() && Number.isFinite(rawTotal) && rawTotal > 0) {
      return rawTotal;
    }

    return 0;
  }

  function getLoadedPageItems_(page) {
    const state = getDeckPostState_();
    const p = Math.max(Number(page || 1), 1);
    const allItems = Array.isArray(state?.list?.allItems) ? state.list.allItems : [];
    const start = (p - 1) * PAGE_LIMIT;
    const progress = getPageLoadProgress_(p);

    if (progress.expected <= 0 || progress.loaded < progress.expected) return null;
    return allItems.slice(start, start + progress.expected);
  }

  function getCurrentListPage_() {
    const state = getDeckPostState_();
    const fromState = Number(state?.list?.currentPage || 0);
    if (fromState > 0) return Math.max(1, fromState);

    const infoText = String(
      document.getElementById('pageInfo')?.textContent ||
      document.getElementById('pageInfoTop')?.textContent ||
      ''
    );
    const m = infoText.match(/(\d+)\s*\/\s*\d+/);
    return Math.max(1, Number(m?.[1] || 1));
  }

  function mergeListItemsDedup_(items) {
    const state = getDeckPostState_();
    const incoming = Array.isArray(items) ? items : [];
    state.list.allItems = Array.isArray(state.list.allItems) ? state.list.allItems : [];

    const seen = new Set(
      state.list.allItems
        .map((it) => String(it?.postId || '').trim())
        .filter(Boolean)
    );

    let added = 0;
    for (const item of incoming) {
      const postId = String(item?.postId || '').trim();
      if (!postId) continue;
      if (seen.has(postId)) {
        const index = state.list.allItems.findIndex((current) => String(current?.postId || '').trim() === postId);
        if (index >= 0 && isSharedInitialOnlyItem_(state.list.allItems[index])) {
          state.list.allItems[index] = item;
        }
        continue;
      }
      seen.add(postId);
      state.list.allItems.push(item);
      added += 1;
    }
    return added;
  }

  function getSharedPostIdFromUrl_() {
    try {
      const sp = new URLSearchParams(window.location.search || '');
      return String(sp.get('pid') || sp.get('post') || '').trim();
    } catch (_) {
      return '';
    }
  }

  function getAdoptionCardCdFromUrl_() {
    try {
      const sp = new URLSearchParams(window.location.search || '');
      if (String(sp.get('pid') || sp.get('post') || '').trim()) return '';
      const raw = String(sp.get('card') || '').trim();
      const cd = typeof window.normCd5 === 'function'
        ? window.normCd5(raw)
        : (raw ? raw.padStart(5, '0').slice(0, 5) : '');
      return cd && cd !== '00000' ? cd : '';
    } catch (_) {
      return '';
    }
  }

  function parseJsonObject_(value) {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;

    try {
      const parsed = JSON.parse(value.trim());
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function parseJsonArray_(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];

    try {
      const parsed = JSON.parse(value.trim());
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function normalizeSharedCardNotes_(value) {
    return parseJsonArray_(value)
      .map((row) => ({
        cd: String(row?.cd || row?.id || row?.cardId || ''),
        text: String(row?.text || row?.note || row?.comment || ''),
      }))
      .filter((row) => row.cd || row.text);
  }

  function normalizeSharedPostResponse_(res, postId) {
    const src = res?.item || res?.post || res?.data || res || {};
    if (!src || typeof src !== 'object') return null;

    const payload = parseJsonObject_(src.payload || src.payloadJSON || src.rawPayload);
    const item = { ...(payload || {}), ...src };
    item.postId = String(item.postId || postId || '').trim();
    if (!item.postId) return null;

    item.deckNote = String(
      Object.prototype.hasOwnProperty.call(src, 'deckNote')
        ? src.deckNote
        : (payload?.deckNote || item.deckNote || item.comment || '')
    );
    item.cardNotes = normalizeSharedCardNotes_(
      Object.prototype.hasOwnProperty.call(src, 'cardNotes')
        ? src.cardNotes
        : payload?.cardNotes
    );
    item.hasCardNotes = item.cardNotes.some((row) => row && (row.cd || row.text));
    item.deckNoteLength = Array.from(String(item.deckNote || '').trim()).length;
    item.__detailPayloadLoaded = true;
    return item;
  }

  function isSharedInitialOnlyItem_(item) {
    return item && item.__sharedInitialOnly === true;
  }

  function getListItemsForFilterBase_(items) {
    const state = getDeckPostState_();
    const list = Array.isArray(items) ? items : [];
    if (!state?.list?.hasAllItems && !hasCompleteAllItems_()) return list;

    return list.filter((item) => !isSharedInitialOnlyItem_(item));
  }

  function readTransferredPost_(postId) {
    const pid = String(postId || '').trim();
    if (!pid || typeof sessionStorage === 'undefined') return null;

    try {
      const key = `deck-post-transfer:${pid}`;
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;

      sessionStorage.removeItem(key);
      const parsed = JSON.parse(raw);
      if (!parsed || Number(parsed.expiresAt || 0) < Date.now()) return null;

      return normalizeSharedPostResponse_({ item: parsed.item }, pid);
    } catch (_) {
      return null;
    }
  }

  function clearBrowserListPageCache_(page) {
    try {
      const tokenKey = getBrowserListCacheTokenKey_();
      localStorage.removeItem(getBrowserListAllCacheKey_());
      localStorage.removeItem(getBrowserListPageCacheKey_(page));
      const removeKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.indexOf('DeckPostListPage:') !== 0 && key.indexOf('DeckPostListAll:') !== 0) continue;
        if (tokenKey && !key.endsWith(`:${tokenKey}`) && key.indexOf(':anon') < 0) continue;
        removeKeys.push(key);
      }
      removeKeys.forEach(key => localStorage.removeItem(key));
    } catch (_) {}
  }

  /**
   * Xアカウントをリンク用のユーザーIDへ正規化する
   */
  function normalizePosterXUser_(value) {
    if (typeof window.normX_ === 'function') return window.normX_(value);

    return String(value || '')
      .trim()
      .replace(/^https?:\/\/(www\.)?x\.com\//i, '')
      .replace(/^https?:\/\/(www\.)?twitter\.com\//i, '')
      .replace(/^@+/, '')
      .replace(/[\/?#].*$/, '')
      .toLowerCase();
  }

  /**
   * いいねボタンの中身を作る
   */
  function buildLikeButtonContent_(liked, likeCount) {
    return `${liked ? '★' : '☆'}${Number(likeCount || 0)}`;
  }

  /**
   * 初期表示で全件取得を待つかどうか
   */
  function shouldLoadAllItemsInitially_() {
    return false;
  }

  /**
   * フィルターボタンの準備状態を表示する
   */
  function updateFilterReadyState_() {
    const btn = document.getElementById('filterBtn');

    const state = getDeckPostState_();
    const ready = !!state?.list?.hasAllItems || normalizeCompleteAllItemsState_();

    if (btn) {
      btn.disabled = false;
      btn.dataset.ready = ready ? '1' : '0';
      btn.dataset.loading = '0';
      btn.textContent = 'フィルター';
      btn.title = ready
        ? '全投稿を対象にフィルターできます'
        : '読み込み済みの投稿から検索し、追加取得しながら結果を更新します';
      btn.setAttribute('aria-busy', 'false');
    }

    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.disabled = !ready;
      sortSelect.title = ready
        ? ''
        : '並び替えは全投稿の読み込み完了後に使えます';
      if (!ready && sortSelect.value !== 'new') {
        sortSelect.value = 'new';
        if (state?.list) state.list.sortKey = 'new';
      }
    }

    updateQuickFilterButtonsReadyState_();
    updateListLoadProgress_();
  }

  /**
   * マイページボタンの読み込み状態を表示する
   */
  function setToMineButtonLoading_(loading) {
    const btn = document.getElementById('toMineBtn');
    if (!btn) return;

    btn.disabled = !!loading;
    btn.dataset.loading = loading ? '1' : '0';
    btn.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  // =========================
  // 1) state / 外部参照
  // =========================
  /**
   * DeckPostState 取得
   */
  function getDeckPostState_() {
    return window.DeckPostState.getState();
  }

  /**
   * マイ投稿キャッシュ有効判定
   */
  function hasValidMineCache_() {
    return window.DeckPostState.hasValidMineCache();
  }

  /**
   * detail 側の公開API取得
   */
  function detail() {
    return window.DeckPostDetail || {};
  }

  /**
   * 右詳細に合わせて左一覧のスクロール上限を調整
   */
  function updateListMaxHeightFromPane_(layoutId, paneId) {
    const layout = document.getElementById(layoutId);
    const pane = document.getElementById(paneId);
    const master = layout?.querySelector('.post-master-column');
    const list = master?.querySelector('.post-list');

    if (!layout || !pane || !master || !list) return;

    if (!window.matchMedia('(min-width: 1024px)').matches) {
      layout.style.removeProperty('--post-list-max-height');
      return;
    }

    const topFooter = master.querySelector('.list-footer--top');
    const bottomFooter = master.querySelector('.list-footer--bottom');
    const paneContent =
      pane.querySelector('.post-detail-inner') ||
      pane.querySelector('.post-detail-empty') ||
      pane.firstElementChild ||
      pane;
    const paneHeight = Math.ceil(paneContent.getBoundingClientRect().height);
    const reservedHeight =
      (topFooter?.offsetHeight || 0) +
      (bottomFooter?.offsetHeight || 0) +
      24;
    const nextMaxHeight = Math.max(320, paneHeight - reservedHeight);

    layout.style.setProperty('--post-list-max-height', `${nextMaxHeight}px`);
  }

  /**
   * 左右カラム高さの同期を初期化
   */
  function bindListPaneHeightSync_() {
    if (window.__deckPostPaneHeightSyncBound) return;
    window.__deckPostPaneHeightSyncBound = true;

    const targets = [
      { layoutId: 'postMainLayout', paneId: 'postDetailPane' },
      { layoutId: 'mineMainLayout', paneId: 'postDetailPaneMine' },
    ];

    const refresh = () => {
      window.requestAnimationFrame(() => {
        targets.forEach(({ layoutId, paneId }) => {
          updateListMaxHeightFromPane_(layoutId, paneId);
        });
      });
    };

    refresh();
    window.addEventListener('resize', refresh, { passive: true });
    window.addEventListener('orientationchange', refresh, { passive: true });

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        refresh();
      });

      targets.forEach(({ layoutId, paneId }) => {
        const layout = document.getElementById(layoutId);
        const pane = document.getElementById(paneId);
        const master = layout?.querySelector('.post-master-column');
        const topFooter = master?.querySelector('.list-footer--top');
        const bottomFooter = master?.querySelector('.list-footer--bottom');

        if (pane) observer.observe(pane);
        if (topFooter) observer.observe(topFooter);
        if (bottomFooter) observer.observe(bottomFooter);
      });

      window.__deckPostPaneHeightSyncObserver = observer;
    }
  }

  // =========================
  // 2) 一覧描画補助
  // =========================

  /**
   * レアリティ構成の簡易統計
   */
  function buildRarityStats(item) {
    const D = detail();
    return {
      rarityText: D.buildRarityMixText_?.(item) || '',
    };
  }

  /**
   * パック構成テキスト
   */
  function buildPackMixText_(item) {
    const D = detail();
    const deck = D.extractDeckMap?.(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length || !cardMap) return '';

    const counts = Object.create(null);
    let unknown = 0;

    for (const [cd, nRaw] of Object.entries(deck)) {
      const n = Number(nRaw || 0) || 0;
      if (!n) continue;

      const cd5 = window.normCd5 ? window.normCd5(cd) : String(cd).padStart(5, '0');
      const packName =
        (cardMap[cd5] || {}).pack_name ||
        (cardMap[cd5] || {}).packName ||
        '';
      const en = D.packNameEn_?.(packName) || '';

      if (en) {
        counts[en] = (counts[en] || 0) + n;
      } else {
        unknown += n;
      }
    }

    const keys = Object.keys(counts);
    if (!keys.length && !unknown) return '';

    const order = D.getPackOrder_?.() || [];
    keys.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);

      if (ia !== -1 || ib !== -1) {
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      }
      return a.localeCompare(b);
    });

    const parts = keys.map((k) => `${k} ${counts[k]}枚`);
    if (unknown) parts.push(`UNKNOWN ${unknown}枚`);

    return parts.join(' / ');
  }

  /**
   * 一覧カード群を描画
   */
  function renderPostListInto(targetId, items, opts = {}) {
    const box = document.getElementById(targetId);
    if (!box) return;

    box.replaceChildren();

    const frag = document.createDocumentFragment();
    (items || []).forEach((it) => {
      const node = oneCard(it, opts);
      if (node) frag.appendChild(node);
    });

    if (opts.pendingMessage) {
      const pending = buildListSearchPendingNode_(opts.pendingMessage, opts.pendingSubText);
      if (pending) frag.appendChild(pending);
    }

    box.appendChild(frag);
    updateQuickFilterButtonsReadyState_();
  }

  // =========================
  // 3) 一覧カード描画
  // =========================
  /**
   * 1枚カードレンダリング（PC用）
   */
  function buildCardPc(item, opts = {}) {
    const D = detail();
    const listMode = opts.mode || 'list';
    const isMine = (listMode === 'mine');
    const bg = D.raceBg?.(item.races) || '';

    const titleBadge = item.titleBadge || item.titleTags || item.tagsTitle;
    const tagsTitle = window.DeckPostFilter?.tagChipsTitleBadge?.(titleBadge) || '';
    const tagsMain = window.DeckPostFilter?.tagChipsMain?.(item.tagsAuto, item.tagsPick) || '';
    const tagsUser = window.DeckPostFilter?.tagChipsUser?.(item.tagsUser) || '';

    const posterXRaw = String(item.posterX || '').trim();
    const posterXLabel = posterXRaw;
    const posterXUser = normalizePosterXUser_(posterXRaw);

    const likeCount = Number(item.likeCount || 0);
    const liked = !!item.liked;
    const favClass = liked ? ' active' : '';
    const favContent = buildLikeButtonContent_(liked, likeCount);

    const shareBtnHtml =
      `<button type="button" class="btn-post-share" data-postid="${escapeHtml(item.postId || '')}" aria-label="共有リンクをコピー">🔗</button>`;

    const headRightBtnHtml = isMine
      ? `
        <div class="post-head-actions">
          ${shareBtnHtml}
          <button class="delete-btn" type="button" data-postid="${escapeHtml(item.postId || '')}" aria-label="投稿を削除">🗑</button>
        </div>
      `
      : `
        <div class="post-head-actions">
          ${shareBtnHtml}
          <button class="fav-btn ${favClass}" type="button" aria-label="お気に入り">${favContent}</button>
        </div>
      `;

    return window.createElementFromHTML(`
      <article class="post-card post-card--pc" data-postid="${escapeHtml(item.postId || '')}" data-list-mode="${escapeHtml(listMode)}" style="${bg ? `--race-bg:${bg};` : ''}">
        <div class="sp-head">
          <div class="pc-head-left">
            ${detail().cardThumb?.(item.repImg, item.title) || ''}
          </div>

          <div class="pc-head-right">
            <div class="post-card-title">
              ${escapeHtml(item.title || '(無題)')}
            </div>

            <div class="pc-meta">
              <div class="meta-name">
                ${escapeHtml(item.posterName || item.username || '')}
                ${(item.posterName || item.username) ? `
                  <button type="button"
                    class="btn-filter-poster"
                    data-poster="${escapeHtml(item.posterName || item.username || '')}"
                    data-poster-key="${escapeHtml(window.posterKeyFromItem_?.(item) || '')}"
                    ${quickFilterButtonAttrs_()}
                    aria-label="この投稿者で絞り込む">👤</button>
                ` : ''}
              </div>

              ${posterXUser ? `
                <a class="sp-meta-x"
                  href="https://x.com/${encodeURIComponent(posterXUser)}"
                  target="_blank"
                  rel="noopener noreferrer">
                  ${escapeHtml(posterXLabel)}
                </a>
              ` : ''}

              <div class="sp-meta-date">
                ${window.fmtPostDates_?.(item) || ''}
              </div>
            </div>

            ${headRightBtnHtml}

            <div class="post-actions pc-actions">
              <button type="button" class="btn-add-compare">比較に追加</button>
            </div>
          </div>
        </div>

        <div class="post-tags-wrap">
          <div class="post-tags post-tags-title">${tagsTitle}</div>
          <div class="post-tags post-tags-main">${tagsMain}</div>
          <div class="post-tags post-tags-user">${tagsUser}</div>
        </div>
      </article>
    `);
  }

  /**
   * 1枚カードレンダリング（SP用）
   */
  function buildCardSp(item, opts = {}) {
    const D = detail();
    const listMode = opts.mode || 'list';
    const isMine = (listMode === 'mine');

    const mainRace = D.getMainRace?.(item.races) || '';
    const bg = D.raceBg?.(item.races) || '';
    const oldGod = D.getOldGodNameFromItem?.(item) || '';

    if (opts.deferDetail && !isMine) {
      const titleBadge = item.titleBadge || item.titleTags || item.tagsTitle;
      const tagsTitle = window.DeckPostFilter?.tagChipsTitleBadge?.(titleBadge) || '';
      const tagsMain = window.DeckPostFilter?.tagChipsMain?.(item.tagsAuto, item.tagsPick) || '';
      const tagsUser = window.DeckPostFilter?.tagChipsUser?.(item.tagsUser) || '';
      const posterXRaw = String(item.posterX || '').trim();
      const posterXLabel = posterXRaw;
      const posterXUser = normalizePosterXUser_(posterXRaw);
      const likeCount = Number(item.likeCount || 0);
      const liked = !!item.liked;
      const favClass = liked ? ' active' : '';
      const favContent = buildLikeButtonContent_(liked, likeCount);
      const shareBtnHtml =
        `<button type="button" class="btn-post-share" data-postid="${escapeHtml(item.postId || '')}" aria-label="共有リンクをコピー">🔗</button>`;

      return window.createElementFromHTML(`
        <article class="post-card post-card--sp" data-postid="${escapeHtml(item.postId || '')}" data-list-mode="${escapeHtml(listMode)}" style="${bg ? `--race-bg:${bg};` : ''}">
          <div class="sp-head">
            <div class="sp-head-left">
              ${detail().cardThumb?.(item.repImg, item.title) || ''}
            </div>

            <div class="sp-head-right">
              <div class="post-card-title">
                ${escapeHtml(item.title || '(無題)')}
              </div>

              <div class="sp-meta">
                <div class="meta-name">
                  ${escapeHtml(item.posterName || item.username || '')}
                  ${(item.posterName || item.username) ? `
                    <button type="button"
                      class="btn-filter-poster"
                      data-poster="${escapeHtml(item.posterName || item.username || '')}"
                      data-poster-key="${escapeHtml(window.posterKeyFromItem_?.(item) || '')}"
                      ${quickFilterButtonAttrs_()}
                      aria-label="この投稿者で絞り込む">🔎</button>
                  ` : ''}
                </div>

                ${posterXUser ? `
                  <a class="sp-meta-x"
                    href="https://x.com/${encodeURIComponent(posterXUser)}"
                    target="_blank"
                    rel="noopener noreferrer">
                    ${escapeHtml(posterXLabel)}
                  </a>
                ` : ''}

                <div class="sp-meta-date">
                  ${window.fmtPostDates_?.(item) || ''}
                </div>
              </div>

              <div class="post-head-actions">
                ${shareBtnHtml}
                <button class="fav-btn ${favClass}" type="button" aria-label="お気に入り">${favContent}</button>
              </div>
            </div>
          </div>

          <div class="post-tags-wrap">
            <div class="post-tags post-tags-title">${tagsTitle}</div>
            <div class="post-tags post-tags-main">${tagsMain}</div>
            <div class="post-tags post-tags-user">${tagsUser}</div>
          </div>

          <div class="post-actions sp-actions">
            <button type="button" class="btn-detail">詳細</button>
            <button type="button" class="btn-add-compare">比較に追加</button>
          </div>

          <div class="post-detail" hidden data-lazy-detail="1"></div>
        </article>
      `);
    }

    const deckNote = item.deckNote || item.comment || '';
    const deckNoteHtml = D.buildDeckNoteHtml?.(deckNote) || '';

    const simpleStats = D.buildSimpleDeckStats?.(item) || null;
    const rarityStats = buildRarityStats(item);

    const typeChipsHtml = D.buildTypeChipsHtml_?.(simpleStats) || '';
    const rarityChipsHtml = D.buildRarityChipsHtml_?.(item) || '';
    const packChipsHtml = D.buildPackChipsHtml_?.(item) || '';

    const pidSan = String(item.postId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const scope = listMode;
    const spPaneId = `sp-${scope}-${pidSan}`;

    const titleBadge = item.titleBadge || item.titleTags || item.tagsTitle;
    const tagsTitle = window.DeckPostFilter?.tagChipsTitleBadge?.(titleBadge) || '';
    const tagsMain = window.DeckPostFilter?.tagChipsMain?.(item.tagsAuto, item.tagsPick) || '';
    const tagsUser = window.DeckPostFilter?.tagChipsUser?.(item.tagsUser) || '';
    const deckList = D.buildDeckListHtml?.(item) || '';
    const cardNotesHtml = D.buildCardNotesHtml?.(item) || '';

    const posterXRaw = String(item.posterX || '').trim();
    const posterXLabel = posterXRaw;
    const posterXUser = normalizePosterXUser_(posterXRaw);

    const likeCount = Number(item.likeCount || 0);
    const liked = !!item.liked;
    const favClass = liked ? ' active' : '';
    const favContent = buildLikeButtonContent_(liked, likeCount);

    const notesHiddenId = `post-card-notes-hidden-${spPaneId}`;
    const notesValidId = `post-cardnote-validator-${spPaneId}`;
    const addNoteBtnId = `add-card-note-${spPaneId}`;

    const shareBtnHtml =
      `<button type="button" class="btn-post-share" data-postid="${escapeHtml(item.postId || '')}" aria-label="共有リンクをコピー">🔗</button>`;

    const headRightBtnHtml = isMine
      ? `
        <div class="post-head-actions">
          ${shareBtnHtml}
          <button class="delete-btn" type="button" data-postid="${escapeHtml(item.postId || '')}" aria-label="投稿を削除">🗑</button>
        </div>
      `
      : `
        <div class="post-head-actions">
          ${shareBtnHtml}
          <button class="fav-btn ${favClass}" type="button" aria-label="お気に入り">${favContent}</button>
        </div>
      `;

    const postId = String(item?.postId || '').trim();
    const codeNorm = String(item?.shareCode || '').trim();

    const codeManageHtml = isMine
      ? (window.DeckPostEditor?.buildDeckCodeBoxHtml_?.(postId, codeNorm)
        || window.buildDeckCodeBoxHtml_?.(postId, codeNorm)
        || '')
      : '';

    const codeCopyBtnHtml = codeNorm ? `
      <div class="post-detail-code-body">
        <button type="button" class="btn-copy-code-wide" data-code="${escapeHtml(codeNorm)}">
          デッキコードをコピー
        </button>
      </div>
    ` : '';

    const codeBtnHtml = `${codeManageHtml}${codeCopyBtnHtml}`;

    const hasCardNotes =
      Array.isArray(item.cardNotes) &&
      item.cardNotes.some((r) => r && (r.cd || r.text));

    const cardNotesSection = (!isMine && !hasCardNotes) ? '' : `
      <div class="post-detail-section">
        <div class="post-detail-heading-row post-detail-heading-row--cards">
          <div class="post-detail-heading">カード解説</div>
          ${isMine ? `
            <div class="post-detail-heading-actions">
              <button type="button" class="btn-cardnotes-edit">編集</button>
            </div>
          ` : ''}
        </div>

        <div class="cardnotes-view">
          ${cardNotesHtml}
        </div>

        ${isMine ? `
          <div class="cardnotes-editor" hidden data-original='${escapeHtml(JSON.stringify(item.cardNotes || []))}'>
            <div class="info-value" style="width:100%">
              <div class="post-card-notes"></div>
              <input type="hidden" id="${notesHiddenId}" class="post-card-notes-hidden" value="${escapeHtml(JSON.stringify(item.cardNotes || []))}">

              <input type="text" id="${notesValidId}" class="post-cardnote-validator" aria-hidden="true" tabindex="-1"
                style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;border:none;padding:0;margin:0;">

              <div class="add-note-box">
                <button type="button" id="${addNoteBtnId}" class="add-note-btn">カード解説を追加</button>
                <div class="post-hint" style="opacity:.8">※カードを選んで簡単な解説や採用理由を書けます</div>
              </div>

              <div class="decknote-editor-actions" style="margin-top:.6rem;">
                <button type="button" class="btn-cardnotes-save">保存</button>
                <button type="button" class="btn-cardnotes-cancel">キャンセル</button>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    return window.createElementFromHTML(`
      <article class="post-card post-card--sp" data-postid="${escapeHtml(item.postId || '')}" data-list-mode="${escapeHtml(listMode)}" style="${bg ? `--race-bg:${bg};` : ''}">
        <div class="sp-head">
          <div class="sp-head-left">
            ${detail().cardThumb?.(item.repImg, item.title) || ''}
          </div>

          <div class="sp-head-right">
            <div class="post-card-title">
              ${escapeHtml(item.title || '(無題)')}
            </div>

            <div class="sp-meta">
              <div class="meta-name">
                ${escapeHtml(item.posterName || item.username || '')}
                ${(item.posterName || item.username) ? `
                  <button type="button"
                    class="btn-filter-poster"
                    data-poster="${escapeHtml(item.posterName || item.username || '')}"
                    data-poster-key="${escapeHtml(window.posterKeyFromItem_?.(item) || '')}"
                    ${quickFilterButtonAttrs_()}
                    aria-label="この投稿者で絞り込む">👤</button>
                ` : ''}
              </div>

              ${posterXUser ? `
                <a class="sp-meta-x"
                  href="https://x.com/${encodeURIComponent(posterXUser)}"
                  target="_blank"
                  rel="noopener noreferrer">
                  ${escapeHtml(posterXLabel)}
                </a>
              ` : ''}

              <div class="sp-meta-date">
                ${window.fmtPostDates_?.(item) || ''}
              </div>
            </div>

            ${headRightBtnHtml}
          </div>
        </div>

        <div class="post-tags-wrap">
          <div class="post-tags post-tags-title">${tagsTitle}</div>
          <div class="post-tags post-tags-main">${tagsMain}</div>
          <div class="post-tags post-tags-user">${tagsUser}</div>
        </div>

        <div class="post-actions sp-actions">
          <button type="button" class="btn-detail">詳細</button>
          <button type="button" class="btn-add-compare">比較に追加</button>
        </div>

        <div class="post-detail" hidden>
          <div class="post-detail-inner" data-postid="${escapeHtml(item.postId || '')}" data-list-mode="${escapeHtml(listMode)}">
            <div class="post-detail-section">
              <div class="post-detail-heading-row">
                <div class="post-detail-heading">デッキリスト</div>
                <div class="post-detail-heading-actions">
                  <button type="button" class="btn-decklist-export">リスト保存</button>
                </div>
              </div>
              <div class="post-decklist-hint">
                👇 カードをタップすると詳細が表示されます
              </div>
              ${deckList}
              ${codeBtnHtml}
            </div>

            <dl class="post-detail-summary">
              <dt>種族</dt><dd>${escapeHtml(mainRace || '')}</dd>
              <dt>枚数</dt><dd>${item.count || 0}枚</dd>
              <dt>旧神</dt><dd>${escapeHtml(oldGod || 'なし')}</dd>

              ${typeChipsHtml
                ? `<dt>役割構成</dt><dd><div class="post-detail-chips">${typeChipsHtml}</div></dd>`
                : ''
              }

              ${rarityChipsHtml
                ? `<dt>レアリティ構成</dt><dd><div class="post-detail-chips">${rarityChipsHtml}</div></dd>`
                : ''
              }

              ${packChipsHtml
                ? `<dt>パック構成</dt><dd><div class="post-detail-chips">${packChipsHtml}</div></dd>`
                : ''
              }

              <dt>
                マナ効率
                <button type="button" class="help-button" aria-label="マナ効率の説明を確認">？</button>
              </dt>
              <dd class="mana-eff-row">
                <span id="mana-efficiency-${escapeHtml(spPaneId)}" class="mana-eff">-</span>
                <div id="mana-excluded-cards-${escapeHtml(spPaneId)}" class="mana-excluded-cards" hidden></div>
                <span class="avg-charge-inline">
                  （平均チャージ量：<span id="avg-charge-${escapeHtml(spPaneId)}">-</span>）
                </span>
              </dd>
            </dl>

            <div class="deck-compare-block">
              <button type="button"
                class="deck-compare-toggle"
                aria-expanded="false"
                aria-label="所持カードデータから不足カードを確認"
                data-tooltip="所持率チェッカーのデータを参照して、このデッキの不足カードを確認します"
                title="所持率チェッカーのデータを参照して、このデッキの不足カードを確認します">
                不足カードを確認
              </button>
              <div class="deck-compare-result" hidden></div>
            </div>

            <div class="post-detail-charts" data-postcharts="${escapeHtml(item.postId || '')}" data-paneid="${escapeHtml(spPaneId)}">
              <div class="post-detail-chartbox">
                <div class="post-detail-charthead">
                  <div class="post-detail-charttitle">コスト分布</div>
                  <div class="post-detail-chartchips" id="cost-summary-${escapeHtml(spPaneId)}"></div>
                </div>
                <div class="post-detail-chartcanvas">
                  <div class="post-detail-chart-loading" role="status" aria-live="polite">グラフ生成中…</div>
                  <canvas id="costChart-${escapeHtml(spPaneId)}"></canvas>
                </div>
              </div>

              <div class="post-detail-chartbox">
                <div class="post-detail-charthead">
                  <div class="post-detail-charttitle">パワー分布</div>
                  <div class="post-detail-chartchips" id="power-summary-${escapeHtml(spPaneId)}"></div>
                </div>
                <div class="post-detail-chartcanvas">
                  <div class="post-detail-chart-loading" role="status" aria-live="polite">グラフ生成中…</div>
                  <canvas id="powerChart-${escapeHtml(spPaneId)}"></canvas>
                </div>
              </div>
            </div>

            <div class="post-detail-section">
              <div class="post-detail-heading-row">
                <div class="post-detail-heading">デッキ解説</div>
                ${isMine ? `
                  <div class="post-detail-heading-actions">
                    <button type="button" class="btn-decknote-edit">編集</button>
                  </div>
                ` : ''}
              </div>

              <div class="post-detail-body post-detail-body--decknote">
                <div class="decknote-view">
                  ${deckNoteHtml || '<div style="color:#777;font-size:.9rem;">まだ登録されていません。</div>'}
                </div>

                ${isMine ? `
                  <div class="decknote-editor" hidden>
                    <div class="note-preset-wrap note-preset-wrap--compact">
                      <div class="note-toolbar">
                        <div class="note-presets-grid">
                          <button type="button" class="note-preset-menu-btn" data-preset-menu="templates">記事構成を追加</button>
                          <button type="button" class="note-preset-menu-btn" data-preset-menu="sections">解説項目</button>
                          <button type="button" class="note-card-ref-btn">文中にカードを追加</button>
                        </div>
                      </div>
                      <div class="note-preset-panel" hidden></div>
                    </div>

                    <div class="decknote-editor-hint">
                      ※見出しを追加したり、文中にカード名を挿入できます。
                    </div>

                    <textarea class="decknote-textarea" rows="14" data-original="${escapeHtml(deckNote || '')}">${escapeHtml(deckNote || '')}</textarea>

                    <div class="decknote-editor-actions">
                      <button type="button" class="btn-decknote-save">保存</button>
                      <button type="button" class="btn-decknote-cancel">キャンセル</button>
                    </div>
                  </div>
                ` : ''}
              </div>
            </div>

            ${cardNotesSection}

            <div class="post-detail-footer">
              <button type="button" class="btn-detail-close">閉じる</button>
            </div>
          </div>
        </div>
      </article>
    `);
  }

  /**
   * 1枚カードレンダリング（PC/SP切り替え）
   */
  function oneCard(item, opts = {}) {
    const isSp = window.matchMedia('(max-width: 1023px)').matches;
    const spOpts = {
      ...opts,
      deferDetail: opts.deferDetail ?? ((opts.mode || 'list') === 'list'),
    };
    return isSp ? buildCardSp(item, spOpts) : buildCardPc(item, opts);
  }

  function scheduleVisibleSpDetailWarmup_() {
    if (!window.matchMedia('(max-width: 1023px)').matches) return;

    const cards = Array.from(document.querySelectorAll('#postList .post-card--sp'))
      .filter((card) => card.querySelector('.post-detail[data-lazy-detail="1"]'))
      .slice(0, PAGE_LIMIT);
    if (!cards.length) return;

    const run = async (deadline = null) => {
      const startedAt = Date.now();
      while (cards.length) {
        if (deadline?.timeRemaining && deadline.timeRemaining() < 8) break;
        if (!deadline && Date.now() - startedAt > 24) break;

        const card = cards.shift();
        const postId = String(card?.dataset?.postid || '').trim();
        const item = postId ? findPostItemById(postId) : null;
        const cardOpts = {
          mode: card.dataset.listMode || 'list',
          deferDetail: false,
        };
        const replacement = item && (typeof window.DeckPostDetail?.buildCardSpWithPostCardMap === 'function'
          ? await window.DeckPostDetail.buildCardSpWithPostCardMap(item, cardOpts)
          : buildCardSp(item, cardOpts));
        if (replacement && card.isConnected) card.replaceWith(replacement);
      }

      if (!cards.length) return;
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 1200 });
      } else {
        window.setTimeout(() => run(), 80);
      }
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 1200 });
    } else {
      window.setTimeout(() => run(), 120);
    }
  }

  function createListFetchError_(message, response = null) {
    const err = new Error(message || response?.error || 'list fetch failed');
    err.apiResponse = response || null;
    return err;
  }

  function getListErrorDetails_(error, fallbackCode = 'LIST_FETCH_FAILED') {
    const response = error?.apiResponse || null;
    const code = response?.code || response?.error || error?.code || fallbackCode;
    const reason = response?.reason || error?.reason || error?.message || '投稿一覧APIの呼び出しに失敗しました。';
    const status = response?.status || error?.status || '';
    const statusText = response?.statusText || error?.statusText || '';

    return {
      code,
      reason,
      status,
      statusText,
      message: error?.message || '',
    };
  }

  function buildListErrorDetailsHtml_(details) {
    if (!details) return '';

    const rows = [];
    if (details.code) rows.push(['エラーコード', details.code]);
    if (details.status) {
      const statusText = details.statusText ? ` ${details.statusText}` : '';
      rows.push(['HTTPステータス', `${details.status}${statusText}`]);
    }
    if (details.reason) rows.push(['失敗原因', details.reason]);
    if (details.message && details.message !== details.reason) rows.push(['詳細', details.message]);

    if (!rows.length) return '';

    return `
      <dl class="post-list-error-details">
        ${rows.map(([label, value]) => `
          <div class="post-list-error-row">
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>
        `).join('')}
      </dl>
    `;
  }

  function buildListLoadingDetailsHtml_(details) {
    const progress = details?.progress || null;
    if (!progress) return '';

    const loaded = Number(progress.loaded || 0);
    const expected = Number(progress.expected || PAGE_LIMIT);
    return `
      <div class="post-list-loading-progress">
        ${escapeHtml(`${loaded} / ${expected}`)}
      </div>
    `;
  }

  function buildListSearchPendingNode_(text, subText = '') {
    const node = document.createElement('div');
    node.className = 'post-list-message post-list-message--loading post-list-message--tail';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');

    const spinner = document.createElement('span');
    spinner.className = 'post-list-message-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const body = document.createElement('span');
    body.className = 'post-list-message-body';

    const main = document.createElement('span');
    main.className = 'post-list-message-main';
    main.textContent = String(text || '条件に合う投稿を検索中…');
    body.appendChild(main);

    const sub = String(subText || '').trim();
    if (sub) {
      const note = document.createElement('span');
      note.className = 'post-list-message-sub';
      note.textContent = sub;
      body.appendChild(note);
    }

    node.append(spinner, body);
    return node;
  }

  /**
   * 一覧ステータスメッセージ表示
   */
  function showListStatusMessage(type, text, details = null) {
    const listEl = document.getElementById('postList');
    if (!listEl) return;

    const baseClass = 'post-list-message';
    const errorClass = (type === 'error') ? ' post-list-message--error' : '';
    const detailsHtml = (type === 'error')
      ? buildListErrorDetailsHtml_(details)
      : buildListLoadingDetailsHtml_(details);

    if (type === 'loading') {
      const pending = buildListSearchPendingNode_(text, details?.subText || '');
      if (!pending) return;
      const detailsWrap = document.createElement('div');
      detailsWrap.innerHTML = detailsHtml;
      pending.append(...Array.from(detailsWrap.childNodes));
      listEl.replaceChildren(pending);
      return;
    }

    listEl.innerHTML =
      `<div class="${baseClass}${errorClass}">
        <div>${escapeHtml(text)}</div>
        ${detailsHtml}
      </div>`;
  }

  /**
   * マイ投稿内の選択中タブを取得する
   */
  function getMineActiveTab_() {
    const state = getDeckPostState_();
    return state?.mine?.activeTab === 'liked' ? 'liked' : 'posts';
  }

  /**
   * マイ投稿内タブ表示を更新する
   */
  function updateMineTabsUI_() {
    const activeTab = getMineActiveTab_();
    document.querySelectorAll('.mine-tab[data-mine-tab]').forEach((btn) => {
      const active = btn.dataset.mineTab === activeTab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  /**
   * いいねしたデッキ一覧用の投稿を取得する
   */
  function getLikedDeckItems_() {
    const state = getDeckPostState_();
    return (state?.list?.allItems || []).filter((it) => !!it?.liked);
  }

  /**
   * マイ投稿件数表示更新
   */
  function updateMineCountUI_(tab = getMineActiveTab_(), totalOverride) {
    const state = getDeckPostState_();
    const total = Number(
      totalOverride ?? (
        tab === 'liked'
          ? getLikedDeckItems_().length
          : state?.mine?.total || 0
      )
    );

    const countTop = document.getElementById('resultCountMineTop');
    if (countTop) {
      const label = tab === 'liked' ? 'いいねしたデッキ' : 'マイ投稿';
      countTop.textContent = `${label} ${total}件`;
    }
  }

  /**
   * マイ投稿ログイン表示更新
   */
  function updateMineLoginStatus() {
    const el = document.getElementById('mine-login-username');
    if (!el) return;
    el.textContent = window.getLoginUsername?.() || '未ログイン';
  }

  // =========================
  // 4) 画面切替（一覧 ↔ マイ投稿）
  // =========================
  /**
   * 一覧ページ表示
   */
  function showList() {
    const listPage = document.getElementById('post-app');
    const minePage = document.getElementById('pageMine');

    if (listPage) listPage.hidden = false;
    if (minePage) minePage.hidden = true;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * マイ投稿ページ表示
   */
  function showMine() {
    const listPage = document.getElementById('post-app');
    const minePage = document.getElementById('pageMine');

    if (minePage) minePage.hidden = false;
    if (listPage) listPage.hidden = true;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // =========================
  // 5) いいね / 削除 / 一覧アクション
  // =========================

  // いいね送信中フラグ（postIdごと）
  const likePending = {};

  /**
   * 指定 postId の投稿オブジェクトを state から探す
   */
  function findPostItemById(postId) {
    const state = getDeckPostState_();
    const id = String(postId || '');

    const pick = (arr) => (arr || []).find((it) => String(it.postId) === id);

    return (
      pick(state?.mine?.items) ||
      pick(state?.list?.items) ||
      pick(state?.list?.filteredItems) ||
      pick(state?.list?.allItems) ||
      null
    );
  }

  /**
   * いいね状態を state / DOM に反映
   */
  function applyLikeState_(postId, liked, likeCount) {
    const state = getDeckPostState_();
    const pid = String(postId || '');

    const selector = `.post-card[data-postid="${pid}"] .fav-btn`;
    document.querySelectorAll(selector).forEach((el) => {
      el.classList.toggle('active', !!liked);
      el.textContent = buildLikeButtonContent_(liked, likeCount);
    });

    const updateList = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((it) => {
        if (String(it.postId) === pid) {
          it.liked = !!liked;
          it.likeCount = Number(likeCount || 0);
        }
      });
    };

    updateList(state?.list?.allItems);
    updateList(state?.list?.items);
    updateList(state?.list?.filteredItems);
    updateList(state?.mine?.items);
  }

  /**
   * いいねUIトグル
   * - 楽観的更新
   * - 失敗時ロールバック
   */
  async function handleToggleLike(postId, btn) {
    const pid = String(postId || '').trim();
    if (!pid || !btn) return;

    if (likePending[pid]) {
      alert('反映中です、しばらくしてからまたお試しください。');
      return;
    }

    const item = findPostItemById(pid) || {};
    const prevLiked = !!item.liked;
    const prevCount = Number(item.likeCount || 0);

    const optimisticLiked = !prevLiked;
    const optimisticCount = prevLiked
      ? Math.max(0, prevCount - 1)
      : prevCount + 1;

    applyLikeState_(pid, optimisticLiked, optimisticCount);

    likePending[pid] = true;
    btn.disabled = true;

    try {
      const res = await window.DeckPostApi.apiToggleLike({ postId: pid });

      if (!res || !res.ok) {
        applyLikeState_(pid, prevLiked, prevCount);

        const isAuthError = res && res.error === 'auth required';
        const msg = isAuthError
          ? 'いいねするにはログインが必要です。\nマイ投稿タブから新規登録またはログインしてください。'
          : `いいねに失敗しました。\n（エラー: ${(res && res.error) || 'unknown'}）`;

        alert(msg);
        return;
      }

      const liked = !!res.liked;
      const likeCount = Number(res.likeCount || 0);
      applyLikeState_(pid, liked, likeCount);

      const minePage = document.getElementById('pageMine');
      if (minePage && !minePage.hidden && getMineActiveTab_() === 'liked') {
        await loadMinePage(1);
      }
    } finally {
      likePending[pid] = false;
      btn.disabled = false;
    }
  }

  /**
   * 投稿削除API
   */
  async function deletePost_(postId) {
    const token = (window.Auth && window.Auth.token) || '';
    if (!token) return { ok: false, error: 'auth required' };

    return await window.gasPostDeckPost_({
      mode: 'delete',
      token,
      postId: String(postId || '').trim(),
    });
  }

  /**
   * 右ペイン初期化HTML
   */
  function buildEmptyDetailPaneHtml_(mode = 'list') {
    const accent = mode === 'mine'
      ? 'マイ投稿カード'
      : (mode === 'liked' ? 'いいねしたデッキカード' : '投稿カード');

    return `
      <div class="post-detail-empty">
        <div class="post-detail-empty-icon">👈</div>
        <div class="post-detail-empty-text">
          <div class="post-detail-empty-title">デッキ詳細パネル</div>
          <p class="post-detail-empty-main">
            左の<span class="post-detail-empty-accent">${accent}</span>をクリックすると、<br>
            ここにそのデッキの詳細が表示されます。
          </p>
        </div>
      </div>
    `;
  }

  /**
   * 削除後に右ペインを必要なら初期化
   */
  function resetDetailPaneIfShowing_(postId) {
    const pid = String(postId || '');

    const paneMine = document.getElementById('postDetailPaneMine');
    if (paneMine) {
      const showingId = paneMine.querySelector('.post-detail-inner')?.dataset?.postid;
      if (String(showingId || '') === pid) {
        paneMine.innerHTML = buildEmptyDetailPaneHtml_('mine');
      }
    }

    const paneList = document.getElementById('postDetailPane');
    if (paneList) {
      const showingId = paneList.querySelector('.post-detail-inner')?.dataset?.postid;
      if (String(showingId || '') === pid) {
        paneList.innerHTML = buildEmptyDetailPaneHtml_('list');
      }
    }
  }

  /**
   * 削除後に一覧stateから除外
   */
  function removePostFromListState_(postId) {
    const state = getDeckPostState_();
    const pid = String(postId || '');

    if (state?.list) {
      state.list.allItems = (state.list.allItems || []).filter(
        (it) => String(it.postId || '') !== pid
      );
      state.list.items = (state.list.items || []).filter(
        (it) => String(it.postId || '') !== pid
      );
      state.list.filteredItems = (state.list.filteredItems || []).filter(
        (it) => String(it.postId || '') !== pid
      );
      state.list.total = (state.list.allItems || []).length;
    }

    if (state?.mine) {
      state.mine.items = (state.mine.items || []).filter(
        (it) => String(it.postId || '') !== pid
      );
      state.mine.total = (state.mine.items || []).length;
      state.mine.page = 1;
      state.mine.totalPages = 1;
    }
  }

  /**
   * 一覧/マイ投稿アクションのイベント委任
   */
  function bindPostListActionHandlers_() {
    if (window.__deckPostListActionsBound) return;
    window.__deckPostListActionsBound = true;

document.addEventListener('click', async (e) => {

    // =========================
    // デッキ比較ポップアップ
    // =========================
    const deckComparePopupBtn = e.target.closest('#deckCompareNoticePopup [data-action]');
    if (deckComparePopupBtn) {
      const popup = document.getElementById('deckCompareNoticePopup');
      const action = deckComparePopupBtn.dataset.action;
      const postId = String(popup?.dataset?.postid || '').trim();

      if (action === 'close') {
        popup?.remove();
        return;
      }

      if (action === 'auth-login' || action === 'auth-signup') {
        popup?.remove();
        const mode = action === 'auth-signup' ? 'signup' : 'login';
        if (typeof window.openAuthModal === 'function') {
          window.openAuthModal(mode);
        } else {
          document.querySelector(`[data-open="authLoginModal"][data-auth-entry="${mode}"]`)?.click();
        }
        return;
      }

      if (action === 'like') {
        const favBtn = document.querySelector(
          `.post-card[data-postid="${postId}"] .fav-btn`
        );

        if (favBtn) {
          popup?.remove();
          favBtn.click();
        }
        return;
      }
    }
      // =========================
      // いいね
      // =========================
      const favBtn = e.target.closest('.fav-btn');
      if (favBtn) {
        const art = favBtn.closest('.post-card');
        const postId = String(art?.dataset?.postid || '').trim();
        if (!postId) return;

        e.preventDefault();
        e.stopPropagation();

        await handleToggleLike(postId, favBtn);
        return;
      }

      // =========================
      // マイ投稿：削除
      // =========================
      const btn = e.target.closest('#myPostList .delete-btn');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();

        const postId = String(btn.dataset.postid || '').trim();
        if (!postId) return;

        const card = btn.closest('.post-card');
        const title =
          card?.querySelector('.post-card-title')?.textContent?.trim() ||
          card?.querySelector('.pc-title')?.textContent?.trim() ||
          'この投稿';

        const msg =
`「${title}」を削除します。
削除すると元に戻せません。よろしいですか？`;

        const ok = await window.confirmDeleteByModal_?.(msg);
        if (!ok) return;

        btn.disabled = true;

        try {
          const r = await deletePost_(postId);
          if (!r || !r.ok) {
            alert((r && r.error) || '削除に失敗しました');
            return;
          }

          window.showActionToast?.('投稿を削除しました');

          resetDetailPaneIfShowing_(postId);
          removePostFromListState_(postId);

          await window.DeckPostList?.loadMinePage?.(1);
          await window.DeckPostList?.applySortAndRerenderList?.();
        } finally {
          btn.disabled = false;
        }
        return;
      }

      // =========================
      // 一覧カード：全体クリックで詳細表示（PCのみ）
      // =========================
      const art = e.target.closest('.post-card');
      if (!art) return;

      // 詳細内クリックは無視
      if (e.target.closest('.post-detail')) return;

      // ユーザータグ検索系は無視
      if (e.target.closest('.btn-user-tag-search')) return;
      if (e.target.closest('.post-tags-user')) return;

      const isPcWide = window.matchMedia('(min-width: 1024px)').matches;
      if (!isPcWide) {
        // SP/タブレットは「詳細」ボタンから開くので何もしない
        return;
      }

      window.DeckPostDetail?.showDetailPaneForArticle?.(art);
    });
  }



  // =========================
  // 6) 一覧取得
  // =========================
  /**
   * 一覧全件取得
   */
  async function fetchAllList() {
    const state = getDeckPostState_();
    if (state?.list?.hasAllItems) {
      updateFilterReadyState_();
      return state.list.allItems || [];
    }
    if (allListFetchPromise_) {
      updateFilterReadyState_();
      return allListFetchPromise_;
    }

    updateFilterReadyState_();
    updateListCacheRefreshButton_();
    allListFetchPromise_ = (async () => {
      const limit = FETCH_LIMIT;
      let offset = 0;
      const sharedPostId = getSharedPostIdFromUrl_();
      let total = sharedPostId ? 0 : Number(state?.list?.total || 0);
      let errorCount = 0;
      let completed = false;

      if (Array.isArray(state?.list?.items) && state.list.items.length) {
        mergeListItemsDedup_(state.list.items);
      }
      if (!backgroundListController_ || backgroundListController_.stopped) {
        backgroundListController_ = { stopped: false, reason: '', startedAt: Date.now() };
      }
      updateListLoadProgress_();

      while (true) {
        if (offset > 0) {
          const okToContinue = await waitBackgroundInterval_(backgroundListController_, BACKGROUND_FETCH_DELAY_MS);
          if (!okToContinue) break;
        }

        if (total && state.list.allItems.length >= total) {
          completed = true;
          break;
        }
        window.debugLog?.('F1 fetchAllList', { offset, limit });
        let res = null;
        try {
          res = await enqueueBackgroundListRequest_(() => window.DeckPostApi.apiList({
            limit,
            offset,
            mine: false,
            sort: 'new',
          }));
        } catch (e) {
          window.debugLog?.('❌ fetchAllList api error', e?.message || e);
          console.warn('fetchAllList api error:', e);
          errorCount += 1;
          if (errorCount >= BACKGROUND_MAX_ERROR_COUNT) {
            stopSlowBackgroundListFetch_('裏読み停止中');
            throw createListFetchError_(e?.message || 'list fetch failed');
          }
          continue;
        }

        window.debugLog?.('F2 fetchAllList result', {
          ok: res?.ok,
          error: res?.error,
          items: Array.isArray(res?.items) ? res.items.length : 'not array',
          total: res?.total,
          nextOffset: res?.nextOffset,
        });

        if (!res || !res.ok) {
          window.debugLog?.('❌ fetchAllList failed', res);
          console.warn('fetchAllList failed:', res);
          errorCount += 1;
          if (errorCount >= BACKGROUND_MAX_ERROR_COUNT) {
            stopSlowBackgroundListFetch_('裏読み停止中');
            throw createListFetchError_((res && res.error) || 'list fetch failed', res);
          }
          continue;
        }

        const items = Array.isArray(res.items) ? res.items : [];
        mergeListItemsDedup_(items);
        errorCount = 0;

      if (typeof res.total === 'number') {
        total = res.total;
        state.list.sourceTotal = total;
      }

        const nextOffset = (res.nextOffset ?? null);
        offset = nextOffset ?? (offset + items.length);
        state.list.total = total || state.list.total || state.list.allItems.length;
        updateListLoadProgress_();

        if (nextOffset === null || items.length === 0) {
          completed = true;
          break;
        }
        if (total && state.list.allItems.length >= total) {
          completed = true;
          break;
        }
      }

      if (!completed) {
        updateListLoadProgress_('裏読み停止中');
        return state.list.allItems;
      }

      if (shouldUseAllItemsForList_()) {
        state.list.items = state.list.allItems;
      }
      if (!hasActivePostFilter_() && !hasListSort_()) {
        state.list.filteredItems = getListItemsForFilterBase_(state.list.allItems);
      }
      state.list.total = total || state.list.allItems.length;
      state.list.hasAllItems = true;
      state.list.pageCache = state.list.pageCache || {};
      writeBrowserListAllCache_(state.list.allItems, state.list.total);
      listUsingBrowserCache_ = false;

      updateListLoadProgress_();
      return state.list.allItems;
    })().finally(() => {
      allListFetchPromise_ = null;
      updateFilterReadyState_();
      updateListCacheRefreshButton_();
    });
    updateFilterReadyState_();
    updateListCacheRefreshButton_();

    return allListFetchPromise_;
  }

  /**
   * 背景で全件取得を開始する
   */
  function prefetchAllListInBackground_() {
    const state = getDeckPostState_();
    if (state?.list?.hasAllItems || allListFetchPromise_) return;
    updateFilterReadyState_();
    fetchAllList().catch((e) => {
      console.warn('prefetchAllListInBackground_ failed:', e);
    });
  }

  function stopSlowBackgroundListFetch_(label = '裏読み停止中') {
    if (backgroundListController_) {
      backgroundListController_.stopped = true;
      backgroundListController_.reason = label;
    }
    updateListLoadProgress_(label);
  }

  function startSlowBackgroundListFetch_() {
    const state = getDeckPostState_();
    if (state?.list?.hasAllItems || normalizeCompleteAllItemsState_()) {
      updateListLoadProgress_();
      return;
    }
    if (allListFetchPromise_) return;

    backgroundListController_ = { stopped: false, reason: '', startedAt: Date.now() };
    updateListLoadProgress_();
    fetchAllList().catch((e) => {
      console.warn('startSlowBackgroundListFetch_ failed:', e);
      updateListLoadProgress_('裏読み停止中');
    });
  }

  async function prefetchListPage_(page) {
    const state = getDeckPostState_();
    const p = Math.max(Number(page || 1), 1);
    if (p <= 1 || shouldUseAllItemsForList_()) return null;
    if (state?.list?.pageCache?.[p]) return state.list.pageCache[p];
    if (document.hidden) return null;

    if (!backgroundListController_ || backgroundListController_.stopped) {
      backgroundListController_ = { stopped: false, reason: '', startedAt: Date.now() };
    }

    const controller = backgroundListController_;
    const okToContinue = await waitBackgroundInterval_(controller, BACKGROUND_FETCH_DELAY_MS);
    if (!okToContinue) return null;

    const offset = (p - 1) * PAGE_LIMIT;
    const res = await enqueueBackgroundListRequest_(() => window.DeckPostApi.apiList({
      limit: PAGE_LIMIT,
      offset,
      mine: false,
      sort: 'new',
    }));

    if (!res || !res.ok) {
      throw createListFetchError_((res && res.error) || 'list page prefetch failed', res);
    }

    const items = Array.isArray(res.items) ? res.items : [];
    const total = Number(res.total || state.list.total || 0);
    if (total > 0) state.list.sourceTotal = total;
    const totalPages = Math.max(1, Math.ceil(Math.max(total, 0) / PAGE_LIMIT));

    state.list.pageCache = state.list.pageCache || {};
    state.list.pageCache[p] = {
      items,
      total,
      totalPages,
      nextOffset: res.nextOffset ?? null,
    };
    state.list.total = total;
    state.list.totalPages = totalPages;
    mergeListItemsDedup_(items);
    updateListLoadProgress_();

    return state.list.pageCache[p];
  }

  function scheduleNextPagePrefetch_(fromPage) {
    const state = getDeckPostState_();
    if (shouldUseAllItemsForList_() || document.hidden) return;
    const nextPage = Number(fromPage || state?.list?.currentPage || 1) + 1;
    const totalPages = Number(state?.list?.totalPages || 1);
    if (nextPage > totalPages) return;
    if (state?.list?.pageCache?.[nextPage]) return;
    if (getLoadedPageItems_(nextPage)) return;

    prefetchListPage_(nextPage).catch((e) => {
      console.warn('prefetchListPage_ failed:', e);
      stopSlowBackgroundListFetch_('裏読み停止中');
    });
  }

  function stopCurrentPageDetailPrefetch_() {
    if (currentPageDetailPrefetchController_) {
      currentPageDetailPrefetchController_.stopped = true;
    }
  }

  function getPostIdFromPrefetchItem_(item) {
    return String(item?.postId || '').trim();
  }

  function showFirstCardAfterDetailPrefetch_(controller, firstPostId) {
    if (controller?.stopped || !window.matchMedia('(min-width: 1024px)').matches) return;
    if (document.querySelector('#postList .post-card.is-active')) return;

    const safePostId = window.CSS?.escape
      ? CSS.escape(firstPostId)
      : String(firstPostId).replace(/"/g, '\\"');
    const firstCard = document.querySelector(`#postList .post-card[data-postid="${safePostId}"]`);
    if (!firstCard || typeof detail().showDetailPaneForArticle !== 'function') return;

    const item = detail().findPostItemById?.(firstPostId);
    const hasDetail = detail().hasDetailPayload?.(item);
    detail().showDetailPaneForArticle(firstCard, hasDetail ? { skipFetch: true } : {});
  }

  function startCurrentPageDetailPrefetch_(pageItems) {
    stopCurrentPageDetailPrefetch_();

    const items = (Array.isArray(pageItems) ? pageItems : [])
      .filter((item) => !!getPostIdFromPrefetchItem_(item));
    if (!items.length) return;

    const D = detail();
    if (typeof D.prefetchPostDetail !== 'function' || typeof D.prefetchPostDetails !== 'function') {
      return;
    }

    const controller = { stopped: false, startedAt: Date.now() };
    currentPageDetailPrefetchController_ = controller;

    const [firstItem, ...restItems] = items;
    const firstPostId = getPostIdFromPrefetchItem_(firstItem);

    (async () => {
      await D.prefetchPostDetail(firstItem, { signal: controller });
      if (controller.stopped) return;

      showFirstCardAfterDetailPrefetch_(controller, firstPostId);

      if (restItems.length) {
        await D.prefetchPostDetails(restItems, {
          concurrency: 1,
          signal: controller,
        });
      }
    })().catch((e) => {
      if (!controller.stopped) console.warn('current page detail prefetch failed:', e);
    });
  }

  function hasActivePostFilter_() {
    const fs = window.PostFilterState || {};
    return (
      !!fs.selectedTags?.size ||
      !!fs.selectedUserTags?.size ||
      !!fs.selectedEnvironmentIds?.size ||
      !!fs.selectedContentFilters?.size ||
      !!fs.selectedCardCds?.size ||
      !!String(fs.selectedPosterKey || '').trim() ||
      !!String(fs.selectedPoster || '').trim() ||
      !!String(fs.selectedPostId || '').trim() ||
      !!String(fs.keywordQuery || '').trim()
    );
  }

  function shouldUseAllItemsForList_() {
    const state = getDeckPostState_();
    const sortKey = String(state?.list?.sortKey || 'new');
    return !!state?.list?.hasAllItems || hasCompleteAllItems_() || hasActivePostFilter_() || sortKey !== 'new';
  }

  function getBrowserListCacheTokenKey_() {
    const tokenKey = String(window.Auth?.token || getDeckPostState_()?.token || 'anon').slice(-12);
    return tokenKey || 'anon';
  }

  function getBrowserListAllCacheKey_() {
    return `DeckPostListAll:v1:new:${PAGE_LIMIT}:${getBrowserListCacheTokenKey_()}`;
  }

  function getBrowserListPageCacheKey_(page) {
    const p = Math.max(1, Number(page || 1) || 1);
    const tokenKey = getBrowserListCacheTokenKey_();
    return `DeckPostListPage:v2:new:${PAGE_LIMIT}:${p}:${tokenKey}`;
  }

  function readBrowserListAllCache_() {
    try {
      const raw = localStorage.getItem(getBrowserListAllCacheKey_());
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.items)) return null;
      if (Date.now() - Number(obj.savedAt || 0) > LIST_BROWSER_CACHE_TTL_MS) return null;
      const items = obj.items;
      const total = Number(obj.total || items.length || 0);
      return {
        allItems: items,
        items,
        total,
        totalPages: Math.max(1, Number(obj.totalPages || Math.ceil(Math.max(total, 0) / PAGE_LIMIT) || 1)),
        nextOffset: null,
        savedAt: Number(obj.savedAt || 0),
      };
    } catch (_) {
      return null;
    }
  }

  function readBrowserListPageCache_(page) {
    const allCache = readBrowserListAllCache_();
    if (!allCache) return null;

    const p = Math.max(1, Number(page || 1) || 1);
    const start = (p - 1) * PAGE_LIMIT;
    const items = allCache.allItems.slice(start, start + PAGE_LIMIT);

    return {
      ...allCache,
      items,
      nextOffset: (start + items.length < allCache.total) ? start + items.length : null,
    };
  }

  function writeBrowserListAllCache_(items, totalValue) {
    try {
      const savedAt = Date.now();
      const rows = Array.isArray(items) ? items : [];
      const total = Number(totalValue || rows.length || 0);
      const payload = {
        savedAt,
        items: rows,
        total,
        totalPages: Math.max(1, Math.ceil(Math.max(total, 0) / PAGE_LIMIT)),
      };
      localStorage.setItem(getBrowserListAllCacheKey_(), JSON.stringify(payload));
      updateListCacheStatus_(savedAt);
      return { ...payload };
    } catch (_) {
      // ブラウザ側キャッシュに保存できない場合も通常表示を続ける
      return null;
    }
  }

  async function collectLatestListSnapshot_() {
    const limit = FETCH_LIMIT;
    let offset = 0;
    let total = 0;
    let errorCount = 0;
    const allItems = [];
    const seen = new Set();

    updateListLoadProgress_('最新一覧を取得中…');

    while (true) {
      let res = null;
      try {
        res = await enqueueBackgroundListRequest_(() => window.DeckPostApi.apiList({
          limit,
          offset,
          mine: false,
          sort: 'new',
        }));
      } catch (e) {
        errorCount += 1;
        if (errorCount >= BACKGROUND_MAX_ERROR_COUNT) {
          throw createListFetchError_(e?.message || 'latest list fetch failed');
        }
        continue;
      }

      if (!res || !res.ok) {
        errorCount += 1;
        if (errorCount >= BACKGROUND_MAX_ERROR_COUNT) {
          throw createListFetchError_((res && res.error) || 'latest list fetch failed', res);
        }
        continue;
      }

      const items = Array.isArray(res.items) ? res.items : [];
      errorCount = 0;
      if (typeof res.total === 'number') total = res.total;

      for (const item of items) {
        const postId = String(item?.postId || '').trim();
        if (!postId || seen.has(postId)) continue;
        seen.add(postId);
        allItems.push(item);
      }

      updateListLoadProgress_(
        total
          ? `最新一覧を取得中… ${allItems.length} / ${total}`
          : `最新一覧を取得中… ${allItems.length}件読込済み`
      );

      const nextOffset = res.nextOffset ?? null;
      if (nextOffset === null || items.length === 0) break;
      offset = nextOffset;
      if (total && allItems.length >= total) break;
    }

    const saved = writeBrowserListAllCache_(allItems, total || allItems.length);
    updateListLoadProgress_(`最新一覧を取得しました ${allItems.length}件`);
    return {
      allItems,
      total: total || allItems.length,
      totalPages: Math.max(1, Math.ceil(Math.max(total || allItems.length, 0) / PAGE_LIMIT)),
      savedAt: Number(saved?.savedAt || Date.now()),
    };
  }

  async function refreshLatestListSnapshot_() {
    if (listLatestRefreshPromise_) return listLatestRefreshPromise_;

    listLatestRefreshPromise_ = (async () => {
      updateListCacheRefreshButton_();
      const snapshot = await collectLatestListSnapshot_();
      listLatestSnapshot_ = snapshot;
      return snapshot;
    })().catch((e) => {
      console.warn('投稿一覧の最新取得に失敗しました:', e);
      throw e;
    }).finally(() => {
      listLatestRefreshPromise_ = null;
      updateListCacheRefreshButton_();
    });

    return listLatestRefreshPromise_;
  }

  async function applyLatestListSnapshot_(page) {
    const state = getDeckPostState_();
    if (!state?.list || !listLatestSnapshot_ || applyingLatestSnapshot_) return false;

    applyingLatestSnapshot_ = true;
    try {
      const targetPage = Math.max(1, Number(page || state.list.currentPage || 1));
      state.list.allItems = listLatestSnapshot_.allItems.slice();
      state.list.items = state.list.allItems;
      state.list.filteredItems = getListItemsForFilterBase_(state.list.allItems);
      state.list.total = Number(listLatestSnapshot_.total || state.list.allItems.length || 0);
      state.list.totalPages = Math.max(1, Number(listLatestSnapshot_.totalPages || Math.ceil(Math.max(state.list.total, 0) / PAGE_LIMIT) || 1));
      state.list.currentPage = Math.min(targetPage, state.list.totalPages);
      state.list.nextOffset = null;
      state.list.hasAllItems = true;
      state.list.pageCache = {};
      state.list.sourceTotal = state.list.total;
      listUsingBrowserCache_ = false;
      listLatestSnapshot_ = null;

      window.DeckPostFilter?.rebuildFilteredItems?.();
      const filteredCount = Array.isArray(state.list.filteredItems)
        ? state.list.filteredItems.length
        : state.list.total;
      const visibleTotal = Math.max(0, Number(filteredCount || 0));
      state.list.totalPages = Math.max(1, Math.ceil(visibleTotal / PAGE_LIMIT));
      state.list.currentPage = Math.min(targetPage, state.list.totalPages);
      updateFilterReadyState_();
      await loadListPage(state.list.currentPage);
      updateListLoadProgress_();
      return true;
    } finally {
      applyingLatestSnapshot_ = false;
      updateListCacheRefreshButton_();
    }
  }

  /**
   * 通常一覧の指定ページだけ取得
   */
  async function fetchListPage_(page) {
    const state = getDeckPostState_();
    stopSlowBackgroundListFetch_('裏読み停止中');
    const maxKnownPages = Math.max(1, Number(state?.list?.totalPages || 1));
    const p = Math.min(Math.max(Number(page || 1), 1), maxKnownPages);
    const offset = (p - 1) * PAGE_LIMIT;

    await listBackgroundChain_.catch(() => {});

    const res = await window.DeckPostApi.apiList({
      limit: PAGE_LIMIT,
      offset,
      mine: false,
      sort: 'new',
    });

    if (!res || !res.ok) {
      throw createListFetchError_((res && res.error) || 'list page fetch failed', res);
    }

    const items = Array.isArray(res.items) ? res.items : [];
    const total = Number(res.total || 0);
    if (total > 0) state.list.sourceTotal = total;
    const totalPages = Math.max(1, Math.ceil(Math.max(total, 0) / PAGE_LIMIT));

    state.list.pageCache = state.list.pageCache || {};
    state.list.pageCache[p] = {
      items,
      total,
      totalPages,
      nextOffset: res.nextOffset ?? null,
    };
    state.list.items = items;
    // filteredItems は全件/フィルター用なので、ページ単位では上書きしない
    // state.list.filteredItems = items;
    state.list.total = total;
    state.list.totalPages = totalPages;
    state.list.currentPage = Math.min(Math.max(p, 1), state.list.totalPages);
    state.list.nextOffset = res.nextOffset ?? null;

    return items;
  }

  /**
   * フィルター・並び替えを再計算して一覧を再描画
   */
  async function applySortAndRerenderList(resetToFirstPage = false, opts = {}) {
    const state = getDeckPostState_();
    const page = resetToFirstPage ? 1 : (state?.list?.currentPage || 1);
    stopSlowBackgroundListFetch_('裏読み停止中');
    normalizeCompleteAllItemsState_();

    if (opts.useLatestSnapshot !== false && listLatestSnapshot_ && !applyingLatestSnapshot_) {
      await applyLatestListSnapshot_(page);
      return;
    }

    if (!shouldUseAllItemsForList_()) {
      loadListPage(page);
      return;
    }

    if (!state?.list?.hasAllItems) {
      try {
        await applyFilterIncrementally_({ resetToFirstPage });
        return;
      } catch (e) {
        console.warn('applySortAndRerenderList incremental filter failed:', e);
      }
    }

    // 全件未取得でも並び替え時には追加取得しない。スマホでの連続API失敗を避ける。
    if (!state?.list?.hasAllItems) {
      window.debugLog?.('S1 applySort without fetchAllList');
    }

    // フィルター・並び替えを再計算
    window.DeckPostFilter?.rebuildFilteredItems?.();

    // 描画するページを決めて再描画
    loadListPage(page);
  }

  // =========================
  // 7) ページング
  // =========================
  /**
   * 一覧用：ページャUI更新
   */
  function updatePagerUI() {
    const state = getDeckPostState_();

    const page = Number(state?.list?.currentPage || 1);
    const total = Number(state?.list?.totalPages || 1);

    const prev = document.getElementById('pagePrev');
    const next = document.getElementById('pageNext');
    const info = document.getElementById('pageInfo');

    if (info) info.textContent = `${page} / ${total}`;
    if (prev) prev.disabled = (page <= 1);
    if (next) next.disabled = (page >= total);

    const prevTop = document.getElementById('pagePrevTop');
    const nextTop = document.getElementById('pageNextTop');
    const infoTop = document.getElementById('pageInfoTop');

    if (infoTop) infoTop.textContent = `${page} / ${total}`;
    if (prevTop) prevTop.disabled = (page <= 1);
    if (nextTop) nextTop.disabled = (page >= total);
  }

  /**
   * 一覧上部へスクロール
   */
  function scrollToPostListTop_() {
    const top =
      document.getElementById('listControls') ||
      document.getElementById('postMainLayout');

    top?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'start',
    });
  }

  async function loadInitialSharedPost_(postId) {
    const pid = String(postId || '').trim();
    const state = getDeckPostState_();
    const listEl = document.getElementById('postList');
    if (!pid || !listEl) return false;

    showListStatusMessage('loading', '共有リンクのデッキを読み込み中…');

    const transferredItem = readTransferredPost_(pid);
    const res = await window.DeckPostApi?.apiGetPost?.({ postId: pid });
    const fetchedItem = res && res.ok !== false
      ? normalizeSharedPostResponse_(res, pid)
      : null;
    if (!fetchedItem && !transferredItem && (!res || res.ok === false)) {
      throw createListFetchError_((res && res.error) || 'shared post fetch failed', res);
    }

    const item = fetchedItem || transferredItem;
    if (!item) {
      throw createListFetchError_('shared post response invalid', {
        code: 'INVALID_SHARED_POST_RESPONSE',
        reason: '共有リンクの投稿データ形式が想定と異なります。',
      });
    }

    item.__sharedInitialOnly = true;

    state.list.allItems = [item];
    state.list.items = [item];
    state.list.filteredItems = [item];
    state.list.total = 1;
    state.list.totalPages = 1;
    state.list.currentPage = 1;
    state.list.nextOffset = 0;
    state.list.hasAllItems = false;
    state.list.pageCache = {};

    window.DeckPostFilter?.applySharedPostFromUrl?.();
    window.DeckPostFilter?.rebuildFilteredItems?.();

    const pageItems = Array.isArray(state.list.filteredItems) && state.list.filteredItems.length
      ? state.list.filteredItems
      : [item];

    listEl.replaceChildren();
    renderPostListInto('postList', pageItems, { mode: 'list' });
    const firstCard = listEl.querySelector('.post-card');
    if (firstCard && typeof detail().showDetailPaneForArticle === 'function') {
      detail().showDetailPaneForArticle(firstCard, { skipFetch: true });
    }
    scheduleVisibleSpDetailWarmup_();

    const total = pageItems.length;
    const resultCount = document.getElementById('resultCount');
    if (resultCount) resultCount.textContent = `投稿：${total}件`;

    const resultCountTop = document.getElementById('resultCountTop');
    if (resultCountTop) resultCountTop.textContent = `投稿：${total}件`;

    updatePagerUI();
    startCurrentPageDetailPrefetch_(pageItems);
    scrollToPostListTop_();
    return true;
  }

  /**
   * 共有リンク専用の1件表示を解除して通常一覧へ戻す
   */
  function clearSharedPostView_() {
    const state = getDeckPostState_();
    if (!state?.list) return;

    stopCurrentPageDetailPrefetch_();
    stopSlowBackgroundListFetch_('裏読み停止中');

    state.list.allItems = [];
    state.list.filteredItems = [];
    state.list.items = [];
    state.list.nextOffset = 0;
    state.list.currentPage = 1;
    state.list.totalPages = 1;
    state.list.total = 0;
    state.list.sourceTotal = 0;
    state.list.hasAllItems = false;
    state.list.pageCache = {};

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('pid');
      url.searchParams.delete('post');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  }

  function renderAdoptionCardSearchResults_(complete = false) {
    const state = getDeckPostState_();
    const listEl = document.getElementById('postList');
    if (!state?.list || !listEl) return;

    const filtered = Array.isArray(state.list.filteredItems) ? state.list.filteredItems : [];
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(Math.max(total, 0) / PAGE_LIMIT));
    const page = Math.min(Math.max(Number(state.list.currentPage || 1), 1), totalPages);
    const start = (page - 1) * PAGE_LIMIT;
    const pageItems = filtered.slice(start, start + PAGE_LIMIT);
    const showPendingTail = !complete && total > 0 && page === totalPages;

    state.list.total = total;
    state.list.totalPages = totalPages;
    state.list.currentPage = page;
    state.list.items = complete ? state.list.allItems : pageItems;

    listEl.replaceChildren();

    if (!total) {
      showListStatusMessage(
        complete ? 'empty' : 'loading',
        complete ? '条件に合う投稿がありません' : '採用デッキを検索中…'
      );
    } else {
      renderPostListInto('postList', pageItems, {
        mode: 'list',
        pendingMessage: showPendingTail ? '採用デッキを検索中…' : '',
        pendingSubText: showPendingTail ? '追加で条件に合う投稿が見つかる可能性があります。' : '',
      });
      scheduleVisibleSpDetailWarmup_();
      startCurrentPageDetailPrefetch_(pageItems);
    }

    const resultText = complete ? `投稿：${total}件` : `検索中：${total}件`;
    const resultCount = document.getElementById('resultCount');
    if (resultCount) resultCount.textContent = resultText;

    const resultCountTop = document.getElementById('resultCountTop');
    if (resultCountTop) resultCountTop.textContent = resultText;

    updatePagerUI();
  }

  function renderIncrementalFilterResults_(complete = false) {
    const state = getDeckPostState_();
    const listEl = document.getElementById('postList');
    if (!state?.list || !listEl) return;

    const filtered = Array.isArray(state.list.filteredItems) ? state.list.filteredItems : [];
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(Math.max(total, 0) / PAGE_LIMIT));
    let page = Math.min(Math.max(Number(state.list.currentPage || 1), 1), totalPages);
    const start = (page - 1) * PAGE_LIMIT;
    let pageItems = filtered.slice(start, start + PAGE_LIMIT);
    if (total > 0 && !pageItems.length) {
      page = 1;
      pageItems = filtered.slice(0, PAGE_LIMIT);
    }
    const showPendingTail = !complete && total > 0 && page === totalPages;

    state.list.total = total;
    state.list.totalPages = totalPages;
    state.list.currentPage = page;
    state.list.items = complete ? state.list.allItems : pageItems;

    listEl.replaceChildren();

    if (!total) {
      showListStatusMessage(
        complete ? 'empty' : 'loading',
        complete ? '条件に合う投稿がありません' : '条件に合う投稿を検索中…'
      );
    } else {
      renderPostListInto('postList', pageItems, {
        mode: 'list',
        pendingMessage: showPendingTail ? '条件に合う投稿を検索中…' : '',
        pendingSubText: showPendingTail ? '全投稿の読み込み完了まで結果が増える可能性があります。' : '',
      });
      scheduleVisibleSpDetailWarmup_();
      startCurrentPageDetailPrefetch_(pageItems);
    }

    const resultText = complete ? `投稿：${total}件` : `検索中：${total}件`;
    const resultCount = document.getElementById('resultCount');
    if (resultCount) resultCount.textContent = resultText;

    const resultCountTop = document.getElementById('resultCountTop');
    if (resultCountTop) resultCountTop.textContent = resultText;

    updatePagerUI();
  }

  async function revealIncrementalFilterChunk_(items, controller) {
    const state = getDeckPostState_();
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length || !state?.list) return;

    const batchSize = 10;
    for (let i = 0; i < rows.length && !controller?.stopped; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      mergeListItemsDedup_(chunk);
      window.DeckPostFilter?.rebuildFilteredItems?.();
      renderIncrementalFilterResults_(false);
      updateListLoadProgress_(`条件に合う投稿を検索中… ${state.list.allItems.length}件読込済み`);

      if (i + batchSize < rows.length) {
        await wait_(40);
      }
    }
  }

  async function applyFilterIncrementally_(opts = {}) {
    const state = getDeckPostState_();
    if (!state?.list) return [];

    if (incrementalFilterController_) {
      incrementalFilterController_.stopped = true;
    }
    const controller = { stopped: false, startedAt: Date.now() };
    incrementalFilterController_ = controller;

    stopSlowBackgroundListFetch_('裏読み停止中');
    stopCurrentPageDetailPrefetch_();

    if (opts.resetToFirstPage !== false) {
      state.list.currentPage = 1;
    }

    window.DeckPostFilter?.rebuildFilteredItems?.();
    renderIncrementalFilterResults_(!!state.list.hasAllItems);
    window.DeckPostFilter?.updateActiveChipsBar?.();

    if (state.list.hasAllItems || normalizeCompleteAllItemsState_()) {
      renderIncrementalFilterResults_(true);
      updateFilterReadyState_();
      return state.list.filteredItems || [];
    }

    if (!Array.isArray(state.list.filteredItems) || !state.list.filteredItems.length) {
      showListStatusMessage('loading', '条件に合う投稿を検索中…', {
        subText: '全投稿の読み込み完了まで結果が増える可能性があります。',
      });
    }
    const limit = FETCH_LIMIT;
    let offset = Array.isArray(state.list.allItems) ? state.list.allItems.length : 0;
    let totalKnown = getKnownSourceTotal_();
    let renderedOnce = false;
    let errorCount = 0;
    let completed = false;

    while (!controller.stopped) {
      if (offset > 0) {
        const okToContinue = await waitBackgroundInterval_(controller, BACKGROUND_FETCH_DELAY_MS);
        if (!okToContinue) break;
      }

      let res = null;
      try {
        res = await enqueueBackgroundListRequest_(() => window.DeckPostApi.apiList({
          limit,
          offset,
          mine: false,
          sort: 'new',
        }));
      } catch (e) {
        errorCount += 1;
        if (errorCount < BACKGROUND_MAX_ERROR_COUNT) {
          console.warn('フィルター用の追加取得を再試行します:', e);
          continue;
        }
        if (renderedOnce || state.list.allItems.length) {
          console.warn('フィルター用の追加取得に失敗しました:', e);
          updateListLoadProgress_('一部の投稿だけ表示中です');
          return state.list.filteredItems || [];
        }
        throw createListFetchError_(e?.message || 'filter incremental fetch failed');
      }

      if (!res || !res.ok) {
        errorCount += 1;
        if (errorCount < BACKGROUND_MAX_ERROR_COUNT) {
          console.warn('フィルター用の追加取得を再試行します:', res);
          continue;
        }
        if (renderedOnce || state.list.allItems.length) {
          console.warn('フィルター用の追加取得に失敗しました:', res);
          updateListLoadProgress_('一部の投稿だけ表示中です');
          return state.list.filteredItems || [];
        }
        throw createListFetchError_((res && res.error) || 'filter incremental fetch failed', res);
      }

      const items = Array.isArray(res.items) ? res.items : [];
      errorCount = 0;
      if (typeof res.total === 'number') {
        totalKnown = res.total;
        state.list.sourceTotal = totalKnown;
      }

      await revealIncrementalFilterChunk_(items, controller);
      renderedOnce = true;

      const loaded = state.list.allItems.length;
      updateListLoadProgress_(
        totalKnown
          ? `条件に合う投稿を検索中… ${loaded} / ${totalKnown}`
          : `条件に合う投稿を検索中… ${loaded}件読込済み`
      );

      const nextOffset = res.nextOffset ?? null;
      if (nextOffset === null || items.length === 0) {
        completed = true;
        break;
      }
      offset = nextOffset;
      if (totalKnown && state.list.allItems.length >= totalKnown) {
        completed = true;
        break;
      }
    }

    if (controller.stopped) return state.list.filteredItems || [];
    if (!completed) {
      updateListLoadProgress_('一部の投稿だけ表示中です');
      return state.list.filteredItems || [];
    }

    state.list.hasAllItems = true;
    state.list.items = state.list.allItems;
    state.list.total = getKnownSourceTotal_() || state.list.allItems.length;
    state.list.sourceTotal = state.list.total;
    writeBrowserListAllCache_(state.list.allItems, state.list.total);
    listUsingBrowserCache_ = false;
    window.DeckPostFilter?.rebuildFilteredItems?.();
    renderIncrementalFilterResults_(true);
    updateFilterReadyState_();
    updateListLoadProgress_(`検索完了 ${state.list.filteredItems.length}件`);
    return state.list.filteredItems || [];
  }

  async function loadInitialAdoptionCardSearch_(cd) {
    const targetCd = String(cd || '').trim();
    const state = getDeckPostState_();
    const listEl = document.getElementById('postList');
    if (!targetCd || !state?.list || !listEl) return false;

    stopSlowBackgroundListFetch_('裏読み停止中');
    stopCurrentPageDetailPrefetch_();

    state.list.allItems = [];
    state.list.items = [];
    state.list.filteredItems = [];
    state.list.nextOffset = 0;
    state.list.currentPage = 1;
    state.list.totalPages = 1;
    state.list.total = 0;
    state.list.sourceTotal = 0;
    state.list.hasAllItems = false;
    state.list.pageCache = {};

    window.DeckPostFilter?.applyAdoptionCardFromUrl?.();
    window.DeckPostFilter?.rebuildFilteredItems?.();
    window.DeckPostFilter?.updateActiveChipsBar?.();

    showListStatusMessage('loading', '採用デッキを検索中…', {
      subText: '追加で条件に合う投稿が見つかる可能性があります。',
    });
    updateListLoadProgress_('採用デッキを検索中…');

    const limit = FETCH_LIMIT;
    let offset = 0;
    let totalKnown = 0;
    let renderedOnce = false;

    while (true) {
      let res = null;
      try {
        res = await window.DeckPostApi.apiList({
          limit,
          offset,
          mine: false,
          sort: 'new',
        });
      } catch (e) {
        if (renderedOnce) {
          console.warn('採用デッキ検索の途中取得に失敗しました:', e);
          updateListLoadProgress_('一部の投稿だけ表示中です');
          return true;
        }
        throw createListFetchError_(e?.message || 'adoption card search failed');
      }

      if (!res || !res.ok) {
        if (renderedOnce) {
          console.warn('採用デッキ検索の途中取得に失敗しました:', res);
          updateListLoadProgress_('一部の投稿だけ表示中です');
          return true;
        }
        throw createListFetchError_((res && res.error) || 'adoption card search failed', res);
      }

      const items = Array.isArray(res.items) ? res.items : [];
      mergeListItemsDedup_(items);

      if (typeof res.total === 'number') {
        totalKnown = res.total;
        state.list.sourceTotal = totalKnown;
      }

      window.DeckPostFilter?.applyAdoptionCardFromUrl?.();
      window.DeckPostFilter?.rebuildFilteredItems?.();

      const hitCount = Array.isArray(state.list.filteredItems) ? state.list.filteredItems.length : 0;
      if (hitCount || renderedOnce) {
        renderedOnce = true;
        renderAdoptionCardSearchResults_(false);
      } else {
        showListStatusMessage('loading', '採用デッキを検索中…', {
          subText: '追加で条件に合う投稿が見つかる可能性があります。',
        });
      }

      const loaded = state.list.allItems.length;
      updateListLoadProgress_(
        totalKnown
          ? `採用デッキを検索中… ${loaded} / ${totalKnown}`
          : `採用デッキを検索中… ${loaded}件読込済み`
      );

      const nextOffset = res.nextOffset ?? null;
      if (nextOffset === null || items.length === 0) break;
      offset = nextOffset;
      if (totalKnown && state.list.allItems.length >= totalKnown) break;
    }

    state.list.hasAllItems = true;
    state.list.items = state.list.allItems;
    state.list.total = totalKnown || state.list.allItems.length;
    state.list.sourceTotal = state.list.total;
    writeBrowserListAllCache_(state.list.allItems, state.list.total);
    listUsingBrowserCache_ = false;
    window.DeckPostFilter?.applyAdoptionCardFromUrl?.();
    window.DeckPostFilter?.rebuildFilteredItems?.();
    renderAdoptionCardSearchResults_(true);
    updateFilterReadyState_();
    updateListLoadProgress_(`採用デッキ検索完了 ${state.list.filteredItems.length}件`);
    scrollToPostListTop_();
    return true;
  }

  /**
   * 一覧用：指定ページを描画
   */
  async function loadListPage(page, opts = {}) {
    const state = getDeckPostState_();
    stopCurrentPageDetailPrefetch_();
    normalizeCompleteAllItemsState_();

    const listEl = document.getElementById('postList');
    if (!listEl) return;

    const requestedPage = Math.max(Number(page || 1), 1);
    if (opts.useLatestSnapshot && listLatestSnapshot_ && !applyingLatestSnapshot_) {
      await applyLatestListSnapshot_(requestedPage);
      return;
    }

    normalizeCompleteAllItemsState_();
    const usesAllItems = shouldUseAllItemsForList_();
    const pageCache = state.list.pageCache || {};
    const browserCachedPage = !usesAllItems ? readBrowserListPageCache_(requestedPage) : null;
    if (!pageCache[requestedPage] && browserCachedPage) {
      pageCache[requestedPage] = browserCachedPage;
      state.list.pageCache = pageCache;
      updateListCacheStatus_(browserCachedPage.savedAt);
    }
    const cachedPage = pageCache[requestedPage] || null;
    const loadedPageItems = !usesAllItems ? getLoadedPageItems_(requestedPage) : null;
    const hasCurrentPageItems =
      !usesAllItems &&
      Number(state?.list?.currentPage || 0) === requestedPage &&
      Array.isArray(state?.list?.items) &&
      state.list.items.length > 0;

    if (!usesAllItems && cachedPage && Array.isArray(cachedPage.items)) {
      state.list.items = cachedPage.items;
      // filteredItems は全件/フィルター用なので、ページ単位では上書きしない
      // state.list.filteredItems = cachedPage.items;
      state.list.total = Number(cachedPage.total || state.list.total || cachedPage.items.length);
      state.list.totalPages = Number(cachedPage.totalPages || state.list.totalPages || 1);
      state.list.currentPage = requestedPage;
      state.list.nextOffset = cachedPage.nextOffset ?? null;
    } else if (!usesAllItems && loadedPageItems) {
      state.list.items = loadedPageItems;
      // filteredItems は全件/フィルター用なので、ページ単位では上書きしない
      // state.list.filteredItems = loadedPageItems;
      state.list.currentPage = requestedPage;
    }

    if (usesAllItems && !state?.list?.hasAllItems) {
      try {
        listEl.replaceChildren();
        showListStatusMessage('loading', '全投稿を読み込み中です…', {
          progress: getPageLoadProgress_(requestedPage),
        });
        await fetchAllList();
        window.DeckPostFilter?.rebuildFilteredItems?.();
      } catch (e) {
        console.error('全件取得に失敗しました', e);
        showListStatusMessage(
          'error',
          '投稿一覧の読み込みに失敗しました。ページを再読み込みしてください。'
          ,
          getListErrorDetails_(e, 'LIST_ALL_FETCH_FAILED')
        );
        return;
      }
    } else if (!usesAllItems && !cachedPage && !loadedPageItems && !hasCurrentPageItems) {
      try {
        listEl.replaceChildren();
        showListStatusMessage('loading', '投稿一覧を読み込み中です…', {
          progress: getPageLoadProgress_(requestedPage),
        });
        await fetchListPage_(requestedPage);
      } catch (e) {
        console.error('一覧ページ取得に失敗しました', e);
        showListStatusMessage(
          'error',
          '投稿一覧の読み込みに失敗しました。ページを再読み込みしてください。'
          ,
          getListErrorDetails_(e, 'LIST_PAGE_FETCH_FAILED')
        );
        return;
      }
    }

    const filtered = Array.isArray(state?.list?.filteredItems)
      ? state.list.filteredItems
      : [];

    const cachedItems = Array.isArray(cachedPage?.items)
      ? cachedPage.items
      : null;

    const sourceItems = usesAllItems
      ? filtered
      : (cachedItems || loadedPageItems || state.list.items || []);

    const total = Number(state?.list?.total || sourceItems.length || 0);
    const totalPages = total > 0
      ? Math.max(1, Math.ceil(total / PAGE_LIMIT))
      : 1;

    state.list.totalPages = totalPages;

    const p = Math.min(Math.max(Number(page || 1), 1), totalPages);
    state.list.currentPage = p;

    const start = (p - 1) * PAGE_LIMIT;
    const end = start + PAGE_LIMIT;
    const pageItems = usesAllItems && state?.list?.hasAllItems
      ? sourceItems.slice(start, end)
      : sourceItems;

    listEl.replaceChildren();

    if (!sourceItems.length) {
      showListStatusMessage('empty', '条件に合う投稿がありません');
      updatePagerUI();

      const resultCount = document.getElementById('resultCount');
      if (resultCount) resultCount.textContent = '0件';

      const resultCountTop = document.getElementById('resultCountTop');
      if (resultCountTop) resultCountTop.textContent = '0件';

      const pane = document.getElementById('postDetailPane');
      if (pane) {
        pane.innerHTML = `
          <div class="post-detail-empty">
            <div class="post-detail-empty-icon">👈</div>
            <div class="post-detail-empty-text">
              <div class="post-detail-empty-title">デッキ詳細パネル</div>
              <p class="post-detail-empty-main">
                左の<span class="post-detail-empty-accent">投稿カード</span>をクリックすると、<br>
                ここにそのデッキの詳細が表示されます。
              </p>
            </div>
          </div>
        `;
      }
      return;
    }

    renderPostListInto('postList', pageItems, { mode: 'list' });
    scheduleVisibleSpDetailWarmup_();

    const resultCount = document.getElementById('resultCount');
    if (resultCount) resultCount.textContent = `投稿：${total}件`;

    const resultCountTop = document.getElementById('resultCountTop');
    if (resultCountTop) resultCountTop.textContent = `投稿：${total}件`;

    updatePagerUI();
    scheduleNextPagePrefetch_(p);
    startSlowBackgroundListFetch_();
    startCurrentPageDetailPrefetch_(pageItems);

    scrollToPostListTop_();
  }

  // =========================
  // 8) マイ投稿取得
  // =========================
  /**
   * マイ投稿先読み
   */
  async function prefetchMineItems_({ force = false } = {}) {
    const state = getDeckPostState_();

    const tk =
      (window.Auth && window.Auth.token) ||
      state?.token ||
      window.DeckPostApi.resolveToken();

    if (!tk) return null;

    if (!force && hasValidMineCache_()) {
      return state.mine.items;
    }

    const inFlight = window.DeckPostState.getMinePrefetchPromise();
    if (inFlight) return inFlight;

    const promise = (async () => {
      const limit = PAGE_LIMIT;
      let offset = 0;
      let allItems = [];
      let total = 0;

      while (true) {
        const res = await window.DeckPostApi.apiList({
          limit,
          offset,
          mine: true,
        });

        if (res && res.error === 'auth required') {
          state.mine.items = [];
          state.mine.total = 0;
          window.DeckPostState.invalidateMineCache();
          return state.mine.items;
        }

        if (!res || !res.ok) {
          throw new Error((res && res.error) || 'prefetch mine failed');
        }

        const items = Array.isArray(res.items) ? res.items : [];
        if (!total) total = Number(res.total || 0);

        allItems.push(...items);
        offset += items.length;

        if (items.length < limit) break;
        if (total && allItems.length >= total) break;
      }

      window.DeckPostState.setMineItems(allItems, total || allItems.length);
      return allItems;
    })().finally(() => {
      window.DeckPostState.setMinePrefetchPromise(null);
    });

    window.DeckPostState.setMinePrefetchPromise(promise);
    return promise;
  }

  /**
   * マイ投稿ページで使う認証トークンを取得する
   */
  function getMineAuthToken_() {
    const state = getDeckPostState_();
    return (
      (window.Auth && window.Auth.token) ||
      state?.token ||
      window.DeckPostApi.resolveToken()
    );
  }

  /**
   * マイ投稿ページの未ログイン案内をタブごとに切り替える
   */
  function updateMineLoginMessage_(tab) {
    const titleEl = document.getElementById('mine-error-title');
    const msgEl = document.getElementById('mine-error-msg');
    if (tab === 'liked') {
      if (titleEl) titleEl.textContent = 'ここにいいねしたデッキが表示されます。';
      if (msgEl) msgEl.textContent = 'ログインすると、いいねしたデッキ一覧を確認できます。';
      return;
    }

    if (titleEl) titleEl.textContent = 'ここにあなたの投稿が表示されます。';
    if (msgEl) msgEl.textContent = 'ログインすると、投稿したデッキ一覧を確認できます。';
  }

  /**
   * マイ投稿ページの空表示をタブごとに切り替える
   */
  function updateMineEmptyMessage_(tab) {
    const emptyEl = document.getElementById('mine-empty');
    if (!emptyEl) return;

    if (tab === 'liked') {
      emptyEl.innerHTML = `
        <p>まだいいねしたデッキがありません。</p>
      `;
      return;
    }

    emptyEl.innerHTML = `
      <p>まだ投稿がありません。</p>
      <p>
        <a href="deckmaker.html" class="mine-empty-link">
          🃏 デッキメーカーでデッキを作りましょう！
        </a>
      </p>
    `;
  }

  /**
   * マイ投稿ページの右ペインを初期表示に戻す
   */
  function resetMineDetailPane_(tab = getMineActiveTab_()) {
    const paneMine = document.getElementById('postDetailPaneMine');
    if (!paneMine) return;
    paneMine.innerHTML = buildEmptyDetailPaneHtml_(tab === 'liked' ? 'liked' : 'mine');
  }

  /**
   * PC幅では先頭カードを詳細ペインへ表示する
   */
  function showFirstMineCardDetail_() {
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    const firstCard = document.querySelector('#myPostList .post-card');
    if (firstCard && typeof detail().showDetailPaneForArticle === 'function') {
      detail().showDetailPaneForArticle(firstCard);
    }
  }

  /**
   * いいねしたデッキタブを描画する
   */
  async function loadLikedDeckPage_() {
    const state = getDeckPostState_();
    const listEl = document.getElementById('myPostList');
    const emptyEl = document.getElementById('mine-empty');
    const errorEl = document.getElementById('mine-error');
    const loadingEl = document.getElementById('mine-loading');
    if (!listEl) return;

    updateMineTabsUI_();
    updateMineLoginMessage_('liked');
    updateMineEmptyMessage_('liked');

    if (!getMineAuthToken_()) {
      listEl.replaceChildren();
      if (emptyEl) emptyEl.style.display = 'none';
      if (errorEl) errorEl.style.display = '';
      if (loadingEl) loadingEl.style.display = 'none';
      updateMineCountUI_('liked', 0);
      resetMineDetailPane_('liked');
      return;
    }

    state.mine.loading = true;
    if (loadingEl) loadingEl.style.display = '';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
      if (!state?.list?.hasAllItems) {
        listEl.replaceChildren();
        listEl.innerHTML = '<div class="post-list-message">いいねしたデッキを読み込み中です…</div>';
        await fetchAllList();
      }

      const likedItems = getLikedDeckItems_();
      renderPostListInto('myPostList', likedItems, { mode: 'liked' });
      updateMineCountUI_('liked', likedItems.length);

      if (emptyEl) emptyEl.style.display = likedItems.length ? 'none' : '';
      if (errorEl) errorEl.style.display = 'none';

      if (likedItems.length) {
        showFirstMineCardDetail_();
      } else {
        resetMineDetailPane_('liked');
      }
    } catch (e) {
      console.error('loadLikedDeckPage_ error:', e);
      if (errorEl) {
        const titleEl = document.getElementById('mine-error-title');
        const msgEl = document.getElementById('mine-error-msg');
        if (titleEl) titleEl.textContent = 'いいねしたデッキの読み込みに失敗しました。';
        if (msgEl) msgEl.textContent = '時間をおいてから、もう一度お試しください。';
        errorEl.style.display = '';
      }
      resetMineDetailPane_('liked');
    } finally {
      state.mine.loading = false;
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /**
   * マイ投稿描画
   */
  async function loadMinePage(_page = 1) {
    const state = getDeckPostState_();
    const activeTab = getMineActiveTab_();

    updateMineTabsUI_();
    if (activeTab === 'liked') {
      await loadLikedDeckPage_();
      return;
    }

    const listEl = document.getElementById('myPostList');
    const emptyEl = document.getElementById('mine-empty');
    const errorEl = document.getElementById('mine-error');
    const loadingEl = document.getElementById('mine-loading');
    if (!listEl) return;

    updateMineLoginMessage_('posts');
    updateMineEmptyMessage_('posts');

    if (hasValidMineCache_() && !state.mine.loading) {
      const allItems = state.mine.items || [];
      state.mine.items = allItems;
      state.mine.total = Number(state.mine.total || allItems.length);
      state.mine.page = 1;
      state.mine.totalPages = 1;
      state.mine.loading = false;

      renderPostListInto('myPostList', allItems, { mode: 'mine' });
      updateMineCountUI_('posts');

      if (emptyEl) emptyEl.style.display = allItems.length ? 'none' : '';
      if (errorEl) errorEl.style.display = 'none';
      if (loadingEl) loadingEl.style.display = 'none';

      if (allItems.length) {
        showFirstMineCardDetail_();
      } else {
        resetMineDetailPane_('posts');
      }
      return;
    }

    const limit = PAGE_LIMIT;
    let offset = 0;
    let allItems = [];
    let total = 0;

    state.mine.loading = true;

    if (loadingEl) loadingEl.style.display = '';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
      while (true) {
        const res = await window.DeckPostApi.apiList({
          limit,
          offset,
          mine: true,
        });

        if (res && res.error === 'auth required') {
          state.mine.items = [];
          state.mine.page = 1;
          state.mine.totalPages = 1;
          state.mine.total = 0;
          window.DeckPostState.invalidateMineCache();

          listEl.replaceChildren();

          const paneMine = document.getElementById('postDetailPaneMine');
          if (paneMine) {
            paneMine.innerHTML = `
              <div class="post-detail-empty">
                マイ投稿を表示するにはログインが必要です。
              </div>
            `;
          }

          if (emptyEl) emptyEl.style.display = 'none';
          if (errorEl) errorEl.style.display = '';

          updateMineLoginMessage_('posts');
          updateMineCountUI_('posts');
          return;
        }

        if (!res || !res.ok) {
          throw new Error((res && res.error) || 'list mine failed');
        }

        const items = Array.isArray(res.items) ? res.items : [];
        if (!total) total = Number(res.total || 0);

        allItems.push(...items);
        offset += items.length;

        if (items.length < limit) break;
        if (total && allItems.length >= total) break;
      }

      state.mine.page = 1;
      state.mine.totalPages = 1;
      window.DeckPostState.setMineItems(allItems, total || allItems.length);

      renderPostListInto('myPostList', allItems, { mode: 'mine' });
      updateMineCountUI_('posts');

      if (emptyEl) emptyEl.style.display = allItems.length ? 'none' : '';

      const paneMine = document.getElementById('postDetailPaneMine');
      if (paneMine) {
        if (!allItems.length) {
          resetMineDetailPane_('posts');
        } else {
          showFirstMineCardDetail_();
        }
      }
    } catch (e) {
      console.error('loadMinePage error:', e);
      if (errorEl) errorEl.style.display = '';
    } finally {
      state.mine.loading = false;
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  // =========================
  // 9) 認証変更時再読込
  // =========================
  /**
   * 認証変更時フック
   */
  function handleAuthChangedForDeckPost() {
    const state = getDeckPostState_();

    updateMineLoginStatus();

    state.token = window.DeckPostApi.resolveToken();
    allListFetchPromise_ = null;
    state.list.hasAllItems = false;
    state.list.allItems = [];
    window.DeckPostState.invalidateMineCache();
    updateFilterReadyState_();

    if (window.DeckPostState.isInitialized()) {
      (async () => {
        try {
          await window.DeckPostList?.fetchAllList?.();
          window.DeckPostFilter?.rebuildFilteredItems?.();
          const cur = state.list.currentPage || 1;
          window.DeckPostList?.loadListPage?.(cur);
        } catch (e) {
          console.error('handleAuthChangedForDeckPost: reload list failed', e);
        }
      })();
    }

    const minePage = document.getElementById('pageMine');
    const mineVisible = minePage && !minePage.hidden;

    if (state.token && !state.mine.loading) {
      prefetchMineItems_({ force: true }).catch((e) => {
        console.warn('prefetchMineItems_ failed:', e);
      });
    }

    if (mineVisible && !state.mine.loading) {
      (async () => {
        if (getMineActiveTab_() === 'posts') {
          try {
            await prefetchMineItems_();
          } catch (_) {}
        }
        await window.DeckPostList?.loadMinePage?.(1);
      })();
    }
  }

  // =========================
  // 10) ページャ配線
  // =========================
  /**
   * 一覧ページャ配線
   */
  function bindListPagerButtons_() {
    if (window.__deckPostPagerBound) return;
    window.__deckPostPagerBound = true;

    const onPrev = () => {
      const state = getDeckPostState_();
      const page = Number(state?.list?.currentPage || 1);
      if (page > 1) window.DeckPostList?.loadListPage?.(page - 1, { useLatestSnapshot: true });
    };

    const onNext = () => {
      const state = getDeckPostState_();
      const page = Number(state?.list?.currentPage || 1);
      const total = Number(state?.list?.totalPages || 1);
      if (page < total) window.DeckPostList?.loadListPage?.(page + 1, { useLatestSnapshot: true });
    };

    document.getElementById('pagePrevTop')?.addEventListener('click', onPrev);
    document.getElementById('pageNextTop')?.addEventListener('click', onNext);
    document.getElementById('pagePrev')?.addEventListener('click', onPrev);
    document.getElementById('pageNext')?.addEventListener('click', onNext);
  }


  // =========================
  // 11) 一覧初期化
  // =========================
      /**
   * 一覧ページ初期化
   * - sortSelect 初期化
   * - 初回一覧取得＆描画
   * - PC/SP境界またぎ時の再描画
   */
  async function init() {
    const state = getDeckPostState_();

    bindListPaneHeightSync_();
    ensureListLoadProgressEl_();
    updateFilterReadyState_();

    if (!window.__deckPostListVisibilityBound) {
      window.__deckPostListVisibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          stopSlowBackgroundListFetch_('裏読み停止中');
          stopCurrentPageDetailPrefetch_();
        }
      });
    }

    // =========================
    // 並び替えセレクト初期化
    // =========================
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect && !sortSelect.dataset.boundDeckPostSort) {
      sortSelect.dataset.boundDeckPostSort = '1';

      state.list.sortKey = sortSelect.value || 'new';

      sortSelect.addEventListener('change', () => {
        const nextSort = sortSelect.value || 'new';
        if (nextSort !== 'new' && !(state?.list?.hasAllItems || normalizeCompleteAllItemsState_())) {
          sortSelect.value = 'new';
          state.list.sortKey = 'new';
          return;
        }

        state.list.sortKey = sortSelect.value || 'new';
        window.DeckPostList?.applySortAndRerenderList?.();
      });
    }

    const cacheStatusEl = ensureListCacheStatusEl_();
    updateListCacheStatus_(0);
    const cacheRefreshBtn = cacheStatusEl?.querySelector('[data-list-cache-refresh]');
    if (cacheRefreshBtn && !cacheRefreshBtn.dataset.boundListCacheRefresh) {
      cacheRefreshBtn.dataset.boundListCacheRefresh = '1';
      cacheRefreshBtn.addEventListener('click', async () => {
        const page = getCurrentListPage_();
        const prevText = cacheRefreshBtn.textContent || '更新';
        listManualCacheRefreshBusy_ = true;
        cacheRefreshBtn.hidden = false;
        cacheRefreshBtn.disabled = true;
        cacheRefreshBtn.setAttribute('aria-busy', 'true');
        cacheRefreshBtn.textContent = listLatestSnapshot_ ? '表示中' : '更新中';

        try {
          if (listLatestSnapshot_) {
            await applyLatestListSnapshot_(page);
            window.showActionToast?.('最新の投稿一覧を表示しました');
            return;
          }

          await refreshLatestListSnapshot_();
          await applyLatestListSnapshot_(page);
          window.showActionToast?.('投稿一覧を更新しました');
        } catch (e) {
          console.warn('投稿一覧の手動更新に失敗しました', e);
          window.showActionToast?.('投稿一覧を更新できませんでした');
        } finally {
          listManualCacheRefreshBusy_ = false;
          cacheRefreshBtn.disabled = false;
          cacheRefreshBtn.removeAttribute('aria-busy');
          cacheRefreshBtn.textContent = prevText;
          updateListCacheRefreshButton_();
        }
      });
    }

    // =========================
    // 初回一覧取得 → 初期描画
    // =========================
    try {
      state.list.loading = true;
      const sharedPostId = getSharedPostIdFromUrl_();
      const adoptionCardCd = getAdoptionCardCdFromUrl_();
      const shouldLoadAllInitially = shouldLoadAllItemsInitially_();
      const initialBrowserCache = (!sharedPostId && !adoptionCardCd && !shouldLoadAllInitially)
        ? readBrowserListPageCache_(1)
        : null;
      window.debugLog?.('L0 list init branch', {
        sharedPostId,
        adoptionCardCd,
        shouldLoadAllInitially,
        search: window.location.search || '',
        hasAllItems: !!state?.list?.hasAllItems,
        items: Array.isArray(state?.list?.items) ? state.list.items.length : 'not array',
      });
      if (!initialBrowserCache) window.DeckPostList?.showListStatusMessage?.(
        'loading',
        '最新の投稿を読み込み中…'
      );

      if (sharedPostId) {
        window.debugLog?.('L0S shared post apiGetPost前', { sharedPostId });
        await loadInitialSharedPost_(sharedPostId);
        window.debugLog?.('L0T shared post apiGetPost後');
      } else if (adoptionCardCd) {
        window.debugLog?.('L0C adoption card search前', { adoptionCardCd });
        await loadInitialAdoptionCardSearch_(adoptionCardCd);
        window.debugLog?.('L0D adoption card search後', {
          hasAllItems: !!state?.list?.hasAllItems,
          filtered: Array.isArray(state?.list?.filteredItems) ? state.list.filteredItems.length : 'not array',
        });
      } else if (shouldLoadAllInitially) {
        window.debugLog?.('L0A shared url fetchAllList前');
        await window.DeckPostList?.fetchAllList?.();
        window.debugLog?.('L0B shared url fetchAllList後', {
          hasAllItems: !!state?.list?.hasAllItems,
          items: Array.isArray(state?.list?.items) ? state.list.items.length : 'not array',
        });
        window.DeckPostFilter?.applySharedPostFromUrl?.();
        window.DeckPostFilter?.rebuildFilteredItems?.();
      } else if (initialBrowserCache) {
        const cachedAllItems = Array.isArray(initialBrowserCache.allItems)
          ? initialBrowserCache.allItems
          : initialBrowserCache.items;
        state.list.allItems = cachedAllItems.slice();
        state.list.items = initialBrowserCache.items;
        state.list.filteredItems = getListItemsForFilterBase_(state.list.allItems);
        state.list.total = Number(initialBrowserCache.total || initialBrowserCache.items.length || 0);
        state.list.totalPages = Math.max(1, Number(initialBrowserCache.totalPages || 1));
        state.list.currentPage = 1;
        state.list.nextOffset = null;
        state.list.hasAllItems = true;
        state.list.pageCache = {};
        if (state.list.total > 0) state.list.sourceTotal = state.list.total;
        listUsingBrowserCache_ = true;
        updateFilterReadyState_();
        updateListCacheStatus_(initialBrowserCache.savedAt);
      } else {
        window.debugLog?.('L1 初回apiList前');

        const res = await window.DeckPostApi.apiList({
          limit: PAGE_LIMIT,
          offset: 0,
          mine: false,
          sort: 'new',
        });

        window.debugLog?.('L2 初回apiList結果', {
          ok: res?.ok,
          error: res?.error,
          items: Array.isArray(res?.items) ? res.items.length : 'not array',
          total: res?.total,
          nextOffset: res?.nextOffset,
        });

        if (!res || !res.ok) {
          window.debugLog?.('❌ 初回apiList失敗', res);
          throw createListFetchError_((res && res.error) || 'initial list fetch failed', res);
        }

        const items = Array.isArray(res.items) ? res.items : [];
        const total = Number(res.total || 0);
        if (total > 0) state.list.sourceTotal = total;

        state.list.allItems = [];
        state.list.items = items;
        state.list.filteredItems = items;
        state.list.total = total;
        state.list.totalPages = Math.max(1, Math.ceil(Math.max(total, 0) / PAGE_LIMIT));
        state.list.currentPage = 1;
        state.list.nextOffset = res.nextOffset ?? null;
        state.list.hasAllItems = false;
        state.list.pageCache = {
          1: {
            items,
            total,
            totalPages: state.list.totalPages,
            nextOffset: state.list.nextOffset,
          },
        };
        mergeListItemsDedup_(items);
        updateFilterReadyState_();
      }

      if (!sharedPostId && !adoptionCardCd) {
        // 初回一覧の体感速度とGAS通信の安定性を優先し、マイ投稿はマイページ表示時に読む。
        // prefetchMineItems_().catch(() => {});
        // スマホ/タブレットでGAS連続取得が不安定なため、初期表示時の全件先読みは停止する。
        // prefetchAllListInBackground_();
        await window.DeckPostList?.loadListPage?.(1);
        if (initialBrowserCache) {
          refreshLatestListSnapshot_().catch(() => {});
        }
      }
    } catch (e) {
      window.debugLog?.('❌ 初期一覧取得catch', e.message);
      console.error('初期一覧取得に失敗しました', e);
      window.DeckPostList?.showListStatusMessage?.(
        'error',
        '投稿一覧の読み込みに失敗しました。ページを再読み込みしてください。'
        ,
        getListErrorDetails_(e, 'INITIAL_LIST_FETCH_FAILED')
      );
    } finally {
      state.list.loading = false;
      updateListCacheRefreshButton_();
    }

    // =========================
    // PC/SP境界またぎ時の再描画
    // =========================
    if (!window.__deckPostListResizeBound) {
      window.__deckPostListResizeBound = true;

      const isPcWide = () => window.matchMedia('(min-width: 1024px)').matches;
      let last = isPcWide();
      let tid = null;

      const onChange = () => {
        clearTimeout(tid);
        tid = setTimeout(() => {
          // SP簡易オーバーレイが出っぱなしなら閉じる
          const pane = document.getElementById('deckpeek-overlay');
          if (pane) pane.style.display = 'none';

          // 1023/1024 を跨いだら一覧を再描画
          const now = isPcWide();
          if (now !== last) {
            last = now;
            const minePage = document.getElementById('pageMine');
            if (minePage && !minePage.hidden) {
              window.DeckPostList?.loadMinePage?.(1);
            } else {
              window.DeckPostList?.applySortAndRerenderList?.(false, { useLatestSnapshot: false });
            }
          }
        }, 120);
      };

      window.addEventListener('resize', onChange, { passive: true });
      window.addEventListener('orientationchange', onChange, { passive: true });
    }
  }


  // =========================
  // 12) 画面切替ボタン配線
  // =========================
  /**
   * 一覧↔マイ投稿ボタン配線
   */
  function bindPageSwitchButtons_() {
    if (window.__deckPostPageSwitchBound) return;
    window.__deckPostPageSwitchBound = true;

    document.querySelectorAll('.mine-tab[data-mine-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const state = getDeckPostState_();
        const nextTab = btn.dataset.mineTab === 'liked' ? 'liked' : 'posts';
        if (state?.mine) state.mine.activeTab = nextTab;
        updateMineTabsUI_();
        await window.DeckPostList?.loadMinePage?.(1);
      });
    });

    document.getElementById('toMineBtn')?.addEventListener('click', async () => {
      stopSlowBackgroundListFetch_('裏読み停止中');
      setToMineButtonLoading_(true);

      try {
        updateMineLoginStatus();

        if (getMineActiveTab_() === 'posts') {
          try {
            await prefetchMineItems_();
          } catch (_) {}
        }

        window.DeckPostList?.showMine?.();
        await window.DeckPostList?.loadMinePage?.(1);
      } finally {
        setToMineButtonLoading_(false);
      }
    });

    document.getElementById('backToListBtn')?.addEventListener('click', async () => {
      window.DeckPostList?.showList?.();
    });
  }

  // =========================
  // 13) 公開API
  // =========================
  window.PAGE_LIMIT = PAGE_LIMIT;
  window.FETCH_LIMIT = FETCH_LIMIT;

  // 旧グローバル（互換のため一旦残す）
  window.updatePagerUI = updatePagerUI;
  //window.loadListPage = loadListPage;
  //window.loadMinePage = loadMinePage;
  //window.fetchAllList = fetchAllList;
  //window.applySortAndRerenderList = applySortAndRerenderList;
  window.prefetchMineItems_ = prefetchMineItems_;
  window.onDeckPostAuthChanged = handleAuthChangedForDeckPost;
  window.handleAuthChangedForDeckPost = handleAuthChangedForDeckPost;
  window.renderPostListInto = renderPostListInto;
  window.buildCardPc = buildCardPc;
  window.buildCardSp = buildCardSp;
  window.oneCard = oneCard;
  //window.showListStatusMessage = showListStatusMessage;
  window.updateMineCountUI_ = updateMineCountUI_;
  window.updateMineLoginStatus = updateMineLoginStatus;
  //window.showList = showList;
  //window.showMine = showMine;
  window.bindListPagerButtons_ = bindListPagerButtons_;
  window.bindPageSwitchButtons_ = bindPageSwitchButtons_;
  window.handleToggleLike = handleToggleLike;
  window.deletePost_ = deletePost_;
  window.findPostItemById = findPostItemById;
  window.bindPostListActionHandlers_ = bindPostListActionHandlers_;
  window.ensureListLoadProgressEl_ = ensureListLoadProgressEl_;
  window.updateListLoadProgress_ = updateListLoadProgress_;
  window.getListItemsForFilterBase_ = getListItemsForFilterBase_;
  window.startSlowBackgroundListFetch_ = startSlowBackgroundListFetch_;
  window.stopSlowBackgroundListFetch_ = stopSlowBackgroundListFetch_;
  window.prefetchListPage_ = prefetchListPage_;
  window.mergeListItemsDedup_ = mergeListItemsDedup_;
  window.applyFilterIncrementally_ = applyFilterIncrementally_;
  window.clearDeckPostListBrowserCache_ = () => clearBrowserListPageCache_(1);
  window.clearSharedPostView_ = clearSharedPostView_;

  // 新namespace
  window.DeckPostList = window.DeckPostList || {};
  window.DeckPostList.init = init;
  window.DeckPostList.updatePagerUI = updatePagerUI;
  window.DeckPostList.loadListPage = loadListPage;
  window.DeckPostList.handleAuthChanged = handleAuthChangedForDeckPost;
  window.DeckPostList.loadMinePage = loadMinePage;
  window.DeckPostList.fetchAllList = fetchAllList;
  window.DeckPostList.applySortAndRerenderList = applySortAndRerenderList;
  window.DeckPostList.ensureListLoadProgressEl = ensureListLoadProgressEl_;
  window.DeckPostList.updateListLoadProgress = updateListLoadProgress_;
  window.DeckPostList.getListItemsForFilterBase = getListItemsForFilterBase_;
  window.DeckPostList.startSlowBackgroundListFetch = startSlowBackgroundListFetch_;
  window.DeckPostList.stopSlowBackgroundListFetch = stopSlowBackgroundListFetch_;
  window.DeckPostList.prefetchListPage = prefetchListPage_;
  window.DeckPostList.mergeListItemsDedup = mergeListItemsDedup_;
  window.DeckPostList.applyFilterIncrementally = applyFilterIncrementally_;
  window.DeckPostList.clearBrowserCache = window.clearDeckPostListBrowserCache_;
  window.DeckPostList.clearSharedPostView = clearSharedPostView_;
  window.DeckPostList.showListStatusMessage = showListStatusMessage;
  window.DeckPostList.showList = showList;
  window.DeckPostList.showMine = showMine;

  // =========================
  // 14) 初期化
  // =========================
  window.bindListPagerButtons_?.();
  window.bindPostListActionHandlers_?.();
  window.bindPageSwitchButtons_?.();
})();
