/* =========================
 * js/pages/deckmaker/deck-shortage-ui.js
 * - 不足カード（未所持）UI：サマリ行＋折りたたみリスト＋画像プレビュー
 * - 交換必要量計算（computeExchangeNeeds 等）も同居（deckmaker専用）
 *
 * 【役割】
 * - computeExchangeNeeds(): デッキ×所持から不足・交換量を計算
 * - 不足カードUI（サマリ行＋折りたたみリスト）を描画
 * - 所持データが無ければ #owned-info を非表示
 * - クリック/Enter/Spaceでカード画像プレビュー（CardPreview互換API利用）
 *
 * 【依存（存在すれば使う）】
 * - window.deck
 * - window.cardMap / window.allCardsMap
 * - window.OwnedStore.onChange(fn) / window.OwnedStore.getAll()
 * - window.showCardPreviewAt(x,y,cd) / window.hideCardPreview()
 * - window.toggleOwned / window.updateExchangeSummary / window.goToAnalyzeTab（あればフック）
 * ========================= */
(function () {
  'use strict';

  // =====================================================
  // 0) 共通: cardMap / owned
  // =====================================================
  function getCardMap() {
    return window.cardMap || window.allCardsMap || {};
  }

  function getOwnedAll(){
    // OwnedStore優先 → localStorage fallback
    if (window.OwnedStore?.getAll){
      try { return window.OwnedStore.getAll() || {}; } catch(_) {}
    }
    try {
      return JSON.parse(localStorage.getItem('ownedCards') || '{}') || {};
    } catch {
      return {};
    }
  }

  // =====================================================
  // 1) 交換・不足 計算（deckmaker専用）
  // =====================================================
  // page2が残ってる間の保険：既にあるなら上書きしない
  const HAS_CALC = (typeof window.computeExchangeNeeds === 'function');

  const EXCHANGE_RATE = {
    LEGEND: { diamond: 4000, point: 300, sand: 300 },
    GOLD:   { diamond: 1000, point: 150, sand: 150 },
    SILVER: { diamond: 250,  point: 20,  sand: 20  },
    BRONZE: { diamond: 150,  point: 10,  sand: 10  }
  };

  function rarityToKeyJP(rarity){
    const s = String(rarity || '');
    if (s.includes('レジェ') || s === 'LEGEND') return 'LEGEND';
    if (s.includes('ゴールド') || s === 'GOLD') return 'GOLD';
    if (s.includes('シルバー') || s === 'SILVER') return 'SILVER';
    if (s.includes('ブロンズ') || s === 'BRONZE') return 'BRONZE';
    return null;
  }
  window.rarityToKeyJP ??= rarityToKeyJP;

  function computeExchangeNeedsImpl(){
    const deck = window.deck || {};
    const map = getCardMap();
    const ownedAll = getOwnedAll();

    function ownedCountOf(cd){
      const v = ownedAll[String(cd)];
      if (!v) return 0;
      if (typeof v === 'number') return (v | 0);
      if (typeof v === 'object'){
        return ((v.normal|0) + (v.shine|0) + (v.premium|0));
      }
      return 0;
    }

    const shortages = [];
    let pointTotal = 0;
    let diamondTotal = 0;
    const sand = { LEGEND:0, GOLD:0, SILVER:0, BRONZE:0 };
    const packPoint = {}; // { packId: {point, diamond, packId} }

    for (const [cdRaw, needRaw] of Object.entries(deck)){
        const cd = String(cdRaw);
        const need = (needRaw | 0);
        if (need <= 0) continue;

        const own = ownedCountOf(cd);
        const shortage = need - own;
        if (shortage <= 0) continue;

        const info = map[cd] || {};
        const rarityKey = rarityToKeyJP(info.rarity);
        if (!rarityKey) continue;

        const rate = EXCHANGE_RATE[rarityKey];
        if (!rate) continue;

        const p = shortage * (rate.point|0);
        const d = shortage * (rate.diamond|0);

        pointTotal += p;
        diamondTotal += d;
        sand[rarityKey] += shortage * (rate.sand|0);

        // パック別（ポイントのみ）
        const packNameRaw = info.packName ?? info.pack_name ?? '';
        const packEn = window.getPackEnName
        ? window.getPackEnName(packNameRaw, '') // 空は集計から除外したいので fallback=''
        : String(packNameRaw || '').split('「')[0].trim();

        if (packEn) {
        packPoint[packEn] ??= { point: 0, diamond: 0, packId: packEn };
        packPoint[packEn].point += p;
        packPoint[packEn].diamond += d;
        }

        shortages.push({
            cd,
            name: info.name || cd,
            shortage
        });
    }

    return { shortages, pointTotal, diamondTotal, sand, packPoint };
  }

  if (!HAS_CALC) {
    window.computeExchangeNeeds = computeExchangeNeedsImpl;
  }


/* ============= packs.json 読み込み（順序ラベル） ============= */
let __PACK_ORDER = null;
let __PACK_LABELS = {};

async function ensurePacksLoaded() {
    if (__PACK_ORDER) return;

    // 1) card-core の packs catalog を最優先（= ./public/packs.json を正とする）
    try {
        const cat = await window.loadPackCatalog?.();
        if (cat && Array.isArray(cat.order)) {
        __PACK_ORDER = cat.order.slice();
        __PACK_LABELS = {};
        if (Array.isArray(cat.list)) {
            cat.list.forEach(p => {
            if (p?.en) __PACK_LABELS[p.en] = p.en; // ここは今まで通り EN 表示（必要なら jp 表示に変更可）
            });
        }
        return;
        }
    } catch (e) {
        // 下の直接fetchへフォールバック
    }

    // 2) フォールバック：直接 packs.json を読む（最終手段）
    try {
        const res = await fetch('./public/packs.json', { cache: 'no-store' });
        if (res.ok) {
        const data = await res.json();
        __PACK_ORDER = Array.isArray(data.order) ? data.order.slice() : [];
        __PACK_LABELS = {};
        if (Array.isArray(data.packs)) {
            data.packs.forEach(p => {
            if (p?.en) __PACK_LABELS[p.en] = p.en;
            });
        }
        return;
        }
    } catch (e) {
        // noop
    }

    console.warn('packs.json を読み込めませんでした。アルファベット順で表示します。');
    __PACK_ORDER = [];
    __PACK_LABELS = {};
}

function getPackLabel(en) {
    return __PACK_LABELS[en] || en || 'その他カード';
}

/* ==== 未所持カード画像プレビュー共通層 ==== */
function ensureCardPreviewLayer() {
    if (document.getElementById('card-preview-pop')) return;
    const el = document.createElement('div');
    el.id = 'card-preview-pop';
    el.style.position = 'fixed';
    el.style.display = 'none';
    el.style.zIndex = 3000;
    el.innerHTML = `<img style="max-width:200px;border-radius:6px;box-shadow:0 0 8px rgba(0,0,0,.5);" />`;
    document.body.appendChild(el);
}
function showCardPreviewAt(x, y, cd) {
    ensureCardPreviewLayer();
    const box = document.getElementById('card-preview-pop');
    const img = box.querySelector('img');
    const src = `img/${String(cd).slice(0,5)}.webp`;
    img.onload = null;
    img.onerror = () => { img.onerror = null; img.src = 'img/00000.webp'; };
    img.src = src;
    const PAD = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    const W  = 200, H = 280;
    let left = x + PAD, top = y + PAD;
    if (left + W > vw) left = Math.max(PAD, x - W - PAD);
    if (top + H > vh) top = Math.max(PAD, vh - H - PAD);
    box.style.left = `${left}px`;
    box.style.top  = `${top}px`;
    box.style.display = 'block';
}
function hideCardPreview() {
    const box = document.getElementById('card-preview-pop');
    if (box) box.style.display = 'none';
}
// show/hide preview 関数をグローバルに登録（未定義時のみ）
window.showCardPreviewAt ??= showCardPreviewAt;
window.hideCardPreview ??= hideCardPreview;

// 交換サマリ（本体：page2 依存を外す）
window.updateExchangeSummary =
async function updateExchangeSummary(){
await ensurePacksLoaded();

    const els = {
        point:    document.getElementById('point-cost'),
        diamond:  document.getElementById('diamond-cost'),
        sandLeg:  document.getElementById('sand-leg'),
        sandGld:  document.getElementById('sand-gld'),
        sandSil:  document.getElementById('sand-sil'),
        sandBro:  document.getElementById('sand-bro'),
    };

    // 旧UIが無い画面（要素が無い）でも落とさない
    const hasAny =
        els.point || els.diamond || els.sandLeg || els.sandGld || els.sandSil || els.sandBro;

    const r = window.computeExchangeNeeds?.();
    if (!r) return;

    if (hasAny){
        if (els.point)   els.point.textContent   = String(r.pointTotal|0);
        if (els.diamond) els.diamond.textContent = String(r.diamondTotal|0);
        if (els.sandLeg) els.sandLeg.textContent = String(r.sand?.LEGEND|0);
        if (els.sandGld) els.sandGld.textContent = String(r.sand?.GOLD|0);
        if (els.sandSil) els.sandSil.textContent = String(r.sand?.SILVER|0);
        if (els.sandBro) els.sandBro.textContent = String(r.sand?.BRONZE|0);

        // パック別（ポイントのみ）
        tryRenderPointByPack?.(r.packPoint);
    }

    // コンパクト行があるなら同期（point/diamond の現在モード維持）
    if (document.getElementById('exchange-values-compact')) {
        window.setExchangeCompact?.({
        point: r.pointTotal,
        diamond: r.diamondTotal,
        sand: r.sand,
        packPoint: r.packPoint
        });
    }

    // もし簡易サマリ枠があるならついでに更新（任意）
    const summary = document.getElementById('exchange-summary');
    if (summary){
        summary.textContent = `不足交換：ポイント ${r.pointTotal|0} / ダイヤ ${r.diamondTotal|0}`;
    }
    };

/* ---------- パック別ポイントの描画（ポイントのみ） ---------- */
function renderPointByPack(dict) {
    const box = document.getElementById('point-by-pack');
    if (!box) return;
    // dict が空 or すべて 0 なら非表示
    const keys = Object.keys(dict || {}).filter(k => {
        const val = dict[k];
        return typeof val === 'object' ? (val.point | 0) > 0 : (val | 0) > 0;
    });
    if (!keys.length) {
        box.innerHTML = '';
        box.style.display = 'none';
        return;
    }
    // 1) packs.json の order にあるもの（存在する分だけ）
    const orderedInDict = Array.isArray(__PACK_ORDER)
        ? __PACK_ORDER.filter(en => {
            const val = dict[en];
            return typeof val === 'object' ? (val.point | 0) > 0 : (val | 0) > 0;
        })
        : [];
    // 2) 順序にないが dict に存在するもの（アルファベット順）
    const extras = keys.filter(en => !orderedInDict.includes(en))
                        .sort((a,b) => a.localeCompare(b));
    const finalOrder = [...orderedInDict, ...extras];
    const html = [];
    for (const en of finalOrder) {
        const val = dict[en];
        const num = typeof val === 'object' ? (val.point | 0) : (val | 0);
        if (!num) continue;
        html.push(`<li>${getPackLabel(en)}：<strong>${num}ポイント</strong></li>`);
    }
    box.innerHTML = `<ul class="by-pack-list-ul">${html.join('')}</ul>`;
    box.style.display = '';
}

// 最新の packPoint を保持し、ポイントモード以外では非表示にする
let __latestPackPoint = null;
function tryRenderPointByPack(dict) {
    if (dict) __latestPackPoint = dict;
    const box = document.getElementById('point-by-pack');
    if (!box || !__latestPackPoint) return;
    renderPointByPack(__latestPackPoint);
    if (__exchangeModeCompact !== 'point') {
        box.style.display = 'none';
    }
}

/* ---------- コンパクト行のトグル（ポイント／ダイヤ／砂） ---------- */
let __exchangeModeCompact = 'point'; // 'point'|'diamond'|'sand'
function setExchangeCompact(values) {
    const wrap = document.getElementById('exchange-values-compact');
    const btn  = document.getElementById('exchange-toggle-btn-compact');
    const packBox = document.getElementById('point-by-pack');
    // パック内訳はポイントモードのみ表示
    if (packBox) {
        packBox.style.display = (__exchangeModeCompact === 'point') ? '' : 'none';
    }
    if (!wrap || !btn) return;
    const { point, diamond, sand, packPoint } = values;
    if (__exchangeModeCompact === 'point') {
        // 合計はラベルのみ、内訳リストを別領域に描画
        wrap.innerHTML = `🟢 必要ポイント：`;
        tryRenderPointByPack(packPoint);
        if (packBox) packBox.style.display = '';
    } else if (__exchangeModeCompact === 'diamond') {
        wrap.innerHTML = `💎 必要ダイヤ：<strong>${diamond | 0}個</strong>`;
        if (packBox) { packBox.innerHTML = ''; packBox.style.display = 'none'; }
    } else {
        wrap.innerHTML =
        `🪨 必要砂：
            <div class="point-sand">
            <span class="rar-item">🌈レジェンド${sand?.LEGEND | 0}個</span>
            <span class="rar-item">🟡ゴールド${sand?.GOLD | 0}個</span>
            <span class="rar-item">⚪️シルバー${sand?.SILVER | 0}個</span>
            <span class="rar-item">🟤ブロンズ${sand?.BRONZE | 0}個</span>
            </div>`;
        if (packBox) { packBox.innerHTML = ''; packBox.style.display = 'none'; }
    }
    btn.textContent =
        (__exchangeModeCompact === 'point')   ? '🟢 ポイント' :
        (__exchangeModeCompact === 'diamond') ? '💎 ダイヤ'   : '🪨 砂';
}
function toggleExchangeCompact() {
    __exchangeModeCompact =
        (__exchangeModeCompact === 'point')   ? 'diamond' :
        (__exchangeModeCompact === 'diamond') ? 'sand'    : 'point';
    const { pointTotal, diamondTotal, sand, packPoint } = computeExchangeNeeds();
    setExchangeCompact({
        point: pointTotal,
        diamond: diamondTotal,
        sand,
        packPoint
    });
}
// グローバルに公開して fallback 定義を上書き
window.toggleExchangeCompact = toggleExchangeCompact;
window.setExchangeCompact   = setExchangeCompact;

  // コンパクト表示（不足UIの上の1行）
window.setExchangeCompact ??= function setExchangeCompact({ point=0, diamond=0, sand=null } = {}){
    const el = document.getElementById('exchange-compact-line');
    if (!el) return;
    const s = sand || { LEGEND:0, GOLD:0, SILVER:0, BRONZE:0 };
    el.textContent =
        `ポイント ${point|0} / ダイヤ ${diamond|0} / 砂(レ:${s.LEGEND|0}, 金:${s.GOLD|0}, 銀:${s.SILVER|0}, 銅:${s.BRONZE|0})`;
};

  // =====================================================
  // 2) 不足UI
  // =====================================================
  const RARITY_ICON = { LEGEND: '🌈', GOLD: '🟡', SILVER: '⚪️', BRONZE: '🟤' };
  const TYPE_ORDER = { 'チャージャー': 0, 'アタッカー': 1, 'ブロッカー': 2 };

  function rarityToKeySafe(r) {
    if (typeof window.rarityToKeyJP === 'function') return window.rarityToKeyJP(r);
    const s = String(r || '');
    if (s.includes('レジェ') || s === 'LEGEND') return 'LEGEND';
    if (s.includes('ゴールド') || s === 'GOLD') return 'GOLD';
    if (s.includes('シルバー') || s === 'SILVER') return 'SILVER';
    if (s.includes('ブロンズ') || s === 'BRONZE') return 'BRONZE';
    return null;
  }

  function groupShortageByRarity(shortages) {
    const sum = { LEGEND: 0, GOLD: 0, SILVER: 0, BRONZE: 0 };
    if (!Array.isArray(shortages)) return sum;

    const map = getCardMap();
    for (const s of shortages) {
      const cd = String(s?.cd || '');
      const info = map[cd] || {};
      const key = rarityToKeySafe(info.rarity);
      if (!key) continue;
      sum[key] += (s.shortage | 0);
    }
    return sum;
  }
  window.groupShortageByRarity ??= groupShortageByRarity;

function wireShortagePreviewOnce() {
    if (window.__shortagePreviewWired) return;
    window.__shortagePreviewWired = true;

    const list = document.getElementById('shortage-collapsible');
    if (!list) return;

    // ★重要：ここで止めないと document click で即閉じる
    list.addEventListener('click', (e) => {
    const titleEl = e.target.closest?.('.title');
    if (!titleEl) return;

    // ★これが効く：document 側の click ハンドラに届かせない
    e.stopPropagation();

    const item = titleEl.closest('.shortage-item');
    const cd = item?.dataset?.cd;
    if (!cd) return;

    const show = window.showCardPreviewAt;
    if (typeof show !== 'function') return;

    show(e.clientX ?? 0, e.clientY ?? 0, cd);
    });

    list.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;

    const titleEl = e.target.closest?.('.title');
    if (!titleEl) return;

    e.preventDefault();
    e.stopPropagation(); // ★キー操作も念のため止める

    const item = titleEl.closest('.shortage-item');
    const cd = item?.dataset?.cd;
    if (!cd) return;

    const show = window.showCardPreviewAt;
    if (typeof show !== 'function') return;

    const rect = titleEl.getBoundingClientRect();
    show(rect.right, rect.bottom, cd);
    });
}

  function renderShortageCompact(shortages) {
    const line = document.getElementById('shortage-summary-line');
    const list = document.getElementById('shortage-collapsible');
    if (!line || !list) return;

    const map = getCardMap();
    const arr = Array.isArray(shortages) ? shortages : [];
    const sum = window.groupShortageByRarity(arr);

    line.innerHTML = `
      <span class="rar-item">${RARITY_ICON.LEGEND}レジェンド${sum.LEGEND}枚</span>
      <span class="rar-item">${RARITY_ICON.GOLD}ゴールド${sum.GOLD}枚</span>
      <span class="rar-item">${RARITY_ICON.SILVER}シルバー${sum.SILVER}枚</span>
      <span class="rar-item">${RARITY_ICON.BRONZE}ブロンズ${sum.BRONZE}枚</span>
    `;

    list.innerHTML = '';
    if (!arr.length) {
      list.textContent = '不足はありません';
      return;
    }

    const hint = document.createElement('div');
    hint.className = 'shortage-hint';
    hint.textContent = 'タップ/クリックでカード表示';
    list.appendChild(hint);

    const sorted = arr.slice().sort((a, b) => {
      const A = map[String(a.cd)] || {};
      const B = map[String(b.cd)] || {};
      const tA = TYPE_ORDER[A.type] ?? 99;
      const tB = TYPE_ORDER[B.type] ?? 99;
      if (tA !== tB) return tA - tB;

      const cA = (parseInt(A.cost, 10) || 0);
      const cB = (parseInt(B.cost, 10) || 0);
      if (cA !== cB) return cA - cB;

      const pA = (parseInt(A.power, 10) || 0);
      const pB = (parseInt(B.power, 10) || 0);
      if (pA !== pB) return pA - pB;

      return String(a.cd).localeCompare(String(b.cd));
    });

    for (const it of sorted) {
      const cd = String(it.cd || '');
      const info = map[cd] || {};
      const rkey = rarityToKeySafe(info.rarity);
      const icon = rkey ? (RARITY_ICON[rkey] || '') : '';
      const name = String(it.name || info.name || cd);
      const shortage = (it.shortage | 0);

      const row = document.createElement('div');
      row.className = 'shortage-item';
      row.dataset.cd = cd;
      row.innerHTML = `
        <span class="rar">${icon}</span>
        <span class="title" role="button" tabindex="0">${name}</span>
        <span class="need">×${shortage}</span>
      `;
      list.appendChild(row);
    }

    wireShortagePreviewOnce();
  }
  window.renderShortageCompact ??= renderShortageCompact;

  function hasOwnedData() {
    if (window.OwnedStore?.getAll) {
      const all = window.OwnedStore.getAll() || {};
      for (const cd in all) {
        const v = all[cd] || {};
        const total = (v.normal | 0) + (v.shine | 0) + (v.premium | 0);
        if (total > 0) return true;
      }
    }

    try {
      const raw = JSON.parse(localStorage.getItem('ownedCards') || '{}') || {};
      for (const cd in raw) {
        const v = raw[cd];
        if (typeof v === 'object' && v) {
          if ((v.normal | 0) + (v.shine | 0) + (v.premium | 0) > 0) return true;
        } else if ((v | 0) > 0) {
          return true;
        }
      }
    } catch { /* noop */ }

    return false;
  }

  function updateOwnedInfoVisibility() {
    const box = document.getElementById('owned-info');
    if (!box) return;
    box.style.display = hasOwnedData() ? '' : 'none';
  }
  window.updateOwnedInfoVisibility ??= updateOwnedInfoVisibility;

  function renderOwnedInfoCompact() {
    const ownedBox = document.getElementById('owned-info');
    if (!ownedBox) return;

    const calc = window.computeExchangeNeeds;
    if (typeof calc !== 'function') {
      window.renderShortageCompact?.([]);
      return;
    }

    const { pointTotal, diamondTotal, sand, shortages, packPoint } = calc();
    window.renderShortageCompact?.(shortages || []);

    if (typeof window.setExchangeCompact === 'function') {
      window.setExchangeCompact({
        point: pointTotal | 0,
        diamond: diamondTotal | 0,
        sand: sand || { LEGEND: 0, GOLD: 0, SILVER: 0, BRONZE: 0 },
        packPoint: packPoint || {}
      });
    }
  }
  window.renderOwnedInfoCompact ??= renderOwnedInfoCompact;

  function syncAll() {
    try { renderOwnedInfoCompact(); } catch (e) { console.warn(e); }
    try { updateOwnedInfoVisibility(); } catch (e) { console.warn(e); }
  }

  // close preview hooks
  function hidePreviewSafe() {
    if (typeof window.hideCardPreview === 'function') window.hideCardPreview();
  }

  function wireClosePreviewOnce() {
    if (window.__shortagePreviewCloseWired) return;
    window.__shortagePreviewCloseWired = true;

    document.addEventListener('click', (e) => {
      const pop = document.getElementById('card-preview-pop');
      if (!pop) return;
      if (pop.style.display !== 'none' && !e.target.closest('#card-preview-pop')) {
        hidePreviewSafe();
      }
    });

    document.getElementById('shortage-toggle-btn')?.addEventListener('click', hidePreviewSafe);
    document.addEventListener('deckTabSwitched', hidePreviewSafe);
    document.addEventListener('tab:switched', hidePreviewSafe);
  }

  // init + hooks
  function hookOnceGlobal(name, after) {
    const fn = window[name];
    if (typeof fn !== 'function') return;
    if (fn.__deckShortageHooked) return;

    window[name] = function (...args) {
      const r = fn.apply(this, args);
      try { after(); } catch { /* noop */ }
      return r;
    };
    window[name].__deckShortageHooked = true;
  }

  function initDeckShortageUI() {
    if (window.__deckShortageInited) return;
    window.__deckShortageInited = true;

    const tog = document.getElementById('shortage-toggle-btn');
    if (tog && !tog.__bound) {
      tog.__bound = true;
      tog.addEventListener('click', () => {
        const area = document.getElementById('shortage-collapsible');
        if (!area) return;
        const now = area.hasAttribute('hidden');
        if (now) area.removeAttribute('hidden');
        else area.setAttribute('hidden', '');
      });
    }

    // ポイント／ダイヤ／砂切替ボタンのイベント結線
    const excBtn = document.getElementById('exchange-toggle-btn-compact');
    if (excBtn && !excBtn.__bound) {
        excBtn.__bound = true;
        excBtn.addEventListener('click', () => {
            window.toggleExchangeCompact?.();
        });
    }

    wireClosePreviewOnce();

    hookOnceGlobal('toggleOwned', syncAll);
    hookOnceGlobal('updateExchangeSummary', syncAll);
    hookOnceGlobal('goToAnalyzeTab', syncAll);

    if (window.OwnedStore?.onChange) {
      try { window.OwnedStore.onChange(syncAll); } catch { /* noop */ }
    }

    // 初期描画
    syncAll();
  }

  window.initDeckShortageUI ??= initDeckShortageUI;

function boot(){
  try { initDeckShortageUI(); } catch(e){ console.warn(e); }
}

// loader 後読み込み対策：deckmaker-page:ready を優先、無ければ即起動
document.addEventListener('deckmaker-page:ready', boot, { once: true });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
})();