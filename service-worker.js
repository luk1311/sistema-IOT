// Service Worker de TADASHY (Fase 2).
// Permanece registrado para recibir Web Push de segundo plano.
// NO cachea (passthrough de red) -> no reintroduce el problema de caché vieja.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Eliminar cualquier caché heredada de versiones anteriores del SW.
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Sin estrategia de caché: dejar pasar todo a la red.
self.addEventListener('fetch', () => {});

// Notificación push de segundo plano.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'TADASHY';
  const options = {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.type ? `tadashy-${data.type}-${data.deviceId || ''}` : undefined,
    data
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Al hacer clic en la notificación, enfocar o abrir la app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if ('focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('/');
  })());
});
