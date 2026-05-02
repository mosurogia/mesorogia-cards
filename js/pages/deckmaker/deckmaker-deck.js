// js/pages/deckmaker/deckmaker-deck.js
/**
 * DeckMaker / Deck Core (page-only)
 *
 * 【役割】
 * - deck（{cd:count}）の管理（追加/削除/更新）
 * - デッキバー（上部横スクロール）の描画
 * - 一覧（.card）側の「使用中」「グレースケール」反映
 * - PC：ホバーでカード画像プレビュー
 * - Mobile：上フリック追加 / 下フリック削除 / 長押しでプレビュー
 * - オートセーブ（localStorage: deck_autosave_v1）
 * - デッキサマリー開閉ボタン（#deck-summary）
 *
 * 【依存（存在すれば使う）】
 * - window.cardMap
 * - window.applyGrayscaleFilter
 * - window.updateDeckSummary / updateDeckAnalysis / updateExchangeSummary / updateDeckCardListBackground / updateAutoTags
 * - window.renderPostSelectTags
 * - window.readDeckNameInput / writeDeckNameInput
 * - window.readPostNote / writePostNote
 * - window.formatYmd
 * - autoscaleBadgeForCardEl / autoscaleAllBadges（表示補助）
 *
 * 【公開API】
 * - window.deck
 * - window.addCard / removeCard / updateDeck / updateCardDisabling
 * - window.MAIN_RACES / getMainRacesInDeck / computeMainRace / getMainRace / getRaceType
 * - window.withDeckBarScrollKept / scheduleAutosave / maybeRestoreFromStorage
 * - window.toggleDeckSummary
 */
