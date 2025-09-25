// --- STATE ---
const videoCache = new Map();
const processedElements = new Map();
let lastRequestTime = 0;
let apiCooldownUntil = 0;
const MIN_DELAY_MS = 2000;
const CACHE_TTL = 24 * 60 * 60 * 1000;

// --- SETTINGS ---
let displaySettings = {
    showLabels: true,
    showTier: true,
    showLikeRatio: true,
    showRating: true,
    showVotes: true,
    showEngagementRate: true
};

// --- LOAD SETTINGS ---
async function loadAndMonitorSettings() {
    const { displayPreferences } = await chrome.storage.sync.get('displayPreferences');
    Object.assign(displaySettings, displayPreferences || {});
    chrome.storage.onChanged.addListener((changes, ns) => {
        if (ns === 'sync' && changes.displayPreferences) {
            Object.assign(displaySettings, changes.displayPreferences.newValue || {});
            rerenderAllVisibleBadges();
        }
    });
}

// --- CACHE UTILS ---
async function getPersistentCache(videoId) {
    const result = await chrome.storage.local.get(videoId);
    const cached = result[videoId];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.tierData;
    }
    return null;
}

function setPersistentCache(videoId, tierData) {
    chrome.storage.local.set({ [videoId]: { tierData, timestamp: Date.now() } });
}

// --- API UTILS ---
async function limitedFetch(url) {
    const now = Date.now();
    const waitTime = Math.max(0, MIN_DELAY_MS - (now - lastRequestTime));
    if (waitTime > 0) await new Promise(res => setTimeout(res, waitTime));
    lastRequestTime = Date.now();
    return fetch(url);
}

// --- VIEW COUNT ---
function getViewCount(el) {
    const text = el.querySelector('#metadata-line span:first-of-type')?.textContent || '';
    const raw = text.toLowerCase().replace(/,/g, '').replace(/[^0-9.kmb]/g, '');
    let val = parseFloat(raw);
    if (isNaN(val)) return 0;
    if (raw.endsWith('k')) val *= 1e3;
    else if (raw.endsWith('m')) val *= 1e6;
    else if (raw.endsWith('b')) val *= 1e9;
    return Math.floor(val);
}

// --- TIER SYSTEM ---
const TIER_LADDER = [
    { minLikeRatio: 100, tier: 'PERFECT',   colorClass: 'tier-perfect',        rating: '10' },
    { minLikeRatio: 99.9, tier: 'X',   colorClass: 'tier-x',        rating: '9.9' },
    { minLikeRatio: 99.8, tier: 'SSS', colorClass: 'tier-sss',      rating: '9.7' },
    { minLikeRatio: 99.5, tier: 'SS+', colorClass: 'tier-ss-plus',    rating: '9.4' },
    { minLikeRatio: 99.0, tier: 'SS',  colorClass: 'tier-ss',       rating: '9.0' },
    { minLikeRatio: 98.0, tier: 'S+',  colorClass: 'tier-s-plus',     rating: '8.5' },
    { minLikeRatio: 96.0, tier: 'S',   colorClass: 'tier-s',        rating: '8.0' },
    { minLikeRatio: 92.0, tier: 'A+',  colorClass: 'tier-a-plus',     rating: '7.5' },
    { minLikeRatio: 88.0, tier: 'A',   colorClass: 'tier-a',        rating: '7.0' },
    { minLikeRatio: 84.0, tier: 'A-',  colorClass: 'tier-a-minus',    rating: '6.5' },
    { minLikeRatio: 80.0, tier: 'B+',  colorClass: 'tier-b-plus',     rating: '6.0' },
    { minLikeRatio: 76.0, tier: 'B',   colorClass: 'tier-b',        rating: '5.5' },
    { minLikeRatio: 72.0, tier: 'B-',  colorClass: 'tier-b-minus',    rating: '5.0' },
    { minLikeRatio: 68.0, tier: 'C+',  colorClass: 'tier-c-plus',     rating: '4.5' },
    { minLikeRatio: 54.0, tier: 'C',   colorClass: 'tier-c',        rating: '4.0' },
    { minLikeRatio: 50.0, tier: 'C-',  colorClass: 'tier-c-minus',    rating: '3.5' },
    { minLikeRatio: 45.0, tier: 'D+',  colorClass: 'tier-d-plus',     rating: '3.0' },
    { minLikeRatio: 40.0, tier: 'D',   colorClass: 'tier-d',        rating: '2.5' },
    { minLikeRatio: 35.0, tier: 'D-',  colorClass: 'tier-d-minus',    rating: '2.0' },
    { minLikeRatio: 30.0, tier: 'E+',  colorClass: 'tier-e-plus',     rating: '1.5' },
    { minLikeRatio: 25.0, tier: 'E',   colorClass: 'tier-e',        rating: '1.0' },
    { minLikeRatio: 20.0, tier: 'E-',  colorClass: 'tier-e-minus',    rating: '0.5' },
    { minLikeRatio: 15.0, tier: 'F+',  colorClass: 'tier-f-plus',     rating: '0.3' },
    { minLikeRatio: 10.0, tier: 'F',   colorClass: 'tier-f',        rating: '0.2' },
    { minLikeRatio: 5, tier: 'F-',   colorClass: 'tier-f-minus',        rating: '0.1' },
    { minLikeRatio: 0, tier: 'N/A',   colorClass: 'tier-na',        rating: 'N/A' },
];
 // gunakan dari kode asli lo
