/**
 * js/ui/card-detail-template.js
 * - 図鑑/所持率などで使う「詳細HTMLテンプレ」を提供
 * - card-detail.js の buildDetailElementFallback_ と同じDOM構造に寄せる
 * - card-list.js 互換のため window.generateDetailHtml を公開する
 */
(function () {
  'use strict';

  function generateDetailHtml(card) {
    const cd = String(card.cd ?? '').padStart(5, '0');

    const name = (card.name ?? '');
    const type = (card.type ?? '');
    const race = (card.race ?? '');
    const category = (card.category ?? '');
    const packName = (card.packName ?? card.pack_name ?? '');

    const en1 = (card.effect_name1 ?? '');
    const et1 = (card.effect_text1 ?? '');
    const en2 = (card.effect_name2 ?? '');
    const et2 = (card.effect_text2 ?? '');

    const effectParts = [];
    if (en1) effectParts.push(`<div><strong class="effect-name">${escapeHtml_(en1)}</strong></div>`);
    if (et1) effectParts.push(`<div>${escapeHtml_(et1)}</div>`);
    if (en2) effectParts.push(`<div><strong class="effect-name">${escapeHtml_(en2)}</strong></div>`);
    if (et2) effectParts.push(`<div>${escapeHtml_(et2)}</div>`);
    const effectHtml = effectParts.join('\n') || `<div>（効果情報なし）</div>`;

    const typeClass = type ? `type-${type}` : '';
    const raceClass = race ? `race-${race}` : '';

    return `
      <div class="card-detail ${typeClass} ${raceClass}"
           data-name="${escapeAttr_(name)}"
           id="detail-${cd}"
           data-cd="${cd}"
           data-race="${escapeAttr_(race)}"
           style="display: none;">
        <div class="card-name">${escapeHtml_(name)}</div>
        <div class="card-meta card-pack">
          ${escapeHtml_(packName)}
        </div>
        <div class="card-meta">
          <span class="card-race">${escapeHtml_(race)}</span> /
          <span class="card-category">${escapeHtml_(category)}</span>
        </div>
        <div class="card-effect">
          ${effectHtml}
        </div>
      </div>
    `.trim();
  }

  // 属性用（& < > " 対策）
  function escapeAttr_(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // テキスト用（最低限）
  function escapeHtml_(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // 互換公開（card-list.js / cardsViewMode.js がこれを呼ぶ）
  window.generateDetailHtml = generateDetailHtml;
  window.CardDetailTemplate = window.CardDetailTemplate || {};
  window.CardDetailTemplate.generate = generateDetailHtml;
})();
