"use strict";
/* =========================================================================
   Traceo — une boucle de course nouvelle à chaque sortie, depuis là où tu es.
   ========================================================================= */
const C = window.TRACEO_CONFIG;
const PV = window.TRACEO_PREVIEW || null;             // aperçu dans Claude (carte et GPS simulés)
const FRANCE = [[41.3, -5.3], [51.15, 9.7]];
const TERR = ["fr","gp","mq","gf","re","yt","pm","bl","mf","wf","pf","nc","tf"];
const OUTREMER = [
  ["Corse", 42.15, 9.1, 8], ["Guadeloupe", 16.2, -61.55, 9], ["Martinique", 14.64, -61.02, 10], ["Guyane", 4.4, -53.0, 7],
  ["La Réunion", -21.13, 55.53, 10], ["Mayotte", -12.82, 45.15, 11], ["Saint-Pierre-et-Miquelon", 46.95, -56.3, 10],
  ["Saint-Barthélemy", 17.9, -62.83, 13], ["Saint-Martin", 18.07, -63.06, 12], ["Nouvelle-Calédonie", -21.3, 165.6, 7],
  ["Tahiti", -17.65, -149.45, 10], ["Wallis-et-Futuna", -13.28, -176.2, 11], ["Île de Ré", 46.2, -1.42, 11],
  ["Île d'Oléron", 45.93, -1.3, 10], ["Belle-Île-en-Mer", 47.33, -3.18, 11], ["Île d'Yeu", 46.71, -2.34, 12], ["Noirmoutier", 46.99, -2.25, 11]
];

