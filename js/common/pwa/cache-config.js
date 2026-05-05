(function () {
  'use strict';

  var config = {
    version: '2026-05-06-002',
    staticCacheName: 'mesorogia-static-2026-05-06-002',
    runtimeCacheName: 'mesorogia-runtime-2026-05-06-002',
    appShell: [
      './favicon.ico',
      './manifest.webmanifest',
      './img/appicon_1024.webp',
      './img/appicon_192.webp',
      './img/appicon_512.webp',
      './img/tatudosi.webp',
      './public/cards_latest.json',
      './public/cards_latest.meta.json',
      './public/cards_versions.json',
      './public/cv.json',
      './public/environments.json',
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
