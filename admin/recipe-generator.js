document.addEventListener('DOMContentLoaded', async () => {

    // === AUTHENTIFIZIERUNG (Wichtig für Datenbankzugriff) ===
    try {
        await firebase.auth().signInAnonymously();
        console.log('Anonym angemeldet.');
    } catch (error) {
        console.error("Anmeldefehler:", error);
        alert('Fehler bei der Firebase-Anmeldung. Die App wird nicht funktionieren.');
        return;
    }

    // === FIREBASE-VERKNÜPFUNGEN ===
    const db = firebase.firestore();
    const functions = firebase.functions();

    // === GLOBALE VARIABLEN & CACHES ===
    let zutatenLexikonCache = new Map();

    // === DOM-ELEMENTE (Briefing) ===
    const recipeDescription = document.getElementById('recipe-description');
    const tagCheckboxes = document.querySelectorAll('.checkbox-group input[type="checkbox"]');
    const caloriesTarget = document.getElementById('calories-target');
    const generateBtn = document.getElementById('generate-btn');
    const loader = document.getElementById('loader');

    // === DOM-ELEMENTE (Editor) ===
    const editorSection = document.getElementById('editor-section');
    const editTitle = document.getElementById('edit-title');
    const editArt = document.getElementById('edit-art');
    const editHaltbarkeit = document.getElementById('edit-haltbarkeit');
    const editZubereitung = document.getElementById('edit-zubereitung');
    const ingredientsContainer = document.getElementById('ingredients-container');
    const checkNutritionBtn = document.getElementById('check-nutrition-btn');
    const nutritionResults = document.getElementById('nutrition-results');
    const saveBtn = document.getElementById('save-btn');
    const regenerateBtn = document.getElementById('regenerate-btn');

    // === INITIALISIERUNG ===
    async function loadLexikonCache() {
        const snapshot = await db.collection('zutatenLexikon').get();
        snapshot.forEach(doc => {
            zutatenLexikonCache.set(doc.data().name.toLowerCase(), doc.data());
        });
        console.log(`Zutatenlexikon-Cache mit ${zutatenLexikonCache.size} Einträgen geladen.`);
    }

    await loadLexikonCache(); // Lade das Lexikon beim Start

    // === EVENT LISTENER ===
    generateBtn.addEventListener('click', handleGenerateRecipe);
    regenerateBtn.addEventListener('click', handleGenerateRecipe);
    checkNutritionBtn.addEventListener('click', handleCheckNutrition);
    saveBtn.addEventListener('click', handleSaveRecipe);


    // === FUNKTIONEN (Implementiert) ===

    async function handleGenerateRecipe() {
        if (!recipeDescription.value) {
            alert('Bitte beschreibe dein Wunsch-Rezept.');
            return;
        }

        // 1. UI vorbereiten
        editorSection.style.display = 'none';
        loader.style.display = 'block';
        nutritionResults.innerHTML = ''; // Alte Nährwerte zurücksetzen

        // 2. Daten aus dem Formular sammeln
        const description = recipeDescription.value;
        const calories = parseInt(caloriesTarget.value, 10) || 500;
        const tags = Array.from(tagCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        try {
            // 3. Cloud Function aufrufen
            const generateIdea = functions.httpsCallable('generateRecipeIdea');
            const result = await generateIdea({ description, tags, calories });
            
            // 4. Editor mit den Daten von Gemini füllen
            populateEditor(result.data);

        } catch (error) {
            console.error("Fehler beim Generieren des Rezepts:", error);
            alert(`Ein Fehler ist aufgetreten: ${error.message}`);
        } finally {
            // 5. UI finalisieren
            loader.style.display = 'none';
            editorSection.style.display = 'block';
        }
    }
    
    // --- HILFSFUNKTIONEN für handleGenerateRecipe ---

    function populateEditor(data) {
        editTitle.value = data.titel || '';
        editArt.value = data.art || 'Mahlzeit';
        editHaltbarkeit.value = data.haltbarkeit || 3;
        editZubereitung.value = data.zubereitung || '';
        
        renderIngredients(data.zutaten || []);
    }

    function renderIngredients(ingredients) {
        ingredientsContainer.innerHTML = ''; // Vorherige Liste leeren
        ingredients.forEach(ingredient => {
            const row = document.createElement('div');
            row.className = 'ingredient-row';

            const correctedName = findBestLexikonMatch(ingredient.name);

            row.innerHTML = `
                <input type="text" value="${ingredient.menge_einheit}" placeholder="Menge & Einheit">
                <input type="text" value="${correctedName}" placeholder="Zutat">
                <button class="delete-ingredient-btn">×</button>
            `;
            ingredientsContainer.appendChild(row);
        });
    }

    function findBestLexikonMatch(ingredientName) {
        const lowerCaseName = ingredientName.toLowerCase();
        // 1. Exakter Treffer
        if (zutatenLexikonCache.has(lowerCaseName)) {
            return zutatenLexikonCache.get(lowerCaseName).name;
        }
        // 2. Versuch, einen ähnlichen Treffer zu finden (einfache Logik)
        for (const [key, value] of zutatenLexikonCache.entries()) {
            if (key.includes(lowerCaseName.split(' ')[0])) { // Vergleicht das erste Wort
                return value.name; // Gib den korrekten Namen aus dem Lexikon zurück
            }
        }
        return ingredientName; // Kein Treffer, gib Original zurück
    }

    // --- PLATZHALTER für die nächsten Schritte ---

    async function handleCheckNutrition() {
        console.log('handleCheckNutrition wurde aufgerufen');
        // Hier kommt die Logik zum Prüfen/Abfragen der Nährwerte
    }

    async function handleSaveRecipe() {
        console.log('handleSaveRecipe wurde aufgerufen');
        // Hier kommt die Logik zum Speichern in Firestore
    }

});

