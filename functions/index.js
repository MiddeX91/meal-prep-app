/**
 * Hauptdatei für alle Cloud Functions der Meal-Prep-App.
 * Enthält:
 * - callable Functions für das Admin-Panel (Kategorie, Übersetzung, Nährwerte)
 * - einen Firestore-Trigger zur automatischen Anreicherung des Zutaten-Lexikons
 * - eine callable Function zur Generierung neuer Rezept-Ideen mit Gemini
 */

// Firebase SDKs importieren
const { onCall } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

// Firebase Admin SDK initialisieren
admin.initializeApp();

// =============================================================
// HILFSFUNKTIONEN
// =============================================================

/**
 * Eine einfache Pause-Funktion.
 * @param {number} ms - Die Wartezeit in Millisekunden.
 */
const delay = ms => new Promise(res => setTimeout(res, ms));

/**
 * Führt eine fetch-Anfrage an die Edamam-API aus und wiederholt sie bei
 * einem Rate-Limit-Fehler (Status 429) bis zu 6 Mal.
 * @param {string} url - Die vollständige Edamam-API-URL.
 * @returns {Promise<object>} Das JSON-Objekt von der Edamam-API.
 */
async function fetchEdamamWithRetry(url) {
    const MAX_RETRIES = 6;
    const RETRY_DELAY = 10000; // 10 Sekunden

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`Edamam-Versuch ${attempt}/${MAX_RETRIES} für: ${url}`);
        const response = await fetch(url);

        if (response.ok) {
            try {
                return await response.json();
            } catch (e) {
                return { error: "Ungültige JSON-Antwort von Edamam" };
            }
        }

        if (response.status === 429 && attempt < MAX_RETRIES) {
            console.log(`Status 429 erhalten. Warte ${RETRY_DELAY / 1000} Sekunden...`);
            await delay(RETRY_DELAY);
        } else {
            console.error(`Edamam-Anfrage fehlgeschlagen mit Status: ${response.status}`);
            return { error: `Edamam API-Fehler: Status ${response.status}` };
        }
    }
}

// =============================================================
// AUFRUFBARE FUNKTIONEN (Callable Functions) für Admin-Panel
// =============================================================

exports.getIngredientCategory = onCall({ secrets: ["GEMINI_API_KEY"], cors: true }, async (request) => {
    const ingredientName = request.data.ingredientName;
    const apiKey = process.env.GEMINI_API_KEY;
    const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
    const prompt = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    const data = await response.json();
    if (!response.ok || !data.candidates) { throw new functions.https.HttpsError('internal', 'Ungültige Antwort von der Gemini API.'); }
    const category = data.candidates[0].content.parts[0].text.trim();
    return { category };
});

exports.translateIngredient = onCall({ secrets: ["GEMINI_API_KEY"], cors: true }, async (request) => {
    const ingredientName = request.data.ingredientName;
    const apiKey = process.env.GEMINI_API_KEY;
    const prompt = `Was ist die gebräuchlichste und präziseste englische Übersetzung für das Lebensmittel '${ingredientName}' zur Verwendung in einer Nährwert-Datenbank? Bei Dingen wie "Kidneybohnen (Dose)", gib den Zustand an, z.B. "canned kidney beans". Bei Dingen wie "Magerquark", gib den Fettgehalt an, z.B. "low-fat quark" oder "skim quark". Antworte NUR mit den übersetzten Wörtern.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    const data = await response.json();
    if (!response.ok || !data.candidates) { throw new functions.https.HttpsError('internal', 'Ungültige Antwort von der Gemini API.'); }
    const englishName = data.candidates[0].content.parts[0].text.trim();
    return { englishName };
});

exports.getNutritionData = onCall({ secrets: ["EDAMAM_APP_ID", "EDAMAM_APP_KEY"], cors: true }, async (request) => {
    const englishName = request.data.englishName;
    const appId = process.env.EDAMAM_APP_ID;
    const appKey = process.env.EDAMAM_APP_KEY;
    const ingredientQuery = `100g ${englishName}`;
    const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${appId}&app_key=${appKey}&ingr=${encodeURIComponent(ingredientQuery)}`;
    const edamamData = await fetchEdamamWithRetry(edamamUrl);
    return { rawEdamamData: edamamData };
});

// =============================================================
// REZEPT-GENERATOR
// =============================================================

