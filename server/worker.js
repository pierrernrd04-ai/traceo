// Traceo — serveur de l'app (Cloudflare Workers, offre gratuite) :
//   POST /paypal/verify  vérification des abonnements PayPal
//   POST /chat           coach IA du chat (Claude, via le SDK Anthropic ; à défaut, IA gratuite Cloudflare Workers AI)
//   /social/*            « Ensemble » : comptes coureurs, coureurs autour de soi, invitations, messages, notifications
//   toutes les heures    référencement automatique : pages nouvelles ou modifiées signalées à IndexNow (voir seo())
//
// L'app appelle POST /paypal/verify {subscription_id} et reçoit {active:true|false}.
// Le serveur demande l'état de l'abonnement directement à PayPal avec ta clé secrète,
// qui ne quitte jamais le serveur : impossible de débloquer Premium avec un faux identifiant.
//
// Variables (Cloudflare > Workers > traceo-pay > Paramètres > Variables) :
//   PAYPAL_CLIENT_ID  Client ID de l'app PayPal (mode Live)
//   PAYPAL_SECRET     Secret de la même app (à mettre en « Secret », pas en texte)
//   PAYPAL_PLAN_ID    identifiant du plan à 4,99 €/mois (P-…)
//   PAYPAL_ENV        live (par défaut) ou sandbox pour les essais
//   ANTHROPIC_API_KEY clé API Anthropic pour le chat (à mettre en « Secret ») ; sans elle, le chat utilise
//                     l'IA gratuite de Cloudflare (liaison AI dans wrangler.toml)
//   APP_ORIGIN        adresse(s) de l'app, séparées par des virgules,
//                     ex. https://traceo.pages.dev,https://localhost,capacitor://localhost

// APPROVED : l'acheteur vient de valider, PayPal passe l'abonnement en ACTIVE quelques secondes après.
import Anthropic from "@anthropic-ai/sdk";
import { Hub, social } from "./social.js";
export { Hub };

const ACTIVE = new Set(["ACTIVE", "APPROVED"]);
let token = null;   // jeton PayPal gardé en mémoire tant que le worker reste chaud

export default {
  async fetch(req, env, ctx){
    const url = new URL(req.url), cors = corsHeaders(req, env);
    if(req.method === "OPTIONS") return new Response(null, {status:204, headers:cors});
    if(url.pathname === "/" || url.pathname === "/health") return json({ok:true, service:"traceo"}, 200, cors);
    if(url.pathname === "/chat") return chat(req, env, cors);
    if(url.pathname.startsWith("/social/")) return social(req, env, cors);
    if(url.pathname === "/danger") return danger(req, url, cors, ctx);
    if(url.pathname === "/paypal/ipn" && req.method === "POST"){ const stub = env.HUB.get(env.HUB.idFromName("france")); return stub.fetch(new Request(new URL("/social/ipn", req.url), {method:"POST", body:await req.text()})); }
    if(url.pathname !== "/paypal/verify") return json({error:"not_found"}, 404, cors);
    if(req.method !== "POST") return json({error:"method_not_allowed"}, 405, cors);

    let id;
    try{ id = String((await req.json()).subscription_id || ""); }catch(e){ return json({error:"bad_json"}, 400, cors); }
    if(!/^I-[A-Z0-9]{6,40}$/.test(id)) return json({error:"bad_subscription_id", active:false}, 400, cors);
    if(!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) return json({error:"server_not_configured"}, 500, cors);

    try{
      const sub = await paypal(env, `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
      if(sub.status === 404) return json({active:false, status:"NOT_FOUND"}, 200, cors);
      if(!sub.ok) return json({error:"paypal_error", code:sub.status}, 502, cors);
      const s = sub.data;
      const planOk = !env.PAYPAL_PLAN_ID || s.plan_id === env.PAYPAL_PLAN_ID;
      return json({
        active:planOk && ACTIVE.has(s.status),
        status:s.status,
        plan_ok:planOk,
        next_billing:s.billing_info?.next_billing_time || null
      }, 200, cors);
    }catch(e){
      return json({error:"paypal_unreachable"}, 502, cors);
    }
  },
  // tâche planifiée (wrangler.toml > [triggers]) : référencement automatique, toutes les heures
  async scheduled(event, env, ctx){ const site = await domaine(env).catch(() => null); await seo(env, site); }
};

function base(env){ return env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com"; }

async function getToken(env, force = false){
  if(!force && token && token.exp > Date.now() + 60e3) return token.value;
  const r = await fetch(base(env) + "/v1/oauth2/token", {
    method:"POST",
    headers:{"Authorization":"Basic " + btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`), "Content-Type":"application/x-www-form-urlencoded"},
    body:"grant_type=client_credentials"
  });
  if(!r.ok) throw new Error("oauth " + r.status);
  const j = await r.json();
  token = {value:j.access_token, exp:Date.now() + (j.expires_in || 300)*1000};
  return token.value;
}

