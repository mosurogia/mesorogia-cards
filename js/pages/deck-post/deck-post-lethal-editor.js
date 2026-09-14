// マイ投稿のリーサル編集。保存が確認できるまで投稿データを変更しない。
(function () {
  'use strict';

  const deck = {};
  let planner = null;
  let workspaceElement = null;
  let active = null;
  let busy = false;
  const esc = value => window.DeckPostDetail.escHtml_(String(value ?? ''));
  const clone = value => JSON.parse(JSON.stringify(value));
  const registry = () => window.DeckmakerLethalPost;

  function buildHtml(item) {
    const plans = Array.isArray(item?.lethalPlans) ? item.lethalPlans : [];
    return `<section class="mine-lethal-section" data-lethal-postid="${esc(item?.postId)}">
      <div class="lethal-planner__registered-header">
        <h4 class="lethal-planner__registered-title">登録済みリーサルプラン（${plans.length}/3）</h4>
        <button type="button" class="lethal-planner__register-button" data-mine-lethal-open="new">新規追加</button>
      </div>
      ${plans.length ? `<div class="mine-lethal-preview">${window.DeckPostDetail.buildLethalPlansHtml_(item)}</div>
        <button type="button" class="modal-buttun" data-mine-lethal-open="edit">登録済みプランを編集</button>`
        : '<p class="lethal-planner__registered-empty">まだ登録されていません</p>'}
    </section>`;
  }

  function init() {
    if (planner) return;
    workspaceElement = document.getElementById('mine-lethal-workspace');
    planner = window.createLethalPlanner({
      deck,
      normCd5: cd => String(cd || '').padStart(5, '0'),
      getCard: cd => window.cardMap?.[cd] || null,
      imgSrcOf: cd => window.getCardImageSrc?.(cd) || `img/${cd}.webp`,
      getDeckEntriesSorted: () => Object.entries(deck).sort(([a], [b]) => a.localeCompare(b)),
    });
    registry().init({ getDeckCount: cd => Number(deck[cd] || 0) });
    document.getElementById('mine-lethal-save').addEventListener('click', save);
    document.getElementById('mine-lethal-cancel').addEventListener('click', cancel);
  }

  function close() {
    if (!active) return;
    const previous = active;
    registry().close();
    document.getElementById('mine-lethal-parking').appendChild(workspaceElement);
    active = null;
    if (previous.host.isConnected) previous.host.outerHTML = buildHtml(previous.item);
  }

  function cancel() {
    if (busy || !active) return;
    close();
  }

  async function open(button) {
    if (busy) return;
    const host = button.closest('[data-lethal-postid]');
    const postId = host?.dataset.lethalPostid;
    if (!postId) return;
    if (active && JSON.stringify(registry().getAll()) !== active.original &&
        !window.confirm('編集中のリーサルプランを破棄して別の投稿を開きますか？')) return;
    close();
    button.disabled = true;
    busy = true;
    try {
      const item = await window.DeckPostDetail.ensurePostDetailData(postId);
      if (!item) throw new Error('投稿を読み込めませんでした。もう一度お試しください。');
      if (!host.isConnected) return;
      init();
      for (const cd of Object.keys(deck)) delete deck[cd];
      Object.assign(deck, window.DeckPostDetail.extractDeckMap(item));
      registry().replace(clone(item.lethalPlans || []));
      const workspace = document.getElementById('mine-lethal-workspace');
      host.replaceChildren(workspace);
      active = { postId, host, item, original: JSON.stringify(registry().getAll()) };
      document.getElementById('mine-lethal-status').textContent = '';
      planner.update();
      if (button.dataset.mineLethalOpen === 'new') {
        document.getElementById('post-lethal-open-register').click();
      } else {
        document.getElementById('post-lethal-open-register').focus();
      }
    } catch (error) {
      window.alert(error.message || '編集画面を開けませんでした。');
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  function readPlans(response) {
    const item = response?.item || response?.post || response?.data || response;
    if (Array.isArray(item?.lethalPlans)) return item.lethalPlans;
    let payload = item?.payload || item?.payloadJSON || item?.rawPayload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_) { return null; }
    }
    return Array.isArray(payload?.lethalPlans) ? payload.lethalPlans : null;
  }

  function patchSavedItem(postId, plans) {
    const state = window.DeckPostState?.getState?.();
    const patch = item => {
      if (item && String(item.postId) === postId) item.lethalPlans = clone(plans);
    };
    [state?.mine?.items, state?.list?.items, state?.list?.allItems, state?.list?.filteredItems]
      .forEach(items => items?.forEach(patch));
    patch(window.DeckPostDetail.getCachedPostDetail(postId));
    patch(active?.item);
  }

  async function save() {
    if (busy || !active) return;
    const status = document.getElementById('mine-lethal-status');
    if (registry().hasInvalid()) {
      status.textContent = 'デッキ内の枚数が不足するプランがあります。編集または削除してください。';
      return;
    }
    const plans = registry().getAll();
    if (JSON.stringify(plans) === active.original) { close(); return; }
    const { postId } = active;
    const workspace = document.getElementById('mine-lethal-workspace');
    busy = true;
    workspace.disabled = true;
    status.textContent = '保存中…';
    try {
      const result = await window.DeckPostApi.updateLethalPlans_(postId, plans);
      if (!result?.ok) throw new Error('保存に失敗しました。ログイン状態や通信状況をご確認ください。');
      // 更新対象外の項目が無視される旧APIでも、保存済みと誤表示しない。
      const response = await window.DeckPostApi.apiGetPost({ postId, refresh: true });
      const saved = readPlans(response);
      if (response?.ok === false || saved === null ||
          JSON.stringify(registry().normalize(saved)) !== JSON.stringify(plans)) {
        throw new Error('保存結果を確認できませんでした。編集内容は残しています。時間をおいて再度保存してください。');
      }
      patchSavedItem(postId, plans);
      close();
      window.DeckPostList?.applySortAndRerenderList?.(false);
      // 開いている詳細の打点欄も更新する。
      const item = window.DeckPostDetail.findItemById_(postId);
      document.querySelectorAll('[data-lethal-postid]').forEach(host => {
        if (host.dataset.lethalPostid === postId) host.outerHTML = buildHtml(item);
      });
      document.querySelectorAll('.post-detail-inner').forEach(root => {
        if (root.dataset.postid !== postId) return;
        const label = root.querySelector('dt.lethal-plan-label');
        if (label) {
          const body = label.nextElementSibling;
          if (body?.tagName === 'DD') body.innerHTML = window.DeckPostDetail.buildLethalPlansHtml_(item);
          if (!plans.length) { body?.remove(); label.remove(); }
        } else if (plans.length) {
          root.querySelector('.post-detail-summary')?.insertAdjacentHTML('beforeend',
            `<dt class="lethal-plan-label">リーサルプラン<span class="lethal-planner__title-badge">ベータ版</span></dt><dd>${window.DeckPostDetail.buildLethalPlansHtml_(item)}</dd>`);
        }
      });
      window.showMiniToast_?.('リーサルプランを保存しました');
    } catch (error) {
      status.textContent = error.message || '保存に失敗しました。編集内容は残しています。';
    } finally {
      workspace.disabled = false;
      busy = false;
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-mine-lethal-open]');
    if (button) open(button);
  });
  window.addEventListener('beforeunload', event => {
    if (!active || JSON.stringify(registry().getAll()) === active.original) return;
    event.preventDefault();
    event.returnValue = '';
  });
  window.DeckPostLethalEditor = { buildHtml };
})();
