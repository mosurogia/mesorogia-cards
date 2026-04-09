/* =========================
 * features/group-image-export.js
 * - カードグループ画像生成（html2canvas）
 * 依存：
 *   - window.cardMap
 *   - html2canvas
 * 公開：
 *   - window.exportGroupImage
 * ========================= */
(function(){
  'use strict';

  const IMG_DIR = 'img/';
  const FALLBACK_IMG = IMG_DIR + '00000.webp';

  async function exportGroupImage(opts = {}){
    if (window.__isExportingGroupImg) return;
    window.__isExportingGroupImg = true;

    // ✅ 追加：ローディング開始（デッキと同じUIを使う）
    const loader = window.__DeckImgLoading?.show?.('画像生成中…');

    try{
      const name = String(opts.groupName || 'group').trim() || 'group';
      const list = Array.isArray(opts.cards) ? opts.cards : [];
      const unique = Array.from(new Set(list.map(normCd).filter(Boolean)));

      if (unique.length === 0){
        alert('グループにカードがありません。');
        return;
      }

      const spec = getGroupCanvasSpec(unique.length);
      const node = await buildGroupShareNode({ name, unique }, spec);
      const safeName = name.replace(/[\/:*?"<>|]+/g,'_').slice(0,40);
      document.body.appendChild(node);

      await nextFrame(); await nextFrame();

      let canvas;
      try {
        canvas = await html2canvas(node, {
          scale: getExportScale(),
          useCORS: true,
          backgroundColor: '#fff',
          scrollX: 0,
          scrollY: 0,
          width:  node.scrollWidth,
          height: node.scrollHeight,
        });
      } catch (e) {
        console.error('[group-image-export] html2canvas failed', e, {
          spec,
          kinds: unique.length,
          nodeW: node?.scrollWidth,
          nodeH: node?.scrollHeight,
          dpr: window.devicePixelRatio,
        });
        alert('画像生成に失敗しました（端末やブラウザの制限の可能性があります）');
        node.remove(); // これも忘れず
        return;
      }
      downloadCanvas(canvas, `${safeName}_group.png`);
      node.remove();

    } finally {
      // ✅ 追加：ローディング終了
      try { window.__DeckImgLoading?.hide?.(loader); } catch {}
      window.__isExportingGroupImg = false;
    }
  }

  window.exportGroupImage = exportGroupImage;

  // --------------------
  // DOM
  // --------------------
  function getGroupCanvasSpec(kinds){
    const WIDTH = 1350;
    const PADDING = 24;
    const COLS = 6;         // グループは6列くらいが見やすい
    const GAP = 10;
    const CARD_AR = 532/424;

    const usableW = WIDTH - PADDING*2;
    const cardW = (usableW - GAP*(COLS-1)) / COLS;
    const cardH = cardW * CARD_AR;

    const rows = Math.max(1, Math.ceil((kinds||0)/COLS));
    const HEADER_H = 140;
    const FOOTER_H = 60;

    const height = PADDING + HEADER_H + (rows*cardH + GAP*(rows-1)) + FOOTER_H + PADDING;

    return { width: WIDTH, height, padding: PADDING, cols: COLS, gap: GAP, cardW, cardH, headerH: HEADER_H, footerH: FOOTER_H };
  }

  async function buildGroupShareNode(data, spec){
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'fixed', left: '-9999px', top: '0',
      width: spec.width + 'px',
      height: spec.height + 'px',
      padding: spec.padding + 'px',
      boxSizing: 'border-box',
      background: 'linear-gradient(160deg,#f7f8fb 0%,#fff 50%,#f3f6fb 100%)',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif',
      color: '#0f172a',
      display: 'grid',
      gridTemplateRows: `${spec.headerH}px auto ${spec.footerH}px`,
      gap: '10px',
    });

    // header
    const header = document.createElement('div');
    Object.assign(header.style, {
      background: 'rgba(255,255,255,0.90)',
      border: '1px solid rgba(15,23,42,0.10)',
      borderRadius: '16px',
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      boxShadow: '0 14px 34px rgba(2,6,23,0.10)',
    });

    const title = document.createElement('div');
    title.textContent = data.name;
    Object.assign(title.style, {
      fontSize: '44px',
      fontWeight: '900',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '75%',
    });

    const meta = document.createElement('div');
    meta.textContent = `${data.unique.length}枚`;
    Object.assign(meta.style, { fontSize: '28px', fontWeight: '800', opacity: '0.85' });

    header.appendChild(title);
    header.appendChild(meta);

    // grid panel
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: 'rgba(255,255,255,0.88)',
      border: '1px solid rgba(15,23,42,0.10)',
      borderRadius: '16px',
      padding: '12px',
      boxShadow: '0 14px 34px rgba(2,6,23,0.10)',
    });

    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: `repeat(${spec.cols}, 1fr)`,
      gap: spec.gap + 'px',
      alignContent: 'start',
    });

    const tiles = await buildTiles(data.unique);
    grid.append(...tiles);
    panel.appendChild(grid);

    // footer
    const footer = document.createElement('div');
    Object.assign(footer.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      fontSize: '22px',
      opacity: '0.75',
      padding: '6px 10px',
    });
    footer.textContent = (location.origin + location.pathname);

    root.appendChild(header);
    root.appendChild(panel);
    root.appendChild(footer);

    return root;
  }

  async function buildTiles(uniqueList){
    const out = [];
    const imgs = await Promise.all(uniqueList.map(cd => loadCardImageSafe(cd)));
    for (let i=0; i<uniqueList.length; i++){
      const img = imgs[i];
      const wrap = document.createElement('div');
      Object.assign(wrap.style, {
        borderRadius: '12px',
        overflow: 'hidden',
        aspectRatio: '424 / 532',
        background: '#fff',
        boxShadow: '0 10px 24px rgba(2,6,23,0.10)',
      });
      Object.assign(img.style, { width:'100%', height:'100%', objectFit:'cover' });
      wrap.appendChild(img);
      out.push(wrap);
    }
    return out;
  }

  // --------------------
  // utils
  // --------------------
  function normCd(cd){ return String(cd || '').trim().padStart(5,'0').slice(0,5); }

  function loadCardImageSafe(cd){
    return new Promise((resolve)=>{
      const code5 = normCd(cd);
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.crossOrigin = 'anonymous';

      const done = () => resolve(img);
      img.onload = done;
      img.onerror = () => {
        img.onerror = done;
        img.onload  = done;
        img.src = FALLBACK_IMG;
      };
      img.src = code5 ? (IMG_DIR + code5 + '.webp') : FALLBACK_IMG;
    });
  }

  function nextFrame(){ return new Promise(r => requestAnimationFrame(() => r())); }

  // 30枚以下前提なので「安全側に落とすscale調整」は不要。
  // ただしDPRが高い端末で荒くならないように 2〜3 に軽くクランプ。
  function getExportScale(){
    const dpr = window.devicePixelRatio || 1;
    if (dpr >= 3) return 3;
    if (dpr >= 2) return 2;
    return 2; // 1.x でも 2 に寄せる（文字が潰れにくい）
  }


function downloadCanvas(canvas, fileName){
  // ✅ 共通モーダルが使えるならそれを使う（保存/共有UIつき）
  if (typeof window.showDeckImgPreviewModal === 'function') {
    window.showDeckImgPreviewModal(canvas, fileName);
    return;
  }

  // フォールバック：従来通りダウンロード直行
  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  a.click();
}

})();
