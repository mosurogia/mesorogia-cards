/* ============================================================================
 * js/pages/deckmaker/mulligan.js
 * 🆕 マリガン練習（DeckMaker 専用 / page-only）
 *
 * 【目的】
 * - 現在のデッキ（window.deck）を母集団として、初期手札4枚→マリガン結果を疑似体験する。
 * - 「残り山札のタイプ枚数」と「マリガン後の手札タイプ構成の確率上位」を即座に表示し、
 *   デッキの初動安定度を体感で確認できるようにする。
 *
 * 【UI仕様（ざっくり）】
 * - 手札（4枚固定）：クリックで「マリガン対象 selected」をトグル
 * - ボタン（単一）：
 *   - 選択0枚 → 「手札リセット」（デッキから4枚引き直し）
 *   - 選択1〜4枚 → 「n枚マリガンする」（手札の selected 枠だけ差し替え）
 * - 残り山札（タイプ別）：常に “手札4枚を除いた山” を集計して表示
 * - 確率表示：
 *   - 初期状態：初期手札パターン（4枚タイプ構成）の確率上位 OUTCOME_LIMIT 件
 *   - マリガン時：引き直し枚数 k に対して、山札（手札除外）からの超幾何分布で計算
 *   - 「もっと見る」：上位 OUTCOME_LIMIT 件 ⇄ 全件 をトグル
 *
 * 【データの前提 / 依存（存在すれば使う）】
 * - window.deck : { cd: count }（デッキ内容。DeckMaker 側が管理）
 * - window.cardMap / window.allCardsMap : cd→カード情報（type, name など）
 *   - type は 'チャージャー' / 'アタッカー' / 'ブロッカー' を想定
 * - 画像パス：img/{cd}.webp（無ければフォールバック表示）
 *
 * 【このファイルが “やらないこと”】【設計メモ】
 * - デッキ編集（追加/削除/枚数変更）は担当しない（deck.js 側）
 * - タブUIや画面レイアウト生成は担当しない（HTML/CSS側）
 * - 既存の共通ロジックに強依存しないよう、参照は window.* を「存在すれば使う」方針
 *   → 他ページで読み込まれても、#mulligan-trainer が無ければ何もしない（安全化）
 *
 * 【イベント/同期】
 * - デッキ内容が変わった可能性があるタイミングで dealInitialHand() を呼び直すために、
 *   window.renderDeckList / window.updateDeckAnalysis / window.updateDeckSummaryDisplay を “1回だけ” フックする。
 * - ローダー構成に対応：window.onDeckmakerReady があればそれに乗る。無ければ DOMContentLoaded で起動。
 *
 * 【注意】
 * - 本処理は「練習用の疑似抽選」です（ゲーム内の完全再現を目的にしない）。
 * - comb() は小規模（n<=40程度）想定のため、巨大デッキを前提に最適化はしていない。
 * ============================================================================ */
