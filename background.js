chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason !== 'install') return;

    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
