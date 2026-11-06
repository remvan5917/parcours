# Parcours d'habileté motrice

Appli (PWA) de préparation aux épreuves sportives du concours de gardien de la paix :
chrono du parcours atelier par atelier, Luc Léger avec les bips, fiches des 10 ateliers
(au concours, recréés à Fitness Park, exercices au club de gym), plan jusqu'au concours, progression.

En ligne : https://remvan5917.github.io/parcours/

## Fichiers
- `index.html` : toute l'appli.
- `config.js` : branchement du partage entre téléphones (Firebase). `null` = tout reste sur le téléphone.
- `sw.js` : marche sans réseau. Changer `CACHE` (parcours-v2, v3…) à chaque nouvelle version.
- `manifest.webmanifest`, `icons/` : installation sur l'écran d'accueil.

## Activer le partage entre téléphones (Firebase, gratuit)
1. https://console.firebase.google.com → « Créer un projet » (Google Analytics : inutile).
2. Dans le projet : « Créer » › « Firestore Database » › « Créer une base de données », région `eur3 (europe-west)`, mode production.
3. Onglet « Règles » de Firestore : coller les règles ci-dessous, « Publier ».
4. Roue dentée › « Paramètres du projet » › « Vos applications » › icône `</>` (Web), nom « Parcours », sans Hosting.
   Copier l'objet `firebaseConfig` et le coller dans `config.js` à la place de `null`.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /equipes/{code}/{coll}/{doc} {
      allow read, write: if code.size() >= 20
        && coll in ['essais', 'mesures', 'luc', 'reglages'];
    }
  }
}
```

Les données d'une équipe sont rangées sous un code secret de 24 caractères (créé par « Activer le partage »).
Seuls les téléphones qui ont le lien avec ce code les voient.

## Sources
Descriptif officiel des épreuves sportives 2025 (police nationale) et arrêté du 5 mars 2025.

## Coach IA (Groq, clé gardée sur Cloudflare)
La clé Groq n'est jamais dans l'appli (le dépôt est public) : elle est gardée par un petit relais Cloudflare, dossier `coach-relais/`.
Dans un terminal :
```
cd ~/parcours/coach-relais
npx wrangler login
npx wrangler deploy
npx wrangler secret put GROQ_API_KEY
```
`deploy` affiche l'adresse du relais (https://parcours-coach.<ton-sous-domaine>.workers.dev) : la mettre dans `config.js` (`PARCOURS_COACH_URL`).
Le relais n'accepte que les demandes venant de https://remvan5917.github.io et limite à 40 questions par 10 minutes.
Sans relais, l'onglet Coach donne quand même des priorités calculées à partir des résultats.
