/**
 * js/pages/deck-post/deck-post-campaign.js
 * - デッキ投稿ページのキャンペーン表示専用
 * - キャンペーンバナー描画
 * - キャンペーンタグ一覧の取得と反映
 */
(function () {
  'use strict';

  // =========================
  // 0) バナー描画
  // =========================
  /**
   * キャンペーンバナー描画
   */
  async function renderCampaignBanner() {
    const box = document.getElementById('campaign-banner');
    const titleEl = document.getElementById('campaign-banner-title');
    const textEl = document.getElementById('campaign-banner-text');
    const rangeEl = document.getElementById('campaign-banner-range');

    if (!box || !titleEl || !textEl) return;

    let camp = null;
    try {
      camp = await (window.fetchActiveCampaign?.() || Promise.resolve(null));
    } catch (_) {
      camp = null;
    }

    const isActive =
      camp &&
      (camp.isActive === true || String(camp.isActive) === 'true') &&
      String(camp.campaignId || '');

    if (!isActive) {
      box.style.display = 'none';
      window.__isCampaignRunning = false;
      window.__activeCampaignTag = '';
      return;
    }

    const rawTitle = String(camp.title || 'キャンペーン');
    const start = camp.startAt ? new Date(camp.startAt) : null;
    const end = camp.endAt ? new Date(camp.endAt) : null;

    const fmt = (d) => (d && !isNaN(d)) ? window.fmtDate?.(d) || '' : '';
    const computedRange = (start || end) ? `${fmt(start)}〜${fmt(end)}` : '';

    const titleHasRange =
      /[（(]\s*\d{4}\/\d{1,2}\/\d{1,2}\s*〜\s*\d{4}\/\d{1,2}\/\d{1,2}\s*[)）]/.test(rawTitle);

    const cleanTitle = rawTitle
      .replace(/[（(]\s*\d{4}\/\d{1,2}\/\d{1,2}\s*〜\s*\d{4}\/\d{1,2}\/\d{1,2}\s*[)）]\s*/g, '')
      .trim();

    titleEl.textContent = cleanTitle || 'キャンペーン';

    window.__isCampaignRunning = true;
    window.__activeCampaignTag = cleanTitle || '';

    if (rangeEl) {
      rangeEl.textContent = (!titleHasRange && computedRange) ? computedRange : '';
    }

    textEl.textContent =
      'デッキを投稿して、キャンペーンに参加しよう！ 詳しい参加条件や報酬は、詳細をチェック！';

    box.style.display = '';
  }

  // =========================
  // 1) キャンペーン情報読込
  // =========================
  /**
   * キャンペーンタグ一覧とバナーを読み込む
   */
    async function loadCampaignInfo_() {
        try {
        const res = await window.DeckPostApi?.apiCampaignTags?.();
        const tags = (res && res.ok && Array.isArray(res.tags)) ? res.tags : [];
        window.__campaignTagSet = new Set(
            (tags || []).map((t) => String(t).trim()).filter(Boolean)
        );
        } catch (e) {
        console.warn('campaignTags load failed', e);
        window.__campaignTagSet = new Set();
        }

        try {
        await renderCampaignBanner();
        } catch (e) {
        console.warn('campaign banner error', e);
        }

        window.DeckPostFilter?.refreshCampaignTagChips?.();
    }

    /**
   * キャンペーンUI初期化
   * - キャンペーン情報の遅延読込
   */
    function init() {
    scheduleCampaignLoad_();
    }

  // =========================
  // 2) 遅延実行
  // =========================
    /**
     * キャンペーン情報を遅延読込
     */
    function scheduleCampaignLoad_() {
        if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(loadCampaignInfo_, { timeout: 3000 });
        } else {
        setTimeout(loadCampaignInfo_, 300);
        }
    }

  // =========================
  // 3) 公開API
  // =========================
    window.DeckPostCampaign = window.DeckPostCampaign || {};
    window.DeckPostCampaign.renderCampaignBanner = renderCampaignBanner;
    window.DeckPostCampaign.loadCampaignInfo_ = loadCampaignInfo_;
    window.DeckPostCampaign.scheduleCampaignLoad_ = scheduleCampaignLoad_;
    window.DeckPostCampaign.init = init;
})();