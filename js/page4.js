// ==============================
// deck-post 一覧UI 最小実装
// ==============================

// ---- 状態 ----
let ALL_POSTS = []; // サーバ or JSON から取得
const viewState = {
  keyword: "",
  tags: new Set(),        // 自動/選択タグ
  hashtags: new Set(),    // #タグ
  cardFilters: [],        // [{cd:50201, op:'>=', val:2}]
  sort: "new",
  view: "card",
  page: 1, pageSize: 20,
  similarBase: null,      // 類似検索の基準デッキ
};

// ---- お気に入り（ローカル） ----
const FAV_KEY = "deck_favs_v1";
const favSet = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"));
function toggleFav(id){
  if (favSet.has(id)) favSet.delete(id); else favSet.add(id);
  localStorage.setItem(FAV_KEY, JSON.stringify([...favSet]));
}
function isFav(id){ return favSet.has(id); }

// ---- 初期化 ----
document.addEventListener("DOMContentLoaded", init);

async function init(){
  bindHeaderControls();
  await loadPosts();      // JSON取得（なければダミー）
  buildFilterChips();     // タグを上部に注入
  render();               // 最初の描画
}

// ---- データ取得 ----
// ▼▼ ここから置換：既存 loadPosts を差し替え ▼▼
async function loadPosts(){
  // ①（任意）GAS一覧API：用意できたらURLを入れて有効化
  // const GAS_LIST_ENDPOINT = 'https://script.google.com/macros/s/xxxxxxxx/exec?mode=list';
  // try {
  //   const r = await fetch(GAS_LIST_ENDPOINT, { cache:'no-store' });
  //   if (r.ok) {
  //     const json = await r.json();             // 例：{ ok:true, items:[...] }
  //     if (json?.items?.length) {
  //       ALL_POSTS = json.items.map(normalizePost);
  //       return;
  //     }
  //   }
  // } catch(e){ console.warn('GAS list fetch failed', e); }

  // ② スタティックJSON（あれば）
  try {
    const res = await fetch("./data/deck_posts.json", {cache:"no-store"});
    if (res.ok){
      const raw = await res.json();
      if (Array.isArray(raw) && raw.length){
        ALL_POSTS = raw.map(normalizePost);
        return;
      }
    }
  } catch(e){ /* ignore */ }

  // ③ ローカル投稿キャッシュ（今回の動作確認はこれでOK）
  try{
    const raw = JSON.parse(localStorage.getItem('postedDecks') || '[]');
    if (Array.isArray(raw) && raw.length){
      ALL_POSTS = raw.map(normalizePost);
      return;
    }
  }catch(e){}

  // ④ 何も無ければダミー
  ALL_POSTS = buildDummyPosts();
}
// ▲▲ ここまで置換 ▲▲


