/*==================================================
  FEATURES / POST FILTER（DeckPost 投稿フィルター）
  - deck-post.html の postFilterModal がある時だけ動作
  - 投稿タグ＋ユーザータグのフィルターUIとチップ表示を担当
==================================================*/

// ========================
// DeckPost 投稿フィルター（タグ）
// ========================
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const modal   = document.getElementById('postFilterModal');
        if (!modal) return; // deck-post.html 以外では何もしない

        const btnOpen  = document.getElementById('filterBtn');
        const btnClose = document.getElementById('postFilterCloseBtn');
        const btnApply = document.getElementById('postFilterApplyBtn');
        const btnReset = document.getElementById('postFilterResetBtn');
        const deckInfoArea = document.getElementById('postFilterDeckInfoArea');
        const raceArea     = document.getElementById('postFilterRaceArea');
        const categoryArea = document.getElementById('postFilterCategoryArea');

        // フィルター状態（グローバルに1つ）
        window.PostFilterState = window.PostFilterState || {
        selectedTags: new Set(),
        selectedUserTags: new Set(),    // ★ 追加
        userTagQuery: '',
        };
        const filterState = window.PostFilterState;

        const userTagInput   = document.getElementById('userTagQuery');
        const userTagSuggest = document.getElementById('userTagSuggest');

        // ===== ユーザータグ候補の収集（今ロード済み投稿から）=====
        function collectUserTagsWithCount(){
        const ds = window.__DeckPostState;
        const items = ds?.list?.allItems || [];
        const m = new Map(); // tag -> count

        items.forEach(item => {
            const s = String(item.tagsUser || '').trim();
            if (!s) return;
            s.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
            m.set(t, (m.get(t) || 0) + 1);
            });
        });

        return Array.from(m.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a,b) => (b.count - a.count) || a.tag.localeCompare(b.tag, 'ja'));
        }

        // ===== ユーザータグ候補の描画 =====
        function renderUserTagSuggest(list){
        if (!userTagSuggest) return;

        const emptyEl = userTagSuggest.querySelector('[data-user-tag-empty]');
        const itemsEl = userTagSuggest.querySelector('[data-user-tag-items]');

        // items側だけクリア（emptyは消さない）
        if (itemsEl) itemsEl.innerHTML = '';

        // ★ 候補がない：empty を表示（文言だけ切り替え）
        if (!list.length){
            const q = (userTagInput?.value || '').trim();
            if (emptyEl){
            emptyEl.textContent = q ? '候補がありません' : 'ここに候補が出ます';
            emptyEl.style.display = '';
            }
            return;
        }

        // ★ 候補がある：empty を非表示、items にチップ描画
        if (emptyEl) emptyEl.style.display = 'none';

        const frag = document.createDocumentFragment();
        list.forEach(x => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'suggest-item';
            btn.dataset.tag = x.tag;

            const t = document.createElement('span');
            t.className = 't';
            t.textContent = x.tag;

            const c = document.createElement('span');
            c.className = 'c';
            c.textContent = String(x.count);

            btn.appendChild(t);
            btn.appendChild(c);
            frag.appendChild(btn);
        });

        (itemsEl || userTagSuggest).appendChild(frag);
        }

        let suggestCache = null;
        let suggestTimer = null;

        function normalizeKana(str){
        return str
            .replace(/[ぁ-ゖ]/g, ch =>
            String.fromCharCode(ch.charCodeAt(0) + 0x60)
            )
            .replace(/[ァ-ヶ]/g, ch =>
            String.fromCharCode(ch.charCodeAt(0) - 0x60)
            )
            .toLowerCase();
        }

        // ===== 選択済みユーザータグチップの描画 =====
        function renderSelectedUserTagChips(){
        const wrap = document.getElementById('userTagSelectedArea');
        if (!wrap) return;

        const emptyEl = wrap.querySelector('[data-user-tag-selected-empty]');
        const itemsEl = wrap.querySelector('[data-user-tag-selected-items]');

        // items側だけクリア（emptyは消さない）
        if (itemsEl) itemsEl.innerHTML = '';

        const tags = Array.from(filterState.selectedUserTags || []);

        // ★ 未選択：empty を表示
        if (!tags.length){
            if (emptyEl) emptyEl.style.display = '';
            return;
        }

        // ★ 選択あり：empty を非表示、items にチップ描画
        if (emptyEl) emptyEl.style.display = 'none';

        const frag = document.createDocumentFragment();
        tags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'chip chip-user-selected';
            chip.textContent = tag;

            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'chip-x';
            x.textContent = '×';
            x.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            filterState.selectedUserTags.delete(tag);
            renderSelectedUserTagChips();
            renderActivePostFilterChips?.();
            window.DeckPostApp?.applySortAndRerenderList?.();
            });

            chip.appendChild(x);
            frag.appendChild(chip);
        });

        (itemsEl || wrap).appendChild(frag);
        }

        function updateSuggest(){
        const qRaw = (userTagInput?.value || '').trim();
        if (!qRaw || qRaw.length < 1){
            renderUserTagSuggest([]);
            return;
        }

        const q = normalizeKana(qRaw);

        if (!suggestCache) suggestCache = collectUserTagsWithCount();

        const hit = suggestCache
            .filter(x => normalizeKana(x.tag).includes(q))
            .slice(0, 20);

        renderUserTagSuggest(hit);
        }

        // ===== ユーザータグ入力欄のイベント =====
        userTagInput?.addEventListener('input', () => {
        clearTimeout(suggestTimer);
        suggestTimer = setTimeout(updateSuggest, 80);
        });

        userTagInput?.addEventListener('focus', () => updateSuggest());

        // ===== 候補クリックで選択済みに追加 =====
        userTagSuggest?.addEventListener('click', (e) => {
        const btn = e.target.closest('.suggest-item');
        if (!btn) return;

        const tag = btn.dataset.tag;
        if (!tag) return;

        filterState.selectedUserTags.add(tag);

        userTagInput.value = '';
        renderUserTagSuggest([]);
        renderSelectedUserTagChips();
        });

        // Apply/Reset と同期
        btnReset?.addEventListener('click', () => {
        filterState.userTagQuery = '';
        filterState.selectedUserTags?.clear?.();
        if (userTagInput) userTagInput.value = '';
        renderUserTagSuggest([]);
        renderSelectedUserTagChips();
        });

        // ===== 開催中キャンペーンタグ（なければ空文字）=====
        async function getActiveCampaignTag_(){
        try{
            const running = !!window.__isCampaignRunning;
            const active  = String(window.__activeCampaignTag || '').trim();
            if (running && active) return active;
            if (!running) return '';

            if (typeof window.fetchActiveCampaign !== 'function') return '';
            const camp = await window.fetchActiveCampaign();

            const tag = String(camp?.tag || '').trim();
            if (tag) return tag;

            const rawTitle = String(camp?.title || '').trim();
            if (!rawTitle) return '';
            const cleanTitle = rawTitle
            .replace(/[（(]\s*\d{4}\/\d{1,2}\/\d{1,2}\s*〜\s*\d{4}\/\d{1,2}\/\d{1,2}\s*[)）]\s*/g, '')
            .trim();
            return cleanTitle || '';
        }catch(_){
            return '';
        }
        }

        async function buildTagButtons(){
        const campaignTag = await getActiveCampaignTag_();

        // ===== ここから下は元コードのまま =====
        deckInfoArea.innerHTML = '';
        raceArea.innerHTML = '';
        categoryArea.innerHTML = '';

        // ✅ グローバル依存をローカルに束ねる（ReferenceError回避）
        const ordered       = window.ordered || [];
        const groupBase     = window.groupBase || [];
        const groupAuto     = window.groupAuto || [];
        const groupRace     = window.groupRace || [];
        const groupCategory = window.groupCategory || [];
        const isCategoryTag = (typeof window.isCategoryTag === 'function')
        ? window.isCategoryTag
        : (() => false);

        // ordered / groupBase / groupAuto / groupRace / groupCategory / isCategoryTag
        // は元の deck-post 側（またはグローバル）で定義されている前提
        if (!window.ordered || !window.groupBase || !window.groupAuto || !window.groupRace || !window.groupCategory) {
            // 依存がまだ準備できてない場合でも落ちないように
            // （開くタイミングで deck-post 側が用意しているはず）
        }

        if (!ordered.length) {
        const p = document.createElement('p');
        p.className = 'filter-wip-text';
        p.textContent = 'タグ情報（ordered）が未準備です。読み込み順か定義元を確認してください。';
        deckInfoArea.appendChild(p);
        return;
        }

        function makeSection(titleText){
            const block = document.createElement('div');
            block.className = 'filter-subblock';

            const title = document.createElement('div');
            title.className = 'filter-subtitle';
            title.textContent = titleText;

            const body = document.createElement('div');
            body.className = 'filter-group';

            block.appendChild(title);
            block.appendChild(body);
            return { block, body };
        }

        function makeTagButton(tag){
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'filter-btn post-filter-tag-btn';
            btn.dataset.tag = tag;

            const isCat = isCategoryTag(tag);
            if (isCat && tag.includes('（')) btn.innerHTML = tag.replace('（', '<br>（');
            else btn.textContent = tag;

            if (campaignTag && tag === campaignTag) {
            btn.classList.add('is-campaign-tag');
            btn.textContent = `🎉 ${tag}`;
            }

            if (filterState.selectedTags.has(tag)) btn.classList.add('selected');

            btn.addEventListener('click', () => {
            const nowSelected = btn.classList.toggle('selected');
            if (nowSelected) filterState.selectedTags.add(tag);
            else filterState.selectedTags.delete(tag);
            });

            return btn;
        }

        // ① デッキ情報
        const secInfo = makeSection('▼ デッキ情報');
        [...groupBase, ...groupAuto].forEach(t => secInfo.body.appendChild(makeTagButton(t)));
        if (campaignTag && !groupBase.includes(campaignTag) && !groupAuto.includes(campaignTag)) {
            secInfo.body.appendChild(makeTagButton(campaignTag));
        }

        // ② 種族
        const secRace = makeSection('▼ 種族');
        const raceOrder = Array.isArray(window.RACE_ORDER)
            ? window.RACE_ORDER
            : ['ドラゴン','アンドロイド','エレメンタル','ルミナス','シェイド'];

        groupRace
            .filter(t => raceOrder.includes(t))
            .sort((a,b)=>raceOrder.indexOf(a)-raceOrder.indexOf(b))
            .forEach(t => secRace.body.appendChild(makeTagButton(t)));

        // ③ カテゴリ（折りたたみ）
        const details = document.createElement('details');
        details.className = 'filter-details';
        details.open = false;

        const summary = document.createElement('summary');
        summary.className = 'filter-section-title';
        summary.textContent = '▶ カテゴリ';
        details.appendChild(summary);

        const catWrap = document.createElement('div');
        catWrap.className = 'filter-group';
        groupCategory.forEach(t => catWrap.appendChild(makeTagButton(t)));
        details.appendChild(catWrap);

        deckInfoArea.appendChild(secInfo.block);
        raceArea.appendChild(secRace.block);
        categoryArea.appendChild(details);
        }

        // ---- 開閉まわり ----
        async function openModal() {
        await buildTagButtons();
        renderUserTagSuggest([]);
        renderSelectedUserTagChips();
        modal.style.display = 'flex';
        }
        function closeModal() {
        modal.style.display = 'none';
        }

        btnOpen?.addEventListener('click', (e) => {
        e.preventDefault();
        openModal().catch(console.warn);
        });
        btnClose?.addEventListener('click', closeModal);
        document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
        });

        // ===== 選択中フィルター（投稿タグ＋ユーザータグ）のチップ表示 =====
        function renderActivePostFilterChips(){
        const bar = document.getElementById('active-chips-bar');
        if (!bar) return;

        const scroll = bar.querySelector('.chips-scroll');
        if (!scroll) return;

        const st = window.PostFilterState;

        const selectedTags = st?.selectedTags ? Array.from(st.selectedTags) : [];
        const selectedUser = st?.selectedUserTags ? Array.from(st.selectedUserTags) : [];

        scroll.innerHTML = '';

        function addChip(label, onRemove, extraClass=''){
            const chip = document.createElement('span');
            chip.className = `chip-mini ${extraClass}`.trim();
            chip.textContent = label;

            const x = document.createElement('button');
            x.className = 'x';
            x.type = 'button';
            x.textContent = '×';
            x.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
            });

            chip.appendChild(x);
            scroll.appendChild(chip);
        }

        // ① 投稿タグ（🏷️）
        selectedTags.forEach((tag) => {
            addChip(`🏷️${tag}`, () => {
            st.selectedTags?.delete?.(tag);

            document
                .querySelectorAll(`.post-filter-tag-btn[data-tag="${CSS.escape(tag)}"]`)
                .forEach(btn => btn.classList.remove('selected'));

            window.DeckPostApp?.applySortAndRerenderList?.();
            renderActivePostFilterChips();
            }, 'chip-tag');
        });

        // ② ユーザータグ（✍️）
        selectedUser.forEach((tag) => {
            addChip(`✍️${tag}`, () => {
            st.selectedUserTags?.delete?.(tag);

            renderSelectedUserTagChips();
            window.DeckPostApp?.applySortAndRerenderList?.();
            renderActivePostFilterChips();
            }, 'chip-user');
        });

        // すべて解除
        const total = selectedTags.length + selectedUser.length;
        if (total) {
            const clr = document.createElement('span');
            clr.className = 'chip-mini chip-clear';
            clr.textContent = 'すべて解除';
            clr.addEventListener('click', () => {
            st.selectedTags?.clear?.();
            st.selectedUserTags?.clear?.();
            st.userTagQuery = '';

            document
                .querySelectorAll('.post-filter-tag-btn.selected')
                .forEach(btn => btn.classList.remove('selected'));

            const userTagInput = document.getElementById('userTagQuery');
            if (userTagInput) userTagInput.value = '';
            renderUserTagSuggest([]);
            renderSelectedUserTagChips();

            window.DeckPostApp?.applySortAndRerenderList?.();
            renderActivePostFilterChips();
            });
            scroll.appendChild(clr);
        }

        bar.style.display = total ? '' : 'none';
        }

        // ---- リセット ----
        btnReset?.addEventListener('click', () => {
        filterState.selectedTags.clear();

        document
            .querySelectorAll('.post-filter-tag-btn.selected')
            .forEach(btn => btn.classList.remove('selected'));

        filterState.selectedUserTags?.clear?.();
        if (userTagInput) userTagInput.value = '';
        renderUserTagSuggest([]);
        renderSelectedUserTagChips();

        window.DeckPostApp?.applySortAndRerenderList?.();
        renderActivePostFilterChips();
        });

        // ---- 適用 ----
        btnApply?.addEventListener('click', () => {
        window.DeckPostApp?.applySortAndRerenderList?.();
        closeModal();
        renderActivePostFilterChips();
        });
    });
})();
