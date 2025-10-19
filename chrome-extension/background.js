// CadenceFlow Chrome Extension - Background Service Worker

console.log('🚀 CadenceFlow Background Service Worker Started');

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'openCadenceSelector') {
        // Store the profile data
        chrome.storage.local.set({ profileData: request.data }, () => {
            // Open the popup
            chrome.action.openPopup();
        });
    }
    return true;
});

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
    console.log('✅ CadenceFlow Extension Installed');
});


