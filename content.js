(() => {
    const BG_CONTAINER_ID = 'universal-bg-container';
    const STYLE_TAG_ID = 'universal-bg-styles';
    const GLASS_STYLE_ID = 'glass-style';
    const SAFE_ATTR = 'data-safe-chroma';
    const isTopFrame = window.self === window.top;

    let currentSettings = {};
    let bgContainer, bgImage, bgVideo, bgOverlay, styleTag;
    let mutationObserver = null;
    let lastMode = null;
    let pendingHeavyLoad = false;
    let pendingLoadTimer = null;
    let lastLoadedSrc = '';
    let lastLoadedName = '';
    let lastLoadedLength = 0;
    let pageSpinner = null;
    let loadSessionId = 0;
    let currentBlobUrl = null;

    /** ==================== HELPERS ==================== */
    function fetchSettings(callback) {
        try {
            if (!chrome?.runtime?.id) return;
            chrome.storage.local.get(null, (settings) => {
                currentSettings = settings || {};
                currentSettings.isEnabled = currentSettings.isEnabled ?? true;
                currentSettings.uiMode = currentSettings.uiMode || 'chroma';
                currentSettings.protectModals = currentSettings.protectModals ?? false;
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

    function initContainer() {
        if (!bgContainer) {
            bgContainer = document.createElement('div');
            bgContainer.id = BG_CONTAINER_ID;
            Object.assign(bgContainer.style, {
                position: 'fixed', top: 0, left: 0,
                width: '100vw', height: '100vh',
                zIndex: '-2147483647', pointerEvents: 'none',
                overflow: 'hidden', opacity: 0,
                transition: 'opacity 0.5s ease',
            });

            bgImage = document.createElement('img');
            Object.assign(bgImage.style, {
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover', opacity: 0,
                transition: 'opacity 0.5s ease',
            });

            bgVideo = document.createElement('video');
            Object.assign(bgVideo.style, {
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover', opacity: 0,
                transition: 'opacity 0.5s ease',
            });
            bgVideo.autoplay = true;
            bgVideo.loop = true;
            bgVideo.muted = true;
            bgVideo.playsInline = true;

            bgOverlay = document.createElement('div');
            Object.assign(bgOverlay.style, {
                position: 'absolute', inset: 0,
                opacity: 0, transition: 'opacity 0.5s ease',
            });

            bgContainer.append(bgVideo, bgImage, bgOverlay);
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
                    z-index: 2147483647; pointer-events: none; opacity: 0; transition: opacity 0.3s;
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
                if (bgImage) bgImage.src = '';
                if (bgVideo) bgVideo.src = '';
                lastLoadedSrc = '';
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
            if (el.hasAttribute('data-glass-color')) {
                el.style.removeProperty('color');
                el.removeAttribute('data-glass-color');
            }
        });
    }

    /** ==================== CHROMA MODE ==================== */
    function applyChromaBase() {
        const dimLevel = currentSettings.dimLevel ?? 0.25;
        const dimColor = currentSettings.dimColor || 'dark';
        const alpha = dimLevel * 0.25;
        const bgColor = dimColor === 'light' ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;

        const animStyles = currentSettings.animationsEnabled ? `
        button, .btn, .button, [role="button"], 
        input[type="submit"], input[type="button"], input[type="reset"],
        [role="tab"], [role="link"], a, summary, select {
            transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), 
                        box-shadow 0.2s ease, 
                        background-color 0.2s ease,
                        filter 0.2s ease !important;
        }
        button:hover, .btn:hover, .button:hover, [role="button"]:hover,
        input[type="submit"]:hover, input[type="button"]:hover,
        [role="tab"]:hover, [role="link"]:hover, a:hover, summary:hover {
            transform: translateY(-2px) scale(1.02) !important;
            filter: brightness(1.1) !important;
        }
        button:active, .btn:active, .button:active, [role="button"]:active,
        input[type="submit"]:active, input[type="button"]:active,
        [role="tab"]:active, [role="link"]:active, a:active, summary:active {
            transform: translateY(0) scale(0.96) !important;
            filter: brightness(0.9) !important;
        }
        ` : '';

        const popupAnim = currentSettings.animationsEnabled ? `
        @keyframes slideInUp {
            from { opacity: 0; transform: translateY(20px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        [role="dialog"], [role="menu"], .popup, .modal, .dropdown, .overlay, [aria-modal="true"] {
            animation: slideInUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards !important;
        }
        ` : '';

        styleTag.textContent = `
        [data-bg-color], body {
            background: transparent !important;
            background-color: transparent !important;
            background-image: none !important;
        }

        /* Tambahkan efek transparan untuk popup/dialog/modal/menu hanya jika proteksi dimatikan */
        ${currentSettings.protectModals ? '' : `
        [role="dialog"]:not([${SAFE_ATTR}]),
        [role="menu"]:not([${SAFE_ATTR}]),
        .popup:not([${SAFE_ATTR}]),
        .modal:not([${SAFE_ATTR}]),
        .dropdown:not([${SAFE_ATTR}]),
        .overlay:not([${SAFE_ATTR}]),
        [aria-modal="true"]:not([${SAFE_ATTR}]) {
            background-color: ${bgColor} !important;
            backdrop-filter: blur(${currentSettings.blurIntensity || 8}px) !important;
            border-radius: 12px !important;
        }
        `}
        ${animStyles}
        ${popupAnim}
    `;
    }

    function safeTagElements(root) {
        if (!root) return;
        const protectModals = currentSettings.protectModals ?? true;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                if (node.id === BG_CONTAINER_ID || node.closest('#' + BG_CONTAINER_ID)) return NodeFilter.FILTER_REJECT;
                if (node.hasAttribute(SAFE_ATTR)) return NodeFilter.FILTER_REJECT;
                if (node.hasAttribute('data-bg-color')) return NodeFilter.FILTER_REJECT;

                // NEW: Tight UI Layer Protection
                if (protectModals) {
                    try {
                        const style = window.getComputedStyle(node);

                        // 1. Position Check (Mutlak skip fixed, sticky, absolute)
                        const pos = style.position;
                        if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') return NodeFilter.FILTER_REJECT;

                        // 2. Strict Z-Index Check (Z > 0 dianggap layer UI)
                        const z = style.zIndex;
                        if (z !== 'auto' && parseInt(z) > 0) return NodeFilter.FILTER_REJECT;

                        // 3. Deep Keyword Search (ID & Class)
                        const id = node.id?.toLowerCase() || '';
                        const className = (typeof node.className === 'string' ? node.className : '').toLowerCase();
                        const uiKeywords = ['modal', 'popup', 'dialog', 'swal', 'portal', 'popper', 'wrapper', 'banner', 'tooltip', 'notify', 'alert', 'layer', 'panel', 'overlay', 'mask', 'drawer'];

                        if (uiKeywords.some(key => id.includes(key) || className.includes(key))) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        // 4. Portal & Headless UI check
                        if (node.hasAttribute('data-radix-portal') || node.hasAttribute('data-headlessui-portal') || node.hasAttribute('aria-haspopup')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                    } catch (e) { }
                }

                return NodeFilter.FILTER_ACCEPT;
            }
        });
        while (walker.nextNode()) {
            const el = walker.currentNode;
            try {
                const style = getComputedStyle(el);
                const bg = style.backgroundColor;
                const bgImg = style.backgroundImage;

                // Protect elements with gradients or background images
                if (bgImg && bgImg !== 'none') continue;

                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                    // Avoid tagging very small elements (icons, badges, etc)
                    if (el.offsetWidth < 30 || el.offsetHeight < 30) continue;

                    const nums = bg.match(/\d+/g);
                    if (!nums || nums.length < 3) continue;
                    const rgb = nums.slice(0, 3).map(Number);

                    // Only process neutral colors (whites, blacks, greys)
                    if (!isNeutralColor(rgb)) continue;

                    const [r, g, b] = rgb;
                    const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
                    el.setAttribute('data-bg-color', hex.toLowerCase());
                }
            } catch { }
        }
    }

    function markSafeElements() {
        // YouTube & Common Heavy Re-renderers
        document.querySelectorAll('#masthead-container, ytd-masthead, #search, ytd-searchbox, #guide, ytd-guide-renderer, #sections, #contents a, tp-yt-paper-item, #end, .ytp-chrome-top, .ytp-chrome-bottom')
            .forEach(el => el.setAttribute(SAFE_ATTR, 'true'));
        // Google
        document.querySelectorAll('#searchform, #gb, #hplogo, .gb_uc, .top-bar')
            .forEach(el => el.setAttribute(SAFE_ATTR, 'true'));
        // Universal & Common UI + Aggressive Popup/Portal Selectors
        document.querySelectorAll('header, nav, footer, button, [type="submit"], [role="button"], [role="menu"], [role="dialog"], [role="alert"], [role="status"], [role="tooltip"], [role="banner"], [role="navigation"], input, select, textarea, a, [onclick], [tabindex], .btn, .button, .badge, .label, .tag, .toast, .alert, .modal, .popup, .dropdown, .card-header, .card-footer, img, video, svg, canvas, iframe, .swal2-container, .swal-overlay, .modal-backdrop, .MuiDialog-root, .MuiPopover-root, .MuiMenu-root, .flatpickr-calendar, .ui-datepicker, .select2-container, [id*="portal"], [id*="popper"], [class*="portal"], [class*="popper"], [data-radix-portal], [data-headlessui-portal]')
            .forEach(el => el.setAttribute(SAFE_ATTR, 'true'));
    }

    /** ==================== GLASS MODE ==================== */
    function isNeutralColor(rgbArray) {
        const [r, g, b] = rgbArray.map(v => v / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        const saturation = max === 0 ? 0 : delta / max;
        return saturation < 0.5; // threshold netral (increased for tinted dark modes)
    }

    function applyGlassStep() {
        const { dimLevel = 0.25, dimColor = 'dark', blurIntensity = 8 } = currentSettings;
        const alpha = dimLevel * 0.25;
        const bgColor = dimColor === 'light' ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;

        const animStyles = currentSettings.animationsEnabled ? `
            button, .btn, .button, [role="button"], 
            input[type="submit"], input[type="button"], input[type="reset"],
            [role="tab"], [role="link"], a, summary, select {
                transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), 
                            box-shadow 0.2s ease, 
                            background-color 0.2s ease,
                            filter 0.2s ease !important;
            }
            button:hover, .btn:hover, .button:hover, [role="button"]:hover,
            input[type="submit"]:hover, input[type="button"]:hover,
            [role="tab"]:hover, [role="link"]:hover, a:hover, summary:hover {
                transform: translateY(-2px) scale(1.02) !important;
                filter: brightness(1.1) !important;
            }
            button:active, .btn:active, .button:active, [role="button"]:active,
            input[type="submit"]:active, input[type="button"]:active,
            [role="tab"]:active, [role="link"]:active, a:active, summary:active {
                transform: translateY(0) scale(0.96) !important;
                filter: brightness(0.9) !important;
            }
        ` : '';

        const popupAnim = currentSettings.animationsEnabled ? `
            @keyframes slideInUp {
                from { opacity: 0; transform: translateY(20px) scale(0.95); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            [role="dialog"], [role="menu"], .popup, .modal, .dropdown, .overlay, [aria-modal="true"] {
                animation: slideInUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards !important;
            }
        ` : '';

        const glassTag = document.getElementById(GLASS_STYLE_ID);
        glassTag.textContent = `
            *:not([${SAFE_ATTR}]):not(img):not(video):not(svg):not(canvas):not(iframe) { 
                background-color: ${bgColor} !important; 
                border-radius: 12px !important; 
            }
            body { border-radius: 0 !important; }
            [role="dialog"], [role="menu"], .popup, .modal, .dropdown, .overlay, [aria-modal="true"] {
                background-color: ${bgColor} !important;
                backdrop-filter: blur(${blurIntensity}px) !important;
            }
            ${animStyles}
            ${popupAnim}
        `;

        const targetColor = dimColor === 'dark' ? 'white' : 'black';
        document.querySelectorAll(`body *:not(img):not(video):not(svg):not(iframe):not(canvas)`).forEach(el => {
            try {
                // Skip if purely a container for images/videos
                if (el.children.length === 0 && !el.textContent.trim()) return;

                // Color switching is still needed even for "safe" elements if they contain neutral text
                // because the glass background applies to everything behind them.
                if (el.getAttribute('data-glass-color') === targetColor) return;

                const c = getComputedStyle(el).color;
                const rgb = c.match(/\d+/g)?.map(Number);
                if (!rgb || rgb.length < 3) return;

                if (isNeutralColor(rgb)) {
                    el.style.setProperty('color', targetColor, 'important');
                    el.setAttribute('data-glass-color', targetColor);
                }
            } catch { }
        });
    }

    /** ==================== APPLY ==================== */
    function apply(forceReset = true) {
        initStyleTags();

        if (!currentSettings.isEnabled) { resetEffects(true); lastMode = null; return; }

        // Mode switch or forced: reset tagging but keep media to avoid flicker/re-load
        if (forceReset || currentSettings.uiMode !== lastMode) {
            resetEffects(false);
        }

        // Always apply transparency logic immediately. 
        // We don't wait for heavy files anymore to ensure the user knows it's working.
        markSafeElements();

        if (currentSettings.uiMode === 'glass') {
            applyGlassStep();
        } else {
            applyChromaBase();
            safeTagElements(document.body);
        }

        lastMode = currentSettings.uiMode;

        if (!isTopFrame) return;
        initContainer();

        const imgSrc = currentSettings.imageUrl || currentSettings.imageDataUrl || '';
        const imgName = currentSettings.imageName || '';
        const imgLen = imgSrc.length;
        bgContainer.style.opacity = '1';

        if (imgSrc) {
            const isVideo = imgSrc.startsWith('data:video') || imgSrc.toLowerCase().endsWith('.mp4');
            const isHeavy = isVideo || imgLen > 10000000;

            // Efficient check if source changed: length + name is usually enough to avoid expensive string compares
            const hasChanged = (imgLen !== lastLoadedLength) || (imgName !== lastLoadedName);

            if (hasChanged) {
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
                            apply(false); // Don't force reset, just update
                        }
                    }, 3000); // 3s fallback
                } else {
                    pendingHeavyLoad = false;
                }

                // Create Blob URL for media
                if (currentBlobUrl) {
                    URL.revokeObjectURL(currentBlobUrl);
                    currentBlobUrl = null;
                }
                const playbackSrc = imgSrc.startsWith('data:') ? (currentBlobUrl = dataUrlToBlobUrl(imgSrc)) : imgSrc;

                if (isVideo) {
                    bgImage.style.opacity = '0';
                    bgVideo.onerror = () => {
                        if (loadSessionId === currentSession) {
                            pendingHeavyLoad = false;
                            pageSpinner?.classList.remove('visible');
                            lastLoadedLength = 0;
                            lastLoadedName = '';
                        }
                    };
                    bgVideo.onloadeddata = () => {
                        if (loadSessionId === currentSession) {
                            lastLoadedSrc = imgSrc;
                            pendingHeavyLoad = false;
                            if (pageSpinner) pageSpinner.classList.remove('visible');
                            clearTimeout(pendingLoadTimer);
                            bgVideo.style.opacity = '1';
                        }
                    };
                    bgVideo.src = playbackSrc;
                    bgVideo.play().catch(() => { });
                } else {
                    bgVideo.style.opacity = '0';
                    bgImage.onerror = () => {
                        if (loadSessionId === currentSession) {
                            pendingHeavyLoad = false;
                            pageSpinner?.classList.remove('visible');
                            lastLoadedLength = 0;
                            lastLoadedName = '';
                        }
                    };
                    bgImage.onload = () => {
                        if (loadSessionId === currentSession) {
                            lastLoadedSrc = imgSrc;
                            pendingHeavyLoad = false;
                            if (pageSpinner) pageSpinner.classList.remove('visible');
                            clearTimeout(pendingLoadTimer);
                            bgImage.style.opacity = '1';
                        }
                    };
                    bgImage.src = playbackSrc;
                }
            } else if (!pendingHeavyLoad) {
                // Already loaded or light file
                if (isVideo) {
                    bgVideo.style.opacity = '1';
                } else {
                    bgImage.style.opacity = '1';
                }
            }
        }

        const blurFilter = currentSettings.blurIntensity ? `blur(${currentSettings.blurIntensity}px)` : 'none';
        if (bgImage) bgImage.style.filter = blurFilter;
        if (bgVideo) bgVideo.style.filter = blurFilter;
        bgOverlay.style.backgroundColor = currentSettings.dimColor === 'light' ? '#fff' : '#000';
        bgOverlay.style.opacity = currentSettings.dimLevel ?? 0;
    }

    /** ==================== OBSERVER ==================== */
    const debouncedApply = debounce(() => {
        if (!currentSettings.isEnabled) return;
        if (currentSettings.uiMode === 'glass') {
            applyGlassStep();
        } else {
            markSafeElements();
            safeTagElements(document.body);
        }
    }, 250);

    function observeDOM() {
        if (mutationObserver) mutationObserver.disconnect();

        // Safety check for body
        if (!document.body) {
            setTimeout(observeDOM, 100);
            return;
        }

        mutationObserver = new MutationObserver((mutations) => {
            if (!currentSettings.isEnabled) return;

            // Loop prevention: check if mutations are actually from the site
            let shouldUpdate = false;
            for (let mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    shouldUpdate = true; break;
                }
                if (mutation.type === 'attributes') {
                    // Ignore our own changes to prevent infinite loops (especially in Chroma mode)
                    if (mutation.attributeName === 'data-glass-color' ||
                        mutation.attributeName === 'data-bg-color' ||
                        mutation.attributeName === SAFE_ATTR) continue;
                    shouldUpdate = true; break;
                }
            }

            if (shouldUpdate) {
                debouncedApply();
            }
        });
        mutationObserver.observe(document.body, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ["class", "style"]
        });
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

        ['pushState', 'replaceState'].forEach(fn => {
            const orig = history[fn];
            history[fn] = function (...args) {
                const res = orig.apply(this, args);
                if (currentSettings.uiMode === 'glass') {
                    setTimeout(() => fetchSettings(() => apply(true)), 150);
                }
                return res;
            };
        });

        window.addEventListener('popstate', () => {
            if (currentSettings.uiMode === 'glass') {
                setTimeout(() => fetchSettings(() => apply(true)), 150);
            }
        });
    }

    initialize();
})();
