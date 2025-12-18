// Background Service Worker - Handles cross-origin image fetching with format conversion
console.log('[nhentai Downloader] Background service worker loaded');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fetchImage') {
        fetchImageAsJpegBase64(message.url, message.convertToJpg)
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (message.action === 'fetchGalleryData') {
        fetch(`https://nhentai.net/api/gallery/${message.galleryId}`)
            .then(res => res.json())
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
});

async function fetchImageAsJpegBase64(url, convertToJpg = true) {
    console.log('[nhentai Downloader] Fetching:', url);

    const response = await fetch(url, {
        method: 'GET',
        credentials: 'include'
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();

    // If conversion is requested and it's not already a JPEG
    if (convertToJpg && !blob.type.includes('jpeg') && !blob.type.includes('jpg')) {
        // Convert to JPEG using OffscreenCanvas (available in Service Workers)
        try {
            const imageBitmap = await createImageBitmap(blob);
            const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imageBitmap, 0, 0);

            // Convert to JPEG blob with 90% quality
            const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });

            // Convert to base64
            const arrayBuffer = await jpegBlob.arrayBuffer();
            const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
            return `data:image/jpeg;base64,${base64}`;
        } catch (conversionError) {
            console.warn('[nhentai Downloader] Conversion failed, returning original:', conversionError);
            // Fall back to original format
        }
    }

    // Return original format as base64
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
