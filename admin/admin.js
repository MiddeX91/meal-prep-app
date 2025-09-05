// === DOM-ELEMENTE ===
const fileInput = document.getElementById('json-file-input');
const uploadButton = document.getElementById('upload-button');
const fixMiscButton = document.getElementById('fix-misc-btn');
const enrichLexikonButton = document.getElementById('enrich-lexikon-btn');
const statusDiv = document.getElementById('status');

// Globale Variable, um den Inhalt der hochgeladenen Datei zu speichern
let fileContent = [];

// === EVENT LISTENER ===

/**
 * Liest die ausgewählte JSON-Datei und bereitet sie vor.
 */
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
        statusDiv.textContent = 'Keine Datei ausgewählt.';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            fileContent = JSON.parse(e.target.result);
            statusDiv.textContent = `${fileContent.length} Element(e) in der Datei gefunden. Bereit zum Verarbeiten.`;
            uploadButton.disabled = false;
        } catch (error) {
            statusDiv.textContent = 'Fehler: Die Datei ist keine gültige JSON-Datei.\n' + error;
            uploadButton.disabled = true;
        }
    };
    reader.readAsText(file);
});


/**
 * Lädt komplette Rezepte aus einer JSON-Datei hoch.
 * Kategorisiert dabei automatisch alle neuen, unbekannten Zutaten.
 */
