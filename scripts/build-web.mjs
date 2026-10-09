// Copie l'app web (racine du dépôt) dans www/, le dossier que Capacitor emballe dans l'app native.
// Le site GitHub Pages continue de servir la racine : rien ne change pour la version web.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "www");
const FILES = ["index.html", "styles.css", "app.js", "native.js", "config.js", "sw.js", "manifest.webmanifest", "icons"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of FILES) cpSync(join(root, f), join(out, f), { recursive: true });
console.log(`www/ prêt (${FILES.length} éléments)`);
