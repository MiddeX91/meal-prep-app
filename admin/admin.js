// === DOM-ELEMENTE ===
const fileInput = document.getElementById('json-file-input');
const uploadButton = document.getElementById('upload-button');
const fixMiscButton = document.getElementById('fix-misc-btn');
const statusDiv = document.getElementById('status');
let recipesToUpload = [];
const enrichLexikonButton = document.getElementById('enrich-lexikon-btn');


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
    statusDiv.textContent = 'Starte intelligenten Rezept-Upload...\n';
    uploadButton.disabled = true;
    fixMiscButton.disabled = true;

    // 1. Lade das aktuelle Lexikon, um zu wissen, welche Zutaten wir schon kennen
    const lexikonSnapshot = await db.collection('zutatenLexikon').get();
    const existingLexikon = {};
    lexikonSnapshot.forEach(doc => {
        existingLexikon[doc.id] = doc.data().kategorie;
    });
    statusDiv.textContent += `Lokales Lexikon mit ${Object.keys(existingLexikon).length} Einträgen geladen.\n`;

    // 2. Gehe jedes Rezept in der hochgeladenen Datei durch
    for (const recipe of recipesToUpload) {
        if (!recipe || !recipe.title || !recipe.ingredients) {
            statusDiv.textContent += `⚠️ Ein Eintrag wurde übersprungen (ungültiges Format).\n`;
            continue;
        }

        statusDiv.textContent += `\nVerarbeite Rezept: "${recipe.title}"...\n`;

        // 3. Gehe jede Zutat im Rezept durch
        for (const ingredient of recipe.ingredients) {
            const ingredientKey = ingredient.name.toLowerCase().replace(/\//g, '-');

            // 4. Prüfe, ob die Zutat schon bekannt ist. Wenn nicht, frage Gemini.
            for (const ingredient of ingredientsToCategorize) {
    try {
        statusDiv.textContent += `- Frage APIs nach Daten für "${ingredient.name}"...\n`;
        
        const response = await fetch('/.netlify/functions/categorize-ingredient', {
            method: 'POST',
            body: JSON.stringify({ ingredientName: ingredient.name })
        });
        
        if (!response.ok) throw new Error('Antwort vom Backend war nicht ok.');

        const { category, fullData } = await response.json(); // Hole das volle Datenpaket
        const ingredientKey = ingredient.name.toLowerCase().replace(/\//g, '-');
        
        // Speichere den kompletten, angereicherten Eintrag im Lexikon
        await db.collection('zutatenLexikon').doc(ingredientKey).set(fullData);
        
        statusDiv.textContent += `  -> Kategorie: "${category}". Nährwerte gefunden. Gespeichert.\n`;

    } catch (error) {
        statusDiv.textContent += `  -> Anfrage fehlgeschlagen: ${error}\n`;
    }
    await new Promise(resolve => setTimeout(resolve, 4000)); // Pause beibehalten
}
        }

        // 5. Nachdem alle Zutaten geprüft (und ggf. kategorisiert) wurden, speichere das Rezept
        try {
            await db.collection('rezepte').add(recipe);
            statusDiv.textContent += `✅ Rezept "${recipe.title}" erfolgreich in der Datenbank gespeichert.\n`;
        } catch (error) {
            statusDiv.textContent += `❌ Fehler beim Speichern von "${recipe.title}": ${error}\n`;
        }
    }
    
    statusDiv.textContent += "\n🎉 Alle Rezepte in der Datei verarbeitet!";
    uploadButton.disabled = false;
    fixMiscButton.disabled = false;
});

enrichLexikonButton.addEventListener('click', async () => {
    statusDiv.textContent = 'Starte Anreicherungsprozess...\nSuche nach Einträgen ohne Nährwerte...\n';
    uploadButton.disabled = true;
    fixMiscButton.disabled = true;
    enrichLexikonButton.disabled = true;

    const snapshot = await db.collection('zutatenLexikon').get();
    
    // Finde alle Einträge, bei denen das nährwerte_pro_100g Feld fehlt
    const itemsToEnrich = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(item => !item.nährwerte_pro_100g);

    if (itemsToEnrich.length === 0) {
        statusDiv.textContent += 'Keine Einträge zum Anreichern gefunden. Alles auf dem neuesten Stand.';
        uploadButton.disabled = false;
        fixMiscButton.disabled = false;
        enrichLexikonButton.disabled = false;
        return;
    }

    statusDiv.textContent += `${itemsToEnrich.length} Einträge zum Anreichern gefunden. Starte API-Anfragen...\n`;

    for (const item of itemsToEnrich) {
        try {
            // Wir rufen dieselbe Backend-Funktion auf, sie liefert ja alle Daten
            const response = await fetch('/.netlify/functions/categorize-ingredient', {
                method: 'POST',
                body: JSON.stringify({ ingredientName: item.name })
            });
            if (!response.ok) throw new Error('Antwort vom Backend war nicht ok.');

            const { fullData } = await response.json();
            
            // Aktualisiere den bestehenden Eintrag mit den vollen Daten
            if (fullData && fullData.nährwerte_pro_100g) {
                await db.collection('zutatenLexikon').doc(item.id).update({
                    nährwerte_pro_100g: fullData.nährwerte_pro_100g
                });
                statusDiv.textContent += `  -> Nährwerte für "${item.name}" hinzugefügt.\n`;
            } else {
                 statusDiv.textContent += `  -> Konnte keine Nährwerte für "${item.name}" finden.\n`;
            }

        } catch (error) {
            statusDiv.textContent += `  -> Anfrage für "${item.name}" fehlgeschlagen: ${error}\n`;
        }
        await new Promise(resolve => setTimeout(resolve, 4000)); // Längere Pause zur Sicherheit
    }
    
    statusDiv.textContent += "\n🎉 Anreicherungsprozess abgeschlossen!";
    uploadButton.disabled = false;
    fixMiscButton.disabled = false;
    enrichLexikonButton.disabled = false;
});