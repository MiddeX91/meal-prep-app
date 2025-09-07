// === DOM-ELEMENTE ===
const fileInput = document.getElementById('json-file-input');
const uploadButton = document.getElementById('upload-button');
const fixMiscButton = document.getElementById('fix-misc-btn');
const enrichLexikonButton = document.getElementById('enrich-lexikon-btn');
const processRawDataButton = document.getElementById('process-raw-data-btn'); // NEUER BUTTON
const statusDiv = document.getElementById('status');

// HINWEIS: Firebase wird jetzt automatisch durch /__/firebase/init.js initialisiert.
const db = firebase.firestore();
const functions = firebase.functions();

// === HILFSFUNKTIONEN ===
function setButtonsDisabled(disabled) {
    uploadButton.disabled = disabled;
    fixMiscButton.disabled = disabled;
    enrichLexikonButton.disabled = disabled;
    processRawDataButton.disabled = disabled; // NEU
}

const delay = ms => new Promise(res => setTimeout(res, ms));

// === EVENT LISTENER ===
// (Die Listener für fileInput, enrichLexikonButton etc. bleiben unverändert)
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) { uploadButton.disabled = true; return; }
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
enrichLexikonButton.addEventListener('click', () => processMaintenance('anreichern'));
fixMiscButton.addEventListener('click', () => processMaintenance('Sonstiges'));
uploadButton.addEventListener('click', () => alert("Diese Funktion wird später implementiert."));

// NEUER EVENT LISTENER FÜR DEN NEUEN BUTTON
processRawDataButton.addEventListener('click', processRawData);


/**
 * Liest alle Dokumente aus zutatenLexikonRAW, extrahiert die wichtigen
 * Informationen und schreibt sie in die zutatenLexikon Sammlung.
 */
async function processRawData() {
    statusDiv.textContent = 'Starte Verarbeitung der RAW-Daten...\nLese alle Dokumente aus zutatenLexikonRAW...';
    setButtonsDisabled(true);

    try {
        const snapshot = await db.collection('zutatenLexikonRAW').get();
        if (snapshot.empty) {
            statusDiv.textContent += '\nKeine Dokumente in zutatenLexikonRAW gefunden.';
            setButtonsDisabled(false);
            return;
        }
        
        statusDiv.textContent += `\n${snapshot.size} Dokumente gefunden. Starte Extraktion...`;
        
        const batch = db.batch();
        let processedCount = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const nutrients = data.rawData?.totalNutrients; // Sicherer Zugriff auf Nährwerte

            // Überspringe, wenn keine Nährwertdaten vorhanden sind
            if (!nutrients) {
                statusDiv.textContent += `\n- WARNUNG: Kein 'totalNutrients' in "${data.name}". Überspringe.`;
                continue;
            }

            // Erstelle das saubere Objekt für die Zieldatenbank
            const processedIngredient = {
                name: data.name,
                englisch: data.englisch,
                kategorie: data.kategorie,
                kalorien_pro_100g: Math.round(nutrients.ENERC_KCAL?.quantity ?? 0),
                nährwerte_pro_100g: {
                    carbs: Math.round(nutrients.CHOCDF?.quantity ?? 0),
                    fat: Math.round(nutrients.FAT?.quantity ?? 0),
                    protein: Math.round(nutrients.PROCNT?.quantity ?? 0)
                }
            };
            
            // Hol den Referenz-Pfad für das Zieldokument in zutatenLexikon
            const targetDocId = data.name.toLowerCase().replace(/\//g, '-');
            const targetDocRef = db.collection('zutatenLexikon').doc(targetDocId);

            // Füge die Update-Operation zum Batch hinzu
            // { merge: true } ist wichtig, damit andere Felder nicht überschrieben werden!
            batch.set(targetDocRef, processedIngredient, { merge: true });
            
            statusDiv.textContent += `\n- Verarbeite "${data.name}"... OK`;
            processedCount++;
        }
        
        statusDiv.textContent += `\n\nSchreibe ${processedCount} verarbeitete Dokumente in die Datenbank...`;
        await batch.commit(); // Führt alle Schreibvorgänge auf einmal aus
        
        statusDiv.textContent += `\n🎉 Prozess abgeschlossen! ${processedCount} Dokumente wurden erfolgreich in 'zutatenLexikon' geschrieben/aktualisiert.`;

    } catch (error) {
        statusDiv.textContent += `\n\n❌ FEHLER bei der Verarbeitung: ${error.message}`;
        console.error("Fehler beim Verarbeiten der RAW-Daten:", error);
    } finally {
        setButtonsDisabled(false);
    }
}


