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
          aria-label="このユーザータグで絞り込み">🔎</button>
      </span>
    `)
    .join('');
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
    selectedPosterKey: '',
    selectedPosterLabel: '',
    selectedCardCds: new Set(),
    selectedCardMode: 'or',
    selectedPostId: '',
    selectedPostLabel: '',
  };

  /** モーダル編集中のフィルター */
  window.PostFilterDraft ??= {
    selectedTags: new Set(),
    selectedUserTags: new Set(),
    selectedEnvironmentIds: new Set(),
    selectedPosterKey: '',
    selectedPosterLabel: '',
    selectedCardCds: new Set(),
    selectedCardMode: 'or',
    selectedPostId: '',
    selectedPostLabel: '',
  };

  window.PostFilterState.selectedEnvironmentIds ??= new Set();
  window.PostFilterDraft.selectedEnvironmentIds ??= new Set();

  /** state → draft 同期 */
  function syncDraftFromApplied_() {
    const applied = window.PostFilterState;
    const draft = window.PostFilterDraft;

    draft.selectedTags = new Set(Array.from(applied?.selectedTags || []));
    draft.selectedUserTags = new Set(Array.from(applied?.selectedUserTags || []));
    draft.selectedEnvironmentIds = new Set(Array.from(applied?.selectedEnvironmentIds || []));
    draft.selectedPosterKey = String(applied?.selectedPosterKey || '');
    draft.selectedPosterLabel = String(applied?.selectedPosterLabel || '');
    draft.selectedCardCds = new Set(Array.from(applied?.selectedCardCds || []));
    draft.selectedCardMode = String(applied?.selectedCardMode || 'or');
    draft.selectedPostId = String(applied?.selectedPostId || '');
    draft.selectedPostLabel = String(applied?.selectedPostLabel || '');
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
      const posterLabel = String(st.selectedPosterLabel || '').trim();
      const postLabel = String(st.selectedPostLabel || '').trim();
      const postId = String(st.selectedPostId || '').trim();
      const cards = Array.from(st.selectedCardCds || []);
      const cardMode = String(st.selectedCardMode || 'or');

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
          const labelHead = cardMode === 'and' ? 'AND' : 'OR';

          cards.forEach((cd) => {
              const name = (window.cardMap || window.allCardsMap || {})?.[cd]?.name || cd;

              chips.push({
                  label: `🃏${labelHead}:${name}`,
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

      FilterChipBar.render({
          rootId: 'active-chips-bar',
          countText: '',
          show: chips.length > 0,
          showLeft: false,
          chips,
          clearLabel: 'すべて解除',
          onClearAll: () => {
              window.PostFilterState.selectedTags?.clear?.();
              window.PostFilterState.selectedUserTags?.clear?.();
              window.PostFilterState.selectedEnvironmentIds?.clear?.();
              window.PostFilterDraft.selectedTags?.clear?.();
              window.PostFilterDraft.selectedUserTags?.clear?.();
              window.PostFilterDraft.selectedEnvironmentIds?.clear?.();

              window.PostFilterState.selectedPosterKey = '';
              window.PostFilterState.selectedPosterLabel = '';
              window.PostFilterDraft.selectedPosterKey = '';
              window.PostFilterDraft.selectedPosterLabel = '';

              window.PostFilterState.selectedCardCds?.clear?.();
              window.PostFilterDraft.selectedCardCds?.clear?.();
              window.PostFilterState.selectedCardMode = 'or';
              window.PostFilterDraft.selectedCardMode = 'or';

              window.PostFilterState.selectedPostId = '';
              window.PostFilterState.selectedPostLabel = '';
              window.PostFilterDraft.selectedPostId = '';
              window.PostFilterDraft.selectedPostLabel = '';

              try {
                  window.__renderSelectedCards_?.();
              } catch (_) {}

              try {
                  document.querySelectorAll('.post-filter-tag-btn.selected').forEach((b) => b.classList.remove('selected'));
                  document.querySelectorAll('.post-filter-env-btn.selected').forEach((b) => b.classList.remove('selected'));
              } catch (_) {}

              try {
                  window.__renderSelectedUserTags_?.();
              } catch (_) {}

              window.DeckPostFilter?.updateActiveChipsBar?.();
              window.DeckPostList?.applySortAndRerenderList?.(false);
          }
      });
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

  // ① 環境（作成日ベース / 複数選択 OR）
  const selectedEnvIds = Array.from(fs?.selectedEnvironmentIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (selectedEnvIds.length) {
    const selectedEnvs = selectedEnvIds
      .map(getEnvironmentById_)
      .filter(Boolean);

    if (selectedEnvs.length) {
      filtered = filtered.filter((item) =>
        selectedEnvs.some((env) => isPostInEnvironment_(item, env))
      );
    }
  }

  // ★ 投稿1件だけ表示（共有リンク用）
  const selPid = String(fs?.selectedPostId || '').trim();
  if (selPid) {
    filtered = filtered.filter(item => String(item.postId || '').trim() === selPid);
  }

  // ① 投稿タグ（自動＋選択タグ / 種族 / カテゴリ）
  if (fs?.selectedTags?.size) {
    const selected = Array.from(fs.selectedTags)
      .map(s => String(s).trim())
      .filter(Boolean);

    filtered = filtered.filter(item => {
      const postTags = new Set(
        [item.tagsAuto, item.tagsPick]
          .filter(Boolean)
          .join(',')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      );

      return selected.some(tag => {
        const kind = classifyTag_(tag);

        // 通常タグ
        if (kind === 'deckinfo') {
          return postTags.has(tag);
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
          if (raceCandidates.some(v => v === tag)) return true;
          if (raceCandidates.some(v => v.includes(tag))) return true;

          return postTags.has(tag);
        }

        // カテゴリ
        if (kind === 'category') {
          const categoryCandidates = [
            item.category,
            item.deckCategory,
          ]
            .map(v => String(v || '').trim())
            .filter(Boolean);

          if (categoryCandidates.includes(tag)) return true;
          return postTags.has(tag);
        }

        return postTags.has(tag);
      });
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

  // ★ カードで絞り込み（OR/AND）
  const cds = fs?.selectedCardCds; // Set
  if (cds && cds.size){
    const mode = String(fs?.selectedCardMode || 'or'); // 'or' | 'and'

    filtered = filtered.filter(it=>{
      const deck = extractDeckMap(it); // {cd:count}
      if (!deck) return false;

      if (mode === 'and'){
        for (const cd of cds){
          if (!deck[String(cd)]) return false;
        }
        return true;
      }

      // or
      for (const cd of cds){
        if (deck[String(cd)]) return true;
      }
      return false;
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

  // ===== 投稿者フィルタ（キー一致）=====
  const selKey = String(fs?.selectedPosterKey || '').trim();
  if (selKey){
    filtered = filtered.filter(item => window.posterKeyFromItem_(item) === selKey);
  } else {
    // 互換：昔の selectedPoster が残ってる場合
    const selPoster = String(fs?.selectedPoster || '').trim();
    if (selPoster){
      const want = `name:${window.normPosterName_(selPoster)}`;
      filtered = filtered.filter(item => window.posterKeyFromItem_(item) === want);
    }
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
    applied.selectedPosterKey = String(draft?.selectedPosterKey || '');
    applied.selectedPosterLabel = String(draft?.selectedPosterLabel || '');
    applied.selectedCardCds = new Set(Array.from(draft?.selectedCardCds || []));
    applied.selectedCardMode = String(draft?.selectedCardMode || 'or');
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
      selectedPosterKey: '',
      selectedPosterLabel: '',
      selectedCardCds: new Set(),
      selectedCardMode: 'or',
      selectedPostId: '',
      selectedPostLabel: '',
    };

    window.PostFilterDraft.selectedTags.clear();
    window.PostFilterDraft.selectedUserTags.clear();
    window.PostFilterDraft.selectedEnvironmentIds?.clear?.();
    window.PostFilterDraft.selectedPosterKey = '';
    window.PostFilterDraft.selectedPosterLabel = '';
    window.PostFilterDraft.selectedPostId = '';
    window.PostFilterDraft.selectedPostLabel = '';
    window.PostFilterDraft.selectedCardCds?.clear?.();
    window.PostFilterDraft.selectedCardMode = 'or';

    window.__renderSelectedCards_?.();

    try {
      document.querySelectorAll('.post-filter-tag-btn.selected').forEach((b) => b.classList.remove('selected'));
      document.querySelectorAll('.post-filter-env-btn.selected').forEach((b) => b.classList.remove('selected'));
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
    window.PostFilterDraft.selectedEnvironmentIds?.clear?.();
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

  /** details の ▶/▼ 同期 */
  function syncDetailsChevron_(details) {
    if (!details) return;
    const summary = details.querySelector('summary');
    if (!summary) return;

    const raw = summary.textContent || '';
    const txt = raw.replace(/^[▶▼]\s*/, '').trim();
    summary.textContent = `${details.open ? '▼' : '▶'} ${txt}`;
  }

  /** details 群へ toggle 同期を付与 */
  function bindChevronSync_(root) {
    const list = root?.querySelectorAll?.('details') || [];
    list.forEach((d) => {
      syncDetailsChevron_(d);
      d.addEventListener('toggle', () => syncDetailsChevron_(d));
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

    document.addEventListener('click', (e) => {
      // ===== ユーザータグ🔎：そのタグで絞り込み（最優先で奪う）=====
      const ut = e.target.closest('.btn-user-tag-search');
      if (ut) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const tag = String(ut.dataset.utag || '').trim();
        if (tag) {
          window.PostFilterState ??= {};
          window.PostFilterDraft ??= {};

          window.PostFilterState.selectedUserTags = new Set([tag]);
          window.PostFilterDraft.selectedUserTags = new Set([tag]);

          // 他の条件は維持したまま、即時反映
          window.DeckPostFilter?.updateActiveChipsBar?.();
          window.DeckPostList?.applySortAndRerenderList?.(false);
        }
        return;
      }

      // ===== 投稿者で絞り込み =====
      const btn = e.target.closest('.btn-filter-poster');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

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
        window.DeckPostList?.applySortAndRerenderList?.(false);
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
          onPicked: (cd) => {
            window.PostFilterDraft.selectedCardCds ??= new Set();
            window.PostFilterDraft.selectedCardCds.add(String(cd));
            window.__renderSelectedCards_?.();
          }
        });
      });
    }

    const modeOrBtn = document.getElementById('postFilterCardModeOr');
    const modeAndBtn = document.getElementById('postFilterCardModeAnd');

    function renderCardModeToggle_() {
      const mode = String(window.PostFilterDraft?.selectedCardMode || 'or');
      if (modeOrBtn) modeOrBtn.classList.toggle('is-active', mode !== 'and');
      if (modeAndBtn) modeAndBtn.classList.toggle('is-active', mode === 'and');
    }

    window.__renderCardModeToggle_ = renderCardModeToggle_;

    if (modeOrBtn && !modeOrBtn.dataset.wiredCardMode) {
      modeOrBtn.dataset.wiredCardMode = '1';
      modeOrBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.PostFilterDraft.selectedCardMode = 'or';
        renderCardModeToggle_();
      });
    }

    if (modeAndBtn && !modeAndBtn.dataset.wiredCardMode) {
      modeAndBtn.dataset.wiredCardMode = '1';
      modeAndBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.PostFilterDraft.selectedCardMode = 'and';
        renderCardModeToggle_();
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

    if (openBtn && !openBtn.dataset.wiredFilterOpen) {
      openBtn.dataset.wiredFilterOpen = '1';
      openBtn.addEventListener('click', async () => {
        if (!window.__DeckPostState?.list?.hasAllItems) {
          try {
            await window.DeckPostList?.fetchAllList?.();
          } catch (_) {}
        }

        syncDraftFromApplied_();
        window.__renderSelectedCards_?.();
        window.__renderCardModeToggle_?.();
        window.__renderSelectedUserTags_?.();
        window.__renderUserTagSuggest_?.(document.getElementById('userTagQuery')?.value || '');

        buildPostFilterTagUI_();
        window.DeckPostFilter?.updateActiveChipsBar?.();
        bindChevronSync_(modal);
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
