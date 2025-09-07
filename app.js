
import { openSmartFillWizard } from './smart-fill-assistant.js';
import { capitalize } from './utils.js';


// Firebase initialisieren und die 'db'-Variable erstellen
const db = firebase.firestore();

// === GLOBALE VARIABLEN === Test
let cookingContainer;
let planTemplates = [];
let templateModal, templateModalTitle, templateModalBody, templateModalActions;
let shoppingListState = {};
let weeklyPlan = {}, recipeData = [], userProfile = {}, activeSlot = { day: null, category: null }, favoriteRecipeIds = [], zutatenLexikon = {};


const defaultProfile = {
    targetCalories: 2200,
    targetMacros: { protein: 150, carbs: 200, fat: 70 }
};
const emptyPlan = {
    montag: { frühstück: null, mittagessen: null, abendessen: null, snack: null },
    dienstag: { frühstück: null, mittagessen: null, abendessen: null, snack: null },
    mittwoch: { frühstück: null, mittagessen: null, abendessen: null, snack: null },
    donnerstag: { frühstück: null, mittagessen: null, abendessen: null, snack: null },
    freitag: { frühstück: null, mittagessen: null, abendessen: null, snack: null },
    samstag: { frühstück: null, mittagessen: null, abendessen: null, snack: null },
    sonntag: { frühstück: null, mittagessen: null, abendessen: null, snack: null }
};

// DOM-Elemente
let pageTitle, navButtons, pages, searchInput, plannerContainer, shoppingListContainer, recipeSelectModal, modalRecipeList, modalTitle, modalCancelBtn, darkModeToggle, clearPlanBtn, userProfileContainer, toast;

// === EVENT LISTENER ===
document.addEventListener('DOMContentLoaded', initialize);

// === FUNKTIONEN ===

async function initialize() {
    // DOM-Elemente auswählen
    pageTitle = document.getElementById('page-title');
    navButtons = document.querySelectorAll('.nav-button');
    pages = document.querySelectorAll('.page');
    searchInput = document.getElementById('search-input');
    plannerContainer = document.getElementById('planner-container');
    shoppingListContainer = document.getElementById('shopping-list-container');
    recipeSelectModal = document.getElementById('recipe-select-modal');
    modalRecipeList = document.getElementById('modal-recipe-list');
    modalTitle = document.getElementById('modal-title');
    modalCancelBtn = recipeSelectModal.querySelector('.modal-cancel-btn');
    darkModeToggle = document.getElementById('dark-mode-toggle');
    clearPlanBtn = document.getElementById('clear-plan-btn');
    userProfileContainer = document.querySelector('.profile-grid');
    toast = document.getElementById('toast-notification');
    cookingContainer = document.getElementById('cooking-container');
templateModal = document.getElementById('template-modal');
templateModalTitle = document.getElementById('template-modal-title');
templateModalBody = document.getElementById('template-modal-body');
templateModalActions = document.getElementById('template-modal-actions');

    assignEventListeners();
    
    // Warte, bis die Rezepte aus der Cloud geladen sind
    await loadRecipesFromFirestore(); 
    await loadZutatenLexikon();
    
    // Lade den Rest der lokalen Daten
    loadDataFromLocalStorage();
    applyDarkMode(localStorage.getItem('darkMode') === 'true');
    
    

    // Zeige alles an, NACHDEM die Daten geladen sind
    navigateTo('page-recipes'); 
}

