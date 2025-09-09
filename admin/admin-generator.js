/**
 * Initialisiert die Logik für die "Rezept-Generator"-Seite im Admin-Panel.
 * @param {object} db - Die Firestore-Datenbank-Instanz.
 * @param {object} functions - Die Firebase Functions-Instanz.
 * @param {HTMLElement} pageElement - Das HTML-Element der Generator-Seite.
 */
export function initGeneratorPage(db, functions, pageElement) {
    // Sicherheitsprüfung am Anfang
    if (!pageElement) {
        console.error("GENERATOR PAGE ERROR: pageElement wurde nicht übergeben.");
        return;
    }

    // === DOM-ELEMENTE ===
    const generatorForm = pageElement.querySelector('#generator-form');
    const recipeDescription = pageElement.querySelector('#recipe-description');
    const mustHaveInput = pageElement.querySelector('#must-have-ingredients');
    const noGoInput = pageElement.querySelector('#no-go-ingredients');
    const targetCalories = pageElement.querySelector('#target-calories');
    const maxIngredientsInput = pageElement.querySelector('#max-ingredients');
    const generateBtn = pageElement.querySelector('#generate-btn');
    const editorSection = pageElement.querySelector('#editor-section');
    const recipeTitleInput = pageElement.querySelector('#recipe-title');
    const recipeArtSelect = pageElement.querySelector('#recipe-art');
    const recipeHaltbarkeitInput = pageElement.querySelector('#recipe-haltbarkeit');
    const recipeReiftCheckbox = pageElement.querySelector('#recipe-reift');
    const recipeZubereitungTextarea = pageElement.querySelector('#recipe-zubereitung');
    const ingredientsContainer = pageElement.querySelector('#ingredients-container');
    const nutritionResultDiv = pageElement.querySelector('#nutrition-result');
    const checkNutritionBtn = pageElement.querySelector('#check-nutrition-btn');
    const saveRecipeBtn = pageElement.querySelector('#save-recipe-btn');
    const statusDiv = pageElement.querySelector('#generator-status');
    
    let localZutatenLexikon = {};
    let lastCalculatedNutrition = null;

    // =============================================================
    // LOGIK-FUNKTIONEN (Handler)
    // =============================================================

    async function handleGenerateRecipe() {
        setGeneratorButtonsDisabled(true);
        statusDiv.textContent = '🤖 Gemini denkt über ein leckeres Rezept nach...';
        editorSection.style.display = 'none';
        lastCalculatedNutrition = null;
        nutritionResultDiv.innerHTML = '';

        try {
            const lexikonSnapshot = await db.collection('zutatenLexikon').get();
            const lexikonEntries = [];
            lexikonSnapshot.forEach(doc => lexikonEntries.push(doc.data().name));

            const requestData = {
                description: recipeDescription.value,
                mustHave: mustHaveInput.value,
                noGo: noGoInput.value,
                tags: Array.from(generatorForm.querySelectorAll('input[name="tag"]:checked')).map(cb => cb.value),
                calories: parseInt(targetCalories.value, 10),
                maxIngredients: parseInt(maxIngredientsInput.value, 10),
                geraete: Array.from(generatorForm.querySelectorAll('input[name="geraet"]:checked')).map(cb => cb.value)
            };
            
            if (!requestData.description) throw new Error("Bitte gib eine Beschreibung ein.");

            const generateRecipeFunc = functions.httpsCallable('generateRecipeIdea');
            const result = await generateRecipeFunc(requestData);
            const recipe = result.data;

            recipeTitleInput.value = recipe.titel || '';
            recipeArtSelect.value = recipe.art || 'Mahlzeit';
            recipeHaltbarkeitInput.value = recipe.haltbarkeit || 3;
            recipeReiftCheckbox.checked = recipe.reift || false;
            recipeZubereitungTextarea.value = recipe.zubereitung || '';
            
            ingredientsContainer.innerHTML = '';
            (recipe.zutaten || []).forEach(ing => {
                const originalName = ing.name;
                const bestMatch = findBestLexikonMatch(originalName, lexikonEntries);
                const correctedName = bestMatch || originalName;
                
                const div = document.createElement('div');
                div.className = 'ingredient-row';
                div.innerHTML = `
                    <input type="text" class="ingredient-amount" value="${ing.menge_einheit || ''}" placeholder="Menge & Einheit">
                    <input type="text" class="ingredient-name" value="${correctedName}" placeholder="Zutat">
                    <button type="button" class="delete-ingredient-btn">X</button>
                `;
                ingredientsContainer.appendChild(div);

                if (bestMatch && bestMatch.toLowerCase() !== originalName.toLowerCase()) {
                    const input = div.querySelector('.ingredient-name');
                    input.style.backgroundColor = '#fff3cd'; 
                    setTimeout(() => { input.style.backgroundColor = ''; }, 2000);
                }
                div.querySelector('.delete-ingredient-btn').addEventListener('click', () => div.remove());
            });

            statusDiv.textContent = '✅ Vorschlag erhalten und intelligent abgeglichen!';
            editorSection.style.display = 'block';

        } catch (error) {
            console.error("Fehler beim Generieren:", error);
            statusDiv.textContent = `❌ Fehler: ${error.message}`;
        } finally {
            setGeneratorButtonsDisabled(false);
        }
    }

    async function handleCheckNutrition() {
        setGeneratorButtonsDisabled(true);
        statusDiv.textContent = '🔍 Prüfe Nährwerte und frage bei Bedarf APIs ab...';
        nutritionResultDiv.innerHTML = '';
        lastCalculatedNutrition = null;

        try {
            const lexikonSnapshot = await db.collection('zutatenLexikon').get();
            localZutatenLexikon = {};
            lexikonSnapshot.forEach(doc => {
                localZutatenLexikon[doc.data().name.toLowerCase()] = doc.data();
            });

            const ingredientRows = ingredientsContainer.querySelectorAll('.ingredient-row');
            const currentIngredients = Array.from(ingredientRows).map(row => {
                const amountStr = row.querySelector('.ingredient-amount').value.trim();
                const name = row.querySelector('.ingredient-name').value.trim();
                
                const combinedStr = amountStr ? `${amountStr} ${name}` : name;
                const match = combinedStr.match(/([\d.,]+)?\s*(\w*)\s*(.*)/);

                let parsedAmount = 0;
                let parsedUnit = '';
                let parsedName = name;

                if (match) {
                    parsedAmount = match[1] ? parseFloat(match[1].replace(',', '.')) : 1;
                    parsedUnit = match[2] || '';
                    parsedName = match[3] || name;
                    if (!match[3] && !amountStr) {
                       parsedName = match[2];
                       parsedUnit = '';
                    }
                }
                
                return { name: parsedName.trim(), amount: parsedAmount, unit: parsedUnit.trim() };

            }).filter(ing => ing.name);

            const ingredientsToFetch = [...new Set(
                currentIngredients
                    .filter(ing => ing.name && !localZutatenLexikon[ing.name.toLowerCase()]?.nährwerte_pro_100g)
                    .map(ing => ing.name)
            )];
            
            if (ingredientsToFetch.length > 0) {
                 statusDiv.textContent += `\n- Lade fehlende Daten für: ${ingredientsToFetch.join(', ')}...`;
                 const batch = db.batch();
                 for(const ingredientName of ingredientsToFetch) {
                    const getCategoryFunc = functions.httpsCallable('getIngredientCategory');
                    const translateFunc = functions.httpsCallable('translateIngredient');
                    const getNutritionFunc = functions.httpsCallable('getNutritionData');

                    const category = (await getCategoryFunc({ ingredientName })).data.category;
                    const englishName = (await translateFunc({ ingredientName })).data.englishName;
                    const { rawEdamamData } = (await getNutritionFunc({ englishName })).data;
                    
                    if (rawEdamamData.error) throw new Error(`Edamam Fehler für ${ingredientName}: ${rawEdamamData.error}`);
                    
                    const nutrients = rawEdamamData?.totalNutrients || {};
                    const newEntry = {
                        name: ingredientName,
                        kategorie: category,
                        englisch: englishName,
                        kalorien_pro_100g: Math.round(nutrients.ENERC_KCAL?.quantity ?? 0),
                        nährwerte_pro_100g: {
                            protein: parseFloat((nutrients.PROCNT?.quantity ?? 0).toFixed(1)),
                            carbs: parseFloat((nutrients.CHOCDF?.quantity ?? 0).toFixed(1)),
                            fat: parseFloat((nutrients.FAT?.quantity ?? 0).toFixed(1))
                        }
                    };
                    localZutatenLexikon[ingredientName.toLowerCase()] = newEntry;
                    const docId = ingredientName.toLowerCase().replace(/\//g, '-');
                    batch.set(db.collection('zutatenLexikon').doc(docId), newEntry, { merge: true });
                 }
                 await batch.commit();
                 statusDiv.textContent += ` ✅ Lexikon aktualisiert.`;
            }

            const totalNutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 };
            for (const ing of currentIngredients) {
                 const gramAmount = getGramAmount(ing);
                 if (gramAmount === null) continue;

                 const lexikonEntry = localZutatenLexikon[ing.name.toLowerCase()];
                 if (!lexikonEntry) continue;

                 const factor = gramAmount / 100;
                 totalNutrition.calories += (lexikonEntry.kalorien_pro_100g || 0) * factor;
                 totalNutrition.protein += (lexikonEntry.nährwerte_pro_100g.protein || 0) * factor;
                 totalNutrition.carbs += (lexikonEntry.nährwerte_pro_100g.carbs || 0) * factor;
                 totalNutrition.fat += (lexikonEntry.nährwerte_pro_100g.fat || 0) * factor;
            }
            
            lastCalculatedNutrition = {
                calories: Math.round(totalNutrition.calories),
                protein: Math.round(totalNutrition.protein),
                carbs: Math.round(totalNutrition.carbs),
                fat: Math.round(totalNutrition.fat)
            };

            nutritionResultDiv.innerHTML = `
                <h4>Berechnete Nährwerte:</h4>
                <p><strong>Kalorien:</strong> ${lastCalculatedNutrition.calories} kcal</p>
                <p><strong>Protein:</strong> ${lastCalculatedNutrition.protein} g</p>
                <p><strong>Kohlenhydrate:</strong> ${lastCalculatedNutrition.carbs} g</p>
                <p><strong>Fett:</strong> ${lastCalculatedNutrition.fat} g</p>
            `;
            statusDiv.textContent = '✅ Nährwert-Prüfung abgeschlossen!';

        } catch (error) {
            console.error("Fehler beim Prüfen der Nährwerte:", error);
            statusDiv.textContent = `❌ Fehler: ${error.message}`;
        } finally {
            setGeneratorButtonsDisabled(false);
        }
    }
     async function handleSaveRecipe() {
        setGeneratorButtonsDisabled(true);
        statusDiv.textContent = 'Speichere Rezept...';

        try {
            const title = recipeTitleInput.value;
            if (!title) {
                throw new Error("Das Rezept benötigt einen Titel.");
            }

            if (!localZutatenLexikon || Object.keys(localZutatenLexikon).length === 0) {
                 const lexikonSnapshot = await db.collection('zutatenLexikon').get();
                 localZutatenLexikon = {};
                 lexikonSnapshot.forEach(doc => {
                     localZutatenLexikon[doc.data().name.toLowerCase()] = doc.data();
                 });
            }
            
            const ingredientRows = ingredientsContainer.querySelectorAll('.ingredient-row');
            const ingredients = Array.from(ingredientRows).map(row => {
                 const amountStr = row.querySelector('.ingredient-amount').value;
                 const name = row.querySelector('.ingredient-name').value.trim();
                 const match = amountStr.match(/([\d.,]+)\s*(\w+)/);
                 
                 const ingredientData = {
                    name: name,
                    amount: match ? parseFloat(match[1].replace(',', '.')) : 0,
                    unit: match ? match[2] : ''
                 };

                 ingredientData.type = determineIngredientType(ingredientData, localZutatenLexikon);
                 
                 return ingredientData;

            }).filter(ing => ing.name);

            if (ingredients.length === 0) {
                throw new Error("Das Rezept muss mindestens eine Zutat haben.");
            }

            const recipeId = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

            const recipeData = {
                id: recipeId,
                title: title,
                category: recipeArtSelect.value,
                haltbarkeit: parseInt(recipeHaltbarkeitInput.value, 10),
                reift: recipeReiftCheckbox.checked,
                instructions: recipeZubereitungTextarea.value,
                ingredients: ingredients,
                basis_kalorien: lastCalculatedNutrition ? lastCalculatedNutrition.calories : 0,
                basis_makros: lastCalculatedNutrition ? {
                    protein: lastCalculatedNutrition.protein,
                    carbs: lastCalculatedNutrition.carbs,
                    fat: lastCalculatedNutrition.fat
                } : { protein: 0, carbs: 0, fat: 0 }
            };

            await db.collection('rezepte').doc(recipeId).set(recipeData);

            statusDiv.textContent = `✅ Rezept "${title}" erfolgreich gespeichert!`;
            editorSection.style.display = 'none';
            generatorForm.reset();

        } catch (error) {
            console.error("Fehler beim Speichern des Rezepts:", error);
            statusDiv.textContent = `❌ Fehler: ${error.message}`;
        } finally {
            setGeneratorButtonsDisabled(false);
        }
    }
    
    // =============================================================
    // HILFSFUNKTIONEN
    // =============================================================

    function findBestLexikonMatch(geminiName, lexikonEntries) {
        const stopWords = ['vom', 'von', 'mit', 'und', 'in', 'aus', 'gehackt', 'frisch', 'getrocknet', 'dose', 'in', 'eingelegt'];
        
        const normalizeAndTokenize = (name) => {
            return name.toLowerCase()
                .replace(/[\(\),]/g, '')
                .split(' ')
                .filter(word => !stopWords.includes(word) && word.length > 2);
        };

        const geminiTokens = normalizeAndTokenize(geminiName);
        let bestMatch = null;
        let highestScore = 0;

        for (const lexikonEntry of lexikonEntries) {
            const lexikonTokens = normalizeAndTokenize(lexikonEntry);
            let currentScore = 0;

            for (const gToken of geminiTokens) {
                for (const lToken of lexikonTokens) {
                    if (gToken === lToken) {
                        currentScore += gToken.length * 2;
                    } else if (gToken.includes(lToken)) {
                        currentScore += lToken.length;
                    } else if (lToken.includes(gToken)) {
                        currentScore += gToken.length;
                    }
                }
            }

            if (currentScore > highestScore) {
                highestScore = currentScore;
                bestMatch = lexikonEntry;
            }
        }
        
        if (highestScore > 4) { 
            return bestMatch;
        }

        return null;
    }

    function setGeneratorButtonsDisabled(disabled) {
        generateBtn.disabled = disabled;
        checkNutritionBtn.disabled = disabled;
        saveRecipeBtn.disabled = disabled;
    }
    
    /**
     * VERBESSERT: Weist den Typ einer Zutat zu. Priorisiert Keywords für Gewürze
     * gegenüber der reinen Makro-Analyse.
     */
    function determineIngredientType(ingredient, lexikon) {
        const lowerCaseName = ingredient.name.toLowerCase();
        const spiceKeywords = ['pulver', 'salz', 'pfeffer', 'curry', 'nelken', 'muskat', 'gewürz', 'gemahlen', 'gerebelt'];

        // NEUE REGEL: Wenn es ein Gewürz ist, immer als 'basis' klassifizieren.
        if (spiceKeywords.some(keyword => lowerCaseName.includes(keyword))) {
            return "basis";
        }
        
        const entry = lexikon[lowerCaseName];
        if (!entry || !entry.nährwerte_pro_100g) {
            return "basis";
        }

        const { protein, carbs, fat } = entry.nährwerte_pro_100g;
        
        if (protein > carbs && protein > fat) {
            return "protein";
        }
        if (carbs > protein && carbs > fat) {
            return "energie_carb";
        }
        if (fat > protein && fat > carbs) {
            return "energie_fat";
        }

        return "basis";
    }

    function getGramAmount(ingredient) {
       const amount = ingredient.amount;
        const unit = (ingredient.unit || '').toLowerCase();
        const name = (ingredient.name || '').toLowerCase();

        if (unit === 'g' || unit === 'gramm') return amount;
        if (unit === 'kg') return amount * 1000;
        if (unit === 'ml' || unit === 'milliliter') return amount;

        if (unit.startsWith('prise') || unit === 'etwas') return 0;
        
        const volumeToGram = { 'el': 12, 'tl': 4 };
        if (volumeToGram[unit]) return amount * volumeToGram[unit];

        const pieceToGram = {
            'zwiebel': 100, 'knoblauchzehe': 5, 'ei': 55, 'eier': 55,
            'karotte': 80, 'paprika': 150, 'sellerie': 50,
        };
        
        const unitIsGenericPiece = unit.startsWith('stk') || unit.startsWith('stange');
        if (unitIsGenericPiece) {
             for (const key in pieceToGram) {
                if (name.includes(key)) return amount * pieceToGram[key];
            }
        }
        const combinedName = unit ? `${unit} ${name}` : name;
        for(const key in pieceToGram) {
            if (combinedName.includes(key)) return amount * pieceToGram[key];
        }

        if (unit === 'cm' && name.includes('ingwer')) return amount * 5;
        if (unit.startsWith('handvoll') && (name.includes('petersilie') || name.includes('kräuter'))) return amount * 10;

        return null;
    }

    // === EVENT LISTENER ZUWEISUNG ===
    if (!generateBtn.hasAttribute('data-listener-set')) {
        generateBtn.addEventListener('click', handleGenerateRecipe);
        checkNutritionBtn.addEventListener('click', handleCheckNutrition);
        saveRecipeBtn.addEventListener('click', handleSaveRecipe);
        generateBtn.setAttribute('data-listener-set', 'true');
    }
}

