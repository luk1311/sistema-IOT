self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          console.log('[ServiceWorker] Eliminando caché zombie:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(function() {
      console.log('[ServiceWorker] Caché limpia. Desregistrando Service Worker...');
      return self.registration.unregister();
    })
  );
});

self.addEventListener('fetch', function(e) {
  // Pass through everything to the network
});
