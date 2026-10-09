# Traceo — l'app

Une boucle de course neuve à chaque sortie, depuis là où tu es.

1. **Localisation.** La personne se localise en un geste. L'app affiche son adresse exacte, partout en France, îles et outre-mer compris.
2. **Réglage.** Elle choisit une distance ou une durée, et son allure moyenne.
3. **Boucle sur les vraies rues.** Traceo compare 4 itinéraires et garde celui qui passe par des rues jamais proposées. La boucle de demain sera différente de celle d'aujourd'hui.
4. **Course guidée en direct.** Le nom des rues s'affiche, avec les virages annoncés à la voix, le chrono, la distance, l'allure et les calories.
5. **Bilan.** Durée, distance, allure moyenne et calories brûlées, puis envoi sur Strava ou Garmin, fichier GPX ou image à partager.

## Mettre l'app en ligne depuis ton téléphone (5 min)

La localisation, les cartes et PayPal ne marchent que sur une vraie adresse web en https. L'aperçu dans Claude les bloque tous.

1. Va sur **dash.cloudflare.com** et crée un compte gratuit.
2. Ouvre **Workers & Pages** > **Créer une application** > **Pages** > **Glisser-déposer vos fichiers**.
3. Nomme le projet `traceo`, puis envoie le fichier **traceo-app.zip** tel quel.
4. Touche **Déployer**. L'app est en ligne sur `https://traceo.pages.dev`.
5. Ouvre ce lien sur ton téléphone, touche « Me localiser » : c'est ta vraie position.

Pour mettre à jour l'app plus tard : Workers & Pages > traceo > Créer un déploiement, et renvoie le nouveau zip.

## Encaisser avec PayPal

### Option rapide : lien de paiement à 4,99 €

Le lien débloque Premium 31 jours.
1. Dans ton compte PayPal, crée un **lien de paiement** « Traceo Premium – 1 mois » à 4,99 €.
2. Mets comme adresse de retour : `https://traceo.pages.dev/?paiement=ok`.
3. Colle le lien dans `PAYPAL_PAYMENT_LINK` de `config.js`, puis redéploie.

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

### À savoir pour la version app

- **Paiement :** pour un abonnement vendu *dans* l'app, Apple et Google imposent en général leur propre système de paiement. Tant que `BETA: true`, tout est gratuit et la question ne se pose pas. Avant de passer `BETA: false` dans l'app, il faudra brancher Google Play Billing et l'achat intégré Apple, par exemple avec RevenueCat. Le lien PayPal ouvre le navigateur et le retour `?paiement=ok` arrive sur le site web, pas dans l'app.
- **Spotify :** la connexion Spotify revient sur le site web, pas dans l'app. La musique reste pilotable depuis l'app Spotify.
- **Écran verrouillé :** l'écran reste allumé pendant la course. Si on le verrouille, le suivi GPS se met en pause jusqu'au retour dans l'app.
