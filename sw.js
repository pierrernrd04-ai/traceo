// Traceo — fonctionnement hors ligne de l'app (la carte et le calcul des boucles demandent Internet).
const VERSION = "traceo-v31";
const SHELL = ["./", "index.html", "styles.css", "app.js", "native.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "traceo-tiles").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Fonds de carte : garde les dalles déjà vues pour un affichage rapide
  if (/basemaps\.cartocdn\.com|tile\.googleapis\.com|tiles\.openfreemap\.org/.test(url.host)) {
    e.respondWith(caches.open("traceo-tiles").then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // App : réseau d'abord, cache si hors ligne
  if (url.origin === location.origin || url.host === "unpkg.com" || url.host.endsWith("googleapis.com") || url.host.endsWith("gstatic.com")) {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
