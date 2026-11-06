// Partage entre téléphones (Firebase). Laisser à null tant que la base n'est pas créée :
// l'appli enregistre alors tout sur le téléphone.
// Une fois le projet Firebase créé, coller ici l'objet « firebaseConfig » donné par Firebase.
window.PARCOURS_FIREBASE = {
  "projectId": "parcours-gpx-2027",
  "appId": "1:1087194002361:web:00288d8c544baa128bbc68",
  "storageBucket": "parcours-gpx-2027.firebasestorage.app",
  "apiKey": "AIzaSyDwb_C6B_LDUCgiY_r6ljIChmZzo_9dkJ8",
  "authDomain": "parcours-gpx-2027.firebaseapp.com",
  "messagingSenderId": "1087194002361"
};

// Coach IA : adresse du relais Cloudflare (dossier coach-relais/), qui garde la clé Groq secrète.
// null = coach IA pas encore branché (les recommandations calculées marchent quand même).
window.PARCOURS_COACH_URL = "https://parcours-coach.remyvancoppenolle.workers.dev";
