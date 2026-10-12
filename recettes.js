/* Traceo — bibliothèque de recettes pour les menus du jour (plus de 400 idées).
   Chaque recette : [id, nom, type, objectifs, minutes, ingrédients {clé: g}, étapes, conseil, ustensiles].
   Les calories, protéines, glucides, lipides et le prix sont calculés depuis FOOD et PRICE (app.js),
   puis les quantités s'adaptent aux besoins de chacun (scaleRecipe). */
(function(){
  if(typeof FOOD === "undefined" || typeof RECIPES === "undefined" || typeof PRICE === "undefined") return;

  // ---------- Aliments ajoutés : [nom, [kcal, protéines, glucides, lipides] pour 100 g, poids d'une unité, unité] ----------
  Object.assign(FOOD, {
    poire:["Poire",[57,0.4,13,0.1],170,"poire"], kiwi:["Kiwi",[61,1.1,12,0.5],75,"kiwi"], orange:["Orange",[47,0.9,10,0.1],150,"orange"],
    mangue:["Mangue (surgelée en dés)",[65,0.8,15,0.3]], abricots:["Abricots secs",[250,3,58,0.5]], raisins:["Raisins secs",[300,3,70,0.5]],
    chia:["Graines de chia",[490,17,8,31]], courge:["Graines de courge",[560,30,10,46]], noisettes:["Noisettes",[650,15,7,61]], cajou:["Noix de cajou",[580,18,30,44]],
    granola:["Granola",[450,9,62,17]], muesli:["Muesli sans sucre ajouté",[360,10,60,7]], pseigle:["Pain de seigle",[230,7,44,1.5]], farine:["Farine",[350,10,72,1.5]],
    ffrais:["Fromage frais à tartiner",[230,6,3,22]], ricotta:["Ricotta",[140,8,3,10]], cottage:["Cottage cheese",[100,11,3.5,4.5]], saumonf:["Saumon fumé",[180,22,0,10]],
    beurre:["Beurre",[740,0.7,0.6,82]], emmental:["Emmental râpé",[380,28,0,29]], comte:["Comté",[410,27,0,34]], chevre:["Chèvre frais",[200,13,2,16]], parmesan:["Parmesan",[400,33,0,29]],
    porc:["Filet mignon de porc",[140,22,0,5]], crevettes:["Crevettes décortiquées",[80,18,0,1]], sardines:["Sardines à l'huile égouttées",[200,24,0,11]], maquereau:["Maquereau au naturel",[220,19,0,16]],
    hrouges:["Haricots rouges cuits",[110,8,15,0.5]], haricotsv:["Haricots verts",[30,1.8,4,0.2]], carotte:["Carottes",[36,0.8,7,0.2]], champignons:["Champignons",[22,3,1,0.3]],
    aubergine:["Aubergine",[25,1,4,0.2]], choufleur:["Chou-fleur",[25,2,3,0.3]], petitspois:["Petits pois",[80,5,10,0.4]], mais:["Maïs doux",[90,3,16,1.5]], concombre:["Concombre",[12,0.7,2,0.1]],
    butternut:["Courge butternut",[40,1,8,0.1]], poireau:["Poireau",[30,1.5,5,0.3]], chou:["Chou",[28,1.5,5,0.1]], betterave:["Betterave cuite",[45,1.6,9,0.1]],
    semoule:["Semoule cuite",[112,3.8,23,0.2]], boulgour:["Boulgour cuit",[100,3.5,19,0.5]], gnocchis:["Gnocchis",[150,4,32,0.5]], nouilles:["Nouilles de riz cuites",[110,1.8,25,0.2]],
    pita:["Pain pita",[270,9,55,1.2],65,"pita"], arborio:["Riz rond (risotto) cuit",[130,2.5,28,0.3]], pesto:["Pesto",[450,5,6,45]], houmous:["Houmous",[300,8,14,24]],
    laitchoc:["Lait chocolaté",[70,3.5,10,1.5]], galriz:["Galettes de riz",[380,8,80,3],10,"galette"], paindepices:["Pain d'épices",[330,3,75,1]]
  });
  Object.assign(PRICE, {poire:2.8, kiwi:4, orange:2.5, mangue:6, abricots:12, raisins:7, chia:12, courge:15, noisettes:16, cajou:18, granola:7, muesli:4, pseigle:5, farine:1.2,
    ffrais:8, ricotta:9, cottage:7, saumonf:30, beurre:10, emmental:10, comte:18, chevre:14, parmesan:22, porc:13, crevettes:18, sardines:10, maquereau:10,
    hrouges:2.8, haricotsv:3.5, carotte:1.5, champignons:5, aubergine:3.5, choufleur:3, petitspois:3.5, mais:4, concombre:2.5, butternut:2.5, poireau:3, chou:2, betterave:3,
    semoule:1.8, boulgour:2.5, gnocchis:4, nouilles:3, pita:5, arborio:3.5, pesto:14, houmous:9, laitchoc:1.6, galriz:8, paindepices:7});

  const out = [], seen = new Set(RECIPES.map(r => r[0]));
  const kc = ing => { const t = [0, 0, 0, 0]; for(const [k, g] of Object.entries(ing)){ const f = FOOD[k]; if(f) f[1].forEach((v, i) => t[i] += v*g/100); } return t; };
  // Objectifs calculés sur la portion de base (les quantités s'adaptent ensuite aux besoins)
  function goals(type, ing){
    const [k, p, g, l] = kc(ing), G = ["forme"];
    const T = {pdj:[16, 38, 17, 540], snack:[6, 20, 12, 320], plat:[26, 45, 22, 760]}[type];
    if(p >= T[0]) G.push("muscle");
    if(g >= T[1]) G.push("perf");
    if(l <= T[2] && k <= T[3]) G.push("perte");
    if(G.length === 1) G.push("perf");
    return G.join(" ");
  }
  const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  function add(type, name, short, min, ing, steps, tip, tools){
    const id = "g-" + slug(name).slice(0, 60);
    if(seen.has(id)) return; seen.add(id);
    out.push([id, name, type, goals(type, ing), min, ing, steps.filter(Boolean), tip, tools]);
    SHORT[id] = short;
  }
  const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ================= PETITS-DÉJEUNERS ================= */
  const FR = {
    banane:{s:"banane", g:120, prep:"Épluche la banane et coupe-la en rondelles."},
    pomme:{s:"pomme", g:150, prep:"Lave la pomme, retire le cœur et coupe-la en petits dés (ou râpe-la).", cuit:"Ajoute la pomme en dés et une pincée de cannelle la dernière minute de cuisson : elle fond légèrement."},
    poire:{s:"poire", g:150, prep:"Lave la poire, retire le cœur et coupe-la en dés.", cuit:"Ajoute la poire en dés et une pincée de cannelle la dernière minute de cuisson."},
    rouges:{s:"fruits rouges", g:120, prep:"Si les fruits rouges sont surgelés, sors-les la veille au frigo, ou passe-les 1 min au micro-ondes."},
    mangue:{s:"mangue", g:120, prep:"Prends la mangue en dés (surgelée, elle décongèle en 10 min à température ambiante)."},
    kiwi:{s:"kiwi", g:150, prep:"Épluche les kiwis au couteau et coupe-les en rondelles."},
    orange:{s:"orange", g:150, prep:"Pèle l'orange et sépare les quartiers."}
  };
  const TOP = {
    cacahuete:{s:"beurre de cacahuète", g:15, act:"Ajoute une cuillère de beurre de cacahuète au centre."},
    amandes:{s:"amandes", g:15, act:"Concasse les amandes avec le fond d'un verre et parsème-les."},
    noisettes:{s:"noisettes", g:15, act:"Concasse grossièrement les noisettes et parsème-les."},
    noix:{s:"noix", g:15, act:"Casse les noix avec les doigts et parsème-les."},
    chia:{s:"graines de chia", g:10, act:"Saupoudre les graines de chia : elles apportent fibres et oméga-3."},
    courge:{s:"graines de courge", g:12, act:"Parsème les graines de courge (tu peux les griller 2 min à la poêle sèche)."}
  };
  const TIPS_PDJ = ["Version express : 2 min au micro-ondes dans un grand bol, en remuant à mi-cuisson.", "Les flocons d'avoine libèrent leur énergie lentement : parfait 2 h avant une sortie.", "Prépare le mélange flocons + lait la veille : il cuit deux fois plus vite le matin.", "Ajoute une pincée de sel : le goût sucré des fruits ressort davantage."];
  // 1. Porridges
  Object.entries(FR).filter(([k]) => k !== "orange" && k !== "kiwi").forEach(([fk, f], fi) => Object.entries(TOP).forEach(([tk, t], ti) => {
    add("pdj", `Porridge ${f.s} et ${t.s}`, `Porridge ${f.s}`, 8, {avoine:60, lait:200, [fk]:f.g, [tk]:t.g, miel:8},
      ["Pèse 60 g de flocons d'avoine et mesure 20 cl de lait.", "Verse-les dans une petite casserole sur feu moyen et remue sans t'arrêter 3 à 4 min, jusqu'à ce que le mélange épaississe.", f.cuit || f.prep, "Verse dans un bol" + (f.cuit ? "." : ` et dépose la ${f.s} par-dessus.`).replace("la fruits rouges", "les fruits rouges"), t.act, "Termine par un petit filet de miel si tu aimes plus sucré."],
      pick(TIPS_PDJ, fi + ti), "Petite casserole, cuillère en bois, bol");
  }));
  // 2. Overnight oats (sans cuisson)
  [["skyr", "skyr", 150], ["yaourt", "yaourt", 150]].forEach(([bk, bs, bg], bi) => ["rouges", "mangue", "pomme", "banane", "kiwi", "poire"].forEach((fk, fi) => ["chia", "amandes", "noisettes"].forEach((tk, ti) => {
    if((bi + fi + ti) % 2) return;
    const f = FR[fk], t = TOP[tk];
    add("pdj", `Overnight oats au ${bs}, ${f.s} et ${t.s}`, `Overnight oats ${f.s}`, 5, {avoine:50, lait:100, [bk]:bg, [fk]:f.g, [tk]:t.g, miel:8},
      [`La veille au soir, mélange dans un bocal 50 g de flocons d'avoine, 10 cl de lait et ${bk === "skyr" ? "le skyr" : "le yaourt"}.`, t.act.replace("parsème-les", "ajoute-les"), "Ferme et mets au frigo toute la nuit : les flocons gonflent et deviennent crémeux.", "Le matin : " + f.prep.charAt(0).toLowerCase() + f.prep.slice(1), "Ajoute les fruits sur le dessus avec un filet de miel. Se mange froid, directement dans le bocal."],
      "Zéro cuisson le matin : prépare 3 bocaux d'un coup le dimanche, ils se gardent 3 jours au frigo.", "Bocal ou boîte avec couvercle, cuillère");
  })));
  // 3. Bowls laitiers
  const CRUNCH = {granola:{s:"granola", g:30}, muesli:{s:"muesli", g:30}, noix:{s:"noix", g:15}, amandes:{s:"amandes", g:15}};
  [["skyr", "skyr", 200], ["fblanc", "fromage blanc", 200], ["cottage", "cottage cheese", 200]].forEach(([bk, bs, bg], bi) => ["rouges", "banane", "kiwi", "poire", "mangue", "orange"].forEach((fk, fi) => {
    const cks = bk === "skyr" ? [pick(Object.keys(CRUNCH), bi + fi), pick(Object.keys(CRUNCH), bi + fi + 2)] : [pick(Object.keys(CRUNCH), bi + fi)];
    cks.forEach(ck => { const f = FR[fk], c = CRUNCH[ck];
      add("pdj", `Bowl ${bs}, ${f.s} et ${c.s}`, `Bowl ${f.s}`, 4, {[bk]:bg, [fk]:f.g + 10, [ck]:c.g, miel:8},
        [f.prep, `Verse le ${bs} dans un bol et lisse-le avec le dos d'une cuillère.`, `Dépose les fruits d'un côté et le ${c.s} de l'autre${ck === "noix" || ck === "amandes" ? " (concassés grossièrement)" : ""}.`, "Ajoute un filet de miel juste avant de manger pour que ça reste croquant."],
        bk === "fblanc" ? "Le fromage blanc 0 % apporte autant de protéines que la viande pour très peu de calories." : bk === "cottage" ? "Le cottage cheese est très riche en protéines : il cale jusqu'au déjeuner." : "Très riche en protéines pour peu de calories : idéal pour éviter les fringales.", "Bol, cuillère, couteau");
    });
  }));
  // 4. Tartines salées
  const SAL = [
    ["œufs brouillés et tomates", {oeuf:110, tomate:100, huile:5}, ["Casse les œufs dans un bol, ajoute une pincée de sel et bats-les 30 secondes à la fourchette.", "Fais-les cuire à feu doux dans la poêle huilée en remuant sans cesse : arrête quand ils sont encore légèrement crémeux.", "Coupe les tomates en rondelles et dispose-les sur les tartines, puis les œufs."]],
    ["œuf au plat et avocat", {oeuf:55, avocat:60}, ["Fais cuire l'œuf au plat 3 min à feu moyen dans une poêle antiadhésive, couvercle posé pour que le blanc prenne.", "Écrase l'avocat à la fourchette avec une pincée de sel et un trait de citron, étale-le sur le pain.", "Dépose l'œuf sur la tartine et poivre."]],
    ["avocat écrasé et graines de courge", {avocat:80, courge:10, citron:10}, ["Coupe l'avocat en deux, retire le noyau et récupère la chair avec une cuillère.", "Écrase-la à la fourchette avec le jus de citron, sel et poivre.", "Étale sur le pain grillé et parsème de graines de courge."]],
    ["fromage frais et saumon fumé", {ffrais:30, saumonf:50}, ["Étale le fromage frais sur le pain grillé.", "Dépose les tranches de saumon fumé et poivre (inutile de saler, le saumon l'est déjà).", "Un trait de citron et quelques brins d'aneth si tu en as."]],
    ["ricotta, tomates et basilic", {ricotta:60, tomate:100, huile:5}, ["Étale la ricotta sur le pain grillé.", "Coupe les tomates en fines rondelles et dispose-les dessus.", "Sale, poivre, ajoute un filet d'huile d'olive et quelques feuilles de basilic."]],
    ["jambon et fromage frais", {jambon:50, ffrais:25}, ["Étale le fromage frais sur le pain.", "Dépose le jambon plié en deux.", "Poivre et ajoute quelques rondelles de cornichon si tu aimes."]],
    ["cottage cheese et concombre", {cottage:100, concombre:80}, ["Coupe le concombre en fines rondelles.", "Étale généreusement le cottage cheese sur le pain grillé.", "Dépose le concombre, sale, poivre et ajoute un peu de ciboulette."]]
  ];
  [["painc", "pain complet"], ["pseigle", "pain de seigle"]].forEach(([pk, ps], pi) => SAL.forEach(([gs, ing, st], gi) => {
    const fk = pick(["orange", "kiwi", "pomme"], pi + gi), f = FR[fk] || {s:"pomme", g:150};
    add("pdj", `Tartines de ${ps}, ${gs}`, `Tartines ${gs.split(" ")[0]}`, gi === 0 ? 10 : 6, Object.assign({[pk]:70, [fk]:f.g}, ing),
      [`Coupe 2 tranches de ${ps} et fais-les griller 2 à 3 min.`, ...st, `Termine avec ${fk === "orange" ? "une orange" : fk === "kiwi" ? "deux kiwis" : "une pomme"} pour la vitamine C.`],
      gi === 0 ? "Ne cuis jamais les œufs brouillés à feu vif : ils deviennent secs." : "Un petit-déjeuner salé et protéiné limite le coup de barre de 11 h.", "Grille-pain ou poêle, couteau, assiette");
  }));
  // 5. Tartines sucrées
  const SUC = [
    ["beurre et confiture", {beurre:10, confiture:20, yaourt:125}, ["Étale une fine couche de beurre puis la confiture.", "Accompagne d'un yaourt nature."], "Le petit-déjeuner le moins cher : parfait les matins pressés."],
    ["beurre de cacahuète et banane", {cacahuete:15, banane:60, lait:200}, ["Étale le beurre de cacahuète.", "Ajoute la demi-banane en rondelles.", "Accompagne d'un verre de lait."], "Glucides et bonnes graisses : l'énergie tient toute la matinée."],
    ["ricotta, poire et miel", {ricotta:50, poire:100, miel:10}, ["Étale la ricotta.", "Dépose la poire en fines lamelles.", "Arrose d'un filet de miel."], "Doux et léger : la ricotta est moins grasse que le fromage frais."],
    ["chocolat noir et banane", {choco:15, banane:60, yaourt:125}, ["Râpe ou concasse le chocolat noir sur le pain chaud : il fond légèrement.", "Ajoute la demi-banane en rondelles.", "Accompagne d'un yaourt nature."], "Le chocolat noir 70 % apporte du magnésium, utile pour la récupération."]
  ];
  [["painb", "baguette"], ["painc", "pain complet"], ["pseigle", "pain de seigle"]].forEach(([pk, ps]) => SUC.forEach(([gs, ing, st, tip]) => {
    add("pdj", `Tartines de ${ps}, ${gs}`, `Tartines ${gs.split(" ")[0] === "beurre" && gs.includes("confiture") ? "confiture" : gs.split(",")[0].split(" et ")[0]}`, 4, Object.assign({[pk]:70}, ing),
      [`Coupe 2 tranches de ${ps} et fais-les griller si tu aimes croustillant.`, ...st], tip, "Couteau, assiette");
  }));
  // 6. Pancakes
  const PAN = [
    ["avoine-pomme à la cannelle", {avoine:60, oeuf:110, pomme:150}, "Mixe les flocons, les œufs et la pomme râpée avec une pincée de cannelle."],
    ["à la ricotta et au citron", {farine:50, ricotta:80, oeuf:55, lait:50, citron:10}, "Mélange la farine, la ricotta, l'œuf, le lait et le zeste du citron jusqu'à obtenir une pâte épaisse."],
    ["chocolat-banane", {avoine:60, oeuf:110, banane:120, choco:10}, "Mixe les flocons, les œufs et la banane, puis ajoute le chocolat haché."],
    ["protéinés au skyr", {avoine:60, skyr:100, oeuf:55}, "Mixe les flocons en farine, puis mélange avec le skyr et l'œuf."]
  ];
  const PTOP = [["miel", {miel:10}, "un filet de miel"], ["fruits rouges", {rouges:100}, "les fruits rouges"], ["beurre de cacahuète", {cacahuete:15}, "le beurre de cacahuète tiédi 10 s au micro-ondes"]];
  PAN.forEach(([ps, ing, mix]) => PTOP.forEach(([ts, ting, tact]) => {
    add("pdj", `Pancakes ${ps} et ${ts}`, `Pancakes ${ps.split(" ")[0].replace("à", "ricotta").replace("protéinés", "skyr")}`, 15, Object.assign({}, ing, ting),
      [mix, "Laisse reposer la pâte 5 min : les pancakes se tiendront mieux.", "Chauffe une poêle antiadhésive à feu moyen avec une goutte d'huile essuyée au papier.", "Verse une petite louche de pâte. Retourne quand des bulles apparaissent à la surface (environ 2 min), puis 1 min de l'autre côté.", `Empile les pancakes et ajoute ${tact}.`],
      "Le premier pancake est souvent raté : c'est normal, la poêle n'est pas encore à la bonne température.", "Saladier ou blender, poêle, spatule, louche");
  }));
  // 7. Œufs
  [["nature aux fines herbes", {}, "Ajoute une poignée de fines herbes ciselées (persil, ciboulette)."], ["aux champignons", {champignons:100}, "Fais d'abord revenir les champignons émincés 4 min dans la poêle."], ["au jambon", {jambon:40}, "Ajoute le jambon coupé en lanières dans les œufs battus."], ["à l'emmental", {emmental:20}, "Parsème l'emmental sur l'omelette juste avant de la plier."], ["aux épinards", {epinards:80}, "Fais tomber les épinards 1 min dans la poêle avant d'ajouter les œufs."], ["à la tomate", {tomate:100}, "Fais revenir les tomates en dés 2 min avant d'ajouter les œufs."]].forEach(([os, ing, extra], i) => {
    const fk = pick(["kiwi", "orange", "pomme"], i);
    add("pdj", `Omelette ${os}, pain complet et ${FR[fk].s}`, "Omelette", 10, Object.assign({oeuf:110, huile:5, painc:60, [fk]:FR[fk].g}, ing),
      ["Casse les œufs dans un bol, sale, poivre et bats-les à la fourchette.", extra, "Verse les œufs dans la poêle huilée chaude à feu moyen. Ramène les bords vers le centre avec une spatule pendant 2 min.", "Quand le dessus est encore un peu baveux, plie l'omelette en deux et fais-la glisser dans l'assiette.", `Sers avec le pain complet et ${fk === "kiwi" ? "deux kiwis" : "le fruit"}.`],
      "Les œufs apportent des protéines complètes à petit prix : environ 30 centimes pièce.", "Poêle antiadhésive, spatule, bol, fourchette");
  });
  add("pdj", "Œufs à la coque et mouillettes", "Œufs coque", 8, {oeuf:110, painb:60, beurre:5, orange:150},
    ["Fais bouillir une petite casserole d'eau.", "Dépose délicatement les œufs avec une cuillère et compte exactement 3 min.", "Pendant ce temps, coupe le pain en bâtonnets et beurre-les légèrement.", "Mets les œufs dans des coquetiers, décalotte le haut avec un couteau et trempe les mouillettes.", "Termine par l'orange en quartiers."], "Œufs sortis du frigo : ajoute 30 secondes de cuisson.", "Petite casserole, coquetiers, couteau");
  add("pdj", "Œufs cocotte aux épinards et pain complet", "Œufs cocotte", 15, {oeuf:110, epinards:80, creme:20, painc:60},
    ["Préchauffe le four à 180 °C.", "Fais tomber les épinards 1 min à la poêle et répartis-les dans 2 ramequins.", "Casse un œuf dans chaque ramequin, ajoute une cuillère de crème, sel et poivre.", "Enfourne 10 à 12 min : le blanc doit être pris et le jaune encore coulant.", "Sers avec le pain grillé."], "Le jaune coulant se trempe dans le pain : un vrai petit-déjeuner du dimanche.", "Four, 2 ramequins, poêle");
  // 8. Smoothies
  [["banane et fruits rouges", {lait:250, banane:120, rouges:100, avoine:30}], ["mangue et banane", {yaourt:150, lait:100, mangue:120, banane:60}], ["vert pomme, épinards et kiwi", {skyr:150, lait:100, pomme:150, epinards:40, kiwi:75}], ["cacao, banane et cacahuète", {lait:250, banane:120, cacahuete:15, choco:10}], ["poire, avoine et cannelle", {lait:200, poire:150, avoine:40, skyr:100}]].forEach(([ss, ing], i) => {
    add("pdj", `Smoothie ${ss}`, `Smoothie ${ss.split(" ")[0]}`, 5, ing, ["Épluche et coupe les fruits en morceaux.", "Mets dans le blender les liquides en premier, puis les fruits et le reste.", "Mixe 45 secondes jusqu'à ce que ce soit bien lisse.", "Bois-le aussitôt (il s'oxyde vite)."], "Des fruits congelés rendent le smoothie frais et épais, sans glaçons.", "Blender, verre");
    add("pdj", `Smoothie bowl ${ss} et granola`, "Smoothie bowl", 7, Object.assign({}, ing, {lait:Math.max(0, (ing.lait || 0) - 100), granola:30}), ["Mixe tous les ingrédients avec moins de liquide que pour un smoothie : la texture doit être épaisse.", "Verse dans un bol.", "Parsème de granola et de quelques tranches de fruit."], "Utilise des fruits surgelés pour une texture de glace.", "Blender, bol");
  });
  // 9. Muesli / granola
  ["muesli", "granola"].forEach(ck => [["lait", 200], ["yaourt", 150]].forEach(([lk, lg]) => ["banane", "pomme", "rouges", "poire", "kiwi", "mangue"].forEach((fk, fi) => {
    if((fi + (lk === "lait" ? 0 : 1) + (ck === "granola" ? 1 : 0)) % 2) return;
    const f = FR[fk];
    add("pdj", `${cap(ck)}, ${lk === "lait" ? "lait" : "yaourt"} et ${f.s}`, `${cap(ck)} ${f.s}`, 3, {[ck]:50, [lk]:lg, [fk]:f.g},
      [`Verse le ${ck} dans un bol.`, f.prep, lk === "lait" ? "Ajoute le lait froid juste avant de manger." : "Ajoute le yaourt et mélange légèrement."], ck === "muesli" ? "Choisis un muesli sans sucre ajouté : les fruits secs suffisent à sucrer." : "Le granola est plus calorique : parfait les jours de sortie longue.", "Bol, cuillère");
  })));
  // 10. Crêpes
  [["confiture et yaourt", {confiture:20, yaourt:125}], ["banane et chocolat noir", {banane:120, choco:10}], ["complètes jambon-emmental", {jambon:40, emmental:20}]].forEach(([cs, ing]) => {
    add("pdj", `Crêpes ${cs}`, "Crêpes", 20, Object.assign({farine:50, lait:120, oeuf:55, huile:3}, ing),
      ["Dans un saladier, mélange la farine et l'œuf, puis verse le lait petit à petit en fouettant pour éviter les grumeaux.", "Laisse reposer 10 min si tu as le temps.", "Chauffe une poêle légèrement huilée, verse une petite louche de pâte et incline la poêle pour l'étaler.", "Retourne après 1 min, cuis encore 30 secondes.", cs.includes("jambon") ? "Garnis de jambon et d'emmental, plie et laisse fondre 1 min dans la poêle." : "Garnis et roule les crêpes."],
      "La pâte se garde 2 jours au frigo : prépare-la la veille.", "Saladier, fouet, poêle, louche");
  });

  /* ================= COLLATIONS ================= */
  const SN_FR = {pomme:["une pomme", "pomme", 150], banane:["une banane", "banane", 120], poire:["une poire", "poire", 150], orange:["une orange", "orange", 150], kiwi:["deux kiwis", "kiwis", 150], abricots:["des abricots secs", "abricots secs", 30], dattes:["des dattes", "dattes", 24]};
  const SN_NUT = {amandes:["amandes", 20], noix:["noix", 20], noisettes:["noisettes", 20], cajou:["noix de cajou", 20], courge:["graines de courge", 20]};
  Object.entries(SN_FR).forEach(([fk, [fa, fs, fg]], fi) => Object.entries(SN_NUT).forEach(([nk, [ns, ng]], ni) => {
    add("snack", `${cap(fs)} et ${ns}`, `${cap(fs)} ${ns.split(" ")[0]}`, 1, {[fk]:fg, [nk]:ng},
      [`Prépare ${fa}${fk === "pomme" || fk === "poire" ? " lavée et coupée en quartiers" : ""}.`, `Compte une petite poignée de ${ns} (20 g, environ 15 pièces).`],
      pick(["Facile à glisser dans un sac : la collation des journées chargées.", "Les fruits à coque calent grâce aux bonnes graisses et aux fibres.", "Une poignée suffit : les oléagineux sont très énergétiques."], fi + ni), "Aucun");
  }));
  const SN_BASE = {skyr:["skyr", 150], fblanc:["fromage blanc", 150], yaourt:["yaourt nature", 125], cottage:["cottage cheese", 150]};
  const SN_ADD = [["compote", {compote:100}, "Ajoute la compote et mélange."], ["fruits rouges", {rouges:100}, "Ajoute les fruits rouges."], ["banane", {banane:120}, "Coupe la banane en rondelles par-dessus."], ["kiwi", {kiwi:75}, "Ajoute le kiwi en dés."], ["mangue", {mangue:100}, "Ajoute les dés de mangue."], ["granola", {granola:25}, "Parsème de granola juste avant de manger."], ["muesli", {muesli:25}, "Ajoute le muesli et laisse 2 min pour qu'il s'imprègne."], ["miel et noix", {miel:10, noix:10}, "Ajoute le miel et les noix concassées."]];
  Object.entries(SN_BASE).forEach(([bk, [bs, bg]]) => SN_ADD.forEach(([as, ing, act]) => {
    add("snack", `${cap(bs)} et ${as}`, `${cap(bs.split(" ")[0])} ${as.split(" ")[0]}`, 2, Object.assign({[bk]:bg}, ing), [`Verse le ${bs} dans un bol.`, act], bk === "yaourt" ? "La collation la moins chère : environ 50 centimes." : "Protéines + glucides : ça tient jusqu'au repas suivant.", "Bol, cuillère");
  }));
  const SN_SUP = {painc:["tartine de pain complet", 50], galriz:["galettes de riz", 20], pseigle:["tartine de pain de seigle", 50]};
  const SN_GAR = [["beurre de cacahuète et banane", {cacahuete:15, banane:60}], ["fromage frais et concombre", {ffrais:20, concombre:60}], ["houmous et carotte râpée", {houmous:30, carotte:50}], ["comté", {comte:25}], ["jambon", {jambon:40}], ["ricotta et miel", {ricotta:40, miel:10}], ["avocat", {avocat:50, citron:5}]];
  Object.entries(SN_SUP).forEach(([sk, [ss, sg]]) => SN_GAR.forEach(([gs, ing]) => {
    add("snack", `${cap(ss)}, ${gs}`, `${sk === "galriz" ? "Galettes" : "Tartine"} ${gs.split(" ")[0]}`, 3, Object.assign({[sk]:sg}, ing), [sk === "galriz" ? "Prends 2 galettes de riz." : "Coupe une tranche de pain et fais-la griller si tu veux.", `Garnis avec ${gs}.`], "Une collation salée pour varier : elle évite les envies de sucre.", "Couteau");
  }));
  [["dattes et beurre de cacahuète", {dattes:48, cacahuete:20, avoine:20}], ["dattes, amandes et cacao", {dattes:48, amandes:20, choco:10}], ["abricots et noisettes", {abricots:40, noisettes:20, avoine:20}], ["avoine, miel et chocolat", {avoine:40, miel:15, choco:15}], ["dattes, noix et cannelle", {dattes:48, noix:20}]].forEach(([es, ing]) => {
    add("snack", `Energy balls ${es}`, "Energy balls", 10, ing, ["Dénoyaute les fruits secs si besoin.", "Mixe tous les ingrédients 1 min jusqu'à obtenir une pâte collante (ajoute 1 c. à soupe d'eau si c'est trop sec).", "Forme 4 à 5 boules avec les mains mouillées.", "Garde-les au frigo dans une boîte : elles se conservent une semaine."], "Fais-en 20 d'un coup le dimanche : tes collations de la semaine sont prêtes, pour 3 fois moins cher qu'en barres.", "Mixeur, boîte");
  });
  [["banane et lait", {lait:250, banane:120}], ["fruits rouges et skyr", {skyr:150, lait:100, rouges:100}], ["mangue et yaourt", {yaourt:125, lait:100, mangue:100}], ["cacao et banane", {lait:250, banane:120, choco:10}], ["pomme, kiwi et épinards", {pomme:150, kiwi:75, epinards:30, yaourt:125}]].forEach(([ss, ing]) => {
    add("snack", `Smoothie ${ss}`, `Smoothie ${ss.split(" ")[0]}`, 4, ing, ["Coupe les fruits en morceaux.", "Mixe tout 40 secondes.", "Bois-le frais."], "Après une séance, un smoothie lait + fruits recharge les réserves et répare les muscles.", "Blender");
  });
  ["carotte", "concombre", "poivron"].forEach(vk => add("snack", `Houmous, ${FOOD[vk][0].toLowerCase()} et pita`, "Houmous", 4, {houmous:50, [vk]:100, pita:30}, [`Coupe ${vk === "carotte" ? "les carottes" : vk === "concombre" ? "le concombre" : "le poivron"} en bâtonnets.`, "Coupe la moitié d'un pain pita en triangles.", "Trempe dans le houmous."], "Les pois chiches du houmous apportent protéines végétales et fibres.", "Couteau, bol"));
  add("snack", "Œufs durs et tomates cerises", "Œufs durs", 12, {oeuf:110, tomate:120}, ["Plonge les œufs 10 min dans l'eau bouillante, puis 2 min dans l'eau froide.", "Écale-les et sale légèrement.", "Accompagne de tomates cerises."], "Prépare 6 œufs durs d'un coup : ils se gardent 4 jours au frigo dans leur coquille.", "Casserole");
  add("snack", "Tartine de maquereau et citron", "Maquereau", 3, {maquereau:60, painc:50, citron:5}, ["Égoutte le maquereau et écrase-le à la fourchette avec un trait de citron.", "Étale-le sur la tartine et poivre."], "Les poissons gras apportent des oméga-3, bons pour les articulations.", "Fourchette, couteau");
  add("snack", "Comté et pomme", "Comté pomme", 2, {comte:25, pomme:150}, ["Coupe le comté en bâtonnets et la pomme en quartiers.", "Associe les deux à chaque bouchée."], "Le fromage apporte calcium et protéines : un duo qui cale.", "Couteau");
  add("snack", "Lait chocolaté et banane", "Lait chocolaté", 1, {laitchoc:300, banane:120}, ["Verse le lait chocolaté bien frais.", "Mange la banane à côté."], "La boisson de récupération la moins chère : dans les 30 min après une séance intense.", "Verre");
  add("snack", "Pain d'épices et yaourt", "Pain d'épices", 1, {paindepices:40, yaourt:125}, ["Coupe 2 tranches de pain d'épices.", "Accompagne d'un yaourt nature."], "Le pain d'épices est riche en glucides et pauvre en graisses : bien avant une séance.", "Aucun");
  add("snack", "Riz au lait et fruits rouges", "Riz au lait", 2, {riz_lait:125, rouges:80}, ["Verse le riz au lait dans un bol.", "Ajoute les fruits rouges par-dessus."], "Doux pour l'estomac : parfait 1 h avant de courir.", "Bol");
  add("snack", "Compote et amandes", "Compote amandes", 1, {compote:100, amandes:20}, ["Ouvre la gourde de compote.", "Accompagne d'une poignée d'amandes."], "La compote sans sucre ajouté se transporte partout.", "Aucun");
  add("snack", "Galettes de riz, chocolat noir et banane", "Galettes choco", 2, {galriz:20, choco:10, banane:60}, ["Pose 2 carrés de chocolat sur les galettes de riz.", "Ajoute quelques rondelles de banane."], "Une gourmandise légère et vite digérée.", "Couteau");
  [["amandes, raisins secs et chocolat", {amandes:15, raisins:15, choco:5}], ["noisettes, abricots secs et noix de cajou", {noisettes:10, abricots:20, cajou:10}], ["noix, dattes et amandes", {noix:10, dattes:16, amandes:10}], ["cacahuètes, raisins et graines de courge", {cacahuete:10, raisins:15, courge:10}]].forEach(([ms, ing]) => add("snack", `Mélange du coureur : ${ms}`, "Mélange coureur", 2, ing, ["Mélange tous les ingrédients dans un petit sachet ou une boîte.", "Prépare 5 portions d'un coup pour la semaine."], "Le mélange idéal pour les sorties longues : glucides rapides + énergie durable.", "Boîte"));

  /* ================= DÉJEUNERS ET DÎNERS ================= */
  const P = {
    poulet:{s:"poulet", g:130, prep:"Coupe le poulet en lanières de 1 cm.", cook:"Fais dorer le poulet 6 à 7 min en remuant : il doit être blanc à cœur, sans rose."},
    dinde:{s:"dinde", g:130, prep:"Coupe l'escalope de dinde en lanières.", cook:"Saisis la dinde 5 min en remuant, jusqu'à ce qu'elle soit dorée."},
    crevettes:{s:"crevettes", g:150, prep:"Décongèle les crevettes 5 min sous l'eau froide et sèche-les dans du papier absorbant.", cook:"Fais sauter les crevettes 3 min : elles deviennent roses et se recourbent."},
    tofu:{s:"tofu", g:150, prep:"Essore le tofu 10 min entre deux torchons sous une casserole, puis coupe-le en cubes.", cook:"Dore le tofu 6 à 8 min en retournant les cubes pour colorer toutes les faces."},
    boeuf:{s:"bœuf haché", g:130, prep:"", cook:"Fais revenir le bœuf haché 5 min en l'écrasant à la cuillère : il doit être brun partout."},
    porc:{s:"porc", g:130, prep:"Coupe le filet mignon en fines tranches.", cook:"Saisis le porc 4 à 5 min : il doit être doré et juste rosé à cœur."},
    saumon:{s:"saumon", g:130, prep:"Sèche le pavé de saumon avec du papier absorbant.", cook:"Cuis le saumon côté peau 5 min à feu moyen, puis 2 à 3 min de l'autre côté : il reste rosé à cœur."},
    cabillaud:{s:"cabillaud", g:150, prep:"Sèche le cabillaud avec du papier absorbant et sale-le.", cook:"Cuis le cabillaud 3 min de chaque côté à feu moyen : la chair devient blanche et se détache en lamelles."},
    poischiches:{s:"pois chiches", g:200, prep:"Égoutte et rince les pois chiches en conserve.", cook:"Fais revenir les pois chiches 5 min avec 1 c. à café de paprika : ils deviennent légèrement croustillants."},
    lentilles:{s:"lentilles", g:220, prep:"Rince les lentilles cuites (conserve ou sous vide).", cook:"Réchauffe les lentilles 3 min dans la sauce."}
  };
  const ST = {
    basmati:{s:"riz basmati", g:200, min:12, cook:"Fais cuire le riz basmati 10 à 11 min dans une grande casserole d'eau bouillante salée, puis égoutte (pèse-le cru : environ 1/3 du poids cuit indiqué)."},
    rizc:{s:"riz complet", g:200, min:25, cook:"Lance le riz complet en premier : 20 à 25 min dans l'eau bouillante salée, puis égoutte."},
    quinoa:{s:"quinoa", g:180, min:14, cook:"Rince le quinoa cru, puis cuis-le 12 min dans 2 fois son volume d'eau salée, à couvert."},
    semoule:{s:"semoule", g:200, min:6, cook:"Verse la semoule dans un bol, couvre-la du même volume d'eau bouillante salée avec un filet d'huile, couvre 5 min puis égrène à la fourchette."},
    boulgour:{s:"boulgour", g:200, min:12, cook:"Cuis le boulgour 10 min dans 2 fois son volume d'eau salée, à couvert, jusqu'à absorption."},
    pates:{s:"pâtes complètes", g:220, min:12, cook:"Cuis les pâtes complètes dans une grande casserole d'eau bouillante salée, le temps indiqué sur le paquet."},
    patesb:{s:"pâtes", g:230, min:11, cook:"Cuis les pâtes dans une grande casserole d'eau bouillante salée, le temps indiqué sur le paquet."},
    pdt:{s:"pommes de terre", g:250, min:15, cook:"Épluche les pommes de terre, coupe-les en dés de 2 cm et cuis-les 12 min dans l'eau bouillante salée : un couteau doit s'enfoncer sans résistance."},
    patate:{s:"patate douce rôtie", g:250, min:28, cook:"Coupe la patate douce en cubes de 2 cm, mélange-les avec un peu d'huile et enfourne 25 min à 200 °C."},
    nouilles:{s:"nouilles de riz", g:200, min:6, cook:"Plonge les nouilles de riz 4 min dans l'eau bouillante hors du feu, puis égoutte-les et passe-les sous l'eau froide."}
  };
  const V = {
    brocoli:{s:"brocoli", g:200, prep:"Coupe le brocoli en petits bouquets.", cook:"Cuis le brocoli 6 min à l'eau bouillante ou à la vapeur : il doit rester vert et croquant."},
    courgette:{s:"courgette", g:200, prep:"Lave la courgette et coupe-la en demi-rondelles.", cook:"Fais revenir la courgette 5 à 6 min à la poêle."},
    poivron:{s:"poivron", g:150, prep:"Épépine le poivron et coupe-le en lamelles.", cook:"Fais sauter le poivron 6 min."},
    haricotsv:{s:"haricots verts", g:200, prep:"Équeute les haricots verts (ou prends-les surgelés).", cook:"Cuis les haricots verts 8 min dans l'eau bouillante salée, puis égoutte."},
    champignons:{s:"champignons", g:150, prep:"Essuie les champignons et coupe-les en lamelles.", cook:"Fais revenir les champignons 5 min, jusqu'à ce que leur eau s'évapore."},
    carotte:{s:"carottes", g:150, prep:"Épluche les carottes et coupe-les en fines rondelles.", cook:"Fais sauter les carottes 8 min avec 2 c. à soupe d'eau pour qu'elles cuisent à cœur."},
    epinards:{s:"épinards", g:150, prep:"Rince les jeunes pousses d'épinards.", cook:"Fais tomber les épinards 2 min à la poêle : ils réduisent beaucoup."},
    petitspois:{s:"petits pois", g:150, prep:"", cook:"Cuis les petits pois surgelés 4 min dans l'eau bouillante."},
    choufleur:{s:"chou-fleur", g:200, prep:"Détaille le chou-fleur en petits bouquets.", cook:"Cuis le chou-fleur 8 min à la vapeur ou dans l'eau bouillante."},
    butternut:{s:"butternut", g:200, prep:"Épluche la courge butternut et coupe-la en cubes de 2 cm.", cook:"Fais cuire la butternut 15 min à couvert avec un fond d'eau."},
    aubergine:{s:"aubergine", g:200, prep:"Coupe l'aubergine en cubes de 2 cm.", cook:"Fais dorer l'aubergine 10 min à feu moyen en remuant, couvercle posé les 5 premières minutes."},
    chou:{s:"chou", g:150, prep:"Émince finement le chou.", cook:"Fais sauter le chou 6 à 7 min."}
  };
  const TIPS_PLAT = ["Prépare 3 portions d'un coup : elles se gardent 3 jours au frigo dans des boîtes.", "Les légumes surgelés sont aussi nutritifs que les frais, et bien moins chers.", "Un repas complet : protéines pour les muscles, féculents pour l'énergie, légumes pour les vitamines.", "La veille d'une sortie longue, augmente un peu la part de féculents.", "Cuisiner avec des épices plutôt que du sel aide à mieux récupérer.", "Parfait à emporter : se réchauffe 2 min au micro-ondes."];
  const sNoun = s => s; // noms déjà prêts
  const minFor = (st, extra = 15) => Math.max(st.min, extra) + 3;

  // F1. Woks sauce soja
  const WVEG = [["poivron", "courgette"], ["brocoli", "carotte"], ["champignons", "haricotsv"], ["chou", "carotte"]];
  ["poulet", "dinde", "crevettes", "tofu", "boeuf", "porc"].forEach((pk, pi) => WVEG.forEach((vv, vi) => [pick(["basmati", "nouilles", "rizc"], pi + vi), pick(["nouilles", "basmati", "rizc"], pi + vi + 1)].forEach((sk, si) => {
    if(si && (pi + vi) % 2) return;
    const p = P[pk], st = ST[sk], v1 = V[vv[0]], v2 = V[vv[1]];
    add("plat", `Wok de ${p.s}, ${v1.s} et ${v2.s}, ${st.s}`, `Wok ${p.s.split(" ")[0]}`, minFor(st, 18), {[pk]:p.g, [sk]:st.g, [vv[0]]:v1.g*.6, [vv[1]]:v2.g*.6, soja:15, huile:10},
      [st.cook, `${v1.prep} ${v2.prep}`.trim(), p.prep, "Chauffe l'huile dans un wok ou une grande poêle à feu vif.", p.cook, `Ajoute les légumes et fais-les sauter 5 min sans arrêter de remuer : ils doivent rester croquants.`, "Verse la sauce soja avec 1 gousse d'ail hachée et un peu de gingembre râpé, mélange 1 min.", `Sers aussitôt sur le ${st.s.replace("nouilles de riz", "lit de nouilles")}.`],
      "Cuisson très vive et courte : les légumes restent croquants. La sauce soja est salée, n'ajoute pas de sel.", "Wok ou grande poêle, casserole, passoire, planche, couteau");
  })));
  // F2. Currys au lait de coco
  ["poulet", "crevettes", "tofu", "poischiches", "lentilles"].forEach((pk, pi) => ["courgette", "epinards", "choufleur", "butternut", "petitspois", "aubergine"].forEach((vk, vi) => {
    const p = P[pk], v = V[vk], sk = pick(["basmati", "rizc", "quinoa"], pi + vi), st = ST[sk];
    add("plat", `Curry de ${p.s} au lait de coco et ${v.s}, ${st.s}`, `Curry ${p.s.split(" ")[0]}`, minFor(st, 22), {[pk]:p.g, [sk]:st.g, [vk]:v.g, coco:60, oignon:50, tomate:100, huile:8},
      [st.cook, "Émince l'oignon et fais-le revenir 3 min dans l'huile, dans une sauteuse à feu moyen.", "Ajoute 1 c. à café de curry et 1/2 c. à café de curcuma, remue 30 secondes pour réveiller les épices.", v.prep, p.prep, pk === "lentilles" || pk === "poischiches" ? `Ajoute les ${p.s}, ${v.s === "épinards" ? "les épinards" : "le légume"}, les tomates concassées et le lait de coco.` : `${p.cook} Ajoute ensuite le légume, les tomates concassées et le lait de coco.`, `Laisse mijoter 10 min à feu doux${vk === "butternut" ? " (15 min pour que la courge soit fondante)" : ""}. Sale et poivre.`, `Sers avec le ${st.s}.`],
      pick(["Encore meilleur réchauffé le lendemain : les épices ont eu le temps d'infuser.", "Le lait de coco léger divise les graisses par deux par rapport au classique.", "Se congèle très bien en portions individuelles."], pi + vi), "Sauteuse ou casserole, casserole pour le féculent, couteau, planche");
  }));
  // F3. Poêlées citron-herbes et sauce moutarde
  const F3P = ["poulet", "dinde", "cabillaud", "saumon", "crevettes", "porc"], F3S = ["quinoa", "semoule", "pdt", "rizc", "boulgour", "patate"], F3V = ["haricotsv", "courgette", "brocoli", "epinards", "carotte", "champignons"];
  F3P.forEach((pk, pi) => F3S.forEach((sk, si) => {
    const p = P[pk], st = ST[sk], vk = pick(F3V, pi*2 + si), v = V[vk];
    add("plat", `${cap(p.s)} au citron et aux herbes, ${st.s} et ${v.s}`, `${cap(p.s)} citron`, minFor(st, 16), {[pk]:p.g, [sk]:st.g, [vk]:v.g, huile:10, citron:20},
      [st.cook, v.prep, v.cook, p.prep, "Chauffe la moitié de l'huile dans une poêle à feu moyen.", p.cook, "Arrose de jus de citron et parsème d'herbes (persil, ciboulette ou herbes de Provence) hors du feu.", `Dresse avec le ${st.s} et le légume, arrose du reste d'huile.`],
      pick(TIPS_PLAT, pi + si), "Poêle, casserole, passoire, planche, couteau");
  }));
  ["poulet", "dinde", "porc"].forEach((pk, pi) => [["pdt", "haricotsv"], ["rizc", "champignons"], ["pates", "brocoli"], ["semoule", "carotte"]].forEach(([sk, vk], si) => {
    const p = P[pk], st = ST[sk], v = V[vk];
    add("plat", `${cap(p.s)} sauce moutarde légère, ${st.s} et ${v.s}`, `${cap(p.s)} moutarde`, minFor(st, 18), {[pk]:p.g, [sk]:st.g, [vk]:v.g, creme:30, huile:5},
      [st.cook, v.prep, v.cook, p.prep, p.cook, "Baisse le feu, ajoute la crème légère et 1 c. à café de moutarde, mélange 2 min jusqu'à ce que la sauce nappe la viande.", `Sers avec le ${st.s} et le légume.`],
      "La crème légère à 15 % donne une sauce onctueuse avec deux fois moins de gras.", "Poêle, casserole, passoire");
  }));
  // F4. Pâtes
  const PATES = [
    ["Pâtes au pesto, poulet et tomates cerises", {patesb:230, poulet:120, pesto:20, tomate:120}, ["Cuis les pâtes selon le paquet.", "Fais dorer le poulet en lanières 6 à 7 min dans une poêle légèrement huilée.", "Coupe les tomates cerises en deux.", "Égoutte les pâtes en gardant 2 c. à soupe d'eau de cuisson, mélange-les avec le pesto, cette eau, le poulet et les tomates."]],
    ["Pâtes au saumon, épinards et crème légère", {patesb:230, saumon:110, epinards:120, creme:30}, ["Cuis les pâtes selon le paquet.", "Coupe le saumon en cubes et fais-le cuire 3 min dans une poêle.", "Ajoute les épinards et laisse-les tomber 2 min, puis la crème, sel et poivre.", "Mélange avec les pâtes égouttées."]],
    ["Pâtes carbonara légère au jambon", {patesb:230, jambon:60, oeuf:55, parmesan:15}, ["Cuis les pâtes selon le paquet.", "Bats l'œuf avec le parmesan et beaucoup de poivre.", "Égoutte les pâtes, remets-les hors du feu dans la casserole avec le jambon en lanières.", "Verse le mélange œuf-parmesan avec 3 c. à soupe d'eau de cuisson et mélange vite : la chaleur des pâtes crée une sauce crémeuse."]],
    ["Pâtes aux légumes du soleil et mozzarella", {pates:220, courgette:120, aubergine:100, poivron:80, mozza:50, huile:10}, ["Cuis les pâtes selon le paquet.", "Coupe les légumes en petits dés et fais-les revenir 10 min dans l'huile avec de l'ail et des herbes de Provence.", "Mélange avec les pâtes et ajoute la mozzarella en dés hors du feu : elle fond légèrement."]],
    ["Pâtes aux champignons et à la dinde", {pates:220, dinde:120, champignons:150, creme:25}, ["Cuis les pâtes selon le paquet.", "Saisis la dinde en lanières 5 min, réserve.", "Fais revenir les champignons 5 min, ajoute la crème et la dinde.", "Mélange avec les pâtes."]],
    ["Pâtes aux crevettes, ail et citron", {patesb:230, crevettes:150, huile:10, citron:20}, ["Cuis les pâtes selon le paquet.", "Fais revenir 1 gousse d'ail émincée dans l'huile 30 secondes, ajoute les crevettes 3 min.", "Ajoute le jus et le zeste du citron, du persil, puis les pâtes égouttées."]],
    ["Pâtes au brocoli, amandes et parmesan", {pates:220, brocoli:200, amandes:15, parmesan:15, huile:8}, ["Cuis les pâtes avec les bouquets de brocoli dans la même eau les 6 dernières minutes.", "Fais griller les amandes concassées 2 min à la poêle sèche.", "Égoutte, mélange avec l'huile, le parmesan et les amandes."]],
    ["Pâtes à la bolognaise de lentilles", {pates:220, lentilles:150, tomate:200, carotte:60, oignon:40, huile:8}, ["Cuis les pâtes selon le paquet.", "Fais revenir l'oignon et la carotte en petits dés 5 min dans l'huile.", "Ajoute les lentilles cuites, les tomates concassées, sel, poivre et origan, laisse mijoter 10 min.", "Sers sur les pâtes."]],
    ["Pâtes au thon, poivron et olives", {patesb:230, thon:100, poivron:120, huile:8}, ["Cuis les pâtes selon le paquet.", "Fais revenir le poivron en lamelles 6 min dans l'huile.", "Ajoute le thon émietté et une poignée d'olives, puis les pâtes."]],
    ["Pâtes au poulet et sauce tomate-basilic", {patesb:230, poulet:120, tomate:200, huile:8}, ["Cuis les pâtes selon le paquet.", "Dore le poulet en dés 6 à 7 min.", "Ajoute les tomates concassées, 1 gousse d'ail, sel et poivre, mijote 8 min.", "Mélange avec les pâtes et du basilic."]],
    ["Gnocchis poêlés, épinards et parmesan", {gnocchis:250, epinards:150, parmesan:15, huile:8}, ["Fais dorer les gnocchis 6 à 8 min dans l'huile à feu moyen, sans les cuire à l'eau avant.", "Ajoute les épinards et laisse-les tomber 2 min.", "Parsème de parmesan et poivre."]],
    ["Gnocchis à la sauce tomate et mozzarella", {gnocchis:250, tomate:200, mozza:50}, ["Cuis les gnocchis 2 min à l'eau bouillante : ils sont prêts quand ils remontent à la surface.", "Fais chauffer les tomates concassées avec de l'ail et du basilic 5 min.", "Mélange, ajoute la mozzarella et passe 5 min au four chaud si tu veux gratiner."]]
  ];
  PATES.forEach(([n, ing, st], i) => add("plat", n, n.split(" ").slice(0, 2).join(" ").replace(/,$/, ""), 20, ing, st, pick(TIPS_PLAT, i), "Grande casserole, passoire, poêle"));
  // F5. Salades composées
  const SB = {quinoa:["quinoa", 180, "Rince et cuis le quinoa 12 min (ou prends un reste de la veille), puis laisse-le refroidir."], boulgour:["boulgour", 200, "Cuis le boulgour 10 min, puis laisse-le refroidir."], lentilles:["lentilles", 220, "Rince les lentilles cuites en conserve."], pdt:["pommes de terre", 250, "Cuis les pommes de terre en dés 12 min à l'eau salée, puis laisse-les tiédir."], patesb:["pâtes", 220, "Cuis les pâtes selon le paquet, rince-les à l'eau froide."], rizc:["riz complet", 200, "Cuis le riz complet 20 à 25 min, puis rince-le à l'eau froide."], poischiches:["pois chiches", 220, "Rince les pois chiches en conserve."]};
  const SP = {thon:["thon", 100, "Égoutte le thon et émiette-le."], poulet:["poulet", 110, "Fais cuire le poulet en lanières 6 à 7 min, puis laisse-le refroidir."], oeuf:["œufs durs", 110, "Cuis les œufs 10 min à l'eau bouillante, refroidis-les et coupe-les en quartiers."], feta:["feta", 50, "Coupe la feta en dés."], mozza:["mozzarella", 70, "Coupe la mozzarella en dés."], maquereau:["maquereau", 100, "Égoutte le maquereau et effeuille-le."], sardines:["sardines", 80, "Égoutte les sardines."], chevre:["chèvre frais", 50, "Émiette le chèvre frais."], crevettes:["crevettes", 130, "Décongèle les crevettes et sèche-les."], saumonf:["saumon fumé", 70, "Coupe le saumon fumé en lanières."]};
  const SV = [["tomate", "concombre"], ["poivron", "mais"], ["carotte", "betterave"], ["tomate", "salade"], ["concombre", "mais"], ["betterave", "salade"], ["tomate", "poivron"]];
  const SVN = {tomate:"tomates", concombre:"concombre", poivron:"poivron", mais:"maïs", carotte:"carottes râpées", betterave:"betterave", salade:"salade"};
  Object.entries(SB).forEach(([bk, [bs, bg, bst]], bi) => Object.keys(SP).filter((x, j) => (j + bi) % 2 === 0 || (bk === "quinoa" && j < 6)).slice(0, 5).forEach((pk, pi) => {
    const [ps, pg, pst] = SP[pk], vv = pick(SV, bi + pi);
    add("plat", `Salade de ${bs}, ${ps}, ${SVN[vv[0]]} et ${SVN[vv[1]]}`, `Salade ${bs.split(" ")[0]}`, bk === "rizc" ? 28 : 15, {[bk]:bg, [pk]:pg, [vv[0]]:100, [vv[1]]:80, huile:10},
      [bst, pst, `Coupe ${SVN[vv[0]]} et ${SVN[vv[1]]} en petits morceaux${vv.includes("mais") ? " (égoutte le maïs)" : ""}.`, "Prépare la vinaigrette au fond du saladier : l'huile, 1 c. à soupe de vinaigre, 1 c. à café de moutarde, sel et poivre.", "Ajoute tous les ingrédients et mélange. Laisse reposer 10 min au frais si tu peux : les saveurs se mélangent."],
      "Se prépare la veille et se garde 2 jours au frigo : parfait pour le déjeuner au travail.", "Casserole, saladier, couteau, planche");
  }));
  // F6. Bowls
  const BS = [["quinoa", "quinoa", 180, ST.quinoa.cook], ["rizc", "riz complet", 180, ST.rizc.cook], ["patate", "patate douce rôtie", 220, ST.patate.cook], ["boulgour", "boulgour", 180, ST.boulgour.cook]];
  const BP = [["poischiches", "pois chiches rôtis", 180, "Rince les pois chiches, sèche-les, mélange-les avec 1 c. à café d'huile et de paprika et fais-les dorer 8 min à la poêle."], ["tofu", "tofu grillé", 150, P.tofu.prep + " " + P.tofu.cook], ["poulet", "poulet grillé", 120, P.poulet.prep + " " + P.poulet.cook], ["saumon", "saumon", 120, P.saumon.cook], ["oeuf", "œufs mollets", 110, "Cuis les œufs 6 min à l'eau bouillante, refroidis-les et écale-les : le jaune reste coulant."], ["crevettes", "crevettes", 140, P.crevettes.cook]];
  const BV = [[{avocat:60, carotte:80, chou:60}, "avocat, carottes râpées et chou"], [{concombre:80, tomate:80, mais:60}, "concombre, tomates et maïs"], [{epinards:60, betterave:80, avocat:40}, "épinards, betterave et avocat"], [{brocoli:120, carotte:60}, "brocoli et carottes"]];
  BS.forEach(([sk, ss, sg, scook], si) => BP.forEach(([pk, ps, pg, pcook], pi) => {
    if((si + pi) % 4 === 3) return;
    const [vi, vs] = pick(BV, si + pi);
    add("plat", `Bowl ${ps}, ${ss} et ${vs}`, `Bowl ${ps.split(" ")[0]}`, minFor({min:sk === "patate" ? 28 : sk === "rizc" ? 25 : 14}, 15), Object.assign({[sk]:sg, [pk]:pg, huile:10}, vi),
      [scook, pcook, `Prépare les légumes : ${vs} (râpe, coupe en dés ou en fines lamelles).`, "Mélange dans un bol 1 c. à soupe d'huile, 1 c. à soupe de sauce soja ou de jus de citron et 1 c. à café de miel : c'est la sauce.", "Dispose chaque ingrédient en petits tas dans un grand bol et arrose de sauce."],
      "Le bowl est le meilleur moyen d'utiliser les restes du frigo : change les légumes selon la saison.", "Casserole ou four, poêle, grand bol, couteau");
  }));
  // F7. Œufs
  [["Shakshuka (œufs pochés à la tomate et au poivron)", {oeuf:165, tomate:250, poivron:100, oignon:50, painc:60, huile:8}, ["Émince l'oignon et le poivron, fais-les revenir 6 min dans l'huile dans une poêle.", "Ajoute les tomates concassées, 1 c. à café de cumin et de paprika, sel, poivre, mijote 8 min.", "Creuse 3 puits dans la sauce et casse un œuf dans chacun.", "Couvre et laisse cuire 6 à 8 min à feu doux : les blancs doivent être pris.", "Sers avec le pain pour saucer."]],
   ["Frittata courgette et chèvre, pommes de terre", {oeuf:165, courgette:200, chevre:40, pdt:150, huile:8}, ["Cuis les pommes de terre en dés 12 min à l'eau salée.", "Fais revenir la courgette en dés 5 min dans l'huile, ajoute les pommes de terre.", "Verse les œufs battus, parsème de chèvre.", "Cuis 8 min à feu doux à couvert, jusqu'à ce que le dessus soit pris."]],
   ["Tortilla espagnole pommes de terre et oignon", {oeuf:165, pdt:250, oignon:60, huile:10}, ["Coupe les pommes de terre en fines rondelles et l'oignon en lamelles.", "Fais-les cuire 15 min à feu doux dans l'huile, à couvert, en remuant de temps en temps.", "Verse les œufs battus salés, cuis 6 min à feu doux.", "Retourne la tortilla à l'aide d'une assiette et cuis encore 3 min."]],
   ["Omelette champignons-épinards et pommes de terre sautées", {oeuf:165, champignons:120, epinards:80, pdt:200, huile:10}, ["Cuis les pommes de terre en dés 12 min puis fais-les dorer 5 min à la poêle.", "Fais revenir les champignons 5 min, ajoute les épinards 1 min.", "Verse les œufs battus et cuis l'omelette 3 min.", "Sers avec les pommes de terre."]],
   ["Quiche sans pâte poireaux et jambon", {oeuf:110, lait:150, poireau:200, jambon:60, emmental:20}, ["Préchauffe le four à 180 °C.", "Émince les poireaux et fais-les fondre 8 min à la poêle avec un fond d'eau.", "Bats les œufs avec le lait, sel, poivre et muscade.", "Mets les poireaux et le jambon dans un plat, verse l'appareil, parsème d'emmental.", "Enfourne 25 min jusqu'à ce que ce soit doré."]],
   ["Œufs brouillés, saumon fumé et pommes de terre", {oeuf:165, saumonf:50, pdt:250, beurre:5}, ["Cuis les pommes de terre entières 20 min à l'eau salée.", "Brouille les œufs à feu doux avec le beurre en remuant sans cesse.", "Sers avec le saumon fumé et les pommes de terre coupées en deux, de la ciboulette."]]
  ].forEach(([n, ing, st], i) => add("plat", n, n.split(" ")[0], i === 4 ? 35 : 20, ing, st, "Les œufs : la protéine la plus économique pour un dîner rapide.", "Poêle avec couvercle, casserole, bol, fouet"));
  // F8. Wraps, pitas, quesadillas
  [["Wraps thon, maïs et crudités", {tortilla:120, thon:100, mais:60, salade:60, fblanc:40}], ["Wraps saumon fumé, fromage frais et concombre", {tortilla:120, saumonf:70, ffrais:30, concombre:80}], ["Wraps œuf, avocat et tomate", {tortilla:120, oeuf:110, avocat:50, tomate:80}], ["Pita poulet, houmous et crudités", {pita:130, poulet:110, houmous:40, salade:60, tomate:60}], ["Pita falafels maison et sauce yaourt", {pita:130, poischiches:150, yaourt:80, salade:60, farine:15, huile:10}], ["Quesadillas haricots rouges, maïs et emmental", {tortilla:120, hrouges:150, mais:60, emmental:30}], ["Tacos de dinde, poivron et sauce yaourt", {tortilla:120, dinde:120, poivron:100, yaourt:60}], ["Wraps de bœuf épicé et crudités", {tortilla:120, boeuf:110, salade:60, tomate:80, fblanc:40}], ["Pita au thon, œuf dur et tomate", {pita:130, thon:80, oeuf:55, tomate:80}], ["Wraps tofu grillé, carotte et chou", {tortilla:120, tofu:130, carotte:60, chou:60, soja:10}]].forEach(([n, ing], i) => {
    const hot = /poulet|dinde|bœuf|tofu|falafels|Quesadillas|œuf, avocat/.test(n);
    add("plat", n, n.split(" ")[0], hot ? 15 : 10, ing,
      [hot ? (n.includes("falafels") ? "Écrase les pois chiches à la fourchette avec la farine, de l'ail, du cumin et du persil, forme 6 galettes et dore-les 3 min de chaque côté dans l'huile." : n.includes("Quesadillas") ? "Écrase grossièrement les haricots rouges avec une pincée de cumin." : n.includes("œuf") ? "Cuis les œufs durs 10 min, refroidis-les et coupe-les." : "Fais cuire la garniture en lanières 5 à 7 min dans une poêle légèrement huilée.") : "Égoutte et prépare la garniture.",
       "Lave et coupe les crudités en fines lanières.", n.includes("Quesadillas") ? "Étale la garniture sur une galette, parsème de fromage, couvre d'une seconde galette et dore 2 min de chaque côté à la poêle." : "Réchauffe les galettes ou le pita 20 secondes à la poêle sèche pour qu'ils restent souples.", n.includes("Quesadillas") ? "Coupe en triangles." : "Garnis, roule bien serré (ou remplis le pita) et coupe en deux."],
      "Se transporte facilement : emballe dans du papier aluminium pour le déjeuner.", "Poêle, couteau, planche");
  });
  // F9. Mijotés (batch cooking)
  [["Chili con carne et riz", {boeuf:120, hrouges:150, tomate:200, oignon:50, poivron:80, basmati:180, huile:5}, "Fais revenir l'oignon et le poivron, puis le bœuf 5 min. Ajoute haricots rouges, tomates, 1 c. à café de cumin et de paprika, mijote 15 min. Sers avec le riz."],
   ["Couscous de poulet aux légumes", {poulet:130, semoule:200, poischiches:80, carotte:100, courgette:120, tomate:100, huile:8}, "Dore le poulet en morceaux, ajoute carottes, courgette, tomates, pois chiches et 1 c. à café de ras-el-hanout, couvre d'eau et mijote 20 min. Sers sur la semoule."],
   ["Sauté de porc aux carottes et riz", {porc:130, carotte:200, oignon:40, basmati:180, huile:8}, "Saisis le porc en morceaux, ajoute l'oignon et les carottes en rondelles, 15 cl d'eau, thym et laurier, mijote 20 min à couvert. Sers avec le riz."],
   ["Ratatouille, œuf poché et quinoa", {courgette:150, aubergine:120, poivron:100, tomate:150, oeuf:55, quinoa:160, huile:10}, "Fais revenir les légumes en dés 20 min avec ail et herbes de Provence. Poche l'œuf 3 min dans l'eau frémissante vinaigrée. Sers sur le quinoa."],
   ["Haricots rouges et riz à la créole", {hrouges:200, basmati:180, oignon:50, poivron:80, coco:40, huile:5}, "Fais revenir oignon et poivron, ajoute les haricots rouges, le lait de coco, thym et un peu de piment doux, mijote 10 min. Sers avec le riz."],
   ["Blanquette légère de dinde, champignons et riz", {dinde:130, champignons:150, carotte:100, creme:30, basmati:180}, "Fais mijoter la dinde en cubes avec carottes et champignons dans 30 cl de bouillon 20 min. Ajoute la crème hors du feu. Sers avec le riz."],
   ["Poulet basquaise et riz", {poulet:130, poivron:150, tomate:200, oignon:50, basmati:180, huile:8}, "Dore le poulet, ajoute oignon et poivrons en lanières 5 min, puis les tomates et 1 pincée de piment d'Espelette, mijote 20 min. Sers avec le riz."],
   ["Tajine de poulet, carottes et pois chiches, semoule", {poulet:130, carotte:150, poischiches:100, oignon:50, semoule:180, huile:8}, "Dore le poulet avec l'oignon, ajoute carottes, pois chiches, 1 c. à café de cumin, cannelle et curcuma, 20 cl d'eau, mijote 25 min. Sers avec la semoule."],
   ["Lentilles corail, carottes et cumin, pain complet", {lentilles:220, carotte:150, oignon:50, painc:60, huile:8}, "Fais revenir l'oignon, ajoute carottes, lentilles corail crues rincées (1/3 du poids indiqué), cumin et 3 fois leur volume d'eau, cuis 15 min jusqu'à ce que ce soit fondant. Sers avec le pain."],
   ["Bœuf aux légumes façon pot-au-feu express", {boeuf:130, pdt:200, carotte:120, poireau:100}, "Forme des boulettes avec le bœuf haché, plonge-les avec les légumes en morceaux dans un bouillon frémissant 20 min. Sers bien chaud avec le bouillon."]
  ].forEach(([n, ing, how], i) => add("plat", n, n.split(" ").slice(0, 2).join(" ").replace(/,$/, ""), 35, ing, [ "Prépare tous les ingrédients : épluche, émince et coupe en morceaux réguliers.", ...how.split(/(?<=\.) /), "Goûte et rectifie l'assaisonnement avant de servir."], "Plat idéal en batch cooking : double les quantités, il se garde 3 jours au frigo ou 2 mois au congélateur.", "Cocotte ou grande casserole, couteau, planche"));
  // F10. Poissons
  [["Cabillaud en papillote, tomates et courgettes, riz", {cabillaud:150, tomate:120, courgette:150, basmati:180, huile:8, citron:15}], ["Saumon en papillote aux poireaux, pommes de terre", {saumon:130, poireau:150, pdt:250, citron:15}], ["Sardines grillées, salade de pommes de terre", {sardines:100, pdt:250, salade:60, huile:8}], ["Crevettes à l'ail et persil, quinoa et brocoli", {crevettes:150, quinoa:180, brocoli:150, huile:10}], ["Cabillaud sauce vierge et semoule", {cabillaud:150, semoule:200, tomate:120, huile:12, citron:15}], ["Maquereau, pommes de terre et haricots verts", {maquereau:100, pdt:250, haricotsv:150, citron:10}]].forEach(([n, ing], i) => {
    const pap = n.includes("papillote");
    add("plat", n, n.split(" ")[0], 25, ing, pap ? ["Préchauffe le four à 200 °C.", "Cuis le féculent pendant ce temps.", "Pose le poisson sur une grande feuille de papier cuisson, entoure-le des légumes en fines lamelles, ajoute sel, poivre, citron et un filet d'huile.", "Ferme la papillote en roulant les bords et enfourne 15 min.", "Ouvre à table : la vapeur garde le poisson très moelleux."]
      : ["Cuis le féculent et les légumes.", "Fais cuire le poisson ou les crevettes à la poêle selon leur taille (3 à 6 min), avec ail et persil.", "Arrose de citron et d'un filet d'huile, et sers."],
      "Le poisson surgelé coûte 30 % moins cher et se cuit sans décongeler en papillote (ajoute 5 min).", "Four, papier cuisson, casserole, poêle");
  });
  // F11. Four et gratins
  [["Gratin de pâtes, jambon et brocoli", {patesb:200, jambon:60, brocoli:150, lait:100, emmental:25}], ["Hachis parmentier léger", {boeuf:120, pdt:300, lait:80, emmental:15}], ["Gratin de courgettes au bœuf et tomate", {boeuf:120, courgette:250, tomate:150, basmati:150, emmental:20}], ["Patate douce farcie haricots rouges, maïs et fromage", {patate:300, hrouges:120, mais:50, emmental:25}], ["Pommes de terre au four, cottage cheese et saumon fumé", {pdt:300, cottage:100, saumonf:50}], ["Pizza maison sur pita, jambon, champignons et mozzarella", {pita:130, tomate:80, jambon:50, champignons:60, mozza:50}], ["Pizza tortilla légumes grillés et mozzarella", {tortilla:120, tomate:80, courgette:80, poivron:60, mozza:60}], ["Croque-monsieur complet et salade", {painc:100, jambon:50, emmental:30, salade:80, huile:5}], ["Lasagnes express aux lentilles et épinards", {patesb:180, lentilles:150, epinards:120, tomate:150, mozza:40}], ["Gratin de chou-fleur et pommes de terre au jambon", {choufleur:200, pdt:200, jambon:60, lait:100, emmental:20}]].forEach(([n, ing]) => {
    add("plat", n, n.split(" ")[0], 35, ing, ["Préchauffe le four à 200 °C.", "Précuis ce qui doit l'être : pâtes ou pommes de terre à l'eau, viande à la poêle, légumes à la vapeur.", "Dispose le tout dans un plat (ou sur la base de pain), arrose de sauce ou de lait et parsème de fromage.", "Enfourne 15 à 20 min jusqu'à ce que ce soit gratiné et doré.", "Laisse reposer 3 min avant de servir."], "Le four travaille pendant que tu t'étires après ta course.", "Four, plat à gratin, casserole, poêle");
  });
  // F12. Soupes du soir
  [["Velouté de butternut et tartines au chèvre", {butternut:300, pdt:100, painc:60, chevre:30}], ["Soupe de légumes, œuf dur et pain complet", {legumes:300, pdt:100, oeuf:55, painc:60}], ["Minestrone aux haricots rouges et pâtes", {legumes:200, tomate:150, hrouges:100, patesb:80, parmesan:10}], ["Velouté de brocoli, jambon et pain", {brocoli:300, pdt:100, jambon:60, painb:60, creme:15}], ["Soupe de lentilles corail à la carotte et au cumin", {lentilles:200, carotte:150, oignon:40, painc:50, coco:30}]].forEach(([n, ing]) => {
    add("plat", n, n.split(" ")[0], 30, ing, ["Épluche et coupe les légumes en morceaux.", "Mets-les dans une casserole, couvre d'eau (ou de bouillon) juste à hauteur, sale et cuis 20 min.", "Mixe avec un mixeur plongeant (ou laisse en morceaux pour le minestrone).", "Ajoute le reste des ingrédients et sers bien chaud avec l'accompagnement."], "Une soupe le soir hydrate et se digère facilement : parfait pour bien dormir après l'entraînement.", "Grande casserole, mixeur plongeant");
  });
  // F13. Riz
  [["Risotto aux champignons et poulet", {arborio:200, champignons:150, poulet:110, parmesan:15, oignon:40, huile:8}, ["Fais revenir l'oignon émincé dans l'huile, ajoute le riz rond cru (1/3 du poids indiqué) et remue 1 min.", "Ajoute une louche de bouillon chaud, remue jusqu'à absorption, puis recommence pendant 18 min.", "Pendant ce temps, dore le poulet et les champignons à la poêle.", "Hors du feu, ajoute le parmesan, le poulet et les champignons."]],
   ["Paëlla express poulet, crevettes et petits pois", {basmati:200, poulet:80, crevettes:80, petitspois:80, poivron:80, huile:10}, ["Dore le poulet en morceaux dans une grande poêle, ajoute le poivron 3 min.", "Ajoute le riz cru (1/3 du poids indiqué), 1 c. à café de curcuma et paprika, puis 2,5 fois son volume de bouillon.", "Cuis 15 min sans remuer, ajoute crevettes et petits pois les 5 dernières minutes."]],
   ["Riz sauté aux crevettes et petits pois", {basmati:200, crevettes:120, petitspois:80, oeuf:55, soja:10, huile:10}, ["Utilise du riz cuit la veille.", "Fais sauter les crevettes 3 min à feu vif, puis les petits pois.", "Pousse sur le côté, brouille l'œuf, ajoute le riz et la sauce soja, mélange 3 min."]]
  ].forEach(([n, ing, st]) => add("plat", n, n.split(" ")[0], 25, ing, st, "Le riz cuit la veille donne le meilleur riz sauté : il ne colle pas.", "Grande poêle ou sauteuse, casserole"));

  // Arrondis des quantités (multiples de 5 g)
  out.forEach(r => Object.keys(r[5]).forEach(k => { r[5][k] = Math.max(5, Math.round(r[5][k]/5)*5); }));
  RECIPES.push(...out);
  window.TRACEO_RECIPES_COUNT = RECIPES.length;
})();
