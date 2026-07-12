(function () {
  'use strict';

  var config = {
    version: '2026-07-12-016',
    staticCacheName: 'mesorogia-static-2026-07-12-016',
    runtimeCacheName: 'mesorogia-runtime-2026-07-12-016',
    navigationNetworkTimeoutMs: 4000,
    assetNetworkTimeoutMs: 4000,
    appShell: [
      './img/mosurogia_favicon.ico',
      './manifest.webmanifest',
      './cards.html',
      './deckmaker.html',
      './deck-post.html',
      './match-results.html',
      './tier.html',
      './info.html',
      './img/appicon_1024.webp',
      './img/appicon_192.webp',
      './img/appicon_512.webp',
      './public/cards_latest.json',
      './public/cards_latest.meta.json',
      './public/cards_versions.json',
      './public/cv.json',
      './public/environments.json',
      './public/home-data.json',
      './public/packs.json'
    ],
    offlineFallbackPage: './deckmaker.html',
    cacheFirstExtensions: [
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.svg',
      '.ico',
      '.woff',
      '.woff2'
    ],
    networkFirstExtensions: [
      '.json'
    ]
  };

  self.MESOROGIA_PWA_CACHE_CONFIG = config;
}());
