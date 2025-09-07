// Importiere die Initialisierungs-Funktionen aus den Modulen
import { initDatabasePage } from './admin-database.js';
import { initGeneratorPage } from './admin-generator.js';

document.addEventListener('DOMContentLoaded', async () => {

    // === AUTHENTIFIZIERUNG ===
    try {
        await firebase.auth().signInAnonymously();
        console.log('✅ Anonym angemeldet. Bereit für Aktionen.');
    } catch (error) {
        console.error("❌ Fehler bei der anonymen Anmeldung:", error);
        alert('Fehler bei der Firebase-Anmeldung. Das Admin-Panel wird nicht funktionieren.');
        return;
    }

    // === FIREBASE-VERKNÜPFUNGEN (werden an Module weitergegeben) ===
    const db = firebase.firestore();
    const functions = firebase.functions();

    // === NAVIGATIONSLOGIK ===
    const navLinks = document.querySelectorAll('.admin-nav a');
    const pages = document.querySelectorAll('.admin-page');

    function navigateTo(hash) {
        const targetHash = hash || '#database'; // Standardseite
        
        pages.forEach(page => {
            const pageId = `page-${targetHash.substring(1)}`;
            if (page.id === pageId) {
                page.classList.add('active');
                // Rufe die passende Initialisierungs-Funktion für die aktive Seite auf
                if (page.id === 'page-database') {
                    initDatabasePage(db, functions);
                } else if (page.id === 'page-generator') {
                    initGeneratorPage(db, functions);
                }
            } else {
                page.classList.remove('active');
            }
        });

        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === targetHash);
        });
    }

    window.addEventListener('hashchange', () => navigateTo(window.location.hash));
    navigateTo(window.location.hash); // Initiale Navigation beim Laden
});