// ▼▼ 追加：正規化＆ダミー生成 ▼▼
function normalizePost(src){
  // src は page2.js の submit で保存した payload or GASの1件
  const ts = Number(src.ts || Date.now());
  const repCd = guessRepresentativeCd(src);
  const thumb = (src.repImg && typeof src.repImg === 'string' && src.repImg.trim())
    ? src.repImg
    : (repCd ? `img/${String(repCd).slice(0,5)}.webp` : './img/00000.webp');

  // ハッシュタグ：tags のうち #で始まるものを抽出（無ければ空）
  const tags = Array.isArray(src.tags) ? src.tags : [];
  const hashtags = tags.filter(t => /^#/.test(t)).map(t => t.replace(/^#\s*/,''));
  const selectTags = tags.filter(t => !/^#/.test(t));

  // races はカンマ区切り文字列でも配列でもOKにしておく
  const autoTags = [];
  if (src.races) {
    const arr = Array.isArray(src.races) ? src.races : String(src.races).split(',').map(s=>s.trim()).filter(Boolean);
    autoTags.push(...arr);
  }

  // カード配列正規化
  const cards = Array.isArray(src.cards) ? src.cards.map(c => ({
    cd: String(c.cd || c.id || c.code || ''),
    count: Number(c.count || c.num || 0) || 0
  })).filter(c => c.cd && c.count > 0) : [];

  return {
    id: String(src.id || `local_${ts}`),
    title: String(src.title || '無題デッキ'),
    author: String(src.author || '匿名'),
    created_at: new Date(ts).toISOString(),
    updated_at: new Date(ts).toISOString(),
    favorite_count: Number(src.favorite_count || 0) || 0,
    thumbnail_url: thumb,
    representative_cd: repCd ? Number(repCd) : null,
    auto_tags: autoTags,         // 例：メイン種族など
    select_tags: selectTags,     // 例：「初心者向け」「格安デッキ」など
    hashtags,                    // #から始まる自由タグ
    comment: String(src.comment || ''),
    deck_code: String(src.code || ''),
    cards
  };
}

function guessRepresentativeCd(src){
  // 明示があれば優先
  if (src.repCd) return String(src.repCd);
  // 画像URLが img/XXXXX.webp なら推測
  if (src.repImg && /\/(\d{5})\.webp$/.test(src.repImg)) {
    const m = src.repImg.match(/\/(\d{5})\.webp$/);
    if (m) return m[1];
  }
  // カード配列の「最頻」or 先頭
  if (Array.isArray(src.cards) && src.cards.length){
    const sorted = src.cards.slice().sort((a,b)=>(b.count||0)-(a.count||0));
    const top = sorted[0];
    if (top?.cd) return String(top.cd).padStart(5,'0');
  }
  return null;
}

function buildDummyPosts(){
  return Array.from({length: 12}).map((_,i)=>normalizePost({
    title: `テスト投稿 ${i+1}`,
    author: ['Alice','Bob','Carol'][i%3],
    ts: Date.now() - i*86400000,
    favorite_count: Math.floor(Math.random()*80),
    repImg: './img/00000.webp',
    races: ['ドラゴン'],
    tags: ['初心者向け', '#高速展開'],
    comment: 'ダミーです。GASやローカル投稿が入ると自動で差し替わります。',
    cards: [
      {cd:'50201', count:3},{cd:'50202', count:2},{cd:'50301', count:1}
    ]
  }));
}


// ---- 上部コントロールのバインド ----
function bindHeaderControls(){
  const kw = document.getElementById("keyword");
  kw.addEventListener("input", (e)=>{
    viewState.keyword = e.target.value;
    viewState.page = 1;
    render();
  });

  document.getElementById("sortSelect").addEventListener("change", (e)=>{
    viewState.sort = e.target.value;
    viewState.page = 1;
    render();
  });

  document.getElementById("viewSelect").addEventListener("change", (e)=>{
    viewState.view = e.target.value;
    render();
  });

  document.getElementById("loadMoreBtn").addEventListener("click", ()=>{
    viewState.page++;
    render();
  });

  // シート
  document.getElementById("closeSheetBtn").addEventListener("click", closeSheet);
  document.querySelectorAll(".sheet-tabs button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const tab = btn.dataset.tab;
      document.querySelectorAll(".sheet-tabs button").forEach(b=>{
        b.classList.toggle("active", b===btn);
      });
      document.querySelectorAll("[data-tab-panel]").forEach(p=>{
        p.hidden = p.getAttribute("data-tab-panel") !== tab;
      });
    });
  });
}

// ---- フィルタチップの構築（簡易） ----
function buildFilterChips(){
  const allTags = new Set();
  ALL_POSTS.forEach(p=>{
    (p.auto_tags||[]).forEach(t=>allTags.add(t));
    (p.select_tags||[]).forEach(t=>allTags.add(t));
  });

  const filterWrap = document.getElementById("filterChips");
  filterWrap.innerHTML = [...allTags].sort().map(t=>`
    <button class="chip" data-chip="${t}" aria-pressed="false">${t}</button>
  `).join("");

  filterWrap.addEventListener("click", (e)=>{
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const tag = chip.dataset.chip;
    const active = chip.classList.toggle("active");
    chip.setAttribute("aria-pressed", active ? "true" : "false");
    if (active) viewState.tags.add(tag); else viewState.tags.delete(tag);
    viewState.page = 1;
    render();
  });
}

// ---- フィルタ ----
function filterPosts(posts){
  const kw = viewState.keyword.trim().toLowerCase();
  return posts.filter(p=>{
    // キーワード（デッキ名/作者/タグ/ハッシュ/コメント）
    const text = [
      p.title, p.author, p.comment,
      ...(p.hashtags||[]),(p.auto_tags||[]),(p.select_tags||[])
    ].join(" ").toLowerCase();
    const kwPass = kw ? text.includes(kw) : true;

    // タグAND
    const tagPass = [...viewState.tags].every(t => (p.auto_tags?.includes(t) || p.select_tags?.includes(t)));

    // カード条件（未使用なら素通り）
    const cardMap = new Map(p.cards.map(c=>[c.cd, c.count]));
    const cardPass = (viewState.cardFilters.length===0) || viewState.cardFilters.every(cf=>{
      const have = cardMap.get(cf.cd) || 0;
      if (cf.op === '=') return have === cf.val;
      if (cf.op === '>=') return have >= cf.val;
      if (cf.op === '>') return have > cf.val;
      if (cf.op === '<=') return have <= cf.val;
      return have >= 1;
    });

    return kwPass && tagPass && cardPass;
  });
}