function assignEventListeners() {
    navButtons.forEach(button => button.addEventListener('click', handleNavClick));
    searchInput.addEventListener('input', handleSearch);
    plannerContainer.addEventListener('click', handlePlannerClick);
    modalRecipeList.addEventListener('click', handleRecipeSelection);
    modalCancelBtn.addEventListener('click', closeRecipeSelectModal);
    recipeSelectModal.addEventListener('click', (e) => { if(e.target === recipeSelectModal) closeRecipeSelectModal(); });
    darkModeToggle.addEventListener('change', toggleDarkMode);
    clearPlanBtn.addEventListener('click', clearWeeklyPlan);
    userProfileContainer.addEventListener('click', handleProfileEdit);
    shoppingListContainer.addEventListener('click', handleShoppingListClick);

    // Alte Listener für prompt() entfernen, neue zuweisen
    const savePlanBtn = document.getElementById('save-plan-btn');
    const loadPlanBtn = document.getElementById('load-plan-btn');

    if (savePlanBtn) savePlanBtn.addEventListener('click', openSaveTemplateModal);
    if (loadPlanBtn) loadPlanBtn.addEventListener('click', openLoadTemplateModal);

    // Neue Listener für das Modal selbst
    templateModal.querySelector('.modal-cancel-btn').addEventListener('click', closeTemplateModal);
    templateModalBody.addEventListener('click', handleTemplateModalClick);

    const resetShoppingListBtn = document.getElementById('reset-shopping-list-btn');
if (resetShoppingListBtn) {
    resetShoppingListBtn.addEventListener('click', () => {
        if (confirm("Möchtest du wirklich alle Haken von der Einkaufsliste entfernen?")) {
            resetShoppingList();
        }
    });
}


const smartFillButton = document.getElementById('smart-fill-btn');
if (smartFillButton) {
    smartFillButton.addEventListener('click', () => openSmartFillWizard(recipeData, weeklyPlan));
}

document.addEventListener('planUpdated', (event) => {
    console.log("Plan wurde durch Assistenten aktualisiert. Empfange neuen Plan...");
    // Wir nehmen den neuen Plan aus dem Event entgegen
    weeklyPlan = event.detail; 
    renderPlanner();
    saveDataToLocalStorage();
});



}

async function loadRecipesFromFirestore() {
    console.log("Lade Rezepte aus Firestore...");
    try {
        const snapshot = await db.collection('rezepte').get();
        recipeData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`✅ ${recipeData.length} Rezepte erfolgreich aus der Cloud geladen.`);
    } catch (error) {
        console.error("❌ Fehler beim Laden der Rezepte aus Firestore:", error);
        alert("Die Rezepte konnten nicht aus der Cloud geladen werden. Bitte prüfe deine Internetverbindung und die Firebase-Konfiguration in app.js.");
    }
}



function renderAll() {
    renderRecipes(recipeData);
    renderPlanner();
    renderUserProfile();
}

function renderRecipes(recipesToDisplay) {
    const container = document.querySelector('#page-recipes');
    container.querySelectorAll('.recipe-container').forEach(c => c.innerHTML = '');
    
    if (!recipesToDisplay || recipesToDisplay.length === 0) {
        console.warn("Keine Rezepte zum Anzeigen vorhanden.");
        return;
    };
    
    recipesToDisplay.forEach(recipe => {
        const targetContainer = container.querySelector(`#recipes-section-${recipe.category} .recipe-container`);
        if (targetContainer) {
            targetContainer.appendChild(createRecipeCard(recipe));
        }
    });

    container.querySelectorAll('[id^="recipes-section-"]').forEach(section => {
        section.style.display = section.querySelector('.recipe-card') ? 'block' : 'none';
    });
}

// NEU: Verwende 'favorite-star' als Klasse für den Button
function createRecipeCard(recipe) {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    const macros = recipe.basis_makros || { protein: 0, carbs: 0, fat: 0 };
    const calories = recipe.basis_kalorien || 0;
    const ingredients = recipe.ingredients || [];
    
    // Prüft, ob die Text-ID in der Favoriten-Liste ist
    const isFavorite = favoriteRecipeIds.includes(recipe.id);

    const ingredientsHTML = ingredients.map(ing => `<li>${ing.amount}${ing.unit || ''} ${ing.name}</li>`).join('');

    card.innerHTML = `
        <button class="favorite-star-btn ${isFavorite ? 'favorited' : ''}" data-recipe-id="${recipe.id}">⭐</button>
        <details>
            <summary>
                <div class="card-summary-content">
                    <h3>${recipe.title}</h3>
                </div>
                <p class="card-meta">ca. ${calories} kcal | ${recipe.prepTime || ''}</p>
            </summary>
            <div class="card-details">
                <h4>Zutaten:</h4><ul>${ingredientsHTML}</ul>
                <h4>Anleitung:</h4><p>${recipe.instructions}</p>
                <h4>Makronährstoffe:</h4><p>P: ${macros.protein}g | C: ${macros.carbs}g | F: ${macros.fat}g</p>
            </div>
        </details>`;
    
    // Der Event Listener wird hier direkt an den Button gehängt
    const favoriteButton = card.querySelector('.favorite-star-btn'); // Klasse anpassen
    if (favoriteButton) {
        favoriteButton.addEventListener('click', handleFavoriteClick);
    }
    
    return card;
}

