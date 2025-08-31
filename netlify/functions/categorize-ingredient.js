const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    const { ingredientName } = JSON.parse(event.body);
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const prompt = `In welche dieser Supermarkt-Kategorien passt '${ingredientName}' am besten? Antworte NUR mit dem exakten Kategorienamen. Kategorien: [Gemüse & Obst, Milchprodukte, Fleisch & Fisch, Trockenwaren, Backzutaten, Gewürze & Öle, Sonstiges]`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Gemini API-Fehler: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();
        const category = data.candidates[0].content.parts[0].text.trim();

        return {
            statusCode: 200,
            body: JSON.stringify({ category: category })
        };
    } catch (error) {
        console.error("Fehler in der categorize-ingredient Funktion:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Fehler bei der Kommunikation mit der KI.' })
        };
    }
};