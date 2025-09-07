const { onCall } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const fetch = require("node-fetch");
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// =================================================================
// AUFRUFBARE FUNKTIONEN (Für Admin-Panel)
// =================================================================

exports.getIngredientCategory = onCall({ secrets: ["GEMINI_API_KEY"] }, async (request) => {
    const ingredientName = request.data.ingredientName;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
    const prompt = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
    
    const response = await askGemini(prompt, GEMINI_API_KEY);
    const category = response.candidates[0].content.parts[0].text.trim();
    return { category: category, raw: response };
});

exports.translateIngredient = onCall({ secrets: ["GEMINI_API_KEY"] }, async (request) => {
    const ingredientName = request.data.ingredientName;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    // --- VERBESSERTER PROMPT ---
    const prompt = `Was ist die präziseste englische Übersetzung für die Zutat '${ingredientName}' für eine Nährwert-Datenbank? Füge wichtige Details wie "canned", "cooked", "raw" oder "dried" hinzu, wenn sie für die Nährwerte relevant sind. Antworte NUR mit den übersetzten Wörtern.`;
    
    const response = await askGemini(prompt, GEMINI_API_KEY);
    const englishName = response.candidates[0].content.parts[0].text.trim();
    return { englishName: englishName, raw: response };
});

exports.getNutritionData = onCall({ secrets: ["EDAMAM_APP_ID", "EDAMAM_APP_KEY"] }, async (request) => {
    // ... (Diese Funktion bleibt unverändert)
    const englishName = request.data.englishName;
    const EDAMAM_APP_ID = process.env.EDAMAM_APP_ID;
    const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY;
    const ingredientQuery = `100g ${englishName}`;
    const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=${encodeURIComponent(ingredientQuery)}`;

    const edamamData = await fetchEdamamWithRetry(edamamUrl);

    if (edamamData.error) {
        return { nutrition: null, raw: edamamData };
    }
    
    const nutrients = edamamData.totalNutrients;
    const cleanNutrition = {
        calories: Math.round(nutrients.ENERC_KCAL?.quantity || 0),
        protein: Math.round(nutrients.PROCNT?.quantity || 0),
        carbs: Math.round(nutrients.CHOCDF?.quantity || 0),
        fat: Math.round(nutrients.FAT?.quantity || 0)
    };
    return { nutrition: cleanNutrition, raw: edamamData };
});


// =================================================================
// AUTOMATISCHER TRIGGER
// =================================================================

exports.autoEnrichIngredient = onDocumentWritten("zutatenLexikon/{ingredientId}", async (event) => {
    // ... (Diese Funktion bleibt unverändert)
    const snapshot = event.data.after;
    const ingredientData = snapshot.data();
    const ingredientName = ingredientData.name;

    if (!snapshot.exists || ingredientData.nährwerte_pro_100g) {
        console.log(`Keine Aktion für "${ingredientName}" nötig (existiert nicht oder ist bereits angereichert).`);
        return null;
    }

    console.log(`Automatischer Anreicherungsprozess für "${ingredientName}" gestartet...`);
    
    try {
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        const EDAMAM_APP_ID = process.env.EDAMAM_APP_ID;
        const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY;

        const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
        const categoryPrompt = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
        const categoryResponse = await askGemini(categoryPrompt, GEMINI_API_KEY);
        const kategorie = categoryResponse.candidates[0].content.parts[0].text.trim();

        const translatePrompt = `Was ist die präziseste englische Übersetzung für die Zutat '${ingredientName}' für eine Nährwert-Datenbank? Füge wichtige Details wie "canned", "cooked", "raw" oder "dried" hinzu, wenn sie für die Nährwerte relevant sind. Antworte NUR mit den übersetzten Wörtern.`;
        const translateResponse = await askGemini(translatePrompt, GEMINI_API_KEY);
        const englisch = translateResponse.candidates[0].content.parts[0].text.trim();

        const ingredientQuery = `100g ${englisch}`;
        const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=${encodeURIComponent(ingredientQuery)}`;
        const edamamData = await fetchEdamamWithRetry(edamamUrl);

        await db.collection('zutatenLexikonRAW').doc(snapshot.id).set({
            name: ingredientName,
            retrievedAt: new Date(),
            rawCategoryData: categoryResponse,
            rawTranslateData: translateResponse,
            rawNutritionData: edamamData
        }, { merge: true });

        if (edamamData.error) throw new Error(edamamData.error);
        
        const nutrients = edamamData.totalNutrients;
        const cleanData = {
            name: ingredientName,
            kategorie: kategorie,
            englisch: englisch,
            kalorien_pro_100g: Math.round(nutrients.ENERC_KCAL?.quantity || 0),
            nährwerte_pro_100g: {
                protein: Math.round(nutrients.PROCNT?.quantity || 0),
                carbs: Math.round(nutrients.CHOCDF?.quantity || 0),
                fat: Math.round(nutrients.FAT?.quantity || 0)
            }
        };

        return snapshot.ref.set(cleanData, { merge: true });

    } catch (error) {
        console.error(`Fehler bei der automatischen Anreicherung von "${ingredientName}":`, error);
        return snapshot.ref.set({ error: error.message }, { merge: true });
    }
});


// =================================================================
// HILFSFUNKTIONEN
// =================================================================
async function askGemini(prompt, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    const data = await response.json();
    if (!response.ok || !data.candidates) {
        throw new Error(data.error?.message || 'Ungültige Antwort von Gemini.');
    }
    return data;
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchEdamamWithRetry(url) {
    const MAX_RETRIES = 6;
    const RETRY_DELAY = 10000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const response = await fetch(url);
        if (response.ok) {
            try { return await response.json(); } 
            catch (e) { return { error: "Ungültige JSON-Antwort von Edamam" }; }
        }
        if (response.status === 429 && attempt < MAX_RETRIES) {
            await delay(RETRY_DELAY);
        } else {
            return { error: `Edamam API-Fehler: Status ${response.status}` };
        }
    }
}

