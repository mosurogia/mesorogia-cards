/* =========================
   DeckPosts 一覧ページ制御（新規）
   - 全体一覧（ページネーション）
   - マイ投稿（全画面・ログイン必須）
========================= */
const DeckPostApp = (() => {
  // 共通定義からベースURLを取得
  const GAS_BASE = window.DECKPOST_API_BASE || window.GAS_API_BASE;

  // 共通：innerHTML用エスケープ（common.js の escapeHtml_ を優先）
  function escapeHtml(s){
    const fn = window.escapeHtml_ || window.escapeHtml;
    if (typeof fn === 'function') return fn(s);

    // 最終フォールバック
    return String(s ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#39;");
  }

  const state = {
    list: {
      allItems: [],        // ★ 全投稿（一覧タブ用）
      filteredItems: [],   // ★ フィルタ・並び替え後の結果
      items: [],           // ★ 現在ページに表示している10件
      nextOffset: 0,
      loading: false,
      sortKey: 'new',
      currentPage: 1,
      totalPages: 1,
      total: 0,
      // ページ単位のキャッシュ（キー=ページ番号, 値=items配列）
      pageCache: {},
      // ★ 一覧データを全件取得済みかどうか
      hasAllItems: false,
    },
    // ★ マイ投稿用（ページング）
    mine: {
      items: [],
      loading: false,
      page: 1,
      totalPages: 1,
      total: 0,
    },
    token: '', // ログイン済みなら共通Authから拾う
  };

// ★ DeckPost の状態を、投稿フィルター用に外へ公開
window.__DeckPostState = state;

// ===== 投稿フィルター状態 =====
window.PostFilterState ??= {
  selectedTags: new Set(), // 既存（自動＋選択タグ）
  selectedUserTags: new Set(), // ★ 追加（ユーザー定義タグ）
  selectedPoster: '',   // ★ 追加（投稿者指定）
};

// ★ DeckPost 一覧の初期描画が完了したかどうか
let initialized = false;

// ===== マイ投稿用ステート =====
const postState = {
  mine: {
    page: 1,
    totalPages: 1,
    totalCount: 0,
    pageSize: 10,
    loading: false,
  }
};

// 共通：カードリスト描画（postList と同じ oneCard を流用）
function renderPostListInto(targetId, items, opts = {}){
  const box = document.getElementById(targetId);
  if (!box) return;

  box.replaceChildren();

  const frag = document.createDocumentFragment();
  (items || []).forEach(it => {
    const node = oneCard(it, opts);   // ★ opts を渡す
    if (node) frag.appendChild(node);
  });

  box.appendChild(frag);
}


// 投稿一覧用：「読み込み中 / エラー」メッセージ表示
function showListStatusMessage(type, text){
  const listEl = document.getElementById('postList');
  if (!listEl) return;

  const baseClass  = 'post-list-message';
  const errorClass = (type === 'error') ? ' post-list-message--error' : '';

  listEl.innerHTML = `<div class="${baseClass}${errorClass}">${text}</div>`;
}


// マイ投稿: ページャ表示更新
function updateMinePager(page, totalPages, totalCount){
  const info  = document.getElementById('minePageInfo');
  const prev  = document.getElementById('minePagePrev');
  const next  = document.getElementById('minePageNext');
  const count = document.getElementById('resultCountMine');

  if (info)  info.textContent = `${page} / ${Math.max(totalPages, 1)}`;
  if (count) count.textContent = totalCount
    ? `マイ投稿 ${totalCount}件`
    : 'マイ投稿 0件';

  if (prev){
    prev.disabled = (page <= 1);
  }
  if (next){
    next.disabled = (page >= totalPages);
  }
}

  // ===== マイ投稿読み込み（新API版） =====
  async function loadMinePage(page = 1) {
    const listEl    = document.getElementById('myPostList');
    const emptyEl   = document.getElementById('mine-empty');
    const errorEl   = document.getElementById('mine-error');
    const loadingEl = document.getElementById('mine-loading');

    if (!listEl) return;

    const limit  = PAGE_LIMIT;
    const offset = (page - 1) * limit;

    // ローディング表示
    state.mine.loading      = true;
    postState.mine.loading  = true;
    if (loadingEl) loadingEl.style.display = '';
    if (errorEl)   errorEl.style.display   = 'none';
    if (emptyEl)   emptyEl.style.display   = 'none';

    try {
      const res = await apiList({ limit, offset, mine: true });
      console.log('[mine] apiList result:', res);

      // 認証エラーだけは「ログインしてね」表示にする
      if (res && res.error === 'auth required') {
        console.log('[mine] auth required');

        // ★ ステートをクリア
        state.mine.items      = [];
        postState.mine.items  = [];
        state.mine.page       = 1;
        state.mine.totalPages = 1;
        state.mine.total      = 0;

        // ★ 画面上のリストもクリア
        if (listEl) listEl.replaceChildren();

        // ★ 右ペインもクリア
        const paneMine = document.getElementById('postDetailPaneMine');
        if (paneMine) {
          paneMine.innerHTML = `
            <div class="post-detail-empty">
              マイ投稿を表示するにはログインが必要です。
            </div>
          `;
        }

        // メッセージ表示
        if (emptyEl) emptyEl.style.display = 'none';
        if (errorEl) errorEl.style.display = '';

        const msgEl = document.getElementById('mine-error-msg');
        if (msgEl) msgEl.textContent = 'マイ投稿を表示するにはログインが必要です。';

        updateMinePager(0, 1, 0);
        updateMinePagerUI();
        return;
      }


      // （以下は元のまま）
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'list mine failed');
      }

      const items      = res.items || [];
      const total      = Number(res.total || items.length || 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      console.log('[mine] items length:', items.length, 'total:', total);

      state.mine.items      = items;
      state.mine.page       = page;
      state.mine.totalPages = totalPages;
      state.mine.total      = total;

      postState.mine.page       = page;
      postState.mine.totalCount = total;
      postState.mine.items      = items;
      postState.mine.loading    = false;

      renderPostListInto('myPostList', items, { mode: 'mine' });

      updateMinePager(page, totalPages, total);
      updateMinePagerUI();

      if (emptyEl) {
        emptyEl.style.display = items.length ? 'none' : '';
      }

      // ★ 右ペイン：件数に応じて初期状態に戻す
      const paneMine = document.getElementById('postDetailPaneMine');
      if (paneMine) {
        if (!items.length) {
          paneMine.innerHTML = `
            <div class="post-detail-empty">
              <div class="post-detail-empty-icon">👈</div>
              <div class="post-detail-empty-text">
                <div class="post-detail-empty-title">デッキ詳細パネル</div>
                <p class="post-detail-empty-main">
                  左の<span class="post-detail-empty-accent">マイ投稿カード</span>をクリックすると、<br>
                  ここにそのデッキの詳細が表示されます。
                </p>
              </div>
            </div>
          `;
        } else if (window.matchMedia('(min-width: 1024px)').matches) {
          const firstCard = document.querySelector('#myPostList .post-card');
          if (firstCard) {
            showDetailPaneForArticle(firstCard);
          }
        }
      }


    } catch (e) {
      console.error('loadMinePage error:', e);
      if (errorEl) {
        errorEl.style.display = '';
      }
    } finally {
      state.mine.loading     = false;
      postState.mine.loading = false;
      if (loadingEl) loadingEl.style.display = 'none';
    }


  }

// =========================
// マイ投稿：説明モーダル
// =========================
(function(){
  function openMineHelp(){
    const m = document.getElementById('mineHelpModal');
    if (m) m.style.display = 'flex';
  }
  function closeMineHelp(){
    const m = document.getElementById('mineHelpModal');
    if (m) m.style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('mineHelpBtn');
    const closeBtn = document.getElementById('mineHelpCloseBtn');
    const modal = document.getElementById('mineHelpModal');

    if (btn) btn.addEventListener('click', openMineHelp);
    if (closeBtn) closeBtn.addEventListener('click', closeMineHelp);

    // 背景クリックで閉じる
    if (modal){
      modal.addEventListener('click', (e)=>{
        if (e.target === modal) closeMineHelp();
      });
    }

    // Esc で閉じる
    document.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape') closeMineHelp();
    });
  });
})();


// =========================
// 投稿フィルター：モーダル（タグ整理版）
//  - デッキ情報 / 種族 / カテゴリ（テーマ）に分割表示
// =========================
(function(){
  function openPostFilter(){
    const m = document.getElementById('postFilterModal');
    if (m) m.style.display = 'flex';
  }
  function closePostFilter(){
    const m = document.getElementById('postFilterModal');
    if (m) m.style.display = 'none';
  }

  // 適用済み（＝一覧に効いている）状態
  window.PostFilterState ??= {
    selectedTags: new Set(),
    selectedUserTags: new Set(),
    selectedPoster: '',   // （投稿者指定）
  };

  // モーダル操作用（未適用の下書き）
  window.PostFilterDraft ??= {
    selectedTags: new Set(),
    selectedUserTags: new Set(),
    selectedPoster: '',   // （投稿者指定）
  };

  function syncDraftFromApplied_(){
    const applied = window.PostFilterState;
    const draft   = window.PostFilterDraft;
    draft.selectedTags = new Set(Array.from(applied?.selectedTags || []));
    draft.selectedUserTags = new Set(Array.from(applied?.selectedUserTags || []));
    draft.selectedPoster = String(applied?.selectedPoster || '');
  }

  function isCampaignTag_(t){
    try{
      const set = window.__campaignTagSet;
      if (!(set instanceof Set)) return false;
      return set.has(String(t||'').trim());
    }catch(_){
      return false;
    }
  }

  function allowCampaignTag_(t){
    const running = !!window.__isCampaignRunning;
    const active  = String(window.__activeCampaignTag || '').trim();
    if (!running || !active) return false;
    return String(t||'').trim() === active;
  }

  function getAllPostTagsFromState_(){
    const items = (window.__DeckPostState?.list?.allItems) || (window.__DeckPostState?.list?.filteredItems) || [];
    const set = new Set();

    (items || []).forEach(it => {
      const all = [it?.tagsAuto, it?.tagsPick].filter(Boolean).join(',');
      if (!all) return;

      all.split(',').map(s=>s.trim()).filter(Boolean).forEach(t=>{
        // ★ キャンペーンタグは「開催中の今回タグ」以外は候補に入れない
        if (isCampaignTag_(t) && !allowCampaignTag_(t)) return;
        set.add(t);
      });
    });

    // よく使う候補は常に出す（ただしキャンペーンは例外）
    (window.POST_TAG_CANDIDATES || []).forEach(t=>{
      if (isCampaignTag_(t) && !allowCampaignTag_(t)) return;
      set.add(t);
    });
    (window.RACE_ORDER || []).forEach(t=>set.add(t));
    (window.CATEGORY_LIST || []).forEach(t=>set.add(t));

    // キャンペーンタグ（開催中の今回分だけ）を候補に含める
    try{
      const active = String(window.__activeCampaignTag || '').trim();
      if (active && allowCampaignTag_(active)) set.add(active);
    }catch(_){}

    return Array.from(set);
  }

  function classifyTag_(t){
    const s = String(t||'').trim();
    if (!s) return 'other';

    // 種族
    if ((window.RACE_ORDER || []).includes(s)) return 'race';

    // カテゴリ（テーマ）
    const isCat = (typeof window.getCategoryOrder === 'function')
      ? (window.getCategoryOrder(s) < 9999)
      : ((window.CATEGORY_LIST || []).includes(s));
    if (isCat) return 'category';

    // それ以外はデッキ情報
    return 'deckinfo';
  }

  function sortTags_(tags, kind){
    const arr = (tags || []).map(s=>String(s||'').trim()).filter(Boolean);

    if (kind === 'race'){
      const order = window.RACE_ORDER || [];
      return arr.sort((a,b)=>order.indexOf(a) - order.indexOf(b));
    }
    if (kind === 'category'){
      if (typeof window.getCategoryOrder === 'function'){
        return arr.sort((a,b)=>window.getCategoryOrder(a)-window.getCategoryOrder(b));
      }
      const order = window.CATEGORY_LIST || [];
      return arr.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
    }

    // deckinfo: POST_TAG_CANDIDATES 優先 → 残りはあいうえお順
    const cand = window.POST_TAG_CANDIDATES || [];
    const candSet = new Set(cand);
    const head = cand.filter(t=>arr.includes(t));
    const tail = arr.filter(t=>!candSet.has(t)).sort((a,b)=>a.localeCompare(b,'ja'));

    // キャンペーンタグは最後へ寄せる
    const isCamp = (t)=>{
      const set = window.__campaignTagSet;
      return (set instanceof Set) && set.size && set.has(t);
    };
    const tailNormal = tail.filter(t=>!isCamp(t));
    const tailCamp   = tail.filter(t=> isCamp(t));

    // 重複除去しつつ結合
    const out = [];
    for (const t of [...head, ...tailNormal, ...tailCamp]){
      if (!out.includes(t)) out.push(t);
    }
    return out;
  }


  // ▼ モーダル内ボタン描画（draft を見る）
  function renderTagButtons_(rootEl, tags){
    if (!rootEl) return;
    rootEl.replaceChildren();

    const sel = window.PostFilterDraft?.selectedTags;
    (tags || []).forEach(tag => {
      const t = String(tag||'').trim();
      if (!t) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-btn post-filter-tag-btn';
      btn.dataset.tag = t;

      // キャンペーンタグは専用クラスを付与
      const ccls = campaignTagClass_(t);
      if (ccls) btn.classList.add(...ccls.split(/\s+/).filter(Boolean));

      // カテゴリ改行（（ の前で改行）
      if (classifyTag_(t) === 'category' && t.includes('（')) {
        btn.innerHTML = t.replace('（', '<br>（');
      } else {
        btn.textContent = t;
      }

      // 選択状態（CSSは .selected）
      if (sel?.has(t)) btn.classList.add('selected');

      btn.addEventListener('click', ()=>{
        const draft = window.PostFilterDraft;
        draft.selectedTags ??= new Set();

        if (draft.selectedTags.has(t)){
          draft.selectedTags.delete(t);
          btn.classList.remove('selected');
        }else{
          draft.selectedTags.add(t);
          btn.classList.add('selected');
        }
        // ★ チップ表示は apply のみ（ここでは更新しない）
      });

      rootEl.appendChild(btn);
    });
  }

  function buildPostFilterTagUI_(){
    const all = getAllPostTagsFromState_();
    const deckinfo = [];
    const race = [];
    const category = [];

    all.forEach(t => {
      // ★ キャンペーンタグ表示制御をフィルター候補にも適用
      if (!shouldShowTag_(t)) return;

      const k = classifyTag_(t);
      if (k === 'race') race.push(t);
      else if (k === 'category') category.push(t);
      else if (k === 'deckinfo') deckinfo.push(t);
    });

    // v2 期待：3エリア
    const deckEl = document.getElementById('postFilterDeckInfoArea');
    const raceEl = document.getElementById('postFilterRaceArea');
    const catEl  = document.getElementById('postFilterCategoryArea');

    renderTagButtons_(deckEl, sortTags_(deckinfo, 'deckinfo'));
    renderTagButtons_(raceEl, sortTags_(race, 'race'));
    renderTagButtons_(catEl,  sortTags_(category, 'category'));
  }

  // ▼ チップバー（適用済み state を見る）
  function updateActiveChipsBar_(){
  const bar = document.getElementById('active-chips-bar');
  const sc  = bar?.querySelector('.chips-scroll');
  if (!bar || !sc) return;

  const st = window.PostFilterState || {};
  const tags   = Array.from(st.selectedTags || []);
  const user   = Array.from(st.selectedUserTags || []);
  const poster = String(st.selectedPoster || '').trim();

  sc.replaceChildren();

  const total = tags.length + user.length + (poster ? 1 : 0);
  if (!total){
    bar.style.display = 'none';
    return;
  }
  bar.style.display = '';

    // チップ生成（CSSは .chip-mini）
  function addChip(label, onRemove, extraClass=''){
    const chip = document.createElement('span');
    chip.className = `chip-mini ${extraClass}`.trim();
    chip.textContent = label;

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    x.textContent = '×';
    x.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      onRemove?.();
    });

    chip.appendChild(x);
    sc.appendChild(chip);
  }

    // ① 投稿タグ
    tags.forEach((t)=>{
      addChip(`🏷️${t}`, ()=>{
        window.PostFilterState.selectedTags?.delete?.(t);
        window.PostFilterDraft?.selectedTags?.delete?.(t);

        // モーダル内の見た目も同期（開いてる時だけ）
        try{
          document
            .querySelectorAll(`.post-filter-tag-btn[data-tag="${CSS.escape(t)}"]`)
            .forEach(btn => btn.classList.remove('selected'));
        }catch(_){}

        window.updateActiveChipsBar_?.();
        window.DeckPostApp?.applySortAndRerenderList?.(true);
      }, 'chip-tag');
    });

    // ② ユーザータグ
    user.forEach((t)=>{
      addChip(`✍️${t}`, ()=>{
        window.PostFilterState.selectedUserTags?.delete?.(t);
        window.PostFilterDraft?.selectedUserTags?.delete?.(t);

        // モーダル側の青チップも同期（あれば）
        try{ window.renderSelectedUserTagChips?.(); }catch(_){}

        window.updateActiveChipsBar_?.();
        window.DeckPostApp?.applySortAndRerenderList?.(true);
      }, 'chip-user');
    });

    // ③ 投稿者
    if (poster){
      addChip(`投稿者:${poster}`, ()=>{
        window.PostFilterState.selectedPoster = '';
        window.updateActiveChipsBar_?.();
        window.DeckPostApp?.applySortAndRerenderList?.(true);
      }, 'is-poster');
    }

    // すべて解除（適用済みをクリア）
    const clr = document.createElement('span');
    clr.className = 'chip-mini chip-clear';
    clr.textContent = 'すべて解除';
    clr.addEventListener('click', ()=>{
      window.PostFilterState.selectedTags?.clear?.();
      window.PostFilterState.selectedUserTags?.clear?.();
      window.PostFilterState.selectedPoster = '';
      window.PostFilterDraft.selectedTags?.clear?.();
      window.PostFilterDraft.selectedUserTags?.clear?.();
      window.PostFilterDraft.selectedPoster = '';

      try{
        document.querySelectorAll('.post-filter-tag-btn.selected').forEach(b=>b.classList.remove('selected'));
      }catch(_){}

      try{ window.renderSelectedUserTagChips?.(); }catch(_){}

      window.updateActiveChipsBar_?.();
      window.DeckPostApp?.applySortAndRerenderList?.(true);
    });
    sc.appendChild(clr);
  }

  window.updateActiveChipsBar_ = updateActiveChipsBar_;

  // ▼ details の ▶/▼ 同期（summary の先頭記号を書き換える）
  function syncDetailsChevron_(details){
    if (!details) return;
    const summary = details.querySelector('summary');
    if (!summary) return;

    const raw = summary.textContent || '';
    const txt = raw.replace(/^[▶▼]\s*/,'').trim();
    summary.textContent = `${details.open ? '▼' : '▶'} ${txt}`;
  }

  function bindChevronSync_(root){
    const list = root?.querySelectorAll?.('details') || [];
    list.forEach(d=>{
      syncDetailsChevron_(d);
      d.addEventListener('toggle', ()=>syncDetailsChevron_(d));
    });
  }

  async function applyPostFilter_(){
    // 全件が無ければ先に取得 → タグUIも再構築
    if (!window.__DeckPostState?.list?.hasAllItems){
      try{ await fetchAllList(); }catch(_){ }
    }

    // draft → applied へ反映
    const draft = window.PostFilterDraft;
    const applied = window.PostFilterState;
    applied.selectedTags = new Set(Array.from(draft?.selectedTags || []));
    applied.selectedUserTags = new Set(Array.from(draft?.selectedUserTags || []));
    applied.selectedPoster = String(draft?.selectedPoster || '');

    closePostFilter();
    window.updateActiveChipsBar_?.();
    await applySortAndRerenderList(true);
  }

  function resetDraft_(){
    window.PostFilterDraft ??= { selectedTags:new Set(), selectedUserTags:new Set() };
    window.PostFilterDraft.selectedTags.clear();
    window.PostFilterDraft.selectedUserTags.clear();
    window.PostFilterDraft.selectedPoster = '';

    // タグボタンの selected を全部外す（モーダル内だけ）
    try{ document.querySelectorAll('.post-filter-tag-btn.selected').forEach(b=>b.classList.remove('selected')); }catch(_){ }

    // ユーザータグ UI のリセット（存在すれば）
    const q = document.getElementById('userTagQuery');
    if (q) q.value = '';
    try{
      const items = document.querySelector('[data-user-tag-selected-items]');
      const empty = document.querySelector('[data-user-tag-selected-empty]');
      if (items) items.replaceChildren();
      if (empty) empty.style.display = '';
    }catch(_){ }
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    const openBtn  = document.getElementById('filterBtn');
    const closeBtn = document.getElementById('postFilterCloseBtn');
    const applyBtn = document.getElementById('postFilterApplyBtn');
    const resetBtn = document.getElementById('postFilterResetBtn');
    const modal    = document.getElementById('postFilterModal');

    if (!modal) return;

    if (openBtn){
      openBtn.addEventListener('click', async ()=>{
        // 全件取得済みならそのまま。未取得ならモーダルを開く前に候補を作る
        if (!window.__DeckPostState?.list?.hasAllItems){
          try{ await fetchAllList(); }catch(_){ }
        }

        // ★ モーダルを開くたびに「適用済み → 下書き」を同期
        syncDraftFromApplied_();

        buildPostFilterTagUI_();

        // ★ フィルターを開く前に campaignTagSet を必ず初期化（遅延読み込み対策）
        if (!(window.__campaignTagSet instanceof Set)) {
          try {
            const res = await apiCampaignTags();
            const tags = (res && res.ok && Array.isArray(res.tags)) ? res.tags : [];
            window.__campaignTagSet = new Set(tags.map(t => String(t).trim()).filter(Boolean));
          } catch (e) {
            window.__campaignTagSet = new Set();
          }
          try { await renderCampaignBanner(); } catch (e) {}
        }

        // details の ▶/▼ 同期
        bindChevronSync_(modal);

        openPostFilter();
      });
    }

    if (closeBtn) closeBtn.addEventListener('click', closePostFilter);
    if (applyBtn) applyBtn.addEventListener('click', ()=>{ applyPostFilter_(); });
    if (resetBtn) resetBtn.addEventListener('click', ()=>{ resetDraft_(); });

    // ★ 画面外タップで閉じるのは禁止（何もしない）
    // ★ ESCで閉じるのも禁止（何もしない）
  });
})();;



  // ★ 1ページあたりの件数（UI表示用）
  const PAGE_LIMIT = 10;
  // ★ 一覧データをまとめて取得するときの1リクエスト上限
  const FETCH_LIMIT = 100;

  // ===== 認証トークン関連 =====
  function resolveToken(){
    // DeckPostAuth（正式）優先
    try{
      const raw = localStorage.getItem('DeckPostAuth');
      if (raw){
        const obj = JSON.parse(raw);
        if (obj.token) return obj.token;
      }
    }catch(_){}

    // 古い名前
    try{
      const raw = localStorage.getItem('AuthDeckPost');
      if (raw){
        const obj = JSON.parse(raw);
        if (obj.token) return obj.token;
      }
    }catch(_){}

    // 共通Auth も一応チェック
    try{
      const A = window.Auth;
      if (A?.token) return String(A.token);
    }catch(_){}

    return '';
  }



  // 現在のログインID（ユーザー名）を取得
  function getLoginUsername(){
    try{
      const A = window.Auth || {};
      if (A.user && A.user.username){
        return String(A.user.username);
      }
    }catch(_){}
    try{
      const n = localStorage.getItem('auth_username');
      if (n) return String(n);
    }catch(_){}
    return '';
  }

  // マイ投稿ヘッダーの「現在のログインID」を更新
  function updateMineLoginStatus(){
    const el = document.getElementById('mine-login-username');
    if (!el) return;
    const name = getLoginUsername();
    el.textContent = name || '未ログイン';
  }

  // ===== ログイン状態が変わったときに呼ばれるフック（Auth側から呼ぶ） =====
  function handleAuthChangedForDeckPost(){
    // まずログインID表示だけ更新
    updateMineLoginStatus();

    // ★ トークンを取り直す（Auth.token が変わっている可能性がある）
    state.token = resolveToken();

    // ★ init 完了後なら：
    //    一覧タブ(postList)も「自分のいいね」情報付きで取り直す
    if (initialized) {
      (async () => {
        try {
          await fetchAllList();       // token 付きでもう一度全件取得
          rebuildFilteredItems();     // 並び替えなど再計算
          const cur = state.list.currentPage || 1;
          loadListPage(cur);          // 現在ページを維持したまま再描画
        } catch (e) {
          console.error('handleAuthChangedForDeckPost: reload list failed', e);
        }
      })();
    }

    // 「マイ投稿」ページが表示中なら 1ページ目を読み直す（既存処理）
    const minePage    = document.getElementById('pageMine');
    const mineVisible = minePage && !minePage.hidden;

    if (mineVisible && !state.mine.loading){
      // ★ 未ログインなら auth required → 「ログインが必要です」表示になる
      loadMinePage(1);
    }
  }

  // グローバルに公開（common-page24.js から呼ぶ）
  window.onDeckPostAuthChanged = handleAuthChangedForDeckPost;


