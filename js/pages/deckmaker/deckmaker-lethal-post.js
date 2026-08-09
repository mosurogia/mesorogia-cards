/**
 * リーサルプランの投稿登録状態を管理する。
 * 候補検索結果ではなく、投稿者が確定した完成済みの組み合わせだけを保持する。
 */
(function () {
  'use strict';

  let plans = [];
  const MAX_LETHAL_PLANS = 3;
  let selectedCandidateKeys = new Set();
  let candidateExpressionKey = '';
  let candidateListExpanded = false;
  let candidateVariantOrderKeys = [];
  let candidateOrderNeedsRefresh = true;
  let editingPlanIndex = null;
  const expandedRegisteredPlans = new Set();
  let valueCardsPreview = null;
  let valueCardsLongPressTimer = 0;

  function clone_(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeStep_(step) {
    if (!step || typeof step !== 'object') return null;
    const rawCardId = String(step.cardId || step.cd || '').trim();
    if (!rawCardId) return null;
    const cardId = rawCardId.padStart(5, '0').slice(-5);
    return {
      cardId,
      cardName: String(step.cardName || step.name || ''),
      type: String(step.type || ''),
      value: Number(step.value) || 0,
      display: String(step.display || step.value || ''),
      sourceKind: String(step.sourceKind || ''),
      sourceKey: String(step.sourceKey || ''),
      attackValue: step.attackValue == null ? null : Number(step.attackValue),
      lethalBurnValue: step.lethalBurnValue == null ? null : Number(step.lethalBurnValue),
      isRepeat: step.isRepeat === true,
      linkedStepIndex: Number.isInteger(step.linkedStepIndex) ? step.linkedStepIndex : null,
    };
  }

  function normalizePlans_(value) {
    if (!Array.isArray(value)) return [];
    const normalized = value.map(plan => {
      const values = Array.isArray(plan?.values) ? plan.values.map(Number).filter(Number.isFinite) : [];
      const variants = Array.isArray(plan?.variants) ? plan.variants.map(variant => ({
        steps: Array.isArray(variant?.steps) ? variant.steps.map(normalizeStep_).filter(Boolean) : [],
      })).filter(variant => variant.steps.length > 0) : [];
      return { values, total: Number(plan?.total) || values.reduce((sum, n) => sum + n, 0), variants };
    }).filter(plan => plan.values.length > 0 && plan.variants.length > 0);
    const merged = [];
    for (const plan of normalized) {
      const key = expressionKey_(plan.values);
      let target = merged.find(item => expressionKey_(item.values) === key);
      if (!target) {
        if (merged.length >= MAX_LETHAL_PLANS) continue;
        target = { ...plan, values: [...plan.values], variants: [] };
        merged.push(target);
      }
      for (const variant of plan.variants) {
        const signature = variantKey_(variant);
        if (!target.variants.some(item => variantKey_(item) === signature)) target.variants.push(variant);
      }
    }
    return merged;
  }

  function expressionKey_(values) {
    return values.map(Number).sort((a, b) => a - b).join('|');
  }

  function variantKey_(variant) {
    const steps = variant.steps || [];
    const hasOrderSensitiveStep = steps.some(step =>
      step.type === 'buff' || step.sourceKind === 'lethalBuff' || step.linkedStepIndex != null
    );
    const parts = steps.map(step => [
      step.cardId, step.type, step.value, step.sourceKind, step.sourceKey,
      step.attackValue, step.lethalBurnValue, step.linkedStepIndex,
    ].join(':'));
    return (hasOrderSensitiveStep ? parts : parts.sort()).join('|');
  }

  function getVariantAttackerDuplicateCount_(variant) {
    const attackerCounts = new Map();
    for (const step of variant.steps || []) {
      if (step.sourceKind !== 'attack') continue;
      attackerCounts.set(step.cardId, (attackerCounts.get(step.cardId) || 0) + 1);
    }
    return [...attackerCounts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  }

  function sortCandidateVariants_(variants) {
    return variants
      .map((variant, index) => ({
        variant,
        index,
        key: variantKey_(variant),
        duplicateCount: getVariantAttackerDuplicateCount_(variant),
      }))
      .sort((a, b) =>
        Number(selectedCandidateKeys.has(b.key)) - Number(selectedCandidateKeys.has(a.key)) ||
        a.duplicateCount - b.duplicateCount ||
        a.index - b.index
      )
      .map(item => item.variant);
  }

  function getDeckCount_(cardId) {
    return Number(window.deck?.[cardId] || 0);
  }

  function getInvalidReason_(variant) {
    const required = new Map();
    for (const step of variant.steps || []) {
      required.set(step.cardId, (required.get(step.cardId) || 0) + 1);
    }
    const missing = [...required].filter(([cardId, count]) => getDeckCount_(cardId) < count);
    if (!missing.length) return '';
    return `デッキ内の枚数が不足しています：${missing.map(([cardId]) => window.getCard?.(cardId)?.name || cardId).join('、')}`;
  }

  function showRegistrationError_(message) {
    if (typeof window.showPostToast === 'function') {
      window.showPostToast(message, 'danger');
      return;
    }
    window.alert?.(message);
  }

  function render_() {
    const list = document.getElementById('lethal-planner-registered-list');
    const count = document.getElementById('lethal-planner-registered-count');
    if (!list || !count) return;
    count.textContent = `${plans.length}/${MAX_LETHAL_PLANS}`;
    list.innerHTML = '';
    if (!plans.length) {
      list.innerHTML = '<p class="lethal-planner__registered-empty">まだ登録されていません</p>';
      return;
    }
    plans.forEach((plan, planIndex) => {
      const invalidReasons = plan.variants.map(getInvalidReason_);
      const row = document.createElement('div');
      row.className = 'lethal-planner__registered-item';
      row.classList.toggle('is-invalid', invalidReasons.some(Boolean));
      const sortedValues = [...plan.values].sort((a, b) => a - b);
      const expression = sortedValues.join(' + ');
      const expressionRow = document.createElement('div');
      expressionRow.className = 'lethal-planner__registered-expression';
      const expressionText = document.createElement('span');
      expressionText.textContent = `${planIndex + 1}. ${expression} = ${plan.total}`;
      const actions = document.createElement('div');
      actions.className = 'lethal-planner__registered-expression-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'lethal-planner__registered-expression-edit';
      edit.dataset.editPlanIndex = String(planIndex);
      edit.setAttribute('aria-label', `${planIndex + 1}番のリーサルプランを編集`);
      edit.textContent = '編集';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'lethal-planner__registered-expression-remove';
      remove.dataset.planIndex = String(planIndex);
      remove.setAttribute('aria-label', `${planIndex + 1}番のリーサルプランを削除`);
      remove.title = 'このリーサルプランを削除';
      remove.textContent = '×';
      actions.append(edit, remove);
      expressionRow.append(expressionText, actions);
      row.appendChild(expressionRow);
      plan.variants.forEach((variant, variantIndex) => {
        const cards = document.createElement('div');
        cards.className = 'lethal-planner__registered-cards';
        cards.hidden = plan.variants.length >= 5 && variantIndex >= 4 && !expandedRegisteredPlans.has(planIndex);
        if (plan.variants.length > 1) {
          const variantLabel = document.createElement('span');
          variantLabel.className = 'lethal-planner__registered-variant-label';
          variantLabel.textContent = `${variantIndex + 1}`;
          cards.appendChild(variantLabel);
        }
        variant.steps.forEach((step, stepIndex) => {
          if (stepIndex) cards.append(' + ');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'lethal-planner__registered-card';
          button.dataset.cardId = step.cardId;
          const cardName = step.cardName || window.getCard?.(step.cardId)?.name || step.cardId;
          button.setAttribute('aria-label', `${cardName}のカード詳細を開く`);
          button.title = cardName;
          const cardImage = document.createElement('img');
          cardImage.className = 'lethal-planner__registered-card-image';
          cardImage.src = window.getCardImageSrc?.(step.cardId) || `img/${step.cardId}.webp`;
          cardImage.alt = cardName;
          cardImage.loading = 'lazy';
          cardImage.onerror = () => {
            if (cardImage.dataset.fallbackApplied) return;
            cardImage.dataset.fallbackApplied = '1';
            cardImage.src = 'img/00000.webp';
          };
          button.appendChild(cardImage);
          cards.appendChild(button);
        });
        row.appendChild(cards);
        const invalidReason = invalidReasons[variantIndex];
        if (invalidReason) {
          const warning = document.createElement('p');
          warning.className = 'lethal-planner__registered-warning';
          warning.hidden = cards.hidden;
          warning.textContent = `無効：${invalidReason}。再登録またはプランを削除してください。`;
          row.appendChild(warning);
        }
      });
      if (plan.variants.length >= 5) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'lethal-planner__variants-toggle';
        toggle.dataset.registeredPlanToggle = String(planIndex);
        const expanded = expandedRegisteredPlans.has(planIndex);
        toggle.textContent = expanded ? '組み合わせを閉じる' : `ほか${plan.variants.length - 4}件を表示`;
        toggle.setAttribute('aria-expanded', String(expanded));
        row.appendChild(toggle);
      }
      list.appendChild(row);
    });
  }

  function registerCurrent_() {
    const composerStatus = window.getLethalPlannerComposerStatus?.() || { total: 0, cardsComplete: false };
    if (composerStatus.total < 30) {
      showRegistrationError_('打点がまだ足りません。30以上になるようにリーサルプランを調整してください。');
      return false;
    }
    if (composerStatus.total > 40) {
      showRegistrationError_('打点が高すぎます。40以下になるようにリーサルプランを調整してください。');
      return false;
    }
    const candidates = window.getLethalPlannerPlanCandidates?.() || { values: [], total: composerStatus.total, variants: [] };
    const selectedVariants = candidates.variants.filter(variant => selectedCandidateKeys.has(variantKey_(variant)));
    if (!selectedVariants.length) {
      showRegistrationError_('アタッカーを選択してください。');
      return false;
    }
    const key = expressionKey_(candidates.values);
    if (Number.isInteger(editingPlanIndex) && plans[editingPlanIndex]) {
      plans[editingPlanIndex] = {
        values: candidates.values.map(Number),
        total: Number(candidates.total),
        variants: selectedVariants.map(clone_),
      };
      render_();
      window.scheduleAutosave?.();
      window.refreshPostSummary?.();
      return true;
    }
    let plan = plans.find(item => expressionKey_(item.values) === key);
    if (!plan) {
      if (plans.length >= MAX_LETHAL_PLANS) {
        showRegistrationError_(`リーサルプランは${MAX_LETHAL_PLANS}種類まで登録できます。登録済みプランを削除してから追加してください。`);
        return false;
      }
      plan = { values: candidates.values.map(Number), total: Number(candidates.total), variants: [] };
      plans.push(plan);
    }
    const newVariants = selectedVariants.filter(candidate => {
      const signature = variantKey_(candidate);
      return !plan.variants.some(variant => variantKey_(variant) === signature);
    });
    if (!newVariants.length) {
      showRegistrationError_('同じ打点とカードの組み合わせはすでに登録されています。');
      return false;
    }
    plan.variants.push(...newVariants.map(clone_));
    render_();
    window.scheduleAutosave?.();
    window.refreshPostSummary?.();
    return true;
  }

  function remove_(planIndex, variantIndex) {
    const plan = plans[planIndex];
    if (!plan) return;
    if (!Number.isInteger(variantIndex)) {
      plans.splice(planIndex, 1);
      render_();
      window.scheduleAutosave?.();
      window.refreshPostSummary?.();
      return;
    }
    if (!plan.variants?.[variantIndex]) return;
    plan.variants.splice(variantIndex, 1);
    if (!plan.variants.length) plans.splice(planIndex, 1);
    render_();
    window.scheduleAutosave?.();
    window.refreshPostSummary?.();
  }

  function getValidPlans_() {
    return plans.map(plan => ({
      ...clone_(plan),
      variants: plan.variants.filter(variant => !getInvalidReason_(variant)).map(clone_),
    })).filter(plan => plan.variants.length > 0);
  }

  function copyPlannerContent_(sourceId, targetId) {
    const source = document.getElementById(sourceId);
    const target = document.getElementById(targetId);
    if (!source || !target) return;
    target.innerHTML = source.innerHTML;
    target.querySelectorAll?.('[id]').forEach(element => element.removeAttribute('id'));
  }

  function syncPostPlanner_() {
    copyPlannerContent_('lethal-planner-auto-results', 'post-lethal-auto-results');
    copyPlannerContent_('lethal-planner-expression', 'post-lethal-expression');
    copyPlannerContent_('lethal-planner-groups', 'post-lethal-groups');
    const sourcePlanner = document.getElementById('lethal-planner');
    const postPlanner = document.querySelector?.('.post-lethal-card-modal__content');
    if (sourcePlanner && postPlanner) {
      ['is-complete', 'is-just-lethal', 'is-over-lethal'].forEach(className => {
        postPlanner.classList.toggle(className, sourcePlanner.classList.contains(className));
      });
    }
    syncCardModal_();
  }

  function syncCardModal_() {
    const list = document.getElementById('post-lethal-card-modal-list');
    if (!list) return;
    const candidates = window.getLethalPlannerPlanCandidates?.() || { values: [], variants: [] };
    const isRegisterableDamage = candidates.total >= 30 && candidates.total <= 40;
    const candidatesHeader = document.querySelector?.('.post-lethal-modal-candidates');
    const toggle = document.getElementById('post-lethal-candidate-toggle');
    const registerButton = document.getElementById('lethal-planner-register');
    if (candidatesHeader) candidatesHeader.hidden = false;
    list.hidden = !isRegisterableDamage;
    if (registerButton) registerButton.hidden = !isRegisterableDamage;
    if (!isRegisterableDamage) {
      selectedCandidateKeys = new Set();
      candidateExpressionKey = '';
      candidateListExpanded = false;
      candidateVariantOrderKeys = [];
      candidateOrderNeedsRefresh = true;
      list.innerHTML = '';
      if (toggle) {
        toggle.textContent = '全てにチェック';
        toggle.disabled = true;
        toggle.setAttribute('aria-pressed', 'false');
      }
      return;
    }
    const nextExpressionKey = candidates.values.join('|');
    if (candidateExpressionKey !== nextExpressionKey) {
      candidateExpressionKey = nextExpressionKey;
      candidateListExpanded = false;
      const registeredPlan = plans.find(plan => expressionKey_(plan.values) === expressionKey_(candidates.values));
      selectedCandidateKeys = new Set((registeredPlan?.variants || []).map(variantKey_));
      candidateOrderNeedsRefresh = true;
    }
    const availableKeys = new Set(candidates.variants.map(variantKey_));
    selectedCandidateKeys = new Set([...selectedCandidateKeys].filter(key => availableKeys.has(key)));
    if (candidateOrderNeedsRefresh) {
      candidateVariantOrderKeys = sortCandidateVariants_(candidates.variants).map(variantKey_);
      candidateOrderNeedsRefresh = false;
    }
    if (toggle) {
      const allSelected = availableKeys.size > 0 && selectedCandidateKeys.size === availableKeys.size;
      toggle.textContent = allSelected ? 'すべて外す' : '全てにチェック';
      toggle.disabled = availableKeys.size === 0;
      toggle.setAttribute('aria-pressed', String(allSelected));
    }
    list.innerHTML = '';
    if (!candidates.variants.length) {
      list.innerHTML = '<p class="lethal-planner__registered-empty">この打点で成立するアタッカー構成はありません</p>';
      return;
    }
    const variantsByKey = new Map(candidates.variants.map(variant => [variantKey_(variant), variant]));
    const sortedVariants = candidateVariantOrderKeys
      .map(key => variantsByKey.get(key))
      .filter(Boolean);
    for (const variant of candidates.variants) {
      if (!candidateVariantOrderKeys.includes(variantKey_(variant))) sortedVariants.push(variant);
    }
    sortedVariants.forEach((variant, index) => {
      const key = variantKey_(variant);
      const row = document.createElement('div');
      row.className = 'post-lethal-candidate-row';
      row.hidden = candidates.variants.length >= 5 && index >= 4 && !candidateListExpanded;
      row.classList.toggle('is-selected', selectedCandidateKeys.has(key));
      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'post-lethal-candidate-check';
      check.dataset.lethalCandidateKey = key;
      check.setAttribute('aria-pressed', String(selectedCandidateKeys.has(key)));
      check.setAttribute('aria-label', `${index + 1}番のアタッカー構成を選択`);
      check.textContent = selectedCandidateKeys.has(key) ? '✓' : '';
      const cards = document.createElement('div');
      cards.className = 'lethal-planner__registered-cards';
      variant.steps.forEach((step, stepIndex) => {
        if (stepIndex) cards.append(' + ');
        const card = document.createElement('span');
        card.className = 'lethal-planner__registered-card post-lethal-candidate-card';
        const cardName = step.cardName || window.getCard?.(step.cardId)?.name || step.cardId;
        card.title = cardName;
        const image = document.createElement('img');
        image.className = 'lethal-planner__registered-card-image';
        image.src = window.getCardImageSrc?.(step.cardId) || `img/${step.cardId}.webp`;
        image.alt = cardName;
        image.loading = 'lazy';
        card.appendChild(image);
        cards.appendChild(card);
      });
      row.append(check, cards);
      list.appendChild(row);
    });
    if (candidates.variants.length >= 5) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'post-lethal-candidates-more';
      more.dataset.lethalCandidatesMore = '1';
      more.textContent = candidateListExpanded
        ? 'アタッカー構成を閉じる'
        : `ほか${candidates.variants.length - 4}件を表示`;
      more.setAttribute('aria-expanded', String(candidateListExpanded));
      list.appendChild(more);
    }
  }

  function hideValueCardsPreview_() {
    if (valueCardsLongPressTimer) window.clearTimeout(valueCardsLongPressTimer);
    valueCardsLongPressTimer = 0;
    valueCardsPreview?.remove?.();
    valueCardsPreview = null;
  }

  function showValueCardsPreview_(button) {
    const cards = window.getLethalPlannerCardsForKey?.(button?.dataset?.lethalKey) || [];
    hideValueCardsPreview_();
    if (!button || !cards.length) return;
    const preview = document.createElement('div');
    preview.className = 'post-lethal-value-cards-preview';
    preview.setAttribute('role', 'tooltip');
    cards.forEach(card => {
      const image = document.createElement('img');
      image.src = window.getCardImageSrc?.(card.cardId) || `img/${card.cardId}.webp`;
      image.alt = card.cardName;
      image.title = card.cardName;
      preview.appendChild(image);
    });
    document.body.appendChild(preview);
    const rect = button.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    preview.style.left = `${Math.max(8, Math.min(window.innerWidth - previewRect.width - 8, rect.left))}px`;
    preview.style.top = `${Math.min(window.innerHeight - previewRect.height - 8, rect.bottom + 6)}px`;
    valueCardsPreview = preview;
  }

  function clickOriginal_(selector) {
    const original = document.querySelector?.(`#lethal-planner ${selector}`);
    original?.click?.();
  }

  function setModalOpen_(open) {
    const modal = document.getElementById('post-lethal-card-modal');
    if (!modal) return;
    modal.style.display = open ? 'flex' : 'none';
    modal.setAttribute('aria-hidden', String(!open));
    if (!open) hideValueCardsPreview_();
    document.body?.classList?.toggle('modal-open', open);
    if (open) {
      candidateOrderNeedsRefresh = true;
      syncCardModal_();
      document.getElementById('post-lethal-card-modal-close')?.focus?.();
    } else {
      editingPlanIndex = null;
      const registerButton = document.getElementById('lethal-planner-register');
      if (registerButton) registerButton.textContent = '選択した組み合わせを登録';
    }
  }

  function openPlanEditor_(planIndex) {
    const plan = plans[planIndex];
    if (!plan || !window.loadLethalPlannerPlanForEditing?.(plan)) {
      showRegistrationError_('リーサルプランを編集画面に読み込めませんでした。');
      return;
    }
    editingPlanIndex = planIndex;
    candidateExpressionKey = '';
    selectedCandidateKeys = new Set(plan.variants.map(variantKey_));
    candidateOrderNeedsRefresh = true;
    const registerButton = document.getElementById('lethal-planner-register');
    if (registerButton) registerButton.textContent = '変更を保存';
    setModalOpen_(true);
  }

  function bind_() {
    document.getElementById('lethal-planner-register')?.addEventListener('click', () => {
      if (registerCurrent_()) {
        window.resetLethalPlannerComposer?.();
        setModalOpen_(false);
      }
    });
    document.getElementById('post-lethal-open-register')?.addEventListener('click', () => {
      editingPlanIndex = null;
      const registerButton = document.getElementById('lethal-planner-register');
      if (registerButton) registerButton.textContent = '選択した組み合わせを登録';
      setModalOpen_(true);
    });
    document.getElementById('post-lethal-card-modal-close')?.addEventListener('click', () => setModalOpen_(false));
    document.getElementById('post-lethal-card-modal')?.addEventListener('click', event => {
      if (event.target.id === 'post-lethal-card-modal') setModalOpen_(false);
    });
    document.getElementById('post-lethal-auto')?.addEventListener('click', () => {
      document.getElementById('lethal-planner-auto')?.click?.();
    });
    document.getElementById('post-lethal-auto-results')?.addEventListener('click', event => {
      const result = event.target.closest('[data-lethal-auto-index]');
      if (result) {
        clickOriginal_(`[data-lethal-auto-index="${result.dataset.lethalAutoIndex}"]`);
        return;
      }
      const toggle = event.target.closest('.lethal-planner__auto-toggle');
      if (toggle) {
        if (typeof window.toggleLethalPlannerAutoResults === 'function') {
          window.toggleLethalPlannerAutoResults();
        } else {
          clickOriginal_('.lethal-planner__auto-toggle');
        }
        return;
      }
      const cardsButton = event.target.closest('.lethal-planner__auto-cards-button');
      if (cardsButton) {
        if (typeof window.toggleLethalAutoCardsPopup === 'function') {
          window.toggleLethalAutoCardsPopup(cardsButton);
        } else {
          clickOriginal_('.lethal-planner__auto-cards-button');
        }
      }
    });
    document.getElementById('post-lethal-groups')?.addEventListener('click', event => {
      const value = event.target.closest('[data-lethal-key]');
      if (value) clickOriginal_(`[data-lethal-key="${CSS.escape(value.dataset.lethalKey)}"]`);
    });
    const postGroups = document.getElementById('post-lethal-groups');
    postGroups?.addEventListener('pointerover', event => {
      const value = event.target.closest('[data-lethal-key]');
      if (value && event.pointerType !== 'touch') showValueCardsPreview_(value);
    });
    postGroups?.addEventListener('pointerout', event => {
      const value = event.target.closest('[data-lethal-key]');
      if (value && !value.contains(event.relatedTarget)) hideValueCardsPreview_();
    });
    postGroups?.addEventListener('focusin', event => {
      const value = event.target.closest('[data-lethal-key]');
      if (value) showValueCardsPreview_(value);
    });
    postGroups?.addEventListener('focusout', hideValueCardsPreview_);
    postGroups?.addEventListener('pointerdown', event => {
      const value = event.target.closest('[data-lethal-key]');
      if (!value || event.pointerType !== 'touch') return;
      valueCardsLongPressTimer = window.setTimeout(() => showValueCardsPreview_(value), 450);
    });
    postGroups?.addEventListener('pointerup', () => {
      if (valueCardsLongPressTimer) window.clearTimeout(valueCardsLongPressTimer);
      valueCardsLongPressTimer = 0;
    });
    postGroups?.addEventListener('pointercancel', hideValueCardsPreview_);
    document.getElementById('post-lethal-expression')?.addEventListener('click', event => {
      const remove = event.target.closest('.lethal-planner__term-remove');
      if (remove) {
        clickOriginal_(`.lethal-planner__term-remove[data-lethal-selection-index="${remove.dataset.lethalSelectionIndex}"]`);
      }
    });
    document.getElementById('post-lethal-card-modal-list')?.addEventListener('click', event => {
      const more = event.target.closest('[data-lethal-candidates-more]');
      if (more) {
        candidateListExpanded = !candidateListExpanded;
        syncCardModal_();
        return;
      }
      const row = event.target.closest('.post-lethal-candidate-row');
      const check = event.target.closest('[data-lethal-candidate-key]')
        || row?.querySelector('[data-lethal-candidate-key]');
      if (!check) return;
      const key = check.dataset.lethalCandidateKey;
      if (selectedCandidateKeys.has(key)) selectedCandidateKeys.delete(key);
      else selectedCandidateKeys.add(key);
      syncCardModal_();
    });
    document.getElementById('post-lethal-candidate-toggle')?.addEventListener('click', () => {
      const candidates = window.getLethalPlannerPlanCandidates?.() || { variants: [] };
      const keys = candidates.variants.map(variantKey_);
      const allSelected = keys.length > 0 && keys.every(key => selectedCandidateKeys.has(key));
      selectedCandidateKeys = allSelected ? new Set() : new Set(keys);
      syncCardModal_();
    });
    document.querySelectorAll?.('.post-lethal-card-modal [data-lethal-report]').forEach(button => {
      button.addEventListener('click', () => {
        const status = button.closest('.lethal-planner__beta-report')?.querySelector('[data-lethal-copy-status]');
        window.openLethalReport?.(status);
      });
    });
    document.addEventListener('lethal-planner:rendered', syncPostPlanner_);
    document.addEventListener('lethal-planner:cards-rendered', syncCardModal_);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.getElementById('post-lethal-card-modal')?.getAttribute('aria-hidden') === 'false') {
        setModalOpen_(false);
      }
    });
    document.getElementById('lethal-planner-registered-list')?.addEventListener('click', event => {
      const edit = event.target.closest('[data-edit-plan-index]');
      if (edit) {
        openPlanEditor_(Number(edit.dataset.editPlanIndex));
        return;
      }
      const card = event.target.closest('[data-card-id]');
      if (card) {
        window.openCardDetailModal?.(card.dataset.cardId, { anchorRect: card.getBoundingClientRect() });
        return;
      }
      const variantsToggle = event.target.closest('[data-registered-plan-toggle]');
      if (variantsToggle) {
        const planIndex = Number(variantsToggle.dataset.registeredPlanToggle);
        if (expandedRegisteredPlans.has(planIndex)) expandedRegisteredPlans.delete(planIndex);
        else expandedRegisteredPlans.add(planIndex);
        render_();
        return;
      }
      const remove = event.target.closest('[data-plan-index]');
      if (remove) {
        const variantIndex = remove.hasAttribute('data-variant-index')
          ? Number(remove.dataset.variantIndex)
          : null;
        remove_(Number(remove.dataset.planIndex), variantIndex);
      }
    });
    render_();
    syncPostPlanner_();
  }

  window.DeckmakerLethalPost = {
    getAll: () => clone_(plans),
    getValid: getValidPlans_,
    hasCard: cardId => {
      const normalizedCardId = String(cardId || '').padStart(5, '0').slice(-5);
      return plans.some(plan => plan.variants.some(variant =>
        variant.steps.some(step => step.cardId === normalizedCardId)
      ));
    },
    hasInvalid: () => plans.some(plan => plan.variants.some(variant => getInvalidReason_(variant))),
    replace(value) { plans = normalizePlans_(value); render_(); },
    reset() { plans = []; render_(); },
    validate: render_,
    registerCurrent: registerCurrent_,
  };

  window.onDeckmakerReady?.(bind_);
})();
