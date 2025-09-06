// === DOM-ELEMENTE ===
const fileInput = document.getElementById('json-file-input');
const uploadButton = document.getElementById('upload-button');
const fixMiscButton = document.getElementById('fix-misc-btn');
const enrichLexikonButton = document.getElementById('enrich-lexikon-btn');
const statusDiv = document.getElementById('status');
let dataToUpload = [];

// === HILFSFUNKTIONEN ===
function setButtonsDisabled(disabled) {
    uploadButton.disabled = disabled;
    fixMiscButton.disabled = disabled;
    enrichLexikonButton.disabled = disabled;
}

// === EVENT LISTENER ===

// Event Listener nur für die Dateiauswahl
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            dataToUpload = JSON.parse(e.target.result);
            statusDiv.textContent = `${dataToUpload.length} Einträge in Datei gefunden. Bereit.`;
            uploadButton.disabled = false; // Nur der Upload-Button wird aktiviert
        } catch (error) {
            statusDiv.textContent = `Fehler: Ungültige JSON-Datei.\n${error}`;
            uploadButton.disabled = true;
        }
    };
    reader.readAsText(file);
});

// Event Listener für "Neue Rezepte hochladen"
uploadButton.addEventListener('click', () => {
    if (dataToUpload.length === 0) {
        alert("Bitte zuerst eine JSON-Datei mit Rezepten auswählen.");
        return;
    }
    // HIER KOMMT DIE LOGIK FÜR DEN REZEPT-UPLOAD
    alert("Rezept-Upload-Funktion noch nicht implementiert.");
});


// Event Listener für ""Sonstiges" aufräumen"
fixMiscButton.addEventListener('click', () => {
    processMaintenance('Sonstiges');
});

// Event Listener für "Lexikon mit Nährwerten anreichern"
enrichLexikonButton.addEventListener('click', () => {
    processMaintenance('anreichern');
});


/**
 * Zentrale Funktion für Wartungsarbeiten ("Sonstiges" & "Anreichern").
 * Diese Funktion benötigt KEINE hochgeladene Datei.
 */
async function processMaintenance(mode) {
    const modeText = mode === 'Sonstiges' ? '"Sonstiges" aufräumen' : 'Lexikon anreichern';
    statusDiv.textContent = `Starte Prozess: "${modeText}"...\nSuche nach relevanten Einträgen...`;
    setButtonsDisabled(true);

    try {
        const snapshot = await db.collection('zutatenLexikon').get();
        let itemsToProcess = [];

        if (mode === 'Sonstiges') {
            itemsToProcess = snapshot.docs.map(doc => doc.data()).filter(item => item.kategorie === 'Sonstiges');
        } else { // Modus 'anreichern'
            itemsToProcess = snapshot.docs.map(doc => doc.data()).filter(item => !item.nährwerte_pro_1_g || item.nährwerte_pro_100g.kalorien === 0);
        }

        if (itemsToProcess.length === 0) {
            statusDiv.textContent += '\nKeine relevanten Einträge gefunden.';
            setButtonsDisabled(false);
            return;
        }

        statusDiv.textContent += `\n${itemsToProcess.length} Einträge gefunden. Starte Verarbeitung...`;
        for (const item of itemsToProcess.slice(0, 3)) { // Testmodus: Nur die ersten 3
            await processSingleIngredient(item.name);
        }
        statusDiv.textContent += `\n\n🎉 Testlauf für "${modeText}" abgeschlossen!`;

    } catch (error) {
        statusDiv.textContent += `\n❌ Schwerwiegender Fehler: ${error.message}`;
    } finally {
        setButtonsDisabled(false);
    }
}

/**
 * Ruft das Backend für EINE Zutat auf und speichert die Daten.
 */
async function processSingleIngredient(ingredientName) {
    try {
        statusDiv.textContent += `\n- Verarbeite "${ingredientName}"...`;
        
        const categorizeFunction = firebase.functions().httpsCallable('categorizeIngredient');
        const response = await categorizeFunction({ ingredientName: ingredientName });

        const { fullData, rawEdamamData } = response.data;
        if (!fullData) {
            throw new Error("Backend hat keine 'fullData' zurückgegeben.");
        }
        
        const docId = ingredientName.toLowerCase().replace(/\//g, '-');

        // Rohe Antwort für die Fehlersuche archivieren
        await db.collection('zutatenLexikonRAW').doc(docId).set({
            name: ingredientName,
            retrievedAt: new Date(),
            rawData: rawEdamamData || { error: "Keine Rohdaten vom Backend erhalten." }
        }, { merge: true });
        
        // Saubere, verarbeitete Daten im Haupt-Lexikon speichern
        await db.collection('zutatenLexikon').doc(docId).set(fullData, { merge: true });
        statusDiv.textContent += ` -> OK`;

    } catch (error) {
        console.error(`[Admin] Fehler bei "${ingredientName}":`, error);
        statusDiv.textContent += ` -> FEHLER: ${error.message}`;
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
}