// =========================
// JSONP で GAS(doGet) を叩く小さなヘルパー
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
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      delete window[cbName];
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
      if (timer) clearTimeout(timer);
    };

    const timer = setTimeout(() => {
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


// ===== APIラッパ =====
async function apiList({ limit = PAGE_LIMIT, offset = 0, mine = false }) {
  const qs = new URLSearchParams();
  qs.set('mode', 'list');
  qs.set('limit', String(limit));
  qs.set('offset', String(offset));

  // マイ投稿フラグだけ付ける
  if (mine) {
    qs.set('mine', '1');
  }

  // ★ ログインしていれば常に token を付ける（一覧/マイ投稿 共通）
  const tk =
    (window.Auth && window.Auth.token) ||
    state.token ||
    resolveToken();

  if (tk) {
    qs.set('token', tk);
  }

  const url = `${GAS_BASE}?${qs.toString()}`;

  // 1) まずは通常の fetch(JSON) を試す
  try {
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });

    // ステータスコードだけおかしい場合もログに出してフォールバック
    if (!res.ok) {
      console.warn('apiList: fetch status not ok:', res.status, res.statusText);
    } else {
      const data = await res.json();

      // 期待している形式かざっくりチェック
      if (data && (Array.isArray(data.items) || data.ok !== undefined || data.error)) {
        return data;
      } else {
        console.warn('apiList: unexpected JSON format, fallback to JSONP', data);
      }
    }
  } catch (err) {
    console.warn('apiList: fetch failed, fallback to JSONP', err);
  }

  // 2) fetch が使えない / JSON で返っていないなどの場合は従来どおり JSONP で呼ぶ
  const resJsonp = await jsonpRequest(url);
  return resJsonp;
}

// ===== キャンペーンタグ一覧取得 =====
async function apiCampaignTags(){
  const qs = new URLSearchParams();
  qs.set('mode', 'campaignTags');

  const url = `${GAS_BASE}?${qs.toString()}`;

  // 1) fetch(JSON) を試す
  try {
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data && (Array.isArray(data.tags) || data.ok !== undefined || data.error)) {
        return data;
      }
    }
  } catch (err) {
    console.warn('apiCampaignTags: fetch failed, fallback to JSONP', err);
  }

  // 2) フォールバック（JSONP）
  return await jsonpRequest(url);
}



    // ===== 一覧全件をまとめて取得（list用） =====
  async function fetchAllList(){
    const limit = FETCH_LIMIT;
    let offset  = 0;
    let all     = [];
    let total   = 0;

    while (true){
      const res = await apiList({ limit, offset, mine: false });
      if (!res?.ok) break;

      const items = res.items || [];
      all.push(...items);

      if (typeof res.total === 'number'){
        total = res.total;
      }

      const nextOffset = (res.nextOffset ?? null);
      if (nextOffset === null || items.length === 0){
        break;
      }
      offset = nextOffset;
    }

    // 何も total が返ってこなかった場合は all.length を優先
    state.list.allItems = all;
    state.list.total    = total || all.length;
    // ★ 全件取得済みフラグとページキャッシュを更新
    state.list.hasAllItems = true;
    // すでに全件取得した場合はページキャッシュをクリアして再構築対象にする
    state.list.pageCache = {};
  }


  // ===== 投稿デッキメモ更新API =====
async function gasPost_(payload){
  const base = window.DECKPOST_API_BASE || window.GAS_API_BASE || '';
  if (!base) return { ok:false, error:'api base not set' };

  const mode = String(payload?.mode || 'post');   // ★ここ追加
  const url  = base + '?mode=' + encodeURIComponent(mode);

  try{
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload || {})
    });
    const json = await res.json().catch(()=>null);
    return json || { ok:false, error:'invalid response' };
  }catch(err){
    return { ok:false, error:'network' };
  }
}

// ===== 投稿デッキメモ更新API =====
async function updateDeckNote_(postId, deckNote){
  const token = (window.Auth && window.Auth.token) || '';
  if (!token) return { ok:false, error:'auth required' };

  return await gasPost_({
    mode: 'update',
    token,
    postId,
    deckNote: String(deckNote || '')
  });
}

// ===== 投稿カード解説更新API =====
async function updateCardNotes_(postId, cardNotes){
  const token = (window.Auth && window.Auth.token) || '';
  if (!token) return { ok:false, error:'auth required' };

  const list = Array.isArray(cardNotes) ? cardNotes : [];
  const payloadNotes = list
    .map(r=>{
      const cdRaw = String(r?.cd||'').trim();
      const cd = cdRaw ? cdRaw.padStart(5,'0') : ''; // ★ 未選択は空のまま
      const text = String(r?.text||'');
      return { cd, text };
    })
    // ★ 保存時：カード未選択の解説ブロックは除外（ブロックごと消す）
    .filter(r=>!!r.cd);

  return await gasPost_({
    mode: 'update',
    token,
    postId,
    cardNotes: payloadNotes
  });
}

// ===== 投稿デッキコード更新API =====
async function updateDeckCode_(postId, shareCode){
  const token = (window.Auth && window.Auth.token) || '';
  if (!token) return { ok:false, error:'auth required' };

  return await gasPost_({
    mode: 'update',
    token,
    postId: String(postId || '').trim(),
    shareCode: String(shareCode || '')
  });
}


