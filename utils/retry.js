// 自動重試機制工具模組
// 提供指數退避重試邏輯與友善錯誤訊息

/**
 * 延遲函數
 * @param {number} ms - 毫秒數
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 錯誤訊息對照表
 */
const ERROR_MESSAGES = {
    429: '請求過於頻繁，請稍後再試',
    403: '存取被拒絕，請確認登入狀態',
    404: '資源不存在',
    500: '伺服器錯誤',
    502: '伺服器暫時無法連線',
    503: '服務暫時不可用',
    0: '網路連線失敗，請檢查網路'
};

/**
 * 取得友善的錯誤訊息
 * @param {Error|Response} error - 錯誤物件或 Response
 * @returns {string} 友善的錯誤訊息
 */
export function getFriendlyErrorMessage(error) {
    if (error instanceof Response) {
        return ERROR_MESSAGES[error.status] || `HTTP 錯誤 ${error.status}`;
    }
    if (error.message?.includes('Failed to fetch')) {
        return ERROR_MESSAGES[0];
    }
    if (error.message?.includes('NetworkError')) {
        return ERROR_MESSAGES[0];
    }
    return error.message || '未知錯誤';
}

/**
 * 帶有自動重試機制的 fetch
 * @param {string} url - 請求 URL
 * @param {RequestInit} options - fetch 選項
 * @param {Object} config - 重試設定
 * @param {number} config.maxRetries - 最大重試次數（預設 3）
 * @param {number} config.baseDelayMs - 基礎延遲毫秒（預設 1000）
 * @param {number[]} config.retryOnStatus - 要重試的 HTTP 狀態碼（預設 [429, 500, 502, 503]）
 * @param {function} config.onRetry - 重試時的回呼函數
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, config = {}) {
    const {
        maxRetries = 3,
        baseDelayMs = 1000,
        retryOnStatus = [429, 500, 502, 503],
        onRetry = null
    } = config;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);

            // 成功或非重試狀態碼
            if (response.ok || !retryOnStatus.includes(response.status)) {
                return response;
            }

            // 需要重試的狀態碼
            lastError = response;

            if (attempt < maxRetries) {
                const delayMs = calculateBackoff(attempt, baseDelayMs, response);
                console.log(`[Retry] Attempt ${attempt + 1}/${maxRetries + 1} failed with ${response.status}, retrying in ${delayMs}ms...`);

                if (onRetry) {
                    onRetry({
                        attempt: attempt + 1,
                        maxRetries,
                        status: response.status,
                        delayMs,
                        message: getFriendlyErrorMessage(response)
                    });
                }

                await delay(delayMs);
            }
        } catch (networkError) {
            lastError = networkError;

            if (attempt < maxRetries) {
                const delayMs = calculateBackoff(attempt, baseDelayMs);
                console.log(`[Retry] Attempt ${attempt + 1}/${maxRetries + 1} failed with network error, retrying in ${delayMs}ms...`);

                if (onRetry) {
                    onRetry({
                        attempt: attempt + 1,
                        maxRetries,
                        status: 0,
                        delayMs,
                        message: getFriendlyErrorMessage(networkError)
                    });
                }

                await delay(delayMs);
            }
        }
    }

    // 所有重試都失敗
    if (lastError instanceof Response) {
        throw new Error(`HTTP ${lastError.status}: ${getFriendlyErrorMessage(lastError)}`);
    }
    throw lastError;
}

/**
 * 計算指數退避延遲
 * @param {number} attempt - 當前嘗試次數（從 0 開始）
 * @param {number} baseDelayMs - 基礎延遲
 * @param {Response} response - HTTP Response（用於讀取 Retry-After header）
 * @returns {number} 延遲毫秒數
 */
function calculateBackoff(attempt, baseDelayMs, response = null) {
    // 優先使用 Retry-After header
    if (response) {
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds)) {
                return seconds * 1000;
            }
        }
    }

    // 指數退避 + 隨機抖動
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 500;
    return Math.min(exponentialDelay + jitter, 30000); // 最大 30 秒
}