function renderPlanner() {
    plannerContainer.innerHTML = '';
    for (const day in weeklyPlan) {
        const dayDetails = document.createElement('details');
        dayDetails.className = 'day-card';
        dayDetails.dataset.day = day; // Wichtig für das Offenhalten
        dayDetails.open = false;

        let totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
        const mainMeals = [weeklyPlan[day].frühstück, weeklyPlan[day].mittagessen, weeklyPlan[day].abendessen];
        const isComplete = mainMeals.every(meal => meal !== null);
        
        dayDetails.classList.toggle('day-complete', isComplete);
        dayDetails.classList.toggle('day-incomplete', !isComplete && mainMeals.some(meal => meal !== null));

        let mealSlotsHTML = '';
        for (const category in weeklyPlan[day]) {
            const recipe = findRecipeById(weeklyPlan[day][category]);
            
            // NEU: Robuste Prüfung, ob Nährwerte vorhanden sind
            if (recipe && recipe.basis_kalorien && recipe.basis_makros) {
                totals.calories += recipe.basis_kalorien;
                totals.protein += recipe.basis_makros.protein;
                totals.carbs += recipe.basis_makros.carbs;
                totals.fat += recipe.basis_makros.fat;
            }

            const recipeMacros = (recipe && recipe.basis_makros) 
                ? `<div class="meal-slot-macros">P:${recipe.basis_makros.protein}g | C:${recipe.basis_makros.carbs}g | F:${recipe.basis_makros.fat}g</div>` 
                : '';
                
            const mealSlotContent = recipe
                ? `<div><span>${recipe.title}</span>${recipeMacros}</div><button class="remove-from-plan-btn" data-day="${day}" data-category="${category}">×</button>`
                : `<button class="add-to-slot-btn" data-day="${day}" data-category="${category}">+ Rezept wählen</button>`;
            
            mealSlotsHTML += `<div class="meal-slot"><strong>${capitalize(category)}:</strong>${mealSlotContent}</div>`;
        }

        dayDetails.innerHTML = `
            <summary>
                <div class="day-card-summary-content">
                    <h3>${capitalize(day)}</h3>
                </div>
                ${createProgressBarsHTML(totals, userProfile)}
            </summary>
            <div class="day-meal-slots">${mealSlotsHTML}</div>
        `;
        plannerContainer.appendChild(dayDetails);
    }
}

// === EVENT HANDLER ===

function handleNavClick(event) {
    const pageId = event.currentTarget.dataset.page;
    navigateTo(pageId);
}

function handleSearch() {
    const searchTerm = searchInput.value.toLowerCase();
    const filteredRecipes = recipeData.filter(r => r.title.toLowerCase().includes(searchTerm));
    renderRecipes(filteredRecipes);
}

function handlePlannerClick(event) {
    const target = event.target;
    if (target.classList.contains('remove-from-plan-btn')) {
        const { day, category } = target.dataset;
        weeklyPlan[day][category] = null;
        saveDataToLocalStorage();
        renderPlanner();
        showToast("Rezept entfernt.");
    }
    if (target.classList.contains('add-to-slot-btn')) {
        const { day, category } = target.dataset;
        openRecipeSelectModal(day, category);
    }
}

