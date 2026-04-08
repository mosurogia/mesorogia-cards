  /**
   * js/pages/deck-post/deck-post-state.js
   * - deck-post（一覧/マイ投稿）の「状態管理」だけを担当
   *
   * 【このファイルに置く】
   * - state（list / mine / token）
   * - initialized フラグ
   * - mine 先読みキャッシュ（TTL / fetchedAt / in-flight Promise）
   * - 外部から参照/更新するための getter / setter
   *
   * 【このファイルに置かない】
   * - DOM操作（render / addEventListener 等）
   * - API通信（fetch / apiList / resolveToken / PAGE_LIMIT 等）
   */
  (function () {
    'use strict';

    // =========================
    // 0) 定数
    // =========================
    const MINE_TTL_MS = 60 * 1000; // 1分（好みで調整）

    // =========================
    // 1) 状態本体（正本）
    // =========================
    const state = {
      list: {
        allItems: [],
        filteredItems: [],
        items: [],
        nextOffset: 0,
        loading: false,
        sortKey: 'new',
        currentPage: 1,
        totalPages: 1,
        total: 0,
        pageCache: {},
        hasAllItems: false,
      },
      mine: {
        items: [],
        loading: false,
        page: 1,
        pageSize: 10, // ★ 統合：postState.mine.pageSize をここへ
        totalPages: 1,
        total: 0, // ★ totalCount 相当はこれで統一
      },
      token: '',
    };

    // 互換：既存コードがここを見ている前提を崩さない
    window.__DeckPostState = state;

    // =========================
    // 2) 内部ステート（非公開）
    // =========================
    let initialized = false;

    let minePrefetchPromise = null;
    let mineFetchedAt = 0;

    // =========================
    // 3) 内部ユーティリティ
    // =========================
    function assertStateShape_() {
      // 差し替え等で壊れている場合は早めに気付けるようにする（freezeはしない）
      if (!state || typeof state !== 'object') throw new Error('DeckPostState: state is invalid');
      if (!state.list || typeof state.list !== 'object') throw new Error('DeckPostState: state.list is missing');
      if (!state.mine || typeof state.mine !== 'object') throw new Error('DeckPostState: state.mine is missing');
    }

    function hasValidMineCache_() {
      return Array.isArray(state.mine.items)
        && mineFetchedAt > 0
        && (Date.now() - mineFetchedAt < MINE_TTL_MS);
    }

    // =========================
    // 4) 公開API（state操作）
    // =========================
    function getState() {
      assertStateShape_();
      return state;
    }

    function isInitialized() {
      return !!initialized;
    }

    function markInitialized(v = true) {
      initialized = !!v;
      return initialized;
    }

    function getToken() {
      return String(state.token || '');
    }

    function setToken(token) {
      state.token = String(token || '');
      return state.token;
    }

    // list キャッシュ操作（将来：検索/フィルタ刷新で使う）
    function resetListCache() {
      state.list.pageCache = {};
      state.list.items = [];
      state.list.filteredItems = [];
      state.list.nextOffset = 0;
      state.list.hasAllItems = false;
      // allItems は「全件取得済み」の正本なので、ここでは消さない
    }

    // mine キャッシュ操作（API側が結果を流し込む用）
    function setMineItems(items, total) {
      state.mine.items = Array.isArray(items) ? items : [];

      // total の扱いを明確化：
      // - total 未指定(null/undefined)なら items.length を採用
      // - 指定ありなら Number 化して、有限ならそれを採用 / 不正なら items.length
      const t = (total == null) ? state.mine.items.length : Number(total);
      state.mine.total = Number.isFinite(t) ? t : state.mine.items.length;

      mineFetchedAt = Date.now();
      return state.mine.items;
    }

    function invalidateMineCache() {
      mineFetchedAt = 0;
      minePrefetchPromise = null;
    }

    function getMineCacheMeta() {
      return {
        ttlMs: MINE_TTL_MS,
        fetchedAt: mineFetchedAt,
        isFresh: hasValidMineCache_(),
        inFlight: !!minePrefetchPromise,
      };
    }

    function getMinePrefetchPromise() {
      return minePrefetchPromise;
    }

    function setMinePrefetchPromise(p) {
      minePrefetchPromise = p || null;
      return minePrefetchPromise;
    }

    // =========================
    // 公開API
    // =========================
    window.DeckPostState = {
      getState,

      isInitialized,
      markInitialized,

      getToken,
      setToken,

      // list
      resetListCache,

      // mine
      hasValidMineCache: hasValidMineCache_,
      setMineItems,
      invalidateMineCache,
      getMineCacheMeta,

      getMinePrefetchPromise,
      setMinePrefetchPromise,
    };
  })();