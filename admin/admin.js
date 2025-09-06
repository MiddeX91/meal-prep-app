// === DOM-ELEMENTE ===
const fileInput = document.getElementById('json-file-input');
const uploadButton = document.getElementById('upload-button');
const fixMiscButton = document.getElementById('fix-misc-btn');
const enrichLexikonButton = document.getElementById('enrich-lexikon-btn');
const statusDiv = document.getElementById('status');

let fileContent = [];

// === EVENT LISTENER ===

fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) { return; }
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

uploadButton.addEventListener('click', async () => {
    if (fileContent.length === 0) { return; }
    statusDiv.textContent = 'Starte intelligenten Rezept-Upload...\n';
    setButtonsDisabled(true);

    const lexikonSnapshot = await db.collection('zutatenLexikon').get();
    const existingLexikon = {};
    lexikonSnapshot.forEach(doc => { existingLexikon[doc.id] = doc.data(); });

    for (const recipe of fileContent) {
        if (!recipe || !recipe.title || !recipe.ingredients) {
            statusDiv.textContent += `⚠️ Ein Eintrag wurde übersprungen (ungültiges Format).\n`;
            continue;
        }
        statusDiv.textContent += `\nVerarbeite Rezept: "${recipe.title}"...\n`;
        for (const ingredient of recipe.ingredients) {
            const ingredientKey = ingredient.name.toLowerCase().replace(/\//g, '-');
            if (!existingLexikon[ingredientKey]) {
                await processIngredient(ingredient.name, ingredientKey);
            }
        }
        try {
            await db.collection('rezepte').add(recipe);
            statusDiv.textContent += `✅ Rezept "${recipe.title}" erfolgreich gespeichert.\n`;
        } catch (error) {
            statusDiv.textContent += `❌ Fehler beim Speichern von "${recipe.title}": ${error}\n`;
        }
    }
    statusDiv.textContent += "\n🎉 Alle Rezepte verarbeitet!";
    setButtonsDisabled(false);
});

fixMiscButton.addEventListener('click', async () => {
    statusDiv.textContent = 'Starte Aufräum-Prozess für "Sonstiges"...\n';
    setButtonsDisabled(true);
    const snapshot = await db.collection('zutatenLexikon').where('kategorie', '==', 'Sonstiges').get();
    if (snapshot.empty) {
        statusDiv.textContent += 'Keine "Sonstiges"-Einträge gefunden.';
        setButtonsDisabled(false);
        return;
    }
    const itemsToFix = snapshot.docs.map(doc => doc.data());
    for (const item of itemsToFix) {
        await processIngredient(item.name, item.name.toLowerCase().replace(/\//g, '-'));
    }
    statusDiv.textContent += "\n🎉 Aufräum-Prozess abgeschlossen!";
    setButtonsDisabled(false);
});

enrichLexikonButton.addEventListener('click', async () => {
    statusDiv.textContent = 'Starte Anreicherungsprozess...\n';
    setButtonsDisabled(true);
    const snapshot = await db.collection('zutatenLexikon').get();
    const itemsToEnrich = snapshot.docs.map(doc => doc.data()).filter(item => !item.nährwerte_pro_100g);
    if (itemsToEnrich.length === 0) {
        statusDiv.textContent += 'Keine Einträge zum Anreichern gefunden.';
        setButtonsDisabled(false);
        return;
    }
    for (const item of itemsToEnrich) {
        await processIngredient(item.name, item.name.toLowerCase().replace(/\//g, '-'));
    }
    statusDiv.textContent += "\n🎉 Anreicherungsprozess abgeschlossen!";
    setButtonsDisabled(false);
});

/**
 * Zentraler Prozess: Holt Daten für eine Zutat von den APIs und speichert sie in Firestore.
 */
async function processIngredient(ingredientName, ingredientKey) {
    try {
        statusDiv.textContent += `- Verarbeite "${ingredientName}"...\n`;
        const categorizeFunction = firebase.functions().httpsCallable('categorizeIngredient');
        const response = await categorizeFunction({ ingredientName: ingredientName });
        const { fullData } = response.data;

        // .set mit { merge: true } erstellt ODER aktualisiert den Eintrag sicher.
        await db.collection('zutatenLexikon').doc(ingredientKey).set(fullData, { merge: true });

        if (fullData && fullData.nährwerte_pro_100g) {
            statusDiv.textContent += `  -> Daten für "${ingredientName}" erfolgreich gespeichert.\n`;
        } else {
            statusDiv.textContent += `  -> Konnte keine Nährwerte für "${ingredientName}" finden, Kategorie wurde gespeichert.\n`;
        }
    } catch (error) {
        console.error(`[Admin] Fehler bei der Verarbeitung von "${ingredientName}":`, error);
        statusDiv.textContent += `  -> Anfrage für "${ingredientName}" fehlgeschlagen: ${error.message}\n`;
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
}

function setButtonsDisabled(disabled) {
    uploadButton.disabled = disabled;
    fixMiscButton.disabled = disabled;
    enrichLexikonButton.disabled = disabled;
}

