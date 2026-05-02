/**
 * js/pages/deck-post/deck-post-detail.js
 * - 投稿詳細ペイン描画
 * - デッキリスト描画
 * - カード詳細ドック / ドロワー表示
 * - 簡易統計 / グラフ表示
 */
(function () {
  'use strict';

  // =========================
  // 0) 小物
  // =========================

  /**
   * detail 用エスケープ
   * - 共通があればそれを優先
   */
  function escHtml_(s) {
    return window.escapeHtml_(s);
  }

  function normCd5_(cd) {
    if (typeof window.normCd5 === 'function') return window.normCd5(cd);
    const s = String(cd ?? '').trim();
    return s ? s.padStart(5, '0').slice(0, 5) : '';
  }

  function cardImageSrc_(cardOrCd) {
    if (typeof window.getCardImageSrc === 'function') return window.getCardImageSrc(cardOrCd);
    const cd = normCd5_(typeof cardOrCd === 'object' ? (cardOrCd?.cd || cardOrCd?.id) : cardOrCd);
    return cd ? `img/${cd}.webp` : 'img/00000.webp';
  }

  function cardImageErrorAttr_(cardOrCd) {
    const cd = normCd5_(typeof cardOrCd === 'object' ? (cardOrCd?.cd || cardOrCd?.id) : cardOrCd);
    const normal = cd ? `img/${cd}.webp` : 'img/00000.webp';
    return `if(!this.dataset.normalFallback){this.dataset.normalFallback=1;this.src='${normal}';}else{this.onerror=null;this.src='img/00000.webp';}`;
  }

  /**
   * 改行 → <br>
   */
  function nl2br_(s) {
    return String(s || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n/g, '<br>');
  }

  function resolveCardByName_(name) {
    const target = String(name || '').trim();
    if (!target) return null;

    const map = window.cardMap || window.allCardsMap || {};
    for (const [cd, card] of Object.entries(map)) {
      if (String(card?.name || '').trim() === target) {
        return {
          cd: normCd5_(card.cd || cd),
          name: String(card.name || target)
        };
      }
    }

    return null;
  }

  function renderDeckNoteText_(text) {
    const raw = String(text || '');
    const re = /\[\[([^\]\n]+)\]\]/g;
    const parts = [];
    let lastIndex = 0;
    let m;

    while ((m = re.exec(raw)) !== null) {
      parts.push(escHtml_(raw.slice(lastIndex, m.index)));

      const token = m[0];
      const name = String(m[1] || '').trim();
      const card = resolveCardByName_(name);
      if (card?.cd) {
        parts.push(`<button type="button" class="decknote-card-ref" data-cd="${escHtml_(card.cd)}">${escHtml_(card.name)}</button>`);
      } else {
        parts.push(escHtml_(token));
      }

      lastIndex = re.lastIndex;
    }

    parts.push(escHtml_(raw.slice(lastIndex)));
    return nl2br_(parts.join(''));
  }

  /**
   * 代表カードサムネ
   */
  function cardThumb(src, title) {
    const safe = src ? src : 'img/noimage.webp';
    const alt = title ? escHtml_(title) : '';
    return `
      <div class="thumb-box" role="button" aria-label="デッキリストを表示">
        <img loading="lazy" src="${safe}" alt="${alt}">
        <span class="thumb-deckpeek-badge">
          <img src="img/deckicon.webp" alt="">
        </span>
      </div>
    `;
  }

  /**
   * 日時表示
   */
  function formatDateTime_(v) {
    if (!v) return '';
    try {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${y}/${m}/${day} ${hh}:${mm}`;
    } catch (_) {
      return String(v || '');
    }
  }

  /**
   * タグチップ（簡易fallback）
   */
  function fallbackTagChips_(s) {
    return String(s || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => `<span class="chip">${escHtml_(x)}</span>`)
      .join('');
  }

  function tagChipsMain_(tagsAuto, tagsPick) {
    if (typeof window.DeckPostFilter?.tagChipsMain === 'function') {
      return window.DeckPostFilter.tagChipsMain(tagsAuto, tagsPick);
    }
    return fallbackTagChips_([tagsAuto, tagsPick].filter(Boolean).join(','));
  }

  function tagChipsUser_(tagsUser) {
    if (typeof window.DeckPostFilter?.tagChipsUser === 'function') {
      return window.DeckPostFilter.tagChipsUser(tagsUser);
    }
    return fallbackTagChips_(tagsUser);
  }

    /**
   * JST前提で日付文字列を安定パース
   */
  function parseJstDate_(s) {
    const str = String(s || '').trim();
    if (!str) return null;

    let d = new Date(str);
    if (isFinite(d)) return d;

    const m = str.match(
      /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
    );
    if (!m) return null;

    const Y  = m[1];
    const Mo = String(m[2]).padStart(2, '0');
    const Da = String(m[3]).padStart(2, '0');
    const H  = String(m[4] ?? '00').padStart(2, '0');
    const Mi = String(m[5] ?? '00').padStart(2, '0');
    const Se = String(m[6] ?? '00').padStart(2, '0');

    d = new Date(`${Y}-${Mo}-${Da}T${H}:${Mi}:${Se}+09:00`);
    return isFinite(d) ? d : null;
  }

  window.parseJstDate_ = window.parseJstDate_ || parseJstDate_;

  // =========================
  // 1) 種族まわり
  // =========================
  const RACE_BG_MAP = {
    'ドラゴン': 'rgba(255, 100, 100, 0.16)',
    'アンドロイド': 'rgba(100, 200, 255, 0.16)',
    'エレメンタル': 'rgba(100, 255, 150, 0.16)',
    'ルミナス': 'rgba(255, 250, 150, 0.16)',
    'シェイド': 'rgba(200, 150, 255, 0.16)',
  };

  /**
   * 種族文字列からメイン種族を取得
   */
  function getMainRace(races) {
    const s = String(races || '');
    if (!s) return '';
    return s.split(/[,+]/)[0].trim();
  }

  /**
   * 種族背景色
   */
  function raceBg(races) {
    const main = getMainRace(races);
    return RACE_BG_MAP[main] || '';
  }

  // =========================
  // 2) デッキ情報の共通ヘルパ
  // =========================
  /**
   * item から { cd: count } の deckMap を取り出す
   */
  function extractDeckMap(item) {
    let deck = null;

    // 1) item.cards（配列）があれば優先
    if (Array.isArray(item?.cards) && item.cards.length) {
      deck = {};
      for (const c of item.cards) {
        const cd = String(c?.cd || '').trim();
        if (!cd) continue;

        const n = Number(c?.count || 0) || 0;
        if (n <= 0) continue;

        deck[cd] = (deck[cd] || 0) + n;
      }
    // 2) cards が「オブジェクト {cd: count}」のケース
    } else if (item?.cards && typeof item.cards === 'object') {
      deck = {};
      for (const [cd, nRaw] of Object.entries(item.cards)) {
        const key = String(cd || '').trim();
        if (!key) continue;

        const n = Number(nRaw || 0) || 0;
        if (n <= 0) continue;

        deck[key] = (deck[key] || 0) + n;
      }
    // 3) なければ cardsJSON（{cd:count} 文字列）を使う
    } else if (item?.cardsJSON) {
      try {
        const obj = JSON.parse(item.cardsJSON);
        if (obj && typeof obj === 'object') {
          deck = {};
          for (const [cd, nRaw] of Object.entries(obj)) {
            const key = String(cd || '').trim();
            if (!key) continue;

            const n = Number(nRaw || 0) || 0;
            if (n <= 0) continue;

            deck[key] = (deck[key] || 0) + n;
          }
        }
      } catch (_) {}
    }

    // ---- cdキーを必ず5桁に正規化（repCd照合ズレ防止）----
    if (deck && typeof deck === 'object') {
      const norm = {};
      for (const [cd, n] of Object.entries(deck)) {
        const cd5 = normCd5_(cd);
        const cnt = Number(n || 0) || 0;
        if (!cd5 || cnt <= 0) continue;
        norm[cd5] = (norm[cd5] || 0) + cnt;
      }
      deck = norm;
    }

    return deck;
  }

  /**
   * 旧神名を取得
   */
  function getOldGodNameFromItem(item) {
    const deck = extractDeckMap(item);
    if (!deck || !Object.keys(deck).length) return '';

    const cardMap = window.cardMap || {};
    for (const cd of Object.keys(deck)) {
      const cd5 = normCd5_(cd);
      if (cd5[0] === '9') {
        const card = cardMap[cd5] || {};
        return card.name || '';
      }
    }

    return '';
  }

  // =========================
  // 3) グラフ描画
  // =========================
  window.__postDistCharts = window.__postDistCharts || {};

  /**
   * 投稿詳細のコスト / パワー分布グラフ
   */
  function renderPostDistCharts_(item, paneUid) {
    if (!window.Chart) return false;

    const deck = extractDeckMap(item);
    const cardMap = window.cardMap || {};
    const buildDeckAnalysisCards = window.buildDeckAnalysisCards;
    const analyzeDeckCards = window.analyzeDeckCards;
    const formatManaEfficiencyText = window.formatManaEfficiencyText;
    const renderDeckTypePowerSummary = window.renderDeckTypePowerSummary;

    if (!deck || !Object.keys(deck).length) return false;
    if (typeof buildDeckAnalysisCards !== 'function' || typeof analyzeDeckCards !== 'function') {
      return false;
    }

    const deckCards = buildDeckAnalysisCards(deck, cardMap, {
      normalizeCd: normCd5_,
    });
    const analysis = analyzeDeckCards(deckCards);

    const costSumEl = document.getElementById(`cost-summary-${paneUid}`);
    if (costSumEl) {
      costSumEl.innerHTML = `<span class="stat-chip">総コスト ${analysis.sumCost}</span>`;
    }

    const avgChargeEl = document.getElementById(`avg-charge-${paneUid}`);
    if (avgChargeEl) {
      avgChargeEl.textContent = analysis.avgCharge !== null ? analysis.avgCharge.toFixed(2) : '-';
    }

    const manaEffEl = document.getElementById(`mana-efficiency-${paneUid}`);
    if (manaEffEl) {
      const manaState = typeof formatManaEfficiencyText === 'function'
        ? formatManaEfficiencyText(analysis.manaEfficiency)
        : { text: '-', className: 'mana-eff' };
      manaEffEl.textContent = manaState.text;
      manaEffEl.className = manaState.className;
    }

    const powerSumEl = document.getElementById(`power-summary-${paneUid}`);
    if (typeof renderDeckTypePowerSummary === 'function') {
      renderDeckTypePowerSummary(powerSumEl, analysis);
    }

    const prev = window.__postDistCharts[paneUid];
    if (prev) {
      try { prev.cost?.destroy(); } catch (_) {}
      try { prev.power?.destroy(); } catch (_) {}
      delete window.__postDistCharts[paneUid];
    }

    const costCanvas = document.getElementById(`costChart-${paneUid}`);
    const powerCanvas = document.getElementById(`powerChart-${paneUid}`);
    if (!costCanvas || !powerCanvas) return false;

    const renderedCharts = window.renderDeckDistributionCharts?.({
      chartCtor: Chart,
      costCanvas,
      powerCanvas,
      costLabels: analysis.costLabels,
      powerLabels: analysis.powerLabels,
      costCards: analysis.costCards,
      powerCards: analysis.analysisCards,
      noteText: analysis.excludedLosslis66Count > 0
        ? `※66コスロスリスカード ${analysis.excludedLosslis66Count}枚は除く`
        : '',
    });
    if (!renderedCharts) return false;

    window.__postDistCharts[paneUid] = {
      cost: renderedCharts.costChart,
      power: renderedCharts.powerChart,
    };
    return true;
  }
  function normalizePackEnName_(enName) {
    const s = String(enName || '').trim();
    if (!s) return '';

    // 旧データ・旧キャッシュに残ったAパックの誤表記を表示時に吸収する
    if (s.toLowerCase() === 'awaking the oracle') return 'Awakening The Oracle';
    return s;
  }

  function packNameEn_(packName) {
    if (typeof window.getPackEnName === 'function') {
      return normalizePackEnName_(window.getPackEnName(packName, ''));
    }

    const s = String(packName || '').trim();
    if (!s) return '';

    const idx = s.indexOf('「');
    if (idx > 0) return normalizePackEnName_(s.slice(0, idx));

    const slash = s.indexOf('／');
    if (slash > 0) return normalizePackEnName_(s.slice(0, slash));

    return normalizePackEnName_(s);
  }

  function packAbbr_(enName) {
    const s = String(enName || '').trim();
    const low = s.toLowerCase();

    if (low.includes('awakening the oracle') || low.includes('awaking the oracle')) return 'Aパック';
    if (low.includes('beyond the sanctuary')) return 'Bパック';
    if (low.includes('creeping souls')) return 'Cパック';
    if (low.includes('drawn sword')) return 'Dパック';
    if (low.includes('ensemble of silence') || low.includes('ensemble of slience')) return 'Eパック';
    if (low.includes('fallen fate')) return 'Fパック';
    if (low.includes('glory of the gods')) return 'Gパック';

    if (s.includes('コラボ') || low.includes('collab')) return 'コラボ';
    if (s.includes('その他特殊') || low.includes('special')) return '特殊';
    if (s.includes('その他')) return 'その他';

    return s;
  }

  function packKeyFromAbbr_(abbr) {
    if (typeof window.packKeyFromAbbr === 'function') {
      return window.packKeyFromAbbr(abbr);
    }

    const s = String(abbr || '');
    if (/^([A-Z])パック/.test(s)) return s[0];
    if (s.includes('特殊')) return 'SPECIAL';
    if (s.includes('コラボ')) return 'COLLAB';
    return '';
  }

  function getPackOrder_() {
    const p = window.packsData || window.packs || window.__PackCatalog || null;
    const order = p && Array.isArray(p.order) ? p.order : [];
    return order.map((x) => String(x || '').trim()).filter(Boolean);
  }

  /**
   * デッキ一覧タイルHTML
   */
  function buildDeckListHtml(item) {
    const deck = extractDeckMap(item);

    if (!deck || !Object.keys(deck).length) {
      return `<div class="post-decklist post-decklist-empty">デッキリスト未登録</div>`;
    }

    const cardMap = window.cardMap || {};
    const entries = window.sortCardEntries?.(Object.entries(deck), cardMap) || Object.entries(deck);

    const tiles = entries.map(([cd, n]) => {
      const cd5 = normCd5_(cd);
      const card = cardMap[cd5] || {};
      const name = card.name || cd5;
      const src = cardImageSrc_(card);

      const packName = card.pack_name || card.packName || '';
      const en = packNameEn_(packName);
      const abbr = packAbbr_(en);
      const packKey = packKeyFromAbbr_(abbr);
      const packAttr = packKey ? ` data-pack="${packKey}"` : '';
      const rarityKey = rarityKeyForPage4_(card.rarity) || 'unknown';
      const rarityAttr = ` data-rarity="${rarityKey}"`;

      return `
        <div class="deck-entry" data-cd="${cd5}"${packAttr}${rarityAttr} role="button" tabindex="0">
          <img src="${src}" alt="${escHtml_(name)}" loading="lazy" onerror="${cardImageErrorAttr_(card)}">
          <div class="count-badge">x${n}</div>
        </div>
      `;
    }).join('');

    return `<div class="post-decklist">${tiles}</div>`;
  }

  // =========================
  // 所持カード比較
  // =========================
  function normalizeOwnedCount_(entry) {
    if (typeof entry === 'number' || typeof entry === 'string') {
      return Math.max(0, Number(entry || 0) | 0);
    }
    return Math.max(0, Number(entry?.normal || 0) | 0);
  }

  function normalizeOwnedMap_(map) {
    const src = (map && typeof map === 'object') ? map : {};
    const out = {};
    Object.entries(src).forEach(([cdRaw, entry]) => {
      const cd = normCd5_(cdRaw);
      const count = normalizeOwnedCount_(entry);
      if (cd && count > 0) out[cd] = (out[cd] || 0) + count;
    });
    return out;
  }

  function hasOwnedData_(map) {
    return Object.keys(normalizeOwnedMap_(map)).length > 0;
  }

  function readOwnedMapFromStorageKey_(key) {
    try {
      return normalizeOwnedMap_(JSON.parse(localStorage.getItem(key) || '{}'));
    } catch (_) {
      return {};
    }
  }

  function readDeviceOwnedMap_() {
    const candidates = [];
    try {
      if (window.OwnedStore?.getAll) candidates.push(window.OwnedStore.getAll());
    } catch (_) {}

    candidates.push(readOwnedMapFromStorageKey_('ownedCardsGuestLocal'));
    candidates.push(readOwnedMapFromStorageKey_('ownedCards'));

    for (const candidate of candidates) {
      const owned = normalizeOwnedMap_(candidate);
      if (hasOwnedData_(owned)) return owned;
    }
    return {};
  }

  function isLoggedInForDeckCompare_() {
    const auth = window.Auth || {};
    return !!(auth.user && auth.token && auth.verified);
  }

  async function resolveOwnedMapForDeckCompare_() {
    let accountOwned = {};
    if (isLoggedInForDeckCompare_() && window.AccountAppDataSync?.debug) {
      try {
        const snapshot = await window.AccountAppDataSync.debug({ log: false, fetchAccount: true });
        accountOwned = normalizeOwnedMap_(snapshot?.accountData?.ownedCards);
      } catch (_) {}
    }

    if (hasOwnedData_(accountOwned)) return { owned: accountOwned, source: 'account' };

    const deviceOwned = readDeviceOwnedMap_();
    if (hasOwnedData_(deviceOwned)) return { owned: deviceOwned, source: 'device' };

    return { owned: {}, source: '' };
  }

  function rarityRankForCompare_(rarity) {
    const key = rarityKeyForPage4_(rarity);
    if (key === 'legend') return 0;
    if (key === 'gold') return 1;
    if (key === 'silver') return 2;
    if (key === 'bronze') return 3;
    return 4;
  }

  function rarityLabelForCompare_(key) {
    if (key === 'legend') return 'レジェンド';
    if (key === 'gold') return 'ゴールド';
    if (key === 'silver') return 'シルバー';
    if (key === 'bronze') return 'ブロンズ';
    return 'その他';
  }

  function buildDeckShortageResult_(item, ownedMap) {
    const deck = extractDeckMap(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length) return null;

    const entries = window.sortCardEntries?.(Object.entries(deck), cardMap) || Object.entries(deck);
    const shortages = [];
    const rarityCounts = {};
    let totalMissing = 0;

    entries.forEach(([cdRaw, needRaw], index) => {
      const cd = normCd5_(cdRaw);
      const need = Math.max(0, Number(needRaw || 0) | 0);
      const owned = Math.max(0, Number(ownedMap?.[cd] || 0) | 0);
      const missing = Math.max(0, need - owned);
      if (!cd || need <= 0 || missing <= 0) return;

      const card = cardMap[cd] || {};
      const rarityKey = rarityKeyForPage4_(card.rarity) || 'unknown';
      rarityCounts[rarityKey] = (rarityCounts[rarityKey] || 0) + missing;
      totalMissing += missing;
      shortages.push({
        cd,
        name: card.name || cd,
        rarity: card.rarity || '',
        rarityKey,
        need,
        owned,
        missing,
        index,
      });
    });

    shortages.sort((a, b) => {
      const rarityDiff = rarityRankForCompare_(a.rarity) - rarityRankForCompare_(b.rarity);
      if (rarityDiff) return rarityDiff;
      if (b.missing !== a.missing) return b.missing - a.missing;
      return a.index - b.index;
    });

    return { shortages, rarityCounts, totalTypes: shortages.length, totalMissing };
  }

  function buildDeckCompareHtml_(result) {
    if (!result) return `<div class="deck-compare-message is-note">デッキ情報を確認できませんでした。</div>`;
    const checkerLink = buildDeckCompareCheckerLinkHtml_();
    if (!result.totalMissing) {
      return `
        <div class="deck-compare-message is-complete">このデッキは所持カードで作れます！</div>
        ${checkerLink}
      `;
    }

    const rarityOrder = ['legend', 'gold', 'silver', 'bronze', 'unknown'];
    const rarityChips = rarityOrder
      .filter((key) => Number(result.rarityCounts[key] || 0) > 0)
      .map((key) => {
        const n = Number(result.rarityCounts[key] || 0);
        const cls = key !== 'unknown' ? ` carddetail-rarity carddetail-rarity--${key}` : '';
        return `<span class="stat-chip deck-shortage-rarity${cls}">${rarityLabelForCompare_(key)} ${n}枚</span>`;
      })
      .join('');

    const rows = result.shortages.map((row) => `
      <div class="deck-shortage-row">
        <div class="deck-shortage-thumb">
          <img src="${cardImageSrc_(row.cd)}"
            alt="${escHtml_(row.name)}"
            loading="lazy"
            onerror="${cardImageErrorAttr_(row.cd)}">
        </div>
        <div class="deck-shortage-row-body">
          <div class="deck-shortage-row-main">
            <span class="deck-shortage-name">${escHtml_(row.name)}</span>
            <span class="deck-shortage-rarity-label">${escHtml_(row.rarity || '不明')}</span>
          </div>
          <div class="deck-shortage-counts">必要${row.need} / 所持${row.owned} / 不足${row.missing}</div>
        </div>
      </div>
    `).join('');

    return `
      <div class="deck-shortage-summary">不足カード：${result.totalTypes}種類 / ${result.totalMissing}枚</div>
      <div class="post-detail-chips deck-shortage-rarity-list">${rarityChips}</div>
      <div class="deck-shortage-list">${rows}</div>
      ${checkerLink}
    `;
  }

  function buildDeckCompareCheckerLinkHtml_() {
    return `
      <div class="deck-compare-actions">
        <a class="deck-compare-checker-link" href="cards.html#checker">所持率チェッカーを開く</a>
      </div>
    `;
  }

  function buildDeckCompareEmptyGuideHtml_() {
    return `
      <div class="deck-compare-message is-note">
        <div>所持カードが登録されていません。</div>
        <div>所持率チェッカーに所持カードを登録すると、このデッキを作るために足りないカードを確認できます。</div>
        ${buildDeckCompareCheckerLinkHtml_()}
      </div>
    `;
  }

  function buildDeckCompareLikeGuideHtml_(loggedIn) {
    const loginText = loggedIn
      ? 'この投稿にいいねすると、所持率チェッカーのデータを参照して不足カードを確認できます。'
      : '不足カードの確認には、ログインしてこの投稿にいいねする必要があります。ログインまたは新規登録後、この投稿にいいねしてください。';
    return `<div class="deck-compare-message is-note">${escHtml_(loginText)}</div>`;
  }

  function showDeckCompareNoticePopup_(type, opts = {}) {
    const old = document.getElementById('deckCompareNoticePopup');
    if (old) old.remove();

    const isLogin = type === 'login';
    const isLike = type === 'like';

    const title = isLogin
      ? '不足カードの確認にはログインが必要です'
      : 'この投稿をいいねすると確認できます';

    const text = isLogin
      ? 'ログインまたは新規登録後、この投稿にいいねしてください。'
      : '不足カードを確認するには、このデッキをいいねして保存してください。';

    const actionHtml = isLogin
      ? `
          <button type="button" class="auth-mini-btn primary" data-action="auth-login">ログイン</button>
          <button type="button" class="auth-mini-btn" data-action="auth-signup">新規登録</button>
        `
      : `<button type="button" class="deck-compare-popup-primary" data-action="like">★ いいねして比較する</button>`;

    const el = document.createElement('div');
    el.id = 'deckCompareNoticePopup';
    el.className = 'deck-compare-popup';
    el.dataset.postid = String(opts.postId || '');
    el.innerHTML = `
      <div class="deck-compare-popup-backdrop" data-action="close"></div>
      <div class="deck-compare-popup-panel" role="dialog" aria-modal="true">
        <button type="button" class="deck-compare-popup-close" data-action="close" aria-label="閉じる">×</button>
        <div class="deck-compare-popup-title">${escHtml_(title)}</div>
        <div class="deck-compare-popup-text">${escHtml_(text)}</div>
        <div class="deck-compare-popup-actions${isLogin ? ' is-auth' : ''}">
          ${actionHtml}
          <button type="button" class="deck-compare-popup-secondary" data-action="close">キャンセル</button>
        </div>
      </div>
    `;

    document.body.appendChild(el);
  }

  function setDeckCompareButtonActive_(button, active) {
    if (!button) return;
    button.classList.toggle('is-active', !!active);
    button.setAttribute('aria-expanded', active ? 'true' : 'false');
    button.textContent = active ? '不足カードリストを閉じる' : '不足カードを確認';
  }

  function clearDeckShortageHighlight_(root) {
    const decklist = root?.querySelector?.('.post-decklist');
    if (!decklist) return;
    decklist.classList.remove('is-pack-focus', 'is-rarity-focus', 'is-shortage-focus');
    root.querySelectorAll('.pack-chip.is-active, .rarity-chip.is-active')
      .forEach((el) => el.classList.remove('is-active'));
    root.querySelectorAll('.deck-entry.pack-hl, .deck-entry.shortage-hl')
      .forEach((el) => {
        el.classList.remove('pack-hl', 'shortage-hl');
        el.querySelector('.shortage-badge')?.remove();
      });
  }

  function applyDeckShortageHighlight_(root, result) {
    clearDeckShortageHighlight_(root);
    const decklist = root?.querySelector?.('.post-decklist');
    if (!decklist || !result?.shortages?.length) return;

    result.shortages.forEach((row) => {
      const safeCd = window.CSS?.escape ? CSS.escape(row.cd) : String(row.cd).replace(/"/g, '\\"');
      const entry = decklist.querySelector(`.deck-entry[data-cd="${safeCd}"]`);
      if (!entry) return;
      entry.classList.add('shortage-hl');
      entry.insertAdjacentHTML('beforeend', `<div class="shortage-badge">不足${row.missing}</div>`);
    });

    decklist.classList.add('is-shortage-focus');
  }

  async function handleDeckCompareClick_(button) {
    const root = button?.closest?.('.post-detail-inner');
    const resultBox = root?.querySelector?.('.deck-compare-result');
    if (!root || !resultBox) return;

    if (button.classList.contains('is-active')) {
      setDeckCompareButtonActive_(button, false);
      resultBox.hidden = true;
      resultBox.innerHTML = '';
      clearDeckShortageHighlight_(root);
      return;
    }

    const postId = String(root.dataset.postid || '').trim();
    const item = postId ? findItemById_(postId) : null;
    if (!item) return;

    const listMode = String(root.dataset.listMode || '').trim();
    if (listMode === 'list' && !item.liked) {
      clearDeckShortageHighlight_(root);
      setDeckCompareButtonActive_(button, false);
      resultBox.hidden = true;
      resultBox.innerHTML = '';

      showDeckCompareNoticePopup_(
        isLoggedInForDeckCompare_() ? 'like' : 'login',
        { postId }
      );
      return;
    }

    button.disabled = true;
    resultBox.hidden = false;
    resultBox.innerHTML = '<div class="deck-compare-message is-note">所持カードデータを読み込み、不足カードを確認しています...</div>';

    try {
      const { owned } = await resolveOwnedMapForDeckCompare_();
      setDeckCompareButtonActive_(button, true);

      if (!hasOwnedData_(owned)) {
        clearDeckShortageHighlight_(root);
        resultBox.innerHTML = buildDeckCompareEmptyGuideHtml_();
        return;
      }

      const result = buildDeckShortageResult_(item, owned);
      resultBox.innerHTML = buildDeckCompareHtml_(result);
      if (result?.totalMissing) applyDeckShortageHighlight_(root, result);
      else clearDeckShortageHighlight_(root);
    } finally {
      button.disabled = false;
    }
  }

  // =========================
  // 5) レアリティ / 投稿別カード参照ヘルパ
  // =========================
  /**
   * レアリティキー正規化
   */
  function rarityKeyForPage4_(rarity) {
    const r = String(rarity || '').trim();
    if (!r) return '';

    if (r.includes('レジェンド')) return 'legend';
    if (r.includes('ゴールド')) return 'gold';
    if (r.includes('シルバー')) return 'silver';
    if (r.includes('ブロンズ')) return 'bronze';

    const low = r.toLowerCase();
    if (low.includes('legend')) return 'legend';
    if (low.includes('gold')) return 'gold';
    if (low.includes('silver')) return 'silver';
    if (low.includes('bronze')) return 'bronze';

    return '';
  }

  /**
   * pill用クラス
   */
  function rarityPillClassForPage4_(rarity) {
    const k = rarityKeyForPage4_(rarity);
    return k ? `carddetail-rarity--${k}` : '';
  }

  /**
   * レアリティ表示ラベル
   */
  function rarityLabelForPage4_(rarity) {
    const r = String(rarity || '').trim();
    if (!r) return '';
    return r;
  }

  /**
   * postId から item を探す
   */
  function findItemById_(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return null;

    const state = window.DeckPostState.getState();
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

  /**
   * 一覧項目に詳細本文が含まれているか
   */
  function hasDetailPayload_(item) {
    if (!item || typeof item !== 'object') return false;
    return (
      Object.prototype.hasOwnProperty.call(item, 'deckNote') ||
      Object.prototype.hasOwnProperty.call(item, 'cardNotes')
    );
  }

  /**
   * 取得した詳細データを state 内の同一投稿へ反映
   */
  function mergeFetchedPostIntoState_(postId, patch) {
    const pid = String(postId || '').trim();
    if (!pid || !patch || typeof patch !== 'object') return null;

    const state = window.DeckPostState?.getState?.();
    if (!state) return null;

    const mergeList = (arr) => {
      if (!Array.isArray(arr)) return null;
      let hit = null;
      for (let i = 0; i < arr.length; i += 1) {
        const item = arr[i];
        if (String(item?.postId || '').trim() !== pid) continue;
        arr[i] = { ...item, ...patch, postId: pid };
        hit = arr[i];
      }
      return hit;
    };

    return (
      mergeList(state.mine?.items) ||
      mergeList(state.list?.items) ||
      mergeList(state.list?.allItems) ||
      mergeList(state.list?.filteredItems) ||
      null
    );
  }

  /**
   * apiGetPost の応答を投稿オブジェクトに寄せる
   */
  function normalizeFetchedPostResponse_(res, fallbackItem) {
    const base = fallbackItem && typeof fallbackItem === 'object' ? fallbackItem : {};
    const src = res?.item || res?.post || res?.data || res || {};
    if (!src || typeof src !== 'object') return null;

    const next = { ...base, ...src };
    next.postId = String(next.postId || base.postId || '').trim();
    if (!next.postId) return null;

    if (!Object.prototype.hasOwnProperty.call(next, 'deckNote')) {
      next.deckNote = String(next.comment || base.comment || '');
    }
    if (!Array.isArray(next.cardNotes)) {
      next.cardNotes = Array.isArray(base.cardNotes) ? base.cardNotes : [];
    }
    return next;
  }

  /**
   * 詳細表示に必要な本文を不足時だけ1件取得する
   */
  async function ensurePostDetailData_(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return null;

    const current = findItemById_(pid);
    if (!current) return null;
    if (hasDetailPayload_(current)) return current;

    const res = await window.DeckPostApi?.apiGetPost?.({ postId: pid });
    if (!res || res.ok === false) {
      throw new Error((res && res.error) || 'get failed');
    }

    const normalized = normalizeFetchedPostResponse_(res, current);
    if (!normalized) return current;

    return mergeFetchedPostIntoState_(pid, normalized) || normalized;
  }

  window.__cardMapCache = window.__cardMapCache || new Map();
  window.__cardVersionsIndex = window.__cardVersionsIndex || null;

  const ADJUSTMENT_COMPARE_FIELDS_ = [
    'cost',
    'power',
    'effect_name1',
    'effect_text1',
    'effect_name2',
    'effect_text2',
    'effect_text_all',
  ];
  const cardAdjustmentHistoryCache_ = new Map();

  /**
   * JSON取得
   */
  async function fetchJson_(url, opt = {}) {
    const res = await fetch(url, { cache: opt.cache || 'force-cache' });
    if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
    return await res.json();
  }

  /**
   * カードJSONのベースパス
   */
  function cardDataBase_() {
    const b = String(window.CARD_DATA_BASE || 'public/').trim();
    return b.endsWith('/') ? b : (b + '/');
  }

  /**
   * カードJSONのURL化
   */
  function cardDataUrl_(name) {
    return cardDataBase_() + String(name || '').replace(/^\/+/, '');
  }

  /**
   * cards_xxx.json を cardMap 化
   */
  async function loadCardMapFile_(fileName) {
    const cache = window.__cardMapCache;
    if (cache.has(fileName)) return cache.get(fileName);

    const raw = await fetchJson_(cardDataUrl_(fileName));
    const map = {};

    if (Array.isArray(raw)) {
      for (const c of raw) {
        const cd5 = normCd5_(c.cd);
        if (cd5) map[cd5] = c;
      }
    } else if (raw && typeof raw === 'object') {
      for (const [cd, c] of Object.entries(raw)) {
        const cd5 = normCd5_(cd);
        map[cd5] = c;
      }
    }

    cache.set(fileName, map);
    return map;
  }

  async function loadLatestCardMap_() {
    return loadCardMapFile_('cards_latest.json');
  }

  function cardCompareValue_(card, key) {
    const v = card?.[key];
    return v === null || v === undefined
      ? ''
      : String(v).replace(/\r\n/g, '\n').trim();
  }

  function isAdjustedFromLatest_(card, latestCard) {
    if (!card || !latestCard) return false;
    return ADJUSTMENT_COMPARE_FIELDS_.some((key) =>
      cardCompareValue_(card, key) !== cardCompareValue_(latestCard, key)
    );
  }

  async function loadCardAdjustmentRows_(cd) {
    const cd5 = normCd5_(cd);
    if (!cd5) return [];
    if (cardAdjustmentHistoryCache_.has(cd5)) return cardAdjustmentHistoryCache_.get(cd5);

    const promise = (async () => {
      const idx = await loadCardVersionsIndex_();
      const rows = [];

      for (const item of idx?.versions || []) {
        const file = item?.file;
        if (!file) continue;

        const map = await loadCardMapFile_(file);
        const card = map?.[cd5];
        if (!card) continue;

        rows.push({
          version: item.version || card.updated_at || '',
          card,
        });
      }

      const latestMap = await loadLatestCardMap_();
      const latest = latestMap?.[cd5];
      if (latest) {
        rows.push({
          version: 'latest',
          card: latest,
        });
      }

      const unique = [];
      for (const row of rows) {
        const prev = unique[unique.length - 1];
        if (!prev || isAdjustedFromLatest_(prev.card, row.card)) {
          unique.push(row);
        }
      }

      const latestRow = unique[unique.length - 1];
      if (!latestRow) return [];

      const adjustedRows = unique.filter((row) => isAdjustedFromLatest_(row.card, latestRow.card));
      return adjustedRows.reverse();
    })();

    cardAdjustmentHistoryCache_.set(cd5, promise);
    return promise;
  }

  async function isCardUsingAdjustedVersion_(cd, snapshotCard) {
    const rows = await loadCardAdjustmentRows_(cd);
    if (!rows.length || !snapshotCard) return false;
    const snapshotUpdated = cardCompareValue_(snapshotCard, 'updated_at');
    return rows.some((row) => {
      const rowUpdated = cardCompareValue_(row.card, 'updated_at');
      if (snapshotUpdated && rowUpdated && snapshotUpdated === rowUpdated) return true;
      return !isAdjustedFromLatest_(snapshotCard, row.card);
    });
  }

  function buildCardAdjustmentNoticeHtml_() {
    return `
      <div class="post-adjustment-notice">
        このカードは投稿当時の効果で表示しています。<br>
        最新版とはカードの性能が違います。
      </div>
    `;
  }

  function buildDeckAdjustmentNoticeHtml_(names) {
    const list = (names || []).filter(Boolean);
    const items = list.map((name) => `<li>${escHtml_(name)}</li>`).join('');
    return `
      <div class="post-adjustment-notice post-adjustment-notice--deck">
        <div class="post-adjustment-notice-title">調整が入ったカードがあります。投稿当時の効果で表示しています。</div>
        <ul class="post-adjustment-list">${items}</ul>
      </div>
    `;
  }

  async function findAdjustedDeckCards_(item, snapshotMap) {
    const deck = extractDeckMap(item);
    if (!deck || !Object.keys(deck).length) return [];

    const result = [];
    for (const cd of Object.keys(deck).map(normCd5_).filter(Boolean)) {
        const card = snapshotMap?.[cd];
        if (await isCardUsingAdjustedVersion_(cd, card)) {
          result.push({
            cd,
            name: card?.name || cd,
          });
        }
    }
    return result;
  }

  async function renderDeckAdjustmentNotice_(root, item, snapshotMap) {
    if (!root || root.dataset.adjustmentNoticeRendered === '1') return;

    try {
      const adjusted = await findAdjustedDeckCards_(item, snapshotMap);
      if (!adjusted.length || !root.isConnected) return;

      const decklist = root.querySelector('.post-decklist');
      if (!decklist || decklist.parentElement?.querySelector('.post-adjustment-notice--deck')) return;

      const names = adjusted.map((row) => row.name);
      decklist.insertAdjacentHTML('beforebegin', buildDeckAdjustmentNoticeHtml_(names));
      root.dataset.adjustmentNoticeRendered = '1';
    } catch (err) {
      console.warn('[deck-post] 調整カード注意文の描画失敗:', err);
    }
  }

  function renderDeckAdjustmentNoticeForPostDate_(root, item) {
    if (!root || !item) return;
    withCardMapForPostDate_(item, () =>
      renderDeckAdjustmentNotice_(root, item, window.cardMap || {})
    );
  }

  /**
   * cards_versions.json を読む
   */
  async function loadCardVersionsIndex_() {
    const cur = window.__cardVersionsIndex;
    if (cur && Array.isArray(cur.versions) && cur.versions.length) return cur;

    const idx = await fetchJson_(cardDataUrl_('cards_versions.json'), { cache: 'no-store' });

    if (!idx || !Array.isArray(idx.versions)) {
      console.warn('[cardMap] cards_versions.json invalid:', idx);
      window.__cardVersionsIndex = null;
      return { versions: [] };
    }

    window.__cardVersionsIndex = idx;
    return idx;
  }

  /**
   * 投稿日に合うカードスナップショットを選ぶ
   */
  function pickSnapshotFileForPostDate_(versions, postDateLike) {
    const parse = window.parseJstDate_;
    const post = (postDateLike instanceof Date)
      ? postDateLike
      : (typeof parse === 'function' ? parse(postDateLike) : new Date(postDateLike));

    if (!post || Number.isNaN(post.getTime())) return null;

    const list = (versions || [])
      .map((v) => {
        const d = typeof parse === 'function' ? parse(v.version) : new Date(v.version);
        const file = v.file || v.after || v.before || null;
        return { ...v, _d: d, _file: file };
      })
      .filter((v) => v._d && !Number.isNaN(v._d.getTime()) && v._file)
      .sort((a, b) => a._d - b._d);

    if (!list.length) return null;

    const newest = list[list.length - 1];
    if (post > newest._d) return null;
    if (post < list[0]._d) return list[0]._file;

    let last = null;
    for (const v of list) {
      if (v._d <= post) last = v;
    }
    return last ? last._file : null;
  }

  /**
   * 投稿日時点の cardMap を一時適用して fn 実行
   */
  async function withCardMapForPostDate_(item, fn) {
    try {
      const parse = window.parseJstDate_;
      const c = typeof parse === 'function' ? parse(item?.createdAt) : new Date(item?.createdAt);
      const u = typeof parse === 'function' ? parse(item?.updatedAt) : new Date(item?.updatedAt);

      const cOk = c && !Number.isNaN(c.getTime());
      const uOk = u && !Number.isNaN(u.getTime());

      // 投稿後の編集で環境がずれないよう、作成日を優先する
      const base = cOk ? c : (uOk ? u : null);
      if (!base) return fn();

      const idx = await loadCardVersionsIndex_();
      const file = pickSnapshotFileForPostDate_(idx?.versions, base);
      if (!file) return fn();

      const map = await loadCardMapFile_(file);

      const prev = window.cardMap;
      window.cardMap = map;
      try {
        return await fn();
      } finally {
        window.cardMap = prev;
      }
    } catch (e) {
      console.warn('withCardMapForPostDate_ failed:', e);
      return fn();
    }
  }

  // =========================
  // 6) カード詳細ドック / ドロワー
  // =========================
  /**
   * カード詳細HTML
   */
  function buildCardDetailHtml_(cd5, options = {}) {
    const cardMap = window.cardMap || {};
    const c = cardMap[normCd5_(cd5)] || {};
    const mainRace = getMainRace(c.races ?? (c.race ? [c.race] : []));

    const name = c.name || cd5;

    const packRaw = c.pack_name || c.packName || '';
    const pack = packRaw
      ? (window.splitPackName
          ? window.splitPackName(packRaw)
          : { en: String(packRaw), jp: '' })
      : null;
    if (pack) pack.en = normalizePackEnName_(pack.en);

    let packKey = '';
    if (packRaw) {
      const enName = (typeof packNameEn_ === 'function') ? packNameEn_(packRaw) : String(packRaw);
      const abbr = (typeof packAbbr_ === 'function') ? packAbbr_(enName) : '';
      packKey = (typeof packKeyFromAbbr_ === 'function') ? packKeyFromAbbr_(abbr) : '';
    }

    const cat = c.category || '';
    const img = cardImageSrc_(c.cd ? c : { ...c, cd: cd5 });

    const rarityLabel = rarityLabelForPage4_(c.rarity);
    const rarityCls = rarityPillClassForPage4_(c.rarity);

    const e1n = c.effect_name1 || '';
    const e1t = c.effect_text1 || '';
    const e2n = c.effect_name2 || '';
    const e2t = c.effect_text2 || '';
    const adjustedNotice = options.isAdjusted === true
      ? buildCardAdjustmentNoticeHtml_()
      : '';

    const effectBlocks = `
      ${e1n || e1t ? `
        <div class="carddetail-effect">
          ${e1n ? `<div class="carddetail-effect-name">${escHtml_(e1n)}</div>` : ''}
          ${e1t ? `<div class="carddetail-effect-text">${nl2br_(escHtml_(e1t))}</div>` : ''}
        </div>
      ` : ''}
      ${e2n || e2t ? `
        <div class="carddetail-effect">
          ${e2n ? `<div class="carddetail-effect-name">${escHtml_(e2n)}</div>` : ''}
          ${e2t ? `<div class="carddetail-effect-text">${nl2br_(escHtml_(e2t))}</div>` : ''}
        </div>
      ` : ''}
      ${(!e1n && !e1t && !e2n && !e2t) ? `
        <div class="carddetail-empty">カードテキストが未登録です。</div>
      ` : ''}
    `;

    return `
      <div class="carddetail-head">
        <div class="carddetail-thumb">
          <img src="${img}"
               alt="${escHtml_(name)}"
               loading="lazy"
               class="carddetail-thumb-img"
               data-cd="${escHtml_(normCd5_(cd5))}"
               onerror="${cardImageErrorAttr_(c.cd ? c : { ...c, cd: cd5 })}">
        </div>

        <div class="carddetail-meta">
          <div class="card-title-row"style="justify-content: normal;">
            <button
              type="button"
              class="detail-zoom-btn"
              data-cd="${escHtml_(normCd5_(cd5))}"
              aria-label="画像を拡大"
              title="画像を拡大"
            >
              <img
                class="zoom-ic"
                src="./img/zoom_in_24.svg"
                alt=""
                aria-hidden="true"
                decoding="async"
              >
            </button>
            <div class="carddetail-name">${escHtml_(name)}</div>
          </div>
          <div class="carddetail-sub">
            ${pack ? `
              <div class="carddetail-pack"${packKey ? ` data-pack="${packKey}"` : ''}>
                ${pack.en ? `<div class="carddetail-pack-en">${escHtml_(pack.en)}</div>` : ''}
                ${pack.jp ? `<div class="carddetail-pack-jp">${escHtml_(pack.jp)}</div>` : ''}
              </div>
            ` : ''}

            <div class="carddetail-cat-rarity">
              ${cat ? `<span class="carddetail-cat cat-${escHtml_(mainRace)}">${escHtml_(cat)}</span>` : ''}
              ${rarityLabel ? `
                <span class="stat-chip carddetail-rarity ${rarityCls}">
                  ${escHtml_(rarityLabel)}
                </span>
              ` : ''}
            </div>
          </div>
        </div>

        <button type="button" class="carddetail-close" aria-label="閉じる">×</button>
      </div>

      <div class="carddetail-body">
        ${effectBlocks}
        ${adjustedNotice}
      </div>
    `;
  }

  /**
   * カード詳細を閉じる
   */
  function closeCardDetail_() {
    const drawer = document.getElementById('cardDetailDrawer');
    if (drawer) drawer.style.display = 'none';

    document
      .querySelectorAll('.post-detail-inner .carddetail-dock .carddetail-inner')
      .forEach((inner) => {
        if (!inner) return;
        inner.innerHTML = `<div class="carddetail-empty">ここにカードの詳細が表示されます</div>`;
      });
  }

  /**
   * PC用カード詳細ドックを確保
   */
  function ensureCardDetailDockPc_(root) {
    if (!root) return null;

    let dock = root.querySelector('.carddetail-dock');
    if (dock) return dock;

    const deckcol = root.querySelector('.post-detail-deckcol');
    if (!deckcol) return null;

    const sec = document.createElement('div');
    sec.className = 'post-detail-section carddetail-dock';
    sec.innerHTML = `
      <div class="post-detail-heading">カード詳細</div>
      <div class="carddetail-inner">
        <div class="carddetail-empty">ここにカードの詳細が表示されます</div>
      </div>
    `;

    const codeBody = deckcol.querySelector('.post-detail-code-body');
    if (codeBody) {
      codeBody.insertAdjacentElement('afterend', sec);
      return sec;
    }

    const decklistEl = deckcol.querySelector('.post-decklist');
    const decklistSec = decklistEl?.closest('.post-detail-section');
    if (decklistSec) {
      decklistSec.insertAdjacentElement('afterend', sec);
      return sec;
    }

    deckcol.appendChild(sec);
    return sec;
  }

  /**
   * SP用カード詳細ドロワーを確保
   */
  function ensureCardDetailDrawerSp_() {
    let drawer = document.getElementById('cardDetailDrawer');
    if (drawer) return drawer;

    drawer = document.createElement('div');
    drawer.id = 'cardDetailDrawer';
    drawer.style.display = 'none';
    drawer.innerHTML = `
      <div class="carddetail-drawer-inner">
        <div class="carddetail-inner"></div>
      </div>
    `;
    document.body.appendChild(drawer);

    drawer.addEventListener('click', (e) => {
      if (e.target === drawer) {
        drawer.style.display = 'none';
      }
    });

    return drawer;
  }

  /**
   * デッキ内カードクリック時に詳細を開く
   */
  async function openCardDetailFromDeck_(cd5, clickedEl) {
    const cd = normCd5_(cd5);
    if (!cd) return;

    const root = clickedEl?.closest?.('.post-detail-inner')
      || document.querySelector('.post-detail-inner');

    const postId = String(root?.dataset?.postid || '').trim();
    const item = postId ? findItemById_(postId) : null;

    try {
      window.__latestCardMapForNotice = await loadLatestCardMap_();
    } catch (err) {
      console.warn('[deck-post] 最新カードJSON読み込み失敗:', err);
      window.__latestCardMapForNotice = {};
    }
    let html = '';
    if (item) {
      const isAdjusted = await withCardMapForPostDate_(item, async () => {
        const snapshotCard = (window.cardMap || {})[cd] || null;
        return await isCardUsingAdjustedVersion_(cd, snapshotCard);
      });
      html = await withCardMapForPostDate_(item, () => buildCardDetailHtml_(cd, { isAdjusted }));
    } else {
      html = buildCardDetailHtml_(cd, { isAdjusted: false });
    }

    const isPcWide = window.matchMedia('(min-width: 1024px)').matches;

    if (isPcWide) {
      const dock = ensureCardDetailDockPc_(root);
      const inner = dock?.querySelector('.carddetail-inner');
      if (inner) inner.innerHTML = html;
      return;
    }

    const drawer = ensureCardDetailDrawerSp_();
    const inner = drawer.querySelector('.carddetail-inner');
    if (inner) inner.innerHTML = html;
    drawer.style.display = 'block';
  }

  // =========================
  // 7) 簡易統計
  // =========================
  function buildSimpleDeckStats(item) {
    const raw = item.typeMixJSON || item.typeMixJson || '';

    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length >= 3) {
          const chg = Number(arr[0] || 0);
          const atk = Number(arr[1] || 0);
          const blk = Number(arr[2] || 0);
          const totalType = chg + atk + blk;
          if (totalType > 0) {
            const typeText = `チャージャー ${chg}枚 / アタッカー ${atk}枚 / ブロッカー ${blk}枚`;
            return { typeText, chg, atk, blk, totalType };
          }
        }
      } catch (_) {}
    }

    const deck = extractDeckMap(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length || !cardMap) return null;

    let chg = 0, atk = 0, blk = 0;

    for (const [cd, nRaw] of Object.entries(deck)) {
      const n = Number(nRaw || 0) || 0;
      if (!n) continue;

      const cd5 = normCd5_(cd);
      const t = (cardMap[cd5] || {}).type;
      if (t === 'チャージャー') chg += n;
      else if (t === 'アタッカー') atk += n;
      else if (t === 'ブロッカー') blk += n;
    }

    const totalType = chg + atk + blk;
    if (!totalType) return null;

    const typeText = `チャージャー ${chg}枚 / アタッカー ${atk}枚 / ブロッカー ${blk}枚`;
    return { typeText, chg, atk, blk, totalType };
  }

  // タイプチップHTML
  function buildTypeChipsHtml_(simpleStats) {
    if (!simpleStats) return '';
    const rows = [
      ['チャージャー', simpleStats.chg],
      ['アタッカー', simpleStats.atk],
      ['ブロッカー', simpleStats.blk],
    ].filter(([, n]) => (Number(n || 0) || 0) > 0);

    if (!rows.length) return '';
    return rows.map(([t, n]) =>
      `<span class="type-chip" data-type="${escHtml_(t)}">${escHtml_(t)} ${Number(n)}枚</span>`
    ).join('');
  }

  // レアリティミックステキスト
  function buildRarityMixText_(item) {
    const deck = extractDeckMap(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length || !cardMap) return '';

    let legend = 0, gold = 0, silver = 0, bronze = 0, unknown = 0;

    for (const [cd, nRaw] of Object.entries(deck)) {
      const n = Number(nRaw || 0) || 0;
      if (!n) continue;

      const cd5 = normCd5_(cd);
      const r = String((cardMap[cd5] || {}).rarity || '').trim();

      if (r === 'レジェンド') legend += n;
      else if (r === 'ゴールド') gold += n;
      else if (r === 'シルバー') silver += n;
      else if (r === 'ブロンズ') bronze += n;
      else unknown += n;
    }

    const total = legend + gold + silver + bronze + unknown;
    if (!total) return '';

    const parts = [
      `レジェンド ${legend}枚`,
      `ゴールド ${gold}枚`,
      `シルバー ${silver}枚`,
      `ブロンズ ${bronze}枚`,
    ];
    if (unknown) parts.push(`不明 ${unknown}枚`);

    return parts.join(' / ');
  }

  function buildRarityMixCounts_(item) {
    const deck = extractDeckMap(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length || !cardMap) return null;

    let legend = 0, gold = 0, silver = 0, bronze = 0, unknown = 0;

    for (const [cd, nRaw] of Object.entries(deck)) {
      const n = Number(nRaw || 0) || 0;
      if (!n) continue;

      const cd5 = normCd5_(cd);
      const r = String((cardMap[cd5] || {}).rarity || '').trim();

      if (r === 'レジェンド') legend += n;
      else if (r === 'ゴールド') gold += n;
      else if (r === 'シルバー') silver += n;
      else if (r === 'ブロンズ') bronze += n;
      else unknown += n;
    }

    const total = legend + gold + silver + bronze + unknown;
    if (!total) return null;
    return { legend, gold, silver, bronze, unknown, total };
  }

  // レアリティチップHTML
  function buildRarityChipsHtml_(item) {
    const c = buildRarityMixCounts_(item);
    if (!c) return '';

    const out = [];
    if (c.legend) out.push(`<span class="stat-chip carddetail-rarity rarity-chip carddetail-rarity--legend" data-rarity="legend" role="button" tabindex="0">レジェンド ${c.legend}枚 <span class="chip-icon">🔍</span></span>`);
    if (c.gold) out.push(`<span class="stat-chip carddetail-rarity rarity-chip carddetail-rarity--gold" data-rarity="gold" role="button" tabindex="0">ゴールド ${c.gold}枚 <span class="chip-icon">🔍</span></span>`);
    if (c.silver) out.push(`<span class="stat-chip carddetail-rarity rarity-chip carddetail-rarity--silver" data-rarity="silver" role="button" tabindex="0">シルバー ${c.silver}枚 <span class="chip-icon">🔍</span></span>`);
    if (c.bronze) out.push(`<span class="stat-chip carddetail-rarity rarity-chip carddetail-rarity--bronze" data-rarity="bronze" role="button" tabindex="0">ブロンズ ${c.bronze}枚 <span class="chip-icon">🔍</span></span>`);
    if (c.unknown) out.push(`<span class="stat-chip rarity-chip" data-rarity="unknown" role="button" tabindex="0">不明 ${c.unknown}枚 <span class="chip-icon">🔍</span></span>`);

    return out.join('');
  }

  function buildPackMixCounts_(item) {
    const deck = extractDeckMap(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length || !cardMap) return null;

    const counts = Object.create(null);
    let unknown = 0;

    for (const [cd, nRaw] of Object.entries(deck)) {
      const n = Number(nRaw || 0) || 0;
      if (!n) continue;

      const cd5 = normCd5_(cd);
      const packName = (cardMap[cd5] || {}).pack_name || (cardMap[cd5] || {}).packName || '';
      const en = packNameEn_(packName);

      if (en) counts[en] = (counts[en] || 0) + n;
      else unknown += n;
    }

    const keys = Object.keys(counts);
    if (!keys.length && !unknown) return null;

    const order = getPackOrder_();
    keys.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) {
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      }
      return a.localeCompare(b);
    });

    return { keys, counts, unknown };
  }

  // パック構成チップHTML
  function buildPackChipsHtml_(item) {
    const d = buildPackMixCounts_(item);
    if (!d) return '';

    const out = [];
    for (const k of d.keys) {
      const n = Number(d.counts[k] || 0) || 0;
      if (!n) continue;

      const abbr = packAbbr_(k);
      const packKey = packKeyFromAbbr_(abbr);
      const attr = packKey ? ` data-pack="${packKey}"` : '';

      out.push(
        `<span class="stat-chip pack-chip"${attr} role="button" tabindex="0">
          ${escHtml_(abbr)} ${n}枚 <span class="pack-icon">🔍</span>
        </span>`
      );
    }

    if (d.unknown) {
      out.push(
        `<span class="stat-chip pack-chip" role="button" tabindex="0">
          不明 ${Number(d.unknown)}枚 <span class="pack-icon">🔍</span>
        </span>`
      );
    }

    return out.join('');
  }

  // =========================
  // 8) 詳細本文HTML
  // =========================
  function buildDeckNoteHtml(deckNote) {
    const text = String(deckNote || '').trim();
    if (!text) {
      return `<div class="post-decknote-empty">投稿者によるデッキ解説はまだ登録されていません。</div>`;
    }

    const blocks = text
      .split(/\n(?=【[^】]+】)/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((block) => {
        const m = block.match(/^【([^】]+)】\s*\n?([\s\S]*)$/);
        if (m) {
          const title = m[1];
          const body = m[2] || '';
          return `
            <section class="decknote-block">
              <div class="decknote-heading">${escHtml_(title)}</div>
              <div class="decknote-body">${renderDeckNoteText_(body)}</div>
            </section>
          `;
        }

        return `
          <section class="decknote-block">
            <div class="decknote-body">${renderDeckNoteText_(block)}</div>
          </section>
        `;
      })
      .join('');

    return `<div class="post-decknote">${blocks}</div>`;
  }

  // カード解説HTML
  function buildCardNotesHtml(item) {
    const srcList = Array.isArray(item?.cardNotes) ? item.cardNotes : [];
    const list = srcList
      .map((r) => ({ cd: String(r?.cd || ''), text: String(r?.text || '') }))
      .filter((r) => r.cd || r.text);

    if (!list.length) {
      return `<div class="post-cardnotes-empty">投稿者によるカード解説はまだ登録されていません。</div>`;
    }

    const cardMap = window.cardMap || {};

    const rows = list.map((r) => {
      const cdRaw = String(r.cd || '').trim();
      const cd5 = normCd5_(cdRaw);
      const card = cardMap[cd5] || {};
      const name = card.name || 'カード名未登録';
      const img = cardImageSrc_(card.cd ? card : { ...card, cd: cd5 });
      const textHtml = escHtml_(r.text || '').replace(/\n/g, '<br>');

      return `
        <div class="post-cardnote">
          <div class="post-cardnote-thumb">
            <img src="${img}"
                 alt="${escHtml_(name)}"
                 loading="lazy"
                 onerror="${cardImageErrorAttr_(card.cd ? card : { ...card, cd: cd5 })}">
          </div>
          <div class="post-cardnote-body">
            <div class="post-cardnote-title">${escHtml_(name)}</div>
            <div class="post-cardnote-text">${textHtml}</div>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="post-cardnotes">${rows}</div>`;
  }

  function buildDeckCodeBoxFallback_(postId, code) {
    const codeNorm = String(code || '').trim();
    if (!codeNorm) return '';

    return `
      <div class="post-manage-box" data-postid="${escHtml_(postId)}">
        <div class="post-manage-head">
          <div class="deckcode-status">
            <div class="deckcode-title">デッキコード</div>
          </div>
        </div>
        <div class="post-manage-actions">
          <button type="button" class="modal-buttun btn-deckcode-copy" data-code="${escHtml_(codeNorm)}">コピー</button>
        </div>
      </div>
    `;
  }

  // =========================
  // 9) 詳細ペイン描画
  // =========================
function renderDetailPaneForItem(item, basePaneId, opts = {}) {
  const pane = document.getElementById(basePaneId || 'postDetailPane');
  if (!pane || !item) return;
  const snapshotMap = window.cardMap || {};

  const paneUid = `${basePaneId}-${String(item.postId || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const listMode = opts.listMode || ((basePaneId === 'postDetailPaneMine') ? 'mine' : 'list');
  const canEdit = (listMode === 'mine');

  const mainRace = getMainRace(item.races);
  const oldGod = getOldGodNameFromItem(item) || 'なし';
  const codeNorm = String(item.shareCode || '').trim();
  const repImg = item.repImg || '';
  const deckNote = item.deckNote || item.comment || '';
  const bg = raceBg(item.races);

  const postId = String(item?.postId || '').trim();

  // ✅ deck-post-detail.js 側の安全版
  const manageBoxHtml = canEdit
    ? (typeof window.DeckPostEditor?.buildDeckCodeBoxHtml_ === 'function'
        ? window.DeckPostEditor.buildDeckCodeBoxHtml_(postId, codeNorm)
        : buildDeckCodeBoxFallback_(postId, codeNorm))
    : '';

  // ✅ deck-post-detail.js 側の fallback 付き関数を使う
  const tagsMain = tagChipsMain_(item.tagsAuto, item.tagsPick);
  const tagsUser = tagChipsUser_(item.tagsUser);

  const posterXRaw = String(item.posterX || '').trim();
  const posterXUser = posterXRaw.startsWith('@') ? posterXRaw.slice(1) : posterXRaw;
  const posterXHtml = posterXUser ? `
    <a class="meta-x"
      href="https://x.com/${encodeURIComponent(posterXUser)}"
      target="_blank"
      rel="noopener noreferrer">
      ${escHtml_(posterXRaw)}
    </a>
  ` : '';

  const deckListHtml = buildDeckListHtml(item);
  const deckNoteHtml = buildDeckNoteHtml(deckNote);
  const cardNotesHtml = buildCardNotesHtml(item);

  const simpleStats = buildSimpleDeckStats(item);
  const typeChipsPane = buildTypeChipsHtml_(simpleStats);
  const rarityChipsPane = buildRarityChipsHtml_(item);
  const packChipsPane = buildPackChipsHtml_(item);

  const codeCopyBtnHtml = codeNorm ? `
    <div class="post-detail-code-body">
      <button type="button"
        class="btn-copy-code-wide"
        data-code="${escHtml_(codeNorm)}">
        デッキコードをコピー
      </button>
    </div>
  ` : '';

  const tabInfo = `
    <div class="post-detail-panel is-active" data-panel="info">
      <div class="post-detail-main">

        <div class="post-detail-main-top">
          <div class="post-detail-main-left">
            ${repImg ? `
              <img src="${repImg}"
                  class="post-detail-repimg"
                  alt="${escHtml_(item.title || '')}"
                  loading="lazy">
            ` : `
              <div style="width:100%;aspect-ratio:424/532;background:#eee;border-radius:10px;"></div>
            `}
          </div>

          <div class="post-detail-main-right">
            <header class="post-detail-header">
              <h2 class="post-detail-title">
                ${escHtml_(item.title || '(無題)')}
              </h2>

              <div class="post-detail-meta">
                <span>${escHtml_(item.posterName || item.username || '')}</span>
                ${posterXHtml ? `<span>/ ${posterXHtml}</span>` : ''}
                ${typeof window.fmtPostDates_ === 'function'
                  ? (window.fmtPostDates_(item) ? `<span>/ ${window.fmtPostDates_(item)}</span>` : '')
                  : ''
                }
              </div>

              <div class="post-detail-actions">
                <button type="button" class="btn-add-compare">比較に追加</button>
              </div>

              <div class="post-detail-tags">
                <div class="post-tags post-tags-main">${tagsMain}</div>
                <div class="post-tags post-tags-user">${tagsUser}</div>
              </div>
            </header>
          </div>
        </div>

        ${manageBoxHtml}

        <div class="post-detail-summary">
          <dt>デッキ枚数</dt><dd>${item.count || 0}枚</dd>
          <dt>種族</dt><dd>${escHtml_(mainRace || '')}</dd>
          <dt>旧神</dt><dd>${escHtml_(oldGod || 'なし')}</dd>

          ${typeChipsPane
            ? `<dt>タイプ構成</dt><dd><div class="post-detail-chips">${typeChipsPane}</div></dd>`
            : ''
          }

          ${rarityChipsPane
            ? `<dt>レアリティ構成</dt><dd><div class="post-detail-chips">${rarityChipsPane}</div></dd>`
            : ''
          }

          ${packChipsPane
            ? `<dt>パック構成</dt><dd><div class="post-detail-chips">${packChipsPane}</div></dd>`
            : ''
          }

          <dt>
            マナ効率
            <button type="button" class="help-button" aria-label="マナ効率の説明を確認">？</button>
          </dt>
          <dd class="mana-eff-row">
            <span id="mana-efficiency-${paneUid}" class="mana-eff">-</span>
            <span class="avg-charge-inline">
              （平均チャージ量：<span id="avg-charge-${escHtml_(paneUid)}">-</span>）
            </span>
          </dd>
        </div>

        <div class="deck-compare-block">
          <button type="button"
            class="deck-compare-toggle"
            aria-expanded="false"
            aria-label="所持カードデータから不足カードを確認"
            data-tooltip="所持率チェッカーのデータを参照して、このデッキの不足カードを確認します"
            title="所持率チェッカーのデータを参照して、このデッキの不足カードを確認します">
            不足カードを確認
          </button>
          <div class="deck-compare-result" hidden></div>
        </div>

        <div class="post-detail-charts" data-postcharts="${escHtml_(item.postId || '')}">
          <div class="post-detail-chartbox">
            <div class="post-detail-charthead">
              <div class="post-detail-charttitle">コスト分布</div>
              <div class="post-detail-chartchips" id="cost-summary-${escHtml_(paneUid)}"></div>
            </div>
            <div class="post-detail-chartcanvas">
              <canvas id="costChart-${escHtml_(paneUid)}"></canvas>
            </div>
          </div>

          <div class="post-detail-chartbox">
            <div class="post-detail-charthead">
              <div class="post-detail-charttitle">パワー分布</div>
              <div class="post-detail-chartchips" id="power-summary-${escHtml_(paneUid)}"></div>
            </div>
            <div class="post-detail-chartcanvas">
              <canvas id="powerChart-${escHtml_(paneUid)}"></canvas>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;

  const tabNote = `
    <div class="post-detail-panel" data-panel="note">
      <div class="post-detail-section">

        <div class="post-detail-heading-row">
          <div class="post-detail-heading">デッキ解説</div>

          ${canEdit ? `
            <div class="post-detail-heading-actions">
              <button type="button" class="btn-decknote-edit">編集</button>
            </div>
          ` : ''}
        </div>

        <div class="post-detail-body">
          <div class="decknote-view">
            ${deckNoteHtml || '<div style="color:#777;font-size:.9rem;">まだ登録されていません。</div>'}
          </div>

          ${canEdit ? `
            <div class="decknote-editor" hidden>
              <div class="note-preset-wrap note-preset-wrap--compact">
                <div class="note-toolbar">
                  <div class="note-presets-grid">
                    <button type="button" class="note-preset-menu-btn" data-preset-menu="templates">記事構成を追加</button>
                    <button type="button" class="note-preset-menu-btn" data-preset-menu="sections">解説項目</button>
                    <button type="button" class="note-card-ref-btn">文中にカードを追加</button>
                  </div>
                </div>
                <div class="note-preset-panel" hidden></div>
              </div>

              <div class="decknote-editor-hint">
                ※見出しを追加したり、文中にカード名を挿入できます。
              </div>

              <textarea class="decknote-textarea" rows="14"
                data-original="${escHtml_(deckNote || '')}"
              >${escHtml_(deckNote || '')}</textarea>

              <div class="decknote-editor-actions">
                <button type="button" class="btn-decknote-save">保存</button>
                <button type="button" class="btn-decknote-cancel">キャンセル</button>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  const tabCards = `
    <div class="post-detail-panel" data-panel="cards">
      <div class="post-detail-section">

        <div class="post-detail-heading-row post-detail-heading-row--cards">
          <div class="post-detail-heading">カード解説</div>

          ${canEdit ? `
            <div class="post-detail-heading-actions">
              <button type="button" class="btn-cardnotes-edit">編集</button>
            </div>
          ` : ''}
        </div>

        <div class="post-detail-body">
          <div class="cardnotes-view">
            ${cardNotesHtml}
          </div>

          ${canEdit ? `
            <div class="cardnotes-editor" hidden
                 data-original='${escHtml_(JSON.stringify(item.cardNotes || []))}'>
              <div class="info-value" style="width:100%">
                <div class="post-card-notes"></div>

                <input type="hidden" class="post-card-notes-hidden" value="${escHtml_(JSON.stringify(item.cardNotes || []))}">

                <input type="text" class="post-cardnote-validator" aria-hidden="true" tabindex="-1"
                  style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;border:none;padding:0;margin:0;">

                <div class="add-note-box">
                  <button type="button" id="add-card-note" class="add-note-btn">カード解説を追加</button>
                  <div class="post-hint" style="opacity:.8">※カードを選んで簡単な解説や採用理由を書けます</div>
                </div>

                <div class="decknote-editor-actions" style="margin-top:.6rem;">
                  <button type="button" class="btn-cardnotes-save">保存</button>
                  <button type="button" class="btn-cardnotes-cancel">キャンセル</button>
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  const tabsHtml = `
    <div class="post-detail-tabs">
      <button type="button" class="post-detail-tab is-active" data-tab="info">📘 デッキ情報</button>
      <button type="button" class="post-detail-tab" data-tab="note">📝 デッキ解説</button>
      <button type="button" class="post-detail-tab" data-tab="cards">🗂 カード解説</button>
    </div>
  `;

  pane.innerHTML = `
    <div class="post-detail-inner" data-postid="${escHtml_(item.postId || '')}" data-list-mode="${escHtml_(listMode)}" style="${bg ? `--race-bg:${bg};` : ''}">
      <div class="post-detail-maincol">
        ${tabsHtml}
        <div class="post-detail-body">
          ${tabInfo}
          ${tabNote}
          ${tabCards}
        </div>
      </div>

      <aside class="post-detail-deckcol">
        <div class="post-detail-section">
          <div class="post-detail-heading-row">
            <div class="post-detail-heading">デッキリスト</div>
            <div class="post-detail-heading-actions">
              <button type="button" class="btn-decklist-export">リスト保存</button>
            </div>
          </div>
          <div class="post-decklist-hint">
            👇 カードをタップすると詳細が表示されます
          </div>
          ${deckListHtml}
          ${codeCopyBtnHtml}
        </div>
      </aside>
    </div>
  `;

  const root = pane.querySelector('.post-detail-inner');

  if (root && window.matchMedia('(min-width: 1024px)').matches) {
    ensureCardDetailDockPc_(root);
  }

  if (root) {
    renderDeckAdjustmentNotice_(root, item, snapshotMap);
  }

  if (root) {
    const compareBtn = root.querySelector(
      '.post-detail-panel[data-panel="info"] .btn-add-compare'
    );

    if (compareBtn && !compareBtn.dataset.wired) {
      compareBtn.dataset.wired = '1';
      compareBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        alert('比較タブに追加する機能はベータ版では準備中です。');
      });
    }
  }

  try {
    renderPostDistCharts_(item, paneUid);
  } catch (e) {
    console.warn('renderPostDistCharts_ failed:', e);
  }

  refreshDeckPeekOnSp_();
}

  // 指定した記事要素に対して詳細ペインを表示する
  async function showDetailPaneForArticle(articleEl) {
    const art = articleEl?.closest?.('.post-card') || articleEl;
    if (!art) return;

    const postId = String(art.dataset.postid || '').trim();
    if (!postId) return;

    let item = findItemById_(postId);
    if (!item) return;

    if (!hasDetailPayload_(item)) {
      try {
        item = await ensurePostDetailData_(postId);
      } catch (e) {
        console.warn('showDetailPaneForArticle: apiGetPost failed', e);
      }
    }

    const listMode = art.dataset.listMode || (art.closest('#myPostList') ? 'mine' : 'list');
    const usesMinePane = !!art.closest('#myPostList, #pageMine');
    const basePaneId = usesMinePane ? 'postDetailPaneMine' : 'postDetailPane';

    withCardMapForPostDate_(item, () => renderDetailPaneForItem(item, basePaneId, { listMode }));

    document.querySelectorAll('.post-card.is-active').forEach((el) => {
      el.classList.remove('is-active');
    });
    art.classList.add('is-active');
  }

  function findPostItemById(postId) {
    return findItemById_(postId);
  }

  function getVisibleSpDetailContext_() {
    const roots = Array.from(
      document.querySelectorAll('.post-card--sp .post-detail:not([hidden]) .post-detail-inner')
    );
    if (!roots.length) return null;

    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const visible = roots
      .map((root) => {
        const article = root.closest('.post-card--sp');
        const rect = article?.getBoundingClientRect?.();
        if (!article || !rect) return null;
        const intersects = rect.bottom > 0 && rect.top < vh;
        if (!intersects) return null;
        const distance = Math.abs(rect.top);
        return { root, article, rect, distance };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);

    return visible[0] || null;
  }

  function getActiveDetailRoot_() {
    const sp = getVisibleSpDetailContext_();
    if (sp?.root) return sp.root;

    const minePage = document.getElementById('pageMine');
    if (minePage && !minePage.hidden) {
      return document.querySelector('#postDetailPaneMine .post-detail-inner');
    }
    return document.querySelector('#postDetailPane .post-detail-inner');
  }

  function buildDeckPeekEntries_(item) {
    const deck = extractDeckMap(item);
    if (!deck || !Object.keys(deck).length) return [];

    const cardMap = window.cardMap || {};
    const entries = window.sortCardEntries?.(Object.entries(deck), cardMap) || Object.entries(deck);
    return entries.map(([cd, n]) => ({
      code: normCd5_(cd),
      count: n,
    }));
  }

  function refreshDeckPeekOnSp_() {
    window.__deckPostPeekController?.refresh?.();
  }

  /**
   * SPカード内の詳細表示を開閉する
   */
  function ensurePostDeckPeekOverlay_() {
    let overlay = document.getElementById('post-deckpeek-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'post-deckpeek-overlay';
    overlay.innerHTML = `
      <div class="post-deckpeek-inner">
        <div class="post-deckpeek-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function hidePostDeckPeek_() {
    const overlay = document.getElementById('post-deckpeek-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    delete overlay.dataset.postid;
    overlay.style.left = '';
    overlay.style.top = '';
    overlay.style.right = '';
    overlay.style.bottom = '';
    overlay.style.width = '';
  }

  function showPostDeckPeekForArticle_(art, thumbEl) {
    if (!window.matchMedia('(max-width: 1023px)').matches) return;

    const postId = String(art?.dataset?.postid || '').trim();
    if (!postId) return;

    const item = findItemById_(postId);
    if (!item) return;

    const overlay = ensurePostDeckPeekOverlay_();
    const body = overlay.querySelector('.post-deckpeek-body');
    if (!body) return;

    overlay.dataset.postid = postId;
    body.innerHTML = buildDeckListHtml(item);
    overlay.style.display = 'block';
    overlay.style.left = '';
    overlay.style.top = '';
    overlay.style.right = '8px';
    overlay.style.bottom = '20px';
    overlay.style.width = '';

    if (!thumbEl) return;

    const rect = thumbEl.getBoundingClientRect();
    const margin = 8;
    const availableRight = Math.max(160, window.innerWidth - rect.right - margin - 8);
    const maxWidth = Math.min(availableRight, 360);

    overlay.style.width = `${maxWidth}px`;

    const overlayWidth = overlay.offsetWidth || maxWidth;
    const overlayHeight = overlay.offsetHeight || 0;

    let left = rect.right + margin;
    let top = rect.top;

    if (left + overlayWidth > window.innerWidth - margin) {
      left = Math.max(margin, rect.left - overlayWidth - margin);
    }
    if (left < margin) left = margin;

    if (top + overlayHeight > window.innerHeight - margin) {
      top = window.innerHeight - margin - overlayHeight;
    }
    if (top < margin) top = margin;

    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
  }

  async function toggleSpDetail_(articleEl) {
    let art = articleEl;
    let d = art?.querySelector('.post-detail');
    if (!art || !d) return;

    const willOpen = !!d.hidden;
    d.hidden = !d.hidden;

    // 開いた直後だけ、分布グラフを描画する
    if (willOpen && !d.dataset.chartsRendered) {
      const postId = String(art.dataset.postid || '').trim();
      let item = findPostItemById(postId);
      if (item && !hasDetailPayload_(item)) {
        try {
          item = await ensurePostDetailData_(postId);
        } catch (err) {
          console.warn('toggleSpDetail_: apiGetPost failed', err);
        }

        const listMode = art.dataset.listMode || (art.closest('#myPostList') ? 'mine' : 'list');
        const replacement = item && window.buildCardSp?.(item, { mode: listMode });
        if (replacement) {
          art.replaceWith(replacement);
          art = replacement;
          d = art.querySelector('.post-detail');
          if (!d) return;
          d.hidden = false;
        }
      }

      const charts = art.querySelector('.post-detail-charts');
      const paneUid = String(charts?.dataset?.paneid || '').trim();
      const root = art.querySelector('.post-detail-inner');

      if (item && root) {
        renderDeckAdjustmentNoticeForPostDate_(root, item);
      }

      if (item && paneUid) {
        requestAnimationFrame(() => {
          try {
            const ok = renderPostDistCharts_(item, paneUid);
            if (ok && d) d.dataset.chartsRendered = '1';
          } catch (err) {
            console.warn('SP renderPostDistCharts_ failed:', err);
          }
        });
      } else {
        console.warn('SP charts skipped: item or paneUid missing', {
          postId,
          hasItem: !!item,
          paneUid,
        });
      }
    }
  }

  function isElementInViewport_(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false;
    const rect = element.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.bottom > 0 && rect.top < vh;
  }


  function getDeckPeekContext_() {
    const sp = getVisibleSpDetailContext_();
    if (sp?.root) {
      const decklist = sp.root.querySelector('.post-decklist');
      return {
        root: sp.root,
        postId: String(sp.root.dataset?.postid || '').trim(),
        decklist,
      };
    }

    const root = getActiveDetailRoot_();
    const decklist = root?.querySelector('.post-decklist') || null;
    return {
      root,
      postId: String(root?.dataset?.postid || '').trim(),
      decklist,
    };
  }

  function isDeckPeekTargetVisible_(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false;
    const rect = element.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.bottom > 0 && rect.top < vh;
  }

  // =========================
  // 10) SPデッキpeek
  // =========================
  function setupDeckPeekOnSp() {
    if (window.__deckPostPeekBound) return;
    window.__deckPostPeekBound = true;

    if (window.DeckPeekCommon?.createController) {
      window.__deckPostPeekController = window.DeckPeekCommon.createController({
        buttonId: 'deckpeek-button',
        overlayId: 'deckpeek-overlay',
        gridId: 'deckpeek-grid',
        buttonText: 'デッキ表示',
        mediaQuery: '(max-width: 1023px)',

        // 「見えているか」を判定したい対象はデッキリスト本体
        resolveTarget: () => getDeckPeekContext_().decklist,

        // ボタンを出していい前提条件は「今その投稿詳細を見ているか」
        isEnabled: () => {
          const ctx = getDeckPeekContext_();
          return !!ctx.root && isElementInViewport_(ctx.root);
        },

        // 監視対象がなくても root が見えていれば出せるようにする
        canShowButton: () => {
          const ctx = getDeckPeekContext_();
          return !!ctx.root && isElementInViewport_(ctx.root);
        },

        // デッキリスト本体が画面内に見えていたらボタンを消す
        getIntersectingState: (target) => isDeckPeekTargetVisible_(target),

        render: ({ grid }) => {
          const postId = getDeckPeekContext_().postId;
          const item = postId ? findItemById_(postId) : null;
          const items = item ? buildDeckPeekEntries_(item) : [];
          window.DeckPeekCommon.renderGrid(grid, items, {
            emptyText: 'デッキリスト未登録',
          });
        },
      });

      document.addEventListener('click', () => {
        window.setTimeout(refreshDeckPeekOnSp_, 0);
      }, true);

      refreshDeckPeekOnSp_();
      return;
    }
  }


    /**
   * 詳細UI初期化
   * - SPデッキpeek配線
   */
  function init() {
    setupDeckPeekOnSp();

    if (!window.__postDeckPeekOverlayBound) {
      window.__postDeckPeekOverlayBound = true;

      document.addEventListener('click', (e) => {
        const overlay = document.getElementById('post-deckpeek-overlay');
        if (!overlay) return;
        if (e.target === overlay) hidePostDeckPeek_();
      });

      document.addEventListener('click', (e) => {
        const overlay = document.getElementById('post-deckpeek-overlay');
        if (!overlay || overlay.style.display === 'none') return;
        if (e.target.closest('#post-deckpeek-overlay')) return;
        if (e.target.closest('.post-card--sp .thumb-box')) return;
        hidePostDeckPeek_();
      }, true);

      window.addEventListener('scroll', hidePostDeckPeek_, { passive: true });
      window.addEventListener('resize', hidePostDeckPeek_);
    }
  }

  function toggleDeckChipHighlight_(chip, kind) {
    const root = chip.closest('.post-detail-inner') || document;
    const decklist = root.querySelector('.post-decklist');
    if (!decklist) return false;

    const compareBtn = root.querySelector('.deck-compare-toggle.is-active');
    const compareResult = root.querySelector('.deck-compare-result');
    if (compareBtn) {
      setDeckCompareButtonActive_(compareBtn, false);
    }
    if (compareResult) {
      compareResult.hidden = true;
      compareResult.innerHTML = '';
    }
    root.querySelectorAll('.deck-entry.shortage-hl')
      .forEach((el) => {
        el.classList.remove('shortage-hl');
        el.querySelector('.shortage-badge')?.remove();
      });
    decklist.classList.remove('is-shortage-focus');

    const chipSelector = kind === 'rarity' ? '.rarity-chip' : '.pack-chip';
    const activeSelector = `${chipSelector}.is-active`;
    const attrName = kind === 'rarity' ? 'rarity' : 'pack';
    const value = chip.dataset[attrName] || null;

    if (chip.classList.contains('is-active')) {
      root.querySelectorAll(activeSelector)
        .forEach((el) => el.classList.remove('is-active'));
      root.querySelectorAll('.deck-entry.pack-hl')
        .forEach((el) => el.classList.remove('pack-hl'));
      decklist.classList.remove('is-pack-focus', 'is-rarity-focus');
      return true;
    }

    root.querySelectorAll('.pack-chip.is-active, .rarity-chip.is-active')
      .forEach((el) => el.classList.remove('is-active'));
    root.querySelectorAll('.deck-entry.pack-hl')
      .forEach((el) => el.classList.remove('pack-hl'));

    if (!value) return true;

    const safeValue = window.CSS?.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
    chip.classList.add('is-active');
    root.querySelectorAll(`.deck-entry[data-${attrName}="${safeValue}"]`)
      .forEach((el) => el.classList.add('pack-hl'));
    decklist.classList.toggle('is-pack-focus', kind === 'pack');
    decklist.classList.toggle('is-rarity-focus', kind === 'rarity');
    return true;
  }

  // =========================
  // 11) イベント委譲
  // =========================
  document.addEventListener('click', async (e) => {
    // -------------------------
    // 1) 右ペイン：タブ切り替え
    // -------------------------
    const tab = e.target.closest('.post-detail-tab');
    if (tab) {
      const rootEl = tab.closest('.post-detail-inner');
      const key = String(tab.dataset.tab || '').trim();
      if (rootEl && key) {
        rootEl.querySelectorAll('.post-detail-tab').forEach((btn) => {
          btn.classList.toggle('is-active', btn === tab);
        });
        rootEl.querySelectorAll('.post-detail-panel').forEach((panel) => {
          panel.classList.toggle('is-active', panel.dataset.panel === key);
        });
      }
      return;
    }

    // -------------------------
    // 2) デッキコードコピー（横長ボタン）
    // -------------------------
    const wideCopy = e.target.closest('.btn-copy-code-wide');
    if (wideCopy) {
      const code = String(wideCopy.dataset.code || '').trim();
      if (code && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(code);
          if (typeof window.showCodeCopyToast === 'function') {
            window.showCodeCopyToast();
          } else if (typeof window.showMiniToast_ === 'function') {
            window.showMiniToast_('デッキコードをコピーしました');
          }
        } catch (_) {}
      }
      return;
    }

    // -------------------------
    // 3) SP：詳細を開く
    // -------------------------
    const thumbBox = e.target.closest('.post-card--sp .thumb-box');
    if (thumbBox) {
      const art = thumbBox.closest('.post-card');
      const overlay = document.getElementById('post-deckpeek-overlay');
      const postId = String(art?.dataset?.postid || '').trim();
      e.preventDefault();
      e.stopPropagation();
      if (overlay && overlay.style.display !== 'none' && String(overlay.dataset.postid || '') === postId) {
        hidePostDeckPeek_();
        return;
      }
      showPostDeckPeekForArticle_(art, thumbBox);
      return;
    }

    const detailBtn = e.target.closest('.btn-detail');
    if (detailBtn) {
      const art = detailBtn.closest('.post-card');
      const d = art?.querySelector('.post-detail');
      if (!art || !d) return;

      const willOpen = !!d.hidden;
      d.hidden = !d.hidden;

      // 開いた瞬間だけ、分布グラフを描画
      if (willOpen && !d.dataset.chartsRendered) {
        const postId = String(art.dataset.postid || '').trim();
        const item = findPostItemById(postId);
        const charts = art.querySelector('.post-detail-charts');
        const paneUid = String(charts?.dataset?.paneid || '').trim();
        const root = art.querySelector('.post-detail-inner');

        if (item && root) {
          renderDeckAdjustmentNoticeForPostDate_(root, item);
        }

        if (item && paneUid) {
          requestAnimationFrame(() => {
            try {
              const ok = renderPostDistCharts_(item, paneUid);
              if (ok) d.dataset.chartsRendered = '1';
            } catch (err) {
              console.warn('SP renderPostDistCharts_ failed:', err);
            }
          });
        } else {
          console.warn('SP charts skipped: item or paneUid missing', {
            postId,
            hasItem: !!item,
            paneUid,
          });
        }
      }
      return;
    }

    // -------------------------
    // 4) SP：詳細を閉じる
    // -------------------------
    const detailCloseBtn = e.target.closest('.btn-detail-close');
    if (detailCloseBtn) {
      const art = detailCloseBtn.closest('.post-card');
      const d = art?.querySelector('.post-detail');
      if (d) d.hidden = true;
      art?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    // -------------------------
    // 5) デッキ解説内カード参照 → カード詳細
    // -------------------------
    const decknoteCardRef = e.target.closest('.decknote-card-ref');
    if (decknoteCardRef) {
      const cd = normCd5_(decknoteCardRef.dataset.cd);
      if (cd) {
        e.preventDefault();
        e.stopPropagation();
        const anchorRect = decknoteCardRef.getBoundingClientRect();
        if (typeof window.openCardDetailModal === 'function') {
          window.openCardDetailModal(cd, { anchorRect });
        } else {
          document.dispatchEvent(new CustomEvent('open-card-detail', {
            detail: { cardId: cd, anchorRect }
          }));
        }
      }
      return;
    }

    // -------------------------
    // 6) デッキ内カード → カード詳細
    // -------------------------
    const deckEntry = e.target.closest('.post-detail-inner .deck-entry');
    if (deckEntry) {
      const cd = normCd5_(deckEntry.dataset.cd);
      if (cd) {
        e.preventDefault();
        e.stopPropagation();
        openCardDetailFromDeck_(cd, deckEntry);
      }
      return;
    }

    // -------------------------
    // 7) カード詳細を閉じる
    // -------------------------
    const closeBtn = e.target.closest('.carddetail-close');
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      closeCardDetail_();
      return;
    }

    const zoomBtn = e.target.closest('.carddetail-meta .detail-zoom-btn');
    if (zoomBtn) {
      const cd = normCd5_(zoomBtn.dataset.cd);
      if (cd) {
        e.preventDefault();
        e.stopPropagation();
        window.CardZoomModal?.open?.(cd);
      }
      return;
    }

    const thumbImg = e.target.closest('.carddetail-thumb-img');
    if (thumbImg) {
      const cd = normCd5_(thumbImg.dataset.cd);
      if (cd) {
        e.preventDefault();
        e.stopPropagation();
        window.CardZoomModal?.open?.(cd);
      }
      return;
    }

    // -------------------------
    // 7) 比較に追加（仮）
    // -------------------------
    const deckCompareBtn = e.target.closest('.post-detail-inner .deck-compare-toggle');
    if (deckCompareBtn) {
      e.preventDefault();
      e.stopPropagation();
      await handleDeckCompareClick_(deckCompareBtn);
      return;
    }

    const compareBtn = e.target.closest('.btn-add-compare');
    if (compareBtn) {
      e.preventDefault();
      e.stopPropagation();
      alert('比較タブに追加する機能はベータ版では準備中です。');
      return;
    }

    // -------------------------
    // 8) 構成チップ → デッキ内カード強調
    // -------------------------
    const rarityChip = e.target.closest('.post-detail-inner .rarity-chip');
    if (rarityChip) {
      toggleDeckChipHighlight_(rarityChip, 'rarity');
      return;
    }

    const chip = e.target.closest('.post-detail-inner .pack-chip');
    if (chip) {
      toggleDeckChipHighlight_(chip, 'pack');
      return;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCardDetail_();
      hidePostDeckPeek_();
      const peek = document.getElementById('deckpeek-overlay');
      if (peek) peek.style.display = 'none';
      return;
    }

    const entry = e.target.closest?.('.post-detail-inner .deck-entry');
    if (entry && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const cd = normCd5_(entry.dataset.cd);
      if (cd) openCardDetailFromDeck_(cd, entry);
    }

    // 構成チップ → デッキ内カード強調
    const rarityChip = e.target.closest?.('.rarity-chip');
    if (rarityChip && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleDeckChipHighlight_(rarityChip, 'rarity');
      return;
    }

    const packChip = e.target.closest?.('.pack-chip');
    if (packChip && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleDeckChipHighlight_(packChip, 'pack');
      return;
    }

  });



  // =========================
  // 12) 外部公開
  // =========================
  window.DeckPostDetail = window.DeckPostDetail || {};
  window.DeckPostDetail.el = window.createElementFromHTML;
  window.DeckPostDetail.escHtml_ = escHtml_;
  window.DeckPostDetail.nl2br_ = nl2br_;
  window.DeckPostDetail.cardThumb = cardThumb;
  window.DeckPostDetail.getMainRace = getMainRace;
  window.DeckPostDetail.raceBg = raceBg;
  window.DeckPostDetail.extractDeckMap = extractDeckMap;
  window.DeckPostDetail.getOldGodNameFromItem = getOldGodNameFromItem;
  window.DeckPostDetail.renderPostDistCharts_ = renderPostDistCharts_;
  window.DeckPostDetail.packNameEn_ = packNameEn_;
  window.DeckPostDetail.packAbbr_ = packAbbr_;
  window.DeckPostDetail.packKeyFromAbbr_ = packKeyFromAbbr_;
  window.DeckPostDetail.getPackOrder_ = getPackOrder_;
  window.DeckPostDetail.buildDeckListHtml = buildDeckListHtml;

  window.DeckPostDetail.rarityKeyForPage4_ = rarityKeyForPage4_;
  window.DeckPostDetail.rarityPillClassForPage4_ = rarityPillClassForPage4_;
  window.DeckPostDetail.rarityLabelForPage4_ = rarityLabelForPage4_;
  window.DeckPostDetail.findItemById_ = findItemById_;
  window.DeckPostDetail.withCardMapForPostDate_ = withCardMapForPostDate_;
  window.DeckPostDetail.parseJstDate_ = parseJstDate_;

  window.DeckPostDetail.buildCardDetailHtml_ = buildCardDetailHtml_;
  window.DeckPostDetail.closeCardDetail_ = closeCardDetail_;
  window.DeckPostDetail.ensureCardDetailDockPc_ = ensureCardDetailDockPc_;
  window.DeckPostDetail.ensureCardDetailDrawerSp_ = ensureCardDetailDrawerSp_;
  window.DeckPostDetail.openCardDetailFromDeck_ = openCardDetailFromDeck_;

  window.DeckPostDetail.buildSimpleDeckStats = buildSimpleDeckStats;
  window.DeckPostDetail.buildTypeChipsHtml_ = buildTypeChipsHtml_;
  window.DeckPostDetail.buildRarityMixText_ = buildRarityMixText_;
  window.DeckPostDetail.buildRarityMixCounts_ = buildRarityMixCounts_;
  window.DeckPostDetail.buildRarityChipsHtml_ = buildRarityChipsHtml_;
  window.DeckPostDetail.buildPackMixCounts_ = buildPackMixCounts_;
  window.DeckPostDetail.buildPackChipsHtml_ = buildPackChipsHtml_;

  window.DeckPostDetail.buildDeckNoteHtml = buildDeckNoteHtml;
  window.DeckPostDetail.buildCardNotesHtml = buildCardNotesHtml;
  window.DeckPostDetail.renderDetailPaneForItem = renderDetailPaneForItem;
  window.DeckPostDetail.showDetailPaneForArticle = showDetailPaneForArticle;
  window.DeckPostDetail.findPostItemById = findPostItemById;
  window.DeckPostDetail.setupDeckPeekOnSp = setupDeckPeekOnSp;
  window.DeckPostDetail.init = init;
})();
