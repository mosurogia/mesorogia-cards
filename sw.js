importScripts('./js/common/pwa/cache-config.js');

var config = self.MESOROGIA_PWA_CACHE_CONFIG;
var staticCacheName = config.staticCacheName;
var runtimeCacheName = config.runtimeCacheName;
var managedCacheNames = [staticCacheName, runtimeCacheName];
var isLocalDev = self.location.hostname === 'localhost' ||
  self.location.hostname === '127.0.0.1' ||
  self.location.hostname === '::1';

self.addEventListener('install', function (event) {
  if (isLocalDev) {
    self.skipWaiting();
    return;
  }

  event.waitUntil(
    caches.open(staticCacheName).then(function (cache) {
      return cache.addAll(config.appShell);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  if (isLocalDev) {
    event.waitUntil(
      caches.keys().then(function (cacheNames) {
        return Promise.all(
          cacheNames.map(function (cacheName) {
            if (cacheName.indexOf('mesorogia-') === 0) {
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          })
        );
      }).then(function () {
        return self.clients.claim();
      })
    );
    return;
  }

  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.map(function (cacheName) {
          if (cacheName.indexOf('mesorogia-') === 0 && managedCacheNames.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (isLocalDev) {
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  var requestUrl;
  try {
    requestUrl = new URL(event.request.url);
  } catch (_) {
    return;
  }

  if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, true));
    return;
  }

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (shouldUseCacheFirst(requestUrl)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  if (shouldUseNetworkFirst(requestUrl)) {
    event.respondWith(networkFirst(event.request, false));
    return;
  }

  event.respondWith(networkFirst(event.request, false));
});

function shouldUseCacheFirst(url) {
  return config.cacheFirstExtensions.some(function (extension) {
    return url.pathname.endsWith(extension);
  });
}

function shouldUseNetworkFirst(url) {
  return config.networkFirstExtensions.some(function (extension) {
    return url.pathname.endsWith(extension);
  });
}

function cacheFirst(request) {
  return caches.match(request).then(function (cachedResponse) {
    if (cachedResponse) {
      return cachedResponse;
    }

    return fetch(request).then(function (networkResponse) {
      return putRuntimeCache(request, networkResponse);
    });
  });
}

function networkFirst(request, useFallbackPage) {
  return fetch(request).then(function (networkResponse) {
    return putRuntimeCache(request, networkResponse);
  }).catch(function () {
    return caches.match(request).then(function (cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }

      if (useFallbackPage) {
        return caches.match(config.offlineFallbackPage);
      }

      return undefined;
    });
  });
}

function putRuntimeCache(request, response) {
  if (!response || response.status !== 200) {
    return response;
  }

  return caches.open(runtimeCacheName).then(function (cache) {
    return cache.put(request, response.clone()).catch(function () {
      return undefined;
    }).then(function () {
      return response;
    });
  });
}