async function paypal(env, path){
  for(let attempt = 0; attempt < 2; attempt++){
    const r = await fetch(base(env) + path, {headers:{"Authorization":"Bearer " + await getToken(env, attempt > 0), "Content-Type":"application/json"}});
    if(r.status === 401 && attempt === 0) continue;   // jeton expiré : on en redemande un
    return {ok:r.ok, status:r.status, data:r.ok ? await r.json() : null};
  }
}

function corsHeaders(req, env){
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.APP_ORIGIN || "").split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin":ok ? (origin || "*") : allowed[0],
    "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type, Authorization, X-Admin-Key",
    "Access-Control-Max-Age":"86400",
    "Vary":"Origin"
  };
}

export function json(body, status, headers){
  return new Response(JSON.stringify(body), {status, headers:{...headers, "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store"}});
}

/* ---------- Coach IA du chat ---------- */
const SYSTEM = `Tu es le coach running de Traceo, une app de course à pied qui dessine des boucles neuves dans les vraies rues, depuis la position de la personne, partout en France. Tu es un vrai entraîneur : précis, bienveillant, motivant, et tu t'appuies sur les données de la personne.

Style : français, tutoiement, chaleureux et concret. Réponses courtes (2 à 7 phrases) ou une courte liste ; un plan de séances peut aller jusqu'à 10 lignes. Pas de titres markdown ; **gras** autorisé pour les chiffres clés. Termine souvent par une question ou une proposition pour garder le fil.

Ce que tu sais faire : allures et chronos (prédictions de Riegel, VMA, zones cardio), plans d'entraînement (5 km, 10 km, semi, marathon, reprise, perte de poids), séance du jour adaptée à la fatigue et à l'historique, échauffement, récupération, renforcement, nutrition et hydratation du coureur, motivation, blessures courantes (conseils de prudence), et l'utilisation de l'app.

Contexte fourni à chaque message (JSON) : profil (allure moyenne, poids, objectif, niveau), historique des dernières courses (date, km, durée, allure), volume de la semaine, programme d'entraînement suivi et séance prévue, boucle affichée (distance, dénivelé, rues, points d'eau), départ choisi. Sers-t'en systématiquement pour personnaliser : cite ses chiffres, compare à ses dernières sorties, adapte la charge (pas plus de +10 % de volume par semaine, une séance difficile suivie d'une facile). Si l'historique est vide, propose de commencer simplement.

L'app : écran Courir (se localiser ou choisir une ville, distance de 2 à 42 km ou durée de 10 min à 4 h, « Générer ma boucle », feuille de route, guidage vocal rue par rue), onglet Coach (nutrition, hydratation, programmes, routines guidées), Chat (toi), Ensemble (coureurs autour de soi, invitations à courir, messages ; inclus dans Premium), Boucles (historique), Profil. Export Strava, Garmin, GPX. Carte jour ou nuit.
Premium : 4,99 € pour 31 jours, payé par PayPal (compte ou carte), sans renouvellement automatique.

Actions : quand c'est utile, termine ta réponse par UNE action entre doubles crochets, que l'app transforme en bouton : [[boucle:6]] (boucle de 6 km), [[duree:45]] (boucle de 45 minutes), [[feuille]] (feuille de route de la boucle affichée), [[localiser]], [[onglet:premium]], [[onglet:coach]] (nutrition, programmes, routines), [[onglet:mine]] (historique), [[onglet:ensemble]] (trouver des coureurs autour de soi). N'invente pas d'autres actions. Pour une séance du jour, propose presque toujours [[boucle:X]] ou [[duree:X]].

Santé : tu n'es pas médecin. Douleur vive ou persistante, gêne thoracique, malaise, essoufflement anormal : conseille d'arrêter et de consulter. Pas de conseils de régime extrême.
Reste dans ton rôle de coach running et d'aide sur l'app ; pour toute autre demande, recentre poliment.`;
const hits = new Map();   // limite simple par adresse IP (par instance du worker)
function limited(ip){
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 60e3); h.push(now); hits.set(ip, h);
  if(hits.size > 5000) hits.clear();
  return h.length > 12;   // 12 messages par minute
}
async function chat(req, env, cors){
  if(req.method !== "POST") return json({error:"method_not_allowed"}, 405, cors);
  if(!env.ANTHROPIC_API_KEY && !env.AI) return json({error:"chat_not_configured"}, 503, cors);
  if(limited(req.headers.get("CF-Connecting-IP") || "?")) return json({error:"rate_limited", reply:"Tu vas un peu vite : réessaie dans une minute."}, 429, cors);
  let body; try{ body = await req.json(); }catch(e){ return json({error:"bad_json"}, 400, cors); }
  // historique : 16 derniers messages, alternance user/assistant, 1 500 caractères max par message
  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-16)
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map(m => ({role:m.role, content:m.content.slice(0, 1500)}));
  while(msgs.length && msgs[0].role !== "user") msgs.shift();
  if(!msgs.length || msgs[msgs.length - 1].role !== "user") return json({error:"bad_messages"}, 400, cors);
  const ctx = body.context && typeof body.context === "object" ? JSON.stringify(body.context).slice(0, 3000) : "{}";
  const last = {role:"user", content:`Contexte de l'app (profil, historique, boucle affichée) : ${ctx}\n\nMessage : ${msgs[msgs.length - 1].content}`};
  let out = env.ANTHROPIC_API_KEY ? await claude(env, [...msgs.slice(0, -1), last]) : null;
  if(!out || out.error) out = (env.AI && await workersAI(env, [...msgs.slice(0, -1), last])) || out;
  if(!out) return json({error:"ai_unreachable"}, 502, cors);
  if(out.error) return json(out, out.error === "busy" ? 503 : 502, cors);
  return json(out, 200, cors);
}
async function claude(env, messages){
  const client = new Anthropic({apiKey:env.ANTHROPIC_API_KEY});
  try{
    const res = await client.beta.messages.create({
      model:"claude-opus-5-5",
      max_tokens:2048,
      output_config:{effort:"low"},
      betas:["server-side-fallback-2026-07-01"],
      fallbacks:"default",
      system:[{type:"text", text:SYSTEM, cache_control:{type:"ephemeral"}}],
      messages
    });
    if(res.stop_reason === "refusal") return {reply:"Je ne peux pas t'aider sur ce point. Pose-moi une question sur ta course ou sur l'app !", engine:"claude"};
    const reply = res.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    return {reply:reply || "Je n'ai pas de réponse pour l'instant, reformule ta question ?", engine:"claude"};
  }catch(e){
    if(e instanceof Anthropic.RateLimitError) return {error:"busy"};
    if(e instanceof Anthropic.APIError) return {error:"ai_error", code:e.status};
    return {error:"ai_unreachable"};
  }
}
// IA gratuite de Cloudflare (Workers AI) : utilisée sans clé Anthropic, ou si Claude ne répond pas
const CF_MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct-fast"];
async function workersAI(env, messages){
  for(const model of CF_MODELS){
    try{
      const r = await env.AI.run(model, {messages:[{role:"system", content:SYSTEM}, ...messages], max_tokens:900, temperature:.5});
      const reply = String(r?.response || "").trim();
      if(reply) return {reply, engine:"workers-ai"};
    }catch(e){}
  }
  return null;
}