function handleRecipeSelection(event) {
    if (event.target.classList.contains('select-recipe-btn')) {
        // Die ID ist ein Text und bleibt ein Text. Kein parseInt() mehr.
        const recipeId = event.target.dataset.recipeId; 
        
        const { day, category } = activeSlot;
        if(day && category) {
            weeklyPlan[day][category] = recipeId;
            saveDataToLocalStorage();
            renderPlanner();
            showToast("Rezept zum Plan hinzugefügt.");
        }
        closeRecipeSelectModal();
    }
    if (day) {
    // Finde die gerade aktualisierte Tageskarte und klappe sie wieder auf
    plannerContainer.querySelector(`[data-day="${day}"]`).open = true;
}
}

function handleProfileEdit(event) {
    const target = event.target.closest('.profile-item');
    if (!target) return;
    const key = target.dataset.key;
    const keys = key.split('.');
    let currentValue = (keys.length > 1) ? userProfile[keys[0]][keys[1]] : userProfile[keys[0]];
    const label = target.querySelector('label').textContent;
    const newValue = prompt(`Neuen Wert für "${label}" eingeben:`, currentValue);
    if (newValue !== null && !isNaN(newValue) && newValue.trim() !== "") {
        const numericValue = parseInt(newValue, 10);
        if (keys.length > 1) {
            userProfile[keys[0]][keys[1]] = numericValue;
        } else {
            userProfile[keys[0]] = numericValue;
        }
        saveDataToLocalStorage();
        renderUserProfile();
        renderPlanner();
        showToast("Profil aktualisiert.");
    }
}

function handleFavoriteClick(event) {
    event.stopPropagation(); // Verhindert, dass sich das <details> aufklappt
    
    const recipeId = event.currentTarget.dataset.recipeId;
    const recipe = findRecipeById(recipeId);
    if (!recipe) return;

    const index = favoriteRecipeIds.indexOf(recipeId);

    if (index > -1) {
        // Bereits ein Favorit -> entfernen
        favoriteRecipeIds.splice(index, 1);
        showToast(`"${recipe.title}" von Favoriten entfernt.`);
    } else {
        // Noch kein Favorit -> hinzufügen
        favoriteRecipeIds.push(recipeId);
        showToast(`"${recipe.title}" zu Favoriten hinzugefügt.`);
    }
    
    // Wichtige Schritte:
    // 1. Speichere den neuen Zustand
    saveDataToLocalStorage();
    // 2. Zeichne die komplette Rezeptliste neu, basierend auf dem neuen Zustand
    renderRecipes(recipeData);
}

// === MODAL-LOGIK ===

function openRecipeSelectModal(day, category) {
    activeSlot = { day, category };
    modalTitle.textContent = `Wähle ein Rezept für: ${capitalize(category)}`;
    modalRecipeList.innerHTML = '';
    let recipeCategoryToShow = (category === 'mittagessen' || category === 'abendessen') ? 'mahlzeit' : category;
    
    let fittingRecipes = recipeData.filter(r => r.category === recipeCategoryToShow);

    // NEU: Sortiere die Rezepte, sodass Favoriten oben stehen
    fittingRecipes.sort((a, b) => {
        const aIsFavorite = favoriteRecipeIds.includes(a.id);
        const bIsFavorite = favoriteRecipeIds.includes(b.id);
        return bIsFavorite - aIsFavorite; // True (1) kommt vor False (0)
    });
    
    if (fittingRecipes.length > 0) {
        fittingRecipes.forEach(recipe => {
            const button = document.createElement('button');
            button.className = 'select-recipe-btn';
            button.dataset.recipeId = recipe.id;
            
            // NEU: Füge einen Stern für Favoriten hinzu
            const isFavorite = favoriteRecipeIds.includes(recipe.id);
            button.innerHTML = `${isFavorite ? '⭐ ' : ''}${recipe.title}`;
            
            modalRecipeList.appendChild(button);
        });
    } else {
        modalRecipeList.innerHTML = '<p>Keine passenden Rezepte gefunden.</p>';
    }
    recipeSelectModal.classList.add('active');
}

function closeRecipeSelectModal() {
    recipeSelectModal.classList.remove('active');
    activeSlot = { day: null, category: null };
}