// ---- 並び替え ----
function sortPosts(posts){
  if (viewState.sort === "new") return posts.toSorted((a,b)=> new Date(b.updated_at)-new Date(a.updated_at));
  if (viewState.sort === "old") return posts.toSorted((a,b)=> new Date(a.updated_at)-new Date(b.updated_at));
  if (viewState.sort === "fav") return posts.toSorted((a,b)=> (b.favorite_count)-(a.favorite_count));
  return posts;
}

// ---- 描画 ----
function render(){
  const listEl = document.getElementById("postList");
  const filtered = filterPosts(ALL_POSTS);
  const sorted = sortPosts(filtered);
  document.getElementById("resultCount").textContent = `${filtered.length}件`;

  const pageItems = sorted.slice(0, viewState.page * viewState.pageSize);
  listEl.classList.toggle("list-view", viewState.view==="list");
  listEl.innerHTML = pageItems.map(renderCard).join("");
  attachCardEvents();
}

function renderCard(p){
  const favClass = isFav(p.id) ? "active" : "";
  const tags = [...(p.auto_tags||[]), ...(p.select_tags||[])]
    .map(t=>`<span class="chip mini">${t}</span>`).join("");
  const hashes = (p.hashtags||[]).map(h=>`<span class="chip mini hash">#${h}</span>`).join("");
  const date = new Date(p.updated_at);
  return `
  <article class="post-card" data-id="${p.id}">
    <div class="thumb-box"><img src="${p.thumbnail_url}" alt="${p.title}" loading="lazy"></div>
    <div class="post-meta">
      <div class="title-wrap">
        <div class="title">${escapeHtml(p.title)}</div>
        <div class="sub">👤 ${escapeHtml(p.author)} ・ 🗓️ ${date.toLocaleDateString()}</div>
      </div>
      <button class="fav-btn ${favClass}" aria-label="お気に入り">☆ <span>${p.favorite_count}</span></button>
    </div>
    <div class="post-tags">${tags} ${hashes}</div>
    <div class="post-actions">
      <button class="toggle-detail" aria-expanded="false">開く▼</button>
      <button class="find-similar">類似を探す</button>
      <button class="add-compare">比較用に追加</button>
    </div>
    <div class="post-detail" hidden>
      <div class="comment">${escapeHtml(p.comment||"").replaceAll("\n","<br>")}</div>
      <!-- 採用カード（必要になったら遅延描画でOK） -->
    </div>
  </article>`;
}

function attachCardEvents(){
  document.querySelectorAll(".fav-btn").forEach(btn=>{
    btn.onclick = (e)=>{
      const card = e.currentTarget.closest(".post-card");
      toggleFav(card.dataset.id);
      e.currentTarget.classList.toggle("active");
      // TODO: サーバ集計(GAS)にPOST（非同期）
    };
  });

  document.querySelectorAll(".toggle-detail").forEach(btn=>{
    btn.onclick = (e)=>{
      const card = e.currentTarget.closest(".post-card");
      const detail = card.querySelector(".post-detail");
      const expanded = detail.hasAttribute("hidden");
      detail.toggleAttribute("hidden");
      btn.setAttribute("aria-expanded", expanded ? "true" : "false");
      btn.textContent = expanded ? "閉じる▲" : "開く▼";
    };
  });

  document.querySelectorAll(".find-similar").forEach(btn=>{
    btn.onclick = (e)=>{
      const id = e.currentTarget.closest(".post-card").dataset.id;
      openSimilarSheet(id);
    };
  });

  // 今は“比較用に追加”は基準Aとして保持だけ（拡張余地）
  document.querySelectorAll(".add-compare").forEach(btn=>{
    btn.onclick = (e)=>{
      const id = e.currentTarget.closest(".post-card").dataset.id;
      viewState.similarBase = id;
      openSimilarSheet(id);
    };
  });
}

// ---- 類似度（加重Jaccard + ボーナス）----
function weightedJaccard(deckA, deckB){
  const mapA = new Map(deckA.cards.map(c=>[c.cd,c.count]));
  const mapB = new Map(deckB.cards.map(c=>[c.cd,c.count]));
  const set = new Set([...mapA.keys(), ...mapB.keys()]);
  let minSum=0, maxSum=0;
  set.forEach(cd=>{
    const a=mapA.get(cd)||0, b=mapB.get(cd)||0;
    minSum += Math.min(a,b);
    maxSum += Math.max(a,b);
  });
  let sim = maxSum ? (minSum/maxSum) : 0;

  // 代表カード一致 +0.05
  if (deckA.representative_cd && deckA.representative_cd===deckB.representative_cd) sim += 0.05;

  // タグ重複 1個につき+0.01（上限0.05）
  const A = new Set([...(deckA.auto_tags||[]), ...(deckA.select_tags||[])]);
  const B = new Set([...(deckB.auto_tags||[]), ...(deckB.select_tags||[])]);
  let overlap=0; A.forEach(t=>{ if(B.has(t)) overlap++; });
  sim += Math.min(0.05, overlap*0.01);

  return Math.min(1, sim);
}