/* ---------- Mémoire du téléphone ---------- */
const store = {
  get(k, d){ try{ const v = localStorage.getItem("traceo2:" + k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem("traceo2:" + k, JSON.stringify(v)); }catch(e){ toast("Mémoire du téléphone pleine : donnée non gardée."); } }
};
const S = {
  tab:"plan", view:"form",                       // form | loading | result
  mode:store.get("mode", "dist"), distKm:store.get("distKm", 8), durMin:store.get("durMin", 45),
  pace:store.get("pace", C.DEFAULT_PACE_S_PER_KM), weight:store.get("weight", C.DEFAULT_WEIGHT_KG), voice:store.get("voice", true),
  start:null, locating:false,
  loops:store.get("loops", []),                  // boucles générées (et courues)
  week:store.get("week", {key:"", n:0}),
  premium:store.get("premium", null),            // {until, via, id}
  demo:store.get("demo", false),
  results:null, sel:0, loopId:null, favOnly:false
};
const isPremium = () => !!C.BETA || (PV && S.demo) || !!(S.premium && (!S.premium.until || S.premium.until > Date.now()));

/* ---------- Outils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nf = d => new Intl.NumberFormat("fr-FR", {minimumFractionDigits:d, maximumFractionDigits:d});
const km1 = m => nf(1).format(m/1000), km2 = m => nf(2).format(m/1000);
function hms(s){ s = Math.max(0, Math.round(s)); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60; return h ? `${h}:${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}` : `${m}:${String(x).padStart(2,"0")}`; }
function hmin(s){ s = Math.round(s/60); const h = Math.floor(s/60), m = s%60; return h ? `${h} h ${String(m).padStart(2,"0")}` : `${m} min`; }
function paceTxt(p){ if(!isFinite(p) || p <= 0 || p > 1800) return "–'––"; const m = Math.floor(p/60), s = Math.round(p%60); return `${m}'${String(s === 60 ? 59 : s).padStart(2,"0")}`; }
const kcal = m => Math.round(S.weight * (m/1000) * 1.036);
const targetM = () => S.mode === "dist" ? S.distKm*1000 : S.durMin*60/S.pace*1000;
let toastT;
function toast(msg, ms = 3000){ const t = $("#toast"); t.hidden = true; void t.offsetWidth; t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }
function weekKey(){ const d = new Date(), t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + "-" + Math.ceil(((t - y)/864e5 + 1)/7); }
function remaining(){ if(S.week.key !== weekKey()){ S.week = {key:weekKey(), n:0}; store.set("week", S.week); } return Math.max(0, C.FREE_PER_WEEK - S.week.n); }
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const NATIVE = window.TRACEO_NATIVE || null;          // app Android / iOS (Capacitor), voir native.js
const standalone = !!NATIVE || matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isDark = () => true; // charte volontairement sombre
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
async function fetchJSON(url, opt = {}, ms = 12000){
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  if(opt.signal){ if(opt.signal.aborted) ac.abort(); else opt.signal.addEventListener("abort", () => ac.abort(), {once:true}); }
  try{ const r = await fetch(url, {...opt, signal:ac.signal}); if(!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  finally{ clearTimeout(t); }
}

/* ---------- Géométrie ---------- */
const RAD = d => d*Math.PI/180, DEG = r => r*180/Math.PI, RE = 6371008.8;
function dist(a, b){ const dLa = RAD(b[0]-a[0]), dLo = RAD(b[1]-a[1]); const h = Math.sin(dLa/2)**2 + Math.cos(RAD(a[0]))*Math.cos(RAD(b[0]))*Math.sin(dLo/2)**2; return 2*RE*Math.asin(Math.sqrt(h)); }
function lineLen(p){ let L = 0; for(let i = 1; i < p.length; i++) L += dist(p[i-1], p[i]); return L; }
function dest(p, brg, d){ const la = RAD(p[0]), lo = RAD(p[1]), b = RAD(brg), r = d/RE; const la2 = Math.asin(Math.sin(la)*Math.cos(r) + Math.cos(la)*Math.sin(r)*Math.cos(b)); const lo2 = lo + Math.atan2(Math.sin(b)*Math.sin(r)*Math.cos(la), Math.cos(r) - Math.sin(la)*Math.sin(la2)); return [DEG(la2), DEG(lo2)]; }
function bearing(a, b){ const y = Math.sin(RAD(b[1]-a[1]))*Math.cos(RAD(b[0])), x = Math.cos(RAD(a[0]))*Math.sin(RAD(b[0])) - Math.sin(RAD(a[0]))*Math.cos(RAD(b[0]))*Math.cos(RAD(b[1]-a[1])); return (DEG(Math.atan2(y, x)) + 360) % 360; }
const r6 = v => Math.round(v*1e6)/1e6;
// Mémoire des rues déjà proposées (cellules de 25 m)
const CELL = 25, KX = Math.cos(RAD(46.5))*111320, KY = 110540;
const cellOf = (la, lo) => Math.floor(lo*KX/CELL) + ":" + Math.floor(la*KY/CELL);
function cellsOf(pts){ const s = new Set(); for(let i = 1; i < pts.length; i++){ const a = pts[i-1], b = pts[i], n = Math.max(1, Math.ceil(dist(a, b)/12)); for(let k = 0; k < n; k++){ const f = k/n; s.add(cellOf(a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f)); } } return s; }
let memory = new Set();
function rebuildMemory(){ memory = new Set(); for(const l of S.loops) for(const c of cellsOf(l.pts)) memory.add(c); }
function seenNear(la, lo){ const cx = Math.floor(lo*KX/CELL), cy = Math.floor(la*KY/CELL); for(let i = -1; i <= 1; i++) for(let j = -1; j <= 1; j++) if(memory.has((cx+i)+":"+(cy+j))) return true; return false; }
function newLen(pts){ let n = 0; for(let i = 1; i < pts.length; i++){ const a = pts[i-1], b = pts[i]; if(!seenNear((a[0]+b[0])/2, (a[1]+b[1])/2)) n += dist(a, b); } return n; }
function repeatLen(pts){ const seen = new Set(); let r = 0; for(let i = 1; i < pts.length; i++){ const a = pts[i-1], b = pts[i], k = cellOf((a[0]+b[0])/2, (a[1]+b[1])/2); if(seen.has(k)) r += dist(a, b); else seen.add(k); } return r; }

/* ---------- Carte ---------- */
const GOOGLE_DARK = [{stylers:[{saturation:-30}]},{elementType:"geometry",stylers:[{color:"#0b1a20"}]},{elementType:"labels.text.fill",stylers:[{color:"#9fb7b5"}]},{elementType:"labels.text.stroke",stylers:[{color:"#07131a"}]},{featureType:"road",elementType:"geometry",stylers:[{color:"#1d3640"}]},{featureType:"road.arterial",elementType:"geometry",stylers:[{color:"#24434e"}]},{featureType:"road.highway",elementType:"geometry",stylers:[{color:"#2c5260"}]},{featureType:"water",elementType:"geometry",stylers:[{color:"#06283a"}]},{featureType:"poi.park",elementType:"geometry",stylers:[{color:"#0f3328"}]},{featureType:"poi",elementType:"labels.icon",stylers:[{visibility:"off"}]}];
const map = L.map("map", {zoomControl:false, minZoom:3, worldCopyJump:true}).fitBounds(FRANCE);
// Pendant un geste (pincer, glisser), la caméra ne suit plus : la carte ne « glisse » plus sous les doigts
let gesture = false;
map.getContainer().addEventListener("touchstart", e => { if(e.touches.length > 1) gesture = true; }, {passive:true});
map.getContainer().addEventListener("touchend", e => { if(e.touches.length === 0) setTimeout(() => gesture = false, 250); }, {passive:true});
map.on("zoomstart", () => gesture = true); map.on("zoomend", () => setTimeout(() => gesture = false, 250));
// En mode suivi (visite ou course), le zoom se fait autour du centre : le coureur reste au milieu
function followMode(on){ const v = on ? "center" : true; map.options.touchZoom = v; map.options.scrollWheelZoom = v; map.options.doubleClickZoom = v; }
map.attributionControl.setPrefix(false); map.attributionControl.setPosition("bottomleft");
// Pont Leaflet ↔ MapLibre : la carte vectorielle MapLibre sert de fond, Leaflet garde tracés, marqueurs et gestes
const TraceoGL = window.L && L.Layer ? L.Layer.extend({
  initialize(o){ this.o = o; },
  onAdd(m){
    this._c = L.DomUtil.create("div", "leaflet-layer traceo-gl"); this._c.style.cssText = "position:absolute;pointer-events:none;opacity:0;transition:opacity .6s ease";
    m.getPane("tilePane").appendChild(this._c); const s = m.getSize(); this._c.style.width = s.x + "px"; this._c.style.height = s.y + "px";
    const c = m.getCenter();
    this._gl = new maplibregl.Map({container:this._c, style:this.o.style, interactive:false, attributionControl:false, center:[c.lng, c.lat], zoom:m.getZoom() - 1, fadeDuration:0});
    // Icônes absentes du style (ex. « circle-11 ») : image vide plutôt qu'une erreur en console
    this._gl.once("load", () => { this._c.style.opacity = 1; });
    setTimeout(() => { if(this._c) this._c.style.opacity = 1; }, 4000);
    this._gl.on("styleimagemissing", e => { if(!this._gl.hasImage(e.id)) this._gl.addImage(e.id, {width:1, height:1, data:new Uint8Array(4)}); });
    m.on("move zoom moveend zoomend viewreset", this._up, this); m.on("resize", this._rs, this); m.on("zoomanim", this._anim, this);
    if(m.attributionControl && this.o.attribution) m.attributionControl.addAttribution(this.o.attribution);
    this._up();
  },
  onRemove(m){
    m.off("move zoom moveend zoomend viewreset", this._up, this); m.off("resize", this._rs, this); m.off("zoomanim", this._anim, this);
    if(m.attributionControl && this.o.attribution) m.attributionControl.removeAttribution(this.o.attribution);
    try{ this._gl.remove(); }catch(e){} this._c.remove();
  },
  getMaplibreMap(){ return this._gl; },
  _rs(){ const s = this._map.getSize(); this._c.style.width = s.x + "px"; this._c.style.height = s.y + "px"; this._gl.resize(); this._up(); },
  _up(){ const m = this._map; if(!m || !this._gl) return; this._off = m.containerPointToLayerPoint([0, 0]); L.DomUtil.setPosition(this._c, this._off); const c = m.getCenter(); this._gl.jumpTo({center:[c.lng, c.lat], zoom:m.getZoom() - 1}); },
  _anim(e){ const m = this._map, sc = m.getZoomScale(e.zoom), off = m._latLngBoundsToNewLayerBounds(m.getBounds(), e.zoom, e.center).min; L.DomUtil.setTransform(this._c, off.subtract(this._off).add(this._off), sc); }
}) : null;
let tileUrl = null, base = null;
async function setBase(){
  if(base) map.removeLayer(base);
  if(PV){ const p = PV.baseLayer(); tileUrl = p.tileUrl; base = p.layer.addTo(map); return; }
  if(C.GOOGLE_MAPS_KEY){
    try{
      const j = await fetchJSON(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(C.GOOGLE_MAPS_KEY)}`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({mapType:"roadmap", language:"fr-FR", region:"FR", styles:GOOGLE_DARK})});
      const u = `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${j.session}&key=${encodeURIComponent(C.GOOGLE_MAPS_KEY)}`;
      tileUrl = (z, x, y) => u.replace("{z}", z).replace("{x}", x).replace("{y}", y);
      base = L.tileLayer(u, {maxZoom:21, attribution:"Données cartographiques © Google"}).addTo(map); return;
    }catch(e){ console.warn("Google Map Tiles indisponible", e); }
  }
  const style = isDark() ? "dark_all" : "rastertiles/voyager";
  // Fond principal : carte vectorielle MapLibre (OpenFreeMap, gratuit, sans clé, usage commercial autorisé), aux couleurs de Traceo
  if(window.maplibregl && TraceoGL && C.MAP_STYLE !== "raster"){
    try{
      const sup = maplibregl.supported ? maplibregl.supported() : true;
      if(sup){
        tileUrl = (z, x, y) => `https://${"abcd"[(x+y)%4]}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}@2x.png`;  // pour l'affiche et le hors-ligne
        const styleUrl = C.MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark";
        const st = await traceoStyleJSON(styleUrl).catch(() => styleUrl);
        base = new TraceoGL({style:st, attribution:'© <a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
        return;
      }
    }catch(e){ console.warn("MapLibre indisponible, carte raster", e); }
  }
  tileUrl = (z, x, y) => `https://${"abcd"[(x+y)%4]}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}@2x.png`;
  base = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {subdomains:"abcd", maxZoom:20, crossOrigin:true, attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>'}).addTo(map);
}
// Style de carte « Traceo nuit » : le style OpenFreeMap est retravaillé AVANT affichage (pas de flash),
// noms en français, eau et parcs bien lisibles, routes hiérarchisées, plus aucun pictogramme parasite.
const MAP_PAL = {bg:"#050F15", resid:"#07141B", wood:"#0A2A1F", park:"#0D3627", water:"#0A3D52", waterway:"#0E4A60", building:"#0C1C25", buildingLine:"#14303B",
  path:"#1C3943", minor:"#14303A", major:"#1E4352", majorCase:"#061016", motor:"#27525F", motorCase:"#050D12", rail:"#1A2F38", border:"#2D5866"};
const FR_NAME = ["coalesce", ["get", "name:fr"], ["get", "name:latin"], ["get", "name"]];
let styleCache = null;
async function traceoStyleJSON(url){
  if(styleCache) return JSON.parse(styleCache);
  const st = await fetchJSON(url, {}, 10000), P = MAP_PAL;
  st.layers = st.layers.filter(l => !/^road_oneway|^aeroway-taxiway$/.test(l.id)).map(l => {
    const id = l.id, pt = l.paint = l.paint || {}, ly = l.layout = l.layout || {};
    if(l.type === "background") pt["background-color"] = P.bg;
    else if(id === "water") pt["fill-color"] = P.water;
    else if(id === "waterway") pt["line-color"] = P.waterway;
    else if(id === "landuse_residential"){ pt["fill-color"] = P.resid; pt["fill-opacity"] = 1; }
    else if(id === "landcover_wood"){ pt["fill-color"] = P.wood; pt["fill-opacity"] = .9; }
    else if(id === "landuse_park"){ pt["fill-color"] = P.park; pt["fill-opacity"] = .95; }
    else if(/glacier|ice_shelf/.test(id)) pt["fill-color"] = "#0E2530";
    else if(id === "building"){ pt["fill-color"] = P.building; pt["fill-outline-color"] = P.buildingLine; pt["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 13, 0, 15, 1]; }
    else if(/^aeroway/.test(id)) (l.type === "fill" ? pt["fill-color"] = "#0B1A22" : pt["line-color"] = "#14262E");
    else if(id === "highway_path"){ pt["line-color"] = P.path; pt["line-dasharray"] = [1.5, 1.5]; }
    else if(id === "highway_minor") pt["line-color"] = P.minor;
    else if(/major_casing/.test(id)) pt["line-color"] = P.majorCase;
    else if(/major_(inner|subtle)/.test(id)) pt["line-color"] = P.major;
    else if(/motorway_casing/.test(id)) pt["line-color"] = P.motorCase;
    else if(/motorway_(inner|subtle)/.test(id)) pt["line-color"] = P.motor;
    else if(/pier/.test(id)) (l.type === "fill" ? pt["fill-color"] = P.minor : pt["line-color"] = P.minor);
    else if(/^railway/.test(id)) pt["line-color"] = P.rail;
    else if(/^boundary/.test(id)){ pt["line-color"] = P.border; pt["line-opacity"] = .8; }
    if(l.type === "symbol"){
      if(ly["text-field"] && !/motorway/.test(id)) ly["text-field"] = FR_NAME;
      delete ly["icon-image"]; pt["icon-opacity"] = 0;
      pt["text-halo-color"] = P.bg; pt["text-halo-width"] = 1.6; pt["text-halo-blur"] = .5;
      if(id === "water_name"){ pt["text-color"] = "#4B97AE"; ly["text-font"] = ["Noto Sans Italic"]; }
      else if(/highway_name/.test(id)){ pt["text-color"] = "#8DB1B0"; ly["text-font"] = ["Noto Sans Regular"]; }
      else if(/place_city|place_country|place_state/.test(id)){ pt["text-color"] = /country/.test(id) ? "#7FE3C3" : "#EAF5F3"; ly["text-font"] = ["Noto Sans Bold"]; if(/country|state/.test(id)){ ly["text-transform"] = "uppercase"; ly["text-letter-spacing"] = .12; } }
      else if(id === "place_town"){ pt["text-color"] = "#D3E4E2"; ly["text-font"] = ["Noto Sans Bold"]; }
      else if(/place_(village|suburb|other)/.test(id)){ pt["text-color"] = "#8AA4A3"; if(id === "place_suburb"){ ly["text-transform"] = "uppercase"; ly["text-letter-spacing"] = .1; } }
      // texte centré sur le point, l'icône (rond) ayant disparu
      if(/^place_(town|city|village)/.test(id)){ ly["text-anchor"] = "center"; ly["text-offset"] = [0, 0]; }
    }
    return l;
  });
  styleCache = JSON.stringify(st);
  return st;
}
setBase();
try{ matchMedia("(prefers-color-scheme: dark)").addEventListener("change", setBase); }catch(e){}
const routeLayer = L.layerGroup().addTo(map), liveLayer = L.layerGroup().addTo(map);
let meMk = null, accC = null, startMk = null;
function showMe(la, lo, acc){
  if(!meMk) meMk = L.marker([la, lo], {icon:L.divIcon({className:"", html:'<div class="me"><i></i></div>', iconSize:[24,24], iconAnchor:[12,12]}), interactive:false, zIndexOffset:1000}).addTo(map); else meMk.setLatLng([la, lo]);
  if(acc){ if(!accC) accC = L.circle([la, lo], {radius:acc, color:cssv("--blue"), weight:1, opacity:.35, fillOpacity:.08, interactive:false}).addTo(map); else accC.setLatLng([la, lo]).setRadius(acc); }
}
function setStart(s, fly = true){
  S.start = s; S.results = null; S.view = "form"; routeLayer.clearLayers();
  document.querySelector(".hint")?.remove();
  if(startMk){ map.removeLayer(startMk); startMk = null; }
  startMk = L.marker([s.lat, s.lng], {icon:L.divIcon({className:"", html:'<div class="pin"><span>GO</span></div>', iconSize:[40,40], iconAnchor:[4,40]}), zIndexOffset:900}).addTo(map);
  if(fly) map.flyTo([s.lat, s.lng], s.city ? 15 : 16, {duration:1.3});
  setTimeout(() => saveCityMap(s), 2500);
  if(S.tab === "plan") render();
}
map.on("contextmenu", e => { setStart({lat:r6(e.latlng.lat), lng:r6(e.latlng.lng), label:"Point choisi sur la carte"}, false); reverseLabel(false); toast("Départ placé ici."); });

const panel = $("#panel"), body = $("#panelBody");
function syncH(){ document.documentElement.style.setProperty("--panel-h", (document.body.classList.contains("run-on") ? 0 : panel.offsetHeight) + "px"); const h = $("#hud"); if(!h.hidden) document.documentElement.style.setProperty("--hud-h", h.offsetHeight + "px"); }
new ResizeObserver(syncH).observe(panel); new ResizeObserver(syncH).observe($("#hud"));
const pad = () => ({paddingTopLeft:[24, 140], paddingBottomRight:[80, (document.body.classList.contains("run-on") ? $("#hud").offsetHeight : panel.offsetHeight) + 80]});

/* ---------- Localisation ---------- */
let watchMe = null;
function locate(){
  if(run.active){ run.follow = true; if(run.last) map.setView(run.last, 17); return; }
  if(!("geolocation" in navigator)){ toast("Ce navigateur ne donne pas la position. Tape ton adresse en haut."); return; }
  if(!isSecureContext && !NATIVE){ toast("La localisation exige une adresse https."); return; }
  const fab = $("#fabLocate"); fab.classList.add("busy"); S.locating = true; if(S.tab === "plan" && S.view === "form") render();
  navigator.geolocation.getCurrentPosition(p => {
    fab.classList.remove("busy"); fab.classList.add("done"); S.locating = false;
    const {latitude:la, longitude:lo, accuracy:acc} = p.coords;
    showMe(la, lo, acc);
    setStart({lat:r6(la), lng:r6(lo), label:"Ta position", here:true, acc:Math.round(acc)});
    reverseLabel(true); closeModal();
    if(watchMe == null) watchMe = navigator.geolocation.watchPosition(q => { if(!run.active) showMe(q.coords.latitude, q.coords.longitude, q.coords.accuracy); }, () => {}, {enableHighAccuracy:true, maximumAge:15000});
  }, err => {
    fab.classList.remove("busy"); S.locating = false; if(S.tab === "plan") render();
    if(err.code === 1) permissionHelp(); else toast("Position introuvable pour l'instant. Réessaie, ou tape ton adresse en haut.", 4500);
  }, {enableHighAccuracy:true, timeout:15000, maximumAge:10000});
}
function permissionHelp(){
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="title">Autorise ta position</p>
    <p class="muted">Traceo a besoin de ta position pour tracer ta boucle depuis là où tu es. Elle reste sur ton téléphone.</p>
    ${isIOS ? `<ol class="muted" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px"><li>Ouvre <b>Réglages</b> &gt; <b>Confidentialité</b> &gt; <b>Service de localisation</b> : activé.</li><li>Plus bas, <b>Safari</b> (ou Traceo) : « Lorsque l'app est active ».</li><li>Reviens ici et touche à nouveau le bouton bleu.</li></ol>`
      : `<ol class="muted" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px"><li>Touche le cadenas à gauche de l'adresse du site.</li><li>Autorisations &gt; <b>Position</b> : Autoriser.</li><li>Recharge la page et touche le bouton bleu.</li></ol>`}
    <p class="small">Tu peux aussi taper ton adresse dans la barre de recherche.</p><button class="btn night block" data-close>Compris</button>`);
}
async function reverseLabel(announce){
  const s = S.start; if(!s) return; let label = null;
  if(PV) label = PV.reverse(s);
  else{
    try{ const j = await fetchJSON(`${C.GEOCODER_FR}/reverse?lon=${s.lng}&lat=${s.lat}&limit=1&index=address`, {}, 6000); const p = j.features?.[0]?.properties; if(p && (p.distance == null || p.distance < 250)) label = `${p.name}, ${p.postcode} ${p.city}`; }catch(e){}
    if(!label){ try{ const j = await fetchJSON(`${C.GEOCODER.replace(/api\/?$/, "reverse")}?lat=${s.lat}&lon=${s.lng}&lang=fr`, {}, 6000); const p = j.features?.[0]?.properties; if(p) label = [[p.housenumber, p.street || p.name].filter(Boolean).join(" "), [p.postcode, p.city || p.town || p.village].filter(Boolean).join(" ")].filter(Boolean).join(", "); }catch(e){} }
  }
  if(S.start !== s) return;
  if(label) s.label = label;
  if(S.tab === "plan" && S.view === "form") render();
  if(announce) toast(label ? `Tu es ici : ${label}` : "Position trouvée.", 3800);
}
$("#fabLocate").onclick = locate;
$("#omBtn").onclick = () => {
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Toute la France</p><p class="title">Outre-mer et îles</p><div class="chips">${OUTREMER.map((t, i) => `<button class="chip" data-om="${i}">${esc(t[0])}</button>`).join("")}</div><p class="small">Ensuite, touche le bouton bleu pour te localiser ou tape une adresse.</p>`);
  $("#sheet").querySelectorAll("[data-om]").forEach(b => b.onclick = () => { const t = OUTREMER[+b.dataset.om]; closeModal(); map.flyTo([t[1], t[2]], t[3], {duration:1.8}); });
};

/* ---------- Choisir sa ville (toutes les communes de France) ---------- */
// Grandes villes et outre-mer, affichées tout de suite ; la recherche couvre ensuite les 35 000 communes.
const CITIES = `Paris|48.8566|2.3522|75;Marseille|43.2965|5.3698|13;Lyon|45.764|4.8357|69;Toulouse|43.6047|1.4442|31;Nice|43.7102|7.262|06;Nantes|47.2184|-1.5536|44;Montpellier|43.6108|3.8767|34;Strasbourg|48.5734|7.7521|67;Bordeaux|44.8378|-0.5792|33;Lille|50.6292|3.0573|59;Rennes|48.1173|-1.6778|35;Reims|49.2583|4.0317|51;Toulon|43.1242|5.928|83;Saint-Étienne|45.4397|4.3872|42;Le Havre|49.4944|0.1079|76;Grenoble|45.1885|5.7245|38;Dijon|47.322|5.0415|21;Angers|47.4784|-0.5632|49;Nîmes|43.8367|4.3601|30;Villeurbanne|45.7719|4.8902|69;Clermont-Ferrand|45.7772|3.087|63;Le Mans|48.0061|0.1996|72;Aix-en-Provence|43.5297|5.4474|13;Brest|48.3904|-4.4861|29;Tours|47.3941|0.6848|37;Amiens|49.8941|2.2958|80;Limoges|45.8336|1.2611|87;Annecy|45.8992|6.1294|74;Perpignan|42.6887|2.8948|66;Boulogne-Billancourt|48.8397|2.2399|92;Metz|49.1193|6.1757|57;Besançon|47.2378|6.0241|25;Orléans|47.903|1.9093|45;Saint-Denis|48.9362|2.3574|93;Rouen|49.4432|1.0999|76;Argenteuil|48.9472|2.2467|95;Mulhouse|47.7508|7.3359|68;Montreuil|48.8638|2.4485|93;Caen|49.1829|-0.3707|14;Nancy|48.6921|6.1844|54;Tourcoing|50.7239|3.1612|59;Roubaix|50.6942|3.1746|59;Nanterre|48.8924|2.2071|92;Vitry-sur-Seine|48.7875|2.3928|94;Avignon|43.9493|4.8055|84;Créteil|48.7904|2.4556|94;Poitiers|46.5802|0.3404|86;Dunkerque|51.0344|2.3768|59;Versailles|48.8049|2.1204|78;Courbevoie|48.8973|2.2522|92;Pau|43.2951|-0.3708|64;La Rochelle|46.1603|-1.1511|17;Calais|50.9513|1.8587|62;Cannes|43.5528|7.0174|06;Antibes|43.5808|7.1251|06;Béziers|43.3442|3.2158|34;Saint-Nazaire|47.2735|-2.2138|44;Colmar|48.0794|7.3585|68;Bourges|47.081|2.3988|18;Quimper|47.996|-4.1026|29;Valence|44.9334|4.8924|26;Lorient|47.7483|-3.37|56;Vannes|47.6582|-2.7608|56;Troyes|48.2973|4.0744|10;Chambéry|45.5646|5.9178|73;Niort|46.3237|-0.4588|79;Saint-Malo|48.6493|-2.0257|35;Bayonne|43.4929|-1.4748|64;Biarritz|43.4832|-1.5586|64;La Roche-sur-Yon|46.6705|-1.426|85;Angoulême|45.6484|0.1562|16;Chartres|48.4439|1.489|28;Laval|48.0707|-0.7734|53;Arles|43.6766|4.6278|13;Montauban|44.0176|1.355|82;Albi|43.9289|2.1464|81;Carcassonne|43.213|2.3491|11;Belfort|47.638|6.8628|90;Cergy|49.0364|2.0761|95;Saint-Quentin|49.8465|3.2876|02;Beauvais|49.4295|2.0807|60;Cholet|47.06|-0.8794|49;Blois|47.5861|1.3359|41;Brive-la-Gaillarde|45.1589|1.5331|19;Périgueux|45.1846|0.7214|24;Agen|44.2033|0.6163|47;Tarbes|43.2328|0.0781|65;Gap|44.5594|6.0786|05;Fréjus|43.4331|6.737|83;Hyères|43.1204|6.1286|83;Sète|43.4029|3.697|34;Narbonne|43.1844|3.0042|11;Mâcon|46.3069|4.8287|71;Bourg-en-Bresse|46.2052|5.2255|01;Vichy|46.1278|3.4258|03;Nevers|46.9896|3.159|58;Auxerre|47.7982|3.5673|89;Épinal|48.1724|6.4496|88;Charleville-Mézières|49.7621|4.7266|08;Arras|50.291|2.7775|62;Boulogne-sur-Mer|50.7264|1.6147|62;Évreux|49.0241|1.1508|27;Cherbourg-en-Cotentin|49.6337|-1.6222|50;Saint-Brieuc|48.5136|-2.765|22;Annemasse|46.1934|6.2342|74;Chamonix-Mont-Blanc|45.9237|6.8694|74;Menton|43.7747|7.4975|06;Lourdes|43.0947|-0.0458|65;Vincennes|48.8474|2.4393|94;Issy-les-Moulineaux|48.8245|2.27|92;Levallois-Perret|48.895|2.2874|92;Saint-Germain-en-Laye|48.8989|2.0938|78;Mérignac|44.8386|-0.6436|33;Villeneuve-d'Ascq|50.6233|3.145|59;Ajaccio|41.9192|8.7386|2A;Bastia|42.697|9.45|2B;Vénissieux|45.6975|4.8858|69;Saint-Priest|45.6956|4.944|69;Vaulx-en-Velin|45.7786|4.9208|69;Caluire-et-Cuire|45.7951|4.8466|69;Bron|45.7383|4.9131|69;Villefranche-sur-Saône|45.9896|4.7187|69;Aulnay-sous-Bois|48.9386|2.4975|93;Rueil-Malmaison|48.8778|2.1803|92;Champigny-sur-Marne|48.817|2.515|94;Saint-Maur-des-Fossés|48.7939|2.4936|94;Drancy|48.923|2.4455|93;Noisy-le-Grand|48.8487|2.5526|93;Clichy|48.9045|2.3054|92;Ivry-sur-Seine|48.8139|2.3843|94;Villejuif|48.7922|2.3634|94;Pantin|48.8944|2.4094|93;Sarcelles|48.9978|2.3796|95;Meaux|48.9601|2.8788|77;Melun|48.5394|2.6603|77;Fontainebleau|48.4047|2.7016|77;Massy|48.7309|2.2713|91;Évry-Courcouronnes|48.629|2.441|91;Mantes-la-Jolie|48.9908|1.7167|78;Rambouillet|48.6436|1.8297|78;Martigues|43.4053|5.0476|13;Aubagne|43.2927|5.5708|13;Salon-de-Provence|43.6403|5.0973|13;Istres|43.5151|4.9895|13;La Seyne-sur-Mer|43.1007|5.8788|83;Saint-Raphaël|43.4252|6.7684|83;Draguignan|43.5366|6.4646|83;Grasse|43.6584|6.9225|06;Cagnes-sur-Mer|43.664|7.149|06;Alès|44.125|4.081|30;Montélimar|44.5581|4.7509|26;Vienne|45.5255|4.874|38;Roanne|46.0367|4.0679|42;Aix-les-Bains|45.6885|5.9153|73;Thonon-les-Bains|46.3705|6.4794|74;Haguenau|48.8156|7.7905|67;Thionville|49.3579|6.1683|57;Châlons-en-Champagne|48.9566|4.3631|51;Lens|50.4321|2.8328|62;Douai|50.3714|3.08|59;Valenciennes|50.357|3.5235|59;Compiègne|49.4179|2.8261|60;Soissons|49.3817|3.3236|02;Dieppe|49.9229|1.0775|76;Lisieux|49.1466|0.2259|14;Alençon|48.4329|0.0913|61;Saint-Lô|49.1157|-1.0906|50;Lannion|48.7326|-3.4566|22;Concarneau|47.8753|-3.9189|29;Saint-Herblain|47.2122|-1.6497|44;Rezé|47.1833|-1.55|44;Saumur|47.26|-0.0769|49;Châteauroux|46.8103|1.6913|36;Montluçon|46.3402|2.6033|03;Le Puy-en-Velay|45.0434|3.8858|43;Aurillac|44.9264|2.4398|15;Rodez|44.3506|2.575|12;Cahors|44.4475|1.4419|46;Castres|43.606|2.24|81;Auch|43.646|0.5857|32;Mont-de-Marsan|43.8902|-0.4995|40;Dax|43.7102|-1.0536|40;Arcachon|44.6586|-1.1689|33;Libourne|44.9153|-0.2436|33;Bergerac|44.8533|0.4833|24;Saintes|45.7464|-0.6333|17;Rochefort|45.9421|-0.96|17;Royan|45.6248|-1.0281|17;Cognac|45.6956|-0.3292|16;Anglet|43.485|-1.515|64;Saint-Jean-de-Luz|43.3881|-1.6631|64;Les Sables-d'Olonne|46.4967|-1.7833|85;Agde|43.3108|3.4758|34;Lunel|43.6747|4.1356|34;Orange|44.1381|4.8075|84;Carpentras|44.055|5.0481|84;Manosque|43.8283|5.7867|04;Digne-les-Bains|44.0925|6.2356|04;Bourgoin-Jallieu|45.5869|5.2797|38;Voiron|45.3643|5.5893|38;Lons-le-Saunier|46.6744|5.5547|39;Dole|47.0925|5.49|39;Pontarlier|46.9036|6.355|25;Montbéliard|47.51|6.7983|25;Vesoul|47.6198|6.1544|70;Verdun|49.1598|5.3844|55;Sens|48.1975|3.2833|89;Dreux|48.7366|1.3664|28;Châtellerault|46.8178|0.5461|86;Montargis|47.9975|2.7333|45;Mende|44.5181|3.5|48;Foix|42.9653|1.6069|09;Saint-Denis (La Réunion)|-20.8823|55.4504|974;Saint-Paul (La Réunion)|-21.0096|55.2707|974;Saint-Pierre (La Réunion)|-21.3393|55.4781|974;Pointe-à-Pitre|16.2411|-61.5331|971;Les Abymes|16.271|-61.5045|971;Fort-de-France|14.6161|-61.0588|972;Le Lamentin|14.613|-60.999|972;Cayenne|4.9224|-52.3135|973;Kourou|5.16|-52.65|973;Mamoudzou|-12.7806|45.2279|976;Nouméa|-22.2758|166.458|988;Papeete|-17.535|-149.5696|987;Saint-Pierre (Saint-Pierre-et-Miquelon)|46.7811|-56.1764|975;Gustavia|17.8962|-62.8498|977;Marigot|18.0675|-63.0821|978;Mata-Utu|-13.2825|-176.1745|986`
  .split(";").map(x => { const [n, la, lo, d] = x.split("|"); return {nom:n, lat:+la, lng:+lo, dep:d}; });
const plain = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-'’]/g, " ");
function pickCity(c){
  closeModal();
  if(PV) setTimeout(() => toast(`Aperçu : carte simulée. Dans l'app en ligne, c'est le vrai plan de ${c.nom}, avec toutes ses rues.`, 5200), 1600);
  setStart({lat:c.lat, lng:c.lng, label:`Centre de ${c.nom}${c.cp ? ` (${c.cp})` : c.dep ? ` (${c.dep})` : ""}`, city:true});
  toast(`Plan de ${c.nom}. Appui long sur la carte pour choisir ton point de départ exact.`, 4500);
  if(S.tab !== "plan") go("plan");
}
function cityRow(c, i){ return `<button data-ci="${i}"><svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V9l5-3v15M10 21V4l9 4v13"/></svg><span><b>${esc(c.nom)}</b><small>${esc(c.sub || (c.dep ? (c.dep.length === 3 ? "Outre-mer · " + c.dep : "Département " + c.dep) : ""))}</small></span></button>`; }
// Toutes les communes des Yvelines (source : geo.api.gouv.fr), intégrées dans l'app
const DEP78 = `Ablis|48.5292|1.8565|78660|3913;Achères|48.9817|2.1095|78260|22241;Adainville|48.7206|1.6629|78113|673;Aigremont|48.9027|2.0127|78240|1075;Allainville|48.4673|1.9038|78660|281;Les Alluets-le-Roi|48.914|1.913|78580|1390;Andelu|48.887|1.8094|78770|550;Andrésy|48.9778|2.0496|78570|13834;Arnouville-lès-Mantes|48.911|1.7225|78790|951;Aubergenville|48.9609|1.844|78410|12723;Auffargis|48.6824|1.8994|78610|1963;Auffreville-Brasseuil|48.9543|1.7057|78930|671;Aulnay-sur-Mauldre|48.9294|1.84|78126|1180;Auteuil|48.8415|1.8172|78770|1020;Autouillet|48.8451|1.7958|78770|665;Bailly|48.8366|2.0809|78870|3731;Bazainville|48.8121|1.6659|78550|1469;Bazemont|48.9321|1.8761|78580|1727;Bazoches-sur-Guyonne|48.7792|1.8489|78490|721;Béhoust|48.8324|1.7247|78910|533;Bennecourt|49.0484|1.5654|78270|1747;Blaru|49.0413|1.4846|78270|907;Boinville-en-Mantois|48.9272|1.7491|78930|285;Boinville-le-Gaillard|48.4958|1.8698|78660|597;Boinvilliers|48.9188|1.661|78200|243;Bois-d'Arcy|48.806|2.0223|78390|16586;Boissets|48.8578|1.5859|78910|301;La Boissière-École|48.6911|1.6661|78125|747;Boissy-Mauvoisin|48.965|1.5831|78200|615;Boissy-sans-Avoir|48.8211|1.7979|78490|616;Bonnelles|48.6203|2.0327|78830|2165;Bonnières-sur-Seine|49.0168|1.5685|78270|5064;Bouafle|48.9566|1.8997|78410|2234;Bougival|48.8627|2.1394|78380|9134;Bourdonné|48.7556|1.6559|78113|506;Breuil-Bois-Robert|48.9447|1.7129|78930|764;Bréval|48.9567|1.5402|78980|2151;Les Bréviaires|48.7172|1.8177|78610|1302;Brueil-en-Vexin|49.0279|1.8083|78440|652;Buc|48.7736|2.125|78530|5816;Buchelay|48.983|1.6788|78200|3360;Bullion|48.6267|1.9758|78830|1916;Carrières-sous-Poissy|48.9469|2.0264|78955|20825;Carrières-sur-Seine|48.9128|2.1812|78420|14791;La Celle-les-Bordes|48.6382|1.9459|78720|840;La Celle-Saint-Cloud|48.8498|2.1342|78170|20460;Cernay-la-Ville|48.6697|1.9617|78720|1516;Chambourcy|48.8973|2.0267|78240|5847;Chanteloup-les-Vignes|48.9773|2.0336|78570|10861;Chapet|48.9681|1.9383|78130|1331;Châteaufort|48.7371|2.0956|78117|1564;Chatou|48.8964|2.1502|78400|30598;Chaufour-lès-Bonnières|49.0161|1.4842|78270|442;Chavenay|48.8471|1.9862|78450|1723;Le Chesnay-Rocquencourt|48.8285|2.1188|78150|30689;Chevreuse|48.7035|2.0343|78460|5502;Choisel|48.6754|2.0159|78460|540;Civry-la-Forêt|48.8647|1.6187|78910|373;Clairefontaine-en-Yvelines|48.6172|1.905|78120|850;Les Clayes-sous-Bois|48.8168|1.9835|78340|16804;Coignières|48.7506|1.9178|78310|4321;Condé-sur-Vesgre|48.7308|1.669|78113|1279;Conflans-Sainte-Honorine|49.0016|2.0992|78700|36958;Courgent|48.8971|1.6595|78790|414;Cravent|48.9901|1.4844|78270|438;Crespières|48.8809|1.9185|78121|1719;Croissy-sur-Seine|48.8805|2.1342|78290|11013;Dammartin-en-Serve|48.9125|1.6193|78111|1441;Dampierre-en-Yvelines|48.7065|1.9789|78720|1008;Dannemarie|48.7623|1.6036|78550|229;Davron|48.8664|1.946|78810|295;Drocourt|49.0528|1.7702|78440|554;Ecquevilly|48.9482|1.925|78920|4279;Élancourt|48.7771|1.9612|78990|26365;Émancé|48.5906|1.7342|78125|872;Épône|48.9459|1.8119|78680|7031;Les Essarts-le-Roi|48.713|1.8905|78690|6831;L'Étang-la-Ville|48.8673|2.0586|78620|5157;Évecquemont|49.0182|1.9392|78740|754;La Falaise|48.9385|1.8246|78410|609;Favrieux|48.9439|1.6407|78200|157;Feucherolles|48.8787|1.9847|78810|3043;Flacourt|48.9312|1.6416|78200|184;Flexanville|48.8569|1.7415|78910|576;Flins-Neuve-Église|48.8927|1.5773|78790|162;Flins-sur-Seine|48.9664|1.8721|78410|2447;Follainville-Dennemont|49.0293|1.7027|78520|2184;Fontenay-le-Fleury|48.8169|2.0477|78330|13680;Fontenay-Mauvoisin|48.9601|1.6486|78200|460;Fontenay-Saint-Père|49.0274|1.7576|78440|949;Freneuse|49.0489|1.6139|78840|4505;Gaillon-sur-Montcient|49.03|1.8979|78250|689;Galluis|48.7984|1.7898|78490|1298;Gambais|48.7774|1.6732|78950|2574;Gambaiseuil|48.7614|1.7221|78490|64;Garancières|48.8223|1.7602|78890|2621;Gargenville|48.9938|1.8112|78440|7869;Gazeran|48.6375|1.7785|78125|1492;Gommecourt|49.0697|1.5931|78270|613;Goupillières|48.882|1.7651|78770|570;Goussonville|48.9251|1.7668|78930|650;Grandchamp|48.7207|1.6141|78113|300;Gressey|48.833|1.6009|78550|533;Grosrouvre|48.7799|1.7609|78490|902;Guernes|49.0164|1.6435|78520|1085;Guerville|48.9544|1.7409|78930|2052;Guitrancourt|49.01|1.7775|78440|646;Guyancourt|48.7735|2.0745|78280|29778;Hardricourt|49.0092|1.8834|78250|2599;Hargeville|48.8953|1.7464|78790|418;La Hauteville|48.7049|1.6257|78113|157;Herbeville|48.903|1.8901|78580|228;Hermeray|48.6549|1.688|78125|1007;Houdan|48.7968|1.5981|78550|3721;Houilles|48.9266|2.1866|78800|33983;Issou|48.9884|1.7865|78440|4060;Jambville|49.0489|1.8483|78440|793;Notre-Dame-de-la-Mer|49.0552|1.5292|78270|742;Jouars-Pontchartrain|48.7874|1.913|78760|6039;Jouy-en-Josas|48.7652|2.161|78350|7981;Jouy-Mauvoisin|48.9746|1.6461|78200|554;Jumeauville|48.9087|1.7827|78580|638;Juziers|48.9991|1.842|78820|4065;Lainville-en-Vexin|49.0585|1.8182|78440|805;Lévis-Saint-Nom|48.7248|1.9336|78320|1603;Limay|48.9911|1.7367|78520|17885;Limetz-Villez|49.0585|1.5512|78270|2110;Les Loges-en-Josas|48.7617|2.1412|78350|1645;Lommoye|48.9985|1.5181|78270|639;Longnes|48.9201|1.5753|78980|1601;Longvilliers|48.5781|1.9969|78730|496;Louveciennes|48.8595|2.1132|78430|7990;Magnanville|48.9685|1.6842|78200|6383;Magny-les-Hameaux|48.7379|2.0494|78114|9386;Maisons-Laffitte|48.9503|2.1533|78600|23093;Mantes-la-Jolie|48.9961|1.6918|78200|43526;Mantes-la-Ville|48.9752|1.7103|78711|22332;Marcq|48.8645|1.8221|78770|802;Mareil-le-Guyon|48.7899|1.8531|78490|420;Mareil-Marly|48.88|2.0775|78750|4141;Mareil-sur-Mauldre|48.8893|1.8747|78124|1776;Marly-le-Roi|48.866|2.0892|78160|16756;Maule|48.9058|1.8409|78580|6083;Maulette|48.7842|1.6111|78550|1088;Maurecourt|48.9994|2.0479|78780|4454;Maurepas|48.7712|1.925|78310|20629;Médan|48.9559|1.9858|78670|1289;Ménerville|48.9568|1.5971|78200|216;Méré|48.7954|1.8188|78490|1731;Méricourt|49.037|1.6254|78270|383;Le Mesnil-le-Roi|48.9249|2.1234|78600|6332;Le Mesnil-Saint-Denis|48.7389|1.9619|78320|7276;Les Mesnuls|48.7542|1.8339|78490|910;Meulan-en-Yvelines|49.0051|1.909|78250|8950;Mézières-sur-Seine|48.9481|1.782|78970|3923;Mézy-sur-Seine|49.0033|1.8692|78250|2242;Millemont|48.8095|1.7258|78940|272;Milon-la-Chapelle|48.7298|2.0461|78470|295;Mittainville|48.6639|1.6363|78125|659;Moisson|49.0663|1.6587|78840|902;Mondreville|48.9034|1.5568|78980|381;Montainville|48.8807|1.8539|78124|589;Montalet-le-Bois|49.0471|1.8287|78440|322;Montchauvet|48.8944|1.6265|78790|275;Montesson|48.919|2.1381|78360|14549;Montfort-l'Amaury|48.7717|1.8081|78490|2779;Montigny-le-Bretonneux|48.7776|2.0252|78180|32465;Morainvilliers|48.9351|1.9437|78630|3120;Mousseaux-sur-Seine|49.051|1.6548|78270|689;Mulcent|48.879|1.6524|78790|128;Les Mureaux|48.9877|1.911|78130|34632;Neauphle-le-Château|48.8122|1.9031|78640|3250;Neauphle-le-Vieux|48.8166|1.8634|78640|937;Neauphlette|48.9358|1.5446|78980|871;Nézel|48.9428|1.8398|78410|1139;Noisy-le-Roi|48.8466|2.0542|78590|7713;Oinville-sur-Montcient|49.0249|1.8474|78250|1131;Orcemont|48.5958|1.8031|78125|985;Orgerus|48.8351|1.695|78910|2489;Orgeval|48.9185|1.9698|78630|7252;Orphin|48.5763|1.7842|78125|875;Orsonville|48.4778|1.8227|78660|325;Orvilliers|48.8549|1.6423|78910|925;Osmoy|48.8645|1.7162|78910|413;Paray-Douaville|48.4607|1.8615|78660|218;Le Pecq|48.8924|2.1022|78230|16059;Perdreauville|48.9666|1.6056|78200|701;Le Perray-en-Yvelines|48.6988|1.8424|78610|6480;Plaisir|48.8129|1.9483|78370|31811;Poigny-la-Forêt|48.6803|1.7549|78125|957;Poissy|48.9241|2.025|78300|40983;Ponthévrard|48.5496|1.91|78730|693;Porcheville|48.9781|1.768|78440|3382;Le Port-Marly|48.8808|2.1104|78560|5559;Prunay-le-Temple|48.858|1.6741|78910|409;Prunay-en-Yvelines|48.5257|1.8041|78660|808;La Queue-les-Yvelines|48.8042|1.7603|78940|2629;Raizeux|48.6375|1.6849|78125|970;Rambouillet|48.6538|1.8339|78120|27724;Rennemoulin|48.8339|2.0421|78590|116;Richebourg|48.825|1.634|78550|1570;Rochefort-en-Yvelines|48.593|1.9819|78730|910;Rolleboise|49.0195|1.6006|78270|346;Rosay|48.9108|1.684|78790|387;Rosny-sur-Seine|48.9978|1.6054|78710|7328;Sailly|49.0448|1.7927|78440|354;Saint-Arnoult-en-Yvelines|48.5752|1.9293|78730|5875;Saint-Cyr-l'École|48.8064|2.0657|78210|21268;Saint-Forget|48.7128|1.9976|78720|436;Saint-Germain-de-la-Grange|48.8347|1.902|78640|1847;Saint-Germain-en-Laye|48.931|2.1052|78100|45931;Saint-Hilarion|48.6246|1.7222|78125|999;Saint-Illiers-la-Ville|48.9777|1.5437|78980|350;Saint-Illiers-le-Bois|48.9647|1.5102|78980|449;Saint-Lambert|48.7339|2.0093|78470|447;Saint-Léger-en-Yvelines|48.7338|1.7646|78610|1468;Saint-Martin-de-Bréthencourt|48.5153|1.9179|78660|690;Saint-Martin-des-Champs|48.8776|1.7215|78790|304;Saint-Martin-la-Garenne|49.0372|1.6707|78520|942;Sainte-Mesme|48.536|1.9433|78730|904;Saint-Nom-la-Bretèche|48.8621|2.0168|78860|4965;Saint-Rémy-lès-Chevreuse|48.7037|2.082|78470|7747;Saint-Rémy-l'Honoré|48.7515|1.8775|78690|1689;Sartrouville|48.9374|2.1744|78500|52763;Saulx-Marchais|48.8434|1.8361|78650|950;Senlisse|48.6828|1.9688|78720|511;Septeuil|48.8883|1.6891|78790|2264;Soindres|48.9547|1.6732|78200|757;Sonchamp|48.5854|1.8765|78120|1678;Tacoignières|48.8328|1.664|78910|1219;Le Tartre-Gaudran|48.6976|1.6028|78113|37;Le Tertre-Saint-Denis|48.9427|1.609|78980|137;Tessancourt-sur-Aubette|49.0263|1.9218|78250|966;Thiverval-Grignon|48.8419|1.9322|78850|1023;Thoiry|48.8699|1.7989|78770|1434;Tilly|48.8785|1.5764|78790|530;Toussus-le-Noble|48.7477|2.1192|78117|1172;Trappes|48.7738|1.9964|78190|34689;Le Tremblay-sur-Mauldre|48.7859|1.8765|78490|930;Triel-sur-Seine|48.976|2.0055|78510|12206;Vaux-sur-Seine|49.0089|1.9704|78740|5202;Vélizy-Villacoublay|48.784|2.1956|78140|23011;Verneuil-sur-Seine|48.9874|1.9659|78480|16280;Vernouillet|48.9649|1.9748|78540|9699;La Verrière|48.7545|1.9505|78320|5994;Versailles|48.8039|2.1191|78000|84095;Vert|48.9429|1.6824|78930|852;Le Vésinet|48.8928|2.1312|78110|15554;Vicq|48.8223|1.8283|78490|389;Vieille-Église-en-Yvelines|48.6695|1.8759|78125|652;La Villeneuve-en-Chevrie|49.0129|1.5285|78270|665;Villennes-sur-Seine|48.9372|1.9975|78670|5952;Villepreux|48.8306|2.0127|78450|11931;Villette|48.9244|1.6917|78930|524;Villiers-le-Mahieu|48.8518|1.7744|78770|888;Villiers-Saint-Frédéric|48.8201|1.883|78640|3395;Viroflay|48.8017|2.1725|78220|17237;Voisins-le-Bretonneux|48.7598|2.047|78960|10624`.split(";").map(x => { const [nom, la, lo, cp, pop] = x.split("|"); return {nom, lat:+la, lng:+lo, cp, pop:+pop, dep:"78"}; });
const DEPS = "01 Ain;02 Aisne;03 Allier;04 Alpes-de-Haute-Provence;05 Hautes-Alpes;06 Alpes-Maritimes;07 Ardèche;08 Ardennes;09 Ariège;10 Aube;11 Aude;12 Aveyron;13 Bouches-du-Rhône;14 Calvados;15 Cantal;16 Charente;17 Charente-Maritime;18 Cher;19 Corrèze;2A Corse-du-Sud;2B Haute-Corse;21 Côte-d'Or;22 Côtes-d'Armor;23 Creuse;24 Dordogne;25 Doubs;26 Drôme;27 Eure;28 Eure-et-Loir;29 Finistère;30 Gard;31 Haute-Garonne;32 Gers;33 Gironde;34 Hérault;35 Ille-et-Vilaine;36 Indre;37 Indre-et-Loire;38 Isère;39 Jura;40 Landes;41 Loir-et-Cher;42 Loire;43 Haute-Loire;44 Loire-Atlantique;45 Loiret;46 Lot;47 Lot-et-Garonne;48 Lozère;49 Maine-et-Loire;50 Manche;51 Marne;52 Haute-Marne;53 Mayenne;54 Meurthe-et-Moselle;55 Meuse;56 Morbihan;57 Moselle;58 Nièvre;59 Nord;60 Oise;61 Orne;62 Pas-de-Calais;63 Puy-de-Dôme;64 Pyrénées-Atlantiques;65 Hautes-Pyrénées;66 Pyrénées-Orientales;67 Bas-Rhin;68 Haut-Rhin;69 Rhône;70 Haute-Saône;71 Saône-et-Loire;72 Sarthe;73 Savoie;74 Haute-Savoie;75 Paris;76 Seine-Maritime;77 Seine-et-Marne;78 Yvelines;79 Deux-Sèvres;80 Somme;81 Tarn;82 Tarn-et-Garonne;83 Var;84 Vaucluse;85 Vendée;86 Vienne;87 Haute-Vienne;88 Vosges;89 Yonne;90 Territoire de Belfort;91 Essonne;92 Hauts-de-Seine;93 Seine-Saint-Denis;94 Val-de-Marne;95 Val-d'Oise;971 Guadeloupe;972 Martinique;973 Guyane;974 La Réunion;976 Mayotte".split(";").map(x => { const i = x.indexOf(" "); return {code:x.slice(0, i), nom:x.slice(i + 1)}; });
const depCache = {"78":DEP78};
function villesModal(tab){
  S.villesTab = tab || S.villesTab || "grandes";
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Toute la France</p><p class="title">Choisis ta ville</p>
    <div class="seg" data-v="${S.villesTab === "grandes" ? "dist" : "time"}"><span class="knob"></span><button data-vt="grandes" aria-pressed="${S.villesTab === "grandes"}">Grandes villes</button><button data-vt="deps" aria-pressed="${S.villesTab === "deps"}">Par département</button></div>
    <label class="search" style="box-shadow:none;border:1px solid var(--line);background:var(--surface-2)" for="bq"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input id="bq" type="search" placeholder="${S.villesTab === "grandes" ? "Filtrer les villes" : "Département ou numéro"}" autocomplete="off"></label>
    <div class="citygrid" id="bgrid"></div>`);
  sheet.querySelectorAll("[data-vt]").forEach(b => b.onclick = () => villesModal(b.dataset.vt));
  const grid = $("#bgrid"), bq = $("#bq");
  const btn = c => `<button data-bc="${esc(c.nom)}"><b>${esc(c.nom)}</b><small>${c.dep}</small></button>`;
  if(S.villesTab === "grandes"){
    const metro = CITIES.filter(c => c.dep.length < 3), az = metro.slice().sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    const wire = list => grid.querySelectorAll("[data-bc]").forEach(b => b.onclick = () => pickCity(list.find(c => c.nom === b.dataset.bc)));
    const all = () => { grid.innerHTML = `<p class="eyebrow gfull">Les plus grandes</p>${metro.slice(0, 12).map(btn).join("")}<p class="eyebrow gfull">Toutes les grandes villes de A à Z · ${az.length}</p>${az.map(btn).join("")}`; wire(metro); };
    all(); bq.oninput = () => { const p = plain(bq.value.trim()); if(!p) return all(); const f = az.filter(c => plain(c.nom).includes(p)); grid.innerHTML = f.length ? f.map(btn).join("") : `<p class="small gfull">Aucune grande ville ne correspond. Essaie « Par département » ou la barre de recherche.</p>`; wire(f); };
  } else {
    const depBtn = d => `<button class="deprow gfull" data-dep="${d.code}"><span class="dc">${d.code}</span><b>${esc(d.nom)}</b><span class="go">›</span></button>`;
    const all = list => { grid.innerHTML = `<button class="star gfull deprow" data-dep="78"><span class="dc">78</span><b>Yvelines</b><small>${DEP78.length} communes</small></button><p class="eyebrow gfull">Tous les départements, du 01 au 976</p>` + list.map(depBtn).join(""); grid.querySelectorAll("[data-dep]").forEach(b => b.onclick = () => openDep(b.dataset.dep)); };
    all(DEPS); bq.oninput = () => { const p = plain(bq.value.trim()); all(p ? DEPS.filter(d => plain(d.nom).includes(p) || d.code.toLowerCase().startsWith(p)) : DEPS); };
  }
}
// Aperçu : référentiel officiel des communes (Etalab, via jsDelivr). Les positions y sont approchées,
// l'aperçu ayant une carte simulée ; l'app en ligne utilise les positions exactes de geo.api.gouv.fr.
let pvAll = null;
async function pvCommunes(code){
  pvAll = pvAll || import("https://cdn.jsdelivr.net/npm/@etalab/decoupage-administratif@5.3.0/data/communes.json/+esm").then(m => m.default.filter(c => c.type === "commune-actuelle"));
  const all = await pvAll, near = CITIES.filter(c => c.dep === code);
  const base = near.length ? [near.reduce((a, c) => a + c.lat, 0)/near.length, near.reduce((a, c) => a + c.lng, 0)/near.length] : [46.6, 2.4];
  const h = s => { let x = 0; for(const ch of s) x = (x*31 + ch.charCodeAt(0)) >>> 0; return x/4294967296; };
  return all.filter(c => c.departement === code).map(c => { const big = near.find(n => plain(n.nom) === plain(c.nom)); return {nom:c.nom, cp:c.codesPostaux?.[0] || "", pop:c.population || 0, dep:code, full:true, lat:big ? big.lat : base[0] + (h(c.nom) - .5)*.5, lng:big ? big.lng : base[1] + (h(c.nom + "x") - .5)*.7}; });
}
async function openDep(code){
  const d = DEPS.find(x => x.code === code), grid = $("#bgrid"), bq = $("#bq");
  bq.value = ""; bq.placeholder = `Filtrer les communes de ${d.nom}`;
  grid.innerHTML = `<button class="gfull back" id="depBack">‹ Tous les départements</button><p class="eyebrow gfull">${esc(d.nom)} (${d.code})</p><p class="small gfull">Chargement de toutes les communes…</p><div class="skel gfull" style="height:120px"></div>`;
  $("#depBack").onclick = () => villesModal("deps");
  // toutes les communes du département : mémoire de l'appareil d'abord, sinon liste officielle en direct
  let list = depCache[code] || store.get("dep:" + code, null);
  if(!list){
    if(PV){
      try{ list = await pvCommunes(code); }
      catch(e){ const big = CITIES.filter(c => c.dep === code).map(c => ({...c, cp:c.dep})); if(!big.length){ grid.querySelector(".skel").outerHTML = `<p class="small gfull">Liste des communes indisponible dans l'aperçu.</p>`; return; } list = big; }
    } else {
      try{
        const arr = await fetchJSON(`https://geo.api.gouv.fr/departements/${code}/communes?fields=nom,centre,codesPostaux,population`, {}, 12000);
        list = arr.filter(c => c.centre).map(c => ({nom:c.nom, lat:+c.centre.coordinates[1].toFixed(5), lng:+c.centre.coordinates[0].toFixed(5), cp:c.codesPostaux?.[0] || "", pop:c.population || 0, dep:code}));
        store.set("dep:" + code, list);
      }catch(e){ grid.querySelector(".skel").outerHTML = `<p class="small gfull">Impossible de charger les communes. Vérifie ta connexion.</p>`; return; }
    }
    depCache[code] = list;
  }
  const partial = PV && code !== "78" && !list[0]?.full;
  const az = list.slice().sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const row = c => `<button data-cm="${esc(c.nom)}"><b>${esc(c.nom)}</b><small>${c.cp}</small></button>`;
  const show = arr => { const head = `<button class="gfull back" id="depBack">‹ Tous les départements</button><p class="eyebrow gfull">${esc(d.nom)} (${d.code}) · ${partial ? "grandes villes" : list.length + " communes"}</p>${partial ? `<p class="small gfull">Aperçu : seules les grandes villes s'affichent. Dans l'app en ligne, toutes les communes du département sont listées.</p>` : ""}`; grid.innerHTML = head + (arr.length ? arr.map(row).join("") : `<p class="small gfull">Aucune commune ne correspond.</p>`); $("#depBack").onclick = () => villesModal("deps"); grid.querySelectorAll("[data-cm]").forEach(b => b.onclick = () => pickCity(list.find(c => c.nom === b.dataset.cm))); grid.scrollTop = 0; };
  show(az); bq.oninput = () => { const p = plain(bq.value.trim()); show(p ? az.filter(c => plain(c.nom).includes(p) || c.cp.startsWith(bq.value.trim())) : az); };
}
$("#bigBtn").onclick = () => villesModal();
const cityPicker = () => {
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Toutes les villes de France</p><p class="title">Choisis ta ville</p>
    <label class="search" style="box-shadow:none;border:1px solid var(--line);background:var(--surface-2)" for="cq"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input id="cq" type="search" placeholder="Ville, village ou code postal" autocomplete="off" enterkeyhint="search"></label>
    <div class="results citylist" id="cres" style="box-shadow:none;border:1px solid var(--line);max-height:46vh"></div>`);
  const cq = $("#cq"), cres = $("#cres"); let list = CITIES, t, ac;
  const show = arr => { list = arr; cres.innerHTML = arr.length ? arr.map(cityRow).join("") : `<button disabled><span><b>Aucune commune trouvée</b><small>Vérifie l'orthographe ou tape le code postal.</small></span></button>`; cres.querySelectorAll("[data-ci]").forEach(b => b.onclick = () => pickCity(list[+b.dataset.ci])); };
  show(CITIES);
  cq.oninput = () => {
    clearTimeout(t); const v = cq.value.trim(); if(!v){ show(CITIES); return; }
    const p = plain(v), local = CITIES.filter(c => plain(c.nom).includes(p) || c.dep === v);
    show(local);
    if(PV || v.length < 2) return;
    t = setTimeout(async () => {
      ac?.abort(); ac = new AbortController();
      const by = /^\d{5}$/.test(v) ? `codePostal=${v}` : `nom=${encodeURIComponent(v)}`;
      try{
        const arr = await fetchJSON(`https://geo.api.gouv.fr/communes?${by}&fields=nom,centre,codesPostaux,population,departement&boost=population&limit=15`, {signal:ac.signal}, 6000);
        const all = arr.filter(c => c.centre).map(c => ({nom:c.nom, lat:c.centre.coordinates[1], lng:c.centre.coordinates[0], cp:c.codesPostaux?.[0], sub:[c.codesPostaux?.[0], c.departement?.nom, c.population ? nf(0).format(c.population) + " hab." : ""].filter(Boolean).join(" · ")}));
        for(const l of local) if(!all.some(a => plain(a.nom) === plain(l.nom))) all.push(l);
        if(cq.value.trim() === v) show(all);
      }catch(e){}
    }, 150);
  };
  setTimeout(() => cq.focus(), 350);
};

/* ---------- Recherche d'adresses (toute la France) ---------- */
const q = $("#q"), res = $("#results"), qClear = $("#qClear");
const cache = new Map(); let qT, qAC, gSess = null;
const cityI = '<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V9l5-3v15M10 21V4l9 4v13M14 10h2M14 14h2"/></svg>';
const pinI = '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
q.addEventListener("input", () => { qClear.hidden = !q.value; clearTimeout(qT); clearTimeout(autoT); const v = q.value.trim(); if(v.length < 3){ res.hidden = true; return; } qT = setTimeout(() => search(v), cache.has(v.toLowerCase()) ? 0 : 130); });
q.addEventListener("focus", () => { if(res.innerHTML && q.value.trim().length >= 3) res.hidden = false; });
q.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); const b = $("button[data-i]", res); if(b) b.click(); else if(q.value.trim().length >= 3){ clearTimeout(qT); search(q.value.trim()); } } if(e.key === "Escape"){ res.hidden = true; q.blur(); } });
qClear.onclick = () => { q.value = ""; qClear.hidden = true; res.hidden = true; q.focus(); };
document.addEventListener("pointerdown", e => { if(!e.target.closest(".top")) res.hidden = true; });
async function googleSuggest(v, signal){
  gSess = gSess || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())); const c = map.getCenter();
  const j = await fetchJSON("https://places.googleapis.com/v1/places:autocomplete", {method:"POST", signal, headers:{"Content-Type":"application/json", "X-Goog-Api-Key":C.GOOGLE_MAPS_KEY}, body:JSON.stringify({input:v, languageCode:"fr", includedRegionCodes:TERR, sessionToken:gSess, locationBias:{circle:{center:{latitude:c.lat, longitude:c.lng}, radius:50000}}})}, 6000);
  return (j.suggestions || []).filter(s => s.placePrediction).slice(0, 7).map(s => { const p = s.placePrediction; return {main:p.structuredFormat?.mainText?.text || p.text?.text, sub:p.structuredFormat?.secondaryText?.text || "", placeId:p.placeId}; });
}
async function googlePlace(id){
  const j = await fetchJSON(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=fr${gSess ? "&sessionToken=" + gSess : ""}`, {headers:{"X-Goog-Api-Key":C.GOOGLE_MAPS_KEY, "X-Goog-FieldMask":"location,shortFormattedAddress,formattedAddress"}}, 6000);
  gSess = null; return {lat:j.location.latitude, lng:j.location.longitude, label:j.shortFormattedAddress || j.formattedAddress};
}
// Une seule ligne par ville : les communes viennent d'abord (une fois chacune), puis les adresses et les lieux
const CITY_TYPES = ["city","town","village","hamlet","municipality","county","state","district","locality"];
async function geocode(v, signal){
  if(PV) return PV.search(v);
  const key = v.toLowerCase(); if(cache.has(key)) return cache.get(key);
  let items = [];
  if(C.GOOGLE_MAPS_KEY){ try{ items = await googleSuggest(v, signal); }catch(e){ if(e.name === "AbortError") throw e; } }
  if(!items.length){
    const c = map.getCenter(), near = map.getZoom() >= 9 ? `&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}` : "";
    const hasNum = /\d/.test(v) && !/^\d{5}$/.test(v.trim());
    const [towns, ban, osm] = await Promise.allSettled([
      hasNum ? Promise.resolve([]) : fetchJSON(`https://geo.api.gouv.fr/communes?${/^\d{5}$/.test(v.trim()) ? "codePostal=" + v.trim() : "nom=" + encodeURIComponent(v)}&fields=nom,centre,codesPostaux,departement,population&boost=population&limit=5`, {signal}, 6000),
      fetchJSON(`${C.GEOCODER_FR}/search?q=${encodeURIComponent(v)}&limit=8&autocomplete=1${near}`, {signal}, 6000),
      fetchJSON(`${C.GEOCODER}?q=${encodeURIComponent(v)}&lang=fr&limit=10${near}`, {signal}, 6000)
    ]);
    if(signal?.aborted) throw new DOMException("", "AbortError");
    const cityNames = new Set();
    // 1. Communes : une ligne par commune (le département distingue les homonymes)
    if(towns.status === "fulfilled") for(const t of towns.value || []){
      if(!t.centre) continue; const k = plain(t.nom) + "|" + (t.departement?.code || "");
      if(cityNames.has(k)) continue; cityNames.add(k); cityNames.add(plain(t.nom));
      items.push({main:t.nom, sub:["Ville", t.departement ? `${t.departement.nom} (${t.departement.code})` : "", t.population ? nf(0).format(t.population) + " hab." : ""].filter(Boolean).join(" · "), lat:t.centre.coordinates[1], lng:t.centre.coordinates[0], label:`Centre de ${t.nom}`, city:true});
    }
    // 2. Adresses et rues (Base Adresse Nationale), sans répéter les villes
    if(ban.status === "fulfilled") for(const f of ban.value.features || []){
      const p = f.properties, [lo, la] = f.geometry.coordinates;
      if(p.type === "municipality"){ if(cityNames.has(plain(p.city))) continue; cityNames.add(plain(p.city)); items.push({main:p.city, sub:["Ville", p.postcode].join(" · "), lat:la, lng:lo, label:`Centre de ${p.city}`, city:true}); continue; }
      items.push({main:p.name, sub:[`${p.postcode} ${p.city}`, (p.context || "").split(", ").slice(1, 2).join("")].filter(Boolean).join(" · "), lat:la, lng:lo, label:`${p.name}, ${p.postcode} ${p.city}`});
    }
    // 3. Lieux et territoires hors Base Adresse (OpenStreetMap), sans villes en double
    if(osm.status === "fulfilled") for(const f of osm.value.features || []){
      const p = f.properties, [lo, la] = f.geometry.coordinates;
      if(!TERR.includes((p.countrycode || "").toLowerCase()) || items.length >= 9) continue;
      const isCity = CITY_TYPES.includes(p.type) || ["city","town","village"].includes(p.osm_value);
      if(isCity){ if(cityNames.has(plain(p.name || ""))) continue; cityNames.add(plain(p.name || "")); }
      if(items.some(x => dist([x.lat, x.lng], [la, lo]) < 80)) continue;
      const street = [p.housenumber, p.street].filter(Boolean).join(" "), main = p.name || street;
      items.push({main, sub:[isCity ? "Ville" : street !== main ? street : "", [p.postcode, isCity ? "" : p.city].filter(Boolean).join(" "), p.state].filter(Boolean).join(" · "), lat:la, lng:lo, label:isCity ? `Centre de ${main}` : [main, p.city].filter(Boolean).join(", "), city:isCity});
    }
  }
  { const seen = new Set(); items = items.filter(it => { const k = plain((it.label || it.main) + " " + (it.sub || "")); if(seen.has(k)) return false; seen.add(k); return true; }); }
  cache.set(key, items); if(cache.size > 300) cache.delete(cache.keys().next().value);
  return items;
}
let autoT = null;
async function pickItem(it){
  clearTimeout(autoT); res.hidden = true; q.value = ""; qClear.hidden = true; q.blur();
  if(it.placeId){ try{ it = {...it, ...(await googlePlace(it.placeId))}; }catch(e){ toast("Lieu introuvable, réessaie."); return; } }
  setStart({lat:r6(+it.lat), lng:r6(+it.lng), label:it.label || it.main, city:!!it.city});
  toast(it.city ? `Plan de ${it.main}. Appui long sur la carte pour choisir ton point de départ exact.` : `Départ : ${it.label || it.main}`, 3600);
  if(PV) setTimeout(() => toast(`Aperçu : carte simulée. Dans l'app en ligne, c'est le vrai plan, avec toutes les rues.`, 5200), 3800);
  if(S.tab !== "plan") go("plan");
}
async function search(v){
  qAC?.abort(); qAC = new AbortController(); const signal = qAC.signal; clearTimeout(autoT);
  if(!cache.has(v.toLowerCase())){ res.innerHTML = `<button disabled>${pinI}<span><b>Recherche…</b></span></button>`; res.hidden = false; }
  try{
    const items = await geocode(v, signal); if(signal.aborted) return; res.hidden = false;
    if(!items.length){ res.innerHTML = `<button disabled>${pinI}<span><b>Aucune adresse trouvée</b><small>Ajoute la ville ou le code postal, par exemple « 8 rue de Rivoli Paris ».</small></span></button>`; return; }
    res.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${i === 0 ? "first" : ""}">${it.city ? cityI : pinI}<span><b>${esc(it.main)}</b><small>${esc(it.sub)}</small></span></button>`).join("") + (items[0].placeId ? `<p class="src">Résultats Google</p>` : "");
    res.querySelectorAll("[data-i]").forEach(b => b.onclick = () => pickItem(items[+b.dataset.i]));
    // Sélection automatique : dès que tu arrêtes de taper, la première adresse est choisie
    if(v.length >= 4){ res.querySelector(".first")?.classList.add("auto"); autoT = setTimeout(() => { if(q.value.trim() === v) pickItem(items[0]); }, 1200); }
  }catch(e){ if(e.name !== "AbortError"){ res.hidden = false; res.innerHTML = `<button disabled>${pinI}<span><b>Recherche indisponible</b><small>Vérifie ta connexion.</small></span></button>`; } }
}
res.addEventListener("pointerdown", () => clearTimeout(autoT));
res.addEventListener("scroll", () => clearTimeout(autoT), {passive:true});

