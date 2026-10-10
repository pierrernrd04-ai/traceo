// Traceo — fonctionnement hors ligne de l'app (la carte et le calcul des boucles demandent Internet).
// Version volontairement simple : on ne touche ni aux cartes ni aux services externes, pour éviter tout blocage (Safari).
const VERSION = "traceo-v52";
const SHELL = ["./", "index.html", "app.html", "styles.css", "app.js", "native.js", "chat-brain.js", "ensemble.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "traceo-social").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Safari refuse une page servie par le service worker si elle vient d'une redirection : on la recopie proprement
const clean = res => res.redirected ? res.blob().then(b => new Response(b, {status:res.status, statusText:res.statusText, headers:res.headers})) : res;
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // cartes, adresses, itinéraires : le navigateur gère seul
  e.respondWith(fetch(e.request, {cache:"no-cache"}).then(res => {
    if (res.ok && !res.redirected){ const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return clean(res);
  }).catch(() => caches.match(e.request, {ignoreSearch:true}).then(hit => hit || caches.match(new URL(e.request.url).pathname.endsWith("app.html") ? "app.html" : "./"))));
});

// Notifications « Ensemble » : le serveur envoie un signal vide, on vient lire le dernier message reçu
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let title = "Traceo Ensemble", body = "Un coureur près de toi t'a écrit.";
    try{
      const hit = await (await caches.open("traceo-social")).match("auth");
      if(hit){
        const {api, auth, since} = await hit.json();
        const j = await (await fetch(api + "/social/inbox?since=" + (since || 0), {headers:{Authorization:"Bearer " + auth}})).json();
        const m = (j.msgs || []).filter(x => x.to === j.me.id).pop();
        if(m){
          const n = (j.users[m.from] || {}).name || "Un coureur";
          title = m.kind === "invite" ? `${n} te propose de courir ensemble` : m.kind === "shout" ? `${n} part courir près de toi` : m.kind === "accept" ? `${n} accepte ta course !` : n;
          body = m.body || body;
        }
      }
    }catch(err){}
    await self.registration.showNotification(title, {body, icon:"icons/icon-192.png", badge:"icons/icon-192.png", tag:"ensemble", renotify:true, data:{url:"app.html?tab=ensemble"}});
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window", includeUncontrolled:true}).then(list => {
    const c = list.find(w => /app\.html/.test(w.url));
    if(c){ c.postMessage("ensemble"); return c.focus(); }
    return self.clients.openWindow(e.notification.data?.url || "app.html?tab=ensemble");
  }));
});
