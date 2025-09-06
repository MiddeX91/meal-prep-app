const functions = require("firebase-functions");
const fetch = require("node-fetch");

exports.categorizeIngredient = functions.runWith({ secrets: ["GEMINI_API_KEY", "EDAMAM_APP_ID", "EDAMAM_APP_KEY"] }).https.onCall(async (data, context) => {
    const ingredientName = data.ingredientName;

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const EDAMAM_APP_ID = process.env.EDAMAM_APP_ID;
    const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY;

    if (!GEMINI_API_KEY || !EDAMAM_APP_ID || !EDAMAM_APP_KEY) {
        console.error("API-Schlüssel wurden in der Umgebung nicht gefunden.");
        throw new functions.https.HttpsError('internal', 'API-Schlüssel auf dem Server nicht konfiguriert.');
    }

    try {
        // --- Schritt 1: Gemini für die Kategorie ---
        const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
        const geminiPrompt = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }] })
        });
        const geminiData = await geminiResponse.json();
        
        if (!geminiResponse.ok || !geminiData.candidates) {
            console.error("Ungültige Antwort von Gemini:", geminiData);
            throw new Error('Keine Kategorie von Gemini erhalten.');
        }
        
        let foundCategory = 'Sonstiges';
        const geminiText = geminiData.candidates[0].content.parts[0].text.trim();
        for (const cat of categories) { if (geminiText.includes(cat)) { foundCategory = cat; break; } }

        // --- Schritt 2: Edamam für die Nährwerte ---
        const ingredientQuery = `100g ${ingredientName}`;
        const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=${encodeURIComponent(ingredientQuery)}`;
        
        const edamamResponse = await fetch(edamamUrl);
        const edamamData = await edamamResponse.json();

        // HIER IST DIE WICHTIGE LOGGING-ZEILE
        console.log(`Antwort von Edamam für "${ingredientName}":`, JSON.stringify(edamamData, null, 2));
        
        let nutritions = null;
        if (edamamData && edamamData.totalNutrients && edamamData.totalNutrients.ENERC_KCAL) {
            const nutrients = edamamData.totalNutrients;
            nutritions = {
                kalorien: Math.round(nutrients.ENERC_KCAL.quantity || 0),
                protein: Math.round(nutrients.PROCNT.quantity || 0),
                fett: Math.round(nutrients.FAT.quantity || 0),
                kohlenhydrate: Math.round(nutrients.CHOCDF.quantity || 0)
            };
        }

        // --- Schritt 3: Ergebnisse kombinieren ---
        const finalLexikonEntry = {
            name: ingredientName,
            kategorie: foundCategory,
            nährwerte_pro_100g: nutritions
        };

        return { category: foundCategory, fullData: finalLexikonEntry };

    } catch (error) {
        console.error("Fehler in der Firebase Function 'categorizeIngredient':", error);
        throw new functions.https.HttpsError('internal', 'Fehler bei der API-Kommunikation.', error.message);
    }
});