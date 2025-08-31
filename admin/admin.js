const fileInput = document.getElementById('json-file-input');
const uploadButton = document.getElementById('upload-button');
const statusDiv = document.getElementById('status');
let recipesToUpload = [];

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
            recipesToUpload = JSON.parse(e.target.result);
            statusDiv.textContent = `${recipesToUpload.length} Rezept(e) zum Hochladen bereit.`;
            uploadButton.disabled = false;
        } catch (error) {
            statusDiv.textContent = 'Fehler: Die Datei ist keine gültige JSON-Datei.\n' + error;
            uploadButton.disabled = true;
        }
    };
    reader.readAsText(file);
});

// in admin/admin.js

uploadButton.addEventListener('click', async () => {
    // recipesToUpload ist jetzt eine Liste von Zutaten, z.B. [{name: "Karotte"}]
    if (recipesToUpload.length === 0) {
        statusDiv.textContent = 'Keine Zutaten zum Hochladen vorhanden.';
        return;
    }
    
    statusDiv.textContent = 'Starte Kategorisierung...\n';
    uploadButton.disabled = true;

    // Hole das existierende Lexikon, um Duplikate zu vermeiden
    const lexikonSnapshot = await db.collection('zutatenLexikon').get();
    const existingLexikon = {};
    lexikonSnapshot.forEach(doc => {
        existingLexikon[doc.id] = doc.data().kategorie;
    });

    for (const ingredient of recipesToUpload) {
        const ingredientKey = ingredient.name.toLowerCase();
        
        // Frage nur, wenn die Zutat noch nicht im Lexikon ist
        if (!existingLexikon[ingredientKey]) {
            try {
                statusDiv.textContent += `- Frage KI nach Kategorie für "${ingredient.name}"...\n`;
                
                // Rufe unsere Backend-Funktion auf
                const response = await fetch('/.netlify/functions/categorize-ingredient', {
                    method: 'POST',
                    body: JSON.stringify({ ingredientName: ingredient.name })
                });
                
                if (!response.ok) throw new Error('Antwort vom Backend war nicht ok.');

                const { category } = await response.json();
                
                // Speichere die neue Kategorie im Lexikon in Firestore
                await db.collection('zutatenLexikon').doc(ingredientKey).set({
                    name: ingredient.name,
                    kategorie: category
                });
                
                existingLexikon[ingredientKey] = category;
                statusDiv.textContent += `  -> KI sagt: "${category}". Gespeichert.\n`;

            } catch (error) {
                statusDiv.textContent += `  -> KI-Anfrage fehlgeschlagen: ${error}\n`;
            }
        } else {
            statusDiv.textContent += `- Zutat "${ingredient.name}" ist bereits bekannt.\n`;
        }
    }
    statusDiv.textContent += "\n🎉 Kategorisierung abgeschlossen!";
});

