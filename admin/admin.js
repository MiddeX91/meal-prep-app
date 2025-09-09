import { initDatabasePage } from './admin-database.js';
import { initGeneratorPage } from './admin-generator.js';

document.addEventListener('DOMContentLoaded', () => {
    const db = firebase.firestore();
    const functions = firebase.functions();
    const statusDiv = document.getElementById('status-main');

    firebase.auth().signInAnonymously()
        .then(() => {
            if (statusDiv) statusDiv.textContent = '✅ Anonym angemeldet. Bereit für Aktionen.';
        })
        .catch((error) => {
            if (statusDiv) statusDiv.textContent = `❌ Fehler bei der anonymen Anmeldung: ${error.message}`;
            console.error("Anmeldefehler:", error);
        });

    const navLinks = document.querySelectorAll('nav a');
    const pages = document.querySelectorAll('.page');

    const pageInitializers = {
        'database': initDatabasePage,
        'generator': initGeneratorPage,
    };

    function navigateTo(pageId) {
        // Schaltet nur noch die 'active'-Klasse um
        pages.forEach(page => {
            page.classList.toggle('active', page.id === `page-${pageId}`);
        });
        navLinks.forEach(link => {
            link.classList.toggle('active', link.dataset.page === pageId);
        });

        const initFunc = pageInitializers[pageId];
        const pageElement = document.getElementById(`page-${pageId}`);
        
        if (initFunc && pageElement && !pageElement.hasAttribute('data-initialized')) {
            initFunc(db, functions, pageElement);
            pageElement.setAttribute('data-initialized', 'true');
        }
    }

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = e.target.dataset.page;
            navigateTo(pageId);
        });
    });
    
    // Initialisiere die Logik für die bereits sichtbare 'database'-Seite
    navigateTo('database');
});

