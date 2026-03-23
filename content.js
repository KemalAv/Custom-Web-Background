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
                currentSettings.autoTextColor = currentSettings.autoTextColor ?? false;
                currentSettings.ignoreElementBg = currentSettings.ignoreElementBg ?? false;
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

    function initContainer() {
        if (!bgContainer) {
            bgContainer = document.createElement('div');
            bgContainer.id = BG_CONTAINER_ID;
            Object.assign(bgContainer.style, {
                position: 'fixed', top: 0, left: 0,
                width: '100vw', height: '100vh',
                zIndex: '-2147483647', pointerEvents: 'none',
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
            filter: brightness(0.9) !important;
        }
        ` : '';

        const popupAnim = currentSettings.animationsEnabled ? `
        @keyframes slideInUp {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        [role="dialog"], [role="menu"], .popup, .modal, .dropdown, .overlay, [aria-modal="true"] {
            /* Use only opacity animation to prevent layout/position shifts */
            animation: slideInUp 0.2s ease-out forwards !important;
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
        // 1. Static Rules (High-level containers)
        document.querySelectorAll('#masthead-container, ytd-masthead, #search, ytd-searchbox, #guide, ytd-guide-renderer, #sections, #contents a, tp-yt-paper-item, #end, .ytp-chrome-top, .ytp-chrome-bottom, #searchform, #gb, #hplogo, .gb_uc, .top-bar')
            .forEach(el => el.setAttribute(SAFE_ATTR, 'true'));

        // 2. Functional Rules (Buttons, inputs, etc)
        document.querySelectorAll('header, nav, footer, button, [type="submit"], [role="button"], [role="menu"], [role="dialog"], [role="alert"], [role="status"], [role="tooltip"], [role="banner"], [role="navigation"], input, select, textarea, a, [onclick], [tabindex], .btn, .button, .badge, .label, .tag, .toast, .alert, .modal, .popup, .dropdown, .card-header, .card-footer, img, video, svg, canvas, iframe, .swal2-container, .swal-overlay, .modal-backdrop, .MuiDialog-root, .MuiPopover-root, .MuiMenu-root, .flatpickr-calendar, .ui-datepicker, .select2-container, [id*="portal"], [id*="popper"], [class*="portal"], [class*="popper"], [data-radix-portal], [data-headlessui-portal]')
            .forEach(el => el.setAttribute(SAFE_ATTR, 'true'));

        // 3. Dynamic UI Protection (Strict Check)
        const protectModals = currentSettings.protectModals ?? false;
        const uiKeywords = ['modal', 'popup', 'dialog', 'swal', 'portal', 'popper', 'wrapper', 'banner', 'tooltip', 'notify', 'alert', 'layer', 'panel', 'overlay', 'mask', 'drawer'];

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                if (node.hasAttribute(SAFE_ATTR)) return NodeFilter.FILTER_SKIP;

                // Small elements (icons, badges, etc) should never be transparent/glass
                if (node.offsetWidth > 0 && node.offsetHeight > 0 && (node.offsetWidth < 32 || node.offsetHeight < 32)) {
                    return NodeFilter.FILTER_ACCEPT;
                }

                if (protectModals) {
                    try {
                        const style = window.getComputedStyle(node);
                        const pos = style.position;
                        const z = style.zIndex;

                        // Position check
                        if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') return NodeFilter.FILTER_ACCEPT;
                        // Z-Index check
                        if (z !== 'auto' && parseInt(z) > 1) return NodeFilter.FILTER_ACCEPT;

                        // Keyword check
                        const id = node.id?.toLowerCase() || '';
                        const className = (typeof node.className === 'string' ? node.className : '').toLowerCase();
                        if (uiKeywords.some(key => id.includes(key) || className.includes(key))) return NodeFilter.FILTER_ACCEPT;

                        // Portal check
                        if (node.hasAttribute('data-radix-portal') || node.hasAttribute('data-headlessui-portal') || node.hasAttribute('aria-haspopup')) {
                            return NodeFilter.FILTER_ACCEPT;
                        }
                    } catch (e) { }
                }
                return NodeFilter.FILTER_SKIP;
            }
        });

        while (walker.nextNode()) {
            walker.currentNode.setAttribute(SAFE_ATTR, 'true');
        }
    }

    /** ==================== GLASS MODE ==================== */
    function isNeutralColor(rgbArray) {
        const [r, g, b] = rgbArray.map(v => v / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        const saturation = max === 0 ? 0 : delta / max;
        return saturation < 0.2; // threshold netral (lebih ketat agar tidak mewarnai teks berwarna)
    }

    function getEffectiveBackgroundColor(el) {
        let current = el;
        while (current && current !== document.body) {
            try {
                const style = getComputedStyle(current);
                const bg = style.backgroundColor;
                if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
                    const rgba = bg.match(/[\d.]+/g)?.map(Number);
                    if (rgba && (rgba.length < 4 || rgba[3] > 0.5)) {
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
            // Cleanup if disabled
            document.querySelectorAll('[data-glass-color]').forEach(el => {
                el.style.removeProperty('color');
                el.removeAttribute('data-glass-color');
            });
            return;
        }

        const dimColor = currentSettings.dimColor || 'dark';
        const ignoreElementBg = currentSettings.ignoreElementBg ?? false;

        document.querySelectorAll(`body *:not(img):not(video):not(svg):not(iframe):not(canvas)`).forEach(el => {
            try {
                // Lewati jika hanya container gambar/video/kosong
                if (el.children.length === 0 && !el.textContent.trim()) return;

                const style = getComputedStyle(el);
                const currentColor = style.color;
                const rgb = currentColor.match(/\d+/g)?.map(Number);
                if (!rgb || rgb.length < 3) return;

                // Hanya proses teks yang berwarna netral (putih, hitam, abu-abu)
                if (!isNeutralColor(rgb)) return;

                // === IGNORE ELEMENT BACKGROUND MODE ===
                // When ignoreElementBg is ON, always force text color based on dim overlay,
                // completely ignoring the element's own background color.
                if (ignoreElementBg) {
                    if (dimColor === 'dark') {
                        if (el.getAttribute('data-glass-color') !== 'white') {
                            el.style.setProperty('color', 'white', 'important');
                            el.setAttribute('data-glass-color', 'white');
                        }
                    } else {
                        if (el.getAttribute('data-glass-color') !== 'black') {
                            el.style.setProperty('color', 'black', 'important');
                            el.setAttribute('data-glass-color', 'black');
                        }
                    }
                    return;
                }

                // === NORMAL MODE: respect element background ===
                const bgRgba = getEffectiveBackgroundColor(el);
                let bgLuminance = 1; // Default ke terang (putih)
                let isOpaque = false;

                if (bgRgba) {
                    const bgAlpha = bgRgba.length === 4 ? bgRgba[3] : 1;
                    if (bgAlpha > 0.5) {
                        isOpaque = true;
                        const [br, bg_g, bb] = bgRgba;
                        bgLuminance = (0.299 * br + 0.587 * bg_g + 0.114 * bb) / 255;
                    }
                }

                // Rule 1: Teks pada icon/background GELAP harus PUTIH (untuk kontras)
                if (isOpaque && bgLuminance < 0.35) {
                    if (el.getAttribute('data-glass-color') !== 'white') {
                        el.style.setProperty('color', 'white', 'important');
                        el.setAttribute('data-glass-color', 'white');
                    }
                    return;
                }

                // Rule 2: Perilaku Dark Mode (Dim Color: Black)
                if (dimColor === 'dark') {
                    // Paksa teks ke putih kecuali jika di atas background yang sudah terang
                    if (isOpaque && bgLuminance > 0.65) {
                        if (el.hasAttribute('data-glass-color')) {
                            el.style.removeProperty('color');
                            el.removeAttribute('data-glass-color');
                        }
                    } else {
                        if (el.getAttribute('data-glass-color') !== 'white') {
                            el.style.setProperty('color', 'white', 'important');
                            el.setAttribute('data-glass-color', 'white');
                        }
                    }
                    return;
                }

                // Rule 3: Perilaku Light Mode (Dim Color: White)
                if (dimColor === 'light') {
                    // Paksa teks ke hitam kecuali jika di atas background yang lumayan gelap
                    if (isOpaque && bgLuminance < 0.5) {
                        if (el.hasAttribute('data-glass-color')) {
                            el.style.removeProperty('color');
                            el.removeAttribute('data-glass-color');
                        }
                    } else {
                        if (el.getAttribute('data-glass-color') !== 'black') {
                            el.style.setProperty('color', 'black', 'important');
                            el.setAttribute('data-glass-color', 'black');
                        }
                    }
                    return;
                }

            } catch { }
        });
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
                filter: brightness(0.9) !important;
            }
        ` : '';

        const popupAnim = currentSettings.animationsEnabled ? `
            @keyframes slideInUp {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            [role="dialog"], [role="menu"], .popup, .modal, .dropdown, .overlay, [aria-modal="true"] {
                animation: slideInUp 0.2s ease-out forwards !important;
            }
        ` : '';

        const glassTag = document.getElementById(GLASS_STYLE_ID);
        glassTag.textContent = `
            *:not([${SAFE_ATTR}]):not(img):not(video):not(svg):not(canvas):not(iframe) { 
                background-color: ${bgColor} !important; 
                border-radius: 12px !important; 
            }
            body { border-radius: 0 !important; }

            /* Protected Elements override (only if not already glass) */
            [${SAFE_ATTR}] {
                backdrop-filter: none !important;
            }

            [role="dialog"], [role="menu"], .popup, .modal, .dropdown, .overlay, [aria-modal="true"] {
                ${currentSettings.protectModals ? '' : `
                    background-color: ${bgColor} !important;
                    backdrop-filter: blur(${blurIntensity}px) !important;
                `}
            }
            ${animStyles}
            ${popupAnim}
        `;
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

        applyTextColorCorrection();

        lastMode = currentSettings.uiMode;

        if (!isTopFrame) return;
        initContainer();

        const imgSrc = currentSettings.imageUrl || currentSettings.imageDataUrl || '';
        const imgName = currentSettings.imageName || '';
        const imgLen = imgSrc.length;
        const animDur = currentSettings.animationsEnabled ? '0.5s' : '0s';
        const transStyle = `opacity ${animDur} ease`;
        bgContainer.style.transition = transStyle;
        bgImage.style.transition = transStyle;
        bgVideo.style.transition = transStyle;
        if (bgOverlay) bgOverlay.style.transition = transStyle;

        bgContainer.style.opacity = '1';

        // Detect if media is video
        const isVideoMedia = (currentSettings.mediaType === 'video') ||
            /\.mp4(\?|$)/i.test(imgSrc) ||
            (imgSrc.startsWith('data:video/'));

        if (imgSrc) {
            const isHeavy = imgLen > 10000000;
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
                        if (!bgVideo.src || !bgVideo.src.includes('video-bg.html')) {
                            bgVideo.src = videoPageUrl;
                        }
                        // Notify iframe to reload video from storage
                        bgVideo.onload = () => {
                            if (loadSessionId === currentSession) {
                                lastLoadedSrc = imgSrc;
                                pendingHeavyLoad = false;
                                if (pageSpinner) pageSpinner.classList.remove('visible');
                                clearTimeout(pendingLoadTimer);
                                bgVideo.style.opacity = '1';
                                // Tell the iframe to load video
                                setTimeout(() => {
                                    bgVideo.contentWindow?.postMessage({ type: 'update-video' }, '*');
                                }, 100);
                            }
                        };
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
            bgOverlay.style.backgroundColor = currentSettings.dimColor === 'light' ? '#fff' : '#000';
            bgOverlay.style.opacity = currentSettings.dimLevel ?? 0;
        }
    }

    /** ==================== OBSERVER ==================== */
    const debouncedApply = debounce(() => {
        if (!currentSettings.isEnabled) return;

        // Always refresh safe tags first to ensure persistence
        markSafeElements();

        if (currentSettings.uiMode === 'glass') {
            applyGlassStep();
        } else {
            safeTagElements(document.body);
        }

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
                        mutation.attributeName === SAFE_ATTR) continue;
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
            if (currentSettings.uiMode === 'glass') {
                applyGlassStep();
            } else {
                markSafeElements();
                safeTagElements(document.body);
            }

            applyTextColorCorrection();
        }, 3000); // Pulse every 3 seconds

        // URL Change detection for SPAs that don't trigger pushState correctly
        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                setTimeout(() => fetchSettings(() => apply(true)), 500);
            }
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
                setTimeout(() => fetchSettings(() => apply(true)), 200);
                return res;
            };
        });

        window.addEventListener('popstate', () => {
            setTimeout(() => fetchSettings(() => apply(true)), 200);
        });
    }

    initialize();
})();
