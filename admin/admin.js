// === DOM-ELEMENTE ===
const fileInput = document.getElementById('json-file-input');
const uploadButton = document.getElementById('upload-button');
const fixMiscButton = document.getElementById('fix-misc-btn');
const statusDiv = document.getElementById('status');
let recipesToUpload = [];

// === EVENT LISTENER ===

// Event Listener für die Dateiauswahl
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
        statusDiv.textContent = 'Keine Datei ausgewählt.';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            // Wir nehmen an, dass die Datei eine Liste von Zutaten-Objekten ist
            recipesToUpload = JSON.parse(e.target.result);
            statusDiv.textContent = `${recipesToUpload.length} Zutat(en) in der Datei gefunden. Bereit zum Hochladen.`;
            uploadButton.disabled = false;
        } catch (error) {
            statusDiv.textContent = 'Fehler: Die Datei ist keine gültige JSON-Datei.\n' + error;
            uploadButton.disabled = true;
        }
    };
    reader.readAsText(file);
});

// Event Listener für den Upload-Button (nur für neue Zutaten)
uploadButton.addEventListener('click', async () => {
    if (recipesToUpload.length === 0) {
        statusDiv.textContent = 'Keine Datei ausgewählt oder Datei ist leer.';
        return;
    }
    statusDiv.textContent = 'Starte Kategorisierung für NEUE Zutaten...\n';
    uploadButton.disabled = true;
    fixMiscButton.disabled = true;

    const lexikonSnapshot = await db.collection('zutatenLexikon').get();
    const existingLexikon = {};
    lexikonSnapshot.forEach(doc => {
        existingLexikon[doc.id] = doc.data().kategorie;
    });

    const ingredientsToCategorize = [];
    recipesToUpload.forEach(item => {
        // NEUE SICHERHEITSPRÜFUNG: Ignoriere leere oder fehlerhafte Einträge
        if (item && item.name) {
            const key = item.name.toLowerCase().replace(/\//g, '-');
            if (!existingLexikon[key]) {
                ingredientsToCategorize.push(item);
            } else {
                statusDiv.textContent += `- Zutat "${item.name}" ist bereits bekannt.\n`;
            }
        }
    });
    
    if (ingredientsToCategorize.length === 0) {
        statusDiv.textContent += "\nKeine neuen Zutaten gefunden.";
        uploadButton.disabled = false;
        fixMiscButton.disabled = false;
        return;
    }
    
    for (const ingredient of ingredientsToCategorize) {
        try {
            statusDiv.textContent += `- Frage KI nach Kategorie für "${ingredient.name}"...\n`;
            
            const response = await fetch('/.netlify/functions/categorize-ingredient', {
                method: 'POST',
                body: JSON.stringify({ ingredientName: ingredient.name })
            });
            
            if (!response.ok) throw new Error('Antwort vom Backend war nicht ok.');

            const { category } = await response.json();
            const ingredientKey = ingredient.name.toLowerCase().replace(/\//g, '-');
            
            await db.collection('zutatenLexikon').doc(ingredientKey).set({
                name: ingredient.name,
                kategorie: category
            });
            
            statusDiv.textContent += `  -> KI sagt: "${category}". Gespeichert.\n`;

        } catch (error) {
            statusDiv.textContent += `  -> KI-Anfrage fehlgeschlagen: ${error}\n`;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    statusDiv.textContent += "\n🎉 Prozess für neue Zutaten abgeschlossen!";
    uploadButton.disabled = false;
    fixMiscButton.disabled = false;
});

// Eigener Event Listener für den "Aufräumen"-Button
fixMiscButton.addEventListener('click', async () => {
    statusDiv.textContent = 'Starte Aufräum-Prozess...\nSuche nach "Sonstiges"-Einträgen im Lexikon...\n';
    uploadButton.disabled = true;
    fixMiscButton.disabled = true;

    const snapshot = await db.collection('zutatenLexikon').where('kategorie', '==', 'Sonstiges').get();
    
    if (snapshot.empty) {
        statusDiv.textContent += 'Keine Zutaten in der Kategorie "Sonstiges" gefunden.';
        uploadButton.disabled = false;
        fixMiscButton.disabled = false;
        return;
    }

    const itemsToFix = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    statusDiv.textContent += `${itemsToFix.length} "Sonstiges"-Einträge gefunden. Starte KI-Anfrage...\n`;

    for (const item of itemsToFix) {
        try {
            const response = await fetch('/.netlify/functions/categorize-ingredient', {
                method: 'POST',
                body: JSON.stringify({ ingredientName: item.name })
            });
            if (!response.ok) throw new Error('Antwort vom Backend war nicht ok.');

            const { category } = await response.json();
            
            if (category !== 'Sonstiges') {
                await db.collection('zutatenLexikon').doc(item.id).update({ kategorie: category });
                statusDiv.textContent += `  -> "${item.name}" wurde zu "${category}" geändert.\n`;
            } else {
                statusDiv.textContent += `  -> KI konnte für "${item.name}" keine bessere Kategorie finden.\n`;
            }

        } catch (error) {
            statusDiv.textContent += `  -> KI-Anfrage für "${item.name}" fehlgeschlagen: ${error}\n`;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    statusDiv.textContent += "\n🎉 Aufräum-Prozess abgeschlossen!";
    uploadButton.disabled = false;
    fixMiscButton.disabled = false;
});