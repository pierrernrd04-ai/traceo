# Traceo — l'app

Une boucle de course neuve à chaque sortie, depuis là où tu es.

1. **Localisation.** La personne se localise en un geste. L'app affiche son adresse exacte, partout en France, îles et outre-mer compris.
2. **Réglage.** Elle choisit une distance ou une durée, et son allure moyenne.
3. **Boucle sur les vraies rues.** Traceo compare 4 itinéraires et garde celui qui passe par des rues jamais proposées. La boucle de demain sera différente de celle d'aujourd'hui.
4. **Course guidée en direct.** Le nom des rues s'affiche, avec les virages annoncés à la voix, le chrono, la distance, l'allure et les calories.
5. **Bilan.** Durée, distance, allure moyenne et calories brûlées, puis envoi sur Strava ou Garmin, fichier GPX ou image à partager.

## Les adresses du site

- **Page de vente** (à mettre sur Instagram) : https://pierrernrd04-ai.github.io/traceo/
- **L'app** : https://pierrernrd04-ai.github.io/traceo/app.html

Les liens de la page de vente ouvrent l'app. Une app déjà installée, le retour de PayPal (`?paiement=ok`) et le diagnostic (`?test`) passent directement dans l'app.

### Passer à traceo.io

Au 9 octobre 2026, `traceo.io` semblait libre, contrairement à `traceo.com`, `.fr` et `.app`.
1. Achète `traceo.io` chez un registraire : Porkbun, Namecheap ou Gandi, environ 35 à 60 € par an.
2. Dans la zone DNS du domaine, ajoute :
   - quatre enregistrements **A** pour `@` : `185.199.108.153`, `185.199.109.153`, `185.199.110.153` et `185.199.111.153` ;
   - un **CNAME** `www` vers `pierrernrd04-ai.github.io`.
3. Sur GitHub, ouvre le dépôt > **Settings** > **Pages** > **Custom domain**, saisis `traceo.io`, puis coche **Enforce HTTPS** quand GitHub le propose (quelques minutes à quelques heures).
4. Mets à jour l'adresse de retour du lien PayPal (`https://traceo.io/?paiement=ok`) et `og:url` / `og:image` dans `index.html`.

La page de vente est alors sur `traceo.io` et l'app sur `traceo.io/app.html`.

## Sur iPhone : l'app par un simple lien (recommandé)

L'app est en ligne sur **https://pierrernrd04-ai.github.io/traceo/app.html**. GitHub Pages publie automatiquement la branche `main`.
1. Ouvre ce lien dans **Safari** sur l'iPhone. La page de vente ouvre aussi l'app avec « Ouvrir l'app ».
2. Touche **Partager** (le carré avec la flèche), puis **« Sur l'écran d'accueil »**.
3. Traceo apparaît avec son icône et s'ouvre en plein écran, avec son écran de démarrage, comme une vraie app.

C'est gratuit, sans Mac et sans validation d'Apple. Chaque mise à jour du dépôt arrive toute seule chez les utilisateurs. Le paiement PayPal y est autorisé, contrairement à l'App Store (voir plus bas).

## Mettre l'app en ligne ailleurs (Cloudflare, 5 min)

La localisation, les cartes et PayPal ne marchent que sur une vraie adresse web en https. L'aperçu dans Claude les bloque tous.

1. Va sur **dash.cloudflare.com** et crée un compte gratuit.
2. Ouvre **Workers & Pages** > **Créer une application** > **Pages** > **Glisser-déposer vos fichiers**.
3. Nomme le projet `traceo`, puis envoie le fichier **traceo-app.zip** tel quel.
4. Touche **Déployer**. L'app est en ligne sur `https://traceo.pages.dev`.
5. Ouvre ce lien sur ton téléphone, touche « Me localiser » : c'est ta vraie position.

Pour mettre à jour l'app plus tard : Workers & Pages > traceo > Créer un déploiement, et renvoie le nouveau zip.

## Serveur Traceo : coach IA + Ensemble, depuis ton téléphone (10 min, gratuit)

Un seul serveur (Cloudflare Workers, offre gratuite) fait tourner **le coach IA du chat** et **Ensemble** (comptes coureurs, coureurs autour de soi, invitations, messages, notifications). Sans lui, le chat utilise le cerveau intégré (`chat-brain.js` : calculs, bilan, séance du jour, plans) et l'onglet Ensemble affiche « Ouverture imminente ».

