document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const enabledCheckbox = document.getElementById('enabledCheckbox');
    const animationsCheckbox = document.getElementById('animationsCheckbox');
    const protectModalsCheckbox = document.getElementById('protectModalsCheckbox');
    const autoTextColorCheckbox = document.getElementById('autoTextColorCheckbox');
    const protectModalsSection = document.getElementById('protectModalsSection');
    const settingsPanel = document.getElementById('settings-panel');
    const imageUploadInput = document.getElementById('imageUpload');
    const uploadButton = document.getElementById('uploadButton');
    const imageUrlInput = document.getElementById('imageUrlInput');
    const applyUrlButton = document.getElementById('applyUrlButton');
    const currentImageNameSpan = document.getElementById('currentImageName');
    const dimLevelInput = document.getElementById('dimLevel');
    const dimValueSpan = document.getElementById('dimValue');
    const blurSlider = document.getElementById('blurSlider');
    const blurValueSpan = document.getElementById('blurValue');
    const saveButton = document.getElementById('saveButton');
    const statusDiv = document.getElementById('status');

    let newImageData = null;

    /**
     * Load settings from chrome.storage and populate UI.
     */
    const loadSettings = () => {
        const defaults = {
            isEnabled: true,
            animationsEnabled: false,
            protectModals: false,
            autoTextColor: false,
            uiMode: 'chroma', // New setting
            imageName: 'Using default image.',
            imageDataUrl: null,
            imageUrl: 'https://images2.alphacoders.com/137/1375140.png',
            dimLevel: 0,
            dimColor: 'dark',
            blurIntensity: 0
        };

        chrome.storage.local.get(defaults, (settings) => {
            enabledCheckbox.checked = settings.isEnabled;
            animationsCheckbox.checked = settings.animationsEnabled;
            protectModalsCheckbox.checked = settings.protectModals;
            autoTextColorCheckbox.checked = settings.autoTextColor;
            dimLevelInput.value = settings.dimLevel;
            blurSlider.value = settings.blurIntensity;
            imageUrlInput.value = settings.imageUrl || '';
            currentImageNameSpan.textContent = settings.imageName;

            // Set UI Mode radio button
            const uiModeRadio = document.querySelector(`input[name="uiMode"][value="${settings.uiMode}"]`);
            if (uiModeRadio) uiModeRadio.checked = true;

            const dimColorRadio = document.querySelector(`input[name="dimColor"][value="${settings.dimColor}"]`);
            if (dimColorRadio) dimColorRadio.checked = true;

            updateUIValues();
            toggleSettingsPanel();
            toggleAnimations();
            toggleProtectModalsVisibility();

            // Auto apply default URL if set and no uploaded image
            if (settings.imageUrl && !settings.imageDataUrl) {
                chrome.storage.local.set({
                    imageUrl: settings.imageUrl,
                    imageDataUrl: null,
                    imageName: settings.imageName || 'From URL'
                });
            }
        });
    };

    /**
     * Save current UI settings to chrome.storage.
     */
    const saveSettings = () => {
        const settings = {
            isEnabled: enabledCheckbox.checked,
            animationsEnabled: animationsCheckbox.checked,
            protectModals: protectModalsCheckbox.checked,
            autoTextColor: autoTextColorCheckbox.checked,
            uiMode: document.querySelector('input[name="uiMode"]:checked').value, // New setting
            dimLevel: dimLevelInput.value,
            blurIntensity: blurSlider.value,
            dimColor: document.querySelector('input[name="dimColor"]:checked').value
        };

        if (newImageData) {
            settings.imageDataUrl = newImageData.url;
            settings.imageName = newImageData.name;
            settings.imageUrl = ''; // clear URL if uploading
        }

        chrome.storage.local.set(settings, () => {
            showStatus('Settings Applied!');
            newImageData = null;
        });
    };

    /**
     * Apply URL image, clear uploaded image.
     */
    const applyImageUrl = () => {
        const url = imageUrlInput.value.trim();
        if (!url) {
            showStatus('Please enter a valid URL.');
            return;
        }

        // We save the URL separately so it can be applied without hitting the main "Save"
        chrome.storage.local.set({
            imageUrl: url,
            imageDataUrl: null, // Clear file upload
            imageName: 'From URL'
        }, () => {
            currentImageNameSpan.textContent = 'From URL';
            currentImageNameSpan.style.color = 'var(--primary-color)';
            currentImageNameSpan.style.fontWeight = 'bold';
            showStatus('Image URL applied!');
        });
    };

    /**
     * Show status message temporarily.
     */
    const showStatus = (message) => {
        statusDiv.innerHTML = message;
        setTimeout(() => { statusDiv.innerHTML = ''; }, 2000);
    };

    /**
     * Update UI value displays.
     */
    const updateUIValues = () => {
        dimValueSpan.textContent = `${Math.round(dimLevelInput.value * 100)}%`;
        blurValueSpan.textContent = `${blurSlider.value}px`;
    };

    /**
     * Toggle settings panel based on enable toggle.
     */
    const toggleSettingsPanel = () => {
        settingsPanel.classList.toggle('disabled', !enabledCheckbox.checked);
    };

    /**
     * Toggle UI animations class on body.
     */
    const toggleAnimations = () => {
        document.body.classList.toggle('animations-enabled', animationsCheckbox.checked);
    };

    /**
     * Toggle Protect Modals section visibility based on UI mode.
     */
    const toggleProtectModalsVisibility = () => {
        // Protect Modals is now supported in both Chroma and Glass modes
        protectModalsSection.style.display = 'flex';
    };

    /**
     * Handle image upload.
     */
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const WARN_SIZE = 20 * 1024 * 1024; // 20 MB
        const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

        if (file.size > MAX_SIZE) {
            showStatus('File too large! Max limit is 100 MB.');
            e.target.value = ''; // Clear the input
            return;
        }

        if (file.size > WARN_SIZE) {
            const proceed = window.confirm('This file is larger than 20 MB and may cause lag. Do you want to continue?');
            if (!proceed) {
                showStatus('Upload cancelled.');
                e.target.value = ''; // Clear the input
                return;
            }
        }

        // Show loading spinner while reading the file
        showStatus('<span class="spinner"></span> Loading...');

        const reader = new FileReader();
        reader.onload = (event) => {
            newImageData = { url: event.target.result, name: file.name };
            currentImageNameSpan.textContent = `New: ${file.name}`;
            currentImageNameSpan.style.color = 'var(--primary-color)';
            currentImageNameSpan.style.fontWeight = 'bold';
            showStatus(''); // clear status
        };
        reader.onerror = () => {
            showStatus('Failed to read file.');
        };
        reader.readAsDataURL(file);
    };

    // --- Event Listeners ---
    enabledCheckbox.addEventListener('change', toggleSettingsPanel);
    animationsCheckbox.addEventListener('change', toggleAnimations);
    uploadButton.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', handleImageUpload);
    applyUrlButton.addEventListener('click', applyImageUrl);
    dimLevelInput.addEventListener('input', updateUIValues);
    blurSlider.addEventListener('input', updateUIValues);
    document.querySelectorAll('input[name="uiMode"]').forEach(radio => {
        radio.addEventListener('change', toggleProtectModalsVisibility);
    });
    saveButton.addEventListener('click', saveSettings);

    // Initialize on load
    loadSettings();
});