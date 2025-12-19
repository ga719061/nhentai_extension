// nhentai Downloader Content Script - Full Optimization Version
// Features: Queue management, download history, settings, multi-page support, infinite scroll
(function () {
    'use strict';

    // ==================== 狀態管理 ====================
    const selectedGalleries = new Set();
    let isDownloading = false;
    let shouldCancel = false;
    let downloadedIds = new Set();
    let settings = null;
    let queueSidebar = null;

    // 佇列狀態
    const QueueItemStatus = {
        PENDING: 'pending',
        DOWNLOADING: 'downloading',
        COMPLETED: 'completed',
        FAILED: 'failed',
        CANCELLED: 'cancelled'
    };
    const queueItems = new Map();
    const queueOrder = [];

    // ==================== 初始化 ====================
    async function init() {
        // 載入設定
        settings = await loadSettings();

        // 載入已下載記錄
        downloadedIds = await loadDownloadedIds();

        // 根據頁面類型初始化
        const path = window.location.pathname;
        if (path.includes('/g/')) {
            initGalleryPage();
        } else if (isListPage()) {
            initListPage();
            observeNewGalleries();
        }

        // 監聽來自 background 的訊息
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'downloadGallery') {
                downloadSingleGallery(message.galleryId);
            } else if (message.action === 'downloadSelected') {
                downloadSelected();
            }
        });
    }

    function isListPage() {
        const path = window.location.pathname;
        return path.includes('/favorites') ||
            path.includes('/search') ||
            path.includes('/tag/') ||
            path.includes('/artist/') ||
            path.includes('/character/') ||
            path.includes('/parody/') ||
            path.includes('/group/') ||
            path === '/' ||
            path.match(/^\/\?/);
    }

    // ==================== 設定與歷史記錄 ====================
    async function loadSettings() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
                resolve(response?.settings || {
                    concurrentDownloads: 5,
                    imageQuality: 90,
                    outputFormat: 'jpg',
                    createSubfolders: true
                });
            });
        });
    }

    async function loadDownloadedIds() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getDownloadedIds' }, (response) => {
                resolve(new Set(response?.downloadedIds || []));
            });
        });
    }

    async function addToHistory(record) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'addHistory', record }, resolve);
        });
    }

    // ==================== 單一 Gallery 頁面 ====================
    function initGalleryPage() {
        console.log('[nhentai Downloader] Initializing gallery page...');

        const buttonsContainer = document.querySelector('#info .buttons');
        if (!buttonsContainer) return;

        const galleryId = window.location.pathname.match(/\/g\/(\d+)/)?.[1];
        const isDownloadedBefore = downloadedIds.has(galleryId);

        const downloadBtn = document.createElement('a');
        downloadBtn.className = 'btn btn-primary nhd-single-download';
        downloadBtn.innerHTML = isDownloadedBefore
            ? '<i class="fa fa-check"></i> 已下載 (重新下載)'
            : '<i class="fa fa-download"></i> 下載為 ZIP';
        downloadBtn.href = '#';

        if (isDownloadedBefore) {
            downloadBtn.style.opacity = '0.7';
        }

        downloadBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (galleryId) {
                const title = document.querySelector('#info h1')?.textContent || `Gallery ${galleryId}`;
                await downloadGalleryAsZip(galleryId, title, downloadBtn);
            }
        });

        buttonsContainer.appendChild(downloadBtn);
    }

    // ==================== 列表頁面（收藏夾、搜尋等）====================
    function initListPage() {
        console.log('[nhentai Downloader] Initializing list page...');

        // 為所有 gallery 添加 checkbox
        const galleries = document.querySelectorAll('.gallery');
        galleries.forEach(gallery => addCheckboxToGallery(gallery));

        // 建立工具列
        createToolbar();

        // 建立佇列側邊欄
        createQueueSidebar();

        // 快捷鍵提示
        showShortcutHint();

        // 鍵盤快捷鍵
        setupKeyboardShortcuts();
    }

    function addCheckboxToGallery(gallery) {
        if (gallery.querySelector('.nhd-checkbox-overlay')) return;

        const link = gallery.querySelector('a');
        if (!link) return;

        const galleryId = link.href.match(/\/g\/(\d+)/)?.[1];
        if (!galleryId) return;

        gallery.style.position = 'relative';

        const isDownloadedBefore = downloadedIds.has(galleryId);

        const checkboxOverlay = document.createElement('div');
        checkboxOverlay.className = 'nhd-checkbox-overlay';
        checkboxOverlay.innerHTML = `
            <div class="nhd-checkbox" data-id="${galleryId}"></div>
            ${isDownloadedBefore ? '<div class="nhd-downloaded-badge">✓</div>' : ''}
        `;

        checkboxOverlay.querySelector('.nhd-checkbox').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSelection(galleryId, e.target);
        });

        gallery.prepend(checkboxOverlay);
    }

    // 使用 MutationObserver 監聽動態載入的內容
    function observeNewGalleries() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.classList?.contains('gallery')) {
                            addCheckboxToGallery(node);
                        }
                        // 也檢查子元素
                        node.querySelectorAll?.('.gallery').forEach(gallery => {
                            addCheckboxToGallery(gallery);
                        });
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function createToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 'nhd-toolbar';
        toolbar.innerHTML = `
            <button class="nhd-btn nhd-btn-secondary" id="nhd-toggle-queue" title="顯示佇列">
                📋
            </button>
            <button class="nhd-btn nhd-btn-secondary" id="nhd-select-all">
                ☑️ 全選 <kbd>A</kbd>
            </button>
            <button class="nhd-btn nhd-btn-primary" id="nhd-download-selected" disabled>
                📥 下載已選 (0)
            </button>
        `;
        document.body.appendChild(toolbar);

        document.getElementById('nhd-toggle-queue').addEventListener('click', toggleQueueSidebar);
        document.getElementById('nhd-select-all').addEventListener('click', selectAll);
        document.getElementById('nhd-download-selected').addEventListener('click', downloadSelected);
    }

    function createQueueSidebar() {
        queueSidebar = document.createElement('div');
        queueSidebar.className = 'nhd-queue-sidebar';
        queueSidebar.innerHTML = `
            <div class="nhd-queue-header">
                <h3>📋 下載佇列</h3>
                <button class="nhd-queue-close" id="nhd-queue-close">×</button>
            </div>
            <div class="nhd-queue-stats">
                <span id="nhd-queue-stats-text">等待中: 0 | 完成: 0</span>
            </div>
            <div class="nhd-queue-list" id="nhd-queue-list"></div>
            <div class="nhd-queue-actions">
                <button class="nhd-btn nhd-btn-secondary nhd-btn-small" id="nhd-retry-failed" disabled>
                    🔄 重試失敗
                </button>
                <button class="nhd-btn nhd-btn-secondary nhd-btn-small" id="nhd-clear-completed">
                    🗑️ 清除完成
                </button>
            </div>
        `;
        document.body.appendChild(queueSidebar);

        document.getElementById('nhd-queue-close').addEventListener('click', () => {
            queueSidebar.classList.remove('visible');
        });
        document.getElementById('nhd-retry-failed').addEventListener('click', retryFailed);
        document.getElementById('nhd-clear-completed').addEventListener('click', clearCompletedQueue);
    }

    function toggleQueueSidebar() {
        queueSidebar.classList.toggle('visible');
    }

    function showShortcutHint() {
        const hint = document.createElement('div');
        hint.className = 'nhd-shortcut-hint';
        hint.innerHTML = '快捷鍵: <kbd>A</kbd> 全選 | <kbd>D</kbd> 下載 | <kbd>Q</kbd> 佇列 | <kbd>Esc</kbd> 取消';
        document.body.appendChild(hint);
        setTimeout(() => hint.style.opacity = '0', 5000);
        setTimeout(() => hint.remove(), 5500);
    }

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'a' || e.key === 'A') {
                e.preventDefault();
                selectAll();
            } else if (e.key === 'd' || e.key === 'D') {
                e.preventDefault();
                if (selectedGalleries.size > 0 && !isDownloading) {
                    downloadSelected();
                }
            } else if (e.key === 'q' || e.key === 'Q') {
                e.preventDefault();
                toggleQueueSidebar();
            } else if (e.key === 'Escape') {
                if (isDownloading) {
                    shouldCancel = true;
                } else {
                    clearSelection();
                }
            }
        });
    }

    // ==================== 選擇邏輯 ====================
    function toggleSelection(galleryId, checkbox) {
        if (selectedGalleries.has(galleryId)) {
            selectedGalleries.delete(galleryId);
            checkbox.classList.remove('checked');
        } else {
            selectedGalleries.add(galleryId);
            checkbox.classList.add('checked');
        }
        updateDownloadButton();
    }

    function selectAll() {
        const checkboxes = document.querySelectorAll('.nhd-checkbox');
        const allSelected = selectedGalleries.size === checkboxes.length;

        checkboxes.forEach(checkbox => {
            const id = checkbox.dataset.id;
            if (allSelected) {
                selectedGalleries.delete(id);
                checkbox.classList.remove('checked');
            } else {
                selectedGalleries.add(id);
                checkbox.classList.add('checked');
            }
        });

        updateDownloadButton();
    }

    function clearSelection() {
        const checkboxes = document.querySelectorAll('.nhd-checkbox');
        checkboxes.forEach(checkbox => {
            selectedGalleries.delete(checkbox.dataset.id);
            checkbox.classList.remove('checked');
        });
        updateDownloadButton();
    }

    function updateDownloadButton() {
        const btn = document.getElementById('nhd-download-selected');
        if (btn) {
            btn.disabled = selectedGalleries.size === 0 || isDownloading;
            btn.textContent = `📥 下載已選 (${selectedGalleries.size})`;
        }
    }

    // ==================== Toast 通知 ====================
    function showToast(message, isError = false) {
        const toast = document.createElement('div');
        toast.className = `nhd-toast ${isError ? 'error' : ''}`;
        toast.innerHTML = `<span>${isError ? '❌' : '✅'}</span><span>${message}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // ==================== 佇列 UI ====================
    function addToQueue(id, title) {
        if (queueItems.has(id)) return;

        queueItems.set(id, {
            id,
            title,
            status: QueueItemStatus.PENDING,
            progress: 0,
            currentPage: 0,
            totalPages: 0,
            error: null
        });
        queueOrder.push(id);
        renderQueueList();
    }

    function updateQueueItem(id, updates) {
        const item = queueItems.get(id);
        if (item) {
            Object.assign(item, updates);
            renderQueueList();
        }
    }

    function renderQueueList() {
        const listEl = document.getElementById('nhd-queue-list');
        if (!listEl) return;

        const stats = getQueueStats();
        const statsEl = document.getElementById('nhd-queue-stats-text');
        if (statsEl) {
            statsEl.textContent = `等待: ${stats.pending} | 下載中: ${stats.downloading} | 完成: ${stats.completed} | 失敗: ${stats.failed}`;
        }

        const retryBtn = document.getElementById('nhd-retry-failed');
        if (retryBtn) {
            retryBtn.disabled = stats.failed === 0;
        }

        listEl.innerHTML = queueOrder.map(id => {
            const item = queueItems.get(id);
            if (!item) return '';

            const statusIcon = {
                [QueueItemStatus.PENDING]: '⏳',
                [QueueItemStatus.DOWNLOADING]: '⬇️',
                [QueueItemStatus.COMPLETED]: '✅',
                [QueueItemStatus.FAILED]: '❌',
                [QueueItemStatus.CANCELLED]: '🚫'
            }[item.status];

            const progressBar = item.status === QueueItemStatus.DOWNLOADING
                ? `<div class="nhd-queue-progress"><div class="nhd-queue-progress-fill" style="width: ${item.progress}%"></div></div>`
                : '';

            const detail = item.status === QueueItemStatus.DOWNLOADING
                ? `${item.currentPage}/${item.totalPages} 頁`
                : item.status === QueueItemStatus.FAILED
                    ? item.error
                    : '';

            return `
                <div class="nhd-queue-item ${item.status}">
                    <span class="nhd-queue-status">${statusIcon}</span>
                    <div class="nhd-queue-info">
                        <div class="nhd-queue-title">${escapeHtml(item.title.substring(0, 40))}${item.title.length > 40 ? '...' : ''}</div>
                        ${progressBar}
                        ${detail ? `<div class="nhd-queue-detail">${escapeHtml(detail)}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    function getQueueStats() {
        const items = Array.from(queueItems.values());
        return {
            total: items.length,
            pending: items.filter(i => i.status === QueueItemStatus.PENDING).length,
            downloading: items.filter(i => i.status === QueueItemStatus.DOWNLOADING).length,
            completed: items.filter(i => i.status === QueueItemStatus.COMPLETED).length,
            failed: items.filter(i => i.status === QueueItemStatus.FAILED).length
        };
    }

    function retryFailed() {
        queueItems.forEach((item, id) => {
            if (item.status === QueueItemStatus.FAILED) {
                item.status = QueueItemStatus.PENDING;
                item.error = null;
                item.progress = 0;
            }
        });
        renderQueueList();
        // 如果沒有在下載，重新開始
        if (!isDownloading) {
            processQueue();
        }
    }

    function clearCompletedQueue() {
        const toRemove = [];
        queueItems.forEach((item, id) => {
            if (item.status === QueueItemStatus.COMPLETED) {
                toRemove.push(id);
            }
        });
        toRemove.forEach(id => {
            queueItems.delete(id);
            const idx = queueOrder.indexOf(id);
            if (idx !== -1) queueOrder.splice(idx, 1);
        });
        renderQueueList();
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== 下載邏輯 ====================
    async function downloadSelected() {
        const ids = Array.from(selectedGalleries);
        if (ids.length === 0 || isDownloading) return;

        isDownloading = true;
        shouldCancel = false;
        updateDownloadButton();

        // 顯示佇列側邊欄
        queueSidebar.classList.add('visible');

        // 添加到佇列
        for (const id of ids) {
            const galleryEl = document.querySelector(`.nhd-checkbox[data-id="${id}"]`)?.closest('.gallery');
            const title = galleryEl?.querySelector('.caption')?.textContent || `Gallery ${id}`;
            addToQueue(id, title);
        }

        showProgressModal(ids.length);
        await processQueue();
    }

    async function downloadSingleGallery(galleryId) {
        if (isDownloading) {
            showToast('已有下載進行中', true);
            return;
        }

        try {
            const { data } = await sendMessage({ action: 'fetchGalleryData', galleryId });
            const title = data.title.pretty || data.title.english || `Gallery ${galleryId}`;

            addToQueue(galleryId, title);
            queueSidebar.classList.add('visible');

            isDownloading = true;
            showProgressModal(1);
            await processQueue();
        } catch (err) {
            showToast(`無法取得漫畫資訊: ${err.message}`, true);
        }
    }

    async function processQueue() {
        const masterZip = new JSZip();
        let successCount = 0;
        let failCount = 0;
        let processedCount = 0;

        const pendingItems = queueOrder.filter(id => {
            const item = queueItems.get(id);
            return item && item.status === QueueItemStatus.PENDING;
        });

        const totalItems = pendingItems.length;

        for (const id of pendingItems) {
            if (shouldCancel) {
                updateQueueItem(id, { status: QueueItemStatus.CANCELLED });
                continue;
            }

            const item = queueItems.get(id);
            if (!item) continue;

            updateQueueItem(id, { status: QueueItemStatus.DOWNLOADING });
            updateProgress(processedCount + 1, totalItems, `正在下載: ${item.title}`, '獲取元資料...');

            try {
                await downloadGalleryToZip(id, item.title, masterZip, (current, total) => {
                    updateQueueItem(id, {
                        currentPage: current,
                        totalPages: total,
                        progress: Math.round((current / total) * 100)
                    });
                    updateProgress(processedCount + 1, totalItems, `正在下載: ${item.title}`, `頁面 ${current}/${total}`);
                });

                updateQueueItem(id, { status: QueueItemStatus.COMPLETED, progress: 100 });

                // 記錄到歷史
                await addToHistory({
                    galleryId: id,
                    title: item.title,
                    pageCount: item.totalPages
                });
                downloadedIds.add(id);

                // 更新頁面上的已下載標記
                const checkbox = document.querySelector(`.nhd-checkbox[data-id="${id}"]`);
                if (checkbox && !checkbox.parentElement.querySelector('.nhd-downloaded-badge')) {
                    const badge = document.createElement('div');
                    badge.className = 'nhd-downloaded-badge';
                    badge.textContent = '✓';
                    checkbox.parentElement.appendChild(badge);
                }

                successCount++;
            } catch (err) {
                console.error(`Failed to download ${id}:`, err);
                updateQueueItem(id, {
                    status: QueueItemStatus.FAILED,
                    error: err.message
                });
                failCount++;
            }

            processedCount++;
        }

        if (successCount > 0 && !shouldCancel) {
            updateProgress(successCount, successCount, '正在生成最終 ZIP...', '請稍候，這可能需要一點時間');

            const zipBlob = await masterZip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 5 }
            });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const zipUrl = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = zipUrl;
            a.download = `nhentai_batch_${timestamp}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(zipUrl);
        }

        hideProgressModal();
        isDownloading = false;
        shouldCancel = false;
        updateDownloadButton();

        if (!shouldCancel) {
            if (failCount > 0) {
                showToast(`完成 ${successCount} 本，失敗 ${failCount} 本`, true);
            } else if (successCount > 0) {
                showToast(`成功打包 ${successCount} 本漫畫！`);
            }
        } else {
            showToast(`已取消下載 (${successCount}/${totalItems} 完成)`, true);
        }
    }

    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response && response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response?.friendlyError || response?.error || 'Unknown error'));
                }
            });
        });
    }

    function dataURLtoBlob(dataURL) {
        const arr = dataURL.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }

    async function downloadGalleryAsZip(galleryId, title, buttonEl) {
        if (buttonEl) {
            buttonEl.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 下載中...';
            buttonEl.style.pointerEvents = 'none';
        }

        try {
            const zip = new JSZip();
            await downloadGalleryToZip(galleryId, title, zip, null);

            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 5 }
            });

            const zipUrl = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = zipUrl;
            a.download = `${title.replace(/[<>:"/\\|?*]/g, '_')}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(zipUrl);

            // 記錄到歷史
            await addToHistory({ galleryId, title });
            downloadedIds.add(galleryId);

            if (buttonEl) {
                buttonEl.innerHTML = '<i class="fa fa-check"></i> 完成！';
                setTimeout(() => {
                    buttonEl.innerHTML = '<i class="fa fa-check"></i> 已下載 (重新下載)';
                    buttonEl.style.pointerEvents = '';
                    buttonEl.style.opacity = '0.7';
                }, 2000);
            }
        } catch (error) {
            console.error('[nhentai Downloader] Error:', error);
            if (buttonEl) {
                buttonEl.innerHTML = `<i class="fa fa-times"></i> ${error.message || '失敗'}`;
                setTimeout(() => {
                    buttonEl.innerHTML = '<i class="fa fa-download"></i> 下載為 ZIP';
                    buttonEl.style.pointerEvents = '';
                }, 3000);
            }
        }
    }

    async function downloadGalleryToZip(galleryId, title, targetZip, onPageProgress = null) {
        const { data } = await sendMessage({ action: 'fetchGalleryData', galleryId });

        const mediaId = data.media_id;
        const safeTitle = (data.title.pretty || data.title.english || `Gallery ${galleryId}`)
            .replace(/[<>:"/\\|?*]/g, '_')
            .substring(0, 100);

        const extMap = { j: 'jpg', p: 'png', g: 'gif', w: 'webp' };
        const pages = data.images.pages;

        const folder = settings.createSubfolders ? targetZip.folder(safeTitle) : targetZip;
        let successCount = 0;
        const concurrentDownloads = settings.concurrentDownloads || 5;

        const downloadPage = async (i) => {
            if (shouldCancel) return null;
            const page = pages[i];
            const originalExt = extMap[page.t] || 'jpg';
            const pageNum = i + 1;
            const imgUrl = `https://i${Math.floor(Math.random() * 4) + 1}.nhentai.net/galleries/${mediaId}/${pageNum}.${originalExt}`;

            // 根據設定決定輸出格式
            const convertToJpg = settings.outputFormat === 'jpg';
            const outputExt = settings.outputFormat === 'original' ? originalExt : settings.outputFormat;
            const filename = `${String(pageNum).padStart(3, '0')}.${outputExt}`;

            try {
                const { data: base64Data } = await sendMessage({
                    action: 'fetchImage',
                    url: imgUrl,
                    convertToJpg: convertToJpg,
                    quality: settings.imageQuality
                });
                return { filename, blob: dataURLtoBlob(base64Data), pageNum };
            } catch (err) {
                console.error(`[nhentai Downloader] Error fetching page ${pageNum}:`, err);
                return null;
            }
        };

        for (let i = 0; i < pages.length; i += concurrentDownloads) {
            if (shouldCancel) throw new Error('Cancelled');
            const batch = [];
            for (let j = 0; j < concurrentDownloads && i + j < pages.length; j++) {
                batch.push(downloadPage(i + j));
            }
            const results = await Promise.all(batch);
            results.forEach(result => {
                if (result) {
                    folder.file(result.filename, result.blob);
                    successCount++;
                }
            });
            if (onPageProgress) {
                onPageProgress(Math.min(i + concurrentDownloads, pages.length), pages.length);
            }
        }

        if (successCount === 0) throw new Error('No pages downloaded');

        // 更新佇列項目的總頁數
        const queueItem = queueItems.get(galleryId);
        if (queueItem) {
            queueItem.totalPages = pages.length;
        }
    }

    // ==================== 進度對話框 ====================
    function showProgressModal(total) {
        const modal = document.createElement('div');
        modal.className = 'nhd-modal';
        modal.id = 'nhd-progress-modal';
        modal.innerHTML = `
            <div class="nhd-modal-content">
                <h2>📥 正在下載並打包...</h2>
                <div class="nhd-progress-bar">
                    <div class="nhd-progress-fill" style="width: 0%"></div>
                </div>
                <div class="nhd-progress-text">準備中...</div>
                <div class="nhd-progress-detail"></div>
                <button class="nhd-cancel-btn" id="nhd-cancel">取消下載</button>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('nhd-cancel').addEventListener('click', () => {
            shouldCancel = true;
        });
    }

    function updateProgress(current, total, text, detail = '') {
        const modal = document.getElementById('nhd-progress-modal');
        if (modal) {
            const fill = modal.querySelector('.nhd-progress-fill');
            const textEl = modal.querySelector('.nhd-progress-text');
            const detailEl = modal.querySelector('.nhd-progress-detail');
            fill.style.width = `${(current / total) * 100}%`;
            textEl.textContent = `${current}/${total} - ${text}`;
            detailEl.textContent = detail;
        }
    }

    function hideProgressModal() {
        const modal = document.getElementById('nhd-progress-modal');
        if (modal) modal.remove();
    }

    // 初始化
    init();

})();
