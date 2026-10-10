// Traceo « Ensemble » (Premium) : compte coureur, coureurs autour de soi, « Je pars courir », invitations,
// messages et notifications. Serveur : server/social.js (même adresse que le chat, C.CHAT_API).
// Ce fichier est chargé après app.js et réutilise ses outils ($, esc, S, store, render, go, openModal, toast…).
"use strict";
const ENS = {
  auth:store.get("ensAuth", null),          // jeton de session (48 caractères hexadécimaux)
  me:store.get("ensMe", null),
  read:store.get("ensRead", {}),            // dernier message lu, par coureur
  msgs:store.get("ensMsgs", []), users:store.get("ensUsers", {}), last:0,
  near:null, r:store.get("ensR", 5), thread:null, err:"", busy:false, timer:null, first:true
};
if(ENS.auth && !/^[a-f0-9]{48}$/.test(ENS.auth)) ENS.auth = null;   // ancien format de jeton
ENS.mode = "signup";
ENS.last = ENS.msgs.length ? ENS.msgs[ENS.msgs.length - 1].id : 0;
const ensApi = () => (C.SOCIAL_API || C.CHAT_API || "").replace(/\/$/, "");
const ensOn = () => !!ensApi();
const LVL = {debut:"Débutant", regulier:"Régulier", confirme:"Confirmé", expert:"Expert"};
const EI = {
  people:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c.8-3.6 3.2-5.5 6-5.5s5.2 1.9 6 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.3.2 4 1.9 4.5 5"/></svg>',
  run:'<svg viewBox="0 0 24 24"><circle cx="14" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v5M6 12l3-4 4 1 3 4 3 1"/></svg>',
  bell:'<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/></svg>',
  send:'<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>',
  back:'<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  shield:'<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  more:'<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>'
};
const initials = n => esc(String(n || "?").split(/\s+/).map(w => w[0] || "").join("").slice(0, 2).toUpperCase());
const avColor = id => `hsl(${[...String(id)].reduce((a, c) => a + c.charCodeAt(0)*7, 0) % 360} 70% 62%)`;
const hhmm = t => new Date(t).toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"});
const dayTxt = t => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? hhmm(t) : d.toLocaleDateString("fr-FR", {day:"numeric", month:"short"}); };
// Mot de passe : étiré sur le téléphone avant envoi (le serveur ne le voit jamais en clair)
async function pwKey(pw){
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2", salt:new TextEncoder().encode("traceo-ensemble-v1"), iterations:150000, hash:"SHA-256"}, k, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const ERRS = {pseudo_taken:"Cet identifiant est déjà pris, choisis-en un autre.", email_taken:"Un compte existe déjà avec cet e-mail : connecte-toi.", too_young:"Ensemble est réservé aux 15 ans et plus.", bad_pseudo:"Identifiant : 3 à 20 caractères, lettres minuscules, chiffres, point ou tiret bas.", bad_email:"Adresse e-mail invalide.", bad_birth:"Date de naissance invalide.", bad_login:"Identifiant ou mot de passe incorrect.", rate_limited:"Trop d'essais : réessaie dans quelques minutes.", consent_required:"Accepte les règles pour continuer."};
const errTxt = e => ERRS[e.message] || "Connexion au serveur impossible, vérifie ta connexion.";
const ensHere = () => S.here || (S.start ? [S.start.lat, S.start.lng] : null);

async function ensCall(path, body, method){
  const r = await fetch(ensApi() + "/social/" + path, {method:method || (body ? "POST" : "GET"), headers:{"Content-Type":"application/json", ...(ENS.auth ? {Authorization:"Bearer " + ENS.auth} : {})}, body:body ? JSON.stringify(body) : undefined});
  let j = {}; try{ j = await r.json(); }catch(e){}
  if(r.status === 401 && ENS.auth){ ensLogout(); throw new Error("auth"); }
  if(!r.ok) throw new Error(j.error || "http " + r.status);
  return j;
}
function ensSaveAuth(){
  store.set("ensAuth", ENS.auth); store.set("ensMe", ENS.me);
  // le service worker lit ces infos pour afficher le texte des notifications
  try{ caches.open("traceo-social").then(c => c.put("auth", new Response(JSON.stringify({api:ensApi(), auth:ENS.auth, since:Math.max(0, ENS.last - 5)})))); }catch(e){}
}
function ensLogout(){ ENS.auth = null; ENS.me = null; ENS.msgs = []; ENS.users = {}; ENS.last = 0; ENS.near = null; ENS.thread = null; ["ensAuth", "ensMe", "ensMsgs", "ensUsers", "ensRead"].forEach(k => store.set(k, null)); ENS.read = {}; try{ caches.delete("traceo-social"); }catch(e){} ensBadge(); }

/* ---------- Conversations ---------- */
function ensConvs(){
  const me = ENS.me?.id, by = {};
  for(const m of ENS.msgs){ const peer = m.from === me ? m.to : m.from; (by[peer] = by[peer] || []).push(m); }
  return Object.entries(by).map(([peer, list]) => ({peer, list, last:list[list.length - 1], unread:list.filter(m => m.from !== me && m.id > (ENS.read[peer] || 0)).length}))
    .sort((a, b) => b.last.id - a.last.id);
}
const ensUnread = () => ENS.me ? ensConvs().reduce((a, c) => a + c.unread, 0) : 0;
function ensBadge(){ const b = document.querySelector('#tabs [data-tab="ensemble"]'); if(!b) return; const n = ensUnread(); b.dataset.badge = n > 9 ? "9+" : n || ""; }
function markRead(peer){ const c = ensConvs().find(x => x.peer === peer); if(c){ ENS.read[peer] = c.last.id; store.set("ensRead", ENS.read); ensBadge(); } }

async function ensPoll(){
  if(!ensOn() || !ENS.auth || document.hidden) return;
  try{
    const j = await ensCall("inbox?since=" + ENS.last);
    ENS.me = j.me; Object.assign(ENS.users, j.users);
    const fresh = j.msgs.filter(m => !ENS.msgs.some(x => x.id === m.id));
    if(fresh.length){
      ENS.msgs = [...ENS.msgs, ...fresh].slice(-400); ENS.last = ENS.msgs[ENS.msgs.length - 1].id;
      store.set("ensMsgs", ENS.msgs); store.set("ensUsers", ENS.users); ensSaveAuth();
      const inc = fresh.filter(m => m.from !== ENS.me.id);
      if(inc.length && !ENS.first){
        const m = inc[inc.length - 1], n = ENS.users[m.from]?.name || "Un coureur";
        if(ENS.thread === m.from && S.tab === "ensemble") markRead(m.from);
        else{ toast(m.kind === "invite" ? `${n} te propose de courir ensemble` : m.kind === "shout" ? `${n} part courir près de toi` : m.kind === "accept" ? `${n} a accepté ta course !` : `${n} : ${m.body}`, 4000); try{ navigator.vibrate?.([40, 60, 40]); }catch(e){} }
      }
      if(S.tab === "ensemble" && !ensTyping()) render();
    }
    ENS.first = false; ensBadge();
  }catch(e){}
}
const ensTyping = () => { const a = document.activeElement; return a && (a.id === "ensIn") && a.value; };
async function ensNearby(){
  const here = ensHere();
  try{
    if(here) await ensCall("pos", {lat:here[0], lon:here[1]});
    const j = await ensCall("nearby?r=" + ENS.r); ENS.near = j; ENS.err = "";
  }catch(e){ ENS.err = e.message; }
  if(S.tab === "ensemble" && !ENS.thread && !ensTyping()) render();
}
function ensLoop(){
  clearInterval(ENS.timer);
  if(!ensOn() || !ENS.auth) return;
  let n = 0;
  ENS.timer = setInterval(() => { const open = S.tab === "ensemble"; n++; if(open || n % 5 === 0) ensPoll(); if(open && !ENS.thread && n % 4 === 0) ensNearby(); }, 12000);
}
document.addEventListener("visibilitychange", () => { if(!document.hidden){ ensPoll(); if(S.tab === "ensemble") ensNearby(); } });

/* ---------- Vues ---------- */
function ensPitch(){
  return `<div class="ens-hero"><span class="ens-ic">${EI.people}</span><p class="eyebrow" style="color:var(--gold)">★ Inclus dans Premium</p>
    <p class="title">Cours avec les coureurs autour de toi.</p>
    <p class="muted">Crée ton profil de coureur, vois qui court près de chez toi, propose une sortie et discute avant de partir.</p></div>
    <ul class="checks ens-checks"><li><b>Coureurs autour de toi</b> : prénom, niveau, allure et distance approximative</li><li><b>« Je pars courir »</b> : les coureurs proches reçoivent une notification</li><li><b>Invitations et messages</b> pour fixer l'heure et le lieu</li><li><b>Vie privée</b> : position arrondie, jamais ton adresse ; mode invisible en un geste</li></ul>`;
}
function viewEnsemble(){
  if(!ensOn()) return ensPitch() + `<div class="plan"><p class="title" style="font-size:20px">Ouverture imminente</p><p class="small">Ensemble s'active dès la mise en ligne du serveur Traceo. Tu seras parmi les premiers à pouvoir créer ton compte.</p></div>`;
  if(!isPremium()) return ensPitch() + `<button class="btn hero block" id="ensPrem">${EI.people}Débloquer Ensemble avec Premium · ${C.PRICE_LABEL}</button><p class="small" style="text-align:center">31 jours, payés par PayPal ou carte. Sans renouvellement automatique.</p>`;
  if(!ENS.auth) return ensSignup();
  if(ENS.thread) return ensThread(ENS.thread);
  const me = ENS.me || {}, av = me.avail_until > Date.now(), convs = ensConvs(), near = ENS.near?.list || [];
  const pushOk = "PushManager" in window && "serviceWorker" in navigator, perm = window.Notification ? Notification.permission : "denied";
  return `<div class="ens-top"><span class="ens-av" style="--c:${avColor(me.id)}">${initials(me.name)}</span><span class="b"><b>Salut ${esc(me.first || "")} !</b><small>@${esc(me.pseudo || "")} · ${LVL[me.level] || ""} · ${paceTxt(me.pace)}/km</small></span>
      <label class="ens-vis"><input type="checkbox" id="ensVis" ${me.visible ? "checked" : ""}><span>${me.visible ? "Visible" : "Invisible"}</span></label></div>
    ${av ? `<div class="ens-go on"><span class="ens-ic sm">${EI.run}</span><span class="b"><b>Tu es signalé·e disponible</b><small>jusqu'à ${hhmm(me.avail_until)} · les coureurs proches ont été prévenus</small></span><button class="linkbtn" id="ensStop">Annuler</button></div>`
      : `<button class="ens-go" id="ensGo"><span class="ens-ic sm">${EI.run}</span><span class="b"><b>Je pars courir</b><small>Préviens les coureurs à moins de 5 km</small></span><span class="arr">›</span></button>`}
    ${!me.push && pushOk && perm !== "denied" ? `<button class="ens-notif" id="ensPush">${EI.bell}<span><b>Active les notifications</b><small>${isIOS && !standalone ? "Sur iPhone : ajoute d'abord Traceo à l'écran d'accueil (Partager › Sur l'écran d'accueil)." : "Pour savoir quand un coureur t'invite, même app fermée."}</small></span></button>` : ""}
    <div class="ens-sec"><p class="eyebrow">Autour de toi</p><div class="seg ens-r">${[2, 5, 10, 20].map(r => `<button data-ensr="${r}" aria-pressed="${ENS.r === r}">${r} km</button>`).join("")}</div></div>
    ${!ensHere() ? `<div class="ens-empty"><p>Localise-toi pour voir les coureurs autour de toi.</p><button class="btn soft" id="ensLoc">Me localiser</button></div>`
      : ENS.near == null ? `<div class="ens-empty"><div class="spin"></div><p>Recherche des coureurs…</p></div>`
      : near.length ? `<div class="ens-list">${near.map(u => `<div class="ens-card"><span class="ens-av" style="--c:${avColor(u.id)}">${initials(u.name)}${u.online ? "<i></i>" : ""}</span>
          <span class="b"><b>${esc(u.name)} <span class="ps">@${esc(u.pseudo || "")}</span></b><small>${LVL[u.level] || ""} · ${paceTxt(u.pace)}/km · ${esc(u.dist)}</small>${u.avail ? `<em class="ens-tag">Part courir ${u.avail.km ? nf(0).format(u.avail.km) + " km" : ""}${u.avail.note ? " · " + esc(u.avail.note) : ""}</em>` : u.online ? `<em class="ens-tag soft">En ligne</em>` : `<small>Vu·e il y a ${u.seenMin < 60 ? u.seenMin + " min" : Math.round(u.seenMin/60) + " h"}</small>`}</span>
          <span class="acts"><button class="btn hero sm" data-ensinv="${u.id}">Courir</button><button class="iconbtn" data-ensmsg="${u.id}" aria-label="Écrire à ${esc(u.name)}">${EI.send}</button></span></div>`).join("")}</div>`
      : `<div class="ens-empty"><p><b>Personne de visible à moins de ${ENS.r} km pour l'instant.</b></p><p class="small">Ensemble vient d'ouvrir : touche « Je pars courir », les coureurs qui arrivent près de toi seront prévenus. Partage Traceo à tes partenaires de course !</p><button class="btn soft" id="ensShare">Inviter des amis</button></div>`}
    ${ENS.err && ENS.err !== "auth" ? `<p class="small" style="color:var(--warn)">Connexion au serveur impossible pour l'instant, nouvel essai dans quelques secondes.</p>` : ""}
    <div class="ens-sec"><p class="eyebrow">Messages</p></div>
    ${convs.length ? `<div class="ens-list">${convs.map(c => { const u = ENS.users[c.peer] || {name:"Coureur"}, m = c.last, mine = m.from === me.id; return `<button class="ens-conv" data-ensth="${c.peer}"><span class="ens-av" style="--c:${avColor(c.peer)}">${initials(u.name)}</span><span class="b"><b>${esc(u.name)}</b><small>${mine ? "Toi : " : ""}${m.kind === "invite" ? "🏃 Invitation à courir" : m.kind === "shout" ? "📣 " + esc(m.body) : m.kind === "accept" ? "✅ Course acceptée" : m.kind === "decline" ? "Pas dispo cette fois" : esc(m.body)}</small></span><span class="t">${dayTxt(m.t)}${c.unread ? `<i>${c.unread}</i>` : ""}</span></button>`; }).join("")}</div>`
      : `<p class="small">Pas encore de message. Propose une course à un coureur proche pour démarrer.</p>`}
    <div class="ens-foot"><button class="linkbtn" id="ensSafe">${EI.shield}Conseils de sécurité</button><button class="linkbtn" id="ensAcc">Mon compte</button></div>`;
}
function ensSignup(){
  if(ENS.mode === "login") return `<form class="ens-form" id="ensLogin" novalidate><p class="title" style="font-size:22px">Connexion</p>
    <div class="field"><label for="elId">Identifiant ou e-mail</label><input class="input" id="elId" autocomplete="username" autocapitalize="none" maxlength="120"></div>
    <div class="field"><label for="elPw">Mot de passe</label><div class="pw"><input class="input" id="elPw" type="password" autocomplete="current-password" maxlength="100"><button type="button" class="linkbtn" data-eye="elPw">Voir</button></div></div>
    <p class="small" id="efErr" style="color:var(--warn)"></p>
    <button class="btn hero block" id="efGo">${EI.people}Me connecter</button>
    <p class="small" style="text-align:center">Pas encore de compte ? <button type="button" class="linkbtn" data-mode="signup">Créer mon compte</button></p>
    <p class="small" style="text-align:center">Mot de passe oublié ? <a href="mailto:pierre.rnrd04@gmail.com?subject=Traceo%20-%20mot%20de%20passe%20oubli%C3%A9" style="color:var(--accent)">Écris au support</a> depuis l'e-mail de ton compte.</p></form>`;
  const max = new Date(Date.now() - 15*365.25*864e5).toISOString().slice(0, 10);
  return ensPitch() + `<form class="ens-form" id="ensForm" novalidate><p class="title" style="font-size:22px">Crée ton compte Traceo</p>
    <p class="small" style="margin-top:-2px">Déjà inscrit ? <button type="button" class="linkbtn" data-mode="login">Me connecter</button></p>
    <div class="row2"><div class="field"><label for="efFirst">Prénom</label><input class="input" id="efFirst" autocomplete="given-name" maxlength="30"></div>
    <div class="field"><label for="efLast">Nom</label><input class="input" id="efLast" autocomplete="family-name" maxlength="40"></div></div>
    <div class="field"><label for="efPseudo">Identifiant (visible des autres coureurs)</label><div class="pw"><span class="at">@</span><input class="input" id="efPseudo" autocomplete="username" autocapitalize="none" maxlength="20" placeholder="ex. lea_run"></div><small id="efPs" class="small"></small></div>
    <div class="field"><label for="efMail">Adresse e-mail</label><input class="input" id="efMail" type="email" autocomplete="email" inputmode="email" maxlength="120"></div>
    <div class="field"><label for="efPw">Mot de passe (8 caractères minimum)</label><div class="pw"><input class="input" id="efPw" type="password" autocomplete="new-password" maxlength="100"><button type="button" class="linkbtn" data-eye="efPw">Voir</button></div></div>
    <div class="field"><label for="efBirth">Date de naissance</label><input class="input" id="efBirth" type="date" max="${max}" min="1900-01-01"></div>
    <div class="field"><label>Niveau</label><div class="seg" id="efLvl">${Object.entries(LVL).map(([k, v]) => `<button type="button" data-lvl="${k}" aria-pressed="${k === "regulier"}">${v}</button>`).join("")}</div></div>
    <p class="small">Les autres coureurs voient ton identifiant, ton prénom, l'initiale de ton nom, ton niveau, ton allure (${paceTxt(S.pace)}/km) et une distance arrondie. Jamais ton e-mail, ta date de naissance ni ton adresse.</p>
    <label class="ens-ck"><input type="checkbox" id="efTerms"><span>J'ai 15 ans ou plus et j'accepte les <a href="legal.html#ensemble" target="_blank" rel="noopener">règles de la communauté et la politique de confidentialité</a>.</span></label>
    <p class="small" id="efErr" style="color:var(--warn)"></p>
    <button class="btn hero block" id="efGo">${EI.people}Créer mon compte</button></form>`;
}
function ensThread(peer){
  const u = ENS.users[peer] || (ENS.near?.list || []).find(x => x.id === peer) || {name:"Coureur"}, me = ENS.me?.id;
  const list = ENS.msgs.filter(m => m.from === peer || m.to === peer);
  const answered = new Set(list.filter(m => m.from === me && (m.kind === "accept" || m.kind === "decline")).map(m => m.meta?.ref || 0));
  return `<div class="ens-th-h"><button class="iconbtn" id="ensBack" aria-label="Retour">${EI.back}</button><span class="ens-av" style="--c:${avColor(peer)}">${initials(u.name)}</span><span class="b"><b>${esc(u.name)}</b><small>${u.pseudo ? "@" + esc(u.pseudo) + " · " : ""}${LVL[u.level] || ""}${u.pace ? " · " + paceTxt(u.pace) + "/km" : ""}</small></span><button class="iconbtn" id="ensMore" aria-label="Options">${EI.more}</button></div>
    <div class="chat-list ens-th" id="ensList">${list.length ? "" : `<p class="small" style="text-align:center">Dis bonjour ou propose directement une course !</p>`}${list.map(m => { const mine = m.from === me, mm = m.meta || {};
      if(m.kind === "invite" || m.kind === "shout") return `<div class="ens-inv ${mine ? "mine" : ""}"><b>${m.kind === "shout" ? "📣 Part courir" : "🏃 Invitation à courir"}</b><span>${esc(m.body)}</span>${mm.when || mm.km || mm.place ? `<small>${[mm.when && esc(mm.when), mm.km && nf(0).format(mm.km) + " km", mm.place && "📍 " + esc(mm.place)].filter(Boolean).join(" · ")}</small>` : ""}
        ${!mine && !answered.has(m.id) ? `<span class="row"><button class="btn hero sm" data-ensyes="${m.id}">${m.kind === "shout" ? "Je viens !" : "J'accepte"}</button><button class="btn soft sm" data-ensno="${m.id}">Pas dispo</button></span>` : ""}<em>${hhmm(m.t)}</em></div>`;
      if(m.kind === "accept" || m.kind === "decline") return `<div class="msg ${mine ? "msg-u" : "msg-b"} ens-ans">${m.kind === "accept" ? "✅ " : ""}${esc(m.body)}</div>`;
      return `<div class="msg ${mine ? "msg-u" : "msg-b"}">${esc(m.body)}<em class="ens-t">${hhmm(m.t)}</em></div>`; }).join("")}</div>
    <div class="chat-sugg">${["Salut ! On court ensemble ?", "Tu cours à quelle heure ?", "On se retrouve où ?", "Ok pour moi 👍"].map(x => `<button class="chip" data-enssg="${esc(x)}">${esc(x)}</button>`).join("")}</div>
    <form class="chat-form" id="ensForm2"><button type="button" class="btn soft" id="ensInv2" aria-label="Proposer une course">${EI.run}</button><input id="ensIn" class="input" placeholder="Écris un message…" autocomplete="off" enterkeyhint="send" maxlength="500"><button class="btn hero" aria-label="Envoyer">${EI.send}</button></form>`;
}

