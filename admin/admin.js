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
            // Fall 1: Es ist ein komplettes Rezept
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
            }
            // Fall 2: Es ist nur eine Zutat
            else if (item.name) {
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
            setButtonsDisabled(false);
            return;
        }

        const itemsToFix = snapshot.docs.map(doc => doc.data());
        statusDiv.textContent += `${itemsToFix.length} "Sonstiges"-Einträge gefunden. Teste die ersten 3...\n`;

        // NEU: Nur die ersten 3 "Sonstiges"-Einträge für den Test verarbeiten
        const testItems = itemsToFix.slice(0, 3);

        for (const item of testItems) {
            await processIngredient(item.name);
        }
        
        statusDiv.textContent += "\n🎉 Test-Aufräum-Prozess abgeschlossen!";

    } catch (dbError) {
        console.error("[Admin] Fehler beim Aufräumen:", dbError);
        statusDiv.textContent = `Fehler beim Lesen des Lexikons: ${dbError.message}`;
    } finally {
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
            setButtonsDisabled(false);
            return;
        }

        statusDiv.textContent += `${itemsToEnrich.length} Einträge zum Anreichern gefunden. Teste die ersten 3...\n`;

        // NEU: Wir nehmen nur die ersten 3 Einträge für den Test
        const testItems = itemsToEnrich.slice(0, 3);

        for (const item of testItems) {
            await processIngredient(item.name);
        }
        
        statusDiv.textContent += "\n🎉 Test-Anreicherungsprozess abgeschlossen!";

    } catch (dbError) {
        console.error("[Admin] Schwerwiegender Fehler beim Zugriff auf Firestore:", dbError);
        statusDiv.textContent = `Fehler beim Lesen des Lexikons: ${dbError.message}`;
    } finally {
        setButtonsDisabled(false);
    }
});


/**
 * Zentrale Funktion, die das Backend für eine einzelne Zutat aufruft und das Ergebnis speichert.
 */
async function processIngredient(ingredientName) {
    try {
        statusDiv.textContent += `- Verarbeite "${ingredientName}"...\n`;
        
        const categorizeFunction = firebase.functions().httpsCallable('categorizeIngredient');
        const response = await categorizeFunction({ ingredientName: ingredientName });
        const { fullData } = response.data;
        
        const docId = ingredientName.toLowerCase().replace(/\//g, '-');
        await db.collection('zutatenLexikon').doc(docId).set(fullData, { merge: true });

        statusDiv.textContent += `  -> Daten für "${ingredientName}" erfolgreich gespeichert/aktualisiert.\n`;

    } catch (error) {
        console.error(`[Admin] Fehler bei der Verarbeitung von "${ingredientName}":`, error);
        statusDiv.textContent += `  -> Anfrage für "${ingredientName}" fehlgeschlagen: ${error.message}\n`;
    }
    // Pause, um API-Limits nicht zu überschreiten
    await new Promise(resolve => setTimeout(resolve, 4000));
}

