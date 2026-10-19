document.addEventListener('DOMContentLoaded', () => {
    const openButton = document.getElementById('openExtensionButton');
    const hint = document.getElementById('openExtensionHint');
    const blur = document.getElementById('demoBlur');
    const dim = document.getElementById('demoDimRange');
    const stage = document.getElementById('demoStage');
    const themeNote = document.getElementById('demoThemeNote');
    const demoAutoDark = document.getElementById('demoAutoDark');
    const demoAutoDarkValue = document.getElementById('demoAutoDarkValue');
    const demoAutoLight = document.getElementById('demoAutoLight');
    const demoAutoLightValue = document.getElementById('demoAutoLightValue');
    const demoAutoColorRow = document.getElementById('demoAutoColorRow');
    const deviceTheme = window.matchMedia('(prefers-color-scheme: dark)');

    // Ensure defaults start at 5px blur and 75% dim
    blur.value = 5;
    dim.value = 75;

    function updatePreview() {
        const chosen = document.querySelector('input[name="demoColor"]:checked')?.value || 'auto';
        if (demoAutoColorRow) demoAutoColorRow.hidden = false;
        if (demoAutoDarkValue && demoAutoDark) demoAutoDarkValue.textContent = demoAutoDark.value.toUpperCase();
        if (demoAutoLightValue && demoAutoLight) demoAutoLightValue.textContent = demoAutoLight.value.toUpperCase();

        let color = chosen;
        if (chosen === 'auto') {
            color = deviceTheme.matches ? (demoAutoDark?.value || '#000000') : (demoAutoLight?.value || '#ffffff');
        } else if (chosen === 'dark' || chosen === 'black') {
            color = demoAutoDark?.value || '#000000';
        } else if (chosen === 'light' || chosen === 'white') {
            color = demoAutoLight?.value || '#ffffff';
        }

        const rgb = color.startsWith('#')
            ? [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16))
            : [0, 0, 0];

        const darkPanel = (rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114) < 128;
        stage.style.setProperty('--demo-blur', `${blur.value}px`);
        stage.style.setProperty('--demo-opacity', String(Number(dim.value) / 100));
        stage.style.setProperty('--demo-overlay', color);
        stage.style.setProperty('--demo-panel-tint', `rgba(${rgb.join(',')},.75)`);
        stage.classList.toggle('demo-dark', darkPanel);
        document.getElementById('demoBlurValue').textContent = `${blur.value} px`;
        document.getElementById('demoDimValue').textContent = `${dim.value}%`;
        themeNote.textContent = chosen === 'auto'
            ? `Auto: currently uses ${deviceTheme.matches ? 'Dark Theme color (' + (demoAutoDark?.value || '#000000').toUpperCase() + ')' : 'Light Theme color (' + (demoAutoLight?.value || '#FFFFFF').toUpperCase() + ')'}.`
            : `${chosen === 'dark' ? 'Dark Theme (' + (demoAutoDark?.value || '#000000').toUpperCase() + ')' : 'Light Theme (' + (demoAutoLight?.value || '#FFFFFF').toUpperCase() + ')'} selected for this preview.`;
    }

    blur.addEventListener('input', updatePreview);
    dim.addEventListener('input', updatePreview);
    document.querySelectorAll('input[name="demoColor"]').forEach(input => input.addEventListener('change', updatePreview));
    if (demoAutoDark) demoAutoDark.addEventListener('input', updatePreview);
    if (demoAutoLight) demoAutoLight.addEventListener('input', updatePreview);
    deviceTheme.addEventListener('change', updatePreview);
    const demoWallpaper = document.getElementById('demoWallpaper');
    function triggerDemoAnimation() {
        if (!demoWallpaper?.animate) return;
        const anim = demoWallpaper.animate([
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
            demoWallpaper.style.clipPath = 'none';
            demoWallpaper.style.transform = 'none';
        };
    }

    document.getElementById('demoReset').addEventListener('click', () => {
        blur.value = 5;
        dim.value = 75;
        if (demoAutoDark) demoAutoDark.value = '#000000';
        if (demoAutoLight) demoAutoLight.value = '#ffffff';
        document.querySelector('input[name="demoColor"][value="auto"]').checked = true;
        updatePreview();
        triggerDemoAnimation();
    });
    document.getElementById('demoButton').addEventListener('click', () => {
        hint.textContent = 'The Google demo button stays readable. Use the extension popup to apply real settings.';
    });
    updatePreview();
    triggerDemoAnimation();

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
