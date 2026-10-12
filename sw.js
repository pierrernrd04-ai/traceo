// Traceo — fonctionnement hors ligne de l'app (la carte et le calcul des boucles demandent Internet).
// Version volontairement simple : on ne touche ni aux cartes ni aux services externes, pour éviter tout blocage (Safari).
const VERSION = "traceo-v61";
const SHELL = ["./", "index.html", "app.html", "styles.css", "app.js", "native.js", "chat-brain.js", "ensemble.js", "recettes.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "traceo-social" && k !== "traceo-admin").map(k => caches.delete(k)))).then(() => self.clients.claim()));
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

// Notifications : le serveur envoie un signal vide, on vient lire ce qui est nouveau.
// 1. alertes du fondateur (téléphone activé depuis le tableau de bord), 2. messages « Ensemble ».
// Un même téléphone peut recevoir les deux (un seul abonnement par service worker) ; les navigateurs exigent au moins une notification par signal.
const DASH = "tableau", isDash = u => /\/tableau(\.html)?([?#]|$)/.test(u || "");
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    const show = (t, o) => self.registration.showNotification(t, {icon:"icons/icon-192.png", badge:"icons/icon-192.png", ...o});
    let shown = 0, admin = false, last = null;
    try{
      const ac = await caches.open("traceo-admin"), hit = await ac.match("cfg"), cfg = hit && await hit.json();
      if(cfg && cfg.tok){
        admin = true;
        const r = await fetch(cfg.api + "/social/alerts?since=" + (cfg.since || 0), {headers:{Authorization:"Bearer " + cfg.tok}});
        if(r.status === 401){ admin = false; await ac.delete("cfg"); }   // alertes désactivées depuis un autre appareil
        else if(r.ok){
          const j = await r.json(), list = j.alerts || [], n = Math.max(j.n || 0, list.length), go = a => /^https:\/\//.test(a.url || "") ? a.url : DASH;
          last = j.last || null;
          if(list.length){
            if(n <= 3) for(const a of list){ await show(a.title, {body:a.body, tag:"admin-" + a.id, timestamp:a.t, data:{admin:true, url:go(a)}}); shown++; }
            else{ await show(`${n} nouvelles alertes`, {body:list.slice(-3).reverse().map(a => "• " + a.title).join("\n"), tag:"admin", renotify:true, data:{admin:true, url:DASH}}); shown++; }
            await ac.put("cfg", new Response(JSON.stringify({...cfg, since:list[list.length - 1].id})));
          }
        }
      }
    }catch(err){}
    let title = "Traceo Ensemble", body = "Un coureur près de toi t'a écrit.", ens = false, stale = null;
    try{
      const sc = await caches.open("traceo-social"), hit = await sc.match("auth");
      if(hit){
        ens = true;
        const {api, auth, since} = await hit.json();
        const j = await (await fetch(api + "/social/inbox?since=" + (since || 0), {headers:{Authorization:"Bearer " + auth}})).json();
        const m = (j.msgs || []).filter(x => x.to === j.me.id).pop();
        if(m){
          const n = (j.users[m.from] || {}).name || "Un coureur";
          title = m.kind === "invite" ? `${n} te propose de courir ensemble` : m.kind === "shout" ? `${n} part courir près de toi` : m.kind === "accept" ? `${n} accepte ta course !` : n;
          body = m.body || body;
          // avec les alertes du fondateur, un message déjà montré (ou déjà vu dans l'app) n'est pas remontré à chaque alerte
          const seen = admin ? +(await sc.match("seen").then(r => r ? r.json() : 0).catch(() => 0)) || 0 : 0;
          if(!admin || (m.id > seen && m.id > (since ? since + 5 : 0))){
            await show(title, {body, tag:"ensemble", renotify:true, data:{url:"app.html?tab=ensemble"}}); shown++;
            await sc.put("seen", new Response(JSON.stringify(Math.max(seen, m.id))));
          } else stale = m;
        }
      }
    }catch(err){}
    if(shown) return;
    // rien de nouveau (signal en double, message déjà vu dans l'app) : on remet sans bruit le plus récent des deux ; sinon la notification générique
    if(stale && !(last && last.t > stale.t)) await show(title, {body, tag:"ensemble", silent:true, data:{url:"app.html?tab=ensemble"}});
    else if(last && admin) await show(last.title, {body:last.body, tag:"admin-" + last.id, timestamp:last.t, silent:true, data:{admin:true, url:/^https:\/\//.test(last.url || "") ? last.url : DASH}});
    else if(admin && !ens) await show("Traceo", {body:"Nouvelle alerte : touche pour ouvrir le tableau de bord.", tag:"admin", data:{admin:true, url:DASH}});
    else await show(title, {body, tag:"ensemble", renotify:true, data:{url:"app.html?tab=ensemble"}});
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const d = e.notification.data || {};
  // alerte du fondateur : on revient sur le tableau de bord déjà ouvert (actualisé), sinon on l'ouvre
  if(d.admin) return e.waitUntil(self.clients.matchAll({type:"window", includeUncontrolled:true}).then(list => {
    const url = new URL(d.url || DASH, self.registration.scope).href, c = isDash(url) && list.find(w => isDash(w.url));
    if(c){ c.postMessage("alertes"); return c.focus(); }
    return self.clients.openWindow(url);
  }));
  e.waitUntil(self.clients.matchAll({type:"window", includeUncontrolled:true}).then(list => {
    const c = list.find(w => /app\.html/.test(w.url));
    if(c){ c.postMessage("ensemble"); return c.focus(); }
    return self.clients.openWindow(e.notification.data?.url || "app.html?tab=ensemble");
  }));
});
