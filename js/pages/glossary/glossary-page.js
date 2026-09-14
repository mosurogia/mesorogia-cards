/* ===== 用語集ページ ===== */
(function () {
    'use strict';

    const GLOSSARY_DATA_URL = './public/glossary.json';
    const SEARCH_SUGGESTION_LIMIT = 12;
    const NEW_ENTRY_DAYS = 7;
    const searchInput = document.querySelector('[data-glossary-search]');
    const searchClear = document.querySelector('[data-glossary-search-clear]');
    const searchSuggestions = document.querySelector('[data-glossary-search-suggestions]');
    const glossaryPage = document.querySelector('.glossary-page');
    const tabs = Array.from(document.querySelectorAll('[data-content-type]'));
    const list = document.querySelector('[data-glossary-list]');
    const termTotal = document.querySelector('[data-glossary-term-total]');
    const guideTotal = document.querySelector('[data-glossary-guide-total]');
    const empty = document.querySelector('[data-glossary-empty]');
    const emptyMessage = document.querySelector('[data-glossary-empty-message]');
    const status = document.querySelector('[data-glossary-status]');
    const statusTitle = document.querySelector('[data-glossary-status-title]');
    const statusMessage = document.querySelector('[data-glossary-status-message]');
    const retryButton = document.querySelector('[data-glossary-retry]');
    const sidebar = document.querySelector('[data-glossary-sidebar]');
    const sectionNav = document.querySelector('[data-glossary-section-nav]');
    const allTermsModal = document.querySelector('[data-glossary-all-terms-modal]');
    const allTermsOpen = document.querySelector('[data-glossary-all-terms-open]');
    const allTermsCloseButtons = Array.from(document.querySelectorAll('[data-glossary-all-terms-close]'));
    const allTermsTotal = document.querySelector('[data-glossary-all-terms-total]');
    const categoryList = document.querySelector('[data-glossary-category-list]');
    const filterModal = document.querySelector('[data-glossary-filter-modal]');
    const filterOpen = document.querySelector('[data-glossary-filter-open]');
    const filterCloseButtons = Array.from(document.querySelectorAll('[data-glossary-filter-close]'));
    const filterNew = document.querySelector('[data-glossary-filter-new]');
    const filterTags = document.querySelector('[data-glossary-filter-tags]');
    const filterReset = document.querySelector('[data-glossary-filter-reset]');
    const filterApply = document.querySelector('[data-glossary-filter-apply]');
    const filterCount = document.querySelector('[data-glossary-filter-count]');
    const activeFilters = document.querySelector('[data-glossary-active-filters]');

    if (!searchInput || !searchClear || !searchSuggestions || !glossaryPage || !tabs.length || !list ||
        !termTotal || !guideTotal || !empty || !emptyMessage || !status ||
        !statusTitle || !statusMessage || !retryButton || !sidebar || !sectionNav ||
        !allTermsModal || !allTermsOpen || !allTermsCloseButtons.length || !allTermsTotal ||
        !categoryList || !filterModal || !filterOpen || !filterCloseButtons.length ||
        !filterNew || !filterTags || !filterReset || !filterApply ||
        !filterCount || !activeFilters) return;

    let selectedType = 'terms';
    let sections = [];
    let tags = [];
    let terms = [];
    let guides = [];
    let newOnly = false;
    let selectedTagIds = new Set();

    function normalize(value) {
        return String(value || '').normalize('NFKC').toLocaleLowerCase('ja').replace(/\s+/g, ' ');
    }

    function createElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function isRecentEntry(updatedAt) {
        const match = String(updatedAt || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return false;
        const updatedDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const elapsedDays = Math.floor((today.getTime() - updatedDate.getTime()) / 86400000);
        return elapsedDays >= 0 && elapsedDays < NEW_ENTRY_DAYS;
    }

    function buildNewBadge(updatedAt) {
        if (!isRecentEntry(updatedAt)) return null;
        const badge = createElement('span', 'glossary-card__new-badge', 'NEW');
        badge.title = '直近7日間に追加・更新';
        return badge;
    }

    function appendParagraphs(root, text, className) {
        String(text || '').split('\n').forEach((line) => {
            if (line.trim()) root.append(createElement('p', className || '', line));
        });
    }

    function setStatus(kind, title, message) {
        status.dataset.status = kind;
        statusTitle.textContent = title;
        statusMessage.textContent = message;
        retryButton.hidden = kind !== 'error';
        status.hidden = kind === 'ready';
    }

    function getMap(items) {
        return new Map(items.map((item) => [item.id, item]));
    }

    function buildBadges(tagIds, tagMap) {
        const root = createElement('span', 'glossary-card__tags');
        tagIds.forEach((tagId) => {
            const tag = tagMap.get(tagId);
            if (tag) root.append(createElement('span', 'glossary-card__tag', tag.label));
        });
        return root;
    }

    function getEntryUrl(type, id) {
        const url = new URL(window.location.href);
        url.search = '';
        url.hash = '';
        url.searchParams.set(type === 'guides' ? 'guide' : 'term', id);
        return url.href;
    }

    function buildShareButton(item, type, className) {
        const button = createElement('button', className || 'glossary-card__share');
        const icon = document.createElement('img');
        icon.src = './img/共有のアイコン.png';
        icon.alt = '';
        icon.setAttribute('aria-hidden', 'true');
        button.type = 'button';
        button.dataset.glossaryShareType = type;
        button.dataset.glossaryShareId = item.id;
        button.dataset.glossaryShareTitle = type === 'guides' ? item.title : item.term;
        button.setAttribute('aria-label', `${button.dataset.glossaryShareTitle}のリンクを共有`);
        button.title = '共有';
        button.append(icon);
        return button;
    }

    function buildXShareButton(item, type) {
        const button = createElement('button', 'glossary-card__share glossary-card__share--x');
        const icon = document.createElement('img');
        icon.src = './img/x-logo.svg';
        icon.alt = '';
        icon.setAttribute('aria-hidden', 'true');
        button.type = 'button';
        button.dataset.glossaryXShareType = type;
        button.dataset.glossaryXShareId = item.id;
        button.dataset.glossaryXShareTitle = type === 'guides' ? item.title : item.term;
        button.setAttribute('aria-label', `${button.dataset.glossaryXShareTitle}をXに投稿`);
        button.title = 'Xに投稿';
        button.append(icon);
        return button;
    }

    function buildShareActions(item, type) {
        const actions = createElement('div', 'glossary-card__share-actions');
        actions.append(buildXShareButton(item, type), buildShareButton(item, type));
        return actions;
    }

    function buildTermCard(term, tagMap) {
        const card = createElement('article', 'glossary-card glossary-term-card');
        card.id = `glossary-term-${term.id}`;
        const heading = createElement('div', 'glossary-card__heading');
        const titleBlock = createElement('div', 'glossary-card__title-block');
        const titleRow = createElement('span', 'glossary-card__title-row');
        titleRow.append(createElement('h3', 'glossary-card__title', term.term));
        const newBadge = buildNewBadge(term.updatedAt);
        if (newBadge) titleRow.append(newBadge);
        titleBlock.append(titleRow);
        titleBlock.append(createElement('span', 'glossary-term-card__reading', term.reading));
        heading.append(titleBlock, buildBadges(term.tagIds, tagMap), buildShareActions(term, 'terms'));
        card.append(heading);

        const body = createElement('div', 'glossary-card__body');
        appendParagraphs(body, term.description);
        if (term.note) {
            const note = createElement('div', 'glossary-card__note');
            appendParagraphs(note, term.note);
            body.append(note);
        }
        card.append(body);
        return card;
    }

    function buildCategoryIndex() {
        const fragment = document.createDocumentFragment();
        sections.forEach((section) => {
            const sectionTerms = terms.filter((term) => term.sectionId === section.id);
            if (!sectionTerms.length) return;
            const group = createElement('section', 'glossary-category-list__group');
            const heading = createElement('h3', 'glossary-category-list__heading');
            heading.append(createElement('strong', '', section.label));
            const termList = createElement('div', 'glossary-category-list__terms');
            sectionTerms.forEach((term) => {
                const button = createElement('button', '', term.term);
                button.type = 'button';
                button.dataset.allTermId = term.id;
                termList.append(button);
            });
            group.append(heading, termList);
            fragment.append(group);
        });
        categoryList.replaceChildren(fragment);
        allTermsTotal.textContent = `${terms.length}件`;
    }

    function buildGuideBlock(block) {
        if (block.type === 'heading') return createElement('h3', 'glossary-guide__heading', block.heading);
        if (block.type === 'image') {
            const figure = createElement('figure', 'glossary-guide__figure');
            const image = document.createElement('img');
            image.src = block.image;
            image.alt = block.imageAlt || '';
            image.loading = 'lazy';
            figure.append(image);
            if (block.imageAlt) figure.append(createElement('figcaption', '', block.imageAlt));
            return figure;
        }
        const root = createElement('div', block.type === 'note' ? 'glossary-guide__note' : 'glossary-guide__text');
        appendParagraphs(root, block.text);
        return root;
    }

    function buildGuideCard(guide, tagMap, termMap) {
        const card = createElement('details', 'glossary-card glossary-guide-card');
        card.id = `glossary-guide-${guide.id}`;
        const summary = document.createElement('summary');
        summary.className = 'glossary-guide-card__summary';
        const summaryBody = createElement('span', 'glossary-guide-card__summary-body');
        summaryBody.append(buildBadges(guide.tagIds, tagMap));
        const titleRow = createElement('span', 'glossary-card__title-row');
        titleRow.append(createElement('span', 'glossary-guide-card__title', guide.title));
        const newBadge = buildNewBadge(guide.updatedAt);
        if (newBadge) titleRow.append(newBadge);
        summaryBody.append(titleRow);
        summaryBody.append(createElement('span', 'glossary-guide-card__description', guide.summary));
        const action = createElement('span', 'glossary-guide-card__action');
        action.setAttribute('aria-hidden', 'true');
        summary.append(summaryBody, action);
        card.append(summary);

        const content = createElement('div', 'glossary-guide-card__content');
        guide.blocks.forEach((block) => content.append(buildGuideBlock(block)));
        const relatedTerms = guide.relatedTermIds.map((id) => termMap.get(id)).filter(Boolean);
        if (relatedTerms.length) {
            const related = createElement('div', 'glossary-guide__related');
            related.append(createElement('p', 'glossary-guide__related-title', '関連用語'));
            relatedTerms.forEach((term) => {
                const button = createElement('button', '', term.term);
                button.type = 'button';
                button.dataset.relatedTerm = term.term;
                related.append(button);
            });
            content.append(related);
        }
        const actions = createElement('div', 'glossary-guide-card__actions');
        actions.append(buildShareActions(guide, 'guides'));
        content.append(actions);
        card.append(content);
        return card;
    }

    function getSearchText(item, type) {
        if (type === 'terms') {
            return normalize([item.term, item.reading, ...item.aliases, item.description, item.note].join(' '));
        }
        return normalize([
            item.title, item.summary, ...item.searchTerms,
            ...item.blocks.flatMap((block) => [block.heading, block.text, block.imageAlt]),
        ].join(' '));
    }

    function matches(item, type, query) {
        return !query || getSearchText(item, type).includes(query);
    }

    function matchesActiveFilters(item) {
        if (newOnly && !isRecentEntry(item.updatedAt)) return false;
        const itemTagIds = Array.isArray(item.tagIds) ? item.tagIds : [];
        return Array.from(selectedTagIds).every((tagId) => itemTagIds.includes(tagId));
    }

    function getSearchCandidates(query) {
        const candidates = [
            ...terms.map((item) => ({ item, type: 'terms', title: item.term })),
            ...guides.map((item) => ({ item, type: 'guides', title: item.title })),
        ].filter(({ item, type }) => matches(item, type, query) && matchesActiveFilters(item));
        return candidates.sort((a, b) => {
            const aTitle = normalize(a.title);
            const bTitle = normalize(b.title);
            const aRank = aTitle === query ? 0 : aTitle.startsWith(query) ? 1 : aTitle.includes(query) ? 2 : 3;
            const bRank = bTitle === query ? 0 : bTitle.startsWith(query) ? 1 : bTitle.includes(query) ? 2 : 3;
            return aRank - bRank;
        });
    }

    function closeSearchSuggestions() {
        searchSuggestions.hidden = true;
        searchInput.setAttribute('aria-expanded', 'false');
    }

    function updateSearchSuggestions() {
        const query = normalize(searchInput.value.trim());
        searchClear.hidden = !searchInput.value;
        if (!query) {
            closeSearchSuggestions();
            render();
            return;
        }

        const candidates = getSearchCandidates(query);
        const fragment = document.createDocumentFragment();
        candidates.slice(0, SEARCH_SUGGESTION_LIMIT).forEach(({ item, type, title }) => {
            const button = createElement('button', 'glossary-search-suggestions__item');
            button.type = 'button';
            button.role = 'option';
            button.dataset.suggestionType = type;
            button.dataset.suggestionId = item.id;
            button.append(
                createElement('strong', '', title),
                createElement('span', '', type === 'guides' ? '解説' : '用語'),
            );
            fragment.append(button);
        });
        if (!candidates.length) {
            fragment.append(createElement('p', 'glossary-search-suggestions__empty', '該当する候補はありません'));
        } else if (candidates.length > SEARCH_SUGGESTION_LIMIT) {
            fragment.append(createElement(
                'p',
                'glossary-search-suggestions__more',
                `ほか${candidates.length - SEARCH_SUGGESTION_LIMIT}件`,
            ));
        }
        searchSuggestions.replaceChildren(fragment);
        searchSuggestions.hidden = false;
        searchInput.setAttribute('aria-expanded', 'true');
    }

    function buildSection(section, visibleTerms, visibleGuides, tagMap, termMap, searching) {
        const group = createElement('section', 'glossary-section');
        group.id = `glossary-section-${section.id}`;
        const heading = createElement('div', 'glossary-section__head');
        heading.append(createElement('h2', '', section.label));
        heading.append(createElement('span', '', `${visibleTerms.length + visibleGuides.length}件`));
        group.append(heading);

        if (visibleTerms.length) {
            if (searching) group.append(createElement('p', 'glossary-section__type-label', '用語'));
            const grid = createElement('div', 'glossary-section__grid');
            visibleTerms.forEach((term) => grid.append(buildTermCard(term, tagMap)));
            group.append(grid);
        }
        if (visibleGuides.length) {
            if (searching) group.append(createElement('p', 'glossary-section__type-label', '解説'));
            const guideList = createElement('div', 'glossary-section__guides');
            visibleGuides.forEach((guide) => guideList.append(buildGuideCard(guide, tagMap, termMap)));
            group.append(guideList);
        }
        return group;
    }

    function buildSectionNav(visibleSections) {
        const fragment = document.createDocumentFragment();
        visibleSections.forEach(({ section, itemCount, termItems, guideItems }, index) => {
            const sectionGroup = createElement('div', 'glossary-sidebar__section-group');
            const button = document.createElement('button');
            const label = createElement('strong', '', section.label);
            const sectionCount = createElement('span', '', `${itemCount}件`);
            button.type = 'button';
            button.classList.toggle('is-active', index === 0);
            button.append(label, sectionCount);
            button.addEventListener('click', () => {
                sectionNav.querySelectorAll('button').forEach((item) => item.classList.remove('is-active'));
                button.classList.add('is-active');
                document.getElementById(`glossary-section-${section.id}`)?.scrollIntoView({
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                    block: 'start',
                });
            });
            sectionGroup.append(button);
            if (termItems.length) {
                const termList = createElement('div', 'glossary-sidebar__terms');
                termItems.forEach((term) => {
                    const termButton = createElement('button', '', term.term);
                    termButton.type = 'button';
                    termButton.dataset.indexTermId = term.id;
                    termList.append(termButton);
                });
                sectionGroup.append(termList);
            }
            if (guideItems.length) {
                const guideList = createElement('div', 'glossary-sidebar__terms');
                guideItems.forEach((guide) => {
                    const guideButton = createElement('button', '', guide.title);
                    guideButton.type = 'button';
                    guideButton.dataset.indexGuideId = guide.id;
                    guideList.append(guideButton);
                });
                sectionGroup.append(guideList);
            }
            fragment.append(sectionGroup);
        });
        sectionNav.replaceChildren(fragment);
        sidebar.hidden = visibleSections.length === 0;
    }

    function render() {
        const fragment = document.createDocumentFragment();
        const tagMap = getMap(tags);
        const termMap = getMap(terms);
        const filteredTerms = terms.filter(matchesActiveFilters);
        const filteredGuides = guides.filter(matchesActiveFilters);
        const visibleSections = [];
        let visibleCount = 0;

        termTotal.textContent = String(filteredTerms.length);
        guideTotal.textContent = String(filteredGuides.length);

        sections.forEach((section) => {
            const visibleTerms = selectedType === 'terms'
                ? filteredTerms.filter((term) => term.sectionId === section.id) : [];
            const visibleGuides = selectedType === 'guides'
                ? filteredGuides.filter((guide) => guide.sectionId === section.id) : [];
            if (!visibleTerms.length && !visibleGuides.length) return;
            const itemCount = visibleTerms.length + visibleGuides.length;
            visibleCount += itemCount;
            visibleSections.push({ section, itemCount, termItems: visibleTerms, guideItems: visibleGuides });
            fragment.append(buildSection(section, visibleTerms, visibleGuides, tagMap, termMap, false));
        });

        list.replaceChildren(fragment);
        buildSectionNav(visibleSections);
        updateActiveFilters();
        searchClear.hidden = !searchInput.value;
        emptyMessage.textContent = getFilterCount()
            ? '絞り込み条件に一致する内容がありません。'
            : '表示できる内容がありません。';
        empty.hidden = visibleCount !== 0 || (!terms.length && !guides.length);
        list.hidden = visibleCount === 0;
    }

    function resetSearch() {
        searchInput.value = '';
        closeSearchSuggestions();
        render();
    }

    function setSelectedType(type) {
        selectedType = type;
        tabs.forEach((tab) => {
            const active = tab.dataset.contentType === selectedType;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
        });
    }

    function scrollToGlossaryTop() {
        glossaryPage.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            block: 'start',
        });
    }

    function scrollToEntry(type, id, behavior) {
        requestAnimationFrame(() => {
            const target = document.getElementById(`glossary-${type === 'guides' ? 'guide' : 'term'}-${id}`);
            if (!target) return;
            if (target instanceof HTMLDetailsElement) target.open = true;
            target.classList.add('is-glossary-entry-target');
            target.scrollIntoView({
                behavior: behavior || (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'),
                block: 'start',
            });
            window.setTimeout(() => target.classList.remove('is-glossary-entry-target'), 1800);
        });
    }

    function getFilterCount() {
        return Number(newOnly) + selectedTagIds.size;
    }

    function getTagLabel(tagId) {
        return tags.find((tag) => tag.id === tagId)?.label || tagId;
    }

    function updateActiveFilters() {
        const count = getFilterCount();
        filterCount.textContent = String(count);
        filterCount.hidden = count === 0;
        filterOpen.classList.toggle('is-active', count > 0);
        if (!count) {
            activeFilters.replaceChildren();
            activeFilters.hidden = true;
            return;
        }

        const fragment = document.createDocumentFragment();
        fragment.append(createElement('span', 'glossary-active-filters__label', '適用中'));
        const appendChip = (kind, label) => {
            const button = createElement('button', 'glossary-active-filters__chip', label);
            button.type = 'button';
            button.dataset.glossaryFilterRemove = kind;
            button.setAttribute('aria-label', `${label}の絞り込みを解除`);
            button.append(createElement('span', '', '×'));
            fragment.append(button);
        };
        if (newOnly) appendChip('new', '新着のみ');
        selectedTagIds.forEach((tagId) => appendChip(`tag:${tagId}`, getTagLabel(tagId)));
        activeFilters.replaceChildren(fragment);
        activeFilters.hidden = false;
    }

    function createFilterOption(name, value, label, type) {
        const option = createElement('label', 'glossary-filter-option');
        const input = document.createElement('input');
        input.type = type;
        input.name = name;
        input.value = value;
        option.append(input, createElement('span', '', label));
        return option;
    }

    function buildFilterOptions() {
        const tagFragment = document.createDocumentFragment();
        tags.forEach((tag) => {
            tagFragment.append(createFilterOption('glossary-filter-tag', tag.id, tag.label, 'checkbox'));
        });
        filterTags.replaceChildren(tagFragment);
        syncFilterForm();
    }

    function syncFilterForm() {
        filterNew.checked = newOnly;
        filterTags.querySelectorAll('input').forEach((input) => {
            input.checked = selectedTagIds.has(input.value);
        });
    }

    function updateModalOpenState() {
        document.body.classList.toggle(
            'glossary-index-modal-open',
            !allTermsModal.hidden || !filterModal.hidden,
        );
    }

    function clearFilters(shouldRender = true) {
        newOnly = false;
        selectedTagIds = new Set();
        syncFilterForm();
        if (shouldRender) {
            render();
            if (searchInput.value.trim()) updateSearchSuggestions();
        }
    }

    function openFilterModal() {
        syncFilterForm();
        filterModal.hidden = false;
        filterOpen.setAttribute('aria-expanded', 'true');
        updateModalOpenState();
        filterNew.focus();
    }

    function closeFilterModal(restoreFocus = true) {
        if (filterModal.hidden) return;
        filterModal.hidden = true;
        filterOpen.setAttribute('aria-expanded', 'false');
        updateModalOpenState();
        if (restoreFocus) filterOpen.focus();
    }

    function applyFilters() {
        newOnly = filterNew.checked;
        selectedTagIds = new Set(Array.from(filterTags.querySelectorAll('input:checked'), (input) => input.value));
        closeFilterModal(false);
        render();
        if (searchInput.value.trim()) updateSearchSuggestions();
        scrollToGlossaryTop();
    }

    function openEntryFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const termId = params.get('term');
        const guideId = params.get('guide');
        const type = guideId && guides.some((guide) => guide.id === guideId) ? 'guides'
            : termId && terms.some((term) => term.id === termId) ? 'terms' : '';
        const id = type === 'guides' ? guideId : termId;
        if (!type || !id) return;
        setSelectedType(type);
        clearFilters(false);
        resetSearch();
        scrollToEntry(type, id, 'auto');
    }

    function validateData(data) {
        if (!data || !Array.isArray(data.sections) || !Array.isArray(data.tags) ||
            !Array.isArray(data.terms) || !Array.isArray(data.guides)) {
            throw new Error('用語集データの形式が不正です。');
        }
    }

    async function loadGlossary() {
        setStatus('loading', '用語集を読み込んでいます', 'しばらくお待ちください。');
        list.hidden = true;
        empty.hidden = true;
        try {
            const response = await fetch(GLOSSARY_DATA_URL, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            validateData(data);
            sections = data.sections.slice().sort((a, b) => a.sortOrder - b.sortOrder);
            tags = data.tags.slice().sort((a, b) => a.sortOrder - b.sortOrder);
            terms = data.terms.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.reading.localeCompare(b.reading, 'ja'));
            guides = data.guides.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ja'));
            buildFilterOptions();
            buildCategoryIndex();
            resetSearch();
            setStatus('ready', '', '');
            openEntryFromUrl();
        } catch (error) {
            console.error('用語集データの読み込みに失敗しました。', error);
            sections = [];
            tags = [];
            terms = [];
            guides = [];
            list.replaceChildren();
            setStatus('error', '用語集を読み込めませんでした', '通信状態を確認して、もう一度お試しください。');
        }
    }

    function openSearchSuggestion(button) {
        const type = button.dataset.suggestionType;
        const id = button.dataset.suggestionId;
        if (!type || !id) return;
        setSelectedType(type);
        resetSearch();
        scrollToEntry(type, id);
    }

    searchInput.addEventListener('input', updateSearchSuggestions);
    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim()) updateSearchSuggestions();
    });
    searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' && !searchSuggestions.hidden) {
            event.preventDefault();
            searchSuggestions.querySelector('button')?.focus();
        } else if (event.key === 'Escape') {
            closeSearchSuggestions();
        }
    });
    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchInput.focus();
        render();
    });
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            setSelectedType(tab.dataset.contentType || 'terms');
            render();
            scrollToGlossaryTop();
        });
    });
    searchSuggestions.addEventListener('click', (event) => {
        const button = event.target.closest('[data-suggestion-type]');
        if (button) openSearchSuggestion(button);
    });
    searchSuggestions.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Escape') {
            searchInput.focus();
            closeSearchSuggestions();
            return;
        }
        const buttons = Array.from(searchSuggestions.querySelectorAll('button'));
        const currentIndex = buttons.indexOf(document.activeElement);
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
    });
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.glossary-search-area')) closeSearchSuggestions();
    });
    function openIndexedTerm(event) {
        const button = event.target.closest('[data-index-term-id], [data-index-guide-id], [data-index-section-id]');
        if (!button) return;
        if (button.dataset.indexTermId) setSelectedType('terms');
        if (button.dataset.indexGuideId) setSelectedType('guides');
        clearFilters(false);
        resetSearch();
        if (button.dataset.indexTermId || button.dataset.indexGuideId) {
            scrollToEntry(selectedType, button.dataset.indexTermId || button.dataset.indexGuideId);
            return;
        }
        requestAnimationFrame(() => {
            document.getElementById(`glossary-section-${button.dataset.indexSectionId}`)?.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                block: 'start',
            });
        });
    }

    function openAllTermsIndex() {
        allTermsModal.hidden = false;
        allTermsOpen.setAttribute('aria-expanded', 'true');
        updateModalOpenState();
        allTermsCloseButtons.find((button) => button.classList.contains('glossary-index-modal__close'))?.focus();
    }

    function closeAllTermsIndex(restoreFocus = true) {
        if (allTermsModal.hidden) return;
        allTermsModal.hidden = true;
        allTermsOpen.setAttribute('aria-expanded', 'false');
        updateModalOpenState();
        if (restoreFocus) allTermsOpen.focus();
    }

    sectionNav.addEventListener('click', openIndexedTerm);
    allTermsOpen.addEventListener('click', openAllTermsIndex);
    allTermsCloseButtons.forEach((button) => button.addEventListener('click', () => closeAllTermsIndex()));
    const openSelectedTerm = (event) => {
        const button = event.target.closest('[data-all-term-id]');
        if (!button) return;
        closeAllTermsIndex(false);
        setSelectedType('terms');
        clearFilters(false);
        resetSearch();
        scrollToEntry('terms', button.dataset.allTermId);
    };
    categoryList.addEventListener('click', openSelectedTerm);
    filterOpen.addEventListener('click', openFilterModal);
    filterCloseButtons.forEach((button) => button.addEventListener('click', () => closeFilterModal()));
    filterApply.addEventListener('click', applyFilters);
    filterReset.addEventListener('click', () => clearFilters());
    activeFilters.addEventListener('click', (event) => {
        const button = event.target.closest('[data-glossary-filter-remove]');
        if (!button) return;
        const kind = button.dataset.glossaryFilterRemove;
        if (kind === 'new') newOnly = false;
        if (kind?.startsWith('tag:')) selectedTagIds.delete(kind.slice(4));
        syncFilterForm();
        render();
        if (searchInput.value.trim()) updateSearchSuggestions();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!filterModal.hidden) {
            closeFilterModal();
        } else if (!allTermsModal.hidden) {
            closeAllTermsIndex();
        }
    });

    list.addEventListener('click', (event) => {
        const xShareButton = event.target.closest('[data-glossary-x-share-type]');
        if (xShareButton) {
            const type = xShareButton.dataset.glossaryXShareType;
            const id = xShareButton.dataset.glossaryXShareId;
            const title = xShareButton.dataset.glossaryXShareTitle;
            const url = getEntryUrl(type, id);
            const xIntentUrl = new URL('https://twitter.com/intent/tweet');
            xIntentUrl.searchParams.set('text', `${title}とは\n${url}`);
            window.open(xIntentUrl.href, '_blank', 'noopener,noreferrer');
            return;
        }
        const shareButton = event.target.closest('[data-glossary-share-type]');
        if (shareButton) {
            const type = shareButton.dataset.glossaryShareType;
            const id = shareButton.dataset.glossaryShareId;
            const title = shareButton.dataset.glossaryShareTitle;
            const url = getEntryUrl(type, id);
            const shareText = `${title}とは\n${url}`;
            const share = async () => {
                try {
                    if (navigator.share) {
                        await navigator.share({ title: `${title}とは | 用語集`, text: `${title}とは`, url });
                        return;
                    }
                    if (!navigator.clipboard) throw new Error('clipboard unavailable');
                    await navigator.clipboard.writeText(shareText);
                    shareButton.setAttribute('aria-label', '共有リンクをコピーしました');
                    shareButton.title = 'コピーしました';
                    window.setTimeout(() => {
                        shareButton.setAttribute('aria-label', `${title}のリンクを共有`);
                        shareButton.title = '共有';
                    }, 1800);
                } catch (error) {
                    if (error.name !== 'AbortError') {
                        shareButton.setAttribute('aria-label', '共有リンクをコピーできませんでした');
                        shareButton.title = 'コピーできませんでした';
                        window.setTimeout(() => {
                            shareButton.setAttribute('aria-label', `${title}のリンクを共有`);
                            shareButton.title = '共有';
                        }, 1800);
                    }
                }
            };
            share();
            return;
        }
        const button = event.target.closest('[data-related-term]');
        if (!button) return;
        const term = terms.find((item) => item.term === button.dataset.relatedTerm);
        if (!term) return;
        setSelectedType('terms');
        clearFilters(false);
        resetSearch();
        scrollToEntry('terms', term.id);
    });

    retryButton.addEventListener('click', loadGlossary);
    loadGlossary();
}());
