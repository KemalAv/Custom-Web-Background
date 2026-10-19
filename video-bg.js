(() => {
    const video = document.getElementById('bgVideo');
    let currentBlobUrl = null;
    let lastLoadedVideoSrc = '';
    let hasAnimatedVideo = false;
    let currentBlur = 0;
    let isParentHidden = false;
    let isDimPaused = false;

    /**
     * Convert a data: URL into a blob: URL asynchronously via native fetch()
     * to avoid main-thread freezes and 3x memory spikes from atob().
     */
    async function dataUrlToBlobUrlAsync(dataUrl) {
        if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
        try {
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            return URL.createObjectURL(blob);
        } catch (e) {
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
            } catch (err) {
                console.error('Blob conversion failed:', err);
                return dataUrl;
            }
        }
    }

    /**
     * Apply clean blur without any zoom or scale transform (natural 1:1 framing).
     */
    function applyVideoBlur(blurPx) {
        const blur = Math.max(0, Number(blurPx) || 0);
        currentBlur = blur;

        video.style.top = '0';
        video.style.left = '0';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.style.transform = 'translateZ(0)';
        video.style.transformOrigin = 'center center';
        video.style.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    }

    /** Pause video decoding when tab is hidden or completely dimmed out */
    function syncPlaybackState() {
        if (!video.src) return;
        if (document.hidden || isParentHidden || isDimPaused) {
            if (!video.paused) video.pause();
        } else {
            if (video.paused && video.readyState >= 2) {
                video.play().catch(() => { });
            }
        }
    }

    function loadVideo() {
        chrome.storage.local.get(['imageUrl', 'imageDataUrl', 'mediaType', 'blurIntensity', 'dimLevel', 'animationsEnabled'], async (settings) => {
            const src = settings.imageUrl || settings.imageDataUrl || '';
            const isVideo = (settings.mediaType === 'video') ||
                /\.mp4(\?|$)/i.test(src) ||
                src.startsWith('data:video/');

            if (!isVideo || !src) {
                video.pause();
                video.style.opacity = '0';
                video.removeAttribute('src');
                video.load();
                lastLoadedVideoSrc = '';
                hasAnimatedVideo = false;
                return;
            }

            applyVideoBlur(settings.blurIntensity || 0);
            isDimPaused = Number(settings.dimLevel ?? 0.75) >= 0.99;

            // If the same video is already loaded, avoid re-fetching or restarting
            if (lastLoadedVideoSrc === src && video.src) {
                video.style.opacity = '1';
                syncPlaybackState();
                return;
            }

            lastLoadedVideoSrc = src;
            hasAnimatedVideo = false;
            video.style.opacity = '0';

            if (currentBlobUrl) {
                URL.revokeObjectURL(currentBlobUrl);
                currentBlobUrl = null;
            }

            let playbackSrc = src;
            if (src.startsWith('data:')) {
                currentBlobUrl = await dataUrlToBlobUrlAsync(src);
                playbackSrc = currentBlobUrl;
            }

            video.style.transition = 'none';
            video.src = playbackSrc;

            video.onloadeddata = () => {
                video.style.opacity = '1';
                if (!hasAnimatedVideo && settings.animationsEnabled && document.body.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    hasAnimatedVideo = true;
                    try {
                        if (document.body.getAnimations) {
                            document.body.getAnimations().forEach(a => a.cancel());
                        }
                    } catch (e) { }

                    const anim = document.body.animate([
                        { clipPath: 'circle(0% at 50% 50%)', opacity: 0 },
                        { clipPath: 'circle(90% at 50% 50%)', opacity: 1, offset: 0.55 },
                        { clipPath: 'circle(150% at 50% 50%)', opacity: 1, offset: 1.0 }
                    ], {
                        duration: 650,
                        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                        fill: 'forwards'
                    });

                    anim.onfinish = () => {
                        document.body.style.clipPath = 'none';
                    };
                }
                syncPlaybackState();
            };
        });
    }

    // Listen for storage changes to auto-update
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (['imageUrl', 'imageDataUrl', 'mediaType'].some(key => key in changes)) {
            loadVideo();
        } else {
            if ('blurIntensity' in changes) {
                applyVideoBlur(changes.blurIntensity.newValue || 0);
            }
            if ('dimLevel' in changes) {
                isDimPaused = Number(changes.dimLevel.newValue ?? 0.75) >= 0.99;
                syncPlaybackState();
            }
        }
    });

    // Listen for messages from content script
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        if (data.type === 'update-video') {
            lastLoadedVideoSrc = '';
            hasAnimatedVideo = false;
            loadVideo();
        } else if (data.type === 'set-blur') {
            applyVideoBlur(data.blur || 0);
        } else if (data.type === 'set-filter') {
            if (typeof data.blur === 'number') {
                applyVideoBlur(data.blur);
            } else {
                const match = String(data.filter || '').match(/blur\((\d+(?:\.\d+)?)px\)/);
                applyVideoBlur(match ? parseFloat(match[1]) : 0);
            }
        } else if (data.type === 'visibility') {
            isParentHidden = Boolean(data.hidden);
            syncPlaybackState();
        } else if (data.type === 'set-dim-paused') {
            isDimPaused = Boolean(data.paused);
            syncPlaybackState();
        }
    });

    document.addEventListener('visibilitychange', syncPlaybackState);
    window.addEventListener('pagehide', () => {
        if (video && !video.paused) video.pause();
    });

    // Initial load
    loadVideo();
})();
