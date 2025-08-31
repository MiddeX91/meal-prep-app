const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    const { ingredientName } = JSON.parse(event.body);
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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

        // === SCHRITT 2: OPENFOODFACTS (mit verbessertem Logging) ===
        const offUrl = `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(ingredientName)}&fields=product_name,nutriments&page_size=1&json=true`;
        
        console.log("Frage OpenFoodFacts an unter:", offUrl); // NEUES LOG
        
        const offResponse = await fetch(offUrl);
        const offData = await offResponse.json();

        console.log("Antwort von OpenFoodFacts:", JSON.stringify(offData, null, 2)); // NEUES LOG
        
        let nutritions = { kalorien: 0, protein: 0, fett: 0, kohlenhydrate: 0 };
        if (offData.products && offData.products.length > 0 && offData.products[0].nutriments) {
            const nutriments = offData.products[0].nutriments;
            nutritions.kalorien = nutriments['energy-kcal_100g'] || 0;
            nutritions.protein = nutriments.proteins_100g || 0;
            nutritions.fett = nutriments.fat_100g || 0;
            nutritions.kohlenhydrate = nutriments.carbohydrates_100g || 0;
        } else {
            console.warn(`Keine Nährwerte für "${ingredientName}" bei OpenFoodFacts gefunden.`); // NEUES LOG
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