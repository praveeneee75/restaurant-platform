const CACHE_NAME = "restaurant-pos-waiter-v1";
const SHELL_ASSETS = [
  "/waiter.html",
  "/css/waiter.css",
  "/js/waiter.js",
  "/manifest.webmanifest",
  "/icons/captain-pos.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/orders") || url.pathname.startsWith("/pos") || url.pathname.startsWith("/kds")) {
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
