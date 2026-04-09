/* =========================
 * common/summary.js
 * - 所持率・コンプ率計算とUI更新
 * - updateSummary() を提供
 * - buildShareText() を提供
 * - カード所持率サマリーの計算と表示更新を担当
 * - 全体所持率 & モバイルパック別所持率
 * - X intent 用の共有テキスト生成も担当
    ========================= */

// ===== X intent 用：共有テキスト生成（checker専用リンクは持たない）=====
window.buildShareText = window.buildShareText || function buildShareText({
  header = '全カード',
  sum,
  packName = '',
  packSum = null,

  // 図鑑ページ(cards.html)の所持率チェッカー(#checker)へ
  url = 'https://mosurogia.github.io/mesorogia-cards/cards.html#checker',

  useFullWidthHash = false,
} = {}) {
  const hashTag = useFullWidthHash ? '＃神託のメソロギア' : '#神託のメソロギア';
  const lines = [
    '【神託のメソロギア】',
    header,
    `所持率: ${sum.ownedTypes}/${sum.totalTypes} (${sum.typePercentText ?? sum.typePercent}%)`,
  ];
  if (packSum && packName) {
    lines.push(
      packName,
      `所持率: ${packSum.ownedTypes}/${packSum.totalTypes} (${packSum.typePercent}%)`,
    );
  }
  lines.push('モスロギア～所持率チェッカー～', hashTag, url);
  return encodeURIComponent(lines.join('\n'));
};


