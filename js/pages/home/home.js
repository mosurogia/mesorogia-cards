/* =========================
 * ホームページ用データ描画
     * home-data.json から更新履歴・イベント情報・便利機能を取得する
 * ========================= */
(function () {
    'use strict';

    const HOME_DATA_URL = './public/home-data.json';

    const FALLBACK_NEWS_ITEMS = [];
    const FALLBACK_EVENT_ITEMS = [];
    const FALLBACK_FEATURE_ITEMS = [];
    const NEWS_CATEGORIES = ['すべて', 'サイト更新', '不具合修正', 'その他'];
    let currentNewsItems_ = [];
    let newsModalMode_ = 'list';
    let selectedNews_ = null;
    let selectedNewsCategory_ = 'すべて';
    let currentEventItems_ = [];
    let visibleCalendarMonth_ = null;
    let desktopEventTab_ = 'ongoing';
    let desktopSelectedDayKey_ = '';
    let modalEventTab_ = 'ongoing';
    let modalSelectedDayKey_ = '';
    let summaryEventTab_ = 'ongoing';
    let mobileEventTab_ = 'ongoing';

    function getInitialHomeData_() {
        const dataElement = document.getElementById('home-initial-data');
        if (!dataElement) {
            return {
                news: FALLBACK_NEWS_ITEMS,
                events: FALLBACK_EVENT_ITEMS,
                features: FALLBACK_FEATURE_ITEMS,
            };
        }

        try {
            const json = JSON.parse(dataElement.textContent || '{}');
            return {
                news: Array.isArray(json.news) ? json.news : FALLBACK_NEWS_ITEMS,
                events: Array.isArray(json.events) ? json.events : FALLBACK_EVENT_ITEMS,
                features: Array.isArray(json.features) ? json.features : FALLBACK_FEATURE_ITEMS,
            };
        } catch (error) {
            console.warn(error);
            return {
                news: FALLBACK_NEWS_ITEMS,
                events: FALLBACK_EVENT_ITEMS,
                features: FALLBACK_FEATURE_ITEMS,
            };
        }
    }

    function formatDate(dateText) {
        const date = parseDate_(dateText);
        if (!date) return dateText || '';

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}.${month}.${day}`;
    }

    function parseDate_(dateText) {
        if (!dateText) return null;
        const normalized = String(dateText).trim();
        const date = new Date(
            /^\d{4}-\d{2}-\d{2}$/.test(normalized)
                ? `${normalized}T00:00:00`
                : normalized
        );
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function toDateKey_(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function toMonthKey_(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
    }

    function addMonths_(date, amount) {
        return new Date(date.getFullYear(), date.getMonth() + amount, 1);
    }

    function getEventStartDate_(item) {
        return parseDate_(item?.startAt || item?.date);
    }

    function isMidnightDate_(date) {
        return date
            && date.getHours() === 0
            && date.getMinutes() === 0
            && date.getSeconds() === 0
            && date.getMilliseconds() === 0;
    }

    function getEventEndDate_(item) {
        const startDate = getEventStartDate_(item);
        const endDate = parseDate_(item?.endAt || item?.startAt || item?.date);
        if (!startDate || !endDate) return endDate;
        if (item?.endAt && endDate > startDate && isMidnightDate_(endDate)) {
            const displayEndDate = new Date(endDate);
            displayEndDate.setDate(displayEndDate.getDate() - 1);
            return displayEndDate;
        }
        return endDate;
    }

    function getToday_() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
    }

    function isOngoingEvent_(entry, today) {
        if (!entry?.startDate || !entry?.endDate) return false;
        return entry.startDate <= today && today <= entry.endDate;
    }

    function isEndedEvent_(entry, today = getToday_()) {
        return Boolean(entry?.endDate && entry.endDate < today);
    }

    function isUpcomingWithinDays_(entry, today, days) {
        if (!entry?.startDate) return false;
        const limit = new Date(today);
        limit.setDate(limit.getDate() + days);
        return today < entry.startDate && entry.startDate <= limit;
    }

    function getEventTypeLabel_(item) {
        return item?.label || item?.type || 'イベント';
    }

    function formatMonthDay_(date) {
        if (!date || Number.isNaN(date.getTime())) return '';
        return `${date.getMonth() + 1}/${date.getDate()}`;
    }

    function formatMonthEventDateRange_(entry) {
        const startText = formatMonthDay_(entry?.startDate);
        if (!startText) return '';

        const endDate = entry?.endDate;
        if (!endDate || endDate <= entry.startDate) return startText;
        return `${startText}〜${formatMonthDay_(endDate)}`;
    }

    function getCalendarMonthTabLabels_(monthBase) {
        const target = monthBase || visibleCalendarMonth_ || getToday_();
        const today = getToday_();
        const isCurrentMonth = target.getFullYear() === today.getFullYear()
            && target.getMonth() === today.getMonth();
        const monthText = isCurrentMonth ? '今月' : `${target.getMonth() + 1}月`;

        return {
            month: monthText,
            tournament: `${monthText}の大会`,
        };
    }

    function compareEventEntries_(a, b) {
        const startDiff = (a.startDate || 0) - (b.startDate || 0);
        if (startDiff !== 0) return startDiff;

        const orderA = Number.isFinite(Number(a.item?.sortOrder)) ? Number(a.item.sortOrder) : 9999;
        const orderB = Number.isFinite(Number(b.item?.sortOrder)) ? Number(b.item.sortOrder) : 9999;
        if (orderA !== orderB) return orderA - orderB;

        return String(a.item?.title || '').localeCompare(String(b.item?.title || ''), 'ja');
    }

    function compareEventEntriesByEnd_(a, b) {
        const endDiff = (a.endDate || a.startDate || 0) - (b.endDate || b.startDate || 0);
        return endDiff || compareEventEntries_(a, b);
    }

    function getEventEntries_(items) {
        return (Array.isArray(items) ? items : [])
            .map((item) => ({
                item,
                startDate: getEventStartDate_(item),
                endDate: getEventEndDate_(item),
            }))
            .filter((entry) => entry.startDate);
    }

    function getMonthEvents_(entries, monthBase) {
        if (!monthBase) return [];
        const firstDate = new Date(monthBase.getFullYear(), monthBase.getMonth(), 1);
        const lastDate = new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0);
        return entries
            .filter((entry) => {
                const end = entry.endDate && entry.endDate >= entry.startDate ? entry.endDate : entry.startDate;
                return entry.startDate <= lastDate && end >= firstDate;
            })
            .sort(compareEventEntries_);
    }

    function getMonthEventsForDisplay_(entries, monthBase, today = getToday_()) {
        return getMonthEvents_(entries, monthBase).sort((a, b) => {
            const aEnded = Boolean(a.endDate && a.endDate < today);
            const bEnded = Boolean(b.endDate && b.endDate < today);
            if (aEnded !== bEnded) return aEnded ? 1 : -1;
            return compareEventEntries_(a, b);
        });
    }

    function getOngoingEvents_(entries, today) {
        return entries
            .filter((entry) => isOngoingEvent_(entry, today))
            .sort(compareEventEntriesByEnd_);
    }

    function getUpcomingEvents_(entries, today, days) {
        return entries
            .filter((entry) => isUpcomingWithinDays_(entry, today, days))
            .sort(compareEventEntries_);
    }

    function getEventsOnDate_(entries, dateKey) {
        const date = parseDate_(dateKey);
        if (!date) return [];
        return entries
            .filter((entry) => {
                const end = entry.endDate && entry.endDate >= entry.startDate ? entry.endDate : entry.startDate;
                return entry.startDate <= date && date <= end;
            })
            .sort(compareEventEntries_);
    }

    function isTournamentEvent_(entry) {
        const item = entry?.item || {};
        const normalizedType = normalizeEventType_(item.type);
        const label = getEventTypeLabel_(item);
        return normalizedType === 'tournament'
            || normalizedType === 'user'
            || String(item.type || '').includes('大会')
            || String(label || '').includes('大会');
    }

    function isTournamentItem_(item) {
        return isTournamentEvent_({ item });
    }

    function getTournamentTimeText_(item) {
        const startTime = String(item?.startTime || '').trim();
        const endTime = String(item?.endTime || '').trim();
        if (startTime && endTime) return `開催時間 ${startTime}〜${endTime}`;
        if (startTime) return `開催時間 ${startTime}〜`;
        return String(item?.time || '').trim();
    }

    function getMonthTournamentEvents_(entries, monthBase) {
        return getMonthEvents_(entries, monthBase).filter(isTournamentEvent_);
    }

    function getActiveMonthTournamentEvents_(entries, monthBase, today = getToday_()) {
        return getMonthTournamentEvents_(entries, monthBase)
            .filter((entry) => !isEndedEvent_(entry, today));
    }

    function addTournamentTabBadge_(button, key, entries, monthBase) {
        if (key !== 'tournament') return;

        const count = getActiveMonthTournamentEvents_(entries, monthBase).length;
        if (!count) return;

        const label = button.textContent;
        button.classList.add('has-events');
        button.append(createTextElement('span', String(count), 'home-event-tab-badge'));
        button.setAttribute('aria-label', `${label}、${count}件掲載`);
    }

    function formatUpcomingMobileDate_(entry) {
        const startText = formatMonthDay_(entry?.startDate);
        if (!startText) return '';

        const endDate = entry?.endDate;
        if (endDate && entry.startDate && endDate > entry.startDate) {
            return `${startText}開始`;
        }

        return startText;
    }

    function formatEventRange_(item) {
        const start = item?.startAt || item?.date || '';
        const end = item?.endAt || '';
        if (!end || end === start) return formatDate(start);
        const startDate = getEventStartDate_(item);
        const endDate = getEventEndDate_(item);
        if (!startDate) return formatDate(start);
        if (!endDate || toDateKey_(endDate) === toDateKey_(startDate)) return formatDate(toDateKey_(startDate));
        return `${formatDate(toDateKey_(startDate))} ～ ${formatDate(toDateKey_(endDate))}`;
    }

    function getEventSummaryId_(dateKey, index, prefix = 'home-event-summary') {
        return `${prefix}-${dateKey}-${index}`;
    }

    function getDefaultEventMonthBase_() {
        return getToday_();
    }

    function compareCalendarDayEvents_(a, b) {
        const startDiff = b.startDate - a.startDate;
        if (startDiff !== 0) return startDiff;

        const orderA = Number.isFinite(Number(a.item?.sortOrder)) ? Number(a.item.sortOrder) : 9999;
        const orderB = Number.isFinite(Number(b.item?.sortOrder)) ? Number(b.item.sortOrder) : 9999;
        if (orderA !== orderB) return orderA - orderB;

        return String(a.item?.title || '').localeCompare(String(b.item?.title || ''), 'ja');
    }

    function createTextElement(tagName, text, className) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        element.textContent = text || '';
        return element;
    }

    function normalizeNewsCategory_(category) {
        const key = String(category || '').trim();

        const map = {
            'サイト更新': 'site',
            '不具合修正': 'bugfix',
            'その他': 'other',
        };

        return map[key] || 'other';
    }

    function getNewsCategoryClass_(category) {
        return `home-news-category--${normalizeNewsCategory_(category)}`;
    }

    function renderNews(items) {
        const newsItems = Array.isArray(items) ? items : [];
        currentNewsItems_ = newsItems;

        const list = document.querySelector('[data-home-news-list]');
        if (!list) return;

        if (newsItems.length === 0) {
            list.replaceChildren(createEmptyItem_('現在表示できる更新履歴はありません。'));
            if (newsModalMode_ === 'list' && document.getElementById('homeNewsModal')) {
                renderNewsModalList_();
            }
            return;
        }

        const limit = Number(list.dataset.homeNewsLimit || 3);
        const visibleItems = Number.isFinite(limit) && limit > 0 ? newsItems.slice(0, limit) : newsItems;

        list.replaceChildren(...visibleItems.map((item) => {
            const article = document.createElement('article');
            article.className = 'home-list-item home-news-button';
            article.tabIndex = 0;
            article.setAttribute('role', 'button');
            article.setAttribute('aria-label', `${formatDate(item.date)} ${item.title || '更新履歴'} の詳細を開く`);
            article.addEventListener('click', () => openNewsModal_(item));
            article.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                openNewsModal_(item);
            });

            const time = createTextElement('time', formatDate(item.date));
            time.dateTime = item.date || '';

            const meta = document.createElement('div');
            meta.className = 'home-news-meta';
            meta.append(
                time,
                createTextElement('span', item.category || 'その他', `home-news-category ${getNewsCategoryClass_(item.category)}`)
            );

            const body = document.createElement('div');
            body.className = 'home-news-body';
            body.append(
                createTextElement('h3', item.title),
                createTextElement('p', item.description)
            );

            const action = createTextElement('span', '詳細', 'home-news-action');
            action.setAttribute('aria-hidden', 'true');

            article.append(meta, body, action);
            return article;
        }));

        if (newsModalMode_ === 'list' && document.getElementById('homeNewsModal')) {
            renderNewsModalList_();
        }
    }

    function renderFeatures(items) {
        const featureItems = Array.isArray(items) ? items : [];
        const list = document.querySelector('[data-home-feature-list]');
        if (!list) return;
        const stage = list.closest('.home-feature-stage') || list.parentElement;

        if (list.__homeFeatureScroller) {
            list.__homeFeatureScroller.stop();
            list.__homeFeatureScroller = null;
        }
        stage?.querySelectorAll('.home-feature-nav').forEach((button) => button.remove());

        if (featureItems.length === 0) {
            list.replaceChildren(createEmptyFeatureItem_('現在表示できる機能紹介はありません。'));
            return;
        }

        const limit = Number(list.dataset.homeFeatureLimit || 0);
        const visibleItems = Number.isFinite(limit) && limit > 0 ? featureItems.slice(0, limit) : featureItems;

        const cards = visibleItems.map((item) => {
            const article = document.createElement('article');
            article.className = 'home-feature-card';
            const url = String(item?.url || '').trim();

            const imageUrl = getFeatureImageUrl_(item);
            if (imageUrl) {
                const imageWrap = document.createElement(url ? 'a' : 'div');
                imageWrap.className = 'home-feature-card__image';
                if (url) {
                    imageWrap.href = url;
                    imageWrap.setAttribute('aria-label', `${item?.title || '便利機能'}へ移動`);
                }

                const image = document.createElement('img');
                image.src = imageUrl;
                image.alt = item?.title || '';
                image.loading = 'lazy';
                image.decoding = 'async';
                imageWrap.append(image);
                article.append(imageWrap);
            }

            const body = document.createElement('div');
            body.className = 'home-feature-card__body';
            body.append(
                createTextElement('h3', item?.title || '便利機能'),
                createTextElement('p', item?.description || '')
            );
            article.append(body);

            return article;
        });

        const track = document.createElement('div');
        track.className = 'home-feature-track';
        track.append(...cards);

        const prevButton = createTextElement('button', '←', 'home-feature-nav home-feature-nav--prev');
        prevButton.type = 'button';
        prevButton.setAttribute('aria-label', '前の便利機能を見る');

        const nextButton = createTextElement('button', '→', 'home-feature-nav home-feature-nav--next');
        nextButton.type = 'button';
        nextButton.setAttribute('aria-label', '次の便利機能を見る');

        if (cards.length > 3) {
            const clones = cards.map((card) => {
                const clone = card.cloneNode(true);
                clone.setAttribute('aria-hidden', 'true');
                clone.querySelectorAll('a, button, input, select, textarea').forEach((element) => {
                    element.tabIndex = -1;
                });
                return clone;
            });
            track.append(...clones);
            list.classList.add('is-slide');
        } else {
            list.classList.remove('is-slide');
        }

        list.replaceChildren(track);
        stage?.append(prevButton, nextButton);
        setupFeatureScroller_(list, track, cards.length > 3, prevButton, nextButton);
    }

    function setupFeatureScroller_(list, track, enabled, prevButton, nextButton) {
        if (list.__homeFeatureScroller) {
            list.__homeFeatureScroller.stop();
            list.__homeFeatureScroller = null;
        }

        if (!enabled || !track) {
            if (prevButton) prevButton.hidden = true;
            if (nextButton) nextButton.hidden = true;
            return;
        }

        if (prevButton) prevButton.hidden = false;
        if (nextButton) nextButton.hidden = false;

        list.scrollLeft = 0;
        let timerId = 0;
        let isPaused = false;
        const isReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const autoSlideInterval = 7000;

        const getStepWidth = () => {
            const firstCard = track.querySelector('.home-feature-card');
            if (!firstCard) return list.clientWidth;

            const style = window.getComputedStyle(track);
            const gap = Number.parseFloat(style.columnGap || style.gap || '0') || 0;
            return firstCard.getBoundingClientRect().width + gap;
        };

        const getResetPosition = () => {
            const originalCards = Array.from(track.querySelectorAll('.home-feature-card:not([aria-hidden="true"])'));
            const firstCard = originalCards[0];
            const lastCard = originalCards[originalCards.length - 1];
            if (!firstCard || !lastCard) return track.scrollWidth / 2;

            const style = window.getComputedStyle(track);
            const gap = Number.parseFloat(style.columnGap || style.gap || '0') || 0;
            return (lastCard.offsetLeft + lastCard.offsetWidth + gap) - firstCard.offsetLeft;
        };

        const scrollByFeatureCard = (direction) => {
            const resetAt = getResetPosition();
            const stepWidth = getStepWidth();
            let nextLeft = list.scrollLeft + (stepWidth * direction);

            if (resetAt > 0 && nextLeft >= resetAt) {
                nextLeft = 0;
            } else if (nextLeft < 0) {
                nextLeft = Math.max(0, resetAt - stepWidth);
            }

            list.scrollTo({ left: nextLeft, behavior: isReducedMotion ? 'auto' : 'smooth' });
        };

        const slideNext = () => {
            if (isPaused) return;
            scrollByFeatureCard(1);
        };

        const pause = () => {
            isPaused = true;
        };
        const resume = () => {
            isPaused = false;
        };
        const handlePrevClick = () => scrollByFeatureCard(-1);
        const handleNextClick = () => scrollByFeatureCard(1);

        list.addEventListener('mouseenter', pause);
        list.addEventListener('mouseleave', resume);
        list.addEventListener('focusin', pause);
        list.addEventListener('focusout', resume);
        prevButton?.addEventListener('click', handlePrevClick);
        nextButton?.addEventListener('click', handleNextClick);

        if (!isReducedMotion) {
            timerId = window.setInterval(slideNext, autoSlideInterval);
        }

        list.__homeFeatureScroller = {
            stop() {
                if (timerId) window.clearInterval(timerId);
                list.removeEventListener('mouseenter', pause);
                list.removeEventListener('mouseleave', resume);
                list.removeEventListener('focusin', pause);
                list.removeEventListener('focusout', resume);
                prevButton?.removeEventListener('click', handlePrevClick);
                nextButton?.removeEventListener('click', handleNextClick);
            },
        };
    }

    function getFeatureImageUrl_(item) {
        const image = String(item?.image || '').trim();
        if (image) return image;

        const url = String(item?.url || '').trim();
        if (url.includes('deckmaker')) return 'img/deckmakerOGP.webp';
        if (url.includes('deck-post')) return 'img/deck-postOGP.webp';
        if (url.includes('cards')) return 'img/cardOGP.webp';
        if (url.includes('tier')) return 'img/ogp.png';
        return 'img/homeOGP.png';
    }

    function ensureNewsModal_() {
        let modal = document.getElementById('homeNewsModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'homeNewsModal';
        modal.className = 'home-news-modal';
        modal.style.display = 'none';

        const content = document.createElement('div');
        content.className = 'home-news-modal-content';
        content.setAttribute('role', 'dialog');
        content.setAttribute('aria-modal', 'true');
        content.setAttribute('aria-label', '更新履歴');

        content.innerHTML = `
            <button type="button" class="home-news-modal-close" aria-label="閉じる">×</button>

            <section class="home-news-modal-screen home-news-modal-list-screen" data-home-news-modal-screen="list">
                <header class="home-news-modal-list-head">
                    <h3>更新履歴</h3>
                </header>
                <div class="home-news-modal-filter" aria-label="更新履歴カテゴリ"></div>
                <div class="home-news-modal-list" data-home-news-modal-list></div>
            </section>

            <section class="home-news-modal-screen home-news-modal-detail-screen" data-home-news-modal-screen="detail" hidden>
                <button type="button" class="home-news-modal-back">← 更新履歴一覧へ戻る</button>
                <div class="home-news-modal-hero">
                    <h3 id="homeNewsModalTitle"></h3>
                    <div class="home-news-modal-meta">
                        <time id="homeNewsModalDate"></time>
                        <span id="homeNewsModalCategory">更新情報</span>
                    </div>
                </div>

                <div class="home-news-modal-body">
                    <div class="home-news-modal-note" id="homeNewsModalNote"></div>
                    <a class="home-news-modal-link" id="homeNewsModalLink" href="#" target="_blank" rel="noopener noreferrer">
                        詳細ページを見る
                    </a>
                </div>
            </section>
        `;

        modal.append(content);

        modal.querySelector('.home-news-modal-close')?.addEventListener('click', closeNewsModal_);
        modal.querySelector('.home-news-modal-back')?.addEventListener('click', () => {
            setNewsModalMode_('list');
        });

        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeNewsModal_();
        });

        document.body.append(modal);
        return modal;
    }

    function setNewsModalMode_(mode) {
        const modal = ensureNewsModal_();
        newsModalMode_ = mode === 'detail' ? 'detail' : 'list';

        modal.querySelectorAll('[data-home-news-modal-screen]').forEach((screen) => {
            screen.hidden = screen.dataset.homeNewsModalScreen !== newsModalMode_;
        });

        if (newsModalMode_ === 'list') {
            renderNewsModalList_();
            modal.querySelector('.home-news-modal-close')?.focus();
        } else {
            modal.querySelector('.home-news-modal-back')?.focus();
        }
    }

    function renderNewsModalList_() {
        const modal = ensureNewsModal_();
        const filter = modal.querySelector('.home-news-modal-filter');
        const list = modal.querySelector('[data-home-news-modal-list]');
        if (!filter || !list) return;

        filter.replaceChildren(...NEWS_CATEGORIES.map((category) => {
            const categoryClass = category === 'すべて'
                ? 'home-news-category--all'
                : getNewsCategoryClass_(category);
            const button = createTextElement('button', category, `home-news-modal-filter-button ${categoryClass}`);
            button.type = 'button';
            button.classList.toggle('is-active', category === selectedNewsCategory_);
            button.setAttribute('aria-pressed', String(category === selectedNewsCategory_));
            button.addEventListener('click', () => {
                selectedNewsCategory_ = category;
                renderNewsModalList_();
            });
            return button;
        }));

        const visibleItems = selectedNewsCategory_ === 'すべて'
            ? currentNewsItems_
            : currentNewsItems_.filter((item) => item?.category === selectedNewsCategory_);

        if (visibleItems.length === 0) {
            list.replaceChildren(createEmptyItem_('該当する更新履歴はありません。'));
            return;
        }

        list.replaceChildren(...visibleItems.map((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'home-news-modal-list-card';
            button.setAttribute('aria-label', `${formatDate(item.date)} ${item.title || '更新履歴'} の詳細を見る`);

            const meta = document.createElement('div');
            meta.className = 'home-news-modal-list-meta';

            const time = createTextElement('time', formatDate(item.date));
            time.dateTime = item.date || '';
            meta.append(
                time,
                createTextElement('span', item.category || 'その他', `home-news-modal-list-category home-news-category ${getNewsCategoryClass_(item.category)}`)
            );

            button.append(
                meta,
                createTextElement('h4', item.title || '更新履歴'),
                createTextElement('p', item.description || ''),
                createTextElement('span', '詳細を見る', 'home-news-modal-list-action')
            );
            button.addEventListener('click', () => openNewsModal_(item));
            return button;
        }));
    }

    function openNewsModal_(item) {
        const modal = ensureNewsModal_();

        const title = modal.querySelector('#homeNewsModalTitle');
        const date = modal.querySelector('#homeNewsModalDate');
        const category = modal.querySelector('#homeNewsModalCategory');
        const note = modal.querySelector('#homeNewsModalNote');
        const link = modal.querySelector('#homeNewsModalLink');

        const itemTitle = item?.title || '更新履歴';
        const itemDate = item?.date || '';
        const itemNote = item?.note || item?.description || '';
        const itemCategory = item?.category || item?.label || '更新情報';
        const itemUrl = item?.url || '';
        selectedNews_ = item || null;

        if (title) title.textContent = itemTitle;

        if (date) {
            date.textContent = formatDate(itemDate);
            date.dateTime = itemDate;
            date.hidden = !itemDate;
        }

        if (category) {
            category.textContent = itemCategory;
            category.className = `home-news-category ${getNewsCategoryClass_(itemCategory)}`;
        }

        if (note) {
            note.textContent = itemNote;
        }

        if (link) {
            if (itemUrl) {
                link.href = itemUrl;
                link.hidden = false;
            } else {
                link.hidden = true;
            }
        }

        modal.style.display = 'flex';
        setNewsModalMode_('detail');
    }

    function openNewsListModal_() {
        const modal = ensureNewsModal_();
        selectedNews_ = null;
        modal.style.display = 'flex';
        setNewsModalMode_('list');
    }

    function closeNewsModal_() {
        const modal = document.getElementById('homeNewsModal');
        if (!modal) return;
        modal.style.display = 'none';
        newsModalMode_ = 'list';
        selectedNews_ = null;
    }

    function buildEventCalendarTable_(items, options = {}) {
        const targetPrefix = options.targetPrefix || 'home-event-summary';
        const eventItems = (Array.isArray(items) ? items : [])
            .map((item) => ({
                item,
                startDate: getEventStartDate_(item),
                endDate: getEventEndDate_(item),
            }))
            .filter((entry) => entry.startDate);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const monthBase = options.monthBase || visibleCalendarMonth_ || getDefaultEventMonthBase_(eventItems);
        visibleCalendarMonth_ = new Date(monthBase.getFullYear(), monthBase.getMonth(), 1);

        const year = monthBase.getFullYear();
        const month = monthBase.getMonth();
        const firstDate = new Date(year, month, 1);
        const lastDate = new Date(year, month + 1, 0);
        const todayKey = toDateKey_(today);
        const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];
        const monthEvents = eventItems
            .filter((entry) => {
                const end = entry.endDate && entry.endDate >= entry.startDate ? entry.endDate : entry.startDate;
                return entry.startDate <= lastDate && end >= firstDate;
            })
            .sort((a, b) => a.startDate - b.startDate);
        const eventSummaryIdByItem = new Map();
        monthEvents.forEach((entry, index) => {
            eventSummaryIdByItem.set(entry.item, getEventSummaryId_(toDateKey_(entry.startDate), index, targetPrefix));
        });

        const byDate = new Map();
        eventItems.forEach((entry) => {
            const start = new Date(entry.startDate);
            const end = entry.endDate && entry.endDate >= start ? entry.endDate : start;

            for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
                if (cursor.getFullYear() !== year || cursor.getMonth() !== month) continue;
                const key = toDateKey_(cursor);
                if (!byDate.has(key)) byDate.set(key, []);
                byDate.get(key).push(entry);
            }
        });

        const table = document.createElement('table');
        table.className = 'home-event-calendar__table';

        const caption = document.createElement('caption');
        caption.textContent = `${year}年${month + 1}月`;

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        weekdayLabels.forEach((label) => {
            const th = document.createElement('th');
            th.scope = 'col';
            th.textContent = label;
            headRow.append(th);
        });
        thead.append(headRow);

        const tbody = document.createElement('tbody');
        let day = 1;

        for (let rowIndex = 0; rowIndex < 6; rowIndex += 1) {
            const row = document.createElement('tr');

            for (let weekIndex = 0; weekIndex < 7; weekIndex += 1) {
                const cell = document.createElement('td');
                const isBlank = (rowIndex === 0 && weekIndex < firstDate.getDay()) || day > lastDate.getDate();

                if (isBlank) {
                    cell.className = 'home-event-calendar__blank';
                    row.append(cell);
                    continue;
                }

                const date = new Date(year, month, day);
                const key = toDateKey_(date);
                const dayEvents = (byDate.get(key) || [])
                    .slice()
                    .sort(compareCalendarDayEvents_)
                    .map((entry) => entry.item);
                cell.className = 'home-event-calendar__day';
                cell.dataset.eventDateKey = key;
                if (key === todayKey) cell.classList.add('is-today');
                if (dayEvents.length) cell.classList.add('has-event');
                if (dayEvents.length) {
                    cell.title = dayEvents.map((item) => `${getEventTypeLabel_(item)}：${item.title || ''}`).join('\n');
                    cell.tabIndex = 0;
                    cell.setAttribute('role', 'button');
                    cell.setAttribute('aria-label', `${formatDate(key)}のイベント一覧へ移動`);
                    cell.dataset.eventSummaryTargets = dayEvents
                        .map((item) => eventSummaryIdByItem.get(item))
                        .filter(Boolean)
                        .join(',');
                }

                const dayNumber = createTextElement('span', String(day), 'home-event-calendar__date');
                const eventList = document.createElement('div');
                eventList.className = 'home-event-calendar__events';

                dayEvents.slice(0, 4).forEach((item) => {
                    const event = createTextElement('span', getEventTypeLabel_(item), `home-event-calendar__event home-label--${normalizeEventType_(item.type)}`);
                    event.title = `${getEventTypeLabel_(item)}：${item.title || ''}`;
                    eventList.append(event);
                });

                if (dayEvents.length > 4) {
                    eventList.append(createTextElement('span', `+${dayEvents.length - 4}`, 'home-event-calendar__more'));
                }

                cell.append(dayNumber, eventList);
                row.append(cell);
                day += 1;
            }

            tbody.append(row);
            if (day > lastDate.getDate()) break;
        }

        table.append(caption, thead, tbody);
        return {
            table,
            monthLabel: caption.textContent,
            monthBase: visibleCalendarMonth_,
            eventCount: monthEvents.length,
            events: monthEvents.map((entry, index) => ({
                item: entry.item,
                id: getEventSummaryId_(toDateKey_(entry.startDate), index, targetPrefix),
            })),
        };
    }

    function getSummaryTabEntries_(items, calendar) {
        const entries = getEventEntries_(items);
        const today = getToday_();
        const monthBase = calendar?.monthBase || visibleCalendarMonth_ || today;
        let tabEntries = [];

        if (summaryEventTab_ === 'upcoming') {
            tabEntries = getUpcomingEvents_(entries, today, 7);
        } else if (summaryEventTab_ === 'tournament') {
            tabEntries = getMonthTournamentEvents_(entries, monthBase);
        } else if (summaryEventTab_ === 'month') {
            const eventIdByItem = new Map(
                (Array.isArray(calendar?.events) ? calendar.events : [])
                    .map((entry) => [entry.item, entry.id])
            );
            return getMonthEventsForDisplay_(entries, monthBase, today).map((entry, index) => ({
                item: entry.item,
                startDate: entry.startDate,
                endDate: entry.endDate,
                id: eventIdByItem.get(entry.item)
                    || getEventSummaryId_(toDateKey_(entry.startDate), index, 'home-event-summary-month'),
            }));
        } else {
            tabEntries = getOngoingEvents_(entries, today);
        }

        return tabEntries.map((entry, index) => ({
            item: entry.item,
            id: getEventSummaryId_(toDateKey_(entry.startDate), index, `home-event-summary-${summaryEventTab_}`),
        }));
    }

    function getSummaryEmptyText_(calendar) {
        if (summaryEventTab_ === 'upcoming') return '今後７日間に開始するイベントはありません。';
        if (summaryEventTab_ === 'tournament') {
            return `${getCalendarMonthTabLabels_(calendar?.monthBase).tournament}はまだありません。`;
        }
        if (summaryEventTab_ === 'month') return 'この月のイベントはありません。';
        return '現在開催中のイベントはありません。';
    }

    function setSummaryEventTab_(tabName) {
        summaryEventTab_ = tabName || 'ongoing';
        renderEvents(currentEventItems_);
    }

    function buildSummaryEventTabs_(calendar) {
        const tabs = document.createElement('div');
        tabs.className = 'home-event-desktop-tabs home-event-modal-tabs home-event-calendar-summary__tabs';
        const monthLabels = getCalendarMonthTabLabels_(calendar?.monthBase);
        const entries = getEventEntries_(currentEventItems_);
        [
            ['ongoing', '開催中'],
            ['upcoming', '今後７日間'],
            ['month', monthLabels.month],
            ['tournament', monthLabels.tournament],
        ].forEach(([key, labelText]) => {
            const button = createTextElement('button', labelText, 'home-event-desktop-tab');
            button.type = 'button';
            button.classList.toggle('is-active', summaryEventTab_ === key);
            button.setAttribute('aria-pressed', String(summaryEventTab_ === key));
            addTournamentTabBadge_(button, key, entries, calendar?.monthBase || getToday_());
            button.addEventListener('click', () => setSummaryEventTab_(key));
            tabs.append(button);
        });

        return tabs;
    }

    function buildEventCalendarSummary_(items, calendar) {
        const summary = document.createElement('div');
        summary.className = 'home-event-calendar-summary';
        const entries = getSummaryTabEntries_(items, calendar);

        const title = createTextElement('h4', 'イベント一覧');
        summary.append(title, buildSummaryEventTabs_(calendar));

        if (!entries.length) {
            summary.append(createTextElement('p', getSummaryEmptyText_(calendar), 'home-event-calendar-summary__empty'));
            return summary;
        }

        const list = document.createElement('div');
        list.className = 'home-event-calendar-summary__list';

        const isAppMonthList = document.body.classList.contains('is-pwa-standalone')
            && summaryEventTab_ === 'month';
        const visibleEntries = isAppMonthList ? entries.slice(0, 5) : entries;

        const appendEntries = (targetEntries) => targetEntries.forEach((entry) => {
            const item = entry.item;
            const type = normalizeEventType_(item.type);
            const isEnded = Boolean(
                (summaryEventTab_ === 'month' || summaryEventTab_ === 'tournament')
                && isEndedEvent_(entry)
            );
            const row = createEventCardRoot_(item, `home-event-calendar-summary__item home-event-mobile-card--${type}`);
            row.classList.toggle('is-ended', isEnded);
            row.id = entry.id;
            if (!item.url) row.tabIndex = -1;

            const meta = document.createElement('div');
            meta.className = 'home-event-calendar-summary__meta';
            meta.append(
                createTextElement('time', formatEventRange_(item)),
                createTextElement('span', getEventTypeLabel_(item), `home-label home-label--${normalizeEventType_(item.type)}`)
            );
            if (isEnded) {
                meta.append(createTextElement('span', '終了', 'home-event-ended-label'));
            }

            const body = document.createElement('div');
            body.className = 'home-event-calendar-summary__body';
            body.append(
                createTextElement('strong', item.title || ''),
                createTextElement('p', item.description || '')
            );
            appendEventLinkAction_(body, item);

            row.append(meta, body);
            list.append(row);
        });

        appendEntries(visibleEntries);

        if (isAppMonthList && entries.length > visibleEntries.length) {
            const remainingEntries = entries.slice(visibleEntries.length);
            const button = createTextElement(
                'button',
                `さらに表示（残り${remainingEntries.length}件）`,
                'home-event-show-more'
            );
            button.type = 'button';
            button.addEventListener('click', () => {
                button.remove();
                appendEntries(remainingEntries);
            });
            list.append(button);
        }

        summary.append(list);
        return summary;
    }

    function buildEventCalendarControls_(calendar, onMove) {
        const controls = document.createElement('div');
        controls.className = 'home-event-calendar-controls';

        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'home-event-calendar-nav';
        prev.setAttribute('aria-label', '前の月を表示');
        prev.textContent = '‹';

        const title = createTextElement('span', calendar.monthLabel, 'home-event-calendar-controls__title');

        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'home-event-calendar-nav';
        next.setAttribute('aria-label', '次の月を表示');
        next.textContent = '›';

        prev.addEventListener('click', () => onMove(-1));
        next.addEventListener('click', () => onMove(1));
        controls.append(prev, title, next);
        return controls;
    }

    function jumpToEventSummary_(targetIdsText) {
        const targetIds = String(targetIdsText || '').split(',').filter(Boolean);
        const targets = targetIds.map((id) => document.getElementById(id)).filter(Boolean);
        const target = targets[0];
        if (!target) return;

        target.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            block: 'center',
        });
        target.focus({ preventScroll: true });
        targets.forEach((item) => item.classList.remove('is-highlighted'));
        window.setTimeout(() => {
            targets.forEach((item) => item.classList.add('is-highlighted'));
        }, 20);
        window.setTimeout(() => {
            targets.forEach((item) => item.classList.remove('is-highlighted'));
        }, 900);
    }

    function handleCalendarJumpEvent_(event) {
        const day = event.target.closest('.home-event-calendar__day.has-event[data-event-summary-targets]');
        if (!day) return false;

        if (event.type === 'keydown') {
            if (event.key !== 'Enter' && event.key !== ' ') return false;
            event.preventDefault();
        }

        const calendarRoot = day.closest('[data-home-event-calendar]');
        if (calendarRoot && !calendarRoot.hasAttribute('data-home-event-calendar-full')) {
            renderDesktopSelectedDayEvents_(day.dataset.eventDateKey);
            return true;
        }

        if (day.closest('#homeEventCalendarModal')) {
            modalSelectedDayKey_ = day.dataset.eventDateKey || '';
            openEventCalendarModal_(currentEventItems_);
            return true;
        }

        if (summaryEventTab_ !== 'month') {
            summaryEventTab_ = 'month';
            renderEvents(currentEventItems_);
            window.requestAnimationFrame(() => jumpToEventSummary_(day.dataset.eventSummaryTargets));
            return true;
        }

        jumpToEventSummary_(day.dataset.eventSummaryTargets);
        return true;
    }

    function ensureEventCalendarModal_() {
        let modal = document.getElementById('homeEventCalendarModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'homeEventCalendarModal';
        modal.className = 'home-event-calendar-modal';
        modal.style.display = 'none';

        const content = document.createElement('div');
        content.className = 'home-event-calendar-modal__content';
        content.setAttribute('role', 'dialog');
        content.setAttribute('aria-modal', 'true');
        content.setAttribute('aria-labelledby', 'homeEventCalendarModalTitle');

        content.innerHTML = `
            <button type="button" class="home-event-calendar-modal__close" aria-label="閉じる">×</button>
            <div class="home-event-calendar-modal__head">
                <h3 id="homeEventCalendarModalTitle">イベントカレンダー</h3>
            </div>
            <div class="home-event-calendar-modal__body" data-home-event-calendar-modal-body></div>
        `;

        modal.append(content);
        modal.querySelector('.home-event-calendar-modal__close')?.addEventListener('click', closeEventCalendarModal_);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeEventCalendarModal_();
        });
        modal.addEventListener('click', (event) => {
            handleCalendarJumpEvent_(event);
        });
        modal.addEventListener('keydown', (event) => {
            handleCalendarJumpEvent_(event);
        });

        document.body.append(modal);
        return modal;
    }

    function openEventCalendarModal_(items) {
        const modal = ensureEventCalendarModal_();
        const body = modal.querySelector('[data-home-event-calendar-modal-body]');
        const title = modal.querySelector('#homeEventCalendarModalTitle');
        const calendar = buildEventCalendarTable_(items);

        if (title) title.textContent = `イベントカレンダー（${calendar.monthLabel}）`;
        if (body) {
            body.replaceChildren(
                buildEventCalendarControls_(calendar, (amount) => {
                    visibleCalendarMonth_ = addMonths_(visibleCalendarMonth_ || calendar.monthBase, amount);
                    desktopSelectedDayKey_ = '';
                    modalSelectedDayKey_ = '';
                    openEventCalendarModal_(items);
                    renderEvents(currentEventItems_);
                }),
                calendar.table,
                buildModalEventPanel_(items, calendar)
            );
        }

        modal.style.display = 'flex';
        modal.querySelector('.home-event-calendar-modal__close')?.focus();
    }

    function closeEventCalendarModal_() {
        const modal = document.getElementById('homeEventCalendarModal');
        if (!modal) return;
        modal.style.display = 'none';
    }

    function renderEventCalendar_(items) {
        const root = document.querySelector('[data-home-event-calendar]');
        if (!root) return null;

        const isFullCalendar = root.hasAttribute('data-home-event-calendar-full');
        const calendar = buildEventCalendarTable_(items, {
            targetPrefix: isFullCalendar ? 'home-event-summary' : 'home-event-list',
        });
        const controls = buildEventCalendarControls_(calendar, (amount) => {
            visibleCalendarMonth_ = addMonths_(visibleCalendarMonth_ || calendar.monthBase, amount);
            desktopSelectedDayKey_ = '';
            renderEvents(currentEventItems_);
        });

        if (isFullCalendar) {
            root.replaceChildren(
                controls,
                calendar.table,
                buildEventCalendarSummary_(items, calendar)
            );

            if (!root.dataset.calendarJumpBound) {
                root.addEventListener('click', handleCalendarJumpEvent_);
                root.addEventListener('keydown', handleCalendarJumpEvent_);
                root.dataset.calendarJumpBound = 'true';
            }

            return calendar;
        }

        const inline = document.createElement('div');
        inline.className = 'home-event-calendar-inline';
        inline.append(
            controls,
            calendar.table
        );

        if (!root.dataset.calendarJumpBound) {
            root.addEventListener('click', handleCalendarJumpEvent_);
            root.addEventListener('keydown', handleCalendarJumpEvent_);
            root.dataset.calendarJumpBound = 'true';
        }

        root.replaceChildren(inline);
        return calendar;
    }

    function createMobileEventLabel_(item) {
        return createTextElement('span', getEventTypeLabel_(item), `home-label home-label--${normalizeEventType_(item?.type)}`);
    }

    function createEventCardRoot_(item, className) {
        const url = String(item?.url || '').trim();
        const element = document.createElement(url ? 'a' : 'article');
        element.className = className;

        if (url) {
            element.classList.add('home-event-link');
            element.href = url;
            element.setAttribute('aria-label', `${item?.title || 'イベント'}の詳細を開く`);
            if (/^https?:\/\//i.test(url)) {
                element.target = '_blank';
                element.rel = 'noopener noreferrer';
            }
        }

        return element;
    }

    function appendEventLinkAction_(container, item) {
        if (!String(item?.url || '').trim()) return;
        container.append(createTextElement('span', '詳細を見る ↗', 'home-event-link__action'));
    }

    function createMobileOngoingEvent_(entry) {
        const item = entry.item || {};
        const type = normalizeEventType_(item.type);
        const row = createEventCardRoot_(item, `home-event-mobile-card home-event-mobile-card--${type}`);

        const meta = document.createElement('div');
        meta.className = 'home-event-mobile-card__meta';
        const endText = entry.endDate ? `${formatMonthDay_(entry.endDate)}まで` : '';
        meta.append(
            createTextElement('strong', item.title || 'イベント'),
            createTextElement('time', endText, 'home-event-mobile-card__date')
        );

        const body = document.createElement('div');
        body.className = 'home-event-mobile-card__body';
        body.append(
            meta,
            createMobileEventLabel_(item)
        );
        if (item.description) {
            body.append(createTextElement('p', item.description, 'home-event-mobile-description'));
        }
        appendEventLinkAction_(body, item);

        row.append(body);
        return row;
    }

    function createMobileUpcomingEvent_(entry) {
        const item = entry.item || {};
        const type = normalizeEventType_(item.type);
        const row = createEventCardRoot_(item, `home-event-mobile-row home-event-mobile-card--${type}`);

        const body = document.createElement('div');
        body.className = 'home-event-mobile-row__body';
        const meta = document.createElement('div');
        meta.className = 'home-event-mobile-row__meta';
        const date = createTextElement('time', formatUpcomingMobileDate_(entry), 'home-event-mobile-row__date');
        date.dateTime = item.startAt || item.date || '';
        meta.append(
            createTextElement('strong', item.title || 'イベント'),
            date
        );

        body.append(
            meta,
            createMobileEventLabel_(item)
        );
        if (item.description) {
            body.append(createTextElement('p', item.description, 'home-event-mobile-description'));
        }
        appendEventLinkAction_(body, item);

        row.append(body);
        return row;
    }

    function renderMobileEventTabContent_(list, items) {
        const today = getToday_();
        const entries = getEventEntries_(items);

        if (mobileEventTab_ === 'upcoming') {
            appendCompactEventList_(list, getUpcomingEvents_(entries, today, 7), {
                emptyText: '今後7日間に開始するイベントはありません。',
                getDateText: formatUpcomingMobileDate_,
            });
            return;
        }

        if (mobileEventTab_ === 'month') {
            appendCompactEventList_(list, getMonthEventsForDisplay_(entries, today), {
                limit: 5,
                showMoreButton: true,
                markEnded: true,
                emptyText: '今月のイベントはありません。',
                getDateText: formatMonthEventDateRange_,
            });
            return;
        }

        if (mobileEventTab_ === 'tournament') {
            appendCompactEventList_(list, getMonthTournamentEvents_(entries, today), {
                emptyText: '今月の大会はまだありません。',
                markEnded: true,
                getDateText: formatMonthEventDateRange_,
            });
            return;
        }

        appendCompactEventList_(list, getOngoingEvents_(entries, today), {
            emptyText: '現在開催中のイベントはありません。',
            getDateText: (entry) => (entry.endDate ? `${formatMonthDay_(entry.endDate)}まで` : ''),
        });
    }

    function setMobileEventTab_(tabName) {
        mobileEventTab_ = tabName || 'ongoing';
        renderMobileEventOverview_(currentEventItems_);
    }

    function renderMobileEventOverview_(items) {
        const root = document.querySelector('[data-home-event-mobile-overview]');
        if (!root) return;

        const entries = getEventEntries_(items);
        const monthBase = getToday_();
        const tabs = document.createElement('div');
        tabs.className = 'home-event-desktop-tabs home-event-mobile-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'イベント一覧の表示切り替え');

        [
            ['ongoing', '開催中'],
            ['upcoming', '今後7日間'],
            ['month', '今月'],
            ['tournament', '大会'],
        ].forEach(([key, labelText]) => {
            const button = createTextElement('button', labelText, 'home-event-desktop-tab');
            const isActive = mobileEventTab_ === key;
            button.type = 'button';
            button.setAttribute('role', 'tab');
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', String(isActive));
            addTournamentTabBadge_(button, key, entries, monthBase);
            button.addEventListener('click', () => setMobileEventTab_(key));
            tabs.append(button);
        });

        const list = document.createElement('div');
        list.className = 'home-event-desktop-list home-event-mobile-tab-list';
        renderMobileEventTabContent_(list, items);

        const button = createTextElement('button', 'カレンダーで見る', 'home-event-mobile-calendar-button');
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'dialog');
        button.addEventListener('click', () => openEventCalendarModal_(items));

        root.replaceChildren(tabs, list, button);
    }

    function setDesktopEventTab_(tabName) {
        desktopEventTab_ = tabName || 'ongoing';
        desktopSelectedDayKey_ = '';
        renderEvents(currentEventItems_);
    }

    function createCompactEventCard_(entry, options = {}) {
        const item = entry.item || {};
        const type = normalizeEventType_(item.type);
        const isTournament = isTournamentItem_(item);
        const card = createEventCardRoot_(item, `home-event-desktop-card home-event-mobile-card--${type}`);
        card.classList.toggle('is-ended', Boolean(options.isEnded));

        const body = document.createElement('div');
        body.className = 'home-event-desktop-card__body';

        const meta = document.createElement('div');
        meta.className = 'home-event-desktop-card__meta';
        meta.append(createTextElement('strong', item.title || 'イベント'));
        if (options.dateText) {
            const time = createTextElement('time', options.dateText, 'home-event-desktop-card__date');
            time.dateTime = item.startAt || item.date || '';
            meta.append(time);
        }

        const eventDetails = document.createElement('div');
        eventDetails.className = 'home-event-desktop-card__details';
        eventDetails.append(createMobileEventLabel_(item));
        if (options.isEnded) {
            eventDetails.append(createTextElement('span', '終了', 'home-event-ended-label'));
        }

        const tournamentTimeText = isTournament ? getTournamentTimeText_(item) : '';
        if (tournamentTimeText) {
            eventDetails.append(createTextElement('time', tournamentTimeText, 'home-event-desktop-card__time'));
        }

        body.append(meta, eventDetails);

        if (item.description) {
            body.append(createTextElement('p', item.description, 'home-event-desktop-card__description'));
        }
        appendEventLinkAction_(body, item);

        card.append(body);
        return card;
    }

    function appendCompactEventList_(list, entries, options) {
        const limit = options.limit || entries.length;
        const visibleEntries = entries.slice(0, limit);
        if (!visibleEntries.length) {
            list.append(createTextElement('p', options.emptyText || '表示できるイベントはありません。', 'home-event-desktop-empty'));
            return;
        }

        const appendEntries = (targetEntries) => {
            targetEntries.forEach((entry) => {
                const today = getToday_();
                const isEnded = Boolean(options.markEnded && isEndedEvent_(entry, today));
                list.append(createCompactEventCard_(entry, {
                    dateText: options.getDateText ? options.getDateText(entry) : '',
                    showDescription: options.showDescription,
                    isEnded,
                }));
            });
        };

        appendEntries(visibleEntries);

        if (entries.length > limit && options.showMoreButton) {
            const remainingEntries = entries.slice(limit);
            const button = createTextElement(
                'button',
                `さらに表示（残り${remainingEntries.length}件）`,
                'home-event-show-more'
            );
            button.type = 'button';
            button.addEventListener('click', () => {
                button.remove();
                appendEntries(remainingEntries);
            });
            list.append(button);
            return;
        }

        /*
         * PC表示など件数制限だけを使う一覧では、残り件数のみ表示する
         */
        if (entries.length > limit) {
            list.append(createTextElement('p', `+${entries.length - limit}件`, 'home-event-desktop-more'));
        }
    }

    function renderDesktopEventTabContent_(list, entries, calendar) {
        const today = getToday_();
        if (desktopEventTab_ === 'upcoming') {
            appendCompactEventList_(list, getUpcomingEvents_(entries, today, 7), {
                limit: 5,
                emptyText: '今後7日間に開始するイベントはありません。',
                getDateText: formatUpcomingMobileDate_,
            });
            return;
        }

        if (desktopEventTab_ === 'month') {
            appendCompactEventList_(list, getMonthEventsForDisplay_(entries, calendar?.monthBase || visibleCalendarMonth_ || today, today), {
                markEnded: true,
                emptyText: 'この月のイベントはありません。',
                getDateText: formatMonthEventDateRange_,
            });
            return;
        }

        if (desktopEventTab_ === 'tournament') {
            appendCompactEventList_(list, getMonthTournamentEvents_(entries, calendar?.monthBase || visibleCalendarMonth_ || today), {
                limit: 8,
                emptyText: '今月の大会はまだありません。',
                markEnded: true,
                getDateText: formatMonthEventDateRange_,
            });
            return;
        }

        appendCompactEventList_(list, getOngoingEvents_(entries, today), {
            limit: 5,
            emptyText: '現在開催中のイベントはありません。',
            getDateText: (entry) => (entry.endDate ? `${formatMonthDay_(entry.endDate)}まで` : ''),
        });
    }

    function renderDesktopSelectedDayEvents_(dateKey) {
        desktopSelectedDayKey_ = dateKey || '';
        renderDesktopEventPanel_(currentEventItems_, {
            monthBase: visibleCalendarMonth_ || getToday_(),
        });
    }

    function renderDesktopEventPanel_(items, calendar) {
        const root = document.querySelector('[data-home-event-desktop-panel]');
        if (!root) return;

        const entries = getEventEntries_(items);
        const list = document.createElement('div');
        list.className = 'home-event-desktop-list';

        if (desktopSelectedDayKey_) {
            const head = document.createElement('div');
            head.className = 'home-event-desktop-selected-head';

            const back = createTextElement('button', '← 一覧へ戻る', 'home-event-desktop-back');
            back.type = 'button';
            back.addEventListener('click', () => {
                desktopSelectedDayKey_ = '';
                renderDesktopEventPanel_(currentEventItems_, calendar);
            });

            head.append(
                back,
                createTextElement('h3', `${formatDate(desktopSelectedDayKey_)} のイベント`, 'home-event-desktop-title')
            );

            appendCompactEventList_(list, getEventsOnDate_(entries, desktopSelectedDayKey_), {
                emptyText: 'この日のイベントはありません。',
            });

            root.replaceChildren(head, list);
            syncDesktopEventPanelHeight_();
            return;
        }

        const tabs = document.createElement('div');
        tabs.className = 'home-event-desktop-tabs';
        const monthLabels = getCalendarMonthTabLabels_(calendar?.monthBase);
        [
            ['ongoing', '開催中'],
            ['upcoming', '今後7日'],
            ['month', monthLabels.month],
            ['tournament', monthLabels.tournament],
        ].forEach(([key, labelText]) => {
            const button = createTextElement('button', labelText, 'home-event-desktop-tab');
            button.type = 'button';
            button.classList.toggle('is-active', desktopEventTab_ === key);
            button.setAttribute('aria-pressed', String(desktopEventTab_ === key));
            addTournamentTabBadge_(button, key, entries, calendar?.monthBase || getToday_());
            button.addEventListener('click', () => setDesktopEventTab_(key));
            tabs.append(button);
        });

        renderDesktopEventTabContent_(list, entries, calendar);
        root.replaceChildren(tabs, list);
        syncDesktopEventPanelHeight_();
    }

    function syncDesktopEventPanelHeight_() {
        const calendar = document.querySelector('[data-home-event-calendar]');
        const column = document.querySelector('.home-event-list-column');
        if (!calendar || !column) return;

        if (window.matchMedia('(max-width: 1024px)').matches) {
            column.style.removeProperty('--home-event-calendar-height');
            return;
        }

        const height = Math.round(calendar.getBoundingClientRect().height);
        if (height > 0) {
            column.style.setProperty('--home-event-calendar-height', `${height}px`);
        }
    }

    function bindDesktopEventPanelHeight_() {
        const calendar = document.querySelector('[data-home-event-calendar]');
        if (!calendar || calendar.dataset.desktopHeightBound === '1') return;
        calendar.dataset.desktopHeightBound = '1';

        if ('ResizeObserver' in window) {
            const observer = new ResizeObserver(syncDesktopEventPanelHeight_);
            observer.observe(calendar);
        }
        window.addEventListener('resize', syncDesktopEventPanelHeight_);
    }

    function setModalEventTab_(tabName) {
        modalEventTab_ = tabName || 'ongoing';
        modalSelectedDayKey_ = '';
        openEventCalendarModal_(currentEventItems_);
    }

    function renderModalEventTabContent_(list, entries, calendar) {
        const today = getToday_();
        if (modalEventTab_ === 'upcoming') {
            appendCompactEventList_(list, getUpcomingEvents_(entries, today, 7), {
                limit: 5,
                emptyText: '今後7日間に開始するイベントはありません。',
                getDateText: formatUpcomingMobileDate_,
            });
            return;
        }

        if (modalEventTab_ === 'month') {
            appendCompactEventList_(list, getMonthEventsForDisplay_(entries, calendar?.monthBase || visibleCalendarMonth_ || today, today), {
                limit: 8,
                markEnded: true,
                emptyText: 'この月のイベントはありません。',
                getDateText: formatMonthEventDateRange_,
            });
            return;
        }

        if (modalEventTab_ === 'tournament') {
            appendCompactEventList_(list, getMonthTournamentEvents_(entries, calendar?.monthBase || visibleCalendarMonth_ || today), {
                limit: 8,
                emptyText: '今月の大会はまだありません。',
                markEnded: true,
                getDateText: formatMonthEventDateRange_,
            });
            return;
        }

        appendCompactEventList_(list, getOngoingEvents_(entries, today), {
            limit: 5,
            emptyText: '現在開催中のイベントはありません。',
            getDateText: (entry) => (entry.endDate ? `${formatMonthDay_(entry.endDate)}まで` : ''),
        });
    }

    function buildModalEventPanel_(items, calendar) {
        const panel = document.createElement('section');
        panel.className = 'home-event-modal-panel';

        const entries = getEventEntries_(items);
        const list = document.createElement('div');
        list.className = 'home-event-desktop-list home-event-modal-list';

        if (modalSelectedDayKey_) {
            const head = document.createElement('div');
            head.className = 'home-event-desktop-selected-head';

            const back = createTextElement('button', '← 一覧へ戻る', 'home-event-desktop-back');
            back.type = 'button';
            back.addEventListener('click', () => {
                modalSelectedDayKey_ = '';
                openEventCalendarModal_(currentEventItems_);
            });

            head.append(
                back,
                createTextElement('h3', `${formatDate(modalSelectedDayKey_)} のイベント`, 'home-event-desktop-title')
            );

            appendCompactEventList_(list, getEventsOnDate_(entries, modalSelectedDayKey_), {
                emptyText: 'この日のイベントはありません。',
            });

            panel.append(head, list);
            return panel;
        }

        const tabs = document.createElement('div');
        tabs.className = 'home-event-desktop-tabs home-event-modal-tabs';
        const monthLabels = getCalendarMonthTabLabels_(calendar?.monthBase);
        [
            ['ongoing', '開催中'],
            ['upcoming', '今後7日'],
            ['month', monthLabels.month],
            ['tournament', monthLabels.tournament],
        ].forEach(([key, labelText]) => {
            const button = createTextElement('button', labelText, 'home-event-desktop-tab');
            button.type = 'button';
            button.classList.toggle('is-active', modalEventTab_ === key);
            button.setAttribute('aria-pressed', String(modalEventTab_ === key));
            addTournamentTabBadge_(button, key, entries, calendar?.monthBase || getToday_());
            button.addEventListener('click', () => setModalEventTab_(key));
            tabs.append(button);
        });

        renderModalEventTabContent_(list, entries, calendar);
        panel.append(tabs, list);
        return panel;
    }

    function renderEvents(items) {
        currentEventItems_ = Array.isArray(items) ? items : [];
        renderMobileEventOverview_(currentEventItems_);
        const calendar = renderEventCalendar_(items);
        renderDesktopEventPanel_(currentEventItems_, calendar);
    }

    function normalizeEventType_(type) {
        const key = String(type || '').trim();

        const map = {
            official: 'official',
            pack: 'pack',
            prediction: 'prediction',
            user: 'user',
            site: 'site',
            tournament: 'tournament',
            login: 'login',
            sale: 'sale',
            craft: 'craft',
            other: 'other',
            '期間限定パック': 'pack',
            '公式大会': 'tournament',
            'ユーザー大会': 'user',
            'ゲームイベント': 'official',
            '販売': 'pack',
            '宝箱': 'prediction',
            'ログイン': 'login',
            '分解生成': 'craft',
            '生成分解': 'craft',
            'その他': 'other',
        };

        return map[key] || 'site';
    }

    function createEmptyItem_(message) {
        const article = document.createElement('article');
        article.className = 'home-list-item';

        const body = document.createElement('div');
        body.append(createTextElement('p', message));

        article.append(body);
        return article;
    }

    function createEmptyFeatureItem_(message) {
        const article = document.createElement('article');
        article.className = 'home-feature-card home-feature-card--empty';
        article.append(createTextElement('p', message));
        return article;
    }

    async function fetchHomeData() {
        const response = await fetch(HOME_DATA_URL, {
            method: 'GET',
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error(`home-data.json fetch failed: ${response.status}`);
        }

        const json = await response.json();

        if (!json || json.ok === false) {
            throw new Error(json?.error || 'home-data.json response error');
        }

        return {
            news: Array.isArray(json.news) ? json.news : [],
            events: Array.isArray(json.events) ? json.events : [],
            features: Array.isArray(json.features) ? json.features : [],
        };
    }

    function bindDisabledLinks() {
        document.addEventListener('click', (event) => {
            const link = event.target.closest('[data-home-disabled-link]');
            if (!link) return;
            event.preventDefault();
        });
    }

    function bindNewsModalKeys_() {
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;

            const modal = document.getElementById('homeNewsModal');
            const calendarModal = document.getElementById('homeEventCalendarModal');

            if (modal && modal.style.display !== 'none') {
                closeNewsModal_();
            }

            if (calendarModal && calendarModal.style.display !== 'none') {
                closeEventCalendarModal_();
            }
        });
    }

    function bindNewsListModal_() {
        document.querySelectorAll('[data-home-news-list-open]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                openNewsListModal_();
            });
        });
    }

    async function init() {
        bindDisabledLinks();
        bindNewsModalKeys_();
        bindNewsListModal_();
        bindDesktopEventPanelHeight_();

        const initialData = getInitialHomeData_();
        renderNews(initialData.news);
        renderEvents(initialData.events);
        renderFeatures(initialData.features);

        try {
            const data = await fetchHomeData();
            renderNews(data.news);
            renderEvents(data.events);
            renderFeatures(data.features);
        } catch (error) {
            console.warn(error);
            renderNews(initialData.news);
            renderEvents(initialData.events);
            renderFeatures(initialData.features);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
