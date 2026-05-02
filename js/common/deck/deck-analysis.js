/* =========================
 * js/common/deck/deck-analysis.js
 * - デッキ分析の共通処理
 * - 分布グラフ描画の共通処理
 * ========================= */
(function () {
  'use strict';

  const TYPE_CHARGER = 'チャージャー';
  const TYPE_ATTACKER = 'アタッカー';
  const TYPE_BLOCKER = 'ブロッカー';
  const TYPES = [TYPE_CHARGER, TYPE_ATTACKER, TYPE_BLOCKER];

  const RARITY_LEGEND = 'レジェンド';
  const RARITY_GOLD = 'ゴールド';
  const RARITY_SILVER = 'シルバー';
  const RARITY_BRONZE = 'ブロンズ';

  const LOSSLIS_CATEGORY = 'ロスリス';
  const LOSSLIS_COST = 66;
  const DEFAULT_COST_LABELS = [0, 2, 4, 6, 8, 10, 12];
  const DEFAULT_POWER_LABELS = [4, 5, 6, 7, 8, 10, 14, 16];
  const DEFAULT_MANA_EXCLUDE_CDS = ['30109'];

  const COLORS = {
    [TYPE_CHARGER]: 'rgba(119, 170, 212, 0.7)',
    [TYPE_ATTACKER]: 'rgba(125, 91, 155, 0.7)',
    [TYPE_BLOCKER]: 'rgba(214, 212, 204, 0.7)',
  };

  function normalizeNumber_(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : NaN;
  }

  function isExcludedLosslis66(cardLike) {
    return String(cardLike?.category || '') === LOSSLIS_CATEGORY
      && Number(cardLike?.cost) === LOSSLIS_COST;
  }

  function buildDeckAnalysisCards(deckMap, cardMap, options = {}) {
    const map = deckMap && typeof deckMap === 'object' ? deckMap : {};
    const cards = cardMap && typeof cardMap === 'object' ? cardMap : {};
    const normalizeCd = typeof options.normalizeCd === 'function'
      ? options.normalizeCd
      : (cd) => (typeof window.normCd5 === 'function'
        ? window.normCd5(cd)
        : String(cd ?? '').trim().padStart(5, '0').slice(0, 5));

    const deckCards = [];

    Object.entries(map).forEach(([cdRaw, count]) => {
      const cd = normalizeCd(cdRaw);
      const card = cards[cd] || cards[String(cdRaw)];
      const cnt = Number(count || 0) || 0;
      if (!cnt || !card) return;

      for (let i = 0; i < cnt; i++) {
        deckCards.push({
          cd,
          race: card.race || '',
          type: card.type || '',
          category: card.category || '',
          cost: normalizeNumber_(card.cost),
          power: normalizeNumber_(card.power),
          rarity: card.rarity || '',
        });
      }
    });

    return deckCards;
  }

  function buildDistributionLabels(values, defaults) {
    const base = Array.isArray(defaults) ? defaults : [];
    const extras = Array.isArray(values) ? values : [];
    return [...new Set([...base, ...extras.map(Number)])]
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
  }

  function analyzeDeckCards(deckCards, options = {}) {
    const cards = Array.isArray(deckCards) ? deckCards : [];
    const baseMana = Number.isFinite(Number(options.baseMana)) ? Number(options.baseMana) : 4;
    const manaExcludeCds = new Set(
      Array.isArray(options.manaExcludeCds) ? options.manaExcludeCds : DEFAULT_MANA_EXCLUDE_CDS
    );

    const rarityCounts = {
      [RARITY_LEGEND]: 0,
      [RARITY_GOLD]: 0,
      [RARITY_SILVER]: 0,
      [RARITY_BRONZE]: 0,
    };

    let excludedLosslis66Count = 0;
    const analysisCards = [];
    const costCards = [];
    const costCount = {};
    const powerCount = {};
    let sumCost = 0;
    let sumCostForMana = 0;
    let chargerPower = 0;
    let attackerPower = 0;
    let chargerChargeSum = 0;
    let chargerChargeCnt = 0;

    cards.forEach((card) => {
      if (Object.prototype.hasOwnProperty.call(rarityCounts, card.rarity)) {
        rarityCounts[card.rarity] += 1;
      }

      if (isExcludedLosslis66(card)) {
        excludedLosslis66Count += 1;
        return;
      }

      analysisCards.push(card);
      costCards.push(card);
      if (Number.isFinite(card.cost)) {
        costCount[card.cost] = (costCount[card.cost] || 0) + 1;
        sumCost += card.cost;
        if (!manaExcludeCds.has(String(card.cd))) {
          sumCostForMana += card.cost;
        }
      }

      if (Number.isFinite(card.power)) {
        powerCount[card.power] = (powerCount[card.power] || 0) + 1;
      }

      if (card.type === TYPE_CHARGER) {
        const power = Number.isFinite(card.power) ? card.power : 0;
        const cost = Number.isFinite(card.cost) ? card.cost : 0;
        const charge = power - cost;

        chargerPower += power;
        if (charge > 0) {
          chargerChargeSum += charge;
          chargerChargeCnt += 1;
        }
      }

      if (card.type === TYPE_ATTACKER) {
        attackerPower += Number.isFinite(card.power) ? card.power : 0;
      }
    });

    const manaEfficiency = sumCostForMana > 0 ? ((chargerChargeSum + baseMana) / sumCostForMana) : null;
    const avgCharge = chargerChargeCnt > 0 ? (chargerChargeSum / chargerChargeCnt) : null;
    const costLabels = buildDistributionLabels(Object.keys(costCount).map(Number), DEFAULT_COST_LABELS);
    const powerLabels = buildDistributionLabels(Object.keys(powerCount).map(Number), DEFAULT_POWER_LABELS);

      return {
      deckCards: cards,
      analysisCards,
      costCards,
      excludedLosslis66Count,
      rarityCounts,
      costLabels,
      powerLabels,
      sumCost,
      sumCostForMana,
      chargerPower,
      attackerPower,
      avgCharge,
      manaEfficiency,
      chargerChargeSum,
      chargerChargeCnt,
    };
  }

  function formatManaEfficiencyText(manaEfficiency, options = {}) {
    const emptyText = options.emptyText || '-';
    const highLabel = options.highLabel || 'マナ多め';
    const okLabel = options.okLabel || '適正';
    const lowLabel = options.lowLabel || 'マナ少なめ';

    if (manaEfficiency === null || !Number.isFinite(Number(manaEfficiency))) {
      return {
        text: emptyText,
        className: 'mana-eff',
      };
    }

    const value = Number(manaEfficiency);
    let label = '';
    let stateClass = 'mana-bad';

    if (value > 1.5) {
      label = highLabel;
      stateClass = 'mana-good';
    } else if (value > 1) {
      label = okLabel;
      stateClass = 'mana-ok';
    } else {
      label = lowLabel;
      stateClass = 'mana-bad';
    }

    return {
      text: `${value.toFixed(2)}${label ? `（${label}）` : ''}`,
      className: `mana-eff ${stateClass}`,
    };
  }

  function renderDeckTypePowerSummary(element, analysis) {
    if (!element || !analysis) return;
    element.innerHTML = `
      <span class="type-chip" data-type="${TYPE_CHARGER}">チャージャー ${analysis.chargerPower || 0}</span>
      <span class="type-chip" data-type="${TYPE_ATTACKER}">アタッカー ${analysis.attackerPower || 0}</span>
    `;
  }

  function registerDataLabels_(chartCtor) {
    if (!chartCtor || !window.ChartDataLabels) return;
    try {
      chartCtor.register(window.ChartDataLabels);
    } catch (_) {}
  }

  function buildStackCounts_(cards, key, labels) {
    const table = {};
    TYPES.forEach((type) => {
      table[type] = Object.fromEntries(labels.map((label) => [label, 0]));
    });

    cards.forEach((card) => {
      const value = Number(card?.[key]);
      const type = card?.type;
      if (!Number.isNaN(value) && table[type] && (value in table[type])) {
        table[type][value]++;
      }
    });

    return TYPES.map((type) => ({
      label: type,
      data: labels.map((label) => table[type][label] || 0),
      backgroundColor: COLORS[type],
      borderWidth: 0,
      barPercentage: 0.9,
      categoryPercentage: 0.9,
    }));
  }

  function buildOptions_() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          grid: { display: false, drawBorder: false },
          ticks: { autoSkip: false },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { display: false, drawBorder: false },
          ticks: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'center',
          align: 'center',
          formatter: (value) => (value > 0 ? value : ''),
          font: { weight: 600 },
          clamp: true,
        },
        tooltip: { enabled: true },
      },
    };
  }

  function renderChartNote_(canvas, noteText) {
    if (!canvas) return;
    const parent = canvas.parentElement;
    let noteEl = parent?.querySelector?.('.chart-note');
    if (!noteEl) {
      noteEl = document.createElement('div');
      noteEl.className = 'chart-note';
      parent?.appendChild(noteEl);
    }
    noteEl.textContent = noteText || '';
  }

  function renderDeckDistributionCharts(options = {}) {
    const chartCtor = options.chartCtor || window.Chart;
    if (!chartCtor) return null;

    const costCanvas = options.costCanvas;
    const powerCanvas = options.powerCanvas;
    if (!costCanvas || !powerCanvas) return null;

    registerDataLabels_(chartCtor);
    renderChartNote_(costCanvas, options.noteText);

    const costLabels = options.costLabels || [];
    const powerLabels = options.powerLabels || [];

    const costChart = new chartCtor(costCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: costLabels,
        datasets: buildStackCounts_(options.costCards || [], 'cost', costLabels),
      },
      options: buildOptions_(),
    });

    const powerChart = new chartCtor(powerCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: powerLabels,
        datasets: buildStackCounts_(options.powerCards || [], 'power', powerLabels),
      },
      options: buildOptions_(),
    });

    return { costChart, powerChart };
  }

  window.DECK_TYPE_CHARGER = TYPE_CHARGER;
  window.DECK_TYPE_ATTACKER = TYPE_ATTACKER;
  window.DECK_RARITY_LEGEND = RARITY_LEGEND;
  window.DECK_RARITY_GOLD = RARITY_GOLD;
  window.DECK_RARITY_SILVER = RARITY_SILVER;
  window.DECK_RARITY_BRONZE = RARITY_BRONZE;
  window.DECK_COST_LABELS = DEFAULT_COST_LABELS.slice();
  window.DECK_POWER_LABELS = DEFAULT_POWER_LABELS.slice();
  window.buildDeckAnalysisCards = buildDeckAnalysisCards;
  window.buildDistributionLabels = buildDistributionLabels;
  window.isExcludedLosslis66 = isExcludedLosslis66;
  window.analyzeDeckCards = analyzeDeckCards;
  window.formatManaEfficiencyText = formatManaEfficiencyText;
  window.renderDeckTypePowerSummary = renderDeckTypePowerSummary;
  window.renderDeckDistributionCharts = renderDeckDistributionCharts;
})();
