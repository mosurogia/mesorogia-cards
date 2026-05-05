// js/pages/deckmaker/deckmaker-post.js
/**
 * DeckMaker / Post (page-only)
 *
 * 【役割】
 * - 投稿フォーム制御（submit / validation）
 * - 投稿タグ（選択タグ・ユーザータグ・自動カテゴリタグ）
 * - payload生成（ビルダー群：buildDeckPostPayload / buildDeckFeaturesForPost）
 * - 成功/失敗UI（toast, success-check, success-modal）
 *
 * 【やらないこと】
 * - キャンペーンの可否判定・確認モーダル（deckmaker-campaign.js に集約）
 */
(function(){
  'use strict';

  const GAS_POST_ENDPOINT = window.DECKPOST_API_BASE || window.GAS_API_BASE;
  let isPostingDeck = false;

  // =====================================================
  // 0) 小物：バリデーション / X正規化 / ヘルプ / サブタブ
  // =====================================================

  // --- Poster name validation (from page2) ---
  function looksLikeEmail_(s){
    const t = String(s || '').trim();
    if (!t) return false;
    const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    return re.test(t);
  }

  function validatePosterNameOrThrow_(name){
    const t = String(name || '').trim();

    // @ / メールを禁止（連絡先混入抑止）
    if (/[＠@]/.test(t) || looksLikeEmail_(t)) {
      throw new Error('投稿者名にメールアドレス（または@）は入れられません。表示名だけにしてください。');
    }
    // URLっぽいのも抑止（任意）
    if (/https?:\/\//i.test(t)) {
      throw new Error('投稿者名にURLは入れられません。表示名だけにしてください。');
    }
    return t;
  }

  // buildDeckPostPayload / submitDeckPost が window.validatePosterNameOrThrow_ を見るので公開（重要）
  window.validatePosterNameOrThrow_ = window.validatePosterNameOrThrow_ || validatePosterNameOrThrow_;

  // --- X handle normalize ---
  function normalizeHandle(v=''){
    let s = String(v || '').trim();
    if (!s) return '';
    try { s = s.normalize('NFKC'); } catch(_) {}
    s = s.replace(/\s+/g, '');
    s = s.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i, '');
    s = s.split(/[/?#]/)[0];
    s = s.replace(/[＠@]/g, '');
    if (!s) return '';
    return '@' + s;
  }

  function isValidXHandle(norm){
    const user = String(norm || '').replace(/^@/, '');
    return /^[A-Za-z0-9_]{1,15}$/.test(user);
  }

  function normalizeXInput_(){
    const xEl = document.getElementById('auth-x');
    if (!xEl) return '';
    const norm = normalizeHandle(xEl.value || '');
    if (norm) xEl.value = norm;
    return norm;
  }

  function normalizeGameUserId_(value){
    return String(value || '')
      .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/\D/g, '')
      .slice(0, 16);
  }

  // --- Post flow help modal ---
  function openPostFlowHelp(){
    const modal = document.getElementById('postFlowHelpModal');
    if (modal) modal.style.display = 'flex';
  }
  function closePostFlowHelp(){
    const modal = document.getElementById('postFlowHelpModal');
    if (modal) modal.style.display = 'none';
  }

  // 互換公開（すでにやってるのはOK。まとめてここに置くと散らばらない）
  window.openPostFlowHelp = window.openPostFlowHelp || openPostFlowHelp;

  function setupPostFlowHelpModal_(){
    const btnTop   = document.getElementById('post-flow-help-btn-top');
    const btnForm  = document.getElementById('post-flow-help-btn-form');
    const btnClose = document.getElementById('post-flow-help-close');
    const modal    = document.getElementById('postFlowHelpModal');

    btnTop?.addEventListener('click', openPostFlowHelp);
    btnForm?.addEventListener('click', openPostFlowHelp);
    btnClose?.addEventListener('click', closePostFlowHelp);

    modal?.addEventListener('click', (e) => {
      if (e.target === modal) closePostFlowHelp();
    });
  }

  // --- Exclusive subtabs ---
  function setupExclusiveSubtabs_(){
    const tabRoot = document.getElementById('post-tab') || document;

    tabRoot.querySelectorAll('[data-subtab-target]').forEach(btn => {
      if (btn.__exclusiveBound) return;
      btn.__exclusiveBound = true;

      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-subtab-target');
        if (!targetId) return;

        tabRoot.querySelectorAll('[data-subtab-target]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        tabRoot.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));
        const panel = tabRoot.querySelector(`#${CSS.escape(targetId)}`);
        if (panel) panel.classList.add('active');
      });
    });
  }


  // =====================================================
  // 1) read/write payload用のタグ・ノート読み書き
  // =====================================================
  function readPostNote(){
    return document.getElementById('post-note')?.value || '';
  }
  function writePostNote(v){
    const el = document.getElementById('post-note');
    if (el) el.value = v || '';
  }

  // =====================================================
  // 1.5) デッキ解説プリセット（共通定義を参照）
  // =====================================================

  const NOTE_PRESETS = window.DeckNotePresets?.templates || {};

  // =====================================================
  // D) デッキ解説：全画面モーダル（noteFullModal）
  // =====================================================
  function openNoteFull_(){
    const modal = document.getElementById('noteFullModal');
    const src = document.getElementById('post-note');
    const dst = document.getElementById('note-full-text');
    if (!modal || !src || !dst) return;

    dst.value = src.value || '';

    // 右ペイン：デッキ一覧を軽量レンダリング
    const side = document.getElementById('note-side-list');
    if (side){
      side.innerHTML = '';
      const entries = Object.entries(window.deck || {});
      entries.sort(([a],[b]) => String(a).localeCompare(String(b)));

      for (const [cd, n] of entries){
        const row = document.createElement('div');
        row.className = 'note-card-row';
        row.dataset.cardId = cd;
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '56px 1fr auto';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.margin = '4px 0';

        const img = document.createElement('img');
        const cd5 = window.normCd5 ? window.normCd5(cd) : String(cd ?? '').trim().padStart(5,'0').slice(0,5);
        img.alt = '';
        img.loading = 'lazy';
        img.src = `img/${cd5}.webp`;
        img.onerror = () => { img.src = 'img/00000.webp'; };
        img.style.width = '56px';
        img.style.borderRadius = '6px';

        const name = document.createElement('div');
        name.textContent = (window.cardMap?.[cd]?.name) || cd;
        name.style.fontSize = '.95rem';

        const qty = document.createElement('div');
        qty.textContent = '×' + n;
        qty.style.opacity = '.8';

        row.addEventListener('click', () => {
          const rect = row.getBoundingClientRect();
          if (typeof window.openCardDetailModal === 'function') {
            window.openCardDetailModal(cd, { anchorRect: rect });
          } else {
            document.dispatchEvent(new CustomEvent('open-card-detail', { detail: { cardId: cd, anchorRect: rect } }));
          }
        });

        row.appendChild(img);
        row.appendChild(name);
        row.appendChild(qty);
        side.appendChild(row);
      }
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeNoteFull_(){
    const modal = document.getElementById('noteFullModal');
    const src = document.getElementById('post-note');
    const dst = document.getElementById('note-full-text');
    if (!modal || !src || !dst) return;

    src.value = dst.value || '';
    src.dispatchEvent(new Event('input', { bubbles:true })); // autosave連動

    modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  // デッキ名と note-side-title の双方向同期
  function bindDeckNameSyncInNote_(){
    const infoDeckName  = document.getElementById('info-deck-name');
    const postDeckName  = document.getElementById('post-deck-name');
    const noteSideTitle = document.getElementById('note-side-title');

    function setAll(name){
      const v = String(name || '');
      if (infoDeckName && infoDeckName.value !== v) infoDeckName.value = v;
      if (postDeckName && postDeckName.value !== v) postDeckName.value = v;
      if (noteSideTitle && noteSideTitle.textContent !== v) noteSideTitle.textContent = v || 'デッキリスト';
    }

    infoDeckName?.addEventListener('input', ()=> setAll(infoDeckName.value));
    postDeckName?.addEventListener('input', ()=> setAll(postDeckName.value));

    if (noteSideTitle){
      noteSideTitle.addEventListener('click', ()=>{
        noteSideTitle.setAttribute('contenteditable', 'true');
        const range = document.createRange();
        range.selectNodeContents(noteSideTitle);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
        noteSideTitle.focus();
      });
      noteSideTitle.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter'){ e.preventDefault(); noteSideTitle.blur(); }
      });
      noteSideTitle.addEventListener('blur', ()=>{
        noteSideTitle.setAttribute('contenteditable', 'false');
        setAll(noteSideTitle.textContent.trim());
      });
    }

    setAll(postDeckName?.value || infoDeckName?.value || '');
  }

  function bindNoteFullModal_(){
    document.getElementById('note-fullscreen-btn')?.addEventListener('click', openNoteFull_);
    document.getElementById('note-full-close')?.addEventListener('click', closeNoteFull_);
    document.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape' && document.getElementById('noteFullModal')?.style.display === 'flex') closeNoteFull_();
    });

    bindDeckNameSyncInNote_();
  }

  function insertPresetToRange_(el, text, range){
    if (window.DeckNotePresets?.insertText) {
      window.DeckNotePresets.insertText(el, text, range);
    }
  }

  function getNotePresetTarget_(){
    const modalEl = document.getElementById('noteFullModal');
    const isFullOpen = !!modalEl && getComputedStyle(modalEl).display !== 'none';
    return isFullOpen
      ? document.getElementById('note-full-text')
      : document.getElementById('post-note');
  }

  function openNoteCardRefPicker_(){
    const target = getNotePresetTarget_();
    if (!target) return;

    const range = {
      start: target.selectionStart ?? target.value.length,
      end: target.selectionEnd ?? target.value.length
    };

    if (typeof window.openCardPickModal !== 'function') {
      alert('カード選択モーダルを読み込めませんでした');
      return;
    }

    window.openCardPickModal({
      onPicked: (picked) => {
        const name = String(picked?.name || '').trim();
        if (!name) return;
        insertPresetToRange_(target, `[[${name}]]`, range);
      }
    });
  }

  window.DeckNotePresets?.bindPresetUi?.({
    key: 'deckmakerPost',
    getTarget: getNotePresetTarget_,
    openCardRefPicker: openNoteCardRefPicker_
  });

    // =====================================================
  // 1.6) カード解説（post-card-notes）モジュール（page2から移植）
  // - 重要：DOMが無い状態で初期化しないため、init() を用意して initPost() から呼ぶ
  // - 保存：#post-card-notes-hidden に JSON を常にミラー
  // - 操作：追加/削除/上下移動/カード選択（モーダル）
  // =====================================================

  const CardNotes = (() => {
    const MAX = 20;

    /** @type {{cd:string, text:string}[]} */
    let cardNotes = [];
    let pickingIndex = -1;
    let _bound = false;

    // --- 要素取得ヘルパ ---
    const elWrap       = () => document.getElementById('post-card-notes');
    const elHidden     = () => document.getElementById('post-card-notes-hidden');
    const elModal      = () => document.getElementById('cardNoteSelectModal'); // 既存の候補モーダル
    const elCandidates = () => document.getElementById('cardNoteCandidates');  // ↑内のグリッド

    const cdToImg = (cd) => {
      const cd5 = window.normCd5 ? window.normCd5(cd) : String(cd ?? '').trim().padStart(5,'0').slice(0,5);
      return `img/${cd5 || '00000'}.webp`;
    };
    const cdToName = (cd) => (window.cardMap?.[cd]?.name) || '';

    // --- deck からユニークcd一覧（候補用） ---
    function currentDeckUniqueCds() {
      const d = window.deck || {};
      const list = Object.entries(d)
        .filter(([, n]) => (n | 0) > 0)
        .map(([cd]) => window.normCd5 ? window.normCd5(cd) : String(cd).padStart(5, '0').slice(0, 5));
      // unique
      return Array.from(new Set(list));
    }

    // --- 並び（タイプ→コスト→パワー→cd）っぽい感じに寄せる（軽量） ---
    function sortByRule(list) {
      const map = window.cardMap || window.allCardsMap || {};
      const typeOrder = { 'チャージャー': 0, 'アタッカー': 1, 'ブロッカー': 2 };
      return list.sort((a, b) => {
        const A = map[a] || {};
        const B = map[b] || {};
        const ta = typeOrder[A.type] ?? 9;
        const tb = typeOrder[B.type] ?? 9;
        if (ta !== tb) return ta - tb;
        const ca = Number(A.cost) || 0, cb = Number(B.cost) || 0;
        if (ca !== cb) return ca - cb;
        const pa = Number(A.power) || 0, pb = Number(B.power) || 0;
        if (pa !== pb) return pa - pb;
        return String(a).localeCompare(String(b));
      });
    }

    function ensureImg(imgEl, cd) {
      imgEl.alt = '';
      imgEl.loading = 'lazy';
      imgEl.src = cdToImg(cd);
      imgEl.onerror = () => { imgEl.src = 'img/00000.webp'; };
    }

    function syncHidden() {
      const hid = elHidden();
      if (!hid) return;

      // 空行は UI としては残してよいが、保存は「cdかtextがある行」だけに寄せる
      const cleaned = (cardNotes || [])
        .map(r => ({ cd: String(r.cd || ''), text: String(r.text || '') }))
        .filter(r => r.cd || r.text);

      try { hid.value = JSON.stringify(cleaned); } catch (_) { hid.value = '[]'; }
      window.scheduleAutosave?.();
    }

    // --- 外部へ渡すAPI ---
    function replace(arr) {
      cardNotes = Array.isArray(arr)
        ? arr.map(r => ({ cd: String(r.cd || ''), text: String(r.text || '') }))
        : [];
      renderRows();
    }
    function get() { return cardNotes.slice(); } // 互換
    function getList() { return get(); }         // 互換

    // --- 行操作 ---
    function addRow() {
      if ((cardNotes?.length || 0) >= MAX) {
        alert(`カード解説は最大${MAX}行までです`);
        return;
      }
      cardNotes.push({ cd: '', text: '' });
      renderRows();
    }

    function removeRow(i) {
      cardNotes.splice(i, 1);
      renderRows();
    }

    function moveRow(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= cardNotes.length) return;
      const tmp = cardNotes[i];
      cardNotes[i] = cardNotes[j];
      cardNotes[j] = tmp;
      renderRows();
    }

    // --- 描画 ---
    function renderRows() {
      const root = elWrap();
      if (!root) return;

      root.innerHTML = '';

      cardNotes.forEach((row, i) => {
        const cd = String(row.cd || '');
        const item = document.createElement('div');
        item.className = 'post-card-note';
        item.dataset.index = String(i);
        item.dataset.cd = cd;

        const cardName = cdToName(cd) || 'カードを選択';

        item.innerHTML = `
          <div class="left">
            <div class="thumb">
              <img alt="" src="${cdToImg(cd)}" onerror="this.src='img/00000.webp'">
            </div>
            <div class="actions">
              <button type="button" class="note-move" data-dir="-1" title="上へ">↑</button>
              <button type="button" class="note-move" data-dir="1"  title="下へ">↓</button>
              <button type="button" class="note-remove" title="削除">削除</button>
            </div>
          </div>

          <div class="right">
            <div class="title-row">
              <button type="button" class="pick-btn">${cardName}</button>
            </div>
            <textarea class="note" rows="2" placeholder="このカードの採用理由・使い方など"></textarea>
          </div>
        `;

        // テキスト反映 & 入力で保存
        const ta = item.querySelector('textarea.note');
        ta.value = row.text || '';
        ta.addEventListener('input', () => {
          if (cardNotes[i]) cardNotes[i].text = ta.value;
          syncHidden();
        });

        // 画像クリックでもピッカー
        item.querySelector('.thumb img')?.addEventListener('click', () => openPickerFor(i));

        root.appendChild(item);
      });

      syncHidden();
    }

    // --- カード選択（候補モーダル） ---
    function showPickerModal(open) {
      const m = elModal();
      if (m) m.style.display = open ? 'block' : 'none';
    }

    function pickCard(cd) {
      if (pickingIndex < 0) return;
      cardNotes[pickingIndex].cd = String(cd);
      renderRows();
      showPickerModal(false);
      pickingIndex = -1;
    }

    function openPickerFor(index) {
      syncHidden();
      pickingIndex = index | 0;

      const list = currentDeckUniqueCds();
      if (!list.length) {
        alert('デッキが空です。先にカードを追加してください。');
        return;
      }

      // 他行で既に選ばれているカードは重複選択を抑制
      const used = new Set(
        cardNotes
          .filter((_, i) => i !== pickingIndex)
          .map(r => String(r.cd))
          .filter(Boolean)
      );

      const grid = elCandidates();
      if (!grid) return;

      grid.innerHTML = '';
      sortByRule(list.slice()).forEach(cd => {
        const wrap = document.createElement('div');
        wrap.className = 'item' + (used.has(cd) ? ' disabled' : '');
        wrap.dataset.cd = cd;

        const img = document.createElement('img');
        ensureImg(img, cd);
        wrap.appendChild(img);

        if (!used.has(cd)) wrap.addEventListener('click', () => pickCard(cd));
        grid.appendChild(wrap);
      });

      showPickerModal(true);
    }

    // --- init：hiddenから読み、空なら1行作って描画 ---
    function init() {
      const wrap = elWrap();
      const hid  = elHidden();
      if (!wrap || !hid) return;

      try {
        const raw = (hid.value || '[]');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          cardNotes = arr.map(r => ({ cd: String(r.cd || ''), text: String(r.text || '') }));
        }
      } catch (_) {}

      if (!cardNotes.length) cardNotes = [{ cd: '', text: '' }];
      renderRows();

      // クリック委任（追加/削除/上下/ピッカー/閉じる）
      if (!_bound) {
        _bound = true;
        document.addEventListener('click', (e) => {
          if (e.target?.id === 'add-card-note') {
            e.preventDefault();
            addRow();
            return;
          }

          const rowEl = e.target.closest?.('.post-card-note');
          if (rowEl) {
            const idx = rowEl.dataset.index | 0;
            if (e.target.matches('.note-remove')) { removeRow(idx); return; }
            if (e.target.matches('.note-move')) {
              const dir = parseInt(e.target.dataset.dir, 10) || 0;
              moveRow(idx, dir);
              return;
            }
            if (e.target.matches('.pick-btn, .thumb img')) { openPickerFor(idx); return; }
          }

          // モーダル閉じる
          if (
            e.target?.id === 'cardNoteClose' ||
            (e.target?.id === 'cardNoteSelectModal' && e.target === elModal())
          ) {
            showPickerModal(false);
            pickingIndex = -1;
          }
        });
      }
    }

    return { init, replace, get, getList, addRow };
  })();

  // 互換公開（buildDeckPostPayload が CardNotes.getList を見る）
  window.CardNotes = window.CardNotes || CardNotes;

  // page2互換：read/writeCardNotes が呼ばれても壊れないように
  window.readCardNotes = window.readCardNotes || function () {
    try { return window.CardNotes?.getList?.() || []; } catch { return []; }
  };
  window.writeCardNotes = window.writeCardNotes || function (val) {
    try { window.CardNotes?.replace?.(Array.isArray(val) ? val : []); } catch (_) {}
  };

  // =====================================================
  // 2) tags（ユーザータグ） - 整理版
  // 仕様：
  // - #user-tags の .chip.user-chip の dataset.key を正とする
  // - 最大3 / 重複排除 / trim正規化
  // - クリックで削除（page2互換）＋ ×ボタンでも削除（既存互換）
  // - 履歴（localStorage） + onUserTagAddedフック
  // =====================================================
  const UserTags = (() => {
    const MAX_TAGS = 3;
    const USER_TAG_HISTORY_KEY = 'dm_user_tag_history_v1';

    function elBox_() { return document.getElementById('user-tags'); }
    function elInput_() { return document.getElementById('user-tag-input'); }
    function elAddBtn_() { return document.getElementById('user-tag-add'); }

    function normalize_(s) {
      // page2互換：全角スペース含めて空白を潰す
      return String(s ?? '')
        .replace(/　+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function read() {
      const box = elBox_();
      if (!box) return [];

      const tags = Array.from(box.querySelectorAll('.chip.user-chip'))
        .map(ch => normalize_(ch.dataset?.key || ''))
        .filter(Boolean);

      // 念のため上限 & 重複排除
      return Array.from(new Set(tags)).slice(0, MAX_TAGS);
    }

    function write(arr) {
      const box = elBox_();
      if (!box) return;

      const tags = Array.isArray(arr)
        ? Array.from(new Set(arr.map(normalize_).filter(Boolean))).slice(0, MAX_TAGS)
        : [];

      // 他コードが参照しても壊れないように保持（任意）
      window.PostUserTags = tags;

      box.innerHTML = '';

      for (const t of tags) {
        const chip = document.createElement('span');
        chip.className = 'chip user-chip active';
        chip.dataset.key = t;

        // 表示テキストはテキストノードにして、read() が textContent 互換に依存しないようにする
        chip.appendChild(document.createTextNode(t));

        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'rm';
        rm.textContent = '×';

        const removeThis = () => {
          chip.remove();
          window.PostUserTags = read();
          window.scheduleAutosave?.();
        };

        // 既存互換：×ボタンでも削除（バブリング抑止）
        rm.addEventListener('click', (e) => {
          e.stopPropagation();
          removeThis();
        });

        chip.appendChild(rm);
        box.appendChild(chip);
      }
    }

    // --- 履歴 ---
    function getHistory() {
      try {
        const raw = localStorage.getItem(USER_TAG_HISTORY_KEY) || '[]';
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.map(normalize_).filter(Boolean);
      } catch (_) {}
      return [];
    }

    function pushHistory(tag) {
      const t = normalize_(tag);
      if (!t) return;

      let list = getHistory().filter(x => x !== t);
      list.unshift(t);
      if (list.length > 20) list = list.slice(0, 20);

      try { localStorage.setItem(USER_TAG_HISTORY_KEY, JSON.stringify(list)); } catch (_) {}
    }

    // どこからでも呼べるフック（既存があれば上書きしない）
    function ensureHook_() {
      window.onUserTagAdded = window.onUserTagAdded || function(tag) {
        pushHistory(tag);
      };
    }

    // --- UI（入力→追加） ---
    function bindUI() {
      if (window.__dmUserTagUiBound) return;
      window.__dmUserTagUiBound = true;

      const box = elBox_();
      const input = elInput_();
      const addBtn = elAddBtn_();
      if (!box || !input || !addBtn) return;

      ensureHook_();

      function addTag(raw) {
        const v = normalize_(raw != null ? raw : input.value);
        if (!v) return;

        const now = read(); // DOMが正
        if (now.includes(v)) { input.value = ''; return; }

        if (now.length >= MAX_TAGS) {
          alert('ユーザータグは最大3個までです');
          return;
        }

        now.push(v);
        write(now);

        try { window.onUserTagAdded?.(v); } catch (_) {}
        input.value = '';
        window.scheduleAutosave?.();
      }

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addTag();
        }
      });

      addBtn.addEventListener('click', () => addTag());
    }

    return { read, write, bindUI, getHistory, pushHistory };
  })();

  // --- 互換公開（既存呼び出しを壊さない） ---
  function readUserTags() { return UserTags.read(); }
  function writeUserTags(arr) { UserTags.write(arr); }

  // page2互換：候補機能が getUserTagHistory() を直参照する想定
  window.getUserTagHistory = window.getUserTagHistory || function() {
    return UserTags.getHistory();
  };

  // onUserTagAdded が無い環境でも履歴が動くよう保険（既存があれば上書きしない）
  window.onUserTagAdded = window.onUserTagAdded || function(tag) {
    UserTags.pushHistory(tag);
  };

  // initPost() から呼ぶ用（従来の bindUserTagUI_ 互換）
  function bindUserTagUI_() { UserTags.bindUI(); }


  // =====================================================
  // 3) tags（選択タグ） - 整理版（SelectTags module）
  // 仕様：
  // - localStorage に選択状態を保存（dm_post_select_tags_v1）
  // - 候補：基本タグ + デッキ内カテゴリ（五十音） + キャンペーンタグ（先頭） + コラボ（末尾）
  // - 外部連携：deckmaker-campaign.js から read/write できる互換APIを提供
  // =====================================================
  const SelectTags = (() => {
    const KEY = 'dm_post_select_tags_v1';

    const elRoot = () => document.getElementById('select-tags');

    function normalize_(s) {
      return String(s ?? '').replace(/\s+/g, ' ').trim();
    }

    function readSet_() {
      try {
        const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr.map(normalize_).filter(Boolean));
      } catch (_) {
        return new Set();
      }
    }

    function writeSet_(setOrArr) {
      const arr = Array.isArray(setOrArr)
        ? setOrArr
        : Array.from(setOrArr || []);
      const cleaned = Array.from(new Set(arr.map(normalize_).filter(Boolean)));
      try { localStorage.setItem(KEY, JSON.stringify(cleaned)); } catch (_) {}
      return new Set(cleaned);
    }

    // デッキ内カテゴリタグ化
    function getDeckCategoryTags_() {
      const d = window.deck || {};
      const map = window.cardMap || window.allCardsMap || {};
      const bad = new Set(['ノーカテゴリ', 'なし', '-', '－', '', null, undefined]);

      const set = new Set();
      for (const [cd, n] of Object.entries(d)) {
        if (!(n | 0)) continue;
        const c = map[cd] || map[window.normCd5 ? window.normCd5(cd) : String(cd).padStart(5,'0')] || null;
        const cat = c?.category;
        const s = normalize_(cat);
        if (!s || bad.has(s)) continue;
        set.add(s);
      }
      return Array.from(set);
    }

    // コラボ判定：cardMap.pack / dataset.pack どちらでも
    function hasCollabInDeck_() {
      const d = window.deck || {};
      const keys = Object.keys(d || {});
      if (!keys.length) return false;

      const map = window.cardMap || window.allCardsMap || {};

      // 1) まず cardMap / allCardsMap の pack を優先
      for (const cd of keys) {
        if (!(d[cd] | 0)) continue;
        const c = map[cd] || map[window.normCd5 ? window.normCd5(cd) : String(cd).padStart(5,'0')] || null;
        const pack = normalize_(c?.pack).toLowerCase();
        if (pack && /コラボ|collab/.test(pack)) return true;
      }

      // 2) フォールバック：一覧DOMの dataset.pack
      for (const cd of keys) {
        if (!(d[cd] | 0)) continue;
        const el = document.querySelector(`.card[data-cd="${CSS.escape(cd)}"]`);
        const pack = normalize_(el?.dataset?.pack).toLowerCase();
        if (pack && /コラボ|collab/.test(pack)) return true;
      }

      return false;
    }

    // 候補生成：基本 + カテゴリ（五十音） + campaign（先頭） + collab（末尾）
    function buildCandidates_() {
      const baseCandidates = Array.isArray(window.POST_TAG_CANDIDATES)
        ? window.POST_TAG_CANDIDATES.map(normalize_).filter(Boolean)
        : [];

      const categoryTags = getDeckCategoryTags_()
        .sort((a, b) => (window.getCategoryOrder?.(a) ?? 9999) - (window.getCategoryOrder?.(b) ?? 9999));

      const merged = [];
      const seen = new Set();

      for (const t of baseCandidates) {
        if (!t || seen.has(t)) continue;
        merged.push(t); seen.add(t);
      }
      for (const t of categoryTags) {
        if (!t || seen.has(t)) continue;
        merged.push(t); seen.add(t);
      }

      // campaign tag（先頭）
      const campTag = normalize_(window.__activeCampaignTag || '');
      if (campTag && !seen.has(campTag)) {
        merged.unshift(campTag);
        seen.add(campTag);
      }

      // collab（末尾）
      if (hasCollabInDeck_() && !seen.has('コラボカードあり')) {
        merged.push('コラボカードあり');
      }

      return merged;
    }

    // タグの（五十音改行）ラップ
    function formatLabel_(label) {
      // 重要：XSS対策
      const esc = window.escapeHtml_;
      return esc(String(label)).replace(/（/g, '<br>（');
    }

    function render() {
      const root = elRoot();
      if (!root) return;

      const selected = readSet_();
      const candidates = buildCandidates_();

      // UI再構築
      root.innerHTML = '';

      const hint = document.createElement('div');
      hint.className = 'post-hint';
      hint.textContent = '⇩タップでさらにタグを追加';
      root.appendChild(hint);

      const frag = document.createDocumentFragment();
      for (const label of candidates) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.dataset.label = label;
        chip.dataset.tag = label;
        chip.innerHTML = formatLabel_(label);
        if (selected.has(label)) chip.classList.add('active');

        chip.addEventListener('click', () => {
          if (window.handleCampaignTagAttempt_?.(label) === false) return;
          const now = readSet_(); // 常に最新
          const on = chip.classList.toggle('active');
          if (on) now.add(label);
          else now.delete(label);
          writeSet_(now);
          window.scheduleAutosave?.();
        });

        frag.appendChild(chip);
      }
      root.appendChild(frag);

      // 外部から取得するAPI（必要最低限）
      window.getSelectedPostTags = () => Array.from(readSet_());
    }

    function clear() {
      writeSet_([]);
      const root = elRoot();
      if (root) root.querySelectorAll('.chip.active').forEach(ch => ch.classList.remove('active'));
    }

    function setSelected(arr) {
      const set = writeSet_(Array.isArray(arr) ? arr : []);
      // UIがあるなら反映
      const root = elRoot();
      if (root) {
        root.querySelectorAll('.chip').forEach(ch => {
          const label = normalize_(ch.dataset.label || ch.dataset.tag || ch.textContent);
          ch.classList.toggle('active', set.has(label));
        });
      }
    }

    // deckmaker-campaign.js 連携用（命名互換）
    // ✅ deckmaker-campaign.js は Set 前提で .has() を呼ぶので、ここは Set を返す
    function __dmReadSelectedTags() { return readSet_(); }

    // ✅ 書き込みは Array / Set どっちでも受ける
    function __dmWriteSelectedTags(setOrArray) {
      const arr = Array.isArray(setOrArray) ? setOrArray : Array.from(setOrArray || []);
      setSelected(arr);
    }

    // deckmaker-campaign.js より後に読み込まれた場合でも、deckmaker-post.js（SelectTags）を本命にする
    window.__dmReadSelectedTags  = __dmReadSelectedTags;
    window.__dmWriteSelectedTags = __dmWriteSelectedTags;

    return { render, clear, setSelected, getSelected: __dmReadSelectedTags };
  })();

  async function renderPostSelectTags(){
    // 互換：外から呼ばれても動くように
    try { SelectTags.render(); } catch (e) { console.error(e); }
  }

  // =====================================================
  // 4) UI：同意チェック
  // =====================================================
  function bindMinimalAgreeCheck(){
    const agree  = document.getElementById('post-agree');
    const submit = document.getElementById('post-submit');
    if (!agree || !submit) return;

    const sync = () => {
      const ok = !!agree.checked;
      submit.disabled = !ok;
      submit.classList.toggle('is-disabled', !ok);
    };

    agree.addEventListener('change', sync);
    sync();
  }

  // =====================================================
  // 5) リセット
  // =====================================================
  function resetDeckPostForm(){
    const ok = window.confirm('投稿フォームの内容をすべて初期化します。\nよろしいですか？');
    if (!ok) return;

    const nameInput = document.getElementById('post-deck-name');
    if (nameInput) nameInput.value = '';

    writePostNote('');

    const notesWrap   = document.getElementById('post-card-notes');
    const notesHidden = document.getElementById('post-card-notes-hidden');
    if (notesWrap)   notesWrap.innerHTML = '';
    if (notesHidden) notesHidden.value = '[]';

    try { SelectTags.clear(); } catch (_) {}

    const userTagsHidden = document.getElementById('post-user-tags-hidden');
    if (userTagsHidden) userTagsHidden.value = '';
    writeUserTags([]);

    const pastedPreview = document.getElementById('pasted-code-preview');
    const clearBtn      = document.getElementById('btn-clear-code');
    const shareHidden   = document.getElementById('post-share-code');
    const deckCodeHidden = document.getElementById('post-deck-code');
    if (pastedPreview) pastedPreview.textContent = '（未設定）';
    if (clearBtn)      clearBtn.disabled = true;
    if (shareHidden)   shareHidden.value = '';
    if (deckCodeHidden) deckCodeHidden.value = window.exportDeckCode?.() || '';

    const agree = document.getElementById('post-agree');
    if (agree) agree.checked = false;

    const submit = document.getElementById('post-submit');
    if (submit){
      submit.disabled = true;
      submit.classList.add('is-disabled');
    }

    window.refreshPostSummary?.();
    window.scheduleAutosave?.();
  }

  // =====================================================
  // 6) 成功チェック
  // =====================================================
  function showSuccessCheck(){
    const el = document.getElementById('success-check');
    if (!el) return;

    el.style.display = 'flex';
    el.style.animation = 'popin 0.25s ease forwards';
    setTimeout(() => { el.style.animation = 'fadeout 0.5s ease forwards'; }, 1800);
    setTimeout(() => { el.style.display = 'none'; }, 2400);
  }

  // =====================================================
  // 7) 投稿トースト表示
  // =====================================================
  function renderPersistToastHtml_(message){
    const esc = window.escapeHtml_;
    const safe = esc(message ?? '');

    return `
      <div>${safe}</div>
      <div style="margin-top:6px;font-size:0.8em;opacity:0.85">
        📸 エラーが続く場合は、このメッセージのスクリーンショットをご提出ください。
      </div>
      <div style="text-align:right;margin-top:8px;">
        <button id="toast-close-btn" style="
          background:#fff;color:#333;border:none;border-radius:6px;
          padding:4px 8px;cursor:pointer;font-size:0.75rem;">閉じる</button>
      </div>
    `;
  }

  function showPostToast(message, type = 'success', persist = false) {
    const box = document.getElementById('post-toast');
    if (!box) return;

    if (persist) box.innerHTML = renderPersistToastHtml_(message);
    else box.textContent = String(message ?? '');

    box.className = 'post-toast ' + type;
    box.style.display = 'block';

    if (persist) {
      document.getElementById('toast-close-btn')?.addEventListener('click', () => {
        box.style.display = 'none';
        box.innerHTML = '';
      });
      return;
    }

    clearTimeout(window._postToastTimer);
    window._postToastTimer = setTimeout(() => { box.style.display = 'none'; }, 3500);
  }

  // =====================================================
  // 8) 投稿成功モーダル（deckmaker-post.jsで完結）
  // =====================================================
  let _lastPostedId = '';

  function openPostSuccessModal(opts = {}) {
    const modal = document.getElementById('postSuccessModal');
    if (!modal) return;

    const nameEl = document.getElementById('post-success-deck-name');
    const deckName = (opts.deckName || (window.readDeckNameInput?.() || '').trim());
    if (nameEl) nameEl.textContent = deckName || '（デッキ名）';

    _lastPostedId = String(opts.postId || '');
    modal.dataset.postId = _lastPostedId;

    const campBox  = document.getElementById('post-success-campaign');
    const campText = document.getElementById('post-success-campaign-text');
    const camp     = opts.campaign || null;

    if (campBox && campText) {
      if (camp && (camp.isActive === true || String(camp.isActive) === 'true') && String(camp.campaignId || '')) {
        const title = String(camp.title || 'キャンペーン');
        const start = camp.startAt ? new Date(camp.startAt) : null;
        const end   = camp.endAt   ? new Date(camp.endAt)   : null;
        const fmt = (d) => (d && !isNaN(d)) ? window.formatYmd?.(d) || '' : '';
        const range = (start || end) ? `（${fmt(start)}〜${fmt(end)}）` : '';
        campText.textContent = `${title}${range}`;
        campBox.style.display = '';
      } else {
        campBox.style.display = 'none';
      }
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    if (typeof window.updatePostSuccessPreview === 'function') {
      window.updatePostSuccessPreview().catch(err => console.error('post-success preview error:', err));
    }
  }

  function initPostSuccessModal() {
    const modal = document.getElementById('postSuccessModal');
    if (!modal || modal.__bound) return;
    modal.__bound = true;

    const closeBtn  = document.getElementById('post-success-close');
    const openPosts = document.getElementById('post-success-open-posts');
    const tweetBtn  = document.getElementById('post-success-tweet');
    const genImgBtn = document.getElementById('post-success-gen-image');

    const closeModal = () => {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    };

    closeBtn?.addEventListener('click', closeModal);

    openPosts?.addEventListener('click', () => {
      closeModal();
      location.href = 'deck-post.html';
    });

    genImgBtn?.addEventListener('click', () => {
      try {
        if (typeof window.exportDeckImage === 'function') window.exportDeckImage();
        else if (window.DeckImg && typeof window.DeckImg.export === 'function') window.DeckImg.export();
        else if (window.DeckImg && typeof window.DeckImg.exportDeckImage === 'function') window.DeckImg.exportDeckImage();
        else alert('画像生成機能が見つかりませんでした。上部の「画像生成」ボタンをお使いください。');
      } catch (e) {
        console.error('post-success image gen error:', e);
        alert('画像生成中にエラーが発生しました。');
      }
    });

    tweetBtn?.addEventListener('click', () => {
      const deckName = (window.readDeckNameInput?.() || document.getElementById('post-success-deck-name')?.textContent || '').trim();
      const baseText = deckName ? `【神託のメソロギア】「${deckName}」デッキを投稿しました！` : '【神託のメソロギア】デッキを投稿しました！';
      const hashtags = '#神託のメソロギア #メソロギアデッキ';
      const text = `${baseText}\n${hashtags}`;
      const url = 'https://mosurogia.github.io/mesorogia-cards/deck-post.html';

      const intent =
        'https://twitter.com/intent/tweet?text=' +
        encodeURIComponent(text) +
        '&url=' +
        encodeURIComponent(url);

      window.open(intent, '_blank', 'noopener');
    });
  }

  (function bootPostSuccessModal(){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPostSuccessModal);
    else initPostSuccessModal();
  })();

  // =====================================================
  // 追記：投稿成功モーダル内：画像プレビュー（任意の共通関数がある場合のみ）
  // =====================================================
  async function updatePostSuccessPreview(){
    const container = document.getElementById('post-success-preview');
    if (!container) return;
    container.innerHTML = '';

    // デッキが空の場合は何もしない
    const deckObj = window.deck || {};
    const total = Object.values(deckObj).reduce((a,b)=> a + (b|0), 0);
    if (!total) return;

    // common-page24.js 側で公開されている想定（無ければ何もしない）
    //後々要チェックしてほしい
    if (typeof window.buildShareNodeForPreview       !== 'function' ||
        typeof window.buildDeckSummaryDataForPreview !== 'function' ||
        typeof window.getCanvasSpecForPreview        !== 'function') {
      return;
    }

    const data   = window.buildDeckSummaryDataForPreview();
    const aspect = '3:4';
    const kinds  = data.uniqueList ? data.uniqueList.length : 0;
    const spec   = window.getCanvasSpecForPreview(aspect, kinds);
    spec.cols = 5;

    try{
      const node = await window.buildShareNodeForPreview(data, spec);

      node.style.position = 'relative';
      node.style.left = '0';
      node.style.top  = '0';

      const containerWidth = container.clientWidth || spec.width;
      let scale = containerWidth / spec.width;
      if (scale > 1) scale = 1;

      container.style.width  = `${spec.width  * scale}px`;
      container.style.height = `${spec.height * scale}px`;
      container.style.overflow = 'hidden';

      node.style.width  = `${spec.width}px`;
      node.style.height = `${spec.height}px`;
      node.style.transformOrigin = 'top left';
      node.style.transform = `scale(${scale})`;

      container.appendChild(node);

    }catch(err){
      console.error('updatePostSuccessPreview error:', err);
    }
  }

  window.updatePostSuccessPreview = window.updatePostSuccessPreview || updatePostSuccessPreview;

  // デバッグ：投稿なしで成功モーダル確認
  window.debugShowPostSuccessModal = window.debugShowPostSuccessModal || async function(deckName){
    let campaign = null;
    try { campaign = await (window.fetchActiveCampaign?.() || Promise.resolve(null)); }
    catch(_){ campaign = null; }

    window.openPostSuccessModal?.({
      deckName: (deckName || (window.readDeckNameInput?.() || '').trim() || 'テスト用デッキ'),
      campaign,
    });
  };

  // =====================================================
  // 9) デッキ特徴量（コスト/タイプ/タイプ別パワー）を投稿用にまとめる
  // - 32本ヒスト：0..30 + 31+
  // =====================================================
  function buildDeckFeaturesForPost() {
    const deckObj = window.deck || {};
    const entries = Object.entries(deckObj).filter(([, n]) => (n | 0) > 0);

    const HLEN = 32, LIM = 31;
    const hCost = new Array(HLEN).fill(0);

    const byType = { Chg: [], Atk: [], Blk: [] };
    const typeMix = { Chg: 0, Atk: 0, Blk: 0 };

    const getCardLocal = (cd) => {
      const cd5 = window.normCd5 ? window.normCd5(cd) : String(cd ?? '').padStart(5, '0').slice(0, 5);
      return window.cardMap?.[cd5] || window.cardMap?.[String(cd)] || null;
    };

    for (const [cd, nRaw] of entries) {
      const cnt = nRaw | 0;
      const c = getCardLocal(cd) || {};
      const costN = Number(c.cost) || 0;
      const powerN = Number(c.power) || 0;

      const costBin = Math.max(0, Math.min(LIM, costN));
      hCost[costBin] += cnt;

      const typeKey =
        (c.type === 'チャージャー') ? 'Chg' :
        (c.type === 'アタッカー')  ? 'Atk' :
        (c.type === 'ブロッカー')  ? 'Blk' : null;

      if (typeKey) {
        typeMix[typeKey] += cnt;
        for (let i = 0; i < cnt; i++) byType[typeKey].push(powerN);
      }
    }

    function hist32(arr) {
      const h = new Array(HLEN).fill(0);
      arr.forEach(v => {
        const p = Math.max(0, Math.min(LIM, Number(v) || 0));
        h[p] += 1;
      });
      return h;
    }

    const typePower = {
      Chg: { hist: hist32(byType.Chg), sum: byType.Chg.reduce((a, b) => a + b, 0), n: byType.Chg.length },
      Atk: { hist: hist32(byType.Atk), sum: byType.Atk.reduce((a, b) => a + b, 0), n: byType.Atk.length },
      Blk: { hist: hist32(byType.Blk), sum: byType.Blk.reduce((a, b) => a + b, 0), n: byType.Blk.length },
    };
    ['Chg', 'Atk', 'Blk'].forEach(k => {
      const o = typePower[k];
      o.avg = o.n ? (o.sum / o.n) : 0;
    });

    return {
      costHistJSON: JSON.stringify(hCost),
      costHistV: 1,
      typeMixJSON: JSON.stringify([typeMix.Chg, typeMix.Atk, typeMix.Blk]),
      typePowerHistJSON: JSON.stringify(typePower),
      typePowerHistV: 1
    };
  }

  // =====================================================
  // 10) 投稿ペイロード（フォーム値）構築
  // =====================================================
  function buildDeckPostPayload() {
    const infoNameEl = document.getElementById('info-deck-name');
    const postNameEl = document.getElementById('post-deck-name');

    const title =
      postNameEl?.value?.trim() ||
      infoNameEl?.value?.trim() ||
      '';
    const comment = document.getElementById('post-note')?.value.trim() || '';
    const code =
      document.getElementById('post-deck-code')?.value?.trim() ||
      window.exportDeckCode?.() ||
      '';
    const races   =
      document.getElementById('post-races-hidden')?.value ||
      (typeof window.getMainRacesInDeck === 'function' ? window.getMainRacesInDeck().join(',') : '');
    const mainRace = typeof window.getMainRace === 'function' ? window.getMainRace() : '';
    const raceKey = typeof window.buildRaceKey === 'function' ? window.buildRaceKey() : '';
    const g = typeof window.getRaceCode === 'function' ? window.getRaceCode() : 1;
    const repImg  = document.getElementById('post-rep-img')?.value || '';
    const shareCode = document.getElementById('post-share-code')?.value.trim() || '';

    console.log('[post payload check]', {
      title,
      code,
      races,
      raceKey,
      g,
      shareCode
    });

    // 投稿者名
    let posterInp = '';
    try {
      const el = document.getElementById('auth-display-name');
      if (el) {
        posterInp = (typeof window.validatePosterNameOrThrow_ === 'function')
          ? window.validatePosterNameOrThrow_(el.value)
          : (el.value || '').trim();
        el.value = posterInp;
      }
    } catch (e) {
      throw e; // submit側でtoast
    }

    // X（正規化）
    let posterXIn = '';
    try {
      posterXIn = normalizeXInput_();
    } catch (_) {}

    // カード解説
    let cardNotes = [];
    try {
      if (window.CardNotes && typeof window.CardNotes.getList === 'function') {
        cardNotes = window.CardNotes.getList();
      } else {
        const hidden = document.getElementById('post-card-notes-hidden');
        if (hidden && hidden.value) {
          const arr = JSON.parse(hidden.value);
          if (Array.isArray(arr)) {
            cardNotes = arr.map(r => ({ cd: String(r.cd || ''), text: String(r.text || '') }));
          }
        }
      }
    } catch (_) { cardNotes = []; }

    // auth情報（あれば）
    const A = window.Auth || {};
    const token = A.token || '';
    const user  = A.user || null;

    const posterName = posterInp || user?.displayName || user?.username || '';
    const posterX    = posterXIn || user?.x || '';
    const username   = user?.username || '';

    // 枚数
    const count = (() => {
      try {
        if (typeof window.getDeckCount === 'function') return window.getDeckCount() | 0;
        const d = window.deck || {};
        return Object.values(d).reduce((a, n) => a + (n | 0), 0);
      } catch(_) { return 0; }
    })();

    // タグ（page2互換）
    const autoTags = Array.from(document.querySelectorAll('#auto-tags .chip[data-auto="true"]'))
      .map(el => el.textContent.trim()).filter(Boolean);

    const selectTags = Array.from(document.querySelectorAll('#select-tags .chip.active'))
      .map(el => (el.dataset.label || el.dataset.tag || el.textContent || '').trim())
      .filter(Boolean);

    const userTags = (() => {
      try {
        const tags = readUserTags();
        return Array.isArray(tags) ? tags.slice(0, 3) : [];
      } catch (_) { return []; }
    })();

    const gameUserId = (() => {
      try {
        return String(window.CampaignUI?.readCampaignGameUserId_?.() || '').trim();
      } catch (_) {
        return '';
      }
    })();

    return {
      title, comment, code, count, races, raceKey, mainRace, g, repImg,
      cardNotes,
      shareCode,
      ua: navigator.userAgent,
      autoTags,
      selectTags,
      userTags,
      gameUserId,
      token,
      poster: { name: posterName, x: posterX, username },
    };
  }

  // =====================================================
  // 11) deckmaker-post.js 単体で submit を完結させる（キャンペーン込み）
  //  ※ CampaignUI があればそちらのモーダルを優先
  // =====================================================
  async function handlePostSubmit_(e){
    e?.preventDefault();

    // ✅ deckmaker-campaign.js がいるならそっちに委譲（確認モーダル付き）
    if (window.CampaignUI && typeof window.CampaignUI.onClickPostButton === 'function'){
      await window.CampaignUI.onClickPostButton();
      return false;
    }

    // ✅ deckmaker-campaign.js が無いときは通常投稿
    return submitDeckPost(e, { joinCampaign: false, campaign: null });
  }

  // =====================================================
  // 12) submit 本体
  // =====================================================
  async function submitDeckPost(e, opts = {}){
    e?.preventDefault();

    if (isPostingDeck){
      showPostToast('投稿処理中です。完了までお待ちください。', 'info');
      return false;
    }
    isPostingDeck = true;

    const form = document.getElementById('deck-post-form');
    if (form && !form.reportValidity()){
      isPostingDeck = false;
      return false;
    }

    // 投稿前チェック（page2互換）
    const msgs = window.validateDeckBeforePost?.() || [];
    if (msgs.length){
      showPostToast(msgs.join('\n'), 'danger', true);
      isPostingDeck = false;
      return false;
    }

    try{
      const nameEl = document.getElementById('auth-display-name');
      if (nameEl){
        if (typeof window.validatePosterNameOrThrow_ === 'function') {
          nameEl.value = window.validatePosterNameOrThrow_(nameEl.value);
        } else {
          nameEl.value = String(nameEl.value || '').trim();
        }
      }

      normalizeXInput_();
    }catch(err){
      showPostToast(err?.message || '入力内容を確認してください', 'danger', true);
      isPostingDeck = false;
      return false;
    }

    // 代表カード未選択チェック
    const repValidator = document.getElementById('post-rep-validator');
    if (repValidator){
      repValidator.setCustomValidity('');
      const hasRep = !!window.representativeCd;
      if (!hasRep){
        repValidator.setCustomValidity('メインカードを選択してください');
        repValidator.reportValidity();
        isPostingDeck = false;
        return false;
      }
    }

    // カード解説未入力チェック
    const cardnoteValidator = document.getElementById('post-cardnote-validator');
    if (cardnoteValidator){
      cardnoteValidator.setCustomValidity('');
      const list = window.CardNotes?.getList?.() || [];

      const hasIncomplete = list.some(r => {
        const cd = String(r.cd || '').trim();
        const text = String(r.text || '').trim();

        // 完全空行は無視
        if (!cd && !text) return false;

        // cdあるのにtext無い → NG
        if (cd && !text) return true;

        return false;
      });

      if (hasIncomplete){
        cardnoteValidator.setCustomValidity('カード解説が未入力の行があります');
        cardnoteValidator.reportValidity();
        isPostingDeck = false;
        return false;
      }
    }

    const btn = document.getElementById('post-submit');
    const spinner = document.getElementById('post-loading');
    if (btn){
      btn.disabled = true;
      btn.textContent = '投稿中…';
    }
    if (spinner) spinner.style.display = 'block';

    // representativeCd が空なら保険で自動補完
    if (!window.representativeCd){
      const d = window.deck || {};
      const cds = Object.entries(d)
        .filter(([, n]) => (n | 0) > 0)
        .map(([cd]) => cd);

      if (cds.length){
        cds.sort((a,b) => (parseInt(a,10)||0) - (parseInt(b,10)||0));
        const autoCd = cds[0];
        try{
          const info = (window.cardMap || window.allCardsMap || {})[autoCd] || {};
          window.setRepresentativeCard?.(autoCd, info.name || '');
        }catch(_){
          window.setRepresentativeCard?.(autoCd, '');
        }
      }
    }

    const base = buildDeckPostPayload();
    const feat = buildDeckFeaturesForPost();
    const payload = { ...base, ...feat };

    if (typeof window.buildCardsForPost_ === 'function'){
      payload.cards = window.buildCardsForPost_();
      payload.cardsJSON = JSON.stringify(payload.cards);
    } else {
      const cardsMap = {};
      try {
        const d = window.deck || {};
        Object.entries(d).forEach(([cd, n]) => {
          n = n | 0;
          if (n > 0) cardsMap[window.normCd5 ? window.normCd5(cd) : String(cd).padStart(5,'0')] = n;
        });
      } catch(_) {}
      payload.cards = cardsMap;
      payload.cardsJSON = JSON.stringify(cardsMap);
    }

    const joinCampaign = !!opts.joinCampaign;
    const camp = opts.campaign || null;
    const isActive = !!(camp && (camp.isActive === true || String(camp.isActive) === 'true') && String(camp.campaignId || ''));
    payload.joinCampaign = joinCampaign;
    payload.campaignId = (joinCampaign && isActive) ? String(camp.campaignId || '') : '';
    payload.gameUserId = normalizeGameUserId_(payload.gameUserId);

    const rules = (() => {
      const raw = camp?.rulesJSON;
      if (!raw) return {};
      if (typeof raw === 'object') return raw || {};
      try { return JSON.parse(String(raw)) || {}; } catch (_) { return {}; }
    })();
    if (joinCampaign && isActive && rules.requireGameUserId && !/^\d{16}$/.test(payload.gameUserId)){
      showPostToast('ゲーム内ユーザーIDは16桁で入力してください', 'danger', true);
      isPostingDeck = false;
      return false;
    }

    payload.repCd = window.representativeCd || '';
    const repCd5 = window.normCd5 ? window.normCd5(payload.repCd) : String(payload.repCd || '').trim().padStart(5, '0').slice(0, 5);
    payload.repImg = repCd5 ? `img/${repCd5}.webp` : '';

    try{
      const res = await fetch(`${GAS_POST_ENDPOINT}?mode=post`, {
        method : 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body   : JSON.stringify(payload),
      });
      let json = null;
      try {
        json = await res.json();
      } catch (_) {
        const txt = await res.text().catch(()=> '');
        throw new Error(`サーバー応答がJSONではありません（status=${res.status}）\n${txt.slice(0,200)}`);
      }

      if (json.ok){
        showPostToast('投稿が完了しました', 'success');
        try { showSuccessCheck(); } catch(_){}

        const deckName =
          (window.readDeckNameInput?.() ||
            document.getElementById('post-deck-name')?.value ||
            '').trim();

        const postId = String(json.postId || '');
        openPostSuccessModal({ deckName, postId, campaign: camp });
        window.MesorogiaPwaInstall?.showNudge?.();
      }else{
        if (json.error === 'too_many_posts'){
          showPostToast('短時間に連続して投稿することはできません。少し時間をおいて再度お試しください。', 'error');
        }else if (json.error === 'dup_post'){
          showPostToast('同じ内容の投稿を二重送信しそうだったのでブロックしました。', 'info');
        }else{
          showPostToast(`投稿失敗：${json.error || '不明なエラー'}`, 'error', true);
        }
      }
    }catch(err){
      console.error(err);
      showPostToast('通信エラーが発生しました', 'error', true);
    }finally{
      if (btn){
        btn.disabled = false;
        btn.textContent = '投稿';
      }
      if (spinner) spinner.style.display = 'none';
      isPostingDeck = false;
    }

    return false;
  }

  // =====================================================
  // 13) 投稿前チェック（page2互換：移植前と同じ仕様）
  // =====================================================
  function validateDeckBeforePost(){
    const msgs = [];

    const n = (() => {
      if (typeof window.getDeckCount === 'function') return window.getDeckCount() | 0;
      const d = window.deck || {};
      return Object.values(d).reduce((a, v) => a + (v | 0), 0);
    })();
    if (n < 30 || n > 40) msgs.push(`枚数が範囲外(${n})`);

    if (typeof window.validateDeckConstraints === 'function') {
      const more = window.validateDeckConstraints();
      if (Array.isArray(more)) msgs.push(...more);
    }

    const infoNameEl = document.getElementById('info-deck-name');
    const postNameEl = document.getElementById('post-deck-name');
    const title =
      (postNameEl?.value?.trim()) ||
      (infoNameEl?.value?.trim()) ||
      '';

    if (!title) msgs.push('デッキ名が未入力');
    if (!document.getElementById('post-agree')?.checked) msgs.push('ガイドライン未同意');

    return msgs;
  }


  // =====================================================
  // 追記：ユーザー用デッキコード貼り付け（軽量判定）
  //　移植予定：デッキ投稿でも使うので将来logic or domに移植予定
  // =====================================================
  function validateDeckCodeLight_(raw){
    const s = String(raw || '').trim();
    if (!s) return { ok:false, reason:'空文字' };
    if (s.length < 60)  return { ok:false, reason:'短すぎ' };
    if (s.length > 400) return { ok:false, reason:'長すぎ' };
    if (/\s/.test(s)) return { ok:false, reason:'空白/改行を含む' };
    if (/https?:\/\//i.test(s)) return { ok:false, reason:'URL形式' };
    if (/^[A-Za-z]{20,}$/.test(s)) return { ok:false, reason:'英字のみの単語' };
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return { ok:false, reason:'文字種/末尾が不正' };

    const padLen = (s.match(/=+$/) || [''])[0].length;
    if (padLen > 2) return { ok:false, reason:'パディング異常' };
    const coreLen = s.replace(/=+$/,'').length;
    if (coreLen % 4 === 1) return { ok:false, reason:'長さ整合×' };

    const hasLower = /[a-z]/.test(s);
    const hasUpper = /[A-Z]/.test(s);
    const hasDigit = /\d/.test(s);
    const hasMark  = /[+/_-]/.test(s);
    const mixedCnt = [hasLower,hasUpper,hasDigit,hasMark].filter(Boolean).length;
    if (mixedCnt < 3) return { ok:false, reason:'多様性不足' };

    const digitCount = (s.match(/\d/g) || []).length;
    if (digitCount < 6) return { ok:false, reason:'数字が少なすぎ' };

    return { ok:true, reason:'' };
  }

  function initUserPasteCode_(){
    const pasteBtn  = document.getElementById('btn-paste-code');
    const clearBtn  = document.getElementById('btn-clear-code');
    const previewEl = document.getElementById('pasted-code-preview');
    const shareEl   = document.getElementById('post-share-code');
    if (!pasteBtn || !clearBtn || !previewEl || !shareEl) return;

    function setCodeBoth(v){
      const s = String(v || '').trim();
      shareEl.value = s;
    }

    function reflectUI(s){
      const vr = validateDeckCodeLight_(s || '');
      const ok = !!vr.ok;

      previewEl.textContent = (ok && s) ? s : '（未設定）';
      previewEl.title = !s ? '' : (ok ? '判定: デッキコード（OK）' : `判定: 不明（${vr.reason || '形式不一致'}）`);

      previewEl.classList.toggle('ok', ok && !!s);
      previewEl.classList.toggle('ng', !ok && !!s);

      clearBtn.disabled = !(ok && !!s);
    }

    async function doPaste(){
      try{
        const t = await navigator.clipboard.readText();
        const s = String(t || '').trim();
        if (!s){ alert('クリップボードが空です'); return; }

        const vr = validateDeckCodeLight_(s);
        if (!vr.ok){
          setCodeBoth('');
          reflectUI('');
          window.scheduleAutosave?.();
          alert(`貼り付けた文字列はデッキコードではなさそうです。\n理由: ${vr.reason || '形式不一致'}`);
          return;
        }

        setCodeBoth(s);
        reflectUI(s);
        window.scheduleAutosave?.();
      }catch(err){
        console.error(err);
        alert('デッキコードの貼り付けに失敗しました（権限やブラウザ設定をご確認ください）');
      }
    }

    function doClear(){
      setCodeBoth('');
      reflectUI('');
      window.scheduleAutosave?.();
    }

    pasteBtn.addEventListener('click', doPaste);
    clearBtn.addEventListener('click', doClear);

    window.writePastedDeckCode = function(s){
      try{
        setCodeBoth(s);
        reflectUI(String(s || '').trim());
      }catch(_){}
    };

    reflectUI(shareEl.value || '');
  }


  // =====================================================
  // 14) init（結線）
  // =====================================================
  function initPost(){
    bindMinimalAgreeCheck();

    const resetBtn = document.getElementById('post-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetDeckPostForm);

    const imgBtn = document.getElementById('post-open-imagegen');
    if (imgBtn){
      imgBtn.addEventListener('click', () => {
        if (typeof window.exportDeckImage === 'function'){
          window.exportDeckImage();
          return;
        }
        const proxy = document.getElementById('exportPngBtn');
        if (proxy){
          proxy.click();
          return;
        }
        alert('画像生成機能が見つかりませんでした（exportDeckImage / #exportPngBtn）');
      });
    }

    const xBtn = document.getElementById('x-link-btn');
    const xEl  = document.getElementById('auth-x');
    if (xBtn && xEl){
      xBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const norm = normalizeXInput_();

        const user = String(norm || '').replace(/^@/, '').trim();
        if (!user){
          alert('Xアカウント名を入力してください');
          return;
        }
        if (!isValidXHandle(norm)){
          alert('Xアカウント名が不正です（英数と_、最大15文字）');
          return;
        }
        window.open(`https://x.com/${encodeURIComponent(user)}`, '_blank', 'noopener');
      });
    }

    const form = document.getElementById('deck-post-form');
    if (form && !form.__postBound){
      form.__postBound = true;

      // inline onsubmit があると二重実行し得るので剥がす
      try { form.removeAttribute('onsubmit'); } catch(_){}

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handlePostSubmit_(e);
      });
    }

    // --- page2未移植分の初期化 ---
    setupPostFlowHelpModal_();
    setupExclusiveSubtabs_();
    bindNoteFullModal_();
    initUserPasteCode_();
    window.CardNotes?.init?.();

    // 入力監視（note / user-tag追加でautosave）
    const note = document.getElementById('post-note');
    note?.addEventListener('input', () => window.scheduleAutosave?.());

    // ユーザータグUI（page2移植分）
    bindUserTagUI_();
  }


  // =====================================================
  // 15) boot（loader方式に追従して init を確実に呼ぶ）
  // =====================================================
  function bootPost_(){
    if (window.__dmPostBooted) return;
    window.__dmPostBooted = true;
    try { initPost(); } catch(e){ console.error('[post] initPost failed', e); }
  }

  // loader が提供する onDeckmakerReady を優先
  if (typeof window.onDeckmakerReady === 'function'){
    window.onDeckmakerReady(bootPost_);
  } else {
    // フォールバック：イベント or DOMContentLoaded
    window.addEventListener('deckmaker-page:ready', bootPost_, { once:true });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootPost_, { once:true });
    } else {
      bootPost_();
    }
  }

  // =====================================================
  // 公開（互換のため window へ）※まとめ版
  // =====================================================
  window.DeckmakerPost = { init: initPost };
  window.submitDeckPost = submitDeckPost;
  window.renderPostSelectTags = renderPostSelectTags;
  window.openPostSuccessModal = window.openPostSuccessModal || openPostSuccessModal;

  window.readPostNote  = window.readPostNote  || readPostNote;
  window.writePostNote = window.writePostNote || writePostNote;
  window.readUserTags  = window.readUserTags  || readUserTags;
  window.writeUserTags = window.writeUserTags || writeUserTags;

  window.normalizeHandle = window.normalizeHandle || normalizeHandle;

  window.openNoteFull_  = window.openNoteFull_  || openNoteFull_;
  window.closeNoteFull_ = window.closeNoteFull_ || closeNoteFull_;

  // page2が「preset insert」を関数で呼んでいた場合の保険（任意）
  window.NOTE_PRESETS = window.NOTE_PRESETS || NOTE_PRESETS;

  // page2側で呼ばれがちな初期化名（保険）
  window.initPost = window.initPost || initPost;

  Object.assign(window, {
    showPostToast: window.showPostToast || showPostToast,
    buildDeckFeaturesForPost: window.buildDeckFeaturesForPost || buildDeckFeaturesForPost,
    buildDeckPostPayload: window.buildDeckPostPayload || buildDeckPostPayload,
    validateDeckBeforePost: window.validateDeckBeforePost || validateDeckBeforePost,
  });

