// === DOM-ELEMENTE ===
const fileInput = document.getElementById('json-file-input');
const uploadButton = document.getElementById('upload-button');
const fixMiscButton = document.getElementById('fix-misc-btn');
const enrichLexikonButton = document.getElementById('enrich-lexikon-btn');
const statusDiv = document.getElementById('status');

// === HILFSFUNKTIONEN ===
function setButtonsDisabled(disabled) {
    uploadButton.disabled = disabled;
    fixMiscButton.disabled = disabled;
    enrichLexikonButton.disabled = disabled;
}

const delay = ms => new Promise(res => setTimeout(res, ms));

// === EVENT LISTENER ===
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
        uploadButton.disabled = true;
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const dataFromFile = JSON.parse(e.target.result);
            statusDiv.textContent = `${dataFromFile.length} Einträge in Datei gefunden. Bereit zum Verarbeiten.`;
            uploadButton.disabled = false;
        } catch (error) {
            statusDiv.textContent = `Fehler: Ungültige JSON-Datei.\n${error}`;
            uploadButton.disabled = true;
        }
    };
    reader.readAsText(file);
});

enrichLexikonButton.addEventListener('click', () => {
    processMaintenance('anreichern');
});

fixMiscButton.addEventListener('click', () => {
    processMaintenance('Sonstiges');
});

uploadButton.addEventListener('click', () => {
     alert("Dieser Button ist für das Hochladen von kompletten Rezepten vorgesehen. Diese Funktion wird später implementiert.");
});


/**
 * Hauptfunktion für Wartungsarbeiten ("Sonstiges" & "Anreichern").
 */
async function processMaintenance(mode) {
    const modeText = mode === 'Sonstiges' ? '"Sonstiges" aufräumen' : 'Lexikon anreichern';
    statusDiv.textContent = `Starte Prozess: "${modeText}"...\nSuche nach relevanten Einträgen...`;
    setButtonsDisabled(true);

    try {
        const snapshot = await db.collection('zutatenLexikon').get();
        let itemsToProcess = [];

        if (mode === 'Sonstiges') {
            itemsToProcess = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => item.kategorie === 'Sonstiges');
        } else { // Modus 'anreichern'
            itemsToProcess = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => !item.nährwerte_pro_100g);
        }

        if (itemsToProcess.length === 0) {
            statusDiv.textContent += '\nKeine relevanten Einträge gefunden.';
            setButtonsDisabled(false);
            return;
        }

        statusDiv.textContent += `\n${itemsToProcess.length} Einträge gefunden. Starte Verarbeitung...\n---`;
        
        let successCount = 0;
        let errorCount = 0;
        for (const item of itemsToProcess) {
            const success = await processSingleIngredient(item.name);
            if (success) {
                successCount++;
            } else {
                errorCount++;
            }
        }
        statusDiv.textContent += `\n---\n🎉 Prozess für "${modeText}" abgeschlossen!\nErfolgreich: ${successCount} | Fehlgeschlagen: ${errorCount}`;

    } catch (error) {
        statusDiv.textContent += `\n❌ Schwerwiegender Fehler im Hauptprozess: ${error.message}`;
        console.error("Schwerwiegender Fehler: ", error);
    } finally {
        setButtonsDisabled(false);
    }
}


/**
 * Verarbeitet EINE Zutat Schritt für Schritt und ruft die einzelnen Cloud Functions auf.
 * Enthält die Retry-Logik für die Edamam-Anfrage.
 * @param {string} ingredientName - Der Name der zu verarbeitenden Zutat.
 * @returns {Promise<boolean>} - True bei Erfolg, False bei Fehler.
 */
