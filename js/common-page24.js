
//====画像生成=================
(function(){
  const IMG_DIR = 'img/';
  const FALLBACK_IMG = IMG_DIR + '00000.webp';
  //const BRAND_URL = 'https://mosurogia.github.io/mesorogia-cards/deckmaker.html';

  // ============ 初期化 ============
  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('exportPngBtn');
    if (!btn) return;
    btn.addEventListener('click', () => exportDeckImage());
  });


  // ============ 画像生成メイン ============
  async function exportDeckImage(opts = {}){

    if (window.__isExportingDeckImg) return;
    window.__isExportingDeckImg = true;

    const data = buildDeckSummaryData(opts);

    // ✅ 枚数チェックは data.total を使う（投稿もデッキメーカーも同じ基準でOK）
    const total = data.total || 0;

    if (total === 0){ alert('デッキが空です。カードを追加してください。'); return; }
    if (!opts.skipSizeCheck && total > 40){ alert('デッキ枚数が多すぎます（40枚以内にしてください）'); return; }

    const aspect = '3:4';
    const kinds = data.uniqueList?.length || 0;

    const spec  = getCanvasSpec(aspect, kinds);
    // 右下URL：投稿側は opts.brandUrl を優先。無ければ現在ページ
    spec.brandUrl = String(
      opts.brandUrl ||
      (location.origin + location.pathname)
    );
    if (typeof opts.showCredit === 'boolean') spec.showCredit = opts.showCredit;

    // （以降は今のままでOK）
    const loader = showLoadingOverlay('画像生成中…');
    await nextFrame(); await nextFrame();

    const node = await buildShareNode(data, spec);
    document.body.appendChild(node);

    try{
      await nextFrame(); await nextFrame();
      const scale = getPreferredScale();
      const target = node;

      const prevOverflow = target.style.overflow;
      target.style.overflow = 'visible';
      target.style.paddingRight = '20px';
      target.style.paddingBottom = '20px';
      target.scrollTop = 0;

      const CANVAS_TIMEOUT = 12000;

      const canvas = await Promise.race([
        html2canvas(target, {
          scale,
          useCORS: true,
          backgroundColor: '#fff',
          scrollX: 0,
          scrollY: 0,
          width:  target.scrollWidth,
          height: target.scrollHeight,
          windowWidth:  document.documentElement.scrollWidth,
          windowHeight: document.documentElement.scrollHeight,
          x: 0,
          y: 0,
          allowTaint: false,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('html2canvas timeout')), CANVAS_TIMEOUT)),
      ]);

      target.style.overflow = prevOverflow;

      const name = (data.deckName || 'deck').replace(/[\/:*?"<>|]+/g,'_').slice(0,40);
      downloadCanvas(canvas, `${name}_3x4.png`);
    } finally {
      window.__isExportingDeckImg = false;
      node.remove();
      hideLoadingOverlay(loader);
    }
  }





  window.exportDeckImage = exportDeckImage;

// ===== プレビュー用に内部関数を公開 =====
// 投稿成功モーダルでプレビューを作成するために必要な関数をグローバルへエクスポート
window.buildShareNodeForPreview       = buildShareNode;
window.buildDeckSummaryDataForPreview = buildDeckSummaryData;
window.getCanvasSpecForPreview        = getCanvasSpec;


  // ============ データ収集（統一版）===========
  function buildDeckSummaryData(opts = {}){
    const cardMap = window.cardMap || {};

    const normCd = (cd) => String(cd || '').trim().padStart(5,'0');

    // deckRaw を「{cd:count}」に正規化
    const deckRaw = opts.deck ?? window.deck ?? {};
    const deck = {};

    // 1) {cd:count} 形式
    if (deckRaw && typeof deckRaw === 'object' && !Array.isArray(deckRaw)) {
      for (const [cd, n] of Object.entries(deckRaw)){
        const k = normCd(cd);
        const nn = Number(n) || 0;
        if (nn > 0) deck[k] = (deck[k] || 0) + nn;
      }
    }

    // 2) ["00012","00034", ...] みたいな配列（万一来ても耐える）
    if (Array.isArray(deckRaw)) {
      for (const cd of deckRaw){
        const k = normCd(cd);
        if (!k) continue;
        deck[k] = (deck[k] || 0) + 1;
      }
    }

    const entries = Object.entries(deck);

    // deckName（投稿側で上書きしたいので opts 優先）
    const deckName =
      String(opts.deckName || '').trim() ||
      document.getElementById('info-deck-name')?.value?.trim() ||
      document.getElementById('post-deck-name')?.value?.trim() ||
      '';

    // 投稿者情報（投稿ページだけ入れたい）
    const posterName = String(opts.posterName || '').trim();
    const posterX    = String(opts.posterX || '').trim().replace(/^@/, '');

    // 並び替え（タイプ→コスト→パワー→cd）
    const TYPE_ORDER = { 'チャージャー':0, 'アタッカー':1, 'ブロッカー':2 };
    entries.sort((a,b)=>{
      const A = cardMap[a[0]]||{}, B = cardMap[b[0]]||{};
      const tA = TYPE_ORDER[A.type] ?? 99, tB = TYPE_ORDER[B.type] ?? 99;
      if (tA !== tB) return tA - tB;
      const cA = (parseInt(A.cost)||0), cB = (parseInt(B.cost)||0); if (cA !== cB) return cA - cB;
      const pA = (parseInt(A.power)||0), pB = (parseInt(B.power)||0); if (pA !== pB) return pA - pB;
      return String(a[0]).localeCompare(String(b[0]));
    });

    // ★ mainRace：投稿側は opts.mainRace / デッキメーカーは computeMainRace()
    const mainRace =
      String(opts.mainRace || '').trim() ||
      ((typeof computeMainRace === 'function' ? computeMainRace() : '') || '').trim() ||
      '未選択';

    // 合計・タイプ枚数
    const typeCounts = { 'チャージャー':0, 'アタッカー':0, 'ブロッカー':0 };
    let total = 0;
    entries.forEach(([cd, n])=>{
      total += (n|0);
      const t = cardMap[cd]?.type;
      if (t && typeCounts[t] != null) typeCounts[t] += (n|0);
    });

    // レアリティ
    const rarityMap  = { 'レジェンド':0,'ゴールド':0,'シルバー':0,'ブロンズ':0 };
    entries.forEach(([cd, n])=>{
      const r = cardMap[cd]?.rarity;
      if (r && rarityMap[r] != null) rarityMap[r] += (n|0);
    });

    const uniqueList = entries.map(([cd]) => cd);
    const countMap   = Object.fromEntries(entries.map(([cd, n]) => [String(cd), n|0]));

    // 代表カード: opts指定が最優先 → window指定 → 先頭
    const wantRep = normCd(opts.representativeCd || '');
    const repCd =
      (wantRep && deck[wantRep]) ? wantRep :
      (window.representativeCd && deck[normCd(window.representativeCd)]) ? normCd(window.representativeCd) :
      (entries[0]?.[0] || null);

    return {
      deckName, posterName, posterX,
      total, mainRace,
      typeCounts, rarityMap,
      representativeCd: repCd,
      uniqueList, countMap,
    };
  }



  // ============ レイアウト仕様 ============
  function getCanvasSpec(aspect, kinds){
    // ---- 基本定数（縦固定・5列）----
    const WIDTH        = 1350;     // 横幅（固定）
    const PADDING      = 24;       // 外枠パディング
    const GRID_PAD_SUM = 24;       // グリッドパネル内の左右合計パディング（12px×2）
    const COLS         = 5;
    const GAP          = 12;       // カード間の隙間
    const CARD_AR      = 532/424;  // カード縦横比（縦/横）

    // ヘッダー/フッター（基準）
    const HEADER_H_STD = 330;      // 標準ヘッダー高さ
    const FOOTER_H     = 84;

    // 使える横幅
    const usableW = WIDTH - PADDING*2 - GRID_PAD_SUM;
    // カード1枚の横幅（横余白ゼロで割り切り）
    const cardW   = (usableW - GAP*(COLS-1)) / COLS;
    const cardH   = cardW * CARD_AR;

    // 行数
    const rows    = Math.max(1, Math.ceil((kinds||0) / COLS));
    const rowsStd = 4; // 標準：20種＝4行

    // グリッドの高さ（行数ぶんぴったり）
    const gridH   = rows * cardH + GAP * (rows - 1);

    // ヘッダーのタイトルサイズを行数に応じて微調整
    // 4行なら 60px、1行多いごとに 2px ずつ小さく（下限48）
    const titleSize = Math.max(48, 60 - Math.max(0, rows - rowsStd) * 2);

    // 最終高さ：上下パディング＋ヘッダー＋グリッド＋フッター＋パネル余白
const height = PADDING + HEADER_H_STD + gridH + FOOTER_H + GRID_PAD_SUM;

    const theme = resolveTheme(); // スタイリッシュ薄色グラデ

    return {
      aspect,
      width: WIDTH,
      height,
      padding: PADDING,
      cols: COLS,
      headerH: HEADER_H_STD,
      footerH: FOOTER_H,
      gap: GAP,
      cardW, cardH, rows, // デバッグ・将来調整用
      titleSize,
      showCredit: false,// 投稿者名/Xはデフォルト表示しない
      theme
    };
  }


function resolveTheme() {
  // 柔らかいライト系グラデ + 透明感のあるカードパネル
  return {
    // 角度を付けたうっすらグラデーション
    canvasBg: 'linear-gradient(160deg, #f7f8fb 0%, #ffffff 45%, #f3f6fb 100%)',
    // “カード置き場”っぽい半透明ホワイト
    panelBg: 'rgba(255,255,255,0.88)',
    panelEdge: 'rgba(15,23,42,0.10)',         // = #0f172a の10%
    text: '#0f172a',
    subText: 'rgba(15,23,42,0.72)',
    chipBg: 'rgba(2,6,23,0.04)',             // ごく薄いチップ背景
    chipEdge: 'rgba(2,6,23,0.10)',
    chipText: '#0f172a',
    badgeBg: 'rgba(3,7,18,0.78)',            // 濃色バッジ（白地で映える）
    shadow: '0 14px 34px rgba(2,6,23,0.10)'  // ふわっとした影
  };
}

// タイプごとの淡色背景
const TYPE_BG = {
  'チャージャー': { bg:'rgba(119, 170, 212, .2)', border:'rgba(119, 170, 212, .4)' },
  'アタッカー'  : { bg:'rgba(125,  91, 155, .2)', border:'rgba(125,  91, 155, .4)' },
  'ブロッカー'  : { bg:'rgba(214, 212, 204, .5)', border:'rgba(214, 212, 204, .8)' },
};

// メイン種族背景色
const RACE_BG = {
  'ドラゴン'   : 'rgba(255, 100, 100, 0.16)',
  'アンドロイド': 'rgba(100, 200, 255, 0.16)',
  'エレメンタル': 'rgba(100, 255, 150, 0.16)',
  'ルミナス'   : 'rgba(255, 250, 150, 0.16)',
  'シェイド'   : 'rgba(200, 150, 255, 0.16)',
};

//タイプ枚数
function coloredChip(text, {bg, border, color='#0f172a', fz=30, pad='10px 14px'}){
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.style.alignItems = 'center';
  span.style.gap = '8px';
  span.style.background = bg || 'rgba(2,6,23,0.04)';
  span.style.border = `1px solid ${border || 'rgba(2,6,23,0.10)'}`;
  span.style.padding = pad;
  span.style.marginRight = '10px';
  span.style.borderRadius = '999px';
  span.style.fontSize = `${fz}px`;
  span.style.color = color;
  span.style.fontWeight = '700';
  span.textContent = text;
  return span.outerHTML;
}

// ① 数字だけを強調する小ユーティリティ
function strongNum(n){
  return `<span style="
    font-size:1.08em;
    font-weight:800;
    line-height:1;
    letter-spacing:.3px;
  ">${n}</span>`;
}

// ② HTMLで内容を渡せる“リッチ版”チップ
function chipRich(html, {bg, border, color='#0f172a', fz=30, pad='10px 14px'} = {}){
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.style.alignItems = 'center';
  span.style.gap = '8px';
  span.style.background = bg || 'rgba(2,6,23,0.04)';
  span.style.border = `1px solid ${border || 'rgba(2,6,23,0.10)'}`;
  span.style.padding = pad;
  span.style.marginRight = '10px';
  span.style.borderRadius = '999px';
  span.style.fontSize = `${fz}px`;
  span.style.color = color;
  span.style.fontWeight = '700';
  span.style.fontVariantNumeric = 'tabular-nums'; // ← 等幅数字で読みやすく
  span.innerHTML = html;
  return span.outerHTML;
}

  // ============ DOMビルド ============
  async function buildShareNode(data, spec){
    const root = document.createElement('div');
    root.className = 'deck-share-root';
    Object.assign(root.style, {
      position: 'fixed', left: '-9999px', top: '0',
      width: spec.width + 'px', height: spec.height + 'px',
      background: spec.theme.canvasBg,
      color: spec.theme.text,
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif',
      boxSizing: 'border-box',
      padding: spec.padding + 'px',
      display: 'grid',
      gridTemplateRows: `${spec.headerH}px auto ${spec.footerH}px`,
      gap: '6px',
    });

    // ---- ヘッダー ----
    const header = document.createElement('div');
    header.style.display = 'grid';
    header.style.gridTemplateColumns = (spec.aspect==='3:4' ? '240px 1fr' : '220px 1fr');
    header.style.gap = '10px';
    header.style.alignItems = 'center';
    header.style.background = spec.theme.panelBg;
    header.style.border = `1px solid ${spec.theme.panelEdge}`;
    header.style.borderRadius = '16px';
    header.style.padding = '10px';
    header.style.boxShadow = spec.theme.shadow;

    const rep = await buildRepThumb(data.representativeCd, spec);

    const headRight = document.createElement('div');

    // 2列グリッド：左=タイプ/レア、右=枚数/種族
    headRight.style.display = 'grid';
    headRight.style.gridTemplateColumns = '1fr 220px';
    headRight.style.gridTemplateRows = 'min-content min-content min-content';
    headRight.style.columnGap = '18px';
    headRight.style.rowGap = '0';
    headRight.style.alignItems = 'center'; // 各セル内は中央寄せ
    headRight.style.alignContent = 'space-evenly';// 3行を上下含め均等配分
    headRight.style.height = '100%';  // 親の高さにフィット
    headRight.style.alignSelf = 'stretch';  // 自身も伸ばす

    // タイトル
    const title = document.createElement('div');
    title.textContent = data.deckName || 'デッキ';
    Object.assign(title.style, {
      gridColumn: '1 / -1',
      fontSize: `${spec.titleSize}px`,
      fontWeight: '900',
      letterSpacing: '.4px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      color: spec.theme.text,
    });

    // 投稿者名 / X（任意表示）
    const showCredit = (spec?.showCredit !== false); // デフォルトON（falseで明示的に隠せる）
    const posterName = String(data?.posterName || data?.poster?.name || '').trim();
    let posterX = String(data?.posterX || data?.poster?.x || '').trim();
    posterX = posterX ? ('@' + posterX.replace(/^@/, '')) : '';

    let credit = null;
    if (showCredit && (posterName || posterX)) {
      const creditText = [posterName, posterX].filter(Boolean).join(' / ');
      credit = document.createElement('div');
      credit.textContent = creditText;

      Object.assign(credit.style, {
        gridColumn: '1 / -1',
        marginTop: '2px',
        fontSize: `${Math.max(18, Math.floor(spec.titleSize * 0.45))}px`,
        fontWeight: '700',
        opacity: '0.85',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      });
    }

    // 左列：タイプ構成（絵文字を無くし色チップに）
    const leftRow1 = document.createElement('div');
    leftRow1.style.whiteSpace = 'nowrap';
    leftRow1.innerHTML =
      chipRich(`チャージャー ${strongNum(data.typeCounts['チャージャー']||0)}枚`, TYPE_BG['チャージャー']) +
      chipRich(`アタッカー ${strongNum(data.typeCounts['アタッカー']||0)}枚`,   TYPE_BG['アタッカー']) +
      chipRich(`ブロッカー ${strongNum(data.typeCounts['ブロッカー']||0)}枚`,   TYPE_BG['ブロッカー']);


    // 左列：レアリティ構成（2行：上＝レジェンド/ゴールド、下＝シルバー/ブロンズ）
    const r = data.rarityMap;

    const rarityWrap = document.createElement('div');
    rarityWrap.style.display = 'flex';
    rarityWrap.style.flexDirection = 'column';
    rarityWrap.style.gap = '4px'; // 行間少し

    // 上段（レジェンド＋ゴールド）
    const rowTop = document.createElement('div');
    rowTop.style.whiteSpace = 'nowrap';
    rowTop.innerHTML =
      badge(spec, '🌈', `レジェンド ${strongNum(r['レジェンド']||0)}枚`) + ' ' +
      badge(spec, '🟡', `ゴールド ${strongNum(r['ゴールド']||0)}枚`);

    // 下段（シルバー＋ブロンズ）
    const rowBottom = document.createElement('div');
    rowBottom.style.whiteSpace = 'nowrap';
    rowBottom.innerHTML =
      badge(spec, '⚪️', `シルバー ${strongNum(r['シルバー']||0)}枚`) + ' ' +
      badge(spec, '🟤', `ブロンズ ${strongNum(r['ブロンズ']||0)}枚`);

    rarityWrap.appendChild(rowTop);
    rarityWrap.appendChild(rowBottom);

    // ← この rarityWrap をヘッダーの左下セルとして使用
    rarityWrap.style.gridColumn = '1 / 2';


    // 右列：デッキ枚数（大きめチップ）
    const rightRow1 = document.createElement('div');
    rightRow1.style.display = 'flex';
    rightRow1.style.justifyContent = 'flex-end';
    rightRow1.innerHTML = chipRich(
      `📘 ${strongNum(data.total)} <span style="opacity:.75">/ 30</span>`,
      {
        bg:'rgba(2,6,23,0.04)',
        border:'rgba(2,6,23,0.10)',
        fz:30,
        pad:'12px 16px'
      }
    );


    // 右列：メイン種族（背景色で表現）
    const rightRow2 = document.createElement('div');
    rightRow2.style.display = 'flex';
    rightRow2.style.justifyContent = 'flex-end';
    const raceBg = RACE_BG[data.mainRace] || 'rgba(2,6,23,0.04)';

    rightRow2.innerHTML = coloredChip(`${data.mainRace}`, {
      bg: raceBg,
      border:'rgba(2,6,23,0.10)',
      fz: 34,              // 30 → 34 に拡大
      pad: '12px 18px'     // 少しだけ横に余裕
    });

    // 配置
    // 1行目：タイトル（2列）
    headRight.appendChild(title);

    if (credit) headRight.appendChild(credit);

    // 2行目：左=タイプ、右=枚数
    leftRow1.style.gridColumn = '1 / 2';
    rightRow1.style.gridColumn = '2 / 3';
    headRight.appendChild(leftRow1);
    headRight.appendChild(rightRow1);
    // 3行目：左=レア、右=種族
    rightRow2.style.gridColumn = '2 / 3';
    headRight.appendChild(rarityWrap);
    headRight.appendChild(rightRow2);

    // 既存の append
    header.appendChild(rep);
    header.appendChild(headRight);


    // ---- グリッド（カード一覧） ----
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(${spec.cols}, 1fr)`;
    grid.style.gap = spec.gap + 'px';
    grid.style.alignContent = 'start';

    // パネル
    const gridPanel = document.createElement('div');
    gridPanel.style.background = spec.theme.panelBg;
    gridPanel.style.border = `1px solid ${spec.theme.panelEdge}`;
    gridPanel.style.borderRadius = '16px';
    gridPanel.style.padding = '12px';
    gridPanel.style.boxShadow = spec.theme.shadow;

    // タイル生成
    const tiles = await buildCardTilesUnified(data.uniqueList, data.countMap, spec);
    grid.append(...tiles);

    // そのまま入れる（スケールやラップなし）
    gridPanel.appendChild(grid);


    // ---- フッター（URL） ----
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.alignItems = 'center';
    footer.style.justifyContent = 'flex-end';
    footer.style.fontSize = '24px';
    footer.style.background = spec.theme.panelBg;
    footer.style.border = `1px solid ${spec.theme.panelEdge}`;
    footer.style.borderRadius = '12px';
    footer.style.padding = '8px 12px';
    footer.style.boxShadow = spec.theme.shadow;

    const brand = document.createElement('div');
    brand.textContent = spec.brandUrl || (location.origin + location.pathname);
    brand.style.opacity = '.9';
    brand.style.color = spec.theme.subText;
    footer.appendChild(brand);

    // まとめ
    root.appendChild(header);
    root.appendChild(gridPanel);
    root.appendChild(footer);

    return root;
  }

  function badge(spec, emoji, text){
    const span = document.createElement('span');
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.gap = '8px';
    span.style.background = spec.theme.chipBg;
    span.style.border = `1px solid ${spec.theme.chipEdge}`;
    span.style.padding = '8px 12px';
    span.style.marginRight = '8px';
    span.style.borderRadius = '999px';
    span.style.fontSize = '30px';
    span.style.color = spec.theme.chipText;
    span.style.fontWeight = '700';

    const hasText = (text !== undefined);
    const e = document.createElement('span'); e.textContent = hasText ? (emoji || '') : '';
    const t = document.createElement('span');
    t.innerHTML = hasText ? text : (emoji || '');
    t.style.fontVariantNumeric = 'tabular-nums';
    span.appendChild(e);
    span.appendChild(t);
    return span.outerHTML;
  }

  // 代表カードの角丸サムネ
  async function buildRepThumb(cd, spec){
    const h = Math.min(280, Math.floor(spec.headerH * 0.9));

    const wrap = document.createElement('div');
    wrap.style.height = h + 'px';
    wrap.style.aspectRatio = '424 / 532';
    wrap.style.borderRadius = '16px';
    wrap.style.overflow = 'hidden';
    wrap.style.background = '#fff';
    wrap.style.boxShadow = spec.theme.shadow;

    const img = await loadCardImageSafe(cd);
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    wrap.appendChild(img);
    return wrap;
  }

  // 各カード（角丸＋影＋重複バッジ）
  async function buildCardTilesUnified(uniqueList, countMap, spec){
    const out = [];
    const imgs = await Promise.all(uniqueList.map(cd => loadCardImageSafe(cd)));
    for (let i=0; i<uniqueList.length; i++){
      const cd = String(uniqueList[i]);
      const img = imgs[i];
      const wrap = document.createElement('div');
      wrap.style.position = 'relative';
      wrap.style.borderRadius = '12px';
      wrap.style.overflow = 'hidden';
      wrap.style.background = (spec.theme.panelBg.includes('linear-gradient') ? '#111' : '#fff');
      wrap.style.aspectRatio = '424 / 532';
      wrap.style.boxShadow = spec.theme.shadow;

      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      wrap.appendChild(img);

      const badgeDiv = document.createElement('div');
      badgeDiv.textContent = `×${countMap[cd]||1}`;
      Object.assign(badgeDiv.style, {
        position: 'absolute', right: '8px', top: '8px',
        background: spec.theme.badgeBg, color: '#fff', fontWeight: '900',
        padding: '10px 14px', borderRadius: '999px', fontSize: '40px',
        lineHeight: '1',
      });
      wrap.appendChild(badgeDiv);

      out.push(wrap);
    }
    return out;
  }

  // 安全な画像ロード
  function loadCardImageSafe(cd){
    return new Promise((resolve)=>{
      const code5 = (cd && String(cd).slice(0,5)) || '';
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.crossOrigin = 'anonymous';

      const done = () => resolve(img);

      img.onload = done;

      img.onerror = () => {
        // fallback へ切り替えた上で、fallback側の onload/onerror でも必ず終わらせる
        img.onerror = done;
        img.onload  = done;
        img.src = FALLBACK_IMG;
      };

      img.src = code5 ? (IMG_DIR + code5 + '.webp') : FALLBACK_IMG;
    });
  }

  // ============ ローディングUI ============
  function showLoadingOverlay(message){
    const ov = document.createElement('div');
    ov.className = 'deckimg-loading-overlay';
    Object.assign(ov.style, {
      position: 'fixed', inset: '0', zIndex: 9999,
      display: 'grid', placeItems: 'center',
      background: 'rgba(0,0,0,.45)',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif'
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background: 'rgba(20,20,28,.9)',
      border: '1px solid rgba(255,255,255,.12)',
      borderRadius: '14px',
      padding: '18px 22px',
      boxShadow: '0 8px 24px rgba(0,0,0,.4)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '12px',
      fontSize: '18px',
    });

    const spinner = document.createElement('div');
    Object.assign(spinner.style, {
      width: '18px', height: '18px', borderRadius: '999px',
      border: '3px solid rgba(255,255,255,.2)',
      borderTopColor: '#fff',
      animation: 'deckimg-spin 0.9s linear infinite'
    });

    const text = document.createElement('div');
    text.textContent = message || '生成中…';

    box.appendChild(spinner);
    box.appendChild(text);
    ov.appendChild(box);

    const style = document.createElement('style');
    style.textContent = `@keyframes deckimg-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`;
    ov.appendChild(style);

    document.body.appendChild(ov);
    return ov;
  }

  function hideLoadingOverlay(overlay){
    if (!overlay) return;
    overlay.remove();
  }

  // ============ ユーティリティ ============
  function nextFrame(){ return new Promise(r=>requestAnimationFrame(()=>r())); }


  function downloadCanvas(canvas, fileName){
    // Base64化（iPad/Safari対策：blobだと保存できない）
    const dataUrl = canvas.toDataURL('image/png');

    // 既に開いてたら消す
    document.getElementById('deckimg-preview-modal')?.remove();

    // モーダル本体
    const modal = document.createElement('div');
    modal.id = 'deckimg-preview-modal';
    Object.assign(modal.style, {
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      overflowY: 'auto',
      padding: '40px 0',
      color: '#fff',
      fontFamily: 'system-ui, sans-serif',
    });

    // 🔹 背景スクロール抑制
    document.body.style.overflow = 'hidden';

    // 閉じるボタン
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style, {
      position: 'absolute',
      top: '16px',
      right: '16px',
      background: 'rgba(255,255,255,0.9)',
      color: '#111',
      border: 'none',
      borderRadius: '50%',
      width: '36px',
      height: '36px',
      fontSize: '22px',
      fontWeight: '700',
      lineHeight: '1',
      cursor: 'pointer',
      boxShadow: '0 0 6px rgba(0,0,0,0.3)',
    });
    closeBtn.addEventListener('click', () => {
      modal.remove();
      document.body.style.overflow = ''; // 🔹 背景スクロール再許可
    });
    modal.appendChild(closeBtn);

    // 操作バー（保存案内）
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      margin: '15px',
      fontSize: 'clamp(14px, 2vw, 18px)',
      textAlign: 'center',
    });

    const hint = document.createElement('div');
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua))
      hint.textContent = '長押しで「写真に追加」や「共有（画像保存）」ができます';
    else if (/android/.test(ua))
      hint.textContent = '長押しで「画像をダウンロード」や「共有（画像保存）」ができます';
    else
      hint.textContent = '右クリックで「名前を付けて保存」できます';
    bar.appendChild(hint);

    // 画像と同じ幅のボタンバー（画像の“上”に置く）
      const btnBar = document.createElement('div');
      Object.assign(btnBar.style, {
        width: 'min(80vw, 500px)',   // ★ 画像と同じ幅
        maxWidth: 'min(80vw, 500px)',
        display: 'flex',
        gap: '8px',
        margin: '8px auto 12px',     // 上部少し空けて画像の直前に
      });

      // ボタン共通スタイル
      const mkBtn = (label) => {
        const el = document.createElement('a');
        el.textContent = label;
        Object.assign(el.style, {
          flex: '1 1 0',             // ★ 2つで横幅を等分
          display: 'inline-block',
          textAlign: 'center',
          textDecoration: 'none',
          background: '#fff',
          color: '#111',
          padding: '10px 12px',
          borderRadius: '10px',
          fontWeight: '800',
          fontSize: '14px',
          boxShadow: '0 2px 8px rgba(0,0,0,.25)',
        });
        return el;
      };

      // ダウンロード（どの端末でも確実に使える）
      const saveBtn = mkBtn('ダウンロード');
      saveBtn.href = dataUrl;          // ★ toDataURL をそのまま
      saveBtn.download = fileName;     // PC なら即保存、モバイルは新規DL

      // 共有（対応端末のみ表示）
      const shareBtn = mkBtn('共有（画像保存）');
      if (navigator.share) {
        shareBtn.href = 'javascript:void(0)';
        shareBtn.onclick = async () => {
          try {
            const b = await (await fetch(dataUrl)).blob();
            const f = new File([b], fileName, { type: 'image/png' });
            await navigator.share({ files: [f], title: fileName, text: 'デッキ画像' });
          } catch (_) { /* キャンセルは無視 */ }
        };
      } else {
        shareBtn.style.display = 'none'; // 未対応環境では非表示（ダウンロードボタンが全幅に）
      }

          btnBar.appendChild(saveBtn);
          btnBar.appendChild(shareBtn);
          modal.appendChild(bar);
          modal.appendChild(btnBar);

        // 画像
        const img = document.createElement('img');
        img.src = dataUrl;
        Object.assign(img.style, {
          maxWidth: 'min(80vw, 500px)',
          height: 'auto',
          borderRadius: '12px',
          boxShadow: '0 0 24px rgba(0,0,0,0.6)',
          objectFit: 'contain',
        });


        // 🔹 背景クリックで閉じる（×ボタンと同処理）
        modal.addEventListener('click', e => {
          if (e.target === modal && e.clientY < window.innerHeight * 0.9) {
            modal.remove();
            document.body.style.overflow = '';
          }
        });

        modal.appendChild(img);

      // 利用許諾メッセージ（画像の直後）
      const note = document.createElement('div');
      note.textContent = '※ここで生成した画像はXやDiscordなどに自由に投稿して構いません。';
      Object.assign(note.style, {
        width: 'min(80vw, 500px)',      // 画像・ボタンと同じ幅
        maxWidth: 'min(80vw, 500px)',
        fontSize: 'clamp(12px, 1.8vw, 14px)',
        color: 'rgba(255,255,255,0.8)',
        textAlign: 'center',
        margin: '10px auto 16px',       // 中央寄せ
      });
      modal.appendChild(note);

    document.body.appendChild(modal);
  }




  function getPreferredScale(){
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    return Math.max(2, Math.min(3, dpr)); // 2〜3
  }

})();

async function generateDeckImageSafe(target){
  showLoading();

  let timeoutId;
  try {
    const canvas = await Promise.race([
      html2canvas(target, {
        useCORS: true,
        backgroundColor: '#fff',
        scale: 2,
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('html2canvas timeout'));
        }, 10000); // 10秒
      })
    ]);

    clearTimeout(timeoutId);
    onCanvasReady(canvas);

  } catch (e) {
    console.error(e);
    alert('画像生成に失敗しました。ページを再読み込みしてください。');
  } finally {
    hideLoading();
  }
}



//=======アカウント関連========

// --- authトースト/スピナーのフォールバック（未定義ページ用） ---
if (typeof window.setAuthChecking !== 'function') {
  window.setAuthChecking = function(){ /* no-op */ };
}

// ==== Auth 一本化（PIN撤去版・UI結線） ====
(function(){
  // 共通定義（common.js）から取得
  const API = window.AUTH_API_BASE || window.GAS_API_BASE;
  window.API = API;


  const LS_TOKEN = 'mos_auth_token_v1';

  const Auth = {
    user: null,
    token: null,
    verified: false,

    setDisplayName(name){
    if (!this.user) return;
    this.user.displayName = name || this.user.displayName;
    window.reflectLoginUI?.();
    },

    async whoami(){
        if (!this.token) {
          this._clear();
          window.reflectLoginUI?.();
          return { ok:false };
        }

      setAuthChecking?.(true);
      try{
        const res = await postJSON(`${API}?mode=whoami`, { token: this.token });
        if (!res?.ok || !res.user){
          this._clear();
          window.reflectLoginUI?.();
          return { ok:false };
        }
        this._save(res.user, this.token);
        this.verified = true;
        window.reflectLoginUI?.();
        return { ok:true, user: res.user };
      } finally {
        setAuthChecking?.(false);
      }
    },

      async init(){
        this.user = null;
        this.token = localStorage.getItem(LS_TOKEN) || null;
        this.verified = false;
        window.reflectLoginUI?.();

        if (this.token) {
          await this.whoami(); // ここで verified=true になる
        }
      },

    async signup(username, password, displayName='', x=''){
      const res = await postJSON(`${API}?mode=signup`, {username, password, displayName, x});
      if (!res.ok) throw new Error(res.error||'signup failed');
      this._save(res.user, res.token);
      window.reflectLoginUI?.();
      return res.user;
    },

    async login(username, password){
      const res = await postJSON(`${API}?mode=login`, {
        username,
        password,
        debug: true,   // ← ★これを足す
      });

      if (!res.ok) throw new Error(res.error||'login failed');

      // ★ デバッグ結果を確認
      if (res.__debug) {
        console.log('[login debug]', res.__debug);
      }

      this.user = res.user;
      this.token = res.token;
      this.verified = true;

      localStorage.setItem(LS_TOKEN, this.token);
      window.reflectLoginUI?.();

      return res.user;
    },

    async logout(){
      try { await postJSON(`${API}?mode=logout`, {token:this.token}); } catch(_){}
      this._clear();
      window.reflectLoginUI?.();
    },

    attachToken(body){return Object.assign({}, body, { token:this.token||'' }); },

    _save(user, token){
      this.user = user || null;
      this.token = token || null;
      this.verified = !!(user && token);

      if (this.token) localStorage.setItem(LS_TOKEN, this.token);
      else localStorage.removeItem(LS_TOKEN);
    },

    _clear(){
      this.user = null;
      this.token = null;
      this.verified = false;
      localStorage.removeItem(LS_TOKEN);
    },
  };
  window.Auth = Auth;

  async function postJSON(url, payload){
    const r = await fetch(url, {
      method: 'POST',
      // redirect: 'manual', // ❌消す（または 'follow'）
      headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
      body: JSON.stringify(payload || {})
    });

    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);

    try { return JSON.parse(text); }
    catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}`); }
  }

