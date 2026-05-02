(function () {
  'use strict';

  const STORAGE_KEY = 'mesorogiaOfflineCards:status';
  const CARD_JSON_URL = './public/cards_latest.json';
  const DATA_URLS = [
    CARD_JSON_URL,
    './public/cards_latest.meta.json',
    './public/cards_versions.json',
    './public/packs.json',
    './public/cv.json',
    './public/environments.json',
    './img/00000.webp',
  ];
  const DEFAULT_CACHE_NAME = 'mesorogia-runtime-offline-cards';

  function getConfig_() {
    return window.MESOROGIA_PWA_CACHE_CONFIG || self.MESOROGIA_PWA_CACHE_CONFIG || {};
  }

  function getCacheName_() {
    return getConfig_().runtimeCacheName || DEFAULT_CACHE_NAME;
  }

  function normalizeUrl_(url) {
    return new URL(url, window.location.href).href;
  }

  function readStatus_() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function writeStatus_(status) {
    const next = Object.assign({}, readStatus_(), status);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (_) {}
    return next;
  }

  function dispatchProgress_(detail) {
    window.dispatchEvent(new CustomEvent('offline-cards:progress', { detail }));
  }

  async function fetchForCache_(url) {
    const request = new Request(normalizeUrl_(url), { cache: 'reload' });
    const response = await fetch(request);
    if (!response || !response.ok) {
      throw new Error(`HTTP ${response?.status || 0}`);
    }
    return { request, response };
  }

  async function putUrl_(cache, url) {
    const result = await fetchForCache_(url);
    await cache.put(result.request, result.response.clone());
    return result.response;
  }

  function buildCardImageUrls_(cards) {
    const seen = new Set();
    const urls = [];

    (Array.isArray(cards) ? cards : []).forEach((card) => {
      const cd = String(card?.cd || '').trim();
      if (!cd || seen.has(cd)) return;
      seen.add(cd);
      urls.push(`./img/${cd}.webp`);
    });

    return urls;
  }

  async function save_(opts = {}) {
    if (!window.caches || typeof fetch !== 'function') {
      throw new Error('このブラウザではカードデータを保存できません');
    }

    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const cache = await caches.open(getCacheName_());
    const startedAt = new Date().toISOString();
    let savedCount = 0;
    let failedCount = 0;
    let cards = [];

    writeStatus_({ state: 'saving', startedAt, savedCount: 0, failedCount: 0 });

    try {
      const cardResponse = await putUrl_(cache, CARD_JSON_URL);
      savedCount += 1;
      cards = await cardResponse.clone().json();
    } catch (err) {
      writeStatus_({ state: 'failed', failedAt: new Date().toISOString(), error: err?.message || String(err) });
      throw err;
    }

    const targets = DATA_URLS
      .filter((url) => url !== CARD_JSON_URL)
      .concat(buildCardImageUrls_(cards));
    const total = targets.length + 1;

    const notify = () => {
      const detail = { state: 'saving', savedCount, failedCount, total };
      onProgress?.(detail);
      dispatchProgress_(detail);
      writeStatus_(detail);
    };

    notify();

    for (const url of targets) {
      try {
        await putUrl_(cache, url);
        savedCount += 1;
      } catch (err) {
        failedCount += 1;
        console.warn('[offline-cards] 保存失敗:', url, err);
      }
      notify();
    }

    const savedAt = new Date().toISOString();
    const status = writeStatus_({
      state: 'saved',
      savedAt,
      savedCount,
      failedCount,
      total,
      cacheName: getCacheName_(),
    });
    dispatchProgress_(status);
    return status;
  }

  window.MesorogiaOfflineCards = {
    save: save_,
    getStatus: readStatus_,
  };
}());
