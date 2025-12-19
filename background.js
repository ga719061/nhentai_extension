// Background Service Worker - Enhanced with retry, storage, and settings
console.log('[nhentai Downloader] Background service worker loaded');

// 由於 Service Worker 不支援 ES Modules，內聯工具函數

// ==================== 重試機制 ====================

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const ERROR_MESSAGES = {
    429: '請求過於頻繁，請稍後再試',
    403: '存取被拒絕，請確認登入狀態',
    404: '資源不存在',
    500: '伺服器錯誤',
    502: '伺服器暫時無法連線',
    503: '服務暫時不可用',
    0: '網路連線失敗，請檢查網路'
};

function getFriendlyErrorMessage(error) {
    if (error instanceof Response) {
        return ERROR_MESSAGES[error.status] || `HTTP 錯誤 ${error.status}`;
    }
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        return ERROR_MESSAGES[0];
    }
    return error.message || '未知錯誤';
}

async function fetchWithRetry(url, options = {}, config = {}) {
    const {
        maxRetries = 3,
        baseDelayMs = 1000,
        retryOnStatus = [429, 500, 502, 503]
    } = config;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);

            if (response.ok || !retryOnStatus.includes(response.status)) {
                return response;
            }

            lastError = response;

            if (attempt < maxRetries) {
                const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
                const jitter = Math.random() * 500;
                const delayMs = Math.min(exponentialDelay + jitter, 30000);

                // 檢查 Retry-After header
                const retryAfter = response.headers.get('Retry-After');
                if (retryAfter) {
                    const seconds = parseInt(retryAfter, 10);
                    if (!isNaN(seconds)) {
                        await delay(seconds * 1000);
                        continue;
                    }
                }

                console.log(`[Retry] Attempt ${attempt + 1}/${maxRetries + 1} failed with ${response.status}, retrying in ${Math.round(delayMs)}ms...`);
                await delay(delayMs);
            }
        } catch (networkError) {
            lastError = networkError;

            if (attempt < maxRetries) {
                const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
                console.log(`[Retry] Attempt ${attempt + 1}/${maxRetries + 1} network error, retrying in ${Math.round(delayMs)}ms...`);
                await delay(delayMs);
            }
        }
    }

    if (lastError instanceof Response) {
        throw new Error(`HTTP ${lastError.status}: ${getFriendlyErrorMessage(lastError)}`);
    }
    throw lastError;
}

// ==================== 設定管理 ====================

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'downloadHistory';
const MAX_HISTORY_ITEMS = 100;

const DEFAULT_SETTINGS = {
    concurrentDownloads: 5,
    imageQuality: 90,
    outputFormat: 'jpg', // 'jpg' | 'png' | 'original'
    filenameTemplate: '{title}',
    createSubfolders: true,
    showNotifications: true
};

async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get([SETTINGS_KEY], (result) => {
            resolve({ ...DEFAULT_SETTINGS, ...result[SETTINGS_KEY] });
        });
    });
}

async function addHistoryRecord(record) {
    return new Promise((resolve) => {
        chrome.storage.local.get([HISTORY_KEY], (result) => {
            const history = result[HISTORY_KEY] || [];

            const existingIndex = history.findIndex(h => h.galleryId === record.galleryId);
            if (existingIndex !== -1) {
                history[existingIndex] = {
                    ...history[existingIndex],
                    ...record,
                    downloadedAt: Date.now(),
                    downloadCount: (history[existingIndex].downloadCount || 1) + 1
                };
            } else {
                history.unshift({
                    ...record,
                    downloadedAt: Date.now(),
                    downloadCount: 1
                });
            }

            const trimmedHistory = history.slice(0, MAX_HISTORY_ITEMS);
            chrome.storage.local.set({ [HISTORY_KEY]: trimmedHistory }, resolve);
        });
    });
}

// ==================== 訊息處理 ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fetchImage') {
        fetchImageAsJpegBase64(message.url, message.convertToJpg, message.quality)
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({
                success: false,
                error: err.message,
                friendlyError: getFriendlyErrorMessage(err)
            }));
        return true;
    }

    if (message.action === 'fetchGalleryData') {
        fetchWithRetry(`https://nhentai.net/api/gallery/${message.galleryId}`, {
            credentials: 'include'
        })
            .then(res => res.json())
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({
                success: false,
                error: err.message,
                friendlyError: getFriendlyErrorMessage(err)
            }));
        return true;
    }

    if (message.action === 'getSettings') {
        getSettings().then(settings => sendResponse({ success: true, settings }));
        return true;
    }

    if (message.action === 'saveSettings') {
        chrome.storage.local.get([SETTINGS_KEY], (result) => {
            const updated = { ...DEFAULT_SETTINGS, ...result[SETTINGS_KEY], ...message.settings };
            chrome.storage.local.set({ [SETTINGS_KEY]: updated }, () => {
                sendResponse({ success: true });
            });
        });
        return true;
    }

    if (message.action === 'addHistory') {
        addHistoryRecord(message.record)
            .then(() => sendResponse({ success: true }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (message.action === 'getHistory') {
        chrome.storage.local.get([HISTORY_KEY], (result) => {
            sendResponse({ success: true, history: result[HISTORY_KEY] || [] });
        });
        return true;
    }

    if (message.action === 'clearHistory') {
        chrome.storage.local.remove([HISTORY_KEY], () => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (message.action === 'getDownloadedIds') {
        chrome.storage.local.get([HISTORY_KEY], (result) => {
            const history = result[HISTORY_KEY] || [];
            const downloadedIds = history.map(h => h.galleryId);
            sendResponse({ success: true, downloadedIds });
        });
        return true;
    }
});

async function fetchImageAsJpegBase64(url, convertToJpg = true, quality = 90) {
    console.log('[nhentai Downloader] Fetching:', url);

    const response = await fetchWithRetry(url, {
        method: 'GET',
        credentials: 'include'
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();

    // 根據設定決定是否轉換格式
    if (convertToJpg && !blob.type.includes('jpeg') && !blob.type.includes('jpg')) {
        try {
            const imageBitmap = await createImageBitmap(blob);
            const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imageBitmap, 0, 0);

            const normalizedQuality = quality / 100;
            const jpegBlob = await canvas.convertToBlob({
                type: 'image/jpeg',
                quality: normalizedQuality
            });

            const arrayBuffer = await jpegBlob.arrayBuffer();
            const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
            return `data:image/jpeg;base64,${base64}`;
        } catch (conversionError) {
            console.warn('[nhentai Downloader] Conversion failed, returning original:', conversionError);
        }
    }

    // 返回原始格式
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// 右鍵選單
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'nhd-download-single',
        title: '📥 下載此漫畫',
        contexts: ['link'],
        documentUrlPatterns: ['*://*.nhentai.net/*'],
        targetUrlPatterns: ['*://*.nhentai.net/g/*']
    });

    chrome.contextMenus.create({
        id: 'nhd-download-selected',
        title: '📥 下載已選漫畫',
        contexts: ['page'],
        documentUrlPatterns: ['*://*.nhentai.net/favorites/*', '*://*.nhentai.net/search/*', '*://*.nhentai.net/tag/*', '*://*.nhentai.net/artist/*']
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'nhd-download-single') {
        const match = info.linkUrl.match(/\/g\/(\d+)/);
        if (match) {
            chrome.tabs.sendMessage(tab.id, {
                action: 'downloadGallery',
                galleryId: match[1]
            });
        }
    } else if (info.menuItemId === 'nhd-download-selected') {
        chrome.tabs.sendMessage(tab.id, {
            action: 'downloadSelected'
        });
    }
});
