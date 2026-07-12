/* =========================
 * js/pages/tier/tier-page.js
 * - Tier表ページの最新データ反映
 * ========================= */
(function () {
    'use strict';

    const TIER_API_URL = 'https://script.google.com/macros/s/AKfycbww_gGboqJK5g5Fw3wLXSQO0uGw9Zx8pRG9F9falVfb_aVkwb_KcVmr6sK2RpjOw8mS3Q/exec';
    const TIER_ORDER = ['S', 'A', 'B', 'C', 'D', 'E'];
    const MAIN_RACES = ['ドラゴン', 'アンドロイド', 'エレメンタル', 'ルミナス', 'シェイド'];
    const RACE_BG_CLASS_NAMES = [
        ...MAIN_RACES.map((race) => `race-bg-${race}`),
        'race-bg-イノセント',
        'race-bg-旧神'
    ];
    const state = {
        environments: [],
        currentEnvironmentIndex: 0,
        postCache: new Map(),
        guideDeckListHtmlCache: new Map(),
        prefetchedPostPages: new Set(),
        guideObserver: null,
        guideLoadQueue: [],
        guideActiveLoads: 0,
        triedBatchLoad: false
    };
    const TIER_CACHE_KEY = 'tier-list-cache-v1';
    const TIER_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
    const TIER_FETCH_MAX_ATTEMPTS = 3;
    const TIER_FETCH_RETRY_BASE_DELAY_MS = 1000;
    const GUIDE_LOAD_CONCURRENCY = 2;

    function setStatus(text) {
        const status = document.querySelector('.tier-board-status');
        if (!status) return;

        status.textContent = text;
        status.classList.remove('is-error');
    }

    function setStatusError(text) {
        const status = document.querySelector('.tier-board-status');
        if (!status) return;

        status.textContent = text;
        status.classList.add('is-error');
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[ch]);
    }

    function normalizeTier(tier) {
        const value = String(tier || '').trim().toUpperCase();
        return value || 'その他';
    }

    function getTierClassName(tier) {
        const normalized = normalizeTier(tier).toLowerCase();
        return /^[a-z0-9_-]+$/.test(normalized) ? normalized : 'other';
    }

    function getTierScore(item) {
        const score = Number(item && item.tierScore);
        return Number.isFinite(score) ? score : Number.MAX_SAFE_INTEGER;
    }

    function isFiniteNumberLike(value) {
        const text = String(value ?? '').trim();
        if (!text) return false;
        return Number.isFinite(Number(text));
    }

    function isPostUrlLike(value) {
        const text = String(value ?? '').trim();
        return /^https?:\/\//i.test(text) || /[?&](?:pid|postId)=/i.test(text);
    }

    function normalizeImageFileName(value) {
        return String(value || '')
            .trim()
            .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    }

    function scoreToTier(score) {
        if (score < 100) return 'S';
        if (score < 200) return 'A';
        if (score < 300) return 'B';
        if (score < 400) return 'C';
        if (score < 500) return 'D';
        if (score < 600) return 'E';
        return 'その他';
    }

    function normalizeTierItem(item) {
        const normalized = { ...(item || {}) };
        const imageFile = String(normalized.imageFile || '').trim();
        const tierScore = String(normalized.tierScore ?? '').trim();
        const comment = String(normalized.comment || '').trim();
        const postUrl = String(normalized.postUrl || '').trim();

        if (isFiniteNumberLike(imageFile) && !isFiniteNumberLike(tierScore)) {
            normalized.tierScore = Number(imageFile);
            normalized.tier = scoreToTier(normalized.tierScore);
            normalized.comment = tierScore;
            normalized.postUrl = isPostUrlLike(comment) && !postUrl ? comment : postUrl;
            normalized.imageFile = '';
        }

        return normalized;
    }

    function loadTierCache() {
        try {
            const raw = localStorage.getItem(TIER_CACHE_KEY);
            if (!raw) return null;

            const cache = JSON.parse(raw);
            if (!cache || !cache.savedAt || !cache.data) return null;
            if (Date.now() - cache.savedAt > TIER_CACHE_MAX_AGE) return null;

            return cache.data;
        } catch (_) {
            return null;
        }
    }

    function saveTierCache(data) {
        try {
            localStorage.setItem(TIER_CACHE_KEY, JSON.stringify({
                savedAt: Date.now(),
                data
            }));
        } catch (_) {}
    }

    function applyTierData(data) {
        data.items = (data.items || []).map(normalizeTierItem);

        if (Array.isArray(data.environments) && data.environments.length) {
            state.environments = data.environments.map(normalizeTierEnvironment);
        } else {
            state.environments = [{
                environmentName: '最新',
                tierComment: '',
                items: data.items
            }];
        }

        renderEnvironment(0);
    }

    function isReloadNavigation() {
        try {
            const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
            if (nav && nav.type) return nav.type === 'reload';
            return performance.navigation && performance.navigation.type === 1;
        } catch (_) {
            return false;
        }
    }

    function normalizeTierEnvironment(environment) {
        return {
            ...(environment || {}),
            items: getEnvironmentItems(environment).map(normalizeTierItem)
        };
    }

    function getGuideDeckMetaItems(item) {
        const author = String(item && item.author || '').trim();
        const createdAt = String(item && item.createdAt || '').trim();
        const metaItems = [];

        if (createdAt) metaItems.push(`作成日：${createdAt}`);
        if (author) metaItems.push(`投稿者：${author}`);

        return metaItems;
    }

    function getPostIdFromUrl(url) {
        try {
            const parsed = new URL(String(url || ''), location.href);
            return String(parsed.searchParams.get('pid') || parsed.searchParams.get('postId') || '').trim();
        } catch (_) {
            const match = String(url || '').match(/[?&](?:pid|postId)=([^&]+)/);
            return match ? decodeURIComponent(match[1]) : '';
        }
    }

    function getMainRaceFromRaces(races) {
        const values = Array.isArray(races)
            ? races
            : String(races || '').split(/[,\s、/／]+/);
        const normalized = values.map((race) => String(race || '').trim()).filter(Boolean);
        const mainRace = MAIN_RACES.find((race) => normalized.includes(race));
        return mainRace || normalized.find((race) => race === '旧神' || race === 'イノセント') || '';
    }

    function getTierItemRace(item) {
        return getMainRaceFromRaces(item && (item.race || item.races));
    }

    function applyGuideDeckRace(guideCard, item) {
        if (!guideCard) return;

        const columnRace = String(guideCard.dataset.tierColumnRace || '').trim();
        const fallbackRace = String(guideCard.dataset.race || '').trim();
        const race = columnRace || getTierItemRace(item) || fallbackRace;
        guideCard.classList.remove(...RACE_BG_CLASS_NAMES);
        guideCard.dataset.race = race;
        if (race) guideCard.classList.add(`race-bg-${race}`);
    }

    function getDeckGuideId(item) {
        const postUrl = String(item && item.postUrl || '').trim();
        const postId = getPostIdFromUrl(postUrl);
        if (postId) return `post-${postId}`;

        const tier = normalizeTier(item && item.tier);
        const deckName = String(item && item.deckName || 'deck').trim();
        const score = String(item && item.tierScore || '').trim();
        return `deck-${encodeURIComponent(`${tier}-${score}-${deckName}`)}`;
    }

    function getDeckCode(item) {
        return String(item && (item.shareCode || item.deckCode || item.code) || '').trim();
    }

    function getPostDetailHref(postUrl) {
        const postId = getPostIdFromUrl(postUrl);
        return postId ? `deck-post.html?pid=${encodeURIComponent(postId)}` : String(postUrl || '').trim();
    }

    function prefetchPostDetailPage(href) {
        const url = String(href || '').trim();
        if (!url || !document.head || state.prefetchedPostPages.has(url)) return;

        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = url;
        link.dataset.tierPrefetch = url;
        document.head.append(link);
        state.prefetchedPostPages.add(url);
    }

    function storePostTransfer(postId) {
        const pid = String(postId || '').trim();
        const item = pid ? state.postCache.get(pid) : null;
        if (!pid || !item || typeof sessionStorage === 'undefined') return;

        try {
            sessionStorage.setItem(`deck-post-transfer:${pid}`, JSON.stringify({
                expiresAt: Date.now() + 5 * 60 * 1000,
                item
            }));
        } catch (_) {
            // sessionStorage が使えない環境では通常遷移に任せる。
        }
    }

    function getEnvironmentItems(environment) {
        return Array.isArray(environment && environment.items) ? environment.items : [];
    }

    function getEnvironmentName(environment, index) {
        const name = String(environment && environment.environmentName || '').trim();
        return name || `環境${index + 1}`;
    }

    function setBoardTitle(environment, index) {
        const title = document.getElementById('tierBoardTitle');
        if (!title || !environment) return;

        title.textContent = `${index === 0 ? '最新Tier表' : 'Tier表'}《${getEnvironmentName(environment, index)}》`;
        setStatus(`${index === 0 ? '最新' : '表示中'}：${getEnvironmentName(environment, index)}`);
    }

    function setGuideEnvironmentLabel(environment, index) {
        const title = document.getElementById('tierDeckGuideTitle');
        if (title) {
            title.textContent = `デッキ紹介《${getEnvironmentName(environment, index)}》`;
        }

        document.querySelectorAll('[data-tier-guide-environment]').forEach((label) => {
            label.textContent = `${index === 0 ? '最新' : '表示中'}：${getEnvironmentName(environment, index)}`;
            label.classList.remove('is-error');
        });
    }

    function setGuideEnvironmentStatus(text, isError) {
        document.querySelectorAll('[data-tier-guide-environment]').forEach((label) => {
            label.textContent = text;
            label.classList.toggle('is-error', !!isError);
        });
    }

    function setEnvironmentComment(environment) {
        const commentSection = document.querySelector('.tier-environment-comment');
        const commentText = document.querySelector('[data-tier-environment-comment]');
        if (!commentSection || !commentText) return;

        const comment = String(environment && environment.tierComment || '').trim();
        commentSection.hidden = !comment;
        commentText.textContent = comment;
    }

    function updateEnvironmentControls() {
        const prevButtons = document.querySelectorAll('[data-tier-env-prev]');
        const nextButtons = document.querySelectorAll('[data-tier-env-next]');
        const hasMultipleEnvironments = state.environments.length > 1;

        prevButtons.forEach((prevButton) => {
            prevButton.disabled = !hasMultipleEnvironments || state.currentEnvironmentIndex >= state.environments.length - 1;
        });

        nextButtons.forEach((nextButton) => {
            nextButton.disabled = !hasMultipleEnvironments || state.currentEnvironmentIndex <= 0;
        });
    }

    function groupItemsByTier(items) {
        return items.reduce((groups, item) => {
            const tier = normalizeTier(item.tier);
            if (!groups.has(tier)) groups.set(tier, []);
            groups.get(tier).push(item);
            return groups;
        }, new Map());
    }

    function getTierDeckKey(item) {
        const deckName = String(item && item.deckName || '').trim();
        return deckName || getDeckGuideId(item);
    }

    function getTierDeckGroupId(item) {
        const tier = normalizeTier(item && item.tier);
        const key = getTierDeckKey(item);
        return `deck-group-${encodeURIComponent(`${tier}-${key}`)}`;
    }

    function mergeTierBoardItems(items) {
        const mergedMap = new Map();

        items
            .slice()
            .sort((a, b) => getTierScore(a) - getTierScore(b))
            .forEach((item) => {
                const key = getTierDeckKey(item);
                if (!key) return;

                const existing = mergedMap.get(key);
                if (!existing) {
                    mergedMap.set(key, {
                        item,
                        sampleCount: 1
                    });
                    return;
                }

                existing.sampleCount += 1;
            });

        return Array.from(mergedMap.values()).map(({ item, sampleCount }) => ({
            ...item,
            tierSampleCount: sampleCount,
            tierGuideGroupId: sampleCount > 1 ? getTierDeckGroupId(item) : ''
        }));
    }

    function groupGuideItemsByDeck(items) {
        const groups = new Map();

        items
            .slice()
            .sort((a, b) => getTierScore(a) - getTierScore(b))
            .forEach((item) => {
                const groupId = getTierDeckGroupId(item);
                if (!groups.has(groupId)) groups.set(groupId, []);
                groups.get(groupId).push(item);
            });

        return Array.from(groups.values());
    }

    function getOrderedTiers(groups) {
        const knownTiers = TIER_ORDER.filter((tier) => groups.has(tier));
        const otherTiers = Array.from(groups.keys())
            .filter((tier) => !TIER_ORDER.includes(tier))
            .sort((a, b) => a.localeCompare(b, 'ja'));

        return [...knownTiers, ...otherTiers];
    }

    function createDeckCard(item) {
        const deckName = String(item.deckName || '名称未設定').trim() || '名称未設定';
        const imageFile = normalizeImageFileName(deckName);
        const postUrl = String(item.postUrl || '').trim();
        const detailHref = getPostDetailHref(postUrl);
        const card = document.createElement(detailHref ? 'a' : 'article');

        card.className = 'tier-card';
        card.dataset.guideId = item.tierGuideGroupId || getDeckGuideId(item);
        if (detailHref) {
            card.href = detailHref;
            card.rel = 'noopener';
            card.dataset.postUrl = postUrl;
            card.dataset.postId = getPostIdFromUrl(postUrl);
        }

        const imageWrap = document.createElement('div');
        imageWrap.className = 'tier-card-image-wrap';

        if (imageFile) {
            const image = document.createElement('img');
            image.src = `img/${imageFile}.webp`;
            image.alt = deckName;
            image.loading = 'lazy';
            image.addEventListener('error', () => {
                if (!image.dataset.triedFallback) {
                    image.dataset.triedFallback = 'true';
                    image.src = `img/${imageFile}_.webp`;
                    return;
                }

                image.hidden = true;
                imageWrap.classList.add('is-image-missing');
            });
            imageWrap.append(image);
        } else {
            imageWrap.classList.add('is-image-missing');
        }

        const name = document.createElement('span');
        name.className = 'tier-card-name';
        name.textContent = deckName;

        card.append(imageWrap, name);

        return card;
    }

    function normalizeCd5(cd) {
        if (typeof window.normCd5 === 'function') return window.normCd5(cd);
        const value = String(cd ?? '').trim();
        return value ? value.padStart(5, '0').slice(0, 5) : '';
    }

    function parseJsonObject(value) {
        if (!value) return null;
        if (typeof value === 'object') return value;
        try {
            const parsed = JSON.parse(String(value));
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function extractDeckMap(item) {
        let deck = null;

        if (Array.isArray(item && item.cards) && item.cards.length) {
            deck = {};
            item.cards.forEach((card) => {
                const cd = String(card && (card.cd || card.id || card.cardId || card.code) || '').trim();
                const count = Number(card && (card.count ?? card.num ?? card.n ?? 1)) || 0;
                if (cd && count > 0) deck[cd] = (deck[cd] || 0) + count;
            });
        } else if (item && item.cards && typeof item.cards === 'object') {
            deck = item.cards;
        } else {
            deck =
                parseJsonObject(item && item.cardsJSON) ||
                parseJsonObject(item && item.deck) ||
                parseJsonObject(item && item.codeNorm);
        }

        if (!deck || typeof deck !== 'object') return null;

        const normalized = {};
        Object.entries(deck).forEach(([cd, countRaw]) => {
            const cd5 = normalizeCd5(cd);
            const count = Number(countRaw || 0) || 0;
            if (cd5 && count > 0) normalized[cd5] = (normalized[cd5] || 0) + count;
        });

        return Object.keys(normalized).length ? normalized : null;
    }

    function normalizeFetchedPost(data, postId) {
        const src = data && (data.item || data.post || data.data) || data || {};
        const payload = parseJsonObject(src.payload || src.payloadJSON || src.rawPayload);
        const item = { ...(payload || {}), ...src };
        item.postId = String(item.postId || postId || '').trim();
        return item.postId ? item : null;
    }

    function getCardName(cd) {
        const card = window.cardMap && window.cardMap[cd];
        return card && card.name ? card.name : cd;
    }

    function getCardImageSrc(cd) {
        const card = window.cardMap && window.cardMap[cd];
        if (typeof window.getCardImageSrc === 'function') {
            return window.getCardImageSrc(card || cd);
        }
        return `img/${cd}.webp`;
    }

    function createDeckListCard(cd, count) {
        const item = document.createElement('div');
        item.className = 'tier-post-card';
        item.dataset.cd = cd;
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.setAttribute('aria-label', `${getCardName(cd)}の詳細を開く`);

        const image = document.createElement('img');
        image.src = getCardImageSrc(cd);
        image.alt = getCardName(cd);
        image.loading = 'lazy';
        image.addEventListener('error', () => {
            image.src = 'img/00000.webp';
        }, { once: true });

        const badge = document.createElement('span');
        badge.className = 'tier-post-card-count';
        badge.textContent = `x${count}`;

        item.append(image, badge);
        return item;
    }

    function getCardIdFromTierPostCard(card) {
        const fromData = normalizeCd5(card && card.dataset && card.dataset.cd);
        if (fromData) return fromData;

        const image = card && card.querySelector('img[src]');
        const match = String(image && image.getAttribute('src') || '').match(/(?:^|\/)(\d{5})\.webp(?:[?#].*)?$/);
        return match ? normalizeCd5(match[1]) : '';
    }

    function isSmartphoneCardDetailDrawer() {
        return window.matchMedia && window.matchMedia('(max-width: 1023px)').matches;
    }

    function closeTierCardDetailDrawer() {
        const drawer = document.getElementById('cardDetailDrawer');
        if (drawer) drawer.style.display = 'none';
    }

    function ensureTierCardDetailDrawer() {
        let drawer = document.getElementById('cardDetailDrawer');
        if (drawer) return drawer;

        drawer = document.createElement('div');
        drawer.id = 'cardDetailDrawer';
        drawer.style.display = 'none';
        drawer.innerHTML = `
            <div class="carddetail-drawer-inner" role="dialog" aria-modal="true" aria-label="カード詳細">
                <div class="carddetail-inner"></div>
            </div>
        `;
        document.body.append(drawer);

        drawer.addEventListener('click', (event) => {
            const zoomButton = event.target.closest('.detail-zoom-btn');
            if (zoomButton) {
                const cd = normalizeCd5(zoomButton.dataset.cd);
                if (cd) window.CardZoomModal?.open?.(cd);
                return;
            }

            if (event.target === drawer || event.target.closest('.carddetail-close')) {
                closeTierCardDetailDrawer();
            }
        });

        return drawer;
    }

    function nl2br(value) {
        return escapeHtml(value).replace(/\r?\n/g, '<br>');
    }

    function getTierCardPackHtml(card) {
        const packRaw = card.pack_name || card.packName || '';
        if (!packRaw) return '';

        const pack = typeof window.splitPackName === 'function'
            ? window.splitPackName(packRaw)
            : { en: String(packRaw), jp: '' };
        const packKey = getTierCardPackKey(packRaw, pack.en);
        return `
            <div class="carddetail-pack"${packKey ? ` data-pack="${escapeHtml(packKey)}"` : ''}>
                ${pack.en ? `<div class="carddetail-pack-en">${escapeHtml(pack.en)}</div>` : ''}
                ${pack.jp ? `<div class="carddetail-pack-jp">${escapeHtml(pack.jp)}</div>` : ''}
            </div>
        `;
    }

    function getTierCardPackKey(packRaw, packEn) {
        const deckPostPackKey = window.DeckPostDetail && window.DeckPostDetail.packKeyFromAbbr_;
        const enName = String(packEn || packRaw || '').trim();
        const low = enName.toLowerCase();
        let abbr = '';

        if (low.includes('awakening the oracle') || low.includes('awaking the oracle')) abbr = 'Aパック';
        else if (low.includes('beyond the sanctuary')) abbr = 'Bパック';
        else if (low.includes('creeping souls')) abbr = 'Cパック';
        else if (low.includes('drawn sword')) abbr = 'Dパック';
        else if (low.includes('ensemble of silence') || low.includes('ensemble of slience')) abbr = 'Eパック';
        else if (low.includes('fallen fate')) abbr = 'Fパック';
        else if (low.includes('glory of the gods')) abbr = 'Gパック';
        else if (low.includes('honor of the brave heart')) abbr = 'Hパック';
        else if (enName.includes('コラボ') || low.includes('collab')) abbr = 'コラボ';
        else if (enName.includes('その他特殊') || low.includes('special')) abbr = '特殊';
        else abbr = enName;

        if (typeof deckPostPackKey === 'function') return deckPostPackKey(abbr);
        if (typeof window.packKeyFromAbbr === 'function') return window.packKeyFromAbbr(abbr);
        if (/^([A-Z])パック/.test(abbr)) return abbr[0];
        if (abbr.includes('コラボ')) return 'COLLAB';
        if (abbr.includes('特殊')) return 'SPECIAL';
        return '';
    }

    function getTierCardRarityKey(rarity) {
        if (typeof window.DeckPostDetail?.rarityKeyForPage4_ === 'function') {
            return window.DeckPostDetail.rarityKeyForPage4_(rarity);
        }

        const text = String(rarity || '').trim();
        const low = text.toLowerCase();
        if (text.includes('レジェンド') || low.includes('legend')) return 'legend';
        if (text.includes('ゴールド') || low.includes('gold')) return 'gold';
        if (text.includes('シルバー') || low.includes('silver')) return 'silver';
        if (text.includes('ブロンズ') || low.includes('bronze')) return 'bronze';
        return '';
    }

    function getTierCardRarityClass(rarity) {
        if (typeof window.DeckPostDetail?.rarityPillClassForPage4_ === 'function') {
            return window.DeckPostDetail.rarityPillClassForPage4_(rarity);
        }

        const key = getTierCardRarityKey(rarity);
        return key ? `carddetail-rarity--${key}` : '';
    }

    function getTierCardEffectHtml(card) {
        const effectItems = [
            [card.effect_name1 || '', card.effect_text1 || ''],
            [card.effect_name2 || '', card.effect_text2 || '']
        ].filter(([name, text]) => name || text);

        if (!effectItems.length) {
            return '<div class="carddetail-empty">カードテキストが未登録です。</div>';
        }

        return effectItems.map(([name, text]) => `
            <div class="carddetail-effect">
                ${name ? `<div class="carddetail-effect-name">${escapeHtml(name)}</div>` : ''}
                ${text ? `<div class="carddetail-effect-text">${nl2br(text)}</div>` : ''}
            </div>
        `).join('');
    }

    function buildTierCardDetailHtml(cd) {
        const card = (window.cardMap || {})[cd] || { cd, name: cd };
        const cardName = card.name || cd;
        const race = card.race || (Array.isArray(card.races) ? card.races[0] : '') || '';
        const rarity = card.rarity || '';
        const rarityClass = getTierCardRarityClass(rarity);

        return `
            <div class="carddetail-head">
                <div class="carddetail-thumb">
                    <img
                        src="${escapeHtml(getCardImageSrc(cd))}"
                        alt="${escapeHtml(cardName)}"
                        loading="lazy"
                        class="carddetail-thumb-img"
                        data-cd="${escapeHtml(cd)}"
                    >
                </div>

                <div class="carddetail-meta">
                    <div class="card-title-row">
                        <button type="button" class="detail-zoom-btn" data-cd="${escapeHtml(cd)}" aria-label="画像を拡大" title="画像を拡大">
                            <img class="zoom-ic" src="./img/zoom_in_24.svg" alt="" aria-hidden="true" decoding="async">
                        </button>
                        <div class="carddetail-name">${escapeHtml(cardName)}</div>
                    </div>
                    <div class="carddetail-sub">
                        ${getTierCardPackHtml(card)}
                        <div class="carddetail-cat-rarity">
                            ${race ? `<span class="carddetail-cat cat-${escapeHtml(race)}">${escapeHtml(race)}</span>` : ''}
                            ${rarity ? `<span class="stat-chip carddetail-rarity ${escapeHtml(rarityClass)}">${escapeHtml(rarity)}</span>` : ''}
                        </div>
                    </div>
                </div>

                <button type="button" class="carddetail-close" aria-label="閉じる">×</button>
            </div>

            <div class="carddetail-body">
                ${getTierCardEffectHtml(card)}
            </div>
        `;
    }

    function openTierPostCardDetailDrawer(cd) {
        const html = buildTierCardDetailHtml(cd);
        if (!html) return false;

        const drawer = ensureTierCardDetailDrawer();
        const inner = drawer.querySelector('.carddetail-inner');
        if (!inner) return false;

        inner.innerHTML = html;
        drawer.style.display = 'block';
        return true;
    }

    async function openTierPostCardDetail(card) {
        const cd = getCardIdFromTierPostCard(card);
        if (!cd) return;

        if (typeof window.ensureCardMapLoaded === 'function') {
            await window.ensureCardMapLoaded().catch(() => null);
        }

        if (isSmartphoneCardDetailDrawer() && openTierPostCardDetailDrawer(cd)) {
            return;
        }

        const anchorRect = card.getBoundingClientRect();
        if (typeof window.openCardDetailModal === 'function') {
            window.openCardDetailModal(cd, { anchorRect });
        } else {
            document.dispatchEvent(new CustomEvent('open-card-detail', {
                detail: { cardId: cd, anchorRect }
            }));
        }
    }

    function hasRenderedDeckList(list) {
        return !!(list && list.querySelector('.tier-post-card'));
    }

    function renderDeckList(item, list) {
        if (!list) return false;

        const deck = extractDeckMap(item);
        if (!deck) {
            if (!hasRenderedDeckList(list)) {
                list.innerHTML = '<div class="tier-post-detail-empty">デッキリスト未登録</div>';
            }
            return false;
        }

        const entries = typeof window.sortCardEntries === 'function'
            ? window.sortCardEntries(Object.entries(deck), window.cardMap || {})
            : Object.entries(deck);

        list.replaceChildren(...entries.map(([cd, count]) => createDeckListCard(normalizeCd5(cd), count)));
        return true;
    }

    function getGuideDeckListCacheKeyFromValues(postId, guideId) {
        const pid = String(postId || '').trim();
        if (pid) return `post:${pid}`;

        const gid = String(guideId || '').trim();
        return gid ? `guide:${gid}` : '';
    }

    function getGuideDeckListCacheKey(guideCard) {
        if (!guideCard) return '';
        return getGuideDeckListCacheKeyFromValues(guideCard.dataset.postId, guideCard.dataset.guideId);
    }

    function saveRenderedGuideDeckList(guideCard) {
        const key = getGuideDeckListCacheKey(guideCard);
        const list = guideCard && guideCard.querySelector('[data-tier-guide-list]');
        if (!key || !hasRenderedDeckList(list)) return;

        state.guideDeckListHtmlCache.set(key, list.innerHTML);
    }

    function getCachedGuideDeckListHtml(postId, guideId) {
        const key = getGuideDeckListCacheKeyFromValues(postId, guideId);
        return key ? state.guideDeckListHtmlCache.get(key) || '' : '';
    }

    function renderGuideDecksFromCache() {
        document.querySelectorAll('.tier-guide-deck[data-post-id]').forEach((guideCard) => {
            const postId = String(guideCard.dataset.postId || '').trim();
            const item = postId ? state.postCache.get(postId) : null;
            const list = guideCard.querySelector('[data-tier-guide-list]');
            if (!item || !list) return;

            applyGuideDeckRace(guideCard, item);
            setGuideDeckCodeButton(guideCard, getDeckCode(item));
            const rendered = renderDeckList(item, list);
            guideCard.dataset.loaded = rendered ? '1' : '0';
            setGuideDeckStatus(guideCard, rendered ? '' : 'デッキリスト未登録', !rendered);
            if (rendered) saveRenderedGuideDeckList(guideCard);
        });
    }

    function setGuideDeckStatus(card, text, isError) {
        const status = card && card.querySelector('[data-tier-guide-status]');
        if (!status) return;

        status.textContent = text;
        status.classList.toggle('is-error', !!isError);
    }

    function setGuideDeckCodeButton(card, code) {
        const button = card && card.querySelector('[data-tier-guide-copy-code]');
        const codeValue = String(code || '').trim();
        if (!button) return;

        button.dataset.code = codeValue;
        button.disabled = !codeValue;
        button.textContent = codeValue ? 'デッキコードをコピー' : 'デッキコードなし';
        button.setAttribute('aria-disabled', codeValue ? 'false' : 'true');
    }

    async function copyGuideDeckCode(button) {
        const code = String(button && button.dataset.code || '').trim();
        if (!button || !code || button.disabled) return;

        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(code);
                if (typeof window.showMiniToast_ === 'function') {
                    window.showMiniToast_('デッキコードをコピーしました');
                }
                return;
            }
        } catch (error) {
            console.warn('[tier] デッキコードをコピーできませんでした。', error);
        }

        alert('デッキコードをコピーできませんでした');
    }

    async function fetchPostById(postId) {
        if (state.postCache.has(postId)) return state.postCache.get(postId);

        const base = window.DECKPOST_API_BASE || window.GAS_API_BASE || '';
        if (!base) throw new Error('デッキ投稿APIが設定されていません');

        const url = new URL(base);
        url.searchParams.set('mode', 'get');
        url.searchParams.set('postId', postId);

        const data = await fetchPostJson(url.toString());
        if (!data || data.ok === false) throw new Error(data && (data.reason || data.error) || 'デッキ投稿を取得できませんでした');

        const item = normalizeFetchedPost(data, postId);
        if (!item) throw new Error('デッキ投稿の形式が不正です');

        state.postCache.set(postId, item);
        return item;
    }

    async function fetchPostsByIds(postIds) {
        const ids = Array.from(new Set((postIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
        if (!ids.length) return [];

        const missingIds = ids.filter((id) => !state.postCache.has(id));
        if (!missingIds.length) return ids.map((id) => state.postCache.get(id)).filter(Boolean);

        const base = window.DECKPOST_API_BASE || window.GAS_API_BASE || '';
        if (!base) throw new Error('デッキ投稿APIが設定されていません');

        const url = new URL(base);
        url.searchParams.set('mode', 'batchGetPosts');
        url.searchParams.set('postIds', missingIds.join(','));

        const data = await fetchPostJson(url.toString());
        if (!data || data.ok === false) throw new Error(data && (data.reason || data.error) || 'デッキ投稿を一括取得できませんでした');

        const rows = Array.isArray(data.items)
            ? data.items
            : (Array.isArray(data.posts) ? data.posts : []);

        rows.forEach((row) => {
            const postId = String(row && row.postId || '').trim();
            const item = normalizeFetchedPost(row, postId);
            if (postId && item) state.postCache.set(postId, item);
        });

        return ids.map((id) => state.postCache.get(id)).filter(Boolean);
    }

    function jsonpRequest(url) {
        return new Promise((resolve, reject) => {
            const callbackName = `__tier_post_jsonp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
            const separator = url.includes('?') ? '&' : '?';
            const script = document.createElement('script');
            let timer = null;

            function cleanup() {
                if (timer) clearTimeout(timer);
                if (script.parentNode) script.parentNode.removeChild(script);
                try {
                    delete window[callbackName];
                } catch (_) {
                    window[callbackName] = undefined;
                }
            }

            window[callbackName] = (data) => {
                cleanup();
                resolve(data);
            };

            script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}`;
            script.async = true;
            script.onerror = () => {
                cleanup();
                reject(new Error('JSONPでデッキ投稿を取得できませんでした'));
            };
            timer = setTimeout(() => {
                cleanup();
                reject(new Error('デッキ投稿APIがタイムアウトしました'));
            }, 30000);

            document.head.append(script);
        });
    }

    async function fetchPostJson(url) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data) return data;
        } catch (error) {
            console.warn('[tier] fetchでデッキ投稿を取得できませんでした。JSONPへ切り替えます。', error);
        }

        return jsonpRequest(url);
    }

    async function handleTierCardClick(event) {
        const card = event.target.closest('.tier-card[data-post-id]');
        if (!card) return;

        const postId = String(card.dataset.postId || '').trim();
        if (!postId) return;

        event.preventDefault();
        const guideCard = jumpToGuideCard(card.dataset.guideId);
        if (!guideCard) return;

        loadGuideDeckList(guideCard);
    }

    function jumpToGuideCard(guideId) {
        if (!guideId) return null;

        const guideCard = Array.from(document.querySelectorAll('.tier-guide-deck'))
            .find((card) => String(card.dataset.guideId || '') === String(guideId));
        if (!guideCard) return null;

        guideCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        guideCard.classList.add('is-focused');
        setTimeout(() => guideCard.classList.remove('is-focused'), 1200);
        return guideCard;
    }

    async function loadGuideDeckList(guideCard) {
        const postId = String(guideCard && guideCard.dataset.postId || '').trim();
        const list = guideCard && guideCard.querySelector('[data-tier-guide-list]');
        if (!guideCard || !postId || !list) return;
        if (guideCard.dataset.loaded === '1') return;

        guideCard.dataset.loading = '1';
        setGuideEnvironmentStatus('デッキリスト切り替え中', false);

        try {
            const item = await fetchPostById(postId);
            if (String(guideCard.dataset.postId || '').trim() !== postId) return;
            if (typeof window.ensureCardMapLoaded === 'function') {
                await window.ensureCardMapLoaded().catch(() => null);
            }
            if (String(guideCard.dataset.postId || '').trim() !== postId) return;
            applyGuideDeckRace(guideCard, item);
            setGuideDeckCodeButton(guideCard, getDeckCode(item));
            const rendered = renderDeckList(item, list);
            guideCard.dataset.loaded = rendered ? '1' : '0';
            setGuideDeckStatus(guideCard, rendered ? '' : 'デッキリスト未登録', !rendered);
            if (rendered) saveRenderedGuideDeckList(guideCard);
            if (rendered) {
                setGuideEnvironmentLabel(state.environments[state.currentEnvironmentIndex], state.currentEnvironmentIndex);
            } else {
                setGuideEnvironmentStatus('デッキリスト未登録', true);
            }
        } catch (error) {
            console.warn('[tier] デッキリストを取得できませんでした。', error);
            setGuideDeckStatus(guideCard, 'デッキリストの取得に失敗しました。投稿リンクから確認してください。', true);
            setGuideEnvironmentStatus('デッキリスト取得失敗', true);
        } finally {
            if (String(guideCard.dataset.postId || '').trim() === postId) {
                delete guideCard.dataset.loading;
            }
        }
    }

    function renderGuideDeckFromCache(guideCard) {
        const postId = String(guideCard && guideCard.dataset.postId || '').trim();
        const list = guideCard && guideCard.querySelector('[data-tier-guide-list]');
        const item = postId ? state.postCache.get(postId) : null;
        if (!guideCard || !list || !item) return false;

        applyGuideDeckRace(guideCard, item);
        setGuideDeckCodeButton(guideCard, getDeckCode(item));
        const rendered = renderDeckList(item, list);
        guideCard.dataset.loaded = rendered ? '1' : '0';
        setGuideDeckStatus(guideCard, rendered ? '' : 'デッキリスト未登録', !rendered);
        if (rendered) saveRenderedGuideDeckList(guideCard);
        return rendered;
    }

    async function preloadGuideDeckLists() {
        const guideCards = Array.from(document.querySelectorAll('.tier-guide-deck[data-post-id]'));
        const targetCards = guideCards.filter((card) => card.dataset.loaded !== '1');
        const postIds = targetCards.map((card) => String(card.dataset.postId || '').trim()).filter(Boolean);
        if (!targetCards.length) {
            if (guideCards.length) {
                setGuideEnvironmentLabel(state.environments[state.currentEnvironmentIndex], state.currentEnvironmentIndex);
            } else {
                setGuideEnvironmentStatus('デッキリストなし', false);
            }
            return;
        }
        if (!postIds.length) return;

        state.triedBatchLoad = true;
        setGuideEnvironmentStatus('デッキリスト切り替え中', false);

        try {
            await fetchPostsByIds(postIds);
            if (typeof window.ensureCardMapLoaded === 'function') {
                await window.ensureCardMapLoaded().catch(() => null);
            }
            await Promise.all(targetCards.map(renderGuideDeckFromCache));
            setGuideEnvironmentLabel(state.environments[state.currentEnvironmentIndex], state.currentEnvironmentIndex);
        } catch (error) {
            console.warn('[tier] デッキリストの一括取得に失敗しました。個別取得へ切り替えます。', error);
            setGuideEnvironmentStatus('デッキリスト切り替え待ち', false);
            observeGuideDeckCards();
        }
    }

    function enqueueGuideDeckLoad(guideCard) {
        if (!guideCard || guideCard.dataset.loaded === '1' || guideCard.dataset.loading === '1') return;
        if (state.guideLoadQueue.includes(guideCard)) return;

        state.guideLoadQueue.push(guideCard);
        processGuideLoadQueue();
    }

    function processGuideLoadQueue() {
        while (state.guideActiveLoads < GUIDE_LOAD_CONCURRENCY && state.guideLoadQueue.length) {
            const guideCard = state.guideLoadQueue.shift();
            if (!guideCard || !guideCard.isConnected || guideCard.dataset.loaded === '1') continue;

            state.guideActiveLoads += 1;
            loadGuideDeckList(guideCard).finally(() => {
                state.guideActiveLoads = Math.max(0, state.guideActiveLoads - 1);
                processGuideLoadQueue();
            });
        }
    }

    function observeGuideDeckCards() {
        if (state.guideObserver) {
            state.guideObserver.disconnect();
            state.guideObserver = null;
        }

        const cards = Array.from(document.querySelectorAll('.tier-guide-deck[data-post-id]'));
        if (!cards.length) return;

        if (typeof IntersectionObserver !== 'function') {
            cards.slice(0, 4).forEach(enqueueGuideDeckLoad);
            return;
        }

        state.guideObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                state.guideObserver.unobserve(entry.target);
                enqueueGuideDeckLoad(entry.target);
            });
        }, {
            root: null,
            rootMargin: '320px 0px',
            threshold: 0.01
        });

        cards.forEach((card) => state.guideObserver.observe(card));
    }

    function createTierRow(tier, items) {
        const rowEl = document.createElement('div');
        rowEl.className = 'tier-row';

        const label = document.createElement('div');
        label.className = `tier-label is-${getTierClassName(tier)}`;
        label.textContent = tier;

        const itemList = document.createElement('div');
        itemList.className = 'tier-items';

        if (items.length) {
            mergeTierBoardItems(items)
                .forEach((item) => itemList.append(createDeckCard(item)));
        } else {
            const empty = document.createElement('div');
            empty.className = 'tier-empty';
            empty.textContent = '現在掲載デッキはありません';
            itemList.append(empty);
        }

        rowEl.append(label, itemList);
        return rowEl;
    }

    function renderTierBoard(items) {
        const board = document.getElementById('tierBoard');
        if (!board) return;

        const groups = groupItemsByTier(items);
        const orderedTiers = getOrderedTiers(groups);

        if (!orderedTiers.length) {
            board.replaceChildren(...TIER_ORDER.map((tier) => createTierRow(tier, [])));
            return;
        }

        board.replaceChildren(...orderedTiers.map((tier) => createTierRow(tier, groups.get(tier) || [])));
    }

    function createGuideDeckCard(item) {
        const deckName = String(item.deckName || '名称未設定').trim() || '名称未設定';
        const comment = String(item.comment || '').trim();
        const postUrl = String(item.postUrl || '').trim();
        const postId = getPostIdFromUrl(postUrl);
        const detailHref = getPostDetailHref(postUrl);
        const deckCode = getDeckCode(item);
        const guideId = getDeckGuideId(item);
        const cachedListHtml = getCachedGuideDeckListHtml(postId, guideId);
        const card = document.createElement('article');

        card.className = 'tier-guide-deck';
        card.dataset.guideId = guideId;
        if (postId) card.dataset.postId = postId;
        card.dataset.tierColumnRace = getTierItemRace(item);
        applyGuideDeckRace(card, item);

        const head = document.createElement('div');
        head.className = 'tier-guide-deck-head';

        const title = document.createElement('h5');
        title.className = 'tier-guide-deck-title';
        title.textContent = deckName;

        const metaItems = getGuideDeckMetaItems(item);
        if (metaItems.length) {
            const meta = document.createElement('div');
            meta.className = 'tier-guide-deck-meta';
            metaItems.forEach((text) => {
                const metaItem = document.createElement('span');
                metaItem.className = 'tier-guide-deck-meta-item';
                metaItem.textContent = text;
                meta.append(metaItem);
            });
            head.append(title, meta);
        } else {
            head.append(title);
        }
        card.append(head);

        const wideActions = document.createElement('div');
        wideActions.className = 'tier-guide-deck-actions-wide';

        const detailLink = document.createElement('a');
        detailLink.className = 'tier-guide-detail-link';
        detailLink.textContent = 'デッキを詳しく見る';
        if (detailHref) {
            detailLink.href = detailHref;
            detailLink.target = '_blank';
            detailLink.rel = 'noopener';
            if (postId) detailLink.dataset.postId = postId;
        } else {
            detailLink.setAttribute('aria-disabled', 'true');
            detailLink.tabIndex = -1;
        }

        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'tier-guide-copy-code-button btn-copy-code-wide';
        copyButton.dataset.tierGuideCopyCode = '1';
        setGuideDeckCodeButton({ querySelector: () => copyButton }, deckCode);

        wideActions.append(detailLink, copyButton);
        card.append(wideActions);

        const status = document.createElement('div');
        status.className = 'tier-guide-deck-status';
        status.dataset.tierGuideStatus = '1';
        status.textContent = cachedListHtml || postId ? '' : 'まだ参考デッキがありません';

        const list = document.createElement('div');
        list.className = 'tier-post-decklist';
        list.dataset.tierGuideList = '1';
        if (cachedListHtml) list.innerHTML = cachedListHtml;

        card.append(status, list);

        if (comment) {
            const deckComment = document.createElement('p');
            deckComment.className = 'tier-guide-deck-list-comment';
            deckComment.textContent = comment;
            card.append(deckComment);
        }

        return card;
    }

    function createGuideDeckGroupCard(variants) {
        const sampleItems = Array.isArray(variants) ? variants.filter(Boolean) : [];
        if (sampleItems.length <= 1) return createGuideDeckCard(sampleItems[0]);

        let activeIndex = 0;
        const groupId = getTierDeckGroupId(sampleItems[0]);
        const card = document.createElement('article');

        card.className = 'tier-guide-deck';
        card.dataset.guideId = groupId;

        const head = document.createElement('div');
        head.className = 'tier-guide-deck-head';

        const title = document.createElement('h5');
        title.className = 'tier-guide-deck-title';

        const meta = document.createElement('div');
        meta.className = 'tier-guide-deck-meta';
        head.append(title, meta);
        card.append(head);

        const wideActions = document.createElement('div');
        wideActions.className = 'tier-guide-deck-actions-wide has-sample-controls';

        const detailLink = document.createElement('a');
        detailLink.className = 'tier-guide-detail-link';
        detailLink.textContent = 'デッキを詳しく見る';

        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'tier-guide-copy-code-button btn-copy-code-wide';
        copyButton.dataset.tierGuideCopyCode = '1';

        const sampleControls = document.createElement('div');
        sampleControls.className = 'tier-guide-sample-controls';

        const prevButton = document.createElement('button');
        prevButton.type = 'button';
        prevButton.className = 'tier-env-button tier-guide-sample-button';
        prevButton.setAttribute('aria-label', '前のサンプル');
        prevButton.textContent = '◀';

        const nextButton = document.createElement('button');
        nextButton.type = 'button';
        nextButton.className = 'tier-env-button tier-guide-sample-button';
        nextButton.setAttribute('aria-label', '次のサンプル');
        nextButton.textContent = '▶';

        sampleControls.append(prevButton, nextButton);
        wideActions.append(detailLink, copyButton, sampleControls);
        card.append(wideActions);

        const status = document.createElement('div');
        status.className = 'tier-guide-deck-status';
        status.dataset.tierGuideStatus = '1';

        const list = document.createElement('div');
        list.className = 'tier-post-decklist';
        list.dataset.tierGuideList = '1';

        const deckComment = document.createElement('p');
        deckComment.className = 'tier-guide-deck-list-comment';
        card.append(status, list, deckComment);

        function renderSample(index, options = {}) {
            activeIndex = Math.min(Math.max(index, 0), sampleItems.length - 1);
            const sample = sampleItems[activeIndex];
            const deckName = String(sample.deckName || '名称未設定').trim() || '名称未設定';
            const comment = String(sample.comment || '').trim();
            const postUrl = String(sample.postUrl || '').trim();
            const postId = getPostIdFromUrl(postUrl);
            const detailHref = getPostDetailHref(postUrl);
            const guideId = getDeckGuideId(sample);
            const cachedListHtml = getCachedGuideDeckListHtml(postId, guideId);

            card.dataset.guideId = groupId;
            card.dataset.activeGuideId = guideId;
            card.dataset.sampleIndex = String(activeIndex);
            card.dataset.tierColumnRace = getTierItemRace(sample);
            if (postId) {
                card.dataset.postId = postId;
            } else {
                delete card.dataset.postId;
            }
            delete card.dataset.loaded;
            delete card.dataset.loading;

            applyGuideDeckRace(card, sample);
            title.textContent = deckName;

            meta.replaceChildren(...getGuideDeckMetaItems(sample).map((text) => {
                const metaItem = document.createElement('span');
                metaItem.className = 'tier-guide-deck-meta-item';
                metaItem.textContent = text;
                return metaItem;
            }));

            if (detailHref) {
                detailLink.href = detailHref;
                detailLink.target = '_blank';
                detailLink.rel = 'noopener';
                detailLink.tabIndex = 0;
                detailLink.removeAttribute('aria-disabled');
                if (postId) {
                    detailLink.dataset.postId = postId;
                } else {
                    delete detailLink.dataset.postId;
                }
            } else {
                detailLink.removeAttribute('href');
                detailLink.removeAttribute('target');
                detailLink.rel = 'noopener';
                detailLink.setAttribute('aria-disabled', 'true');
                detailLink.tabIndex = -1;
                delete detailLink.dataset.postId;
            }

            setGuideDeckCodeButton({ querySelector: () => copyButton }, getDeckCode(sample));

            if (cachedListHtml) {
                list.innerHTML = cachedListHtml;
                card.dataset.loaded = '1';
                setGuideDeckStatus(card, '', false);
            } else {
                list.replaceChildren();
                setGuideDeckStatus(card, postId ? '' : 'まだ参考デッキがありません', !postId);
            }

            deckComment.textContent = comment;
            deckComment.hidden = !comment;

            prevButton.disabled = activeIndex <= 0;
            nextButton.disabled = activeIndex >= sampleItems.length - 1;

            if (options.load && postId && card.dataset.loaded !== '1') {
                loadGuideDeckList(card);
            }
        }

        prevButton.addEventListener('click', () => {
            renderSample(activeIndex - 1, { load: true });
        });

        nextButton.addEventListener('click', () => {
            renderSample(activeIndex + 1, { load: true });
        });

        renderSample(0);
        return card;
    }

    function createGuideTierSection(tier, items) {
        const section = document.createElement('section');
        section.className = 'tier-guide-rank';

        const title = document.createElement('h4');
        title.className = `tier-guide-rank-title is-${getTierClassName(tier)}`;
        title.textContent = `${tier} ランク`;

        const list = document.createElement('div');
        list.className = 'tier-guide-rank-list';

        groupGuideItemsByDeck(items)
            .forEach((groupItems) => list.append(createGuideDeckGroupCard(groupItems)));

        section.append(title, list);
        return section;
    }

    function guideMatchesItems(items) {
        const guideCards = Array.from(document.querySelectorAll('.tier-guide-deck[data-guide-id]'));
        const nextIds = groupGuideItemsByDeck(items || []).map((groupItems) => (
            groupItems.length > 1 ? getTierDeckGroupId(groupItems[0]) : getDeckGuideId(groupItems[0])
        ));
        if (!guideCards.length || guideCards.length !== nextIds.length) return false;

        return nextIds.every((guideId, index) => String(guideCards[index].dataset.guideId || '') === String(guideId));
    }

    function renderDeckGuide(items, environment, index) {
        const guide = document.querySelector('[data-tier-deck-guide]');
        const body = document.querySelector('[data-tier-deck-guide-body]');
        if (!guide || !body) return;
        setGuideEnvironmentStatus('最新リスト確認中', false);

        const groups = groupItemsByTier(items);
        const orderedTiers = getOrderedTiers(groups);
        const sections = orderedTiers
            .map((tier) => createGuideTierSection(tier, groups.get(tier) || []))
            .filter(Boolean);

        guide.hidden = !sections.length;
        if (!guideMatchesItems(items)) {
            body.replaceChildren(...sections);
            renderGuideDecksFromCache();
        }
        setGuideEnvironmentLabel(environment, index);
        state.guideLoadQueue = [];
        state.guideActiveLoads = 0;
        state.triedBatchLoad = false;
        preloadGuideDeckLists();
    }

    function renderEnvironment(index) {
        const environment = state.environments[index];
        if (!environment) return;

        state.currentEnvironmentIndex = index;
        setBoardTitle(environment, index);
        setEnvironmentComment(environment);
        const items = getEnvironmentItems(environment);
        renderTierBoard(items);
        renderDeckGuide(items, environment, index);
        updateEnvironmentControls();
    }


    function bindEnvironmentControls() {
        document.querySelectorAll('[data-tier-env-prev]').forEach((prevButton) => {
            if (prevButton.dataset.tierEnvBound) return;
            prevButton.dataset.tierEnvBound = '1';
            prevButton.addEventListener('click', () => {
                renderEnvironment(Math.min(state.currentEnvironmentIndex + 1, state.environments.length - 1));
            });
        });

        document.querySelectorAll('[data-tier-env-next]').forEach((nextButton) => {
            if (nextButton.dataset.tierEnvBound) return;
            nextButton.dataset.tierEnvBound = '1';
            nextButton.addEventListener('click', () => {
                renderEnvironment(Math.max(state.currentEnvironmentIndex - 1, 0));
            });
        });

        updateEnvironmentControls();
    }

    const TIER_IMAGE_CAPTURE_WIDTH = 1100;
    const TIER_IMAGE_CAPTURE_SCALE = 2;
    const TIER_IMAGE_HEADER_TITLE = '神託のメソロギア Tier表';
    const TIER_IMAGE_HEADER_AUTHOR = 'byクラナンダ';
    const TIER_IMAGE_FOOTER_CREDIT = 'Tier表作成：神託のメソロギアDiscordコミュニティ「クラナンダ」';

    function getTierImageFileName() {
        const environment = state.environments[state.currentEnvironmentIndex];
        const name = getEnvironmentName(environment, state.currentEnvironmentIndex).replace(/[\\/:*?"<>|]/g, '_');
        return `tier-list-${name || 'latest'}.png`;
    }

    function waitTierBoardImages(target) {
        return Promise.all(Array.from(target.querySelectorAll('img')).map((image) => {
            if (image.complete) return Promise.resolve();
            return new Promise((resolve) => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
                setTimeout(resolve, 1500);
            });
        }));
    }

    function nextFrame() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }

    function createTierBoardCaptureTarget(source) {
        const root = document.createElement('div');
        const captureTarget = source.cloneNode(true);

        captureTarget.removeAttribute('id');
        root.setAttribute('aria-hidden', 'true');

    Object.assign(root.style, {
        position: 'absolute',
        left: '-10000px',
        top: '0',

        width: `${TIER_IMAGE_CAPTURE_WIDTH}px`,
        maxWidth: 'none',

        padding: '10px 12px 8px',

        display: 'grid',
        gap: '8px',

        background: 'linear-gradient(160deg, #f7f8fb 0%, #ffffff 48%, #f3f6fb 100%)',

        color: '#0f172a',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif',

        boxSizing: 'border-box',
        pointerEvents: 'none'
    });

        Object.assign(captureTarget.style, {
            width: '100%',
            maxWidth: 'none',
            boxSizing: 'border-box'
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',

            alignItems: 'flex-end', // ← 下揃え

            justifyContent: 'flex-start',
            gap: '10px',

            minHeight: '0',

            padding: '7px 12px 6px',

            border: '1px solid rgba(15,23,42,0.10)',
            borderRadius: '12px',

            background: `
                linear-gradient(
                    135deg,
                    rgba(255,255,255,0.96) 0%,
                    rgba(248,250,252,0.96) 48%,
                    rgba(241,245,249,0.96) 100%
                )
            `,

            boxShadow: `
                0 2px 10px rgba(15,23,42,0.06),
                inset 0 1px 0 rgba(255,255,255,0.75)
            `
        });

        const title = document.createElement('div');
        title.textContent = TIER_IMAGE_HEADER_TITLE;
        Object.assign(title.style, {
            minWidth: '0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '34px',
            lineHeight: '1.05',
            fontWeight: '900',
            letterSpacing: '0'
        });

        const author = document.createElement('div');
        author.textContent = TIER_IMAGE_HEADER_AUTHOR;
        Object.assign(author.style, {
            flex: '0 0 auto',

            color: 'rgba(15,23,42,0.68)',

            fontSize: '17px',
            lineHeight: '1',

            fontWeight: '900',

            letterSpacing: '-0.01em',

            paddingBottom: '4px'
        });

        header.append(title, author);

        captureTarget.querySelectorAll('.tier-row').forEach((row) => {
            Object.assign(row.style, {
                display: 'grid',
                gridTemplateColumns: '72px minmax(0, 1fr)',
                minHeight: '78px'
            });
        });

        captureTarget.querySelectorAll('.tier-items').forEach((items) => {
            Object.assign(items.style, {
                display: 'flex',
                alignContent: 'flex-start',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: '4px',
                padding: '4px'
            });
        });

        captureTarget.querySelectorAll('.tier-card').forEach((card) => {
            Object.assign(card.style, {
                width: '88px'
            });
        });

        captureTarget.querySelectorAll('.tier-card-image-wrap').forEach((wrap) => {
            Object.assign(wrap.style, {
                minHeight: '90px'
            });
        });

        const footer = document.createElement('div');
        Object.assign(footer.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',

            padding: '2px 6px',
            alignItems: 'flex-end',

            borderRadius: '10px',

            background: 'rgba(255,255,255,0.72)',

            fontSize: '12px',
            fontWeight: '700',

            color: 'rgba(15,23,42,0.58)'
        });

        const credit = document.createElement('div');
        credit.textContent = TIER_IMAGE_FOOTER_CREDIT;
        Object.assign(credit.style, {
            minWidth: '0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'rgba(15,23,42,0.72)',
            fontSize: '13px',
            opacity: '0.9'
        });

        const page = document.createElement('div');
        page.textContent = location.origin + location.pathname;
        Object.assign(page.style, {
            flex: '0 0 auto',
            maxWidth: '40%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'rgba(15,23,42,0.72)',
            fontSize: '14px',
            textAlign: 'right',
            opacity: '0.9'
        });

        footer.append(credit, page);
        root.append(header, captureTarget, footer);

        document.body.append(root);
        return root;
    }

    function closeTierImageModal(modal) {
        if (modal) modal.remove();
        document.body.style.overflow = '';
    }

    function createTierImageButton(label) {
        const button = document.createElement('a');
        button.textContent = label;
        Object.assign(button.style, {
            flex: '1 1 0',
            display: 'inline-block',
            padding: '10px 12px',
            borderRadius: '10px',
            background: '#fff',
            color: '#111',
            fontSize: '14px',
            fontWeight: '800',
            textAlign: 'center',
            textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,.25)'
        });
        return button;
    }

    function showTierImagePreview(canvas, fileName) {
        const dataUrl = canvas.toDataURL('image/png');
        document.getElementById('tier-image-preview-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'tier-image-preview-modal';
        Object.assign(modal.style, {
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            overflowY: 'auto',
            padding: '40px 0',
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            fontFamily: 'system-ui, sans-serif'
        });

        document.body.style.overflow = 'hidden';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = '×';
        closeButton.setAttribute('aria-label', '閉じる');
        Object.assign(closeButton.style, {
            position: 'absolute',
            top: '16px',
            right: '16px',
            width: '36px',
            height: '36px',
            border: 'none',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.9)',
            color: '#111',
            fontSize: '22px',
            fontWeight: '700',
            lineHeight: '1',
            cursor: 'pointer',
            boxShadow: '0 0 6px rgba(0,0,0,0.3)'
        });
        closeButton.addEventListener('click', () => closeTierImageModal(modal));

        const hint = document.createElement('div');
        const ua = String(navigator.userAgent || '').toLowerCase();
        if (/iphone|ipad|ipod/.test(ua)) {
            hint.textContent = '長押しで「写真に追加」や「共有（画像保存）」ができます';
        } else if (/android/.test(ua)) {
            hint.textContent = '長押しで「画像をダウンロード」や「共有（画像保存）」ができます';
        } else {
            hint.textContent = '右クリックで「名前を付けて保存」できます';
        }
        Object.assign(hint.style, {
            margin: '15px',
            fontSize: 'clamp(14px, 2vw, 18px)',
            textAlign: 'center'
        });

        const buttonBar = document.createElement('div');
        Object.assign(buttonBar.style, {
            display: 'flex',
            gap: '8px',
            width: 'min(92vw, 760px)',
            maxWidth: 'min(92vw, 760px)',
            margin: '8px auto 12px'
        });

        const saveButton = createTierImageButton('ダウンロード');
        saveButton.href = dataUrl;
        saveButton.download = fileName;

        const shareButton = createTierImageButton('共有（画像保存）');
        shareButton.href = 'javascript:void(0)';
        const isIOS = /iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && (navigator.maxTouchPoints || 0) >= 2);
        const isAndroid = /android/.test(ua);
        if (!isIOS && !isAndroid) {
            shareButton.style.display = 'none';
        } else {
            shareButton.addEventListener('click', async () => {
                try {
                    const blob = await (await fetch(dataUrl)).blob();
                    const file = new File([blob], fileName, { type: 'image/png' });
                    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({ files: [file] });
                    } else {
                        alert('この端末では共有に対応していません。ダウンロードをご利用ください。');
                    }
                } catch (error) {
                    console.warn('[tier] Tier表画像を共有できませんでした。', error);
                }
            });
        }

        const image = document.createElement('img');
        image.src = dataUrl;
        image.alt = 'Tier表画像プレビュー';
        Object.assign(image.style, {
            maxWidth: 'min(92vw, 760px)',
            height: 'auto',
            borderRadius: '12px',
            boxShadow: '0 0 24px rgba(0,0,0,0.6)',
            objectFit: 'contain'
        });

        const note = document.createElement('div');
        note.textContent = '※ここで生成した画像はXやDiscord、Youtubeなどに自由に投稿して構いません。';
        Object.assign(note.style, {
            width: 'min(92vw, 760px)',
            maxWidth: 'min(92vw, 760px)',
            margin: '10px auto 16px',
            color: 'rgba(255,255,255,0.8)',
            fontSize: 'clamp(12px, 1.8vw, 14px)',
            textAlign: 'center'
        });

        buttonBar.append(saveButton, shareButton);
        modal.append(closeButton, hint, buttonBar, image, note);
        modal.addEventListener('click', (event) => {
            if (event.target === modal && event.clientY < window.innerHeight * 0.9) {
                closeTierImageModal(modal);
            }
        });
        document.body.append(modal);
    }

    async function exportTierBoardImage(button) {
        const target = document.getElementById('tierBoard');
        if (!target) return;
        if (typeof html2canvas !== 'function') {
            alert('画像生成機能を読み込めませんでした。ページを再読み込みしてください。');
            return;
        }

        const previousText = button ? button.textContent : '';
        if (button) {
            button.disabled = true;
            button.classList.add('is-loading');
        }

        const loader = window.__DeckImgLoading?.show?.('画像生成中…');
        await nextFrame();
        await nextFrame();

        let captureTarget = null;
        try {
            captureTarget = createTierBoardCaptureTarget(target);
            await waitTierBoardImages(captureTarget);
            await nextFrame();
            const canvas = await html2canvas(captureTarget, {
                useCORS: true,
                backgroundColor: '#fff',
                width: captureTarget.offsetWidth,
                height: captureTarget.offsetHeight,
                windowWidth: TIER_IMAGE_CAPTURE_WIDTH,
                scale: TIER_IMAGE_CAPTURE_SCALE
            });
            showTierImagePreview(canvas, getTierImageFileName());
        } catch (error) {
            console.error('[tier] Tier表画像の生成に失敗しました。', error);
            alert('Tier表画像の生成に失敗しました。ページを再読み込みしてください。');
        } finally {
            if (captureTarget) captureTarget.remove();
            window.__DeckImgLoading?.hide?.(loader);
            if (button) {
                button.disabled = false;
                button.classList.remove('is-loading');
                button.textContent = previousText || '📷';
            }
        }
    }

    function bindTierImageExport() {
        document.querySelectorAll('[data-tier-board-image]').forEach((button) => {
            if (button.dataset.tierImageBound) return;
            button.dataset.tierImageBound = '1';
            button.addEventListener('click', () => exportTierBoardImage(button));
        });
    }

    function bindPostDetailEvents() {
        const board = document.getElementById('tierBoard');
        const guide = document.querySelector('[data-tier-deck-guide]');

        if (board) {
            board.addEventListener('click', handleTierCardClick);
        }

        if (guide) {
            guide.addEventListener('click', (event) => {
                const tierPostCard = event.target.closest('.tier-post-card');
                if (tierPostCard) {
                    event.preventDefault();
                    event.stopPropagation();
                    openTierPostCardDetail(tierPostCard);
                    return;
                }

                const copyButton = event.target.closest('[data-tier-guide-copy-code]');
                if (copyButton) {
                    copyGuideDeckCode(copyButton);
                    return;
                }

                const detailLink = event.target.closest('.tier-guide-detail-link[data-post-id]');
                if (detailLink) {
                    storePostTransfer(detailLink.dataset.postId);
                    prefetchPostDetailPage(detailLink.href);
                    return;
                }

                const guideCard = event.target.closest('.tier-guide-deck[data-post-id]');
                if (!guideCard || event.target.closest('a')) return;
                enqueueGuideDeckLoad(guideCard);
            });

            guide.addEventListener('pointerover', (event) => {
                const detailLink = event.target.closest('.tier-guide-detail-link[href]');
                if (!detailLink) return;
                prefetchPostDetailPage(detailLink.getAttribute('href'));
            });

            guide.addEventListener('focusin', (event) => {
                const detailLink = event.target.closest('.tier-guide-detail-link[href]');
                if (!detailLink) return;
                prefetchPostDetailPage(detailLink.getAttribute('href'));
            });

            guide.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;

                const tierPostCard = event.target.closest('.tier-post-card');
                if (!tierPostCard) return;

                event.preventDefault();
                openTierPostCardDetail(tierPostCard);
            });
        }
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function requestLatestTier(options = {}) {
        let lastError = null;

        for (let attempt = 1; attempt <= TIER_FETCH_MAX_ATTEMPTS; attempt += 1) {
            const url = new URL(TIER_API_URL);
            url.searchParams.set('mode', 'tierList');
            if (options.force) {
                url.searchParams.set('force', '1');
                url.searchParams.set('_', String(Date.now()));
            }

            try {
                const response = await fetch(url.toString(), { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                if (!data || data.ok !== true || !Array.isArray(data.items)) {
                    throw new Error('Tierデータの形式が不正です');
                }

                return data;
            } catch (error) {
                lastError = error;
                if (attempt >= TIER_FETCH_MAX_ATTEMPTS) break;

                const nextAttempt = attempt + 1;
                setStatus(`最新リスト再取得中（${nextAttempt}/${TIER_FETCH_MAX_ATTEMPTS}）`);
                setGuideEnvironmentStatus(`最新リスト再取得中（${nextAttempt}/${TIER_FETCH_MAX_ATTEMPTS}）`, false);
                console.warn(`[tier] Tierデータ取得に失敗しました。${nextAttempt}回目を試します。`, error);
                await wait(TIER_FETCH_RETRY_BASE_DELAY_MS * attempt);
            }
        }

        throw lastError || new Error('Tierデータを取得できませんでした');
    }

    async function fetchLatestTier(options = {}) {
        setStatus('最新リスト確認中');
        setGuideEnvironmentStatus('最新リスト確認中', false);

        try {
            const data = await requestLatestTier(options);
            saveTierCache(data);
            applyTierData(data);
        } catch (error) {
            console.warn('[tier] 最新Tierデータを取得できませんでした。', error);
            if (state.environments.length) {
                renderEnvironment(state.currentEnvironmentIndex);
            } else {
                setStatusError('リスト取得失敗');
                setGuideEnvironmentStatus('リスト取得失敗', true);
            }
            updateEnvironmentControls();
        }
    }

    window.clearTierListBrowserCache_ = async function () {
        state.postCache.clear();
        state.guideDeckListHtmlCache.clear();
        state.prefetchedPostPages.clear();
        try {
            localStorage.removeItem(TIER_CACHE_KEY);
        } catch (_) {}

        const data = await requestLatestTier({ force: true });

        saveTierCache(data);
        applyTierData(data);
    };

    function init() {
        bindEnvironmentControls();
        bindTierImageExport();
        bindPostDetailEvents();

        const cached = loadTierCache();

        if (cached) {
            applyTierData(cached);
        } else {
            setStatus('最新リスト確認中');
            setGuideEnvironmentStatus('最新リスト確認中', false);
        }

        fetchLatestTier({ force: isReloadNavigation() });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