uploadButton.addEventListener('click', async () => {
    if (fileContent.length === 0) {
        statusDiv.textContent = 'Keine Datei ausgewählt oder Datei ist leer.';
        return;
    }
    statusDiv.textContent = 'Starte intelligenten Rezept-Upload...\n';
    setButtonsDisabled(true);

    // 1. Lade das aktuelle Lexikon, um zu wissen, welche Zutaten wir schon kennen
    const lexikonSnapshot = await db.collection('zutatenLexikon').get();
    const existingLexikon = {};
    lexikonSnapshot.forEach(doc => {
        existingLexikon[doc.id] = doc.data();
    });
    statusDiv.textContent += `Lokales Lexikon mit ${Object.keys(existingLexikon).length} Einträgen geladen.\n`;

    // 2. Gehe jedes Rezept in der hochgeladenen Datei durch
    for (const recipe of fileContent) {
        if (!recipe || !recipe.title || !recipe.ingredients) {
            statusDiv.textContent += `⚠️ Ein Eintrag wurde übersprungen (ungültiges Format).\n`;
            continue;
        }

        statusDiv.textContent += `\nVerarbeite Rezept: "${recipe.title}"...\n`;

        // 3. Gehe jede Zutat im Rezept durch
        for (const ingredient of recipe.ingredients) {
            const ingredientKey = ingredient.name.toLowerCase().replace(/\//g, '-');

            // 4. Prüfe, ob die Zutat schon bekannt ist. Wenn nicht, frage die KI.
            if (!existingLexikon[ingredientKey]) {
                try {
                    statusDiv.textContent += `  - Neue Zutat: "${ingredient.name}". Frage APIs...\n`;
                    
                    const categorizeFunction = firebase.functions().httpsCallable('categorizeIngredient');
                    const response = await categorizeFunction({ ingredientName: ingredient.name });
                    const { fullData } = response.data;
                    
                    await db.collection('zutatenLexikon').doc(ingredientKey).set(fullData);
                    existingLexikon[ingredientKey] = fullData; // Aktualisiere unser lokales Wissen
                    statusDiv.textContent += `    -> KI sagt: "${fullData.kategorie}". Im Lexikon gespeichert.\n`;

                } catch (error) {
                    console.error(`Fehler bei der Verarbeitung von "${ingredient.name}":`, error);
                    statusDiv.textContent += `    -> API-Anfrage fehlgeschlagen: ${error.message}\n`;
                }
                await new Promise(resolve => setTimeout(resolve, 4000)); // Pause von 4 Sek.
            }
        }

        // 5. Nachdem alle Zutaten geprüft wurden, speichere das Rezept
        try {
            await db.collection('rezepte').add(recipe);
            statusDiv.textContent += `✅ Rezept "${recipe.title}" erfolgreich in der Datenbank gespeichert.\n`;
        } catch (error) {
            statusDiv.textContent += `❌ Fehler beim Speichern von "${recipe.title}": ${error}\n`;
        }
    }
    
    statusDiv.textContent += "\n🎉 Alle Rezepte in der Datei verarbeitet!";
    setButtonsDisabled(false);
});


/**
 * Geht alle "Sonstiges"-Einträge im Lexikon durch und versucht, sie neu zu kategorisieren.
 */
fixMiscButton.addEventListener('click', async () => {
    statusDiv.textContent = 'Starte Aufräum-Prozess...\nSuche nach "Sonstiges"-Einträgen im Lexikon...\n';
    setButtonsDisabled(true);

    const snapshot = await db.collection('zutatenLexikon').where('kategorie', '==', 'Sonstiges').get();
    
    if (snapshot.empty) {
        statusDiv.textContent += 'Keine Zutaten in der Kategorie "Sonstiges" gefunden.';
        setButtonsDisabled(false);
        return;
    }

    const itemsToFix = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    statusDiv.textContent += `${itemsToFix.length} "Sonstiges"-Einträge gefunden. Starte KI-Anfrage...\n`;

    for (const item of itemsToFix) {
        try {
            const categorizeFunction = firebase.functions().httpsCallable('categorizeIngredient');
            const response = await categorizeFunction({ ingredientName: item.name });
            const { category, fullData } = response.data;
            
            if (category !== 'Sonstiges') {
                await db.collection('zutatenLexikon').doc(item.id).set(fullData);
                statusDiv.textContent += `  -> "${item.name}" wurde zu "${category}" geändert.\n`;
            } else {
                statusDiv.textContent += `  -> KI konnte für "${item.name}" keine bessere Kategorie finden.\n`;
            }

        } catch (error) {
            console.error(`Fehler bei der Verarbeitung von "${item.name}":`, error);
            statusDiv.textContent += `  -> KI-Anfrage für "${item.name}" fehlgeschlagen: ${error.message}\n`;
        }
        await new Promise(resolve => setTimeout(resolve, 4000));
    }
    
    statusDiv.textContent += "\n🎉 Aufräum-Prozess abgeschlossen!";
    setButtonsDisabled(false);
});


/**
 * Geht alle Lexikon-Einträge durch und fügt fehlende Nährwerte hinzu.
 */
enrichLexikonButton.addEventListener('click', async () => {
    statusDiv.textContent = 'Starte Anreicherungsprozess...\nSuche nach Einträgen ohne Nährwerte...\n';
    setButtonsDisabled(true);

    const snapshot = await db.collection('zutatenLexikon').get();
    
    const itemsToEnrich = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(item => !item.nährwerte_pro_100g);

    if (itemsToEnrich.length === 0) {
        statusDiv.textContent += 'Keine Einträge zum Anreichern gefunden. Alles auf dem neuesten Stand.';
        setButtonsDisabled(false);
        return;
    }

    statusDiv.textContent += `${itemsToEnrich.length} Einträge zum Anreichern gefunden. Starte API-Anfragen...\n`;

    for (const item of itemsToEnrich) {
        try {
            const categorizeFunction = firebase.functions().httpsCallable('categorizeIngredient');
            const response = await categorizeFunction({ ingredientName: item.name });
            const { fullData } = response.data;
            
            if (fullData && fullData.nährwerte_pro_100g) {
                await db.collection('zutatenLexikon').doc(item.id).update({
                    nährwerte_pro_100g: fullData.nährwerte_pro_100g
                });
                statusDiv.textContent += `  -> Nährwerte für "${item.name}" hinzugefügt.\n`;
            } else {
                 statusDiv.textContent += `  -> Konnte keine Nährwerte für "${item.name}" finden.\n`;
            }

        } catch (error) {
            console.error(`Fehler bei der Verarbeitung von "${item.name}":`, error);
            statusDiv.textContent += `  -> Anfrage für "${item.name}" fehlgeschlagen: ${error.message}\n`;
        }
        await new Promise(resolve => setTimeout(resolve, 4000));
    }
    
    statusDiv.textContent += "\n🎉 Anreicherungsprozess abgeschlossen!";
    setButtonsDisabled(false);
});


/**
 * Hilfsfunktion zum Deaktivieren/Aktivieren der Buttons während eines Prozesses.
 */
function setButtonsDisabled(disabled) {
    uploadButton.disabled = disabled;
    fixMiscButton.disabled = disabled;
    enrichLexikonButton.disabled = disabled;
}
