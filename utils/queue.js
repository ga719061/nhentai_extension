// 下載佇列管理模組
// 提供佇列狀態追蹤、事件通知、失敗項目重試

/**
 * 下載項目狀態
 */
export const QueueItemStatus = {
    PENDING: 'pending',
    DOWNLOADING: 'downloading',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
};

/**
 * 下載佇列管理器
 */
export class DownloadQueue {
    constructor() {
        this.items = new Map(); // id -> QueueItem
        this.order = []; // 維持順序的 ID 陣列
        this.listeners = new Set();
        this.isProcessing = false;
    }

    /**
     * 新增項目到佇列
     * @param {Object} item - 佇列項目
     * @param {string} item.id - Gallery ID
     * @param {string} item.title - 標題
     * @param {number} item.pageCount - 頁數（可選）
     */
    add(item) {
        if (this.items.has(item.id)) {
            return false; // 已存在
        }

        const queueItem = {
            id: item.id,
            title: item.title,
            pageCount: item.pageCount || 0,
            status: QueueItemStatus.PENDING,
            progress: 0, // 0-100
            currentPage: 0,
            error: null,
            addedAt: Date.now(),
            startedAt: null,
            completedAt: null,
            retryCount: 0
        };

        this.items.set(item.id, queueItem);
        this.order.push(item.id);
        this._notify('add', queueItem);
        return true;
    }

    /**
     * 批量新增項目
     * @param {Array} items - 佇列項目陣列
     */
    addBatch(items) {
        items.forEach(item => this.add(item));
    }

    /**
     * 移除項目
     * @param {string} id - Gallery ID
     */
    remove(id) {
        const item = this.items.get(id);
        if (item) {
            this.items.delete(id);
            this.order = this.order.filter(i => i !== id);
            this._notify('remove', item);
        }
    }

    /**
     * 更新項目狀態
     * @param {string} id - Gallery ID
     * @param {Object} updates - 更新內容
     */
    update(id, updates) {
        const item = this.items.get(id);
        if (item) {
            Object.assign(item, updates);

            if (updates.status === QueueItemStatus.DOWNLOADING && !item.startedAt) {
                item.startedAt = Date.now();
            }
            if (updates.status === QueueItemStatus.COMPLETED || updates.status === QueueItemStatus.FAILED) {
                item.completedAt = Date.now();
            }

            this._notify('update', item);
        }
    }

    /**
     * 更新下載進度
     * @param {string} id - Gallery ID
     * @param {number} currentPage - 當前頁數
     * @param {number} totalPages - 總頁數
     */
    updateProgress(id, currentPage, totalPages) {
        this.update(id, {
            currentPage,
            pageCount: totalPages,
            progress: Math.round((currentPage / totalPages) * 100)
        });
    }

    /**
     * 標記項目為下載中
     * @param {string} id - Gallery ID
     */
    startDownload(id) {
        this.update(id, { status: QueueItemStatus.DOWNLOADING });
    }

    /**
     * 標記項目完成
     * @param {string} id - Gallery ID
     * @param {Object} meta - 額外資訊（如 fileSize）
     */
    complete(id, meta = {}) {
        this.update(id, {
            status: QueueItemStatus.COMPLETED,
            progress: 100,
            ...meta
        });
    }

    /**
     * 標記項目失敗
     * @param {string} id - Gallery ID
     * @param {string} error - 錯誤訊息
     */
    fail(id, error) {
        const item = this.items.get(id);
        if (item) {
            this.update(id, {
                status: QueueItemStatus.FAILED,
                error,
                retryCount: item.retryCount + 1
            });
        }
    }

    /**
     * 取消下載
     * @param {string} id - Gallery ID（可選，不傳則取消全部）
     */
    cancel(id = null) {
        if (id) {
            this.update(id, { status: QueueItemStatus.CANCELLED });
        } else {
            // 取消所有進行中和等待中的項目
            this.items.forEach((item, itemId) => {
                if (item.status === QueueItemStatus.PENDING || item.status === QueueItemStatus.DOWNLOADING) {
                    this.update(itemId, { status: QueueItemStatus.CANCELLED });
                }
            });
        }
    }

    /**
     * 重試失敗的項目
     * @param {string} id - Gallery ID（可選，不傳則重試全部失敗項目）
     */
    retry(id = null) {
        if (id) {
            const item = this.items.get(id);
            if (item && item.status === QueueItemStatus.FAILED) {
                this.update(id, {
                    status: QueueItemStatus.PENDING,
                    error: null,
                    progress: 0,
                    currentPage: 0
                });
            }
        } else {
            this.items.forEach((item, itemId) => {
                if (item.status === QueueItemStatus.FAILED) {
                    this.retry(itemId);
                }
            });
        }
    }

    /**
     * 取得下一個待處理項目
     * @returns {Object|null} 佇列項目
     */
    getNext() {
        for (const id of this.order) {
            const item = this.items.get(id);
            if (item && item.status === QueueItemStatus.PENDING) {
                return item;
            }
        }
        return null;
    }

    /**
     * 取得所有項目
     * @returns {Array} 項目陣列（按順序）
     */
    getAll() {
        return this.order.map(id => this.items.get(id)).filter(Boolean);
    }

    /**
     * 取得特定狀態的項目
     * @param {string} status - 狀態
     * @returns {Array}
     */
    getByStatus(status) {
        return this.getAll().filter(item => item.status === status);
    }

    /**
     * 取得統計數據
     * @returns {Object}
     */
    getStats() {
        const items = this.getAll();
        return {
            total: items.length,
            pending: items.filter(i => i.status === QueueItemStatus.PENDING).length,
            downloading: items.filter(i => i.status === QueueItemStatus.DOWNLOADING).length,
            completed: items.filter(i => i.status === QueueItemStatus.COMPLETED).length,
            failed: items.filter(i => i.status === QueueItemStatus.FAILED).length,
            cancelled: items.filter(i => i.status === QueueItemStatus.CANCELLED).length
        };
    }

    /**
     * 清除已完成的項目
     */
    clearCompleted() {
        const toRemove = [];
        this.items.forEach((item, id) => {
            if (item.status === QueueItemStatus.COMPLETED) {
                toRemove.push(id);
            }
        });
        toRemove.forEach(id => this.remove(id));
    }

    /**
     * 清除所有項目
     */
    clear() {
        this.items.clear();
        this.order = [];
        this._notify('clear', null);
    }

    /**
     * 調整項目順序
     * @param {string} id - Gallery ID
     * @param {number} newIndex - 新位置
     */
    reorder(id, newIndex) {
        const currentIndex = this.order.indexOf(id);
        if (currentIndex === -1) return;

        this.order.splice(currentIndex, 1);
        this.order.splice(newIndex, 0, id);
        this._notify('reorder', { id, from: currentIndex, to: newIndex });
    }

    /**
     * 監聽佇列變化
     * @param {function} callback - 回呼函數 (eventType, data)
     * @returns {function} 取消監聽函數
     */
    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    /**
     * 通知所有監聽器
     * @private
     */
    _notify(eventType, data) {
        this.listeners.forEach(callback => {
            try {
                callback(eventType, data, this.getStats());
            } catch (e) {
                console.error('[Queue] Listener error:', e);
            }
        });
    }
}

// 匯出單例
export const downloadQueue = new DownloadQueue();