// === KOMFORT-FUNKTIONEN ===

function clearWeeklyPlan() {
    if (confirm("Möchtest du wirklich den gesamten Wochenplan löschen?")) {
        weeklyPlan = JSON.parse(JSON.stringify(emptyPlan));
        saveDataToLocalStorage();
        renderPlanner();
        showToast("Wochenplan wurde gelöscht.");
        askToResetShoppingList("Dein Wochenplan wurde geleert."); // NEU
    }
}

function toggleDarkMode() {
    const isDark = darkModeToggle.checked;
    localStorage.setItem('darkMode', isDark);
    applyDarkMode(isDark);
}

function applyDarkMode(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
    darkModeToggle.checked = isDark;
}

export function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// === KOMPONENTEN-ERSTELLUNG (Hilfsfunktionen) ===

function createRatingDisplay(rating) {
    let starsHTML = '';
    for (let i = 1; i <= 5; i++) {
        starsHTML += `<span class="star ${i <= rating ? 'filled' : ''}">★</span>`;
    }
    return `<div class="rating-display">${starsHTML}</div>`;
}

function createRatingEdit(rating) {
    let starsHTML = '';
    for (let i = 1; i <= 5; i++) {
        starsHTML += `<span class="star ${i <= rating ? 'filled' : ''}" data-value="${i}">★</span>`;
    }
    return starsHTML;
}

function createProgressBarsHTML(totals, profile) {
    const createBar = (label, current, target, unit = 'g') => {
        const percent = target > 0 ? Math.min((current / target) * 100, 100) : 0;
        const remaining = target - current;
        
        let labelText = '';
        if (remaining > 0) {
            labelText = `noch ${Math.round(remaining)} ${unit}`;
        } else {
            labelText = `Ziel erreicht 👍`;
        }

        return `
            <div class="progress-container">
                <div class="progress-label-left">${label}</div>
                <div class="progress-track"><div class="progress-bar" style="width: ${percent}%;"></div></div>
                <div class="progress-label-right">${labelText}</div>
            </div>`;
    };
    return `<div class="progress-section">
        ${createBar('Kalorien', totals.calories, profile.targetCalories, 'kcal')}
        ${createBar('Protein', totals.protein, profile.targetMacros.protein)}
        ${createBar('Kohlenhydrate', totals.carbs, profile.targetMacros.carbs)}
        ${createBar('Fett', totals.fat, profile.targetMacros.fat)}
    </div>`;
}


// === EINKAUFSLISTEN-LOGIK ===

