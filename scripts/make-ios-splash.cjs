// Écrans de démarrage de l'app installée sur iPhone (« Sur l'écran d'accueil ») : sans eux, iOS affiche un écran blanc.
// Usage : node scripts/make-ios-splash.cjs   → icons/splash/*.png + les balises <link> à coller dans index.html
const path = require("path");
let chromium; try{ ({ chromium } = require("playwright")); }catch(e){ ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const OUT = path.join(__dirname, "../icons/splash");
// [largeur CSS, hauteur CSS, densité] des iPhone
const DEV = [[440,956,3],[402,874,3],[430,932,3],[393,852,3],[428,926,3],[390,844,3],[375,812,3],[414,896,3],[414,896,2],[375,667,2]];
const LOGO = `<path d="M7 23c0-8 5.5-14 11.5-14 4.6 0 7.5 2.9 7.5 6.6 0 3.8-3 6.6-6.8 6.6-2.8 0-4.7-1.9-4.7-4.2" fill="none" stroke="#25C98F" stroke-width="3.6" stroke-linecap="round"/><circle cx="7" cy="23" r="3.8" fill="#E6F2F0"/>`;
(async () => {
  const b = await chromium.launch(), tags = [];
  for(const [w, h, d] of DEV){
    const ctx = await b.newContext({viewport:{width:w, height:h}, deviceScaleFactor:d}), p = await ctx.newPage();
    const s = w*0.3;
    await p.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;background:radial-gradient(60% 40% at 50% 46%,#0F3B3A,#07131A 70%);display:grid;place-items:center">
      <svg width="${s}" height="${s}" viewBox="2 6 28 24" style="filter:drop-shadow(0 0 ${s/6}px rgba(37,201,143,.45))">${LOGO}</svg></body></html>`);
    const f = `splash-${w*d}x${h*d}.png`;
    await p.screenshot({path:path.join(OUT, f)}); await ctx.close();
    tags.push(`<link rel="apple-touch-startup-image" href="icons/splash/${f}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${d}) and (orientation: portrait)">`);
  }
  await b.close(); console.log(tags.join("\n"));
})();