1. **Cloudflare** (gratuit) : sur **dash.cloudflare.com**, crée un compte.
   - Ouvre **Workers & Pages** une fois et choisis ton sous-domaine `workers.dev`.
   - Copie ton **Account ID** (colonne de droite de la page d'accueil du compte).
   - Va dans **Mon profil > Jetons API > Créer un jeton**, choisis le modèle **« Modifier les Workers Cloudflare »** (Edit Cloudflare Workers). Pour l'IA gratuite, ajoute la permission **Compte > Workers AI > Modifier**. Copie le jeton.
2. **GitHub** : dans le dépôt `traceo`, ouvre **Settings > Secrets and variables > Actions > New repository secret** et crée :
   - `CLOUDFLARE_API_TOKEN` ;
   - `CLOUDFLARE_ACCOUNT_ID` ;
   - facultatif, `ANTHROPIC_API_KEY` (console.anthropic.com > API Keys) : le coach passe alors sur **Claude**, l'IA la plus fine. Sans cette clé, il utilise l'**IA gratuite de Cloudflare** (Llama 3.3, environ 10 000 « neurones » offerts par jour, soit quelques centaines de réponses).
3. Ouvre **Actions > Serveur (chat IA) > Run workflow**.

Le serveur se déploie, il est testé, et son adresse s'écrit toute seule dans `config.js` (`CHAT_API`). Deux minutes plus tard, le chat répond avec l'IA et Ensemble est ouvert à tous les abonnés Premium.

**Garde-fous** : 12 messages de chat par minute et par appareil ; 40 messages Ensemble par heure et par compte ; « Je pars courir » prévient au plus une fois toutes les 20 minutes. Positions arrondies à ~300 m, cachées après 3 h d'inactivité. Blocage, signalement (alerte instantanée sur ton canal ntfy) et suppression de compte intégrés. Si l'IA ne répond pas, le cerveau intégré prend le relais automatiquement.

**Notifications** : Android (Chrome) et ordinateur, directement. iPhone : à partir d'iOS 16.4, une fois Traceo ajouté à l'écran d'accueil.

## Informations légales

La page `legal.html` regroupe les mentions légales, les CGV, la politique de confidentialité et les cookies. Avant le lancement commercial, complète les mentions surlignées en jaune :
- ton **SIREN/SIRET** ;
- ton **adresse** ;
- la **mention TVA** (par exemple « TVA non applicable, art. 293 B du CGI » si tu es en franchise en base) ;
- le **médiateur de la consommation**, obligatoire pour la vente aux particuliers.

## Encaisser avec PayPal

### Option rapide (celle utilisée) : lien de paiement à 4,99 €

Chaque paiement débloque Premium pour 31 jours. Les jours s'ajoutent si la personne reprend avant la fin, et un rappel s'affiche 3 jours avant l'échéance.
1. Dans ton compte PayPal, crée un **lien de paiement** « Traceo Premium – 31 jours » à 4,99 €.
2. Mets comme adresse de retour : `https://pierrernrd04-ai.github.io/traceo/app.html?paiement=ok`.
3. Colle le lien (`https://www.paypal.com/ncp/payment/PLB-…`) dans `PAYPAL_PAYMENT_LINK` de `config.js`, puis pousse sur `main`.

Si PayPal renvoie la personne dans Safari plutôt que dans l'app de l'écran d'accueil, l'onglet Premium de l'app propose « J'ai payé, activer Premium ». Ce bouton n'apparaît que pendant 2 h après le clic sur « Payer avec PayPal ».

Limite : ce mode fonctionne sur la confiance. L'app ne peut pas vérifier elle-même le paiement auprès de PayPal. Pour une vérification stricte, passe à l'abonnement ci-dessous, contrôlé par le serveur.

### Option abonnement : renouvellement automatique chaque mois

1. Il te faut un compte PayPal Business.
2. Sur developer.paypal.com > Apps & Credentials, en mode **Live**, crée une app et copie le **Client ID**.
3. Sur paypal.com, crée un plan d'abonnement à 4,99 €/mois et copie son identifiant `P-…`.
4. Renseigne `PAYPAL_CLIENT_ID` et `PAYPAL_PLAN_ID` dans `config.js`.
5. Conseillé : le serveur `server/worker.js` (Cloudflare Workers, gratuit) vérifie chaque abonnement auprès de PayPal. Ajoute-lui ces variables :
   - `PAYPAL_CLIENT_ID` ;
   - `PAYPAL_SECRET` ;
   - `PAYPAL_PLAN_ID` ;
   - `PAYPAL_ENV=live` ;
   - `APP_ORIGIN=https://traceo.pages.dev`.

   Déploiement : `cd server && npx wrangler deploy`, puis `npx wrangler secret put PAYPAL_SECRET`.
   Mets ensuite l'adresse du worker (`https://traceo-pay.<ton-compte>.workers.dev`) dans `PAYMENT_API`.

## Carte et adresses

- **Sans clé**, l'app utilise la Base Adresse Nationale de l'IGN pour toutes les adresses officielles de France et des DROM. Elle utilise OpenStreetMap pour les autres territoires, les lieux et le fond de carte avec tous les noms de rues.
- **Pour le fond et la recherche Google Maps**, colle une clé Google Maps Platform dans `GOOGLE_MAPS_KEY`. La clé doit avoir « Map Tiles API » et « Places API (New) » activées, et la facturation activée sur Google Cloud.
- **Pour un usage intensif**, prends une clé openrouteservice dans `ORS_KEY` : les boucles seront aussi calculées avec le dénivelé.

## L'app Android et iPhone

Le même code est emballé en vraie application avec **Capacitor** (dossiers `android/` et `ios/`).
Dans l'app, Traceo utilise directement le téléphone :
- la synthèse vocale pour annoncer les virages ;
- l'écran qui reste allumé pendant la course ;
- la feuille de partage pour envoyer les fichiers GPX et les images vers Strava, Garmin Connect, Fichiers ou WhatsApp.

### Installer l'APK sur ton téléphone Android (sans ordinateur)

À chaque mise à jour, GitHub construit l'app tout seul (onglet **Actions** > « App Android »).
1. Ouvre `https://github.com/pierrernrd04-ai/traceo/releases/tag/android-latest` sur ton téléphone. La release est mise à jour à chaque push sur `main`.
2. Touche **traceo.apk**, puis autorise l'installation depuis ton navigateur.

Pour une autre branche, ouvre le build dans **Actions** et télécharge l'artefact `traceo-apk`.

### Travailler sur l'app depuis un ordinateur

```
npm install
npm run android        # copie l'app web dans www/ et ouvre Android Studio
npm run ios            # idem pour Xcode (Mac uniquement)
npm run apk            # APK de test sans Android Studio (SDK Android requis)
```

Après chaque modification de `app.js`, `styles.css` ou `config.js`, lance `npm run sync`. Les icônes se régénèrent avec `node scripts/make-icons.cjs`.

### Publier sur le Google Play Store

1. Crée une clé de signature, une seule fois, et garde-la précieusement :
   `keytool -genkey -v -keystore traceo.jks -alias traceo -keyalg RSA -keysize 2048 -validity 10000`
2. Dans GitHub > Settings > Secrets and variables > Actions, ajoute ces secrets :
   - `ANDROID_KEYSTORE_BASE64` : le résultat de `base64 -w0 traceo.jks` ;
   - `ANDROID_KEYSTORE_PASSWORD` ;
   - `ANDROID_KEY_ALIAS` (`traceo`) ;
   - `ANDROID_KEY_PASSWORD`.
3. Le build fournit alors l'artefact `traceo-play-store` (`.aab` signé) à envoyer dans la Play Console (25 $ une fois).

L'identifiant de l'app est `fr.traceo.app`. Tu peux le changer dans `capacitor.config.json` et `android/app/build.gradle`, mais seulement **avant** la première publication.

### Publier sur l'App Store

Il faut un Mac avec Xcode et un compte Apple Developer (99 €/an). Lance `npm run ios`, choisis ton équipe dans **Signing & Capabilities**, puis **Product > Archive**.

**Attention :** Apple refuse les apps de l'App Store qui vendent un abonnement numérique par PayPal (règle 3.1.1). La version App Store devrait passer par l'achat intégré d'Apple (15 à 30 % de commission), par exemple avec RevenueCat. Pour garder PayPal, utilise le lien web ci-dessus. Pour faire tester l'app native à quelques personnes sans publication, utilise **TestFlight**, depuis le même compte Apple Developer.

### À savoir pour la version app

- **Paiement :** pour un abonnement vendu *dans* une app des stores, Apple et Google imposent leur propre système de paiement. L'APK installé directement et le lien web peuvent utiliser PayPal. Dans l'app native, le lien PayPal s'ouvre dans le navigateur intégré. Au retour, on active Premium avec « J'ai payé, activer Premium ».
- **Écran verrouillé :** l'écran reste allumé pendant la course. Si on le verrouille, le suivi GPS se met en pause jusqu'au retour dans l'app.
