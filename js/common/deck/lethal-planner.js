// デッキメーカーと投稿編集で共通のリーサル計算・候補選択を使用する。
(function () {
  'use strict';

  window.createLethalPlanner = function ({ deck, getCard, normCd5, imgSrcOf, getDeckEntriesSorted }) {
  const FALLBACK_IMG = 'img/00000.webp';
  // =========================
  // リーサルプラン仮組
  // =========================
  const LETHAL_PLANNER_TARGET = 30;
  const LETHAL_PLANNER_REPEAT_TARGET = 40;
  const LETHAL_PLANNER_MAX_REPEAT_COUNT = 15;
  const LETHAL_PLANNER_DEFAULT_REPEAT_COUNT = 3;
  const lethalPlannerSelections = [];
  const lethalPlannerCardSelections = new Map();
  let lethalPlannerCandidates = new Map();
  let lethalPlannerEventsBound = false;
  let lethalPlannerDragIndex = null;
  let lethalPlannerStepId = 0;
  let lethalPlannerAutoPlans = [];
  let lethalPlannerAutoSearched = false;
  let lethalPlannerAutoExpanded = false;
  let allowedAutoLethalOptions = null;
  let allowedAutoLethalRepeatCounts = new Map();
  let lethalPlannerAutoFilterActive = false;
  let lethalCandidateTooltip = null;
  let lethalCandidateTooltipTimer = null;
  let lethalCandidateTooltipButton = null;
  let lethalAutoCardsPopup = null;
  let lethalAutoCardsPopupButton = null;
  let lethalAutoFilterModal = null;
  let lethalAutoFilterLastFocus = null;
  let lethalCopyStatusTimer = null;
  const LETHAL_REPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSd_-3T97rnhaAKVS76-0YDzYM4Lp9T1XdBrH0Hf4ksjB2y_Nw/viewform?usp=header';
  const LETHAL_PLANNER_AUTO_INITIAL_RESULT_LIMIT = 3;
  const LETHAL_PLANNER_AUTO_RESULT_LIMIT = 10;
  const LETHAL_PLANNER_AUTO_BEAM_WIDTH = 50;
  const LETHAL_CANDIDATE_TOOLTIP_DELAY = 200;
  const LETHAL_CANDIDATE_TOOLTIP_MAX_CARDS = 5;

  const lethalPlannerTypes = [
    { key: 'attack', label: '攻撃', icon: '⚔' },
    { key: 'burn', label: 'バーン', icon: '🔥' },
    { key: 'buff', label: 'バフ', icon: '💪' },
  ];

  const LETHAL_SOURCE_DEFS = [
    { sourceKind: 'attack', displayType: 'attack', lethalKey: 'attack' },
    { sourceKind: 'freeBurn', displayType: 'burn', lethalKey: 'freeBurn' },
    { sourceKind: 'freeBuff', displayType: 'buff', lethalKey: 'freeBuff' },
    {
      sourceKind: 'lethalBuff',
      displayType: 'buff',
      lethalKey: 'lethalBuff',
      requiresAttack: true,
    },
  ];

  function getLethalPlannerCandidateKey_(type, value) {
    return `${type}:${value}`;
  }

  function getLethalPlannerNumber_(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function getLethalPlannerValues_(lethal) {
    if (!lethal) return [];
    const values = (Array.isArray(lethal.values) ? lethal.values : [])
      .map(getLethalPlannerNumber_)
      .filter(value => value !== null)
      .map(value => ({
        value,
        isRepeat: false,
        defaultOff: lethal.defaultOff === true,
      }));
    const repeatValue = getLethalPlannerNumber_(lethal.repeat?.value);
    if (repeatValue !== null && !values.some(item => item.value === repeatValue)) {
      values.push({
        value: repeatValue,
        isRepeat: true,
        defaultOff: lethal.defaultOff === true,
      });
    }
    return values;
  }

  // 構造化前の lethal_burn（数値・カンマ区切り・「*」付き）を補完する
  function getLegacyLethalPlannerBurnValues_(value) {
    return String(value ?? '')
      .split(',')
      .map(item => {
        const normalized = item.trim();
        const burnValue = getLethalPlannerNumber_(normalized.replace('*', ''));
        return burnValue === null
          ? null
          : { value: burnValue, isRepeat: normalized.includes('*') };
      })
      .filter(item => item !== null);
  }

  function buildLethalPlannerCandidates_() {
    const candidates = new Map();
    let deckOrder = 0;

    for (const [cd, rawCount] of Object.entries(deck)) {
      const card = getCard(cd);
      const count = Math.max(0, Number(rawCount) || 0);
      const currentDeckOrder = deckOrder;
      deckOrder += 1;
      if (!card || count === 0) continue;

      for (const sourceDef of LETHAL_SOURCE_DEFS) {
        const lethal = card.lethal?.[sourceDef.lethalKey];
        if (!lethal) continue;

        const normalValues = [...new Set(
          (Array.isArray(lethal.values) ? lethal.values : [])
            .map(getLethalPlannerNumber_)
            .filter(value => value !== null)
        )];
        const minimumNormalValue = normalValues.length > 0 ? Math.min(...normalValues) : null;
        for (const value of normalValues) {
          addLethalPlannerCandidate_(
            candidates,
            sourceDef.displayType,
            value,
            cd,
            card,
            count,
            false,
            {
              sourceKind: sourceDef.sourceKind,
              attackValue: sourceDef.sourceKind === 'attack' ? value : null,
              requiresAttack: sourceDef.requiresAttack === true,
              valuesCount: normalValues.length,
              isMinimumValue: value === minimumNormalValue,
              defaultOff: lethal.defaultOff === true,
              deckOrder: currentDeckOrder,
            }
          );
        }

        const repeatValue = getLethalPlannerNumber_(lethal.repeat?.value);
        if (repeatValue !== null) {
          addLethalPlannerCandidate_(candidates, sourceDef.displayType, repeatValue, cd, card, count, true, {
            sourceKind: sourceDef.sourceKind,
            attackValue: sourceDef.sourceKind === 'attack' ? repeatValue : null,
            requiresAttack: sourceDef.requiresAttack === true,
            valuesCount: 1,
            isMinimumValue: true,
            defaultOff: lethal.defaultOff === true,
            deckOrder: currentDeckOrder,
          });
        }
      }

      const hasStructuredBurn =
        getLethalPlannerValues_(card.lethal?.freeBurn).length > 0 ||
        getLethalPlannerValues_(card.lethal?.lethalBurn).length > 0;
      if (!hasStructuredBurn) {
        for (const legacyBurn of getLegacyLethalPlannerBurnValues_(card.lethal_burn)) {
          addLethalPlannerCandidate_(
            candidates,
            'burn',
            legacyBurn.value,
            cd,
            card,
            count,
            legacyBurn.isRepeat,
            {
              sourceKind: 'freeBurn',
              valuesCount: 1,
              isMinimumValue: true,
              defaultOff: false,
              deckOrder: currentDeckOrder,
            }
          );
        }
      }

      const attackValues = getLethalPlannerValues_(card.lethal?.attack);
      const lethalBurnValues = getLethalPlannerValues_(card.lethal?.lethalBurn);
      for (const attack of attackValues) {
        for (const lethalBurn of lethalBurnValues) {
          addLethalPlannerCandidate_(
            candidates,
            'attack',
            attack.value + lethalBurn.value,
            cd,
            card,
            count,
            attack.isRepeat || lethalBurn.isRepeat,
            {
              sourceKind: 'attack',
              valuesCount: attackValues.length * lethalBurnValues.length,
              isMinimumValue: false,
              deckOrder: currentDeckOrder,
              candidateKey: getLethalPlannerCandidateKey_(
                'attack',
                attack.value + lethalBurn.value
              ),
              display: String(attack.value + lethalBurn.value),
              detailDisplay: `${attack.value}+${lethalBurn.value}`,
              attackValue: attack.value,
              lethalBurnValue: lethalBurn.value,
              defaultOff: attack.defaultOff || lethalBurn.defaultOff,
              forceDeckCount: true,
            }
          );
        }
      }
    }

    return candidates;
  }

  function addLethalPlannerCandidate_(candidates, type, value, cd, card, count, isRepeat, sourceMeta) {
    const key = sourceMeta?.candidateKey || getLethalPlannerCandidateKey_(type, value);
    let candidate = candidates.get(key);
    if (!candidate) {
      candidate = {
        key,
        type,
        value,
        display: sourceMeta?.display || String(value),
        attackValue: sourceMeta?.attackValue ?? null,
        lethalBurnValue: sourceMeta?.lethalBurnValue ?? null,
        repeat: false,
        cards: new Map(),
        sources: new Map(),
      };
      candidates.set(key, candidate);
    }

    const cardKey = normCd5(cd);
    const sourceKind = sourceMeta?.sourceKind || type;
    const sourceKey = sourceMeta?.forceDeckCount
      ? `${cardKey}:attack`
      : isRepeat
      ? `${cardKey}:${sourceKind}:repeat:${value}`
      : `${cardKey}:${sourceKind}`;
    const sourceVariantKey = [
      sourceKey,
      sourceMeta?.attackValue ?? '',
      sourceMeta?.lethalBurnValue ?? '',
      isRepeat ? 'repeat' : 'normal',
    ].join(':');
    if (!candidate.sources.has(sourceVariantKey)) {
      candidate.sources.set(sourceVariantKey, {
        cardId: cardKey,
        cardName: card.name || cardKey,
        sourceKey,
        sourceKind,
        type,
        value,
        display: sourceMeta?.display || String(value),
        detailDisplay: sourceMeta?.detailDisplay || sourceMeta?.display || String(value),
        attackValue: sourceMeta?.attackValue ?? null,
        lethalBurnValue: sourceMeta?.lethalBurnValue ?? null,
        candidateKey: key,
        sourceVariantKey,
        count: isRepeat && !sourceMeta?.forceDeckCount
          ? LETHAL_PLANNER_MAX_REPEAT_COUNT
          : count,
        deckCount: count,
        valuesCount: sourceMeta?.valuesCount || 1,
        isMinimumValue: sourceMeta?.isMinimumValue === true,
        defaultOff: sourceMeta?.defaultOff === true,
        deckOrder: sourceMeta?.deckOrder ?? Number.MAX_SAFE_INTEGER,
        isRepeat,
        requiresAttack: sourceMeta?.requiresAttack === true,
      });
    }
    candidate.repeat ||= isRepeat;

    if (!candidate.cards.has(cardKey)) {
      candidate.cards.set(cardKey, { cd: cardKey, name: card.name || cardKey, count });
    }
  }

  function getLethalPlannerAttackSourceUsedCount_(sourceKey, excludedStepId = null) {
    return lethalPlannerSelections.reduce((total, selection) => {
      if (
        selection.type !== 'attack' ||
        selection.stepId === excludedStepId ||
        selection.sourceKey !== sourceKey
      ) {
        return total;
      }
      return total + 1;
    }, 0);
  }

  function findLethalPlannerAttackAssignment_(lethalBuffSource) {
    return getLethalPlannerAttackAssignments_(lethalBuffSource)[0] || null;
  }

  function getLethalPlannerAttackAssignments_(lethalBuffSource) {
    const assignments = [];
    for (const selection of lethalPlannerSelections) {
      if (selection.type !== 'attack') continue;
      if (selection.lethalBurnValue != null) continue;
      const alreadyLinked = lethalPlannerSelections.some(buffSelection =>
        buffSelection.sourceKind === 'lethalBuff' &&
        buffSelection.linkedAttackStepId === selection.stepId
      );
      if (alreadyLinked) continue;
      if (selection.locked && selection.cardId !== lethalBuffSource.cardId) continue;

      const candidateSource = selection.candidateSources?.find(source =>
        source.cardId === lethalBuffSource.cardId
      );
      if (!candidateSource) continue;

      const usedCount = getLethalPlannerAttackSourceUsedCount_(
        candidateSource.sourceKey,
        selection.stepId
      );
      if (usedCount >= candidateSource.count) continue;

      assignments.push({ selection, candidateSource });
    }
    return assignments;
  }

  function isLethalPlannerSourceUnlocked_(source) {
    return !source.requiresAttack || Boolean(findLethalPlannerAttackAssignment_(source));
  }

  function removeOrphanedLethalPlannerBuffs_() {
    const attackStepIds = new Set(
      lethalPlannerSelections
        .filter(selection => selection.type === 'attack')
        .map(selection => selection.stepId)
    );
    for (let index = lethalPlannerSelections.length - 1; index >= 0; index -= 1) {
      const selection = lethalPlannerSelections[index];
      if (
        selection.sourceKind === 'lethalBuff' &&
        !attackStepIds.has(selection.linkedAttackStepId)
      ) {
        lethalPlannerSelections.splice(index, 1);
      }
    }
  }

  function unlockLinkedLethalPlannerAttack_(linkedAttackStepId) {
    if (!linkedAttackStepId) return;
    const hasOtherLinkedBuff = lethalPlannerSelections.some(selection =>
      selection.sourceKind === 'lethalBuff' &&
      selection.linkedAttackStepId === linkedAttackStepId
    );
    if (hasOtherLinkedBuff) return;

    const attackSelection = lethalPlannerSelections.find(selection =>
      selection.type === 'attack' && selection.stepId === linkedAttackStepId
    );
    if (attackSelection) attackSelection.locked = false;
  }

  function sortLethalPlannerSources_(sources) {
    return sources.sort((a, b) =>
      Number(a.isRepeat) - Number(b.isRepeat) ||
      a.valuesCount - b.valuesCount ||
      Number(b.isMinimumValue) - Number(a.isMinimumValue) ||
      b.deckCount - a.deckCount ||
      a.deckOrder - b.deckOrder
    );
  }

  function getLethalPlannerStepCardOptions_(step) {
    const candidate = lethalPlannerCandidates.get(step.key);
    if (!candidate?.sources) return [];
    const cards = new Map();
    for (const source of candidate.sources.values()) {
      if (
        step.autoOptionKeys instanceof Set &&
        !step.autoOptionKeys.has(getLethalPlannerAutoOptionKey_(source))
      ) {
        continue;
      }
      if (!source.cardId) continue;
      if (!cards.has(source.cardId)) {
        cards.set(source.cardId, {
          cd: source.cardId,
          name: source.cardName || getCard(source.cardId)?.name || source.cardId,
          count: source.deckCount,
          hasPlainAttack: false,
          attackBreakdowns: new Set(),
        });
      }
      const card = cards.get(source.cardId);
      if (source.isRepeat) card.count = Math.max(card.count, source.count);
      if (source.type === 'attack') {
        if (source.lethalBurnValue == null) card.hasPlainAttack = true;
        else card.attackBreakdowns.add(source.detailDisplay);
      }
    }
    return [...cards.values()].map(card => ({
      ...card,
      requiresTrigger: !card.hasPlainAttack && card.attackBreakdowns.size > 0,
      supplement:
        !card.hasPlainAttack && card.attackBreakdowns.size > 0
          ? `(${[...card.attackBreakdowns].join('/')})`
          : '',
    }));
  }

  function canAssignLethalPlannerSteps_(steps, forcedStepId, forcedCardId) {
    const linkedTriggerSteps = steps.filter(step =>
      (step.sourceKind === 'lethalBuff' || step.sourceKind === 'lethalBurn') &&
      step.linkedAttackStepId != null
    );
    const consumingSteps = steps
      .filter(step => !linkedTriggerSteps.includes(step))
      .sort((a, b) =>
        getLethalPlannerStepCardOptions_(a).length - getLethalPlannerStepCardOptions_(b).length
      );
    const forcedLinkedStep = linkedTriggerSteps.find(step => step.stepId === forcedStepId);
    const assignments = new Map();
    const copyUseCounts = new Map();

    const isCompleteAssignmentValid = () => {
      const triggerUseCounts = new Map();
      for (const step of consumingSteps) {
        const assignedCard = assignments.get(step.stepId);
        if (!assignedCard?.requiresTrigger) continue;
        const cardId = assignedCard.cd;
        triggerUseCounts.set(cardId, (triggerUseCounts.get(cardId) || 0) + 1);
      }
      for (const step of linkedTriggerSteps) {
        const cardId = assignments.get(step.linkedAttackStepId)?.cd;
        if (!cardId) return false;
        if (!getLethalPlannerStepCardOptions_(step).some(card => card.cd === cardId)) {
          return false;
        }
        if (forcedLinkedStep === step && cardId !== forcedCardId) return false;
        triggerUseCounts.set(cardId, (triggerUseCounts.get(cardId) || 0) + 1);
      }

      const cardIds = new Set([...copyUseCounts.keys(), ...triggerUseCounts.keys()]);
      for (const cardId of cardIds) {
        const deckCount = Math.max(
          0,
          ...steps.flatMap(step =>
            getLethalPlannerStepCardOptions_(step)
              .filter(card => card.cd === cardId)
              .map(card => card.count)
          )
        );
        const copyUse = copyUseCounts.get(cardId) || 0;
        const triggerUse = triggerUseCounts.get(cardId) || 0;
        if (Math.max(copyUse, triggerUse) > deckCount) return false;
      }
      return true;
    };

    const assignStep = (index) => {
      if (index >= consumingSteps.length) return isCompleteAssignmentValid();
      const step = consumingSteps[index];
      const forcedCardForStep =
        step.stepId === forcedStepId
          ? forcedCardId
          : forcedLinkedStep?.linkedAttackStepId === step.stepId
            ? forcedCardId
            : null;
      for (const card of getLethalPlannerStepCardOptions_(step)) {
        if (forcedCardForStep && card.cd !== forcedCardForStep) continue;
        const nextCopyUse = (copyUseCounts.get(card.cd) || 0) + 1;
        if (nextCopyUse > card.count) continue;
        assignments.set(step.stepId, card);
        copyUseCounts.set(card.cd, nextCopyUse);
        if (assignStep(index + 1)) return true;
        assignments.delete(step.stepId);
        if (nextCopyUse === 1) copyUseCounts.delete(card.cd);
        else copyUseCounts.set(card.cd, nextCopyUse - 1);
      }
      return false;
    };

    return assignStep(0);
  }

  function resolveSelectedLethalStepCandidates_(steps) {
    const resolved = new Map();
    const consumingSteps = steps.filter(step =>
      !(
        (step.sourceKind === 'lethalBuff' || step.sourceKind === 'lethalBurn') &&
        step.linkedAttackStepId != null
      )
    );

    for (const step of consumingSteps) {
      const possibleCards = getLethalPlannerStepCardOptions_(step).filter(card =>
        canAssignLethalPlannerSteps_(consumingSteps, step.stepId, card.cd)
      );
      resolved.set(step.stepId, {
        stepId: step.stepId,
        label: step.display || String(step.value),
        fixedCards: possibleCards.length === 1 ? possibleCards : [],
        candidateCards: possibleCards.length === 1 ? [] : possibleCards,
      });
    }

    for (const step of steps) {
      if (resolved.has(step.stepId)) continue;
      const linkedCards = getLethalPlannerStepCardOptions_(step).filter(card =>
        canAssignLethalPlannerSteps_(steps, step.stepId, card.cd)
      );
      resolved.set(step.stepId, {
        stepId: step.stepId,
        label: step.display || String(step.value),
        fixedCards: linkedCards.length === 1 ? linkedCards : [],
        candidateCards: linkedCards.length === 1 ? [] : linkedCards,
      });
    }
    return resolved;
  }

  function getAvailableLethalPlannerSource_(
    candidate,
    availableCards = getAvailableCardsForLethalCandidate_(candidate)
  ) {
    const availableCardIds = new Set(
      availableCards.map(card => card.cd)
    );
    return sortLethalPlannerSources_(
      [...(candidate?.sources.values() || [])].filter(source =>
        availableCardIds.has(source.cardId) &&
        isLethalPlannerSourceUnlocked_(source)
      )
    )[0] || null;
  }

  function getLethalPlannerAutoOptionKey_(source) {
    return `${source.cardId}|${source.sourceVariantKey}|${source.candidateKey}`;
  }

  function getLethalPlannerAutoSourceGroups_(enabledOptionKeys = null) {
    const groups = new Map();
    for (const candidate of lethalPlannerCandidates.values()) {
      for (const source of candidate.sources.values()) {
        if (source.isRepeat && !enabledOptionKeys) continue;
        if (enabledOptionKeys && !enabledOptionKeys.has(getLethalPlannerAutoOptionKey_(source))) {
          continue;
        }
        if (!groups.has(source.sourceKey)) {
          const repeatCount = source.isRepeat
            ? allowedAutoLethalRepeatCounts.get(getLethalPlannerAutoOptionKey_(source))
            : null;
          groups.set(source.sourceKey, {
            sourceKey: source.sourceKey,
            sourceKind: source.sourceKind,
            cardId: source.cardId,
            count: Number.isInteger(repeatCount)
              ? Math.min(source.count, Math.max(1, repeatCount))
              : source.count,
            sources: [],
          });
        }
        groups.get(source.sourceKey).sources.push(source);
      }
    }
    return [...groups.values()];
  }

  function getLethalPlannerAutoStateScore_(state) {
    const stepCount = state.items.length;
    const overDamage = Math.max(0, state.total - LETHAL_PLANNER_TARGET);
    const repeatUseCount = state.items.filter(item => item.isRepeat).length;
    const lethalBuffCount = state.items.filter(item => item.sourceKind === 'lethalBuff').length;
    const buffCount = state.items.filter(item => item.type === 'buff').length;
    const estimatedCost = state.items.reduce((total, item) => {
      const cost = Number(getCard(item.cardId)?.cost);
      return total + (Number.isFinite(cost) ? cost : 0);
    }, 0);
    return stepCount * 100
      + overDamage * 20
      + repeatUseCount * 15
      + lethalBuffCount * 10
      + buffCount * 8
      + estimatedCost;
  }

  function getLethalPlannerAutoStateKey_(state) {
    return state.items
      .map(item => `${item.sourceVariantKey}:${item.display || item.value}`)
      .sort()
      .join('|');
  }

  function getLethalPlannerAutoPlanSignature_(plan) {
    const damageParts = plan.items
      .filter(item => item.type !== 'buff')
      .map(item => item.display || String(item.value))
      .sort();
    const buffParts = plan.items
      .filter(item => item.type === 'buff')
      .map(item => item.value)
      .sort((a, b) => b - a);
    return `${damageParts.join('|')}|buff:${buffParts.join('+')}|total:${plan.total}`;
  }

  function deduplicateLethalPlannerAutoPlans_(plans) {
    const representativePlans = new Map();
    for (const plan of plans) {
      const signature = getLethalPlannerAutoPlanSignature_(plan);
      const current = representativePlans.get(signature);
      if (!current || getLethalPlannerAutoStateScore_(plan) < getLethalPlannerAutoStateScore_(current)) {
        representativePlans.set(signature, plan);
      }
    }
    return [...representativePlans.values()].sort((a, b) =>
      getLethalPlannerAutoStateScore_(a) - getLethalPlannerAutoStateScore_(b)
      || a.items.length - b.items.length
    );
  }

  function trimLethalPlannerAutoStates_(states) {
    const uniqueStates = new Map();
    for (const state of states) {
      const key = getLethalPlannerAutoStateKey_(state);
      const current = uniqueStates.get(key);
      if (!current || getLethalPlannerAutoStateScore_(state) < getLethalPlannerAutoStateScore_(current)) {
        uniqueStates.set(key, state);
      }
    }
    return [...uniqueStates.values()]
      .sort((a, b) =>
        getLethalPlannerAutoStateScore_(a) - getLethalPlannerAutoStateScore_(b)
        || a.items.length - b.items.length
      )
      .slice(0, LETHAL_PLANNER_AUTO_BEAM_WIDTH);
  }

  function expandLethalPlannerAutoGroup_(group) {
    const variants = [{ total: 0, items: [] }];
    let frontier = [{ total: 0, items: [] }];
    for (let usedCount = 1; usedCount <= group.count; usedCount += 1) {
      const nextByKey = new Map();
      for (const state of frontier) {
        for (const source of group.sources) {
          const total = state.total + source.value;
          if (total > LETHAL_PLANNER_REPEAT_TARGET) continue;
          const items = [...state.items, source];
          const key = items
            .map(item => item.sourceVariantKey || `${item.sourceKey}:${item.display || item.value}`)
            .sort()
            .join(',');
          if (!nextByKey.has(key)) nextByKey.set(key, { total, items });
        }
      }
      frontier = [...nextByKey.values()];
      variants.push(...frontier);
      if (frontier.length === 0) break;
    }
    return variants;
  }

  function hasValidLethalPlannerAutoBuffs_(items) {
    if (!items.some(item => item.type !== 'buff')) return false;
    const attackCounts = new Map();
    const lethalBuffCounts = new Map();
    const copyUseCounts = new Map();
    const triggerUseCounts = new Map();
    const deckCounts = new Map();
    const countedRepeatCopies = new Set();
    const countedRepeatTriggers = new Set();
    for (const item of items) {
      deckCounts.set(item.cardId, Math.max(deckCounts.get(item.cardId) || 0, item.deckCount || 0));
      const repeatKey = item.isRepeat ? item.sourceKey : null;
      if (
        item.sourceKind !== 'lethalBuff' &&
        (!repeatKey || !countedRepeatCopies.has(repeatKey))
      ) {
        copyUseCounts.set(item.cardId, (copyUseCounts.get(item.cardId) || 0) + 1);
        if (repeatKey) countedRepeatCopies.add(repeatKey);
      }
      if (
        (item.sourceKind === 'lethalBuff' || item.lethalBurnValue != null) &&
        (!repeatKey || !countedRepeatTriggers.has(repeatKey))
      ) {
        triggerUseCounts.set(item.cardId, (triggerUseCounts.get(item.cardId) || 0) + 1);
        if (repeatKey) countedRepeatTriggers.add(repeatKey);
      }
      const counts = item.sourceKind === 'attack' && item.lethalBurnValue == null
        ? attackCounts
        : item.sourceKind === 'lethalBuff'
          ? lethalBuffCounts
          : null;
      if (!counts) continue;
      counts.set(item.cardId, (counts.get(item.cardId) || 0) + 1);
    }
    return [...lethalBuffCounts].every(([cardId, count]) =>
      (attackCounts.get(cardId) || 0) >= count
    ) && [...deckCounts].every(([cardId, deckCount]) =>
      Math.max(
        copyUseCounts.get(cardId) || 0,
        triggerUseCounts.get(cardId) || 0
      ) <= deckCount
    );
  }

  function createLethalPlannerSelection_(source) {
    const candidateKey = source.candidateKey || getLethalPlannerCandidateKey_(source.type, source.value);
    const selection = {
      stepId: ++lethalPlannerStepId,
      key: candidateKey,
      type: source.type,
      value: source.value,
      display: source.display || String(source.value),
      attackValue: source.attackValue ?? null,
      lethalBurnValue: source.lethalBurnValue ?? null,
      cardId: source.cardId,
      cardName: source.cardName,
      sourceKey: source.sourceKey,
      sourceKind: source.sourceKind,
      isRepeat: source.isRepeat,
      autoOptionKeys: new Set(
        [...(lethalPlannerCandidates.get(candidateKey)?.sources.values() || [])]
          .map(candidateSource => getLethalPlannerAutoOptionKey_(candidateSource))
          .filter(optionKey =>
            !(allowedAutoLethalOptions instanceof Set) ||
            allowedAutoLethalOptions.has(optionKey)
          )
      ),
    };
    if (source.sourceKind === 'attack') {
      const candidate = lethalPlannerCandidates.get(candidateKey);
      selection.candidateSources = [...(candidate?.sources.values() || [])]
        .filter(candidateSource => candidateSource.sourceKind === 'attack')
        .map(candidateSource => ({
          cardId: candidateSource.cardId,
          cardName: candidateSource.cardName,
          sourceKey: candidateSource.sourceKey,
          count: candidateSource.count,
          isRepeat: candidateSource.isRepeat,
        }));
      selection.locked = false;
    }
    return selection;
  }

  function buildLethalPlannerAutoSelections_(items) {
    const selections = items.map(createLethalPlannerSelection_);
    const availableAttacks = new Map();
    for (const selection of selections) {
      if (selection.sourceKind !== 'attack' || selection.lethalBurnValue != null) continue;
      if (!availableAttacks.has(selection.cardId)) availableAttacks.set(selection.cardId, []);
      availableAttacks.get(selection.cardId).push(selection);
    }
    for (const selection of selections) {
      if (selection.sourceKind !== 'lethalBuff') continue;
      const attackSelection = availableAttacks.get(selection.cardId)?.shift();
      if (!attackSelection) return null;
      attackSelection.locked = true;
      selection.linkedAttackStepId = attackSelection.stepId;
    }
    return selections;
  }

  function generateLethalPlannerAutoPlans_(enabledOptionKeys = null) {
    let statesByTotal = new Map([[0, [{ total: 0, items: [] }]]]);
    for (const group of getLethalPlannerAutoSourceGroups_(enabledOptionKeys)) {
      const variants = expandLethalPlannerAutoGroup_(group);
      const nextByTotal = new Map();
      for (const states of statesByTotal.values()) {
        for (const state of states) {
          for (const variant of variants) {
            const total = state.total + variant.total;
            if (total > LETHAL_PLANNER_REPEAT_TARGET) continue;
            if (!nextByTotal.has(total)) nextByTotal.set(total, []);
            nextByTotal.get(total).push({
              total,
              items: [...state.items, ...variant.items],
            });
          }
        }
      }
      statesByTotal = new Map(
        [...nextByTotal].map(([total, states]) => [total, trimLethalPlannerAutoStates_(states)])
      );
    }

    const plans = [];
    for (let total = LETHAL_PLANNER_TARGET; total <= LETHAL_PLANNER_REPEAT_TARGET; total += 1) {
      for (const state of statesByTotal.get(total) || []) {
        if (hasValidLethalPlannerAutoBuffs_(state.items)) plans.push(state);
      }
    }
    return deduplicateLethalPlannerAutoPlans_(plans)
      .slice(0, LETHAL_PLANNER_AUTO_RESULT_LIMIT);
  }

  function applyLethalPlannerAutoPlan_(plan) {
    lethalPlannerStepId = 0;
    const selections = buildLethalPlannerAutoSelections_(plan.items);
    if (!selections) return;
    lethalPlannerAutoFilterActive = allowedAutoLethalOptions instanceof Set;
    lethalPlannerSelections.splice(0, lethalPlannerSelections.length, ...selections);
    lethalPlannerCardSelections.clear();
    renderLethalPlanner_();
  }

  function loadLethalPlannerPlanForEditing_(plan) {
    const steps = plan?.variants?.[0]?.steps;
    if (!Array.isArray(steps) || steps.length === 0) return false;
    lethalPlannerStepId = 0;
    const selections = buildLethalPlannerAutoSelections_(steps);
    if (!selections) return false;
    lethalPlannerAutoFilterActive = false;
    lethalPlannerSelections.splice(0, lethalPlannerSelections.length, ...selections);
    lethalPlannerCardSelections.clear();
    renderLethalPlanner_();
    return true;
  }

  function getLethalAutoFilterOptionLabel_(source) {
    const repeatSuffix = source.isRepeat ? '（繰り返し）' : '';
    if (source.lethalBurnValue != null) {
      return `攻撃+バーン ${source.detailDisplay}${repeatSuffix}`;
    }
    if (source.sourceKind === 'attack') return `攻撃 ${source.display}${repeatSuffix}`;
    if (source.sourceKind === 'freeBurn') return `バーン ${source.value}${repeatSuffix}`;
    if (source.sourceKind === 'freeBuff') return `バフ +${source.value}${repeatSuffix}`;
    if (source.sourceKind === 'lethalBuff') {
      return `攻撃成功時バフ +${source.value}${repeatSuffix}`;
    }
    return `${source.display || source.value}${repeatSuffix}`;
  }

  function getLethalAutoFilterCardGroups_() {
    const groups = new Map();
    for (const candidate of lethalPlannerCandidates.values()) {
      for (const source of candidate.sources.values()) {
        if (!groups.has(source.cardId)) {
          groups.set(source.cardId, {
            cardId: source.cardId,
            cardName: source.cardName,
            count: source.deckCount,
            deckOrder: source.deckOrder,
            options: new Map(),
          });
        }
        const optionKey = getLethalPlannerAutoOptionKey_(source);
        if (!groups.get(source.cardId).options.has(optionKey)) {
          groups.get(source.cardId).options.set(optionKey, {
            key: optionKey,
            source,
            label: getLethalAutoFilterOptionLabel_(source),
          });
        }
      }
    }

    for (const group of groups.values()) {
      const options = [...group.options.values()];
      for (const option of options) {
        const source = option.source;
        option.defaultChecked =
          !source.defaultOff &&
          !source.isRepeat &&
          source.lethalBurnValue == null &&
          source.sourceKind !== 'lethalBuff' &&
          (
            source.sourceKind === 'attack' ||
            source.sourceKind === 'freeBurn' ||
            source.sourceKind === 'freeBuff'
          ) &&
          source.isMinimumValue;
      }
    }

    return [...groups.values()].sort((a, b) => {
      const comparison = window.compareCards?.(getCard(a.cardId), getCard(b.cardId));
      if (Number.isFinite(comparison) && comparison !== 0) return comparison;
      return a.deckOrder - b.deckOrder || a.cardName.localeCompare(b.cardName, 'ja');
    });
  }

  function closeLethalAutoFilterModal_() {
    if (!lethalAutoFilterModal) return;
    lethalAutoFilterModal.hidden = true;
    document.body.classList.remove('lethal-auto-filter-open');
    lethalAutoFilterLastFocus?.focus?.();
    lethalAutoFilterLastFocus = null;
  }

  function getLethalAutoFilterChipLabel_(source) {
    const repeatSuffix = source.isRepeat ? '↻' : '';
    if (source.lethalBurnValue != null || source.sourceKind === 'attack') {
      return `⚔${source.lethalBurnValue != null ? source.detailDisplay : source.display}${repeatSuffix}`;
    }
    if (source.sourceKind === 'freeBurn') return `🔥${source.value}${repeatSuffix}`;
    if (source.sourceKind === 'freeBuff' || source.sourceKind === 'lethalBuff') {
      return `✨+${source.value}${repeatSuffix}`;
    }
    return `${source.display || source.value}${repeatSuffix}`;
  }

  function getLethalAutoFilterSummaryOrder_(source) {
    if (source.lethalBurnValue != null || source.sourceKind === 'attack') {
      return { category: 0, value: source.value };
    }
    if (source.sourceKind === 'freeBurn') return { category: 1, value: source.value };
    if (source.sourceKind === 'freeBuff' || source.sourceKind === 'lethalBuff') {
      return { category: 2, value: source.value };
    }
    return { category: 3, value: source.value };
  }

  function renderLethalAutoFilterChips_() {
    if (!lethalAutoFilterModal) return;
    const chips = lethalAutoFilterModal.querySelector('[data-lethal-auto-chips]');
    if (!chips) return;
    chips.replaceChildren();
    const checkedInputs = [
      ...lethalAutoFilterModal.querySelectorAll('[data-lethal-auto-option]:checked'),
    ];
    if (checkedInputs.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'lethal-auto-filter-modal__chips-empty';
      empty.textContent = '選択中: なし';
      chips.appendChild(empty);
      return;
    }

    const heading = document.createElement('span');
    heading.className = 'lethal-auto-filter-modal__chips-label';
    heading.textContent = '選択中:';
    chips.appendChild(heading);
    const selectedCounts = new Map();
    for (const input of checkedInputs) {
      const repeatSelect = input.closest('.lethal-auto-filter-card__option')
        ?.querySelector('[data-lethal-auto-repeat-count]');
      const label = repeatSelect
        ? `${input.dataset.chipLabel}（最大${repeatSelect.value}回）`
        : input.dataset.chipLabel;
      if (!selectedCounts.has(label)) {
        selectedCounts.set(label, {
          label,
          count: 0,
          category: Number(input.dataset.summaryCategory),
          value: Number(input.dataset.summaryValue),
        });
      }
      selectedCounts.get(label).count += 1;
    }
    const selectedItems = [...selectedCounts.values()].sort((a, b) =>
      a.category - b.category ||
      a.value - b.value ||
      a.label.localeCompare(b.label, 'ja')
    );
    for (const { label, count } of selectedItems) {
      const item = document.createElement('span');
      item.className = 'lethal-auto-filter-modal__selected-item';
      item.appendChild(document.createTextNode(label));
      if (count > 1) {
        const countLabel = document.createElement('span');
        countLabel.className = 'lethal-auto-filter-modal__selected-count';
        countLabel.textContent = `×${count}`;
        countLabel.setAttribute('aria-label', `${count}件`);
        item.appendChild(countLabel);
      }
      chips.appendChild(item);
    }
  }

  function resetLethalAutoFilterChecks_(mode) {
    if (!lethalAutoFilterModal) return;
    lethalAutoFilterModal.querySelectorAll('[data-lethal-auto-option]').forEach(input => {
      if (mode === 'all') input.checked = true;
      else if (mode === 'none') input.checked = false;
      else input.checked = input.dataset.defaultChecked === 'true';
    });
    syncLethalAutoRepeatSelects_();
    renderLethalAutoFilterChips_();
  }

  function syncLethalAutoRepeatSelects_() {
    if (!lethalAutoFilterModal) return;
    lethalAutoFilterModal.querySelectorAll('[data-lethal-auto-repeat-count]').forEach(select => {
      const input = select.closest('.lethal-auto-filter-card__option')
        ?.querySelector('[data-lethal-auto-option]');
      select.disabled = !input?.checked;
    });
  }

  function ensureLethalAutoFilterModal_() {
    if (lethalAutoFilterModal?.isConnected) return lethalAutoFilterModal;
    const modal = document.createElement('div');
    modal.className = 'lethal-auto-filter-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <section class="lethal-auto-filter-modal__dialog" role="dialog" aria-modal="true"
        aria-labelledby="lethal-auto-filter-title" aria-describedby="lethal-auto-filter-description">
        <header class="lethal-auto-filter-modal__header">
          <div>
            <h3 id="lethal-auto-filter-title">リーサル手段を選択</h3>
            <p id="lethal-auto-filter-description">自動生成に含めるカードと手段を選んでください</p>
          </div>
          <button type="button" class="lethal-auto-filter-modal__close"
            data-lethal-auto-close aria-label="閉じる">×</button>
        </header>
        <div class="lethal-auto-filter-modal__bulk">
          <button type="button" data-lethal-auto-check="all">すべて選択</button>
          <button type="button" data-lethal-auto-check="none">すべて解除</button>
          <button type="button" data-lethal-auto-check="default">初期状態に戻す</button>
        </div>
        <div class="lethal-auto-filter-modal__chips" data-lethal-auto-chips></div>
        <div class="lethal-auto-filter-modal__cards" data-lethal-auto-cards></div>
        <footer class="lethal-auto-filter-modal__footer">
          <button type="button" class="lethal-auto-filter-modal__cancel"
            data-lethal-auto-close>キャンセル</button>
          <button type="button" class="lethal-auto-filter-modal__generate"
            data-lethal-auto-generate>この条件で生成</button>
        </footer>
      </section>
    `;
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-lethal-auto-close]')) {
        closeLethalAutoFilterModal_();
        return;
      }
      const checkButton = event.target.closest('[data-lethal-auto-check]');
      if (checkButton) {
        resetLethalAutoFilterChecks_(checkButton.dataset.lethalAutoCheck);
        return;
      }
      if (!event.target.closest('[data-lethal-auto-generate]')) return;
      const enabledOptionKeys = new Set(
        [...modal.querySelectorAll('[data-lethal-auto-option]:checked')]
          .map(input => input.value)
      );
      allowedAutoLethalRepeatCounts = new Map(
        [...modal.querySelectorAll('[data-lethal-auto-option]:checked')]
          .map(input => {
            const select = input.closest('.lethal-auto-filter-card__option')
              ?.querySelector('[data-lethal-auto-repeat-count]');
            return select ? [input.value, Number(select.value)] : null;
          })
          .filter(item => item !== null)
      );
      closeLethalAutoFilterModal_();
      allowedAutoLethalOptions = new Set(enabledOptionKeys);
      lethalPlannerAutoFilterActive = true;
      lethalPlannerAutoSearched = true;
      lethalPlannerAutoExpanded = false;
      lethalPlannerAutoPlans = generateLethalPlannerAutoPlans_(allowedAutoLethalOptions);
      if (lethalPlannerAutoPlans[0]) applyLethalPlannerAutoPlan_(lethalPlannerAutoPlans[0]);
      else renderLethalPlannerAutoPlans_();
    });
    modal.addEventListener('change', event => {
      if (event.target.matches('[data-lethal-auto-option]')) {
        syncLethalAutoRepeatSelects_();
        renderLethalAutoFilterChips_();
      }
      if (event.target.matches('[data-lethal-auto-repeat-count]')) {
        renderLethalAutoFilterChips_();
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !modal.hidden) closeLethalAutoFilterModal_();
    });
    document.body.appendChild(modal);
    lethalAutoFilterModal = modal;
    return modal;
  }

  function openLethalAutoFilterModal_(trigger) {
    const modal = ensureLethalAutoFilterModal_();
    const cardsContainer = modal.querySelector('[data-lethal-auto-cards]');
    cardsContainer.replaceChildren();
    const groups = getLethalAutoFilterCardGroups_();
    for (const group of groups) {
      const cardRow = document.createElement('article');
      cardRow.className = 'lethal-auto-filter-card';

      const image = document.createElement('img');
      image.className = 'lethal-auto-filter-card__image';
      image.src = imgSrcOf(group.cardId);
      image.alt = '';
      image.onerror = () => {
        if (image.dataset.fallbackApplied) return;
        image.dataset.fallbackApplied = '1';
        image.src = FALLBACK_IMG;
      };
      cardRow.appendChild(image);

      const content = document.createElement('div');
      content.className = 'lethal-auto-filter-card__content';
      const title = document.createElement('h4');
      title.className = 'lethal-auto-filter-card__title';
      title.textContent = `${group.cardName} ×${group.count}`;
      content.appendChild(title);

      const options = document.createElement('div');
      options.className = 'lethal-auto-filter-card__options';
      for (const option of group.options.values()) {
        const label = document.createElement('label');
        label.className = 'lethal-auto-filter-card__option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = option.key;
        input.checked = allowedAutoLethalOptions instanceof Set
          ? allowedAutoLethalOptions.has(option.key)
          : option.defaultChecked;
        input.dataset.defaultChecked = String(option.defaultChecked);
        input.dataset.chipLabel = getLethalAutoFilterChipLabel_(option.source);
        const summaryOrder = getLethalAutoFilterSummaryOrder_(option.source);
        input.dataset.summaryCategory = String(summaryOrder.category);
        input.dataset.summaryValue = String(summaryOrder.value);
        input.setAttribute('data-lethal-auto-option', '');
        label.append(input, document.createTextNode(option.label));
        if (option.source.isRepeat) {
          const repeatControl = document.createElement('span');
          repeatControl.className = 'lethal-auto-filter-card__repeat-control';
          repeatControl.appendChild(document.createTextNode('最大'));
          const repeatSelect = document.createElement('select');
          repeatSelect.setAttribute('data-lethal-auto-repeat-count', '');
          repeatSelect.setAttribute('aria-label', `${group.cardName} ${option.label}の最大繰り返し回数`);
          for (let repeatCount = 1; repeatCount <= option.source.count; repeatCount += 1) {
            const repeatOption = document.createElement('option');
            repeatOption.value = String(repeatCount);
            repeatOption.textContent = String(repeatCount);
            repeatSelect.appendChild(repeatOption);
          }
          repeatSelect.value = String(
            allowedAutoLethalRepeatCounts.get(option.key) ||
            Math.min(LETHAL_PLANNER_DEFAULT_REPEAT_COUNT, option.source.count)
          );
          repeatControl.append(repeatSelect, document.createTextNode('回'));
          label.appendChild(repeatControl);
        }
        options.appendChild(label);
      }
      content.appendChild(options);
      cardRow.appendChild(content);
      cardsContainer.appendChild(cardRow);
    }
    syncLethalAutoRepeatSelects_();
    renderLethalAutoFilterChips_();

    lethalAutoFilterLastFocus = trigger || document.activeElement;
    modal.hidden = false;
    document.body.classList.add('lethal-auto-filter-open');
    modal.querySelector('[data-lethal-auto-generate]')?.focus();
  }

  function renderLethalPlannerAutoPlans_() {
    const results = document.getElementById('lethal-planner-auto-results');
    if (!results) return;
    hideLethalAutoCardsPopup_();
    results.innerHTML = '';
    if (lethalPlannerAutoPlans.length === 0) {
      if (lethalPlannerAutoSearched) {
        const empty = document.createElement('span');
        empty.className = 'lethal-planner__auto-empty';
        empty.textContent = '30〜35点の候補が見つかりませんでした';
        results.appendChild(empty);
        appendLethalAutoSelectedCardsButton_(results);
      }
      return;
    }

    const visibleLimit = lethalPlannerAutoExpanded
      ? LETHAL_PLANNER_AUTO_RESULT_LIMIT
      : LETHAL_PLANNER_AUTO_INITIAL_RESULT_LIMIT;
    lethalPlannerAutoPlans.slice(0, visibleLimit).forEach((plan, index) => {
      const row = document.createElement('div');
      row.className = 'lethal-planner__auto-result-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lethal-planner__auto-result';
      button.dataset.lethalAutoIndex = String(index);
      const values = plan.items.map(item =>
        item.type === 'buff' ? `(+${item.value})` : (item.display || String(item.value))
      );
      button.textContent = `候補${index + 1}　${plan.total}点: ${values.join(' + ')}`;
      row.appendChild(button);
      results.appendChild(row);
    });
    if (lethalPlannerAutoPlans.length > LETHAL_PLANNER_AUTO_INITIAL_RESULT_LIMIT) {
      const toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'lethal-planner__auto-toggle';
      toggleButton.textContent = lethalPlannerAutoExpanded ? '少なく表示' : 'もっと見る';
      toggleButton.setAttribute('aria-expanded', String(lethalPlannerAutoExpanded));
      results.appendChild(toggleButton);
    }
    appendLethalAutoSelectedCardsButton_(results);
  }

  function toggleLethalPlannerAutoResults_() {
    if (lethalPlannerAutoPlans.length <= LETHAL_PLANNER_AUTO_INITIAL_RESULT_LIMIT) return;
    lethalPlannerAutoExpanded = !lethalPlannerAutoExpanded;
    renderLethalPlannerAutoPlans_();
    document.dispatchEvent(new CustomEvent('lethal-planner:rendered'));
  }

  function appendLethalAutoSelectedCardsButton_(container) {
    if (!(allowedAutoLethalOptions instanceof Set) || allowedAutoLethalOptions.size === 0) {
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'lethal-planner__auto-cards-control';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lethal-planner__auto-cards-button';
    button.setAttribute('aria-label', '自動生成条件で選択したカードを表示');
    button.title = '選択したカードを表示';
    const image = document.createElement('img');
    image.className = 'lethal-planner__auto-cards-icon';
    image.src = 'img/00000.webp';
    image.alt = '';
    const label = document.createElement('span');
    label.className = 'lethal-planner__auto-cards-label';
    label.textContent = '条件カード';
    button.append(image, label);
    wrapper.appendChild(button);
    container.appendChild(wrapper);
  }

  function getLethalAutoSelectedCards_() {
    if (!(allowedAutoLethalOptions instanceof Set)) return [];
    const cards = new Map();
    for (const candidate of lethalPlannerCandidates.values()) {
      for (const source of candidate.sources.values()) {
        if (
          !allowedAutoLethalOptions.has(getLethalPlannerAutoOptionKey_(source)) ||
          cards.has(source.cardId)
        ) {
          continue;
        }
        cards.set(source.cardId, {
          cd: source.cardId,
          name: source.cardName || getCard(source.cardId)?.name || source.cardId,
        });
      }
    }
    return [...cards.values()];
  }

  function ensureLethalAutoCardsPopup_() {
    if (lethalAutoCardsPopup?.isConnected) return lethalAutoCardsPopup;
    const popup = document.createElement('div');
    popup.className = 'lethal-auto-cards-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', '自動生成条件で選択したカード');
    popup.hidden = true;
    document.body.appendChild(popup);
    lethalAutoCardsPopup = popup;
    return popup;
  }

  function hideLethalAutoCardsPopup_() {
    lethalAutoCardsPopupButton = null;
    if (!lethalAutoCardsPopup) return;
    lethalAutoCardsPopup.hidden = true;
    lethalAutoCardsPopup.replaceChildren();
  }

  function positionLethalAutoCardsPopup_(button, popup) {
    const buttonRect = button.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const margin = 8;
    const gap = 7;
    const left = Math.min(
      window.innerWidth - popupRect.width - margin,
      Math.max(margin, buttonRect.right - popupRect.width)
    );
    const fitsBelow = buttonRect.bottom + gap + popupRect.height <= window.innerHeight - margin;
    const top = fitsBelow
      ? buttonRect.bottom + gap
      : Math.max(margin, buttonRect.top - popupRect.height - gap);
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  function showLethalAutoCardsPopup_(button) {
    const cards = getLethalAutoSelectedCards_();
    if (cards.length === 0) return;
    const popup = ensureLethalAutoCardsPopup_();
    popup.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'lethal-auto-cards-popup__title';
    heading.textContent = '選択したカード';
    popup.appendChild(heading);
    for (const card of cards) {
      const item = document.createElement('div');
      item.className = 'lethal-auto-cards-popup__card';
      item.title = card.name;
      const image = document.createElement('img');
      image.className = 'lethal-auto-cards-popup__image';
      image.src = imgSrcOf(card.cd);
      image.alt = card.name;
      image.onerror = () => {
        if (image.dataset.fallbackApplied) return;
        image.dataset.fallbackApplied = '1';
        image.src = FALLBACK_IMG;
      };
      item.appendChild(image);
      popup.appendChild(item);
    }
    lethalAutoCardsPopupButton = button;
    popup.hidden = false;
    positionLethalAutoCardsPopup_(button, popup);
  }

  function toggleLethalAutoCardsPopup_(button) {
    if (lethalAutoCardsPopupButton === button && !lethalAutoCardsPopup?.hidden) {
      hideLethalAutoCardsPopup_();
      return;
    }
    showLethalAutoCardsPopup_(button);
  }

  function appendLethalPlannerChip_(container, selection, selectionIndex, isBuff) {
    const chip = document.createElement('span');
    chip.className = `lethal-planner__term${isBuff ? ' lethal-planner__term--buff' : ''}`;
    chip.draggable = true;
    chip.dataset.lethalSelectionIndex = String(selectionIndex);

    const type = lethalPlannerTypes.find(item => item.key === selection.type);
    const icon = document.createElement('span');
    icon.className = 'lethal-planner__term-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = type?.icon || '';
    chip.appendChild(icon);

    const value = document.createElement('span');
    value.className = 'lethal-planner__term-value';
    value.textContent = isBuff ? `(+${selection.value})` : (selection.display || String(selection.value));
    chip.appendChild(value);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'lethal-planner__term-remove';
    remove.dataset.lethalSelectionIndex = String(selectionIndex);
    remove.setAttribute('aria-label', `${selection.display || selection.value}を式から削除`);
    remove.textContent = '×';
    chip.appendChild(remove);
    container.appendChild(chip);
  }

  function appendLethalPlannerSeparator_(container) {
    const separator = document.createElement('span');
    separator.className = 'lethal-planner__operator';
    separator.textContent = '+';
    container.appendChild(separator);
  }

  function supportsLethalCandidateTooltip_() {
    return window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;
  }

  function ensureLethalCandidateTooltip_() {
    if (lethalCandidateTooltip?.isConnected) return lethalCandidateTooltip;
    const tooltip = document.createElement('div');
    tooltip.className = 'lethal-candidate-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    lethalCandidateTooltip = tooltip;
    return tooltip;
  }

  function hideLethalCandidateTooltip_() {
    if (lethalCandidateTooltipTimer !== null) {
      window.clearTimeout(lethalCandidateTooltipTimer);
      lethalCandidateTooltipTimer = null;
    }
    lethalCandidateTooltipButton = null;
    if (!lethalCandidateTooltip) return;
    lethalCandidateTooltip.hidden = true;
    lethalCandidateTooltip.setAttribute('aria-hidden', 'true');
    lethalCandidateTooltip.replaceChildren();
  }

  function getAvailableCardsForLethalCandidate_(candidate) {
    if (!candidate?.sources) return [];
    const sources = [...candidate.sources.values()];
    if (sources.some(source => source.requiresAttack)) {
      const cards = new Map();
      const previewStepId = `preview:${candidate.key}`;
      for (const source of sources) {
        for (const attackAssignment of getLethalPlannerAttackAssignments_(source)) {
          const previewStep = {
            stepId: previewStepId,
            key: candidate.key,
            type: candidate.type,
            value: candidate.value,
            display: candidate.display,
            sourceKind: source.sourceKind,
            linkedAttackStepId: attackAssignment.selection.stepId,
          };
          const resolved = resolveSelectedLethalStepCandidates_([
            ...lethalPlannerSelections,
            previewStep,
          ]).get(previewStepId);
          const possibleCards = [
            ...(resolved?.fixedCards || []),
            ...(resolved?.candidateCards || []),
          ];
          for (const card of possibleCards) {
            if (card.cd === source.cardId && !cards.has(card.cd)) cards.set(card.cd, card);
          }
        }
      }
      return [...cards.values()];
    }

    const previewStepId = `preview:${candidate.key}`;
    const previewSource = sources[0];
    const resolved = resolveSelectedLethalStepCandidates_([
      ...lethalPlannerSelections,
      {
        stepId: previewStepId,
        key: candidate.key,
        type: candidate.type,
        value: candidate.value,
        display: candidate.display,
        sourceKind: previewSource?.sourceKind || candidate.type,
        attackValue: candidate.attackValue,
        lethalBurnValue: candidate.lethalBurnValue,
      },
    ]).get(previewStepId);
    return resolved ? [...resolved.fixedCards, ...resolved.candidateCards] : [];
  }

  function positionLethalCandidateTooltip_(button, tooltip) {
    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportMargin = 8;
    const gap = 7;
    const left = Math.min(
      window.innerWidth - tooltipRect.width - viewportMargin,
      Math.max(viewportMargin, buttonRect.left + (buttonRect.width - tooltipRect.width) / 2)
    );
    const fitsBelow = buttonRect.bottom + gap + tooltipRect.height <= window.innerHeight - viewportMargin;
    const top = fitsBelow
      ? buttonRect.bottom + gap
      : Math.max(viewportMargin, buttonRect.top - tooltipRect.height - gap);
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function showLethalCandidateTooltip_(button, candidate) {
    if (
      !supportsLethalCandidateTooltip_() ||
      button.disabled ||
      !button.isConnected
    ) {
      return;
    }
    let cards = getAvailableCardsForLethalCandidate_(candidate);
    if (lethalPlannerAutoFilterActive && allowedAutoLethalOptions instanceof Set) {
      const allowedCardIds = new Set(
        [...candidate.sources.values()]
          .filter(source =>
            allowedAutoLethalOptions.has(getLethalPlannerAutoOptionKey_(source))
          )
          .map(source => source.cardId)
      );
      cards = cards.filter(card => allowedCardIds.has(card.cd));
    }
    if (cards.length === 0) return;

    const tooltip = ensureLethalCandidateTooltip_();
    tooltip.replaceChildren();
    for (const card of cards.slice(0, LETHAL_CANDIDATE_TOOLTIP_MAX_CARDS)) {
      const cardItem = document.createElement('span');
      cardItem.className = 'lethal-candidate-tooltip__card';
      const image = document.createElement('img');
      image.className = 'lethal-candidate-tooltip__image';
      image.src = imgSrcOf(card.cd);
      image.alt = '';
      image.title = card.supplement ? `${card.name}: ${card.supplement}` : card.name;
      image.onerror = () => {
        if (image.dataset.fallbackApplied) return;
        image.dataset.fallbackApplied = '1';
        image.src = FALLBACK_IMG;
      };
      cardItem.appendChild(image);
      if (card.supplement) {
        const supplement = document.createElement('span');
        supplement.className = 'lethal-candidate-tooltip__supplement';
        supplement.textContent = card.supplement;
        cardItem.appendChild(supplement);
      }
      tooltip.appendChild(cardItem);
    }
    if (cards.length > LETHAL_CANDIDATE_TOOLTIP_MAX_CARDS) {
      const remainder = document.createElement('span');
      remainder.className = 'lethal-candidate-tooltip__remainder';
      remainder.textContent = `+${cards.length - LETHAL_CANDIDATE_TOOLTIP_MAX_CARDS}`;
      tooltip.appendChild(remainder);
    }

    lethalCandidateTooltipButton = button;
    tooltip.hidden = false;
    tooltip.setAttribute('aria-hidden', 'false');
    positionLethalCandidateTooltip_(button, tooltip);
  }

  function scheduleLethalCandidateTooltip_(button, candidate) {
    hideLethalCandidateTooltip_();
    if (!supportsLethalCandidateTooltip_() || button.disabled) return;
    lethalCandidateTooltipButton = button;
    lethalCandidateTooltipTimer = window.setTimeout(() => {
      lethalCandidateTooltipTimer = null;
      if (lethalCandidateTooltipButton !== button) return;
      showLethalCandidateTooltip_(button, candidate);
    }, LETHAL_CANDIDATE_TOOLTIP_DELAY);
  }

  function bindLethalCandidateTooltip_(button, candidate) {
    button.addEventListener('mouseenter', () => {
      scheduleLethalCandidateTooltip_(button, candidate);
    });
    button.addEventListener('mouseleave', hideLethalCandidateTooltip_);
    button.addEventListener('focus', () => {
      scheduleLethalCandidateTooltip_(button, candidate);
    });
    button.addEventListener('blur', hideLethalCandidateTooltip_);
  }

  function renderLethalPlanner_() {
    const root = document.getElementById('lethal-planner');
    const groupsEl = document.getElementById('lethal-planner-groups');
    if (!root || !groupsEl) return;
    hideLethalCandidateTooltip_();

    const total = lethalPlannerSelections.reduce((sum, selection) => sum + selection.value, 0);
    const expressionEl = document.getElementById('lethal-planner-expression');
    expressionEl.innerHTML = '';
    if (lethalPlannerSelections.length === 0) {
      expressionEl.textContent = '= 0';
    } else {
      lethalPlannerSelections.forEach((selection, index) => {
        if (index > 0) appendLethalPlannerSeparator_(expressionEl);
        appendLethalPlannerChip_(expressionEl, selection, index, selection.type === 'buff');
      });

      const result = document.createElement('span');
      result.className = 'lethal-planner__result';
      result.textContent = `= ${total}`;
      expressionEl.appendChild(result);
    }

    const isComplete = total >= LETHAL_PLANNER_TARGET;
    const isJustLethal = total >= LETHAL_PLANNER_TARGET && total <= LETHAL_PLANNER_REPEAT_TARGET;
    const isOverLethal = total > LETHAL_PLANNER_REPEAT_TARGET;
    root.classList.toggle('is-complete', isComplete);
    root.classList.toggle('is-just-lethal', isJustLethal);
    root.classList.toggle('is-over-lethal', isOverLethal);

    groupsEl.innerHTML = '';
    let candidateCount = 0;
    for (const type of lethalPlannerTypes) {
      const candidates = [...lethalPlannerCandidates.values()]
        .filter(candidate => candidate.type === type.key)
        .sort((a, b) => a.value - b.value || a.display.localeCompare(b.display));

      for (const candidate of candidates) {
        candidateCount += 1;
        const key = candidate.key;
        const availableCards = getAvailableCardsForLethalCandidate_(candidate);
        const availableSource = getAvailableLethalPlannerSource_(candidate, availableCards);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lethal-planner__value';
        button.dataset.lethalKey = key;
        button.disabled = availableCards.length === 0 || !availableSource;
        button.setAttribute(
          'aria-label',
          `${type.label} ${candidate.display}${availableSource ? 'を式に追加' : 'は使用可能なカード枠がありません'}`
        );

        const icon = document.createElement('span');
        icon.className = 'lethal-planner__value-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = type.icon;
        button.appendChild(icon);

        const value = document.createElement('span');
        value.className = 'lethal-planner__value-number';
        value.textContent = `${type.key === 'buff' ? '+' : ''}${candidate.display}`;
        button.appendChild(value);
        bindLethalCandidateTooltip_(button, candidate);
        groupsEl.appendChild(button);
      }
    }

    if (candidateCount === 0) {
      const empty = document.createElement('span');
      empty.className = 'lethal-planner__empty';
      empty.textContent = '候補なし';
      groupsEl.appendChild(empty);
    }

    renderLethalPlannerCards_();
    renderLethalPlannerAutoPlans_();
    window.DeckmakerLethalPost?.validate?.();
    document.dispatchEvent(new CustomEvent('lethal-planner:rendered'));
  }

  function getSelectedLethalCardGroups_() {
    const resolvedSteps = resolveSelectedLethalStepCandidates_(lethalPlannerSelections);
    const groups = new Map();
    for (const selection of lethalPlannerSelections) {
      const resolved = resolvedSteps.get(selection.stepId);
      if (!groups.has(selection.key)) {
        groups.set(selection.key, {
          key: selection.key,
          type: selection.type,
          value: selection.value,
          display: selection.display || String(selection.value),
          requiredCount: 0,
          stepIds: [],
          cardsById: new Map(),
          physicalUseKeys: new Set(),
        });
      }
      const group = groups.get(selection.key);
      const physicalUseKey = selection.isRepeat
        ? `repeat:${selection.sourceKey}:${selection.cardId}`
        : `step:${selection.stepId}`;
      if (!group.physicalUseKeys.has(physicalUseKey)) {
        group.physicalUseKeys.add(physicalUseKey);
        group.requiredCount += 1;
      }
      group.stepIds.push(selection.stepId);
      for (const card of [...(resolved?.fixedCards || []), ...(resolved?.candidateCards || [])]) {
        const cardId = normCd5(card.cd);
        if (!group.cardsById.has(cardId)) group.cardsById.set(cardId, card);
      }
    }
    return [...groups.values()].map(group => ({
      ...group,
      cards: [...group.cardsById.values()],
    }));
  }

  function getLethalPlannerDeckCount_(cardId) {
    return Number(deck[normCd5(cardId)] || 0);
  }

  function getLethalPlannerGroupCardSelections_(groupKey, create = false) {
    let selections = lethalPlannerCardSelections.get(groupKey);
    if (!selections && create) {
      selections = new Map();
      lethalPlannerCardSelections.set(groupKey, selections);
    }
    return selections;
  }

  function getLethalPlannerGroupSelectedCount_(groupKey) {
    return [...(getLethalPlannerGroupCardSelections_(groupKey)?.values() || [])]
      .reduce((total, count) => total + count, 0);
  }

  function getLethalPlannerSelectedCardCounts_() {
    const counts = new Map();
    for (const selections of lethalPlannerCardSelections.values()) {
      for (const [cardId, count] of selections) {
        counts.set(cardId, (counts.get(cardId) || 0) + count);
      }
    }
    return counts;
  }

  function getCurrentLethalPlanVariant_() {
    if (lethalPlannerSelections.length === 0) return null;
    const groups = getSelectedLethalCardGroups_();
    sanitizeLethalPlannerCardSelections_(groups);
    autoSelectSingleLethalCandidates_(groups);
    const assignedByGroup = new Map();
    for (const group of groups) {
      const assigned = [];
      for (const [cardId, count] of getLethalPlannerGroupCardSelections_(group.key) || []) {
        for (let index = 0; index < count; index += 1) assigned.push(cardId);
      }
      if (assigned.length !== group.requiredCount) return null;
      assignedByGroup.set(group.key, assigned);
    }

    const stepIndexes = new Map(lethalPlannerSelections.map((step, index) => [step.stepId, index]));
    const steps = lethalPlannerSelections.map(selection => {
      const assignedCards = assignedByGroup.get(selection.key) || [];
      const cardId = selection.isRepeat
        ? assignedCards.find(id => id === selection.cardId) || assignedCards[0] || ''
        : assignedCards.shift() || '';
      const card = getCard(cardId);
      return {
        cardId,
        cardName: card?.name || selection.cardName || cardId,
        type: selection.type,
        value: Number(selection.value) || 0,
        display: selection.display || String(selection.value),
        sourceKind: selection.sourceKind || '',
        sourceKey: selection.sourceKey || '',
        attackValue: selection.attackValue ?? null,
        lethalBurnValue: selection.lethalBurnValue ?? null,
        isRepeat: selection.isRepeat === true,
        linkedStepIndex: stepIndexes.has(selection.linkedAttackStepId)
          ? stepIndexes.get(selection.linkedAttackStepId)
          : null,
      };
    });
    const values = lethalPlannerSelections.map(selection => Number(selection.value) || 0);
    return { values, total: values.reduce((sum, value) => sum + value, 0), variant: { steps } };
  }

  function buildLethalVariantFromAssignments_(assignedByGroup) {
    const queues = new Map(
      [...assignedByGroup].map(([key, cardIds]) => [key, [...cardIds]])
    );
    const stepIndexes = new Map(lethalPlannerSelections.map((step, index) => [step.stepId, index]));
    return {
      steps: lethalPlannerSelections.map(selection => {
        const assignedCards = queues.get(selection.key) || [];
        const cardId = selection.isRepeat
          ? assignedCards.find(id => id === selection.cardId) || assignedCards[0] || ''
          : assignedCards.shift() || '';
        const card = getCard(cardId);
        return {
          cardId,
          cardName: card?.name || selection.cardName || cardId,
          type: selection.type,
          value: Number(selection.value) || 0,
          display: selection.display || String(selection.value),
          sourceKind: selection.sourceKind || '',
          sourceKey: selection.sourceKey || '',
          attackValue: selection.attackValue ?? null,
          lethalBurnValue: selection.lethalBurnValue ?? null,
          isRepeat: selection.isRepeat === true,
          linkedStepIndex: stepIndexes.has(selection.linkedAttackStepId)
            ? stepIndexes.get(selection.linkedAttackStepId)
            : null,
        };
      }),
    };
  }

  function getLethalGroupAllocations_(group) {
    const cards = group.cards.map(card => normCd5(card.cd));
    const results = [];
    function visit(cardIndex, remaining, selected) {
      if (cardIndex >= cards.length) {
        if (remaining === 0) results.push([...selected]);
        return;
      }
      const cardId = cards[cardIndex];
      const maxCount = Math.min(remaining, getLethalPlannerDeckCount_(cardId));
      for (let count = 0; count <= maxCount; count += 1) {
        for (let index = 0; index < count; index += 1) selected.push(cardId);
        visit(cardIndex + 1, remaining - count, selected);
        selected.splice(selected.length - count, count);
      }
    }
    visit(0, group.requiredCount, []);
    return results;
  }

  function getLethalPlannerPlanCandidates_() {
    const values = lethalPlannerSelections.map(selection => Number(selection.value) || 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    if (values.length === 0) return { values, total, variants: [] };
    const groups = getSelectedLethalCardGroups_();
    const allocationsByGroup = groups.map(group => ({
      key: group.key,
      allocations: getLethalGroupAllocations_(group),
    }));
    const variants = [];
    function combine(groupIndex, assignedByGroup, usedCounts) {
      if (groupIndex >= allocationsByGroup.length) {
        variants.push(buildLethalVariantFromAssignments_(assignedByGroup));
        return;
      }
      const group = allocationsByGroup[groupIndex];
      for (const allocation of group.allocations) {
        const added = new Map();
        let valid = true;
        for (const cardId of allocation) {
          added.set(cardId, (added.get(cardId) || 0) + 1);
        }
        for (const [cardId, count] of added) {
          if ((usedCounts.get(cardId) || 0) + count > getLethalPlannerDeckCount_(cardId)) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;
        for (const [cardId, count] of added) usedCounts.set(cardId, (usedCounts.get(cardId) || 0) + count);
        assignedByGroup.set(group.key, allocation);
        combine(groupIndex + 1, assignedByGroup, usedCounts);
        assignedByGroup.delete(group.key);
        for (const [cardId, count] of added) {
          const next = (usedCounts.get(cardId) || 0) - count;
          if (next > 0) usedCounts.set(cardId, next);
          else usedCounts.delete(cardId);
        }
      }
    }
    combine(0, new Map(), new Map());
    return { values, total, variants };
  }

  function getLethalPlannerCardsForKey_(key) {
    const candidate = lethalPlannerCandidates.get(String(key || ''));
    if (!candidate) return [];
    let cards = getAvailableCardsForLethalCandidate_(candidate);
    if (lethalPlannerAutoFilterActive && allowedAutoLethalOptions instanceof Set) {
      const allowedCardIds = new Set([...candidate.sources.values()]
        .filter(source => allowedAutoLethalOptions.has(getLethalPlannerAutoOptionKey_(source)))
        .map(source => source.cardId));
      cards = cards.filter(card => allowedCardIds.has(card.cd));
    }
    return cards.map(card => ({
      cardId: normCd5(card.cd),
      cardName: card.name || normCd5(card.cd),
      supplement: card.supplement || '',
    }));
  }

  function getLethalPlannerComposerStatus_() {
    const total = lethalPlannerSelections.reduce(
      (sum, selection) => sum + (Number(selection.value) || 0),
      0
    );
    const groups = getSelectedLethalCardGroups_();
    sanitizeLethalPlannerCardSelections_(groups);
    autoSelectSingleLethalCandidates_(groups);
    const cardsComplete = lethalPlannerSelections.length > 0 && groups.every(group =>
      getLethalPlannerGroupSelectedCount_(group.key) === group.requiredCount
    );
    return { total, cardsComplete };
  }

  function resetLethalPlannerComposer_() {
    lethalPlannerSelections.splice(0, lethalPlannerSelections.length);
    lethalPlannerCardSelections.clear();
    lethalPlannerAutoFilterActive = false;
    lethalPlannerStepId = 0;
    renderLethalPlanner_();
  }

  function canAddLethalPlannerCard_(group, cardId) {
    if (getLethalPlannerGroupSelectedCount_(group.key) >= group.requiredCount) return false;
    const selectedCounts = getLethalPlannerSelectedCardCounts_();
    return (selectedCounts.get(cardId) || 0) < getLethalPlannerDeckCount_(cardId);
  }

  function sanitizeLethalPlannerCardSelections_(groups) {
    const validGroups = new Map(groups.map(group => [group.key, group]));
    const nextSelections = new Map();
    const globalCounts = new Map();

    for (const [groupKey, selections] of lethalPlannerCardSelections) {
      const group = validGroups.get(groupKey);
      if (!group) continue;
      const validCardIds = new Set(group.cards.map(card => normCd5(card.cd)));
      const nextGroupSelections = new Map();
      let groupCount = 0;

      for (const [cardId, rawCount] of selections) {
        if (!validCardIds.has(cardId) || groupCount >= group.requiredCount) continue;
        const deckCount = getLethalPlannerDeckCount_(cardId);
        const globallyUsed = globalCounts.get(cardId) || 0;
        const allowedCount = Math.min(
          Math.max(0, Number(rawCount) || 0),
          group.requiredCount - groupCount,
          Math.max(0, deckCount - globallyUsed)
        );
        if (allowedCount <= 0) continue;
        nextGroupSelections.set(cardId, allowedCount);
        groupCount += allowedCount;
        globalCounts.set(cardId, globallyUsed + allowedCount);
      }
      if (nextGroupSelections.size > 0) nextSelections.set(groupKey, nextGroupSelections);
    }

    lethalPlannerCardSelections.clear();
    for (const [groupKey, selections] of nextSelections) {
      lethalPlannerCardSelections.set(groupKey, selections);
    }
  }

  function autoSelectSingleLethalCandidates_(groups) {
    const globalCounts = getLethalPlannerSelectedCardCounts_();
    for (const group of groups) {
      if (group.cards.length !== 1) continue;
      const cardId = normCd5(group.cards[0].cd);
      const selectedCount = getLethalPlannerGroupSelectedCount_(group.key);
      const missingCount = Math.max(0, group.requiredCount - selectedCount);
      if (missingCount === 0) continue;
      const globallyUsed = globalCounts.get(cardId) || 0;
      const availableCount = Math.max(0, getLethalPlannerDeckCount_(cardId) - globallyUsed);
      const addCount = Math.min(missingCount, availableCount);
      if (addCount === 0) continue;
      const selections = getLethalPlannerGroupCardSelections_(group.key, true);
      selections.set(cardId, (selections.get(cardId) || 0) + addCount);
      globalCounts.set(cardId, globallyUsed + addCount);
    }
  }

  function renderLethalPlannerCards_() {
    const list = document.getElementById('lethal-planner-card-list');
    if (!list) return;

    if (lethalPlannerSelections.length === 0) {
      list.textContent = '式に追加すると使用カードを表示します';
      document.dispatchEvent(new CustomEvent('lethal-planner:cards-rendered'));
      return;
    }

    const groups = getSelectedLethalCardGroups_();
    sanitizeLethalPlannerCardSelections_(groups);
    autoSelectSingleLethalCandidates_(groups);
    const selectedCounts = getLethalPlannerSelectedCardCounts_();
    list.innerHTML = '';
    for (const groupData of groups) {
      const candidate = lethalPlannerCandidates.get(groupData.key);
      if (!candidate) continue;
      const availableCards = groupData.cards;
      if (availableCards.length === 0) continue;

      const type = lethalPlannerTypes.find(item => item.key === groupData.type);
      const groupSelectedCount = getLethalPlannerGroupSelectedCount_(groupData.key);
      const isGroupComplete = groupSelectedCount >= groupData.requiredCount;

      const group = document.createElement('div');
      group.className = 'lethal-card-group';
      group.classList.toggle('is-complete', isGroupComplete);

      const title = document.createElement('div');
      title.className = 'lethal-card-group-title';
      const titleValue = document.createElement('span');
      titleValue.className = 'lethal-card-group-title__value';
      titleValue.textContent = `${type?.icon || ''} ${groupData.type === 'buff' ? '+' : ''}${groupData.display}`.trim();
      title.appendChild(titleValue);
      title.setAttribute(
        'aria-label',
        `${type?.label || groupData.type} ${groupData.display}`
      );
      group.appendChild(title);

      const cardList = document.createElement('div');
      cardList.className = 'lethal-card-list';
      for (const card of availableCards) {
        const cardId = normCd5(card.cd);
        const selectedCount =
          getLethalPlannerGroupCardSelections_(groupData.key)?.get(cardId) || 0;
        const deckCount = getLethalPlannerDeckCount_(cardId);
        const usedCount = selectedCounts.get(cardId) || 0;
        const remainingCount = Math.max(0, deckCount - usedCount);
        const cannotIncrement = isGroupComplete || remainingCount === 0;
        const visibleCopyCount = Math.max(1, selectedCount + (cannotIncrement ? 0 : 1));

        for (let copyIndex = 0; copyIndex < visibleCopyCount; copyIndex += 1) {
          const isSelectedCopy = copyIndex < selectedCount;
          const isUnavailable = !isSelectedCopy && remainingCount === 0;
          const item = document.createElement('span');
          item.className = 'lethal-card-mini-wrap';
          const mini = document.createElement('button');
          mini.type = 'button';
          mini.className = 'lethal-card-mini';
          mini.dataset.lethalCardGroupKey = groupData.key;
          mini.dataset.lethalCardId = cardId;
          mini.dataset.lethalCardSelected = String(isSelectedCopy);
          mini.classList.toggle('is-selected', isSelectedCopy);
          mini.classList.toggle('is-unavailable', isUnavailable);
          mini.classList.toggle('is-group-complete', isGroupComplete && !isUnavailable);
          mini.disabled = !isSelectedCopy && cannotIncrement;
          mini.setAttribute('aria-pressed', String(isSelectedCopy));
          mini.setAttribute(
            'aria-label',
            isSelectedCopy
              ? `${card.name}の選択を1枚解除する、現在${selectedCount}枚`
              : `${card.name}を1枚選択する、現在${selectedCount}枚、残り${remainingCount}枚`
          );
          mini.title = isUnavailable ? '別の打点で使用中・残り0枚' : '';

          const image = document.createElement('img');
          image.className = 'lethal-card-mini__image';
          image.src = imgSrcOf(card.cd);
          image.alt = card.name;
          image.loading = 'lazy';
          image.onerror = () => {
            if (image.dataset.fallbackApplied) return;
            image.dataset.fallbackApplied = '1';
            image.src = FALLBACK_IMG;
          };
          mini.appendChild(image);
          if (card.supplement) {
            const supplement = document.createElement('span');
            supplement.className = 'lethal-card-mini__supplement';
            supplement.textContent = card.supplement;
            mini.appendChild(supplement);
          }
          if (isSelectedCopy) {
            const check = document.createElement('span');
            check.className = 'lethal-card-mini__check';
            check.setAttribute('aria-hidden', 'true');
            check.textContent = '✓';
            mini.appendChild(check);
          }
          item.appendChild(mini);
          cardList.appendChild(item);
        }
      }

      group.appendChild(cardList);
      list.appendChild(group);
    }
    document.dispatchEvent(new CustomEvent('lethal-planner:cards-rendered'));
  }

  function buildLethalReportText_() {
    const deckLines = getDeckEntriesSorted().map(([cd, count]) => {
      const card = getCard(cd);
      return `${card?.name || cd} ×${count}`;
    });
    const expression = lethalPlannerSelections.length === 0
      ? '未選択'
      : `${lethalPlannerSelections.map(selection =>
        selection.type === 'buff'
          ? `(+${selection.value})`
          : (selection.display || String(selection.value))
      ).join(' + ')} = ${lethalPlannerSelections.reduce((sum, selection) =>
        sum + selection.value, 0)}`;
    const candidateLines = [];

    for (const group of getSelectedLethalCardGroups_()) {
      const type = lethalPlannerTypes.find(item => item.key === group.type);
      const value = `${group.type === 'buff' ? '+' : ''}${group.display}`;
      candidateLines.push(`${type?.label || group.type}${value}：`);
      if (group.cards.length === 0) {
        candidateLines.push('候補なし');
      } else {
        candidateLines.push(...group.cards.map(card => `- ${card.name}`));
      }
      candidateLines.push('');
    }

    if (candidateLines.length === 0) candidateLines.push('未選択');

    return [
      '■ デッキリスト',
      ...(deckLines.length > 0 ? deckLines : ['カードなし']),
      '',
      '■ 現在のリーサル式',
      expression,
      '',
      '■ 候補カード',
      ...candidateLines,
    ].join('\n').trimEnd();
  }

  function copyTextWithFallback_(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (_) {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  async function copyLethalReport_() {
    const text = buildLethalReportText_();
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        return copyTextWithFallback_(text);
      }
    }
    return copyTextWithFallback_(text);
  }

  function showLethalCopyStatus_(message, isError = false, statusElement = null) {
    const status = statusElement || document.querySelector('[data-lethal-copy-status]');
    if (!status) return;
    if (lethalCopyStatusTimer !== null) window.clearTimeout(lethalCopyStatusTimer);
    status.textContent = message;
    status.classList.toggle('is-error', isError);
    lethalCopyStatusTimer = window.setTimeout(() => {
      status.textContent = '';
      status.classList.remove('is-error');
      lethalCopyStatusTimer = null;
    }, 3000);
  }

  function bindLethalPlannerEvents_() {
    if (lethalPlannerEventsBound) return;
    const root = document.getElementById('lethal-planner');
    if (!root) return;

    root.addEventListener('click', (event) => {
      const candidateCardButton = event.target.closest('[data-lethal-card-group-key]');
      if (candidateCardButton) {
        const groupKey = candidateCardButton.dataset.lethalCardGroupKey;
        const cardId = normCd5(candidateCardButton.dataset.lethalCardId);
        const group = getSelectedLethalCardGroups_().find(item => item.key === groupKey);
        if (!group || !cardId) return;
        const isSelectedCopy = candidateCardButton.dataset.lethalCardSelected === 'true';
        if (isSelectedCopy) {
          const groupSelections = getLethalPlannerGroupCardSelections_(groupKey);
          const selectedCount = groupSelections?.get(cardId) || 0;
          if (selectedCount <= 1) groupSelections?.delete(cardId);
          else groupSelections.set(cardId, selectedCount - 1);
          if (groupSelections?.size === 0) lethalPlannerCardSelections.delete(groupKey);
        } else if (canAddLethalPlannerCard_(group, cardId)) {
          const groupSelections = getLethalPlannerGroupCardSelections_(groupKey, true);
          groupSelections.set(cardId, (groupSelections.get(cardId) || 0) + 1);
        }
        renderLethalPlannerCards_();
        return;
      }

      const reportButton = event.target.closest('[data-lethal-report]');
      if (reportButton) {
        window.open(LETHAL_REPORT_FORM_URL, '_blank', 'noopener,noreferrer');
        copyLethalReport_().then(copied => {
          showLethalCopyStatus_(
            copied ? 'コピーしました' : 'コピーに失敗しました',
            !copied
          );
        }).catch(() => {
          showLethalCopyStatus_('コピーに失敗しました', true);
        });
        return;
      }

      const autoButton = event.target.closest('#lethal-planner-auto');
      if (autoButton) {
        openLethalAutoFilterModal_(autoButton);
        return;
      }

      const autoResultButton = event.target.closest('.lethal-planner__auto-result');
      const autoCardsButton = event.target.closest('.lethal-planner__auto-cards-button');
      const autoToggleButton = event.target.closest('.lethal-planner__auto-toggle');
      if (autoToggleButton) {
        toggleLethalPlannerAutoResults_();
        return;
      }
      if (autoCardsButton) {
        toggleLethalAutoCardsPopup_(autoCardsButton);
        return;
      }

      if (autoResultButton) {
        const plan = lethalPlannerAutoPlans[Number(autoResultButton.dataset.lethalAutoIndex)];
        if (plan) applyLethalPlannerAutoPlan_(plan);
        return;
      }

      const removeButton = event.target.closest('.lethal-planner__term-remove');
      if (removeButton) {
        const selectionIndex = Number(removeButton.dataset.lethalSelectionIndex);
        if (Number.isInteger(selectionIndex) && lethalPlannerSelections[selectionIndex]) {
          lethalPlannerAutoFilterActive = false;
          const [removedSelection] = lethalPlannerSelections.splice(selectionIndex, 1);
          if (removedSelection.sourceKind === 'lethalBuff') {
            unlockLinkedLethalPlannerAttack_(removedSelection.linkedAttackStepId);
          }
          removeOrphanedLethalPlannerBuffs_();
          lethalPlannerCardSelections.clear();
          renderLethalPlanner_();
        }
        return;
      }

      const valueButton = event.target.closest('.lethal-planner__value');
      if (valueButton) {
        lethalPlannerAutoFilterActive = false;
        const candidate = lethalPlannerCandidates.get(valueButton.dataset.lethalKey);
        const source = getAvailableLethalPlannerSource_(candidate);
        if (!candidate || !source) return;
        const selection = {
          stepId: ++lethalPlannerStepId,
          key: valueButton.dataset.lethalKey,
          type: candidate.type,
          value: candidate.value,
          display: source.display || candidate.display || String(candidate.value),
          attackValue: source.attackValue ?? null,
          lethalBurnValue: source.lethalBurnValue ?? null,
          cardId: source.cardId,
          cardName: source.cardName,
          sourceKey: source.sourceKey,
          sourceKind: source.sourceKind,
          isRepeat: source.isRepeat,
        };

        if (source.sourceKind === 'attack') {
          selection.candidateSources = [...candidate.sources.values()]
            .filter(candidateSource => candidateSource.sourceKind === 'attack')
            .map(candidateSource => ({
              cardId: candidateSource.cardId,
              cardName: candidateSource.cardName,
              sourceKey: candidateSource.sourceKey,
              count: candidateSource.count,
              isRepeat: candidateSource.isRepeat,
            }));
          selection.locked = false;
        } else if (source.sourceKind === 'lethalBuff') {
          const attackAssignment = findLethalPlannerAttackAssignment_(source);
          if (!attackAssignment) return;
          attackAssignment.selection.cardId = attackAssignment.candidateSource.cardId;
          attackAssignment.selection.cardName = attackAssignment.candidateSource.cardName;
          attackAssignment.selection.sourceKey = attackAssignment.candidateSource.sourceKey;
          attackAssignment.selection.isRepeat = attackAssignment.candidateSource.isRepeat;
          attackAssignment.selection.locked = true;
          selection.linkedAttackStepId = attackAssignment.selection.stepId;
        }

        lethalPlannerSelections.push(selection);
        lethalPlannerCardSelections.clear();
        renderLethalPlanner_();
      }
    });

    // 分析画面と投稿画面で同じ打点の並べ替え処理を使う。
    [root, document.getElementById('post-lethal-expression')].filter(Boolean).forEach(root => {
      root.addEventListener('dragstart', (event) => {
        const chip = event.target.closest('.lethal-planner__term');
        if (!chip) return;
        lethalPlannerDragIndex = Number(chip.dataset.lethalSelectionIndex);
        chip.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', chip.dataset.lethalSelectionIndex);
      });

      root.addEventListener('dragover', (event) => {
        const chip = event.target.closest('.lethal-planner__term');
        if (!chip || lethalPlannerDragIndex === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        root.querySelectorAll('.lethal-planner__term.is-drag-over')
          .forEach(item => item.classList.remove('is-drag-over'));
        chip.classList.add('is-drag-over');
      });

      root.addEventListener('drop', (event) => {
        const chip = event.target.closest('.lethal-planner__term');
        if (!chip || lethalPlannerDragIndex === null) return;
        event.preventDefault();
        const dropIndex = Number(chip.dataset.lethalSelectionIndex);
        if (Number.isInteger(dropIndex) && dropIndex !== lethalPlannerDragIndex) {
          lethalPlannerAutoFilterActive = false;
          const [movedSelection] = lethalPlannerSelections.splice(lethalPlannerDragIndex, 1);
          lethalPlannerSelections.splice(dropIndex, 0, movedSelection);
          lethalPlannerCardSelections.clear();
        }
        lethalPlannerDragIndex = null;
        renderLethalPlanner_();
      });

      root.addEventListener('dragend', () => {
        lethalPlannerDragIndex = null;
        root.querySelectorAll('.lethal-planner__term.is-dragging, .lethal-planner__term.is-drag-over')
          .forEach(item => item.classList.remove('is-dragging', 'is-drag-over'));
      });
    });
    window.addEventListener('scroll', hideLethalCandidateTooltip_, true);
    window.addEventListener('resize', hideLethalCandidateTooltip_);
    window.addEventListener('scroll', hideLethalAutoCardsPopup_, true);
    window.addEventListener('resize', hideLethalAutoCardsPopup_);
    document.addEventListener('click', event => {
      if (
        lethalAutoCardsPopup?.hidden ||
        event.target.closest('.lethal-auto-cards-popup') ||
        event.target.closest('.lethal-planner__auto-cards-button')
      ) {
        return;
      }
      hideLethalAutoCardsPopup_();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') hideLethalAutoCardsPopup_();
    });
    lethalPlannerEventsBound = true;
  }

  function updateLethalPlanner_() {
    lethalPlannerSelections.length = 0;
    lethalPlannerCardSelections.clear();
    lethalPlannerStepId = 0;
    lethalPlannerAutoPlans = [];
    lethalPlannerAutoSearched = false;
    lethalPlannerAutoExpanded = false;
    allowedAutoLethalOptions = null;
    allowedAutoLethalRepeatCounts = new Map();
    lethalPlannerAutoFilterActive = false;
    lethalPlannerCandidates = buildLethalPlannerCandidates_();
    bindLethalPlannerEvents_();
    renderLethalPlanner_();
  }


  window.getCurrentLethalPlanVariant = getCurrentLethalPlanVariant_;
  window.getLethalPlannerComposerStatus = getLethalPlannerComposerStatus_;
  window.getLethalPlannerPlanCandidates = getLethalPlannerPlanCandidates_;
  window.loadLethalPlannerPlanForEditing = loadLethalPlannerPlanForEditing_;
  window.toggleLethalPlannerAutoResults = toggleLethalPlannerAutoResults_;
  window.toggleLethalAutoCardsPopup = toggleLethalAutoCardsPopup_;
  window.getLethalPlannerCardsForKey = getLethalPlannerCardsForKey_;
  window.resetLethalPlannerComposer = resetLethalPlannerComposer_;
  window.openLethalReport = async function openLethalReport(statusElement = null) {
    window.open(LETHAL_REPORT_FORM_URL, '_blank', 'noopener,noreferrer');
    const copied = await copyLethalReport_();
    showLethalCopyStatus_(copied ? '報告用情報をコピーしました' : '情報をコピーできませんでした', !copied, statusElement);
  };


    return { update: updateLethalPlanner_ };
  };
})();
