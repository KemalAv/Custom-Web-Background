document.addEventListener('DOMContentLoaded', () => {
    const openExtensionButton = document.getElementById('openExtensionButton');
    const hint = document.getElementById('openExtensionHint');

    const openExtension = async () => {
        try {
            if (chrome.action?.openPopup) {
                await chrome.action.openPopup();
                return;
            }
        } catch (error) {
            console.info('Popup needs to be opened from the browser toolbar.', error);
        }

        hint.textContent = 'Click the puzzle icon in the browser toolbar, then select Custom Web Background.';
    };

    openExtensionButton.addEventListener('click', openExtension);
});
