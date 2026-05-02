/**
 * js/common/storage/card-groups.js
 * - カードグループのデータ/保存（localStorage）
 * - 最大10個
 * - 初期：お気に入り / メタカード（固定名）
 * - 複数所属OK
 */
(function () {
  'use strict';

  const LS_KEY = 'cardGroupsV1';
  const LS_UPDATED_AT_KEY = 'cardGroupsUpdatedAt';
  const MAX_GROUPS = 10;

    // ========================================
  // 公式メタ（ここだけ日々更新する想定）
  // ver を上げたら「未編集ユーザー」にだけ反映される
  // ========================================
  const OFFICIAL_META = {
    ver: 1, // ←更新したら +1
    cards: [
      '90003',//アルテミス
      '30111',//トラベス
      '40104',//カロス
      '80301',//クロノス
      '90005',//タナトス
      '90007',//アマテラス
      '40106',//団長
      '80015',//ラファエル
      '80102',//月マディ
      '80202',//火トゥリテ
      '80302',//水メルクル
      '80401',//木ヨーウィス
      '80203',//ビギナーマジシャン
      '20027',//義眼
      '30024',//ヴァンテージ
      '30304',//木霊
      '80105',//薬師
      '80206',//メアリー
      '10029',//リザード
      '20030',//結晶体
      '30029',//親衛隊
      '40024',//ガードナー
      '50030',//スケスケルトン
    ],
  };

  // sys（編集/削除などの“痕跡”管理）
  function ensureSys_(st){
    st.sys = st.sys || {};
    st.sys.fav  = st.sys.fav  || { touched:false, deleted:false };
    st.sys.meta = st.sys.meta || { touched:false, deleted:false, ver: 0 };
    return st;
  }

  function nowId_() {
    return 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function normalizeCardsMap_(cards) {
    const out = {};

    if (Array.isArray(cards)) {
      cards.forEach(cdRaw => {
        const cd = window.normCd5 ? window.normCd5(cdRaw) : String(cdRaw || '').padStart(5, '0');
        if (!cd || cd === '00000') return;
        out[cd] = 1;
      });
      return out;
    }

    if (!cards || typeof cards !== 'object') return out;

    Object.entries(cards).forEach(([cdRaw, value]) => {
      const cd = window.normCd5 ? window.normCd5(cdRaw) : String(cdRaw || '').padStart(5, '0');
      const count = (typeof value === 'number') ? (value | 0) : (value ? 1 : 0);
      if (!cd || cd === '00000' || count <= 0) return;
      out[cd] = 1;
    });

    return out;
  }

  function normalizeStateShape_(src) {
    const base = (src && typeof src === 'object') ? clone_(src) : {};
    const groups = (base.groups && typeof base.groups === 'object') ? base.groups : {};
    const nextGroups = {};

    Object.keys(groups).forEach(idRaw => {
      const id = String(idRaw || '').trim();
      if (!id) return;

      const g = groups[id] || {};
      nextGroups[id] = {
        id,
        name: String(g.name || ''),
        fixed: !!g.fixed,
        cards: normalizeCardsMap_(g.cards),
      };
    });

    const orderSrc = Array.isArray(base.order) ? base.order : Object.keys(nextGroups);
    const order = orderSrc
      .map(v => String(v || '').trim())
      .filter(id => !!nextGroups[id]);

    Object.keys(nextGroups).forEach(id => {
      if (!order.includes(id)) order.push(id);
    });

    return {
      v: Number(base.v || 1),
      order,
      groups: nextGroups,
      activeId: String(base.activeId || ''),
      editingId: String(base.editingId || ''),
      _editBase: null,
      sys: (base.sys && typeof base.sys === 'object') ? base.sys : {},
    };
  }

  function read_() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const obj = raw ? JSON.parse(raw) : null;
      if (!obj || typeof obj !== 'object') return null;
      return normalizeStateShape_(obj);
    } catch {
      return null;
    }
  }

  function touchUpdatedAt_() {
    const updatedAt = new Date().toISOString();
    try { localStorage.setItem(LS_UPDATED_AT_KEY, updatedAt); } catch {}
    return updatedAt;
  }

  function readUpdatedAt_() {
    try { return localStorage.getItem(LS_UPDATED_AT_KEY) || ''; } catch { return ''; }
  }

  function write_(st, opts = {}) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(st));
      if (opts.touch) touchUpdatedAt_();
    } catch {}
  }

  function ensureDefault_() {
    let st = read_();
    if (!st) {
      st = {
        v: 1,
        order: [],
        groups: {},
        activeId: '',
        editingId: '',
        _editBase: null, // ★ 編集スナップショット（startEditingで入れる）
      };

      ensureSys_(st);

      // 初回：fav/meta を作る（deleted でない限り）
      if (!st.sys.fav.deleted) {
        st.groups.fav = { id:'fav', name:'お気に入り', fixed:true, cards:{} };
        st.order.push('fav');
      }
      if (!st.sys.meta.deleted) {
        const cardsObj = {};
        OFFICIAL_META.cards.forEach(cd => { cardsObj[window.normCd5 ? window.normCd5(cd) : String(cd).padStart(5,'0')] = 1; });
        st.groups.meta = { id:'meta', name:'メタカード', fixed:true, cards:cardsObj };
        st.order.push('meta');
        st.sys.meta.ver = OFFICIAL_META.ver;
      }

      write_(st);
      return st;
    }


    // 固定2グループが消えてたら復旧
    st.groups = st.groups || {};
    st.order = Array.isArray(st.order) ? st.order : [];
    ensureSys_(st);

    // fav
    if (st.sys.fav.deleted) {
      delete st.groups.fav;
      st.order = st.order.filter(id => id !== 'fav');
      if (st.activeId === 'fav') st.activeId = '';
      if (st.editingId === 'fav') st.editingId = '';
    } else {
      if (!st.groups.fav) st.groups.fav = { id:'fav', name:'お気に入り', fixed:true, cards:{} };
      if (!st.order.includes('fav')) st.order.unshift('fav');
    }

    // meta
    if (st.sys.meta.deleted) {
      delete st.groups.meta;
      st.order = st.order.filter(id => id !== 'meta');
      if (st.activeId === 'meta') st.activeId = '';
      if (st.editingId === 'meta') st.editingId = '';
    } else {
      if (!st.groups.meta) st.groups.meta = { id:'meta', name:'メタカード', fixed:true, cards:{} };
      if (!st.order.includes('meta')) st.order.unshift('meta');

      // ★ “未編集ユーザー”にだけ公式メタを反映
      if (!st.sys.meta.touched && st.sys.meta.ver !== OFFICIAL_META.ver) {
        const cardsObj = {};
        OFFICIAL_META.cards.forEach(cd => { cardsObj[window.normCd5 ? window.normCd5(cd) : String(cd).padStart(5,'0')] = 1; });
        st.groups.meta.cards = cardsObj;
        st.sys.meta.ver = OFFICIAL_META.ver;
      }
    }


    // 余計なIDを order から掃除
    st.order = st.order.filter(id => st.groups[id]);

    // 上限超えてたら末尾を落とす（安全策）
    while (st.order.length > MAX_GROUPS) {
      const dropId = st.order.pop();
      if (dropId && !st.groups[dropId]?.fixed) delete st.groups[dropId];
    }

    write_(st);
    return st;
  }

  let state = ensureDefault_();
  const listeners = new Set();
  function emit_() { listeners.forEach(fn => { try { fn(state); } catch {} }); }

  function clone_(obj) {
    return JSON.parse(JSON.stringify(obj || {}));
  }

  function getState() {
    state = ensureDefault_();
    return clone_(state);
  }
  function setState_(next) {
    state = next;
    write_(state, { touch: true });
    emit_();
  }

  function isSyncReady_() {
    const sync = window.AccountCardGroupsSync || window.AccountAppDataSync;
    if (!sync || typeof sync.isReady !== 'function') return true;
    return sync.isReady();
  }

  function notifyEditLocked_(reason) {
    try {
      window.dispatchEvent(new CustomEvent('card-groups:edit-locked', {
        detail: { reason },
      }));
    } catch {}
  }

  function canEdit() {
    const sync = window.AccountCardGroupsSync;
    if (sync && typeof sync.isEditable === 'function') return sync.isEditable();
    return isSyncReady_();
  }

  function guardEdit_() {
    if (canEdit()) return null;
    const reason = 'syncing';
    notifyEditLocked_(reason);
    return { ok: false, reason };
  }

  function hasUserData(stateLike) {
    const st = stateLike ? clone_(stateLike) : getState();
    const groups = st.groups || {};
    const order = Array.isArray(st.order) ? st.order : Object.keys(groups);

    if (order.some(id => id !== 'fav' && id !== 'meta' && groups[id])) return true;
    if (Object.keys(groups.fav?.cards || {}).length > 0) return true;
    if (st.sys?.fav?.touched || st.sys?.fav?.deleted) return true;
    if (st.sys?.meta?.touched || st.sys?.meta?.deleted) return true;

    return false;
  }

  function exportState() {
    const st = getState();
    st.activeId = '';
    st.editingId = '';
    st._editBase = null;
    return st;
  }

  function replaceAll(nextState) {
    const st = normalizeStateShape_(nextState);
    st.activeId = '';
    st.editingId = '';
    st._editBase = null;
    write_(st, { touch: true });
    state = ensureDefault_();
    emit_();
    return { ok: true };
  }

  function listGroups() {
    const st = getState();
    return st.order.map(id => st.groups[id]).filter(Boolean);
  }

  function canCreate() {
    const st = getState();
    return st.order.length < MAX_GROUPS;
  }

  // ✅ 同名回避用ユーティリティ
