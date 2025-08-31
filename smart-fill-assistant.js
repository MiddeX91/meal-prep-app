import { capitalize } from './utils.js';

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
let localRecipeData = []; // NEU: Lokale Kopie der Rezeptdaten
let localWeeklyPlan = {};

// === HAUPTFUNKTIONEN ===

/**
 * Öffnet das Menü und empfängt die aktuellen Rezeptdaten.
 */
function openSmartFillWizard(allRecipes, currentPlan) { 
  localRecipeData = allRecipes;
  // Wir erstellen eine tiefe Kopie, um nicht versehentlich das Original zu ändern
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
 * Generiert die Rezept-Vorschläge basierend auf den Regeln.
 */
function generateProposal() {
    currentProposal.mahlzeit = getRandomUniqueRecipes(localRecipeData, 'mahlzeit', 3);
    currentProposal.frühstück = getRandomUniqueRecipes(localRecipeData, 'frühstück', 2);
    currentProposal.snack = getRandomUniqueRecipes(localRecipeData, 'snack', 2);
}

/**
 * Zeigt die vorgeschlagenen Rezepte im zweiten Schritt des Assistenten an.
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

    // --- Pools für Frühstück & Snacks (einfache Rotation) ---
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

    // --- NEUE, AUSBALANCIERTE LOGIK FÜR HAUPTMAHLZEITEN ---
    const sortedMahlzeiten = [...currentProposal.mahlzeit].sort((a, b) => a.haltbarkeit - b.haltbarkeit);
    if (sortedMahlzeiten.length > 0) {
        // 1. Erstelle die exakte Liste der zu verteilenden Portionen (4/3/3 Verteilung)
        let portionsToDistribute = [];
        if (sortedMahlzeiten[0]) portionsToDistribute.push(sortedMahlzeiten[0], sortedMahlzeiten[0], sortedMahlzeiten[0]);
        if (sortedMahlzeiten[1]) portionsToDistribute.push(sortedMahlzeiten[1], sortedMahlzeiten[1], sortedMahlzeiten[1]);
        if (sortedMahlzeiten[2]) {
             // Das langlebigste Rezept bekommt die 4. Portion
            const longestLasting = sortedMahlzeiten.sort((a, b) => b.haltbarkeit - a.haltbarkeit)[0];
            portionsToDistribute.push(longestLasting, longestLasting, longestLasting, longestLasting);
        }
        // Korrigiere die Verteilung auf 3,3,4
        portionsToDistribute = [];
        const portionsCount = [3, 3, 4];
        sortedMahlzeiten.reverse(); // Langlebigstes zuerst für die 4 Portionen
        sortedMahlzeiten.forEach((recipe, index) => {
            for(let i = 0; i < portionsCount[index]; i++) {
                portionsToDistribute.push(recipe);
            }
        });


        // 2. Sammle alle leeren Hauptmahlzeit-Slots der Woche
        const dayAges = { montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonntag: 7 };
        let emptySlots = [];
        selectedDays.forEach(day => {
            ['mittagessen', 'abendessen'].forEach(category => {
                if (newPlan[day][category] === null) {
                    emptySlots.push({ day: day, category: category, age: dayAges[day] });
                }
            });
        });

        // 3. Fülle die Slots intelligent
        emptySlots.forEach(slot => {
            let bestRecipeIndex = -1;
            // Finde das beste verfügbare Rezept für diesen Slot
            for (let i = 0; i < portionsToDistribute.length; i++) {
                const recipe = portionsToDistribute[i];
                // Kriterium 1: Haltbar?
                if (recipe.haltbarkeit >= slot.age) {
                    // Kriterium 2: Nicht dasselbe wie die andere Mahlzeit an diesem Tag?
                    const otherCategory = slot.category === 'mittagessen' ? 'abendessen' : 'mittagessen';
                    if (recipe.id !== newPlan[slot.day][otherCategory]) {
                        bestRecipeIndex = i;
                        break;
                    }
                }
            }
            
            // Fallback: Wenn alle haltbaren Rezepte schon am selben Tag sind, nimm das erste haltbare
            if (bestRecipeIndex === -1) {
                for (let i = 0; i < portionsToDistribute.length; i++) {
                     if (portionsToDistribute[i].haltbarkeit >= slot.age) {
                         bestRecipeIndex = i;
                         break;
                     }
                }
            }

            // Weise das gefundene Rezept zu und entferne es aus dem Pool
            if (bestRecipeIndex !== -1) {
                const assignedRecipe = portionsToDistribute.splice(bestRecipeIndex, 1)[0];
                newPlan[slot.day][slot.category] = assignedRecipe.id;
            }
        });
    }

    document.dispatchEvent(new CustomEvent('planUpdated', { detail: newPlan }));
    closeSmartFillWizard();
    showToast("Wochenplan wurde intelligent gefüllt.");
}

/**
 * Tauscht ein einzelnes Rezept in der Vorschau aus.
 */
function handleReroll(event) {
    const target = event.target;
    if (!target.classList.contains('reroll-btn')) return;

    const recipeId = target.dataset.recipeId;
    const category = target.dataset.category;

    // Finde das alte Rezept, um die Haltbarkeit zu kennen
    const oldRecipe = currentProposal[category].find(r => r.id === recipeId);
    if (!oldRecipe) return;

    // Finde ein neues Rezept, das noch nicht in der Vorschau ist
    const currentIds = currentProposal[category].map(r => r.id);
    const potentialNewRecipes = localRecipeData.filter(r => 
        r.category === (category === 'mahlzeit' ? 'mahlzeit' : category) && 
        !currentIds.includes(r.id) &&
        r.haltbarkeit === oldRecipe.haltbarkeit // Nur selbe Haltbarkeits-Kategorie
    );
    
    if (potentialNewRecipes.length > 0) {
        const newRecipe = potentialNewRecipes[0];
        // Ersetze das alte Rezept mit dem neuen
        const indexToReplace = currentProposal[category].findIndex(r => r.id === recipeId);
        currentProposal[category][indexToReplace] = newRecipe;
        renderProposal(); // Zeichne die Vorschau neu
    } else {
        showToast("Kein alternatives Rezept gefunden.");
    }
}

// === HILFSFUNKTIONEN ===

/**
 * Wählt eine bestimmte Anzahl zufälliger, einzigartiger Rezepte aus einer Kategorie.
 */
function getRandomUniqueRecipes(sourceArray, category, count) {
    const filtered = sourceArray.filter(r => r.category === category);
    const shuffled = filtered.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
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