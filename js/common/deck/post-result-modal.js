/**
 * 投稿/更新完了モーダル
 * - デッキメーカーとデッキ投稿ページで共通利用する
 * - 旧API名（openPostSuccessModal / openPostUpdateSuccessModal）も互換として公開する
 */
(function () {
  'use strict';

  const SHARE_BASE_URL = 'https://mosurogia.github.io/mesorogia-cards/deck-post.html';

  function getDeckName_(opts = {}) {
    return String(
      opts.deckName ||
      opts.title ||
      window.readDeckNameInput?.() ||
      ''
    ).trim();
  }

  function buildShareUrl_(postId) {
    const pid = String(postId || '').trim();
    return pid ? `${SHARE_BASE_URL}?pid=${encodeURIComponent(pid)}` : SHARE_BASE_URL;
  }

  function buildTweetText_(mode, deckName = '') {
    const action = mode === 'update' ? '更新しました' : '投稿しました';
    const name = String(deckName || '').trim();
    const deckText = name
      ? `「${name}」デッキを${action}！`
      : `デッキを${action}！`;
    return `【神託のメソロギア】\n${deckText}\n\n#神託のメソロギア\n#メソロギアデッキ`;
  }

  function openTweet_(opts = {}) {
    const mode = opts.mode === 'update' ? 'update' : 'post';
    const text = buildTweetText_(mode, opts.deckName);
    const url = buildShareUrl_(opts.postId);
    const intent =
      'https://twitter.com/intent/tweet?text=' +
      encodeURIComponent(text) +
      '&url=' +
      encodeURIComponent(url);

    window.open(intent, '_blank', 'noopener');
  }

  function ensureModal_() {
    let modal = document.getElementById('deck-post-result-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'deck-post-result-modal';
    modal.className = 'modal deck-post-result-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal-content deck-post-result-dialog" role="dialog" aria-modal="true" aria-labelledby="deck-post-result-title">
        <button type="button" class="modal-close-x" data-deck-post-result-close aria-label="閉じる">×</button>

        <div class="deck-post-result-header" id="deck-post-result-title">デッキ投稿が完了しました</div>

        <div class="deck-post-result-body">
          <div class="deck-post-result-content">
            <div class="deck-post-result-text">
              <div class="deck-post-result-row">
                <span class="deck-post-result-label">デッキ名</span>
                <span id="deck-post-result-deck-name" class="deck-post-result-deck-name">（デッキ名）</span>
              </div>
              <p class="deck-post-result-desc" id="deck-post-result-desc"></p>

              <div id="deck-post-result-campaign" class="deck-post-result-campaign-panel" style="display:none;">
                <div class="deck-post-result-campaign-row">
                  <div class="deck-post-result-campaign-body">
                    <div class="deck-post-result-campaign-title">キャンペーン開催中</div>
                    <div id="deck-post-result-campaign-text" class="deck-post-result-campaign-range">（キャンペーン情報）</div>
                  </div>
                </div>
                <div class="deck-post-result-campaign-desc">キャンペーンに参加してみよう！</div>
              </div>
            </div>
            <div id="deck-post-result-preview" class="deck-post-result-preview"></div>
          </div>
        </div>

        <div class="deck-post-result-buttons">
          <button type="button" id="deck-post-result-gen-image" class="btn ghost">🖼 デッキリスト画像を生成</button>
          <button type="button" id="deck-post-result-open-posts" class="btn primary">📂 投稿一覧を開く</button>
          <button type="button" id="deck-post-result-tweet" class="btn x-share">
            <img src="img/x-logo.svg" alt="" class="tweet-icon">Xで共有
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    bindModal_(modal);
    return modal;
  }

  function closeModal_() {
    const modal = document.getElementById('deck-post-result-modal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  function bindModal_(modal) {
    if (!modal || modal.dataset.boundDeckPostResult === '1') return;
    modal.dataset.boundDeckPostResult = '1';

    modal.querySelectorAll('[data-deck-post-result-close]').forEach((btn) => {
      btn.addEventListener('click', closeModal_);
    });

    modal.querySelector('#deck-post-result-open-posts')?.addEventListener('click', () => {
      closeModal_();
      location.href = 'deck-post.html';
    });

    modal.querySelector('#deck-post-result-tweet')?.addEventListener('click', () => {
      openTweet_({
        mode: modal.dataset.mode || 'post',
        postId: modal.dataset.postId || '',
        deckName: modal.dataset.deckName || '',
      });
    });

    modal.querySelector('#deck-post-result-gen-image')?.addEventListener('click', () => {
      try {
        const payload = modal.__deckPostResultPreviewPayload || null;
        if (typeof window.exportDeckImage === 'function') window.exportDeckImage(payload || undefined);
        else if (typeof window.DeckImg?.export === 'function') window.DeckImg.export();
        else if (typeof window.DeckImg?.exportDeckImage === 'function') window.DeckImg.exportDeckImage();
        else alert('画像生成機能が見つかりませんでした。');
      } catch (e) {
        console.error('deck-post-result image gen error:', e);
        alert('画像生成中にエラーが発生しました。');
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal_();
    });
  }

  function normalizeCd_(cd) {
    if (typeof window.normCd5 === 'function') return window.normCd5(cd);
    const s = String(cd || '').trim();
    return s ? s.padStart(5, '0').slice(0, 5) : '';
  }

  function pickRepresentativeCd_(item, deckMap) {
    let repCd = normalizeCd_(
      item?.repCd ||
      item?.repCardCd ||
      item?.rep ||
      item?.repCard ||
      item?.representativeCd ||
      ''
    );

    if (!repCd) {
      const src = String(item?.repImg || '').trim();
      const m = src.match(/(?:^|\/)(\d{5})(?:\.(?:webp|png|jpe?g))(?:\?.*)?$/i);
      if (m) repCd = m[1];
    }

    if (!repCd || !deckMap?.[repCd]) {
      repCd = Object.keys(deckMap || {})
        .map(normalizeCd_)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))[0] || '';
    }

    return repCd;
  }

  function buildPreviewPayloadFromItem_(item) {
    if (!item || typeof window.DeckPostDetail?.extractDeckMap !== 'function') return null;

    const deckMap = window.DeckPostDetail.extractDeckMap(item);
    if (!deckMap || !Object.keys(deckMap).length) return null;

    const mainRace = typeof window.DeckPostDetail?.getMainRace === 'function'
      ? window.DeckPostDetail.getMainRace(item?.races)
      : '';

    return {
      deck: deckMap,
      deckName: item?.title || '',
      posterName: item?.posterName || item?.poster || '',
      posterX: item?.posterX || item?.x || '',
      mainRace,
      representativeCd: pickRepresentativeCd_(item, deckMap),
      showCredit: true,
      skipSizeCheck: true,
      brandUrl: buildShareUrl_(item?.postId || ''),
    };
  }

  function findPostItem_(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return null;

    if (typeof window.DeckPostDetail?.findItemById_ === 'function') {
      const hit = window.DeckPostDetail.findItemById_(pid);
      if (hit) return hit;
    }

    const state = window.DeckPostState?.getState?.() || window.__DeckPostState || {};
    const pools = [
      state?.mine?.items,
      state?.list?.items,
      state?.list?.allItems,
      state?.list?.filteredItems,
    ].filter(Array.isArray);

    for (const arr of pools) {
      const hit = arr.find((it) => String(it?.postId || '').trim() === pid);
      if (hit) return hit;
    }

    return null;
  }

  async function renderPreview_(modal, opts = {}) {
    const container = modal.querySelector('#deck-post-result-preview');
    if (!container) return false;

    container.innerHTML = '';

    if (
      typeof window.buildShareNodeForPreview !== 'function' ||
      typeof window.buildDeckSummaryDataForPreview !== 'function' ||
      typeof window.getCanvasSpecForPreview !== 'function'
    ) {
      return false;
    }

    const item = opts.item || findPostItem_(opts.postId);
    const payload = opts.previewPayload || buildPreviewPayloadFromItem_(item) || {};

    const data = window.buildDeckSummaryDataForPreview(payload);
    if (!data?.total) return false;

    const aspect = '3:4';
    const kinds = data.uniqueList ? data.uniqueList.length : 0;
    const spec = window.getCanvasSpecForPreview(aspect, kinds);
    spec.cols = 5;
    if (payload.brandUrl) spec.brandUrl = payload.brandUrl;
    if (typeof payload.showCredit === 'boolean') spec.showCredit = payload.showCredit;

    const node = await window.buildShareNodeForPreview(data, spec);
    node.style.position = 'relative';
    node.style.left = '0';
    node.style.top = '0';

    const containerWidth = container.clientWidth || spec.width;
    let scale = containerWidth / spec.width;
    if (scale > 1) scale = 1;

    container.style.width = `${spec.width * scale}px`;
    container.style.height = `${spec.height * scale}px`;
    container.style.overflow = 'hidden';

    node.style.width = `${spec.width}px`;
    node.style.height = `${spec.height}px`;
    node.style.transformOrigin = 'top left';
    node.style.transform = `scale(${scale})`;

    container.appendChild(node);
    return true;
  }

  function reflectCampaign_(modal, camp) {
    const campBox = modal.querySelector('#deck-post-result-campaign');
    const campText = modal.querySelector('#deck-post-result-campaign-text');
    if (!campBox || !campText) return;

    if (camp && (camp.isActive === true || String(camp.isActive) === 'true') && String(camp.campaignId || '')) {
      const title = String(camp.title || 'キャンペーン');
      const start = camp.startAt ? new Date(camp.startAt) : null;
      const end = camp.endAt ? new Date(camp.endAt) : null;
      const fmt = (d) => (d && !isNaN(d)) ? window.formatYmd?.(d) || '' : '';
      const range = (start || end) ? `（${fmt(start)}〜${fmt(end)}）` : '';
      campText.textContent = [title, range].filter(Boolean).join('\n');
      campBox.style.display = '';
      return;
    }

    campBox.style.display = 'none';
  }

  function openResultModal_(opts = {}) {
    const mode = opts.mode === 'update' ? 'update' : 'post';
    const modal = ensureModal_();
    const deckName = getDeckName_(opts);
    const titleEl = modal.querySelector('#deck-post-result-title');
    const nameEl = modal.querySelector('#deck-post-result-deck-name');
    const descEl = modal.querySelector('#deck-post-result-desc');
    const previewEl = modal.querySelector('#deck-post-result-preview');
    const genImageBtn = modal.querySelector('#deck-post-result-gen-image');
    const previewItem = opts.item || findPostItem_(opts.postId);
    const previewPayload = opts.previewPayload || buildPreviewPayloadFromItem_(previewItem) || null;

    modal.dataset.mode = mode;
    modal.dataset.postId = String(opts.postId || '');
    modal.dataset.deckName = deckName;
    modal.__deckPostResultPreviewPayload = previewPayload;

    if (titleEl) titleEl.textContent = mode === 'update' ? 'デッキ投稿を更新しました' : 'デッキ投稿が完了しました';
    if (nameEl) nameEl.textContent = deckName || '（デッキ名）';
    if (descEl) {
      descEl.innerHTML = mode === 'update'
        ? '投稿内容を更新しました。<br>Xで更新したことをシェアできます。'
        : 'デッキ投稿一覧ページにあなたのデッキが追加されました。<br>Xで投稿したことをシェアできます。';
    }

    const showPreview = opts.preview !== false;
    if (previewEl) {
      previewEl.innerHTML = '';
      previewEl.style.display = showPreview ? '' : 'none';
    }
    if (genImageBtn) genImageBtn.style.display = showPreview ? '' : 'none';

    reflectCampaign_(modal, opts.campaign || opts.item?.campaign || window.__activeCampaign || null);

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    if (showPreview) {
      renderPreview_(modal, { ...opts, item: previewItem, previewPayload })
        .then((ok) => {
          if (!ok && typeof window.updatePostSuccessPreview === 'function') {
            return window.updatePostSuccessPreview();
          }
          return null;
        })
        .catch(err => console.error('post-result preview error:', err));
    }
  }

  function openPostSuccessModal(opts = {}) {
    openResultModal_({ ...opts, mode: 'post' });
  }

  function openPostUpdateSuccessModal(opts = {}) {
    openResultModal_({ ...opts, mode: 'update' });
  }

  window.DeckPostResultModal = {
    ensure: ensureModal_,
    close: closeModal_,
    open: openResultModal_,
    openPostSuccess: openPostSuccessModal,
    openPostUpdateSuccess: openPostUpdateSuccessModal,
    buildShareUrl: buildShareUrl_,
    openTweet: openTweet_,
  };

  window.openPostSuccessModal = openPostSuccessModal;
  window.openPostUpdateSuccessModal = openPostUpdateSuccessModal;
})();
