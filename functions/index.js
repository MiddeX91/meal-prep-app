const { onCall } = require("firebase-functions/v2/https");
const fetch = require("node-fetch");

// Diese Funktion ist jetzt ein reiner "Bote"
exports.categorizeIngredient = onCall({ secrets: ["GEMINI_API_KEY", "EDAMAM_APP_ID", "EDAMAM_APP_KEY"] }, async (request) => {
    const ingredientName = request.data.ingredientName;

    // Greife auf die Secrets über process.env zu
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const EDAMAM_APP_ID = process.env.EDAMAM_APP_ID;
    const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY;

    if (!GEMINI_API_KEY || !EDAMAM_APP_ID || !EDAMAM_APP_KEY) {
        console.error("Fehler: API-Schlüssel wurden in der Umgebung nicht gefunden.");
        // Wirf einen Fehler, den das Frontend fangen kann
        throw new functions.https.HttpsError('internal', 'API-Schlüssel auf dem Server nicht konfiguriert.');
    }

    try {
        // --- Gemini-Anfrage (Kategorie) ---
        const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
        const geminiPromptCategory = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
        const geminiCategoryData = await askGemini(geminiPromptCategory, GEMINI_API_KEY);

        // --- Gemini-Anfrage (Übersetzung) ---
        const geminiPromptTranslate = `Was ist die einfachste, gebräuchlichste englische Übersetzung für das Lebensmittel '${ingredientName}'? Antworte NUR mit den übersetzten Wörtern.`;
        const geminiTranslateData = await askGemini(geminiPromptTranslate, GEMINI_API_KEY);
        const englishName = geminiTranslateData.candidates[0].content.parts[0].text.trim();

        // --- Edamam-Anfrage ---
        const ingredientQuery = `100g ${englishName}`;
        const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=${encodeURIComponent(ingredientQuery)}`;
        const edamamResponse = await fetch(edamamUrl);
        
        let edamamData = { error: `Edamam API-Fehler: Status ${edamamResponse.status}` };
        if (edamamResponse.ok) {
            try {
                edamamData = await edamamResponse.json();
            } catch (e) {
                edamamData = { error: "Ungültige JSON-Antwort von Edamam" };
            }
        }
        
        // --- Gib die ROHESTEN Ergebnisse als Paket zurück ---
        return {
            rawGeminiCategory: geminiCategoryData,
            rawGeminiTranslation: geminiTranslateData,
            rawEdamamData: edamamData 
        };

    } catch (error) {
        console.error(`Fehler bei der Verarbeitung von "${ingredientName}":`, error);
        throw new functions.https.HttpsError('internal', 'Fehler bei der API-Kommunikation.', error.message);
    }
});

// Hilfsfunktion gibt jetzt die ganze Antwort zurück
async function askGemini(prompt, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error?.message || 'Ungültige Antwort von Gemini.');
    }
    return data;
}

