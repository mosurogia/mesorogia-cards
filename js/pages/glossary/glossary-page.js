/* ===== 用語集ページ ===== */
(function () {
    'use strict';

    const GLOSSARY_DATA_URL = './public/glossary.json';
    const searchInput = document.querySelector('[data-glossary-search]');
    const searchClear = document.querySelector('[data-glossary-search-clear]');
    const tagFilter = document.querySelector('[data-glossary-tag-filter]');
    const sectionFilter = document.querySelector('[data-glossary-section-filter]');
    const tabs = Array.from(document.querySelectorAll('[data-content-type]'));
    const list = document.querySelector('[data-glossary-list]');
    const termTotal = document.querySelector('[data-glossary-term-total]');
    const guideTotal = document.querySelector('[data-glossary-guide-total]');
    const resultCount = document.querySelector('[data-glossary-result-count]');
    const empty = document.querySelector('[data-glossary-empty]');
    const emptyMessage = document.querySelector('[data-glossary-empty-message]');
    const status = document.querySelector('[data-glossary-status]');
    const statusTitle = document.querySelector('[data-glossary-status-title]');
    const statusMessage = document.querySelector('[data-glossary-status-message]');
    const retryButton = document.querySelector('[data-glossary-retry]');
    const sidebar = document.querySelector('[data-glossary-sidebar]');
    const sectionNav = document.querySelector('[data-glossary-section-nav]');
    const mobileTermIndex = document.querySelector('[data-glossary-mobile-term-index]');
    const mobileIndexTotal = document.querySelector('[data-glossary-mobile-index-total]');
    const indexTitles = Array.from(document.querySelectorAll('[data-glossary-index-title]'));
    const mobileIndexModal = document.querySelector('[data-glossary-index-modal]');
    const mobileIndexOpen = document.querySelector('[data-glossary-index-open]');
    const mobileIndexCloseButtons = Array.from(document.querySelectorAll('[data-glossary-index-close]'));

    if (!searchInput || !searchClear || !tagFilter || !sectionFilter || !tabs.length || !list ||
        !termTotal || !guideTotal || !resultCount || !empty || !emptyMessage || !status ||
        !statusTitle || !statusMessage || !retryButton || !sidebar || !sectionNav ||
        !mobileTermIndex || !mobileIndexTotal || !indexTitles.length || !mobileIndexModal ||
        !mobileIndexOpen || !mobileIndexCloseButtons.length) return;

    let selectedType = 'terms';
    let selectedSection = 'all';
    let selectedTag = 'all';
    let sections = [];
    let tags = [];
    let terms = [];
    let guides = [];

    function normalize(value) {
        return String(value || '').normalize('NFKC').toLocaleLowerCase('ja').replace(/\s+/g, ' ');
    }

    function createElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
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

    function buildTagOptions() {
        tagFilter.querySelectorAll('option:not([value="all"])').forEach((option) => option.remove());
        tags.forEach((tag) => {
            const option = createElement('option', '', tag.label);
            option.value = tag.id;
            tagFilter.append(option);
        });
    }

    function buildSectionFilterOptions() {
        sectionFilter.querySelectorAll('option:not([value="all"])').forEach((option) => option.remove());
        sections.forEach((section) => {
            const option = createElement('option', '', section.label);
            option.value = section.id;
            sectionFilter.append(option);
        });
    }

    function buildBadges(tagIds, tagMap) {
        const root = createElement('span', 'glossary-card__tags');
        tagIds.forEach((tagId) => {
            const tag = tagMap.get(tagId);
            if (tag) root.append(createElement('span', 'glossary-card__tag', tag.label));
        });
        return root;
    }

    function buildTermCard(term, tagMap) {
        const card = createElement('article', 'glossary-card glossary-term-card');
        card.id = `glossary-term-${term.id}`;
        const heading = createElement('div', 'glossary-card__heading');
        const titleBlock = createElement('div', 'glossary-card__title-block');
        titleBlock.append(createElement('h3', 'glossary-card__title', term.term));
        titleBlock.append(createElement('span', 'glossary-term-card__reading', term.reading));
        heading.append(titleBlock, buildBadges(term.tagIds, tagMap));
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

    function buildMobileIndex(visibleSections) {
        const fragment = document.createDocumentFragment();
        const showingTerms = selectedType === 'terms';
        const indexItems = visibleSections.flatMap((entry) => showingTerms ? entry.termItems : entry.guideItems);
        indexTitles.forEach((title) => {
            title.textContent = showingTerms ? '用語集目次' : '解説集目次';
        });
        visibleSections.forEach(({ section, termItems, guideItems }, index) => {
            const sectionItems = (showingTerms ? termItems : guideItems)
                .slice()
                .sort((a, b) => showingTerms
                    ? a.reading.localeCompare(b.reading, 'ja')
                    : a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ja'));
            if (!sectionItems.length) return;

            const sectionGroup = createElement('details', 'glossary-index__section');
            sectionGroup.open = visibleSections.length === 1 || index === 0;
            const sectionSummary = document.createElement('summary');
            sectionSummary.append(
                createElement('strong', '', section.label),
                createElement('span', '', `${sectionItems.length}件`),
            );

            const termList = createElement('div', 'glossary-index__terms');
            const sectionButton = createElement('button', 'glossary-index__section-jump', 'セクション先頭へ');
            sectionButton.type = 'button';
            sectionButton.dataset.indexSectionId = section.id;
            termList.append(sectionButton);
            sectionItems.forEach((item) => {
                const itemButton = createElement('button', '', showingTerms ? item.term : item.title);
                itemButton.type = 'button';
                if (showingTerms) itemButton.dataset.indexTermId = item.id;
                else itemButton.dataset.indexGuideId = item.id;
                termList.append(itemButton);
            });
            sectionGroup.append(sectionSummary, termList);
            fragment.append(sectionGroup);
        });
        mobileTermIndex.replaceChildren(fragment);
        mobileIndexTotal.textContent = String(indexItems.length);
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
        summaryBody.append(createElement('span', 'glossary-guide-card__title', guide.title));
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
        const matchesTag = selectedTag === 'all' || item.tagIds.includes(selectedTag);
        return matchesTag && (!query || getSearchText(item, type).includes(query));
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
                termItems.slice().sort((a, b) => a.reading.localeCompare(b.reading, 'ja')).forEach((term) => {
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
        const query = normalize(searchInput.value.trim());
        const searching = Boolean(query);
        const fragment = document.createDocumentFragment();
        const tagMap = getMap(tags);
        const termMap = getMap(terms);
        const visibleSections = [];
        let visibleCount = 0;

        sections.forEach((section) => {
            if (selectedSection !== 'all' && section.id !== selectedSection) return;
            const visibleTerms = (searching || selectedType === 'terms')
                ? terms.filter((term) => term.sectionId === section.id && matches(term, 'terms', query)) : [];
            const visibleGuides = (searching || selectedType === 'guides')
                ? guides.filter((guide) => guide.sectionId === section.id && matches(guide, 'guides', query)) : [];
            if (!visibleTerms.length && !visibleGuides.length) return;
            const itemCount = visibleTerms.length + visibleGuides.length;
            visibleCount += itemCount;
            visibleSections.push({ section, itemCount, termItems: visibleTerms, guideItems: visibleGuides });
            fragment.append(buildSection(section, visibleTerms, visibleGuides, tagMap, termMap, searching));
        });

        list.replaceChildren(fragment);
        buildSectionNav(visibleSections);
        buildMobileIndex(visibleSections);
        const filterLabels = [];
        const selectedSectionLabel = sections.find((section) => section.id === selectedSection)?.label;
        if (selectedSectionLabel) filterLabels.push(selectedSectionLabel);
        const selectedTagLabel = tags.find((tag) => tag.id === selectedTag)?.label;
        if (selectedTagLabel) filterLabels.push(selectedTagLabel);
        resultCount.textContent = searching
            ? `検索結果 ${visibleCount}件`
            : filterLabels.length ? `${filterLabels.join('・')}・${visibleCount}件` : `${visibleCount}件を表示`;
        searchClear.hidden = !searchInput.value;
        emptyMessage.textContent = searching
            ? '該当する用語は見つかりませんでした。未掲載の用語は随時追加予定です。'
            : 'セクションやタグを変えてみてください。';
        empty.hidden = visibleCount !== 0 || (!terms.length && !guides.length);
        list.hidden = visibleCount === 0;
    }

    function resetFilters() {
        searchInput.value = '';
        selectedSection = 'all';
        selectedTag = 'all';
        sectionFilter.value = 'all';
        tagFilter.value = 'all';
        render();
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
            termTotal.textContent = String(terms.length);
            guideTotal.textContent = String(guides.length);
            buildSectionFilterOptions();
            buildTagOptions();
            resetFilters();
            setStatus('ready', '', '');
            render();
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

    searchInput.addEventListener('input', render);
    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchInput.focus();
        render();
    });
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            selectedType = tab.dataset.contentType || 'terms';
            tabs.forEach((button) => {
                const active = button === tab;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-selected', String(active));
            });
            render();
        });
    });

    tagFilter.addEventListener('change', () => {
        selectedTag = tagFilter.value || 'all';
        render();
    });

    sectionFilter.addEventListener('change', () => {
        selectedSection = sectionFilter.value || 'all';
        render();
    });

    function openIndexedTerm(event) {
        const button = event.target.closest('[data-index-term-id], [data-index-guide-id], [data-index-section-id]');
        if (!button) return;
        if (button.dataset.indexTermId) selectedType = 'terms';
        if (button.dataset.indexGuideId) selectedType = 'guides';
        tabs.forEach((tab) => {
            const active = tab.dataset.contentType === selectedType;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
        });
        closeMobileIndex(false);
        resetFilters();
        requestAnimationFrame(() => {
            const targetId = button.dataset.indexTermId
                ? `glossary-term-${button.dataset.indexTermId}`
                : button.dataset.indexGuideId
                    ? `glossary-guide-${button.dataset.indexGuideId}`
                    : `glossary-section-${button.dataset.indexSectionId}`;
            document.getElementById(targetId)?.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                block: 'start',
            });
        });
    }

    function openMobileIndex() {
        mobileIndexModal.hidden = false;
        mobileIndexOpen.setAttribute('aria-expanded', 'true');
        document.body.classList.add('glossary-index-modal-open');
        mobileIndexCloseButtons.find((button) => button.classList.contains('glossary-index-modal__close'))?.focus();
    }

    function closeMobileIndex(restoreFocus = true) {
        if (mobileIndexModal.hidden) return;
        mobileIndexModal.hidden = true;
        mobileIndexOpen.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('glossary-index-modal-open');
        if (restoreFocus) mobileIndexOpen.focus();
    }

    sectionNav.addEventListener('click', openIndexedTerm);
    mobileTermIndex.addEventListener('click', openIndexedTerm);
    mobileIndexOpen.addEventListener('click', openMobileIndex);
    mobileIndexCloseButtons.forEach((button) => button.addEventListener('click', () => closeMobileIndex()));
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !mobileIndexModal.hidden) closeMobileIndex();
    });

    list.addEventListener('click', (event) => {
        const button = event.target.closest('[data-related-term]');
        if (!button) return;
        searchInput.value = button.dataset.relatedTerm || '';
        searchInput.focus();
        render();
        window.scrollTo({ top: Math.max(0, searchInput.getBoundingClientRect().top + window.scrollY - 80), behavior: 'smooth' });
    });

    retryButton.addEventListener('click', loadGlossary);
    loadGlossary();
}());
