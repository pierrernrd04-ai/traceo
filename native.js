// Traceo — pont vers les fonctions du téléphone quand l'app tourne en application native (Capacitor).
// Dans un navigateur, ce fichier ne fait rien : TRACEO_NATIVE vaut null et l'app web reste inchangée.
(function(){
  const cap = window.Capacitor;
  if(!cap || !cap.isNativePlatform || !cap.isNativePlatform()){ window.TRACEO_NATIVE = null; return; }
  const P = cap.Plugins || {};
  const has = name => !!(P[name] && (!cap.isPluginAvailable || cap.isPluginAvailable(name)));

  // Blob -> base64 (sans l'en-tête data:)
  const b64 = blob => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = ko; r.readAsDataURL(blob); });

  window.TRACEO_NATIVE = {
    platform: cap.getPlatform(),

    // Voix de guidage : la WebView Android n'a pas speechSynthesis, on passe par la synthèse vocale du téléphone.
    hasVoice: has("TextToSpeech"),
    speak(text, urgent){
      if(!has("TextToSpeech")) return false;
      const tts = P.TextToSpeech;
      (urgent ? tts.stop().catch(() => {}) : Promise.resolve())
        .then(() => tts.speak({text, lang:"fr-FR", rate:1.0, pitch:1.0, volume:1.0, category:"playback", queueStrategy:urgent ? 0 : 1}))
        .catch(() => {});
      return true;
    },
    stopVoice(){ if(has("TextToSpeech")) P.TextToSpeech.stop().catch(() => {}); },

    // Fichiers (GPX, image) : écrits dans le cache de l'app puis proposés via la feuille de partage du téléphone
    // (Strava, Garmin Connect, Fichiers, WhatsApp…). Les liens <a download> ne marchent pas dans une app.
    async saveFile(blob, name, title){
      if(!has("Filesystem") || !has("Share")) return false;
      const {uri} = await P.Filesystem.writeFile({path:name, data:await b64(blob), directory:"CACHE"});
      try{ await P.Share.share({title:title || name, files:[uri], dialogTitle:title || "Enregistrer ou envoyer"}); }
      catch(e){ if(!/cancel/i.test(String(e && (e.message || e)))) throw e; }
      return true;
    },

    // Écran allumé pendant la course
    async keepAwake(on){
      if(!has("KeepAwake")) return false;
      try{ await (on ? P.KeepAwake.keepAwake() : P.KeepAwake.allowSleep()); return true; }catch(e){ return false; }
    },

    // Sites externes (Strava, Garmin, PayPal, Spotify) : ouverts dans le navigateur intégré
    openUrl(url){
      if(has("Browser")){ P.Browser.open({url, presentationStyle:"popover"}).catch(() => { window.location.href = url; }); return true; }
      return false;
    }
  };
})();
