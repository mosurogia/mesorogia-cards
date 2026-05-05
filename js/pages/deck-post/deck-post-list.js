/* ==================================================
 * js/pages/deck-post/deck-post-list.js
 * - 投稿一覧取得 / マイ投稿取得 / ページング / 再読込制御
 * - 一覧カード描画
================================================== */

(function () {
  'use strict';

  // =========================
  // 0) 定数
  // =========================
  // 1ページあたりの件数（UI表示用）
  const PAGE_LIMIT = 10;

  // 一覧データをまとめて取得するときの1リクエスト上限
  const FETCH_LIMIT = 100;
  let allListFetchPromise_ = null;

  function wait_(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * いいねボタンの中身を作る
   */
  function buildLikeButtonContent_(liked, likeCount) {
    return `${liked ? '★' : '☆'}${Number(likeCount || 0)}`;
  }

  /**
   * 共有URL時は初回から全件取得に切り替える
   */
  function shouldLoadAllItemsInitially_() {
    try {
      const sp = new URLSearchParams(window.location.search || '');
      return !!(sp.get('pid') || sp.get('post'));
    } catch (_) {
      return false;
    }
  }

  /**
   * フィルターボタンの準備状態を表示する
   */
  function updateFilterReadyState_() {
    const btn = document.getElementById('filterBtn');
    if (!btn) return;

    const state = getDeckPostState_();
    const ready = !!state?.list?.hasAllItems;
    const loading = !ready;

    btn.disabled = !ready;
    btn.dataset.loading = loading ? '1' : '0';
    btn.textContent = ready ? 'フィルター' : 'フィルター準備中…';
    btn.title = ready
      ? '全投稿を対象にフィルターできます'
      : '全投稿の読み込み完了後に使えます';
    btn.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  /**
   * マイページボタンの読み込み状態を表示する
   */
  function setToMineButtonLoading_(loading) {
    const btn = document.getElementById('toMineBtn');
    if (!btn) return;

    btn.disabled = !!loading;
    btn.dataset.loading = loading ? '1' : '0';
    btn.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  // =========================
  // 1) state / 外部参照
  // =========================
  /**
   * DeckPostState 取得
   */
  function getDeckPostState_() {
    return window.DeckPostState.getState();
  }

  /**
   * マイ投稿キャッシュ有効判定
   */
  function hasValidMineCache_() {
    return window.DeckPostState.hasValidMineCache();
  }

  /**
   * detail 側の公開API取得
   */
  function detail() {
    return window.DeckPostDetail || {};
  }

  /**
   * 右詳細に合わせて左一覧のスクロール上限を調整
   */
  function updateListMaxHeightFromPane_(layoutId, paneId) {
    const layout = document.getElementById(layoutId);
    const pane = document.getElementById(paneId);
    const master = layout?.querySelector('.post-master-column');
    const list = master?.querySelector('.post-list');

    if (!layout || !pane || !master || !list) return;

    if (!window.matchMedia('(min-width: 1024px)').matches) {
      layout.style.removeProperty('--post-list-max-height');
      return;
    }

    const topFooter = master.querySelector('.list-footer--top');
    const bottomFooter = master.querySelector('.list-footer--bottom');
    const paneContent =
      pane.querySelector('.post-detail-inner') ||
      pane.querySelector('.post-detail-empty') ||
      pane.firstElementChild ||
      pane;
    const paneHeight = Math.ceil(paneContent.getBoundingClientRect().height);
    const reservedHeight =
      (topFooter?.offsetHeight || 0) +
      (bottomFooter?.offsetHeight || 0) +
      24;
    const nextMaxHeight = Math.max(320, paneHeight - reservedHeight);

    layout.style.setProperty('--post-list-max-height', `${nextMaxHeight}px`);
  }

  /**
   * 左右カラム高さの同期を初期化
   */
  function bindListPaneHeightSync_() {
    if (window.__deckPostPaneHeightSyncBound) return;
    window.__deckPostPaneHeightSyncBound = true;

    const targets = [
      { layoutId: 'postMainLayout', paneId: 'postDetailPane' },
      { layoutId: 'mineMainLayout', paneId: 'postDetailPaneMine' },
    ];

    const refresh = () => {
      window.requestAnimationFrame(() => {
        targets.forEach(({ layoutId, paneId }) => {
          updateListMaxHeightFromPane_(layoutId, paneId);
        });
      });
    };

    refresh();
    window.addEventListener('resize', refresh, { passive: true });
    window.addEventListener('orientationchange', refresh, { passive: true });

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        refresh();
      });

      targets.forEach(({ layoutId, paneId }) => {
        const layout = document.getElementById(layoutId);
        const pane = document.getElementById(paneId);
        const master = layout?.querySelector('.post-master-column');
        const topFooter = master?.querySelector('.list-footer--top');
        const bottomFooter = master?.querySelector('.list-footer--bottom');

        if (pane) observer.observe(pane);
        if (topFooter) observer.observe(topFooter);
        if (bottomFooter) observer.observe(bottomFooter);
      });

      window.__deckPostPaneHeightSyncObserver = observer;
    }
  }

  // =========================
  // 2) 一覧描画補助
  // =========================

  /**
   * レアリティ構成の簡易統計
   */
  function buildRarityStats(item) {
    const D = detail();
    return {
      rarityText: D.buildRarityMixText_?.(item) || '',
    };
  }

  /**
   * パック構成テキスト
   */
  function buildPackMixText_(item) {
    const D = detail();
    const deck = D.extractDeckMap?.(item);
    const cardMap = window.cardMap || {};
    if (!deck || !Object.keys(deck).length || !cardMap) return '';

    const counts = Object.create(null);
    let unknown = 0;

    for (const [cd, nRaw] of Object.entries(deck)) {
      const n = Number(nRaw || 0) || 0;
      if (!n) continue;

      const cd5 = window.normCd5 ? window.normCd5(cd) : String(cd).padStart(5, '0');
      const packName =
        (cardMap[cd5] || {}).pack_name ||
        (cardMap[cd5] || {}).packName ||
        '';
      const en = D.packNameEn_?.(packName) || '';

      if (en) {
        counts[en] = (counts[en] || 0) + n;
      } else {
        unknown += n;
      }
    }

    const keys = Object.keys(counts);
    if (!keys.length && !unknown) return '';

    const order = D.getPackOrder_?.() || [];
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

    const parts = keys.map((k) => `${k} ${counts[k]}枚`);
    if (unknown) parts.push(`UNKNOWN ${unknown}枚`);

    return parts.join(' / ');
  }

  /**
   * 一覧カード群を描画
   */
  function renderPostListInto(targetId, items, opts = {}) {
    const box = document.getElementById(targetId);
    if (!box) return;

    box.replaceChildren();

    const frag = document.createDocumentFragment();
    (items || []).forEach((it) => {
      const node = oneCard(it, opts);
      if (node) frag.appendChild(node);
    });

    box.appendChild(frag);
  }

  // =========================
  // 3) 一覧カード描画
  // =========================
  /**
   * 1枚カードレンダリング（PC用）
   */
  function buildCardPc(item, opts = {}) {
    const D = detail();
    const listMode = opts.mode || 'list';
    const isMine = (listMode === 'mine');
    const bg = D.raceBg?.(item.races) || '';

    const tagsMain = window.DeckPostFilter?.tagChipsMain?.(item.tagsAuto, item.tagsPick) || '';
    const tagsUser = window.DeckPostFilter?.tagChipsUser?.(item.tagsUser) || '';

    const posterXRaw = String(item.posterX || '').trim();
    const posterXLabel = posterXRaw;
    const posterXUser = posterXRaw.startsWith('@')
      ? posterXRaw.slice(1)
      : posterXRaw;

    const likeCount = Number(item.likeCount || 0);
    const liked = !!item.liked;
    const favClass = liked ? ' active' : '';
    const favContent = buildLikeButtonContent_(liked, likeCount);

    const shareBtnHtml =
      `<button type="button" class="btn-post-share" data-postid="${escapeHtml(item.postId || '')}" aria-label="共有リンクをコピー">🔗</button>`;

    const headRightBtnHtml = isMine
      ? `
        <div class="post-head-actions">
          ${shareBtnHtml}
          <button class="delete-btn" type="button" data-postid="${escapeHtml(item.postId || '')}" aria-label="投稿を削除">🗑</button>
        </div>
      `
      : `
        <div class="post-head-actions">
          ${shareBtnHtml}
          <button class="fav-btn ${favClass}" type="button" aria-label="お気に入り">${favContent}</button>
        </div>
      `;

    return window.createElementFromHTML(`
      <article class="post-card post-card--pc" data-postid="${escapeHtml(item.postId || '')}" data-list-mode="${escapeHtml(listMode)}" style="${bg ? `--race-bg:${bg};` : ''}">
        <div class="sp-head">
          <div class="pc-head-left">
            ${detail().cardThumb?.(item.repImg, item.title) || ''}
          </div>

          <div class="pc-head-right">
            <div class="post-card-title">
              ${escapeHtml(item.title || '(無題)')}
            </div>

            <div class="pc-meta">
              <div class="meta-name">
                ${escapeHtml(item.posterName || item.username || '')}
                ${(item.posterName || item.username) ? `
                  <button type="button"
                    class="btn-filter-poster"
                    data-poster="${escapeHtml(item.posterName || item.username || '')}"
                    data-poster-key="${escapeHtml(window.posterKeyFromItem_?.(item) || '')}"
                    aria-label="この投稿者で絞り込む">👤</button>
                ` : ''}
              </div>

              ${posterXUser ? `
                <a class="sp-meta-x"
                  href="https://x.com/${encodeURIComponent(posterXUser)}"
                  target="_blank"
                  rel="noopener noreferrer">
                  ${escapeHtml(posterXLabel)}
                </a>
              ` : ''}

              <div class="sp-meta-date">
                ${window.fmtPostDates_?.(item) || ''}
              </div>
            </div>

            ${headRightBtnHtml}

            <div class="post-actions pc-actions">
              <button type="button" class="btn-add-compare">比較に追加</button>
            </div>
          </div>
        </div>

        <div class="post-tags-wrap">
          <div class="post-tags post-tags-main">${tagsMain}</div>
          <div class="post-tags post-tags-user">${tagsUser}</div>
        </div>
      </article>
    `);
  }

  /**
   * 1枚カードレンダリング（SP用）
   */
  function buildCardSp(item, opts = {}) {
    const D = detail();
    const listMode = opts.mode || 'list';
    const isMine = (listMode === 'mine');

    const mainRace = D.getMainRace?.(item.races) || '';
    const bg = D.raceBg?.(item.races) || '';
    const oldGod = D.getOldGodNameFromItem?.(item) || '';

    const deckNote = item.deckNote || item.comment || '';
    const deckNoteHtml = D.buildDeckNoteHtml?.(deckNote) || '';

    const simpleStats = D.buildSimpleDeckStats?.(item) || null;
    const rarityStats = buildRarityStats(item);

    const typeChipsHtml = D.buildTypeChipsHtml_?.(simpleStats) || '';
    const rarityChipsHtml = D.buildRarityChipsHtml_?.(item) || '';
    const packChipsHtml = D.buildPackChipsHtml_?.(item) || '';

    const pidSan = String(item.postId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const scope = listMode;
    const spPaneId = `sp-${scope}-${pidSan}`;

    const tagsMain = window.DeckPostFilter?.tagChipsMain?.(item.tagsAuto, item.tagsPick) || '';
    const tagsUser = window.DeckPostFilter?.tagChipsUser?.(item.tagsUser) || '';
    const deckList = D.buildDeckListHtml?.(item) || '';
    const cardNotesHtml = D.buildCardNotesHtml?.(item) || '';

    const posterXRaw = String(item.posterX || '').trim();
    const posterXLabel = posterXRaw;
    const posterXUser = posterXRaw.startsWith('@')
      ? posterXRaw.slice(1)
      : posterXRaw;

    const likeCount = Number(item.likeCount || 0);
    const liked = !!item.liked;
    const favClass = liked ? ' active' : '';
    const favContent = buildLikeButtonContent_(liked, likeCount);

    const notesHiddenId = `post-card-notes-hidden-${spPaneId}`;
    const notesValidId = `post-cardnote-validator-${spPaneId}`;
    const addNoteBtnId = `add-card-note-${spPaneId}`;

    const shareBtnHtml =
      `<button type="button" class="btn-post-share" data-postid="${escapeHtml(item.postId || '')}" aria-label="共有リンクをコピー">🔗</button>`;

    const headRightBtnHtml = isMine
      ? `
        <div class="post-head-actions">
          ${shareBtnHtml}
          <button class="delete-btn" type="button" data-postid="${escapeHtml(item.postId || '')}" aria-label="投稿を削除">🗑</button>
        </div>
      `
      : `
        <div class="post-head-actions">
          ${shareBtnHtml}
          <button class="fav-btn ${favClass}" type="button" aria-label="お気に入り">${favContent}</button>
        </div>
      `;

    const postId = String(item?.postId || '').trim();
    const codeNorm = String(item?.shareCode || '').trim();

    const codeManageHtml = isMine
      ? (window.buildDeckCodeBoxHtml_?.(postId, codeNorm) || '')
      : '';

    const codeCopyBtnHtml = codeNorm ? `
      <div class="post-detail-code-body">
        <button type="button" class="btn-copy-code-wide" data-code="${escapeHtml(codeNorm)}">
          デッキコードをコピー
        </button>
      </div>
    ` : '';

    const codeBtnHtml = `${codeManageHtml}${codeCopyBtnHtml}`;

    const hasCardNotes =
      Array.isArray(item.cardNotes) &&
      item.cardNotes.some((r) => r && (r.cd || r.text));

    const cardNotesSection = (!isMine && !hasCardNotes) ? '' : `
      <div class="post-detail-section">
        <div class="post-detail-heading-row post-detail-heading-row--cards">
          <div class="post-detail-heading">カード解説</div>
          ${isMine ? `
            <div class="post-detail-heading-actions">
              <button type="button" class="btn-cardnotes-edit">編集</button>
            </div>
          ` : ''}
        </div>

        <div class="cardnotes-view">
          ${cardNotesHtml}
        </div>

        ${isMine ? `
          <div class="cardnotes-editor" hidden data-original='${escapeHtml(JSON.stringify(item.cardNotes || []))}'>
            <div class="info-value" style="width:100%">
              <div class="post-card-notes"></div>
              <input type="hidden" id="${notesHiddenId}" class="post-card-notes-hidden" value="${escapeHtml(JSON.stringify(item.cardNotes || []))}">

              <input type="text" id="${notesValidId}" class="post-cardnote-validator" aria-hidden="true" tabindex="-1"
                style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;border:none;padding:0;margin:0;">

              <div class="add-note-box">
                <button type="button" id="${addNoteBtnId}" class="add-note-btn">カード解説を追加</button>
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
    `;

    return window.createElementFromHTML(`
      <article class="post-card post-card--sp" data-postid="${escapeHtml(item.postId || '')}" data-list-mode="${escapeHtml(listMode)}" style="${bg ? `--race-bg:${bg};` : ''}">
        <div class="sp-head">
          <div class="sp-head-left">
            ${detail().cardThumb?.(item.repImg, item.title) || ''}
          </div>

          <div class="sp-head-right">
            <div class="post-card-title">
              ${escapeHtml(item.title || '(無題)')}
            </div>

            <div class="sp-meta">
              <div class="meta-name">
                ${escapeHtml(item.posterName || item.username || '')}
                ${(item.posterName || item.username) ? `
                  <button type="button"
                    class="btn-filter-poster"
                    data-poster="${escapeHtml(item.posterName || item.username || '')}"
                    data-poster-key="${escapeHtml(window.posterKeyFromItem_?.(item) || '')}"
                    aria-label="この投稿者で絞り込む">👤</button>
                ` : ''}
              </div>

              ${posterXUser ? `
                <a class="sp-meta-x"
                  href="https://x.com/${encodeURIComponent(posterXUser)}"
                  target="_blank"
                  rel="noopener noreferrer">
                  ${escapeHtml(posterXLabel)}
                </a>
              ` : ''}

              <div class="sp-meta-date">
                ${window.fmtPostDates_?.(item) || ''}
              </div>
            </div>

            ${headRightBtnHtml}
          </div>
        </div>

        <div class="post-tags-wrap">
          <div class="post-tags post-tags-main">${tagsMain}</div>
          <div class="post-tags post-tags-user">${tagsUser}</div>
        </div>

        <div class="post-actions sp-actions">
          <button type="button" class="btn-detail">詳細</button>
          <button type="button" class="btn-add-compare">比較に追加</button>
        </div>

        <div class="post-detail" hidden>
          <div class="post-detail-inner" data-postid="${escapeHtml(item.postId || '')}" data-list-mode="${escapeHtml(listMode)}">
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
              ${deckList}
              ${codeBtnHtml}
            </div>

            <dl class="post-detail-summary">
              <dt>種族</dt><dd>${escapeHtml(mainRace || '')}</dd>
              <dt>枚数</dt><dd>${item.count || 0}枚</dd>
              <dt>旧神</dt><dd>${escapeHtml(oldGod || 'なし')}</dd>

              ${typeChipsHtml
                ? `<dt>タイプ構成</dt><dd><div class="post-detail-chips">${typeChipsHtml}</div></dd>`
                : ''
              }

              ${rarityChipsHtml
                ? `<dt>レアリティ構成</dt><dd><div class="post-detail-chips">${rarityChipsHtml}</div></dd>`
                : ''
              }

              ${packChipsHtml
                ? `<dt>パック構成</dt><dd><div class="post-detail-chips">${packChipsHtml}</div></dd>`
                : ''
              }

              <dt>
                マナ効率
                <button type="button" class="help-button" aria-label="マナ効率の説明を確認">？</button>
              </dt>
              <dd class="mana-eff-row">
                <span id="mana-efficiency-${escapeHtml(spPaneId)}" class="mana-eff">-</span>
                <span class="avg-charge-inline">
                  （平均チャージ量：<span id="avg-charge-${escapeHtml(spPaneId)}">-</span>）
                </span>
              </dd>
            </dl>

            <div class="deck-compare-block">
              <button type="button"
                class="deck-compare-toggle"
                aria-expanded="false"
                aria-label="所持カードデータから不足カードを確認"
                data-tooltip="所持率チェッカーのデータを参照して、このデッキの不足カードを確認します"
                title="所持率チェッカーのデータを参照して、このデッキの不足カードを確認します">
                不足カードを確認
              </button>
              <div class="deck-compare-result" hidden></div>
            </div>

            <div class="post-detail-charts" data-postcharts="${escapeHtml(item.postId || '')}" data-paneid="${escapeHtml(spPaneId)}">
              <div class="post-detail-chartbox">
                <div class="post-detail-charthead">
                  <div class="post-detail-charttitle">コスト分布</div>
                  <div class="post-detail-chartchips" id="cost-summary-${escapeHtml(spPaneId)}"></div>
                </div>
                <div class="post-detail-chartcanvas">
                  <canvas id="costChart-${escapeHtml(spPaneId)}"></canvas>
                </div>
              </div>

              <div class="post-detail-chartbox">
                <div class="post-detail-charthead">
                  <div class="post-detail-charttitle">パワー分布</div>
                  <div class="post-detail-chartchips" id="power-summary-${escapeHtml(spPaneId)}"></div>
                </div>
                <div class="post-detail-chartcanvas">
                  <canvas id="powerChart-${escapeHtml(spPaneId)}"></canvas>
                </div>
              </div>
            </div>

            <div class="post-detail-section">
              <div class="post-detail-heading-row">
                <div class="post-detail-heading">デッキ解説</div>
                ${isMine ? `
                  <div class="post-detail-heading-actions">
                    <button type="button" class="btn-decknote-edit">編集</button>
                  </div>
                ` : ''}
              </div>

              <div class="post-detail-body post-detail-body--decknote">
                <div class="decknote-view">
                  ${deckNoteHtml || '<div style="color:#777;font-size:.9rem;">まだ登録されていません。</div>'}
                </div>

                ${isMine ? `
                  <div class="decknote-editor" hidden>
                    <div class="note-preset-wrap note-preset-wrap--compact">
                      <div class="note-toolbar">
                        <div class="note-presets-grid">
                          <button type="button" class="note-preset-menu-btn" data-preset-menu="templates">記事構成を追加</button>
                          <button type="button" class="note-preset-menu-btn" data-preset-menu="sections">解説項目</button>
                          <button type="button" class="note-card-ref-btn">文中にカードを追加</button>
                        </div>
                      </div>
                      <div class="note-preset-panel" hidden></div>
                    </div>

                    <div class="decknote-editor-hint">
                      ※見出しを追加したり、文中にカード名を挿入できます。
                    </div>

                    <textarea class="decknote-textarea" rows="14" data-original="${escapeHtml(deckNote || '')}">${escapeHtml(deckNote || '')}</textarea>

                    <div class="decknote-editor-actions">
                      <button type="button" class="btn-decknote-save">保存</button>
                      <button type="button" class="btn-decknote-cancel">キャンセル</button>
                    </div>
                  </div>
                ` : ''}
              </div>
            </div>

            ${cardNotesSection}

            <div class="post-detail-footer">
              <button type="button" class="btn-detail-close">閉じる</button>
            </div>
          </div>
        </div>
      </article>
    `);
  }

  /**
   * 1枚カードレンダリング（PC/SP切り替え）
   */
  function oneCard(item, opts = {}) {
    const isSp = window.matchMedia('(max-width: 1023px)').matches;
    return isSp ? buildCardSp(item, opts) : buildCardPc(item, opts);
  }

  /**
   * 一覧ステータスメッセージ表示
   */
  function showListStatusMessage(type, text) {
    const listEl = document.getElementById('postList');
    if (!listEl) return;

    const baseClass = 'post-list-message';
    const errorClass = (type === 'error') ? ' post-list-message--error' : '';

    listEl.innerHTML =
      `<div class="${baseClass}${errorClass}">${escapeHtml(text)}</div>`;
  }

  /**
   * マイ投稿内の選択中タブを取得する
   */
  function getMineActiveTab_() {
    const state = getDeckPostState_();
    return state?.mine?.activeTab === 'liked' ? 'liked' : 'posts';
  }

  /**
   * マイ投稿内タブ表示を更新する
   */
  function updateMineTabsUI_() {
    const activeTab = getMineActiveTab_();
    document.querySelectorAll('.mine-tab[data-mine-tab]').forEach((btn) => {
      const active = btn.dataset.mineTab === activeTab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  /**
   * いいねしたデッキ一覧用の投稿を取得する
   */
  function getLikedDeckItems_() {
    const state = getDeckPostState_();
    return (state?.list?.allItems || []).filter((it) => !!it?.liked);
  }

  /**
   * マイ投稿件数表示更新
   */
  function updateMineCountUI_(tab = getMineActiveTab_(), totalOverride) {
    const state = getDeckPostState_();
    const total = Number(
      totalOverride ?? (
        tab === 'liked'
          ? getLikedDeckItems_().length
          : state?.mine?.total || 0
      )
    );

    const countTop = document.getElementById('resultCountMineTop');
    if (countTop) {
      const label = tab === 'liked' ? 'いいねしたデッキ' : 'マイ投稿';
      countTop.textContent = `${label} ${total}件`;
    }
  }

  /**
   * マイ投稿ログイン表示更新
   */
  function updateMineLoginStatus() {
    const el = document.getElementById('mine-login-username');
    if (!el) return;
    el.textContent = window.getLoginUsername?.() || '未ログイン';
  }

  // =========================
  // 4) 画面切替（一覧 ↔ マイ投稿）
  // =========================
  /**
   * 一覧ページ表示
   */
  function showList() {
    const listPage = document.getElementById('post-app');
    const minePage = document.getElementById('pageMine');

    if (listPage) listPage.hidden = false;
    if (minePage) minePage.hidden = true;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * マイ投稿ページ表示
   */
  function showMine() {
    const listPage = document.getElementById('post-app');
    const minePage = document.getElementById('pageMine');

    if (minePage) minePage.hidden = false;
    if (listPage) listPage.hidden = true;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // =========================
  // 5) いいね / 削除 / 一覧アクション
  // =========================

  // いいね送信中フラグ（postIdごと）
  const likePending = {};

  /**
   * 指定 postId の投稿オブジェクトを state から探す
   */
  function findPostItemById(postId) {
    const state = getDeckPostState_();
    const id = String(postId || '');

    const pick = (arr) => (arr || []).find((it) => String(it.postId) === id);

    return (
      pick(state?.mine?.items) ||
      pick(state?.list?.items) ||
      pick(state?.list?.filteredItems) ||
      pick(state?.list?.allItems) ||
      null
    );
  }

  /**
   * いいね状態を state / DOM に反映
   */
  function applyLikeState_(postId, liked, likeCount) {
    const state = getDeckPostState_();
    const pid = String(postId || '');

    const selector = `.post-card[data-postid="${pid}"] .fav-btn`;
    document.querySelectorAll(selector).forEach((el) => {
      el.classList.toggle('active', !!liked);
      el.textContent = buildLikeButtonContent_(liked, likeCount);
    });

    const updateList = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((it) => {
        if (String(it.postId) === pid) {
          it.liked = !!liked;
          it.likeCount = Number(likeCount || 0);
        }
      });
    };

    updateList(state?.list?.allItems);
    updateList(state?.list?.items);
    updateList(state?.list?.filteredItems);
    updateList(state?.mine?.items);
  }

  /**
   * いいねUIトグル
   * - 楽観的更新
   * - 失敗時ロールバック
   */
  async function handleToggleLike(postId, btn) {
    const pid = String(postId || '').trim();
    if (!pid || !btn) return;

    if (likePending[pid]) {
      alert('反映中です、しばらくしてからまたお試しください。');
      return;
    }

    const item = findPostItemById(pid) || {};
    const prevLiked = !!item.liked;
    const prevCount = Number(item.likeCount || 0);

    const optimisticLiked = !prevLiked;
    const optimisticCount = prevLiked
      ? Math.max(0, prevCount - 1)
      : prevCount + 1;

    applyLikeState_(pid, optimisticLiked, optimisticCount);

    likePending[pid] = true;
    btn.disabled = true;

    try {
      const res = await window.DeckPostApi.apiToggleLike({ postId: pid });

      if (!res || !res.ok) {
        applyLikeState_(pid, prevLiked, prevCount);

        const isAuthError = res && res.error === 'auth required';
        const msg = isAuthError
          ? 'いいねするにはログインが必要です。\nマイ投稿タブから新規登録またはログインしてください。'
          : `いいねに失敗しました。\n（エラー: ${(res && res.error) || 'unknown'}）`;

        alert(msg);
        return;
      }

      const liked = !!res.liked;
      const likeCount = Number(res.likeCount || 0);
      applyLikeState_(pid, liked, likeCount);

      const minePage = document.getElementById('pageMine');
      if (minePage && !minePage.hidden && getMineActiveTab_() === 'liked') {
        await loadMinePage(1);
      }
    } finally {
      likePending[pid] = false;
      btn.disabled = false;
    }
  }

  /**
   * 投稿削除API
   */
  async function deletePost_(postId) {
    const token = (window.Auth && window.Auth.token) || '';
    if (!token) return { ok: false, error: 'auth required' };

    return await window.gasPostDeckPost_({
      mode: 'delete',
      token,
      postId: String(postId || '').trim(),
    });
  }

  /**
   * 右ペイン初期化HTML
   */
  function buildEmptyDetailPaneHtml_(mode = 'list') {
    const accent = mode === 'mine'
      ? 'マイ投稿カード'
      : (mode === 'liked' ? 'いいねしたデッキカード' : '投稿カード');

    return `
      <div class="post-detail-empty">
        <div class="post-detail-empty-icon">👈</div>
        <div class="post-detail-empty-text">
          <div class="post-detail-empty-title">デッキ詳細パネル</div>
          <p class="post-detail-empty-main">
            左の<span class="post-detail-empty-accent">${accent}</span>をクリックすると、<br>
            ここにそのデッキの詳細が表示されます。
          </p>
        </div>
      </div>
    `;
  }

  /**
   * 削除後に右ペインを必要なら初期化
   */
  function resetDetailPaneIfShowing_(postId) {
    const pid = String(postId || '');

    const paneMine = document.getElementById('postDetailPaneMine');
    if (paneMine) {
      const showingId = paneMine.querySelector('.post-detail-inner')?.dataset?.postid;
      if (String(showingId || '') === pid) {
        paneMine.innerHTML = buildEmptyDetailPaneHtml_('mine');
      }
    }

    const paneList = document.getElementById('postDetailPane');
    if (paneList) {
      const showingId = paneList.querySelector('.post-detail-inner')?.dataset?.postid;
      if (String(showingId || '') === pid) {
        paneList.innerHTML = buildEmptyDetailPaneHtml_('list');
      }
    }
  }

  /**
   * 削除後に一覧stateから除外
   */
  function removePostFromListState_(postId) {
    const state = getDeckPostState_();
    const pid = String(postId || '');

    if (state?.list) {
      state.list.allItems = (state.list.allItems || []).filter(
        (it) => String(it.postId || '') !== pid
      );
      state.list.items = (state.list.items || []).filter(
        (it) => String(it.postId || '') !== pid
      );
      state.list.filteredItems = (state.list.filteredItems || []).filter(
        (it) => String(it.postId || '') !== pid
      );
      state.list.total = (state.list.allItems || []).length;
    }

    if (state?.mine) {
      state.mine.items = (state.mine.items || []).filter(
        (it) => String(it.postId || '') !== pid
      );
      state.mine.total = (state.mine.items || []).length;
      state.mine.page = 1;
      state.mine.totalPages = 1;
    }
  }

  /**
   * 一覧/マイ投稿アクションのイベント委任
   */
  function bindPostListActionHandlers_() {
    if (window.__deckPostListActionsBound) return;
    window.__deckPostListActionsBound = true;

document.addEventListener('click', async (e) => {

    // =========================
    // デッキ比較ポップアップ
    // =========================
    const deckComparePopupBtn = e.target.closest('#deckCompareNoticePopup [data-action]');
    if (deckComparePopupBtn) {
      const popup = document.getElementById('deckCompareNoticePopup');
      const action = deckComparePopupBtn.dataset.action;
      const postId = String(popup?.dataset?.postid || '').trim();

      if (action === 'close') {
        popup?.remove();
        return;
      }

      if (action === 'auth-login' || action === 'auth-signup') {
        popup?.remove();
        const mode = action === 'auth-signup' ? 'signup' : 'login';
        if (typeof window.openAuthModal === 'function') {
          window.openAuthModal(mode);
        } else {
          document.querySelector(`[data-open="authLoginModal"][data-auth-entry="${mode}"]`)?.click();
        }
        return;
      }

      if (action === 'like') {
        const favBtn = document.querySelector(
          `.post-card[data-postid="${postId}"] .fav-btn`
        );

        if (favBtn) {
          popup?.remove();
          favBtn.click();
        }
        return;
      }
    }
      // =========================
      // いいね
      // =========================
      const favBtn = e.target.closest('.fav-btn');
      if (favBtn) {
        const art = favBtn.closest('.post-card');
        const postId = String(art?.dataset?.postid || '').trim();
        if (!postId) return;

        e.preventDefault();
        e.stopPropagation();

        await handleToggleLike(postId, favBtn);
        return;
      }

      // =========================
      // マイ投稿：削除
      // =========================
      const btn = e.target.closest('#myPostList .delete-btn');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();

        const postId = String(btn.dataset.postid || '').trim();
        if (!postId) return;

        const card = btn.closest('.post-card');
        const title =
          card?.querySelector('.post-card-title')?.textContent?.trim() ||
          card?.querySelector('.pc-title')?.textContent?.trim() ||
          'この投稿';

        const msg =
`「${title}」を削除します。
削除すると元に戻せません。よろしいですか？`;

        const ok = await window.confirmDeleteByModal_?.(msg);
        if (!ok) return;

        btn.disabled = true;

        try {
          const r = await deletePost_(postId);
          if (!r || !r.ok) {
            alert((r && r.error) || '削除に失敗しました');
            return;
          }

          window.showActionToast?.('投稿を削除しました');

          resetDetailPaneIfShowing_(postId);
          removePostFromListState_(postId);

          await window.DeckPostList?.loadMinePage?.(1);
          await window.DeckPostList?.applySortAndRerenderList?.();
        } finally {
          btn.disabled = false;
        }
        return;
      }

      // =========================
      // 一覧カード：全体クリックで詳細表示（PCのみ）
      // =========================
      const art = e.target.closest('.post-card');
      if (!art) return;

      // 詳細内クリックは無視
      if (e.target.closest('.post-detail')) return;

      // ユーザータグ検索系は無視
      if (e.target.closest('.btn-user-tag-search')) return;
      if (e.target.closest('.post-tags-user')) return;

      const isPcWide = window.matchMedia('(min-width: 1024px)').matches;
      if (!isPcWide) {
        // SP/タブレットは「詳細」ボタンから開くので何もしない
        return;
      }

      window.DeckPostDetail?.showDetailPaneForArticle?.(art);
    });
  }



  // =========================
  // 6) 一覧取得
  // =========================
  /**
   * 一覧全件取得
   */
  async function fetchAllList() {
    const state = getDeckPostState_();
    if (state?.list?.hasAllItems) {
      updateFilterReadyState_();
      return state.list.allItems || [];
    }
    if (allListFetchPromise_) {
      updateFilterReadyState_();
      return allListFetchPromise_;
    }

    updateFilterReadyState_();
    allListFetchPromise_ = (async () => {
      const limit = FETCH_LIMIT;
      let offset = 0;
      let all = [];
      let total = 0;

      while (true) {
        window.debugLog?.('F1 fetchAllList', { offset, limit });
        let res = null;
        try {
          res = await window.DeckPostApi.apiList({
            limit,
            offset,
            mine: false,
          });
        } catch (e) {
          window.debugLog?.('❌ fetchAllList api error', e?.message || e);
          console.warn('fetchAllList api error:', e);
          return Array.isArray(state?.list?.items) ? state.list.items : [];
        }

        window.debugLog?.('F2 fetchAllList result', {
          ok: res?.ok,
          error: res?.error,
          items: Array.isArray(res?.items) ? res.items.length : 'not array',
          total: res?.total,
          nextOffset: res?.nextOffset,
        });

        if (!res || !res.ok) {
          window.debugLog?.('❌ fetchAllList failed', res);
          console.warn('fetchAllList failed:', res);
          return Array.isArray(state?.list?.items) ? state.list.items : [];
        }

        const items = Array.isArray(res.items) ? res.items : [];
        all.push(...items);

        if (typeof res.total === 'number') {
          total = res.total;
        }

        const nextOffset = (res.nextOffset ?? null);
        if (nextOffset === null || items.length === 0) {
          break;
        }
        offset = nextOffset;
        await wait_(200);
      }

      state.list.allItems = all;
      state.list.items = all;
      state.list.filteredItems = all;
      state.list.total = total || all.length;
      state.list.hasAllItems = true;
      state.list.pageCache = {};

      return all;
    })().finally(() => {
      allListFetchPromise_ = null;
      updateFilterReadyState_();
    });

    return allListFetchPromise_;
  }

  /**
   * 背景で全件取得を開始する
   */
  function prefetchAllListInBackground_() {
    const state = getDeckPostState_();
    if (state?.list?.hasAllItems || allListFetchPromise_) return;
    updateFilterReadyState_();
    fetchAllList().catch((e) => {
      console.warn('prefetchAllListInBackground_ failed:', e);
    });
  }

  /**
   * 通常一覧の指定ページだけ取得
   */
  async function fetchListPage_(page) {
    const state = getDeckPostState_();
    const totalPages = Math.max(1, Number(state?.list?.totalPages || 1));
    const p = Math.min(Math.max(Number(page || 1), 1), totalPages);
    const offset = (p - 1) * PAGE_LIMIT;

    const res = await window.DeckPostApi.apiList({
      limit: PAGE_LIMIT,
      offset,
      mine: false,
    });

    if (!res || !res.ok) {
      throw new Error((res && res.error) || 'list page fetch failed');
    }

    const items = Array.isArray(res.items) ? res.items : [];
    const total = Number(res.total || 0);

    state.list.items = items;
    state.list.filteredItems = items;
    state.list.total = total;
    state.list.totalPages = Math.max(1, Math.ceil(Math.max(total, 0) / PAGE_LIMIT));
    state.list.currentPage = Math.min(Math.max(p, 1), state.list.totalPages);
    state.list.nextOffset = res.nextOffset ?? null;
    state.list.pageCache = {};

    return items;
  }

  /**
   * フィルター・並び替えを再計算して一覧を再描画
   */
  async function applySortAndRerenderList(resetToFirstPage = false) {
    const state = getDeckPostState_();

    // 全件未取得でも並び替え時には追加取得しない。スマホでの連続API失敗を避ける。
    if (!state?.list?.hasAllItems) {
      window.debugLog?.('S1 applySort without fetchAllList');
    }

    // フィルター・並び替えを再計算
    window.DeckPostFilter?.rebuildFilteredItems?.();

    // 描画するページを決めて再描画
    const page = resetToFirstPage ? 1 : (state?.list?.currentPage || 1);
    loadListPage(page);
  }

  // =========================
  // 7) ページング
  // =========================
  /**
   * 一覧用：ページャUI更新
   */
  function updatePagerUI() {
    const state = getDeckPostState_();

    const page = Number(state?.list?.currentPage || 1);
    const total = Number(state?.list?.totalPages || 1);

    const prev = document.getElementById('pagePrev');
    const next = document.getElementById('pageNext');
    const info = document.getElementById('pageInfo');

    if (info) info.textContent = `${page} / ${total}`;
    if (prev) prev.disabled = (page <= 1);
    if (next) next.disabled = (page >= total);

    const prevTop = document.getElementById('pagePrevTop');
    const nextTop = document.getElementById('pageNextTop');
    const infoTop = document.getElementById('pageInfoTop');

    if (infoTop) infoTop.textContent = `${page} / ${total}`;
    if (prevTop) prevTop.disabled = (page <= 1);
    if (nextTop) nextTop.disabled = (page >= total);
  }

  /**
   * 一覧上部へスクロール
   */
  function scrollToPostListTop_() {
    const top =
      document.getElementById('listControls') ||
      document.getElementById('postMainLayout');

    top?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'start',
    });
  }

  /**
   * 一覧用：指定ページを描画
   */
  async function loadListPage(page) {
    const state = getDeckPostState_();

    const listEl = document.getElementById('postList');
    if (!listEl) return;

    const requestedPage = Math.max(Number(page || 1), 1);
    const hasCurrentPageItems =
      Number(state?.list?.currentPage || 0) === requestedPage &&
      Array.isArray(state?.list?.items) &&
      state.list.items.length > 0;

    if (!state?.list?.hasAllItems && requestedPage > 1) {
      try {
        listEl.replaceChildren();
        showListStatusMessage('loading', '全投稿を読み込み中です…');
        await fetchAllList();
        window.DeckPostFilter?.rebuildFilteredItems?.();
      } catch (e) {
        console.error('全件取得に失敗しました', e);
        showListStatusMessage(
          'error',
          '投稿一覧の読み込みに失敗しました。ページを再読み込みしてください。'
        );
        return;
      }
    } else if (!state?.list?.hasAllItems && !hasCurrentPageItems) {
      try {
        listEl.replaceChildren();
        showListStatusMessage('loading', '投稿一覧を読み込み中です…');
        await fetchListPage_(requestedPage);
      } catch (e) {
        console.error('一覧ページ取得に失敗しました', e);
        showListStatusMessage(
          'error',
          '投稿一覧の読み込みに失敗しました。ページを再読み込みしてください。'
        );
        return;
      }
    }

    const filtered = Array.isArray(state?.list?.filteredItems)
      ? state.list.filteredItems
      : [];

    const total = Number(state?.list?.total || filtered.length || 0);
    const totalPages = total > 0
      ? Math.max(1, Math.ceil(total / PAGE_LIMIT))
      : 1;

    state.list.totalPages = totalPages;

    const p = Math.min(Math.max(Number(page || 1), 1), totalPages);
    state.list.currentPage = p;

    const start = (p - 1) * PAGE_LIMIT;
    const end = start + PAGE_LIMIT;
    const pageItems = state?.list?.hasAllItems
      ? filtered.slice(start, end)
      : filtered;

    listEl.replaceChildren();

    if (!filtered.length) {
      showListStatusMessage('empty', '条件に合う投稿がありません');
      updatePagerUI();

      const resultCount = document.getElementById('resultCount');
      if (resultCount) resultCount.textContent = '0件';

      const resultCountTop = document.getElementById('resultCountTop');
      if (resultCountTop) resultCountTop.textContent = '0件';

      const pane = document.getElementById('postDetailPane');
      if (pane) {
        pane.innerHTML = `
          <div class="post-detail-empty">
            <div class="post-detail-empty-icon">👈</div>
            <div class="post-detail-empty-text">
              <div class="post-detail-empty-title">デッキ詳細パネル</div>
              <p class="post-detail-empty-main">
                左の<span class="post-detail-empty-accent">投稿カード</span>をクリックすると、<br>
                ここにそのデッキの詳細が表示されます。
              </p>
            </div>
          </div>
        `;
      }
      return;
    }

    renderPostListInto('postList', pageItems, { mode: 'list' });

    const resultCount = document.getElementById('resultCount');
    if (resultCount) resultCount.textContent = `投稿：${total}件`;

    const resultCountTop = document.getElementById('resultCountTop');
    if (resultCountTop) resultCountTop.textContent = `投稿：${total}件`;

    updatePagerUI();

    if (window.matchMedia('(min-width: 1024px)').matches) {
      const firstCard = document.querySelector('#postList .post-card');
      if (firstCard && typeof detail().showDetailPaneForArticle === 'function') {
        detail().showDetailPaneForArticle(firstCard);
      }
    }

    scrollToPostListTop_();
  }

  // =========================
  // 8) マイ投稿取得
  // =========================
  /**
   * マイ投稿先読み
   */
  async function prefetchMineItems_({ force = false } = {}) {
    const state = getDeckPostState_();

    const tk =
      (window.Auth && window.Auth.token) ||
      state?.token ||
      window.DeckPostApi.resolveToken();

    if (!tk) return null;

    if (!force && hasValidMineCache_()) {
      return state.mine.items;
    }

    const inFlight = window.DeckPostState.getMinePrefetchPromise();
    if (inFlight) return inFlight;

    const promise = (async () => {
      const limit = PAGE_LIMIT;
      let offset = 0;
      let allItems = [];
      let total = 0;

      while (true) {
        const res = await window.DeckPostApi.apiList({
          limit,
          offset,
          mine: true,
        });

        if (res && res.error === 'auth required') {
          state.mine.items = [];
          state.mine.total = 0;
          window.DeckPostState.invalidateMineCache();
          return state.mine.items;
        }

        if (!res || !res.ok) {
          throw new Error((res && res.error) || 'prefetch mine failed');
        }

        const items = Array.isArray(res.items) ? res.items : [];
        if (!total) total = Number(res.total || 0);

        allItems.push(...items);
        offset += items.length;

        if (items.length < limit) break;
        if (total && allItems.length >= total) break;
      }

      window.DeckPostState.setMineItems(allItems, total || allItems.length);
      return allItems;
    })().finally(() => {
      window.DeckPostState.setMinePrefetchPromise(null);
    });

    window.DeckPostState.setMinePrefetchPromise(promise);
    return promise;
  }

  /**
   * マイ投稿ページで使う認証トークンを取得する
   */
  function getMineAuthToken_() {
    const state = getDeckPostState_();
    return (
      (window.Auth && window.Auth.token) ||
      state?.token ||
      window.DeckPostApi.resolveToken()
    );
  }

  /**
   * マイ投稿ページの未ログイン案内をタブごとに切り替える
   */
  function updateMineLoginMessage_(tab) {
    const titleEl = document.getElementById('mine-error-title');
    const msgEl = document.getElementById('mine-error-msg');
    if (tab === 'liked') {
      if (titleEl) titleEl.textContent = 'ここにいいねしたデッキが表示されます。';
      if (msgEl) msgEl.textContent = 'ログインすると、いいねしたデッキ一覧を確認できます。';
      return;
    }

    if (titleEl) titleEl.textContent = 'ここにあなたの投稿が表示されます。';
    if (msgEl) msgEl.textContent = 'ログインすると、投稿したデッキ一覧を確認できます。';
  }

  /**
   * マイ投稿ページの空表示をタブごとに切り替える
   */
  function updateMineEmptyMessage_(tab) {
    const emptyEl = document.getElementById('mine-empty');
    if (!emptyEl) return;

    if (tab === 'liked') {
      emptyEl.innerHTML = `
        <p>まだいいねしたデッキがありません。</p>
      `;
      return;
    }

    emptyEl.innerHTML = `
      <p>まだ投稿がありません。</p>
      <p>
        <a href="deckmaker.html" class="mine-empty-link">
          🃏 デッキメーカーでデッキを作りましょう！
        </a>
      </p>
    `;
  }

  /**
   * マイ投稿ページの右ペインを初期表示に戻す
   */
  function resetMineDetailPane_(tab = getMineActiveTab_()) {
    const paneMine = document.getElementById('postDetailPaneMine');
    if (!paneMine) return;
    paneMine.innerHTML = buildEmptyDetailPaneHtml_(tab === 'liked' ? 'liked' : 'mine');
  }

  /**
   * PC幅では先頭カードを詳細ペインへ表示する
   */
  function showFirstMineCardDetail_() {
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    const firstCard = document.querySelector('#myPostList .post-card');
    if (firstCard && typeof detail().showDetailPaneForArticle === 'function') {
      detail().showDetailPaneForArticle(firstCard);
    }
  }

  /**
   * いいねしたデッキタブを描画する
   */
  async function loadLikedDeckPage_() {
    const state = getDeckPostState_();
    const listEl = document.getElementById('myPostList');
    const emptyEl = document.getElementById('mine-empty');
    const errorEl = document.getElementById('mine-error');
    const loadingEl = document.getElementById('mine-loading');
    if (!listEl) return;

    updateMineTabsUI_();
    updateMineLoginMessage_('liked');
    updateMineEmptyMessage_('liked');

    if (!getMineAuthToken_()) {
      listEl.replaceChildren();
      if (emptyEl) emptyEl.style.display = 'none';
      if (errorEl) errorEl.style.display = '';
      if (loadingEl) loadingEl.style.display = 'none';
      updateMineCountUI_('liked', 0);
      resetMineDetailPane_('liked');
      return;
    }

    state.mine.loading = true;
    if (loadingEl) loadingEl.style.display = '';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
      if (!state?.list?.hasAllItems) {
        listEl.replaceChildren();
        listEl.innerHTML = '<div class="post-list-message">いいねしたデッキを読み込み中です…</div>';
        await fetchAllList();
      }

      const likedItems = getLikedDeckItems_();
      renderPostListInto('myPostList', likedItems, { mode: 'liked' });
      updateMineCountUI_('liked', likedItems.length);

      if (emptyEl) emptyEl.style.display = likedItems.length ? 'none' : '';
      if (errorEl) errorEl.style.display = 'none';

      if (likedItems.length) {
        showFirstMineCardDetail_();
      } else {
        resetMineDetailPane_('liked');
      }
    } catch (e) {
      console.error('loadLikedDeckPage_ error:', e);
      if (errorEl) {
        const titleEl = document.getElementById('mine-error-title');
        const msgEl = document.getElementById('mine-error-msg');
        if (titleEl) titleEl.textContent = 'いいねしたデッキの読み込みに失敗しました。';
        if (msgEl) msgEl.textContent = '時間をおいてから、もう一度お試しください。';
        errorEl.style.display = '';
      }
      resetMineDetailPane_('liked');
    } finally {
      state.mine.loading = false;
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /**
   * マイ投稿描画
   */
  async function loadMinePage(_page = 1) {
    const state = getDeckPostState_();
    const activeTab = getMineActiveTab_();

    updateMineTabsUI_();
    if (activeTab === 'liked') {
      await loadLikedDeckPage_();
      return;
    }

    const listEl = document.getElementById('myPostList');
    const emptyEl = document.getElementById('mine-empty');
    const errorEl = document.getElementById('mine-error');
    const loadingEl = document.getElementById('mine-loading');
    if (!listEl) return;

    updateMineLoginMessage_('posts');
    updateMineEmptyMessage_('posts');

    if (hasValidMineCache_() && !state.mine.loading) {
      const allItems = state.mine.items || [];
      state.mine.items = allItems;
      state.mine.total = Number(state.mine.total || allItems.length);
      state.mine.page = 1;
      state.mine.totalPages = 1;
      state.mine.loading = false;

      renderPostListInto('myPostList', allItems, { mode: 'mine' });
      updateMineCountUI_('posts');

      if (emptyEl) emptyEl.style.display = allItems.length ? 'none' : '';
      if (errorEl) errorEl.style.display = 'none';
      if (loadingEl) loadingEl.style.display = 'none';

      if (allItems.length) {
        showFirstMineCardDetail_();
      } else {
        resetMineDetailPane_('posts');
      }
      return;
    }

    const limit = PAGE_LIMIT;
    let offset = 0;
    let allItems = [];
    let total = 0;

    state.mine.loading = true;

    if (loadingEl) loadingEl.style.display = '';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
      while (true) {
        const res = await window.DeckPostApi.apiList({
          limit,
          offset,
          mine: true,
        });

        if (res && res.error === 'auth required') {
          state.mine.items = [];
          state.mine.page = 1;
          state.mine.totalPages = 1;
          state.mine.total = 0;
          window.DeckPostState.invalidateMineCache();

          listEl.replaceChildren();

          const paneMine = document.getElementById('postDetailPaneMine');
          if (paneMine) {
            paneMine.innerHTML = `
              <div class="post-detail-empty">
                マイ投稿を表示するにはログインが必要です。
              </div>
            `;
          }

          if (emptyEl) emptyEl.style.display = 'none';
          if (errorEl) errorEl.style.display = '';

          updateMineLoginMessage_('posts');
          updateMineCountUI_('posts');
          return;
        }

        if (!res || !res.ok) {
          throw new Error((res && res.error) || 'list mine failed');
        }

        const items = Array.isArray(res.items) ? res.items : [];
        if (!total) total = Number(res.total || 0);

        allItems.push(...items);
        offset += items.length;

        if (items.length < limit) break;
        if (total && allItems.length >= total) break;
      }

      state.mine.page = 1;
      state.mine.totalPages = 1;
      window.DeckPostState.setMineItems(allItems, total || allItems.length);

      renderPostListInto('myPostList', allItems, { mode: 'mine' });
      updateMineCountUI_('posts');

      if (emptyEl) emptyEl.style.display = allItems.length ? 'none' : '';

      const paneMine = document.getElementById('postDetailPaneMine');
      if (paneMine) {
        if (!allItems.length) {
          resetMineDetailPane_('posts');
        } else {
          showFirstMineCardDetail_();
        }
      }
    } catch (e) {
      console.error('loadMinePage error:', e);
      if (errorEl) errorEl.style.display = '';
    } finally {
      state.mine.loading = false;
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  // =========================
  // 9) 認証変更時再読込
  // =========================
  /**
   * 認証変更時フック
   */
  function handleAuthChangedForDeckPost() {
    const state = getDeckPostState_();

    updateMineLoginStatus();

    state.token = window.DeckPostApi.resolveToken();
    allListFetchPromise_ = null;
    state.list.hasAllItems = false;
    state.list.allItems = [];
    window.DeckPostState.invalidateMineCache();
    updateFilterReadyState_();

    if (window.DeckPostState.isInitialized()) {
      (async () => {
        try {
          await window.DeckPostList?.fetchAllList?.();
          window.DeckPostFilter?.rebuildFilteredItems?.();
          const cur = state.list.currentPage || 1;
          window.DeckPostList?.loadListPage?.(cur);
        } catch (e) {
          console.error('handleAuthChangedForDeckPost: reload list failed', e);
        }
      })();
    }

    const minePage = document.getElementById('pageMine');
    const mineVisible = minePage && !minePage.hidden;

    if (state.token && !state.mine.loading) {
      prefetchMineItems_({ force: true }).catch((e) => {
        console.warn('prefetchMineItems_ failed:', e);
      });
    }

    if (mineVisible && !state.mine.loading) {
      (async () => {
        if (getMineActiveTab_() === 'posts') {
          try {
            await prefetchMineItems_();
          } catch (_) {}
        }
        await window.DeckPostList?.loadMinePage?.(1);
      })();
    }
  }

  // =========================
  // 10) ページャ配線
  // =========================
  /**
   * 一覧ページャ配線
   */
  function bindListPagerButtons_() {
    if (window.__deckPostPagerBound) return;
    window.__deckPostPagerBound = true;

    const onPrev = () => {
      const state = getDeckPostState_();
      const page = Number(state?.list?.currentPage || 1);
      if (page > 1) window.DeckPostList?.loadListPage?.(page - 1);
    };

    const onNext = () => {
      const state = getDeckPostState_();
      const page = Number(state?.list?.currentPage || 1);
      const total = Number(state?.list?.totalPages || 1);
      if (page < total) window.DeckPostList?.loadListPage?.(page + 1);
    };

    document.getElementById('pagePrevTop')?.addEventListener('click', onPrev);
    document.getElementById('pageNextTop')?.addEventListener('click', onNext);
    document.getElementById('pagePrev')?.addEventListener('click', onPrev);
    document.getElementById('pageNext')?.addEventListener('click', onNext);
  }


  // =========================
  // 11) 一覧初期化
  // =========================
      /**
   * 一覧ページ初期化
   * - sortSelect 初期化
   * - 初回一覧取得＆描画
   * - PC/SP境界またぎ時の再描画
   */
  async function init() {
    const state = getDeckPostState_();

    bindListPaneHeightSync_();
    updateFilterReadyState_();

    // =========================
    // 並び替えセレクト初期化
    // =========================
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect && !sortSelect.dataset.boundDeckPostSort) {
      sortSelect.dataset.boundDeckPostSort = '1';

      state.list.sortKey = sortSelect.value || 'new';

      sortSelect.addEventListener('change', () => {
        state.list.sortKey = sortSelect.value || 'new';
        window.DeckPostList?.applySortAndRerenderList?.();
      });
    }

    // =========================
    // 初回一覧取得 → 初期描画
    // =========================
    try {
      state.list.loading = true;
      const shouldLoadAllInitially = shouldLoadAllItemsInitially_();
      window.debugLog?.('L0 list init branch', {
        shouldLoadAllInitially,
        search: window.location.search || '',
        hasAllItems: !!state?.list?.hasAllItems,
        items: Array.isArray(state?.list?.items) ? state.list.items.length : 'not array',
      });
      window.DeckPostList?.showListStatusMessage?.(
        'loading',
        '投稿一覧を読み込み中です…(5秒ほどかかります)'
      );

      if (shouldLoadAllInitially) {
        window.debugLog?.('L0A shared url fetchAllList前');
        await window.DeckPostList?.fetchAllList?.();
        window.debugLog?.('L0B shared url fetchAllList後', {
          hasAllItems: !!state?.list?.hasAllItems,
          items: Array.isArray(state?.list?.items) ? state.list.items.length : 'not array',
        });
        window.DeckPostFilter?.applySharedPostFromUrl?.();
        window.DeckPostFilter?.rebuildFilteredItems?.();
      } else {
debugLog('L1 初回apiList前');

const res = await window.DeckPostApi.apiList({
  limit: PAGE_LIMIT,
  offset: 0,
  mine: false,
});

debugLog('L2 初回apiList結果', {
  ok: res?.ok,
  error: res?.error,
  items: Array.isArray(res?.items) ? res.items.length : 'not array',
  total: res?.total,
  nextOffset: res?.nextOffset
});

if (!res || !res.ok) {
  debugLog('❌ 初回apiList失敗', res);
  throw new Error((res && res.error) || 'initial list fetch failed');
}

        if (!res || !res.ok) {
          throw new Error((res && res.error) || 'initial list fetch failed');
        }

        const items = Array.isArray(res.items) ? res.items : [];
        const total = Number(res.total || 0);

        state.list.allItems = [];
        state.list.items = items;
        state.list.filteredItems = items;
        state.list.total = total;
        state.list.totalPages = Math.max(1, Math.ceil(Math.max(total, 0) / PAGE_LIMIT));
        state.list.currentPage = 1;
        state.list.nextOffset = res.nextOffset ?? null;
        state.list.hasAllItems = false;
        state.list.pageCache = {};
        updateFilterReadyState_();
      }

      prefetchMineItems_().catch(() => {});
      // スマホ/タブレットでGAS連続取得が不安定なため、初期表示時の全件先読みは停止する。
      // prefetchAllListInBackground_();
      await window.DeckPostList?.loadListPage?.(1);
} catch (e) {
  debugLog('❌ 初期一覧取得catch', e.message);
  console.error('初期一覧取得に失敗しました', e);
  window.DeckPostList?.showListStatusMessage?.(
    'error',
    '投稿一覧の読み込みに失敗しました。ページを再読み込みしてください。'
  );
}finally {
      state.list.loading = false;
    }

    // =========================
    // PC/SP境界またぎ時の再描画
    // =========================
    if (!window.__deckPostListResizeBound) {
      window.__deckPostListResizeBound = true;

      const isPcWide = () => window.matchMedia('(min-width: 1024px)').matches;
      let last = isPcWide();
      let tid = null;

      const onChange = () => {
        clearTimeout(tid);
        tid = setTimeout(() => {
          // SP簡易オーバーレイが出っぱなしなら閉じる
          const pane = document.getElementById('deckpeek-overlay');
          if (pane) pane.style.display = 'none';

          // 1023/1024 を跨いだら一覧を再描画
          const now = isPcWide();
          if (now !== last) {
            last = now;
            const minePage = document.getElementById('pageMine');
            if (minePage && !minePage.hidden) {
              window.DeckPostList?.loadMinePage?.(1);
            } else {
              window.DeckPostList?.applySortAndRerenderList?.();
            }
          }
        }, 120);
      };

      window.addEventListener('resize', onChange, { passive: true });
      window.addEventListener('orientationchange', onChange, { passive: true });
    }
  }


  // =========================
  // 12) 画面切替ボタン配線
  // =========================
  /**
   * 一覧↔マイ投稿ボタン配線
   */
  function bindPageSwitchButtons_() {
    if (window.__deckPostPageSwitchBound) return;
    window.__deckPostPageSwitchBound = true;

    document.querySelectorAll('.mine-tab[data-mine-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const state = getDeckPostState_();
        const nextTab = btn.dataset.mineTab === 'liked' ? 'liked' : 'posts';
        if (state?.mine) state.mine.activeTab = nextTab;
        updateMineTabsUI_();
        await window.DeckPostList?.loadMinePage?.(1);
      });
    });

    document.getElementById('toMineBtn')?.addEventListener('click', async () => {
      setToMineButtonLoading_(true);

      try {
        updateMineLoginStatus();

        if (getMineActiveTab_() === 'posts') {
          try {
            await prefetchMineItems_();
          } catch (_) {}
        }

        window.DeckPostList?.showMine?.();
        await window.DeckPostList?.loadMinePage?.(1);
      } finally {
        setToMineButtonLoading_(false);
      }
    });

    document.getElementById('backToListBtn')?.addEventListener('click', () => {
      window.DeckPostList?.showList?.();
    });
  }

  // =========================
  // 13) 公開API
  // =========================
  window.PAGE_LIMIT = PAGE_LIMIT;
  window.FETCH_LIMIT = FETCH_LIMIT;

  // 旧グローバル（互換のため一旦残す）
  window.updatePagerUI = updatePagerUI;
  //window.loadListPage = loadListPage;
  //window.loadMinePage = loadMinePage;
  //window.fetchAllList = fetchAllList;
  //window.applySortAndRerenderList = applySortAndRerenderList;
  window.prefetchMineItems_ = prefetchMineItems_;
  window.onDeckPostAuthChanged = handleAuthChangedForDeckPost;
  window.handleAuthChangedForDeckPost = handleAuthChangedForDeckPost;
  window.renderPostListInto = renderPostListInto;
  window.buildCardPc = buildCardPc;
  window.buildCardSp = buildCardSp;
  window.oneCard = oneCard;
  //window.showListStatusMessage = showListStatusMessage;
  window.updateMineCountUI_ = updateMineCountUI_;
  window.updateMineLoginStatus = updateMineLoginStatus;
  //window.showList = showList;
  //window.showMine = showMine;
  window.bindListPagerButtons_ = bindListPagerButtons_;
  window.bindPageSwitchButtons_ = bindPageSwitchButtons_;
  window.handleToggleLike = handleToggleLike;
  window.deletePost_ = deletePost_;
  window.findPostItemById = findPostItemById;
  window.bindPostListActionHandlers_ = bindPostListActionHandlers_;

  // 新namespace
  window.DeckPostList = window.DeckPostList || {};
  window.DeckPostList.init = init;
  window.DeckPostList.updatePagerUI = updatePagerUI;
  window.DeckPostList.loadListPage = loadListPage;
  window.DeckPostList.handleAuthChanged = handleAuthChangedForDeckPost;
  window.DeckPostList.loadMinePage = loadMinePage;
  window.DeckPostList.fetchAllList = fetchAllList;
  window.DeckPostList.applySortAndRerenderList = applySortAndRerenderList;
  window.DeckPostList.showListStatusMessage = showListStatusMessage;
  window.DeckPostList.showList = showList;
  window.DeckPostList.showMine = showMine;

  // =========================
  // 14) 初期化
  // =========================
  window.bindListPagerButtons_?.();
  window.bindPostListActionHandlers_?.();
  window.bindPageSwitchButtons_?.();
})();
