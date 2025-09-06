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

function parseNutrients(edamamData) {
    let nutritions = { kalorien: 0, protein: 0, fett: 0, kohlenhydrate: 0 };
    let nutrientsSource = null;

    if (edamamData && edamamData.totalNutrients && edamamData.totalNutrients.ENERC_KCAL) {
        nutrientsSource = edamamData.totalNutrients;
    } else if (edamamData && edamamData.ingredients && edamamData.ingredients[0]?.parsed?.[0]?.nutrients) {
        nutrientsSource = edamamData.ingredients[0].parsed[0].nutrients;
    }

    if (nutrientsSource) {
        nutritions.kalorien = nutrientsSource.ENERC_KCAL ? Math.round(nutrientsSource.ENERC_KCAL.quantity) : 0;
        nutritions.protein = nutrientsSource.PROCNT ? Math.round(nutrientsSource.PROCNT.quantity) : 0;
        nutritions.fett = nutrientsSource.FAT ? Math.round(nutrientsSource.FAT.quantity) : 0;
        nutritions.kohlenhydrate = nutrientsSource.CHOCDF ? Math.round(nutrientsSource.CHOCDF.quantity) : 0;
    }
    return nutritions;
}

// === EVENT LISTENER ===

fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            dataToUpload = JSON.parse(e.target.result);
            statusDiv.textContent = `${dataToUpload.length} Einträge in Datei gefunden. Bereit.`;
            uploadButton.disabled = false;
        } catch (error) {
            statusDiv.textContent = `Fehler: Ungültige JSON-Datei.\n${error}`;
            uploadButton.disabled = true;
        }
    };
    reader.readAsText(file);
});

// Event Listener
uploadButton.addEventListener('click', () => processUpload(dataToUpload));
fixMiscButton.addEventListener('click', () => processMaintenance('Sonstiges'));
enrichLexikonButton.addEventListener('click', () => processMaintenance('anreichern'));


/**
 * Zentrale Funktion für Wartungsarbeiten ("Sonstiges" & "Anreichern")
 */
async function processMaintenance(mode) {
    statusDiv.textContent = `Starte Prozess: "${mode}"...\nSuche nach relevanten Einträgen...`;
    setButtonsDisabled(true);

    try {
        const snapshot = await db.collection('zutatenLexikon').get();
        let itemsToProcess = [];

        if (mode === 'Sonstiges') {
            itemsToProcess = snapshot.docs.map(doc => doc.data()).filter(item => item.kategorie === 'Sonstiges');
        } else { // Modus 'anreichern'
            itemsToProcess = snapshot.docs.map(doc => doc.data()).filter(item => !item.nährwerte_pro_100g || item.nährwerte_pro_100g.kalorien === 0);
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
        statusDiv.textContent += `\n\n🎉 Testlauf für "${mode}" abgeschlossen!`;

    } catch (error) {
        statusDiv.textContent += `\n❌ Fehler: ${error.message}`;
    } finally {
        setButtonsDisabled(false);
    }
}

/**
 * Verarbeitet den Upload einer JSON-Datei mit Rezepten
 */
async function processUpload(items) {
     statusDiv.textContent = "Upload-Funktion für Rezepte noch nicht implementiert.";
}

/**
 * Ruft das Backend auf, wertet die Rohdaten aus und speichert sie.
 */
async function processSingleIngredient(ingredientName) {
    try {
        statusDiv.textContent += `\n- Verarbeite "${ingredientName}"...`;
        
        const categorizeFunction = firebase.functions().httpsCallable('categorizeIngredient');
        const response = await categorizeFunction({ ingredientName: ingredientName });

        console.log(`[Admin] Rohe Antwort für "${ingredientName}":`, response.data);
        const { category, englishName, rawEdamamData } = response.data;
        const docId = ingredientName.toLowerCase().replace(/\//g, '-');

        // --- Rohe Antwort archivieren ---
        await db.collection('zutatenLexikonRAW').doc(docId).set({
            name: ingredientName,
            retrievedAt: new Date(),
            rawData: rawEdamamData || { error: "Keine Rohdaten vom Backend erhalten." }
        }, { merge: true });
        
        // --- Rohdaten auswerten ---
        const nutritions = parseNutrients(rawEdamamData);

        const finalLexikonEntry = {
            name: ingredientName,
            kategorie: category,
            nährwerte_pro_100g: nutritions,
            english_name: englishName
        };

        // --- Saubere Daten speichern ---
        await db.collection('zutatenLexikon').doc(docId).set(finalLexikonEntry, { merge: true });
        statusDiv.textContent += ` -> OK`;

    } catch (error) {
        console.error(`[Admin] Fehler bei "${ingredientName}":`, error);
        statusDiv.textContent += ` -> FEHLER: ${error.message}`;
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
}