/* ---------- Routes dangereuses (départementales, nationales, grands axes) par tuile ----------
   L'app demande les tuiles (~4 × 4 km) autour du départ. Le serveur interroge OpenStreetMap (Overpass, plusieurs
   miroirs, le premier qui répond) et garde la réponse 30 jours dans le cache de Cloudflare : rapide et fiable. */
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const TLAT = .04, TLON = .06;
async function danger(req, url, cors, ctx){
  const m = /^(-?\d{1,5})_(-?\d{1,5})$/.exec(url.searchParams.get("t") || "");
  if(!m) return json({error:"bad_tile"}, 400, cors);
  const y = +m[1], x = +m[2], s = (y*TLAT).toFixed(4), w = (x*TLON).toFixed(4), n = ((y + 1)*TLAT).toFixed(4), e = ((x + 1)*TLON).toFixed(4);
  const cacheKey = new Request(`https://traceo-cache/danger/v1/${y}_${x}`), cache = caches.default;
  const hit = await cache.match(cacheKey);
  if(hit){ const r = new Response(hit.body, hit); for(const [k, v] of Object.entries(cors)) r.headers.set(k, v); r.headers.set("X-Cache", "HIT"); return r; }
  const q = `[out:json][timeout:20];(way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link)$"](${s},${w},${n},${e});way["highway"]["ref"~"^(N|D|RN|RD|M|RM) ?[0-9]"](${s},${w},${n},${e}););out tags geom;`;
  // tous les miroirs en même temps : le premier qui répond correctement l'emporte
  const log = [], ac = new AbortController(), to = setTimeout(() => ac.abort(), 20000);
  const tryHost = async host => {
    const r = await fetch(host, {method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded", "User-Agent":"Traceo/1.0 (https://pierrernrd04-ai.github.io/traceo/)"}, body:"data=" + encodeURIComponent(q), signal:ac.signal});
    if(!r.ok || !(r.headers.get("content-type") || "").includes("json")){ log.push(host.split("/")[2] + " " + r.status); throw new Error("bad"); }
    const body = await r.arrayBuffer(); if(body.byteLength < 20) throw new Error("empty");
    return body;
  };
  try{
    // la recherche continue même si le téléphone a cessé d'attendre : la tuile sera en cache pour la prochaine fois
    const job = Promise.any(OVERPASS.map(tryHost)).then(async body => { clearTimeout(to); ac.abort(); await cache.put(cacheKey, new Response(body, {headers:{"Content-Type":"application/json; charset=utf-8", "Cache-Control":"public, max-age=2592000"}})); return body; });
    ctx.waitUntil(job.catch(() => {}));
    const body = await job;
    return new Response(body, {headers:{...cors, "Content-Type":"application/json; charset=utf-8", "Cache-Control":"public, max-age=86400", "X-Cache":"MISS"}});
  }catch(e){ clearTimeout(to); }
  return json({error:"overpass_unavailable", log}, 503, cors);
}

/* ---------- Référencement automatique (IndexNow), sans aucune action manuelle ----------
   Toutes les heures (Cron Trigger) : le serveur lit robots.txt et le sitemap du site, calcule l'empreinte SHA-256 de chaque
   page et signale à IndexNow les pages nouvelles ou modifiées. IndexNow prévient Bing (donc DuckDuckGo, Ecosia, Qwant, Yahoo),
   Yandex, Seznam et Naver : un déploiement du site est signalé dans l'heure. Les empreintes ne sont gardées que si IndexNow
   accepte l'envoi (200 ou 202) ; sinon tout repart à l'heure suivante. État + dernier passage : table kv du Hub (route interne,
   jamais joignable depuis Internet), affichés en bas du tableau de bord. Alerte au fondateur après 3 passages en échec d'affilée.
   Google ne lit pas IndexNow : il découvre le site par le sitemap (Search Console) et robots.txt.
   Variables facultatives : SITE_URL (https://traceorun.pages.dev), INDEXNOW_URL (https://api.indexnow.org/indexnow). */
const INDEXNOW_KEY = "cd00ceeceddb8bfb2a6f8b4ef693a546";
const SEO_MAX = 40;   // pages vérifiées par passage (l'offre gratuite autorise 50 sous-requêtes par exécution)
const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");
// parties qui changent à chaque affichage sans que la page change (ajouts éventuels de Cloudflare) : ignorées dans l'empreinte
const seoNorm = s => s.replace(/<script[^>]*>[^<]*__CF\$cv\$params[\s\S]*?<\/script>/g, "").replace(/\s(nonce|data-cfemail|data-cf-beacon)="[^"]*"/g, "").replace(/\/cdn-cgi\/l\/email-protection#[0-9a-f]+/g, "");
const xmlText = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
// robots.txt : le groupe « User-agent: * » contient-il « Disallow: / » ?
function robotsBlocksAll(txt){
  let star = false, inUa = false, block = false;
  for(const l of txt.split(/\r?\n/).map(s => s.replace(/#.*/, "").trim())){
    const m = /^(user-agent|disallow|allow)\s*:\s*(.*)$/i.exec(l); if(!m) continue;
    if(/^user-agent$/i.test(m[1])){ if(!inUa) star = false; inUa = true; star = star || m[2] === "*"; }
    else{ inUa = false; if(star && /^disallow$/i.test(m[1]) && m[2] === "/") block = true; }
  }
  return block;
}
async function seo(env, main){
  const site = String(env.SITE_URL || main || "https://traceorun.pages.dev").replace(/\/+$/, ""), host = new URL(site).host, keyLocation = `${site}/${INDEXNOW_KEY}.txt`;
  const hub = env.HUB.get(env.HUB.idFromName("france"));
  const state = async body => { const r = await hub.fetch(new Request("https://hub/internal/seo-state", {method:body ? "POST" : "GET", headers:{"X-Traceo-Internal":"seo", "Content-Type":"application/json"}, body:body ? JSON.stringify(body) : undefined})); if(!r.ok) throw new Error("hub " + r.status); return r.json(); };
  const get = (u, ms = 15000) => fetch(u, {headers:{"User-Agent":"Traceo-SEO/1.0 (+https://traceorun.pages.dev/)"}, cache:"no-store", redirect:"follow", signal:AbortSignal.timeout(ms)});
  const old = await state(), prev = old.last || {}, hashes = old.hashes || {}, warn = [];
  const last = {t:Date.now(), checked:0, submitted:[], status:0, error:"", warn, pages:Object.keys(hashes).length, lastSubmit:prev.lastSubmit || 0, fails:0};
  let save = null;
  try{
    // 1. robots.txt : doit exister, annoncer le sitemap et ne pas bloquer tout le site
    const rb = await get(site + "/robots.txt").catch(() => null), robots = rb && rb.ok ? await rb.text() : "";
    if(!rb || !rb.ok) warn.push(`robots.txt introuvable (${rb ? "HTTP " + rb.status : "injoignable"})`);
    else{ if(robotsBlocksAll(robots)) warn.push("robots.txt bloque tout le site aux moteurs"); if(!/^\s*sitemap\s*:\s*\S+/im.test(robots)) warn.push("robots.txt n'annonce pas le sitemap"); }
    // 2. sitemap : liste des pages à surveiller (seulement celles du site)
    const sm = await get(site + "/sitemap.xml").catch(() => null);
    if(!sm || !sm.ok){ last.error = `sitemap illisible (${sm ? "HTTP " + sm.status : "injoignable"})`; return; }
    const xml = await sm.text();
    if(!/<urlset[\s>]/.test(xml) || !/<\/urlset>/.test(xml)) warn.push("sitemap.xml mal formé (balise urlset)");
    let urls = [...new Set([...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => xmlText(m[1])))];
    const foreign = urls.filter(u => { try{ return new URL(u).host !== host; }catch(e){ return true; } });
    if(foreign.length) warn.push(`${foreign.length} adresse(s) du sitemap hors de ${host}, ignorée(s)`);
    urls = urls.filter(u => !foreign.includes(u));
    if(urls.length > SEO_MAX){ warn.push(`sitemap de ${urls.length} pages : ${SEO_MAX} vérifiées par passage`); urls = urls.slice(0, SEO_MAX); }
    if(!urls.length){ last.error = "sitemap vide : aucune page à signaler"; return; }
    // 3. empreinte de chaque page (une erreur passagère du site ne fait rien oublier : la page est revue à l'heure suivante)
    const res = await Promise.all(urls.map(async u => {
      try{
        const r = await get(u);
        if(r.status >= 500 || r.status === 429){ await r.body?.cancel(); return {u, skip:"HTTP " + r.status}; }
        if(!r.ok){ await r.body?.cancel(); return {u, h:"http:" + r.status}; }   // page retirée (404, 410) : signalée aussi
        return {u, h:await sha256(seoNorm(await r.text()))};
      }catch(e){ return {u, skip:e.name === "TimeoutError" ? "délai dépassé" : "injoignable"}; }
    }));
    last.checked = res.filter(x => x.h).length;
    for(const x of res) if(x.skip || x.h.startsWith("http:")) warn.push(`${new URL(x.u).pathname} : ${x.skip || "page introuvable (HTTP " + x.h.slice(5) + ") alors qu'elle est dans le sitemap"}`);
    const fresh = Object.fromEntries(urls.map(u => [u, res.find(x => x.u === u).h || hashes[u]]).filter(([, h]) => h));
    const changed = res.filter(x => x.h && hashes[x.u] !== x.h).map(x => x.u);
    // 4. le fichier-clé doit être en ligne et contenir la clé, sinon IndexNow refuserait l'envoi
    const kf = await get(keyLocation).catch(() => null), keyOk = !!kf && kf.ok && (await kf.text()).trim() === INDEXNOW_KEY;
    if(!keyOk){ last.error = `fichier-clé IndexNow ${kf && kf.ok ? "différent de la clé" : "introuvable (" + (kf ? "HTTP " + kf.status : "injoignable") + ")"} : rien n'est envoyé`; await kf?.body?.cancel().catch(() => {}); return; }
    if(!changed.length){ save = fresh; return; }   // rien de neuf : on ne dérange pas les moteurs
    // 5. envoi groupé à IndexNow (relayé à tous les moteurs participants)
    // plusieurs portes d'entrée : l'adresse partagée des serveurs Cloudflare est parfois refusée (HTTP 429) par l'une, rarement par toutes
    let r = null;
    for(const ep of env.INDEXNOW_URL ? [env.INDEXNOW_URL] : ["https://api.indexnow.org/indexnow", "https://www.bing.com/indexnow", "https://search.seznam.cz/indexnow", "https://yandex.com/indexnow"]){
      r = await fetch(ep, {method:"POST", headers:{"Content-Type":"application/json; charset=utf-8", "User-Agent":"Traceo-SEO/1.0"},
        body:JSON.stringify({host, key:INDEXNOW_KEY, keyLocation, urlList:changed}), signal:AbortSignal.timeout(20000)}).catch(() => null);
      await r?.body?.cancel().catch(() => {});
      if(r && (r.status === 200 || r.status === 202)){ last.via = ep.split("/")[2]; break; }
    }
    last.status = r ? r.status : 0;
    if(r && (r.status === 200 || r.status === 202)){ save = fresh; last.submitted = changed; last.lastSubmit = last.t; }
    else last.error = (last.status ? `les moteurs ont répondu HTTP ${last.status}` + ({400:" (requête invalide)", 403:" (clé refusée)", 422:" (adresses refusées)", 429:" (trop d'envois)"}[last.status] || "") : "aucun moteur joignable") + " : nouvel essai dans une heure";
  }catch(e){ last.error = "erreur : " + String(e.message || e).slice(0, 160); }
  finally{
    if(save) last.pages = Object.keys(save).length;
    last.fails = last.error || warn.length ? (prev.fails || 0) + 1 : 0;
    // alerte unique quand le problème dure depuis 3 passages (3 heures) : circuit d'alertes du Hub (ntfy + notification native), sinon ntfy direct
    if(last.fails === 3){
      const a = {title:"Référencement Traceo à vérifier", body:`Depuis 3 heures : ${[last.error, ...warn].filter(Boolean).join(" ; ").slice(0, 400)}`, tags:"mag", click:"https://traceorun.pages.dev/tableau"};
      const r = await hub.fetch(new Request("https://hub/internal/alert", {method:"POST", headers:{"X-Traceo-Internal":"alert", "Content-Type":"application/json"}, body:JSON.stringify(a)})).catch(() => null);
      if(!r || !r.ok){ await r?.body?.cancel(); if(env.ALERTS_TOPIC) await fetch("https://ntfy.sh/" + env.ALERTS_TOPIC, {method:"POST", headers:{Title:"Referencement Traceo a verifier", Tags:a.tags, Click:a.click}, body:a.body}).catch(() => {}); }
      else await r.body?.cancel();
    }
    await state(save ? {hashes:save, last} : {last}).catch(e => console.error("seo: état non enregistré", e));
  }
}

/* ---------- Domaine gratuit traceo.eu.org : branchement et bascule automatiques ----------
   Pierre ajoute le domaine dans Cloudflare (gratuit) et le demande sur nic.eu.org (gratuit). Ensuite, chaque heure, sans lui :
   1. dès que la zone existe dans Cloudflare, le domaine est branché sur le site (Pages) ;
   2. dès qu'il sert le site, _worker.js (côté site) redirige l'ancienne adresse, le référencement passe dessus et Pierre est prévenu.
   Renvoie l'adresse principale du site. Branchement : secret CF_API_TOKEN + variable CF_ACCOUNT_ID (sans eux, seule la bascule a lieu). */
const DOMAIN = "traceo.eu.org", PAGES_PROJECT = "traceorun", OLD_SITE = "https://traceorun.pages.dev", NEW_SITE = "https://" + DOMAIN;
async function domaine(env){
  const hub = env.HUB.get(env.HUB.idFromName("france"));
  const st = body => hub.fetch(new Request("https://hub/internal/seo-state", {method:body ? "POST" : "GET", headers:{"X-Traceo-Internal":"seo", "Content-Type":"application/json"}, body:body ? JSON.stringify(body) : undefined})).then(r => r.json());
  const alert = a => hub.fetch(new Request("https://hub/internal/alert", {method:"POST", headers:{"X-Traceo-Internal":"alert", "Content-Type":"application/json"}, body:JSON.stringify({tags:"globe_with_meridians", click:OLD_SITE + "/tableau", ...a})})).catch(() => null);
  const d = (await st().catch(() => ({}))).domain || {}, was = d.stage || "";
  const neu = env.DOMAIN_ORIGIN || NEW_SITE;   // surchargé seulement pour les tests locaux
  const live = await fetch(`${neu}/${INDEXNOW_KEY}.txt`, {cache:"no-store", signal:AbortSignal.timeout(8000)}).then(async r => r.ok && (await r.text()).trim() === INDEXNOW_KEY).catch(() => false);
  d.t = Date.now(); d.err = "";
  if(live){
    d.stage = "en_ligne";
    if(was !== "en_ligne"){ d.since = d.t;
      await alert({title:"Ton domaine gratuit est en ligne !", priority:"high", click:NEW_SITE + "/tableau", body:`🎉 ${DOMAIN} sert maintenant Traceo. L'ancienne adresse redirige toute seule (Google garde tout) et tes utilisateurs gardent leurs données. Dernière étape, 2 min : Search Console › Ajouter une propriété › ${NEW_SITE}/ (même code de validation), puis dans l'ancienne propriété › Paramètres › Changement d'adresse.`}); }
  } else if(env.CF_API_TOKEN && env.CF_ACCOUNT_ID){
    const cf = (p, o = {}) => fetch("https://api.cloudflare.com/client/v4" + p, {...o, headers:{Authorization:"Bearer " + env.CF_API_TOKEN, "Content-Type":"application/json"}, signal:AbortSignal.timeout(10000)}).then(r => r.json()).catch(() => ({}));
    const base = `/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${PAGES_PROJECT}/domains`;
    const z = ((await cf(`/zones?name=${DOMAIN}`)).result || [])[0];
    d.zone = z ? z.status : "absente";
    if(!z) d.stage = "attente_cloudflare";
    else{
      let pd = ((await cf(base)).result || []).find(x => x.name === DOMAIN);
      if(!pd){ const r = await cf(base, {method:"POST", body:JSON.stringify({name:DOMAIN})}); pd = r.result; if(!r.success) d.err = (r.errors || []).map(e => e.message).join(" ; ").slice(0, 200); }
      else if(z.status === "active" && /error|deactivated|blocked/.test(pd.status || "")) await cf(`${base}/${DOMAIN}`, {method:"PATCH"});   // relance la vérification
      d.pages = pd ? pd.status : "non branché";
      d.stage = z.status === "active" ? "certificat" : "attente_eu_org";
      if(!d.zoneSeen){ d.zoneSeen = d.t;
        await alert({title:"Domaine ajouté dans Cloudflare", body:`${DOMAIN} est bien dans Cloudflare${pd ? " et branché sur le site" : " (je le branche sur le site dès que Cloudflare l'accepte)"}. Il reste la validation gratuite par eu.org (de quelques jours à quelques semaines) : je bascule tout seul dès qu'elle arrive, rien d'autre à faire.`}); }
      if(z.status === "active"){ d.activeSince = d.activeSince || d.t;
        // validé par eu.org mais toujours pas servi au bout de 24 h : l'enregistrement DNS manque sans doute (une seule alerte)
        if(d.t - d.activeSince > 864e5 && !d.dnsWarned){ d.dnsWarned = d.t;
          await alert({title:"Domaine : une étape à vérifier", priority:"high", body:`${DOMAIN} est validé mais ne répond pas encore. Dans Cloudflare › ${DOMAIN} › DNS, vérifie qu'il existe un enregistrement CNAME « @ » vers ${PAGES_PROJECT}.pages.dev (proxy orange), sinon ajoute-le.`}); } }
    }
  }
  await st({domain:d}).catch(() => {});
  return live ? neu : OLD_SITE;
}
