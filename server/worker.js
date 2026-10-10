// Traceo — serveur de l'app (Cloudflare Workers, offre gratuite) :
//   POST /paypal/verify  vérification des abonnements PayPal
//   POST /chat           coach IA du chat (Claude, via le SDK Anthropic ; à défaut, IA gratuite Cloudflare Workers AI)
//   /social/*            « Ensemble » : comptes coureurs, coureurs autour de soi, invitations, messages, notifications
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
  async fetch(req, env){
    const url = new URL(req.url), cors = corsHeaders(req, env);
    if(req.method === "OPTIONS") return new Response(null, {status:204, headers:cors});
    if(url.pathname === "/" || url.pathname === "/health") return json({ok:true, service:"traceo"}, 200, cors);
    if(url.pathname === "/chat") return chat(req, env, cors);
    if(url.pathname.startsWith("/social/")) return social(req, env, cors);
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
  }
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
