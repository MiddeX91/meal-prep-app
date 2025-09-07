// === DOM-ELEMENTE ===
const fileInput = document.getElementById('json-file-input');
const uploadButton = document.getElementById('upload-button');
const fixMiscButton = document.getElementById('fix-misc-btn');
const enrichLexikonButton = document.getElementById('enrich-lexikon-btn');
const statusDiv = document.getElementById('status');
let dataFromFile = [];

// === HILFSFUNKTIONEN ===
function setButtonsDisabled(disabled) {
    uploadButton.disabled = disabled;
    fixMiscButton.disabled = disabled;
    enrichLexikonButton.disabled = disabled;
}

// === EVENT LISTENER ===
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
        enrichLexikonButton.disabled = true; // Button zum Starten deaktivieren
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            dataFromFile = JSON.parse(e.target.result);
            statusDiv.textContent = `${dataFromFile.length} Einträge in Datei gefunden. Bereit zum Sammeln der Rohdaten.`;
            enrichLexikonButton.disabled = false; // Button aktivieren
        } catch (error) {
            statusDiv.textContent = `Fehler: Ungültige JSON-Datei.\n${error}`;
        }
    };
    reader.readAsText(file);
});

// "Lexikon anreichern" ist jetzt unser Haupt-Button zum Sammeln der Rohdaten
enrichLexikonButton.addEventListener('click', () => {
    if (dataFromFile.length === 0) {
        alert("Bitte zuerst eine JSON-Datei mit Zutaten auswählen.");
        return;
    }
    // Wir übergeben nur die ersten 3 zum Testen
    processRawDataUpload(dataFromFile.slice(0, 3)); 
});

// Die anderen Buttons sind vorerst deaktiviert
uploadButton.disabled = true;
fixMiscButton.disabled = true;
uploadButton.addEventListener('click', () => alert("Diese Funktion ist deaktiviert."));
fixMiscButton.addEventListener('click', () => alert("Diese Funktion ist deaktiviert."));

/**
 * Hauptfunktion: Sammelt Rohdaten für eine Liste von Zutaten und speichert sie.
 */
async function processRawDataUpload(items) {
    statusDiv.textContent = `Starte Rohdaten-Sammelprozess für ${items.length} Zutaten...`;
    setButtonsDisabled(true);

    try {
        for (const item of items) {
            if (item && item.name) {
                await fetchAndStoreRawData(item.name);
            }
        }
        statusDiv.textContent += `\n\n🎉 Datensammlung abgeschlossen! Prüfe die 'zutatenLexikonRAW' Datenbank.`;

    } catch (error) {
        statusDiv.textContent += `\n❌ Schwerwiegender Fehler: ${error.message}`;
    } finally {
        setButtonsDisabled(false);
    }
}

/**
 * Ruft das Backend für EINE Zutat auf und speichert die Roh-Antwort.
 */
async function fetchAndStoreRawData(ingredientName) {
    try {
        statusDiv.textContent += `\n- Frage Backend nach Rohdaten für "${ingredientName}"...`;
        
        const categorizeFunction = firebase.functions().httpsCallable('categorizeIngredient');
        const response = await categorizeFunction({ ingredientName: ingredientName });

        const { rawGeminiCategory, rawGeminiTranslation, rawEdamamData } = response.data;
        const docId = ingredientName.toLowerCase().replace(/\//g, '-');

        // --- Rohe Antwort archivieren ---
        await db.collection('zutatenLexikonRAW').doc(docId).set({
            name: ingredientName,
            retrievedAt: new Date(),
            geminiCategoryResponse: rawGeminiCategory || { error: "Keine Rohdaten vom Backend erhalten." },
            geminiTranslateResponse: rawGeminiTranslation || { error: "Keine Rohdaten vom Backend erhalten." },
            edamamResponse: rawEdamamData || { error: "Keine Rohdaten vom Backend erhalten." }
        }, { merge: true });
        
        statusDiv.textContent += ` -> OK, Rohdaten gespeichert.`;

    } catch (error) {
        console.error(`[Admin] Fehler bei der Verarbeitung von "${ingredientName}":`, error);
        statusDiv.textContent += ` -> FEHLER: ${error.message}`;
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
}

