// Background script for CadenceFlow extension

console.log('🚀 CadenceFlow background script loaded');

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📩 Message received:', request);
    
    if (request.action === 'openPopup') {
        // When the floating button is clicked, open the extension popup
        // This is done by programmatically triggering the extension icon click
        chrome.action.openPopup();
    }
    
    return true;
});
