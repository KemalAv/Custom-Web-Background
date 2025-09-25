// Add event listeners when the popup is loaded
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', saveSettings);
    });
});

// A helper function to safely set a checkbox's value
function setCheckboxValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.checked = value;
    } else {
        console.warn(`Could not find element with ID: ${id}`);
    }
}

// A helper function to safely get a checkbox's value
function getCheckboxValue(id, defaultValue = true) {
    const element = document.getElementById(id);
    if (element) {
        return element.checked;
    }
    console.warn(`Could not find element with ID: ${id}. Using default value.`);
    return defaultValue;
}


// Function to load settings from chrome.storage and update the checkboxes
function loadSettings() {
    const defaultPreferences = {
        showLabels: true,
        showTier: true,
        showLikeRatio: true,
        showRating: true,
        showVotes: true,
        showEngagementRate: true
    };

    chrome.storage.sync.get('displayPreferences', (data) => {
        // If the popup was closed before storage responded, exit.
        if (!document.body) {
            return;
        }

        const storedPrefs = data.displayPreferences || {};
        
        // Use stored preferences, or older names, or defaults.
        const prefs = {
            showLabels: storedPrefs.showLabels ?? defaultPreferences.showLabels,
            showTier: storedPrefs.showTier ?? defaultPreferences.showTier,
            showLikeRatio: storedPrefs.showLikeRatio ?? storedPrefs.showAccuracy ?? defaultPreferences.showLikeRatio,
            showRating: storedPrefs.showRating ?? defaultPreferences.showRating,
            showVotes: storedPrefs.showVotes ?? defaultPreferences.showVotes,
            showEngagementRate: storedPrefs.showEngagementRate ?? storedPrefs.showEngagement ?? defaultPreferences.showEngagementRate,
        };

        // Safely update the UI using the helper function
        setCheckboxValue('showLabels', prefs.showLabels);
        setCheckboxValue('showTier', prefs.showTier);
        setCheckboxValue('showLikeRatio', prefs.showLikeRatio);
        setCheckboxValue('showRating', prefs.showRating);
        setCheckboxValue('showVotes', prefs.showVotes);
        setCheckboxValue('showEngagementRate', prefs.showEngagementRate);
    });
}


// Function to save settings to chrome.storage
function saveSettings() {
    // If popup is closed, do nothing.
    if (!document.body) {
        return;
    }
    
    // Safely get values from the UI using the helper function
    const settings = {
        showLabels: getCheckboxValue('showLabels'),
        showTier: getCheckboxValue('showTier'),
        showLikeRatio: getCheckboxValue('showLikeRatio'),
        showRating: getCheckboxValue('showRating'),
        showVotes: getCheckboxValue('showVotes'),
        showEngagementRate: getCheckboxValue('showEngagementRate')
    };
    
    chrome.storage.sync.set({ displayPreferences: settings });
}