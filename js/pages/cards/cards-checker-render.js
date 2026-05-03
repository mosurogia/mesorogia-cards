/**
 * js/pages/cards/cards-checker-render.js
 * - 所持率チェッカー：パック/種族ごとのカードDOM生成（#packs-root）
 * - 不足カードリスト（全体/パック別）生成＆モーダル表示
 * - パック/種族の一括操作（+1 / +3 / 全解除）
 * - 初期化：packs確定 → renderAllPacks → OwnedUI同期 → summary更新
 *
 * 依存（読み込み順）:
 * - common/defs.js（RACE_ORDER_all など）
 * - common/card-core.js（loadPackCatalog, splitPackName, makePackSlug など）
 * - common/owned.js（OwnedStore / OwnedUI）
 * - common/summary.js（updateSummary / calcSummary 等）
 * - pages/cards/cards-checker-owned-ops.js（toggleOwnership / bumpOwnership 等）
 */

// =====================================================
// 0) 依存関数のフォールバック（読み込み順が崩れても落ちない）
// =====================================================
const splitPackName_ = window.splitPackName || function(s){
  const m = String(s || '').match(/^([^「]+)(?:「([^」]*)」)?/);
  return { en: (m?.[1] || '').trim(), jp: (m?.[2] || '').trim() };
};

const makePackSlug_ = window.makePackSlug || function(en){
  return String(en || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '');
};

