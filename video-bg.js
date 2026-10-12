(() => {
    const video = document.getElementById('bgVideo');
    let currentBlobUrl = null;
    let lastLoadedVideoSrc = '';
    let hasAnimatedVideo = false;

    function dataUrlToBlobUrl(dataUrl) {
        if (!dataUrl.startsWith('data:')) return dataUrl;
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

    function loadVideo() {
        chrome.storage.local.get(['imageUrl', 'imageDataUrl', 'mediaType', 'imageName', 'blurIntensity', 'animationsEnabled'], (settings) => {
            const src = settings.imageUrl || settings.imageDataUrl || '';
            const isVideo = (settings.mediaType === 'video') ||
                            /\.mp4(\?|$)/i.test(src) ||
                            src.startsWith('data:video/');

            if (!isVideo || !src) {
                video.style.opacity = '0';
                video.src = '';
                lastLoadedVideoSrc = '';
                hasAnimatedVideo = false;
                return;
            }

            const blur = settings.blurIntensity || 0;
            video.style.filter = blur > 0 ? `blur(${blur}px)` : 'none';

            // Jika video yang sama sudah berjalan, jangan reload sumber & jangan ulangi animasi
            if (lastLoadedVideoSrc === src && video.src) {
                video.style.opacity = '1';
                return;
            }

            lastLoadedVideoSrc = src;
            hasAnimatedVideo = false;
            video.style.opacity = '0';

            // Clean up previous blob URL
            if (currentBlobUrl) {
                URL.revokeObjectURL(currentBlobUrl);
                currentBlobUrl = null;
            }

            // Convert data URL to blob URL for better performance
            let playbackSrc = src;
            if (src.startsWith('data:')) {
                currentBlobUrl = dataUrlToBlobUrl(src);
                playbackSrc = currentBlobUrl;
            }

            video.style.transition = 'none';

            video.src = playbackSrc;
            video.onloadeddata = () => {
                video.style.opacity = '1';
                if (!hasAnimatedVideo && settings.animationsEnabled && video.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    hasAnimatedVideo = true;
                    try {
                        if (video.getAnimations) {
                            video.getAnimations().forEach(a => a.cancel());
                        }
                    } catch (e) { }

                    const anim = video.animate([
                        { clipPath: 'circle(0% at 50% 50%)', transform: 'scale(1.12)', opacity: 0 },
                        { clipPath: 'circle(90% at 50% 50%)', transform: 'scale(1.02)', opacity: 1, offset: 0.52 },
                        { clipPath: 'circle(84% at 50% 50%)', transform: 'scale(1.04)', opacity: 1, offset: 0.74 },
                        { clipPath: 'circle(150% at 50% 50%)', transform: 'scale(1)', opacity: 1, offset: 1.0 }
                    ], {
                        duration: 750,
                        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                        fill: 'forwards'
                    });

                    anim.onfinish = () => {
                        video.style.clipPath = 'none';
                        video.style.transform = 'none';
                    };
                }
                video.play().catch(() => {});
            };
        });
    }

    // Listen for storage changes to auto-update
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (['imageUrl', 'imageDataUrl', 'mediaType'].some(key => key in changes)) {
            loadVideo();
        } else if ('blurIntensity' in changes) {
            chrome.storage.local.get(['blurIntensity'], (res) => {
                const blur = res.blurIntensity || 0;
                video.style.filter = blur > 0 ? `blur(${blur}px)` : 'none';
            });
        }
    });

    // Listen for messages from content script
    window.addEventListener('message', (event) => {
        if (event.data?.type === 'update-video') {
            lastLoadedVideoSrc = '';
            hasAnimatedVideo = false;
            loadVideo();
        }
        if (event.data?.type === 'set-filter') {
            video.style.filter = event.data.filter || 'none';
        }
    });

    // Initial load
    loadVideo();
})();
