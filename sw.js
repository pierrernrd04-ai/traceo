// Traceo — fonctionnement hors ligne de l'app (la carte et le calcul des boucles demandent Internet).
// Version volontairement simple : on ne touche ni aux cartes ni aux services externes, pour éviter tout blocage (Safari).
const VERSION = "traceo-v41";
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Safari refuse une page servie par le service worker si elle vient d'une redirection : on la recopie proprement
const clean = res => res.redirected ? res.blob().then(b => new Response(b, {status:res.status, statusText:res.statusText, headers:res.headers})) : res;
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // cartes, adresses, itinéraires : le navigateur gère seul
  e.respondWith(fetch(e.request, {cache:"no-cache"}).then(res => {
    if (res.ok && !res.redirected){ const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return clean(res);
  }).catch(() => caches.match(e.request, {ignoreSearch:true}).then(hit => hit || caches.match("./"))));
});
