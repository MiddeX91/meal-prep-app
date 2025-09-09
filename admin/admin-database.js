export function initDatabasePage(db, functions, pageElement) {
    
    // === DOM-ELEMENTE ===
    const findMissingBtn = pageElement.querySelector('#find-missing-btn');
    const enrichLexikonBtn = pageElement.querySelector('#enrich-lexikon-btn');
    const calculateNutritionBtn = pageElement.querySelector('#calculate-nutrition-btn');
    const debugRecipeBtn = pageElement.querySelector('#debug-recipe-btn');
    const statusDiv = pageElement.querySelector('#status');

    // KUGELSICHERE PRÜFUNG: Bricht ab, wenn ein wichtiges Element nicht gefunden wird.
    if (!findMissingBtn || !enrichLexikonBtn || !calculateNutritionBtn || !debugRecipeBtn || !statusDiv) {
        console.error("DATABASE PAGE ERROR: Ein oder mehrere HTML-Elemente wurden nicht gefunden. Initialisierung abgebrochen.");
        return;
    }

    // === HILFSFUNKTIONEN (innerhalb des Scopes) ===
    function setButtonsDisabled(disabled) { /*...*/ }
    const delay = ms => new Promise(res => setTimeout(res, ms));

    // === EVENT LISTENER ===
    if (!findMissingBtn.hasAttribute('data-listener-set')) {
        findMissingBtn.addEventListener('click', findAndCreateMissingIngredients);
        enrichLexikonBtn.addEventListener('click', enrichLexikon);
        calculateNutritionBtn.addEventListener('click', calculateAndSetRecipeNutrition);
        debugRecipeBtn.addEventListener('click', debugRecipeNutrition);
        findMissingBtn.setAttribute('data-listener-set', 'true');
    }
    
    // =============================================================
    // LOGIK FÜR DIE DATENBANK-WARTUNG
    // =============================================================

    /**
     * SCHRITT 1: Findet alle Zutaten in Rezepten, die noch nicht im Lexikon existieren,
     * und legt sie dort als Platzhalter an.
     */
    async function findAndCreateMissingIngredients() {
        setButtonsDisabled(true);
        statusDiv.textContent = 'Starte Schritt 1: Inventur...\n';
        
        try {
            statusDiv.textContent += 'Lade Zutatenlexikon...';
            const lexikonSnapshot = await db.collection('zutatenLexikon').get();
            const existingIngredients = new Set(lexikonSnapshot.docs.map(doc => doc.data().name.toLowerCase()));
            statusDiv.textContent += ` ✅ (${existingIngredients.size} Einträge gefunden)\n`;

            statusDiv.textContent += 'Lade alle Rezepte...';
            const recipesSnapshot = await db.collection('rezepte').get();
            statusDiv.textContent += ` ✅ (${recipesSnapshot.size} Rezepte gefunden)\n\n`;

            const missingIngredients = new Set();
            recipesSnapshot.forEach(doc => {
                const recipe = doc.data();
                if (recipe.ingredients) {
                    recipe.ingredients.forEach(ing => {
                        if (ing.name && !existingIngredients.has(ing.name.toLowerCase())) {
                            missingIngredients.add(ing.name);
                        }
                    });
                }
            });

            if (missingIngredients.size === 0) {
                statusDiv.textContent += '🎉 Super! Alle Zutaten aus den Rezepten sind bereits im Lexikon vorhanden.';
                return;
            }

            statusDiv.textContent += `Found ${missingIngredients.size} new ingredients to add:\n- ${Array.from(missingIngredients).join('\n- ')}\n\n`;
            statusDiv.textContent += 'Lege Platzhalter im Lexikon an...';

            const batch = db.batch();
            Array.from(missingIngredients).forEach(name => {
                const docId = name.toLowerCase().replace(/\//g, '-');
                const docRef = db.collection('zutatenLexikon').doc(docId);
                batch.set(docRef, { name: name });
            });

            await batch.commit();
            statusDiv.textContent += ' ✅\n\n🎉 Schritt 1 abgeschlossen! Die neuen Zutaten sind jetzt als Platzhalter im Lexikon vorhanden.';

        } catch (error) {
            console.error("Fehler bei Schritt 1:", error);
            statusDiv.textContent += `\n❌ Ein Fehler ist aufgetreten: ${error.message}`;
        } finally {
            setButtonsDisabled(false);
        }
    }

    /**
     * SCHRITT 2: Sucht nach leeren Platzhaltern im Lexikon und reichert sie
     * mit Daten von Gemini und Edamam an.
     */
    async function enrichLexikon() {
        setButtonsDisabled(true);
        statusDiv.textContent = 'Starte Schritt 2: Lexikon anreichern...\n';

        try {
            statusDiv.textContent += 'Lade Zutatenlexikon...';
            const lexikonSnapshot = await db.collection('zutatenLexikon').get();
            const allIngredients = lexikonSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            const ingredientsToEnrich = allIngredients.filter(ing => !ing.kategorie || !ing.nährwerte_pro_100g);

            if (ingredientsToEnrich.length === 0) {
                statusDiv.textContent += '\n🎉 Super! Alle Zutaten im Lexikon sind bereits vollständig angereichert.';
                return;
            }
            
            statusDiv.textContent += `\n${ingredientsToEnrich.length} Zutaten werden angereichert...\n\n`;
            
            const mainBatch = db.batch();

            for (const ingredient of ingredientsToEnrich) {
                const ingredientName = ingredient.name;
                statusDiv.textContent += `- Verarbeite "${ingredientName}"...\n`;
                
                // Cloud Functions aufrufen
                const getCategoryFunc = functions.httpsCallable('getIngredientCategory');
                const translateFunc = functions.httpsCallable('translateIngredient');
                const getNutritionFunc = functions.httpsCallable('getNutritionData');

                const categoryResponse = await getCategoryFunc({ ingredientName });
                const category = categoryResponse.data.category;
                statusDiv.textContent += `  - Kategorie: ${category}\n`;

                const translateResponse = await translateFunc({ ingredientName });
                const englishName = translateResponse.data.englishName;
                statusDiv.textContent += `  - Englisch: ${englishName}\n`;
                
                const nutritionResponse = await getNutritionFunc({ englishName });
                const rawEdamamData = nutritionResponse.data.rawEdamamData;

                if (rawEdamamData.error) {
                     throw new Error(`Edamam Fehler für "${ingredientName}": ${rawEdamamData.error}`);
                }
                
                // Saubere Daten extrahieren
                const nutrients = rawEdamamData?.totalNutrients || {};
                const cleanNutrition = {
                    calories: nutrients.ENERC_KCAL?.quantity ?? 0,
                    protein: nutrients.PROCNT?.quantity ?? 0,
                    carbs: nutrients.CHOCDF?.quantity ?? 0,
                    fat: nutrients.FAT?.quantity ?? 0
                };
                
                // Schreibvorgänge zum Batch hinzufügen
                const lexikonRef = db.collection('zutatenLexikon').doc(ingredient.id);
                mainBatch.update(lexikonRef, {
                    kategorie: category,
                    englisch: englishName,
                    kalorien_pro_100g: Math.round(cleanNutrition.calories),
                    nährwerte_pro_100g: {
                        protein: Math.round(cleanNutrition.protein * 10) / 10,
                        carbs: Math.round(cleanNutrition.carbs * 10) / 10,
                        fat: Math.round(cleanNutrition.fat * 10) / 10
                    }
                });

                const rawRef = db.collection('zutatenLexikonRAW').doc(ingredient.id);
                mainBatch.set(rawRef, {
                    name: ingredientName,
                    retrievedAt: new Date(),
                    rawData: rawEdamamData
                }, { merge: true });

                statusDiv.textContent += `  -> ✅ OK\n`;
            }

            statusDiv.textContent += `\nSpeichere alle Änderungen...`;
            await mainBatch.commit();
            statusDiv.textContent += ` ✅\n\n🎉 Schritt 2 abgeschlossen!`;

        } catch (error) {
            console.error("Fehler bei Schritt 2:", error);
            statusDiv.textContent += `\n❌ Ein schwerwiegender Fehler ist aufgetreten: ${error.message}`;
        } finally {
            setButtonsDisabled(false);
        }
    }
    
    /**
     * SCHRITT 3: Berechnet die Nährwerte für alle Rezepte basierend auf den
     * Daten im Lexikon und speichert sie.
     */
    async function calculateAndSetRecipeNutrition() {
        setButtonsDisabled(true);
        statusDiv.textContent = 'Starte Schritt 3: Nährwerte für Rezepte berechnen...\n';
        
        try {
            statusDiv.textContent += 'Lade Zutatenlexikon...';
            const lexikonSnapshot = await db.collection('zutatenLexikon').get();
            const zutatenLexikon = {};
            lexikonSnapshot.forEach(doc => {
                zutatenLexikon[doc.data().name.toLowerCase()] = doc.data();
            });
            statusDiv.textContent += ` ✅ (${Object.keys(zutatenLexikon).length} Einträge geladen)\n`;

            statusDiv.textContent += 'Lade alle Rezepte...';
            const recipesSnapshot = await db.collection('rezepte').get();
            statusDiv.textContent += ` ✅ (${recipesSnapshot.size} Rezepte gefunden)\n\n`;

            const batch = db.batch();
            let updatedCount = 0;
            let skippedCount = 0;

            recipesSnapshot.forEach(doc => {
                const recipe = doc.data();
                const recipeRef = doc.ref;
                statusDiv.textContent += `- Verarbeite "${recipe.title}"...`;

                const totalNutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 };
                let canCalculate = true;
                let unknownUnits = [];

                if (!recipe.ingredients || recipe.ingredients.length === 0) {
                    canCalculate = false;
                } else {
                    for (const ing of recipe.ingredients) {
                        const gramAmount = getGramAmount(ing, statusDiv);
                        if (gramAmount === null) {
                            unknownUnits.push(`${ing.amount} ${ing.unit} ${ing.name}`);
                            canCalculate = false;
                            continue;
                        }

                        const lexikonEntry = zutatenLexikon[ing.name.toLowerCase()];
                        if (!lexikonEntry || !lexikonEntry.nährwerte_pro_100g) {
                            statusDiv.textContent += `-> ⚠️ Rezept übersprungen (Fehlende Lexikon-Daten für: ${ing.name})\n`;
                            canCalculate = false;
                            break;
                        }

                        const factor = gramAmount / 100;
                        totalNutrition.calories += (lexikonEntry.kalorien_pro_100g || 0) * factor;
                        totalNutrition.protein += (lexikonEntry.nährwerte_pro_100g.protein || 0) * factor;
                        totalNutrition.carbs += (lexikonEntry.nährwerte_pro_100g.carbs || 0) * factor;
                        totalNutrition.fat += (lexikonEntry.nährwerte_pro_100g.fat || 0) * factor;
                    }
                }
                
                if (unknownUnits.length > 0) {
                    statusDiv.textContent += `-> ⚠️ Rezept übersprungen (Unbekannte Einheiten für: ${unknownUnits.join(', ')})\n`;
                }

                if (canCalculate) {
                    batch.update(recipeRef, {
                        basis_kalorien: Math.round(totalNutrition.calories),
                        basis_makros: {
                            protein: Math.round(totalNutrition.protein),
                            carbs: Math.round(totalNutrition.carbs),
                            fat: Math.round(totalNutrition.fat)
                        }
                    });
                    updatedCount++;
                    statusDiv.textContent += ` -> ✅ Berechnet: ${Math.round(totalNutrition.calories)} kcal\n`;
                } else {
                    skippedCount++;
                }
            });

            if (updatedCount > 0) {
                statusDiv.textContent += `\nSpeichere Änderungen für ${updatedCount} Rezepte...`;
                await batch.commit();
                statusDiv.textContent += ' ✅\n';
            }

            statusDiv.textContent += `\n🎉 Prozess abgeschlossen! ${updatedCount} Rezepte aktualisiert, ${skippedCount} übersprungen.`;

        } catch (error) {
            console.error("Fehler bei Schritt 3:", error);
            statusDiv.textContent += `\n❌ Ein schwerwiegender Fehler ist aufgetreten: ${error.message}`;
        } finally {
            setButtonsDisabled(false);
        }
    }

    /**
     * DEBUGGING: Berechnet die Nährwerte für ein einzelnes Rezept und zeigt eine
     * detaillierte Aufschlüsselung an, anstatt zu speichern.
     */
    async function debugRecipeNutrition() {
        const recipeTitle = prompt("Für welches Rezept sollen die Nährwerte geprüft werden? (Exakten Titel eingeben)");
        if (!recipeTitle) return;
        
        setButtonsDisabled(true);
        statusDiv.textContent = `Starte Debugging für "${recipeTitle}"...\n`;

        try {
            statusDiv.textContent += 'Lade Zutatenlexikon...\n';
            const lexikonSnapshot = await db.collection('zutatenLexikon').get();
            const zutatenLexikon = {};
            lexikonSnapshot.forEach(doc => {
                zutatenLexikon[doc.data().name.toLowerCase()] = doc.data();
            });

            statusDiv.textContent += 'Suche Rezept...\n';
            const query = db.collection('rezepte').where("title", "==", recipeTitle);
            const recipeSnapshot = await query.get();

            if (recipeSnapshot.empty) {
                throw new Error(`Rezept mit dem Titel "${recipeTitle}" nicht gefunden.`);
            }

            const recipe = recipeSnapshot.docs[0].data();
            let debugOutput = `\n--- Nährwert-Analyse für: ${recipe.title} ---\n\n`;
            const totalNutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 };

            for (const ing of recipe.ingredients) {
                const gramAmount = getGramAmount(ing);
                const lexikonEntry = zutatenLexikon[ing.name.toLowerCase()];

                debugOutput += `Zutat: ${ing.amount} ${ing.unit || ''} ${ing.name}\n`;
                if (gramAmount === null) {
                    debugOutput += `  -> ⚠️ Umrechnung in Gramm fehlgeschlagen!\n\n`;
                    continue;
                }
                if (!lexikonEntry || !lexikonEntry.kalorien_pro_100g) {
                    debugOutput += `  -> ⚠️ Keine Lexikon-Daten gefunden!\n\n`;
                    continue;
                }
                
                const factor = gramAmount / 100;
                const cal = (lexikonEntry.kalorien_pro_100g || 0) * factor;
                const p = (lexikonEntry.nährwerte_pro_100g.protein || 0) * factor;
                const c = (lexikonEntry.nährwerte_pro_100g.carbs || 0) * factor;
                const f = (lexikonEntry.nährwerte_pro_100g.fat || 0) * factor;

                totalNutrition.calories += cal;
                totalNutrition.protein += p;
                totalNutrition.carbs += c;
                totalNutrition.fat += f;
                
                debugOutput += `  - Umgerechnet: ${gramAmount.toFixed(1)}g\n`;
                debugOutput += `  - Nährwerte/100g: ${lexikonEntry.kalorien_pro_100g}kcal | P:${lexikonEntry.nährwerte_pro_100g.protein} C:${lexikonEntry.nährwerte_pro_100g.carbs} F:${lexikonEntry.nährwerte_pro_100g.fat}\n`;
                debugOutput += `  - Berechnete Werte: ${cal.toFixed(0)}kcal | P:${p.toFixed(1)} C:${c.toFixed(1)} F:${f.toFixed(1)}\n\n`;
            }

            debugOutput += `--- GESAMT (berechnet) ---\n`;
            debugOutput += `Kalorien: ${totalNutrition.calories.toFixed(0)} kcal\n`;
            debugOutput += `Protein: ${totalNutrition.protein.toFixed(1)}g\n`;
            debugOutput += `Kohlenhydrate: ${totalNutrition.carbs.toFixed(1)}g\n`;
            debugOutput += `Fett: ${totalNutrition.fat.toFixed(1)}g\n`;
            
            debugOutput += `\n--- GESAMT (im Rezept gespeichert) ---\n`;
            debugOutput += `Kalorien: ${recipe.basis_kalorien} kcal\n`;
            debugOutput += `Protein: ${recipe.basis_makros.protein}g\n`;
            debugOutput += `Kohlenhydrate: ${recipe.basis_makros.carbs}g\n`;
            debugOutput += `Fett: ${recipe.basis_makros.fat}g\n`;

            statusDiv.textContent += debugOutput;

        } catch (error) {
            console.error("Fehler beim Debuggen:", error);
            statusDiv.textContent += `\n❌ Ein Fehler ist aufgetreten: ${error.message}`;
        } finally {
            setButtonsDisabled(false);
        }
    }

    /**
     * Hilfsfunktion, die versucht, eine Zutat in Gramm umzurechnen.
     * @param {object} ingredient - Das Zutat-Objekt aus einem Rezept.
     * @returns {number|null} Die Menge in Gramm oder null, wenn die Einheit unbekannt ist.
     */
    function getGramAmount(ingredient) {
        const amount = ingredient.amount;
        const unit = (ingredient.unit || '').toLowerCase();
        const name = (ingredient.name || '').toLowerCase();

        // Direkte Gewichtseinheiten
        if (unit === 'g' || unit === 'gramm') return amount;
        if (unit === 'kg') return amount * 1000;
        if (unit === 'ml' || unit === 'milliliter') return amount; // Vereinfachung: 1ml ≈ 1g

        // "Nullwert"-Einheiten
        if (unit.startsWith('prise') || unit === 'etwas') {
            return 0;
        }

        // Volumen-Einheiten (benötigen Schätzungen)
        const volumeToGram = {
            'el': 12, // Esslöffel (Durchschnitt)
            'tl': 4,  // Teelöffel (Durchschnitt)
        };
        if (volumeToGram[unit]) return amount * volumeToGram[unit];

        // Stück-Einheiten (benötigen Schätzungen pro Zutat)
        const pieceToGram = {
            'zwiebel': 100,
            'knoblauchzehe': 5,
            'ei': 55,
            'eier': 55, // Plural
            'karotte': 80,
            'paprika': 150,
            'sellerie': 50, // Pro Stange
        };
        const unitIsPiece = unit.startsWith('stk') || unit.startsWith('stange');
        if (unitIsPiece) {
            for (const key in pieceToGram) {
                if (name.includes(key)) return amount * pieceToGram[key];
            }
        }
        
        // Spezifische Einheiten
        if (unit === 'cm' && name.includes('ingwer')) return amount * 5; // 1cm Ingwer ≈ 5g
        if (unit.startsWith('handvoll') && (name.includes('petersilie') || name.includes('kräuter'))) return amount * 10;

        // Wenn keine Regel zutrifft
        return null;
    }
}

