/* =========================
 * js/common/core/app-helpers.js
 * - UI寄りの共通機能 / API / footer 等
 * ========================= */

// ========================
// ページトップ移動ボタン
// ========================
window.scrollToTop = window.scrollToTop || function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ========================
// data-source-badge ツールチップ
// ========================
(function () {
    let tooltipEl = null;
    let tooltipTarget = null;

    function ensureTooltipEl_() {
        if (tooltipEl && document.body.contains(tooltipEl)) return tooltipEl;
        const el = document.createElement('div');
        el.id = 'data-source-badge-tooltip';
        el.setAttribute('role', 'tooltip');
        document.body.appendChild(el);
        tooltipEl = el;
        return el;
    }

    function hideTooltip_() {
        tooltipTarget = null;
        const el = tooltipEl || document.getElementById('data-source-badge-tooltip');
        if (!el) return;
        el.classList.remove('is-show');
        el.textContent = '';
    }

    function positionTooltip_(anchor) {
        const el = ensureTooltipEl_();
        const rect = anchor.getBoundingClientRect();
        const gap = 8;
        const margin = 12;
        const maxWidth = Math.min(280, Math.max(160, window.innerWidth - margin * 2));
        el.style.width = `${maxWidth}px`;
        el.style.maxWidth = `${Math.max(160, window.innerWidth - margin * 2)}px`;

        const tipRect = el.getBoundingClientRect();
        const left = Math.min(
            Math.max(margin, rect.left),
            Math.max(margin, window.innerWidth - tipRect.width - margin)
        );
        const topAbove = rect.top - tipRect.height - gap;
        const topBelow = rect.bottom + gap;
        const top = topAbove >= margin
            ? topAbove
            : Math.min(topBelow, Math.max(margin, window.innerHeight - tipRect.height - margin));

        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
    }

    function showTooltip_(anchor) {
        const text = String(anchor?.dataset?.tooltip || '').trim();
        if (!text) return;
        tooltipTarget = anchor;
        const el = ensureTooltipEl_();
        el.textContent = text;
        positionTooltip_(anchor);
        el.classList.add('is-show');
    }

    function bindTooltip_() {
        if (document.body.dataset.dataSourceTooltipBound === '1') return;
        document.body.dataset.dataSourceTooltipBound = '1';

        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('.data-source-badge[data-tooltip]');
            if (!target) return;
            showTooltip_(target);
        });

        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest('.data-source-badge[data-tooltip]');
            if (!target) return;
            if (target.contains(e.relatedTarget)) return;
            hideTooltip_();
        });

        document.addEventListener('focusin', (e) => {
            const target = e.target.closest('.data-source-badge[data-tooltip]');
            if (!target) return;
            showTooltip_(target);
        });

        document.addEventListener('focusout', (e) => {
            const target = e.target.closest('.data-source-badge[data-tooltip]');
            if (!target) return;
            if (target.contains(e.relatedTarget)) return;
            hideTooltip_();
        });

        document.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.data-source-badge[data-tooltip]')) return;
            hideTooltip_();
        });

        document.addEventListener('scroll', () => {
            if (!tooltipTarget) return;
            hideTooltip_();
        }, { passive: true, capture: true });

        window.addEventListener('resize', () => {
            if (!tooltipTarget) return;
            positionTooltip_(tooltipTarget);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindTooltip_, { once: true });
    } else {
        bindTooltip_();
    }
    window.__DataSourceBadgeTooltip = window.__DataSourceBadgeTooltip || {
        show: showTooltip_,
        hide: hideTooltip_,
        reposition: () => {
            if (!tooltipTarget) return;
            positionTooltip_(tooltipTarget);
        },
    };
})();

