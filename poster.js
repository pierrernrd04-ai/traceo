/* Traceo · Poster de ta boucle (impression Printful)
   Parcours : bilan de course → « Commander en poster » → aperçu + format → paiement PayPal (adresse de livraison
   demandée par PayPal) → alerte privée au fondateur avec le lien du fichier HD (poster.html) à envoyer à Printful.
   Le tracé est normalisé (forme seule, sans coordonnées GPS) : aucune position n'est transmise. */
(function(){
  const C = window.TRACEO_CONFIG || {};
  const FORMATS = {"30x40":{label:"30 × 40 cm", w:30, h:40, price:(C.POSTER_PRICES || {})["30x40"] || "29.90"}, "50x70":{label:"50 × 70 cm", w:50, h:70, price:(C.POSTER_PRICES || {})["50x70"] || "44.90"}};
  const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
  const e = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const eur = p => String(p).replace(".", ",") + " €";

  // ---------- forme : simplification + normalisation (0..999), 2 caractères base 36 par coordonnée
  function simplify(pts, tol){
    if(pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while(st.length){ const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      for(let i = a + 1; i < b; i++){ const d = L < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs(dy*(pts[i][0] - ax) - dx*(pts[i][1] - ay))/L; if(d > md){ md = d; mi = i; } }
      if(md > tol && mi > 0){ keep[mi] = 1; st.push([a, mi], [mi, b]); } }
    return pts.filter((_, i) => keep[i]);
  }
  function encode(latlngs){
    const ok = (latlngs || []).filter(p => p && isFinite(p[0]) && isFinite(p[1])); if(ok.length < 2) return "";
    const lat0 = ok.reduce((s, p) => s + p[0], 0)/ok.length, k = Math.cos(lat0*Math.PI/180);
    let xy = ok.map(p => [p[1]*k, -p[0]]);
    const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]), minx = Math.min(...xs), miny = Math.min(...ys), span = Math.max(Math.max(...xs) - minx, Math.max(...ys) - miny) || 1e-9;
    xy = xy.map(p => [(p[0] - minx)/span, (p[1] - miny)/span]);
    let tol = .002, s = simplify(xy, tol); while(s.length > 110 && tol < .2){ tol *= 1.4; s = simplify(xy, tol); }
    return s.map(p => [Math.round(p[0]*999), Math.round(p[1]*999)]).map(([x, y]) => B36[Math.floor(x/36)] + B36[x%36] + B36[Math.floor(y/36)] + B36[y%36]).join("");
  }
  function decode(code){
    const out = []; for(let i = 0; i + 3 < (code || "").length; i += 4){ const v = j => B36.indexOf(code[i + j]); const x = v(0)*36 + v(1), y = v(2)*36 + v(3); if(x >= 0 && y >= 0) out.push([x/999, y/999]); } return out;
  }

  // ---------- rendu du poster (aperçu et fichier HD utilisent le même dessin)
  function draw(cv, d){
    const g = cv.getContext("2d"), W = cv.width, H = cv.height, u = W/1000;
    g.fillStyle = "#07131A"; g.fillRect(0, 0, W, H);
    const rg = g.createRadialGradient(W/2, H*.42, 10, W/2, H*.42, W*.9); rg.addColorStop(0, "rgba(31,200,168,.18)"); rg.addColorStop(1, "rgba(7,19,26,0)"); g.fillStyle = rg; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(70,198,255,.06)"; g.lineWidth = 1.5*u; for(let x = 0; x <= W; x += 50*u){ g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for(let y = 0; y <= H; y += 50*u){ g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const pts = d.pts || [], box = {x:110*u, y:120*u, w:780*u, h:H - 120*u - 470*u};
    if(pts.length > 1){
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), mnx = Math.min(...xs), mny = Math.min(...ys), sw = Math.max(...xs) - mnx || 1, sh = Math.max(...ys) - mny || 1;
      const sc = Math.min(box.w/sw, box.h/sh), ox = box.x + (box.w - sw*sc)/2, oy = box.y + (box.h - sh*sc)/2, P = p => [ox + (p[0] - mnx)*sc, oy + (p[1] - mny)*sc];
      g.lineCap = g.lineJoin = "round";
      [[34, "rgba(43,227,160,.10)"], [20, "rgba(43,227,160,.22)"], [10, "#2BE3A0"], [3.2, "#E9FFF6"]].forEach(([w, c]) => { g.strokeStyle = c; g.lineWidth = w*u; g.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); });
      const [sx, sy] = P(pts[0]); g.fillStyle = "#fff"; g.beginPath(); g.arc(sx, sy, 15*u, 0, 7); g.fill(); g.fillStyle = "#2BE3A0"; g.beginPath(); g.arc(sx, sy, 9*u, 0, 7); g.fill();
    }
    const F = '"Inter Display", Inter, system-ui, -apple-system, sans-serif';
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = "#2BE3A0"; g.font = `800 ${24*u}px ${F}`; g.fillText((d.date || "").toUpperCase(), 110*u, H - 380*u);
    let ts = 76; g.font = `900 ${ts*u}px ${F}`; while(g.measureText(d.title || "").width > 780*u && ts > 40){ ts -= 2; g.font = `900 ${ts*u}px ${F}`; }
    g.fillStyle = "#fff"; g.fillText(d.title || "Ma boucle Traceo", 110*u, H - 300*u);
    g.fillStyle = "rgba(255,255,255,.14)"; g.fillRect(110*u, H - 255*u, 780*u, 2*u);
    (d.stats || []).slice(0, 3).forEach((s, i) => { const x = 110*u + i*270*u; g.fillStyle = "#fff"; g.font = `900 ${50*u}px ${F}`; g.fillText(s[0], x, H - 170*u); g.fillStyle = "rgba(169,216,204,.85)"; g.font = `700 ${22*u}px ${F}`; g.fillText(String(s[1]).toUpperCase(), x, H - 132*u); });
    // logo + mot-symbole
    g.save(); g.translate(110*u, H - 92*u); g.scale(1.4*u, 1.4*u); g.strokeStyle = "#2BE3A0"; g.lineWidth = 3.6; g.lineCap = "round"; g.stroke(new Path2D("M7 23c0-8 5.5-14 11.5-14 4.6 0 7.5 2.9 7.5 6.6 0 3.8-3 6.6-6.8 6.6-2.8 0-4.7-1.9-4.7-4.2")); g.fillStyle = "#fff"; g.beginPath(); g.arc(7, 23, 3.8, 0, 7); g.fill(); g.restore();
    g.fillStyle = "#fff"; g.font = `900 ${34*u}px ${F}`; g.fillText("traceo", 165*u, H - 50*u);
    g.fillStyle = "rgba(169,216,204,.7)"; g.font = `600 ${20*u}px ${F}`; g.textAlign = "right"; g.fillText("Chaque sortie, de nouvelles rues.", 890*u, H - 52*u);
  }
  function canvasFor(fmt, longSide){ const f = FORMATS[fmt] || FORMATS["30x40"], c = document.createElement("canvas"); c.height = longSide; c.width = Math.round(longSide*f.w/f.h); return c; }

  // ---------- commande depuis l'app
  const ref = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  function base(){ const p = location.pathname.replace(/[^/]*$/, ""); return location.origin + p; }
  function orderUrl(r, fmt, code, title, stats, date){
    const q = new URLSearchParams({ref:r, f:fmt, c:code, t:title, d:date || "", s:(stats || []).map(s => s[0] + "~" + s[1]).join("|")});
    return base() + "poster.html?" + q.toString();
  }
  function paypalUrl(r, fmt, title){
    const f = FORMATS[fmt], back = base() + "app.html";
    const q = new URLSearchParams({cmd:"_xclick", business:C.PAYPAL_MERCHANT_ID || "", item_name:`Poster Traceo ${f.label} · ${String(title).slice(0, 40)}`, item_number:"POSTER-" + r, invoice:"POSTER-" + r,
      amount:f.price, currency_code:"EUR", no_shipping:"2", no_note:"1", custom:"poster." + r, lc:"FR", charset:"utf-8",
      return:back + "?poster=merci&ref=" + r, cancel_return:back + "?poster=annule"});
    return "https://www.paypal.com/cgi-bin/webscr?" + q.toString();
  }
  function notifyOwner(r, fmt, link){
    try{ if(!C.ALERTS_TOPIC || window.TRACEO_PREVIEW) return;
      fetch("https://ntfy.sh/" + C.ALERTS_TOPIC, {method:"POST", headers:{Title:"Commande de poster " + r, Priority:"high", Tags:"framed_picture", Click:link},
        body:`🖼️ Poster ${FORMATS[fmt].label} (${eur(FORMATS[fmt].price)}) · réf ${r}. Vérifie le paiement PayPal « POSTER-${r} » (adresse de livraison dedans), puis ouvre ce lien pour télécharger le fichier HD et commander sur Printful : ${link}`}).catch(() => {});
    }catch(err){}
  }
  function open(o){
    const code = encode(o.pts), pts = decode(code); if(pts.length < 2){ try{ toast("Pas assez de points GPS pour un poster."); }catch(err){} return; }
    let fmt = "30x40"; const title = o.title || "Ma boucle Traceo", date = new Date().toLocaleDateString("fr-FR", {day:"numeric", month:"long", year:"numeric"});
    const h = `<button class="iconbtn x" data-close aria-label="Fermer"><svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <p class="title">Ta boucle en poster</p><p class="muted">Imprimé par Printful sur papier mat épais, qualité musée. Livré chez toi.</p>
      <div class="pst-prev"><img id="pstImg" alt="Aperçu du poster"></div>
      <label class="pst-lab">Titre<input id="pstTitle" maxlength="40" value="${e(title)}"></label>
      <div class="pst-fmts">${Object.entries(FORMATS).map(([k, f]) => `<button class="pst-fmt" data-fmt="${k}" aria-pressed="${k === fmt}"><b>${f.label}</b><small>${eur(f.price)} · livraison incluse</small></button>`).join("")}</div>
      <button class="btn hero block" id="pstGo">Commander · <span id="pstPrice">${eur(FORMATS[fmt].price)}</span></button>
      <p class="pst-note">Paiement sécurisé PayPal (carte ou compte). Ton adresse de livraison est demandée au paiement. Fabrication et envoi sous 5 à 10 jours ouvrés. Le poster montre la forme de ta boucle, sans carte ni position.</p>`;
    try{ openModal(h); }catch(err){ return; }
    const sh = document.getElementById("sheet"), img = sh.querySelector("#pstImg"), cv = document.createElement("canvas"), ti = sh.querySelector("#pstTitle");
    const paint = () => { const f = FORMATS[fmt]; cv.width = 600; cv.height = Math.round(600*f.h/f.w); draw(cv, {pts, title:ti.value.trim() || title, date, stats:o.stats}); img.src = cv.toDataURL("image/jpeg", .9); };
    paint(); ti.addEventListener("input", paint);
    sh.querySelectorAll("[data-fmt]").forEach(b => b.addEventListener("click", () => { fmt = b.dataset.fmt; sh.querySelectorAll("[data-fmt]").forEach(x => x.setAttribute("aria-pressed", x === b)); sh.querySelector("#pstPrice").textContent = eur(FORMATS[fmt].price); paint(); }));
    sh.querySelector("#pstGo").addEventListener("click", () => {
      if(!C.PAYPAL_MERCHANT_ID){ try{ toast("Commande indisponible pour le moment."); }catch(err){} return; }
      const r = ref(), t = ti.value.trim() || title, link = orderUrl(r, fmt, code, t, o.stats, date);
      try{ localStorage.setItem("traceo2:poster:last", JSON.stringify({r, fmt, t, at:Date.now()})); }catch(err){}
      notifyOwner(r, fmt, link);
      try{ typeof track === "function" && track("poster_commande", {format:fmt, prix:FORMATS[fmt].price}); }catch(err){}
      const u = paypalUrl(r, fmt, t);
      try{ if(typeof openExt === "function"){ openExt(u); return; } }catch(err){}
      location.href = u;
    });
  }
  window.TraceoPoster = {encode, decode, draw, canvasFor, open, FORMATS, paypalUrl, orderUrl};
  if(!document.getElementById("sheet")) return;   // page poster.html : on s'arrête ici

  const st = document.createElement("style");
  st.textContent = `.pst-prev{flex-shrink:0;margin:14px auto 12px;max-width:300px;border-radius:14px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,.45),0 0 0 1px var(--line,#24343c)}.pst-prev img{display:block;width:100%;height:auto}
.pst-lab{flex-shrink:0;display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:700;color:var(--muted,#8aa);margin:4px 2px 12px}.pst-lab input{font:inherit;font-size:16px;font-weight:700;color:var(--ink,#fff);background:var(--surface-2,#14222a);border:1px solid var(--line,#24343c);border-radius:12px;padding:12px}
.pst-fmts{flex-shrink:0;display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}.pst-fmt{display:flex;flex-direction:column;gap:2px;padding:12px;border-radius:14px;border:1.5px solid var(--line,#24343c);background:var(--surface,#0f1b21);color:var(--ink,#fff);font:inherit;cursor:pointer;text-align:left}.pst-fmt small{color:var(--muted,#8aa);font-size:12px}.pst-fmt[aria-pressed="true"]{border-color:var(--accent,#2be3a0);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#2be3a0) 25%,transparent)}
.pst-note{font-size:11.5px;line-height:1.4;color:var(--muted,#8aa);margin:10px 2px 0}.pst-btn{margin-top:10px}`;
  document.head.appendChild(st);

  // bouton dans le bilan de course
  try{
    if(typeof summary === "function"){
      const _s = summary;
      summary = function(res, l){
        _s.apply(this, arguments);
        try{ if(!res || !(res.dist > 50) || !res.gps || res.gps.length < 2) return; const sh = document.getElementById("sheet"); if(!sh || sh.querySelector("#pstOpen")) return;
          const km = (res.dist/1000).toFixed(2).replace(".", ","), stats = [[km + " km", "distance"], [typeof hms === "function" ? hms(res.time) : "", "durée"], [typeof paceTxt === "function" ? paceTxt(res.pace) + "/km" : "", "allure"]];
          const b = document.createElement("button"); b.className = "btn soft block pst-btn"; b.id = "pstOpen"; b.innerHTML = "🖼️ Commander ta boucle en poster";
          const anchor = sh.querySelector("#shop-bilan"); anchor ? sh.insertBefore(b, anchor) : sh.appendChild(b);
          b.addEventListener("click", () => open({pts:res.gps.map(p => [p.lat, p.lng]), title:(l && l.name) || "Ma boucle Traceo", stats}));
        }catch(err){}
      };
    }
  }catch(err){}
  // retour de PayPal
  try{
    const q = new URLSearchParams(location.search);
    if(q.get("poster") === "merci") setTimeout(() => { try{ toast("Merci ! Ton poster part en fabrication. Tu reçois la confirmation PayPal par e-mail.", 6000); track("poster_paye", {ref:q.get("ref") || ""}); }catch(err){} }, 1500);
    if(q.get("poster") === "annule") setTimeout(() => { try{ toast("Commande de poster annulée."); }catch(err){} }, 1500);
  }catch(err){}
})();
