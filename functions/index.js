const { onCall } = require("firebase-functions/v2/https");
const fetch = require("node-fetch");

// HILFSFUNKTION für alle Gemini-Anfragen
async function askGemini(prompt, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await response.json();
    if (!response.ok || !data.candidates || !data.candidates[0].content) {
        console.error("Ungültige Gemini Antwort:", data);
        throw new Error(data.error?.message || 'Ungültige Antwort von Gemini.');
    }
    return data.candidates[0].content.parts[0].text.trim();
}

/**
 * FUNKTION 1: Holt die Kategorie für eine Zutat.
 */
exports.getIngredientCategory = onCall({ secrets: ["GEMINI_API_KEY"] }, async (request) => {
    const ingredientName = request.data.ingredientName;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!ingredientName) {
        throw new functions.https.HttpsError('invalid-argument', 'ingredientName fehlt.');
    }

    try {
        const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
        const prompt = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
        
        const category = await askGemini(prompt, GEMINI_API_KEY);
        
        return { category: category };

    } catch (error) {
        console.error(`Fehler bei der Kategorisierung von "${ingredientName}":`, error);
        throw new functions.https.HttpsError('internal', `Fehler bei Gemini (Kategorie): ${error.message}`);
    }
});

/**
 * FUNKTION 2: Übersetzt eine Zutat ins Englische.
 */
exports.translateIngredient = onCall({ secrets: ["GEMINI_API_KEY"] }, async (request) => {
    const ingredientName = request.data.ingredientName;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!ingredientName) {
        throw new functions.https.HttpsError('invalid-argument', 'ingredientName fehlt.');
    }
    
    try {
        const prompt = `Was ist die einfachste, gebräuchlichste englische Übersetzung für das Lebensmittel '${ingredientName}'? Antworte NUR mit den übersetzten Wörtern.`;
        const translation = await askGemini(prompt, GEMINI_API_KEY);
        return { translation: translation };
    } catch(error) {
        console.error(`Fehler bei der Übersetzung von "${ingredientName}":`, error);
        throw new functions.https.HttpsError('internal', `Fehler bei Gemini (Übersetzung): ${error.message}`);
    }
});

/**
 * FUNKTION 3: Holt Nährwertdaten von Edamam.
 */
exports.getNutritionData = onCall({ secrets: ["EDAMAM_APP_ID", "EDAMAM_APP_KEY"] }, async (request) => {
    const englishName = request.data.englishName;
    const EDAMAM_APP_ID = process.env.EDAMAM_APP_ID;
    const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY;

    if (!englishName) {
        throw new functions.https.HttpsError('invalid-argument', 'englishName fehlt.');
    }

    const ingredientQuery = `100g ${englishName}`;
    const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=${encodeURIComponent(ingredientQuery)}`;

    try {
        const edamamResponse = await fetch(edamamUrl);
        
        // Wenn die Anfrage NICHT erfolgreich war, geben wir den Fehler direkt zurück.
        if (!edamamResponse.ok) {
            console.error(`Edamam API-Fehler für "${englishName}": Status ${edamamResponse.status}`);
            // Wir geben ein strukturiertes Fehlerobjekt zurück, das admin.js abfangen kann
            return { error: `Edamam API-Fehler: Status ${edamamResponse.status}` };
        }
        
        const nutritionData = await edamamResponse.json();
        return { nutrition: nutritionData };

    } catch (error) {
        console.error(`Netzwerkfehler oder JSON-Parsing-Fehler bei Edamam für "${englishName}":`, error);
        throw new functions.https.HttpsError('internal', `Fehler bei der Edamam-Anfrage: ${error.message}`);
    }
});
