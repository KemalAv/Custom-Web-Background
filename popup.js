document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const enabledCheckbox = document.getElementById('enabledCheckbox');
    const animationsCheckbox = document.getElementById('animationsCheckbox');
    const protectModalsCheckbox = document.getElementById('protectModalsCheckbox');
    const autoTextColorCheckbox = document.getElementById('autoTextColorCheckbox');
    const ignoreElementBgCheckbox = document.getElementById('ignoreElementBgCheckbox');
    const ignoreElementBgSection = document.getElementById('ignoreElementBgSection');
    const protectModalsSection = document.getElementById('protectModalsSection');
    const settingsPanel = document.getElementById('settings-panel');
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
    const blurSlider = document.getElementById('blurSlider');
    const blurValueSpan = document.getElementById('blurValue');
    const saveButton = document.getElementById('saveButton');
    const statusDiv = document.getElementById('status');
    const helpButton = document.getElementById('helpButton');

    let newImageData = null;

    /** Open the full guide page in a new browser tab. */
    const openGuide = () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    };


    /**
     * Load settings from chrome.storage and populate UI.
     */
    const loadSettings = () => {
        const defaults = {
            isEnabled: true,
            animationsEnabled: false,
            protectModals: false,
            autoTextColor: false,
            ignoreElementBg: false,
            uiMode: 'chroma',
            imageName: 'Using default image.',
            imageDataUrl: null,
            imageUrl: 'https://images2.alphacoders.com/137/1375140.png',
            dimLevel: 0.4,
            dimColor: 'black',
            customDimColor: '#000000',
            blurIntensity: 0,
            mediaType: 'image'
        };

        chrome.storage.local.get(defaults, (settings) => {
            enabledCheckbox.checked = settings.isEnabled;
            animationsCheckbox.checked = settings.animationsEnabled;
            protectModalsCheckbox.checked = settings.protectModals;
            autoTextColorCheckbox.checked = settings.autoTextColor;
            ignoreElementBgCheckbox.checked = settings.ignoreElementBg;
            dimLevelInput.value = settings.dimLevel;
            blurSlider.value = settings.blurIntensity;
            imageUrlInput.value = settings.imageUrl || '';
            currentImageNameSpan.textContent = settings.imageName;

            // Set UI Mode radio button
            const uiModeRadio = document.querySelector(`input[name="uiMode"][value="${settings.uiMode}"]`);
            if (uiModeRadio) uiModeRadio.checked = true;

            // Migrate the old dark/light values without breaking existing users.
            const normalizedDimColor = settings.dimColor === 'dark'
                ? 'black'
                : settings.dimColor === 'light' ? 'white' : settings.dimColor;
            const dimColorRadio = document.querySelector(`input[name="dimColor"][value="${normalizedDimColor}"]`);
            if (dimColorRadio) dimColorRadio.checked = true;
            customDimColorInput.value = /^#[0-9a-f]{6}$/i.test(settings.customDimColor)
                ? settings.customDimColor
                : '#000000';

            updateUIValues();
            toggleCustomDimColorVisibility();
            toggleSettingsPanel();
            toggleAnimations();
            toggleProtectModalsVisibility();
            toggleIgnoreElementBgVisibility();

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
        const uiModeChecked = document.querySelector('input[name="uiMode"]:checked');
        const dimColorChecked = document.querySelector('input[name="dimColor"]:checked');

        if (!uiModeChecked || !dimColorChecked) {
            showStatus('Error: UI options not selected.');
            return;
        }

        const settings = {
            isEnabled: enabledCheckbox.checked,
            animationsEnabled: animationsCheckbox.checked,
            protectModals: protectModalsCheckbox.checked,
            autoTextColor: autoTextColorCheckbox.checked,
            ignoreElementBg: ignoreElementBgCheckbox.checked,
            uiMode: uiModeChecked.value,
            dimLevel: parseFloat(dimLevelInput.value),
            blurIntensity: parseInt(blurSlider.value, 10),
            dimColor: dimColorChecked.value,
            customDimColor: customDimColorInput.value
        };

        if (newImageData) {
            settings.imageDataUrl = newImageData.url;
            settings.imageName = newImageData.name;
            settings.imageUrl = ''; // clear URL if uploading a file
            settings.mediaType = newImageData.mediaType || 'image';
        }
        // Note: imageUrl/imageName/mediaType are preserved in storage when no new file is uploaded

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

        // Detect if URL is a video
        const isVideoUrl = /\.mp4(\?|$)/i.test(url);

        // We save the URL separately so it can be applied without hitting the main "Save"
        chrome.storage.local.set({
            imageUrl: url,
            imageDataUrl: null, // Clear file upload
            imageName: 'From URL',
            mediaType: isVideoUrl ? 'video' : 'image'
        }, () => {
            currentImageNameSpan.textContent = 'From URL';
            currentImageNameSpan.style.color = 'var(--primary-color)';
            currentImageNameSpan.style.fontWeight = 'bold';
            showStatus(isVideoUrl ? 'Video URL applied!' : 'Image URL applied!');
        });
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
            setTimeout(() => { statusDiv.textContent = ''; }, 2000);
        }
    };

    /**
     * Update UI value displays.
     */
    const updateUIValues = () => {
        dimValueSpan.textContent = `${Math.round(dimLevelInput.value * 100)}%`;
        blurValueSpan.textContent = `${blurSlider.value}px`;
        customDimColorValue.textContent = customDimColorInput.value.toUpperCase();
    };

    /** Show the color picker only when Custom is selected. */
    const toggleCustomDimColorVisibility = () => {
        const selected = document.querySelector('input[name="dimColor"]:checked');
        customDimColorSection.hidden = selected?.value !== 'custom';
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
     * Toggle Ignore Element Background sub-option visibility based on Auto Text Color.
     */
    const toggleIgnoreElementBgVisibility = () => {
        ignoreElementBgSection.style.display = autoTextColorCheckbox.checked ? 'block' : 'none';
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
                    // Need at least 2 frames to compute a meaningful interval
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
                // Fallback: estimate from duration / check frame count or video playback qualities if possible
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

        const isVideo = file.type.startsWith('video/');

        const processFile = () => {
            const reader = new FileReader();
            reader.onload = (event) => {
                newImageData = { url: event.target.result, name: file.name, mediaType: isVideo ? 'video' : 'image' };
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

        if (isVideo) {
            // Show scanning status
            showStatus('<span class="spinner"></span> Analyzing video frame rate...', true);
            estimateVideoFPS(file, (fps) => {
                if (fps > 25) {
                    const proceed = confirm(`Please ensure the video frame rate is under 25 fps to reduce lag.\n(Detected: ${fps.toFixed(1)} fps)\n\nDo you want to continue?`);
                    if (!proceed) {
                        showStatus('Upload cancelled.');
                        e.target.value = ''; // Clear the input
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
    autoTextColorCheckbox.addEventListener('change', toggleIgnoreElementBgVisibility);
    uploadButton.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', handleImageUpload);
    applyUrlButton.addEventListener('click', applyImageUrl);
    dimLevelInput.addEventListener('input', updateUIValues);
    blurSlider.addEventListener('input', updateUIValues);
    customDimColorInput.addEventListener('input', updateUIValues);
    document.querySelectorAll('input[name="dimColor"]').forEach(radio => {
        radio.addEventListener('change', toggleCustomDimColorVisibility);
    });
    document.querySelectorAll('input[name="uiMode"]').forEach(radio => {
        radio.addEventListener('change', toggleProtectModalsVisibility);
    });
    saveButton.addEventListener('click', saveSettings);
    helpButton.addEventListener('click', openGuide);

    // Initialize on load
    loadSettings();
});
