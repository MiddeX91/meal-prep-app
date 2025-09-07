document.addEventListener('DOMContentLoaded', () => {

    // === FIREBASE-VERKNÜPFUNG ERSTELLEN ===
    // HINWEIS: Firebase selbst wird durch /__/firebase/init.js initialisiert.
    const db = firebase.firestore();

    // === DOM-ELEMENTE ===
    const fixMiscButton = document.getElementById('fix-misc-btn');
    const enrichLexikonButton = document.getElementById('enrich-lexikon-btn');
    const processRawButton = document.getElementById('process-raw-btn');
    const calculateNutritionButton = document.getElementById('calculate-nutrition-btn');
    const statusDiv = document.getElementById('status');

    // === HILFSFUNKTIONEN ===
    function setButtonsDisabled(disabled) {
        fixMiscButton.disabled = disabled;
        enrichLexikonButton.disabled = disabled;
        processRawButton.disabled = disabled;
        calculateNutritionButton.disabled = disabled;
    }

    const delay = ms => new Promise(res => setTimeout(res, ms));

    // === EVENT LISTENER ===
    enrichLexikonButton.addEventListener('click', () => processMaintenance('anreichern'));
    fixMiscButton.addEventListener('click', () => processMaintenance('Sonstiges'));
    processRawButton.addEventListener('click', processRawData);
    calculateNutritionButton.addEventListener('click', calculateAndSetRecipeNutrition);


    // =================================================================
    // FUNKTIONEN FÜR DATENBANK-WARTUNG (ZUTATEN)
    // =================================================================


async function processRawData() {
    statusDiv.textContent = 'Starte Verarbeitung der RAW-Daten...\nLese alle Dokumente aus zutatenLexikonRAW...';
    setButtonsDisabled(true);

    try {
        const snapshot = await db.collection('zutatenLexikonRAW').get();
        if (snapshot.empty) {
            statusDiv.textContent += '\nKeine Dokumente in zutatenLexikonRAW gefunden.';
            setButtonsDisabled(false);
            return;
        }
        
        statusDiv.textContent += `\n${snapshot.size} Dokumente gefunden. Starte Extraktion...`;
        
        const batch = db.batch();
        let processedCount = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const nutrients = data.rawData?.totalNutrients; // Sicherer Zugriff auf Nährwerte

            // Überspringe, wenn keine Nährwertdaten vorhanden sind
            if (!nutrients) {
                statusDiv.textContent += `\n- WARNUNG: Kein 'totalNutrients' in "${data.name}". Überspringe.`;
                continue;
            }

            // Erstelle das saubere Objekt für die Zieldatenbank
            const processedIngredient = {
                name: data.name,
                englisch: data.englisch,
                kategorie: data.kategorie,
                kalorien_pro_100g: Math.round(nutrients.ENERC_KCAL?.quantity ?? 0),
                nährwerte_pro_100g: {
                    carbs: Math.round(nutrients.CHOCDF?.quantity ?? 0),
                    fat: Math.round(nutrients.FAT?.quantity ?? 0),
                    protein: Math.round(nutrients.PROCNT?.quantity ?? 0)
                }
            };
            
            // Hol den Referenz-Pfad für das Zieldokument in zutatenLexikon
            const targetDocId = data.name.toLowerCase().replace(/\//g, '-');
            const targetDocRef = db.collection('zutatenLexikon').doc(targetDocId);

            // Füge die Update-Operation zum Batch hinzu
            // { merge: true } ist wichtig, damit andere Felder nicht überschrieben werden!
            batch.set(targetDocRef, processedIngredient, { merge: true });
            
            statusDiv.textContent += `\n- Verarbeite "${data.name}"... OK`;
            processedCount++;
        }
        
        statusDiv.textContent += `\n\nSchreibe ${processedCount} verarbeitete Dokumente in die Datenbank...`;
        await batch.commit(); // Führt alle Schreibvorgänge auf einmal aus
        
        statusDiv.textContent += `\n🎉 Prozess abgeschlossen! ${processedCount} Dokumente wurden erfolgreich in 'zutatenLexikon' geschrieben/aktualisiert.`;

    } catch (error) {
        statusDiv.textContent += `\n\n❌ FEHLER bei der Verarbeitung: ${error.message}`;
        console.error("Fehler beim Verarbeiten der RAW-Daten:", error);
    } finally {
        setButtonsDisabled(false);
    }
}


/**
 * Hauptfunktion für Wartungsarbeiten ("Sonstiges" & "Anreichern").
 */
async function processMaintenance(mode) {
    // Diese Funktion bleibt wie sie war.
    const modeText = mode === 'Sonstiges' ? '"Sonstiges" aufräumen' : 'Lexikon anreichern';
    statusDiv.textContent = `Starte Prozess: "${modeText}"...\nSuche nach relevanten Einträgen...`;
    setButtonsDisabled(true);

    try {
        const snapshot = await db.collection('zutatenLexikon').get();
        let itemsToProcess = [];

        if (mode === 'Sonstiges') {
            itemsToProcess = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => item.kategorie === 'Sonstiges');
        } else {
            itemsToProcess = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => !item.nährwerte_pro_100g);
        }

        if (itemsToProcess.length === 0) {
            statusDiv.textContent += '\nKeine relevanten Einträge gefunden.';
            return;
        }

        statusDiv.textContent += `\n${itemsToProcess.length} Einträge gefunden. Starte Verarbeitung...\n---`;
        
        let successCount = 0, errorCount = 0;
        for (const item of itemsToProcess) {
            const success = await processSingleIngredient(item.name);
            if (success) successCount++;
            else errorCount++;
        }
        statusDiv.textContent += `\n---\n🎉 Prozess für "${modeText}" abgeschlossen!\nErfolgreich: ${successCount} | Fehlgeschlagen: ${errorCount}`;

    } catch (error) {
        statusDiv.textContent += `\n❌ Schwerwiegender Fehler im Hauptprozess: ${error.message}`;
        console.error("Schwerwiegender Fehler: ", error);
    } finally {
        setButtonsDisabled(false);
    }
}


   // =================================================================
    // FUNKTION FÜR REZEPT-MANAGEMENT
    // =================================================================

    async function calculateAndSetRecipeNutrition() {
        statusDiv.textContent = 'Starte Prozess: Nährwerte für Rezepte berechnen...\n';
        setButtonsDisabled(true);

        try {
            // 1. Lade das gesamte Zutatenlexikon in den Speicher für schnellen Zugriff
            statusDiv.textContent += 'Lade Zutatenlexikon...';
            const lexikonSnapshot = await db.collection('zutatenLexikon').get();
            const lexikonMap = new Map();
            lexikonSnapshot.forEach(doc => {
                lexikonMap.set(doc.data().name.toLowerCase(), doc.data());
            });
            statusDiv.textContent += ` ✅ (${lexikonMap.size} Einträge geladen)\n`;

            // 2. Lade alle Rezepte
            statusDiv.textContent += 'Lade alle Rezepte...';
            const recipesSnapshot = await db.collection('rezepte').get();
            statusDiv.textContent += ` ✅ (${recipesSnapshot.size} Rezepte gefunden)\n\n`;
            
            const batch = db.batch();
            let recipesUpdatedCount = 0;
            let ingredientsCreatedCount = 0;

            for (const recipeDoc of recipesSnapshot.docs) {
                const recipe = recipeDoc.data();
                statusDiv.textContent += `- Verarbeite "${recipe.title}"...`;

                if (!recipe.ingredients || recipe.ingredients.length === 0) {
                    statusDiv.textContent += ' -> ⚠️ Keine Zutaten, übersprungen.\n';
                    continue;
                }

                let totalKcal = 0;
                let totalProtein = 0;
                let totalCarbs = 0;
                let totalFat = 0;
                let missingIngredients = [];
                let allIngredientsFound = true;

                for (const ingredient of recipe.ingredients) {
                    const ingredientNameKey = ingredient.name.toLowerCase();
                    const lexikonData = lexikonMap.get(ingredientNameKey);

                    if (lexikonData && lexikonData.kalorien_pro_100g !== undefined) {
                        const factor = (ingredient.amount || 0) / 100;
                        totalKcal += (lexikonData.kalorien_pro_100g || 0) * factor;
                        totalProtein += (lexikonData.nährwerte_pro_100g?.protein || 0) * factor;
                        totalCarbs += (lexikonData.nährwerte_pro_100g?.carbs || 0) * factor;
                        totalFat += (lexikonData.nährwerte_pro_100g?.fat || 0) * factor;
                    } else {
                        missingIngredients.push(ingredient.name);
                        allIngredientsFound = false;
                    }
                }

                if (allIngredientsFound) {
                    const recipeRef = db.collection('rezepte').doc(recipeDoc.id);
                    batch.update(recipeRef, {
                        basis_kalorien: Math.round(totalKcal),
                        basis_makros: {
                            protein: Math.round(totalProtein),
                            carbs: Math.round(totalCarbs),
                            fat: Math.round(totalFat)
                        }
                    });
                    recipesUpdatedCount++;
                    statusDiv.textContent += ` -> ✅ Berechnet: ${Math.round(totalKcal)} kcal\n`;
                } else {
                    // NEU: Logik zum Anlegen fehlender Zutaten
                    statusDiv.textContent += ` -> ⚠️ Rezept übersprungen. Folgende Zutaten fehlen im Lexikon:\n`;
                    for (const missingName of missingIngredients) {
                        const missingNameKey = missingName.toLowerCase();
                        // Prüfen, ob wir es nicht schon in diesem Durchgang hinzugefügt haben
                        if (!lexikonMap.has(missingNameKey)) {
                            const docId = missingNameKey.replace(/\//g, '-');
                            const newIngredientRef = db.collection('zutatenLexikon').doc(docId);
                            batch.set(newIngredientRef, { name: missingName });
                            
                            // Füge es zur Map hinzu, um Duplikate im selben Batch zu vermeiden
                            lexikonMap.set(missingNameKey, { name: missingName });
                            ingredientsCreatedCount++;
                            statusDiv.textContent += `    -> ➕ Lege Platzhalter für "${missingName}" an.\n`;
                        }
                    }
                }
            }

            if (recipesUpdatedCount > 0 || ingredientsCreatedCount > 0) {
                statusDiv.textContent += `\nSpeichere Änderungen... (${recipesUpdatedCount} Rezepte, ${ingredientsCreatedCount} neue Zutaten)`;
                await batch.commit();
                statusDiv.textContent += ' ✅\n';
            }

            statusDiv.textContent += `\n🎉 Prozess abgeschlossen!`;

        } catch (error) {
            statusDiv.textContent += `\n\n❌ Ein schwerwiegender Fehler ist aufgetreten: ${error.message}`;
            console.error(error);
        } finally {
            setButtonsDisabled(false);
        }
    }

}); // Ende des DOMContentLoaded-Listeners

