import { capitalize } from './utils.js';
import { showToast } from './app.js';
import { askToResetShoppingList } from './app.js';

// === DOM-ELEMENTE FÜR DEN ASSISTENTEN ===
const smartFillModal = document.getElementById('smart-fill-modal');
const step1 = document.getElementById('wizard-step-1');
const step2 = document.getElementById('wizard-step-2');
const daySelectionContainer = document.getElementById('day-selection');
const fillModeInputs = document.querySelectorAll('input[name="fill-mode"]');
const cancelButtons = smartFillModal.querySelectorAll('.modal-cancel-btn');
const proposeButton = document.getElementById('propose-recipes-btn');
const fillPlanButton = document.getElementById('fill-plan-btn');
const proposalContainer = document.getElementById('proposal-container');


// === ZUSTAND (STATE) DES ASSISTENTEN ===
let currentProposal = { mahlzeit: [], frühstück: [], snack: [] };
let localRecipeData = [];
let localWeeklyPlan = {};

// === HAUPTFUNKTIONEN ===

/**
 * Öffnet das Menü und empfängt die aktuellen Rezeptdaten.
 */
function openSmartFillWizard(allRecipes, currentPlan) { 
  localRecipeData = allRecipes;
  localWeeklyPlan = JSON.parse(JSON.stringify(currentPlan)); 
  
  step1.style.display = 'block';
  step2.style.display = 'none';
  smartFillModal.classList.add('active');
}

/**
 * Schließt das Modal und setzt alles zurück.
 */
function closeSmartFillWizard() {
    smartFillModal.classList.remove('active');
}

/**
 * NEUE LOGIK: Generiert eine ausgewogene Auswahl an Rezept-Vorschlägen.
 */
function generateProposal() {
    // Hole Rezepte, gruppiert nach ihrem dominanten Makro-Typ
    const proteinMeals = getRecipesByDominantType(localRecipeData, 'protein');
    const carbMeals = getRecipesByDominantType(localRecipeData, 'energie_carb');

    if (proteinMeals.length < 2 || carbMeals.length < 1) {
        console.warn("Nicht genügend Rezeptvielfalt für eine optimale Auswahl. Fülle mit Zufall auf.");
        // Fallback zur alten Logik, wenn nicht genügend spezifische Rezepte da sind
        currentProposal.mahlzeit = getRandomUniqueRecipes(localRecipeData, 'mahlzeit', 3);
    } else {
        // Intelligente Auswahl: 2 Protein-Gerichte, 1 Carb-Gericht
        const shuffledProteins = proteinMeals.sort(() => 0.5 - Math.random());
        const shuffledCarbs = carbMeals.sort(() => 0.5 - Math.random());
        
        currentProposal.mahlzeit = [
            shuffledProteins[0],
            shuffledProteins[1],
            shuffledCarbs[0]
        ].filter(Boolean); // .filter(Boolean) entfernt undefined, falls eine Liste leer ist
    }

    // Frühstück und Snacks bleiben zufällig
    currentProposal.frühstück = getRandomUniqueRecipes(localRecipeData, 'frühstück', 2);
    currentProposal.snack = getRandomUniqueRecipes(localRecipeData, 'snack', 2);
}


/**
 * Zeigt die vorgeschlagenen Rezepte im zweiten Schritt des Assistenten an.
 * (Diese Funktion bleibt unverändert)
 */
function renderProposal() {
    proposalContainer.innerHTML = '';
    for (const category in currentProposal) {
        if (currentProposal[category].length === 0) continue;

        const categoryTitle = capitalize(category === 'mahlzeit' ? 'Hauptmahlzeiten' : category);
        let categoryHTML = `<div><h5>${categoryTitle}</h5>`;

        currentProposal[category].forEach(recipe => {
            categoryHTML += `
                <div class="proposal-item" data-recipe-id="${recipe.id}">
                    <span>${recipe.title} (Haltbarkeit: ${recipe.haltbarkeit} T.)</span>
                    <button class="reroll-btn" data-category="${category}" data-recipe-id="${recipe.id}">🔄</button>
                </div>`;
        });
        categoryHTML += '</div>';
        proposalContainer.innerHTML += categoryHTML;
    }
}

/**
 * Verteilt die finalen Rezepte intelligent im Wochenplan.
 * (Diese Funktion bleibt unverändert, da sie die fertige Auswahl verteilt)
 */
