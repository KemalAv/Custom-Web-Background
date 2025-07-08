(() => {
    const BG_CONTAINER_ID = 'universal-bg-container';
    const isTopFrame = window.self === window.top;
    let currentSettings = {};
    let bgContainer, bgImage, bgOverlay, styleTag;

    /** Helpers **/
    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(null, args), delay);
        };
    }

    function fetchSettings(callback) {
        try {
            if (!chrome?.runtime?.id) return;
            chrome.storage.local.get(null, (settings) => {
                currentSettings = settings || {};
                callback?.();
            });
        } catch { }
    }

    function initContainer() {
        if (bgContainer) return;

        bgContainer = document.createElement('div');
        bgContainer.id = BG_CONTAINER_ID;
        Object.assign(bgContainer.style, {
            position: 'fixed',
            top: 0, left: 0,
            width: '100vw', height: '100vh',
            zIndex: '-2147483647',
            pointerEvents: 'none',
            overflow: 'hidden',
            opacity: 0,
            transition: 'opacity 0.5s ease',
        });

        bgImage = document.createElement('img');
        Object.assign(bgImage.style, {
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0,
            transition: 'opacity 0.5s ease',
        });

        bgOverlay = document.createElement('div');
        Object.assign(bgOverlay.style, {
            position: 'absolute',
            inset: 0,
            opacity: 0,
            transition: 'opacity 0.5s ease',
        });

        bgContainer.append(bgImage, bgOverlay);
        document.documentElement.prepend(bgContainer);
    }

    function applyChromaKey() {
        if (!document.head) return;

        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'chroma-key-styles';
            document.head.appendChild(styleTag);
        }

        if (!currentSettings.isEnabled) {
            styleTag.textContent = '';
            return;
        }

        if (currentSettings.forceTransparent) {
            styleTag.textContent = `
                *:not(#${BG_CONTAINER_ID}):not(#${BG_CONTAINER_ID} *),
                body {
                    background: transparent !important;
                    background-color: transparent !important;
                    background-image: none !important;
                }
            `;
            return;
        }

        const colors = currentSettings.chromaKeyColors || [];
        if (colors.length === 0) {
            styleTag.textContent = '';
            return;
        }

        const rules = colors.map(color => `
            *[data-bg-color="${color}"] {
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
            }
        `).join('\n') + `
            body {
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
            }
        `;

        styleTag.textContent = rules;
    }

    function safeTagElements(root) {
        if (!root || !currentSettings.isEnabled || currentSettings.forceTransparent) return;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                if (
                    node.hasAttribute('data-bg-color') ||
                    node.closest('[data-reactroot], [data-react-checksum]')
                ) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        while (walker.nextNode()) {
            const el = walker.currentNode;
            try {
                const bg = getComputedStyle(el).backgroundColor;
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                    const [r, g, b] = bg.match(/\d+/g).map(Number);
                    const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b)
                        .toString(16)
                        .slice(1);
                    el.setAttribute('data-bg-color', hex.toLowerCase());
                }
            } catch { }
        }
    }

    /** Core Apply **/
    function apply() {
        const enabled = currentSettings.isEnabled !== false;
        applyChromaKey();

        if (enabled && !currentSettings.forceTransparent) {
            requestIdleCallback(() => safeTagElements(document.body), { timeout: 500 });
        }

        if (!isTopFrame) return;
        initContainer();

        if (enabled) {
            bgContainer.style.opacity = '1';
            const imgSrc = currentSettings.imageUrl || currentSettings.imageDataUrl || '';

            if (imgSrc && bgImage.src !== imgSrc) {
                bgImage.style.opacity = '0';
                setTimeout(() => {
                    bgImage.src = imgSrc;
                    bgImage.onload = () => {
                        bgImage.style.opacity = '1';
                    };
                }, 100);
            } else if (imgSrc) {
                bgImage.style.opacity = '1';
            } else {
                bgImage.style.opacity = '0';
            }

            bgImage.style.filter = currentSettings.blurIntensity ? `blur(${currentSettings.blurIntensity}px)` : 'none';
            bgOverlay.style.backgroundColor = currentSettings.dimColor === 'light' ? '#fff' : '#000';
            bgOverlay.style.opacity = currentSettings.dimLevel ?? 0;
        } else {
            bgContainer.style.opacity = '0';
        }
    }

    /** Observers **/
    const debouncedApply = debounce(() => fetchSettings(apply), 300);

    function observeMutations() {
        const startObserving = () => {
            const targetNode = document.body;
            if (!targetNode) {
                setTimeout(startObserving, 100);
                return;
            }

            const observer = new MutationObserver(() => {
                debouncedApply();
            });

            observer.observe(targetNode, { childList: true, subtree: true });
            window.addEventListener('pagehide', () => observer.disconnect());
        };
        startObserving();
    }

    function hijackSPA() {
        const trigger = () => setTimeout(() => fetchSettings(apply), 100);
        const origPush = history.pushState;
        const origReplace = history.replaceState;

        history.pushState = function (...args) {
            const res = origPush.apply(this, args);
            trigger();
            return res;
        };
        history.replaceState = function (...args) {
            const res = origReplace.apply(this, args);
            trigger();
            return res;
        };
        window.addEventListener('popstate', trigger);
    }

    /** Initialize **/
    function initialize() {
        const initApply = () => fetchSettings(apply);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initApply);
        } else {
            initApply();
        }

        window.addEventListener('load', initApply);
        setTimeout(initApply, 1000);

        observeMutations();
        hijackSPA();

        setInterval(() => {
            if (currentSettings.isEnabled && !currentSettings.forceTransparent) {
                requestIdleCallback(() => safeTagElements(document.body), { timeout: 500 });
            }
        }, 1500);

        if (chrome?.storage?.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local') debouncedApply();
            });
        }
    }

    /** Boot **/
    initialize();
})();