// ---- 類似検索 → シート結果 ----
function openSimilarSheet(baseId){
  const base = ALL_POSTS.find(p=>p.id===baseId);
  if (!base) return;

  // 類似度計算
  const others = ALL_POSTS
    .filter(p=>p.id!==baseId)
    .map(p=>({post:p, sim: weightedJaccard(base,p)}))
    .sort((a,b)=> b.sim - a.sim)
    .slice(0, 30);

  // 一覧HTML
  const html = `
    <div class="similar-head">基準：<b>${escapeHtml(base.title)}</b></div>
    <ol class="similar-list">
      ${others.map(o=>`
        <li>
          <b>${(o.sim*100).toFixed(1)}%</b> — ${escapeHtml(o.post.title)}
          <button class="to-diff" data-b="${o.post.id}">差分</button>
        </li>`).join("")}
    </ol>
    <div data-tab-panel="diff"></div>
    <div data-tab-panel="deckA" hidden>
      ${renderDeckSimple(base)}
    </div>
    <div data-tab-panel="deckB" hidden id="deckBPanel"></div>
  `;
  showSheet(html);

  // 差分ボタン
  document.querySelectorAll(".to-diff").forEach(btn=>{
    btn.onclick = ()=>{
      const bId = btn.getAttribute("data-b");
      const B = ALL_POSTS.find(p=>p.id===bId);
      renderDiffPanels(base, B);
    };
  });

  // 初期はdiffタブを開いておく
  activateSheetTab("diff");
}

function renderDeckSimple(D){
  return `
    <h4>${escapeHtml(D.title)}</h4>
    <ul class="deck-simple">
      ${D.cards.map(c=>`<li>${c.cd} ×${c.count}</li>`).join("")}
    </ul>
  `;
}

function renderDiffPanels(A,B){
  const mapA = new Map(A.cards.map(c=>[c.cd,c]));
  const mapB = new Map(B.cards.map(c=>[c.cd,c]));
  const cds = new Set([...mapA.keys(), ...mapB.keys()]);
  const same=[], onlyA=[], onlyB=[];
  cds.forEach(cd=>{
    const a=mapA.get(cd)?.count||0, b=mapB.get(cd)?.count||0;
    if (a && b) same.push({cd, a, b});
    else if (a) onlyA.push({cd, a});
    else onlyB.push({cd, b});
  });

  const diffHtml = `
    <h4>一致（${same.length}）</h4>
    <ul>${same.map(x=>`<li>${x.cd}：A×${x.a} / B×${x.b}</li>`).join("")}</ul>
    <h4>Aのみ（${onlyA.length}）</h4>
    <ul>${onlyA.map(x=>`<li>${x.cd}：A×${x.a}</li>`).join("")}</ul>
    <h4>Bのみ（${onlyB.length}）</h4>
    <ul>${onlyB.map(x=>`<li>${x.cd}：B×${x.b}</li>`).join("")}</ul>
  `;
  const deckBHtml = renderDeckSimple(B);

  const sheet = document.getElementById("sheetContent");
  sheet.querySelector('[data-tab-panel="diff"]').innerHTML = diffHtml;
  sheet.querySelector("#deckBPanel").innerHTML = deckBHtml;

  activateSheetTab("diff");
}

function activateSheetTab(tab){
  document.querySelectorAll(".sheet-tabs button").forEach(b=>{
    const active = b.dataset.tab === tab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-tab-panel]").forEach(p=>{
    p.hidden = p.getAttribute("data-tab-panel") !== tab;
  });
}

// ---- シート開閉 ----
function showSheet(innerHtml){
  const s = document.getElementById("compareSheet");
  const c = document.getElementById("sheetContent");
  c.innerHTML = innerHtml;
  s.classList.remove("hidden");
  s.setAttribute("aria-hidden", "false");
}
function closeSheet(){
  const s = document.getElementById("compareSheet");
  s.classList.add("hidden");
  s.setAttribute("aria-hidden", "true");
  document.getElementById("sheetContent").innerHTML = "";
}

// ---- util ----
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[s]);
}
