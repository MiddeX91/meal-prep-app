
  const firebaseConfig = {
    apiKey: "AIzaSyAdW2TO2Z7lEalZ_hpdZQSoSD1ANiGYhQ0",
    authDomain: "meal-prep-planer-app.firebaseapp.com",
    projectId: "meal-prep-planer-app",
    storageBucket: "meal-prep-planer-app.firebasestorage.app",
    messagingSenderId: "488372391070",
    appId: "1:488372391070:web:e57ee72bfe8779247f7f8f",
    measurementId: "G-8KYYGQCNYF"
  };

 try {
  // Firebase initialisieren
  const app = firebase.initializeApp(firebaseConfig);
  
  // Den Firestore-Dienst holen
  window.db = firebase.firestore();
  
  console.log("✅ Firebase wurde erfolgreich initialisiert und 'db' ist bereit.");

} catch (error) {
  console.error("❌ FATALER FEHLER in firebase-init.js:", error);
  alert("Firebase konnte nicht initialisiert werden. Prüfe die Konsole (F12) und deine firebaseConfig-Daten.");
}