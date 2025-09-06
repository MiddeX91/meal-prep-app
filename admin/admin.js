// === DOM-ELEMENTE ===
const fileInput = document.getElementById('json-file-input');
const uploadButton = document.getElementById('upload-button');
const fixMiscButton = document.getElementById('fix-misc-btn');
const enrichLexikonButton = document.getElementById('enrich-lexikon-btn');
const statusDiv = document.getElementById('status');
let dataToUpload = [];

// === HILFSFUNKTION ===
function setButtonsDisabled(disabled) {
    uploadButton.disabled = disabled;
    fixMiscButton.disabled = disabled;
    enrichLexikonButton.disabled = disabled;
}

// === EVENT LISTENER ===

fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
        statusDiv.textContent = 'Keine Datei ausgewählt.';
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            dataToUpload = JSON.parse(e.target.result);
            statusDiv.textContent = `${dataToUpload.length} Einträge in der Datei gefunden. Bereit zum Verarbeiten.`;
            uploadButton.disabled = false;
        } catch (error) {
            statusDiv.textContent = `Fehler: Die Datei ist keine gültige JSON-Datei.\n${error}`;
            uploadButton.disabled = true;
        }
    };
    reader.readAsText(file);
});

// Event Listener für den Upload-Button (Rezepte UND/ODER Zutaten)
uploadButton.addEventListener('click', async () => {
    if (dataToUpload.length === 0) {
        statusDiv.textContent = 'Keine Daten in der Datei zum Hochladen.';
        return;
    }
    statusDiv.textContent = 'Starte intelligenten Upload...\n';
    setButtonsDisabled(true);

    try {
        const lexikonSnapshot = await db.collection('zutatenLexikon').get();
        const existingLexikon = new Set(lexikonSnapshot.docs.map(doc => doc.id));
        
        for (const item of dataToUpload) {
            if (item.title && item.ingredients) {
                statusDiv.textContent += `\nVerarbeite Rezept: "${item.title}"...\n`;
                for (const ingredient of item.ingredients) {
                    const key = ingredient.name.toLowerCase().replace(/\//g, '-');
                    if (ingredient.name && !existingLexikon.has(key)) {
                        await processIngredient(ingredient.name);
                        existingLexikon.add(key);
                    }
                }
                await db.collection('rezepte').add(item);
                statusDiv.textContent += `✅ Rezept "${item.title}" erfolgreich gespeichert.\n`;
            } else if (item.name) {
                const key = item.name.toLowerCase().replace(/\//g, '-');
                if (!existingLexikon.has(key)) {
                    await processIngredient(item.name);
                    existingLexikon.add(key);
                } else {
                     statusDiv.textContent += `- Zutat "${item.name}" ist bereits bekannt.\n`;
                }
            }
        }
    } catch (error) {
        statusDiv.textContent += `\n❌ Ein Fehler ist aufgetreten: ${error.message}`;
    }
    
    statusDiv.textContent += "\n🎉 Upload-Prozess abgeschlossen!";
    setButtonsDisabled(false);
});


// Event Listener für den "Aufräumen"-Button
fixMiscButton.addEventListener('click', async () => {
    statusDiv.textContent = 'Starte Aufräum-Prozess...\nSuche nach "Sonstiges"-Einträgen...\n';
    setButtonsDisabled(true);

    try {
        const snapshot = await db.collection('zutatenLexikon').where('kategorie', '==', 'Sonstiges').get();
        if (snapshot.empty) {
            statusDiv.textContent += 'Keine "Sonstiges"-Einträge gefunden.';
            return;
        }
        const itemsToFix = snapshot.docs.map(doc => doc.data());
        for (const item of itemsToFix.slice(0, 3)) { // Testmodus: nur 3
            await processIngredient(item.name);
        }
    } catch (dbError) {
        statusDiv.textContent = `Fehler: ${dbError.message}`;
    } finally {
        statusDiv.textContent += "\n🎉 Test-Aufräum-Prozess abgeschlossen!";
        setButtonsDisabled(false);
    }
});


// Event Listener für den "Anreichern"-Button
enrichLexikonButton.addEventListener('click', async () => {
    statusDiv.textContent = 'Starte Anreicherungsprozess...\nSuche nach Einträgen ohne Nährwerte...\n';
    setButtonsDisabled(true);

    try {
        const snapshot = await db.collection('zutatenLexikon').get();
        const itemsToEnrich = snapshot.docs
            .map(doc => doc.data())
            .filter(item => !item.nährwerte_pro_100g || item.nährwerte_pro_100g.kalorien === 0);

        if (itemsToEnrich.length === 0) {
            statusDiv.textContent += 'Keine Einträge zum Anreichern gefunden.';
            return;
        }
        statusDiv.textContent += `${itemsToEnrich.length} Einträge gefunden. Teste die ersten 3...\n`;
        for (const item of itemsToEnrich.slice(0, 3)) { // Testmodus: nur 3
            await processIngredient(item.name);
        }
    } catch (dbError) {
        statusDiv.textContent = `Fehler: ${dbError.message}`;
    } finally {
        statusDiv.textContent += "\n🎉 Test-Anreicherungsprozess abgeschlossen!";
        setButtonsDisabled(false);
    }
});


/**
 * Zentrale Funktion, die das Backend aufruft und die Rohdaten zur Analyse speichert.
 */
async function processIngredient(ingredientName) {
    try {
        statusDiv.textContent += `- Verarbeite "${ingredientName}"...\n`;
        
        const categorizeFunction = firebase.functions().httpsCallable('categorizeIngredient');
        const response = await categorizeFunction({ ingredientName: ingredientName });
        const { rawEdamamData } = response.data;

        // Gib die rohe Antwort in der Browser-Konsole aus, damit wir sie analysieren können
        console.log(`Rohe Antwort von Edamam für "${ingredientName}":`, rawEdamamData);

        const docId = ingredientName.toLowerCase().replace(/\//g, '-');

        // --- SCHRITT 1: Die rohe Antwort archivieren ---
        await db.collection('zutatenLexikonRAW').doc(docId).set({
            name: ingredientName,
            retrievedAt: new Date(),
            rawData: rawEdamamData
        }, { merge: true });
        statusDiv.textContent += `  -> Rohe API-Antwort für "${ingredientName}" archiviert.\n`;

        // --- SCHRITT 2 & 3 (Auswerten & Speichern) sind vorübergehend deaktiviert ---
        statusDiv.textContent += `  -> Nächster Schritt: Auswertung und Speicherung in 'zutatenLexikon'.\n`;

    } catch (error) {
        console.error(`[Admin] Fehler bei der Verarbeitung von "${ingredientName}":`, error);
        statusDiv.textContent += `  -> Anfrage für "${ingredientName}" fehlgeschlagen: ${error.message}\n`;
    }
    // Pause, um API-Limits nicht zu überschreiten
    await new Promise(resolve => setTimeout(resolve, 4000));
}