function renderShoppingList() {
    const list = generateShoppingList();
    const container = document.getElementById('shopping-list-container');
    if (!container) return;

    if (!list || list.length === 0) {
        container.innerHTML = '<li>Plane Mahlzeiten, um deine Einkaufsliste zu füllen.</li>';
        return;
    }

    const groupedList = {};
    list.forEach(item => {
        const key = item.name.toLowerCase().replace(/\//g, '-');
        const category = zutatenLexikon[key] || 'Sonstiges';
        if (!groupedList[category]) groupedList[category] = [];
        groupedList[category].push(item);
    });

    let openItemsHTML = '';
    let doneItemsHTML = '';
    const categoryOrder = ['Gemüse & Obst', 'Fleisch & Fisch', 'Milchprodukte', 'Trockenwaren', 'Backzutaten', 'Gewürze & Öle', 'Getränke', 'Sonstiges'];
    
    categoryOrder.forEach(category => {
        if (groupedList[category]) {
            let openCategoryItems = '';
            let doneCategoryItems = '';
            
            groupedList[category].forEach(item => {
                const isChecked = shoppingListState[item.name.toLowerCase()];
                const itemHTML = `<li><input type="checkbox" data-item-name="${item.name.toLowerCase()}" ${isChecked ? 'checked' : ''}> ${item.amount || ''} ${item.unit || ''} ${item.name}</li>`;
                if (isChecked) {
                    doneCategoryItems += itemHTML;
                } else {
                    openCategoryItems += itemHTML;
                }
            });

            if (openCategoryItems) {
                openItemsHTML += `<li class="list-category-header">${category}</li>` + openCategoryItems;
            }
            if (doneCategoryItems) {
                doneItemsHTML += `<li class="list-category-header">${category}</li>` + doneCategoryItems;
            }
        }
    });

    let finalHTML = openItemsHTML;
    if (doneItemsHTML) {
        finalHTML += `<details class="done-items-details"><summary>Erledigt</summary>${doneItemsHTML}</details>`;
    }
    container.innerHTML = finalHTML;
}

function generateShoppingList() {
        console.log("Wochenplan, der für die Liste verwendet wird:", weeklyPlan); // NEUE DEBUG-ZEILE

    const list = {};
    for (const day in weeklyPlan) {
        for (const category in weeklyPlan[day]) {
            const recipe = findRecipeById(weeklyPlan[day][category]);
            if (recipe) {
                recipe.ingredients.forEach(ing => {
                    const key = ing.name.toLowerCase();
                    if (list[key] && list[key].unit === ing.unit) {
                        list[key].amount += ing.amount;
                    } else if (!list[key]) {
                        list[key] = { name: ing.name, amount: ing.amount, unit: ing.unit };
                    } else { // Andere Einheit, erstelle neuen Schlüssel
                        const newKey = `${ing.name.toLowerCase()}_${ing.unit}`;
                        list[newKey] = { name: ing.name, amount: ing.amount, unit: ing.unit };
                    }
                });
            }
        }
    }
    return Object.values(list);
}


// === HILFSFUNKTIONEN ===

function findRecipeById(id) {
    if (id === null || id === undefined) return null;
    return recipeData.find(recipe => recipe.id === id) || null;
}



function renderUserProfile() {
    const caloriesSpan = document.getElementById('user-calories');
    const proteinSpan = document.getElementById('user-protein');
    const carbsSpan = document.getElementById('user-carbs');
    const fatSpan = document.getElementById('user-fat');

    if (caloriesSpan && proteinSpan && carbsSpan && fatSpan && userProfile && userProfile.targetMacros) {
        caloriesSpan.textContent = userProfile.targetCalories;
        proteinSpan.textContent = userProfile.targetMacros.protein;
        carbsSpan.textContent = userProfile.targetMacros.carbs;
        fatSpan.textContent = userProfile.targetMacros.fat;
    }
}

function saveDataToLocalStorage() {
    localStorage.setItem('mealPrepPlan', JSON.stringify(weeklyPlan));
    localStorage.setItem('mealPrepUser', JSON.stringify(userProfile));
    localStorage.setItem('mealPrepFavorites', JSON.stringify(favoriteRecipeIds));
    localStorage.setItem('mealPrepTemplates', JSON.stringify(planTemplates)); // NEU
    localStorage.setItem('mealPrepShoppingList', JSON.stringify(shoppingListState)); // NEU

}

function loadDataFromLocalStorage() {
    const savedPlan = localStorage.getItem('mealPrepPlan');
    const savedUser = localStorage.getItem('mealPrepUser');
    const savedFavorites = localStorage.getItem('mealPrepFavorites'); // NEU
    const savedTemplates = localStorage.getItem('mealPrepTemplates'); // NEU

const savedShoppingList = localStorage.getItem('mealPrepShoppingList'); // NEU
shoppingListState = savedShoppingList ? JSON.parse(savedShoppingList) : {}; // NEU

    planTemplates = savedTemplates ? JSON.parse(savedTemplates) : []; // NEU
    weeklyPlan = savedPlan ? JSON.parse(savedPlan) : JSON.parse(JSON.stringify(emptyPlan));
    userProfile = savedUser ? JSON.parse(savedUser) : JSON.parse(JSON.stringify(defaultProfile));
    favoriteRecipeIds = savedFavorites ? JSON.parse(savedFavorites) : []; // NEU
    
    // Veraltete Rezeptdaten aus dem Speicher entfernen, falls vorhanden
    localStorage.removeItem('mealPrepRecipes'); 
}

/**
 * Erstellt die Ansicht für den "Kochen"-Tab.
 * Sammelt alle geplanten Rezepte und addiert die Zutatenmengen.
 */
function renderCookingView() {
    cookingContainer.innerHTML = '';
    const recipesToCook = {};

    // 1. Alle Rezepte und ihre Anzahl im Plan sammeln
    for (const day in weeklyPlan) {
        for (const category in weeklyPlan[day]) {
            const recipeId = weeklyPlan[day][category];
            if (recipeId) {
                if (recipesToCook[recipeId]) {
                    recipesToCook[recipeId].count++;
                } else {
                    const recipe = findRecipeById(recipeId);
                    if (recipe) {
                        recipesToCook[recipeId] = {
                            count: 1,
                            ...recipe // Kopiere alle Rezept-Daten
                        };
                    }
                }
            }
        }
    }

    // 2. Für jedes zu kochende Rezept eine Karte erstellen
    const recipeArray = Object.values(recipesToCook);
    if(recipeArray.length === 0) {
        cookingContainer.innerHTML = '<p>Dein Wochenplan ist noch leer. Plane zuerst einige Mahlzeiten.</p>';
        return;
    }

    recipeArray.forEach(recipe => {
        const card = document.createElement('div');
        card.className = 'recipe-card';

        // Berechne die Gesamtmenge der Zutaten für den Batch
        const totalIngredientsHTML = recipe.ingredients.map(ing => {
            const totalAmount = ing.amount * recipe.count;
            return `<li>${totalAmount}${ing.unit || ''} ${ing.name}</li>`;
        }).join('');

        card.innerHTML = `
            <h3>${recipe.title} (${recipe.count} Portionen)</h3>
            <div class="card-details">
                <h4>Gesamte Zutaten für's Vorkochen:</h4>
                <ul>${totalIngredientsHTML}</ul>
                <h4>Anleitung:</h4>
                <p>${recipe.instructions}</p>
            </div>
        `;
        cookingContainer.appendChild(card);
    });
}

function navigateTo(pageId) {
    // 1. Alle Seiten verstecken, alle Buttons de-aktivieren
    pages.forEach(page => page.classList.remove('active'));
    navButtons.forEach(button => button.classList.remove('active'));

    // 2. Ziel-Seite und zugehörigen Button anzeigen/aktivieren
    document.getElementById(pageId).classList.add('active');
    const activeButton = document.querySelector(`.nav-button[data-page="${pageId}"]`);
    if (activeButton) {
        activeButton.classList.add('active');
        pageTitle.textContent = activeButton.textContent;
    }

    // 3. Die richtige "Render"-Funktion für die jeweilige Seite aufrufen
    switch (pageId) {
        case 'page-recipes':
            renderRecipes(recipeData);
            break;
        case 'page-planner':
            renderPlanner();
            break;
        case 'page-cooking':
            renderCookingView();
            break;
        case 'page-shopping-list':
            renderShoppingList();
            break;
        case 'page-user':
            renderUserProfile();
            break;
    }
}

/**
 * Öffnet das Modal, um den aktuellen Plan als Vorlage zu speichern.
 */
function openSaveTemplateModal() {
    templateModalTitle.textContent = 'Plan als Vorlage speichern';
    
    templateModalBody.innerHTML = `
        <p>Gib deiner Vorlage einen Namen.</p>
        <input type="text" id="template-name-input" placeholder="z.B. Meine Standard-Woche">`;
    
    templateModalActions.innerHTML = `<button id="save-template-confirm-btn" class="button-primary">Speichern</button>`;

    templateModal.classList.add('active');

    // Event Listener nur für diese Aktion hinzufügen
    document.getElementById('save-template-confirm-btn').addEventListener('click', () => {
        const templateName = document.getElementById('template-name-input').value;
        if (templateName) {
            const existingIndex = planTemplates.findIndex(t => t.name === templateName);
            const newTemplate = { name: templateName, plan: JSON.parse(JSON.stringify(weeklyPlan)) };

            if (existingIndex > -1) {
                planTemplates[existingIndex] = newTemplate;
                showToast(`Vorlage "${templateName}" wurde aktualisiert.`);
            } else {
                planTemplates.push(newTemplate);
                showToast(`Vorlage "${templateName}" wurde gespeichert.`);
            }
            saveDataToLocalStorage();
            closeTemplateModal();
        } else {
            alert("Bitte gib einen Namen ein.");
        }
    }, { once: true }); // { once: true } entfernt den Listener nach dem Klick automatisch
}

/**
 * Öffnet das Modal, um eine Vorlage aus einer Liste zu laden.
 */
function openLoadTemplateModal() {
    if (planTemplates.length === 0) {
        showToast("Du hast noch keine Vorlagen gespeichert.");
        return;
    }
    templateModalTitle.textContent = 'Vorlage laden';
    templateModalActions.innerHTML = ''; // Kein extra Button nötig

    let listHTML = '<div class="template-list">';
    planTemplates.forEach(template => {
        listHTML += `
            <button class="template-item" data-template-name="${template.name}">
                <span>${template.name}</span>
                <span class="delete-template-btn" data-template-name="${template.name}">×</span>
            </button>`;
    });
    listHTML += '</div>';
    templateModalBody.innerHTML = listHTML;
    
    templateModal.classList.add('active');
}

/**
 * Schließt das Vorlagen-Modal.
 */
function closeTemplateModal() {
    templateModal.classList.remove('active');
}

/**
 * Verarbeitet Klicks innerhalb des "Vorlage laden"-Modals.
 */
function handleTemplateModalClick(event) {
    const target = event.target;

    // Vorlage laden
    const templateItem = target.closest('.template-item');
    if (templateItem && !target.classList.contains('delete-template-btn')) {
        const selectedName = templateItem.dataset.templateName;
        const selectedTemplate = planTemplates.find(t => t.name === selectedName);
        if (selectedTemplate) {
            weeklyPlan = JSON.parse(JSON.stringify(selectedTemplate.plan));
            saveDataToLocalStorage();
            renderPlanner();
            showToast(`Vorlage "${selectedName}" wurde geladen.`);
            closeTemplateModal();
        }
    }

    // Vorlage löschen
    if (target.classList.contains('delete-template-btn')) {
        const selectedName = target.dataset.templateName;
        if (confirm(`Möchtest du die Vorlage "${selectedName}" wirklich löschen?`)) {
            planTemplates = planTemplates.filter(t => t.name !== selectedName);
            saveDataToLocalStorage();
            showToast(`Vorlage "${selectedName}" wurde gelöscht.`);
            // Lade die Ansicht im Modal neu
            openLoadTemplateModal();
        }
    }
}

async function loadZutatenLexikon() {
    try {
        const snapshot = await db.collection('zutatenLexikon').get();
        snapshot.forEach(doc => {
            // Speichere die Kategorie unter dem kleingeschriebenen Namen
            zutatenLexikon[doc.id] = doc.data().kategorie;
        });
        console.log(`✅ Lexikon mit ${Object.keys(zutatenLexikon).length} Einträgen geladen.`);
    } catch (error) {
        console.error("❌ Fehler beim Laden des Zutaten-Lexikons:", error);
    }
}

function handleShoppingListClick(event) {
    if (event.target.type === 'checkbox') {
        const itemName = event.target.dataset.itemName;
        shoppingListState[itemName] = event.target.checked;
        saveDataToLocalStorage();
        renderShoppingList(); // Zeichne die Liste neu, um das Element zu verschieben
    }
}

function resetShoppingList() {
    shoppingListState = {};
    saveDataToLocalStorage();
    renderShoppingList(); // Zeichne die Liste neu, um die Änderungen anzuzeigen
    showToast("Einkaufsliste wurde zurückgesetzt.");
}

export function askToResetShoppingList(reason) {
    // Frage nur, wenn überhaupt etwas abgehakt ist
    if (Object.keys(shoppingListState).length > 0) { 
        if (confirm(`${reason}\n\nMöchtest du auch deine Einkaufsliste zurücksetzen?`)) {
            resetShoppingList();
        }
    }
}