self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  return self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  // Hanya bypass fetch dasar agar diakui sebagai PWA oleh browser
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
