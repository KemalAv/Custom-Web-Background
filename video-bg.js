(() => {
    const video = document.getElementById('bgVideo');
    let currentBlobUrl = null;

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

            video.style.opacity = '0';

            if (!isVideo || !src) {
                video.src = '';
                return;
            }

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

            // Apply animations
            const animDur = settings.animationsEnabled ? '0.5s' : '0s';
            video.style.transition = `opacity ${animDur} ease`;

            // Apply blur filter
            const blur = settings.blurIntensity || 0;
            video.style.filter = blur > 0 ? `blur(${blur}px)` : 'none';

            video.src = playbackSrc;
            video.onloadeddata = () => {
                video.style.opacity = '1';
                video.play().catch(() => {});
            };
        });
    }

    // Listen for storage changes to auto-update
    chrome.storage.onChanged.addListener(() => {
        loadVideo();
    });

    // Listen for messages from content script
    window.addEventListener('message', (event) => {
        if (event.data?.type === 'update-video') {
            loadVideo();
        }
        if (event.data?.type === 'set-filter') {
            video.style.filter = event.data.filter || 'none';
        }
    });

    // Initial load
    loadVideo();
})();
