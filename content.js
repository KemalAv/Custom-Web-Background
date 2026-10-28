(() => {
    const BG_CONTAINER_ID = 'universal-bg-container';
    const STYLE_TAG_ID = 'universal-bg-styles';
    const GLASS_STYLE_ID = 'glass-style';
    const SAFE_ATTR = 'data-wallpaper-protected';
    const SURFACE_ATTR = 'data-wallpaper-surface';
    const isTopFrame = window.self === window.top;

    const LIGHT_SETTINGS_KEYS = [
        'isEnabled', 'uiMode', 'extraTransparent', 'transparencyLevel',
        'siteMode', 'specificSites', 'autoTextColor', 'animationsEnabled',
        'mediaType', 'dimLevel', 'blurIntensity', 'dimColor',
        'autoDarkColor', 'autoLightColor', 'customDimColor',
        'imageUrl', 'imageName', 'bakedImage', 'bakedImageDark', 'bakedImageLight'
    ];

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
    let evaluatedElements = new WeakSet();
    const originalTextColors = new WeakMap();

    const scheduleIdle = window.requestIdleCallback
        ? (cb) => window.requestIdleCallback(cb, { timeout: 500 })
        : (cb) => setTimeout(cb, 32);

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
    function normalizeSettings(settings) {
        const s = settings || {};
        s.isEnabled = s.isEnabled ?? true;
        s.extraTransparent = s.extraTransparent ?? false;
        s.transparencyLevel = Number(s.transparencyLevel) || (s.extraTransparent ? 3 : 1);
        s.siteMode = s.siteMode || 'all';
        s.specificSites = s.specificSites || [];
        s.autoTextColor = s.autoTextColor ?? false;
        s.animationsEnabled = s.animationsEnabled ?? false;
        s.mediaType = s.mediaType || 'image';
        s.dimLevel = s.dimLevel ?? 0.75;
        s.blurIntensity = s.blurIntensity ?? 0;
        s.dimColor = s.dimColor || 'auto';
        s.autoDarkColor = s.autoDarkColor || '#000000';
        s.autoLightColor = s.autoLightColor || '#ffffff';
        return s;
    }

    /**
     * Fetch settings without pulling multi-megabyte raw `imageDataUrl` unless
     * unbaked image/GIF fallback is actually needed.
     */
    function fetchSettings(callback) {
        try {
            if (!chrome?.runtime?.id) return;
            if (!isTopFrame) {
                chrome.storage.local.get(['isEnabled', 'siteMode', 'specificSites'], (settings) => {
                    currentSettings = normalizeSettings(settings);
                    callback?.();
                });
                return;
            }

            chrome.storage.local.get(LIGHT_SETTINGS_KEYS, (settings) => {
                currentSettings = normalizeSettings(settings);
                const hasBaked = Boolean(
                    currentSettings.bakedImage ||
                    currentSettings.bakedImageDark ||
                    currentSettings.bakedImageLight
                );
                const isVideo = currentSettings.mediaType === 'video';

                if (!isVideo && !hasBaked && !currentSettings.imageUrl) {
                    chrome.storage.local.get(['imageDataUrl'], (rawRes) => {
                        currentSettings.imageDataUrl = rawRes?.imageDataUrl || null;
                        if (!currentSettings.imageUrl && !currentSettings.imageDataUrl) {
                            currentSettings.imageUrl = 'icons/background.png';
                        }
                        callback?.();
                    });
                } else {
                    if (!isVideo && !hasBaked && !currentSettings.imageUrl) {
                        currentSettings.imageUrl = 'icons/background.png';
                    }
                    callback?.();
                }
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
        if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
        try {
            const arr = dataUrl.split(',');
            const mimeMatch = arr[0].match(/:(.*?);/);
            if (!mimeMatch) return dataUrl;
            const mime = mimeMatch[1];

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

        if (html) {
            if (html.hasAttribute('dark')) {
                const val = html.getAttribute('dark');
                if (val === '' || val === 'true' || val === 'dark') return true;
                if (val === 'false') return false;
            }
        }

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

        const classStr = `${html?.className || ''} ${body?.className || ''}`.toLowerCase();
        if (/(?:^|\s)(?:dark|theme-dark|dark-theme|dark-mode|mode-dark)(?:\s|$)/.test(classStr)) return true;
        if (/(?:^|\s)(?:light|theme-light|light-theme|light-mode|mode-light)(?:\s|$)/.test(classStr)) return false;

        try {
            if (html) {
                const cs = getComputedStyle(html).colorScheme;
                if (cs === 'dark') return true;
                if (cs === 'light') return false;
            }
        } catch (e) { }

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

        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function hexToRgb(hex, fallback = [0, 0, 0]) {
        if (!hex) return fallback;
        const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
        if (match) {
            return [
                parseInt(match[1], 16),
                parseInt(match[2], 16),
                parseInt(match[3], 16)
            ];
        }
        return fallback;
    }

    function getDimColorRgb() {
        const dimColor = currentSettings.dimColor || 'auto';
        if (dimColor === 'white' || dimColor === 'light') {
            return hexToRgb(currentSettings.autoLightColor, [255, 255, 255]);
        }
        if (dimColor === 'black' || dimColor === 'dark') {
            return hexToRgb(currentSettings.autoDarkColor, [0, 0, 0]);
        }
        if (dimColor === 'custom') {
            return hexToRgb(currentSettings.customDimColor, [0, 0, 0]);
        }
        const isDark = isPageDarkTheme();
        if (isDark) {
            return hexToRgb(currentSettings.autoDarkColor, [0, 0, 0]);
        } else {
            return hexToRgb(currentSettings.autoLightColor, [255, 255, 255]);
        }
    }

    function getDimColorCss(alpha) {
        const [r, g, b] = getDimColorRgb();
        return typeof alpha === 'number' ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
    }

    function isDimColorDark() {
        const [r, g, b] = getDimColorRgb();
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
    }

    /**
     * Clean image blur without any zoom or scale transform.
     */
    function applyImageBlur(el, blurPx) {
        if (!el) return;
        const blur = Math.max(0, Number(blurPx) || 0);
        el.style.top = '0';
        el.style.left = '0';
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.objectFit = 'cover';
        el.style.transform = blur > 0 ? 'scale(1.06) translateZ(0)' : 'translateZ(0)';
        el.style.filter = blur > 0 ? `blur(${blur}px)` : 'none';
        el.style.webkitFilter = blur > 0 ? `blur(${blur}px)` : 'none';
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
                transform: 'translateZ(0)',
                contain: 'strict',
            });

            bgImage = document.createElement('img');
            bgImage.decoding = 'async';
            Object.assign(bgImage.style, {
                position: 'absolute', top: 0, left: 0,
                width: '100%', height: '100%',
                objectFit: 'cover', opacity: 0,
                transition: 'none',
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
                willChange: 'transform, filter, opacity',
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
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
            });
            bgVideo.style.contain = 'strict';
            bgVideo.style.willChange = 'opacity';
            bgVideo.allow = 'autoplay';
            bgVideo.setAttribute('allowtransparency', 'true');

            bgOverlay = document.createElement('div');
            bgOverlay.id = 'universal-bg-overlay';
            Object.assign(bgOverlay.style, {
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                display: 'block', opacity: 1,
                transition: 'none',
                pointerEvents: 'none',
                zIndex: 2,
            });
            bgImage.style.zIndex = 1;
            bgVideo.style.zIndex = 1;

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
        evaluatedElements = new WeakSet();
        if (styleTag) styleTag.textContent = '';
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
        const tagged = document.querySelectorAll(`[data-bg-color], [${SAFE_ATTR}], [${SURFACE_ATTR}], [data-glass-color]`);
        tagged.forEach(el => {
            el.removeAttribute('data-bg-color');
            el.removeAttribute(SAFE_ATTR);
            el.removeAttribute(SURFACE_ATTR);
            if (el.hasAttribute('data-glass-color')) {
                restoreTextColor(el);
            }
        });
    }

    /** Surfaces that can display the glass effect. */
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
        if (isNavigationSurface(el)) return false;
        if (css.position === 'fixed' || css.position === 'sticky') return true;
        const zIndex = Number.parseInt(css.zIndex, 10);
        return css.position === 'absolute' && zIndex > 10 && rect.width > 80 && rect.height > 30;
    }

    function isGlassPanel(el, rect) {
        if (el === document.body || el === document.documentElement) return false;
        if (rect.width < 100 || rect.height < 44) return false;
        if (rect.width > window.innerWidth * 0.95 && rect.height > window.innerHeight * 0.88) return false;
        if (el.parentElement?.closest(`[${SURFACE_ATTR}="glass"], [${SURFACE_ATTR}="frosted"]`)) return false;
        return true;
    }

    function shouldBlurSurface(el, rect, css) {
        if (isNavigationSurface(el)) return true;
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
        if (rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.8) {
            const tagName = el.tagName.toLowerCase();
            const idOrClass = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
            if (el.parentElement === document.body) {
                if (tagName === 'ytd-app' || el.id === 'root' || el.id === 'app' || el.id === '__next') return true;
                return /(?:^|[\s_-])(app|root|ytd-app|page-manager|layout|shell|__next)(?:[\s_-]|$)/.test(idOrClass);
            }
            if (tagName === 'ytd-page-manager' || tagName === 'ytd-browse' || el.id === 'page-manager') {
                return true;
            }
        }
        return false;
    }

    function tagSurfaces(root = document.body, incremental = false) {
        if (!root || !isTopFrame) return;

        const isLvl2 = currentSettings.transparencyLevel === 2;
        const isLvl3 = currentSettings.transparencyLevel === 3;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                const tag = node.tagName;
                if (/^(SCRIPT|STYLE|META|LINK|NOSCRIPT|SVG|PATH|P|SPAN|B|I|STRONG|EM|SMALL|MARK|A|BUTTON|INPUT|LABEL|TEXTAREA|SELECT|OPTION|OPTGROUP|BR|HR|IMG|VIDEO|AUDIO|CANVAS|IFRAME|CODE|PRE)$/.test(tag)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let el;
        let count = 0;
        const maxElements = isLvl3 ? (incremental ? 1500 : 3500) : (incremental ? 500 : 1000);
        while ((el = walker.nextNode()) && count < maxElements) {
            if (incremental && evaluatedElements.has(el)) {
                continue;
            }
            evaluatedElements.add(el);
            count++;

            if (isProtectedSurface(el)) {
                if (el.hasAttribute(SURFACE_ATTR)) el.removeAttribute(SURFACE_ATTR);
                if (!el.hasAttribute(SAFE_ATTR)) el.setAttribute(SAFE_ATTR, '');
                continue;
            }
            const rect = el.getBoundingClientRect();
            const minW = isLvl3 ? 32 : 48;
            const minH = isLvl3 ? 20 : 28;
            if (rect.width < minW || rect.height < minH) {
                if (el.hasAttribute(SURFACE_ATTR)) el.removeAttribute(SURFACE_ATTR);
                if (!el.hasAttribute(SAFE_ATTR)) el.setAttribute(SAFE_ATTR, '');
                continue;
            }
            const css = getComputedStyle(el);
            if (/(?:url\(|(?:-webkit-)?image-set\()/i.test(css.backgroundImage)) {
                if (el.hasAttribute(SURFACE_ATTR)) el.removeAttribute(SURFACE_ATTR);
                if (!el.hasAttribute(SAFE_ATTR)) el.setAttribute(SAFE_ATTR, '');
                continue;
            }
            if (isForegroundLayer(el, css, rect)) {
                const isRealModal = isProtectedSurface(el) || /(?:^|[\s_-])(composer|modal|dialog|popover|dropdown|tooltip|toast|portal|drawer)(?:[\s_-]|$)/.test(
                    `${el.id} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase()
                );
                if (isLvl3 && !isRealModal) {
                    if (el.getAttribute(SURFACE_ATTR) !== 'clear') el.setAttribute(SURFACE_ATTR, 'clear');
                    if (el.hasAttribute(SAFE_ATTR)) el.removeAttribute(SAFE_ATTR);
                    continue;
                }
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
                if (isLvl3 && !isNavigationSurface(el)) {
                    if (el.getAttribute(SURFACE_ATTR) !== 'clear') el.setAttribute(SURFACE_ATTR, 'clear');
                    if (el.hasAttribute(SAFE_ATTR)) el.removeAttribute(SAFE_ATTR);
                } else {
                    const surface = shouldBlurSurface(el, rect, css) ? 'frosted' : 'glass';
                    if (el.getAttribute(SURFACE_ATTR) !== surface) el.setAttribute(SURFACE_ATTR, surface);
                    if (el.hasAttribute(SAFE_ATTR)) el.removeAttribute(SAFE_ATTR);
                }
            } else {
                const bigEnough = rect.width >= 320 && rect.height >= 140;
                if ((isLvl2 && bigEnough) || isLvl3) {
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
        return saturation < 0.28;
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
            const colored = document.querySelectorAll('[data-glass-color]');
            if (colored.length > 0) colored.forEach(restoreTextColor);
            return;
        }

        const lightTextOnWallpaper = isDimColorDark();
        const candidates = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, li, dt, dd, td, th');
        let processed = 0;
        for (let i = 0; i < candidates.length && processed < 600; i++) {
            const el = candidates[i];
            try {
                if (el.matches(CONTROL_SELECTOR) ||
                    el.closest('button, a, label, [role="button"]')) {
                    if (el.hasAttribute('data-glass-color')) restoreTextColor(el);
                    continue;
                }
                if (el.children.length === 0 && !el.textContent.trim()) continue;
                processed++;
                const rgb = getComputedStyle(el).color.match(/\d+/g)?.slice(0, 3).map(Number);
                if (!rgb || rgb.length !== 3 || !isNeutralColor(rgb)) continue;

                const bg = getEffectiveBackgroundColor(el);
                const hasPanel = bg && (bg.length < 4 || bg[3] > 0.5);

                const panelLuminance = hasPanel
                    ? (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255 : null;
                const target = (hasPanel ? panelLuminance < 0.54 : lightTextOnWallpaper)
                    ? 'white' : 'black';
                if (el.getAttribute('data-glass-color') !== target) setTextColor(el, target);
            } catch { }
        }
    }

    function applyGlassStep() {
        const glassTag = document.getElementById(GLASS_STYLE_ID);
        if (!glassTag) return;

        const [r, g, b] = getDimColorRgb();
        const isVideoMedia = currentSettings.mediaType === 'video';
        const blurVal = Number(currentSettings.blurIntensity ?? 0);
        const dimVal = Number(currentSettings.dimLevel ?? 0.75);

        const useFrostedBackdrop = !isVideoMedia && blurVal < 4 && dimVal < 0.70;
        const backdropRule = useFrostedBackdrop
            ? '-webkit-backdrop-filter: blur(4px);\n                backdrop-filter: blur(4px);'
            : '';

        let surfaceRules = '';

        if (currentSettings.transparencyLevel === 3) {
            // Level 3 (Transparant)
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
            ${backdropRule ? `[${SURFACE_ATTR}="frosted"] {\n                ${backdropRule}\n            }` : ''}
            [${SAFE_ATTR}],
            [${SAFE_ATTR}] * {
                -webkit-backdrop-filter: none !important;
                backdrop-filter: none !important;
            }
            `;
        } else if (currentSettings.transparencyLevel === 1) {
            // Level 1: Non Transparant
            surfaceRules = `
            html, body {
                background-color: transparent !important;
                background-image: none !important;
            }
            [${SURFACE_ATTR}="clear"]:not([${SAFE_ATTR}]) {
                background-color: transparent !important;
                background-image: none !important;
            }
            [${SAFE_ATTR}],
            [${SAFE_ATTR}] * {
                -webkit-backdrop-filter: none !important;
                backdrop-filter: none !important;
            }
            `;
        } else {
            // Level 2 (Glass UI - semi transparan 0.5 + blur 10px)
            const tint = `rgba(${r},${g},${b},0.5)`;
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
                -webkit-backdrop-filter: blur(10px) !important;
                backdrop-filter: blur(10px) !important;
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

    /** Resolve pre-baked image for current theme if available */
    function getPreBakedSource() {
        if (currentSettings.dimColor === 'auto') {
            const isDark = isPageDarkTheme();
            return isDark ? currentSettings.bakedImageDark : currentSettings.bakedImageLight;
        }
        if (currentSettings.dimColor === 'dark') {
            return currentSettings.bakedImage || currentSettings.bakedImageDark;
        }
        if (currentSettings.dimColor === 'light') {
            return currentSettings.bakedImage || currentSettings.bakedImageLight;
        }
        return currentSettings.bakedImage || null;
    }

    /** ==================== APPLY ==================== */
    function apply(forceReset = true) {
        initStyleTags();

        if (!currentSettings.isEnabled || !isSiteAllowed()) {
            resetEffects(true);
            return;
        }

        if (forceReset) {
            resetEffects(false);
        }

        tagSurfaces(document.body, !forceReset);
        applyGlassStep();
        applyTextColorCorrection();

        if (!isTopFrame) return;
        initContainer();

        const preBakedSrc = getPreBakedSource();
        const isVideoMedia = (currentSettings.mediaType === 'video') ||
            /\.mp4(\?|$)/i.test(currentSettings.imageUrl || '') ||
            (currentSettings.imageDataUrl && currentSettings.imageDataUrl.startsWith('data:video/'));

        const rawSrc = currentSettings.imageUrl ||
            currentSettings.imageDataUrl ||
            (preBakedSrc ? '__prebaked__' : (isVideoMedia ? '__video__' : 'icons/background.png'));
        const imgSrc = rawSrc === 'icons/background.png'
            ? chrome.runtime.getURL('icons/background.png') : rawSrc;
        const imgName = currentSettings.imageName || '';
        const imgLen = imgSrc.length;

        bgContainer.style.transition = 'none';
        bgImage.style.transition = 'none';
        bgVideo.style.transition = 'none';
        // bgOverlay enabled

        const dimAlpha = Math.max(0, Math.min(1, parseFloat(currentSettings.dimLevel ?? 0.75)));
        const blurAmount = Math.max(0, Number(currentSettings.blurIntensity || 0));
        const [dimR, dimG, dimB] = getDimColorRgb();

        bgContainer.style.backgroundColor = `rgb(${dimR},${dimG},${dimB})`;
        bgContainer.style.opacity = '1';

        if (bgOverlay) {
            bgOverlay.style.display = 'block';
            bgOverlay.style.opacity = '1';
            bgOverlay.style.backgroundColor = `rgba(${dimR},${dimG},${dimB},${dimAlpha})`;
        }
        const mediaOpacity = '1';

        if (imgSrc) {
            const isHeavy = imgLen > 10000000;

            if (isVideoMedia) {
                const videoKey = `${currentSettings.imageUrl || ''}|${currentSettings.imageName || ''}|video`;
                const hasChanged = videoKey !== lastRequestedSrc ||
                    currentSettings.mediaType !== lastRequestedType;

                if (hasChanged) {
                    lastRequestedSrc = videoKey;
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

                    // === VIDEO MODE ===
                    bgImage.style.opacity = '0';
                    bgImage.src = '';

                    try {
                        const videoPageUrl = chrome.runtime.getURL('video-bg.html');
                        const showVideo = () => {
                            if (loadSessionId === currentSession) {
                                lastLoadedSrc = videoKey;
                                pendingHeavyLoad = false;
                                if (pageSpinner) pageSpinner.classList.remove('visible');
                                clearTimeout(pendingLoadTimer);
                                bgVideo.style.opacity = mediaOpacity;
                                if (bgVideo.contentWindow) {
                                    try {
                                        bgVideo.contentWindow.postMessage({
                                            type: 'set-blur',
                                            blur: Number(currentSettings.blurIntensity || 0)
                                        }, '*');
                                        bgVideo.contentWindow.postMessage({
                                            type: 'set-dim-paused',
                                            paused: dimAlpha >= 0.99
                                        }, '*');
                                    } catch (e) { }
                                }
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
                            showVideo();
                            if (bgVideo.contentWindow) {
                                try {
                                    bgVideo.contentWindow.postMessage({ type: 'update-video' }, '*');
                                } catch (e) { }
                            }
                        }
                    } catch (e) {
                        console.error('Video iframe setup failed:', e);
                    }
                } else if (!pendingHeavyLoad) {
                    bgVideo.style.opacity = mediaOpacity;
                }

                if (bgVideo && bgVideo.contentWindow) {
                    try {
                        bgVideo.contentWindow.postMessage({
                            type: 'set-blur',
                            blur: Number(currentSettings.blurIntensity || 0)
                        }, '*');
                        bgVideo.contentWindow.postMessage({
                            type: 'set-dim-paused',
                            paused: dimAlpha >= 0.99
                        }, '*');
                    } catch (e) { }
                }
            } else {
                // === IMAGE / GIF MODE ===
                bgVideo.style.opacity = '0';
                if (bgVideo.hasAttribute('src')) bgVideo.removeAttribute('src');

                const activeSrc = preBakedSrc || (imgSrc.startsWith('data:') ? (currentBlobUrl = dataUrlToBlobUrl(imgSrc)) : imgSrc);

                if (currentBlobUrl && preBakedSrc) {
                    URL.revokeObjectURL(currentBlobUrl);
                    currentBlobUrl = null;
                }

                const targetOpacity = preBakedSrc ? '1' : mediaOpacity;

                const hasImageChanged = activeSrc !== lastLoadedSrc ||
                    imgSrc !== lastRequestedSrc ||
                    currentSettings.mediaType !== lastRequestedType ||
                    bgImage.src !== activeSrc;

                if (hasImageChanged) {
                    lastRequestedSrc = imgSrc;
                    lastRequestedType = currentSettings.mediaType;
                    lastLoadedLength = imgLen;
                    lastLoadedName = imgName;
                    const currentSession = ++loadSessionId;

                    if (isHeavy && !preBakedSrc) {
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

                    bgImage.onerror = () => {
                        if (loadSessionId === currentSession) {
                            const fallback = chrome.runtime.getURL('icons/background.png');
                            if (bgImage.src !== fallback) {
                                bgImage.src = fallback;
                                return;
                            }
                            pendingHeavyLoad = false;
                            pageSpinner?.classList.remove('visible');
                            lastLoadedLength = 0;
                            lastLoadedName = '';
                            lastRequestedSrc = '';
                            lastLoadedSrc = '';
                        }
                    };

                    bgImage.onload = () => {
                        if (loadSessionId === currentSession) {
                            lastLoadedSrc = activeSrc;
                            pendingHeavyLoad = false;
                            if (pageSpinner) pageSpinner.classList.remove('visible');
                            clearTimeout(pendingLoadTimer);
                            bgImage.style.opacity = targetOpacity;
                            if (!hasAnimatedCurrentMedia) {
                                hasAnimatedCurrentMedia = true;
                                animateBackground(bgImage);
                            }
                        }
                    };

                    bgImage.src = activeSrc;
                    lastLoadedSrc = activeSrc;
                    bgImage.style.opacity = targetOpacity;
                } else if (!pendingHeavyLoad) {
                    bgImage.style.opacity = targetOpacity;
                }

                applyImageBlur(bgImage, currentSettings.blurIntensity || 0);
            }
        }
    }

    /** Fast-path background, blur, and dim update */
    function updateBackgroundOnly() {
        if (!currentSettings.isEnabled || !isSiteAllowed()) {
            resetEffects(true);
            return;
        }

        applyGlassStep();

        if (!isTopFrame) return;
        initContainer();

        const preBakedSrc = getPreBakedSource();
        const isVideoMedia = (currentSettings.mediaType === 'video') ||
            /\.mp4(\?|$)/i.test(currentSettings.imageUrl || '') ||
            (currentSettings.imageDataUrl && currentSettings.imageDataUrl.startsWith('data:video/'));

        const rawSrc = currentSettings.imageUrl ||
            currentSettings.imageDataUrl ||
            (preBakedSrc ? '__prebaked__' : (isVideoMedia ? '__video__' : 'icons/background.png'));
        const imgSrc = rawSrc === 'icons/background.png'
            ? chrome.runtime.getURL('icons/background.png') : rawSrc;

        // bgOverlay enabled
        const dimAlpha = Math.max(0, Math.min(1, parseFloat(currentSettings.dimLevel ?? 0.75)));
        const blurAmount = Math.max(0, Number(currentSettings.blurIntensity || 0));
        const [dimR, dimG, dimB] = getDimColorRgb();

        bgContainer.style.backgroundColor = `rgb(${dimR},${dimG},${dimB})`;
        bgContainer.style.opacity = '1';

        if (bgOverlay) {
            bgOverlay.style.display = 'block';
            bgOverlay.style.opacity = '1';
            bgOverlay.style.backgroundColor = `rgba(${dimR},${dimG},${dimB},${dimAlpha})`;
        }
        const mediaOpacity = '1';

        if (isVideoMedia) {
            bgImage.style.opacity = '0';
            const videoPageUrl = chrome.runtime.getURL('video-bg.html');
            if (!bgVideo.src || !bgVideo.src.includes('video-bg.html')) {
                bgVideo.src = videoPageUrl;
            }
            bgVideo.style.opacity = mediaOpacity;
            if (bgVideo && bgVideo.contentWindow) {
                try {
                    bgVideo.contentWindow.postMessage({
                        type: 'set-blur',
                        blur: Number(currentSettings.blurIntensity || 0)
                    }, '*');
                    bgVideo.contentWindow.postMessage({
                        type: 'set-dim-paused',
                        paused: dimAlpha >= 0.99
                    }, '*');
                } catch (e) { }
            }
        } else {
            bgVideo.style.opacity = '0';
            if (bgVideo.hasAttribute('src')) bgVideo.removeAttribute('src');

            const activeSrc = preBakedSrc || (imgSrc.startsWith('data:') ? (currentBlobUrl = dataUrlToBlobUrl(imgSrc)) : imgSrc);

            if (currentBlobUrl && preBakedSrc) {
                URL.revokeObjectURL(currentBlobUrl);
                currentBlobUrl = null;
            }

            if (activeSrc && bgImage.src !== activeSrc) {
                bgImage.src = activeSrc;
                lastLoadedSrc = activeSrc;
            }

            bgImage.style.opacity = '1';
            applyImageBlur(bgImage, currentSettings.blurIntensity || 0);
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

        const keyframes = [
            { clipPath: 'circle(0% at 50% 50%)', opacity: 0 },
            { clipPath: 'circle(90% at 50% 50%)', opacity: media.style.opacity || 1, offset: 0.55 },
            { clipPath: 'circle(150% at 50% 50%)', opacity: media.style.opacity || 1, offset: 1.0 }
        ];

        const anim = media.animate(keyframes, {
            duration: 650,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards'
        });

        anim.onfinish = () => {
            media.style.clipPath = 'none';
        };
    }

    function refreshRoute() {
        if (location.href === lastRouteUrl) return;
        lastRouteUrl = location.href;
        evaluatedElements = new WeakSet();
        fetchSettings(() => {
            apply(false);
        });
    }

    /** ==================== OBSERVER ==================== */
    const debouncedApply = debounce(() => {
        if (!currentSettings.isEnabled || !isSiteAllowed()) return;
        scheduleIdle(() => {
            if (!currentSettings.isEnabled || !isSiteAllowed()) return;
            tagSurfaces(document.body, true);
            applyGlassStep();
            applyTextColorCorrection();
        });
    }, 400);

    const debouncedApplyTheme = debounce(() => {
        if (!currentSettings.isEnabled || !isSiteAllowed()) return;
        updateBackgroundOnly();
        applyGlassStep();
        applyTextColorCorrection();
    }, 200);

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
                if (mutation.target.id === BG_CONTAINER_ID ||
                    mutation.target.id === STYLE_TAG_ID ||
                    mutation.target.id === GLASS_STYLE_ID) continue;

                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
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
                    if (["dark", "data-theme", "data-color-mode", "theme", "color-scheme"].includes(mutation.attributeName)) {
                        debouncedApplyTheme();
                        continue;
                    }
                    if (mutation.target === document.documentElement || mutation.target === document.body) {
                        debouncedApplyTheme();
                        shouldUpdate = true;
                        break;
                    }
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
            attributeFilter: ["class", "id", "dark", "data-theme", "data-color-mode", "theme", "color-scheme"]
        });
    }

    /** ==================== PERSISTENCE PULSE ==================== */
    function startPersistencePulse() {
        if (!isTopFrame) return;

        setInterval(() => {
            if (!currentSettings.isEnabled || !isSiteAllowed()) return;
            initStyleTags();
            initContainer();
            if (bgContainer && bgContainer.style.opacity === '0' && currentSettings.isEnabled) {
                bgContainer.style.opacity = '1';
            }
        }, 4000);

        setInterval(() => {
            if (location.href !== lastRouteUrl) setTimeout(refreshRoute, 300);
        }, 1000);
    }

    /** ==================== INIT ==================== */
    function initialize() {
        if (!isTopFrame) {
            const applyIframe = () => {
                fetchSettings(() => {
                    if (currentSettings.isEnabled && isSiteAllowed()) {
                        let iframeStyle = document.getElementById('universal-bg-iframe');
                        if (!iframeStyle) {
                            iframeStyle = document.createElement('style');
                            iframeStyle.id = 'universal-bg-iframe';
                            (document.head || document.documentElement)?.appendChild(iframeStyle);
                        }
                        iframeStyle.textContent = 'html, body { background-color: transparent !important; background-image: none !important; }';
                    } else {
                        const iframeStyle = document.getElementById('universal-bg-iframe');
                        if (iframeStyle) iframeStyle.textContent = '';
                    }
                });
            };
            applyIframe();
            if (chrome?.storage?.onChanged) {
                chrome.storage.onChanged.addListener(() => applyIframe());
            }
            if (chrome?.runtime?.onMessage) {
                chrome.runtime.onMessage.addListener((message) => {
                    if (message?.type === 'FORCE_APPLY_SETTINGS') applyIframe();
                });
            }
            return;
        }

        // Langsung terapkan perubahan seketika (real-time) tanpa harus restart browser
        if (chrome?.storage?.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area && area !== 'local') return;
                lastLoadedSrc = '';
                lastRequestedSrc = '';
                fetchSettings(() => {
                    apply(true);
                    updateBackgroundOnly();
                });
            });
        }

        if (chrome?.runtime?.onMessage) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                if (message?.type === 'FORCE_APPLY_SETTINGS') {
                    lastLoadedSrc = '';
                    lastRequestedSrc = '';
                    if (message.settings) {
                        currentSettings = normalizeSettings(Object.assign({}, currentSettings, message.settings));
                        apply(true);
                        updateBackgroundOnly();
                    }
                    fetchSettings(() => {
                        apply(true);
                        updateBackgroundOnly();
                    });
                    sendResponse?.({ status: 'ok' });
                }
            });
        }

        document.addEventListener('visibilitychange', () => {
            const isHidden = document.visibilityState !== 'visible';
            if (bgVideo && bgVideo.contentWindow) {
                try {
                    bgVideo.contentWindow.postMessage({ type: 'visibility', hidden: isHidden }, '*');
                } catch (e) { }
            }
            if (!isHidden) {
                fetchSettings(() => updateBackgroundOnly());
            }
        });

        const runAutoApply = () => fetchSettings(() => apply(true));
        const refreshDomEffects = () => {
            if (currentSettings.isEnabled && isSiteAllowed()) {
                scheduleIdle(() => {
                    tagSurfaces(document.body, true);
                    applyGlassStep();
                    applyTextColorCorrection();
                });
            }
        };

        if (document.readyState === "complete" || document.readyState === "interactive") {
            runAutoApply();
        } else {
            window.addEventListener("DOMContentLoaded", runAutoApply);
            window.addEventListener("load", () => setTimeout(runAutoApply, 100));
        }

        [400, 1500].forEach(delay => {
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
            if (currentSettings.dimColor === 'auto') updateBackgroundOnly();
        });

        window.addEventListener('popstate', () => {
            setTimeout(refreshRoute, 200);
        });
    }

    initialize();
})();