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
 * - オートセーブ（localStorage: deck_working_v1 / deck_rescue_v1）
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
  let representativeCd = null;//デッキ内で代表的なカード（主にカードプレビューの表示に使う）。特に意味はないが、更新のたびに先頭から探すのも面倒なので一応保持しておく。
  let lastAddedCd = null;//最後に追加したカード。削除の際、これが0枚になったら代表的なカードもリセットする。特に意味はないが、更新のたびに先頭から探すのも面倒なので一応保持しておく。

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

    lastAddedCd = cd5;

    withDeckBarScrollKept(updateDeck);
    window.applyGrayscaleFilter?.();
    scheduleAutosave();
  }
  function removeCard(cd, { soft = false } = {}) {
    const cd5 = normCd5(cd);
    const cur = Number(deck[cd5] || 0);
    if (cur <= 0) return;

    const isRegisteredLethalCard = window.DeckmakerLethalPost?.hasCard?.(cd5) === true;
    if (!soft && isRegisteredLethalCard) {
      const cardName = getCard(cd5)?.name || cd5;
      const ok = window.confirm?.(`「${cardName}」は投稿に登録したリーサルプランに含まれています。\nデッキから1枚削除しますか？\n※登録済みリーサルプランは削除されません。`);
      if (!ok) return;
    }

    const next = Math.max(0, cur - 1);

    if (next === 0) delete deck[cd5];
    else deck[cd5] = next;

    if (lastAddedCd === cd5 && !deck[cd5]) {
      lastAddedCd = null;
    }

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
    window.DeckmakerFilter?.updateInvalidRaceGuide?.();
    window.updateMulliganAnalysisGuide?.();
    syncGeneratedDeckCode_();
    syncPostRaceFields_();

    // deckmaker-deck.js 内に移植した updateDeckSummary を呼ぶ
    updateDeckSummary(deckCards);

    window.updateDeckAnalysis?.();
    window.updateExchangeSummary?.();
    window.updateDeckCardListBackground?.();

    if (document.getElementById('select-tags')) window.renderPostSelectTags?.();
  }

  // =========================
  // リーサルプラン仮組
  // =========================
  const LETHAL_PLANNER_TARGET = 30;
  const LETHAL_PLANNER_REPEAT_TARGET = 40;
  const lethalPlannerSelections = [];
  const lethalPlannerCardSelections = new Map();
  let lethalPlannerCandidates = new Map();
  let lethalPlannerEventsBound = false;
  let lethalPlannerDragIndex = null;
  let lethalPlannerStepId = 0;
  let lethalPlannerAutoPlans = [];
  let lethalPlannerAutoSearched = false;
  let lethalPlannerAutoExpanded = false;
  let allowedAutoLethalOptions = null;
  let lethalPlannerAutoFilterActive = false;
  let lethalCandidateTooltip = null;
  let lethalCandidateTooltipTimer = null;
  let lethalCandidateTooltipButton = null;
  let lethalAutoCardsPopup = null;
  let lethalAutoCardsPopupButton = null;
  let lethalAutoFilterModal = null;
  let lethalAutoFilterLastFocus = null;
  let lethalCopyStatusTimer = null;
  const LETHAL_REPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSd_-3T97rnhaAKVS76-0YDzYM4Lp9T1XdBrH0Hf4ksjB2y_Nw/viewform?usp=header';
  const LETHAL_PLANNER_AUTO_INITIAL_RESULT_LIMIT = 3;
  const LETHAL_PLANNER_AUTO_RESULT_LIMIT = 10;
  const LETHAL_PLANNER_AUTO_BEAM_WIDTH = 50;
  const LETHAL_CANDIDATE_TOOLTIP_DELAY = 200;
  const LETHAL_CANDIDATE_TOOLTIP_MAX_CARDS = 5;

  const lethalPlannerTypes = [
    { key: 'attack', label: '攻撃', icon: '⚔' },
    { key: 'burn', label: 'バーン', icon: '🔥' },
    { key: 'buff', label: 'バフ', icon: '💪' },
  ];

  const LETHAL_SOURCE_DEFS = [
    { sourceKind: 'attack', displayType: 'attack', lethalKey: 'attack' },
    { sourceKind: 'freeBurn', displayType: 'burn', lethalKey: 'freeBurn' },
    { sourceKind: 'freeBuff', displayType: 'buff', lethalKey: 'freeBuff' },
    {
      sourceKind: 'lethalBuff',
      displayType: 'buff',
      lethalKey: 'lethalBuff',
      requiresAttack: true,
    },
  ];

  function getLethalPlannerCandidateKey_(type, value) {
    return `${type}:${value}`;
  }

  function getLethalPlannerNumber_(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function getLethalPlannerValues_(lethal) {
    if (!lethal) return [];
    const values = (Array.isArray(lethal.values) ? lethal.values : [])
      .map(getLethalPlannerNumber_)
      .filter(value => value !== null)
      .map(value => ({
        value,
        isRepeat: false,
        defaultOff: lethal.defaultOff === true,
      }));
    const repeatValue = getLethalPlannerNumber_(lethal.repeat?.value);
    if (repeatValue !== null && !values.some(item => item.value === repeatValue)) {
      values.push({
        value: repeatValue,
        isRepeat: true,
        defaultOff: lethal.defaultOff === true,
      });
    }
    return values;
  }

  function buildLethalPlannerCandidates_() {
    const candidates = new Map();
    let deckOrder = 0;

    for (const [cd, rawCount] of Object.entries(deck)) {
      const card = getCard(cd);
      const count = Math.max(0, Number(rawCount) || 0);
      const currentDeckOrder = deckOrder;
      deckOrder += 1;
      if (!card || count === 0) continue;

      for (const sourceDef of LETHAL_SOURCE_DEFS) {
        const lethal = card.lethal?.[sourceDef.lethalKey];
        if (!lethal) continue;

        const normalValues = [...new Set(
          (Array.isArray(lethal.values) ? lethal.values : [])
            .map(getLethalPlannerNumber_)
            .filter(value => value !== null)
        )];
        const minimumNormalValue = normalValues.length > 0 ? Math.min(...normalValues) : null;
        for (const value of normalValues) {
          addLethalPlannerCandidate_(
            candidates,
            sourceDef.displayType,
            value,
            cd,
            card,
            count,
            false,
            {
              sourceKind: sourceDef.sourceKind,
              attackValue: sourceDef.sourceKind === 'attack' ? value : null,
              requiresAttack: sourceDef.requiresAttack === true,
              valuesCount: normalValues.length,
              isMinimumValue: value === minimumNormalValue,
              defaultOff: lethal.defaultOff === true,
              deckOrder: currentDeckOrder,
            }
          );
        }

        const repeatValue = getLethalPlannerNumber_(lethal.repeat?.value);
        if (repeatValue !== null) {
          addLethalPlannerCandidate_(candidates, sourceDef.displayType, repeatValue, cd, card, count, true, {
            sourceKind: sourceDef.sourceKind,
            attackValue: sourceDef.sourceKind === 'attack' ? repeatValue : null,
            requiresAttack: sourceDef.requiresAttack === true,
            valuesCount: 1,
            isMinimumValue: true,
            defaultOff: lethal.defaultOff === true,
            deckOrder: currentDeckOrder,
          });
        }
      }

      const attackValues = getLethalPlannerValues_(card.lethal?.attack);
      const lethalBurnValues = getLethalPlannerValues_(card.lethal?.lethalBurn);
      for (const attack of attackValues) {
        for (const lethalBurn of lethalBurnValues) {
          addLethalPlannerCandidate_(
            candidates,
            'attack',
            attack.value + lethalBurn.value,
            cd,
            card,
            count,
            attack.isRepeat || lethalBurn.isRepeat,
            {
              sourceKind: 'attack',
              valuesCount: attackValues.length * lethalBurnValues.length,
              isMinimumValue: false,
              deckOrder: currentDeckOrder,
              candidateKey: getLethalPlannerCandidateKey_(
                'attack',
                attack.value + lethalBurn.value
              ),
              display: String(attack.value + lethalBurn.value),
              detailDisplay: `${attack.value}+${lethalBurn.value}`,
              attackValue: attack.value,
              lethalBurnValue: lethalBurn.value,
              defaultOff: attack.defaultOff || lethalBurn.defaultOff,
              forceDeckCount: true,
            }
          );
        }
      }
    }

    return candidates;
  }

  function addLethalPlannerCandidate_(candidates, type, value, cd, card, count, isRepeat, sourceMeta) {
    const key = sourceMeta?.candidateKey || getLethalPlannerCandidateKey_(type, value);
    let candidate = candidates.get(key);
    if (!candidate) {
      candidate = {
        key,
        type,
        value,
        display: sourceMeta?.display || String(value),
        attackValue: sourceMeta?.attackValue ?? null,
        lethalBurnValue: sourceMeta?.lethalBurnValue ?? null,
        repeat: false,
        cards: new Map(),
        sources: new Map(),
      };
      candidates.set(key, candidate);
    }

    const cardKey = normCd5(cd);
    const sourceKind = sourceMeta?.sourceKind || type;
    const sourceKey = sourceMeta?.forceDeckCount
      ? `${cardKey}:attack`
      : isRepeat
      ? `${cardKey}:${sourceKind}:repeat:${value}`
      : `${cardKey}:${sourceKind}`;
    const sourceVariantKey = [
      sourceKey,
      sourceMeta?.attackValue ?? '',
      sourceMeta?.lethalBurnValue ?? '',
      isRepeat ? 'repeat' : 'normal',
    ].join(':');
    if (!candidate.sources.has(sourceVariantKey)) {
      candidate.sources.set(sourceVariantKey, {
        cardId: cardKey,
        cardName: card.name || cardKey,
        sourceKey,
        sourceKind,
        type,
        value,
        display: sourceMeta?.display || String(value),
        detailDisplay: sourceMeta?.detailDisplay || sourceMeta?.display || String(value),
        attackValue: sourceMeta?.attackValue ?? null,
        lethalBurnValue: sourceMeta?.lethalBurnValue ?? null,
        candidateKey: key,
        sourceVariantKey,
        count: isRepeat && !sourceMeta?.forceDeckCount
          ? Math.ceil(LETHAL_PLANNER_REPEAT_TARGET / value)
          : count,
        deckCount: count,
        valuesCount: sourceMeta?.valuesCount || 1,
        isMinimumValue: sourceMeta?.isMinimumValue === true,
        defaultOff: sourceMeta?.defaultOff === true,
        deckOrder: sourceMeta?.deckOrder ?? Number.MAX_SAFE_INTEGER,
        isRepeat,
        requiresAttack: sourceMeta?.requiresAttack === true,
      });
    }
    candidate.repeat ||= isRepeat;

    if (!candidate.cards.has(cardKey)) {
      candidate.cards.set(cardKey, { cd: cardKey, name: card.name || cardKey, count });
    }
  }

  function getLethalPlannerAttackSourceUsedCount_(sourceKey, excludedStepId = null) {
    return lethalPlannerSelections.reduce((total, selection) => {
      if (
        selection.type !== 'attack' ||
        selection.stepId === excludedStepId ||
        selection.sourceKey !== sourceKey
      ) {
        return total;
      }
      return total + 1;
    }, 0);
  }

  function findLethalPlannerAttackAssignment_(lethalBuffSource) {
    return getLethalPlannerAttackAssignments_(lethalBuffSource)[0] || null;
  }

  function getLethalPlannerAttackAssignments_(lethalBuffSource) {
    const assignments = [];
    for (const selection of lethalPlannerSelections) {
      if (selection.type !== 'attack') continue;
      if (selection.lethalBurnValue != null) continue;
      const alreadyLinked = lethalPlannerSelections.some(buffSelection =>
        buffSelection.sourceKind === 'lethalBuff' &&
        buffSelection.linkedAttackStepId === selection.stepId
      );
      if (alreadyLinked) continue;
      if (selection.locked && selection.cardId !== lethalBuffSource.cardId) continue;

      const candidateSource = selection.candidateSources?.find(source =>
        source.cardId === lethalBuffSource.cardId
      );
      if (!candidateSource) continue;

      const usedCount = getLethalPlannerAttackSourceUsedCount_(
        candidateSource.sourceKey,
        selection.stepId
      );
      if (usedCount >= candidateSource.count) continue;

      assignments.push({ selection, candidateSource });
    }
    return assignments;
  }

  function isLethalPlannerSourceUnlocked_(source) {
    return !source.requiresAttack || Boolean(findLethalPlannerAttackAssignment_(source));
  }

  function removeOrphanedLethalPlannerBuffs_() {
    const attackStepIds = new Set(
      lethalPlannerSelections
        .filter(selection => selection.type === 'attack')
        .map(selection => selection.stepId)
    );
    for (let index = lethalPlannerSelections.length - 1; index >= 0; index -= 1) {
      const selection = lethalPlannerSelections[index];
      if (
        selection.sourceKind === 'lethalBuff' &&
        !attackStepIds.has(selection.linkedAttackStepId)
      ) {
        lethalPlannerSelections.splice(index, 1);
      }
    }
  }

  function unlockLinkedLethalPlannerAttack_(linkedAttackStepId) {
    if (!linkedAttackStepId) return;
    const hasOtherLinkedBuff = lethalPlannerSelections.some(selection =>
      selection.sourceKind === 'lethalBuff' &&
      selection.linkedAttackStepId === linkedAttackStepId
    );
    if (hasOtherLinkedBuff) return;

    const attackSelection = lethalPlannerSelections.find(selection =>
      selection.type === 'attack' && selection.stepId === linkedAttackStepId
    );
    if (attackSelection) attackSelection.locked = false;
  }

  function sortLethalPlannerSources_(sources) {
    return sources.sort((a, b) =>
      Number(a.isRepeat) - Number(b.isRepeat) ||
      a.valuesCount - b.valuesCount ||
      Number(b.isMinimumValue) - Number(a.isMinimumValue) ||
      b.deckCount - a.deckCount ||
      a.deckOrder - b.deckOrder
    );
  }

  function getLethalPlannerStepCardOptions_(step) {
    const candidate = lethalPlannerCandidates.get(step.key);
    if (!candidate?.sources) return [];
    const cards = new Map();
    for (const source of candidate.sources.values()) {
      if (
        step.autoOptionKeys instanceof Set &&
        !step.autoOptionKeys.has(getLethalPlannerAutoOptionKey_(source))
      ) {
        continue;
      }
      if (!source.cardId) continue;
      if (!cards.has(source.cardId)) {
        cards.set(source.cardId, {
          cd: source.cardId,
          name: source.cardName || getCard(source.cardId)?.name || source.cardId,
          count: source.deckCount,
          hasPlainAttack: false,
          attackBreakdowns: new Set(),
        });
      }
      const card = cards.get(source.cardId);
      if (source.type === 'attack') {
        if (source.lethalBurnValue == null) card.hasPlainAttack = true;
        else card.attackBreakdowns.add(source.detailDisplay);
      }
    }
    return [...cards.values()].map(card => ({
      ...card,
      requiresTrigger: !card.hasPlainAttack && card.attackBreakdowns.size > 0,
      supplement:
        !card.hasPlainAttack && card.attackBreakdowns.size > 0
          ? `(${[...card.attackBreakdowns].join('/')})`
          : '',
    }));
  }

  function canAssignLethalPlannerSteps_(steps, forcedStepId, forcedCardId) {
    const linkedTriggerSteps = steps.filter(step =>
      (step.sourceKind === 'lethalBuff' || step.sourceKind === 'lethalBurn') &&
      step.linkedAttackStepId != null
    );
    const consumingSteps = steps
      .filter(step => !linkedTriggerSteps.includes(step))
      .sort((a, b) =>
        getLethalPlannerStepCardOptions_(a).length - getLethalPlannerStepCardOptions_(b).length
      );
    const forcedLinkedStep = linkedTriggerSteps.find(step => step.stepId === forcedStepId);
    const assignments = new Map();
    const copyUseCounts = new Map();

    const isCompleteAssignmentValid = () => {
      const triggerUseCounts = new Map();
      for (const step of consumingSteps) {
        const assignedCard = assignments.get(step.stepId);
        if (!assignedCard?.requiresTrigger) continue;
        const cardId = assignedCard.cd;
        triggerUseCounts.set(cardId, (triggerUseCounts.get(cardId) || 0) + 1);
      }
      for (const step of linkedTriggerSteps) {
        const cardId = assignments.get(step.linkedAttackStepId)?.cd;
        if (!cardId) return false;
        if (!getLethalPlannerStepCardOptions_(step).some(card => card.cd === cardId)) {
          return false;
        }
        if (forcedLinkedStep === step && cardId !== forcedCardId) return false;
        triggerUseCounts.set(cardId, (triggerUseCounts.get(cardId) || 0) + 1);
      }

      const cardIds = new Set([...copyUseCounts.keys(), ...triggerUseCounts.keys()]);
      for (const cardId of cardIds) {
        const deckCount = Math.max(
          0,
          ...steps.flatMap(step =>
            getLethalPlannerStepCardOptions_(step)
              .filter(card => card.cd === cardId)
              .map(card => card.count)
          )
        );
        const copyUse = copyUseCounts.get(cardId) || 0;
        const triggerUse = triggerUseCounts.get(cardId) || 0;
        if (Math.max(copyUse, triggerUse) > deckCount) return false;
      }
      return true;
    };

    const assignStep = (index) => {
      if (index >= consumingSteps.length) return isCompleteAssignmentValid();
      const step = consumingSteps[index];
      const forcedCardForStep =
        step.stepId === forcedStepId
          ? forcedCardId
          : forcedLinkedStep?.linkedAttackStepId === step.stepId
            ? forcedCardId
            : null;
      for (const card of getLethalPlannerStepCardOptions_(step)) {
        if (forcedCardForStep && card.cd !== forcedCardForStep) continue;
        const nextCopyUse = (copyUseCounts.get(card.cd) || 0) + 1;
        if (nextCopyUse > card.count) continue;
        assignments.set(step.stepId, card);
        copyUseCounts.set(card.cd, nextCopyUse);
        if (assignStep(index + 1)) return true;
        assignments.delete(step.stepId);
        if (nextCopyUse === 1) copyUseCounts.delete(card.cd);
        else copyUseCounts.set(card.cd, nextCopyUse - 1);
      }
      return false;
    };

    return assignStep(0);
  }

  function resolveSelectedLethalStepCandidates_(steps) {
    const resolved = new Map();
    const consumingSteps = steps.filter(step =>
      !(
        (step.sourceKind === 'lethalBuff' || step.sourceKind === 'lethalBurn') &&
        step.linkedAttackStepId != null
      )
    );

    for (const step of consumingSteps) {
      const possibleCards = getLethalPlannerStepCardOptions_(step).filter(card =>
        canAssignLethalPlannerSteps_(consumingSteps, step.stepId, card.cd)
      );
      resolved.set(step.stepId, {
        stepId: step.stepId,
        label: step.display || String(step.value),
        fixedCards: possibleCards.length === 1 ? possibleCards : [],
        candidateCards: possibleCards.length === 1 ? [] : possibleCards,
      });
    }

    for (const step of steps) {
      if (resolved.has(step.stepId)) continue;
      const linkedCards = getLethalPlannerStepCardOptions_(step).filter(card =>
        canAssignLethalPlannerSteps_(steps, step.stepId, card.cd)
      );
      resolved.set(step.stepId, {
        stepId: step.stepId,
        label: step.display || String(step.value),
        fixedCards: linkedCards.length === 1 ? linkedCards : [],
        candidateCards: linkedCards.length === 1 ? [] : linkedCards,
      });
    }
    return resolved;
  }

  function getAvailableLethalPlannerSource_(
    candidate,
    availableCards = getAvailableCardsForLethalCandidate_(candidate)
  ) {
    const availableCardIds = new Set(
      availableCards.map(card => card.cd)
    );
    return sortLethalPlannerSources_(
      [...(candidate?.sources.values() || [])].filter(source =>
        availableCardIds.has(source.cardId) &&
        isLethalPlannerSourceUnlocked_(source)
      )
    )[0] || null;
  }

  function getLethalPlannerAutoOptionKey_(source) {
    return `${source.cardId}|${source.sourceVariantKey}|${source.candidateKey}`;
  }

  function getLethalPlannerAutoSourceGroups_(enabledOptionKeys = null) {
    const groups = new Map();
    for (const candidate of lethalPlannerCandidates.values()) {
      for (const source of candidate.sources.values()) {
        if (source.isRepeat && !enabledOptionKeys) continue;
        if (enabledOptionKeys && !enabledOptionKeys.has(getLethalPlannerAutoOptionKey_(source))) {
          continue;
        }
        if (!groups.has(source.sourceKey)) {
          groups.set(source.sourceKey, {
            sourceKey: source.sourceKey,
            sourceKind: source.sourceKind,
            cardId: source.cardId,
            count: source.count,
            sources: [],
          });
        }
        groups.get(source.sourceKey).sources.push(source);
      }
    }
    return [...groups.values()];
  }

  function getLethalPlannerAutoStateScore_(state) {
    const stepCount = state.items.length;
    const overDamage = Math.max(0, state.total - LETHAL_PLANNER_TARGET);
    const repeatUseCount = state.items.filter(item => item.isRepeat).length;
    const lethalBuffCount = state.items.filter(item => item.sourceKind === 'lethalBuff').length;
    const buffCount = state.items.filter(item => item.type === 'buff').length;
    const estimatedCost = state.items.reduce((total, item) => {
      const cost = Number(getCard(item.cardId)?.cost);
      return total + (Number.isFinite(cost) ? cost : 0);
    }, 0);
    return stepCount * 100
      + overDamage * 20
      + repeatUseCount * 15
      + lethalBuffCount * 10
      + buffCount * 8
      + estimatedCost;
  }

  function getLethalPlannerAutoStateKey_(state) {
    return state.items
      .map(item => `${item.sourceVariantKey}:${item.display || item.value}`)
      .sort()
      .join('|');
  }

  function getLethalPlannerAutoPlanSignature_(plan) {
    const damageParts = plan.items
      .filter(item => item.type !== 'buff')
      .map(item => item.display || String(item.value))
      .sort();
    const buffParts = plan.items
      .filter(item => item.type === 'buff')
      .map(item => item.value)
      .sort((a, b) => b - a);
    return `${damageParts.join('|')}|buff:${buffParts.join('+')}|total:${plan.total}`;
  }

  function deduplicateLethalPlannerAutoPlans_(plans) {
    const representativePlans = new Map();
    for (const plan of plans) {
      const signature = getLethalPlannerAutoPlanSignature_(plan);
      const current = representativePlans.get(signature);
      if (!current || getLethalPlannerAutoStateScore_(plan) < getLethalPlannerAutoStateScore_(current)) {
        representativePlans.set(signature, plan);
      }
    }
    return [...representativePlans.values()].sort((a, b) =>
      getLethalPlannerAutoStateScore_(a) - getLethalPlannerAutoStateScore_(b)
      || a.items.length - b.items.length
    );
  }

  function trimLethalPlannerAutoStates_(states) {
    const uniqueStates = new Map();
    for (const state of states) {
      const key = getLethalPlannerAutoStateKey_(state);
      const current = uniqueStates.get(key);
      if (!current || getLethalPlannerAutoStateScore_(state) < getLethalPlannerAutoStateScore_(current)) {
        uniqueStates.set(key, state);
      }
    }
    return [...uniqueStates.values()]
      .sort((a, b) =>
        getLethalPlannerAutoStateScore_(a) - getLethalPlannerAutoStateScore_(b)
        || a.items.length - b.items.length
      )
      .slice(0, LETHAL_PLANNER_AUTO_BEAM_WIDTH);
  }

  function expandLethalPlannerAutoGroup_(group) {
    const variants = [{ total: 0, items: [] }];
    let frontier = [{ total: 0, items: [] }];
    for (let usedCount = 1; usedCount <= group.count; usedCount += 1) {
      const nextByKey = new Map();
      for (const state of frontier) {
        for (const source of group.sources) {
          const total = state.total + source.value;
          if (total > LETHAL_PLANNER_REPEAT_TARGET) continue;
          const items = [...state.items, source];
          const key = items
            .map(item => item.sourceVariantKey || `${item.sourceKey}:${item.display || item.value}`)
            .sort()
            .join(',');
          if (!nextByKey.has(key)) nextByKey.set(key, { total, items });
        }
      }
      frontier = [...nextByKey.values()];
      variants.push(...frontier);
      if (frontier.length === 0) break;
    }
    return variants;
  }

  function hasValidLethalPlannerAutoBuffs_(items) {
    if (!items.some(item => item.type !== 'buff')) return false;
    const attackCounts = new Map();
    const lethalBuffCounts = new Map();
    const copyUseCounts = new Map();
    const triggerUseCounts = new Map();
    const deckCounts = new Map();
    for (const item of items) {
      deckCounts.set(item.cardId, Math.max(deckCounts.get(item.cardId) || 0, item.deckCount || 0));
      if (item.sourceKind !== 'lethalBuff') {
        copyUseCounts.set(item.cardId, (copyUseCounts.get(item.cardId) || 0) + 1);
      }
      if (item.sourceKind === 'lethalBuff' || item.lethalBurnValue != null) {
        triggerUseCounts.set(item.cardId, (triggerUseCounts.get(item.cardId) || 0) + 1);
      }
      const counts = item.sourceKind === 'attack' && item.lethalBurnValue == null
        ? attackCounts
        : item.sourceKind === 'lethalBuff'
          ? lethalBuffCounts
          : null;
      if (!counts) continue;
      counts.set(item.cardId, (counts.get(item.cardId) || 0) + 1);
    }
    return [...lethalBuffCounts].every(([cardId, count]) =>
      (attackCounts.get(cardId) || 0) >= count
    ) && [...deckCounts].every(([cardId, deckCount]) =>
      Math.max(
        copyUseCounts.get(cardId) || 0,
        triggerUseCounts.get(cardId) || 0
      ) <= deckCount
    );
  }

  function createLethalPlannerSelection_(source) {
    const candidateKey = source.candidateKey || getLethalPlannerCandidateKey_(source.type, source.value);
    const selection = {
      stepId: ++lethalPlannerStepId,
      key: candidateKey,
      type: source.type,
      value: source.value,
      display: source.display || String(source.value),
      attackValue: source.attackValue ?? null,
      lethalBurnValue: source.lethalBurnValue ?? null,
      cardId: source.cardId,
      cardName: source.cardName,
      sourceKey: source.sourceKey,
      sourceKind: source.sourceKind,
      isRepeat: source.isRepeat,
      autoOptionKeys: new Set(
        [...(lethalPlannerCandidates.get(candidateKey)?.sources.values() || [])]
          .map(candidateSource => getLethalPlannerAutoOptionKey_(candidateSource))
          .filter(optionKey =>
            !(allowedAutoLethalOptions instanceof Set) ||
            allowedAutoLethalOptions.has(optionKey)
          )
      ),
    };
    if (source.sourceKind === 'attack') {
      const candidate = lethalPlannerCandidates.get(candidateKey);
      selection.candidateSources = [...(candidate?.sources.values() || [])]
        .filter(candidateSource => candidateSource.sourceKind === 'attack')
        .map(candidateSource => ({
          cardId: candidateSource.cardId,
          cardName: candidateSource.cardName,
          sourceKey: candidateSource.sourceKey,
          count: candidateSource.count,
          isRepeat: candidateSource.isRepeat,
        }));
      selection.locked = false;
    }
    return selection;
  }

  function buildLethalPlannerAutoSelections_(items) {
    const selections = items.map(createLethalPlannerSelection_);
    const availableAttacks = new Map();
    for (const selection of selections) {
      if (selection.sourceKind !== 'attack' || selection.lethalBurnValue != null) continue;
      if (!availableAttacks.has(selection.cardId)) availableAttacks.set(selection.cardId, []);
      availableAttacks.get(selection.cardId).push(selection);
    }
    for (const selection of selections) {
      if (selection.sourceKind !== 'lethalBuff') continue;
      const attackSelection = availableAttacks.get(selection.cardId)?.shift();
      if (!attackSelection) return null;
      attackSelection.locked = true;
      selection.linkedAttackStepId = attackSelection.stepId;
    }
    return selections;
  }

  function generateLethalPlannerAutoPlans_(enabledOptionKeys = null) {
    let statesByTotal = new Map([[0, [{ total: 0, items: [] }]]]);
    for (const group of getLethalPlannerAutoSourceGroups_(enabledOptionKeys)) {
      const variants = expandLethalPlannerAutoGroup_(group);
      const nextByTotal = new Map();
      for (const states of statesByTotal.values()) {
        for (const state of states) {
          for (const variant of variants) {
            const total = state.total + variant.total;
            if (total > LETHAL_PLANNER_REPEAT_TARGET) continue;
            if (!nextByTotal.has(total)) nextByTotal.set(total, []);
            nextByTotal.get(total).push({
              total,
              items: [...state.items, ...variant.items],
            });
          }
        }
      }
      statesByTotal = new Map(
        [...nextByTotal].map(([total, states]) => [total, trimLethalPlannerAutoStates_(states)])
      );
    }

    const plans = [];
    for (let total = LETHAL_PLANNER_TARGET; total <= LETHAL_PLANNER_REPEAT_TARGET; total += 1) {
      for (const state of statesByTotal.get(total) || []) {
        if (hasValidLethalPlannerAutoBuffs_(state.items)) plans.push(state);
      }
    }
    return deduplicateLethalPlannerAutoPlans_(plans)
      .slice(0, LETHAL_PLANNER_AUTO_RESULT_LIMIT);
  }

  function applyLethalPlannerAutoPlan_(plan) {
    lethalPlannerStepId = 0;
    const selections = buildLethalPlannerAutoSelections_(plan.items);
    if (!selections) return;
    lethalPlannerAutoFilterActive = allowedAutoLethalOptions instanceof Set;
    lethalPlannerSelections.splice(0, lethalPlannerSelections.length, ...selections);
    lethalPlannerCardSelections.clear();
    renderLethalPlanner_();
  }

  function loadLethalPlannerPlanForEditing_(plan) {
    const steps = plan?.variants?.[0]?.steps;
    if (!Array.isArray(steps) || steps.length === 0) return false;
    lethalPlannerStepId = 0;
    const selections = buildLethalPlannerAutoSelections_(steps);
    if (!selections) return false;
    lethalPlannerAutoFilterActive = false;
    lethalPlannerSelections.splice(0, lethalPlannerSelections.length, ...selections);
    lethalPlannerCardSelections.clear();
    renderLethalPlanner_();
    return true;
  }

  function getLethalAutoFilterOptionLabel_(source) {
    const repeatSuffix = source.isRepeat ? '（繰り返し）' : '';
    if (source.lethalBurnValue != null) {
      return `攻撃+バーン ${source.detailDisplay}${repeatSuffix}`;
    }
    if (source.sourceKind === 'attack') return `攻撃 ${source.display}${repeatSuffix}`;
    if (source.sourceKind === 'freeBurn') return `バーン ${source.value}${repeatSuffix}`;
    if (source.sourceKind === 'freeBuff') return `バフ +${source.value}${repeatSuffix}`;
    if (source.sourceKind === 'lethalBuff') {
      return `攻撃成功時バフ +${source.value}${repeatSuffix}`;
    }
    return `${source.display || source.value}${repeatSuffix}`;
  }

  function getLethalAutoFilterCardGroups_() {
    const groups = new Map();
    for (const candidate of lethalPlannerCandidates.values()) {
      for (const source of candidate.sources.values()) {
        if (!groups.has(source.cardId)) {
          groups.set(source.cardId, {
            cardId: source.cardId,
            cardName: source.cardName,
            count: source.deckCount,
            deckOrder: source.deckOrder,
            options: new Map(),
          });
        }
        const optionKey = getLethalPlannerAutoOptionKey_(source);
        if (!groups.get(source.cardId).options.has(optionKey)) {
          groups.get(source.cardId).options.set(optionKey, {
            key: optionKey,
            source,
            label: getLethalAutoFilterOptionLabel_(source),
          });
        }
      }
    }

    for (const group of groups.values()) {
      const options = [...group.options.values()];
      for (const option of options) {
        const source = option.source;
        option.defaultChecked =
          !source.defaultOff &&
          !source.isRepeat &&
          source.lethalBurnValue == null &&
          source.sourceKind !== 'lethalBuff' &&
          (
            source.sourceKind === 'attack' ||
            source.sourceKind === 'freeBurn' ||
            source.sourceKind === 'freeBuff'
          ) &&
          source.isMinimumValue;
      }
    }

    return [...groups.values()].sort((a, b) => {
      const comparison = window.compareCards?.(getCard(a.cardId), getCard(b.cardId));
      if (Number.isFinite(comparison) && comparison !== 0) return comparison;
      return a.deckOrder - b.deckOrder || a.cardName.localeCompare(b.cardName, 'ja');
    });
  }

  function closeLethalAutoFilterModal_() {
    if (!lethalAutoFilterModal) return;
    lethalAutoFilterModal.hidden = true;
    document.body.classList.remove('lethal-auto-filter-open');
    lethalAutoFilterLastFocus?.focus?.();
    lethalAutoFilterLastFocus = null;
  }

  function getLethalAutoFilterChipLabel_(source) {
    const repeatSuffix = source.isRepeat ? '↻' : '';
    if (source.lethalBurnValue != null || source.sourceKind === 'attack') {
      return `⚔${source.lethalBurnValue != null ? source.detailDisplay : source.display}${repeatSuffix}`;
    }
    if (source.sourceKind === 'freeBurn') return `🔥${source.value}${repeatSuffix}`;
    if (source.sourceKind === 'freeBuff' || source.sourceKind === 'lethalBuff') {
      return `✨+${source.value}${repeatSuffix}`;
    }
    return `${source.display || source.value}${repeatSuffix}`;
  }

  function getLethalAutoFilterSummaryOrder_(source) {
    if (source.lethalBurnValue != null || source.sourceKind === 'attack') {
      return { category: 0, value: source.value };
    }
    if (source.sourceKind === 'freeBurn') return { category: 1, value: source.value };
    if (source.sourceKind === 'freeBuff' || source.sourceKind === 'lethalBuff') {
      return { category: 2, value: source.value };
    }
    return { category: 3, value: source.value };
  }

  function renderLethalAutoFilterChips_() {
    if (!lethalAutoFilterModal) return;
    const chips = lethalAutoFilterModal.querySelector('[data-lethal-auto-chips]');
    if (!chips) return;
    chips.replaceChildren();
    const checkedInputs = [
      ...lethalAutoFilterModal.querySelectorAll('[data-lethal-auto-option]:checked'),
    ];
    if (checkedInputs.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'lethal-auto-filter-modal__chips-empty';
      empty.textContent = '選択中: なし';
      chips.appendChild(empty);
      return;
    }

    const heading = document.createElement('span');
    heading.className = 'lethal-auto-filter-modal__chips-label';
    heading.textContent = '選択中:';
    chips.appendChild(heading);
    const selectedCounts = new Map();
    for (const input of checkedInputs) {
      const label = input.dataset.chipLabel;
      if (!selectedCounts.has(label)) {
        selectedCounts.set(label, {
          label,
          count: 0,
          category: Number(input.dataset.summaryCategory),
          value: Number(input.dataset.summaryValue),
        });
      }
      selectedCounts.get(label).count += 1;
    }
    const selectedItems = [...selectedCounts.values()].sort((a, b) =>
      a.category - b.category ||
      a.value - b.value ||
      a.label.localeCompare(b.label, 'ja')
    );
    for (const { label, count } of selectedItems) {
      const item = document.createElement('span');
      item.className = 'lethal-auto-filter-modal__selected-item';
      item.appendChild(document.createTextNode(label));
      if (count > 1) {
        const countLabel = document.createElement('span');
        countLabel.className = 'lethal-auto-filter-modal__selected-count';
        countLabel.textContent = `×${count}`;
        countLabel.setAttribute('aria-label', `${count}件`);
        item.appendChild(countLabel);
      }
      chips.appendChild(item);
    }
  }

  function resetLethalAutoFilterChecks_(mode) {
    if (!lethalAutoFilterModal) return;
    lethalAutoFilterModal.querySelectorAll('[data-lethal-auto-option]').forEach(input => {
      if (mode === 'all') input.checked = true;
      else if (mode === 'none') input.checked = false;
      else input.checked = input.dataset.defaultChecked === 'true';
    });
    renderLethalAutoFilterChips_();
  }

  function ensureLethalAutoFilterModal_() {
    if (lethalAutoFilterModal?.isConnected) return lethalAutoFilterModal;
    const modal = document.createElement('div');
    modal.className = 'lethal-auto-filter-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <section class="lethal-auto-filter-modal__dialog" role="dialog" aria-modal="true"
        aria-labelledby="lethal-auto-filter-title" aria-describedby="lethal-auto-filter-description">
        <header class="lethal-auto-filter-modal__header">
          <div>
            <h3 id="lethal-auto-filter-title">リーサル手段を選択</h3>
            <p id="lethal-auto-filter-description">自動生成に含めるカードと手段を選んでください</p>
          </div>
          <button type="button" class="lethal-auto-filter-modal__close"
            data-lethal-auto-close aria-label="閉じる">×</button>
        </header>
        <div class="lethal-auto-filter-modal__bulk">
          <button type="button" data-lethal-auto-check="all">すべて選択</button>
          <button type="button" data-lethal-auto-check="none">すべて解除</button>
          <button type="button" data-lethal-auto-check="default">初期状態に戻す</button>
        </div>
        <div class="lethal-auto-filter-modal__chips" data-lethal-auto-chips></div>
        <div class="lethal-auto-filter-modal__cards" data-lethal-auto-cards></div>
        <footer class="lethal-auto-filter-modal__footer">
          <button type="button" class="lethal-auto-filter-modal__cancel"
            data-lethal-auto-close>キャンセル</button>
          <button type="button" class="lethal-auto-filter-modal__generate"
            data-lethal-auto-generate>この条件で生成</button>
        </footer>
      </section>
    `;
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-lethal-auto-close]')) {
        closeLethalAutoFilterModal_();
        return;
      }
      const checkButton = event.target.closest('[data-lethal-auto-check]');
      if (checkButton) {
        resetLethalAutoFilterChecks_(checkButton.dataset.lethalAutoCheck);
        return;
      }
      if (!event.target.closest('[data-lethal-auto-generate]')) return;
      const enabledOptionKeys = new Set(
        [...modal.querySelectorAll('[data-lethal-auto-option]:checked')]
          .map(input => input.value)
      );
      closeLethalAutoFilterModal_();
      allowedAutoLethalOptions = new Set(enabledOptionKeys);
      lethalPlannerAutoFilterActive = true;
      lethalPlannerAutoSearched = true;
      lethalPlannerAutoExpanded = false;
      lethalPlannerAutoPlans = generateLethalPlannerAutoPlans_(allowedAutoLethalOptions);
      if (lethalPlannerAutoPlans[0]) applyLethalPlannerAutoPlan_(lethalPlannerAutoPlans[0]);
      else renderLethalPlannerAutoPlans_();
    });
    modal.addEventListener('change', event => {
      if (event.target.matches('[data-lethal-auto-option]')) {
        renderLethalAutoFilterChips_();
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !modal.hidden) closeLethalAutoFilterModal_();
    });
    document.body.appendChild(modal);
    lethalAutoFilterModal = modal;
    return modal;
  }

  function openLethalAutoFilterModal_(trigger) {
    const modal = ensureLethalAutoFilterModal_();
    const cardsContainer = modal.querySelector('[data-lethal-auto-cards]');
    cardsContainer.replaceChildren();
    const groups = getLethalAutoFilterCardGroups_();
    for (const group of groups) {
      const cardRow = document.createElement('article');
      cardRow.className = 'lethal-auto-filter-card';

      const image = document.createElement('img');
      image.className = 'lethal-auto-filter-card__image';
      image.src = imgSrcOf(group.cardId);
      image.alt = '';
      image.onerror = () => {
        if (image.dataset.fallbackApplied) return;
        image.dataset.fallbackApplied = '1';
        image.src = FALLBACK_IMG;
      };
      cardRow.appendChild(image);

      const content = document.createElement('div');
      content.className = 'lethal-auto-filter-card__content';
      const title = document.createElement('h4');
      title.className = 'lethal-auto-filter-card__title';
      title.textContent = `${group.cardName} ×${group.count}`;
      content.appendChild(title);

      const options = document.createElement('div');
      options.className = 'lethal-auto-filter-card__options';
      for (const option of group.options.values()) {
        const label = document.createElement('label');
        label.className = 'lethal-auto-filter-card__option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = option.key;
        input.checked = allowedAutoLethalOptions instanceof Set
          ? allowedAutoLethalOptions.has(option.key)
          : option.defaultChecked;
        input.dataset.defaultChecked = String(option.defaultChecked);
        input.dataset.chipLabel = getLethalAutoFilterChipLabel_(option.source);
        const summaryOrder = getLethalAutoFilterSummaryOrder_(option.source);
        input.dataset.summaryCategory = String(summaryOrder.category);
        input.dataset.summaryValue = String(summaryOrder.value);
        input.setAttribute('data-lethal-auto-option', '');
        label.append(input, document.createTextNode(option.label));
        options.appendChild(label);
      }
      content.appendChild(options);
      cardRow.appendChild(content);
      cardsContainer.appendChild(cardRow);
    }
    renderLethalAutoFilterChips_();

    lethalAutoFilterLastFocus = trigger || document.activeElement;
    modal.hidden = false;
    document.body.classList.add('lethal-auto-filter-open');
    modal.querySelector('[data-lethal-auto-generate]')?.focus();
  }

  function renderLethalPlannerAutoPlans_() {
    const results = document.getElementById('lethal-planner-auto-results');
    if (!results) return;
    hideLethalAutoCardsPopup_();
    results.innerHTML = '';
    if (lethalPlannerAutoPlans.length === 0) {
      if (lethalPlannerAutoSearched) {
        const empty = document.createElement('span');
        empty.className = 'lethal-planner__auto-empty';
        empty.textContent = '30〜35点の候補が見つかりませんでした';
        results.appendChild(empty);
        appendLethalAutoSelectedCardsButton_(results);
      }
      return;
    }

    const visibleLimit = lethalPlannerAutoExpanded
      ? LETHAL_PLANNER_AUTO_RESULT_LIMIT
      : LETHAL_PLANNER_AUTO_INITIAL_RESULT_LIMIT;
    lethalPlannerAutoPlans.slice(0, visibleLimit).forEach((plan, index) => {
      const row = document.createElement('div');
      row.className = 'lethal-planner__auto-result-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lethal-planner__auto-result';
      button.dataset.lethalAutoIndex = String(index);
      const values = plan.items.map(item =>
        item.type === 'buff' ? `(+${item.value})` : (item.display || String(item.value))
      );
      button.textContent = `候補${index + 1}　${plan.total}点: ${values.join(' + ')}`;
      row.appendChild(button);
      results.appendChild(row);
    });
    if (lethalPlannerAutoPlans.length > LETHAL_PLANNER_AUTO_INITIAL_RESULT_LIMIT) {
      const toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'lethal-planner__auto-toggle';
      toggleButton.textContent = lethalPlannerAutoExpanded ? '少なく表示' : 'もっと見る';
      toggleButton.setAttribute('aria-expanded', String(lethalPlannerAutoExpanded));
      results.appendChild(toggleButton);
    }
    appendLethalAutoSelectedCardsButton_(results);
  }

  function toggleLethalPlannerAutoResults_() {
    if (lethalPlannerAutoPlans.length <= LETHAL_PLANNER_AUTO_INITIAL_RESULT_LIMIT) return;
    lethalPlannerAutoExpanded = !lethalPlannerAutoExpanded;
    renderLethalPlannerAutoPlans_();
    document.dispatchEvent(new CustomEvent('lethal-planner:rendered'));
  }

  function appendLethalAutoSelectedCardsButton_(container) {
    if (!(allowedAutoLethalOptions instanceof Set) || allowedAutoLethalOptions.size === 0) {
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'lethal-planner__auto-cards-control';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lethal-planner__auto-cards-button';
    button.setAttribute('aria-label', '自動生成条件で選択したカードを表示');
    button.title = '選択したカードを表示';
    const image = document.createElement('img');
    image.className = 'lethal-planner__auto-cards-icon';
    image.src = 'img/00000.webp';
    image.alt = '';
    const label = document.createElement('span');
    label.className = 'lethal-planner__auto-cards-label';
    label.textContent = '条件カード';
    button.append(image, label);
    wrapper.appendChild(button);
    container.appendChild(wrapper);
  }

  function getLethalAutoSelectedCards_() {
    if (!(allowedAutoLethalOptions instanceof Set)) return [];
    const cards = new Map();
    for (const candidate of lethalPlannerCandidates.values()) {
      for (const source of candidate.sources.values()) {
        if (
          !allowedAutoLethalOptions.has(getLethalPlannerAutoOptionKey_(source)) ||
          cards.has(source.cardId)
        ) {
          continue;
        }
        cards.set(source.cardId, {
          cd: source.cardId,
          name: source.cardName || getCard(source.cardId)?.name || source.cardId,
        });
      }
    }
    return [...cards.values()];
  }

  function ensureLethalAutoCardsPopup_() {
    if (lethalAutoCardsPopup?.isConnected) return lethalAutoCardsPopup;
    const popup = document.createElement('div');
    popup.className = 'lethal-auto-cards-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', '自動生成条件で選択したカード');
    popup.hidden = true;
    document.body.appendChild(popup);
    lethalAutoCardsPopup = popup;
    return popup;
  }

  function hideLethalAutoCardsPopup_() {
    lethalAutoCardsPopupButton = null;
    if (!lethalAutoCardsPopup) return;
    lethalAutoCardsPopup.hidden = true;
    lethalAutoCardsPopup.replaceChildren();
  }

  function positionLethalAutoCardsPopup_(button, popup) {
    const buttonRect = button.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const margin = 8;
    const gap = 7;
    const left = Math.min(
      window.innerWidth - popupRect.width - margin,
      Math.max(margin, buttonRect.right - popupRect.width)
    );
    const fitsBelow = buttonRect.bottom + gap + popupRect.height <= window.innerHeight - margin;
    const top = fitsBelow
      ? buttonRect.bottom + gap
      : Math.max(margin, buttonRect.top - popupRect.height - gap);
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  function showLethalAutoCardsPopup_(button) {
    const cards = getLethalAutoSelectedCards_();
    if (cards.length === 0) return;
    const popup = ensureLethalAutoCardsPopup_();
    popup.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'lethal-auto-cards-popup__title';
    heading.textContent = '選択したカード';
    popup.appendChild(heading);
    for (const card of cards) {
      const item = document.createElement('div');
      item.className = 'lethal-auto-cards-popup__card';
      item.title = card.name;
      const image = document.createElement('img');
      image.className = 'lethal-auto-cards-popup__image';
      image.src = imgSrcOf(card.cd);
      image.alt = card.name;
      image.onerror = () => {
        if (image.dataset.fallbackApplied) return;
        image.dataset.fallbackApplied = '1';
        image.src = FALLBACK_IMG;
      };
      item.appendChild(image);
      popup.appendChild(item);
    }
    lethalAutoCardsPopupButton = button;
    popup.hidden = false;
    positionLethalAutoCardsPopup_(button, popup);
  }

  function toggleLethalAutoCardsPopup_(button) {
    if (lethalAutoCardsPopupButton === button && !lethalAutoCardsPopup?.hidden) {
      hideLethalAutoCardsPopup_();
      return;
    }
    showLethalAutoCardsPopup_(button);
  }

  function appendLethalPlannerChip_(container, selection, selectionIndex, isBuff) {
    const chip = document.createElement('span');
    chip.className = `lethal-planner__term${isBuff ? ' lethal-planner__term--buff' : ''}`;
    chip.draggable = true;
    chip.dataset.lethalSelectionIndex = String(selectionIndex);

    const type = lethalPlannerTypes.find(item => item.key === selection.type);
    const icon = document.createElement('span');
    icon.className = 'lethal-planner__term-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = type?.icon || '';
    chip.appendChild(icon);

    const value = document.createElement('span');
    value.className = 'lethal-planner__term-value';
    value.textContent = isBuff ? `(+${selection.value})` : (selection.display || String(selection.value));
    chip.appendChild(value);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'lethal-planner__term-remove';
    remove.dataset.lethalSelectionIndex = String(selectionIndex);
    remove.setAttribute('aria-label', `${selection.display || selection.value}を式から削除`);
    remove.textContent = '×';
    chip.appendChild(remove);
    container.appendChild(chip);
  }

  function appendLethalPlannerSeparator_(container) {
    const separator = document.createElement('span');
    separator.className = 'lethal-planner__operator';
    separator.textContent = '+';
    container.appendChild(separator);
  }

  function supportsLethalCandidateTooltip_() {
    return window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;
  }

  function ensureLethalCandidateTooltip_() {
    if (lethalCandidateTooltip?.isConnected) return lethalCandidateTooltip;
    const tooltip = document.createElement('div');
    tooltip.className = 'lethal-candidate-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    lethalCandidateTooltip = tooltip;
    return tooltip;
  }

  function hideLethalCandidateTooltip_() {
    if (lethalCandidateTooltipTimer !== null) {
      window.clearTimeout(lethalCandidateTooltipTimer);
      lethalCandidateTooltipTimer = null;
    }
    lethalCandidateTooltipButton = null;
    if (!lethalCandidateTooltip) return;
    lethalCandidateTooltip.hidden = true;
    lethalCandidateTooltip.setAttribute('aria-hidden', 'true');
    lethalCandidateTooltip.replaceChildren();
  }

  function getAvailableCardsForLethalCandidate_(candidate) {
    if (!candidate?.sources) return [];
    const sources = [...candidate.sources.values()];
    if (sources.some(source => source.requiresAttack)) {
      const cards = new Map();
      const previewStepId = `preview:${candidate.key}`;
      for (const source of sources) {
        for (const attackAssignment of getLethalPlannerAttackAssignments_(source)) {
          const previewStep = {
            stepId: previewStepId,
            key: candidate.key,
            type: candidate.type,
            value: candidate.value,
            display: candidate.display,
            sourceKind: source.sourceKind,
            linkedAttackStepId: attackAssignment.selection.stepId,
          };
          const resolved = resolveSelectedLethalStepCandidates_([
            ...lethalPlannerSelections,
            previewStep,
          ]).get(previewStepId);
          const possibleCards = [
            ...(resolved?.fixedCards || []),
            ...(resolved?.candidateCards || []),
          ];
          for (const card of possibleCards) {
            if (card.cd === source.cardId && !cards.has(card.cd)) cards.set(card.cd, card);
          }
        }
      }
      return [...cards.values()];
    }

    const previewStepId = `preview:${candidate.key}`;
    const previewSource = sources[0];
    const resolved = resolveSelectedLethalStepCandidates_([
      ...lethalPlannerSelections,
      {
        stepId: previewStepId,
        key: candidate.key,
        type: candidate.type,
        value: candidate.value,
        display: candidate.display,
        sourceKind: previewSource?.sourceKind || candidate.type,
        attackValue: candidate.attackValue,
        lethalBurnValue: candidate.lethalBurnValue,
      },
    ]).get(previewStepId);
    return resolved ? [...resolved.fixedCards, ...resolved.candidateCards] : [];
  }

  function positionLethalCandidateTooltip_(button, tooltip) {
    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportMargin = 8;
    const gap = 7;
    const left = Math.min(
      window.innerWidth - tooltipRect.width - viewportMargin,
      Math.max(viewportMargin, buttonRect.left + (buttonRect.width - tooltipRect.width) / 2)
    );
    const fitsBelow = buttonRect.bottom + gap + tooltipRect.height <= window.innerHeight - viewportMargin;
    const top = fitsBelow
      ? buttonRect.bottom + gap
      : Math.max(viewportMargin, buttonRect.top - tooltipRect.height - gap);
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function showLethalCandidateTooltip_(button, candidate) {
    if (
      !supportsLethalCandidateTooltip_() ||
      button.disabled ||
      !button.isConnected
    ) {
      return;
    }
    let cards = getAvailableCardsForLethalCandidate_(candidate);
    if (lethalPlannerAutoFilterActive && allowedAutoLethalOptions instanceof Set) {
      const allowedCardIds = new Set(
        [...candidate.sources.values()]
          .filter(source =>
            allowedAutoLethalOptions.has(getLethalPlannerAutoOptionKey_(source))
          )
          .map(source => source.cardId)
      );
      cards = cards.filter(card => allowedCardIds.has(card.cd));
    }
    if (cards.length === 0) return;

    const tooltip = ensureLethalCandidateTooltip_();
    tooltip.replaceChildren();
    for (const card of cards.slice(0, LETHAL_CANDIDATE_TOOLTIP_MAX_CARDS)) {
      const cardItem = document.createElement('span');
      cardItem.className = 'lethal-candidate-tooltip__card';
      const image = document.createElement('img');
      image.className = 'lethal-candidate-tooltip__image';
      image.src = imgSrcOf(card.cd);
      image.alt = '';
      image.title = card.supplement ? `${card.name}: ${card.supplement}` : card.name;
      image.onerror = () => {
        if (image.dataset.fallbackApplied) return;
        image.dataset.fallbackApplied = '1';
        image.src = FALLBACK_IMG;
      };
      cardItem.appendChild(image);
      if (card.supplement) {
        const supplement = document.createElement('span');
        supplement.className = 'lethal-candidate-tooltip__supplement';
        supplement.textContent = card.supplement;
        cardItem.appendChild(supplement);
      }
      tooltip.appendChild(cardItem);
    }
    if (cards.length > LETHAL_CANDIDATE_TOOLTIP_MAX_CARDS) {
      const remainder = document.createElement('span');
      remainder.className = 'lethal-candidate-tooltip__remainder';
      remainder.textContent = `+${cards.length - LETHAL_CANDIDATE_TOOLTIP_MAX_CARDS}`;
      tooltip.appendChild(remainder);
    }

    lethalCandidateTooltipButton = button;
    tooltip.hidden = false;
    tooltip.setAttribute('aria-hidden', 'false');
    positionLethalCandidateTooltip_(button, tooltip);
  }

  function scheduleLethalCandidateTooltip_(button, candidate) {
    hideLethalCandidateTooltip_();
    if (!supportsLethalCandidateTooltip_() || button.disabled) return;
    lethalCandidateTooltipButton = button;
    lethalCandidateTooltipTimer = window.setTimeout(() => {
      lethalCandidateTooltipTimer = null;
      if (lethalCandidateTooltipButton !== button) return;
      showLethalCandidateTooltip_(button, candidate);
    }, LETHAL_CANDIDATE_TOOLTIP_DELAY);
  }

  function bindLethalCandidateTooltip_(button, candidate) {
    button.addEventListener('mouseenter', () => {
      scheduleLethalCandidateTooltip_(button, candidate);
    });
    button.addEventListener('mouseleave', hideLethalCandidateTooltip_);
    button.addEventListener('focus', () => {
      scheduleLethalCandidateTooltip_(button, candidate);
    });
    button.addEventListener('blur', hideLethalCandidateTooltip_);
  }

  function renderLethalPlanner_() {
    const root = document.getElementById('lethal-planner');
    const groupsEl = document.getElementById('lethal-planner-groups');
    if (!root || !groupsEl) return;
    hideLethalCandidateTooltip_();

    const total = lethalPlannerSelections.reduce((sum, selection) => sum + selection.value, 0);
    const expressionEl = document.getElementById('lethal-planner-expression');
    expressionEl.innerHTML = '';
    if (lethalPlannerSelections.length === 0) {
      expressionEl.textContent = '= 0';
    } else {
      lethalPlannerSelections.forEach((selection, index) => {
        if (index > 0) appendLethalPlannerSeparator_(expressionEl);
        appendLethalPlannerChip_(expressionEl, selection, index, selection.type === 'buff');
      });

      const result = document.createElement('span');
      result.className = 'lethal-planner__result';
      result.textContent = `= ${total}`;
      expressionEl.appendChild(result);
    }

    const isComplete = total >= LETHAL_PLANNER_TARGET;
    const isJustLethal = total >= LETHAL_PLANNER_TARGET && total <= LETHAL_PLANNER_REPEAT_TARGET;
    const isOverLethal = total > LETHAL_PLANNER_REPEAT_TARGET;
    root.classList.toggle('is-complete', isComplete);
    root.classList.toggle('is-just-lethal', isJustLethal);
    root.classList.toggle('is-over-lethal', isOverLethal);

    groupsEl.innerHTML = '';
    let candidateCount = 0;
    for (const type of lethalPlannerTypes) {
      const candidates = [...lethalPlannerCandidates.values()]
        .filter(candidate => candidate.type === type.key)
        .sort((a, b) => a.value - b.value || a.display.localeCompare(b.display));

      for (const candidate of candidates) {
        candidateCount += 1;
        const key = candidate.key;
        const availableCards = getAvailableCardsForLethalCandidate_(candidate);
        const availableSource = getAvailableLethalPlannerSource_(candidate, availableCards);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lethal-planner__value';
        button.dataset.lethalKey = key;
        button.disabled = availableCards.length === 0 || !availableSource;
        button.setAttribute(
          'aria-label',
          `${type.label} ${candidate.display}${availableSource ? 'を式に追加' : 'は使用可能なカード枠がありません'}`
        );

        const icon = document.createElement('span');
        icon.className = 'lethal-planner__value-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = type.icon;
        button.appendChild(icon);

        const value = document.createElement('span');
        value.className = 'lethal-planner__value-number';
        value.textContent = `${type.key === 'buff' ? '+' : ''}${candidate.display}`;
        button.appendChild(value);
        bindLethalCandidateTooltip_(button, candidate);
        groupsEl.appendChild(button);
      }
    }

    if (candidateCount === 0) {
      const empty = document.createElement('span');
      empty.className = 'lethal-planner__empty';
      empty.textContent = '候補なし';
      groupsEl.appendChild(empty);
    }

    renderLethalPlannerCards_();
    renderLethalPlannerAutoPlans_();
    window.DeckmakerLethalPost?.validate?.();
    document.dispatchEvent(new CustomEvent('lethal-planner:rendered'));
  }

  function getSelectedLethalCardGroups_() {
    const resolvedSteps = resolveSelectedLethalStepCandidates_(lethalPlannerSelections);
    const groups = new Map();
    for (const selection of lethalPlannerSelections) {
      const resolved = resolvedSteps.get(selection.stepId);
      if (!groups.has(selection.key)) {
        groups.set(selection.key, {
          key: selection.key,
          type: selection.type,
          value: selection.value,
          display: selection.display || String(selection.value),
          requiredCount: 0,
          stepIds: [],
          cardsById: new Map(),
        });
      }
      const group = groups.get(selection.key);
      group.requiredCount += 1;
      group.stepIds.push(selection.stepId);
      for (const card of [...(resolved?.fixedCards || []), ...(resolved?.candidateCards || [])]) {
        const cardId = normCd5(card.cd);
        if (!group.cardsById.has(cardId)) group.cardsById.set(cardId, card);
      }
    }
    return [...groups.values()].map(group => ({
      ...group,
      cards: [...group.cardsById.values()],
    }));
  }

  function getLethalPlannerDeckCount_(cardId) {
    return Number(deck[normCd5(cardId)] || 0);
  }

  function getLethalPlannerGroupCardSelections_(groupKey, create = false) {
    let selections = lethalPlannerCardSelections.get(groupKey);
    if (!selections && create) {
      selections = new Map();
      lethalPlannerCardSelections.set(groupKey, selections);
    }
    return selections;
  }

  function getLethalPlannerGroupSelectedCount_(groupKey) {
    return [...(getLethalPlannerGroupCardSelections_(groupKey)?.values() || [])]
      .reduce((total, count) => total + count, 0);
  }

  function getLethalPlannerSelectedCardCounts_() {
    const counts = new Map();
    for (const selections of lethalPlannerCardSelections.values()) {
      for (const [cardId, count] of selections) {
        counts.set(cardId, (counts.get(cardId) || 0) + count);
      }
    }
    return counts;
  }

  function getCurrentLethalPlanVariant_() {
    if (lethalPlannerSelections.length === 0) return null;
    const groups = getSelectedLethalCardGroups_();
    sanitizeLethalPlannerCardSelections_(groups);
    autoSelectSingleLethalCandidates_(groups);
    const assignedByGroup = new Map();
    for (const group of groups) {
      const assigned = [];
      for (const [cardId, count] of getLethalPlannerGroupCardSelections_(group.key) || []) {
        for (let index = 0; index < count; index += 1) assigned.push(cardId);
      }
      if (assigned.length !== group.requiredCount) return null;
      assignedByGroup.set(group.key, assigned);
    }

    const stepIndexes = new Map(lethalPlannerSelections.map((step, index) => [step.stepId, index]));
    const steps = lethalPlannerSelections.map(selection => {
      const cardId = assignedByGroup.get(selection.key)?.shift() || '';
      const card = getCard(cardId);
      return {
        cardId,
        cardName: card?.name || selection.cardName || cardId,
        type: selection.type,
        value: Number(selection.value) || 0,
        display: selection.display || String(selection.value),
        sourceKind: selection.sourceKind || '',
        sourceKey: selection.sourceKey || '',
        attackValue: selection.attackValue ?? null,
        lethalBurnValue: selection.lethalBurnValue ?? null,
        isRepeat: selection.isRepeat === true,
        linkedStepIndex: stepIndexes.has(selection.linkedAttackStepId)
          ? stepIndexes.get(selection.linkedAttackStepId)
          : null,
      };
    });
    const values = lethalPlannerSelections.map(selection => Number(selection.value) || 0);
    return { values, total: values.reduce((sum, value) => sum + value, 0), variant: { steps } };
  }

  function buildLethalVariantFromAssignments_(assignedByGroup) {
    const queues = new Map(
      [...assignedByGroup].map(([key, cardIds]) => [key, [...cardIds]])
    );
    const stepIndexes = new Map(lethalPlannerSelections.map((step, index) => [step.stepId, index]));
    return {
      steps: lethalPlannerSelections.map(selection => {
        const cardId = queues.get(selection.key)?.shift() || '';
        const card = getCard(cardId);
        return {
          cardId,
          cardName: card?.name || selection.cardName || cardId,
          type: selection.type,
          value: Number(selection.value) || 0,
          display: selection.display || String(selection.value),
          sourceKind: selection.sourceKind || '',
          sourceKey: selection.sourceKey || '',
          attackValue: selection.attackValue ?? null,
          lethalBurnValue: selection.lethalBurnValue ?? null,
          isRepeat: selection.isRepeat === true,
          linkedStepIndex: stepIndexes.has(selection.linkedAttackStepId)
            ? stepIndexes.get(selection.linkedAttackStepId)
            : null,
        };
      }),
    };
  }

  function getLethalGroupAllocations_(group) {
    const cards = group.cards.map(card => normCd5(card.cd));
    const results = [];
    function visit(cardIndex, remaining, selected) {
      if (cardIndex >= cards.length) {
        if (remaining === 0) results.push([...selected]);
        return;
      }
      const cardId = cards[cardIndex];
      const maxCount = Math.min(remaining, getLethalPlannerDeckCount_(cardId));
      for (let count = 0; count <= maxCount; count += 1) {
        for (let index = 0; index < count; index += 1) selected.push(cardId);
        visit(cardIndex + 1, remaining - count, selected);
        selected.splice(selected.length - count, count);
      }
    }
    visit(0, group.requiredCount, []);
    return results;
  }

  function getLethalPlannerPlanCandidates_() {
    const values = lethalPlannerSelections.map(selection => Number(selection.value) || 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    if (values.length === 0) return { values, total, variants: [] };
    const groups = getSelectedLethalCardGroups_();
    const allocationsByGroup = groups.map(group => ({
      key: group.key,
      allocations: getLethalGroupAllocations_(group),
    }));
    const variants = [];
    function combine(groupIndex, assignedByGroup, usedCounts) {
      if (groupIndex >= allocationsByGroup.length) {
        variants.push(buildLethalVariantFromAssignments_(assignedByGroup));
        return;
      }
      const group = allocationsByGroup[groupIndex];
      for (const allocation of group.allocations) {
        const added = new Map();
        let valid = true;
        for (const cardId of allocation) {
          added.set(cardId, (added.get(cardId) || 0) + 1);
        }
        for (const [cardId, count] of added) {
          if ((usedCounts.get(cardId) || 0) + count > getLethalPlannerDeckCount_(cardId)) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;
        for (const [cardId, count] of added) usedCounts.set(cardId, (usedCounts.get(cardId) || 0) + count);
        assignedByGroup.set(group.key, allocation);
        combine(groupIndex + 1, assignedByGroup, usedCounts);
        assignedByGroup.delete(group.key);
        for (const [cardId, count] of added) {
          const next = (usedCounts.get(cardId) || 0) - count;
          if (next > 0) usedCounts.set(cardId, next);
          else usedCounts.delete(cardId);
        }
      }
    }
    combine(0, new Map(), new Map());
    return { values, total, variants };
  }

  function getLethalPlannerCardsForKey_(key) {
    const candidate = lethalPlannerCandidates.get(String(key || ''));
    if (!candidate) return [];
    return getAvailableCardsForLethalCandidate_(candidate).map(card => ({
      cardId: normCd5(card.cd),
      cardName: card.name || normCd5(card.cd),
    }));
  }

  function getLethalPlannerComposerStatus_() {
    const total = lethalPlannerSelections.reduce(
      (sum, selection) => sum + (Number(selection.value) || 0),
      0
    );
    const groups = getSelectedLethalCardGroups_();
    sanitizeLethalPlannerCardSelections_(groups);
    autoSelectSingleLethalCandidates_(groups);
    const cardsComplete = lethalPlannerSelections.length > 0 && groups.every(group =>
      getLethalPlannerGroupSelectedCount_(group.key) === group.requiredCount
    );
    return { total, cardsComplete };
  }

  function resetLethalPlannerComposer_() {
    lethalPlannerSelections.splice(0, lethalPlannerSelections.length);
    lethalPlannerCardSelections.clear();
    lethalPlannerAutoFilterActive = false;
    lethalPlannerStepId = 0;
    renderLethalPlanner_();
  }

  function canAddLethalPlannerCard_(group, cardId) {
    if (getLethalPlannerGroupSelectedCount_(group.key) >= group.requiredCount) return false;
    const selectedCounts = getLethalPlannerSelectedCardCounts_();
    return (selectedCounts.get(cardId) || 0) < getLethalPlannerDeckCount_(cardId);
  }

  function sanitizeLethalPlannerCardSelections_(groups) {
    const validGroups = new Map(groups.map(group => [group.key, group]));
    const nextSelections = new Map();
    const globalCounts = new Map();

    for (const [groupKey, selections] of lethalPlannerCardSelections) {
      const group = validGroups.get(groupKey);
      if (!group) continue;
      const validCardIds = new Set(group.cards.map(card => normCd5(card.cd)));
      const nextGroupSelections = new Map();
      let groupCount = 0;

      for (const [cardId, rawCount] of selections) {
        if (!validCardIds.has(cardId) || groupCount >= group.requiredCount) continue;
        const deckCount = getLethalPlannerDeckCount_(cardId);
        const globallyUsed = globalCounts.get(cardId) || 0;
        const allowedCount = Math.min(
          Math.max(0, Number(rawCount) || 0),
          group.requiredCount - groupCount,
          Math.max(0, deckCount - globallyUsed)
        );
        if (allowedCount <= 0) continue;
        nextGroupSelections.set(cardId, allowedCount);
        groupCount += allowedCount;
        globalCounts.set(cardId, globallyUsed + allowedCount);
      }
      if (nextGroupSelections.size > 0) nextSelections.set(groupKey, nextGroupSelections);
    }

    lethalPlannerCardSelections.clear();
    for (const [groupKey, selections] of nextSelections) {
      lethalPlannerCardSelections.set(groupKey, selections);
    }
  }

  function autoSelectSingleLethalCandidates_(groups) {
    const globalCounts = getLethalPlannerSelectedCardCounts_();
    for (const group of groups) {
      if (group.cards.length !== 1) continue;
      const cardId = normCd5(group.cards[0].cd);
      const selectedCount = getLethalPlannerGroupSelectedCount_(group.key);
      const missingCount = Math.max(0, group.requiredCount - selectedCount);
      if (missingCount === 0) continue;
      const globallyUsed = globalCounts.get(cardId) || 0;
      const availableCount = Math.max(0, getLethalPlannerDeckCount_(cardId) - globallyUsed);
      const addCount = Math.min(missingCount, availableCount);
      if (addCount === 0) continue;
      const selections = getLethalPlannerGroupCardSelections_(group.key, true);
      selections.set(cardId, (selections.get(cardId) || 0) + addCount);
      globalCounts.set(cardId, globallyUsed + addCount);
    }
  }

  function renderLethalPlannerCards_() {
    const list = document.getElementById('lethal-planner-card-list');
    if (!list) return;

    if (lethalPlannerSelections.length === 0) {
      list.textContent = '式に追加すると使用カードを表示します';
      document.dispatchEvent(new CustomEvent('lethal-planner:cards-rendered'));
      return;
    }

    const groups = getSelectedLethalCardGroups_();
    sanitizeLethalPlannerCardSelections_(groups);
    autoSelectSingleLethalCandidates_(groups);
    const selectedCounts = getLethalPlannerSelectedCardCounts_();
    list.innerHTML = '';
    for (const groupData of groups) {
      const candidate = lethalPlannerCandidates.get(groupData.key);
      if (!candidate) continue;
      const availableCards = groupData.cards;
      if (availableCards.length === 0) continue;

      const type = lethalPlannerTypes.find(item => item.key === groupData.type);
      const groupSelectedCount = getLethalPlannerGroupSelectedCount_(groupData.key);
      const isGroupComplete = groupSelectedCount >= groupData.requiredCount;

      const group = document.createElement('div');
      group.className = 'lethal-card-group';
      group.classList.toggle('is-complete', isGroupComplete);

      const title = document.createElement('div');
      title.className = 'lethal-card-group-title';
      const titleValue = document.createElement('span');
      titleValue.className = 'lethal-card-group-title__value';
      titleValue.textContent = `${type?.icon || ''} ${groupData.type === 'buff' ? '+' : ''}${groupData.display}`.trim();
      title.appendChild(titleValue);
      title.setAttribute(
        'aria-label',
        `${type?.label || groupData.type} ${groupData.display}`
      );
      group.appendChild(title);

      const cardList = document.createElement('div');
      cardList.className = 'lethal-card-list';
      for (const card of availableCards) {
        const cardId = normCd5(card.cd);
        const selectedCount =
          getLethalPlannerGroupCardSelections_(groupData.key)?.get(cardId) || 0;
        const deckCount = getLethalPlannerDeckCount_(cardId);
        const usedCount = selectedCounts.get(cardId) || 0;
        const remainingCount = Math.max(0, deckCount - usedCount);
        const cannotIncrement = isGroupComplete || remainingCount === 0;
        const visibleCopyCount = Math.max(1, selectedCount + (cannotIncrement ? 0 : 1));

        for (let copyIndex = 0; copyIndex < visibleCopyCount; copyIndex += 1) {
          const isSelectedCopy = copyIndex < selectedCount;
          const isUnavailable = !isSelectedCopy && remainingCount === 0;
          const item = document.createElement('span');
          item.className = 'lethal-card-mini-wrap';
          const mini = document.createElement('button');
          mini.type = 'button';
          mini.className = 'lethal-card-mini';
          mini.dataset.lethalCardGroupKey = groupData.key;
          mini.dataset.lethalCardId = cardId;
          mini.dataset.lethalCardSelected = String(isSelectedCopy);
          mini.classList.toggle('is-selected', isSelectedCopy);
          mini.classList.toggle('is-unavailable', isUnavailable);
          mini.classList.toggle('is-group-complete', isGroupComplete && !isUnavailable);
          mini.disabled = !isSelectedCopy && cannotIncrement;
          mini.setAttribute('aria-pressed', String(isSelectedCopy));
          mini.setAttribute(
            'aria-label',
            isSelectedCopy
              ? `${card.name}の選択を1枚解除する、現在${selectedCount}枚`
              : `${card.name}を1枚選択する、現在${selectedCount}枚、残り${remainingCount}枚`
          );
          mini.title = isUnavailable ? '別の打点で使用中・残り0枚' : '';

          const image = document.createElement('img');
          image.className = 'lethal-card-mini__image';
          image.src = imgSrcOf(card.cd);
          image.alt = card.name;
          image.loading = 'lazy';
          image.onerror = () => {
            if (image.dataset.fallbackApplied) return;
            image.dataset.fallbackApplied = '1';
            image.src = FALLBACK_IMG;
          };
          mini.appendChild(image);
          if (card.supplement) {
            const supplement = document.createElement('span');
            supplement.className = 'lethal-card-mini__supplement';
            supplement.textContent = card.supplement;
            mini.appendChild(supplement);
          }
          if (isSelectedCopy) {
            const check = document.createElement('span');
            check.className = 'lethal-card-mini__check';
            check.setAttribute('aria-hidden', 'true');
            check.textContent = '✓';
            mini.appendChild(check);
          }
          item.appendChild(mini);
          cardList.appendChild(item);
        }
      }

      group.appendChild(cardList);
      list.appendChild(group);
    }
    document.dispatchEvent(new CustomEvent('lethal-planner:cards-rendered'));
  }

  function buildLethalReportText_() {
    const deckLines = getDeckEntriesSorted().map(([cd, count]) => {
      const card = getCard(cd);
      return `${card?.name || cd} ×${count}`;
    });
    const expression = lethalPlannerSelections.length === 0
      ? '未選択'
      : `${lethalPlannerSelections.map(selection =>
        selection.type === 'buff'
          ? `(+${selection.value})`
          : (selection.display || String(selection.value))
      ).join(' + ')} = ${lethalPlannerSelections.reduce((sum, selection) =>
        sum + selection.value, 0)}`;
    const candidateLines = [];

    for (const group of getSelectedLethalCardGroups_()) {
      const type = lethalPlannerTypes.find(item => item.key === group.type);
      const value = `${group.type === 'buff' ? '+' : ''}${group.display}`;
      candidateLines.push(`${type?.label || group.type}${value}：`);
      if (group.cards.length === 0) {
        candidateLines.push('候補なし');
      } else {
        candidateLines.push(...group.cards.map(card => `- ${card.name}`));
      }
      candidateLines.push('');
    }

    if (candidateLines.length === 0) candidateLines.push('未選択');

    return [
      '■ デッキリスト',
      ...(deckLines.length > 0 ? deckLines : ['カードなし']),
      '',
      '■ 現在のリーサル式',
      expression,
      '',
      '■ 候補カード',
      ...candidateLines,
    ].join('\n').trimEnd();
  }

  function copyTextWithFallback_(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (_) {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  async function copyLethalReport_() {
    const text = buildLethalReportText_();
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        return copyTextWithFallback_(text);
      }
    }
    return copyTextWithFallback_(text);
  }

  function showLethalCopyStatus_(message, isError = false, statusElement = null) {
    const status = statusElement || document.querySelector('[data-lethal-copy-status]');
    if (!status) return;
    if (lethalCopyStatusTimer !== null) window.clearTimeout(lethalCopyStatusTimer);
    status.textContent = message;
    status.classList.toggle('is-error', isError);
    lethalCopyStatusTimer = window.setTimeout(() => {
      status.textContent = '';
      status.classList.remove('is-error');
      lethalCopyStatusTimer = null;
    }, 3000);
  }

  function bindLethalPlannerEvents_() {
    if (lethalPlannerEventsBound) return;
    const root = document.getElementById('lethal-planner');
    if (!root) return;

    root.addEventListener('click', (event) => {
      const candidateCardButton = event.target.closest('[data-lethal-card-group-key]');
      if (candidateCardButton) {
        const groupKey = candidateCardButton.dataset.lethalCardGroupKey;
        const cardId = normCd5(candidateCardButton.dataset.lethalCardId);
        const group = getSelectedLethalCardGroups_().find(item => item.key === groupKey);
        if (!group || !cardId) return;
        const isSelectedCopy = candidateCardButton.dataset.lethalCardSelected === 'true';
        if (isSelectedCopy) {
          const groupSelections = getLethalPlannerGroupCardSelections_(groupKey);
          const selectedCount = groupSelections?.get(cardId) || 0;
          if (selectedCount <= 1) groupSelections?.delete(cardId);
          else groupSelections.set(cardId, selectedCount - 1);
          if (groupSelections?.size === 0) lethalPlannerCardSelections.delete(groupKey);
        } else if (canAddLethalPlannerCard_(group, cardId)) {
          const groupSelections = getLethalPlannerGroupCardSelections_(groupKey, true);
          groupSelections.set(cardId, (groupSelections.get(cardId) || 0) + 1);
        }
        renderLethalPlannerCards_();
        return;
      }

      const reportButton = event.target.closest('[data-lethal-report]');
      if (reportButton) {
        window.open(LETHAL_REPORT_FORM_URL, '_blank', 'noopener,noreferrer');
        copyLethalReport_().then(copied => {
          showLethalCopyStatus_(
            copied ? 'コピーしました' : 'コピーに失敗しました',
            !copied
          );
        }).catch(() => {
          showLethalCopyStatus_('コピーに失敗しました', true);
        });
        return;
      }

      const autoButton = event.target.closest('#lethal-planner-auto');
      if (autoButton) {
        openLethalAutoFilterModal_(autoButton);
        return;
      }

      const autoResultButton = event.target.closest('.lethal-planner__auto-result');
      const autoCardsButton = event.target.closest('.lethal-planner__auto-cards-button');
      const autoToggleButton = event.target.closest('.lethal-planner__auto-toggle');
      if (autoToggleButton) {
        toggleLethalPlannerAutoResults_();
        return;
      }
      if (autoCardsButton) {
        toggleLethalAutoCardsPopup_(autoCardsButton);
        return;
      }

      if (autoResultButton) {
        const plan = lethalPlannerAutoPlans[Number(autoResultButton.dataset.lethalAutoIndex)];
        if (plan) applyLethalPlannerAutoPlan_(plan);
        return;
      }

      const removeButton = event.target.closest('.lethal-planner__term-remove');
      if (removeButton) {
        const selectionIndex = Number(removeButton.dataset.lethalSelectionIndex);
        if (Number.isInteger(selectionIndex) && lethalPlannerSelections[selectionIndex]) {
          lethalPlannerAutoFilterActive = false;
          const [removedSelection] = lethalPlannerSelections.splice(selectionIndex, 1);
          if (removedSelection.sourceKind === 'lethalBuff') {
            unlockLinkedLethalPlannerAttack_(removedSelection.linkedAttackStepId);
          }
          removeOrphanedLethalPlannerBuffs_();
          lethalPlannerCardSelections.clear();
          renderLethalPlanner_();
        }
        return;
      }

      const valueButton = event.target.closest('.lethal-planner__value');
      if (valueButton) {
        lethalPlannerAutoFilterActive = false;
        const candidate = lethalPlannerCandidates.get(valueButton.dataset.lethalKey);
        const source = getAvailableLethalPlannerSource_(candidate);
        if (!candidate || !source) return;
        const selection = {
          stepId: ++lethalPlannerStepId,
          key: valueButton.dataset.lethalKey,
          type: candidate.type,
          value: candidate.value,
          display: source.display || candidate.display || String(candidate.value),
          attackValue: source.attackValue ?? null,
          lethalBurnValue: source.lethalBurnValue ?? null,
          cardId: source.cardId,
          cardName: source.cardName,
          sourceKey: source.sourceKey,
          sourceKind: source.sourceKind,
          isRepeat: source.isRepeat,
        };

        if (source.sourceKind === 'attack') {
          selection.candidateSources = [...candidate.sources.values()]
            .filter(candidateSource => candidateSource.sourceKind === 'attack')
            .map(candidateSource => ({
              cardId: candidateSource.cardId,
              cardName: candidateSource.cardName,
              sourceKey: candidateSource.sourceKey,
              count: candidateSource.count,
              isRepeat: candidateSource.isRepeat,
            }));
          selection.locked = false;
        } else if (source.sourceKind === 'lethalBuff') {
          const attackAssignment = findLethalPlannerAttackAssignment_(source);
          if (!attackAssignment) return;
          attackAssignment.selection.cardId = attackAssignment.candidateSource.cardId;
          attackAssignment.selection.cardName = attackAssignment.candidateSource.cardName;
          attackAssignment.selection.sourceKey = attackAssignment.candidateSource.sourceKey;
          attackAssignment.selection.isRepeat = attackAssignment.candidateSource.isRepeat;
          attackAssignment.selection.locked = true;
          selection.linkedAttackStepId = attackAssignment.selection.stepId;
        }

        lethalPlannerSelections.push(selection);
        lethalPlannerCardSelections.clear();
        renderLethalPlanner_();
      }
    });

    root.addEventListener('dragstart', (event) => {
      const chip = event.target.closest('.lethal-planner__term');
      if (!chip) return;
      lethalPlannerDragIndex = Number(chip.dataset.lethalSelectionIndex);
      chip.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', chip.dataset.lethalSelectionIndex);
    });

    root.addEventListener('dragover', (event) => {
      const chip = event.target.closest('.lethal-planner__term');
      if (!chip || lethalPlannerDragIndex === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      root.querySelectorAll('.lethal-planner__term.is-drag-over')
        .forEach(item => item.classList.remove('is-drag-over'));
      chip.classList.add('is-drag-over');
    });

    root.addEventListener('drop', (event) => {
      const chip = event.target.closest('.lethal-planner__term');
      if (!chip || lethalPlannerDragIndex === null) return;
      event.preventDefault();
      const dropIndex = Number(chip.dataset.lethalSelectionIndex);
      if (Number.isInteger(dropIndex) && dropIndex !== lethalPlannerDragIndex) {
        lethalPlannerAutoFilterActive = false;
        const [movedSelection] = lethalPlannerSelections.splice(lethalPlannerDragIndex, 1);
        lethalPlannerSelections.splice(dropIndex, 0, movedSelection);
        lethalPlannerCardSelections.clear();
      }
      lethalPlannerDragIndex = null;
      renderLethalPlanner_();
    });

    root.addEventListener('dragend', () => {
      lethalPlannerDragIndex = null;
      root.querySelectorAll('.lethal-planner__term.is-dragging, .lethal-planner__term.is-drag-over')
        .forEach(item => item.classList.remove('is-dragging', 'is-drag-over'));
    });
    window.addEventListener('scroll', hideLethalCandidateTooltip_, true);
    window.addEventListener('resize', hideLethalCandidateTooltip_);
    window.addEventListener('scroll', hideLethalAutoCardsPopup_, true);
    window.addEventListener('resize', hideLethalAutoCardsPopup_);
    document.addEventListener('click', event => {
      if (
        lethalAutoCardsPopup?.hidden ||
        event.target.closest('.lethal-auto-cards-popup') ||
        event.target.closest('.lethal-planner__auto-cards-button')
      ) {
        return;
      }
      hideLethalAutoCardsPopup_();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') hideLethalAutoCardsPopup_();
    });
    lethalPlannerEventsBound = true;
  }

  function updateLethalPlanner_() {
    lethalPlannerSelections.length = 0;
    lethalPlannerCardSelections.clear();
    lethalPlannerStepId = 0;
    lethalPlannerAutoPlans = [];
    lethalPlannerAutoSearched = false;
    lethalPlannerAutoExpanded = false;
    allowedAutoLethalOptions = null;
    lethalPlannerAutoFilterActive = false;
    lethalPlannerCandidates = buildLethalPlannerCandidates_();
    bindLethalPlannerEvents_();
    renderLethalPlanner_();
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
      <span class="deck-summary-line">
        <img class="deck-summary-icon" src="img/deckicon.webp" alt="デッキ枚数">${total}/30~40
      </span><br>
      種族：${races.size > 0 ? Array.from(races).join('/') : '未定'}<br>
      旧神：${hasOldGod ? '採用中' : '未採用'}<br>
      <span class="deck-summary-type-line">
        <span class="deck-summary-type-count"><img class="deck-summary-type-icon" src="img/type-charger.webp" alt="チャージャー">${(typeCount['チャージャー']|0)}</span>
        <span class="deck-summary-type-count"><img class="deck-summary-type-icon" src="img/type-attacker.webp" alt="アタッカー">${(typeCount['アタッカー']|0)}</span>
        <span class="deck-summary-type-count"><img class="deck-summary-type-icon" src="img/type-blocker.webp" alt="ブロッカー">${(typeCount['ブロッカー']|0)}</span>
      </span>
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
    updateLethalPlanner_();

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
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
      localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
    } catch (_) {}
  }

  function normalizeRestoreData_(data) {
    if (!data || typeof data !== 'object') return null;
    const rawCardCounts = pickRestoreCardCounts_(data);
    if (!rawCardCounts) return null;

    const cardCounts = {};
    for (const [cdRaw, nRaw] of Object.entries(rawCardCounts)) {
      const n = Number(nRaw) || 0;
      if (n <= 0) continue;
      const cd5 = normCd5(cdRaw);
      if (!cd5) continue;
      cardCounts[cd5] = n;
    }
    if (!Object.keys(cardCounts).length) return null;

    return { ...data, cardCounts };
  }

  function pickRestoreCardCounts_(data) {
    if (!data || typeof data !== 'object') return null;
    const directKeys = ['cardCounts', 'cards', 'deck'];
    for (const key of directKeys) {
      const value = data[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    }

    const codeKeys = ['code', 'deckCode', 'shareCode'];
    for (const key of codeKeys) {
      const value = String(data[key] || '').trim();
      if (!value) continue;
      const decoded = decodeDeckCodeCardCounts_(value);
      if (decoded) return decoded;
    }

    return null;
  }

  function decodeDeckCodeCardCounts_(value) {
    try {
      const normalized = String(value || '').trim().replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      const json = decodeURIComponent(escape(atob(padded)));
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return pickRestoreCardCounts_(parsed) || parsed;
    } catch (_) {
      return null;
    }
  }

  function loadAutosave_(data) {
    const restoreData = normalizeRestoreData_(data);
    if (!restoreData) return false;

    // deck 入れ替え（参照維持 + cd5正規化）
    Object.keys(deck).forEach(k => delete deck[k]);

    const src = restoreData.cardCounts;
    for (const [cdRaw, nRaw] of Object.entries(src)) {
      const n = Number(nRaw) || 0;
      if (n <= 0) continue;
      const cd5 = normCd5(cdRaw);
      deck[cd5] = n;
    }

    // 代表カード
    const rep = restoreData.m ? normCd5(restoreData.m) : (restoreData.representativeCd ? normCd5(restoreData.representativeCd) : null);
    representativeCd = (rep && deck[rep]) ? rep : null;
    window.representativeCd = representativeCd;

    lastAddedCd = restoreData.lastAddedCd ? normCd5(restoreData.lastAddedCd) : null;

    // 入力復元
    window.writeDeckNameInput?.(restoreData.name || '');
    window.writePostNote?.(restoreData.note || '');

    // 投稿者名
    try {
      const nameEl = document.getElementById('poster-name');
      if (nameEl && Object.prototype.hasOwnProperty.call(restoreData, 'poster')) {
        const restoredName = (typeof restoreData.poster === 'string') ? restoreData.poster : (restoreData.poster?.name || '');
        nameEl.value = restoredName || '';
      }
    } catch(_) {}

    // 貼り付けコード
    try {
      const v = String(restoreData.shareCode || '');
      window.writePastedDeckCode?.(v);

      const shareEl = document.getElementById('post-share-code');
      if (shareEl) shareEl.value = v;
    } catch(_) {}

    // selectTags / userTags / cardNotes は「存在するAPIがあれば」復元
    try {
      if (Array.isArray(restoreData.selectTags)) {
        // ✅ deckmaker-post.js の正規API（Set/ArrayどっちでもOK）
        if (typeof window.__dmWriteSelectedTags === 'function') {
          window.__dmWriteSelectedTags(restoreData.selectTags);
        } else if (typeof window.writeSelectedTags === 'function') {
          // 旧互換が残ってる環境用
          window.writeSelectedTags(restoreData.selectTags);
        }
        // UI再描画（存在すれば）
        window.renderPostSelectTags?.();
        window.applySelectTagWrap?.();
      }
    } catch(_) {}

    try {
      if (Array.isArray(restoreData.userTags) && typeof window.writeUserTags === 'function') {
        window.writeUserTags(restoreData.userTags);
      }
    } catch(_) {}

    try {
      if (restoreData.cardNotes != null) {
        // 既存の CardNotes モジュールがあるならそれを使う
        if (window.CardNotes?.replace) {
          window.CardNotes.replace(Array.isArray(restoreData.cardNotes) ? restoreData.cardNotes : []);
        } else if (typeof window.writeCardNotes === 'function') {
          window.writeCardNotes(Array.isArray(restoreData.cardNotes) ? restoreData.cardNotes : []);
        }
      }
    } catch(_) {}

    try { window.DeckmakerLethalPost?.replace?.(restoreData.lethalPlans || []); } catch (_) {}

    // UI同期（deckBarTopなど）
    withDeckBarScrollKept(updateDeck);

    // deck-card-list もあるなら更新（移植後に未実装なら何もしない）
    window.renderDeckList?.();

    window.updateDeckSummaryDisplay?.();
    window.updateExchangeSummary?.();
    window.updateRepresentativeHighlight?.();
    return true;
  }

  function resetDeckState() {
    const hasCards = Object.keys(deck || {}).length > 0;
    const hasRepresentative = !!representativeCd;
    const hasDeckName = !!window.readDeckNameInput?.();
    const hasLethalPlans = (window.DeckmakerLethalPost?.getAll?.() || []).length > 0;
    const hasCardNotes = (window.readCardNotes?.() || []).some((row) => {
      return String(row?.cd || '').trim() || String(row?.text || '').trim();
    });
    if (!hasCards && !hasRepresentative && !hasDeckName && !hasCardNotes && !hasLethalPlans) return;

    const ok = window.confirm?.('現在のデッキ内容をリセットします。\nデッキ名・カード解説・登録済みリーサルプランも消えます。\n※デッキ解説タグは残ります。\nよろしいですか？');
    if (!ok) return;

    window.writeDeckNameInput?.('');
    window.writeCardNotes?.([]);
    window.DeckmakerLethalPost?.reset?.();
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

    lastAddedCd = null;

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
  // - localStorage: deck_working_v1 / deck_rescue_v1
  // - 「空 payload で既存データを潰さない」
  // - selectTags / userTags / cardNotes も保存
  // - saveAutosaveNow / clearAutosave を提供
  // =========================
  const AUTOSAVE_KEY = 'deck_working_v1';
  const RESCUE_KEY = 'deck_rescue_v1';
  const LEGACY_AUTOSAVE_KEY = 'deck_autosave_v1';
  const POST_DRAFT_KEY = 'deckmaker_post_draft_v1';

  let __autosaveDirty = false;       // 変更が起きたときだけ true
  let __autosaveJustLoaded = true;   // 初期描画直後のガード
  let __autosaveTimer = 0;
  let __restoreModalOpen = false;
  let __restoreModalLastFocus = null;

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
    const currentRepresentativeCd = window.representativeCd || representativeCd || null;
    const payload = {
      cardCounts: { ...deck },

    representativeCd: currentRepresentativeCd,
    m: currentRepresentativeCd,
    lastAddedCd: lastAddedCd || null,

      name: window.readDeckNameInput?.() || '',
      note: window.readPostNote?.() || '',
      poster: document.getElementById('poster-name')?.value?.trim() || '',
      shareCode: document.getElementById('post-share-code')?.value?.trim() || '',
      lethalPlans: window.DeckmakerLethalPost?.getAll?.() || [],
      date: window.formatYmd?.(),
      savedAt: new Date().toISOString(),
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

  function buildPostDraftPayload_() {
    const payload = buildAutosavePayload_();
    delete payload.poster;
    payload.savedAt = new Date().toISOString();
    payload.version = 1;
    return payload;
  }

  function readPostDraftMeta_() {
    try {
      const raw = localStorage.getItem(POST_DRAFT_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : null;
    } catch (_) {
      return null;
    }
  }

  function savePostDraft_() {
    const payload = buildPostDraftPayload_();
    localStorage.setItem(POST_DRAFT_KEY, JSON.stringify(payload));
    return payload;
  }

  function savePostDraftFromData_(data) {
    const restoreData = normalizeRestoreData_(data);
    if (!restoreData) return null;

    const payload = {
      ...restoreData,
      cardCounts: { ...restoreData.cardCounts },
      savedAt: new Date().toISOString(),
      version: 1,
    };
    delete payload.poster;
    localStorage.setItem(POST_DRAFT_KEY, JSON.stringify(payload));
    return payload;
  }

  function restorePostDraft_() {
    const data = readPostDraftMeta_();
    if (!data) return null;
    if (!loadAutosave_(data)) return null;
    try { scheduleAutosave(); } catch (_) {}
    return data;
  }

  function saveAutosaveNow() {
    try {
      if (__restoreModalOpen || hasRescueData_()) return;
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
  window.clearAutosave   = window.clearAutosave   || (() => {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
      localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
    } catch (_) {}
  });


  function maybeRestoreFromStorage() {
    // URLで fresh=1 のときは復元導線を出さない（移植前互換）
    if (window.location.search.includes('fresh=1')) return;

    const rescueData = prepareRescueData_();
    if (!rescueData) return;

    try {
      showRestoreModal_(rescueData);
    } catch (e) {
      // パース失敗などは黙って無視
    }
  }

  function readStorageJson_(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function hasRescueData_() {
    return !!normalizeRestoreData_(readStorageJson_(RESCUE_KEY));
  }

  function prepareRescueData_() {
    const rescue = normalizeRestoreData_(readStorageJson_(RESCUE_KEY));
    if (rescue && !isTrulyEmpty_(rescue)) return rescue;
    try { localStorage.removeItem(RESCUE_KEY); } catch (_) {}

    const working = normalizeRestoreData_(readStorageJson_(AUTOSAVE_KEY)) ||
      normalizeRestoreData_(readStorageJson_(LEGACY_AUTOSAVE_KEY));
    if (!working || isTrulyEmpty_(working)) {
      clearAutosave_();
      return null;
    }

    try {
      localStorage.setItem(RESCUE_KEY, JSON.stringify(working));
      localStorage.removeItem(AUTOSAVE_KEY);
      localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
    } catch (_) {}
    return working;
  }

  function clearRescueData_() {
    try { localStorage.removeItem(RESCUE_KEY); } catch (_) {}
  }

  function getRestoreDeckCount_(data) {
    const cardCounts = normalizeRestoreData_(data)?.cardCounts || {};
    return Object.values(cardCounts).reduce((sum, n) => sum + Math.max(0, Number(n) || 0), 0);
  }

  function getRestoreMainRace_(data) {
    const cardCounts = normalizeRestoreData_(data)?.cardCounts || {};
    const races = Object.keys(cardCounts)
      .map(cd => getCard(cd)?.race)
      .filter(r => MAIN_RACES.includes(r));

    return [...new Set(races)][0] || '未選択';
  }

  function getRestoreLastAddedName_(data) {
    const cd = data?.lastAddedCd ? normCd5(data.lastAddedCd) : '';
    if (!cd) return '';

    const card = getCard(cd);
    return card?.name || '';
  }

  function formatRestoreSavedAt_(data) {
    const raw = data?.savedAt || data?.updatedAt || data?.date || '';
    const d = raw ? new Date(raw) : null;
    if (!d || Number.isNaN(d.getTime())) return '不明';

    const now = new Date();
    const isToday = d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (isToday) return `今日 ${hh}:${mm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
  }

  function escapeText_(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hasPostDraftData_() {
    const draft = readPostDraftMeta_();
    if (!draft) return false;
    if (typeof window.canRestoreDeckmakerData === 'function') return window.canRestoreDeckmakerData(draft);
    return !!normalizeRestoreData_(draft);
  }

  function refreshSavedDeckList_() {
    try { window.SavedDeckUI?.render?.(); } catch (_) {}
    try { window.updateSavedDeckList?.(); } catch (_) {}
  }

  function buildSavedDeckFromRestore_(data) {
    const restoreData = normalizeRestoreData_(data);
    if (!restoreData || !window.SavedDeckStore?.buildFromState) return null;
    return window.SavedDeckStore.buildFromState({
      deck: restoreData.cardCounts,
      representativeCd: restoreData.m || restoreData.representativeCd || null,
      name: restoreData.name || '',
      shareCode: restoreData.shareCode || '',
      date: restoreData.date || window.formatYmd?.(),
      getMainRace: () => getMainRaceFromCardCounts_(restoreData.cardCounts),
    });
  }

  function getMainRaceFromCardCounts_(cardCounts) {
    const races = Object.keys(cardCounts || {})
      .map(cd => getCard(cd)?.race)
      .filter(r => MAIN_RACES.includes(r));
    return [...new Set(races)][0] || '';
  }

  function resetToFreshState_() {
    if (__autosaveTimer) clearTimeout(__autosaveTimer);
    __autosaveTimer = 0;
    __autosaveDirty = false;

    Object.keys(deck).forEach(k => delete deck[k]);
    representativeCd = null;
    window.representativeCd = null;

    window.writeDeckNameInput?.('');
    window.writePostNote?.('');
    window.writeCardNotes?.([]);
    window.DeckmakerLethalPost?.reset?.();
    try { window.__dmWriteSelectedTags?.([]); } catch (_) {}
    try { window.writeSelectedTags?.([]); } catch (_) {}
    try { window.writeUserTags?.([]); } catch (_) {}
    try { window.writePastedDeckCode?.(''); } catch (_) {}

    withDeckBarScrollKept(updateDeck);
    window.updateDeckSummary?.([]);
    window.updateCardDisabling?.();
    window.applyGrayscaleFilter?.();
    window.renderDeckList?.();
    window.renderPostSelectTags?.();
    window.refreshPostSummary?.();
    clearAutosave_();
  }

  function closeRestoreModal_() {
    const modal = document.getElementById('dmRestoreModal');
    if (modal) modal.remove();
    __restoreModalOpen = false;
    document.removeEventListener('keydown', onRestoreDocumentKeydown_, true);
    document.removeEventListener('focusin', onRestoreFocusIn_, true);
    document.body.classList.remove('dm-restore-modal-open');
  }

  function onRestoreDocumentKeydown_(e) {
    if (!__restoreModalOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onRestoreFocusIn_(e) {
    if (!__restoreModalOpen) return;
    const modal = document.getElementById('dmRestoreModal');
    const helpModal = document.getElementById('genericHelpModal');
    if (helpModal && helpModal.style.display === 'flex' && helpModal.contains(e.target)) return;
    if (!modal || modal.contains(e.target)) return;
    e.stopPropagation();
    const target = __restoreModalLastFocus || modal.querySelector('[data-restore-action="restore"]');
    target?.focus?.();
  }

  function getSavedDeckUsage_() {
    const cap = 20;
    let count = 0;
    try {
      const key = window.SavedDeckStore?.KEY || 'savedDecks';
      const list = window.SavedDeckStore?.list?.({ key }) || [];
      count = Array.isArray(list) ? list.length : 0;
    } catch (_) {}
    return { count, cap, remaining: Math.max(0, cap - count) };
  }

  function openGenericHelpModal_(title, body) {
    let modal = document.getElementById('genericHelpModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'genericHelpModal';
      modal.className = 'modal help-modal-root';
      modal.style.display = 'none';
      modal.innerHTML = `
        <div class="modal-content help-modal" role="dialog" aria-modal="true" aria-labelledby="genericHelpTitle">
          <button type="button" class="modal-close-x" data-generic-help-close aria-label="閉じる">×</button>
          <h3 class="help-modal-title" id="genericHelpTitle"></h3>
          <div class="help-modal-body" data-generic-help-body></div>
        </div>
      `;
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('[data-generic-help-close]')) {
          closeGenericHelpModal_();
        }
      });
      document.body.appendChild(modal);
    }

    const titleEl = modal.querySelector('#genericHelpTitle');
    const bodyEl = modal.querySelector('[data-generic-help-body]');
    if (titleEl) titleEl.textContent = String(title || '');
    if (bodyEl) bodyEl.textContent = String(body || '');
    modal.style.display = 'flex';
    modal.querySelector('[data-generic-help-close]')?.focus?.();
  }

  function closeGenericHelpModal_() {
    const modal = document.getElementById('genericHelpModal');
    if (modal) modal.style.display = 'none';
  }

  function showRestoreModal_(data) {
    const restoreData = normalizeRestoreData_(data);
    if (!restoreData || isTrulyEmpty_(restoreData)) return;

    document.getElementById('dmRestoreModal')?.remove();
    __restoreModalOpen = true;
    document.body.classList.add('dm-restore-modal-open');

    const canSaveDraft = !hasPostDraftData_();
    const savedDeckUsage = getSavedDeckUsage_();
    const canSaveToStorage = savedDeckUsage.remaining > 0;
    const storageLabel = `保管庫に保存（残り ${savedDeckUsage.remaining}/${savedDeckUsage.cap}）`;
    const secondaryActionsCount = (canSaveDraft ? 1 : 0) + (canSaveToStorage ? 1 : 0);
    const secondaryActionsHtml = `
      ${canSaveDraft ? `
        <div class="dm-restore-modal__button-wrap">
          <button type="button" class="dm-restore-modal__button dm-restore-modal__button--secondary" data-restore-action="draft">下書きに保存</button>
          <button type="button" class="dm-restore-modal__help" data-restore-help="draft" aria-label="下書きに保存の説明">?</button>
        </div>
      ` : ''}
      ${canSaveToStorage ? `
        <div class="dm-restore-modal__button-wrap">
          <button type="button" class="dm-restore-modal__button dm-restore-modal__button--secondary" data-restore-action="saved">${storageLabel}</button>
          <button type="button" class="dm-restore-modal__help" data-restore-help="saved" aria-label="保管庫に保存の説明">?</button>
        </div>
      ` : ''}
    `.trim();
    const deckName = String(restoreData.name || '').trim() || '未入力';
    const raceName = getRestoreMainRace_(restoreData);
    const lastAddedName = getRestoreLastAddedName_(restoreData);
    const count = getRestoreDeckCount_(restoreData);
    const savedAt = formatRestoreSavedAt_(restoreData);

    const modal = document.createElement('div');
    modal.id = 'dmRestoreModal';
    modal.className = 'dm-restore-modal';
    modal.setAttribute('role', 'presentation');
    modal.innerHTML = `
      <div class="dm-restore-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="dmRestoreTitle" aria-describedby="dmRestoreDesc">
        <h2 class="dm-restore-modal__title" id="dmRestoreTitle">⚠ 前回の編集データがあります</h2>
        <p class="dm-restore-modal__desc" id="dmRestoreDesc">作成途中だったのデッキデータを復元できます。</p>
        <dl class="dm-restore-modal__meta">
          <div><dt>デッキ名</dt><dd>${escapeText_(deckName)}</dd></div>
          <div><dt>種族</dt><dd>${escapeText_(raceName)}</dd></div>
          ${lastAddedName ? `<div class="dm-restore-modal__meta-last"><dt>最後に追加</dt><dd>${escapeText_(lastAddedName)}</dd></div>` : ''}
          <div><dt>枚数</dt><dd>${count}枚</dd></div>
          <div><dt>保存日時</dt><dd>${escapeText_(savedAt)}</dd></div>
        </dl>
        <div class="dm-restore-modal__actions">
          <button type="button" class="dm-restore-modal__button dm-restore-modal__button--primary" data-restore-action="restore">デッキを復元</button>
          ${secondaryActionsHtml ? `
            <div class="dm-restore-modal__divider" aria-hidden="true"></div>
            <div class="dm-restore-modal__sub-actions${secondaryActionsCount === 1 ? ' is-single' : ''}">${secondaryActionsHtml}</div>
          ` : ''}
          <div class="dm-restore-modal__divider" aria-hidden="true"></div>
          <button type="button" class="dm-restore-modal__button dm-restore-modal__button--danger" data-restore-action="discard">破棄して新デッキ作成</button>
        </div>
      </div>
    `;

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        e.preventDefault();
        return;
      }

      const help = e.target.closest('[data-restore-help]');
      if (help) {
        const type = help.getAttribute('data-restore-help');
        openGenericHelpModal_(
          type === 'draft' ? '下書きに保存' : '保管庫に保存',
          type === 'draft'
            ? '投稿内容も含めて一時保存します。後で続きを編集できます。保存数は1件です。'
            : 'デッキを保管庫へ保存します。複数保存できます。投稿内容は保存されません。'
        );
        return;
      }

      const action = e.target.closest('[data-restore-action]')?.getAttribute('data-restore-action');
      if (!action) return;
      handleRestoreAction_(action, restoreData);
    });

    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(modal.querySelectorAll('button:not(:disabled)'));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    modal.addEventListener('focusin', (e) => {
      if (e.target instanceof HTMLElement) __restoreModalLastFocus = e.target;
    });

    document.body.appendChild(modal);
    document.addEventListener('keydown', onRestoreDocumentKeydown_, true);
    document.addEventListener('focusin', onRestoreFocusIn_, true);
    requestAnimationFrame(() => {
      __restoreModalLastFocus = modal.querySelector('[data-restore-action="restore"]');
      __restoreModalLastFocus?.focus();
    });
  }

  function handleRestoreAction_(action, data) {
    const restoreData = normalizeRestoreData_(data);
    if (!restoreData) return;

    if (action === 'restore') {
      if (!loadAutosave_(restoreData)) {
        alert('復元データを読み込めませんでした。');
        return;
      }
      clearRescueData_();
      closeRestoreModal_();
      try { scheduleAutosave(); } catch (_) {}
      return;
    }

    if (action === 'draft') {
      if (hasPostDraftData_()) return;
      const saved = savePostDraftFromData_(restoreData);
      if (!saved) {
        alert('下書きに保存できませんでした。');
        return;
      }
      clearRescueData_();
      closeRestoreModal_();
      resetToFreshState_();
      return;
    }

    if (action === 'saved') {
      if (getSavedDeckUsage_().remaining <= 0) return;
      const built = buildSavedDeckFromRestore_(restoreData);
      if (!built || !window.SavedDeckStore?.upsert) {
        alert('保管庫に保存できませんでした。');
        return;
      }
      const res = window.SavedDeckStore.upsert(built, {
        key: window.SavedDeckStore.KEY || 'savedDecks',
        cap: 20,
        confirmOverwrite: (name) => window.confirm(`「${name}」は既に保管庫にあります。上書きしますか？`),
      });
      if (!res?.ok) {
        if (res?.reason !== 'cancelled') alert('保管庫に保存できませんでした。');
        return;
      }
      refreshSavedDeckList_();
      clearRescueData_();
      closeRestoreModal_();
      resetToFreshState_();
      return;
    }

    if (action === 'discard') {
      const ok = window.confirm('前回の編集データを破棄して新しいデッキを作成します。\nこの操作は元に戻せません。よろしいですか？');
      if (!ok) return;
      clearRescueData_();
      closeRestoreModal_();
      resetToFreshState_();
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
  window.getCurrentLethalPlanVariant = getCurrentLethalPlanVariant_;
  window.getLethalPlannerComposerStatus = getLethalPlannerComposerStatus_;
  window.getLethalPlannerPlanCandidates = getLethalPlannerPlanCandidates_;
  window.loadLethalPlannerPlanForEditing = loadLethalPlannerPlanForEditing_;
  window.toggleLethalPlannerAutoResults = toggleLethalPlannerAutoResults_;
  window.toggleLethalAutoCardsPopup = toggleLethalAutoCardsPopup_;
  window.getLethalPlannerCardsForKey = getLethalPlannerCardsForKey_;
  window.resetLethalPlannerComposer = resetLethalPlannerComposer_;
  window.openLethalReport = async function openLethalReport(statusElement = null) {
    window.open(LETHAL_REPORT_FORM_URL, '_blank', 'noopener,noreferrer');
    const copied = await copyLethalReport_();
    showLethalCopyStatus_(copied ? '報告用情報をコピーしました' : '情報をコピーできませんでした', !copied, statusElement);
  };

  // representative (post integration)
  window.setRepresentativeCard = window.setRepresentativeCard || setRepresentativeCard;
  window.buildCardsForPost_ = window.buildCardsForPost_ || buildCardsForPost_;
  window.exportDeckCode = window.exportDeckCode || exportDeckCode;
  window.representativeCd = window.representativeCd ?? representativeCd;

  // autosave / restore
  window.withDeckBarScrollKept = withDeckBarScrollKept;
  window.scheduleAutosave = scheduleAutosave;
  window.maybeRestoreFromStorage = maybeRestoreFromStorage;
  window.saveDeckmakerPostDraft = window.saveDeckmakerPostDraft || savePostDraft_;
  window.restoreDeckmakerPostDraft = window.restoreDeckmakerPostDraft || restorePostDraft_;
  window.readDeckmakerPostDraft = window.readDeckmakerPostDraft || readPostDraftMeta_;
  window.canRestoreDeckmakerData = window.canRestoreDeckmakerData || ((data) => !!normalizeRestoreData_(data));

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