/* ---------- Actions ---------- */
async function ensSend(to, kind, text, extra = {}){
  try{
    const j = await ensCall("send", {to, kind, body:text, ...extra});
    ENS.msgs.push({id:j.id, from:ENS.me.id, to, t:Date.now(), kind, body:text, meta:kind === "invite" ? {when:extra.when, km:extra.km, place:extra.place} : extra.ref ? {ref:extra.ref} : null});
    store.set("ensMsgs", ENS.msgs); track("ensemble_message", {type:kind});
    if(!ENS.users[to]){ const u = (ENS.near?.list || []).find(x => x.id === to); if(u){ ENS.users[to] = u; store.set("ensUsers", ENS.users); } }
    return true;
  }catch(e){ toast(e.message === "rate_limited" ? "Doucement : réessaie dans quelques minutes." : e.message === "blocked" ? "Ce coureur n'est plus joignable." : "Message non envoyé, vérifie ta connexion."); return false; }
}
function ensInviteModal(to){
  const u = ENS.users[to] || (ENS.near?.list || []).find(x => x.id === to) || {name:"ce coureur"};
  const whens = ["Maintenant", "Dans 30 min", "Ce soir", "Demain matin", "Demain soir", "Ce week-end"];
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Proposer une course</p><p class="title" style="font-size:22px">Courir avec ${esc(u.name)}</p>
    <div class="field"><label>Quand ?</label><div class="chips" id="eiWhen">${whens.map((w, i) => `<button class="chip" data-w="${w}" aria-pressed="${i === 2}">${w}</button>`).join("")}</div></div>
    <div class="field"><label for="eiKm">Distance</label><div class="pace" style="background:var(--surface-2);border-radius:14px;padding:8px"><button class="step" id="eiM">−</button><b class="title" style="font-size:24px" id="eiKmV">${S.distKm} km</b><button class="step" id="eiP">+</button></div></div>
    <div class="field"><label for="eiPlace">Point de rendez-vous</label><input class="input" id="eiPlace" maxlength="80" value="${esc(S.start?.label && !/choisi/.test(S.start.label) ? S.start.label.split(",")[0] : "")}" placeholder="ex. entrée du parc"></div>
    <div class="field"><label for="eiMsg">Message</label><input class="input" id="eiMsg" maxlength="300" value="Salut ! Ça te dit de courir ensemble ?"></div>
    <button class="btn hero block" id="eiGo">${EI.send}Envoyer l'invitation</button><p class="small">Retrouvez-vous dans un lieu public et fréquenté.</p>`);
  let km = S.distKm, when = whens[2];
  sheet.querySelectorAll("[data-w]").forEach(b => b.onclick = () => { when = b.dataset.w; sheet.querySelectorAll("[data-w]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  const upd = d => { km = Math.max(2, Math.min(42, km + d)); $("#eiKmV").textContent = km + " km"; };
  $("#eiM").onclick = () => upd(-1); $("#eiP").onclick = () => upd(1);
  $("#eiGo").onclick = async () => { $("#eiGo").disabled = true; if(await ensSend(to, "invite", $("#eiMsg").value.trim() || "On court ensemble ?", {when, km, place:$("#eiPlace").value.trim()})){ closeModal(); ENS.thread = to; markRead(to); render(); toast("Invitation envoyée !"); } else $("#eiGo").disabled = false; };
}
function ensGoModal(){
  if(!ensHere()){ toast("Localise-toi d'abord."); go("plan"); locate(); return; }
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Je pars courir</p><p class="title" style="font-size:22px">Préviens les coureurs proches</p>
    <p class="muted">Les coureurs visibles à moins de 5 km reçoivent une notification et peuvent te répondre.</p>
    <div class="field"><label>Départ</label><div class="chips" id="egWhen">${[["Maintenant", 0], ["Dans 15 min", 15], ["Dans 30 min", 30], ["Dans 1 h", 60]].map(([l, v], i) => `<button class="chip" data-in="${v}" aria-pressed="${i === 1}">${l}</button>`).join("")}</div></div>
    <div class="field"><label>Distance</label><div class="pace" style="background:var(--surface-2);border-radius:14px;padding:8px"><button class="step" id="egM">−</button><b class="title" style="font-size:24px" id="egKmV">${S.distKm} km</b><button class="step" id="egP">+</button></div></div>
    <div class="field"><label for="egNote">Lieu ou précision (facultatif)</label><input class="input" id="egNote" maxlength="100" placeholder="ex. départ devant la mairie, allure tranquille"></div>
    <button class="btn hero block" id="egGo">${EI.bell}Prévenir les coureurs</button>`);
  let inMin = 15, km = S.distKm;
  sheet.querySelectorAll("[data-in]").forEach(b => b.onclick = () => { inMin = +b.dataset.in; sheet.querySelectorAll("[data-in]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  const upd = d => { km = Math.max(2, Math.min(42, km + d)); $("#egKmV").textContent = km + " km"; };
  $("#egM").onclick = () => upd(-1); $("#egP").onclick = () => upd(1);
  $("#egGo").onclick = async () => {
    $("#egGo").disabled = true;
    try{
      const h = ensHere(); await ensCall("pos", {lat:h[0], lon:h[1]});
      const j = await ensCall("shout", {inMin, km, note:$("#egNote").value.trim()});
      ENS.me.avail_until = Date.now() + (inMin + 60)*60e3; store.set("ensMe", ENS.me); track("ensemble_depart", {n:j.notified});
      closeModal(); render(); celebrate(60);
      toast(j.cooldown ? "C'est noté ! (les coureurs ont déjà été prévenus il y a peu)" : j.notified ? `${j.notified} coureur${j.notified > 1 ? "s" : ""} prévenu${j.notified > 1 ? "s" : ""} autour de toi !` : "C'est noté ! Les coureurs qui arrivent près de toi te verront disponible.", 4500);
    }catch(e){ $("#egGo").disabled = false; toast("Impossible de prévenir les coureurs pour l'instant."); }
  };
}
function ensSafety(){
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Ensemble</p><p class="title" style="font-size:22px">Courir ensemble, en sécurité</p>
    <ul class="checks"><li>Donne rendez-vous dans un <b>lieu public et fréquenté</b>, de jour de préférence.</li><li>Préviens un proche : avec qui, où et à quelle heure.</li><li>Garde tes informations personnelles (adresse, numéro) jusqu'à ce que tu sois en confiance.</li><li>Ta position n'est jamais montrée exactement : seulement une distance arrondie.</li><li>Un comportement déplacé ? <b>Signale et bloque</b> depuis la conversation (bouton ⋯). Le signalement est transmis immédiatement.</li><li>Passe en <b>Invisible</b> quand tu veux.</li></ul><button class="btn hero block" data-close>Compris</button>`);
}
function ensAccount(){
  const me = ENS.me || {};
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Ensemble</p><p class="title" style="font-size:22px">Mon compte</p>
    <div class="row2"><div class="field"><label for="eaFirst">Prénom</label><input class="input" id="eaFirst" value="${esc(me.first || "")}" maxlength="30"></div><div class="field"><label for="eaLast">Nom</label><input class="input" id="eaLast" value="${esc(me.last || "")}" maxlength="40"></div></div>
    <div class="field"><label>Niveau</label><div class="seg" id="eaLvl">${Object.entries(LVL).map(([k, v]) => `<button type="button" data-lvl="${k}" aria-pressed="${k === me.level}">${v}</button>`).join("")}</div></div>
    <p class="small">Identifiant : <b>@${esc(me.pseudo || "")}</b> · E-mail : ${esc(me.email || "")}${me.birth ? " · Né·e le " + new Date(me.birth).toLocaleDateString("fr-FR") : ""} · Allure partagée : ${paceTxt(S.pace)}/km (modifiable dans Profil)</p>
    <label class="switch"><span><b>Notifications</b><br><span class="small">Invitations, messages et coureurs qui partent près de toi.</span></span><input type="checkbox" id="eaNotif" ${me.notif !== false ? "checked" : ""}></label>
    <button class="btn hero block" id="eaSave">Enregistrer</button>
    <div class="row"><button class="btn soft" id="eaOut">Se déconnecter</button><button class="btn soft" id="eaDel" style="color:var(--warn)">Supprimer mon compte</button></div>
    <details class="ens-pw"><summary>Changer mon mot de passe</summary><div class="field"><label for="eaOld">Mot de passe actuel</label><input class="input" id="eaOld" type="password" autocomplete="current-password"></div><div class="field"><label for="eaNew">Nouveau mot de passe</label><input class="input" id="eaNew" type="password" autocomplete="new-password"></div><button class="btn soft block" id="eaPw">Changer le mot de passe</button></details>
    <p class="small">Tu peux te reconnecter sur n'importe quel téléphone avec ton identifiant et ton mot de passe. La suppression efface définitivement ton profil et tes messages du serveur.</p>`);
  let lvl = me.level;
  sheet.querySelectorAll("[data-lvl]").forEach(b => b.onclick = () => { lvl = b.dataset.lvl; sheet.querySelectorAll("[data-lvl]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  $("#eaPw").onclick = async () => { const o = $("#eaOld").value, n = $("#eaNew").value; if(n.length < 8) return toast("Nouveau mot de passe : 8 caractères minimum."); try{ await ensCall("me", {oldKey:await pwKey(o), key:await pwKey(n)}); toast("Mot de passe changé."); $("#eaOld").value = $("#eaNew").value = ""; }catch(e){ toast(errTxt(e)); } };
  $("#eaSave").onclick = async () => { try{ const j = await ensCall("me", {first:$("#eaFirst").value, last:$("#eaLast").value, level:lvl, pace:S.pace, notif:$("#eaNotif").checked}); ENS.me = j.me; ensSaveAuth(); closeModal(); render(); toast("Compte mis à jour."); }catch(e){ toast("Enregistrement impossible pour l'instant."); } };
  $("#eaOut").onclick = async () => { try{ await ensCall("logout", {}); }catch(e){} ensLogout(); ENS.mode = "login"; closeModal(); render(); toast("Déconnecté. À bientôt !"); };
  $("#eaDel").onclick = async () => { if(!confirm("Supprimer définitivement ton compte Ensemble et tes messages ?")) return; try{ await ensCall("delete", {}); }catch(e){} ensLogout(); closeModal(); render(); toast("Compte supprimé."); };
}
function ensMoreModal(peer){
  const u = ENS.users[peer] || {name:"ce coureur"};
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="title" style="font-size:22px">${esc(u.name)}</p>
    <button class="btn soft block" id="emBlock">Bloquer</button>
    <div class="field"><label for="emWhy">Signaler un comportement (facultatif : précise)</label><input class="input" id="emWhy" maxlength="300" placeholder="ex. messages insultants"></div>
    <button class="btn soft block" id="emRep" style="color:var(--warn)">Signaler et bloquer</button>`);
  const done = msg => { ENS.msgs = ENS.msgs.filter(m => m.from !== peer && m.to !== peer); store.set("ensMsgs", ENS.msgs); ENS.thread = null; closeModal(); render(); toast(msg); };
  $("#emBlock").onclick = async () => { try{ await ensCall("block", {who:peer}); done("Coureur bloqué."); }catch(e){ toast("Action impossible pour l'instant."); } };
  $("#emRep").onclick = async () => { try{ await ensCall("report", {who:peer, why:$("#emWhy").value}); done("Merci, le signalement a été transmis. Coureur bloqué."); }catch(e){ toast("Action impossible pour l'instant."); } };
}
async function ensEnablePush(){
  try{
    if(isIOS && !standalone){ toast("Sur iPhone : ajoute Traceo à l'écran d'accueil (Partager › Sur l'écran d'accueil), puis ouvre-le depuis l'icône.", 6000); return; }
    const perm = await Notification.requestPermission(); if(perm !== "granted"){ toast("Notifications refusées : tu peux les autoriser dans les réglages du navigateur."); render(); return; }
    const reg = await navigator.serviceWorker.ready, {key} = await ensCall("vapid");
    const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:raw});
    const j = await ensCall("me", {push:sub.toJSON(), notif:true}); ENS.me = j.me; ensSaveAuth(); render(); toast("Notifications activées !"); track("ensemble_notifs");
  }catch(e){ report("push", e.message); toast("Notifications indisponibles sur ce navigateur."); }
}

function wireEnsemble(){
  const q = s => body.querySelector(s);
  q("#ensPrem") && (q("#ensPrem").onclick = () => { track("ensemble_premium"); go("premium"); });
  if(!ensOn() || !isPremium() || (!ENS.auth && !q("#ensForm") && !q("#ensLogin"))) return;
  body.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { ENS.mode = b.dataset.mode; render(); });
  body.querySelectorAll("[data-eye]").forEach(b => b.onclick = () => { const i = q("#" + b.dataset.eye); i.type = i.type === "password" ? "text" : "password"; b.textContent = i.type === "password" ? "Voir" : "Masquer"; });
  const done = (j, msg) => { ENS.auth = j.token; ENS.me = j.me; ENS.msgs = []; ENS.last = 0; ENS.first = true; ensSaveAuth(); ensSync(); render(); celebrate(120); toast(msg); ensNearby(); ensLoop(); ensPoll(); };
  if(q("#ensLogin")){
    q("#ensLogin").onsubmit = async e => {
      e.preventDefault(); const err = q("#efErr"), id = q("#elId").value.trim(), pw = q("#elPw").value;
      if(!id || !pw) return err.textContent = "Indique ton identifiant et ton mot de passe.";
      q("#efGo").disabled = true; err.textContent = "";
      try{ const j = await ensCall("login", {login:id, key:await pwKey(pw)}); track("ensemble_connexion"); done(j, `Content de te revoir, ${j.me.first} !`); }
      catch(x){ q("#efGo").disabled = false; err.textContent = errTxt(x); }
    };
    return;
  }
  if(q("#ensForm")){
    let lvl = "regulier", psT;
    body.querySelectorAll("#efLvl [data-lvl]").forEach(b => b.onclick = () => { lvl = b.dataset.lvl; body.querySelectorAll("#efLvl [data-lvl]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
    q("#efPseudo").oninput = () => { const v = q("#efPseudo").value = q("#efPseudo").value.toLowerCase().replace(/[^a-z0-9_.]/g, ""), ps = q("#efPs"); clearTimeout(psT);
      if(v.length < 3){ ps.textContent = v ? "3 caractères minimum" : ""; ps.style.color = ""; return; }
      psT = setTimeout(async () => { try{ const j = await ensCall("pseudo?p=" + encodeURIComponent(v)); if(q("#efPseudo")?.value !== v) return; ps.textContent = j.free ? "✓ Disponible" : "Déjà pris"; ps.style.color = j.free ? "var(--accent)" : "var(--warn)"; }catch(e){} }, 350); };
    q("#ensForm").onsubmit = async e => {
      e.preventDefault(); const err = q("#efErr"), f = q("#efFirst").value.trim(), l = q("#efLast").value.trim(), m = q("#efMail").value.trim(), ps = q("#efPseudo").value.trim(), pw = q("#efPw").value, bd = q("#efBirth").value;
      if(!f || !l) return err.textContent = "Indique ton prénom et ton nom.";
      if(!/^[a-z0-9][a-z0-9_.]{2,19}$/.test(ps)) return err.textContent = ERRS.bad_pseudo;
      if(!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(m)) return err.textContent = ERRS.bad_email;
      if(pw.length < 8) return err.textContent = "Mot de passe : 8 caractères minimum.";
      if(!bd) return err.textContent = "Indique ta date de naissance.";
      if((Date.now() - Date.parse(bd))/(365.25*864e5) < 15) return err.textContent = ERRS.too_young;
      if(!q("#efTerms").checked) return err.textContent = ERRS.consent_required;
      q("#efGo").disabled = true; err.textContent = "";
      try{
        const j = await ensCall("signup", {first:f, last:l, email:m, pseudo:ps, key:await pwKey(pw), birth:bd, level:lvl, pace:S.pace, terms:true, premium:paid()});
        track("ensemble_compte"); done(j, `Bienvenue dans la communauté, ${j.me.first} !`);
      }catch(x){ q("#efGo").disabled = false; err.textContent = errTxt(x); }
    };
    return;
  }
  if(ENS.thread){
    const L = q("#ensList"); if(L) L.scrollTop = L.scrollHeight; body.scrollTop = body.scrollHeight; markRead(ENS.thread);
    q("#ensBack").onclick = () => { ENS.thread = null; render(); ensNearby(); };
    q("#ensMore").onclick = () => ensMoreModal(ENS.thread);
    q("#ensInv2").onclick = () => ensInviteModal(ENS.thread);
    const sendTxt = async t => { if(!t) return; const peer = ENS.thread; if(await ensSend(peer, "msg", t)){ render(); } };
    q("#ensForm2").onsubmit = e => { e.preventDefault(); const v = q("#ensIn").value.trim(); q("#ensIn").value = ""; sendTxt(v); };
    body.querySelectorAll("[data-enssg]").forEach(b => b.onclick = () => sendTxt(b.dataset.enssg));
    body.querySelectorAll("[data-ensyes]").forEach(b => b.onclick = async () => { const ok = await ensSend(ENS.thread, "accept", "C'est d'accord, je viens !", {ref:+b.dataset.ensyes}); if(ok){ render(); celebrate(80); } });
    body.querySelectorAll("[data-ensno]").forEach(b => b.onclick = async () => { if(await ensSend(ENS.thread, "decline", "Pas dispo cette fois, une prochaine !", {ref:+b.dataset.ensno})) render(); });
    return;
  }
  q("#ensVis") && (q("#ensVis").onchange = async e => { try{ const j = await ensCall("me", {visible:e.target.checked}); ENS.me = j.me; ensSaveAuth(); render(); toast(j.me.visible ? "Tu es visible des coureurs proches." : "Tu es invisible : personne ne te voit."); }catch(x){ e.target.checked = !e.target.checked; toast("Réglage impossible pour l'instant."); } });
  q("#ensGo") && (q("#ensGo").onclick = ensGoModal);
  q("#ensStop") && (q("#ensStop").onclick = async () => { try{ await ensCall("shout", {cancel:true}); ENS.me.avail_until = 0; store.set("ensMe", ENS.me); render(); }catch(e){} });
  q("#ensPush") && (q("#ensPush").onclick = ensEnablePush);
  q("#ensLoc") && (q("#ensLoc").onclick = () => { go("plan"); locate(); });
  q("#ensShare") && (q("#ensShare").onclick = async () => { const url = location.origin + location.pathname.replace(/app\.html$/, ""), t = "Je cours avec Traceo : des boucles neuves dans ta ville, et on peut courir ensemble. Rejoins-moi !"; try{ if(navigator.share) await navigator.share({title:"Traceo", text:t, url}); else{ await navigator.clipboard.writeText(t + " " + url); toast("Lien copié !"); } }catch(e){} });
  q("#ensSafe") && (q("#ensSafe").onclick = ensSafety); q("#ensAcc") && (q("#ensAcc").onclick = ensAccount);
  body.querySelectorAll("[data-ensr]").forEach(b => b.onclick = () => { ENS.r = +b.dataset.ensr; store.set("ensR", ENS.r); ENS.near = null; render(); ensNearby(); });
  body.querySelectorAll("[data-ensinv]").forEach(b => b.onclick = () => ensInviteModal(b.dataset.ensinv));
  body.querySelectorAll("[data-ensmsg],[data-ensth]").forEach(b => b.onclick = () => { ENS.thread = b.dataset.ensmsg || b.dataset.ensth; render(); });
  if(ENS.near == null && ensHere()) ensNearby();
}
// Après une boucle : invitation à créer son compte (ou à trouver des partenaires)
function ensJoinCard(){
  if(!ensOn()) return "";
  return ENS.auth ? `<button class="ens-join" id="ensJoin"><span class="ens-ic sm">${EI.people}</span><span><b>Courir cette boucle à plusieurs ?</b><small>Vois qui court autour de toi et propose-leur une sortie.</small></span></button>`
    : `<button class="ens-join" id="ensJoin"><span class="ens-ic sm">${EI.people}</span><span><b>Rejoins la communauté Traceo</b><small>Crée ton compte : trouve des coureurs près de toi et programmez vos sorties.</small></span></button>`;
}
document.addEventListener("click", e => { if(e.target.closest?.("#ensJoin")){ track("ensemble_carte_boucle"); go("ensemble"); } });
// statut Premium et ville affichés dans la page d'administration
function ensSync(){ if(!ensOn() || !ENS.auth) return; const place = (S.start?.label || "").split(",").pop().replace(/\d{5}/, "").trim(); ensCall("me", {premium:paid(), place}).then(j => { ENS.me = j.me; store.set("ensMe", ENS.me); }).catch(() => {}); }
function ensOpen(){ if(ensOn() && ENS.auth){ ensPoll(); } }

// démarrage : relève des messages en arrière-plan, ouverture directe depuis une notification
if(ensOn() && ENS.auth){ ensSaveAuth(); ensLoop(); setTimeout(ensPoll, 2500); setTimeout(ensSync, 6000); }
setTimeout(ensBadge, 500);
if(/[?&]tab=ensemble\b/.test(location.search)) setTimeout(() => { hideGate?.(); go("ensemble"); }, 900);
navigator.serviceWorker?.addEventListener?.("message", e => { if(e.data === "ensemble"){ go("ensemble"); ensPoll(); } });