// ========================
// キャンペーン
// ========================
(function () {
    let _campCache = { t: 0, v: null };

    window.fetchActiveCampaign = async function fetchActiveCampaign(opts = {}) {
        const ttlMs = Number(opts.ttlMs || 30000);
        const now = Date.now();

        if (_campCache.v && (now - _campCache.t) < ttlMs) return _campCache.v;

        const base = window.DECKPOST_API_BASE || window.GAS_API_BASE;
        if (!base) return null;

        try {
            const res = await fetch(`${base}?mode=campaignGetActive`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: JSON.stringify({}),
            });

            const json = await res.json();
            const camp = json && json.ok ? (json.campaign || null) : null;

            _campCache = { t: now, v: camp };
            return camp;
        } catch (_) {
            return null;
        }
    };
})();

// ========================
// フッター：フィードバックURL自動付与
// フォームのURLを直接埋めるとGoogle側でスパムと判定されるため、jsで動的に生成してセットする
// ========================
(function () {
    const FORM_ID = '1FAIpQLSdB-MkMc0AxNWdlZ1PX-62nj-wINtn0C34-Pj4ykXwceAWtEg';
    const FORM_BASE = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform?usp=pp_url`;
    const ENTRY_URL = 'entry.1634483845';

    function buildFeedbackUrl_() {
        const u = new URL(FORM_BASE);
        u.searchParams.set(ENTRY_URL, location.href);
        return u.toString();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const a = document.querySelector('a.footer-feedback');
        if (a) a.href = buildFeedbackUrl_();
    });
})();

// ========================
// 画像生成中オーバーレイ
// ========================
(function () {
    function showDeckImageLoadingOverlay(message) {
        document.getElementById('deckimg-loading-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'deckimg-loading-overlay';
        overlay.className = 'deckimg-loading-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            zIndex: 99999,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(0,0,0,.45)',
            backdropFilter: 'blur(2px)',
            color: '#fff',
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif',
        });

        const box = document.createElement('div');
        Object.assign(box.style, {
            background: 'rgba(20,20,28,.9)',
            border: '1px solid rgba(255,255,255,.12)',
            borderRadius: '14px',
            padding: '18px 22px',
            boxShadow: '0 8px 24px rgba(0,0,0,.4)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '18px',
        });

        const spinner = document.createElement('div');
        Object.assign(spinner.style, {
            width: '18px',
            height: '18px',
            borderRadius: '999px',
            border: '3px solid rgba(255,255,255,.2)',
            borderTopColor: '#fff',
            animation: 'deckimg-spin 0.9s linear infinite',
        });

        const text = document.createElement('div');
        text.textContent = message || '生成中…';

        box.appendChild(spinner);
        box.appendChild(text);
        overlay.appendChild(box);

        const style = document.createElement('style');
        style.textContent = '@keyframes deckimg-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';
        overlay.appendChild(style);

        document.body.appendChild(overlay);
        return overlay;
    }

    function hideDeckImageLoadingOverlay(overlay) {
        if (!overlay) return;
        overlay.remove();
    }

    window.__DeckImgLoading = window.__DeckImgLoading || {
        show: showDeckImageLoadingOverlay,
        hide: hideDeckImageLoadingOverlay,
    };
})();

// ========================
// 画像プレビュー
// ========================
(function () {
    function closeDeckImagePreviewModal() {
        document.getElementById('deckimg-preview-modal')?.remove();
        document.body.style.overflow = '';
    }

    async function shareDeckImage_(dataUrl, fileName) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], fileName, { type: 'image/png' });
        if (!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }))) {
            throw new Error('share_not_supported');
        }
        await navigator.share({ files: [file] });
    }

    function buildDeckImageHint_() {
        const ua = String(navigator.userAgent || '').toLowerCase();
        if (/iphone|ipad|ipod/.test(ua)) return '長押しして「写真に保存」や「共有」から保存できます。';
        if (/android/.test(ua)) return '長押しして「画像をダウンロード」や「共有」から保存できます。';
        return '画像を右クリックして保存できます。';
    }

    function showDeckImgPreviewModal(canvas, fileName) {
        if (!(canvas instanceof HTMLCanvasElement)) return;

        const dataUrl = canvas.toDataURL('image/png');
        closeDeckImagePreviewModal();

        const modal = document.createElement('div');
        modal.id = 'deckimg-preview-modal';
        Object.assign(modal.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '9999',
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            overflowY: 'auto',
            padding: '40px 0',
            color: '#fff',
            fontFamily: 'system-ui, sans-serif',
        });
        document.body.style.overflow = 'hidden';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = '×';
        Object.assign(closeButton.style, {
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'rgba(255,255,255,0.9)',
            color: '#111',
            border: 'none',
            borderRadius: '50%',
            width: '36px',
            height: '36px',
            fontSize: '22px',
            fontWeight: '700',
            lineHeight: '1',
            cursor: 'pointer',
            boxShadow: '0 0 6px rgba(0,0,0,0.3)',
        });
        closeButton.addEventListener('click', closeDeckImagePreviewModal);
        modal.appendChild(closeButton);

        const hintBar = document.createElement('div');
        Object.assign(hintBar.style, {
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            margin: '15px',
            fontSize: 'clamp(14px, 2vw, 18px)',
            textAlign: 'center',
        });

        const hint = document.createElement('div');
        hint.textContent = buildDeckImageHint_();
        hintBar.appendChild(hint);

        const buttonBar = document.createElement('div');
        Object.assign(buttonBar.style, {
            width: 'min(80vw, 500px)',
            maxWidth: 'min(80vw, 500px)',
            display: 'flex',
            gap: '8px',
            margin: '8px auto 12px',
        });

        const createActionButton_ = (label) => {
            const button = document.createElement('a');
            button.textContent = label;
            Object.assign(button.style, {
                flex: '1 1 0',
                display: 'inline-block',
                textAlign: 'center',
                textDecoration: 'none',
                background: '#fff',
                color: '#111',
                padding: '10px 12px',
                borderRadius: '10px',
                fontWeight: '800',
                fontSize: '14px',
                boxShadow: '0 2px 8px rgba(0,0,0,.25)',
            });
            return button;
        };

        const saveButton = createActionButton_('ダウンロード');
        saveButton.href = dataUrl;
        saveButton.download = fileName;

        const shareButton = createActionButton_('共有');
        shareButton.href = 'javascript:void(0)';
        const ua = String(navigator.userAgent || '').toLowerCase();
        const isIos = /iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && (navigator.maxTouchPoints || 0) >= 2);
        const isAndroid = /android/.test(ua);
        if (!(isIos || isAndroid)) {
            shareButton.style.display = 'none';
        } else {
            shareButton.onclick = async () => {
                try {
                    await shareDeckImage_(dataUrl, fileName);
                } catch (_) {
                    alert('この端末では画像共有に対応していません。ダウンロードしてご利用ください。');
                }
            };
        }

        buttonBar.appendChild(saveButton);
        buttonBar.appendChild(shareButton);
        modal.appendChild(hintBar);
        modal.appendChild(buttonBar);

        const image = document.createElement('img');
        image.src = dataUrl;
        image.alt = fileName || '画像プレビュー';
        Object.assign(image.style, {
            maxWidth: 'min(80vw, 500px)',
            height: 'auto',
            borderRadius: '12px',
            boxShadow: '0 0 24px rgba(0,0,0,0.6)',
            objectFit: 'contain',
        });
        modal.appendChild(image);

        const note = document.createElement('div');
        note.textContent = 'ここで生成した画像はXやDiscordなどにそのまま共有できます。';
        Object.assign(note.style, {
            width: 'min(80vw, 500px)',
            maxWidth: 'min(80vw, 500px)',
            fontSize: 'clamp(12px, 1.8vw, 14px)',
            color: 'rgba(255,255,255,0.8)',
            textAlign: 'center',
            margin: '10px auto 16px',
        });
        modal.appendChild(note);

        modal.addEventListener('click', (event) => {
            if (event.target === modal && event.clientY < window.innerHeight * 0.9) {
                closeDeckImagePreviewModal();
            }
        });

        document.body.appendChild(modal);
    }

    window.showDeckImgPreviewModal = window.showDeckImgPreviewModal || showDeckImgPreviewModal;
})();