/* ---------- Génération des boucles ---------- */
const MOD = {"left":"à gauche", "right":"à droite", "slight left":"légèrement à gauche", "slight right":"légèrement à droite", "sharp left":"franchement à gauche", "sharp right":"franchement à droite", "straight":"tout droit", "uturn":"demi-tour"};
function osrmText(st){
  const m = st.maneuver, mod = m.modifier || "straight", on = st.name ? ` ${/^(rue|avenue|boulevard|bd|place|quai|chemin|allée|impasse|route|cours|square|passage|promenade|sentier|voie|esplanade|parvis|pont|rond-point)\b/i.test(st.name) ? "sur " + st.name : "sur « " + st.name + " »"}` : "";
  switch(m.type){
    case "depart": return `Pars${st.name ? " sur " + st.name : ""}`;
    case "arrive": return "Arrivée : tu es revenu à ton point de départ";
    case "roundabout": case "rotary": return `Au rond-point, prends la ${m.exit || 1}${(m.exit || 1) === 1 ? "re" : "e"} sortie${on}`;
    case "fork": return `À l'embranchement, garde ${mod.includes("left") ? "la gauche" : "la droite"}${on}`;
    case "end of road": return `Au bout, tourne ${MOD[mod] || "à droite"}${on}`;
    case "continue": case "new name": return mod === "straight" ? `Continue tout droit${on}` : `Continue ${MOD[mod]}${on}`;
    default: return mod === "uturn" ? "Fais demi-tour" : mod === "straight" ? `Continue tout droit${on}` : `Tourne ${MOD[mod]}${on}`;
  }
}
async function loopOSRM(start, target, brg){
  const s = [start.lat, start.lng]; let r = target/(2*Math.PI*1.22)*(0.9 + Math.random()*0.2), best = null;
  for(let it = 0; it < 3; it++){
    const k = 4, center = dest(s, brg, r), wps = [s];
    for(let i = 1; i < k; i++) wps.push(dest(center, (brg + 180 + i*360/k + (Math.random()-.5)*24) % 360, r*(0.85 + Math.random()*0.3)));
    wps.push(s);
    const j = await fetchJSON(`${C.OSRM_FOOT}/route/v1/driving/${wps.map(p => p[1].toFixed(6) + "," + p[0].toFixed(6)).join(";")}?overview=full&geometries=geojson&steps=true&continue_straight=false`);
    const rt = j.routes?.[0]; if(!rt) break;
    const steps = [];
    rt.legs.forEach((leg, li) => leg.steps.forEach(st => {
      const t = st.maneuver.type;
      if((t === "depart" && li > 0) || (t === "arrive" && li < rt.legs.length - 1)) return;
      steps.push({loc:[st.maneuver.location[1], st.maneuver.location[0]], type:t, mod:st.maneuver.modifier || "straight", name:st.name || "", text:osrmText(st)});
    }));
    const c = {pts:rt.geometry.coordinates.map(x => [x[1], x[0]]), steps, ascent:null};
    c.len = lineLen(c.pts);
    if(!best || Math.abs(c.len - target) < Math.abs(best.len - target)) best = c;
    if(Math.abs(c.len - target)/target < .07) break;
    r *= Math.max(.55, Math.min(1.6, target/c.len));
  }
  return best;
}
async function loopORS(start, target){
  const j = await fetchJSON("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {method:"POST", headers:{"Authorization":C.ORS_KEY, "Content-Type":"application/json"},
    body:JSON.stringify({coordinates:[[start.lng, start.lat]], elevation:true, instructions:true, language:"fr", options:{round_trip:{length:Math.round(target), points:5, seed:Math.floor(Math.random()*1e4)}}})});
  const f = j.features?.[0]; if(!f) return null;
  const pts = f.geometry.coordinates.map(c => [c[1], c[0]]), steps = [];
  for(const sg of f.properties.segments || []) for(const st of sg.steps || []){ const p = pts[st.way_points[0]]; const ty = st.type; const mod = [0,4].includes(ty) ? "left" : [1,5].includes(ty) ? "right" : ty === 2 ? "sharp left" : ty === 3 ? "sharp right" : ty === 9 ? "uturn" : "straight"; steps.push({loc:p, type:ty === 10 ? "arrive" : ty === 11 ? "depart" : (ty === 7 || ty === 8) ? "roundabout" : "turn", mod, name:st.name && st.name !== "-" ? st.name : "", text:st.instruction}); }
  return {pts, steps, len:lineLen(pts), ascent:f.properties.ascent ?? null};
}
async function generate(){
  if(!S.start){ askLocation(); return; }
  if(!isPremium() && remaining() === 0){ premiumModal("Tes 3 boucles gratuites de la semaine sont utilisées. Elles reviennent lundi."); return; }
  const target = targetM();
  rebuildMemory();   // toutes les boucles déjà proposées : la nouvelle passera ailleurs
  S.view = "loading"; S.results = null; routeLayer.clearLayers(); panel.classList.remove("min"); render();
  try{
    const b0 = Math.random()*360, n = PV ? 4 : 4;
    const jobs = Array.from({length:n}, (_, i) => PV ? PV.loop(S.start, target, (b0 + i*90) % 360) : C.ORS_KEY ? loopORS(S.start, target) : loopOSRM(S.start, target, (b0 + i*90) % 360));
    const got = (await Promise.allSettled(jobs)).filter(r => r.status === "fulfilled" && r.value && r.value.pts.length > 3).map(r => r.value);
    if(!got.length) throw new Error("none");
    for(const c of got){
      c.newLen = newLen(c.pts); c.rep = repeatLen(c.pts);
      c.score = 1.4*c.newLen/c.len - .8*c.rep/c.len - 1.1*Math.abs(c.len - target)/target;
    }
    got.sort((a, b) => b.score - a.score);
    S.results = got.slice(0, 3); S.sel = 0; S.view = "result";
    if(!isPremium()){ S.week.n++; store.set("week", S.week); }
    const r = S.results[0], l = {id:"l" + Date.now(), date:Date.now(), name:`Boucle du ${new Date().toLocaleDateString("fr-FR", {weekday:"long", day:"numeric", month:"long"})}`, place:(S.start.label || "").split(",").slice(-1)[0].trim(), start:S.start, pts:simplify(r.pts), len:r.len, newPct:Math.round(r.newLen/r.len*100), ascent:r.ascent, fav:false};
    S.loops.push(l); trimLoops(); store.set("loops", S.loops); S.loopId = l.id;
    render(); showRoute(r); updateCrown();
    if(S.loops.length === 1 || S.loops.length === 4) setTimeout(maybeInstall, 4000);
  }catch(e){ S.view = "form"; render(); toast("Pas de boucle possible depuis ce point. Vérifie ta connexion ou place le départ sur une rue.", 5000); }
}
function simplify(p, m = 6){ const o = []; let last = null; for(const x of p){ if(!last || dist(last, x) >= m){ o.push([r6(x[0]), r6(x[1])]); last = x; } } const e = p[p.length-1]; if(o[o.length-1][0] !== r6(e[0]) || o[o.length-1][1] !== r6(e[1])) o.push([r6(e[0]), r6(e[1])]); return o; }
function trimLoops(){ if(S.loops.length > 120) S.loops = S.loops.filter((l, i) => l.fav || l.run || i > S.loops.length - 100); }
function selectOpt(i){
  S.sel = i; const r = S.results[i], l = curLoop();
  if(l){ Object.assign(l, {pts:simplify(r.pts), len:r.len, newPct:Math.round(r.newLen/r.len*100), ascent:r.ascent}); store.set("loops", S.loops); }
  render(); showRoute(r);
}
const curLoop = () => S.loops.find(x => x.id === S.loopId);
const curRoute = () => S.results?.[S.sel];
// La boucle reste en mémoire après son affichage : la suivante cherchera d'autres rues
function commitMemory(){ rebuildMemory(); }

const routeSV = L.svg({padding:.5});
// Dégradé vert → cyan et halo lumineux du tracé, déclarés une fois dans le calque SVG
function routeDefs(){
  const svg = routeSV._container; if(!svg || svg.querySelector("#tgrad")) return;
  const d = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  d.innerHTML = `<linearGradient id="tgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2BE39B"/><stop offset=".55" stop-color="#22D3C5"/><stop offset="1" stop-color="#1EA6D0"/></linearGradient>
    <filter id="tglow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>`;
  svg.insertBefore(d, svg.firstChild);
}
function showRoute(r, fit = true){
  routeLayer.clearLayers(); routeLayer._r = r; setTimeout(() => loadPOIs(r), fit ? 1900 : 300);
  const sv = routeSV, acc = cssv("--accent"), o = {renderer:sv, lineJoin:"round", lineCap:"round", interactive:false};
  const glow = L.polyline(r.pts, {...o, color:acc, weight:20, opacity:.5, className:"route-glow"}).addTo(routeLayer); routeDefs();
  const casing = L.polyline(r.pts, {...o, color:"#02110B", weight:11, opacity:.85}).addTo(routeLayer);
  const line = L.polyline(r.pts, {...o, color:acc, weight:6, className:"route-core"}).addTo(routeLayer);
  const flow = L.polyline(r.pts, {...o, color:"#fff", weight:3, opacity:0, className:"route-flow"}).addTo(routeLayer);
  let a = 0, next = 1000;
  for(let i = 1; i < r.pts.length; i++){ a += dist(r.pts[i-1], r.pts[i]); if(a >= next && a < r.len - 250){ L.marker(r.pts[i], {interactive:false, icon:L.divIcon({className:"", html:`<span class="km"><b>${next/1000}</b>km</span>`, iconSize:[0,0], iconAnchor:[0,0]})}).addTo(routeLayer); next += 1000; } }
  if(fit) map.flyToBounds(L.latLngBounds(r.pts), {...pad(), duration:1});
  // Le tracé se dessine (halo, bordure et néon ensemble), puis des points blancs défilent dans le sens de la course
  setTimeout(() => { [glow, casing, line].forEach((pl, k) => { const p = pl._path; if(!p) return; p.style.setProperty("--len", p.getTotalLength()); p.classList.add("route-draw");
    if(k === 2) p.addEventListener("animationend", () => { [glow, casing, line].forEach(q => q._path?.classList.remove("route-draw")); flow.setStyle({opacity:.9}); }, {once:true}); }); }, fit ? 1050 : 40);
}