async function fetchCheckerCards_(jsonUrl) {
  if (Array.isArray(window.__cardsCache) && window.__cardsCache.length) {
    return window.__cardsCache;
  }

  if (typeof window.fetchLatestCards === 'function') {
    try {
      const cards = await window.fetchLatestCards();
      if (Array.isArray(cards) && cards.length) return cards;
    } catch (e) {
      console.warn('[checker] fetchLatestCards failed', e);
    }
  }

  let lastError = null;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(jsonUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cards = await res.json();
      if (Array.isArray(cards)) return cards;
    } catch (e) {
      lastError = e;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  throw lastError || new Error('cards json load failed');
}

// =====================================================
// 1) 定数・ユーティリティ
// =====================================================

// 種族表示順
const RACE_ORDER = window.RACE_ORDER_all.slice();

// 種族名 → slug
const RACE_SLUG = {
  'ドラゴン':'dragon',
  'アンドロイド':'android',
  'エレメンタル':'elemental',
  'ルミナス':'luminous',
  'シェイド':'shade',
  'イノセント':'innocent',
  '旧神':'oldgod',
};

// レアリティ → class slug
const RARITY_CLASS = {
  'レジェンド': 'legend',
  'ゴールド':   'gold',
  'シルバー':   'silver',
  'ブロンズ':   'bronze',
};

// タイプ順（種族内の並びで使用）
const TYPE_ORDER = { 'チャージャー': 0, 'アタッカー': 1, 'ブロッカー': 2 };

// HTMLエスケープ（属性崩れ防止）
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const normCd5_ = (v) => {
  if (window.normCd5) return window.normCd5(v);
  const s = String(v ?? '').trim();
  return s ? s.padStart(5, '0').slice(-5) : '';
};

const viewCategory = (s) => String(s ?? '').replace(/\s*[（(][^（）()]*[）)]\s*$/g, '');

// レアリティclassを作る
function rarityClassOf(rarity) {
  const slug = RARITY_CLASS[rarity] || String(rarity).toLowerCase();
  return `rarity-${slug}`;
}

// 種族内：タイプ → コスト → パワー → cd
function typeCostPowerCd(a, b) {
  const ta = TYPE_ORDER[a.type] ?? 999;
  const tb = TYPE_ORDER[b.type] ?? 999;
  if (ta !== tb) return ta - tb;

  const ca = Number.isFinite(a.cost) ? a.cost : Number.MAX_SAFE_INTEGER;
  const cb = Number.isFinite(b.cost) ? b.cost : Number.MAX_SAFE_INTEGER;
  if (ca !== cb) return ca - cb;

  const pa = Number.isFinite(a.power) ? a.power : Number.MAX_SAFE_INTEGER;
  const pb = Number.isFinite(b.power) ? b.power : Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;

  const cda = Number.isFinite(+a.cd) ? +a.cd : Number.MAX_SAFE_INTEGER;
  const cdb = Number.isFinite(+b.cd) ? +b.cd : Number.MAX_SAFE_INTEGER;
  return cda - cdb;
}


// =====================================================
// 2) チェッカーDOM生成（パック→種族→カード）
// =====================================================

function detectPackGroup_(packEn, packJp, packKey, idx){
  const any = `${packEn||''} ${packJp||''} ${packKey||''}`.toLowerCase();
  const letters = 'abcdefghijklmnopqrstuvwxyz';

  if (any.includes('特殊') || any.includes('special')) return 'special';
  if (any.includes('コラボ') || any.includes('collab')) return 'collab';

  return letters[idx] || 'z';
}

// パック1つ分のHTMLを組み立てる
function buildCheckerCardHTML(c, { summarySkip = false } = {}){
  const rarityCls = rarityClassOf(c.rarity);
  const skipAttr = summarySkip ? ' data-summary-skip="1"' : '';

  return `<div class="card ${rarityCls}" data-name="${esc(c.name)}" data-cd="${esc(c.cd)}"${skipAttr}
data-pack="${esc(c.pack_name)}" data-race="${esc(c.race)}" data-category="${esc(c.category)}"
data-rarity="${esc(c.rarity)}" data-type="${esc(c.type)}" onclick="toggleOwnership(this)">
<img
  alt="${esc(c.name)}"
  loading="lazy"
  decoding="async"
  width="424"
  height="532"
  src="img/${esc(c.cd)}.webp"
  onerror="if(!this.dataset.fallback){this.dataset.fallback=1;this.src='img/00000.webp';}"
/>
<button type="button" class="zoom-btn checker-detail-zoom-btn" aria-label="カード詳細を開く">🔍</button>
<div class="owned-mark"></div>
</div>`;
}

function buildPackSectionHTML(packEn, packJp, cardsGroupedByRace, packKey, packGroup){

  const packSlug = (packKey != null && String(packKey).trim() !== '')
    ? String(packKey)
    : makePackSlug_(packEn);

  let html = '';

  html += `<section id="pack-${packSlug}" class="pack-section" data-packkey="${esc(packKey||'')}" data-packgroup="${esc(packGroup||'')}">`;
  html += `  <h3 class="pack-title pack-title-row">`;
  html += `    <span class="pack-title-text">`;
  html += `      <span class="pack-name-main">${esc(packEn)}</span><br>`;
  html += `      <small class="pack-name-sub">${esc(packJp)}</small>`;
  html += `    </span>`;
  html += `    <a class="pack-tweet-link custom-tweet-button" href="#" target="_blank" rel="noopener">`;
  html += `      <img src="img/x-logo.svg" alt="Post" class="tweet-icon">`;
  html += `      <span>ポスト</span>`;
  html += `    </a>`;
  html += `  </h3>`;

  // パック単位の操作
  html += `  <div class="race-controls pack-controls">`;

  // 左：一括操作
  html += `    <div class="control-group control-group--bulk">`;
  html += `      <button class="pack-select-all-btn">シルバーブロンズ+3</button>`;
  html += `      <button class="pack-clear-all-btn">全て選択解除</button>`;
  html += `    </div>`;

  // 右：表示切替（セグメント）
  html += `    <div class="control-group control-group--view view-toggle">`;
  html += `      <button type="button" class="toggle-pack-view-btn is-active" data-view="all">全カード表示</button>`;
  html += `      <button type="button" class="toggle-pack-view-btn" data-view="incomplete">不足カード表示</button>`;
  html += `    </div>`;

  html += `  </div>`;

  html += `  <div id="card-list-${packSlug}">`;

  for (const race of RACE_ORDER){
    const list = cardsGroupedByRace.get(race) || [];
    if (!list.length) continue;

    const raceSlug = RACE_SLUG[race] || String(race).toLowerCase();

    html += `    <section id="race-${raceSlug}-${packSlug}" class="race-group race-${esc(race)}">`;
    html += `      <h4>${esc(race)}</h4>`;
    html += `      <div class="race-controls">`;
    html += `        <button class="select-all-btn">全て選択+1</button>`;
    html += `        <button class="clear-all-btn">全て選択解除</button>`;
    html += `      </div>`;

    html += `      <div class="card-list">`;

    for (const c of list){
      const rarityCls = rarityClassOf(c.rarity);

      html += `<div class="card ${rarityCls}" data-name="${esc(c.name)}" data-cd="${esc(c.cd)}"`;
      html += `data-pack="${esc(c.pack_name)}" data-race="${esc(c.race)}" data-category="${esc(c.category)}"`;
      html += `data-rarity="${esc(c.rarity)}" data-type="${esc(c.type)}" onclick="toggleOwnership(this)">`;

      html += `<img
                alt="${esc(c.name)}"
                loading="lazy"
                decoding="async"
                width="424"
                height="532"
                src="img/${esc(c.cd)}.webp"
                onerror="if(!this.dataset.fallback){this.dataset.fallback=1;this.src='img/00000.webp';}"
              />`;
      html += `          <button type="button" class="zoom-btn checker-detail-zoom-btn" aria-label="カード詳細を開く">🔎</button>`;

      html += `          <div class="owned-mark"></div>`;
      html += `        </div>`;
    }

    html += `      </div>`;
    html += `    </section>`;
  }

  html += `  </div>`;
  html += `</section>`;
  return html;
}

function buildOverallGridSectionHTML(cards){
  const pageSize = 16;
  const sorted = Array.from(cards || []).sort(typeCostPowerCd);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  let html = '';

  html += `<section id="checker-overall-4x4" class="pack-section checker-overall-section" hidden>`;
  html += `  <h3 class="pack-title pack-title-row">`;
  html += `    <span class="pack-title-text">ゲーム表示</span>`;
  html += `  </h3>`;
  html += `  <div class="checker-overall-note">`;
  html += `    <div class="checker-note-sub">● アプリのカード一覧とほとんど同じ表示です</div>`;
  html += `    <div class="checker-note-sub">※アプリ本体のフィルターでシグネチャーと「なし」にしてエディションも「ノーマル」にしてください</div>`;
  html += `    <div class="checker-note-sub">（シャインやプレミアムのカードは別で登録するのがおすすめです）</div>`;
  html += `  </div>`;

  html += `  <div class="checker-overall-pages" data-current-page="0" data-total-pages="${totalPages}">`;

  for (let page = 0; page < totalPages; page++) {
    const slice = sorted.slice(page * pageSize, page * pageSize + pageSize);
    html += `    <div class="checker-overall-page card-list" data-page="${page}"${page === 0 ? '' : ' hidden'}>`;
    slice.forEach(card => {
      html += buildCheckerCardHTML(card, { summarySkip: true });
    });
    html += `    </div>`;
  }

  html += `  </div>`;
  html += `  <div class="checker-overall-pager" aria-label="ゲーム表示のページ切り替え">`;
  html += `    <button type="button" class="checker-overall-page-btn" data-dir="-1" disabled>← 前へ</button>`;
  html += `    <span class="checker-overall-page-info" aria-live="polite">1 / ${totalPages}</span>`;
  html += `    <button type="button" class="checker-overall-page-btn" data-dir="1"${totalPages <= 1 ? ' disabled' : ''}>次へ →</button>`;
  html += `  </div>`;
  html += `</section>`;
  return html;
}


// JSON → パックごとのセクションHTMLを生成して mount に描画
async function renderAllPacks({
  jsonUrl = './public/cards_latest.json',
  mountSelector = '#packs-root',
  isLatestOnly = true,
  where = (c)=>true,
  sortInRace = (a,b)=> (a.cd - b.cd),
} = {}) {

  // --- JSON取得 ---
  let all;
  try {
    all = await fetchCheckerCards_(jsonUrl);
  } catch (err) {
    console.error('カードJSONの読み込みに失敗:', err);
    const mount = document.querySelector(mountSelector);
    if (mount) mount.textContent = 'データの読み込みに失敗しました。再読み込みしてください。';
    return;
  }

  // --- 抽出 ---
  const source = all
    .filter(c => (!isLatestOnly || c.is_latest))
    .filter(where);

  window.__cardsCache = source;

  // --- パック検出＆グループ化 ---
  const byPack = new Map(); // en -> {jp, cards:[]}
  for (const c of source){
    const pn = splitPackName_(c.pack_name);
    if (!byPack.has(pn.en)) byPack.set(pn.en, { jp: pn.jp, cards: [] });
    byPack.get(pn.en).cards.push(c);
  }
  if (byPack.size === 0) return;

  // --- パック並び順 ---
  const allPackEns = Array.from(byPack.keys());

  // グローバルPACK_ORDERを安全に取得
  const PACK_ORDER_SAFE = Array.isArray(window.PACK_ORDER) ? window.PACK_ORDER : [];

  const rest = allPackEns
    .filter(p => !PACK_ORDER_SAFE.includes(p))
    .sort((a,b)=>a.localeCompare(b));

  const orderedPacks = [...PACK_ORDER_SAFE.filter(p=>byPack.has(p)), ...rest];

  // --- パックごとに種族で整列 ---
  const parts = [];
  for (let i = 0; i < orderedPacks.length; i++){
    const packEn = orderedPacks[i];
    const { jp, cards } = byPack.get(packEn);

    const byRace = new Map();
    for (const r of RACE_ORDER) byRace.set(r, []);
    for (const c of cards){
      if (!byRace.has(c.race)) byRace.set(c.race, []);
      byRace.get(c.race).push(c);
    }
    for (const r of byRace.keys()){
      byRace.get(r).sort(sortInRace);
    }

    const packKey = (window.__packKeyByEn && window.__packKeyByEn[packEn]) || '';
    const packGroup = detectPackGroup_(packEn, jp, packKey, i);

    parts.push(buildPackSectionHTML(packEn, jp, byRace, packKey, packGroup));
  }

  parts.push(buildOverallGridSectionHTML(source));

  const mount = document.querySelector(mountSelector);
  if (!mount) { console.error('mountSelectorが見つかりません:', mountSelector); return; }
  mount.innerHTML = parts.join('');

  // 生成後にイベントを委譲で付与
  attachPackControls(mount);
  setCheckerSectionMode_(window.__checkerSectionMode === 'overall-4x4' ? 'overall-4x4' : 'packs');
}


// =====================================================
// 3) 不足カード（全体/パック別） - divモーダル版（dialog不使用）
// =====================================================

// 不足カードモーダルの確保＆初期化
function ensureMissingDialog_(){
  let wrap = document.getElementById('missing-dialog');
  let back = document.getElementById('missing-backdrop');

  // backdrop（クリックで閉じる）
  if (!back) {
    back = document.createElement('div');
    back.id = 'missing-backdrop';
    back.addEventListener('click', closeMissingDialog_);
    document.body.appendChild(back);
  }

  // modal本体
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'missing-dialog';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'missing-title');

    wrap.innerHTML = `
      <div class="missing-dialog-inner">
        <div class="missing-dialog-head">
          <h3 id="missing-title">不足カード</h3>
          <button type="button" id="missing-close" aria-label="閉じる">×</button>
        </div>

        <div id="missing-body" class="missing-body"></div>

        <div class="missing-dialog-foot">
          <button type="button" id="missing-copy">一覧をコピー</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
  }

  // ✅ wrap が既存でも毎回「閉じる」を配線（ここが大事）
  const closeBtn =
    wrap.querySelector('#missing-close')
    || wrap.querySelector('.icon-btn')
    || wrap.querySelector('[data-missing-close]');

  if (closeBtn && !closeBtn.dataset.wiredClose) {
    closeBtn.dataset.wiredClose = '1';
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeMissingDialog_();
    });
  }

  // ✅ Escも「一度だけ」配線（wrap生成の中に入れると重複登録になりやすい）
  if (!document.body.dataset.wiredMissingEsc) {
    document.body.dataset.wiredMissingEsc = '1';
    document.addEventListener('keydown', (e) => {
      const w = document.getElementById('missing-dialog');
      if (e.key === 'Escape' && w && w.classList.contains('is-open')) closeMissingDialog_();
    });
  }

  // 初期は非表示
  back.style.display = 'none';
  wrap.style.display = 'none';
  wrap.classList.remove('is-open');

  return { wrap, back };
}

function openMissingDialog(title, items){
  const { wrap, back } = ensureMissingDialog_();
  const body = wrap.querySelector('#missing-body');
  const ttl  = wrap.querySelector('#missing-title');
  if (!body || !ttl) return;

  ttl.textContent = title;

  if (!items.length){
    body.innerHTML = '<p>不足カードはありません。</p>';
  } else {
    const info = document.createElement('p');
    info.className = 'missing-info';
    info.textContent = (/Mobi|Android/i.test(navigator.userAgent))
      ? '📱 タップで画像表示'
      : '🖱️ カーソル合わせて画像表示';

    const ul = document.createElement('ul');
    items.forEach(it=>{
      const li = document.createElement('li');
      li.innerHTML = `<span class="missing-name">${it.name}x${it.need}</span>`;
      li.dataset.cd  = String(it.cd || '');
      li.classList.add('missing-item');
      if (it.race) li.classList.add(`race-${it.race}`);
      ul.appendChild(li);
    });

    body.replaceChildren(info, ul);
  }

  const copyBtn = wrap.querySelector('#missing-copy');
  const text = items.map(it => `${it.name}x${it.need}`).join('\n');
  if (copyBtn) {
    copyBtn.onclick = async ()=>{
      try{
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else prompt('以下をコピーしてください', text);
        copyBtn.textContent = 'コピーしました';
        setTimeout(()=> copyBtn.textContent = '一覧をコピー', 1400);
      }catch{ alert('コピーに失敗しました'); }
    };
  }

  // ✅ 表示（z-index世界）
  back.style.display = 'block';
  wrap.style.display = 'block';
  wrap.classList.add('is-open');

  // ✅ プレビューをモーダルより上に（bodyに置く）
  try {
    const pop = document.getElementById('card-preview-pop');
    if (pop && pop.parentElement !== document.body) document.body.appendChild(pop);
  } catch {}
}

function closeMissingDialog_(){
  const wrap = document.getElementById('missing-dialog');
  const back = document.getElementById('missing-backdrop');

  if (wrap) { wrap.style.display = 'none'; wrap.classList.remove('is-open'); }
  if (back) back.style.display = 'none';

  // プレビューも閉じる
  try { window.CardPreview?.hide?.(); } catch {}
}


// 所持合計（OwnedStore優先）
function ownedTotal(cd){
  const S = window.OwnedStore;
  if (!S || typeof S.get !== 'function') return 0;

  const e = S.get(String(cd));
  return e?.normal | 0;
}

// === パック順インデックス（PACK_ORDER優先→残りは英名の自然順） ===
let __PACK_INDEX_CACHE = null;

function getPackOrderIndex() {
  if (__PACK_INDEX_CACHE) return __PACK_INDEX_CACHE;

  // cardsCache から en 一覧を作る
  const cards = Array.isArray(window.__cardsCache) ? window.__cardsCache : [];
  const byEn = new Map(); // en -> jp
  for (const c of cards) {
    const pn = splitPackName_(c.pack_name || c.pack || '');
    if (!pn.en) continue;
    if (!byEn.has(pn.en)) byEn.set(pn.en, pn.jp || '');
  }

  // PACK_ORDER が無くても落ちないように
  const PACK_ORDER_SAFE = Array.isArray(window.PACK_ORDER) ? window.PACK_ORDER : [];

  const rest = [...byEn.keys()]
    .filter(en => !PACK_ORDER_SAFE.includes(en))
    .sort((a, b) => String(a).localeCompare(String(b), 'ja'));

  const ordered = [...PACK_ORDER_SAFE.filter(en => byEn.has(en)), ...rest];

  const idx = {};
  ordered.forEach((en, i) => { idx[en] = i; });

  __PACK_INDEX_CACHE = idx;
  return idx;
}

// カードからパック英名(en)を取り出す（collectMissingのsortで使う）
function packEnOf(card){
  const pn = splitPackName_(card.pack_name || card.pack || '');
  return pn.en || '';
}

// 種族→数値順位（RACE_ORDER を使う）
function raceRankOf(r){
  const i = RACE_ORDER.indexOf(r);
  return (i >= 0) ? i : 999;
}

// 不足カード収集（scope === 'all' or packオブジェクト）
function collectMissing(scope='all'){
  let list = [];

  if (scope === 'all'){
    list = Array.isArray(window.__cardsCache) ? window.__cardsCache : [];
  } else {
    const els = queryCardsByPack(scope);
    const byCd = new Set(Array.from(els).map(el => String(el.dataset.cd)));
    list = (Array.isArray(window.__cardsCache) ? window.__cardsCache : [])
      .filter(c => byCd.has(String(c.cd)));
  }

  const missing = [];
  for (const c of list){
    const max = (c.race === '旧神') ? 1 : 3;
    const own = ownedTotal(c.cd);
    const need = Math.max(0, max - own);
    if (need <= 0) continue;

    missing.push({
      cd:String(c.cd),
      name:c.name,
      need,
      max,
      rarity:c.rarity,
      cost:c.cost|0,
      power:c.power|0,
      type:c.type||'',
      race:c.race || ''
    });
  }

  // 並び順：パック → 種族 → タイプ → コスト → パワー → cd
  const packIdx = getPackOrderIndex();
  missing.sort((a,b)=>{
    const pa = packIdx[packEnOf(a)] ?? 9999;
    const pb = packIdx[packEnOf(b)] ?? 9999;
    if (pa !== pb) return pa - pb;

    const ra = raceRankOf(a.race || ''), rb = raceRankOf(b.race || '');
    if (ra !== rb) return ra - rb;

    const ta = TYPE_ORDER[a.type] ?? 999;
    const tb = TYPE_ORDER[b.type] ?? 999;
    if (ta !== tb) return ta - tb;

    const ca = Number.isFinite(a.cost) ? a.cost : Number.MAX_SAFE_INTEGER;
    const cb = Number.isFinite(b.cost) ? b.cost : Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;

    const pa2 = Number.isFinite(a.power) ? a.power : Number.MAX_SAFE_INTEGER;
    const pb2 = Number.isFinite(b.power) ? b.power : Number.MAX_SAFE_INTEGER;
    if (pa2 !== pb2) return pa2 - pb2;

    const cda = Number.isFinite(+a.cd) ? +a.cd : Number.MAX_SAFE_INTEGER;
    const cdb = Number.isFinite(+b.cd) ? +b.cd : Number.MAX_SAFE_INTEGER;
    return cda - cdb;
  });

  return missing;
}

// =====================================================
// 4) 不足リスト：カード画像プレビュー（PC hover / SP long-press）
// =====================================================

if (!window.__wiredMissingPreview){
  window.__wiredMissingPreview = true;

  document.addEventListener('mouseover', (e)=>{
    const span = e.target.closest('#missing-body li.missing-item .missing-name');
    const li = span ? span.closest('li.missing-item') : null;
    if (!li || !li.dataset.cd) return;
    showCardPreviewNextTo(li, li.dataset.cd);
  });

  document.addEventListener('mousemove', (e)=>{
    const span = e.target.closest('#missing-body li.missing-item .missing-name');
    if (!span && e.target.closest('.pack-summary-missing-name[data-cd]')) return;
    if (!span) { hideCardPreview(); return; }
    const li = span.closest('li.missing-item');
    if (!li || !li.dataset.cd) { hideCardPreview(); return; }
    showCardPreviewAt(e.clientX, e.clientY, li.dataset.cd);
  });

  document.addEventListener('mouseout', (e)=>{
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#card-preview-pop')) return;
    if (e.target.closest && e.target.closest('#missing-body')) {
      if (!e.relatedTarget || !e.relatedTarget.closest('#missing-body')) hideCardPreview();
    }
  });

  let pressTimer = 0;
  document.addEventListener('touchstart', (e)=>{
    const span = e.target.closest && e.target.closest('#missing-body li.missing-item .missing-name');
    if (!span) return;
    const li = span.closest('li.missing-item');
    if (!li || !li.dataset.cd) return;
    const touch = e.touches[0];
    pressTimer = window.setTimeout(()=>{
      showCardPreviewAt(touch.clientX, touch.clientY, li.dataset.cd);
    }, 500);
  }, {passive:true});

  ['touchend','touchcancel','touchmove'].forEach(type=>{
    document.addEventListener(type, ()=>{
      if (pressTimer){ clearTimeout(pressTimer); pressTimer = 0; }
      hideCardPreview();
    }, {passive:true});
  });

}

// =====================================================
// 5) 一括操作（高速版：まとめて更新）
// =====================================================

function getOwnedEntry_(map, cd){
  const e = map[String(cd)];
  if (e && typeof e === 'object') return {
    normal: Number(e.normal || 0),
  };
  // 旧形式（数値）も一応吸収
  return { normal: Number(e||0) };
}

function setOwnedTotalToNormal_(map, cd, total){
  const count = total | 0;
  if (count > 0) map[String(cd)] = count;
  else map[String(cd)] = 0;
}

function ownedCountOfEntry_(value){
  if (value && typeof value === 'object') return Number(value.normal || 0);
  return Number(value || 0);
}

// ✅ 一括変更：OwnedStore.replaceAll を1回だけ呼ぶ
function bulkUpdateOwned_(mutator){
  const sync = window.AccountOwnedSync || window.AccountAppDataSync;
  if (sync && typeof sync.isReady === 'function' && !sync.isReady()) return true;

  const S = window.OwnedStore;
  if (!S) return false;

  // ✅ patch があるなら差分だけで更新（速い）
  if (typeof S.patch === 'function') {
    const current = (typeof S.getAll === 'function') ? (S.getAll() || {}) : {};
    const next = Object.assign({}, current);
    mutator(next);

    const patch = {};
    const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
    keys.forEach((cd) => {
      if (ownedCountOfEntry_(current[cd]) !== ownedCountOfEntry_(next[cd])) {
        patch[cd] = next[cd] || 0;
      }
    });

    if (!Object.keys(patch).length) return true;
    S.patch(patch);
    return true;
  }

  // フォールバック：replaceAll
  if (!S.getAll || !S.replaceAll) return false;
  const next = S.getAll() || {};
  mutator(next);
  S.replaceAll(next);
  return true;
}


// packが不足表示中なら、操作後にそのpackだけ再判定して表示を更新する
function reapplyPackIfIncomplete_(packSection){
  if (!packSection) return;
  const mode = packSection.dataset.viewMode || 'all';
  if (mode === 'incomplete') {
    // ✅ “切替時だけ再判定” ルールを保ちつつ、ここだけは明示的に更新
    applyPackView_(packSection, 'incomplete', true);
  }
}

// ✅ 一括操作後の重い処理は「次の描画フレーム」に逃がす（INP対策）
function schedulePostBulkUIUpdate_(packSection){
  const sel = (packSection && packSection.id)
    ? `#${CSS.escape(packSection.id)}`
    : '#packs-root';

  // ✅ INP対策：次タスクに逃がして先に描画させる
  setTimeout(() => {
    try {
      window.OwnedUI?.sync?.(sel, { grayscale: true, skipSummary: true, skipOwnedTotal: true });
    } catch (e) {
      window.OwnedUI?.sync?.('#packs-root', { grayscale: true, skipSummary: true, skipOwnedTotal: true });
    }

    // 不足表示中なら、そのpackだけ再判定
    reapplyPackIfIncomplete_(packSection);

    // summary は idle に（これも重い）
    const runSummary = () => {
      try {
        if (typeof window.updateSummary === 'function') window.updateSummary();
        else if (window.Summary?.updateSummary) window.Summary.updateSummary();
      } catch {}
    };

    if (window.requestIdleCallback) requestIdleCallback(runSummary, { timeout: 700 });
    else setTimeout(runSummary, 0);
  }, 0);
}


