/**
 * js/pages/card/card-checker-page.js
 * - 所持率チェッカー（カードページ統合）の「ページ配線」
 * - HTML の onclick から呼ばれる関数を window に公開
 *
 * このファイルの責務：
 * - summary 更新後のゲージ同期（PCサイドバー / SPトップ / SPパック見出し下）
 * - packs が未初期化のときのフォールバック読み込み（public/packs.json）
 * - SP：全カードボタン / パックタブ（生成・ジャンプ・追従強調）
 *
 * 方針：
 * - デッキメーカー共有用のカスタムリンク生成は持たない
 */
(function () {
  'use strict';

  // =====================================================
  // 0) 小ユーティリティ
  // =====================================================

  function getStickyOffset_() {
    const topSummary = document.querySelector('.top-summary');
    const topBar     = document.querySelector('.top-bar'); // ← あなたのstickyバー

    const h1 = topSummary ? Math.ceil(topSummary.getBoundingClientRect().height) : 0;
    const h2 = topBar     ? Math.ceil(topBar.getBoundingClientRect().height)     : 0;

    return h1 + h2;
  }

  function scrollToY_(y) {
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  // =====================================================
  // 1) 初期化：summary更新 → ゲージ同期
  // =====================================================

  function runSummaryAndSyncMeters_() {
    try {
      if (typeof window.updateSummary === 'function') window.updateSummary();
      else if (window.Summary?.updateSummary) window.Summary.updateSummary();
    } catch (e) {
      console.warn('[card-checker-page] updateSummary failed', e);
    }

    // DOM反映のタイミングずれ対策（rAF + 0ms）
    requestAnimationFrame(() => {
      try { syncAllMeters_(); } catch (_) {}
      setTimeout(() => {
        try { syncAllMeters_(); } catch (_) {}
      }, 0);
    });
  }

  function initCheckerPage_() {
    runSummaryAndSyncMeters_();
  }

  window.addEventListener('DOMContentLoaded', initCheckerPage_);
  window.addEventListener('card-page:ready', initCheckerPage_);

  // =====================================================
  // 2) packs のフォールバック読み込み（未設定なら public/packs.json）
  // =====================================================

  window.PACK_ORDER = window.PACK_ORDER || [];
  window.packs = window.packs || [];

  function normalizePacks_(raw) {
    if (Array.isArray(raw)) return raw;

    const src = (raw && Array.isArray(raw.list)) ? raw.list
            : (raw && Array.isArray(raw.packs)) ? raw.packs
            : null;

    if (!src) return [];

    return src.map(x => ({
      key: x.key || x.slug || x.en,
      nameMain: x.en || x.nameMain || '',
      nameSub: x.jp || x.nameSub || '',
      selector: x.selector || `#pack-${x.slug || x.key || ''}`,
    }));
  }

  async function ensurePacksFallbackLoaded_() {
    try {
      if (Array.isArray(window.packs) && window.packs.length) return;

      const res = await fetch('public/packs.json', { cache: 'no-cache' });
      const raw = await res.json();
      const arr = normalizePacks_(raw);

      if (arr.length) window.packs = arr;
      else console.warn('[card-checker-page] packs.json は読めたが正規化できませんでした', raw);
    } catch (e) {
      console.warn('[card-checker-page] packs.json の読み込みに失敗', e);
    }
  }

  // 「このファイルが読まれたら」一応フォールバック読み込みを走らせる
  ensurePacksFallbackLoaded_();

  // =====================================================
  // 3) SP：全カードボタン & パックジャンプ（HTML onclick 互換）
  // =====================================================

  window.showAllCardsTop = function showAllCardsTop() {
    scrollToY_(0);
    setActivePackTab_(null);
  };

  // 旧互換（select は廃止したので no-op で残すだけ）
  window.selectMobilePack = function selectMobilePack(_value) { /* no-op */ };
  window.jumpToSelectedPack = function jumpToSelectedPack() { /* no-op */ };

  // パックジャンプ
// パックジャンプ
window.jumpToPack = function jumpToPack(packSlug) {
  const slug = String(packSlug || '').trim();
  if (!slug) return;

  // all相当
  if (slug === 'all') {
    window.showAllCardsTop?.();
    return;
  }

  suppressSpyUntil_ = Date.now() + 900; // ✅ 少し長めに（ズレ補正中に追従が暴れない）

  const wait = Math.max(0, suppressSpyUntil_ - Date.now() + 30);
    setTimeout(() => {
      try { scheduleSpySync_(); } catch (_) {}
    }, wait);

  const targetId = `pack-${slug}`;

  // 1回目：今のレイアウトで即ジャンプ
  const jumpOnce = () => {
    const target = document.getElementById(targetId);
    if (!target) return false;

    const offset = getStickyOffset_();
    const y = window.scrollY + target.getBoundingClientRect().top - offset - 8;
    scrollToY_(y);
    return true;
  };

  if (!jumpOnce()) {
    console.warn('[card-checker-page] jumpToPack: target not found', slug);
    return;
  }

  // ✅ タブ強調（先に付けておく）
  try { setActivePackTab_(slug); } catch (_) {}

  // 2回だけ微補正（画像/フォントで高さが変わっても追従する）
  // 待たせず “勝手に直す” のでUXが良い
  const fix = (delay) => setTimeout(() => {
    jumpOnce();
    // 追従も最終的に整える
    try { scheduleSpySync_?.(); } catch (_) {}
  }, delay);

  fix(160);
  fix(520);
};



  // =====================================================
  // 4) SP：パックタブ（生成・ラベル・リビルド）
  // =====================================================

  // ---- 表示ラベル作成 ----
  function makePackTabLabel_(jpText, enText) {
    const jp = String(jpText || '').trim();
    const en = String(enText || '').trim();

    // 1) まず SPECIAL / COLLAB 系
    if (/その他特殊カード/.test(en) || /特殊/.test(jp)) return '特殊';
    if (/コラボカード/.test(en) || /コラボ/.test(jp)) return 'コラボ';

    // 2) PACK_ORDER の index から A〜Z を生成（最優先）
    const ord = Array.isArray(window.PACK_ORDER) ? window.PACK_ORDER : [];
    const idx = ord.indexOf(en);
    if (idx >= 0 && idx < 26) return `${String.fromCharCode(65 + idx)}パック`;

    // 3) フォールバック（英名短縮）
    const base = (en || jp || 'PACK').replace(/\s+/g, ' ').trim();
    return base.length > 10 ? base.slice(0, 10) + '…' : base;
  }

  // ---- 状態（スクロールスパイ）----
  let packSpyStarted_ = false;
  let packSpyObserver_ = null;

  // ✅ クリック直後は IntersectionObserver の上書きを抑制
  let suppressSpyUntil_ = 0;

  // ✅ 追従更新を rAF で間引く
  let spyRaf_ = 0;
  let lastActiveSlug_ = '';

  function destroyPackScrollSpy_() {
    try { packSpyObserver_?.disconnect?.(); } catch (_) {}
    packSpyObserver_ = null;
    packSpyStarted_ = false;
  }

  function buildMobilePackTabs_({ force = false } = {}) {
    const tabsRoot = document.getElementById('mobile-pack-tabs');
    if (!tabsRoot) return false;

    if (!force && tabsRoot.dataset.built === '1') return true;

    reorderCollabAndSpecialSections_(); // ✅ tabs生成前に順番補正
    const sections = Array.from(document.querySelectorAll('#packs-root .pack-section[id^="pack-"]'));
    if (!sections.length) return false;

    // ✅ ここが重要：再描画に強くする
    tabsRoot.textContent = '';
    tabsRoot.dataset.built = '0';

    destroyPackScrollSpy_();

    const frag = document.createDocumentFragment();

    sections.forEach(sec => {
      const slug = sec.id.replace(/^pack-/, '');
      const nameMain = sec.querySelector('.pack-name-main')?.textContent?.trim() || '';
      const nameSub  = sec.querySelector('.pack-name-sub')?.textContent?.trim() || '';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.pack = slug;
      btn.textContent = makePackTabLabel_(nameSub, nameMain);

      btn.addEventListener('click', () => window.jumpToPack(slug));

      frag.appendChild(btn);
    });

    tabsRoot.appendChild(frag);
    tabsRoot.dataset.built = '1';

    // スクロールスパイ開始
    startPackScrollSpy_();

    // タブ生成直後に現在位置に合わせてアクティブを決める
    try { scheduleSpySync_(); } catch (_) {}

    return true;
  }

  function initMobileTabsWithRetry_() {
    let tries = 0;
    const tick = () => {
      tries++;
      const ok = buildMobilePackTabs_();
      if (ok) {
        // ✅ タブ生成が完了した後に、もう一度DOM順を整える
        swapMobilePackTabAndSelectOrder_();
        return;
      }
      if (tries < 30) requestAnimationFrame(tick);
    };
    tick();
  }

  // ✅ 外部（render側）から呼べる “強制再生成”
  window.rebuildMobilePackTabs = function rebuildMobilePackTabs() {
    buildMobilePackTabs_({ force: true });
  };

    // =====================================================
  // 4.1) pack-section の並び順を補正（コラボを特殊より上に）
  // =====================================================
  function reorderCollabAndSpecialSections_() {
    const root = document.getElementById('packs-root');
    if (!root) return;

    // packs.json の slug/id をそのまま使ってる前提
    const collab  = root.querySelector(`#pack-${CSS.escape('コラボカード')}`);
    const special = root.querySelector(`#pack-${CSS.escape('その他特殊カード')}`);

    if (!collab || !special) return;

    // ✅ いま special が先、collab が後なら入れ替える（collab を special の前へ）
    const collabIsAfter = !!(special.compareDocumentPosition(collab) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (collabIsAfter) {
      root.insertBefore(collab, special);
    }
  }

    // =====================================================
  // 4.5) SP：パックタブとセレクション（select）の表示順を入れ替える
  // =====================================================
  function swapMobilePackTabAndSelectOrder_() {
    const tabs = document.getElementById('mobile-pack-tabs');
    if (!tabs) return;

    // セレクション（select）候補：あなたのHTMLに合わせて拾えるように複数対応
    const sel =
      document.getElementById('pack-select') ||
      document.getElementById('packSelect') ||
      document.getElementById('mobile-pack-select') ||
      document.querySelector('.pack-select') ||
      document.querySelector('#checker select');

    if (!sel) return;

    const parent = tabs.parentElement;
    if (!parent || sel.parentElement !== parent) return;

    // ---- ここで「どっちを上にするか」を決める ----
    const ORDER = 'tabs-first'; // 'tabs-first' or 'select-first'

    if (ORDER === 'tabs-first') {
      // ✅ タブ → セレクション の順にする
      if (parent.firstElementChild !== tabs) parent.insertBefore(tabs, parent.firstChild);
      parent.insertBefore(sel, tabs.nextSibling); // tabsの直後へ
    } else {
      // ✅ セレクション → タブ の順にする
      parent.insertBefore(sel, parent.firstChild);
      parent.insertBefore(tabs, sel.nextSibling); // selの直後へ
    }
  }


function initMobilePackUi_(){
  // ✅ まず pack-section を入れ替える（＝タブの元になる順番を直す）
  reorderCollabAndSpecialSections_();

  // ✅ 次にタブ生成（sectionsの順で作られるので、タブも入れ替わる）
  initMobileTabsWithRetry_();
}

window.addEventListener('card-page:ready', initMobilePackUi_);
window.addEventListener('DOMContentLoaded', initMobilePackUi_);

  // =====================================================
  // 5) スクロールスパイ：表示中パックに合わせてタブを強調
  // =====================================================

  function setActivePackTab_(packSlug) {
    const tabsRoot = document.getElementById('mobile-pack-tabs');
    if (!tabsRoot) return;

    const btns = Array.from(tabsRoot.querySelectorAll('button'));
    btns.forEach(b => b.classList.toggle('is-active', !!packSlug && b.dataset.pack === packSlug));

    // アクティブを中央寄せ（横スクロール追従）
    const active = tabsRoot.querySelector('button.is-active');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

    function findActivePackSlugByScroll_() {
    const sections = Array.from(document.querySelectorAll('#packs-root .pack-section[id^="pack-"]'));
    if (!sections.length) return '';

    const offset = getStickyOffset_();
    const anchorY = offset + 12; // stickyヘッダ直下基準

    // 「ヘッダ直下を過ぎた最後のセクション」を採用（自然な追従）
    let active = sections[0];
    for (const sec of sections) {
      const top = sec.getBoundingClientRect().top;
      if (top <= anchorY) active = sec;
      else break;
    }
    return active ? active.id.replace(/^pack-/, '') : '';
  }

  function scheduleSpySync_() {
    if (spyRaf_) return;
    spyRaf_ = requestAnimationFrame(() => {
      spyRaf_ = 0;
      if (Date.now() < suppressSpyUntil_) return;

      const slug = findActivePackSlugByScroll_();
      if (!slug) return;

      if (slug !== lastActiveSlug_) {
        lastActiveSlug_ = slug;
        setActivePackTab_(slug);
      }
    });
  }

  function startPackScrollSpy_() {
    if (packSpyStarted_) return;
    packSpyStarted_ = true;

    const sections = Array.from(document.querySelectorAll('#packs-root .pack-section[id^="pack-"]'));
    if (!sections.length) return;

    // ✅ 追加：開始直後に確定させる
    setTimeout(() => { try { scheduleSpySync_(); } catch (_) {} }, 0);

    window.addEventListener('scroll', scheduleSpySync_, { passive: true });
    window.addEventListener('resize', scheduleSpySync_);

    const io = new IntersectionObserver(() => {
      scheduleSpySync_();
    }, {
      root: null,
      rootMargin: `-${getStickyOffset_()}px 0px -70% 0px`,
      threshold: [0, 0.1, 0.2],
    });

    sections.forEach(sec => io.observe(sec));
    packSpyObserver_ = io;
    sections.forEach(sec => io.observe(sec));
    packSpyObserver_ = io;
  }


  // =====================================================
  // 6) ゲージ同期（SP: 全カードはトップ / 各パックは見出し下、PC: サイドバーにゲージ）
  // =====================================================

function getOverallFromSummary_() {
  const last = window.Summary?._lastOverall;
  if (!last) return null;

  const ownPct  = Number(last.typePercent);
  const compPct = Number(last.percent);
  if (!Number.isFinite(ownPct) || !Number.isFinite(compPct)) return null;

  return {
    ownPct, compPct,
    ownN: Number(last.ownedTypes),
    ownD: Number(last.totalTypes),
    compN: Number(last.owned),
    compD: Number(last.total),
    ownPctText: String(last.typePercentText ?? ownPct.toFixed(1)),
    compPctText: String(last.percentText ?? compPct.toFixed(1)),
  };
}


  function parseRateText_(text) {
    const t = String(text || '');
    const own  = t.match(/所持率:\s*(\d+)\s*\/\s*(\d+)\s*\(([\d.]+)%\)/);
    const comp = t.match(/コンプ率:\s*(\d+)\s*\/\s*(\d+)\s*\(([\d.]+)%\)/);

    const ownPct = own ? Number(own[3]) : 0;
    const compPct = comp ? Number(comp[3]) : 0;

    return {
      ownPct, compPct,
      ownN: own ? Number(own[1]) : 0,
      ownD: own ? Number(own[2]) : 0,
      compN: comp ? Number(comp[1]) : 0,
      compD: comp ? Number(comp[2]) : 0,
      ownPctText: (ownPct || 0).toFixed(1),
      compPctText: (compPct || 0).toFixed(1),
    };
  }

  function renderMetersHtml_(d) {
    const ownW  = Math.max(0, Math.min(100, Number(d.ownPct || 0)));
    const compW = Math.max(0, Math.min(100, Number(d.compPct || 0)));

    const ownPctText  = d.ownPctText  ?? ownW.toFixed(1);
    const compPctText = d.compPctText ?? compW.toFixed(1);

    return `
      <div class="meter">
        <div class="meter-label">所持率</div>
        <div class="meter-track">
          <span class="meter-bar -own" style="width:${ownW}%;"></span>
        </div>
        <div class="meter-val">
          <span class="meter-frac">${d.ownN ?? 0}/${d.ownD ?? 0}</span>
          <span class="meter-pct">(${ownPctText}%)</span>
        </div>
      </div>

      <div class="meter">
        <div class="meter-label">コンプ率</div>
        <div class="meter-track">
          <span class="meter-bar -comp" style="width:${compW}%;"></span>
        </div>
        <div class="meter-val">
          <span class="meter-frac">${d.compN ?? 0}/${d.compD ?? 0}</span>
          <span class="meter-pct">(${compPctText}%)</span>
        </div>
      </div>
    `;
  }


  function ensureSidebarMeter_(hostEl) {
    if (!hostEl) return null;
    let box = hostEl.querySelector('.summary-meter');
    if (!box) {
      box = document.createElement('div');
      box.className = 'summary-meter';
      hostEl.appendChild(box);
    }
    return box;
  }

  function ensurePackTitleMeters_() {
    const sections = Array.from(document.querySelectorAll('#packs-root .pack-section[id^="pack-"]'));
    sections.forEach(sec => {
      if (sec.querySelector('.pack-mobile-meters')) return;

      const h3 = sec.querySelector('h3');
      if (!h3) return;

      const box = document.createElement('div');
      box.className = 'pack-mobile-meters';
      box.dataset.pack = sec.id.replace(/^pack-/, '');

      h3.insertAdjacentElement('afterend', box);
    });
  }

  function syncAllMeters_() {
    ensurePackTitleMeters_();

    // ✅ 全カード%：Summaryの計算結果から取る（#summary依存を廃止）
    let overall = getOverallFromSummary_();

    // ✅ フォールバック：#summary が存在する時だけ読む（消してたら0固定になるので注意）
    if (!overall) {
      const summaryBlock = document.getElementById('summary');
      if (summaryBlock) {
        const summaryRate = summaryBlock.querySelector('.summary-rate')?.textContent || '';
        const s = parseRateText_(summaryRate);
        overall = { ownPct: s.ownPct, compPct: s.compPct };
      }
    }

    // ---- トップ：全カードゲージ ----
    const mobileTop = document.getElementById('mobile-pack-summary');
    if (mobileTop) {
      mobileTop.innerHTML = overall
        ? `<div class="pack-meters">${renderMetersHtml_(overall)}</div>`
        : '';
    }

    // ---- 各パック：#pack-summary-list を元に反映 ----
    const packList = document.getElementById('pack-summary-list');
    if (!packList) return;

    const items = Array.from(packList.querySelectorAll('.pack-summary'));
    items.forEach(item => {
      const href = item.querySelector('a.pack-summary-link')?.getAttribute('href') || '';
      if (!href.startsWith('#pack-')) return;

      // ✅ 日本語slugでもOK（正規表現で落ちる問題を回避）
      const slug = href.slice('#pack-'.length);

      // ✅ pack-summary-rate 廃止：data-* から読む
      const ownPct = Number(item.dataset.typePercent || 0);
      const compPct = Number(item.dataset.percent || 0);

      const p = {
        ownPct,
        compPct,
        ownN: Number(item.dataset.ownedTypes || 0),
        ownD: Number(item.dataset.totalTypes || 0),
        compN: Number(item.dataset.owned || 0),
        compD: Number(item.dataset.total || 0),
      };

      const meter = ensureSidebarMeter_(item);
      if (meter) meter.innerHTML = renderMetersHtml_(p);

      const targetBox = document.querySelector(`#pack-${CSS.escape(slug)} .pack-mobile-meters`);
      if (targetBox) targetBox.innerHTML = renderMetersHtml_(p);
    });
  }

  window.__syncCheckerMeters = function __syncCheckerMeters(){
    try { syncAllMeters_(); } catch (_) {}
  };

  // ✅ summary更新後：pack-summary が作り直されるので、その後に必ず差し込む
  window.addEventListener('summary:updated', () => {
    requestAnimationFrame(() => {
      window.__syncCheckerMeters();
      // もう1回（作り直しのタイミングずれ保険）
      setTimeout(window.__syncCheckerMeters, 0);
    });
  });

  // =====================================================
  // 7) Card tooltip（hover / focus / long-press）
  // =====================================================

  function ensureTooltipEl_() {
    let el = document.getElementById('card-name-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'card-name-tooltip';
      el.setAttribute('role', 'tooltip');
      document.body.appendChild(el);
    }
    return el;
  }

  function clamp_(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function showTooltip_(text, x, y) {
    const el = ensureTooltipEl_();
    el.textContent = String(text || '').trim();
    if (!el.textContent) return;

    el.classList.add('is-show');

    // いったん表示してサイズ確定
    const pad = 12;
    const w = el.offsetWidth || 160;
    const h = el.offsetHeight || 28;

    const left = clamp_(x - w / 2, pad, window.innerWidth - w - pad);
    // ✅ 下に出す（足りなければ上に逃がす）
    const gap = 14;

    // まず「下」に置く
    let top = y + gap;

    // 画面下にはみ出すなら「上」に切替
    if (top + h + pad > window.innerHeight) {
      top = y - h - gap;
    }

// それでもはみ出すケースを最後にクランプ
top = clamp_(top, pad, window.innerHeight - h - pad);

    el.style.left = `${Math.round(left)}px`;
    el.style.top  = `${Math.round(top)}px`;
  }

  function hideTooltip_() {
    const el = document.getElementById('card-name-tooltip');
    if (!el) return;
    el.classList.remove('is-show');
  }

  function findCardElFromEvent_(ev) {
    const root = document.getElementById('packs-root');
    if (!root) return null;
    const t = ev.target;
    if (!t || !t.closest) return null;
    const card = t.closest('#packs-root .card[data-name]');
    return card && root.contains(card) ? card : null;
  }

  function getCardName_(cardEl) {
    return cardEl?.dataset?.name || cardEl?.getAttribute?.('data-name') || '';
  }

  // ---- Desktop: hover / move ----
  document.addEventListener('mouseover', (e) => {
    const card = findCardElFromEvent_(e);
    if (!card) return;
    const name = getCardName_(card);
    if (!name) return;
    // マウス位置基準
    showTooltip_(name, e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', (e) => {
    const card = findCardElFromEvent_(e);
    if (!card) return;
    const name = getCardName_(card);
    if (!name) return;
    showTooltip_(name, e.clientX, e.clientY);
  });

  document.addEventListener('mouseout', (e) => {
    // packs-root 外へ出た / カードから外れた
    const leavingCard = e.target?.closest?.('#packs-root .card');
    if (!leavingCard) return;
    const to = e.relatedTarget;
    if (to && to.closest && to.closest('#packs-root .card') === leavingCard) return;
    hideTooltip_();
  });

  // ---- Keyboard: focus ----
  // ※ card が tabindex を持ってない場合があるので「mouseenter時に付与」もしておく
  document.addEventListener('mouseenter', (e) => {
    const card = findCardElFromEvent_(e);
    if (!card) return;
    if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '0');
  }, true);

  document.addEventListener('focusin', (e) => {
    const card = e.target?.closest?.('#packs-root .card[data-name]');
    if (!card) return;
    const name = getCardName_(card);
    if (!name) return;
    const r = card.getBoundingClientRect();
    showTooltip_(name, r.left + r.width / 2, r.top);
  });

  document.addEventListener('focusout', (e) => {
    const card = e.target?.closest?.('#packs-root .card');
    if (!card) return;
    hideTooltip_();
  });

  // ---- Mobile: long-press ----
  let lpTimer_ = 0;
  let lpActive_ = false;

  document.addEventListener('touchstart', (e) => {
    const card = findCardElFromEvent_(e);
    if (!card) return;

    const name = getCardName_(card);
    if (!name) return;

    const touch = e.touches && e.touches[0];
    if (!touch) return;

    lpActive_ = false;
    if (lpTimer_) clearTimeout(lpTimer_);

    lpTimer_ = window.setTimeout(() => {
      lpActive_ = true;
      // 指位置基準（指で隠れるので少し上に）
      showTooltip_(name, touch.clientX, touch.clientY + 6);
    }, 450);
  }, { passive: true });

  const cancelLongPress_ = () => {
    if (lpTimer_) { clearTimeout(lpTimer_); lpTimer_ = 0; }
    if (lpActive_) hideTooltip_();
    lpActive_ = false;
  };

  document.addEventListener('touchmove', cancelLongPress_, { passive: true });
  document.addEventListener('touchend', cancelLongPress_, { passive: true });
  document.addEventListener('touchcancel', cancelLongPress_, { passive: true });

  // クリック/スクロールでも閉じる
  window.addEventListener('scroll', hideTooltip_, { passive: true });
  window.addEventListener('resize', hideTooltip_);
})();

