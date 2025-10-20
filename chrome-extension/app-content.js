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
        console.log('📥 Contact added from extension:', contact, 'Cadence ID:', cadenceId);
        
        // Trigger auto-load of cadence in builder with contact data
        window.postMessage({ 
            type: 'CADENCEFLOW_LOAD_CADENCE_WITH_CONTACT', 
            contact: contact,
            cadenceId: cadenceId
        }, '*');
        
        // Show big success notification
        showBigSuccessNotification(contact.name, 'Loading cadence in Builder...');
        
        sendResponse({ success: true });
    }
    return true;
});

// Show big success notification with contact details
function showBigSuccessNotification(contactName, subtitle = 'has been added to your cadence') {
    const notification = document.createElement('div');
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            z-index: 999999;
            text-align: center;
            animation: popIn 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            min-width: 400px;
        ">
            <div style="
                width: 80px;
                height: 80px;
                background: linear-gradient(135deg, #10B981 0%, #059669 100%);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 20px;
            ">
                <i class="fas fa-check" style="font-size: 40px; color: white;"></i>
            </div>
            <h2 style="
                font-size: 24px;
                font-weight: 700;
                color: #1f2937;
                margin: 0 0 10px 0;
            ">Contact Added!</h2>
            <p style="
                font-size: 16px;
                color: #6b7280;
                margin: 0 0 20px 0;
            ">${contactName}</p>
            <p style="
                font-size: 14px;
                color: #10B981;
                font-weight: 600;
            ">${subtitle}</p>
        </div>
        <div style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
            z-index: 999998;
        "></div>
        <style>
            @keyframes popIn {
                0% {
                    transform: translate(-50%, -50%) scale(0.5);
                    opacity: 0;
                }
                100% {
                    transform: translate(-50%, -50%) scale(1);
                    opacity: 1;
                }
            }
        </style>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transition = 'opacity 0.3s';
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 2500);
}

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