window.postJSON = postJSON;

  // ---- UI（グローバル公開版）----
  window.reflectLoginUI = function reflectLoginUI(){
    const loggedIn = !!(Auth?.user && Auth?.token && Auth?.verified);
    const user = loggedIn ? (Auth.user || {}) : null;

    // 既存のログインフォーム周り（大きい方）
    const $form     = document.getElementById('auth-login-form');
    const $logged   = document.getElementById('auth-logged-in');
    const $disp     = document.getElementById('auth-display');
    const $unameLbl = document.getElementById('auth-username-label');
    const $pw       = document.getElementById('auth-password');

    // 投稿フォーム内のミニ表示
    const $miniOut  = document.getElementById('auth-mini-loggedout');  // 「未ログイン＋ボタン」
    const $miniIn   = document.getElementById('auth-mini-loggedin');   // ログイン中（auth-logged-in-row）

    // ---- 既存エリア（大きいログイン枠）の表示/非表示 ----
    if ($form)   $form.style.display   = loggedIn ? 'none' : '';
    if ($logged) $logged.style.display = loggedIn ? '' : 'none';

    if (loggedIn){
      if ($disp)     $disp.textContent     = user.displayName || user.username || '(no name)';
    } else {
      if ($pw)       $pw.value = '';
      if ($disp)     $disp.textContent = '';
    }

    // ミニ側チップの中の ID 表示（auth-username-label）もここで更新
    if ($unameLbl){
      $unameLbl.textContent = loggedIn
        ? (user.username || user.displayName || '')
        : '';
    }

    // ---- 投稿フォーム内ミニ表示の切り替え ----
    if ($miniOut) $miniOut.style.display = loggedIn ? 'none' : '';
    if ($miniIn)  $miniIn.style.display  = loggedIn ? '' : 'none';

    // ★ mine-login-note の表示切り替え（マイ投稿ページ用）
    const note = document.querySelector('.mine-login-note');
    if (note) {
      // ログイン中なら非表示、未ログインなら表示
      note.style.display = loggedIn ? 'none' : '';
    }

    // ★ マイ投稿ヘッダーの「ログイン状況(ID)」表示を更新
    const mineName = document.getElementById('mine-login-username');
    if (mineName) {
      // ID欄なので username 優先で表示
      mineName.textContent = loggedIn
        ? (user.username || user.displayName || '')
        : '未ログイン';
    }

    // ---- デッキ投稿フォームの既定値（未入力時のみ自動入力） ----
    const $dispInput = document.getElementById('auth-display-name');
    if (loggedIn && $dispInput && !$dispInput.value){
      $dispInput.value = user.displayName || user.username || '';
    }

    const $xInput = document.getElementById('auth-x');
    if (loggedIn && $xInput && !$xInput.value){
      $xInput.value = user.x || '';
    }
  };



  // ===== 認証UIフィードバック =====
