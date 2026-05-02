/* =========================
 * js/common/card/card-detail.js
 * - カード詳細HTMLの生成
 * - 一覧カード下への詳細展開
 * - 詳細内の所持数UI
 * - 詳細内の拡大ボタン付与
 * - カード詳細モーダル
 * ========================= */
(function () {
  'use strict';

  // =========================
  // 0) 依存
  // =========================

  // 共通HTMLエスケープ
  const escapeHtml_ = window.escapeHtml_;

  // =========================
  // 1) 基本ユーティリティ
  // =========================

  /**
   * 属性値用エスケープ
   * - data-* / id / title などへ安全に埋め込む用
   */
  function escapeAttr_(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 5桁カードIDへ正規化
   */
  function normalizeCd5_(cd) {
    if (typeof window.normCd5 === 'function') return window.normCd5(cd);
    const s = String(cd ?? '').trim();
    return s ? s.padStart(5, '0').slice(0, 5) : '';
  }

  /**
   * 使用可能なカードMapを取得
   */
  function getCardMap_(options) {
    return options?.cardMap || window.cardMap || window.allCardsMap || {};
  }

  const CARD_VERSIONS_URL_ = './public/cards_versions.json';
  const CARD_DATA_BASE_ = './public/';
  const ADJUSTMENT_FIELDS_ = [
    'cost',
    'power',
    'effect_name1',
    'effect_text1',
    'effect_name2',
    'effect_text2',
    'effect_text_all',
  ];
  const cardAdjustmentCache_ = new Map();
  let cardVersionsPromise_ = null;

  function cardValue_(card, key) {
    const v = card?.[key];
    return v === null || v === undefined ? '' : String(v);
  }

  function isDifferentCardVersion_(a, b) {
    return ADJUSTMENT_FIELDS_.some((key) => cardValue_(a, key) !== cardValue_(b, key));
  }

  async function fetchJson_(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
    return await res.json();
  }

  async function loadCardVersions_() {
    if (cardVersionsPromise_) return cardVersionsPromise_;
    cardVersionsPromise_ = fetchJson_(CARD_VERSIONS_URL_)
      .then((json) => Array.isArray(json?.versions) ? json.versions : [])
      .catch((err) => {
        console.warn('[card-detail] cards_versions.json 読み込み失敗:', err);
        return [];
      });
    return cardVersionsPromise_;
  }

  async function loadCardVersionRows_(cd) {
    const cd5 = normalizeCd5_(cd);
    if (!cd5) return [];
    if (cardAdjustmentCache_.has(cd5)) return cardAdjustmentCache_.get(cd5);

    const promise = (async () => {
      const versions = await loadCardVersions_();
      const rows = [];

      for (const item of versions) {
        const file = item?.file;
        if (!file) continue;

        try {
          const cards = await fetchJson_(CARD_DATA_BASE_ + String(file).replace(/^\/+/, ''));
          if (!Array.isArray(cards)) continue;
          const card = cards.find((row) => normalizeCd5_(row?.cd) === cd5);
          if (!card) continue;
          rows.push({
            version: item.version || card.updated_at || '',
            label: item.version || card.updated_at || '',
            card,
          });
        } catch (err) {
          console.warn('[card-detail] カード履歴JSON読み込み失敗:', file, err);
        }
      }

      const current = (window.cardMap || window.allCardsMap || {})[cd5];

      const unique = [];
      for (const row of rows) {
        const prev = unique[unique.length - 1];
        if (!prev || isDifferentCardVersion_(prev.card, row.card)) {
          unique.push(row);
        }
      }

      if (current) {
        unique.push({
          version: 'latest',
          label: '最新版',
          card: current,
        });
      }

      const latest = unique[unique.length - 1];
      if (!latest) return [];

      const changed = unique.filter((row) => isDifferentCardVersion_(row.card, latest.card));
      if (!changed.length) return [];

      // 最新版と同じ役割になる直近の日付版は、切替ボタンから省く
      const beforeRows = changed.reverse().slice(1);
      if (!beforeRows.length) return [];

      return [latest, ...beforeRows];
    })();

    cardAdjustmentCache_.set(cd5, promise);
    return promise;
  }

  function cardEffectHtml_(card) {
    const parts = [];
    const en1 = card?.effect_name1 ?? '';
    const et1 = card?.effect_text1 ?? '';
    const en2 = card?.effect_name2 ?? '';
    const et2 = card?.effect_text2 ?? '';

    if (en1) parts.push(`<div><strong class="effect-name">${escapeHtml_(en1)}</strong></div>`);
    if (et1) parts.push(`<div>${escapeHtml_(et1)}</div>`);
    if (en2) parts.push(`<div><strong class="effect-name">${escapeHtml_(en2)}</strong></div>`);
    if (et2) parts.push(`<div>${escapeHtml_(et2)}</div>`);

    return parts.join('\n') || '<div>効果情報はありません</div>';
  }

  function applyCardVersionToDetail_(detailEl, row) {
    const card = row?.card;
    if (!detailEl || !card) return;

    detailEl.dataset.currentVersion = row.version || '';
    detailEl.__cardDetailCurrentCard = card;

    const nameEl = detailEl.querySelector('.card-name');
    if (nameEl) nameEl.textContent = card.name || '';

    const packEl = detailEl.querySelector('.card-pack');
    if (packEl) packEl.textContent = card.packName ?? card.pack_name ?? '';

    const raceEl = detailEl.querySelector('.card-race');
    if (raceEl) raceEl.textContent = card.race || '';

    const categoryEl = detailEl.querySelector('.card-category');
    if (categoryEl) categoryEl.textContent = card.category || '';

    const effectEl = detailEl.querySelector('.card-effect');
    if (effectEl) effectEl.innerHTML = cardEffectHtml_(card);

    const zoomBtn = detailEl.querySelector('.detail-zoom-btn');
    if (zoomBtn) zoomBtn.__cardDetailCurrentCard = card;

    updateSourceCardImage_(detailEl, card);
  }

  function updateSourceCardImage_(detailEl, card) {
    const sourceCard = detailEl?.__sourceCardElement;
    const img = sourceCard?.querySelector?.('img');
    if (!img || !card) return;

    if (typeof window.setCardImageSrc === 'function') {
      window.setCardImageSrc(img, card);
      return;
    }

    const cd = normalizeCd5_(card.cd || sourceCard.dataset?.cd);
    img.src = cd ? `img/${cd}.webp` : 'img/00000.webp';
  }

  function resetSourceCardImage_(detailEl) {
    const sourceCard = detailEl?.__sourceCardElement;
    const cd = normalizeCd5_(sourceCard?.dataset?.cd || detailEl?.dataset?.cd);
    if (!sourceCard || !cd) return;

    const latest = (window.cardMap || window.allCardsMap || {})[cd] || { cd };
    updateSourceCardImage_(detailEl, latest);
  }

  async function attachAdjustmentSwitcher_(detailEl, cd) {
    if (!detailEl || detailEl.dataset.adjustmentSwitcherBound === '1') return;
    detailEl.dataset.adjustmentSwitcherBound = '1';

    const effectEl = detailEl.querySelector('.card-effect');
    if (!effectEl) return;

    const rows = await loadCardVersionRows_(cd);
    if (!rows.length || !detailEl.isConnected) return;

    const currentVersion = rows[0]?.version || 'latest';
    const wrap = document.createElement('div');
    wrap.className = 'card-adjustment-switcher';

    rows.forEach((row) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card-adjustment-btn';
      btn.textContent = row.version === 'latest' ? '最新版' : `${row.label} 調整前`;
      btn.dataset.version = row.version || '';
      btn.classList.toggle('is-active', (row.version || '') === currentVersion);
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        wrap.querySelectorAll('.card-adjustment-btn').forEach((el) => {
          el.classList.toggle('is-active', el === btn);
        });
        applyCardVersionToDetail_(detailEl, row);
      });
      wrap.appendChild(btn);
    });

    effectEl.insertAdjacentElement('beforebegin', wrap);
    applyCardVersionToDetail_(detailEl, rows[0]);
  }

  // =========================
  // 2) 詳細HTMLテンプレート生成
  // =========================

  /**
   * カード1枚分の詳細HTMLを生成
   * - 事前に詳細DOMを置いていない場合のテンプレとしても使用する
   */
  function generateDetailHtml(card) {
    const cd = normalizeCd5_(card.cd);
    const name = card.name ?? '';
    const type = card.type ?? '';
    const race = card.race ?? '';
    const category = card.category ?? '';
    const packName = card.packName ?? card.pack_name ?? '';
    const cvName = card.CV ?? '';
    const cvKana = card.cv_kana ?? '';

    const en1 = card.effect_name1 ?? '';
    const et1 = card.effect_text1 ?? '';
    const en2 = card.effect_name2 ?? '';
    const et2 = card.effect_text2 ?? '';

    // 効果名と効果文を順番どおりに並べる
    const effectParts = [];

    if (en1) {
      effectParts.push(`<div><strong class="effect-name">${escapeHtml_(en1)}</strong></div>`);
    }
    if (et1) {
      effectParts.push(`<div>${escapeHtml_(et1)}</div>`);
    }
    if (en2) {
      effectParts.push(`<div><strong class="effect-name">${escapeHtml_(en2)}</strong></div>`);
    }
    if (et2) {
      effectParts.push(`<div>${escapeHtml_(et2)}</div>`);
    }

    // 効果未登録時のフォールバック
    const effectHtml = effectParts.join('\n') || '<div>効果情報はありません</div>';

    // タイプ・種族ごとの装飾クラス
    const typeClass = type ? `type-${type}` : '';
    const raceClass = race ? `race-${race}` : '';
    const cvHtml = cvName
      ? `<div class="card-meta card-cv"><span class="card-cv-label">CV</span>: <span class="card-cv-name">${escapeHtml_(cvName)}</span>${cvKana ? ` <span class="card-cv-kana">（${escapeHtml_(cvKana)}）</span>` : ''}<button type="button" class="card-cv-search-btn" data-cv="${escapeAttr_(cvName)}" aria-label="${escapeAttr_(cvName)}で検索" title="このCVで検索">🔎</button></div>`
      : '';

    return `
      <div class="card-detail ${typeClass} ${raceClass}"
           id="detail-${cd}"
           data-cd="${cd}"
           data-name="${escapeAttr_(name)}"
           data-race="${escapeAttr_(race)}"
           style="display: none;">
        <div class="card-name">${escapeHtml_(name)}</div>
        <div class="card-meta card-pack">
          ${escapeHtml_(packName)}
        </div>
        <div class="card-meta">
          <span class="card-race">${escapeHtml_(race)}</span> /
          <span class="card-category">${escapeHtml_(category)}</span>
        </div>
        ${cvHtml}
        <div class="card-effect">
          ${effectHtml}
        </div>
      </div>
    `.trim();
  }

  // =========================
  // 3) 詳細要素フォールバック生成
  // =========================

  /**
   * #detail-xxxxx が無いときに、その場で詳細要素を再構築する
   * - cardMap 優先
   * - 無ければ card.dataset から補完
   */
  function buildDetailElementFallback_(cd, cardEl) {
    const cd5 = normalizeCd5_(cd);
    const map = window.cardMap?.[cd5];
    const data = cardEl?.dataset || {};

    const card = {
      cd: cd5,
      name: map?.name ?? data.name ?? '',
      type: map?.type ?? data.type ?? '',
      race: map?.race ?? data.race ?? '',
      category: map?.category ?? data.category ?? '',
      packName: map?.packName ?? data.pack ?? '',
      pack_name: map?.pack_name ?? data.pack ?? '',
      effect_name1: map?.effect_name1 ?? data.effect1 ?? '',
      effect_text1: map?.effect_text1 ?? data.effecttext1 ?? '',
      effect_name2: map?.effect_name2 ?? data.effect2 ?? '',
      effect_text2: map?.effect_text2 ?? data.effecttext2 ?? '',
      CV: map?.CV ?? data.cv ?? '',
      cv_kana: map?.cv_kana ?? data.cvKana ?? '',
    };

    const html = window.CardDetailTemplate?.generate
      ? window.CardDetailTemplate.generate(card)
      : (window.generateDetailHtml ? window.generateDetailHtml(card) : '');

    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();

    const el = wrap.firstElementChild || document.createElement('div');
    el.id = el.id || `detail-${cd5}`;
    el.setAttribute('data-cd', el.getAttribute('data-cd') || cd5);

    return el;
  }

  // =========================
  // 4) カード詳細展開
  // =========================

  /**
   * クリックされたカードの行末直後へ詳細を差し込む
   * - すでに同じカード詳細が開いていれば閉じる
   * - grid がリスト表示中なら展開しない
   */
  function expandCard(clickedCard) {
    const cd = clickedCard?.getAttribute?.('data-cd');
    if (!cd) return;

    const grid = document.getElementById('grid');
    if (!grid) return;

    // リスト表示中は詳細差し込みを行わない
    if (grid.classList.contains('is-list')) return;

    // すでに開いている詳細を確認
    const existing = document.querySelector('.card-detail.active');

    // 同じカードならトグルで閉じる
    if (existing && existing.getAttribute('data-cd') === cd) {
      resetSourceCardImage_(existing);
      existing.remove();
      return;
    }

    // 別カード詳細が開いているなら先に閉じる
    if (existing) {
      resetSourceCardImage_(existing);
      existing.remove();
    }

    // 既存詳細を再利用、無ければその場で生成
    let detail = document.getElementById(`detail-${cd}`);
    if (!detail) {
      detail = buildDetailElementFallback_(cd, clickedCard);
    }
    if (!detail) return;

    // 実表示用に複製
    const cloned = detail.cloneNode(true);
    cloned.style.display = 'block';
    cloned.classList.add('active');
    cloned.classList.add('card-detail');
    cloned.setAttribute('data-cd', cd);
    cloned.__sourceCardElement = clickedCard;

    // 詳細内に所持数UIを付与
    attachOwnedEditor_(cloned, cd);

    // 今表示中のカードだけを対象に並び順を計算
    const cards = Array.from(grid.querySelectorAll('.card')).filter((card) => {
      if (!card.offsetParent) return false;

      const cs = window.getComputedStyle ? getComputedStyle(card) : null;
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;

      return true;
    });

    const clickedIndex = cards.indexOf(clickedCard);
    if (clickedIndex < 0) return;

    // 実際の折り返し位置から、クリックしたカードの行末を判定する
    const clickedTop = Math.round(clickedCard.getBoundingClientRect().top);
    let rowEnd = clickedIndex;
    for (let i = clickedIndex + 1; i < cards.length; i += 1) {
      const nextTop = Math.round(cards[i].getBoundingClientRect().top);
      if (Math.abs(nextTop - clickedTop) > 2) break;
      rowEnd = i;
    }
    const insertAfter = cards[rowEnd];
    if (!insertAfter) return;

    // 行末の直後へ詳細を差し込む
    insertAfter.insertAdjacentElement('afterend', cloned);
    attachAdjustmentSwitcher_(cloned, cd);
  }

  /**
   * 詳細表示ボタンから呼ぶラッパー
   * - クリック伝播を止めて親.card を拾う
   */
  function handleZoomClick(event, el) {
    event?.stopPropagation?.();
    event?.preventDefault?.();

    const cardEl = el?.closest ? el.closest('.card') : null;
    if (!cardEl) return;

    expandCard(cardEl);
  }

  /**
   * 詳細内CVボタンからCV検索を実行する
   */
  function handleCvSearchClick_(event) {
    const btn = event?.target?.closest?.('.card-cv-search-btn');
    if (!btn) return;

    event.preventDefault();
    event.stopPropagation();

    const cvName = String(btn.dataset.cv || btn.textContent || '').trim();
    if (!cvName) return;

    if (typeof window.CardFilter?.setCvFilter === 'function') {
      window.CardFilter.setCvFilter(cvName);
      return;
    }

    const input = document.getElementById('cv-filter');
    if (input) {
      input.value = cvName;
      try { window.applyFilters?.(); } catch {}
      return;
    }

    const keyword = document.getElementById('keyword');
    if (keyword) {
      keyword.value = cvName;
      try { window.applyFilters?.(); } catch {}
    }
  }

  // =========================
  // 5) 所持数UI
  // =========================

  /**
   * 詳細ヘッダー内へ所持数エディタを付与
   * - 二重挿入防止あり
   * - 編集ロック切り替え
   * - + / - 変更
   * - 外部変更の追従
   */
  function attachOwnedEditor_(detailEl, cd) {
    // 二重挿入防止
    if (detailEl.querySelector('.owned-editor')) return;

    const nameEl = detailEl.querySelector('.card-name');

    // 詳細DOM構造が多少違っても入れられるようにフォールバック先を持つ
    const hostFallback =
      detailEl.querySelector('.detail-header') ||
      detailEl.querySelector('.card-detail-header') ||
      detailEl;

    // タイトル行があれば再利用、無ければ生成
    let titleRow = detailEl.querySelector('.card-title-row');
    if (!titleRow) {
      titleRow = document.createElement('div');
      titleRow.className = 'card-title-row';

      // カード名があれば titleRow へ移動
      if (nameEl && nameEl.parentNode) {
        const parent = nameEl.parentNode;
        parent.insertBefore(titleRow, nameEl);
        titleRow.appendChild(nameEl);
      } else {
        // カード名が無い場合は先頭へ差し込む
        hostFallback.insertBefore(titleRow, hostFallback.firstChild);
      }
    }

    // ----- UI部品生成 -----

    const wrap = document.createElement('div');
    wrap.className = 'owned-editor is-locked';

    const label = document.createElement('span');
    label.className = 'owned-editor-label';
    label.textContent = '所持数';

    const num = document.createElement('span');
    num.className = 'owned-editor-num';
    num.setAttribute('aria-label', '所持数');

    const btnMinus = document.createElement('button');
    btnMinus.type = 'button';
    btnMinus.className = 'owned-editor-btn owned-editor-minus';
    btnMinus.textContent = '-';
    btnMinus.disabled = true;

    const btnPlus = document.createElement('button');
    btnPlus.type = 'button';
    btnPlus.className = 'owned-editor-btn owned-editor-plus';
    btnPlus.textContent = '+';
    btnPlus.disabled = true;

    const btnToggle = document.createElement('button');
    btnToggle.type = 'button';
    btnToggle.className = 'owned-editor-toggle';
    btnToggle.textContent = '編集';
    btnToggle.setAttribute('aria-pressed', 'false');

    wrap.append(label, btnMinus, num, btnPlus, btnToggle);
    titleRow.appendChild(wrap);

    // タイトル行が整った後で拡大ボタンも差し込む
    attachZoomBtnToDetail_(detailEl, cd);

    /**
     * 現在の所持数合計を取得
     * - normal の所持数を表示
     */
    function readTotal_() {
      try {
        const entry = window.OwnedStore?.get?.(String(cd)) || {
          normal: 0,
        };
        return entry.normal | 0;
      } catch {
        return 0;
      }
    }

    /**
     * 所持数を書き込み
     * - 実保存は normal に寄せる
     * - 書き込み後に一覧UIも再同期
     */
    function writeTotal_(value) {
      const max = (typeof window.maxAllowedCount === 'function')
        ? window.maxAllowedCount(String(cd), detailEl.dataset?.race || '')
        : 3;

      const next = Math.max(0, Math.min(max, value | 0));

      try {
        window.OwnedStore?.set?.(String(cd), next);
      } catch {}

      try {
        window.OwnedUI?.sync?.('#grid');
      } catch {}

      num.textContent = String(next);
      updateBtnState_();
    }

    /**
     * 現在値に応じて + / - ボタン状態更新
     */
    function updateBtnState_() {
      const current = readTotal_();
      const max = (typeof window.maxAllowedCount === 'function')
        ? window.maxAllowedCount(String(cd), detailEl.dataset?.race || '')
        : 3;

      const atMin = current <= 0;
      btnMinus.disabled = atMin;
      btnMinus.classList.toggle('is-disabled', atMin);

      const atMax = current >= max;
      btnPlus.disabled = atMax;
      btnPlus.classList.toggle('is-disabled', atMax);
    }

    /**
     * 編集ロック切り替え
     * - locked=true : + / - 無効
     * - locked=false: 編集可能
     */
    function setLocked_(locked) {
      wrap.classList.toggle('is-locked', locked);

      btnMinus.disabled = locked;
      btnPlus.disabled = locked;

      btnToggle.setAttribute('aria-pressed', locked ? 'false' : 'true');
      btnToggle.textContent = locked ? '編集' : '編集中';

      if (!locked) {
        updateBtnState_();
      }
    }

    // 初期表示
    num.textContent = String(readTotal_());
    updateBtnState_();

    // ----- イベント -----

    btnToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setLocked_(!wrap.classList.contains('is-locked'));
    });

    btnMinus.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      writeTotal_(readTotal_() - 1);
    });

    btnPlus.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      writeTotal_(readTotal_() + 1);
    });

    // 外部更新にも追従
    try {
      window.OwnedStore?.onChange?.(() => {
        num.textContent = String(readTotal_());
        updateBtnState_();
      });
    } catch {}
  }

  // =========================
  // 6) 詳細内拡大ボタン
  // =========================

  /**
   * 詳細ヘッダーへ虫眼鏡ボタンを追加
   * - 既存構造差異にも対応
   * - 二重追加防止あり
   */
  function attachZoomBtnToDetail_(detailEl, cd) {
    if (!detailEl) return;

    const cd5 = normalizeCd5_(cd || detailEl.getAttribute('data-cd') || '');

    // 無効IDやダミー画像は対象外
    if (!cd5 || cd5 === '00000') return;

    // 二重追加防止
    if (detailEl.querySelector('.detail-zoom-btn')) return;

    const titleRow = detailEl.querySelector('.card-title-row');
    const nameEl = detailEl.querySelector('.card-name');
    if (!titleRow || !nameEl) return;

    // 旧構造 card-title-left があれば外して card-name を戻す
    const left = titleRow.querySelector('.card-title-left');
    if (left) {
      const movedName = left.querySelector('.card-name');
      if (movedName) {
        titleRow.insertBefore(movedName, left);
      }
      left.remove();
    }

    // card-name が titleRow 直下でなければ先頭側へ移動
    if (nameEl.parentElement !== titleRow) {
      titleRow.insertBefore(nameEl, titleRow.firstChild);
    }

    // 拡大ボタン生成
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'detail-zoom-btn';
    btn.setAttribute('aria-label', '画像を拡大');
    btn.title = '画像を拡大';
    btn.innerHTML = `
      <img
        class="zoom-ic"
        src="./img/zoom_in_24.svg"
        alt=""
        aria-hidden="true"
        decoding="async"
      >
    `;

    // クリックで画像拡大モーダルを開く
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.CardZoomModal?.open?.(btn.__cardDetailCurrentCard || detailEl.__cardDetailCurrentCard || cd5);
    });

    // カード名の前に差し込む
    titleRow.insertBefore(btn, nameEl);
  }

  /**
   * 既存 / 後追加の .card-detail に自動で拡大ボタンを付与する
   */
  function observeCardDetailsForZoomBtn_() {
    // 初期DOMへ反映
    document.querySelectorAll('.card-detail').forEach((el) => {
      attachZoomBtnToDetail_(el, el.getAttribute('data-cd'));
    });

    // 後から追加される要素も監視
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          // 追加ノード自身が .card-detail の場合
          if (node.classList?.contains('card-detail')) {
            attachZoomBtnToDetail_(node, node.getAttribute('data-cd'));
          }

          // 子孫内に .card-detail がある場合
          const details = node.querySelectorAll?.('.card-detail');
          if (details && details.length) {
            details.forEach((el) => {
              attachZoomBtnToDetail_(el, el.getAttribute('data-cd'));
            });
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // =========================
  // 7) CardZoomModal ラッパー
  // =========================

  /**
   * 既存の CardZoomModal を CardDetailUI 側からも使えるようにする薄いラッパー
   */
  function ensureCardZoomModal_() {
    return window.CardZoomModal?.ensure?.();
  }

  function openCardZoom_(cd) {
    return window.CardZoomModal?.open?.(cd);
  }

  function closeCardZoom_() {
    return window.CardZoomModal?.close?.();
  }

  function bindLongPressForCards(rootSelector = '#grid') {
    return window.CardZoomModal?.bindLongPressForCards?.(rootSelector);
  }

  // =========================
  // 8) カード詳細モーダル
  // =========================

  let cardDetailModalCurrentCd_ = null;
  let cardDetailModalHelpShown_ = false;
  let cardDetailModalHelpTimer_ = 0;

  const cardDetailModalDrag_ = {
    active: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
  };

  const CARD_DETAIL_MODAL_VIEWPORT_MARGIN_ = 8;

  const CARD_DETAIL_MODAL_RACE_CLASSES_ = [
    'race-ドラゴン',
    'race-アンドロイド',
    'race-エレメンタル',
    'race-ルミナス',
    'race-シェイド',
    'race-イノセント',
    'race-旧神',
  ];

  /**
   * カード情報を取得
   * - オブジェクト直渡しにも対応
   * - cd 指定なら map から引く
   */
  function getCardDetailInfo_(cardOrCd, options) {
    if (cardOrCd && typeof cardOrCd === 'object') {
      const cd = normalizeCd5_(cardOrCd.cd ?? cardOrCd.id ?? options?.cd);
      return { cd, info: cardOrCd };
    }

    const cd = normalizeCd5_(cardOrCd);
    const map = getCardMap_(options);

    return {
      cd,
      info: map?.[cd] || map?.[String(cardOrCd)] || null,
    };
  }

  /**
   * モーダル関連要素をまとめて取得
   */
  function getCardDetailModalEls_() {
    return {
      modal: document.getElementById('cardDetailModal'),
      box: document.getElementById('cardDetailModalContent'),
      close: document.getElementById('cardDetailModalClose'),
      title: document.getElementById('cardDetailModalTitle'),
      img: document.getElementById('cardDetailModalImg'),
      figure: document.getElementById('cardDetailModalFigure'),

      dragHandle: document.getElementById('cardDetailModalDragHandle'),
      help: document.getElementById('cardDetailModalHelp'),
      pack: document.getElementById('cardDetailModalPack'),
      meta: document.getElementById('cardDetailModalMeta'),
      cv: document.getElementById('cardDetailModalCv'),

      effectTabs: document.getElementById('cardDetailModalEffectTabs'),
      effectBody: document.getElementById('cardDetailModalEffectBody'),
    };
  }

  /**
   * カード詳細モーダルDOMを確保
   * - 無ければ生成
   * - あれば再利用
   */
  function ensureCardDetailModal_() {
    let modal = document.getElementById('cardDetailModal');

    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'cardDetailModal';
      modal.className = 'modal card-detail-modal-root';
      modal.innerHTML = `
        <div class="modal-content card-detail-modal" id="cardDetailModalContent" role="dialog" aria-modal="true" aria-labelledby="cardDetailModalTitle">
          <div class="card-detail-modal-body">
            <button
              type="button"
              class="card-detail-modal-figure"
              id="cardDetailModalFigure"
              aria-label="カード画像を拡大"
            >
              <img id="cardDetailModalImg" alt="">
            </button>

            <div class="card-detail-modal-info">
              <div class="card-detail-modal-title-row">
                <h3 id="cardDetailModalTitle" class="card-detail-modal-title"></h3>

                <button
                  type="button"
                  class="card-detail-modal-move-hint"
                  id="cardDetailModalDragHandle"
                  aria-label="ドラッグして移動"
                  title="ドラッグして移動"
                >≡</button>

                <button
                  type="button"
                  class="card-detail-modal-close"
                  id="cardDetailModalClose"
                  aria-label="閉じる"
                >&times;</button>

                <div class="card-detail-modal-help" id="cardDetailModalHelp" role="status" hidden>
                  <span><b>≡</b>：ドラッグで移動</span>
                  <span><b>×</b>：閉じる</span>
                </div>
              </div>

              <div class="card-detail-modal-pack" id="cardDetailModalPack"></div>
              <div class="card-detail-modal-meta" id="cardDetailModalMeta"></div>
              <div class="card-detail-modal-cv" id="cardDetailModalCv"></div>

              <div class="card-detail-modal-effect">
                <div class="card-detail-modal-effect-tabs" id="cardDetailModalEffectTabs"></div>
                <div class="card-detail-modal-effect-body" id="cardDetailModalEffectBody"></div>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    bindCardDetailModalEvents_();
    return modal;
  }

  /**
   * 効果欄描画
   */
  function renderCardDetailModalEffects_(info) {
    const { effectTabs, effectBody } = getCardDetailModalEls_();
    if (!effectTabs || !effectBody) return;

    effectTabs.innerHTML = '';
    effectBody.innerHTML = '';

    const items = [];
    const names = [info?.effect_name1, info?.effect_name2].filter(Boolean);
    const texts = [info?.effect_text1, info?.effect_text2].filter(Boolean);

    for (let i = 0; i < Math.max(names.length, texts.length); i++) {
      items.push({
        name: names[i] || '効果',
        text: texts[i] || '',
      });
    }

    // 別形式の effect / text にも対応
    if (!items.length && (info?.effect || info?.text)) {
      items.push({
        name: info.effect || '効果',
        text: info.text || '',
      });
    }

    // 効果なし表示
    if (!items.length) {
      effectTabs.hidden = true;
      effectBody.innerHTML = '<div class="effect-name">効果</div><div class="effect-text">効果情報なし</div>';
      return;
    }

    const renderBody = (item) => {
      effectBody.innerHTML = `<div class="effect-text">${escapeHtml_(item.text || '')}</div>`;
    };

    effectTabs.hidden = false;
    renderBody(items[0]);

    // 複数効果はタブで切り替える
    items.forEach((item, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `card-detail-effect-tab${index === 0 ? ' is-active' : ''}`;
      tab.textContent = item.name || `効果${index + 1}`;
      tab.addEventListener('click', () => {
        effectTabs.querySelectorAll('.card-detail-effect-tab').forEach((btn) => {
          btn.classList.toggle('is-active', btn === tab);
        });
        renderBody(item);
      });
      effectTabs.appendChild(tab);
    });
  }

  /**
   * モーダルを閉じる
   */
  function closeCardDetailModal_() {
    const { modal, help } = getCardDetailModalEls_();
    if (!modal) return;

    if (help) {
      help.hidden = true;
      help.classList.remove('is-show');
    }
    window.clearTimeout(cardDetailModalHelpTimer_);

    modal.classList.remove('show');
    modal.style.display = 'none';
    cardDetailModalCurrentCd_ = null;
  }

  /**
   * 初回だけ操作案内を表示
   */
  function showCardDetailModalHelpOnce_() {
    if (cardDetailModalHelpShown_) return;

    const { help } = getCardDetailModalEls_();
    if (!help) return;

    cardDetailModalHelpShown_ = true;
    help.hidden = false;
    help.classList.add('is-show');

    window.clearTimeout(cardDetailModalHelpTimer_);
    cardDetailModalHelpTimer_ = window.setTimeout(() => {
      help.hidden = true;
      help.classList.remove('is-show');
    }, 3600);
  }

  /**
   * モーダルの初期表示位置を決める
   * - anchorRect があればその近く
   * - 無ければ画面中央付近
   */
  function positionCardDetailModal_(anchorRect) {
    const { box } = getCardDetailModalEls_();
    if (!box) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const rect = anchorRect || {
      left: vw / 2,
      right: vw / 2,
      top: vh / 2,
      bottom: vh / 2,
    };

    const desiredLeft = (rect.right ?? rect.left) + 8;
    const desiredTop = rect.top ?? rect.bottom ?? vh / 2;

    requestAnimationFrame(() => {
      box.style.transform = 'none';
      clampCardDetailModalPosition_(desiredLeft, desiredTop);
    });
  }

  function clampCardDetailModalPosition_(left, top) {
    const { box } = getCardDetailModalEls_();
    if (!box) return;

    const margin = CARD_DETAIL_MODAL_VIEWPORT_MARGIN_;
    const width = box.offsetWidth || 320;
    const height = box.offsetHeight || 240;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const safeLeft = Math.min(Math.max(left, margin), maxLeft);
    const safeTop = Math.min(Math.max(top, margin), maxTop);

    box.style.left = safeLeft + 'px';
    box.style.top = safeTop + 'px';
  }

  function keepCardDetailModalInViewport_() {
    const { modal, box } = getCardDetailModalEls_();
    if (!modal || !box || !modal.classList.contains('show')) return;

    const rect = box.getBoundingClientRect();
    box.style.transform = 'none';
    clampCardDetailModalPosition_(rect.left, rect.top);
  }

  /**
   * モーダルを開く
   * - card object / cd 両対応
   */
  function openCardDetailModal_(cardOrCd, options = {}) {
    const { cd, info } = getCardDetailInfo_(cardOrCd, options);
    if (!info) return;

    cardDetailModalCurrentCd_ = cd;
    ensureCardDetailModal_();

    const {
      modal,
      box,
      img,
      title,
      pack,
      meta,
      cv,
      figure,
    } = getCardDetailModalEls_();

    if (!modal) return;

    if (box) {
      box.classList.remove(...CARD_DETAIL_MODAL_RACE_CLASSES_);
      if (info.race) box.classList.add(`race-${info.race}`);
    }

    if (img) {
      const imageBasePath = String(options.imageBasePath || 'img/');
      img.alt = info.name || '';

      if (typeof window.setCardImageSrc === 'function' && imageBasePath === 'img/') {
        window.setCardImageSrc(img, info);
      } else {
        img.src = `${imageBasePath}${cd}.webp`;
        img.onerror = () => {
          img.onerror = null;
          img.src = `${imageBasePath}00000.webp`;
        };
      }
    }

    if (title) {
      title.textContent = info.name || 'カード詳細';
    }

    if (pack) {
      pack.textContent = info.packName || info.pack_name || 'パック情報なし';
    }

    if (meta) {
      const race = info.race || '';
      const category = info.category || '';
      meta.textContent = [race, category].filter(Boolean).join(' / ') || '種族・カテゴリ情報なし';
    }

    if (cv) {
      const cvName = info.CV || '';
      const cvKana = info.cv_kana || '';
      cv.textContent = cvName
        ? `CV：${cvName}${cvKana ? `（${cvKana}）` : ''}`
        : 'CV：なし';
    }

    if (figure) {
      figure.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.CardZoomModal?.open?.(cd);
      };
    }

    renderCardDetailModalEffects_(info);

    modal.style.display = 'block';
    modal.classList.add('show');
    showCardDetailModalHelpOnce_();

    positionCardDetailModal_(options.anchorRect);
  }

  /**
   * モーダルイベントを一度だけ登録
   * - ドラッグ移動
   * - 閉じるボタン
   */
  function bindCardDetailModalEvents_() {
    const els = getCardDetailModalEls_();
    if (!els.modal || !els.box || els.modal.dataset.cardDetailBound === '1') return;

    els.modal.dataset.cardDetailBound = '1';

    els.modal.addEventListener('click', (e) => {
      if (els.box.contains(e.target)) return;
      closeCardDetailModal_();
    });

    const dragHandle = els.dragHandle;

    if (dragHandle) {
      const onDown = (e) => {
        cardDetailModalDrag_.active = true;

        const rect = els.box.getBoundingClientRect();
        const point = e.touches?.[0] || e;

        cardDetailModalDrag_.startX = point.clientX;
        cardDetailModalDrag_.startY = point.clientY;
        cardDetailModalDrag_.startLeft = rect.left;
        cardDetailModalDrag_.startTop = rect.top;

        els.box.style.transform = 'none';
        e.preventDefault?.();
      };

      const onMove = (e) => {
        if (!cardDetailModalDrag_.active) return;

        const point = e.touches?.[0] || e;
        const left = cardDetailModalDrag_.startLeft + (point.clientX - cardDetailModalDrag_.startX);
        const top = cardDetailModalDrag_.startTop + (point.clientY - cardDetailModalDrag_.startY);

        clampCardDetailModalPosition_(left, top);
      };

      const onUp = () => {
        cardDetailModalDrag_.active = false;
      };

      dragHandle.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

      dragHandle.addEventListener('touchstart', onDown, { passive: false });
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
      window.addEventListener('touchcancel', onUp);
    }

    els.close?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeCardDetailModal_();
    });

    window.addEventListener('resize', keepCardDetailModalInViewport_);

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!els.modal.classList.contains('show')) return;
      closeCardDetailModal_();
    });
  }

  // =========================
  // 9) 公開API
  // =========================

  window.CardDetailUI = {
    expandCard,
    handleZoomClick,
    ensureCardDetailModal: ensureCardDetailModal_,
    openCardDetailModal: openCardDetailModal_,
    closeCardDetailModal: closeCardDetailModal_,
    openCardZoom: openCardZoom_,
    closeCardZoom: closeCardZoom_,
    attachOwnedEditor: attachOwnedEditor_,
    attachZoomBtn: attachZoomBtnToDetail_,
    handleCvSearchClick: handleCvSearchClick_,
    bindLongPressForCards,
  };

  window.CardDetailModal = {
    ensure: ensureCardDetailModal_,
    open: openCardDetailModal_,
    close: closeCardDetailModal_,
  };

  window.openCardDetailModal = window.openCardDetailModal || openCardDetailModal_;
  window.closeCardDetailModal = window.closeCardDetailModal || closeCardDetailModal_;

  // 外部イベントからモーダルを開く
  document.addEventListener('open-card-detail', (event) => {
    const detail = event.detail || {};
    openCardDetailModal_(detail.cardId || detail.cd, {
      anchorRect: detail.anchorRect || null,
      cardMap: detail.cardMap,
    });
  });

  // 互換公開
  window.generateDetailHtml = generateDetailHtml;
  window.CardDetailTemplate = window.CardDetailTemplate || {};
  window.CardDetailTemplate.generate = generateDetailHtml;
  window.handleZoomClick = handleZoomClick;

  // 詳細テンプレートは複製されるため、CV検索は委譲で拾う
  if (!window.__cardDetailCvSearchBound) {
    window.__cardDetailCvSearchBound = true;
    document.addEventListener('click', handleCvSearchClick_);
  }

  // 拡大ボタン監視は一度だけ開始
  if (!window.__detailZoomBtnObserverBound) {
    window.__detailZoomBtnObserverBound = true;
    observeCardDetailsForZoomBtn_();
  }
})();