// ===== 投稿削除API =====
async function deletePost_(postId){
  const token = (window.Auth && window.Auth.token) || '';
  if (!token) return { ok:false, error:'auth required' };

  return await gasPost_({
    mode: 'delete',
    token,
    postId: String(postId || '').trim()
  });
}

  // ===== いいね関連API =====
  /**
   * 指定の投稿IDについて「いいね」状態をトグルします。
   * @param {string} postId
   * @returns {Promise<{ok:boolean, liked?:boolean, likeCount?:number, error?:string}>}
   */
    // ★ いいね送信中フラグ（postIdごと）
  const likePending = {};
  async function apiToggleLike(postId){
    const token = (window.Auth && window.Auth.token) || state.token || resolveToken();
    console.log('[apiToggleLike] token =', token, 'postId =', postId);

    if (!token){
      return { ok:false, error:'auth required' };
    }
    try{
      const res = await fetch(`${GAS_BASE}?mode=toggleLike`, {
        method: 'POST',
        headers: { 'Content-Type':'text/plain;charset=UTF-8' },
        body: JSON.stringify({ token, postId })
      });
      const json = await res.json();
      console.log('[apiToggleLike] response =', json);
      return json;
    }catch(err){
      console.error('[apiToggleLike] network error', err);
      return { ok:false, error:'network' };
    }
  }


  /**
   * UI 用いいねトグルハンドラ。ボタンの表示更新と state の同期を行います。
   * 楽観的更新：
   *   - 押した瞬間に active/カウントを変更
   *   - その裏で API 送信
   *   - 送信中にもう一度押されたらメッセージ表示
   * @param {string} postId
   * @param {HTMLElement} btn
   */
  async function handleToggleLike(postId, btn){
    if (!postId) return;
    if (!btn) return;

    // すでにこの投稿IDで送信中なら連打禁止
    if (likePending[postId]) {
      alert('反映中です、しばらくしてからまたお試しください。');
      return;
    }

    // 現在の状態を state から取得（なければ DOM からでもOK）
    const item = findPostItemById(postId) || {};
    const prevLiked = !!item.liked;
    const prevCount = Number(item.likeCount || 0);

    // 楽観的に次の状態を決める
    const optimisticLiked = !prevLiked;
    const optimisticCount = prevLiked
      ? Math.max(0, prevCount - 1)
      : prevCount + 1;

    // state & DOM をまとめて更新する小さなヘルパー
    const applyLikeState = (liked, likeCount) => {
      const selector = `.post-card[data-postid="${postId}"] .fav-btn`;
      document.querySelectorAll(selector).forEach(el => {
        el.classList.toggle('active', liked);
        el.textContent = `${liked ? '★' : '☆'}${likeCount}`;
      });

      const updateList = (list) => {
        if (Array.isArray(list)){
          list.forEach((it) => {
            if (String(it.postId) === String(postId)){
              it.liked     = liked;
              it.likeCount = likeCount;
            }
          });
        }
      };
      updateList(state.list.allItems);
      updateList(state.list.items);
      updateList(state.list.filteredItems);
      updateList(state.mine.items);
    };

    // ★ ここで楽観的に反映
    applyLikeState(optimisticLiked, optimisticCount);

    // フラグON & ボタン一時無効化
    likePending[postId] = true;
    btn.disabled = true;

    try{
      const res = await apiToggleLike(postId);

      if (!res || !res.ok){
        // 失敗したので元に戻す
        applyLikeState(prevLiked, prevCount);

        const isAuthError = res && res.error === 'auth required';
        const msg = isAuthError
          ? 'いいねするにはログインが必要です。\nマイ投稿タブから新規登録またはログインしてください。'
          : `いいねに失敗しました。\n（エラー: ${res && res.error || 'unknown'}）`;
        alert(msg);
        return;
      }

      // サーバー側の最終状態で上書き（大体は楽観的状態と同じはず）
      const liked     = !!res.liked;
      const likeCount = Number(res.likeCount || 0);
      applyLikeState(liked, likeCount);

    } finally {
      // 送信完了（成功/失敗問わず）
      likePending[postId] = false;
      btn.disabled = false;
    }
  }



  // ===== 画面遷移（一覧↔マイ投稿） =====
  function showList(){
    const listPage = document.getElementById('post-app');  // 一覧側 main
    const minePage = document.getElementById('pageMine');  // マイ投稿側 main
    if (listPage) listPage.hidden = false;
    if (minePage) minePage.hidden = true;

    // 見た目も戻しておくと親切
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // マイ投稿ページ表示
  function showMine(){
    const listPage = document.getElementById('post-app');
    const minePage = document.getElementById('pageMine');
    if (minePage) minePage.hidden = false;
    if (listPage) listPage.hidden = true;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ===== レンダリング =====
  function el(html){
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }


  // メイン種族 → 背景色
  const RACE_BG_MAP = {
    'ドラゴン':     'rgba(255, 100, 100, 0.16)',
    'アンドロイド': 'rgba(100, 200, 255, 0.16)',
    'エレメンタル': 'rgba(100, 255, 150, 0.16)',
    'ルミナス':     'rgba(255, 250, 150, 0.16)',
    'シェイド':     'rgba(200, 150, 255, 0.16)',
  };

  // 種族文字列からメイン種族を取得
  function getMainRace(races){
    const s = String(races || '');
    if (!s) return '';
    return s.split(/[,+]/)[0].trim();  // 「シェイド,イノセント…」などを想定
  }

  // 種族に応じた背景色を取得
  function raceBg(races){
    const main = getMainRace(races);
    return RACE_BG_MAP[main] || '';
  }

  // 自動タグ＋選択タグ（上段・ピンク系）
  function tagChipsMain(tagsAuto, tagsPick){
    const s = [tagsAuto, tagsPick].filter(Boolean).join(',');
    if (!s) return '';
    return s.split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .filter(shouldShowTag_) // ★ 追加
      .map(x => `<span class="chip">${escapeHtml(x)}</span>`)
      .join('');
  }

  // ユーザータグ（下段・青系）
  function tagChipsUser(tagsUser){
    const s = String(tagsUser || '');
    if (!s) return '';
    return s.split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .filter(shouldShowTag_) // ★ 追加
      .map(x => `<span class="chip">${escapeHtml(x)}</span>`)
      .join('');
  }


  // ===== キャンペーンタグ表示制御 =====
function shouldShowTag_(tag){
  const t = String(tag || '').trim();
  return !!t; // 空だけ弾く（キャンペーンでも非表示にしない）
}

// キャンペーンタグの表示/非表示を一括更新
function refreshCampaignTagChips_(){
  const set = window.__campaignTagSet;
  if (!(set instanceof Set) || !set.size) return;

  const isCamp = (t)=> set.has(String(t || '').trim());

  // ① 投稿カード内のタグ順を「通常 → キャンペーン」の順に揃える
  //    （初期描画時に __campaignTagSet が未ロードだと並び替えが効かないため、ここで矯正）
  document.querySelectorAll('.post-tags').forEach(box => {
    // 直下の .chip だけ対象（入れ子対策）
    const chips = Array.from(box.querySelectorAll(':scope > .chip'));
    if (chips.length < 2) return;

    const normal = [];
    const camp   = [];
    for (const ch of chips){
      const t = (ch.textContent || '').trim();
      (isCamp(t) ? camp : normal).push(ch);
    }
    if (!camp.length) return;

    box.replaceChildren(...normal, ...camp);
  });

  // ② 投稿一覧/マイ投稿：キャンペーンタグの状態クラスを付け直す
  const roots = [
    document.getElementById('postList'),
    document.getElementById('myPostList'),
  ].filter(Boolean);

  for (const root of roots){
    const chips = root.querySelectorAll('.chip');
    chips.forEach(el => {
      const t = (el.textContent || '').trim();
      if (!t) return;
      if (!set.has(t)) return;

      el.classList.remove('is-campaign','is-campaign-active','is-campaign-ended');
      const cls = campaignTagClass_(t);
      if (cls) el.classList.add(...cls.split(/\s+/).filter(Boolean));
    });
  }

  // ③ フィルターボタン側も状態クラスを付け直す
  document.querySelectorAll('.post-filter-tag-btn').forEach(btn => {
    const t = (btn.textContent || '').trim();
    if (!t) return;
    if (!set.has(t)) return;

    btn.classList.remove('is-campaign','is-campaign-active','is-campaign-ended');
    const cls = campaignTagClass_(t);
    if (cls) btn.classList.add(...cls.split(/\s+/).filter(Boolean));
  });
}


// ===== キャンペーンタグ：状態クラス =====
function campaignTagClass_(tag){
  const t = String(tag || '').trim();
  if (!t) return '';

  const set = window.__campaignTagSet;
  const isCampaign = (set instanceof Set) && set.size && set.has(t);
  if (!isCampaign) return '';

  const activeTag = String(window.__activeCampaignTag || '').trim();
  const isRunning = !!window.__isCampaignRunning;

  // 開催中かつ今回タグなら active、それ以外は ended 扱い
  if (isRunning && activeTag && t === activeTag) return 'is-campaign is-campaign-active';
  return 'is-campaign is-campaign-ended';
}

// 自動タグ＋選択タグ（上段）
function tagChipsMain(tagsAuto, tagsPick){
  const s = [tagsAuto, tagsPick].filter(Boolean).join(',');
  if (!s) return '';

  const set = window.__campaignTagSet;
  const isCamp = (t)=> (set instanceof Set) && set.size && set.has(t);

  const arr = s.split(',')
    .map(x => x.trim())
    .filter(Boolean);

  // ✅ キャンペーンタグを末尾に寄せる（相対順は維持）
  const normal = arr.filter(t => !isCamp(t));
  const camp   = arr.filter(t =>  isCamp(t));
  const ordered = [...normal, ...camp];

  return ordered
    .map(x => `<span class="chip ${campaignTagClass_(x)}">${escapeHtml(x)}</span>`)
    .join('');
}

// ユーザータグ（下段）
function tagChipsUser(tagsUser){
  const s = String(tagsUser || '');
  if (!s) return '';

  const set = window.__campaignTagSet;
  const isCamp = (t)=> (set instanceof Set) && set.size && set.has(t);

  const arr = s.split(',')
    .map(x => x.trim())
    .filter(Boolean);

  const normal = arr.filter(t => !isCamp(t));
  const camp   = arr.filter(t =>  isCamp(t));
  const ordered = [...normal, ...camp];

  return ordered
    .map(x => `<span class="chip ${campaignTagClass_(x)}">${escapeHtml(x)}</span>`)
    .join('');
}


  // ===== サムネイル画像 =====
  function cardThumb(src, title){
    const safe = src ? src : 'img/noimage.webp';
    const alt  = title ? escapeHtml(title) : '';
    return `<div class="thumb-box"><img loading="lazy" src="${safe}" alt="${alt}"></div>`;
  }


// ===== デッキ情報の共通ヘルパー =====

// item から { cd: count } 形式のデッキマップを作る
function extractDeckMap(item){
  let deck = null;

  // 1) item.cards（配列）があれば優先
  if (Array.isArray(item.cards) && item.cards.length){
    deck = {};
    for (const c of item.cards){
      const cd = String(c.cd || '').trim();
      if (!cd) continue;
      const n = Number(c.count || 0) || 0;
      if (n <= 0) continue;
      deck[cd] = (deck[cd] || 0) + n;
    }
  }
  // 2) cards が「オブジェクト {cd: count}」のケース
  else if (item.cards && typeof item.cards === 'object'){
    deck = {};
    for (const [cd, nRaw] of Object.entries(item.cards)){
      const key = String(cd || '').trim();
      if (!key) continue;
      const n = Number(nRaw || 0) || 0;
      if (n <= 0) continue;
      deck[key] = (deck[key] || 0) + n;
    }
  }
  // 3) なければ cardsJSON（{cd:count} 文字列）を使う
  else if (item.cardsJSON){
    try{
      const obj = JSON.parse(item.cardsJSON);
      if (obj && typeof obj === 'object'){
        deck = {};
        for (const [cd, nRaw] of Object.entries(obj)){
          const key = String(cd || '').trim();
          if (!key) continue;
          const n = Number(nRaw || 0) || 0;
          if (n <= 0) continue;
          deck[key] = (deck[key] || 0) + n;
        }
      }
    }catch(_){}
  }
  // ---- cdキーを必ず5桁に正規化（repCd照合ズレ防止）----
  if (deck && typeof deck === 'object') {
    const norm = {};
    for (const [cd, n] of Object.entries(deck)) {
      const cd5 = String(cd || '').trim().padStart(5, '0');
      const cnt = Number(n || 0) || 0;
      if (!cd5 || cnt <= 0) continue;
      norm[cd5] = (norm[cd5] || 0) + cnt;
    }
    deck = norm;
  }

  return deck;
}

// 旧神カード（cd が 9xxxx）のカード名を取得する
function getOldGodNameFromItem(item){
  const deck = extractDeckMap(item);
  if (!deck || !Object.keys(deck).length) return '';

  const cardMap = window.cardMap || {};

  // 仕様：デッキには旧神1枚 or 0枚
  for (const cd of Object.keys(deck)){
    const cd5 = String(cd).padStart(5, '0');
    if (cd5[0] === '9'){
      const card = cardMap[cd5] || {};
      return card.name || '';
    }
  }

  return '';
}

// ===== コスト／パワー分布グラフ（デッキメーカーと同じ方式） =====
// paneId -> { cost: Chart, power: Chart }
window.__postDistCharts ??= {};

function renderPostDistCharts_(item, paneId){
  // Chart.js が無いなら何もしない
  if (!window.Chart) return;

  // plugin（無ければ握りつぶし）
  try { Chart.register(window.ChartDataLabels); } catch (_){}

  const deck = extractDeckMap(item);
  const cardMap = window.cardMap || {};
  if (!deck || !Object.keys(deck).length) return;

  // deckCards（最大40枚なので展開でOK）
  const deckCards = [];
  for (const [cd, n] of Object.entries(deck)){
    const c = cardMap[String(cd).padStart(5,'0')] || {};
    const cost  = Number(c.cost);
    const power = Number(c.power);
    const type  = String(c.type || '');
    const cnt   = Number(n || 0) || 0;
    for (let i=0; i<cnt; i++){
      deckCards.push({
        cost:  Number.isFinite(cost)  ? cost  : NaN,
        power: Number.isFinite(power) ? power : NaN,
        type,
      });
    }
  }

  // 目盛り（固定表示）
  const alwaysShowCosts  = [2, 4, 6, 8, 10, 12];
  const alwaysShowPowers = [0, 4, 5, 6, 7, 8, 12, 16];

  const costCount = {};
  const powerCount = {};
  deckCards.forEach(c => {
    if (!Number.isNaN(c.cost))  costCount[c.cost]  = (costCount[c.cost]  || 0) + 1;
    if (!Number.isNaN(c.power)) powerCount[c.power] = (powerCount[c.power] || 0) + 1;
  });

  const costLabels = [...new Set([...alwaysShowCosts, ...Object.keys(costCount).map(Number)])].sort((a,b)=>a-b);
  const powerLabels = [...new Set([...alwaysShowPowers, ...Object.keys(powerCount).map(Number)])].sort((a,b)=>a-b);

    // ===== サマリー（チップ） =====
  const sumCost = deckCards.reduce((s, c) => s + (Number.isFinite(c.cost) ? c.cost : 0), 0);
  const costSumEl = document.getElementById(`cost-summary-${paneId}`);
  if (costSumEl) {
    costSumEl.innerHTML = `<span class="stat-chip">総コスト ${sumCost}</span>`;
  }

  const powerSums = { 'チャージャー':0, 'アタッカー':0 };
  deckCards.forEach(c => {
    const p = Number.isFinite(c.power) ? c.power : 0;
    if (c.type in powerSums) powerSums[c.type] += p;
  });
  const powerSumEl = document.getElementById(`power-summary-${paneId}`);
  if (powerSumEl) {
    powerSumEl.innerHTML = `
      <span class="type-chip" data-type="チャージャー">チャージャー ${powerSums['チャージャー']}</span>
      <span class="type-chip" data-type="アタッカー">アタッカー ${powerSums['アタッカー']}</span>
    `;
  }


  const TYPES = ['チャージャー', 'アタッカー', 'ブロッカー'];
  const COLORS = {
    'チャージャー': 'rgba(119, 170, 212, 0.7)',
    'アタッカー':   'rgba(125, 91, 155, 0.7)',
    'ブロッカー':   'rgba(214, 212, 204, 0.7)',
  };

  function buildStackCounts(cards, key, labels) {
    const table = {};
    TYPES.forEach(t => { table[t] = Object.fromEntries(labels.map(l => [l, 0])); });
    cards.forEach(c => {
      const v = Number(c[key]);
      const t = c.type;
      if (!Number.isNaN(v) && table[t] && (v in table[t])) table[t][v]++;
    });
    return TYPES.map(t => ({
      label: t,
      data: labels.map(l => table[t][l] || 0),
      backgroundColor: COLORS[t],
      borderWidth: 0,
      barPercentage: 0.9,
      categoryPercentage: 0.9,
    }));
  }

  const costDatasets  = buildStackCounts(deckCards, 'cost',  costLabels);
  const powerDatasets = buildStackCounts(deckCards, 'power', powerLabels);

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { stacked: true, grid: { display: false, drawBorder: false }, ticks: { autoSkip: false } },
      y: { stacked: true, beginAtZero: true, grid: { display: false, drawBorder: false }, ticks: { display: false } }
    },
    plugins: {
      legend: { display: false },
      datalabels: {
        display: true,
        anchor: 'center',
        align: 'center',
        formatter: v => v > 0 ? v : '',
        font: { weight: 600 },
        clamp: true
      },
      tooltip: { enabled: true },
    },
  };

  // 既存インスタンス破棄（paneごと）
  const prev = window.__postDistCharts[paneId];
  if (prev?.cost)  try{ prev.cost.destroy(); } catch(_){}
  if (prev?.power) try{ prev.power.destroy(); } catch(_){}

  const costCanvas  = document.getElementById(`costChart-${paneId}`);
  const powerCanvas = document.getElementById(`powerChart-${paneId}`);
  if (!costCanvas || !powerCanvas) return;

  const costChart  = new Chart(costCanvas.getContext('2d'),  { type:'bar', data:{ labels:costLabels,  datasets:costDatasets  }, options:commonOptions });
  const powerChart = new Chart(powerCanvas.getContext('2d'), { type:'bar', data:{ labels:powerLabels, datasets:powerDatasets }, options:commonOptions });

  window.__postDistCharts[paneId] = { cost: costChart, power: powerChart };
}


// ===== 詳細用：デッキリスト（5列固定） =====
function buildDeckListHtml(item){
  console.log('buildDeckListHtml:', item.postId, item.cardsJSON);

  const deck = extractDeckMap(item);

  if (!deck || !Object.keys(deck).length){
    return `<div class="post-decklist post-decklist-empty">デッキリスト未登録</div>`;
  }

  const entries = Object.entries(deck);
  const cardMap = window.cardMap || {};
  const TYPE_ORDER = { 'チャージャー':0, 'アタッカー':1, 'ブロッカー':2 };

  // page24 の並び方をざっくり踏襲
  entries.sort((a, b) => {
    const A = cardMap[a[0]] || {};
    const B = cardMap[b[0]] || {};
    const tA = TYPE_ORDER[A.type] ?? 99;
    const tB = TYPE_ORDER[B.type] ?? 99;
    if (tA !== tB) return tA - tB;

    const cA = parseInt(A.cost)  || 0;
    const cB = parseInt(B.cost)  || 0;
    if (cA !== cB) return cA - cB;

    const pA = parseInt(A.power) || 0;
    const pB = parseInt(B.power) || 0;
    if (pA !== pB) return pA - pB;

    return String(a[0]).localeCompare(String(b[0]));
  });

// タイル形式で並べる
const tiles = entries.map(([cd, n]) => {
  const cd5  = String(cd).padStart(5, '0');
  const card = cardMap[cd5] || {};
  const name = card.name || cd5;
  const src  = `img/${cd5}.webp`;
  return `
    <div class="deck-entry" data-cd="${cd5}" role="button" tabindex="0">
      <img src="${src}" alt="${escapeHtml(name)}" loading="lazy">
      <div class="count-badge">x${n}</div>
    </div>
  `;
}).join('');


  return `<div class="post-decklist">${tiles}</div>`;
}

// =========================
// デッキリスト：カード詳細（PC=ドック表示 / SP=下からドロワー）
// =========================

// carddetail用：HTMLエスケープ（共通があればそれを使う）
const escHtml_ = (s) => {
  const fn = window.escapeHtml_ || window.escapeHtml; // 他ページの共通を優先
  if (typeof fn === 'function') return fn(s);
  // 最終フォールバック
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
};


// テキストの改行を <br> に
function nl2br_(s){
  return String(s || '').replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
}



// レアリティキー（legend/gold/silver/bronze）に正規化
function rarityKeyForPage4_(rarity){
  const r = String(rarity || '').trim();

  // cards_latest.json の値（日本語）に合わせる
  if (r === 'レジェンド') return 'legend';
  if (r === 'ゴールド')   return 'gold';
  if (r === 'シルバー')   return 'silver';
  if (r === 'ブロンズ')   return 'bronze';

  // 保険（英語が来ても死なない）
  const low = r.toLowerCase();
  if (low.includes('legend')) return 'legend';
  if (low.includes('gold'))   return 'gold';
  if (low.includes('silver')) return 'silver';
  if (low.includes('bronze')) return 'bronze';

  return '';
}

// pill用クラス（page4専用）
function rarityPillClassForPage4_(rarity){
  const k = rarityKeyForPage4_(rarity);
  return k ? `carddetail-rarity--${k}` : '';
}

// 表示ラベル（基本はJSONの日本語をそのまま表示）
function rarityLabelForPage4_(rarity){
  const r = String(rarity || '').trim();
  if (!r) return '';
  return r; // "レジェンド" 等
}


// カード詳細HTML（画像あり）
function buildCardDetailHtml_(cd5){
  const cardMap = window.cardMap || {};
  const c = cardMap[String(cd5 || '').padStart(5,'0')] || {};

  const name = c.name || cd5;

  const packRaw = c.packName || '';
  const pack = packRaw
    ? (window.splitPackName ? window.splitPackName(packRaw) : { en: String(packRaw), jp: '' })
    : null;

  const cat = c.category || '';
  const img = `img/${String(cd5).padStart(5,'0')}.webp`;

  // ★ 追加：レアリティpill
  const rarityLabel = rarityLabelForPage4_(c.rarity);
  const rarityCls   = rarityPillClassForPage4_(c.rarity);

  const e1n = c.effect_name1 || '';
  const e1t = c.effect_text1 || '';
  const e2n = c.effect_name2 || '';
  const e2t = c.effect_text2 || '';

  const effectBlocks = `
    ${e1n || e1t ? `
      <div class="carddetail-effect">
        ${e1n ? `<div class="carddetail-effect-name">${escHtml_(e1n)}</div>` : ''}
        ${e1t ? `<div class="carddetail-effect-text">${nl2br_(escHtml_(e1t))}</div>` : ''}
      </div>
    ` : ''}
    ${e2n || e2t ? `
      <div class="carddetail-effect">
        ${e2n ? `<div class="carddetail-effect-name">${escHtml_(e2n)}</div>` : ''}
        ${e2t ? `<div class="carddetail-effect-text">${nl2br_(escHtml_(e2t))}</div>` : ''}
      </div>
    ` : ''}
    ${(!e1n && !e1t && !e2n && !e2t) ? `
      <div class="carddetail-empty">カードテキストが未登録です。</div>
    ` : ''}
  `;

  return `
    <div class="carddetail-head">
      <div class="carddetail-thumb">
        <img src="${img}" alt="${escHtml_(name)}" loading="lazy"
             onerror="this.onerror=null;this.src='img/00000.webp';">
      </div>

      <div class="carddetail-meta">
        <div class="carddetail-name">${escHtml_(name)}</div>

        <div class="carddetail-sub">
          ${pack ? `
            <div class="carddetail-pack">
              ${pack.en ? `<div class="carddetail-pack-en">${escHtml_(pack.en)}</div>` : ''}
              ${pack.jp ? `<div class="carddetail-pack-jp">${escHtml_(pack.jp)}</div>` : ''}
            </div>
          ` : ''}

          <div class="carddetail-cat+rarity">
          ${cat ? `<span class="carddetail-cat">${escHtml_(cat)}</span>` : ''}

          ${rarityLabel ? `
            <span class="carddetail-rarity ${rarityCls}">
              ${escHtml_(rarityLabel)}
            </span>
          ` : ''}
          </div>
        </div>
      </div>

      <button type="button" class="carddetail-close" aria-label="閉じる">×</button>
    </div>

    <div class="carddetail-body">
      ${effectBlocks}
    </div>
  `;
}

// PC用：右ペイン内に「ドック（小さめ詳細枠）」を確保して返す
function ensureCardDetailDockPc_(root){
  if (!root) return null;

  let dock = root.querySelector('.carddetail-dock');
  if (dock) return dock;

  const deckcol = root.querySelector('.post-detail-deckcol');
  if (!deckcol) return null;

  const sec = document.createElement('div');
  sec.className = 'post-detail-section carddetail-dock';
  sec.innerHTML = `
    <div class="post-detail-heading">カード詳細</div>
    <div class="carddetail-inner">
      <div class="carddetail-empty">デッキリストのカードをタップすると表示されます。</div>
    </div>
  `;

  // ★最優先：デッキコード（コピーボタン）の直下に入れる
  const codeBody = deckcol.querySelector('.post-detail-code-body');
  if (codeBody){
    codeBody.insertAdjacentElement('afterend', sec);
    return sec;
  }

  // 次点：デッキリストセクションの直下
  const decklistEl  = deckcol.querySelector('.post-decklist');
  const decklistSec = decklistEl?.closest('.post-detail-section');
  if (decklistSec){
    decklistSec.insertAdjacentElement('afterend', sec);
    return sec;
  }

  // 保険：末尾
  deckcol.appendChild(sec);
  return sec;
}


// SP用：画面下ドロワーを1つだけ生成
function ensureCardDetailDrawerSp_(){
  let drawer = document.getElementById('cardDetailDrawer');
  if (drawer) return drawer;

  drawer = document.createElement('div');
  drawer.id = 'cardDetailDrawer';
  drawer.style.display = 'none';
  drawer.innerHTML = `
    <div class="carddetail-drawer-inner">
      <div class="carddetail-inner"></div>
    </div>
  `;
  document.body.appendChild(drawer);

  // 外側タップで閉じる（中は閉じない）
  drawer.addEventListener('click', (e)=>{
    if (e.target === drawer) {
      drawer.style.display = 'none';
    }
  });

  return drawer;
}

// 実際に表示（PC/SP切替）
function openCardDetailFromDeck_(cd5, clickedEl){
  const cd = String(cd5 || '').padStart(5,'0');
  if (!cd) return;

  const html = buildCardDetailHtml_(cd);

  const isPcWide = window.matchMedia('(min-width: 1024px)').matches;

  if (isPcWide){
    // 右ペインの「今開いている投稿」を探す
    const root = clickedEl?.closest?.('.post-detail-inner') || document.querySelector('.post-detail-inner');
    const dock = ensureCardDetailDockPc_(root);
    const inner = dock?.querySelector?.('.carddetail-inner');
    if (inner) inner.innerHTML = html;

    // close
    dock?.querySelector?.('.carddetail-close')?.addEventListener('click', ()=>{
      if (inner) inner.innerHTML = `<div class="carddetail-empty">デッキリストのカードをタップすると表示されます。</div>`;
    }, { once:true });

    return;
  }

  // SP：下からドロワー（背景操作は“完全ブロック”しない/見た目は軽い）
  const drawer = ensureCardDetailDrawerSp_();
  const inner  = drawer.querySelector('.carddetail-inner');
  if (inner) inner.innerHTML = html;

  drawer.style.display = 'block';

  // ×で閉じる
  inner?.querySelector?.('.carddetail-close')?.addEventListener('click', ()=>{
    drawer.style.display = 'none';
  }, { once:true });
}


