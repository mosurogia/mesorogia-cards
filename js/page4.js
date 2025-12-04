/* =========================
   DeckPosts 一覧ページ制御（新規）
   - 全体一覧（ページネーション）
   - マイ投稿（全画面・ログイン必須）
========================= */
const DeckPostApp = (() => {
  // 共通定義からベースURLを取得
  const GAS_BASE = window.DECKPOST_API_BASE || window.GAS_API_BASE;

  const state = {
    list: {
      allItems: [],        // ★ 全投稿（一覧タブ用）
      filteredItems: [],   // ★ フィルタ・並び替え後の結果
      items: [],           // ★ 現在ページに表示している10件
      nextOffset: 0,
      loading: false,
      sortKey: 'new',
      currentPage: 1,
      totalPages: 1,
      total: 0,
    },
    // ★ マイ投稿用（ページング）
    mine: {
      items: [],
      loading: false,
      page: 1,
      totalPages: 1,
      total: 0,
    },
    token: '', // ログイン済みなら共通Authから拾う
  };

  // ★ DeckPost 一覧の初期描画が完了したかどうか
  let initialized = false;

// ===== マイ投稿用ステート =====
const postState = {
  mine: {
    page: 1,
    totalPages: 1,
    totalCount: 0,
    pageSize: 10,
    loading: false,
  }
};

// 共通：カードリスト描画（postList と同じ oneCard を流用）
function renderPostListInto(targetId, items){
  const box = document.getElementById(targetId);
  if (!box) return;

  // いったん中身をクリア
  box.replaceChildren();

  // oneCard は HTMLElement を返すので、フラグメント経由で追加
  const frag = document.createDocumentFragment();
  (items || []).forEach(it => {
    const node = oneCard(it);
    if (node) frag.appendChild(node);
  });

  box.appendChild(frag);
}



// マイ投稿: ページャ表示更新
function updateMinePager(page, totalPages, totalCount){
  const info  = document.getElementById('minePageInfo');
  const prev  = document.getElementById('minePagePrev');
  const next  = document.getElementById('minePageNext');
  const count = document.getElementById('resultCountMine');

  if (info)  info.textContent = `${page} / ${Math.max(totalPages, 1)}`;
  if (count) count.textContent = totalCount
    ? `マイ投稿 ${totalCount}件`
    : 'マイ投稿 0件';

  if (prev){
    prev.disabled = (page <= 1);
  }
  if (next){
    next.disabled = (page >= totalPages);
  }
}

  // ===== マイ投稿読み込み（新API版） =====
  async function loadMinePage(page = 1) {
    const listEl    = document.getElementById('myPostList');
    const emptyEl   = document.getElementById('mine-empty');
    const errorEl   = document.getElementById('mine-error');
    const loadingEl = document.getElementById('mine-loading');

    if (!listEl) return;

    const limit  = PAGE_LIMIT;
    const offset = (page - 1) * limit;

    // ローディング表示
    state.mine.loading      = true;
    postState.mine.loading  = true;
    if (loadingEl) loadingEl.style.display = '';
    if (errorEl)   errorEl.style.display   = 'none';
    if (emptyEl)   emptyEl.style.display   = 'none';

    try {
      const res = await apiList({ limit, offset, mine: true });
      console.log('[mine] apiList result:', res);

      // 認証エラーだけは「ログインしてね」表示にする
      if (res && res.error === 'auth required') {
        console.log('[mine] auth required');

        // ★ ステートをクリア
        state.mine.items      = [];
        postState.mine.items  = [];
        state.mine.page       = 1;
        state.mine.totalPages = 1;
        state.mine.total      = 0;

        // ★ 画面上のリストもクリア
        if (listEl) listEl.replaceChildren();

        // ★ 右ペインもクリア
        const paneMine = document.getElementById('postDetailPaneMine');
        if (paneMine) {
          paneMine.innerHTML = `
            <div class="post-detail-empty">
              マイ投稿を表示するにはログインが必要です。
            </div>
          `;
        }

        // メッセージ表示
        if (emptyEl) emptyEl.style.display = 'none';
        if (errorEl) errorEl.style.display = '';

        const msgEl = document.getElementById('mine-error-msg');
        if (msgEl) msgEl.textContent = 'マイ投稿を表示するにはログインが必要です。';

        updateMinePager(0, 1, 0);
        updateMinePagerUI();
        return;
      }


      // （以下は元のまま）
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'list mine failed');
      }

      const items      = res.items || [];
      const total      = Number(res.total || items.length || 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      console.log('[mine] items length:', items.length, 'total:', total);

      state.mine.items      = items;
      state.mine.page       = page;
      state.mine.totalPages = totalPages;
      state.mine.total      = total;

      postState.mine.page       = page;
      postState.mine.totalCount = total;
      postState.mine.items      = items;
      postState.mine.loading    = false;

      renderPostListInto('myPostList', items);

      updateMinePager(page, totalPages, total);
      updateMinePagerUI();

      if (emptyEl) {
        emptyEl.style.display = items.length ? 'none' : '';
      }

      // ★ 右ペイン：件数に応じて初期状態に戻す
      const paneMine = document.getElementById('postDetailPaneMine');
      if (paneMine) {
        if (!items.length) {
          paneMine.innerHTML = `
            <div class="post-detail-empty">
              <div class="post-detail-empty-icon">👈</div>
              <div class="post-detail-empty-text">
                <div class="post-detail-empty-title">デッキ詳細パネル</div>
                <p class="post-detail-empty-main">
                  左の<span class="post-detail-empty-accent">マイ投稿カード</span>をクリックすると、<br>
                  ここにそのデッキの詳細が表示されます。
                </p>
              </div>
            </div>
          `;
        } else if (window.matchMedia('(min-width: 1024px)').matches) {
          const firstCard = document.querySelector('#myPostList .post-card');
          if (firstCard) {
            showDetailPaneForArticle(firstCard);
          }
        }
      }


    } catch (e) {
      console.error('loadMinePage error:', e);
      if (errorEl) {
        errorEl.style.display = '';
      }
    } finally {
      state.mine.loading     = false;
      postState.mine.loading = false;
      if (loadingEl) loadingEl.style.display = 'none';
    }


  }




  // ★ 1ページあたりの件数（UI表示用）
  const PAGE_LIMIT = 10;
  // ★ 一覧データをまとめて取得するときの1リクエスト上限
  const FETCH_LIMIT = 100;

  // ===== 認証トークン関連 =====
  function resolveToken(){
    // DeckPostAuth（正式）優先
    try{
      const raw = localStorage.getItem('DeckPostAuth');
      if (raw){
        const obj = JSON.parse(raw);
        if (obj.token) return obj.token;
      }
    }catch(_){}

    // 古い名前
    try{
      const raw = localStorage.getItem('AuthDeckPost');
      if (raw){
        const obj = JSON.parse(raw);
        if (obj.token) return obj.token;
      }
    }catch(_){}

    // 共通Auth も一応チェック
    try{
      const A = window.Auth;
      if (A?.token) return String(A.token);
    }catch(_){}

    return '';
  }



  // 現在のログインID（ユーザー名）を取得
  function getLoginUsername(){
    try{
      const A = window.Auth || {};
      if (A.user && A.user.username){
        return String(A.user.username);
      }
    }catch(_){}
    try{
      const n = localStorage.getItem('auth_username');
      if (n) return String(n);
    }catch(_){}
    return '';
  }

  // マイ投稿ヘッダーの「現在のログインID」を更新
  function updateMineLoginStatus(){
    const el = document.getElementById('mine-login-username');
    if (!el) return;
    const name = getLoginUsername();
    el.textContent = name || '未ログイン';
  }

  // ===== ログイン状態が変わったときに呼ばれるフック（Auth側から呼ぶ） =====
  function handleAuthChangedForDeckPost(){
    // まずログインID表示だけ更新
    updateMineLoginStatus();

    // ★ トークンを取り直す（Auth.token が変わっている可能性がある）
    state.token = resolveToken();

    // ★ init 完了後なら：
    //    一覧タブ(postList)も「自分のいいね」情報付きで取り直す
    if (initialized) {
      (async () => {
        try {
          await fetchAllList();       // token 付きでもう一度全件取得
          rebuildFilteredItems();     // 並び替えなど再計算
          const cur = state.list.currentPage || 1;
          loadListPage(cur);          // 現在ページを維持したまま再描画
        } catch (e) {
          console.error('handleAuthChangedForDeckPost: reload list failed', e);
        }
      })();
    }

    // 「マイ投稿」ページが表示中なら 1ページ目を読み直す（既存処理）
    const minePage    = document.getElementById('pageMine');
    const mineVisible = minePage && !minePage.hidden;

    if (mineVisible && !state.mine.loading){
      // ★ 未ログインなら auth required → 「ログインが必要です」表示になる
      loadMinePage(1);
    }
  }

  // グローバルに公開（common-page24.js から呼ぶ）
  window.onDeckPostAuthChanged = handleAuthChangedForDeckPost;


// =========================
// JSONP で GAS(doGet) を叩く小さなヘルパー
// =========================
function jsonpRequest(url) {
  return new Promise((resolve, reject) => {
    const cbName =
      '__deckpost_jsonp_' +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2);

    const sep = url.includes('?') ? '&' : '?';
    const script = document.createElement('script');
    script.src = url + sep + 'callback=' + cbName;
    script.async = true;

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      delete window[cbName];
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
      if (timer) clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP timeout'));
    }, 10000);

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP script error'));
    };

    document.body.appendChild(script);
  });
}


