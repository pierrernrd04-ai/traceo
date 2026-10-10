// Traceo « Ensemble » : comptes coureurs, coureurs autour de soi, invitations à courir, messages et notifications.
// Tout est gardé dans un Durable Object (base SQLite, offre gratuite de Cloudflare), sans autre service.
//
// Vie privée : la position est arrondie à ~300 m avant d'être enregistrée, n'est montrée qu'en distance arrondie,
// disparaît après 3 h sans activité, et seulement si la personne a choisi d'être visible. Compte supprimable à tout moment.
//
// Authentification : à l'inscription, le serveur renvoie un jeton secret gardé sur le téléphone
// (en-tête Authorization: Bearer <id>.<jeton>) ; seule son empreinte SHA-256 est enregistrée.
import { json } from "./worker.js";

export async function social(req, env, cors){
  if(!env.HUB) return json({error:"social_not_configured"}, 503, cors);
  const stub = env.HUB.get(env.HUB.idFromName("france"));
  const headers = new Headers(req.headers); headers.set("X-IP", req.headers.get("CF-Connecting-IP") || "?");
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

export class Hub {
  constructor(state, env){
    this.state = state; this.env = env; this.sql = state.storage.sql; this.hits = new Map();
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, tok TEXT, first TEXT, last TEXT, email TEXT, level TEXT, pace INT, bio TEXT,
      created INT, seen INT, lat REAL, lon REAL, visible INT DEFAULT 1, avail_until INT DEFAULT 0, avail_km REAL, avail_note TEXT, push TEXT, notif INT DEFAULT 1, shout_at INT DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS msgs(id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT, b TEXT, t INT, kind TEXT, body TEXT, meta TEXT)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS msgs_b ON msgs(b, id)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS msgs_a ON msgs(a, id)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS blocks(who TEXT, whom TEXT, PRIMARY KEY(who, whom))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports(t INT, who TEXT, whom TEXT, why TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)`);
  }
  rows(q, ...a){ return [...this.sql.exec(q, ...a)]; }
  one(q, ...a){ return this.rows(q, ...a)[0] || null; }
  limit(key, n, ms){ const now = NOW(), h = (this.hits.get(key) || []).filter(t => now - t < ms); if(h.length >= n){ this.hits.set(key, h); return true; } h.push(now); this.hits.set(key, h); if(this.hits.size > 20000) this.hits.clear(); return false; }

  async fetch(req){
    const url = new URL(req.url), path = url.pathname.replace(/^\/social\//, ""), ip = req.headers.get("X-IP") || "?";
    let body = {}; if(req.method === "POST"){ try{ body = await req.json(); }catch(e){ return json({error:"bad_json"}, 400, {}); } }
    try{
      if(path === "vapid") return json({key:(await this.vapid()).pub}, 200, {});
      if(path === "signup") return this.signup(body, ip);
      const me = await this.auth(req);
      if(!me) return json({error:"auth"}, 401, {});
      this.sql.exec("UPDATE users SET seen = ? WHERE id = ?", NOW(), me.id);
      switch(path){
        case "me": return this.update(me, body);
        case "delete": return this.remove(me);
        case "pos": return this.pos(me, body);
        case "nearby": return this.nearby(me, +url.searchParams.get("r") || 10);
        case "send": return this.send(me, body);
        case "shout": return this.shout(me, body);
        case "inbox": return this.inbox(me, +url.searchParams.get("since") || 0);
        case "block": return this.block(me, body);
        case "report": return this.report(me, body);
      }
      return json({error:"not_found"}, 404, {});
    }catch(e){ return json({error:"server", detail:String(e.message || e).slice(0, 200)}, 500, {}); }
  }

  async auth(req){
    const m = /^Bearer\s+([a-z0-9]{8,32})\.([a-f0-9]{32,64})$/i.exec(req.headers.get("Authorization") || ""); if(!m) return null;
    const u = this.one("SELECT * FROM users WHERE id = ?", m[1]);
    return u && u.tok === await sha(m[2]) ? u : null;
  }
  pub(u){ return {id:u.id, name:`${u.first} ${u.last ? u.last[0].toUpperCase() + "." : ""}`.trim(), first:u.first, level:u.level, pace:u.pace, bio:u.bio || ""}; }

  async signup(b, ip){
    if(this.limit("su:" + ip, 6, HOUR)) return json({error:"rate_limited"}, 429, {});
    const first = clean(b.first, 30), last = clean(b.last, 40), email = clean(b.email, 120).toLowerCase();
    if(!first || !last) return json({error:"name_required"}, 400, {});
    if(!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return json({error:"bad_email"}, 400, {});
    if(!b.age15 || !b.terms) return json({error:"consent_required"}, 400, {});
    const id = hex(crypto.getRandomValues(new Uint8Array(8))), token = hex(crypto.getRandomValues(new Uint8Array(24)));
    this.sql.exec("INSERT INTO users(id, tok, first, last, email, level, pace, bio, created, seen, visible) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id, await sha(token), first, last, email, LEVELS.includes(b.level) ? b.level : "regulier", Math.max(150, Math.min(900, +b.pace || 345)), clean(b.bio, 140), NOW(), NOW(), b.visible === false ? 0 : 1);
    return json({id, token, me:this.mine(this.one("SELECT * FROM users WHERE id = ?", id))}, 200, {});
  }
  mine(u){ return {...this.pub(u), last:u.last, email:u.email, visible:!!u.visible, notif:!!u.notif, push:!!u.push, avail_until:u.avail_until || 0}; }
  update(me, b){
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
    const keys = Object.keys(f);
    if(keys.length) this.sql.exec(`UPDATE users SET ${keys.map(k => k + " = ?").join(", ")} WHERE id = ?`, ...keys.map(k => f[k]), me.id);
    return json({me:this.mine(this.one("SELECT * FROM users WHERE id = ?", me.id))}, 200, {});
  }
  remove(me){
    this.sql.exec("DELETE FROM msgs WHERE a = ? OR b = ?", me.id, me.id);
    this.sql.exec("DELETE FROM blocks WHERE who = ? OR whom = ?", me.id, me.id);
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
    if(this.env.ALERTS_TOPIC) this.state.waitUntil(fetch("https://ntfy.sh/" + this.env.ALERTS_TOPIC, {method:"POST", headers:{Title:"Signalement Traceo Ensemble", Priority:"high"}, body:`${me.id} signale ${who} : ${clean(b.why, 300)}`}).catch(() => {}));
    return json({ok:true}, 200, {});
  }

  /* ---------- Notifications (Web Push, sans contenu : le téléphone vient lire le message) ---------- */
  async vapid(){
    if(this._v) return this._v;
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
      const {endpoint} = JSON.parse(u.push), v = await this.vapid(), aud = new URL(endpoint).origin;
      const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
      const unsigned = enc({typ:"JWT", alg:"ES256"}) + "." + enc({aud, exp:Math.floor(NOW()/1000) + 12*3600, sub:this.env.PUSH_SUBJECT || "https://pierrernrd04-ai.github.io/traceo/"});
      const sig = await crypto.subtle.sign({name:"ECDSA", hash:"SHA-256"}, v.key, new TextEncoder().encode(unsigned));
      const r = await fetch(endpoint, {method:"POST", headers:{Authorization:`vapid t=${unsigned}.${b64u(sig)}, k=${v.pub}`, TTL:"21600", Urgency:"high", "Content-Length":"0"}});
      if(r.status === 404 || r.status === 410) this.sql.exec("UPDATE users SET push = NULL WHERE id = ?", u.id);
    }catch(e){}
  }
}