function setAuthLoading(on, msg){
  // ボタン disable / 文言
  const loginBtn  = document.getElementById('auth-login-btn-submit'); // ← 実際のログインボタン
  const signupBtn = document.getElementById('auth-signup-btn');
  if (loginBtn)  loginBtn.disabled  = !!on;
  if (signupBtn) signupBtn.disabled = !!on;

  // 上部バッジ側（あれば）
  if (typeof setAuthChecking === 'function') setAuthChecking(!!on);

  // インライン状態表示
  const st = document.getElementById('auth-inline-status');
  if (st) st.textContent = msg || '';
}

function showAuthOK(msg){
  const st = document.getElementById('auth-inline-status');
  if (st) st.textContent = msg || '完了しました';
}

function showAuthError(msg){
  const st = document.getElementById('auth-inline-status');
  if (st) st.textContent = msg || 'エラーが発生しました';
}

function startSlowTimer(ms = 5000) {
  const st = document.getElementById('auth-inline-status');
  let fired = false;

  const id1 = setTimeout(() => {
    if (st && !fired && st.textContent && /中…$/.test(st.textContent)) {
      st.textContent += '（少し時間がかかっています…）';
    }
  }, ms);

  const id2 = setTimeout(() => {
    if (st && !fired && st.textContent && /時間がかかっています/.test(st.textContent)) {
      st.textContent = st.textContent.replace(/（.*?）$/, '') + '（このままお待ちください…）';
    }
  }, 15000);

  return () => { fired = true; clearTimeout(id1); clearTimeout(id2); };
}

  // パスワード保存トリガー
  function triggerPasswordSave(username, password){
      const form = document.getElementById('auth-login-save');
      if (!form) return;

      const u = form.querySelector('input[name="username"]');
      const p = form.querySelector('input[name="password"]');
      if (!u || !p) return;

      u.value = username || '';
      p.value = password || '';

      // Chrome が無視しないよう一瞬だけ表示
      form.style.left = '0px';
      form.style.top  = '0px';

      try {
          form.requestSubmit?.();
          form.submit?.();
      } catch(e){}

      // すぐ隠す（UIに見えない）
      setTimeout(() => {
          form.style.left = '-9999px';
          form.style.top  = '-9999px';
      }, 50);
  }

  // 事件: 新規登録
  async function doSignup(){
    const username    = (document.getElementById('auth-username')?.value || '').trim().toLowerCase();
    const password    = (document.getElementById('auth-password')?.value || '');
    const password2   = (document.getElementById('auth-password-confirm')?.value || '');
    const displayName = '';
    const x           = '';

    // 入力チェック
    if (!username || !password){
      alert('ユーザー名とパスワードを入力してください');
      return;
    }
    if (!password2){
      alert('確認用パスワードを入力してください');
      return;
    }
    if (password !== password2){
      alert('パスワードが一致しません。もう一度入力してください');
      return;
    }

    setAuthLoading(true, '登録中…');
    const stopSlow = startSlowTimer(5000);
    try{
      const res = await Auth.signup(username, password, displayName, x);
      stopSlow();
      setAuthLoading(false, '');
      showAuthOK('登録完了');
      window.reflectLoginUI?.();
      window.onDeckPostAuthChanged?.();

      // ★ 入力欄を軽くリセット
      const modal = document.getElementById('authLoginModal');
      const pw    = document.getElementById('auth-password');
      const pw2   = document.getElementById('auth-password-confirm');
      if (pw)  pw.value  = '';
      if (pw2) pw2.value = '';

      // ★ モーダルを閉じる
      if (modal) modal.style.display = 'none';

      // ★ 閉じた後に alert（少し間をあける）
      setTimeout(() => {
        alert('新規登録しました');
      }, 100);

      // ★ パスワード保存
      triggerPasswordSave(username, password);

    }catch(e){
      stopSlow();
      setAuthLoading(false, '');
      showAuthError('登録失敗：' + (e?.message || 'unknown'));
    }
  }


  // 事件: ログイン
  async function doLogin(){
    const username = (document.getElementById('auth-username')?.value || '').trim().toLowerCase();
    const password = (document.getElementById('auth-password')?.value || '');
    if (!username || !password){
      alert('ユーザー名とパスワードを入力してください');
      return;
    }

    setAuthLoading(true, 'ログイン中…');
    const stopSlow = startSlowTimer(5000);
    try{
      const res = await Auth.login(username, password);
      stopSlow();
      setAuthLoading(false, '');
      showAuthOK('ログイン完了');
      window.reflectLoginUI?.();
      window.onDeckPostAuthChanged?.()

      // ★ モーダルを閉じる
      const modal = document.getElementById('authLoginModal');
      if (modal) modal.style.display = 'none';

      // ★ 閉じた後に alert（少し間をあける）
      setTimeout(() => {
        alert('ログインしました');
        location.hash = '#logged-in';
      }, 100);

      // ★ パスワード保存
      triggerPasswordSave(username, password);

    }catch(e){
      stopSlow();
      setAuthLoading(false, '');
      showAuthError('ログイン失敗：' + (e?.message || 'unknown'));
    }
  }

