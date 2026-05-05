(function () {
  'use strict';

  var CACHE_REPAIR_PREFIX = 'mesorogiaPwaCacheRepair';
  var LEGACY_OFFLINE_CACHE_NAME = 'mesorogia-runtime-offline-cards';

  function getConfig_() {
    return window.MESOROGIA_PWA_CACHE_CONFIG || {};
  }

  function getCurrentVersion_() {
    return String(getConfig_().version || 'unknown');
  }

  function isMesorogiaCache_(cacheName) {
    return String(cacheName || '').indexOf('mesorogia-') === 0;
  }

  function isCurrentManagedCache_(cacheName) {
    var config = getConfig_();
    return cacheName === config.staticCacheName || cacheName === config.runtimeCacheName;
  }

  function isRuntimeCache_(cacheName) {
    return String(cacheName || '').indexOf('mesorogia-runtime-') === 0 ||
      cacheName === LEGACY_OFFLINE_CACHE_NAME;
  }

  function deleteCaches_(opts) {
    opts = opts || {};
    if (!window.caches || typeof window.caches.keys !== 'function') {
      return Promise.resolve({ deleted: 0 });
    }

    return window.caches.keys().then(function (cacheNames) {
      var targets = cacheNames.filter(function (cacheName) {
        if (opts.keepRuntime && isRuntimeCache_(cacheName)) {
          return false;
        }

        if (opts.all) {
          return isMesorogiaCache_(cacheName) || cacheName === LEGACY_OFFLINE_CACHE_NAME;
        }

        return (isMesorogiaCache_(cacheName) && !isCurrentManagedCache_(cacheName)) ||
          cacheName === LEGACY_OFFLINE_CACHE_NAME;
      });

      return Promise.all(targets.map(function (cacheName) {
        return window.caches.delete(cacheName);
      })).then(function () {
        return { deleted: targets.length };
      });
    });
  }

  function unregisterServiceWorkers_() {
    if (!navigator.serviceWorker || typeof navigator.serviceWorker.getRegistrations !== 'function') {
      return Promise.resolve();
    }

    return navigator.serviceWorker.getRegistrations().then(function (registrations) {
      return Promise.all(registrations.map(function (registration) {
        return registration.unregister();
      }));
    });
  }

  function reloadWithCacheBust_() {
    var url = new URL(window.location.href);
    url.searchParams.set('cache_reset', String(Date.now()));
    window.location.replace(url.toString());
  }

  function repairAndReload_(opts) {
    opts = opts || {};
    var version = getCurrentVersion_();
    var markerKey = CACHE_REPAIR_PREFIX + ':' + version;

    try {
      localStorage.setItem(markerKey, String(Date.now()));
    } catch (_) {}

    return deleteCaches_({ all: !!opts.all, keepRuntime: !!opts.keepRuntime }).then(function () {
      if (opts.unregister) {
        return unregisterServiceWorkers_();
      }
      return undefined;
    }).then(function () {
      reloadWithCacheBust_();
    });
  }

  function autoRepairOldCaches_() {
    var version = getCurrentVersion_();
    var markerKey = CACHE_REPAIR_PREFIX + ':' + version;
    var wasSwRefreshed = false;

    try {
      wasSwRefreshed = new URL(window.location.href).searchParams.get('sw_refresh') === version;
    } catch (_) {}

    try {
      if (localStorage.getItem(markerKey)) {
        return Promise.resolve();
      }
    } catch (_) {}

    return deleteCaches_({ all: false }).then(function () {
      try {
        localStorage.setItem(markerKey, String(Date.now()));
      } catch (_) {}

      if (navigator.serviceWorker.controller && !wasSwRefreshed) {
        reloadWithCacheBust_();
      }
    }).catch(function (error) {
      console.warn('PWAキャッシュの更新処理に失敗しました。', error);
    });
  }

  window.MesorogiaPwaMaintenance = {
    repairAndReload: function () {
      return repairAndReload_({ all: true, unregister: true, keepRuntime: true });
    },
    clearOldCaches: function () {
      return deleteCaches_({ all: false });
    }
  };

  if (!('serviceWorker' in navigator)) {
    return;
  }

  var host = window.location.hostname;
  var isLocalDev = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (isLocalDev) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        registrations.forEach(function (registration) {
          registration.unregister();
        });
      });

      if (window.caches && typeof window.caches.keys === 'function') {
        window.caches.keys().then(function (cacheNames) {
          cacheNames.forEach(function (cacheName) {
            if (cacheName.indexOf('mesorogia-') === 0) {
              window.caches.delete(cacheName);
            }
          });
        });
      }
    });
    return;
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (registration) {
      registration.update().catch(function () {}).then(function () {
        return autoRepairOldCaches_();
      });
    }).catch(function (error) {
      console.warn('Service Workerの登録に失敗しました。', error);
    });
  });
}());
