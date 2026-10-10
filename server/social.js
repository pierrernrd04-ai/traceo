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
const REWARD_EVERY = 100, REWARD_EUR = 5;   // 5 € toutes les 100 courses vérifiées

export class Hub {
  constructor(state, env){
    this.state = state; this.env = env; this.sql = state.storage.sql; this.hits = new Map();
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, pseudo TEXT UNIQUE, pw TEXT, first TEXT, last TEXT, email TEXT UNIQUE, birth TEXT, level TEXT, pace INT, bio TEXT,
      created INT, seen INT, last_login INT, lat REAL, lon REAL, place TEXT, visible INT DEFAULT 1, avail_until INT DEFAULT 0, avail_km REAL, avail_note TEXT, push TEXT, notif INT DEFAULT 1, shout_at INT DEFAULT 0, premium INT DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions(tok TEXT PRIMARY KEY, uid TEXT, created INT, seen INT, ua TEXT)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS sessions_uid ON sessions(uid)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS msgs(id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT, b TEXT, t INT, kind TEXT, body TEXT, meta TEXT)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS msgs_b ON msgs(b, id)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS msgs_a ON msgs(a, id)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS blocks(who TEXT, whom TEXT, PRIMARY KEY(who, whom))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports(t INT, who TEXT, whom TEXT, why TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)`);
    // Programme « 100 courses = 5 € » : courses vérifiées et récompenses
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, t INT, day TEXT, dist INT, time INT, ascent INT, n_pts INT, hash TEXT, ok INT, reason TEXT, premium INT, lat REAL, lon REAL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS runs_uid ON runs(uid, ok, t)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rewards(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, milestone INT, amount REAL, status TEXT, paypal TEXT, created INT, done_at INT, note TEXT)`);
  }
  rows(q, ...a){ return [...this.sql.exec(q, ...a)]; }
  one(q, ...a){ return this.rows(q, ...a)[0] || null; }
  limit(key, n, ms){ const now = NOW(), h = (this.hits.get(key) || []).filter(t => now - t < ms); if(h.length >= n){ this.hits.set(key, h); return true; } h.push(now); this.hits.set(key, h); if(this.hits.size > 20000) this.hits.clear(); return false; }

  async fetch(req){
    const url = new URL(req.url), path = url.pathname.replace(/^\/social\//, ""), ip = req.headers.get("X-IP") || "?";
    let body = {}; if(req.method === "POST"){ const raw = await req.text(); if(raw.trim()){ try{ body = JSON.parse(raw); }catch(e){ return json({error:"bad_json"}, 400, {}); } } }
    try{
      if(path === "vapid") return json({key:(await this.vapid()).pub}, 200, {});
      if(path === "signup") return this.signup(body, ip, req);
      if(path === "login") return this.login(body, ip, req);
      if(path === "pseudo") return json({free:!this.one("SELECT 1 AS x FROM users WHERE pseudo = ?", clean(url.searchParams.get("p"), 20).toLowerCase())}, 200, {});
      if(path.startsWith("admin/")) return this.admin(req, path.slice(6), body, url, ip);
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
    if(this.limit("su:" + ip, 8, HOUR)) return json({error:"rate_limited"}, 429, {});
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
    if(this.env.ALERTS_TOPIC) this.state.waitUntil(fetch("https://ntfy.sh/" + this.env.ALERTS_TOPIC, {method:"POST", headers:{Title:"Nouveau membre Traceo", Tags:"handshake"}, body:`${first} ${last} (@${pseudo}) vient de créer son compte.`}).catch(() => {}));
    return json({token, me:this.mine(u)}, 200, {});
  }
  async login(b, ip, req){
    const who = clean(b.login, 120).toLowerCase().replace(/^@/, "");
    if(this.limit("li:" + ip, 20, 15*MIN) || this.limit("lu:" + who, 8, 15*MIN)) return json({error:"rate_limited"}, 429, {});
    const u = this.one("SELECT * FROM users WHERE email = ? OR pseudo = ?", who, who);
    if(!u || !/^[a-f0-9]{64}$/.test(String(b.key || "")) || await this.hashPw(b.key, u.pw.split(":")[0]) !== u.pw) return json({error:"bad_login"}, 401, {});
    return json({token:await this.newSession(u, req), me:this.mine(u)}, 200, {});
  }
  mine(u){ return {...this.pub(u), last:u.last, email:u.email, birth:u.birth, visible:!!u.visible, notif:!!u.notif, push:!!u.push, avail_until:u.avail_until || 0}; }
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
    if(this.env.ALERTS_TOPIC) this.state.waitUntil(fetch("https://ntfy.sh/" + this.env.ALERTS_TOPIC, {method:"POST", headers:{Title:"Signalement Traceo Ensemble", Priority:"high"}, body:`${me.id} signale ${who} : ${clean(b.why, 300)}`}).catch(() => {}));
    return json({ok:true}, 200, {});
  }

  /* ---------- Programme « 100 courses = 5 € » ---------- */
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
      if(this.env.ALERTS_TOPIC) this.state.waitUntil(fetch("https://ntfy.sh/" + this.env.ALERTS_TOPIC, {method:"POST", headers:{Title:`Récompense ${REWARD_EUR} € gagnée`, Tags:"moneybag", Priority:"high"}, body:`${me.first} ${me.last} (@${me.pseudo}) a validé sa ${count}e course. À verser après vérification (page admin).`}).catch(() => {}));
    }
    return json({ok:!!ok, reason, count, every:REWARD_EVERY, reward}, 200, {});
  }
  claim(me, b){
    const pp = clean(b.paypal, 120).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(pp)) return json({error:"bad_email"}, 400, {});
    const r = this.one("SELECT * FROM rewards WHERE uid = ? AND id = ? AND status = 'a_reclamer'", me.id, +b.id);
    if(!r) return json({error:"unknown_reward"}, 404, {});
    this.sql.exec("UPDATE rewards SET status = 'demandee', paypal = ? WHERE id = ?", pp, r.id);
    if(this.env.ALERTS_TOPIC) this.state.waitUntil(fetch("https://ntfy.sh/" + this.env.ALERTS_TOPIC, {method:"POST", headers:{Title:"Récompense à verser", Tags:"moneybag", Priority:"high"}, body:`@${me.pseudo} demande ses ${r.amount} € (${r.milestone}e course) sur le PayPal ${pp}.`}).catch(() => {}));
    return json({ok:true}, 200, {});
  }

  /* ---------- Administration (page admin.html) ---------- */
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
    if(path === "members"){
      const rows = this.rows(`SELECT u.*, (SELECT COUNT(*) FROM msgs WHERE a = u.id) AS sent, (SELECT COUNT(*) FROM reports WHERE whom = u.id) AS reported, (SELECT COUNT(*) FROM runs WHERE uid = u.id AND ok = 1) AS runs FROM users u ORDER BY created DESC LIMIT 5000`);
      return json({members:rows.map(u => ({id:u.id, pseudo:u.pseudo, first:u.first, last:u.last, email:u.email, birth:u.birth, level:u.level, pace:u.pace, created:u.created, last_login:u.last_login, seen:u.seen,
        place:u.place || "", visible:!!u.visible, premium:!!u.premium, push:!!u.push, sent:u.sent, reported:u.reported, runs:u.runs}))}, 200, {});
    }
    if(path === "reports") return json({reports:this.rows("SELECT r.*, a.pseudo AS by_pseudo, b.pseudo AS whom_pseudo FROM reports r LEFT JOIN users a ON a.id = r.who LEFT JOIN users b ON b.id = r.whom ORDER BY t DESC LIMIT 500")}, 200, {});
    if(path === "rewards") return json({rewards:this.rows(`SELECT r.*, u.pseudo, u.first, u.last, u.email, (SELECT COUNT(*) FROM runs WHERE uid = r.uid AND ok = 1) AS runs,
      (SELECT COUNT(*) FROM runs WHERE uid = r.uid AND ok = 0) AS refused FROM rewards r LEFT JOIN users u ON u.id = r.uid ORDER BY CASE r.status WHEN 'demandee' THEN 0 WHEN 'a_reclamer' THEN 1 ELSE 2 END, r.id DESC LIMIT 500`)}, 200, {});
    if(path === "runs") return json({runs:this.rows("SELECT id, t, dist, time, ascent, n_pts, ok, reason, premium FROM runs WHERE uid = ? ORDER BY id DESC LIMIT 300", clean(url.searchParams.get("uid"), 32))}, 200, {});
    if(path === "reward"){
      const st = ["versee", "refusee", "demandee", "a_reclamer"].includes(b.status) ? b.status : null; if(!st) return json({error:"bad_status"}, 400, {});
      this.sql.exec("UPDATE rewards SET status = ?, note = ?, done_at = ? WHERE id = ?", st, clean(b.note, 200), NOW(), +b.id);
      return json({ok:true}, 200, {});
    }
    if(path === "delete"){ const u = this.one("SELECT * FROM users WHERE id = ?", clean(b.id, 32)); if(!u) return json({error:"unknown_user"}, 404, {}); return this.remove(u); }
    if(path === "reset"){
      const u = this.one("SELECT * FROM users WHERE id = ?", clean(b.id, 32)); if(!u || !/^[a-f0-9]{64}$/.test(String(b.key || ""))) return json({error:"bad_request"}, 400, {});
      this.sql.exec("UPDATE users SET pw = ? WHERE id = ?", await this.hashPw(b.key), u.id); this.sql.exec("DELETE FROM sessions WHERE uid = ?", u.id);
      return json({ok:true}, 200, {});
    }
    return json({error:"not_found"}, 404, {});
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