// 事件: ログアウト
async function doLogout(){
  const logoutBtn = document.getElementById('auth-logout-btn');
  const prevLabel = logoutBtn ? logoutBtn.textContent : '';

  // ボタン状態を「ログアウト中…」に
  if (logoutBtn){
    logoutBtn.disabled = true;
    logoutBtn.textContent = 'ログアウト中…';
  }

  // 上の「ログイン中…」バッジやインライン表示も連動
  setAuthLoading(true, 'ログアウト中…');
  const stopSlow = startSlowTimer(5000);

  try{
    // 実際のログアウト処理（token クリア＆ UI 更新）
    await Auth.logout();

    // ★ デッキ投稿側にも「ログアウトしたよ」と通知
    if (window.onDeckPostAuthChanged){
      try { window.onDeckPostAuthChanged(); } catch(_) {}
    }

    // ログイン完了メッセージなどをクリア
    const st = document.getElementById('auth-inline-status');
    if (st) st.textContent = '';

    stopSlow();
    setAuthLoading(false, '');
    alert('ログアウトしました');

  } catch(e){
    stopSlow();
    setAuthLoading(false, '');
    // 失敗時だけエラーメッセージを表示
    showAuthError('ログアウト失敗：' + (e?.message || 'unknown'));
  } finally {
    // ボタン表記を元に戻す（UIとしては未ログイン表示になっているはず）
    if (logoutBtn){
      logoutBtn.disabled = false;
      logoutBtn.textContent = prevLabel || 'ログアウト';
    }
  }
}

  // ===== X handle 正規化/検証（page2 と揃える） =====
  function normalizeHandle(raw){
    let s = String(raw || '').trim();
    if (!s) return '';

    // 全角→半角（＠含む） + 空白除去
    try { s = s.normalize('NFKC'); } catch(_) {}
    s = s.replace(/\s+/g, '');

    // URL貼り付け対策
    s = s.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i, '');

    // クエリ/パス除去
    s = s.split(/[/?#]/)[0];

    // @ は全部消して、先頭に1個だけ付け直す（途中@も消える）
    s = s.replace(/[＠@]/g, '');

    if (!s) return '';
    return '@' + s;
  }


  function isValidXHandle(handle){
    const h = String(handle || '').trim();
    // @ + 英数/_ 1〜15文字
    return /^@[A-Za-z0-9_]{1,15}$/.test(h);
  }

  // ★ 追加：他IIFEから使えるようにグローバル公開
  window.normalizeHandle  = normalizeHandle;
  window.isValidXHandle   = isValidXHandle;
  window.isEmailLikeName_ = isEmailLikeName_;

  // ===== 投稿者名のメアド混入対策（page2 と揃える） =====
  function isEmailLikeName_(s){
    const v = String(s || '').trim();
    if (!v) return false;
    if (/^mailto:/i.test(v)) return true;
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(v)) return true;
    return false;
  }


  // DOM 結線
  window.addEventListener('DOMContentLoaded', () => {
    // パスワード表示/非表示
    const pw = document.getElementById('auth-password');
    const toggle = document.getElementById('auth-pass-toggle');
    if (pw && toggle){
      toggle.addEventListener('click', () => {
        const isPw = pw.type === 'password';
        pw.type = isPw ? 'text' : 'password';
        toggle.textContent = isPw ? '非表示' : '表示';
      });
    }

    // 元の大きいログインフォーム
    document.getElementById('auth-signup-btn')?.addEventListener('click', doSignup);
    document.getElementById('auth-logout-btn')?.addEventListener('click', doLogout);


    // 認証状態の初期化（未ログイン表示からスタート）
    Auth.init();

    // Enter キーでのデフォルト送信を止める（即ログイン防止）
    const loginForm = document.getElementById('auth-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        // Enter で勝手にログインさせないため、送信そのものを止める
        e.preventDefault();
      });
    }

    // ログインボタン経由でのみログインを実行
    const loginBtn = document.getElementById('auth-login-btn-submit');
    if (loginBtn) {
      loginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        doLogin();
      });
    }

    // 確認パスワード欄で Enter を押したら新規登録を実行（任意だけど便利）
    const pwConfirm = document.getElementById('auth-password-confirm');
    if (pwConfirm) {
      pwConfirm.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doSignup();
        }
      });
    }
  });

})();


