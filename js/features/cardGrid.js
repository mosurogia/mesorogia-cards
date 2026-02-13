/* =========================================================
 * common/cardGrid.js
 * 目的:
 *  - .card 要素の生成を共通化（図鑑 / デッキメーカー / 所持率）
 *
 * 提供:
 *  - window.CardUI.createCardElement(card, opts)
 *  - window.generateCardListElement(card)  // 互換 alias（図鑑向け）
 *
 * 依存:
 *  - common/card-core.js（fetchLatestCards / ensureCardMapLoaded など）
 * ======================================================= */

(function(){
    'use strict';

    // ---------- data-* 付与（検索・フィルタ・詳細用） ----------
    function setData_(el, key, val){
        if (val === undefined || val === null) return;
        el.setAttribute(key, String(val));
    }

    function flagToStr_(v){
        return String(v ?? '').toLowerCase();
    }

    function buildKeywords_(card){
        return [
        card.name, card.race, card.category, card.type,
        card.field, card.special_ability,
        card.effect_name1, card.effect_text1,
        card.effect_name2, card.effect_text2
        ].filter(Boolean).join(' ').toLowerCase();
    }

    /**
     * 単一カードのカード要素（.card）を生成して返す（共通）
     *
     * opts:
     *  - mode: 'list' | 'deck' | 'checker'（挙動のデフォルトが変わる）
     *  - onImageClick: (card, e) => void
     *  - onCardClick : (card, e) => void
     *  - enableZoomBtn: boolean（デフォルト true）
     *  - enableOwnedMark: boolean（デフォルト true）
     */
    function createCardElement(card, opts = {}){
        const mode = opts.mode || 'list';

        const cardDiv = document.createElement('div');
        cardDiv.classList.add('card');

        // ---------- data-*（page1 / page2 の差分を吸収） ----------
        setData_(cardDiv, 'data-cd', card.cd);
        setData_(cardDiv, 'data-name', card.name);
        setData_(cardDiv, 'data-effect1', card.effect_name1 ?? '');
        setData_(cardDiv, 'data-effect2', card.effect_name2 ?? '');
        setData_(cardDiv, 'data-effecttext1', card.effect_text1 ?? '');
        setData_(cardDiv, 'data-effecttext2', card.effect_text2 ?? '');
        setData_(cardDiv, 'data-race', card.race ?? '');
        setData_(cardDiv, 'data-category', card.category ?? '');
        setData_(cardDiv, 'data-rarity', card.rarity ?? '');
        setData_(cardDiv, 'data-type', card.type ?? '');
        setData_(cardDiv, 'data-cost', card.cost ?? '');
        setData_(cardDiv, 'data-power', card.power ?? '');
        setData_(cardDiv, 'data-pack', (card.packName ?? card.pack_name ?? ''));

        // 効果まとめ（検索用）
        const effectJoined = [card.effect_name1, card.effect_text1, card.effect_name2, card.effect_text2]
        .filter(Boolean).join(' ');
        setData_(cardDiv, 'data-effect', effectJoined);

        setData_(cardDiv, 'data-field', card.field ?? '');
        setData_(cardDiv, 'data-ability', card.special_ability ?? '');

        // フラグ系
        setData_(cardDiv, 'data-bp', flagToStr_(card.BP_flag));
        setData_(cardDiv, 'data-draw', flagToStr_(card.draw));
        setData_(cardDiv, 'data-graveyard_recovery', flagToStr_(card.graveyard_recovery));
        setData_(cardDiv, 'data-cardsearch', flagToStr_(card.cardsearch));
        setData_(cardDiv, 'data-destroy_opponent', flagToStr_(card.destroy_opponent));
        setData_(cardDiv, 'data-destroy_self', flagToStr_(card.destroy_self));
        setData_(cardDiv, 'data-heal', flagToStr_(card.heal));
        setData_(cardDiv, 'data-power_up', flagToStr_(card.power_up));
        setData_(cardDiv, 'data-power_down', flagToStr_(card.power_down));

        // ★互換（過去に page1 側で data-destroy_Opponent / data-destroy_Self を付けていた）
        setData_(cardDiv, 'data-destroy_Opponent', flagToStr_(card.destroy_opponent));
        setData_(cardDiv, 'data-destroy_Self', flagToStr_(card.destroy_self));

        // リンクカード（性能リンク/コラボ対応）
        if (typeof card.link !== 'undefined') setData_(cardDiv, 'data-link', flagToStr_(card.link));
        if (typeof card.link_cd !== 'undefined') setData_(cardDiv, 'data-linkcd', card.link_cd);

        // キーワード（簡易全文検索用）
        setData_(cardDiv, 'data-keywords', buildKeywords_(card));

        // ---------- UI ----------
       // 🔎ボタン（zoom-btn）
        // - deck: 表示
        // - list/checker: “要素は作るが普段は非表示”（グループ編集などで表示するため）
        const defaultZoomVisible = (mode === 'deck');
        const forceCreateZoomBtn = (mode === 'list' || mode === 'checker'); // ✅ 常設
        const enableZoomBtn =
          ('enableZoomBtn' in opts)
            ? !!opts.enableZoomBtn
            : (defaultZoomVisible || forceCreateZoomBtn);

        if (enableZoomBtn) {
            const zoomBtn = document.createElement('div');
            zoomBtn.classList.add('zoom-btn');
            zoomBtn.innerText = '🔎';
            // ✅ list/checker は普段非表示（CSSで編集時だけ表示してもOK）
            if (mode !== 'deck') zoomBtn.style.display = 'none';
            zoomBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // ✅ window 経由で確実に呼ぶ（スコープ問題を潰す）
            if (typeof window.handleZoomClick === 'function') {
                window.handleZoomClick(e, zoomBtn);
            } else if (window.CardDetailUI?.handleZoomClick) {
                window.CardDetailUI.handleZoomClick(e, zoomBtn);
            } else {
                console.warn('handleZoomClick が未ロードです（card-detail.js の読み込み順を確認）');
            }
});
            cardDiv.appendChild(zoomBtn);
        }

        const enableOwnedMark = (opts.enableOwnedMark !== false);
        if (enableOwnedMark){
            const ownedMark = document.createElement('div');
            ownedMark.classList.add('owned-mark');
            ownedMark.style.display = 'none'; // common/owned.js が制御
            cardDiv.appendChild(ownedMark);
        }

        // 画像
        const img = document.createElement('img');
        img.alt = card.name || '';

        // ✅ 追加/強化（イベントより前、srcより前に入れる）
        img.loading = (mode === 'deck') ? 'eager' : 'lazy';
        img.decoding = 'async';

        // ✅ レイアウト確定を早くしてガタつきを減らす
        img.width = 240;
        img.height = 336;

        // ✅ 体感改善（対応ブラウザのみ）
        try {
        img.fetchPriority = (mode === 'deck') ? 'high' : 'low';
        } catch {}

        // （任意）キャッシュ条件のブレを減らす
        img.referrerPolicy = 'no-referrer-when-downgrade';

        // ✅ src は最後に
        img.src = `img/${card.cd}.webp`;

        img.addEventListener('error', () => {
        if (img.dataset.fallbackApplied) return;
        img.dataset.fallbackApplied = '1';
        img.src = 'img/00000.webp';
        });

        // modeによるデフォルト挙動
        // - deck: 左クリックで addCard、右クリックで removeCard
        // - list/checker: 画像クリックは何もしない（必要なら opts.onImageClick）
        if (mode === 'deck'){
        // 左クリック（追加）
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof opts.onImageClick === 'function') return opts.onImageClick(card, e);
            if (typeof window.addCard === 'function') window.addCard(card.cd);
        });

        // 右クリック（削除）
        img.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof opts.onImageRightClick === 'function') return opts.onImageRightClick(card, e);
            if (typeof window.removeCard === 'function') window.removeCard(card.cd);
        });

        img.addEventListener('dblclick', (e) => e.preventDefault());

        } else if (typeof opts.onImageClick === 'function'){
        img.addEventListener('click', (e) => { e.stopPropagation(); opts.onImageClick(card, e); });
        }

        cardDiv.appendChild(img);


        // カード全体クリック（必要なら外から注入）
        if (typeof opts.onCardClick === 'function'){
        cardDiv.addEventListener('click', (e) => opts.onCardClick(card, e));
        } else if (mode === 'list'){
        // page1 互換：カードタップでズーム（inline onclick を廃止）
        cardDiv.addEventListener('click', (e) => {
            if (typeof window.handleZoomClick === 'function') window.handleZoomClick(e, cardDiv);
        });
        }

        return cardDiv;
    }

    // 互換：既存コードが generateCardListElement(card) を呼ぶため alias を残す
    function generateCardListElement(card){
        return createCardElement(card, { mode: 'list' });
    }

    // グローバル公開
    window.CardUI = window.CardUI || {};
    window.CardUI.createCardElement = window.CardUI.createCardElement || createCardElement;
    window.generateCardListElement = window.generateCardListElement || generateCardListElement;
})();