// =============================
// 簡易デッキ統計（タイプ構成だけ）
// =============================
function buildSimpleDeckStats(item) {
  // DeckPosts シートに保存している typeMixJSON をまず優先して使う
  // 形式: [Chg枚数, Atk枚数, Blk枚数]
  const raw = item.typeMixJSON || item.typeMixJson || '';

  // 1) typeMixJSON に有効な値があればそのまま使う
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length >= 3) {
        const chg = Number(arr[0] || 0);
        const atk = Number(arr[1] || 0);
        const blk = Number(arr[2] || 0);
        const totalType = chg + atk + blk;
        if (totalType > 0) {
          const typeText = `チャージャー ${chg}枚 / アタッカー ${atk}枚 / ブロッカー ${blk}枚`;
          return { typeText, chg, atk, blk, totalType };
        }
      }
    } catch (e) {
      console.warn('typeMixJSON parse error:', e, raw);
    }
  }

  // 2) typeMixJSON が無い / 全部0のときは、デッキ内容から再計算する
  const deck = extractDeckMap(item);
  const cardMap = window.cardMap || {};
  if (!deck || !Object.keys(deck).length || !cardMap) return null;

  let chg = 0, atk = 0, blk = 0;

  for (const [cd, nRaw] of Object.entries(deck)) {
    const n = Number(nRaw || 0) || 0;
    if (!n) continue;

    const cd5 = String(cd).padStart(5, '0');
    const t = (cardMap[cd5] || {}).type;
    if (t === 'チャージャー') {
      chg += n;
    } else if (t === 'アタッカー') {
      atk += n;
    } else if (t === 'ブロッカー') {
      blk += n;
    }
  }

  const totalType = chg + atk + blk;
  if (!totalType) return null;

  const typeText = `チャージャー ${chg}枚 / アタッカー ${atk}枚 / ブロッカー ${blk}枚`;
  return { typeText, chg, atk, blk, totalType };
}

// =============================
// 簡易デッキ統計（レアリティ構成）
// =============================
function buildRarityMixText_(item){
  const deck = extractDeckMap(item);
  const cardMap = window.cardMap || {};
  if (!deck || !Object.keys(deck).length || !cardMap) return '';

  let legend = 0, gold = 0, silver = 0, bronze = 0, unknown = 0;

  for (const [cd, nRaw] of Object.entries(deck)) {
    const n = Number(nRaw || 0) || 0;
    if (!n) continue;

    const cd5 = String(cd).padStart(5, '0');
    const r = String((cardMap[cd5] || {}).rarity || '').trim();

    if (r === 'レジェンド') legend += n;
    else if (r === 'ゴールド') gold += n;
    else if (r === 'シルバー') silver += n;
    else if (r === 'ブロンズ') bronze += n;
    else unknown += n;
  }

  const total = legend + gold + silver + bronze + unknown;
  if (!total) return '';

  const parts = [
    `レジェンド ${legend}枚`,
    `ゴールド ${gold}枚`,
    `シルバー ${silver}枚`,
    `ブロンズ ${bronze}枚`,
  ];
  if (unknown) parts.push(`不明 ${unknown}枚`);

  return parts.join(' / ');
}

function buildRarityStats(item){
  return { rarityText: buildRarityMixText_(item) || '' };
}

// =============================
// チップHTML（タイプ構成）
// =============================
function buildTypeChipsHtml_(simpleStats){
  if (!simpleStats) return '';
  const rows = [
    ['チャージャー', simpleStats.chg],
    ['アタッカー',   simpleStats.atk],
    ['ブロッカー',   simpleStats.blk],
  ].filter(([,n]) => (Number(n || 0) || 0) > 0);

  if (!rows.length) return '';
  return rows.map(([t,n]) =>
    `<span class="type-chip" data-type="${escapeHtml(t)}">${escapeHtml(t)} ${Number(n)}枚</span>`
  ).join('');
}

// =============================
// チップ用（レアリティ構成：数える）
// =============================
function buildRarityMixCounts_(item){
  const deck = extractDeckMap(item);
  const cardMap = window.cardMap || {};
  if (!deck || !Object.keys(deck).length || !cardMap) return null;

  let legend = 0, gold = 0, silver = 0, bronze = 0, unknown = 0;

  for (const [cd, nRaw] of Object.entries(deck)) {
    const n = Number(nRaw || 0) || 0;
    if (!n) continue;

    const cd5 = String(cd).padStart(5, '0');
    const r = String((cardMap[cd5] || {}).rarity || '').trim();

    if (r === 'レジェンド') legend += n;
    else if (r === 'ゴールド') gold += n;
    else if (r === 'シルバー') silver += n;
    else if (r === 'ブロンズ') bronze += n;
    else unknown += n;
  }

  const total = legend + gold + silver + bronze + unknown;
  if (!total) return null;
  return { legend, gold, silver, bronze, unknown, total };
}

function buildRarityChipsHtml_(item){
  const c = buildRarityMixCounts_(item);
  if (!c) return '';

  const out = [];
  if (c.legend) out.push(`<span class="stat-chip carddetail-rarity carddetail-rarity--legend">レジェンド ${c.legend}枚</span>`);
  if (c.gold)   out.push(`<span class="stat-chip carddetail-rarity carddetail-rarity--gold">ゴールド ${c.gold}枚</span>`);
  if (c.silver) out.push(`<span class="stat-chip carddetail-rarity carddetail-rarity--silver">シルバー ${c.silver}枚</span>`);
  if (c.bronze) out.push(`<span class="stat-chip carddetail-rarity carddetail-rarity--bronze">ブロンズ ${c.bronze}枚</span>`);
  if (c.unknown) out.push(`<span class="stat-chip">不明 ${c.unknown}枚</span>`);

  return out.join('');
}

// =============================
// チップ用（パック略称）
// =============================
function packAbbr_(enName){
  const s = String(enName || '').trim();
  const low = s.toLowerCase();

  // 表記ゆれ吸収（Awaking/Awakening, Slience/Silence）
  if (low.includes('awakening the oracle') || low.includes('awaking the oracle')) return 'Aパック';
  if (low.includes('beyond the sanctuary')) return 'Bパック';
  if (low.includes('creeping souls')) return 'Cパック';
  if (low.includes('drawn sword')) return 'Dパック';
  if (low.includes('ensemble of silence') || low.includes('ensemble of slience')) return 'Eパック';

  // packs.json の「コラボカード」などが enName 側に来る可能性もあるので保険
  if (s.includes('コラボ') || low.includes('collab')) return 'コラボ';
  if (s.includes('その他特殊') || low.includes('special')) return '特殊';
  if (s.includes('その他')) return 'その他';

  // 不明はそのまま（ひとまず）
  return s;
}

function buildPackMixCounts_(item){
  const deck = extractDeckMap(item);
  const cardMap = window.cardMap || {};
  if (!deck || !Object.keys(deck).length || !cardMap) return null;

  const counts = Object.create(null);
  let unknown = 0;

  for (const [cd, nRaw] of Object.entries(deck)) {
    const n = Number(nRaw || 0) || 0;
    if (!n) continue;

    const cd5 = String(cd).padStart(5, '0');
    const packName = (cardMap[cd5] || {}).pack_name || (cardMap[cd5] || {}).packName || '';
    const en = packNameEn_(packName);

    if (en) counts[en] = (counts[en] || 0) + n;
    else unknown += n;
  }

  const keys = Object.keys(counts);
  if (!keys.length && !unknown) return null;

  const order = getPackOrder_();
  keys.sort((a,b)=>{
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1){
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return a.localeCompare(b);
  });

  return { keys, counts, unknown };
}

function buildPackChipsHtml_(item){
  const d = buildPackMixCounts_(item);
  if (!d) return '';

  const out = [];
  for (const k of d.keys){
    const n = Number(d.counts[k] || 0) || 0;
    if (!n) continue;
    const abbr = packAbbr_(k);
    out.push(`<span class="stat-chip">${escapeHtml(abbr)} ${n}枚</span>`);
  }
  if (d.unknown){
    out.push(`<span class="stat-chip">不明 ${Number(d.unknown)}枚</span>`);
  }
  return out.join('');
}


// =============================
// 簡易デッキ統計（パック構成） ※表示は一旦 EN 名
// =============================
// pack_name 例: "BASIC SET「基本セット」" → "BASIC SET"
function packNameEn_(packName){
  const s = String(packName || '').trim();
  if (!s) return '';
  // 「」があれば手前をEN名として使う
  const idx = s.indexOf('「');
  if (idx > 0) return s.slice(0, idx).trim();
  return s;
}

// packs.json がどこかでロードされていれば order を使う（無ければ空配列）
function getPackOrder_(){
  const p = window.packsData || window.packs || window.__packs || null;
  const order = p && Array.isArray(p.order) ? p.order : [];
  return order.map(x => String(x||'').trim()).filter(Boolean);
}

function buildPackMixText_(item){
  const deck = extractDeckMap(item);
  const cardMap = window.cardMap || {};
  if (!deck || !Object.keys(deck).length || !cardMap) return '';

  const counts = Object.create(null);
  let unknown = 0;

  for (const [cd, nRaw] of Object.entries(deck)) {
    const n = Number(nRaw || 0) || 0;
    if (!n) continue;

    const cd5 = String(cd).padStart(5, '0');
    const packName = (cardMap[cd5] || {}).pack_name || (cardMap[cd5] || {}).packName || '';
    const en = packNameEn_(packName);

    if (en) counts[en] = (counts[en] || 0) + n;
    else unknown += n;
  }

  const keys = Object.keys(counts);
  if (!keys.length && !unknown) return '';

  // packs.json の順序があればそれを優先し、残りは名前順
  const order = getPackOrder_();
  keys.sort((a,b)=>{
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1){
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return a.localeCompare(b);
  });

  const parts = keys.map(k => `${k} ${counts[k]}枚`);
  if (unknown) parts.push(`UNKNOWN ${unknown}枚`);

  return parts.join(' / ');
}

function buildPackStats(item){
  return { packText: buildPackMixText_(item) || '' };
}

// =========================


// ===== 詳細用：カード解説（cardNotes） =====
function buildCardNotesHtml(item){
  const srcList = Array.isArray(item.cardNotes) ? item.cardNotes : [];
  const list = srcList
    .map(r => ({ cd: String(r.cd || ''), text: String(r.text || '') }))
    .filter(r => r.cd || r.text);

  if (!list.length){
    return `<div class="post-cardnotes-empty">投稿者によるカード解説はまだ登録されていません。</div>`;
  }

  const cardMap = window.cardMap || {};

  const rows = list.map(r => {
    const cdRaw = String(r.cd || '').trim();
    const cd5   = cdRaw.padStart(5, '0');   // ★ 必須：5桁化
    const card  = cardMap[cd5] || {};
    const name  = card.name || 'カード名未登録';
    const img   = `img/${cd5}.webp`;

    const textHtml = escapeHtml(r.text || '').replace(/\n/g, '<br>');

    return `
      <div class="post-cardnote">
        <div class="post-cardnote-thumb">
          <img src="${img}"
               alt="${escapeHtml(name)}"
               loading="lazy"
               onerror="this.onerror=null;this.src='img/00000.webp';">
        </div>
        <div class="post-cardnote-body">
          <div class="post-cardnote-title">${escapeHtml(name)}</div>
          <div class="post-cardnote-text">${textHtml}</div>
        </div>
      </div>
    `;
  }).join('');

  return `<div class="post-cardnotes">${rows}</div>`;
}


// =========================
// カード解説：編集UI（deckmaker互換）
// =========================
let __cardNotesEditorBound = false;
let __cardNotesPickContext = null; // { rootEl, rowEl, item }