// =====================================================
// 5) 一括操作（+1/+3/解除）
// =====================================================

function bump_(el, times = 1) {
  if (typeof window.bumpOwnership === 'function') return window.bumpOwnership(el, times);
  for (let i = 0; i < times; i++) if (typeof window.toggleOwnership === 'function') window.toggleOwnership(el);
}

function clearCard_(el) {
  if (typeof window.clearOwnership === 'function') return window.clearOwnership(el);
  for (let i = 0; i < 4; i++) if (typeof window.toggleOwnership === 'function') window.toggleOwnership(el);
}

function updateOverallGridCardSize_(){
  const root = document.getElementById('checker-overall-4x4');
  if (!root || root.hidden) return;

  const title = root.querySelector('.pack-title');
  const pager = root.querySelector('.checker-overall-pager');
  const rootTop = root.getBoundingClientRect().top;
  const stickyOffset = typeof window.__checkerStickyOffset === 'function'
    ? window.__checkerStickyOffset()
    : 0;
  const visibleTop = Math.max(rootTop, stickyOffset + 6);
  const gap = 5;
  const pagePadding = 16;
  const safety = 4;
  const fixedHeight =
    (title ? Math.ceil(title.getBoundingClientRect().height) : 0) +
    (pager ? Math.ceil(pager.getBoundingClientRect().height) : 0) +
    pagePadding +
    (gap * 3) +
    safety;

  const availableHeight = Math.max(160, window.innerHeight - visibleTop - fixedHeight);
  const widthFromHeight = Math.floor((availableHeight / 4) * (424 / 532));
  const rootWidth = Math.max(320, root.clientWidth || window.innerWidth);
  const hasSummaryPanel = Array.from(document.querySelectorAll('.summary-panel')).some(panel => {
    const style = window.getComputedStyle(panel);
    return style.display !== 'none' && style.visibility !== 'hidden' && panel.getBoundingClientRect().width > 0;
  });
  const spread = hasSummaryPanel ? 2 : 1;
  const columns = spread * 4;
  const spreadGap = spread > 1 ? 16 : 0;
  const widthFromWidth = Math.floor((rootWidth - pagePadding - spreadGap - (gap * (columns - 1))) / columns);
  const cardWidth = Math.max(64, Math.min(Math.floor(widthFromHeight * 1.06), widthFromWidth, 240));

  root.style.setProperty('--overall-card-width', `${cardWidth}px`);
  root.classList.toggle('is-two-page', spread === 2);
  const pagesRoot = root.querySelector('.checker-overall-pages');
  if (pagesRoot) pagesRoot.dataset.spread = String(spread);
}

