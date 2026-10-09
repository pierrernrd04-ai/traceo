// Génère les icônes et écrans de démarrage Android / iOS depuis le logo vectoriel de Traceo.
// Usage : node scripts/make-icons.cjs   (nécessite Playwright + Chromium)
const path = require("path");
let chromium; try{ ({ chromium } = require("playwright")); }catch(e){ ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const ROOT = path.join(__dirname, ".."), RES = path.join(ROOT, "android/app/src/main/res");
const BG = "#07131A", LOGO = `<path d="M7 23c0-8 5.5-14 11.5-14 4.6 0 7.5 2.9 7.5 6.6 0 3.8-3 6.6-6.8 6.6-2.8 0-4.7-1.9-4.7-4.2" fill="none" stroke="#25C98F" stroke-width="3.6" stroke-linecap="round"/><circle cx="7" cy="23" r="3.8" fill="#E6F2F0"/>`;
// Boîte du logo dans son repère 32×32 : x 3,2→27,8 ; y 7,2→26,8
const CX = 15.5, CY = 17;
// f = part de la largeur occupée par le logo ; shape = square | round | rounded | none (fond transparent)
function svg(w, h, f, shape){
  const span = 24.6 / f, vw = span, vh = span * h / w;
  const bg = shape === "none" ? "" :
    shape === "round" ? `<circle cx="${CX}" cy="${CY}" r="${vw/2}" fill="${BG}"/>` :
    shape === "rounded" ? `<rect x="${CX - vw/2}" y="${CY - vh/2}" width="${vw}" height="${vh}" rx="${vw*0.18}" fill="${BG}"/>` :
    `<rect x="${CX - vw/2}" y="${CY - vh/2}" width="${vw}" height="${vh}" fill="${BG}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${CX - vw/2} ${CY - vh/2} ${vw} ${vh}">${bg}${LOGO}</svg>`;
}
const D = { mdpi:1, hdpi:1.5, xhdpi:2, xxhdpi:3, xxxhdpi:4 };
const jobs = [];
for(const [d, k] of Object.entries(D)){
  jobs.push([`mipmap-${d}/ic_launcher.png`, 48*k, 48*k, .56, "rounded"]);
  jobs.push([`mipmap-${d}/ic_launcher_round.png`, 48*k, 48*k, .5, "round"]);
  jobs.push([`mipmap-${d}/ic_launcher_foreground.png`, 108*k, 108*k, .42, "none"]);   // zone sûre adaptative : 66/108
}
const SPL = { "drawable/splash.png":[480,320], "drawable-land-mdpi/splash.png":[480,320], "drawable-land-hdpi/splash.png":[800,480], "drawable-land-xhdpi/splash.png":[1280,720], "drawable-land-xxhdpi/splash.png":[1600,960], "drawable-land-xxxhdpi/splash.png":[1920,1280],
  "drawable-port-mdpi/splash.png":[320,480], "drawable-port-hdpi/splash.png":[480,800], "drawable-port-xhdpi/splash.png":[720,1280], "drawable-port-xxhdpi/splash.png":[960,1600], "drawable-port-xxxhdpi/splash.png":[1280,1920] };
for(const [f, [w, h]] of Object.entries(SPL)) jobs.push([f, w, h, .28 * Math.min(w, h) / w, "square"]);
const abs = [...jobs.map(([f, ...r]) => [path.join(RES, f), ...r]),
  [path.join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"), 1024, 1024, .56, "square"],
  ...["", "-1", "-2"].map(s => [path.join(ROOT, `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732${s}.png`), 2732, 2732, .2, "square"]),
  [path.join(ROOT, "resources/icon-1024.png"), 1024, 1024, .56, "square"]];
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  for(const [out, w, h, f, shape] of abs){
    await p.setViewportSize({ width:w, height:h });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(w, h, f, shape)}</body></html>`);
    await p.locator("svg").screenshot({ path:out, omitBackground:true });
  }
  await b.close(); console.log(`${abs.length} images générées`);
})();
