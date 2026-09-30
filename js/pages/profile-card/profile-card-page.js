(() => {
  'use strict';

  const els = {
    form: document.getElementById('profile-card-form'),
    playerName: document.getElementById('profile-player-name'),
    startedAtOptions: document.getElementById('profile-started-at-options'),
    favoriteRaceOptions: Array.from(document.querySelectorAll('input[name="profileFavoriteRace"]')),
    favoriteCategory: document.getElementById('profile-favorite-category'),
    favoriteCategoryLabel: document.getElementById('profile-favorite-category-label'),
    categoryOpen: document.getElementById('profile-category-open'),
    categoryModal: document.getElementById('profile-category-modal'),
    categoryModalCurrent: document.getElementById('profile-category-modal-current'),
    categoryOptions: document.getElementById('profile-category-options'),
    categoryClear: document.getElementById('profile-category-clear'),
    mainDeck: document.getElementById('profile-main-deck'),
    avatarFile: document.getElementById('profile-avatar-file'),
    avatarCrop: document.getElementById('profile-avatar-crop'),
    avatarCropPreview: document.getElementById('profile-avatar-crop-preview'),
    avatarZoom: document.getElementById('profile-avatar-zoom'),
    avatarPreset: document.getElementById('profile-avatar-preset'),
    avatarReset: document.getElementById('profile-avatar-reset'),
    favoriteCard: document.getElementById('profile-favorite-card'),
    favoriteCardOpen: document.getElementById('profile-favorite-card-open'),
    favoriteCardMediaOpen: document.getElementById('profile-favorite-card-media-open'),
    favoriteCardLabel: document.getElementById('profile-favorite-card-label'),
    favoriteCardMediaPreview: document.getElementById('profile-favorite-card-media-preview'),
    comment: document.getElementById('profile-card-comment'),
    characterCount: document.getElementById('profile-card-character-count'),
    tags: document.getElementById('profile-card-tags'),
    previewStage: document.getElementById('profile-card-preview-stage'),
    canvas: document.getElementById('profile-card-canvas'),
    avatarPreview: document.getElementById('profile-avatar-preview'),
    cardPreview: document.getElementById('profile-favorite-card-preview'),
    exportButton: document.getElementById('profile-card-export'),
    resetButton: document.getElementById('profile-card-reset'),
    status: document.getElementById('profile-card-status'),
    playerNamePreview: document.getElementById('profile-player-name-preview'),
    startedAtPreview: document.getElementById('profile-started-at-preview'),
    favoriteRacePreview: document.getElementById('profile-favorite-race-preview'),
    favoriteCategoryPreview: document.getElementById('profile-favorite-category-preview'),
    mainDeckPreview: document.getElementById('profile-main-deck-preview'),
    commentPreview: document.getElementById('profile-card-comment-preview'),
    tagsPreview: document.getElementById('profile-card-tags-preview')
  };

  const DEFAULT_CARD_CD = '00000';
  const DEFAULT_PLAYER_NAME = '';
  const DEFAULT_AVATAR_SRC = 'img/appicon_1024.webp';
  const DEFAULT_STARTED_AT = '2025年夏ごろ';
  const SEASON_NAMES = ['春', '夏', '秋', '冬'];
  const DEFAULT_TAGS = ['ランクガチ勢', 'デッキ相談歓迎', '交流歓迎'];
  const PROFILE_CARD_WIDTH = 500;
  const PROFILE_CARD_HEIGHT = 625;
  let avatarObjectUrl = '';
  let playerNameAutoFillAllowed = true;
  const AVATAR_ZOOM_MIN = 0.5;
  const AVATAR_ZOOM_MAX = 2;
  const DEFAULT_AVATAR_ZOOM = 1;
  const avatarPosition = { x: 0, y: 0, zoom: DEFAULT_AVATAR_ZOOM };
  let avatarDrag = null;
  const avatarPointers = new Map();
  let avatarPinchStart = null;

  function updatePreviewScale() {
    const stageWidth = els.previewStage.getBoundingClientRect().width;
    const scale = Math.min(1, stageWidth / PROFILE_CARD_WIDTH);
    els.canvas.style.setProperty('--profile-card-preview-scale', String(scale));
  }

  function getFavoriteRace() {
    return els.favoriteRaceOptions.find((input) => input.checked)?.value || 'ドラゴン';
  }

  function getStartedAtOptions() {
    return Array.from(els.startedAtOptions.querySelectorAll('input[name="profileStartedAt"]'));
  }

  function getStartedAt() {
    return getStartedAtOptions().find((input) => input.checked)?.value || '始めた時期';
  }

  function getCategoryRace(category) {
    const groups = Array.isArray(window.CATEGORY_GROUPS) ? window.CATEGORY_GROUPS : [];
    return groups.find((group) => group.list?.includes(category))?.race || 'none';
  }

  function formatCategoryLabel(category) {
    const readingIndex = category.indexOf('（');
    if (readingIndex < 0) return escapeHtml(category);
    return `${escapeHtml(category.slice(0, readingIndex))}<wbr>（${escapeHtml(category.slice(readingIndex + 1))}`;
  }

  function fitCategoryOptionLabels() {
    const options = Array.from(els.categoryOptions.querySelectorAll('.profile-card-category-option'));
    options.forEach((option) => {
      option.classList.remove('is-compact', 'is-wrap');
      if (option.scrollWidth > option.clientWidth + 1) option.classList.add('is-compact');
    });
    window.requestAnimationFrame(() => {
      options.forEach((option) => {
        if (option.scrollWidth > option.clientWidth + 1) option.classList.add('is-wrap');
      });
    });
  }

  function renderCategoryOptions() {
    const groups = Array.isArray(window.CATEGORY_GROUPS) ? window.CATEGORY_GROUPS : [];
    const selectedCategory = els.favoriteCategory.value;
    const categories = groups.map((group) => ({ race: group.race, list: group.list || [] }));
    const categoryOrder = Array.isArray(window.CATEGORY_ORDER_LIST) ? window.CATEGORY_ORDER_LIST : [];
    const groupedNames = new Set(categories.flatMap((group) => group.list));
    const otherCategories = categoryOrder.filter((category) => !groupedNames.has(category));
    if (otherCategories.length) categories.push({ race: 'none', list: otherCategories });

    els.categoryOptions.innerHTML = categories.map((group) => `
      <section class="profile-card-category-group">
        <h3>${escapeHtml(group.race === 'none' ? 'その他' : group.race)}</h3>
        <div class="profile-card-category-group__items">
          ${group.list.map((category) => `<button type="button" class="profile-card-category-option${category === selectedCategory ? ' is-selected' : ''}" aria-pressed="${category === selectedCategory}" data-category="${escapeHtml(category)}" data-race="${escapeHtml(group.race || getCategoryRace(category))}"><span class="profile-card-category-option__label">${formatCategoryLabel(category)}</span></button>`).join('')}
        </div>
      </section>
    `).join('');
  }

  function closeCategoryModal() {
    els.categoryModal.hidden = true;
    els.categoryOpen.focus();
  }

  function openCategoryModal() {
    els.categoryModal.hidden = false;
    window.requestAnimationFrame(() => {
      fitCategoryOptionLabels();
      els.categoryModal.querySelector(`[data-category="${CSS.escape(els.favoriteCategory.value)}"]`)?.focus();
    });
  }

  function setFavoriteCategory(category) {
    els.favoriteCategory.value = category;
    els.favoriteCategoryLabel.textContent = category || '未選択';
    els.categoryModalCurrent.textContent = category || '未選択';
    renderCategoryOptions();
    fitCategoryOptionLabels();
    updatePreview();
    closeCategoryModal();
  }

  function getSeasonOrder(year, seasonIndex) {
    return year * SEASON_NAMES.length + seasonIndex;
  }

  function getCurrentSeason() {
    const now = new Date();
    const month = now.getMonth();
    let seasonIndex;
    let seasonYear = now.getFullYear();
    if (month < 3) {
      seasonIndex = 3;
      seasonYear -= 1;
    } else if (month < 6) {
      seasonIndex = 0;
    } else if (month < 9) {
      seasonIndex = 1;
    } else {
      seasonIndex = 2;
    }
    return { year: seasonYear, seasonIndex };
  }

  function renderStartedAtOptions() {
    const previousValue = getStartedAt();
    const current = getCurrentSeason();
    const startOrder = getSeasonOrder(2025, 1);
    const endOrder = Math.max(startOrder, getSeasonOrder(current.year, current.seasonIndex));
    const options = ['リリース初期から'];

    for (let order = startOrder; order <= endOrder; order += 1) {
      const year = Math.floor(order / SEASON_NAMES.length);
      const seasonIndex = order % SEASON_NAMES.length;
      options.push(`${year}年${SEASON_NAMES[seasonIndex]}ごろ`);
    }

    els.startedAtOptions.innerHTML = options.map((value) => `
      <label class="profile-card-period-option">
        <input type="radio" name="profileStartedAt" value="${escapeHtml(value)}"${value === previousValue || (!options.includes(previousValue) && value === DEFAULT_STARTED_AT) ? ' checked' : ''}>
        <span>${escapeHtml(value)}</span>
      </label>
    `).join('');
  }

  function scheduleStartedAtOptionsRefresh() {
    const now = new Date();
    const year = now.getFullYear();
    const nextStarts = [2, 5, 8, 11]
      .map((month) => new Date(year, month, 1))
      .find((date) => date > now) || new Date(year + 1, 2, 1);
    const refreshDelay = Math.min(2147483647, Math.max(1000, nextStarts.getTime() - now.getTime() + 1000));
    window.setTimeout(() => {
      renderStartedAtOptions();
      updatePreview();
      scheduleStartedAtOptionsRefresh();
    }, refreshDelay);
  }

  function setStatus(message, isError = false) {
    els.status.textContent = message;
    els.status.classList.toggle('is-error', isError);
  }

  function applyAccountPlayerName() {
    if (!playerNameAutoFillAllowed || els.playerName.value.trim()) return;
    const displayName = String(window.Auth?.user?.displayName || '').trim();
    if (!displayName) return;
    els.playerName.value = displayName.slice(0, els.playerName.maxLength || 24);
    updatePreview();
    setStatus('ログイン中の表示名をプレイヤー名の初期値に反映しました。');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function getSelectedTags() {
    return Array.from(els.tags.querySelectorAll('input:checked')).map((input) => input.value);
  }

  function renderTags() {
    const tags = getSelectedTags();
    els.tagsPreview.innerHTML = tags.map((tag) => `<span class="profile-card-canvas__tag">${escapeHtml(tag)}</span>`).join('');
  }

  function updatePreview() {
    const playerName = els.playerName.value.trim() || 'プレイヤー名';
    const startedAt = getStartedAt();
    const favoriteRace = getFavoriteRace();
    const favoriteCategory = els.favoriteCategory.value;
    const mainDeck = els.mainDeck.value.trim() || 'メインデッキ';
    const comment = els.comment.value.trim() || '自己紹介を入力してください。';

    els.playerNamePreview.textContent = playerName;
    els.startedAtPreview.textContent = startedAt;
    els.favoriteRacePreview.textContent = favoriteRace;
    els.favoriteCategoryPreview.textContent = favoriteCategory;
    els.mainDeckPreview.textContent = mainDeck;
    els.commentPreview.textContent = comment;
    els.canvas.dataset.race = favoriteRace;
    els.characterCount.textContent = `${els.comment.value.length} / 80文字`;
    renderTags();
  }

  function setCardPreview(card) {
    const previewImages = [els.cardPreview, els.favoriteCardMediaPreview].filter(Boolean);
    previewImages.forEach((image) => {
      if (typeof window.setCardImageSrc === 'function') {
        window.setCardImageSrc(image, card || DEFAULT_CARD_CD);
      } else {
        const imageSrc = window.getCardImageSrc?.(card || DEFAULT_CARD_CD) || `img/${card?.cd || DEFAULT_CARD_CD}.webp`;
        image.src = imageSrc;
      }
      image.alt = card?.name ? `推しカード：${card.name}` : '推しカード';
    });
  }

  function openFavoriteCardModal() {
    if (typeof window.openCardPickModal !== 'function') {
      setStatus('カード選択機能を読み込めませんでした。ページを再読み込みしてください。', true);
      return;
    }
    window.openCardPickModal({
      showDeckActions: false,
      onPicked: ({ cd, name }) => setFavoriteCard({ cd, name })
    });
  }

  function applyAvatarTransform() {
    const transform = `translate(${avatarPosition.x}%, ${avatarPosition.y}%) scale(${avatarPosition.zoom})`;
    [els.avatarCropPreview, els.avatarPreview].forEach((image) => {
      image.style.transform = transform;
      image.style.transformOrigin = 'center';
    });
  }

  function clampAvatarZoom(value) {
    return Math.max(AVATAR_ZOOM_MIN, Math.min(AVATAR_ZOOM_MAX, value));
  }

  function getAvatarPointerDistance() {
    const pointers = Array.from(avatarPointers.values());
    if (pointers.length < 2) return 0;
    return Math.hypot(pointers[1].x - pointers[0].x, pointers[1].y - pointers[0].y);
  }

  function updateAvatarPinch() {
    const distance = getAvatarPointerDistance();
    if (!distance) return;
    if (!avatarPinchStart) avatarPinchStart = { distance, zoom: avatarPosition.zoom };
    avatarPosition.zoom = clampAvatarZoom(avatarPinchStart.zoom * (distance / avatarPinchStart.distance));
    els.avatarZoom.value = avatarPosition.zoom.toFixed(2);
    applyAvatarTransform();
  }

  function resetAvatarPosition() {
    avatarPosition.x = 0;
    avatarPosition.y = 0;
    avatarPosition.zoom = DEFAULT_AVATAR_ZOOM;
    els.avatarZoom.value = String(DEFAULT_AVATAR_ZOOM);
    applyAvatarTransform();
  }

  function setFavoriteCard(card) {
    const cd = String(card?.cd || DEFAULT_CARD_CD).padStart(5, '0');
    const name = String(card?.name || '').trim();
    els.favoriteCard.value = cd;
    els.favoriteCardLabel.textContent = name || 'カードを選択';
    setCardPreview(card || { cd });
    updatePreview();
  }

  function populateCards(cardMap) {
    const cards = Object.values(cardMap || {})
      .filter((card) => card?.cd && card?.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja'));
    if (cards.length > 0) {
      const defaultCard = cards.find((card) => card.cd === DEFAULT_CARD_CD) || cards[0];
      setFavoriteCard(defaultCard);
    } else {
      els.favoriteCardLabel.textContent = 'カードを読み込めませんでした';
      els.favoriteCard.disabled = true;
    }
  }

  async function loadCards() {
    try {
      const cardMap = await window.ensureCardMapLoaded();
      populateCards(cardMap);
    } catch (error) {
      els.favoriteCard.disabled = true;
      els.favoriteCardLabel.textContent = 'カードを読み込めませんでした';
      setStatus('カードデータを読み込めませんでした。', true);
      console.error('[profile-card] カードデータ読み込み失敗', error);
    }
  }

  function handleAvatarFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
    avatarObjectUrl = URL.createObjectURL(file);
    els.avatarCropPreview.src = avatarObjectUrl;
    els.avatarPreview.src = avatarObjectUrl;
    els.avatarPreview.alt = '読み込んだアイコン画像';
    resetAvatarPosition();
    setStatus('アイコン画像を反映しました。');
  }

  function useDefaultAvatar() {
    if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
    avatarObjectUrl = '';
    els.avatarFile.value = '';
    els.avatarCropPreview.src = DEFAULT_AVATAR_SRC;
    els.avatarPreview.src = DEFAULT_AVATAR_SRC;
    els.avatarPreview.alt = '基本アイコン';
    resetAvatarPosition();
    setStatus('基本アイコンを反映しました。');
  }

  async function exportCardImage() {
    if (typeof html2canvas !== 'function') {
      setStatus('画像生成機能を読み込めませんでした。ページを再読み込みしてください。', true);
      return;
    }
    setStatus('画像を生成しています…');
    els.exportButton.disabled = true;
    const loader = window.__DeckImgLoading?.show?.('画像を生成しています…');
    try {
      const canvas = await html2canvas(els.canvas, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
        width: PROFILE_CARD_WIDTH,
        height: PROFILE_CARD_HEIGHT,
        onclone: (clonedDocument) => {
          const clonedCanvas = clonedDocument.getElementById('profile-card-canvas');
          if (clonedCanvas) clonedCanvas.style.transform = 'none';
        }
      });
      const fileName = 'mesorogia-profile-card.png';
      if (typeof window.showDeckImgPreviewModal === 'function') {
        window.showDeckImgPreviewModal(canvas, fileName);
        setStatus('画像を確認できます。');
      } else {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = fileName;
        link.click();
        setStatus('PNG画像を保存しました。');
      }
    } catch (error) {
      console.error('[profile-card] 画像生成失敗', error);
      setStatus('画像生成に失敗しました。入力内容を確認して再度お試しください。', true);
    } finally {
      els.exportButton.disabled = false;
      window.__DeckImgLoading?.hide?.(loader);
    }
  }

  function resetForm() {
    els.form.reset();
    playerNameAutoFillAllowed = true;
    els.playerName.value = DEFAULT_PLAYER_NAME;
    getStartedAtOptions().forEach((input) => { input.checked = input.value === DEFAULT_STARTED_AT; });
    els.favoriteRaceOptions.forEach((input) => { input.checked = input.value === 'ドラゴン'; });
    els.favoriteCategory.value = '聖焔龍（フォルティア）';
    els.favoriteCategoryLabel.textContent = els.favoriteCategory.value;
    els.favoriteCard.value = DEFAULT_CARD_CD;
    els.favoriteCardLabel.textContent = 'カードを選択';
    setCardPreview({ cd: DEFAULT_CARD_CD });
    els.mainDeck.value = 'ドラゴン速攻';
    els.comment.value = '色々なデッキを試しながら、ランクマッチを楽しんでいます！ 気軽に対戦や交流をお願いします。';
    els.tags.querySelectorAll('input').forEach((input) => { input.checked = DEFAULT_TAGS.includes(input.value); });
    els.avatarFile.value = '';
    useDefaultAvatar();
    updatePreview();
    applyAccountPlayerName();
    setStatus('入力を初期状態に戻しました。');
  }

  els.form.addEventListener('input', (event) => {
    if (event.target === els.playerName) playerNameAutoFillAllowed = false;
    updatePreview();
  });
  els.form.addEventListener('change', (event) => {
    if (event.target === els.avatarFile) handleAvatarFile(event);
    if (event.target.matches('#profile-card-tags input') && getSelectedTags().length > 4) {
      event.target.checked = false;
      setStatus('タグは4個まで選択できます。', true);
    }
    updatePreview();
  });
  els.avatarZoom.addEventListener('input', () => {
    avatarPosition.zoom = clampAvatarZoom(Number(els.avatarZoom.value) || DEFAULT_AVATAR_ZOOM);
    applyAvatarTransform();
  });
  els.avatarPreset.addEventListener('click', useDefaultAvatar);
  els.avatarReset.addEventListener('click', resetAvatarPosition);
  els.avatarCrop.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    avatarPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    els.avatarCrop.setPointerCapture(event.pointerId);
    if (avatarPointers.size >= 2) {
      avatarDrag = null;
      avatarPinchStart = null;
      updateAvatarPinch();
      return;
    }
    avatarDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: avatarPosition.x, y: avatarPosition.y };
    els.avatarCrop.classList.add('is-dragging');
  });
  els.avatarCrop.addEventListener('pointermove', (event) => {
    event.preventDefault();
    if (avatarPointers.has(event.pointerId)) avatarPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (avatarPointers.size >= 2) {
      updateAvatarPinch();
      return;
    }
    if (!avatarDrag || avatarDrag.pointerId !== event.pointerId) return;
    const rect = els.avatarCrop.getBoundingClientRect();
    avatarPosition.x = Math.max(-35, Math.min(35, avatarDrag.x + ((event.clientX - avatarDrag.startX) / rect.width) * 100));
    avatarPosition.y = Math.max(-35, Math.min(35, avatarDrag.y + ((event.clientY - avatarDrag.startY) / rect.height) * 100));
    applyAvatarTransform();
  });
  const endAvatarDrag = (event) => {
    avatarPointers.delete(event.pointerId);
    if (els.avatarCrop.hasPointerCapture(event.pointerId)) els.avatarCrop.releasePointerCapture(event.pointerId);
    if (avatarPointers.size >= 2) return;
    avatarPinchStart = null;
    if (avatarPointers.size === 1) {
      const [pointerId, pointer] = avatarPointers.entries().next().value;
      avatarDrag = { pointerId, startX: pointer.x, startY: pointer.y, x: avatarPosition.x, y: avatarPosition.y };
      return;
    }
    avatarDrag = null;
    els.avatarCrop.classList.remove('is-dragging');
  };
  els.avatarCrop.addEventListener('pointerup', endAvatarDrag);
  els.avatarCrop.addEventListener('pointercancel', endAvatarDrag);
  els.exportButton.addEventListener('click', exportCardImage);
  els.resetButton.addEventListener('click', resetForm);
  els.favoriteCardOpen.addEventListener('click', openFavoriteCardModal);
  els.favoriteCardMediaOpen.addEventListener('click', openFavoriteCardModal);
  els.categoryOpen.addEventListener('click', openCategoryModal);
  els.categoryOptions.addEventListener('click', (event) => {
    const option = event.target.closest('[data-category]');
    if (option) setFavoriteCategory(option.dataset.category || '');
  });
  els.categoryClear.addEventListener('click', () => setFavoriteCategory(''));
  els.categoryModal.addEventListener('click', (event) => {
    if (event.target.matches('[data-category-modal-close]')) closeCategoryModal();
  });
  const previousReflectLoginUI = window.reflectLoginUI;
  window.reflectLoginUI = function reflectLoginUIWithProfileCard() {
    if (typeof previousReflectLoginUI === 'function') previousReflectLoginUI.apply(this, arguments);
    applyAccountPlayerName();
  };
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.categoryModal.hidden) closeCategoryModal();
  });
  renderCategoryOptions();
  if (typeof ResizeObserver === 'function') {
    const previewResizeObserver = new ResizeObserver(updatePreviewScale);
    previewResizeObserver.observe(els.previewStage);
  } else {
    window.addEventListener('resize', updatePreviewScale);
  }
  updatePreviewScale();
  els.favoriteCategoryLabel.textContent = els.favoriteCategory.value;
  els.categoryModalCurrent.textContent = els.favoriteCategory.value || '未選択';
  renderStartedAtOptions();
  els.tags.querySelectorAll('input').forEach((input) => { input.checked = DEFAULT_TAGS.includes(input.value); });
  updatePreview();
  applyAvatarTransform();
  applyAccountPlayerName();
  scheduleStartedAtOptionsRefresh();
  loadCards();
})();
