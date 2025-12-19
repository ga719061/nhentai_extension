// 儲存模組 - 管理下載歷史與設定
// 使用 chrome.storage.local（不同步）

const HISTORY_KEY = 'downloadHistory';
const SETTINGS_KEY = 'settings';
const MAX_HISTORY_ITEMS = 100;

/**
 * 預設設定
 */
const DEFAULT_SETTINGS = {
    concurrentDownloads: 5,
    imageQuality: 90,
    outputFormat: 'jpg', // 'jpg' | 'png' | 'original'
    filenameTemplate: '{title}',
    createSubfolders: true,
    showNotifications: true
};

// ==================== 歷史記錄 ====================

/**
 * 取得下載歷史記錄
 * @returns {Promise<Array>} 歷史記錄陣列
 */
export async function getHistory() {
    return new Promise((resolve) => {
        chrome.storage.local.get([HISTORY_KEY], (result) => {
            resolve(result[HISTORY_KEY] || []);
        });
    });
}

/**
 * 新增下載記錄
 * @param {Object} record - 下載記錄
 * @param {string} record.galleryId - Gallery ID
 * @param {string} record.title - 標題
 * @param {number} record.pageCount - 頁數
 * @param {number} record.fileSize - 檔案大小（bytes）
 */
export async function addHistoryRecord(record) {
    const history = await getHistory();

    // 檢查是否已存在（避免重複）
    const existingIndex = history.findIndex(h => h.galleryId === record.galleryId);
    if (existingIndex !== -1) {
        // 更新現有記錄
        history[existingIndex] = {
            ...history[existingIndex],
            ...record,
            downloadedAt: Date.now(),
            downloadCount: (history[existingIndex].downloadCount || 1) + 1
        };
    } else {
        // 新增記錄
        history.unshift({
            ...record,
            downloadedAt: Date.now(),
            downloadCount: 1
        });
    }

    // 限制最大數量
    const trimmedHistory = history.slice(0, MAX_HISTORY_ITEMS);

    return new Promise((resolve) => {
        chrome.storage.local.set({ [HISTORY_KEY]: trimmedHistory }, resolve);
    });
}

/**
 * 檢查 Gallery 是否已下載過
 * @param {string} galleryId - Gallery ID
 * @returns {Promise<boolean>}
 */
export async function isDownloaded(galleryId) {
    const history = await getHistory();
    return history.some(h => h.galleryId === galleryId);
}

/**
 * 批量檢查多個 Gallery 的下載狀態
 * @param {string[]} galleryIds - Gallery ID 陣列
 * @returns {Promise<Set<string>>} 已下載的 ID Set
 */
export async function getDownloadedIds(galleryIds) {
    const history = await getHistory();
    const downloadedSet = new Set(history.map(h => h.galleryId));
    return new Set(galleryIds.filter(id => downloadedSet.has(id)));
}

/**
 * 刪除單筆歷史記錄
 * @param {string} galleryId - Gallery ID
 */
export async function removeHistoryRecord(galleryId) {
    const history = await getHistory();
    const filtered = history.filter(h => h.galleryId !== galleryId);

    return new Promise((resolve) => {
        chrome.storage.local.set({ [HISTORY_KEY]: filtered }, resolve);
    });
}

/**
 * 清除所有歷史記錄
 */
export async function clearHistory() {
    return new Promise((resolve) => {
        chrome.storage.local.remove([HISTORY_KEY], resolve);
    });
}

/**
 * 匯出歷史記錄為 JSON
 * @returns {Promise<string>} JSON 字串
 */
export async function exportHistory() {
    const history = await getHistory();
    return JSON.stringify(history, null, 2);
}

// ==================== 設定 ====================

/**
 * 取得設定
 * @returns {Promise<Object>} 設定物件
 */
export async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get([SETTINGS_KEY], (result) => {
            resolve({ ...DEFAULT_SETTINGS, ...result[SETTINGS_KEY] });
        });
    });
}

/**
 * 儲存設定
 * @param {Object} settings - 設定物件（部分或全部）
 */
export async function saveSettings(settings) {
    const current = await getSettings();
    const updated = { ...current, ...settings };

    return new Promise((resolve) => {
        chrome.storage.local.set({ [SETTINGS_KEY]: updated }, resolve);
    });
}

/**
 * 重置設定為預設值
 */
export async function resetSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS }, resolve);
    });
}

/**
 * 取得預設設定
 * @returns {Object}
 */
export function getDefaultSettings() {
    return { ...DEFAULT_SETTINGS };
}
