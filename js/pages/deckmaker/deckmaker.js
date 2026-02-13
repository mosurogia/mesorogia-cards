/* =========================
 * pages/deckmaker.js
 * - デッキメーカー専用：カード要素生成を deck モードに寄せる
 * - 左クリック：追加 / 右クリック：削除 / 🔎：詳細
 * ========================= */

(function(){
    'use strict';

    // cardGrid.js が先に読み込まれている前提
    function generateCardListElementDeck(card){
        if (!window.CardUI?.createCardElement){
        // 何かの順序ミスでも落ちないように
        const div = document.createElement('div');
        div.className = 'card';
        return div;
        }

        return window.CardUI.createCardElement(card, {
        mode: 'deck',
        enableZoomBtn: true,
        enableOwnedMark: true,
        // 左クリックは cardGrid.js のデフォルト addCard に任せる（必要ならここで上書き可能）
        // onImageClick: (card,e)=> window.addCard?.(card.cd),

        // 右クリック削除（removeCard が page2.js にある）
        onImageRightClick: (card, e) => {
            window.removeCard?.(card.cd);
        },
        });
    }

    // デッキメーカーではこちらを優先させる
    window.generateCardListElement = generateCardListElementDeck;
})();



window.addEventListener('DOMContentLoaded', async () => {
    const grid = document.getElementById('grid');
    if (!grid) return;

    // カードマスタ確実に読み込み
    const cardMap = await window.ensureCardMapLoaded?.();
    let cards = cardMap ? Object.values(cardMap) : null;

    // ✅ cardMap が軽量版で pack/flag が欠けている場合はフルデータへフォールバック
    const needsFull =
    !cards || !cards.length ||
    (cards[0].pack_name == null) ||
    (cards[0].field == null) ||
    (cards[0].special_ability == null) ||
    (cards[0].BP_flag == null);

    if (needsFull) {
    cards = await window.fetchLatestCards();
    }

    grid.innerHTML = '';

    const frag = document.createDocumentFragment();

    for (const card of cards) {
    const el = window.CardUI?.createCardElement
        ? window.CardUI.createCardElement(card, { mode: 'deck' })
        : window.generateCardListElement(card);

    frag.appendChild(el);
    }

    grid.appendChild(frag);


    // ✅ 生成後に card-core のソートを適用
    window.sortCards?.();

    // 生成直後にフィルター・ソート・所持表示を確定する
    // DOM が描画された1フレーム後にまとめて実行（初期化順事故防止）
    requestAnimationFrame(() => {
    try {
        window.applyFilters?.();        // 表示/非表示の確定
        window.sortCards?.();           // card-core準拠の並び順に確定
        window.refreshOwnedOverlay?.(); // 所持オーバーレイ追従
    } catch (e) {
        console.warn('初期確定処理に失敗しました', e);
    }
    });
});