// ===== APIラッパ =====
async function apiList({ limit = PAGE_LIMIT, offset = 0, mine = false }) {
  const qs = new URLSearchParams();
  qs.set('mode', 'list');
  qs.set('limit', String(limit));
  qs.set('offset', String(offset));

  // マイ投稿フラグだけ付ける
  if (mine) {
    qs.set('mine', '1');
  }

  // ★ ログインしていれば常に token を付ける（一覧/マイ投稿 共通）
  const tk =
    (window.Auth && window.Auth.token) ||
    state.token ||
    resolveToken();

  if (tk) {
    qs.set('token', tk);
  }

  const url = `${GAS_BASE}?${qs.toString()}`;

  // JSONP で呼び出し
  const res = await jsonpRequest(url);
  return res;
}




    // ===== 一覧全件をまとめて取得（list用） =====
  async function fetchAllList(){
    const limit = FETCH_LIMIT;
    let offset  = 0;
    let all     = [];
    let total   = 0;

    while (true){
      const res = await apiList({ limit, offset, mine: false });
      if (!res?.ok) break;

      const items = res.items || [];
      all.push(...items);

      if (typeof res.total === 'number'){
        total = res.total;
      }

      const nextOffset = (res.nextOffset ?? null);
      if (nextOffset === null || items.length === 0){
        break;
      }
      offset = nextOffset;
    }

    // 何も total が返ってこなかった場合は all.length を優先
    state.list.allItems = all;
    state.list.total    = total || all.length;
  }

  // ===== いいね関連API =====
  /**
   * 指定の投稿IDについて「いいね」状態をトグルします。
   * @param {string} postId
   * @returns {Promise<{ok:boolean, liked?:boolean, likeCount?:number, error?:string}>}
   */
    // ★ いいね送信中フラグ（postIdごと）
  const likePending = {};
  async function apiToggleLike(postId){
    const token = (window.Auth && window.Auth.token) || state.token || resolveToken();
    console.log('[apiToggleLike] token =', token, 'postId =', postId);

    if (!token){
      return { ok:false, error:'auth required' };
    }
    try{
      const res = await fetch(`${GAS_BASE}?mode=toggleLike`, {
        method: 'POST',
        headers: { 'Content-Type':'text/plain;charset=UTF-8' },
        body: JSON.stringify({ token, postId })
      });
      const json = await res.json();
      console.log('[apiToggleLike] response =', json);
      return json;
    }catch(err){
      console.error('[apiToggleLike] network error', err);
      return { ok:false, error:'network' };
    }
  }


  /**
   * UI 用いいねトグルハンドラ。ボタンの表示更新と state の同期を行います。
   * 楽観的更新：
   *   - 押した瞬間に active/カウントを変更
   *   - その裏で API 送信
   *   - 送信中にもう一度押されたらメッセージ表示
   * @param {string} postId
   * @param {HTMLElement} btn
   */
  async function handleToggleLike(postId, btn){
    if (!postId) return;
    if (!btn) return;

    // すでにこの投稿IDで送信中なら連打禁止
    if (likePending[postId]) {
      alert('反映中です、しばらくしてからまたお試しください。');
      return;
    }

    // 現在の状態を state から取得（なければ DOM からでもOK）
    const item = findPostItemById(postId) || {};
    const prevLiked = !!item.liked;
    const prevCount = Number(item.likeCount || 0);

    // 楽観的に次の状態を決める
    const optimisticLiked = !prevLiked;
    const optimisticCount = prevLiked
      ? Math.max(0, prevCount - 1)
      : prevCount + 1;

    // state & DOM をまとめて更新する小さなヘルパー
    const applyLikeState = (liked, likeCount) => {
      const selector = `.post-card[data-postid="${postId}"] .fav-btn`;
      document.querySelectorAll(selector).forEach(el => {
        el.classList.toggle('active', liked);
        el.textContent = `${liked ? '★' : '☆'}${likeCount}`;
      });

      const updateList = (list) => {
        if (Array.isArray(list)){
          list.forEach((it) => {
            if (String(it.postId) === String(postId)){
              it.liked     = liked;
              it.likeCount = likeCount;
            }
          });
        }
      };
      updateList(state.list.allItems);
      updateList(state.list.items);
      updateList(state.list.filteredItems);
      updateList(state.mine.items);
    };

    // ★ ここで楽観的に反映
    applyLikeState(optimisticLiked, optimisticCount);

    // フラグON & ボタン一時無効化
    likePending[postId] = true;
    btn.disabled = true;

    try{
      const res = await apiToggleLike(postId);

      if (!res || !res.ok){
        // 失敗したので元に戻す
        applyLikeState(prevLiked, prevCount);

        const isAuthError = res && res.error === 'auth required';
        const msg = isAuthError
          ? 'いいねするにはログインが必要です。\nマイ投稿タブから新規登録またはログインしてください。'
          : `いいねに失敗しました。\n（エラー: ${res && res.error || 'unknown'}）`;
        alert(msg);
        return;
      }

      // サーバー側の最終状態で上書き（大体は楽観的状態と同じはず）
      const liked     = !!res.liked;
      const likeCount = Number(res.likeCount || 0);
      applyLikeState(liked, likeCount);

    } finally {
      // 送信完了（成功/失敗問わず）
      likePending[postId] = false;
      btn.disabled = false;
    }
  }



  // ===== 画面遷移（一覧↔マイ投稿） =====
  function showList(){
    const listPage = document.getElementById('post-app');  // 一覧側 main
    const minePage = document.getElementById('pageMine');  // マイ投稿側 main
    if (listPage) listPage.hidden = false;
    if (minePage) minePage.hidden = true;

    // 見た目も戻しておくと親切
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // マイ投稿ページ表示
  function showMine(){
    const listPage = document.getElementById('post-app');
    const minePage = document.getElementById('pageMine');
    if (minePage) minePage.hidden = false;
    if (listPage) listPage.hidden = true;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ===== レンダリング =====
  function el(html){
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // ===== タグ／種族まわり =====

  // メイン種族 → 背景色
  const RACE_BG_MAP = {
    'ドラゴン':     'rgba(255, 100, 100, 0.16)',
    'アンドロイド': 'rgba(100, 200, 255, 0.16)',
    'エレメンタル': 'rgba(100, 255, 150, 0.16)',
    'ルミナス':     'rgba(255, 250, 150, 0.16)',
    'シェイド':     'rgba(200, 150, 255, 0.16)',
  };

  // 種族文字列からメイン種族を取得
  function getMainRace(races){
    const s = String(races || '');
    if (!s) return '';
    return s.split(/[,+]/)[0].trim();  // 「シェイド,イノセント…」などを想定
  }

  // 種族に応じた背景色を取得
  function raceBg(races){
    const main = getMainRace(races);
    return RACE_BG_MAP[main] || '';
  }

  // 自動タグ＋選択タグ（上段・ピンク系）
  function tagChipsMain(tagsAuto, tagsPick){
    const s = [tagsAuto, tagsPick].filter(Boolean).join(',');
    if (!s) return '';
    return s.split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => `<span class="chip">${escapeHtml(x)}</span>`)
      .join('');
  }

  // ユーザータグ（下段・青系）
  function tagChipsUser(tagsUser){
    const s = String(tagsUser || '');
    if (!s) return '';
    return s.split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => `<span class="chip">${escapeHtml(x)}</span>`)
      .join('');
  }

  // ===== サムネイル画像 =====
  function cardThumb(src, title){
    const safe = src ? src : 'img/noimage.webp';
    const alt  = title ? escapeHtml(title) : '';
    return `<div class="thumb-box"><img loading="lazy" src="${safe}" alt="${alt}"></div>`;
  }


// ===== デッキ情報の共通ヘルパー =====

// item から { cd: count } 形式のデッキマップを作る
function extractDeckMap(item){
  let deck = null;

  // 1) item.cards（配列）があれば優先
  if (Array.isArray(item.cards) && item.cards.length){
    deck = {};
    for (const c of item.cards){
      const cd = String(c.cd || '').trim();
      if (!cd) continue;
      const n = Number(c.count || 0) || 0;
      if (n <= 0) continue;
      deck[cd] = (deck[cd] || 0) + n;
    }
  }
  // 2) cards が「オブジェクト {cd: count}」のケース
  else if (item.cards && typeof item.cards === 'object'){
    deck = {};
    for (const [cd, nRaw] of Object.entries(item.cards)){
      const key = String(cd || '').trim();
      if (!key) continue;
      const n = Number(nRaw || 0) || 0;
      if (n <= 0) continue;
      deck[key] = (deck[key] || 0) + n;
    }
  }
  // 3) なければ cardsJSON（{cd:count} 文字列）を使う
  else if (item.cardsJSON){
    try{
      const obj = JSON.parse(item.cardsJSON);
      if (obj && typeof obj === 'object'){
        deck = {};
        for (const [cd, nRaw] of Object.entries(obj)){
          const key = String(cd || '').trim();
          if (!key) continue;
          const n = Number(nRaw || 0) || 0;
          if (n <= 0) continue;
          deck[key] = (deck[key] || 0) + n;
        }
      }
    }catch(_){}
  }

  return deck;
}

// 旧神カード（cd が 9xxxx）のカード名を取得する
function getOldGodNameFromItem(item){
  const deck = extractDeckMap(item);
  if (!deck || !Object.keys(deck).length) return '';

  const cardMap = window.cardMap || {};

  // 仕様：デッキには旧神1枚 or 0枚
  for (const cd of Object.keys(deck)){
    const cd5 = String(cd).padStart(5, '0');
    if (cd5[0] === '9'){
      const card = cardMap[cd5] || {};
      return card.name || '';
    }
  }

  return '';
}


// ===== 詳細用：デッキリスト（5列固定） =====
function buildDeckListHtml(item){
  console.log('buildDeckListHtml:', item.postId, item.cardsJSON);

  const deck = extractDeckMap(item);

  if (!deck || !Object.keys(deck).length){
    return `<div class="post-decklist post-decklist-empty">デッキリスト未登録</div>`;
  }

  const entries = Object.entries(deck);
  const cardMap = window.cardMap || {};
  const TYPE_ORDER = { 'チャージャー':0, 'アタッカー':1, 'ブロッカー':2 };

  // page24 の並び方をざっくり踏襲
  entries.sort((a, b) => {
    const A = cardMap[a[0]] || {};
    const B = cardMap[b[0]] || {};
    const tA = TYPE_ORDER[A.type] ?? 99;
    const tB = TYPE_ORDER[B.type] ?? 99;
    if (tA !== tB) return tA - tB;

    const cA = parseInt(A.cost)  || 0;
    const cB = parseInt(B.cost)  || 0;
    if (cA !== cB) return cA - cB;

    const pA = parseInt(A.power) || 0;
    const pB = parseInt(B.power) || 0;
    if (pA !== pB) return pA - pB;

    return String(a[0]).localeCompare(String(b[0]));
  });

const tiles = entries.map(([cd, n]) => {
  const cd5  = String(cd).padStart(5, '0');
  const card = cardMap[cd5] || {};
  const name = card.name || cd5;
  const src  = `img/${cd5}.webp`;
  return `
    <div class="deck-entry">
      <img src="${src}" alt="${escapeHtml(name)}" loading="lazy">
      <div class="count-badge">x${n}</div>
    </div>
  `;
}).join('');

  return `<div class="post-decklist">${tiles}</div>`;
}

// =============================
// 簡易デッキ統計（タイプ構成だけ）
// =============================
function buildSimpleDeckStats(item) {
  // DeckPosts シートに保存している typeMixJSON を使う想定
  // 形式: [Chg枚数, Atk枚数, Blk枚数]
  const raw = item.typeMixJSON || item.typeMixJson || '';

  if (!raw) return null;

  let arr;
  try {
    arr = JSON.parse(raw);
  } catch (e) {
    console.warn('typeMixJSON parse error:', e, raw);
    return null;
  }

  if (!Array.isArray(arr) || arr.length < 3) return null;

  const chg = Number(arr[0] || 0);
  const atk = Number(arr[1] || 0);
  const blk = Number(arr[2] || 0);

  const typeText = `チャージャー ${chg}枚 / アタッカー ${atk}枚 / ブロッカー ${blk}枚`;

  return {
    typeText,
    chg,
    atk,
    blk,
    totalType: chg + atk + blk
  };
}


// ===== 詳細用：カード解説（cardNotes） =====
function buildCardNotesHtml(item){
  const srcList = Array.isArray(item.cardNotes) ? item.cardNotes : [];
  const list = srcList
    .map(r => ({ cd: String(r.cd || ''), text: String(r.text || '') }))
    .filter(r => r.cd || r.text);

  if (!list.length){
    return `<div class="post-cardnotes-empty">投稿者によるカード解説はまだ登録されていません。</div>`;
  }

  const cardMap = window.cardMap || {};

  const rows = list.map(r => {
    const cdRaw = String(r.cd || '').trim();
    const cd5   = cdRaw.padStart(5, '0');   // ★ 必須：5桁化
    const card  = cardMap[cd5] || {};
    const name  = card.name || 'カード名未登録';
    const img   = `img/${cd5}.webp`;

    const textHtml = escapeHtml(r.text || '').replace(/\n/g, '<br>');

    return `
      <div class="post-cardnote">
        <div class="post-cardnote-thumb">
          <img src="${img}"
               alt="${escapeHtml(name)}"
               loading="lazy"
               onerror="this.onerror=null;this.src='img/00000.webp';">
        </div>
        <div class="post-cardnote-body">
          <div class="post-cardnote-title">${escapeHtml(name)}</div>
          <div class="post-cardnote-text">${textHtml}</div>
        </div>
      </div>
    `;
  }).join('');

  return `<div class="post-cardnotes">${rows}</div>`;
}


// ===== 1枚カードレンダリング（PC用） =====
function buildCardPc(item){
  const time     = item.updatedAt || item.createdAt || '';
  const mainRace = getMainRace(item.races);
  const bg       = raceBg(item.races);
  const code     = item.shareCode || '';
  const oldGod   = getOldGodNameFromItem(item) || '';// 旧神名
  const deckNote = item.deckNote || item.comment || '';
  const deckNoteHtml = buildDeckNoteHtml(deckNote);
  const simpleStats = buildSimpleDeckStats(item);// タイプ構成情報
  const typeMixText = simpleStats?.typeText || '';// タイプ構成テキスト

  const tagsMain = tagChipsMain(item.tagsAuto, item.tagsPick);
  const tagsUser = tagChipsUser(item.tagsUser);
  const deckList = buildDeckListHtml(item);
  const cardNotesHtml = buildCardNotesHtml(item);

  const posterXRaw   = (item.posterX || '').trim();
  const posterXLabel = posterXRaw;
  const posterXUser  = posterXRaw.startsWith('@') ? posterXRaw.slice(1) : posterXRaw;

  // ===== いいね関連 =====
  const likeCount = Number(item.likeCount || 0);
  const liked     = !!item.liked;
  const favClass  = liked ? ' active' : '';
  const favSymbol = liked ? '★' : '☆';
  const favText   = `${favSymbol}${likeCount}`;

  // ★ デッキコードコピー用ボタン（PC 詳細内）
  const codeBtnHtml = code ? `
        <div class="post-detail-code-body">
          <button type="button"
            class="btn-copy-code-wide"
            data-code="${escapeHtml(code)}">
            デッキコードをコピー
          </button>
        </div>
  ` : '';

  // カード解説があるかどうか判定
  const hasCardNotes =
    Array.isArray(item.cardNotes) &&
    item.cardNotes.some(r => r && (r.cd || r.text));

  const cardNotesSection = hasCardNotes ? `
        <div class="post-detail-section">
          <div class="post-detail-heading">カード解説</div>
          <div class="post-detail-body post-detail-body--notes">
            ${cardNotesHtml}
          </div>
        </div>
  ` : '';

  return el(`
    <article class="post-card post-card--pc" data-postid="${item.postId}" style="${bg ? `--race-bg:${bg};` : ''}">

      <!-- 上段：代表カード + 情報（SPと同じ構造） -->
      <div class="sp-head">
        <div class="pc-head-left">
          ${cardThumb(item.repImg, item.title)}
        </div>

        <div class="pc-head-right">
          <div class="sp-title">
            ${escapeHtml(item.title || '(無題)')}
          </div>

          <div class="pc-meta">
            <div class="sp-meta-name">
              ${escapeHtml(item.posterName || item.username || '')}
            </div>

            ${posterXUser ? `
              <a class="sp-meta-x"
                 href="https://x.com/${encodeURIComponent(posterXUser)}"
                 target="_blank"
                 rel="noopener noreferrer">
                ${escapeHtml(posterXLabel)}
              </a>
            ` : ''}

            <div class="sp-meta-date">
              ${fmtDate(time)}
            </div>
          </div>

          <!-- いいねボタン -->
          <button class="fav-btn ${favClass}" type="button" aria-label="お気に入り">
            ${favText}
          </button>

          <!-- アクション（比較のみ） -->
          <div class="post-actions pc-actions">
            <button type="button" class="btn-add-compare">比較に追加</button>
          </div>
        </div>
      </div>

      <!-- タグ（ヘッダーの下にまとめて） -->
      <div class="post-tags-wrap">
        <div class="post-tags post-tags-main">${tagsMain}</div>
        <div class="post-tags post-tags-user">${tagsUser}</div>
      </div>

      <!-- 詳細（SPと同じ内容。PC では狭い幅のときだけ使用） -->
      <div class="post-detail" hidden>
        <div class="post-detail-section">
          <div class="post-detail-heading">デッキリスト</div>
          ${deckList}
          ${codeBtnHtml}
        </div>

        <div class="post-detail-row">
          <span>種族：${escapeHtml(mainRace || '')}</span>
        </div>

        <div class="post-detail-row">
          <span>枚数：${item.count || 0}枚</span>
        </div>

        <div class="post-detail-row">
          <span>旧神：${escapeHtml(oldGod || 'なし')}</span>
        </div>

        ${typeMixText ? `
        <div class="post-detail-row">
          <span>タイプ構成：${escapeHtml(typeMixText)}</span>
        </div>
        ` : ''}

        <div class="post-detail-section">
          <div class="post-detail-heading">デッキ解説</div>
          <div class="post-detail-body post-detail-body--decknote">
            ${deckNoteHtml}
          </div>
        </div>

        ${cardNotesSection}

        <div class="post-detail-footer">
          <button type="button" class="btn-detail-close">閉じる</button>
        </div>
      </div>

    </article>
  `);
}


// ===== 1枚カードレンダリング（スマホ用） =====
function buildCardSp(item){
  const time     = item.updatedAt || item.createdAt || '';
  const mainRace = getMainRace(item.races);
  const bg       = raceBg(item.races);
  const oldGod   = getOldGodNameFromItem(item) || '';// 旧神名
  const deckNote = item.deckNote || item.comment || '';
  const deckNoteHtml = buildDeckNoteHtml(deckNote);
  const simpleStats = buildSimpleDeckStats(item);// タイプ構成情報
  const typeMixText = simpleStats?.typeText || '';// タイプ構成テキスト

  const tagsMain = tagChipsMain(item.tagsAuto, item.tagsPick);
  const tagsUser = tagChipsUser(item.tagsUser);
  const deckList = buildDeckListHtml(item);
  const cardNotesHtml = buildCardNotesHtml(item);

  const posterXRaw   = (item.posterX || '').trim();
  const posterXLabel = posterXRaw;
  const posterXUser  = posterXRaw.startsWith('@') ? posterXRaw.slice(1) : posterXRaw;

  // ===== いいね関連 =====
  const likeCount = Number(item.likeCount || 0);
  const liked     = !!item.liked;
  const favClass  = liked ? ' active' : '';
  const favSymbol = liked ? '★' : '☆';
  const favText   = `${favSymbol}${likeCount}`;

  // デッキコード（スマホ用：幅いっぱいボタン）
  const code = item.shareCode || '';
  const codeBtnHtml = code ? `
        <div class="post-detail-code-body">
          <button type="button"
            class="btn-copy-code-wide"
            data-code="${escapeHtml(code)}">
            デッキコードをコピー
          </button>
        </div>
  ` : '';

  // カード解説があるかどうか判定
  const hasCardNotes =
    Array.isArray(item.cardNotes) &&
    item.cardNotes.some(r => r && (r.cd || r.text));

  const cardNotesSection = hasCardNotes ? `
        <div class="post-detail-section">
          <div class="post-detail-heading">カード解説</div>
          <div class="post-detail-body post-detail-body--notes">
            ${cardNotesHtml}
          </div>
        </div>
  ` : '';

  return el(`
    <article class="post-card post-card--sp" data-postid="${item.postId}" style="${bg ? `--race-bg:${bg};` : ''}">

      <!-- 上段：代表カード + 情報 -->
      <div class="sp-head">
        <div class="sp-head-left">
          ${cardThumb(item.repImg, item.title)}
        </div>

        <div class="sp-head-right">
          <div class="sp-title">
            ${escapeHtml(item.title || '(無題)')}
          </div>

          <div class="sp-meta">
            <div class="sp-meta-name">
              ${escapeHtml(item.posterName || item.username || '')}
            </div>

            ${posterXUser ? `
              <a class="sp-meta-x"
                href="https://x.com/${encodeURIComponent(posterXUser)}"
                target="_blank"
                rel="noopener noreferrer">
                ${escapeHtml(posterXLabel)}
              </a>
            ` : ''}

            <div class="sp-meta-date">
              ${fmtDate(time)}
            </div>
          </div>

          <button class="fav-btn ${favClass}" type="button" aria-label="お気に入り">
            ${favText}
          </button>
        </div>
      </div>

      <!-- タグ（ヘッダーの下にまとめて） -->
      <div class="post-tags-wrap">
        <div class="post-tags post-tags-main">${tagsMain}</div>
        <div class="post-tags post-tags-user">${tagsUser}</div>
      </div>

      <!-- アクション -->
      <div class="post-actions sp-actions">
        <button type="button" class="btn-detail">詳細</button>
        <button type="button" class="btn-add-compare">比較に追加</button>
      </div>

      <!-- 詳細（折りたたみ） -->
      <div class="post-detail" hidden>
        <div class="post-detail-section">
          <div class="post-detail-heading">デッキリスト</div>
          ${deckList}
          ${codeBtnHtml}
        </div>

        <div class="post-detail-row">
          <span>種族：${escapeHtml(mainRace || '')}</span>
        </div>

        <div class="post-detail-row">
          <span>枚数：${item.count || 0}枚</span>
        </div>

        <div class="post-detail-row">
          <span>旧神：${escapeHtml(oldGod || 'なし')}</span>
        </div>

        ${typeMixText ? `
        <div class="post-detail-row">
          <span>タイプ構成：${escapeHtml(typeMixText)}</span>
        </div>
        ` : ''}

        <div class="post-detail-section">
          <div class="post-detail-heading">デッキ解説</div>
          <div class="post-detail-body post-detail-body--decknote">
            ${deckNoteHtml}
          </div>
        </div>

        ${cardNotesSection}

        <div class="post-detail-footer">
          <button type="button" class="btn-detail-close">閉じる</button>
        </div>
      </div>

    </article>
  `);
}



// ===== 1枚カードレンダリング（PC/SP切り替え） =====
function oneCard(item){
  const isSp = window.matchMedia('(max-width: 768px)').matches;
  return isSp ? buildCardSp(item) : buildCardPc(item);
}

  // 一覧レンダリング
  function renderList(items, targetId){
    const wrap = document.getElementById(targetId);
    if (!wrap) return;
    const frag = document.createDocumentFragment();
    for (const it of items) frag.appendChild(oneCard(it));
    wrap.appendChild(frag);
  }

  // ===== デッキ解説用HTML生成 =====
  function buildDeckNoteHtml(deckNote){
    const raw = String(deckNote || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return '';

    const lines = raw.split('\n');
    const sections = [];
    let current = null;

    for (const line of lines){
      const m = line.match(/^【(.+?)】/); // 行頭の【見出し】を検出
      if (m){
        if (current) sections.push(current);
        current = { title: m[1].trim(), body: [] };
      } else {
        if (!current) current = { title: '', body: [] }; // 見出し前のフリーテキスト
        current.body.push(line);
      }
    }
    if (current) sections.push(current);

    // 見出し付きセクションが無ければ、従来どおり改行だけ反映
    const hasTitled = sections.some(s => s.title);
    if (!hasTitled){
      return escapeHtml(raw).replace(/\n/g, '<br>');
    }

    const blocks = sections.map(sec => {
      const bodyText = sec.body.join('\n').trim();
      const bodyHtml = escapeHtml(bodyText).replace(/\n/g, '<br>');
      const titleHtml = sec.title
        ? `<div class="decknote-heading">${escapeHtml(sec.title)}</div>`
        : '';
      return `
        <section class="decknote-block">
          ${titleHtml}
          <div class="decknote-body">${bodyHtml}</div>
        </section>
      `;
    }).join('');

    return `<div class="post-decknote">${blocks}</div>`;
  }

  // ===== 右ペイン：詳細パネル描画（タブ構造＋右側に常時デッキリスト） =====
  function renderDetailPaneForItem(item, paneId){
    const pane = document.getElementById(paneId || 'postDetailPane');
    if (!pane || !item) return;

    const time       = item.updatedAt || item.createdAt || '';
    const mainRace   = getMainRace(item.races);
    const oldGod     = getOldGodNameFromItem(item) || 'なし';
    const code       = item.shareCode || '';
    const repImg     = item.repImg || '';
    const deckNote   = item.deckNote || item.comment || '';
    const bg         = raceBg(item.races);

    // タグ
    const tagsMain = tagChipsMain(item.tagsAuto, item.tagsPick);
    const tagsUser = tagChipsUser(item.tagsUser);

    // 投稿者Xリンク生成
    const posterXRaw  = (item.posterX || '').trim();
    const posterXUser = posterXRaw.startsWith('@') ? posterXRaw.slice(1) : posterXRaw;
    const posterXHtml = posterXUser ? `
      <a class="meta-x"
        href="https://x.com/${encodeURIComponent(posterXUser)}"
        target="_blank"
        rel="noopener noreferrer">
        ${escapeHtml(posterXRaw)}
      </a>
    ` : '';

    // デッキリストHTML
    const deckListHtml = buildDeckListHtml(item);

    // デッキ解説HTML
    const deckNoteHtml = buildDeckNoteHtml(deckNote);

    // カード解説HTML
    const cardNotesHtml = buildCardNotesHtml(item);

    // ★ 簡易デッキ統計（タイプ構成だけ）
    const simpleStats = buildSimpleDeckStats(item);
    const typeMixText = simpleStats?.typeText || '';

        // デッキコードコピー ボタン（あれば）
    const codeBtnHtml = code ? `
      <div class="post-detail-code-body">
        <button type="button"
          class="btn-copy-code-wide"
          data-code="${escapeHtml(code)}">
          デッキコードをコピー
        </button>
      </div>
    ` : '';


    // ============================
    // ① デッキ情報パネル
    // ============================
    const tabInfo = `
      <div class="post-detail-panel is-active" data-panel="info">

        <div class="post-detail-main">
          <!-- 左：代表カード -->
          <div class="post-detail-main-left">
            ${repImg ? `
              <img src="${repImg}"
                  class="post-detail-repimg"
                  alt="${escapeHtml(item.title || '')}"
                  loading="lazy">
            ` : `
              <div style="width:100%;aspect-ratio:424/532;background:#eee;border-radius:10px;"></div>
            `}
          </div>

          <!-- 右：デッキ名＋投稿者 -->
          <div class="post-detail-main-right">
            <header class="post-detail-header">
              <h2 class="post-detail-title">
                ${escapeHtml(item.title || '(無題)')}
              </h2>

              <div class="post-detail-meta">
                <span>${escapeHtml(item.posterName || item.username || '')}</span>
                ${posterXHtml ? `<span>/ ${posterXHtml}</span>` : ''}
                ${fmtDate(time) ? `<span>/ ${fmtDate(time)}</span>` : ''}
              </div>

              <div class="post-detail-actions">
                <button type="button" class="btn-add-compare">比較に追加</button>
              </div>
            </header>
          </div>

            <div class="post-detail-summary">
              <dt>デッキ枚数</dt><dd>${item.count || 0}枚</dd>
              <dt>種族</dt><dd>${escapeHtml(mainRace || '')}</dd>
              <dt>旧神</dt><dd>${escapeHtml(oldGod || 'なし')}</dd>
              ${typeMixText
                ? `<dt>タイプ構成</dt><dd>${escapeHtml(typeMixText)}</dd>`
                : ''
              }
            </div>

            <div class="post-detail-tags">
              <div class="post-tags post-tags-main">${tagsMain}</div>
              <div class="post-tags post-tags-user">${tagsUser}</div>
            </div>

            <div class="post-detail-beta-note beta-note">
              ※ レアリティ構成・コスト分布などの詳細な分析も準備中です。<br>
              　 ベータ版では準備中です。
            </div>

        </div>
      </div>
    `;

    // ============================
    // ② デッキ解説パネル
    // ============================
    const tabNote = `
      <div class="post-detail-panel" data-panel="note">
        <div class="post-detail-section">
          <div class="post-detail-heading">デッキ解説</div>
          <div class="post-detail-body">
            ${deckNoteHtml || '<div style="color:#777;font-size:.9rem;">まだ登録されていません。</div>'}
          </div>
        </div>
      </div>
    `;

    // ============================
    // ③ カード解説パネル
    // ============================
    const tabCards = `
      <div class="post-detail-panel" data-panel="cards">
        <div class="post-detail-section">
          <div class="post-detail-heading">カード解説</div>
          <div class="post-detail-body">
            ${cardNotesHtml}
          </div>
        </div>
      </div>
    `;

    // ============================
    // ④ タブバー（※ デッキリストタブは削除）
    // ============================
    const tabsHtml = `
      <div class="post-detail-tabs">
        <button type="button" class="post-detail-tab is-active" data-tab="info">📘 デッキ情報</button>
        <button type="button" class="post-detail-tab" data-tab="note">📝 デッキ解説</button>
        <button type="button" class="post-detail-tab" data-tab="cards">🗂 カード解説</button>
      </div>
    `;

    // ============================
    // ⑤ 全体組み立て（左：タブ／右：デッキリスト）
    // ============================
    pane.innerHTML = `
      <div class="post-detail-inner" data-postid="${item.postId}" style="${bg ? `--race-bg:${bg};` : ''}">
        <!-- 左カラム：タブ＋各パネル -->
        <div class="post-detail-maincol">
          ${tabsHtml}
          <div class="post-detail-body">
            ${tabInfo}
            ${tabNote}
            ${tabCards}
          </div>
        </div>

        <!-- 右カラム：常時表示のデッキリスト＋デッキコードコピー -->
        <aside class="post-detail-deckcol">
          <div class="post-detail-section">
            <div class="post-detail-heading">デッキリスト</div>
            ${deckListHtml}
            ${codeBtnHtml}
          </div>
        </aside>
      </div>
    `;

   // 右ペイン内の「比較に追加」だけ個別処理したい場合
    const root = pane.querySelector('.post-detail-inner');
    if (root) {
      const compareBtn = root.querySelector(
        '.post-detail-panel[data-panel="info"] .btn-add-compare'
      );
      if (compareBtn) {
        compareBtn.addEventListener('click', (ev) => {
          ev.stopPropagation(); // カードクリック扱いにならないよう一応止める
          alert('比較タブに追加する機能はベータ版では準備中です。');
        });
      }
    }

  }



// カードクリック → 右ペインに反映（PCのみ）
function showDetailPaneForArticle(art){
  if (!art) return;
  const postId = art.dataset.postid;
  if (!postId) return;
  const item = findPostItemById(postId);
  if (!item) return;

  // ★ このカードが pageMine 内かどうかでペインを出し分け
  const inMine = !!art.closest('#pageMine');
  const paneId = inMine ? 'postDetailPaneMine' : 'postDetailPane';

  renderDetailPaneForItem(item, paneId);

  // 選択中のカードにマーク（全体から一旦外して OK ならこのまま）
  document.querySelectorAll('.post-card.is-active').forEach(el => {
    el.classList.remove('is-active');
  });
  art.classList.add('is-active');
}

// ===== 右ペイン：タブ切り替え（一覧 / マイ投稿 共通） =====
function setupDetailTabs(){
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.post-detail-tab');
    if (!tab) return;

    const root = tab.closest('.post-detail-inner');
    if (!root) return;

    const key = tab.dataset.tab;
    if (!key) return;

    // タブの見た目切り替え
    root.querySelectorAll('.post-detail-tab').forEach(btn => {
      btn.classList.toggle('is-active', btn === tab);
    });

    // パネルの表示切り替え
    root.querySelectorAll('.post-detail-panel').forEach(panel => {
      panel.classList.toggle('is-active', panel.dataset.panel === key);
    });
  });
}

  // ===== デッキコードコピー（共通ボタン） =====
  function showCodeCopyToast(){
    let toast = document.getElementById('code-copy-toast');
    if (!toast){
      toast = document.createElement('div');
      toast.id = 'code-copy-toast';
      toast.textContent = 'デッキコードをコピーしました';
      document.body.appendChild(toast);
    }
    toast.classList.add('is-visible');
    if (toast._timer){
      clearTimeout(toast._timer);
    }
    toast._timer = setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 1600);
  }

  function setupCodeCopyButtons(){
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-copy-code-wide');
      if (!btn) return;

      const code = btn.dataset.code || '';
      if (!code) return;

      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(code)
          .then(() => {
            showCodeCopyToast();
          })
          .catch(() => {
            // 失敗しても何もしない（必要なら alert など）
          });
      }
    });
  }


  // ===== 小物 =====
  function fmtDate(v){
    if (!v) return '';
    try{
      const d = new Date(v);
      const y = d.getFullYear(),
            m = (d.getMonth()+1).toString().padStart(2,'0'),
            da = d.getDate().toString().padStart(2,'0');
      return `${y}/${m}/${da}`;
    }catch(_){ return ''; }
  }

  // HTMLエスケープ
  function escapeHtml(s){
    return String(s||'')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

// ===== イベント配線 =====
function wireCardEvents(root){
  root.addEventListener('click', (e) => {
    // 0) いいねボタンを先に処理
    const favBtn = e.target.closest('.fav-btn');
    if (favBtn) {
      const art = favBtn.closest('.post-card');
      if (art) {
        const postId = art.dataset.postid;
        if (postId) {
          handleToggleLike(postId, favBtn);
        }
      }
      // 他のハンドラには進まず終了
      return;
    }

    const art = e.target.closest('.post-card');
    if (!art) return;

    const isPcWide = window.matchMedia('(min-width: 1024px)').matches;

    // 1) まずはボタン類を個別処理 ==================

    // 旧・詳細ボタン（念のため残しておく）
    if (e.target.classList.contains('btn-detail')){
      if (isPcWide){
        showDetailPaneForArticle(art);
      } else {
        const d = art.querySelector('.post-detail');
        if (d) d.hidden = !d.hidden;
      }
      return;
    }

    // 詳細内「閉じる」
    if (e.target.classList.contains('btn-detail-close')){
      const d = art.querySelector('.post-detail');
      if (d) d.hidden = true;
      art.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    // 比較に追加
    if (e.target.classList.contains('btn-add-compare')){
      alert('比較タブに追加する機能はベータ版では準備中です。');
      return;
    }

    // IDコピー（旧仕様）
    if (e.target.classList.contains('btn-copyid')){
      const id = art.dataset.postid || '';
      if (id && navigator.clipboard){
        navigator.clipboard.writeText(id).catch(()=>{});
      }
      return;
    }

    // 2) 詳細エリア内をクリックしたときは何もしない
    if (e.target.closest('.post-detail')){
      return;
    }

    // 3) 上記以外 → カード全体クリックとして詳細を開く ============

    if (isPcWide){
      // PC(1024px以上)：右ペインに詳細表示
      showDetailPaneForArticle(art);
    } else {
      // スマホ／タブレット：カード内の詳細ブロックを開閉
      const d = art.querySelector('.post-detail');
      if (d) d.hidden = !d.hidden;
    }
  });
}



  // 指定 postId の投稿オブジェクトを state から探す
  function findPostItemById(postId){
    const id = String(postId);
    const pick = (arr) => (arr || []).find(it => String(it.postId) === id);
    return pick(state.list.items) || pick(state.mine.items) || null;
  }

  // スマホ版：代表カード長押しでデッキリスト簡易表示
  function setupDeckPeekOnSp(){
    const isSp = () => window.matchMedia('(max-width: 768px)').matches;

    function ensureOverlay(){
      let pane = document.getElementById('post-deckpeek-overlay');
      if (!pane){
        pane = document.createElement('div');
        pane.id = 'post-deckpeek-overlay';
        pane.innerHTML = `
          <div class="post-deckpeek-inner">
            <div class="post-deckpeek-body"></div>
          </div>
        `;
        document.body.appendChild(pane);
      }
      return pane;
    }

    function hideOverlay(){
      const pane = document.getElementById('post-deckpeek-overlay');
      if (pane){
        pane.style.display = 'none';
      }
    }

    // ★ 代表カードの「右横」に出すように座標計算
    function showForArticle(art, thumbEl){
      if (!isSp()) return;
      if (!art) return;

      const postId = art.dataset.postid;
      if (!postId) return;

      const item = findPostItemById(postId);
      if (!item) return;

      const html = buildDeckListHtml(item);

      const pane  = ensureOverlay();
      const body  = pane.querySelector('.post-deckpeek-body');
      if (!body) return;

      body.innerHTML = html;

      // 一旦表示してサイズを取る
      pane.style.display = 'block';
      pane.style.width   = '';     // 一度リセット
      pane.style.right   = 'auto';
      pane.style.bottom  = 'auto';

      // 幅は画面の 70% までにして、代表カード横に収まるように
      const maxW = Math.min(window.innerWidth * 0.7, 460);
      pane.style.width = maxW + 'px';

      if (thumbEl){
        const r = thumbEl.getBoundingClientRect();
        const margin = 8;

        const paneW = pane.offsetWidth;
        const paneH = pane.offsetHeight;

        // 基本位置：代表カードの右横
        let left = r.right + margin;
        let top  = r.top;

        // 右にはみ出す場合は左にずらす
        if (left + paneW > window.innerWidth - margin){
          left = window.innerWidth - margin - paneW;
          if (left < margin) left = margin;
        }

        // 下にはみ出す場合は上にずらす
        if (top + paneH > window.innerHeight - margin){
          top = window.innerHeight - margin - paneH;
          if (top < margin) top = margin;
        }

        pane.style.left = left + 'px';
        pane.style.top  = top  + 'px';
      }
    }

    const root = document.getElementById('postList');
    if (!root) return;

    let pressing = false;

    const startHandler = (e) => {
      if (!isSp()) return;

      // 代表カード部分（thumb-box）だけ反応させる
      const thumb = e.target.closest('.thumb-box');
      if (!thumb) return;

      const art = thumb.closest('.post-card.post-card--sp');
      if (!art) return;

      pressing = true;
      showForArticle(art, thumb);
    };

    const endHandler = () => {
      if (!pressing) return;
      pressing = false;
      hideOverlay();
    };

    // PointerEvent 優先
    if (window.PointerEvent){
      root.addEventListener('pointerdown', startHandler);
      window.addEventListener('pointerup', endHandler);
      window.addEventListener('pointercancel', endHandler);
    } else {
      // 古い環境向けフォールバック
      root.addEventListener('touchstart', startHandler, { passive: true });
      window.addEventListener('touchend', endHandler);
      window.addEventListener('touchcancel', endHandler);
    }

    // スクロールや画面タップでも閉じる
    window.addEventListener('scroll', hideOverlay, { passive: true });
    document.addEventListener('click', (e) => {
      const pane = document.getElementById('post-deckpeek-overlay');
      if (!pane || pane.style.display === 'none') return;
      if (e.target.closest('#post-deckpeek-overlay')) return; // オーバーレイ内クリックは無視
      hideOverlay();
    });
  }

    // ===== 並び替え（投稿日ベース） =====
  function getPostTime(item){
    const v = item.updatedAt || item.createdAt || '';
    if (!v) return 0;
    const t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }



  // ===== 並び替え実装 =====
  function sortItems(items, sortKey){
    const arr = [...items];

    arr.sort((a, b) => {
      if (sortKey === 'like') {
        const la = Number(a.likeCount || 0);
        const lb = Number(b.likeCount || 0);

        // いいねの多い順（降順）
        if (lb !== la) return lb - la;

        // 同じなら投稿日の新しい方を上に
        const ta = getPostTime(a);
        const tb = getPostTime(b);
        return tb - ta;
      }

      // ===== 既存：新しい順 / 古い順 =====
      const ta = getPostTime(a);
      const tb = getPostTime(b);

      if (sortKey === 'old') {
        return ta - tb; // 古い順
      } else {
        return tb - ta; // 新しい順
      }
    });

    return arr;
  }


    // ===== 一覧：フィルタ＆ソート結果を作り直す =====
  function rebuildFilteredItems(){
    const base    = state.list.allItems || [];
    const sortKey = state.list.sortKey || 'new';

    // ★ 将来ここでフィルタ処理を挟む：
    // let filtered = base.filter(...条件...);
    let filtered = base.slice();

    // 並び替え
    filtered = sortItems(filtered, sortKey);

    state.list.filteredItems = filtered;

    const total = filtered.length;
    state.list.total      = total;
    state.list.totalPages = Math.max(1, Math.ceil(Math.max(total, 1) / PAGE_LIMIT));
  }


    // ===== 一覧用：ページャUI更新 =====
  function updatePagerUI(){
    const page  = state.list.currentPage || 1;
    const total = state.list.totalPages  || 1;

    const prev = document.getElementById('pagePrev');
    const next = document.getElementById('pageNext');
    const info = document.getElementById('pageInfo');

    if (info){
      info.textContent = `${page} / ${total}`;
    }
    if (prev){
      prev.disabled = (page <= 1);
    }
    if (next){
      next.disabled = (page >= total);
    }
  }

  // ===== マイ投稿：件数＆ページャUI更新 =====
  function updateMinePagerUI() {
    const countLabel = document.getElementById('resultCountMine');
    const info       = document.getElementById('minePageInfo');
    const prevBtn    = document.getElementById('minePagePrev');
    const nextBtn    = document.getElementById('minePageNext');

    const page       = state.mine.page       || 1;
    const total      = state.mine.total      || 0;
    const totalPages = state.mine.totalPages || 1;
    const isLoading  = !!state.mine.loading;

    if (countLabel) {
      countLabel.textContent = `マイ投稿 ${total}件`;
    }
    if (info) {
      info.textContent = `${page} / ${totalPages}`;
    }
    if (prevBtn) {
      prevBtn.disabled = isLoading || page <= 1;
    }
    if (nextBtn) {
      nextBtn.disabled = isLoading || page >= totalPages;
    }
  }



  // 並び替え変更時：全件からフィルタ＆ソートし直して1ページ目を描画
  function applySortAndRerenderList(){
    if (!state.list.allItems || !state.list.allItems.length){
      return;
    }
    rebuildFilteredItems();
    loadListPage(1);
  }


  // ===== 一覧用：指定ページを描画（クライアント側ページング） =====
  function loadListPage(page){
    const listEl = document.getElementById('postList');
    if (!listEl) return;

    const filtered = state.list.filteredItems || [];
    const total    = state.list.total || filtered.length || 0;

    // ページ数を再確認（外から直接呼んだ場合の保険）
    const totalPages = total > 0 ? Math.max(1, Math.ceil(total / PAGE_LIMIT)) : 1;
    state.list.totalPages = totalPages;

    const p = Math.min(Math.max(page, 1), totalPages);
    state.list.currentPage = p;

    const start = (p - 1) * PAGE_LIMIT;
    const end   = start + PAGE_LIMIT;
    const pageItems = filtered.slice(start, end);

    state.list.items = pageItems;

    listEl.replaceChildren();
    renderList(pageItems, 'postList');

    // 件数表示
    const infoEl = document.getElementById('resultCount');
    if (infoEl){
      infoEl.textContent = `投稿：${total}件`;
    }

    // ページャUI更新
    updatePagerUI();
  }


  // ===== 一覧ロード（互換用: 「次のページ」扱い） =====
  function loadMoreList(){
    const page  = state.list.currentPage || 1;
    const total = state.list.totalPages  || 1;
    if (page >= total) return;
    loadListPage(page + 1);
  }



  // ===== 初期化 =====
  async function init(){
    // ① カードマスタ読み込み（デッキリスト・カード解説で使う）
    try {
      await ensureCardMapLoaded();
      console.log('cardMap loaded, size =', Object.keys(window.cardMap || {}).length);
    } catch (e) {
      console.error('カードマスタ読み込みに失敗しました', e);
    }

    // ② トークン
    state.token = resolveToken();

    // ログイン状態初期反映（ID表示だけ & マイ投稿表示中なら読み込み）
    handleAuthChangedForDeckPost();

    // ③ 並び替えセレクト（先に sortKey を決めておく）
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect){
      state.list.sortKey = sortSelect.value || 'new';
      sortSelect.addEventListener('change', () => {
        state.list.sortKey = sortSelect.value || 'new';
        applySortAndRerenderList();
      });
    }

    // ④ 一覧データをすべて取得 → 初期描画
    await fetchAllList();
    rebuildFilteredItems();
    loadListPage(1);

    // ⑤ 一覧側：ページャボタン
    document.getElementById('pagePrev')?.addEventListener('click', () => {
      const page = state.list.currentPage || 1;
      if (page > 1){
        loadListPage(page - 1);
      }
    });
    document.getElementById('pageNext')?.addEventListener('click', () => {
      const page  = state.list.currentPage || 1;
      const total = state.list.totalPages  || 1;
      if (page < total){
        loadListPage(page + 1);
      }
    });

    // ⑥ フィルターボタンはまだプレースホルダ

    document.getElementById('filterBtn')?.addEventListener('click', () => {
      alert('フィルタ機能はベータ版では準備中です。');
    });


    // ⑤ マイ投稿へ（ツールバーのボタン）
    document.getElementById('toMineBtn')?.addEventListener('click', async () => {
      showMine();
      updateMineLoginStatus();     // ログインID表示更新
      await loadMinePage(1);       // 1ページ目を取得
    });

    // ⑥ マイ投稿：戻る
    document.getElementById('backToListBtn')?.addEventListener('click', showList);

    // ⑦ マイ投稿：ページャ（前へ / 次へ）
    document.getElementById('minePagePrev')?.addEventListener('click', () => {
      const p = state.mine.page || 1;
      if (p > 1){
        loadMinePage(p - 1);
      }
    });

    document.getElementById('minePageNext')?.addEventListener('click', () => {
      const p     = state.mine.page       || 1;
      const total = state.mine.totalPages || 1;
      if (p < total){
        loadMinePage(p + 1);
      }
    });


    // ⑦ デリゲートイベント
    wireCardEvents(document);

    // デッキコードコピー ボタン（PC右ペイン／SP共通）
    setupCodeCopyButtons();

    // ⑧ 右ペイン詳細タブ
    setupDetailTabs();


    // ⑩ スマホ版：代表カード長押しでデッキリスト簡易表示
    setupDeckPeekOnSp();

    // ★ 初期描画完了フラグ
    initialized = true;
  }

  // DOMReady
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init };
})();


