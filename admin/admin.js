// === DOM-ELEMENTE ===
const fileInput = document.getElementById('json-file-input');
const uploadButton = document.getElementById('upload-button');
const fixMiscButton = document.getElementById('fix-misc-btn');
const enrichLexikonButton = document.getElementById('enrich-lexikon-btn');
const statusDiv = document.getElementById('status');
let dataFromFile = []; // Umbenannt, um klarer zu sein

// === HILFSFUNKTIONEN ===
function setButtonsDisabled(disabled) {
    uploadButton.disabled = disabled;
    fixMiscButton.disabled = disabled;
    enrichLexikonButton.disabled = disabled;
}

// === EVENT LISTENER ===

// Event Listener nur für die Dateiauswahl. Aktiviert nur den Upload-Button.
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
        uploadButton.disabled = true;
        return;
    };
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            dataFromFile = JSON.parse(e.target.result);
            statusDiv.textContent = `${dataFromFile.length} Einträge in Datei gefunden. Bereit zum Upload.`;
            uploadButton.disabled = false; // Nur der Upload-Button wird aktiviert
        } catch (error) {
            statusDiv.textContent = `Fehler: Ungültige JSON-Datei.\n${error}`;
            uploadButton.disabled = true;
        }
    };
    reader.readAsText(file);
});

// Event Listener für "Neue Rezepte/Zutaten hochladen"
uploadButton.addEventListener('click', () => {
    if (dataFromFile.length === 0) {
        alert("Bitte zuerst eine gültige JSON-Datei auswählen.");
        return;
    }
    // Wählt den richtigen Prozess basierend auf dem Datei-Inhalt
    if (dataFromFile[0].title) { // Annahme: Es ist eine Rezept-Datei
        processRecipeUpload(dataFromFile);
    } else { // Annahme: Es ist eine Zutaten-Datei
        processNewIngredients(dataFromFile);
    }
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
 * Hauptfunktion für Wartungsarbeiten ("Sonstiges" & "Anreichern").
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

// Platzhalter-Funktionen für den Upload-Button
async function processRecipeUpload(recipes) {
    statusDiv.textContent = 'Rezept-Upload wird gestartet...';
    // Hier kommt die Logik zum Hochladen von Rezepten rein
    alert('Rezept-Upload noch nicht implementiert.');
}
async function processNewIngredients(ingredients) {
     statusDiv.textContent = 'Upload neuer Zutaten wird gestartet...';
     // Hier kommt die Logik zum Abarbeiten einer Zutaten-Liste rein
     alert('Upload neuer Zutaten noch nicht implementiert.');
}