/**
 * Hauptfunktion für Wartungsarbeiten ("Sonstiges" & "Anreichern").
 */
async function processMaintenance(mode) {
    // Diese Funktion bleibt wie sie war.
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
        } else {
            itemsToProcess = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => !item.nährwerte_pro_100g);
        }

        if (itemsToProcess.length === 0) {
            statusDiv.textContent += '\nKeine relevanten Einträge gefunden.';
            return;
        }

        statusDiv.textContent += `\n${itemsToProcess.length} Einträge gefunden. Starte Verarbeitung...\n---`;
        
        let successCount = 0, errorCount = 0;
        for (const item of itemsToProcess) {
            const success = await processSingleIngredient(item.name);
            if (success) successCount++;
            else errorCount++;
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
 */
async function processSingleIngredient(ingredientName) {
    // Diese Funktion bleibt ebenfalls wie sie war.
    statusDiv.textContent += `\n\n➡️ Verarbeite "${ingredientName}"...`;
    
    try {
        statusDiv.textContent += `\n   - Frage Kategorie an...`;
        const getCategoryFunction = functions.httpsCallable('getIngredientCategory');
        const categoryResponse = await getCategoryFunction({ ingredientName });
        const category = categoryResponse.data.category;
        statusDiv.textContent += ` -> ${category}`;

        statusDiv.textContent += `\n   - Frage Übersetzung an...`;
        const translateFunction = functions.httpsCallable('translateIngredient');
        const translateResponse = await translateFunction({ ingredientName });
        const englishName = translateResponse.data.translation;
        statusDiv.textContent += ` -> ${englishName}`;

        const MAX_RETRIES = 6;
        const RETRY_DELAY = 10000;
        let edamamData = null, attempt = 0, success = false;
        const getNutritionFunction = functions.httpsCallable('getNutritionData');

        while (attempt < MAX_RETRIES && !success) {
            attempt++;
            statusDiv.textContent += `\n   - Frage Nährwerte an (Versuch ${attempt}/${MAX_RETRIES})...`;
            try {
                const nutritionResponse = await getNutritionFunction({ englishName });
                if (nutritionResponse.data.error) throw new Error(nutritionResponse.data.error);
                edamamData = nutritionResponse.data.nutrition;
                statusDiv.textContent += ` -> OK`;
                success = true;
            } catch (error) {
                console.error(`[Admin] Edamam-Fehler bei "${ingredientName}", Versuch ${attempt}:`, error);
                if (error.message.includes("Status 429")) statusDiv.textContent += ` -> Edamam-Limit (429) erreicht.`;
                else statusDiv.textContent += ` -> FEHLER: ${error.message}`;
                if (attempt < MAX_RETRIES) {
                    statusDiv.textContent += `. Warte ${RETRY_DELAY / 1000}s...`;
                    await delay(RETRY_DELAY);
                } else {
                    statusDiv.textContent += `. Maximalversuche erreicht.`;
                }
            }
        }
        
        if (!success) {
            statusDiv.textContent += `\n   ❌ Konnte Nährwerte für "${ingredientName}" nicht abrufen. Überspringe Speichern.`;
            return false;
        }

        statusDiv.textContent += `\n   - Speichere Daten in zutatenLexikonRAW...`;
        const docId = ingredientName.toLowerCase().replace(/\//g, '-');
        await db.collection('zutatenLexikonRAW').doc(docId).set({
            name: ingredientName,
            retrievedAt: new Date(),
            kategorie: category,
            englisch: englishName,
            rawData: edamamData
        }, { merge: true });
        statusDiv.textContent += ` -> Gespeichert!`;
        return true;
    } catch (error) {
        console.error(`[Admin] Schwerwiegender Fehler bei der Verarbeitung von "${ingredientName}":`, error);
        statusDiv.textContent += `\n   ❌ Schwerwiegender Fehler bei "${ingredientName}": ${error.message}`;
        return false;
    }
}

