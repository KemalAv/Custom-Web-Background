document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const welcomeFullBg = document.getElementById("welcomeFullBg");
  const welcomeFullTint = document.getElementById("welcomeFullTint");

  const ytMockup = document.getElementById("ytMockup");
  const ytBgLayer = document.getElementById("ytBgLayer");
  const ytOverlayTint = document.getElementById("ytOverlayTint");
  const previewModeTag = document.getElementById("previewModeTag");

  const btnOpenPuzzleExt = document.getElementById("btnOpenPuzzleExt");
  const pinGuideModal = document.getElementById("pinGuideModal");
  const btnClosePinGuide = document.getElementById("btnClosePinGuide");
  const btnDismissGuide = document.getElementById("btnDismissGuide");

  const enableExtension = document.getElementById("enableExtension");
  const modeButtons = document.querySelectorAll(".mode-btn");

  const radioTargetWebsites = document.querySelectorAll('input[name="targetWebsites"]');
  const specificSitesWrapper = document.getElementById("specificSitesWrapper");
  const btnAddCurrentSite = document.getElementById("btnAddCurrentSite");
  const siteInput = document.getElementById("siteInput");
  const btnAddSite = document.getElementById("btnAddSite");
  const sitesList = document.getElementById("sitesList");
  const sitesLimitTag = document.getElementById("sitesLimitTag");
  const siteCounter = document.getElementById("siteCounter");

  const enableAnimations = document.getElementById("enableAnimations");
  const correctTextColor = document.getElementById("correctTextColor");
  const mediaFileInput = document.getElementById("mediaFileInput");
  const btnBuiltIn = document.getElementById("btnBuiltIn");
  const mediaUrlInput = document.getElementById("mediaUrlInput");
  const btnApplyUrl = document.getElementById("btnApplyUrl");

  const presetButtons = document.querySelectorAll(".preset-btn");
  const customPresetRow = document.getElementById("customPresetRow");
  const customPresetBadge = document.getElementById("customPresetBadge");

  const radioOverlayColors = document.querySelectorAll('input[name="overlayColor"]');
  const blurRange = document.getElementById("blurRange");
  const dimRange = document.getElementById("dimRange");
  const blurValDisplay = document.getElementById("blurValDisplay");
  const dimValDisplay = document.getElementById("dimValDisplay");

  const darkThemePicker = document.getElementById("darkThemePicker");
  const lightThemePicker = document.getElementById("lightThemePicker");
  const darkHex = document.getElementById("darkHex");
  const lightHex = document.getElementById("lightHex");

  const btnResetDefaults = document.getElementById("btnResetDefaults");
  const btnApplySave = document.getElementById("btnApplySave");

  const defaultWallpaper = "icons/background.png";
  let currentBg = defaultWallpaper;
  let currentBgType = "image";
  let activeMode = "none";
  let specificSites = [];
  const MAX_SITES = 10;

  // Pin Extension Modal & Action
  if (btnOpenPuzzleExt) {
    btnOpenPuzzleExt.addEventListener("click", () => {
      try {
        if (typeof chrome !== "undefined" && chrome.action && chrome.action.openPopup) {
          chrome.action.openPopup().catch(() => {});
        }
      } catch (e) {}
      if (pinGuideModal) pinGuideModal.style.display = "flex";
    });
  }

  if (btnClosePinGuide) {
    btnClosePinGuide.addEventListener("click", () => {
      pinGuideModal.style.display = "none";
    });
  }

  if (btnDismissGuide) {
    btnDismissGuide.addEventListener("click", () => {
      pinGuideModal.style.display = "none";
    });
  }

  // Convert Hex to RGB Helper
  function hexToRgb(hex) {
    let clean = (hex || "#000000").replace("#", "");
    if (clean.length === 3) {
      clean = clean.split("").map((c) => c + c).join("");
    }
    const num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  // Detect System / Browser Dark Theme
  function isDarkThemeActive() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  // Clean Domain Helper
  function cleanDomain(input) {
    if (!input) return "";
    let clean = input.trim().toLowerCase();
    clean = clean.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "");
    clean = clean.split("/")[0].split(":")[0].trim();
    return clean;
  }

  // Render Specific Sites (Max 10)
  function renderSpecificSites() {
    if (!sitesList) return;
    sitesList.innerHTML = "";
    specificSites.forEach((domain) => {
      const chip = document.createElement("span");
      chip.className = "site-chip";
      chip.innerHTML = `${domain} <span class="site-chip-remove" data-domain="${domain}" title="Remove">×</span>`;
      sitesList.appendChild(chip);
    });

    const count = specificSites.length;
    if (sitesLimitTag) sitesLimitTag.textContent = `${count}/${MAX_SITES} sites`;

    const isSpecific = document.querySelector('input[name="targetWebsites"]:checked')?.value === "specific";
    if (siteCounter) siteCounter.textContent = isSpecific ? `${count}/${MAX_SITES} sites` : "All Sites";

    const isFull = count >= MAX_SITES;
    if (siteInput) {
      siteInput.disabled = isFull;
      siteInput.placeholder = isFull ? "Max 10 websites reached" : "e.g. youtube.com";
    }
    if (btnAddSite) btnAddSite.disabled = isFull;
    if (btnAddCurrentSite) btnAddCurrentSite.disabled = isFull;

    sitesList.querySelectorAll(".site-chip-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetDomain = btn.dataset.domain;
        specificSites = specificSites.filter((d) => d !== targetDomain);
        renderSpecificSites();
      });
    });
  }

  function addSite(rawDomain) {
    const domain = cleanDomain(rawDomain);
    if (!domain) return;
    if (specificSites.length >= MAX_SITES) {
      alert("Maximum limit of 10 specific websites reached.");
      return;
    }
    if (!specificSites.includes(domain)) {
      specificSites.push(domain);
      renderSpecificSites();
      if (siteInput) siteInput.value = "";
    }
  }

  if (btnAddCurrentSite) {
    btnAddCurrentSite.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.url) {
            try {
              const url = new URL(tabs[0].url);
              const domain = url.hostname.replace(/^www\./, "");
              if (domain && !domain.startsWith("chrome")) {
                addSite(domain);
              } else {
                addSite("youtube.com");
              }
            } catch (e) {
              addSite("youtube.com");
            }
          } else {
            addSite("youtube.com");
          }
        });
      } else {
        addSite("youtube.com");
      }
    });
  }

  if (btnAddSite && siteInput) {
    btnAddSite.addEventListener("click", () => addSite(siteInput.value));
    siteInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addSite(siteInput.value);
      }
    });
  }

  function toggleSpecificSites(isSpecific) {
    if (specificSitesWrapper) specificSitesWrapper.style.display = isSpecific ? "flex" : "none";
    if (siteCounter) siteCounter.textContent = isSpecific ? `${specificSites.length}/${MAX_SITES} sites` : "All Sites";
  }

  radioTargetWebsites.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      toggleSpecificSites(e.target.value === "specific");
    });
  });

  // Dynamic Custom Preset Badge Update
  function updateCustomPresetDisplay() {
    const b = blurRange.value;
    const d = dimRange.value;
    if (customPresetBadge) {
      customPresetBadge.textContent = `Blur: ${b}px • Dim: ${d}%`;
    }
  }

  function highlightCustomPreset() {
    presetButtons.forEach((b) => b.classList.remove("active"));
    if (customPresetRow) customPresetRow.classList.add("active");
    updateCustomPresetDisplay();
  }

  function syncPresetHighlight(bVal, dVal) {
    updateCustomPresetDisplay();
    let matched = false;
    presetButtons.forEach((btn) => {
      if (Number(btn.dataset.blur) === bVal && Number(btn.dataset.dim) === dVal) {
        btn.classList.add("active");
        matched = true;
      } else {
        btn.classList.remove("active");
      }
    });

    if (matched) {
      if (customPresetRow) customPresetRow.classList.remove("active");
    } else {
      if (customPresetRow) customPresetRow.classList.add("active");
    }
  }

  // Load Settings from Storage
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(null, (data) => {
      if (!data) {
        updateMockup();
        return;
      }

      if (data.isEnabled !== undefined) {
        enableExtension.checked = Boolean(data.isEnabled);
      }

      if (data.transparencyLevel !== undefined) {
        const lvl = Number(data.transparencyLevel);
        if (lvl === 1) setMode("none");
        else if (lvl === 2) setMode("glass");
        else if (lvl === 3) setMode("transparent");
      } else if (data.mode) {
        setMode(data.mode);
      } else {
        setMode("none");
      }

      if (data.specificSites && Array.isArray(data.specificSites)) {
        specificSites = data.specificSites.slice(0, MAX_SITES);
      }
      renderSpecificSites();

      if (data.siteMode) {
        const r = document.querySelector(`input[name="targetWebsites"][value="${data.siteMode}"]`);
        if (r) r.checked = true;
        toggleSpecificSites(data.siteMode === "specific");
      }

      if (data.animationsEnabled !== undefined) {
        enableAnimations.checked = Boolean(data.animationsEnabled);
      } else {
        enableAnimations.checked = false;
      }
      if (data.autoTextColor !== undefined) {
        correctTextColor.checked = Boolean(data.autoTextColor);
      } else {
        correctTextColor.checked = false;
      }

      let blurVal = 0;
      let dimVal = 75;

      if (data.blurIntensity !== undefined) blurVal = Number(data.blurIntensity);
      else if (data.blur !== undefined) blurVal = Number(data.blur);

      if (data.dimLevel !== undefined) {
        const dl = parseFloat(data.dimLevel);
        dimVal = dl <= 1 ? Math.round(dl * 100) : Math.round(dl);
      } else if (data.dim !== undefined) {
        dimVal = Number(data.dim);
      }

      blurRange.value = blurVal;
      dimRange.value = dimVal;
      blurValDisplay.textContent = `${blurVal}px`;
      dimValDisplay.textContent = `${dimVal}%`;
      syncPresetHighlight(blurVal, dimVal);

      if (data.dimColor && data.dimColor !== "theme") {
        const r = document.querySelector(`input[name="overlayColor"][value="${data.dimColor}"]`);
        if (r) r.checked = true;
      }

      if (data.autoDarkColor) {
        darkThemePicker.value = data.autoDarkColor;
        darkHex.textContent = data.autoDarkColor;
      }
      if (data.autoLightColor) {
        lightThemePicker.value = data.autoLightColor;
        lightHex.textContent = data.autoLightColor;
      }

      if (data.imageUrl) currentBg = data.imageUrl;
      else if (data.imageDataUrl) currentBg = data.imageDataUrl;
      else if (data.media) currentBg = data.media;

      if (data.mediaType) currentBgType = data.mediaType;
      if (currentBg && !currentBg.startsWith("data:") && currentBg !== defaultWallpaper) {
        mediaUrlInput.value = currentBg;
      }

      updateMockup();
    });
  } else {
    setMode("none");
    updateMockup();
  }

  // Set Transparent Mode
  function setMode(mode) {
    activeMode = mode;
    modeButtons.forEach((b) => b.classList.remove("active"));
    const targetBtn = document.querySelector(`.mode-btn[data-mode="${mode}"]`);
    if (targetBtn) targetBtn.classList.add("active");

    if (ytMockup) {
      ytMockup.classList.remove("mode-none", "mode-glass", "mode-transparent");
      ytMockup.classList.add(`mode-${mode}`);
    }

    let label = "None Transparent";
    if (mode === "glass") label = "Glass UI";
    else if (mode === "transparent") label = "Transparent";
    if (previewModeTag) previewModeTag.textContent = `Mode: ${label}`;
  }

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  // Update YouTube Live Mockup and Welcome Full Background
  function updateMockup() {
    const blurVal = Number(blurRange.value);
    const filterStyle = blurVal > 0 ? `blur(${blurVal}px)` : "none";

    // 1. Update YouTube Background Layer
    if (ytBgLayer) {
      ytBgLayer.style.backgroundImage = `url("${currentBg}")`;
      ytBgLayer.style.filter = filterStyle;
    }

    // 2. Update Welcome Page Full Background
    if (welcomeFullBg) {
      welcomeFullBg.style.backgroundImage = `url("${currentBg}")`;
      welcomeFullBg.style.filter = filterStyle;
    }

    // 3. Resolve Overlay Tint based on Auto and Theme settings
    const dimVal = Number(dimRange.value) / 100;
    const overlayColorChoice = document.querySelector('input[name="overlayColor"]:checked')?.value || "auto";

    let chosenHex = "#000000";
    let isDark = false;

    if (overlayColorChoice === "auto") {
      // Auto mode follows user-configured dark or light theme color based on system/browser theme
      isDark = isDarkThemeActive();
      chosenHex = isDark ? (darkThemePicker.value || "#000000") : (lightThemePicker.value || "#ffffff");
    } else if (overlayColorChoice === "dark") {
      isDark = true;
      chosenHex = darkThemePicker.value || "#000000";
    } else if (overlayColorChoice === "light") {
      isDark = false;
      chosenHex = lightThemePicker.value || "#ffffff";
    }

    const [r, g, b] = hexToRgb(chosenHex);
    const rgbaCss = `rgba(${r}, ${g}, ${b}, ${dimVal})`;

    // Apply tint to YouTube mockup overlay
    if (ytOverlayTint) {
      ytOverlayTint.style.backgroundColor = rgbaCss;
    }

    // Apply tint to Welcome page background
    if (welcomeFullTint) {
      welcomeFullTint.style.backgroundColor = rgbaCss;
    }

    // Adapt YouTube Mockup Theme (Dark vs Light)
    if (ytMockup) {
      if (isDark) {
        ytMockup.classList.add("theme-dark");
        ytMockup.classList.remove("theme-light");
      } else {
        ytMockup.classList.add("theme-light");
        ytMockup.classList.remove("theme-dark");
      }
    }
  }

  // Listen for System Theme Changes
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      updateMockup();
    });
  }

  // Slider Events
  blurRange.addEventListener("input", (e) => {
    blurValDisplay.textContent = `${e.target.value}px`;
    highlightCustomPreset();
    updateMockup();
  });

  dimRange.addEventListener("input", (e) => {
    dimValDisplay.textContent = `${e.target.value}%`;
    highlightCustomPreset();
    updateMockup();
  });

  // Presets Click
  presetButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const b = Number(btn.dataset.blur);
      const d = Number(btn.dataset.dim);

      blurRange.value = b;
      dimRange.value = d;
      blurValDisplay.textContent = `${b}px`;
      dimValDisplay.textContent = `${d}%`;

      presetButtons.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      if (customPresetRow) customPresetRow.classList.remove("active");
      updateCustomPresetDisplay();
      updateMockup();
    });
  });

  if (customPresetRow) {
    customPresetRow.addEventListener("click", () => {
      highlightCustomPreset();
      updateMockup();
    });
  }

  // Color Pickers - Update Live
  darkThemePicker.addEventListener("input", (e) => {
    darkHex.textContent = e.target.value;
    updateMockup();
  });

  lightThemePicker.addEventListener("input", (e) => {
    lightHex.textContent = e.target.value;
    updateMockup();
  });

  radioOverlayColors.forEach((r) => {
    r.addEventListener("change", updateMockup);
  });

  // Media File Upload
  mediaFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      currentBgType = file.type.startsWith("video/") ? "video" : "image";
      const reader = new FileReader();
      reader.onload = (event) => {
        currentBg = event.target.result;
        mediaUrlInput.value = "";
        updateMockup();
      };
      reader.readAsDataURL(file);
    }
  });

  // Media URL Input
  btnApplyUrl.addEventListener("click", () => {
    const url = mediaUrlInput.value.trim();
    if (url) {
      currentBg = url;
      currentBgType = /\.mp4(\?|$)/i.test(url) ? "video" : "image";
      updateMockup();
    }
  });

  // Built-in Wallpaper
  btnBuiltIn.addEventListener("click", () => {
    currentBg = defaultWallpaper;
    currentBgType = "image";
    mediaUrlInput.value = "";
    updateMockup();
  });

  // Reset Defaults
  btnResetDefaults.addEventListener("click", () => {
    enableExtension.checked = true;
    setMode("none");

    const allRadio = document.querySelector('input[name="targetWebsites"][value="all"]');
    if (allRadio) allRadio.checked = true;
    toggleSpecificSites(false);
    specificSites = [];
    renderSpecificSites();

    enableAnimations.checked = false;
    correctTextColor.checked = false;

    blurRange.value = 0;
    dimRange.value = 75;
    blurValDisplay.textContent = "0px";
    dimValDisplay.textContent = "75%";

    presetButtons.forEach((b) => b.classList.remove("active"));
    if (presetButtons[0]) presetButtons[0].classList.add("active");
    if (customPresetRow) customPresetRow.classList.remove("active");
    updateCustomPresetDisplay();

    const autoColorRadio = document.querySelector('input[name="overlayColor"][value="auto"]');
    if (autoColorRadio) autoColorRadio.checked = true;

    darkThemePicker.value = "#000000";
    darkHex.textContent = "#000000";
    lightThemePicker.value = "#ffffff";
    lightHex.textContent = "#ffffff";

    currentBg = defaultWallpaper;
    currentBgType = "image";
    mediaUrlInput.value = "";

    updateMockup();
  });

  // Apply & Save
  btnApplySave.addEventListener("click", () => {
    const isEnabledVal = enableExtension.checked;
    let transparencyLevel = 1;
    if (activeMode === "glass") transparencyLevel = 2;
    else if (activeMode === "transparent") transparencyLevel = 3;

    const siteModeVal = document.querySelector('input[name="targetWebsites"]:checked')?.value || "all";
    const blurVal = Number(blurRange.value);
    const dimPercent = Number(dimRange.value);
    const dimFloat = dimPercent / 100;
    const overlayVal = document.querySelector('input[name="overlayColor"]:checked')?.value || "auto";

    const settings = {
      isEnabled: isEnabledVal,
      enabled: isEnabledVal,
      transparencyLevel: transparencyLevel,
      extraTransparent: transparencyLevel === 3,
      mode: activeMode,
      siteMode: siteModeVal,
      target: siteModeVal,
      specificSites: specificSites.slice(0, MAX_SITES),
      animationsEnabled: enableAnimations.checked,
      animations: enableAnimations.checked,
      autoTextColor: correctTextColor.checked,
      correctTextColor: correctTextColor.checked,
      blurIntensity: blurVal,
      blur: blurVal,
      dimLevel: dimFloat,
      dim: dimPercent,
      dimColor: overlayVal,
      overlayColor: overlayVal,
      autoDarkColor: darkThemePicker.value,
      darkThemeColor: darkThemePicker.value,
      autoLightColor: lightThemePicker.value,
      lightThemeColor: lightThemePicker.value,
      imageUrl: currentBg,
      media: currentBg,
      mediaType: currentBgType,
      imageName: currentBg === defaultWallpaper ? "Built-in background" : "Custom media"
    };

    if (currentBg.startsWith("data:")) {
      settings.imageDataUrl = currentBg;
    }

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(["bakedImage", "bakedImageDark", "bakedImageLight"]);
      chrome.storage.local.set(settings, () => {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, {
                type: "FORCE_APPLY_SETTINGS",
                action: "updateBackground",
                settings
              }).catch(() => {});
            }
          });
        });

        const origText = btnApplySave.textContent;
        btnApplySave.textContent = "Saved! ✓";
        btnApplySave.style.backgroundColor = "#16a34a";
        setTimeout(() => {
          btnApplySave.textContent = origText;
          btnApplySave.style.backgroundColor = "";
        }, 1500);
      });
    } else {
      localStorage.setItem("custom_web_bg_settings", JSON.stringify(settings));
      const origText = btnApplySave.textContent;
      btnApplySave.textContent = "Saved! ✓";
      btnApplySave.style.backgroundColor = "#16a34a";
      setTimeout(() => {
        btnApplySave.textContent = origText;
        btnApplySave.style.backgroundColor = "";
      }, 1500);
    }
  });
});