function setOverallGridPage_(nextPage){
  const root = document.getElementById('checker-overall-4x4');
  if (!root) return;

  const pagesRoot = root.querySelector('.checker-overall-pages');
  if (!pagesRoot) return;

  const total = Math.max(1, Number(pagesRoot.dataset.totalPages || 1));
  updateOverallGridCardSize_();
  const spread = Math.max(1, Number(pagesRoot.dataset.spread || 1));
  const maxStart = Math.max(0, total - spread);
  const requestedPage = Math.max(0, Math.min(maxStart, Number(nextPage || 0)));
  const page = spread > 1
    ? Math.min(maxStart, Math.floor(requestedPage / spread) * spread)
    : requestedPage;
  const endPage = Math.min(total - 1, page + spread - 1);
  pagesRoot.dataset.currentPage = String(page);

  root.querySelectorAll('.checker-overall-page').forEach(el => {
    const pageNo = Number(el.dataset.page || 0);
    el.hidden = pageNo < page || pageNo > endPage;
  });

  const info = root.querySelector('.checker-overall-page-info');
  if (info) {
    info.textContent = spread > 1 && endPage > page
      ? `${page + 1}-${endPage + 1} / ${total}`
      : `${page + 1} / ${total}`;
  }

  root.querySelectorAll('.checker-overall-page-btn').forEach(btn => {
    const dir = Number(btn.dataset.dir || 0);
    btn.disabled = (dir < 0 && page <= 0) || (dir > 0 && page >= maxStart);
  });
}