function getTierData(likes, dislikes, views) {
    const total = likes + dislikes;
    const ratio = (likes / total) * 100;
    const engagement = views > 0 ? `${((total / views) * 100).toFixed(2)}%` : 'N/A';
    const tier = TIER_LADDER.find(t => ratio >= t.minLikeRatio) || { tier: 'N/A', colorClass: 'tier-na', rating: 'N/A' };
    return {
        tier: tier.tier,
        colorClass: tier.colorClass,
        likeRatio: ratio.toFixed(ratio > 95 ? 2 : 1) + '%',
        rating: tier.rating,
        totalVotes: total,
        engagementRate: engagement
    };
}

// --- BADGE INJECTION ---
function injectBadge(element, tierData, type) {
    element.querySelector('.tier-badge')?.remove();
    const lines = [];
    const add = (label, val, fmt = v => v) => {
        if (!val || val === 'N/A') return;
        const labelHtml = displaySettings.showLabels ? `<span class="tier-label">${label}:</span>` : '';
        lines.push(`<div class="tier-data-line">${labelHtml}<span>${fmt(val)}</span></div>`);
    };
    if (displaySettings.showTier) add('Tier', tierData.tier);
    if (displaySettings.showLikeRatio) add('Like Ratio', tierData.likeRatio);
    if (displaySettings.showRating) add('Rating', tierData.rating, r => `${r}/10`);
    if (displaySettings.showVotes) add('Total Votes', tierData.totalVotes, v => v.toLocaleString());
    if (displaySettings.showEngagementRate) add('Engagement Rate', tierData.engagementRate);

    const badge = document.createElement('div');
    badge.className = `tier-badge ${tierData.colorClass}`;
    badge.innerHTML = lines.join('');
    if (type === 'watch-bar') {
        badge.id = 'video-tier-bar-watch';
        element.querySelector('#actions')?.parentElement.insertBefore(badge, element.querySelector('#actions'));
    } else {
        badge.classList.add('video-tier-badge-thumbnail');
        element.querySelector('#meta, #details')?.appendChild(badge);
    }
}

// --- ELEMENT PROCESSOR ---
async function processElement(el) {
    const type = el.matches('ytd-watch-flexy') ? 'watch-bar' : 'thumbnail';
    const href = el.matches('ytd-watch-flexy') ? window.location.href : el.querySelector('a#thumbnail')?.href;
    const videoId = href?.match(/[?&]v=([^&]+)/)?.[1];
    if (!videoId || el.dataset.tierRatedId === videoId) return;
    el.dataset.tierRatedId = videoId;

    if (videoCache.has(videoId)) {
        const data = videoCache.get(videoId);
        injectBadge(el, data, type);
        processedElements.set(el, { tierData: data, type });
        return;
    }

    try {
        if (Date.now() < apiCooldownUntil) return;

        const cached = await getPersistentCache(videoId);
        if (cached) {
            videoCache.set(videoId, cached);
            injectBadge(el, cached, type);
            processedElements.set(el, { tierData: cached, type });
            return;
        }

        const views = getViewCount(el);
        const res = await limitedFetch(`https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`);
        if (res.status === 429) {
            console.warn('[Ratiometer] Rate limited! Cooling down...');
            apiCooldownUntil = Date.now() + 60000;
            return;
        }
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = await res.json();
        const data = getTierData(json.likes, json.dislikes, views);
        videoCache.set(videoId, data);
        setPersistentCache(videoId, data);
        injectBadge(el, data, type);
        processedElements.set(el, { tierData: data, type });
    } catch (err) {
        console.warn('RatioMeter error:', err);
        el.removeAttribute('data-tier-rated-id');
    }
}

// --- SCAN & OBSERVE ---
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            processElement(entry.target);
        }
    });
}, { rootMargin: '0px 0px 300px 0px' });

function scanPage() {
    document.querySelectorAll('ytd-watch-flexy, ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer')
        .forEach(el => observer.observe(el));
}

// --- INIT ---
(async function initialize() {
    await loadAndMonitorSettings();
    new MutationObserver(scanPage).observe(document.body, { childList: true, subtree: true });
    scanPage();
    console.log('✅ RatioMeter Hybrid Loaded');
})();
