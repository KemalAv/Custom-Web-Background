document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const enabledCheckbox = document.getElementById('enabledCheckbox');
    const animationsCheckbox = document.getElementById('animationsCheckbox');
    const autoTextColorCheckbox = document.getElementById('autoTextColorCheckbox');
    const settingsPanel = document.getElementById('settings-panel');
    const extraTransparentCheckbox = document.getElementById('extraTransparentCheckbox');
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
    const blurSlider = document.getElementById('blurSlider');
    const blurValueSpan = document.getElementById('blurValue');
    const saveButton = document.getElementById('saveButton');
    const statusDiv = document.getElementById('status');
    const helpButton = document.getElementById('helpButton');

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


    /**
     * Load settings from chrome.storage and populate UI.
     */
    const loadSettings = () => {
        const defaults = {
            isEnabled: true,
            extraTransparent: false,
            siteMode: 'all',
            specificSites: [],
            animationsEnabled: false,
            autoTextColor: false,
            imageName: 'Built-in background',
            imageDataUrl: null,
            imageUrl: 'icons/background.png',
            dimLevel: 0.5,
            dimColor: 'auto',
            customDimColor: '#000000',
            blurIntensity: 0,
            mediaType: 'image'
        };

        chrome.storage.local.get(defaults, (settings) => {
            enabledCheckbox.checked = settings.isEnabled;
            animationsCheckbox.checked = settings.animationsEnabled;
            autoTextColorCheckbox.checked = settings.autoTextColor;
            dimLevelInput.value = settings.dimLevel;
            blurSlider.value = settings.blurIntensity;
            imageUrlInput.value = settings.imageUrl || '';
            currentImageNameSpan.textContent = settings.imageName;

            if (extraTransparentCheckbox) {
                extraTransparentCheckbox.checked = settings.extraTransparent === true;
            }

            const siteModeRadio = document.querySelector(`input[name="siteMode"][value="${settings.siteMode || 'all'}"]`);
            if (siteModeRadio) siteModeRadio.checked = true;

            specificSites = Array.isArray(settings.specificSites) ? settings.specificSites : [];
            renderSitesList();
            toggleSpecificSitesVisibility();

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

            initialLoadedImageUrl = settings.imageUrl || '';
            initialLoadedImageDataUrl = settings.imageDataUrl || null;
            initialLoadedImageName = settings.imageName || 'Built-in background';
            initialLoadedMediaType = settings.mediaType || 'image';

            // Set default URL only once if uninitialized
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
     * Save current UI settings to chrome.storage and broadcast to all tabs.
     */
    const saveSettings = () => {
        const dimColorChecked = document.querySelector('input[name="dimColor"]:checked');

        if (!dimColorChecked) {
            showStatus('Error: UI options not selected.');
            return;
        }

        const siteModeChecked = document.querySelector('input[name="siteMode"]:checked');

        const settings = {
            isEnabled: enabledCheckbox.checked,
            extraTransparent: extraTransparentCheckbox ? extraTransparentCheckbox.checked : false,
            siteMode: siteModeChecked ? siteModeChecked.value : 'all',
            specificSites: [...specificSites],
            animationsEnabled: animationsCheckbox.checked,
            autoTextColor: autoTextColorCheckbox.checked,
            dimLevel: parseFloat(dimLevelInput.value),
            blurIntensity: parseInt(blurSlider.value, 10),
            dimColor: dimColorChecked.value,
            customDimColor: customDimColorInput.value
        };

        const trimmedUrl = imageUrlInput.value.trim();

        if (newImageData) {
            settings.imageDataUrl = newImageData.url;
            settings.imageName = newImageData.name;
            settings.imageUrl = ''; // clear URL if uploading a file
            settings.mediaType = newImageData.mediaType || 'image';
        } else if (stagedMediaUrl) {
            const isVideo = /\.mp4(\?|$)/i.test(stagedMediaUrl);
            settings.imageUrl = stagedMediaUrl;
            settings.imageDataUrl = null;
            settings.imageName = 'From URL';
            settings.mediaType = isVideo ? 'video' : 'image';
        } else if (trimmedUrl && (trimmedUrl !== initialLoadedImageUrl || initialLoadedImageDataUrl)) {
            const isVideo = /\.mp4(\?|$)/i.test(trimmedUrl);
            settings.imageUrl = trimmedUrl;
            settings.imageDataUrl = null;
            settings.imageName = 'From URL';
            settings.mediaType = isVideo ? 'video' : 'image';
        } else if (!trimmedUrl && initialLoadedImageUrl && !initialLoadedImageDataUrl) {
            settings.imageUrl = 'icons/background.png';
            settings.imageDataUrl = null;
            settings.imageName = 'Built-in background';
            settings.mediaType = 'image';
        }

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

            // Broadcast directly to all open tabs so effects apply immediately
            try {
                chrome.tabs.query({}, (tabs) => {
                    if (chrome.runtime.lastError || !tabs) return;
                    for (const tab of tabs) {
                        if (tab.id) {
                            chrome.tabs.sendMessage(tab.id, {
                                type: 'FORCE_APPLY_SETTINGS',
                                settings: settings
                            }, () => {
                                if (chrome.runtime.lastError) { /* ignore non-content-script tabs */ }
                            });
                        }
                    }
                });
            } catch (err) {
                console.warn('Tab broadcast warning:', err);
            }
        });
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
        newImageData = null; // Staging URL overrides staged file upload

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
     * Toggle UI animations class on body and trigger smooth entrance motion.
     */
    const toggleAnimations = () => {
        const isEnabled = animationsCheckbox ? animationsCheckbox.checked : false;
        document.body.classList.toggle('animations-enabled', isEnabled);
        const container = document.querySelector('.container');
        if (container) {
            if (isEnabled) {
                container.classList.remove('popup-animate-in');
                void container.offsetWidth; // Force reflow to replay fluid entrance
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
                stagedMediaUrl = null; // Staged file overrides staged URL
                currentImageNameSpan.textContent = `New: ${file.name}`;
                currentImageNameSpan.style.color = 'var(--primary-color)';
                currentImageNameSpan.style.fontWeight = 'bold';
                showStatus('File loaded! Click "Apply & Save" to apply.');
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
    uploadButton.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', handleImageUpload);
    applyUrlButton.addEventListener('click', applyImageUrl);
    dimLevelInput.addEventListener('input', updateUIValues);
    blurSlider.addEventListener('input', updateUIValues);
    customDimColorInput.addEventListener('input', updateUIValues);
    document.querySelectorAll('input[name="dimColor"]').forEach(radio => {
        radio.addEventListener('change', toggleCustomDimColorVisibility);
    });
    document.querySelectorAll('input[name="siteMode"]').forEach(radio => {
        radio.addEventListener('change', toggleSpecificSitesVisibility);
    });


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