exports.generateRecipeIdea = onCall({ secrets: ["GEMINI_API_KEY"], cors: true }, async (request) => {
    const { description, mustHave, noGo, tags, calories, maxIngredients, geraete } = request.data;
    const apiKey = process.env.GEMINI_API_KEY;
    
    // **DAS FINALE BRIEFING AN GEMINI**
    let prompt = `Du bist ein kreativer und präziser Koch, der auf Meal-Prep spezialisiert ist. Deine Aufgabe ist es, ein Rezept zu erstellen, das exakt den folgenden Kriterien und Formatierungsregeln entspricht.\n\n`;
    prompt += `1. Kriterien für das Rezept:\n`;
    prompt += `- Beschreibung: "${description}"\n`;
    if (mustHave) prompt += `- Muss enthalten: "${mustHave}"\n`;
    if (noGo) prompt += `- Darf nicht enthalten: "${noGo}"\n`;
    if (tags && tags.length > 0) prompt += `- Tags: ${tags.join(', ')}\n`;
    prompt += `- Kalorien-Ziel: ca. ${calories} kcal\n`;
    prompt += `- Maximale Hauptzutaten: ${maxIngredients} (Gewürze, Salz, Pfeffer und Öl zählen nicht zu diesem Limit).\n`;
    if (geraete && geraete.length > 0) prompt += `- Verfügbare Küchengeräte: ${geraete.join(', ')}\n\n`;

    prompt += `2. WICHTIGE INHALTS- UND FORMATIERUNGSREGELN:\n`;
    prompt += `- Regel A (Haltbarkeit einschätzen): Schätze die Haltbarkeit in Tagen realistisch ein. Berücksichtige empfindliche Zutaten. Gerichte mit rohem Fisch oder Blattsalaten sind 1-2 Tage haltbar. Gerichte mit gekochtem Fleisch oder vegetarische Eintöpfe halten 3-4 Tage.\n`;
    prompt += `- Regel B ("Reifen" definieren): Setze "reift" auf 'true', wenn das Gericht am nächsten Tag besser schmeckt (Eintöpfe, Gulasch, Currys). Setze es auf 'false' für frische Gerichte (Salate, Pfannengerichte).\n`;
    prompt += `- Regel C (Zustand angeben): Für Zutaten wie Reis, Nudeln, Quinoa, Linsen, gib IMMER den trockenen Zustand an. Beispiel: "100g trockener Reis".\n`;
    prompt += `- Regel D (Generische Namen): Gib KEINE Farben oder Sorten an. FALSCH: "Paprika (rot)". RICHTIG: "Paprika".\n`;
    prompt += `- Regel E (Klarheit): Unterscheide klar zwischen Gemüse und Gewürz. Beispiel: "Chilischote" vs. "Chilipulver".\n`;
    prompt += `- Regel F (Keine Mengen für Gewürze): Lasse bei Salz, Pfeffer, getrockneten Gewürzen und frischen Kräutern das Feld "menge_einheit" leer.\n\n`;

    prompt += `3. Ausgabeformat:\n`;
    prompt += `Gib deine Antwort als ein einziges, sauberes JSON-Objekt zurück, OHNE Markdown. Das JSON MUSS die Schlüssel "titel", "art", "haltbarkeit", "reift", "zubereitung" und "zutaten" haben.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    
    const data = await response.json();
    if (!response.ok || !data.candidates) {
        console.error("Gemini API Fehler-Antwort:", data);
        throw new functions.https.HttpsError('internal', 'Ungültige Antwort von der Gemini API.');
    }

    let rawText = data.candidates[0].content.parts[0].text;
    
    if (rawText.startsWith("```json")) {
        rawText = rawText.substring(7, rawText.length - 3).trim();
    }
    
    try {
        const recipeJson = JSON.parse(rawText);
        return recipeJson;
    } catch (error) {
        console.error("Fehler beim Parsen der Gemini JSON-Antwort:", rawText);
        throw new functions.https.HttpsError('internal', 'Fehler beim Parsen des JSON von Gemini.', error.message);
    }
});


// =============================================================
// AUTOMATISIERUNG (Firestore Trigger)
// =============================================================

exports.autoEnrichIngredient = onDocumentWritten("zutatenLexikon/{ingredientId}", async (event) => {
    const snapshot = event.data?.after;
    if (!snapshot) { 
        console.log("Kein 'after'-Snapshot gefunden, Aktion wird übersprungen.");
        return null; 
    }

    const ingredientData = snapshot.data();
    if (!snapshot.exists || !ingredientData || !ingredientData.name || ingredientData.nährwerte_pro_100g) {
        console.log(`Keine Aktion für Dokument ${snapshot.id} nötig (existiert nicht, hat keine Daten oder ist bereits angereichert).`);
        return null;
    }

    console.log(`Automatischer Anreicherungsprozess für "${ingredientData.name}" gestartet...`);

    try {
        const getCategoryFunc = functions.httpsCallable('getIngredientCategory');
        const translateFunc = functions.httpsCallable('translateIngredient');
        const getNutritionFunc = functions.httpsCallable('getNutritionData');

        const { category } = (await getCategoryFunc({ ingredientName: ingredientData.name })).data;
        const { englishName } = (await translateFunc({ ingredientName: ingredientData.name })).data;
        const { rawEdamamData } = (await getNutritionFunc({ englishName })).data;

        if (rawEdamamData.error) {
            throw new Error(`Edamam Fehler für "${ingredientData.name}": ${rawEdamamData.error}`);
        }
        
        const nutrients = rawEdamamData?.totalNutrients || {};
        const cleanData = {
            kategorie: category,
            englisch: englishName,
            kalorien_pro_100g: Math.round(nutrients.ENERC_KCAL?.quantity ?? 0),
            nährwerte_pro_100g: {
                protein: parseFloat((nutrients.PROCNT?.quantity ?? 0).toFixed(1)),
                carbs: parseFloat((nutrients.CHOCDF?.quantity ?? 0).toFixed(1)),
                fat: parseFloat((nutrients.FAT?.quantity ?? 0).toFixed(1)),
            },
        };

        const db = admin.firestore();
        const batch = db.batch();

        batch.update(snapshot.ref, cleanData);
        batch.set(db.collection('zutatenLexikonRAW').doc(snapshot.id), {
            name: ingredientData.name,
            retrievedAt: new Date(),
            rawData: rawEdamamData, // KORREKTE VARIABLE VERWENDET
        }, { merge: true });

        await batch.commit();
        console.log(`Erfolgreich "${ingredientData.name}" angereichert.`);

    } catch (error) {
        console.error(`Fehler beim Anreichern von "${ingredientData.name}":`, error);
        // Optional: Ein Feld im Dokument setzen, um den Fehler zu markieren
        await snapshot.ref.set({ error: error.message }, { merge: true });
    }
});

