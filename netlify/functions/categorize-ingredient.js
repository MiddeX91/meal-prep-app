const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    const { ingredientName } = JSON.parse(event.body);
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const EDAMAM_APP_ID = process.env.EDAMAM_APP_ID;
    const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY;

    if (!GEMINI_API_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY nicht gefunden.' }) };
    }

    try {
        // === SCHRITT 1: FRAGE GEMINI NACH DER KATEGORIE ===
        const categories = ['Gemüse & Obst', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
        const geminiPrompt = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [${categories.join(', ')}]`;
        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }] })
        });
        const geminiData = await geminiResponse.json();
        if (!geminiResponse.ok || !geminiData.candidates) throw new Error(geminiData.error?.message || 'Keine Kategorie von Gemini erhalten.');
        
        let foundCategory = 'Sonstiges';
        const geminiText = geminiData.candidates[0].content.parts[0].text.trim();
        for (const cat of categories) {
            if (geminiText.includes(cat)) {
                foundCategory = cat;
                break;
            }
        }

        // --- Schritt 2: Edamam für die Nährwerte ---
        const edamamUrl = `https://api.edamam.com/api/nutrition-data?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=100g%20${encodeURIComponent(ingredientName)}`;
        
        const edamamResponse = await fetch(edamamUrl);
        const edamamData = await edamamResponse.json();
        
        let nutritions = { kalorien: 0, protein: 0, fett: 0, kohlenhydrate: 0 };
        if (edamamData.totalNutrients) {
            nutritions.kalorien = Math.round(edamamData.totalNutrients.ENERC_KCAL?.quantity || 0);
            nutritions.protein = Math.round(edamamData.totalNutrients.PROCNT?.quantity || 0);
            nutritions.fett = Math.round(edamamData.totalNutrients.FAT?.quantity || 0);
            nutritions.kohlenhydrate = Math.round(edamamData.totalNutrients.CHOCDF?.quantity || 0);
        }


        // === SCHRITT 3: KOMBINIERE DIE ERGEBNISSE & SENDE ANTWORT ===
        const finalLexikonEntry = {
            name: ingredientName,
            kategorie: foundCategory,
            nährwerte_pro_100g: nutritions
        };

        // Wir senden nur die Kategorie an die Admin-Seite zurück...
        // ...aber die volle Information wird in die Datenbank geschrieben.
        return {
            statusCode: 200,
            body: JSON.stringify({ category: foundCategory, fullData: finalLexikonEntry })
        };

    } catch (error) {
        console.error("Fehler in der categorize-ingredient Funktion:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Fehler bei der API-Kommunikation.', details: error.message })
        };
    }
};