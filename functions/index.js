const { onCall, HttpsError } = require("firebase-functions/v2/https"); // Korrigiert: onCall kommt von 'https'
const { onDocumentWritten } = require("firebase-functions/v2/firestore"); // Korrigiert: Nur Firestore-Trigger hier
const fetch = require("node-fetch");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// ============== HILFSFUNKTIONEN (BLEIBEN GLEICH) ==============

const delay = ms => new Promise(res => setTimeout(res, ms));

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

// ============== AUFRUFBARE FUNKTIONEN FÜR ADMIN-PANEL (BLEIBEN GLEICH) ==============

exports.getIngredientCategory = onCall({ secrets: ["GEMINI_API_KEY"] }, async (request) => {
    // ... unverändert ...
    const ingredientName = request.data.ingredientName;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!ingredientName) throw new HttpsError('invalid-argument', 'ingredientName fehlt.');
    try {
        const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
        const prompt = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
        const category = await askGemini(prompt, GEMINI_API_KEY);
        return { category: category };
    } catch (error) {
        console.error(`Fehler bei der Kategorisierung von "${ingredientName}":`, error);
        throw new HttpsError('internal', `Fehler bei Gemini (Kategorie): ${error.message}`);
    }
});

exports.translateIngredient = onCall({ secrets: ["GEMINI_API_KEY"] }, async (request) => {
    // ... unverändert ...
    const ingredientName = request.data.ingredientName;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!ingredientName) throw new HttpsError('invalid-argument', 'ingredientName fehlt.');
    try {
        const prompt = `Was ist die einfachste, gebräuchlichste englische Übersetzung für das Lebensmittel '${ingredientName}'? Antworte NUR mit den übersetzten Wörtern.`;
        const translation = await askGemini(prompt, GEMINI_API_KEY);
        return { translation: translation };
    } catch(error) {
        console.error(`Fehler bei der Übersetzung von "${ingredientName}":`, error);
        throw new HttpsError('internal', `Fehler bei Gemini (Übersetzung): ${error.message}`);
    }
});

exports.getNutritionData = onCall({ secrets: ["EDAMAM_APP_ID", "EDAMAM_APP_KEY"] }, async (request) => {
    // ... unverändert ...
    const englishName = request.data.englishName;
    const EDAMAM_APP_ID = process.env.EDAMAM_APP_ID;
    const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY;
    if (!englishName) throw new HttpsError('invalid-argument', 'englishName fehlt.');
    const ingredientQuery = `100g ${englishName}`;
    const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=${encodeURIComponent(ingredientQuery)}`;
    try {
        const edamamResponse = await fetch(edamamUrl);
        if (!edamamResponse.ok) {
            return { error: `Edamam API-Fehler: Status ${edamamResponse.status}` };
        }
        const nutritionData = await edamamResponse.json();
        return { nutrition: nutritionData };
    } catch (error) {
        console.error(`Netzwerkfehler bei Edamam für "${englishName}":`, error);
        throw new HttpsError('internal', `Fehler bei der Edamam-Anfrage: ${error.message}`);
    }
});


// ============== NEUE AUTOMATISIERUNGS-FUNKTION ==============

/**
 * Dieser Trigger wird ausgeführt, wenn ein Dokument in `zutatenLexikon`
 * geschrieben wird. Er prüft, ob Nährwerte fehlen und reichert sie an.
 */
exports.autoEnrichIngredient = onDocumentWritten(
    {
        document: "zutatenLexikon/{ingredientId}",
        secrets: ["GEMINI_API_KEY", "EDAMAM_APP_ID", "EDAMAM_APP_KEY"]
    }, 
    async (event) => {
        const snapshot = event.data.after;
        const ingredientData = snapshot.data();
        const ingredientName = ingredientData.name;

        // Bricht ab, wenn kein Dokument existiert oder die Nährwerte schon da sind.
        if (!snapshot.exists || ingredientData.nährwerte_pro_100g) {
            console.log(`Keine Aktion für "${ingredientName}" nötig (existiert nicht oder ist bereits angereichert).`);
            return null;
        }
        
        console.log(`Automatischer Anreicherungsprozess für "${ingredientName}" gestartet...`);

        try {
            // === SCHRITT 1 & 2: Kategorie und Übersetzung holen ===
            const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
            const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
            const categoryPrompt = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
            const translationPrompt = `Was ist die einfachste, gebräuchlichste englische Übersetzung für das Lebensmittel '${ingredientName}'? Antworte NUR mit den übersetzten Wörtern.`;
            
            const [kategorie, englisch] = await Promise.all([
                askGemini(categoryPrompt, GEMINI_API_KEY),
                askGemini(translationPrompt, GEMINI_API_KEY)
            ]);
            console.log(`"${ingredientName}" -> Kategorie: ${kategorie}, Englisch: ${englisch}`);

            // === SCHRITT 3: Edamam-Daten holen (mit Retry-Logik) ===
            const EDAMAM_APP_ID = process.env.EDAMAM_APP_ID;
            const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY;
            const ingredientQuery = `100g ${englisch}`;
            const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=${encodeURIComponent(ingredientQuery)}`;
            
            let edamamData = null;
            for (let attempt = 1; attempt <= 6; attempt++) {
                const edamamResponse = await fetch(edamamUrl);
                if (edamamResponse.ok) {
                    edamamData = await edamamResponse.json();
                    break;
                }
                if (edamamResponse.status === 429 && attempt < 6) {
                    console.log(`Edamam Rate Limit für "${englisch}". Warte 10 Sekunden...`);
                    await delay(10000);
                } else {
                    throw new Error(`Edamam API-Fehler nach ${attempt} Versuchen: Status ${edamamResponse.status}`);
                }
            }
            if (!edamamData) throw new Error("Konnte keine Daten von Edamam abrufen.");

            // === SCHRITT 4: RAW-Daten speichern ===
            const rawDocRef = db.collection('zutatenLexikonRAW').doc(snapshot.id);
            await rawDocRef.set({ name: ingredientName, retrievedAt: new Date(), kategorie, englisch, rawData: edamamData }, { merge: true });
            console.log(`RAW-Daten für "${ingredientName}" gespeichert.`);

            // === SCHRITT 5: Saubere Daten extrahieren und in zutatenLexikon schreiben ===
            const nutrients = edamamData.totalNutrients;
            const processedData = {
                name: ingredientName,
                englisch: englisch,
                kategorie: kategorie,
                kalorien_pro_100g: Math.round(nutrients.ENERC_KCAL?.quantity ?? 0),
                nährwerte_pro_100g: {
                    carbs: Math.round(nutrients.CHOCDF?.quantity ?? 0),
                    fat: Math.round(nutrients.FAT?.quantity ?? 0),
                    protein: Math.round(nutrients.PROCNT?.quantity ?? 0)
                }
            };
            
            // Schreibe die aufbereiteten Daten in das Dokument, das den Trigger ausgelöst hat.
            await snapshot.ref.set(processedData, { merge: true });
            console.log(`✅ Erfolgreich "${ingredientName}" mit sauberen Daten angereichert.`);
            
            return null;

        } catch (error) {
            console.error(`Fehler bei der automatischen Anreicherung von "${ingredientName}":`, error);
            // Optional: Fehlerstatus im Dokument vermerken
            await snapshot.ref.set({ error: error.message, lastAttempt: new Date() }, { merge: true });
            return null;
        }
    }
);

