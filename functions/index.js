const fetch = require("node-fetch");

exports.handler = async function(event, context) {
    const { ingredientName } = JSON.parse(event.body); // z.B. "Kirschtomaten"
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const EDAMAM_APP_ID = process.env.EDAMAM_APP_ID;
    const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY;

    if (!GEMINI_API_KEY || !EDAMAM_APP_ID || !EDAMAM_APP_KEY) {
        throw new Error('API-Schlüssel auf dem Server nicht gefunden.');
    }

    try {
        // --- Schritt 1: Gemini für die Kategorie ---
        const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
        const geminiPromptCategory = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
        const categoryResponse = await askGemini(geminiPromptCategory, GEMINI_API_KEY);
        let foundCategory = 'Sonstiges';
        for (const cat of categories) { if (categoryResponse.includes(cat)) { foundCategory = cat; break; } }

        // --- Schritt 2: Gemini für die englische Übersetzung ---
        const geminiPromptTranslate = `Was ist die einfachste, gebräuchlichste englische Übersetzung für das Lebensmittel '${ingredientName}'? Antworte NUR mit den übersetzten Wörtern.`;
        const englishName = await askGemini(geminiPromptTranslate, GEMINI_API_KEY);

        // --- Schritt 3: Edamam für die Nährwerte (mit der englischen Übersetzung) ---
        const ingredientQuery = `100g ${englishName}`;
        const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=${encodeURIComponent(ingredientQuery)}`;
        const edamamResponse = await fetch(edamamUrl);
        const edamamData = await edamamResponse.json();
        
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

        // --- Schritt 4: Ergebnisse kombinieren ---
        const finalLexikonEntry = {
            name: ingredientName, // Originalname für die Anzeige
            kategorie: foundCategory,
            nährwerte_pro_100g: nutritions
        };

        return { statusCode: 200, body: JSON.stringify({ category: foundCategory, fullData: finalLexikonEntry }) };

    } catch (error) {
        console.error("Fehler in der categorize-ingredient Funktion:", error.message);
        return { statusCode: 500, body: JSON.stringify({ error: 'Fehler bei der API-Kommunikation.', details: error.message }) };
    }
};

// Hilfsfunktion, um Gemini-Anfragen zu kapseln
async function askGemini(prompt, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await response.json();
    if (!response.ok || !data.candidates) {
        throw new Error(data.error?.message || 'Ungültige Antwort von Gemini.');
    }
    return data.candidates[0].content.parts[0].text.trim();
}