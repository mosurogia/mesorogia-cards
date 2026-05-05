var SW_BUILD_VERSION = '2026-05-06-002';
importScripts('./js/common/pwa/cache-config.js?v=' + SW_BUILD_VERSION);

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

function reloadControlledClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
    return Promise.all(
      clientList.map(function (client) {
        if (!client.url || typeof client.navigate !== 'function') {
          return Promise.resolve();
        }

        try {
          var url = new URL(client.url);
          url.searchParams.set('sw_refresh', SW_BUILD_VERSION);
          return client.navigate(url.toString()).catch(function () {
            return undefined;
          });
        } catch (_) {
          return Promise.resolve();
        }
      })
    );
  });
}

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
    }).then(function () {
      return reloadControlledClients();
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
    event.respondWith(networkOnly(event.request));
    return;
  }

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (shouldUseNetworkOnly(requestUrl)) {
    event.respondWith(networkOnly(event.request));
    return;
  }

  if (isCardImage(requestUrl)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  if (isCardDataJson(requestUrl)) {
    event.respondWith(networkFirst(event.request, false));
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

function shouldUseNetworkOnly(url) {
  return /\.(?:html|css|js)$/.test(url.pathname);
}

function isCardDataJson(url) {
  return /\/public\/(?:cards_latest|cards_latest\.meta|cards_versions|packs|cv|environments)\.json$/.test(url.pathname);
}

function isCardImage(url) {
  return /\/img\/(?:\d{5}|00000)\.webp$/.test(url.pathname);
}

function shouldUseNetworkFirst(url) {
  return config.networkFirstExtensions.some(function (extension) {
    return url.pathname.endsWith(extension);
  });
}

function networkOnly(request) {
  return fetch(new Request(request, { cache: 'reload' }));
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

function staleWhileRevalidate(request) {
  var fetchPromise = fetch(request).then(function (networkResponse) {
    return putRuntimeCache(request, networkResponse);
  }).catch(function () {
    return undefined;
  });

  return caches.match(request).then(function (cachedResponse) {
    return cachedResponse || fetchPromise;
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
