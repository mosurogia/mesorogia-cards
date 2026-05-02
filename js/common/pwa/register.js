(function () {
  'use strict';

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
    navigator.serviceWorker.register('./sw.js').catch(function (error) {
      console.warn('Service Workerの登録に失敗しました。', error);
    });
  });
}());
