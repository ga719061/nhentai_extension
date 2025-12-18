// Popup script
document.addEventListener('DOMContentLoaded', () => {
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
        }
    });
});
