// nhentai Downloader Content Script - Enhanced UX Version
// Features: Keyboard shortcuts, cancel button, toast notifications, per-page progress
(function () {
    'use strict';

    const selectedGalleries = new Set();
    let isDownloading = false;
    let shouldCancel = false;

    // Initialize based on current page
    if (window.location.pathname.includes('/favorites')) {
        initFavoritesPage();
    } else if (window.location.pathname.includes('/g/')) {
        initGalleryPage();
    }

    function initFavoritesPage() {
        console.log('[nhentai Downloader] Initializing favorites page...');

        const galleries = document.querySelectorAll('.gallery');
        galleries.forEach(gallery => {
            const link = gallery.querySelector('a');
            if (!link) return;

            const galleryId = link.href.match(/\/g\/(\d+)/)?.[1];
            if (!galleryId) return;

            gallery.style.position = 'relative';

            const checkboxOverlay = document.createElement('div');
            checkboxOverlay.className = 'nhd-checkbox-overlay';
            checkboxOverlay.innerHTML = `<div class="nhd-checkbox" data-id="${galleryId}"></div>`;

            checkboxOverlay.querySelector('.nhd-checkbox').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSelection(galleryId, e.target);
            });

            gallery.prepend(checkboxOverlay);
        });

        const toolbar = document.createElement('div');
        toolbar.className = 'nhd-toolbar';
        toolbar.innerHTML = `
            <button class="nhd-btn nhd-btn-secondary" id="nhd-select-all">
                ☑️ 全選 <kbd>A</kbd>
            </button>
            <button class="nhd-btn nhd-btn-primary" id="nhd-download-selected" disabled>
                📥 下載已選 (0)
            </button>
        `;
        document.body.appendChild(toolbar);

        // Keyboard shortcut hint
        const hint = document.createElement('div');
        hint.className = 'nhd-shortcut-hint';
        hint.innerHTML = '快捷鍵: <kbd>A</kbd> 全選 | <kbd>D</kbd> 下載 | <kbd>Esc</kbd> 取消選擇';
        document.body.appendChild(hint);
        setTimeout(() => hint.style.opacity = '0', 5000);
        setTimeout(() => hint.remove(), 5500);

        document.getElementById('nhd-select-all').addEventListener('click', selectAll);
        document.getElementById('nhd-download-selected').addEventListener('click', downloadSelected);

        // Keyboard shortcuts
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
            } else if (e.key === 'Escape') {
                if (isDownloading) {
                    shouldCancel = true;
                } else {
                    clearSelection();
                }
            }
        });
    }

    function initGalleryPage() {
        console.log('[nhentai Downloader] Initializing gallery page...');

        const buttonsContainer = document.querySelector('#info .buttons');
        if (!buttonsContainer) return;

        const downloadBtn = document.createElement('a');
        downloadBtn.className = 'btn btn-primary nhd-single-download';
        downloadBtn.innerHTML = '<i class="fa fa-download"></i> 下載為 ZIP';
        downloadBtn.href = '#';
        downloadBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const galleryId = window.location.pathname.match(/\/g\/(\d+)/)?.[1];
            if (galleryId) {
                const title = document.querySelector('#info h1')?.textContent || `Gallery ${galleryId}`;
                await downloadGalleryAsZip(galleryId, title, downloadBtn);
            }
        });

        buttonsContainer.appendChild(downloadBtn);
    }

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

    async function downloadSelected() {
        const ids = Array.from(selectedGalleries);
        if (ids.length === 0 || isDownloading) return;

        isDownloading = true;
        shouldCancel = false;
        updateDownloadButton();
        showProgressModal(ids.length);

        const masterZip = new JSZip();
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < ids.length; i++) {
            if (shouldCancel) {
                showToast(`已取消下載 (${successCount}/${ids.length} 完成)`, true);
                break;
            }

            const galleryId = ids[i];
            const galleryEl = document.querySelector(`.nhd-checkbox[data-id="${galleryId}"]`)?.closest('.gallery');
            const title = galleryEl?.querySelector('.caption')?.textContent || `Gallery ${galleryId}`;

            updateProgress(i + 1, ids.length, `正在準備: ${title}`, '獲取元資料...');

            try {
                await downloadGalleryToZip(galleryId, title, masterZip, (current, total) => {
                    updateProgress(i + 1, ids.length, `正在下載: ${title}`, `頁面 ${current}/${total}`);
                });
                successCount++;
            } catch (err) {
                console.error(`Failed to download ${galleryId}:`, err);
                failCount++;
            }
        }

        if (successCount > 0 && !shouldCancel) {
            updateProgress(successCount, successCount, '正在生成最終 ZIP...', '請稍候，這可能需要一點時間');
            console.log('[nhentai Downloader] Generating master ZIP...');
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
            } else {
                showToast(`成功打包 ${successCount} 本漫畫至單一 ZIP！`);
            }
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
                    reject(new Error(response?.error || 'Unknown error'));
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

            console.log('[nhentai Downloader] Generating ZIP...');
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

            if (buttonEl) {
                buttonEl.innerHTML = '<i class="fa fa-check"></i> 完成！';
                setTimeout(() => {
                    buttonEl.innerHTML = '<i class="fa fa-download"></i> 下載為 ZIP';
                    buttonEl.style.pointerEvents = '';
                }, 3000);
            }
        } catch (error) {
            console.error('[nhentai Downloader] Error:', error);
            if (buttonEl) {
                buttonEl.innerHTML = '<i class="fa fa-times"></i> 失敗';
                setTimeout(() => {
                    buttonEl.innerHTML = '<i class="fa fa-download"></i> 下載為 ZIP';
                    buttonEl.style.pointerEvents = '';
                }, 3000);
            }
        }
    }

    async function downloadGalleryToZip(galleryId, title, targetZip, onPageProgress = null) {
        console.log('[nhentai Downloader] Fetching gallery data...');
        const { data } = await sendMessage({ action: 'fetchGalleryData', galleryId });

        const mediaId = data.media_id;
        const safeTitle = (data.title.pretty || data.title.english || `Gallery ${galleryId}`)
            .replace(/[<>:"/\\|?*]/g, '_')
            .substring(0, 100);

        const extMap = { j: 'jpg', p: 'png', g: 'gif', w: 'webp' };
        const pages = data.images.pages;

        const folder = targetZip.folder(safeTitle);
        let successCount = 0;
        const CONCURRENT_DOWNLOADS = 5;

        const downloadPage = async (i) => {
            if (shouldCancel) return null;
            const page = pages[i];
            const ext = extMap[page.t] || 'jpg';
            const pageNum = i + 1;
            const imgUrl = `https://i${Math.floor(Math.random() * 4) + 1}.nhentai.net/galleries/${mediaId}/${pageNum}.${ext}`;
            const filename = `${String(pageNum).padStart(3, '0')}.jpg`;

            try {
                const { data: base64Data } = await sendMessage({
                    action: 'fetchImage',
                    url: imgUrl,
                    convertToJpg: true
                });
                return { filename, blob: dataURLtoBlob(base64Data), pageNum };
            } catch (err) {
                console.error(`[nhentai Downloader] Error fetching page ${pageNum}:`, err);
                return null;
            }
        };

        for (let i = 0; i < pages.length; i += CONCURRENT_DOWNLOADS) {
            if (shouldCancel) throw new Error('Cancelled');
            const batch = [];
            for (let j = 0; j < CONCURRENT_DOWNLOADS && i + j < pages.length; j++) {
                batch.push(downloadPage(i + j));
            }
            const results = await Promise.all(batch);
            results.forEach(result => {
                if (result) {
                    folder.file(result.filename, result.blob);
                    successCount++;
                    console.log(`[nhentai Downloader] Added page ${result.pageNum}/${pages.length}`);
                }
            });
            if (onPageProgress) {
                onPageProgress(Math.min(i + CONCURRENT_DOWNLOADS, pages.length), pages.length);
            }
        }

        if (successCount === 0) throw new Error('No pages downloaded');
    }

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

})();
