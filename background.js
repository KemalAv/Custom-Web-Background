const UNINSTALL_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdcaJZ23NB7SW-GOG0g6MUmSFQbgba6FXKLjVs_Y-U7Xgpl0g/viewform?usp=publish-editor';

function configureUninstallURL() {
    if (chrome.runtime.setUninstallURL) {
        chrome.runtime.setUninstallURL(UNINSTALL_URL, () => {
            if (chrome.runtime.lastError) {
                console.warn('Failed to set uninstall URL:', chrome.runtime.lastError.message);
            }
        });
    }
}

// Set immediately when service worker starts
configureUninstallURL();

chrome.runtime.onInstalled.addListener(({ reason }) => {
    configureUninstallURL();
    if (reason === 'install') {
        chrome.storage.local.set({
            isEnabled: true,
            uiMode: 'basic',
            extraTransparent: false,
            transparencyLevel: 1,
            siteMode: 'all',
            specificSites: [],
            blurIntensity: 0,
            dimLevel: 0.75,
            dimColor: 'auto',
            autoDarkColor: '#000000',
            autoLightColor: '#ffffff',
            customDimColor: '#000000',
            imageUrl: 'icons/background.png',
            imageName: 'Built-in background',
            mediaType: 'image'
        }, () => chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }));
    }
});