function setCheckerSectionMode_(mode){
  const isOverall = mode === 'overall-4x4';
  window.__checkerSectionMode = isOverall ? 'overall-4x4' : 'packs';

  document.querySelectorAll('#packs-root .pack-section').forEach(section => {
    section.hidden = isOverall;
  });

  const overall = document.getElementById('checker-overall-4x4');
  if (overall) {
    overall.hidden = !isOverall;
    if (isOverall) {
      setOverallGridPage_(Number(overall.querySelector('.checker-overall-pages')?.dataset.currentPage || 0));
      requestAnimationFrame(updateOverallGridCardSize_);
    }
  }

  try {
    window.OwnedUI?.sync?.('#packs-root', {
      grayscale: true,
      skipSummary: true,
      skipOwnedTotal: true,
    });
  } catch (_) {}
}

window.showCheckerOverallGrid = function showCheckerOverallGrid(){
  setCheckerSectionMode_('overall-4x4');
  try {
    localStorage.setItem('mosurogia_summary_include_unobtainable', '1');
    const cb = document.getElementById('toggle-unobtainable');
    if (cb) cb.checked = true;
    window.updateSummary?.();
  } catch (_) {}

  const root = document.getElementById('checker-overall-4x4');
  if (root) {
    const offset = typeof window.__checkerStickyOffset === 'function' ? window.__checkerStickyOffset() : 0;
    const y = window.scrollY + root.getBoundingClientRect().top - offset - 8;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    setTimeout(updateOverallGridCardSize_, 220);
    setTimeout(updateOverallGridCardSize_, 520);
  }
};