function ensureCardNoteSelectModal_(){
  if (document.getElementById('cardNoteSelectModal')) return;

  // deck-post.html に無い場合でも動くようにJS生成
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.id = 'cardNoteSelectModal';
  wrap.style.display = 'none';
  wrap.innerHTML = `
    <div class="modal-content cardnote-modal">
      <h3 class="filter-maintitle">カードを選択</h3>
      <div id="cardNoteCandidates" class="cardnote-grid"></div>
      <div class="modal-footer" style="gap:.5rem;">
        <button type="button" id="cardNoteClose" class="modal-buttun">閉じる</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
}

function openCardNoteSelectModal_(candidates){
  ensureCardNoteSelectModal_();
  const modal = document.getElementById('cardNoteSelectModal');
  const grid  = document.getElementById('cardNoteCandidates');
  const close = document.getElementById('cardNoteClose');
  if (!modal || !grid) return;

  grid.replaceChildren();

  // ===== 既にカード解説で選ばれているカードは disabled にする =====
  // ※ 同じ行の再選択はできるように、現在行の cd は除外する
  const used = new Set();
  const currentCd = String(__cardNotesPickContext?.rowEl?.dataset?.cd || '').trim().padStart(5,'0');

  try{
    const rootEl = __cardNotesPickContext?.rootEl;
    if (rootEl){
      rootEl.querySelectorAll('.post-card-note').forEach(row=>{
        const cd = String(row.dataset.cd || '').trim().padStart(5,'0');
        if (cd) used.add(cd);
      });
    }
  }catch(_){}

  if (currentCd) used.delete(currentCd);

  // candidates: [{cd5,name,count}] を想定
  (candidates || []).forEach(c=>{
    const cd5 = String(c?.cd5 || '').trim().padStart(5,'0');
    if (!cd5) return;

    const cell = document.createElement('div');
    cell.className = 'item';
    cell.dataset.cd = cd5;

    if (used.has(cd5)) cell.classList.add('disabled');

    const img = document.createElement('img');
    img.src = `img/${cd5}.webp`;
    img.alt = c?.name || '';
    img.loading = 'lazy';
    img.onerror = ()=>{ img.onerror=null; img.src='img/00000.webp'; };
    cell.appendChild(img);

    // ★ 枚数バッジは不要（表示しない）

    grid.appendChild(cell);
  });

  modal.style.display = 'flex';

  const onClose = ()=>{
    modal.style.display = 'none';
    close?.removeEventListener('click', onClose);
  };
  close?.addEventListener('click', onClose);

  // 背景クリックで閉じる
  modal.addEventListener('click', (e)=>{
    if (e.target === modal) onClose();
  }, { once:true });
}

function readCardNotesFromEditor_(root){
  const rows = Array.from(root.querySelectorAll('.post-card-note'));
  return rows.map(row=>{
    const cd = String(row.dataset.cd || '').trim();
    const ta = row.querySelector('textarea.note');
    const text = ta ? String(ta.value || '') : '';
    return { cd, text };
  });
}

function syncCardNotesHidden_(root){
  const hidden = root.querySelector('#post-card-notes-hidden');
  if (!hidden) return;
  hidden.value = JSON.stringify(readCardNotesFromEditor_(root));
}

function makeCardNoteRow_(r){
  const cdRaw = String(r?.cd || '').trim();
  const cd5 = cdRaw ? cdRaw.padStart(5,'0') : '';
  const cardMap = window.cardMap || {};
  const name = cd5 ? ((cardMap[cd5]||{}).name || 'カード名未登録') : 'カードを選択';
  const img  = cd5 ? `img/${cd5}.webp` : 'img/00000.webp';

  const div = document.createElement('div');
  div.className = 'post-card-note';
  div.dataset.index = '0';
  div.dataset.cd = cd5;

  div.innerHTML = `
    <div class="left">
      <div class="thumb">
        <img alt="" src="${img}" onerror="this.onerror=null;this.src='img/00000.webp'">
      </div>
      <div class="actions">
        <button type="button" class="note-move" data-dir="-1">↑</button>
        <button type="button" class="note-move" data-dir="1">↓</button>
        <button type="button" class="note-remove">削除</button>
      </div>
    </div>
    <button type="button" class="pick-btn">${escapeHtml(name)}</button>
    <textarea class="note" placeholder="このカードの採用理由・使い方など"></textarea>
  `;

  const ta = div.querySelector('textarea.note');
  if (ta) ta.value = String(r?.text || '');

  return div;
}

function renumberCardNoteRows_(root){
  Array.from(root.querySelectorAll('.post-card-note')).forEach((row, i)=>{
    row.dataset.index = String(i);
  });
}

function renderCardNotesRows_(root, list){
  const box = root.querySelector('#post-card-notes');
  if (!box) return;
  box.replaceChildren();
  (list || []).forEach(r=> box.appendChild(makeCardNoteRow_(r)));
  renumberCardNoteRows_(root);
  syncCardNotesHidden_(root);
}

function getDeckCandidatesFromItem_(item){
  const cardMap = window.cardMap || {};
  let deck = item?.deck || item?.cardsJSON || item?.cards || null;

  // cardsJSON が文字列で来るケース（DeckPostsの列保存）に対応
  if (typeof deck === 'string'){
    const raw = deck.trim();
    if (raw){
      try { deck = JSON.parse(raw); } catch(_){ /* noop */ }
    }
  }

  let cds = [];
  if (deck && typeof deck === 'object' && !Array.isArray(deck)){
    cds = Object.keys(deck);
  } else if (Array.isArray(deck)){
    cds = deck.map(x=>String(x?.cd || x || ''));
  }

  const uniq = Array.from(new Set(
    cds.map(x=>String(x||'').trim().padStart(5,'0')).filter(Boolean)
  ));

  return uniq.map(cd5=>({ cd5, name: (cardMap[cd5]||{}).name || 'カード名未登録' }));
}

function validateCardNotes_(root){
  const validator = root.querySelector('#post-cardnote-validator');
  if (!validator) return true;
  validator.setCustomValidity('');

  const list = readCardNotesFromEditor_(root);
  const bad = list.find(r => r.cd && !String(r.text||'').trim());
  if (bad){
    validator.setCustomValidity('カード解説：カードを選んだ行は、解説も入力してください。');
    validator.reportValidity();
    return false;
  }
  return true;
}

// ★ 右ペインに挿入された editor を初期化（1回だけ）
function initCardNotesEditor_(editorRoot, item){
  if (!editorRoot) return;

  const initial = Array.isArray(item?.cardNotes) ? item.cardNotes : [];

  // 既にバインド済みでも、表示内容は都度最新に寄せる（SPでの再編集に必要）
  if (editorRoot.__bound){
    renderCardNotesRows_(editorRoot, initial);
    return;
  }
  editorRoot.__bound = true;

  renderCardNotesRows_(editorRoot, initial);

  editorRoot.addEventListener('click', (e)=>{
    const t = e.target;

    // 追加
    if (t && t.id === 'add-card-note'){
      const box = editorRoot.querySelector('#post-card-notes');
      if (!box) return;
      const row = makeCardNoteRow_({ cd:'', text:'' });
      box.appendChild(row);
      renumberCardNoteRows_(editorRoot);
      syncCardNotesHidden_(editorRoot);
      row.querySelector('.pick-btn')?.click();
      return;
    }

    // 削除
    if (t && t.classList.contains('note-remove')){
      const row = t.closest('.post-card-note');
      row?.remove();
      renumberCardNoteRows_(editorRoot);
      syncCardNotesHidden_(editorRoot);
      return;
    }

    // 移動
    if (t && t.classList.contains('note-move')){
      const dir = Number(t.dataset.dir || 0);
      const row = t.closest('.post-card-note');
      const box = editorRoot.querySelector('#post-card-notes');
      if (!row || !box || !dir) return;

      if (dir < 0){
        const prev = row.previousElementSibling;
        if (prev) box.insertBefore(row, prev);
      } else {
        const next = row.nextElementSibling;
        if (next) box.insertBefore(next, row);
      }
      renumberCardNoteRows_(editorRoot);
      syncCardNotesHidden_(editorRoot);
      return;
    }

    // カード選択
    if (t && t.classList.contains('pick-btn')){
      const row = t.closest('.post-card-note');
      if (!row) return;

      __cardNotesPickContext = { rootEl: editorRoot, rowEl: row, item };
      openCardNoteSelectModal_(getDeckCandidatesFromItem_(item));
      return;
    }
  });

  editorRoot.addEventListener('input', (e)=>{
    if (e.target && e.target.matches('textarea.note')){
      syncCardNotesHidden_(editorRoot);
    }
  });
}

// モーダル選択（グローバル委任）
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.btn-filter-poster');
  if (!btn) return;

    // 先に止める（これが重要）
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const posterName = String(btn.dataset.poster || '').trim();
  if (!posterName) return;

  window.PostFilterState.selectedPoster = posterName;
  // モーダル下書きも合わせておくと一貫する
  window.PostFilterDraft.selectedPoster = posterName;

  window.updateActiveChipsBar_?.();
  window.DeckPostApp?.applySortAndRerenderList?.(true);


  const cell = e.target?.closest?.('#cardNoteCandidates .item');
  if (!cell || !__cardNotesPickContext) return;
  if (cell.classList.contains('disabled')) return;

  const cd5 = String(cell.dataset.cd || '').trim().padStart(5,'0');
  const cardMap = window.cardMap || {};
  const name = (cardMap[cd5]||{}).name || 'カード名未登録';

  const { rootEl, rowEl } = __cardNotesPickContext;

  rowEl.dataset.cd = cd5;
  rowEl.querySelector('.pick-btn')?.replaceChildren(document.createTextNode(name));
  const img = rowEl.querySelector('.thumb img');
  if (img) img.src = `img/${cd5}.webp`;

  syncCardNotesHidden_(rootEl);

  const modal = document.getElementById('cardNoteSelectModal');
  if (modal) modal.style.display = 'none';
  __cardNotesPickContext = null;
}, true);



// ===== 1枚カードレンダリング（PC用） =====
function buildCardPc(item, opts = {}){
  const isMine   = (opts.mode === 'mine');
  const bg       = raceBg(item.races);

  const tagsMain = tagChipsMain(item.tagsAuto, item.tagsPick);
  const tagsUser = tagChipsUser(item.tagsUser);

  const posterXRaw   = (item.posterX || '').trim();
  const posterXLabel = posterXRaw;
  const posterXUser  = posterXRaw.startsWith('@') ? posterXRaw.slice(1) : posterXRaw;

  // ===== いいね関連 =====
  const likeCount = Number(item.likeCount || 0);
  const liked     = !!item.liked;
  const favClass  = liked ? ' active' : '';
  const favSymbol = liked ? '★' : '☆';
  const favText   = `${favSymbol}${likeCount}`;

  const headRightBtnHtml = isMine
    ? `<button class="delete-btn" type="button" data-postid="${escapeHtml(item.postId || '')}" aria-label="投稿を削除">🗑</button>`
    : `<button class="fav-btn ${favClass}" type="button" aria-label="お気に入り">${favText}</button>`;

  return el(`
    <article class="post-card post-card--pc" data-postid="${escapeHtml(item.postId || '')}" style="${bg ? `--race-bg:${bg};` : ''}">

      <!-- 上段：代表カード + 情報（SPと同じ構造） -->
      <div class="sp-head">
        <div class="pc-head-left">
          ${cardThumb(item.repImg, item.title)}
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
              ${fmtPostDates_(item)}
            </div>
          </div>

          ${headRightBtnHtml}

          <!-- アクション（比較のみ） -->
          <div class="post-actions pc-actions">
            <button type="button" class="btn-add-compare">比較に追加</button>
          </div>
        </div>
      </div>

      <!-- タグ（ヘッダーの下にまとめて） -->
      <div class="post-tags-wrap">
        <div class="post-tags post-tags-main">${tagsMain}</div>
        <div class="post-tags post-tags-user">${tagsUser}</div>
      </div>

    </article>
  `);
}



// ===== 1枚カードレンダリング（スマホ用） =====
function buildCardSp(item, opts = {}){
  const isMine = (opts.mode === 'mine');
  const time     = item.updatedAt || item.createdAt || '';
  const mainRace = getMainRace(item.races);
  const bg       = raceBg(item.races);
  const oldGod   = getOldGodNameFromItem(item) || '';// 旧神名
  const deckNote = item.deckNote || item.comment || '';
  const deckNoteHtml = buildDeckNoteHtml(deckNote);
  const simpleStats = buildSimpleDeckStats(item);// タイプ構成情報
  const typeMixText = simpleStats?.typeText || '';// タイプ構成テキスト
  const rarityStats = buildRarityStats(item); // レアリティ構成情報
  const rarityMixText = rarityStats?.rarityText || ''; // レアリティ構成テキスト
  const packMixText   = buildPackMixText_(item);   // パック構成テキスト（EN）
  const typeChipsHtml   = buildTypeChipsHtml_(simpleStats);
  const rarityChipsHtml = buildRarityChipsHtml_(item);
  const packChipsHtml   = buildPackChipsHtml_(item);


  const tagsMain = tagChipsMain(item.tagsAuto, item.tagsPick);
  const tagsUser = tagChipsUser(item.tagsUser);
  const deckList = buildDeckListHtml(item);
  const cardNotesHtml = buildCardNotesHtml(item);

  const posterXRaw   = (item.posterX || '').trim();
  const posterXLabel = posterXRaw;
  const posterXUser  = posterXRaw.startsWith('@') ? posterXRaw.slice(1) : posterXRaw;

// ===== いいね関連（今のまま残してOK：一覧側で使う） =====
  const likeCount = Number(item.likeCount || 0);
  const liked     = !!item.liked;
  const favClass  = liked ? ' active' : '';
  const favSymbol = liked ? '★' : '☆';
  const favText   = `${favSymbol}${likeCount}`;

  const headRightBtnHtml = isMine
    ? `<button class="delete-btn" type="button" data-postid="${escapeHtml(item.postId || '')}" aria-label="投稿を削除">🗑</button>`
    : `<button class="fav-btn ${favClass}" type="button" aria-label="お気に入り">${favText}</button>`;

    // デッキコード（スマホ）
    const codeNorm = String(item.shareCode || '').trim();

    // 1) マイ投稿は「管理UI」を表示（未登録でも出す）
    const codeManageHtml = isMine
      ? buildDeckCodeBoxHtml_(item.postId || '', codeNorm)
      : '';

    // 2) 既存の「デッキコードをコピー」導線（登録済みの時だけ）
    const codeCopyBtnHtml = codeNorm ? `
          <div class="post-detail-code-body">
            <button type="button"
              class="btn-copy-code-wide"
              data-code="${escapeHtml(codeNorm)}">
              デッキコードをコピー
            </button>
          </div>
    ` : '';

const codeBtnHtml = `${codeManageHtml}${codeCopyBtnHtml}`;


  // カード解説：閲覧時は「ある時だけ表示」／マイ投稿は編集できるよう常に表示
  const hasCardNotes =
    Array.isArray(item.cardNotes) &&
    item.cardNotes.some(r => r && (r.cd || r.text));

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

          <!-- 表示モード -->
          <div class="cardnotes-view">
            ${cardNotesHtml}
          </div>

          ${isMine ? `
            <!-- 編集モード -->
            <div class="cardnotes-editor" hidden
                 data-original='${escapeHtml(JSON.stringify(item.cardNotes || []))}'>
              <div class="info-value" style="width:100%">
                <div id="post-card-notes"></div>
                <input type="hidden" id="post-card-notes-hidden" value="${escapeHtml(JSON.stringify(item.cardNotes || []))}">

                <input type="text" id="post-cardnote-validator" aria-hidden="true" tabindex="-1"
                  style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;border:none;padding:0;margin:0;">

                <div class="add-note-box">
                  <button type="button" id="add-card-note" class="add-note-btn">カード解説を追加</button>
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

  return el(`
    <article class="post-card post-card--sp" data-postid="${item.postId}" style="${bg ? `--race-bg:${bg};` : ''}">

      <!-- 上段：代表カード + 情報 -->
      <div class="sp-head">
        <div class="sp-head-left">
          ${cardThumb(item.repImg, item.title)}
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
              ${fmtPostDates_(item)}
            </div>
          </div>

          ${headRightBtnHtml}
        </div>
      </div>

      <!-- タグ（ヘッダーの下にまとめて） -->
      <div class="post-tags-wrap">
        <div class="post-tags post-tags-main">${tagsMain}</div>
        <div class="post-tags post-tags-user">${tagsUser}</div>
      </div>

      <!-- アクション -->
      <div class="post-actions sp-actions">
        <button type="button" class="btn-detail">詳細</button>
        <button type="button" class="btn-add-compare">比較に追加</button>
      </div>

      <!-- 詳細（折りたたみ） -->
      <div class="post-detail" hidden>
        ${isMine ? `<div class="post-detail-inner" data-postid="${escapeHtml(item.postId || '')}">` : ''}

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
            ? `<dt>タイプ構成</dt><dd><div class="post-detail-chips">${typeChipsHtml}</div></dd>`
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
        </dl>


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

            <!-- 表示モード -->
            <div class="decknote-view">
              ${deckNoteHtml || '<div style="color:#777;font-size:.9rem;">まだ登録されていません。</div>'}
            </div>

            ${isMine ? `
              <!-- 編集モード -->
              <div class="decknote-editor" hidden>
                <div class="note-toolbar">
                  <div class="note-presets-grid">
                    <button type="button" class="note-preset-btn" data-preset="deck-overview">デッキ概要</button>
                    <button type="button" class="note-preset-btn" data-preset="play-guide">プレイ方針</button>
                    <button type="button" class="note-preset-btn" data-preset="matchup">対面考察</button>
                    <button type="button" class="note-preset-btn" data-preset="results">実績レポート</button>
                  </div>
                </div>

                <div class="decknote-editor-hint">
                  ※上のプリセットボタンを押すと定型文が挿入されます。
                </div>

                <textarea class="decknote-textarea" rows="14"
                  data-original="${escapeHtml(deckNote || '')}"
                >${escapeHtml(deckNote || '')}</textarea>

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

        ${isMine ? `</div>` : ''}
      </div>

    </article>
  `);
}



// ===== 1枚カードレンダリング（PC/SP切り替え） =====
function oneCard(item, opts = {}){
  const isSp = window.matchMedia('(max-width: 1023px)').matches;
  return isSp ? buildCardSp(item, opts) : buildCardPc(item, opts);
}

  // 一覧レンダリング
  function renderList(items, targetId){
    const wrap = document.getElementById(targetId);
    if (!wrap) return;
    const frag = document.createDocumentFragment();
    for (const it of items) frag.appendChild(oneCard(it));
    wrap.appendChild(frag);
  }

// ===== デッキ解説用HTML生成 =====
  function buildDeckNoteHtml(deckNote){
    const raw = String(deckNote || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return '';

    const lines = raw.split('\n');
    const sections = [];
    let current = null;

    for (const line of lines){
      const m = line.match(/^【(.+?)】/); // 行頭の【見出し】を検出
      if (m){
        if (current) sections.push(current);
        current = { title: m[1].trim(), body: [] };
      } else {
        if (!current) current = { title: '', body: [] }; // 見出し前のフリーテキスト
        current.body.push(line);
      }
    }
    if (current) sections.push(current);

    // 見出しが1つもない場合は、全体を1つの decknote-block として囲む
    const hasTitled = sections.some(s => s.title);
    if (!hasTitled){
      const bodyHtml = escapeHtml(raw).replace(/\n/g, '<br>');
      return `
        <div class="post-decknote">
          <section class="decknote-block">
            <div class="decknote-body">${bodyHtml}</div>
          </section>
        </div>
      `;
    }


    const blocks = sections.map(sec => {
      const bodyText = sec.body.join('\n').trim();
      const bodyHtml = escapeHtml(bodyText).replace(/\n/g, '<br>');
      const titleHtml = sec.title
        ? `<div class="decknote-heading">${escapeHtml(sec.title)}</div>`
        : '';
      return `
        <section class="decknote-block">
          ${titleHtml}
          <div class="decknote-body">${bodyHtml}</div>
        </section>
      `;
    }).join('');

    return `<div class="post-decknote">${blocks}</div>`;
  }

  // ===== 右ペイン：詳細パネル描画（タブ構造＋右側に常時デッキリスト） =====
  function renderDetailPaneForItem(item, paneId){
    const pane = document.getElementById(paneId || 'postDetailPane');
    if (!pane || !item) return;

    const isMinePane = (paneId === 'postDetailPaneMine');

    const time       = item.updatedAt || item.createdAt || '';
    const mainRace   = getMainRace(item.races);
    const oldGod     = getOldGodNameFromItem(item) || 'なし';
    const code       = item.shareCode || '';
    const repImg     = item.repImg || '';
    const deckNote   = item.deckNote || item.comment || '';
    const bg         = raceBg(item.races);

    // タグ
    const tagsMain = tagChipsMain(item.tagsAuto, item.tagsPick);
    const tagsUser = tagChipsUser(item.tagsUser);

    // 投稿者Xリンク生成
    const posterXRaw  = (item.posterX || '').trim();
    const posterXUser = posterXRaw.startsWith('@') ? posterXRaw.slice(1) : posterXRaw;
    const posterXHtml = posterXUser ? `
      <a class="meta-x"
        href="https://x.com/${encodeURIComponent(posterXUser)}"
        target="_blank"
        rel="noopener noreferrer">
        ${escapeHtml(posterXRaw)}
      </a>
    ` : '';

    // デッキリストHTML
    const deckListHtml = buildDeckListHtml(item);

    // デッキ解説HTML
    const deckNoteHtml = buildDeckNoteHtml(deckNote);

    // カード解説HTML
    const cardNotesHtml = buildCardNotesHtml(item);

    // タイプ構成情報
    const simpleStats = buildSimpleDeckStats(item); // タイプ構成情報
    const typeMixText = simpleStats?.typeText || ''; // タイプ構成テキスト
    const rarityMixText = buildRarityMixText_(item); // レアリティ構成テキスト
    const packMixText   = buildPackMixText_(item);   // パック構成テキスト（EN）
    const typeChipsPane   = buildTypeChipsHtml_(simpleStats);
    const rarityChipsPane = buildRarityChipsHtml_(item);
    const packChipsPane   = buildPackChipsHtml_(item);


    // ===== デッキコード（右ペイン）=====
    const codeNorm = String(code || '').trim();

    // 既存の「デッキコードをコピー」ボタンは維持（閲覧導線）
    const codeCopyBtnHtml = codeNorm ? `
          <div class="post-detail-code-body">
            <button type="button"
              class="btn-copy-code-wide"
              data-code="${escapeHtml(codeNorm)}">
              デッキコードをコピー
            </button>
          </div>
    ` : '';

    // マイ投稿（編集可能）だけ：管理UIを追加
    const codeManageHtml = isMinePane ? (() => {
      const isSet = !!codeNorm;
      const badgeClass = isSet ? 'is-set' : 'is-empty';
      const badgeText  = isSet ? '登録済み' : '未登録';
      const preview = isSet
        ? `${codeNorm.slice(0, 8)}...${codeNorm.slice(-6)}`
        : '貼り付けると、他の人がすぐデッキを使えます';

      return `
        <div class="deckcode-box" data-postid="${escapeHtml(item.postId || '')}">
          <div class="deckcode-head">
            <div class="deckcode-status">
              <div class="deckcode-title">デッキコード管理</div>
              <span class="deckcode-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="deckcode-preview">${escapeHtml(preview)}</div>
          </div>

          <div class="deckcode-actions">
            ${isSet ? `
              <button type="button" class="modal-buttun btn-deckcode-copy" data-code="${escapeHtml(codeNorm)}">コピー</button>
              <button type="button" class="modal-buttun btn-deckcode-edit" data-code="${escapeHtml(codeNorm)}">編集</button>
              <button type="button" class="modal-buttun btn-deckcode-delete">削除</button>
            ` : `
              <button type="button" class="modal-buttun btn-deckcode-add">＋追加</button>
            `}
          </div>
        </div>
      `;
    })() : '';

    // 既存の変数名互換：renderの後半で使うので
    const codeBtnHtml = `
      ${codeManageHtml}
      ${codeCopyBtnHtml}
    `;



    // ============================
    // ① デッキ情報パネル
    // ============================
    const tabInfo = `
      <div class="post-detail-panel is-active" data-panel="info">

        <div class="post-detail-main">

          <!-- 上段：代表カード＋タイトル＋投稿者＋タグ -->
          <div class="post-detail-main-top">
          <!-- 左：代表カード -->
          <div class="post-detail-main-left">
            ${repImg ? `
              <img src="${repImg}"
                  class="post-detail-repimg"
                  alt="${escapeHtml(item.title || '')}"
                  loading="lazy">
            ` : `
              <div style="width:100%;aspect-ratio:424/532;background:#eee;border-radius:10px;"></div>
            `}
          </div>

          <!-- 右：デッキ名＋投稿者 -->
          <div class="post-detail-main-right">
            <header class="post-detail-header">
              <h2 class="post-detail-title">
                ${escapeHtml(item.title || '(無題)')}
              </h2>

              <div class="post-detail-meta">
                <span>${escapeHtml(item.posterName || item.username || '')}</span>
                ${posterXHtml ? `<span>/ ${posterXHtml}</span>` : ''}
                ${fmtPostDates_(item) ? `<span>/ ${fmtPostDates_(item)}</span>` : ''}
              </div>

              <div class="post-detail-actions">
                <button type="button" class="btn-add-compare">比較に追加</button>
              </div>
              <!-- タグ -->
              <div class="post-detail-tags">
                <div class="post-tags post-tags-main">${tagsMain}</div>
                <div class="post-tags post-tags-user">${tagsUser}</div>
              </div>
            </header>
          </div>
          </div>


          <!-- 中段：デッキ分析 -->
            <div class="post-detail-summary">
              <dt>デッキ枚数</dt><dd>${item.count || 0}枚</dd>
              <dt>種族</dt><dd>${escapeHtml(mainRace || '')}</dd>
              <dt>旧神</dt><dd>${escapeHtml(oldGod || 'なし')}</dd>
              ${typeChipsPane
                ? `<dt>タイプ構成</dt><dd><div class="post-detail-chips">${typeChipsPane}</div></dd>`
                : ''
              }
              ${rarityChipsPane
                ? `<dt>レアリティ構成</dt><dd><div class="post-detail-chips">${rarityChipsPane}</div></dd>`
                : ''
              }
              ${packChipsPane
                ? `<dt>パック構成</dt><dd><div class="post-detail-chips">${packChipsPane}</div></dd>`
                : ''
              }
            </div>

          <!-- チャート表示エリア -->
            <div class="post-detail-charts" data-postcharts="${escapeHtml(item.postId || '')}">
              <div class="post-detail-chartbox">
                <div class="post-detail-charthead">
                  <div class="post-detail-charttitle">コスト分布</div>
                  <div class="post-detail-chartchips" id="cost-summary-${escapeHtml(paneId)}"></div>
                </div>
                <div class="post-detail-chartcanvas">
                  <canvas id="costChart-${escapeHtml(paneId)}"></canvas>
                </div>
              </div>

              <div class="post-detail-chartbox">
                <div class="post-detail-charthead">
                  <div class="post-detail-charttitle">パワー分布</div>
                  <div class="post-detail-chartchips" id="power-summary-${escapeHtml(paneId)}"></div>
                </div>
                <div class="post-detail-chartcanvas">
                  <canvas id="powerChart-${escapeHtml(paneId)}"></canvas>
                </div>
              </div>
            </div>

        </div>
      </div>
    `;

    // ============================
    // ② デッキ解説パネル（★マイ投稿のみ編集UIあり）
    // ============================

      const tabNote = `
        <div class="post-detail-panel" data-panel="note">
          <div class="post-detail-section">

            <div class="post-detail-heading-row">
              <div class="post-detail-heading">デッキ解説</div>

              ${isMinePane ? `
                <div class="post-detail-heading-actions">
                  <button type="button" class="btn-decknote-edit">編集</button>
                </div>
              ` : ''}
            </div>

            <div class="post-detail-body">

              <!-- 表示モード -->
              <div class="decknote-view">
                ${deckNoteHtml || '<div style="color:#777;font-size:.9rem;">まだ登録されていません。</div>'}
              </div>

              ${isMinePane ? `
                <!-- 編集モード -->
                <div class="decknote-editor" hidden>
                  <div class="note-toolbar">
                    <div class="note-presets-grid">
                      <button type="button" class="note-preset-btn" data-preset="deck-overview">デッキ概要</button>
                      <button type="button" class="note-preset-btn" data-preset="play-guide">プレイ方針</button>
                      <button type="button" class="note-preset-btn" data-preset="matchup">対面考察</button>
                      <button type="button" class="note-preset-btn" data-preset="results">実績レポート</button>
                    </div>
                  </div>

                  <div class="decknote-editor-hint">
                    ※上のプリセットボタンを押すと定型文が挿入されます。
                  </div>

                  <textarea class="decknote-textarea" rows="14"
                    data-original="${escapeHtml(deckNote || '')}"
                  >${escapeHtml(deckNote || '')}</textarea>

                  <div class="decknote-editor-actions">
                    <button type="button" class="btn-decknote-save">保存</button>
                    <button type="button" class="btn-decknote-cancel">キャンセル</button>
                  </div>

                </div>
              ` : ''}

            </div>
          </div>
        </div>
      `;


    // ============================
    // ③ カード解説パネル（★マイ投稿のみ編集UIあり）
    // ============================
    const tabCards = `
      <div class="post-detail-panel" data-panel="cards">
        <div class="post-detail-section">

          <div class="post-detail-heading-row post-detail-heading-row--cards">
            <div class="post-detail-heading">カード解説</div>

            ${isMinePane ? `
              <div class="post-detail-heading-actions">
                <button type="button" class="btn-cardnotes-edit">編集</button>
              </div>
            ` : ''}
          </div>

          <div class="post-detail-body">

            <!-- 表示モード -->
            <div class="cardnotes-view">
              ${cardNotesHtml}
            </div>

            ${isMinePane ? `
              <!-- 編集モード（deckmakerと同じUI） -->
              <div class="cardnotes-editor" hidden
                   data-original='${escapeHtml(JSON.stringify(item.cardNotes || []))}'>
                <div class="info-value" style="width:100%">
                  <div id="post-card-notes"></div>

                  <!-- ▼ 復元データミラー用（JSON文字列） -->
                  <input type="hidden" id="post-card-notes-hidden" value="${escapeHtml(JSON.stringify(item.cardNotes || []))}">

                  <!-- カード解説バリデーション用 -->
                  <input type="text" id="post-cardnote-validator" aria-hidden="true" tabindex="-1"
                    style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;border:none;padding:0;margin:0;">

                  <div class="add-note-box">
                    <button type="button" id="add-card-note" class="add-note-btn">カード解説を追加</button>
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
        </div>
      </div>
    `;

    // ============================
    // ④ タブバー（※ デッキリストタブは削除）
    // ============================
    const tabsHtml = `
      <div class="post-detail-tabs">
        <button type="button" class="post-detail-tab is-active" data-tab="info">📘 デッキ情報</button>
        <button type="button" class="post-detail-tab" data-tab="note">📝 デッキ解説</button>
        <button type="button" class="post-detail-tab" data-tab="cards">🗂 カード解説</button>
      </div>
    `;

    // ============================
    // ⑤ 全体組み立て（左：タブ／右：デッキリスト）
    // ============================
    pane.innerHTML = `
      <div class="post-detail-inner" data-postid="${item.postId}" style="${bg ? `--race-bg:${bg};` : ''}">
        <!-- 左カラム：タブ＋各パネル -->
        <div class="post-detail-maincol">
          ${tabsHtml}
          <div class="post-detail-body">
            ${tabInfo}
            ${tabNote}
            ${tabCards}
          </div>
        </div>

        <!-- 右カラム：常時表示のデッキリスト＋デッキコードコピー -->
        <aside class="post-detail-deckcol">
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
            ${deckListHtml}
            ${codeBtnHtml}
          </div>
        </aside>
      </div>
    `;

   // 右ペイン内の「比較に追加」だけ個別処理したい場合
    const root = pane.querySelector('.post-detail-inner');
    if (root) {
      const compareBtn = root.querySelector(
        '.post-detail-panel[data-panel="info"] .btn-add-compare'
      );
      if (compareBtn) {
        compareBtn.addEventListener('click', (ev) => {
          ev.stopPropagation(); // カードクリック扱いにならないよう一応止める
          alert('比較タブに追加する機能はベータ版では準備中です。');
        });
      }
    }

    // ✅ 分布グラフ描画（deckmaker と同じ）
    try {
      renderPostDistCharts_(item, paneId);
    } catch (e) {
      console.warn('renderPostDistCharts_ failed:', e);
    }

  }

// =========================
// マイ投稿：デッキ解説 編集UI
// =========================
const DECKNOTE_PRESETS = {
  "deck-overview":
`【デッキ概要】
どんなコンセプトで作ったか、狙いの動きなど。

【キーカード】
主軸となるカード・シナジー解説。

【入れ替え候補】
なぜこの構成にしたのか、他構築との差別化など。`,

  "play-guide":
`【マリガン基準】
初手で意識するカード、キープ基準など。

【試合の立ち回り】
〈序盤〉
〈中盤〉
〈終盤〉

【プレイのコツ】
状況判断やよくあるミスなど。`,

  "matchup":
`【環境での立ち位置】
どんな相手に強いか・苦手かなど。

【相性一覧】
〈有利対面〉
〈不利対面〉

【対策カード】
環境・メタに合わせた調整案など。`,

  "results":
`【使用環境】
使用期間・レート帯・環境など（例：シーズン〇〇／レート1600帯）

【戦績】
総試合数・勝敗（ざっくりでもOK）

【課題・改善点】
苦手な対面や構築上の弱点、今後調整したい点。

【まとめ】
使ってみた全体の印象、成果や気づきなど。`,
};

function appendPresetToTextarea_(ta, presetKey){
  if (!ta) return;
  const preset = DECKNOTE_PRESETS[presetKey];
  if (!preset) return;

  const cur = ta.value || '';
  if (!cur.trim()) {
    ta.value = preset;
  } else {
    const sep = cur.endsWith('\n') ? '\n' : '\n\n';
    ta.value = cur + sep + preset;
  }
  ta.focus();
}

// クリック委任（右ペインは描画し直すので委任が安全）
document.addEventListener('click', async (e) => {

  // デッキリスト：画像保存ボタン → 画像生成モーダルを開く
  const exportBtn = e.target.closest?.('.btn-decklist-export');
  if (exportBtn){
    e.preventDefault();
    e.stopPropagation();

    const root = e.target.closest('.post-detail-inner') || e.target.closest('[data-postid]');
    const postId = String(root?.dataset?.postid || '').trim();
    if (!postId) return;

    const item = findPostItemById(postId);
    if (!item) return;

    // ✅ 投稿のデッキは「投稿itemから」取る（window.deckを見ない）
    const deckMap = extractDeckMap(item); // 既にある想定のヘルパ

    // ✅ メイン種族・代表カードも投稿から渡す
    const mainRace = getMainRace(item.races);

    // cd正規化（空なら空のまま）
    const normCd = (cd) => {
      const s = String(cd || '').trim();
      return s ? s.padStart(5, '0') : '';
    };

    // 代表カード：まずは投稿item（＝シート由来）から探す（空なら空のまま）
    let repCd = normCd(
      item.repCd || item.repCardCd || item.rep || item.repCard || item.representativeCd || ''
    );

    // repImg しか無い場合は、URL/パスから cd を抜く（例: img/80002.webp）
    if (!repCd) {
      const src = String(item.repImg || '').trim();
      const m = src.match(/(?:^|\/)(\d{5})(?:\.(?:webp|png|jpe?g))(?:\?.*)?$/i);
      if (m) repCd = m[1];
    }

    // それでも無い / デッキに入ってないなら「安定した順序」でフォールバック
    if (!repCd || !deckMap?.[repCd]) {
      repCd = Object.keys(deckMap || {})
        .map(normCd)
        .filter(Boolean)
        .sort((a,b)=>a.localeCompare(b))[0] || '';
    }


    await window.exportDeckImage({
      deck: deckMap,
      deckName: item.title || '',
      posterName: item.posterName || item.poster || '',
      posterX: item.posterX || item.x || '',
      mainRace,
      representativeCd: repCd,

      // 投稿はクレジット出したい（デッキメーカーは false で呼ぶ）
      showCredit: true,

      // 投稿側は「40超え」はまず起きないので、気になるならスキップ可
      skipSizeCheck: true,
    });

    return;

  }




  // 編集開始
  if (e.target.matches('.btn-decknote-edit')) {
    const section = e.target.closest('.post-detail-section');
    const view = section?.querySelector('.decknote-view');
    const editor = section?.querySelector('.decknote-editor');
    if (!section || !view || !editor) return;

    view.hidden = true;
    editor.hidden = false;
    return;
  }

  // キャンセル
  if (e.target.matches('.btn-decknote-cancel')) {
    const section = e.target.closest('.post-detail-section');
    const view = section?.querySelector('.decknote-view');
    const editor = section?.querySelector('.decknote-editor');
    const ta = section?.querySelector('.decknote-textarea');
    if (!section || !view || !editor || !ta) return;

    // 元に戻す
    const original = ta.dataset.original ?? '';
    ta.value = original;
    editor.hidden = true;
    view.hidden = false;
    return;
  }

  // 保存（GASへ保存してからUI確定）
  if (e.target.matches('.btn-decknote-save')) {
    const section = e.target.closest('.post-detail-section');
    const root    = e.target.closest('.post-detail-inner') || e.target.closest('[data-postid]');
    const view    = section?.querySelector('.decknote-view');
    const editor  = section?.querySelector('.decknote-editor');
    const ta      = section?.querySelector('.decknote-textarea');
    if (!section || !view || !editor || !ta || !root) return;

    const postId = String(root.dataset.postid || '').trim();
    if (!postId) return;

    const raw = (ta.value || '').trim();

    // ★ 差分チェック（変更なしならAPI呼ばない）
    const origRaw = String(ta.dataset.original ?? '').trim();
    if (raw === origRaw) {
      editor.hidden = true;
      view.hidden = false;
      showActionToast('変更はありません');
      return;
    }

    const saveBtn = e.target;
    const prevText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';

    try {
      const r = await updateDeckNote_(postId, raw); // ★ await 必須
      if (!r || !r.ok) {
        alert((r && r.error) || '保存に失敗しました');
        return; // 失敗時は編集状態を維持
      }

      view.innerHTML = raw
        ? buildDeckNoteHtml(raw)
        : '<div style="color:#777;font-size:.9rem;">まだ登録されていません。</div>';

      ta.dataset.original = raw;

      const item = findPostItemById(postId);
      if (item) {
        item.deckNote = raw;
        item.updatedAt = new Date().toISOString();
      }

      editor.hidden = true;
      view.hidden = false;

      // ✅ 保存完了トースト
      showActionToast('デッキ解説を更新しました');

    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = prevText;
    }
    return;
  }


  // =========================
  // カード解説（マイ投稿だけ編集）
  // =========================
  if (e.target.matches('.btn-cardnotes-edit')) {
    const section = e.target.closest('.post-detail-section');
    const view = section?.querySelector('.cardnotes-view');
    const editor = section?.querySelector('.cardnotes-editor');
    if (!section || !view || !editor) return;

    // 対象投稿を引く
    const root = e.target.closest('.post-detail-inner') || e.target.closest('[data-postid]');
    const postId = String(root?.dataset?.postid || '').trim();
    const item = findPostItemById(postId) || {};

    initCardNotesEditor_(editor, item);

    view.hidden = true;
    editor.hidden = false;
    return;
  }

  if (e.target.matches('.btn-cardnotes-cancel')) {
    const section = e.target.closest('.post-detail-section');
    const view = section?.querySelector('.cardnotes-view');
    const editor = section?.querySelector('.cardnotes-editor');
    if (!section || !view || !editor) return;

    // originalへ戻す
    let orig = [];
    try { orig = JSON.parse(editor.dataset.original || '[]') || []; } catch(_) { orig = []; }
    renderCardNotesRows_(editor, orig);

    editor.hidden = true;
    view.hidden = false;
    return;
  }

  if (e.target.matches('.btn-cardnotes-save')) {
    const section = e.target.closest('.post-detail-section');
    const view = section?.querySelector('.cardnotes-view');
    const editor = section?.querySelector('.cardnotes-editor');
    const root = e.target.closest('.post-detail-inner') || e.target.closest('[data-postid]');
    const postId = String(root?.dataset?.postid || '').trim();
    if (!section || !view || !editor || !postId) return;

    if (!validateCardNotes_(editor)) return;

    // ★ 未選択（カード未指定）の解説ブロックは、保存時にブロックごと削除
    editor.querySelectorAll('.post-card-note').forEach(row=>{
      const cd = String(row.dataset.cd || '').trim();
      if (!cd) row.remove();
    });
    renumberCardNoteRows_(editor);
    syncCardNotesHidden_(editor);

    const listRaw = readCardNotesFromEditor_(editor)
      .map(r=>({ cd:String(r.cd||'').trim().padStart(5,'0'), text:String(r.text||'').replace(/\r\n/g,'\n').trim() }))
      .filter(r => !!r.cd); // cd があるものだけ保存

    // ★ 差分チェック（変更なしならAPI呼ばない）
    const normalizeNotes = (arr)=>{
      const list = Array.isArray(arr) ? arr : [];
      return list
        .map(x=>({
          cd: String(x?.cd || '').trim().padStart(5,'0'),
          text: String(x?.text || '').replace(/\r\n/g,'\n').trim(),
        }))
        .filter(x=>!!x.cd);
    };

    let origList = [];
    try { origList = JSON.parse(editor.dataset.original || '[]') || []; } catch(_) { origList = []; }

    const nextNorm = normalizeNotes(listRaw);
    const origNorm = normalizeNotes(origList);

    if (JSON.stringify(nextNorm) === JSON.stringify(origNorm)) {
      editor.hidden = true;
      view.hidden = false;
      showActionToast('変更はありません');
      return;
    }

    const btn = e.target;
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '保存中…';

    try {
      const r = await updateCardNotes_(postId, listRaw);
      if (!r || !r.ok) {
        alert((r && r.error) || '保存に失敗しました');
        return;
      }

      // 状態更新
      const item = findPostItemById(postId);
      if (item) {
        item.cardNotes = listRaw;
        item.updatedAt = new Date().toISOString();
      }

      // view更新
      view.innerHTML = buildCardNotesHtml({ cardNotes: listRaw });
      editor.dataset.original = JSON.stringify(listRaw);

      editor.hidden = true;
      view.hidden = false;

      // ✅ 保存完了トースト
      showActionToast('カード解説を更新しました');


    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
    return;
  }

  // =========================
  // マイ投稿：削除ボタン
  // =========================
    const btn = e.target.closest('#myPostList .delete-btn');
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const postId = String(btn.dataset.postid || '').trim();
  if (!postId) return;

  // タイトルを拾って確認文を丁寧に
  const card  = btn.closest('.post-card');
  const title = card?.querySelector('.post-card-title')?.textContent?.trim()
            || card?.querySelector('.pc-title')?.textContent?.trim()
            || 'この投稿';

  const msg =
`「${title}」を削除します。
削除すると元に戻せません。よろしいですか？`;

  // ★ confirm → モーダル
  const ok = await confirmDeleteByModal_(msg);
  if (!ok) return;

  btn.disabled = true;

  try{
    const r = await window.deletePost_(postId);
    if (!r || !r.ok){
      alert((r && r.error) || '削除に失敗しました');
      return;
    }

    // ✅ 削除完了トースト
    showActionToast('投稿を削除しました');

    // ✅ 右ペイン（マイ投稿側）で表示中なら空に
    const paneMine = document.getElementById('postDetailPaneMine');
    if (paneMine){
      const showingId = paneMine.querySelector('.post-detail-inner')?.dataset?.postid;
      if (String(showingId || '') === postId){
        paneMine.innerHTML = `
          <div class="post-detail-empty">
            <div class="post-detail-empty-icon">👈</div>
            <div class="post-detail-empty-text">
              <div class="post-detail-empty-title">デッキ詳細パネル</div>
              <p class="post-detail-empty-main">
                左の<span class="post-detail-empty-accent">マイ投稿カード</span>をクリックすると、<br>
                ここにそのデッキの詳細が表示されます。
              </p>
            </div>
          </div>
        `;
      }
    }

    // ✅ 右ペイン（一覧側）で表示中でも空に（同一投稿が開かれてる可能性）
    const paneList = document.getElementById('postDetailPane');
    if (paneList){
      const showingId = paneList.querySelector('.post-detail-inner')?.dataset?.postid;
      if (String(showingId || '') === postId){
        paneList.innerHTML = `
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
    }

    // ✅ 一覧データも即時から削除（“投稿一覧の一新” = 表示の整合性を取る）
    const S = window.__DeckPostState;
    if (S?.list){
      S.list.allItems = (S.list.allItems || []).filter(it => String(it.postId || '') !== postId);
      S.list.total = (S.list.allItems || []).length;
    }

    // ✅ まずは「マイ投稿」を再読み込み（ページャ/件数も正しくなる）
    await window.DeckPostApp?.reloadMine?.();

    // ✅ 一覧も再描画（今のページを維持してフィルタ/ソート反映）
    window.DeckPostApp?.applySortAndRerenderList?.();

  } finally {
    btn.disabled = false;
  }
});

// =========================
// プリセットボタン：定型文挿入
// =========================
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.note-preset-btn');
  if (!btn) return;

  // どのプリセットか
  const key = String(btn.dataset.preset || '').trim();
  if (!key) return;

  // 同じ「デッキ解説」セクション内の textarea を探す
  const section = btn.closest('.post-detail-section');
  const ta = section?.querySelector('.decknote-textarea');
  if (!ta) return;

  appendPresetToTextarea_(ta, key);
});


// カードクリック → 右ペインに反映（PCのみ）
function showDetailPaneForArticle(art){
  if (!art) return;
  const postId = art.dataset.postid;
  if (!postId) return;
  const item = findPostItemById(postId);
  if (!item) return;

  // ★ このカードが pageMine 内かどうかでペインを出し分け
  const inMine = !!art.closest('#pageMine');
  const paneId = inMine ? 'postDetailPaneMine' : 'postDetailPane';

  renderDetailPaneForItem(item, paneId);

  // 選択中のカードにマーク（全体から一旦外して OK ならこのまま）
  document.querySelectorAll('.post-card.is-active').forEach(el => {
    el.classList.remove('is-active');
  });
  art.classList.add('is-active');
}

// ===== 右ペイン：タブ切り替え（一覧 / マイ投稿 共通） =====
function setupDetailTabs(){
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.post-detail-tab');
    if (!tab) return;

    const root = tab.closest('.post-detail-inner');
    if (!root) return;

    const key = tab.dataset.tab;
    if (!key) return;

    // タブの見た目切り替え
    root.querySelectorAll('.post-detail-tab').forEach(btn => {
      btn.classList.toggle('is-active', btn === tab);
    });

    // パネルの表示切り替え
    root.querySelectorAll('.post-detail-panel').forEach(panel => {
      panel.classList.toggle('is-active', panel.dataset.panel === key);
    });
  });
}

  // ===== デッキコードコピー（共通ボタン） =====
  function showCodeCopyToast(){
    let toast = document.getElementById('code-copy-toast');
    if (!toast){
      toast = document.createElement('div');
      toast.id = 'code-copy-toast';
      toast.textContent = 'デッキコードをコピーしました';
      document.body.appendChild(toast);
    }
    toast.classList.add('is-visible');
    if (toast._timer){
      clearTimeout(toast._timer);
    }
    toast._timer = setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 1600);
  }

  // デッキコードコピー ボタンのセットアップ
  function setupCodeCopyButtons(){
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-copy-code-wide');
      if (!btn) return;

      const code = btn.dataset.code || '';
      if (!code) return;

      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(code)
          .then(() => {
            showCodeCopyToast();
          })
          .catch(() => {
            // 失敗しても何もしない（必要なら alert など）
          });
      }
    });
  }

// =========================
// マイ投稿：デッキコード 追加/編集/削除（PC）
// =========================
function normalizeDeckCode_(s){
  return String(s || '').replace(/\s+/g, '').trim();
}

// 「デッキコードっぽいか」判定（厳密解析はしない）
function isDeckCodeLike_(raw){
  const s = normalizeDeckCode_(raw);
  if (!s) return false;
  if (s.length < 40) return false;               // 短すぎはNG
  if (s.length > 600) return false;              // 異常に長いのは一旦NG
  // base64/base64urlっぽい文字種 + / + = など許容
  if (!/^[A-Za-z0-9+/_=\-]+$/.test(s)) return false;
  return true;
}

// DeckCode管理ボックスHTML（マイ投稿用：PC右ペイン/スマホ詳細で共通）
function buildDeckCodeBoxHtml_(postId, codeNorm){
  const code = String(codeNorm || '').trim();
  const isSet = !!code;
  const badgeClass = isSet ? 'is-set' : 'is-empty';
  const badgeText  = isSet ? '登録済み' : '未登録';
  const preview = isSet
    ? `${code.slice(0, 8)}...${code.slice(-6)}`
    : '貼り付けると、他の人がすぐデッキを使えます';

  return `
    <div class="deckcode-box" data-postid="${escapeHtml(postId || '')}">
      <div class="deckcode-head">
        <div class="deckcode-status">
          <div class="deckcode-title">デッキコード管理</div>
          <span class="deckcode-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="deckcode-preview">${escapeHtml(preview)}</div>
      </div>

      <div class="deckcode-actions">
        ${isSet ? `
          <button type="button" class="modal-buttun btn-deckcode-copy" data-code="${escapeHtml(code)}">コピー</button>
          <button type="button" class="modal-buttun btn-deckcode-edit" data-code="${escapeHtml(code)}">編集</button>
          <button type="button" class="modal-buttun btn-deckcode-delete">削除</button>
        ` : `
          <button type="button" class="modal-buttun btn-deckcode-add">＋追加</button>
        `}
      </div>
    </div>
  `;
}

function cssEscape_(s){
  const v = String(s ?? '');
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(v);
  // フォールバック（最低限）
  return v.replace(/[^a-zA-Z0-9_\-]/g, (c)=>`\\${c}`);
}

// 画面上のデッキコードUIを「現在のstate」に合わせて更新（PC右ペイン/スマホ詳細どちらにも効かせる）
function refreshDeckCodeUIs_(postId){
  const pid = String(postId || '').trim();
  if (!pid) return;

  const it = findItemById_(pid) || { postId: pid, shareCode: '' };
  const codeNorm = String(it.shareCode || '').trim();

  // 1) deckcode-box を差し替え
  const boxHtml = buildDeckCodeBoxHtml_(pid, codeNorm);
  const escPid = cssEscape_(pid);
  document.querySelectorAll(`.deckcode-box[data-postid="${escPid}"]`).forEach(el => {
    el.outerHTML = boxHtml;
  });

  // 2) スマホ詳細内の「デッキコードをコピー」導線（btn-copy-code-wide）も追従
  document.querySelectorAll(`.post-card[data-postid="${escPid}"]`).forEach(card => {
    const firstSection = card.querySelector('.post-detail .post-detail-section'); // デッキリスト節（先頭）
    if (!firstSection) return;

    let body = firstSection.querySelector('.post-detail-code-body');
    if (codeNorm){
      if (!body){
        body = document.createElement('div');
        body.className = 'post-detail-code-body';
        body.innerHTML = `
          <button type="button" class="btn-copy-code-wide" data-code="${escapeHtml(codeNorm)}">デッキコードをコピー</button>
        `;
        firstSection.appendChild(body);
      } else {
        const btn = body.querySelector('.btn-copy-code-wide');
        if (btn) btn.dataset.code = codeNorm;
      }
    } else {
      if (body) body.remove();
    }
  });
}


function showMiniToast_(text){
  let toast = document.getElementById('mini-toast');
  if (!toast){
    toast = document.createElement('div');
    toast.id = 'mini-toast';
    toast.style.position = 'fixed';
    toast.style.left = '50%';
    toast.style.bottom = '18px';
    toast.style.transform = 'translateX(-50%)';
    toast.style.padding = '10px 14px';
    toast.style.borderRadius = '999px';
    toast.style.background = 'rgba(17,24,39,.92)';
    toast.style.color = '#fff';
    toast.style.fontSize = '.9rem';
    toast.style.zIndex = '9999';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .18s ease';
    document.body.appendChild(toast);
  }
  toast.textContent = String(text || '');
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ toast.style.opacity = '0'; }, 1400);
}

function openDeckCodeModal_(postId, currentCode){
  const modal   = document.getElementById('deckCodeEditModal');
  const preview = document.getElementById('deckCodePreview');
  const judge   = document.getElementById('deckCodeJudge');
  const save    = document.getElementById('deckCodeSaveBtn');
  const paste   = document.getElementById('deckCodePasteBtn');
  if (!modal || !preview || !judge || !save || !paste) return;

  modal.dataset.postid = String(postId || '');

  const cur = normalizeDeckCode_(currentCode);
  modal.dataset.original  = cur;   // 登録済みの値
  modal.dataset.candidate = '';    // 貼り付け後の保存対象（ここに入った時だけ保存できる）

  // プレビュー（登録済みなら表示、未登録なら案内）
  preview.textContent = cur
    ? String(currentCode || '')
    : '未貼り付けです（「クリップボードから貼り付け」を押してください）';

  // 判定欄（開いた時点では「貼り付け待ち」）
  judge.className = 'deckcode-judge';
  judge.textContent = cur
    ? '登録済みです（更新する場合は「クリップボードから貼り付け」を押してください）'
    : '未貼り付けです（「クリップボードから貼り付け」を押してください）';

  save.disabled = true;
  paste.disabled = false;

  modal.style.display = 'flex';
}


function closeDeckCodeModal_(){
  const modal = document.getElementById('deckCodeEditModal');
  if (modal) modal.style.display = 'none';
}

// state / postState の item を更新（見た目即反映用）
function patchItemShareCode_(postId, shareCode){
  const pid = String(postId || '').trim();
  const patch = (it)=>{
    if (!it) return;
    if (String(it.postId||'') === pid){
      it.shareCode = String(shareCode || '');
    }
  };

  // 一覧
  (state?.list?.items || []).forEach(patch);
  (state?.list?.allItems || []).forEach(patch);

  // マイ投稿
  (state?.mine?.items || []).forEach(patch);
  (postState?.mine?.items || []).forEach(patch);
  (postState?.list?.items || []).forEach(patch);
}


// クリック委任
document.addEventListener('click', async (e)=>{
  // 右ペイン（マイ投稿）: 追加/編集
  const addBtn  = e.target.closest('.btn-deckcode-add');
  const editBtn = e.target.closest('.btn-deckcode-edit');
  if (addBtn || editBtn){
    const root = e.target.closest('.post-detail-inner');
    const postId = root?.dataset?.postid || root?.querySelector('.deckcode-box')?.dataset?.postid || '';
    const cur = editBtn ? (editBtn.dataset.code || '') : '';
    if (!postId) return;
    openDeckCodeModal_(postId, cur);
    return;
  }

  // 右ペイン（マイ投稿）: コピー（小）
  const copyBtn = e.target.closest('.btn-deckcode-copy');
  if (copyBtn){
    const code = copyBtn.dataset.code || '';
    if (!code) return;
    if (navigator.clipboard?.writeText){
      try{
        await navigator.clipboard.writeText(code);
        // 既存トーストも使える
        if (typeof showCodeCopyToast === 'function') showCodeCopyToast();
        else showMiniToast_('デッキコードをコピーしました');
      }catch(_){}
    }
    return;
  }

  // 右ペイン（マイ投稿）: 削除（確認→API）
  const delBtn = e.target.closest('.btn-deckcode-delete');
  if (delBtn){
    const root = e.target.closest('.post-detail-inner');
    const postId = String(root?.dataset?.postid || '').trim();
    if (!postId) return;

    // ★ confirm() ではなく、既存の削除確認モーダルを使う
    const msg =
  `デッキコードを削除します。
  削除すると元に戻せません。よろしいですか？`;

    const ok = await confirmDeleteByModal_(msg);
    if (!ok) return;

    const r = await updateDeckCode_(postId, '');
    if (!r || !r.ok){
      alert((r && r.error) || '削除に失敗しました');
      return;
    }

    patchItemShareCode_(postId, '');
    refreshDeckCodeUIs_(postId);
    renderDetailPaneForItem(
      findItemById_(postId) || { postId },
      root.id || 'postDetailPaneMine'
    );
    showMiniToast_('デッキコードを削除しました');
    return;
  }


  // モーダル：貼り付け（★判定はここだけ）
  if (e.target && e.target.id === 'deckCodePasteBtn'){
    const modal   = document.getElementById('deckCodeEditModal');
    const preview = document.getElementById('deckCodePreview');
    const judge   = document.getElementById('deckCodeJudge');
    const save    = document.getElementById('deckCodeSaveBtn');
    if (!modal || !preview || !judge || !save) return;

    if (!navigator.clipboard?.readText){
      alert('この環境ではクリップボードの読み取りができません');
      return;
    }

    try{
      const text = await navigator.clipboard.readText();
      const raw  = String(text || '');

      // 表示（改行もそのまま見せる）
      preview.textContent = raw || '（クリップボードが空でした）';

      const ok = isDeckCodeLike_(raw);
      judge.className = 'deckcode-judge ' + (ok ? 'ok' : 'ng');
      judge.textContent = ok ? '✅ デッキコード形式です' : '❌ デッキコードではありません';
      save.disabled = !ok;

      // ★ 保存対象は candidate にだけ入れる（textareaはもう無い）
      modal.dataset.candidate = ok ? normalizeDeckCode_(raw) : '';

      if (ok) showMiniToast_('クリップボードから貼り付けました');
    }catch(_){
      alert('クリップボードの読み取りに失敗しました（権限をご確認ください）');
    }
    return;
  }



  // モーダル：data-close
  const close = e.target.closest('[data-close="deckCodeEditModal"]');
  if (close){
    closeDeckCodeModal_();
    return;
  }

  // モーダル：保存
  if (e.target && e.target.id === 'deckCodeSaveBtn'){
    const modal = document.getElementById('deckCodeEditModal');
    if (!modal) return;

    const postId = modal.dataset.postid || '';
    const code   = String(modal.dataset.candidate || '').trim();
    if (!postId) return;

    // 念のため
    if (!code || !isDeckCodeLike_(code)){
      alert('デッキコードではありません（形式が違います）');
      return;
    }

    const r = await updateDeckCode_(postId, code);
    if (!r || !r.ok){
      alert((r && r.error) || '保存に失敗しました');
      return;
    }

    patchItemShareCode_(postId, code);
    refreshDeckCodeUIs_(postId);
    closeDeckCodeModal_();

    const pane = document.getElementById('postDetailPaneMine') || document.getElementById('postDetailPane');
    if (pane){
      renderDetailPaneForItem(findItemById_(postId) || { postId, shareCode: code }, pane.id);
    }
    showMiniToast_('デッキコードを保存しました');
    return;
  }

});

// 背景クリックで閉じる（既存 modal と同じ）
document.addEventListener('click', (e)=>{
  const modal = document.getElementById('deckCodeEditModal');
  if (!modal) return;
  if (e.target === modal) closeDeckCodeModal_();
});

// postId から item を探す（安全側）
function findItemById_(postId){
  const pid = String(postId || '').trim();
  const pools = [
    state?.mine?.items,
    postState?.mine?.items,
    state?.list?.items,
    state?.list?.allItems,
    postState?.list?.items
  ].filter(Boolean);

  for (const arr of pools){
    const hit = arr.find(it => String(it?.postId||'') === pid);
    if (hit) return hit;
  }
  return null;
}


// =========================
// デッキリストのカード画像タップ → カード詳細
// =========================
document.addEventListener('click', (e) => {
  const cell = e.target.closest('.post-decklist .deck-entry');
  if (!cell) return;

  const cd5 = String(cell.dataset.cd || '').trim().padStart(5,'0');
  if (!cd5) return;

  // 他の「カード全体クリック」等に波及させない
  e.preventDefault();
  e.stopPropagation();

  openCardDetailFromDeck_(cd5, cell);
});



  // ===== 投稿日・更新日のフォーマット =====
  function fmtDate(v){
    if (!v) return '';
    try{
      const d = new Date(v);
      const y = d.getFullYear(),
            m = (d.getMonth()+1).toString().padStart(2,'0'),
            da = d.getDate().toString().padStart(2,'0');
      return `${y}/${m}/${da}`;
    }catch(_){ return ''; }
  }

  // 投稿日+（更新日）表示：更新が無い/同日なら投稿日だけ
  function fmtPostDates_(item){
    const cRaw = item?.createdAt || '';
    const uRaw = item?.updatedAt || '';
    const c = fmtDate(cRaw);
    const u = fmtDate(uRaw);

    if (!c && !u) return '';
    // 更新日が無い / 作成日が無い / 同日なら「投稿日」だけ
    if (!u || !c || u === c) return c || u;

    return `${c}（更新日${u}）`;
  }


// ===== イベント配線 =====
function wireCardEvents(root){
  root.addEventListener('click', (e) => {
    const art = e.target.closest('.post-card');
    if (!art) return;

    const isPcWide = window.matchMedia('(min-width: 1024px)').matches;

    // 0) いいねボタンを先に処理（PC/SP共通）
    const favBtn = e.target.closest('.fav-btn');
    if (favBtn) {
      const postId = art.dataset.postid;
      if (postId) {
        handleToggleLike(postId, favBtn);
      }
      // 他のハンドラには進まず終了
      return;
    }

    // 1) まずはボタン類を個別処理 ==================

    // 詳細ボタン（SP用） ※PCで存在しても問題なし
    if (e.target.classList.contains('btn-detail')){
      const d = art.querySelector('.post-detail');
      if (d) d.hidden = !d.hidden;
      return;
    }

    // 詳細内「閉じる」（SP用）
    if (e.target.classList.contains('btn-detail-close')){
      const d = art.querySelector('.post-detail');
      if (d) d.hidden = true;
      art.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    // 比較に追加（一覧側のボタン）
    if (e.target.classList.contains('btn-add-compare')){
      alert('比較タブに追加する機能はベータ版では準備中です。');
      return;
    }

    // IDコピー（旧仕様）
    if (e.target.classList.contains('btn-copyid')){
      const id = art.dataset.postid || '';
      if (id && navigator.clipboard){
        navigator.clipboard.writeText(id).catch(()=>{});
      }
      return;
    }

    // 2) カード内の詳細エリアをクリックしたときは何もしない（PC/SP共通）
    if (e.target.closest('.post-detail')){
      return;
    }

    // 3) 上記以外 → 「カード全体クリック」として扱うかどうか ============

    if (!isPcWide){
      // ★ モバイル／タブレット（〜1023px）の場合は
      //    詳細ボタン以外のタップでは何もしない（Xリンクなどはそのまま動作）
      return;
    }

    // ★ PC(1024px以上)：カード全体クリックで右ペインに詳細表示
    showDetailPaneForArticle(art);
  });
}




// 指定 postId の投稿オブジェクトを state から探す（反映漏れ防止で探索範囲を拡大）
function findPostItemById(postId){
  const id = String(postId);

  const pick = (arr) => (arr || []).find(it => String(it.postId) === id);

  return (
    pick(state.mine.items) ||
    pick(state.list.items) ||
    pick(state.list.filteredItems) ||
    pick(state.list.allItems) ||
    null
  );
}


  // スマホ版：代表カードタップでデッキリスト簡易表示
  function setupDeckPeekOnSp(){
    const isSp = () => window.matchMedia('(max-width: 1023px)').matches;

    function ensureOverlay(){
      let pane = document.getElementById('post-deckpeek-overlay');
      if (!pane){
        pane = document.createElement('div');
        pane.id = 'post-deckpeek-overlay';
        pane.innerHTML = `
          <div class="post-deckpeek-inner">
            <div class="post-deckpeek-body"></div>
          </div>
        `;
        document.body.appendChild(pane);
      }
      return pane;
    }

    function hideOverlay(){
      const pane = document.getElementById('post-deckpeek-overlay');
      if (pane){
        pane.style.display = 'none';
      }
    }

    // ★ 代表カードの「右横」に出すように座標計算
    function showForArticle(art, thumbEl){
      if (!isSp()) return;
      if (!art) return;

      const postId = art.dataset.postid;
      if (!postId) return;

      const item = findPostItemById(postId);
      if (!item) return;

      const html = buildDeckListHtml(item);

      const pane  = ensureOverlay();
      const body  = pane.querySelector('.post-deckpeek-body');
      if (!body) return;

      body.innerHTML = html;

      // 一旦表示してサイズを取る
      pane.style.display = 'block';
      pane.style.width   = '';
      pane.style.right   = 'auto';
      pane.style.bottom  = 'auto';

      const maxW = Math.min(window.innerWidth * 0.7, 460);
      pane.style.width = maxW + 'px';

      if (thumbEl){
        const r = thumbEl.getBoundingClientRect();
        const margin = 8;

        const paneW = pane.offsetWidth;
        const paneH = pane.offsetHeight;

        // 基本位置：代表カードの右横
        let left = r.right + margin;
        let top  = r.top;

        // 右にはみ出す場合は左にずらす
        if (left + paneW > window.innerWidth - margin){
          left = window.innerWidth - margin - paneW;
          if (left < margin) left = margin;
        }

        // 下にはみ出す場合は上にずらす
        if (top + paneH > window.innerHeight - margin){
          top = window.innerHeight - margin - paneH;
          if (top < margin) top = margin;
        }

        pane.style.left = left + 'px';
        pane.style.top  = top  + 'px';
      }
    }

    const root = document.getElementById('postList');
    if (!root) return;

    // ★ スマホ時：代表カード（thumb-box）タップで表示
    root.addEventListener('click', (e) => {
      if (!isSp()) return;

      const thumb = e.target.closest('.thumb-box');
      if (!thumb) return;

      const art = thumb.closest('.post-card.post-card--sp');
      if (!art) return;

      showForArticle(art, thumb);

      // このタップで即座に「外側タップ判定」で閉じられないようにする
      e.stopPropagation();
    });

    // スクロールで閉じる
    window.addEventListener('scroll', hideOverlay, { passive: true });

    // オーバーレイ外をタップしたら閉じる
    document.addEventListener('click', (e) => {
      const pane = document.getElementById('post-deckpeek-overlay');
      if (!pane || pane.style.display === 'none') return;
      if (e.target.closest('#post-deckpeek-overlay')) return; // 内側タップは無視
      hideOverlay();
    });

    // ★ thumb-box 上のコンテキストメニュー（画像長押しメニュー）を抑制
    root.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.thumb-box')) {
        e.preventDefault();
      }
    });
  }


    // ===== 並び替え（投稿日ベース） =====
  function getPostTime(item){
    const v = item.updatedAt || item.createdAt || '';
    if (!v) return 0;
    const t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }



  // ===== 並び替え実装 =====
  function sortItems(items, sortKey){
    const arr = [...items];

    arr.sort((a, b) => {
      if (sortKey === 'like') {
        const la = Number(a.likeCount || 0);
        const lb = Number(b.likeCount || 0);

        // いいねの多い順（降順）
        if (lb !== la) return lb - la;

        // 同じなら投稿日の新しい方を上に
        const ta = getPostTime(a);
        const tb = getPostTime(b);
        return tb - ta;
      }

      // ===== 既存：新しい順 / 古い順 =====
      const ta = getPostTime(a);
      const tb = getPostTime(b);

      if (sortKey === 'old') {
        return ta - tb; // 古い順
      } else {
        return tb - ta; // 新しい順
      }
    });

    return arr;
  }


// ===== 一覧：フィルタ＆ソート結果を作り直す =====
function rebuildFilteredItems(){
  const base    = state.list.allItems || [];
  const sortKey = state.list.sortKey || 'new';

  let filtered = base.slice();

  // ★ 投稿フィルター（タグ） — window.PostFilterState を見る
  const fs = window.PostFilterState;

  // ① 投稿タグ（自動＋選択タグ）：AND（全部含む）
  if (fs?.selectedTags?.size) {
    const selected = Array.from(fs.selectedTags);

    filtered = filtered.filter(item => {
      const all = [item.tagsAuto, item.tagsPick].filter(Boolean).join(',');
      if (!all) return false;

      const set = new Set(
        all.split(',').map(s => s.trim()).filter(Boolean)
      );

      // AND 条件：選択したタグを全部含む
      return selected.every(t => set.has(t));
    });
  }


  // ★ ユーザータグ検索（複数選択 OR）
  const selUserTags = Array.from(window.PostFilterState?.selectedUserTags || []);
  if (selUserTags.length) {
    // かな/カナ混合に対応するための正規化（ひらがな⇔カタカナ差を吸収）
    const toHira = (s) => String(s || '').replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
    const norm = (s) => toHira(String(s || '').trim().toLowerCase());

    const selNorm = selUserTags.map(norm).filter(Boolean);

    filtered = filtered.filter(item => {
      const raw = String(item.tagsUser || '');
      if (!raw) return false;

      const tags = raw.split(',')
        .map(t => t.trim())
        .filter(Boolean);

      const tagNorm = tags.map(norm);

      // OR：どれか1つでも一致
      return selNorm.some(t => tagNorm.includes(t));
    });
  }

  // ★ 投稿者フィルタ（完全一致）
  const selPoster = String(fs?.selectedPoster || '').trim();
  if (selPoster){
    filtered = filtered.filter(item => {
      const p = String(item.posterName || item.username || '').trim();
      return p === selPoster;
    });
  }


  // 並び替え
  filtered = sortItems(filtered, sortKey);

  state.list.filteredItems = filtered;

  const total = filtered.length;
  state.list.total      = total;
  state.list.totalPages = Math.max(
    1,
    Math.ceil(Math.max(total, 1) / PAGE_LIMIT)
  );
}




    // ===== 一覧用：ページャUI更新 =====
  function updatePagerUI(){
    const page  = state.list.currentPage || 1;
    const total = state.list.totalPages  || 1;

    const prev = document.getElementById('pagePrev');
    const next = document.getElementById('pageNext');
    const info = document.getElementById('pageInfo');

    if (info){
      info.textContent = `${page} / ${total}`;
    }
    if (prev){
      prev.disabled = (page <= 1);
    }
    if (next){
      next.disabled = (page >= total);
    }
  }

  // ===== マイ投稿：件数＆ページャUI更新 =====
  function updateMinePagerUI() {
    const countLabel = document.getElementById('resultCountMine');
    const info       = document.getElementById('minePageInfo');
    const prevBtn    = document.getElementById('minePagePrev');
    const nextBtn    = document.getElementById('minePageNext');

    const page       = state.mine.page       || 1;
    const total      = state.mine.total      || 0;
    const totalPages = state.mine.totalPages || 1;
    const isLoading  = !!state.mine.loading;

    if (countLabel) {
      countLabel.textContent = `マイ投稿 ${total}件`;
    }
    if (info) {
      info.textContent = `${page} / ${totalPages}`;
    }
    if (prevBtn) {
      prevBtn.disabled = isLoading || page <= 1;
    }
    if (nextBtn) {
      nextBtn.disabled = isLoading || page >= totalPages;
    }
  }


  // モーダルから呼ぶ用：現在のチェック状態でフィルタを反映
async function applyFilters() {
  updateFilterStateFromModal();  // チェック → filterState へ
  // フィルタ・ソート適用前に全件取得されていない場合は取得する
  if (!state.list.hasAllItems) {
    await fetchAllList();
  }
  rebuildFilteredItems();        // フィルタ＋ソート計算
  loadListPage(1);               // 1ページ目を再描画
}

// モーダル外から呼ぶ用：並び替えやフィルター適用後に一覧を再計算して再描画
async function applySortAndRerenderList(resetToFirstPage = false){
  // 全件取得されていない場合は取得する
  if (!state.list.hasAllItems) {
    // fetchAllList() は一覧全件を読み込んで state.list.allItems に格納する
    await fetchAllList();
  }
  // フィルター・並び替えを再計算
  rebuildFilteredItems();
  // 描画するページを決めて再描画
  const page = resetToFirstPage ? 1 : (state.list.currentPage || 1);
  loadListPage(page);
}


  // ===== 一覧用：指定ページを描画（クライアント側ページング） =====
  function loadListPage(page){
    const listEl = document.getElementById('postList');
    if (!listEl) return;

    const filtered = state.list.filteredItems || [];
    const total    = state.list.total || filtered.length || 0;

    // ページ数を再確認（外から直接呼んだ場合の保険）
    const totalPages = total > 0 ? Math.max(1, Math.ceil(total / PAGE_LIMIT)) : 1;
    state.list.totalPages = totalPages;

    const p = Math.min(Math.max(page, 1), totalPages);
    state.list.currentPage = p;

    const start = (p - 1) * PAGE_LIMIT;
    const end   = start + PAGE_LIMIT;
    const pageItems = filtered.slice(start, end);

    state.list.items = pageItems;

    listEl.replaceChildren();
    renderList(pageItems, 'postList');

    // 件数表示
    const infoEl = document.getElementById('resultCount');
    if (infoEl){
      infoEl.textContent = `投稿：${total}件`;
    }

    // ページャUI更新
    updatePagerUI();
  }


  // ===== 一覧ロード（互換用: 「次のページ」扱い） =====
  function loadMoreList(){
    const page  = state.list.currentPage || 1;
    const total = state.list.totalPages  || 1;
    if (page >= total) return;
    loadListPage(page + 1);
  }


// ===== キャンペーンバナー =====
async function renderCampaignBanner(){
  const box = document.getElementById('campaign-banner');
  const titleEl = document.getElementById('campaign-banner-title');
  const textEl  = document.getElementById('campaign-banner-text');
  const rangeEl = document.getElementById('campaign-banner-range');
  if (!box || !titleEl || !textEl) return;

  let camp = null;
  try { camp = await (window.fetchActiveCampaign?.() || Promise.resolve(null)); } catch(_){ camp = null; }

  const isActive = camp && (camp.isActive === true || String(camp.isActive) === 'true') && String(camp.campaignId||'');
  if (!isActive) {
    box.style.display = 'none';
    // ★ 追加：開催してないのでキャンペーンタグは非表示側へ
    window.__isCampaignRunning = false;
    window.__activeCampaignTag = '';
    return;
  }

  const rawTitle = String(camp.title || 'キャンペーン');
  const start = camp.startAt ? new Date(camp.startAt) : null;
  const end   = camp.endAt   ? new Date(camp.endAt)   : null;

  const fmt = (d)=> (d && !isNaN(d)) ? fmtDate(d) : '';
  const computedRange = (start||end) ? `${fmt(start)}〜${fmt(end)}` : '';

  // titleに日程が含まれるパターン（(2025/..〜..) / （2025/..〜..）など）
  const titleHasRange = /[（(]\s*\d{4}\/\d{1,2}\/\d{1,2}\s*〜\s*\d{4}\/\d{1,2}\/\d{1,2}\s*[)）]/.test(rawTitle);

  // タイトルから日程括弧を除去してスッキリさせる
  const cleanTitle = rawTitle
    .replace(/[（(]\s*\d{4}\/\d{1,2}\/\d{1,2}\s*〜\s*\d{4}\/\d{1,2}\/\d{1,2}\s*[)）]\s*/g, '')
    .trim();

  titleEl.textContent = cleanTitle || 'キャンペーン';

  // ★ 追加：開催中。今回のキャンペーンタグ（= cleanTitle）を保存
  window.__isCampaignRunning = true;
  window.__activeCampaignTag = cleanTitle || '';

  if (rangeEl) {
    // titleに日程が含まれてるなら、ここは出さない（2重防止）
    rangeEl.textContent = (!titleHasRange && computedRange) ? computedRange : '';
  }

  // 位置依存をやめて、どの端末でも自然な文に
  textEl.textContent =
    'デッキを投稿して、キャンペーンに参加しよう！ 詳しい参加条件や報酬は、詳細をチェック！';

  box.style.display = '';
}



  // ===== 初期化 =====
  async function init(){
    // ① カードマスタ読み込み（デッキリスト・カード解説で使う）
    try {
      showListStatusMessage('loading', '投稿一覧を読み込み中です…(5秒ほどかかります)');
    } catch (e) {
      // showListStatusMessage が未定義の場合は無視
    }
    try {
      await ensureCardMapLoaded();
      console.log('cardMap loaded, size =', Object.keys(window.cardMap || {}).length);
    } catch (e) {
      console.error('カードマスタ読み込みに失敗しました', e);
    }

    // ①.2 歴代キャンペーンタグ＆バナーの読み込みは初期描画後に遅延実行する（一覧ロードを優先）
    // ここでは何もしない。window.__campaignTagSet などは後続タスクで初期化される。

    // ② トークン
    state.token = resolveToken();

    // ログイン状態初期反映（ID表示だけ & マイ投稿表示中なら読み込み）
    handleAuthChangedForDeckPost();

    // ③ 並び替えセレクト（先に sortKey を決めておく）
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect){
      state.list.sortKey = sortSelect.value || 'new';
      sortSelect.addEventListener('change', () => {
        state.list.sortKey = sortSelect.value || 'new';
        window.DeckPostApp?.applySortAndRerenderList?.();
      });
    }

    // ④一覧データを段階的に取得 → 初期描画
    try {
      state.list.loading = true;
      showListStatusMessage('loading', '投稿一覧を読み込み中です…(5秒ほどかかります)');
      // ★ 改善版：一度のリクエストで全件取得してフィルタ・ソートを行う
      // これにより投稿一覧を2回呼び出す必要がなくなり、最新投稿表示までの時間が短縮される
      await fetchAllList();         // state.list.allItems に全件を入れる（FETCH_LIMIT=100）
      rebuildFilteredItems();       // フィルタ適用＆並び替え
      state.list.currentPage = 1;   // 初期ページを 1 に設定
      loadListPage(1);              // 最初のページを描画
    } catch (e) {
      console.error('初期一覧取得に失敗しました', e);
      showListStatusMessage('error', '投稿一覧の読み込みに失敗しました。ページを再読み込みしてください。');
    } finally {
      state.list.loading = false;
    }


    // ⑤ 一覧側：ページャボタン
    document.getElementById('pagePrev')?.addEventListener('click', () => {
      const page = state.list.currentPage || 1;
      if (page > 1){
        loadListPage(page - 1);
      }
    });
    document.getElementById('pageNext')?.addEventListener('click', () => {
      const page  = state.list.currentPage || 1;
      const total = state.list.totalPages  || 1;
      if (page < total){
        loadListPage(page + 1);
      }
    });

    // ⑥ フィルターボタンはまだプレースホルダ

    /*document.getElementById('filterBtn')?.addEventListener('click', () => {
      alert('フィルタ機能はベータ版では準備中です。');
    });*/


    // ⑤ マイ投稿へ（ツールバーのボタン）
    document.getElementById('toMineBtn')?.addEventListener('click', async () => {
      showMine();
      updateMineLoginStatus();     // ログインID表示更新
      await loadMinePage(1);       // 1ページ目を取得
    });

    // ⑥ マイ投稿：戻る
    document.getElementById('backToListBtn')?.addEventListener('click', showList);

    // ⑦ マイ投稿：ページャ（前へ / 次へ）
    document.getElementById('minePagePrev')?.addEventListener('click', () => {
      const p = state.mine.page || 1;
      if (p > 1){
        loadMinePage(p - 1);
      }
    });

    document.getElementById('minePageNext')?.addEventListener('click', () => {
      const p     = state.mine.page       || 1;
      const total = state.mine.totalPages || 1;
      if (p < total){
        loadMinePage(p + 1);
      }
    });


    // ⑦ デリゲートイベント
    wireCardEvents(document);

    // デッキコードコピー ボタン（PC右ペイン／SP共通）
    setupCodeCopyButtons();

    // ⑧ 右ペイン詳細タブ
    setupDetailTabs();

    // ⑩ スマホ版：代表カード長押しでデッキリスト簡易表示
    setupDeckPeekOnSp();

    // 回転/リサイズ時に再描画（PC/SP境界またぎ対策）
    (() => {
      const isPcWide = () => window.matchMedia('(min-width: 1024px)').matches;
      let last = isPcWide();
      let tid = null;

      const onChange = () => {
        clearTimeout(tid);
        tid = setTimeout(() => {
          // 1) SPの簡易オーバーレイが出っぱなしなら閉じる
          const pane = document.getElementById('post-deckpeek-overlay');
          if (pane) pane.style.display = 'none';

          // 2) 1023/1024 を跨いだら一覧を再描画
          const now = isPcWide();
          if (now !== last) {
            last = now;
            if (typeof applySortAndRerenderList === 'function') {
              applySortAndRerenderList();
            } else if (window.DeckPostApp?.applySortAndRerenderList) {
              window.DeckPostApp.applySortAndRerenderList();
            }
          }
        }, 120);
      };

      window.addEventListener('resize', onChange, { passive: true });
      window.addEventListener('orientationchange', onChange, { passive: true });
    })();

    // ★ 初期描画完了フラグ
    initialized = true;

    // ⑨ キャンペーン情報を遅延読み込みしてバナーを表示（非同期）
    // requestIdleCallback が使える場合はアイドル時に、なければ少し遅延させて実行する
    const loadCampaignInfo = async () => {
      try {
        const res = await apiCampaignTags();
        const tags = (res && res.ok && Array.isArray(res.tags)) ? res.tags : [];
        window.__campaignTagSet = new Set((tags || []).map(t => String(t).trim()).filter(Boolean));
      } catch (e) {
        console.warn('campaignTags load failed', e);
        window.__campaignTagSet = new Set();
      }
      try {
        await renderCampaignBanner();
      } catch (e) {
        console.warn('campaign banner error', e);
      }
      refreshCampaignTagChips_();// タグチップ更新
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(loadCampaignInfo, { timeout: 3000 });
    } else {
      setTimeout(loadCampaignInfo, 300);
    }
  }

  // DOMReady
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    init,
    applySortAndRerenderList,

    // ★ マイ投稿を今のページで再読み込み
    reloadMine: async () => {
      const p = state.mine.page || 1;
      await loadMinePage(p);
    },

    // （任意）外からページ指定して読みたいなら
    loadMinePage,
  };
})();

// グローバル公開
window.DeckPostApp = DeckPostApp;


// =========================
// DeckPost API（グローバル）
// =========================
async function gasPostDeckPost_(payload){
  const base = window.DECKPOST_API_BASE || window.GAS_API_BASE || '';
  if (!base) return { ok:false, error:'api base not set' };

  const mode = String(payload?.mode || 'post');
  const url  = base + '?mode=' + encodeURIComponent(mode);

  try{
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload || {})
    });
    const json = await res.json().catch(()=>null);
    return json || { ok:false, error:'invalid response' };
  }catch(_){
    return { ok:false, error:'network' };
  }
}

window.updateDeckNote_ = async (postId, deckNote) => {
  const token = (window.Auth && window.Auth.token) || '';
  if (!token) return { ok:false, error:'auth required' };

  return await gasPostDeckPost_({
    mode: 'update',
    token,
    postId: String(postId || '').trim(),
    deckNote: String(deckNote || '')
  });
};

window.deletePost_ = async (postId) => {
  const token = (window.Auth && window.Auth.token) || '';
  if (!token) return { ok:false, error:'auth required' };

  return await gasPostDeckPost_({
    mode: 'delete',
    token,
    postId: String(postId || '').trim()
  });
};


/*-----------------------
デッキ編集＆削除機能
------------------------*/

// =========================
// 削除確認モーダル（JS生成）
// =========================
function ensureDeleteConfirmModal_(){
  if (document.getElementById('deleteConfirmModal')) return;

  const wrap = document.createElement('div');
  wrap.id = 'deleteConfirmModal';
  wrap.className = 'account-modal';
  wrap.style.display = 'none';

  wrap.innerHTML = `
    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="deleteConfirmTitle">
      <div class="account-modal-head">
        <h3 id="deleteConfirmTitle">投稿の削除確認</h3>
        <button type="button" class="account-close" data-close="deleteConfirmModal" aria-label="閉じる">×</button>
      </div>

      <div class="account-modal-body">
        <p id="deleteConfirmText" style="margin:0; line-height:1.6;"></p>
        <p style="margin:.6rem 0 0; color:#b00020; font-weight:700;">
          ※ 削除すると元に戻せません
        </p>
      </div>

      <div class="account-modal-footer">
        <button type="button" class="btn ghost" data-delete-cancel>キャンセル</button>
        <button type="button" class="btn danger" data-delete-ok>削除する</button>
      </div>
    </div>
  `;

  // 背景クリックで閉じる
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) closeDeleteModal_();
  });

  document.body.appendChild(wrap);

  // ×ボタン / キャンセルは共通で閉じる（OKは Promise 側で処理）
  wrap.querySelector('[data-close="deleteConfirmModal"]')?.addEventListener('click', closeDeleteModal_);
  wrap.querySelector('[data-delete-cancel]')?.addEventListener('click', closeDeleteModal_);
}

function openDeleteModal_(text){
  ensureDeleteConfirmModal_();
  const m = document.getElementById('deleteConfirmModal');
  const t = document.getElementById('deleteConfirmText');
  if (t) t.textContent = String(text || '');
  if (m) m.style.display = 'flex';
}

function closeDeleteModal_(){
  const m = document.getElementById('deleteConfirmModal');
  if (m) m.style.display = 'none';
}

// 「削除する / キャンセル」を Promise で待つ
function confirmDeleteByModal_(text){
  ensureDeleteConfirmModal_();
  openDeleteModal_(text);

  return new Promise((resolve) => {
    const m = document.getElementById('deleteConfirmModal');
    const okBtn = m.querySelector('[data-delete-ok]');
    const cancelBtn = m.querySelector('[data-delete-cancel]');
    const closeBtn = m.querySelector('[data-close="deleteConfirmModal"]');

    const cleanup = () => {
      okBtn?.removeEventListener('click', onOk);
      cancelBtn?.removeEventListener('click', onCancel);
      closeBtn?.removeEventListener('click', onCancel);
      closeDeleteModal_();
    };

    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };

    okBtn?.addEventListener('click', onOk);
    cancelBtn?.addEventListener('click', onCancel);
    closeBtn?.addEventListener('click', onCancel);
  });
}


// ===== 汎用トースト（削除/保存など）=====
function showActionToast(message){
  let toast = document.getElementById('action-toast');
  if (!toast){
    toast = document.createElement('div');
    toast.id = 'action-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = String(message || '');

  toast.classList.add('is-visible');
  if (toast._timer) clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 1800);
}
