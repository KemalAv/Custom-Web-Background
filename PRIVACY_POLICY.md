# Privacy Policy for Custom Web Background

## 1. Introduction
Custom Web Background ("we", "our", or "the extension") is dedicated to protecting your privacy. This Privacy Policy outlines how the extension handles user information and explains our data protection practices in strict compliance with the Google Chrome Web Store Developer Program Policies.

**Core Commitment:** Custom Web Background does **not** collect, track, log, sell, or transmit any personally identifiable information (PII) or web browsing history. All preferences, settings, and media assets remain strictly on your local device.

---

## 2. Product Overview & Purpose
Custom Web Background is built with a single, clear purpose: to allow users to personalize their browsing experience by placing custom wallpapers behind website interfaces.

- **Description:** Tired of boring plain pages? This extension lets you add your own wallpaper behind every website you visit, making your browser look clean, modern, and personalized.
- **Key Features:**
  1. **Custom Uploads:** Upload your own background images and videos or enter direct media URLs.
  2. **Universal Compatibility:** Seamlessly applies backgrounds across websites (including Google, YouTube, Reddit, and social media) while keeping website buttons, text, and inputs clear and legible.
  3. **Adjustable Blurs & Dimming:** Customize dimming levels, blur intensities, and adaptive theme overlay colors to create your perfect look.
  4. **UI Animations & Controls:** Enjoy fluid animations during user interface interactions and quick toggles from the popup.

---

## 3. Data Collection and Usage
Custom Web Background operates entirely on the client side inside your web browser:

- **No Personal Data Collected:** We do not collect names, email addresses, phone numbers, IP addresses, authentication tokens, or payment details.
- **No Browsing Activity Tracked:** We do not track, record, analyze, or transmit the URLs you visit, search queries, page contents, keystrokes, form inputs, or password fields.
- **Local Settings Storage:** User-configured preferences (e.g., blur intensity, dimming level, theme colors, site inclusion/exclusion lists, and uploaded wallpaper files) are saved exclusively on your local machine using the Chrome Storage API (`chrome.storage.local`). This data is accessed solely to render your background settings when a webpage loads.

---

## 4. Permissions Requested & Justification
The extension requests only the minimum permissions necessary to function:

- **`storage` & `unlimitedStorage`:**  
  Used exclusively to store your wallpaper media (images and video files) and UI preferences locally in your browser so they persist without hitting default browser quota limits.
- **`activeTab` & `tabs`:**  
  Used solely to detect navigation and refresh events on active tabs to apply your chosen background styling without latency. No browsing history or tab URLs are stored or communicated remotely.
- **Host Permissions (`<all_urls>`):**  
  Required strictly to inject the background canvas, blur, and dim overlay elements into the webpages you browse. The extension does not inspect, collect, or extract private content from any website.

---

## 5. Third-Party Sharing and Remote Transfers
- **No Data Selling or Sharing:** We do not sell, rent, trade, or transfer any user data to third parties, data brokers, or advertising networks.
- **Remote Media Links:** If you choose to load a background via an external image or video URL, your browser fetches that asset directly from that source to display it locally. No browsing context or personal identity is transmitted.
- **Optional Feedback Form:** An optional link to a feedback form (hosted on Google Forms) may open upon uninstallation. Providing feedback is entirely voluntary, and no data is submitted automatically.

---

## 6. Data Retention and Deletion
You retain complete control over your data:
- You can change, replace, or delete your custom wallpapers and visual settings at any time directly through the extension popup.
- Uninstalling the extension from your browser automatically and permanently purges all locally stored settings, cached wallpapers, and preferences.

---

## 7. Contact Information
If you have any questions, suggestions, or concerns regarding this Privacy Policy, please contact:

- **Developer:** Custom Web Background Support
- **Email:** [trixieabu@gmail.com]
- **Project URL:** [https://github.com/KemalAv/Custom-Web-Background]
