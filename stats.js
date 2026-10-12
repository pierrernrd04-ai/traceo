// Mesure d'audience Traceo : sans cookie, sans rien stocker sur l'appareil, statistiques agrégées uniquement
// (visites, pages vues, clics sur les boutons marqués data-ev). Exemptée de consentement selon les règles de la CNIL.
(function(){
  try{
    var h = location.hostname;
    if(navigator.webdriver || window.TRACEO_TEST || h === "localhost" || h === "127.0.0.1" || /[?&](test|noauth)\b/.test(location.search) || /admin(\.html)?$/.test(location.pathname)) return;
    var API = "https://traceo-api.pierre-rnrd04.workers.dev/social/hit";
    var q = new URLSearchParams(location.search), src = q.get("src") || q.get("utm_source") || "";
    var send = function(ev){
      var d = JSON.stringify({e:ev, p:location.pathname, r:document.referrer || "", s:src});
      try{ if(navigator.sendBeacon && navigator.sendBeacon(API, new Blob([d], {type:"text/plain"}))) return; }catch(e){}
      try{ fetch(API, {method:"POST", body:d, keepalive:true, mode:"no-cors", headers:{"Content-Type":"text/plain"}}); }catch(e){}
    };
    send("pv");
    document.addEventListener("click", function(e){ var a = e.target && e.target.closest && e.target.closest("[data-ev]"); if(a) send("clic:" + a.getAttribute("data-ev")); }, true);
    window.traceoTrack = function(what){ send("clic:" + String(what).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24)); };
  }catch(e){}
})();
