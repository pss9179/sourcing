// Content script for CadenceFlow app (http://localhost:8081)
// This allows the extension popup to get the auth token from localStorage

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getAuthToken') {
        const token = localStorage.getItem('authToken');
        sendResponse({ token: token });
    }
    return true; // Keep the message channel open for async response
});

console.log('✅ CadenceFlow extension connected to main app');

