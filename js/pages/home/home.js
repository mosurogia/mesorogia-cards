/* =========================
 * ホームページ用データ描画
 * home-data.json から更新履歴・イベント情報を取得する
 * ========================= */
(function () {
    'use strict';

    const HOME_DATA_URL = './public/home-data.json';

    const FALLBACK_NEWS_ITEMS = [];
    const FALLBACK_EVENT_ITEMS = [];
    let currentEventItems_ = [];
    let visibleCalendarMonth_ = null;

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

    function getEventTypeLabel_(item) {
        return item?.label || item?.type || 'イベント';
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

    function getDefaultEventMonthBase_(eventItems) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const futureEvents = eventItems
            .filter((entry) => entry.endDate && entry.endDate >= today)
            .sort((a, b) => a.startDate - b.startDate);
        const sortedEvents = eventItems.slice().sort((a, b) => a.startDate - b.startDate);

        return futureEvents[0]?.startDate || sortedEvents[0]?.startDate || today;
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

    function renderNews(items) {
        const list = document.querySelector('[data-home-news-list]');
        if (!list) return;

        const newsItems = Array.isArray(items) ? items : [];

        if (newsItems.length === 0) {
            list.replaceChildren(createEmptyItem_('現在表示できる更新履歴はありません。'));
            return;
        }

        list.replaceChildren(...newsItems.slice(0, 5).map((item) => {
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

            const body = document.createElement('div');
            body.className = 'home-news-body';
            body.append(
                createTextElement('h3', item.title),
                createTextElement('p', item.description)
            );

            const action = createTextElement('span', '詳細', 'home-news-action');
            action.setAttribute('aria-hidden', 'true');

            article.append(time, body, action);
            return article;
        }));
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
        content.setAttribute('aria-labelledby', 'homeNewsModalTitle');

        content.innerHTML = `
            <button type="button" class="home-news-modal-close" aria-label="閉じる">×</button>

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
        `;

        modal.append(content);

        modal.querySelector('.home-news-modal-close')?.addEventListener('click', closeNewsModal_);

        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeNewsModal_();
        });

        document.body.append(modal);
        return modal;
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

        if (title) title.textContent = itemTitle;

        if (date) {
            date.textContent = formatDate(itemDate);
            date.dateTime = itemDate;
            date.hidden = !itemDate;
        }

        if (category) {
            category.textContent = itemCategory;
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
        modal.querySelector('.home-news-modal-close')?.focus();
    }

    function closeNewsModal_() {
        const modal = document.getElementById('homeNewsModal');
        if (!modal) return;
        modal.style.display = 'none';
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
                    openEventCalendarModal_(items);
                    renderEvents(currentEventItems_);
                }),
                calendar.table,
                buildEventCalendarSummary_(calendar.events)
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

        const calendar = buildEventCalendarTable_(items, { targetPrefix: 'home-event-list' });
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
            buildEventCalendarControls_(calendar, (amount) => {
                visibleCalendarMonth_ = addMonths_(visibleCalendarMonth_ || calendar.monthBase, amount);
                renderEvents(currentEventItems_);
            }),
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

    function renderEvents(items) {
        const list = document.querySelector('[data-home-event-list]');
        const title = document.querySelector('[data-home-event-list-title]');
        currentEventItems_ = Array.isArray(items) ? items : [];
        const calendar = renderEventCalendar_(items);
        if (!list) return;

        const eventEntries = calendar?.events || [];
        const eventListIdByItem = new Map((calendar?.events || []).map((entry) => [entry.item, entry.id]));
        if (title && calendar?.monthBase) {
            title.textContent = `${calendar.monthBase.getMonth() + 1}月のイベント`;
        }

        if (eventEntries.length === 0) {
            list.replaceChildren(createEmptyItem_('現在表示できるイベントはありません。'));
            return;
        }

        list.replaceChildren(...eventEntries.map((entry) => {
            const item = entry.item;
            const article = document.createElement('article');
            article.className = 'home-list-item home-event-item';
            const itemId = eventListIdByItem.get(item);
            if (itemId) {
                article.id = itemId;
                article.tabIndex = -1;
            }

            const time = createTextElement('time', formatEventRange_(item));
            time.dateTime = item.startAt || item.date || '';

            const label = createTextElement('span', item.label || 'イベント', `home-label home-label--${normalizeEventType_(item.type)}`);
            const meta = document.createElement('div');
            meta.className = 'home-event-meta';
            meta.append(time, label);

            const body = document.createElement('div');
            body.append(
                createTextElement('h3', item.title),
                createTextElement('p', item.description)
            );

            if (item.url) {
                const link = createTextElement('a', '詳細を見る', 'home-event-link');
                link.href = item.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                body.append(link);
            }

            article.append(meta, body);
            return article;
        }));
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

    async function init() {
        bindDisabledLinks();
        bindNewsModalKeys_();

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
