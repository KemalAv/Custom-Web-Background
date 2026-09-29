(() => {
    const BG_CONTAINER_ID = 'universal-bg-container';
    const STYLE_TAG_ID = 'universal-bg-styles';
    const GLASS_STYLE_ID = 'glass-style';
    const SAFE_ATTR = 'data-wallpaper-protected';
    const isTopFrame = window.self === window.top;

    let currentSettings = {};
    let bgContainer, bgImage, bgVideo, bgOverlay, styleTag;
    let mutationObserver = null;
    let pendingHeavyLoad = false;
    let pendingLoadTimer = null;
    let lastLoadedSrc = '';
    let lastRequestedSrc = '';
    let lastRequestedType = '';
    let lastLoadedName = '';
    let lastLoadedLength = 0;
    let pageSpinner = null;
    let loadSessionId = 0;
    let currentBlobUrl = null;
    let lastRouteUrl = location.href;
    const originalTextColors = new WeakMap();

    function setTextColor(el, color) {
        if (!originalTextColors.has(el)) {
            originalTextColors.set(el, {
                value: el.style.getPropertyValue('color'),
                priority: el.style.getPropertyPriority('color')
            });
        }
        el.style.setProperty('color', color, 'important');
        el.setAttribute('data-glass-color', color);
    }

    function restoreTextColor(el) {
        const original = originalTextColors.get(el);
        if (original) {
            if (original.value) el.style.setProperty('color', original.value, original.priority);
            else el.style.removeProperty('color');
            originalTextColors.delete(el);
        }
        el.removeAttribute('data-glass-color');
    }

    /** ==================== HELPERS ==================== */
    function fetchSettings(callback) {
        try {
            if (!chrome?.runtime?.id) return;
            chrome.storage.local.get(null, (settings) => {
                currentSettings = settings || {};
                currentSettings.isEnabled = currentSettings.isEnabled ?? true;
                currentSettings.autoTextColor = currentSettings.autoTextColor ?? false;
                currentSettings.animationsEnabled = currentSettings.animationsEnabled ?? false;
                currentSettings.mediaType = currentSettings.mediaType || 'image';
                callback?.();
            });
        } catch (e) { console.error(e); }
    }

    function dataUrlToBlobUrl(dataUrl) {
        if (!dataUrl.startsWith('data:')) return dataUrl;
        try {
            const arr = dataUrl.split(',');
            const mimeMatch = arr[0].match(/:(.*?);/);
            if (!mimeMatch) return dataUrl;
            const mime = mimeMatch[1];

            // for very large strings over ~10-15mb, atob causes out-of-memory or callstack limits
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
                u8arr[n] = bstr.charCodeAt(n);
            }
            return URL.createObjectURL(new Blob([u8arr], { type: mime }));
        } catch (e) {
            console.error("Blob conversion failed:", e);
            return dataUrl;
        }
    }

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function getDimColorRgb() {
        const dimColor = currentSettings.dimColor || 'auto';
        if (dimColor === 'auto') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? [0, 0, 0] : [255, 255, 255];
        }
        if (dimColor === 'white' || dimColor === 'light') return [255, 255, 255];
        if (dimColor === 'custom') {
            const match = /^#([0-9a-f]{6})$/i.exec(currentSettings.customDimColor || '');
            if (match) {
                return [
                    parseInt(match[1].slice(0, 2), 16),
                    parseInt(match[1].slice(2, 4), 16),
                    parseInt(match[1].slice(4, 6), 16)
                ];
            }
        }
        return [0, 0, 0];
    }

    function getDimColorCss(alpha) {
        const [r, g, b] = getDimColorRgb();
        return typeof alpha === 'number' ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
    }

    function isDimColorDark() {
        const [r, g, b] = getDimColorRgb();
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
    }

    function initContainer() {
        if (!bgContainer) {
            bgContainer = document.createElement('div');
            bgContainer.id = BG_CONTAINER_ID;
            Object.assign(bgContainer.style, {
                position: 'fixed', top: 0, left: 0,
                width: '100vw', height: '100vh',
                zIndex: '-1', pointerEvents: 'none',
                overflow: 'hidden', opacity: 0,
                transition: 'none',
            });

            bgImage = document.createElement('img');
            Object.assign(bgImage.style, {
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover', opacity: 0,
                transition: 'none',
            });

            bgVideo = document.createElement('iframe');
            Object.assign(bgVideo.style, {
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                opacity: 0,
                transition: 'none',
                border: 'none',
                pointerEvents: 'none',
                background: 'transparent',
            });
            bgVideo.allow = 'autoplay';
            bgVideo.setAttribute('allowtransparency', 'true');

            bgOverlay = document.createElement('div');
            Object.assign(bgOverlay.style, {
                position: 'absolute', inset: 0,
                opacity: 0, transition: 'none',
            });

            bgContainer.append(bgImage, bgVideo, bgOverlay);
        }

        if (!document.documentElement.contains(bgContainer)) {
            document.documentElement.prepend(bgContainer);
        }

        if (!pageSpinner) {
            pageSpinner = document.createElement('div');
            pageSpinner.className = 'universal-spinner';
        }
        if (!document.documentElement.contains(pageSpinner)) {
            document.documentElement.appendChild(pageSpinner);
        }
    }

    function initStyleTags() {
        styleTag = document.getElementById(STYLE_TAG_ID);
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = STYLE_TAG_ID;
            document.head.appendChild(styleTag);
        } else if (!document.head.contains(styleTag)) {
            document.head.appendChild(styleTag);
        }

        let glassTag = document.getElementById(GLASS_STYLE_ID);
        if (!glassTag) {
            glassTag = document.createElement('style');
            glassTag.id = GLASS_STYLE_ID;
            document.head.appendChild(glassTag);
        } else if (!document.head.contains(glassTag)) {
            document.head.appendChild(glassTag);
        }

        let spinnerStyles = document.getElementById('bg-spinner-styles');
        if (!spinnerStyles) {
            spinnerStyles = document.createElement('style');
            spinnerStyles.id = 'bg-spinner-styles';
            spinnerStyles.textContent = `
                .universal-spinner {
                    position: fixed; top: 20px; right: 20px; width: 24px; height: 24px;
                    border: 3px solid rgba(0,0,0,0.1); border-radius: 50%;
                    border-top-color: #007bff; animation: bg-spin 1s linear infinite;
                    z-index: 2147483647; pointer-events: none; opacity: 0; transition: opacity 0.2s;
                }
                .universal-spinner.visible { opacity: 1; }
                @keyframes bg-spin { to { transform: rotate(360deg); } }
            `;
            document.head.appendChild(spinnerStyles);
        } else if (!document.head.contains(spinnerStyles)) {
            document.head.appendChild(spinnerStyles);
        }
    }

    function resetEffects(clearMedia = true) {
        styleTag.textContent = '';
        const glassTag = document.getElementById(GLASS_STYLE_ID);
        if (glassTag) glassTag.textContent = '';
        if (bgContainer) {
            if (clearMedia) {
                bgContainer.style.opacity = '0';
                if (bgImage) { bgImage.src = ''; bgImage.style.opacity = '0'; }
                if (bgVideo) { bgVideo.removeAttribute('src'); bgVideo.style.opacity = '0'; }
                lastLoadedSrc = '';
                lastRequestedSrc = '';
                lastRequestedType = '';
                lastLoadedName = '';
                lastLoadedLength = 0;
                if (currentBlobUrl) {
                    URL.revokeObjectURL(currentBlobUrl);
                    currentBlobUrl = null;
                }
            }
        }
        if (pageSpinner) pageSpinner.classList.remove('visible');
        document.querySelectorAll('*').forEach(el => {
            el.removeAttribute('data-bg-color');
            el.removeAttribute(SAFE_ATTR);
            el.removeAttribute(SURFACE_ATTR);
            if (el.hasAttribute('data-glass-color')) {
                restoreTextColor(el);
            }
        });
    }

    /** Surfaces that can display the glass effect. */
    const SURFACE_ATTR = 'data-wallpaper-surface';
    const CONTROL_SELECTOR = [
        'button', 'input', 'select', 'textarea', 'option', 'label', 'summary',
        'a', 'video', 'audio', 'img', 'svg', 'canvas', 'iframe', 'picture',
        '[contenteditable]:not([contenteditable="false"])', '[onclick]',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="checkbox"]',
        '[role="switch"]', '[role="textbox"]', '[role="combobox"]',
        '[role="menuitem"]', '[role="option"]', '[role="slider"]',
        '[role="progressbar"]', '[role="img"]'
    ].join(',');
    const MODAL_SELECTOR = [
        'dialog', '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]',
        '[role="listbox"]', '[role="tooltip"]', '[role="popover"]',
        '[aria-modal="true"]', '.modal', '.popup', '.dropdown', '.popover',
        '.toast', '.notification', '[data-radix-portal]', '[data-headlessui-portal]',
        '[data-tippy-root]', '[data-popover]', '[data-modal]'
    ].join(',');

    function isProtectedSurface(el) {
        if (el.closest('#' + BG_CONTAINER_ID) || el.closest('.universal-spinner')) return true;
        if (el.closest(`[${SAFE_ATTR}]`)) return true;
        if (el.matches(CONTROL_SELECTOR) || el.closest(CONTROL_SELECTOR)) return true;
        if (el.matches(MODAL_SELECTOR) || el.closest(MODAL_SELECTOR)) return true;
        if (el.matches('form, [role="search"]') ||
            el.closest('form, [role="search"]')) return true;
        return false;
    }

    function isNavigationSurface(el) {
        const name = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
        return el.matches('header, nav, [role="banner"], [role="navigation"], ytd-masthead, ytd-guide-renderer') ||
            /(?:^|[\s_-])(appheader|masthead|header|navbar|navigation|topbar|sidebar|guide)(?:[\s_-]|$)/.test(name);
    }

    function isForegroundLayer(el, css, rect) {
        if (el === document.body || el === document.documentElement) return false;
        const name = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
        if (/(?:^|[\s_-])(composer|modal|dialog|popover|dropdown|tooltip|toast|portal|drawer)(?:[\s_-]|$)/.test(name)) return true;
        // Persistent navigation is part of the page surface, even when sticky.
        if (isNavigationSurface(el)) return false;
        // Preserve foreground UI, such as floating editors and menus.
        if (css.position === 'fixed' || css.position === 'sticky') return true;
        const zIndex = Number.parseInt(css.zIndex, 10);
        return css.position === 'absolute' && zIndex > 0 && rect.width > 80 && rect.height > 30;
    }

    function isGlassPanel(el, rect) {
        if (el === document.body || el === document.documentElement) return false;
        if (rect.width < 100 || rect.height < 44) return false;
        // Keep full-page canvases clear so the wallpaper remains visible.
        if (rect.width > window.innerWidth * 0.96 && rect.height > window.innerHeight * 0.9) return false;
        // A single glass layer on a branch avoids compounded blur and dark tint.
        if (el.parentElement?.closest(`[${SURFACE_ATTR}="glass"], [${SURFACE_ATTR}="frosted"]`)) return false;
        // Include site panels as well as generic backgrounds in modern layouts.
        return true;
    }

    function shouldBlurSurface(el, rect, css) {
        if (isNavigationSurface(el)) return true;
        // Blur behind spacious containers, never behind compact text snippets
        // or inline search-result elements that may overlap other text.
        if (rect.width < 180 || rect.height < 80) return false;
        if (/^(inline|contents|table-row|table-cell)/.test(css.display)) return false;
        if (/^(SPAN|P|SMALL|STRONG|EM|MARK|CODE|PRE|LI|H[1-6])$/.test(el.tagName)) return false;
        return true;
    }

    function tagSurfaces(root = document.body) {
        if (!root) return;
        // Keep existing surface attributes in place. Removing and re-adding
        // them on every chat mutation causes a visible background flash.
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let el;
        while ((el = walker.nextNode())) {
            if (isProtectedSurface(el)) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 48 || rect.height < 28) continue;
            const css = getComputedStyle(el);
            // Sites often render avatars and artwork as CSS background images.
            // Keep those surfaces and their children exactly as the site draws them.
            if (/(?:url\(|(?:-webkit-)?image-set\()/i.test(css.backgroundImage)) {
                el.setAttribute(SAFE_ATTR, '');
                continue;
            }
            if (isForegroundLayer(el, css, rect)) {
                el.setAttribute(SAFE_ATTR, '');
                continue;
            }
            const hasBackground = css.backgroundImage !== 'none' ||
                (css.backgroundColor !== 'transparent' && css.backgroundColor !== 'rgba(0, 0, 0, 0)');
            if (!hasBackground && el !== document.body) continue;
            const surface = isGlassPanel(el, rect)
                ? (shouldBlurSurface(el, rect, css) ? 'frosted' : 'glass') : 'clear';
            el.setAttribute(SURFACE_ATTR, surface);
        }
    }

    /** ==================== GLASS UI ==================== */
    function isNeutralColor(rgbArray) {
        const [r, g, b] = rgbArray.map(v => v / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        const saturation = max === 0 ? 0 : delta / max;
        return saturation < 0.28; // include muted gray text while leaving vivid links and accents intact
    }

    function getEffectiveBackgroundColor(el) {
        let current = el;
        while (current && current !== document.body) {
            try {
                const style = getComputedStyle(current);
                const bg = style.backgroundColor;
                if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
                    const rgba = bg.match(/[\d.]+/g)?.map(Number);
                    if (rgba && (rgba.length < 4 || rgba[3] > 0.35)) {
                        return rgba;
                    }
                }
            } catch (e) { }
            current = current.parentElement;
        }
        return null;
    }

    function applyTextColorCorrection() {
        if (!currentSettings.autoTextColor) {
            document.querySelectorAll('[data-glass-color]').forEach(restoreTextColor);
            return;
        }

        const lightTextOnWallpaper = isDimColorDark();
        document.querySelectorAll('body *:not(img):not(video):not(svg):not(iframe):not(canvas)').forEach(el => {
            try {
                if (el.matches(CONTROL_SELECTOR) ||
                    el.closest('button, a, label, [role="button"], [' + SAFE_ATTR + ']')) {
                    if (el.hasAttribute('data-glass-color')) restoreTextColor(el);
                    return;
                }
                if (el.children.length === 0 && !el.textContent.trim()) return;
                const rgb = getComputedStyle(el).color.match(/\d+/g)?.slice(0, 3).map(Number);
                if (!rgb || rgb.length !== 3 || !isNeutralColor(rgb)) return;

                const bg = getEffectiveBackgroundColor(el);
                const hasPanel = bg && (bg.length < 4 || bg[3] > 0.35);
                const panelLuminance = hasPanel
                    ? (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255 : null;
                const target = (hasPanel ? panelLuminance < 0.54 : lightTextOnWallpaper)
                    ? 'white' : 'black';
                if (el.getAttribute('data-glass-color') !== target) setTextColor(el, target);
            } catch { }
        });
    }

    function applyGlassStep() {
        const [r, g, b] = getDimColorRgb();
        const tint = `rgba(${r},${g},${b},0.75)`;
        const css = `
            html, body {
                background-color: transparent !important;
            }
            [${SURFACE_ATTR}] {
                background-color: transparent !important;
                background-image: none !important;
            }
            [${SURFACE_ATTR}="glass"], [${SURFACE_ATTR}="frosted"] {
                background-color: ${tint} !important;
            }
            [${SURFACE_ATTR}="frosted"] {
                -webkit-backdrop-filter: blur(5px) saturate(135%);
                backdrop-filter: blur(5px) saturate(135%);
            }
            @media (prefers-reduced-motion: no-preference) {
                ${currentSettings.animationsEnabled ? `button, [role="button"] { transition: transform .18s ease; }
                button:hover, [role="button"]:hover { transform: translateY(-1px); }` : ''}
            }
        `;
        const glassTag = document.getElementById(GLASS_STYLE_ID);
        if (glassTag && glassTag.textContent !== css) glassTag.textContent = css;
    }

    /** ==================== APPLY ==================== */
    function apply(forceReset = true) {
        initStyleTags();

        if (!currentSettings.isEnabled) { resetEffects(true); return; }

        // Reset tagging without reloading media.
        if (forceReset) {
            resetEffects(false);
        }

        // Always apply transparency logic immediately. 
        // We don't wait for heavy files anymore to ensure the user knows it's working.
        tagSurfaces();

        applyGlassStep();

        applyTextColorCorrection();


        if (!isTopFrame) return;
        initContainer();

        const rawSrc = currentSettings.imageUrl || currentSettings.imageDataUrl || '';
        const imgSrc = rawSrc === 'icons/background.png'
            ? chrome.runtime.getURL('icons/background.png') : rawSrc;
        const imgName = currentSettings.imageName || '';
        const imgLen = imgSrc.length;
        bgContainer.style.transition = 'none';
        bgImage.style.transition = 'none';
        bgVideo.style.transition = 'none';
        if (bgOverlay) bgOverlay.style.transition = 'none';

        bgContainer.style.opacity = '1';

        // Detect if media is video
        const isVideoMedia = (currentSettings.mediaType === 'video') ||
            /\.mp4(\?|$)/i.test(imgSrc) ||
            (imgSrc.startsWith('data:video/'));

        if (imgSrc) {
            const isHeavy = imgLen > 10000000;
            const hasChanged = imgSrc !== lastRequestedSrc ||
                currentSettings.mediaType !== lastRequestedType;

            if (hasChanged) {
                lastRequestedSrc = imgSrc;
                lastRequestedType = currentSettings.mediaType;
                lastLoadedLength = imgLen;
                lastLoadedName = imgName;
                const currentSession = ++loadSessionId;

                if (isHeavy) {
                    pendingHeavyLoad = true;
                    if (pageSpinner) pageSpinner.classList.add('visible');
                    clearTimeout(pendingLoadTimer);
                    pendingLoadTimer = setTimeout(() => {
                        if (pendingHeavyLoad && loadSessionId === currentSession) {
                            pendingHeavyLoad = false;
                            if (pageSpinner) pageSpinner.classList.remove('visible');
                            apply(false);
                        }
                    }, 3000);
                } else {
                    pendingHeavyLoad = false;
                }

                if (isVideoMedia) {
                    // === VIDEO MODE (via extension iframe to bypass CSP) ===
                    bgImage.style.opacity = '0';
                    bgImage.src = '';

                    // Load the extension's video-bg.html in the iframe
                    // The iframe page reads video data from chrome.storage internally
                    try {
                        const videoPageUrl = chrome.runtime.getURL('video-bg.html');
                        const showVideo = () => {
                            if (loadSessionId === currentSession) {
                                lastLoadedSrc = imgSrc;
                                pendingHeavyLoad = false;
                                if (pageSpinner) pageSpinner.classList.remove('visible');
                                clearTimeout(pendingLoadTimer);
                                bgVideo.style.opacity = '1';
                            }
                        };
                        if (!bgVideo.src || !bgVideo.src.includes('video-bg.html')) {
                            bgVideo.onload = showVideo;
                            bgVideo.src = videoPageUrl;
                        } else {
                            showVideo(); // video-bg.js observes media changes in storage
                        }
                    } catch (e) {
                        console.error('Video iframe setup failed:', e);
                    }
                } else {
                    // === IMAGE MODE ===
                    bgVideo.style.opacity = '0';
                    bgVideo.removeAttribute('src');

                    if (currentBlobUrl) {
                        URL.revokeObjectURL(currentBlobUrl);
                        currentBlobUrl = null;
                    }
                    const playbackSrc = imgSrc.startsWith('data:') ? (currentBlobUrl = dataUrlToBlobUrl(imgSrc)) : imgSrc;

                    bgImage.onerror = () => {
                        if (loadSessionId === currentSession) {
                            // An older installation may not have the new bundled image yet.
                            const fallback = 'https://images2.alphacoders.com/137/1375140.png';
                            if (rawSrc === 'icons/background.png' && bgImage.src !== fallback) {
                                bgImage.src = fallback;
                                return;
                            }
                            pendingHeavyLoad = false;
                            pageSpinner?.classList.remove('visible');
                            lastLoadedLength = 0;
                            lastLoadedName = '';
                            lastRequestedSrc = '';
                        }
                    };
                    bgImage.onload = () => {
                        if (loadSessionId === currentSession) {
                            lastLoadedSrc = imgSrc;
                            pendingHeavyLoad = false;
                            if (pageSpinner) pageSpinner.classList.remove('visible');
                            clearTimeout(pendingLoadTimer);
                            bgImage.style.opacity = '1';
                            animateBackground(bgImage);
                        }
                    };
                    bgImage.src = playbackSrc;
                }
            } else if (!pendingHeavyLoad) {
                if (isVideoMedia) {
                    bgVideo.style.opacity = '1';
                } else {
                    bgImage.style.opacity = '1';
                }
            }
        }

        const blurFilter = currentSettings.blurIntensity ? `blur(${currentSettings.blurIntensity}px)` : 'none';
        if (bgImage) bgImage.style.filter = blurFilter;
        // For video iframe, send filter via postMessage (blur is handled inside iframe)
        if (bgVideo && bgVideo.contentWindow) {
            try {
                bgVideo.contentWindow.postMessage({ type: 'set-filter', filter: blurFilter }, '*');
            } catch (e) { }
        }
        if (bgOverlay) {
            bgOverlay.style.backgroundColor = getDimColorCss();
            bgOverlay.style.opacity = parseFloat(currentSettings.dimLevel ?? 0.5);
        }
    }

    function animateBackground(media, from = 0) {
        if (!currentSettings.animationsEnabled || !media?.animate ||
            window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        media.animate([{ opacity: from }, { opacity: 1 }], {
            duration: 420, easing: 'ease-out'
        });
    }

    function refreshRoute() {
        if (location.href === lastRouteUrl) return;
        lastRouteUrl = location.href;
        fetchSettings(() => {
            apply(false);
            if (isTopFrame) {
                const activeMedia = bgVideo?.style.opacity === '1' ? bgVideo : bgImage;
                if (activeMedia?.style.opacity === '1') animateBackground(activeMedia, 0.72);
            }
        });
    }

    /** ==================== OBSERVER ==================== */
    const debouncedApply = debounce(() => {
        if (!currentSettings.isEnabled) return;

        // Refresh surfaces added or restyled by single-page applications.
        tagSurfaces();

        applyGlassStep();

        applyTextColorCorrection();
    }, 250);

    function observeDOM() {
        if (mutationObserver) mutationObserver.disconnect();

        if (!document.body) {
            setTimeout(observeDOM, 100);
            return;
        }

        mutationObserver = new MutationObserver((mutations) => {
            if (!currentSettings.isEnabled) return;

            let shouldUpdate = false;
            for (let mutation of mutations) {
                // Ignore mutations on our own container or styles
                if (mutation.target.id === BG_CONTAINER_ID ||
                    mutation.target.id === STYLE_TAG_ID ||
                    mutation.target.id === GLASS_STYLE_ID) continue;

                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Check if added nodes aren't just our own spinner
                    const realNodes = Array.from(mutation.addedNodes).some(node =>
                        node.nodeType === 1 && !node.classList?.contains('universal-spinner')
                    );
                    if (realNodes) { shouldUpdate = true; break; }
                }

                if (mutation.type === 'attributes') {
                    if (mutation.attributeName === 'data-glass-color' ||
                        mutation.attributeName === 'data-bg-color' ||
                        mutation.attributeName === SURFACE_ATTR ||
                        mutation.attributeName === SAFE_ATTR) continue;
                    if (mutation.target.hasAttribute('data-glass-color') ||
                        mutation.target.hasAttribute(SURFACE_ATTR) ||
                        mutation.target.hasAttribute(SAFE_ATTR)) continue;
                    shouldUpdate = true; break;
                }
            }

            if (shouldUpdate) {
                debouncedApply();
            }
        });

        mutationObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "style", "id"]
        });
    }

    /** ==================== PERSISTENCE PULSE ==================== */
    // Websites like YouTube/Gmail often nuke or override styles. 
    // This "pulse" ensures our critical elements stay alive and at the correct positions.
    function startPersistencePulse() {
        setInterval(() => {
            if (!currentSettings.isEnabled) return;

            // 1. Ensure Container & Styles are still in DOM and correctly placed
            initStyleTags();
            if (isTopFrame) {
                initContainer();
                if (bgContainer && bgContainer.style.opacity === '0' && currentSettings.isEnabled) {
                    bgContainer.style.opacity = '1';
                }
            }

            // 2. Secondary check for text colors (especially for SPAs)
            // We don't do a full 'apply(true)' to avoid flicker, just a refresh
            tagSurfaces();
            applyGlassStep();

            applyTextColorCorrection();
        }, 3000); // Pulse every 3 seconds

        // URL Change detection for SPAs that don't trigger pushState correctly
        setInterval(() => {
            if (location.href !== lastRouteUrl) setTimeout(refreshRoute, 500);
        }, 1000);
    }

    /** ==================== INIT ==================== */
    function initialize() {
        if (chrome?.storage?.onChanged) {
            chrome.storage.onChanged.addListener(() => fetchSettings(() => apply(true)));
        }

        if (document.readyState === "complete" || document.readyState === "interactive") {
            fetchSettings(() => apply(true));
        } else {
            window.addEventListener("DOMContentLoaded", () => fetchSettings(() => apply(true)));
            window.addEventListener("load", () => setTimeout(() => fetchSettings(() => apply(true)), 200));
        }

        observeDOM();
        startPersistencePulse();

        ['pushState', 'replaceState'].forEach(fn => {
            const orig = history[fn];
            history[fn] = function (...args) {
                const res = orig.apply(this, args);
                setTimeout(refreshRoute, 200);
                return res;
            };
        });

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (currentSettings.dimColor === 'auto') apply(false);
        });

        window.addEventListener('popstate', () => {
            setTimeout(refreshRoute, 200);
        });
    }

    initialize();
})();
