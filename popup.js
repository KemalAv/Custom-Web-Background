document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const enabledCheckbox = document.getElementById('enabledCheckbox');
    const animationsCheckbox = document.getElementById('animationsCheckbox');
    const autoTextColorCheckbox = document.getElementById('autoTextColorCheckbox');
    const settingsPanel = document.getElementById('settings-panel');
    const transparencyLevelSelect = document.getElementById('transparencyLevelSelect');
    const specificSitesSection = document.getElementById('specificSitesSection');
    const addCurrentSiteButton = document.getElementById('addCurrentSiteButton');
    const newSiteInput = document.getElementById('newSiteInput');
    const addSiteButton = document.getElementById('addSiteButton');
    const sitesList = document.getElementById('sitesList');
    const sitesCount = document.getElementById('sitesCount');
    const imageUploadInput = document.getElementById('imageUpload');
    const uploadButton = document.getElementById('uploadButton');
    const imageUrlInput = document.getElementById('imageUrlInput');
    const applyUrlButton = document.getElementById('applyUrlButton');
    const currentImageNameSpan = document.getElementById('currentImageName');
    const dimLevelInput = document.getElementById('dimLevel');
    const dimValueSpan = document.getElementById('dimValue');
    const customDimColorInput = document.getElementById('customDimColor');
    const customDimColorSection = document.getElementById('customDimColorSection');
    const customDimColorValue = document.getElementById('customDimColorValue');
    const autoDimColorSection = document.getElementById('autoDimColorSection');
    const autoDarkColorInput = document.getElementById('autoDarkColor');
    const autoDarkColorValue = document.getElementById('autoDarkColorValue');
    const autoLightColorInput = document.getElementById('autoLightColor');
    const autoLightColorValue = document.getElementById('autoLightColorValue');
    const blurSlider = document.getElementById('blurSlider');
    const blurValueSpan = document.getElementById('blurValue');
    const saveButton = document.getElementById('saveButton');
    const statusDiv = document.getElementById('status');
    const helpButton = document.getElementById('helpButton');

    // --- Mode & Action Elements ---
    const modeToggleButton = document.getElementById('modeToggleButton');
    const modeToggleText = document.getElementById('modeToggleText');
    const modeToggleIcon = document.getElementById('modeToggleIcon');
    const resetButton = document.getElementById('resetButton');

    // --- Preset Elements ---
    const presetDefaultBtn = document.getElementById('presetDefaultBtn');
    const presetClearBtn = document.getElementById('presetClearBtn');
    const presetFocusBtn = document.getElementById('presetFocusBtn');
    const presetBtns = [presetDefaultBtn, presetClearBtn, presetFocusBtn].filter(Boolean);

    const SVG_ICON_ADVANCED = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/></svg>`;
    const SVG_ICON_BASIC = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

    let currentUIMode = 'basic';
    let newImageData = null;
    let stagedMediaUrl = null;
    let initialLoadedImageUrl = '';
    let initialLoadedImageDataUrl = null;
    let initialLoadedImageName = 'Built-in background';
    let initialLoadedMediaType = 'image';
    let specificSites = [];

    /** Open the full guide page in a new browser tab. */
    const openGuide = () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    };

    /** Clean domain helper */
    const cleanDomain = (input) => {
        if (!input) return '';
        let str = input.trim().toLowerCase();
        str = str.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '');
        str = str.split('/')[0].split(':')[0];
        return str;
    };

    /** Render specific sites list */
    const renderSitesList = () => {
        if (sitesCount) {
            sitesCount.textContent = specificSites.length;
        }
        if (!sitesList) return;
        sitesList.innerHTML = '';
        if (specificSites.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'sites-empty';
            empty.textContent = 'No websites added yet.';
            sitesList.appendChild(empty);
            return;
        }

        specificSites.forEach((domain, idx) => {
            const item = document.createElement('div');
            item.className = 'site-item';

            const span = document.createElement('span');
            span.className = 'site-domain';
            span.textContent = domain;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'site-remove-btn';
            btn.innerHTML = '&times;';
            btn.title = `Remove ${domain}`;
            btn.addEventListener('click', () => {
                const removedDomain = specificSites[idx];
                specificSites.splice(idx, 1);
                renderSitesList();
                showStatus(`Removed ${removedDomain} (Click Apply & Save)`);
            });

            item.appendChild(span);
            item.appendChild(btn);
            sitesList.appendChild(item);
        });
    };

    /** Add domain to specific sites list */
    const addSite = (domain) => {
        const clean = cleanDomain(domain);
        if (!clean) {
            showStatus('Please enter a valid website.');
            return;
        }
        if (specificSites.includes(clean)) {
            showStatus(`${clean} is already in the list.`);
            return;
        }
        specificSites.push(clean);
        renderSitesList();
        showStatus(`Added ${clean} (Click Apply & Save)`);
    };

    /** Show or hide specific sites container */
    const toggleSpecificSitesVisibility = () => {
        const selected = document.querySelector('input[name="siteMode"]:checked');
        if (specificSitesSection) {
            specificSitesSection.hidden = selected?.value !== 'specific';
        }
    };

    /** Hex to RGB helper */
    const hexToRgb = (hex, fallback = [0, 0, 0]) => {
        if (!hex) return fallback;
        let str = hex.replace('#', '').trim();
        if (str.length === 3) str = str.split('').map(c => c + c).join('');
        if (str.length !== 6) return fallback;
        const num = parseInt(str, 16);
        if (isNaN(num)) return fallback;
        return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    };

    /**
     * Load an image into an HTMLImageElement asynchronously.
     * Uses extension fetch for external URLs so CORS never blocks canvas baking.
     */
    const loadImage = async (src) => {
        let objectUrl = null;
        try {
            if (/^https?:\/\//i.test(src)) {
                const resp = await fetch(src, { cache: 'force-cache' });
                if (resp.ok) {
                    const blob = await resp.blob();
                    objectUrl = URL.createObjectURL(blob);
                }
            }
        } catch (e) {
            // Fallback to direct image load below
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                resolve(img);
            };
            img.onerror = () => {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                reject(new Error('Failed to load image for baking'));
            };
            img.src = objectUrl || src;
        });
    };

    /**
     * Switch UI between Basic and Advanced mode.
     */
    const setUIMode = (mode, save = true) => {
        currentUIMode = mode === 'advanced' ? 'advanced' : 'basic';
        document.body.classList.toggle('mode-basic', currentUIMode === 'basic');
        document.body.classList.toggle('mode-advanced', currentUIMode === 'advanced');

        if (modeToggleText) {
            modeToggleText.textContent = currentUIMode === 'basic' ? 'Switch to Advanced Mode' : 'Switch to Basic Mode';
        }
        if (modeToggleIcon) {
            modeToggleIcon.innerHTML = currentUIMode === 'basic' ? SVG_ICON_ADVANCED : SVG_ICON_BASIC;
        }

        if (save) {
            chrome.storage.local.set({ uiMode: currentUIMode });
        }
    };

    /**
     * Highlight the currently active preset button if blur & dim match.
     */
    const updateActivePreset = (blur, dim) => {
        const b = parseInt(blur, 10);
        const d = parseFloat(dim);
        presetBtns.forEach(btn => {
            const btnBlur = parseInt(btn.dataset.blur, 10);
            const btnDim = parseFloat(btn.dataset.dim);
            const matches = (btnBlur === b && Math.abs(btnDim - d) < 0.03);
            btn.classList.toggle('active', matches);
        });
    };

    /**
     * Apply a preset directly.
     */
    const applyPreset = (blur, dim, presetName) => {
        blurSlider.value = blur;
        dimLevelInput.value = dim;
        updateUIValues();
        updateActivePreset(blur, dim);
        showStatus(`Preset set: ${presetName}`);
    };

    /**
     * Pre-bake blur and dim directly into an offscreen canvas.
     * No zooming or padding distortion: natural 1:1 image framing.
     */
    const bakeImageCanvas = (imgElement, blurPx, dimAlpha, rgbColor, maxWidth = 1920, maxHeight = 1080) => {
        const origW = imgElement.naturalWidth || imgElement.width || 1920;
        const origH = imgElement.naturalHeight || imgElement.height || 1080;

        const blur = Math.max(0, parseInt(blurPx, 10) || 0);
        const alpha = Math.max(0, Math.min(1, parseFloat(dimAlpha) || 0));

        let targetW = origW;
        let targetH = origH;
        if (targetW > maxWidth || targetH > maxHeight) {
            const ratio = Math.min(maxWidth / targetW, maxHeight / targetH);
            targetW = Math.max(1, Math.round(targetW * ratio));
            targetH = Math.max(1, Math.round(targetH * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
        if (!ctx) throw new Error('Canvas 2D context not available');

        const [r, g, b] = Array.isArray(rgbColor) ? rgbColor : [0, 0, 0];

        // Fill base with solid dim overlay color first
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(0, 0, targetW, targetH);

        // Draw blurred image directly without any zoom/crop padding
        if (alpha < 0.995) {
            ctx.save();
            ctx.globalAlpha = 1 - alpha;
            if (blur > 0) {
                ctx.filter = `blur(${blur}px)`;
            }
            ctx.drawImage(imgElement, 0, 0, targetW, targetH);
            ctx.filter = 'none';
            ctx.restore();
        }

        return canvas.toDataURL('image/jpeg', 0.85);
    };

    /**
     * Load settings from chrome.storage and populate UI.
     */
    const loadSettings = () => {
        const defaults = {
            isEnabled: true,
            uiMode: 'basic',
            extraTransparent: false,
            transparencyLevel: 1,
            siteMode: 'all',
            specificSites: [],
            animationsEnabled: false,
            autoTextColor: false,
            imageName: 'Built-in background',
            imageDataUrl: null,
            imageUrl: 'icons/background.png',
            dimLevel: 0.75,
            dimColor: 'auto',
            autoDarkColor: '#000000',
            autoLightColor: '#ffffff',
            customDimColor: '#000000',
            blurIntensity: 0,
            mediaType: 'image',
            bakedImage: null,
            bakedImageDark: null,
            bakedImageLight: null
        };

        chrome.storage.local.get(defaults, (settings) => {
            setUIMode(settings.uiMode || 'basic', false);

            enabledCheckbox.checked = settings.isEnabled;
            animationsCheckbox.checked = settings.animationsEnabled;
            autoTextColorCheckbox.checked = settings.autoTextColor;
            dimLevelInput.value = settings.dimLevel ?? 0.75;
            blurSlider.value = settings.blurIntensity ?? 0;
            imageUrlInput.value = settings.imageUrl && settings.imageUrl !== 'icons/background.png' ? settings.imageUrl : '';
            currentImageNameSpan.textContent = settings.imageName;

            if (transparencyLevelSelect) {
                transparencyLevelSelect.value = String(settings.transparencyLevel ?? (settings.extraTransparent === true ? 3 : 1));
            }

            const siteModeRadio = document.querySelector(`input[name="siteMode"][value="${settings.siteMode || 'all'}"]`);
            if (siteModeRadio) siteModeRadio.checked = true;

            specificSites = Array.isArray(settings.specificSites) ? settings.specificSites : [];
            renderSitesList();
            toggleSpecificSitesVisibility();

            // Normalize dimColor
            let normalizedDimColor = settings.dimColor;
            if (normalizedDimColor === 'black') normalizedDimColor = 'dark';
            else if (normalizedDimColor === 'white') normalizedDimColor = 'light';
            else if (normalizedDimColor === 'custom') normalizedDimColor = 'auto';
            if (!normalizedDimColor || !['auto', 'dark', 'light'].includes(normalizedDimColor)) normalizedDimColor = 'auto';

            const dimColorRadio = document.querySelector(`input[name="dimColor"][value="${normalizedDimColor}"]`);
            if (dimColorRadio) dimColorRadio.checked = true;

            if (customDimColorInput) {
                customDimColorInput.value = /^#[0-9a-f]{6}$/i.test(settings.customDimColor)
                    ? settings.customDimColor
                    : '#000000';
            }

            if (autoDarkColorInput) {
                autoDarkColorInput.value = /^#[0-9a-f]{6}$/i.test(settings.autoDarkColor)
                    ? settings.autoDarkColor
                    : '#000000';
            }
            if (autoLightColorInput) {
                autoLightColorInput.value = /^#[0-9a-f]{6}$/i.test(settings.autoLightColor)
                    ? settings.autoLightColor
                    : '#ffffff';
            }

            updateUIValues();
            updateActivePreset(settings.blurIntensity ?? 0, settings.dimLevel ?? 0.75);
            toggleCustomDimColorVisibility();
            toggleSettingsPanel();
            toggleAnimations();

            initialLoadedImageUrl = settings.imageUrl || '';
            initialLoadedImageDataUrl = settings.imageDataUrl || null;
            initialLoadedImageName = settings.imageName || 'Built-in background';
            initialLoadedMediaType = settings.mediaType || 'image';

            if (!settings.imageUrl && !settings.imageDataUrl) {
                chrome.storage.local.set({
                    imageUrl: 'icons/background.png',
                    imageDataUrl: null,
                    imageName: 'Built-in background'
                });
            }
        });
    };

    /**
     * Broadcast lightweight settings payload to all open tabs.
     */
    const broadcastSettings = (settingsPayload) => {
        try {
            const lightPayload = Object.assign({}, settingsPayload);
            const hasBaked = Boolean(lightPayload.bakedImage || lightPayload.bakedImageDark || lightPayload.bakedImageLight);
            if (hasBaked || lightPayload.mediaType === 'video') {
                delete lightPayload.imageDataUrl;
            }

            chrome.tabs.query({}, (tabs) => {
                if (chrome.runtime.lastError || !tabs) return;
                for (const tab of tabs) {
                    if (tab.id) {
                        chrome.tabs.sendMessage(tab.id, {
                            type: 'FORCE_APPLY_SETTINGS',
                            settings: lightPayload
                        }, () => {
                            if (chrome.runtime.lastError) { /* ignore non-content-script tabs */ }
                        });
                    }
                }
            });
        } catch (err) {
            console.warn('Tab broadcast warning:', err);
        }
    };

    /**
     * Save current UI settings to chrome.storage and broadcast to all tabs.
     */
    const saveSettings = async () => {
        const dimColorChecked = document.querySelector('input[name="dimColor"]:checked');

        if (!dimColorChecked) {
            showStatus('Error: UI options not selected.');
            return;
        }

        const siteModeChecked = document.querySelector('input[name="siteMode"]:checked');
        const chosenDimColor = dimColorChecked.value === 'custom' ? 'auto' : dimColorChecked.value;

        const settings = {
            isEnabled: enabledCheckbox.checked,
            uiMode: currentUIMode,
            transparencyLevel: transparencyLevelSelect ? Number(transparencyLevelSelect.value) : 1,
            extraTransparent: false,
            siteMode: siteModeChecked ? siteModeChecked.value : 'all',
            specificSites: [...specificSites],
            animationsEnabled: animationsCheckbox.checked,
            autoTextColor: autoTextColorCheckbox.checked,
            dimLevel: parseFloat(dimLevelInput.value),
            blurIntensity: parseInt(blurSlider.value, 10),
            dimColor: chosenDimColor,
            customDimColor: customDimColorInput ? customDimColorInput.value : '#000000',
            autoDarkColor: autoDarkColorInput ? autoDarkColorInput.value : '#000000',
            autoLightColor: autoLightColorInput ? autoLightColorInput.value : '#ffffff'
        };

        const trimmedUrl = imageUrlInput.value.trim();

        if (newImageData) {
            settings.imageDataUrl = newImageData.url;
            settings.imageName = newImageData.name;
            settings.imageUrl = '';
            settings.mediaType = newImageData.mediaType || 'image';
        } else if (stagedMediaUrl) {
            const isVideo = /\.mp4(\?|$)/i.test(stagedMediaUrl);
            const isGif = /\.gif(\?|$)/i.test(stagedMediaUrl);
            settings.imageUrl = stagedMediaUrl;
            settings.imageDataUrl = null;
            settings.imageName = 'From URL';
            settings.mediaType = isVideo ? 'video' : (isGif ? 'gif' : 'image');
        } else if (trimmedUrl && (trimmedUrl !== initialLoadedImageUrl || initialLoadedImageDataUrl)) {
            const isVideo = /\.mp4(\?|$)/i.test(trimmedUrl);
            const isGif = /\.gif(\?|$)/i.test(trimmedUrl);
            settings.imageUrl = trimmedUrl;
            settings.imageDataUrl = null;
            settings.imageName = 'From URL';
            settings.mediaType = isVideo ? 'video' : (isGif ? 'gif' : 'image');
        } else if (!trimmedUrl && initialLoadedImageUrl && !initialLoadedImageDataUrl) {
            settings.imageUrl = 'icons/background.png';
            settings.imageDataUrl = null;
            settings.imageName = 'Built-in background';
            settings.mediaType = 'image';
        } else {
            settings.imageUrl = initialLoadedImageUrl;
            settings.imageDataUrl = initialLoadedImageDataUrl;
            settings.imageName = initialLoadedImageName;
            settings.mediaType = initialLoadedMediaType;
        }

        // ================= FAST ZERO-LAG BAKING =================
        const candidateSrc = settings.imageDataUrl || settings.imageUrl || initialLoadedImageDataUrl || initialLoadedImageUrl || 'icons/background.png';
        const isAnimatedGif = settings.mediaType === 'gif' ||
            /\.gif(\?|$)/i.test(candidateSrc) ||
            candidateSrc.startsWith('data:image/gif');

        if (settings.mediaType !== 'video' && !isAnimatedGif) {
            const sourceForBake = candidateSrc === 'icons/background.png' ? chrome.runtime.getURL('icons/background.png') : candidateSrc;

            try {
                showStatus('<span class="spinner"></span> Optimizing wallpaper...', true);
                const img = await loadImage(sourceForBake);

                const darkRgb = hexToRgb(settings.autoDarkColor, [0, 0, 0]);
                const lightRgb = hexToRgb(settings.autoLightColor, [255, 255, 255]);

                if (settings.dimColor === 'auto') {
                    const bakedDark = bakeImageCanvas(img, settings.blurIntensity, settings.dimLevel, darkRgb);
                    const bakedLight = bakeImageCanvas(img, settings.blurIntensity, settings.dimLevel, lightRgb);
                    settings.bakedImageDark = bakedDark;
                    settings.bakedImageLight = bakedLight;
                    settings.bakedImage = null;
                } else {
                    const colorRgb = (settings.dimColor === 'light' || settings.dimColor === 'white')
                        ? lightRgb
                        : darkRgb;
                    settings.bakedImage = bakeImageCanvas(img, settings.blurIntensity, settings.dimLevel, colorRgb);
                    settings.bakedImageDark = null;
                    settings.bakedImageLight = null;
                }
            } catch (bakeErr) {
                console.warn('Canvas pre-rendering skipped, using lightweight dynamic fallback:', bakeErr);
                settings.bakedImage = null;
                settings.bakedImageDark = null;
                settings.bakedImageLight = null;
            }
        } else {
            settings.bakedImage = null;
            settings.bakedImageDark = null;
            settings.bakedImageLight = null;
        }

        // Save and broadcast once
        chrome.storage.local.set(settings, () => {
            showStatus('Settings Applied & Saved!');
            newImageData = null;
            stagedMediaUrl = null;

            if (settings.imageUrl !== undefined) initialLoadedImageUrl = settings.imageUrl;
            if (settings.imageDataUrl !== undefined) initialLoadedImageDataUrl = settings.imageDataUrl;
            if (settings.imageName !== undefined) {
                initialLoadedImageName = settings.imageName;
                currentImageNameSpan.textContent = settings.imageName;
                currentImageNameSpan.style.color = '';
                currentImageNameSpan.style.fontWeight = '';
            }
            if (settings.mediaType !== undefined) initialLoadedMediaType = settings.mediaType;

            broadcastSettings(settings);
        });
    };

    /**
     * Reset all settings to default values.
     */
    const resetDefaults = () => {
        newImageData = null;
        stagedMediaUrl = null;

        enabledCheckbox.checked = true;
        if (transparencyLevelSelect) transparencyLevelSelect.value = '1';
        if (animationsCheckbox) animationsCheckbox.checked = false;
        if (autoTextColorCheckbox) autoTextColorCheckbox.checked = false;

        const allSitesRadio = document.querySelector('input[name="siteMode"][value="all"]');
        if (allSitesRadio) allSitesRadio.checked = true;
        specificSites = [];
        renderSitesList();
        toggleSpecificSitesVisibility();

        imageUrlInput.value = '';
        currentImageNameSpan.textContent = 'Built-in background';
        currentImageNameSpan.style.color = '';
        currentImageNameSpan.style.fontWeight = '';

        // Default (Vivid & Clear): blur 0px and dim 75%
        blurSlider.value = 0;
        dimLevelInput.value = 0.75;

        const autoDimRadio = document.querySelector('input[name="dimColor"][value="auto"]');
        if (autoDimRadio) autoDimRadio.checked = true;
        if (autoDarkColorInput) autoDarkColorInput.value = '#000000';
        if (autoLightColorInput) autoLightColorInput.value = '#ffffff';
        if (customDimColorInput) customDimColorInput.value = '#000000';

        updateUIValues();
        updateActivePreset(blurSlider.value, dimLevelInput.value);
        toggleCustomDimColorVisibility();
        toggleSettingsPanel();
        toggleAnimations();

        saveSettings();
        showStatus('Reset to defaults and applied!');
    };

    /**
     * Stage URL image/video (without applying immediately to webpages).
     */
    const applyImageUrl = () => {
        const url = imageUrlInput.value.trim();
        if (!url) {
            showStatus('Please enter a valid URL.');
            return;
        }

        const isVideoUrl = /\.mp4(\?|$)/i.test(url);
        stagedMediaUrl = url;
        newImageData = null;

        currentImageNameSpan.textContent = isVideoUrl ? 'Selected: Video URL' : 'Selected: Image URL';
        currentImageNameSpan.style.color = 'var(--primary-color)';
        currentImageNameSpan.style.fontWeight = 'bold';
        showStatus('URL staged! Click "Apply & Save" to apply.');
    };

    /**
     * Show status message temporarily.
     */
    const showStatus = (message, isHtml = false) => {
        if (isHtml) {
            statusDiv.innerHTML = message;
        } else {
            statusDiv.textContent = message;
        }
        if (message) {
            setTimeout(() => { statusDiv.textContent = ''; }, 2200);
        }
    };

    /**
     * Update UI value displays.
     */
    const updateUIValues = () => {
        dimValueSpan.textContent = `${Math.round(dimLevelInput.value * 100)}%`;
        blurValueSpan.textContent = `${blurSlider.value}px`;
        if (customDimColorValue && customDimColorInput) {
            customDimColorValue.textContent = customDimColorInput.value.toUpperCase();
        }
        if (autoDarkColorValue && autoDarkColorInput) {
            autoDarkColorValue.textContent = autoDarkColorInput.value.toUpperCase();
        }
        if (autoLightColorValue && autoLightColorInput) {
            autoLightColorValue.textContent = autoLightColorInput.value.toUpperCase();
        }
        updateActivePreset(blurSlider.value, dimLevelInput.value);
    };

    /** Show color pickers section */
    const toggleCustomDimColorVisibility = () => {
        if (autoDimColorSection) autoDimColorSection.hidden = false;
        if (customDimColorSection) customDimColorSection.hidden = true;
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
        const isEnabled = animationsCheckbox ? animationsCheckbox.checked : false;
        document.body.classList.toggle('animations-enabled', isEnabled);
        const container = document.querySelector('.container');
        if (container) {
            if (isEnabled) {
                container.classList.remove('popup-animate-in');
                void container.offsetWidth;
                container.classList.add('popup-animate-in');
            } else {
                container.classList.remove('popup-animate-in');
            }
        }
    };

    /**
     * Estimate video frame rate (FPS).
     */
    const estimateVideoFPS = (file, callback) => {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;

        const url = URL.createObjectURL(file);
        video.src = url;

        video.play().then(() => {
            let frames = 0;
            let startMediaTime = null;
            let lastMediaTime = null;
            let startRealTime = performance.now();
            let timeoutId = null;

            const checkFrame = (now, metadata) => {
                if (startMediaTime === null) {
                    startMediaTime = metadata.mediaTime;
                }
                lastMediaTime = metadata.mediaTime;
                frames++;

                const elapsedRealTime = performance.now() - startRealTime;
                if (frames >= 15 || elapsedRealTime > 400) {
                    video.pause();
                    const mediaDuration = lastMediaTime - startMediaTime;
                    let fps = 0;
                    if (mediaDuration > 0 && frames > 1) {
                        fps = (frames - 1) / mediaDuration;
                    }
                    cleanup();
                    callback(fps);
                    return;
                }

                video.requestVideoFrameCallback(checkFrame);
            };

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                video.pause();
                video.src = '';
                video.load();
                URL.revokeObjectURL(url);
            };

            timeoutId = setTimeout(() => {
                cleanup();
                callback(0);
            }, 2000);

            if ('requestVideoFrameCallback' in video) {
                video.requestVideoFrameCallback(checkFrame);
            } else {
                setTimeout(() => {
                    let fps = 0;
                    if (video.getVideoPlaybackQuality) {
                        const q = video.getVideoPlaybackQuality();
                        const totalFrames = q.totalVideoFrames;
                        if (totalFrames > 0) {
                            fps = totalFrames / (video.currentTime || 0.5);
                        }
                    }
                    cleanup();
                    callback(fps);
                }, 400);
            }
        }).catch(err => {
            console.error('Error playing video for FPS estimation:', err);
            URL.revokeObjectURL(url);
            callback(0);
        });
    };

    /**
     * Handle image/video upload with auto-optimization to 1080p JPEG (preserving animated GIFs).
     */
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const WARN_SIZE = 20 * 1024 * 1024;
        const MAX_SIZE = 100 * 1024 * 1024;

        if (file.size > MAX_SIZE) {
            showStatus('File too large! Max limit is 100 MB.');
            e.target.value = '';
            return;
        }

        if (file.size > WARN_SIZE) {
            const proceed = window.confirm('This file is larger than 20 MB and may cause lag. Do you want to continue?');
            if (!proceed) {
                showStatus('Upload cancelled.');
                e.target.value = '';
                return;
            }
        }

        const isVideo = file.type.startsWith('video/');
        const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);

        const processFile = () => {
            const reader = new FileReader();
            reader.onload = (event) => {
                if (isVideo) {
                    newImageData = { url: event.target.result, name: file.name, mediaType: 'video' };
                    stagedMediaUrl = null;
                    currentImageNameSpan.textContent = `New: ${file.name}`;
                    currentImageNameSpan.style.color = 'var(--primary-color)';
                    currentImageNameSpan.style.fontWeight = 'bold';
                    showStatus('Video loaded! Click "Apply & Save" to apply.');
                } else if (isGif) {
                    newImageData = { url: event.target.result, name: file.name, mediaType: 'gif' };
                    stagedMediaUrl = null;
                    currentImageNameSpan.textContent = `New: ${file.name}`;
                    currentImageNameSpan.style.color = 'var(--primary-color)';
                    currentImageNameSpan.style.fontWeight = 'bold';
                    showStatus('GIF loaded! Click "Apply & Save" to apply.');
                } else {
                    const tempImg = new Image();
                    tempImg.onload = () => {
                        try {
                            let w = tempImg.naturalWidth || tempImg.width || 1920;
                            let h = tempImg.naturalHeight || tempImg.height || 1080;
                            const maxW = 1920, maxH = 1080;
                            if (w > maxW || h > maxH) {
                                const ratio = Math.min(maxW / w, maxH / h);
                                w = Math.max(1, Math.round(w * ratio));
                                h = Math.max(1, Math.round(h * ratio));
                            }
                            const canvas = document.createElement('canvas');
                            canvas.width = w;
                            canvas.height = h;
                            const ctx = canvas.getContext('2d', { alpha: false });
                            ctx.drawImage(tempImg, 0, 0, w, h);
                            const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.88);

                            newImageData = { url: optimizedDataUrl, name: file.name, mediaType: 'image' };
                            stagedMediaUrl = null;
                            currentImageNameSpan.textContent = `New: ${file.name}`;
                            currentImageNameSpan.style.color = 'var(--primary-color)';
                            currentImageNameSpan.style.fontWeight = 'bold';
                            showStatus('Image optimized! Click "Apply & Save" to apply.');
                        } catch (err) {
                            newImageData = { url: event.target.result, name: file.name, mediaType: 'image' };
                            stagedMediaUrl = null;
                            currentImageNameSpan.textContent = `New: ${file.name}`;
                            currentImageNameSpan.style.color = 'var(--primary-color)';
                            currentImageNameSpan.style.fontWeight = 'bold';
                            showStatus('File loaded! Click "Apply & Save" to apply.');
                        }
                    };
                    tempImg.onerror = () => {
                        newImageData = { url: event.target.result, name: file.name, mediaType: 'image' };
                        stagedMediaUrl = null;
                        currentImageNameSpan.textContent = `New: ${file.name}`;
                        currentImageNameSpan.style.color = 'var(--primary-color)';
                        currentImageNameSpan.style.fontWeight = 'bold';
                        showStatus('File loaded! Click "Apply & Save" to apply.');
                    };
                    tempImg.src = event.target.result;
                }
            };
            reader.onerror = () => {
                showStatus('Failed to read file.');
            };
            reader.readAsDataURL(file);
        };

        if (isVideo) {
            showStatus('<span class="spinner"></span> Analyzing video frame rate...', true);
            estimateVideoFPS(file, (fps) => {
                if (fps > 25) {
                    const proceed = confirm(`Please ensure the video frame rate is under 25 fps to reduce lag.\n(Detected: ${fps.toFixed(1)} fps)\n\nDo you want to continue?`);
                    if (!proceed) {
                        showStatus('Upload cancelled.');
                        e.target.value = '';
                        return;
                    }
                }
                showStatus('<span class="spinner"></span> Loading...', true);
                processFile();
            });
        } else {
            showStatus('<span class="spinner"></span> Loading...', true);
            processFile();
        }
    };

    // --- Event Listeners ---
    enabledCheckbox.addEventListener('change', toggleSettingsPanel);
    animationsCheckbox.addEventListener('change', toggleAnimations);
    uploadButton.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', handleImageUpload);
    applyUrlButton.addEventListener('click', applyImageUrl);
    imageUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyImageUrl();
        }
    });
    dimLevelInput.addEventListener('input', updateUIValues);
    blurSlider.addEventListener('input', updateUIValues);
    if (customDimColorInput) customDimColorInput.addEventListener('input', updateUIValues);
    if (autoDarkColorInput) autoDarkColorInput.addEventListener('input', updateUIValues);
    if (autoLightColorInput) autoLightColorInput.addEventListener('input', updateUIValues);

    document.querySelectorAll('input[name="dimColor"]').forEach(radio => {
        radio.addEventListener('change', toggleCustomDimColorVisibility);
    });
    document.querySelectorAll('input[name="siteMode"]').forEach(radio => {
        radio.addEventListener('change', toggleSpecificSitesVisibility);
    });

    // Preset button events:
    // 1. Default (Eye-Care): Blur 5px, Dim 75%
    // 2. Vivid & Clear: Blur 0px, Dim 75%
    // 3. Deep Focus: Blur 25px, Dim 50%
    presetClearBtn?.addEventListener('click', () => applyPreset(0, 0.75, 'Default (Vivid & Clear)'));
    presetDefaultBtn?.addEventListener('click', () => applyPreset(5, 0.75, 'Eye-Care'));
    presetFocusBtn?.addEventListener('click', () => applyPreset(25, 0.50, 'Deep Focus'));

    // Mode toggle and Reset events
    modeToggleButton?.addEventListener('click', () => {
        setUIMode(currentUIMode === 'basic' ? 'advanced' : 'basic');
    });
    resetButton?.addEventListener('click', resetDefaults);

    if (addSiteButton && newSiteInput) {
        addSiteButton.addEventListener('click', () => {
            addSite(newSiteInput.value);
            newSiteInput.value = '';
        });
        newSiteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addSiteButton.click();
            }
        });
    }

    if (addCurrentSiteButton) {
        addCurrentSiteButton.addEventListener('click', () => {
            try {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs && tabs[0] && tabs[0].url) {
                        try {
                            const parsed = new URL(tabs[0].url);
                            if (parsed.protocol.startsWith('http')) {
                                addSite(parsed.hostname);
                            } else {
                                showStatus('Current tab is not a regular web page.');
                            }
                        } catch (e) {
                            showStatus('Could not read current URL.');
                        }
                    } else {
                        showStatus('No active tab detected.');
                    }
                });
            } catch (err) {
                console.error(err);
                showStatus('Failed to get active tab.');
            }
        });
    }

    saveButton.addEventListener('click', saveSettings);
    helpButton.addEventListener('click', openGuide);

    // Initialize on load
    loadSettings();
});
