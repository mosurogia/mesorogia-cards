/**
 * js/pages/deck-post/deck-post-filter.js
 * - 投稿一覧フィルター
 * - タグ / ユーザータグ / 投稿者 / カード条件 / 共有リンク
 * - フィルターモーダル管理
 * - カード選択モーダル（旧 deck-post-cardpick.js 統合）
 */
(function () {
  'use strict';

    const extractDeckMap = (...args) => window.DeckPostDetail?.extractDeckMap?.(...args);
    const RICH_DECK_NOTE_MIN_LENGTH = 500;
    const CONTENT_FILTER_LABELS = {
      hasCardNotes: 'カード解説あり',
      richDeckNote: `デッキ解説豊富（${RICH_DECK_NOTE_MIN_LENGTH}文字以上）`,
    };

  // =========================
  // 1) キャンペーン判定系
  // =========================

  /** キャンペーンタグ判定 */
  function isCampaignTag_(t) {
    try {
      const set = window.__campaignTagSet;
      if (!(set instanceof Set)) return false;
      return set.has(String(t || '').trim());
    } catch (_) {
      return false;
    }
  }

  /** 表示してよいキャンペーンタグか */
  function allowCampaignTag_(t) {
    const running = !!window.__isCampaignRunning;
    const active = String(window.__activeCampaignTag || '').trim();
    if (!running || !active) return false;
    return String(t || '').trim() === active;
  }

  /** タグ表示条件 */
  function shouldShowTag_(tag) {
    const t = String(tag || '').trim();
    if (!t) return false;
    return !/[\[\]［］]/.test(t);
  }

  /** ユーザータグ検索用の正規化 */
  function normalizeUserTagSearch_(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }

  /** キャンペーンタグのCSS */
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


  // =========================
  // 2) タグ表示HTML系
  // =========================

  /** タグチップ生成（自動/選択タグ） */
  function tagChipsMain(tagsAuto, tagsPick){
  const s = [tagsAuto, tagsPick].filter(Boolean).join(',');
  if (!s) return '';

  const set = window.__campaignTagSet;
  const isCamp = (t)=> (set instanceof Set) && set.size && set.has(t);

  const arr = s.split(',')
    .map(x => x.trim())
    .filter(shouldShowTag_);

  // ✅ キャンペーンタグを末尾に寄せる（相対順は維持）
  const normal = arr.filter(t => !isCamp(t));
  const camp   = arr.filter(t =>  isCamp(t));
  const ordered = [...normal, ...camp];

  return ordered
    .map(x => `<span class="chip ${campaignTagClass_(x)}">${escapeHtml(x)}</span>`)
    .join('');
}

  /** タグチップ生成（ユーザータグ） */
  function tagChipsUser(tagsUser){
  const s = String(tagsUser || '');
  if (!s) return '';
  const quickFilterAttrs = quickFilterReady_()
    ? 'data-ready="1"'
    : 'disabled aria-disabled="true" data-ready="0" title="フィルター準備中です。全投稿の読み込み完了後に使えます。"';

  return s.split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .filter(tag => shouldShowTag_(tag))
    .map(tag => `
      <span class="chip">
        <span class="chip-label">${escapeHtml(tag)}</span>
        <button type="button"
          class="chip-search-btn btn-user-tag-search"
          data-utag="${escapeHtml(tag)}"
          ${quickFilterAttrs}
          aria-label="このユーザータグで絞り込み">🔎</button>
      </span>
    `)
    .join('');
}

  function quickFilterReady_() {
    const list = window.__DeckPostState?.list;
    const openBtn = document.getElementById('filterBtn');
    return !!list?.hasAllItems || openBtn?.dataset.ready === '1';
  }

  function showQuickFilterPreparing_() {
    window.showActionToast?.('フィルター準備中です。全投稿の読み込み完了後に使えます。');
  }

  /*　キャンペーンタグの状態更新*/
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


  // =========================
  // 3) タグ候補生成
  // =========================

  /** 投稿stateから全タグ取得 */
  function getAllPostTagsFromState_() {
    const items =
      window.__DeckPostState?.list?.allItems ||
      window.__DeckPostState?.list?.filteredItems ||
      [];

    const set = new Set();

    (items || []).forEach((it) => {
      const all = [it?.tagsAuto, it?.tagsPick].filter(Boolean).join(',');
      if (!all) return;

      all
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((t) => {
          if (isCampaignTag_(t) && !allowCampaignTag_(t)) return;
          set.add(t);
        });
    });

    (window.POST_TAG_CANDIDATES || []).forEach((t) => {
      if (isCampaignTag_(t) && !allowCampaignTag_(t)) return;
      set.add(t);
    });
    (window.RACE_ORDER || []).forEach((t) => set.add(t));
    (window.CATEGORY_LIST || []).forEach((t) => set.add(t));

    try {
      const active = String(window.__activeCampaignTag || '').trim();
      if (active && allowCampaignTag_(active)) set.add(active);
    } catch (_) {}

    return Array.from(set);
  }

  /** 終了済みキャンペーンタグ取得 */
  function getEndedCampaignTags_() {
    const set = window.__campaignTagSet;
    if (!(set instanceof Set) || !set.size) return [];

    const active = String(window.__activeCampaignTag || '').trim();
    const running = !!window.__isCampaignRunning;

    return Array.from(set)
      .map((t) => String(t || '').trim())
      .filter(shouldShowTag_)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .filter((t) => !(running && active && t === active));
  }

  /** タグ分類（race / category / deckinfo） */
  function classifyTag_(t) {
    const s = String(t || '').trim();
    if (!s) return 'other';

    if ((window.RACE_ORDER || []).includes(s)) return 'race';

    const isCat =
      typeof window.getCategoryOrder === 'function'
        ? window.getCategoryOrder(s) < 9999
        : (window.CATEGORY_LIST || []).includes(s);

    if (isCat) return 'category';

    return 'deckinfo';
  }

  /** タグ並び替え */
  function sortTags_(tags, kind) {
    const arr = (tags || []).map((s) => String(s || '').trim()).filter(Boolean);

    if (kind === 'race') {
      const order = window.RACE_ORDER || [];
      return arr.sort((a, b) => {
        const ai = order.indexOf(a);
        const bi = order.indexOf(b);
        return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
      });
    }

    if (kind === 'category') {
      if (typeof window.getCategoryOrder === 'function') {
        return arr.sort((a, b) => window.getCategoryOrder(a) - window.getCategoryOrder(b));
      }

      const order = window.CATEGORY_LIST || [];
      return arr.sort((a, b) => {
        const ai = order.indexOf(a);
        const bi = order.indexOf(b);
        return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
      });
    }

    const cand = window.POST_TAG_CANDIDATES || [];
    const candSet = new Set(cand);

    const head = cand.filter((t) => arr.includes(t));
    const tail = arr.filter((t) => !candSet.has(t)).sort((a, b) => a.localeCompare(b, 'ja'));

    const isCamp = (t) => {
      const set = window.__campaignTagSet;
      return (set instanceof Set) && set.size && set.has(t);
    };

    const tailNormal = tail.filter((t) => !isCamp(t));
    const tailCamp = tail.filter((t) => isCamp(t));

    const out = [];
    for (const t of [...head, ...tailNormal, ...tailCamp]) {
      if (!out.includes(t)) out.push(t);
    }
    return out;
  }

  // =========================
  // 4) タグUI（最小単位）
  // =========================

  /** タグボタン描画 */
  function renderTagButtons_(rootEl, tags) {
    if (!rootEl) return;
    rootEl.replaceChildren();

    const sel = window.PostFilterDraft?.selectedTags;

    (tags || []).forEach((tag) => {
      const t = String(tag || '').trim();
      if (!t) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-btn post-filter-tag-btn';
      btn.dataset.tag = t;

      const kind = classifyTag_(t);
      if (kind === 'race') {
        btn.classList.add('is-ring');
        btn.dataset.race = t;
      } else if (kind === 'category') {
        btn.classList.add('is-ring');
        const r = typeof window.getCategoryRace === 'function'
          ? window.getCategoryRace(t)
          : null;
        btn.dataset.catRace = r || 'none';
      }

      try {
        const ccls = typeof window.DeckPostFilter?.campaignTagClass === 'function'
          ? window.DeckPostFilter.campaignTagClass(t)
          : '';
        if (ccls) btn.classList.add(...ccls.split(/\s+/).filter(Boolean));
      } catch (_) {}

      if (kind === 'category' && t.includes('（')) {
        btn.innerHTML = t.replace('（', '<br>（');
      } else {
        btn.textContent = t;
      }

      if (sel?.has(t)) btn.classList.add('selected');

      btn.addEventListener('click', () => {
        const draft = window.PostFilterDraft;
        draft.selectedTags ??= new Set();

        if (draft.selectedTags.has(t)) {
          draft.selectedTags.delete(t);
          btn.classList.remove('selected');
        } else {
          draft.selectedTags.add(t);
          btn.classList.add('selected');
        }
      });

      rootEl.appendChild(btn);
    });
  }

  /** タグUI構築（メイン） */
  function buildPostFilterTagUI_() {
    const all = getAllPostTagsFromState_();
    const deckinfo = [];
    const race = [];
    const category = [];

    all.forEach((t) => {
      if (!shouldShowTag_(t)) return;

      const k = classifyTag_(t);
      if (k === 'race') race.push(t);
      else if (k === 'category') category.push(t);
      else if (k === 'deckinfo') deckinfo.push(t);
    });

    const deckEl = document.getElementById('postFilterDeckInfoArea');
    const raceEl = document.getElementById('postFilterRaceArea');
    const catEl = document.getElementById('postFilterCategoryArea');
    const campaignSection = document.getElementById('postFilterCampaignSection');
    const campaignEl = document.getElementById('postFilterCampaignArea');
    const endedCampaigns = getEndedCampaignTags_();

    renderTagButtons_(deckEl, sortTags_(deckinfo, 'deckinfo'));
    renderTagButtons_(raceEl, sortTags_(race, 'race'));
    renderTagButtons_(catEl, sortTags_(category, 'category'));
    renderTagButtons_(campaignEl, endedCampaigns);

    if (campaignSection) {
      campaignSection.style.display = endedCampaigns.length ? '' : 'none';
    }

    renderEnvironmentFilterUI_();
  }

  // =========================
  // 4.5) 環境フィルター
  // =========================

  const ENVIRONMENTS_JSON_URL = './public/environments.json';
  let environmentCatalogPromise_ = null;
  let environmentCatalog_ = [];

  function normalizeYmd_(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const direct = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (direct) {
      return `${direct[1]}-${String(direct[2]).padStart(2, '0')}-${String(direct[3]).padStart(2, '0')}`;
    }

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function ymdToTime_(value) {
    const ymd = normalizeYmd_(value);
    if (!ymd) return 0;
    const time = Date.parse(`${ymd}T00:00:00`);
    return Number.isNaN(time) ? 0 : time;
  }

  function normalizeEnvironmentRow_(row) {
    const envId = String(row?.env_id || row?.envId || row?.id || '').trim();
    const label = String(row?.label || row?.name || envId || '').trim();
    const startAt = normalizeYmd_(row?.start_at || row?.startAt);
    const endAt = normalizeYmd_(row?.end_at || row?.endAt);
    if (!envId || !label || !startAt) return null;

    return {
      envId,
      label,
      startAt,
      endAt,
      kind: String(row?.kind || '').trim(),
      note: String(row?.note || '').trim(),
    };
  }

  function completeEnvironmentRanges_(rows) {
    const list = (rows || [])
      .map(normalizeEnvironmentRow_)
      .filter(Boolean)
      .sort((a, b) => ymdToTime_(a.startAt) - ymdToTime_(b.startAt));

    return list.map((env, index) => {
      if (env.endAt) return env;

      const next = list[index + 1];
      if (!next) return env;

      const nextStart = ymdToTime_(next.startAt);
      if (!nextStart) return env;

      const end = new Date(nextStart - 24 * 60 * 60 * 1000);
      return {
        ...env,
        endAt: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
      };
    });
  }

  function loadEnvironmentCatalog_() {
    if (environmentCatalogPromise_) return environmentCatalogPromise_;

    environmentCatalogPromise_ = fetch(ENVIRONMENTS_JSON_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`environment json ${res.status}`);
        return res.json();
      })
      .then((json) => {
        const raw = Array.isArray(json) ? json : (json?.environments || []);
        environmentCatalog_ = completeEnvironmentRanges_(raw);
        return environmentCatalog_;
      })
      .catch((err) => {
        console.warn('[deck-post] environments.json 読み込み失敗:', err);
        environmentCatalog_ = [];
        return [];
      });

    return environmentCatalogPromise_;
  }

  function getEnvironmentById_(envId) {
    const id = String(envId || '').trim();
    return environmentCatalog_.find((env) => env.envId === id) || null;
  }

  function getPostJudgeYmd_(item) {
    return normalizeYmd_(item?.createdAt || item?.created_at || item?.updatedAt || item?.updated_at || '');
  }

  function isPostInEnvironment_(item, env) {
    const postTime = ymdToTime_(getPostJudgeYmd_(item));
    const startTime = ymdToTime_(env?.startAt);
    if (!postTime || !startTime) return false;

    const endTime = ymdToTime_(env?.endAt);
    if (postTime < startTime) return false;
    return !endTime || postTime <= endTime;
  }

  function renderEnvironmentButtons_(envs) {
    const section = document.getElementById('postFilterEnvironmentSection');
    const root = document.getElementById('postFilterEnvironmentArea');
    if (!section || !root) return;

    const list = Array.isArray(envs) ? envs : [];
    section.style.display = list.length ? '' : 'none';
    root.replaceChildren();
    if (!list.length) return;

    const selected = window.PostFilterDraft?.selectedEnvironmentIds;
    list.slice().reverse().forEach((env) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-btn post-filter-env-btn';
      btn.dataset.envId = env.envId;
      btn.textContent = env.label;
      if (selected?.has(env.envId)) btn.classList.add('selected');

      btn.addEventListener('click', () => {
        const draft = window.PostFilterDraft;
        draft.selectedEnvironmentIds ??= new Set();

        if (draft.selectedEnvironmentIds.has(env.envId)) {
          draft.selectedEnvironmentIds.delete(env.envId);
          btn.classList.remove('selected');
        } else {
          draft.selectedEnvironmentIds.add(env.envId);
          btn.classList.add('selected');
        }
      });

      root.appendChild(btn);
    });
  }

  function renderEnvironmentFilterUI_() {
    loadEnvironmentCatalog_().then(renderEnvironmentButtons_);
  }

  // =========================
  // 5) フィルター状態
  // =========================

  /** 適用済みフィルター */
  window.PostFilterState ??= {
    selectedTags: new Set(),
    selectedUserTags: new Set(),
    selectedEnvironmentIds: new Set(),
    selectedContentFilters: new Set(),
    selectedPosterKey: '',
    selectedPosterLabel: '',
    selectedCardCds: new Set(),
    selectedFilterMode: 'or',
    selectedPostId: '',
    selectedPostLabel: '',
  };

  /** モーダル編集中のフィルター */
  window.PostFilterDraft ??= {
    selectedTags: new Set(),
    selectedUserTags: new Set(),
    selectedEnvironmentIds: new Set(),
    selectedContentFilters: new Set(),
    selectedPosterKey: '',
    selectedPosterLabel: '',
    selectedCardCds: new Set(),
    selectedFilterMode: 'or',
    selectedPostId: '',
    selectedPostLabel: '',
  };

  window.PostFilterState.selectedEnvironmentIds ??= new Set();
  window.PostFilterDraft.selectedEnvironmentIds ??= new Set();
  window.PostFilterState.selectedContentFilters ??= new Set();
  window.PostFilterDraft.selectedContentFilters ??= new Set();

  /** state → draft 同期 */
  function syncDraftFromApplied_() {
    const applied = window.PostFilterState;
    const draft = window.PostFilterDraft;

    draft.selectedTags = new Set(Array.from(applied?.selectedTags || []));
    draft.selectedUserTags = new Set(Array.from(applied?.selectedUserTags || []));
    draft.selectedEnvironmentIds = new Set(Array.from(applied?.selectedEnvironmentIds || []));
    draft.selectedContentFilters = new Set(Array.from(applied?.selectedContentFilters || []));
    draft.selectedPosterKey = String(applied?.selectedPosterKey || '');
    draft.selectedPosterLabel = String(applied?.selectedPosterLabel || '');
    draft.selectedCardCds = new Set(Array.from(applied?.selectedCardCds || []));
    draft.selectedFilterMode = String(applied?.selectedFilterMode || applied?.selectedCardMode || 'or');
    draft.selectedPostId = String(applied?.selectedPostId || '');
    draft.selectedPostLabel = String(applied?.selectedPostLabel || '');
  }

  /** 全体タグ検索モード */
  function getFilterMatchMode_(source = window.PostFilterState) {
    const mode = String(source?.selectedFilterMode || source?.selectedCardMode || 'or').toLowerCase();
    return mode === 'and' ? 'and' : 'or';
  }

  /** 適用中チップ左側の OR/AND 表示を更新 */
  function wireActiveMatchModeChip_() {
      const bar = document.getElementById('active-chips-bar');
      const count = bar?.querySelector('.chips-left .chips-count');
      if (!count) return;

      const mode = getFilterMatchMode_(window.PostFilterState);
      count.innerHTML = `
        <span class="match-chip-label">タグ検索</span>
        <span class="match-chip-mode ${mode}">
          ${mode.toUpperCase()}
        </span>
      `;

      count.classList.add('post-filter-match-chip');
      count.setAttribute('role', 'button');
      count.setAttribute('tabindex', '0');
      count.setAttribute('aria-label', `タグ検索を${mode === 'and' ? 'OR' : 'AND'}に切り替え`);
      count.setAttribute('aria-pressed', mode === 'and' ? 'true' : 'false');

      if (count.dataset.wiredPostFilterMatchMode === '1') return;
      count.dataset.wiredPostFilterMatchMode = '1';

      const toggle = async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const next = getFilterMatchMode_(window.PostFilterState) === 'and' ? 'or' : 'and';
          window.PostFilterState.selectedFilterMode = next;
          window.PostFilterDraft.selectedFilterMode = next;

          window.__renderFilterModeToggle_?.();
          window.DeckPostFilter?.updateActiveChipsBar?.();
          await window.DeckPostList?.applySortAndRerenderList?.(false);
      };

      count.addEventListener('click', toggle);
      count.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          toggle(e);
      });
  }

  // =========================
  // 6) 適用中チップ表示
  // =========================

  /** 適用中フィルターチップ更新 */
  function updateActiveChipsBar_() {
      const FilterChipBar = window.FilterChipBar;
      if (!FilterChipBar?.render) return;

      const st = window.PostFilterState || {};
      const tags = Array.from(st.selectedTags || []);
      const user = Array.from(st.selectedUserTags || []);
      const envIds = Array.from(st.selectedEnvironmentIds || []);
      const contentFilters = Array.from(st.selectedContentFilters || []);
      const posterLabel = String(st.selectedPosterLabel || '').trim();
      const postLabel = String(st.selectedPostLabel || '').trim();
      const postId = String(st.selectedPostId || '').trim();
      const cards = Array.from(st.selectedCardCds || []);

      const chips = [];

      tags.forEach((t) => {
          chips.push({
              label: `🏷️${t}`,
              className: 'chip-tag',
              onRemove: () => {
                  window.PostFilterState.selectedTags?.delete?.(t);
                  window.PostFilterDraft?.selectedTags?.delete?.(t);

                  try {
                      document
                          .querySelectorAll(`.post-filter-tag-btn[data-tag="${CSS.escape(t)}"]`)
                          .forEach((btn) => btn.classList.remove('selected'));
                  } catch (_) {}

                  window.DeckPostFilter?.updateActiveChipsBar?.();
                  window.DeckPostList?.applySortAndRerenderList?.(false);
              }
          });
      });

      user.forEach((t) => {
          chips.push({
              label: `✍️${t}`,
              className: 'chip-user',
              onRemove: () => {
                  window.PostFilterState.selectedUserTags?.delete?.(t);
                  window.PostFilterDraft?.selectedUserTags?.delete?.(t);

                  try {
                      window.__renderSelectedUserTags_?.();
                  } catch (_) {}

                  window.DeckPostFilter?.updateActiveChipsBar?.();
                  window.DeckPostList?.applySortAndRerenderList?.(false);
              }
          });
      });

      envIds.forEach((envId) => {
          const env = getEnvironmentById_(envId);
          const label = env?.label || envId;
          chips.push({
              label: `環境:${label}`,
              className: 'chip-environment',
              onRemove: () => {
                  window.PostFilterState.selectedEnvironmentIds?.delete?.(envId);
                  window.PostFilterDraft?.selectedEnvironmentIds?.delete?.(envId);

                  try {
                      document
                          .querySelectorAll(`.post-filter-env-btn[data-env-id="${CSS.escape(envId)}"]`)
                          .forEach((btn) => btn.classList.remove('selected'));
                  } catch (_) {}

                  window.DeckPostFilter?.updateActiveChipsBar?.();
                  window.DeckPostList?.applySortAndRerenderList?.(false);
              }
          });
      });

      contentFilters.forEach((key) => {
          const label = CONTENT_FILTER_LABELS[key] || key;
          chips.push({
              label: `投稿内容:${label}`,
              className: 'chip-content',
              onRemove: () => {
                  window.PostFilterState.selectedContentFilters?.delete?.(key);
                  window.PostFilterDraft?.selectedContentFilters?.delete?.(key);

                  try {
                      document
                          .querySelectorAll(`.post-filter-content-btn[data-content-filter="${CSS.escape(key)}"]`)
                          .forEach((btn) => btn.classList.remove('selected'));
                      window.__renderContentFilterButtons_?.();
                  } catch (_) {}

                  window.DeckPostFilter?.updateActiveChipsBar?.();
                  window.DeckPostList?.applySortAndRerenderList?.(false);
              }
          });
      });

      if (posterLabel) {
          chips.push({
              label: `投稿者:${posterLabel}`,
              className: 'is-poster',
              onRemove: () => {
                  window.PostFilterState.selectedPosterKey = '';
                  window.PostFilterState.selectedPosterLabel = '';
                  window.PostFilterDraft.selectedPosterKey = '';
                  window.PostFilterDraft.selectedPosterLabel = '';

                  window.DeckPostFilter?.updateActiveChipsBar?.();
                  window.DeckPostList?.applySortAndRerenderList?.(false);
              }
          });
      }

      if (cards.length) {
          cards.forEach((cd) => {
              const name = (window.cardMap || window.allCardsMap || {})?.[cd]?.name || cd;

              chips.push({
                  label: `🃏${name}`,
                  className: 'chip-card',
                  onRemove: () => {
                      window.PostFilterState.selectedCardCds?.delete?.(cd);
                      window.PostFilterDraft?.selectedCardCds?.delete?.(cd);

                      try {
                          window.__renderSelectedCards_?.();
                      } catch (_) {}

                      window.DeckPostFilter?.updateActiveChipsBar?.();
                      window.DeckPostList?.applySortAndRerenderList?.(false);
                  }
              });
          });
      }

      if (postId) {
          chips.push({
              label: `🔗投稿:${postLabel || postId}`,
              className: 'is-post',
              onRemove: () => {
                  window.PostFilterState.selectedPostId = '';
                  window.PostFilterState.selectedPostLabel = '';
                  window.PostFilterDraft.selectedPostId = '';
                  window.PostFilterDraft.selectedPostLabel = '';

                  window.DeckPostFilter?.updateActiveChipsBar?.();
                  window.DeckPostList?.applySortAndRerenderList?.(false);
              }
          });
      }

      const showBar = chips.length > 0;

      FilterChipBar.render({
          rootId: 'active-chips-bar',
          countText: '',
          show: showBar,
          showLeft: showBar,
          chips,
          clearLabel: 'すべて解除',
          onClearAll: () => {
              window.PostFilterState.selectedTags?.clear?.();
              window.PostFilterState.selectedUserTags?.clear?.();
              window.PostFilterState.selectedEnvironmentIds?.clear?.();
              window.PostFilterState.selectedContentFilters?.clear?.();
              window.PostFilterDraft.selectedTags?.clear?.();
              window.PostFilterDraft.selectedUserTags?.clear?.();
              window.PostFilterDraft.selectedEnvironmentIds?.clear?.();
              window.PostFilterDraft.selectedContentFilters?.clear?.();

              window.PostFilterState.selectedPosterKey = '';
              window.PostFilterState.selectedPosterLabel = '';
              window.PostFilterDraft.selectedPosterKey = '';
              window.PostFilterDraft.selectedPosterLabel = '';

              window.PostFilterState.selectedCardCds?.clear?.();
              window.PostFilterDraft.selectedCardCds?.clear?.();
              window.PostFilterState.selectedFilterMode = 'or';
              window.PostFilterDraft.selectedFilterMode = 'or';

              window.PostFilterState.selectedPostId = '';
              window.PostFilterState.selectedPostLabel = '';
              window.PostFilterDraft.selectedPostId = '';
              window.PostFilterDraft.selectedPostLabel = '';

              try {
                  window.__renderSelectedCards_?.();
                  window.__renderContentFilterButtons_?.();
              } catch (_) {}

              try {
                  document.querySelectorAll('.post-filter-tag-btn.selected').forEach((b) => b.classList.remove('selected'));
                  document.querySelectorAll('.post-filter-env-btn.selected').forEach((b) => b.classList.remove('selected'));
                  document.querySelectorAll('.post-filter-content-btn.selected').forEach((b) => b.classList.remove('selected'));
              } catch (_) {}

              try {
                  window.__renderSelectedUserTags_?.();
              } catch (_) {}

              window.DeckPostFilter?.updateActiveChipsBar?.();
              window.DeckPostList?.applySortAndRerenderList?.(false);
          }
      });

      if (showBar) wireActiveMatchModeChip_();
  }

  // =========================
  // 7) 一覧フィルター再構築
  // =========================
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

  /** 投稿タグの選択条件に一致するか */
  function matchesPostTagFilter_(item, tag) {
    const t = String(tag || '').trim();
    if (!t) return false;

    const postTags = new Set(
      [item.tagsAuto, item.tagsPick]
        .filter(Boolean)
        .join(',')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    );

    const kind = classifyTag_(t);

    // 通常タグ
    if (kind === 'deckinfo') {
      return postTags.has(t);
    }

    // 種族
    if (kind === 'race') {
      const raceCandidates = [
        item.race,
        item.mainRace,
        item.deckRace,
        item.raceKey,
      ]
        .map(v => String(v || '').trim())
        .filter(Boolean);

      // raceKey が INN+OLD+DRAGON 形式なら、その中にも含まれるか確認
      if (raceCandidates.some(v => v === t)) return true;
      if (raceCandidates.some(v => v.includes(t))) return true;

      return postTags.has(t);
    }

    // カテゴリ
    if (kind === 'category') {
      const categoryCandidates = [
        item.category,
        item.deckCategory,
      ]
        .map(v => String(v || '').trim())
        .filter(Boolean);

      if (categoryCandidates.includes(t)) return true;
      return postTags.has(t);
    }

    return postTags.has(t);
  }

  /** ユーザータグの選択条件に一致するか */
  function matchesUserTagFilter_(item, tag) {
    const raw = String(item.tagsUser || '');
    if (!raw) return false;

    const selected = normalizeUserTagSearch_(tag);
    if (!selected) return false;

    const tags = raw.split(',')
      .map(t => normalizeUserTagSearch_(t))
      .filter(Boolean);

    return tags.includes(selected);
  }

  /** カードの選択条件に一致するか */
  function matchesCardFilter_(item, cd) {
    const deck = extractDeckMap(item);
    if (!deck) return false;
    return !!deck[String(cd)];
  }

  function parseCardNotesForContentFilter_(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];

    try {
      const parsed = JSON.parse(value.trim());
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function hasCardNotesForContentFilter_(item) {
    const notes = parseCardNotesForContentFilter_(item?.cardNotes);
    if (notes.some((row) => row && (row.cd || row.id || row.cardId || row.text || row.note || row.comment))) {
      return true;
    }

    if (Object.prototype.hasOwnProperty.call(item || {}, 'hasCardNotes')) {
      const v = item.hasCardNotes;
      return v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v) === '1';
    }

    return false;
  }

  function getDeckNoteLengthForContentFilter_(item) {
    const metaLength = Number(item?.deckNoteLength);
    if (Number.isFinite(metaLength) && metaLength >= 0) return metaLength;

    const text = Object.prototype.hasOwnProperty.call(item || {}, 'deckNote')
      ? item.deckNote
      : item?.comment;
    return Array.from(String(text || '').trim()).length;
  }

  function matchesContentFilter_(item, key) {
    if (key === 'hasCardNotes') return hasCardNotesForContentFilter_(item);
    if (key === 'richDeckNote') {
      return getDeckNoteLengthForContentFilter_(item) >= RICH_DECK_NOTE_MIN_LENGTH;
    }
    return false;
  }

  /** 投稿者の選択条件に一致するか */
  function matchesPosterFilter_(item, posterKey, posterName) {
    const key = String(posterKey || '').trim();
    if (key) {
      return window.posterKeyFromItem_(item) === key;
    }

    const name = String(posterName || '').trim();
    if (!name) return false;

    const want = `name:${window.normPosterName_(name)}`;
    if (window.posterKeyFromItem_(item) === want) return true;

    const currentName = String(item.posterName || item.username || '').trim();
    return currentName === name;
  }