(function () {
'use strict';

// エントリポイント：DOM取得→不足UI生成→状態初期化→イベント配線→初回deal
function bootMulliganTrainer(){
    const HAND_SIZE = 4;
    const OUTCOME_LIMIT = 5;

    // 例①〜例⑳（それ以上は例21みたいに数字で）
    function formatExampleLabel_(n){
    const circled = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩',
            '⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
    return '例' + (circled[n-1] || String(n));
    }

    // 手札タイプスロットの初期値取得（現在の手札並びをテンプレにする）
    function getInitialHandTypeSlots(){
    const map = window.cardMap || window.allCardsMap || {};
    // 今の state.hand の並び（= 画面の並び）をテンプレにする
    return state.hand.map(h => map[String(h.cd)]?.type || '');
    }

    // 要素取得
    const els = {
    trainer:   document.getElementById('mulligan-trainer'),
    warning:   document.getElementById('mull-warning'),
    hand:      document.getElementById('mull-hand'),
    btn:       document.getElementById('btn-mull-or-reset'),
    remainList:document.getElementById('mull-remaining-by-type'),
    outcomeBox: document.getElementById('mull-outcome-probs'),
    };

    if (!els.trainer) return; // 他ページ安全化

    // 「確率表示」箱が無ければ生成（残り山札の下に入れる）
    if (!els.outcomeBox) {
    const host = els.remainList?.closest?.('.mull-remaining') || els.trainer;
    const box = document.createElement('div');
    box.id = 'mull-outcome-probs';
    box.className = 'mull-outcome';
    host.appendChild(box);
    els.outcomeBox = box;
    }


    // 共有（common.js）
    const getDeckObject = () => (window.deck || {});
    const getCardInfo   = (cd) => (window.cardMap?.[String(cd)] || window.allCardsMap?.[String(cd)]);

    // 状態
    const state = {
    pool: [],  // 山札（手札４枚以外のデッキリスト）
    hand: [],  // { cd, selected }
    outcomeExpanded: false, // 確率表示の展開状態
    outcomeMode: '',
    };

    // 「もっと見る」/「閉じる」
    document.addEventListener('click', (e) => {
    const btn = e.target.closest('.mull-outcome-more');
    if (!btn) return;
    state.outcomeExpanded = !state.outcomeExpanded;
    refreshUI(); // 再描画（rowsは軽いので再計算でOK）
    });

    // cd→枚数 のMapを作る
    function buildDeckCountMap(){
    const deckObj = getDeckObject();
    const map = {};
    for (const cd in deckObj) map[String(cd)] = (deckObj[cd]|0);
    return map;
    }


    // countMap を実カード配列に展開
    function expandFromCountMap(counts){
    const arr = [];
    for (const cd in counts) {
    for (let i=0;i<(counts[cd]|0);i++) arr.push(String(cd));
    }
    return arr;
    }
    // 「現在の手札4枚を除いた山」を作る
    function buildPoolExcludingCurrentHand(){
    const counts = buildDeckCountMap();
    // 手札分を引いて除外（同名が複数あればその枚数ぶん引く）
    state.hand.forEach(h => {
    const cd = String(h.cd);
    if (counts[cd] > 0) counts[cd]--;
    });
    return shuffleInPlace(expandFromCountMap(counts));
    }

    // シャッフル＆1枚引く
    function shuffleInPlace(arr){
    for (let i=arr.length-1; i>0; i--){
    const j = (Math.random()* (i+1))|0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
    }
    function drawOne(){
    // state.pool から1枚引く
    if (!state.pool.length) return null;
    return state.pool.pop();
    }

    // 初期配り（※毎回の「手札リセット」でdiscardedはリセット）
    function dealInitialHand(){
    ensureMullHandChips();// chips確保
    // 初期はデッキ全体から引く
    state.pool = shuffleInPlace(expandFromCountMap(buildDeckCountMap()));
    state.hand = [];

    for (let i=0; i<HAND_SIZE; i++){
    const cd = drawOne();
    if (!cd) break;
    state.hand.push({ cd, selected:false });
    }
    renderHand();
    refreshUI();
    }

    // 手札描画
    function ensureMullHandChips(){
    const layout = els.trainer?.querySelector?.('.mull-layout');
    if (!layout) return null;

    let chips = layout.querySelector('.mull-hand-chips');
    if (!chips){
    chips = document.createElement('div');
    chips.className = 'mull-hand-chips';
    chips.setAttribute('aria-label', '残りの山札（タイプ別）');

    const ul = document.createElement('ul');
    ul.id = 'mull-remaining-by-type';
    ul.className = 'mull-remaining-list';

    chips.appendChild(ul);

    // ✅ hand-area の “直前” に入れる（上に出る）
    const hand = layout.querySelector('#mull-hand');
    layout.insertBefore(chips, hand || layout.firstChild);
    }
    return chips;
    }


    function renderHand(){
    els.hand.innerHTML = ''; // クリア

    state.hand.forEach((slot) => {
    const wrap = document.createElement('div');
    wrap.className = 'card-thumb';
    wrap.dataset.selected = slot.selected ? 'true' : 'false';

    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.loading  = 'lazy';
    img.src      = `img/${slot.cd}.webp`;
    img.onerror  = function(){
    this.remove();
    const title = document.createElement('div');
    title.className = 'title-fallback';
    const info = getCardInfo(slot.cd);
    title.textContent = info?.name
    ? `${info.name}（${slot.cd}）`
    : `No Image (${slot.cd})`;
    wrap.appendChild(title);
    };

    wrap.addEventListener('click', () => {
    slot.selected = !slot.selected;
    wrap.dataset.selected = slot.selected ? 'true' : 'false';
    refreshUI();
    });

    wrap.appendChild(img);
    els.hand.appendChild(wrap);
    });
    }

    // タイプ別：デッキ内枚数
    function tallyDeckByType(){
    const counts = { 'チャージャー': 0, 'アタッカー': 0, 'ブロッカー': 0 };
    const deckObj = getDeckObject();
    const map = window.cardMap || window.allCardsMap || {};

    for (const cd in deckObj){
    const n = deckObj[cd] | 0;
    if (!n) continue;
    const t = map[String(cd)]?.type;
    if (t === 'チャージャー' || t === 'アタッカー' || t === 'ブロッカー') {
    counts[t] += n;
    }
    }
    return counts;
    }
    // タイプ別：残り山枚数
    function tallyPoolByType() {
    // 手札を除いた最新の山で集計
    const livePool = buildPoolExcludingCurrentHand();
    const counts = { 'チャージャー': 0, 'アタッカー': 0, 'ブロッカー': 0 };
    const map = window.cardMap || window.allCardsMap || {};
    for (const cd of livePool) {
    const t = map[String(cd)]?.type;
    if (t === 'チャージャー' || t === 'アタッカー' || t === 'ブロッカー') counts[t]++;
    }
    return counts;
    }

    // 組み合わせ計算 nCk
    function comb(n, k){
    n = n|0; k = k|0;
    if (k < 0 || n < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    if (k === 0) return 1;
    let num = 1, den = 1;
    for (let i=1; i<=k; i++){
    num *= (n - (k - i));
    den *= i;
    }
    return num / den;
    }
    // タイプ別：キープ分
    function tallyKeptByType(){
    const counts = { 'チャージャー':0, 'アタッカー':0, 'ブロッカー':0 };
    const map = window.cardMap || window.allCardsMap || {};
    for (const h of state.hand){
    if (h.selected) continue; // ←キープ分だけ数える
    const t = map[String(h.cd)]?.type;
    if (t === 'チャージャー' || t === 'アタッカー' || t === 'ブロッカー') counts[t]++;
    }
    return counts;
    }
    //「もっと見る」ボタン生成
    function renderOutcomeMoreButton_(rowsLen){
    const moreHost = els.outcomeBox;
    const needMore = rowsLen > OUTCOME_LIMIT;
    if (!moreHost) return;

    let btn = moreHost.querySelector('.mull-outcome-more');

    if (!needMore) {
    if (btn) btn.remove();
    return;
    }

    if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mull-outcome-more';
    moreHost.appendChild(btn);
    }

    btn.textContent = state.outcomeExpanded
    ? '閉じる'
    : `もっと見る（残り${rowsLen - OUTCOME_LIMIT}件）`;
    }


    //初期手札タイプ構成表示
    function renderInitialHandOutcome() {
    const grid = document.querySelector('.mull-outcome-grid');
    const note = document.querySelector('.mull-outcome-note');
    if (!grid || !note) return;

    // 初期手札のタイプ配列（すでにある state.hand を使用）
    const map = window.cardMap || window.allCardsMap || {};
    const types = state.hand.map(h => map[String(h.cd)]?.type || '');

    // grid 初期化
    grid.innerHTML = '';

    // 1行だけ作る（確率100%）
    const row = document.createElement('div');
    row.className = 'mull-outcome-row2';

    const hand = document.createElement('div');
    hand.className = 'mull-outcome-hand';

    types.forEach(t => {
    const card = document.createElement('div');
    card.className = 'mull-outcome-card';
    card.dataset.type = t;
    hand.appendChild(card);
    });

    const pct = document.createElement('div');
    pct.className = 'mull-outcome-pct';
    pct.textContent = '100%';

    row.appendChild(hand);
    row.appendChild(pct);
    grid.appendChild(row);

    // 文言
    note.textContent = '初期手札のタイプ構成です';
    }

    // 初期手札タイプ構成確率計算＆表示
    function renderInitialHandOutcomeProbs(){
    if (!els.outcomeBox) return;

    const grid = els.outcomeBox.querySelector('.mull-outcome-grid');
    if (!grid) return;

    const pool = tallyDeckByType();
    const C = pool['チャージャー']|0;
    const A = pool['アタッカー']|0;
    const B = pool['ブロッカー']|0;
    const N = C + A + B;

    const k = HAND_SIZE; // 4枚固定
    const denom = comb(N, k);
    if (!denom){
    grid.innerHTML = `<div class="mull-outcome-note">※ デッキのタイプ情報が不足しています</div>`;
    return;
    }

    const rows = [];
    for (let c=0; c<=k; c++){
    for (let a=0; a<=k-c; a++){
    const b = k - c - a;
    if (c > C || a > A || b > B) continue;

    const p = (comb(C,c) * comb(A,a) * comb(B,b)) / denom;

    // 表示用：色カード4枚（順序は固定でOK：C→A→B）
    const typeArr = [];
    for (let i=0;i<c;i++) typeArr.push('チャージャー');
    for (let i=0;i<a;i++) typeArr.push('アタッカー');
    for (let i=0;i<b;i++) typeArr.push('ブロッカー');

    rows.push({ typeArr, p });
    }
    }

    rows.sort((x,y)=> y.p - x.p);

    const limit = state.outcomeExpanded ? rows.length : OUTCOME_LIMIT;
    const shown = rows.slice(0, limit);

    grid.innerHTML = shown.map((r, idx) => `
    <div class="mull-outcome-row2">
    <div style="display:flex; align-items:center;">
    <span class="mull-outcome-rank">${formatExampleLabel_(idx+1)}</span>
    <div class="mull-outcome-hand">
    ${(r.typeArr||[]).map(t => `
    <div class="mull-outcome-card" data-type="${t}"></div>
    `).join('')}
    </div>
    </div>
    <div class="mull-outcome-pct">${(r.p*100).toFixed(2)}%</div>
    </div>
    `).join('');

    // 共通の「もっと見る」ボタン（初期手札でも表示制御）
    renderOutcomeMoreButton_(rows.length);
    }

    // マリガン後の手札タイプ構成確率計算＆表示
    function renderMulliganOutcomeProbs(){
    if (!els.outcomeBox) return;

    const k = state.hand.filter(h => h.selected).length;

    // 引き直し枚数0なら初期手札表示
    if (k <= 0){
    els.outcomeBox.innerHTML = `
    <div class="mull-remaining-title">マリガン後の手札</div>
    <div class="mull-outcome-note">初期手札のタイプ構成です</div>
    <div class="mull-outcome-grid"></div>
    `;
    renderInitialHandOutcome(); // ★ここで初期手札を描画
    return;
    }

    // 母集団＝「手札4枚を除いた残り山札（タイプ別）」
    const pool = tallyPoolByType();
    const C = pool['チャージャー']|0;
    const A = pool['アタッカー']|0;
    const B = pool['ブロッカー']|0;
    const N = C + A + B;

    const denom = comb(N, k);
    if (!denom){
    els.outcomeBox.innerHTML = `
    <div class="mull-remaining-title">マリガン後の手札</div>
    <div class="mull-outcome-note">※ 引き直し枚数に対して山札が不足しています</div>
    `;
    return;
    }

    const kept = tallyKeptByType();// キープ分タイプ数
    const baseSlots = getInitialHandTypeSlots();// 手札タイプスロットの初期値取得

    const rows = [];
    for (let c=0; c<=k; c++){
    for (let a=0; a<=k-c; a++){
    const b = k - c - a;
    if (c > C || a > A || b > B) continue;

    const p = (comb(C,c) * comb(A,a) * comb(B,b)) / denom;

    const finC = kept['チャージャー'] + c;
    const finA = kept['アタッカー'] + a;
    const finB = kept['ブロッカー'] + b;

    // 4枚ぶんのタイプ配列（初期スロット順を維持して、マリガン枠だけ埋める）
    const typeArr = baseSlots.slice();

    // マリガンした枚数 = k なので、テンプレ上で「selectedだった位置」を空けて埋めたい。
    // ただ renderMulliganOutcomeProbs は“確率一覧”なので、実際の selected 位置を使うのが自然。
    const targets = [];
    for (let i=0;i<state.hand.length;i++){
    if (state.hand[i].selected) targets.push(i);
    }

    // この確率行で引けるタイプの“内訳”を配列化（順序はどれでもOK。ここでは C→A→B）
    const drawTypes = [];
    for (let i=0;i<c;i++) drawTypes.push('チャージャー');
    for (let i=0;i<a;i++) drawTypes.push('アタッカー');
    for (let i=0;i<b;i++) drawTypes.push('ブロッカー');

    // 空きスロットに順番に差し込む
    for (let j=0; j<targets.length; j++){
    const pos = targets[j];
    typeArr[pos] = drawTypes[j] || typeArr[pos] || '';
    }

    rows.push({ typeArr, p });
    }
    }

    // 確率高い順
    rows.sort((x,y)=> y.p - x.p);

    const limit = state.outcomeExpanded ? rows.length : OUTCOME_LIMIT;
    const shown = rows.slice(0, limit);
    // 上位10件まで
    //rows.length = Math.min(rows.length, 10);

    // 表示
    els.outcomeBox.innerHTML = `
    <div class="mull-remaining-title">マリガン後の手札</div>
    <div class="mull-outcome-grid">
    ${shown.map((r, idx) => `
    <div class="mull-outcome-row2">
    <div style="display:flex; align-items:center;">
    <span class="mull-outcome-rank">${formatExampleLabel_(idx+1)}</span>
    <div class="mull-outcome-hand">
        ${(r.typeArr || []).map((t, i) => {
        const h = state.hand[i];
        const isKept = h && !h.selected; // 選択してない＝キープ枠
        const cd = isKept ? String(h.cd) : '';
        const imgHtml = isKept
            ? `<img alt="" loading="lazy" decoding="async"
                    src="img/${cd}.webp"
                    onerror="this.src='img/00000.webp'">`
            : '';

        return `
            <div class="mull-outcome-card"
                data-type="${t || ''}"
                data-fixed="${isKept ? '1' : '0'}">
            ${imgHtml}
            </div>
        `;
        }).join('')}
    </div>
    </div>
    <div class="mull-outcome-pct">${(r.p*100).toFixed(2)}%</div>
    </div>
    `).join('')}
    </div>
    `;
    renderOutcomeMoreButton_(rows.length);
    }



    // タイプ別：残り山枚数表示更新
    function renderRemainingByType() {
    if (!els.remainList) return;
    const types = [
    { key: 'チャージャー', label: 'チャージャー' },
    { key: 'アタッカー',   label: 'アタッカー' },
    { key: 'ブロッカー',   label: 'ブロッカー' },
    ];
    const counts = tallyPoolByType();
    els.remainList.innerHTML = '';

    for (const t of types) {
    const n = counts[t.key] ?? 0;
    const li = document.createElement('li');
    li.className = 'mrt-chip compact';
    li.dataset.type = t.key;

    // ← 文字と数字を分けて入れる（数字は常に見える）
    li.innerHTML = `<span class="mrt-name">${t.label}</span><span class="mrt-count">${n}</span>`;

    els.remainList.appendChild(li);
    }
    }



    // ウィンドウサイズ変更時にも更新
    window.addEventListener('resize', () => {
    if (typeof renderRemainingByType === 'function') {
    renderRemainingByType();
    }
    });


    // UI活性とボタン文言切替（単一ボタン仕様）
    function refreshUI(){
    const deckSize = Object.values(getDeckObject()).reduce((a,b)=>a+(b|0),0);
    const hasDeck  = deckSize >= 30;
    const anySelected = state.hand.some(h => h.selected);
    const canReset    = hasDeck && deckSize >= HAND_SIZE;
    const selN = state.hand.filter(h => h.selected).length;
    const livePoolLen = buildPoolExcludingCurrentHand().length;
    const canMull = hasDeck && selN > 0 && livePoolLen >= selN;
    const mode = (selN === 0) ? 'initial' : 'mull';

    // 警告
    if (!hasDeck) {
    if (els.hand) els.hand.innerHTML = '';      // 手札のカードを消す
    if (els.hand) els.hand.style.display = 'none'; // 非表示
    if (els.warning) els.warning.hidden = false;   // 警告ON
    } else {
    if (els.hand) els.hand.style.display = '';     // 通常表示
    if (els.warning) els.warning.hidden = true;    // 警告OFF
    }

    // 文言
    if (els.btn) {
    els.btn.textContent = anySelected
    ? `${state.hand.filter(h => h.selected).length}枚マリガンする`
    : '手札リセット';
    // 活性
    els.btn.disabled = anySelected ? !canMull : !canReset;
    }

    renderRemainingByType();

    // ✅ モードが変わった時だけ「閉じる」に戻す
    if (state.outcomeMode !== mode) {
    state.outcomeExpanded = false;
    state.outcomeMode = mode;
    }

    if (selN === 0) {
    if (els.outcomeBox) {
    els.outcomeBox.innerHTML = `
    <div class="mull-remaining-title">初期手札パターンの目安</div>
    <div class="mull-outcome-grid"></div>
    `;
    }
    renderInitialHandOutcomeProbs();
    } else {
    renderMulliganOutcomeProbs();
    }
    }


    // マリガン（“今回”返したカードだけ抽選から除外）
    function doMulligan(){
    // 現在手札を除いた山を作り直す
    let pool = buildPoolExcludingCurrentHand();
    // 置き換え対象のインデックスを先に列挙
    const targets = [];
    for (let i=0;i<state.hand.length;i++) if (state.hand[i].selected) targets.push(i);
    // 選択枚数ぶん、poolから順番に補充（同一回の重複を避けるためpop）
    for (const pos of targets) {
    const next = pool.pop(); // 無ければ undefined
    if (!next) break;        // 引けなければそこで終了（見た目は据え置き）
    state.hand[pos].cd = next;
    state.hand[pos].selected = false;
    }

    renderHand();
    refreshUI();
    }

    // 手札リセット（discardedをクリア → デッキから再配り）
    function resetHand(){ dealInitialHand(); }

    // 単一ボタン：選択0→リセット / 1〜4→マリガン
    els.btn?.addEventListener('click', () => {
    const anySelected = state.hand.some(h => h.selected);
    if (anySelected) doMulligan();
    else resetHand();
    });

    // デッキ側の更新に追従
    const hookOnce = (name, wrapper) => {
    const fn = window[name];
    if (typeof fn === 'function' && !fn.__mull_hooked){
    const orig = fn;
    window[name] = function(...args){
    const r = orig.apply(this, args);
    try { wrapper(); } catch {}
    return r;
    };
    window[name].__mull_hooked = true;
    }
    };
    hookOnce('renderDeckList',        () => dealInitialHand());
    hookOnce('updateDeckAnalysis',    () => dealInitialHand());
    hookOnce('updateDeckSummaryDisplay', () => dealInitialHand());

    // カードロード完了時
    window.onCardsLoaded = (function(prev){
    return function(...args){
    if (typeof prev === 'function') prev.apply(this, args);
    dealInitialHand();
    };
    })(window.onCardsLoaded);

    // タブ移動（情報タブに入ったら更新）
    const origAfter = window.afterTabSwitched;
    window.afterTabSwitched = function(targetId){
    if (typeof origAfter === 'function') origAfter(targetId);
    if (targetId === 'info-tab' || targetId === 'edit') {
    dealInitialHand();
    }
    };

    // 初回
    dealInitialHand();
}

// loader対応（deckmaker-entry.js と同じ流儀）
if (typeof window.onDeckmakerReady === 'function') {
window.onDeckmakerReady(bootMulliganTrainer);
} else {
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', bootMulliganTrainer, { once: true });
} else {
bootMulliganTrainer();
}
}
})();