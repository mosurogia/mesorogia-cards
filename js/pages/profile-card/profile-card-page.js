(() => {
  'use strict';

  const els = {
    form: document.getElementById('profile-card-form'),
    playerName: document.getElementById('profile-player-name'),
    startedAt: document.getElementById('profile-started-at'),
    favoriteRace: document.getElementById('profile-favorite-race'),
    mainDeck: document.getElementById('profile-main-deck'),
    avatarFile: document.getElementById('profile-avatar-file'),
    favoriteCard: document.getElementById('profile-favorite-card'),
    comment: document.getElementById('profile-card-comment'),
    characterCount: document.getElementById('profile-card-character-count'),
    tags: document.getElementById('profile-card-tags'),
    canvas: document.getElementById('profile-card-canvas'),
    avatarPreview: document.getElementById('profile-avatar-preview'),
    cardPreview: document.getElementById('profile-favorite-card-preview'),
    exportButton: document.getElementById('profile-card-export'),
    resetButton: document.getElementById('profile-card-reset'),
    status: document.getElementById('profile-card-status'),
    playerNamePreview: document.getElementById('profile-player-name-preview'),
    startedAtPreview: document.getElementById('profile-started-at-preview'),
    favoriteRacePreview: document.getElementById('profile-favorite-race-preview'),
    mainDeckPreview: document.getElementById('profile-main-deck-preview'),
    commentPreview: document.getElementById('profile-card-comment-preview'),
    tagsPreview: document.getElementById('profile-card-tags-preview')
  };

  const DEFAULT_CARD_CD = '00000';
  const DEFAULT_TAGS = ['ランクマ中心', '夜に活動', '対戦歓迎', '交流歓迎'];
  let avatarObjectUrl = '';

  function setStatus(message, isError = false) {
    els.status.textContent = message;
    els.status.classList.toggle('is-error', isError);
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
    const startedAt = els.startedAt.value.trim() || '始めた時期';
    const favoriteRace = els.favoriteRace.value;
    const mainDeck = els.mainDeck.value.trim() || 'メインデッキ';
    const comment = els.comment.value.trim() || '自己紹介を入力してください。';

    els.playerNamePreview.textContent = playerName;
    els.startedAtPreview.textContent = startedAt;
    els.favoriteRacePreview.textContent = favoriteRace;
    els.mainDeckPreview.textContent = mainDeck;
    els.commentPreview.textContent = comment;
    els.canvas.dataset.race = favoriteRace;
    els.characterCount.textContent = `${els.comment.value.length} / 80文字`;
    renderTags();
  }

  function setCardPreview(card) {
    if (typeof window.setCardImageSrc === 'function') {
      window.setCardImageSrc(els.cardPreview, card || DEFAULT_CARD_CD);
    } else {
      const imageSrc = window.getCardImageSrc?.(card || DEFAULT_CARD_CD) || `img/${card?.cd || DEFAULT_CARD_CD}.webp`;
      els.cardPreview.src = imageSrc;
    }
    els.cardPreview.alt = card?.name ? `推しカード：${card.name}` : '推しカード';
  }

  function populateCards(cardMap) {
    const cards = Object.values(cardMap || {})
      .filter((card) => card?.cd && card?.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja'));
    els.favoriteCard.innerHTML = cards.map((card) => `<option value="${escapeHtml(card.cd)}">${escapeHtml(card.name)}（${escapeHtml(card.cd)}）</option>`).join('');
    els.favoriteCard.disabled = cards.length === 0;
    if (cards.length > 0) {
      const defaultCard = cards.find((card) => card.cd === DEFAULT_CARD_CD) || cards[0];
      els.favoriteCard.value = defaultCard.cd;
      setCardPreview(defaultCard);
    }
  }

  async function loadCards() {
    try {
      const cardMap = await window.ensureCardMapLoaded();
      populateCards(cardMap);
    } catch (error) {
      els.favoriteCard.innerHTML = '<option value="00000">カードを読み込めませんでした</option>';
      els.favoriteCard.disabled = true;
      setStatus('カードデータを読み込めませんでした。', true);
      console.error('[profile-card] カードデータ読み込み失敗', error);
    }
  }

  function handleAvatarFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
    avatarObjectUrl = URL.createObjectURL(file);
    els.avatarPreview.src = avatarObjectUrl;
    els.avatarPreview.alt = '読み込んだアイコン画像';
    setStatus('アイコン画像を反映しました。');
  }

  async function exportCardImage() {
    if (typeof html2canvas !== 'function') {
      setStatus('画像生成機能を読み込めませんでした。ページを再読み込みしてください。', true);
      return;
    }
    setStatus('画像を生成しています…');
    els.exportButton.disabled = true;
    try {
      const canvas = await html2canvas(els.canvas, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false
      });
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = 'mesorogia-profile-card.png';
      link.click();
      setStatus('PNG画像を保存しました。');
    } catch (error) {
      console.error('[profile-card] 画像生成失敗', error);
      setStatus('画像生成に失敗しました。入力内容を確認して再度お試しください。', true);
    } finally {
      els.exportButton.disabled = false;
    }
  }

  function resetForm() {
    els.form.reset();
    els.playerName.value = 'ミソラ';
    els.startedAt.value = '2025年夏ごろから';
    els.favoriteRace.value = 'ドラゴン';
    els.mainDeck.value = 'ドラゴン速攻';
    els.comment.value = '色々なデッキを試しながら、ランクマッチを楽しんでいます！ 気軽に対戦や交流をお願いします。';
    els.tags.querySelectorAll('input').forEach((input) => { input.checked = DEFAULT_TAGS.includes(input.value); });
    els.avatarFile.value = '';
    els.avatarPreview.src = 'img/appicon_1024.webp';
    if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
    avatarObjectUrl = '';
    updatePreview();
    setStatus('入力を初期状態に戻しました。');
  }

  els.form.addEventListener('input', updatePreview);
  els.form.addEventListener('change', (event) => {
    if (event.target === els.avatarFile) handleAvatarFile(event);
    if (event.target === els.favoriteCard) {
      const card = window.cardMap?.[event.target.value];
      setCardPreview(card);
    }
    if (event.target.matches('#profile-card-tags input') && getSelectedTags().length > 4) {
      event.target.checked = false;
      setStatus('タグは4個まで選択できます。', true);
    }
    updatePreview();
  });
  els.exportButton.addEventListener('click', exportCardImage);
  els.resetButton.addEventListener('click', resetForm);
  els.tags.querySelectorAll('input').forEach((input) => { input.checked = DEFAULT_TAGS.includes(input.value); });
  updatePreview();
  loadCards();
})();
