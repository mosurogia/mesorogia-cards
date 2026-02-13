/*==================================================
  CARD FILTER / カード一覧フィルター（UI生成＋適用）
  - filterModal / main-filters / detail-filters が存在するページだけ動作
  - グリッド/リスト切替（#grid.is-list）にも対応
  -　escapeHtml_はdef.jsに記載
==================================================*/

(function () {
    'use strict';

    // -----------------------
    // 表示用ラベル
    // -----------------------
    const DISPLAY_LABELS = {
        true: 'BPあり',
        false: 'BPなし',

        draw: 'ドロー',
        graveyard_recovery: '墓地回収',
        cardsearch: 'サーチ',
        destroy_opponent: '相手破壊',
        destroy_self: '自己破壊',
        heal: '回復',
        power_up: 'バフ',
        power_down: 'デバフ',
    };
    window.DISPLAY_LABELS = DISPLAY_LABELS;

    // -----------------------
    // debounce
    // -----------------------
    function debounce(fn, ms = 300) {
        let t = 0;
        return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
        };
    }

    // ==============================
    // 所持フィルター（4ボタン） UI生成
    // - OFF / 所持 / 未コンプ / コンプ
    // - 排他（1つだけ選択）
    // ==============================
    function createOwnedFilter4Buttons_() {
    const { wrapper } = createFilterBlock_('所持フィルター');

    const groupDiv = document.createElement('div');
    groupDiv.className = 'filter-group';
    groupDiv.dataset.key = '所持フィルター';

    const items = [
        { label: 'OFF', key: 'off' },
        { label: '所持', key: 'owned' },
        { label: '未コンプ', key: 'incomplete' },
        { label: 'コンプ', key: 'complete' },
    ];

    items.forEach(it => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-btn';
        btn.dataset.owned = it.key;      // ✅ data-owned
        btn.textContent = it.label;

        // 初期選択：OFF
        if (it.key === 'off') btn.classList.add('selected');

        groupDiv.appendChild(btn);
    });

    wrapper.appendChild(groupDiv);
    return wrapper;
    }

    // ==============================
    // カードグループフィルター UI生成
    // ==============================
    function createCardGroupFilterBlock_(){
        const { wrapper } = createFilterBlock_('カードグループ');

        const groupDiv = document.createElement('div');
        groupDiv.className = 'filter-group';
        groupDiv.dataset.key = 'カードグループ';
        wrapper.appendChild(groupDiv);

        // ▼プレビュー欄（カードグループの下に出す：普段は非表示）
        (function ensureCgPreviewRow_(){
        if (document.getElementById('cg-preview-row')) return;

        const row = document.createElement('div');
        row.id = 'cg-preview-row';
        row.innerHTML = `
            <div class="cgpr-head">
            <div class="cgpr-title" id="cgpr-title"></div>
            <button type="button" class="cgpr-close" id="cgpr-close">閉じる</button>
            </div>
            <div class="cgpr-body" id="cgpr-body"></div>
        `;
        wrapper.appendChild(row);

        row.querySelector('#cgpr-close').addEventListener('click', closeCgPreviewRow_);
        })();

        // 末尾：図鑑へ（新規作成）
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'filter-btn is-link';
        go.dataset.action = 'go-create-group';
        go.textContent = '＋グループを作る';
        groupDiv.appendChild(go);

        // 初期描画
        try { refreshCardGroupFilterUI_(); } catch {}
        return wrapper;
        }

    function getCardThumbUrl_(cd){
    // できれば card-core 側の関数があればそれを優先
    if (typeof window.getCardImageUrl === 'function') {
        try { return window.getCardImageUrl(cd); } catch (e) {}
    }
    // フォールバック（環境に合わせてパスを調整OK）
    return `img/${String(cd).padStart(5,'0')}.webp`;
    }

    // ============================
    // グループ内カードの表示順（他と同じ）
    // type → cost → power → cd
    // - cardMap が未ロードなら cd 昇順にフォールバック
    // ============================
    function getSortedGroupCds_(cardsObj, limit = 60) {
    const keys = Object.keys(cardsObj || {});
    if (!keys.length) return [];

    const hasMap = (window.cardMap && Object.keys(window.cardMap).length > 0);
    if (!hasMap || typeof window.getCardSortKeyFromCard !== 'function' || typeof window.compareCardKeys !== 'function') {
        // フォールバック：cd昇順
        return keys
        .map(cd => String(cd).padStart(5, '0'))
        .sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b))
        .slice(0, limit);
    }

    const arr = keys.map(cd => {
        const cd5 = String(cd).padStart(5, '0');
        const card = window.cardMap[cd5];
        // cardMap に無い場合も壊れないように最低限の形にする
        const key = window.getCardSortKeyFromCard(card || { cd: cd5, type: '', cost: 0, power: 0 });
        return { cd5, key };
    });

    arr.sort((a, b) => window.compareCardKeys(a.key, b.key));
    return arr.slice(0, limit).map(x => x.cd5);
    }

    function showCgPreviewRow_(groupId){
    const st = window.CardGroups?.getState?.();
    const g = st?.groups?.[groupId];
    if (!g) return;

    const row = document.getElementById('cg-preview-row');
    if (!row) return;

    const cardsObj = g.cards || {};
    const cds = getSortedGroupCds_(cardsObj, 60); //先頭60枚

    row.querySelector('#cgpr-title').textContent =
        `${g.name || 'グループ'}（${Object.keys(cardsObj).length}枚）`;

    const body = row.querySelector('#cgpr-body');
    body.innerHTML = '';

    if (!cds.length) {
        body.innerHTML = `<div class="cgpr-empty">カード未選択</div>`;
    } else {
        cds.forEach(cd5 => {
        const img = document.createElement('img');
        img.className = 'cgpr-img';
        img.loading = 'lazy';
        img.alt = String(cd5);
        img.src = getCardThumbUrl_(cd5);
        body.appendChild(img);
        });
    }

    row.classList.add('is-open');
    }

    function closeCgPreviewRow_() {
    const row = document.getElementById('cg-preview-row');
    if (row) row.classList.remove('is-open');

    // ボタン側の開状態も戻す
    document.querySelectorAll('.filter-btn.is-preview-open[data-group]')
        .forEach(b => b.classList.remove('is-preview-open'));
    }


    function isDeckmakerPage_() {
    return /deckmaker/i.test(location.pathname) || document.body?.classList?.contains('deckmaker');
    }

    function isMobile_() {
    return window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
    }

    function handleCreateGroupAction_() {
    // ② デッキメーカー：図鑑へ飛ばす
    if (isDeckmakerPage_()) {
        location.href = 'cards.html';
        return;
    }

    // ② 図鑑ページ：PCは閉じるだけ、SPはドロワーも開く
    try { closeFilterModal(); } catch {}

    const addBtn = document.getElementById('cg-sidebar-add');

    if (isMobile_() && window.__SpGroupDrawer?.open) {
        window.__SpGroupDrawer.open();
        // ドロワーを開いた後に作成ボタンを押す
        setTimeout(() => { try { addBtn?.click(); } catch {} }, 0);
    } else {
        // PC：サイドバーにあるのでそのまま作成
        try { addBtn?.click(); } catch {}
    }
    }


    /* ============================
    クリック/hover/長押しの配線
    - 既存の filterModal click handler の中に混ぜてもOK
    ============================ */
    document.addEventListener('click', (e) => {

    const drop = e.target.closest('.cg-drop');
    if (drop) {
        e.preventDefault();
        e.stopImmediatePropagation(); // ▼は他のclickへ行かせない

        const groupBtn = drop.closest('.filter-btn[data-group]');
        const gid = groupBtn?.dataset.group;
        if (!gid) return;

        const row = document.getElementById('cg-preview-row');
        const isOpen = row?.classList.contains('is-open');
        const isSame = groupBtn.classList.contains('is-preview-open');

        document.querySelectorAll('.filter-btn.is-preview-open[data-group]')
        .forEach(b => b.classList.remove('is-preview-open'));

        if (isOpen && isSame) {
        row.classList.remove('is-open');
        return;
        }

        groupBtn.classList.add('is-preview-open');
        showCgPreviewRow_(gid);
        return;
    }

    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    // ✅ 「＋グループを作る」だけはここで処理して二重実行を止める
    if (btn.dataset.action === 'go-create-group') {
        e.preventDefault();
        e.stopImmediatePropagation(); // init側にも行かせない
        handleCreateGroupAction_();
        return; // ★ これ重要（落ちない）
    }

    // ✅ それ以外の filter-btn は “ここでは何もしない”
    // （選択処理は init() 内の click 1本に任せる）
    });

    // ==============================
    // カードグループ（フィルターUI）を再描画（差し替え専用）
    // ==============================
    function refreshCardGroupFilterUI_() {
    const gWrap = document.querySelector('.filter-group[data-key="カードグループ"]');
    if (!gWrap) return;

    // 「図鑑へ」ボタンは残して作り直したいので一旦退避
    const goBtn = gWrap.querySelector('.filter-btn[data-action="go-create-group"]');
    gWrap.innerHTML = '';
    if (goBtn) gWrap.appendChild(goBtn);

    try {
        const st = window.CardGroups?.getState?.();
        const groups = st?.groups || {};

        const ids = Object.keys(groups).sort((a, b) => {
        const ga = groups[a], gb = groups[b];
        const oa = (ga?.order ?? 9999), ob = (gb?.order ?? 9999);
        if (oa !== ob) return oa - ob;
        return String(ga?.name || '').localeCompare(String(gb?.name || ''), 'ja');
        });

        ids.forEach(id => {
        const g = groups[id];
        if (!g) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-btn';
        btn.dataset.group = String(id);

        const cnt = Object.keys(g.cards || {}).length;
        const name = g.name || 'グループ';
        btn.innerHTML = `
        <span class="cg-label">${escapeHtml_(name)}</span>
        <span class="cg-right">
            <small class="cg-count">(${cnt})</small>
            <span class="cg-drop" role="button" tabindex="0" aria-label="プレビュー">▼</span>
        </span>
        `;

        // goBtn の手前に入れる
        if (goBtn) gWrap.insertBefore(btn, goBtn);
        else gWrap.appendChild(btn);
        });
    } catch {}

    try { syncGroupFilterUIFromState_(); } catch {}
    }

    // ==============================
    // グループUI（モーダル側）を state と同期
    // ==============================
    function syncGroupFilterUIFromState_() {
    const gWrap = document.querySelector('.filter-group[data-key="カードグループ"]');
    if (!gWrap) return;

    let activeId = '';
    let editingId = '';

    try {
        const st = window.CardGroups?.getState?.();
        activeId = st?.activeId || '';
        editingId = st?.editingId || '';
    } catch {}

    const want = (editingId ? '' : String(activeId || ''));

    gWrap.querySelectorAll('.filter-btn[data-group]').forEach(b => b.classList.remove('selected'));

    if (want) {
        const hit = gWrap.querySelector(`.filter-btn[data-group="${CSS.escape(want)}"]`);
        if (hit) hit.classList.add('selected');
    }
    }

    // ==============================
    // ヘルプ文言（必要に応じて追記/調整OK）
    // ==============================
    const FILTER_HELP = {
    '所持フィルター': `
        <ul>
        <li>サイトに入力した所持情報から絞り込み</li>
        <li><b>OFF</b>：所持条件で絞り込みしない</li>
        <li><b>所持</b>：1枚以上持っているカードだけ表示</li>
        <li><b>未コンプ</b>：最大枚数まで揃っていないカード（通常3/旧神1）</li>
        <li><b>コンプ</b>：最大枚数まで揃っているカード（通常3/旧神1）</li>
        </ul>
    `,
    'カードグループ': `
        <ul>
            <li>カードグループで絞り込み（単一選択）</li>
            <li>▼からリストの確認が可能</li>
            <li>カードグループの作成・編集は、図鑑ページで行えます</li>
        </ul>
        `,
    'タイプ': `
        <ul>
        <li>チャージャー / アタッカー / ブロッカー で絞り込み</li>
        <li>複数選択も可能</li>
        </ul>
    `,
    'レアリティ': `
        <ul>
        <li>レアリティ別で絞り込み</li>
        <li>複数選択も可能</li>
        </ul>
    `,
    'パック名': `
        <ul>
        <li>パック名で絞り込み</li>
        <li>複数選択も可能</li>
        </ul>
    `,
    '種族': `
        <ul>
        <li>種族で絞り込み</li>
        <li>複数選択も可能</li>
        </ul>
    `,
    'カテゴリ': `
        <ul>
        <li>カテゴリで絞り込み</li>
        <li>枠線はカテゴリの種族に準拠</li>
        <li>複数選択も可能</li>
        </ul>
    `,
    'コスト': `
        <ul>
        <li>数値の範囲で絞り込み</li>
        </ul>
    `,
    'パワー': `
        <ul>
        <li>数値の範囲で絞り込み</li>
        </ul>
    `,
    '効果名': `
        <ul>
        <li>カードの効果別で絞り込み</li>
        <li>複数選択も可能</li>
        </ul>
    `,
    'フィールド': `
        <ul>
        <li>フィールド関係のカードで絞り込み（表示は短縮名）</li>
        <li>複数選択も可能</li>
        </ul>
    `,
    'BP（ブレッシングポイント）要素': `
        <ul>
        <li><b>BPあり</b>：BP要素を持つカード</li>
        <li><b>BPなし</b>：BP要素を持たないカード</li>
        </ul>
    `,
    '特殊効果': `
        <ul>
        <li>燃焼 / 拘束 / 沈黙 などで絞り込み</li>
        <li><b>特殊効果未所持</b>：特殊効果を持たないカード</li>
        </ul>
    `,
    'その他': `
        <ul>
        <li>ドロー / サーチ / 回復 など、効果系フラグで絞り込み</li>
        </ul>
    `,
    };

    // ==============================
    // UI生成ヘルパ（helpボタン付き）
    // ==============================
    function createFilterBlock_(titleText) {
    const wrapper = document.createElement('div');
    wrapper.className = 'filter-block';

    // タイトル行（左：タイトル / 右：?ボタン）
    const head = document.createElement('div');
    head.className = 'filter-head';

    const strong = document.createElement('strong');
    strong.className = 'filter-title';
    strong.textContent = titleText;

    head.appendChild(strong);

    // help（該当文言がある時だけ表示）
    const helpHtml = FILTER_HELP[titleText];
    if (helpHtml) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'help-button';
        btn.setAttribute('aria-label', `${titleText} の説明を表示`);
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = '?';

        head.appendChild(btn);

        const help = document.createElement('div');
        help.className = 'filter-help';
        help.innerHTML = helpHtml;

        btn.addEventListener('click', () => {
        const open = !wrapper.classList.contains('is-help-open');
        wrapper.classList.toggle('is-help-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        wrapper.appendChild(head);
        wrapper.appendChild(help);
        return { wrapper, titleEl: strong };
    }

    // help無し
    wrapper.appendChild(head);
    return { wrapper, titleEl: strong };
    }

    function createButtonGroup_(title, list, filterKey) {
        const { wrapper } = createFilterBlock_(title);

        const groupDiv = document.createElement('div');
        groupDiv.className = 'filter-group';
        groupDiv.dataset.key = title;

        list.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-btn';
        btn.dataset[filterKey] = item;

        // is-ring 付与ルール
        if (filterKey === 'race' && item !== '旧神') btn.classList.add('is-ring');
        if (filterKey === 'category') btn.classList.add('is-ring');

        // カテゴリ枠線色用（data-cat-race）
        if (filterKey === 'category' && typeof window.getCategoryRace === 'function') {
            const r = window.getCategoryRace(item);
            btn.dataset.catRace = r || 'none';
        }

        // 表示（カテゴリだけ改行）
        if (filterKey === 'category' && String(item).includes('（')) {
            btn.innerHTML = String(item).replace('（', '<br>（');
        } else {
            btn.textContent =
            (window.DISPLAY_LABELS && window.DISPLAY_LABELS[item] != null)
                ? window.DISPLAY_LABELS[item]
                : item;
        }

        groupDiv.appendChild(btn);
        });

        wrapper.appendChild(groupDiv);
        return wrapper;
    }

    // 2択/複数の横並び（タイプ・レア・BP・特殊効果など）
    function createRangeStyleWrapper_(title, list, filterKey) {
    const { wrapper } = createFilterBlock_(title);
    wrapper.classList.add('filter-range-wrapper');

    const groupDiv = document.createElement('div');
    groupDiv.className = 'filter-group';
    groupDiv.dataset.key = title;

    list.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-btn';
        btn.dataset[filterKey] = item;

        btn.textContent =
        (window.DISPLAY_LABELS && window.DISPLAY_LABELS[item] != null)
            ? window.DISPLAY_LABELS[item]
            : item;

        groupDiv.appendChild(btn);
    });

    wrapper.appendChild(groupDiv);
    return wrapper;
    }

    // 範囲セレクタ（コスト/パワー）
    function createRangeSelector_(title, filterKey, list, onChange) {
    const { wrapper } = createFilterBlock_(title);
    wrapper.classList.add('filter-range-wrapper');

    const groupDiv = document.createElement('div');
    groupDiv.className = 'filter-group';
    groupDiv.dataset.key = title;

    const selectMin = document.createElement('select');
    const selectMax = document.createElement('select');
    selectMin.id = `${filterKey}-min`;
    selectMax.id = `${filterKey}-max`;

    const minOptions = [...list];
    const maxOptions = [...list, '上限なし'];

    minOptions.forEach(v => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        if (v === 0) o.selected = true;
        selectMin.appendChild(o);
    });

    maxOptions.forEach(v => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        if (v === '上限なし') o.selected = true;
        selectMax.appendChild(o);
    });

    groupDiv.appendChild(selectMin);

    const wave = document.createElement('span');
    wave.className = 'tilde';
    wave.textContent = '～';
    groupDiv.appendChild(wave);

    groupDiv.appendChild(selectMax);
    wrapper.appendChild(groupDiv);

    selectMin.addEventListener('change', onChange);
    selectMax.addEventListener('change', onChange);

    return wrapper;
    }

    // ==============================
    // モーダル制御
    // ==============================
    function openFilterModal(tab = null) {
    const m = document.getElementById('filterModal');
    if (!m) return;

    m.style.display = 'flex';

    // ✅ 開くタブ：引数 > 保存値 > filters
    const pick = (() => {
        if (tab) return tab;
        try { return localStorage.getItem('cardFilterModalTab') || 'filters'; } catch { return 'filters'; }
    })();

    // ✅ タブUIに反映（関数がまだなら何もしない）
    try { setTimeout(() => { try { setModalTab_(pick); } catch {} }, 0); } catch {}

    // ✅ 追加：モーダルを開くたびに「カードグループ」を必ず再描画
    try {
        setTimeout(() => {
        try { refreshCardGroupFilterUI_(); } catch {}
        try { renderActiveFilterChips(); } catch {}
        }, 0);
    } catch {}
    }
    function closeFilterModal() {
        const m = document.getElementById('filterModal');
        if (m) m.style.display = 'none';
    }
    function toggleDetailFilters() {
        const detail = document.getElementById('detail-filters');
        if (!detail) return;
        detail.style.display = (detail.style.display === 'none') ? 'block' : 'none';
    }
    // ==============================
    // フィルターモーダル：タブ切替（フィルター / グループ）
    // ==============================
    function setModalTab_(tab) {
    const modal = document.getElementById('filterModal');
    if (!modal) return;

    const tabs = Array.from(modal.querySelectorAll('.filter-modal-tab'));
    const panes = Array.from(modal.querySelectorAll('.filter-modal-pane'));

    tabs.forEach(b => {
        const on = (b.dataset.tab === tab);
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    panes.forEach(p => {
        const on = (p.dataset.pane === tab);
        p.classList.toggle('is-active', on);
        p.setAttribute('aria-hidden', on ? 'false' : 'true');
    });

    try { localStorage.setItem('cardFilterModalTab', tab); } catch {}
    }

    function bindModalTabs_() {
    const modal = document.getElementById('filterModal');
    if (!modal || modal.dataset.tabsBound) return;
    modal.dataset.tabsBound = '1';

    modal.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-modal-tab');
        if (!btn) return;
        setModalTab_(btn.dataset.tab || 'filters');
    });
    }

    // ==============================
    // フィルターUI生成
    // ==============================
    async function generateFilterUI() {
        const cards = await window.fetchLatestCards?.();
        if (!Array.isArray(cards)) return;

        const mainFilters = document.getElementById('main-filters');
        const detailFilters = document.getElementById('detail-filters');
        if (!mainFilters || !detailFilters) return;

        mainFilters.innerHTML = '';
        detailFilters.innerHTML = '';

        const getUniqueValues = (key) =>
        [...new Set(cards.map(card => card[key]).filter(Boolean))];

        // カテゴリ順（Excel「リスト集」順）
        const catOrder = (typeof window.getCategoryOrder === 'function')
        ? window.getCategoryOrder
        : ((_) => 9999);

        const categories = getUniqueValues('category').sort((a, b) => catOrder(a) - catOrder(b));
        const races = getUniqueValues('race');
        const costs = [...new Set(cards.map(c => parseInt(c.cost)).filter(Number.isFinite))].sort((a, b) => a - b);
        const powers = [...new Set(cards.map(c => parseInt(c.power)).filter(Number.isFinite))].sort((a, b) => a - b);

        const types = ['チャージャー', 'アタッカー', 'ブロッカー'];
        const rarities = ['レジェンド', 'ゴールド', 'シルバー', 'ブロンズ'];

        // ---- パック（英名＋仮名）----
        let packCatalog = null;
        try { packCatalog = await window.loadPackCatalog?.(); } catch {}
        window.__PACK_EN_TO_JP = window.__PACK_EN_TO_JP || {};

        const { wrapper: packWrapper } = createFilterBlock_('パック名');

        const packGroup = document.createElement('div');
        packGroup.className = 'filter-group';
        packGroup.dataset.key = 'パック名';

        const addPackBtn = (en, jp) => {
        if (!en) return;
        window.__PACK_EN_TO_JP[en] = jp || '';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-btn is-ring';
        btn.dataset.pack = en;
        btn.innerHTML = `<span class="pack-en">${en}</span><br><small class="pack-kana">${jp || ''}</small>`;
        packGroup.appendChild(btn);
        };

        if (packCatalog && Array.isArray(packCatalog.list)) {
        packCatalog.list.forEach(p => addPackBtn(p.en || '', p.jp || ''));
        } else {
        const packsRaw = getUniqueValues('pack_name');
        const splitPackLabel = (s) => {
            const m = String(s || '').match(/^([^「]+)(?:「([^」]*)」)?/);
            return { en: (m?.[1] || '').trim(), jp: (m?.[2] || '').trim() };
        };
        const uniq = [...new Map(packsRaw.map(n => {
            const sp = splitPackLabel(n);
            return [sp.en, sp];
        })).values()].sort((a, b) => a.en.localeCompare(b.en, 'en'));
        uniq.forEach(sp => addPackBtn(sp.en, sp.jp));
        }

        packWrapper.appendChild(packGroup);

        // ---- 詳細 ----
        const effect_name = [...new Set(
        cards.flatMap(card => [card.effect_name1, card.effect_name2]).filter(Boolean)
        )].sort();

        const FIELD_DISPLAY = {
        'フィールド関係なし': 'フィールド関係なし',
        'ドラゴンフィールド': 'ドラゴン',
        'アンドロイドフィールド': 'アンドロイド',
        'エレメンタルフィールド': 'エレメンタル',
        'ルミナスフィールド': 'ルミナス',
        'シェイドフィールド': 'シェイド',
        'ノーマルフィールド': 'ノーマル',
        };

        const SPECIAL_ABILITIES = ['特殊効果未所持', '燃焼', '拘束', '沈黙'];
        const OTHER_BOOLEAN_KEYS = [
        'draw', 'cardsearch', 'graveyard_recovery', 'destroy_opponent', 'destroy_self',
        'heal', 'power_up', 'power_down'
        ];

        // ✅ 所持データが “1枚でも” 入ってるか（チェッカー未使用判定）
        function hasAnyOwned_() {
        const map = (typeof window.readOwnedDataSafe === 'function')
            ? window.readOwnedDataSafe()
            : {};

        if (!map || typeof map !== 'object') return false;

        for (const v of Object.values(map)) {
            if (typeof v === 'number') {
            if ((v | 0) > 0) return true;
            } else if (v && typeof v === 'object') {
            const total = (v.normal | 0) + (v.shine | 0) + (v.premium | 0);
            if (total > 0) return true;
            }
        }
        return false;
        }

        // ---- メイン ----
        if (hasAnyOwned_()) {
        mainFilters.appendChild(createOwnedFilter4Buttons_()); // 所持フィルター（所持データがある時だけ）
        }
        mainFilters.appendChild(createCardGroupFilterBlock_()); // カードグループフィルター
        mainFilters.appendChild(createRangeStyleWrapper_('タイプ', types, 'type'));
        mainFilters.appendChild(createRangeStyleWrapper_('レアリティ', rarities, 'rarity'));
        mainFilters.appendChild(packWrapper);
        mainFilters.appendChild(createButtonGroup_('種族', races, 'race'));
        mainFilters.appendChild(createButtonGroup_('カテゴリ', categories, 'category'));
        mainFilters.appendChild(createRangeSelector_('コスト', 'cost', costs, () => applyFilters()));
        mainFilters.appendChild(createRangeSelector_('パワー', 'power', powers, () => applyFilters()));

        // ---- 詳細 ----
        detailFilters.appendChild(createButtonGroup_('効果名', effect_name, 'effect'));

        // フィールド：表示名短縮
        const fieldKeys = Object.keys(FIELD_DISPLAY);
        const fieldWrapper = createButtonGroup_('フィールド', fieldKeys, 'field');
        fieldWrapper.querySelectorAll('.filter-btn').forEach(btn => {
        const val = btn.dataset.field;
        btn.textContent = FIELD_DISPLAY[val] ?? val;
        });
        detailFilters.appendChild(fieldWrapper);

        detailFilters.appendChild(createRangeStyleWrapper_('BP（ブレッシングポイント）要素', ['true', 'false'], 'bp'));
        detailFilters.appendChild(createRangeStyleWrapper_('特殊効果', SPECIAL_ABILITIES, 'ability'));

        // その他（boolean）
        const { wrapper: otherWrap } = createFilterBlock_('その他');
        otherWrap.classList.add('filter-range-wrapper');

        const otherGroup = document.createElement('div');
        otherGroup.className = 'filter-group';
        otherGroup.dataset.key = 'その他';

        OTHER_BOOLEAN_KEYS.forEach(key => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-btn';
        btn.dataset[key] = 'true';
        btn.textContent = DISPLAY_LABELS[key] ?? key;
        otherGroup.appendChild(btn);
        });

        otherWrap.appendChild(otherGroup);
        detailFilters.appendChild(otherWrap);

        // サブタイトル（1回だけ）
        const df = document.getElementById('detail-filters');
        if (df && !document.querySelector('.filter-subtitle')) {
        const h = document.createElement('h4');
        h.className = 'filter-subtitle';
        h.textContent = 'さらに詳しい条件フィルター';
        df.parentNode.insertBefore(h, df);
        }
    }

    // ==============================
    // チップバー
    // ==============================
    function updateChipsOffset() {
        const parts = [
        // document.querySelector('.search-bar'),
        // document.querySelector('.main-header'),
        // document.querySelector('.subtab-bar'),
        ].filter(Boolean);

        const sum = parts.reduce((h, el) => h + el.offsetHeight, 0);
        document.documentElement.style.setProperty('--chips-offset', `${sum}px`);
    }

    // アクティブチップ表示
    function renderActiveFilterChips() {
    const grid = document.getElementById('grid');
    if (!grid) return;

    let bar = document.getElementById('active-chips-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'active-chips-bar';
        bar.innerHTML = `<div class="chips-scroll"></div>`;

        const sb = document.querySelector('.search-bar');
        if (sb && sb.parentNode) sb.insertAdjacentElement('afterend', bar);
        else grid.parentNode.insertBefore(bar, grid);
    }

    // ✅ 既存barでも「左：枚数」を必ず持つように補完
    if (!bar.querySelector('.chips-left')) {
        const left = document.createElement('div');
        left.className = 'chips-left';

        const cnt = document.createElement('span');
        cnt.className = 'chips-count';
        cnt.textContent = '0枚';

        left.appendChild(cnt);

        // 右側スクロールより前に入れる
        const sc = bar.querySelector('.chips-scroll');
        if (sc) bar.insertBefore(left, sc);
        else bar.appendChild(left);
    }

    const scroll = bar.querySelector('.chips-scroll');
    const countEl = bar.querySelector('.chips-count');
    if (!scroll) return;
    scroll.innerHTML = '';

    // ✅ 表示枚数（フィルター結果）
    let visible = 0;
    grid.querySelectorAll('.card').forEach(el => {
        if (el.hidden) return;
        if (el.style.display === 'none') return;
        visible++;
    });
    if (countEl) countEl.textContent = `${visible}枚表示`;

        const chips = [];

    // --- カードグループフィルター（チップバー表示＆解除） ---
    try {
    const st = window.CardGroups?.getState?.();
    const editingId = st?.editingId || '';
    const activeId  = st?.activeId  || '';

    // ✅ 編集中はフィルター適用しない方針なので、チップも出さない
    if (!editingId && activeId) {
        const gName = st?.groups?.[activeId]?.name || 'グループ';

        chips.push({
        label: `グループ:${gName}`,
        onRemove: () => {
            try { window.CardGroups?.setActive?.(''); } catch {}
            // ✅ モーダル側の選択状態も同期しておく
            try { syncGroupFilterUIFromState_(); } catch {}
            applyFilters();
        }
        });
    }
    } catch {}

    // キーワード
    const kwEl = document.getElementById('keyword');
    const kw = (kwEl?.value || '').trim();
    if (kw) chips.push({ label: `検索:${kw}`, onRemove: () => { kwEl.value = ''; applyFilters(); } });

        // 範囲
        const cminEl = document.getElementById('cost-min');
        const cmaxEl = document.getElementById('cost-max');
        const pminEl = document.getElementById('power-min');
        const pmaxEl = document.getElementById('power-max');

        const cmin = cminEl?.value, cmax = cmaxEl?.value;
        const pmin = pminEl?.value, pmax = pmaxEl?.value;

        if (cminEl && cmaxEl) {
            const isDefault = (cmin | 0) === (cminEl.options[0]?.value | 0) && cmax === '上限なし';
            if (!isDefault) chips.push({
                label: `コスト:${cmin}–${cmax === '上限なし' ? '∞' : cmax}`,
                onRemove: () => { cminEl.selectedIndex = 0; cmaxEl.selectedIndex = cmaxEl.options.length - 1; applyFilters(); }
            });
        }
        if (pminEl && pmaxEl) {
            const isDefault = (pmin | 0) === (pminEl.options[0]?.value | 0) && pmax === '上限なし';
            if (!isDefault) chips.push({
                label: `パワー:${pmin}–${pmax === '上限なし' ? '∞' : pmax}`,
                onRemove: () => { pminEl.selectedIndex = 0; pmaxEl.selectedIndex = pmaxEl.options.length - 1; applyFilters(); }
            });
        }

        // ボタン系
        const GROUPS = [
        // 所持（4ボタン）
        ['所持', 'owned'],

        // 通常
        ['種族', 'race'],
        ['カテゴリ', 'category'],
        // ['タイプ', 'type'], // ← 出さない方針ならこのままコメント
        ['レア', 'rarity'],
        ['パック', 'pack'],
        ['効果名', 'effect'],
        ['フィールド', 'field'],
        ['BP', 'bp'],
        ['特効', 'ability'],

        // その他（boolean）
        ['その他', 'draw'],
        ['その他', 'cardsearch'],
        ['その他', 'graveyard_recovery'],
        ['その他', 'destroy_opponent'],
        ['その他', 'destroy_self'],
        ['その他', 'heal'],
        ['その他', 'power_up'],
        ['その他', 'power_down'],
        ];

        GROUPS.forEach(([title, key]) => {
            document.querySelectorAll(`.filter-btn.selected[data-${key}]`).forEach(btn => {
                const val = btn.dataset[key];
                let labelText;

                if (key === 'owned') {
                // OFFはチップに出さない
                if (val === 'off') return;

                const map = { owned: '所持', incomplete: '未コンプ', complete: 'コンプ' };
                labelText = map[val] || val;

                } else if (key === 'pack') {
                const jp = (window.__PACK_EN_TO_JP && window.__PACK_EN_TO_JP[val]) || '';
                labelText = jp ? `${val} / ${jp}` : val;

                } else if (['draw', 'cardsearch', 'graveyard_recovery', 'destroy_opponent', 'destroy_self', 'heal', 'power_up', 'power_down'].includes(key)) {
                labelText = DISPLAY_LABELS[key] ?? key;

                } else {
                labelText = (DISPLAY_LABELS && DISPLAY_LABELS[val] != null) ? DISPLAY_LABELS[val] : val;
                }

                chips.push({
                    label: `${title}:${labelText}`,
                    onRemove: () => { btn.classList.remove('selected'); applyFilters(); }
                });
            });
        });

        chips.forEach(({ label, onRemove }) => {
            const chip = document.createElement('span');
            chip.className = 'chip-mini';
            chip.textContent = label;

            const x = document.createElement('button');
            x.className = 'x';
            x.type = 'button';
            x.textContent = '×';
            x.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
            chip.appendChild(x);

            scroll.appendChild(chip);
        });

        // 全解除
        if (chips.length) {
            const clr = document.createElement('span');
            clr.className = 'chip-mini chip-clear';
            clr.textContent = 'すべて解除';
            clr.addEventListener('click', () => resetFilters());
            scroll.appendChild(clr);
        }

        // ✅ 「タイプ絞り込み中」でも枚数だけは見せたい
        const left = bar.querySelector('.chips-left');

        // タイプはチップに出さないので、選択中タイプがあるか別判定する
        const hasTypeFilter =
        document.querySelectorAll('.filter-btn.selected[data-type]').length > 0;

        // 表示条件：チップがある or タイプ絞り込み中
        const showBar = (chips.length > 0) || hasTypeFilter;

        // 左（枚数）
        if (left) left.style.display = showBar ? '' : 'none';

        // バー自体（枚数だけ出す用途もあるので showBar で表示）
        bar.style.display = showBar ? '' : 'none';
    }

    // =====================================================
    // Empty state（表示0件メッセージ）
    // - 空グループ適用中（cards=0）と、通常フィルター0件を出し分け
    // =====================================================
    function renderEmptyState_(visibleCount) {
    const grid = document.getElementById('grid');
    if (!grid) return;

    // 既存を取得/生成
    let box = document.getElementById('cards-empty-state');
    if (!box) {
        box = document.createElement('div');
        box.id = 'cards-empty-state';
        box.className = 'cards-empty-state';
        // chips bar の下に置きたい（無ければ grid の直前）
        const bar = document.getElementById('active-chips-bar');
        if (bar && bar.parentNode) bar.insertAdjacentElement('afterend', box);
        else grid.parentNode?.insertBefore(box, grid);
    }

    // 0件じゃないなら隠す
    if (visibleCount > 0) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
    }

    // --- ここから 0件時の内容分岐 ---
    let mode = 'normal';
    let groupName = '';

    try {
        const st = window.CardGroups?.getState?.();
        const editingId = st?.editingId || '';
        const activeId  = st?.activeId  || '';

        // 編集中は “カード選択のために全カード表示” の方針なので、
        // ここでは空表示を出さない（必要なら変えてOK）
        if (editingId) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
        }

        if (activeId) {
        const g = st?.groups?.[activeId];
        const cnt = g ? Object.keys(g.cards || {}).length : 0;
        groupName = g?.name || '';
        if (cnt === 0) mode = 'empty-group';
        else mode = 'group-nohit'; // グループはあるが、他フィルターで0件
        }
    } catch {}

    // 表示文言
    if (mode === 'empty-group') {
        box.innerHTML = `
        <div class="cards-empty-title">このグループは空です</div>
        <div class="cards-empty-text">✏️で編集してカードを追加してください</div>
        <div class="cards-empty-actions">
            <button type="button" class="cards-empty-btn" data-act="edit">編集する</button>
            <button type="button" class="cards-empty-btn" data-act="clear-group">全カードに戻る</button>
        </div>
        `;
    } else if (mode === 'group-nohit') {
        const name = groupName ? `（${groupName}）` : '';
        box.innerHTML = `
        <div class="cards-empty-title">表示できるカードがありません${name}</div>
        <div class="cards-empty-text">グループ内カードが、現在の絞り込み条件に一致しません。</div>
        <div class="cards-empty-actions">
            <button type="button" class="cards-empty-btn" data-act="clear-filters">フィルターを解除</button>
            <button type="button" class="cards-empty-btn" data-act="clear-group">全カードに戻る</button>
        </div>
        `;
    } else {
        box.innerHTML = `
        <div class="cards-empty-title">表示できるカードがありません</div>
        <div class="cards-empty-text">条件をゆるめて再検索してください。</div>
        <div class="cards-empty-actions">
            <button type="button" class="cards-empty-btn" data-act="clear-filters">フィルターを解除</button>
        </div>
        `;
    }

    // ボタン動作（イベント委譲）
    if (!box.dataset.bound) {
        box.dataset.bound = '1';
        box.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;

        if (act === 'edit') {
            // active を編集開始
            try {
            const st = window.CardGroups?.getState?.();
            const activeId = st?.activeId || '';
            if (activeId) window.CardGroups.startEditing(activeId);
            } catch {}
            applyFilters();
            return;
        }

        if (act === 'clear-group') {
        try {
            // ✅ UI側の選択状態も解除（重要）
            window.__CardGroupsUI?.clearSelected?.();

            // グループフィルター解除（これで onChange → sidebar再描画が走る）
            window.CardGroups?.setActive?.('');
        } catch {}

        applyFilters();
        return;
        }

        if (act === 'clear-filters') {
            // resetFilters はタイプUI等も戻すのでこれが一番確実
            try { resetFilters(); } catch { applyFilters(); }
            return;
        }
        });
    }

    box.style.display = '';
    }

    // ==============================
    // applyFilters 本体
    // ==============================
    function getSelectedFilterValues(key) {
        return Array.from(document.querySelectorAll(`.filter-btn.selected[data-${key}]`))
        .map(btn => btn.dataset[key]);
    }

    // Booleanフィルター取得
    function getBooleanFilter(key) {
        const btn = document.querySelector(`.filter-group [data-${key}].selected`);
        return btn ? ['true'] : [];
    }

    function applyFilters() {
        const opened = document.querySelector('.card-detail.active');
        if (opened) opened.remove();

        const keyword = (document.getElementById('keyword')?.value || '').trim().toLowerCase();
        const tokens = keyword.split(/\s+/).filter(Boolean);

        const selectedFilters = {
        race: getSelectedFilterValues('race'),
        category: getSelectedFilterValues('category'),
        type: getSelectedFilterValues('type'),
        rarity: getSelectedFilterValues('rarity'),
        pack: getSelectedFilterValues('pack'),
        effect: getSelectedFilterValues('effect'),
        field: getSelectedFilterValues('field'),
        bp: getSelectedFilterValues('bp'),
        ability: getSelectedFilterValues('ability'),
        draw: getBooleanFilter('draw'),
        cardsearch: getBooleanFilter('cardsearch'),
        graveyard_recovery: getBooleanFilter('graveyard_recovery'),
        destroy_opponent: getBooleanFilter('destroy_opponent'),
        destroy_self: getBooleanFilter('destroy_self'),
        heal: getBooleanFilter('heal'),
        power_up: getBooleanFilter('power_up'),
        power_down: getBooleanFilter('power_down'),
        };

        const toIntOr = (v, fallback) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : fallback;
        };

        const costMinEl = document.getElementById('cost-min');
        const costMaxEl = document.getElementById('cost-max');
        const costMin = toIntOr(costMinEl?.value, 0);

        const costMaxVal = costMaxEl?.value;
        const costMax = (!costMaxEl || costMaxVal == null || costMaxVal === '上限なし')
        ? Infinity
        : toIntOr(costMaxVal, Infinity);

        const powerMinEl = document.getElementById('power-min');
        const powerMaxEl = document.getElementById('power-max');
        const powerMin = toIntOr(powerMinEl?.value, 0);

        const powerMaxVal = powerMaxEl?.value;
        const powerMax = (!powerMaxEl || powerMaxVal == null || powerMaxVal === '上限なし')
        ? Infinity
        : toIntOr(powerMaxVal, Infinity);


        // 所持フィルター（4ボタン：排他）
        const ownedFilterGroup = document.querySelector('.filter-group[data-key="所持フィルター"]');
        let ownedMode = 'off';

        if (ownedFilterGroup) {
        const sel = ownedFilterGroup.querySelector('.filter-btn.selected[data-owned]');
        ownedMode = sel?.dataset.owned || 'off';
        if (ownedMode === 'off') ownedMode = 'off';
        }

        const ownedBtnOn  = (ownedMode === 'owned');
        const unCompBtnOn = (ownedMode === 'incomplete');
        const compBtnOn   = (ownedMode === 'complete');

        const ownedDataMap = (typeof window.readOwnedDataSafe === 'function')
        ? window.readOwnedDataSafe()
        : {};

        const gridRoot = document.getElementById('grid') || document;

        // ✅ グループフィルター：activeId があるなら「空でも」有効化する
        // - 編集中(editingId)はグループ絞り込みしない（方針通り）
        // - 空グループ(activeだが cards=0) → 全カードが弾かれて 0件になる
        let groupSet = null;
        let groupFilterActive = false;

        try {
        const stG = window.CardGroups?.getState?.();
        const editingId = stG?.editingId || '';
        const activeId  = stG?.activeId  || '';

        if (!editingId && activeId) {
            groupFilterActive = true;

            // getActiveFilterSet が空のとき null を返す場合に備えて自前で Set を作る
            const g = stG?.groups?.[activeId];
            const cds = g ? Object.keys(g.cards || {}) : [];
            groupSet = new Set(cds.map(cd => String(cd).padStart(5, '0')));
        }
        } catch {}

        gridRoot.querySelectorAll('.card').forEach(card => {
        const haystack =
            (card.dataset.keywords?.toLowerCase()) ||
            [
            card.dataset.name,
            card.dataset.effect,
            card.dataset.field,
            card.dataset.ability,
            card.dataset.category,
            card.dataset.race,
            ].filter(Boolean).join(' ').toLowerCase();

        const cardData = {
            race: card.dataset.race,
            category: card.dataset.category,
            type: card.dataset.type,
            rarity: card.dataset.rarity,
            pack: card.dataset.pack,
            effect: card.dataset.effect,
            field: card.dataset.field,
            bp: card.dataset.bp,
            ability: card.dataset.ability,
            draw: card.dataset.draw,
            cardsearch: card.dataset.cardsearch,
            graveyard_recovery: card.dataset.graveyard_recovery,
            destroy_opponent: card.dataset.destroy_opponent,
            destroy_self: card.dataset.destroy_self,
            heal: card.dataset.heal,
            power_up: card.dataset.power_up,
            power_down: card.dataset.power_down,
            cost: parseInt(card.dataset.cost),
            power: parseInt(card.dataset.power),
        };

        const matchesKeyword = tokens.length === 0
            ? true
            : tokens.every(t => haystack.includes(t));

        const matchesFilters = Object.entries(selectedFilters).every(([key, selectedValues]) => {
            if (!selectedValues || selectedValues.length === 0) return true;

            // pack：英名一致（カード側は "EN「仮名」" の可能性）
            if (key === 'pack') {
            const cardEn = (cardData.pack || '').split('「')[0].trim();
            return selectedValues.includes(cardEn);
            }

            // effect：含む
            if (key === 'effect') {
            const eff = cardData.effect || '';
            return selectedValues.some(v => eff.includes(v));
            }

            return selectedValues.includes(cardData[key]);
        });

        const matchesCost = cardData.cost >= costMin && cardData.cost <= costMax;
        const matchesPower = cardData.power >= powerMin && cardData.power <= powerMax;

        let visible = matchesKeyword && matchesFilters && matchesCost && matchesPower;

        // ✅ グループフィルター（activeId があるなら空でも適用）
        if (visible && groupFilterActive) {
        const cd = String(card.dataset.cd || '').padStart(5, '0');
        if (!groupSet || !groupSet.has(cd)) visible = false;
        }

        // 所持フィルター反映
        if (ownedBtnOn || compBtnOn || unCompBtnOn) {
            const cd = String(card.dataset.cd || '');
            const entry = ownedDataMap[cd];
            let total = 0;
            if (typeof entry === 'number') {
            total = entry;
            } else if (entry && typeof entry === 'object') {
            total = (entry.normal | 0) + (entry.shine | 0) + (entry.premium | 0);
            }

            if (ownedBtnOn && total <= 0) visible = false;

            if (compBtnOn) {
            const isOldGod = (card.dataset.race === '旧神');
            const need = isOldGod ? 1 : 3;
            if (total < need) visible = false;
            }

            if (unCompBtnOn) {
            const isOldGod = (card.dataset.race === '旧神');
            const ok = isOldGod ? (total === 0) : (total <= 2);
            if (!ok) visible = false;
            }
        }

        // リスト表示は行(.list-row)を消す
        const isList = !!gridRoot.classList?.contains?.('is-list');

        if (isList) {
        // ✅ リストでも card の display を visible と同期させる
        //    （syncListRowVisibility_ が card.display を見て row を上書きするため）
        card.style.display = visible ? '' : 'none';

        const row = card.closest('.list-row');
        if (row) {
            row.style.display = visible ? '' : 'none';
        }
        } else {
        card.style.display = visible ? '' : 'none';
        }
        });

        try { window.applyGrayscaleFilter?.(); } catch {}
        try { closeCgPreviewRow_(); } catch {} //フィルターが変わったらプレビューは閉じる
        renderActiveFilterChips();
        // ✅ リスト表示の row 表示を最終確定（cardsViewMode 側の同期関数があれば呼ぶ）
        try { window.syncListRowVisibility_?.(); } catch {}
        // ✅ 0件表示メッセージ
        try {
        const grid = document.getElementById('grid');
        let visibleCount = 0;
        if (grid) {
            grid.querySelectorAll('.card').forEach(el => {
            if (el.hidden) return;
            if (el.style.display === 'none') return;
            visibleCount++;
            });
        }
        renderEmptyState_(visibleCount);
        } catch {}
    }

    // ==============================
    // reset
    // ==============================
    function resetFilters() {
        const kw = document.getElementById('keyword');
        if (kw) kw.value = '';

        document.querySelectorAll('.filter-btn.selected').forEach(btn => {
        btn.classList.remove('selected');
        });

        const costMin = document.getElementById('cost-min');
        const costMax = document.getElementById('cost-max');
        const powerMin = document.getElementById('power-min');
        const powerMax = document.getElementById('power-max');

        if (costMin && costMax) {
        costMin.selectedIndex = 0;
        costMax.selectedIndex = costMax.options.length - 1;
        }
        if (powerMin && powerMax) {
        powerMin.selectedIndex = 0;
        powerMax.selectedIndex = powerMax.options.length - 1;
        }

        // 所持フィルター：OFFに戻す（4ボタン）
        const ownedGroup = document.querySelector('.filter-group[data-key="所持フィルター"]');
        if (ownedGroup) {
        ownedGroup.querySelectorAll('.filter-btn[data-owned]')
            .forEach(b => b.classList.remove('selected'));
        ownedGroup.querySelector('.filter-btn[data-owned="off"]')
            ?.classList.add('selected');
        }

        try { window.CardGroups?.setActive?.(''); } catch {}
        try { window.CardGroups?.stopEditing?.(); } catch {}
        try { window.__CardGroupsUI?.clearSelected?.(); } catch {}

        applyFilters();
        setQuickTypeUI_('all');
    }

    // ==============================
    // タイプ即時ボタン：状態同期ヘルパ
    // ==============================
    function normalizeQuickType_(t) {
        t = String(t ?? '').trim();
        return (t === 'all') ? '' : t;
    }

    function setQuickTypeUI_(mode, activeType) {
        // mode: 'all' | 'single' | 'multi'
        const wrap = document.querySelector('.type-quick-filter');
        const btns = Array.from(document.querySelectorAll('.type-icon-btn'));
        if (!btns.length) return;

        const allBtn =
            document.querySelector('.type-icon-btn[data-type=""]') ||
            document.querySelector('.type-icon-btn[data-type="all"]') ||
            btns[0];

        // 初期化
        btns.forEach(b => b.classList.remove('is-active'));
        if (wrap) wrap.classList.remove('is-multi');

        if (mode === 'multi') {
            if (wrap) wrap.classList.add('is-multi');

            // ✅ モーダル側で選ばれている type をすべてアクティブ表示
            const selectedTypes = Array.from(
                document.querySelectorAll('.filter-btn.selected[data-type]')
            ).map(b => normalizeQuickType_(b.dataset.type));

            btns.forEach(b => {
                const t = normalizeQuickType_(b.dataset.type);
                if (selectedTypes.includes(t)) {
                    b.classList.add('is-active');
                }
            });
            return;
        }

        if (mode === 'single') {
            const t = normalizeQuickType_(activeType);
            const hit = btns.find(b => normalizeQuickType_(b.dataset.type) === t);
            (hit || allBtn)?.classList.add('is-active');
            return;
        }

        // mode === 'all'
        allBtn?.classList.add('is-active');
    }

    function syncQuickTypeFromModal_() {
        const selected = Array.from(document.querySelectorAll('.filter-btn.selected[data-type]'))
            .map(b => String(b.dataset.type || '').trim())
            .filter(Boolean);

        if (selected.length === 0) {
            setQuickTypeUI_('all');
        } else if (selected.length === 1) {
            setQuickTypeUI_('single', selected[0]);
        } else {
            setQuickTypeUI_('multi');
        }
    }

    // ==============================
    // 初期化
    // ==============================
    function init() {
        // cardFilter UIが無いページでは何もしない
        const hasCardFilterUI =
        document.getElementById('filterModal') &&
        document.getElementById('main-filters') &&
        document.getElementById('detail-filters');

        if (!hasCardFilterUI) return;

        // CardGroups のアクティブ状態をクリア（ページ再訪問時の影響防止）
        try { window.CardGroups?.clearActiveOnBoot?.(); } catch {}

        // フィルターボタン（selected切替）＋タイプ即時フィルター
        document.addEventListener('click', (e) => {

        // ==============================
        // タイプ即時フィルター（search-bar）
        //  - 押したら「1種類に上書き」
        //  - 同じボタンを押したら「全解除」（単独選択時のみ）
        //  - 切替時はカード一覧の先頭にスクロール
        //  - チップバーにタイプは出さない
        // ==============================
        const typeBtn = e.target.closest('.type-icon-btn');
        if (typeBtn) {
        const type = normalizeQuickType_(typeBtn.dataset.type || '');

        // ✅ いまモーダル側で選ばれているタイプ一覧
        const selectedTypeBtns = Array.from(
            document.querySelectorAll('.filter-group[data-key="タイプ"] .filter-btn.selected[data-type]')
        );
        const selectedTypes = selectedTypeBtns
            .map(b => normalizeQuickType_(b.dataset.type))
            .filter(Boolean);

        // ✅ スクロール（sticky top-bar 分のオフセット込み）
        function scrollToFirstVisibleCard_() {
        const grid = document.getElementById('grid');
        if (!grid) return;

        const topBar = document.querySelector('.top-bar'); // sticky のやつ
        const offset = (topBar?.offsetHeight || 0) + 6;     // ちょい余白

        // “見える最初のカード”に寄せる（無ければgrid先頭）
        const first = Array.from(grid.querySelectorAll('.card'))
            .find(el => el.style.display !== 'none' && !el.hidden);

        const target = first || grid;

        // 現在位置（ページ全体のY）
        const y = window.pageYOffset + target.getBoundingClientRect().top - offset;

        // すでに上の方ならスクロールしない（ガタつき防止）
        const curTop = window.pageYOffset;
        if (Math.abs(curTop - y) < 24) return;

        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
        }

        // ✅ ④：同じタイプが「単独で」選択済みなら全解除に戻す
        const isSameSingle =
            type &&
            selectedTypes.length === 1 &&
            selectedTypes[0] === type;

        // ✅ まずモーダル側 type を全解除
        document.querySelectorAll('.filter-group[data-key="タイプ"] .filter-btn[data-type]')
            .forEach(fb => fb.classList.remove('selected'));

        if (!type || isSameSingle) {
            // 全カード
            setQuickTypeUI_('all');
        } else {
            // 単一タイプに上書き
            const target = document.querySelector(
            `.filter-group[data-key="タイプ"] .filter-btn[data-type="${CSS.escape(type)}"]`
            );
            if (target) target.classList.add('selected');
            setQuickTypeUI_('single', type);
        }

        applyFilters();
        scrollToFirstVisibleCard_();
        return; // ← 下の filter-btn 処理へ落とさない
        }


        // ==============================
        // 既存：filter-btn
        // ==============================
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;

        // 投稿フィルター用タグボタンは別処理
        if (btn.classList.contains('post-filter-tag-btn')) return;

        // ==============================
        // 所持フィルター（4ボタン：完全排他）
        // ==============================
        const ownedGroup = btn.closest('.filter-group[data-key="所持フィルター"]');
        if (ownedGroup && btn.dataset.owned) {
        const isAlready = btn.classList.contains('selected');
        const isOffBtn  = (btn.dataset.owned === 'off');

        // いったん全解除
        ownedGroup.querySelectorAll('.filter-btn[data-owned]')
            .forEach(b => b.classList.remove('selected'));

        if (isOffBtn) {
            // OFFは常にONにする
            btn.classList.add('selected');
        } else if (isAlready) {
            // ✅ 同じボタンをもう一回 → OFFへ
            ownedGroup.querySelector('.filter-btn[data-owned="off"]')
            ?.classList.add('selected');
        } else {
            // 通常は押したものをON
            btn.classList.add('selected');
        }

        applyFilters();
        return;
        }

        // ==============================
        // カードグループ（単一選択）
        // ==============================
        const groupFilter = btn.closest('.filter-group[data-key="カードグループ"]');
        if (groupFilter && btn.dataset.group != null) {
        const isAlready = btn.classList.contains('selected');
        const id = String(btn.dataset.group || '');

        // いったん全解除
        groupFilter.querySelectorAll('.filter-btn[data-group]').forEach(b => b.classList.remove('selected'));

        if (!isAlready && id) {
            btn.classList.add('selected');
            try { window.CardGroups?.setActive?.(id); } catch {}
        } else {
            // ✅ 指定なしボタンは無いので「全部未選択」にする
            try { window.CardGroups?.setActive?.(''); } catch {}
        }

        applyFilters();
        return;
        }

        const group = btn.closest('.filter-group');

        // ✅ 通常フィルター：selected トグル
        if (group) {
        // 単一選択にしたいグループがあればここに追加（例：BPなどを単一にするなら）
        // const isSingle = (group.dataset.key === 'BP（ブレッシングポイント）要素');

        // 基本は複数選択OKなので toggle
        btn.classList.toggle('selected');

        // タイプ複数選択 → 上部のタイプ即時ボタン表示も同期
        if (group.dataset.key === 'タイプ') {
            syncQuickTypeFromModal_();
        }

        applyFilters();
        return;
        }

        // group が無いケースは一応そのまま
        applyFilters();
        });
        document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('filterModal');
        if (e.key === 'Escape' && modal && modal.style.display === 'flex') closeFilterModal();

        const drop = e.target?.closest?.('.cg-drop');
            if (!drop) return;
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            drop.click();
        });
        // モーダル外（背景）タップで閉じる（1回だけバインド）
        if (!window.__filterModalBackdropBound) {
        window.__filterModalBackdropBound = true;

        document.addEventListener('click', (e) => {
            const modal = document.getElementById('filterModal');
            if (!modal || modal.style.display !== 'flex') return;

            // 背景（モーダルの外側）そのものをクリックした時だけ閉じる
            if (e.target === modal) closeFilterModal();
        });
        }

        // タブバインド（上で定義済みの bindModalTabs_ を使う）
        bindModalTabs_();

        // 起動時：最後のタブを復元
        const savedTab = (() => {
        try { return localStorage.getItem('cardFilterModalTab') || 'filters'; } catch { return 'filters'; }
        })();
        setModalTab_(savedTab);

        // UI生成＋状態同期
        generateFilterUI().catch(console.warn).then(() => {
            try { syncGroupFilterUIFromState_(); } catch {}
        });

        // ==============================
        // CardGroups 更新 → フィルター側「カードグループ」欄を差し替え
        // ==============================
        try {
        if (window.CardGroups?.onChange) {
            window.CardGroups.onChange(() => {
            refreshCardGroupFilterUI_();       // ボタン一覧(名前/枚数)を更新
            renderActiveFilterChips();         // チップ表示も更新（グループ名変わるので）
            });
        }
        } catch {}

        updateChipsOffset();
        window.addEventListener('resize', updateChipsOffset);

        // キーワード：デバウンス
        const kw = document.getElementById('keyword');
        if (kw) kw.addEventListener('input', debounce(() => applyFilters(), 300));

        // Applyボタン（モーダル内）
        document.getElementById('applyFilterBtn')?.addEventListener('click', () => {
        applyFilters();
        closeFilterModal();
        });
    }

    // -----------------------
    // 外部公開（互換用）
    // -----------------------
    window.CardFilter = {
        init,
        applyFilters,
        resetFilters,
        openFilterModal,
        closeFilterModal,
        toggleDetailFilters,
    };

    // 既存コード互換：グローバル関数名を維持
    window.applyFilters = applyFilters;
    window.resetFilters = resetFilters;
    window.openFilterModal = openFilterModal;
    window.closeFilterModal = closeFilterModal;
    window.toggleDetailFilters = toggleDetailFilters;

    // DOMContentLoaded で起動
    document.addEventListener('DOMContentLoaded', init);

})();
