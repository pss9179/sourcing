// Content script for CadenceFlow main app (localhost:8081)
// Listens for auth token and saves it to extension storage

console.log('🔧 CadenceFlow app content script loaded');

// Listen for token broadcasts from the page
window.addEventListener('message', (event) => {
    // Only accept messages from same origin
    if (event.origin !== window.location.origin) {
        return;
    }
    
    if (event.data && event.data.type === 'CADENCEFLOW_AUTH_TOKEN') {
        const token = event.data.token;
        console.log('📥 Received token broadcast from app');
        
        // Save to extension storage
        chrome.storage.local.set({ authToken: token }, () => {
            console.log('✅ Token saved to extension storage!');
            
            // Show a brief success notification in the page
            showSuccessNotification('Extension synced! Ready to use on LinkedIn');
        });
    }
});

// Listen for messages from extension (when contact is added)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'contactAdded') {
        const { contact, cadenceId } = request;
        console.log('📥 Contact added from extension:', contact);
        
        // Show notification in the app
        showSuccessNotification(`✅ ${contact.name} added to cadence!<br><small style="opacity: 0.9;">Click "Contacts" tab to see them</small>`);
        
        // Trigger a refresh if user is on contacts view
        window.postMessage({ 
            type: 'CADENCEFLOW_CONTACT_ADDED', 
            contact: contact 
        }, '*');
        
        sendResponse({ success: true });
    }
    return true;
});

// Also check if token is already available on page load
function checkForExistingToken() {
    const token = localStorage.getItem('authToken') || window.CADENCEFLOW_TOKEN;
    
    if (token) {
        console.log('📥 Found existing token on page');
        chrome.storage.local.set({ authToken: token }, () => {
            console.log('✅ Existing token synced to extension!');
        });
    }
}

// Check on load
setTimeout(checkForExistingToken, 500);

// Show a brief notification in the page
function showSuccessNotification(message) {
    const notification = document.createElement('div');
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #10B981 0%, #059669 100%);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(16, 185, 129, 0.3);
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            font-weight: 600;
            animation: slideIn 0.3s ease-out;
            max-width: 350px;
        ">
            ${message}
        </div>
        <style>
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        </style>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}
