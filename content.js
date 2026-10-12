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
    let hasAnimatedCurrentMedia = false;
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
                currentSettings.extraTransparent = currentSettings.extraTransparent ?? false;
                currentSettings.siteMode = currentSettings.siteMode || 'all';
                currentSettings.specificSites = currentSettings.specificSites || [];
                currentSettings.autoTextColor = currentSettings.autoTextColor ?? false;
                currentSettings.animationsEnabled = currentSettings.animationsEnabled ?? false;
                currentSettings.mediaType = currentSettings.mediaType || 'image';
                currentSettings.imageUrl = currentSettings.imageUrl || (currentSettings.imageDataUrl ? '' : 'icons/background.png');
                callback?.();
            });
        } catch (e) { console.error(e); }
    }

    function isSiteAllowed() {
        const siteMode = currentSettings.siteMode || 'all';
        if (siteMode === 'all') return true;
        if (siteMode === 'specific') {
            const list = currentSettings.specificSites || [];
            if (!Array.isArray(list) || list.length === 0) return false;
            const currentHost = window.location.hostname.toLowerCase();
            return list.some(item => {
                if (!item) return false;
                let clean = item.trim().toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0].split(':')[0];
                if (!clean) return false;
                return currentHost === clean || currentHost.endsWith('.' + clean);
            });
        }
        return true;
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

    function isPageDarkTheme() {
        const html = document.documentElement;
        const body = document.body;

        // 1. YouTube specific dark attribute: <html dark> or <html dark="true">
        if (html) {
            if (html.hasAttribute('dark')) {
                const val = html.getAttribute('dark');
                if (val === '' || val === 'true' || val === 'dark') return true;
                if (val === 'false') return false;
            }
        }

        // 2. Explicit data-theme / data-color-mode / theme attributes
        const themeAttr = (html?.getAttribute('data-theme') ||
            body?.getAttribute('data-theme') ||
            html?.getAttribute('data-color-mode') ||
            body?.getAttribute('data-color-mode') ||
            html?.getAttribute('theme') ||
            body?.getAttribute('theme') || '').toLowerCase();
        if (themeAttr) {
            if (/dark/i.test(themeAttr)) return true;
            if (/light/i.test(themeAttr)) return false;
        }

        // 3. Class names containing dark or light theme
        const classStr = `${html?.className || ''} ${body?.className || ''}`.toLowerCase();
        if (/(?:^|\s)(?:dark|theme-dark|dark-theme|dark-mode|mode-dark)(?:\s|$)/.test(classStr)) return true;
        if (/(?:^|\s)(?:light|theme-light|light-theme|light-mode|mode-light)(?:\s|$)/.test(classStr)) return false;

        // 4. CSS color-scheme
        try {
            if (html) {
                const cs = getComputedStyle(html).colorScheme;
                if (cs === 'dark') return true;
                if (cs === 'light') return false;
            }
        } catch (e) { }

        // 5. Check computed text color of body (if text is light, page is dark; if text is dark, page is light)
        try {
            if (body) {
                const bodyColor = getComputedStyle(body).color;
                const rgb = bodyColor.match(/\d+/g)?.slice(0, 3).map(Number);
                if (rgb && rgb.length === 3) {
                    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
                    if (lum > 0.6) return true;
                    if (lum < 0.4) return false;
                }
            }
        } catch (e) { }

        // 6. Fallback to system OS preferences
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function getDimColorRgb() {
        const dimColor = currentSettings.dimColor || 'auto';
        if (dimColor === 'white' || dimColor === 'light') return [255, 255, 255];
        if (dimColor === 'black' || dimColor === 'dark') return [0, 0, 0];
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
        // Auto: ikuti tema website (tema putih -> putih, tema hitam -> hitam)
        return isPageDarkTheme() ? [0, 0, 0] : [255, 255, 255];
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
        const root = document.documentElement || document.body;
        if (!root) return;

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

        if (!root.contains(bgContainer)) {
            root.prepend(bgContainer);
        }

        if (!pageSpinner) {
            pageSpinner = document.createElement('div');
            pageSpinner.className = 'universal-spinner';
        }
        if (!root.contains(pageSpinner)) {
            root.appendChild(pageSpinner);
        }
    }

    function initStyleTags() {
        const root = document.head || document.documentElement;
        if (!root) return;

        styleTag = document.getElementById(STYLE_TAG_ID);
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = STYLE_TAG_ID;
            root.appendChild(styleTag);
        } else if (!root.contains(styleTag)) {
            root.appendChild(styleTag);
        }

        let glassTag = document.getElementById(GLASS_STYLE_ID);
        if (!glassTag) {
            glassTag = document.createElement('style');
            glassTag.id = GLASS_STYLE_ID;
            root.appendChild(glassTag);
        } else if (!root.contains(glassTag)) {
            root.appendChild(glassTag);
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
            root.appendChild(spinnerStyles);
        } else if (!root.contains(spinnerStyles)) {
            root.appendChild(spinnerStyles);
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
                hasAnimatedCurrentMedia = false;
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
        'video', 'audio', 'img', 'svg', 'canvas', 'iframe', 'picture',
        '[contenteditable]:not([contenteditable="false"])',
        '[role="checkbox"]', '[role="switch"]', '[role="textbox"]',
        '[role="combobox"]', '[role="option"]', '[role="slider"]',
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
        // Don't turn native form controls or media elements into glass
        if (el.matches(CONTROL_SELECTOR) || el.closest('button, select, textarea, option, summary, video, audio')) return true;
        if (el.matches(MODAL_SELECTOR) || el.closest(MODAL_SELECTOR)) return true;
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
        return css.position === 'absolute' && zIndex > 10 && rect.width > 80 && rect.height > 30;
    }

    function isGlassPanel(el, rect) {
        if (el === document.body || el === document.documentElement) return false;
        if (rect.width < 100 || rect.height < 44) return false;
        // Keep full-page canvases clear so the wallpaper remains visible.
        if (rect.width > window.innerWidth * 0.95 && rect.height > window.innerHeight * 0.88) return false;
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

    function isMainPageContainer(el, rect) {
        if (el === document.body || el === document.documentElement) return true;
        if (/^(MAIN|YTD-APP|YTD-PAGE-MANAGER|YTD-BROWSE)$/i.test(el.tagName)) return true;
        if (rect.width >= window.innerWidth * 0.8 && rect.height >= window.innerHeight * 0.6) {
            const idOrClass = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
            if (/(?:^|[\s_-])(app|root|main|page|wrapper|layout|container|content-wrapper|browse|content|feed|shell|canvas|view|columns|primary)(?:[\s_-]|$)/.test(idOrClass)) {
                return true;
            }
            if (rect.width >= window.innerWidth * 0.92 && rect.height >= window.innerHeight * 0.85) {
                return true;
            }
        }
        return false;
    }

    function isRootCanvasContainer(el, rect) {
        if (el === document.body || el === document.documentElement) return true;
        // Hanya container dasar paling luar (langsung di bawah body) yang mencakup layar penuh
        if (rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.8) {
            const tagName = el.tagName.toLowerCase();
            const idOrClass = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
            if (el.parentElement === document.body) {
                if (tagName === 'ytd-app' || el.id === 'root' || el.id === 'app' || el.id === '__next') return true;
                return /(?:^|[\s_-])(app|root|ytd-app|page-manager|layout|shell|__next)(?:[\s_-]|$)/.test(idOrClass);
            }
            // Canvas wrapper bertingkat pada SPA besar seperti YouTube
            if (tagName === 'ytd-page-manager' || tagName === 'ytd-browse' || el.id === 'page-manager') {
                return true;
            }
        }
        return false;
    }

    function tagSurfaces(root = document.body) {
        if (!root) return;
        // Keep existing surface attributes in place without unnecessary churn.
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let el;
        while ((el = walker.nextNode())) {
            if (isProtectedSurface(el)) {
                if (el.hasAttribute(SURFACE_ATTR)) el.removeAttribute(SURFACE_ATTR);
                if (!el.hasAttribute(SAFE_ATTR)) el.setAttribute(SAFE_ATTR, '');
                continue;
            }
            const rect = el.getBoundingClientRect();
            if (rect.width < 48 || rect.height < 28) {
                if (el.hasAttribute(SURFACE_ATTR)) el.removeAttribute(SURFACE_ATTR);
                if (!el.hasAttribute(SAFE_ATTR)) el.setAttribute(SAFE_ATTR, '');
                continue;
            }
            const css = getComputedStyle(el);
            // Sites often render avatars and artwork as CSS background images.
            // Keep those surfaces and their children exactly as the site draws them.
            if (/(?:url\(|(?:-webkit-)?image-set\()/i.test(css.backgroundImage)) {
                if (el.hasAttribute(SURFACE_ATTR)) el.removeAttribute(SURFACE_ATTR);
                if (!el.hasAttribute(SAFE_ATTR)) el.setAttribute(SAFE_ATTR, '');
                continue;
            }
            if (isForegroundLayer(el, css, rect)) {
                if (el.hasAttribute(SURFACE_ATTR)) el.removeAttribute(SURFACE_ATTR);
                if (!el.hasAttribute(SAFE_ATTR)) el.setAttribute(SAFE_ATTR, '');
                continue;
            }
            const hasBackground = css.backgroundImage !== 'none' ||
                (css.backgroundColor !== 'transparent' && css.backgroundColor !== 'rgba(0, 0, 0, 0)');
            if (!hasBackground && el !== document.body) continue;

            const isMainContainer = isMainPageContainer(el, rect) || isRootCanvasContainer(el, rect);

            if (isMainContainer) {
                if (el.getAttribute(SURFACE_ATTR) !== 'clear') el.setAttribute(SURFACE_ATTR, 'clear');
                if (el.hasAttribute(SAFE_ATTR)) el.removeAttribute(SAFE_ATTR);
            } else if (isGlassPanel(el, rect)) {
                const surface = shouldBlurSurface(el, rect, css) ? 'frosted' : 'glass';
                if (el.getAttribute(SURFACE_ATTR) !== surface) el.setAttribute(SURFACE_ATTR, surface);
                if (el.hasAttribute(SAFE_ATTR)) el.removeAttribute(SAFE_ATTR);
            } else {
                if (currentSettings.extraTransparent) {
                    if (el.getAttribute(SURFACE_ATTR) !== 'clear') el.setAttribute(SURFACE_ATTR, 'clear');
                    if (el.hasAttribute(SAFE_ATTR)) el.removeAttribute(SAFE_ATTR);
                } else {
                    if (el.hasAttribute(SURFACE_ATTR)) el.removeAttribute(SURFACE_ATTR);
                    if (!el.hasAttribute(SAFE_ATTR)) el.setAttribute(SAFE_ATTR, '');
                }
            }
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
                if (current.getAttribute(SURFACE_ATTR) === 'clear' && !current.hasAttribute(SAFE_ATTR)) {
                    current = current.parentElement;
                    continue;
                }
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
                    el.closest('button, a, label, [role="button"]')) {
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
        const glassTag = document.getElementById(GLASS_STYLE_ID);
        if (!glassTag) return;

        const [r, g, b] = getDimColorRgb();
        let surfaceRules = '';

        if (currentSettings.extraTransparent) {
            // Mode Extra Transparant: versi sebelum update (EXTREME TRANSPARENT)
            // Semua surface [data-wallpaper-surface] menjadi transparan tembus ke wallpaper
            const tint = `rgba(${r},${g},${b},0.75)`;
            surfaceRules = `
            html, body {
                background-color: transparent !important;
                background-image: none !important;
            }
            [${SURFACE_ATTR}] {
                background-color: transparent !important;
                background-image: none !important;
            }
            [${SURFACE_ATTR}="glass"], [${SURFACE_ATTR}="frosted"] {
                background-color: ${tint} !important;
                background-image: none !important;
            }
            [${SURFACE_ATTR}="frosted"] {
                -webkit-backdrop-filter: blur(5px) saturate(135%);
                backdrop-filter: blur(5px) saturate(135%);
            }
            [${SAFE_ATTR}],
            [${SAFE_ATTR}] * {
                -webkit-backdrop-filter: none !important;
                backdrop-filter: none !important;
            }
            `;
        } else {
            // Mode Normal (seperti versi extra transparant sekarang):
            // Glass UI elegan: panel-panel yang eligible menjadi semi-transparan dengan blur,
            // container utama clear, dan elemen lain tetap normal/solid
            const tint = `rgba(${r},${g},${b},0.75)`;
            surfaceRules = `
            html, body {
                background-color: transparent !important;
                background-image: none !important;
            }
            [${SURFACE_ATTR}="clear"]:not([${SAFE_ATTR}]) {
                background-color: transparent !important;
                background-image: none !important;
            }
            [${SURFACE_ATTR}="glass"]:not([${SAFE_ATTR}]),
            [${SURFACE_ATTR}="frosted"]:not([${SAFE_ATTR}]) {
                background-color: ${tint} !important;
                background-image: none !important;
            }
            [${SURFACE_ATTR}="frosted"]:not([${SAFE_ATTR}]) {
                -webkit-backdrop-filter: blur(5px) saturate(135%);
                backdrop-filter: blur(5px) saturate(135%);
            }
            [${SAFE_ATTR}],
            [${SAFE_ATTR}] * {
                -webkit-backdrop-filter: none !important;
                backdrop-filter: none !important;
            }
            `;
        }

        const css = `
            ${surfaceRules}
            @media (prefers-reduced-motion: no-preference) {
                ${currentSettings.animationsEnabled ? `
                button, [role="button"] { 
                    transition: transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.15), box-shadow 0.22s ease !important; 
                }
                button:hover, [role="button"]:hover { 
                    transform: translateY(-2px) scale(1.03) !important; 
                    box-shadow: 0 6px 16px rgba(0,0,0,0.18) !important;
                }
                button:active, [role="button"]:active { 
                    transform: translateY(1px) scale(0.97) !important; 
                }
                /* Animasi entrance pop up dan modal di website: bounce proporsional & halus kembali ke posisi semula */
                ${MODAL_SELECTOR} {
                    animation: webPopupEntrance 0.45s cubic-bezier(0.16, 1, 0.3, 1) both !important;
                }
                @keyframes webPopupEntrance {
                    0% {
                        opacity: 0;
                        transform: scale(0.88) translateY(-18px);
                        filter: blur(2px);
                    }
                    60% {
                        opacity: 1;
                        transform: scale(1.03) translateY(2px);
                        filter: blur(0px);
                    }
                    82% {
                        transform: scale(0.99) translateY(-1px);
                    }
                    100% {
                        opacity: 1;
                        transform: scale(1) translateY(0);
                        filter: none;
                    }
                }` : ''}
            }
        `;
        if (glassTag.textContent !== css) glassTag.textContent = css;
    }

    /** ==================== APPLY ==================== */
    function apply(forceReset = true) {
        initStyleTags();

        if (!currentSettings.isEnabled || !isSiteAllowed()) {
            resetEffects(true);
            return;
        }

        // Reset tagging without reloading media.
        if (forceReset) {
            resetEffects(false);
        }

        // Apply transparency and styling
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
                hasAnimatedCurrentMedia = false;
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
                                if (!hasAnimatedCurrentMedia) {
                                    hasAnimatedCurrentMedia = true;
                                    animateBackground(bgVideo);
                                }
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
                            if (!hasAnimatedCurrentMedia) {
                                hasAnimatedCurrentMedia = true;
                                animateBackground(bgImage);
                            }
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
                if (isVideoMedia && hasChanged) {
                    bgVideo.contentWindow.postMessage({ type: 'update-video' }, '*');
                }
            } catch (e) { }
        }
        if (bgOverlay) {
            bgOverlay.style.backgroundColor = getDimColorCss();
            bgOverlay.style.opacity = parseFloat(currentSettings.dimLevel ?? 0.5);
        }
    }

    function animateBackground(media) {
        if (!currentSettings.animationsEnabled || !media?.animate ||
            window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        try {
            if (media.getAnimations) {
                media.getAnimations().forEach(a => a.cancel());
            }
        } catch (e) { }

        // Animasi reveal dengan bounce yang proporsional & smooth, lalu kembali normal ke posisi awal
        const keyframes = [
            { clipPath: 'circle(0% at 50% 50%)', transform: 'scale(1.12)', opacity: 0 },
            { clipPath: 'circle(90% at 50% 50%)', transform: 'scale(1.02)', opacity: 1, offset: 0.52 },
            { clipPath: 'circle(84% at 50% 50%)', transform: 'scale(1.04)', opacity: 1, offset: 0.74 },
            { clipPath: 'circle(150% at 50% 50%)', transform: 'scale(1)', opacity: 1, offset: 1.0 }
        ];

        const anim = media.animate(keyframes, {
            duration: 750,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards'
        });

        anim.onfinish = () => {
            media.style.clipPath = 'none';
            media.style.transform = 'none';
        };
    }

    function refreshRoute() {
        if (location.href === lastRouteUrl) return;
        lastRouteUrl = location.href;
        fetchSettings(() => {
            apply(false);
        });
    }

    /** ==================== OBSERVER ==================== */
    const debouncedApply = debounce(() => {
        if (!currentSettings.isEnabled || !isSiteAllowed()) return;

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
            if (!currentSettings.isEnabled || !isSiteAllowed()) return;

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
            attributeFilter: ["class", "style", "id", "dark", "data-theme", "data-color-mode", "theme", "color-scheme"]
        });
    }

    /** ==================== PERSISTENCE PULSE ==================== */
    // Websites like YouTube/Gmail often nuke or override styles. 
    // This "pulse" ensures our critical elements stay alive and at the correct positions.
    function startPersistencePulse() {
        setInterval(() => {
            if (!currentSettings.isEnabled || !isSiteAllowed()) return;

            // 1. Ensure Container & Styles are still in DOM and correctly placed
            initStyleTags();
            if (isTopFrame) {
                initContainer();
                if (bgContainer && bgContainer.style.opacity === '0' && currentSettings.isEnabled) {
                    bgContainer.style.opacity = '1';
                }
            }

            // 2. Secondary check for styles
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

        if (chrome?.runtime?.onMessage) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                if (message?.type === 'FORCE_APPLY_SETTINGS') {
                    if (message.settings) {
                        currentSettings = Object.assign({}, currentSettings, message.settings);
                    }
                    apply(true);
                    sendResponse?.({ status: 'ok' });
                }
            });
        }

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                fetchSettings(() => apply(false));
            }
        });

        const runAutoApply = () => fetchSettings(() => apply(true));
        const refreshDomEffects = () => {
            if (currentSettings.isEnabled && isSiteAllowed()) {
                tagSurfaces();
                applyGlassStep();
                applyTextColorCorrection();
            }
        };

        if (document.readyState === "complete" || document.readyState === "interactive") {
            runAutoApply();
        } else {
            window.addEventListener("DOMContentLoaded", runAutoApply);
            window.addEventListener("load", () => setTimeout(runAutoApply, 100));
        }

        // Auto-refresh for dynamic SPAs and client-side rendered frameworks (React, Vue, Next.js, YouTube, etc.)
        [250, 600, 1200, 2500].forEach(delay => {
            setTimeout(refreshDomEffects, delay);
        });

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
