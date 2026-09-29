chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') {
        chrome.storage.local.set({
            isEnabled: true,
            blurIntensity: 0,
            dimLevel: 0.5,
            dimColor: 'auto',
            imageUrl: 'icons/background.png',
            imageName: 'Built-in background',
            mediaType: 'image'
        }, () => chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }));
    } else if (reason === 'update') {
        // The saved mode is obsolete; every page now uses Glass UI.
        chrome.storage.local.remove(['uiMode', 'protectModals', 'ignoreElementBg']);
    }
});
