/**
 * js/pages/deck-post/deck-post-editor.js
 * - デッキ投稿ページ：編集系UI
 * - デッキ解説編集 / カード解説編集 / デッキコード編集 を担当
 *
 * このファイルに置くもの
 * - デッキ解説プリセット
 * - デッキ解説の編集開始 / キャンセル / 保存
 * - カード解説の編集開始 / キャンセル / 保存
 * - カード解説の選択モーダル / 行操作
 * - デッキコードの追加 / 編集 / 削除 / 保存
 * - 保存後の state / 表示更新
 *
 * 前提：
 * - deck-post-detail.js 側で buildDeckNoteHtml / buildCardNotesHtml / findItemById_ などが利用可能
 * - deck-post-api.js 側で updateDeckNote_ / updateCardNotes_ / updateDeckCode_ が利用可能
 * - トーストは showActionToast / showMiniToast_ を利用
 */
(function () {
  'use strict';

  // =========================
  // 0) 依存参照
  // =========================
  const buildDeckNoteHtml =
    (...args) => window.DeckPostDetail?.buildDeckNoteHtml?.(...args);

  const findItemById_ =
    (...args) => window.DeckPostDetail?.findItemById_?.(...args);

  const updateDeckNote_ =
    (...args) => window.DeckPostApi?.updateDeckNote_?.(...args);

  const showActionToast_ =
    (...args) => window.showActionToast?.(...args);

  const updateDeckCode_ =
    (...args) => window.DeckPostApi?.updateDeckCode_?.(...args);

  // =========================
  // 1) デッキ解説プリセット
  // =========================
  const DECKNOTE_PRESETS = {
    'deck-overview':
`【デッキ概要】
どんなコンセプトで作ったか、狙いの動きなど。
例
このデッキは〇〇を軸に△△を狙う構築です。□□とのシナジーが強力で、序盤から中盤にかけて盤面を制圧し、終盤は☆☆でフィニッシュを狙います。

【キーカード】
主軸となるカード・シナジー解説。
※詳しい解説はカード解説欄でも可
例
- 〇〇：このデッキのエースカード。□□とのコンボで大ダメージを狙えます。

【リーサルプラン】
ライフ30点をどのように削るか、代表的な勝ち筋など。
例
8-8-8-6,10-10-10,8-10-10(+2) など。
`,

    'play-guide':
`【マリガン基準】
初手で意識するカード、キープ基準など。
例
序盤使う→キープ
終盤、メタカード→マリガン

【試合の立ち回り】
試合の全体的な流れや意識するポイントなど。
〈序盤〉

〈中盤〉

〈終盤〉

【プレイのコツ】
状況判断やよくあるミスなど。
例
- △△を使うタイミングは重要。□□がある場合は早めに展開すること。
`,

    'matchup':
`
【相性一覧】
〈有利対面〉
〈不利対面〉

【採用候補、対策カード】
今回採用しなかったカードについて。
環境・メタに合わせた検討予知など。
例
- △△：強力だが、□□とのシナジーが薄いため見送り。環境に○○が増えたら再検討。
`,

    'results':
`【使用環境】
使用期間・レート帯・環境など（例：シーズン〇〇／レート1600帯）

【戦績】
総試合数・勝敗（ざっくりでもOK）

【課題・改善点】
苦手な対面や構築上の弱点、今後調整したい点。

【まとめ】
使ってみた全体の印象、成果や気づきなど。`,
  };

  // =========================
  // 2) プリセット追記
  // =========================
  /**
   * appendPresetToTextarea_(ta, presetKey)
   * - テキストエリア末尾にプリセットを追記
   * - 空欄ならそのまま挿入
   */
  function appendPresetToTextarea_(ta, presetKey) {
    if (!ta) return;

    const preset = DECKNOTE_PRESETS[presetKey];
    if (!preset) return;

    const cur = ta.value || '';

    if (!cur.trim()) {
      ta.value = preset;
    } else {
      const sep = cur.endsWith('\n') ? '\n' : '\n\n';
      ta.value = cur + sep + preset;
    }

    ta.focus();
  }

  // =========================
  // 3) デッキ解説：編集開始
  // =========================
  /**
   * openDeckNoteEdit_(section)
   * - 表示モード → 編集モードへ切り替える
   */
  function openDeckNoteEdit_(section) {
    const view = section?.querySelector('.decknote-view');
    const editor = section?.querySelector('.decknote-editor');
    if (!section || !view || !editor) return;

    view.hidden = true;
    editor.hidden = false;
  }

  // =========================
  // 4) デッキ解説：キャンセル
  // =========================
  /**
   * cancelDeckNoteEdit_(section)
   * - textarea を original に戻して閉じる
   */
  function cancelDeckNoteEdit_(section) {
    const view = section?.querySelector('.decknote-view');
    const editor = section?.querySelector('.decknote-editor');
    const ta = section?.querySelector('.decknote-textarea');
    if (!section || !view || !editor || !ta) return;

    const original = ta.dataset.original ?? '';
    ta.value = original;

    editor.hidden = true;
    view.hidden = false;
  }

  // =========================
  // 5) デッキ解説：保存
  // =========================
  /**
   * saveDeckNoteEdit_(section, root, saveBtn)
   * - deckNote を保存
   * - 成功時に view / state を更新
   */
  async function saveDeckNoteEdit_(section, root, saveBtn) {
    const view = section?.querySelector('.decknote-view');
    const editor = section?.querySelector('.decknote-editor');
    const ta = section?.querySelector('.decknote-textarea');
    if (!section || !view || !editor || !ta || !root || !saveBtn) return;

    const postId = String(root.dataset.postid || '').trim();
    if (!postId) return;

    const raw = String(ta.value || '').trim();
    const origRaw = String(ta.dataset.original ?? '').trim();

    // 変更なし
    if (raw === origRaw) {
      editor.hidden = true;
      view.hidden = false;
      showActionToast_('変更はありません');
      return;
    }

    const prevText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';

    try {
      const res = await updateDeckNote_(postId, raw);
      if (!res || !res.ok) {
        alert((res && res.error) || '保存に失敗しました');
        return;
      }

      view.innerHTML = raw
        ? (buildDeckNoteHtml(raw) || '')
        : '<div style="color:#777;font-size:.9rem;">まだ登録されていません。</div>';

      ta.dataset.original = raw;

      const item = findItemById_(postId);
      if (item) {
        item.deckNote = raw;
        item.updatedAt = new Date().toISOString();
      }

      editor.hidden = true;
      view.hidden = false;

      showActionToast_('デッキ解説を更新しました');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = prevText;
    }
  }

    // =========================
  // 6) カード解説：選択モーダル
  // =========================
  let __cardNotesPickContext = null; // { rootEl, rowEl, item }

  /**
   * ensureCardNoteSelectModal_()
   * - カード選択モーダルが無ければ生成
   */
  function ensureCardNoteSelectModal_() {
    if (document.getElementById('cardNoteSelectModal')) return;

    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.id = 'cardNoteSelectModal';
    wrap.style.display = 'none';
    wrap.innerHTML = `
      <div class="modal-content cardnote-modal">
        <h3 class="filter-maintitle">カードを選択</h3>
        <div id="cardNoteCandidates" class="cardnote-grid"></div>
        <div class="modal-footer" style="gap:.5rem;">
          <button type="button" id="cardNoteClose" class="modal-buttun">閉じる</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
  }

  /**
   * openCardNoteSelectModal_(candidates)
   * - 候補カード一覧を表示
   * - 既に他行で使用中のカードは disabled
   */
  function openCardNoteSelectModal_(candidates) {
    ensureCardNoteSelectModal_();

    const modal = document.getElementById('cardNoteSelectModal');
    const grid = document.getElementById('cardNoteCandidates');
    const close = document.getElementById('cardNoteClose');
    if (!modal || !grid) return;

    grid.replaceChildren();

    const used = new Set();
    const currentCd = String(
      __cardNotesPickContext?.rowEl?.dataset?.cd || ''
    ).trim().padStart(5, '0');

    try {
      const rootEl = __cardNotesPickContext?.rootEl;
      if (rootEl) {
        rootEl.querySelectorAll('.post-card-note').forEach((row) => {
          const cd = String(row.dataset.cd || '').trim().padStart(5, '0');
          if (cd) used.add(cd);
        });
      }
    } catch (_) {}

    if (currentCd) used.delete(currentCd);

    (candidates || []).forEach((c) => {
      const cd5 = String(c?.cd5 || '').trim().padStart(5, '0');
      if (!cd5) return;

      const cell = document.createElement('div');
      cell.className = 'item';
      cell.dataset.cd = cd5;

      if (used.has(cd5)) {
        cell.classList.add('disabled');
      }

      const img = document.createElement('img');
      img.src = `img/${cd5}.webp`;
      img.alt = c?.name || '';
      img.loading = 'lazy';
      img.onerror = () => {
        img.onerror = null;
        img.src = 'img/00000.webp';
      };

      cell.appendChild(img);
      grid.appendChild(cell);
    });

    modal.style.display = 'flex';

    const onClose = () => {
      modal.style.display = 'none';
      close?.removeEventListener('click', onClose);
    };

    close?.addEventListener('click', onClose);

    modal.addEventListener(
      'click',
      (e) => {
        if (e.target === modal) onClose();
      },
      { once: true }
    );
  }

  // =========================
  // 7) カード解説：値読み書き
  // =========================
  /**
   * readCardNotesFromEditor_(root)
   * - editor内の行を配列へ戻す
   */
  function readCardNotesFromEditor_(root) {
    const rows = Array.from(root.querySelectorAll('.post-card-note'));
    return rows.map((row) => {
      const cd = String(row.dataset.cd || '').trim();
      const ta = row.querySelector('textarea.note');
      const text = ta ? String(ta.value || '') : '';
      return { cd, text };
    });
  }

  /**
   * syncCardNotesHidden_(root)
   * - hidden input にJSONを同期
   */
  function syncCardNotesHidden_(root) {
    const hidden = root.querySelector('.post-card-notes-hidden');
    if (!hidden) return;
    hidden.value = JSON.stringify(readCardNotesFromEditor_(root));
  }

  // =========================
  // 8) カード解説：行UI
  // =========================
  /**
   * makeCardNoteRow_(rowData)
   * - 1行分の編集UIを生成
   */
  function makeCardNoteRow_(rowData) {
    const cdRaw = String(rowData?.cd || '').trim();
    const cd5 = cdRaw ? cdRaw.padStart(5, '0') : '';
    const cardMap = window.cardMap || {};
    const name = cd5
      ? ((cardMap[cd5] || {}).name || 'カード名未登録')
      : 'カードを選択';
    const img = cd5 ? `img/${cd5}.webp` : 'img/00000.webp';

    const div = document.createElement('div');
    div.className = 'post-card-note';
    div.dataset.index = '0';
    div.dataset.cd = cd5;

    div.innerHTML = `
      <div class="left">
        <div class="thumb">
          <img alt="" src="${img}" onerror="this.onerror=null;this.src='img/00000.webp'">
        </div>
        <div class="actions">
          <button type="button" class="note-move" data-dir="-1">↑</button>
          <button type="button" class="note-move" data-dir="1">↓</button>
          <button type="button" class="note-remove">削除</button>
        </div>
      </div>
      <button type="button" class="pick-btn">${window.escapeHtml?.(name) || name}</button>
      <textarea class="note" placeholder="このカードの採用理由・使い方など"></textarea>
    `;

    const ta = div.querySelector('textarea.note');
    if (ta) ta.value = String(rowData?.text || '');

    return div;
  }

  /**
   * renumberCardNoteRows_(root)
   * - 行indexを振り直す
   */
  function renumberCardNoteRows_(root) {
    Array.from(root.querySelectorAll('.post-card-note')).forEach((row, i) => {
      row.dataset.index = String(i);
    });
  }

  /**
   * renderCardNotesRows_(root, list)
   * - 行一覧を描画
   */
  function renderCardNotesRows_(root, list) {
    const box = root.querySelector('.post-card-notes');
    if (!box) return;

    box.replaceChildren();
    (list || []).forEach((rowData) => {
      box.appendChild(makeCardNoteRow_(rowData));
    });

    renumberCardNoteRows_(root);
    syncCardNotesHidden_(root);
  }

  // =========================
  // 9) カード解説：候補生成
  // =========================
  /**
   * getDeckCandidatesFromItem_(item)
   * - 投稿デッキ内のカードだけを候補にする
   * - タイプ → コスト → パワー → cd で並べる
   */
  function getDeckCandidatesFromItem_(item) {
    const cardMap = window.cardMap || {};
    let deck = item?.deck || item?.cardsJSON || item?.cards || null;

    if (typeof deck === 'string') {
      const raw = deck.trim();
      if (raw) {
        try {
          deck = JSON.parse(raw);
        } catch (_) {}
      }
    }

    let cds = [];
    if (deck && typeof deck === 'object' && !Array.isArray(deck)) {
      cds = Object.keys(deck);
    } else if (Array.isArray(deck)) {
      cds = deck.map((x) => String(x?.cd || x || ''));
    }

    const uniq = Array.from(
      new Set(
        cds.map((x) => String(x || '').trim().padStart(5, '0')).filter(Boolean)
      )
    );

    const TYPE_ORDER = {
      'チャージャー': 0,
      'アタッカー': 1,
      'ブロッカー': 2,
    };

    uniq.sort((a, b) => {
      const A = cardMap[a] || {};
      const B = cardMap[b] || {};

      const tA = TYPE_ORDER[A.type] ?? 99;
      const tB = TYPE_ORDER[B.type] ?? 99;
      if (tA !== tB) return tA - tB;

      const costA = A.cost ?? 999;
      const costB = B.cost ?? 999;
      if (costA !== costB) return costA - costB;

      const powA = A.power ?? 999;
      const powB = B.power ?? 999;
      if (powA !== powB) return powA - powB;

      return String(a).localeCompare(String(b));
    });

    return uniq.map((cd5) => ({
      cd5,
      name: (cardMap[cd5] || {}).name || 'カード名未登録',
    }));
  }

  // =========================
  // 10) カード解説：検証
  // =========================
  /**
   * validateCardNotes_(root)
   * - カードを選んだ行はテキスト必須
   */
  function validateCardNotes_(root) {
    const validator = root.querySelector('.post-cardnote-validator');
    if (!validator) return true;

    validator.setCustomValidity('');

    const list = readCardNotesFromEditor_(root);
    const bad = list.find((rowData) => rowData.cd && !String(rowData.text || '').trim());

    if (bad) {
      validator.setCustomValidity(
        'カード解説：カードを選んだ行は、解説も入力してください。'
      );
      validator.reportValidity();
      return false;
    }

    return true;
  }

  // =========================
  // 11) カード解説：editor初期化
  // =========================
  /**
   * initCardNotesEditor_(editorRoot, item)
   * - 右ペイン内のカード解説editorを初期化
   * - 再オープン時は中身だけ再描画
   */
  function initCardNotesEditor_(editorRoot, item) {
    if (!editorRoot) return;

    const initial = Array.isArray(item?.cardNotes) ? item.cardNotes : [];

    if (editorRoot.__bound) {
      renderCardNotesRows_(editorRoot, initial);
      return;
    }
    editorRoot.__bound = true;

    renderCardNotesRows_(editorRoot, initial);

    editorRoot.addEventListener('click', (e) => {
      const target = e.target;

      // 追加
      if (target && target.classList.contains('add-note-btn')) {
        const box = editorRoot.querySelector('.post-card-notes');
        if (!box) return;

        const row = makeCardNoteRow_({ cd: '', text: '' });
        box.appendChild(row);
        renumberCardNoteRows_(editorRoot);
        syncCardNotesHidden_(editorRoot);
        row.querySelector('.pick-btn')?.click();
        return;
      }

      // 削除
      if (target && target.classList.contains('note-remove')) {
        const row = target.closest('.post-card-note');
        row?.remove();
        renumberCardNoteRows_(editorRoot);
        syncCardNotesHidden_(editorRoot);
        return;
      }

      // 移動
      if (target && target.classList.contains('note-move')) {
        const dir = Number(target.dataset.dir || 0);
        const row = target.closest('.post-card-note');
        const box = editorRoot.querySelector('.post-card-notes');
        if (!row || !box || !dir) return;

        if (dir < 0) {
          const prev = row.previousElementSibling;
          if (prev) box.insertBefore(row, prev);
        } else {
          const next = row.nextElementSibling;
          if (next) box.insertBefore(next, row);
        }

        renumberCardNoteRows_(editorRoot);
        syncCardNotesHidden_(editorRoot);
        return;
      }

      // カード選択
      if (target && target.classList.contains('pick-btn')) {
        const row = target.closest('.post-card-note');
        if (!row) return;

        __cardNotesPickContext = {
          rootEl: editorRoot,
          rowEl: row,
          item,
        };

        openCardNoteSelectModal_(getDeckCandidatesFromItem_(item));
      }
    });

    editorRoot.addEventListener('input', (e) => {
      if (e.target && e.target.matches('textarea.note')) {
        syncCardNotesHidden_(editorRoot);
      }
    });
  }

  // =========================
  // 12) カード解説：編集開始 / キャンセル / 保存
  // =========================
  /**
   * openCardNotesEdit_(section, root)
   * - 表示モード → 編集モードへ切り替える
   */
  function openCardNotesEdit_(section, root) {
    const view = section?.querySelector('.cardnotes-view');
    const editor = section?.querySelector('.cardnotes-editor');
    if (!section || !view || !editor || !root) return;

    const postId = String(root.dataset.postid || '').trim();
    const item = findItemById_(postId) || {};

    initCardNotesEditor_(editor, item);

    view.hidden = true;
    editor.hidden = false;
  }

  /**
   * cancelCardNotesEdit_(section)
   * - original の内容へ戻す
   */
  function cancelCardNotesEdit_(section) {
    const view = section?.querySelector('.cardnotes-view');
    const editor = section?.querySelector('.cardnotes-editor');
    if (!section || !view || !editor) return;

    let original = [];
    try {
      original = JSON.parse(editor.dataset.original || '[]') || [];
    } catch (_) {
      original = [];
    }

    renderCardNotesRows_(editor, original);

    editor.hidden = true;
    view.hidden = false;
  }

  /**
   * saveCardNotesEdit_(section, root, saveBtn)
   * - カード解説を保存
   */
  async function saveCardNotesEdit_(section, root, saveBtn) {
    const view = section?.querySelector('.cardnotes-view');
    const editor = section?.querySelector('.cardnotes-editor');
    if (!section || !view || !editor || !root || !saveBtn) return;

    const postId = String(root.dataset.postid || '').trim();
    if (!postId) return;

    if (!validateCardNotes_(editor)) return;

    editor.querySelectorAll('.post-card-note').forEach((row) => {
      const cd = String(row.dataset.cd || '').trim();
      if (!cd) row.remove();
    });
    renumberCardNoteRows_(editor);
    syncCardNotesHidden_(editor);

    const listRaw = readCardNotesFromEditor_(editor)
      .map((rowData) => ({
        cd: String(rowData.cd || '').trim().padStart(5, '0'),
        text: String(rowData.text || '').replace(/\r\n/g, '\n').trim(),
      }))
      .filter((rowData) => !!rowData.cd);

    const normalizeNotes_ = (arr) => {
      const list = Array.isArray(arr) ? arr : [];
      return list
        .map((x) => ({
          cd: String(x?.cd || '').trim().padStart(5, '0'),
          text: String(x?.text || '').replace(/\r\n/g, '\n').trim(),
        }))
        .filter((x) => !!x.cd);
    };

    let origList = [];
    try {
      origList = JSON.parse(editor.dataset.original || '[]') || [];
    } catch (_) {
      origList = [];
    }

    const nextNorm = normalizeNotes_(listRaw);
    const origNorm = normalizeNotes_(origList);

    if (JSON.stringify(nextNorm) === JSON.stringify(origNorm)) {
      editor.hidden = true;
      view.hidden = false;
      showActionToast_('変更はありません');
      return;
    }

    const prevText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';

    try {
      const res = await window.DeckPostApi?.updateCardNotes_?.(postId, listRaw);
      if (!res || !res.ok) {
        alert((res && res.error) || '保存に失敗しました');
        return;
      }

      const item = findItemById_(postId);
      if (item) {
        item.cardNotes = listRaw;
        item.updatedAt = new Date().toISOString();
      }

      const buildCardNotesHtml =
        (...args) => window.DeckPostDetail?.buildCardNotesHtml?.(...args);

      view.innerHTML = buildCardNotesHtml({ cardNotes: listRaw }) || '';
      editor.dataset.original = JSON.stringify(listRaw);

      editor.hidden = true;
      view.hidden = false;

      showActionToast_('カード解説を更新しました');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = prevText;
    }
  }

    // =========================
    // 13) クリック委任
    // =========================
  /**
   * 右ペインは再描画されるため、document委任で持つ
   */
  document.addEventListener('click', async (e) => {
    const target = e.target;

    // -------------------------
    // ユーザータグ：保存
    // -------------------------
    const utSaveBtn = target.closest('#userTagEditSaveBtn');
    if (utSaveBtn) {
      const modal = document.getElementById('userTagEditModal');
      if (!modal) return;

      const postId = String(modal.dataset.postid || '').trim();
      if (!postId) {
        window.showMiniToast_?.('postId が空です');
        return;
      }

      const chips = modal.querySelectorAll('.chip-user-selected');
      const tagsUser = [...chips]
        .map((chip) => String(chip.textContent || '').replace('×', '').trim())
        .filter(Boolean)
        .join(',');

      const API = window.API;
      const postJSON = window.postJSON;
      const Auth = window.Auth;

      if (!API || !postJSON) {
        window.showMiniToast_?.('API設定（window.API / postJSON）が見つかりません');
        return;
      }

      if (!Auth?.token) {
        alert('ログインが必要です');
        return;
      }

      const body = (typeof Auth.attachToken === 'function')
        ? Auth.attachToken({ postId, tagsUser })
        : { postId, tagsUser, token: Auth.token };

      const keep = utSaveBtn.textContent;
      utSaveBtn.disabled = true;
      utSaveBtn.textContent = '保存中…';

      try {
        const res = await postJSON(`${API}?mode=mineUpdateUserTags`, body).catch(() => null);
        if (!res || res.ok !== true) {
          alert((res && res.error) || '保存に失敗しました');
          return;
        }

        const item = findItemById_(postId);
        if (item) {
          item.tagsUser = tagsUser;
          item.updatedAt = new Date().toISOString();
        }

        // 管理ボックスのボタン状態も更新
        window.DeckPostEditor?.refreshDeckCodeUIs_?.(postId);

        // 一覧 / マイ投稿の再描画
        try {
          window.DeckPostList?.applySortAndRerenderList?.(false);
          await window.DeckPostList?.loadMinePage?.(1);
        } catch (err) {
          console.warn('refresh after userTags update failed:', err);
        }

        modal.style.display = 'none';
        window.showMiniToast_?.('ユーザータグを保存しました');
      } finally {
        utSaveBtn.disabled = false;
        utSaveBtn.textContent = keep;
      }
      return;
    }

    // -------------------------
    // ユーザータグ：編集開始
    // -------------------------
    const utEditBtn = target.closest('.btn-user-tag-edit');
    if (utEditBtn) {
      if (utEditBtn.disabled) return;

      const postId = String(utEditBtn.dataset.postid || '').trim();
      if (!postId) return;

      if (typeof window.openUserTagEditModal_ !== 'function') {
        window.showMiniToast_?.('openUserTagEditModal_ が未定義です');
        return;
      }

      await window.openUserTagEditModal_(postId);
      return;
    }

    // -------------------------
    // プリセット追記
    // -------------------------
    const presetBtn = target.closest('.note-preset-btn');
    if (presetBtn) {
      const section = presetBtn.closest('.post-detail-section');
      const ta = section?.querySelector('.decknote-textarea');
      const presetKey = String(presetBtn.dataset.preset || '').trim();
      appendPresetToTextarea_(ta, presetKey);
      return;
    }

    // -------------------------
    // 編集開始
    // -------------------------
    if (target.matches('.btn-decknote-edit')) {
      const section = target.closest('.post-detail-section');
      openDeckNoteEdit_(section);
      return;
    }

    // -------------------------
    // キャンセル
    // -------------------------
    if (target.matches('.btn-decknote-cancel')) {
      const section = target.closest('.post-detail-section');
      cancelDeckNoteEdit_(section);
      return;
    }

    // -------------------------
    // 保存
    // -------------------------
    if (target.matches('.btn-decknote-save')) {
      const section = target.closest('.post-detail-section');
      const root =
        target.closest('.post-detail-inner') ||
        target.closest('[data-postid]');

      await saveDeckNoteEdit_(section, root, target);
      return;
    }

    // -------------------------
    // カード解説：編集開始
    // -------------------------
    if (target.matches('.btn-cardnotes-edit')) {
      const section = target.closest('.post-detail-section');
      const root =
        target.closest('.post-detail-inner') ||
        target.closest('[data-postid]');

      openCardNotesEdit_(section, root);
      return;
    }

    // -------------------------
    // カード解説：キャンセル
    // -------------------------
    if (target.matches('.btn-cardnotes-cancel')) {
      const section = target.closest('.post-detail-section');
      cancelCardNotesEdit_(section);
      return;
    }

    // -------------------------
    // カード解説：保存
    // -------------------------
    if (target.matches('.btn-cardnotes-save')) {
      const section = target.closest('.post-detail-section');
      const root =
        target.closest('.post-detail-inner') ||
        target.closest('[data-postid]');

      await saveCardNotesEdit_(section, root, target);
      return;
    }


        // -------------------------
    // デッキコード：追加 / 編集
    // -------------------------
    const addBtn = target.closest('.btn-deckcode-add');
    const editBtn = target.closest('.btn-deckcode-edit');
    if (addBtn || editBtn) {
      const root = target.closest('.post-detail-inner');
      const postId =
        root?.dataset?.postid ||
        root?.querySelector('.post-manage-box')?.dataset?.postid ||
        '';
      const cur = editBtn ? (editBtn.dataset.code || '') : '';

      if (!postId) return;

      openDeckCodeModal_(postId, cur);
      return;
    }

    // -------------------------
    // デッキコード：コピー（小）
    // -------------------------
    const copyBtn = target.closest('.btn-deckcode-copy');
    if (copyBtn) {
      const code = copyBtn.dataset.code || '';
      if (!code) return;

      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(code);
          window.showMiniToast_('デッキコードをコピーしました');
        } catch (_) {}
      }
      return;
    }

    // -------------------------
    // デッキコード：削除
    // -------------------------
    const deleteBtn = target.closest('.btn-deckcode-delete');
    if (deleteBtn) {
      const root = target.closest('.post-detail-inner');
      const postId = String(root?.dataset?.postid || '').trim();
      if (!postId) return;

      const ok = confirm('デッキコードを削除します。よろしいですか？');
      if (!ok) return;

      const res = await updateDeckCode_(postId, '');
      if (!res || !res.ok) {
        alert((res && res.error) || '削除に失敗しました');
        return;
      }

      patchItemShareCode_(postId, '');
      refreshDeckCodeUIs_(postId);
      window.showMiniToast_('デッキコードを削除しました');
      return;
    }

    // -------------------------
    // デッキコード：モーダル閉じる
    // -------------------------
    const closeDeckCodeBtn = target.closest('[data-close="deckCodeEditModal"]');
    if (closeDeckCodeBtn) {
      closeDeckCodeModal_();
      return;
    }

    // -------------------------
    // デッキコード：貼り付け
    // -------------------------
    if (target.id === 'deckCodePasteBtn') {
      const modal = document.getElementById('deckCodeEditModal');
      const preview = document.getElementById('deckCodePreview');
      const judge = document.getElementById('deckCodeJudge');
      const save = document.getElementById('deckCodeSaveBtn');
      if (!modal || !preview || !judge || !save) return;

      if (!navigator.clipboard?.readText) {
        alert('この環境ではクリップボードの読み取りができません');
        return;
      }

      try {
        const text = await navigator.clipboard.readText();
        const raw = String(text || '');

        preview.textContent = raw || '（クリップボードが空でした）';

        const ok = isDeckCodeLike_(raw);
        judge.className = 'deckcode-judge ' + (ok ? 'ok' : 'ng');
        judge.textContent = ok
          ? '✅ デッキコード形式です'
          : '❌ デッキコードではありません';

        save.disabled = !ok;
        modal.dataset.candidate = ok ? normalizeDeckCode_(raw) : '';

        if (ok) window.showMiniToast_('クリップボードから貼り付けました');
      } catch (_) {
        alert('クリップボードの読み取りに失敗しました（権限をご確認ください）');
      }
      return;
    }

    // -------------------------
    // デッキコード：保存
    // -------------------------
    if (target.id === 'deckCodeSaveBtn') {
      const modal = document.getElementById('deckCodeEditModal');
      if (!modal) return;

      const postId = modal.dataset.postid || '';
      const code = String(modal.dataset.candidate || '').trim();
      if (!postId) return;

      if (!code || !isDeckCodeLike_(code)) {
        alert('デッキコードではありません（形式が違います）');
        return;
      }

      const res = await updateDeckCode_(postId, code);
      if (!res || !res.ok) {
        alert((res && res.error) || '保存に失敗しました');
        return;
      }

      patchItemShareCode_(postId, code);
      refreshDeckCodeUIs_(postId);
      closeDeckCodeModal_();

      window.showMiniToast_('デッキコードを保存しました');
      return;
    }


  });

    // =========================
    // 14) カード解説：選択モーダル側のクリック委任
    // =========================
  document.addEventListener(
    'click',
    (e) => {
      const cell = e.target?.closest?.('#cardNoteCandidates .item');
      if (!cell || !__cardNotesPickContext) return;
      if (cell.classList.contains('disabled')) return;

      const cd5 = String(cell.dataset.cd || '').trim().padStart(5, '0');
      const cardMap = window.cardMap || {};
      const name = (cardMap[cd5] || {}).name || 'カード名未登録';

      const { rootEl, rowEl } = __cardNotesPickContext;

      rowEl.dataset.cd = cd5;
      rowEl.querySelector('.pick-btn')?.replaceChildren(
        document.createTextNode(name)
      );

      const img = rowEl.querySelector('.thumb img');
      if (img) img.src = `img/${cd5}.webp`;

      syncCardNotesHidden_(rootEl);

      const modal = document.getElementById('cardNoteSelectModal');
      if (modal) modal.style.display = 'none';

      __cardNotesPickContext = null;
    },
    true
  );


    // =========================
  // 15) デッキコード：判定 / UI更新
  // =========================
  /**
   * normalizeDeckCode_(s)
   * - 空白を除去して正規化
   */
  function normalizeDeckCode_(s) {
    return String(s || '').replace(/\s+/g, '').trim();
  }

  /**
   * isDeckCodeLike_(raw)
   * - デッキコードらしい文字列か簡易判定
   */
  function isDeckCodeLike_(raw) {
    const s = normalizeDeckCode_(raw);
    if (!s) return false;
    if (s.length < 40) return false;
    if (s.length > 600) return false;
    if (!/^[A-Za-z0-9+/_=\-]+$/.test(s)) return false;
    return true;
  }

  /**
   * cssEscape_(s)
   * - querySelector用の最低限エスケープ
   */
  function cssEscape_(s) {
    const v = String(s ?? '');
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(v);
    }
    return v.replace(/[^a-zA-Z0-9_\-]/g, (c) => `\\${c}`);
  }


  // =========================
  // 16) デッキコード：管理UI更新
  // =========================
  /**
   * refreshDeckCodeUIs_(postId)
   * - 画面上のデッキコード関連UIを現在stateに合わせて更新
   * - detail側の描画関数を利用する
   */
  function refreshDeckCodeUIs_(postId) {
    const pid = String(postId || '').trim();
    if (!pid) return;

    const item = findItemById_(pid) || { postId: pid, shareCode: '' };
    const codeNorm = String(item.shareCode || '').trim();

    const buildDeckCodeBoxHtml_ =
  (...args) => window.DeckPostEditor?.buildDeckCodeBoxHtml_?.(...args);

    const boxHtml = buildDeckCodeBoxHtml_(pid, codeNorm);
    const escPid = cssEscape_(pid);

    if (boxHtml) {
      document
        .querySelectorAll(`.post-manage-box[data-postid="${escPid}"]`)
        .forEach((el) => {
          el.outerHTML = boxHtml;
        });
    }

    document
      .querySelectorAll(`.post-card[data-postid="${escPid}"]`)
      .forEach((card) => {
        const firstSection = card.querySelector('.post-detail .post-detail-section');
        if (!firstSection) return;

        let body = firstSection.querySelector('.post-detail-code-body');

        if (codeNorm) {
          if (!body) {
            body = document.createElement('div');
            body.className = 'post-detail-code-body';
            body.innerHTML = `
              <button type="button" class="btn-copy-code-wide" data-code="${window.escapeHtml?.(codeNorm) || codeNorm}">
                デッキコードをコピー
              </button>
            `;
            firstSection.appendChild(body);
          } else {
            const btn = body.querySelector('.btn-copy-code-wide');
            if (btn) btn.dataset.code = codeNorm;
          }
        } else {
          if (body) body.remove();
        }
      });
  }

  /**
   * patchItemShareCode_(postId, shareCode)
   * - state上の shareCode を即時更新
   */
  function patchItemShareCode_(postId, shareCode) {
    const pid = String(postId || '').trim();

    const patch = (item) => {
      if (!item) return;
      if (String(item.postId || '') === pid) {
        item.shareCode = String(shareCode || '');
      }
    };

    const state = window.DeckPostState?.getState?.() || window.__DeckPostState || null;
    if (!state) return;

    (state.list?.items || []).forEach(patch);
    (state.list?.allItems || []).forEach(patch);
    (state.mine?.items || []).forEach(patch);
  }

  // =========================
  // 17) デッキコード：モーダル開閉
  // =========================
  /**
   * openDeckCodeModal_(postId, currentCode)
   * - 編集モーダルを開く
   */
  function openDeckCodeModal_(postId, currentCode) {
    const modal = document.getElementById('deckCodeEditModal');
    const preview = document.getElementById('deckCodePreview');
    const judge = document.getElementById('deckCodeJudge');
    const save = document.getElementById('deckCodeSaveBtn');
    const paste = document.getElementById('deckCodePasteBtn');
    if (!modal || !preview || !judge || !save || !paste) return;

    modal.dataset.postid = String(postId || '');

    const cur = normalizeDeckCode_(currentCode);
    modal.dataset.original = cur;
    modal.dataset.candidate = '';

    preview.textContent = cur
      ? String(currentCode || '')
      : 'ここにデッキコードが表示されます';

    judge.className = 'deckcode-judge';
    judge.textContent = cur
      ? '登録済みです（更新する場合は「クリップボードから貼り付け」を押してください）'
      : '未貼り付けです（「クリップボードから貼り付け」を押してください）';

    save.disabled = true;
    paste.disabled = false;

    modal.style.display = 'flex';
  }

  /**
   * closeDeckCodeModal_()
   * - 編集モーダルを閉じる
   */
  function closeDeckCodeModal_() {
    const modal = document.getElementById('deckCodeEditModal');
    if (modal) modal.style.display = 'none';
  }



    // =========================
  // 18) デッキコード：管理ボックスHTML
  // =========================
  /**
   * buildDeckCodeBoxHtml_(postId, codeNorm)
   * - マイ投稿用のデッキコード管理UI
   * - ユーザータグ編集ボタンもここでまとめて出す
   */
  function buildDeckCodeBoxHtml_(postId, codeNorm) {
    const code = String(codeNorm || '').trim();
    const isSet = !!code;
    const badgeClass = isSet ? 'is-set' : 'is-empty';
    const badgeText = isSet ? '登録済み' : '未登録';
    const preview = isSet
      ? `${code.slice(0, 8)}...${code.slice(-6)}`
      : '貼り付けると、他の人がすぐデッキを使えます';

    const it = findItemById_(postId) || {};
    const tagsUserArr = String(it?.tagsUser || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const userTagCount = tagsUserArr.length;
    const canAddUserTag = userTagCount < 3;
    const userTagBtnText = canAddUserTag
      ? '✍️ ユーザータグ追加'
      : '✅ ユーザータグ上限です';

    return `
      <div class="post-manage-box" data-postid="${window.escapeHtml?.(postId || '') || String(postId || '')}">
        <div class="post-manage-head">
          <div class="deckcode-status">
            <div class="deckcode-title">デッキコード管理</div>
            <span class="deckcode-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="deckcode-preview">${window.escapeHtml?.(preview) || preview}</div>
        </div>

        <div class="post-manage-actions">
          ${isSet ? `
            <button type="button" class="modal-buttun btn-deckcode-copy" data-code="${window.escapeHtml?.(code) || code}">コピー</button>
            <button type="button" class="modal-buttun btn-deckcode-edit" data-code="${window.escapeHtml?.(code) || code}">編集</button>
            <button type="button" class="modal-buttun btn-deckcode-delete">削除</button>
          ` : `
            <button type="button" class="modal-buttun btn-deckcode-add">＋追加</button>
          `}
        </div>

        <div class="post-manage-head">
          <div class="deckcode-status">
            <div class="deckcode-title">ユーザータグ管理</div>
          </div>
        </div>

        <div class="post-manage-actions">
          <button
            type="button"
            class="modal-buttun btn-user-tag-edit ${canAddUserTag ? '' : 'is-disabled'}"
            data-postid="${window.escapeHtml?.(postId || '') || String(postId || '')}"
            ${canAddUserTag ? '' : 'disabled'}
            aria-disabled="${canAddUserTag ? 'false' : 'true'}">
            ${userTagBtnText}
          </button>
        </div>
      </div>
    `;
  }

  // =========================
  // 19) ユーザータグ編集モーダル
  // =========================
  /**
   * bindUserTagEditModal_()
   * - 追加専用のユーザータグ編集モーダルを初期化
   * - window.openUserTagEditModal_ を提供
   */
  (function bindUserTagEditModal_() {
    const modal = document.getElementById('userTagEditModal');
    const qEl = document.getElementById('userTagEditQuery');
    const sugWrap = document.querySelector('#userTagEditSuggest [data-user-tag-items]');
    const sugEmpty = document.querySelector('#userTagEditSuggest [data-user-tag-empty]');
    const selWrap = document.querySelector('#userTagEditSelectedArea [data-user-tag-selected-items]');
    const selEmpty = document.querySelector('#userTagEditSelectedArea [data-user-tag-selected-empty]');
    const btnSave = document.getElementById('userTagEditSaveBtn');
    const btnX = document.getElementById('userTagEditCloseBtn');
    const btnCancel = document.getElementById('userTagEditCancelBtn');
    const MAX_USER_TAGS = 3;

    if (!modal || !qEl || !sugWrap || !selWrap || !btnSave) return;

    const st = { postId: '', locked: new Set(), added: new Set() };

    function showMiniToastSafe_(text) {
      if (typeof window.showMiniToast_ === 'function') {
        window.showMiniToast_(text);
        return;
      }
      if (typeof window.showActionToast === 'function') {
        window.showActionToast(text);
        return;
      }
    }

    function open_() {
      modal.style.display = 'flex';
      qEl.focus();
    }

    function close_() {
      modal.style.display = 'none';
    }

    function getAllSelected_() {
      return new Set([...st.locked, ...st.added]);
    }

    function isFull_() {
      return getAllSelected_().size >= MAX_USER_TAGS;
    }

    function rejectIfFull_() {
      if (!isFull_()) return false;
      showMiniToastSafe_('ユーザータグは3つまでです');
      return true;
    }

    function normalizeNewTag_(raw) {
      const t = String(raw || '').trim();
      if (!t) return '';
      return (t.length > 24) ? t.slice(0, 24) : t;
    }

    function collectAllUserTagCandidates_() {
      const items =
        window.DeckPostState?.getState?.()?.list?.allItems ||
        window.__DeckPostState?.list?.allItems ||
        [];

      const set = new Set();
      (items || []).forEach((it) => {
        String(it?.tagsUser || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((t) => set.add(t));
      });

      return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
    }

    function renderSelected_() {
      selWrap.replaceChildren();

      const all = [...getAllSelected_()].sort((a, b) => a.localeCompare(b, 'ja'));

      for (const tag of all) {
        const chip = document.createElement('span');
        chip.className = 'chip chip-user-selected';
        chip.textContent = tag;

        if (st.locked.has(tag)) {
          chip.classList.add('chip-user-locked');
        } else {
          const x = document.createElement('button');
          x.type = 'button';
          x.className = 'chip-x';
          x.textContent = '×';
          x.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            st.added.delete(tag);
            renderSelected_();
            renderSuggest_(qEl.value);
          });
          chip.appendChild(x);
        }

        selWrap.appendChild(chip);
      }

      if (selEmpty) selEmpty.style.display = all.length ? 'none' : '';
    }

    function renderSuggest_(query) {
      sugWrap.replaceChildren();

      const q = normalizeNewTag_(query).toLowerCase();
      const selected = getAllSelected_();
      const all = collectAllUserTagCandidates_();

      const rows = all.filter((tag) => {
        if (selected.has(tag)) return false;
        if (!q) return true;
        return tag.toLowerCase().includes(q);
      });

      rows.slice(0, 20).forEach((tag) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-btn';
        btn.textContent = tag;

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (rejectIfFull_()) return;
          if (st.locked.has(tag)) return;

          st.added.add(tag);
          qEl.value = '';
          renderSelected_();
          renderSuggest_('');
        });

        sugWrap.appendChild(btn);
      });

      if (sugEmpty) sugEmpty.style.display = rows.length ? 'none' : '';
    }

    qEl.addEventListener('input', () => renderSuggest_(qEl.value));

    qEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;

      e.preventDefault();
      e.stopPropagation();

      if (rejectIfFull_()) return;

      const t = normalizeNewTag_(qEl.value);
      if (!t) return;
      if (st.locked.has(t)) {
        qEl.value = '';
        return;
      }

      st.added.add(t);
      qEl.value = '';
      renderSelected_();
      renderSuggest_('');
    });

    window.openUserTagEditModal_ = async function(postId) {
      const state = window.DeckPostState?.getState?.() || window.__DeckPostState || {};
      const hasAllItems = !!state?.list?.hasAllItems;

      if (!hasAllItems && typeof window.DeckPostList?.applySortAndRerenderList === 'function') {
        try {
          // 候補が足りない時の保険。失敗しても続行。
          await window.DeckPostList?.applySortAndRerenderList?.(false);
        } catch (_) {}
      }

      const items =
        window.DeckPostState?.getState?.()?.list?.allItems ||
        window.__DeckPostState?.list?.allItems ||
        [];

      const item = items.find((x) => String(x.postId) === String(postId));
      const raw = String(item?.tagsUser || '').trim();
      const lockedArr = raw
        ? raw.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      st.postId = String(postId || '');
      st.locked = new Set(lockedArr);
      st.added = new Set();

      if (st.locked.size >= MAX_USER_TAGS) {
        showMiniToastSafe_('この投稿はユーザータグが3つ付いています');
        return;
      }

      qEl.value = '';
      renderSelected_();
      renderSuggest_('');
      modal.dataset.postid = String(postId || '');
      open_();
    };

    btnX?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close_();
    });

    btnCancel?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close_();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) close_();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        close_();
      }
    });
  })();


    // =========================
    // 20) 公開API
    // =========================
    window.DeckPostEditor = window.DeckPostEditor || {};

    window.DeckPostEditor.DECKNOTE_PRESETS = DECKNOTE_PRESETS;
    window.DeckPostEditor.appendPresetToTextarea_ = appendPresetToTextarea_;
    window.DeckPostEditor.openDeckNoteEdit_ = openDeckNoteEdit_;
    window.DeckPostEditor.cancelDeckNoteEdit_ = cancelDeckNoteEdit_;
    window.DeckPostEditor.saveDeckNoteEdit_ = saveDeckNoteEdit_;
    window.DeckPostEditor.ensureCardNoteSelectModal_ = ensureCardNoteSelectModal_;
    window.DeckPostEditor.openCardNoteSelectModal_ = openCardNoteSelectModal_;
    window.DeckPostEditor.readCardNotesFromEditor_ = readCardNotesFromEditor_;
    window.DeckPostEditor.syncCardNotesHidden_ = syncCardNotesHidden_;
    window.DeckPostEditor.makeCardNoteRow_ = makeCardNoteRow_;
    window.DeckPostEditor.renumberCardNoteRows_ = renumberCardNoteRows_;
    window.DeckPostEditor.renderCardNotesRows_ = renderCardNotesRows_;
    window.DeckPostEditor.getDeckCandidatesFromItem_ = getDeckCandidatesFromItem_;
    window.DeckPostEditor.validateCardNotes_ = validateCardNotes_;
    window.DeckPostEditor.initCardNotesEditor_ = initCardNotesEditor_;
    window.DeckPostEditor.openCardNotesEdit_ = openCardNotesEdit_;
    window.DeckPostEditor.cancelCardNotesEdit_ = cancelCardNotesEdit_;
    window.DeckPostEditor.saveCardNotesEdit_ = saveCardNotesEdit_;
    window.DeckPostEditor.normalizeDeckCode_ = normalizeDeckCode_;
    window.DeckPostEditor.isDeckCodeLike_ = isDeckCodeLike_;
    window.DeckPostEditor.cssEscape_ = cssEscape_;
    window.DeckPostEditor.refreshDeckCodeUIs_ = refreshDeckCodeUIs_;
    window.DeckPostEditor.patchItemShareCode_ = patchItemShareCode_;
    window.DeckPostEditor.openDeckCodeModal_ = openDeckCodeModal_;
    window.DeckPostEditor.closeDeckCodeModal_ = closeDeckCodeModal_;
    window.DeckPostEditor.buildDeckCodeBoxHtml_ = buildDeckCodeBoxHtml_;
    window.DeckPostEditor.openUserTagEditModal_ = window.openUserTagEditModal_;
})();