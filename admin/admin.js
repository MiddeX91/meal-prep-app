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
            dataFromFile = JSON.parse(e.target.result);
            statusDiv.textContent = `${dataFromFile.length} Einträge in Datei gefunden. Bereit zum Verarbeiten.`;
            uploadButton.disabled = false;
        } catch (error) {
            statusDiv.textContent = `Fehler: Ungültige JSON-Datei.\n${error}`;
            uploadButton.disabled = true;
        }
    };
    reader.readAsText(file);
});

// "Lexikon anreichern" ist jetzt unser Haupt-Button zum Sammeln der Rohdaten
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

        statusDiv.textContent += `\n${itemsToProcess.length} Einträge gefunden. Starte Verarbeitung...`;
        
        for (const item of itemsToProcess) {
            await processSingleIngredient(item.name);
        }
        statusDiv.textContent += `\n\n🎉 Prozess für "${modeText}" abgeschlossen!`;

    } catch (error) {
        statusDiv.textContent += `\n❌ Schwerwiegender Fehler: ${error.message}`;
    } finally {
        setButtonsDisabled(false);
    }
}


/**
 * Ruft das Backend für EINE Zutat auf und speichert die Daten.
 * Enthält jetzt die intelligente Retry-Logik.
 */
async function processSingleIngredient(ingredientName) {
    const MAX_RETRIES = 6;
    const RETRY_DELAY = 10000; // 10 Sekunden

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            statusDiv.textContent += `\n- Verarbeite "${ingredientName}" (Versuch ${attempt}/${MAX_RETRIES})...`;
            
            const categorizeFunction = firebase.functions().httpsCallable('categorizeIngredient');
            const response = await categorizeFunction({ ingredientName: ingredientName });
            
            console.log(`[Admin] Rohe Antwort für "${ingredientName}":`, response.data);
            const { rawEdamamData } = response.data;

            if (!rawEdamamData) {
                throw new Error("Backend hat keine 'rawEdamamData' zurückgegeben.");
            }
            
            const docId = ingredientName.toLowerCase().replace(/\//g, '-');

            await db.collection('zutatenLexikonRAW').doc(docId).set({
                name: ingredientName,
                retrievedAt: new Date(),
                rawData: rawEdamamData
            }, { merge: true });
            
            statusDiv.textContent += ` -> OK`;
            return; // Erfolg, beende die Funktion für diese Zutat

        } catch (error) {
            console.error(`[Admin] Fehler bei "${ingredientName}", Versuch ${attempt}:`, error);
            statusDiv.textContent += ` -> FEHLER: ${error.message}`;

            if (attempt < MAX_RETRIES) {
                statusDiv.textContent += `. Warte ${RETRY_DELAY / 1000}s...`;
                await delay(RETRY_DELAY);
            } else {
                statusDiv.textContent += `. Maximalversuche erreicht. Überspringe diese Zutat.`;
            }
        }
    }
}