// ========================================================
//  アカウントデータ モーダル（共通）
//  - data-open / data-close で開閉
//  - パス表示切替、Xプロフィール確認
//  - 保存: mode=updateProfile を GAS へPOST
//  - 成功時: localStorage に posterName/xAccount を保存
// ========================================================
(function(){
  function $(sel){ return document.querySelector(sel); }
  function openModal(id){ const m = document.getElementById(id); if (m) m.style.display = 'flex'; }
  function closeModal(id){ const m = document.getElementById(id); if (m) m.style.display = 'none'; }

  document.addEventListener('DOMContentLoaded', () => {

function ensureCampaignDetailModal_(){
  if (document.getElementById('campaignDetailModal')) return;

  const wrap = document.createElement('div');
  wrap.className = 'account-modal';
  wrap.id = 'campaignDetailModal';
  wrap.style.display = 'none';

  wrap.innerHTML = `
    <div class="modal-content campaign-modal" role="dialog" aria-modal="true" aria-labelledby="campaignDetailTitle">
      <div class="account-modal-head campaign-modal-head">
        <div class="campaign-head-left">
          <h3 id="campaignDetailTitle">🎉 キャンペーン詳細</h3>
          <div id="campaignDetailNameInline" class="campaign-head-sub" aria-label="キャンペーン名">（キャンペーン）</div>
        </div>
      </div>

      <div class="account-modal-body campaign-modal-body">

        <!-- 📅 開催期間（バナー表示をそのまま差し込み） -->
        <div class="campaign-card">
          <div class="campaign-card-title">📅 開催期間</div>
          <div class="campaign-card-text">
            <span id="campaignDetailRange" class="campaign-range">（日程はバナー表示に合わせて運用）</span>
          </div>
        </div>

        <!-- 🎁 報酬 -->
        <div class="campaign-card">
          <div class="campaign-card-title">🎁 報酬</div>
          <div class="campaign-card-text" id="campaignDetailPrizesText">
            （報酬：準備中）
          </div>
        </div>

        <!-- 参加方法 -->
        <div class="campaign-card">
          <div class="campaign-card-title">📝 参加方法（投稿の仕方）</div>
          <ol class="campaign-steps">
            <li><b>アカウント新規登録 or ログイン</b></li>
            <li>
              <b>投稿内のXアカウント欄を記入</b>
              <div class="campaign-warn">未入力だと、当選しても届けられません（重要）</div>
            </li>
            <li>
              <b>デッキ投稿にキャンペーン対象のタグが付いていれば応募完了</b>
              <div class="campaign-tagbox tag-chips post-tags-main" data-campaign-tagbox>
                <span class="chip active">（対象タグ：準備中）</span>
              </div>
            </li>
          </ol>
        </div>

        <!-- 応募口数 -->
        <div class="campaign-card">
          <div class="campaign-card-title">🎟 応募口数</div>
          <div class="campaign-card-text">
            <b>1ユーザーにつき最大3口まで応募OK</b><br>
            <span class="campaign-boost">たくさん投稿すると当選確率アップ！</span>
          </div>
        </div>

                <!-- 🎲 抽選方法 -->
        <div class="campaign-card">
          <div class="campaign-card-title">🎲 抽選方法</div>
          <div class="campaign-card-text" id="campaignDetailDrawText">
            【抽選枠】
            応募口数（最大3口）をもとに抽選します。
            ・同一ユーザーは最大3口まで（投稿数が多いほど当選確率アップ）

            【選考枠（オリジナリティ賞など）】
            運営が「面白い／独自性が高い」と感じたデッキを選考します。
            ・環境テンプレの丸写しではなく、狙いや工夫が伝わる構築を優先
            ・採用理由／コンセプトが分かる投稿ほど選ばれやすい
            ※選考枠は“強さ”だけで決まりません
          </div>
        </div>

        <div class="campaign-modal-footer">
          <button type="button" class="btn primary" data-close="campaignDetailModal">閉じる</button>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(wrap);
}

const DEFAULT_DRAW_TEXT =
`【抽選枠】
応募口数（最大3口）をもとに抽選します。
・同一ユーザーは最大3口まで（投稿数が多いほど当選確率アップ）

【選考枠（オリジナリティ賞など）】
運営が「面白い／独自性が高い」と感じたデッキを選考します。
・環境テンプレの丸写しではなく、狙いや工夫が伝わる構築を優先
・採用理由／コンセプトが分かる投稿ほど選ばれやすい
※選考枠は“強さ”だけで決まりません`;



  // （任意）後から対象タグを差し込む用
  window.setCampaignDetailTags = function(tags){
    const modal = document.getElementById('campaignDetailModal');
    const box = modal?.querySelector('[data-campaign-tagbox]');
    if (!box) return;

    const list = Array.isArray(tags) ? tags.filter(Boolean) : [];
    box.replaceChildren();

    if (!list.length){
      const s = document.createElement('span');
      s.className = 'chip active';
      s.textContent = '（対象タグ：準備中）';
      box.appendChild(s);
      return;
    }
    list.forEach(t=>{
      const s = document.createElement('span');
      s.className = 'campaign-tag chip active';
      s.textContent = t;
      box.appendChild(s);
    });
  };


function escapeHtml_(s){
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}

function parseRules_(camp){
  // camp.rulesJSON が「文字列JSON」でも「オブジェクト」でも動くようにする
  const raw = camp?.rulesJSON;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch(_) { return null; }
}

// draw: string / prizes: string[] を想定（後述）
window.setCampaignDetailRules = function(camp){
  const rules = parseRules_(camp) || {};
  const drawEl   = document.getElementById('campaignDetailDrawText');
  const prizesEl = document.getElementById('campaignDetailPrizesText');

  // 抽選方法：固定
  if (drawEl){
    drawEl.innerHTML = escapeHtml_(DEFAULT_DRAW_TEXT).replaceAll('\n','<br>');
  }

  if (!prizesEl) return;

  // ---- 報酬：新旧どっちでも表示できるようにする ----
  // 旧: rules.prizes = ["...","..."]
  // 新: rules.prize = { lottery:[{label,amount,winners}], selection:[...] }

  // 1) 旧形式（prizes配列）
  const legacy = Array.isArray(rules.prizes) ? rules.prizes.filter(Boolean) : [];

  // 2) 新形式（prize.lottery / prize.selection）
  const prizeObj = rules.prize || {};
  const lottery  = Array.isArray(prizeObj.lottery)   ? prizeObj.lottery   : [];
  const selection= Array.isArray(prizeObj.selection) ? prizeObj.selection : [];

  // 表示用文字列生成
  const fmt = (p) => {
    const label   = String(p?.label ?? '').trim();
    const amount  = Number(p?.amount ?? 0);
    const winners = Number(p?.winners ?? p?.qty ?? 0);
    const yen = amount ? `${amount.toLocaleString()}円` : '';
    const win = winners ? `${winners}名` : '';
    const mid = [yen, win].filter(Boolean).join(' / ');
    return `${label || '賞'}${mid ? `（${mid}）` : ''}`;
  };

  const blocks = [];

  if (lottery.length){
    blocks.push(`<div class="campaign-prize-block"><b>【抽選枠】</b><ul class="campaign-prize-list">${
      lottery.map(p=>`<li>${escapeHtml_(fmt(p))}</li>`).join('')
    }</ul></div>`);
  }
  if (selection.length){
    blocks.push(`<div class="campaign-prize-block"><b>【選考枠】</b><ul class="campaign-prize-list">${
      selection.map(p=>`<li>${escapeHtml_(fmt(p))}</li>`).join('')
    }</ul></div>`);
  }

  if (blocks.length){
    prizesEl.innerHTML = blocks.join('');
    return;
  }

  // 新形式が無い場合は旧形式で表示
  if (legacy.length){
    prizesEl.innerHTML =
      `<ul class="campaign-prize-list">` +
      legacy.map(p=>`<li>${escapeHtml_(p)}</li>`).join('') +
      `</ul>`;
    return;
  }

  prizesEl.textContent = '（報酬：準備中）';
};





    ensureCampaignDetailModal_();

    // モーダル開閉（全ページ共通）
    document.querySelectorAll('[data-open]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{   // ★ async を付ける
        const id = btn.getAttribute('data-open');
        if (id) openModal(id);
        // 開いたタイミングで既知情報を流し込み（whoami or localStorage）
        if (id === 'accountDataModal') {
          const uname = (window.Auth?.user?.username) || '';
          const disp  = (window.Auth?.user?.displayName) || '';
          const x     = (window.Auth?.user?.x) || '';
          const lsName = localStorage.getItem('posterName') || '';
          const lsX    = localStorage.getItem('xAccount') || '';

          const loginName  = uname || (window.Auth?.lastLoginName) || '';
          const posterName = disp || lsName || '';
          const xAccount   = x || lsX || '';

          const $login = document.getElementById('acct-login-name');
          const $pname = document.getElementById('acct-poster-name');
          const $x     = document.getElementById('acct-x');

          // 現在の情報は placeholder に表示し、value は空（＝未入力扱い）
          if ($login){ $login.placeholder = loginName ? `現在: ${loginName}` : '（未設定）'; $login.value = ''; }
          if ($pname){ $pname.placeholder = posterName ? `現在: ${posterName}` : '（未設定）'; $pname.value = ''; }
          if ($x)    { $x.placeholder     = xAccount ? `現在: ${xAccount}` : '（未設定）'; $x.value = ''; }


          // パスワード欄も毎回クリア（＝「新しいパスワード」入力欄）
          const passInput = document.getElementById('acct-password');
          if (passInput){ passInput.value = ''; }

          // 保存ボタンは「何か入力したら有効」にする（Bでロジック更新）
          const saveBtn = document.getElementById('acct-save-btn');
          if (saveBtn) saveBtn.disabled = true;
        }
        if (id === 'campaignDetailModal') {
        try {
        const camp = window.__activeCampaign || await (window.fetchActiveCampaign?.() || Promise.resolve(null));
        window.setCampaignDetailRules?.(camp);
        } catch(_) {}
        // 開催期間
        const $range = document.getElementById('campaignDetailRange');
        const $srcRange = document.getElementById('campaign-banner-range');
        if ($range) {
          const t = ($srcRange?.textContent || '').trim();
          $range.textContent = t || '（日程はバナー表示に合わせて運用）';
        }

        // キャンペーン名
        const $name = document.getElementById('campaignDetailNameInline');
        const $srcName = document.getElementById('campaign-banner-title');
        if ($name) {
          const n = ($srcName?.textContent || '').trim();
          $name.textContent = n || 'キャンペーン';
        }
        const n = (document.getElementById('campaign-banner-title')?.textContent || '').trim();
        if (n && window.setCampaignDetailTags) window.setCampaignDetailTags([n]);
        }
      });
    });
    document.querySelectorAll('[data-close]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.getAttribute('data-close');
        if (id) closeModal(id);
      });
    });

    // パスワード表示切替
    const passInput = $('#acct-password');
    const passToggle= $('#acct-pass-toggle');
    if (passToggle && passInput){
      passToggle.addEventListener('click', ()=>{
        const type = passInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passInput.setAttribute('type', type);
        passToggle.textContent = (type === 'password' ? '表示' : '非表示');
      });
    }

    // X確認（page2 と同じ仕様：正規化→検証→open）
    const xBtn = $('#acct-x-open');
    const xInput = $('#acct-x');
    if (xBtn && xInput){
      xBtn.addEventListener('click', (e)=>{
        e.preventDefault();

        const norm = normalizeHandle(xInput.value);
        if (norm) xInput.value = norm;

        const user = String(norm || '').replace(/^@/, '').trim();
        if (!user){
          alert('Xアカウント名を入力してください');
          return;
        }
        if (!isValidXHandle(norm)){
          alert('Xアカウント名が不正です（英数と_、最大15文字）');
          return;
        }
        window.open(`https://x.com/${encodeURIComponent(user)}`, '_blank', 'noopener');
      });
    }

    // ===== 保存ボタンの有効/無効（入力監視） =====
    document.addEventListener('input', () => {
      const $login = document.getElementById('acct-login-name');
      const $pwd   = document.getElementById('acct-password');
      const $pname = document.getElementById('acct-poster-name');
      const $x     = document.getElementById('acct-x');
      const btn    = document.getElementById('acct-save-btn');
      if (!btn) return;
      const any =
        ($login?.value?.trim()?.length || 0) > 0 ||
        ($pwd  ?.value?.trim()?.length || 0) > 0 ||
        ($pname?.value?.trim()?.length || 0) > 0 ||
        ($x    ?.value?.trim()?.length || 0) > 0;
      btn.disabled = !any;
    });

  });
})();

