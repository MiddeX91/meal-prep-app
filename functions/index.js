const functions = require("firebase-functions");
const fetch = require("node-fetch");

// Diese Zeile ist der korrekte, moderne Weg, um Secrets zu laden
exports.categorizeIngredient = functions.runWith({ secrets: ["GEMINI_API_KEY", "EDAMAM_APP_ID", "EDAMAM_APP_KEY"] }).https.onCall(async (data, context) => {
    const ingredientName = data.ingredientName;
    console.log(`--- Starte Prozess für: "${ingredientName}" ---`);

    // Greife auf die Secrets über process.env zu
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const EDAMAM_APP_ID = process.env.EDAMAM_APP_ID;
    const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY;

    if (!GEMINI_API_KEY || !EDAMAM_APP_ID || !EDAMAM_APP_KEY) {
        console.error("Fehler: API-Schlüssel wurden in der Umgebung nicht gefunden.");
        throw new functions.https.HttpsError('internal', 'API-Schlüssel auf dem Server nicht konfiguriert.');
    }

    try {
        // --- Schritt 1: Gemini für die Kategorie ---
        console.log("1. Frage Gemini nach der Kategorie...");
        const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
        const geminiPromptCategory = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
        const categoryResponse = await askGemini(geminiPromptCategory, GEMINI_API_KEY);
        console.log(`   -> Antwort von Gemini (Kategorie): "${categoryResponse}"`);
        let foundCategory = 'Sonstiges';
        for (const cat of categories) { if (categoryResponse.includes(cat)) { foundCategory = cat; break; } }

        // --- Schritt 2: Gemini für die englische Übersetzung ---
        console.log("2. Frage Gemini nach der Übersetzung...");
        const geminiPromptTranslate = `Was ist die einfachste, gebräuchlichste englische Übersetzung für das Lebensmittel '${ingredientName}'? Antworte NUR mit den übersetzten Wörtern.`;
        const englishName = await askGemini(geminiPromptTranslate, GEMINI_API_KEY);
        console.log(`   -> Antwort von Gemini (Übersetzung): "${englishName}"`);

        // --- Schritt 3: Edamam für die Nährwerte ---
        const ingredientQuery = `100g ${englishName}`;
        const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=${encodeURIComponent(ingredientQuery)}`;
        console.log(`3. Frage Edamam an mit: "${ingredientQuery}"`);
        
        const edamamResponse = await fetch(edamamUrl);
        const edamamData = await edamamResponse.json();
        console.log("   -> Rohe Antwort von Edamam:", JSON.stringify(edamamData, null, 2));
        
        // --- Schritt 4: Ergebnisse bündeln ---
        // Wir senden die rohen Daten zurück, die Auswertung macht die admin.js
        console.log(`--- Prozess für "${ingredientName}" abgeschlossen. ---`);
        return {
            category: foundCategory,
            englishName: englishName,
            rawEdamamData: edamamData // Gib die rohe Antwort zurück
        };

    } catch (error) {
        console.error(`Fehler bei der Verarbeitung von "${ingredientName}":`, error);
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