// ===== 一覧：フィルタ＆ソート結果を作り直す =====
function rebuildFilteredItems(){
  const state =
    window.DeckPostState?.getState?.() ||
    window.__DeckPostState ||
    null;

  if (!state?.list) return [];

  const base = state.list.allItems || [];
  const sortKey = state.list.sortKey || 'new';

  let filtered = base.slice();

  // ★ 投稿フィルター（タグ） — window.PostFilterState を見る
  const fs = window.PostFilterState;

  // ① タグ系フィルター（全体 OR/AND）
  const matchMode = String(fs?.selectedFilterMode || fs?.selectedCardMode || 'or');
  const tagConditions = [];

  const selectedEnvIds = Array.from(fs?.selectedEnvironmentIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);

  selectedEnvIds
    .map(getEnvironmentById_)
    .filter(Boolean)
    .forEach((env) => {
      tagConditions.push((item) => isPostInEnvironment_(item, env));
    });

  Array.from(fs?.selectedTags || [])
    .map(s => String(s).trim())
    .filter(Boolean)
    .forEach((tag) => {
      tagConditions.push((item) => matchesPostTagFilter_(item, tag));
    });

  Array.from(fs?.selectedUserTags || [])
    .map(s => String(s).trim())
    .filter(Boolean)
    .forEach((tag) => {
      tagConditions.push((item) => matchesUserTagFilter_(item, tag));
    });

  Array.from(fs?.selectedCardCds || [])
    .map(cd => String(cd).trim())
    .filter(Boolean)
    .forEach((cd) => {
      tagConditions.push((item) => matchesCardFilter_(item, cd));
    });

  Array.from(fs?.selectedContentFilters || [])
    .map((key) => String(key || '').trim())
    .filter(Boolean)
    .forEach((key) => {
      tagConditions.push((item) => matchesContentFilter_(item, key));
    });

  const selPosterKey = String(fs?.selectedPosterKey || '').trim();
  const selPosterName = String(fs?.selectedPoster || '').trim();
  if (selPosterKey || selPosterName) {
    tagConditions.push((item) => matchesPosterFilter_(item, selPosterKey, selPosterName));
  }

  if (tagConditions.length) {
    filtered = filtered.filter((item) => {
      if (matchMode === 'and') {
        return tagConditions.every((matches) => matches(item));
      }

      return tagConditions.some((matches) => matches(item));
    });
  }

  // ★ 投稿1件だけ表示（共有リンク用）
  const selPid = String(fs?.selectedPostId || '').trim();
  if (selPid) {
    filtered = filtered.filter(item => String(item.postId || '').trim() === selPid);
  }

  // 並び替え
  filtered = sortItems(filtered, sortKey);

  state.list.filteredItems = filtered;

  const total = filtered.length;
  const pageLimit = Number(window.PAGE_LIMIT || 10);

  state.list.total = total;
  state.list.totalPages = Math.max(
    1,
    Math.ceil(Math.max(total, 1) / pageLimit)
  );

  return filtered;
}

  // =========================
  // 8) フィルター適用 / リセット
  // =========================

  /** フィルター適用（再描画トリガー） */
  async function applyPostFilter_() {
    if (!window.__DeckPostState?.list?.hasAllItems) {
      try {
        await window.DeckPostList?.fetchAllList?.();
      } catch (_) {}
    }

    const draft = window.PostFilterDraft;
    const applied = window.PostFilterState;

    applied.selectedTags = new Set(Array.from(draft?.selectedTags || []));
    applied.selectedUserTags = new Set(Array.from(draft?.selectedUserTags || []));
    applied.selectedEnvironmentIds = new Set(Array.from(draft?.selectedEnvironmentIds || []));
    applied.selectedContentFilters = new Set(Array.from(draft?.selectedContentFilters || []));
    applied.selectedPosterKey = String(draft?.selectedPosterKey || '');
    applied.selectedPosterLabel = String(draft?.selectedPosterLabel || '');
    applied.selectedCardCds = new Set(Array.from(draft?.selectedCardCds || []));
    applied.selectedFilterMode = String(draft?.selectedFilterMode || draft?.selectedCardMode || 'or');
    applied.selectedPostId = String(draft?.selectedPostId || '');
    applied.selectedPostLabel = String(draft?.selectedPostLabel || '');

    window.DeckPostFilter?.closePostFilter?.();
    window.DeckPostFilter?.updateActiveChipsBar?.();
    await window.DeckPostList?.applySortAndRerenderList?.(false);
  }

  /** フィルターリセット */
  function resetDraft_() {
    window.PostFilterDraft ??= {
      selectedTags: new Set(),
      selectedUserTags: new Set(),
      selectedEnvironmentIds: new Set(),
      selectedContentFilters: new Set(),
      selectedPosterKey: '',
      selectedPosterLabel: '',
      selectedCardCds: new Set(),
      selectedFilterMode: 'or',
      selectedPostId: '',
      selectedPostLabel: '',
    };

    window.PostFilterDraft.selectedTags.clear();
    window.PostFilterDraft.selectedUserTags.clear();
    window.PostFilterDraft.selectedEnvironmentIds?.clear?.();
    window.PostFilterDraft.selectedContentFilters?.clear?.();
    window.PostFilterDraft.selectedPosterKey = '';
    window.PostFilterDraft.selectedPosterLabel = '';
    window.PostFilterDraft.selectedPostId = '';
    window.PostFilterDraft.selectedPostLabel = '';
    window.PostFilterDraft.selectedCardCds?.clear?.();
    window.PostFilterDraft.selectedFilterMode = 'or';

    window.__renderSelectedCards_?.();
    window.__renderFilterModeToggle_?.();
    window.__renderContentFilterButtons_?.();

    try {
      document.querySelectorAll('.post-filter-tag-btn.selected').forEach((b) => b.classList.remove('selected'));
      document.querySelectorAll('.post-filter-env-btn.selected').forEach((b) => b.classList.remove('selected'));
      document.querySelectorAll('.post-filter-content-btn.selected').forEach((b) => b.classList.remove('selected'));
    } catch (_) {}

    const q = document.getElementById('userTagQuery');
    if (q) q.value = '';

    try {
      const items = document.querySelector('[data-user-tag-selected-items]');
      const empty = document.querySelector('[data-user-tag-selected-empty]');
      if (items) items.replaceChildren();
      if (empty) empty.style.display = '';
    } catch (_) {}

    try {
      window.__renderSelectedUserTags_?.();
    } catch (_) {}
  }

  /** 共有リンクURLから投稿フィルター適用 */
  function applySharedPostFromUrl_() {
    const sp = new URLSearchParams(location.search);
    const pid = sp.get('pid') || sp.get('post');
    if (!pid) return;

    window.PostFilterState ??= {};
    window.PostFilterDraft ??= {};

    window.PostFilterState.selectedTags?.clear?.();
    window.PostFilterState.selectedUserTags?.clear?.();
    window.PostFilterState.selectedEnvironmentIds?.clear?.();
    window.PostFilterState.selectedCardCds?.clear?.();
    window.PostFilterState.selectedContentFilters?.clear?.();
    window.PostFilterDraft.selectedContentFilters?.clear?.();
    window.PostFilterDraft.selectedEnvironmentIds?.clear?.();
    window.PostFilterState.selectedFilterMode = 'or';
    window.PostFilterDraft.selectedFilterMode = 'or';
    window.PostFilterState.selectedPosterKey = '';
    window.PostFilterState.selectedPosterLabel = '';
    window.PostFilterState.selectedPostId = String(pid);

    let label = '';
    try {
      const items = window.__DeckPostState?.list?.allItems || [];
      const hit = items.find((it) => String(it?.postId || '') === String(pid));
      label = String(hit?.deckName || hit?.title || hit?.name || '').trim();
    } catch (_) {}

    window.PostFilterState.selectedPostLabel = label || '共有リンク';
    window.PostFilterDraft.selectedPostId = window.PostFilterState.selectedPostId;
    window.PostFilterDraft.selectedPostLabel = window.PostFilterState.selectedPostLabel;

    window.DeckPostFilter?.updateActiveChipsBar?.();
  }

  // =========================
  // 9) カード選択モーダル
  //    （旧 deck-post-cardpick.js 統合）
  // =========================

  let cardPickOnPicked_ = null;

  /**
   * カード名検索用インデックスを準備
   * - 共通側に ensureCardNameIndexLoaded があればそれを使う
   * - 無ければ cardMap から簡易生成
   */
  async function ensureCardNameIndexLoaded_() {
    if (typeof window.ensureCardNameIndexLoaded === 'function') {
      return await window.ensureCardNameIndexLoaded();
    }

    await window.ensureCardMapLoaded?.();

    if (!Array.isArray(window.__cardNameIndex)) {
      const map = window.cardMap || {};
      window.__cardNameIndex = Object.values(map).map((card) => ({
        cd5: window.normCd5 ? window.normCd5(card.cd) : String(card.cd || '').padStart(5, '0'),
        name: String(card.name || ''),
      }));
    }

    if (typeof window.searchCardsByName !== 'function') {
      window.searchCardsByName = function searchCardsByName(query, limit = 120) {
        const q = String(query || '').trim().toLowerCase();
        const rows = Array.isArray(window.__cardNameIndex)
          ? window.__cardNameIndex
          : [];

        const filtered = !q
          ? rows
          : rows.filter((row) =>
              String(row.name || '').toLowerCase().includes(q)
            );

        return filtered
          .slice()
          .sort((a, b) => {
            const cdA = window.normCd5 ? window.normCd5(a.cd5 || a.cd) : String(a.cd5 || a.cd || '').padStart(5, '0');
            const cdB = window.normCd5 ? window.normCd5(b.cd5 || b.cd) : String(b.cd5 || b.cd || '').padStart(5, '0');

            const cardA = window.cardMap?.[cdA] || { cd: cdA, type: '', cost: 0, power: 0 };
            const cardB = window.cardMap?.[cdB] || { cd: cdB, type: '', cost: 0, power: 0 };

            return window.compareCards?.(cardA, cardB) || cdA.localeCompare(cdB, 'ja');
          })
          .slice(0, limit);
      };
    }
  }

  /** カード選択モーダル結果描画 */
  function renderCardPickResult_(query) {
    const resultEl = document.getElementById('cardPickResult');
    if (!resultEl) return;

    const q = String(query || '');
    const rows = window.searchCardsByName?.(q, q.trim() ? 120 : 999999) || [];

    if (!rows.length) {
      resultEl.innerHTML = '<div class="card-pick-empty">一致するカードがありません</div>';
      return;
    }

    resultEl.innerHTML = rows.map((row) => {
      const cd5 = window.normCd5 ? window.normCd5(row.cd5 || row.cd) : String(row.cd5 || row.cd || '').padStart(5, '0');

      return `
        <button type="button" class="card-pick-item" data-cd="${cd5}">
          <img
            class="card-pick-img"
            src="img/${cd5}.webp"
            alt=""
            loading="lazy"
            onerror="this.onerror=null;this.src='img/00000.webp';"
          >
        </button>
      `;
    }).join('');
  }

  /**
   * カード選択モーダルを開く
   * - openCardPickModal(fn)
   * - openCardPickModal({ onPicked })
   */
  function openCardPickModal(opts) {
    if (typeof opts === 'function') {
      opts = { onPicked: opts };
    }

    if (typeof window.openCardPickModal === 'function' && window.openCardPickModal !== openCardPickModal) {
      const onPicked = typeof opts?.onPicked === 'function' ? opts.onPicked : null;
      window.openCardPickModal({
        ...opts,
        showDeckActions: opts?.showDeckActions === true,
        onPicked: (picked) => {
          const cd = (picked && typeof picked === 'object') ? picked.cd : picked;
          onPicked?.(cd);
        },
      });
      return;
    }

    cardPickOnPicked_ = typeof opts?.onPicked === 'function'
      ? opts.onPicked
      : null;

    const deckActions = document.querySelector('.card-pick-deck-actions');
    if (deckActions) deckActions.hidden = opts?.showDeckActions !== true;

    const modalEl = document.getElementById('cardPickModal');
    const queryEl = document.getElementById('cardPickQuery');
    const resultEl = document.getElementById('cardPickResult');
    if (!modalEl || !queryEl || !resultEl) return;

    modalEl.style.display = 'flex';
    queryEl.value = '';

    Promise.resolve(ensureCardNameIndexLoaded_()).then(() => {
      renderCardPickResult_('');
    });

    setTimeout(() => queryEl.focus(), 0);
  }

  /** カード選択モーダルを閉じる */
  function closeCardPickModal() {
    const modalEl = document.getElementById('cardPickModal');
    if (modalEl) modalEl.style.display = 'none';

    cardPickOnPicked_ = null;

    const resultEl = document.getElementById('cardPickResult');
    if (resultEl) resultEl.replaceChildren();

    const queryEl = document.getElementById('cardPickQuery');
    if (queryEl) queryEl.value = '';
  }

  // =========================
  // 10) モーダル共通
  // =========================

  /** ジャンプ先と親の details を開く */
  function openFilterJumpDetails_(target) {
    if (!target) return;

    if (target.matches?.('details')) {
      target.open = true;
    }

    let parent = target.parentElement?.closest?.('details');
    while (parent) {
      parent.open = true;
      parent = parent.parentElement?.closest?.('details');
    }
  }

  /** 検索項目ナビに隠れない位置へスクロールする */
  function scrollPostFilterTarget_(modal, target) {
    const scroller = modal.querySelector('.post-filter-modal');
    const overview = modal.querySelector('.post-filter-overview');
    if (!scroller || typeof scroller.scrollTo !== 'function') {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const overviewHeight = overview?.getBoundingClientRect?.().height || 0;
    const top = Math.max(0, targetRect.top - scrollerRect.top + scroller.scrollTop - overviewHeight - 12);
    scroller.scrollTo({ top, behavior: 'smooth' });
  }

  /** 検索項目ナビのジャンプ処理 */
  function bindPostFilterOverviewJump_(modal) {
    if (!modal || modal.dataset.wiredFilterOverviewJump === '1') return;
    modal.dataset.wiredFilterOverviewJump = '1';

    modal.querySelectorAll('.post-filter-overview-chip[data-filter-jump]').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();

        const selector = String(chip.dataset.filterJump || '').trim();
        if (!selector) return;

        const target = modal.querySelector(selector);
        if (!target) return;

        openFilterJumpDetails_(target);

        scrollPostFilterTarget_(modal, target);

        window.setTimeout(() => {
          target.classList.add('is-jump-highlight');
          window.setTimeout(() => target.classList.remove('is-jump-highlight'), 900);
        }, 220);
      });
    });
  }

  /** セクション見出しのヘルプボタン */
  function bindPostFilterHelpButtons_(modal) {
    if (!modal || modal.dataset.wiredFilterHelpButtons === '1') return;
    modal.dataset.wiredFilterHelpButtons = '1';

    modal.querySelectorAll('.filter-help-button').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const section = btn.closest('.filter-details-sub, .filter-details, .filter-section, .filter-block');
        if (!section?.querySelector?.('.filter-help')) return;

        const open = !section.classList.contains('is-help-open');
        section.classList.toggle('is-help-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }

  /** カテゴリタグ表示の開閉 */
  function bindPostFilterCategoryToggle_(modal) {
    if (!modal || modal.dataset.wiredFilterCategoryToggle === '1') return;

    const area = modal.querySelector('#postFilterCategoryArea');
    if (!area) return;

    modal.dataset.wiredFilterCategoryToggle = '1';

    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('#postFilterCategoryToggle');
      if (!btn || !modal.contains(btn)) return;

      e.preventDefault();

      const open = area.hidden;
      area.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? '－カテゴリタグを閉じる' : '＋カテゴリタグを表示';
    });
  }

  /** フィルターモーダルを開く */
  function openPostFilter() {
    const m = document.getElementById('postFilterModal');
    if (m) m.style.display = 'flex';
    renderEnvironmentFilterUI_();
  }

  /** フィルターモーダルを閉じる */
  function closePostFilter() {
    const m = document.getElementById('postFilterModal');
    if (m) m.style.display = 'none';
  }

  window.DeckPostFilter = window.DeckPostFilter || {};
  Object.assign(window.DeckPostFilter, {
    openPostFilter,
    closePostFilter,
    resetDraft: resetDraft_,
    applyPostFilter: applyPostFilter_,
    buildPostFilterTagUI: buildPostFilterTagUI_,
    applySharedPostFromUrl: applySharedPostFromUrl_,
    shouldShowTag: shouldShowTag_,
    normalizeUserTagSearch: normalizeUserTagSearch_,
    syncDraftFromApplied: syncDraftFromApplied_,
    updateActiveChipsBar: updateActiveChipsBar_,
    openCardPickModal,
    closeCardPickModal,
    campaignTagClass: campaignTagClass_,
    refreshCampaignTagChips: refreshCampaignTagChips_,
    tagChipsMain,
    tagChipsUser,
    quickFilterReady: quickFilterReady_,
    rebuildFilteredItems,
  });

  // =========================
  // 互換公開（移植完了後に削除予定）
  // =========================
  //window.openPostFilter = openPostFilter;
  //window.closePostFilter = closePostFilter;
  //window.resetPostFilterDraft_ = resetDraft_;
  //window.applyPostFilter_ = applyPostFilter_;
  //window.buildPostFilterTagUI_ = buildPostFilterTagUI_;
  //window.applySharedPostFromUrl_ = applySharedPostFromUrl_;
  //window.shouldShowTag_ = shouldShowTag_;
  //window.openCardPickModal = openCardPickModal;
  //window.closeCardPickModal = closeCardPickModal;
  //window.campaignTagClass_ = campaignTagClass_;
  //window.refreshCampaignTagChips_ = refreshCampaignTagChips_;
  //window.tagChipsMain = tagChipsMain;
  //window.tagChipsUser = tagChipsUser;
  //window.rebuildFilteredItems = rebuildFilteredItems;

  // =========================
  // 11) 一覧カードからの即時絞り込み
  // =========================

  /** 投稿カード上のユーザータグ / 投稿者クリックで即時絞り込み */
  function bindQuickFilterFromCard_() {
    if (document.documentElement.dataset.deckPostQuickFilterWired === '1') return;
    document.documentElement.dataset.deckPostQuickFilterWired = '1';

    async function ensureAllListForQuickFilter_() {
      if (window.__DeckPostState?.list?.hasAllItems) return;
      try {
        await window.DeckPostList?.fetchAllList?.();
      } catch (err) {
        console.warn('quick filter fetchAllList failed:', err);
      }
    }

    document.addEventListener('click', async (e) => {
      // ===== ユーザータグ🔎：そのタグで絞り込み（最優先で奪う）=====
      const ut = e.target.closest('.btn-user-tag-search');
      if (ut) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (ut.disabled || !quickFilterReady_()) {
          showQuickFilterPreparing_();
          return;
        }

        const tag = String(ut.dataset.utag || '').trim();
        if (tag) {
          window.PostFilterState ??= {};
          window.PostFilterDraft ??= {};

          window.PostFilterState.selectedUserTags = new Set([tag]);
          window.PostFilterDraft.selectedUserTags = new Set([tag]);

          // 他の条件は維持したまま、即時反映
          window.DeckPostFilter?.updateActiveChipsBar?.();
          await ensureAllListForQuickFilter_();
          await window.DeckPostList?.applySortAndRerenderList?.(false);
        }
        return;
      }

      // ===== 投稿者で絞り込み =====
      const btn = e.target.closest('.btn-filter-poster');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (btn.disabled || !quickFilterReady_()) {
          showQuickFilterPreparing_();
          return;
        }

        const label = String(btn.dataset.poster || '').trim();
        const key =
          String(btn.dataset.posterKey || '').trim() ||
          `name:${window.normPosterName_?.(label) || label}`;

        if (!key) return;

        window.PostFilterState ??= {};
        window.PostFilterDraft ??= {};

        window.PostFilterState.selectedPosterKey = key;
        window.PostFilterState.selectedPosterLabel = label;

        // モーダル下書き側も同期
        window.PostFilterDraft.selectedPosterKey = key;
        window.PostFilterDraft.selectedPosterLabel = label;

        window.DeckPostFilter?.updateActiveChipsBar?.();
        await ensureAllListForQuickFilter_();
        await window.DeckPostList?.applySortAndRerenderList?.(false);
        return;
      }
    }, true);
  }

  // =========================
  // 12) ready後のUI配線
  // =========================

  window.onDeckPostReady?.(() => {
    const openBtn = document.getElementById('filterBtn');
    const closeBtn = document.getElementById('postFilterCloseBtn');
    const applyBtn = document.getElementById('postFilterApplyBtn');
    const resetBtn = document.getElementById('postFilterResetBtn');
    const modal = document.getElementById('postFilterModal');

    bindQuickFilterFromCard_();

    // =========================
    // 12-1) ユーザータグ（フィルターモーダル内）
    // =========================
    (function bindUserTagFilterUI_() {
      const qEl = document.getElementById('userTagQuery');
      const suggest = document.querySelector('#userTagSuggest [data-user-tag-items]');
      const sugEmpty = document.querySelector('#userTagSuggest [data-user-tag-empty]');
      const selWrap = document.querySelector('#userTagSelectedArea [data-user-tag-selected-items]');
      const selEmpty = document.querySelector('#userTagSelectedArea [data-user-tag-selected-empty]');
      if (!qEl || !suggest || !selWrap) return;

      function buildUserTagIndex_() {
        const items = window.__DeckPostState?.list?.allItems || [];
        const freq = new Map();

        for (const it of items) {
          const raw = String(it?.tagsUser || '').trim();
          if (!raw) continue;

          const arr = raw.split(',').map((s) => s.trim()).filter(Boolean);
          for (const t of arr) {
            freq.set(t, (freq.get(t) || 0) + 1);
          }
        }
        return freq;
      }

      function getDraftSet_() {
        window.PostFilterDraft ??= { selectedTags: new Set(), selectedUserTags: new Set() };
        if (!(window.PostFilterDraft.selectedUserTags instanceof Set)) {
          window.PostFilterDraft.selectedUserTags = new Set();
        }
        return window.PostFilterDraft.selectedUserTags;
      }

      function renderSelected_() {
        const set = getDraftSet_();
        selWrap.replaceChildren();

        const list = [...set].sort((a, b) => a.localeCompare(b, 'ja'));
        for (const tag of list) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip chip-user-selected';
          chip.dataset.utag = tag;
          chip.textContent = tag;

          const x = document.createElement('span');
          x.textContent = ' ×';
          x.style.opacity = '0.85';
          chip.appendChild(x);

          chip.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            set.delete(tag);
            renderSelected_();
            renderSuggest_(qEl.value);
          });

          selWrap.appendChild(chip);
        }

        if (selEmpty) selEmpty.style.display = list.length ? 'none' : '';
      }

      function renderSuggest_(queryRaw) {
        const freq = buildUserTagIndex_();
        const query = normalizeUserTagSearch_(queryRaw);
        const selected = getDraftSet_();

        suggest.replaceChildren();

        const rows = [...freq.entries()]
          .filter(([t]) => !selected.has(t))
          .filter(([t]) => !query || normalizeUserTagSearch_(t).includes(query))
          .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return a[0].localeCompare(b[0], 'ja');
          })
          .slice(0, 40);

        if (sugEmpty) {
          sugEmpty.textContent = rows.length ? '' : (query ? '候補がありません' : 'ここに候補が出ます');
          sugEmpty.style.display = rows.length ? 'none' : '';
        }

        for (const [tag, count] of rows) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'suggest-item';
          btn.dataset.utag = tag;

          const label = document.createElement('span');
          label.className = 'suggest-item-label';
          label.textContent = tag;

          const countBadge = document.createElement('span');
          countBadge.className = 'c';
          countBadge.textContent = String(count);

          btn.append(label, countBadge);

          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            selected.add(tag);
            qEl.value = '';
            renderSelected_();
            renderSuggest_('');
          });

          suggest.appendChild(btn);
        }
      }

      qEl.addEventListener('input', () => {
        renderSuggest_(qEl.value);
      });

      window.__renderUserTagSuggest_ = renderSuggest_;
      window.__renderSelectedUserTags_ = renderSelected_;

      renderSelected_();
      renderSuggest_('');
    })();

    // =========================
    // 12-2) カード条件UI
    // =========================
    function getCardNameByCd_(cd) {
      const m = window.cardMap || window.allCardsMap || {};
      const c = m?.[cd];
      return String(c?.name || c?.cardName || cd);
    }

    function renderSelectedCards_() {
      const chipsEl = document.getElementById('postFilterCardChips');
      const emptyEl = document.getElementById('postFilterCardEmpty');
      if (!chipsEl || !emptyEl) return;

      const set = window.PostFilterDraft?.selectedCardCds;
      const list = [...(set || [])];

      chipsEl.replaceChildren();

      if (!list.length) {
        emptyEl.style.display = '';
        return;
      }
      emptyEl.style.display = 'none';

      for (const cd of list) {
        const name = getCardNameByCd_(cd);

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip chip-mini chip-card';
        chip.dataset.cd = cd;
        chip.textContent = name;

        const x = document.createElement('span');
        x.textContent = ' ×';
        x.style.opacity = '0.85';
        chip.appendChild(x);

        chip.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.PostFilterDraft?.selectedCardCds?.delete(cd);
          renderSelectedCards_();
        });

        chipsEl.appendChild(chip);
      }
    }

    window.__renderSelectedCards_ = renderSelectedCards_;

    const cardPickBtn = document.getElementById('postFilterCardPickBtn');
    if (cardPickBtn && !cardPickBtn.dataset.wiredCardPick) {
      cardPickBtn.dataset.wiredCardPick = '1';
      cardPickBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        window.DeckPostFilter?.openCardPickModal?.({
          showDeckActions: false,
          onPicked: (cd) => {
            window.PostFilterDraft.selectedCardCds ??= new Set();
            window.PostFilterDraft.selectedCardCds.add(String(cd));
            window.__renderSelectedCards_?.();
          }
        });
      });
    }

    function renderContentFilterButtons_() {
      const selected = window.PostFilterDraft?.selectedContentFilters || new Set();
      document.querySelectorAll('.post-filter-content-btn[data-content-filter]').forEach((btn) => {
        const key = String(btn.dataset.contentFilter || '').trim();
        const active = !!key && selected.has(key);
        btn.classList.toggle('selected', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    window.__renderContentFilterButtons_ = renderContentFilterButtons_;

    document.querySelectorAll('.post-filter-content-btn[data-content-filter]').forEach((btn) => {
      if (btn.dataset.wiredContentFilter === '1') return;
      btn.dataset.wiredContentFilter = '1';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const key = String(btn.dataset.contentFilter || '').trim();
        if (!key) return;

        window.PostFilterDraft.selectedContentFilters ??= new Set();
        if (window.PostFilterDraft.selectedContentFilters.has(key)) {
          window.PostFilterDraft.selectedContentFilters.delete(key);
        } else {
          window.PostFilterDraft.selectedContentFilters.add(key);
        }
        renderContentFilterButtons_();
      });
    });

    const modeOrBtn = document.getElementById('postFilterModeOr');
    const modeAndBtn = document.getElementById('postFilterModeAnd');

    function renderFilterModeToggle_() {
      const mode = String(window.PostFilterDraft?.selectedFilterMode || window.PostFilterDraft?.selectedCardMode || 'or');
      if (modeOrBtn) modeOrBtn.classList.toggle('is-active', mode !== 'and');
      if (modeAndBtn) modeAndBtn.classList.toggle('is-active', mode === 'and');
      modeOrBtn?.setAttribute('aria-pressed', mode !== 'and' ? 'true' : 'false');
      modeAndBtn?.setAttribute('aria-pressed', mode === 'and' ? 'true' : 'false');
    }

    window.__renderFilterModeToggle_ = renderFilterModeToggle_;

    if (modeOrBtn && !modeOrBtn.dataset.wiredFilterMode) {
      modeOrBtn.dataset.wiredFilterMode = '1';
      modeOrBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.PostFilterDraft.selectedFilterMode = 'or';
        renderFilterModeToggle_();
      });
    }

    if (modeAndBtn && !modeAndBtn.dataset.wiredFilterMode) {
      modeAndBtn.dataset.wiredFilterMode = '1';
      modeAndBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.PostFilterDraft.selectedFilterMode = 'and';
        renderFilterModeToggle_();
      });
    }

    // =========================
    // 12-3) カード選択モーダル配線
    // =========================
    const cardPickCloseBtn = document.getElementById('cardPickCloseBtn');
    const cardPickModal = document.getElementById('cardPickModal');
    const cardPickQuery = document.getElementById('cardPickQuery');
    const cardPickResult = document.getElementById('cardPickResult');

    if (cardPickCloseBtn && !cardPickCloseBtn.dataset.wiredCardPickClose) {
      cardPickCloseBtn.dataset.wiredCardPickClose = '1';
      cardPickCloseBtn.addEventListener('click', closeCardPickModal);
    }

    if (cardPickModal && !cardPickModal.dataset.wiredCardPickBackdrop) {
      cardPickModal.dataset.wiredCardPickBackdrop = '1';
      cardPickModal.addEventListener('click', (e) => {
        if (e.target === cardPickModal) {
          closeCardPickModal();
        }
      });
    }

    if (cardPickQuery && !cardPickQuery.dataset.wiredCardPickInput) {
      cardPickQuery.dataset.wiredCardPickInput = '1';
      cardPickQuery.addEventListener('input', () => {
        renderCardPickResult_(cardPickQuery.value);
      });
    }

    if (cardPickResult && !cardPickResult.dataset.wiredCardPickResult) {
      cardPickResult.dataset.wiredCardPickResult = '1';
      cardPickResult.addEventListener('click', (e) => {
        const btn = e.target.closest('.card-pick-item');
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        const cd = String(btn.dataset.cd || '').trim();
        if (!cd) return;

        cardPickOnPicked_?.(cd);
        closeCardPickModal();
      }, true);
    }

    if (!document.body.dataset.wiredCardPickEsc) {
      document.body.dataset.wiredCardPickEsc = '1';
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;

        const cardModalEl = document.getElementById('cardPickModal');
        if (cardModalEl && cardModalEl.style.display !== 'none' && cardModalEl.style.display !== '') {
          closeCardPickModal();
          return;
        }

        const filterModalEl = document.getElementById('postFilterModal');
        if (filterModalEl && filterModalEl.style.display !== 'none' && filterModalEl.style.display !== '') {
          closePostFilter();
        }
      });
    }

    // =========================
    // 12-4) フィルターモーダル開閉 / 適用 / リセット
    // =========================
    if (!modal) return;
    bindPostFilterOverviewJump_(modal);
    bindPostFilterHelpButtons_(modal);
    bindPostFilterCategoryToggle_(modal);

    if (openBtn && !openBtn.dataset.wiredFilterOpen) {
      openBtn.dataset.wiredFilterOpen = '1';
      openBtn.addEventListener('click', async () => {
        const filterReady = !!window.__DeckPostState?.list?.hasAllItems || openBtn.dataset.ready === '1';
        if (!filterReady) {
          window.DeckPostList?.startSlowBackgroundListFetch?.();
          window.showActionToast?.('フィルター準備中です。全投稿の読み込み完了後に開けます。');
          return;
        }

        syncDraftFromApplied_();
        window.__renderSelectedCards_?.();
        window.__renderFilterModeToggle_?.();
        window.__renderContentFilterButtons_?.();
        window.__renderSelectedUserTags_?.();
        window.__renderUserTagSuggest_?.(document.getElementById('userTagQuery')?.value || '');

        buildPostFilterTagUI_();
        window.DeckPostFilter?.updateActiveChipsBar?.();
        openPostFilter();
      });
    }

    if (closeBtn && !closeBtn.dataset.wiredFilterClose) {
      closeBtn.dataset.wiredFilterClose = '1';
      closeBtn.addEventListener('click', closePostFilter);
    }

    if (applyBtn && !applyBtn.dataset.wiredFilterApply) {
      applyBtn.dataset.wiredFilterApply = '1';
      applyBtn.addEventListener('click', () => {
        applyPostFilter_();
      });
    }

    if (resetBtn && !resetBtn.dataset.wiredFilterReset) {
      resetBtn.dataset.wiredFilterReset = '1';
      resetBtn.addEventListener('click', () => {
        resetDraft_();
      });
    }
  });
})();
