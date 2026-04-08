/**
 * js/pages/deck-post/deck-post-detail.js
 * - 投稿詳細ペイン描画
 * - デッキリスト描画
 * - カード詳細ドック / ドロワー表示
 * - 簡易統計 / グラフ表示
 */
(function () {
  'use strict';

  // =========================
  // 0) 小物
  // =========================

  /**
   * detail 用エスケープ
   * - 共通があればそれを優先
   */
  function escHtml_(s) {
    const fn = window.escapeHtml_ || window.escapeHtml;
    if (typeof fn === 'function') return fn(s);

    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /**
   * 改行 → <br>
   */
  function nl2br_(s) {
    return String(s || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n/g, '<br>');
  }

  /**
   * 代表カードサムネ
   */
  function cardThumb(src, title) {
    const safe = src ? src : 'img/noimage.webp';
    const alt = title ? escHtml_(title) : '';
    return `
      <div class="thumb-box">
        <img loading="lazy" src="${safe}" alt="${alt}">
      </div>
    `;
  }

  /**
   * 日時表示
   */
  function formatDateTime_(v) {
    if (!v) return '';
    try {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${y}/${m}/${day} ${hh}:${mm}`;
    } catch (_) {
      return String(v || '');
    }
  }

  /**
   * タグチップ（簡易fallback）
   */
  function fallbackTagChips_(s) {
    return String(s || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => `<span class="chip">${escHtml_(x)}</span>`)
      .join('');
  }

  function tagChipsMain_(tagsAuto, tagsPick) {
    if (typeof window.DeckPostFilter?.tagChipsMain === 'function') {
      return window.DeckPostFilter.tagChipsMain(tagsAuto, tagsPick);
    }
    return fallbackTagChips_([tagsAuto, tagsPick].filter(Boolean).join(','));
  }

  function tagChipsUser_(tagsUser) {
    if (typeof window.DeckPostFilter?.tagChipsUser === 'function') {
      return window.DeckPostFilter.tagChipsUser(tagsUser);
    }
    return fallbackTagChips_(tagsUser);
  }

    /**
   * JST前提で日付文字列を安定パース
   */
  function parseJstDate_(s) {
    const str = String(s || '').trim();
    if (!str) return null;

    let d = new Date(str);
    if (isFinite(d)) return d;

    const m = str.match(
      /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
    );
    if (!m) return null;

    const Y  = m[1];
    const Mo = String(m[2]).padStart(2, '0');
    const Da = String(m[3]).padStart(2, '0');
    const H  = String(m[4] ?? '00').padStart(2, '0');
    const Mi = String(m[5] ?? '00').padStart(2, '0');
    const Se = String(m[6] ?? '00').padStart(2, '0');

    d = new Date(`${Y}-${Mo}-${Da}T${H}:${Mi}:${Se}+09:00`);
    return isFinite(d) ? d : null;
  }

  window.parseJstDate_ = window.parseJstDate_ || parseJstDate_;

  // =========================
  // 1) 種族まわり
  // =========================
  const RACE_BG_MAP = {
    'ドラゴン': 'rgba(255, 100, 100, 0.16)',
    'アンドロイド': 'rgba(100, 200, 255, 0.16)',
    'エレメンタル': 'rgba(100, 255, 150, 0.16)',
    'ルミナス': 'rgba(255, 250, 150, 0.16)',
    'シェイド': 'rgba(200, 150, 255, 0.16)',
  };

  /**
   * 種族文字列からメイン種族を取得
   */
  function getMainRace(races) {
    const s = String(races || '');
    if (!s) return '';
    return s.split(/[,+]/)[0].trim();
  }

  /**
   * 種族背景色
   */
  function raceBg(races) {
    const main = getMainRace(races);
    return RACE_BG_MAP[main] || '';
  }

  // =========================
  // 2) デッキ情報の共通ヘルパ
  // =========================
  /**
   * item から { cd: count } の deckMap を取り出す
   */
  function extractDeckMap(item) {
    let deck = null;

    // 1) item.cards（配列）があれば優先
    if (Array.isArray(item?.cards) && item.cards.length) {
      deck = {};
      for (const c of item.cards) {
        const cd = String(c?.cd || '').trim();
        if (!cd) continue;

        const n = Number(c?.count || 0) || 0;
        if (n <= 0) continue;

        deck[cd] = (deck[cd] || 0) + n;
      }
    // 2) cards が「オブジェクト {cd: count}」のケース
    } else if (item?.cards && typeof item.cards === 'object') {
      deck = {};
      for (const [cd, nRaw] of Object.entries(item.cards)) {
        const key = String(cd || '').trim();
        if (!key) continue;

        const n = Number(nRaw || 0) || 0;
        if (n <= 0) continue;

        deck[key] = (deck[key] || 0) + n;
      }
    // 3) なければ cardsJSON（{cd:count} 文字列）を使う
    } else if (item?.cardsJSON) {
      try {
        const obj = JSON.parse(item.cardsJSON);
        if (obj && typeof obj === 'object') {
          deck = {};
          for (const [cd, nRaw] of Object.entries(obj)) {
            const key = String(cd || '').trim();
            if (!key) continue;

            const n = Number(nRaw || 0) || 0;
            if (n <= 0) continue;

            deck[key] = (deck[key] || 0) + n;
          }
        }
      } catch (_) {}
    }

    // ---- cdキーを必ず5桁に正規化（repCd照合ズレ防止）----
    if (deck && typeof deck === 'object') {
      const norm = {};
      for (const [cd, n] of Object.entries(deck)) {
        const cd5 = String(cd || '').trim().padStart(5, '0');
        const cnt = Number(n || 0) || 0;
        if (!cd5 || cnt <= 0) continue;
        norm[cd5] = (norm[cd5] || 0) + cnt;
      }
      deck = norm;
    }

    return deck;
  }

  /**
   * 旧神名を取得
   */
  function getOldGodNameFromItem(item) {
    const deck = extractDeckMap(item);
    if (!deck || !Object.keys(deck).length) return '';

    const cardMap = window.cardMap || {};
    for (const cd of Object.keys(deck)) {
      const cd5 = String(cd).padStart(5, '0');
      if (cd5[0] === '9') {
        const card = cardMap[cd5] || {};
        return card.name || '';
      }
    }

    return '';
  }

  // =========================
  // 3) グラフ描画
  // =========================
  window.__postDistCharts = window.__postDistCharts || {};

  /**
   * 投稿詳細のコスト / パワー分布グラフ
   */
  function renderPostDistCharts_(item, paneUid) {
    // Chart.js が無いなら何もしない
    if (!window.Chart) return false;

    // plugin（無ければ握りつぶし）
    try { Chart.register(window.ChartDataLabels); } catch (_) {}

    const deck = extractDeckMap(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length) return false;

    // deckCards（最大40枚なので展開でOK）
    const deckCards = [];

    // ロスリスcost66アタッカーは「支払わない想定」でコスト計算から除外
    const isCostFreeLosslis66 = (cardLike) => {
      return cardLike?.type === 'アタッカー'
        && String(cardLike?.category || '') === 'ロスリス'
        && Number(cardLike?.cost) === 66;
    };

    let excludedLosslis66Atk = 0;

    for (const [cd, n] of Object.entries(deck)) {
      const cd5 = String(cd).padStart(5, '0');
      const c = cardMap[cd5] || {};

      const type = String(c.type || '');
      const category = String(c.category || '');
      const rawCost = Number(c.cost);
      const power = Number(c.power);
      const cnt = Number(n || 0) || 0;

      const costFree = isCostFreeLosslis66({ type, category, cost: rawCost });
      if (costFree) excludedLosslis66Atk += cnt;

      // costFree のとき cost を NaN にして「総コスト/コスト分布/マナ効率分母」から自然に除外
      const effCost = costFree ? NaN : (Number.isFinite(rawCost) ? rawCost : NaN);

      for (let i = 0; i < cnt; i++) {
        deckCards.push({
          cd: cd5,
          type,
          category,
          cost: effCost,
          power: Number.isFinite(power) ? power : NaN,
        });
      }
    }

    // 目盛り（固定表示）
    const alwaysShowCosts = [0, 2, 4, 6, 8, 10, 12];
    const alwaysShowPowers = [4, 5, 6, 7, 8, 10, 14, 16];

    const costCount = {};
    const powerCount = {};

    deckCards.forEach((c) => {
      if (!Number.isNaN(c.cost)) costCount[c.cost] = (costCount[c.cost] || 0) + 1;
      if (!Number.isNaN(c.power)) powerCount[c.power] = (powerCount[c.power] || 0) + 1;
    });

    const costLabels = [...new Set([...alwaysShowCosts, ...Object.keys(costCount).map(Number)])].sort((a, b) => a - b);
    const powerLabels = [...new Set([...alwaysShowPowers, ...Object.keys(powerCount).map(Number)])].sort((a, b) => a - b);

    const sumCost = deckCards.reduce((s, c) => s + (Number.isFinite(c.cost) ? c.cost : 0), 0);
    const costSumEl = document.getElementById(`cost-summary-${paneUid}`);
    if (costSumEl) {
      costSumEl.innerHTML = `<span class="stat-chip">総コスト ${sumCost}</span>`;
    }

    // マナ効率（分母）から除外したいカード（cd5で入ってる想定）
    const EXCLUDE_MANA_COST_CDS = new Set(['30109']);
    const sumCostForMana = deckCards.reduce((s, c) => {
      if (!Number.isFinite(c.cost)) return s;
      if (EXCLUDE_MANA_COST_CDS.has(String(c.cd))) return s;
      return s + c.cost;
    }, 0);

    let chargerChargeSum = 0;
    let chargerChargeCnt = 0;

    deckCards.forEach((c) => {
      if (c.type !== 'チャージャー') return;

      const p = Number.isFinite(c.power) ? c.power : 0;
      const k = Number.isFinite(c.cost) ? c.cost : 0;
      const charge = p - k;

      if (charge > 0) {
        chargerChargeSum += charge;
        chargerChargeCnt += 1;
      }
    });

    const avgChargeEl = document.getElementById(`avg-charge-${paneUid}`);
    if (avgChargeEl) {
      const avg = chargerChargeCnt > 0 ? (chargerChargeSum / chargerChargeCnt) : null;
      avgChargeEl.textContent = (avg !== null) ? avg.toFixed(2) : '-';
    }

    const manaEffEl = document.getElementById(`mana-efficiency-${paneUid}`);
    if (manaEffEl) {
      const BASE_MANA = 4;
      const totalMana = chargerChargeSum + BASE_MANA;
      const supply = (sumCostForMana > 0) ? (totalMana / sumCostForMana) : null;

      let label = '';
      if (supply === null) label = '';
      else if (supply > 1.5) label = 'マナ多め';
      else if (supply > 1) label = '適正';
      else label = 'マナ少なめ';

      manaEffEl.textContent = (supply !== null)
        ? `${supply.toFixed(2)}${label ? `（${label}）` : ''}`
        : '-';

      manaEffEl.className = 'mana-eff';
      if (supply !== null) {
        if (supply > 1.11) manaEffEl.classList.add('mana-good');
        else if (supply > 0.91) manaEffEl.classList.add('mana-ok');
        else manaEffEl.classList.add('mana-bad');
      }
    }

    const powerSums = { 'チャージャー': 0, 'アタッカー': 0 };
    deckCards.forEach((c) => {
      const p = Number.isFinite(c.power) ? c.power : 0;
      if (c.type in powerSums) powerSums[c.type] += p;
    });

    const powerSumEl = document.getElementById(`power-summary-${paneUid}`);
    if (powerSumEl) {
      powerSumEl.innerHTML = `
        <span class="type-chip" data-type="チャージャー">チャージャー ${powerSums['チャージャー']}</span>
        <span class="type-chip" data-type="アタッカー">アタッカー ${powerSums['アタッカー']}</span>
      `;
    }

    const TYPES = ['チャージャー', 'アタッカー', 'ブロッカー'];
    const COLORS = {
      'チャージャー': 'rgba(119, 170, 212, 0.7)',
      'アタッカー': 'rgba(125, 91, 155, 0.7)',
      'ブロッカー': 'rgba(214, 212, 204, 0.7)',
    };

    function buildStackCounts(cards, key, labels) {
      const table = {};
      TYPES.forEach((t) => {
        table[t] = Object.fromEntries(labels.map((l) => [l, 0]));
      });

      cards.forEach((c) => {
        const v = Number(c[key]);
        const t = c.type;
        if (!Number.isNaN(v) && table[t] && (v in table[t])) {
          table[t][v]++;
        }
      });

      return TYPES.map((t) => ({
        label: t,
        data: labels.map((l) => table[t][l] || 0),
        backgroundColor: COLORS[t],
        borderWidth: 0,
        barPercentage: 0.9,
        categoryPercentage: 0.9,
      }));
    }

    const costDatasets = buildStackCounts(deckCards, 'cost', costLabels);
    const powerDatasets = buildStackCounts(deckCards, 'power', powerLabels);

    const commonOptions = {
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
          formatter: (v) => (v > 0 ? v : ''),
          font: { weight: 600 },
          clamp: true,
        },
        tooltip: { enabled: true },
      },
    };

    const prev = window.__postDistCharts[paneUid];
    if (prev) {
      try { prev.cost?.destroy(); } catch (_) {}
      try { prev.power?.destroy(); } catch (_) {}
      delete window.__postDistCharts[paneUid];
    }

    const costCanvas = document.getElementById(`costChart-${paneUid}`);
    const powerCanvas = document.getElementById(`powerChart-${paneUid}`);
    if (!costCanvas || !powerCanvas) return false;

    const parent = costCanvas.parentElement;
    let noteEl = parent?.querySelector?.('.chart-note');
    if (!noteEl) {
      noteEl = document.createElement('div');
      noteEl.className = 'chart-note';
      parent?.appendChild(noteEl);
    }
    noteEl.textContent = excludedLosslis66Atk > 0
      ? `※66ロスリスアタッカー（${excludedLosslis66Atk}枚）は除く`
      : '';

    const costChart = new Chart(costCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels: costLabels, datasets: costDatasets },
      options: commonOptions,
    });

    const powerChart = new Chart(powerCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels: powerLabels, datasets: powerDatasets },
      options: commonOptions,
    });

    window.__postDistCharts[paneUid] = { cost: costChart, power: powerChart };
    return true;
  }

  // =========================
  // 4) デッキリスト
  // =========================
  function packNameEn_(packName) {
    if (typeof window.getPackEnName === 'function') {
      return window.getPackEnName(packName, '');
    }

    const s = String(packName || '').trim();
    if (!s) return '';

    const idx = s.indexOf('「');
    if (idx > 0) return s.slice(0, idx).trim();

    const slash = s.indexOf('／');
    if (slash > 0) return s.slice(0, slash).trim();

    return s;
  }

  function packAbbr_(enName) {
    const s = String(enName || '').trim();
    const low = s.toLowerCase();

    if (low.includes('awakening the oracle') || low.includes('awaking the oracle')) return 'Aパック';
    if (low.includes('beyond the sanctuary')) return 'Bパック';
    if (low.includes('creeping souls')) return 'Cパック';
    if (low.includes('drawn sword')) return 'Dパック';
    if (low.includes('ensemble of silence') || low.includes('ensemble of slience')) return 'Eパック';
    if (low.includes('fallen fate')) return 'Fパック';
    if (low.includes('glory of the gods')) return 'Gパック';

    if (s.includes('コラボ') || low.includes('collab')) return 'コラボ';
    if (s.includes('その他特殊') || low.includes('special')) return '特殊';
    if (s.includes('その他')) return 'その他';

    return s;
  }

  function packKeyFromAbbr_(abbr) {
    if (typeof window.packKeyFromAbbr === 'function') {
      return window.packKeyFromAbbr(abbr);
    }

    const s = String(abbr || '');
    if (/^([A-Z])パック/.test(s)) return s[0];
    if (s.includes('特殊')) return 'SPECIAL';
    if (s.includes('コラボ')) return 'COLLAB';
    return '';
  }

  function getPackOrder_() {
    const p = window.packsData || window.packs || window.__PackCatalog || null;
    const order = p && Array.isArray(p.order) ? p.order : [];
    return order.map((x) => String(x || '').trim()).filter(Boolean);
  }

  /**
   * デッキ一覧タイルHTML
   */
  function buildDeckListHtml(item) {
    const deck = extractDeckMap(item);

    if (!deck || !Object.keys(deck).length) {
      return `<div class="post-decklist post-decklist-empty">デッキリスト未登録</div>`;
    }

    const entries = Object.entries(deck);
    const cardMap = window.cardMap || {};
    const TYPE_ORDER = { 'チャージャー': 0, 'アタッカー': 1, 'ブロッカー': 2 };

    entries.sort((a, b) => {
      const A = cardMap[a[0]] || {};
      const B = cardMap[b[0]] || {};

      const tA = TYPE_ORDER[A.type] ?? 99;
      const tB = TYPE_ORDER[B.type] ?? 99;
      if (tA !== tB) return tA - tB;

      const cA = parseInt(A.cost, 10) || 0;
      const cB = parseInt(B.cost, 10) || 0;
      if (cA !== cB) return cA - cB;

      const pA = parseInt(A.power, 10) || 0;
      const pB = parseInt(B.power, 10) || 0;
      if (pA !== pB) return pA - pB;

      return String(a[0]).localeCompare(String(b[0]));
    });

    const tiles = entries.map(([cd, n]) => {
      const cd5 = String(cd).padStart(5, '0');
      const card = cardMap[cd5] || {};
      const name = card.name || cd5;
      const src = `img/${cd5}.webp`;

      const packName = card.pack_name || card.packName || '';
      const en = packNameEn_(packName);
      const abbr = packAbbr_(en);
      const packKey = packKeyFromAbbr_(abbr);
      const packAttr = packKey ? ` data-pack="${packKey}"` : '';

      return `
        <div class="deck-entry" data-cd="${cd5}"${packAttr} role="button" tabindex="0">
          <img src="${src}" alt="${escHtml_(name)}" loading="lazy">
          <div class="count-badge">x${n}</div>
        </div>
      `;
    }).join('');

    return `<div class="post-decklist">${tiles}</div>`;
  }

  // =========================
  // 5) レアリティ / 投稿別カード参照ヘルパ
  // =========================
  /**
   * レアリティキー正規化
   */
  function rarityKeyForPage4_(rarity) {
    const r = String(rarity || '').trim();
    if (!r) return '';

    if (r.includes('レジェンド')) return 'legend';
    if (r.includes('ゴールド')) return 'gold';
    if (r.includes('シルバー')) return 'silver';
    if (r.includes('ブロンズ')) return 'bronze';

    const low = r.toLowerCase();
    if (low.includes('legend')) return 'legend';
    if (low.includes('gold')) return 'gold';
    if (low.includes('silver')) return 'silver';
    if (low.includes('bronze')) return 'bronze';

    return '';
  }

  /**
   * pill用クラス
   */
  function rarityPillClassForPage4_(rarity) {
    const k = rarityKeyForPage4_(rarity);
    return k ? `carddetail-rarity--${k}` : '';
  }

  /**
   * レアリティ表示ラベル
   */
  function rarityLabelForPage4_(rarity) {
    const r = String(rarity || '').trim();
    if (!r) return '';
    return r;
  }

  /**
   * postId から item を探す
   */
  function findItemById_(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return null;

    const state = window.DeckPostState.getState();
    const pools = [
      state?.mine?.items,
      state?.list?.items,
      state?.list?.allItems,
      state?.list?.filteredItems,
    ].filter(Array.isArray);

    for (const arr of pools) {
      const hit = arr.find((it) => String(it?.postId || '').trim() === pid);
      if (hit) return hit;
    }

    return null;
  }

  window.__cardMapCache = window.__cardMapCache || new Map();
  window.__cardVersionsIndex = window.__cardVersionsIndex || null;

  /**
   * JSON取得
   */
  async function fetchJson_(url, opt = {}) {
    const res = await fetch(url, { cache: opt.cache || 'force-cache' });
    if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
    return await res.json();
  }

  /**
   * カードJSONのベースパス
   */
  function cardDataBase_() {
    const b = String(window.CARD_DATA_BASE || 'public/').trim();
    return b.endsWith('/') ? b : (b + '/');
  }

  /**
   * カードJSONのURL化
   */
  function cardDataUrl_(name) {
    return cardDataBase_() + String(name || '').replace(/^\/+/, '');
  }

  /**
   * cards_xxx.json を cardMap 化
   */
  async function loadCardMapFile_(fileName) {
    const cache = window.__cardMapCache;
    if (cache.has(fileName)) return cache.get(fileName);

    const raw = await fetchJson_(cardDataUrl_(fileName));
    const map = {};

    if (Array.isArray(raw)) {
      for (const c of raw) {
        const cd5 = String(c.cd || '').padStart(5, '0');
        if (cd5) map[cd5] = c;
      }
    } else if (raw && typeof raw === 'object') {
      for (const [cd, c] of Object.entries(raw)) {
        const cd5 = String(cd).padStart(5, '0');
        map[cd5] = c;
      }
    }

    cache.set(fileName, map);
    return map;
  }

  /**
   * cards_versions.json を読む
   */
  async function loadCardVersionsIndex_() {
    const cur = window.__cardVersionsIndex;
    if (cur && Array.isArray(cur.versions) && cur.versions.length) return cur;

    const idx = await fetchJson_(cardDataUrl_('cards_versions.json'), { cache: 'no-store' });

    if (!idx || !Array.isArray(idx.versions)) {
      console.warn('[cardMap] cards_versions.json invalid:', idx);
      window.__cardVersionsIndex = null;
      return { versions: [] };
    }

    window.__cardVersionsIndex = idx;
    return idx;
  }

  /**
   * 投稿日に合うカードスナップショットを選ぶ
   */
  function pickSnapshotFileForPostDate_(versions, postDateLike) {
    const parse = window.parseJstDate_;
    const post = (postDateLike instanceof Date)
      ? postDateLike
      : (typeof parse === 'function' ? parse(postDateLike) : new Date(postDateLike));

    if (!post || Number.isNaN(post.getTime())) return null;

    const list = (versions || [])
      .map((v) => {
        const d = typeof parse === 'function' ? parse(v.version) : new Date(v.version);
        const file = v.file || v.after || v.before || null;
        return { ...v, _d: d, _file: file };
      })
      .filter((v) => v._d && !Number.isNaN(v._d.getTime()) && v._file)
      .sort((a, b) => a._d - b._d);

    if (!list.length) return null;

    const newest = list[list.length - 1];
    if (post > newest._d) return null;
    if (post < list[0]._d) return list[0]._file;

    let last = null;
    for (const v of list) {
      if (v._d <= post) last = v;
    }
    return last ? last._file : null;
  }

  /**
   * 投稿日時点の cardMap を一時適用して fn 実行
   */
  async function withCardMapForPostDate_(item, fn) {
    try {
      const parse = window.parseJstDate_;
      const c = typeof parse === 'function' ? parse(item?.createdAt) : new Date(item?.createdAt);
      const u = typeof parse === 'function' ? parse(item?.updatedAt) : new Date(item?.updatedAt);

      const cOk = c && !Number.isNaN(c.getTime());
      const uOk = u && !Number.isNaN(u.getTime());

      const base = (uOk && (!cOk || u > c)) ? u : (cOk ? c : null);
      if (!base) return fn();

      const idx = await loadCardVersionsIndex_();
      const file = pickSnapshotFileForPostDate_(idx?.versions, base);
      if (!file) return fn();

      const map = await loadCardMapFile_(file);

      const prev = window.cardMap;
      window.cardMap = map;
      try {
        return await fn();
      } finally {
        window.cardMap = prev;
      }
    } catch (e) {
      console.warn('withCardMapForPostDate_ failed:', e);
      return fn();
    }
  }

  // =========================
  // 6) カード詳細ドック / ドロワー
  // =========================
  /**
   * カード詳細HTML
   */
  function buildCardDetailHtml_(cd5) {
    const cardMap = window.cardMap || {};
    const c = cardMap[String(cd5 || '').padStart(5, '0')] || {};
    const mainRace = getMainRace(c.races ?? (c.race ? [c.race] : []));

    const name = c.name || cd5;

    const packRaw = c.pack_name || c.packName || '';
    const pack = packRaw
      ? (window.splitPackName
          ? window.splitPackName(packRaw)
          : { en: String(packRaw), jp: '' })
      : null;

    let packKey = '';
    if (packRaw) {
      const enName = (typeof packNameEn_ === 'function') ? packNameEn_(packRaw) : String(packRaw);
      const abbr = (typeof packAbbr_ === 'function') ? packAbbr_(enName) : '';
      packKey = (typeof packKeyFromAbbr_ === 'function') ? packKeyFromAbbr_(abbr) : '';
    }

    const cat = c.category || '';
    const img = `img/${String(cd5).padStart(5, '0')}.webp`;

    const rarityLabel = rarityLabelForPage4_(c.rarity);
    const rarityCls = rarityPillClassForPage4_(c.rarity);

    const e1n = c.effect_name1 || '';
    const e1t = c.effect_text1 || '';
    const e2n = c.effect_name2 || '';
    const e2t = c.effect_text2 || '';

    const effectBlocks = `
      ${e1n || e1t ? `
        <div class="carddetail-effect">
          ${e1n ? `<div class="carddetail-effect-name">${escHtml_(e1n)}</div>` : ''}
          ${e1t ? `<div class="carddetail-effect-text">${nl2br_(escHtml_(e1t))}</div>` : ''}
        </div>
      ` : ''}
      ${e2n || e2t ? `
        <div class="carddetail-effect">
          ${e2n ? `<div class="carddetail-effect-name">${escHtml_(e2n)}</div>` : ''}
          ${e2t ? `<div class="carddetail-effect-text">${nl2br_(escHtml_(e2t))}</div>` : ''}
        </div>
      ` : ''}
      ${(!e1n && !e1t && !e2n && !e2t) ? `
        <div class="carddetail-empty">カードテキストが未登録です。</div>
      ` : ''}
    `;

    return `
      <div class="carddetail-head">
        <div class="carddetail-thumb">
          <img src="${img}" alt="${escHtml_(name)}" loading="lazy"
               onerror="this.onerror=null;this.src='img/00000.webp';">
        </div>

        <div class="carddetail-meta">
          <div class="carddetail-name">${escHtml_(name)}</div>

          <div class="carddetail-sub">
            ${pack ? `
              <div class="carddetail-pack"${packKey ? ` data-pack="${packKey}"` : ''}>
                ${pack.en ? `<div class="carddetail-pack-en">${escHtml_(pack.en)}</div>` : ''}
                ${pack.jp ? `<div class="carddetail-pack-jp">${escHtml_(pack.jp)}</div>` : ''}
              </div>
            ` : ''}

            <div class="carddetail-cat-rarity">
              ${cat ? `<span class="carddetail-cat cat-${escHtml_(mainRace)}">${escHtml_(cat)}</span>` : ''}
              ${rarityLabel ? `
                <span class="stat-chip carddetail-rarity ${rarityCls}">
                  ${escHtml_(rarityLabel)}
                </span>
              ` : ''}
            </div>
          </div>
        </div>

        <button type="button" class="carddetail-close" aria-label="閉じる">×</button>
      </div>

      <div class="carddetail-body">
        ${effectBlocks}
      </div>
    `;
  }

  /**
   * カード詳細を閉じる
   */
  function closeCardDetail_() {
    const drawer = document.getElementById('cardDetailDrawer');
    if (drawer) drawer.style.display = 'none';

    document
      .querySelectorAll('.post-detail-inner .carddetail-dock .carddetail-inner')
      .forEach((inner) => {
        if (!inner) return;
        inner.innerHTML = `<div class="carddetail-empty">ここにカードの詳細が表示されます</div>`;
      });
  }

  /**
   * PC用カード詳細ドックを確保
   */
  function ensureCardDetailDockPc_(root) {
    if (!root) return null;

    let dock = root.querySelector('.carddetail-dock');
    if (dock) return dock;

    const deckcol = root.querySelector('.post-detail-deckcol');
    if (!deckcol) return null;

    const sec = document.createElement('div');
    sec.className = 'post-detail-section carddetail-dock';
    sec.innerHTML = `
      <div class="post-detail-heading">カード詳細</div>
      <div class="carddetail-inner">
        <div class="carddetail-empty">ここにカードの詳細が表示されます</div>
      </div>
    `;

    const codeBody = deckcol.querySelector('.post-detail-code-body');
    if (codeBody) {
      codeBody.insertAdjacentElement('afterend', sec);
      return sec;
    }

    const decklistEl = deckcol.querySelector('.post-decklist');
    const decklistSec = decklistEl?.closest('.post-detail-section');
    if (decklistSec) {
      decklistSec.insertAdjacentElement('afterend', sec);
      return sec;
    }

    deckcol.appendChild(sec);
    return sec;
  }

  /**
   * SP用カード詳細ドロワーを確保
   */
  function ensureCardDetailDrawerSp_() {
    let drawer = document.getElementById('cardDetailDrawer');
    if (drawer) return drawer;

    drawer = document.createElement('div');
    drawer.id = 'cardDetailDrawer';
    drawer.style.display = 'none';
    drawer.innerHTML = `
      <div class="carddetail-drawer-inner">
        <div class="carddetail-inner"></div>
      </div>
    `;
    document.body.appendChild(drawer);

    drawer.addEventListener('click', (e) => {
      if (e.target === drawer) {
        drawer.style.display = 'none';
      }
    });

    return drawer;
  }

  /**
   * デッキ内カードクリック時に詳細を開く
   */
  async function openCardDetailFromDeck_(cd5, clickedEl) {
    const cd = String(cd5 || '').padStart(5, '0');
    if (!cd) return;

    const root = clickedEl?.closest?.('.post-detail-inner')
      || document.querySelector('.post-detail-inner');

    const postId = String(root?.dataset?.postid || '').trim();
    const item = postId ? findItemById_(postId) : null;

    const html = item
      ? await withCardMapForPostDate_(item, () => buildCardDetailHtml_(cd))
      : buildCardDetailHtml_(cd);

    const isPcWide = window.matchMedia('(min-width: 1024px)').matches;

    if (isPcWide) {
      const dock = ensureCardDetailDockPc_(root);
      const inner = dock?.querySelector('.carddetail-inner');
      if (inner) inner.innerHTML = html;
      return;
    }

    const drawer = ensureCardDetailDrawerSp_();
    const inner = drawer.querySelector('.carddetail-inner');
    if (inner) inner.innerHTML = html;
    drawer.style.display = 'block';
  }

  // =========================
  // 7) 簡易統計
  // =========================
  function buildSimpleDeckStats(item) {
    const raw = item.typeMixJSON || item.typeMixJson || '';

    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length >= 3) {
          const chg = Number(arr[0] || 0);
          const atk = Number(arr[1] || 0);
          const blk = Number(arr[2] || 0);
          const totalType = chg + atk + blk;
          if (totalType > 0) {
            const typeText = `チャージャー ${chg}枚 / アタッカー ${atk}枚 / ブロッカー ${blk}枚`;
            return { typeText, chg, atk, blk, totalType };
          }
        }
      } catch (_) {}
    }

    const deck = extractDeckMap(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length || !cardMap) return null;

    let chg = 0, atk = 0, blk = 0;

    for (const [cd, nRaw] of Object.entries(deck)) {
      const n = Number(nRaw || 0) || 0;
      if (!n) continue;

      const cd5 = String(cd).padStart(5, '0');
      const t = (cardMap[cd5] || {}).type;
      if (t === 'チャージャー') chg += n;
      else if (t === 'アタッカー') atk += n;
      else if (t === 'ブロッカー') blk += n;
    }

    const totalType = chg + atk + blk;
    if (!totalType) return null;

    const typeText = `チャージャー ${chg}枚 / アタッカー ${atk}枚 / ブロッカー ${blk}枚`;
    return { typeText, chg, atk, blk, totalType };
  }

  // タイプチップHTML
  function buildTypeChipsHtml_(simpleStats) {
    if (!simpleStats) return '';
    const rows = [
      ['チャージャー', simpleStats.chg],
      ['アタッカー', simpleStats.atk],
      ['ブロッカー', simpleStats.blk],
    ].filter(([, n]) => (Number(n || 0) || 0) > 0);

    if (!rows.length) return '';
    return rows.map(([t, n]) =>
      `<span class="type-chip" data-type="${escHtml_(t)}">${escHtml_(t)} ${Number(n)}枚</span>`
    ).join('');
  }

  // レアリティミックステキスト
  function buildRarityMixText_(item) {
    const deck = extractDeckMap(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length || !cardMap) return '';

    let legend = 0, gold = 0, silver = 0, bronze = 0, unknown = 0;

    for (const [cd, nRaw] of Object.entries(deck)) {
      const n = Number(nRaw || 0) || 0;
      if (!n) continue;

      const cd5 = String(cd).padStart(5, '0');
      const r = String((cardMap[cd5] || {}).rarity || '').trim();

      if (r === 'レジェンド') legend += n;
      else if (r === 'ゴールド') gold += n;
      else if (r === 'シルバー') silver += n;
      else if (r === 'ブロンズ') bronze += n;
      else unknown += n;
    }

    const total = legend + gold + silver + bronze + unknown;
    if (!total) return '';

    const parts = [
      `レジェンド ${legend}枚`,
      `ゴールド ${gold}枚`,
      `シルバー ${silver}枚`,
      `ブロンズ ${bronze}枚`,
    ];
    if (unknown) parts.push(`不明 ${unknown}枚`);

    return parts.join(' / ');
  }

  function buildRarityMixCounts_(item) {
    const deck = extractDeckMap(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length || !cardMap) return null;

    let legend = 0, gold = 0, silver = 0, bronze = 0, unknown = 0;

    for (const [cd, nRaw] of Object.entries(deck)) {
      const n = Number(nRaw || 0) || 0;
      if (!n) continue;

      const cd5 = String(cd).padStart(5, '0');
      const r = String((cardMap[cd5] || {}).rarity || '').trim();

      if (r === 'レジェンド') legend += n;
      else if (r === 'ゴールド') gold += n;
      else if (r === 'シルバー') silver += n;
      else if (r === 'ブロンズ') bronze += n;
      else unknown += n;
    }

    const total = legend + gold + silver + bronze + unknown;
    if (!total) return null;
    return { legend, gold, silver, bronze, unknown, total };
  }

  // レアリティチップHTML
  function buildRarityChipsHtml_(item) {
    const c = buildRarityMixCounts_(item);
    if (!c) return '';

    const out = [];
    if (c.legend) out.push(`<span class="stat-chip carddetail-rarity carddetail-rarity--legend">レジェンド ${c.legend}枚</span>`);
    if (c.gold) out.push(`<span class="stat-chip carddetail-rarity carddetail-rarity--gold">ゴールド ${c.gold}枚</span>`);
    if (c.silver) out.push(`<span class="stat-chip carddetail-rarity carddetail-rarity--silver">シルバー ${c.silver}枚</span>`);
    if (c.bronze) out.push(`<span class="stat-chip carddetail-rarity carddetail-rarity--bronze">ブロンズ ${c.bronze}枚</span>`);
    if (c.unknown) out.push(`<span class="stat-chip">不明 ${c.unknown}枚</span>`);

    return out.join('');
  }

  function buildPackMixCounts_(item) {
    const deck = extractDeckMap(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length || !cardMap) return null;

    const counts = Object.create(null);
    let unknown = 0;

    for (const [cd, nRaw] of Object.entries(deck)) {
      const n = Number(nRaw || 0) || 0;
      if (!n) continue;

      const cd5 = String(cd).padStart(5, '0');
      const packName = (cardMap[cd5] || {}).pack_name || (cardMap[cd5] || {}).packName || '';
      const en = packNameEn_(packName);

      if (en) counts[en] = (counts[en] || 0) + n;
      else unknown += n;
    }

    const keys = Object.keys(counts);
    if (!keys.length && !unknown) return null;

    const order = getPackOrder_();
    keys.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) {
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      }
      return a.localeCompare(b);
    });

    return { keys, counts, unknown };
  }

  // パック構成チップHTML
  function buildPackChipsHtml_(item) {
    const d = buildPackMixCounts_(item);
    if (!d) return '';

    const out = [];
    for (const k of d.keys) {
      const n = Number(d.counts[k] || 0) || 0;
      if (!n) continue;

      const abbr = packAbbr_(k);
      const packKey = packKeyFromAbbr_(abbr);
      const attr = packKey ? ` data-pack="${packKey}"` : '';

      out.push(
        `<span class="stat-chip pack-chip"${attr}>
          ${escHtml_(abbr)} ${n}枚 <span class="pack-icon">🔍</span>
        </span>`
      );
    }

    if (d.unknown) {
      out.push(
        `<span class="stat-chip pack-chip">
          不明 ${Number(d.unknown)}枚 <span class="pack-icon">🔍</span>
        </span>`
      );
    }

    return out.join('');
  }

  // =========================
  // 8) 詳細本文HTML
  // =========================
  function buildDeckNoteHtml(deckNote) {
    const text = String(deckNote || '').trim();
    if (!text) {
      return `<div class="post-decknote-empty">投稿者によるデッキ解説はまだ登録されていません。</div>`;
    }

    const blocks = text
      .split(/\n(?=【[^】]+】)/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((block) => {
        const m = block.match(/^【([^】]+)】\s*\n?([\s\S]*)$/);
        if (m) {
          const title = m[1];
          const body = m[2] || '';
          return `
            <section class="decknote-block">
              <div class="decknote-heading">${escHtml_(title)}</div>
              <div class="decknote-body">${nl2br_(escHtml_(body))}</div>
            </section>
          `;
        }

        return `
          <section class="decknote-block">
            <div class="decknote-body">${nl2br_(escHtml_(block))}</div>
          </section>
        `;
      })
      .join('');

    return `<div class="post-decknote">${blocks}</div>`;
  }

  // カード解説HTML
  function buildCardNotesHtml(item) {
    const srcList = Array.isArray(item?.cardNotes) ? item.cardNotes : [];
    const list = srcList
      .map((r) => ({ cd: String(r?.cd || ''), text: String(r?.text || '') }))
      .filter((r) => r.cd || r.text);

    if (!list.length) {
      return `<div class="post-cardnotes-empty">投稿者によるカード解説はまだ登録されていません。</div>`;
    }

    const cardMap = window.cardMap || {};

    const rows = list.map((r) => {
      const cdRaw = String(r.cd || '').trim();
      const cd5 = cdRaw.padStart(5, '0');
      const card = cardMap[cd5] || {};
      const name = card.name || 'カード名未登録';
      const img = `img/${cd5}.webp`;
      const textHtml = escHtml_(r.text || '').replace(/\n/g, '<br>');

      return `
        <div class="post-cardnote">
          <div class="post-cardnote-thumb">
            <img src="${img}"
                 alt="${escHtml_(name)}"
                 loading="lazy"
                 onerror="this.onerror=null;this.src='img/00000.webp';">
          </div>
          <div class="post-cardnote-body">
            <div class="post-cardnote-title">${escHtml_(name)}</div>
            <div class="post-cardnote-text">${textHtml}</div>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="post-cardnotes">${rows}</div>`;
  }

  function buildDeckCodeBoxFallback_(postId, code) {
    const codeNorm = String(code || '').trim();
    if (!codeNorm) return '';

    return `
      <div class="post-manage-box" data-postid="${escHtml_(postId)}">
        <div class="post-manage-head">
          <div class="deckcode-status">
            <div class="deckcode-title">デッキコード</div>
          </div>
        </div>
        <div class="post-manage-actions">
          <button type="button" class="modal-buttun btn-deckcode-copy" data-code="${escHtml_(codeNorm)}">コピー</button>
        </div>
      </div>
    `;
  }

  // =========================
  // 9) 詳細ペイン描画
  // =========================
function renderDetailPaneForItem(item, basePaneId) {
  const pane = document.getElementById(basePaneId || 'postDetailPane');
  if (!pane || !item) return;

  const paneUid = `${basePaneId}-${String(item.postId || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const isMinePane = (basePaneId === 'postDetailPaneMine');

  const mainRace = getMainRace(item.races);
  const oldGod = getOldGodNameFromItem(item) || 'なし';
  const codeNorm = String(item.shareCode || '').trim();
  const repImg = item.repImg || '';
  const deckNote = item.deckNote || item.comment || '';
  const bg = raceBg(item.races);

  const postId = String(item?.postId || '').trim();

  // ✅ deck-post-detail.js 側の安全版
  const manageBoxHtml = isMinePane
    ? (typeof window.DeckPostEditor?.buildDeckCodeBoxHtml_ === 'function'
        ? window.DeckPostEditor.buildDeckCodeBoxHtml_(postId, codeNorm)
        : buildDeckCodeBoxFallback_(postId, codeNorm))
    : '';

  // ✅ deck-post-detail.js 側の fallback 付き関数を使う
  const tagsMain = tagChipsMain_(item.tagsAuto, item.tagsPick);
  const tagsUser = tagChipsUser_(item.tagsUser);

  const posterXRaw = String(item.posterX || '').trim();
  const posterXUser = posterXRaw.startsWith('@') ? posterXRaw.slice(1) : posterXRaw;
  const posterXHtml = posterXUser ? `
    <a class="meta-x"
      href="https://x.com/${encodeURIComponent(posterXUser)}"
      target="_blank"
      rel="noopener noreferrer">
      ${escHtml_(posterXRaw)}
    </a>
  ` : '';

  const deckListHtml = buildDeckListHtml(item);
  const deckNoteHtml = buildDeckNoteHtml(deckNote);
  const cardNotesHtml = buildCardNotesHtml(item);

  const simpleStats = buildSimpleDeckStats(item);
  const typeChipsPane = buildTypeChipsHtml_(simpleStats);
  const rarityChipsPane = buildRarityChipsHtml_(item);
  const packChipsPane = buildPackChipsHtml_(item);

  const codeCopyBtnHtml = codeNorm ? `
    <div class="post-detail-code-body">
      <button type="button"
        class="btn-copy-code-wide"
        data-code="${escHtml_(codeNorm)}">
        デッキコードをコピー
      </button>
    </div>
  ` : '';

  const tabInfo = `
    <div class="post-detail-panel is-active" data-panel="info">
      <div class="post-detail-main">

        <div class="post-detail-main-top">
          <div class="post-detail-main-left">
            ${repImg ? `
              <img src="${repImg}"
                  class="post-detail-repimg"
                  alt="${escHtml_(item.title || '')}"
                  loading="lazy">
            ` : `
              <div style="width:100%;aspect-ratio:424/532;background:#eee;border-radius:10px;"></div>
            `}
          </div>

          <div class="post-detail-main-right">
            <header class="post-detail-header">
              <h2 class="post-detail-title">
                ${escHtml_(item.title || '(無題)')}
              </h2>

              <div class="post-detail-meta">
                <span>${escHtml_(item.posterName || item.username || '')}</span>
                ${posterXHtml ? `<span>/ ${posterXHtml}</span>` : ''}
                ${typeof window.fmtPostDates_ === 'function'
                  ? (window.fmtPostDates_(item) ? `<span>/ ${window.fmtPostDates_(item)}</span>` : '')
                  : ''
                }
              </div>

              <div class="post-detail-actions">
                <button type="button" class="btn-add-compare">比較に追加</button>
              </div>

              <div class="post-detail-tags">
                <div class="post-tags post-tags-main">${tagsMain}</div>
                <div class="post-tags post-tags-user">${tagsUser}</div>
              </div>
            </header>
          </div>
        </div>

        ${manageBoxHtml}

        <div class="post-detail-summary">
          <dt>デッキ枚数</dt><dd>${item.count || 0}枚</dd>
          <dt>種族</dt><dd>${escHtml_(mainRace || '')}</dd>
          <dt>旧神</dt><dd>${escHtml_(oldGod || 'なし')}</dd>

          ${typeChipsPane
            ? `<dt>タイプ構成</dt><dd><div class="post-detail-chips">${typeChipsPane}</div></dd>`
            : ''
          }

          ${rarityChipsPane
            ? `<dt>レアリティ構成</dt><dd><div class="post-detail-chips">${rarityChipsPane}</div></dd>`
            : ''
          }

          ${packChipsPane
            ? `<dt>パック構成</dt><dd><div class="post-detail-chips">${packChipsPane}</div></dd>`
            : ''
          }

          <dt>
            マナ効率
            <button type="button" class="help-button" aria-label="マナ効率の説明を確認">？</button>
          </dt>
          <dd class="mana-eff-row">
            <span id="mana-efficiency-${paneUid}" class="mana-eff">-</span>
            <span class="avg-charge-inline">
              （平均チャージ量：<span id="avg-charge-${escHtml_(paneUid)}">-</span>）
            </span>
          </dd>
        </div>

        <div class="post-detail-charts" data-postcharts="${escHtml_(item.postId || '')}">
          <div class="post-detail-chartbox">
            <div class="post-detail-charthead">
              <div class="post-detail-charttitle">コスト分布</div>
              <div class="post-detail-chartchips" id="cost-summary-${escHtml_(paneUid)}"></div>
            </div>
            <div class="post-detail-chartcanvas">
              <canvas id="costChart-${escHtml_(paneUid)}"></canvas>
            </div>
          </div>

          <div class="post-detail-chartbox">
            <div class="post-detail-charthead">
              <div class="post-detail-charttitle">パワー分布</div>
              <div class="post-detail-chartchips" id="power-summary-${escHtml_(paneUid)}"></div>
            </div>
            <div class="post-detail-chartcanvas">
              <canvas id="powerChart-${escHtml_(paneUid)}"></canvas>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;

  const tabNote = `
    <div class="post-detail-panel" data-panel="note">
      <div class="post-detail-section">

        <div class="post-detail-heading-row">
          <div class="post-detail-heading">デッキ解説</div>

          ${isMinePane ? `
            <div class="post-detail-heading-actions">
              <button type="button" class="btn-decknote-edit">編集</button>
            </div>
          ` : ''}
        </div>

        <div class="post-detail-body">
          <div class="decknote-view">
            ${deckNoteHtml || '<div style="color:#777;font-size:.9rem;">まだ登録されていません。</div>'}
          </div>

          ${isMinePane ? `
            <div class="decknote-editor" hidden>
              <div class="note-toolbar">
                <div class="note-presets-grid">
                  <button type="button" class="note-preset-btn" data-preset="deck-overview">デッキ概要</button>
                  <button type="button" class="note-preset-btn" data-preset="play-guide">プレイ方針</button>
                  <button type="button" class="note-preset-btn" data-preset="matchup">対面考察</button>
                  <button type="button" class="note-preset-btn" data-preset="results">実績レポート</button>
                </div>
              </div>

              <div class="decknote-editor-hint">
                ※上のプリセットボタンを押すと定型文が挿入されます。
              </div>

              <textarea class="decknote-textarea" rows="14"
                data-original="${escHtml_(deckNote || '')}"
              >${escHtml_(deckNote || '')}</textarea>

              <div class="decknote-editor-actions">
                <button type="button" class="btn-decknote-save">保存</button>
                <button type="button" class="btn-decknote-cancel">キャンセル</button>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  const tabCards = `
    <div class="post-detail-panel" data-panel="cards">
      <div class="post-detail-section">

        <div class="post-detail-heading-row post-detail-heading-row--cards">
          <div class="post-detail-heading">カード解説</div>

          ${isMinePane ? `
            <div class="post-detail-heading-actions">
              <button type="button" class="btn-cardnotes-edit">編集</button>
            </div>
          ` : ''}
        </div>

        <div class="post-detail-body">
          <div class="cardnotes-view">
            ${cardNotesHtml}
          </div>

          ${isMinePane ? `
            <div class="cardnotes-editor" hidden
                 data-original='${escHtml_(JSON.stringify(item.cardNotes || []))}'>
              <div class="info-value" style="width:100%">
                <div class="post-card-notes"></div>

                <input type="hidden" class="post-card-notes-hidden" value="${escHtml_(JSON.stringify(item.cardNotes || []))}">

                <input type="text" class="post-cardnote-validator" aria-hidden="true" tabindex="-1"
                  style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;border:none;padding:0;margin:0;">

                <div class="add-note-box">
                  <button type="button" id="add-card-note" class="add-note-btn">カード解説を追加</button>
                  <div class="post-hint" style="opacity:.8">※カードを選んで簡単な解説や採用理由を書けます</div>
                </div>

                <div class="decknote-editor-actions" style="margin-top:.6rem;">
                  <button type="button" class="btn-cardnotes-save">保存</button>
                  <button type="button" class="btn-cardnotes-cancel">キャンセル</button>
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  const tabsHtml = `
    <div class="post-detail-tabs">
      <button type="button" class="post-detail-tab is-active" data-tab="info">📘 デッキ情報</button>
      <button type="button" class="post-detail-tab" data-tab="note">📝 デッキ解説</button>
      <button type="button" class="post-detail-tab" data-tab="cards">🗂 カード解説</button>
    </div>
  `;

  pane.innerHTML = `
    <div class="post-detail-inner" data-postid="${escHtml_(item.postId || '')}" style="${bg ? `--race-bg:${bg};` : ''}">
      <div class="post-detail-maincol">
        ${tabsHtml}
        <div class="post-detail-body">
          ${tabInfo}
          ${tabNote}
          ${tabCards}
        </div>
      </div>

      <aside class="post-detail-deckcol">
        <div class="post-detail-section">
          <div class="post-detail-heading-row">
            <div class="post-detail-heading">デッキリスト</div>
            <div class="post-detail-heading-actions">
              <button type="button" class="btn-decklist-export">リスト保存</button>
            </div>
          </div>
          <div class="post-decklist-hint">
            👇 カードをタップすると詳細が表示されます
          </div>
          ${deckListHtml}
          ${codeCopyBtnHtml}
        </div>
      </aside>
    </div>
  `;

  const root = pane.querySelector('.post-detail-inner');

  if (root && window.matchMedia('(min-width: 1024px)').matches) {
    ensureCardDetailDockPc_(root);
  }

  if (root) {
    const compareBtn = root.querySelector(
      '.post-detail-panel[data-panel="info"] .btn-add-compare'
    );

    if (compareBtn && !compareBtn.dataset.wired) {
      compareBtn.dataset.wired = '1';
      compareBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        alert('比較タブに追加する機能はベータ版では準備中です。');
      });
    }
  }

  try {
    renderPostDistCharts_(item, paneUid);
  } catch (e) {
    console.warn('renderPostDistCharts_ failed:', e);
  }
}

  // 指定した記事要素に対して詳細ペインを表示する
  function showDetailPaneForArticle(articleEl) {
    const art = articleEl?.closest?.('.post-card') || articleEl;
    if (!art) return;

    const postId = String(art.dataset.postid || '').trim();
    if (!postId) return;

    const item = findItemById_(postId);
    if (!item) return;

    const isMine = !!art.closest('#myPostList, #pageMine');
    const basePaneId = isMine ? 'postDetailPaneMine' : 'postDetailPane';

    withCardMapForPostDate_(item, () => renderDetailPaneForItem(item, basePaneId));

    document.querySelectorAll('.post-card.is-active').forEach((el) => {
      el.classList.remove('is-active');
    });
    art.classList.add('is-active');
  }

  function findPostItemById(postId) {
    return findItemById_(postId);
  }

  // =========================
  // 10) SPデッキpeek
  // =========================
  function setupDeckPeekOnSp() {
    if (window.__deckPostPeekBound) return;
    window.__deckPostPeekBound = true;

    const isSp = () => window.matchMedia('(max-width: 1023px)').matches;

    function ensureOverlay() {
      let pane = document.getElementById('post-deckpeek-overlay');
      if (!pane) {
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

    function hideOverlay() {
      const pane = document.getElementById('post-deckpeek-overlay');
      if (pane) {
        pane.style.display = 'none';
      }
    }

    function showForArticle(art, thumbEl) {
      if (!isSp()) return;
      if (!art) return;

      const postId = art.dataset.postid;
      if (!postId) return;

      const item = findItemById_(postId);
      if (!item) return;

      const html = buildDeckListHtml(item);

      const pane = ensureOverlay();
      const body = pane.querySelector('.post-deckpeek-body');
      if (!body) return;

      body.innerHTML = html;
      pane.style.display = 'block';
      pane.style.width = '';
      pane.style.right = 'auto';
      pane.style.bottom = 'auto';

      const maxW = Math.min(window.innerWidth * 0.7, 460);
      pane.style.width = maxW + 'px';

      if (thumbEl) {
        const r = thumbEl.getBoundingClientRect();
        const margin = 8;

        const paneW = pane.offsetWidth;
        const paneH = pane.offsetHeight;

        let left = r.right + margin;
        let top = r.top;

        if (left + paneW > window.innerWidth - margin) {
          left = window.innerWidth - margin - paneW;
          if (left < margin) left = margin;
        }

        if (top + paneH > window.innerHeight - margin) {
          top = window.innerHeight - margin - paneH;
          if (top < margin) top = margin;
        }

        pane.style.left = left + 'px';
        pane.style.top = top + 'px';
      }
    }

    document.addEventListener('click', (e) => {
      const thumb = e.target.closest('.post-card .thumb-box, .post-card .sp-head .thumb-box, .post-card .pc-head-left .thumb-box');
      if (thumb) {
        const art = thumb.closest('.post-card');
        if (art && isSp()) {
          e.preventDefault();
          e.stopPropagation();
          showForArticle(art, thumb);
          return;
        }
      }

      const pane = document.getElementById('post-deckpeek-overlay');
      if (!pane) return;
      if (e.target === pane) hideOverlay();
    });

    window.addEventListener('resize', () => {
      if (!isSp()) hideOverlay();
    });
  }


    /**
   * 詳細UI初期化
   * - SPデッキpeek配線
   */
  function init() {
    setupDeckPeekOnSp();
  }

  // =========================
  // 11) イベント委譲
  // =========================
  document.addEventListener('click', async (e) => {
    // -------------------------
    // 1) 右ペイン：タブ切り替え
    // -------------------------
    const tab = e.target.closest('.post-detail-tab');
    if (tab) {
      const rootEl = tab.closest('.post-detail-inner');
      const key = String(tab.dataset.tab || '').trim();
      if (rootEl && key) {
        rootEl.querySelectorAll('.post-detail-tab').forEach((btn) => {
          btn.classList.toggle('is-active', btn === tab);
        });
        rootEl.querySelectorAll('.post-detail-panel').forEach((panel) => {
          panel.classList.toggle('is-active', panel.dataset.panel === key);
        });
      }
      return;
    }

    // -------------------------
    // 2) デッキコードコピー（横長ボタン）
    // -------------------------
    const wideCopy = e.target.closest('.btn-copy-code-wide');
    if (wideCopy) {
      const code = String(wideCopy.dataset.code || '').trim();
      if (code && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(code);
          if (typeof window.showCodeCopyToast === 'function') {
            window.showCodeCopyToast();
          } else if (typeof window.showMiniToast_ === 'function') {
            window.showMiniToast_('デッキコードをコピーしました');
          }
        } catch (_) {}
      }
      return;
    }

    // -------------------------
    // 3) SP：詳細を開く
    // -------------------------
    const detailBtn = e.target.closest('.btn-detail');
    if (detailBtn) {
      const art = detailBtn.closest('.post-card');
      const d = art?.querySelector('.post-detail');
      if (!art || !d) return;

      const willOpen = !!d.hidden;
      d.hidden = !d.hidden;

      // 開いた瞬間だけ、分布グラフを描画
      if (willOpen && !d.dataset.chartsRendered) {
        const postId = String(art.dataset.postid || '').trim();
        const item = findPostItemById(postId);
        const charts = art.querySelector('.post-detail-charts');
        const paneUid = String(charts?.dataset?.paneid || '').trim();

        if (item && paneUid) {
          requestAnimationFrame(() => {
            try {
              const ok = renderPostDistCharts_(item, paneUid);
              if (ok) d.dataset.chartsRendered = '1';
            } catch (err) {
              console.warn('SP renderPostDistCharts_ failed:', err);
            }
          });
        } else {
          console.warn('SP charts skipped: item or paneUid missing', {
            postId,
            hasItem: !!item,
            paneUid,
          });
        }
      }
      return;
    }

    // -------------------------
    // 4) SP：詳細を閉じる
    // -------------------------
    const detailCloseBtn = e.target.closest('.btn-detail-close');
    if (detailCloseBtn) {
      const art = detailCloseBtn.closest('.post-card');
      const d = art?.querySelector('.post-detail');
      if (d) d.hidden = true;
      art?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    // -------------------------
    // 5) デッキ内カード → カード詳細
    // -------------------------
    const deckEntry = e.target.closest(
      '.post-detail-inner .deck-entry, #post-deckpeek-overlay .deck-entry'
    );
    if (deckEntry) {
      const cd = String(deckEntry.dataset.cd || '').trim().padStart(5, '0');
      if (cd) {
        e.preventDefault();
        e.stopPropagation();
        openCardDetailFromDeck_(cd, deckEntry);
      }
      return;
    }

    // -------------------------
    // 6) カード詳細を閉じる
    // -------------------------
    const closeBtn = e.target.closest('.carddetail-close');
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      closeCardDetail_();
      return;
    }

    // -------------------------
    // 7) 比較に追加（仮）
    // -------------------------
    const compareBtn = e.target.closest('.btn-add-compare');
    if (compareBtn) {
      e.preventDefault();
      e.stopPropagation();
      alert('比較タブに追加する機能はベータ版では準備中です。');
      return;
    }

    // -------------------------
    // 8) パック構成チップ → デッキ内カード強調
    // -------------------------
    const chip = e.target.closest('.post-detail-inner .pack-chip');
    if (chip) {
      const root = chip.closest('.post-detail-inner') || document;
      const decklist = root.querySelector('.post-decklist');
      if (!decklist) return;

      const pack = chip.dataset.pack || null;

      if (chip.classList.contains('is-active')) {
        root.querySelectorAll('.pack-chip.is-active')
          .forEach((el) => el.classList.remove('is-active'));
        root.querySelectorAll('.deck-entry.pack-hl')
          .forEach((el) => el.classList.remove('pack-hl'));
        decklist.classList.remove('is-pack-focus');
        return;
      }

      root.querySelectorAll('.pack-chip.is-active')
        .forEach((el) => el.classList.remove('is-active'));
      root.querySelectorAll('.deck-entry.pack-hl')
        .forEach((el) => el.classList.remove('pack-hl'));

      if (!pack) return;

      chip.classList.add('is-active');
      root.querySelectorAll(`.deck-entry[data-pack="${pack}"]`)
        .forEach((el) => el.classList.add('pack-hl'));
      decklist.classList.add('is-pack-focus');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCardDetail_();
      const peek = document.getElementById('post-deckpeek-overlay');
      if (peek) peek.style.display = 'none';
      return;
    }

    const entry = e.target.closest?.('.post-detail-inner .deck-entry');
    if (entry && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const cd = String(entry.dataset.cd || '').trim().padStart(5, '0');
      if (cd) openCardDetailFromDeck_(cd, entry);
    }

    // パック構成チップ → デッキ内カード強調
    const packChip = e.target.closest('.pack-chip');
    if (packChip) {
      const pack = packChip.dataset.pack || null;

      const root = packChip.closest('.post-detail-inner') || document;
      const decklist = root.querySelector('.post-decklist');
      if (!decklist) return;

      if (packChip.classList.contains('is-active')) {
        root.querySelectorAll('.pack-chip.is-active')
          .forEach(el => el.classList.remove('is-active'));
        root.querySelectorAll('.deck-entry.pack-hl')
          .forEach(el => el.classList.remove('pack-hl'));
        decklist.classList.remove('is-pack-focus');
        return;
      }

      root.querySelectorAll('.pack-chip.is-active')
        .forEach(el => el.classList.remove('is-active'));
      root.querySelectorAll('.deck-entry.pack-hl')
        .forEach(el => el.classList.remove('pack-hl'));

      if (!pack) return;

      packChip.classList.add('is-active');

      root.querySelectorAll(`.deck-entry[data-pack="${pack}"]`)
        .forEach(el => el.classList.add('pack-hl'));

      decklist.classList.add('is-pack-focus');
      return;
    }

  });



  // =========================
  // 12) 外部公開
  // =========================
  window.DeckPostDetail = window.DeckPostDetail || {};
  window.DeckPostDetail.el = window.createElementFromHTML;
  window.DeckPostDetail.escHtml_ = escHtml_;
  window.DeckPostDetail.nl2br_ = nl2br_;
  window.DeckPostDetail.cardThumb = cardThumb;
  window.DeckPostDetail.getMainRace = getMainRace;
  window.DeckPostDetail.raceBg = raceBg;
  window.DeckPostDetail.extractDeckMap = extractDeckMap;
  window.DeckPostDetail.getOldGodNameFromItem = getOldGodNameFromItem;
  window.DeckPostDetail.renderPostDistCharts_ = renderPostDistCharts_;
  window.DeckPostDetail.packNameEn_ = packNameEn_;
  window.DeckPostDetail.packAbbr_ = packAbbr_;
  window.DeckPostDetail.packKeyFromAbbr_ = packKeyFromAbbr_;
  window.DeckPostDetail.getPackOrder_ = getPackOrder_;
  window.DeckPostDetail.buildDeckListHtml = buildDeckListHtml;

  window.DeckPostDetail.rarityKeyForPage4_ = rarityKeyForPage4_;
  window.DeckPostDetail.rarityPillClassForPage4_ = rarityPillClassForPage4_;
  window.DeckPostDetail.rarityLabelForPage4_ = rarityLabelForPage4_;
  window.DeckPostDetail.findItemById_ = findItemById_;
  window.DeckPostDetail.withCardMapForPostDate_ = withCardMapForPostDate_;
  window.DeckPostDetail.parseJstDate_ = parseJstDate_;

  window.DeckPostDetail.buildCardDetailHtml_ = buildCardDetailHtml_;
  window.DeckPostDetail.closeCardDetail_ = closeCardDetail_;
  window.DeckPostDetail.ensureCardDetailDockPc_ = ensureCardDetailDockPc_;
  window.DeckPostDetail.ensureCardDetailDrawerSp_ = ensureCardDetailDrawerSp_;
  window.DeckPostDetail.openCardDetailFromDeck_ = openCardDetailFromDeck_;

  window.DeckPostDetail.buildSimpleDeckStats = buildSimpleDeckStats;
  window.DeckPostDetail.buildTypeChipsHtml_ = buildTypeChipsHtml_;
  window.DeckPostDetail.buildRarityMixText_ = buildRarityMixText_;
  window.DeckPostDetail.buildRarityMixCounts_ = buildRarityMixCounts_;
  window.DeckPostDetail.buildRarityChipsHtml_ = buildRarityChipsHtml_;
  window.DeckPostDetail.buildPackMixCounts_ = buildPackMixCounts_;
  window.DeckPostDetail.buildPackChipsHtml_ = buildPackChipsHtml_;

  window.DeckPostDetail.buildDeckNoteHtml = buildDeckNoteHtml;
  window.DeckPostDetail.buildCardNotesHtml = buildCardNotesHtml;
  window.DeckPostDetail.renderDetailPaneForItem = renderDetailPaneForItem;
  window.DeckPostDetail.showDetailPaneForArticle = showDetailPaneForArticle;
  window.DeckPostDetail.findPostItemById = findPostItemById;
  window.DeckPostDetail.setupDeckPeekOnSp = setupDeckPeekOnSp;
  window.DeckPostDetail.init = init;
})();