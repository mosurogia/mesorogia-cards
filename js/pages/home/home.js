/* =========================
 * ホームページ用データ描画
 * home-data.json から更新履歴・イベント情報を取得する
 * ========================= */
(function () {
    'use strict';

    const HOME_DATA_URL = './public/home-data.json';

    const FALLBACK_NEWS_ITEMS = [];
    const FALLBACK_EVENT_ITEMS = [];
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

    function getInitialHomeData_() {
        const dataElement = document.getElementById('home-initial-data');
        if (!dataElement) {
            return {
                news: FALLBACK_NEWS_ITEMS,
                events: FALLBACK_EVENT_ITEMS,
            };
        }

        try {
            const json = JSON.parse(dataElement.textContent || '{}');
            return {
                news: Array.isArray(json.news) ? json.news : FALLBACK_NEWS_ITEMS,
                events: Array.isArray(json.events) ? json.events : FALLBACK_EVENT_ITEMS,
            };
        } catch (error) {
            console.warn(error);
            return {
                news: FALLBACK_NEWS_ITEMS,
                events: FALLBACK_EVENT_ITEMS,
            };
        }
    }

    function formatDate(dateText) {
        const date = new Date(`${dateText}T00:00:00`);
        if (Number.isNaN(date.getTime())) return dateText || '';

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}.${month}.${day}`;
    }

    function parseDate_(dateText) {
        if (!dateText) return null;
        const date = new Date(`${dateText}T00:00:00`);
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

    function getEventEndDate_(item) {
        return parseDate_(item?.endAt || item?.startAt || item?.date);
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

    function getMonthTournamentEvents_(entries, monthBase) {
        return getMonthEvents_(entries, monthBase).filter(isTournamentEvent_);
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
        return `${formatDate(start)} ～ ${formatDate(end)}`;
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

    function buildEventCalendarSummary_(entries) {
        const summary = document.createElement('div');
        summary.className = 'home-event-calendar-summary';

        const title = createTextElement('h4', 'この月のイベント');
        summary.append(title);

        if (!entries.length) {
            summary.append(createTextElement('p', '表示できるイベントはありません。', 'home-event-calendar-summary__empty'));
            return summary;
        }

        const list = document.createElement('div');
        list.className = 'home-event-calendar-summary__list';

        entries.forEach((entry) => {
            const item = entry.item;
            const row = document.createElement('article');
            row.className = 'home-event-calendar-summary__item';
            row.id = entry.id;
            row.tabIndex = -1;

            const meta = document.createElement('div');
            meta.className = 'home-event-calendar-summary__meta';
            meta.append(
                createTextElement('time', formatEventRange_(item)),
                createTextElement('span', getEventTypeLabel_(item), `home-label home-label--${normalizeEventType_(item.type)}`)
            );

            const body = document.createElement('div');
            body.append(
                createTextElement('strong', item.title || ''),
                createTextElement('p', item.description || '')
            );

            row.append(meta, body);
            list.append(row);
        });

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
                buildEventCalendarSummary_(calendar.events)
            );

            if (!root.dataset.calendarJumpBound) {
                root.addEventListener('click', handleCalendarJumpEvent_);
                root.addEventListener('keydown', handleCalendarJumpEvent_);
                root.dataset.calendarJumpBound = 'true';
            }

            return calendar;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'home-event-calendar-button';
        button.setAttribute('aria-haspopup', 'dialog');

        const month = createTextElement('span', calendar.monthLabel, 'home-event-calendar-button__month');
        const text = createTextElement('span', 'カレンダーで見る', 'home-event-calendar-button__text');
        const count = createTextElement('span', `${calendar.eventCount}件`, 'home-event-calendar-button__count');
        button.append(month, text, count);
        button.addEventListener('click', () => openEventCalendarModal_(items));

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

        root.replaceChildren(button, inline);
        return calendar;
    }

    function createMobileEventSection_(titleText) {
        const section = document.createElement('section');
        section.className = 'home-event-mobile-section';

        const title = createTextElement('h3', titleText, 'home-event-mobile-section__title');
        const list = document.createElement('div');
        list.className = 'home-event-mobile-section__list';
        section.append(title, list);

        return { section, list };
    }

    function createMobileEventLabel_(item) {
        return createTextElement('span', getEventTypeLabel_(item), `home-label home-label--${normalizeEventType_(item?.type)}`);
    }

    function makeEventDescriptionTrigger_(element, item) {
        const description = String(item?.description || '').trim();
        if (!description) return element;

        element.classList.add('home-event-description-trigger');
        element.tabIndex = 0;
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', `${item?.title || 'イベント'}の説明を表示`);
        element.dataset.homeEventDescription = description;
        element.dataset.homeEventTitle = item?.title || 'イベント';
        element.dataset.homeEventLabel = getEventTypeLabel_(item);
        element.dataset.homeEventType = normalizeEventType_(item?.type);
        return element;
    }

    function createMobileOngoingEvent_(entry) {
        const item = entry.item || {};
        const type = normalizeEventType_(item.type);
        const row = document.createElement('article');
        row.className = `home-event-mobile-card home-event-mobile-card--${type}`;

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

        row.append(body);
        return makeEventDescriptionTrigger_(row, item);
    }

    function createMobileUpcomingEvent_(entry) {
        const item = entry.item || {};
        const type = normalizeEventType_(item.type);
        const row = document.createElement('article');
        row.className = `home-event-mobile-row home-event-mobile-card--${type}`;

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

        row.append(body);
        return makeEventDescriptionTrigger_(row, item);
    }

    function renderMobileEventOverview_(items) {
        const root = document.querySelector('[data-home-event-mobile-overview]');
        if (!root) return;

        const today = getToday_();
        const entries = getEventEntries_(items);

        const ongoing = entries
            .filter((entry) => isOngoingEvent_(entry, today))
            .sort((a, b) => {
                const endDiff = (a.endDate || a.startDate) - (b.endDate || b.startDate);
                return endDiff || compareEventEntries_(a, b);
            });
        const upcoming = entries
            .filter((entry) => isUpcomingWithinDays_(entry, today, 7))
            .sort(compareEventEntries_);

        const ongoingSection = createMobileEventSection_('現在開催中');
        if (ongoing.length) {
            ongoing.forEach((entry) => ongoingSection.list.append(createMobileOngoingEvent_(entry)));
        } else {
            ongoingSection.list.append(createTextElement('p', '現在開催中のイベントはありません。', 'home-event-mobile-empty'));
        }

        const upcomingSection = createMobileEventSection_('今後7日間の予定');
        if (upcoming.length) {
            upcoming.slice(0, 3).forEach((entry) => upcomingSection.list.append(createMobileUpcomingEvent_(entry)));
        } else {
            upcomingSection.list.append(createTextElement('p', '今後7日間に開始するイベントはありません。', 'home-event-mobile-empty'));
        }

        const button = createTextElement('button', 'イベントカレンダーを見る', 'home-event-mobile-calendar-button');
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'dialog');
        button.addEventListener('click', () => openEventCalendarModal_(items));

        root.replaceChildren(ongoingSection.section, upcomingSection.section, button);
    }

    function setDesktopEventTab_(tabName) {
        desktopEventTab_ = tabName || 'ongoing';
        desktopSelectedDayKey_ = '';
        renderEvents(currentEventItems_);
    }

    function createCompactEventCard_(entry, options = {}) {
        const item = entry.item || {};
        const type = normalizeEventType_(item.type);
        const card = document.createElement('article');
        card.className = `home-event-desktop-card home-event-mobile-card--${type}`;

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

        body.append(
            meta,
            createMobileEventLabel_(item)
        );

        if (options.showDescription && item.description) {
            body.append(createTextElement('p', item.description, 'home-event-desktop-card__description'));
        }

        card.append(body);
        return makeEventDescriptionTrigger_(card, item);
    }

    function appendCompactEventList_(list, entries, options) {
        const limit = options.limit || entries.length;
        const visibleEntries = entries.slice(0, limit);
        if (!visibleEntries.length) {
            list.append(createTextElement('p', options.emptyText || '表示できるイベントはありません。', 'home-event-desktop-empty'));
            return;
        }

        visibleEntries.forEach((entry) => {
            list.append(createCompactEventCard_(entry, {
                dateText: options.getDateText ? options.getDateText(entry) : '',
                showDescription: options.showDescription,
            }));
        });

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
            appendCompactEventList_(list, getMonthEvents_(entries, calendar?.monthBase || visibleCalendarMonth_ || today), {
                limit: 8,
                emptyText: 'この月のイベントはありません。',
                getDateText: (entry) => formatMonthDay_(entry.startDate),
            });
            return;
        }

        if (desktopEventTab_ === 'tournament') {
            appendCompactEventList_(list, getMonthTournamentEvents_(entries, calendar?.monthBase || visibleCalendarMonth_ || today), {
                limit: 8,
                emptyText: '今月の大会はまだありません。',
                getDateText: (entry) => formatMonthDay_(entry.startDate),
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
            return;
        }

        const tabs = document.createElement('div');
        tabs.className = 'home-event-desktop-tabs';
        [
            ['ongoing', '開催中'],
            ['upcoming', '今後7日'],
            ['month', '今月'],
            ['tournament', '今月の大会'],
        ].forEach(([key, labelText]) => {
            const button = createTextElement('button', labelText, 'home-event-desktop-tab');
            button.type = 'button';
            button.classList.toggle('is-active', desktopEventTab_ === key);
            button.setAttribute('aria-pressed', String(desktopEventTab_ === key));
            button.addEventListener('click', () => setDesktopEventTab_(key));
            tabs.append(button);
        });

        renderDesktopEventTabContent_(list, entries, calendar);
        root.replaceChildren(tabs, list);
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
            appendCompactEventList_(list, getMonthEvents_(entries, calendar?.monthBase || visibleCalendarMonth_ || today), {
                limit: 8,
                emptyText: 'この月のイベントはありません。',
                getDateText: (entry) => formatMonthDay_(entry.startDate),
            });
            return;
        }

        if (modalEventTab_ === 'tournament') {
            appendCompactEventList_(list, getMonthTournamentEvents_(entries, calendar?.monthBase || visibleCalendarMonth_ || today), {
                limit: 8,
                emptyText: '今月の大会はまだありません。',
                getDateText: (entry) => formatMonthDay_(entry.startDate),
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
        [
            ['ongoing', '開催中'],
            ['upcoming', '今後7日'],
            ['month', '今月'],
            ['tournament', '今月の大会'],
        ].forEach(([key, labelText]) => {
            const button = createTextElement('button', labelText, 'home-event-desktop-tab');
            button.type = 'button';
            button.classList.toggle('is-active', modalEventTab_ === key);
            button.setAttribute('aria-pressed', String(modalEventTab_ === key));
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

    function ensureEventDescriptionTooltip_() {
        let tooltip = document.getElementById('homeEventDescriptionTooltip');
        if (tooltip) return tooltip;

        tooltip = document.createElement('div');
        tooltip.id = 'homeEventDescriptionTooltip';
        tooltip.className = 'home-event-description-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.innerHTML = `
            <div class="home-event-description-tooltip__head">
                <span class="home-event-description-tooltip__label"></span>
                <strong></strong>
            </div>
            <p></p>
        `;
        document.body.append(tooltip);
        return tooltip;
    }

    function hideEventDescriptionTooltip_() {
        const tooltip = document.getElementById('homeEventDescriptionTooltip');
        if (!tooltip) return;
        tooltip.classList.remove('is-show');
    }

    function showEventDescriptionTooltip_(target) {
        const text = String(target?.dataset?.homeEventDescription || '').trim();
        if (!text) return;

        const tooltip = ensureEventDescriptionTooltip_();
        const label = tooltip.querySelector('.home-event-description-tooltip__label');
        const title = tooltip.querySelector('strong');
        const body = tooltip.querySelector('p');
        const type = normalizeEventType_(target.dataset.homeEventType);

        tooltip.className = `home-event-description-tooltip home-event-description-tooltip--${type}`;
        if (label) label.textContent = target.dataset.homeEventLabel || 'イベント';
        if (title) title.textContent = target.dataset.homeEventTitle || 'イベント';
        if (body) body.textContent = text;
        tooltip.classList.add('is-show');

        const rect = target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const margin = 12;
        const gap = 8;
        const left = Math.min(
            Math.max(margin, rect.left + (rect.width / 2) - (tooltipRect.width / 2)),
            Math.max(margin, window.innerWidth - tooltipRect.width - margin)
        );
        const topAbove = rect.top - tooltipRect.height - gap;
        const top = topAbove >= margin
            ? topAbove
            : Math.min(rect.bottom + gap, Math.max(margin, window.innerHeight - tooltipRect.height - margin));

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    function bindEventDescriptionTooltip_() {
        if (document.body.dataset.homeEventDescriptionTooltipBound === '1') return;
        document.body.dataset.homeEventDescriptionTooltipBound = '1';

        document.addEventListener('click', (event) => {
            const target = event.target.closest('.home-event-description-trigger[data-home-event-description]');
            if (!target) {
                hideEventDescriptionTooltip_();
                return;
            }

            event.preventDefault();
            showEventDescriptionTooltip_(target);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                hideEventDescriptionTooltip_();
                return;
            }

            const target = event.target.closest?.('.home-event-description-trigger[data-home-event-description]');
            if (!target || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            showEventDescriptionTooltip_(target);
        });

        document.addEventListener('scroll', hideEventDescriptionTooltip_, { passive: true, capture: true });
        window.addEventListener('resize', hideEventDescriptionTooltip_);
    }

    async function init() {
        bindDisabledLinks();
        bindNewsModalKeys_();
        bindNewsListModal_();
        bindEventDescriptionTooltip_();

        const initialData = getInitialHomeData_();
        renderNews(initialData.news);
        renderEvents(initialData.events);

        try {
            const data = await fetchHomeData();
            renderNews(data.news);
            renderEvents(data.events);
        } catch (error) {
            console.warn(error);
            renderNews(initialData.news);
            renderEvents(initialData.events);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
