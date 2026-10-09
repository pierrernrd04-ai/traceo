// Réglages Traceo — c'est le seul fichier à modifier.
window.TRACEO_CONFIG = {
  // ---------- Version bêta ----------
  // true : tout est gratuit et illimité pour tout le monde (l'onglet Premium présente l'offre à venir).
  // false : Premium et le paiement s'activent.
  BETA: true,
  // Fin automatique de la bêta gratuite (heure de Paris). Après cette date, l'app est réservée aux abonnés Premium.
  BETA_END: "2026-10-10T15:00:00+02:00",

  // ---------- Carte et adresses ----------
  // Clé Google Maps Platform ("Map Tiles API" + "Places API (New)").
  // Avec elle : vrai fond Google Maps et recherche Google. Sans elle : carte OpenStreetMap
  // (toutes les rues et tous les lieux de France, outre-mer compris) et Base Adresse Nationale.
  GOOGLE_MAPS_KEY: "",
  // Sans clé Google : carte vectorielle MapLibre + OpenFreeMap (gratuite, illimitée, usage commercial autorisé).
  // MAP_STYLE: "raster" pour revenir à l'ancien fond CARTO.
  MAP_STYLE: "vector",
  MAP_STYLE_URL: "https://tiles.openfreemap.org/styles/dark",
  GEOCODER_FR: "https://data.geopf.fr/geocodage",   // Base Adresse Nationale (IGN), gratuite, sans clé
  GEOCODER: "https://photon.komoot.io/api/",        // lieux et territoires hors Base Adresse (OpenStreetMap)

  // ---------- Calcul des boucles ----------
  ORS_KEY: "",                                       // optionnel : openrouteservice.org (gratuit), ajoute le dénivelé
  OSRM_FOOT: "https://routing.openstreetmap.de/routed-foot",

  // ---------- Paiement Premium (l'argent arrive sur TON compte PayPal) ----------
  // Option 1, abonnement qui se renouvelle tout seul : Client ID + identifiant du plan PayPal.
  PAYPAL_CLIENT_ID: "",
  PAYPAL_PLAN_ID: "",
  // Option 2, la plus rapide : un lien de paiement PayPal à 4,99 € (Premium débloqué 31 jours).
  PAYPAL_PAYMENT_LINK: "https://www.paypal.com/ncp/payment/423Z9M8RCJPF2",
  PAYPAL_MANAGE_URL: "https://www.paypal.com/myaccount/autopay/",
  PAYMENT_API: "",
  // Chat IA (Claude) : adresse du serveur server/worker.js une fois déployé avec ta clé Anthropic,
  // ex. "https://traceo-api.<ton-compte>.workers.dev". Vide : le chat utilise l'assistant intégré.
  CHAT_API: "",                                   // optionnel : serveur de vérification (dossier server/)
  PRICE_LABEL: "4,99 €",

  // ---------- Statistiques de visite (cloud.umami.is, gratuit) ----------
  // Colle ici le « Website ID » de ton site Umami : visiteurs, temps passé, onglets, abonnements.
  UMAMI_ID: "",

  // ---------- Montres et applis ----------
  STRAVA_UPLOAD_URL: "https://www.strava.com/upload/select",
  GARMIN_IMPORT_ACTIVITY_URL: "https://connect.garmin.com/modern/import-data",
  GARMIN_COURSES_URL: "https://connect.garmin.com/modern/courses",

  FREE_PER_WEEK: 3,
  DEFAULT_PACE_S_PER_KM: 345,   // 5'45"/km
  DEFAULT_WEIGHT_KG: 70
};
