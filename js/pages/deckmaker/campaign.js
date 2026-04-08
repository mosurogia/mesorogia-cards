/* =========================
 * js/dom/campaign.js
 * - DeckMaker キャンペーンUI（ミニ告知/バナー/タグ同期/参加確認モーダル）
 *
 * 依存（存在すれば使う）
 * - window.fetchActiveCampaign() : 現在開催中キャンペーン取得（external側）
 * - window.Auth                 : { user, token, verified }
 * - window.__dmReadSelectedTags / __dmWriteSelectedTags : 選択タグの永続化（post.js側が本命）
 * - window.onDeckPostAuthChanged : ログイン状態変化のフック（あれば追記）
 * - window.submitDeckPost(e, {joinCampaign}) : 投稿実処理（post.js）
 * ========================= */
(function(){
  'use strict';

  const DM_SELECT_TAGS_KEY = 'dm_post_select_tags_v1';

  // -----------------------------
  // small utils
  // -----------------------------
  function escapeHtml(s){
    return String(s ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function formatYmdFallback(d){
    try{
      const y = d.getFullYear();
      const m = d.getMonth()+1;
      const day = d.getDate();
      return `${y}/${m}/${day}`;
    }catch(_){
      return '';
    }
  }

  function fmtYmd(d){
    if (!d || isNaN(d)) return '';
    try{
      if (typeof window.formatYmd === 'function') return window.formatYmd(d);
    }catch(_){}
    return formatYmdFallback(d);
  }

  async function fetchActiveCampaignSafe(opts){
    try{
      // ui-utils.js 互換：ttlMs を渡す呼び方を吸収
      // fetchActiveCampaign が引数を受けない実装でも問題ないように try/catch で守る
      return await (window.fetchActiveCampaign?.(opts) || Promise.resolve(null));
    }catch(_){
      try{
        // 念のため引数なしでも再トライ
        return await (window.fetchActiveCampaign?.() || Promise.resolve(null));
      }catch(__){
        return null;
      }
    }
  }

  function isCampaignActive(camp){
    return !!(
      camp &&
      (camp.isActive === true || String(camp.isActive) === 'true') &&
      String(camp.campaignId || '').trim()
    );
  }

  // -----------------------------
  // Selected-tags bridge (fallback)
  // ※ post.js 側が定義しているならそれを優先
  // -----------------------------
  function ensureDmSelectedTagsBridge(){
    window.__dmReadSelectedTags ??= function(){
      try { return new Set(JSON.parse(localStorage.getItem(DM_SELECT_TAGS_KEY) || '[]')); }
      catch { return new Set(); }
    };
    window.__dmWriteSelectedTags ??= function(setOrArray){
      try{
        const arr = Array.isArray(setOrArray) ? setOrArray : Array.from(setOrArray || []);
        localStorage.setItem(DM_SELECT_TAGS_KEY, JSON.stringify(arr));
      }catch(_){}
    };
  }

  // -----------------------------
  // 1) Mini notice
  // -----------------------------
  async function renderDeckmakerCampaignMiniNotice(){
    const box  = document.getElementById('campaign-mini');
    const text = document.getElementById('campaign-mini-text');
    if (!box || !text) return;

    const camp = await fetchActiveCampaignSafe({ ttlMs: 60000 });

    if (!isCampaignActive(camp)) {
      box.style.display = 'none';
      return;
    }

    const title = String(camp?.title || '').trim();
    const msg = title
      ? `${escapeHtml(title)}開催中！<wbr>デッキ投稿募集中！`
      : `キャンペーン開催中！<wbr>デッキ投稿募集中！`;

    text.innerHTML = msg;
    box.style.display = '';
  }

  // -----------------------------
  // 2) Banner + tag sync + eligibility UI
  // -----------------------------
  async function renderDeckmakerCampaignBanner(){
    const box = document.getElementById('campaign-banner');
    const titleEl = document.getElementById('campaign-banner-title');
    const textEl  = document.getElementById('campaign-banner-text');
    const rangeEl = document.getElementById('campaign-banner-range');
    if (!box || !titleEl || !textEl) return;

    const camp = await fetchActiveCampaignSafe({ ttlMs: 60000 });

    if (!isCampaignActive(camp)) {
      box.style.display = 'none';
      window.__activeCampaign = null;
      window.__activeCampaignTag = '';
      return;
    }

    const rawTitle = String(camp?.title || 'キャンペーン');
    const start = camp?.startAt ? new Date(camp.startAt) : null;
    const end   = camp?.endAt   ? new Date(camp.endAt)   : null;

    const computedRange = (start || end) ? `${fmtYmd(start)}〜${fmtYmd(end)}` : '';

    const titleHasRange =
      /[（(]\s*\d{4}\/\d{1,2}\/\d{1,2}\s*〜\s*\d{4}\/\d{1,2}\/\d{1,2}\s*[)）]/.test(rawTitle);

    const cleanTitle = rawTitle
      .replace(/[（(]\s*\d{4}\/\d{1,2}\/\d{1,2}\s*〜\s*\d{4}\/\d{1,2}\/\d{1,2}\s*[)）]\s*/g, '')
      .trim();

    titleEl.textContent = cleanTitle || 'キャンペーン';
    if (rangeEl) rangeEl.textContent = (!titleHasRange && computedRange) ? computedRange : '';

    textEl.textContent =
      'デッキを投稿して、キャンペーンに参加しよう！ 詳しい参加条件や報酬は、詳細をチェック！';

    box.style.display = '';

    // --- global share (1 campaign assumption) ---
    window.__activeCampaign = camp;
    window.__activeCampaignTag = (cleanTitle || 'キャンペーン').trim();

    //  campaign tag が確定したので、投稿タグUIを再描画（post.js）
    try { window.renderPostSelectTags?.(); } catch(_) {}

    const tagRow  = document.getElementById('campaign-banner-tagrow');
    const tagBtn  = document.getElementById('campaign-tag-toggle');

    const getAuthState = ()=>{
      const A = window.Auth;
      const loggedIn = !!(A?.user && A?.token && A?.verified);

      const xRaw = document.getElementById('auth-x')?.value || '';
      const xAccount = String(xRaw).trim().replace(/^@+/, '');
      const hasX = !!xAccount;

      return { loggedIn, hasX, xAccount };
    };

    const criteriaRoot = box.querySelector('.campaign-criteria');

    function updateCriteriaUI({ isLoggedIn, hasX, hasTag }){
      if (!criteriaRoot) return;
      const map = { login: !!isLoggedIn, x: !!hasX, tag: !!hasTag };

      criteriaRoot.querySelectorAll('.criteria-item').forEach(el=>{
        const key = el.dataset.criteria;
        const ok = !!map[key];
        el.classList.toggle('is-ok', ok);
        el.classList.toggle('is-ng', !ok);
      });
    }

    const campTag = ()=> String(window.__activeCampaignTag || '').trim();

    const isCampaignTagSelected = ()=>{
      const tag = campTag();
      if (!tag) return false;
      try{
        const set = window.__dmReadSelectedTags?.();
        return !!(set && set.has && set.has(tag));
      }catch(_){
        return false;
      }
    };

    const setCampaignTagSelected = (on)=>{
      const tag = campTag();
      if (!tag) return;

      // 1) data (truth)
      try{
        const set = window.__dmReadSelectedTags?.() || new Set();
        if (on) set.add(tag); else set.delete(tag);
        window.__dmWriteSelectedTags?.(set);
      }catch(_){}

      // 2) #select-tags UI sync (if exists)
      const wrap = document.getElementById('select-tags');
      if (wrap){
        const chip = wrap.querySelector(`.chip[data-label="${CSS.escape(tag)}"]`);
        if (chip) chip.classList.toggle('active', !!on);
      }

      // 3) banner tag UI sync
      if (tagBtn){
        tagBtn.classList.toggle('active', !!on);
        tagBtn.setAttribute('aria-pressed', String(!!on));
      }

      // 4) criteria refresh
      try{ window.updateCampaignBannerEligibility_?.(); }catch(_){}
    };

    const refreshCampaignTagUI = ()=>{
      if (!tagRow || !tagBtn) return;
      tagRow.style.display = '';
      tagBtn.textContent = campTag() || 'キャンペーン';
      tagBtn.disabled = false; // login前でも押せる
      setCampaignTagSelected(isCampaignTagSelected()); // UI sync only
    };

    window.updateCampaignBannerEligibility_ = function(){
      const st = getAuthState();
      updateCriteriaUI({
        isLoggedIn: st.loggedIn,
        hasX: st.hasX,
        hasTag: isCampaignTagSelected(),
      });
    };

    if (tagRow && tagBtn){
      tagBtn.onclick = ()=>{
        const next = !isCampaignTagSelected();
        setCampaignTagSelected(next);
      };
      refreshCampaignTagUI();
    }

    if (!window.__campaignTagHooked){
      window.__campaignTagHooked = true;
      const orig = window.onDeckPostAuthChanged;
      window.onDeckPostAuthChanged = function(...args){
        try { orig?.apply(this, args); } catch(_) {}
        try { refreshCampaignTagUI(); } catch(_) {}
      };
    }

    window.updateCampaignBannerEligibility_();
  }

  // -----------------------------
  // 3) Eligibility check (for modal / submit)
  // -----------------------------
  function checkCampaignEligibility_(camp){
    const reasons = [];

    const A = window.Auth;
    const loggedIn = !!(A?.user && A?.token && A?.verified);
    if (!loggedIn) reasons.push('ログインが必要です');

    const xRaw = document.getElementById('auth-x')?.value || '';
    const x = String(xRaw).trim().replace(/^@+/, '');
    if (!x) reasons.push('Xアカウントが未入力です');

    const needTag = String(window.__activeCampaignTag || '').trim();
    let hasTag = false;
    try{
      const set = window.__dmReadSelectedTags?.() || new Set();
      hasTag = !!(needTag && set.has(needTag));
    }catch(_){}
    if (!hasTag) reasons.push('キャンペーンタグが未選択です');

    return { ok: reasons.length === 0, reasons };
  }

  // -----------------------------
  // 4) Modal
  // -----------------------------
  function openCampaignConfirmModal({ mode, reasons = [], onJoin, onSkip, onProceed }){
    const modal = document.createElement('div');
    modal.className = 'campaign-confirm-modal';

    const body =
      mode === 'ok'
        ? `
          <h3>🎉 キャンペーン開催中！</h3>
          <p>このデッキはキャンペーン条件を満たしています。</p>
          <p>キャンペーンに参加して投稿しますか？</p>
        `
        : `
          <h3>⚠ キャンペーン開催中</h3>
          <p>以下の条件を満たしていません：</p>
          <ul>${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
          <p>キャンペーンには参加できませんが、投稿は可能です。</p>
        `;

    modal.innerHTML = `
      <div class="modal-content">
        ${body}
        <div class="modal-actions">
          ${
            mode === 'ok'
              ? `
                <button class="primary">参加して投稿</button>
                <button class="ghost">参加せず投稿</button>
              `
              : `<button class="primary">投稿する</button>`
          }
          <button class="cancel">キャンセル</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelectorAll('button').forEach(btn=>{
      btn.onclick = ()=>{
        modal.remove();
        if (btn.classList.contains('primary')){
          mode === 'ok' ? onJoin?.() : onProceed?.();
        }
        if (btn.classList.contains('ghost')) onSkip?.();
      };
    });
  }

  // -----------------------------
  // 5) Post-button click handler (optional wiring)
  // -----------------------------
  async function onClickPostButton(){
    const camp = await fetchActiveCampaignSafe({ ttlMs: 60000 });
    const active = !!(camp && (camp.isActive === true || String(camp.isActive) === 'true'));

    if (!active){
      window.submitDeckPost?.(null, { joinCampaign: false });
      return;
    }

    const result = checkCampaignEligibility_(camp);

    if (result.ok){
      openCampaignConfirmModal({
        mode: 'ok',
        onJoin: () => window.submitDeckPost?.(null, { joinCampaign: true }),
        onSkip: () => window.submitDeckPost?.(null, { joinCampaign: false }),
      });
    }else{
      openCampaignConfirmModal({
        mode: 'ng',
        reasons: result.reasons,
        onProceed: () => window.submitDeckPost?.(null, { joinCampaign: false }),
      });
    }
  }

  // -----------------------------
  // 6) init/bind
  // -----------------------------
  function bindEligibilityWatchers(){
    // select-tags click → 1tick後に再判定（post.js がlocalStorage更新する想定）
    document.addEventListener('click', (e)=>{
      const chip = e.target?.closest?.('#select-tags .chip');
      if (!chip) return;
      setTimeout(() => window.updateCampaignBannerEligibility_?.(), 0);
    });

    // auth-x input
    const x = document.getElementById('auth-x');
    if (x){
      x.addEventListener('input', ()=> window.updateCampaignBannerEligibility_?.());
    }
  }

  function initDeckmakerCampaignUI(){
    // ✅ 多重バインド防止（loader/互換呼び出しで複数回呼ばれても安全に）
    if (window.__campaignUIInited) return;
    window.__campaignUIInited = true;

    ensureDmSelectedTagsBridge();

    // DOM ready 後にbind（安全）
    const run = ()=>{
      bindEligibilityWatchers();
      try { renderDeckmakerCampaignMiniNotice(); } catch(e){ console.warn('campaign mini error', e); }
      try { renderDeckmakerCampaignBanner(); } catch(e){ console.warn('campaign banner error', e); }
    };

    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', run, { once: true });
    }else{
      run();
    }
  }

  // loader呼び忘れの保険：deckmakerでは自動で初期化しておく
  try { initDeckmakerCampaignUI(); } catch(_) {}

  // -----------------------------
  // Expose
  // -----------------------------
  window.CampaignUI = {
    initDeckmakerCampaignUI,
    renderDeckmakerCampaignMiniNotice,
    renderDeckmakerCampaignBanner,
    checkCampaignEligibility_,
    openCampaignConfirmModal,
    onClickPostButton,
  };

  // 互換（必要なら）
  window.checkCampaignEligibility_ ??= checkCampaignEligibility_;
  window.openCampaignConfirmModal ??= openCampaignConfirmModal;
  window.onClickPostButton        ??= onClickPostButton;

  // 互換export（page2互換で呼ばれても落ちないように）
  window.renderDeckmakerCampaignMiniNotice ??= renderDeckmakerCampaignMiniNotice;
  window.renderDeckmakerCampaignBanner     ??= renderDeckmakerCampaignBanner;
})();