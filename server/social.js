// Traceo « Ensemble » : comptes coureurs, coureurs autour de soi, invitations à courir, messages et notifications.
// Tout est gardé dans un Durable Object (base SQLite, offre gratuite de Cloudflare), sans autre service.
//
// Vie privée : la position est arrondie à ~300 m avant d'être enregistrée, n'est montrée qu'en distance arrondie,
// disparaît après 3 h sans activité, et seulement si la personne a choisi d'être visible. Compte supprimable à tout moment.
//
// Comptes : identifiant (pseudo) unique, e-mail, mot de passe, prénom, nom, date de naissance (15 ans minimum).
// Le mot de passe est d'abord étiré sur le téléphone (PBKDF2, 150 000 tours), puis salé et haché ici : il n'est jamais
// stocké ni transmis en clair. Chaque connexion crée une session (jeton aléatoire ; seule son empreinte est gardée).
// Administration (page admin.html) : en-tête X-Admin-Key = secret ADMIN_KEY du serveur.
import { json } from "./worker.js";

export async function social(req, env, cors){
  if(!env.HUB) return json({error:"social_not_configured"}, 503, cors);
  const stub = env.HUB.get(env.HUB.idFromName("france"));
  const headers = new Headers(req.headers); headers.delete("X-Traceo-Internal"); headers.set("X-IP", req.headers.get("CF-Connecting-IP") || "?"); headers.set("X-Country", (req.cf && req.cf.country) || ""); headers.set("X-Region", encodeURIComponent((req.cf && req.cf.region) || ""));
  const res = await stub.fetch(new Request(req.url, {method:req.method, headers, body:req.method === "GET" ? undefined : await req.text()}));
  const out = new Response(res.body, res); for(const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

const NOW = () => Date.now();
const MIN = 60e3, HOUR = 3600e3;
const VISIBLE_FOR = 3*HOUR;          // une position est montrée 3 h après la dernière activité
const GRID = 0.003;                  // ~300 m : arrondi des positions enregistrées
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const sha = async s => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const R = d => d*Math.PI/180;
function km(a, b){ const dLa = R(b.lat - a.lat), dLo = R(b.lon - a.lon); const h = Math.sin(dLa/2)**2 + Math.cos(R(a.lat))*Math.cos(R(b.lat))*Math.sin(dLo/2)**2; return 12742*Math.asin(Math.sqrt(h)); }
const shown = d => d < 1 ? "moins de 1 km" : d < 10 ? `${Math.round(d*2)/2} km`.replace(".", ",") : `${Math.round(d)} km`;
const LEVELS = ["debut", "regulier", "confirme", "expert"];
const ACT_PUB = {"kty":"EC","crv":"P-256","x":"__6AWyNjAcpIy9E2jeaF-pVNzipouEcuYhBleromdtE","y":"WR7Y2cF2dCOReGhUEk7DEFkf2Bmh5rNc0NveDAggRzQ"};   // clé publique d'activation (la clé privée = secret ACT_KEY)
const FREE_LOOPS = 3;   // boucles offertes à chaque nouveau compte (version gratuite)
const REWARD_EVERY = 100, REWARD_EUR = 5;   // un diamant (bon d'achat de 5 €) toutes les 100 courses vérifiées
const DASH_URL = "https://traceorun.pages.dev/tableau";   // ouvert en touchant une alerte
const SITE = "https://traceorun.pages.dev", API_URL = "https://traceo-api.pierre-rnrd04.workers.dev";
const escH = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
// e-mail de bienvenue : même contenu en HTML (mise en page simple, compatible Gmail / Outlook / Apple Mail) et en texte brut
function welcomeMail(first, u){
  const f = escH(first), P = 'style="margin:0;padding:12px 28px 0;font-size:16px;line-height:1.6;color:#2A3B39;"';
  const btn = (href, label, bg, fg) => `<tr><td align="center" style="padding:20px 28px 4px;"><a href="${escH(href)}" style="display:inline-block;padding:15px 30px;border-radius:999px;background:${bg};color:${fg};font-weight:800;font-size:17px;text-decoration:none;">${label}</a></td></tr>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${f}, ta première boucle t'attend</title></head>
<body style="margin:0;padding:0;background:#EEF3F2;"><div style="display:none;max-height:0;overflow:hidden;opacity:0">Une vidéo de 15 secondes rien que pour toi, et tes 3 boucles offertes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF3F2;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#13201F;">
<tr><td style="padding:22px 28px 6px;font-weight:800;font-size:18px;color:#0B5F4A;"><img src="${escH(u.logo)}" width="26" height="26" alt="" style="vertical-align:middle;border-radius:7px;margin-right:8px;border:0;">Traceo</td></tr>
<tr><td style="padding:10px 20px 0;"><a href="${escH(u.video)}" style="display:block;text-decoration:none;"><img src="${escH(u.thumb)}" width="520" alt="▶ Ta vidéo, ${f} (15 s)" style="display:block;width:100%;max-width:520px;height:auto;border-radius:16px;border:0;"></a></td></tr>
<tr><td style="padding:22px 28px 0;font-size:24px;font-weight:800;line-height:1.25;">Salut ${f} 👋</td></tr>
<tr><td ${P}>Merci d'avoir rejoint Traceo ! Je suis Pierre, coureur et créateur de l'app. Je t'ai préparé une petite vidéo de 15 secondes, rien que pour toi.</td></tr>
${btn(u.video, "▶ Voir ma vidéo", "#2BE39B", "#04110D")}
<tr><td style="padding:20px 28px 0;font-size:16px;line-height:1.6;color:#2A3B39;"><b>Ton défi cette semaine : lancer ta première boucle.</b> Tu choisis la distance, Traceo te trace un parcours tout neuf autour de toi, loin des grands axes, et te guide à la voix rue par rue. Tes <b>3 premières boucles sont offertes</b>, sans carte bancaire.</td></tr>
${btn(u.app, "Lancer ma 1re boucle →", "#071318", "#ffffff")}
<tr><td style="padding:22px 28px 0;font-size:16px;line-height:1.6;color:#2A3B39;">Et après ta sortie, dis-moi ce que tu en as pensé : <a href="${escH(u.avis)}" style="color:#0B8A66;font-weight:700;">30 secondes ici</a>, ou réponds simplement à cet e-mail. Je lis chaque retour, et c'est grâce à eux que Traceo s'améliore.</td></tr>
<tr><td style="padding:22px 28px 26px;font-size:16px;line-height:1.6;color:#2A3B39;">Bonne course,<br><b>Pierre</b><br><span style="color:#6B7F7C;font-size:14px;">Fondateur de Traceo</span></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;"><tr><td style="padding:16px 28px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#7D8F8C;text-align:center;">Tu reçois cet e-mail parce que tu as créé un compte Traceo. <a href="${escH(u.unsub)}" style="color:#7D8F8C;">Ne plus recevoir ces e-mails</a>.<br>Traceo · Pierre Renard EI · traceorun.pages.dev</td></tr></table>
</td></tr></table></body></html>`;
  const text = `Salut ${first} !\n\nMerci d'avoir rejoint Traceo ! Je suis Pierre, coureur et créateur de l'app. Je t'ai préparé une petite vidéo de 15 secondes, rien que pour toi :\n${u.video}\n\nTon défi cette semaine : lancer ta première boucle. Tu choisis la distance, Traceo te trace un parcours tout neuf autour de toi, loin des grands axes, et te guide à la voix rue par rue. Tes 3 premières boucles sont offertes, sans carte bancaire :\n${u.app}\n\nEt après ta sortie, dis-moi ce que tu en as pensé (30 secondes) : ${u.avis}\nou réponds simplement à cet e-mail. Je lis chaque retour.\n\nBonne course,\nPierre, fondateur de Traceo\n\n—\nTu reçois cet e-mail parce que tu as créé un compte Traceo. Ne plus recevoir ces e-mails : ${u.unsub}\nTraceo · Pierre Renard EI`;
  return {subject:`${first}, ta première boucle t'attend 🏃`, html, text};
}
const SRC_LABEL = {story:"ta story Instagram", bio:"ta bio Instagram", ig:"Instagram", insta:"Instagram", instagram:"Instagram", linkedin:"LinkedIn", whatsapp:"WhatsApp", facebook:"Facebook", tiktok:"TikTok", strava:"Strava", email:"ton e-mail", qr:"ton QR code", reddit:"Reddit", forum:"un forum running", club:"un club contacté", createur:"un créateur partenaire"};
const SOCIAL_REF = /^(instagram|facebook|linkedin|lnkd\.in|tiktok|t\.co|x|twitter|snapchat|whatsapp|wa\.me|youtube|threads|reddit|strava)(\.com|\.net)?$/;

export class Hub {
  constructor(state, env){
    this.state = state; this.env = env; this.sql = state.storage.sql; this.hits = new Map(); this.hitLim = new Map(); this.hitDay = {day:'', n:0};
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, pseudo TEXT UNIQUE, pw TEXT, first TEXT, last TEXT, email TEXT UNIQUE, birth TEXT, level TEXT, pace INT, bio TEXT,
      created INT, seen INT, last_login INT, lat REAL, lon REAL, place TEXT, visible INT DEFAULT 1, avail_until INT DEFAULT 0, avail_km REAL, avail_note TEXT, push TEXT, notif INT DEFAULT 1, shout_at INT DEFAULT 0, premium INT DEFAULT 0)`);
    try{ this.sql.exec("ALTER TABLE users ADD COLUMN free_used INT DEFAULT 0"); }catch(e){}
    try{ this.sql.exec("ALTER TABLE users ADD COLUMN phone TEXT"); }catch(e){}
    try{ this.sql.exec("ALTER TABLE users ADD COLUMN phone_ok INT DEFAULT 0"); }catch(e){}
    try{ this.sql.exec("ALTER TABLE users ADD COLUMN phone_code TEXT"); }catch(e){}
    try{ this.sql.exec("ALTER TABLE users ADD COLUMN phone_code_exp INT DEFAULT 0"); }catch(e){}   // boucles gratuites utilisées (3 offertes)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions(tok TEXT PRIMARY KEY, uid TEXT, created INT, seen INT, ua TEXT)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS sessions_uid ON sessions(uid)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS msgs(id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT, b TEXT, t INT, kind TEXT, body TEXT, meta TEXT)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS msgs_b ON msgs(b, id)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS msgs_a ON msgs(a, id)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS blocks(who TEXT, whom TEXT, PRIMARY KEY(who, whom))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports(t INT, who TEXT, whom TEXT, why TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)`);
    // Paiements reçus par PayPal (notification instantanée IPN) et demandes d'activation en attente
    this.sql.exec(`CREATE TABLE IF NOT EXISTS payments(txn TEXT PRIMARY KEY, email TEXT, amount TEXT, currency TEXT, t INT, dev TEXT, until INT, name TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS act_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, dev TEXT, t INT, done INT DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, dev TEXT, t INT, amount TEXT, payer TEXT, until INT)`);
    // Programme « 100 courses = 1 diamant de 5 € » (bon d'achat = 31 jours de Premium) : courses vérifiées et diamants
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, t INT, day TEXT, dist INT, time INT, ascent INT, n_pts INT, hash TEXT, ok INT, reason TEXT, premium INT, lat REAL, lon REAL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS runs_uid ON runs(uid, ok, t)`);
    // Mesure d'audience sans cookie : un identifiant de visite anonyme qui change chaque jour (empreinte salée, sel aléatoire jeté le lendemain)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hits(id INTEGER PRIMARY KEY AUTOINCREMENT, t INT, day TEXT, vid TEXT, ev TEXT, path TEXT, src TEXT, ref TEXT, country TEXT, dev TEXT)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS hits_day ON hits(day, ev)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS hits_vid ON hits(day, vid)`);
    try{ this.sql.exec("ALTER TABLE hits ADD COLUMN region TEXT"); }catch(e){}
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rewards(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, milestone INT, amount REAL, status TEXT, paypal TEXT, created INT, done_at INT, note TEXT)`);
    // Alertes du fondateur : historique (~300 dernières, lues par le téléphone) et téléphones activés depuis le tableau de bord (notifications natives)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY AUTOINCREMENT, t INT, title TEXT, body TEXT, url TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS admin_push(id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT UNIQUE, sub TEXT, tok TEXT, created INT, label TEXT)`);
    // e-mail de bienvenue (vidéo personnalisée) : désinscription en un clic, envoyé une seule fois ; avis des coureurs
    try{ this.sql.exec("ALTER TABLE users ADD COLUMN mail_off INT DEFAULT 0"); }catch(e){}
    try{ this.sql.exec("ALTER TABLE users ADD COLUMN welcomed INT DEFAULT 0"); }catch(e){}
    this.sql.exec(`CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY AUTOINCREMENT, t INT, stars INT, text TEXT, name TEXT, src TEXT)`);
  }
  rows(q, ...a){ return [...this.sql.exec(q, ...a)]; }
  one(q, ...a){ return this.rows(q, ...a)[0] || null; }
  limit(key, n, ms){ const now = NOW(), h = (this.hits.get(key) || []).filter(t => now - t < ms); if(h.length >= n){ this.hits.set(key, h); return true; } h.push(now); this.hits.set(key, h); if(this.hits.size > 20000) this.hits.clear(); return false; }

  async fetch(req){
    const url = new URL(req.url), path = url.pathname.replace(/^\/social\//, ""), ip = req.headers.get("X-IP") || "?";
    // route interne du référencement automatique (worker.js > seo) : le routeur public n'envoie ici que des chemins /social/…, jamais /internal/…
    if(url.pathname === "/internal/seo-state") return req.headers.get("X-Traceo-Internal") === "seo" ? this.seoState(req) : json({error:"not_found"}, 404, {});
    // alerte envoyée par worker.js (tâches planifiées) : même circuit que les autres (ntfy + notification native du tableau de bord)
    if(url.pathname === "/internal/alert"){ if(req.headers.get("X-Traceo-Internal") !== "alert" || req.method !== "POST") return json({error:"not_found"}, 404, {}); const a = await req.json().catch(() => ({})); return json(await this.alert(clean(a.title, 120) || "Alerte Traceo", String(a.body || "").slice(0, 1000), {tags:clean(a.tags, 40), priority:clean(a.priority, 10), click:/^https:\/\//.test(a.click || "") ? String(a.click).slice(0, 300) : ""}), 200, {}); }
    if(path === "ipn") return this.ipn(await req.text());
    let body = {}; if(req.method === "POST"){ const raw = await req.text(); if(raw.trim()){ try{ body = JSON.parse(raw); }catch(e){ return json({error:"bad_json"}, 400, {}); } } }
    try{
      if(path === "vapid") return json({key:(await this.vapid()).pub}, 200, {});
      if(path === "pay") return this.pay(body, ip);
      if(path === "activate") return this.activateRequest(body, ip);
      if(path === "signup") return this.signup(body, ip, req);
      if(path === "login") return this.login(body, ip, req);
      if(path === "pseudo") return json({free:!this.one("SELECT 1 AS x FROM users WHERE pseudo = ?", clean(url.searchParams.get("p"), 20).toLowerCase())}, 200, {});
      if(path.startsWith("admin/")) return this.admin(req, path.slice(6), body, url, ip);
      if(path === "sms-status") return json({sms:this.smsReady()}, 200, {});
      if(path === "hit") return await this.hit(body, req, ip);
      if(path === "alerts") return await this.alertsFeed(req, url, ip);
      if(path === "evt") return this.evtAlert(body, ip);
      if(path === "avis") return req.method === "POST" ? this.feedback(body, ip) : json({error:"method"}, 405, {});
      if(path === "unsub") return await this.unsub(url, req);
      const me = await this.auth(req);
      if(!me) return json({error:"auth"}, 401, {});
      this.sql.exec("UPDATE users SET seen = ? WHERE id = ?", NOW(), me.id);
      switch(path){
        case "me": return this.update(me, body);
        case "delete": return this.remove(me);
        case "logout": this.sql.exec("DELETE FROM sessions WHERE tok = ?", await sha(this.tok(req))); return json({ok:true}, 200, {});
        case "pos": return this.pos(me, body);
        case "nearby": return this.nearby(me, +url.searchParams.get("r") || 10);
        case "send": return this.send(me, body);
        case "shout": return this.shout(me, body);
        case "inbox": return this.inbox(me, +url.searchParams.get("since") || 0);
        case "block": return this.block(me, body);
        case "run": return this.run(me, body);
        case "quota": return this.quota(me, body, false);
        case "phone/start": return this.phoneStart(me, body, ip, await this.isAdmin(req));
        case "phone/check": return this.phoneCheck(me, body);
        case "gen": return this.quota(me, body, true);
        case "runs": return this.runsInfo(me);
        case "claim": return this.claim(me, body);
        case "report": return this.report(me, body);
      }
      return json({error:"not_found"}, 404, {});
    }catch(e){ return json({error:"server", detail:String(e.message || e).slice(0, 200)}, 500, {}); }
  }

  tok(req){ const m = /^Bearer\s+([a-f0-9]{48})$/i.exec(req.headers.get("Authorization") || ""); return m ? m[1] : ""; }
  async auth(req){
    const t = this.tok(req); if(!t) return null;
    const ses = this.one("SELECT * FROM sessions WHERE tok = ?", await sha(t)); if(!ses) return null;
    if(NOW() - ses.seen > 10*MIN) this.sql.exec("UPDATE sessions SET seen = ? WHERE tok = ?", NOW(), ses.tok);
    return this.one("SELECT * FROM users WHERE id = ?", ses.uid);
  }
  pub(u){ return {id:u.id, pseudo:u.pseudo, name:`${u.first} ${u.last ? u.last[0].toUpperCase() + "." : ""}`.trim(), first:u.first, level:u.level, pace:u.pace, bio:u.bio || ""}; }
  async newSession(u, req){
    const token = hex(crypto.getRandomValues(new Uint8Array(24)));
    this.sql.exec("INSERT INTO sessions(tok, uid, created, seen, ua) VALUES(?,?,?,?,?)", await sha(token), u.id, NOW(), NOW(), clean(req.headers.get("User-Agent"), 160));
    this.sql.exec("UPDATE users SET last_login = ?, seen = ? WHERE id = ?", NOW(), NOW(), u.id);
    return token;
  }
  async hashPw(key, salt){ salt = salt || hex(crypto.getRandomValues(new Uint8Array(16))); return salt + ":" + await sha(salt + ":" + key); }
  async signup(b, ip, req){
    // 30 par heure et par adresse IP : un club ou une salle sur le même Wi-Fi peut s'inscrire en même temps (le test de charge bloquait dès la 9e personne)
    if(this.limit("su:" + ip, 30, HOUR)) return json({error:"rate_limited"}, 429, {});
    const first = clean(b.first, 30), last = clean(b.last, 40), email = clean(b.email, 120).toLowerCase(), pseudo = clean(b.pseudo, 20).toLowerCase(), birth = clean(b.birth, 10);
    if(!first || !last) return json({error:"name_required"}, 400, {});
    if(!/^[a-z0-9][a-z0-9_.]{2,19}$/.test(pseudo)) return json({error:"bad_pseudo"}, 400, {});
    if(!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return json({error:"bad_email"}, 400, {});
    if(!/^[a-f0-9]{64}$/.test(String(b.key || ""))) return json({error:"bad_password"}, 400, {});
    const bd = Date.parse(birth + "T00:00:00Z");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(birth) || !isFinite(bd) || bd < Date.parse("1900-01-01")) return json({error:"bad_birth"}, 400, {});
    if((NOW() - bd)/(365.25*864e5) < 15) return json({error:"too_young"}, 400, {});
    if(!b.terms) return json({error:"consent_required"}, 400, {});
    if(this.one("SELECT 1 AS x FROM users WHERE pseudo = ?", pseudo)) return json({error:"pseudo_taken"}, 409, {});
    if(this.one("SELECT 1 AS x FROM users WHERE email = ?", email)) return json({error:"email_taken"}, 409, {});
    const id = hex(crypto.getRandomValues(new Uint8Array(8)));
    this.sql.exec("INSERT INTO users(id, pseudo, pw, first, last, email, birth, level, pace, bio, created, seen, visible, premium) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, pseudo, await this.hashPw(b.key), first, last, email, birth, LEVELS.includes(b.level) ? b.level : "regulier", Math.max(150, Math.min(900, +b.pace || 345)), clean(b.bio, 140), NOW(), NOW(), b.visible === false ? 0 : 1, b.premium ? 1 : 0);
    const u = this.one("SELECT * FROM users WHERE id = ?", id), token = await this.newSession(u, req);
    {
      // chiffres agrégés du jour seulement : l'inscription n'est jamais reliée à une visite précise
      const day = new Date().toLocaleDateString("sv-SE", {timeZone:"Europe/Paris"});
      const vis = this.one("SELECT COUNT(DISTINCT vid) AS n, COUNT(DISTINCT CASE WHEN src != '' THEN vid END) AS l FROM hits WHERE day = ? AND ev = 'pv'", day);
      const su = this.one("SELECT COUNT(*) AS n FROM users WHERE created >= ?", NOW() - 864e5).n, tot = this.one("SELECT COUNT(*) AS n FROM users").n;
      this.alert("Nouvel inscrit Traceo", `${first} ${last} (@${pseudo}) vient de créer son compte.\nAujourd'hui : ${vis.n} visiteur${vis.n > 1 ? "s" : ""} (dont ${vis.l} via tes liens) · ${su} inscription${su > 1 ? "s" : ""} en 24 h · ${tot} membres au total.`, {tags:"tada", priority:"high", click:DASH_URL});
    }
    if(this.one("SELECT v FROM kv WHERE k = 'welcome:auto'")?.v === "1") this.state.waitUntil(this.welcome(u).catch(() => {}));
    return json({token, me:this.mine(u)}, 200, {});
  }
  async login(b, ip, req){
    const who = clean(b.login, 120).toLowerCase().replace(/^@/, "");
    if(this.limit("li:" + ip, 20, 15*MIN) || this.limit("lu:" + who, 8, 15*MIN)) return json({error:"rate_limited"}, 429, {});
    const u = this.one("SELECT * FROM users WHERE email = ? OR pseudo = ?", who, who);
    if(!u || !/^[a-f0-9]{64}$/.test(String(b.key || "")) || await this.hashPw(b.key, u.pw.split(":")[0]) !== u.pw) return json({error:"bad_login"}, 401, {});
    return json({token:await this.newSession(u, req), me:this.mine(u)}, 200, {});
  }
  mine(u){ return {...this.pub(u), last:u.last, email:u.email, birth:u.birth, phone_ok:!!u.phone_ok, visible:!!u.visible, notif:!!u.notif, push:!!u.push, avail_until:u.avail_until || 0}; }
  async update(me, b){
    const f = {};
    if(b.first != null) f.first = clean(b.first, 30) || me.first;
    if(b.last != null) f.last = clean(b.last, 40) || me.last;
    if(b.level != null && LEVELS.includes(b.level)) f.level = b.level;
    if(b.pace != null) f.pace = Math.max(150, Math.min(900, +b.pace || me.pace));
    if(b.bio != null) f.bio = clean(b.bio, 140);
    if(b.visible != null) f.visible = b.visible ? 1 : 0;
    if(b.notif != null) f.notif = b.notif ? 1 : 0;
    if(b.push !== undefined) f.push = b.push && typeof b.push === "object" && /^https:\/\//.test(b.push.endpoint || "") ? JSON.stringify({endpoint:String(b.push.endpoint).slice(0, 600)}) : null;
    if(b.avail === false) f.avail_until = 0;
    if(b.premium != null) f.premium = b.premium ? 1 : 0;
    if(b.place != null) f.place = clean(b.place, 60);
    if(b.key != null && /^[a-f0-9]{64}$/.test(String(b.key)) && /^[a-f0-9]{64}$/.test(String(b.oldKey || ""))){
      if(await this.hashPw(b.oldKey, me.pw.split(":")[0]) !== me.pw) return json({error:"bad_login"}, 401, {});
      f.pw = await this.hashPw(b.key);
    }
    const keys = Object.keys(f);
    if(keys.length) this.sql.exec(`UPDATE users SET ${keys.map(k => k + " = ?").join(", ")} WHERE id = ?`, ...keys.map(k => f[k]), me.id);
    return json({me:this.mine(this.one("SELECT * FROM users WHERE id = ?", me.id))}, 200, {});
  }
  remove(me){
    if(!me) return json({ok:true}, 200, {});
    this.sql.exec("DELETE FROM msgs WHERE a = ? OR b = ?", me.id, me.id);
    this.sql.exec("DELETE FROM blocks WHERE who = ? OR whom = ?", me.id, me.id);
    this.sql.exec("DELETE FROM sessions WHERE uid = ?", me.id);
    this.sql.exec("DELETE FROM runs WHERE uid = ?", me.id);
    this.sql.exec("DELETE FROM rewards WHERE uid = ? AND status != 'versee'", me.id);
    this.sql.exec("DELETE FROM users WHERE id = ?", me.id);
    return json({ok:true}, 200, {});
  }
  pos(me, b){
    const lat = +b.lat, lon = +b.lon;
    if(!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({error:"bad_pos"}, 400, {});
    this.sql.exec("UPDATE users SET lat = ?, lon = ? WHERE id = ?", Math.round(lat/GRID)*GRID, Math.round(lon/GRID)*GRID, me.id);
    return json({ok:true}, 200, {});
  }
  blockedSet(id){ return new Set(this.rows("SELECT whom AS x FROM blocks WHERE who = ? UNION SELECT who AS x FROM blocks WHERE whom = ?", id, id).map(r => r.x)); }
  around(me, rKm, since){
    if(me.lat == null) return [];
    const dLa = rKm/111, dLo = rKm/(111*Math.max(.2, Math.cos(R(me.lat)))), bl = this.blockedSet(me.id);
    return this.rows(`SELECT * FROM users WHERE id != ? AND visible = 1 AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND (seen > ? OR avail_until > ?) LIMIT 300`,
      me.id, me.lat - dLa, me.lat + dLa, me.lon - dLo, me.lon + dLo, since, NOW())
      .map(u => ({u, d:km(me, u)})).filter(x => x.d <= rKm && !bl.has(x.u.id)).sort((a, b) => a.d - b.d);
  }
  nearby(me, r){
    r = Math.max(1, Math.min(30, r));
    const list = this.around(me, r, NOW() - VISIBLE_FOR).slice(0, 60).map(({u, d}) => ({...this.pub(u), dist:shown(d), d:Math.round(d*2)/2,
      online:NOW() - u.seen < 10*MIN, seenMin:Math.round((NOW() - u.seen)/MIN), avail:u.avail_until > NOW() ? {until:u.avail_until, km:u.avail_km, note:u.avail_note || ""} : null}));
    const total = this.one("SELECT COUNT(*) AS n FROM users").n;
    return json({list, located:me.lat != null, total}, 200, {});
  }
  async send(me, b){
    const to = this.one("SELECT * FROM users WHERE id = ?", clean(b.to, 32));
    if(!to) return json({error:"unknown_user"}, 404, {});
    if(this.blockedSet(me.id).has(to.id)) return json({error:"blocked"}, 403, {});
    if(this.limit("msg:" + me.id, 40, HOUR)) return json({error:"rate_limited"}, 429, {});
    const kind = ["msg", "invite", "accept", "decline"].includes(b.kind) ? b.kind : "msg";
    const text = clean(b.body, 500); if(!text && kind === "msg") return json({error:"empty"}, 400, {});
    const meta = kind === "invite" ? JSON.stringify({when:clean(b.when, 40), km:Math.max(1, Math.min(42, +b.km || 0)) || null, place:clean(b.place, 80)}) : null;
    const id = this.one("INSERT INTO msgs(a, b, t, kind, body, meta) VALUES(?,?,?,?,?,?) RETURNING id", me.id, to.id, NOW(), kind, text, meta).id;
    const label = kind === "invite" ? `${this.pub(me).name} te propose de courir ensemble` : kind === "accept" ? `${this.pub(me).name} accepte ta course !` : `${this.pub(me).name} t'a écrit`;
    this.state.waitUntil(this.push(to, label, text));
    return json({id}, 200, {});
  }
  // « Je pars courir » : prévient les coureurs visibles à moins de 5 km (une fois toutes les 20 min au plus)
  async shout(me, b){
    if(b.cancel){ this.sql.exec("UPDATE users SET avail_until = 0 WHERE id = ?", me.id); return json({ok:true, notified:0}, 200, {}); }
    if(me.lat == null) return json({error:"no_position"}, 400, {});
    const inMin = Math.max(0, Math.min(180, +b.inMin || 0)), kmv = Math.max(1, Math.min(42, +b.km || 5)), note = clean(b.note, 120);
    this.sql.exec("UPDATE users SET avail_until = ?, avail_km = ?, avail_note = ? WHERE id = ?", NOW() + (inMin + 60)*MIN, kmv, note, me.id);
    if(NOW() - (me.shout_at || 0) < 20*MIN) return json({ok:true, notified:0, cooldown:true}, 200, {});
    this.sql.exec("UPDATE users SET shout_at = ? WHERE id = ?", NOW(), me.id);
    const when = inMin ? `dans ${inMin} min` : "maintenant", txt = `Je pars courir ${kmv} km ${when}${note ? " · " + note : ""}. Qui vient ?`;
    const meta = JSON.stringify({when, km:kmv, place:note});
    const near = this.around(me, 5, NOW() - 24*HOUR).slice(0, 40);
    for(const {u} of near){
      this.sql.exec("INSERT INTO msgs(a, b, t, kind, body, meta) VALUES(?,?,?,?,?,?)", me.id, u.id, NOW(), "shout", txt, meta);
      if(u.notif) this.state.waitUntil(this.push(u, `${this.pub(me).name} part courir près de toi`, txt));
    }
    return json({ok:true, notified:near.length}, 200, {});
  }
  inbox(me, since){
    const bl = this.blockedSet(me.id);
    const msgs = this.rows("SELECT * FROM msgs WHERE (b = ? OR a = ?) AND id > ? ORDER BY id DESC LIMIT 300", me.id, me.id, since).reverse()
      .filter(m => !bl.has(m.a === me.id ? m.b : m.a)).map(m => ({id:m.id, from:m.a, to:m.b, t:m.t, kind:m.kind, body:m.body, meta:m.meta ? JSON.parse(m.meta) : null}));
    const ids = [...new Set(msgs.flatMap(m => [m.from, m.to]))].filter(x => x !== me.id);
    const users = {}; for(const id of ids){ const u = this.one("SELECT * FROM users WHERE id = ?", id); if(u) users[id] = this.pub(u); }
    return json({msgs, users, me:this.mine(me)}, 200, {});
  }
  block(me, b){ const who = clean(b.who, 32); if(who && who !== me.id) this.sql.exec("INSERT OR IGNORE INTO blocks(who, whom) VALUES(?, ?)", me.id, who); return json({ok:true}, 200, {}); }
  report(me, b){
    const who = clean(b.who, 32); if(!who) return json({error:"who"}, 400, {});
    this.sql.exec("INSERT INTO reports(t, who, whom, why) VALUES(?,?,?,?)", NOW(), me.id, who, clean(b.why, 300));
    this.sql.exec("INSERT OR IGNORE INTO blocks(who, whom) VALUES(?, ?)", me.id, who);
    // alerte instantanée au responsable de l'app (même canal ntfy que les alertes de l'app)
    this.alert("Signalement Traceo Ensemble", `${me.id} signale ${who} : ${clean(b.why, 300)}`, {priority:"high"});
    return json({ok:true}, 200, {});
  }

  /* ---------- Programme « 100 courses = 1 diamant de 5 € » (bon d'achat Premium) ---------- */
  // Une course compte si : Premium actif, au moins 2 km et 12 min, allure entre 3'00 et 11'00/km, trace GPS cohérente
  // (distance des points proche de la distance annoncée, pas de déplacement à plus de 25 km/h), 2 courses comptées par jour au plus,
  // 3 h d'écart minimum entre deux courses comptées, et jamais deux fois la même trace.
  runsInfo(me){
    const count = this.one("SELECT COUNT(*) AS n FROM runs WHERE uid = ? AND ok = 1", me.id).n;
    const runs = this.rows("SELECT t, dist, time, ok, reason FROM runs WHERE uid = ? ORDER BY id DESC LIMIT 15", me.id);
    const rewards = this.rows("SELECT id, milestone, amount, status, paypal, created, done_at FROM rewards WHERE uid = ? ORDER BY id DESC", me.id);
    return json({count, every:REWARD_EVERY, amount:REWARD_EUR, runs, rewards}, 200, {});
  }
  async run(me, b){
    if(this.limit("run:" + me.id, 6, HOUR)) return json({error:"rate_limited"}, 429, {});
    const pts = (Array.isArray(b.pts) ? b.pts : []).slice(0, 4000).filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2]));
    const dist = Math.round(+b.dist || 0), time = Math.round(+b.time || 0), now = NOW();
    const day = new Date(now + 2*HOUR).toISOString().slice(0, 10);   // jour (heure de Paris, approximative)
    let reason = "";
    // contrôles de la trace
    let len = 0, fast = 0, segs = 0;
    for(let i = 1; i < pts.length; i++){
      const a = {lat:pts[i-1][0], lon:pts[i-1][1]}, c = {lat:pts[i][0], lon:pts[i][1]}, d = km(a, c)*1000, dt = (pts[i][2] - pts[i-1][2])/1000;
      len += d; if(dt > 0){ segs++; if(d/dt > 7) fast++; }   // 7 m/s = 25 km/h
    }
    const span = pts.length > 1 ? (pts[pts.length - 1][2] - pts[0][2])/1000 : 0, pace = dist > 0 ? time/(dist/1000) : 0;
    const hash = await sha(pts.map(p => p[0].toFixed(5) + "," + p[1].toFixed(5)).join(";"));
    if(!b.premium) reason = "premium";
    else if(dist < 2000) reason = "trop_courte";
    else if(time < 12*60) reason = "trop_breve";
    else if(pace < 180 || pace > 660) reason = "allure";
    else if(pts.length < 30) reason = "gps";
    else if(Math.abs(len - dist) > Math.max(400, dist*.2)) reason = "gps";
    else if(span < time*.7 || span > time*1.6 + 600) reason = "gps";
    else if(segs && fast/segs > .05) reason = "vitesse";
    else if(this.one("SELECT 1 AS x FROM runs WHERE hash = ? AND ok = 1", hash)) reason = "doublon";
    else if(this.one("SELECT COUNT(*) AS n FROM runs WHERE uid = ? AND ok = 1 AND day = ?", me.id, day).n >= 2) reason = "quota_jour";
    else if(this.one("SELECT 1 AS x FROM runs WHERE uid = ? AND ok = 1 AND t > ?", me.id, now - 3*HOUR)) reason = "trop_rapprochee";
    const ok = reason ? 0 : 1;
    this.sql.exec("INSERT INTO runs(uid, t, day, dist, time, ascent, n_pts, hash, ok, reason, premium, lat, lon) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      me.id, now, day, dist, time, Math.round(+b.ascent || 0), pts.length, hash, ok, reason, b.premium ? 1 : 0, pts[0] ? Math.round(pts[0][0]/GRID)*GRID : null, pts[0] ? Math.round(pts[0][1]/GRID)*GRID : null);
    const count = this.one("SELECT COUNT(*) AS n FROM runs WHERE uid = ? AND ok = 1", me.id).n;
    let reward = null;
    if(ok && count % REWARD_EVERY === 0){
      this.sql.exec("INSERT INTO rewards(uid, milestone, amount, status, created) VALUES(?,?,?,?,?)", me.id, count, REWARD_EUR, "a_reclamer", now);
      reward = {milestone:count, amount:REWARD_EUR};
      this.alert("Diamant gagné", `${me.first} ${me.last} (@${me.pseudo}) a validé sa ${count}e course et gagne un diamant de ${REWARD_EUR} €.`, {tags:"gem"});
    }
    return json({ok:!!ok, reason, count, every:REWARD_EVERY, reward}, 200, {});
  }
  // Utilisation d'un diamant (bon d'achat de 5 € = 31 jours de Premium) : Pierre active les jours offerts sur l'appareil indiqué
  claim(me, b){
    const dev = clean(b.dev, 16).toLowerCase(); if(!/^[a-f0-9]{16}$/.test(dev)) return json({error:"bad_device"}, 400, {});
    const r = this.one("SELECT * FROM rewards WHERE uid = ? AND id = ? AND status = 'a_reclamer'", me.id, +b.id);
    if(!r) return json({error:"unknown_reward"}, 404, {});
    this.sql.exec("UPDATE rewards SET status = 'demandee', paypal = ? WHERE id = ?", dev, r.id);
    const url = `${this.env.PUSH_SUBJECT || "https://pierrernrd04-ai.github.io/traceo/"}admin.html#act=${dev}&e=${encodeURIComponent("diamant @" + me.pseudo)}`;
    this.alert("Diamant à activer", `@${me.pseudo} utilise son diamant (${r.milestone}e course) : 31 jours de Premium à activer.`, {tags:"gem", priority:"high", click:url, actions:"view, Activer, " + url});
    return json({ok:true}, 200, {});
  }

  /* ---------- Version gratuite : 3 boucles offertes par compte ----------
     Premium (activation signée valide) : illimité. Sinon on compte les boucles générées côté serveur,
     pour qu'effacer les données du téléphone ou réinstaller l'app ne redonne pas de boucles gratuites. */
  async premiumOk(code){
    try{
      const [p64, s64] = String(code || "").split("."); if(!p64 || !s64) return false;
      const dec = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
      const key = this._pk || (this._pk = await crypto.subtle.importKey("jwk", ACT_PUB, {name:"ECDSA", namedCurve:"P-256"}, false, ["verify"]));
      const raw = dec(p64); if(!await crypto.subtle.verify({name:"ECDSA", hash:"SHA-256"}, key, dec(s64), raw)) return false;
      return +new TextDecoder().decode(raw).split("|")[1] > NOW();
    }catch(e){ return false; }
  }
  async quota(me, b, use){
    if(await this.premiumOk(b.code)){ if(!me.premium) this.sql.exec("UPDATE users SET premium = 1 WHERE id = ?", me.id); return json({premium:true, left:999, used:me.free_used || 0, free:FREE_LOOPS}, 200, {}); }
    let used = me.free_used || 0;
    if(use){ if(used >= FREE_LOOPS) return json({premium:false, left:0, used, free:FREE_LOOPS, error:"quota"}, 402, {}); used++; this.sql.exec("UPDATE users SET free_used = ? WHERE id = ?", used, me.id); }
    return json({premium:false, left:Math.max(0, FREE_LOOPS - used), used, free:FREE_LOOPS}, 200, {});
  }

  /* ---------- Vérification du numéro de téléphone (code à 6 chiffres par SMS, service Twilio Verify) ----------
     Prouve qu'une vraie personne paie avec son propre téléphone. Sans identifiants Twilio, l'étape est sautée. */
  normPhone(p){ let x = String(p || "").replace(/[\s.\-()]/g, ""); if(/^0[1-9]\d{8}$/.test(x)) x = "+33" + x.slice(1); return /^\+[1-9]\d{7,14}$/.test(x) ? x : null; }
  async twilio(path, form){
    return fetch("https://verify.twilio.com/v2/Services/" + this.env.TWILIO_VERIFY_SID + path, {method:"POST", headers:{Authorization:"Basic " + btoa(this.env.TWILIO_ACCOUNT_SID + ":" + this.env.TWILIO_AUTH_TOKEN), "Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams(form).toString()}).then(r => r.json());
  }
  async isAdmin(req){ const k = req.headers.get("X-Admin-Key") || ""; return !!(this.env.ADMIN_KEY && k.length === this.env.ADMIN_KEY.length && await sha(k) === await sha(this.env.ADMIN_KEY)); }
  smsReady(){ return !!(this.env.TWILIO_ACCOUNT_SID && this.env.TWILIO_AUTH_TOKEN && this.env.TWILIO_VERIFY_SID); }
  async phoneStart(me, b, ip, admin){
    if(admin && b.force){ this.sql.exec("UPDATE users SET phone_ok = 0 WHERE id = ?", me.id); me.phone_ok = 0; }   // test : on recommence la vérification
    if(me.phone_ok) return json({ok:true, verified:true, phone:me.phone}, 200, {});
    // SMS réel non configuré : les clients passent directement au paiement ; Pierre (clé admin) reçoit le code en notification
    if(!this.smsReady() && !admin) return json({skip:true}, 200, {});
    const ph = this.normPhone(b.phone); if(!ph) return json({error:"bad_phone"}, 400, {});
    if(this.limit("sms:" + me.id, 5, HOUR) || this.limit("smsip:" + ip, 10, HOUR)) return json({error:"rate_limited"}, 429, {});
    if(this.smsReady()){
      const j = await this.twilio("/Verifications", {To:ph, Channel:"sms", Locale:"fr"});
      // SMS impossible (compte Twilio d'essai, numéro non autorisé…) : on ne bloque jamais un client, il passe au paiement
      if(j.status !== "pending"){ return admin ? json({error:"sms_failed", detail:String(j.message || "").slice(0, 160), code:j.code || 0}, 502, {}) : json({skip:true, reason:"sms_failed"}, 200, {}); }
      this.sql.exec("UPDATE users SET phone = ?, phone_code = NULL WHERE id = ?", ph, me.id);
      return json({ok:true, sent:true, phone:ph, channel:"sms"}, 200, {});
    }
    // mode test (admin) : code à 6 chiffres envoyé dans les notifications ntfy de Pierre
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    this.sql.exec("UPDATE users SET phone = ?, phone_code = ?, phone_code_exp = ? WHERE id = ?", ph, await sha("pc:" + code), NOW() + 10*MIN, me.id);
    await this.alert("Code Traceo (SMS de test)", `Ton code de vérification Traceo : ${code}\n(numéro ${ph}, valable 10 minutes)`, {tags:"iphone", priority:"high"});
    return json({ok:true, sent:true, phone:ph, channel:"test"}, 200, {});
  }
  async phoneCheck(me, b){
    const code = String(b.code || "").replace(/\D/g, ""); if(code.length !== 6 || !me.phone) return json({error:"bad_code"}, 400, {});
    if(this.limit("smschk:" + me.id, 8, HOUR)) return json({error:"rate_limited"}, 429, {});
    let ok = false;
    if(me.phone_code){ ok = me.phone_code_exp > NOW() && me.phone_code === await sha("pc:" + code); }
    else if(this.smsReady()){ const j = await this.twilio("/VerificationCheck", {To:me.phone, Code:code}); ok = j.status === "approved"; }
    if(!ok) return json({error:"bad_code"}, 400, {});
    this.sql.exec("UPDATE users SET phone_ok = 1, phone_code = NULL WHERE id = ?", me.id);
    return json({ok:true, verified:true}, 200, {});
  }

  /* ---------- Paiement automatique par notification PayPal (IPN), sans compte développeur ----------
     1. PayPal envoie chaque paiement reçu à /paypal/ipn ; le serveur renvoie le message à PayPal qui confirme « VERIFIED ».
     2. Le client, de retour dans l'app, donne l'e-mail utilisé pour payer : si un paiement de 4,99 € avec cet e-mail est
        arrivé (et n'a jamais servi), Premium est activé tout de suite sur son téléphone (activation signée).
     3. Si le client fait sa demande avant que PayPal ne prévienne, l'activation part dès l'arrivée du paiement. */
  async ipn(raw){
    try{
      const r = await fetch(this.env.PAYPAL_IPN_URL || "https://ipnpb.paypal.com/cgi-bin/webscr", {method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded", "User-Agent":"Traceo-IPN"}, body:"cmd=_notify-validate&" + raw});
      if((await r.text()).trim() !== "VERIFIED") return new Response("ignored", {status:200});
      const f = new URLSearchParams(raw), txn = clean(f.get("txn_id"), 40), email = clean(f.get("payer_email"), 120).toLowerCase();
      const amount = f.get("mc_gross") || "", cur = f.get("mc_currency") || "", status = f.get("payment_status") || "";
      // seul un paiement fait vers TON compte PayPal (identifiant marchand) peut activer Premium
      const mid = this.env.PAYPAL_MERCHANT_ID || "";
      if(mid && f.get("receiver_id") !== mid && f.get("business") !== mid) return new Response("other receiver", {status:200});
      if(this.env.PAYPAL_EMAIL && clean(f.get("receiver_email"), 120).toLowerCase() !== this.env.PAYPAL_EMAIL.toLowerCase()) return new Response("other receiver", {status:200});
      if(!txn || status !== "Completed" || cur !== "EUR" || parseFloat(amount) < parseFloat(this.env.PRICE || "4.99") - .001) return new Response("not eligible", {status:200});
      if(this.one("SELECT 1 AS x FROM payments WHERE txn = ?", txn)) return new Response("dup", {status:200});
      const name = clean([f.get("first_name"), f.get("last_name")].filter(Boolean).join(" "), 80);
      this.sql.exec("INSERT INTO payments(txn, email, amount, currency, t, name) VALUES(?,?,?,?,?,?)", txn, email, amount, cur, NOW(), name);
      this.alert("Paiement PayPal reçu", `${amount} € reçus de ${name || email} (${email}). Activation automatique dès sa demande dans l'app.`, {tags:"moneybag", priority:"high"});
      // paiement lancé depuis l'app : le code du téléphone voyage avec le paiement (champ « custom ») → activation immédiate
      const [cdev0, cuid] = (f.get("custom") || "").split("."), cdev = (cdev0 || "").toLowerCase();
      if(/^[a-f0-9]{16}$/.test(cdev)){
        await this.grant(txn, cdev, 0);
        // reçu par SMS au numéro vérifié du client, avec le mot du fondateur
        const u = cuid && this.one("SELECT * FROM users WHERE id = ?", clean(cuid, 32)), pay = this.one("SELECT * FROM payments WHERE txn = ?", txn);
        if(u && pay) this.state.waitUntil(this.smsReceipt(u, pay));
        return new Response("ok", {status:200});
      }
      // demande déjà faite par le client ? on active tout de suite
      const req = this.one("SELECT * FROM act_requests WHERE (email = ? OR email = ?) AND done = 0 AND t > ? ORDER BY id DESC", email, name.toLowerCase(), NOW() - 7*864e5);
      if(req) await this.grant(txn, req.dev, req.id);
    }catch(e){}
    return new Response("ok", {status:200});
  }
  receipt(p){ return p ? {txn:p.txn, amount:p.amount, currency:p.currency || "EUR", date:p.t, until:p.until} : null; }
  async smsReceipt(u, p){
    if(!u.phone || !u.phone_ok || !this.env.TWILIO_ACCOUNT_SID || !this.env.TWILIO_AUTH_TOKEN) return;
    const fin = new Date(p.until).toLocaleDateString("fr-FR", {day:"numeric", month:"long", year:"numeric", timeZone:"Europe/Paris"});
    const body = `Traceo : paiement de ${String(p.amount).replace(".", ",")} € confirmé (réf. ${p.txn}). Premium actif jusqu'au ${fin}. Merci pour ta confiance et ta fidélité, bonne course ! Pierre Renard, fondateur de Traceo`;
    try{
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.env.TWILIO_ACCOUNT_SID}/Messages.json`, {method:"POST", headers:{Authorization:"Basic " + btoa(this.env.TWILIO_ACCOUNT_SID + ":" + this.env.TWILIO_AUTH_TOKEN), "Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({To:u.phone, From:this.env.TWILIO_SMS_FROM || "Traceo", Body:body}).toString()});
    }catch(e){}
  }
  async grant(txn, dev, reqId){
    const until = NOW() + 31*864e5, code = await this.signAct(dev, until, "paiement");
    this.sql.exec("UPDATE payments SET dev = ?, until = ? WHERE txn = ?", dev, until, txn);
    if(reqId) this.sql.exec("UPDATE act_requests SET done = 1 WHERE id = ?", reqId);
    await fetch("https://ntfy.sh/traceo-act-" + dev, {method:"POST", body:code}).catch(() => {});
    return code;
  }
  async activateRequest(b, ip){
    if(this.limit("act:" + ip, 12, HOUR)) return json({error:"rate_limited"}, 429, {});
    const email = clean(b.email, 120).toLowerCase(), dev = clean(b.dev, 16).toLowerCase();
    if(!/^[a-f0-9]{16}$/.test(dev)) return json({error:"bad_request"}, 400, {});
    if(!this.env.ACT_KEY) return json({status:"pending"}, 200, {});
    // paiement déjà reçu pour ce téléphone (bouton de paiement de l'app) : on renvoie l'activation
    const mine = this.one("SELECT * FROM payments WHERE dev = ? AND until > ? ORDER BY t DESC", dev, NOW());
    if(mine) return json({status:"active", code:await this.signAct(dev, mine.until, mine.txn.startsWith("TEST-") ? "test" : "paiement"), receipt:this.receipt(mine)}, 200, {});
    if(email.length < 3) return json({status:"pending"}, 200, {});
    // paiement déjà reçu avec cet e-mail (ou ce nom) et jamais utilisé : activation immédiate
    const pay = this.one("SELECT * FROM payments WHERE (email = ? OR lower(name) = ?) AND dev IS NULL AND t > ? ORDER BY t DESC", email, email, NOW() - 30*864e5);
    if(pay) return json({status:"active", code:await this.grant(pay.txn, dev, 0)}, 200, {});
    const again = this.one("SELECT * FROM payments WHERE (email = ? OR lower(name) = ?) AND dev = ? AND until > ?", email, email, dev, NOW());
    if(again) return json({status:"active", code:await this.signAct(dev, again.until, "paiement")}, 200, {});
    if(!this.one("SELECT 1 AS x FROM act_requests WHERE email = ? AND dev = ? AND done = 0", email, dev)) this.sql.exec("INSERT INTO act_requests(email, dev, t) VALUES(?,?,?)", email, dev, NOW());
    return json({status:"pending"}, 200, {});
  }

  /* ---------- Paiement PayPal automatique ----------
     L'app paie avec les boutons PayPal (commande de 4,99 € liée au code de l'appareil), puis envoie le numéro de commande.
     Le serveur demande la commande à PayPal avec la clé secrète : payée, bon montant, bon appareil, jamais utilisée.
     Si tout est bon, il signe l'activation de 31 jours (même clé que la page admin) : aucune intervention manuelle. */
  async pay(b, ip){
    if(this.limit("pay:" + ip, 20, HOUR)) return json({error:"rate_limited"}, 429, {});
    const order = clean(b.order, 40).toUpperCase(), dev = clean(b.dev, 16).toLowerCase();
    if(!/^[A-Z0-9]{8,40}$/.test(order) || !/^[a-f0-9]{16}$/.test(dev)) return json({error:"bad_request"}, 400, {});
    if(!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_SECRET || !this.env.ACT_KEY) return json({error:"pay_not_configured"}, 503, {});
    const used = this.one("SELECT * FROM orders WHERE id = ?", order);
    if(used && used.dev !== dev) return json({error:"order_used"}, 409, {});
    if(used) return json({code:await this.signAct(dev, used.until, "paiement")}, 200, {});   // même appareil : on renvoie l'activation
    let o;
    try{ o = await this.paypalGet(`/v2/checkout/orders/${encodeURIComponent(order)}`); }catch(e){ return json({error:"paypal_unreachable"}, 502, {}); }
    if(!o) return json({error:"order_not_found"}, 404, {});
    const pu = (o.purchase_units || [])[0] || {}, cap = ((pu.payments || {}).captures || [])[0] || {};
    const price = this.env.PRICE || "4.99";
    if(o.status !== "COMPLETED" || cap.status !== "COMPLETED") return json({error:"not_paid", status:o.status}, 402, {});
    if(pu.amount?.currency_code !== "EUR" || pu.amount?.value !== price) return json({error:"bad_amount"}, 402, {});
    if(pu.custom_id !== dev) return json({error:"other_device"}, 403, {});
    const from = Math.max(NOW(), Math.min(+b.from || 0, NOW() + 62*864e5)), until = from + 31*864e5;
    this.sql.exec("INSERT INTO orders(id, dev, t, amount, payer, until) VALUES(?,?,?,?,?,?)", order, dev, NOW(), price, clean(o.payer?.email_address, 120), until);
    this.alert("Nouvel abonné Premium (automatique)", `${price} € reçus de ${o.payer?.email_address || "?"} : Premium activé automatiquement (31 jours).`, {tags:"moneybag", priority:"high"});
    return json({code:await this.signAct(dev, until, "paiement")}, 200, {});
  }
  async signAct(dev, until, kind){
    const key = this._ak || (this._ak = await crypto.subtle.importKey("jwk", {...ACT_PUB, d:this.env.ACT_KEY, ext:true}, {name:"ECDSA", namedCurve:"P-256"}, false, ["sign"]));
    const payload = new TextEncoder().encode(`${dev}|${until}|${kind}|${b64u(crypto.getRandomValues(new Uint8Array(6)))}`);
    return b64u(payload) + "." + b64u(await crypto.subtle.sign({name:"ECDSA", hash:"SHA-256"}, key, payload));
  }
  async paypalGet(path){
    const base = this.env.PAYPAL_BASE || (this.env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com");
    if(!this._pt || this._pt.exp < NOW() + 60e3){
      const r = await fetch(base + "/v1/oauth2/token", {method:"POST", headers:{Authorization:"Basic " + btoa(`${this.env.PAYPAL_CLIENT_ID}:${this.env.PAYPAL_SECRET}`), "Content-Type":"application/x-www-form-urlencoded"}, body:"grant_type=client_credentials"});
      if(!r.ok) throw new Error("oauth"); const j = await r.json(); this._pt = {v:j.access_token, exp:NOW() + (j.expires_in || 300)*1000};
    }
    const r = await fetch(base + path, {headers:{Authorization:"Bearer " + this._pt.v}});
    if(r.status === 404) return null; if(!r.ok) throw new Error("paypal " + r.status);
    return r.json();
  }

  /* ---------- Administration (page admin.html) ---------- */
  // ---------- Audience (sans cookie, données agrégées) ----------
  // limiteur réservé aux statistiques : n'efface jamais les limites de sécurité (connexion, SMS, paiement)
  hitLimit(key, n, ms){ const now = NOW(), h = (this.hitLim.get(key) || []).filter(t => now - t < ms); if(h.length >= n){ this.hitLim.set(key, h); return true; } h.push(now); this.hitLim.set(key, h); if(this.hitLim.size > 50000) this.hitLim.clear(); return false; }
  async hit(b, req, ip){
    const none = new Response(null, {status:204});
    if(req.method !== "POST" || !b || typeof b !== "object" || JSON.stringify(b).length > 1500) return none;
    // seulement depuis les sites Traceo (un autre site ne peut pas gonfler les chiffres)
    const origin = req.headers.get("Origin") || "";
    const allowed = String(this.env.APP_ORIGIN || "").split(",").map(x => x.trim().replace(/\/$/, "")).filter(Boolean);
    if(origin && allowed.length && !allowed.includes(origin)) return none;
    const ua = req.headers.get("User-Agent") || "";
    if(!ua || ua.length > 400 || /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|curl|wget|python|node-fetch/i.test(ua)) return none;
    const ev = String(b.e || "pv").toLowerCase();
    if(!/^(pv|clic:[a-z0-9_-]{1,24})$/.test(ev)) return none;
    if(this.hitLimit("ip:" + ip, 300, HOUR)) return none;
    const day = new Date().toLocaleDateString("sv-SE", {timeZone:"Europe/Paris"});
    let salt = this.one("SELECT v FROM kv WHERE k = ?", "salt:" + day)?.v;
    if(!salt){
      salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      this.sql.exec("DELETE FROM kv WHERE k LIKE 'salt:%' OR k LIKE 'la:%'");
      this.sql.exec("INSERT OR REPLACE INTO kv(k, v) VALUES(?, ?)", "salt:" + day, salt);
      this.sql.exec("DELETE FROM hits WHERE day < ?", new Date(NOW() - 395*864e5).toLocaleDateString("sv-SE", {timeZone:"Europe/Paris"}));   // conservation : 13 mois maximum
    }
    // plafond quotidien (protection du stockage)
    if(this.hitDay.day !== day) this.hitDay = {day, n:this.one("SELECT COUNT(*) AS n FROM hits WHERE day = ?", day).n};
    if(this.hitDay.n >= 60000) return none;
    const vid = (await sha(salt + "|" + ip + "|" + ua)).slice(0, 16);
    if(this.hitLimit("v:" + vid, 150, HOUR)) return none;
    let path = clean(b.p, 120).split("?")[0].split("#")[0].replace(/^\/traceo(?=\/|$)/, "").replace(/\/index\.html$/, "/").replace(/\.html$/, "") || "/";
    if(!path.startsWith("/")) path = "/" + path;
    let ref = "";
    try{ const u = new URL(String(b.r || "").slice(0, 300)); if(/^https?:$/.test(u.protocol)) ref = clean(u.hostname, 60).replace(/^www\./, "").replace(/^(l|lm|m)\.(instagram|facebook)\.com$/, "$2.com"); }catch(e){}
    if(/(^|\.)traceorun\.pages\.dev$|(^|\.)traceo\.pages\.dev$|pierrernrd04-ai\.github\.io$/.test(ref)) ref = "";
    const src = clean(b.s, 40).toLowerCase().replace(/[^a-z0-9_.-]/g, "");
    const dev = /iPad|Tablet/i.test(ua) ? "tablette" : /Mobi|Android|iPhone/i.test(ua) ? "mobile" : "ordinateur";
    // heure arrondie : impossible de rapprocher une visite d'une inscription précise
    let region = ""; try{ region = clean(decodeURIComponent(req.headers.get("X-Region") || ""), 40); }catch(e){}
    const fresh = ev === "pv" && !this.one("SELECT 1 AS x FROM hits WHERE day = ? AND vid = ? AND ev = 'pv' LIMIT 1", day, vid);
    this.sql.exec("INSERT INTO hits(t, day, vid, ev, path, src, ref, country, dev, region) VALUES(?,?,?,?,?,?,?,?,?,?)", Math.floor(NOW()/HOUR)*HOUR, day, vid, ev, path, src, ref, clean(req.headers.get("X-Country"), 2), dev, region);
    this.hitDay.n++;
    if(fresh && (src || SOCIAL_REF.test(ref))) this.linkAlert(day, src, ref, dev, region, path);
    return none;
  }
  // alerte « nouveau visiteur arrivé par ton lien » : une par personne jusqu'à 20 par jour, puis des paliers groupés
  linkAlert(day, src, ref, dev, region, path){
    const n = (+this.one("SELECT v FROM kv WHERE k = ?", "la:" + day)?.v || 0) + 1;
    this.sql.exec("INSERT OR REPLACE INTO kv(k, v) VALUES(?, ?)", "la:" + day, String(n));
    const via = src ? (SRC_LABEL[src.replace(/[-_.].*$/, "")] || `ton lien « ${src} »`) : ref.replace(/\.com$/, "").replace(/^./, c => c.toUpperCase());
    let title, body;
    if(n <= 20){
      title = "Nouveau visiteur via ton lien";
      body = `Quelqu'un vient d'arriver via ${via} (${[dev, region].filter(Boolean).join(" · ")}, page ${path}).\n${n}${n > 1 ? "e" : "er"} visiteur venu de tes liens aujourd'hui.` + (n === 20 ? "\nLes prochaines alertes seront groupées (30, 50, 100…)." : "");
    } else if([30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 2000, 5000].includes(n)){
      title = "Tes liens cartonnent";
      body = `${n} visiteurs sont arrivés par tes liens aujourd'hui (dernier : ${via}).`;
    } else return;
    this.alert(title, body, {tags:"eyes", click:DASH_URL});
  }
  traffic(days){
    days = Math.max(1, Math.min(395, Math.round(days) || 30));
    const now = NOW(), [Y, M, D] = new Date(now).toLocaleDateString("sv-SE", {timeZone:"Europe/Paris"}).split("-").map(Number);
    const dayBack = i => new Date(Date.UTC(Y, M - 1, D - i)).toISOString().slice(0, 10);   // jours civils, sans décalage au changement d'heure
    const from = dayBack(days - 1), since = now - days*864e5;
    const per = this.rows("SELECT day, COUNT(DISTINCT vid) AS v, SUM(ev = 'pv') AS pv FROM hits WHERE day >= ? GROUP BY day", from);
    const map = Object.fromEntries(per.map(r => [r.day, r]));
    const daily = [];
    for(let i = days - 1; i >= 0; i--){ const d = dayBack(i); daily.push({day:d, visits:map[d]?.v || 0, views:map[d]?.pv || 0}); }
    const sum = (n, k) => daily.slice(-n).reduce((a, r) => a + r[k], 0);
    const visitsOf = where => this.one(`SELECT COUNT(DISTINCT day || vid) AS n FROM hits WHERE day >= ? AND ${where}`, from).n;
    return {
      days, from, daily,
      totals:{today:sum(1, "visits"), d7:sum(7, "visits"), range:sum(days, "visits"), views:sum(days, "views")},
      pages:this.rows("SELECT path, COUNT(*) AS views, COUNT(DISTINCT day || vid) AS visits FROM hits WHERE day >= ? AND ev = 'pv' GROUP BY path ORDER BY views DESC LIMIT 15", from),
      // chaque visite est attribuée à la source de sa première page vue (page d'arrivée)
      sources:this.rows("SELECT CASE WHEN h.src != '' THEN 'lien:' || h.src WHEN h.ref != '' THEN h.ref ELSE 'direct' END AS source, COUNT(*) AS visits FROM (SELECT MIN(id) AS fid FROM hits WHERE day >= ? AND ev = 'pv' GROUP BY day, vid) x JOIN hits h ON h.id = x.fid GROUP BY source ORDER BY visits DESC LIMIT 15", from),
      clicks:this.rows("SELECT substr(ev, 6) AS what, COUNT(*) AS n, COUNT(DISTINCT day || vid) AS visitors FROM hits WHERE day >= ? AND ev LIKE 'clic:%' GROUP BY ev ORDER BY n DESC", from),
      countries:this.rows("SELECT country, COUNT(DISTINCT day || vid) AS visits FROM hits WHERE day >= ? AND ev = 'pv' GROUP BY country ORDER BY visits DESC LIMIT 10", from),
      devices:this.rows("SELECT dev, COUNT(DISTINCT day || vid) AS visits FROM hits WHERE day >= ? AND ev = 'pv' GROUP BY dev ORDER BY visits DESC", from),
      funnel:{
        visits:sum(days, "visits"),
        tried:visitsOf("ev = 'clic:essayer'"),
        app:visitsOf("ev = 'pv' AND path = '/app'"),
        story:visitsOf("ev = 'pv' AND src LIKE 'story%'"),
        signups:this.one("SELECT COUNT(*) AS n FROM users WHERE created > ?", since).n,
        payments:this.one("SELECT COUNT(*) AS n FROM payments WHERE t > ? AND txn NOT LIKE 'TEST-%'", since).n
      }
    };
  }

  // Tableau de bord : période + période précédente, séries par jour, heures, sources et leur efficacité
  dashboard(days){
    days = Math.max(1, Math.min(180, Math.round(days) || 30));
    const now = NOW(), [Y, M, D] = new Date(now).toLocaleDateString("sv-SE", {timeZone:"Europe/Paris"}).split("-").map(Number);
    const dayBack = i => new Date(Date.UTC(Y, M - 1, D - i)).toISOString().slice(0, 10);
    const parisMs = d => { const [y, m, dd] = d.split("-").map(Number); const guess = Date.UTC(y, m - 1, dd); const off = new Date(guess).toLocaleString("en-US", {timeZone:"Europe/Paris", hour:"2-digit", hour12:false}); return guess - (+off % 24)*HOUR; };   // minuit à Paris
    const from = dayBack(days - 1), to = dayBack(0), pFrom = dayBack(2*days - 1), pTo = dayBack(days);
    const msFrom = parisMs(from), msPFrom = parisMs(pFrom);
    const one = (q, ...a) => this.one(q, ...a) || {};
    const period = (a, b, ma, mb) => ({
      visits:one("SELECT COUNT(DISTINCT day || vid) AS n FROM hits WHERE day BETWEEN ? AND ? AND ev = 'pv'", a, b).n || 0,
      views:one("SELECT COUNT(*) AS n FROM hits WHERE day BETWEEN ? AND ? AND ev = 'pv'", a, b).n || 0,
      tried:one("SELECT COUNT(DISTINCT day || vid) AS n FROM hits WHERE day BETWEEN ? AND ? AND ev = 'clic:essayer'", a, b).n || 0,
      app:one("SELECT COUNT(DISTINCT day || vid) AS n FROM hits WHERE day BETWEEN ? AND ? AND ev = 'pv' AND path = '/app'", a, b).n || 0,
      mobile:one("SELECT COUNT(DISTINCT day || vid) AS n FROM hits WHERE day BETWEEN ? AND ? AND ev = 'pv' AND dev = 'mobile'", a, b).n || 0,
      loops:one("SELECT COUNT(*) AS n FROM hits WHERE day BETWEEN ? AND ? AND ev = 'clic:boucle'", a, b).n || 0,
      runsStarted:one("SELECT COUNT(*) AS n FROM hits WHERE day BETWEEN ? AND ? AND ev = 'clic:course'", a, b).n || 0,
      payClicks:one("SELECT COUNT(DISTINCT day || vid) AS n FROM hits WHERE day BETWEEN ? AND ? AND ev = 'clic:payer'", a, b).n || 0,
      coach:one("SELECT COUNT(*) AS n FROM hits WHERE day BETWEEN ? AND ? AND ev = 'clic:coach'", a, b).n || 0,
      signups:one("SELECT COUNT(*) AS n FROM users WHERE created >= ? AND created < ?", ma, mb).n || 0,
      payments:one("SELECT COUNT(*) AS n FROM payments WHERE t >= ? AND t < ? AND txn NOT LIKE 'TEST-%'", ma, mb).n || 0,
      revenue:Math.round(100*(one("SELECT SUM(CAST(amount AS REAL)) AS s FROM payments WHERE t >= ? AND t < ? AND txn NOT LIKE 'TEST-%'", ma, mb).s || 0))/100,
      runs:one("SELECT COUNT(*) AS n FROM runs WHERE ok = 1 AND t >= ? AND t < ?", ma, mb).n || 0
    });
    const cur = period(from, to, msFrom, now + 1), prev = period(pFrom, pTo, msPFrom, msFrom);
    // séries par jour
    const byDay = (q, ...a) => Object.fromEntries(this.rows(q, ...a).map(r => [r.d, r.n]));
    const dv = byDay("SELECT day AS d, COUNT(DISTINCT vid) AS n FROM hits WHERE day >= ? AND ev = 'pv' GROUP BY day", from);
    const dl = byDay("SELECT day AS d, COUNT(*) AS n FROM hits WHERE day >= ? AND ev = 'clic:boucle' GROUP BY day", from);
    const dayKey = ms => new Date(ms).toLocaleDateString("sv-SE", {timeZone:"Europe/Paris"});
    const ds = {}, dp = {};
    for(const r of this.rows("SELECT created AS t FROM users WHERE created >= ?", msFrom)){ const k = dayKey(r.t); ds[k] = (ds[k] || 0) + 1; }
    for(const r of this.rows("SELECT t, amount FROM payments WHERE t >= ? AND txn NOT LIKE 'TEST-%'", msFrom)){ const k = dayKey(r.t); dp[k] = (dp[k] || 0) + (+r.amount || 0); }
    const daily = []; for(let i = days - 1; i >= 0; i--){ const d = dayBack(i); daily.push({day:d, visits:dv[d] || 0, signups:ds[d] || 0, revenue:Math.round(100*(dp[d] || 0))/100, loops:dl[d] || 0}); }
    // heures de visite (heure de Paris)
    const hours = Array(24).fill(0);
    for(const r of this.rows("SELECT t, COUNT(DISTINCT vid) AS n FROM hits WHERE day >= ? AND ev = 'pv' GROUP BY t", from)){ const h = +new Date(r.t).toLocaleString("en-US", {timeZone:"Europe/Paris", hour:"2-digit", hour12:false}) % 24; hours[h] += r.n; }
    // sources : page d'arrivée de chaque visite + ce que la visite a donné le même jour
    const sources = this.rows(`SELECT CASE WHEN h.src != '' THEN 'lien:' || h.src WHEN h.ref != '' THEN h.ref ELSE 'direct' END AS source, COUNT(*) AS visits,
        SUM(EXISTS(SELECT 1 FROM hits e WHERE e.day = h.day AND e.vid = h.vid AND e.ev = 'clic:essayer')) AS tried,
        SUM(EXISTS(SELECT 1 FROM hits e WHERE e.day = h.day AND e.vid = h.vid AND e.ev = 'clic:inscription')) AS signed
      FROM (SELECT MIN(id) AS fid FROM hits WHERE day >= ? AND ev = 'pv' GROUP BY day, vid) x JOIN hits h ON h.id = x.fid GROUP BY source ORDER BY visits DESC LIMIT 12`, from);
    const vis = (col, extra = "") => this.rows(`SELECT ${col} AS k, COUNT(DISTINCT day || vid) AS n FROM hits WHERE day >= ? AND ev = 'pv' ${extra} GROUP BY k ORDER BY n DESC LIMIT 10`, from);
    const hourNow = Math.floor(now/HOUR)*HOUR;
    return {
      days, from, to, cur, prev, daily, hours, sources,
      pages:this.rows("SELECT path AS k, COUNT(*) AS views, COUNT(DISTINCT day || vid) AS n FROM hits WHERE day >= ? AND ev = 'pv' GROUP BY path ORDER BY views DESC LIMIT 10", from),
      devices:vis("dev"), countries:vis("country"), regions:vis("region", "AND region != '' AND country = 'FR'"),
      live:{hour:one("SELECT COUNT(DISTINCT vid) AS n FROM hits WHERE t = ? AND ev = 'pv'", hourNow).n || 0, today:dv[to] || 0},
      members:{
        total:one("SELECT COUNT(*) AS n FROM users").n || 0,
        active7:one("SELECT COUNT(*) AS n FROM users WHERE seen > ?", now - 7*864e5).n || 0,
        premium:one("SELECT COUNT(*) AS n FROM users WHERE premium = 1").n || 0,
        revenueAll:Math.round(100*(one("SELECT SUM(CAST(amount AS REAL)) AS s FROM payments WHERE txn NOT LIKE 'TEST-%'").s || 0))/100
      }
    };
  }

  async admin(req, path, b, url, ip){
    const key = req.headers.get("X-Admin-Key") || "";
    if(!this.env.ADMIN_KEY) return json({error:"admin_not_configured"}, 503, {});
    if(this.limit("ad:" + ip, 60, 15*MIN)) return json({error:"rate_limited"}, 429, {});
    if(key.length !== this.env.ADMIN_KEY.length || await sha(key) !== await sha(this.env.ADMIN_KEY)){ this.limit("adbad:" + ip, 1, 1); return json({error:"auth"}, 401, {}); }
    const now = NOW();
    if(path === "stats"){
      return json({
        members:this.one("SELECT COUNT(*) AS n FROM users").n,
        new7:this.one("SELECT COUNT(*) AS n FROM users WHERE created > ?", now - 7*864e5).n,
        active24:this.one("SELECT COUNT(*) AS n FROM users WHERE seen > ?", now - 864e5).n,
        online:this.one("SELECT COUNT(*) AS n FROM users WHERE seen > ?", now - 10*MIN).n,
        premium:this.one("SELECT COUNT(*) AS n FROM users WHERE premium = 1").n,
        messages:this.one("SELECT COUNT(*) AS n FROM msgs").n,
        reports:this.one("SELECT COUNT(*) AS n FROM reports").n,
        runs:this.one("SELECT COUNT(*) AS n FROM runs WHERE ok = 1").n,
        rewards_due:this.one("SELECT COUNT(*) AS n FROM rewards WHERE status IN ('a_reclamer', 'demandee')").n
      }, 200, {});
    }
    if(path === "traffic") return json(this.traffic(+url.searchParams.get("days") || 30), 200, {});
    if(path === "dash") return json({...this.dashboard(+url.searchParams.get("days") || 30), seo:this.kvJson("seo:last"), domain:this.kvJson("seo:domain")}, 200, {});
    if(path === "members"){
      const rows = this.rows(`SELECT u.*, (SELECT COUNT(*) FROM msgs WHERE a = u.id) AS sent, (SELECT COUNT(*) FROM reports WHERE whom = u.id) AS reported, (SELECT COUNT(*) FROM runs WHERE uid = u.id AND ok = 1) AS runs, u.free_used AS free_used FROM users u ORDER BY created DESC LIMIT 5000`);
      return json({members:rows.map(u => ({id:u.id, pseudo:u.pseudo, first:u.first, last:u.last, email:u.email, birth:u.birth, level:u.level, pace:u.pace, created:u.created, last_login:u.last_login, seen:u.seen,
        place:u.place || "", visible:!!u.visible, premium:!!u.premium, push:!!u.push, sent:u.sent, reported:u.reported, runs:u.runs, free_used:u.free_used || 0, phone:u.phone || "", phone_ok:!!u.phone_ok}))}, 200, {});
    }
    if(path === "reports") return json({reports:this.rows("SELECT r.*, a.pseudo AS by_pseudo, b.pseudo AS whom_pseudo FROM reports r LEFT JOIN users a ON a.id = r.who LEFT JOIN users b ON b.id = r.whom ORDER BY t DESC LIMIT 500")}, 200, {});
    // Sauvegarde complète de la base (sans mots de passe ni jetons de session)
    if(path === "backup") return json({app:"traceo", date:new Date().toISOString(),
      users:this.rows("SELECT id, pseudo, first, last, email, birth, level, pace, bio, created, seen, last_login, place, visible, premium, notif FROM users"),
      messages:this.rows("SELECT * FROM msgs"), runs:this.rows("SELECT id, uid, t, day, dist, time, ascent, n_pts, ok, reason, premium FROM runs"),
      diamonds:this.rows("SELECT * FROM rewards"), reports:this.rows("SELECT * FROM reports"), blocks:this.rows("SELECT * FROM blocks")}, 200, {});
    if(path === "testpay"){
      const dev = clean(b.dev, 16).toLowerCase(); if(!/^[a-f0-9]{16}$/.test(dev)) return json({error:"bad_device"}, 400, {});
      const until = NOW() + 30*MIN, txn = "TEST-" + hex(crypto.getRandomValues(new Uint8Array(4)));
      this.sql.exec("INSERT INTO payments(txn, email, amount, currency, t, dev, until, name) VALUES(?,?,?,?,?,?,?,?)", txn, "simulation", "0.00", "EUR", NOW(), dev, until, "Paiement simulé (test)");
      return json({code:await this.signAct(dev, until, "test"), until, receipt:this.receipt(this.one("SELECT * FROM payments WHERE txn = ?", txn))}, 200, {});
    }
    if(path === "payments") return json({payments:this.rows("SELECT * FROM payments ORDER BY t DESC LIMIT 500"), pending:this.rows("SELECT * FROM act_requests WHERE done = 0 ORDER BY id DESC LIMIT 200")}, 200, {});
    if(path === "rewards") return json({rewards:this.rows(`SELECT r.*, u.pseudo, u.first, u.last, u.email, (SELECT COUNT(*) FROM runs WHERE uid = r.uid AND ok = 1) AS runs,
      (SELECT COUNT(*) FROM runs WHERE uid = r.uid AND ok = 0) AS refused FROM rewards r LEFT JOIN users u ON u.id = r.uid ORDER BY CASE r.status WHEN 'demandee' THEN 0 WHEN 'a_reclamer' THEN 1 ELSE 2 END, r.id DESC LIMIT 500`)}, 200, {});
    if(path === "runs") return json({runs:this.rows("SELECT id, t, dist, time, ascent, n_pts, ok, reason, premium FROM runs WHERE uid = ? ORDER BY id DESC LIMIT 300", clean(url.searchParams.get("uid"), 32))}, 200, {});
    if(path === "reward"){
      const st = ["versee", "refusee", "demandee", "a_reclamer"].includes(b.status) ? b.status : null; if(!st) return json({error:"bad_status"}, 400, {});
      this.sql.exec("UPDATE rewards SET status = ?, note = ?, done_at = ? WHERE id = ?", st, clean(b.note, 200), NOW(), +b.id);
      return json({ok:true}, 200, {});
    }
    if(path === "delete"){ const u = this.one("SELECT * FROM users WHERE id = ?", clean(b.id, 32)); if(!u) return json({error:"unknown_user"}, 404, {}); return this.remove(u); }
    // Alertes en notification native sur le téléphone du fondateur (bouton « Activer » du tableau de bord)
    if(path === "push-sub") return req.method === "POST" ? this.pushSub(b) : json({error:"method"}, 405, {});
    if(path === "push-unsub"){ this.sql.exec("DELETE FROM admin_push WHERE endpoint = ?", String(b.endpoint || "").slice(0, 1000)); return json({ok:true}, 200, {}); }
    // e-mail de bienvenue : état, essai vers une adresse, envoi aux membres existants (dry = liste seulement), envoi automatique à chaque inscription
    if(path === "welcome-auto"){ if(req.method === "POST") this.sql.exec("INSERT OR REPLACE INTO kv(k, v) VALUES('welcome:auto', ?)", b.on ? "1" : "0");
      return json({auto:this.one("SELECT v FROM kv WHERE k = 'welcome:auto'")?.v === "1", mail:!!(this.env.BREVO_API_KEY && this.env.MAIL_FROM), waiting:this.one("SELECT COUNT(*) AS n FROM users WHERE mail_off = 0 AND (welcomed IS NULL OR welcomed = 0)").n}, 200, {}); }
    if(path === "welcome-test"){ if(req.method !== "POST" || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(b.email || ""))) return json({error:"bad_email"}, 400, {});
      return json(await this.welcome({id:"test", first:clean(b.first, 30) || "Pierre", last:"", email:clean(b.email, 120)}, clean(b.email, 120)), 200, {}); }
    if(path === "welcome-all"){ if(req.method !== "POST") return json({error:"method"}, 405, {});
      const skip = Array.isArray(b.skip) ? b.skip.map(x => String(x).toLowerCase()) : [], list = this.rows("SELECT * FROM users WHERE mail_off = 0 AND (welcomed IS NULL OR welcomed = 0) ORDER BY created").filter(u => !skip.includes(u.pseudo));
      if(b.dry) return json({count:list.length, members:list.map(u => ({pseudo:u.pseudo, first:u.first, email:String(u.email).replace(/^(.{2})[^@]*/, "$1…")}))}, 200, {});
      let sent = 0; const fails = [];
      for(const u of list){ const r = await this.welcome(u); if(r.ok) sent++; else fails.push({pseudo:u.pseudo, error:r.error || r.status}); await new Promise(res => setTimeout(res, 250)); }
      return json({sent, fails}, 200, {}); }
    if(path === "avis") return json({avis:this.rows("SELECT * FROM feedback ORDER BY id DESC LIMIT 300")}, 200, {});
    if(path === "push-test") return req.method === "POST" ? json({ok:true, ...await this.alert("Notifications activées ✅", "Les alertes Traceo arriveront maintenant ici, même app fermée : inscriptions, visiteurs de tes liens, paiements, signalements.", {tags:"bell", click:DASH_URL})}, 200, {}) : json({error:"method"}, 405, {});
    if(path === "reset"){
      const u = this.one("SELECT * FROM users WHERE id = ?", clean(b.id, 32)); if(!u || !/^[a-f0-9]{64}$/.test(String(b.key || ""))) return json({error:"bad_request"}, 400, {});
      this.sql.exec("UPDATE users SET pw = ? WHERE id = ?", await this.hashPw(b.key), u.id); this.sql.exec("DELETE FROM sessions WHERE uid = ?", u.id);
      return json({ok:true}, 200, {});
    }
    return json({error:"not_found"}, 404, {});
  }

  /* ---------- Référencement automatique : état gardé pour la tâche planifiée de worker.js ---------- */
  kvJson(k){ try{ return JSON.parse(this.one("SELECT v FROM kv WHERE k = ?", k)?.v || "null"); }catch(e){ return null; } }
  async seoState(req){
    // GET : empreintes des pages + dernier passage ; POST {hashes?, last} : enregistre (appelé seulement par le worker)
    if(req.method === "POST"){ let b; try{ b = await req.json(); }catch(e){ return json({error:"bad_json"}, 400, {}); }
      for(const k of ["hashes", "last", "domain"]){ const v = b && b[k] && typeof b[k] === "object" ? JSON.stringify(b[k]) : ""; if(v && v.length < 200000) this.sql.exec("INSERT OR REPLACE INTO kv(k, v) VALUES(?, ?)", "seo:" + k, v); } }
    return json({hashes:this.kvJson("seo:hashes") || {}, last:this.kvJson("seo:last"), domain:this.kvJson("seo:domain")}, 200, {});
  }

  /* ---------- Notifications (Web Push, sans contenu : le téléphone vient lire le message) ---------- */
  async vapid(){
    if(this._v) return this._v;
    return this._vp || (this._vp = this.vapidLoad().finally(() => { this._vp = null; }));   // appels simultanés (envois en parallèle) : une seule création de clé
  }
  async vapidLoad(){
    let row = this.one("SELECT v FROM kv WHERE k = 'vapid'");
    if(!row){
      const kp = await crypto.subtle.generateKey({name:"ECDSA", namedCurve:"P-256"}, true, ["sign", "verify"]);
      const v = {priv:await crypto.subtle.exportKey("jwk", kp.privateKey), pub:b64u(await crypto.subtle.exportKey("raw", kp.publicKey))};
      this.sql.exec("INSERT INTO kv(k, v) VALUES('vapid', ?)", JSON.stringify(v)); row = {v:JSON.stringify(v)};
    }
    const v = JSON.parse(row.v);
    this._v = {pub:v.pub, key:await crypto.subtle.importKey("jwk", v.priv, {name:"ECDSA", namedCurve:"P-256"}, false, ["sign"])};
    return this._v;
  }
  async push(u, title, body){
    // le titre et le texte sont gardés pour la lecture par le téléphone (GET /social/inbox) ; la notification elle-même est vide
    if(!u.push || !u.notif) return;
    try{
      const s = await this.webPush(JSON.parse(u.push).endpoint);
      if(s === 404 || s === 410) this.sql.exec("UPDATE users SET push = NULL WHERE id = ?", u.id);
    }catch(e){}
  }
  // signal Web Push vide (VAPID : jeton ES256 signé ici, valable 12 h) ; renvoie le code HTTP du service de notification
  async webPush(endpoint){
    const v = await this.vapid(), aud = new URL(endpoint).origin;
    const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
    const unsigned = enc({typ:"JWT", alg:"ES256"}) + "." + enc({aud, exp:Math.floor(NOW()/1000) + 12*3600, sub:this.env.PUSH_SUBJECT || "https://pierrernrd04-ai.github.io/traceo/"});
    const sig = await crypto.subtle.sign({name:"ECDSA", hash:"SHA-256"}, v.key, new TextEncoder().encode(unsigned));
    return (await fetch(endpoint, {method:"POST", headers:{Authorization:`vapid t=${unsigned}.${b64u(sig)}, k=${v.pub}`, TTL:"21600", Urgency:"high", "Content-Length":"0"}})).status;
  }

  /* ---------- Alertes du fondateur : ntfy (comme avant) + historique + notification native sur ses téléphones ----------
     Le téléphone activé depuis le tableau de bord reçoit un signal vide, puis son service worker lit GET /social/alerts
     avec le jeton de lecture donné à l'activation (seule son empreinte est gardée ici). Aucune appli à installer. */
  /* ---------- E-mail de bienvenue : vidéo personnalisée (prénom incrusté par la page video.html), défi première boucle, avis ----------
     Envoi par Brevo (offre gratuite : 300 e-mails par jour) : secrets BREVO_API_KEY et MAIL_FROM (expéditeur validé chez Brevo),
     facultatifs MAIL_NAME et MAIL_REPLY. Une seule fois par membre, jamais après une désinscription (lien en un clic dans chaque e-mail). */
  async unsubTok(id){ return (await sha("desinscription|" + id + "|" + (this.env.ADMIN_KEY || this.env.ACT_KEY || "traceo"))).slice(0, 24); }
  async welcome(u, to){
    if(!this.env.BREVO_API_KEY || !this.env.MAIL_FROM) return {ok:false, error:"mail_not_configured"};
    if(!to && (u.mail_off || u.welcomed)) return {ok:false, error:"deja_envoye_ou_desinscrit"};
    const first = clean(u.first, 30) || "toi", n = encodeURIComponent(first);
    const urls = {video:`${SITE}/video?n=${n}&src=email`, app:`${SITE}/app?src=email`, avis:`${SITE}/avis?n=${n}&src=email`, thumb:`${SITE}/media/bienvenue-email.jpg`, logo:`${SITE}/icons/icon-192.png`,
      unsub:`${API_URL}/social/unsub?u=${encodeURIComponent(u.id)}&t=${await this.unsubTok(u.id)}`};
    const m = welcomeMail(first, urls);
    const r = await fetch(this.env.MAIL_API || "https://api.brevo.com/v3/smtp/email", {method:"POST", headers:{"api-key":this.env.BREVO_API_KEY, "Content-Type":"application/json", Accept:"application/json"},
      body:JSON.stringify({sender:{name:this.env.MAIL_NAME || "Pierre de Traceo", email:this.env.MAIL_FROM}, to:[{email:to || u.email, name:`${u.first || ""} ${u.last || ""}`.trim() || first}],
        replyTo:{email:this.env.MAIL_REPLY || this.env.MAIL_FROM}, subject:m.subject, htmlContent:m.html, textContent:m.text, tags:["bienvenue"],
        headers:{"List-Unsubscribe":`<${urls.unsub}>`, "List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}})}).catch(e => ({status:0, text:async () => String(e)}));
    const ok = r.status >= 200 && r.status < 300;
    if(ok && !to) this.sql.exec("UPDATE users SET welcomed = ? WHERE id = ?", NOW(), u.id);
    return {ok, status:r.status, error:ok ? "" : String(await r.text()).slice(0, 200)};
  }
  async unsub(url, req){
    const id = clean(url.searchParams.get("u"), 40), t = clean(url.searchParams.get("t"), 40), ok = !!id && t === await this.unsubTok(id);
    if(ok) this.sql.exec("UPDATE users SET mail_off = 1 WHERE id = ?", id);
    const msg = ok ? "C'est noté : tu ne recevras plus d'e-mails de Traceo. Ton compte et tes boucles restent là, bien sûr." : "Ce lien de désinscription n'est pas valide.";
    return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Traceo</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#04080B;color:#E6F2F0;font:600 17px/1.5 system-ui,sans-serif;text-align:center;padding:24px"><div><p>${msg}</p><p><a style="color:#2BE39B" href="${SITE}/app">Revenir sur Traceo</a></p></div></body></html>`, {status:ok ? 200 : 400, headers:{"Content-Type":"text/html; charset=utf-8"}});
  }
  feedback(b, ip){
    if(this.limit("avis:" + ip, 6, HOUR)) return json({error:"rate_limited"}, 429, {});
    const stars = Math.round(+b.stars), text = clean(b.text, 1500), name = clean(b.n, 24), src = clean(b.src, 20).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if(!(stars >= 1 && stars <= 5)) return json({error:"bad_stars"}, 400, {});
    this.sql.exec("INSERT INTO feedback(t, stars, text, name, src) VALUES(?,?,?,?,?)", NOW(), stars, text, name, src);
    this.alert(`Nouvel avis ${stars}/5`, `${"⭐".repeat(stars)} ${name || "Un coureur"}${src ? " (via " + src + ")" : ""} : ${text || "pas de commentaire"}`, {tags:"star", priority:stars <= 2 ? "high" : "default", click:DASH_URL});
    return json({ok:true}, 200, {});
  }
  // événements vus dans l'app (le téléphone du visiteur prévient le serveur) : liste fermée, aucun texte libre, plafonds par IP et par jour
  evtAlert(b, ip){
    const E = {paiement_clic:["Quelqu'un ouvre le paiement PayPal", "eyes", "default", 40], course_terminee:["Une course terminée avec Traceo", "runner", "low", 60], ensemble_depart:["Un coureur lance « Je pars courir »", "loudspeaker", "low", 30]};
    const name = String(b && b.e || ""), e = E[name];
    if(!e) return json({error:"bad_event"}, 400, {});
    const day = new Date().toLocaleDateString("sv-SE", {timeZone:"Europe/Paris"}), k = "evt:" + day + ":" + name;
    if(this.limit("evt:" + ip + ":" + name, 3, 24*HOUR)) return json({ok:false}, 200, {});
    const n = (+this.one("SELECT v FROM kv WHERE k = ?", k)?.v || 0) + 1;
    if(n > e[3]) return json({ok:false}, 200, {});
    this.sql.exec("DELETE FROM kv WHERE k LIKE 'evt:%' AND k NOT LIKE ?", "evt:" + day + ":%");
    this.sql.exec("INSERT OR REPLACE INTO kv(k, v) VALUES(?, ?)", k, String(n));
    const km = +(b.km || 0), via = {fin_beta:"fin de l'essai gratuit", onglet_premium:"onglet Premium", bouton_paypal:"bouton PayPal", premium_auto:"parcours Premium"}[String(b.depuis || "")];
    const extra = name === "course_terminee" && km > 0 && km < 200 ? ` (${String(Math.round(km*10)/10).replace(".", ",")} km)` : name === "paiement_clic" && via ? ` (depuis : ${via})` : name === "ensemble_depart" && +b.n > 0 ? ` (${Math.min(999, Math.round(+b.n))} coureurs prévenus)` : "";
    this.alert(e[0], e[0] + extra + ".", {tags:e[1], priority:e[2], click:DASH_URL});
    return json({ok:true}, 200, {});
  }
  alert(title, body, o = {}){
    const h = {Title:String(title).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim()};   // en-têtes HTTP : ASCII seulement
    if(o.tags) h.Tags = o.tags; if(o.priority) h.Priority = o.priority; if(o.click) h.Click = o.click; if(o.actions) h.Actions = o.actions;
    const ntfy = this.env.ALERTS_TOPIC ? fetch("https://ntfy.sh/" + this.env.ALERTS_TOPIC, {method:"POST", headers:h, body}).then(r => r.ok || "HTTP " + r.status, e => "erreur " + (e && e.message || e)) : Promise.resolve(false);
    const id = this.one("INSERT INTO alerts(t, title, body, url) VALUES(?,?,?,?) RETURNING id", NOW(), clean(title, 120), String(body ?? "").slice(0, 1000), o.click || DASH_URL).id;
    this.sql.exec("DELETE FROM alerts WHERE id <= ?", id - 300);
    const p = Promise.all([ntfy, this.adminPushAll()]).then(([n, s]) => ({id, ntfy:n, ...s}));
    this.state.waitUntil(p);
    return p;
  }
  async adminPushAll(){
    let sent = 0, gone = 0;
    await Promise.all(this.rows("SELECT id, endpoint FROM admin_push").filter(s => this.pushOk(s.endpoint)).map(async s => {
      try{ const st = await this.webPush(s.endpoint); if(st === 404 || st === 410){ this.sql.exec("DELETE FROM admin_push WHERE id = ?", s.id); gone++; } else if(st < 300) sent++; }catch(e){}
    }));
    return {sent, gone};
  }
  // seuls les vrais services de notification des navigateurs sont acceptés (jamais une adresse quelconque : pas de requête forgée vers l'intérieur)
  pushOk(ep){
    try{
      const u = new URL(ep);
      if(this.env.PUSH_TEST_HOST && u.host === this.env.PUSH_TEST_HOST && /^https?:$/.test(u.protocol)) return true;   // essais locaux seulement (jamais dans wrangler.toml)
      return u.protocol === "https:" && !u.port && !u.username && !u.password && /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)+push\.services\.mozilla\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)$/.test(u.hostname);
    }catch(e){ return false; }
  }
  async pushSub(b){
    const s = b.sub || {}, ep = String(s.endpoint || ""), k = s.keys || {};
    if(ep.length > 1000 || !this.pushOk(ep) || !/^[\w-]{40,200}=*$/.test(k.p256dh || "") || !/^[\w-]{10,80}=*$/.test(k.auth || "")) return json({error:"bad_subscription"}, 400, {});
    if(this.one("SELECT COUNT(*) AS n FROM admin_push").n >= 20 && !this.one("SELECT 1 AS x FROM admin_push WHERE endpoint = ?", ep)) return json({error:"too_many_devices"}, 409, {});
    const tok = hex(crypto.getRandomValues(new Uint8Array(24)));
    this.sql.exec("INSERT INTO admin_push(endpoint, sub, tok, created, label) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET sub = excluded.sub, tok = excluded.tok, created = excluded.created, label = excluded.label",
      ep, JSON.stringify({endpoint:ep, keys:{p256dh:k.p256dh, auth:k.auth}}), await sha(tok), NOW(), clean(b.label, 60));
    return json({tok, last:this.one("SELECT MAX(id) AS m FROM alerts").m || 0, devices:this.one("SELECT COUNT(*) AS n FROM admin_push").n}, 200, {});
  }
  // lecture par le service worker du téléphone : alertes plus récentes que ?since (10 au plus, la plus récente en dernier)
  async alertsFeed(req, url, ip){
    if(this.limit("al:" + ip, 120, 15*MIN)) return json({error:"rate_limited"}, 429, {});
    const t = this.tok(req), dev = t && this.one("SELECT id FROM admin_push WHERE tok = ?", await sha(t));
    if(!dev) return json({error:"auth"}, 401, {});
    const since = Math.max(0, Math.floor(+url.searchParams.get("since") || 0)), cols = "id, t, title, body, url";
    return json({alerts:this.rows(`SELECT ${cols} FROM alerts WHERE id > ? ORDER BY id DESC LIMIT 10`, since).reverse(), n:this.one("SELECT COUNT(*) AS n FROM alerts WHERE id > ?", since).n,
      last:this.one(`SELECT ${cols} FROM alerts ORDER BY id DESC LIMIT 1`)}, 200, {});
  }
}
