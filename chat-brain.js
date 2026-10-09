// Traceo — cerveau du chat intégré (fonctionne sans serveur ni connexion à une IA).
// Comprend la question (mots-clés pondérés, synonymes, fautes courantes), extrait les valeurs utiles
// (distances, chronos, allures, vitesses, âge, poids, VMA, fréquence cardiaque), calcule, et garde le fil
// de la conversation (« et pour un semi ? »). Renvoie {t, act?, actLabel?, km?, sugg?[]}.
(function(){
  "use strict";
  const plain = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’`]/g, "'");
  const nf = (n, d = 0) => new Intl.NumberFormat("fr-FR", {minimumFractionDigits:d, maximumFractionDigits:d}).format(n);
  const km = n => nf(n, n % 1 ? (Math.round(n*10) % 10 ? 1 : 0) : 0).replace(/,0$/, "");
  const pace = s => { if(!isFinite(s) || s <= 0) return "–"; s = Math.round(s); return `${Math.floor(s/60)}'${String(s%60).padStart(2, "0")}/km`; };
  const dur = s => { s = Math.round(s); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60; return h ? `${h} h ${String(m).padStart(2, "0")}${x ? ` min ${String(x).padStart(2, "0")} s` : ""}` : `${m} min${x ? ` ${String(x).padStart(2, "0")} s` : ""}`; };
  const speed = s => nf(3600/s, 1) + " km/h";
  const RACES = [[5, "5 km"], [10, "10 km"], [21.0975, "semi-marathon"], [42.195, "marathon"]];
  const raceName = d => (RACES.find(r => Math.abs(r[0] - d) < .05) || [0, km(d) + " km"])[1];

  /* ---------- Extraction des valeurs ---------- */
  function extract(t){
    const e = {};
    // distances
    if(/\bmarathon\b/.test(t) && !/semi/.test(t)) e.dist = 42.195;
    else if(/semi/.test(t)) e.dist = 21.0975;
    let m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:km\b|k\b|kms\b|kilo(?:metre)?s?\b|bornes?\b)/);
    if(m && !/km\s*\/\s*h|kmh|km h\b/.test(t.slice(m.index, m.index + m[0].length + 3))) e.dist = parseFloat(m[1].replace(",", "."));
    if(!e.dist && (m = t.match(/(\d+)\s*(?:m\b|metres?\b)/)) && +m[1] >= 100) e.dist = +m[1]/1000;
    // allure explicite (5'30/km, 5:30 min/km, 5 min 30 au km)
    m = t.match(/(\d{1,2})\s*(?:'|:|min|mn|m)\s*(\d{2})?\s*(?:"|s)?\s*(?:\/\s*km|min\s*\/\s*km|au km|par km|du km|le km)/);
    if(m) e.pace = +m[1]*60 + +(m[2] || 0);
    // vitesse
    m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:km\s*\/\s*h|kmh|km h\b|km\/heure|kilometres? heure)/); if(m) e.speed = parseFloat(m[1].replace(",", "."));
    // VMA
    m = t.match(/vma\D{0,12}(\d{1,2}(?:[.,]\d+)?)/) || t.match(/(\d{1,2}(?:[.,]\d+)?)\s*(?:km\/h\s*)?(?:de\s*)?vma/); if(m) e.vma = parseFloat(m[1].replace(",", "."));
    if(e.vma && e.speed === e.vma) delete e.speed;
    // âge, poids, fréquence cardiaque
    m = t.match(/(\d{2})\s*ans\b/); if(m) e.age = +m[1];
    m = t.match(/(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilos?)\b/); if(m) e.weight = parseFloat(m[1].replace(",", "."));
    m = t.match(/(?:fc|frequence cardiaque|pouls)\s*(?:max(?:imale)?)?\D{0,8}(\d{2,3})/) || t.match(/(\d{2,3})\s*(?:bpm|pulsations)/); if(m) e.hr = +m[1];
    m = t.match(/(?:fc|pouls|frequence)\s*(?:de\s*)?repos\D{0,6}(\d{2,3})/) || t.match(/repos\D{0,6}(\d{2,3})/); if(m) e.hrRest = +m[1];
    // chrono (1h45, 1 h 45 min, 3:30:00, 45:30, 52 min, 25'30)
    const tt = t.replace(/(\d{1,2})\s*(?:'|:|min|mn|m)\s*(\d{2})?\s*(?:"|s)?\s*(?:\/\s*km|min\s*\/\s*km|au km|par km|du km|le km)/, " ");
    if((m = tt.match(/(\d{1,2})\s*h(?:eures?)?\s*(\d{1,2})?\s*(?:min|mn|')?/)) && !/km\s*\/?\s*h/.test(tt.slice(m.index - 3, m.index + m[0].length))) e.time = +m[1]*3600 + +(m[2] || 0)*60;
    else if((m = tt.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/))) e.time = +m[1]*3600 + +m[2]*60 + +m[3];
    else if((m = tt.match(/\b(\d{1,3})\s*(?:'|:)\s*(\d{2})\b/))) e.time = +m[1]*60 + +m[2];
    else if((m = tt.match(/(\d{1,3})\s*(?:min(?:utes?)?|mn)\b/))) e.time = +m[1]*60;
    // nombre de séances par semaine
    m = t.match(/(\d)\s*(?:fois|seances?|sorties?|entrainements?)\s*(?:par|\/|a la)\s*semaine/); if(m) e.perWeek = +m[1];
    // durée d'un plan en semaines
    m = t.match(/(\d{1,2})\s*semaines?/); if(m) e.weeks = +m[1];
    return e;
  }

  /* ---------- Intentions : mots-clés pondérés ---------- */
  // [nom, [mots-clés...], poids] ; un mot-clé peut être un morceau de mot (normalisé sans accents)
  const INTENTS = [
    ["loop", ["boucle", "parcours", "itineraire", "trajet", "genere", "trace moi", "fais moi", "propose moi", "circuit"], 3],
    ["predict", ["predi", "estim", "equivalen", "combien je ferai", "combien je peux faire", "temps sur", "je pourrais faire", "potentiel", "en combien"], 3],
    ["pacecalc", ["allure", "rythme", "quel temps", "chrono", "objectif", "vise", "tenir", "au km", "par km", "min/km"], 2],
    ["speed", ["km/h", "kmh", "vitesse", "convert"], 2],
    ["vma", ["vma", "vitesse maximale aerobie", "test cooper", "demi cooper", "vameval", "luc leger"], 4],
    ["hr", ["frequence cardiaque", "fc max", "fcmax", "cardio", "pouls", "zone", "bpm", "battements", "karvonen"], 3],
    ["plan", ["plan", "programme", "preparer", "preparation", "entrainement pour", "m'entrainer", "objectif marathon", "objectif semi", "semaines", "progresser", "ameliorer mon"], 2],
    ["beginner", ["debut", "commencer", "commence", "jamais couru", "reprendre", "reprise", "novice", "premiere fois", "je debute", "couch", "0 a 5"], 3],
    ["interval", ["fractionn", "interval", "30/30", "30 30", "vma courte", "vma longue", "seuil", "tempo", "allure specifique", "piste", "pyramide", "fartlek"], 3],
    ["long", ["sortie longue", "footing long", "endurance fondamentale", "ef", "aisance", "lent", "zone 2"], 2],
    ["hills", ["cote", "denivele", "montee", "descente", "trail", "colline", "d+"], 2],
    ["recovery", ["recup", "repos", "courbature", "jambes lourdes", "fatigue", "surentrainement", "sommeil", "dormir", "massage", "bain froid"], 2],
    ["stretch", ["etirement", "etir", "souplesse", "mobilite", "yoga", "gainage", "renforcement", "muscu", "squat", "pilates", "ppg"], 3],
    ["warmup", ["echauff", "routine", "avant de courir je", "preparer mes muscles"], 3],
    ["nutrition", ["manger", "nutrition", "repas", "aliment", "glucide", "proteine", "petit dej", "diner", "faim", "pates", "regime", "vegan", "vegetarien", "fer", "complement", "vitamine", "magnesium"], 2],
    ["fuel", ["gel", "ravitaill", "manger pendant", "pendant le marathon", "barre", "boisson energetique", "recharge", "surcompensation", "carbo", "glucides par heure"], 3],
    ["hydration", ["boire", "eau", "hydrat", "soif", "electrolyte", "sel", "sodium", "transpir", "sueur", "deshydrat"], 2],
    ["weightloss", ["maigrir", "perdre du poids", "perte de poids", "mincir", "graisse", "kilos en trop", "calorie", "kcal", "bruler"], 2],
    ["fasted", ["a jeun", "jeun", "le ventre vide", "sans manger"], 4],
    ["caffeine", ["cafe", "cafeine", "the ", "energisant", "red bull"], 3],
    ["alcohol", ["alcool", "biere", "vin", "soiree"], 3],
    ["shoes", ["chaussure", "basket", "running shoes", "drop", "amorti", "semelle", "pointure", "usure", "carbone", "minimaliste"], 3],
    ["gear", ["montre", "gps", "vetement", "tenue", "brassiere", "chaussette", "ceinture", "sac", "lampe frontale", "casque", "ecouteur"], 2],
    ["cadence", ["cadence", "foulee", "technique", "posture", "attaque talon", "medio pied", "pas par minute", "ppm", "bras"], 2],
    ["breathing", ["respir", "essouffl", "souffle", "asthme", "nez", "bouche"], 2],
    ["stitch", ["point de cote", "point de côte", "cote qui fait mal", "mal au cote"], 5],
    ["cramp", ["crampe"], 5],
    ["injury", ["blesse", "douleur", "mal au", "mal aux", "mal a la", "mal a l", "genou", "cheville", "tendon", "achille", "periostite", "tibia", "essuie glace", "tfl", "fasciite", "voute plantaire", "talon", "hanche", "dos", "entorse", "ampoule", "fracture", "inflamm", "lombaire", "mollet", "ischio", "cuisse", "contracture", "elongation", "dechirure"], 2],
    ["redflag", ["poitrine", "thorax", "douleur thoracique", "mal a la poitrine", "coeur", "oppression", "malaise", "evanoui", "perte de connaissance", "palpitation", "coeur qui s'emballe", "vertige", "difficulte a respirer"], 8],
    ["heat", ["chaleur", "chaud", "canicule", "soleil", "ete", "humid"], 2],
    ["cold", ["froid", "hiver", "gel ", "neige", "verglas", "temperature negative"], 2],
    ["rain", ["pluie", "pleut", "mouill", "orage", "vent"], 2],
    ["night", ["nuit", "soir", "noir", "obscurite", "eclairage", "securite", "seule", "seul", "agression", "visible", "reflechissant"], 2],
    ["pollution", ["pollution", "pic de pollution", "air pollue", "allergie", "pollen"], 3],
    ["morning", ["matin", "quelle heure", "meilleur moment", "midi", "apres manger", "apres le repas", "digestion"], 2],
    ["treadmill", ["tapis", "salle de sport", "indoor"], 3],
    ["race", ["veille", "jour j", "jour de course", "dossard", "depart de la course", "sas", "course officielle", "competition", "taper", "affutage", "derniere semaine", "avant le marathon", "avant mon semi", "stress"], 2],
    ["after", ["apres la course", "apres le marathon", "apres mon semi", "apres courir", "retour au calme", "apres l'effort"], 3],
    ["frequency", ["combien de fois", "tous les jours", "chaque jour", "frequence d'entrainement", "volume", "kilometres par semaine", "km par semaine", "trop courir"], 3],
    ["motivation", ["motiv", "flemme", "envie", "regularite", "abandonner", "decourag", "ennui", "lassitude", "plaisir"], 2],
    ["women", ["regles", "menstru", "enceinte", "grossesse", "post partum", "allaite", "menopause", "femme"], 3],
    ["age", ["senior", "50 ans", "60 ans", "70 ans", "ado", "enfant", "jeune", "age"], 1],
    ["music", ["musique", "playlist", "podcast", "spotify", "deezer", "apple music", "ecouteur"], 4],
    ["premium", ["premium", "prix", "payer", "paiement", "abonn", "paypal", "gratuit", "beta", "tarif", "combien ca coute", "rembourse", "retractation", "factur"], 3],
    ["install", ["install", "ecran d'accueil", "ecran d accueil", "telecharg", "application mobile", "app store", "play store", "raccourci"], 3],
    ["position", ["position", "localis", "gps ne", "autoris", "depart", "ou je suis", "ma ville", "changer de ville", "adresse de depart"], 2],
    ["export", ["strava", "garmin", "gpx", "coros", "suunto", "polar", "apple watch", "exporter", "synchronis"], 3],
    ["voice", ["voix", "guidage vocal", "son", "parle", "annonce", "muet", "couper la voix"], 2],
    ["map", ["carte", "plan clair", "mode nuit", "mode jour", "soleil", "lune", "nom des rues", "zoom", "hors ligne", "sans reseau"], 2],
    ["history", ["historique", "mes boucles", "favori", "refaire", "ancienne", "anciennes", "precedente", "dernieres boucles", "supprimer une boucle", "retrouver ma boucle"], 4],
    ["share", ["partager", "image", "story", "instagram", "photo de ma boucle"], 2],
    ["data", ["donnees", "rgpd", "vie privee", "confidential", "effacer mes donnees", "supprimer mes donnees", "cookies", "tracking"], 3],
    ["bug", ["bug", "ne marche pas", "marche pas", "fonctionne pas", "probleme", "erreur", "plante", "bloque", "ne charge pas", "ecran blanc", "contact", "support"], 2],
    ["app", ["traceo", "comment ca marche", "a quoi sert", "fonctionnalit", "que peux tu faire", "que sais tu faire", "aide", "help"], 2],
    ["thanks", ["merci", "super", "genial", "top", "parfait", "cool", "nickel"], 2],
    ["hello", ["bonjour", "salut", "hello", "coucou", "bonsoir", "hey", "yo "], 2],
    ["who", ["qui es tu", "t'es qui", "tu es qui", "une ia", " ia ", "intelligence artificielle", " bot", "robot", "humain", "chatgpt", "claude"], 4]
  ];
  function score(t){
    const sc = {};
    for(const [name, words, w] of INTENTS) for(const x of words){ if(t.includes(x)) sc[name] = (sc[name] || 0) + w*(x.length > 6 ? 1.3 : 1); }
    return Object.entries(sc).sort((a, b) => b[1] - a[1]);
  }

  /* ---------- Calculs ---------- */
  const riegel = (t1, d1, d2) => t1*Math.pow(d2/d1, 1.06);
  const VMA_SHARE = d => d <= 3.1 ? .98 : d <= 5.1 ? .94 : d <= 10.1 ? .89 : d <= 21.2 ? .83 : .78;
  const vmaFromPerf = (d, t) => (d/(t/3600))/VMA_SHARE(d);
  function vmaPaces(v){
    const z = [["Endurance fondamentale (footing)", .65, .75], ["Sortie longue / allure marathon", .75, .8], ["Allure semi-marathon", .8, .85], ["Seuil / allure 10 km", .85, .9], ["VMA longue (1000 m)", .9, .95], ["VMA courte (30/30, 200 m)", .98, 1.02]];
    return z.map(([n, a, b]) => `• **${n}** : ${pace(3600/(v*b))} à ${pace(3600/(v*a))}`).join("\n");
  }
  function predictAll(d, t){
    return RACES.filter(r => Math.abs(r[0] - d) > .05).map(([d2, n]) => `• **${n}** : ${dur(riegel(t, d, d2))} (${pace(riegel(t, d, d2)/d2)})`).join("\n");
  }

  /* ---------- Réponses ---------- */
  const R = {};
  R.loop = (t, e, c) => {
    if(e.time && !e.dist){ const mn = Math.max(10, Math.min(240, Math.round(e.time/300)*5)); return {mode:"time", durMin:mn, t:`Une boucle d'environ **${mn} min**, soit ${km(mn*60/c.pace)} km à ton allure (${pace(c.pace)}).${c.start ? "" : "\nIl me faut d'abord ton point de départ."}`, act:"gen", actLabel:c.start ? "Tracer ma boucle" : "Choisir mon départ", sugg:["Une boucle plus courte", "Quelle allure tenir ?"]}; }
    const k = e.dist ? Math.max(2, Math.min(42, Math.round(e.dist*2)/2)) : c.distKm;
    return {km:k, t:`Parfait : une boucle de **${km(k)} km**, environ ${dur(k*c.pace)} à ${pace(c.pace)}, ${Math.round(c.weight*k*1.036)} kcal.${c.start ? ` Départ : ${c.start}.` : "\nIl me faut d'abord ton point de départ."}\nTraceo choisit des rues que tu n'as encore jamais courues.`, act:"gen", actLabel:c.start ? "Tracer ma boucle" : "Choisir mon départ", sugg:["Que manger avant ?", "Un échauffement rapide"]};
  };
  R.pacecalc = (t, e, c, mem) => {
    const p = e.pace || (e.speed ? 3600/e.speed : null), d = e.dist || (e.time && !p ? mem.dist : null), tm = e.time;
    if(d && tm) return {t:`Pour **${raceName(d)} en ${dur(tm)}**, il faut tenir **${pace(tm/d)}**, soit ${speed(tm/d)}.\nConseil : pars 5 à 10 s/km plus lent sur les 2 premiers kilomètres, puis cale-toi sur l'allure. Pour vérifier si c'est réaliste, donne-moi une course récente.`, mem:{dist:d, time:tm, ref:null}, sugg:["Prédis mes autres chronos", "Comment m'entraîner pour ça ?"]};
    if(d && p) return {t:`À **${pace(p)}** (${speed(p)}), tu boucles **${raceName(d)} en ${dur(p*d)}**.`, mem:{dist:d, time:p*d}, sugg:["Et pour un semi ?", "Quelle VMA faut-il ?"]};
    if(p && !d) return {t:`**${pace(p)}** = ${speed(p)}. Ça donne :\n${RACES.map(([d2, n]) => `• ${n} : ${dur(p*d2)}`).join("\n")}`, sugg:["Allure pour 10 km en 50 min", "Mes allures d'entraînement"]};
    return {t:`Ton allure enregistrée est **${pace(c.pace)}** (${speed(c.pace)}).\nDonne-moi une distance et un temps (« 10 km en 50 min », « semi en 1h45 ») et je te calcule l'allure à tenir. Ou une allure (« 5'30/km ») pour voir tes temps de passage.`, act:"me", actLabel:"Changer mon allure", sugg:["Semi en 1h45 ?", "Marathon en 4h ?"]};
  };
  R.speed = (t, e) => {
    if(e.speed) return {t:`**${nf(e.speed, 1)} km/h** = **${pace(3600/e.speed)}**.\n${RACES.map(([d, n]) => `• ${n} : ${dur(3600/e.speed*d)}`).join("\n")}`};
    if(e.pace) return {t:`**${pace(e.pace)}** = **${speed(e.pace)}**.`};
    return {t:`Pour convertir : vitesse (km/h) = 60 ÷ allure en minutes. Par exemple 5'00/km = 12 km/h, 6'00/km = 10 km/h. Donne-moi une valeur et je convertis.`};
  };
  R.predict = (t, e, c, mem) => {
    let d = e.dist, tm = e.time;
    if((!d || !tm) && mem.ref){ const target = e.dist; d = mem.ref.d; tm = mem.ref.t;
      if(target && Math.abs(target - d) > .05) return {t:`D'après ton **${raceName(d)} en ${dur(tm)}**, tu peux viser environ **${dur(riegel(tm, d, target))}** sur ${raceName(target)} (${pace(riegel(tm, d, target)/target)}), à condition d'avoir l'entraînement spécifique${target > 30 ? ", surtout les sorties longues" : ""}.`, mem:{dist:target}, sugg:["Mes allures d'entraînement", "Un plan pour cet objectif"]}; }
    if(d && tm) return {t:`Avec **${raceName(d)} en ${dur(tm)}** (${pace(tm/d)}), tes chronos équivalents :\n${predictAll(d, tm)}\nVMA estimée : **${nf(vmaFromPerf(d, tm), 1)} km/h**. Ces estimations supposent un entraînement adapté à chaque distance, surtout pour le marathon.`, mem:{ref:{d, t:tm}, vma:vmaFromPerf(d, tm)}, sugg:["Mes allures d'entraînement", "Un plan semi-marathon"]};
    return {t:`Donne-moi une course récente, par exemple « j'ai fait 10 km en 52 min », et je prédis tes temps sur 5 km, semi et marathon, avec ta VMA estimée.`, sugg:["J'ai fait 10 km en 50 min", "J'ai fait un 5 km en 25 min"]};
  };
  R.vma = (t, e, c, mem) => {
    const def = /c'est quoi|c est quoi|qu'est ce|qu est ce|definition|ca veut dire|signifie|explique/.test(t);
    let v = e.vma || (e.dist && e.time ? vmaFromPerf(e.dist, e.time) : null) || (def ? null : mem.vma);
    if(!v && e.speed && /vma/.test(t)) v = e.speed;
    if(v) return {t:`Avec une **VMA de ${nf(v, 1)} km/h**, tes allures d'entraînement :\n${vmaPaces(v)}\nChronos potentiels : 10 km ≈ ${dur(10/(v*.89)*3600)}, semi ≈ ${dur(21.0975/(v*.83)*3600)}, marathon ≈ ${dur(42.195/(v*.78)*3600)}.`, mem:{vma:v}, sugg:["Une séance de fractionné", "Comment améliorer ma VMA ?"]};
    return {t:`La **VMA** (vitesse maximale aérobie) est la vitesse à laquelle tu consommes le maximum d'oxygène ; tu peux la tenir 4 à 7 minutes.\n**La mesurer** : demi-Cooper (6 min à fond sur piste : distance en m ÷ 100 = VMA), ou estimation depuis une course (« 10 km en 50 min »).\n**L'améliorer** : 1 séance par semaine de fractionné court (30/30, 10 × 400 m) puis long (5 × 1000 m), sur 6 à 8 semaines.`, sugg:["J'ai fait 10 km en 50 min", "Ma VMA est 14"]};
  };
  R.hr = (t, e, c, mem) => {
    const age = e.age || mem.age, max = e.hr && /max/.test(t) ? e.hr : age ? Math.round(208 - .7*age) : null, rest = e.hrRest;
    if(max){
      const z = [["Z1 récupération", .5, .6], ["Z2 endurance fondamentale", .6, .7], ["Z3 tempo", .7, .8], ["Z4 seuil", .8, .9], ["Z5 VMA", .9, 1]];
      const f = p => Math.round(rest ? rest + p*(max - rest) : p*max);
      return {t:`FC max ${e.hr && /max/.test(t) ? "" : `estimée (formule de Tanaka, ${age} ans) `}: **${max} bpm**.${rest ? ` Repos : ${rest} bpm (méthode de Karvonen).` : ""}\n${z.map(([n, a, b]) => `• **${n}** : ${f(a)} à ${f(b)} bpm`).join("\n")}\nL'essentiel de l'entraînement (80 %) se fait en Z1-Z2. Une formule reste une estimation : un test d'effort est plus fiable.`, mem:{age}, sugg:["C'est quoi l'endurance fondamentale ?", "Une séance au seuil"]};
    }
    return {t:`Donne-moi ton âge (« j'ai 35 ans ») et, si tu la connais, ta fréquence cardiaque de repos (« repos 55 »). Je calcule tes 5 zones cardiaques.\nRepère simple : en endurance fondamentale, tu dois pouvoir parler en phrases complètes.`, sugg:["J'ai 30 ans", "J'ai 45 ans, repos 60"]};
  };
  R.plan = (t, e, c, mem) => {
    const d = e.dist || mem.dist || (/(marathon)/.test(t) && !/semi/.test(t) ? 42.195 : /semi/.test(t) ? 21.0975 : null);
    const n = e.perWeek || (d >= 21 ? 4 : 3), w = e.weeks || (d >= 42 ? 16 : d >= 21 ? 12 : d >= 10 ? 8 : 6);
    if(!d) return {t:`Je te prépare un plan : quel objectif ? « plan 10 km », « semi en 12 semaines », « marathon en 4h, 4 sorties par semaine ».\nLes programmes complets (5 km, 10 km, semi, marathon) avec séances détaillées sont dans l'onglet **Coach**.`, act:"coach", actLabel:"Voir les programmes", sugg:["Plan 10 km", "Plan semi-marathon", "Plan marathon"]};
    const goal = e.time ? ` en ${dur(e.time)} (${pace(e.time/d)})` : "";
    const sp = e.time ? e.time/d : null, v = sp ? 3600/sp/VMA_SHARE(d) : mem.vma || null;
    const ef = v ? `${pace(3600/(v*.72))}` : "allure où tu peux parler";
    const sessions = [
      `**Sortie longue** : ${d >= 42 ? "1 h 30 → 2 h 45" : d >= 21 ? "1 h 15 → 2 h" : "50 min → 1 h 15"}, en endurance (${ef})`,
      `**Fractionné** : ${d >= 21 ? "seuil, 3 × 10 min puis 2 × 20 min" : "VMA, 10 × 400 m puis 6 × 1000 m"}${v ? ` (VMA ${nf(v, 1)} km/h)` : ""}`,
      `**Footing facile** : 40 à 50 min, relâché`,
      n >= 4 ? `**Allure spécifique** : ${d >= 42 ? "2 × 5 km" : "3 × 3 km"} à ${sp ? pace(sp) : "l'allure objectif"}` : null,
      n >= 5 ? `**Récupération active** : 30 min très lent ou vélo` : null
    ].filter(Boolean).slice(0, n);
    return {t:`Plan **${raceName(d)}${goal}**, ${w} semaines, ${n} sorties/semaine :\n${sessions.map(s => "• " + s).join("\n")}\n**Progression** : semaines 1-${Math.round(w*.35)} fondation (volume), ${Math.round(w*.35) + 1}-${Math.round(w*.8)} spécifique (intensité), puis affûtage (volume -40 %). Une semaine allégée toutes les 3-4 semaines. Ne monte pas ton volume de plus de 10 % par semaine.`, mem:{dist:d}, act:"coach", actLabel:"Programme détaillé dans Coach", sugg:["Que manger pendant la course ?", "Comment gérer la dernière semaine ?"]};
  };
  R.fuel = (t, e, c) => {
    const base = {...TXT.fuel};
    if(e.dist && e.dist >= 12){ const sec = e.time || e.dist*c.pace, h = sec/3600, g = Math.max(0, Math.ceil((h - .75)*45/22));
      base.t = `Pour **${raceName(e.dist)}** en environ ${dur(sec)}${e.time ? "" : ` (à ton allure de ${pace(c.pace)})`} : vise **${g} gel${g > 1 ? "s" : ""}** (≈ 45 g de glucides/heure), le premier vers 40-45 min puis toutes les 30-40 min, toujours avec quelques gorgées d'eau.\n` + base.t; }
    return base;
  };
  R.weightloss = (t, e, c) => {
    const base = {...TXT.weightloss}, w = e.weight || c.weight;
    if(e.dist || e.time){ const d = e.dist || e.time/c.pace; base.t = `**${km(d)} km** à ${w} kg ≈ **${Math.round(w*d*1.036)} kcal** dépensées.\n` + base.t; }
    return base;
  };
  const TXT = {
    beginner:{t:`Bienvenue dans la course ! Programme de départ sur 6 semaines, 3 sorties par semaine, jamais 2 jours de suite :\n• **Sem. 1-2** : 8 × (1 min course + 2 min marche)\n• **Sem. 3-4** : 6 × (3 min course + 1 min marche)\n• **Sem. 5** : 3 × 8 min de course, 2 min de marche\n• **Sem. 6** : 25 à 30 min de course continue\nCours lentement, assez pour pouvoir parler. Et commence par une boucle de 2 à 3 km avec Traceo.`, act:"gen3", actLabel:"Une boucle de 3 km", sugg:["Quelles chaussures choisir ?", "Un échauffement rapide"]},
    interval:{t:`Les séances clés :\n• **30/30** : 10 à 20 × (30 s vite à ~100 % VMA / 30 s trot) — développe la VMA\n• **400 m** : 8 à 12 × 400 m à 95-100 % VMA, récup 1 min\n• **1000 m** : 5 × 1000 m à 90-95 % VMA, récup 2 min\n• **Seuil** : 3 × 10 min à 85-88 % VMA (allure 10 km-semi), récup 2 min\nToujours 15-20 min d'échauffement avant, 10 min de retour au calme après. Une seule séance intense par semaine si tu cours 3 fois.`, sugg:["Calcule mes allures (VMA 14)", "C'est quoi le seuil ?"]},
    long:{t:`L'**endurance fondamentale** (65-75 % de ta VMA, Z2) est la base : 70 à 80 % de ton volume. Tu dois pouvoir parler en phrases complètes. Elle développe le cœur, les capillaires et l'utilisation des graisses.\nLa **sortie longue** (1 h à 2 h 30 selon l'objectif) se court à cette allure, parfois avec une fin à allure objectif. Elle ne doit pas dépasser 30 % de ton volume hebdomadaire.`, sugg:["Calcule mes zones cardiaques", "Que manger pendant une sortie longue ?"]},
    hills:{t:`**Côtes** : excellentes pour la puissance et la foulée. Séance type : 8 à 10 × 30-45 s en montée dynamique, retour en trottinant.\nEn montée : petits pas, buste légèrement penché, regarde 5 m devant, garde l'effort constant plutôt que l'allure. En descente : relâche, pose le pied sous toi, cadence rapide.\nEn trail, raisonne en effort (cardio, sensations) plutôt qu'en allure, et marche dans les montées raides.`},
    recovery:{t:`La progression se fait **pendant la récupération** :\n• **Sommeil** : 7 à 9 h, c'est le meilleur outil\n• **Après une séance dure** : 48 h avant la suivante ; footing très lent ou repos\n• **Courbatures** : normales 24-72 h après un effort nouveau ; marche, mobilité douce, hydratation\n• **Signes de surentraînement** : fatigue qui dure, FC de repos +5 bpm, motivation en baisse, performances qui chutent → allège 1 semaine\n• Une semaine allégée (-30 %) toutes les 3-4 semaines`, sugg:["Étirements après la course", "Que manger après ?"]},
    stretch:{t:`**Renforcement** (2 × 20 min/semaine, le meilleur anti-blessure) : gainage (3 × 45 s), squats (3 × 15), fentes (3 × 10/jambe), pont fessier (3 × 15), mollets sur une marche (3 × 15).\n**Étirements** : doux, 20-30 s, plutôt à distance des séances intenses ; avant de courir, préfère la mobilité dynamique (montées de genoux, talons-fesses, cercles de hanches).\nLes routines guidées sont dans l'onglet Coach.`, act:"coach", actLabel:"Ouvrir les routines", sugg:["Un échauffement rapide"]},
    warmup:{t:`Échauffement express (8 min) :\n1. 3 min de marche rapide puis trot léger\n2. 10 montées de genoux, 10 talons-fesses, 10 pas chassés de chaque côté\n3. 10 fentes avant, 10 cercles de hanches\n4. 3 accélérations progressives de 15 s\nPour une séance de fractionné ou une course : 15-20 min, avec des gammes et 3-4 accélérations. Les routines guidées à la voix sont dans l'onglet Coach.`, act:"coach", actLabel:"Lancer une routine"},
    nutrition:{t:`**Au quotidien** : glucides complexes (riz, pâtes, pain complet, flocons d'avoine, patates douces), protéines à chaque repas (1,2 à 1,6 g/kg/jour), fruits et légumes, bonnes graisses.\n**Avant de courir** : repas 2-3 h avant, ou collation légère 30-60 min avant (banane, compote, pain blanc + miel). Évite fibres et gras juste avant.\n**Après** : dans l'heure, glucides + protéines (yaourt et banane, riz et œufs, lait chocolaté).\nCoureur végétarien : surveille le fer et la B12 (bilan sanguin conseillé).`, act:"coach", actLabel:"Mon plan nutrition", sugg:["Que manger pendant un marathon ?", "Courir à jeun, bonne idée ?"]},
    hydration:{t:`• **Avant** : 300-500 ml dans les 2 h\n• **Pendant** : sous 1 h par temps doux, pas besoin d'emporter d'eau ; au-delà ou s'il fait chaud, 400-800 ml/heure par petites gorgées\n• **Électrolytes** : si l'effort dépasse 1 h 30 ou si tu transpires beaucoup (traces de sel), boisson avec 300-600 mg de sodium par litre\n• **Après** : boire 1,5 fois le poids perdu\nAstuce : pèse-toi avant et après une sortie d'1 h ; chaque kilo perdu ≈ 1 litre de sueur.\nTraceo affiche les points d'eau proches de ta boucle.`},
    weightloss:{t:`Courir aide à perdre du poids si c'est régulier : environ **1 kcal par kg et par km** (70 kg × 8 km ≈ 580 kcal).\n• 3 à 4 sorties par semaine, surtout en endurance (on tient plus longtemps)\n• Renforcement musculaire 2 fois par semaine\n• Alimentation : léger déficit (300-500 kcal/jour), protéines suffisantes, peu de produits ultra-transformés\n• Patience : 0,5 kg par semaine est un bon rythme\nAttention à la faim après la course : prévois une collation saine.`, sugg:["Une boucle de 5 km", "Courir à jeun ?"]},
    fasted:{t:`Courir **à jeun** le matin est possible pour une sortie **facile et courte** (30-45 min) si tu le supportes bien : bois un verre d'eau avant, garde une barre sur toi.\nÉvite-le pour le fractionné, les sorties longues et si tu es sujet aux hypoglycémies. Il n'est pas plus efficace pour maigrir sur la durée ; c'est surtout une question de confort.`},
    caffeine:{t:`La **caféine** améliore la performance (3 mg/kg, 45-60 min avant : environ 2 cafés pour 70 kg). Teste-la à l'entraînement, jamais pour la première fois un jour de course : elle peut accélérer le transit. Évite-la après 15-16 h si elle gêne ton sommeil.`},
    alcohol:{t:`L'**alcool** déshydrate, perturbe le sommeil et la récupération. Évite-le la veille d'une séance importante ou d'une course, et dans les heures qui suivent une compétition (le temps de bien te réhydrater). Un verre occasionnel n'empêche pas de progresser.`},
    shoes:{t:`**Choisir ses chaussures** :\n• Le **confort** prime : essaie en fin de journée, avec tes chaussettes de course, un pouce de marge devant les orteils\n• **Route** pour Traceo, crampons seulement pour le trail\n• Débutant : amorti confortable et drop 8-10 mm ; change de modèle progressivement\n• **Usure** : à remplacer tous les 600 à 900 km (amorti tassé, semelle lisse, nouvelles douleurs)\n• Les plaques carbone servent surtout en compétition\nUn magasin spécialisé peut analyser ta foulée.`},
    gear:{t:`L'essentiel : chaussures adaptées, tenue respirante (pas de coton), chaussettes techniques anti-ampoules, et pour les femmes une brassière de maintien.\nUtile : ceinture ou sac léger pour le téléphone, gilet réfléchissant et lampe frontale la nuit, casquette l'été, gants et bonnet l'hiver.\nUne montre GPS est un plus, pas une obligation : Traceo suit déjà ta course avec le téléphone.`},
    cadence:{t:`**Technique** : buste droit et légèrement penché vers l'avant, épaules relâchées, bras à 90° qui balancent d'avant en arrière, pied qui se pose sous le centre de gravité.\n**Cadence** : beaucoup de coureurs gagnent à raccourcir un peu la foulée (170-180 pas/min en moyenne). Augmente-la de 5 % au plus, progressivement : ça réduit les chocs.\nN'essaie pas de changer d'attaque de pied du jour au lendemain : ça se fait sur des mois.`},
    breathing:{t:`**Respiration** : respire par le nez et la bouche, profondément, avec le ventre. Un rythme 3 pas inspiration / 2 pas expiration aide au début.\nSi tu es essoufflé en footing, c'est que tu cours trop vite : ralentis jusqu'à pouvoir parler. Le souffle s'améliore en 3 à 6 semaines de régularité.\nAsthme : garde ton traitement sur toi et parles-en à ton médecin.`},
    stitch:{t:`**Point de côté** : ralentis ou marche, expire longuement en appuyant doucement sous les côtes, et penche-toi légèrement du côté opposé. Il passe en 1 à 3 minutes.\nPour l'éviter : pas de repas copieux dans les 2 h avant, bois par petites gorgées, échauffe-toi progressivement et renforce ta sangle abdominale.`},
    cramp:{t:`**Crampe** : arrête-toi, étire doucement le muscle (mollet : talon au sol, jambe tendue, pointe du pied tirée vers toi) et masse. Bois et prends un peu de sel si l'effort est long.\nPrévention : entraînement adapté à la distance (première cause : la fatigue musculaire), allure maîtrisée au départ, hydratation et sodium sur les efforts de plus de 1 h 30.`},
    redflag:{t:`⚠️ **Arrête-toi immédiatement.** Une douleur dans la poitrine, une oppression, des palpitations, un malaise, des vertiges ou une difficulté à respirer anormale pendant l'effort sont des signaux d'alerte.\nSi ça ne passe pas en quelques minutes ou si c'est intense : **appelle le 15 (SAMU) ou le 112.** Ne reprends pas la course avant d'avoir consulté un médecin.`},
    heat:{t:`**Par forte chaleur** :\n• Cours tôt le matin ou tard le soir, à l'ombre\n• Ralentis de 10 à 30 s/km et oublie le chrono\n• Bois avant, pendant (dès 30 min) et après, avec des électrolytes si ça dure\n• Casquette, tenue claire, crème solaire\n• Stop immédiat en cas de frissons, nausées, maux de tête ou confusion : signes de coup de chaleur`},
    cold:{t:`**Par temps froid** : système 3 couches (respirante, chaude, coupe-vent), bonnet, gants, et un tour de cou pour respirer un air moins froid. Échauffe-toi un peu plus longtemps. Attention au verglas : choisis des rues dégagées et ralentis. Tu dois avoir un peu froid au départ : tu te réchaufferas en 10 minutes.`},
    rain:{t:`**Sous la pluie** : coupe-vent léger, casquette pour la visière, chaussettes techniques, et un peu de crème anti-frottements. Évite les plaques d'égout, les feuilles mortes et les marquages au sol glissants. Par **orage**, ne cours pas en terrain découvert : reporte la sortie.`},
    night:{t:`**Courir la nuit ou seul(e) en sécurité** :\n• Gilet réfléchissant et lampe frontale : sois visible\n• Rues éclairées et fréquentées ; Traceo passe par les rues de ta ville\n• Un seul écouteur ou volume bas, pour entendre la circulation\n• Préviens un proche de ton parcours et de ton heure de retour\n• Garde ton téléphone sur toi et fais confiance à ton instinct : si un endroit ne te plaît pas, change de direction`},
    pollution:{t:`Lors d'un **pic de pollution**, réduis l'intensité, privilégie les parcs et les rues calmes, et cours tôt le matin. Évite les grands axes aux heures de pointe. En cas d'asthme ou d'allergie au pollen, garde ton traitement sur toi et consulte les indices de qualité de l'air.`},
    morning:{t:`Le **meilleur moment**, c'est celui que tu peux tenir chaque semaine. Le matin aide à la régularité ; l'après-midi et le début de soirée sont souvent plus favorables aux performances.\nAprès un repas : attends 2-3 h pour une séance intense, 1 h après une collation. Évite les séances très dures juste avant de dormir.`},
    treadmill:{t:`Sur **tapis** : mets 1 % de pente pour compenser l'absence de vent, bois davantage (pas de vent pour refroidir) et varie les séances pour éviter l'ennui (fractionné, côtes). C'est une bonne solution par mauvais temps, mais garde des sorties dehors pour le travail d'équilibre et le plaisir de découvrir de nouvelles rues.`},
    race:{t:`**Dernière semaine** : volume -40 à -60 %, garde 2-3 accélérations à allure course. Dors bien les 2 nuits d'avant (la dernière compte moins).\n**Veille** : retire ton dossard, prépare ta tenue (rien de neuf !), repas riche en glucides et léger en fibres.\n**Jour J** : petit-déjeuner testé à l'entraînement 3 h avant, arrivée 1 h avant, échauffement court, et départ **plus lent** que l'allure cible les 2 premiers km. Le stress est normal : il te donnera de l'énergie.`, sugg:["Que manger pendant la course ?", "Quelle allure tenir ?"]},
    fuel:{t:`**Pendant l'effort** :\n• Moins de 1 h : de l'eau suffit\n• 1 h à 2 h 30 : **30 à 60 g de glucides/heure** (1 gel ≈ 20-25 g), dès 40-45 min, avec de l'eau\n• Marathon et plus : 60 à 90 g/heure si ton intestin est entraîné\n**Recharge en glucides** (marathon) : 8-10 g de glucides par kg et par jour les 2 jours avant.\nTeste toujours gels et boissons à l'entraînement, jamais pour la première fois en course.`, sugg:["Combien boire pendant la course ?"]},
    after:{t:`**Après la course** : marche 5-10 min, bois, et mange dans l'heure (glucides + protéines). Douche, jambes surélevées, et une nuit complète.\nAprès un **semi**, compte 1 semaine de récupération ; après un **marathon**, 2 à 3 semaines : footings très faciles, pas d'intensité. La règle : un jour de récupération par kilomètre de course avant de refaire une séance dure.`},
    frequency:{t:`**Combien courir ?**\n• Débutant : 3 sorties/semaine, jamais 2 jours de suite\n• Intermédiaire : 3-4 sorties, 25-45 km/semaine\n• Confirmé (semi, marathon) : 4-6 sorties, 40-80 km et plus\nN'augmente pas ton volume de plus de **10 % par semaine**, et garde au moins 1 jour de repos complet. Courir tous les jours est possible avec de l'expérience, à condition que la plupart des sorties soient très faciles.`},
    motivation:{t:`Quelques astuces qui marchent :\n• Fixe-toi un **petit objectif** : 15 minutes seulement, souvent tu continueras\n• **Planifie** tes sorties dans ton agenda comme un rendez-vous\n• Varie les parcours : avec Traceo, chaque boucle passe par des rues inédites\n• Cours avec quelqu'un, ou inscris-toi à une course dans 2-3 mois\n• Note tes progrès et partage l'image de ta boucle\nEt rappelle-toi : le seul mauvais footing, c'est celui qu'on n'a pas fait.`, act:"gen3", actLabel:"Une boucle de 3 km maintenant"},
    women:{t:`**Cycle menstruel** : courir peut soulager les douleurs ; adapte l'intensité selon tes sensations, sans obligation. **Grossesse** : c'est souvent possible si tu courais déjà, avec l'accord de ton médecin ou de ta sage-femme, à intensité modérée. **Après l'accouchement** : rééducation du périnée d'abord, reprise progressive validée par un professionnel. **Fer** : les coureuses ont plus souvent des carences ; un bilan sanguin peut être utile en cas de fatigue.`},
    age:{t:`On peut courir à **tout âge**. Après 40-50 ans : échauffement plus long, renforcement musculaire 2 fois/semaine, plus de récupération entre les séances dures, et un bilan médical (test d'effort) avant de commencer ou de reprendre l'intensité. Chez les **jeunes**, privilégie le jeu, la variété et les distances courtes.`},
    music:{t:`Le bouton **Musique** de Traceo ouvre Apple Music, Deezer, YouTube Music ou tes podcasts. Lance ta playlist avant de partir : elle continue pendant la course, et le guidage vocal de Traceo passe par-dessus. Garde un volume qui te permet d'entendre la circulation.`},
    install:{t:`Pas besoin de store :\n• **iPhone** : ouvre Traceo dans **Safari**, touche **Partager** puis **« Sur l'écran d'accueil »**\n• **Android** : dans **Chrome**, menu ⋮ puis **« Installer l'application »**\nTraceo s'ouvre alors en plein écran, comme une vraie app.`, act:"install", actLabel:"Installer Traceo"},
    position:{t:`Touche **« Me localiser »** et accepte la demande de ton téléphone : ta boucle part de là où tu es.\nSi tu as refusé : sur iPhone, Réglages > Safari > Position > Autoriser ; sur Android, cadenas à côté de l'adresse > Autorisations > Position.\nTu peux aussi **choisir une ville**, taper une adresse en haut, ou faire un **appui long sur la carte** pour un départ précis.`, act:"loc", actLabel:"Me localiser"},
    export:{t:`• **Strava** : après ta course, touche « Envoyer sur Strava » dans le bilan. Le fichier GPX de ta course se télécharge, puis importe-le sur strava.com/upload.\n• **Garmin** : sous la boucle, « Garmin » télécharge le parcours. Importe-le dans Garmin Connect > Parcours, puis envoie-le sur ta montre.\n• **Autres montres** (Coros, Suunto, Polar…) : le bouton **GPX** fonctionne partout.`},
    voice:{t:`Le **guidage vocal** annonce la rue où tu es, chaque virage (à 200 m puis au moment de tourner) et chaque kilomètre avec ton allure. Coupe ou remets la voix avec l'icône haut-parleur pendant la course, ou dans Profil > Guidage vocal. Sur iPhone, vérifie que le mode silencieux est désactivé.`, act:"me", actLabel:"Réglages"},
    map:{t:`• **Carte jour / nuit** : bouton soleil/lune sur la carte. Le mode jour, très contrasté, est idéal en plein soleil.\n• **Noms des rues** : toujours affichés au-dessus de ta boucle ; zoome pour les voir plus grands.\n• **Hors connexion** : le calcul de la boucle demande Internet ; pendant la course, le GPS suffit.`},
    history:{t:`Toutes tes boucles sont dans l'onglet **Boucles** : touche-en une pour la revoir, la recourir ou l'exporter. L'étoile la met en **favori**. Traceo garde aussi en mémoire les rues déjà proposées, pour t'emmener ailleurs la prochaine fois.`, act:"mine", actLabel:"Mes boucles"},
    share:{t:`Sous ta boucle ou dans le bilan de course, touche **Image** : Traceo crée une image 1080 × 1350 de ta boucle en néon sur la carte de ta ville, avec distance, temps et calories. Idéale pour une story Instagram.`},
    data:{t:`Traceo fonctionne **sans compte** : tes boucles, réglages et conversations restent **sur ton téléphone**. Ta position sert uniquement à tracer et guider ta boucle. Pour tout effacer : **Profil > Effacer mes données**. Le détail est dans la page Informations légales.`, act:"legal", actLabel:"Informations légales"},
    bug:{t:`Désolé pour ce souci ! Essaie dans l'ordre :\n1. Recharge la page ou rouvre l'app\n2. Vérifie ta connexion et l'autorisation de position\n3. Profil > **Vérifier que tout fonctionne** (diagnostic en 10 secondes)\nSi ça persiste, écris à pierre.rnrd04@gmail.com avec une capture d'écran.`, act:"me", actLabel:"Lancer le diagnostic"},
    app:{t:`**Traceo** dessine une boucle de course neuve à chaque sortie, dans les vraies rues autour de toi :\n1. Localise-toi ou choisis une ville\n2. Choisis une distance (2 à 42 km) ou une durée\n3. « Générer ma boucle », puis laisse-toi guider à la voix, rue par rue\nEt moi, je peux calculer tes allures, prédire tes chronos, te faire un plan d'entraînement ou répondre à tes questions running.`, sugg:["Fais-moi une boucle de 5 km", "Prédis mes chronos", "Un plan 10 km"]},
    thanks:{t:`Avec plaisir ! Bonne course 🏃 N'hésite pas si tu as d'autres questions.`},
    hello:{t:`Salut ! Je suis le coach Traceo. Je peux te tracer une boucle, calculer une allure, prédire tes chronos, te faire un plan d'entraînement ou répondre à tes questions sur la course, la nutrition et les blessures.`, sugg:["Fais-moi une boucle de 5 km", "Allure pour un semi en 1h50", "Je débute, par où commencer ?"]},
    who:{t:`Je suis le **coach Traceo**, l'assistant de l'app. Je connais la course à pied, l'entraînement, la nutrition du coureur et toutes les fonctions de Traceo, et je fais les calculs (allures, chronos, VMA, zones cardiaques), avec des connaissances intégrées à l'app. Je ne remplace pas un médecin ni un entraîneur qui te suit en personne.`}
  };
  // Blessures : réponse ciblée selon la zone
  const INJ = [
    [/genou|rotule|essuie glace|tfl|bandelette/, `**Genou** : à l'extérieur, souvent le syndrome de l'essuie-glace (bandelette ilio-tibiale) ; devant, autour de la rotule, le syndrome fémoro-patellaire. Réduis le volume et le dénivelé, évite les descentes, renforce hanches et fessiers (pont, abductions), et vérifie l'usure de tes chaussures.`],
    [/periostite|tibia/, `**Périostite (tibia)** : douleur le long du tibia, typique d'une augmentation trop rapide du volume ou de chaussures usées. Repos relatif (vélo, natation), glace 15 min, puis reprise très progressive sur terrain souple. Si la douleur est localisée en un point précis et vive, consulte : il peut s'agir d'une fracture de fatigue.`],
    [/achille|tendon/, `**Tendon d'Achille** : raideur le matin, douleur au-dessus du talon. Diminue l'intensité et le dénivelé, évite les chaussures à drop très bas, et fais des exercices excentriques (descente lente sur une marche, 3 × 15, 2 fois/jour). Ne cours pas à travers une douleur qui s'aggrave.`],
    [/fasciite|voute|plantaire|talon/, `**Fasciite plantaire** : douleur sous le talon aux premiers pas du matin. Fais rouler une balle ou une bouteille congelée sous le pied, étire mollets et voûte, vérifie tes chaussures, réduis le volume. Un podologue peut aider si ça dure.`],
    [/cheville|entorse/, `**Cheville / entorse** : repos, glace, compression, jambe surélevée les 48 premières heures. Consulte si tu ne peux pas poser le pied ou si l'œdème est important. Rééducation de l'équilibre (tenir sur un pied) avant de reprendre progressivement.`],
    [/ampoule/, `**Ampoules** : ne perce que si elle gêne, avec une aiguille désinfectée, et laisse la peau. Protège-la avec un pansement double peau. Prévention : chaussettes techniques sans coutures, chaussures à ta taille, crème anti-frottements.`],
    [/mollet|ischio|cuisse|contracture|elongation|dechirure/, `**Douleur musculaire** : une gêne diffuse qui disparaît en s'échauffant est souvent une courbature ou une contracture. Une douleur vive et soudaine en pleine course (« coup de poignard ») peut être une déchirure : arrête-toi, glace et compression, et consulte.`],
    [/hanche|dos|lombaire/, `**Hanche / dos** : souvent liés à un manque de gainage ou à une foulée trop longue. Renforce la sangle abdominale et les fessiers, réduis l'allure et la longueur de foulée. Une douleur qui irradie dans la jambe ou s'accompagne de fourmillements demande un avis médical.`]
  ];
  R.injury = (t) => {
    const hit = INJ.find(([re]) => re.test(t));
    return {t:`${hit ? hit[1] + "\n" : ""}**Règles générales** : une douleur qui modifie ta foulée, qui augmente pendant la course ou qui dure plus de 3-4 jours → arrête et consulte un médecin du sport ou un kiné. Reprends ensuite progressivement, sans douleur.\nJe ne remplace pas un avis médical.`, sugg:["Exercices de renforcement", "Quand reprendre après une blessure ?"]};
  };
  R.premium = (t, e, c) => ({t:c.beta ? `Tout est **gratuit** pendant la bêta, jusqu'au **10 octobre à 15 h**. Ensuite, **Traceo Premium** coûte **${c.price}** pour 31 jours, payés par PayPal (compte PayPal ou carte bancaire), **sans renouvellement automatique**.` : `**Traceo Premium** : **${c.price}** pour 31 jours, payés par PayPal (compte PayPal ou carte bancaire). **Pas de renouvellement automatique** : tu reprends quand tu veux, et les jours restants s'ajoutent.${c.premium ? "\nTon Premium est actif." : ""}\nL'accès étant immédiat, il n'y a pas de droit de rétractation (détails dans les conditions de vente).`, act:"premium", actLabel:c.premium ? "Mon Premium" : "Passer à Premium"});

  /* ---------- Fil de la conversation ---------- */
  function followUp(t, e, mem){
    // « et pour un semi ? », « et en 1h40 ? », « et sur marathon ? »
    if(!/^(et|pour|sur|en|avec)\b/.test(t.trim()) || t.length > 60 || !mem.last) return null;
    return mem.last;
  }

  function answer(raw, c, mem = {}){
    const t = " " + plain(raw).replace(/\s+/g, " ").trim() + " ";
    const e = extract(t);
    let ranked = score(t), top = ranked[0] ? ranked[0][0] : null;
    // priorité aux signaux d'alerte
    if(ranked.some(([n]) => n === "redflag")) top = "redflag";
    // calculs : une performance passée (« j'ai fait », « mon record ») → prédiction
    else if(e.dist && e.time && /j'ai fait|j ai fait|mon record|mon temps|j'ai couru|j ai couru|je fais|je cours .* en|record perso|rp\b/.test(t)) top = "predict";
    else if(e.vma && !["hr", "plan"].includes(top)) top = "vma";
    else if((e.age || e.hr) && /zone|fc|cardi|pouls|frequence|bpm/.test(t)) top = "hr";
    else if(e.dist && e.time && !["plan", "loop", "predict"].includes(top)) top = "pacecalc";
    else if((e.pace || e.speed) && !top) top = e.speed ? "speed" : "pacecalc";
    // demandes de boucle explicites
    if(/(boucle|parcours|circuit|itineraire)/.test(t) && !/(ancienne|historique|mes boucles|precedente|favori)/.test(t) && (e.dist || e.time || /fais|genere|trace|propose|veux|cree|donne/.test(t))) top = "loop";
    if(!top && (e.time || e.dist) && /(courir|cours |sortie|footing|run|jogging|aller courir)/.test(t)) top = "loop";
    // « ma voix / ma position ne marche pas » : le sujet précis passe avant le dépannage général
    if(top === "bug" && ranked[1] && ["position", "voice", "map", "export", "install", "premium", "music", "share", "history"].includes(ranked[1][0])) top = ranked[1][0];
    // suite de la conversation
    const fu = followUp(t, e, mem);
    if(fu && !top) top = fu;
    let out;
    if(top && R[top]) out = R[top](t, e, c, mem);
    else if(top && TXT[top]) out = {...TXT[top]};
    if(!out){
      // pas compris : on propose les sujets les plus proches
      const near = ranked.slice(0, 2).map(([n]) => n);
      out = {t:`Je suis spécialisé dans la course à pied et l'app Traceo, et je n'ai pas compris ta question. Je peux t'aider sur :\n• **une boucle** (« boucle de 8 km », « 45 minutes »)\n• **allures et chronos** (« semi en 1h45 », « j'ai fait 10 km en 50 min »)\n• **VMA, zones cardiaques, plans d'entraînement**\n• **nutrition, hydratation, blessures, récupération, matériel**\n• **l'app** : Premium, installation, Strava, Garmin, carte`, sugg:near.length ? [] : ["Je débute, par où commencer ?", "Prédis mes chronos", "Un plan semi-marathon"]};
    }
    out.topic = top;
    out.mem = Object.assign({}, out.mem || {}, top ? {last:top} : {}, e.dist && !out.mem?.dist ? {dist:e.dist} : {}, e.age ? {age:e.age} : {});
    return out;
  }
  window.TraceoBrain = {answer, extract};
})();