(function(){
  // cdから所持数を取得する
  function ownedTotalByCd_(cd){
    const S = window.OwnedStore;
    if (!S?.get) return 0;
    const e = S.get(String(cd));
    return (e?.normal|0) + (e?.shine|0) + (e?.premium|0);
  }

  // =========================
  // 所持率オプション（SP/PC共通）
  // =========================
  const SUMMARY_OPT_KEY = 'mosurogia_summary_include_unobtainable';

  function getIncludeUnobtainable_(){
    try { return localStorage.getItem(SUMMARY_OPT_KEY) === '1'; }
    catch(e){ return false; }
  }

  function setIncludeUnobtainable_(v){
    try { localStorage.setItem(SUMMARY_OPT_KEY, v ? '1' : '0'); }
    catch(e){}
  }

  // card が「入手不可カテゴリ（コラボ/特殊）」か判定（堅牢版）
  function isUnobtainableCard_(card){
    const sec = card?.closest?.('.pack-section');
    if (!sec) return false;

    // 1) まず data-packgroup を見る（小文字化）
    const g = String(sec.getAttribute('data-packgroup') || '').toLowerCase();
    if (g === 'collab' || g === 'special') return true;

    // 2) フォールバック：見出しテキスト等に「コラボ/特殊」が含まれるか
    const title = sec.querySelector('.pack-title-text, .pack-title, h3, h2');
    const t = String(title?.textContent || '').trim();
    if (t.includes('コラボ')) return true;
    if (t.includes('特殊')) return true;

    return false;
  }



  // nodeListから所持率・コンプ率を計算する
  function calcSummary(nodeList){
    let owned = 0, ownedTypes = 0, total = 0, totalTypes = 0;
    const includeUnobtainable = getIncludeUnobtainable_();

    nodeList.forEach(card => {
      if (!includeUnobtainable && isUnobtainableCard_(card)) return;

      totalTypes++;

      const cd = card.dataset.cd;
      const cnt = cd ? ownedTotalByCd_(cd) : 0;

      owned += cnt;
      if (cnt > 0) ownedTypes++;

      total += (card.dataset.race === '旧神') ? 1 : 3;
    });

    const percentRaw = total ? (owned / total) * 100 : 0;
    const typePercentRaw = totalTypes ? (ownedTypes / totalTypes) * 100 : 0;

    const percent = Math.round(percentRaw * 10) / 10;
    const typePercent = Math.round(typePercentRaw * 10) / 10;

    return {
      owned, ownedTypes, total, totalTypes,
      percent, typePercent,
      percentText: percent.toFixed(1),
      typePercentText: typePercent.toFixed(1),
    };
  }

  // =========================
  // 種族別サマリー
  // =========================

  // 種族名を正規化（末尾の（ふりがな）など除去）
  function normalizeRace_(s){
    const v = String(s ?? '').trim();
    return v ? v.replace(/\s*[（(][^（）()]*[）)]\s*$/g, '') : '不明';
  }

  // 種族 → common.css の色変数へ（--race-*）
  // ※旧神だけはグラデで扱いが特殊なので accent を紫に寄せる
  function raceToAccentVar_(race){
    switch (race) {
      case 'ドラゴン': return 'var(--race-dragon)';
      case 'アンドロイド': return 'var(--race-android)';
      case 'エレメンタル': return 'var(--race-elemental)';
      case 'ルミナス': return 'var(--race-luminous)';
      case 'シェイド': return 'var(--race-shade)';
      case 'イノセント': return 'var(--race-innocent)';
      case '旧神': return '#a78bfa'; // 旧神はグラデ枠なので “ゲージ用アクセント” は固定
      default: return 'rgba(140,140,140,1)';
    }
  }

  // PC/SP の置き場所を用意（無ければ生成して差し込む）
// PC/SP の置き場所を用意（無ければ生成して差し込む）
function ensureRaceContainers_(){
  // PC：#pack-summary-list の直前に挿入
  let pc = document.getElementById('race-summary-list');
  const packList = document.getElementById('pack-summary-list');
  if (!pc && packList && packList.parentElement){
    pc = document.createElement('div');
    pc.id = 'race-summary-list';
    pc.className = 'summary-breakdown-block -race -pc';
    packList.parentElement.insertBefore(pc, packList);
  }

  // SP：#packs-root の先頭（パックセクションの上）に挿入
  let mo = document.getElementById('race-summary-mobile');
  const packsRoot = document.getElementById('packs-root');
  if (!mo && packsRoot){
    mo = document.createElement('div');
    mo.id = 'race-summary-mobile';
    mo.className = 'summary-breakdown-block -race -mobile';
    packsRoot.insertBefore(mo, packsRoot.firstChild);
  }

  // ✅ 追加：race-summary-mobile の「上」に注意書きバーを差し込む
  if (packsRoot) {
    let note = document.getElementById('checker-note-mobile');
    if (!note) {
      note = document.createElement('div');
      note.id = 'checker-note-mobile';
      note.className = 'checker-note';

      note.innerHTML = `
<div class="checker-note-sub">
  ● 所持状況は自動保存されます（保存ボタン不要）
</div>
<div class="checker-note-sub">
  ● 保存はこの端末/ブラウザ内です
</div>
<div class="checker-note-sub">
  ● 将来的にログイン機能により、所持状況を他端末と同期できる予定です
</div>

<div class="checker-note-row">
  <label class="checker-note-toggle">
    <input type="checkbox" id="toggle-unobtainable">
    <span>コラボ/特殊を所持率に含める</span>
  </label>
</div>
<div class="checker-note-sub">
  ● OFF時：コラボ/特殊は母数から除外（現在入手不可のため）
</div>
      `;
    }

    // 常に race-summary-mobile の直前に置く（再描画にも強い）
    if (mo && note.nextSibling !== mo) {
      packsRoot.insertBefore(note, mo);
    }
  }

    // ✅ 追加：note 内UIのイベント配線（1回だけ）
  if (packsRoot) {
    const note = document.getElementById('checker-note-mobile');
    if (note && !note.dataset.wired) {
      note.dataset.wired = '1';

      const cb   = note.querySelector('#toggle-unobtainable');

      if (cb) {
        // 初期状態（保存値を反映）
        cb.checked = getIncludeUnobtainable_();

        cb.addEventListener('change', () => {
          setIncludeUnobtainable_(cb.checked);
          // 数字を更新
          window.Summary?.updateSummary?.();
        });
      }
    }
  }

  return { pc, mo };
}


  function renderRaceSummaryHTML_(rows){
    if (!rows.length) return '';

    const items = rows.map(r => {
      const s = r.sum;
      const raceClass = `race-${r.name}`;
      return `
        <div class="summary-breakdown-item ${raceClass}" style="--accent:${r.accent}">
          <div class="summary-breakdown-head">
            <span class="summary-breakdown-dot" aria-hidden="true"></span>
            <span class="summary-breakdown-name">${r.name}</span>
            <span class="summary-breakdown-val">${s.ownedTypes}/${s.totalTypes} (${s.typePercentText}%)</span>
          </div>

          <!-- ✅ 所持率（種類） -->
          <div class="meter">
            <div class="meter-label">所持率</div>
            <div class="meter-track" role="progressbar"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.typePercent}">
              <span class="meter-bar -own" style="width:${s.typePercentText}%"></span>
            </div>
            <div class="meter-val">
              <span class="meter-frac">${s.ownedTypes}/${s.totalTypes}</span>
              <span class="meter-pct">(${s.typePercentText}%)</span>
            </div>
          </div>

          <!-- ✅ コンプ率（枚数） -->
          <div class="meter -sub">
            <div class="meter-label">コンプ率</div>
            <div class="meter-track" role="progressbar"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.percent}">
              <span class="meter-bar -comp" style="width:${s.percentText}%"></span>
            </div>
            <div class="meter-val">
              <span class="meter-frac">${s.owned}/${s.total}</span>
              <span class="meter-pct">(${s.percentText}%)</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

      return `
        <div class="summary-breakdown-header" role="button" tabindex="0"
            data-break-toggle="header" aria-expanded="false">
          <span class="summary-breakdown-title">種族別所持率</span>
          <span class="summary-breakdown-toggle" data-break-toggle="icon" aria-hidden="true">＋</span>
        </div>

        <div class="summary-breakdown-body" data-break-toggle="body" hidden>
          <div class="summary-breakdown-list">
            ${items}
          </div>
        </div>
      `;
  }


  function updateRaceSummary(){
    const allCards = document.querySelectorAll('#packs-root .card');
    if (!allCards || !allCards.length) return;

    const { pc, mo } = ensureRaceContainers_();
    if (!pc && !mo) return;

    // race -> Node[] にまとめる（data-race を使う）
    const map = new Map();
    allCards.forEach(card => {
      const raw = card.dataset.race || '不明';
      const name = normalizeRace_(raw);
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(card);
    });

    // rows 作成
    const rows = [...map.entries()].map(([name, list]) => {
      return { name, sum: calcSummary(list), accent: raceToAccentVar_(name) };
    });

    // 並び：RACE_ORDER_all があるならそれに従う（なければカード数多い順）
    const order = Array.isArray(window.RACE_ORDER_all) ? window.RACE_ORDER_all : null;
    if (order) {
      const idx = new Map(order.map((x,i)=>[String(x), i]));
      rows.sort((a,b)=>{
        const ia = idx.has(a.name) ? idx.get(a.name) : 999;
        const ib = idx.has(b.name) ? idx.get(b.name) : 999;
        if (ia !== ib) return ia - ib;
        // 同順位なら総種類数が多い方
        return b.sum.totalTypes - a.sum.totalTypes;
      });
    } else {
      rows.sort((a,b)=>{
        if (b.sum.totalTypes !== a.sum.totalTypes) return b.sum.totalTypes - a.sum.totalTypes;
        return a.name.localeCompare(b.name, 'ja');
      });
    }

    (window.Summary ||= {})._lastRaces = rows;

    function wireToggle_(root){
      if (!root) return;

      // ✅ DOMを作り直してもOKな「イベント委譲」にする（rootに1回だけ）
      if (!root.dataset.wiredRaceToggle) {
        root.dataset.wiredRaceToggle = '1';

        const toggle = () => {
          const header = root.querySelector('[data-break-toggle="header"]');
          const body   = root.querySelector('[data-break-toggle="body"]');
          const icon   = root.querySelector('[data-break-toggle="icon"]');
          if (!header || !body || !icon) return;

          const isOpen = !body.hidden;
          body.hidden = isOpen; // open→hide / hide→open
          header.setAttribute('aria-expanded', String(!isOpen));
          icon.textContent = isOpen ? '＋' : '－';
        };

        root.addEventListener('click', (e) => {
          if (e.target.closest('[data-break-toggle="header"]')) toggle();
        });
        root.addEventListener('keydown', (e) => {
          if (!e.target.closest('[data-break-toggle="header"]')) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        });
      }
    }

    const html = renderRaceSummaryHTML_(rows);

    //再描画前の open 状態を覚える
    const wasOpenPc = (() => {
      const body = pc?.querySelector?.('[data-break-toggle="body"]');
      return body ? !body.hidden : false;
    })();
    const wasOpenMo = (() => {
      const body = mo?.querySelector?.('[data-break-toggle="body"]');
      return body ? !body.hidden : false;
    })();

    if (pc) {
      pc.innerHTML = html;
      wireToggle_(pc);

      const header = pc.querySelector('[data-break-toggle="header"]');
      const body   = pc.querySelector('[data-break-toggle="body"]');
      const icon   = pc.querySelector('[data-break-toggle="icon"]');
      if (header && body && icon) {
        body.hidden = !wasOpenPc;
        header.setAttribute('aria-expanded', String(wasOpenPc));
        icon.textContent = wasOpenPc ? '－' : '＋';
      }
    }

    if (mo) {
      mo.innerHTML = html;
      wireToggle_(mo);

      const header = mo.querySelector('[data-break-toggle="header"]');
      const body   = mo.querySelector('[data-break-toggle="body"]');
      const icon   = mo.querySelector('[data-break-toggle="icon"]');
      if (header && body && icon) {
        body.hidden = !wasOpenMo;
        header.setAttribute('aria-expanded', String(wasOpenMo));
        icon.textContent = wasOpenMo ? '－' : '＋';
      }
    }
  }

    // =========================
  // レアリティ別サマリー
  // =========================

  function normalizeRarity_(s){
    const v = String(s ?? '').trim();
    return v ? v.replace(/\s*[（(][^（）()]*[）)]\s*$/g, '') : '不明';
  }

  // レアリティ → ゲージ用アクセント色（好みで調整OK）
  function rarityToAccent_(rar){
    switch (rar) {
      case 'レジェンド': return '#91e4fb';
      case 'ゴールド':   return '#eab308';
      case 'シルバー':   return '#94a3b8';
      case 'ブロンズ':   return '#c08457';
      default:           return '#aaa';
    }
  }


  // PC/SP の置き場所を用意（無ければ生成して差し込む）
  function ensureRarityContainers_(){
    // PC：race の「次」、pack の「前」
    let pc = document.getElementById('rarity-summary-list');
    const raceList = document.getElementById('race-summary-list');
    const packList = document.getElementById('pack-summary-list');

    if (!pc) {
      pc = document.createElement('div');
      pc.id = 'rarity-summary-list';
      pc.className = 'summary-breakdown-block -rarity -pc';

      if (raceList && raceList.parentElement) {
        // ✅ 種族別の直下に入れる
        raceList.parentElement.insertBefore(pc, raceList.nextSibling);
      } else if (packList && packList.parentElement) {
        // race が無い場合は pack の前
        packList.parentElement.insertBefore(pc, packList);
      } else {
        // どこにも挿せないなら破棄
        pc = null;
      }
    }

    // SP：#packs-root の先頭で race の次
    let mo = document.getElementById('rarity-summary-mobile');
    const packsRoot = document.getElementById('packs-root');

    if (!mo && packsRoot) {
      mo = document.createElement('div');
      mo.id = 'rarity-summary-mobile';
      mo.className = 'summary-breakdown-block -rarity -mobile';

      const raceMobile = document.getElementById('race-summary-mobile');
      if (raceMobile && raceMobile.parentElement === packsRoot) {
        packsRoot.insertBefore(mo, raceMobile.nextSibling);
      } else {
        packsRoot.insertBefore(mo, packsRoot.firstChild);
      }
    }

    return { pc, mo };
  }

  function renderRaritySummaryHTML_(rows){
    if (!rows.length) return '';

    const items = rows.map(r => {
      const s = r.sum;
      const rarClass = `rarity-${r.name}`;
      return `
        <div class="summary-breakdown-item ${rarClass}" style="--accent:${r.accent}">
          <div class="summary-breakdown-head">
            <span class="summary-breakdown-dot" aria-hidden="true"></span>
            <span class="summary-breakdown-name">${r.name}</span>
            <span class="summary-breakdown-val">${s.ownedTypes}/${s.totalTypes} (${s.typePercentText}%)</span>
          </div>

          <!-- 所持率（種類） -->
          <div class="meter">
            <div class="meter-label">所持率</div>
            <div class="meter-track" role="progressbar"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.typePercent}">
              <span class="meter-bar -own" style="width:${s.typePercentText}%"></span>
            </div>
            <div class="meter-val">
              <span class="meter-frac">${s.ownedTypes}/${s.totalTypes}</span>
              <span class="meter-pct">(${s.typePercentText}%)</span>
            </div>
          </div>

          <!-- コンプ率（枚数） -->
          <div class="meter -sub">
            <div class="meter-label">コンプ率</div>
            <div class="meter-track" role="progressbar"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.percent}">
              <span class="meter-bar -comp" style="width:${s.percentText}%"></span>
            </div>
            <div class="meter-val">
              <span class="meter-frac">${s.owned}/${s.total}</span>
              <span class="meter-pct">(${s.percentText}%)</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

      return `
        <div class="summary-breakdown-header" role="button" tabindex="0"
            data-break-toggle="header" aria-expanded="false">
          <span class="summary-breakdown-title">レアリティ別所持率</span>
          <span class="summary-breakdown-toggle" data-break-toggle="icon" aria-hidden="true">＋</span>
        </div>

        <div class="summary-breakdown-body" data-break-toggle="body" hidden>
          <div class="summary-breakdown-list">
            ${items}
          </div>
        </div>
      `;
  }

  function updateRaritySummary(){
    const allCards = document.querySelectorAll('#packs-root .card');
    if (!allCards || !allCards.length) return;

    const { pc, mo } = ensureRarityContainers_();
    if (!pc && !mo) return;

    // rarity -> Node[] にまとめる（data-rarity を使う）
    const map = new Map();
    allCards.forEach(card => {
      const raw = card.dataset.rarity || '不明';
      const name = normalizeRarity_(raw);
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(card);
    });

    const rows = [...map.entries()].map(([name, list]) => {
      return { name, sum: calcSummary(list), accent: rarityToAccent_(name) };
    });

    // 並び：基本は レジェンド→ゴールド→シルバー→ブロンズ
    const ORDER = ['レジェンド','ゴールド','シルバー','ブロンズ'];
    const idx = new Map(ORDER.map((x,i)=>[x,i]));
    rows.sort((a,b)=>{
      const ia = idx.has(a.name) ? idx.get(a.name) : 999;
      const ib = idx.has(b.name) ? idx.get(b.name) : 999;
      if (ia !== ib) return ia - ib;
      return b.sum.totalTypes - a.sum.totalTypes;
    });

    (window.Summary ||= {})._lastRarities = rows;

    function wireToggle_(root){
      if (!root) return;

      // イベント委譲（rootに1回だけ）
      if (!root.dataset.wiredRarityToggle) {
        root.dataset.wiredRarityToggle = '1';

        const toggle = () => {
          const header = root.querySelector('[data-break-toggle="header"]');
          const body   = root.querySelector('[data-break-toggle="body"]');
          const icon   = root.querySelector('[data-break-toggle="icon"]');
          if (!header || !body || !icon) return;

          const isOpen = !body.hidden;
          body.hidden = isOpen;
          header.setAttribute('aria-expanded', String(!isOpen));
          icon.textContent = isOpen ? '＋' : '－';
        };

        root.addEventListener('click', (e) => {
          if (e.target.closest('[data-break-toggle="header"]')) toggle();
        });
        root.addEventListener('keydown', (e) => {
          if (!e.target.closest('[data-break-toggle="header"]')) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        });
      }

      // 初期は折りたたみ
      const header = root.querySelector('[data-break-toggle="header"]');
      const body   = root.querySelector('[data-break-toggle="body"]');
      const icon   = root.querySelector('[data-break-toggle="icon"]');
      if (header && body && icon) {
        body.hidden = true;
        header.setAttribute('aria-expanded', 'false');
        icon.textContent = '＋';
      }
    }

    const html = renderRaritySummaryHTML_(rows);

    // ▼ 追加：再描画前の open 状態を覚える
    const wasOpenPc = (() => {
      const body = pc?.querySelector?.('[data-break-toggle="body"]');
      return body ? !body.hidden : false;
    })();
    const wasOpenMo = (() => {
      const body = mo?.querySelector?.('[data-break-toggle="body"]');
      return body ? !body.hidden : false;
    })();

    if (pc) {
      pc.innerHTML = html;
      wireToggle_(pc);

      // ▼ 追加：状態を復元
      const header = pc.querySelector('[data-break-toggle="header"]');
      const body   = pc.querySelector('[data-break-toggle="body"]');
      const icon   = pc.querySelector('[data-break-toggle="icon"]');
      if (header && body && icon) {
        body.hidden = !wasOpenPc;
        header.setAttribute('aria-expanded', String(wasOpenPc));
        icon.textContent = wasOpenPc ? '－' : '＋';
      }
    }

    if (mo) {
      mo.innerHTML = html;
      wireToggle_(mo);

      // ▼ 追加：状態を復元
      const header = mo.querySelector('[data-break-toggle="header"]');
      const body   = mo.querySelector('[data-break-toggle="body"]');
      const icon   = mo.querySelector('[data-break-toggle="icon"]');
      if (header && body && icon) {
        body.hidden = !wasOpenMo;
        header.setAttribute('aria-expanded', String(wasOpenMo));
        icon.textContent = wasOpenMo ? '－' : '＋';
      }
    }
  }


    // =========================
    // 全体所持率サマリー更新
    // =========================

    // 全体所持率を更新する
    function updateOverallSummary(){
        const allCards = document.querySelectorAll('#packs-root .card');
        const s = calcSummary(allCards);
        (window.Summary ||= {})._lastOverall = s;

    // PCサイドバー
    const pcRate = document.querySelector('#summary .summary-rate');
    if (pcRate){
        pcRate.innerHTML =
          `所持率: ${s.ownedTypes}/${s.totalTypes} (${s.typePercentText}%)<br>` +
          `コンプ率: ${s.owned}/${s.total} (${s.percentText}%)`;
    }

    // PC共有リンク
    const pcTweet = document.querySelector('#summary .summary-share a');
    if (pcTweet){
        const txt = window.buildShareText({ header: '全カード', sum: s });
        pcTweet.href = `https://twitter.com/intent/tweet?text=${txt}`;
    }

    // モバイル上部の数値
    const moTypeCount   = document.getElementById('mobile-owned-type-count');
    const moTypeTotal   = document.getElementById('mobile-total-type-count');
    const moTypePercent = document.getElementById('mobile-owned-type-percent');
    const moOwned       = document.getElementById('mobile-owned-count');
    const moTotal       = document.getElementById('mobile-total-count');
    const moPercent     = document.getElementById('mobile-owned-percent');
    // ✅ 不足カード種類数（最大枚数に達していない種類）
    // 通常カード：3枚 / 旧神：1枚
    const missingTypes = (() => {
      const S = window.OwnedStore;

      // OwnedStore が無い/未初期化なら「未所持扱い」で全種類不足
      if (!S || typeof S.get !== 'function') return s.totalTypes | 0;

      let n = 0;
      allCards.forEach(cardEl => {
        const cd = cardEl?.dataset?.cd;
        if (!cd) return;

        const e = S.get(String(cd));
        const own = (e?.normal | 0) + (e?.shine | 0) + (e?.premium | 0);

        const race = cardEl?.dataset?.race || '';
        const max = (race === '旧神') ? 1 : 3;

        if (own < max) n++;
      });
      return n;
    })();

    // モバイルの不足カードボタン
    const missBtnMobile = document.getElementById('show-missing-all-mobile');
    if (missBtnMobile) missBtnMobile.dataset.count = String(missingTypes);

    // PC側にもボタンがあるなら
    const missBtnPc = document.getElementById('show-missing-all');
    if (missBtnPc) missBtnPc.dataset.count = String(missingTypes);

    if (moTypeCount)   moTypeCount.textContent = s.ownedTypes;
    if (moTypeTotal)   moTypeTotal.textContent = s.totalTypes;
    if (moTypePercent) moTypePercent.textContent = `${s.typePercentText}%`;
    if (moPercent)     moPercent.textContent = `${s.percentText}%`;
    if (moOwned)       moOwned.textContent = s.owned;
    if (moTotal)       moTotal.textContent = s.total;

    // モバイル共有リンク（選択中パックを優先、なければ全体）
    const mobileTweet = document.getElementById('mobile-tweet-link');
    if (mobileTweet){
        const selKey = (document.getElementById('pack-selector')||{}).value;
        let mtxt;

        if (selKey && selKey !== 'all') {
            const selPack = Array.isArray(window.packs) ? window.packs.find(p=>p.key===selKey) : null;
            if (selPack){
            const selCards = window.queryCardsByPack(selPack);
            const sum = calcSummary(selCards);
            mtxt = window.buildShareText({ header: selPack.nameMain, sum });
            }
        }

        if (!mtxt) mtxt = window.buildShareText({ header: '全カード', sum: s });
        mobileTweet.href = `https://twitter.com/intent/tweet?text=${mtxt}`;
        }

    }

    // モバイルのパックサマリーHTMLを返す
    function renderMobilePackSummaryHTML(s){
      return `
        <div class="pack-meters">
          <div class="meter">
            <div class="meter-label">所持率</div>
            <div class="meter-track" role="progressbar"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.typePercent}">
              <span class="meter-bar -own" style="width:${s.typePercentText}%"></span>
            </div>
            <div class="meter-val">
              <span class="meter-frac">${s.ownedTypes}/${s.totalTypes}</span>
              <span class="meter-pct">(${s.typePercentText}%)</span>
            </div>
          </div>

          <div class="meter">
            <div class="meter-label">コンプ率</div>
            <div class="meter-track" role="progressbar"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.percent}">
              <span class="meter-bar -comp" style="width:${s.percentText}%"></span>
            </div>
            <div class="meter-val">
              <span class="meter-frac">${s.owned}/${s.total}</span>
              <span class="meter-pct">(${s.percentText}%)</span>
            </div>
          </div>
        </div>`;
    }



// 各パック所持率を更新する
function updatePackSummary(){
  const pcList = document.getElementById('pack-summary-list');
  const mobileSelect = document.getElementById('pack-selector');
  const mobileSummary = document.getElementById('mobile-pack-summary');

  // ✅ pcListが無いならPC側の生成はしない
  const hasPC = !!pcList;
  const hasMobile = !!mobileSelect || !!mobileSummary;
  if (!hasPC && !hasMobile) return;

  function getPackArray_(){
    const p = window.packs;

    if (Array.isArray(p)) return p;

    if (p && Array.isArray(p.list)) {
      return p.list.map(x => ({
        key: x.key || x.slug || x.en,
        nameMain: x.en || x.nameMain || '',
        nameSub:  x.jp || x.nameSub || '',
        selector: x.selector || `#pack-${x.slug || x.key || ''}`,
      }));
    }

    if (p && Array.isArray(p.packs)) {
      return p.packs.map(x => ({
        key: x.key || x.slug || x.en,
        nameMain: x.en || x.nameMain || '',
        nameSub:  x.jp || x.nameSub || '',
        selector: x.selector || `#pack-${x.slug || x.key || ''}`,
      }));
    }

    return [];
  }

  // queryCardsByPack が無ければ fallback
  if (typeof window.queryCardsByPack !== 'function') {
    window.queryCardsByPack = function (pack) {
      const en = (pack?.nameMain || '').trim();
      return en
        ? document.querySelectorAll(`#packs-root .card[data-pack^="${CSS.escape(en)}"]`)
        : document.querySelectorAll('#packs-root .card');
    };
  }

const packArr = getPackArray_();

// ★ 追加：通常パックに a,b,c,d,e,f... を自動割当して Map 化
const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
const isCollabOrSpecial = (pack) => {
  const key = String(pack?.key ?? '').toLowerCase();
  const nameMain = String(pack?.nameMain ?? '');
  const nameSub  = String(pack?.nameSub ?? '');
  const any = (key + ' ' + nameMain + ' ' + nameSub).toLowerCase();

  if (any.includes('コラボ') || any.includes('collab')) return 'collab';
  if (any.includes('特殊') || any.includes('special')) return 'special';
  return null;
};

const normalPacks = packArr.filter(p => !isCollabOrSpecial(p));
const normalGroupByKey = new Map();
normalPacks.forEach((p, i) => {
  normalGroupByKey.set(p.key, letters[i] || 'z'); // 27個超えたら z で妥協
});

  // ★ 追加：パックの色グループを判定する関数
  function detectPackGroup_(pack){
    const tag = isCollabOrSpecial(pack);
    if (tag) return tag;

    const k = pack?.key;
    if (k && normalGroupByKey.has(k)) return normalGroupByKey.get(k);

    // 最後の保険：分からなければ special
    return 'special';
  }


  // ✅ 並び順を制御する（A〜Z → コラボ → 特殊）
  packArr.sort((a, b) => {
    const rank = (p) => {
      const key = String(p?.key ?? '').toLowerCase();
      const nameMain = String(p?.nameMain ?? '');
      const nameSub  = String(p?.nameSub ?? '');
      const any = (key + ' ' + nameMain + ' ' + nameSub).toLowerCase();

      // A〜Z は packs.json の順を維持（idx依存なのでここでは触らない）
      // コラボ
      if (any.includes('コラボ') || any.includes('collab')) return 10;
      // 特殊
      if (any.includes('特殊')) return 20;

      return 0;
    };

    return rank(a) - rank(b);
  });

  // UI初期化
  if (pcList) pcList.innerHTML = '';

  let prev = '';
  if (mobileSelect) {
    prev = mobileSelect.value || '';
    mobileSelect.innerHTML = '';

    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = '全カード';
    mobileSelect.appendChild(optAll);
  }

  // PCパック一覧
  packArr.forEach((pack, idx) => {
    const cards = window.queryCardsByPack(pack);
    const s = calcSummary(cards);

    const wrap = document.createElement('div');
    wrap.className = 'pack-summary';


    const group = detectPackGroup_(pack);
    wrap.dataset.packGroup = group;

    // -----------------------------
    // 2) データ属性に所持率情報をセット
    // -----------------------------
    wrap.dataset.ownedTypes = String(s.ownedTypes);
    wrap.dataset.totalTypes = String(s.totalTypes);
    wrap.dataset.typePercent = String(s.typePercent);         // number
    wrap.dataset.typePercentText = String(s.typePercentText); // "64.2"

    wrap.dataset.owned = String(s.owned);
    wrap.dataset.total = String(s.total);
    wrap.dataset.percent = String(s.percent);
    wrap.dataset.percentText = String(s.percentText);

    // -----------------------------
    // 3) 表示：リンク＋パック名だけ（ゲージは card-checker-page.js が後付け）
    //    ✅ ポストボタンは作らない
    // -----------------------------
    wrap.innerHTML = `
      <a href="${pack.selector}" class="pack-summary-link">
        <span class="pack-summary-name">
          ${pack.nameMain}<br><small>${pack.nameSub || ''}</small>
        </span>
      </a>
    `;

    if (pcList) pcList.appendChild(wrap);

    // モバイルパックセレクタ
    if (mobileSelect) {
      const opt = document.createElement('option');
      opt.value = pack.key;
      opt.textContent = pack.nameMain;
      mobileSelect.appendChild(opt);
    }
  });

    // ✅ PC側：パック名クリックは「jumpToPack」でスクロール（hashのデフォルト挙動を殺す）
  if (pcList && !pcList.dataset.wiredPackJump) {
    pcList.dataset.wiredPackJump = '1';

    pcList.addEventListener('click', (e) => {
      const a = e.target.closest('a.pack-summary-link');
      if (!a) return;

      // ✅ これが無いと hash のデフォルト移動で「一回上に戻る」等が起きる
      e.preventDefault();
      e.stopPropagation();

      // href="#pack-xxxx" から slug を取り出す
      const href = a.getAttribute('href') || '';
      const m = href.match(/^#pack-(.+)$/);
      const slug = m ? m[1] : '';

      if (!slug) return;

      // ✅ 既存の補正ジャンプ（top-bar分のオフセット等）を使う
      if (typeof window.jumpToPack === 'function') {
        window.jumpToPack(slug);
      } else {
        // フォールバック：最低限のジャンプ
        const el = document.getElementById(`pack-${slug}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, { passive: false });
  }

  // mobile: 選択値を復元（なければ all）
  if (mobileSelect) {
    if (prev && [...mobileSelect.options].some(o => o.value === prev)) mobileSelect.value = prev;
    else mobileSelect.value = 'all';
  }

  // mobile: 現在選択中パックの概要
  if (mobileSelect && mobileSummary) {
    const key = mobileSelect.value || 'all';
    let s;

    if (key === 'all') {
      const all = document.querySelectorAll('#packs-root .card');
      s = calcSummary(all);
    } else {
      const sel = packArr.find(p => p.key === key) || packArr[0];
      const cards = window.queryCardsByPack(sel);
      s = calcSummary(cards);
    }

    mobileSummary.innerHTML = renderMobilePackSummaryHTML(s);

    const jumpBtn = document.getElementById('jump-pack-btn');
    if (jumpBtn) jumpBtn.style.display = (key==='all' ? 'none' : 'inline-block');
  }
}



  // 全体と各パックサマリーをまとめて更新
    function updateSummary(){
        updateOverallSummary();
        updatePackSummary();
        updateRaceSummary();
        updateRaritySummary();
        window.dispatchEvent(new Event('summary:updated'));
    }

    // グローバルに公開
    window.Summary = {
        calcSummary,
        updateOverallSummary,
        updatePackSummary,
        updateRaceSummary,
        updateRaritySummary,
        renderMobilePackSummaryHTML,
        updateSummary,
    };

    // ✅ 互換エイリアス：古いコードが updateSummary() を呼んでも落ちないようにする
    if (typeof window.updateSummary !== 'function') {
        window.updateSummary = function () {
        try { return window.Summary?.updateSummary?.(); } catch (e) { console.warn(e); }
        };
    }
})();



