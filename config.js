// Partage entre téléphones (Firebase). Laisser à null tant que la base n'est pas créée :
// l'appli enregistre alors tout sur le téléphone.
// Une fois le projet Firebase créé, coller ici l'objet « firebaseConfig » donné par Firebase.
window.PARCOURS_FIREBASE = null;

// Coach IA : adresse du relais Cloudflare (dossier coach-relais/), qui garde la clé Groq secrète.
// null = coach IA pas encore branché (les recommandations calculées marchent quand même).
window.PARCOURS_COACH_URL = "https://parcours-coach.remyvancoppenolle.workers.dev";