window.showCheckerPackSections = function showCheckerPackSections(){
  setCheckerSectionMode_('packs');
};

window.addEventListener('resize', () => {
  if (window.__checkerSectionMode === 'overall-4x4') {
    requestAnimationFrame(updateOverallGridCardSize_);
  }
});

function attachPackControls(root) {
  if (root.dataset.cardDetailZoomBound !== '1') {
    root.dataset.cardDetailZoomBound = '1';
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('.checker-detail-zoom-btn');
      if (!btn || !root.contains(btn)) return;

      e.preventDefault();
      e.stopPropagation();

      const cardEl = btn.closest('.card[data-cd]');
      const cd = normCd5_(cardEl?.dataset?.cd);
      if (!cd) return;

      const cardInfo = Array.isArray(window.__cardsCache)
        ? window.__cardsCache.find((card) => normCd5_(card.cd) === cd)
        : null;

      const anchorRect = btn.getBoundingClientRect();
      if (typeof window.openCardDetailModal === 'function') {
        window.openCardDetailModal(cardInfo || cd, { anchorRect });
      } else {
        window.dispatchEvent(new CustomEvent('open-card-detail', {
          detail: {
            cardId: cd,
            anchorRect,
          },
        }));
      }
    }, true);
  }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.classList.contains('checker-overall-page-btn')) {
      const rootEl = btn.closest('#checker-overall-4x4');
      const pagesRoot = rootEl?.querySelector?.('.checker-overall-pages');
      const current = Number(pagesRoot?.dataset.currentPage || 0);
      const spread = Math.max(1, Number(pagesRoot?.dataset.spread || 1));
      setOverallGridPage_(current + (Number(btn.dataset.dir || 0) * spread));
      return;
    }

    // ✅ e.target ではなく btn を起点に closest を取る（これが重要）
    const packSection = btn.closest('.pack-section');
    const raceGroup   = btn.closest('.race-group');

    // ------------------------------
    // ✅ パック：シルバーブロンズ+3（=最大まで埋める扱い）
    // ------------------------------
    if (btn.classList.contains('pack-select-all-btn') && packSection) {
      const targets = packSection.querySelectorAll('.card.rarity-silver, .card.rarity-bronze');

      const ok = bulkUpdateOwned_((map) => {
        targets.forEach(el => {
          const cd = el.dataset.cd;
          if (!cd) return;

          // 旧神=1 / それ以外=3（ただし対象はsilver/bronze想定なので基本3）
          const max = maxOwnedOfCardEl_(el);
          // “+3” は結局 max まで埋まるので max にしてOK
          setOwnedTotalToNormal_(map, cd, max);
        });
      });

      if (!ok) {
        // フォールバック（遅いけど動く）
        targets.forEach(el => bump_(el, 3));
      }

      // ✅ まとめて同期は1回だけ
schedulePostBulkUIUpdate_(packSection);
      return;
    }

    // ------------------------------
    // ✅ パック：全て選択解除（=0）
    // ------------------------------
    if (btn.classList.contains('pack-clear-all-btn') && packSection) {
      const targets = packSection.querySelectorAll('.card[data-cd]');

      const ok = bulkUpdateOwned_((map) => {
        targets.forEach(el => {
          const cd = el.dataset.cd;
          if (!cd) return;
          setOwnedTotalToNormal_(map, cd, 0);
        });
      });

      if (!ok) {
        targets.forEach(el => clearCard_(el));
      }

schedulePostBulkUIUpdate_(packSection);
      return;
    }

    // ------------------------------
    // ✅ 全カード/不足カード（パック単位）
    // ------------------------------
    if (btn.classList.contains('toggle-pack-view-btn') && packSection) {
      const mode = btn.dataset.view; // 'all' | 'incomplete'
      applyPackView_(packSection, mode, true);
      //updateTopToggleByPacks_();
      setTimeout(() => { try { window.updateSummary?.(); } catch {} }, 0);
      return;
    }


    // ------------------------------
    // ✅ 全カード/不足カード（全体：トップバー）
    // ------------------------------
    // ------------------------------
    // ✅ 種族：全て選択+1（=1枚増やす、上限で止める）
    // ------------------------------
    if (btn.classList.contains('select-all-btn') && raceGroup) {
      const targets = raceGroup.querySelectorAll('.card[data-cd]');

      const ok = bulkUpdateOwned_((map) => {
        targets.forEach(el => {
          const cd = el.dataset.cd;
          if (!cd) return;

          const cur = getOwnedEntry_(map, cd);
          const curTotal = cur.normal | 0;
          const max = maxOwnedOfCardEl_(el);
          const nextTotal = Math.min(max, curTotal + 1);

          // 合計だけ合ってればよい前提で normal に寄せる
          setOwnedTotalToNormal_(map, cd, nextTotal);
        });
      });

      if (!ok) {
        targets.forEach(el => bump_(el, 1));
      }

schedulePostBulkUIUpdate_(packSection);
      return;
    }

    // ------------------------------
    // ✅ 種族：全て選択解除（=0）
    // ------------------------------
    if (btn.classList.contains('clear-all-btn') && raceGroup) {
      const targets = raceGroup.querySelectorAll('.card[data-cd]');

      const ok = bulkUpdateOwned_((map) => {
        targets.forEach(el => {
          const cd = el.dataset.cd;
          if (!cd) return;
          setOwnedTotalToNormal_(map, cd, 0);
        });
      });

      if (!ok) {
        targets.forEach(el => clearCard_(el));
      }

schedulePostBulkUIUpdate_(packSection);
      return;
    }
  });
}