function uniqueName_(base, st, exceptId = '') {
  const raw = String(base || '').trim() || `グループ${st.order.length + 1}`;
  const used = new Set(
    st.order
      .map(id => st.groups[id])
      .filter(g => g && g.id !== exceptId)
      .map(g => String(g.name || '').trim())
      .filter(Boolean)
  );

  if (!used.has(raw)) return raw;

  // すでにあるなら「（2）」から
  let n = 2;
  while (n < 999) {
    const cand = `${raw}（${n}）`;
    if (!used.has(cand)) return cand;
    n++;
  }
  return `${raw}（${Date.now()}）`;
}

  function createGroup(name = '新しいグループ') {
    const locked = guardEdit_();
    if (locked) return locked;

    const st = getState();
    if (st.order.length >= MAX_GROUPS) return { ok: false, reason: 'limit' };

    const id = nowId_();

    // ✅ 同名回避（（2）（3）…）＋空防止
    const safeName = uniqueName_(name, st);

    st.groups[id] = { id, name: safeName, fixed: false, cards: {} };
    st.order.push(id);
    setState_(st);
    return { ok: true, id };
  }

  function renameGroup(id, name) {
    const locked = guardEdit_();
    if (locked) return locked;

    const st = getState();
    const g = st.groups[id];
    if (!g) return { ok: false };

    const isSystem = (id === 'fav' || id === 'meta');
    if (g.fixed && !isSystem) return { ok: false, reason: 'fixed' };

    // ✅ 自分以外との同名を回避（自分自身は許可）
    const fallback = `グループ${st.order.indexOf(id) + 1}`;
    const safeName = uniqueName_(String(name || '').trim() || fallback, st, id);

    const prev = String(g.name || '');
    g.name = safeName;

    // ✅ システムは「実際に変わった時だけ touched」
    if (isSystem && safeName !== prev) {
      ensureSys_(st);
      if (id === 'fav')  st.sys.fav.touched  = true;
      if (id === 'meta') st.sys.meta.touched = true;
    }

    setState_(st);
    return { ok: true };
  }

  function deleteGroup(id) {
    const locked = guardEdit_();
    if (locked) return locked;

    const st = getState();
    const g = st.groups[id];
    if (!g) return { ok: false };

    const isSystem = (id === 'fav' || id === 'meta');
    if (g.fixed && !isSystem) return { ok: false, reason: 'fixed' };

    // ✅ システムは「削除フラグ」を保存（次回復活させない）
    if (isSystem) {
      ensureSys_(st);
      if (id === 'fav')  { st.sys.fav.deleted  = true; st.sys.fav.touched  = true; }
      if (id === 'meta') { st.sys.meta.deleted = true; st.sys.meta.touched = true; }
    }

    delete st.groups[id];
    st.order = st.order.filter(x => x !== id);
    if (st.activeId === id) st.activeId = '';
    if (st.editingId === id) st.editingId = '';

    setState_(st);
    return { ok: true };
  }

  function moveGroup(id, toIndex) {
    const locked = guardEdit_();
    if (locked) return locked;

    const st = getState();
    const from = st.order.indexOf(id);
    if (from < 0) return { ok: false };
    toIndex = Math.max(0, Math.min(st.order.length - 1, toIndex));

    st.order.splice(from, 1);
    st.order.splice(toIndex, 0, id);
    setState_(st);
    return { ok: true };
  }

  function setActive(id) {
    if (!canEdit()) {
      notifyEditLocked_('syncing');
      return { ok: false, reason: 'syncing' };
    }

    const st = getState();
    const next = (id && st.groups[id]) ? id : '';
    if (st.activeId === next) return { ok: true };
    st.activeId = next;
    setState_(st);
    return { ok: true };
  }

  // ✅ active（フィルター）をトグル：同じなら解除
  function toggleActive(id){
    if (!canEdit()) {
      notifyEditLocked_('syncing');
      return { ok: false, reason: 'syncing' };
    }

    const st = getState();
    const next = (id && st.groups[id]) ? id : '';
    st.activeId = (st.activeId === next) ? '' : next;
    setState_(st);
    return { ok: true };
  }

  function hashCardsObj_(cardsObj){
    const keys = Object.keys(cardsObj || {}).map(s => window.normCd5 ? window.normCd5(s) : String(s).padStart(5,'0')).sort();
    return keys.join(',');
  }

  function startEditing(id) {
    const locked = guardEdit_();
    if (locked) return locked;

    const st = getState();
    st.editingId = (id && st.groups[id]) ? id : '';

    // ★ 編集開始スナップショット
    if (st.editingId) {
      const g = st.groups[st.editingId];
      st._editBase = {
        id: g.id,
        name: String(g.name || ''),
        cardsHash: hashCardsObj_(g.cards),
      };
    } else {
      st._editBase = null;
    }

    setState_(st);
    return { ok: true };
  }

  //新規作成→編集開始を “1回の保存” で行う（固まり対策）
  function createGroupAndEdit(name = '新しいグループ'){
    const locked = guardEdit_();
    if (locked) return locked;

    const st = getState();
    if (st.order.length >= MAX_GROUPS) return { ok:false, reason:'limit' };

    const id = nowId_();
    const safeName = uniqueName_(name, st);

    st.groups[id] = { id, name: safeName, fixed:false, cards:{} };
    st.order.push(id);

    st.editingId = id;

    // ✅ 編集開始スナップショット（新規は“空の状態”）
    st._editBase = {
      id,
      name: String(safeName || ''),
      cardsHash: hashCardsObj_(st.groups[id].cards),
    };

    setState_(st);
    return { ok:true, id };
  }



  function stopEditing() {
    const locked = guardEdit_();
    if (locked) return locked;

    const st = getState();

    // ★ 編集差分がある時だけ “touched” を立てる（fav/metaのみ）
    const base = st._editBase;
    if (base && st.groups[base.id]) {
      const g = st.groups[base.id];
      const now = {
        name: String(g.name || ''),
        cardsHash: hashCardsObj_(g.cards),
      };
      const changed = (now.name !== base.name) || (now.cardsHash !== base.cardsHash);

      if (changed) {
        ensureSys_(st);
        if (base.id === 'fav')  st.sys.fav.touched  = true;
        if (base.id === 'meta') st.sys.meta.touched = true;
      }
    }

    st.editingId = '';
    st._editBase = null;
    setState_(st);
    return { ok: true };
  }

  function toggleCardInGroup(groupId, cd) {
    const locked = guardEdit_();
    if (locked) return locked;

    const st = getState();
    const g = st.groups[groupId];
    if (!g) return { ok: false };
    cd = window.normCd5 ? window.normCd5(cd) : String(cd || '').padStart(5, '0');

    g.cards = g.cards || {};
    if (g.cards[cd]) delete g.cards[cd];
    else g.cards[cd] = 1;

    setState_(st);
    return { ok: true };
  }

  function addCardToGroup(groupId, cd) {
    const locked = guardEdit_();
    if (locked) return locked;

    const st = getState();
    const g = st.groups[groupId];
    if (!g) return { ok: false };

    cd = window.normCd5 ? window.normCd5(cd) : String(cd || '').padStart(5, '0');
    g.cards = g.cards || {};

    if (!g.cards[cd]) {
      g.cards[cd] = 1;
      setState_(st);
    }

    return { ok: true };
  }

  function clearGroupCards(groupId) {
    const locked = guardEdit_();
    if (locked) return locked;

    const st = getState();
    const g = st.groups[groupId];
    if (!g) return { ok: false };

    g.cards = {};
    setState_(st);
    return { ok: true };
  }

  function hasCard(groupId, cd) {
    const st = getState();
    const g = st.groups[groupId];
    if (!g) return false;
    cd = window.normCd5 ? window.normCd5(cd) : String(cd || '').padStart(5, '0');
    return !!(g.cards && g.cards[cd]);
  }

  function getActiveFilterSet() {
    const st = getState();
    // ✅ 編集中はフィルター無効（全カード見せる）
    if (st.editingId) return null;

    const id = st.activeId;
    if (!id || !st.groups[id]) return null;

    const cards = st.groups[id].cards || {};
    const set = new Set(Object.keys(cards));
    return set.size ? set : null;
  }

  function getEditingId() {
    const st = getState();
    return st.editingId || '';
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.add(fn);
  }

  // card-groups.js の公開API付近
  function clearActiveOnBoot_() {
    const st = getState();
    if (!st.activeId && !st.editingId) return; // 何もなければ保存しない
    st.activeId = '';
    st.editingId = '';
    setState_(st);
  }

  window.CardGroups = {
    MAX_GROUPS,
    getState,
    getUpdatedAt: readUpdatedAt_,
    exportState,
    replaceAll,
    hasUserData,
    canEdit,
    listGroups,
    canCreate,
    createGroup,
    renameGroup,
    deleteGroup,
    moveGroup,
    setActive,
    toggleActive,
    startEditing,
    createGroupAndEdit,
    stopEditing,
    toggleCardInGroup,
    addCardToGroup,
    clearGroupCards,
    hasCard,
    getActiveFilterSet,
    getEditingId,
    onChange,
    clearActiveOnBoot: clearActiveOnBoot_,
  };
})();
