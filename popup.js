document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const enabledCheckbox = document.getElementById('enabledCheckbox');
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
    const addColorButton = document.getElementById('addColorButton');
    const colorListUL = document.getElementById('colorList');
    const forceTransparentCheckbox = document.getElementById('forceTransparentCheckbox');

    let newImageData = null;

    /**
     * Load settings from chrome.storage and populate UI.
     */
    const loadSettings = () => {
        const defaults = {
            isEnabled: true,
            imageName: 'Using default image.',
            imageDataUrl: null,
            imageUrl: '',
            dimLevel: 0,
            dimColor: 'dark',
            blurIntensity: 0,
            chromaKeyColors: [],
            forceTransparent: false
        };

        chrome.storage.local.get(defaults, (settings) => {
            enabledCheckbox.checked = settings.isEnabled;
            dimLevelInput.value = settings.dimLevel;
            blurSlider.value = settings.blurIntensity;
            imageUrlInput.value = settings.imageUrl || '';
            currentImageNameSpan.textContent = settings.imageName;
            forceTransparentCheckbox.checked = settings.forceTransparent;

            const dimColorRadio = document.querySelector(`input[name="dimColor"][value="${settings.dimColor}"]`);
            if (dimColorRadio) dimColorRadio.checked = true;

            renderColorList(settings.chromaKeyColors);
            updateUIValues();
            toggleSettingsPanel();
        });
    };

    /**
     * Save current UI settings to chrome.storage.
     */
    const saveSettings = () => {
        chrome.storage.local.get({ chromaKeyColors: [] }, (data) => {
            const settings = {
                isEnabled: enabledCheckbox.checked,
                dimLevel: dimLevelInput.value,
                blurIntensity: blurSlider.value,
                dimColor: document.querySelector('input[name="dimColor"]:checked').value,
                chromaKeyColors: data.chromaKeyColors,
                forceTransparent: forceTransparentCheckbox.checked
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

        chrome.storage.local.set({
            imageUrl: url,
            imageDataUrl: null,
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
        statusDiv.textContent = message;
        setTimeout(() => { statusDiv.textContent = ''; }, 2000);
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
     * Handle image upload.
     */
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            newImageData = { url: event.target.result, name: file.name };
            currentImageNameSpan.textContent = `New: ${file.name}`;
            currentImageNameSpan.style.color = 'var(--primary-color)';
            currentImageNameSpan.style.fontWeight = 'bold';
        };
        reader.readAsDataURL(file);
    };

    /**
     * Render chroma key color list.
     */
    const renderColorList = (colors = []) => {
        colorListUL.innerHTML = '';
        colors.forEach(color => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="color-swatch" style="background-color:${color};"></span>
                <span class="color-hex">${color.toUpperCase()}</span>
                <button class="delete-color-btn" data-color="${color}">×</button>
            `;
            li.querySelector('.delete-color-btn').addEventListener('click', handleDeleteColor);
            colorListUL.appendChild(li);
        });
        addColorButton.disabled = colors.length >= 5;
    };

    /**
     * Add color using EyeDropper API.
     */
    const addColorWithEyedropper = async () => {
        if (!window.EyeDropper) {
            showStatus('Eyedropper not supported by browser.');
            return;
        }
        try {
            const result = await new EyeDropper().open();
            const newColor = result.sRGBHex.toLowerCase();
            chrome.storage.local.get({ chromaKeyColors: [] }, (data) => {
                let colors = data.chromaKeyColors;
                if (colors.length < 5 && !colors.includes(newColor)) {
                    colors.push(newColor);
                    chrome.storage.local.set({ chromaKeyColors: colors });
                }
            });
        } catch {
            console.log('Eyedropper cancelled.');
        }
    };

    /**
     * Handle deleting a chroma key color.
     */
    const handleDeleteColor = (e) => {
        const color = e.target.dataset.color;
        chrome.storage.local.get({ chromaKeyColors: [] }, (data) => {
            const updated = data.chromaKeyColors.filter(c => c !== color);
            chrome.storage.local.set({ chromaKeyColors: updated });
        });
    };

    // --- Event Listeners ---
    enabledCheckbox.addEventListener('change', toggleSettingsPanel);
    uploadButton.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', handleImageUpload);
    applyUrlButton.addEventListener('click', applyImageUrl);
    dimLevelInput.addEventListener('input', updateUIValues);
    blurSlider.addEventListener('input', updateUIValues);
    addColorButton.addEventListener('click', addColorWithEyedropper);
    saveButton.addEventListener('click', saveSettings);

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.chromaKeyColors) {
            renderColorList(changes.chromaKeyColors.newValue);
        }
    });

    // Initialize on load
    loadSettings();
});