// ===== アカウント保存（共通・一元化） =====
(function setupAccountSaveOnce(){
  if (window.__acctSaveBound) return;
  window.__acctSaveBound = true;

  const API     = window.API;
  const postJSON= window.postJSON;
  const Auth    = window.Auth;

  // 差分ペイロードを作る補助
  function buildPayloadFromForm(){
    // 現在値は placeholder に「現在: foo」と入っている前提
    const curLoginRaw = (document.getElementById('acct-login-name')?.placeholder || '').trim();
    const curLogin    = curLoginRaw.replace(/^現在:\s*/,'').trim();

    const curNameRaw  = (document.getElementById('acct-poster-name')?.placeholder || '').trim();
    const curName     = curNameRaw.replace(/^現在:\s*/,'').trim();

    const curXRaw     = (document.getElementById('acct-x')?.placeholder || '').trim();
    const curX        = curXRaw.replace(/^現在:\s*/,'').trim();

    // 入力（変更希望）
    const newLogin = (document.getElementById('acct-login-name')?.value || '').trim();
    const newPass  = (document.getElementById('acct-password')?.value || '').trim();
    const newNameRaw = (document.getElementById('acct-poster-name')?.value || '').trim();
    const newXRaw    = (document.getElementById('acct-x')?.value || '').trim();

    // 差分のみ送る（GAS側は loginName で現在ユーザを特定）
    const payload = { loginName: curLogin };

    if (newLogin && newLogin.toLowerCase() !== curLogin.toLowerCase()){
      payload.newLoginName = newLogin.toLowerCase();
    }
    if (newPass){
      payload.newPassword = newPass;
    }
    // 投稿者名：メアドっぽいのは保存させない
    if (newNameRaw && isEmailLikeName_(newNameRaw)){
      alert('投稿者名にメールアドレスは入れないでください');
      return null; // 呼び出し側でハンドリング
    }
    // X：正規化して検証、OKなら payload へ（保存時もガード）
    let newXNorm = '';
    if (newXRaw){
      const norm = normalizeHandle(newXRaw);
      if (!isValidXHandle(norm)){
        alert('Xアカウント名が不正です（英数と_、最大15文字）');
        return null;
      }
      newXNorm = norm.replace(/^@/, ''); // 保存は @なし形式に統一
    }

    // 差分のみ送る
    if (newNameRaw && newNameRaw !== curName){
      payload.posterName = newNameRaw;
    }
    if (newXNorm && newXNorm !== curX){
      payload.xAccount = newXNorm;
    }
    return payload;
  }

  // 成功後に placeholder と入力欄を更新する
  function applyResultToForm(resUser){
    const $login = document.getElementById('acct-login-name');
    const $name  = document.getElementById('acct-poster-name');
    const $x     = document.getElementById('acct-x');
    const $pw    = document.getElementById('acct-password');

    if ($login){
      const now = resUser?.username || ($login.placeholder || '').replace(/^現在:\s*/,'').trim();
      $login.value = '';
      $login.placeholder = now ? `現在: ${now}` : '（未設定）';
    }
    if ($name){
      const now = resUser?.displayName ?? ($name.placeholder || '').replace(/^現在:\s*/,'').trim();
      $name.value = '';
      $name.placeholder = now ? `現在: ${now}` : '（未設定）';
    }
    if ($x){
      const now = resUser?.x ?? ($x.placeholder || '').replace(/^現在:\s*/,'').trim();
      $x.value = '';
      $x.placeholder = now ? `現在: ${now}` : '（未設定）';
    }
    if ($pw){ $pw.value = ''; }
  }

  // ★ ここを「ボタンクリック」→「フォーム submit」に変更
  const form = document.getElementById('account-data-form');
  if (!form) return;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();

    const btn = document.getElementById('acct-save-btn');
    if (!btn) return;

    // 1) 差分作成
    const payload = buildPayloadFromForm();
    if (!payload) return;

    // 2) 変更がない場合はブロック
    const keys = Object.keys(payload);
    if (keys.length <= 1){ // loginName しか入っていない
      alert('新しい変更データを入力してください');
      return;
    }

    // 3) 毎回パスワード確認（仕様：保存時は毎回確認する）
    const curPw = window.prompt('現在のパスワードを入力してください');
    if (!curPw || !curPw.trim()){
      alert('保存をキャンセルしました');
      return;
    }
    payload.password = curPw.trim();

    // 4) トークン添付（どちらでも認証できるが、あれば付ける）
    const sendBody = (Auth && typeof Auth.attachToken === 'function')
      ? Auth.attachToken(payload)
      : payload;

    // 5) 送信
    btn.disabled = true;
    const keep = btn.textContent;
    btn.textContent = '送信中...';

    try{
      const res = await postJSON(`${API}?mode=updateProfile`, sendBody);
      if (!res?.ok) throw new Error(res?.error || 'update failed');

      // 1) 返ってきた user があれば一旦キャッシュ更新
      if (res.user && Auth) {
        Auth._save(res.user, Auth.token);
      }

      // 2) whoami でサーバ最新を再取得
      try {
        if (typeof window.refreshWhoAmI === 'function') {
          await window.refreshWhoAmI();
        } else if (Auth && typeof Auth.whoami === 'function') {
          await Auth.whoami();
        }
      } catch(_) { /* noop */ }

      // 3) 最終ユーザーを取得してフォームの placeholder を更新
      const newUser = (Auth && Auth.user) ? Auth.user : (res.user || null);
      applyResultToForm(newUser);

      // 4) ログイン表示更新
      window.reflectLoginUI?.();

      // 5) モーダルを閉じる
      const m = document.getElementById('accountDataModal');
      if (m) m.style.display = 'none';

      alert('アカウント情報を更新しました');

    }catch(err){
      console.error(err);
      alert('保存に失敗しました：' + err.message);
    }finally{
      btn.disabled = false;
      btn.textContent = keep;
    }
  });
})();


// ======================================
//  マイ投稿用: whoami → ユーザー名反映
// ======================================
window.refreshWhoAmI = async function refreshWhoAmI(){
  if (!window.Auth) return;

  const span = document.getElementById('mine-login-username');
  const note = document.querySelector('.mine-login-note');

  const res = await Auth.whoami();  // token が無い場合は ok:false で返る想定

  const loggedIn = !!(res && res.ok && res.user);

  if (span){
    if (loggedIn){
      const u = res.user;
      span.textContent = u.displayName || u.username || 'ログイン中';
    } else {
      span.textContent = '未ログイン';
    }
  }

  // 説明文：「ログイン中は非表示」のまま維持
  if (note){
    note.style.display = loggedIn ? 'none' : '';
  }
};