/* ---------- Vignettes ---------- */
function thumb(cv, pts){
  const dpr = devicePixelRatio || 1, w = cv.clientWidth || 64, h = cv.clientHeight || 64; cv.width = w*dpr; cv.height = h*dpr;
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); if(!pts || pts.length < 2) return;
  const xy = pts.map(p => [p[1]*Math.cos(RAD(p[0])), -p[0]]); let a = 1e9, b = -1e9, d = 1e9, e = -1e9;
  for(const [x, y] of xy){ a = Math.min(a, x); b = Math.max(b, x); d = Math.min(d, y); e = Math.max(e, y); }
  const s = Math.min((w-14)/Math.max(b-a, 1e-9), (h-14)/Math.max(e-d, 1e-9)), ox = (w-(b-a)*s)/2, oy = (h-(e-d)*s)/2;
  c.lineJoin = c.lineCap = "round"; c.strokeStyle = cssv("--accent"); c.lineWidth = 2.8; c.beginPath();
  xy.forEach(([x, y], i) => { const X = ox+(x-a)*s, Y = oy+(y-d)*s; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.stroke();
  c.fillStyle = cssv("--ink"); c.beginPath(); c.arc(ox+(xy[0][0]-a)*s, oy+(xy[0][1]-d)*s, 3.4, 0, 7); c.fill();
}

/* ---------- Icônes ---------- */
const I = {
  x:'<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play:'<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/></svg>',
  redo:'<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 11-2.3-5.7M20 4v5h-5"/></svg>',
  star:'<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>',
  dl:'<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  watch:'<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3M12 10v2.5l1.5 1"/></svg>',
  up:'<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
  img:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/></svg>',
  share:'<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg>',
  check:'<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  eye:'<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  route:'<svg viewBox="0 0 24 24"><path d="M5 18c0-6 4-11 9-11 3 0 5 2 5 5s-2 5-5 5c-2 0-3.5-1.5-3.5-3"/><circle cx="5" cy="18" r="2"/></svg>',
  sound:'<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/></svg>',
  mute:'<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>'
};
const TURN = {
  left:'<svg viewBox="0 0 24 24"><path d="M15 20v-7a3 3 0 00-3-3H5M9 6l-4 4 4 4"/></svg>',
  right:'<svg viewBox="0 0 24 24"><path d="M9 20v-7a3 3 0 013-3h7M15 6l4 4-4 4"/></svg>',
  straight:'<svg viewBox="0 0 24 24"><path d="M12 20V4M7 9l5-5 5 5"/></svg>',
  uturn:'<svg viewBox="0 0 24 24"><path d="M8 20V9a4 4 0 018 0v4M12 10l4 4 4-4"/></svg>',
  round:'<svg viewBox="0 0 24 24"><circle cx="12" cy="11" r="4"/><path d="M12 15v6M15 8l3-3M15 5h3v3"/></svg>',
  flag:'<svg viewBox="0 0 24 24"><path d="M6 21V4M6 4h11l-2 4 2 4H6"/></svg>'
};
const turnIcon = st => !st ? TURN.straight : st.type === "arrive" ? TURN.flag : (st.type === "roundabout" || st.type === "rotary") ? TURN.round : st.mod.includes("left") ? TURN.left : st.mod.includes("right") ? TURN.right : st.mod === "uturn" ? TURN.uturn : TURN.straight;

/* ---------- Panneau ---------- */
$("#grab").onclick = () => panel.classList.toggle("min");
// Onglets du Coach : un seul écouteur sur le panneau, valable après chaque affichage
body.addEventListener("click", e => { const b = e.target.closest("[data-ct]"); if(!b) return; e.preventDefault(); S.coachTab = b.dataset.ct; S.editProfile = false; render(); body.scrollTop = 0; });
(() => { let y0 = null; const g = $("#grab"); g.addEventListener("touchstart", e => y0 = e.touches[0].clientY, {passive:true}); g.addEventListener("touchend", e => { if(y0 == null) return; const dy = e.changedTouches[0].clientY - y0; if(dy > 30) panel.classList.add("min"); if(dy < -30) panel.classList.remove("min"); y0 = null; }); })();
function render(){
  body.innerHTML = ({plan:viewPlan, coach:viewCoach, mine:viewMine, premium:viewPremium, me:viewMe})[S.tab]();
  wire(); counters(); updateCrown(); syncQBars();
}
function startCard(){
  const s = S.start;
  if(S.locating) return `<button class="here busy" id="locBtn"><span class="ic"><i></i></span><span><small>Localisation en cours…</small><b>Recherche de ta position</b></span><span class="go">GPS</span></button>`;
  if(!s) return `<button class="here empty" id="locBtn"><span class="ic"><i></i></span><span><small>Ta boucle part de là où tu es</small><b>Me localiser</b></span><span class="go">Activer</span></button>`;
  return `<button class="here ${s.here ? "on" : ""}" id="locBtn"><span class="ic"><i></i></span><span><small>${s.here ? `Tu es ici${s.acc ? ` · à ${s.acc} m près` : ""}` : "Départ"}</small><b>${esc(s.label)}</b></span><span class="go">${s.here ? "Actualiser" : "Me localiser"}</span></button>`;
}
function viewPlan(){
  if(S.view === "loading") return `<div class="loader"><svg viewBox="0 0 120 80"><path class="gd" d="M0 20h120M0 40h120M0 60h120M20 0v80M50 0v80M80 0v80M110 0v80"/><path class="ln" d="M20 60V40h30V20h30v20h30v20H80V60z"/></svg><p class="title" style="font-size:24px">Traceo dessine ta boucle…</p><p class="small"><span>Analyse des rues autour de toi · Comparaison de 4 itinéraires · Écarte les rues déjà proposées</span></p></div>`;
  if(S.view === "result" && S.results){
    const r = curRoute(), pct = Math.round(r.newLen/r.len*100), dur = r.len/1000*S.pace;
    return `<div class="options">${S.results.map((o, i) => `<button class="opt" data-opt="${i}" aria-pressed="${i === S.sel}"><canvas data-th="${i}"></canvas><b>${km1(o.len)} km</b><span class="new">${Math.round(o.newLen/o.len*100)} % inédite</span></button>`).join("")}</div>
      <div class="stats">
        <div class="stat a"><small>Distance</small><b><span data-count="${r.len/1000}" data-d="1">${km1(r.len)}</span><small>km</small></b></div>
        <div class="stat"><small>Durée estimée</small><b>${hmin(dur)}</b></div>
        <div class="stat"><small>Calories estimées</small><b><span data-count="${kcal(r.len)}">${kcal(r.len)}</span><small>kcal</small></b></div>
        <div class="stat"><small>${r.ascent != null ? "Dénivelé +" : "Allure"}</small><b>${r.ascent != null ? Math.round(r.ascent) + "<small>m</small>" : paceTxt(S.pace) + "<small>/km</small>"}</b></div>
      </div>
      <p class="small">${pct >= 95 ? "Boucle 100 % nouvelle : aucune rue déjà proposée." : `${pct} % de rues que Traceo ne t'avait jamais proposées.`} ${r.steps?.length ? `${r.steps.length} indications de guidage.` : ""}</p>
      <button class="btn hero block" id="goFly">${I.eye}Visualiser ma boucle</button>
      <button class="btn night block" id="goRun">${I.play}Commencer la course</button>
      <div class="row"><button class="btn garmin" id="toGarmin">${I.watch}Garmin${isPremium() ? "" : '<span class="lock">★</span>'}</button><button class="btn soft" id="toGpx">${I.dl}GPX${isPremium() ? "" : '<span class="lock">★</span>'}</button></div>
      <div class="row"><button class="btn soft" id="again">${I.redo}Une autre boucle</button><button class="btn soft" id="toMusic">${MI.note}Musique</button></div>
      <div class="row"><button class="btn soft" id="toImg">${I.img}Image</button></div>
      <div class="row"><button class="btn soft" id="fav">${I.star}${curLoop()?.fav ? "En favori" : "Favori"}</button><button class="btn soft" id="edit">Modifier</button></div>`;
  }
  const t = targetM(), left = remaining();
  return `<div class="hello"><small id="helloDate">${nowTxt().replace(/:\d\d$/, "")}</small><b>${hello()} !</b><span data-quote>${esc(quoteNow())}</span></div>${startCard()}
    <div class="seg" data-v="${S.mode}"><span class="knob"></span><button data-mode="dist" aria-pressed="${S.mode === "dist"}">Distance</button><button data-mode="time" aria-pressed="${S.mode === "time"}">Durée</button></div>
    <div class="dial"><button class="step" data-step="-1" aria-label="Moins">−</button><div class="val" id="dval">${dialTxt()}</div><button class="step" data-step="1" aria-label="Plus">+</button></div>
    <input type="range" id="slider" ${S.mode === "dist" ? `min="2" max="42" step="0.5" value="${S.distKm}"` : `min="10" max="240" step="5" value="${S.durMin}"`} aria-label="${S.mode === "dist" ? "Distance" : "Durée"}">
    <div class="chips">${(S.mode === "dist" ? [5,8,10,12,15,21] : [20,30,45,60,90,120]).map(k => `<button class="chip" data-quick="${k}" aria-pressed="${(S.mode === "dist" ? S.distKm : S.durMin) == k}">${S.mode === "dist" ? k + " km" : k >= 60 ? hmin(k*60) : k + " min"}</button>`).join("")}</div>
    <div class="trio">
      <div><small>${S.mode === "dist" ? "Durée" : "Distance"}</small><b id="tA">${S.mode === "dist" ? hmin(t/1000*S.pace) : km1(t) + " km"}</b></div>
      <div class="pace" style="grid-column:span 2"><button class="step" data-pace="10" aria-label="Allure plus lente">−</button><span style="text-align:center"><small>Ton allure moyenne</small><b id="tP">${paceTxt(S.pace)}<small style="display:inline;font-size:13px"> /km</small></b></span><button class="step" data-pace="-10" aria-label="Allure plus rapide">+</button></div>
    </div>
    <button class="btn hero block" id="gen">${I.route}Générer ma boucle</button>
    ${isPremium() ? "" : `<button class="promo" data-go="premium"><span class="c">★</span><span><b>Traceo Premium</b><small>Boucles illimitées, envoi Garmin, Strava et GPX · ${C.PRICE_LABEL}/mois</small></span><span class="a">›</span></button>`}
    <p class="small" style="text-align:center">${C.BETA ? "Version bêta : boucles illimitées, tout est offert." : isPremium() ? "Premium : boucles illimitées." : `${left} boucle${left > 1 ? "s" : ""} gratuite${left > 1 ? "s" : ""} sur 3 cette semaine.`} Appui long sur la carte pour choisir un autre départ.</p>`;
}
function dialTxt(){ if(S.mode === "dist") return nf(1).format(S.distKm).replace(",0", "") + "<small>km</small>"; const h = Math.floor(S.durMin/60), m = S.durMin%60; return h ? `${h}<small>h</small>${String(m).padStart(2,"0")}` : `${S.durMin}<small>min</small>`; }
function refreshDial(){ const t = targetM(); $("#dval").innerHTML = dialTxt(); $("#tA").textContent = S.mode === "dist" ? hmin(t/1000*S.pace) : km1(t) + " km"; $("#tP").innerHTML = `${paceTxt(S.pace)}<small style="display:inline;font-size:13px"> /km</small>`; body.querySelectorAll("[data-quick]").forEach(c => c.setAttribute("aria-pressed", +c.dataset.quick === (S.mode === "dist" ? S.distKm : S.durMin))); }
/* ---------- Coach : motivation, mobilité, nutrition ---------- */
const QUOTES = [
  "Le plus dur, c'est de lacer ses chaussures. Le reste, c'est la route.",
  "Ton canapé a appelé. On ne lui répond pas aujourd'hui.",
  "Chaque rue inconnue est une petite aventure.",
  "Cours lentement s'il le faut, mais cours.",
  "Les escaliers te craignent déjà.",
  "Tu ne regretteras jamais la sortie que tu as faite.",
  "Un kilomètre à la fois. Puis un autre.",
  "Transpirer, c'est juste ta motivation qui déborde.",
  "La motivation te fait partir, l'habitude te fait revenir.",
  "Aujourd'hui, ta ville a encore des secrets. Va les chercher.",
  "Tes baskets s'ennuient. Sors-les.",
  "Les jambes suivent toujours la tête.",
  "Pas besoin d'aller vite. Il suffit d'y aller.",
  "La pluie ? Juste une douche gratuite en cours de route.",
  "Personne ne court ta course à ta place.",
  "Ce soir, tu seras content d'être sorti.",
  "Ton futur toi te dit déjà merci.",
  "Le seul mauvais footing, c'est celui qu'on n'a pas fait.",
  "Tu cours plus vite que toi d'hier. Et c'est le seul qui compte.",
  "Mode avion pour le stress, mode course pour toi."
];
const QPERIOD = 15000;   // la phrase change toutes les 15 secondes
const quoteNow = () => QUOTES[Math.floor(Date.now()/QPERIOD) % QUOTES.length];
const ROUTINES = {
  avant:{name:"Échauffement", intro:"7 minutes de mobilité dynamique pour réveiller les articulations avant de courir.", end:"Échauffement terminé. Bonne course !", steps:[
    ["Marche active et moulinets des bras", 45, "Grands cercles vers l'avant, puis vers l'arrière."],
    ["Rotations des chevilles", 30, "15 cercles par pied, dans les deux sens."],
    ["Cercles de hanches", 30, "Mains sur les hanches, grands cercles lents."],
    ["Balancés de jambe avant-arrière", 40, "20 par jambe, une main en appui sur un mur."],
    ["Balancés de jambe latéraux", 40, "20 par jambe, le buste reste droit."],
    ["Fentes marchées avec rotation du buste", 45, "Tourne le buste du côté de la jambe avant."],
    ["Montées de genoux", 30, "Sur place, petits appuis rapides."],
    ["Talons-fesses", 30, "Sur place, en restant léger sur l'avant du pied."],
    ["Accélérations progressives", 60, "3 fois 20 secondes en accélérant doucement."]
  ]},
  apres:{name:"Retour au calme", intro:"8 minutes d'étirements doux pour récupérer après la course.", end:"Séance terminée. Bravo et bonne récupération !", steps:[
    ["Marche lente", 120, "Laisse ton souffle redescendre."],
    ["Mollets contre un mur", 60, "30 secondes par jambe, talon au sol."],
    ["Quadriceps debout", 60, "30 secondes par jambe, genoux serrés."],
    ["Arrière des cuisses", 60, "Jambe tendue sur un muret, dos droit, 30 secondes par jambe."],
    ["Fessiers en figure 4", 60, "Cheville sur le genou opposé, 30 secondes par côté."],
    ["Avant des hanches en fente basse", 60, "Bassin vers l'avant, 30 secondes par côté."],
    ["Dos et épaules", 30, "Bras tendus vers le ciel, puis enroule le dos vers l'avant."],
    ["Respiration lente", 60, "Inspire sur 4 temps, expire sur 6 temps."]
  ]}
};
const NUTRI = [
  {k:"court", t:"Sortie courte", d:"moins de 45 min", avant:"Un repas normal 2 à 3 h avant suffit. À jeun, c'est possible si tu y es habitué.", pendant:"De l'eau si tu as soif.", apres:"Un verre d'eau et ton prochain repas normal."},
  {k:"moyen", t:"Sortie moyenne", d:"45 à 90 min", avant:"Repas riche en glucides 2 à 3 h avant (pâtes, riz, pain), ou une banane 30 à 60 min avant.", pendant:"De l'eau régulièrement par petites gorgées. Au-delà d'une heure, une boisson sucrée ou une compote.", apres:"Dans l'heure : glucides + protéines (yaourt et fruit, sandwich jambon, lait chocolaté). Bois de l'eau."},
  {k:"long", t:"Sortie longue", d:"plus de 90 min", avant:"La veille et le matin, des glucides en plus (pâtes, riz, patates). Dernier repas léger 3 h avant.", pendant:"30 à 60 g de glucides par heure (gels, pâtes de fruits, boisson d'effort) et de l'eau toutes les 15 à 20 min.", apres:"Dans les 30 min : collation glucides + protéines, puis un vrai repas. Eau et un peu de sel pour récupérer."}
];
/* Profil du coureur : sert aux calories, à la nutrition et au plan de la semaine */
S.profile = store.get("profile", null); S.nday = store.get("nday", "run"); S.ntime = store.get("ntime", "soir");
const GOALS = {perte:"Perdre du poids", muscle:"Prendre du muscle", forme:"Garder la forme", perf:"Progresser en course"};
const LEVELS = {debut:"Débutant", regulier:"Régulier", confirme:"Confirmé"};
function needs(p){
  const bmi = p.weight/((p.height/100)**2);
  const bmr = 10*p.weight + 6.25*p.height - 5*p.age + (p.sex === "h" ? 5 : -161);
  const base = bmr*1.35, runKm = Math.min(30, targetM()/1000), runK = Math.round(p.weight*runKm*1.036);
  let goal = p.goal, note = "";
  if(goal === "perte" && bmi < 18.5){ goal = "forme"; note = "Ton IMC est déjà bas : on vise l'entretien plutôt que la perte de poids."; }
  const adj = goal === "perte" ? -400 : goal === "muscle" ? 300 : 0;
  const floor = Math.max(bmr*1.1, p.sex === "h" ? 1500 : 1300);
  const rest = Math.round(Math.max(floor, base + adj)/10)*10, run = Math.round(Math.max(floor, base + runK + adj)/10)*10;
  const avg = Math.round((rest*(7 - p.freq) + run*p.freq)/7/10)*10;
  const protK = goal === "perte" || goal === "muscle" ? 1.8 : goal === "perf" ? 1.6 : 1.4;
  const prot = Math.round(p.weight*protK), fat = Math.round(avg*.3/9), carb = Math.round((avg - prot*4 - fat*9)/4);
  const runMin = runKm*S.pace/60, water = Math.round((p.weight*35 + runMin*10)/100)/10;
  const cat = bmi < 18.5 ? "en dessous de la plage habituelle" : bmi < 25 ? "dans la plage habituelle" : bmi < 30 ? "au-dessus de la plage habituelle" : "nettement au-dessus de la plage habituelle";
  return {bmi, cat, bmr:Math.round(bmr), rest, run, avg, runK, prot, fat, carb, water, goal, note, runKm};
}
// Exemple de journée, portions ajustées aux besoins (base ≈ 2 000 kcal)
const MENUS = {
  perte:[["Petit-déjeuner", [["Flocons d'avoine",50,"g"],["Skyr ou yaourt nature",150,"g"],["Fruits rouges",100,"g"]]], ["Déjeuner", [["Poulet ou tofu",130,"g"],["Riz complet cuit",150,"g"],["Légumes",250,"g"],["Huile d'olive",10,"g"]]], ["Collation avant la course", [["Banane",1,""],["Amandes",15,"g"]]], ["Dîner", [["Poisson ou 2 œufs",120,"g"],["Patate douce",200,"g"],["Légumes",250,"g"]]]],
  muscle:[["Petit-déjeuner", [["Flocons d'avoine",80,"g"],["Lait",250,"ml"],["Œufs",2,""],["Banane",1,""]]], ["Déjeuner", [["Bœuf 5 % ou lentilles cuites",150,"g"],["Pâtes complètes cuites",250,"g"],["Légumes",200,"g"],["Huile d'olive",15,"g"]]], ["Après la course", [["Skyr",200,"g"],["Miel",20,"g"],["Noix",30,"g"]]], ["Dîner", [["Saumon",150,"g"],["Riz cuit",200,"g"],["Légumes",200,"g"]]]],
  forme:[["Petit-déjeuner", [["Pain complet",70,"g"],["Fromage blanc",150,"g"],["Fruit",1,""]]], ["Déjeuner", [["Poulet, poisson ou pois chiches",130,"g"],["Quinoa ou riz cuit",180,"g"],["Légumes",250,"g"],["Huile d'olive",10,"g"]]], ["Collation", [["Compote sans sucre ajouté",1,""],["Noix",20,"g"]]], ["Dîner", [["Œufs",2,""],["Pommes de terre",200,"g"],["Salade et légumes",250,"g"]]]],
  perf:[["Petit-déjeuner", [["Pain complet",90,"g"],["Confiture ou miel",20,"g"],["Yaourt",125,"g"],["Banane",1,""]]], ["Déjeuner", [["Pâtes cuites",280,"g"],["Poulet ou thon",120,"g"],["Légumes",200,"g"],["Huile d'olive",10,"g"]]], ["Collation avant la course", [["Pain d'épices ou barre de céréales",40,"g"],["Eau",500,"ml"]]], ["Dîner", [["Riz cuit",220,"g"],["Poisson",130,"g"],["Légumes",200,"g"]]]]
};
function menuFor(n){
  const f = Math.max(.75, Math.min(1.45, n.avg/2000));
  return MENUS[n.goal].map(([meal, items]) => [meal, items.map(([name, q, u]) => [name, u ? Math.round(q*f/5)*5 : q, u])]);
}
// Plan de la semaine selon objectif, niveau et fréquence
function weekPlan(p){
  const d = Math.max(3, S.distKm), easy = paceTxt(S.pace + 40);
  const frac = {debut:"8 × 1 min vite / 1 min en marchant", regulier:"6 × 3 min soutenu / 2 min lent", confirme:"5 × 1 km à allure 10 km / 2 min lent"}[p.level];
  const S1 = {t:"Footing facile", km:Math.round(d*.8*2)/2, how:`Allure tranquille (${easy}/km), tu dois pouvoir parler.`};
  const S2 = {t:"Fractionné", km:Math.round(d*.7*2)/2, how:`Échauffement 15 min, puis ${frac}, retour au calme 10 min.`};
  const S3 = {t:"Sortie longue", km:Math.round((p.level === "debut" ? Math.min(d*1.25, d + 3) : Math.min(d*1.5, d + 8))*2)/2, how:"La plus longue de la semaine, toujours en aisance respiratoire."};
  const S4 = {t:"Footing de récupération", km:Math.round(d*.5*2)/2, how:"Très lent et court, pour récupérer."};
  let s = p.freq <= 2 ? [S1, S3] : p.freq === 3 ? [S1, S2, S3] : p.freq === 4 ? [S1, S2, S1, S3] : [S1, S2, S4, S1, S3];
  if(p.level === "debut" && p.freq <= 3) s = s.map(x => x === S2 ? {...S2, t:"Course-marche"} : x);
  const days = {2:["Mercredi","Dimanche"], 3:["Mardi","Jeudi","Dimanche"], 4:["Lundi","Mercredi","Vendredi","Dimanche"], 5:["Lundi","Mardi","Jeudi","Vendredi","Dimanche"]}[p.freq];
  return s.map((x, i) => ({...x, day:days[i]}));
}
function profileForm(){
  const p = S.profile || {sex:"h", age:30, height:175, weight:S.weight, goal:"forme", level:"regulier", freq:3};
  const opt = (name, map, val) => Object.entries(map).map(([k, l]) => `<button type="button" class="chip" data-pf="${name}" data-v="${k}" aria-pressed="${String(val) === k}">${l}</button>`).join("");
  return `<p class="muted">Quelques infos pour adapter tes calories, ta nutrition et ton plan d'entraînement. Elles restent sur ton téléphone.</p>
    <div class="field"><label>Tu es</label><div class="chips">${opt("sex", {h:"Un homme", f:"Une femme"}, p.sex)}</div></div>
    <div class="pfgrid"><div class="field"><label for="pfAge">Âge</label><input class="input" id="pfAge" type="number" inputmode="numeric" min="14" max="90" value="${p.age}"></div>
      <div class="field"><label for="pfH">Taille (cm)</label><input class="input" id="pfH" type="number" inputmode="numeric" min="120" max="220" value="${p.height}"></div>
      <div class="field"><label for="pfW">Poids (kg)</label><input class="input" id="pfW" type="number" inputmode="decimal" min="30" max="200" value="${p.weight}"></div></div>
    <div class="field"><label>Pourquoi tu cours ?</label><div class="chips">${opt("goal", GOALS, p.goal)}</div></div>
    <div class="field"><label>Ton niveau</label><div class="chips">${opt("level", LEVELS, p.level)}</div></div>
    <div class="field"><label>Sorties par semaine</label><div class="chips">${opt("freq", {2:"2", 3:"3", 4:"4", 5:"5"}, p.freq)}</div></div>
    <button class="btn hero block" id="pfSave">${I.check}Enregistrer mon profil</button>`;
}
/* Programmes d'entraînement (allures calculées depuis ton allure moyenne) */
S.training = store.get("training", null);   // {plan, start, done:{}}
function PL(){
  const ef = paceTxt(S.pace + 45), seuil = paceTxt(S.pace - 15), vma = paceTxt(S.pace - 45), wu = "Échauffement 15 min en footing lent";
  const E = (km, t = "Footing facile") => ({t, km, d:`${km} km à ${ef}/km : tu dois pouvoir parler.`});
  const LG = (km) => ({t:"Sortie longue", km, d:`${km} km tranquille, autour de ${paceTxt(S.pace + 30)}/km.`});
  const IN = (txt, km) => ({t:"Fractionné", km, d:`${wu}, puis ${txt}, retour au calme 10 min.`});
  return {
    debut:{name:"Apprendre à courir", sub:"Courir 30 min sans t'arrêter", lvl:"Débutant", weeks:8, gen:w => {
      const rw = ["8 × (1 min de course + 2 min de marche)","6 × (2 min de course + 2 min de marche)","5 × (3 min de course + 2 min de marche)","4 × (5 min de course + 2 min de marche)","3 × (8 min de course + 2 min de marche)","2 × (12 min de course + 2 min de marche)","2 × (15 min de course + 1 min de marche)"][w-1];
      if(w === 8) return [{t:"Course continue", d:"5 min de marche, puis 20 min de course sans t'arrêter."},{t:"Course continue", d:"5 min de marche, puis 25 min de course."},{t:"Le grand jour", d:"30 min de course sans t'arrêter. Objectif atteint !"}];
      return [1,2,3].map(() => ({t:"Course-marche", d:`5 min de marche active, puis ${rw}.`}));
    }},
    dix:{name:"Objectif 10 km", sub:"Courir 10 km en 8 semaines", lvl:"Intermédiaire", weeks:8, gen:w => {
      const ef = [5,5,6,5,6,7,5,4][w-1], lg = [6,7,8,6,9,10,7,null][w-1];
      const fr = ["6 × 1 min vite / 1 min lent","8 × 1 min vite / 1 min lent","5 × 2 min vite / 1 min 30 lent","fartlek de 20 min : accélère quand tu en as envie","4 × 4 min à " + seuil + "/km / 2 min lent","5 × 4 min à " + seuil + "/km / 2 min lent","3 × 2 km à allure 10 km / 3 min lent","6 × 1 min léger / 1 min lent"][w-1];
      return [E(ef), IN(fr, null), w === 8 ? {t:"Course : 10 km", km:10, d:"Pars prudemment, accélère sur les 2 derniers km. Bravo !"} : LG(lg)];
    }},
    semi:{name:"Semi-marathon", sub:"21,1 km en 12 semaines", lvl:"Confirmé", weeks:12, gen:w => {
      const lg = [10,11,12,10,14,15,16,12,17,18,13,null][w-1], ef = [6,7,7,6,8,8,9,7,9,10,8,5][w-1];
      const q = w % 2 ? `${["2 × 10 min","2 × 12 min","3 × 10 min","2 × 15 min","3 × 12 min","3 × 15 min"][Math.min(5, (w-1)>>1)]} à ${seuil}/km, 3 min lent entre` : `${[8,10,10,12,12,8][Math.min(5, (w-2)>>1)]} × 400 m à ${vma}/km, 1 min de récupération`;
      return [E(ef), IN(q, null), {t:"Footing de récupération", km:5, d:`5 km très lent, à ${paceTxt(S.pace + 60)}/km.`}, w === 12 ? {t:"Course : semi-marathon", km:21.1, d:"21,1 km. Bois à chaque ravitaillement, garde des forces pour la fin."} : LG(lg)];
    }},
    expert:{name:"Record sur 10 km", sub:"Battre ton chrono en 8 semaines", lvl:"Expert", weeks:8, gen:w => {
      const lg = [14,15,16,12,16,17,14,null][w-1];
      return [E([8,9,10,8,10,10,8,6][w-1]), IN(`${[10,12,12,8,14,15,10,6][w-1]} × 400 m à ${vma}/km, 1 min récup`, null), {t:"Seuil", km:null, d:`${wu}, puis ${["3 × 2 km","3 × 2,5 km","2 × 4 km","3 × 1,5 km","3 × 3 km","2 × 5 km","3 × 2 km","2 × 1 km"][w-1]} à ${seuil}/km, 2 min lent.`}, {t:"Footing de récupération", km:6, d:"6 km très lent + 5 lignes droites de 80 m."}, w === 8 ? {t:"Course : record sur 10 km", km:10, d:"Échauffe-toi 20 min avant. Régulier jusqu'au 8e km, puis tout donner."} : LG(lg)];
    }}
  };
}
function curWeek(t, plan){ return Math.max(1, Math.min(plan.weeks, Math.floor((Date.now() - t.start)/(7*864e5)) + 1)); }
function trainingView(){
  const P = PL();
  if(!S.training) return `<p class="title">Choisis ton programme</p><p class="muted">Un plan semaine par semaine, avec des allures calculées sur ton allure moyenne (${paceTxt(S.pace)}/km).</p>
    <div class="list">${Object.entries(P).map(([k, p]) => `<button class="prog" data-plan="${k}"><span class="lv">${p.lvl}</span><b>${p.name}</b><small>${p.sub} · ${p.weeks} semaines · ${p.gen(1).length} séances par semaine</small></button>`).join("")}</div>${mobiBlock()}`;
  const t = S.training, p = P[t.plan], cw = S.trainWeek || curWeek(t, p), total = Array.from({length:p.weeks}, (_, w) => p.gen(w + 1).length).reduce((a, b) => a + b, 0), done = Object.keys(t.done).length;
  const ses = p.gen(cw);
  return `<div class="progcard"><span class="lv">${p.lvl}</span><p class="title" style="font-size:24px">${p.name}</p><p class="small">${p.sub}</p>
      <div class="hud-prog"><span style="width:${Math.round(done/total*100)}%"></span></div><p class="small"><b style="color:var(--ink)">${done}/${total}</b> séances faites · semaine ${curWeek(t, p)} sur ${p.weeks}</p></div>
    <div class="weeks">${Array.from({length:p.weeks}, (_, w) => { const n = p.gen(w + 1).length, d = p.gen(w + 1).filter((_, s) => t.done[`${w+1}-${s}`]).length; return `<button data-wsel="${w+1}" aria-pressed="${cw === w + 1}" class="${d === n ? "full" : ""}">S${w+1}</button>`; }).join("")}</div>
    <div class="week">${ses.map((s, i) => { const k = `${cw}-${i}`, ok = !!t.done[k]; return `<div class="wk ${ok ? "ok" : ""}"><button class="tick" data-tick="${k}" aria-label="${ok ? "Marquer à faire" : "Marquer comme faite"}">${ok ? I.check : ""}</button><span class="b"><b>${s.t}${s.km ? ` · ${nf(1).format(s.km).replace(",0", "")} km` : ""}</b><small>${s.d}</small></span>${s.km ? `<button class="iconbtn" data-wk="${s.km}" aria-label="Générer cette boucle">${I.route}</button>` : ""}</div>`; }).join("")}</div>
    <p class="small">Repos ou renforcement les autres jours. Une séance de course terminée dans Traceo coche automatiquement la prochaine séance de la semaine.</p>
    <button class="linkbtn" id="trReset">Changer de programme</button>${mobiBlock()}`;
}
function mobiBlock(){ return `<p class="eyebrow" style="margin-top:6px">Mobilité guidée</p><div class="mobi2">${["avant","apres"].map(k => { const r = ROUTINES[k], tot = r.steps.reduce((a, s) => a + s[1], 0); return `<button class="prog" data-routine="${k}"><span class="lv">${k === "avant" ? "Avant la course" : "Après la course"}</span><b>${r.name}</b><small>${r.steps.length} exercices · ${Math.round(tot/60)} min · minuteur et voix</small></button>`; }).join("")}</div>`; }
function hydraView(){
  const p = S.profile, today = new Date().toDateString(), h = store.get("water", {d:today, ml:0}), ml = h.d === today ? h.ml : 0;
  const runMin = Math.round(targetM()/1000*S.pace/60), base = p ? Math.round(p.weight*35/250)*250 : 2000, goal = base + Math.round(runMin/60*500/250)*250;
  const pct = Math.min(100, Math.round(ml/goal*100));
  return `<div class="water"><div class="wring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="rt-bg"/><circle cx="60" cy="60" r="52" class="wfg" style="stroke-dasharray:${2*Math.PI*52};stroke-dashoffset:${2*Math.PI*52*(1 - pct/100)}"/></svg><b>${nf(1).format(ml/1000)} L<small>sur ${nf(1).format(goal/1000)} L</small></b></div>
      <div class="wbtn"><button class="btn soft" data-w="250">+ 1 verre<small>250 ml</small></button><button class="btn soft" data-w="500">+ 1 gourde<small>500 ml</small></button><button class="linkbtn" data-w="0">Remettre à zéro</button></div></div>
    <p class="small">${p ? `Objectif calculé sur ton poids (${p.weight} kg), avec ta boucle prévue d'environ ${hmin(runMin*60)}.` : "Objectif standard de 2 L, plus ta boucle prévue. Remplis ton profil dans Nutrition pour un objectif sur mesure."}</p>
    <div class="nutri"><p><b>Avant la course</b></p><p class="muted">Environ 500 ml dans les 2 h qui précèdent, puis quelques gorgées 15 min avant le départ.</p></div>
    <div class="nutri"><p><b>Pendant</b></p><p class="muted">Moins de 45 min : pas besoin de boire si tu es bien hydraté. Au-delà d'une heure : 400 à 600 ml par heure, par petites gorgées, avec une boisson d'effort (sels minéraux) s'il fait chaud.</p></div>
    <div class="nutri"><p><b>Après</b></p><p class="muted">500 ml dans l'heure, puis bois régulièrement. Une urine claire indique une bonne hydratation.</p></div>
    <div class="nutri"><p><b>Quand il fait chaud</b></p><p class="muted">Cours tôt le matin ou le soir, ajoute 250 ml par heure d'effort et prévois des sels minéraux. Soif intense, maux de tête ou vertiges : arrête-toi et bois.</p></div>`;
}
const DEFIS = ["Cours dans 3 rues où tu n'es jamais passé.","Termine ta boucle 1 minute plus vite que prévu.","Fais l'échauffement guidé avant de partir.","Bois 2 litres d'eau aujourd'hui.","Tente une boucle 1 km plus longue que d'habitude.","Ralentis : une sortie 100 % plaisir, sans regarder l'allure.","Fais les étirements guidés après ta course."];
function motivView(){
  const runs = S.loops.filter(l => l.run), m = new Date().getMonth(), y = new Date().getFullYear();
  const month = runs.filter(l => { const d = new Date(l.run.date || l.date); return d.getMonth() === m && d.getFullYear() === y; });
  const km = runs.reduce((a, l) => a + l.run.dist, 0);
  return `<div class="quote"><span class="qmark">“</span><p data-quote>${esc(quoteNow())}</p><div class="qbar"><i></i></div></div>
    <div class="defi"><span class="c">${I.star}</span><span><small>Défi du jour</small><b>${DEFIS[new Date().getDay()]}</b></span></div>
    <div class="trio"><div><small>Ce mois-ci</small><b>${month.length} sortie${month.length > 1 ? "s" : ""}</b></div><div><small>Au total</small><b>${km1(km)} km</b></div><div><small>Boucles</small><b>${S.loops.length}</b></div></div>
    <button class="btn hero block" data-go="plan">${I.route}Générer ma boucle du jour</button>`;
}
const GOALTIP = {
  perte:{avant:"Moins d'une heure de course : un fruit suffit, inutile de prendre une boisson sucrée.", pendant:"Moins d'une heure : de l'eau uniquement.", apres:"Dans les 2 h, un repas riche en protéines et en légumes. Évite de compenser par du grignotage sucré."},
  muscle:{avant:"Repas glucides + protéines 2 à 3 h avant (riz + poulet, pâtes + œufs).", pendant:"De l'eau ; au-delà d'une heure, une boisson d'effort pour ne pas puiser dans tes muscles.", apres:"Dans les 30 min : 20 à 30 g de protéines + des glucides (skyr et banane, lait chocolaté)."},
  forme:{avant:"Un repas normal 2 à 3 h avant, ou une banane 30 min avant.", pendant:"De l'eau selon ta soif.", apres:"Un repas équilibré : légumes, protéines et féculents."},
  perf:{avant:"Des glucides la veille et le matin des séances dures (pâtes, riz, pain).", pendant:"Dès 60 min, 30 à 60 g de glucides par heure (gels, pâtes de fruits).", apres:"Glucides + protéines dans les 30 min, environ 3 pour 1 (riz au lait, sandwich, lait chocolaté)."}
};
/* ---------- Plan alimentaire : calcul au gramme, façon diététicien du sport ----------
   Repères : protéines 1,4 à 2,0 g/kg ; glucides 3 à 7 g/kg selon la charge ; récupération
   1 g/kg de glucides + 0,3 g/kg de protéines dans l'heure ; 30 à 60 g de glucides par heure
   d'effort au-delà de 60 à 90 min. Valeurs pour 100 g : [kcal, protéines, glucides, lipides]. */
const FOOD = {
  avoine:["Flocons d'avoine",[370,13,60,7]], painc:["Pain complet",[250,9,45,3]], painb:["Pain blanc ou baguette",[270,9,55,1.5]],
  skyr:["Skyr nature",[60,10,4,0.2]], fblanc:["Fromage blanc 0 %",[50,8,4,0.1]], lait:["Lait demi-écrémé",[46,3.3,4.8,1.6]], yaourt:["Yaourt nature",[60,4,5,3]],
  oeuf:["Œufs",[145,12.5,0.7,10],55,"œuf"], banane:["Banane",[90,1.1,20,0.3],120,"banane"], rouges:["Fruits rouges",[50,1,10,0.3]], pomme:["Pomme",[52,0.3,12,0.2],150,"pomme"],
  amandes:["Amandes",[600,21,7,52]], noix:["Noix",[690,15,7,65]], cacahuete:["Beurre de cacahuète",[600,25,16,50]], miel:["Miel",[320,0.3,80,0]], confiture:["Confiture",[250,0.4,60,0]],
  poulet:["Blanc de poulet",[120,23,0,2.5]], dinde:["Escalope de dinde",[110,24,0,1.5]], saumon:["Saumon",[200,20,0,13]], cabillaud:["Cabillaud",[80,18,0,0.7]],
  thon:["Thon au naturel",[110,25,0,1]], boeuf:["Bœuf haché 5 %",[125,21,0,5]], tofu:["Tofu ferme",[120,12,2,7]], jambon:["Jambon blanc",[110,20,1,3]],
  lentilles:["Lentilles cuites",[115,9,17,0.5]], poischiches:["Pois chiches cuits",[140,7.5,18,2.5]],
  basmati:["Riz basmati cuit",[130,2.7,28,0.3]], rizc:["Riz complet cuit",[120,2.6,25,1]], pates:["Pâtes complètes cuites",[140,5.5,27,1.2]], patesb:["Pâtes cuites",[150,5,30,0.9]],
  quinoa:["Quinoa cuit",[120,4.4,21,1.9]], patate:["Patate douce",[86,1.6,20,0.1]], pdt:["Pommes de terre",[80,2,17,0.1]],
  legumes:["Légumes variés",[30,2,4,0.3]], salade:["Crudités",[25,1.2,4,0.2]], huile:["Huile d'olive ou colza",[900,0,0,100]], avocat:["Avocat",[160,2,2,15]],
  compote:["Compote sans sucre ajouté",[60,0.3,14,0],100,"gourde"], dattes:["Dattes",[280,2.5,66,0.4],8,"datte"], choco:["Chocolat noir 70 %",[550,7,35,42]], riz_lait:["Riz au lait",[120,3.5,20,3]]
};
const ROT = {prot:["poulet","saumon","dinde","cabillaud","boeuf","tofu","thon"], carb:["basmati","pates","quinoa","patate","rizc","pdt","lentilles"]};
// Repas : [nom, part des kcal, source de protéines, source de glucides, aliments fixes {clé: g}, conseil]
function mealsFor(day, timing, goal){
  const d = new Date().getDay(), P = k => ROT.prot[(d + k) % ROT.prot.length], G = k => ROT.carb[(d + k) % ROT.carb.length];
  const B = goal === "muscle" ? ["Petit-déjeuner", "skyr", "avoine", {oeuf:110, banane:120, cacahuete:15}] : goal === "perte" ? ["Petit-déjeuner", "skyr", "avoine", {rouges:120, amandes:10}] : ["Petit-déjeuner", "fblanc", "painc", {banane:120, miel:10, amandes:10}];
  const L = (n, k, fixed) => [n, P(k), G(k), {legumes:250, huile:10, ...fixed}];
  const pre = ["Collation avant la course", null, "painb", {banane:120, miel:15}, "1 h 30 à 2 h avant : des glucides faciles à digérer, peu de fibres et peu de gras."];
  const rec = (n, k) => [n, P(k), "basmati", {legumes:200, huile:8}, "Repas de récupération : glucides rapides pour refaire le stock, protéines pour réparer les muscles."];
  const snack = ["Collation", "skyr", null, {pomme:150, noix:15}, "Protéines + fibres : ça tient jusqu'au repas suivant."];
  if(day === "rest") return [[...B, .25, "Un petit-déjeuner riche en protéines aide à limiter les fringales."], [...L("Déjeuner", 0), .36, "Moitié de l'assiette en légumes, un quart protéines, un quart féculents complets."], [...snack.slice(0, 4), .11, snack[4]], [...L("Dîner", 3, {}), .28, "Jour de repos : féculents un peu réduits, protéines maintenues pour récupérer."]].map(fix);
  if(timing === "matin") return [[...pre.slice(0, 4), .06, "30 à 45 min avant : une demi-banane et un peu de miel suffisent."], [...rec("Petit-déjeuner de récupération", 0).slice(0, 4), .27, "Dans l'heure après la course : c'est le moment où le corps récupère le mieux."], [...L("Déjeuner", 1), .33, "Un repas complet et coloré."], [...snack.slice(0, 4), .1, snack[4]], [...L("Dîner", 4), .24, "Dîner léger et équilibré."]].map(fix);
  if(timing === "midi") return [[...B, .24, "Petit-déjeuner complet pour courir sans fringale."], [...pre.slice(0, 4), .08, "Vers 10 h 30 : une petite collation de glucides."], [...rec("Déjeuner de récupération", 1).slice(0, 4), .36, "Après la course : glucides + protéines dans l'heure."], [...snack.slice(0, 4), .1, snack[4]], [...L("Dîner", 4), .22, "Dîner équilibré, sans excès."]].map(fix);
  return [[...B, .24, "Un petit-déjeuner complet pour la journée."], [...L("Déjeuner", 0), .32, "Féculents à midi : ce sera ton carburant de ce soir."], [...pre.slice(0, 4), .1, pre[4]], [...rec("Dîner de récupération", 3).slice(0, 4), .34, "Après la course : glucides + protéines, et bois 500 ml d'eau."]].map(fix);
  function fix(m){ return {name:m[0], prot:m[1], carb:m[2], fixed:m[3], share:m[4], tip:m[5] || pre[4]}; }
}
const TIMES = {soir:["07:30","12:30","16:30","20:00"], matin:["06:45","08:15","12:30","16:30","20:00"], midi:["07:30","10:30","13:30","16:30","20:00"], rest:["08:00","12:30","16:30","20:00"]};
function macroOf(key, g){ const f = FOOD[key][1]; return f.map(v => v*g/100); }
// Résout la quantité de la source de protéines (x) et de glucides (y) pour viser les protéines et glucides du repas
function solveMeal(m, tP, tG){
  const items = Object.entries(m.fixed).map(([k, g]) => [k, g]);
  let fP = 0, fG = 0; for(const [k, g] of items){ const v = macroOf(k, g); fP += v[1]; fG += v[2]; }
  const pp = m.prot ? FOOD[m.prot][1] : null, cc = m.carb ? FOOD[m.carb][1] : null;
  let x = 0, y = 0;
  if(pp && cc){ const a = pp[1]/100, b = cc[1]/100, c = pp[2]/100, d = cc[2]/100, R1 = tP - fP, R2 = tG - fG, det = a*d - b*c; x = (R1*d - b*R2)/det; y = (a*R2 - c*R1)/det; }
  else if(pp) x = (tP - fP)/(pp[1]/100);
  else if(cc) y = (tG - fG)/(cc[2]/100);
  const lim = (v, lo, hi) => Math.round(Math.max(lo, Math.min(hi, v))/5)*5;
  if(m.prot) items.unshift([m.prot, lim(x, m.prot === "skyr" ? 100 : 60, m.prot === "skyr" ? 300 : 220)]);
  if(m.carb) items.splice(m.prot ? 1 : 0, 0, [m.carb, lim(y, m.carb === "avoine" ? 30 : 40, m.carb === "avoine" ? 110 : m.carb === "painb" || m.carb === "painc" ? 120 : 300)]);
  const tot = [0, 0, 0, 0]; for(const [k, g] of items) macroOf(k, g).forEach((v, i) => tot[i] += v);
  return {items, tot};
}
function dayPlan(n, p, day, timing){
  // Glucides en g/kg selon l'objectif et la charge du jour, lipides en complément (0,8 g/kg minimum, 35 % maximum)
  const target = day === "rest" ? n.rest : n.run, w = p.weight, long = n.runKm*S.pace/60 > 75 ? 1 : 0;
  const gkg = day === "rest" ? {perte:2.5, forme:3, muscle:4, perf:4}[n.goal] : {perte:3.5, forme:4.5, muscle:5, perf:6}[n.goal] + long;
  const protG = n.prot, carbG = Math.round(w*gkg/5)*5;
  const fatG = Math.round(Math.max(w*.8, Math.min(target*(n.goal === "perte" ? .28 : .32)/9, (target - protG*4 - carbG*4)/9)));
  const kcal = Math.round((protG*4 + carbG*4 + fatG*9)/10)*10;
  const ms = mealsFor(day, timing, n.goal), times = TIMES[day === "rest" ? "rest" : timing];
  const out = ms.map((m, i) => { const pre = /avant la course/i.test(m.name); const tP = pre ? 5 : protG*m.share*(m.name.includes("récupération") ? 1.25 : 1); const tG = carbG*m.share*(m.name.includes("récupération") ? 1.15 : 1); return {...m, time:times[i], ...solveMeal(m, tP, tG)}; });
  // Complément de glucides si les portions plafonnées ne suffisent pas (sorties longues, objectif performance)
  const sum = () => { const t = [0, 0, 0, 0]; out.forEach(m => m.tot.forEach((v, i) => t[i] += v)); return t; };
  let short = carbG - sum()[2];
  const addTo = (m, key, g) => { if(!m || g < 10) return; m.items.push([key, g]); macroOf(key, g).forEach((v, i) => m.tot[i] += v); short -= macroOf(key, g)[2]; };
  if(short > 30) addTo(out.find(m => /Déjeuner/.test(m.name)), "painc", Math.round(Math.min(100, short*.5/.45)/5)*5);
  if(short > 25) addTo(out.find(m => /récupération/.test(m.name)) || out[out.length-1], "riz_lait", Math.round(Math.min(200, short/.2)/5)*5);
  if(short > 25) addTo(out.find(m => /Collation/.test(m.name)), "dattes", Math.round(Math.min(48, short/.66)/8)*8);
  return {kcal, protG, carbG, fatG, meals:out, total:sum()};
}
const fmtFood = (k, g) => { const f = FOOD[k]; if(f[2]){ const u = Math.max(.5, Math.round(g/f[2]*2)/2); return `${String(u).replace(".", ",")} ${f[3]}${u > 1 ? "s" : ""}`; } return `${g} ${k === "lait" ? "ml" : "g"}`; };
/* ---------- Recettes : menus du jour au choix, fiches simples, budget estimé ---------- */
Object.assign(FOOD, {
  tomate:["Tomates",[18,0.9,3.5,0.2]], courgette:["Courgette",[17,1.2,3,0.3]], brocoli:["Brocoli",[34,2.8,7,0.4]], epinards:["Épinards",[23,2.9,3.6,0.4]],
  poivron:["Poivron",[26,1,6,0.3]], oignon:["Oignon",[40,1.1,9,0.1]], citron:["Citron",[29,1.1,9,0.3]], feta:["Feta",[264,14,4,21]], mozza:["Mozzarella",[250,18,2,19]],
  tortilla:["Galette de blé",[310,8.5,52,7.5],60,"galette"], soja:["Sauce soja",[60,8,6,0]], coco:["Lait de coco léger",[110,1,3,10]], creme:["Crème légère 15 %",[160,3,4,15]]
});
// Prix moyens en supermarché, en € par kg (ou par litre), estimation 2026
const PRICE = {avoine:2.5, painc:4.5, painb:3.5, skyr:4.5, fblanc:3, lait:1.1, yaourt:2.5, oeuf:5.5, banane:2.2, rouges:7, pomme:2.5, amandes:14, noix:16, cacahuete:9, miel:12, confiture:6,
  poulet:13, dinde:12, saumon:22, cabillaud:20, thon:12, boeuf:13, tofu:10, jambon:14, lentilles:1.4, poischiches:3, basmati:1.2, rizc:1.3, pates:1, patesb:0.9, quinoa:2.8, patate:3.5, pdt:1.8,
  legumes:3.5, salade:4, huile:9, avocat:8, compote:4, dattes:9, choco:15, riz_lait:4, tomate:3.5, courgette:2.8, brocoli:4, epinards:4, poivron:4, oignon:2, citron:4, feta:14, mozza:10, tortilla:6, soja:8, coco:5, creme:5};
// [id, nom, type, objectifs, minutes, ingrédients {clé: g}, étapes détaillées, conseil, ustensiles]
const RECIPES = [
  ["porridge", "Porridge banane et beurre de cacahuète", "pdj", "muscle perf forme", 7, {avoine:60, lait:200, banane:120, cacahuete:15, miel:10},
    ["Pèse les flocons d'avoine et mesure le lait avec un verre doseur.", "Verse les deux dans une petite casserole. Allume sur feu moyen (position 5 sur 9).", "Remue avec une cuillère en bois sans t'arrêter. Au bout de 3 à 4 min, le mélange épaissit et fait de petites bulles : c'est cuit.", "Éteins le feu et verse le porridge dans un bol. Il continue d'épaissir en refroidissant.", "Épluche la banane, coupe-la en rondelles d'un demi-centimètre et pose-les dessus.", "Ajoute le beurre de cacahuète et le miel avec une cuillère à café, puis mélange légèrement."],
    "Version sans cuisson : mélange flocons et lait froid dans un bocal le soir, mets-le au frigo, il est prêt au réveil.", "Petite casserole, cuillère en bois, bol"],
  ["bowlskyr", "Bowl skyr, fruits rouges et amandes", "pdj", "perte forme muscle", 3, {skyr:200, rouges:120, avoine:30, amandes:15},
    ["Si les fruits rouges sont surgelés, sors-les la veille au soir et mets-les au frigo dans un bol pour qu'ils décongèlent.", "Verse le skyr dans un bol et lisse-le avec le dos d'une cuillère.", "Dépose les fruits rouges sur un côté et les flocons d'avoine sur l'autre.", "Écrase grossièrement les amandes avec le fond d'un verre sur une planche, puis parsème-les."],
    "Très riche en protéines pour peu de calories : idéal pour perdre du poids sans fringale.", "Bol, cuillère, planche"],
  ["tartoeufs", "Tartines aux œufs brouillés et tomates", "pdj", "perte muscle forme", 10, {painc:70, oeuf:110, tomate:100, huile:5},
    ["Mets le pain à griller (grille-pain ou poêle sèche 2 min de chaque côté).", "Casse les œufs dans un bol en tapant sur le bord. Retire les morceaux de coquille avec une cuillère, ajoute une pincée de sel et bats 30 secondes à la fourchette.", "Verse l'huile dans une poêle antiadhésive sur feu doux (position 3 sur 9). Attends 1 min.", "Verse les œufs et remue doucement avec une spatule en ramenant les bords vers le centre, pendant 2 à 3 min.", "Coupe le feu quand les œufs sont encore un peu brillants : ils finissent de cuire seuls.", "Coupe la tomate en rondelles, pose œufs et tomates sur les tartines, poivre."],
    "Ne cuis jamais les œufs brouillés à feu vif : ils deviennent secs et caoutchouteux.", "Poêle antiadhésive, spatule, bol, fourchette, grille-pain"],
  ["pancakes", "Pancakes avoine-banane en 3 ingrédients", "pdj", "perf muscle forme", 15, {avoine:60, oeuf:110, banane:120, miel:10},
    ["Épluche la banane et coupe-la en morceaux.", "Mets la banane, les œufs et les flocons dans un blender (ou écrase la banane à la fourchette puis mélange le tout). Mixe 30 secondes jusqu'à obtenir une pâte lisse.", "Laisse reposer la pâte 5 min : les flocons gonflent et les pancakes se tiendront mieux.", "Chauffe une poêle antiadhésive à feu moyen avec une goutte d'huile essuyée au papier absorbant.", "Verse une petite louche de pâte (environ 10 cm de diamètre). Quand des bulles apparaissent à la surface (environ 2 min), retourne avec une spatule.", "Cuis encore 1 min, puis recommence avec le reste. Arrose de miel."],
    "Le premier pancake est souvent raté : c'est normal, la poêle n'est pas encore à la bonne température.", "Blender ou fourchette, poêle antiadhésive, spatule, louche"],
  ["tartconf", "Tartines confiture et yaourt", "pdj", "forme perf perte", 3, {painb:80, confiture:20, yaourt:250},
    ["Coupe 2 à 3 tranches de pain et fais-les griller si tu aimes croustillant.", "Étale la confiture avec un couteau à bout rond.", "Sers avec le yaourt nature dans un bol."],
    "Le petit-déjeuner le moins cher : parfait les matins pressés.", "Couteau, bol"],
  ["pouletriz", "Poulet, riz basmati et brocolis au citron", "plat", "perte muscle forme perf", 20, {poulet:130, basmati:200, brocoli:200, huile:10, citron:30},
    ["Fais bouillir une grande casserole d'eau salée (1 litre pour 100 g de riz cru, environ 1/3 du poids cuit indiqué).", "Verse le riz cru dans l'eau qui bout, baisse à feu moyen et laisse cuire 10 à 11 min. Goûte un grain : il doit être tendre. Égoutte dans une passoire.", "Pendant ce temps, coupe le brocoli en petits bouquets. Fais-les cuire 6 min dans une autre casserole d'eau bouillante, ou à la vapeur. Ils doivent rester vert vif.", "Coupe le poulet en cubes de 2 cm sur une planche. Lave-toi les mains et la planche juste après.", "Chauffe l'huile dans une poêle à feu moyen-vif. Ajoute le poulet et laisse dorer 6 à 8 min en remuant de temps en temps.", "Vérifie la cuisson en coupant le plus gros morceau : l'intérieur doit être blanc, sans rose.", "Sers le tout, presse le citron par-dessus, sale et poivre."],
    "Le classique des coureurs : prépare 3 portions d'un coup et garde-les 3 jours au frigo dans des boîtes.", "2 casseroles, passoire, poêle, planche, couteau"],
  ["saumonpatate", "Saumon, patate douce rôtie et épinards", "plat", "muscle perf forme", 30, {saumon:130, patate:250, epinards:150, huile:5},
    ["Préchauffe le four à 200 °C (chaleur tournante si possible).", "Épluche la patate douce avec un économe et coupe-la en cubes de 2 cm (plus ils sont petits, plus ils cuisent vite).", "Mets les cubes sur une plaque recouverte de papier cuisson, verse la moitié de l'huile, sale, mélange avec les mains. Enfourne 25 min en les retournant à mi-cuisson.", "10 min avant la fin, chauffe une poêle à feu moyen avec le reste de l'huile. Pose le saumon côté peau en bas, 4 min sans y toucher.", "Retourne-le avec une spatule et cuis 3 à 4 min de plus. Il est cuit quand la chair se détache en lamelles et devient rose pâle à cœur.", "Retire le saumon, mets les épinards dans la même poêle 2 min : ils réduisent énormément, c'est normal. Sale et sers."],
    "Saumon surgelé : 30 % moins cher et tout aussi bon. Laisse-le décongeler la veille au frigo.", "Four, plaque, papier cuisson, économe, poêle, spatule"],
  ["dhal", "Dhal de lentilles corail au lait de coco", "plat", "perte forme perf", 25, {lentilles:220, coco:60, oignon:60, tomate:150, basmati:120},
    ["Rince les lentilles corail crues dans une passoire sous l'eau froide (environ 1/3 du poids cuit indiqué).", "Épluche l'oignon, coupe-le en deux puis en petits dés.", "Dans une casserole, fais revenir l'oignon avec un filet d'huile 3 min à feu moyen, jusqu'à ce qu'il devienne transparent. Ajoute 1 c. à café de curry et remue 30 secondes.", "Ajoute les lentilles, les tomates (en conserve, concassées), le lait de coco et un verre d'eau. Mélange.", "Laisse mijoter 15 min à feu doux avec le couvercle entrouvert, en remuant toutes les 5 min. Ajoute un peu d'eau si ça accroche. C'est prêt quand les lentilles sont fondantes.", "En parallèle, fais cuire le riz 10 min dans l'eau bouillante salée. Sers le dhal sur le riz."],
    "100 % végétal, très peu cher, riche en fibres et en fer. Se congèle très bien.", "Casserole avec couvercle, passoire, couteau, planche"],
  ["patesthon", "Pâtes complètes au thon et à la tomate", "plat", "perf forme muscle", 15, {pates:220, thon:100, tomate:200, oignon:50, huile:10},
    ["Fais bouillir une grande casserole d'eau avec 1 c. à café de sel.", "Verse les pâtes crues (environ 40 % du poids cuit indiqué) et cuis le temps marqué sur le paquet. Remue au début pour qu'elles ne collent pas.", "Pendant ce temps, épluche et émince l'oignon. Fais-le revenir 3 min dans l'huile à feu moyen dans une poêle.", "Ajoute les tomates concassées en conserve, sel, poivre, herbes de Provence. Laisse mijoter 5 min.", "Égoutte le thon, émiette-le à la fourchette et ajoute-le à la sauce 1 min pour le réchauffer.", "Égoutte les pâtes et mélange-les à la sauce dans la poêle."],
    "Parfait la veille d'une sortie longue : plein de glucides, digeste et économique.", "Grande casserole, passoire, poêle, fourchette"],
  ["wokdinde", "Wok de dinde aux légumes et sauce soja", "plat", "perte muscle forme", 20, {dinde:130, basmati:180, poivron:150, courgette:150, soja:15, huile:10},
    ["Lance le riz : 10 à 11 min dans l'eau bouillante salée, puis égoutte.", "Lave poivron et courgette. Retire les graines du poivron, puis coupe les deux légumes en fines lamelles.", "Coupe la dinde en lanières de 1 cm sur une planche.", "Chauffe l'huile dans un wok ou une grande poêle à feu vif jusqu'à ce qu'elle fume légèrement.", "Ajoute la dinde et remue sans arrêt 4 à 5 min : elle doit être dorée et blanche à cœur. Retire-la dans une assiette.", "Mets les légumes dans la même poêle, 4 min à feu vif en remuant. Remets la dinde, verse la sauce soja, mélange 1 min et sers sur le riz."],
    "Cuisson très vive et courte : les légumes restent croquants. La sauce soja est salée, n'ajoute pas de sel.", "Wok ou grande poêle, casserole, passoire, planche, couteau"],
  ["omelette", "Omelette courgette-feta et pommes de terre", "plat", "perte forme muscle", 20, {oeuf:165, courgette:200, feta:30, pdt:200, huile:5},
    ["Épluche les pommes de terre, coupe-les en dés de 1,5 cm et plonge-les dans l'eau bouillante salée 10 à 12 min. Elles sont cuites quand un couteau s'enfonce sans résistance. Égoutte.", "Lave la courgette, coupe-la en petits dés.", "Chauffe l'huile dans une poêle à feu moyen, fais revenir la courgette 5 min puis ajoute les pommes de terre 2 min.", "Bats les œufs avec sel et poivre, verse-les sur les légumes.", "Émiette la feta par-dessus, baisse à feu doux et couvre 4 à 5 min. L'omelette est prête quand le dessus n'est plus liquide.", "Fais-la glisser sur une assiette."],
    "Une protéine complète pour un budget mini. Se mange aussi froide le lendemain.", "Casserole, poêle avec couvercle, couteau, fourchette, bol"],
  ["chili", "Chili végétarien aux pois chiches", "plat", "perte forme perf", 25, {poischiches:200, tomate:200, oignon:60, poivron:120, rizc:150, huile:8},
    ["Lance le riz complet : il cuit plus longtemps, 20 à 25 min dans l'eau bouillante salée.", "Émince l'oignon, épépine et coupe le poivron en dés.", "Fais-les revenir dans l'huile 5 min à feu moyen dans une casserole.", "Égoutte et rince les pois chiches (en conserve). Ajoute-les avec les tomates, 1 c. à café de cumin, 1 c. à café de paprika, sel et poivre.", "Laisse mijoter 15 min à feu doux en remuant de temps en temps.", "Égoutte le riz et sers le chili dessus."],
    "Encore meilleur réchauffé le lendemain. Rincer les pois chiches évite les ballonnements.", "2 casseroles, passoire, couteau, planche"],
  ["cabillaud", "Cabillaud, quinoa et courgettes au citron", "plat", "perte forme", 20, {cabillaud:150, quinoa:180, courgette:250, huile:10, citron:30},
    ["Rince le quinoa cru dans une passoire fine (environ 1/3 du poids cuit). Cuis-le 12 min dans 2 fois son volume d'eau salée, à couvert. Il est prêt quand un petit germe blanc apparaît autour des grains.", "Coupe la courgette en demi-rondelles. Fais-les revenir dans la moitié de l'huile 6 min à feu moyen.", "Sèche le cabillaud avec du papier absorbant (sinon il colle), sale-le.", "Chauffe le reste de l'huile dans une poêle à feu moyen, cuis le poisson 3 min de chaque côté. Il est cuit quand il devient blanc opaque et se défait en lamelles.", "Arrose de jus de citron et sers avec le quinoa et les courgettes."],
    "Très léger et riche en protéines : parfait le soir. Le cabillaud surgelé est bien moins cher.", "Casserole avec couvercle, passoire fine, 2 poêles, spatule"],
  ["bolo", "Pâtes à la bolognaise maison", "plat", "muscle perf", 20, {boeuf:130, patesb:250, tomate:200, oignon:50, huile:5},
    ["Fais bouillir une grande casserole d'eau salée et cuis les pâtes selon le paquet.", "Épluche et coupe l'oignon en petits dés. Fais-le revenir dans l'huile 3 min à feu moyen.", "Ajoute la viande hachée et écrase-la à la cuillère en bois pour bien la défaire. Cuis 5 min : elle doit être brune, sans rose.", "Verse les tomates concassées, sel, poivre, une pincée d'herbes de Provence. Laisse mijoter 10 min à feu doux.", "Égoutte les pâtes, sers avec la sauce par-dessus."],
    "Le plein de glucides et de fer : parfait après une grosse séance.", "Grande casserole, passoire, poêle, cuillère en bois"],
  ["wrap", "Wraps poulet-crudités", "plat", "forme perte muscle", 10, {tortilla:120, poulet:110, salade:80, tomate:80, fblanc:40},
    ["Coupe le poulet en fines lanières et fais-le cuire 6 min dans une poêle huilée à feu moyen. Vérifie : blanc à cœur.", "Mélange le fromage blanc avec sel, poivre et un peu de jus de citron ou d'herbes : c'est ta sauce.", "Rince la salade et coupe la tomate en petits dés.", "Réchauffe chaque galette 20 secondes dans une poêle sèche : elle se roulera sans se casser.", "Étale la sauce au centre, ajoute salade, tomate et poulet.", "Replie le bas de la galette, puis roule-la bien serré."],
    "Se transporte facilement pour un déjeuner au travail : emballe-le dans du papier aluminium.", "Poêle, couteau, planche, bol"],
  ["tofu", "Tofu sauté, riz complet et brocolis", "plat", "perte forme", 25, {tofu:150, rizc:200, brocoli:200, soja:15, huile:10},
    ["Lance le riz complet : 20 à 25 min dans l'eau bouillante salée.", "Enveloppe le tofu dans un torchon propre et pose une casserole dessus 10 min pour l'essorer. Coupe-le en cubes de 2 cm.", "Cuis les bouquets de brocoli 6 min dans l'eau bouillante, puis égoutte.", "Chauffe l'huile à feu moyen-vif, dore le tofu 6 à 8 min en le retournant pour colorer toutes les faces.", "Ajoute le brocoli et la sauce soja, mélange 1 min et sers sur le riz."],
    "Bien essoré, le tofu devient croustillant au lieu d'être spongieux.", "2 casseroles, poêle, torchon propre, passoire"],
  ["rizoeufs", "Riz sauté aux œufs et petits légumes", "plat", "perte forme perf muscle", 15, {rizc:220, oeuf:110, legumes:200, soja:10, huile:10},
    ["Utilise du riz déjà cuit (un reste de la veille est idéal : il ne colle pas).", "Chauffe la moitié de l'huile dans une grande poêle à feu vif. Ajoute les légumes (un sachet de légumes surgelés pour wok fonctionne très bien) et remue 5 min.", "Pousse les légumes sur le côté, verse le reste de l'huile et casse les œufs dans l'espace libre. Brouille-les 1 min à la spatule.", "Ajoute le riz, mélange le tout 3 min pour qu'il chauffe bien.", "Verse la sauce soja, mélange et sers."],
    "Le plat anti-gaspi par excellence, et l'un des moins chers de la semaine.", "Grande poêle ou wok, spatule"],
  ["salentilles", "Salade de lentilles, œufs durs et tomates", "plat", "perte forme perf", 15, {lentilles:220, oeuf:110, tomate:150, oignon:30, huile:10},
    ["Plonge délicatement les œufs dans de l'eau bouillante avec une cuillère. Compte 10 min pour des œufs durs.", "Passe-les sous l'eau froide 2 min, puis écale-les et coupe-les en quartiers.", "Rince les lentilles cuites (en conserve ou sous vide) et égoutte-les.", "Coupe les tomates en dés et l'oignon très finement.", "Prépare la vinaigrette dans le saladier : l'huile, 1 c. à soupe de vinaigre, 1 c. à café de moutarde, sel, poivre. Mélange.", "Ajoute lentilles, tomates et oignon, mélange, puis pose les œufs dessus."],
    "Se prépare la veille et se garde 2 jours au frigo. Le vinaigre aide à mieux absorber le fer des lentilles.", "Casserole, saladier, couteau, planche"],
  ["skyrpomme", "Skyr, pomme et noix", "snack", "perte forme muscle perf", 2, {skyr:150, pomme:150, noix:15},
    ["Lave la pomme, coupe-la en quartiers, retire le cœur puis coupe en petits dés.", "Verse le skyr dans un bol, ajoute la pomme.", "Casse les noix avec les doigts et parsème-les."],
    "Protéines et fibres : ça tient jusqu'au dîner.", "Couteau, bol"],
  ["fbmiel", "Fromage blanc, miel et flocons", "snack", "perte muscle perf forme", 2, {fblanc:200, miel:15, avoine:30},
    ["Verse le fromage blanc dans un bol.", "Ajoute le miel avec une cuillère à café et mélange.", "Parsème de flocons d'avoine juste avant de manger pour qu'ils restent croquants."],
    "Le soir, c'est aussi une bonne collation avant de dormir.", "Bol, cuillère"],
  ["yaoban", "Yaourt nature et banane", "snack", "perte forme muscle perf", 1, {yaourt:250, banane:120},
    ["Verse les yaourts dans un bol.", "Coupe la banane en rondelles par-dessus."],
    "La collation la moins chère : environ 50 centimes.", "Bol, couteau"],
  ["tartcaca", "Tartine beurre de cacahuète et banane", "snack", "muscle perf forme", 3, {painc:50, cacahuete:15, banane:60},
    ["Fais griller la tranche de pain si tu veux.", "Étale le beurre de cacahuète au couteau.", "Ajoute la demi-banane en rondelles."],
    "Choisis un beurre de cacahuète 100 % arachides, sans huile de palme.", "Couteau"],
  ["banmiel", "Banane et tartine au miel", "pre", "perte muscle forme perf", 2, {banane:120, painb:40, miel:15},
    ["Coupe une tranche de pain blanc (le pain complet est plus long à digérer avant de courir).", "Étale le miel.", "Mange la banane à côté."],
    "1 h 30 avant de courir : facile à digérer.", "Couteau"],
  ["dattes", "Compote, dattes et pain", "pre", "perte muscle forme perf", 2, {compote:100, dattes:24, painb:30},
    ["Dénoyaute les dattes en les ouvrant avec les doigts.", "Prends-les avec la compote et le morceau de pain."],
    "Peu de fibres et pas de gras avant de courir : zéro inconfort.", "Aucun"],
  ["rizlait", "Riz au lait et banane", "pre", "muscle perf forme", 2, {riz_lait:150, banane:60},
    ["Verse le riz au lait (pot du commerce) dans un bol.", "Ajoute la demi-banane en rondelles."],
    "Une source de glucides douce pour l'estomac.", "Bol, couteau"],
  ["smoothie", "Smoothie récup banane, lait et avoine", "recup", "perte muscle forme perf", 5, {lait:300, banane:120, avoine:40, skyr:100, miel:15},
    ["Épluche la banane et coupe-la en 4.", "Mets dans le blender, dans cet ordre : le lait, le skyr, la banane, les flocons et le miel.", "Ferme bien le couvercle et mixe 30 à 45 secondes jusqu'à ce que ce soit lisse.", "Bois-le dans l'heure qui suit ta course."],
    "Glucides et protéines en 5 minutes : la récupération idéale.", "Blender"]
];
const SHORT = {porridge:"Porridge", bowlskyr:"Bowl skyr", tartoeufs:"Œufs brouillés", pancakes:"Pancakes", tartconf:"Tartines", pouletriz:"Poulet riz", saumonpatate:"Saumon", dhal:"Dhal", patesthon:"Pâtes thon", wokdinde:"Wok dinde", omelette:"Omelette", chili:"Chili", cabillaud:"Cabillaud", bolo:"Bolognaise", wrap:"Wraps", tofu:"Tofu sauté", rizoeufs:"Riz sauté", salentilles:"Salade lentilles", skyrpomme:"Skyr pomme", fbmiel:"Fromage blanc", yaoban:"Yaourt banane", tartcaca:"Tartine", banmiel:"Banane miel", dattes:"Dattes", rizlait:"Riz au lait", smoothie:"Smoothie"};
const SLOT = name => /récupération/i.test(name) && /Petit/.test(name) ? "recup" : /récupération/i.test(name) ? "plat" : /avant la course/i.test(name) ? "pre" : /Petit/.test(name) ? "pdj" : /Collation/.test(name) ? "snack" : "plat";
const rKcal = ing => Object.entries(ing).reduce((a, [k, g]) => a + macroOf(k, g)[0], 0);
function scaleRecipe(r, kcal){
  const base = rKcal(r[5]), f = Math.max(.6, Math.min(1.8, kcal/base));
  const ing = Object.entries(r[5]).map(([k, g]) => [k, FOOD[k][2] ? Math.max(FOOD[k][2]/2, Math.round(g*f/(FOOD[k][2]/2))*(FOOD[k][2]/2)) : Math.max(5, Math.round(g*f/5)*5)]);
  const tot = [0, 0, 0, 0]; ing.forEach(([k, g]) => macroOf(k, g).forEach((v, i) => tot[i] += v));
  const cost = ing.reduce((a, [k, g]) => a + g/1000*(PRICE[k] || 5), 0);
  return {ing, tot, cost};
}
const BUDGETS = [["eco","Petit budget","moins de 8 €",0,8],["moyen","Moyen","8 à 12 €",8,12],["confort","Confort","12 à 18 €",12,18],["libre","Sans limite","",0,999]];
const hashS = s => { let x = 7; for(const c of s) x = (x*31 + c.charCodeAt(0)) >>> 0; return x; };
// Choisit 3 recettes par repas qui tiennent dans la part du budget journalier, en tournant chaque jour
function optionsFor(slot, goal, seed, kcal, lo, hi){
  const pool = RECIPES.filter(r => (r[2] === slot || (slot === "recup" && r[2] === "pdj")) && r[3].includes(goal)).map(r => ({r, c:scaleRecipe(r, kcal).cost}));
  const gap = o => o.c > hi ? o.c - hi : o.c < lo ? lo - o.c : 0;
  const inRange = pool.filter(o => gap(o) === 0);
  const base = inRange.length >= 2 ? inRange : pool.slice().sort((a, b) => gap(a) - gap(b)).slice(0, Math.max(2, inRange.length));
  return base.sort((a, b) => hashS(seed + a.r[0]) - hashS(seed + b.r[0])).slice(0, 3).map(o => o.r);
}
const eur = v => v.toLocaleString("fr-FR", {style:"currency", currency:"EUR"});
function menusView(n, p, plan){
  const today = new Date().toDateString(), sel = store.get("menuSel", {}), daySel = sel.d === today ? sel.v : {};
  const bk = store.get("budget", "libre"), B = BUDGETS.find(b => b[0] === bk) || BUDGETS[3];
  const kTot = plan.meals.reduce((a, m) => a + m.tot[0], 0);
  let budget = 0;
  const cards = plan.meals.map((m, i) => {
    const slot = SLOT(m.name), share = m.tot[0]/kTot, lo = B[3]*share*.6, hi = B[4]*share*1.2;
    const opts = optionsFor(slot, n.goal, today + i + (S.nday || "run") + bk, m.tot[0], lo, hi);
    if(!opts.length) return "";
    const cheapest = opts.slice().sort((x, y) => scaleRecipe(x, m.tot[0]).cost - scaleRecipe(y, m.tot[0]).cost)[0];
    const pick = opts.find(o => o[0] === daySel[i]) || (bk === "eco" ? cheapest : opts[0]), kcal = m.tot[0], sc = scaleRecipe(pick, kcal);
    budget += sc.cost;
    return `<div class="menu"><div class="mh"><span class="tm">${m.time}</span><b>${esc(m.name)}</b><span class="eur">${eur(sc.cost)}</span></div>
      <button class="mrec" data-rec="${pick[0]}" data-kcal="${Math.round(kcal)}"><span class="mt"><b>${esc(pick[1])}</b><small>${pick[4]} min · ${Math.round(sc.tot[0])} kcal · P ${Math.round(sc.tot[1])} g · G ${Math.round(sc.tot[2])} g · L ${Math.round(sc.tot[3])} g</small></span><span class="go">Recette ›</span></button>
      ${opts.length > 1 ? `<div class="opts">${opts.map(o => { const c = scaleRecipe(o, kcal).cost; return `<button data-opt="${i}|${o[0]}" aria-pressed="${o === pick}"><span>${esc(SHORT[o[0]] || o[1])}</span><small>${eur(c)}</small></button>`; }).join("")}</div>` : ""}</div>`;
  }).join("");
  const over = B[4] < 999 && budget > B[4], under = budget < B[3];
  return `<p class="eyebrow">Ton budget repas par jour</p>
    <div class="bchips">${BUDGETS.map(b => `<button data-budget="${b[0]}" aria-pressed="${b[0] === bk}"><b>${b[1]}</b>${b[2] ? `<small>${b[2]}</small>` : ""}</button>`).join("")}</div>
    <div class="budget"><span><small>Menu du jour</small><b>${new Date().toLocaleDateString("fr-FR", {weekday:"long", day:"numeric", month:"long"})}</b></span><span class="bb"><small>Coût estimé</small><b>${eur(budget)}</b></span></div>
    <div class="bdet"><div><small>Par jour</small><b>${eur(budget)}</b></div><div><small>Par semaine</small><b>${eur(budget*7)}</b></div><div><small>Par mois</small><b>${eur(budget*30)}</b></div></div>
    ${over ? `<p class="small warn">Pour couvrir tes besoins, ce menu dépasse un peu ton budget. Choisis les idées les moins chères (prix sous chaque bouton) pour t'en rapprocher.</p>` : under ? `<p class="small">Ce menu coûte moins que ton budget : tu peux te faire plaisir avec d'autres idées.</p>` : ""}
    <p class="small">Les menus changent chaque jour et respectent ton budget. Choisis l'idée qui te fait envie pour chaque repas : les quantités s'adaptent à tes besoins.</p>
    <div class="list">${cards}</div>
    <p class="small">Prix moyens constatés en supermarché (marques distributeur), pour 1 personne. Féculents pesés cuits. Les épices, le sel et le vinaigre ne sont pas comptés.</p>`;
}
function recipeSheet(id, kcal){
  const r = RECIPES.find(x => x[0] === id); if(!r) return;
  const sc = scaleRecipe(r, kcal), lvl = r[6].length <= 3 ? "Très facile" : r[6].length <= 5 ? "Facile" : "Facile, pas à pas";
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button>
    <div class="rhead"><p class="eyebrow">Fiche recette</p><p class="title">${esc(r[1])}</p>
      <div class="rchips"><span>${r[4]} min</span><span>${lvl}</span><span>1 portion</span><span>${eur(sc.cost)}</span></div></div>
    <div class="trio"><div><small>Énergie</small><b>${Math.round(sc.tot[0])} kcal</b></div><div><small>Protéines</small><b>${Math.round(sc.tot[1])} g</b></div><div><small>Glucides</small><b>${Math.round(sc.tot[2])} g</b></div></div>
    <p class="eyebrow">Ustensiles</p><p class="muted rtools">${esc(r[8])}</p>
    <p class="eyebrow">Ingrédients et prix</p>
    <ul class="ring">${sc.ing.map(([k, g]) => `<li><span>${esc(FOOD[k][0])}<small>${eur(PRICE[k] || 5)} le ${k === "lait" || k === "coco" ? "litre" : "kilo"}</small></span><em>${fmtFood(k, g)}</em><i>${eur(g/1000*(PRICE[k] || 5))}</i></li>`).join("")}
      <li class="rtot"><span>Total pour 1 portion</span><i>${eur(sc.cost)}</i></li></ul>
    <p class="eyebrow">Préparation pas à pas</p>
    <ol class="rsteps">${r[6].map(s => `<li>${esc(s)}</li>`).join("")}</ol>
    <div class="rtip"><b>Le conseil du coach</b><span>${esc(r[7])}</span></div>
    <p class="small">Astuce budget : cuisiner 3 portions d'un coup réduit souvent le prix de 20 à 30 % (grands formats, moins de pertes).</p>
    <button class="btn hero block" data-close>C'est noté</button>`);
}

// Pendant l'effort : glucides, eau et sel selon la durée de la boucle prévue
function duringPlan(mins, p){
  if(mins < 60) return {g:0, txt:"Moins d'une heure : rien à manger. De l'eau si tu as soif, surtout s'il fait chaud.", water:mins >= 45 ? "150 à 250 ml" : "selon la soif"};
  const gph = mins <= 90 ? 30 : 60, hours = (mins - 30)/60, g = Math.round(gph*hours/5)*5;
  const gels = Math.ceil(g/25), dates = Math.ceil(g/15);
  return {g, txt:`Environ ${g} g de glucides au total (${gph} g par heure à partir de 30 min), soit ${gels} gel${gels > 1 ? "s" : ""} énergétique${gels > 1 ? "s" : ""} ou ${dates} dattes, en petites prises toutes les 20 à 30 min.`, water:`${Math.round(mins/60*500/50)*50} ml répartis, avec des sels minéraux (300 à 600 mg de sodium par heure) s'il fait chaud`};
}

const EXPERT = {
  perte:["Déficit modéré d'environ 400 kcal par jour : une perte de 0,3 à 0,5 kg par semaine, sans perdre de muscle.","Des protéines à chaque repas (1,8 g/kg) : elles calent et protègent tes muscles.","Garde des féculents autour de tes sorties : bien courir, c'est aussi brûler plus.","Évite les calories liquides (sodas, jus, alcool) et les boissons d'effort sur les sorties de moins d'une heure.","Vise 30 g de fibres par jour : légumes, fruits, légumineuses, céréales complètes."],
  muscle:["Léger surplus (environ +300 kcal) et 1,8 g/kg de protéines, réparties en 4 prises d'environ 0,4 g/kg.","20 à 30 g de protéines dans l'heure après la course ou le renforcement.","Garde 2 séances de renforcement par semaine et des sorties courtes à modérées.","Avant de dormir : un skyr ou un fromage blanc, des protéines qui se digèrent lentement."],
  forme:["Une assiette simple : moitié légumes, un quart protéines, un quart féculents complets.","5 fruits et légumes par jour, des féculents complets et peu de produits ultra-transformés.","Un fruit ou une banane avant les sorties de plus de 45 min."],
  perf:["Glucides de 5 à 7 g/kg les jours d'entraînement intense, jusqu'à 8 g/kg la veille d'une course longue.","Teste ton ravitaillement à l'entraînement, jamais pour la première fois le jour de la course.","La caféine, environ 3 mg/kg une heure avant une séance clé, peut aider si tu la tolères bien.","Récupération : 1 g/kg de glucides et 0,3 g/kg de protéines dans l'heure qui suit."]
};
function nutriView(){
  if(!S.profile || S.editProfile) return `<p class="title">Ton profil nutrition</p>` + profileForm();
  const p = S.profile, n = needs(p), day = S.nday || "run", tm = S.ntime || "soir", plan = dayPlan(n, p, day, tm);
  const mins = Math.round(n.runKm*S.pace/60), dur = duringPlan(mins, p), recC = Math.round(p.weight), recP = Math.round(p.weight*.3);
  const mac = (t, sz) => `<span class="mc">${Math.round(t[0])} kcal</span><span>P ${Math.round(t[1])} g</span><span>G ${Math.round(t[2])} g</span><span>L ${Math.round(t[3])} g</span>`;
  const caf = Math.round(p.weight*3/10)*10;
  return `<div class="pfsum"><span><small>Ton objectif</small><b>${GOALS[p.goal]}</b></span><button class="linkbtn" id="pfEdit">Modifier mon profil</button></div>${n.note ? `<p class="small">${n.note}</p>` : ""}
    <div class="seg" data-v="${day === "run" ? "dist" : "time"}"><span class="knob"></span><button data-nday="run" aria-pressed="${day === "run"}">Jour de course</button><button data-nday="rest" aria-pressed="${day === "rest"}">Jour de repos</button></div>
    ${day === "run" ? `<div class="chips">${[["matin","Je cours le matin"],["midi","Le midi"],["soir","Le soir"]].map(([k, l]) => `<button class="chip" data-ntime="${k}" aria-pressed="${tm === k}">${l}</button>`).join("")}</div>` : ""}
    <div class="daytot"><div><small>Objectif du jour</small><b>${nf(0).format(plan.kcal)} kcal</b></div><div class="macro"><div style="flex:${plan.protG*4}"><span>P ${plan.protG} g</span></div><div style="flex:${plan.carbG*4}"><span>G ${plan.carbG} g</span></div><div style="flex:${plan.fatG*9}"><span>L ${plan.fatG} g</span></div></div><small>Soit ${nf(1).format(plan.protG/p.weight)} g/kg de protéines et ${nf(1).format(plan.carbG/p.weight)} g/kg de glucides.</small></div>
    ${menusView(n, p, plan)}
    ${day === "run" ? `<p class="eyebrow">Pendant ta boucle · environ ${hmin(mins*60)}</p>
    <div class="nutri on"><dl><dt>Manger</dt><dd>${dur.txt}</dd><dt>Boire</dt><dd>${dur.water}.</dd></dl></div>
    <p class="eyebrow">Récupération · dans l'heure qui suit</p>
    <div class="nutri"><p class="muted">Vise <b style="color:var(--ink)">${recC} g de glucides</b> et <b style="color:var(--ink)">${recP} g de protéines</b> (1 g/kg et 0,3 g/kg). Par exemple : ${Math.round(recC/50*2)/2 > 1 ? `${nf(1).format(Math.round(recC/50*2)/2).replace(",0", "")} × 500 ml de lait chocolaté` : "500 ml de lait chocolaté"} ; ou un skyr + une banane + ${Math.round(Math.max(0, recC - 30)/0.55/10)*10} g de pain ; ou le repas de récupération ci-dessus.</p></div>` : ""}
    <p class="eyebrow">Conseils de ton coach nutrition</p>
    <ul class="tips">${EXPERT[n.goal].map(t => `<li>${t.replace("3 mg/kg", `3 mg/kg (pour toi, environ ${caf} mg, soit 2 expressos)`)}</li>`).join("")}</ul>
    <p class="eyebrow">Les essentiels du coureur</p>
    <div class="micro"><div><b>Fer</b><span>Viande rouge 1 à 2 fois par semaine, lentilles avec un agrume.${p.sex === "f" ? " Surveille-le de près : les coureuses en manquent souvent." : ""}</span></div><div><b>Calcium</b><span>2 à 3 laitages ou équivalents par jour pour tes os.</span></div><div><b>Vitamine D</b><span>Poissons gras 2 fois par semaine et un peu de soleil.</span></div><div><b>Magnésium</b><span>Oléagineux, chocolat noir, céréales complètes.</span></div><div><b>Oméga-3</b><span>Saumon, sardines, noix, huile de colza.</span></div></div>
    <p class="small">IMC ${nf(1).format(n.bmi)}, ${n.cat}. Repères issus des recommandations de nutrition du sport pour un adulte en bonne santé. En cas de problème de santé, de grossesse ou de trouble alimentaire, demande l'avis d'un médecin ou d'un diététicien.</p>`;
}
function mobiView(){
  const k = S.mobi || "avant", r = ROUTINES[k], tot = r.steps.reduce((a, s) => a + s[1], 0);
  return `<div class="seg" data-v="${k === "avant" ? "dist" : "time"}"><span class="knob"></span><button data-mobi="avant" aria-pressed="${k === "avant"}">Avant la course</button><button data-mobi="apres" aria-pressed="${k === "apres"}">Après la course</button></div>
    <p class="muted">${r.intro}</p><ol class="routine">${r.steps.map(s => `<li><span><b>${esc(s[0])}</b><small>${esc(s[2])}</small></span><em>${s[1] >= 60 ? Math.round(s[1]/60) + " min" : s[1] + " s"}</em></li>`).join("")}</ol>
    <button class="btn hero block" data-routine="${k}">${I.play}Lancer en guidé · ${Math.round(tot/60)} min</button>`;
}
function viewCoach(){
  const tabs = [["nutri","Nutrition"],["hydra","Hydratation"],["train","Entraînement"]];
  const sub = tabs.some(t => t[0] === S.coachTab) ? S.coachTab : "nutri";
  const head = `<div class="coachbar">${tabs.map(([k, l]) => `<button type="button" data-ct="${k}" aria-pressed="${sub === k}">${l}</button>`).join("")}</div>`;
  return head + ({nutri:nutriView, hydra:hydraView, train:trainingView})[sub]();
}
const routine = {on:false};
function playRoutine(key){
  const r = ROUTINES[key]; Object.assign(routine, {on:true, r, i:0, left:r.steps[0][1], paused:false});
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">${r.name} guidé</p>
    <div class="rt"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="rt-bg"/><circle cx="60" cy="60" r="52" class="rt-fg" id="rtRing"/></svg><b id="rtSec"></b></div>
    <p class="title center" id="rtName" style="font-size:24px"></p><p class="muted" id="rtCue" style="text-align:center"></p><p class="small" id="rtNext" style="text-align:center"></p>
    <div class="grid2"><button class="btn soft" id="rtPause">Pause</button><button class="btn soft" id="rtSkip">Suivant</button></div>`);
  sheet.querySelector("[data-close]").addEventListener("click", stopRoutine);
  $("#rtPause").onclick = () => { routine.paused = !routine.paused; $("#rtPause").textContent = routine.paused ? "Reprendre" : "Pause"; };
  $("#rtSkip").onclick = () => nextRoutine();
  showRoutine(); speak(`${r.name}. ${r.steps[0][0]}, ${r.steps[0][1]} secondes.`, true);
  clearInterval(routine.t); routine.t = setInterval(() => { if(!routine.on || routine.paused) return; routine.left--; if(routine.left === 3) speak("3, 2, 1"); if(routine.left <= 0) nextRoutine(); else showRoutine(); }, 1000);
}
function showRoutine(){
  const s = routine.r.steps[routine.i], n = routine.r.steps[routine.i + 1];
  $("#rtSec").textContent = routine.left; $("#rtName").textContent = s[0]; $("#rtCue").textContent = s[2];
  $("#rtNext").textContent = n ? `Ensuite : ${n[0]} · ${routine.i + 1}/${routine.r.steps.length}` : `Dernier exercice · ${routine.i + 1}/${routine.r.steps.length}`;
  const c = 2*Math.PI*52; $("#rtRing").style.strokeDasharray = c; $("#rtRing").style.strokeDashoffset = c*(1 - routine.left/s[1]);
}
function nextRoutine(){
  routine.i++;
  if(routine.i >= routine.r.steps.length){ const end = routine.r.end; stopRoutine(); speak(end, true); celebrate(120); openModal(`<div class="center"><div class="medal">${I.check}</div><p class="title">${esc(end)}</p></div><button class="btn hero block" id="rtGo">${I.route}Générer ma boucle</button><button class="linkbtn" data-close style="align-self:center">Fermer</button>`); $("#rtGo").onclick = () => { closeModal(); go("plan"); }; return; }
  const s = routine.r.steps[routine.i]; routine.left = s[1]; showRoutine(); speak(`${s[0]}, ${s[1] >= 60 ? Math.round(s[1]/60) + " minute" + (s[1] >= 120 ? "s" : "") : s[1] + " secondes"}.`, true);
}
function stopRoutine(){ routine.on = false; clearInterval(routine.t); }

function viewMine(){
  const list = S.loops.filter(l => !S.favOnly || l.fav).slice().reverse(), runs = S.loops.filter(l => l.run);
  const tm = runs.reduce((a, l) => a + l.run.dist, 0), tt = runs.reduce((a, l) => a + l.run.time, 0), tk = runs.reduce((a, l) => a + l.run.kcal, 0);
  return `<p class="eyebrow">Mes boucles</p><p class="title">${runs.length ? `${runs.length} sortie${runs.length > 1 ? "s" : ""}, jamais la même.` : "Toutes tes boucles, jamais deux fois la même."}</p>
    <div class="trio"><div><small>Courus</small><b>${km1(tm)} km</b></div><div><small>Temps</small><b>${hmin(tt)}</b></div><div><small>Brûlées</small><b><span data-count="${tk}">${tk}</span></b></div></div>
    <div class="chips"><button class="chip" data-fo="0" aria-pressed="${!S.favOnly}">Toutes</button><button class="chip" data-fo="1" aria-pressed="${S.favOnly}">Favorites</button></div>
    ${list.length ? `<div class="list">${list.map(l => `<div class="item"><canvas data-lt="${l.id}"></canvas><button class="body" data-open="${l.id}"><div class="t">${esc(l.name)}</div><div class="m">${km1(l.len)} km · ${esc(l.place || "")}${l.run ? ` · ${hms(l.run.time)} · ${l.run.kcal} kcal` : ""}</div><div class="m">${new Date(l.date).toLocaleDateString("fr-FR", {day:"numeric", month:"short"})} <span class="tag ${l.run ? "ok" : ""}">${l.run ? "Courue" : "À courir"}</span></div></button><button class="iconbtn ${l.fav ? "on" : ""}" data-fav="${l.id}" aria-label="Favori">${I.star}</button></div>`).join("")}</div>`
      : `<div class="empty"><p>${S.favOnly ? "Pas encore de favorite." : "Aucune boucle pour l'instant."}</p><button class="btn hero" data-go="plan">${I.route}Générer ma première boucle</button></div>`}`;
}
function viewPremium(){
  if(C.BETA) return `<div class="plan pro"><p class="eyebrow" style="color:var(--gold)">Version bêta</p><p class="title">Tout Traceo est offert pendant la bêta.</p>
      <p class="muted">Boucles illimitées, guidage vocal, Garmin, Strava, GPX et image à partager : tout est ouvert, sans compte et sans paiement. Merci de tester l'app avant son lancement.</p></div>
    <div class="plan"><p class="eyebrow">Au lancement</p><p class="title" style="font-size:22px">Traceo Premium · ${C.PRICE_LABEL} / mois</p>
      <ul class="checks"><li>Boucles illimitées, partout en France</li><li>Envoi sur ta montre Garmin</li><li>Envoi de tes courses sur Strava</li><li>Export GPX pour toutes les montres</li><li>Image de ta boucle à partager</li></ul>
      <p class="small">La version gratuite gardera 3 boucles par semaine, guidage compris.</p></div>`;
  const on = isPremium() && !S.demo && S.premium;
  return `<div class="plan pro"><p class="eyebrow" style="color:var(--gold)">Traceo Premium</p><p class="title">Une boucle neuve à chaque sortie, sans limite.</p>
      <p class="price">${C.PRICE_LABEL}<small> / mois</small></p>
      <ul class="checks"><li>Boucles illimitées, partout en France</li><li>Envoi sur ta montre Garmin</li><li>Envoi de tes courses sur Strava</li><li>Export GPX pour toutes les montres</li><li>Image de ta boucle à partager</li></ul>
      ${on ? `<p><b>Premium actif</b>${S.premium.until ? ` jusqu'au ${new Date(S.premium.until).toLocaleDateString("fr-FR")}` : ""}.</p>${S.premium.via === "sub" ? `<a class="btn block night" href="${C.PAYPAL_MANAGE_URL}" target="_blank" rel="noopener">Gérer mon abonnement PayPal</a>` : S.premium.until && S.premium.until - Date.now() < 7*864e5 ? `<p class="small">Pour continuer après cette date, reprends 31 jours : ils s'ajoutent à ceux qui restent.</p>${payBlock("payMain")}` : ""}` : payBlock("payMain")}
    </div>
    <div class="plan"><p class="eyebrow">Gratuit</p><p class="title" style="font-size:22px">3 boucles par semaine, guidage compris.</p><p class="small">Il te reste ${remaining()} boucle${remaining() > 1 ? "s" : ""} cette semaine.</p></div>`;
}
function viewMe(){
  return `<p class="eyebrow">Profil</p><p class="title">Tes réglages</p>
    <div class="field"><label for="wIn">Poids, pour calculer les calories</label><input class="input" id="wIn" type="number" inputmode="numeric" min="30" max="200" value="${S.weight}"></div>
    <div class="field"><label>Allure moyenne</label><div class="pace" style="background:var(--surface-2);border-radius:14px;padding:8px"><button class="step" data-pace="10">−</button><b class="title" style="font-size:26px" id="meP">${paceTxt(S.pace)} /km</b><button class="step" data-pace="-10">+</button></div></div>
    <label class="switch"><span><b>Guidage vocal</b><br><span class="small">Annonce la rue où tu es, chaque virage et chaque kilomètre.</span></span><input type="checkbox" id="vIn" ${S.voice ? "checked" : ""}></label>
    ${C.BETA || !PV ? "" : `<label class="switch"><span><b>Mode démo Premium</b><br><span class="small">Pour tout tester sans payer sur ce téléphone.</span></span><input type="checkbox" id="demoIn" ${S.demo ? "checked" : ""}></label>`}
    <div class="field"><label>Mes cartes hors connexion</label>${(() => { const m = store.get("maps", []); return m.length ? `<div class="list">${m.map(x => `<div class="wk"><span class="d">${I.route}</span><span class="b"><b>${esc(x.name)}</b><small>Enregistrée le ${new Date(x.date).toLocaleDateString("fr-FR")} · ${x.n} morceaux de carte</small></span><button class="iconbtn" data-delmap="${x.key}" aria-label="Supprimer">${I.x}</button></div>`).join("")}</div>` : `<p class="small">${PV ? "Dans l'app en ligne, le plan de chaque ville choisie s'enregistre ici automatiquement." : "Choisis une ville ou localise-toi : son plan s'enregistre ici automatiquement."}</p>`; })()}</div>
    <button class="btn hero block" id="ckBtn">${I.check}Vérifier que tout fonctionne</button>
    ${standalone ? "" : `<button class="btn night block" id="instBtn">${I.dl}Installer Traceo sur mon téléphone</button>`}
    <div class="row" id="resetRow"><button class="btn soft" id="reset">Effacer mes données</button></div>
    <p class="small" style="text-align:center">Traceo © 2026</p>`;
}

function wire(){
  body.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  if(S.tab === "plan"){
    $("#locBtn") && ($("#locBtn").onclick = locate);
    if(S.view === "form"){
      $("#gen").onclick = generate;
      body.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { S.mode = b.dataset.mode; store.set("mode", S.mode); render(); });
      const sl = $("#slider"); const upd = () => { const v = +sl.value; if(S.mode === "dist"){ S.distKm = v; store.set("distKm", v); } else { S.durMin = v; store.set("durMin", v); } refreshDial(); };
      sl.oninput = upd;
      body.querySelectorAll("[data-step]").forEach(b => b.onclick = () => { sl.value = +sl.value + (+b.dataset.step)*(S.mode === "dist" ? .5 : 5); upd(); });
      body.querySelectorAll("[data-quick]").forEach(b => b.onclick = () => { sl.value = b.dataset.quick; upd(); });
      body.querySelectorAll("[data-pace]").forEach(b => b.onclick = () => { S.pace = Math.max(180, Math.min(900, S.pace + (+b.dataset.pace))); store.set("pace", S.pace); refreshDial(); });
    }
    if(S.view === "result"){
      body.querySelectorAll("[data-th]").forEach(cv => thumb(cv, S.results[+cv.dataset.th].pts));
      body.querySelectorAll("[data-opt]").forEach(b => b.onclick = () => selectOpt(+b.dataset.opt));
      $("#goRun").onclick = () => startRun(curRoute());
      $("#goFly").onclick = () => flyover(curRoute());
      $("#again").onclick = () => { commitMemory(); generate(); };
      $("#edit").onclick = () => { commitMemory(); S.view = "form"; S.results = null; routeLayer.clearLayers(); render(); };
      $("#fav").onclick = () => { const l = curLoop(); if(!l) return; l.fav = !l.fav; store.set("loops", S.loops); toast(l.fav ? "Ajoutée aux favorites." : "Retirée des favorites."); render(); };
      $("#toGpx").onclick = () => { if(needPremium("L'export GPX fait partie de Premium.")) return; const r = curRoute(), n = curLoop()?.name || "Boucle Traceo"; download(gpxBlob(gpxRoute(n, r.pts)), slug(n) + ".gpx"); toast("GPX téléchargé : importe-le dans l'appli de ta montre."); };
      $("#toGarmin").onclick = () => garminFlow(curRoute());
      $("#toMusic").onclick = musicSheet;
      $("#toImg").onclick = () => { const r = curRoute(); posterFlow({pts:r.pts, title:curLoop()?.name || "Ma boucle Traceo", lines:[[km1(r.len) + " km", "distance"], [hmin(r.len/1000*S.pace), "estimée"], [kcal(r.len) + " kcal", "estimées"]]}); };
    }
  }
  if(S.tab === "mine"){
    body.querySelectorAll("[data-lt]").forEach(cv => thumb(cv, S.loops.find(x => x.id === cv.dataset.lt)?.pts));
    body.querySelectorAll("[data-fo]").forEach(b => b.onclick = () => { S.favOnly = b.dataset.fo === "1"; render(); });
    body.querySelectorAll("[data-fav]").forEach(b => b.onclick = () => { const l = S.loops.find(x => x.id === b.dataset.fav); l.fav = !l.fav; store.set("loops", S.loops); render(); });
    body.querySelectorAll("[data-open]").forEach(b => b.onclick = () => {
      const l = S.loops.find(x => x.id === b.dataset.open);
      S.start = l.start; S.loopId = l.id; S.results = [{pts:l.pts, len:l.len, newLen:l.len*(l.newPct ?? 100)/100, ascent:l.ascent, steps:null}]; S.sel = 0; S.view = "result";
      if(startMk) map.removeLayer(startMk); startMk = L.marker([l.start.lat, l.start.lng], {icon:L.divIcon({className:"", html:'<div class="pin"><span>GO</span></div>', iconSize:[40,40], iconAnchor:[4,40]}), zIndexOffset:900}).addTo(map);
      go("plan"); showRoute(S.results[0]);
    });
  }
  if(S.tab === "premium" && !C.BETA) mountPay("payMain");
  if(S.tab === "coach"){
    body.querySelectorAll("[data-routine]").forEach(b => b.onclick = () => playRoutine(b.dataset.routine));
    body.querySelectorAll("[data-mobi]").forEach(b => b.onclick = () => { S.mobi = b.dataset.mobi; render(); });
    body.querySelectorAll("[data-wk]").forEach(b => b.onclick = () => { S.mode = "dist"; S.distKm = +b.dataset.wk; store.set("mode", "dist"); store.set("distKm", S.distKm); S.view = "form"; go("plan"); toast(`Distance réglée sur ${nf(1).format(+b.dataset.wk).replace(",0", "")} km. Touche « Générer ».`); });
    body.querySelectorAll("[data-w]").forEach(b => b.onclick = () => { const t = new Date().toDateString(), h = store.get("water", {d:t, ml:0}); const ml = +b.dataset.w ? (h.d === t ? h.ml : 0) + (+b.dataset.w) : 0; store.set("water", {d:t, ml}); render(); if(+b.dataset.w) toast(`+ ${b.dataset.w} ml, continue comme ça !`, 1800); });
    body.querySelectorAll("[data-plan]").forEach(b => b.onclick = () => { S.training = {plan:b.dataset.plan, start:Date.now(), done:{}}; S.trainWeek = null; store.set("training", S.training); render(); celebrate(80); toast("Programme lancé. Semaine 1, c'est parti !"); });
    body.querySelectorAll("[data-wsel]").forEach(b => b.onclick = () => { S.trainWeek = +b.dataset.wsel; render(); });
    body.querySelectorAll("[data-tick]").forEach(b => b.onclick = () => { const k = b.dataset.tick; if(S.training.done[k]) delete S.training.done[k]; else S.training.done[k] = Date.now(); store.set("training", S.training); render(); });
    $("#trReset") && ($("#trReset").onclick = () => { S.training = null; S.trainWeek = null; store.set("training", null); render(); });
    $("#pfEdit") && ($("#pfEdit").onclick = () => { S.editProfile = true; render(); });
    body.querySelectorAll("[data-nday]").forEach(b => b.onclick = () => { S.nday = b.dataset.nday; store.set("nday", S.nday); render(); });
    body.querySelectorAll("[data-ntime]").forEach(b => b.onclick = () => { S.ntime = b.dataset.ntime; store.set("ntime", S.ntime); render(); });
    body.querySelectorAll("[data-opt]").forEach(b => b.onclick = () => { const [i, id] = b.dataset.opt.split("|"), d = new Date().toDateString(), s = store.get("menuSel", {}); const v = s.d === d ? s.v : {}; v[i] = id; store.set("menuSel", {d, v}); render(); });
    body.querySelectorAll("[data-budget]").forEach(b => b.onclick = () => { store.set("budget", b.dataset.budget); store.set("menuSel", {}); render(); });
    body.querySelectorAll("[data-rec]").forEach(b => b.onclick = () => recipeSheet(b.dataset.rec, +b.dataset.kcal));
    const draft = {...(S.profile || {sex:"h", age:30, height:175, weight:S.weight, goal:"forme", level:"regulier", freq:3})};
    body.querySelectorAll("[data-pf]").forEach(b => b.onclick = () => { draft[b.dataset.pf] = b.dataset.pf === "freq" ? +b.dataset.v : b.dataset.v; body.querySelectorAll(`[data-pf="${b.dataset.pf}"]`).forEach(x => x.setAttribute("aria-pressed", x === b)); });
    $("#pfSave") && ($("#pfSave").onclick = () => {
      const age = Math.round(+$("#pfAge").value), h = Math.round(+$("#pfH").value), w = Math.round(+String($("#pfW").value).replace(",", ".")*10)/10;
      if(!(age >= 14 && age <= 90)) return toast("Entre un âge entre 14 et 90 ans.");
      if(!(h >= 120 && h <= 220)) return toast("Entre une taille entre 120 et 220 cm.");
      if(!(w >= 30 && w <= 200)) return toast("Entre un poids entre 30 et 200 kg.");
      S.profile = {...draft, age, height:h, weight:w}; S.weight = w; store.set("profile", S.profile); store.set("weight", w);
      S.editProfile = false; render(); body.scrollTop = 0; toast("Profil enregistré : ta nutrition est prête.");
    });
  }
  if(S.tab === "me"){
    $("#wIn").onchange = e => { const v = Math.round(+e.target.value); if(v >= 30 && v <= 200){ S.weight = v; store.set("weight", v); if(S.profile){ S.profile.weight = v; store.set("profile", S.profile); } toast("Poids enregistré."); } else toast("Entre un poids entre 30 et 200 kg."); };
    body.querySelectorAll("[data-pace]").forEach(b => b.onclick = () => { S.pace = Math.max(180, Math.min(900, S.pace + (+b.dataset.pace))); store.set("pace", S.pace); $("#meP").textContent = paceTxt(S.pace) + " /km"; });
    $("#vIn").onchange = e => { S.voice = e.target.checked; store.set("voice", S.voice); };
    $("#demoIn") && ($("#demoIn").onchange = e => { S.demo = e.target.checked; store.set("demo", S.demo); updateCrown(); if(S.demo) celebrate(90); toast(S.demo ? "Mode démo Premium activé." : "Retour à l'offre gratuite."); });
    $("#instBtn") && ($("#instBtn").onclick = installFlow);
    $("#ckBtn").onclick = checkApp;
    body.querySelectorAll("[data-delmap]").forEach(b => b.onclick = () => deleteCityMap(b.dataset.delmap));
    $("#reset").onclick = () => { $("#resetRow").innerHTML = `<button class="btn soft" id="rNo">Annuler</button><button class="btn" style="background:#C93A16;border-color:#C93A16;color:#fff" id="rYes">Tout effacer</button>`; $("#rNo").onclick = render; $("#rYes").onclick = () => { try{ Object.keys(localStorage).filter(k => k.startsWith("traceo2:")).forEach(k => localStorage.removeItem(k)); }catch(e){} location.reload(); }; };
  }
}
function counters(){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll("[data-count]").forEach(el => { if(el.dataset.done) return; el.dataset.done = 1; const to = +el.dataset.count, d = +(el.dataset.d || 0), f = nf(d), t0 = performance.now(); const st = t => { const k = Math.min(1, (t - t0)/1000); el.textContent = f.format(to*(1 - Math.pow(1-k, 3))); if(k < 1) requestAnimationFrame(st); }; requestAnimationFrame(st); });
}
function go(tab){ S.tab = tab; document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false")); panel.classList.remove("min"); render(); body.scrollTop = 0; }
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => go(b.dataset.tab));
function updateCrown(){ const c = $("#crown"); if(C.BETA){ c.classList.remove("on"); c.innerHTML = "<span>★</span>Bêta : tout offert"; return; } const on = isPremium(); c.classList.toggle("on", on); c.innerHTML = on ? "<span>★</span>Premium actif" : "<span>★</span>Premium"; }
$("#crown").onclick = () => go("premium");
$("#brand").onclick = () => splash(false);
function askLocation(){ openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="title">D'où pars-tu ?</p><p class="muted">Traceo trace ta boucle depuis ta position. Tu peux aussi taper une adresse en haut ou faire un appui long sur la carte.</p><button class="btn hero block" id="alLoc">Me localiser</button>`); $("#alLoc").onclick = locate; }

/* ---------- Lieux autour de la boucle : monuments, parcs, points d'eau… ---------- */
const POI_ICON = {
  monument:'<svg viewBox="0 0 24 24"><path d="M12 3l3 5H9zM9 8h6v10H9zM6 21h12"/></svg>',
  culture:'<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5M5 9v9M10 9v9M14 9v9M19 9v9M3 21h18"/></svg>',
  eau:'<svg viewBox="0 0 24 24"><path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z"/></svg>',
  parc:'<svg viewBox="0 0 24 24"><path d="M12 3l5 8h-3l4 6H6l4-6H7zM12 17v4"/></svg>',
  culte:'<svg viewBox="0 0 24 24"><path d="M12 2v6M9 5h6M6 21V12l6-4 6 4v9M10 21v-4h4v4"/></svg>',
  vue:'<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
};
function kindOf(t){
  if(t.amenity === "drinking_water") return "eau";
  if(t.leisure === "park") return "parc";
  if(t.amenity === "place_of_worship") return "culte";
  if(t.tourism === "viewpoint") return "vue";
  if(t.historic) return "monument";
  return "culture";
}
async function loadPOIs(route){
  if(!route.pois){
    let pois = [];
    if(PV) pois = PV.pois(route);
    else{
      let s = 90, w = 180, n = -90, e = -180; for(const [la, lo] of route.pts){ s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
      const b = `${(s-.002).toFixed(5)},${(w-.003).toFixed(5)},${(n+.002).toFixed(5)},${(e+.003).toFixed(5)}`;
      const qy = `[out:json][timeout:12];(nwr["historic"]["name"](${b});nwr["tourism"~"^(attraction|museum|viewpoint|artwork)$"]["name"](${b});node["amenity"="drinking_water"](${b});nwr["leisure"="park"]["name"](${b});nwr["amenity"="place_of_worship"]["name"](${b}););out center 400;`;
      try{
        const j = await fetchJSON("https://overpass-api.de/api/interpreter", {method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:"data=" + encodeURIComponent(qy)}, 14000);
        const sample = route.pts.filter((_, i) => i % 3 === 0);
        for(const el of j.elements || []){
          const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon; if(la == null) continue;
          const kind = kindOf(el.tags || {}), max = kind === "parc" ? 220 : 130;
          let md = 1e9; for(const p of sample){ const d = dist(p, [la, lo]); if(d < md) md = d; if(md < 40) break; }
          if(md <= max) pois.push({lat:la, lng:lo, kind, name:el.tags?.name || (kind === "eau" ? "Point d'eau" : "")});
        }
        const prio = {eau:0, monument:1, vue:2, culture:3, parc:4, culte:5};
        pois = pois.filter((p, i) => p.name && !pois.slice(0, i).some(q => q.name === p.name && dist([q.lat, q.lng], [p.lat, p.lng]) < 150)).sort((a, b) => prio[a.kind] - prio[b.kind]).slice(0, 60);
      }catch(e){ pois = []; }
    }
    route.pois = pois;
  }
  if(routeLayer._r !== route) return;
  for(const p of route.pois) L.marker([p.lat, p.lng], {interactive:false, zIndexOffset:-100, icon:L.divIcon({className:"", html:`<div class="poi k-${p.kind}"><i>${POI_ICON[p.kind]}</i><span>${esc(p.name)}</span></div>`, iconSize:[0,0], iconAnchor:[13,13]})}).addTo(routeLayer);
  const n = route.pois.length, water = route.pois.filter(p => p.kind === "eau").length;
  if(n && !run.active && !fly.on) toast(`${n} lieu${n > 1 ? "x" : ""} sur ta boucle${water ? `, dont ${water} point${water > 1 ? "s" : ""} d'eau` : ""}.`, 3200);
}
const zoomClass = () => document.body.classList.toggle("z-hi", map.getZoom() >= 15);
map.on("zoomend", zoomClass); zoomClass();

/* ---------- Visualiser la boucle avant de partir : vue immobile + feuille de route ---------- */
const fly = {on:false};
const stepLayer = L.layerGroup().addTo(map);
function posAt(pts, cum, a){ let lo = 0, hi = cum.length - 1; while(lo < hi - 1){ const m = (lo + hi) >> 1; if(cum[m] <= a) lo = m; else hi = m; } const seg = cum[hi] - cum[lo] || 1, f = Math.min(1, Math.max(0, (a - cum[lo])/seg)); return [pts[lo][0] + (pts[hi][0]-pts[lo][0])*f, pts[lo][1] + (pts[hi][1]-pts[lo][1])*f]; }
function flyover(route){
  stopFly(true);
  const pr = prep(route), total = pr.cum[pr.cum.length-1], steps = pr.steps.filter(s => s.type !== "depart");
  Object.assign(fly, {on:true, route, total, steps});
  document.body.classList.add("fly-on"); $("#fly").hidden = false;
  $("#fTitle").textContent = "Ta boucle";
  $("#fOf").innerHTML = `<b>${km1(total)} km</b> · ${hmin(total/1000*S.pace)} estimées · ${kcal(total)} kcal${route.pois?.length ? ` · ${route.pois.length} lieux` : ""}`;
  const first = pr.steps.find(s => s.type === "depart");
  $("#fSteps").innerHTML = (first ? `<button class="rb" data-rb="-1"><span class="ri go">${TURN.straight}</span><span><b>Départ</b><small>${esc(first.name ? "Sur " + first.name : "Depuis ton point de départ")}</small></span><em>0 km</em></button>` : "")
    + steps.map((s, i) => `<button class="rb" data-rb="${i}"><span class="ri">${turnIcon(s)}</span><span><b>${esc(s.text)}</b></span><em>${km1(s.at)} km</em></button>`).join("")
    + (steps.length ? "" : `<p class="small">Pas de feuille de route pour cette boucle : suis la ligne verte.</p>`);
  stepLayer.clearLayers();
  steps.forEach((s, i) => { if(s.type === "arrive") return; L.marker(s.loc, {interactive:false, icon:L.divIcon({className:"", html:`<span class="stepdot">${i + 1}</span>`, iconSize:[20,20], iconAnchor:[10,10]})}).addTo(stepLayer); });
  $("#fSteps").querySelectorAll("[data-rb]").forEach(b => b.onclick = () => {
    const k = +b.dataset.rb, loc = k < 0 ? route.pts[0] : steps[k].loc;
    $("#fSteps").querySelectorAll(".rb").forEach(x => x.classList.toggle("on", x === b));
    map.flyTo(loc, 17, {duration:.8});
  });
  map.flyToBounds(L.latLngBounds(route.pts), {paddingTopLeft:[24, 40], paddingBottomRight:[24, $("#fly").offsetHeight + 30], duration:.9});
}
function stopFly(keepView){
  if(!fly.on) return; fly.on = false; stepLayer.clearLayers();
  document.body.classList.remove("fly-on"); $("#fly").hidden = true;
  if(!keepView && fly.route) map.flyToBounds(L.latLngBounds(fly.route.pts), {...pad(), duration:.9});
}
$("#fClose").onclick = () => stopFly(false);
$("#fCenter").onclick = () => { if(!fly.route) return; $("#fSteps").querySelectorAll(".rb").forEach(x => x.classList.remove("on")); map.flyToBounds(L.latLngBounds(fly.route.pts), {paddingTopLeft:[24, 40], paddingBottomRight:[24, $("#fly").offsetHeight + 30], duration:.8}); };
$("#hMusicBtn").onclick = musicSheet; $("#fMusic").onclick = musicSheet;
$("#fStart").onclick = () => { const r = fly.route; startRun(r); };

/* ---------- Course guidée ---------- */
// Distance le long de la boucle pour chaque point et chaque indication (calculé une fois par boucle)
function prep(route){
  if(route._cum) return {cum:route._cum, steps:route._steps};
  const cum = [0]; for(let i = 1; i < route.pts.length; i++) cum.push(cum[i-1] + dist(route.pts[i-1], route.pts[i]));
  // les indications arrivent dans l'ordre du parcours : on les place en avançant, jamais en arrière
  let from = 0;
  const steps = (route.steps || []).map(st => {
    if(st.type === "arrive") return {...st, at:cum[cum.length-1]};
    let bi = from, bd = 1e9;
    for(let i = from; i < route.pts.length; i++){ const d = dist(route.pts[i], st.loc); if(d < bd){ bd = d; bi = i; } if(d < 12) break; }
    from = bi; return {...st, at:cum[bi]};
  }).sort((a, b) => a.at - b.at);
  route._cum = cum; route._steps = steps; return {cum, steps};
}
// Bandeau : prochaine indication + rue où l'on se trouve
function paintGuide(steps, along){
  const st = steps.find(s => s.at > along + 8);
  let now = ""; for(const s of steps){ if(s.at <= along + 8 && s.name) now = s.name; else if(s.at > along + 8) break; }
  $("#gNow").textContent = now ? `Tu es sur ${now}` : "";
  if(!st){ $("#gIcon").innerHTML = TURN.straight; $("#gDist").textContent = "Tout droit"; $("#gText").textContent = "Suis la ligne verte."; return null; }
  const d = Math.max(0, st.at - along);
  $("#gIcon").innerHTML = turnIcon(st); $("#gDist").textContent = d < 1000 ? `${Math.round(d/10)*10} m` : `${nf(1).format(d/1000)} km`; $("#gText").textContent = st.text;
  return {st, d};
}
const run = {active:false};
async function startRun(route){
  stopFly(true);
  if(!route.steps){ toast("Guidage rue par rue disponible sur les nouvelles boucles. Suis la ligne verte."); }
  commitMemory();
  Object.assign(run, {active:true, paused:false, route, gps:[], dist:0, elapsed:0, last:null, lastT:null, lastAlt:null, ascent:0, follow:true, idx:0, along:0, off:0, ann:new Set(), cur:-1, kmSaid:0, endSaid:false});
  const pr = prep(route); run.cum = pr.cum; run.steps = pr.steps; run.total = pr.cum[pr.cum.length-1];
  voiceStart();
  document.body.classList.add("run-on"); $("#hud").hidden = false; $("#hud").classList.remove("paused"); $("#guide").hidden = false; $("#hPause").textContent = "Pause";
  $("#gMute").innerHTML = S.voice ? I.sound : I.mute;
  liveLayer.clearLayers(); run.line = L.polyline([], {color:cssv("--blue"), weight:5, opacity:.9, lineCap:"round", interactive:false}).addTo(liveLayer);
  if(!(await NATIVE?.keepAwake(true))){ try{ run.wake = await navigator.wakeLock?.request("screen"); }catch(e){} }
  run.watch = navigator.geolocation.watchPosition(onPos, err => { $("#hGps").textContent = err.code === 1 ? "GPS refusé" : "GPS perdu"; if(err.code === 1) permissionHelp(); }, {enableHighAccuracy:true, maximumAge:0, timeout:20000});
  run.timer = setInterval(tick, 1000); tick(); updateGuide();
  map.setView([route.pts[0][0], route.pts[0][1]], 17); followMode(true); map.on("dragstart", () => { if(run.active && !gesture){ run.follow = false; } });
  syncH();
}
function onPos(p){
  const {latitude:la, longitude:lo, accuracy:acc, altitude:alt} = p.coords, pt = [la, lo];
  $("#hGps").textContent = acc <= 15 ? "GPS excellent" : acc <= 35 ? "GPS correct" : "GPS faible";
  showMe(la, lo, null); if(run.follow && !gesture) map.panTo(pt, {animate:true, duration:.5});
  if(run.paused || acc > 45) return;
  if(run.last){ const d = dist(run.last, pt), dt = (p.timestamp - run.lastT)/1000; if(d < 3) return; if(dt > 0 && d/dt > 9) return; run.dist += d; if(alt != null && run.lastAlt != null && alt - run.lastAlt > 1) run.ascent += alt - run.lastAlt; }
  if(alt != null) run.lastAlt = alt; run.last = pt; run.lastT = p.timestamp;
  run.gps.push({lat:r6(la), lng:r6(lo), t:p.timestamp, ele:alt != null ? Math.round(alt*10)/10 : null}); run.line.addLatLng(pt);
  // progression sur la boucle : point le plus proche, en avançant
  const P = run.route.pts; let bi = run.idx, bd = 1e9; for(let i = run.idx; i < Math.min(P.length, run.idx + 150); i++){ const d = dist(P[i], pt); if(d < bd){ bd = d; bi = i; } }
  if(bd < 60){ run.idx = bi; run.along = run.cum[bi]; run.off = 0; } else run.off++;
  updateGuide(); voiceKm(); tick(true);
}
function updateGuide(){
  const g = $("#guide");
  if(run.off >= 3){ g.classList.add("off"); $("#gIcon").innerHTML = TURN.uturn; $("#gDist").textContent = "Hors parcours"; $("#gText").textContent = "Rejoins la ligne verte sur la carte."; $("#gNow").textContent = ""; if(run.off === 3) speak("Attention, tu t'es écarté du parcours. Rejoins la ligne verte.", true); return; }
  if(g.classList.contains("off")){ g.classList.remove("off"); speak("Tu es de retour sur le parcours."); }
  const r = paintGuide(run.steps, run.along);
  voiceGuide(r);
}

/* ---------- Voix de guidage, comme un GPS ---------- */
let frVoice = null;
function pickVoice(){ try{ const vs = speechSynthesis.getVoices().filter(v => /^fr/i.test(v.lang)); frVoice = vs.find(v => /fr[-_]FR/i.test(v.lang) && /Google|Amélie|Amelie|Thomas|Audrey|Aurélie|Denise|Henri|Marie|Daniel/i.test(v.name)) || vs.find(v => /fr[-_]FR/i.test(v.lang)) || vs[0] || null; }catch(e){} }
if("speechSynthesis" in window){ pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(t){ return t.replace(/[«»]/g, "").replace(/\s+/g, " ").trim(); }
function speak(t, urgent){
  if(!t || !S.voice) return;
  if(NATIVE?.speak(say(t), urgent)) return;
  if(!("speechSynthesis" in window)) return;
  try{ if(urgent) speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(say(t)); u.lang = "fr-FR"; if(frVoice) u.voice = frVoice; u.rate = 1; u.pitch = 1; u.volume = 1; speechSynthesis.speak(u); }catch(e){}
}
const mSay = d => d >= 1000 ? `${nf(1).format(d/1000).replace(",0", "")} kilomètre${d >= 2000 ? "s" : ""}` : `${d > 100 ? Math.round(d/50)*50 : Math.max(10, Math.round(d/10)*10)} mètres`;
const tSay = s => { s = Math.round(s); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60; return h ? `${h} heure${h > 1 ? "s" : ""} ${m} minute${m > 1 ? "s" : ""}` : `${m} minute${m > 1 ? "s" : ""}${x ? ` ${x}` : ""}`; };
const pSay = p => { if(!isFinite(p) || p <= 0) return ""; const m = Math.floor(p/60), x = Math.round(p%60); return `${m} minutes ${x ? x : ""} par kilomètre`; };
const lc = t => t.charAt(0).toLowerCase() + t.slice(1);
const shortTurn = st => st.type === "arrive" ? "tu arrives" : lc(st.text.replace(/\s+sur\s.+$/, ""));
function voiceStart(){
  const st = run.steps.find(s => s.type !== "depart" && s.at > 20), first = run.steps.find(s => s.type === "depart");
  const street = first?.name || run.steps.find(s => s.name)?.name;
  let t = `C'est parti pour ${mSay(run.total)}.`;
  if(street) t += ` Tu es sur ${street}.`;
  if(st){ t += ` Dans ${mSay(st.at)}, ${lc(st.text)}.`; if(st.at <= 320) run.ann.add(run.steps.indexOf(st) + ":far"); }
  speak(t, true);
}
function voiceGuide(r){
  if(!run.steps.length) return;
  // rue actuelle : annoncée juste après chaque virage
  let cur = -1; run.steps.forEach((s, k) => { if(s.at <= run.along + 8) cur = k; });
  if(cur !== run.cur){
    const prev = run.cur; run.cur = cur; const s = run.steps[cur];
    if(prev !== -1 && s && s.type !== "arrive" && s.type !== "depart"){
      let t = s.name ? `Tu es sur ${s.name}.` : "";
      if(r?.st){ const d = r.st.at - run.along; if(d > 450) t += ` Continue tout droit sur ${mSay(d)}.`; }
      if(t) speak(t);
    }
  }
  if(!r) return;
  const i = run.steps.indexOf(r.st), d = r.d;
  // 200 m avant
  if(d <= 230 && d > 90 && !run.ann.has(i + ":far")){ run.ann.add(i + ":far"); speak(r.st.type === "arrive" ? `Dans ${mSay(d)}, tu arrives à ton point de départ.` : `Dans ${mSay(d)}, ${lc(r.st.text)}.`); }
  // juste avant
  if(d <= 40 && !run.ann.has(i + ":now")){ run.ann.add(i + ":now"); run.ann.add(i + ":far");
    if(r.st.type !== "arrive"){ const nxt = run.steps[i+1]; let t = `Maintenant, ${shortTurn(r.st)}.`; if(nxt && nxt.type !== "arrive" && nxt.at - r.st.at < 150) t += ` Puis, ${lc(nxt.text)}.`; speak(t, true); } }
  // fin de boucle
  if(!run.endSaid && run.total - run.along < 500 && run.total > 1500){ run.endSaid = true; speak("Plus que 500 mètres. Tu y es presque !"); }
}
function voiceKm(){
  const k = Math.floor(run.dist/1000); if(k <= run.kmSaid) return; run.kmSaid = k;
  speak(`Kilomètre ${k}. Temps ${tSay(run.elapsed)}. Allure ${pSay(run.elapsed/(run.dist/1000))}.`);
}
$("#gMute").onclick = () => { S.voice = !S.voice; store.set("voice", S.voice); $("#gMute").innerHTML = S.voice ? I.sound : I.mute; toast(S.voice ? "Guidage vocal activé." : "Guidage vocal coupé."); };
function tick(fromPos){
  if(!run.active) return; if(!run.paused && fromPos !== true) run.elapsed++;
  $("#hTime").textContent = hms(run.elapsed); $("#hDist").textContent = km2(run.dist); $("#hPace").textContent = run.dist > 80 ? paceTxt(run.elapsed/(run.dist/1000)) : "–'––"; $("#hKcal").textContent = kcal(run.dist);
  $("#hBar").style.width = Math.min(100, run.along/run.route.len*100) + "%";
}
$("#hPause").onclick = () => { run.paused = !run.paused; $("#hud").classList.toggle("paused", run.paused); $("#hState").textContent = run.paused ? "En pause" : "En course"; $("#hPause").textContent = run.paused ? "Reprendre" : "Pause"; speak(run.paused ? "Course en pause." : "C'est reparti.", true); };
(() => { const b = $("#hStop"); let t = null; const dn = e => { e.preventDefault(); b.classList.add("hold"); t = setTimeout(finishRun, 1100); }; const up = () => { b.classList.remove("hold"); clearTimeout(t); }; b.addEventListener("pointerdown", dn); ["pointerup","pointerleave","pointercancel"].forEach(ev => b.addEventListener(ev, up)); b.addEventListener("keydown", e => { if(e.key === "Enter" || e.key === " ") finishRun(); }); })();
function finishRun(){
  if(!run.active) return; run.active = false; clearInterval(run.timer); navigator.geolocation.clearWatch(run.watch); try{ run.wake?.release(); }catch(e){} NATIVE?.keepAwake(false);
  document.body.classList.remove("run-on"); $("#hud").hidden = true; $("#guide").hidden = true; followMode(false); syncH();
  const res = {time:run.elapsed, dist:run.dist, kcal:kcal(run.dist), pace:run.dist > 0 ? run.elapsed/(run.dist/1000) : null, ascent:Math.round(run.ascent), gps:run.gps};
  const l = curLoop(); if(l && res.dist > 50){ l.run = {time:res.time, dist:res.dist, kcal:res.kcal, ascent:res.ascent, date:Date.now()}; store.set("loops", S.loops); }
  // programme d'entraînement : la course coche la prochaine séance de la semaine
  if(S.training && res.dist > 500){ const p = PL()[S.training.plan], w = curWeek(S.training, p), i = p.gen(w).findIndex((_, s) => !S.training.done[`${w}-${s}`]); if(i >= 0){ S.training.done[`${w}-${i}`] = Date.now(); store.set("training", S.training); setTimeout(() => toast(`Séance ${i + 1} de la semaine ${w} cochée dans ton programme.`, 3500), 2500); } }
  summary(res, l); celebrate(res.dist > 50 ? 240 : 40); if(res.dist > 50) setTimeout(() => speak(`Bravo ! Boucle terminée. ${nf(1).format(res.dist/1000).replace(",0", "")} kilomètres en ${tSay(res.time)}. Allure moyenne ${pSay(res.pace)}. ${res.kcal} calories brûlées.`, true), 300);
}
function summary(res, l){
  const ok = res.dist > 50, name = l?.name || "Course Traceo";
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button>
    <div class="center"><div class="medal">${I.check}</div><p class="title">${ok ? "Bravo, boucle bouclée !" : "Course arrêtée"}</p><p class="muted">${ok ? "Demain, Traceo t'emmène dans d'autres rues." : "Le GPS n'a presque rien enregistré. Vérifie que la localisation est autorisée."}</p></div>
    <div class="stats">
      <div class="stat"><small>Durée</small><b>${hms(res.time)}</b></div>
      <div class="stat a"><small>Distance</small><b><span data-count="${res.dist/1000}" data-d="2">${km2(res.dist)}</span><small>km</small></b></div>
      <div class="stat"><small>Allure moyenne</small><b>${paceTxt(res.pace)}<small>/km</small></b></div>
      <div class="stat"><small>Calories brûlées</small><b><span data-count="${res.kcal}">${res.kcal}</span><small>kcal</small></b></div>
    </div>
    ${ok ? `<button class="btn strava block" id="sStrava">${I.up}Envoyer sur Strava${isPremium() ? "" : '<span class="lock">★</span>'}</button>
    <div class="grid2"><button class="btn garmin" id="sGarmin">${I.watch}Garmin${isPremium() ? "" : '<span class="lock">★</span>'}</button><button class="btn soft" id="sImg">${I.img}Image</button><button class="btn soft" id="sGpx">${I.dl}GPX${isPremium() ? "" : '<span class="lock">★</span>'}</button><button class="btn soft" id="sShare">${I.share}Partager</button></div>` : `<button class="btn night block" data-close>Fermer</button>`}`);
  counters();
  if(!ok) return;
  const blob = () => gpxBlob(gpxActivity(name, res.gps)), fn = slug(name) + "-course.gpx";
  $("#sStrava").onclick = () => { if(needPremium("L'envoi sur Strava fait partie de Premium.")) return; exportThenOpen(blob(), fn, C.STRAVA_UPLOAD_URL); toast("GPX de ta course téléchargé. Sur Strava, choisis ce fichier.", 4500); };
  $("#sGarmin").onclick = () => { if(needPremium("L'envoi sur Garmin fait partie de Premium.")) return; exportThenOpen(blob(), fn, C.GARMIN_IMPORT_ACTIVITY_URL); toast("GPX téléchargé. Sur Garmin Connect, choisis ce fichier.", 4500); };
  $("#sGpx").onclick = () => { if(needPremium("L'export GPX fait partie de Premium.")) return; download(blob(), fn); toast("GPX de ta course téléchargé."); };
  $("#sShare").onclick = () => posterFlow({pts:res.gps.map(p => [p.lat, p.lng]), title:name, lines:[[km2(res.dist) + " km", "distance"], [hms(res.time), "durée"], [paceTxt(res.pace) + "/km", "allure"], [res.kcal + " kcal", "brûlées"]]});
  $("#sImg").onclick = $("#sShare").onclick;
  setTimeout(maybeInstall, 7000);
}

/* ---------- Envois : GPX, Garmin, Strava ---------- */
const gx = s => esc(s).replace(/&#39;/g, "&apos;");
const gpxRoute = (name, pts) => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Traceo" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${gx(name)}</name></metadata>\n<trk><name>${gx(name)}</name><type>running</type><trkseg>\n${pts.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}"/>`).join("\n")}\n</trkseg></trk>\n</gpx>\n`;
const gpxActivity = (name, g) => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Traceo" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${gx(name)}</name><time>${new Date(g[0]?.t || Date.now()).toISOString()}</time></metadata>\n<trk><name>${gx(name)}</name><type>running</type><trkseg>\n${g.map(p => `<trkpt lat="${p.lat}" lon="${p.lng}">${p.ele != null ? `<ele>${p.ele}</ele>` : ""}<time>${new Date(p.t).toISOString()}</time></trkpt>`).join("\n")}\n</trkseg></trk>\n</gpx>\n`;
const gpxBlob = s => new Blob([s], {type:"application/gpx+xml"});
const slug = s => (s || "traceo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "traceo";
function download(blob, name){
  if(PV) return PV.download(blob, name);
  if(NATIVE) return NATIVE.saveFile(blob, name).then(ok => { if(!ok) toast("Partage de fichiers indisponible sur ce téléphone."); }).catch(() => toast("Le fichier n'a pas pu être enregistré."));
  const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
}
// Télécharge (ou, dans l'app, propose le partage du fichier) puis ouvre le site où l'importer
async function exportThenOpen(blob, name, url){ await download(blob, name); setTimeout(() => openExt(url), NATIVE ? 0 : 600); }
function openExt(url){ if(!NATIVE?.openUrl(url)) window.open(url, "_blank", "noopener"); }
async function share(blob, name, title){
  if(NATIVE) return download(blob, name);
  const f = new File([blob], name, {type:blob.type});
  if(!PV && navigator.canShare?.({files:[f]})){ try{ await navigator.share({files:[f], title}); return; }catch(e){ if(e.name === "AbortError") return; } }
  download(blob, name);
}
function needPremium(msg){ if(isPremium()) return false; premiumModal(msg); return true; }
function garminFlow(r){
  if(needPremium("L'envoi sur ta montre Garmin fait partie de Premium.")) return;
  const n = curLoop()?.name || "Boucle Traceo";
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Garmin</p><p class="title">Ta boucle sur ta montre</p>
    <ol class="muted" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px"><li>Touche « Télécharger et ouvrir Garmin ».</li><li>Dans Garmin Connect, Parcours &gt; <b>Importer</b> &gt; choisis le fichier <b>${esc(slug(n))}.gpx</b>.</li><li>Touche <b>Envoyer vers l'appareil</b> : la boucle est sur ta montre.</li></ol>
    <button class="btn garmin block" id="gGo">${I.watch}Télécharger et ouvrir Garmin</button>`);
  $("#gGo").onclick = () => { exportThenOpen(gpxBlob(gpxRoute(n, r.pts)), slug(n) + ".gpx", C.GARMIN_COURSES_URL); closeModal(); };
}

/* ---------- Image de la boucle (1080 × 1350) ---------- */
const lon2x = (lo, z) => (lo + 180)/360*256*2**z;
const lat2y = (la, z) => { const s = Math.sin(RAD(la)); return (.5 - Math.log((1+s)/(1-s))/(4*Math.PI))*256*2**z; };
const loadImg = src => new Promise(r => { const im = new Image(); im.crossOrigin = "anonymous"; const t = setTimeout(() => r(null), 7000); im.onload = () => { clearTimeout(t); r(im); }; im.onerror = () => { clearTimeout(t); r(null); }; im.src = src; });
function rr(c, x, y, w, h, r){ c.beginPath(); c.moveTo(x+r, y); c.arcTo(x+w, y, x+w, y+h, r); c.arcTo(x+w, y+h, x, y+h, r); c.arcTo(x, y+h, x, y, r); c.arcTo(x, y, x+w, y, r); c.closePath(); }
function fit(c, s, max){ s = String(s); if(c.measureText(s).width <= max) return s; while(s.length > 1 && c.measureText(s + "…").width > max) s = s.slice(0, -1); return s + "…"; }
async function poster(o, tiles){
  const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const c = cv.getContext("2d");
  if(o.pts.length < 2) throw new Error("vide");
  let a = 90, b = -90, d = 180, e = -180; for(const [la, lo] of o.pts){ a = Math.min(a, la); b = Math.max(b, la); d = Math.min(d, lo); e = Math.max(e, lo); }
  let z = 18; while(z > 3 && ((lon2x(e, z) - lon2x(d, z)) > W - 180 || (lat2y(a, z) - lat2y(b, z)) > H - 560)) z--;
  const ox = (lon2x(d, z) + lon2x(e, z))/2 - W/2, oy = (lat2y(a, z) + lat2y(b, z))/2 - H/2 + 20;
  c.fillStyle = "#0B1A20"; c.fillRect(0, 0, W, H);
  if(tiles && tileUrl){ const n = 2**z, jobs = []; for(let x = Math.floor(ox/256); x <= Math.floor((ox+W)/256); x++) for(let y = Math.floor(oy/256); y <= Math.floor((oy+H)/256); y++){ if(y < 0 || y >= n) continue; jobs.push(loadImg(tileUrl(z, ((x % n) + n) % n, y)).then(im => im && c.drawImage(im, x*256 - ox, y*256 - oy, 256, 256))); } await Promise.all(jobs); }
  const P = p => [lon2x(p[1], z) - ox, lat2y(p[0], z) - oy];
  c.lineJoin = c.lineCap = "round";
  for(const [w, col, bl] of [[22, "rgba(255,255,255,.9)", 0], [12, "#25C98F", 24]]){ c.strokeStyle = col; c.lineWidth = w; c.shadowColor = bl ? "#25C98F" : "transparent"; c.shadowBlur = bl; c.beginPath(); o.pts.forEach((p, i) => { const [x, y] = P(p); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); }
  c.shadowBlur = 0; const [sx, sy] = P(o.pts[0]); c.fillStyle = "#07131A"; c.beginPath(); c.arc(sx, sy, 20, 0, 7); c.fill(); c.fillStyle = "#fff"; c.beginPath(); c.arc(sx, sy, 8, 0, 7); c.fill();
  const g = c.createLinearGradient(0, 0, 0, 230); g.addColorStop(0, "rgba(5,15,20,.95)"); g.addColorStop(1, "rgba(5,15,20,0)"); c.fillStyle = g; c.fillRect(0, 0, W, 230);
  c.fillStyle = "#fff"; c.font = "800 66px 'Bricolage Grotesque', sans-serif"; c.fillText("traceo", 64, 108);
  c.fillStyle = "#7FE3C3"; c.font = "700 30px Figtree, sans-serif"; c.fillText(new Date().toLocaleDateString("fr-FR", {day:"numeric", month:"long", year:"numeric"}), 64, 152);
  const cy = H - 330; c.fillStyle = "#0E1E25"; c.shadowColor = "rgba(0,0,0,.25)"; c.shadowBlur = 40; rr(c, 44, cy, W - 88, 284, 40); c.fill(); c.shadowBlur = 0;
  c.fillStyle = "#fff"; c.font = "800 50px 'Bricolage Grotesque', sans-serif"; c.fillText(fit(c, o.title, W - 190), 90, cy + 80);
  const cols = o.lines.slice(0, 4), cw = (W - 180)/cols.length;
  cols.forEach(([v, l], i) => { const x = 90 + i*cw; c.fillStyle = i === 0 ? "#25C98F" : "#fff"; c.font = "800 60px 'Bricolage Grotesque', sans-serif"; c.fillText(fit(c, v, cw - 14), x, cy + 170); c.fillStyle = "rgba(255,255,255,.65)"; c.font = "600 27px Figtree, sans-serif"; c.fillText(l, x, cy + 212); });
  c.fillStyle = "rgba(255,255,255,.55)"; c.font = "600 24px Figtree, sans-serif"; c.fillText("Une boucle neuve à chaque sortie · Traceo", 90, cy + 256);
  c.textAlign = "right"; c.font = "500 18px Figtree, sans-serif"; c.fillStyle = "rgba(255,255,255,.5)"; c.fillText(C.GOOGLE_MAPS_KEY ? "Carte © Google" : "© OpenStreetMap © CARTO", W - 24, cy - 14);
  return await new Promise((ok, ko) => { try{ cv.toBlob(x => x ? ok(x) : ko(new Error("blob")), "image/png"); }catch(err){ ko(err); } });
}
async function posterFlow(o){
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Image à partager</p><div class="skel" style="aspect-ratio:4/5"></div>`);
  let blob; try{ blob = await poster(o, true); }catch(e){ try{ blob = await poster(o, false); }catch(e2){ closeModal(); toast("Rien à dessiner pour l'instant."); return; } }
  const u = URL.createObjectURL(blob), fn = slug(o.title) + ".png";
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Image à partager</p><img class="poster" src="${u}" alt="Ta boucle"><div class="grid2"><button class="btn hero" id="pDl">${I.dl}Enregistrer</button><button class="btn soft" id="pSh">${I.share}Partager</button></div><p class="small">Format 1080 × 1350, idéal pour Instagram et les stories.</p>`);
  $("#pDl").onclick = () => { download(blob, fn); toast("Image enregistrée."); };
  $("#pSh").onclick = () => share(blob, fn, o.title);
}

/* ---------- Premium : PayPal ---------- */
function premiumModal(msg){
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><div class="plan pro"><p class="eyebrow" style="color:var(--gold)">Traceo Premium</p><p class="title" style="font-size:24px">${esc(msg)}</p><p class="price">${C.PRICE_LABEL}<small> / mois</small></p><ul class="checks"><li>Boucles illimitées</li><li>Garmin, Strava et GPX</li><li>Image de ta boucle</li></ul>${payBlock("payModal")}</div><button class="linkbtn" data-close style="align-self:center">Plus tard</button>`);
  mountPay("payModal");
}
const subReady = () => !!(C.PAYPAL_CLIENT_ID && C.PAYPAL_PLAN_ID);
function payBlock(id){
  const live = !PV && (subReady() || C.PAYPAL_PAYMENT_LINK);
  return `<div class="paybox" id="${id}">${live && subReady() ? `<div class="skel" style="height:52px"></div>` : `<button class="btn block paypal" data-pp>Payer avec <b>PayPal</b></button>`}</div>
    <p class="small">${subReady() ? "Paiement sécurisé par PayPal : compte PayPal ou carte bancaire. Sans engagement, résiliable à tout moment." : "Paiement sécurisé par PayPal (compte PayPal ou carte bancaire). Un paiement = 31 jours de Premium, sans abonnement ni renouvellement automatique."}</p>`;
}
let ppLoad = null;
function loadPayPal(){ if(window.paypal) return Promise.resolve(window.paypal); return ppLoad = ppLoad || new Promise((ok, ko) => { const s = document.createElement("script"); s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(C.PAYPAL_CLIENT_ID)}&vault=true&intent=subscription&currency=EUR&locale=fr_FR&components=buttons`; s.onload = () => ok(window.paypal); s.onerror = () => { ppLoad = null; ko(new Error("sdk")); }; document.head.appendChild(s); }); }
function unlock(p){ S.premium = p; S.demo = false; store.set("premium", p); store.set("demo", false); updateCrown(); closeModal(); celebrate(280);
  openModal(`<div class="center"><div class="medal">${I.star}</div><p class="title">Bienvenue en Premium !</p><p class="muted">Boucles illimitées, Garmin, Strava et GPX : tout est débloqué.</p></div><button class="btn hero block" data-close>C'est parti</button>`); if(S.tab === "premium" || S.tab === "plan") render(); }
async function mountPay(id){
  const box = document.getElementById(id); if(!box) return; const btn = box.querySelector("[data-pp]");
  if(btn){ btn.onclick = () => {
    if(PV){ toast("Dans l'app en ligne, ce bouton ouvre le paiement PayPal.", 4000); return; }
    if(C.PAYPAL_PAYMENT_LINK){ store.set("payPending", Date.now()); if(NATIVE) openExt(C.PAYPAL_PAYMENT_LINK); else location.href = C.PAYPAL_PAYMENT_LINK; return; }
    toast("Le paiement arrive très bientôt. Réessaie dans quelques jours.", 4500);
  }; return; }
  try{
    const pp = await loadPayPal(); box.innerHTML = "";
    await pp.Buttons({ style:{shape:"pill", color:"gold", layout:"vertical", label:"subscribe", height:50},
      createSubscription:(d, a) => a.subscription.create({plan_id:C.PAYPAL_PLAN_ID, application_context:{brand_name:"Traceo", locale:"fr-FR", shipping_preference:"NO_SHIPPING", user_action:"SUBSCRIBE_NOW"}}),
      onApprove:async d => { let ok = true; if(C.PAYMENT_API){ try{ ok = (await verifySub(d.subscriptionID)).active; }catch(e){} } if(ok) unlock({via:"sub", id:d.subscriptionID, checked:Date.now()}); else toast("PayPal confirme ton abonnement dans un instant. Rouvre l'app.", 5000); },
      onCancel:() => toast("Paiement annulé. Rien n'a été débité."), onError:() => toast("PayPal a rencontré une erreur. Réessaie.", 4500)
    }).render(box);
  }catch(e){ box.innerHTML = `<p class="small">PayPal ne s'est pas chargé. Vérifie ta connexion.</p>`; }
}
async function verifySub(id){ const r = await fetch(C.PAYMENT_API.replace(/\/$/, "") + "/paypal/verify", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({subscription_id:id})}); return r.json(); }
async function payOnLaunch(){
  const u = new URLSearchParams(location.search);
  // Premium par lien (31 jours) : rappel 3 jours avant la fin, puis à la fin, une fois par jour au plus
  const end = S.premium?.via === "link" ? S.premium.until : 0, today = new Date().toDateString();
  if(end && store.get("payNag", "") !== today && u.get("paiement") !== "ok"){
    const days = Math.ceil((end - Date.now())/864e5);
    if(days <= 0){ store.set("payNag", today); setTimeout(() => toast("Ton Premium est terminé. Reprends 31 jours dans l'onglet Premium.", 5000), 2500); }
    else if(days <= 3){ store.set("payNag", today); setTimeout(() => toast(`Ton Premium se termine dans ${days} jour${days > 1 ? "s" : ""}. Prolonge-le dans l'onglet Premium.`, 5000), 2500); }
  }
  if(u.get("paiement") === "ok" && store.get("payPending", 0) > Date.now() - 2*3600e3){ store.set("payPending", 0); history.replaceState(null, "", location.pathname); const from = Math.max(Date.now(), S.premium?.until || 0); unlock({via:"link", until:from + 31*864e5}); return; }
  if(S.premium?.via === "sub" && C.PAYMENT_API && Date.now() - (S.premium.checked || 0) > 6*3600e3){ try{ const j = await verifySub(S.premium.id); if(j.active === false){ S.premium = null; store.set("premium", null); toast("Ton abonnement Premium a pris fin."); } else { S.premium.checked = Date.now(); store.set("premium", S.premium); } updateCrown(); }catch(e){} }
}

/* ---------- Fenêtres ---------- */
const modal = $("#modal"), sheet = $("#sheet");
function openModal(h){ sheet.innerHTML = h; modal.hidden = false; sheet.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeModal)); }
function closeModal(){ if(routine.on) stopRoutine(); modal.hidden = true; sheet.innerHTML = ""; }
modal.addEventListener("click", e => { if(e.target === modal) closeModal(); });
document.addEventListener("keydown", e => { if(e.key === "Escape" && !modal.hidden) closeModal(); });
const heroSvg = `<div class="hero"><svg viewBox="0 0 360 170" preserveAspectRatio="xMidYMid slice"><path class="g" d="M0 40h360M0 85h360M0 130h360M40 0v170M100 0v170M160 0v170M220 0v170M280 0v170M340 0v170"/><path class="o" d="M100 130V85h60V40"/><path class="n" d="M100 130h60V85h60V40h60v45h60v45H220v-45h-60v45z"/><circle class="me2" cx="100" cy="130" r="9"/></svg></div>`;
const hello = () => { const h = new Date().getHours(); return h < 6 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir"; };
const FEATS = [
  [I.route, "Une boucle neuve à chaque sortie", "Traceo écarte les rues qu'il t'a déjà proposées."],
  ['<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/></svg>', "Guidé à la voix", "Rue par rue, virage par virage, comme un GPS."],
  ['<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>', "Ton coach", "Entraînement, nutrition, hydratation et mobilité."],
  [MI_NOTE(), "Ta musique", "Apple Music, Deezer ou YouTube Music à portée de doigt."]
];
function MI_NOTE(){ return '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>'; }
// Écran d'accueil à chaque ouverture : animations, petites bulles, phrases drôles et motivantes
const FUN = [
  "Échauffement des pouces terminé. Place aux jambes.",
  "Ton canapé fait une crise de jalousie.",
  "Ici, on compte les kilomètres, pas les excuses.",
  "Les pigeons du quartier ne t'ont jamais vu passer par là.",
  "Attention : risque élevé d'endorphines.",
  "Nouvelles rues, nouveaux records, même toi en mieux.",
  "Tes baskets ont validé le programme.",
  "Le GPS est prêt. Les mollets aussi ?"
];
let spT = [], spRaf = 0;
const nowTxt = () => { const d = new Date(), s = d.toLocaleDateString("fr-FR", {weekday:"long", day:"numeric", month:"long", year:"numeric"}); return `${s.charAt(0).toUpperCase() + s.slice(1)} · ${d.toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit", second:"2-digit"})}`; };
setInterval(() => { const d = $("#spDate"); if(d) d.textContent = $("#spClock") ? nowTxt().split(" · ")[0] : nowTxt(); const ck = $("#spClock"); if(ck) ck.textContent = new Date().toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"}); const h = $("#helloDate"); if(h) h.textContent = nowTxt().replace(/:\d\d$/, ""); }, 1000);
// Accueil : épuré, une ligne de course qui se dessine, un mot qui change, un seul bouton
const ROTW = ["ailleurs.", "autrement.", "plus loin.", "libre.", "neuf."];
// Logo animé : chaque lettre défile comme un compteur, uniquement parmi les lettres T R A C E O, puis se pose
const WM = "traceo";
function wordmark(){
  // Le coureur trace le mot : un point file sur la ligne de base, chaque lettre surgit à son passage, puis il boucle le « o »
  return `<span class="wm" id="spWm" aria-label="traceo"><span class="wm-l">${[..."trace"].map((c, i) => `<i style="--i:${i}"><b>${c}</b></i>`).join("")}</span><i class="wm-o"><svg viewBox="0 0 20 20"><circle class="wm-ring" cx="10" cy="10" r="7.6" pathLength="100"/><circle class="wm-dot" r="2.4" cx="10" cy="2.4"/></svg></i><u class="wm-run"></u></span>`;
}
function wmRoll(){ const el = $("#spWm"); if(!el) return; el.classList.remove("roll"); void el.offsetWidth; el.classList.add("roll"); }
const spModel = () => "a";
function splash(first){
  const el = $("#splash"), runs = S.loops.filter(l => l.run).length;
  spT.forEach(clearTimeout); spT = []; clearInterval(splash.iv);
  const lbl = first ? "Découvrir Traceo" : "Trouver ma boucle", sw = "";
  el.classList.toggle("spb", spModel() === "b");
  if(spModel() === "b"){ const d = new Date(), sec = d.getSeconds() + d.getMilliseconds()/1000;
    el.innerHTML = `<svg class="spb-lanes" viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <path id="lane1" d="M-20 300V190a110 110 0 0 1 110-110h220a110 110 0 0 1 110 110v110"/><path d="M10 300V190a80 80 0 0 1 80-80h220a80 80 0 0 1 80 80v110"/><path d="M40 300V190a50 50 0 0 1 50-50h220a50 50 0 0 1 50 50v110"/>
        <circle r="4" class="spb-runner"><animateMotion dur="7s" repeatCount="indefinite"><mpath href="#lane1"/></animateMotion></circle></svg>
      <div class="spb-top">${wordmark()}</div>
      <div class="spb-mid">
        <div class="spb-watch"><svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="94" class="spb-ticks"/><circle cx="100" cy="100" r="86" class="spb-track"/><circle cx="100" cy="100" r="86" class="spb-sweep" pathLength="60" style="animation-delay:-${sec.toFixed(2)}s"/></svg>
          <div class="spb-face"><small class="spb-hello">${hello()}</small><b id="spClock">${d.toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"})}</b><small id="spDate">${nowTxt().split(" · ")[0]}</small></div></div>
        <p class="spb-h">Cours <span class="rot" id="spRot">${ROTW[0]}</span></p>
        <p class="spb-q" data-quote>${esc(quoteNow())}</p>
      </div>
      <div class="spb-bot"><button class="spb-go" id="spGoBtn" aria-label="${lbl}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button><span class="orb-label">${lbl}</span>${C.BETA ? `<small>Version bêta · tout est offert</small>` : ""}${sw}</div>`;
  } else
  el.innerHTML = `<svg class="sp-bg" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path class="sp-grid" d="M0 140H400M0 300H400M0 460H400M0 620H400M80 0V800M200 0V800M320 0V800"/>
      <path id="spLoop" class="sp-line" d="M80 640V460Q80 440 100 440H180Q200 440 200 420V320Q200 300 220 300H300Q320 300 320 280V160Q320 140 300 140H160Q140 140 140 160V240Q140 260 120 260H100Q80 260 80 280V380"/>
      <circle r="7" class="sp-dot"><animateMotion dur="5s" begin="1.6s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#spLoop"/></animateMotion></circle>
      <circle cx="80" cy="640" r="10" class="sp-home"/>
    </svg>
    <div class="sp-top"><span class="sp-brand"><svg viewBox="0 0 32 32"><path class="bm-path" d="M7 23c0-8 5.5-14 11.5-14 4.6 0 7.5 2.9 7.5 6.6 0 3.8-3 6.6-6.8 6.6-2.8 0-4.7-1.9-4.7-4.2" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/><circle cx="7" cy="23" r="3.8" fill="#E6F2F0"/></svg>${wordmark()}</span><span class="sp-date" id="spDate">${nowTxt()}</span></div>
    <div class="sp-mid">
      <p class="sp-hello">${hello()}${runs ? ` · ${runs} boucle${runs > 1 ? "s" : ""} au compteur` : ""}</p>
      <h1 class="sp-h">Cours<br><span class="rot" id="spRot">${ROTW[0]}</span></h1>
      <p class="sp-q" data-quote>${esc(quoteNow())}</p>
    </div>
    <div class="sp-bot">${`<button class="sp-orb" id="spGoBtn" aria-label="${first ? "Découvrir Traceo" : "Trouver ma boucle"}">
        <svg class="orb-ring" viewBox="0 0 140 140" aria-hidden="true"><defs><linearGradient id="orbG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#25C98F"/><stop offset="1" stop-color="#1EA6D0"/></linearGradient></defs>
          <circle cx="70" cy="70" r="67" class="orb-bezel"/><circle cx="70" cy="70" r="67" class="orb-bezel5"/>
          <circle cx="70" cy="70" r="58" class="orb-track"/>
          <g><animateTransform attributeName="transform" type="rotate" from="0 70 70" to="360 70 70" dur="4s" repeatCount="indefinite"/>
            <path d="M70 12A58 58 0 0 1 104.1 23.1" class="orb-arc t1"/><path d="M104.1 23.1A58 58 0 0 1 120.2 41" class="orb-arc t2"/><path d="M120.2 41A58 58 0 0 1 127.5 63.9" class="orb-arc"/>
            <circle cx="127.5" cy="63.9" r="9" class="orb-halo"/><circle cx="127.5" cy="63.9" r="4.5" class="orb-dot"/></g></svg>
        <span class="orb-core"><svg class="orb-topo" viewBox="0 0 100 100" aria-hidden="true"><path d="M8 62c14-10 26-4 38-12s22-22 46-14"/><path d="M4 78c18-8 30-2 44-10s26-20 50-10"/><path d="M10 40c12-6 22-2 32-10S62 12 84 16"/><path d="M14 92c16-4 32 0 46-6s24-12 36-8"/></svg>
          <svg class="orb-logo" viewBox="0 0 32 32" aria-hidden="true"><path pathLength="100" d="M7 23c0-8 5.5-14 11.5-14 4.6 0 7.5 2.9 7.5 6.6 0 3.8-3 6.6-6.8 6.6-2.8 0-4.7-1.9-4.7-4.2" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><circle cx="7" cy="23" r="3.6" fill="currentColor"/></svg></span>
      </button>`}<span class="orb-label">${lbl}</span>${C.BETA ? `<small>Version bêta · tout est offert</small>` : ""}${sw}</div>`;
  el.hidden = false;
  let w = 0; splash.iv = setInterval(() => { const r = $("#spRot"); if(!r || el.hidden){ clearInterval(splash.iv); return; } r.classList.add("out"); spT.push(setTimeout(() => { w = (w + 1) % ROTW.length; r.textContent = ROTW[w]; r.classList.remove("out"); r.classList.add("in"); spT.push(setTimeout(() => r.classList.remove("in"), 500)); }, 300)); }, 2400);
  spT.push(setTimeout(wmRoll, 150)); clearInterval(splash.wm); splash.wm = setInterval(() => { if(el.hidden) return clearInterval(splash.wm); wmRoll(); }, 9000);
  el.querySelectorAll("[data-spm]").forEach(b => b.onclick = () => { store.set("spModel", b.dataset.spm); splash(first); });
  $("#spGoBtn").onclick = () => { celebrate(60); el.classList.add("out"); clearInterval(splash.iv); spT.forEach(clearTimeout); setTimeout(() => { el.hidden = true; el.classList.remove("out"); if(first) onboarding(0); else hint(); }, 420); };
}
// Petite bulle d'aide qui pointe la barre de recherche
function hint(){
  if(S.start) return;
  const h = document.createElement("div"); h.className = "hint"; h.innerHTML = `<span class="arr"></span>Tape ta ville ou ton adresse ici, ou touche le bouton bleu pour te localiser.`;
  document.body.appendChild(h); const rm = () => { h.classList.add("bye"); setTimeout(() => h.remove(), 300); };
  q.addEventListener("focus", rm, {once:true}); h.onclick = rm; setTimeout(rm, 7000);
}
const SLIDES = [
  () => `<p class="eyebrow">Tout ce que Traceo fait pour toi</p><p class="title">Ta course, en mieux.</p><div class="feats">${FEATS.map(([ic, t, d]) => `<div class="feat"><span class="fi">${ic}</span><b>${t}</b><small>${d}</small></div>`).join("")}</div>`,
  () => `<div class="center"><div class="medal" style="background:radial-gradient(circle at 35% 30%,#9CD0FF,#1EA6D0 60%,#0B5A78);box-shadow:0 12px 30px rgba(30,166,208,.4)"><svg viewBox="0 0 24 24" style="stroke:#03140D"><path d="M12 2.5L19.5 21 12 17 4.5 21z"/></svg></div><p class="title">D'où veux-tu courir ?</p><p class="muted">Tape ta ville ou ton adresse dans la barre de recherche, ou laisse Traceo te localiser.</p></div><button class="btn hero block" id="obSearch">Chercher une ville ou une adresse</button><button class="btn night block" id="obLoc">Me localiser</button>`
];
function onboarding(i){
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button>${SLIDES[i]()}<div class="dots">${SLIDES.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>${i < SLIDES.length - 1 ? `<button class="btn night block" id="obNext">Suivant</button>` : ""}`);
  $("#obNext") && ($("#obNext").onclick = () => onboarding(i + 1));
  $("#obLoc") && ($("#obLoc").onclick = () => { store.set("onboarded", true); locate(); });
  $("#obSearch") && ($("#obSearch").onclick = () => { store.set("onboarded", true); closeModal(); setTimeout(() => q.focus(), 200); });
  sheet.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => setTimeout(hint, 300)));
  sheet.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => store.set("onboarded", true)));
}

/* ---------- Installer l'app ---------- */
let bip = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); bip = e; });
window.addEventListener("appinstalled", () => { store.set("installed", true); toast("Traceo est sur ton écran d'accueil."); celebrate(120); });
function maybeInstall(){
  if(standalone || PV || store.get("installed", false) || run.active || !modal.hidden || Date.now() - store.get("instAsk", 0) < 3*864e5) return;
  store.set("instAsk", Date.now());
  const el = document.createElement("div"); el.className = "install";
  el.innerHTML = `<img src="icons/icon-192.png" alt=""><p><b>Installe Traceo</b>Sur ton écran d'accueil, en plein écran.</p><button class="btn">Installer</button><button class="iconbtn" aria-label="Fermer">${I.x}</button>`;
  document.body.appendChild(el); $(".btn", el).onclick = () => { el.remove(); installFlow(); }; $(".iconbtn", el).onclick = () => el.remove(); setTimeout(() => el.remove(), 12000);
}
async function installFlow(){
  if(bip){ bip.prompt(); const {outcome} = await bip.userChoice; bip = null; if(outcome === "accepted") store.set("installed", true); return; }
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="title">Ajoute Traceo à ton écran d'accueil</p>
    ${isIOS ? `<ol class="muted" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px"><li>Ouvre Traceo dans <b>Safari</b>.</li><li>Touche <b>Partager</b> en bas de l'écran.</li><li>Choisis <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.</li></ol>` : `<ol class="muted" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px"><li>Ouvre le menu <b>⋮</b> du navigateur.</li><li>Choisis <b>« Installer l'application »</b>.</li></ol>`}
    <button class="btn night block" data-close>Compris</button>`);
}

/* ---------- Confettis ---------- */
function celebrate(n = 160){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = $("#confetti"), c = cv.getContext("2d"), dpr = devicePixelRatio || 1; cv.width = innerWidth*dpr; cv.height = innerHeight*dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = ["#25C98F","#1EA6D0","#7FE3C3","#4FA6FF","#E6F2F0","#0E7A5A"];
  const ps = Array.from({length:n}, () => ({x:innerWidth/2 + (Math.random()-.5)*140, y:innerHeight*.42, vx:(Math.random()-.5)*15, vy:-Math.random()*17 - 6, r:Math.random()*3, vr:(Math.random()-.5)*.4, w:6 + Math.random()*6, h:8 + Math.random()*9, col:cols[Math.floor(Math.random()*cols.length)]}));
  const t0 = performance.now(); (function f(t){ c.clearRect(0, 0, innerWidth, innerHeight); for(const p of ps){ p.vy += .45; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = p.col; c.fillRect(-p.w/2, -p.h/2, p.w, p.h); c.restore(); } if(t - t0 < 3000) requestAnimationFrame(f); else c.clearRect(0, 0, innerWidth, innerHeight); })(t0);
}

// Les citations tournent toutes les 35 secondes, partout dans l'app, en fondu
let lastQ = quoteNow();
function syncQBars(){ const left = QPERIOD - Date.now() % QPERIOD; document.querySelectorAll(".qbar i").forEach(i => { i.style.animation = "none"; void i.offsetWidth; i.style.animation = `qbar ${left}ms linear forwards`; i.style.width = `${(1 - left/QPERIOD)*100}%`; }); }
setInterval(() => { const q = quoteNow(); if(q === lastQ) return; lastQ = q;
  document.querySelectorAll("[data-quote]").forEach(el => { el.classList.remove("qin"); el.classList.add("qout"); setTimeout(() => { el.textContent = q; el.classList.remove("qout"); el.classList.add("qin"); }, 350); });
  syncQBars(); }, 500);

/* ---------- Musique : accès direct aux applis de musique et de podcasts ---------- */
const MI = {
  note:'<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>'
};
const APPS = [
  ["Apple Music", "https://music.apple.com/fr/search?term=running"],
  ["Deezer", "https://www.deezer.com/fr/search/running"],
  ["YouTube Music", "https://music.youtube.com/search?q=running"],
  ["Podcasts", isIOS ? "https://podcasts.apple.com/fr/" : "https://www.deezer.com/fr/channels/podcasts"]
];
function musicSheet(){
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Musique et podcasts</p><p class="title">Ta bande-son</p>
    <p class="eyebrow">Ouvrir une appli</p>
    <div class="appgrid">${APPS.map(([n, u]) => `<a class="btn soft" href="${u}" target="_blank" rel="noopener" data-ext>${esc(n)}</a>`).join("")}</div>
    <p class="small">Lance ta musique avant de partir : elle continue pendant la course. Utilise les commandes de l'écran verrouillé pour changer de morceau.</p>`);
  sheet.querySelectorAll("[data-ext]").forEach(a => a.onclick = e => { e.preventDefault(); openExt(a.href); });
}


/* ---------- Vérifier l'app : tout se teste en un bouton, une fois l'app en ligne ---------- */
const CHECKS = [
  ["https", "Adresse sécurisée (https)", async () => { if(NATIVE) return `App ${NATIVE.platform === "ios" ? "iPhone" : "Android"}`; if(!isSecureContext) throw "L'app doit être ouverte en https."; return location.host; }],
  ["map", "Carte de France (vraies rues)", async () => { if(PV) throw "Carte simulée dans l'aperçu."; if(window.maplibregl && base && base.getMaplibreMap){ const r = await fetch(C.MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark"); if(!r.ok) throw "Le serveur de cartes ne répond pas."; return "MapLibre + OpenFreeMap : toute la France, toutes les rues"; } if(!tileUrl) throw "Fond de carte non chargé."; const ok = await new Promise(r => { const im = new Image(); im.crossOrigin = "anonymous"; const t = setTimeout(() => r(false), 8000); im.onload = () => { clearTimeout(t); r(true); }; im.onerror = () => { clearTimeout(t); r(false); }; im.src = tileUrl(15, 16574, 11268); }); if(!ok) throw "Les images de la carte ne se chargent pas."; return C.GOOGLE_MAPS_KEY ? "Google Maps" : window.maplibregl ? "MapLibre + OpenFreeMap (vectoriel, toutes les rues)" : "OpenStreetMap"; }],
  ["search", "Recherche d'adresses", async () => { const j = await fetchJSON(`${C.GEOCODER_FR}/search?q=${encodeURIComponent("1 rue de la République Saint-Germain-en-Laye")}&limit=1`, {}, 8000); const p = j.features?.[0]?.properties; if(!p) throw "Aucune adresse trouvée."; return p.label; }],
  ["towns", "Toutes les communes", async () => { const a = await fetchJSON("https://geo.api.gouv.fr/departements/31/communes?fields=nom", {}, 8000); if(!a.length) throw "Liste vide."; return `${a.length} communes en Haute-Garonne`; }],
  ["route", "Calcul des boucles sur les vraies rues", async () => { const j = await fetchJSON(`${C.OSRM_FOOT}/route/v1/driving/2.0930,48.8980;2.1000,48.9010;2.0930,48.8980?overview=false&steps=true`, {}, 10000); const r = j.routes?.[0]; if(!r) throw "Aucun itinéraire."; const n = r.legs.flatMap(l => l.steps).find(s => s.name)?.name; return `${(r.distance/1000).toFixed(1).replace(".", ",")} km calculés${n ? ", via " + n : ""}`; }],
  ["gps", "Position GPS", async () => { if(!("geolocation" in navigator)) throw "GPS indisponible sur ce navigateur."; const st = await navigator.permissions?.query({name:"geolocation"}).then(p => p.state).catch(() => "prompt"); if(st === "denied") throw "Position refusée : autorise-la dans les réglages du téléphone."; return st === "granted" ? "Autorisée" : "Sera demandée au premier « Me localiser »"; }],
  ["voice", "Voix de guidage", async () => { if(NATIVE?.hasVoice) return "Synthèse vocale du téléphone"; if(!("speechSynthesis" in window)) throw "Voix indisponible sur ce navigateur."; pickVoice(); return frVoice ? `Voix française : ${frVoice.name}` : "Voix française par défaut"; }],
  ["install", "Installation sur l'écran d'accueil", async () => standalone ? "Installée" : "Possible depuis Profil > Installer"]
];
function checkApp(){
  openModal(`<button class="iconbtn x" data-close aria-label="Fermer">${I.x}</button><p class="eyebrow">Diagnostic</p><p class="title">Vérifier l'app</p>
    ${PV ? `<p class="small">Tu es dans l'aperçu de Claude : la carte, la recherche et le GPS y sont bloqués, ces tests seront rouges ici. Lance-les sur l'adresse de ton app en ligne : ils doivent tous passer au vert.</p>` : `<p class="small">Teste en 10 secondes que tout fonctionne sur ${esc(location.host)}.</p>`}
    <div class="checks2">${CHECKS.map(([k, t]) => `<div class="ck" id="ck-${k}"><span class="st"></span><span><b>${t}</b><small>En attente…</small></span></div>`).join("")}</div>
    <div class="cksum" id="ckSum"></div><button class="btn hero block" id="ckRun">Relancer les tests</button>`);
  $("#ckRun").onclick = runChecks; runChecks();
}
async function runChecks(){
  let ok = 0;
  $("#ckSum").textContent = "";
  await Promise.all(CHECKS.map(async ([k, , fn]) => {
    const row = $("#ck-" + k); if(!row) return; row.className = "ck run"; row.querySelector("small").textContent = "Test en cours…";
    try{ const msg = await fn(); row.className = "ck ok"; row.querySelector("small").textContent = msg; ok++; }
    catch(e){ row.className = "ck ko"; row.querySelector("small").textContent = typeof e === "string" ? e : "Service injoignable."; }
  }));
  const s = $("#ckSum"); if(!s) return;
  s.className = "cksum " + (ok === CHECKS.length ? "ok" : "ko");
  s.textContent = ok === CHECKS.length ? "Tout est vert : Traceo est prête à être lancée." : `${ok} sur ${CHECKS.length} au vert.${PV ? " Normal dans l'aperçu." : " Envoie-moi une capture : je te dis quoi corriger."}`;
  if(ok === CHECKS.length) celebrate(160);
}


/* ---------- Cartes hors connexion : chaque ville choisie est enregistrée automatiquement ---------- */
// Le plan (rayon de 2,5 km, zooms 13 à 16) est rangé dans le téléphone : il reste disponible sans réseau.
function tilesAround(lat, lng, km = 2.5){
  const out = [];
  for(let z = 13; z <= 16; z++){
    const n = 2**z, d = km/111, dl = km/(111*Math.cos(RAD(lat)));
    const x0 = Math.floor((lng - dl + 180)/360*n), x1 = Math.floor((lng + dl + 180)/360*n);
    const ty = la => Math.floor((1 - Math.log(Math.tan(RAD(la)) + 1/Math.cos(RAD(la)))/Math.PI)/2*n);
    for(let x = x0; x <= x1; x++) for(let y = ty(lat + d); y <= ty(lat - d); y++) out.push(tileUrl(z, x, y));
  }
  return out;
}
async function saveCityMap(s){
  if(PV || !tileUrl || C.GOOGLE_MAPS_KEY || !("caches" in window) || !navigator.onLine) return;
  const maps = store.get("maps", []), key = `${s.lat.toFixed(2)},${s.lng.toFixed(2)}`;
  if(maps.some(m => m.key === key)) return;
  const urls = tilesAround(s.lat, s.lng), cache = await caches.open("traceo-tiles"); let done = 0, i = 0;
  const worker = async () => { while(i < urls.length){ const u = urls[i++]; try{ if(!(await cache.match(u))){ const r = await fetch(u, {mode:"cors"}); if(r.ok) await cache.put(u, r); } done++; }catch(e){} } };
  await Promise.all(Array.from({length:6}, worker));
  const name = (s.label || "").replace(/^Centre de /, "").split(",").slice(-1)[0].replace(/\(.*\)/, "").trim() || "Ma position";
  maps.unshift({key, name, lat:s.lat, lng:s.lng, n:done, date:Date.now()}); store.set("maps", maps.slice(0, 30));
  toast(`Plan de ${name} enregistré : disponible même sans réseau.`, 3200);
}
async function deleteCityMap(key){
  const maps = store.get("maps", []), m = maps.find(x => x.key === key); if(!m) return;
  try{ const cache = await caches.open("traceo-tiles"); await Promise.all(tilesAround(m.lat, m.lng).map(u => cache.delete(u))); }catch(e){}
  store.set("maps", maps.filter(x => x.key !== key)); render(); toast("Plan supprimé du téléphone.");
}

/* ---------- Démarrage ---------- */
rebuildMemory(); render(); payOnLaunch();
if("serviceWorker" in navigator && location.protocol === "https:" && !PV && !NATIVE) navigator.serviceWorker.register("sw.js").catch(() => {});
// À l'ouverture : un écran d'accueil motivant. Pas de localisation automatique : l'utilisateur choisit son départ.
if(new URLSearchParams(location.search).has("test")) setTimeout(checkApp, 300); else splash(!store.get("onboarded", false));