// =====================================================
// 5.5) 表示切替：パック単位（全カード / 不足カード）
// =====================================================

// 旧神=1 / それ以外=3
function maxOwnedOfCardEl_(cardEl){
  const race = cardEl?.dataset?.race || '';
  return (race === '旧神') ? 1 : 3;
}

// ✅ パック内のボタン状態だけ更新
function syncPackToggleUI_(packSection, mode){
  packSection.querySelectorAll('.toggle-pack-view-btn').forEach(b => {
    const on = (b.dataset.view === mode);
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

// ✅ パック単位で “不足カードのみ” を適用（JSでdisplayも確実に切る）
function applyPackView_(packSection, mode, forceRecalc = false){
  if (!packSection) return;

  // mode: 'all' | 'incomplete'
  packSection.dataset.viewMode = mode;

  // 不足表示中は “切替時だけ” 再計算（カード操作で勝手に消さない）
  if (
    mode === 'incomplete' &&
    packSection.classList.contains('is-incomplete-only') &&
    !forceRecalc
  ){
    syncPackToggleUI_(packSection, mode);
    return;
  }

  // all / incomplete のクラス切替
  packSection.classList.toggle('is-incomplete-only', mode === 'incomplete');

  const cards = packSection.querySelectorAll('.card[data-cd]');
  cards.forEach(el => {
    const cd  = el.dataset.cd;
    const own = ownedTotal(cd);
    const max = maxOwnedOfCardEl_(el);
    const isIncomplete = own < max;

    el.classList.toggle('is-incomplete', isIncomplete);
    el.classList.toggle('is-complete', !isIncomplete);

    // ✅ ここが重要：CSSに頼らずJSで確実に表示制御
    if (mode === 'incomplete') {
      el.style.display = isIncomplete ? '' : 'none';
    } else {
      el.style.display = '';
    }
  });

  // ✅ 種族グループ：枠は残す。全コンプなら「comp済み」表示にする
  packSection.querySelectorAll('.race-group').forEach(group => {
    // 常に表示は戻しておく（消さない）
    group.style.display = '';

    const hasIncomplete = !!group.querySelector('.card.is-incomplete');
    const isCompleteRace = !hasIncomplete; // ＝全部コンプ

    // 不足表示のときだけ「コンプ済み」見た目にする
    group.classList.toggle('is-race-complete', mode === 'incomplete' && isCompleteRace);
  });

  syncPackToggleUI_(packSection, mode);
}



// 初期化：全パックを all にそろえる
function initPackViews_(){
  const mode = window.__topPackViewMode || 'all';
  document.querySelectorAll('#packs-root .pack-section').forEach(pack => {
    applyPackView_(pack, mode, true);
  });
}

let __checkerOwnedRefreshTimer = 0;

function logCheckerOwnedRefresh_(reason, step, detail = {}){
  try {
    console.info('[checker-owned-refresh]', Object.assign({ reason, step }, detail));
  } catch (_) {}
}

// 所持データが後から復元・同期された場合も、表示切替時と同じ再計算をまとめて走らせる
function scheduleCheckerOwnedRefresh_(delay = 0, reason = 'unknown'){
  if (delay === 0) clearTimeout(__checkerOwnedRefreshTimer);
  __checkerOwnedRefreshTimer = setTimeout(() => {
    const root = document.getElementById('packs-root');
    const cardCount = root ? root.querySelectorAll('.card[data-cd]').length : 0;
    const ownedCount = (() => {
      try { return Object.keys(window.OwnedStore?.getAll?.() || {}).length; }
      catch (_) { return -1; }
    })();

    logCheckerOwnedRefresh_(reason, 'start', {
      hasRoot: !!root,
      cardCount,
      ownedCount,
      hasSummary: typeof window.updateSummary === 'function' || !!window.Summary?.updateSummary,
      hasMeterSync: typeof window.__syncCheckerMeters === 'function',
    });

    if (!root || !cardCount) {
      logCheckerOwnedRefresh_(reason, 'skip:no-cards', { hasRoot: !!root, cardCount });
      return;
    }

    try {
      window.OwnedUI?.sync?.('#packs-root', {
        grayscale: true,
        skipSummary: true,
        skipOwnedTotal: true,
      });
      logCheckerOwnedRefresh_(reason, 'owned-ui-synced');
    } catch (e) {
      logCheckerOwnedRefresh_(reason, 'owned-ui-error', { message: e?.message || String(e) });
    }

    try {
      applyTopPackView_(window.__topPackViewMode || 'all', true);
      logCheckerOwnedRefresh_(reason, 'pack-view-applied', { mode: window.__topPackViewMode || 'all' });
    } catch (e) {
      logCheckerOwnedRefresh_(reason, 'pack-view-error', { message: e?.message || String(e) });
    }

    try {
      if (typeof window.updateSummary === 'function') window.updateSummary();
      else if (window.Summary?.updateSummary) window.Summary.updateSummary();
      logCheckerOwnedRefresh_(reason, 'summary-updated');
    } catch (e) {
      logCheckerOwnedRefresh_(reason, 'summary-error', { message: e?.message || String(e) });
    }

    try {
      window.__syncCheckerMeters?.();
      logCheckerOwnedRefresh_(reason, 'meters-synced');
    } catch (e) {
      logCheckerOwnedRefresh_(reason, 'meters-error', { message: e?.message || String(e) });
    }
  }, delay);
}

// =====================================================
// 5.6) 表示切替：トップ（全パック一括）
// =====================================================

// ✅ トップ切替 → 全パックへ適用
function applyTopPackView_(mode, forceRecalc = true){
  // 記憶（初期化時にも使う）
  window.__topPackViewMode = mode;

  document.querySelectorAll('#packs-root .pack-section').forEach(pack => {
    applyPackView_(pack, mode, forceRecalc);
  });

}


// =====================================================
// 6) pack抽出ヘルパ（summary / 不足カード用）
// =====================================================

function wireTabBarOwnedRefresh_(){
  if (window.__checkerTabBarOwnedRefreshBound) return;
  window.__checkerTabBarOwnedRefreshBound = true;

  document.addEventListener('tab:switched', (e) => {
    const targetId = e?.detail?.targetId || '';
    if (targetId !== 'checker') return;

    scheduleCheckerOwnedRefresh_(0, 'tab:switched');
    scheduleCheckerOwnedRefresh_(250, 'tab:switched:late');
  });

  window.addEventListener('owned-data:replaced', (e) => {
    const reason = e?.detail?.reason || 'owned-data:replaced';
    scheduleCheckerOwnedRefresh_(0, reason);
    scheduleCheckerOwnedRefresh_(250, `${reason}:late`);
  });
}

function queryCardsByPack(pack) {
  const en = (pack?.nameMain || '').trim();
  const cards = en
    ? document.querySelectorAll(`#packs-root .card[data-pack^="${CSS.escape(en)}"]`)
    : document.querySelectorAll('#packs-root .card');
  return Array.from(cards).filter(card => card.dataset.summarySkip !== '1');
}
window.queryCardsByPack = window.queryCardsByPack || queryCardsByPack;


// =====================================================
// 7) 初期化：packs確定 → renderAllPacks → OwnedUI同期 → summary更新
// =====================================================

async function initPacksThenRender() {
  try {
    const catalog = await window.loadPackCatalog?.();
    if (!catalog) throw new Error('loadPackCatalog missing');
    window.PACK_ORDER = catalog.order;

    // ✅ 追加：en -> key
    window.__packKeyByEn = {};
    catalog.list.forEach(p => { window.__packKeyByEn[p.en] = p.key; });

    window.packs = catalog.list.map(p => ({
      key: p.key,
      nameMain: p.en,
      nameSub:  p.jp,
      // selector: `#pack-${p.slug}`
      selector: `#pack-${p.key}`
    }));
  } catch (e) {
    console.warn('packカタログ初期化に失敗:', e);
    window.PACK_ORDER = [];
    window.packs = [];
    window.__packKeyByEn = {};
  }

  await renderAllPacks({
    jsonUrl: 'public/cards_latest.json',
    mountSelector: '#packs-root',
    isLatestOnly: true,
    sortInRace: typeCostPowerCd
  });
  window.dispatchEvent(new Event('cards-checker:rendered'));
  try {
  window.rebuildPackJumpTabs?.();
} catch(e) {}

  // チェッカー側だけ 0枚をグレー化する
  try { window.OwnedUI?.bind?.('#packs-root', { grayscale: true }); }
  catch (e) { console.warn('[checker] OwnedUI.bind(#packs-root) failed', e); }

  if (window.OwnedStore?.onChange && !window.__checkerOwnedRefreshBound) {
    window.__checkerOwnedRefreshBound = true;
    window.OwnedStore.onChange(() => scheduleCheckerOwnedRefresh_(0, 'owned-store:on-change'));
  }

  if (typeof window.applyGrayscaleFilter === 'function') window.applyGrayscaleFilter();
  if (typeof window.updateSummary === 'function') window.updateSummary();
  else if (window.Summary?.updateSummary) window.Summary.updateSummary();
  initPackViews_();
  wireTabBarOwnedRefresh_();
  wireMissingAllButtons_();
  scheduleCheckerOwnedRefresh_(0, 'init');
  scheduleCheckerOwnedRefresh_(250, 'init:late');
  window.dispatchEvent(new Event('card-page:ready'));// カードページ準備完了イベント
}

function wireMissingAllButtons_(){
  const bind = (id) => {
    const btn = document.getElementById(id);
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';

    btn.addEventListener('click', () => {
      const items = collectMissing('all');
      openMissingDialog('不足カード（全カード）', items);
    });
  };

  bind('show-missing-all-top');
  bind('show-missing-all'); // PC側があれば
}

// ✅ どこからでも呼べるように（必要なら）
window.openMissingAll = function(){
  const items = collectMissing('all');
  openMissingDialog('不足カード（全カード）', items);
};


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPacksThenRender, { once: true });
} else {
  initPacksThenRender();
}
