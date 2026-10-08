/*
 * A deliberately small service worker. It caches only the offline page and its
 * icon. Everything else, the app itself included, always comes from the network,
 * so a new deploy is picked up straight away and nobody is ever stuck on old code.
 * When opening a page fails because there is no connection, it shows the offline page.
 */
const CACHE = "mafia-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (request.method === "GET" && new URL(request.url).pathname === "/icons/icon-192.png") {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
  }
  // Anything else (the app, Socket.IO, Puter): not handled here, straight to the network.
});
