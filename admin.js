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
    const debugRecipeButton = document.getElementById('debug-recipe-btn');

    // === HILFSFUNKTIONEN ===
    function setButtonsDisabled(disabled) {
        inventoryButton.disabled = disabled;
        enrichLexikonButton.disabled = disabled;
        processRawButton.disabled = disabled;
        calculateNutritionButton.disabled = disabled;
        debugRecipeButton.disabled = disabled;
    }
    
    const delay = ms => new Promise(res => setTimeout(res, ms));

    // === EVENT LISTENER ===
    inventoryButton.addEventListener('click', findAndCreateMissingIngredients);
    enrichLexikonButton.addEventListener('click', enrichLexikon);
    calculateNutritionButton.addEventListener('click', calculateAndSetRecipeNutrition);
    debugRecipeButton.addEventListener('click', debugRecipeNutrition);
    processRawButton.addEventListener('click', () => statusDiv.textContent = 'Diese Funktion ist noch nicht implementiert.');

    // =================================================================
    // NEU: EINHEITEN-UMRECHNUNG
    // =================================================================
    function getGramAmount(ingredient) {
        const amount = ingredient.amount || 0;
        if (!ingredient.unit) return amount; // Wenn keine Einheit da ist, nehmen wir an, es sind Gramm
        
        const unit = ingredient.unit.toLowerCase();
        const name = ingredient.name.toLowerCase();

        if (unit === 'g' || unit === 'ml') { // Behandle ml und g als 1:1 für die meisten Kochanwendungen
            return amount;
        }

        const conversionMap = {
            'el': { default: 15, 'öl': 10, 'mehl': 8, 'zucker': 15, 'salz': 18, 'honig': 20, 'haferflocken': 8, 'kakao': 8 },
            'tl': { default: 5, 'öl': 4, 'mehl': 3, 'zucker': 5, 'salz': 6, 'honig': 7, 'backpulver': 4 },
            'stück': { default: 120, 'ei': 55, 'zwiebel': 100, 'knoblauchzehe': 5, 'karotte': 80 }
        };

        if (conversionMap[unit]) {
            const unitConversions = conversionMap[unit];
            for (const key in unitConversions) {
                if (key !== 'default' && name.includes(key)) {
                    return amount * unitConversions[key];
                }
            }
            return amount * unitConversions.default; // Fallback auf einen generischen Wert
        }

        return null; // Kennzeichnet eine unbekannte Einheit
    }

    // =================================================================
    // SCHRITT 1: INVENTUR
    // =================================================================
    async function findAndCreateMissingIngredients() {
        // ... (Dieser Code bleibt unverändert)
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
    // SCHRITT 2: DATEN ANREICHERN
    // =================================================================
    async function enrichLexikon() {
        // ... (Dieser Code bleibt unverändert)
        statusDiv.textContent = 'Starte Anreicherung: Suche nach leeren Lexikon-Einträgen...\n';
        setButtonsDisabled(true);

        try {
            const lexikonSnapshot = await db.collection('zutatenLexikon').get();
            const ingredientsToEnrich = [];
            lexikonSnapshot.forEach(doc => {
                const data = doc.data();
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
                    const getCategory = functions.httpsCallable('getIngredientCategory');
                    const categoryResult = await getCategory({ ingredientName: ingredient.name });

                    const translate = functions.httpsCallable('translateIngredient');
                    const translateResult = await translate({ ingredientName: ingredient.name });
                    
                    const getNutrition = functions.httpsCallable('getNutritionData');
                    const nutritionResult = await getNutrition({ englishName: translateResult.data.englishName });

                    const kategorie = categoryResult.data.category;
                    const englisch = translateResult.data.englishName;
                    const naehrwerte = nutritionResult.data.nutrition;
                    
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
    // SCHRITT 3: NÄHRWERTE BERECHNEN (MIT EINHEITEN-UMRECHNUNG)
    // =================================================================
    async function calculateAndSetRecipeNutrition() {
        statusDiv.textContent = 'Starte Prozess: Nährwerte für Rezepte berechnen...\n';
        setButtonsDisabled(true);

        try {
            // ... (Laden von Lexikon und Rezepten bleibt gleich)
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

                let totalKcal = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0;
                let missingDataFor = [], unknownUnitsFor = [];
                let allIngredientsReady = true;

                for (const ingredient of recipe.ingredients) {
                    const lexikonData = lexikonMap.get(ingredient.name.toLowerCase());
                    const gramAmount = getGramAmount(ingredient);

                    if (gramAmount === null) {
                        unknownUnitsFor.push(`${ingredient.amount} ${ingredient.unit} ${ingredient.name}`);
                        allIngredientsReady = false;
                        continue;
                    }
                    
                    if (lexikonData && lexikonData.kalorien_pro_100g !== undefined) {
                        const factor = gramAmount / 100;
                        totalKcal += (lexikonData.kalorien_pro_100g || 0) * factor;
                        totalProtein += (lexikonData.nährwerte_pro_100g?.protein || 0) * factor;
                        totalCarbs += (lexikonData.nährwerte_pro_100g?.carbs || 0) * factor;
                        totalFat += (lexikonData.nährwerte_pro_100g?.fat || 0) * factor;
                    } else {
                        missingDataFor.push(ingredient.name);
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
                     let errorMsg = '-> ⚠️ Rezept übersprungen (';
                     if (missingDataFor.length > 0) errorMsg += `Fehlende Nährwertdaten für: ${missingDataFor.join(', ')}. `;
                     if (unknownUnitsFor.length > 0) errorMsg += `Unbekannte Einheiten für: ${unknownUnitsFor.join(', ')}.`;
                     statusDiv.textContent += errorMsg + ')\n';
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

    // =================================================================
    // DEBUGGING-WERKZEUG (MIT EINHEITEN-UMRECHNUNG)
    // =================================================================
    async function debugRecipeNutrition() {
        const recipeName = prompt("Welchen genauen Rezept-Titel möchtest du debuggen?");
        if (!recipeName) return;

        statusDiv.textContent = `Starte Debugging für "${recipeName}"...\n`;
        setButtonsDisabled(true);

        try {
            // ... (Laden von Lexikon und Rezept bleibt gleich)
            const lexikonSnapshot = await db.collection('zutatenLexikon').get();
            const lexikonMap = new Map();
            lexikonSnapshot.forEach(doc => {
                lexikonMap.set(doc.data().name.toLowerCase(), doc.data());
            });

            const recipesRef = db.collection('rezepte');
            const querySnapshot = await recipesRef.where("title", "==", recipeName).limit(1).get();

            if (querySnapshot.empty) {
                statusDiv.textContent = `❌ Rezept mit dem Titel "${recipeName}" nicht gefunden.`;
                return;
            }

            const recipe = querySnapshot.docs[0].data();
            let debugOutput = `\n--- BERECHNUNGS-PROTOKOLL ---\nRezept: ${recipe.title}\n`;
            
            let totalKcal = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0;

            for (const ing of recipe.ingredients) {
                const lexikonData = lexikonMap.get(ing.name.toLowerCase());
                const gramAmount = getGramAmount(ing);
                
                debugOutput += `\n> Zutat: ${ing.amount}${ing.unit || 'g'} ${ing.name}\n`;

                if (gramAmount === null) {
                    debugOutput += `  - ❗️ FEHLER: Unbekannte Einheit "${ing.unit}"!\n`;
                    continue;
                }

                debugOutput += `  - Umgerechnet auf: ${gramAmount}g\n`;

                if (lexikonData && lexikonData.kalorien_pro_100g !== undefined) {
                    const factor = gramAmount / 100;
                    const kcal = (lexikonData.kalorien_pro_100g || 0) * factor;
                    const p = (lexikonData.nährwerte_pro_100g?.protein || 0) * factor;
                    const c = (lexikonData.nährwerte_pro_100g?.carbs || 0) * factor;
                    const f = (lexikonData.nährwerte_pro_100g?.fat || 0) * factor;

                    totalKcal += kcal;
                    totalProtein += p;
                    totalCarbs += c;
                    totalFat += f;

                    debugOutput += `  - Lexikon (pro 100g): ${lexikonData.kalorien_pro_100g} kcal | P:${lexikonData.nährwerte_pro_100g?.protein} C:${lexikonData.nährwerte_pro_100g?.carbs} F:${lexikonData.nährwerte_pro_100g?.fat}\n`;
                    debugOutput += `  - Berechnet: ${Math.round(kcal)} kcal | P:${Math.round(p)} C:${Math.round(c)} F:${Math.round(f)}\n`;
                } else {
                    debugOutput += `  - ❗️ FEHLER: Keine Nährwertdaten im Lexikon gefunden!\n`;
                }
            }

            debugOutput += `\n--- GESAMTERGEBNIS ---\n`;
            debugOutput += `Kcal: ${Math.round(totalKcal)}\n`;
            debugOutput += `Protein: ${Math.round(totalProtein)}g\n`;
            debugOutput += `Carbs: ${Math.round(totalCarbs)}g\n`;
            debugOutput += `Fett: ${Math.round(totalFat)}g\n`;

            statusDiv.textContent += debugOutput;

        } catch (error) {
            statusDiv.textContent += `\n\n❌ Ein schwerwiegender Fehler ist aufgetreten: ${error.message}`;
            console.error(error);
        } finally {
            setButtonsDisabled(false);
        }
    }

}); // Ende des DOMContentLoaded-Listeners

