// Popup script - Enhanced with tabs, settings, and history
document.addEventListener('DOMContentLoaded', async () => {
  // Tab 導航
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`tab-${targetTab}`).classList.add('active');

      // 載入對應頁面的資料
      if (targetTab === 'history') {
        loadHistory();
      }
    });
  });

  // 狀態檢測
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || '';
    const statusEl = document.getElementById('status');

    if (url.includes('nhentai.net/favorites')) {
      statusEl.classList.add('active');
      statusEl.innerHTML = `
                <div class="status-dot"></div>
                <span>✅ 已連接收藏夾頁面</span>
            `;
    } else if (url.includes('nhentai.net/g/')) {
      statusEl.classList.add('active');
      statusEl.innerHTML = `
                <div class="status-dot"></div>
                <span>✅ 已連接漫畫頁面</span>
            `;
    } else if (url.includes('nhentai.net/search') ||
      url.includes('nhentai.net/tag') ||
      url.includes('nhentai.net/artist') ||
      url.includes('nhentai.net/character') ||
      url.includes('nhentai.net/parody') ||
      url.includes('nhentai.net/group')) {
      statusEl.classList.add('active');
      statusEl.innerHTML = `
                <div class="status-dot"></div>
                <span>✅ 已連接搜尋頁面</span>
            `;
    }
  });

  // 載入設定
  await loadSettings();

  // 設定事件監聽
  setupSettingsListeners();

  // 歷史記錄操作
  document.getElementById('export-history').addEventListener('click', exportHistory);
  document.getElementById('clear-history').addEventListener('click', clearHistory);
});

// ==================== 設定 ====================

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      const settings = response?.settings || {
        concurrentDownloads: 5,
        imageQuality: 90,
        outputFormat: 'jpg',
        createSubfolders: true,
        showNotifications: true
      };

      // 套用設定到 UI
      document.getElementById('setting-concurrent').value = settings.concurrentDownloads;
      document.getElementById('concurrent-value').textContent = `${settings.concurrentDownloads} 個同時下載`;

      document.getElementById('setting-quality').value = settings.imageQuality;
      document.getElementById('quality-value').textContent = `${settings.imageQuality}%`;

      document.getElementById('setting-format').value = settings.outputFormat;
      document.getElementById('setting-subfolders').checked = settings.createSubfolders;
      document.getElementById('setting-notifications').checked = settings.showNotifications;

      resolve(settings);
    });
  });
}

function setupSettingsListeners() {
  // 並行下載數
  const concurrentInput = document.getElementById('setting-concurrent');
  concurrentInput.addEventListener('input', () => {
    const value = parseInt(concurrentInput.value);
    document.getElementById('concurrent-value').textContent = `${value} 個同時下載`;
  });
  concurrentInput.addEventListener('change', () => {
    saveSettings({ concurrentDownloads: parseInt(concurrentInput.value) });
  });

  // 品質
  const qualityInput = document.getElementById('setting-quality');
  qualityInput.addEventListener('input', () => {
    document.getElementById('quality-value').textContent = `${qualityInput.value}%`;
  });
  qualityInput.addEventListener('change', () => {
    saveSettings({ imageQuality: parseInt(qualityInput.value) });
  });

  // 格式
  document.getElementById('setting-format').addEventListener('change', (e) => {
    saveSettings({ outputFormat: e.target.value });
  });

  // 子資料夾
  document.getElementById('setting-subfolders').addEventListener('change', (e) => {
    saveSettings({ createSubfolders: e.target.checked });
  });

  // 通知
  document.getElementById('setting-notifications').addEventListener('change', (e) => {
    saveSettings({ showNotifications: e.target.checked });
  });
}

function saveSettings(updates) {
  chrome.runtime.sendMessage({ action: 'saveSettings', settings: updates });
}

// ==================== 歷史記錄 ====================

function loadHistory() {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
    const history = response?.history || [];
    const listEl = document.getElementById('history-list');

    if (history.length === 0) {
      listEl.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📭</div>
                    <div>尚無下載記錄</div>
                </div>
            `;
      return;
    }

    listEl.innerHTML = history.map(item => {
      const date = new Date(item.downloadedAt);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
      const pageInfo = item.pageCount ? `${item.pageCount}頁` : '';
      const countInfo = item.downloadCount > 1 ? ` • 下載${item.downloadCount}次` : '';

      return `
                <div class="history-item" data-id="${item.galleryId}">
                    <span class="history-icon">📖</span>
                    <div class="history-info">
                        <div class="history-title">${escapeHtml(item.title)}</div>
                        <div class="history-meta">${dateStr} ${pageInfo}${countInfo}</div>
                    </div>
                    <button class="history-delete" data-id="${item.galleryId}" title="刪除記錄">×</button>
                </div>
            `;
    }).join('');

    // 刪除按鈕
    listEl.querySelectorAll('.history-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteHistoryItem(btn.dataset.id);
      });
    });

    // 點擊跳轉
    listEl.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        chrome.tabs.create({ url: `https://nhentai.net/g/${item.dataset.id}/` });
      });
    });
  });
}

function deleteHistoryItem(galleryId) {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
    const history = response?.history || [];
    const filtered = history.filter(h => h.galleryId !== galleryId);

    // 直接設定新的歷史記錄
    chrome.storage.local.set({ downloadHistory: filtered }, () => {
      loadHistory();
    });
  });
}

function exportHistory() {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
    const history = response?.history || [];
    const json = JSON.stringify(history, null, 2);

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nhentai_history_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function clearHistory() {
  if (confirm('確定要清除所有下載記錄嗎？此操作無法復原。')) {
    chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
      loadHistory();
    });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
