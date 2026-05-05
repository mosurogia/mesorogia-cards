/* =========================
 * js/pages/deckmaker/deckmaker-campaign.js
 * - DeckMaker キャンペーンUI（ミニ告知/バナー/タグ同期/参加確認モーダル）
 *
 * 依存（存在すれば使う）
 * - window.fetchActiveCampaign() : 現在開催中キャンペーン取得（external側）
 * - window.Auth                 : { user, token, verified }
 * - window.__dmReadSelectedTags / __dmWriteSelectedTags : 選択タグの永続化（deckmaker-post.js側が本命）
 * - window.onDeckPostAuthChanged : ログイン状態変化のフック（あれば追記）
 * - window.submitDeckPost(e, {joinCampaign}) : 投稿実処理（deckmaker-post.js）
 * ========================= */
(function(){
  'use strict';

  const DM_SELECT_TAGS_KEY = 'dm_post_select_tags_v1';
  const escapeHtml = window.escapeHtml_;
  const fmtYmd = window.formatYmd;

  // -----------------------------
  // small utils
  // -----------------------------
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

  function parseCampaignRules_(camp){
    const direct = camp?.rules;
    if (direct && typeof direct === 'object') return direct || {};
    const raw = camp?.rulesJSON;
    if (!raw) return {};
    if (typeof raw === 'object') return raw || {};
    try { return JSON.parse(String(raw)) || {}; } catch(_) { return {}; }
  }

  function campaignRequiresGameUserId_(camp){
    const rules = parseCampaignRules_(camp);
    return !!rules.requireGameUserId;
  }

  function getDeckConditionRules_(camp){
    const rules = parseCampaignRules_(camp);
    return Array.isArray(rules.deckConditions) ? rules.deckConditions : [];
  }

  function formatDeckConditionLabel_(cond){
    const type = String(cond?.type || '').trim();
    const rarity = String(cond?.rarity || '').trim();
    const max = Number(cond?.max ?? cond?.value);
    const min = Number(cond?.min ?? cond?.value);

    if (cond?.label) return String(cond.label);
    if (type === 'rarityMax' && rarity && Number.isFinite(max)) return `${rarity}${max}枚以下`;
    if (type === 'rarityMin' && rarity && Number.isFinite(min)) return `${rarity}${min}枚以上`;
    return '指定デッキ条件';
  }

  function getCurrentRarityCounts_(){
    const deckMap = window.deck || {};
    const cardMap = window.cardMap || window.allCardsMap || {};

    try{
      if (typeof window.buildDeckAnalysisCards === 'function' && typeof window.analyzeDeckCards === 'function'){
        const cards = window.buildDeckAnalysisCards(deckMap, cardMap);
        const analysis = window.analyzeDeckCards(cards);
        return analysis?.rarityCounts || {};
      }
    }catch(_){}

    const counts = {};
    Object.entries(deckMap || {}).forEach(([cdRaw, nRaw]) => {
      const n = Number(nRaw || 0) || 0;
      if (!n) return;
      const cd = typeof window.normCd5 === 'function'
        ? window.normCd5(cdRaw)
        : String(cdRaw ?? '').trim().padStart(5, '0').slice(0, 5);
      const card = cardMap[cd] || cardMap[String(cdRaw)] || null;
      const rarity = String(card?.rarity || '').trim();
      if (!rarity) return;
      counts[rarity] = (counts[rarity] || 0) + n;
    });
    return counts;
  }

  function checkDeckConditions_(camp){
    const conditions = getDeckConditionRules_(camp);
    if (!conditions.length) return { ok: true, reasons: [] };

    const rarityCounts = getCurrentRarityCounts_();
    const reasons = [];

    conditions.forEach(cond => {
      const type = String(cond?.type || '').trim();
      const rarity = String(cond?.rarity || '').trim();
      const count = Number(rarityCounts[rarity] || 0);
      const max = Number(cond?.max ?? cond?.value);
      const min = Number(cond?.min ?? cond?.value);
      const label = formatDeckConditionLabel_(cond);

      if (type === 'rarityMax' && rarity && Number.isFinite(max) && count > max){
        reasons.push(`${label}（現在${count}枚）`);
      }else if (type === 'rarityMin' && rarity && Number.isFinite(min) && count < min){
        reasons.push(`${label}（現在${count}枚）`);
      }
    });

    return { ok: reasons.length === 0, reasons };
  }

  function getDeckConditionSummary_(camp){
    const conditions = getDeckConditionRules_(camp);
    if (!conditions.length) return '';
    return conditions.map(formatDeckConditionLabel_).join(' / ');
  }

  function getCampaignTagRequirementResult_(camp){
    const reasons = [];

    const deckResult = checkDeckConditions_(camp);
    if (!deckResult.ok) {
      deckResult.reasons.forEach(reason => reasons.push(`デッキ条件：${reason}`));
    }

    const A = window.Auth;
    const loggedIn = !!(A?.user && A?.token && A?.verified);
    if (!loggedIn) reasons.push('ログインを完了してください');

    const xRaw = document.getElementById('auth-x')?.value || '';
    const x = String(xRaw).trim().replace(/^@+/, '');
    if (!x) reasons.push('Xアカウントを入力してください');

    if (campaignRequiresGameUserId_(camp)){
      const gameUserId = readCampaignGameUserId_();
      if (!isValidGameUserId_(gameUserId)) reasons.push('ゲーム内ユーザーIDを16桁で入力してください');
    }

    return { ok: reasons.length === 0, reasons };
  }

  function openCampaignTagHelpModal_(reasons){
    const list = Array.isArray(reasons) ? reasons.filter(Boolean) : [];
    const modal = document.createElement('div');
    modal.className = 'campaign-tag-help-modal';
    modal.innerHTML = `
      <div class="modal-content campaign-tag-help-content" role="dialog" aria-modal="true" aria-labelledby="campaignTagHelpTitle">
        <h3 id="campaignTagHelpTitle">キャンペーンタグはまだ追加できません</h3>
        <p>下の条件を満たすことでタグを追加できます。</p>
        ${
          list.length
            ? `<ul class="campaign-tag-help-list">${list.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
            : '<p>条件の再判定を行ってから、もう一度タグをタップしてください。</p>'
        }
        <div class="modal-actions">
          <button type="button" class="primary" data-close-campaign-tag-help>閉じる</button>
        </div>
      </div>
    `;

    let keyHandler = null;
    const close = () => {
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      modal.remove();
    };
    modal.addEventListener('click', (e)=>{
      if (e.target === modal || e.target.closest('[data-close-campaign-tag-help]')) close();
    });
    keyHandler = function onKeyDown(e){
      if (e.key !== 'Escape') return;
      close();
    };
    document.addEventListener('keydown', keyHandler);

    document.body.appendChild(modal);
    modal.querySelector('button')?.focus?.();
  }

  function handleCampaignTagAttempt_(label){
    const tag = String(window.__activeCampaignTag || '').trim();
    if (!tag || String(label || '').trim() !== tag) return true;

    const camp = window.__activeCampaign;
    const result = getCampaignTagRequirementResult_(camp);
    if (result.ok) return true;

    try { window.updateCampaignBannerEligibility_?.(); } catch(_) {}
    openCampaignTagHelpModal_(result.reasons);
    return false;
  }

  function normalizeGameUserId_(value){
    return String(value || '')
      .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/\D/g, '')
      .slice(0, 16);
  }

  function isValidGameUserId_(value){
    return /^\d{16}$/.test(String(value || ''));
  }

  function readCampaignGameUserId_(){
    const input = document.getElementById('campaign-game-user-id');
    const value = normalizeGameUserId_(input?.value || '');
    if (input && input.value !== value) input.value = value;
    return value;
  }

  let campaignGameUserIdInputBound_ = false;
  let onCampaignGameUserIdChanged_ = null;

  function updateCampaignGameUserIdStatus_(value){
    const status = document.getElementById('campaign-game-user-id-status');
    if (!status) return;

    const v = String(value || '');
    const ok = isValidGameUserId_(v);
    status.classList.toggle('is-ok', ok);
    status.classList.toggle('is-ng', !!v && !ok);
    status.classList.toggle('is-empty', !v);
    status.textContent = !v ? '未入力' : (ok ? 'OK' : 'NG');
  }

  function bindCampaignGameUserIdInput_(onChange){
    const input = document.getElementById('campaign-game-user-id');
    if (!input) return;

    if (typeof onChange === 'function') onCampaignGameUserIdChanged_ = onChange;

    const sync = ()=>{
      const value = normalizeGameUserId_(input.value);
      if (input.value !== value) input.value = value;
      input.setCustomValidity(
        !value || isValidGameUserId_(value) ? '' : 'ゲーム内ユーザーIDは16桁で入力してください'
      );
      updateCampaignGameUserIdStatus_(value);
      try { onCampaignGameUserIdChanged_?.(); } catch(_) {}
      try { window.updateCampaignBannerEligibility_?.(); } catch(_) {}
    };

    if (!campaignGameUserIdInputBound_){
      input.addEventListener('input', sync);
      campaignGameUserIdInputBound_ = true;
    }
    sync();
  }

  // -----------------------------
  // Selected-tags bridge (fallback)
  // ※ deckmaker-post.js 側が定義しているならそれを優先
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
      window.__activeCampaignRequiresGameUserId = false;
      return;
    }

    const needsGameUserId = campaignRequiresGameUserId_(camp);
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
    window.__activeCampaignRequiresGameUserId = needsGameUserId;

    //  campaign tag が確定したので、投稿タグUIを再描画（deckmaker-post.js）
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

    const gameUserIdWrap = document.getElementById('campaign-game-user-id-wrap');
    const gameUserIdCriteria = criteriaRoot?.querySelector?.('[data-criteria="game-user-id"]');
    const deckConditionCriteria = criteriaRoot?.querySelector?.('[data-criteria="deck-condition"]');
    const deckConditionText = document.getElementById('campaign-deck-condition-text');
    const tagHelp = document.getElementById('campaign-tag-help');
    const deckConditions = getDeckConditionRules_(camp);
    const needsDeckCondition = deckConditions.length > 0;

    if (gameUserIdWrap) gameUserIdWrap.style.display = needsGameUserId ? '' : 'none';
    if (gameUserIdCriteria) gameUserIdCriteria.style.display = needsGameUserId ? '' : 'none';
    if (deckConditionCriteria) deckConditionCriteria.style.display = needsDeckCondition ? '' : 'none';
    if (deckConditionText && needsDeckCondition) {
      deckConditionText.textContent = `デッキ条件：${getDeckConditionSummary_(camp)}`;
    }
    const requirementParts = [
      ...(needsDeckCondition ? ['デッキ条件'] : []),
      'ログイン',
      'Xアカウント',
      ...(needsGameUserId ? ['必要なID入力'] : []),
    ];
    const requirementText = `${requirementParts.join('、')}が完了すると選択できます`;
    if (tagHelp) {
      tagHelp.textContent = `${requirementText.replace('選択できます', '')}下の対象タグを選択できます。`;
    }

    function updateCriteriaUI({ isLoggedIn, hasX, hasTag, hasGameUserId, deckOk }){
      if (!criteriaRoot) return;
      const map = {
        'deck-condition': needsDeckCondition ? !!deckOk : true,
        login: !!isLoggedIn,
        x: !!hasX,
        tag: !!hasTag,
        'game-user-id': needsGameUserId ? !!hasGameUserId : true,
      };

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

    const canSelectCampaignTag = ()=> getCampaignTagRequirementResult_(camp).ok;

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

    const syncCampaignTagButtonState = (canSelect)=>{
      if (!tagRow || !tagBtn) return;
      tagRow.style.display = '';
      tagBtn.textContent = campTag() || 'キャンペーン';
      tagBtn.disabled = false;
      tagBtn.classList.toggle('is-disabled', !canSelect);
      tagBtn.setAttribute('aria-disabled', String(!canSelect));
      tagBtn.title = canSelect
        ? ''
        : requirementText;
      if (tagHelp) tagHelp.classList.toggle('is-disabled', !canSelect);
      tagBtn.classList.toggle('active', isCampaignTagSelected());
      tagBtn.setAttribute('aria-pressed', String(isCampaignTagSelected()));
    };

    const refreshCampaignTagUI = ()=>{
      if (!tagRow || !tagBtn) return;
      const canSelect = canSelectCampaignTag();
      syncCampaignTagButtonState(canSelect);
      if (!canSelect && isCampaignTagSelected()) setCampaignTagSelected(false);
    };

    bindCampaignGameUserIdInput_(refreshCampaignTagUI);

    window.updateCampaignBannerEligibility_ = function(){
      const st = getAuthState();
      const deckResult = checkDeckConditions_(camp);
      const canSelect = canSelectCampaignTag();
      if (deckConditionText && needsDeckCondition) {
        deckConditionText.textContent = deckResult.ok
          ? `デッキ条件：${getDeckConditionSummary_(camp)}`
          : `デッキ条件：${deckResult.reasons.join(' / ')}`;
      }
      updateCriteriaUI({
        isLoggedIn: st.loggedIn,
        hasX: st.hasX,
        hasTag: isCampaignTagSelected(),
        hasGameUserId: isValidGameUserId_(readCampaignGameUserId_()),
        deckOk: deckResult.ok,
      });
      syncCampaignTagButtonState(canSelect);
      if (!canSelect && isCampaignTagSelected()) setCampaignTagSelected(false);
    };

    if (tagRow && tagBtn){
      tagBtn.onclick = ()=>{
        if (!canSelectCampaignTag()) {
          openCampaignTagHelpModal_(getCampaignTagRequirementResult_(camp).reasons);
          return;
        }
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

    if (!window.__campaignDeckWatcherHooked){
      window.__campaignDeckWatcherHooked = true;
      ['addCard', 'removeCard', 'updateDeck', 'renderDeckList'].forEach(name => {
        const orig = window[name];
        if (typeof orig !== 'function') return;
        window[name] = function(...args){
          const ret = orig.apply(this, args);
          setTimeout(() => window.updateCampaignBannerEligibility_?.(), 0);
          return ret;
        };
      });
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

    if (campaignRequiresGameUserId_(camp)){
      const gameUserId = readCampaignGameUserId_();
      if (!isValidGameUserId_(gameUserId)) reasons.push('ゲーム内ユーザーIDは16桁で入力してください');
    }

    const needTag = String(window.__activeCampaignTag || '').trim();
    let hasTag = false;
    try{
      const set = window.__dmReadSelectedTags?.() || new Set();
      hasTag = !!(needTag && set.has(needTag));
    }catch(_){}
    if (!hasTag) reasons.push('キャンペーンタグが未選択です');

    const deckResult = checkDeckConditions_(camp);
    if (!deckResult.ok) {
      deckResult.reasons.forEach(reason => reasons.push(`デッキ条件未達：${reason}`));
    }

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
        onJoin: () => window.submitDeckPost?.(null, { joinCampaign: true, campaign: camp }),
        onSkip: () => window.submitDeckPost?.(null, { joinCampaign: false, campaign: camp }),
      });
    }else{
      openCampaignConfirmModal({
        mode: 'ng',
        reasons: result.reasons,
        onProceed: () => window.submitDeckPost?.(null, { joinCampaign: false, campaign: camp }),
      });
    }
  }

  // -----------------------------
  // 6) init/bind
  // -----------------------------
  function bindEligibilityWatchers(){
    // select-tags click → 1tick後に再判定（deckmaker-post.js がlocalStorage更新する想定）
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
      bindCampaignGameUserIdInput_();
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
    getCampaignTagRequirementResult_,
    openCampaignTagHelpModal_,
    handleCampaignTagAttempt_,
    openCampaignConfirmModal,
    onClickPostButton,
    readCampaignGameUserId_,
    isValidGameUserId_,
    checkDeckConditions_,
  };

  // 互換（必要なら）
  window.checkCampaignEligibility_ ??= checkCampaignEligibility_;
  window.handleCampaignTagAttempt_ ??= handleCampaignTagAttempt_;
  window.openCampaignConfirmModal ??= openCampaignConfirmModal;
  window.onClickPostButton        ??= onClickPostButton;

  // 互換export（page2互換で呼ばれても落ちないように）
  window.renderDeckmakerCampaignMiniNotice ??= renderDeckmakerCampaignMiniNotice;
  window.renderDeckmakerCampaignBanner     ??= renderDeckmakerCampaignBanner;
})();
