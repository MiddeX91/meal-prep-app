const functions = require("firebase-functions");
const fetch = require("node-fetch");

// Wir laden die Konfiguration auf dem alten, aber zuverlässigen Weg
const config = functions.config();
const GEMINI_API_KEY = config.gemini.key;
const EDAMAM_APP_ID = config.edamam.app_id;
const EDAMAM_APP_KEY = config.edamam.app_key;

exports.categorizeIngredient = functions.https.onCall(async (data, context) => {
    const ingredientName = data.ingredientName;
    console.log(`--- Starte Prozess für: "${ingredientName}" ---`);

    // Wir greifen auf die oben geladenen Schlüssel zu
    if (!GEMINI_API_KEY || !EDAMAM_APP_ID || !EDAMAM_APP_KEY) {
        console.error("Fehler: API-Schlüssel wurden via functions.config() nicht gefunden.");
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
    const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${process.env.EDAMAM_APP_ID}&app_key=${process.env.EDAMAM_APP_KEY}&ingr=${encodeURIComponent(ingredientQuery)}`;
    
    console.log(`3. Frage Edamam an mit: "${ingredientQuery}"`);
    const edamamResponse = await fetch(edamamUrl);
    const edamamData = await edamamResponse.json();
    console.log("   -> Rohe Antwort von Edamam:", JSON.stringify(edamamData, null, 2));
    
    let nutritions = null;
    let nutrientsSource = null; // Variable, um die Quelle der Nährwerte zu speichern

    // VERSUCH 1: Suche in 'totalNutrients' (die häufigste, korrekte Antwort)
    if (edamamData && edamamData.totalNutrients && edamamData.totalNutrients.ENERC_KCAL) {
        nutrientsSource = edamamData.totalNutrients;
        console.log("   -> Nährwerte in 'totalNutrients' gefunden.");
    } 
    // VERSUCH 2: Wenn das fehlschlägt, suche in 'parsed' (die andere Variante)
    else if (edamamData.parsed && edamamData.parsed.length > 0 && edamamData.parsed[0].nutrients) {
        nutrientsSource = edamamData.parsed[0].nutrients;
        console.log("   -> Nährwerte in 'parsed' gefunden.");
    }

    // Wenn eine Quelle gefunden wurde, extrahiere die Daten
    if (nutrientsSource) {
        nutritions = {
            kalorien: nutrientsSource.ENERC_KCAL ? Math.round(nutrientsSource.ENERC_KCAL.quantity) : 0,
            protein: nutrientsSource.PROCNT ? Math.round(nutrientsSource.PROCNT.quantity) : 0,
            fett: nutrientsSource.FAT ? Math.round(nutrientsSource.FAT.quantity) : 0,
            kohlenhydrate: nutrientsSource.CHOCDF ? Math.round(nutrientsSource.CHOCDF.quantity) : 0
        };
        console.log("   -> Nährwerte erfolgreich extrahiert:", nutritions);
    } else {
        console.warn("   -> Konnte in KEINER der bekannten Strukturen Nährwerte finden.");
    }

    // --- Schritt 4: Ergebnisse kombinieren (unverändert) ---
    const finalLexikonEntry = {
        name: ingredientName,
        kategorie: foundCategory,
        nährwerte_pro_100g: nutritions,
        english_name: englishName
    };

    console.log(`--- Prozess für "${ingredientName}" abgeschlossen. ---`);
    return { category: foundCategory, fullData: finalLexikonEntry };

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