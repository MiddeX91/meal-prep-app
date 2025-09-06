const functions = require("firebase-functions");
const fetch = require("node-fetch");

exports.categorizeIngredient = functions.runWith({ secrets: ["GEMINI_API_KEY", "EDAMAM_APP_ID", "EDAMAM_APP_KEY"] }).https.onCall(async (data, context) => {
    const ingredientName = data.ingredientName;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const EDAMAM_APP_ID = process.env.EDAMAM_APP_ID;
    const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY;

    if (!GEMINI_API_KEY || !EDAMAM_APP_ID || !EDAMAM_APP_KEY) {
        throw new functions.https.HttpsError('internal', 'API-Schlüssel auf dem Server nicht konfiguriert.');
    }

    try {
        // --- Gemini-Anfragen (unverändert) ---
        const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
        const geminiPromptCategory = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
        const categoryResponse = await askGemini(geminiPromptCategory, GEMINI_API_KEY);
        let foundCategory = 'Sonstiges';
        for (const cat of categories) { if (categoryResponse.includes(cat)) { foundCategory = cat; break; } }

        const geminiPromptTranslate = `Was ist die einfachste, gebräuchlichste englische Übersetzung für das Lebensmittel '${ingredientName}'? Antworte NUR mit den übersetzten Wörtern.`;
        const englishName = await askGemini(geminiPromptTranslate, GEMINI_API_KEY);

        // --- Edamam-Anfrage ---
        const ingredientQuery = `100g ${englishName}`;
        const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=${encodeURIComponent(ingredientQuery)}`;
        const edamamResponse = await fetch(edamamUrl);
        
        // NEU: Robuste Fehlerbehandlung für die Edamam-Antwort
        let edamamData = {}; // Standard-Fallback
        if (edamamResponse.ok) {
            try {
                edamamData = await edamamResponse.json();
            } catch (e) {
                console.error("Edamam hat keine gültige JSON-Antwort gesendet.");
                edamamData = { error: "Ungültige JSON-Antwort von Edamam" };
            }
        } else {
            console.error(`Edamam API-Fehler: Status ${edamamResponse.status}`);
            edamamData = { error: `Edamam API-Fehler: Status ${edamamResponse.status}` };
        }

        // --- Gib die (jetzt garantierte) Antwort zurück an die Admin-Seite ---
        return {
            category: foundCategory,
            englishName: englishName,
            rawEdamamData: edamamData
        };

    } catch (error) {
        console.error("Fehler in der Firebase Function 'categorizeIngredient':", error);
        throw new functions.https.HttpsError('internal', 'Fehler bei der API-Kommunikation.', error.message);
    }
});

async function askGemini(prompt, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    const data = await response.json();
    if (!response.ok || !data.candidates) { throw new Error(data.error?.message || 'Ungültige Antwort von Gemini.'); }
    return data.candidates[0].content.parts[0].text.trim();
}

