// Traceo — serveur de vérification des abonnements PayPal (Cloudflare Workers, offre gratuite).
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
//   APP_ORIGIN        adresse(s) de l'app, séparées par des virgules,
//                     ex. https://traceo.pages.dev,https://localhost,capacitor://localhost

// APPROVED : l'acheteur vient de valider, PayPal passe l'abonnement en ACTIVE quelques secondes après.
const ACTIVE = new Set(["ACTIVE", "APPROVED"]);
let token = null;   // jeton PayPal gardé en mémoire tant que le worker reste chaud

export default {
  async fetch(req, env){
    const url = new URL(req.url), cors = corsHeaders(req, env);
    if(req.method === "OPTIONS") return new Response(null, {status:204, headers:cors});
    if(url.pathname === "/" || url.pathname === "/health") return json({ok:true, service:"traceo-pay"}, 200, cors);
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
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type",
    "Access-Control-Max-Age":"86400",
    "Vary":"Origin"
  };
}

function json(body, status, headers){
  return new Response(JSON.stringify(body), {status, headers:{...headers, "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store"}});
}
