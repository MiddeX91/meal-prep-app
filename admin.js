document.addEventListener('DOMContentLoaded', async () => {

    // === DOM-ELEMENTE ===
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = 'Initialisiere Firebase und melde an...';

    // === FIREBASE-VERKNÜPFUNG & AUTHENTIFIZIERUNG ===
    try {
        await firebase.auth().signInAnonymously();
        statusDiv.textContent = '✅ Anonym angemeldet. Bereit für Aktionen.';
    } catch (error) {
        statusDiv.textContent = `❌ Fehler bei der anonymen Anmeldung: ${error.message}`;
        console.error("Anmeldefehler:", error);
        return;
    }
    
    const db = firebase.firestore();
    const functions = firebase.functions();
    
    // === DOM-ELEMENTE (Buttons) ===
    const inventoryButton = document.getElementById('inventory-btn');
    const enrichLexikonButton = document.getElementById('enrich-lexikon-btn');
    const processRawButton = document.getElementById('process-raw-btn');
    const calculateNutritionButton = document.getElementById('calculate-nutrition-btn');

    // === HILFSFUNKTIONEN ===
    function setButtonsDisabled(disabled) {
        inventoryButton.disabled = disabled;
        enrichLexikonButton.disabled = disabled;
        processRawButton.disabled = disabled;
        calculateNutritionButton.disabled = disabled;
    }
    
    const delay = ms => new Promise(res => setTimeout(res, ms));

    // === EVENT LISTENER ===
    inventoryButton.addEventListener('click', findAndCreateMissingIngredients);
    enrichLexikonButton.addEventListener('click', enrichLexikon);
    calculateNutritionButton.addEventListener('click', calculateAndSetRecipeNutrition);
    processRawButton.addEventListener('click', () => statusDiv.textContent = 'Diese Funktion ist noch nicht implementiert.');


    // =================================================================
    // SCHRITT 1: INVENTUR
    // =================================================================
    async function findAndCreateMissingIngredients() {
        // Diese Funktion bleibt unverändert
        statusDiv.textContent = 'Starte Inventur: Suche nach fehlenden Zutaten...\n';
        setButtonsDisabled(true);

        try {
            const [lexikonSnapshot, recipesSnapshot] = await Promise.all([
                db.collection('zutatenLexikon').get(),
                db.collection('rezepte').get()
            ]);
            
            const lexikonMap = new Map();
            lexikonSnapshot.forEach(doc => {
                lexikonMap.set(doc.data().name.toLowerCase(), true);
            });
            statusDiv.textContent += ` ✅ (${lexikonMap.size} Lexikon-Einträge, ${recipesSnapshot.size} Rezepte)\n`;

            const missingIngredients = new Set();
            for (const recipeDoc of recipesSnapshot.docs) {
                const ingredients = recipeDoc.data().ingredients || [];
                for (const ingredient of ingredients) {
                    if (!lexikonMap.has(ingredient.name.toLowerCase())) {
                        missingIngredients.add(ingredient.name);
                    }
                }
            }

            if (missingIngredients.size === 0) {
                statusDiv.textContent += '\n🎉 Alle Zutaten aus den Rezepten sind bereits im Lexikon vorhanden!';
                return;
            }

            statusDiv.textContent += `\nGefunden: ${missingIngredients.size} neue Zutaten. Erstelle Platzhalter...\n`;
            const batch = db.batch();
            missingIngredients.forEach(name => {
                const docId = name.toLowerCase().replace(/\//g, '-');
                const newIngredientRef = db.collection('zutatenLexikon').doc(docId);
                batch.set(newIngredientRef, { name: name });
                statusDiv.textContent += ` -> ➕ ${name}\n`;
            });

            await batch.commit();
            statusDiv.textContent += `\n✅ Erfolgreich ${missingIngredients.size} neue Platzhalter im Lexikon angelegt.`;

        } catch (error) {
            statusDiv.textContent += `\n\n❌ Ein schwerwiegender Fehler ist aufgetreten: ${error.message}`;
            console.error(error);
        } finally {
            setButtonsDisabled(false);
        }
    }

    // =================================================================
    // SCHRITT 2: DATEN ANREICHERN (NEU IMPLEMENTIERT)
    // =================================================================
    async function enrichLexikon() {
        statusDiv.textContent = 'Starte Anreicherung: Suche nach leeren Lexikon-Einträgen...\n';
        setButtonsDisabled(true);

        try {
            const lexikonSnapshot = await db.collection('zutatenLexikon').get();
            const ingredientsToEnrich = [];
            lexikonSnapshot.forEach(doc => {
                const data = doc.data();
                // Ein Eintrag muss angereichert werden, wenn ihm die Kategorie oder Nährwerte fehlen
                if (!data.kategorie || !data.nährwerte_pro_100g) {
                    ingredientsToEnrich.push({ id: doc.id, name: data.name });
                }
            });

            if (ingredientsToEnrich.length === 0) {
                statusDiv.textContent += '🎉 Alle Lexikon-Einträge sind bereits vollständig!';
                return;
            }

            statusDiv.textContent += `Gefunden: ${ingredientsToEnrich.length} Einträge zum Anreichern. Starte Prozess...\n`;
            
            const batch = db.batch();
            
            for (const ingredient of ingredientsToEnrich) {
                statusDiv.textContent += `\n- Verarbeite "${ingredient.name}"...`;
                try {
                    // Rufe alle Cloud Functions auf
                    const getCategory = functions.httpsCallable('getIngredientCategory');
                    const categoryResult = await getCategory({ ingredientName: ingredient.name });

                    const translate = functions.httpsCallable('translateIngredient');
                    const translateResult = await translate({ ingredientName: ingredient.name });
                    
                    const getNutrition = functions.httpsCallable('getNutritionData');
                    const nutritionResult = await getNutrition({ englishName: translateResult.data.englishName });

                    // Extrahiere die sauberen Daten
                    const kategorie = categoryResult.data.category;
                    const englisch = translateResult.data.englishName;
                    const naehrwerte = nutritionResult.data.nutrition;
                    
                    // Bereite die Daten für das Update im sauberen Lexikon vor
                    const cleanData = {
                        name: ingredient.name,
                        kategorie: kategorie,
                        englisch: englisch,
                        kalorien_pro_100g: naehrwerte.calories,
                        nährwerte_pro_100g: {
                            protein: naehrwerte.protein,
                            carbs: naehrwerte.carbs,
                            fat: naehrwerte.fat
                        }
                    };
                    
                    const lexikonRef = db.collection('zutatenLexikon').doc(ingredient.id);
                    batch.set(lexikonRef, cleanData, { merge: true });

                    // Bereite die Rohdaten für das RAW-Lexikon vor
                    const rawDataRef = db.collection('zutatenLexikonRAW').doc(ingredient.id);
                    batch.set(rawDataRef, {
                        name: ingredient.name,
                        retrievedAt: new Date(),
                        rawCategoryData: categoryResult.data.raw,
                        rawTranslateData: translateResult.data.raw,
                        rawNutritionData: nutritionResult.data.raw
                    }, { merge: true });

                    statusDiv.textContent += ` -> ✅ OK`;
                    
                } catch(err) {
                    statusDiv.textContent += ` -> ❌ FEHLER: ${err.message}`;
                }
                // Kurze Pause, um Rate-Limits vorzubeugen
                await delay(1000); 
            }

            statusDiv.textContent += '\n\nSpeichere alle Änderungen in der Datenbank...';
            await batch.commit();
            statusDiv.textContent += ' ✅\n\n🎉 Anreicherungsprozess abgeschlossen!';

        } catch (error) {
            statusDiv.textContent += `\n\n❌ Ein schwerwiegender Fehler ist aufgetreten: ${error.message}`;
            console.error(error);
        } finally {
            setButtonsDisabled(false);
        }
    }


    // =================================================================
    // SCHRITT 3: NÄHRWERTE BERECHNEN
    // =================================================================
    async function calculateAndSetRecipeNutrition() {
        // Diese Funktion bleibt unverändert
        statusDiv.textContent = 'Starte Prozess: Nährwerte für Rezepte berechnen...\n';
        setButtonsDisabled(true);

        try {
            statusDiv.textContent += 'Lade Zutatenlexikon...';
            const lexikonSnapshot = await db.collection('zutatenLexikon').get();
            const lexikonMap = new Map();
            lexikonSnapshot.forEach(doc => {
                lexikonMap.set(doc.data().name.toLowerCase(), doc.data());
            });
            statusDiv.textContent += ` ✅ (${lexikonMap.size} Einträge geladen)\n`;

            statusDiv.textContent += 'Lade alle Rezepte...';
            const recipesSnapshot = await db.collection('rezepte').get();
            statusDiv.textContent += ` ✅ (${recipesSnapshot.size} Rezepte gefunden)\n\n`;
            
            const batch = db.batch();
            let recipesUpdatedCount = 0;
            let recipesSkippedCount = 0;

            for (const recipeDoc of recipesSnapshot.docs) {
                const recipe = recipeDoc.data();
                statusDiv.textContent += `- Verarbeite "${recipe.title}"...`;

                if (!recipe.ingredients || recipe.ingredients.length === 0) {
                    statusDiv.textContent += ' -> ⚠️ Keine Zutaten, übersprungen.\n';
                    recipesSkippedCount++;
                    continue;
                }

                let totalKcal = 0;
                let totalProtein = 0;
                let totalCarbs = 0;
                let totalFat = 0;
                let missingNutritionData = [];
                let allIngredientsReady = true;

                for (const ingredient of recipe.ingredients) {
                    const lexikonData = lexikonMap.get(ingredient.name.toLowerCase());

                    if (lexikonData && lexikonData.kalorien_pro_100g !== undefined) {
                        const factor = (ingredient.amount || 0) / 100;
                        totalKcal += (lexikonData.kalorien_pro_100g || 0) * factor;
                        totalProtein += (lexikonData.nährwerte_pro_100g?.protein || 0) * factor;
                        totalCarbs += (lexikonData.nährwerte_pro_100g?.carbs || 0) * factor;
                        totalFat += (lexikonData.nährwerte_pro_100g?.fat || 0) * factor;
                    } else {
                        missingNutritionData.push(ingredient.name);
                        allIngredientsReady = false;
                    }
                }

                if (allIngredientsReady) {
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
                     recipesSkippedCount++;
                     statusDiv.textContent += ` -> ⚠️ Rezept übersprungen (Fehlende Nährwertdaten für: ${missingNutritionData.join(', ')})\n`;
                }
            }

            if (recipesUpdatedCount > 0) {
                statusDiv.textContent += `\nSpeichere Änderungen für ${recipesUpdatedCount} Rezepte...`;
                await batch.commit();
                statusDiv.textContent += ' ✅\n';
            }

            statusDiv.textContent += `\n🎉 Prozess abgeschlossen! ${recipesUpdatedCount} Rezepte aktualisiert, ${recipesSkippedCount} übersprungen.`;

        } catch (error) {
            statusDiv.textContent += `\n\n❌ Ein schwerwiegender Fehler ist aufgetreten: ${error.message}`;
            console.error(error);
        } finally {
            setButtonsDisabled(false);
        }
    }

}); // Ende des DOMContentLoaded-Listeners

