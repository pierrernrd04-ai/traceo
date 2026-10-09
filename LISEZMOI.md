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

   Mets ensuite l'adresse du worker dans `PAYMENT_API`.

## Carte et adresses

- **Sans clé**, l'app utilise la Base Adresse Nationale de l'IGN pour toutes les adresses officielles de France et des DROM. Elle utilise OpenStreetMap pour les autres territoires, les lieux et le fond de carte avec tous les noms de rues.
- **Pour le fond et la recherche Google Maps**, colle une clé Google Maps Platform dans `GOOGLE_MAPS_KEY`. La clé doit avoir « Map Tiles API » et « Places API (New) » activées, et la facturation activée sur Google Cloud.
- **Pour un usage intensif**, prends une clé openrouteservice dans `ORS_KEY` : les boucles seront aussi calculées avec le dénivelé.

## App Store et Google Play (étape suivante)

L'app s'emballe avec Capacitor. Pour les abonnements vendus dans l'App Store ou Google Play, Apple et Google imposent en général leur propre système de paiement. On choisira la bonne formule au moment de la publication.
