// Traceo « Ensemble » : comptes coureurs, coureurs autour de soi, invitations à courir, messages et notifications.
// Tout est gardé dans un Durable Object (base SQLite, offre gratuite de Cloudflare), sans autre service.
//
// Vie privée : la position est arrondie à ~300 m avant d'être enregistrée, n'est montrée qu'en distance arrondie,
// disparaît après 3 h sans activité, et seulement si la personne a choisi d'être visible. Compte supprimable à tout moment.
//
// Comptes : prénom, e-mail, mot de passe et case « 15 ans ou plus » suffisent ; l'identifiant (pseudo) unique est créé à partir du prénom s'il n'est pas choisi.
// Nom, date de naissance et niveau sont facultatifs (anciens comptes : nom et date de naissance déjà remplis ; l'âge minimum reste vérifié si une date est donnée).
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
const PSEUDO_RE = /^[a-z0-9][a-z0-9_.]{2,19}$/;   // identifiant : choisi (anciens comptes) ou créé à partir du prénom
const ACT_PUB = {"kty":"EC","crv":"P-256","x":"__6AWyNjAcpIy9E2jeaF-pVNzipouEcuYhBleromdtE","y":"WR7Y2cF2dCOReGhUEk7DEFkf2Bmh5rNc0NveDAggRzQ"};   // clé publique d'activation (la clé privée = secret ACT_KEY)
const FREE_LOOPS = 3;   // courses offertes à chaque nouveau compte (version gratuite) : décomptées au départ de la course (« Commencer »), jamais en traçant une boucle
const GUEST_RUNS = 1;   // course sans compte : 1 par appareil (code de l'appareil), ensuite compte gratuit
const GEN_DAY = 12, GEN_DAY_PREMIUM = 100;   // anti-abus : boucles tracées par jour et par compte (ou par appareil sans compte) ; tracer reste gratuit
const GUEST_IP_GENS = 120, GUEST_IP_RUNS = 30;   // plafonds larges par adresse IP sans compte (Wi-Fi partagé, réseaux mobiles qui partagent une adresse)
// Pass Premium payé par PayPal : 9,99 € ou plus = 3 mois (92 jours), 4,99 € ou plus = 31 jours (prix réglables : variables PRICE et PRICE_3M)
const PLAN_1M = {days:31, label:"31 jours"}, PLAN_3M = {days:92, label:"3 mois"};
// Offre de lancement « 3 mois à 9,99 € » : rappelée dans les e-mails seulement si l'interrupteur kv offer3m est à « 1 » (tableau de bord), et jamais après cette date
const OFFER_3M_END = Date.parse("2026-10-18T23:59:59+02:00");
// Parrainage : code personnel de 6 caractères (sans 0, O, 1, I, L), 7 jours de Premium pour le parrain ET le filleul à la 1re course du filleul
const REF_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", REF_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const REF_DAYS = 7, REF_MAX = 5, REF_IP_DAY = 3;   // jours offerts à chacun ; parrainages récompensés par parrain sur 30 jours glissants ; inscriptions parrainées par jour et par adresse IP pour un même parrain
const PAID = "txn NOT LIKE 'TEST-%' AND txn NOT LIKE 'REF-%'";   // vrais paiements : ni simulation (TEST-), ni jours offerts par parrainage (REF-, 0 €)
const PROOF_LOOPS = 50, PROOF_MEMBERS = 30;   // preuve sociale montrée seulement à partir de ces vrais chiffres (boucles tracées en 7 jours, membres)
// Relances e-mail automatiques : 30 envois par passage (l'offre gratuite autorise 50 sous-requêtes, alerte comprise), 200 par 24 h (Brevo gratuit : 300 par jour, bienvenue comprise), un e-mail tous les 2 jours au plus par membre
const LIFE_KINDS = ["j1", "mur", "fin3m", "prem_fin"], LIFE_RUN = 30, LIFE_DAY = 200, LIFE_GAP = 48*HOUR;
const LIFE_LABEL = {j1:"1re course pas lancée", mur:"courses offertes utilisées", fin3m:"fin de l'offre 3 mois", prem_fin:"fin du Premium"};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const parisDay = (t = Date.now()) => new Date(t).toLocaleDateString("sv-SE", {timeZone:"Europe/Paris"});
// e-mail ramené à sa boîte : même personne sous deux adresses (Gmail ignore les points ; « + » et ce qui suit, partout)
function mailKey(e){
  let [l, d] = String(e || "").trim().toLowerCase().split("@"); if(!d) return String(e || "").trim().toLowerCase();
  if(d === "googlemail.com") d = "gmail.com";
  l = l.split("+")[0]; if(d === "gmail.com") l = l.replace(/\./g, "");
  return l + "@" + d;
}
// prénom tel qu'inscrit dans la fiche du membre ; tout en minuscules ou en majuscules → « Jean-Marc »
function niceFirst(s){ const f = clean(s, 30); return f && (f === f.toLowerCase() || f === f.toUpperCase()) ? f.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : f; }
const frDate = ms => new Date(ms).toLocaleDateString("fr-FR", {day:"numeric", month:"long", year:"numeric", timeZone:"Europe/Paris"});   // « 13 novembre 2026 » (fin du pass, heure de Paris)
const REWARD_EVERY = 100, REWARD_EUR = 5;   // un diamant (bon d'achat de 5 €) toutes les 100 courses vérifiées
const DASH_URL = "https://traceorun.pages.dev/tableau";   // ouvert en touchant une alerte
const SITE = "https://traceorun.pages.dev", API_URL = "https://traceo-api.pierre-rnrd04.workers.dev";
const escH = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
// e-mail de bienvenue : même contenu en HTML (mise en page simple, compatible Gmail / Outlook / Apple Mail) et en texte brut
function welcomeMail(first, u){
  const f = escH(first), P = 'style="margin:0;padding:12px 28px 0;font-size:16px;line-height:1.6;color:#2A3B39;"';
  const btn = (href, label, bg, fg) => `<tr><td align="center" style="padding:20px 28px 4px;"><a href="${escH(href)}" style="display:inline-block;padding:15px 30px;border-radius:999px;background:${bg};color:${fg};font-weight:800;font-size:17px;text-decoration:none;">${label}</a></td></tr>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${f}, merci ! Ta première course t'attend</title></head>
<body style="margin:0;padding:0;background:#EEF3F2;"><div style="display:none;max-height:0;overflow:hidden;opacity:0">Une vidéo de 15 secondes rien que pour toi, et tes 3 courses offertes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF3F2;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#13201F;">
<tr><td style="padding:22px 28px 6px;font-weight:800;font-size:18px;color:#0B5F4A;"><img src="${escH(u.logo)}" width="26" height="26" alt="" style="vertical-align:middle;border-radius:7px;margin-right:8px;border:0;">Traceo</td></tr>
<tr><td style="padding:10px 20px 0;"><a href="${escH(u.video)}" style="display:block;text-decoration:none;"><img src="${escH(u.thumb)}" width="520" alt="▶ Ta vidéo, ${f} (15 s)" style="display:block;width:100%;max-width:520px;height:auto;border-radius:16px;border:0;"></a></td></tr>
<tr><td style="padding:22px 28px 0;font-size:24px;font-weight:800;line-height:1.25;">Salut ${f} 👋</td></tr>
<tr><td ${P}>Merci pour ton inscription sur Traceo ! Je suis Pierre Renard, coureur et fondateur de Traceo. Je t'ai préparé une vidéo de 15 secondes, rien que pour toi.</td></tr>
${btn(u.video, "▶ Voir ma vidéo", "#2BE39B", "#04110D")}
<tr><td style="padding:20px 28px 0;font-size:16px;line-height:1.6;color:#2A3B39;"><b>Ton défi : ta première course, aujourd'hui.</b> Tu choisis la distance, Traceo te trace en un clic une boucle toute neuve autour de toi, loin des grands axes, et te guide à la voix rue par rue. Tracer et comparer des boucles est gratuit, et tes <b>3 premières courses guidées sont offertes</b>, sans carte bancaire.</td></tr>
${btn(u.app, "Lancer ma 1re course →", "#071318", "#ffffff")}
<tr><td style="padding:22px 28px 0;font-size:16px;line-height:1.6;color:#2A3B39;">Et après ta course, dis-moi ce que tu en as pensé : <a href="${escH(u.avis)}" style="color:#0B8A66;font-weight:700;">30 secondes ici</a>, ou réponds simplement à cet e-mail. Je lis chaque retour. Dis-moi aussi si <b>Premium</b> te serait utile : boucles illimitées, envoi vers Garmin et Strava, export GPX, pour 4,99 €.</td></tr>
<tr><td style="padding:22px 28px 26px;font-size:16px;line-height:1.6;color:#2A3B39;">Bonne course,<br><b>Pierre Renard</b><br><span style="color:#6B7F7C;font-size:14px;">Fondateur de Traceo</span></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;"><tr><td style="padding:16px 28px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#7D8F8C;text-align:center;">Tu reçois cet e-mail parce que tu as créé un compte Traceo. <a href="${escH(u.unsub)}" style="color:#7D8F8C;">Ne plus recevoir ces e-mails</a>.<br>Traceo · Pierre Renard EI · traceorun.pages.dev</td></tr></table>
</td></tr></table></body></html>`;
  const text = `Salut ${first} !\n\nMerci pour ton inscription sur Traceo ! Je suis Pierre Renard, coureur et fondateur de Traceo. Je t'ai préparé une vidéo de 15 secondes, rien que pour toi :\n${u.video}\n\nTon défi : ta première course, aujourd'hui. Tu choisis la distance, Traceo te trace en un clic une boucle toute neuve autour de toi, loin des grands axes, et te guide à la voix rue par rue. Tracer et comparer des boucles est gratuit, et tes 3 premières courses guidées sont offertes, sans carte bancaire :\n${u.app}\n\nEt après ta course, dis-moi ce que tu en as pensé (30 secondes) : ${u.avis}\nou réponds simplement à cet e-mail. Dis-moi aussi si Premium te serait utile : boucles illimitées, Garmin, Strava, GPX, pour 4,99 €.\n\nBonne course,\nPierre Renard, fondateur de Traceo\n\n—\nTu reçois cet e-mail parce que tu as créé un compte Traceo. Ne plus recevoir ces e-mails : ${u.unsub}\nTraceo · Pierre Renard EI`;
  return {subject:`${first}, merci ! Ta première course t'attend 🏃`, html, text};
}
// relances automatiques (j1, mur, fin3m, prem_fin) : même mise en page que l'e-mail de bienvenue, courtes, signées par Pierre ; texte brut tiré du HTML
// u : {app, unsub, logo, link (lien de parrainage), offer (pass 3 mois rappelé), until (fin du pass), gift (jours offerts par parrainage), now}
function lifeMail(kind, first, u){
  const f = escH(first), now = u.now || Date.now();
  const end = new Date(OFFER_3M_END).toLocaleDateString("fr-FR", {weekday:"long", day:"numeric", month:"long", timeZone:"Europe/Paris"});   // « dimanche 18 octobre »
  const ref = u.link ? `<a href="${escH(u.link)}" style="color:#0B8A66;font-weight:700;">${escH(u.link.replace(/^https?:\/\//, ""))}</a>` : "";
  const invite = `<b>Invite un ami : 7 jours de Premium offerts pour vous deux</b>, dès sa première course (jusqu'à ${REF_MAX} amis par mois)${ref ? ". Ton lien perso : " + ref : "."}`;
  const offer = u.offer ? `<b>Offre de lancement : 3 mois pour 9,99 €</b>, jusqu'au ${end} inclus.` : "";
  const PREM = "courses guidées illimitées, envoi vers Garmin et Strava, export GPX et coach IA";
  let subject, pre, body, cta, after;
  if(kind === "j1"){
    subject = `${first}, tes 3 courses offertes t'attendent 🏃`; pre = "Une boucle neuve autour de toi en un clic, guidée à la voix rue par rue.";
    body = ["Tu as créé ton compte Traceo, et tes <b>3 courses guidées offertes</b> t'attendent toujours, sans carte bancaire. La prochaine est à un clic :",
      ["tu choisis la distance, ou le temps que tu as ;", "Traceo te trace une boucle toute neuve autour de toi, loin des grands axes ;", "tu touches « Commencer » et la voix te guide rue par rue."],
      "Tracer et comparer des boucles reste gratuit : une course offerte n'est utilisée que quand tu touches « Commencer »."];
    cta = [u.app, "Tracer ma boucle →"]; after = "Un souci pour démarrer, ou une question ? Réponds simplement à cet e-mail : je lis tout et je réponds moi-même.";
  } else if(kind === "mur"){
    subject = `${first}, tes 3 courses offertes sont faites 👏`; pre = "Merci d'avoir couru avec Traceo. Voici comment continuer.";
    body = ["Tu as utilisé tes 3 courses guidées offertes : merci d'avoir testé Traceo pour de vrai !", "Tracer et comparer des boucles reste gratuit. Pour continuer à courir guidé, tu as le choix :",
      [`<b>Premium : 4,99 € pour 31 jours</b>, sans abonnement : tu paies une fois, rien ne se renouvelle tout seul. Au programme : ${PREM}.`, offer, invite]];
    cta = [u.app, "Continuer avec Premium →"]; after = "Et dis-moi ce que tu as pensé de tes courses : réponds à cet e-mail, je lis chaque retour.";
  } else if(kind === "fin3m"){
    subject = `${first}, dernières heures pour 3 mois à 9,99 €`; pre = `L'offre de lancement de Traceo se termine ${end} à minuit.`;
    body = [`Petit mot rapide : l'offre de lancement de Traceo se termine <b>${end} à 23 h 59</b>.`,
      `Jusque-là, le pass <b>Premium 3 mois est à 9,99 €</b>, soit environ 3,33 € par mois, sans abonnement : tu paies une fois, rien ne se renouvelle. Au programme : ${PREM}.`,
      "Ensuite, Premium reste disponible à 4,99 € pour 31 jours."];
    cta = [u.app, "Prendre 3 mois à 9,99 € →"]; after = `Pas le bon moment ? Aucun souci : tracer des boucles reste gratuit${ref ? `, et ton lien perso ${ref} offre 7 jours de Premium à toi et à chaque ami qui lance sa première course` : ""}.`;
  } else {
    const left = (u.until || now) - now, d = Math.floor(left/864e5), quand = left >= 864e5 ? `dans ${d} jour${d > 1 ? "s" : ""}` : "dans moins de 24 h";
    const day = new Date(u.until || now).toLocaleDateString("fr-FR", {day:"numeric", month:"long", timeZone:"Europe/Paris"});
    subject = u.gift ? `${first}, tes jours Premium offerts se terminent le ${day}` : `${first}, ton Premium se termine le ${day}`; pre = "Rien ne sera prélevé : voici comment continuer, si tu le souhaites.";
    body = [`${u.gift ? "Tes jours de Premium offerts par le parrainage se terminent" : "Ton pass Premium Traceo se termine"} <b>le ${day}</b> (${quand}).`,
      "Pas d'abonnement, donc rien ne sera prélevé : sans action de ta part, tu repasses simplement à la version gratuite, et tracer des boucles reste gratuit.",
      `Pour garder tes ${PREM} :`,
      ["<b>4,99 € pour 31 jours</b>, ajoutés à la suite de tes jours restants : aucun jour perdu.", offer, invite]];
    cta = [u.app, "Prolonger mon Premium →"]; after = "Merci de courir avec Traceo ! Une idée pour améliorer l'app ? Réponds à cet e-mail, je lis tout.";
  }
  const P = (h, pad = "12px 28px 0") => `<tr><td style="padding:${pad};font-size:16px;line-height:1.6;color:#2A3B39;">${h}</td></tr>`;
  const LI = h => `<tr><td style="padding:8px 28px 0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="top" style="padding-right:10px;font-size:16px;line-height:1.6;color:#0B8A66;font-weight:800;">•</td><td style="font-size:16px;line-height:1.6;color:#2A3B39;">${h}</td></tr></table></td></tr>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(subject)}</title></head>
<body style="margin:0;padding:0;background:#EEF3F2;"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escH(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF3F2;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#13201F;">
<tr><td style="padding:22px 28px 6px;font-weight:800;font-size:18px;color:#0B5F4A;"><img src="${escH(u.logo)}" width="26" height="26" alt="" style="vertical-align:middle;border-radius:7px;margin-right:8px;border:0;">Traceo</td></tr>
<tr><td style="padding:16px 28px 0;font-size:24px;font-weight:800;line-height:1.25;">Salut ${f} 👋</td></tr>
${body.map(x => Array.isArray(x) ? x.filter(Boolean).map(LI).join("\n") : P(x)).join("\n")}
<tr><td align="center" style="padding:22px 28px 4px;"><a href="${escH(cta[0])}" style="display:inline-block;padding:15px 30px;border-radius:999px;background:#071318;color:#ffffff;font-weight:800;font-size:17px;text-decoration:none;">${cta[1]}</a></td></tr>
${P(after, "20px 28px 0")}
<tr><td style="padding:22px 28px 26px;font-size:16px;line-height:1.6;color:#2A3B39;">Bonne course,<br><b>Pierre</b>, fondateur de Traceo</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;"><tr><td style="padding:16px 28px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#7D8F8C;text-align:center;">Tu reçois cet e-mail parce que tu as un compte Traceo. <a href="${escH(u.unsub)}" style="color:#7D8F8C;">Ne plus recevoir ces e-mails</a>.<br>Traceo · Pierre Renard EI · traceorun.pages.dev</td></tr></table>
</td></tr></table></body></html>`;
  // texte brut : liens en adresse complète, balises retirées
  const plain = h => h.replace(/<a href="([^"]*)"[^>]*>[^<]*<\/a>/g, "$1").replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const text = [`Salut ${first} !`, ...body.map(x => Array.isArray(x) ? x.filter(Boolean).map(li => "• " + plain(li)).join("\n") : plain(x)), `${cta[1].replace(/\s*→$/, "")} : ${cta[0]}`, plain(after),
    "Bonne course,\nPierre, fondateur de Traceo", `—\nTu reçois cet e-mail parce que tu as un compte Traceo. Ne plus recevoir ces e-mails : ${u.unsub}\nTraceo · Pierre Renard EI`].join("\n\n");
  return {subject, html, text};
}
const SRC_LABEL = {story:"ta story Instagram", bio:"ta bio Instagram", ig:"Instagram", insta:"Instagram", instagram:"Instagram", linkedin:"LinkedIn", whatsapp:"WhatsApp", facebook:"Facebook", fb:"Facebook", tiktok:"TikTok", strava:"Strava", email:"ton e-mail", qr:"ton QR code", reddit:"Reddit", forum:"un forum running", club:"un club contacté", createur:"un créateur partenaire"};
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
    // Pass relié au compte du membre (Premium reconnu sur tous ses appareils) et durée du pass (31 ou 92 jours)
    try{ this.sql.exec("ALTER TABLE payments ADD COLUMN uid TEXT"); }catch(e){}
    try{ this.sql.exec("ALTER TABLE payments ADD COLUMN days INT"); }catch(e){}
    try{ this.sql.exec("ALTER TABLE act_requests ADD COLUMN uid TEXT"); }catch(e){}
    this.sql.exec(`CREATE INDEX IF NOT EXISTS payments_uid ON payments(uid, until)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS payments_dev ON payments(dev, until)`);
    // Courses offertes décomptées au départ (dernière boucle lancée : pas de double décompte), compteurs du jour (anti-abus), course sans compte (1 par appareil)
    try{ this.sql.exec("ALTER TABLE users ADD COLUMN last_start TEXT"); }catch(e){}
    this.sql.exec(`CREATE TABLE IF NOT EXISTS daycount(k TEXT PRIMARY KEY, day TEXT, n INT DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS guest_runs(dev TEXT PRIMARY KEY, t INT, loop TEXT)`);
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
    try{ this.sql.exec("ALTER TABLE feedback ADD COLUMN premium TEXT"); }catch(e){}
    // Parrainage : code personnel, parrain et état (attente → ok à la 1re course du filleul ; plafond, ip, alias : enregistré sans récompense ; parti : parrain supprimé),
    // e-mail ramené à sa boîte (mailKey), dernière course lancée avec le compte (« boucle|heure », pour les relances et les chiffres réels)
    for(const c of ["ref_code TEXT", "ref_by TEXT", "ref_state TEXT", "ref_at INT", "email_n TEXT", "run_last TEXT"]){ try{ this.sql.exec("ALTER TABLE users ADD COLUMN " + c); }catch(e){} }
    this.sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_ref ON users(ref_code)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS users_refby ON users(ref_by, ref_state)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS users_emailn ON users(email_n)`);
    for(const u of this.rows("SELECT id, email FROM users WHERE email_n IS NULL")) this.sql.exec("UPDATE users SET email_n = ? WHERE id = ?", mailKey(u.email), u.id);
    // chiffres réels par jour (boucles tracées, courses lancées) : preuve sociale publique, jamais arrondie
    this.sql.exec(`CREATE TABLE IF NOT EXISTS daystat(day TEXT, k TEXT, n INT DEFAULT 0, PRIMARY KEY(day, k))`);
    // relances e-mail : une ligne par envoi (ok = 1) ou essai manqué (ok = 0) ; key = fin du pass pour prem_fin (une fois par pass), vide sinon (une fois par membre)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS mail_log(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, kind TEXT, key TEXT, t INT, ok INT DEFAULT 0, info TEXT)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS mail_log_uid ON mail_log(uid, t)`);
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
    // relances e-mail : passage horaire lancé par worker.js (tâche planifiée), même circuit interne
    if(url.pathname === "/internal/lifecycle"){ if(req.headers.get("X-Traceo-Internal") !== "lifecycle" || req.method !== "POST") return json({error:"not_found"}, 404, {}); const a = await req.json().catch(() => ({})); return json(await this.lifeRun(this.clock(a.now), true), 200, {}); }
    if(path === "ipn") return this.ipn(await req.text());
    // désinscription : avant la lecture JSON, car le clic « Se désabonner » de Gmail ou Yahoo envoie un POST « List-Unsubscribe=One-Click » (RFC 8058)
    if(path === "unsub") return await this.unsub(url, req);
    let body = {}; if(req.method === "POST"){ const raw = await req.text(); if(raw.trim()){ try{ body = JSON.parse(raw); }catch(e){ return json({error:"bad_json"}, 400, {}); } } }
    try{
      if(path === "vapid") return json({key:(await this.vapid()).pub}, 200, {});
      if(path === "pay") return this.pay(body, ip);
      if(path === "activate") return await this.activateRequest(body, ip, req);
      if(path === "signup") return this.signup(body, ip, req);
      if(path === "login") return this.login(body, ip, req);
      if(path === "pseudo") return json({free:!this.one("SELECT 1 AS x FROM users WHERE pseudo = ?", clean(url.searchParams.get("p"), 20).toLowerCase())}, 200, {});
      if(path.startsWith("admin/")) return this.admin(req, path.slice(6), body, url, ip);
      if(path === "sms-status") return json({sms:this.smsReady()}, 200, {});
      if(path === "hit") return await this.hit(body, req, ip);
      if(path === "alerts") return await this.alertsFeed(req, url, ip);
      if(path === "evt") return this.evtAlert(body, ip);
      if(path === "avis") return req.method === "POST" ? this.feedback(body, ip) : json({error:"method"}, 405, {});
      if(path === "ref") return this.refInfo(url, ip);
      if(path === "proof") return this.proof();
      // courses offertes (start), boucles tracées (gen) et état (quota) : avec un compte (jeton) ou sans compte (code de l'appareil « dev »)
      if(path === "start" || path === "gen" || path === "quota"){
        const who = await this.auth(req);
        if(!who && this.tok(req)) return json({error:"auth"}, 401, {});   // session expirée : l'app se déconnecte, comme ailleurs
        if(who) this.sql.exec("UPDATE users SET seen = ? WHERE id = ?", NOW(), who.id);
        return path === "start" ? await this.start(who, body, ip) : await this.quota(who, body, path === "gen", ip);
      }
      const me = await this.auth(req);
      if(!me) return json({error:"auth"}, 401, {});
      this.sql.exec("UPDATE users SET seen = ? WHERE id = ?", NOW(), me.id);
      switch(path){
        case "me": return await this.update(me, body);
        case "delete": return this.remove(me);
        case "logout": this.sql.exec("DELETE FROM sessions WHERE tok = ?", await sha(this.tok(req))); return json({ok:true}, 200, {});
        case "pos": return this.pos(me, body);
        case "nearby": return this.nearby(me, +url.searchParams.get("r") || 10);
        case "send": return this.send(me, body);
        case "shout": return this.shout(me, body);
        case "inbox": return this.inbox(me, +url.searchParams.get("since") || 0);
        case "block": return this.block(me, body);
        case "run": return this.run(me, body);
        case "phone/start": return this.phoneStart(me, body, ip, await this.isAdmin(req));
        case "phone/check": return this.phoneCheck(me, body);
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
  // identifiant créé à partir du prénom (« Pierre-Élie » → pierreelie4821) : lettres a-z seulement (14 au plus) + 4 chiffres, nouvel essai si déjà pris
  newPseudo(first){
    const base = String(first || "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/ß/g, "ss").normalize("NFD").replace(/[^a-z]/g, "").slice(0, 14) || "coureur";
    const rnd = n => String(crypto.getRandomValues(new Uint32Array(1))[0] % (9*10**(n - 1)) + 10**(n - 1));
    for(let i = 0; i < 30; i++){ const p = base + rnd(i < 20 ? 4 : 6); if(PSEUDO_RE.test(p) && !this.one("SELECT 1 AS x FROM users WHERE pseudo = ?", p)) return p; }
    return "";
  }
  async signup(b, ip, req){
    // 30 par heure et par adresse IP : un club ou une salle sur le même Wi-Fi peut s'inscrire en même temps (le test de charge bloquait dès la 9e personne)
    if(this.limit("su:" + ip, 30, HOUR)) return json({error:"rate_limited"}, 429, {});
    const first = clean(b.first, 30), last = clean(b.last, 40), email = clean(b.email, 120).toLowerCase(), birth = clean(b.birth, 10);
    let pseudo = clean(b.pseudo, 20).toLowerCase();
    if(!first) return json({error:"name_required"}, 400, {});
    if(pseudo && !PSEUDO_RE.test(pseudo)) return json({error:"bad_pseudo"}, 400, {});
    if(!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return json({error:"bad_email"}, 400, {});
    if(!/^[a-f0-9]{64}$/.test(String(b.key || ""))) return json({error:"bad_password"}, 400, {});
    // date de naissance facultative (la case « J'ai 15 ans ou plus » l'atteste) ; si elle est donnée, mêmes contrôles qu'avant
    if(birth){
      const bd = Date.parse(birth + "T00:00:00Z");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(birth) || !isFinite(bd) || bd < Date.parse("1900-01-01")) return json({error:"bad_birth"}, 400, {});
      if((NOW() - bd)/(365.25*864e5) < 15) return json({error:"too_young"}, 400, {});
    }
    if(!b.terms) return json({error:"consent_required"}, 400, {});
    const pw = await this.hashPw(b.key), ipk = await this.ipKey(ip);   // avant les vérifications d'unicité : plus aucune attente entre elles et l'enregistrement
    if(pseudo && this.one("SELECT 1 AS x FROM users WHERE pseudo = ?", pseudo)) return json({error:"pseudo_taken"}, 409, {});
    if(this.one("SELECT 1 AS x FROM users WHERE email = ?", email)) return json({error:"email_taken"}, 409, {});
    if(!pseudo && !(pseudo = this.newPseudo(first))) return json({error:"pseudo_taken"}, 409, {});
    // parrainage (code « ref » gardé par le site ou l'app) : code d'un membre existant ; récompense possible seulement si la boîte e-mail est nouvelle
    // (pas celle du parrain ni d'un autre compte, points Gmail et « + » compris) et dans la limite de 3 inscriptions parrainées par jour et par adresse IP pour ce parrain
    const emailN = mailKey(email), rc = String((b.ref && typeof b.ref === "object" ? b.ref.c : b.ref) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const host = REF_RE.test(rc) ? this.one("SELECT id, first, email FROM users WHERE ref_code = ?", rc) : null;
    const refState = !host ? null : mailKey(host.email) === emailN || this.one("SELECT 1 AS x FROM users WHERE email_n = ?", emailN) ? "alias" : this.dayAdd("refip:" + ipk + ":" + host.id) > REF_IP_DAY ? "ip" : "attente";
    const id = hex(crypto.getRandomValues(new Uint8Array(8)));
    // news === false (case « Je préfère ne pas recevoir les conseils et offres de Traceo par e-mail ») : aucun e-mail de Traceo, comme après une désinscription
    this.sql.exec("INSERT INTO users(id, pseudo, pw, first, last, email, birth, level, pace, bio, created, seen, visible, premium, mail_off, ref_code, ref_by, ref_state, email_n) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, pseudo, pw, first, last, email, birth, LEVELS.includes(b.level) ? b.level : "regulier", Math.max(150, Math.min(900, +b.pace || 345)), clean(b.bio, 140), NOW(), NOW(), b.visible === false ? 0 : 1, b.premium ? 1 : 0,
      b.news === false ? 1 : 0, this.newRefCode(), host ? host.id : null, refState, emailN);
    const u = this.one("SELECT * FROM users WHERE id = ?", id), token = await this.newSession(u, req);
    {
      // chiffres agrégés du jour seulement : l'inscription n'est jamais reliée à une visite précise
      const day = new Date().toLocaleDateString("sv-SE", {timeZone:"Europe/Paris"});
      const vis = this.one("SELECT COUNT(DISTINCT vid) AS n, COUNT(DISTINCT CASE WHEN src != '' THEN vid END) AS l FROM hits WHERE day = ? AND ev = 'pv'", day);
      const su = this.one("SELECT COUNT(*) AS n FROM users WHERE created >= ?", NOW() - 864e5).n, tot = this.one("SELECT COUNT(*) AS n FROM users").n;
      const par = host ? `\nParrainé par ${niceFirst(host.first)}${refState === "attente" ? " : 7 jours offerts à chacun dès sa 1re course." : ` (sans récompense : ${refState === "ip" ? "trop d'inscriptions parrainées depuis cette connexion aujourd'hui" : "même boîte e-mail qu'un compte existant"}).`}` : "";
      this.alert("Nouvel inscrit Traceo", `${[first, last].filter(Boolean).join(" ")} (@${pseudo}) vient de créer son compte.\nAujourd'hui : ${vis.n} visiteur${vis.n > 1 ? "s" : ""} (dont ${vis.l} via tes liens) · ${su} inscription${su > 1 ? "s" : ""} en 24 h · ${tot} membres au total.${par}`, {tags:"tada", priority:"high", click:DASH_URL});
    }
    if(this.one("SELECT v FROM kv WHERE k = 'welcome:auto'")?.v === "1") this.state.waitUntil(this.welcome(u).catch(() => {}));
    return json({token, me:this.mine(u)}, 200, {});
  }
  async login(b, ip, req){
    const who = clean(b.login, 120).toLowerCase().replace(/^@/, "");
    if(this.limit("li:" + ip, 20, 15*MIN) || this.limit("lu:" + who, 8, 15*MIN)) return json({error:"rate_limited"}, 429, {});
    const u = this.one("SELECT * FROM users WHERE email = ? OR pseudo = ?", who, who);
    if(!u || !/^[a-f0-9]{64}$/.test(String(b.key || "")) || await this.hashPw(b.key, u.pw.split(":")[0]) !== u.pw) return json({error:"bad_login"}, 401, {});
    // pass payé relié au compte : Premium reconnu sur ce nouveau téléphone ou navigateur (activation signée pour le code d'appareil « dev » envoyé)
    const token = await this.newSession(u, req), prem = await this.accountPremium(u, b.dev);
    return json({token, me:this.mine(u), ...(prem ? {premium:prem} : {})}, 200, {});
  }
  // free_left : courses offertes restantes ; premium_until : fin du pass relié au compte, payé ou offert par parrainage (0 sans pass actif)
  // parrainage : ref_code (lien <site>/?ref=CODE), ref_count (filleuls récompensés), ref_pending (inscrits sans course lancée), ref_days (jours gagnés comme parrain), ref_max (par 30 jours)
  mine(u){ const p = this.accountPay(u.id), r = this.refStats(u.id); return {...this.pub(u), last:u.last, email:u.email, birth:u.birth, phone_ok:!!u.phone_ok, visible:!!u.visible, notif:!!u.notif, push:!!u.push, avail_until:u.avail_until || 0,
    free:FREE_LOOPS, free_left:Math.max(0, FREE_LOOPS - (u.free_used || 0)), premium_until:p ? p.until : 0,
    ref_code:this.refCode(u), ref_count:r.count, ref_pending:r.pending, ref_days:r.days, ref_max:REF_MAX}; }
  async update(me, b){
    const f = {};
    if(b.first != null) f.first = clean(b.first, 30) || me.first;
    if(b.last != null) f.last = clean(b.last, 40);   // nom facultatif : peut être ajouté ou retiré
    if(b.level != null && LEVELS.includes(b.level)) f.level = b.level;
    if(b.pace != null) f.pace = Math.max(150, Math.min(900, +b.pace || me.pace));
    if(b.bio != null) f.bio = clean(b.bio, 140);
    if(b.visible != null) f.visible = b.visible ? 1 : 0;
    if(b.notif != null) f.notif = b.notif ? 1 : 0;
    if(b.push !== undefined) f.push = b.push && typeof b.push === "object" && /^https:\/\//.test(b.push.endpoint || "") ? JSON.stringify({endpoint:String(b.push.endpoint).slice(0, 600)}) : null;
    if(b.avail === false) f.avail_until = 0;
    if(b.premium != null) f.premium = b.premium || this.accountPay(me.id) ? 1 : 0;   // pass relié au compte : reste Premium même si ce téléphone n'est pas encore activé
    if(b.place != null) f.place = clean(b.place, 60);
    if(b.key != null && /^[a-f0-9]{64}$/.test(String(b.key)) && /^[a-f0-9]{64}$/.test(String(b.oldKey || ""))){
      if(await this.hashPw(b.oldKey, me.pw.split(":")[0]) !== me.pw) return json({error:"bad_login"}, 401, {});
      f.pw = await this.hashPw(b.key);
    }
    const keys = Object.keys(f);
    if(keys.length) this.sql.exec(`UPDATE users SET ${keys.map(k => k + " = ?").join(", ")} WHERE id = ?`, ...keys.map(k => f[k]), me.id);
    // avec le code d'appareil (dev) : Premium du compte renvoyé pour CE téléphone (activation signée)
    const out = {}, dev = this.devOf(b);
    if(dev){ const pr = await this.premiumOf(me, b); if(pr.extra.code) out.premium = pr.extra; }
    return json({me:this.mine(this.one("SELECT * FROM users WHERE id = ?", me.id)), ...out}, 200, {});
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
      this.alert("Diamant gagné", `${[me.first, me.last].filter(Boolean).join(" ")} (@${me.pseudo}) a validé sa ${count}e course et gagne un diamant de ${REWARD_EUR} €.`, {tags:"gem"});
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

  /* ---------- Version gratuite : 1 course sans compte, puis 3 courses offertes par compte ----------
     Une course offerte est décomptée quand la course démarre (POST /social/start, bouton « Commencer »), jamais en traçant :
     tracer, « Une autre boucle » ou changer de distance restent gratuits (POST /social/gen), dans la limite anti-abus du jour.
     Premium (activation signée valide pour ce téléphone, ou pass payé relié au compte) : illimité. Tout est compté côté serveur,
     pour qu'effacer les données du téléphone ou réinstaller l'app ne redonne pas de courses gratuites.
     Ancienne app en cache : elle appelle encore « quota » avant de tracer et « gen » après ; mêmes champs qu'avant (premium, left, used, free). */
  async premiumOk(code, dev){
    try{
      const [p64, s64] = String(code || "").split("."); if(!p64 || !s64) return false;
      const dec = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
      const key = this._pk || (this._pk = await crypto.subtle.importKey("jwk", ACT_PUB, {name:"ECDSA", namedCurve:"P-256"}, false, ["verify"]));
      const raw = dec(p64); if(!await crypto.subtle.verify({name:"ECDSA", hash:"SHA-256"}, key, dec(s64), raw)) return false;
      const [cdev, until] = new TextDecoder().decode(raw).split("|");
      return +until > NOW() && (!dev || cdev === dev);   // code d'appareil donné : l'activation doit être celle de CE téléphone
    }catch(e){ return false; }
  }
  devOf(b){ const d = clean(b && b.dev, 16).toLowerCase(); return /^[a-f0-9]{16}$/.test(d) ? d : ""; }
  // pass payé encore actif relié au compte (le plus long), ou au téléphone / au compte
  accountPay(uid){ return uid ? this.one("SELECT * FROM payments WHERE uid = ? AND until > ? ORDER BY until DESC LIMIT 1", uid, NOW()) : null; }
  bestPay(dev, uid, paidOnly){ return this.one(`SELECT * FROM payments WHERE until > ? AND (dev = ? OR (? != '' AND uid = ?))${paidOnly ? " AND txn NOT LIKE 'REF-%'" : ""} ORDER BY until DESC LIMIT 1`, NOW(), dev, uid || "", uid || ""); }
  // paiement fait sur ce téléphone (sans compte, ou avant la connexion) : relié au compte du membre qui s'y connecte avec l'activation de ce téléphone
  linkPay(uid, dev){ this.sql.exec("UPDATE payments SET uid = ? WHERE dev = ? AND uid IS NULL AND until > ? AND txn NOT LIKE 'TEST-%'", uid, dev, NOW()); }
  // Premium du compte sur un autre appareil : fin du pass, reçu et activation signée pour le code d'appareil donné
  // (jours offerts par parrainage compris ; le reçu est celui du dernier vrai paiement en cours, aucun s'il n'y a que des jours offerts)
  async accountPremium(u, dev){
    const p = u && this.accountPay(u.id); if(!p) return null;
    dev = this.devOf({dev});
    const paid = p.txn.startsWith("REF-") ? this.one(`SELECT * FROM payments WHERE uid = ? AND until > ? AND ${PAID} ORDER BY until DESC LIMIT 1`, u.id, NOW()) : p;
    return {until:p.until, receipt:this.receipt(paid), ...(dev && this.env.ACT_KEY ? {code:await this.signAct(dev, p.until, "paiement")} : {})};
  }
  async premiumOf(me, b){
    const dev = this.devOf(b), sig = await this.premiumOk(b.code, dev);
    if(me && sig && dev) this.linkPay(me.id, dev);
    const acc = me ? await this.accountPremium(me, dev) : null, premium = sig || !!acc;
    if(premium && me && !me.premium) this.sql.exec("UPDATE users SET premium = 1 WHERE id = ?", me.id);
    return {premium, extra:acc || {}};
  }
  // compteurs du jour (heure de Paris), remis à zéro chaque jour
  dayGet(k){ const r = this.one("SELECT day, n FROM daycount WHERE k = ?", k); return r && r.day === parisDay() ? r.n : 0; }
  dayAdd(k){
    const day = parisDay();
    if(this._dcDay !== day){ this._dcDay = day; this.sql.exec("DELETE FROM daycount WHERE day != ?", day); this.sql.exec("DELETE FROM guest_runs WHERE t < ?", NOW() - 120*864e5); }
    return this.one("INSERT INTO daycount(k, day, n) VALUES(?, ?, 1) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN day = excluded.day THEN n + 1 ELSE 1 END, day = excluded.day RETURNING n", k, day).n;
  }
  async ipKey(ip){ return (await sha("ip|" + ip + "|" + (this.env.ADMIN_KEY || this.env.ACT_KEY || "traceo"))).slice(0, 16); }   // adresse IP jamais gardée en clair
  // état (quota) ou boucle tracée (gen, use = true) : ne décompte jamais de course offerte ; gen refusé (429 gen_limit) au-delà de la limite du jour
  async quota(me, b, use, ip){
    if(!me) return await this.guestQuota(b, use, ip);
    const pr = await this.premiumOf(me, b), k = "gen:u:" + me.id, max = pr.premium ? GEN_DAY_PREMIUM : GEN_DAY;
    let used = this.one("SELECT free_used FROM users WHERE id = ?", me.id)?.free_used || 0;
    let gens = this.dayGet(k);
    const res = () => ({premium:pr.premium, left:pr.premium ? 999 : Math.max(0, FREE_LOOPS - used), used, free:FREE_LOOPS, gens, genMax:max, genLeft:Math.max(0, max - gens), ...pr.extra});
    if(use){
      if(gens >= max) return json({...res(), error:"gen_limit"}, 429, {});
      // ancienne app encore en cache (elle n'envoie pas le code de l'appareil et n'appelle jamais « start ») : la boucle tracée décompte une course offerte, comme avant
      if(!pr.premium && !this.devOf(b)){
        if(used >= FREE_LOOPS) return json({...res(), error:"quota"}, 402, {});
        this.sql.exec("UPDATE users SET free_used = ? WHERE id = ?", ++used, me.id);
      }
      gens = this.dayAdd(k); this.statAdd("loops");
    }
    return json(res(), 200, {});
  }
  // sans compte : 1 course offerte par appareil, boucles tracées plafonnées par appareil et (largement) par adresse IP
  async guestQuota(b, use, ip){
    const dev = this.devOf(b); if(!dev) return json({error:"auth"}, 401, {});
    const prem = await this.premiumOk(b.code, dev), ipk = "gen:ip:" + await this.ipKey(ip), k = "gen:d:" + dev, max = prem ? GEN_DAY_PREMIUM : GEN_DAY;
    const ran = !!this.one("SELECT 1 AS x FROM guest_runs WHERE dev = ?", dev);
    let gens = this.dayGet(k);
    const res = () => ({guest:true, premium:prem, left:prem ? 999 : ran ? 0 : GUEST_RUNS, used:ran ? GUEST_RUNS : 0, free:GUEST_RUNS, gens, genMax:max, genLeft:Math.max(0, max - gens)});
    if(use){
      if(gens >= max || (!prem && this.dayGet(ipk) >= GUEST_IP_GENS)) return json({...res(), genLeft:0, error:"gen_limit"}, 429, {});
      gens = this.dayAdd(k); this.dayAdd(ipk); this.statAdd("loops");
    }
    return json(res(), 200, {});
  }
  // « Commencer » : décompte une course offerte (compte : 3 ; sans compte : 1 par appareil). Premium : illimité.
  // Même boucle relancée dans les 6 h (champ « loop », identifiant de la boucle) : rien n'est décompté une seconde fois.
  // Réponses : 200 {ok, premium, left, used, free} ; 402 {error:"quota"} (plus de course offerte : mur Premium) ; 403 {error:"account_required"} (sans compte)
  async start(me, b, ip){
    if(this.limit("st:" + ip, 120, HOUR)) return json({error:"rate_limited"}, 429, {});
    const loop = clean(b.loop, 64);
    if(!me) return await this.guestStart(b, loop, ip);
    const pr = await this.premiumOf(me, b);
    const u = this.one("SELECT free_used, last_start FROM users WHERE id = ?", me.id) || {}, used = u.free_used || 0;
    if(pr.premium){ const gift = this.started(me, loop); return json({ok:true, premium:true, left:999, used, free:FREE_LOOPS, ...pr.extra, ...(gift ? {gift} : {})}, 200, {}); }
    const res = n => ({ok:true, premium:false, left:Math.max(0, FREE_LOOPS - n), used:n, free:FREE_LOOPS});
    const [lastLoop, lastT] = String(u.last_start || "").split("|");
    if(loop && loop === lastLoop && NOW() - (+lastT || 0) < 6*HOUR) return json({...res(used), again:true}, 200, {});
    if(used >= FREE_LOOPS) return json({...res(used), ok:false, error:"quota"}, 402, {});
    this.sql.exec("UPDATE users SET free_used = ?, last_start = ? WHERE id = ?", used + 1, loop ? loop + "|" + NOW() : null, me.id);
    const gift = this.started(me, loop);
    return json({...res(used + 1), ...(gift ? {gift} : {})}, 200, {});
  }
  // course lancée avec un compte : chiffres réels (même boucle relancée dans les 6 h comptée une fois), heure de la dernière course (relances),
  // et récompense de parrainage à la toute première course du filleul ; renvoie {days, until} si le filleul vient de gagner ses jours offerts
  started(me, loop){
    const [l, t] = String(me.run_last || "").split("|");
    if(!(loop && l === loop && NOW() - (+t || 0) < 6*HOUR)){ this.statAdd("runs"); this.sql.exec("UPDATE users SET run_last = ? WHERE id = ?", loop + "|" + NOW(), me.id); }
    return this.refCredit(me.id);
  }
  async guestStart(b, loop, ip){
    const dev = this.devOf(b); if(!dev) return json({error:"auth"}, 401, {});
    if(await this.premiumOk(b.code, dev)) return json({ok:true, guest:true, premium:true, left:999, used:0, free:GUEST_RUNS}, 200, {});
    const ipk = "run:ip:" + await this.ipKey(ip), row = this.one("SELECT * FROM guest_runs WHERE dev = ?", dev);
    const res = x => ({guest:true, premium:false, left:0, used:GUEST_RUNS, free:GUEST_RUNS, ...x});
    if(row) return loop && row.loop === loop && NOW() - row.t < 6*HOUR ? json(res({ok:true, again:true}), 200, {}) : json(res({ok:false, error:"account_required"}), 403, {});
    if(this.dayGet(ipk) >= GUEST_IP_RUNS) return json(res({ok:false, error:"account_required"}), 403, {});
    this.sql.exec("INSERT OR IGNORE INTO guest_runs(dev, t, loop) VALUES(?,?,?)", dev, NOW(), loop || null); this.dayAdd(ipk); this.statAdd("runs");
    return json(res({ok:true}), 200, {});
  }

  /* ---------- Parrainage : « invite un ami, 7 jours de Premium offerts pour vous deux » ----------
     Chaque membre a un code de 6 caractères (créé à l'inscription, ou à la première lecture de son profil pour les anciens comptes) ; lien <site>/?ref=CODE.
     Le site et l'app gardent le code 30 jours et l'envoient à l'inscription (champ « ref »). La récompense tombe une seule fois, quand le filleul lance
     sa toute première course avec son compte (POST /social/start), jamais à l'inscription : 7 jours pour le parrain et 7 pour le filleul, ajoutés après
     la fin de leur Premium en cours. Au plus 5 parrainages récompensés par parrain sur 30 jours glissants (les suivants sont notés, sans jours offerts).
     Les jours offerts sont des lignes de pass « REF-<filleul>-a » (parrain) et « -b » (filleul) à 0 € : Premium du compte sur tous ses appareils,
     mais jamais comptées dans les paiements, le chiffre d'affaires, les pass payés ni les alertes de paiement. */
  newRefCode(){
    for(let i = 0; i < 40; i++){
      const c = [...crypto.getRandomValues(new Uint32Array(6))].map(x => REF_ABC[x % REF_ABC.length]).join("");
      if(!this.one("SELECT 1 AS x FROM users WHERE ref_code = ?", c)) return c;
    }
    return null;
  }
  refCode(u){
    if(u.ref_code) return u.ref_code;
    const c = this.newRefCode(); if(!c) return "";
    this.sql.exec("UPDATE users SET ref_code = ? WHERE id = ? AND ref_code IS NULL", c, u.id);
    return u.ref_code = this.one("SELECT ref_code FROM users WHERE id = ?", u.id)?.ref_code || "";
  }
  refStats(id){
    const c = this.one("SELECT SUM(ref_state = 'ok') AS ok, SUM(ref_state = 'attente') AS wait FROM users WHERE ref_by = ?", id) || {};
    return {count:c.ok || 0, pending:c.wait || 0, days:this.one("SELECT SUM(days) AS d FROM payments WHERE uid = ? AND txn LIKE 'REF-%-a'", id)?.d || 0};
  }
  // jours offerts à un compte, à la suite de son Premium en cours ; dev vide (jamais NULL) et e-mail « parrainage » : aucune demande d'activation par e-mail ne peut s'en servir
  refGrant(uid, txn){
    const cur = this.one("SELECT MAX(until) AS u FROM payments WHERE uid = ? AND until > ? AND txn NOT LIKE 'TEST-%'", uid, NOW())?.u || 0, until = Math.max(NOW(), cur) + REF_DAYS*864e5;
    this.sql.exec("INSERT OR IGNORE INTO payments(txn, email, amount, currency, t, dev, until, name, uid, days) VALUES(?,?,?,?,?,?,?,?,?,?)", txn, "parrainage", "0", "EUR", NOW(), "", until, "Parrainage", uid, REF_DAYS);
    return this.one("SELECT until FROM payments WHERE txn = ?", txn)?.until || until;
  }
  // 1re course du filleul : récompense (une seule fois), ou plafond du parrain atteint (noté sans jours offerts)
  refCredit(id){
    const u = this.one("SELECT id, first, ref_by, ref_state FROM users WHERE id = ?", id);
    if(!u || u.ref_state !== "attente") return null;
    const host = u.ref_by ? this.one("SELECT id, first, pseudo FROM users WHERE id = ?", u.ref_by) : null, now = NOW();
    if(!host){ this.sql.exec("UPDATE users SET ref_state = 'parti', ref_at = ? WHERE id = ?", now, id); return null; }
    const n = this.one("SELECT COUNT(*) AS n FROM users WHERE ref_by = ? AND ref_state = 'ok' AND ref_at > ?", host.id, now - 30*864e5).n;
    if(n >= REF_MAX){ this.sql.exec("UPDATE users SET ref_state = 'plafond', ref_at = ? WHERE id = ?", now, id); return null; }
    this.sql.exec("UPDATE users SET ref_state = 'ok', ref_at = ? WHERE id = ?", now, id);
    this.refGrant(host.id, `REF-${id}-a`); const until = this.refGrant(id, `REF-${id}-b`);
    const a = niceFirst(host.first) || "Un membre", b = niceFirst(u.first) || "un coureur";
    this.alert(`🎁 Parrainage : ${a} a fait venir ${b}`, `${b} vient de lancer sa première course grâce au lien de @${host.pseudo} : 7 jours de Premium offerts à chacun.\nParrainages récompensés de ${a} sur 30 jours : ${n + 1}/${REF_MAX}.`, {tags:"gift", click:DASH_URL});
    return {days:REF_DAYS, until};
  }
  // GET /social/ref?c=CODE : prénom du parrain (accueil « Pierre t'invite »), rien d'autre
  refInfo(url, ip){
    if(this.limit("refi:" + ip, 30, 15*MIN)) return json({ok:false, error:"rate_limited"}, 429, {});
    const c = clean(url.searchParams.get("c"), 12).toUpperCase(), u = REF_RE.test(c) ? this.one("SELECT first FROM users WHERE ref_code = ?", c) : null;
    return json(u ? {ok:true, first:niceFirst(u.first) || "Un coureur"} : {ok:false}, 200, {});
  }
  // chiffres réels du jour : « loops » (boucles tracées acceptées), « runs » (courses lancées, avec ou sans compte)
  statAdd(k){
    const day = parisDay();
    if(this._stDay !== day){ this._stDay = day; this.sql.exec("DELETE FROM daystat WHERE day < ?", parisDay(NOW() - 400*864e5)); }
    this.sql.exec("INSERT INTO daystat(day, k, n) VALUES(?, ?, 1) ON CONFLICT(day, k) DO UPDATE SET n = n + 1", day, k);
  }
  // GET /social/proof : vrais chiffres des 7 derniers jours (aujourd'hui compris), jamais arrondis ; show = assez de monde pour les montrer
  proof(){
    const now = NOW();
    if(!this._proof || now - this._proof.t > 10*MIN){
      const from = parisDay(now - 6*864e5), sum = k => this.one("SELECT SUM(n) AS n FROM daystat WHERE k = ? AND day >= ?", k, from)?.n || 0;
      const loops7 = sum("loops"), runs7 = sum("runs"), members = this.one("SELECT COUNT(*) AS n FROM users").n;
      this._proof = {t:now, v:{loops7, runs7, members, show:loops7 >= PROOF_LOOPS && members >= PROOF_MEMBERS}};
    }
    return new Response(JSON.stringify(this._proof.v), {status:200, headers:{"Content-Type":"application/json; charset=utf-8", "Cache-Control":"public, max-age=600"}});
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
    // numéro ajouté APRÈS le paiement (jamais obligatoire) : le reçu du pass en cours part par SMS
    const p = this.accountPay(me.id);
    if(p && !/^(TEST|REF)-/.test(p.txn)) this.state.waitUntil(this.smsReceipt({...me, phone_ok:1}, p));
    return json({ok:true, verified:true, receipt:!!p}, 200, {});
  }

  /* ---------- Paiement automatique par notification PayPal (IPN), sans compte développeur ----------
     1. PayPal envoie chaque paiement reçu à /paypal/ipn ; le serveur renvoie le message à PayPal qui confirme « VERIFIED ».
     2. Le client, de retour dans l'app, donne l'e-mail utilisé pour payer : si un paiement de 4,99 € avec cet e-mail est
        arrivé (et n'a jamais servi), Premium est activé tout de suite sur son téléphone (activation signée).
     3. Si le client fait sa demande avant que PayPal ne prévienne, l'activation part dès l'arrivée du paiement.
     Durée selon le montant reçu : 9,99 € ou plus = pass 3 mois (92 jours), 4,99 € ou plus = 31 jours (planOf), dans tous les chemins.
     Membre connecté (identifiant du compte dans « custom », ou jeton à la demande d'activation) : le paiement est relié à son compte,
     et Premium est reconnu sur ses autres téléphones et navigateurs dès qu'il s'y connecte. Sans compte : Premium sur ce téléphone seulement. */
  planOf(amount){
    const a = parseFloat(amount) || 0;
    return a >= parseFloat(this.env.PRICE_3M || "9.99") - .001 ? PLAN_3M : a >= parseFloat(this.env.PRICE || "4.99") - .001 ? PLAN_1M : null;
  }
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
      const name = clean([f.get("first_name"), f.get("last_name")].filter(Boolean).join(" "), 80), plan = this.planOf(amount) || PLAN_1M;
      // paiement lancé depuis l'app : le code du téléphone (et l'identifiant du compte si le membre est connecté) voyagent avec le paiement (champ « custom »)
      const [cdev0, cuid] = (f.get("custom") || "").split("."), cdev = (cdev0 || "").toLowerCase();
      const u = cuid ? this.one("SELECT * FROM users WHERE id = ?", clean(cuid, 32)) : null;
      this.sql.exec("INSERT INTO payments(txn, email, amount, currency, t, name, days, uid) VALUES(?,?,?,?,?,?,?,?)", txn, email, amount, cur, NOW(), name, plan.days, u ? u.id : null);
      let who = u;
      if(/^[a-f0-9]{16}$/.test(cdev)) await this.grant(txn, cdev, 0, u ? u.id : null);   // activation immédiate sur ce téléphone
      else{
        // demande déjà faite par le client ? on active tout de suite
        const req = this.one("SELECT * FROM act_requests WHERE (email = ? OR email = ?) AND done = 0 AND t > ? ORDER BY id DESC", email, name.toLowerCase(), NOW() - 7*864e5);
        if(req){ await this.grant(txn, req.dev, req.id, req.uid || (u && u.id)); if(!who && req.uid) who = this.one("SELECT * FROM users WHERE id = ?", req.uid); }
      }
      const pay = this.one("SELECT * FROM payments WHERE txn = ?", txn);
      this.alert("Paiement PayPal reçu", `${amount} € reçus de ${name || email} (${email}) : Premium ${plan.label}${who ? ` pour @${who.pseudo} (sur tous ses appareils)` : ""}. `
        + (pay && pay.until ? `Activé automatiquement, jusqu'au ${frDate(pay.until)}.` : "Activation automatique dès sa demande dans l'app."), {tags:"moneybag", priority:"high"});
      // reçu par SMS au numéro confirmé du client (ajouté après un paiement, jamais obligatoire), avec le mot du fondateur
      if(who && pay && pay.until) this.state.waitUntil(this.smsReceipt(who, pay));
    }catch(e){}
    return new Response("ok", {status:200});
  }
  // reçu : montant, date, fin du Premium et offre (« 31 jours » ou « 3 mois », « essai » pour un paiement simulé)
  receipt(p){
    if(!p || p.txn.startsWith("REF-")) return null;   // jours offerts par parrainage : pas un paiement, pas de reçu
    const plan = p.days ? (p.days >= PLAN_3M.days ? PLAN_3M : PLAN_1M) : this.planOf(p.amount), label = plan ? plan.label : "essai";
    return {txn:p.txn, amount:p.amount, currency:p.currency || "EUR", date:p.t, until:p.until, days:plan ? plan.days : 0, plan:label, label:"Traceo Premium · " + label};
  }
  // reçu par SMS (numéro confirmé) : offre et date de fin du pass ; TWILIO_API sert seulement aux essais locaux (jamais dans wrangler.toml)
  async smsReceipt(u, p){
    if(!u.phone || !u.phone_ok || !this.env.TWILIO_ACCOUNT_SID || !this.env.TWILIO_AUTH_TOKEN || /^(TEST|REF)-/.test(p.txn)) return;
    const body = `Traceo : paiement de ${String(p.amount).replace(".", ",")} € confirmé (réf. ${p.txn}). Premium ${this.receipt(p).plan} actif jusqu'au ${frDate(p.until)}. Merci pour ta confiance et ta fidélité, bonne course ! Pierre Renard, fondateur de Traceo`;
    try{
      await fetch(`${this.env.TWILIO_API || "https://api.twilio.com"}/2010-04-01/Accounts/${this.env.TWILIO_ACCOUNT_SID}/Messages.json`, {method:"POST", headers:{Authorization:"Basic " + btoa(this.env.TWILIO_ACCOUNT_SID + ":" + this.env.TWILIO_AUTH_TOKEN), "Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({To:u.phone, From:this.env.TWILIO_SMS_FROM || "Traceo", Body:body}).toString()});
    }catch(e){}
  }
  // active un paiement reçu sur ce téléphone (et le relie au compte du membre s'il est connu) : 31 ou 92 jours selon le montant.
  // Renouvellement avant la fin : on prolonge à partir de la fin du pass en cours (ce téléphone ou ce compte), aucun jour perdu.
  async grant(txn, dev, reqId, uid){
    const p = this.one("SELECT * FROM payments WHERE txn = ?", txn) || {}, plan = this.planOf(p.amount) || PLAN_1M;
    uid = uid || p.uid || null;
    const cur = this.one("SELECT MAX(until) AS u FROM payments WHERE txn != ? AND until > ? AND txn NOT LIKE 'TEST-%' AND (dev = ? OR (? != '' AND uid = ?))", txn, NOW(), dev, uid || "", uid || "")?.u || 0;
    const until = Math.max(NOW(), cur) + plan.days*864e5;
    this.sql.exec("UPDATE payments SET dev = ?, until = ?, days = ?, uid = ? WHERE txn = ?", dev, until, plan.days, uid, txn);   // avant toute attente : un paiement ne sert qu'une fois
    if(reqId) this.sql.exec("UPDATE act_requests SET done = 1 WHERE id = ?", reqId);
    const code = await this.signAct(dev, until, "paiement");
    await fetch("https://ntfy.sh/traceo-act-" + dev, {method:"POST", body:code}).catch(() => {});
    return code;
  }
  async activateRequest(b, ip, req){
    const email = clean(b.email, 120).toLowerCase(), dev = clean(b.dev, 16).toLowerCase();
    // recherche par e-mail : limite stricte (protège les paiements pas encore activés) ; par code d'appareil seul (attente au retour de PayPal, toutes les 3 s) : plus large
    if(email.length >= 3 ? this.limit("act:" + ip, 12, HOUR) : this.limit("actd:" + ip, 120, HOUR)) return json({error:"rate_limited"}, 429, {});
    if(!/^[a-f0-9]{16}$/.test(dev)) return json({error:"bad_request"}, 400, {});
    if(!this.env.ACT_KEY) return json({status:"pending"}, 200, {});
    const me = req ? await this.auth(req) : null;   // membre connecté (en-tête Authorization facultatif) : le paiement est relié à son compte
    // pass actif pour ce téléphone (bouton de paiement de l'app) ou pour le compte connecté (payé sur un autre appareil) : on renvoie l'activation
    // (un paiement fait sans compte n'est pas relié ici sur le seul code d'appareil, qui se montre au support : il l'est quand le membre présente l'activation de ce téléphone, voir premiumOf)
    const mine = this.bestPay(dev, me && me.id, true);
    if(mine) return json({status:"active", code:await this.signAct(dev, mine.until, mine.txn.startsWith("TEST-") ? "test" : "paiement"), receipt:this.receipt(mine)}, 200, {});
    if(email.length < 3) return json({status:"pending"}, 200, {});
    // paiement déjà reçu avec cet e-mail (ou ce nom) et jamais utilisé : activation immédiate
    const pay = this.one("SELECT * FROM payments WHERE (email = ? OR lower(name) = ?) AND dev IS NULL AND t > ? AND txn NOT LIKE 'REF-%' ORDER BY t DESC", email, email, NOW() - 30*864e5);
    if(pay){ const code = await this.grant(pay.txn, dev, 0, me && me.id); return json({status:"active", code, receipt:this.receipt(this.one("SELECT * FROM payments WHERE txn = ?", pay.txn))}, 200, {}); }
    const again = this.one("SELECT * FROM payments WHERE (email = ? OR lower(name) = ?) AND dev = ? AND until > ? AND txn NOT LIKE 'REF-%'", email, email, dev, NOW());
    if(again) return json({status:"active", code:await this.signAct(dev, again.until, "paiement"), receipt:this.receipt(again)}, 200, {});
    const open = this.one("SELECT id FROM act_requests WHERE email = ? AND dev = ? AND done = 0", email, dev);
    if(!open) this.sql.exec("INSERT INTO act_requests(email, dev, t, uid) VALUES(?,?,?,?)", email, dev, NOW(), me ? me.id : null);
    else if(me) this.sql.exec("UPDATE act_requests SET uid = ? WHERE id = ?", me.id, open.id);
    return json({status:"pending"}, 200, {});
  }

  /* ---------- Paiement PayPal automatique ----------
     L'app paie avec les boutons PayPal (commande de 4,99 € ou 9,99 € liée au code de l'appareil), puis envoie le numéro de commande.
     Le serveur demande la commande à PayPal avec la clé secrète : payée, bon montant, bon appareil, jamais utilisée.
     Si tout est bon, il signe l'activation de 31 jours (ou 92 jours pour le pass 3 mois, même clé que la page admin) : aucune intervention manuelle. */
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
    // deux offres : 4,99 € (31 jours) ou pass 3 mois à 9,99 € (92 jours)
    const value = pu.amount?.value, price = [this.env.PRICE || "4.99", this.env.PRICE_3M || "9.99"].includes(value) ? value : "";
    if(o.status !== "COMPLETED" || cap.status !== "COMPLETED") return json({error:"not_paid", status:o.status}, 402, {});
    if(pu.amount?.currency_code !== "EUR" || !price) return json({error:"bad_amount"}, 402, {});
    if(pu.custom_id !== dev) return json({error:"other_device"}, 403, {});
    const plan = this.planOf(price) || PLAN_1M, from = Math.max(NOW(), Math.min(+b.from || 0, NOW() + 2*PLAN_3M.days*864e5)), until = from + plan.days*864e5;
    this.sql.exec("INSERT INTO orders(id, dev, t, amount, payer, until) VALUES(?,?,?,?,?,?)", order, dev, NOW(), price, clean(o.payer?.email_address, 120), until);
    this.alert("Nouvel abonné Premium (automatique)", `${price} € reçus de ${o.payer?.email_address || "?"} : Premium activé automatiquement (${plan.label}).`, {tags:"moneybag", priority:"high"});
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
        payments:this.one(`SELECT COUNT(*) AS n FROM payments WHERE t > ? AND ${PAID}`, since).n
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
    const one = (q, ...a) => this.one(q, ...a) || {}, p3 = parseFloat(this.env.PRICE_3M || "9.99") - .001;
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
      payments:one(`SELECT COUNT(*) AS n FROM payments WHERE t >= ? AND t < ? AND ${PAID}`, ma, mb).n || 0,
      passes3m:one(`SELECT COUNT(*) AS n FROM payments WHERE t >= ? AND t < ? AND ${PAID} AND CAST(amount AS REAL) >= ?`, ma, mb, p3).n || 0,
      revenue:Math.round(100*(one(`SELECT SUM(CAST(amount AS REAL)) AS s FROM payments WHERE t >= ? AND t < ? AND ${PAID}`, ma, mb).s || 0))/100,
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
    for(const r of this.rows(`SELECT t, amount FROM payments WHERE t >= ? AND ${PAID}`, msFrom)){ const k = dayKey(r.t); dp[k] = (dp[k] || 0) + (+r.amount || 0); }
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
    // Parcours (entonnoir) par source : chaque visiteur du jour est attribué à la source de sa première page vue ce jour-là ;
    // une étape compte s'il a fait l'action le même jour (visiteurs uniques par jour, comme les autres chiffres). Paiements : tous canaux (jamais reliés à une visite).
    const STEPS = [["visites", "Visites"], ["essai", "Clic « essayer » (accueil ou lien ?go)"], ["depart", "Écran de départ"], ["boucle", "1re boucle tracée (sans compte)"], ["compte_vu", "Écran de compte"],
      ["compte_ok", "Compte créé ou connecté"], ["course", "Course lancée"], ["mur", "Mur Premium vu"], ["payer", "Clic paiement"], ["paiements", "Paiements reçus"]];
    const EV = {essai:"IN ('clic:essayer', 'clic:accueil_go')", depart:"= 'clic:ecran_depart'", boucle:"= 'clic:boucle_invite'", compte_vu:"= 'clic:ecran_compte'", compte_ok:"= 'clic:compte_ok'", course:"= 'clic:course'", mur:"= 'clic:mur_gratuit'", payer:"= 'clic:payer'"};
    const K = Object.keys(EV);
    const fRows = this.rows(`SELECT f.source AS source, COUNT(*) AS visites, ${K.map(k => `SUM(s.${k}) AS ${k}`).join(", ")}
      FROM (SELECT h.day, h.vid, CASE WHEN h.src != '' THEN 'lien:' || h.src WHEN h.ref != '' THEN h.ref ELSE 'direct' END AS source FROM (SELECT MIN(id) AS fid FROM hits WHERE day BETWEEN ? AND ? AND ev = 'pv' GROUP BY day, vid) x JOIN hits h ON h.id = x.fid) f
      JOIN (SELECT day, vid, ${K.map(k => `MAX(ev ${EV[k]}) AS ${k}`).join(", ")} FROM hits WHERE day BETWEEN ? AND ? GROUP BY day, vid) s ON s.day = f.day AND s.vid = f.vid
      GROUP BY f.source ORDER BY visites DESC`, from, to, from, to).map(r => Object.fromEntries(["source", "visites", ...K].map(k => [k, k === "source" ? r[k] : +r[k] || 0])));
    const add = (acc, r) => { for(const k of ["visites", ...K]) acc[k] = (acc[k] || 0) + r[k]; return acc; };
    const fTop = fRows.slice(0, 12), fRest = fRows.slice(12);
    if(fRest.length) fTop.push(fRest.reduce(add, {source:"autres"}));
    const parcours = {steps:STEPS.map(([k, label]) => ({k, label})), total:{...fRows.reduce(add, Object.fromEntries([["source", "toutes"], ...["visites", ...K].map(k => [k, 0])])), paiements:cur.payments}, sources:fTop, paiements:cur.payments, passes3m:cur.passes3m,
      note:"Visiteurs uniques comptés par jour (identifiant anonyme renouvelé chaque nuit) : une personne qui revient le lendemain compte deux fois, et ses étapes ne s'additionnent pas d'un jour à l'autre. Les paiements ne sont jamais reliés à une visite : ils sont donnés tous canaux confondus. Avec moins de 30 visites, un pourcentage change beaucoup pour une seule personne : à lire comme une tendance."};
    return {
      days, from, to, cur, prev, daily, hours, sources, parcours,
      pages:this.rows("SELECT path AS k, COUNT(*) AS views, COUNT(DISTINCT day || vid) AS n FROM hits WHERE day >= ? AND ev = 'pv' GROUP BY path ORDER BY views DESC LIMIT 10", from),
      devices:vis("dev"), countries:vis("country"), regions:vis("region", "AND region != '' AND country = 'FR'"),
      live:{hour:one("SELECT COUNT(DISTINCT vid) AS n FROM hits WHERE t = ? AND ev = 'pv'", hourNow).n || 0, today:dv[to] || 0},
      members:{
        total:one("SELECT COUNT(*) AS n FROM users").n || 0,
        active7:one("SELECT COUNT(*) AS n FROM users WHERE seen > ?", now - 7*864e5).n || 0,
        premium:one("SELECT COUNT(*) AS n FROM users WHERE premium = 1").n || 0,
        passes:one(`SELECT COUNT(DISTINCT COALESCE(uid, dev)) AS n FROM payments WHERE until > ? AND ${PAID}`, now).n || 0,   // pass payés en cours (compte ou téléphone), sans les jours offerts
        revenueAll:Math.round(100*(one(`SELECT SUM(CAST(amount AS REAL)) AS s FROM payments WHERE ${PAID}`).s || 0))/100
      },
      // parrainage (à part des paiements) : « Parrainages : N crédités, J jours offerts » ; étapes vues sur le site et l'app pendant la période
      parrainages:{...this.refDash(now), events:Object.fromEntries(["vu", "partage", "copie", "inscrit"].map(k => [k, one("SELECT COUNT(*) AS n FROM hits WHERE day BETWEEN ? AND ? AND ev = ?", from, to, "clic:parrain_" + k).n || 0]))},
      relances:this.lifeState(now, false)
    };
  }
  refDash(now){
    const c = this.one("SELECT SUM(ref_state = 'ok') AS ok, SUM(ref_state = 'attente') AS wait, SUM(ref_state = 'plafond') AS cap, SUM(ref_state IN ('ip', 'alias')) AS refused FROM users WHERE ref_by IS NOT NULL") || {};
    return {credited:c.ok || 0, pending:c.wait || 0, capped:c.cap || 0, refused:c.refused || 0,
      days:this.one("SELECT SUM(days) AS d FROM payments WHERE txn LIKE 'REF-%'")?.d || 0,   // jours offerts au total (parrains + filleuls)
      active:this.one("SELECT COUNT(DISTINCT uid) AS n FROM payments WHERE txn LIKE 'REF-%' AND until > ?", now).n || 0,   // comptes avec des jours offerts en cours
      top:this.rows("SELECT h.first AS first, COUNT(*) AS n FROM users u JOIN users h ON h.id = u.ref_by WHERE u.ref_state = 'ok' GROUP BY u.ref_by ORDER BY n DESC, MAX(u.ref_at) DESC LIMIT 5").map(r => ({first:niceFirst(r.first), n:r.n}))};
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
        place:u.place || "", visible:!!u.visible, premium:!!u.premium, push:!!u.push, sent:u.sent, reported:u.reported, runs:u.runs, free_used:u.free_used || 0, phone:u.phone || "", phone_ok:!!u.phone_ok,
        mail_off:!!u.mail_off, ref_code:u.ref_code || "", ref_by:u.ref_by || "", ref_state:u.ref_state || ""}))}, 200, {});
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
    if(path === "payments") return json({payments:this.rows("SELECT * FROM payments WHERE txn NOT LIKE 'REF-%' ORDER BY t DESC LIMIT 500"), pending:this.rows("SELECT * FROM act_requests WHERE done = 0 ORDER BY id DESC LIMIT 200"),
      refs:this.rows("SELECT p.txn, p.t, p.until, p.days, p.uid, u.pseudo, u.first FROM payments p LEFT JOIN users u ON u.id = p.uid WHERE p.txn LIKE 'REF-%' ORDER BY p.t DESC LIMIT 500")}, 200, {});
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
    // offre de lancement 3 mois rappelée dans les e-mails : interrupteur (le lien de paiement 3 mois de config.js reste la décision de Pierre)
    if(path === "offer3m"){ if(req.method === "POST") this.kvSet("offer3m", b.on ? "1" : "0");
      return json({on:this.kvGet("offer3m") === "1", end:OFFER_3M_END, active:this.offerOn(now)}, 200, {}); }
    // relances e-mail automatiques : interrupteur + état (GET), essai d'une relance vers une adresse, aperçu de qui recevrait quoi maintenant (rien n'est envoyé)
    if(path === "lifecycle"){ if(req.method === "POST") this.kvSet("lifecycle:auto", b.on ? "1" : "0"); return json(this.lifeState(this.clock(url.searchParams.get("now")), false), 200, {}); }
    if(path === "lifecycle-preview") return json({now:this.clock(url.searchParams.get("now")), ...this.lifeState(this.clock(url.searchParams.get("now")), true)}, 200, {});
    if(path === "lifecycle-test"){
      if(req.method !== "POST" || !EMAIL_RE.test(String(b.email || ""))) return json({error:"bad_email"}, 400, {});
      if(!LIFE_KINDS.includes(b.kind)) return json({error:"bad_kind", kinds:LIFE_KINDS}, 400, {});
      if(!this.mailReady()) return json({ok:false, error:"mail_not_configured"}, 200, {});
      // adresse d'un membre : son vrai lien de parrainage ; sinon un exemple. Offre 3 mois montrée si elle est active (ou demandée : offer = true)
      const to = clean(b.email, 120), m = this.one("SELECT * FROM users WHERE email = ?", to.toLowerCase()), t = this.clock(b.now);
      const u = {id:"test", first:clean(b.first, 30) || (m && m.first) || "Pierre", last:"", ref_code:(m && this.refCode(m)) || "AB23CD"};
      const {m:mail, unsub} = await this.lifeMailFor(u, b.kind, {now:t, code:u.ref_code, offer:b.offer === true || this.offerOn(t), until:t + 2*864e5 + 5*HOUR, gift:!!b.gift});
      const r = await this.mailSend(to, u.first, mail, "relance-essai", unsub);
      return json({...r, subject:mail.subject}, 200, {});
    }
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
    const first = niceFirst(u.first) || "toi", n = encodeURIComponent(first);
    const urls = {video:`${SITE}/video?n=${n}&src=email`, app:`${SITE}/app?src=email`, avis:`${SITE}/avis?n=${n}&src=email`, thumb:`${SITE}/media/bienvenue-email.jpg`, logo:`${SITE}/icons/icon-192.png`,
      unsub:`${API_URL}/social/unsub?u=${encodeURIComponent(u.id)}&t=${await this.unsubTok(u.id)}`};
    const r = await this.mailSend(to || u.email, `${u.first || ""} ${u.last || ""}`.trim() || first, welcomeMail(first, urls), "bienvenue", urls.unsub);
    if(r.ok && !to) this.sql.exec("UPDATE users SET welcomed = ? WHERE id = ?", NOW(), u.id);
    return r;
  }
  // envoi par Brevo (MAIL_API remplace l'adresse de Brevo pour les essais locaux seulement, jamais dans wrangler.toml), désinscription en un clic dans les en-têtes
  async mailSend(to, name, m, tag, unsub){
    const r = await fetch(this.env.MAIL_API || "https://api.brevo.com/v3/smtp/email", {method:"POST", headers:{"api-key":this.env.BREVO_API_KEY, "Content-Type":"application/json", Accept:"application/json"},
      body:JSON.stringify({sender:{name:this.env.MAIL_NAME || "Pierre de Traceo", email:this.env.MAIL_FROM}, to:[{email:to, name}],
        replyTo:{email:this.env.MAIL_REPLY || this.env.MAIL_FROM}, subject:m.subject, htmlContent:m.html, textContent:m.text, tags:[tag],
        headers:{"List-Unsubscribe":`<${unsub}>`, "List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}})}).catch(e => ({status:0, text:async () => String(e)}));
    const ok = r.status >= 200 && r.status < 300;
    if(ok) await r.body?.cancel().catch(() => {});
    return {ok, status:r.status, error:ok ? "" : String(await r.text()).slice(0, 200)};
  }

  /* ---------- Relances e-mail automatiques (tâche planifiée de worker.js, toutes les heures) ----------
     Quatre e-mails, chacun une seule fois par membre (prem_fin : une fois par pass) :
       j1        inscrit depuis 20 h à 7 jours, aucune course lancée (free_used = 0), pas Premium                  → /app?src=email_j1
       mur       courses offertes toutes utilisées, pas Premium, dernière course il y a 2 h ou plus                → /app?src=email_mur
       fin3m     36 dernières heures de l'offre 3 mois (seulement si kv offer3m = 1), pas Premium, inscrit depuis 12 h → /app?src=email_fin3m
       prem_fin  Premium du compte (payé ou offert) qui finit dans les 3 jours sans avoir été prolongé              → /app?src=email_premfin
     Interrupteur kv « lifecycle:auto », arrêté par défaut (tableau de bord). Jamais après une désinscription ou la case « pas d'e-mails » ;
     de 9 h à 20 h 30 (heure de Paris) ; un e-mail tous les 2 jours au plus par membre ; plafonds par passage et par 24 h (voir LIFE_RUN).
     Horloge : l'heure réelle, sauf essais locaux (variable TEST_CLOCK = 1, jamais dans wrangler.toml) où « now » peut être donné. */
  clock(v){ return this.env.TEST_CLOCK === "1" && +v > 0 ? +v : NOW(); }
  kvGet(k){ return this.one("SELECT v FROM kv WHERE k = ?", k)?.v; }
  kvSet(k, v){ this.sql.exec("INSERT OR REPLACE INTO kv(k, v) VALUES(?, ?)", k, String(v)); }
  mailReady(){ return !!(this.env.BREVO_API_KEY && this.env.MAIL_FROM); }
  offerOn(now){ return this.kvGet("offer3m") === "1" && now < OFFER_3M_END; }
  lifeHours(now){ const hm = new Date(now).toLocaleTimeString("fr-FR", {timeZone:"Europe/Paris", hour:"2-digit", minute:"2-digit", hourCycle:"h23"}).replace(/\D/g, ""); return hm >= "0900" && hm <= "2030"; }
  // qui recevrait quoi maintenant : un seul e-mail par membre et par passage, dans l'ordre fin3m, prem_fin, mur, j1
  lifePlan(now){
    const fin3m = this.offerOn(now) && now >= OFFER_3M_END - 36*HOUR;
    const done = new Set(), fails = {}, recent = new Set(), pass = {};
    for(const r of this.rows("SELECT uid, kind, key, ok, t FROM mail_log")){
      const k = r.uid + "|" + r.kind + "|" + r.key;
      if(r.ok){ done.add(k); if(r.t > now - LIFE_GAP && r.t <= now) recent.add(r.uid); } else fails[k] = (fails[k] || 0) + 1;
    }
    for(const r of this.rows("SELECT uid, MAX(until) AS until FROM payments WHERE uid IS NOT NULL AND until > ? AND txn NOT LIKE 'TEST-%' GROUP BY uid", now)) pass[r.uid] = r.until;
    const list = [], skip = {desinscrits:0, email_invalide:0, ecart_48h:0, echecs:0};
    for(const u of this.rows("SELECT id, pseudo, first, last, email, created, free_used, last_start, run_last, mail_off, ref_code FROM users ORDER BY created")){
      const until = pass[u.id] || 0, prem = until > now, last = +String(u.run_last || "").split("|")[1] || +String(u.last_start || "").split("|")[1] || 0, c = [];
      if(fin3m && !prem && u.created <= now - 12*HOUR) c.push({kind:"fin3m", key:""});
      if(prem && until - now <= 3*864e5) c.push({kind:"prem_fin", key:String(until), until});
      if(!prem && (u.free_used || 0) >= FREE_LOOPS && now - last >= 2*HOUR) c.push({kind:"mur", key:""});
      if(!prem && !(u.free_used > 0) && u.created <= now - 20*HOUR && u.created > now - 7*864e5) c.push({kind:"j1", key:""});
      const todo = c.filter(x => !done.has(u.id + "|" + x.kind + "|" + x.key)); if(!todo.length) continue;
      if(u.mail_off){ skip.desinscrits++; continue; }
      if(!EMAIL_RE.test(u.email || "")){ skip.email_invalide++; continue; }
      const x = todo.find(x => (fails[u.id + "|" + x.kind + "|" + x.key] || 0) < 3); if(!x){ skip.echecs++; continue; }   // 3 essais manqués : abandon
      if(recent.has(u.id)){ skip.ecart_48h++; continue; }
      list.push({u, ...x});
    }
    return {list, skip, fin3m};
  }
  async lifeMailFor(u, kind, o = {}){
    const first = niceFirst(u.first) || "toi", now = o.now || NOW(), code = o.code !== undefined ? o.code : this.refCode(u);
    const unsub = `${API_URL}/social/unsub?u=${encodeURIComponent(u.id)}&t=${await this.unsubTok(u.id)}`;
    return {first, unsub, m:lifeMail(kind, first, {app:`${SITE}/app?src=email_${kind.replace("_", "")}`, unsub, logo:`${SITE}/icons/icon-192.png`, link:code ? `${SITE}/?ref=${code}` : "",
      offer:o.offer !== undefined ? o.offer : this.offerOn(now), until:o.until, gift:o.gift, now})};
  }
  // passage : auto = tâche planifiée (respecte l'interrupteur) ; renvoie le résumé (aussi gardé dans kv lifecycle:last)
  async lifeRun(now, auto){
    if(auto && this.kvGet("lifecycle:auto") !== "1") return {ok:true, off:true, sent:0};
    if(!this.mailReady()) return {ok:false, error:"mail_not_configured", sent:0};
    if(!this.lifeHours(now)) return {ok:true, quiet:true, sent:0};
    if(this._lifeBusy) return {ok:false, error:"busy", sent:0};
    this._lifeBusy = true;
    try{
      const plan = this.lifePlan(now), room = Math.max(0, Math.min(LIFE_RUN, LIFE_DAY - this.one("SELECT COUNT(*) AS n FROM mail_log WHERE ok = 1 AND t > ?", now - 864e5).n));
      const by = {}, fails = [];
      for(const x of plan.list.slice(0, room)){
        const u = x.u, gift = x.kind === "prem_fin" && !!this.one("SELECT 1 AS x FROM payments WHERE uid = ? AND until = ? AND txn LIKE 'REF-%'", u.id, x.until);
        const {m, unsub} = await this.lifeMailFor(u, x.kind, {now, until:x.until, gift});
        // noté avant l'envoi (ok = 0) : un passage interrompu ne renvoie jamais deux fois sans le compter comme essai
        const id = this.one("INSERT INTO mail_log(uid, kind, key, t, ok, info) VALUES(?,?,?,?,0,'envoi') RETURNING id", u.id, x.kind, x.key, now).id;
        const r = await this.mailSend(u.email, `${u.first || ""} ${u.last || ""}`.trim() || niceFirst(u.first), m, "relance-" + x.kind, unsub);
        this.sql.exec("UPDATE mail_log SET ok = ?, info = ? WHERE id = ?", r.ok ? 1 : 0, r.ok ? "" : `HTTP ${r.status} ${r.error}`.slice(0, 200), id);
        console.log("relance", x.kind, u.pseudo, r.ok ? "envoyée" : "échec " + r.status);
        if(r.ok) by[x.kind] = (by[x.kind] || 0) + 1; else fails.push({pseudo:u.pseudo, kind:x.kind, status:r.status});
      }
      const sent = Object.values(by).reduce((a, n) => a + n, 0), res = {ok:true, t:now, sent, by, fails:fails.length, waiting:Math.max(0, plan.list.length - room), skip:plan.skip};
      this.kvSet("lifecycle:last", JSON.stringify(res));
      if(auto && sent) this.alert(`Relances e-mail : ${sent} envoyée${sent > 1 ? "s" : ""}`, Object.entries(by).map(([k, n]) => `${LIFE_LABEL[k]} : ${n}`).join(" · ") + (fails.length ? `\n${fails.length} envoi${fails.length > 1 ? "s" : ""} manqué${fails.length > 1 ? "s" : ""} (nouvel essai à l'heure suivante).` : ""), {tags:"email", click:DASH_URL});
      return {...res, failed:fails};
    } finally { this._lifeBusy = false; }
  }
  // état pour le tableau de bord : interrupteur, e-mails envoyés par sorte, dernier passage, prochains destinataires (withList : liste détaillée)
  lifeState(now, withList){
    const plan = this.lifePlan(now), sent = Object.fromEntries(LIFE_KINDS.map(k => [k, 0]));
    for(const r of this.rows("SELECT kind, COUNT(*) AS n FROM mail_log WHERE ok = 1 GROUP BY kind")) sent[r.kind] = r.n;
    const next = Object.fromEntries(LIFE_KINDS.map(k => [k, plan.list.filter(x => x.kind === k).length]));
    return {on:this.kvGet("lifecycle:auto") === "1", mail:this.mailReady(), hours:"09:00-20:30", now_ok:this.lifeHours(now), offer3m:this.offerOn(now), offer_end:OFFER_3M_END, sent,
      failed:this.one("SELECT COUNT(*) AS n FROM mail_log WHERE ok = 0").n, last:this.kvJson("lifecycle:last"), next:{count:plan.list.length, by:next, max_run:LIFE_RUN}, skip:plan.skip,
      ...(withList ? {list:plan.list.map(x => ({pseudo:x.u.pseudo, first:niceFirst(x.u.first), email:String(x.u.email).replace(/^(.{2})[^@]*/, "$1…"), kind:x.kind, ...(x.until ? {until:x.until} : {})}))} : {})};
  }
  async unsub(url, req){
    const id = clean(url.searchParams.get("u"), 40), t = clean(url.searchParams.get("t"), 40), ok = !!id && t === await this.unsubTok(id);
    if(ok) this.sql.exec("UPDATE users SET mail_off = 1 WHERE id = ?", id);
    const msg = ok ? "C'est noté : tu ne recevras plus d'e-mails de Traceo. Ton compte et tes boucles restent là, bien sûr." : "Ce lien de désinscription n'est pas valide.";
    return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Traceo</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#04080B;color:#E6F2F0;font:600 17px/1.5 system-ui,sans-serif;text-align:center;padding:24px"><div><p>${msg}</p><p><a style="color:#2BE39B" href="${SITE}/app">Revenir sur Traceo</a></p></div></body></html>`, {status:ok ? 200 : 400, headers:{"Content-Type":"text/html; charset=utf-8"}});
  }
  feedback(b, ip){
    if(this.limit("avis:" + ip, 6, HOUR)) return json({error:"rate_limited"}, 429, {});
    const stars = Math.round(+b.stars), text = clean(b.text, 1500), name = clean(b.n, 24), src = clean(b.src, 20).toLowerCase().replace(/[^a-z0-9_-]/g, ""), premium = ["oui", "peut-etre", "non"].includes(b.premium) ? b.premium : "";
    if(!(stars >= 1 && stars <= 5)) return json({error:"bad_stars"}, 400, {});
    this.sql.exec("INSERT INTO feedback(t, stars, text, name, src, premium) VALUES(?,?,?,?,?,?)", NOW(), stars, text, name, src, premium);
    this.alert(`Nouvel avis ${stars}/5${premium === "oui" ? " - interesse par Premium" : ""}`, `${"⭐".repeat(stars)} ${name || "Un coureur"}${src ? " (via " + src + ")" : ""} : ${text || "pas de commentaire"}${premium ? `\nPremium : ${{oui:"oui 💎", "peut-etre":"peut-être", non:"non"}[premium]}` : ""}`, {tags:"star", priority:stars <= 2 || premium === "oui" ? "high" : "default", click:DASH_URL});
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
