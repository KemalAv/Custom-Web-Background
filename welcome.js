document.addEventListener('DOMContentLoaded', () => {
    const openButton = document.getElementById('openExtensionButton');
    const hint = document.getElementById('openExtensionHint');
    const blur = document.getElementById('demoBlur');
    const dim = document.getElementById('demoDimRange');
    const stage = document.getElementById('demoStage');
    const themeNote = document.getElementById('demoThemeNote');
    const customColor = document.getElementById('demoCustomColor');
    const customColorRow = document.getElementById('demoCustomColorRow');
    const customColorValue = document.getElementById('demoCustomColorValue');
    const deviceTheme = window.matchMedia('(prefers-color-scheme: dark)');

    function updatePreview() {
        const chosen = document.querySelector('input[name="demoColor"]:checked').value;
        const color = chosen === 'auto' ? (deviceTheme.matches ? 'black' : 'white')
            : chosen === 'custom' ? customColor.value : chosen;
        const rgb = color === 'black' ? [0, 0, 0] : color === 'white' ? [255, 255, 255]
            : [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16));
        const darkPanel = (rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114) < 128;
        customColorRow.hidden = chosen !== 'custom';
        customColorValue.textContent = customColor.value.toUpperCase();
        stage.style.setProperty('--demo-blur', `${blur.value}px`);
        stage.style.setProperty('--demo-opacity', String(Number(dim.value) / 100));
        stage.style.setProperty('--demo-overlay', color);
        stage.style.setProperty('--demo-panel-tint', `rgba(${rgb.join(',')},.75)`);
        stage.classList.toggle('demo-dark', darkPanel);
        document.getElementById('demoBlurValue').textContent = `${blur.value} px`;
        document.getElementById('demoDimValue').textContent = `${dim.value}%`;
        themeNote.textContent = chosen === 'custom'
            ? `Custom overlay: ${customColor.value.toUpperCase()}. This preview does not change your saved settings.`
            : chosen === 'auto'
            ? `Auto: your device currently uses ${deviceTheme.matches ? 'dark → black' : 'light → white'} overlay.`
            : `${color === 'black' ? 'Black' : 'White'} overlay selected for this preview.`;
    }

    blur.addEventListener('input', updatePreview);
    dim.addEventListener('input', updatePreview);
    document.querySelectorAll('input[name="demoColor"]').forEach(input => input.addEventListener('change', updatePreview));
    customColor.addEventListener('input', updatePreview);
    deviceTheme.addEventListener('change', updatePreview);
    document.getElementById('demoReset').addEventListener('click', () => {
        blur.value = 0;
        dim.value = 50;
        customColor.value = '#6955b8';
        document.querySelector('input[name="demoColor"][value="auto"]').checked = true;
        updatePreview();
    });
    document.getElementById('demoButton').addEventListener('click', () => {
        hint.textContent = 'The preview button stays readable. Use the extension popup to apply real settings.';
    });
    updatePreview();

    openButton.addEventListener('click', async () => {
        try {
            if (chrome.action?.openPopup) {
                await chrome.action.openPopup();
                return;
            }
        } catch (error) {
            console.info('Popup needs to be opened from the browser toolbar.', error);
        }
        hint.textContent = 'Click the puzzle icon in the browser toolbar, then select Custom Web Background.';
    });
});
