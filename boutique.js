/* Traceo · Boutique du coureur (liens partenaires Amazon)
   - Tag Amazon Partenaires : TRACEO_CONFIG.AMAZON_TAG (ex. "traceo-21"). Vide : les liens marchent, sans commission.
   - Liens de recherche amazon.fr (jamais cassés, toujours à jour), aucun prix affiché (règle Amazon).
   - Mention « Partenaire Amazon » affichée discrètement, comme l'exigent Amazon et la loi française. */
(function(){
  const CFG = window.TRACEO_CONFIG || {};
  const TAG = String(CFG.AMAZON_TAG || "").trim();
  const DISC = "En tant que Partenaire Amazon, Traceo réalise un bénéfice sur les achats remplissant les conditions requises, sans surcoût pour toi.";
  const url = q => "https://www.amazon.fr/s?k=" + encodeURIComponent(q) + (TAG ? "&tag=" + encodeURIComponent(TAG) : "") + "&language=fr_FR";
  const e = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  // Catalogue : [id, emoji, titre, sous-titre, recherche amazon]
  const CATS = [
    ["Chaussures", [
      ["shoeH","👟","Chaussures de running homme","amorti route, tous niveaux","chaussures running homme amorti"],
      ["shoeF","👟","Chaussures de running femme","légères et confortables","chaussures running femme"],
      ["trail","⛰️","Chaussures de trail","accroche chemins et sentiers","chaussures trail running"],
      ["socks","🧦","Chaussettes de running","anti-ampoules, sans couture","chaussettes running anti ampoules"],
      ["insole","🦶","Semelles running","soutien de la voûte plantaire","semelles running sport"]]],
    ["Montres & audio", [
      ["watch","⌚","Montre GPS running","compatible Strava et GPX","montre gps running"],
      ["hrm","❤️","Ceinture cardio","fréquence cardiaque précise","ceinture cardio bluetooth running"],
      ["earbuds","🎧","Écouteurs de sport","tiennent en courant","écouteurs sport sans fil running"],
      ["bone","🎧","Écouteurs à conduction osseuse","tu entends la ville et le guidage","écouteurs conduction osseuse"],
      ["armband","📱","Brassard téléphone","pour suivre Traceo en courant","brassard téléphone running"],
      ["belt","🎒","Ceinture de running","téléphone, clés, gels","ceinture running téléphone"]]],
    ["Vêtements", [
      ["tee","👕","T-shirt technique","respirant, séchage rapide","t-shirt running homme respirant"],
      ["teeF","👚","Haut de running femme","léger et respirant","haut running femme"],
      ["tights","🩳","Collant / short de running","liberté de mouvement","collant running"],
      ["jacket","🧥","Veste coupe-vent","pluie fine et vent","veste coupe vent running"],
      ["cap","🧢","Casquette de running","soleil et pluie","casquette running"],
      ["gloves","🧤","Gants et bonnet","pour l'hiver","gants running tactiles"]]],
    ["Nuit & sécurité", [
      ["lamp","🔦","Lampe frontale","pour courir après 19 h","lampe frontale running rechargeable"],
      ["vest","🦺","Gilet réfléchissant","être vu des voitures","gilet réfléchissant running"],
      ["led","💡","Brassard LED","visible de loin","brassard led running"]]],
    ["Hydratation & énergie", [
      ["bottle","💧","Gourde souple","se range dans la main","gourde souple running"],
      ["hydro","🎒","Gilet d'hydratation","sorties longues et trail","gilet hydratation trail"],
      ["gel","⚡","Gels énergétiques","au-delà d'1 h de course","gel energetique running"],
      ["iso","🥤","Boisson isotonique","hydratation et sels minéraux","boisson isotonique poudre"],
      ["bar","🍫","Barres énergétiques","avant ou après la course","barres energetiques sport"],
      ["whey","🥛","Protéines de récupération","après les séances dures","proteine whey recuperation"]]],
    ["Récupération", [
      ["roller","🌀","Rouleau de massage","détend les mollets","rouleau massage foam roller"],
      ["gun","🔫","Pistolet de massage","récupération musculaire","pistolet de massage"],
      ["socksC","🧦","Chaussettes de compression","jambes légères","chaussettes compression running"],
      ["bands","🟢","Élastiques de renforcement","gainage et prévention","bandes elastiques musculation"],
      ["mat","🧘","Tapis d'étirement","routines du Coach","tapis yoga epais"],
      ["anti","🧴","Crème anti-frottements","fini les irritations","creme anti frottement sport"]]],
    ["Livres & cadeaux", [
      ["book","📘","Livres de running","plans et motivation","livre running entrainement"],
      ["frame","🖼️","Cadre pour ta boucle","imprime l'image Traceo de ta course","cadre photo 30x40"],
      ["medal","🏅","Porte-médailles","pour tes courses officielles","porte medailles running"]]]
  ];
  const ALL = {}; CATS.forEach(([, items]) => items.forEach(it => ALL[it[0]] = it));

  function go(id, from){
    const it = ALL[id]; if(!it) return;
    try{ typeof track === "function" && track("amazon_clic", {produit:id, depuis:from || ""}); }catch(err){}
    const u = url(it[4]);
    try{ if(typeof openExt === "function"){ openExt(u); return; } }catch(err){}
    window.open(u, "_blank", "noopener");
  }
  const row = (it, from) => `<button class="shop-it" data-shop="${it[0]}" data-from="${from}"><span class="shop-ic">${it[1]}</span><span class="shop-tx"><b>${e(it[2])}</b><small>${e(it[3])}</small></span><span class="shop-go">Voir ›</span></button>`;
  function wireShop(root){ (root || document).querySelectorAll("[data-shop]").forEach(b => { if(b._w) return; b._w = 1; b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); go(b.dataset.shop, b.dataset.from); }); });
    (root || document).querySelectorAll("[data-shopall]").forEach(b => { if(b._w) return; b._w = 1; b.addEventListener("click", ev => { ev.preventDefault(); openShop(); }); }); }
  const discHtml = `<p class="shop-disc">Liens partenaires Amazon · ${e(DISC)}</p>`;

  // Sélection contextuelle (heure, distance, saison)
  function picks(ctx){
    const h = new Date().getHours(), m = new Date().getMonth(), km = (ctx && ctx.km) || 0, p = [];
    if(h >= 18 || h < 7 || m >= 9 || m <= 1) p.push("lamp");
    if(km >= 10) p.push("gel", "hydro"); else if(km >= 6) p.push("bottle");
    if(m >= 10 || m <= 1) p.push("gloves", "jacket"); else if(m >= 5 && m <= 7) p.push("cap", "bottle");
    p.push("shoeH", "roller", "watch", "bone", "socks", "armband");
    const out = []; p.forEach(x => { if(!out.includes(x) && ALL[x]) out.push(x); });
    return out.slice(0, 3);
  }
  function card(ctx, from, title){
    return `<div class="shop-card" id="shop-${from}"><div class="shop-hd"><b>${e(title || "Équipement conseillé")}</b><button class="shop-all" data-shopall>Tout voir</button></div>${picks(ctx).map(id => row(ALL[id], from)).join("")}${discHtml}</div>`;
  }
  function openShop(){
    const h = `<button class="iconbtn x" data-close aria-label="Fermer"><svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <p class="title">Boutique du coureur</p><p class="muted">La sélection du Coach Traceo, livrée par Amazon.</p>
      ${CATS.map(([name, items]) => `<p class="shop-cat">${e(name)}</p>${items.map(it => row(it, "boutique")).join("")}`).join("")}${discHtml}`;
    try{ if(typeof openModal === "function"){ openModal(h); wireShop(document.getElementById("sheet")); try{ track("boutique_ouverte"); }catch(err){} return; } }catch(err){}
  }
  window.TraceoShop = {open:openShop, url, picks, go};

  // CSS
  const st = document.createElement("style");
  st.textContent = `.shop-card{flex-shrink:0;margin:14px 0 4px;padding:12px;border-radius:18px;background:var(--surface-2,#14222a);border:1px solid var(--line,#24343c)}
.shop-hd{display:flex;align-items:center;justify-content:space-between;margin:2px 4px 8px}.shop-hd b{font-size:15px}
.shop-all{background:none;border:0;color:var(--accent,#2be3a0);font-weight:800;font-size:14px;padding:6px 4px;cursor:pointer}
.shop-it{flex-shrink:0;display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:10px;margin:6px 0;border-radius:14px;border:1px solid var(--line,#24343c);background:var(--surface,#0f1b21);color:var(--ink,#fff);cursor:pointer;font:inherit}
.shop-it:active{transform:scale(.98)}.shop-ic{font-size:24px;width:40px;height:40px;display:grid;place-items:center;border-radius:12px;background:var(--surface-2,#14222a);flex:none}
.shop-tx{flex:1;min-width:0;display:flex;flex-direction:column}.shop-tx b{font-size:14.5px;line-height:1.25}.shop-tx small{font-size:12.5px;color:var(--muted,#8aa)}
.shop-go{font-weight:800;font-size:13px;color:var(--accent,#2be3a0);flex:none}
.shop-cat{margin:18px 4px 4px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#8aa)}
.shop-disc{margin:10px 4px 2px;font-size:10.5px;line-height:1.35;color:var(--muted,#8aa);opacity:.75}`;
  document.head.appendChild(st);

  // 1) Bilan de course : carte contextuelle sous les boutons
  try{
    if(typeof summary === "function"){
      const _summary = summary;
      summary = function(res, l){
        _summary.apply(this, arguments);
        try{ if(!res || !(res.dist > 50)) return; const sh = document.getElementById("sheet"); if(!sh || sh.querySelector("#shop-bilan")) return;
          sh.insertAdjacentHTML("beforeend", card({km:res.dist/1000}, "bilan", "Pour ta prochaine sortie")); wireShop(sh); }catch(err){}
      };
    }
  }catch(err){}
  // 2) Onglet Coach et 3) Profil : bloc boutique en bas
  function wrapView(name, from, title){
    try{
      const f = window[name]; if(typeof f !== "function") return;
      window[name] = function(){ let h = f.apply(this, arguments); try{ h += card({km:(window.S && S.distKm) || 0}, from, title); }catch(err){} return h; };
    }catch(err){}
  }
  wrapView("viewCoach", "coach", "L'équipement du Coach");
  wrapView("viewMe", "profil", "Boutique du coureur");
  // Câblage après chaque rendu (délégation, sans toucher au reste de l'app)
  document.addEventListener("click", ev => {
    const b = ev.target.closest && ev.target.closest("[data-shop],[data-shopall]"); if(!b || b._w) return;
    ev.preventDefault(); ev.stopPropagation();
    if(b.hasAttribute("data-shopall")) openShop(); else go(b.dataset.shop, b.dataset.from);
  }, true);
  try{ if(typeof render === "function" && window.S && (S.tab === "coach" || S.tab === "me")) render(); }catch(err){}
})();