(function () {
  'use strict';

  // =========================
  // 定数
  // =========================
  const IMG_DIR = 'img/';
  const FALLBACK_IMG = IMG_DIR + '00000.webp';

  // メイン種族（統一版）
  const MAIN_RACES = ['ドラゴン', 'アンドロイド', 'エレメンタル', 'ルミナス', 'シェイド'];
  const RACE_KEY_MAP = {
    'ドラゴン': 'DRAGON',
    'アンドロイド': 'ANDROID',
    'エレメンタル': 'ELEMENTAL',
    'ルミナス': 'LUMINOUS',
    'シェイド': 'SHADE',
    'イノセント': 'INN',
    '旧神': 'OLD',
  };

  // =========================
  // 状態
  // =========================
  const deck = window.deck || (window.deck = {});
  let representativeCd = null; // 今は保存に載せるだけ（表示/変更は別ファイル想定）

  // =========================
  // デッキ名管理
  // info/post/titleの3箇所に同じ値を反映する
  // =========================

  // ---- 内部：3箇所（info/post/title）へ同じ値を反映 ----
  function __dmSetDeckNameAll_(val) {
    const v = String(val ?? '');

    const info = document.getElementById('info-deck-name');
    const post = document.getElementById('post-deck-name');
    const title = document.getElementById('note-side-title');

    if (info && info.value !== v) info.value = v;
    if (post && post.value !== v) post.value = v;
    if (title) title.textContent = v; // 空なら空文字（CSS :empty::before で “デッキリスト”）
  }

  // 未定義なら定義（他ファイルで実装している場合に上書きしない）
  window.readDeckNameInput ??= function () {
    const info = document.getElementById('info-deck-name')?.value?.trim() || '';
    const post = document.getElementById('post-deck-name')?.value?.trim() || '';
    return post || info || '';
  };

  window.writeDeckNameInput ??= function (name) {
    __dmSetDeckNameAll_(String(name ?? ''));
  };

  // 外部からの同期（復元ボタン、保存デッキ読み込み後などで呼ぶ）
  window.syncDeckNameFields ??= function () {
    const info = document.getElementById('info-deck-name')?.value?.trim() || '';
    const post = document.getElementById('post-deck-name')?.value?.trim() || '';
    const name = post || info || '';
    __dmSetDeckNameAll_(name);
  };

  // =========================
  // ユーティリティ
  // =========================
  function normCd5(cd) {
    if (typeof window.normCd5 === 'function' && window.normCd5 !== normCd5) return window.normCd5(cd);
    const s = String(cd ?? '').trim();
    return s ? s.padStart(5, '0').slice(0, 5) : '';
  }
  window.normCd5 ??= normCd5;

  function imgSrcOf(cd) {
    return IMG_DIR + normCd5(cd) + '.webp';
  }

  function getCard(cd) {
    return window.cardMap?.[normCd5(cd)] || window.cardMap?.[String(cd)] || null;
  }

  // デッキのカードをソートして返す（表示用）
  function getDeckEntriesSorted() {
    return window.sortCardEntries?.(Object.entries(deck), window.cardMap || {}) || Object.entries(deck);
  }

  function exportDeckCode() {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(deck || {}))));
    } catch (_) {
      return '';
    }
  }

  function syncGeneratedDeckCode_() {
    const deckCodeEl = document.getElementById('post-deck-code');
    if (!deckCodeEl) return;
    deckCodeEl.value = exportDeckCode();
  }

  // デッキ更新時にスクロール位置を保つ補助
  function withDeckBarScrollKept(fn) {
    const wrapper = document.querySelector('.deck-bar-scroll');
    const x = wrapper ? wrapper.scrollLeft : 0;
    try {
      fn();
    } finally {
      if (wrapper) wrapper.scrollLeft = x;
    }
  }

  // =========================
  // 起動時：ページ専用の小物初期化
  // - loader後読み込みでも確実に動くよう onDeckmakerReady を使う
  // =========================
  function initPageExtras_() {
    // --- スクショ最小パネル ---
    window.initScreenshotPanel?.({ keyPrefix: 'deckmaker' });

    // --- デッキバー右クリック抑制 ---
    if (!document.__dmDeckbarContextmenuBound) {
      document.__dmDeckbarContextmenuBound = true;
      document.addEventListener('contextmenu', (e) => {
        const deckBarTop = document.getElementById('deckBarTop');
        if (deckBarTop && deckBarTop.contains(e.target)) e.preventDefault();
      });
    }

    // --- カードプレビュー関連（不足カード表示で消す） ---
    const shortageBtn = document.getElementById('shortage-toggle-btn');
    if (shortageBtn && !shortageBtn.dataset.previewHideBound) {
      shortageBtn.dataset.previewHideBound = '1';
      shortageBtn.addEventListener('click', () => {
        window.CardPreview?.hide?.();
        window.hideCardPreview?.();
      });
    }

    // deckTabSwitched は document に対して 1回だけバインド（多重登録防止）
    if (!document.__dmDeckTabPreviewHideBound) {
      document.__dmDeckTabPreviewHideBound = true;
      document.addEventListener('deckTabSwitched', () => {
        window.CardPreview?.hide?.();
        window.hideCardPreview?.();
      });
    }

    // --- デッキ名 同期 & note-side-title その場編集 ---
    (function initDeckNameSyncAndInlineEdit_() {
      const infoNameEl = document.getElementById('info-deck-name');
      const postNameEl = document.getElementById('post-deck-name');
      const titleEl    = document.getElementById('note-side-title');
      if (!infoNameEl && !postNameEl && !titleEl) return;

      // 多重バインド防止
      if (document.__dmDeckNameSyncBound) return;
      document.__dmDeckNameSyncBound = true;

      // 入力欄→相互反映（trimして同期）
      const onInfoInput = () => {
        const v = (infoNameEl?.value || '').trim();
        window.writeDeckNameInput?.(v);
        window.scheduleAutosave?.();
      };
      const onPostInput = () => {
        const v = (postNameEl?.value || '').trim();
        window.writeDeckNameInput?.(v);
        window.scheduleAutosave?.();
      };

      infoNameEl?.addEventListener('input', onInfoInput);
      postNameEl?.addEventListener('input', onPostInput);

      // ===== タイトルをその場編集 =====
      function selectAll_(el){
        const r = document.createRange();
        r.selectNodeContents(el);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }

      function beginEdit_(){
        if (!titleEl || titleEl.isContentEditable) return;
        titleEl.dataset.prev = (titleEl.textContent || '').trim();
        titleEl.contentEditable = 'true';
        titleEl.focus();
        selectAll_(titleEl);
      }

      function commitEdit_(ok=true){
        if (!titleEl || !titleEl.isContentEditable) return;
        titleEl.contentEditable = 'false';
        const next = ok ? (titleEl.textContent || '').trim() : (titleEl.dataset.prev || '');
        window.writeDeckNameInput?.(next);  // info/post/title 全部更新（空なら“デッキリスト”）
        window.scheduleAutosave?.();
      }

      titleEl?.addEventListener('click', () => {
        if (titleEl.isContentEditable) return;
        beginEdit_();
      });

      titleEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitEdit_(true); }
        else if (e.key === 'Escape') { e.preventDefault(); commitEdit_(false); }
      });

      titleEl?.addEventListener('blur', () => commitEdit_(true));

      // 初期同期（空なら空＝“デッキリスト”）
      window.syncDeckNameFields?.();
    })();

    // デッキリセットボタン
    if (!document.__dmResetDeckBound) {
      document.__dmResetDeckBound = true;
      document.querySelectorAll('#resetDeckButton').forEach((btn) => {
        btn.addEventListener('click', () => {
          window.resetDeckState?.();
        });
      });
    }
  }

  // loader起点で初期化（DOMContentLoaded取り逃がし対策）
  if (typeof window.onDeckmakerReady === 'function') {
    window.onDeckmakerReady(initPageExtras_);
  } else {
    // フォールバック：万一loaderより先に読まれた場合
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', initPageExtras_, { once: true });
    } else {
      initPageExtras_();
    }
  }


  // =========================
  // 種族ユーティリティ（公開）
  // =========================
  function getMainRacesInDeck() {
    const races = Object.keys(deck)
      .map(cd => getCard(cd)?.race)
      .filter(r => MAIN_RACES.includes(r));
    return [...new Set(races)];
  }

  function computeMainRace() {
    const arr = getMainRacesInDeck();
    if (arr.length <= 1) return arr[0] || null;
    for (const r of MAIN_RACES) if (arr.includes(r)) return r;
    return arr[0] || null;
  }

  function getMainRace() {
    return getMainRacesInDeck()[0] || null;
  }

  function getAllRacesInDeck() {
    const races = Object.keys(deck)
      .map(cd => getCard(cd)?.race)
      .filter(Boolean);
    return [...new Set(races)];
  }

  function getRaceCode() {
    const raceCodeMap = {
      'ドラゴン': 1,
      'アンドロイド': 2,
      'エレメンタル': 3,
      'ルミナス': 4,
      'シェイド': 5,
    };
    return raceCodeMap[getMainRace()] || 1;
  }

  function buildRaceKey() {
    const races = getAllRacesInDeck();
    return races
      .map(r => RACE_KEY_MAP[String(r).trim()] || '')
      .filter(Boolean)
      .join('+');
  }

  function syncPostRaceFields_() {
    const races = getMainRacesInDeck();
    const racesEl = document.getElementById('post-races-hidden');
    if (racesEl) racesEl.value = races.join(',');
  }

  function getRaceType(race) {
    if (!race) return '';
    if (race === '旧神') return 'old';
    if (race === 'イノセント') return 'sub';
    if (MAIN_RACES.includes(race)) return 'main';
    return 'sub';
  }

  // =========================
  // 追加/削除（制約チェック含む）
  // =========================
  function canAddCard_(cd) {
    const card = getCard(cd);
    if (!card) return false;

    // 最大枚数判定（旧神は1枚、それ以外は最大3枚。ただしリンクカードは共有）
    const groupKey = card.link ? String(card.linkCd) : String(normCd5(cd));
    let totalGroupCount = 0;

    for (const [id, count] of Object.entries(deck)) {
      const other = getCard(id);
      if (!other) continue;
      const otherGroup = other.link ? String(other.linkCd) : String(normCd5(id));
      if (otherGroup === groupKey) totalGroupCount += count;
    }
    if (totalGroupCount >= 3) return false;

    // 旧神は1種1枚まで
    if (card.race === '旧神') {
      if ((deck[normCd5(cd)] || 0) >= 1) return false;
      const hasOtherOldGod = Object.keys(deck).some(id => getCard(id)?.race === '旧神' && normCd5(id) !== normCd5(cd));
      if (hasOtherOldGod) return false;
    }

    // メイン種族は1種類のみ（イノセント/旧神は含めない）
    if (getRaceType(card.race) === 'main') {
      const currentMainRaces = getMainRacesInDeck();
      const unique = new Set([...currentMainRaces, card.race]);
      if (unique.size > 1) return false;
    }

    return true;
  }
  function addCard(cd) {
    const cd5 = normCd5(cd);
    if (!canAddCard_(cd5)) return;

    deck[cd5] = (deck[cd5] || 0) + 1;

    withDeckBarScrollKept(updateDeck);
    window.applyGrayscaleFilter?.();
    scheduleAutosave();
  }
  function removeCard(cd, { soft = false } = {}) {
    const cd5 = normCd5(cd);
    const cur = Number(deck[cd5] || 0);
    const next = Math.max(0, cur - 1);

    if (next === 0) delete deck[cd5];
    else deck[cd5] = next;

    withDeckBarScrollKept(updateDeck);
    window.applyGrayscaleFilter?.();
    scheduleAutosave();
  }

  // =========================
  // デッキバー描画（上部横スクロール）
  // =========================
  function buildDeckCardsForAnalysis_() {
    const deckCards = [];
    for (const [cd, count] of Object.entries(deck)) {
      const card = getCard(cd);
      if (!card) continue;
      for (let i = 0; i < count; i++) deckCards.push({ 種族: card.race, タイプ: card.type });
    }
    return deckCards;
  }

  // =========================
  // デッキ情報（分析＆投稿タブ側のサマリー）更新
  // =========================
  function updateDeckSummary(deckCards) {
    const cards = Array.isArray(deckCards) ? deckCards : [];

    // 枚数
    const deckCount = String(cards.length);
    const infoDeckCountEl = document.getElementById('info-deck-count');
    const postDeckCountEl = document.getElementById('post-deck-count');
    if (infoDeckCountEl) infoDeckCountEl.textContent = deckCount;
    if (postDeckCountEl) postDeckCountEl.textContent = deckCount;

    // メイン種族（イノセント・旧神を除外）
    const races = [...new Set(cards.map(c => c?.種族))].filter(
      r => r && r !== 'イノセント' && r !== '旧神'
    );
    const deckRacesEl = document.getElementById('deck-races');
    if (deckRacesEl) deckRacesEl.textContent = races[0] || '未選択';

    // 旧神の表示（採用されている旧神1種類のみ表示）
    const elderEl = document.getElementById('deck-eldergod');
    if (elderEl) {
      const hasOldGod = cards.some(c => c?.種族 === '旧神');
      if (!hasOldGod) {
        elderEl.textContent = '未採用';
      } else {
        // deckmaker-deck.js 側の getCard を使って旧神の名前を引く
        const oldCd = Object.keys(deck).find(cd => getCard(cd)?.race === '旧神');
        const name = oldCd ? (getCard(oldCd)?.name || '旧神') : '旧神';
        elderEl.textContent = name;
      }
    }

    // タイプごとのカウント
    const countByType = (type) => cards.filter(c => c?.タイプ === type).length;
    const nChg = countByType('チャージャー');
    const nAtk = countByType('アタッカー');
    const nBlk = countByType('ブロッカー');

    // 既存の数字だけ表示するスパン（互換のため残す）
    const chgEl = document.getElementById('count-charger');
    const atkEl = document.getElementById('count-attacker');
    const blkEl = document.getElementById('count-blocker');
    if (chgEl) chgEl.textContent = String(nChg);
    if (atkEl) atkEl.textContent = String(nAtk);
    if (blkEl) blkEl.textContent = String(nBlk);

    // チップUI（type-summary があればそちらに描画）
    const typeWrap = document.getElementById('type-summary');
    if (typeWrap) {
      typeWrap.innerHTML = `
        <span class="type-chip" data-type="チャージャー">チャージャー ${nChg}枚</span>
        <span class="type-chip" data-type="アタッカー">アタッカー ${nAtk}枚</span>
        <span class="type-chip" data-type="ブロッカー">ブロッカー ${nBlk}枚</span>
      `;
    }

    // 自動タグ更新（存在すれば）
    window.updateAutoTags?.();
  }

  function syncAfterDeckUpdate_(deckCards) {

    updateCardDisabling();
    syncGeneratedDeckCode_();
    syncPostRaceFields_();

    // deckmaker-deck.js 内に移植した updateDeckSummary を呼ぶ
    updateDeckSummary(deckCards);

    window.updateDeckAnalysis?.();
    window.updateExchangeSummary?.();
    window.updateDeckCardListBackground?.();

    if (document.getElementById('select-tags')) window.renderPostSelectTags?.();
  }

  function renderDeckSummaryInline_(total, races, hasOldGod, typeCount) {
    const summary = document.getElementById('deck-summary');
    if (!summary) return;

    const info = summary.querySelector('.deck-info') || (() => {
      const el = document.createElement('div');
      el.className = 'deck-info';
      summary.insertBefore(el, summary.firstChild);
      return el;
    })();

    info.innerHTML = `
      デッキ枚数：${total}/30~40<br>
      使用種族：${races.size > 0 ? Array.from(races).join('/') : 'なし'}<br>
      旧神：${hasOldGod ? '採用中' : '未採用'}<br>
      🔵 ${(typeCount['チャージャー']|0)} 🟣 ${(typeCount['アタッカー']|0)} ⚪️ ${(typeCount['ブロッカー']|0)}
    `;
  }

  function renderDeckEmptyState_(deckBarTop) {
    deckBarTop.innerHTML = `
      <div id="deck-empty-text">
        <div style="font-size: .7rem;">カード操作</div>
        <div class="deck-help" id="deckHelp">
          <div>【PC】<br>・左クリック：追加<br>・右クリック：削除</div>
          <div>【スマホ】<br>・タップ,上フリック：追加<br>・下フリック：削除</div>
        </div>
      </div>
    `;

    // 既存の他UIも空で同期
    window.updateCardDisabling?.();
    updateDeckSummary?.([]);
    window.updateExchangeSummary?.();

    if (typeof window.autoscaleAllBadges === 'function') {
      requestAnimationFrame(window.autoscaleAllBadges);
    } else if (typeof autoscaleAllBadges === 'function') {
      requestAnimationFrame(autoscaleAllBadges);
    }
  }

  function showPreview_(x, y, cd) {
    // 新モジュールがあるなら優先
    if (window.CardPreview?.showAt) return window.CardPreview.showAt(x, y, cd);

    // 旧互換
    const fn = window.showCardPreviewAt;
    if (typeof fn === 'function') return fn(x, y, cd);
  }

  function hidePreview_() {
    if (window.CardPreview?.hide) return window.CardPreview.hide();

    const fn = window.hideCardPreview;
    if (typeof fn === 'function') return fn();
  }

  function attachHoverPreview_(el, cd) {
    const canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
    if (!canHover) return;

    let lastX = 0, lastY = 0;
    const onMove = (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
      showPreview_(lastX, lastY, cd);
    };

    el.addEventListener('mouseenter', (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
      showPreview_(lastX, lastY, cd);
      el.addEventListener('mousemove', onMove);
    });

    el.addEventListener('mouseleave', () => {
      el.removeEventListener('mousemove', onMove);
      hidePreview_();
    });
  }

  function attachTouchControls_(el, cd) {
    let startX = 0, startY = 0;

    let lpTimer = 0;
    let lpFired = false;
    const LP_MS = 450;
    const LP_MOVE = 10;

    const THRESHOLD = 20;
    const MAX_SHIFT = 40;

    const cancelLongPress = () => { if (lpTimer) clearTimeout(lpTimer); lpTimer = 0; };
    const cleanUp = () => { el.style.transform = 'translateY(0)'; el.style.zIndex = ''; };

    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;

      el.style.transition = '';
      el.style.zIndex = '2000';

      lpFired = false;
      cancelLongPress();
      lpTimer = setTimeout(() => {
        lpFired = true;
        showPreview_(startX, startY, cd);
      }, LP_MS);
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!lpFired && (Math.abs(dx) > LP_MOVE || Math.abs(dy) > LP_MOVE)) cancelLongPress();
      if (lpFired) return;

      // 横操作優先は無視
      if (Math.abs(dx) > Math.abs(dy)) return;

      const limited = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, dy));
      el.style.transform = `translateY(${limited}px)`;
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      cancelLongPress();

      if (lpFired) {
        lpFired = false;
        hidePreview_();
        cleanUp();
        return;
      }

      const endY = e.changedTouches[0].clientY;
      const diffY = startY - endY; // 上=正, 下=負

      el.style.transition = 'transform .2s ease';

      if (Math.abs(diffY) <= THRESHOLD) {
        setTimeout(() => { el.style.transition = ''; cleanUp(); }, 200);
        return;
      }

      const to = diffY > 0 ? -MAX_SHIFT : MAX_SHIFT;
      el.style.transform = `translateY(${to}px)`;

      setTimeout(() => {
        el.style.transition = '';
        cleanUp();
        if (diffY > 0) addCard(cd);
        else removeCard(cd);
      }, 200);
    }, { passive: true });

    el.addEventListener('touchcancel', () => {
      cancelLongPress();
      lpFired = false;
      hidePreview_();
      cleanUp();
    }, { passive: true });
  }

  function updateDeck() {
    const deckBarTop = document.getElementById('deckBarTop');
    if (!deckBarTop) return;

    deckBarTop.innerHTML = '';

    // --- サマリー集計 ---
    let total = 0;
    const typeCount = { 'チャージャー': 0, 'アタッカー': 0, 'ブロッカー': 0 };
    const races = new Set();
    let hasOldGod = false;

    for (const [cd, count] of Object.entries(deck)) {
      const card = getCard(cd);
      if (!card) continue;

      total += count;
      typeCount[card.type] = (typeCount[card.type] || 0) + count;

      if (card.race !== 'イノセント' && card.race !== '旧神') races.add(card.race);
      if (card.race === '旧神') hasOldGod = true;
    }

    renderDeckSummaryInline_(total, races, hasOldGod, typeCount);

    // --- 空デッキ ---
    if (Object.keys(deck).length === 0) {
      renderDeckEmptyState_(deckBarTop);
      return;
    }

    // --- 並び替え済みエントリ ---
    const entries = getDeckEntriesSorted();

    // --- デッキバーへ要素追加 ---
    for (const [cd, count] of entries) {
      const card = getCard(cd);
      if (!card) continue;

      const cardEl = document.createElement('div');
      cardEl.className = 'deck-card';
      cardEl.dataset.cd = normCd5(cd);
      cardEl.dataset.race = card.race || '';

      const img = document.createElement('img');
      img.src = imgSrcOf(cd);
      img.alt = card.name || '';
      img.onerror = () => {
        if (img.dataset.fallbackApplied) return;
        img.dataset.fallbackApplied = '1';
        img.src = FALLBACK_IMG;
      };
      cardEl.appendChild(img);

      const badge = document.createElement('div');
      badge.className = 'count-badge';
      badge.textContent = String(count);
      cardEl.appendChild(badge);

      // PC: 左追加 / 右削除
      cardEl.addEventListener('mousedown', (e) => {
        if (e.button === 2) { e.preventDefault(); removeCard(cd); }
        else if (e.button === 0) { e.preventDefault(); addCard(cd); }
      });
      cardEl.addEventListener('contextmenu', e => e.preventDefault());

      // PC: ホバーでカード画像プレビュー
      //一時的にホバーは外す（スマホで誤爆が多いため）。必要なら再度有効化すること。
      //attachHoverPreview_(cardEl, cd);

      // Mobile: 上下フリック / 長押しプレビュー
      attachTouchControls_(cardEl, cd);

      deckBarTop.appendChild(cardEl);

      if (typeof window.autoscaleBadgeForCardEl === 'function') {
        window.autoscaleBadgeForCardEl(cardEl);
      } else if (typeof autoscaleBadgeForCardEl === 'function') {
        autoscaleBadgeForCardEl(cardEl);
      }
    }

    // --- 解析用の配列化 & 各種同期 ---
    const deckCards = buildDeckCardsForAnalysis_();
    syncAfterDeckUpdate_(deckCards);
  }

  // =========================
  // 一覧（.card）側：使用状況の見た目を更新
  // =========================
  function updateCardDisabling() {
    const deckRaces = new Set();
    let currentOldGod = null;

    // デッキ内の採用種族＆旧神を集計
    for (const cd of Object.keys(deck)) {
      const c = getCard(cd);
      if (!c) continue;

      if (c.race !== 'イノセント' && c.race !== '旧神') deckRaces.add(c.race);
      if (c.race === '旧神') currentOldGod = c.name;
    }

    document.querySelectorAll('.card').forEach(cardEl => {
      const cd = normCd5(cardEl.dataset.cd);
      const c = getCard(cd);
      if (!c) return;

      // 使用種族以外（イノセント/旧神は除外）をグレースケール
      const isUnselectedRace = (
        deckRaces.size > 0 &&
        c.race !== 'イノセント' &&
        c.race !== '旧神' &&
        !deckRaces.has(c.race)
      );
      // 使用不可種族の状態は所持UI再描画でも失われないよう別クラスでも保持する
      cardEl.classList.toggle('grayscale-race', !!isUnselectedRace);
      cardEl.classList.toggle('grayscale', !!isUnselectedRace);

      // 使用中ラベル
      let label = cardEl.querySelector('.used-label');
      if (!label) {
        label = document.createElement('div');
        label.className = 'used-label';
        cardEl.appendChild(label);
      }
      label.textContent = '';

      if (c.race === '旧神') {
        if (deck[cd]) label.textContent = '旧神使用';
        else if (currentOldGod) label.textContent = '他の旧神を使用中';
      } else {
        const n = deck[cd] || 0;
        if (n > 0) label.textContent = `使用中 ×${n}`;
      }

      // クリック/右クリックで±1（1回だけバインド）
      if (!label.dataset.listenerAttached) {
        label.addEventListener('contextmenu', (e) => {
          e.preventDefault(); e.stopPropagation(); removeCard(cd);
        });
        label.addEventListener('click', (e) => {
          e.stopPropagation(); addCard(cd);
        });
        label.dataset.listenerAttached = 'true';
      }
    });
  }

  // =========================
  // 復元トーストUI（移植前互換）
  // =========================
  function showRestoreToast_(message, opts = {}) {
    // 既存があれば消す
    document.getElementById('restore-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'restore-toast';

    const msgSpan = document.createElement('span');
    msgSpan.className = 'msg';
    msgSpan.textContent = message;
    toast.appendChild(msgSpan);

    if (opts.action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opts.action.label;
      btn.onclick = () => { opts.action.onClick?.(); toast.remove(); };
      toast.appendChild(btn);
    }
    if (opts.secondary) {
      const btn2 = document.createElement('button');
      btn2.type = 'button';
      btn2.textContent = opts.secondary.label;
      btn2.onclick = () => { opts.secondary.onClick?.(); toast.remove(); };
      toast.appendChild(btn2);
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 15000);
  }

  function clearAutosave_() {
    try { localStorage.removeItem('deck_autosave_v1'); } catch (_) {}
  }

  function loadAutosave_(data) {
    if (!data || !data.cardCounts) return;

    // deck 入れ替え（参照維持 + cd5正規化）
    Object.keys(deck).forEach(k => delete deck[k]);

    const src = (data.cardCounts && typeof data.cardCounts === 'object') ? data.cardCounts : {};
    for (const [cdRaw, nRaw] of Object.entries(src)) {
      const n = Number(nRaw) || 0;
      if (n <= 0) continue;
      const cd5 = normCd5(cdRaw);
      deck[cd5] = n;
    }

    // 代表カード
    const rep = data.m ? normCd5(data.m) : (data.representativeCd ? normCd5(data.representativeCd) : null);
    representativeCd = (rep && deck[rep]) ? rep : null;
    window.representativeCd = representativeCd;

    // 入力復元
    window.writeDeckNameInput?.(data.name || '');
    window.writePostNote?.(data.note || '');

    // 投稿者名
    try {
      const nameEl = document.getElementById('poster-name');
      const restoredName = (typeof data.poster === 'string') ? data.poster : (data.poster?.name || '');
      if (nameEl) nameEl.value = restoredName || '';
    } catch(_) {}

    // 貼り付けコード
    try {
      const v = String(data.shareCode || '');
      window.writePastedDeckCode?.(v);

      const shareEl = document.getElementById('post-share-code');
      if (shareEl) shareEl.value = v;
    } catch(_) {}

    // selectTags / userTags / cardNotes は「存在するAPIがあれば」復元
    try {
      if (Array.isArray(data.selectTags)) {
        // ✅ deckmaker-post.js の正規API（Set/ArrayどっちでもOK）
        if (typeof window.__dmWriteSelectedTags === 'function') {
          window.__dmWriteSelectedTags(data.selectTags);
        } else if (typeof window.writeSelectedTags === 'function') {
          // 旧互換が残ってる環境用
          window.writeSelectedTags(data.selectTags);
        }
        // UI再描画（存在すれば）
        window.renderPostSelectTags?.();
        window.applySelectTagWrap?.();
      }
    } catch(_) {}

    try {
      if (Array.isArray(data.userTags) && typeof window.writeUserTags === 'function') {
        window.writeUserTags(data.userTags);
      }
    } catch(_) {}

    try {
      if (data.cardNotes != null) {
        // 既存の CardNotes モジュールがあるならそれを使う
        if (window.CardNotes?.replace) {
          window.CardNotes.replace(Array.isArray(data.cardNotes) ? data.cardNotes : []);
        } else if (typeof window.writeCardNotes === 'function') {
          window.writeCardNotes(Array.isArray(data.cardNotes) ? data.cardNotes : []);
        }
      }
    } catch(_) {}

    // UI同期（deckBarTopなど）
    withDeckBarScrollKept(updateDeck);

    // deck-card-list もあるなら更新（移植後に未実装なら何もしない）
    window.renderDeckList?.();

    window.updateDeckSummaryDisplay?.();
    window.updateExchangeSummary?.();
    window.updateRepresentativeHighlight?.();
  }

  function resetDeckState() {
    const hasCards = Object.keys(deck || {}).length > 0;
    const hasRepresentative = !!representativeCd;
    const hasDeckName = !!window.readDeckNameInput?.();
    const hasCardNotes = (window.readCardNotes?.() || []).some((row) => {
      return String(row?.cd || '').trim() || String(row?.text || '').trim();
    });
    if (!hasCards && !hasRepresentative && !hasDeckName && !hasCardNotes) return;

    const ok = window.confirm?.('現在のデッキ内容をリセットします。\nデッキ名・カード解説も消えます。\n※デッキ解説タグは残ります。\nよろしいですか？');
    if (!ok) return;

    window.writeDeckNameInput?.('');
    window.writeCardNotes?.([]);
    setDeckState({}, { representativeCd: null });
    try { clearAutosave_(); } catch (_) {}
  }

    // =========================
  // 外部からの「デッキ差し替え」用API（保存デッキ読み込み等）
  // - window.deck を「差し替えず」、deck参照の中身だけを入れ替える
  // =========================
  function setDeckState(nextCardCounts, opts = {}) {
    const src = (nextCardCounts && typeof nextCardCounts === 'object') ? nextCardCounts : {};

    // deck 入れ替え（参照維持）
    Object.keys(deck).forEach(k => delete deck[k]);

    // cdを5桁に正規化して入れる（0以下は捨てる）
    for (const [cdRaw, nRaw] of Object.entries(src)) {
      const n = Number(nRaw) || 0;
      if (n <= 0) continue;
      const cd5 = normCd5(cdRaw);
      deck[cd5] = n;
    }

    // 代表カード
    const repIn = (opts.representativeCd != null) ? String(opts.representativeCd) : null;
    const rep = repIn ? normCd5(repIn) : null;
    representativeCd = (rep && deck[rep]) ? rep : null;
    window.representativeCd = representativeCd;

    // UI同期（復元と同じ流れ）
    withDeckBarScrollKept(updateDeck);
    window.applyGrayscaleFilter?.();
    window.renderDeckList?.();
    window.updateDeckAnalysis?.();
    window.updateExchangeSummary?.();
    window.updateRepresentativeHighlight?.();

    // 読み込み後もオートセーブ対象にする（不要なら消してOK）
    try { scheduleAutosave(); } catch (_) {}
  }

    // =========================
  // オートセーブ（page2互換・上位互換）
  // - localStorage: deck_autosave_v1
  // - 「空 payload で既存データを潰さない」
  // - selectTags / userTags / cardNotes も保存
  // - saveAutosaveNow / clearAutosave を提供
  // =========================
  const AUTOSAVE_KEY = 'deck_autosave_v1';

  let __autosaveDirty = false;       // 変更が起きたときだけ true
  let __autosaveJustLoaded = true;   // 初期描画直後のガード
  let __autosaveTimer = 0;

  // 初期描画やオートフィルが落ち着くまで保存抑止（page2互換）
  window.addEventListener('load', () => {
    setTimeout(() => { __autosaveJustLoaded = false; }, 3000);
  });

  function isTrulyEmpty_(payload) {
    if (!payload || typeof payload !== 'object') return true;

    const cc = payload.cardCounts || {};
    const deckEmpty = !cc || Object.keys(cc).length === 0;

    function _isBlankLike(v) {
      const s = String(v ?? '').trim();
      if (!s) return true;
      if (s === '[]' || s === '{}') return true;
      return false;
    }

    const noName   = _isBlankLike(payload.name);
    const noNote   = _isBlankLike(payload.note);
    const noPoster = _isBlankLike(payload.poster);
    const noM      = !payload.m;

    let noCardNotes = true;
    if (Array.isArray(payload.cardNotes)) {
      noCardNotes = payload.cardNotes.length === 0;
    } else {
      noCardNotes = _isBlankLike(payload.cardNotes);
    }

    const noSelTags  = !(Array.isArray(payload.selectTags) && payload.selectTags.length);
    const noUserTags = !(Array.isArray(payload.userTags)  && payload.userTags.length);

    return deckEmpty && noName && noNote && noPoster && noM && noCardNotes && noSelTags && noUserTags;
  }

  // select-tags のフォールバック読み取り（readSelectedTags が無い時用）
  function fallbackReadSelectTags_() {
    const box = document.getElementById('select-tags');
    if (!box) return [];
    const chips = Array.from(box.querySelectorAll('.chip'));
    const onChips = chips.filter(ch =>
      ch.getAttribute('aria-pressed') === 'true' ||
      ch.classList.contains('selected') ||
      ch.classList.contains('active') ||
      ch.classList.contains('on')
    );
    return onChips
      .map(ch => ch.dataset.key?.trim() || ch.textContent.trim())
      .filter(Boolean);
  }

  function buildAutosavePayload_() {
    const payload = {
      cardCounts: { ...deck },

      representativeCd,
      m: representativeCd || null,

      name: window.readDeckNameInput?.() || '',
      note: window.readPostNote?.() || '',
      poster: document.getElementById('poster-name')?.value?.trim() || '',
      shareCode: document.getElementById('post-share-code')?.value?.trim() || '',
      date: window.formatYmd?.(),
    };

    // userTags
    try {
      if (typeof window.readUserTags === 'function') {
        const tags = window.readUserTags();
        if (Array.isArray(tags)) payload.userTags = tags;
      }
    } catch (_) {}

    // selectTags
    try {
      if (typeof window.readSelectedTags === 'function') {
        const v = window.readSelectedTags(); // Set想定
        payload.selectTags = Array.from(v || []);
      } else {
        payload.selectTags = fallbackReadSelectTags_();
      }
    } catch (_) {}

    // cardNotes
    try {
      let notes = null;
      if (typeof window.readCardNotes === 'function') notes = window.readCardNotes();

      if (Array.isArray(notes)) {
        payload.cardNotes = notes;
      } else if (typeof notes === 'string') {
        const s = notes.trim();
        if (!s || s === '[]') payload.cardNotes = [];
        else {
          try {
            const parsed = JSON.parse(s);
            payload.cardNotes = Array.isArray(parsed) ? parsed : [];
          } catch {
            payload.cardNotes = [];
          }
        }
      } else {
        payload.cardNotes = [];
      }
    } catch (_) {
      payload.cardNotes = [];
    }

    return payload;
  }

  function saveAutosaveNow() {
    try {
      if (__autosaveJustLoaded) {
        if (__autosaveTimer) clearTimeout(__autosaveTimer);
        __autosaveTimer = setTimeout(saveAutosaveNow, 1200);
        return;
      }
      if (!__autosaveDirty) return;

      const next = buildAutosavePayload_();

      const prevRaw = localStorage.getItem(AUTOSAVE_KEY);
      let prev = null;
      if (prevRaw) {
        try { prev = JSON.parse(prevRaw); } catch (_) {}
      }

      // 空 → 非空を潰さない
      if (isTrulyEmpty_(next) && prev && !isTrulyEmpty_(prev)) return;

      // 完全一致なら保存不要
      if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;

      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(next));
      __autosaveDirty = false;
    } catch (e) {
      console.warn('autosave failed', e);
    }
  }

  function scheduleAutosave() {
    __autosaveDirty = true;
    if (__autosaveTimer) clearTimeout(__autosaveTimer);
    __autosaveTimer = setTimeout(saveAutosaveNow, 900);
  }

  // タグ/解説の変更を監視して保存（1回だけ）
  (function bindAutosaveForTagsAndNotes() {
    if (window.__autosaveBound) return;
    window.__autosaveBound = true;

    const bind = () => {
      // 選択タグ：クリック/変更で保存
      const sel = document.getElementById('select-tags');
      if (sel && !sel.__autosaveBound) {
        sel.__autosaveBound = true;
        sel.addEventListener('click', scheduleAutosave);
        sel.addEventListener('change', scheduleAutosave);
      }

      // ユーザタグ
      const userTagsBox = document.getElementById('user-tags');
      const userTagInput = document.getElementById('user-tag-input');
      const userTagAdd = document.getElementById('user-tag-add');

      if (userTagsBox && !userTagsBox.__autosaveBound) {
        userTagsBox.__autosaveBound = true;
        userTagsBox.addEventListener('click', scheduleAutosave);
      }
      if (userTagInput && !userTagInput.__autosaveBound) {
        userTagInput.__autosaveBound = true;
        userTagInput.addEventListener('input', scheduleAutosave);
        userTagInput.addEventListener('change', scheduleAutosave);
      }
      if (userTagAdd && !userTagAdd.__autosaveBound) {
        userTagAdd.__autosaveBound = true;
        userTagAdd.addEventListener('click', scheduleAutosave);
      }

      // 解説
      const note = document.getElementById('post-note');
      if (note && !note.__autosaveBound) {
        note.__autosaveBound = true;
        note.addEventListener('input', scheduleAutosave);
        note.addEventListener('change', scheduleAutosave);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bind, { once: true });
    } else {
      bind();
    }
  })();

  // 旧互換API用に公開できるようにしておく（末尾の公開APIで使う）
  window.saveAutosaveNow = window.saveAutosaveNow || saveAutosaveNow;
  window.clearAutosave   = window.clearAutosave   || (() => { try { localStorage.removeItem(AUTOSAVE_KEY); } catch (_) {} });


  function maybeRestoreFromStorage() {
    // URLで fresh=1 のときは復元導線を出さない（移植前互換）
    if (window.location.search.includes('fresh=1')) return;

    const raw = localStorage.getItem('deck_autosave_v1');
    if (!raw) return;

    try {
      const data = JSON.parse(raw);
      const saved = data?.cardCounts || {};
      if (!Object.keys(saved).length) return;

      // 今の deck と同一なら出さない（ざっくり比較）
      const now = window.deck || {};
      const sameSize = Object.keys(now).length === Object.keys(saved).length;
      let same = sameSize;
      if (same) {
        for (const k in saved) {
          if ((now[k] | 0) !== (saved[k] | 0)) { same = false; break; }
        }
      }
      if (same) return;

      showRestoreToast_('以前のデータを復元しますか？', {
        action: { label: '復元する', onClick: () => loadAutosave_(data) },
        secondary: { label: '削除する', onClick: () => clearAutosave_() },
      });
    } catch (e) {
      // パース失敗などは黙って無視
    }
  }

  // =========================
  // デッキ情報開閉（ボタン表記同期）
  // =========================
  function toggleDeckSummary() {
    const summary = document.getElementById('deck-summary');
    const btn = document.querySelector('.deck-summary-toggle');
    if (!summary || !btn) return;

    const isOpen = summary.classList.toggle('open');
    btn.textContent = isOpen ? '▶' : '◀';
  }

  (function bindDeckSummaryToggle_(){
    const bind = () => {
      const deckSummary = document.getElementById('deck-summary');
      const toggleBtn = document.querySelector('.deck-summary-toggle');
      if (!deckSummary || !toggleBtn) return;

      deckSummary.classList.add('open');
      toggleBtn.textContent = '▶';
      toggleBtn.removeAttribute('onclick'); // inline重複防止

      if (!toggleBtn.__bound) {
        toggleBtn.__bound = true;
        toggleBtn.addEventListener('click', toggleDeckSummary);
      }
    };

    if (typeof window.onDeckmakerReady === 'function') {
      window.onDeckmakerReady(bind);
      return;
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bind, { once: true });
    } else {
      bind();
    }
  })();

  // =========================
  // 代表カード（投稿連携）
  // - deckmaker-post.js が参照する互換API
  //   - window.setRepresentativeCard(cd, name?)
  //   - window.buildCardsForPost_() -> {cd:count}
  //   - window.representativeCd
  // =========================
  function setRepresentativeCard(cd, name = '') {
    const cd5 = normCd5(cd);

    // deckに無いカードは代表にできない（空にする）
    if (!deck?.[cd5]) {
      representativeCd = null;
      window.representativeCd = null;
      return;
    }

    representativeCd = cd5;
    window.representativeCd = cd5;

    // UI更新用フック（存在すれば）
    try { window.updateRepresentativeHighlight?.(cd5, name); } catch (_) {}
    try { scheduleAutosave?.(); } catch (_) {}
  }

  // デッキ内のカード枚数を {cd: count} 形式で返す（投稿用）
  function buildCardsForPost_() {
    const out = {};
    for (const [cd, nRaw] of Object.entries(deck || {})) {
      const n = Number(nRaw) || 0;
      if (n > 0) out[normCd5(cd)] = n;
    }
    return out;
  }

  // =========================
  // 保存（ダウンロード）
  // - JSON保存 / 画像保存（html2canvasがある場合のみ動く）
  // =========================
  function saveDeckAsJson() {
    const payload = {
      cards: { ...deck },
      representativeCd: representativeCd || null,
      name: window.readDeckNameInput?.() || '',
      note: window.readPostNote?.() || '',
      date: window.formatYmd?.(),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${payload.name || 'deck'}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  async function saveDeckAsImage() {
    const target = document.getElementById('deck-card-list');
    if (!target) return;

    if (typeof html2canvas !== 'function') {
      console.warn('[saveDeckAsImage] html2canvas が見つかりません');
      return;
    }

    try {
      const canvas = await html2canvas(target, { backgroundColor: null });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'deck.png';
        a.click();

        URL.revokeObjectURL(url);
      });
    } catch (e) {
      console.error('デッキ画像の作成に失敗:', e);
    }
  }

  // =========================
  // 公開API（他ファイルから使う前提）
  // =========================

  // deck state
  window.deck = deck;

  // races / rules
  window.MAIN_RACES = MAIN_RACES;
  window.getMainRacesInDeck = getMainRacesInDeck;
  window.computeMainRace = computeMainRace;
  window.getMainRace = getMainRace;
  window.getRaceCode = window.getRaceCode || getRaceCode;
  window.buildRaceKey = window.buildRaceKey || buildRaceKey;
  window.getRaceType = getRaceType;

  // deck operations
  window.addCard = addCard;
  window.removeCard = removeCard;
  window.updateDeck = updateDeck;
  window.updateDeckSummary = window.updateDeckSummary || updateDeckSummary;
  window.updateCardDisabling = updateCardDisabling;

  // representative (post integration)
  window.setRepresentativeCard = window.setRepresentativeCard || setRepresentativeCard;
  window.buildCardsForPost_ = window.buildCardsForPost_ || buildCardsForPost_;
  window.exportDeckCode = window.exportDeckCode || exportDeckCode;
  window.representativeCd = window.representativeCd ?? representativeCd;

  // autosave / restore
  window.withDeckBarScrollKept = withDeckBarScrollKept;
  window.scheduleAutosave = scheduleAutosave;
  window.maybeRestoreFromStorage = maybeRestoreFromStorage;

  window.setDeckState = window.setDeckState || setDeckState;
  window.resetDeckState = window.resetDeckState || resetDeckState;

  // UI toggles
  window.toggleDeckSummary = toggleDeckSummary;

  // save helpers
  window.saveDeckAsJson = window.saveDeckAsJson || saveDeckAsJson;
  window.saveDeckAsImage = window.saveDeckAsImage || saveDeckAsImage;

  // 代表カード関連は deckmaker-post.js からも参照する想定で互換APIを提供（移植後に deckmaker-post.js を更新してこれらを直接呼ぶようにすれば、ここは非公開にできる）
  window.setRepresentativeCard ??= setRepresentativeCard;
  window.buildCardsForPost_    ??= buildCardsForPost_;
  window.representativeCd      ??= representativeCd || null;

})();