async function processSingleIngredient(ingredientName) {
    statusDiv.textContent += `\n\n➡️ Verarbeite "${ingredientName}"...`;
    
    try {
        // --- SCHRITT 1: Kategorie von Gemini holen ---
        statusDiv.textContent += `\n   - Frage Kategorie an...`;
        const getCategoryFunction = firebase.functions().httpsCallable('getIngredientCategory');
        const categoryResponse = await getCategoryFunction({ ingredientName });
        const category = categoryResponse.data.category;
        statusDiv.textContent += ` -> ${category}`;

        // --- SCHRITT 2: Englische Übersetzung von Gemini holen ---
        statusDiv.textContent += `\n   - Frage Übersetzung an...`;
        const translateFunction = firebase.functions().httpsCallable('translateIngredient');
        const translateResponse = await translateFunction({ ingredientName });
        const englishName = translateResponse.data.translation;
        statusDiv.textContent += ` -> ${englishName}`;

        // --- SCHRITT 3: Nährwerte von Edamam holen (mit Retry-Logik) ---
        const MAX_RETRIES = 6;
        const RETRY_DELAY = 10000; // 10 Sekunden
        let edamamData = null;
        let attempt = 0;
        let success = false;

        const getNutritionFunction = firebase.functions().httpsCallable('getNutritionData');

        while (attempt < MAX_RETRIES && !success) {
            attempt++;
            statusDiv.textContent += `\n   - Frage Nährwerte an (Versuch ${attempt}/${MAX_RETRIES})...`;
            
            try {
                const nutritionResponse = await getNutritionFunction({ englishName });
                
                // Prüfen, ob die Cloud Function einen internen Fehler von Edamam meldet
                if (nutritionResponse.data.error) {
                    throw new Error(nutritionResponse.data.error);
                }

                edamamData = nutritionResponse.data.nutrition;
                statusDiv.textContent += ` -> OK`;
                success = true; // Erfolg!

            } catch (error) {
                console.error(`[Admin] Edamam-Fehler bei "${ingredientName}", Versuch ${attempt}:`, error);
                
                // Prüfen ob es ein Rate Limit Fehler (429) ist
                if (error.message.includes("Status 429")) {
                     statusDiv.textContent += ` -> Edamam-Limit (429) erreicht.`;
                } else {
                     statusDiv.textContent += ` -> FEHLER: ${error.message}`;
                }

                if (attempt < MAX_RETRIES) {
                    statusDiv.textContent += `. Warte ${RETRY_DELAY / 1000}s...`;
                    await delay(RETRY_DELAY);
                } else {
                    statusDiv.textContent += `. Maximalversuche erreicht.`;
                    // Schleife wird beendet, `success` bleibt `false`
                }
            }
        }
        
        // Wenn Edamam nach allen Versuchen fehlgeschlagen ist, brechen wir hier für diese Zutat ab.
        if (!success) {
            statusDiv.textContent += `\n   ❌ Konnte Nährwerte für "${ingredientName}" nicht abrufen. Überspringe Speichern.`;
            return false;
        }

        // --- SCHRITT 4: Alle gesammelten Daten in Firestore speichern ---
        statusDiv.textContent += `\n   - Speichere Daten in zutatenLexikonRAW...`;
        const docId = ingredientName.toLowerCase().replace(/\//g, '-');
        await db.collection('zutatenLexikonRAW').doc(docId).set({
            name: ingredientName,
            retrievedAt: new Date(),
            kategorie: category,
            englisch: englishName,
            nährwerte_pro_100g: edamamData.totalNutrients,
            kalorien_pro_100g: Math.round(edamamData.calories),
            rawData: edamamData
        }, { merge: true });
        statusDiv.textContent += ` -> Gespeichert!`;

        return true; // Alles hat geklappt

    } catch (error) {
        console.error(`[Admin] Schwerwiegender Fehler bei der Verarbeitung von "${ingredientName}":`, error);
        statusDiv.textContent += `\n   ❌ Schwerwiegender Fehler bei "${ingredientName}": ${error.message}`;
        return false; // Ein Fehler ist aufgetreten
    }
}