function distributeRecipes() {
    const selectedDays = Array.from(daySelectionContainer.querySelectorAll('input:checked')).map(cb => cb.value);
    const fillMode = document.querySelector('input[name="fill-mode"]:checked').value;
    const newPlan = JSON.parse(JSON.stringify(localWeeklyPlan));

    if (fillMode === 'overwrite') {
        selectedDays.forEach(day => {
            for (const category in newPlan[day]) { newPlan[day][category] = null; }
        });
    }

    const frühstückPool = [...currentProposal.frühstück];
    const snackPool = [...currentProposal.snack];
    selectedDays.forEach(day => {
        if (newPlan[day]['frühstück'] === null && frühstückPool.length > 0) {
            newPlan[day]['frühstück'] = frühstückPool[0].id;
            frühstückPool.push(frühstückPool.shift());
        }
        if (newPlan[day]['snack'] === null && snackPool.length > 0) {
            newPlan[day]['snack'] = snackPool[0].id;
            snackPool.push(snackPool.shift());
        }
    });

    const sortedMahlzeiten = [...currentProposal.mahlzeit].sort((a, b) => a.haltbarkeit - b.haltbarkeit);
    if (sortedMahlzeiten.length > 0) {
        let portionsToDistribute = [];
        const portionsCount = [3, 3, 4];
        const reversedSorted = [...sortedMahlzeiten].reverse(); 
        reversedSorted.forEach((recipe, index) => {
            if(!recipe) return;
            const count = portionsCount[index] || 3; 
            for(let i = 0; i < count; i++) {
                portionsToDistribute.push(recipe);
            }
        });

        const dayAges = { montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonntag: 7 };
        let emptySlots = [];
        selectedDays.forEach(day => {
            ['mittagessen', 'abendessen'].forEach(category => {
                if (newPlan[day][category] === null) {
                    emptySlots.push({ day: day, category: category, age: dayAges[day] });
                }
            });
        });

        emptySlots.forEach(slot => {
            let bestRecipeIndex = -1;
            for (let i = 0; i < portionsToDistribute.length; i++) {
                const recipe = portionsToDistribute[i];
                if (recipe.haltbarkeit >= slot.age) {
                    const otherCategory = slot.category === 'mittagessen' ? 'abendessen' : 'mittagessen';
                    if (recipe.id !== newPlan[slot.day][otherCategory]) {
                        bestRecipeIndex = i;
                        break;
                    }
                }
            }
            
            if (bestRecipeIndex === -1) {
                for (let i = 0; i < portionsToDistribute.length; i++) {
                     if (portionsToDistribute[i].haltbarkeit >= slot.age) {
                         bestRecipeIndex = i;
                         break;
                     }
                }
            }

            if (bestRecipeIndex !== -1) {
                const assignedRecipe = portionsToDistribute.splice(bestRecipeIndex, 1)[0];
                newPlan[slot.day][slot.category] = assignedRecipe.id;
            }
        });
    }

    document.dispatchEvent(new CustomEvent('planUpdated', { detail: newPlan }));
    closeSmartFillWizard();
    showToast("Wochenplan wurde intelligent gefüllt.");
    askToResetShoppingList("Dein Wochenplan wurde durch den Assistenten aktualisiert.");
}

/**
 * Tauscht ein einzelnes Rezept in der Vorschau aus.
 * (Diese Funktion bleibt unverändert)
 */
function handleReroll(event) {
    const target = event.target;
    if (!target.classList.contains('reroll-btn')) return;

    const recipeId = target.dataset.recipeId;
    const category = target.dataset.category;

    const oldRecipe = currentProposal[category].find(r => r.id === recipeId);
    if (!oldRecipe) return;

    const currentIds = currentProposal[category].map(r => r.id);
    const potentialNewRecipes = localRecipeData.filter(r => 
        r.category === (category === 'mahlzeit' ? 'mahlzeit' : category) && 
        !currentIds.includes(r.id) &&
        r.haltbarkeit === oldRecipe.haltbarkeit
    );
    
    if (potentialNewRecipes.length > 0) {
        const newRecipe = potentialNewRecipes[0];
        const indexToReplace = currentProposal[category].findIndex(r => r.id === recipeId);
        currentProposal[category][indexToReplace] = newRecipe;
        renderProposal();
    } else {
        showToast("Kein alternatives Rezept gefunden.");
    }
}


// === HILFSFUNKTIONEN ===

/**
 * Wählt eine bestimmte Anzahl zufälliger, einzigartiger Rezepte aus einer Kategorie.
 * (Diese Funktion bleibt als Fallback erhalten)
 */
function getRandomUniqueRecipes(sourceArray, category, count) {
    const filtered = sourceArray.filter(r => r.category === category);
    const shuffled = filtered.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

/**
 * NEUE HILFSFUNKTION: Findet Rezepte, bei denen der dominanteste Zutatentyp
 * (nach Menge) einem bestimmten Typ entspricht.
 */
function getRecipesByDominantType(recipes, dominantType) {
    return recipes.filter(recipe => {
        if (recipe.category !== 'mahlzeit' || !recipe.ingredients || recipe.ingredients.length === 0) {
            return false;
        }

        // Finde die Zutat mit der größten Menge (wir nehmen an, das ist die Hauptzutat)
        const dominantIngredient = recipe.ingredients.reduce((prev, current) => {
            // Wir vergleichen nur, wenn die Einheit 'g' ist, um Äpfel mit Birnen zu vermeiden
            if (current.unit === 'g' && prev.unit === 'g') {
                return (prev.amount > current.amount) ? prev : current;
            }
            return prev;
        });

        return dominantIngredient.type === dominantType;
    });
}


// === EVENT LISTENER FÜR DEN ASSISTENTEN ===
cancelButtons.forEach(btn => btn.addEventListener('click', closeSmartFillWizard));
proposalContainer.addEventListener('click', handleReroll);

proposeButton.addEventListener('click', () => {
    generateProposal();
    renderProposal();
    step1.style.display = 'none';
    step2.style.display = 'block';
});

fillPlanButton.addEventListener('click', distributeRecipes);

// Wir exportieren die Funktion, damit app.js sie verwenden kann.
export { openSmartFillWizard };