// =====================================================
// page2互換：8章で使っていた“保険用API”
// - page2の8章を削除しても落ちないように受け皿だけ残す
// =====================================================

// 旧: window.autoTagList / window.selectedTagList が存在前提のコードが残っていてもOKにする
window.autoTagList     ??= []; // updateAutoTags()
window.selectedTagList ??= []; // renderPostSelectTags()

// 旧: page2 の note-side-list クリックでカード詳細モーダルを開く仕組みの受け皿
window.openCardDetailModal = window.openCardDetailModal || function(cardId, options){
  document.dispatchEvent(new CustomEvent('open-card-detail', {
    detail: {
      cardId: String(cardId || ''),
      anchorRect: options?.anchorRect || null,
    }
  }));
};

// 旧: add-note-btn（簡易追加）互換
window.__appendNoteRow = window.__appendNoteRow || function(cd, text=''){
  try{
    const curr = window.readCardNotes?.() || [];
    curr.push({ cd: String(cd || ''), text: String(text || '') });
    window.writeCardNotes?.(curr);
  }catch(_){}
};

// 旧: onCardsLoaded 互換（もしどこかが呼んでいてもエラーにしない）
window.onCardsLoaded = window.onCardsLoaded || function(){
  try { window.renderPostSelectTags?.(); } catch(_){}
};

})();
