const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    const { ingredientName } = JSON.parse(event.body);
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY nicht gefunden.' }) };
    }

    // NEUE, KORREKTE URL ZUM AKTUELLEN MODELL
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const prompt = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [Gemüse & Obst, Milchprodukte, Fleisch & Fisch, Trockenwaren, Backzutaten, Gewürze & Öle, Sonstiges]`;
    
    const requestBody = {
        contents: [{ parts: [{ text: prompt }] }]
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok || !data.candidates) {
            console.error("Ungültige Antwort von Gemini:", data);
            throw new Error(data.error?.message || 'Keine Kandidaten zurückgegeben.');
        }

        const category = data.candidates[0].content.parts[0].text.trim();

        return {
            statusCode: 200,
            body: JSON.stringify({ category: category })
        };

    } catch (error) {
        console.error("Fehler in der categorize-ingredient Funktion:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Fehler bei der Kommunikation mit der KI.', details: error.message })
        };
    }
};