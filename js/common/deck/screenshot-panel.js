/* =========================
 * features/screenshot-panel.js
 * - スクショ画像：最小パネル + トリミング（ドラッグ）
 * - 初期化：window.initScreenshotPanel(opts)
 *   opts = {
 *     root: document,         // 探索起点（省略可）
 *     keyPrefix: 'deckmaker', // localStorageキー接頭辞
 *     ids: { ... }            // DOM id上書き（省略可）
 *   }
 * ========================= */
(function(){
'use strict';

const DEFAULT_IDS = {
    openBtn:   'screenshot-save-btn',
    backdrop:  'shot-panel-backdrop',
    panel:     'shot-panel',
    imgEl:     'shot-img',
    pickBtn:   'shot-pick',
    hintEl:    'shot-hint',
    closeBtn:  'shot-close',
    delBtn:    'shot-remove',

    cropModal: 'shot-crop-modal',
    cropClose: 'shot-crop-close',
    cropCancel:'shot-crop-cancel',
    cropApply: 'shot-crop-apply',

    stage:     'shot-crop-stage',
    cropImg:   'shot-crop-img',
    maskTop:   'shot-crop-mask-top',
    maskBot:   'shot-crop-mask-bot',
    barTop:    'shot-crop-bar-top',
    barBot:    'shot-crop-bar-bot',
    readout:   'shot-crop-readout',
};

function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

function toast_(msg){
    try{
    if (typeof window.dmToast === 'function')          return window.dmToast(msg);
    if (typeof window.simpleToast === 'function')      return window.simpleToast(msg);
    if (typeof window.showRestoreToast === 'function') return window.showRestoreToast(msg);
    if (typeof window.showToast === 'function')        return window.showToast(msg);
    }catch(_){}
}

// object-fit: contain の「実際に画像が描画されている矩形」を計算
function getContainRect(stageEl, naturalW, naturalH){
    const r = stageEl.getBoundingClientRect();
    const sw = r.width, sh = r.height;
    if (!naturalW || !naturalH || !sw || !sh) return { x:0, y:0, w:sw, h:sh };

    const imgAR = naturalW / naturalH;
    const stageAR = sw / sh;
    let w, h, x, y;

    if (imgAR > stageAR){
    w = sw;
    h = sw / imgAR;
    x = 0;
    y = (sh - h) / 2;
    }else{
    h = sh;
    w = sh * imgAR;
    y = 0;
    x = (sw - w) / 2;
    }
    return { x, y, w, h };
}

async function buildPreviewLow_(rawDataUrl, topP, bottomP){
    const img = new Image();
    img.src = rawDataUrl;

    await new Promise((res, rej)=>{
    img.onload = ()=>res();
    img.onerror = ()=>rej(new Error('image load failed'));
    });

    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight|| img.height;

    const topPx    = Math.floor(sh * (topP/100));
    const bottomPx = Math.floor(sh * (bottomP/100));

    let sy = topPx;
    let ch = sh - topPx - bottomPx;
    if (ch < 10){ sy = 0; ch = sh; }

    const maxW  = 720;
    const scale = (sw > maxW) ? (maxW/sw) : 1;
    const cw  = Math.round(sw*scale);
    const ch2 = Math.round(ch*scale);

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch2;

    const ctx = canvas.getContext('2d', {alpha:false});
    ctx.drawImage(img, 0, sy, sw, ch, 0, 0, cw, ch2);

    return canvas.toDataURL('image/jpeg', 0.75);
}

function initScreenshotPanel(opts = {}){
    const root = opts.root || document;
    const keyPrefix = String(opts.keyPrefix || 'deckmaker').trim() || 'deckmaker';
    const ids = Object.assign({}, DEFAULT_IDS, opts.ids || {});

    const LS_CROP = `${keyPrefix}_screenshot_crop`; // {"top":12,"bottom":12}
    const LS_OUT  = `${keyPrefix}_screenshot`;      // dataURL

    // ---- panel ----
    const openBtn  = root.getElementById ? root.getElementById(ids.openBtn)  : document.getElementById(ids.openBtn);
    const backdrop = document.getElementById(ids.backdrop);
    const panel    = document.getElementById(ids.panel);
    const imgEl    = document.getElementById(ids.imgEl);
    const pickBtn  = document.getElementById(ids.pickBtn);
    const hintEl   = document.getElementById(ids.hintEl);
    const closeBtn = document.getElementById(ids.closeBtn);
    const delBtn   = document.getElementById(ids.delBtn);

    // ---- crop modal ----
    const cropModal = document.getElementById(ids.cropModal);
    const cropClose = document.getElementById(ids.cropClose);
    const cropCancel= document.getElementById(ids.cropCancel);
    const cropApply = document.getElementById(ids.cropApply);

    const stage     = document.getElementById(ids.stage);
    const cropImg   = document.getElementById(ids.cropImg);
    const maskTop   = document.getElementById(ids.maskTop);
    const maskBot   = document.getElementById(ids.maskBot);
    const barTop    = document.getElementById(ids.barTop);
    const barBot    = document.getElementById(ids.barBot);
    const readout   = document.getElementById(ids.readout);

    // 必須が無いページでは何もしない（featuresなので安全に）
    if (!openBtn || !panel || !imgEl || !pickBtn || !closeBtn || !delBtn) return { ok:false, reason:'missing panel nodes' };
    if (!backdrop) return { ok:false, reason:'missing backdrop' };
    if (!cropModal || !cropClose || !cropCancel || !cropApply) return { ok:false, reason:'missing crop modal nodes' };
    if (!stage || !cropImg || !maskTop || !maskBot || !barTop || !barBot || !readout) return { ok:false, reason:'missing crop stage nodes' };

    const CROP_MAX = 90;

    const openPanel = ()=>{
    panel.hidden = false;
    backdrop.hidden = false;
    };
    const closePanel = ()=>{
    panel.hidden = true;
    backdrop.hidden = true;
    };

    const openCrop = ()=>{
    cropModal.hidden = false;
    cropModal.style.display = 'flex';
    };
    const closeCrop = ()=>{
    cropModal.hidden = true;
    cropModal.style.display = 'none';
    };

    function getSavedCrop(){
    try{
        const o = JSON.parse(localStorage.getItem(LS_CROP) || '{}');
        return {
        top:    clamp(parseInt(o.top ?? 12,10)||0, 0, CROP_MAX),
        bottom: clamp(parseInt(o.bottom ?? 12,10)||0, 0, CROP_MAX),
        };
    }catch(_){
        return { top: 12, bottom: 12 };
    }
    }

    function setSavedCrop(top,bottom){
    top = clamp(parseInt(top,10)||0, 0, CROP_MAX);
    bottom = clamp(parseInt(bottom,10)||0, 0, CROP_MAX);
    localStorage.setItem(LS_CROP, JSON.stringify({top, bottom}));
    }

    function renderPanel(){
    const saved = localStorage.getItem(LS_OUT);
    if (saved){
        imgEl.src = saved;
        imgEl.hidden = false;
        pickBtn.hidden = true;
        if (hintEl) hintEl.hidden = true;
        delBtn.hidden = false;
    }else{
        imgEl.src = '';
        imgEl.hidden = true;
        pickBtn.hidden = false;
        if (hintEl) hintEl.hidden = false;
        delBtn.hidden = true;
    }
    }

    function applyShotAspect_(){
    const w = imgEl.naturalWidth  || 0;
    const h = imgEl.naturalHeight || 0;
    if (!w || !h) return;
    panel.style.setProperty('--shot-ar', `${w} / ${h}`);
    }
    imgEl.addEventListener('load', applyShotAspect_);

    // ===== crop preview state =====
    let __editingRaw = null;
    let __top = 12;
    let __bottom = 12;
    let __active = null;     // 'top' | 'bottom'
    let __previewOut = null; // dataURL

    function updateOverlay(){
    const rectStage = stage.getBoundingClientRect();
    const Hs = rectStage.height;

    const naturalW = cropImg.naturalWidth || 0;
    const naturalH = cropImg.naturalHeight || 0;
    const box = getContainRect(stage, naturalW, naturalH);

    const topY = box.y + (box.h * (__top/100));
    const botY = box.y + (box.h * (1 - __bottom/100));

    maskTop.style.height = `${topY}px`;
    maskBot.style.height = `${Math.max(0, Hs - botY)}px`;
    barTop.style.top = `${topY}px`;
    barBot.style.top = `${botY}px`;

    readout.textContent = `上 ${__top}% / 下 ${__bottom}%`;
    }

    let __t = null;
    function schedulePreview(){
    clearTimeout(__t);
    __t = setTimeout(async ()=>{
        if (!__editingRaw) return;
        __previewOut = await buildPreviewLow_(__editingRaw, __top, __bottom).catch(()=>null);
    }, 80);
    }

    function beginCrop(rawDataUrl){
    __editingRaw = rawDataUrl;
    const saved = getSavedCrop();
    __top = saved.top;
    __bottom = saved.bottom;
    __previewOut = null;

    cropImg.src = rawDataUrl;
    openCrop();
    requestAnimationFrame(updateOverlay);
    schedulePreview();
    }

    function setFromPointer(e){
    const rectStage = stage.getBoundingClientRect();
    const yStage = clamp(e.clientY - rectStage.top, 0, rectStage.height);

    const naturalW = cropImg.naturalWidth || 0;
    const naturalH = cropImg.naturalHeight || 0;
    const box = getContainRect(stage, naturalW, naturalH);

    const yInImg = clamp(yStage - box.y, 0, box.h);
    const p = Math.round((yInImg / box.h) * 100);

    if (__active === 'top'){
        __top = clamp(p, 0, CROP_MAX);
        if (__top + __bottom > CROP_MAX) __top = CROP_MAX - __bottom;
    }else if (__active === 'bottom'){
        const bottomP = 100 - p;
        __bottom = clamp(bottomP, 0, CROP_MAX);
        if (__top + __bottom > CROP_MAX) __bottom = CROP_MAX - __top;
    }

    updateOverlay();
    schedulePreview();
    }

    function onBarDown(which, e){
    e.preventDefault();
    e.stopPropagation();
    __active = which;
    stage.setPointerCapture?.(e.pointerId);
    setFromPointer(e);
    }

    barTop.addEventListener('pointerdown', (e)=>onBarDown('top', e));
    barBot.addEventListener('pointerdown', (e)=>onBarDown('bottom', e));

    stage.addEventListener('pointermove', (e)=>{
    if (!__active) return;
    setFromPointer(e);
    });
    stage.addEventListener('pointerup', ()=>{ __active = null; });
    stage.addEventListener('pointercancel', ()=>{ __active = null; });

    cropImg.addEventListener('load', ()=>{ updateOverlay(); });
    window.addEventListener('resize', ()=>{
    if (cropModal.hidden) return;
    updateOverlay();
    }, { passive: true });

    function pickImage(){
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = ()=>{
        const f = input.files?.[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = ()=> beginCrop(r.result);
        r.readAsDataURL(f);
    };
    input.click();
    }

    cropClose.addEventListener('click', ()=>{ closeCrop(); __editingRaw=null; });
    cropCancel.addEventListener('click', ()=>{ closeCrop(); __editingRaw=null; });

    cropApply.addEventListener('click', async ()=>{
    if (!__editingRaw) return;

    setSavedCrop(__top, __bottom);
    if (!__previewOut) __previewOut = await buildPreviewLow_(__editingRaw, __top, __bottom).catch(()=>null);

    localStorage.removeItem(LS_OUT);

    try {
        if (__previewOut) localStorage.setItem(LS_OUT, __previewOut);
    } catch (e) {
        try {
        __previewOut = await buildPreviewLow_(__editingRaw, __top, __bottom);
        localStorage.setItem(LS_OUT, __previewOut);
        } catch (_) {
        toast_('保存できませんでした（容量オーバー）。別の小さめ画像で試してください');
        return;
        }
    }

    __editingRaw = null;
    closeCrop();
    renderPanel();
    openPanel();
    toast_('📸ボタンやリスト外タップで閉じられます');
    });

    // panel buttons
    let __suppressOpenClick = false;

    openBtn.addEventListener('pointerdown', (e)=>{
    e.preventDefault();
    e.stopPropagation();

    renderPanel();

    if (!panel.hidden){
        closePanel();
        __suppressOpenClick = true;
        setTimeout(()=>{ __suppressOpenClick = false; }, 350);
        return;
    }
    openPanel();
    }, { passive:false });

    openBtn.addEventListener('click', (e)=>{
    if (__suppressOpenClick){
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    });

    pickBtn.addEventListener('click', (e)=>{
    e.preventDefault();
    e.stopPropagation();
    pickImage();
    });

    closeBtn.addEventListener('click', (e)=>{
    e.preventDefault();
    e.stopPropagation();
    closePanel();
    });

    // backdrop tap to close (no close on swipe/scroll)
    let __bdDown = false, __bdMoved = false, __bdX = 0, __bdY = 0;
    const TAP_MOVE_PX = 10;

    backdrop.addEventListener('pointerdown', (e)=>{
    __bdDown = true;
    __bdMoved = false;
    __bdX = e.clientX;
    __bdY = e.clientY;
    e.stopPropagation();
    backdrop.setPointerCapture?.(e.pointerId);
    }, { passive:true });

    backdrop.addEventListener('pointermove', (e)=>{
    if (!__bdDown) return;
    const dx = e.clientX - __bdX;
    const dy = e.clientY - __bdY;
    if (Math.hypot(dx, dy) > TAP_MOVE_PX) __bdMoved = true;
    }, { passive:true });

    backdrop.addEventListener('pointerup', (e)=>{
    if (!__bdDown) return;
    __bdDown = false;
    e.stopPropagation();
    if (!__bdMoved) closePanel();
    }, { passive:true });

    backdrop.addEventListener('pointercancel', ()=>{
    __bdDown = false;
    __bdMoved = false;
    }, { passive:true });

    delBtn.addEventListener('click', (e)=>{
    e.preventDefault();
    e.stopPropagation();
    localStorage.removeItem(LS_CROP);
    localStorage.removeItem(LS_OUT);
    renderPanel();
    });

    // init
    renderPanel();
    closePanel();
    closeCrop();

    return {
    ok: true,
    keyPrefix,
    getDataUrl: ()=> localStorage.getItem(LS_OUT) || '',
    clear: ()=>{
        localStorage.removeItem(LS_CROP);
        localStorage.removeItem(LS_OUT);
        renderPanel();
    },
    };
}

window.initScreenshotPanel = window.initScreenshotPanel || initScreenshotPanel;
})();
