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
    if (recipesToUpload.length === 0) {
        statusDiv.textContent = 'Keine Zutaten zum Hochladen vorhanden.';
        return;
    }
    
    statusDiv.textContent = 'Starte Kategorisierung...\n';
    uploadButton.disabled = true;

    const lexikonSnapshot = await db.collection('zutatenLexikon').get();
    const existingLexikon = {};
    lexikonSnapshot.forEach(doc => {
        existingLexikon[doc.id] = doc.data().kategorie;
    });

    // NEUE LOGIK: Wir erstellen eine "Warteschlange"
    const ingredientsToCategorize = [];
    recipesToUpload.forEach(item => {
        const key = item.name.toLowerCase();
        if (!existingLexikon[key]) {
            ingredientsToCategorize.push(item.name);
        } else {
            statusDiv.textContent += `- Zutat "${item.name}" ist bereits bekannt.\n`;
        }
    });

    if (ingredientsToCategorize.length === 0) {
        statusDiv.textContent += "\n🎉 Kategorisierung abgeschlossen! (Nichts zu tun)";
        uploadButton.disabled = false;
        return;
    }
    
    // Verarbeite die Warteschlange mit einer Pause zwischen den Anfragen
    for (const ingredientName of ingredientsToCategorize) {
        try {
            statusDiv.textContent += `- Frage KI nach Kategorie für "${ingredientName}"...\n`;
            
            const response = await fetch('/.netlify/functions/categorize-ingredient', {
                method: 'POST',
                body: JSON.stringify({ ingredientName: ingredientName })
            });
            
            if (!response.ok) throw new Error('Antwort vom Backend war nicht ok.');

            const { category } = await response.json();
            
            await db.collection('zutatenLexikon').doc(ingredientName.toLowerCase()).set({
                name: ingredientName,
                kategorie: category
            });
            
            statusDiv.textContent += `  -> KI sagt: "${category}". Gespeichert.\n`;

        } catch (error) {
            statusDiv.textContent += `  -> KI-Anfrage fehlgeschlagen: ${error}\n`;
        }
        
        // WICHTIG: Warte 2 Sekunden bis zur nächsten Anfrage, um das Limit nicht zu überschreiten
        await new Promise(resolve => setTimeout(resolve, 2000)); 
    }

    statusDiv.textContent += "\n🎉 Kategorisierung abgeschlossen!";
    uploadButton.disabled = false;
});

