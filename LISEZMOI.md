# Traceo — l'app

Une boucle de course neuve à chaque sortie, depuis là où tu es.

1. **Localisation.** La personne se localise en un geste. L'app affiche son adresse exacte, partout en France, îles et outre-mer compris.
2. **Réglage.** Elle choisit une distance ou une durée, et son allure moyenne.
3. **Boucle sur les vraies rues.** Traceo compare 4 itinéraires et garde celui qui passe par des rues jamais proposées. La boucle de demain sera différente de celle d'aujourd'hui.
4. **Course guidée en direct.** Le nom des rues s'affiche, avec les virages annoncés à la voix, le chrono, la distance, l'allure et les calories.
5. **Bilan.** Durée, distance, allure moyenne et calories brûlées, puis envoi sur Strava ou Garmin, fichier GPX ou image à partager.

## Sur iPhone : l'app par un simple lien (recommandé)

L'app est en ligne sur **https://pierrernrd04-ai.github.io/traceo/**. GitHub Pages publie automatiquement la branche `main`.
1. Ouvre ce lien dans **Safari** sur l'iPhone.
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

## Encaisser avec PayPal

### Option rapide (celle utilisée) : lien de paiement à 4,99 €

Chaque paiement débloque Premium pour 31 jours. Les jours s'ajoutent si la personne reprend avant la fin, et un rappel s'affiche 3 jours avant l'échéance.
1. Dans ton compte PayPal, crée un **lien de paiement** « Traceo Premium – 31 jours » à 4,99 €.
2. Mets comme adresse de retour : `https://pierrernrd04-ai.github.io/traceo/?paiement=ok`.
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
