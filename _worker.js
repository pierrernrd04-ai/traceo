/* Traceo · aiguillage des adresses (Cloudflare Pages, mode avancé : ce fichier reçoit toutes les requêtes du site).
   Tant que le domaine gratuit traceo.eu.org ne répond pas : rien ne change, le site est servi tel quel.
   Dès qu'il répond (domaine validé par eu.org, branché sur Pages par le serveur), sans aucun redéploiement :
   - l'ancienne adresse redirige (301) vers la nouvelle : Google transfère ce qu'il connaît déjà ;
   - les pages de l'app y passent par une page de transfert qui emporte les données du téléphone (compte, réglages, Premium) ;
   - sur la nouvelle adresse, les liens internes (canonical, sitemap, partages) sont réécrits vers elle.
   Toute erreur ici retombe sur le site normal. */
const OLD = "https://traceorun.pages.dev", NEW = "https://traceo.eu.org", KEY = "cd00ceeceddb8bfb2a6f8b4ef693a546";
const APP = /^\/(app|tableau|admin|essai-premium)(\.html)?$/;   // pages qui gardent des données sur le téléphone
const TEXT = /^(text\/html|text\/plain|application\/xml|text\/xml|application\/manifest\+json)/;
let live = null, checked = 0;

// le nouveau domaine sert-il bien ce site ? (vérifié au plus toutes les 10 min par instance)
async function isLive(neu){
  if(live !== null && Date.now() - checked < 600e3) return live;
  checked = Date.now();
  try{ const r = await fetch(`${neu}/${KEY}.txt`, {signal:AbortSignal.timeout(2500)}); live = r.ok && (await r.text()).trim() === KEY; }
  catch(e){ live = false; }
  return live;
}

const moving = (neu, from) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Traceo déménage…</title><style>html,body{margin:0;height:100%;background:#07131A;color:#E6F2F0;font:600 17px system-ui,sans-serif;display:grid;place-items:center;text-align:center}</style></head>
<body><p>Traceo déménage sur <b>${new URL(neu).host}</b>…<br><small style="opacity:.6">tes données te suivent</small></p><script>
var d = {}; try{ for(var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if(/^traceo/.test(k)) d[k] = localStorage.getItem(k); } }catch(e){}
var s = ""; try{ s = btoa(unescape(encodeURIComponent(JSON.stringify(d)))); }catch(e){} if(s.length > 1500000) s = "";
location.replace(${JSON.stringify(neu)} + "/transfert#to=" + encodeURIComponent(location.pathname + location.search) + "&from=" + encodeURIComponent(${JSON.stringify(from)}) + "&d=" + s);
</script></body></html>`;

// Safari (iPhone) ne lit une vidéo que si le serveur répond par morceaux (« Range », réponse 206) : Pages ne le fait pas, on découpe ici
async function ranged(req, res){
  let len = +res.headers.get("Content-Length"); const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("Range") || "");
  if(res.status !== 200) return res;
  const h = new Headers(res.headers); h.set("Accept-Ranges", "bytes");
  if(!m || (m[1] === "" && m[2] === "")) return new Response(res.body, {status:200, headers:h});
  if(!len){   // taille inconnue (envoi en flux) : on lit le fichier entier pour la connaître
    const buf = await res.arrayBuffer(); len = buf.byteLength;
    res = new Response(buf, {status:200, headers:res.headers});
  }
  const s = m[1] === "" ? Math.max(0, len - +m[2]) : +m[1], e = m[1] !== "" && m[2] !== "" ? Math.min(+m[2], len - 1) : len - 1;
  if(s > e || s >= len){ await res.body?.cancel(); return new Response(null, {status:416, headers:{"Content-Range":`bytes */${len}`}}); }
  h.set("Content-Range", `bytes ${s}-${e}/${len}`); h.set("Content-Length", String(e - s + 1));
  const rd = res.body.getReader(); let pos = 0;
  const part = new ReadableStream({
    async pull(ctl){
      for(;;){
        const {done, value} = await rd.read(); if(done){ ctl.close(); return; }
        const a = pos, b = pos + value.byteLength; pos = b;
        if(b <= s) continue;                                    // avant le morceau demandé : ignoré
        ctl.enqueue(value.subarray(Math.max(0, s - a), Math.min(value.byteLength, e - a + 1)));
        if(b > e){ rd.cancel().catch(() => {}); ctl.close(); }  // morceau complet : on arrête de lire
        return;
      }
    },
    cancel(){ rd.cancel().catch(() => {}); }
  });
  const fl = new FixedLengthStream(e - s + 1); part.pipeTo(fl.writable).catch(() => {});
  return new Response(fl.readable, {status:206, headers:h});
}

export default {
  async fetch(req, env){
    const old = env.OLD_ORIGIN || OLD, neu = env.NEW_ORIGIN || NEW;   // surchargés seulement pour les tests locaux
    try{
      const u = new URL(req.url);
      // ancienne adresse : redirection dès que la nouvelle est en ligne
      if(u.origin === old && u.pathname !== `/${KEY}.txt` && await isLive(neu)){
        if(req.method === "GET" && APP.test(u.pathname) && (req.headers.get("Accept") || "").includes("text/html"))
          return new Response(moving(neu, old), {headers:{"Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store", "X-Robots-Tag":"noindex"}});
        return new Response(null, {status:301, headers:{Location:neu + u.pathname + u.search, "Cache-Control":"public, max-age=3600"}});
      }
      let res = await env.ASSETS.fetch(req);
      if(/^(video|audio)\//.test(res.headers.get("Content-Type") || "")) res = await ranged(req, res);
      // nouvelle adresse : liens internes réécrits vers elle (pages, sitemap, robots.txt, manifestes)
      if(u.origin === neu && res.ok && TEXT.test(res.headers.get("Content-Type") || "")){
        const h = new Headers(res.headers); h.delete("Content-Length"); h.delete("ETag");
        return new Response((await res.text()).replaceAll(old, neu), {status:res.status, headers:h});
      }
      return res;
    }catch(e){ return env.ASSETS.fetch(req); }
  }
};
