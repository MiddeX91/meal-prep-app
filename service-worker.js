const CACHE_NAME = 'mealprep-planer-v4'; // WICHTIG: Erneut die Version erhöht
const CACHE_BUSTER = `?v=${new Date().getTime()}`; // Ein einzigartiger Zeitstempel

const FILES_TO_CACHE = [
  './' + CACHE_BUSTER,
  './index.html' + CACHE_BUSTER,
  './style.css' + CACHE_BUSTER,
  './app.js' + CACHE_BUSTER,
  //'./database.js' + CACHE_BUSTER,
  './images/icon-512.png' + CACHE_BUSTER,
  './images/icon-192.png' + CACHE_BUSTER
];

// Installation: App-Shell wird gecached
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Pre-caching App Shell mit Cache Buster');
        const cachePromises = FILES_TO_CACHE.map(fileUrl => {
            const request = new Request(fileUrl, {cache: 'reload'});
            return fetch(request).then(response => {
                if (!response.ok) {
                    throw new TypeError(`Fehler beim Laden von ${fileUrl}: ${response.status} ${response.statusText}`);
                }
                return cache.put(fileUrl, response);
            });
        });
        return Promise.all(cachePromises);
      })
      .catch(error => {
        console.error('[ServiceWorker] Caching der App Shell fehlgeschlagen:', error);
      })
  );
});

// Aktivierung: Alte Caches werden gelöscht
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[ServiceWorker] Alten Cache löschen', key);
          return caches.delete(key);
        }
      }));
    })
  );
  return self.clients.claim();
});

// Fetch: Anfragen abfangen und aus dem Cache bedienen (mit Cache Busting)
self.addEventListener('fetch', (event) => {
  // Ignoriere alle Anfragen, die zur Admin-Seite gehören
 if (event.request.url.includes('/admin/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});